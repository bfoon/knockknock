"""PowerPoint → Hanns JSON importer.

This module imports PPTX (and legacy PPT via LibreOffice conversion when
available) into the existing Hanns Deck/Slide JSON model. It keeps images as
media files and stores only URLs inside slide JSON so autosave remains small.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import uuid
from pathlib import Path

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

try:  # python-pptx is optional until the import feature is used.
    from pptx import Presentation
    from pptx.enum.dml import MSO_FILL, MSO_COLOR_TYPE
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    from pptx.enum.text import PP_ALIGN
except Exception:  # pragma: no cover - handled at runtime
    Presentation = None
    MSO_FILL = None
    MSO_COLOR_TYPE = None
    MSO_SHAPE_TYPE = None
    PP_ALIGN = None

from .models import Slide

DESIGN_W = 960
DESIGN_H = 540


def _uid() -> str:
    return "ppt_" + uuid.uuid4().hex[:12]


def _safe_name(name: str) -> str:
    base = os.path.basename(name or "presentation.pptx")
    return base.replace("/", "_").replace("\\", "_")[:160]


def _write_upload_to_temp(uploaded_file, path: str) -> None:
    with open(path, "wb") as fh:
        for chunk in uploaded_file.chunks():
            fh.write(chunk)


def _convert_legacy_ppt_to_pptx(source_path: str, outdir: str) -> str:
    """Use LibreOffice to convert old .ppt to .pptx when available."""
    cmd = [
        "soffice", "--headless", "--convert-to", "pptx",
        "--outdir", outdir, source_path,
    ]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=60)
    if proc.returncode != 0:
        raise ValueError(
            "Could not convert this legacy .ppt file. Install LibreOffice in the web container "
            "or upload a .pptx version."
        )
    candidates = list(Path(outdir).glob("*.pptx"))
    if not candidates:
        raise ValueError("PowerPoint conversion completed but no .pptx file was produced.")
    return str(candidates[0])


def _load_presentation(uploaded_file):
    if Presentation is None:
        raise ValueError("python-pptx is not installed. Add python-pptx to requirements.txt and rebuild.")

    original_name = _safe_name(getattr(uploaded_file, "name", "presentation.pptx"))
    ext = Path(original_name).suffix.lower()
    if ext not in {".pptx", ".ppt", ".ppsx"}:
        raise ValueError("Only .ppt, .pptx, and .ppsx PowerPoint files can be imported.")

    tmpdir = tempfile.TemporaryDirectory()
    source_path = os.path.join(tmpdir.name, "source" + ext)
    _write_upload_to_temp(uploaded_file, source_path)
    parse_path = source_path
    if ext == ".ppt":
        parse_path = _convert_legacy_ppt_to_pptx(source_path, tmpdir.name)
    return Presentation(parse_path), original_name, tmpdir


def _emu(value, total, design):
    try:
        return round((int(value) / int(total)) * design, 2) if total else 0
    except Exception:
        return 0


def _box(shape, prs):
    return {
        "x": _emu(getattr(shape, "left", 0), prs.slide_width, DESIGN_W),
        "y": _emu(getattr(shape, "top", 0), prs.slide_height, DESIGN_H),
        "w": max(4, _emu(getattr(shape, "width", 0), prs.slide_width, DESIGN_W)),
        "h": max(4, _emu(getattr(shape, "height", 0), prs.slide_height, DESIGN_H)),
        "rot": float(getattr(shape, "rotation", 0) or 0),
    }


def _rgb_to_hex(rgb) -> str | None:
    if rgb is None:
        return None
    value = str(rgb).strip()
    if len(value) == 6:
        return "#" + value.upper()
    return None


def _color_to_hex(color, default=None):
    if color is None:
        return default
    try:
        if getattr(color, "type", None) == MSO_COLOR_TYPE.RGB:
            return _rgb_to_hex(color.rgb) or default
        # Theme colours do not resolve reliably without the PowerPoint theme;
        # return the default instead of throwing.
        return default
    except Exception:
        return default


def _fill_color(shape, default="none"):
    try:
        fill = shape.fill
        if getattr(fill, "type", None) == MSO_FILL.SOLID:
            return _color_to_hex(fill.fore_color, default)
    except Exception:
        pass
    return default


def _stroke_color(shape, default="none"):
    try:
        line = shape.line
        if line and line.color:
            return _color_to_hex(line.color, default)
    except Exception:
        pass
    return default


def _stroke_width(shape):
    try:
        return max(0, round(float(shape.line.width.pt) * 1.333, 1)) if shape.line.width else 0
    except Exception:
        return 0


def _first_text_run(shape):
    try:
        for p in shape.text_frame.paragraphs:
            for r in p.runs:
                if (r.text or "").strip():
                    return p, r
        if shape.text_frame.paragraphs:
            p = shape.text_frame.paragraphs[0]
            return p, p.runs[0] if p.runs else None
    except Exception:
        return None, None
    return None, None


def _paragraph_align(paragraph):
    try:
        if paragraph.alignment == PP_ALIGN.CENTER:
            return "center"
        if paragraph.alignment == PP_ALIGN.RIGHT:
            return "right"
    except Exception:
        pass
    return "left"


def _font_size(run, fallback=28):
    try:
        if run and run.font and run.font.size:
            return int(round(float(run.font.size.pt) * 1.333))
    except Exception:
        pass
    return fallback


def _font_name(run):
    try:
        name = run.font.name if run and run.font else None
        if name:
            return f'"{name}",sans-serif'
    except Exception:
        pass
    return '"Inter",sans-serif'


def _font_color(run, default="#16140f"):
    try:
        if run and run.font:
            return _color_to_hex(run.font.color, default)
    except Exception:
        pass
    return default


def _shape_text(shape):
    try:
        return "\n".join(p.text for p in shape.text_frame.paragraphs).strip()
    except Exception:
        return ""


def _text_element(shape, prs):
    text = _shape_text(shape)
    if not text:
        return None
    p, r = _first_text_run(shape)
    box = _box(shape, prs)
    fill = _fill_color(shape, "none")
    return {
        "id": _uid(),
        "type": "text",
        **box,
        "anim": "fade",
        "animDelay": 0,
        "text": text,
        "font": _font_name(r),
        "size": _font_size(r, fallback=max(18, min(44, int(box["h"] / 2) if box["h"] else 28))),
        "weight": 700 if getattr(getattr(r, "font", None), "bold", False) else 500,
        "italic": bool(getattr(getattr(r, "font", None), "italic", False)),
        "color": _font_color(r, "#16140f"),
        "align": _paragraph_align(p),
        "lh": 1.15,
        "ls": 0,
        "fill": fill,
    }


def _image_element(request, deck, shape, prs):
    try:
        image = shape.image
        ext = (image.ext or "png").lower().lstrip(".")
        if ext == "jpeg":
            ext = "jpg"
        rel_path = f"hanns/decks/{deck.code}/imports/{uuid.uuid4().hex}.{ext}"
        saved = default_storage.save(rel_path, ContentFile(image.blob))
        url = request.build_absolute_uri(default_storage.url(saved))
        return {
            "id": _uid(),
            "type": "image",
            **_box(shape, prs),
            "anim": "fade",
            "animDelay": 0,
            "src": url,
            "fit": "contain",
            "radius": 0,
            "alt": "Imported PowerPoint image",
        }
    except Exception:
        return None


def _shape_element(shape, prs):
    box = _box(shape, prs)
    fill = _fill_color(shape, "#ece4d4")
    stroke = _stroke_color(shape, "none")
    stroke_w = _stroke_width(shape)
    typ = "rect"
    radius = 8
    try:
        auto_name = str(getattr(shape, "auto_shape_type", "")).upper()
        if "OVAL" in auto_name or "ELLIPSE" in auto_name:
            typ = "ellipse"
            radius = 0
    except Exception:
        pass
    return {
        "id": _uid(),
        "type": typ,
        **box,
        "anim": "fade",
        "animDelay": 0,
        "fill": fill,
        "stroke": stroke,
        "strokeW": stroke_w,
        "radius": radius,
    }


def _line_element(shape, prs):
    box = _box(shape, prs)
    return {
        "id": _uid(),
        "type": "line",
        **box,
        "h": max(2, box.get("h", 2)),
        "anim": "reveal",
        "animDelay": 0,
        "fill": _stroke_color(shape, "#16140f"),
    }


def _chart_placeholder(shape, prs):
    box = _box(shape, prs)
    title = "Imported chart"
    try:
        chart = shape.chart
        if chart.has_title and chart.chart_title and chart.chart_title.text_frame:
            title = chart.chart_title.text_frame.text or title
    except Exception:
        pass
    return {
        "id": _uid(),
        "type": "chart",
        **box,
        "anim": "fade",
        "animDelay": 0,
        "chartType": "bar",
        "engine": "classic",
        "title": title,
        "accent": "#e8482b",
        "showValues": True,
        "showLabels": True,
        "chartData": [
            {"label": "Imported", "value": 1},
            {"label": "Edit", "value": 1},
        ],
    }


def _elements_from_shape(request, deck, shape, prs, warnings):
    elements = []
    try:
        if getattr(shape, "shape_type", None) == MSO_SHAPE_TYPE.GROUP:
            for child in getattr(shape, "shapes", []):
                elements.extend(_elements_from_shape(request, deck, child, prs, warnings))
            return elements
    except Exception:
        pass

    try:
        if getattr(shape, "has_chart", False):
            el = _chart_placeholder(shape, prs)
            if el:
                elements.append(el)
            warnings.append("One PowerPoint chart was imported as an editable chart placeholder.")
            return elements
    except Exception:
        pass

    try:
        if getattr(shape, "shape_type", None) == MSO_SHAPE_TYPE.PICTURE:
            el = _image_element(request, deck, shape, prs)
            if el:
                elements.append(el)
            return elements
    except Exception:
        pass

    # For text boxes and placeholders, make the text editable. If the object
    # also has a fill, the text element carries that background fill.
    try:
        if getattr(shape, "has_text_frame", False) and _shape_text(shape):
            el = _text_element(shape, prs)
            if el:
                elements.append(el)
            return elements
    except Exception:
        pass

    try:
        if getattr(shape, "shape_type", None) == MSO_SHAPE_TYPE.LINE:
            elements.append(_line_element(shape, prs))
            return elements
    except Exception:
        pass

    try:
        if getattr(shape, "shape_type", None) == MSO_SHAPE_TYPE.AUTO_SHAPE:
            elements.append(_shape_element(shape, prs))
            return elements
    except Exception:
        pass

    return elements


def _notes_for_slide(index: int, warnings: list[str]) -> str:
    note = f"Imported from PowerPoint slide {index + 1}."
    if warnings:
        note += " Some complex PowerPoint features may need manual adjustment in Hanns."
    return note


def import_powerpoint_into_deck(*, request, deck, uploaded_file, replace: bool = True) -> dict:
    prs, original_name, tmpdir = _load_presentation(uploaded_file)
    warnings: list[str] = []

    try:
        stem = Path(original_name).stem.strip()
        if stem:
            deck.title = stem[:140]
            deck.save(update_fields=["title", "updated_at"])

        if replace:
            deck.slides.all().delete()

        slide_rows = []
        for idx, slide in enumerate(prs.slides):
            slide_warnings: list[str] = []
            elements = []
            for shape in slide.shapes:
                try:
                    elements.extend(_elements_from_shape(request, deck, shape, prs, slide_warnings))
                except Exception as exc:
                    slide_warnings.append(f"Skipped one unsupported object on slide {idx + 1}: {exc}")

            if not elements:
                elements.append({
                    "id": _uid(),
                    "type": "text",
                    "x": 90,
                    "y": 210,
                    "w": 780,
                    "h": 90,
                    "rot": 0,
                    "anim": "fade",
                    "animDelay": 0,
                    "text": f"Imported slide {idx + 1}",
                    "font": '"Fraunces",serif',
                    "size": 44,
                    "weight": 700,
                    "italic": False,
                    "color": "#16140f",
                    "align": "center",
                    "lh": 1.15,
                    "ls": 0,
                    "fill": "none",
                })
                slide_warnings.append(f"Slide {idx + 1} had no editable objects Hanns could import.")

            warnings.extend(slide_warnings)
            slide_rows.append(Slide(deck=deck, position=idx, data={
                "bg": "#f6f1e7",
                "bgSize": None,
                "bgFx": "none",
                "transition": "fade",
                "notes": _notes_for_slide(idx, slide_warnings),
                "els": elements,
            }))

        if slide_rows:
            Slide.objects.bulk_create(slide_rows)
        else:
            Slide.objects.create(deck=deck, position=0, data={
                "bg": "#f6f1e7",
                "bgSize": None,
                "bgFx": "none",
                "transition": "fade",
                "notes": "PowerPoint import created a blank starter slide.",
                "els": [],
            })
            warnings.append("The PowerPoint file did not contain any slides.")

        return {"warnings": warnings, "slide_count": len(slide_rows)}
    finally:
        tmpdir.cleanup()
