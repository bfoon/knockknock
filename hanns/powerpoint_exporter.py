"""Hanns JSON → PowerPoint exporter (v2 — high-fidelity).

The inverse of ``powerpoint_importer.py``. It walks a Deck's slides and their
element JSON ({bg, bgSize, transition, notes, els:[…]}) and writes a .pptx
using python-pptx, keeping the exported file as close as possible to what the
live Hanns stage shows.

What v2 exports beyond the original exporter:

  • Slide backgrounds — solid colours AND real PPTX gradient fills built from
    the deck's CSS gradients (stops + angle), plus full-bleed background
    pictures for ``url(…)`` backgrounds.
  • Text             — top anchor (matches the renderer), line height,
    letter spacing, per-line paragraphs, fonts, bold/italic/colour/align,
    optional box fill.
  • Shapes           — proportional rounded-corner radius, dashed strokes,
    rotation.
  • Images           — ``fit:"contain"`` letterboxes inside the box and
    ``fit:"cover"`` crops, so pictures land exactly like the stage.
  • Tables           — Hanns ``table`` elements become native PPTX tables with
    a styled header row.
  • Charts           — reads the live ``chartKind`` key (``chartType`` kept as
    a fallback), maps bar / horizontal bar / grouped / stacked / line /
    spline / area / pie / donut / scatter, exports EVERY series, applies the
    element palette per-series (and per-point for pie/donut).
  • Links & videos   — become click-to-open shapes with real hyperlinks.
  • Rich elements    — maps / objects / creative shapes export as a styled,
    labelled card rather than disappearing.
  • ANIMATIONS       — every element's Hanns entrance (fade, rise, drop,
    left, right, zoom, pop, blur, reveal, bounce, elastic, flip, spin, skew,
    typewriter, float, …) is written into the slide's native ``<p:timing>``
    tree as the matching PowerPoint entrance effect, preserving each
    element's delay and duration. One click plays the whole build, exactly
    like the Hanns stage.

Design space is 960×540 (16:9), matching the importer's DESIGN_W/H. We render
the PPTX at a real 10in × 5.625in so 1 design px = 1/96 in.
"""

from __future__ import annotations

import io
import re
import os
from urllib.parse import urlparse, unquote

from django.core.files.storage import default_storage

try:  # python-pptx is optional until export is used.
    from pptx import Presentation
    from pptx.util import Emu, Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    from pptx.enum.shapes import MSO_SHAPE
    from pptx.chart.data import CategoryChartData, XyChartData
    from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
    from pptx.oxml import parse_xml
    from pptx.oxml.ns import qn, nsdecls
except Exception:  # pragma: no cover - handled at runtime
    Presentation = None

try:
    from PIL import Image as PILImage
except Exception:  # pragma: no cover
    PILImage = None


DESIGN_W = 960
DESIGN_H = 540

# 960×540 design px → 10in × 5.625in slide. 96 px per inch.
PX_PER_IN = 96.0
EMU_PER_IN = 914400


# ───────────────────────── unit / colour helpers ─────────────────────────

def _px_to_emu(px) -> int:
    try:
        return int(round((float(px) / PX_PER_IN) * EMU_PER_IN))
    except Exception:
        return 0


def _clean_hex(value):
    """Return a 6-char uppercase hex (no #) or None for non-solid colours."""
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in ("none", "transparent"):
        return None
    if "gradient" in s.lower():
        m = re.search(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})", s)
        if not m:
            return None
        s = "#" + m.group(1)
    m = re.match(r"^#?([0-9a-fA-F]{6})$", s)
    if m:
        return m.group(1).upper()
    m = re.match(r"^#?([0-9a-fA-F]{3})$", s)
    if m:
        r, g, b = m.group(1)
        return (r + r + g + g + b + b).upper()
    m = re.match(r"^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)", s)
    if m:
        return "{:02X}{:02X}{:02X}".format(
            min(255, int(m.group(1))), min(255, int(m.group(2))), min(255, int(m.group(3)))
        )
    return None


def _rgb(value, default="000000"):
    hexv = _clean_hex(value) or default
    try:
        return RGBColor.from_string(hexv)
    except Exception:
        return RGBColor.from_string(default)


def _num(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return default


# ───────────────────────── CSS gradient parsing ─────────────────────────

def _split_top_level(css: str) -> list[str]:
    """Split layered CSS backgrounds on top-level commas."""
    parts, depth, cur = [], 0, ""
    for ch in css:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur.strip())
    return parts


_COLOR_STOP_RE = re.compile(
    r"(#[0-9a-fA-F]{3,6}|rgba?\([^)]*\))\s*([0-9.]+%)?"
)


def _parse_css_gradient(css: str):
    """Return (angle_deg, [(pos_0_100, '#RRGGBB'), …]) or None.

    Layered backgrounds pick the LAST layer (the base coat) — that is what
    dominates visually and what a projector fallback should show.
    """
    if not css or "gradient" not in css:
        return None
    layers = [p for p in _split_top_level(css) if "gradient" in p]
    if not layers:
        return None
    layer = layers[-1]

    angle = 135.0
    m = re.search(r"linear-gradient\(\s*([0-9.]+)deg", layer)
    if m:
        angle = float(m.group(1))

    inner = layer[layer.find("(") + 1: layer.rfind(")")]
    stops = []
    for cm in _COLOR_STOP_RE.finditer(inner):
        hexv = _clean_hex(cm.group(1))
        if not hexv:
            continue
        pos = None
        if cm.group(2):
            try:
                pos = float(cm.group(2).rstrip("%"))
            except ValueError:
                pos = None
        stops.append([pos, "#" + hexv])
    if len(stops) < 2:
        return None
    # Fill in missing positions evenly.
    if stops[0][0] is None:
        stops[0][0] = 0.0
    if stops[-1][0] is None:
        stops[-1][0] = 100.0
    known = [i for i, s in enumerate(stops) if s[0] is not None]
    for a, b in zip(known, known[1:]):
        span = stops[b][0] - stops[a][0]
        gap = b - a
        for k in range(a + 1, b):
            stops[k][0] = stops[a][0] + span * (k - a) / gap
    stops = [(max(0.0, min(100.0, p)), c) for p, c in stops]
    stops.sort(key=lambda s: s[0])
    return angle, stops


def _bg_url(css: str) -> str | None:
    m = re.search(r"""url\(\s*['"]?([^'")]+)['"]?\s*\)""", css or "")
    return m.group(1) if m else None


# ───────────────────────── image fetch ─────────────────────────

def _load_image_bytes(src):
    """Return (BytesIO, ext) for an element image src, or (None, None).

    Handles a stored media URL, a bare storage-relative path, or a data: URI.
    Network URLs are intentionally NOT fetched (keeps export hermetic and
    avoids SSRF); unresolved images become a placeholder box instead.
    """
    if not src:
        return None, None
    s = str(src)

    if s.startswith("data:"):
        try:
            import base64
            header, b64 = s.split(",", 1)
            ext = "png"
            m = re.search(r"data:image/(\w+)", header)
            if m:
                ext = m.group(1).lower()
                if ext == "jpeg":
                    ext = "jpg"
            return io.BytesIO(base64.b64decode(b64)), ext
        except Exception:
            return None, None

    path = s
    if s.startswith("http://") or s.startswith("https://"):
        path = unquote(urlparse(s).path)
    for prefix in ("/media/", "media/"):
        idx = path.find(prefix)
        if idx != -1:
            path = path[idx + len(prefix):]
            break
    path = path.lstrip("/")

    ext = (os.path.splitext(path)[1] or ".png").lstrip(".").lower()
    if ext == "jpeg":
        ext = "jpg"

    try:
        if default_storage.exists(path):
            with default_storage.open(path, "rb") as fh:
                return io.BytesIO(fh.read()), ext
    except Exception:
        pass
    return None, None


def _image_size(stream) -> tuple[int, int] | None:
    if PILImage is None or stream is None:
        return None
    try:
        pos = stream.tell()
        img = PILImage.open(stream)
        size = img.size
        stream.seek(pos)
        return size
    except Exception:
        try:
            stream.seek(0)
        except Exception:
            pass
        return None


# ───────────────────────── animation registry ─────────────────────────

class _AnimFx:
    """Collects (shape_id, anim, delay_s, dur_s) per slide, then writes the
    native <p:timing> tree."""

    # Hanns anim → (presetID, presetSubtype, behaviour builder key, default ms)
    MAP = {
        "fade":       (10, 0, "fade", 620),
        "blur":       (10, 0, "fade", 620),
        "rise":       (2, 4, "fly_bottom", 620),
        "float":      (2, 4, "fly_bottom", 760),
        "bounce":     (2, 4, "fly_bottom", 950),
        "drop":       (2, 1, "fly_top", 620),
        "left":       (2, 8, "fly_left", 620),
        "skew":       (2, 8, "fly_left", 620),
        "right":      (2, 2, "fly_right", 620),
        "zoom":       (23, 16, "zoom", 620),
        "pop":        (23, 16, "zoom", 720),
        "elastic":    (23, 16, "zoom", 980),
        "blurzoom":   (23, 16, "zoom", 820),
        "reveal":     (22, 8, "wipe_left", 620),
        "typewriter": (22, 8, "wipe_left", 900),
        "revealUp":   (22, 4, "wipe_up", 620),
        "spin":       (21, 1, "spin", 760),
        "flipx":      (19, 0, "flip_x", 680),
        "flipy":      (19, 0, "flip_y", 680),
    }

    def __init__(self):
        self.effects: list[tuple[int, str, float, float]] = []
        self._id = 2  # 1=tmRoot, 2=mainSeq

    def register(self, shape, el):
        anim = str(el.get("anim") or "none")
        if anim == "none" or anim not in self.MAP:
            return
        spid = getattr(shape, "shape_id", None)
        if spid is None:
            try:
                spid = int(shape._element.nvSpPr.cNvPr.get("id"))
            except Exception:
                return
        delay = max(0.0, _num(el.get("animDelay"), 0.0))
        dur = _num(el.get("animDur"), 0.0)
        if dur <= 0:
            dur = self.MAP[anim][3] / 1000.0
        self.effects.append((int(spid), anim, delay, dur))

    # ── XML builders ──
    def _nid(self) -> int:
        self._id += 1
        return self._id

    def _bhv_fade(self, spid, dur):
        return (
            f'<p:animEffect transition="in" filter="fade">'
            f'<p:cBhvr><p:cTn id="{self._nid()}" dur="{dur}"/>'
            f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cBhvr></p:animEffect>'
        )

    def _bhv_wipe(self, spid, dur, direction):
        return (
            f'<p:animEffect transition="in" filter="wipe({direction})">'
            f'<p:cBhvr><p:cTn id="{self._nid()}" dur="{dur}"/>'
            f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cBhvr></p:animEffect>'
        )

    def _bhv_anim_var(self, spid, dur, attr, frm):
        return (
            f'<p:anim calcmode="lin" valueType="num">'
            f'<p:cBhvr additive="base"><p:cTn id="{self._nid()}" dur="{dur}" fill="hold"/>'
            f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>'
            f'<p:attrNameLst><p:attrName>{attr}</p:attrName></p:attrNameLst></p:cBhvr>'
            f'<p:tavLst>'
            f'<p:tav tm="0"><p:val><p:strVal val="{frm}"/></p:val></p:tav>'
            f'<p:tav tm="100000"><p:val><p:strVal val="#{attr}"/></p:val></p:tav>'
            f'</p:tavLst></p:anim>'
        )

    def _bhv_fly(self, spid, dur, direction):
        if direction == "bottom":
            return (self._bhv_anim_var(spid, dur, "ppt_x", "#ppt_x")
                    + self._bhv_anim_var(spid, dur, "ppt_y", "1+#ppt_h/2"))
        if direction == "top":
            return (self._bhv_anim_var(spid, dur, "ppt_x", "#ppt_x")
                    + self._bhv_anim_var(spid, dur, "ppt_y", "0-#ppt_h/2"))
        if direction == "left":
            return (self._bhv_anim_var(spid, dur, "ppt_x", "0-#ppt_w/2")
                    + self._bhv_anim_var(spid, dur, "ppt_y", "#ppt_y"))
        return (self._bhv_anim_var(spid, dur, "ppt_x", "1+#ppt_w/2")
                + self._bhv_anim_var(spid, dur, "ppt_y", "#ppt_y"))

    def _bhv_scale(self, spid, dur, fx, fy):
        return (
            f'<p:animScale><p:cBhvr><p:cTn id="{self._nid()}" dur="{dur}" fill="hold"/>'
            f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cBhvr>'
            f'<p:from x="{fx}" y="{fy}"/><p:to x="100000" y="100000"/></p:animScale>'
        )

    def _bhv_spin(self, spid, dur):
        return (
            f'<p:animRot by="21600000"><p:cBhvr><p:cTn id="{self._nid()}" dur="{dur}" fill="hold"/>'
            f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>'
            f'<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>'
        )

    def _behaviours(self, key, spid, dur):
        if key == "fade":
            return self._bhv_fade(spid, dur)
        if key == "fly_bottom":
            return self._bhv_fade(spid, dur) + self._bhv_fly(spid, dur, "bottom")
        if key == "fly_top":
            return self._bhv_fade(spid, dur) + self._bhv_fly(spid, dur, "top")
        if key == "fly_left":
            return self._bhv_fade(spid, dur) + self._bhv_fly(spid, dur, "left")
        if key == "fly_right":
            return self._bhv_fade(spid, dur) + self._bhv_fly(spid, dur, "right")
        if key == "zoom":
            return self._bhv_fade(spid, dur) + self._bhv_scale(spid, dur, 10000, 10000)
        if key == "wipe_left":
            return self._bhv_wipe(spid, dur, "left")
        if key == "wipe_up":
            return self._bhv_wipe(spid, dur, "up")
        if key == "spin":
            return self._bhv_fade(spid, dur) + self._bhv_spin(spid, dur)
        if key == "flip_x":
            return self._bhv_fade(spid, dur) + self._bhv_scale(spid, dur, 1000, 100000)
        if key == "flip_y":
            return self._bhv_fade(spid, dur) + self._bhv_scale(spid, dur, 100000, 1000)
        return self._bhv_fade(spid, dur)

    def apply(self, slide):
        """Append the <p:timing> tree to ``slide`` (a python-pptx Slide)."""
        if not self.effects:
            return
        effect_xml = []
        for i, (spid, anim, delay, dur_s) in enumerate(self.effects):
            preset_id, subtype, key, _default = self.MAP[anim]
            dur = max(1, int(round(dur_s * 1000)))
            delay_ms = max(0, int(round(delay * 1000)))
            node_type = "clickEffect" if i == 0 else "withEffect"
            ctn_id = self._nid()
            set_id = self._nid()
            effect_xml.append(
                f'<p:par><p:cTn id="{ctn_id}" presetID="{preset_id}" presetClass="entr" '
                f'presetSubtype="{subtype}" fill="hold" grpId="0" nodeType="{node_type}">'
                f'<p:stCondLst><p:cond delay="{delay_ms}"/></p:stCondLst>'
                f'<p:childTnLst>'
                f'<p:set><p:cBhvr><p:cTn id="{set_id}" dur="1" fill="hold">'
                f'<p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>'
                f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>'
                f'<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>'
                f'</p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>'
                f'{self._behaviours(key, spid, dur)}'
                f'</p:childTnLst></p:cTn></p:par>'
            )
        bld = "".join(
            f'<p:bldP spid="{spid}" grpId="0"/>'
            for spid in {e[0] for e in self.effects}
        )
        xml = (
            f'<p:timing {nsdecls("p", "a")}>'
            f'<p:tnLst><p:par>'
            f'<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
            f'<p:seq concurrent="1" nextAc="seek">'
            f'<p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>'
            f'<p:par><p:cTn id="{self._nid()}" fill="hold">'
            f'<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>'
            f'<p:par><p:cTn id="{self._nid()}" fill="hold">'
            f'<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
            f'{"".join(effect_xml)}'
            f'</p:childTnLst></p:cTn></p:par>'
            f'</p:childTnLst></p:cTn></p:par>'
            f'</p:childTnLst></p:cTn>'
            f'<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>'
            f'<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>'
            f'</p:seq>'
            f'</p:childTnLst></p:cTn>'
            f'</p:par></p:tnLst>'
            f'<p:bldLst>{bld}</p:bldLst>'
            f'</p:timing>'
        )
        try:
            slide._element.append(parse_xml(xml))
        except Exception:
            pass  # timing is a bonus — never abort the export over it


# ───────────────────────── element renderers ─────────────────────────

def _css_font_to_name(css):
    """'"Inter",sans-serif' → 'Inter'."""
    if not css:
        return None
    first = str(css).split(",")[0].strip().strip('"').strip("'")
    return first or None


def _set_letter_spacing(run, px):
    """Letter spacing: Hanns stores px, PPTX wants 1/100 pt on <a:rPr spc>."""
    try:
        pts = float(px) / 1.333
        run.font._rPr.set("spc", str(int(round(pts * 100))))
    except Exception:
        pass


def _add_text(slide, el):
    box = slide.shapes.add_textbox(
        _px_to_emu(el.get("x", 0)), _px_to_emu(el.get("y", 0)),
        _px_to_emu(max(8, el.get("w", 100))), _px_to_emu(max(8, el.get("h", 40))),
    )
    tf = box.text_frame
    tf.word_wrap = True
    try:
        # The Hanns renderer top-aligns text inside its box.
        tf.vertical_anchor = MSO_ANCHOR.TOP
        tf.margin_left = tf.margin_right = Emu(int(0.02 * EMU_PER_IN))
        tf.margin_top = tf.margin_bottom = Emu(int(0.01 * EMU_PER_IN))
    except Exception:
        pass

    fill_hex = _clean_hex(el.get("fill"))
    if fill_hex:
        try:
            box.fill.solid()
            box.fill.fore_color.rgb = RGBColor.from_string(fill_hex)
            box.line.fill.background()
        except Exception:
            pass

    text = str(el.get("text", "") or "")
    lines = text.split("\n")
    align = {"center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}.get(
        str(el.get("align", "left")).lower(), PP_ALIGN.LEFT
    )
    size_pt = max(6, int(round(_num(el.get("size", 24), 24) / 1.333)))
    color = _rgb(el.get("color", "#16140f"), "16140F")
    bold = _num(el.get("weight", 500), 500) >= 600
    italic = bool(el.get("italic", False))
    font_name = _css_font_to_name(el.get("font"))
    lh = _num(el.get("lh", 1.15), 1.15)
    ls = _num(el.get("ls", 0), 0)

    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        try:
            p.line_spacing = max(0.5, min(3.0, lh))
        except Exception:
            pass
        run = p.add_run()
        run.text = line
        f = run.font
        f.size = Pt(size_pt)
        f.bold = bold
        f.italic = italic
        f.color.rgb = color
        if font_name:
            f.name = font_name
        if ls:
            _set_letter_spacing(run, ls)
    rot = _num(el.get("rot", 0), 0)
    if rot:
        box.rotation = rot
    return box


def _add_image(slide, el):
    stream, _ext = _load_image_bytes(el.get("src"))
    x, y = _px_to_emu(el.get("x", 0)), _px_to_emu(el.get("y", 0))
    w, h = _px_to_emu(max(8, el.get("w", 100))), _px_to_emu(max(8, el.get("h", 100)))
    fit = str(el.get("fit", "cover")).lower()

    if stream is not None:
        try:
            size = _image_size(stream)
            if size and fit == "contain":
                iw, ih = size
                scale = min(w / iw, h / ih)
                dw, dh = int(iw * scale), int(ih * scale)
                pic = slide.shapes.add_picture(
                    stream, x + (w - dw) // 2, y + (h - dh) // 2, width=dw, height=dh
                )
            else:
                pic = slide.shapes.add_picture(stream, x, y, width=w, height=h)
                if size and fit == "cover":
                    iw, ih = size
                    box_ar, img_ar = w / h, iw / ih
                    if img_ar > box_ar:      # image too wide → crop sides
                        crop = (1 - box_ar / img_ar) / 2
                        pic.crop_left = crop
                        pic.crop_right = crop
                    elif img_ar < box_ar:    # image too tall → crop top/bottom
                        crop = (1 - img_ar / box_ar) / 2
                        pic.crop_top = crop
                        pic.crop_bottom = crop
            rot = _num(el.get("rot", 0), 0)
            if rot:
                pic.rotation = rot
            return pic
        except Exception:
            pass

    # Placeholder when the image couldn't be resolved.
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    shp.fill.solid()
    shp.fill.fore_color.rgb = RGBColor.from_string("E7E8D1")
    shp.line.color.rgb = RGBColor.from_string("B85042")
    tf = shp.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = "Image"
    r.font.size = Pt(12)
    r.font.color.rgb = RGBColor.from_string("6B6354")
    return shp


def _set_rounded_radius(shp, radius_px, box_h_px):
    """Match the CSS px radius: adjustment ≈ radius / (shorter side / 2)."""
    try:
        frac = max(0.0, min(0.5, float(radius_px) / max(1.0, float(box_h_px))))
        shp.adjustments[0] = frac
    except Exception:
        pass


def _set_dashed(shp):
    try:
        ln = shp.line._get_or_add_ln()
        dash = ln.find(qn("a:prstDash"))
        if dash is None:
            dash = parse_xml(f'<a:prstDash {nsdecls("a")} val="dash"/>')
            ln.append(dash)
        else:
            dash.set("val", "dash")
    except Exception:
        pass


def _add_shape(slide, el, kind):
    x, y = _px_to_emu(el.get("x", 0)), _px_to_emu(el.get("y", 0))
    w, h = _px_to_emu(max(4, el.get("w", 40))), _px_to_emu(max(4, el.get("h", 40)))
    radius = _num(el.get("radius", 0), 0)
    if kind == "ellipse":
        auto = MSO_SHAPE.OVAL
    elif radius > 0:
        auto = MSO_SHAPE.ROUNDED_RECTANGLE
    else:
        auto = MSO_SHAPE.RECTANGLE
    shp = slide.shapes.add_shape(auto, x, y, w, h)
    if auto == MSO_SHAPE.ROUNDED_RECTANGLE:
        _set_rounded_radius(shp, radius, min(_num(el.get("w", 40)), _num(el.get("h", 40))))

    fill_hex = _clean_hex(el.get("fill"))
    if fill_hex:
        shp.fill.solid()
        shp.fill.fore_color.rgb = RGBColor.from_string(fill_hex)
    else:
        shp.fill.background()

    stroke_hex = _clean_hex(el.get("stroke"))
    stroke_w = _num(el.get("strokeW", 0), 0)
    if stroke_hex and stroke_w > 0:
        shp.line.color.rgb = RGBColor.from_string(stroke_hex)
        shp.line.width = Pt(max(0.5, stroke_w / 1.333))
        if el.get("dashed"):
            _set_dashed(shp)
    else:
        shp.line.fill.background()

    rot = _num(el.get("rot", 0), 0)
    if rot:
        shp.rotation = rot

    txt = el.get("text")
    if txt:
        tf = shp.text_frame
        tf.word_wrap = True
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = str(txt)
        r.font.size = Pt(max(8, int(round(_num(el.get("size", 18), 18) / 1.333))))
        r.font.color.rgb = _rgb(el.get("color", "#16140f"), "16140F")
    return shp


def _add_line(slide, el):
    """Lines are stored as a thin box; draw a real PPTX connector."""
    x = _px_to_emu(el.get("x", 0))
    y = _px_to_emu(el.get("y", 0))
    w = _px_to_emu(max(2, el.get("w", 100)))
    h = _px_to_emu(max(1, el.get("h", 2)))
    try:
        from pptx.enum.shapes import MSO_CONNECTOR
        vertical = _num(el.get("h", 2)) > _num(el.get("w", 100))
        if vertical:
            conn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, x + w // 2, y, x + w // 2, y + h)
            width_pt = max(0.75, _num(el.get("w", 2)) / 1.333)
        else:
            conn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, x, y + h // 2, x + w, y + h // 2)
            width_pt = max(0.75, _num(el.get("h", 2)) / 1.333)
        conn.line.color.rgb = _rgb(el.get("fill", "#16140f"), "16140F")
        conn.line.width = Pt(min(20.0, width_pt))
        if el.get("dashed"):
            _set_dashed(conn)
        return conn
    except Exception:
        pass
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, max(_px_to_emu(2), h))
    shp.fill.solid()
    shp.fill.fore_color.rgb = _rgb(el.get("fill", "#16140f"), "16140F")
    shp.line.fill.background()
    return shp


# ───────────────────────── tables ─────────────────────────

def _add_table(slide, el):
    data = el.get("tableData") or []
    data = [r for r in data if isinstance(r, (list, tuple))]
    if not data:
        return None
    rows = len(data)
    cols = max(len(r) for r in data)
    x, y = _px_to_emu(el.get("x", 0)), _px_to_emu(el.get("y", 0))
    w, h = _px_to_emu(max(60, el.get("w", 400))), _px_to_emu(max(40, el.get("h", 200)))

    gframe = slide.shapes.add_table(rows, cols, x, y, w, h)
    tbl = gframe.table
    accent = _clean_hex(el.get("accent")) or "1D4E89"
    size_pt = max(8, int(round(_num(el.get("size", 18), 18) / 1.333)))
    font_name = _css_font_to_name(el.get("font")) or "Archivo"
    header = el.get("header", True)

    for r in range(rows):
        row_data = data[r]
        for c in range(cols):
            cell = tbl.cell(r, c)
            cell.text = str(row_data[c]) if c < len(row_data) else ""
            para = cell.text_frame.paragraphs[0]
            for run in (para.runs or [para.add_run()]):
                run.font.size = Pt(size_pt)
                run.font.name = font_name
                if r == 0 and header:
                    run.font.bold = True
                    run.font.color.rgb = RGBColor.from_string("FFFFFF")
            if r == 0 and header:
                cell.fill.solid()
                cell.fill.fore_color.rgb = RGBColor.from_string(accent)
            elif r % 2 == 0:
                cell.fill.solid()
                cell.fill.fore_color.rgb = RGBColor.from_string("F4F6F8")
    return gframe


# ───────────────────────── charts ─────────────────────────

_KIND_TO_XL = {
    "bar": "COLUMN_CLUSTERED",
    "column": "COLUMN_CLUSTERED",
    "horizontalbar": "BAR_CLUSTERED",
    "groupedbar": "COLUMN_CLUSTERED",
    "stackedbar": "COLUMN_STACKED",
    "pie": "PIE",
    "donut": "DOUGHNUT",
    "doughnut": "DOUGHNUT",
    "line": "LINE_MARKERS",
    "spline": "LINE_MARKERS",
    "area": "AREA",
    "radar": "RADAR",
    "scatter": "XY_SCATTER",
    "bubble": "XY_SCATTER",
    # Kinds with no PPTX equivalent degrade to a clustered column chart so
    # the data itself always survives the export.
    "gauge": "DOUGHNUT",
    "progress": "BAR_CLUSTERED",
    "funnel": "BAR_CLUSTERED",
    "waterfall": "COLUMN_CLUSTERED",
    "heatmap": "COLUMN_CLUSTERED",
    "treemap": "COLUMN_CLUSTERED",
    "kpi": "COLUMN_CLUSTERED",
}


def _chart_series(el):
    """Return (categories, [(name, values), …]) from the element's data."""
    data = el.get("chartData") or []
    cats, base_vals = [], []
    extra_cols: dict[int, list] = {}
    for row in data:
        if not isinstance(row, dict):
            continue
        cats.append(str(row.get("label", "")))
        base_vals.append(_num(row.get("value", 0), 0))
        for key, val in row.items():
            m = re.match(r"^value(\d+)$", str(key))
            if m:
                extra_cols.setdefault(int(m.group(1)), []).append(_num(val, 0))
    if not cats:
        cats, base_vals = ["A", "B"], [1, 1]

    names = el.get("seriesNames") or []
    series = [(str(names[0]) if names else str(el.get("title") or "Series 1"), base_vals)]
    for idx in sorted(extra_cols):
        vals = extra_cols[idx]
        vals += [0] * (len(cats) - len(vals))
        label = str(names[idx - 1]) if len(names) >= idx else f"Series {idx}"
        series.append((label, vals[: len(cats)]))
    return cats, series


def _add_chart(slide, el):
    kind = str(el.get("chartKind") or el.get("chartType") or "bar").lower()
    xl_name = _KIND_TO_XL.get(kind, "COLUMN_CLUSTERED")
    xl_type = getattr(XL_CHART_TYPE, xl_name, XL_CHART_TYPE.COLUMN_CLUSTERED)

    cats, series = _chart_series(el)
    chart_data = CategoryChartData()
    chart_data.categories = cats
    for name, vals in series:
        chart_data.add_series(name, vals)

    x, y = _px_to_emu(el.get("x", 0)), _px_to_emu(el.get("y", 0))
    w, h = _px_to_emu(max(80, el.get("w", 320))), _px_to_emu(max(80, el.get("h", 220)))

    try:
        gframe = slide.shapes.add_chart(xl_type, x, y, w, h, chart_data)
        chart = gframe.chart

        multi = len(series) > 1
        chart.has_legend = bool(el.get("showLegend", multi) or kind in ("pie", "donut", "doughnut"))
        if chart.has_legend:
            try:
                chart.legend.position = XL_LEGEND_POSITION.BOTTOM
                chart.legend.include_in_layout = False
            except Exception:
                pass

        if el.get("title"):
            try:
                chart.has_title = True
                chart.chart_title.text_frame.text = str(el.get("title"))
            except Exception:
                pass

        if el.get("showValues", True):
            try:
                plot = chart.plots[0]
                plot.has_data_labels = True
                plot.data_labels.number_format = "0.##"
                plot.data_labels.number_format_is_linked = False
            except Exception:
                pass

        palette = [
            _clean_hex(c) for c in (el.get("palette") or [])
            if _clean_hex(c)
        ] or [c for c in [_clean_hex(el.get("accent"))] if c]
        if palette:
            try:
                if kind in ("pie", "donut", "doughnut") and chart.series:
                    # Colour each slice from the palette.
                    s0 = chart.series[0]
                    for i, point in enumerate(s0.points):
                        point.format.fill.solid()
                        point.format.fill.fore_color.rgb = RGBColor.from_string(
                            palette[i % len(palette)]
                        )
                else:
                    for i, s in enumerate(chart.series):
                        s.format.fill.solid()
                        s.format.fill.fore_color.rgb = RGBColor.from_string(
                            palette[i % len(palette)]
                        )
            except Exception:
                pass
        return gframe
    except Exception:
        return _add_shape(slide, {**el, "type": "rect", "fill": "#ECE4D4",
                                  "text": (el.get("title") or "Chart")}, "rect")


# ───────────────────────── links / video / rich placeholders ─────────────

def _add_hyperlink_card(slide, el, *, label, sub, url, fill, text_color):
    x, y = _px_to_emu(el.get("x", 0)), _px_to_emu(el.get("y", 0))
    w, h = _px_to_emu(max(40, el.get("w", 200))), _px_to_emu(max(24, el.get("h", 60)))
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    _set_rounded_radius(shp, _num(el.get("radius", 18), 18),
                        min(_num(el.get("w", 200)), _num(el.get("h", 60))))
    shp.fill.solid()
    shp.fill.fore_color.rgb = _rgb(fill, "2563EB")
    shp.line.fill.background()
    tf = shp.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = str(label or "Open link")
    r.font.bold = True
    r.font.size = Pt(16)
    r.font.color.rgb = _rgb(text_color, "FFFFFF")
    if url:
        try:
            r.hyperlink.address = str(url)
        except Exception:
            pass
    if sub:
        p2 = tf.add_paragraph()
        p2.alignment = PP_ALIGN.CENTER
        r2 = p2.add_run()
        r2.text = str(sub)[:80]
        r2.font.size = Pt(10)
        r2.font.color.rgb = _rgb(text_color, "FFFFFF")
    return shp


def _add_link(slide, el):
    return _add_hyperlink_card(
        slide, el,
        label=el.get("label") or "Open link",
        sub=el.get("description") or el.get("url") or "",
        url=el.get("url"),
        fill=el.get("bg") or el.get("accent") or "#2563eb",
        text_color=el.get("textColor") or "#ffffff",
    )


def _add_video(slide, el):
    return _add_hyperlink_card(
        slide, el,
        label="▶ " + (str(el.get("title") or "Play video")),
        sub=el.get("src") or "",
        url=el.get("src"),
        fill="#0f172a",
        text_color="#ffffff",
    )


def _add_rich_placeholder(slide, el, kind_label):
    """Maps / objects / creative shapes: a styled labelled card so nothing
    silently vanishes from the exported deck."""
    label = (el.get("title") or el.get("label") or el.get("statTitle")
             or el.get("nodeTitle") or kind_label)
    shp = _add_shape(slide, {
        **el, "type": "rect",
        "fill": el.get("fill") if _clean_hex(el.get("fill")) else "#F1F5F9",
        "stroke": el.get("accent") or "#94A3B8", "strokeW": 1.5,
        "radius": 18, "text": f"{label}",
        "color": "#0F172A", "size": 20,
    }, "rect")
    return shp


# ───────────────────────── slide background ─────────────────────────

def _set_gradient_bg(slide, angle_deg, stops):
    """Write a real <a:gradFill> background from parsed CSS stops."""
    try:
        gs_xml = "".join(
            f'<a:gs pos="{int(round(p * 1000))}"><a:srgbClr val="{_clean_hex(c)}"/></a:gs>'
            for p, c in stops if _clean_hex(c)
        )
        # CSS angle is clockwise from 12 o'clock; PPTX from 3 o'clock (60000ths).
        ppt_ang = int(round(((angle_deg - 90) % 360) * 60000))
        bg_xml = (
            f'<p:bg {nsdecls("p", "a")}><p:bgPr>'
            f'<a:gradFill rotWithShape="1"><a:gsLst>{gs_xml}</a:gsLst>'
            f'<a:lin ang="{ppt_ang}" scaled="1"/></a:gradFill>'
            f'<a:effectLst/></p:bgPr></p:bg>'
        )
        cSld = slide._element.find(qn("p:cSld"))
        old = cSld.find(qn("p:bg"))
        if old is not None:
            cSld.remove(old)
        cSld.insert(0, parse_xml(bg_xml))
        return True
    except Exception:
        return False


def _set_slide_bg(slide, slide_data):
    bg = str(slide_data.get("bg") or "")

    # 1) Full-bleed background picture.
    url = _bg_url(bg)
    if url:
        stream, _ext = _load_image_bytes(url)
        if stream is not None:
            try:
                slide.shapes.add_picture(stream, 0, 0,
                                         width=_px_to_emu(DESIGN_W),
                                         height=_px_to_emu(DESIGN_H))
                return
            except Exception:
                pass

    # 2) Real gradient fill.
    grad = _parse_css_gradient(bg)
    if grad and _set_gradient_bg(slide, grad[0], grad[1]):
        return

    # 3) Solid colour (or first colour of an unparseable gradient).
    hexv = _clean_hex(bg)
    if not hexv:
        return
    try:
        b = slide.background
        b.fill.solid()
        b.fill.fore_color.rgb = RGBColor.from_string(hexv)
    except Exception:
        pass


def _set_notes(slide, slide_data):
    parts = []
    if slide_data.get("notes"):
        parts.append(str(slide_data["notes"]))
    transition = slide_data.get("transition")
    if transition and str(transition).lower() not in ("", "none", "fade"):
        parts.append(f"[Hanns transition: {transition}]")
    if not parts:
        return
    try:
        slide.notes_slide.notes_text_frame.text = "\n\n".join(parts)
    except Exception:
        pass


# ───────────────────────── element dispatch ─────────────────────────

def _render_element(slide, el, fx: _AnimFx):
    """Render one element and register its entrance animation."""
    etype = str(el.get("type", "")).lower()
    shp = None
    if etype == "text":
        shp = _add_text(slide, el)
    elif etype == "image":
        shp = _add_image(slide, el)
    elif etype in ("rect", "rectangle"):
        shp = _add_shape(slide, el, "rect")
    elif etype == "ellipse":
        shp = _add_shape(slide, el, "ellipse")
    elif etype == "line":
        shp = _add_line(slide, el)
    elif etype == "chart":
        shp = _add_chart(slide, el)
    elif etype == "table":
        shp = _add_table(slide, el)
    elif etype == "link":
        shp = _add_link(slide, el)
    elif etype == "video":
        shp = _add_video(slide, el)
    elif etype == "map":
        shp = _add_rich_placeholder(slide, el, "Map")
    elif etype == "object":
        shp = _add_rich_placeholder(slide, el, "Infographic")
    elif etype == "creative_shape":
        shp = _add_shape(slide, {**el, "type": "ellipse", "radius": 0}, "ellipse")
    elif etype == "group":
        # Children are stored in slide coordinates offset by the group box.
        gx, gy = _num(el.get("x", 0)), _num(el.get("y", 0))
        for child in (el.get("children") or []):
            if not isinstance(child, dict):
                continue
            shifted = dict(child)
            shifted["x"] = _num(child.get("x", 0)) + gx
            shifted["y"] = _num(child.get("y", 0)) + gy
            # Group-level animation applies to each child.
            if el.get("anim") and el.get("anim") != "none":
                shifted.setdefault("anim", el.get("anim"))
                shifted.setdefault("animDelay", el.get("animDelay", 0))
            _render_element(slide, shifted, fx)
        return
    else:
        if el.get("text"):
            shp = _add_text(slide, {**el, "type": "text"})

    if shp is not None:
        fx.register(shp, el)


# ───────────────────────── public API ─────────────────────────

def export_deck_to_pptx(deck) -> io.BytesIO:
    """Build a .pptx for ``deck`` and return it as an in-memory BytesIO."""
    if Presentation is None:
        raise ValueError(
            "python-pptx is not installed. Add python-pptx to requirements.txt and rebuild."
        )

    prs = Presentation()
    prs.slide_width = Emu(_px_to_emu(DESIGN_W))
    prs.slide_height = Emu(_px_to_emu(DESIGN_H))
    blank = prs.slide_layouts[6]  # fully blank layout

    slides = list(deck.slides.all())
    if not slides:
        prs.slides.add_slide(blank)

    for srow in slides:
        data = srow.as_dict() if hasattr(srow, "as_dict") else dict(srow.data or {})
        slide = prs.slides.add_slide(blank)
        _set_slide_bg(slide, data)

        fx = _AnimFx()
        # PPTX z-order is document order, and Hanns paints elements in array
        # order — so exporting in the SAME order keeps stacking identical to
        # the live stage.
        for el in (data.get("els") or []):
            try:
                _render_element(slide, el, fx)
            except Exception:
                # One bad element must never abort the whole export.
                continue

        fx.apply(slide)
        _set_notes(slide, data)

    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)
    return buf


def export_filename(deck) -> str:
    base = re.sub(r"[^A-Za-z0-9 _-]+", "", (deck.title or "deck")).strip() or "deck"
    return f"{base}.pptx"