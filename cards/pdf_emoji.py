"""Vector emoji icons for the PDF export (cards/pdf_emoji.py).

ReportLab can't render colour-emoji glyphs, so – in the same spirit as the way
``download_pdf`` mirrors the JS background patterns with ReportLab primitives –
we draw small vector look-alikes for the fixed reaction set. Each drawer paints
one emoji centred on the origin inside roughly a (-r..r) box; ``draw_emoji``
handles the translate/rotate so callers just give a position, size and angle.

Keep the keys here in sync with ``REACTION_EMOJI`` in models.py.
"""
import math

from reportlab.lib.colors import HexColor

# Shared palette (Twemoji-ish).
FACE = "#FFCC4D"
LINE = "#664500"
TEAR = "#5DADEC"
HEART = "#DD2E44"
FIRE_OUT = "#F4900C"
FIRE_IN = "#FFCC4D"
CANDLE = "#F4ECD6"
WICK = "#3B3B3B"
CONFETTI = ["#DD2E44", "#5DADEC", "#77B255", "#FFAC33", "#AA8DD8"]
SKIN = "#FFCB4C"


def _path(c, pts, color, alpha=1.0):
    """pts: ('m',x,y) / ('c',x1,y1,x2,y2,x,y) / ('z',). Filled, no stroke."""
    c.setFillColor(HexColor(color))
    c.setFillAlpha(alpha)
    p = c.beginPath()
    for seg in pts:
        if seg[0] == "m":
            p.moveTo(seg[1], seg[2])
        elif seg[0] == "c":
            p.curveTo(*seg[1:])
        elif seg[0] == "z":
            p.close()
    c.drawPath(p, stroke=0, fill=1)
    c.setFillAlpha(1)


def _circle(c, x, y, rr, color, alpha=1.0):
    c.setFillColor(HexColor(color))
    c.setFillAlpha(alpha)
    c.circle(x, y, rr, stroke=0, fill=1)
    c.setFillAlpha(1)


def _arc(c, cx, cy, rr, a0, a1, color, w):
    """Stroke an arc as a short polyline (used for eyes / mouths)."""
    c.setStrokeColor(HexColor(color))
    c.setLineWidth(w)
    c.setLineCap(1)
    p = c.beginPath()
    steps = 14
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        x = cx + math.cos(a) * rr
        y = cy + math.sin(a) * rr
        (p.moveTo if i == 0 else p.lineTo)(x, y)
    c.drawPath(p, stroke=1, fill=0)


def _tear(c, x, y, rr):
    _path(c, [("m", x, y + rr * 1.4), ("c", x + rr, y, x + rr, y - rr, x, y - rr),
              ("c", x - rr, y - rr, x - rr, y, x, y + rr * 1.4), ("z",)], TEAR)


def _face(c, r):
    _circle(c, 0, 0, r, FACE)


# ---- individual emoji ----------------------------------------------------- #
def heart(c, r):
    _path(c, [
        ("m", 0, 0.30 * r),
        ("c", -0.10 * r, 0.85 * r, -0.60 * r, 1.00 * r, -0.85 * r, 0.55 * r),
        ("c", -1.10 * r, 0.10 * r, -0.55 * r, -0.45 * r, 0, -0.95 * r),
        ("c", 0.55 * r, -0.45 * r, 1.10 * r, 0.10 * r, 0.85 * r, 0.55 * r),
        ("c", 0.60 * r, 1.00 * r, 0.10 * r, 0.85 * r, 0, 0.30 * r),
        ("z",),
    ], HEART)


def fire(c, r):
    _path(c, [
        ("m", 0, 1.05 * r),
        ("c", 0.55 * r, 0.45 * r, 0.72 * r, -0.20 * r, 0.36 * r, -0.72 * r),
        ("c", 0.15 * r, -1.02 * r, -0.18 * r, -1.02 * r, -0.36 * r, -0.72 * r),
        ("c", -0.72 * r, -0.20 * r, -0.55 * r, 0.45 * r, 0, 1.05 * r),
        ("z",),
    ], FIRE_OUT)
    _path(c, [
        ("m", 0, 0.55 * r),
        ("c", 0.32 * r, 0.12 * r, 0.40 * r, -0.30 * r, 0.18 * r, -0.58 * r),
        ("c", 0.07 * r, -0.74 * r, -0.10 * r, -0.74 * r, -0.18 * r, -0.58 * r),
        ("c", -0.40 * r, -0.30 * r, -0.32 * r, 0.12 * r, 0, 0.55 * r),
        ("z",),
    ], FIRE_IN)


def candle(c, r):
    c.setFillColor(HexColor(CANDLE))
    c.roundRect(-0.34 * r, -1.0 * r, 0.68 * r, 1.5 * r, 0.18 * r, stroke=0, fill=1)
    _path(c, [("m", 0.06 * r, -1.0 * r), ("c", 0.06 * r, -1.0 * r, 0.30 * r, -0.7 * r, 0.30 * r, 0.3 * r),
              ("c", 0.30 * r, 0.4 * r, 0.10 * r, 0.5 * r, 0.06 * r, 0.5 * r), ("z",)], "#E6DCC0", 0.7)
    c.setStrokeColor(HexColor(WICK))
    c.setLineWidth(max(0.6, 0.06 * r))
    c.line(0, 0.5 * r, 0, 0.72 * r)
    _path(c, [("m", 0, 1.15 * r), ("c", 0.22 * r, 0.85 * r, 0.22 * r, 0.62 * r, 0, 0.55 * r),
              ("c", -0.22 * r, 0.62 * r, -0.22 * r, 0.85 * r, 0, 1.15 * r), ("z",)], FIRE_OUT)
    _circle(c, 0, 0.72 * r, 0.12 * r, FIRE_IN)


def party(c, r):
    _path(c, [("m", -0.95 * r, -0.95 * r), ("c", -0.95 * r, -0.95 * r, 0.55 * r, -0.15 * r, 0.85 * r, 0.55 * r),
              ("c", 0.85 * r, 0.55 * r, -0.15 * r, 0.55 * r, -0.95 * r, -0.95 * r), ("z",)], "#FFAC33")
    c.setStrokeColor(HexColor("#DD2E44"))
    c.setLineWidth(max(0.8, 0.10 * r))
    c.line(0.10 * r, -0.10 * r, 0.85 * r, 0.55 * r)
    for i, (bx, by) in enumerate([(0.5, 0.95), (0.95, 0.55), (0.95, 1.0), (1.05, 0.1), (0.2, 0.85), (0.7, 0.2)]):
        _circle(c, bx * r, by * r, 0.12 * r, CONFETTI[i % len(CONFETTI)])


def clap(c, r):
    def hand(sign, rot):
        c.saveState()
        c.translate(sign * 0.34 * r, -0.18 * r)
        c.rotate(rot)
        c.setFillColor(HexColor(SKIN))
        c.roundRect(-0.30 * r, -0.55 * r, 0.60 * r, 0.62 * r, 0.16 * r, stroke=0, fill=1)
        for fx in (-0.21, -0.07, 0.07, 0.21):
            c.roundRect(fx * r - 0.055 * r, 0.0, 0.11 * r, 0.5 * r, 0.05 * r, stroke=0, fill=1)
        c.roundRect(-0.42 * r, -0.30 * r, 0.16 * r, 0.30 * r, 0.07 * r, stroke=0, fill=1)
        c.restoreState()
    hand(-1, 22)
    hand(1, -22)
    c.setStrokeColor(HexColor("#FFD983"))
    c.setLineWidth(max(0.7, 0.08 * r))
    c.setLineCap(1)
    for ang in (62, 90, 118):
        a = math.radians(ang)
        c.line(math.cos(a) * 0.72 * r, math.sin(a) * 0.72 * r + 0.45 * r,
               math.cos(a) * 1.02 * r, math.sin(a) * 1.02 * r + 0.45 * r)


def joy(c, r):
    _face(c, r)
    _arc(c, -0.38 * r, 0.12 * r, 0.20 * r, 200, 340, LINE, max(1.0, 0.10 * r))
    _arc(c, 0.38 * r, 0.12 * r, 0.20 * r, 200, 340, LINE, max(1.0, 0.10 * r))
    _path(c, [("m", -0.45 * r, -0.10 * r), ("c", -0.30 * r, -0.62 * r, 0.30 * r, -0.62 * r, 0.45 * r, -0.10 * r),
              ("c", 0.20 * r, -0.18 * r, -0.20 * r, -0.18 * r, -0.45 * r, -0.10 * r), ("z",)], LINE)
    _tear(c, -0.78 * r, 0.18 * r, 0.16 * r)
    _tear(c, 0.78 * r, 0.18 * r, 0.16 * r)


def cry(c, r):
    _face(c, r)
    _arc(c, -0.38 * r, 0.18 * r, 0.18 * r, 200, 340, LINE, max(1.0, 0.10 * r))
    _arc(c, 0.38 * r, 0.18 * r, 0.18 * r, 200, 340, LINE, max(1.0, 0.10 * r))
    _path(c, [("m", -0.32 * r, -0.18 * r), ("c", -0.20 * r, -0.70 * r, 0.20 * r, -0.70 * r, 0.32 * r, -0.18 * r),
              ("c", 0.16 * r, -0.05 * r, -0.16 * r, -0.05 * r, -0.32 * r, -0.18 * r), ("z",)], LINE)
    for sx in (-0.40, 0.40):
        c.setFillColor(HexColor(TEAR))
        c.roundRect(sx * r - 0.09 * r, -0.95 * r, 0.18 * r, 1.0 * r, 0.09 * r, stroke=0, fill=1)


def sad(c, r):
    _face(c, r)
    _circle(c, -0.36 * r, 0.10 * r, 0.10 * r, LINE)
    _circle(c, 0.36 * r, 0.10 * r, 0.10 * r, LINE)
    _arc(c, 0, -0.62 * r, 0.30 * r, 40, 140, LINE, max(1.0, 0.10 * r))
    _tear(c, -0.40 * r, -0.18 * r, 0.16 * r)


def party_face(c, r):
    _face(c, r)
    _circle(c, -0.34 * r, 0.10 * r, 0.09 * r, LINE)
    _circle(c, 0.30 * r, 0.10 * r, 0.09 * r, LINE)
    _path(c, [("m", -0.40 * r, -0.18 * r), ("c", -0.25 * r, -0.62 * r, 0.30 * r, -0.62 * r, 0.42 * r, -0.16 * r),
              ("c", 0.18 * r, -0.22 * r, -0.20 * r, -0.22 * r, -0.40 * r, -0.18 * r), ("z",)], LINE)
    c.saveState()
    c.translate(-0.55 * r, 0.75 * r)
    c.rotate(20)
    _path(c, [("m", -0.32 * r, 0), ("c", -0.32 * r, 0, 0, 0, 0.32 * r, 0),
              ("c", 0.32 * r, 0, 0.05 * r, 0.9 * r, 0, 0.95 * r),
              ("c", -0.05 * r, 0.9 * r, -0.32 * r, 0, -0.32 * r, 0), ("z",)], "#DD2E44")
    _circle(c, 0, 0.98 * r, 0.10 * r, "#FFAC33")
    c.restoreState()
    _circle(c, 0.7 * r, 0.6 * r, 0.08 * r, "#5DADEC")
    _circle(c, 0.55 * r, 0.9 * r, 0.07 * r, "#77B255")


_DRAWERS = {
    "heart": heart, "party": party, "clap": clap, "joy": joy,
    "party_face": party_face, "fire": fire, "sad": sad, "cry": cry,
    "candle": candle,
}

# Literal reaction emoji -> drawer name, keyed without the VS16 (U+FE0F)
# presentation selector so ❤️ / 🕯️ match regardless of how they're stored.
_EMOJI_TO_DRAWER = {
    "\u2764": "heart",            # ❤
    "\U0001F389": "party",        # 🎉
    "\U0001F44F": "clap",         # 👏
    "\U0001F602": "joy",          # 😂
    "\U0001F973": "party_face",   # 🥳
    "\U0001F525": "fire",         # 🔥
    "\U0001F622": "sad",          # 😢
    "\U0001F62D": "cry",          # 😭
    "\U0001F56F": "candle",       # 🕯
}


def draw_emoji(c, emoji, cx, cy, r, rot=0):
    """Draw one reaction emoji centred at (cx, cy). Returns False if unknown."""
    name = _EMOJI_TO_DRAWER.get((emoji or "").replace("\ufe0f", ""))
    if not name:
        return False
    c.saveState()
    c.translate(cx, cy)
    if rot:
        c.rotate(rot)
    _DRAWERS[name](c, r)
    c.restoreState()
    return True
