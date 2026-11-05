"""
kura/geostudio/fit.py — "Fit to ground": turn a rough box into the real outline.

You draw a loose box (or click once with the Wand) over a mangrove stand, a
farm, a pond or a roof. The server looks at the imagery underneath and traces
the true edge of that thing as a polygon you can keep editing.

How
───
1. Fetch the imagery around the box (satellite tiles or an uploaded drone
   image), padded by `reach` metres so the shape can grow past a box that
   was drawn too small.
2. Build a "what counts" mask:
     vegetation  Excess-Green above an Otsu threshold (mangroves, palms, crops)
     water       blue-over-red, low greenness
     bare        not vegetation, not water (sand, cleared land, dry farms)
     built       bright, low-saturation (roofs, concrete)
     auto        colour similarity to the middle of the box — whatever you
                 put the box on (a field of one crop, a dark solar array…)
3. Clean it (close small gaps, open specks, fill holes), keep the connected
   piece that overlaps the box most (or contains the Wand click).
4. Trace its outline (contourpy marching squares — ships with matplotlib),
   simplify with Douglas–Peucker at a tolerance tied to the pixel size,
   optionally smooth with Chaikin, convert pixels → lon/lat.

Pure numpy/scipy, no new dependency.
"""

from __future__ import annotations

import math

from . import geo, imagery

TARGETS = ("auto", "vegetation", "water", "bare", "built")


class FitError(ValueError):
    pass


def _dp(points, eps):
    """Douglas–Peucker on an open list of (x, y)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy) or 1e-12
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / norm
            if d > best:
                best, idx = d, i
        if idx >= 0 and best > eps:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring, eps):
    """DP on a closed ring: split at the two most distant vertices so the
    start point never survives just because it is the start point."""
    pts = ring[:-1] if ring and ring[0] == ring[-1] else list(ring)
    if len(pts) < 5:
        return pts + pts[:1]
    far = max(range(len(pts)), key=lambda i: (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2)
    a = _dp(pts[: far + 1], eps)
    b = _dp(pts[far:] + [pts[0]], eps)
    out = a[:-1] + b[:-1]
    if len(out) < 3:
        out = pts[:: max(1, len(pts) // 4)][:4]
    return out + out[:1]


def chaikin(ring, rounds=1):
    pts = ring[:-1] if ring and ring[0] == ring[-1] else list(ring)
    for _ in range(max(0, rounds)):
        nxt = []
        n = len(pts)
        for i in range(n):
            (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
            nxt.append((0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1))
            nxt.append((0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1))
        pts = nxt
    return pts + pts[:1]


def _masks(frame):
    import numpy as np

    from .detect import _otsu
    rgb = np.asarray(frame.image, dtype=np.float32) / 255.0
    R, G, B = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    S = R + G + B + 1e-6
    exg = 2 * G / S - R / S - B / S
    V = rgb.max(axis=2)
    sat = (V - rgb.min(axis=2)) / (V + 1e-6)
    thr = min(0.20, max(0.03, _otsu(exg.ravel())))
    veg = (exg > thr) & (V > 0.06)
    water = ~veg & (B > R + 0.02) & (exg < 0.02) & (V < 0.55)
    built = ~veg & ~water & (sat < 0.22) & (V > 0.55)
    return rgb, exg, veg, water, built


def _auto_mask(rgb, exg, seed, tolerance):
    """Colour similarity to the seed area. Features: chromatic r, g, b,
    brightness and greenness — robust to light/shadow differences."""
    import numpy as np
    S = rgb.sum(axis=2, keepdims=True) + 1e-6
    feats = np.concatenate([rgb / S * 3.0, rgb.max(axis=2, keepdims=True), exg[..., None] * 2.0], axis=2)
    sample = feats[seed]
    if sample.shape[0] < 9:
        raise FitError("The box is too small for the imagery — zoom in or draw it bigger.")
    med = np.median(sample, axis=0)
    spread = np.median(np.abs(sample - med), axis=0) + 0.02
    dist = np.sqrt((((feats - med) / spread) ** 2).sum(axis=2))
    # tolerance 0 → strict (≈ 1.5 spreads), 1 → loose (≈ 7 spreads)
    return dist < (1.5 + 5.5 * float(tolerance))


def trace(frame, seed_geometry, seed_props=None, target="auto", tolerance=0.5, smooth=1,
          keep_inside=False, point=None):
    """Return (polygon_geometry, stats). `point` = [lon, lat] for the Wand."""
    import numpy as np
    from scipy import ndimage

    try:
        import contourpy
    except ImportError as e:  # pragma: no cover — matplotlib always brings it
        raise FitError("Fit needs the contourpy package (installed with matplotlib).") from e

    if target not in TARGETS:
        target = "auto"
    tolerance = max(0.0, min(1.0, float(tolerance)))
    rgb, exg, veg, water, built = _masks(frame)
    box = imagery.aoi_mask(frame, seed_geometry, seed_props)
    if not box.any():
        raise FitError("The box is outside the imagery.")

    # seed = the middle of the box (or the clicked spot), not its edges —
    # people draw boxes loosely and the corners are usually wrong.
    ys, xs = np.nonzero(box)
    cy, cx = ys.mean(), xs.mean()
    if point:
        cx, cy = frame.to_pixel(point[0], point[1])
    ry = max(2.0, (ys.max() - ys.min()) * 0.22)
    rx = max(2.0, (xs.max() - xs.min()) * 0.22)
    yy, xx = np.mgrid[0:box.shape[0], 0:box.shape[1]]
    core = (((yy - cy) / ry) ** 2 + ((xx - cx) / rx) ** 2 <= 1.0) & box

    if target == "vegetation":
        m = veg.copy()
    elif target == "water":
        m = water.copy()
    elif target == "built":
        m = built.copy()
    elif target == "bare":
        m = ~veg & ~water
    else:
        m = _auto_mask(rgb, exg, core, tolerance)

    mpp = frame.metres_per_pixel()
    # Close gaps between crowns / rows. Looser tolerance bridges wider gaps.
    gap_px = int(round(max(1.0, (1.0 + 6.0 * tolerance) / max(mpp, 0.05))))
    gap_px = min(gap_px, 25)
    m = ndimage.binary_closing(m, structure=np.ones((3, 3)), iterations=gap_px)
    m = ndimage.binary_opening(m, iterations=max(1, gap_px // 3))
    m = ndimage.binary_fill_holes(m)
    if keep_inside:
        m &= box
    lab, n = ndimage.label(m)
    if n == 0:
        raise FitError("Nothing of that kind was found under the box. Try another target or a looser fit.")
    if point:
        ix, iy = int(min(max(cx, 0), m.shape[1] - 1)), int(min(max(cy, 0), m.shape[0] - 1))
        pick = lab[iy, ix]
        if pick == 0:
            # clicked just off it — nearest labelled pixel within ~10 px
            near = lab[max(0, iy - 10):iy + 11, max(0, ix - 10):ix + 11]
            vals, counts = np.unique(near[near > 0], return_counts=True)
            if not len(vals):
                what = {"vegetation": "greenery", "water": "water", "bare": "bare ground", "built": "roof or concrete"}.get(target)
                raise FitError(f"No {what} at that spot — click inside it, or set Trace to Auto." if what
                               else "Nothing to trace at that spot — click inside the area, or loosen the fit.")
            pick = int(vals[np.argmax(counts)])
    else:
        overlap = ndimage.sum(box, lab, index=np.arange(1, n + 1))
        pick = int(np.argmax(overlap)) + 1
        if overlap[pick - 1] <= 0:
            raise FitError("Nothing of that kind overlaps the box.")
    comp = ndimage.binary_fill_holes(lab == pick)
    if comp.sum() < 12:
        raise FitError("That patch is only a few pixels — zoom in, or loosen the fit.")
    touches_edge = bool(comp[0, :].any() or comp[-1, :].any() or comp[:, 0].any() or comp[:, -1].any())

    padded = np.pad(comp.astype(np.float32), 1)
    lines = contourpy.contour_generator(z=padded, line_type="Separate").lines(0.5)
    if not lines:
        raise FitError("Couldn't trace an outline here.")
    ring = max(lines, key=len)
    ring = [(float(x) - 1.0, float(y) - 1.0) for x, y in ring]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    eps = max(0.8, (0.6 + 2.4 * (1 - min(1.0, smooth / 3))) )  # pixels
    ring = simplify_ring(ring, eps)
    if smooth >= 2:
        ring = chaikin(ring, 1 if smooth == 2 else 2)
        ring = simplify_ring(ring, 0.5)
    ll = []
    for x, y in ring:
        lon, lat = frame.to_lonlat(x + 0.5, y + 0.5)
        ll.append([round(lon, 7), round(lat, 7)])
    if ll[0] != ll[-1]:
        ll.append(ll[0])
    if len(ll) < 4:
        raise FitError("The traced outline collapsed — loosen the fit.")
    g = {"type": "Polygon", "coordinates": [ll]}
    # GeoJSON wants counter-clockwise outer rings
    if geo._ring_area(ll) < 0:
        g["coordinates"][0] = ll[::-1]
    box_px = int(box.sum())
    inter = int((comp & box).sum())
    stats = {
        "target": target, "vertices": len(ll) - 1, "metres_per_pixel": round(mpp, 3),
        "area_m2": round(geo.area_m2(g), 1), "box_area_m2": round(box_px * mpp * mpp, 1),
        "box_coverage_pct": round(100.0 * inter / max(1, box_px), 1),
        "grew_past_box": bool((comp & ~box).sum() > 0.05 * comp.sum()),
        "clipped_by_reach": touches_edge,
        "source": frame.source, "zoom": frame.zoom,
    }
    return g, stats


def frame_for(seed_geometry, seed_props=None, reach_m=None, zoom=None, layer=None, point=None):
    """Imagery covering the seed plus `reach` metres all round."""
    if point:
        lon, lat = point
        r = float(reach_m or 250)
        area = geo.circle_polygon(lon, lat, r, steps=16)
    else:
        bb = geo.bbox(seed_geometry if seed_geometry.get("type") != "Point"
                      else geo.circle_polygon(*seed_geometry["coordinates"], float((seed_props or {}).get("radius") or 20)))
        if not bb:
            raise FitError("That shape has no coordinates.")
        lat = (bb[1] + bb[3]) / 2
        w = geo.haversine([bb[0], lat], [bb[2], lat])
        h = geo.haversine([bb[0], bb[1]], [bb[0], bb[3]])
        r = float(reach_m) if reach_m is not None else max(25.0, 0.5 * max(w, h))
        dlat = r / 111320.0
        dlon = r / (111320.0 * max(0.1, math.cos(math.radians(lat))))
        area = {"type": "Polygon", "coordinates": [[[bb[0] - dlon, bb[1] - dlat], [bb[2] + dlon, bb[1] - dlat],
                                                    [bb[2] + dlon, bb[3] + dlat], [bb[0] - dlon, bb[3] + dlat],
                                                    [bb[0] - dlon, bb[1] - dlat]]]}
    if geo.area_m2(area) > 4e7:
        raise FitError("That's too big to trace in one go — draw a smaller box.")
    if layer is not None:
        return imagery.from_upload(layer, area)
    return imagery.from_tiles(area, zoom=zoom, pad=0)
