"""
powerpoint_exporter.py — the 3D bar chart addition (objectType "bars_3d")

Three edits, all in powerpoint_exporter.py. Nothing else changes.

  1. Paste _std_bars_3d() below next to the other _std_* builders — after
     _std_bar_rows() is a natural home.

  2. Add the kind to STUDIO_KINDS (around line 1022), so the dispatcher
     recognises it as a studio object rather than an unknown one:

         STUDIO_KINDS = {
             "choropleth", "gradient_legend", "stat_block", "kpi_grid", "bullet_bars",
             "slope_chart", "waffle", "ring_grid", "process_steps", "timeline_track",
             "rank_bars", "matrix_2x2", "venn", "pyramid_tiers", "sankey_flow",
             "heat_grid", "quote_card",
             "bars_3d",                                        # <- add
             # mechanical objects
             "sand_timer", "clock_face", "gears", "charge_meter", "temp_gauge", "speedometer",
         }

  3. Add the render entry to _STUDIO_NATIVE (around line 1780):

         _STUDIO_NATIVE = {
             ...
             "sand_timer":     _std_hourglass,
             "bars_3d":        _std_bars_3d,                    # <- add
         }

WHY NATIVE CUBES AND CANS RATHER THAN FREEFORM QUADS
----------------------------------------------------
The browser draws each bar as three SVG quads. Rebuilding those as PPTX
freeforms would give a pixel match but leave the deck full of shapes
nobody can edit — drag one corner and the extrusion falls apart.

PowerPoint already ships the two solids this chart is made of:
MSO_SHAPE.CUBE is an extruded block with the same front/top/right faces,
and MSO_SHAPE.CAN is a cylinder, which is exactly a coin. Both stay
draggable, recolourable and resizable in PowerPoint, which is the whole
point of the native path in this exporter. The trade is that PowerPoint
fixes its own extrusion depth ratio, so the depth will not match the
browser to the pixel. The chart reads the same.

The grow animation does not survive: the exporter's _AnimFx registers
entrance effects per shape, so each bar gets a "rise" wipe from the
bottom, which is the closest native equivalent. The bars still arrive
one after another.
"""

from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN
from pptx.dml.color import RGBColor
from pptx.util import Pt


def _b3d_solid(slide, x, y, w, h, fill, shape):
    """A CUBE or CAN at pixel coords, filled flat with no outline.

    _rect() is hard-wired to RECTANGLE / ROUNDED_RECTANGLE, so this is the
    same body with the shape passed in.
    """
    shp = slide.shapes.add_shape(
        shape, _px_to_emu(x), _px_to_emu(y),
        _px_to_emu(max(2, w)), _px_to_emu(max(2, h)))
    shp.fill.solid()
    shp.fill.fore_color.rgb = RGBColor.from_string(fill)
    shp.line.fill.background()
    return shp


def _std_bars_3d(slide, el):
    """3D bars: extruded cubes, or stacks of coins when barSkin is "coins"."""
    x, y, w, h = _studio_frame(el)
    rows = _studio_rows(el)
    if not rows:
        return None

    srt = str(el.get("sort") or "none")
    if srt == "desc":
        rows.sort(key=lambda r: -r["value"])
    elif srt == "asc":
        rows.sort(key=lambda r: r["value"])

    top = _studio_title(slide, el, x, y, w)
    y += top
    h -= top

    hi = _num(el.get("max"), 0) or max([r["value"] for r in rows] + [1])
    n = len(rows)
    dark = bool(el.get("dark"))
    coins = str(el.get("barSkin") or "solid") == "coins"
    ink = "E6EDF5" if dark else "0F172A"

    # Reserve the bottom strip for category labels and the top for values,
    # the same split the browser makes; what is left is the bar field.
    lab_h = min(30.0, h * 0.14)
    val_h = min(28.0, h * 0.13) if el.get("showValues") is not False else 0.0
    field_h = max(24.0, h - lab_h - val_h)
    field_y = y + val_h

    # Cube shading eats into the drawn box, so the footprint is narrower
    # than the slot. 0.62 leaves room for the extrusion without the bars
    # touching.
    slot = w / n
    bar_w = slot * 0.62

    # Coins are quantised: one coin per unit, capped so the tallest stack
    # is legible rather than a tower of slivers.
    max_coins = max(6, min(14, int(round(14 - n * 0.4))))

    for i, r in enumerate(rows):
        c = (r["color"] or _series_color(el, i, n)).replace("#", "").upper()
        frac = max(0.0, min(1.0, r["value"] / hi))
        bx = x + i * slot + (slot - bar_w) / 2

        if coins:
            count = max(1, int(round(max_coins * frac)))
            pitch = field_h / max_coins
            coin_h = pitch * 1.25          # overlap, so the stack reads solid
            for k in range(count):
                cy = field_y + field_h - (k + 1) * pitch - (coin_h - pitch)
                _b3d_solid(slide, bx, cy, bar_w, coin_h, c, MSO_SHAPE.CAN)
            bar_h = count * pitch
        else:
            bar_h = max(6.0, field_h * frac)
            _b3d_solid(slide, bx, field_y + field_h - bar_h, bar_w, bar_h, c,
                       MSO_SHAPE.CUBE)

        if val_h:
            _txt_box(slide, x + i * slot, field_y + field_h - bar_h - val_h,
                     slot, val_h, _studio_fmt(el, r["value"]),
                     size=min(16, val_h * 0.72), bold=True, color=ink,
                     align=PP_ALIGN.CENTER)

        _txt_box(slide, x + i * slot, y + h - lab_h, slot, lab_h, r["label"],
                 size=min(15, lab_h * 0.62), bold=True, color=ink,
                 align=PP_ALIGN.CENTER)

    return None
