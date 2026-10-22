"""PowerPoint → Hanns JSON importer (v4 — theme-accurate).

Imports PPTX (and legacy PPT via LibreOffice conversion when available) into
the existing Hanns Deck/Slide JSON model. Images are stored as media files and
only URLs live inside slide JSON so autosave stays small.

v4 — colours and styles now resolve exactly the way PowerPoint resolves them
──────────────────────────────────────────────────────────────────────────────
Before v4 the importer only understood literal RGB colours. Almost every
modern deck (PowerPoint designer themes, Google Slides exports, pptxgenjs,
Canva) writes THEME colours instead — ``<a:schemeClr val="accent3"/>`` — and
every one of those silently fell back to a default: beige boxes, near-black
text, beige slide backgrounds. v4 adds a full DrawingML colour engine:

  • Theme colours      — the slide master's theme part is read and the colour
    map (``p:clrMap``) applied, including per-layout / per-slide overrides,
    so bg1/tx1/bg2/tx2/accent1–6/hlink resolve to the deck's real palette.
  • Every colour form  — srgbClr, schemeClr, sysClr, prstClr, scrgbClr and
    hslClr, with all the common transforms PowerPoint uses for its tint/
    shade swatches: lumMod, lumOff, tint, shade, satMod/Off, hueMod/Off,
    alpha/alphaMod/alphaOff, inv, comp, gray. Translucent colours come
    through as ``rgba(…)``.
  • Style references   — shapes that carry no explicit fill/outline take
    them from ``<p:style>`` (fillRef / lnRef / fontRef) and the theme's
    format scheme, exactly like PowerPoint.
  • Backgrounds        — ``bgPr`` in any colour form and ``bgRef`` theme
    background styles; the fallback is the theme's bg1 (white), not beige.
  • Text inheritance   — font, size, colour, weight, alignment, line
    spacing and bullets are inherited run → paragraph → shape list style →
    layout placeholder → master placeholder → master text styles →
    presentation defaults, and ``+mj-lt``/``+mn-lt`` resolve to the theme's
    heading/body fonts.
  • Rich text          — every run keeps its own colour / weight / italic /
    size / font / underline in ``el.runs`` (multi-colour sentences import
    multi-coloured). ALL CAPS and letter-spacing are honoured.
  • Text box insets    — the frame is inset by bodyPr l/t/r/bIns so text
    sits exactly where it sat in PowerPoint; vertical anchor → ``valign``.
  • Shapes             — rounded-rectangle radius from its adjust value,
    gradient fills (linear + radial), translucent fills, outer shadow and
    glow → ``el.fx``, flipH/flipV, picture-filled shapes, and non-rectangular
    geometry (triangles, arrows, chevrons, stars, custom freeform paths) as
    real Hanns ``freeform`` vector shapes instead of grey rectangles.
  • Groups             — child coordinates are mapped through the group's
    chOff/chExt transform (nested groups compose), and grpFill resolves.
  • Lines              — diagonal lines keep their angle; colours resolve
    through the theme.
  • Tables             — per-cell fill / text colour / bold carried in
    ``cellStyles``, plus header/body colours.
  • Charts             — series and per-point colours resolve through the
    theme.
  • Layout & master    — decorative (non-placeholder) shapes on the layout
    and master are drawn behind the slide's own content, honouring
    ``showMasterSp``.
  • Pictures           — srcRect crops are applied server-side and the image
    is stretched to its frame (PowerPoint never letterboxes a picture).

Kept from v2/v3: entrance animations, speaker notes, z-order, hyperlink
buttons, slide-scaled font sizing, normAutofit, line-geometry detection.
"""

from __future__ import annotations

import colorsys
import io
import math
import os
import subprocess
import tempfile
import uuid
from pathlib import Path

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage

try:  # python-pptx is optional until the import feature is used.
    from lxml import etree
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE
    from pptx.opc.constants import RELATIONSHIP_TYPE as RT
    from pptx.oxml.ns import qn
except Exception:  # pragma: no cover - handled at runtime
    etree = None
    Presentation = None
    MSO_SHAPE_TYPE = None
    RT = None
    qn = None

from .models import Slide

DESIGN_W = 960
DESIGN_H = 540
EMU_PER_PT = 12700


# ─────────────────────────── small utilities ───────────────────────────

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


def _media_url(saved_path: str) -> str:
    """URL for a freshly saved media file, as the BROWSER should see it.

    Deliberately NOT ``request.build_absolute_uri(...)``. Behind a reverse
    proxy / CDN, build_absolute_uri regularly produces the wrong scheme
    (http:// on an https:// page → blocked as mixed content) or an internal
    hostname the browser cannot reach. Either way the slide element renders
    as an EMPTY FRAME, because CSS background-image fails silently.

    A root-relative "/media/…" URL always resolves against the page origin,
    so it works in dev, behind nginx, and behind Cloudflare alike. Remote
    storages (S3, GCS) already return a fully-qualified URL from
    ``default_storage.url()``; those are passed through untouched.
    """
    url = default_storage.url(saved_path)
    if url.startswith(("http://", "https://", "//", "data:")):
        return url
    return url if url.startswith("/") else "/" + url


def _local(el) -> str:
    """Local tag name of an lxml element ('{ns}solidFill' → 'solidFill')."""
    try:
        tag = el.tag
        return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""
    except Exception:
        return ""


def _int(v, default=0):
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _truthy(v) -> bool:
    return str(v).lower() in ("1", "true", "on")


# ─────────────────────────── colour maths ───────────────────────────

_COLOR_TAGS = {"srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr", "hslClr"}
_FILL_TAGS = {"noFill", "solidFill", "gradFill", "pattFill", "blipFill", "grpFill"}

# Office 2013+ default palette — used only when a deck ships no theme.
_DEFAULT_SCHEME = {
    "dk1": "000000", "lt1": "FFFFFF", "dk2": "44546A", "lt2": "E7E6E6",
    "accent1": "4472C4", "accent2": "ED7D31", "accent3": "A5A5A5",
    "accent4": "FFC000", "accent5": "5B9BD5", "accent6": "70AD47",
    "hlink": "0563C1", "folHlink": "954F72",
}
_DEFAULT_CLRMAP = {
    "bg1": "lt1", "tx1": "dk1", "bg2": "lt2", "tx2": "dk2",
    "accent1": "accent1", "accent2": "accent2", "accent3": "accent3",
    "accent4": "accent4", "accent5": "accent5", "accent6": "accent6",
    "hlink": "hlink", "folHlink": "folHlink",
}

# DrawingML preset colour names (the ones that actually turn up in decks).
_PRST_COLORS = {
    "black": "000000", "white": "FFFFFF", "red": "FF0000", "green": "008000",
    "blue": "0000FF", "yellow": "FFFF00", "cyan": "00FFFF", "magenta": "FF00FF",
    "gray": "808080", "grey": "808080", "silver": "C0C0C0", "maroon": "800000",
    "navy": "000080", "olive": "808000", "purple": "800080", "teal": "008080",
    "orange": "FFA500", "lime": "00FF00", "aqua": "00FFFF", "fuchsia": "FF00FF",
    "dkGray": "A9A9A9", "ltGray": "D3D3D3", "dkBlue": "00008B", "ltBlue": "ADD8E6",
    "dkRed": "8B0000", "dkGreen": "006400", "ltGreen": "90EE90", "gold": "FFD700",
    "pink": "FFC0CB", "brown": "A52A2A", "indigo": "4B0082", "violet": "EE82EE",
    "coral": "FF7F50", "salmon": "FA8072", "tan": "D2B48C", "beige": "F5F5DC",
    "ivory": "FFFFF0", "khaki": "F0E68C", "crimson": "DC143C", "tomato": "FF6347",
    "skyBlue": "87CEEB", "steelBlue": "4682B4", "royalBlue": "4169E1",
    "slateGray": "708090", "darkSlateGray": "2F4F4F", "chocolate": "D2691E",
}
_SYS_COLORS = {"windowText": "000000", "window": "FFFFFF", "btnFace": "F0F0F0",
               "btnText": "000000", "highlight": "0078D7", "highlightText": "FFFFFF",
               "grayText": "6D6D6D", "menu": "FFFFFF", "menuText": "000000"}


def _hex_rgb(hexv: str):
    h = (hexv or "000000").strip().lstrip("#")
    if len(h) != 6:
        h = "000000"
    return int(h[0:2], 16) / 255.0, int(h[2:4], 16) / 255.0, int(h[4:6], 16) / 255.0


def _to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _to_srgb(c):
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def _clamp(x):
    return max(0.0, min(1.0, x))


def _apply_color_mods(rgb, alpha, clr_el):
    """Apply DrawingML colour transforms in document order."""
    r, g, b = rgb
    for mod in clr_el:
        name = _local(mod)
        val = _int(mod.get("val"), 0)
        pct = val / 100000.0
        if name in ("lumMod", "lumOff", "satMod", "satOff", "hueMod", "hueOff",
                    "lum", "sat", "hue"):
            h, l, s = colorsys.rgb_to_hls(r, g, b)
            if name == "lumMod":
                l = l * pct
            elif name == "lumOff":
                l = l + pct
            elif name == "lum":
                l = pct
            elif name == "satMod":
                s = s * pct
            elif name == "satOff":
                s = s + pct
            elif name == "sat":
                s = pct
            elif name == "hueMod":
                h = (h * pct) % 1.0
            elif name == "hueOff":
                h = (h + val / 60000.0 / 360.0) % 1.0
            elif name == "hue":
                h = (val / 60000.0 / 360.0) % 1.0
            r, g, b = colorsys.hls_to_rgb(h, _clamp(l), _clamp(s))
        elif name == "tint":
            # PowerPoint tints in linear light towards white.
            r, g, b = (_to_srgb(_to_lin(c) * pct + (1 - pct)) for c in (r, g, b))
        elif name == "shade":
            r, g, b = (_to_srgb(_to_lin(c) * pct) for c in (r, g, b))
        elif name == "alpha":
            alpha = pct
        elif name == "alphaMod":
            alpha = alpha * pct
        elif name == "alphaOff":
            alpha = alpha + pct
        elif name == "inv":
            r, g, b = 1 - r, 1 - g, 1 - b
        elif name == "comp":
            h, l, s = colorsys.rgb_to_hls(r, g, b)
            r, g, b = colorsys.hls_to_rgb((h + 0.5) % 1.0, l, s)
        elif name == "gray":
            y = 0.299 * r + 0.587 * g + 0.114 * b
            r = g = b = y
        elif name in ("redMod", "greenMod", "blueMod"):
            if name == "redMod":
                r = r * pct
            elif name == "greenMod":
                g = g * pct
            else:
                b = b * pct
        elif name in ("redOff", "greenOff", "blueOff"):
            if name == "redOff":
                r = r + pct
            elif name == "greenOff":
                g = g + pct
            else:
                b = b + pct
        elif name in ("red", "green", "blue"):
            if name == "red":
                r = pct
            elif name == "green":
                g = pct
            else:
                b = pct
        r, g, b = _clamp(r), _clamp(g), _clamp(b)
    return (_clamp(r), _clamp(g), _clamp(b)), _clamp(alpha)


def _rgba_css(rgb, alpha=1.0) -> str:
    r, g, b = (int(round(c * 255)) for c in rgb)
    if alpha >= 0.995:
        return "#{:02X}{:02X}{:02X}".format(r, g, b)
    return "rgba({},{},{},{})".format(r, g, b, round(alpha, 3))


def _first_color_child(el):
    if el is None:
        return None
    for child in el:
        if _local(child) in _COLOR_TAGS:
            return child
    return None


# ─────────────────────────── theme ───────────────────────────

class _Theme:
    """A slide master's theme: colour scheme, fonts and format scheme."""

    def __init__(self, master=None):
        self.scheme = dict(_DEFAULT_SCHEME)
        self.major_font = "Calibri Light"
        self.minor_font = "Calibri"
        self.fill_styles: list = []
        self.bg_fill_styles: list = []
        self.ln_styles: list = []
        root = None
        try:
            part = master.part.part_related_by(RT.THEME)
            root = etree.fromstring(part.blob)
        except Exception:
            root = None
        if root is None:
            return
        try:
            cs = root.find(".//" + qn("a:clrScheme"))
            if cs is not None:
                for slot in cs:
                    key = _local(slot)
                    c = _first_color_child(slot)
                    if c is None:
                        continue
                    if _local(c) == "srgbClr" and c.get("val"):
                        self.scheme[key] = c.get("val").upper()
                    elif _local(c) == "sysClr":
                        self.scheme[key] = (c.get("lastClr") or _SYS_COLORS.get(c.get("val"), "000000")).upper()
        except Exception:
            pass
        try:
            major = root.find(".//" + qn("a:majorFont") + "/" + qn("a:latin"))
            minor = root.find(".//" + qn("a:minorFont") + "/" + qn("a:latin"))
            if major is not None and major.get("typeface"):
                self.major_font = major.get("typeface")
            if minor is not None and minor.get("typeface"):
                self.minor_font = minor.get("typeface")
        except Exception:
            pass
        try:
            fmt = root.find(".//" + qn("a:fmtScheme"))
            if fmt is not None:
                fl = fmt.find(qn("a:fillStyleLst"))
                bl = fmt.find(qn("a:bgFillStyleLst"))
                ll = fmt.find(qn("a:lnStyleLst"))
                self.fill_styles = list(fl) if fl is not None else []
                self.bg_fill_styles = list(bl) if bl is not None else []
                self.ln_styles = list(ll) if ll is not None else []
        except Exception:
            pass


class _Ctx:
    """Everything needed to resolve colours/fonts/sizes for one slide."""

    def __init__(self, *, request, deck, prs, slide, theme_cache, warnings):
        self.request = request
        self.deck = deck
        self.prs = prs
        self.slide = slide
        self.warnings = warnings
        self.layout = None
        self.master = None
        try:
            self.layout = slide.slide_layout
            self.master = self.layout.slide_master
        except Exception:
            pass
        key = id(self.master.part) if self.master is not None else 0
        if key not in theme_cache:
            theme_cache[key] = _Theme(self.master)
        self.theme = theme_cache[key]

        # Colour map: master clrMap, then layout override, then slide override.
        self.clrmap = dict(_DEFAULT_CLRMAP)
        try:
            cm = self.master._element.find(qn("p:clrMap"))
            if cm is not None:
                self.clrmap.update(dict(cm.attrib))
        except Exception:
            pass
        for holder in (self.layout, slide):
            try:
                ovr = holder._element.find(qn("p:clrMapOvr"))
                if ovr is None:
                    continue
                o = ovr.find(qn("a:overrideClrMapping"))
                if o is not None:
                    self.clrmap.update(dict(o.attrib))
            except Exception:
                continue

        self.emu_x = DESIGN_W / float(int(prs.slide_width) or 1)
        self.emu_y = DESIGN_H / float(int(prs.slide_height) or 1)
        self.pt_px = EMU_PER_PT * self.emu_x   # px per point

    # ── colours ──
    def scheme_hex(self, name: str) -> str | None:
        mapped = self.clrmap.get(name, name)
        return self.theme.scheme.get(mapped) or self.theme.scheme.get(name)

    def color(self, clr_el, ph=None):
        """Resolve one colour element → ((r,g,b), alpha) or None."""
        if clr_el is None:
            return None
        try:
            tag = _local(clr_el)
            alpha = 1.0
            if tag == "srgbClr":
                rgb = _hex_rgb(clr_el.get("val"))
            elif tag == "schemeClr":
                val = clr_el.get("val") or ""
                if val == "phClr":
                    if ph is None:
                        rgb = _hex_rgb(self.scheme_hex("tx1") or "000000")
                    else:
                        rgb, alpha = ph
                else:
                    hexv = self.scheme_hex(val)
                    if not hexv:
                        return None
                    rgb = _hex_rgb(hexv)
            elif tag == "sysClr":
                rgb = _hex_rgb(clr_el.get("lastClr") or _SYS_COLORS.get(clr_el.get("val"), "000000"))
            elif tag == "prstClr":
                rgb = _hex_rgb(_PRST_COLORS.get(clr_el.get("val") or "", "000000"))
            elif tag == "scrgbClr":
                rgb = tuple(_to_srgb(_int(clr_el.get(k)) / 100000.0) for k in ("r", "g", "b"))
            elif tag == "hslClr":
                h = (_int(clr_el.get("hue")) / 60000.0 / 360.0) % 1.0
                s = _int(clr_el.get("sat")) / 100000.0
                l = _int(clr_el.get("lum")) / 100000.0
                rgb = colorsys.hls_to_rgb(h, _clamp(l), _clamp(s))
            else:
                return None
            return _apply_color_mods(rgb, alpha, clr_el)
        except Exception:
            return None

    def color_css(self, clr_el, ph=None, default=None):
        c = self.color(clr_el, ph)
        return _rgba_css(*c) if c else default

    # ── fills ──
    def fill(self, fill_el, ph=None, grp=None):
        """One fill element → (kind, value).

        kind: "none" | "solid" (css) | "grad" (dict) | "blip" (element)
        """
        tag = _local(fill_el)
        if tag == "noFill":
            return "none", None
        if tag == "solidFill":
            c = self.color(_first_color_child(fill_el), ph)
            return ("solid", _rgba_css(*c)) if c else ("none", None)
        if tag == "gradFill":
            g = self.gradient(fill_el, ph)
            if g is None:
                return "none", None
            if len(g["stops"]) == 1:
                return "solid", g["stops"][0][1]
            return "grad", g
        if tag == "pattFill":
            fg = fill_el.find(qn("a:fgClr"))
            c = self.color(_first_color_child(fg), ph) if fg is not None else None
            return ("solid", _rgba_css(*c)) if c else ("none", None)
        if tag == "blipFill":
            return "blip", fill_el
        if tag == "grpFill":
            return grp if grp else ("none", None)
        return None, None

    def fill_in(self, container, ph=None, grp=None):
        """First fill child of ``container`` → (kind, value); (None, None) if unset."""
        if container is None:
            return None, None
        for child in container:
            if _local(child) in _FILL_TAGS:
                return self.fill(child, ph, grp)
        return None, None

    def gradient(self, grad_el, ph=None):
        stops = []
        gs_lst = grad_el.find(qn("a:gsLst"))
        if gs_lst is None:
            return None
        for gs in gs_lst.findall(qn("a:gs")):
            c = self.color(_first_color_child(gs), ph)
            if not c:
                continue
            stops.append((_int(gs.get("pos")) / 1000.0, _rgba_css(*c)))
        if not stops:
            return None
        stops.sort(key=lambda s: s[0])
        out = {"stops": stops, "type": "linear", "angle": 90.0, "cx": 50.0, "cy": 50.0}
        lin = grad_el.find(qn("a:lin"))
        path = grad_el.find(qn("a:path"))
        if path is not None:
            out["type"] = "radial"
            ftr = path.find(qn("a:fillToRect"))
            if ftr is not None:
                l, t = _int(ftr.get("l")) / 1000.0, _int(ftr.get("t")) / 1000.0
                r, b = _int(ftr.get("r")) / 1000.0, _int(ftr.get("b")) / 1000.0
                out["cx"] = max(0.0, min(100.0, (l + (100.0 - r)) / 2.0))
                out["cy"] = max(0.0, min(100.0, (t + (100.0 - b)) / 2.0))
        elif lin is not None and lin.get("ang") is not None:
            # PPTX: clockwise from 3 o'clock in 60000ths. CSS: from 12 o'clock.
            out["angle"] = (_int(lin.get("ang")) / 60000.0 + 90.0) % 360.0
        return out

    @staticmethod
    def gradient_css(g) -> str:
        parts = ",".join(f"{c} {p:.0f}%" for p, c in g["stops"])
        if g["type"] == "radial":
            return f"radial-gradient(circle farthest-corner at {g['cx']:.0f}% {g['cy']:.0f}%,{parts})"
        return f"linear-gradient({g['angle']:.0f}deg,{parts})"

    def fill_css(self, kind, value, default="none"):
        if kind == "solid":
            return value
        if kind == "grad":
            return self.gradient_css(value)
        return default

    # ── style matrix (p:style) ──
    def style_ref(self, sp_el, name):
        """(idx, ((rgb), alpha) | None) for a:fillRef / a:lnRef / … ."""
        try:
            st = sp_el.find(qn("p:style"))
            if st is None:
                return None, None
            ref = st.find(qn("a:" + name))
            if ref is None:
                return None, None
            return _int(ref.get("idx"), 0), self.color(_first_color_child(ref))
        except Exception:
            return None, None

    def shape_fill(self, sp_el, grp=None):
        """Effective fill of a shape element → (kind, value)."""
        sppr = sp_el.find(qn("p:spPr"))
        kind, val = self.fill_in(sppr, grp=grp)
        if kind is not None:
            return kind, val
        idx, ph = self.style_ref(sp_el, "fillRef")
        if not idx:
            return "none", None
        try:
            if idx >= 1001:
                style = self.theme.bg_fill_styles[idx - 1001]
            else:
                style = self.theme.fill_styles[idx - 1]
            k, v = self.fill(style, ph, grp)
            return (k, v) if k is not None else ("none", None)
        except Exception:
            if ph:
                return "solid", _rgba_css(*ph)
            return "none", None

    def shape_line(self, sp_el):
        """Effective outline → (css | None, width_px, dashed)."""
        sppr = sp_el.find(qn("p:spPr"))
        ln = sppr.find(qn("a:ln")) if sppr is not None else None
        width = _int(ln.get("w"), -1) if ln is not None else -1
        kind, val = self.fill_in(ln)
        dash_el = ln.find(qn("a:prstDash")) if ln is not None else None
        if kind is None:
            idx, ph = self.style_ref(sp_el, "lnRef")
            if idx:
                try:
                    style_ln = self.theme.ln_styles[idx - 1]
                    kind, val = self.fill_in(style_ln, ph)
                    if width < 0:
                        width = _int(style_ln.get("w"), -1)
                    if dash_el is None:
                        dash_el = style_ln.find(qn("a:prstDash"))
                except Exception:
                    kind, val = ("solid", _rgba_css(*ph)) if ph else ("none", None)
        if kind == "grad":
            val = val["stops"][0][1]
            kind = "solid"
        if kind != "solid" or not val:
            return None, 0, False
        if width < 0:
            width = 9525  # PowerPoint's default 0.75 pt hairline
        width_px = max(0.5, round(width * self.emu_x, 2))
        dashed = dash_el is not None and (dash_el.get("val") or "solid") != "solid"
        return val, width_px, dashed

    def shape_fx(self, sp_el):
        """Outer shadow / glow from spPr effectLst → Hanns el.fx (or {})."""
        fx = {}
        try:
            sppr = sp_el.find(qn("p:spPr"))
            eff = sppr.find(qn("a:effectLst")) if sppr is not None else None
            if eff is None:
                return fx
            sh = eff.find(qn("a:outerShdw"))
            if sh is not None:
                dist = _int(sh.get("dist")) * self.emu_x
                ang = math.radians(_int(sh.get("dir")) / 60000.0)
                col = self.color_css(_first_color_child(sh), default="rgba(0,0,0,.35)")
                fx.update({
                    "shadow": True,
                    "sx": round(math.cos(ang) * dist, 2),
                    "sy": round(math.sin(ang) * dist, 2),
                    "sblur": round(_int(sh.get("blurRad")) * self.emu_x, 2),
                    "scolor": col,
                })
            gl = eff.find(qn("a:glow"))
            if gl is not None:
                fx.update({
                    "glow": True,
                    "gsize": round(_int(gl.get("rad")) * self.emu_x, 2),
                    "gcolor": self.color_css(_first_color_child(gl), default="#7dd3fc"),
                })
        except Exception:
            pass
        return fx


# ─────────────────────────── geometry ───────────────────────────

_IDENTITY = (0.0, 1.0, 0.0, 1.0)   # slide_x = a + b*x, slide_y = c + d*y


def _compose_group(xf, grp_shape):
    """Child-space → slide-space transform for the children of a group."""
    try:
        xfrm = grp_shape._element.find(qn("p:grpSpPr") + "/" + qn("a:xfrm"))
        off, ext = xfrm.find(qn("a:off")), xfrm.find(qn("a:ext"))
        choff, chext = xfrm.find(qn("a:chOff")), xfrm.find(qn("a:chExt"))
        ox, oy = _int(off.get("x")), _int(off.get("y"))
        cx, cy = _int(ext.get("cx")), _int(ext.get("cy"))
        chx, chy = _int(choff.get("x")), _int(choff.get("y"))
        chcx, chcy = _int(chext.get("cx")), _int(chext.get("cy"))
        kx = (cx / chcx) if chcx else 1.0
        ky = (cy / chcy) if chcy else 1.0
        a, b, c, d = xf
        return (a + b * (ox - chx * kx), b * kx, c + d * (oy - chy * ky), d * ky)
    except Exception:
        return xf


def _box(shape, ctx, xf=_IDENTITY):
    a, b, c, d = xf
    try:
        left, top = int(shape.left or 0), int(shape.top or 0)
        width, height = int(shape.width or 0), int(shape.height or 0)
    except Exception:
        left = top = width = height = 0
    return {
        "x": round((a + b * left) * ctx.emu_x, 2),
        "y": round((c + d * top) * ctx.emu_y, 2),
        "w": max(4, round(b * width * ctx.emu_x, 2)),
        "h": max(4, round(d * height * ctx.emu_y, 2)),
        "rot": float(getattr(shape, "rotation", 0) or 0),
    }


def _flips(sp_el):
    try:
        for path in (qn("p:spPr") + "/" + qn("a:xfrm"), qn("p:grpSpPr") + "/" + qn("a:xfrm")):
            xfrm = sp_el.find(path)
            if xfrm is not None:
                return _truthy(xfrm.get("flipH")), _truthy(xfrm.get("flipV"))
    except Exception:
        pass
    return False, False


def _prst(sp_el):
    try:
        pg = sp_el.find(qn("p:spPr") + "/" + qn("a:prstGeom"))
        if pg is None:
            return None, {}
        adj = {}
        av = pg.find(qn("a:avLst"))
        if av is not None:
            for gd in av.findall(qn("a:gd")):
                f = (gd.get("fmla") or "").split()
                if len(f) == 2 and f[0] == "val":
                    adj[gd.get("name")] = _int(f[1])
        return pg.get("prst"), adj
    except Exception:
        return None, {}


_LINE_PRSTS = {
    "line", "lineInv",
    "straightConnector1",
    "bentConnector2", "bentConnector3", "bentConnector4", "bentConnector5",
    "curvedConnector2", "curvedConnector3", "curvedConnector4", "curvedConnector5",
}
_RECT_PRSTS = {"rect", "flowChartProcess", "flowChartAlternateProcess", "snip1Rect",
               "snip2SameRect", "round1Rect", "round2SameRect", "round2DiagRect",
               "snipRoundRect", "plaque", "frame", "bevel", "foldedCorner"}
_ELLIPSE_PRSTS = {"ellipse", "flowChartConnector", "donut"}


def _is_line_geometry(shape) -> bool:
    prst, _ = _prst(shape._element)
    return prst in _LINE_PRSTS


def _preset_points(prst, adj, w, h):
    """Polygon for a preset geometry in a 0–100 box, or None."""
    w = max(1e-6, float(w))
    h = max(1e-6, float(h))
    ss = min(w, h)

    def a(name, default):
        return adj.get(name, default) / 100000.0

    def fx(px):   # absolute px along x → 0–100
        return max(0.0, min(100.0, px / w * 100.0))

    def fy(py):
        return max(0.0, min(100.0, py / h * 100.0))

    if prst == "triangle":
        return [(a("adj", 50000) * 100, 0), (100, 100), (0, 100)]
    if prst == "rtTriangle":
        return [(0, 0), (100, 100), (0, 100)]
    if prst in ("diamond", "flowChartDecision"):
        return [(50, 0), (100, 50), (50, 100), (0, 50)]
    if prst in ("parallelogram", "flowChartInputOutput"):
        o = fx(a("adj", 25000) * ss)
        return [(o, 0), (100, 0), (100 - o, 100), (0, 100)]
    if prst == "trapezoid":
        o = fx(a("adj", 25000) * ss)
        return [(o, 0), (100 - o, 0), (100, 100), (0, 100)]
    if prst == "pentagon":
        return [(50, 0), (100, 38.2), (80.9, 100), (19.1, 100), (0, 38.2)]
    if prst == "hexagon":
        o = fx(a("adj", 25000) * ss)
        return [(o, 0), (100 - o, 0), (100, 50), (100 - o, 100), (o, 100), (0, 50)]
    if prst == "octagon":
        ox, oy = fx(a("adj", 29289) * ss), fy(a("adj", 29289) * ss)
        return [(ox, 0), (100 - ox, 0), (100, oy), (100, 100 - oy),
                (100 - ox, 100), (ox, 100), (0, 100 - oy), (0, oy)]
    if prst == "homePlate":
        o = fx(a("adj", 50000) * ss)
        return [(0, 0), (100 - o, 0), (100, 50), (100 - o, 100), (0, 100)]
    if prst == "chevron":
        o = fx(a("adj", 50000) * ss)
        return [(0, 0), (100 - o, 0), (100, 50), (100 - o, 100), (0, 100), (o, 50)]
    if prst in ("rightArrow", "leftArrow"):
        sh = a("adj1", 50000) * 100
        head = fx(a("adj2", 50000) * ss)
        t, b = 50 - sh / 2, 50 + sh / 2
        pts = [(0, t), (100 - head, t), (100 - head, 0), (100, 50),
               (100 - head, 100), (100 - head, b), (0, b)]
        return pts if prst == "rightArrow" else [(100 - x, y) for x, y in pts]
    if prst in ("upArrow", "downArrow"):
        sh = a("adj1", 50000) * 100
        head = fy(a("adj2", 50000) * ss)
        l, r = 50 - sh / 2, 50 + sh / 2
        pts = [(l, 100), (l, head), (0, head), (50, 0), (100, head), (r, head), (r, 100)]
        return pts if prst == "upArrow" else [(x, 100 - y) for x, y in pts]
    if prst == "leftRightArrow":
        sh = a("adj1", 50000) * 100
        head = fx(a("adj2", 50000) * ss)
        t, b = 50 - sh / 2, 50 + sh / 2
        return [(0, 50), (head, 0), (head, t), (100 - head, t), (100 - head, 0), (100, 50),
                (100 - head, 100), (100 - head, b), (head, b), (head, 100)]
    if prst in ("plus", "mathPlus"):
        ox, oy = fx(a("adj", 25000) * ss), fy(a("adj", 25000) * ss)
        return [(ox, 0), (100 - ox, 0), (100 - ox, oy), (100, oy), (100, 100 - oy),
                (100 - ox, 100 - oy), (100 - ox, 100), (ox, 100), (ox, 100 - oy),
                (0, 100 - oy), (0, oy), (ox, oy)]
    if prst in ("star4", "star5", "star6", "star7", "star8", "star10", "star12", "star16"):
        n = int(prst[4:])
        inner = {4: 0.25, 5: 0.382, 6: 0.5, 7: 0.55, 8: 0.6}.get(n, 0.7)
        if "adj" in adj:
            inner = adj["adj"] / 50000.0
        pts = []
        for i in range(n * 2):
            ang = -math.pi / 2 + i * math.pi / n
            rr = 1.0 if i % 2 == 0 else inner
            pts.append((50 + 50 * rr * math.cos(ang), 50 + 50 * rr * math.sin(ang)))
        return pts
    return None


def _cust_paths(sp_el, w_emu, h_emu):
    """custGeom → list of (points 0–100, closed, filled)."""
    out = []
    try:
        cg = sp_el.find(qn("p:spPr") + "/" + qn("a:custGeom"))
        if cg is None:
            return out
        plst = cg.find(qn("a:pathLst"))
        if plst is None:
            return out
        for path in plst.findall(qn("a:path")):
            pw = _int(path.get("w"), 0) or w_emu or 1
            ph = _int(path.get("h"), 0) or h_emu or 1
            filled = (path.get("fill") or "norm") != "none"
            state = {"cur": (0.0, 0.0), "pts": [], "closed": False}

            def norm(pt):
                return (round(pt[0] / pw * 100.0, 2), round(pt[1] / ph * 100.0, 2))

            def flush():
                if len(state["pts"]) >= 2:
                    out.append(([{"x": x, "y": y} for x, y in state["pts"]], state["closed"], filled))
                state["pts"], state["closed"] = [], False

            def pt_of(el):
                return (float(_int(el.get("x"))), float(_int(el.get("y"))))

            for cmd in path:
                name = _local(cmd)
                if name == "moveTo":
                    flush()
                    state["cur"] = pt_of(cmd.find(qn("a:pt")))
                    state["pts"].append(norm(state["cur"]))
                elif name == "lnTo":
                    state["cur"] = pt_of(cmd.find(qn("a:pt")))
                    state["pts"].append(norm(state["cur"]))
                elif name in ("cubicBezTo", "quadBezTo"):
                    ctrl = [pt_of(p) for p in cmd.findall(qn("a:pt"))]
                    p0 = state["cur"]
                    for i in range(1, 11):
                        t = i / 10.0
                        if name == "cubicBezTo" and len(ctrl) == 3:
                            p1, p2, p3 = ctrl
                            x = ((1 - t) ** 3) * p0[0] + 3 * ((1 - t) ** 2) * t * p1[0] + 3 * (1 - t) * t * t * p2[0] + t ** 3 * p3[0]
                            y = ((1 - t) ** 3) * p0[1] + 3 * ((1 - t) ** 2) * t * p1[1] + 3 * (1 - t) * t * t * p2[1] + t ** 3 * p3[1]
                        elif len(ctrl) == 2:
                            p1, p2 = ctrl
                            x = ((1 - t) ** 2) * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0]
                            y = ((1 - t) ** 2) * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]
                        else:
                            continue
                        state["pts"].append(norm((x, y)))
                    if ctrl:
                        state["cur"] = ctrl[-1]
                elif name == "arcTo":
                    wr, hr = float(_int(cmd.get("wR"))), float(_int(cmd.get("hR")))
                    st = math.radians(_int(cmd.get("stAng")) / 60000.0)
                    sw = math.radians(_int(cmd.get("swAng")) / 60000.0)
                    cur = state["cur"]
                    cxp = cur[0] - wr * math.cos(st)
                    cyp = cur[1] - hr * math.sin(st)
                    steps = max(4, int(abs(sw) / (math.pi / 16)))
                    for i in range(1, steps + 1):
                        ang = st + sw * i / steps
                        state["cur"] = (cxp + wr * math.cos(ang), cyp + hr * math.sin(ang))
                        state["pts"].append(norm(state["cur"]))
                elif name == "close":
                    state["closed"] = True
                    flush()
            flush()
    except Exception:
        return out
    return out


# ─────────────────────────── text ───────────────────────────

_SERIF_FONTS = {
    "cambria", "georgia", "times new roman", "times", "garamond", "book antiqua",
    "palatino", "palatino linotype", "constantia", "baskerville", "baskerville old face",
    "bookman old style", "century", "century schoolbook", "didot", "bodoni mt",
    "goudy old style", "perpetua", "rockwell", "sylfaen", "lora", "merriweather",
    "playfair display", "fraunces", "libre baskerville", "source serif pro", "pt serif",
    "noto serif", "crimson text", "eb garamond", "dm serif display", "big caslon",
    "hoefler text", "minion pro", "charter", "iowan old style",
}
_FONT_STACKS = {
    "calibri": '"Calibri","Carlito","Segoe UI",Arial,sans-serif',
    "calibri light": '"Calibri Light","Calibri","Carlito","Segoe UI",Arial,sans-serif',
    "cambria": '"Cambria","Caladea",Georgia,"Times New Roman",serif',
    "arial": 'Arial,"Liberation Sans",Helvetica,sans-serif',
    "helvetica": 'Helvetica,Arial,sans-serif',
    "segoe ui": '"Segoe UI",system-ui,Arial,sans-serif',
    "aptos": '"Aptos","Segoe UI",Arial,sans-serif',
    "aptos display": '"Aptos Display","Aptos","Segoe UI",Arial,sans-serif',
    "consolas": 'Consolas,"Courier New",monospace',
    "courier new": '"Courier New",Courier,monospace',
}


def _font_css(name: str | None) -> str:
    if not name:
        return '"Inter",sans-serif'
    key = name.strip().lower()
    if key in _FONT_STACKS:
        return _FONT_STACKS[key]
    if key in _SERIF_FONTS or ("serif" in key and "sans" not in key):
        return f'"{name}",Georgia,"Times New Roman",serif'
    if "mono" in key or "code" in key:
        return f'"{name}",Consolas,monospace'
    return f'"{name}",sans-serif'


class _TextStyle:
    """Inheritance chain for one text-bearing shape."""

    def __init__(self, ctx, shape, sp_el):
        self.ctx = ctx
        self.sp_el = sp_el
        self.chain = []          # list-style elements, nearest first
        self.is_title = False
        tx = sp_el.find(qn("p:txBody"))
        if tx is not None:
            ls = tx.find(qn("a:lstStyle"))
            if ls is not None:
                self.chain.append(ls)

        ph = None
        try:
            ph = sp_el.find(qn("p:nvSpPr") + "/" + qn("p:nvPr") + "/" + qn("p:ph"))
        except Exception:
            ph = None
        master_style_name = "p:otherStyle"
        if ph is not None:
            ph_type = ph.get("type") or "body"
            self.is_title = ph_type in ("title", "ctrTitle")
            master_style_name = ("p:titleStyle" if self.is_title
                                 else "p:bodyStyle" if ph_type in ("body", "subTitle", "obj")
                                 else "p:otherStyle")
            base = None
            try:
                base = shape._base_placeholder
            except Exception:
                base = None
            seen = 0
            while base is not None and seen < 3:
                try:
                    btx = base._element.find(qn("p:txBody"))
                    bls = btx.find(qn("a:lstStyle")) if btx is not None else None
                    if bls is not None:
                        self.chain.append(bls)
                except Exception:
                    pass
                try:
                    base = base._base_placeholder
                except Exception:
                    base = None
                seen += 1
        try:
            ms = ctx.master._element.find(qn("p:txStyles") + "/" + qn(master_style_name))
            if ms is not None:
                self.chain.append(ms)
        except Exception:
            pass
        try:
            dts = ctx.prs._element.find(qn("p:defaultTextStyle"))
            if dts is not None:
                self.chain.append(dts)
        except Exception:
            pass

        self.font_ref_idx, self.font_ref_color = None, None
        try:
            st = sp_el.find(qn("p:style"))
            fr = st.find(qn("a:fontRef")) if st is not None else None
            if fr is not None:
                self.font_ref_idx = fr.get("idx")
                self.font_ref_color = ctx.color(_first_color_child(fr))
        except Exception:
            pass

    @staticmethod
    def _lvl(lst, lvl):
        el = lst.find(qn(f"a:lvl{lvl + 1}pPr"))
        if el is None and _local(lst) == "defaultTextStyle":
            el = lst.find(qn("a:defPPr"))
        return el

    def ppr_sources(self, p_el):
        ppr = p_el.find(qn("a:pPr"))
        lvl = _int(ppr.get("lvl"), 0) if ppr is not None else 0
        srcs = [ppr] if ppr is not None else []
        for lst in self.chain:
            e = self._lvl(lst, lvl)
            if e is not None:
                srcs.append(e)
        return srcs, lvl

    def rpr_sources(self, p_el, rpr):
        srcs = [rpr] if rpr is not None else []
        ppr_srcs, _lvl = self.ppr_sources(p_el)
        for s in ppr_srcs:
            d = s.find(qn("a:defRPr"))
            if d is not None:
                srcs.append(d)
        return srcs

    @staticmethod
    def first_attr(srcs, name):
        for s in srcs:
            v = s.get(name)
            if v is not None:
                return v
        return None

    def run_props(self, p_el, rpr):
        ctx = self.ctx
        srcs = self.rpr_sources(p_el, rpr)
        sz = self.first_attr(srcs, "sz")
        size_pt = (_int(sz) / 100.0) if sz else 18.0
        bold = _truthy(self.first_attr(srcs, "b") or "0")
        italic = _truthy(self.first_attr(srcs, "i") or "0")
        u = self.first_attr(srcs, "u")
        cap = self.first_attr(srcs, "cap")
        spc = self.first_attr(srcs, "spc")

        color = None
        for s in srcs:
            k, v = ctx.fill_in(s)
            if k is None:
                continue
            if k == "solid":
                color = v
            elif k == "grad":
                color = v["stops"][0][1]
            break
        if color is None and self.font_ref_color:
            color = _rgba_css(*self.font_ref_color)
        if color is None:
            color = "#" + (ctx.scheme_hex("tx1") or "000000")

        face = None
        for s in srcs:
            lat = s.find(qn("a:latin"))
            if lat is not None and lat.get("typeface"):
                face = lat.get("typeface")
                break
        if face is None and self.font_ref_idx in ("major", "minor"):
            face = "+mj-lt" if self.font_ref_idx == "major" else "+mn-lt"
        if face is None:
            face = ctx.theme.major_font if self.is_title else ctx.theme.minor_font
        elif face in ("+mn-lt", "+mn-ea", "+mn-cs"):
            face = ctx.theme.minor_font
        elif face in ("+mj-lt", "+mj-ea", "+mj-cs"):
            face = ctx.theme.major_font

        hlink = None
        try:
            if rpr is not None:
                hl = rpr.find(qn("a:hlinkClick"))
                if hl is not None:
                    rid = hl.get(qn("r:id"))
                    if rid:
                        rel = ctx.slide.part.rels[rid]
                        hlink = rel.target_ref if rel.is_external else None
        except Exception:
            hlink = None

        return {
            "size_pt": size_pt, "bold": bold, "italic": italic,
            "u": bool(u and u != "none"), "caps": cap in ("all", "small"),
            "spc": (_int(spc) / 100.0) if spc else 0.0,
            "color": color, "face": face, "hlink": hlink,
        }

    def para_props(self, p_el):
        srcs, lvl = self.ppr_sources(p_el)
        algn = self.first_attr(srcs, "algn") or "l"
        lh = None
        for s in srcs:
            ln = s.find(qn("a:lnSpc"))
            if ln is None:
                continue
            pct = ln.find(qn("a:spcPct"))
            pts = ln.find(qn("a:spcPts"))
            if pct is not None:
                lh = ("pct", _int(pct.get("val"), 100000) / 100000.0)
            elif pts is not None:
                lh = ("pts", _int(pts.get("val")) / 100.0)
            break
        bullet = None
        for s in srcs:
            if s.find(qn("a:buNone")) is not None:
                bullet = None
                break
            bc = s.find(qn("a:buChar"))
            if bc is not None:
                bullet = bc.get("char") or "•"
                break
            if s.find(qn("a:buAutoNum")) is not None:
                bullet = "#"
                break
        spc = 0.0       # paragraph spacing before + after, in points
        for tag in ("a:spcBef", "a:spcAft"):
            for s in srcs:
                el = s.find(qn(tag))
                if el is None:
                    continue
                # Only absolute spacing (spcPts) is folded in; percentage
                # spacing (spcPct) depends on the line height and is skipped.
                pts = el.find(qn("a:spcPts"))
                if pts is not None:
                    spc += _int(pts.get("val")) / 100.0
                break
        return {
            "align": {"ctr": "center", "r": "right", "just": "left", "dist": "center"}.get(algn, "left"),
            "lh": lh, "bullet": bullet, "lvl": lvl, "spc": spc,
            "marL": _int(self.first_attr(srcs, "marL"), 0),
            "indent": _int(self.first_attr(srcs, "indent"), 0),
        }


def _autofit(sp_el):
    """normAutofit → (fontScale 0–1, lnSpcReduction 0–1)."""
    try:
        body_pr = sp_el.find(qn("p:txBody") + "/" + qn("a:bodyPr"))
        na = body_pr.find(qn("a:normAutofit")) if body_pr is not None else None
        if na is None:
            return 1.0, 0.0
        fs, lr = na.get("fontScale"), na.get("lnSpcReduction")
        font_scale = (int(fs) / 100000.0) if fs else 1.0
        lh_reduction = (int(lr) / 100000.0) if lr else 0.0
        return max(0.1, min(1.0, font_scale)), max(0.0, min(0.8, lh_reduction))
    except Exception:
        return 1.0, 0.0


def _body_pr(sp_el):
    try:
        return sp_el.find(qn("p:txBody") + "/" + qn("a:bodyPr"))
    except Exception:
        return None


def _text_valign(sp_el) -> str:
    bp = _body_pr(sp_el)
    anchor = bp.get("anchor") if bp is not None else None
    return {"ctr": "middle", "b": "bottom"}.get(anchor, "top")


def _inset_box(box, sp_el, ctx):
    """Shrink a frame by its bodyPr insets (defaults 0.1" / 0.05")."""
    bp = _body_pr(sp_el)

    def get(k, d):
        return _int(bp.get(k), d) if bp is not None else d

    l, r = get("lIns", 91440) * ctx.emu_x, get("rIns", 91440) * ctx.emu_x
    t, b = get("tIns", 45720) * ctx.emu_y, get("bIns", 45720) * ctx.emu_y
    out = dict(box)
    if out["w"] - l - r >= 8:
        out["x"] = round(out["x"] + l, 2)
        out["w"] = round(out["w"] - l - r, 2)
    if out["h"] - t - b >= 8:
        out["y"] = round(out["y"] + t, 2)
        out["h"] = round(out["h"] - t - b, 2)
    return out


def _paragraph_items(p_el):
    """(text, rPr) pieces of a paragraph, including line breaks and fields."""
    items = []
    for child in p_el:
        name = _local(child)
        if name in ("r", "fld"):
            t = child.find(qn("a:t"))
            items.append(((t.text or "") if t is not None else "", child.find(qn("a:rPr"))))
        elif name == "br":
            items.append(("\n", child.find(qn("a:rPr"))))
    return items


def _shape_text_plain(sp_el) -> str:
    try:
        tx = sp_el.find(qn("p:txBody"))
        if tx is None:
            return ""
        lines = ["".join(t for t, _ in _paragraph_items(p)) for p in tx.findall(qn("a:p"))]
        return "\n".join(lines).strip()
    except Exception:
        return ""


def _build_rich_text(ctx, shape, sp_el):
    """Walk every paragraph/run with full inheritance.

    Returns dict(text, runs, base, align, lh, link) or None for empty text.
    """
    tx = sp_el.find(qn("p:txBody"))
    if tx is None:
        return None
    ts = _TextStyle(ctx, shape, sp_el)
    autofit_scale, lh_reduction = _autofit(sp_el)
    px = ctx.pt_px * autofit_scale

    pieces = []        # (text, props | None)
    first_para = None
    lh_val = None
    paras = tx.findall(qn("a:p"))
    num = 0
    para_spc = []
    for pi, p in enumerate(paras):
        pp = ts.para_props(p)
        items = _paragraph_items(p)
        has_text = any((t or "").strip() for t, _ in items)
        if has_text and first_para is None:
            first_para = pp
        if has_text and lh_val is None and pp["lh"] is not None:
            lh_val = pp["lh"]
        if has_text:
            para_spc.append(pp["spc"])
        if has_text and pp["bullet"]:
            first_rpr = items[0][1] if items else None
            bprops = ts.run_props(p, first_rpr)
            # Plain text has no hanging indent, so approximate PowerPoint's
            # bullet position (marL + indent) and text start (marL) with
            # spaces — a space is ~0.25 em, a bullet glyph ~0.45 em.
            em_pt = max(1.0, bprops["size_pt"])
            lead_em = max(0.0, (pp["marL"] + pp["indent"]) / EMU_PER_PT / em_pt)
            gap_em = max(0.0, -pp["indent"] / EMU_PER_PT / em_pt)
            mark = f"{num + 1}." if pp["bullet"] == "#" else pp["bullet"]
            if pp["bullet"] == "#":
                num += 1
            lead = " " * min(24, int(round(lead_em / 0.25)))
            gap = " " * max(1, min(12, int(round((gap_em - 0.45 * len(mark)) / 0.25))))
            pieces.append((lead + mark + gap, bprops))
        elif not pp["bullet"]:
            num = 0
        for t, rpr in items:
            if not t:
                continue
            props = ts.run_props(p, rpr)
            if props["caps"]:
                t = t.upper()
            pieces.append((t, props))
        if pi < len(paras) - 1:
            pieces.append(("\n", None))

    # Trim blank leading/trailing paragraphs while keeping runs aligned.
    while pieces and not pieces[0][0].strip():
        pieces.pop(0)
    while pieces and not pieces[-1][0].strip():
        pieces.pop()
    text = "".join(t for t, _ in pieces)
    if not text.strip():
        return None

    # Base style = the style carrying the most visible characters.
    weight = {}
    for t, props in pieces:
        if props is None or not t.strip():
            continue
        key = (props["color"], props["bold"], props["italic"], round(props["size_pt"], 2),
               props["face"], props["u"], props["spc"])
        weight[key] = weight.get(key, 0) + len(t.strip())
    if not weight:
        return None
    bk = max(weight, key=weight.get)
    base = {
        "color": bk[0], "weight": 700 if bk[1] else 400, "italic": bk[2],
        "size": max(6, int(round(bk[3] * px))), "font": _font_css(bk[4]),
        "u": bk[5], "ls": round(bk[6] * ctx.pt_px, 2),
    }

    # Line height. PowerPoint "single" (100 %) ≈ 1.2× the font size.
    if lh_val is None:
        lh = 1.2
    elif lh_val[0] == "pct":
        lh = 1.2 * lh_val[1]
    else:
        lh = lh_val[1] / max(1.0, bk[3])
    lh = lh * (1.0 - lh_reduction)
    # Hanns text has no paragraph spacing, so fold PowerPoint's space
    # before/after into the line pitch for multi-paragraph boxes (lists).
    if len(para_spc) >= 2:
        avg = sum(para_spc) / len(para_spc)
        if avg > 0:
            lh += (avg * autofit_scale) / max(1.0, bk[3])
    lh = max(0.8, min(3.0, round(lh, 3)))

    # Runs: only the properties that differ from the base.
    runs = []
    links = set()
    for t, props in pieces:
        r = {"t": t}
        if props is not None:
            if props["color"] != base["color"]:
                r["color"] = props["color"]
            w = 700 if props["bold"] else 400
            if w != base["weight"]:
                r["weight"] = w
            if props["italic"] != base["italic"]:
                r["italic"] = props["italic"]
            s = max(6, int(round(props["size_pt"] * px)))
            if s != base["size"]:
                r["size"] = s
            f = _font_css(props["face"])
            if f != base["font"]:
                r["font"] = f
            if props["u"] != base["u"]:
                r["u"] = props["u"]
            ls = round(props["spc"] * ctx.pt_px, 2)
            if ls != base["ls"]:
                r["ls"] = ls
            if t.strip():
                links.add(props.get("hlink"))
        if t == "\n" and runs:
            runs[-1]["t"] += t          # newlines ride on the previous run
            continue
        if runs and {k: v for k, v in runs[-1].items() if k != "t"} == \
                {k: v for k, v in r.items() if k != "t"}:
            runs[-1]["t"] += t
        else:
            runs.append(r)
    has_overrides = any(len(r) > 1 for r in runs)
    whole_link = next(iter(links)) if len(links) == 1 else None
    return {
        "text": text,
        "runs": runs if has_overrides and "".join(r["t"] for r in runs) == text else None,
        "base": base,
        "align": (first_para or {}).get("align", "left"),
        "lh": lh,
        "link": whole_link,
    }


_TEXT_PAD_X, _TEXT_PAD_Y = 2.4, 1.6


def _text_element(ctx, shape, sp_el, box, anims):
    rich = _build_rich_text(ctx, shape, sp_el)
    if not rich:
        return None
    base = rich["base"]
    if rich["link"]:
        return {
            "id": _uid(), "type": "link", **box,
            "anim": "rise", "animDelay": 0,
            "url": rich["link"],
            "label": rich["text"].split("\n")[0][:80],
            "description": rich["link"],
            "linkStyle": "button",
            "accent": base["color"], "textColor": "#ffffff", "bg": base["color"],
            "radius": 18,
            **_anim_for(shape, anims),
        }
    tbox = _inset_box(box, sp_el, ctx)
    # Hanns pads text boxes by .1em .15em (1.6 × 2.4 px); grow the frame by
    # the same amount so lines break exactly where PowerPoint breaks them.
    tbox = {**tbox, "x": round(tbox["x"] - _TEXT_PAD_X, 2), "w": round(tbox["w"] + 2 * _TEXT_PAD_X, 2),
            "y": round(tbox["y"] - _TEXT_PAD_Y, 2), "h": round(tbox["h"] + 2 * _TEXT_PAD_Y, 2)}
    el = {
        "id": _uid(),
        "type": "text",
        **tbox,
        "anim": "fade",
        "animDelay": 0,
        "text": rich["text"],
        "font": base["font"],
        "size": base["size"],
        "weight": base["weight"],
        "italic": base["italic"],
        "color": base["color"],
        "align": rich["align"],
        "valign": _text_valign(sp_el),
        "lh": rich["lh"],
        "ls": base["ls"],
        "fill": "none",
        **_anim_for(shape, anims),
    }
    if base["u"]:
        el["underline"] = True
    if rich["runs"]:
        el["runs"] = rich["runs"]
        # Snapshot of the base so the renderer can tell when the user later
        # restyles the whole box (then the per-run overrides step aside).
        el["runsBase"] = {k: el[k] for k in ("color", "size", "weight", "italic", "font", "ls")}
    return el


# ─────────────────────────── animation import ───────────────────────────

def _direction_anim(subtype: int) -> str:
    if subtype & 4:
        return "rise"
    if subtype & 1:
        return "drop"
    if subtype & 8:
        return "left"
    if subtype & 2:
        return "right"
    return "rise"


def _preset_to_anim(preset_id: int, subtype: int) -> str:
    if preset_id in (1, 9, 10):
        return "fade"
    if preset_id in (2, 7, 12):
        return _direction_anim(subtype)
    if preset_id == 22:
        return "revealUp" if subtype & (1 | 4) else "reveal"
    if preset_id in (3, 5, 14, 18):
        return "reveal"
    if preset_id in (4, 6, 8, 13, 16, 20, 23):
        return "zoom"
    if preset_id == 17:
        return "pop"
    if preset_id == 19:
        return "flipx"
    if preset_id in (15, 21):
        return "spin"
    return "fade"


def _entrance_animations(slide) -> dict[int, dict]:
    out: dict[int, dict] = {}
    try:
        timing = slide._element.find(qn("p:timing"))
        if timing is None:
            return out
        for ctn in timing.iter(qn("p:cTn")):
            if ctn.get("presetClass") != "entr":
                continue
            preset_id = _int(ctn.get("presetID"), 0)
            subtype = _int(ctn.get("presetSubtype"), 0)
            delay_ms = 0.0
            st = ctn.find(qn("p:stCondLst"))
            if st is not None:
                cond = st.find(qn("p:cond"))
                if cond is not None:
                    raw = cond.get("delay")
                    if raw and raw != "indefinite":
                        try:
                            delay_ms = float(raw)
                        except ValueError:
                            delay_ms = 0.0
            dur_ms = 0.0
            for beh in ctn.iter(qn("p:cTn")):
                if beh is ctn:
                    continue
                raw = beh.get("dur")
                if raw and raw not in ("indefinite", "0"):
                    try:
                        dur_ms = max(dur_ms, float(raw))
                    except ValueError:
                        pass
            sp_tgt = ctn.find(".//" + qn("p:spTgt"))
            if sp_tgt is None:
                continue
            spid = _int(sp_tgt.get("spid"), -1)
            if spid < 0:
                continue
            entry = {
                "anim": _preset_to_anim(preset_id, subtype),
                "animDelay": round(min(8.0, delay_ms / 1000.0), 2),
            }
            if dur_ms:
                entry["animDur"] = round(min(5.0, dur_ms / 1000.0), 2)
            out.setdefault(spid, entry)
        return out
    except Exception:
        return out


def _anim_for(shape, anims: dict[int, dict]) -> dict:
    try:
        entry = anims.get(int(shape.shape_id))
        return dict(entry) if entry else {}
    except Exception:
        return {}


# ─────────────────────────── media ───────────────────────────

def _save_blob(deck, blob, ext, prefix=""):
    ext = (ext or "png").lower().lstrip(".")
    if ext == "jpeg":
        ext = "jpg"
    rel_path = f"hanns/decks/{deck.code}/imports/{prefix}{uuid.uuid4().hex}.{ext}"
    saved = default_storage.save(rel_path, ContentFile(blob))
    return _media_url(saved)


def _crop_blob(blob, src_rect):
    """Apply an <a:srcRect> crop with Pillow. Returns (blob, ext) or None."""
    if src_rect is None:
        return None
    l, t = _int(src_rect.get("l")) / 100000.0, _int(src_rect.get("t")) / 100000.0
    r, b = _int(src_rect.get("r")) / 100000.0, _int(src_rect.get("b")) / 100000.0
    if not any((l, t, r, b)):
        return None
    try:
        from PIL import Image as PILImage
        im = PILImage.open(io.BytesIO(blob))
        im.load()
        W, H = im.size
        box = (max(0, int(round(l * W))), max(0, int(round(t * H))),
               min(W, int(round(W - r * W))), min(H, int(round(H - b * H))))
        if box[2] - box[0] < 2 or box[3] - box[1] < 2:
            return None
        out = io.BytesIO()
        fmt = "PNG" if im.mode in ("RGBA", "LA", "P") else "JPEG"
        img = im.crop(box)
        if fmt == "JPEG" and img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        img.save(out, format=fmt)
        return out.getvalue(), ("png" if fmt == "PNG" else "jpg")
    except Exception:
        return None


def _shape_image(shape):
    """The embedded image of ANY shape that carries one (pictures,
    picture placeholders, linked pictures)."""
    try:
        image = shape.image
    except (AttributeError, ValueError, KeyError, TypeError):
        return None
    return image if getattr(image, "blob", None) else None


def _picture_radius(sp_el, box):
    prst, adj = _prst(sp_el)
    if prst in _ELLIPSE_PRSTS:
        return round(min(box["w"], box["h"]) / 2.0, 2)
    if prst == "roundRect":
        return round(adj.get("adj", 16667) / 100000.0 * min(box["w"], box["h"]), 2)
    return 0


def _shape_alt(sp_el, default):
    try:
        c = sp_el.find(".//" + qn("p:cNvPr"))
        return ((c.get("descr") if c is not None else None) or default)[:200]
    except Exception:
        return default


def _image_element(ctx, shape, box, anims):
    try:
        image = _shape_image(shape)
        if image is None:
            return None
        blob, ext = image.blob, image.ext
        sp_el = shape._element
        try:
            src_rect = sp_el.find(qn("p:blipFill") + "/" + qn("a:srcRect"))
        except Exception:
            src_rect = None
        cropped = _crop_blob(blob, src_rect)
        if cropped:
            blob, ext = cropped
        el = {
            "id": _uid(), "type": "image", **box,
            "anim": "fade", "animDelay": 0,
            "src": _save_blob(ctx.deck, blob, ext),
            # PowerPoint stretches a picture to its frame (after cropping).
            "fit": "100% 100%",
            "radius": _picture_radius(sp_el, box),
            "alt": _shape_alt(sp_el, "Imported PowerPoint image"),
            **_anim_for(shape, anims),
        }
        fx = ctx.shape_fx(sp_el)
        fh, fv = _flips(sp_el)
        if fh:
            fx["flipH"] = True
        if fv:
            fx["flipV"] = True
        if fx:
            el["fx"] = fx
        return el
    except Exception:
        return None


def _blip_fill_image(ctx, shape, blip_fill, box, anims):
    """An auto shape filled with a picture → Hanns image element."""
    try:
        blip = blip_fill.find(qn("a:blip"))
        rid = blip.get(qn("r:embed")) if blip is not None else None
        if not rid:
            return None
        part = shape.part.related_part(rid)
        ext = (part.partname.ext or "png")
        blob = part.blob
        cropped = _crop_blob(blob, blip_fill.find(qn("a:srcRect")))
        if cropped:
            blob, ext = cropped
        return {
            "id": _uid(), "type": "image", **box,
            "anim": "fade", "animDelay": 0,
            "src": _save_blob(ctx.deck, blob, ext),
            "fit": "100% 100%",
            "radius": _picture_radius(shape._element, box),
            "alt": "Imported PowerPoint picture fill",
            **_anim_for(shape, anims),
        }
    except Exception:
        return None


# ─────────────────────────── shapes ───────────────────────────

def _shape_elements(ctx, shape, box, anims, grp_fill):
    """Visible geometry of an auto shape / freeform → list of elements."""
    sp_el = shape._element
    kind, val = ctx.shape_fill(sp_el, grp_fill)
    stroke, stroke_w, dashed = ctx.shape_line(sp_el)
    anim = _anim_for(shape, anims)

    if kind == "blip":
        el = _blip_fill_image(ctx, shape, val, box, anims)
        return [el] if el else []

    visible_fill = kind in ("solid", "grad")
    if not visible_fill and not stroke:
        return []

    fx = ctx.shape_fx(sp_el)
    fh, fv = _flips(sp_el)
    if fh:
        fx["flipH"] = True
    if fv:
        fx["flipV"] = True

    prst, adj = _prst(sp_el)
    out = []

    def finish(el):
        if fx:
            el["fx"] = dict(fx)
        el.update(anim)
        out.append(el)

    # Non-rectangular geometry → a real vector freeform.
    polys = []
    if prst is None:
        try:
            polys = _cust_paths(sp_el, int(shape.width or 0), int(shape.height or 0))
        except Exception:
            polys = []
    elif prst not in _RECT_PRSTS and prst not in _ELLIPSE_PRSTS and prst != "roundRect":
        pts = _preset_points(prst, adj, box["w"], box["h"])
        if pts:
            polys = [([{"x": round(x, 2), "y": round(y, 2)} for x, y in pts], True, True)]

    if polys:
        for points, closed, filled in polys:
            el = {
                "id": _uid(), "type": "freeform", **box,
                "anim": "fade", "animDelay": 0,
                "shapeKind": "custom", "points": points,
                "closed": bool(closed), "corner": 0, "smooth": False,
                "sides": 6, "inset": 0.45,
                "fillMode": "none", "fill": "#e8482b", "fill2": "#f2c14e", "gradAngle": 135,
                "stroke": stroke or "none", "strokeW": stroke_w if stroke else 0,
                "dash": 4 if dashed else 0,
            }
            if filled and kind == "solid":
                el["fillMode"], el["fill"] = "solid", val
            elif filled and kind == "grad":
                el["fillMode"] = "radial" if val["type"] == "radial" else "linear"
                el["fill"], el["fill2"] = val["stops"][0][1], val["stops"][-1][1]
                el["gradAngle"] = round(val["angle"], 1)
            finish(el)
        return out

    typ = "ellipse" if prst in _ELLIPSE_PRSTS else "rect"
    radius = 0
    if prst == "roundRect":
        radius = round(adj.get("adj", 16667) / 100000.0 * min(box["w"], box["h"]), 2)
    finish({
        "id": _uid(), "type": typ, **box,
        "anim": "fade", "animDelay": 0,
        "fill": ctx.fill_css(kind, val, "none"),
        "stroke": stroke or "none",
        "strokeW": stroke_w if stroke else 0,
        "dashed": dashed,
        "radius": radius,
    })
    return out


def _line_element(ctx, shape, box, anims):
    sp_el = shape._element
    stroke, stroke_w, dashed = ctx.shape_line(sp_el)
    if not stroke:
        # A connector with no explicit colour still draws in PowerPoint.
        stroke = "#" + (ctx.scheme_hex("tx1") or "16140F")
        stroke_w = max(1.0, stroke_w or 1.0)
    thickness = max(1.0, stroke_w)
    fh, fv = _flips(sp_el)
    w, h = box["w"], box["h"]
    # A Hanns line is a horizontal bar rotated about its centre, so a
    # diagonal connector keeps its true length and angle.
    if w > 6 and h > 6:
        length = math.hypot(w, h)
        ang = math.degrees(math.atan2(h, w))
        if fh != fv:
            ang = -ang
        cx, cy = box["x"] + w / 2.0, box["y"] + h / 2.0
        nb = {"x": round(cx - length / 2.0, 2), "y": round(cy - thickness / 2.0, 2),
              "w": round(length, 2), "h": round(thickness, 2),
              "rot": round((box.get("rot") or 0) + ang, 2)}
    elif w >= h:
        nb = dict(box, y=round(box["y"] + h / 2.0 - thickness / 2.0, 2), h=thickness)
    else:
        nb = dict(box, x=round(box["x"] + w / 2.0 - thickness / 2.0, 2), w=thickness)
    return {
        "id": _uid(), "type": "line", **nb,
        "anim": "reveal", "animDelay": 0,
        "fill": stroke, "strokeW": thickness, "dashed": dashed,
        **_anim_for(shape, anims),
    }


# ─────────────────────────── tables ───────────────────────────

def _cell_style(ctx, tc):
    st = {}
    try:
        tcpr = tc.find(qn("a:tcPr"))
        k, v = ctx.fill_in(tcpr)
        if k in ("solid", "grad"):
            st["bg"] = ctx.fill_css(k, v)
        tx = tc.find(qn("a:txBody"))
        if tx is not None:
            for p in tx.findall(qn("a:p")):
                ppr = p.find(qn("a:pPr"))
                if ppr is not None and ppr.get("algn") and "align" not in st:
                    st["align"] = {"ctr": "center", "r": "right"}.get(ppr.get("algn"), "left")
                for r in p.findall(qn("a:r")):
                    rpr = r.find(qn("a:rPr"))
                    if rpr is None:
                        continue
                    if "color" not in st:
                        ck, cv = ctx.fill_in(rpr)
                        if ck == "solid":
                            st["color"] = cv
                    if "bold" not in st and rpr.get("b") is not None:
                        st["bold"] = _truthy(rpr.get("b"))
                    if "size_pt" not in st and rpr.get("sz"):
                        st["size_pt"] = _int(rpr.get("sz")) / 100.0
                    if "face" not in st:
                        lat = rpr.find(qn("a:latin"))
                        if lat is not None and lat.get("typeface"):
                            st["face"] = lat.get("typeface")
        if tcpr is not None:
            lnb = tcpr.find(qn("a:lnB"))
            if lnb is not None:
                bk, bv = ctx.fill_in(lnb)
                if bk == "solid":
                    st["border"] = bv
    except Exception:
        pass
    return st


def _table_element(ctx, shape, box, anims):
    try:
        tbl_el = shape.table._tbl
        data, styles = [], []
        for tr in tbl_el.findall(qn("a:tr")):
            row, srow = [], []
            for tc in tr.findall(qn("a:tc")):
                tx = tc.find(qn("a:txBody"))
                txt = ""
                if tx is not None:
                    txt = "\n".join("".join(t for t, _ in _paragraph_items(p))
                                    for p in tx.findall(qn("a:p"))).strip()
                row.append(txt)
                srow.append(_cell_style(ctx, tc))
            data.append(row)
            styles.append(srow)
        if not data:
            return None
        tblpr = tbl_el.find(qn("a:tblPr"))
        header = (_truthy(tblpr.get("firstRow"))
                  if tblpr is not None and tblpr.get("firstRow") is not None else True)
        banded = _truthy(tblpr.get("bandRow")) if tblpr is not None else False

        def pick(rows, key):
            for r in rows:
                for c in r:
                    if c.get(key):
                        return c[key]
            return None

        head_rows = styles[:1] if header else []
        body_rows = styles[1:] if header else styles
        size_pt = pick(body_rows, "size_pt") or pick(styles, "size_pt") or 14
        face = pick(body_rows, "face") or pick(styles, "face") or ctx.theme.minor_font
        el = {
            "id": _uid(), "type": "table", **box,
            "anim": "rise", "animDelay": 0,
            "rows": len(data), "cols": max(len(r) for r in data),
            "header": header, "striped": banded, "headerPlain": True,
            "theme": "clean",
            "font": _font_css(face),
            "size": max(8, int(round(size_pt * ctx.pt_px))),
            "tableData": data,
            **_anim_for(shape, anims),
        }
        hb, hc = pick(head_rows, "bg"), pick(head_rows, "color")
        if hb:
            el["accent"] = el["headerColor"] = hb
        if hc:
            el["headerTextColor"] = hc
        bc = pick(body_rows, "color")
        if bc:
            el["textColor"] = bc
        if len(body_rows) >= 2 and body_rows[1] and body_rows[1][0].get("bg"):
            el["rowAltColor"] = body_rows[1][0]["bg"]
        border = pick(styles, "border")
        if border:
            el["borderColor"] = border
        cell_styles = [[{k: v for k, v in c.items() if k in ("bg", "color", "bold", "align")}
                        for c in r] for r in styles]
        if any(any(c for c in r) for r in cell_styles):
            el["cellStyles"] = cell_styles
        return el
    except Exception:
        return None


# ─────────────────────────── charts ───────────────────────────

_XL_TO_HANNS_KIND = {
    "BAR": "horizontalBar", "BAR_CLUSTERED": "horizontalBar", "BAR_STACKED": "horizontalBar",
    "COLUMN_CLUSTERED": "bar", "COLUMN_STACKED": "stackedBar",
    "PIE": "pie", "PIE_EXPLODED": "pie",
    "DOUGHNUT": "donut", "DOUGHNUT_EXPLODED": "donut",
    "LINE": "line", "LINE_MARKERS": "line", "LINE_STACKED": "line",
    "AREA": "area", "AREA_STACKED": "area",
    "XY_SCATTER": "scatter", "XY_SCATTER_LINES": "scatter", "XY_SCATTER_SMOOTH": "spline",
    "RADAR": "radar", "RADAR_FILLED": "radar", "RADAR_MARKERS": "radar",
}


def _sppr_color(ctx, el):
    """Solid colour of a chart element's c:spPr (fill, else outline)."""
    try:
        sppr = el.find(qn("c:spPr"))
        if sppr is None:
            return None
        k, v = ctx.fill_in(sppr)
        if k == "solid":
            return v
        if k == "grad":
            return v["stops"][0][1]
        k, v = ctx.fill_in(sppr.find(qn("a:ln")))
        if k == "solid":
            return v
    except Exception:
        pass
    return None


def _sv(series, i):
    try:
        vals = list(series.values)
        v = vals[i] if i < len(vals) else 0
        return round(float(v), 3) if v is not None else 0
    except Exception:
        return 0


def _chart_element(ctx, shape, box, anims):
    title = ""
    kind = "bar"
    chart_data = None
    palette = []
    series_names = []
    try:
        chart = shape.chart
        try:
            if chart.has_title and chart.chart_title and chart.chart_title.text_frame:
                title = chart.chart_title.text_frame.text or title
        except Exception:
            pass
        xl_name = str(getattr(chart, "chart_type", "") or "")
        xl_name = xl_name.split(" ")[0] if xl_name else ""
        kind = _XL_TO_HANNS_KIND.get(xl_name, "bar")

        plots = list(chart.plots)
        if plots:
            cats = [str(c) for c in plots[0].categories]
            all_series = [s for plot in plots for s in plot.series]
            series_names = [str(s.name or f"Series {i+1}") for i, s in enumerate(all_series)]
            if kind in ("pie", "donut") and all_series:
                # Pie slices are coloured per data point.
                for dpt in all_series[0]._element.findall(qn("c:dPt")):
                    col = _sppr_color(ctx, dpt)
                    if col:
                        palette.append(col)
            if not palette:
                # One colour per series; a series with no explicit fill takes
                # the theme accent PowerPoint would give it (accent1, 2, …).
                for i, s in enumerate(all_series):
                    palette.append(_sppr_color(ctx, s._element) or
                                   "#" + ctx.scheme_hex(f"accent{i % 6 + 1}"))
            if not palette:
                palette = ["#" + ctx.scheme_hex(f"accent{i}") for i in range(1, 7)]

            if len(all_series) >= 2 and kind in ("bar", "horizontalBar", "stackedBar"):
                if kind != "stackedBar":
                    kind = "groupedBar"
                chart_data = []
                for i, label in enumerate(cats):
                    vals = [_sv(s, i) for s in all_series[:6]]
                    # `series` is what the Hanns renderer reads for grouped /
                    # stacked bars (without it, it invents 65 % / 35 % bars);
                    # value2… is kept for older readers.
                    row = {"label": label, "value": vals[0], "series": vals}
                    for j, v in enumerate(vals[1:], start=2):
                        row[f"value{j}"] = v
                    chart_data.append(row)
            elif all_series:
                s0 = all_series[0]
                chart_data = [
                    {"label": (cats[i] if i < len(cats) else f"#{i+1}"), "value": _sv(s0, i)}
                    for i in range(max(len(cats), len(list(s0.values) or [])))
                ]
    except Exception as exc:
        ctx.warnings.append(f"Chart data could not be fully read ({exc}); imported an editable placeholder.")

    el = {
        "id": _uid(), "type": "chart", **box,
        "anim": "rise", "animDelay": 0,
        "chartKind": kind, "chartType": kind,
        "renderEngine": "svg",
        "title": title,
        "showTitle": bool(title),
        "accent": (palette[0] if palette else "#e8482b"),
        "showValues": True, "showLabels": True,
        "chartData": chart_data or [{"label": "Imported", "value": 1}, {"label": "Edit", "value": 1}],
        **_anim_for(shape, anims),
    }
    if palette:
        el["palette"] = palette
    if len(series_names) > 1:
        el["seriesNames"] = series_names
        el["showLegend"] = True
    return el


# ─────────────────────────── backgrounds ───────────────────────────

def _bg_picture_url(ctx, blip_fill, part) -> str | None:
    try:
        blip = blip_fill.find(qn("a:blip"))
        r_id = blip.get(qn("r:embed")) if blip is not None else None
        if not r_id:
            return None
        image_part = part.related_part(r_id)
        return _save_blob(ctx.deck, image_part.blob, image_part.partname.ext, prefix="bg_")
    except Exception:
        return None


def _slide_background(ctx) -> tuple[str, str | None]:
    """(bg CSS, bgSize) for the slide, walking slide → layout → master."""
    for holder in (ctx.slide, ctx.layout, ctx.master):
        if holder is None:
            continue
        try:
            bg = holder._element.find(qn("p:cSld") + "/" + qn("p:bg"))
            if bg is None:
                continue
            bg_pr = bg.find(qn("p:bgPr"))
            if bg_pr is not None:
                kind, val = ctx.fill_in(bg_pr)
            else:
                ref = bg.find(qn("p:bgRef"))
                if ref is None:
                    continue
                idx = _int(ref.get("idx"), 0)
                ph = ctx.color(_first_color_child(ref))
                kind, val = None, None
                try:
                    style = (ctx.theme.bg_fill_styles[idx - 1001] if idx >= 1001
                             else ctx.theme.fill_styles[idx - 1] if idx >= 1 else None)
                    if style is not None:
                        kind, val = ctx.fill(style, ph)
                except Exception:
                    kind, val = None, None
                if kind is None and ph:
                    kind, val = "solid", _rgba_css(*ph)
            if kind == "solid":
                return val, None
            if kind == "grad":
                return ctx.gradient_css(val), None
            if kind == "blip":
                url = _bg_picture_url(ctx, val, holder.part)
                if url:
                    return f'url("{url}") center/cover no-repeat', "cover"
            if kind == "none":
                break
        except Exception:
            continue
    return "#" + (ctx.scheme_hex("bg1") or "FFFFFF"), None


# ─────────────────────────── shape walk ───────────────────────────

def _is_hidden(sp_el) -> bool:
    try:
        c = sp_el.find(".//" + qn("p:cNvPr"))
        return c is not None and _truthy(c.get("hidden"))
    except Exception:
        return False


def _elements_from_shape(ctx, shape, anims, xf=_IDENTITY, grp_fill=None):
    elements = []
    sp_el = shape._element
    if _is_hidden(sp_el):
        return elements
    stype = getattr(shape, "shape_type", None)

    try:
        if stype == MSO_SHAPE_TYPE.GROUP:
            child_xf = _compose_group(xf, shape)
            gk, gv = ctx.fill_in(sp_el.find(qn("p:grpSpPr")), grp=grp_fill)
            gfill = (gk, gv) if gk is not None else grp_fill
            group_anim = _anim_for(shape, anims)
            for child in getattr(shape, "shapes", []):
                kids = _elements_from_shape(ctx, child, anims, child_xf, gfill)
                if group_anim:
                    for k in kids:
                        if k.get("anim") in (None, "fade"):
                            k.update(group_anim)
                elements.extend(kids)
            return elements
    except Exception:
        pass

    box = _box(shape, ctx, xf)

    try:
        if getattr(shape, "has_table", False):
            el = _table_element(ctx, shape, box, anims)
            if el:
                return [el]
    except Exception:
        pass

    try:
        if getattr(shape, "has_chart", False):
            return [_chart_element(ctx, shape, box, anims)]
    except Exception:
        pass

    try:
        if _shape_image(shape) is not None:
            el = _image_element(ctx, shape, box, anims)
            if el:
                if stype == MSO_SHAPE_TYPE.MEDIA:
                    el["alt"] = "Imported video poster frame"
                    ctx.warnings.append("One video was imported as its poster image "
                                        "(Hanns video elements can re-link the file).")
                return [el]
    except Exception:
        pass

    has_text = bool(_shape_text_plain(sp_el))

    try:
        if stype == MSO_SHAPE_TYPE.LINE or (not has_text and _is_line_geometry(shape)):
            return [_line_element(ctx, shape, box, anims)]
    except Exception:
        pass

    # Geometry (fill / outline). Text boxes with no fill and no outline
    # produce nothing here — no stray boxes behind text.
    try:
        if _local(sp_el) in ("sp", "cxnSp"):
            elements.extend(_shape_elements(ctx, shape, box, anims, grp_fill))
    except Exception:
        pass

    if has_text:
        try:
            el = _text_element(ctx, shape, sp_el, box, anims)
            if el:
                if el.get("type") == "link" and elements:
                    # The button replaces the plain shape underneath it.
                    shp = elements[-1]
                    if shp.get("type") in ("rect", "ellipse") and \
                            str(shp.get("fill") or "").startswith(("#", "rgb")):
                        el["bg"] = el["accent"] = shp["fill"]
                        elements.pop()
                elements.append(el)
        except Exception:
            pass
    return elements


def _show_master_sp(holder) -> bool:
    try:
        return holder._element.get("showMasterSp") not in ("0", "false")
    except Exception:
        return True


def _decor_shapes(holder):
    """Non-placeholder shapes of a layout/master (logos, bars, frames)."""
    out = []
    try:
        for shp in holder.shapes:
            try:
                if shp.is_placeholder:
                    continue
            except Exception:
                pass
            out.append(shp)
    except Exception:
        pass
    return out


# ─────────────────────────── notes / assembly ───────────────────────────

def _slide_notes(slide, index: int, warnings: list[str]) -> str:
    note = ""
    try:
        if slide.has_notes_slide:
            note = (slide.notes_slide.notes_text_frame.text or "").strip()
    except Exception:
        note = ""
    if not note:
        note = f"Imported from PowerPoint slide {index + 1}."
    if warnings:
        note += "\n\n(Some complex PowerPoint features may need manual adjustment in Hanns.)"
    return note


def import_powerpoint_into_deck(*, request, deck, uploaded_file, replace: bool = True) -> dict:
    prs, original_name, tmpdir = _load_presentation(uploaded_file)
    warnings: list[str] = []
    theme_cache: dict = {}

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
            ctx = _Ctx(request=request, deck=deck, prs=prs, slide=slide,
                       theme_cache=theme_cache, warnings=slide_warnings)
            anims = _entrance_animations(slide)
            elements = []

            # Layout + master artwork sits BEHIND the slide's own shapes.
            decor = []
            if _show_master_sp(slide):
                if ctx.layout is not None and _show_master_sp(ctx.layout) and ctx.master is not None:
                    decor.extend(_decor_shapes(ctx.master))
                if ctx.layout is not None:
                    decor.extend(_decor_shapes(ctx.layout))
            for shape in decor:
                try:
                    elements.extend(_elements_from_shape(ctx, shape, {}))
                except Exception:
                    continue

            for shape in slide.shapes:
                try:
                    elements.extend(_elements_from_shape(ctx, shape, anims))
                except Exception as exc:
                    slide_warnings.append(f"Skipped one unsupported object on slide {idx + 1}: {exc}")

            if not elements:
                elements.append({
                    "id": _uid(), "type": "text",
                    "x": 90, "y": 210, "w": 780, "h": 90, "rot": 0,
                    "anim": "fade", "animDelay": 0,
                    "text": f"Imported slide {idx + 1}",
                    "font": '"Fraunces",serif', "size": 44, "weight": 700,
                    "italic": False, "color": "#16140f", "align": "center",
                    "lh": 1.15, "ls": 0, "fill": "none",
                })
                slide_warnings.append(f"Slide {idx + 1} had no editable objects Hanns could import.")

            bg_css, bg_size = _slide_background(ctx)

            warnings.extend(slide_warnings)
            slide_rows.append(Slide(deck=deck, position=idx, data={
                "bg": bg_css,
                "bgSize": bg_size,
                "bgFx": "none",
                "transition": "fade",
                "notes": _slide_notes(slide, idx, slide_warnings),
                "els": elements,
            }))

        if slide_rows:
            Slide.objects.bulk_create(slide_rows)
        else:
            Slide.objects.create(deck=deck, position=0, data={
                "bg": "#FFFFFF", "bgSize": None, "bgFx": "none",
                "transition": "fade",
                "notes": "PowerPoint import created a blank starter slide.",
                "els": [],
            })
            warnings.append("The PowerPoint file did not contain any slides.")

        return {"warnings": warnings, "slide_count": len(slide_rows)}
    finally:
        tmpdir.cleanup()
