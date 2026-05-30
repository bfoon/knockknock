"""Hanns JSON → PowerPoint exporter.

The inverse of ``powerpoint_importer.py``. It walks a Deck's slides and their
element JSON ({bg, bgSize, transition, notes, els:[…]}) and writes a .pptx
using python-pptx — the same library the importer uses, so the coordinate
math and colour handling stay consistent.

Element types handled (mirrors the importer):
  • text      → text box with font / size / weight / italic / colour / align
  • image     → picture (fetched from its stored URL / media path)
  • rect      → rounded rectangle (or plain rect when radius == 0)
  • ellipse   → oval
  • line      → thin filled connector-style rectangle
  • chart     → native PPTX bar/column/pie chart from chartData
  • (unknown) → best-effort text box of any ``text`` field, else skipped

Slide-level:
  • bg        → solid fill (hex) or first colour of a CSS gradient
  • notes     → speaker-notes slide
  • transition→ recorded in notes (PPTX transitions aren't exposed by
                python-pptx; we preserve intent rather than drop it silently)

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
    from pptx.chart.data import CategoryChartData
    from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
    from pptx.oxml.ns import qn
except Exception:  # pragma: no cover - handled at runtime
    Presentation = None


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
    # CSS gradient → grab its first hex colour so the slide isn't blank.
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
    # rgb()/rgba()
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


# ───────────────────────── image fetch ─────────────────────────

def _load_image_bytes(src):
    """Return (BytesIO, ext) for an element image src, or (None, None).

    Handles three shapes of src:
      • a stored media URL (……/media/<path>) → resolve via default_storage
      • a bare storage-relative path           → default_storage.open
      • a data: URI                            → decode inline base64
    Network URLs are intentionally NOT fetched (keeps export hermetic and
    avoids SSRF); unresolved images become a placeholder box instead.
    """
    if not src:
        return None, None
    s = str(src)

    # data: URI
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

    # Strip a leading domain + /media/ to get the storage-relative path.
    path = s
    if s.startswith("http://") or s.startswith("https://"):
        path = unquote(urlparse(s).path)
    # Common Django MEDIA_URL prefixes.
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


# ───────────────────────── element renderers ─────────────────────────

def _add_text(slide, el):
    box = slide.shapes.add_textbox(
        _px_to_emu(el.get("x", 0)), _px_to_emu(el.get("y", 0)),
        _px_to_emu(max(8, el.get("w", 100))), _px_to_emu(max(8, el.get("h", 40))),
    )
    tf = box.text_frame
    tf.word_wrap = True
    try:
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    except Exception:
        pass
    # Optional background fill behind the text.
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
    size_pt = max(6, int(round(_num(el.get("size", 24), 24) / 1.333)))  # px → pt (inverse of importer)
    color = _rgb(el.get("color", "#16140f"), "16140F")
    weight = _num(el.get("weight", 500), 500)
    bold = weight >= 600
    italic = bool(el.get("italic", False))
    font_name = _css_font_to_name(el.get("font"))

    for i, line in enumerate(lines):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        run = p.add_run()
        run.text = line
        f = run.font
        f.size = Pt(size_pt)
        f.bold = bold
        f.italic = italic
        f.color.rgb = color
        if font_name:
            f.name = font_name
    return box


def _css_font_to_name(css):
    """'"Inter",sans-serif' → 'Inter'."""
    if not css:
        return None
    first = str(css).split(",")[0].strip().strip('"').strip("'")
    return first or None


def _add_image(slide, el):
    stream, _ext = _load_image_bytes(el.get("src"))
    x, y = _px_to_emu(el.get("x", 0)), _px_to_emu(el.get("y", 0))
    w, h = _px_to_emu(max(8, el.get("w", 100))), _px_to_emu(max(8, el.get("h", 100)))
    if stream is not None:
        try:
            slide.shapes.add_picture(stream, x, y, width=w, height=h)
            return
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
    r.text = el.get("alt") or "Image"
    r.font.size = Pt(12)
    r.font.color.rgb = RGBColor.from_string("7A6F57")


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
    else:
        shp.line.fill.background()

    # Apply rotation if present.
    rot = _num(el.get("rot", 0), 0)
    if rot:
        shp.rotation = rot

    # Any text on the shape.
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


def _add_line(slide, el):
    """Lines are stored as a thin box; draw a real PPTX connector."""
    x = _px_to_emu(el.get("x", 0))
    y = _px_to_emu(el.get("y", 0))
    w = _px_to_emu(max(2, el.get("w", 100)))
    h = _px_to_emu(max(1, el.get("h", 2)))
    try:
        from pptx.enum.shapes import MSO_CONNECTOR
        conn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, x, y, x + w, y + h)
        conn.line.color.rgb = _rgb(el.get("fill", "#16140f"), "16140F")
        conn.line.width = Pt(max(0.75, _num(el.get("strokeW", 2), 2) / 1.333))
        return
    except Exception:
        pass
    # Fallback: thin filled rectangle.
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, max(_px_to_emu(2), h))
    shp.fill.solid()
    shp.fill.fore_color.rgb = _rgb(el.get("fill", "#16140f"), "16140F")
    shp.line.fill.background()


_CHART_TYPE_MAP = {
    "bar": "BAR_CLUSTERED",
    "column": "COLUMN_CLUSTERED",
    "pie": "PIE",
    "donut": "DOUGHNUT",
    "doughnut": "DOUGHNUT",
    "line": "LINE",
    "area": "AREA",
}


def _add_chart(slide, el):
    data = el.get("chartData") or []
    cats, vals = [], []
    for row in data:
        if isinstance(row, dict):
            cats.append(str(row.get("label", "")))
            vals.append(_num(row.get("value", 0), 0))
    if not cats:
        cats, vals = ["A", "B"], [1, 1]

    chart_data = CategoryChartData()
    chart_data.categories = cats
    chart_data.add_series(str(el.get("title") or "Series 1"), vals)

    xl_name = _CHART_TYPE_MAP.get(str(el.get("chartType", "bar")).lower(), "BAR_CLUSTERED")
    xl_type = getattr(XL_CHART_TYPE, xl_name, XL_CHART_TYPE.COLUMN_CLUSTERED)

    x, y = _px_to_emu(el.get("x", 0)), _px_to_emu(el.get("y", 0))
    w, h = _px_to_emu(max(80, el.get("w", 320))), _px_to_emu(max(80, el.get("h", 220)))

    try:
        gframe = slide.shapes.add_chart(xl_type, x, y, w, h, chart_data)
        chart = gframe.chart
        chart.has_legend = bool(el.get("showLabels", True))
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
        # Data labels (value on bars).
        if el.get("showValues", True):
            try:
                plot = chart.plots[0]
                plot.has_data_labels = True
                plot.data_labels.number_format = "0"
                plot.data_labels.number_format_is_linked = False
            except Exception:
                pass
        # Accent colour on the series.
        accent = _clean_hex(el.get("accent"))
        if accent:
            try:
                for series in chart.series:
                    series.format.fill.solid()
                    series.format.fill.fore_color.rgb = RGBColor.from_string(accent)
            except Exception:
                pass
    except Exception:
        # If the chart can't be built, leave a labelled placeholder box.
        _add_shape(slide, {**el, "type": "rect", "fill": "#ECE4D4",
                           "text": (el.get("title") or "Chart")}, "rect")


# ───────────────────────── slide background ─────────────────────────

def _set_slide_bg(slide, slide_data):
    hexv = _clean_hex(slide_data.get("bg"))
    if not hexv:
        return
    try:
        bg = slide.background
        bg.fill.solid()
        bg.fill.fore_color.rgb = RGBColor.from_string(hexv)
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


# ───────────────────────── ordering ─────────────────────────

# Render order so fills/shapes sit behind text & images.
_Z_ORDER = {"rect": 0, "ellipse": 0, "line": 1, "image": 2, "chart": 2, "text": 3}


def _render_element(slide, el):
    etype = str(el.get("type", "")).lower()
    if etype == "text":
        _add_text(slide, el)
    elif etype == "image":
        _add_image(slide, el)
    elif etype in ("rect", "rectangle"):
        _add_shape(slide, el, "rect")
    elif etype == "ellipse":
        _add_shape(slide, el, "ellipse")
    elif etype == "line":
        _add_line(slide, el)
    elif etype == "chart":
        _add_chart(slide, el)
    else:
        # Unknown element — preserve any text it carries so nothing silently
        # disappears from the exported deck.
        if el.get("text"):
            _add_text(slide, {**el, "type": "text"})


# ───────────────────────── public API ─────────────────────────

def export_deck_to_pptx(deck) -> io.BytesIO:
    """Build a .pptx for ``deck`` and return it as an in-memory BytesIO."""
    if Presentation is None:
        raise ValueError(
            "python-pptx is not installed. Add python-pptx to requirements.txt and rebuild."
        )

    prs = Presentation()
    # 16:9 at 10in × 5.625in → 1 design px = 1/96in.
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

        els = data.get("els") or []
        # Stable z-order: backgrounds/shapes first, text/images on top, while
        # preserving the original order within each tier.
        ordered = sorted(
            enumerate(els),
            key=lambda pair: (_Z_ORDER.get(str(pair[1].get("type", "")).lower(), 2), pair[0]),
        )
        for _i, el in ordered:
            try:
                _render_element(slide, el)
            except Exception:
                # One bad element must never abort the whole export.
                continue

        _set_notes(slide, data)

    buf = io.BytesIO()
    prs.save(buf)
    buf.seek(0)
    return buf


def export_filename(deck) -> str:
    base = re.sub(r"[^A-Za-z0-9 _-]+", "", (deck.title or "deck")).strip() or "deck"
    return f"{base}.pptx"
