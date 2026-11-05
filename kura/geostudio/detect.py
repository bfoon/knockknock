"""
kura/geostudio/detect.py — find trees, canopy, water, built-up and solar panels.

Two engines, used alone or together ("hybrid"):

PIXEL ENGINE — always available, free, deterministic, runs offline.
    * Vegetation: Excess-Green index on chromatic coordinates
      (ExG = 2g − r − b), thresholded with Otsu inside the AOI. Gives canopy
      hectares and canopy %.
    * Tree crowns: the greenness surface is smoothed at crown scale and local
      maxima are counted (classic individual-tree-detection for RGB). Only run
      when the image is ≤ 1.2 m/pixel, otherwise crowns can't be resolved and
      the report says so instead of inventing a number.
    * Water: blue-over-red, low greenness, low brightness.
    * Solar: dark, blue-leaning, low-saturation blobs that are close to a
      rectangle (filled area vs. their oriented bounding box), 1.5 m² – 2 ha.
    Being deterministic matters for MRV: run the same frozen snapshot twice
    and you get the same numbers.

AI VISION — Gemini (free tier, via the same GEMINI_API_KEY / model chain as
    Hanns and Foon). Sees the snapshot and returns labelled boxes (palm,
    mangrove, tree, solar panel, building…) plus a land-cover breakdown and a
    short written reading of the scene. Smart at *what* things are; less
    reliable at *how many* in a dense stand, which is where the pixel engine
    is stronger. Hybrid reports both and says which number it trusts.
"""

from __future__ import annotations

import base64
import io
import logging
import math

from . import geo

logger = logging.getLogger(__name__)

LABEL_COLORS = {
    "tree": "#22c55e", "palm": "#a3e635", "mangrove": "#10b981", "solar": "#38bdf8",
    "building": "#f97316", "water": "#3b82f6", "vehicle": "#e879f9", "other": "#facc15",
}


def _norm_label(s):
    s = (s or "").lower()
    if "solar" in s or "panel" in s or "pv" in s:
        return "solar"
    if "mangrove" in s:
        return "mangrove"
    if "palm" in s or "coconut" in s:
        return "palm"
    if "tree" in s or "canopy" in s or "shrub" in s or "bush" in s:
        return "tree"
    if "build" in s or "roof" in s or "house" in s:
        return "building"
    if "water" in s or "pond" in s:
        return "water"
    if "car" in s or "vehicle" in s or "truck" in s:
        return "vehicle"
    return "other"


def _otsu(values, lo=-0.1, hi=0.9, bins=200):
    import numpy as np
    v = values[(values > lo) & (values < hi)]
    if v.size < 50:
        return 0.06
    hist, edges = np.histogram(v, bins=bins, range=(lo, hi))
    hist = hist.astype(float)
    centers = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(hist)
    w1 = w0[-1] - w0
    m0 = np.cumsum(hist * centers) / np.maximum(w0, 1e-9)
    m1 = (np.sum(hist * centers) - np.cumsum(hist * centers)) / np.maximum(w1, 1e-9)
    between = w0 * w1 * (m0 - m1) ** 2
    return float(centers[int(np.argmax(between))])


def pixel_engine(frame, mask, kind="full"):
    import numpy as np
    from scipy import ndimage

    rgb = np.asarray(frame.image, dtype=np.float32) / 255.0
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    S = R + G + B + 1e-6
    r, g, b = R / S, G / S, B / S
    exg = 2 * g - r - b
    V = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = (V - mn) / (V + 1e-6)

    mpp = frame.metres_per_pixel()
    px_m2 = mpp * mpp
    inside = mask
    n_in = int(inside.sum()) or 1

    thr = min(0.20, max(0.03, _otsu(exg[inside])))
    veg = inside & (exg > thr) & (V > 0.06)
    veg = ndimage.binary_opening(veg, iterations=1)
    water = inside & ~veg & (B > R + 0.02) & (exg < 0.02) & (V < 0.55)
    built = inside & ~veg & ~water & (sat < 0.22) & (V > 0.55)
    bare = inside & ~veg & ~water & ~built

    out = {"metres_per_pixel": round(mpp, 3), "pixels": n_in, "exg_threshold": round(thr, 4)}
    cover = {
        "canopy": float(veg.sum()) / n_in, "water": float(water.sum()) / n_in,
        "built": float(built.sum()) / n_in, "bare": float(bare.sum()) / n_in,
    }
    out["landcover_pct"] = {k: round(v * 100, 1) for k, v in cover.items()}
    out["canopy_m2"] = round(float(veg.sum()) * px_m2, 1)
    out["canopy_ha"] = round(float(veg.sum()) * px_m2 / 10000.0, 4)
    out["aoi_ha"] = round(n_in * px_m2 / 10000.0, 4)

    detections = []
    # ── tree crowns ─────────────────────────────────────────────────
    if kind in ("trees", "full", "landcover"):
        if mpp <= 1.2:
            crown_m = 5.0                                       # typical palm / young tree crown
            sigma = max(1.0, (crown_m / mpp) / 4.0)
            surf = ndimage.gaussian_filter(np.where(veg, exg, 0).astype(np.float32), sigma)
            size = max(3, int(round(crown_m / mpp * 0.8)) | 1)
            peaks = (surf == ndimage.maximum_filter(surf, size=size)) & veg & (surf > thr * 0.9)
            lab, n = ndimage.label(peaks)
            pts = ndimage.center_of_mass(peaks, lab, range(1, n + 1)) if n else []
            if len(pts) > 5000:
                out["tree_count_capped"] = True
            for (py, px) in pts[:5000]:
                lon, lat = frame.to_lonlat(px + 0.5, py + 0.5)
                detections.append({"label": "tree", "lat": round(lat, 7), "lng": round(lon, 7),
                                   "source": "pixel", "confidence": None})
            out["tree_count"] = len(pts)
            canopy_ha = out["canopy_ha"]
            out["trees_per_ha"] = round(len(pts) / canopy_ha, 1) if canopy_ha > 0 else 0
        else:
            out["tree_count"] = None
            out["tree_note"] = (f"Imagery is {mpp:.1f} m/pixel — too coarse to count single crowns "
                                "(needs ≤ 1.2 m). Canopy area is still measured. Zoom in or upload drone imagery.")

    # ── solar panels ────────────────────────────────────────────────
    panels = []
    if kind in ("solar", "full"):
        cand = inside & ~veg & (V < 0.42) & (B >= R - 0.01) & (sat < 0.72) & (V > 0.04)
        cand = ndimage.binary_opening(cand, iterations=1)
        lab, n = ndimage.label(cand)
        if n:
            sl = ndimage.find_objects(lab)
            min_px = max(4, 1.5 / px_m2)
            max_px = 20000 / px_m2
            for i, s in enumerate(sl[:20000], start=1):
                if s is None:
                    continue
                comp = lab[s] == i
                area = int(comp.sum())
                if area < min_px or area > max_px:
                    continue
                ys, xs = np.nonzero(comp)
                ys = ys + s[0].start
                xs = xs + s[1].start
                pts = np.stack([xs, ys], axis=1).astype(np.float64)
                c = pts.mean(axis=0)
                cov = np.cov((pts - c).T) if len(pts) > 2 else np.eye(2)
                evals, evecs = np.linalg.eigh(cov)
                proj = (pts - c) @ evecs
                lo, hi = proj.min(axis=0), proj.max(axis=0)
                L, W = (hi - lo) + 1
                fill = area / max(1.0, L * W)
                if fill < 0.72 or min(L, W) < 2:
                    continue
                # contrast: a panel is darker than the ring around it
                Hh, Ww = V.shape
                y0, y1 = max(0, s[0].start - 3), min(Hh, s[0].stop + 3)
                x0, x1 = max(0, s[1].start - 3), min(Ww, s[1].stop + 3)
                win = lab[y0:y1, x0:x1] == i
                ring = ndimage.binary_dilation(win, iterations=3) & ~ndimage.binary_fill_holes(win)
                around = V[y0:y1, x0:x1][ring]
                if around.size and (around.mean() - V[y0:y1, x0:x1][win].mean()) < 0.08:
                    continue
                corners = [lo, [hi[0], lo[1]], hi, [lo[0], hi[1]]]
                ring_ll = []
                for cx, cy in corners:
                    p = c + evecs @ np.array([cx, cy])
                    lon, lat = frame.to_lonlat(float(p[0]) + 0.5, float(p[1]) + 0.5)
                    ring_ll.append([round(lon, 7), round(lat, 7)])
                ring_ll.append(ring_ll[0])
                lon, lat = frame.to_lonlat(float(c[0]) + 0.5, float(c[1]) + 0.5)
                panels.append({"label": "solar", "lat": round(lat, 7), "lng": round(lon, 7), "source": "pixel",
                               "area_m2": round(area * px_m2, 1), "polygon": ring_ll,
                               "confidence": round(min(1.0, fill), 2)})
        out["solar_count"] = len(panels)
        out["solar_area_m2"] = round(sum(p["area_m2"] for p in panels), 1)
        detections.extend(panels)

    masks = {"veg": veg, "water": water, "built": built}
    return out, detections, masks


# ───────────────────────────── AI vision ─────────────────────────────

VISION_SYSTEM = """You are a remote-sensing analyst looking at a top-down satellite or drone image.
Detect objects and return ONE JSON object only:
{
 "detections": [{"label": "palm tree|mangrove|tree|solar panel|building|water|vehicle", "box_2d": [ymin, xmin, ymax, xmax], "confidence": 0.0-1.0}],
 "landcover": {"tree_canopy_pct": n, "mangrove_pct": n, "cropland_pct": n, "water_pct": n, "built_pct": n, "bare_pct": n},
 "estimated_tree_count": n,
 "estimated_solar_panel_area_m2": n,
 "notes": "two or three sentences: what the scene is, ecosystem type, anything that matters for carbon or land verification (planting rows, clearing, fresh planting, erosion)"
}
box_2d values are normalised to 0-1000 of image height/width. List at most 250 detections, largest and clearest first.
Solar panels: one box per contiguous array. Do not invent objects; if unsure, leave them out."""


def _vision_call(jpeg_bytes, prompt, user_id=None):
    """Gemini with an inline image, walking the same model chain as Hanns."""
    from hanns import ai as hai

    if not hai.is_enabled():
        raise hai.AIError("AI vision needs GEMINI_API_KEY in .env.", status=503)
    if user_id:
        hai.take_quota(user_id)
    payload_base = {
        "systemInstruction": {"parts": [{"text": VISION_SYSTEM}]},
        "contents": [{"role": "user", "parts": [
            {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(jpeg_bytes).decode()}},
            {"text": prompt},
        ]}],
    }
    cfgs = [{"temperature": 0.2, "maxOutputTokens": 8192, "responseMimeType": "application/json"},
            {"temperature": 0.2, "maxOutputTokens": 8192}]
    last = "no model answered"
    for model in [m for m in hai.model_chain() if not hai._cooling(m)]:
        for cfg in cfgs:
            status, data = hai._post(model, dict(payload_base, generationConfig=cfg), timeout=90)
            if status == 200:
                text = hai._extract_text(data)
                if text:
                    try:
                        return hai._parse_json(text), model
                    except hai.AIError as e:
                        last = str(e)
                break
            last = hai._error_message(data, status)
            if status == 400:
                continue
            if status == 429:
                hai._cool(model, 120)
            elif status == 404:
                hai._cool(model, 6 * 3600)
            elif status in (401, 403):
                raise hai.AIError("Gemini rejected the API key.", status=503)
            break
    raise hai.AIError("AI vision didn't answer: " + last[:200])


def ai_engine(frame, mask, kind="full", user_id=None, context=""):
    import numpy as np

    img = frame.image
    W, H = img.size
    k = min(1.0, 1536 / max(W, H))
    send = img.resize((int(W * k), int(H * k))) if k < 1 else img
    buf = io.BytesIO()
    send.save(buf, format="JPEG", quality=88)
    focus = {"trees": "Focus on trees, palms and mangroves.", "solar": "Focus on solar panels.",
             "landcover": "Focus on land cover.", "full": "Report everything."}.get(kind, "")
    mpp = frame.metres_per_pixel() / k
    prompt = (f"Ground resolution ≈ {mpp:.2f} m per pixel; image is {send.size[0]}×{send.size[1]} px "
              f"(≈ {send.size[0] * mpp:.0f} m wide). {focus} {context}").strip()
    data, model = _vision_call(buf.getvalue(), prompt, user_id=user_id)

    dets = []
    for d in (data.get("detections") or [])[:300]:
        box = d.get("box_2d") or d.get("box")
        if not isinstance(box, (list, tuple)) or len(box) != 4:
            continue
        try:
            y0, x0, y1, x1 = [float(v) for v in box]
        except (TypeError, ValueError):
            continue
        cx, cy = (x0 + x1) / 2 / 1000 * W, (y0 + y1) / 2 / 1000 * H
        ix, iy = int(min(W - 1, max(0, cx))), int(min(H - 1, max(0, cy)))
        if not mask[iy, ix]:
            continue
        lab = _norm_label(d.get("label"))
        corners = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
        poly = []
        for px, py in corners:
            lon, lat = frame.to_lonlat(px / 1000 * W, py / 1000 * H)
            poly.append([round(lon, 7), round(lat, 7)])
        lon, lat = frame.to_lonlat(cx, cy)
        bw = abs(x1 - x0) / 1000 * W * frame.metres_per_pixel()
        bh = abs(y1 - y0) / 1000 * H * frame.metres_per_pixel()
        dets.append({"label": lab, "raw_label": str(d.get("label") or "")[:40], "lat": round(lat, 7),
                     "lng": round(lon, 7), "polygon": poly, "area_m2": round(bw * bh, 1),
                     "confidence": d.get("confidence"), "source": "ai"})
    counts = {}
    for d in dets:
        counts[d["label"]] = counts.get(d["label"], 0) + 1
    res = {"model": model, "counts": counts, "landcover_pct": data.get("landcover") or {},
           "estimated_tree_count": data.get("estimated_tree_count"),
           "estimated_solar_panel_area_m2": data.get("estimated_solar_panel_area_m2"),
           "notes": str(data.get("notes") or "")[:1200]}
    return res, dets


# ───────────────────────────── overlay ─────────────────────────────

def overlay_png(frame, masks, mask):
    import numpy as np
    from PIL import Image

    h, w = mask.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    if masks.get("veg") is not None:
        rgba[masks["veg"]] = (34, 197, 94, 120)
    if masks.get("water") is not None:
        rgba[masks["water"]] = (59, 130, 246, 120)
    if masks.get("built") is not None:
        rgba[masks["built"]] = (249, 115, 22, 70)
    # dim outside the AOI so the analysed area reads at a glance
    rgba[~mask] = (0, 0, 0, 90)
    buf = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def run(frame, geometry, props=None, kind="full", engine="hybrid", user_id=None, context=""):
    """Run the requested engines. Returns (result, overlay_png_bytes, snapshot_jpeg_bytes)."""
    import hashlib

    from . import imagery

    mask = imagery.aoi_mask(frame, geometry, props)
    result = {"kind": kind, "engine": engine, "source": frame.source, "zoom": frame.zoom}
    detections = []
    overlay = None

    if engine in ("pixel", "hybrid"):
        px, dets, masks = pixel_engine(frame, mask, kind)
        result["pixel"] = px
        detections += dets
        overlay = overlay_png(frame, masks, mask)

    if engine in ("ai", "hybrid"):
        try:
            ai_res, ai_dets = ai_engine(frame, mask, kind, user_id=user_id, context=context)
            result["ai"] = ai_res
            detections += ai_dets
        except Exception as e:      # AI is a bonus layer in hybrid — never lose the pixel result
            msg = str(e) or e.__class__.__name__
            if engine == "ai":
                raise
            result["ai_error"] = msg[:300]

    if overlay is None:
        import numpy as np
        overlay = overlay_png(frame, {}, mask)

    snap = io.BytesIO()
    frame.image.save(snap, format="JPEG", quality=90)
    snap_bytes = snap.getvalue()

    result["detections"] = detections[:6000]
    result["summary"] = summarise(result, geometry, props)
    result["snapshot_sha256"] = hashlib.sha256(snap_bytes).hexdigest()
    result["bounds"] = frame.bounds()
    return result, overlay, snap_bytes


def summarise(result, geometry, props=None):
    """One flat dict the UI, the carbon maths and the report all read."""
    px = result.get("pixel") or {}
    ai = result.get("ai") or {}
    aoi_ha = geo.measure(geometry, props)["area_m2"] / 10000.0
    s = {"aoi_ha": round(aoi_ha, 4)}
    if px:
        s["canopy_ha"] = px.get("canopy_ha")
        s["canopy_pct"] = (px.get("landcover_pct") or {}).get("canopy")
        s["water_pct"] = (px.get("landcover_pct") or {}).get("water")
        s["built_pct"] = (px.get("landcover_pct") or {}).get("built")
        s["bare_pct"] = (px.get("landcover_pct") or {}).get("bare")
        s["resolution_m"] = px.get("metres_per_pixel")
    trees_px = px.get("tree_count")
    trees_ai = None
    if ai:
        c = ai.get("counts") or {}
        trees_ai = sum(c.get(k, 0) for k in ("tree", "palm", "mangrove")) or ai.get("estimated_tree_count")
        s["ai_counts"] = c
        s["ai_notes"] = ai.get("notes")
        s["ai_model"] = ai.get("model")
    # Which number to trust: the pixel count in dense stands when resolution
    # allows it, the AI count when the pixel engine couldn't count.
    if trees_px is not None:
        s["tree_count"] = trees_px
        s["tree_count_source"] = "pixel"
        if trees_ai:
            s["tree_count_ai"] = trees_ai
    elif trees_ai:
        s["tree_count"] = trees_ai
        s["tree_count_source"] = "ai"
    if "solar_area_m2" in px or (ai and "solar" in (ai.get("counts") or {})):
        px_area = px.get("solar_area_m2") or 0
        ai_area = sum(d.get("area_m2") or 0 for d in result.get("detections", [])
                      if d.get("source") == "ai" and d.get("label") == "solar")
        area = max(px_area, ai_area)
        s["solar_area_m2"] = round(area, 1)
        s["solar_count"] = px.get("solar_count") if px_area >= ai_area else (ai.get("counts") or {}).get("solar", 0)
        s["solar_kwp"] = round(area * 0.20, 1)
    if px.get("tree_note"):
        s["note"] = px["tree_note"]
    return s
