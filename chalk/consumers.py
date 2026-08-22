"""Chalk realtime board.

Wire protocol — every frame is {"t": "<type>", ...}.

  client -> server        server -> room
  ---------------------   -------------------------------------------------
  hello {role, token}     ready {...}  |  denied {reason, code}
  stroke_start            stroke_start   (id, tool, color, w, pts)
  stroke_pts              stroke_pts     (id, pts)   -- appended, not replaced
  stroke_end              stroke_end     (id, ...)   -- full list, committed
  erase {ids}             erase          (ids, canUndo, canRedo)
  ink_live {sel,ids,m}    ink_live       (sel, ids, m) -- mid-drag, never stored
  ink_wipe {gid,path,r}   ink            (add, del) -- the duster
  ink_band {ids,front}    ink_band       (ids, front)
  el_multi {items}        el_update x N  one undo entry for the whole set
  el_live_many {items}    el_live_many   mid-drag for a group, never stored
  ink_xform {sel,ids,m}   ink            (xform, canUndo, canRedo)
  el_add {el}             el_add         (el)
  el_live {id, patch}     el_live        (id, patch)  -- mid-drag, never stored
  el_update {id, patch}   el_update      (id, patch, canUndo, canRedo)
  el_delete {ids}         el_delete      (ids, canUndo, canRedo)
  el_raise {id}           el_raise       (id)
  undo | redo | clear     ink            (add, del, canUndo, canRedo)
                          els            (add, del, edit, canUndo, canRedo)
  surface {surface}       surface        (surface)
  page {index}            snapshot
  page_add | page_delete  snapshot
  pointer {x,y,on}        pointer        (laser, never stored)
  ping                    pong

Two things changed from the first pass and both matter:

1. A socket does NOT join the broadcast group until `hello` succeeds. It used
   to join in `connect()`, which meant anyone who knew the six digits could
   sit in the room and receive every stroke without ever authenticating.

2. The pairing is re-checked in the background every WATCH_INTERVAL seconds
   against `BoardSession.revision`. Rotating the code now genuinely evicts a
   phone that is already connected, instead of leaving it writing into the
   page invisibly.

Only `stroke_end` and the structural messages touch the database, so a normal
lesson still costs roughly one write per pen stroke. Undo/redo/clear used to
rebroadcast the entire page; they now broadcast the operation instead.

Elements (text, photos, shapes, free shapes) share the ink's undo stacks
rather than keeping a second timeline. Undo walks back through a lesson in the
order things actually happened, which is the only ordering a teacher can hold
in their head mid-sentence. Dragging an element emits `el_live` continuously
and one `el_update` on release, so a two-second drag costs one undo entry and
one write, not a hundred of each.
"""

import asyncio
import re
import time
import uuid
from hmac import compare_digest

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.db import transaction

from .models import (
    MAX_ELS_PER_PAGE,
    MAX_FF_POINTS,
    MAX_HISTORY_ITEMS,
    MAX_PAGES,
    MAX_POINTS,
    MAX_STROKES_PER_PAGE,
    MAX_TEXT,
    MAX_PASTE_STROKES,
    MAX_TPL_ELS,
    MAX_UNDO,
    MAX_XFORM_IDS,
    clean_src,
    person_card,
)

TOOLS = {"pen", "pencil", "marker", "chalk", "crayon", "highlighter"}
SURFACE_KEYS = {"black", "green", "white", "grid", "ruled"}

# Exactly the CSS colour forms that are real: #rgb, #rgba, #rrggbb, #rrggbbaa.
COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")

HELLO_TIMEOUT = 10.0      # seconds a socket may sit unauthenticated
WATCH_INTERVAL = 20.0     # seconds between pairing re-checks
POINTER_MIN_GAP = 0.02    # laser frames are throttled to 50/s

# Crude per-socket flood guard. A human drawing hard peaks around 120 frames
# a second; anything sustained above this is not a person.
RATE_BURST = 400
RATE_PER_SEC = 200.0

# Messages the sender already rendered locally — don't echo them back.
# "peer" is here so a socket is never told about its own arrival.
# What a guest cannot do.
#
# A colleague or a student can draw, erase, dust, and put things on the
# board — everything that adds to the lesson. They cannot turn the page,
# wipe it, delete it or change the surface under everybody else, because
# those are not contributions, they are things that happen TO the other
# thirty people in the room. The buttons are hidden on their phone as well;
# this is the half that a hidden button cannot be talked out of.
TEACHER_ONLY = {"clear", "page", "page_add", "page_delete", "surface"}

NO_ECHO = {
    "stroke_start", "stroke_pts", "stroke_end", "pointer", "peer",
    "el_live", "ink_live", "el_live_many",
}


def _num(v, lo=0.0, hi=1.0, default=0.0):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if f != f:  # NaN
        return default
    if f in (float("inf"), float("-inf")):
        return default
    return round(min(hi, max(lo, f)), 4)


def _is_int(v):
    """`isinstance(True, int)` is True in Python, and `{"index": true}` used
    to navigate to page 1. Booleans are not indices."""
    return isinstance(v, int) and not isinstance(v, bool)


def clean_points(raw, limit=MAX_POINTS):
    if not isinstance(raw, (list, tuple)):
        return []
    out = [_num(v) for v in raw[:limit]]
    if len(out) % 2:
        out.pop()
    return out


def clean_stroke(raw):
    if not isinstance(raw, dict):
        return None
    sid = str(raw.get("id") or "")
    if not ID_RE.match(sid):
        return None
    pts = clean_points(raw.get("pts"))
    if len(pts) < 2:
        return None
    tool = raw.get("tool")
    color = str(raw.get("color") or "")
    return {
        "id": sid,
        "tool": tool if tool in TOOLS else "pen",
        "color": color if COLOR_RE.match(color) else "#ffffff",
        "w": _num(raw.get("w"), 0.0004, 0.12, 0.0035),
        # Absent means front: handwriting goes over the top of whatever is
        # already on the board, the way it does on a real one.
        "top": raw.get("top") is not False,
        # Overwritten by _sign for anything arriving fresh. Kept here so a
        # stroke that comes back through undo, redo or the duster keeps the
        # name of whoever actually drew it.
        "by": str(raw.get("by") or "")[:12],
        "pts": pts,
    }


# ----------------------------------------------------------------------
# moving and resizing ink
# ----------------------------------------------------------------------
#
# Handwriting is a list of points, so moving it is an affine map over those
# points: [a, b, c, d, e, f], in SVG's order —
#     x' = a*x + c*y + e
#     y' = b*x + d*y + f
# The client sends the map from where the ink was when the finger went down
# to where it is now, so a whole gesture is six numbers on the wire whatever
# the selection weighs, and the same frame arriving twice is a no-op rather
# than a second move.
#
# The undo entry keeps the matrix and its inverse, so stepping back through a
# move costs six numbers as well, instead of a second copy of the ink.

SEL_RE = re.compile(r"^[A-Za-z0-9_-]{1,48}$")


def clean_ids(raw, limit):
    if not isinstance(raw, (list, tuple)):
        return []
    out, seen = [], set()
    for i in raw[:limit]:
        i = str(i)
        if i in seen or not ID_RE.match(i):
            continue
        seen.add(i)
        out.append(i)
    return out


def clean_matrix(raw):
    """Six finite numbers that describe a map worth applying, or None.

    A near-zero determinant is a matrix that folds the ink onto a line, which
    is not recoverable by undo because it is not invertible. Refuse it here
    rather than let a stray divide-by-almost-zero flatten a page.
    """
    if not isinstance(raw, (list, tuple)) or len(raw) != 6:
        return None
    m = []
    for v in raw:
        try:
            f = float(v)
        except (TypeError, ValueError):
            return None
        if f != f or f in (float("inf"), float("-inf")):
            return None
        if abs(f) > 1000:
            return None
        m.append(round(f, 6))
    det = m[0] * m[3] - m[1] * m[2]
    if not (1e-6 < abs(det) < 1e6):
        return None
    return m


def invert_matrix(m):
    a, b, c, d, e, f = m
    det = a * d - b * c
    ia, ib, ic, idd = d / det, -b / det, -c / det, a / det
    return [
        round(ia, 6), round(ib, 6), round(ic, 6), round(idd, 6),
        round(-(ia * e + ic * f), 6), round(-(ib * e + idd * f), 6),
    ]


def matrix_scale(m):
    s = abs(m[0] * m[3] - m[1] * m[2]) ** 0.5
    return s if 0.0001 < s < 10000 else 1.0


def xform_strokes(strokes, ids, m):
    """Move/scale/rotate the named strokes in place. Returns the ids hit.

    Points are clamped wide rather than to 0..1: ink dragged half off the
    board on its way somewhere else should keep its shape, not flatten
    against the edge.
    """
    wanted = set(ids)
    a, b, c, d, e, f = m
    ws = matrix_scale(m)
    touched = []
    for s in strokes:
        if s.get("id") not in wanted:
            continue
        pts = s.get("pts") or []
        out = []
        for i in range(0, len(pts) - 1, 2):
            try:
                x, y = float(pts[i]), float(pts[i + 1])
            except (TypeError, ValueError):
                x = y = 0.0
            out.append(round(min(2.0, max(-1.0, a * x + c * y + e)), 4))
            out.append(round(min(2.0, max(-1.0, b * x + d * y + f)), 4))
        if not out:
            continue
        s["pts"] = out
        s["w"] = round(min(0.12, max(0.0004, _num(s.get("w"), 0.0004, 0.12, 0.0035) * ws)), 6)
        touched.append(s["id"])
    return touched


def heal_image_srcs(board_id, els):
    """Repoint photos stored before the app served its own images.

    Boards written earlier hold a path under MEDIA_URL. If nothing serves
    MEDIA_ROOT those elements are frames with nothing in them, and re-adding
    every photo by hand is not a reasonable thing to ask of a teacher. The
    upload row survives, and its file name is in the old path, so the two can
    be matched up and the element repointed at a route that works.

    Returns (els, changed). Costs one query, and only when there is something
    to fix.
    """
    from django.urls import reverse

    from .models import BoardImage

    marker = "chalk/%s/" % board_id
    wanted = {}
    for e in els:
        if not isinstance(e, dict) or e.get("type") != "image":
            continue
        src = str(e.get("src") or "")
        if not src or clean_src(src) == src:
            continue  # already an address this board accepts
        at = src.find(marker)
        if at < 0:
            continue
        wanted.setdefault(src[at:].split("?")[0], []).append(e)
    if not wanted:
        return els, False

    found = BoardImage.objects.filter(
        board_id=board_id, file__in=list(wanted)
    ).values_list("file", "id")
    changed = False
    for name, image_id in found:
        for e in wanted.get(name, []):
            e["src"] = reverse("chalk:image", args=[board_id, image_id])
            changed = True
    return els, changed


# ----------------------------------------------------------------------
# the duster
# ----------------------------------------------------------------------
#
# The ordinary eraser takes whole strokes: touch a letter, the letter goes.
# A duster takes the part you rubbed and leaves the rest, which is what you
# need to clean up an edge or open a gap in a line.
#
# A stroke is a point list, so rubbing it is a filter: drop the points the
# duster passed over, and whatever survives comes back as one or more
# shorter strokes. That means the operation is a delete plus some inserts —
# the "splice" entry below — and both halves land in the same undo step, so
# one Undo puts the original stroke back whole.

DUSTER_MAX_PATH = 120         # points in one wipe message
MIN_FRAGMENT = 3              # points; shorter than this is a speck, not a mark


def _near_path(x, y, path, r2):
    """Is (x, y) within the duster of any segment of `path`?"""
    n = len(path)
    if n == 2:
        dx, dy = x - path[0], y - path[1]
        return dx * dx + dy * dy <= r2
    for i in range(2, n, 2):
        ax, ay, bx, by = path[i - 2], path[i - 1], path[i], path[i + 1]
        vx, vy = bx - ax, by - ay
        seg = vx * vx + vy * vy
        t = ((x - ax) * vx + (y - ay) * vy) / seg if seg else 0.0
        t = 0.0 if t < 0 else (1.0 if t > 1 else t)
        dx, dy = x - (ax + t * vx), y - (ay + t * vy)
        if dx * dx + dy * dy <= r2:
            return True
    return False


def _bounds(pts):
    xs = pts[0::2]
    ys = pts[1::2]
    return min(xs), min(ys), max(xs), max(ys)


def wipe_strokes(strokes, path, radius, new_id):
    """Rub `path` across the page. Returns (out, added).

    `out` is [(index, stroke)] for strokes that were touched, `added` is
    [(index, stroke)] for the pieces that survived. Untouched strokes are
    never in either, so wiping empty board costs a bounding-box test each.
    """
    r2 = radius * radius
    px0, py0, px1, py1 = _bounds(path)
    px0 -= radius
    py0 -= radius
    px1 += radius
    py1 += radius

    out, added = [], []
    for idx, s in enumerate(strokes):
        pts = s.get("pts") or []
        if len(pts) < 2:
            continue
        sx0, sy0, sx1, sy1 = _bounds(pts)
        pad = float(s.get("w") or 0.0035)
        if sx1 + pad < px0 or sx0 - pad > px1 or sy1 + pad < py0 or sy0 - pad > py1:
            continue

        runs, cur, hit = [], [], False
        reach = r2 if pad <= 0 else (radius + pad * 0.5) ** 2
        for i in range(0, len(pts) - 1, 2):
            if _near_path(pts[i], pts[i + 1], path, reach):
                hit = True
                if len(cur) >= MIN_FRAGMENT * 2:
                    runs.append(cur)
                cur = []
            else:
                cur.append(pts[i])
                cur.append(pts[i + 1])
        if not hit:
            continue
        if len(cur) >= MIN_FRAGMENT * 2:
            runs.append(cur)

        out.append((idx, s))
        for run in runs:
            piece = dict(s)
            piece["id"] = new_id()
            piece["pts"] = run
            added.append((idx, piece))
    return out, added


def _entry_items(entry):
    """Objects held by one history entry, including its paired `also` half.

    A wipe stores the ink and the elements as one entry with two halves, so
    the trimmer has to see through the pairing or a full page of elements
    counts as zero.
    """
    n = len(entry.get("items") or [])
    also = entry.get("also")
    if isinstance(also, dict):
        n += len(also.get("items") or [])
    return n


def _history_items(stacks):
    return sum(_entry_items(e) for stack in stacks for e in stack)


# ----------------------------------------------------------------------
# elements
# ----------------------------------------------------------------------

EL_TYPES = {"text", "image", "shape", "freeform"}
FONTS = {"sans", "serif", "mono", "hand"}
ALIGNS = {"left", "center", "right"}
FITS = {"contain", "cover"}
EDGES = {"sharp", "round", "smooth"}
BLENDS = {
    "normal", "multiply", "screen", "overlay", "darken", "lighten",
    "color-dodge", "color-burn", "hard-light", "soft-light", "difference",
    "exclusion", "hue", "saturation", "color", "luminosity",
}
SHAPES = {
    "line", "arrow", "darrow", "rect", "rrect", "ellipse", "triangle",
    "rtriangle", "diamond", "parallelogram", "trapezoid", "polygon", "star",
    "cross", "chevron", "brace", "angle", "cube", "cylinder", "cone",
    "sphere", "pyramid", "prism", "torus",
}
PRESETS = {
    "polygon", "star", "burst", "blob", "arrow", "chevron", "cross",
    "bubble", "heart", "drop", "wave", "custom",
}

# field -> (low, high, default). A key absent from these tables never reaches
# storage, so a new client field cannot smuggle anything in.
EL_NUM = {
    "x": (-0.5, 1.5, 0.3), "y": (-0.5, 1.5, 0.3),
    "w": (0.01, 2.0, 0.2), "h": (0.01, 2.0, 0.2),
    "rot": (-360.0, 360.0, 0.0),
    "size": (0.005, 0.6, 0.06),
    "strokeW": (0.0, 24.0, 2.0), "dash": (0.0, 40.0, 0.0),
    "radius": (0.0, 50.0, 14.0), "sides": (3.0, 24.0, 6.0),
    "inset": (10.0, 90.0, 45.0), "depth": (4.0, 45.0, 22.0),
    "thickness": (10.0, 60.0, 30.0), "slant": (0.0, 45.0, 22.0),
    "head": (8.0, 45.0, 22.0), "degrees": (5.0, 175.0, 45.0),
    "hole": (10.0, 70.0, 40.0),
}
EL_INT = {"sides", "dash", "degrees"}
EL_BOOL = {"bold", "italic", "closed", "fillOn", "edited", "top"}

FX_NUM = {
    "sx": (-60.0, 60.0, 0.0), "sy": (-60.0, 60.0, 4.0), "blur": (0.0, 60.0, 8.0),
    "glowSize": (0.0, 60.0, 10.0), "extrude": (0.0, 24.0, 0.0),
    "softBlur": (0.0, 20.0, 0.0), "tiltX": (-80.0, 80.0, 0.0),
    "tiltY": (-80.0, 80.0, 0.0), "perspective": (100.0, 3000.0, 800.0),
    "opacity": (0.0, 1.0, 1.0),
}
FX_BOOL = {"shadow", "glow", "flipH", "flipV"}
FX_COLOR = {"shadowColor", "glowColor", "extrudeColor"}

def _rng(v, key, table):
    lo, hi, dflt = table[key]
    try:
        f = float(v)
    except (TypeError, ValueError):
        return dflt
    if f != f or f in (float("inf"), float("-inf")):
        return dflt
    return round(min(hi, max(lo, f)), 5)


def _color(v, dflt="#ffffff", allow_blank=False):
    v = str(v or "")
    if allow_blank and v == "":
        return ""
    return v if COLOR_RE.match(v) else dflt


def clean_fx(raw):
    if not isinstance(raw, dict):
        return None
    fx = {}
    for k, v in raw.items():
        if k in FX_NUM:
            fx[k] = _rng(v, k, FX_NUM)
        elif k in FX_BOOL:
            fx[k] = bool(v)
        elif k in FX_COLOR:
            fx[k] = _color(v, "#000000")
        elif k == "blend" and v in BLENDS:
            fx[k] = v
    return fx


def clean_points100(raw):
    """Free-shape vertices, in the shape's own 0..100 box."""
    if not isinstance(raw, (list, tuple)):
        return []
    out = []
    for v in raw[: MAX_FF_POINTS * 2]:
        try:
            f = float(v)
        except (TypeError, ValueError):
            f = 0.0
        if f != f or f in (float("inf"), float("-inf")):
            f = 0.0
        out.append(round(min(200.0, max(-100.0, f)), 2))
    if len(out) % 2:
        out.pop()
    return out


def clean_el_fields(raw, etype=None):
    """Whitelist and clamp. Returns only the keys present in `raw`, so one
    function serves both a whole new element and a partial patch."""
    out = {}
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        if k in EL_NUM:
            out[k] = _rng(v, k, EL_NUM)
        elif k in EL_BOOL:
            out[k] = bool(v)
        elif k == "text":
            out[k] = str(v or "")[:MAX_TEXT]
        elif k == "font" and v in FONTS:
            out[k] = v
        elif k == "align" and v in ALIGNS:
            out[k] = v
        elif k == "fit" and v in FITS:
            out[k] = v
        elif k == "edge" and v in EDGES:
            out[k] = v
        elif k == "shape" and v in SHAPES:
            out[k] = v
        elif k == "preset" and v in PRESETS:
            out[k] = v
        elif k in ("color", "fill", "stroke"):
            out[k] = _color(v)
        elif k == "by":
            v = str(v or "")
            out[k] = v if v.isdigit() and len(v) <= 12 else ""
        elif k == "gid":
            # Which group this element belongs to. "" means none. Grouping is
            # a shared label rather than a container: an element is still an
            # ordinary element, it just answers to a name alongside others.
            v = str(v or "")
            out[k] = v if (v == "" or ID_RE.match(v)) else ""
        elif k == "bg":
            out[k] = _color(v, "", allow_blank=True)
        elif k == "src":
            out[k] = clean_src(v)
        elif k == "pts" and etype == "freeform":
            out[k] = clean_points100(v)
        elif k == "fx":
            fx = clean_fx(v)
            if fx is not None:
                out[k] = fx
    for k in EL_INT:
        if k in out:
            out[k] = int(out[k])
    return out


def clean_el(raw):
    if not isinstance(raw, dict):
        return None
    eid = str(raw.get("id") or "")
    etype = raw.get("type")
    if not ID_RE.match(eid) or etype not in EL_TYPES:
        return None
    el = clean_el_fields(raw, etype)
    el["id"] = eid
    el["type"] = etype
    for k in ("x", "y", "w", "h"):
        el.setdefault(k, EL_NUM[k][2])
    # An element with nothing to draw is not worth a row on the page.
    if etype == "image" and not el.get("src"):
        return None
    if etype == "freeform" and len(el.get("pts") or []) < 4:
        return None
    return el


class ChalkConsumer(AsyncJsonWebsocketConsumer):
    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------

    async def connect(self):
        self.code = self.scope["url_route"]["kwargs"]["code"]
        self.group = f"chalk_{self.code}"
        self.role = "guest"
        self.can_draw = False
        self.is_owner = False
        self.in_group = False
        self.closing = False
        self.last_pointer = 0.0
        self._tokens = RATE_BURST
        self._tokens_at = time.monotonic()
        self._reaper = None
        self._watcher = None

        info = await self._session_info(self.code)
        if not info:
            await self.close(code=4404)
            return
        if not info["live"]:
            await self.accept()
            await self._deny("This board number has expired.", "expired")
            return

        self.board_id = info["board_id"]
        self.owner_id = info["owner_id"]
        self.token = info["token"]
        self.revision = info["revision"]
        self.guests_allowed = info.get("guests", False)
        self.person = None
        self.person_id = ""

        # NOTE: no group_add here. See module docstring, point 1.
        await self.accept()
        self._reaper = asyncio.create_task(self._reap_unauthenticated())

    async def disconnect(self, close_code):
        for task in (self._reaper, self._watcher):
            if task:
                task.cancel()
        if getattr(self, "in_group", False):
            if self.role in ("stage", "control"):
                await self._fan({"t": "peer", "role": self.role, "state": "left"})
            if getattr(self, "person", None):
                await self._fan(
                    {"t": "person", "person": self.person, "on": False}
                )
            await self.channel_layer.group_discard(self.group, self.channel_name)
            self.in_group = False

    async def _reap_unauthenticated(self):
        """Close sockets that connect and then never say hello."""
        try:
            await asyncio.sleep(HELLO_TIMEOUT)
        except asyncio.CancelledError:
            return
        if not self.can_draw:
            await self._deny("This board did not finish pairing.", "timeout")

    async def _watch_pairing(self):
        """Re-check the pairing periodically and evict when it changes.

        This is the belt to the eviction broadcast's braces: even if the
        channel layer drops the kick message, a rotated code takes effect
        within WATCH_INTERVAL.
        """
        while True:
            try:
                await asyncio.sleep(WATCH_INTERVAL)
            except asyncio.CancelledError:
                return
            info = await self._session_info(self.code, extend=True)
            if not info or not info["live"] or info["revision"] != self.revision:
                await self._deny(
                    "This board number was regenerated. Scan the new one.", "expired"
                )
                return
            if not self.is_owner and not compare_digest(info["token"], self.token):
                await self._deny(
                    "This board number was regenerated. Scan the new one.", "expired"
                )
                return

    # ------------------------------------------------------------------
    # inbound
    # ------------------------------------------------------------------

    def _allow_frame(self):
        now = time.monotonic()
        self._tokens = min(
            RATE_BURST, self._tokens + (now - self._tokens_at) * RATE_PER_SEC
        )
        self._tokens_at = now
        if self._tokens < 1:
            return False
        self._tokens -= 1
        return True

    async def receive_json(self, content, **kwargs):
        if self.closing or not isinstance(content, dict):
            return
        if not self._allow_frame():
            return
        t = content.get("t")

        if t == "hello":
            return await self._hello(content)
        if t == "ping":
            return await self.send_json({"t": "pong"})
        if not self.can_draw:
            return
        if self.role == "join" and t in TEACHER_ONLY:
            # Silently. The buttons are hidden on their phone too, so a guest
            # who gets here is not a confused teacher, and telling them what
            # they are not allowed to do is an invitation to try.
            return

        if t == "stroke_start":
            stroke = clean_stroke(content.get("stroke"))
            if stroke:
                await self._fan({"t": "stroke_start", "stroke": stroke})

        elif t == "stroke_pts":
            sid = str(content.get("id") or "")
            pts = clean_points(content.get("pts"), 4000)
            if ID_RE.match(sid) and pts:
                await self._fan({"t": "stroke_pts", "id": sid, "pts": pts})

        elif t == "stroke_end":
            stroke = clean_stroke(content.get("stroke"))
            if stroke:
                # Stamped here, from the connection, never from the message.
                # Authorship a client can set is authorship a client can lie
                # about, and the whole point of the bubbles is that they are
                # true.
                self._sign(stroke)
                await self._fan({"t": "stroke_end", "stroke": stroke})
                await self._commit_stroke(stroke)

        elif t == "erase":
            raw = content.get("ids")
            ids = []
            if isinstance(raw, (list, tuple)):
                ids = [str(i) for i in raw if ID_RE.match(str(i))][:400]
            if ids:
                result = await self._erase(ids)
                if result:
                    await self._fan(
                        {
                            "t": "erase",
                            "ids": result["ids"],
                            "canUndo": result["canUndo"],
                            "canRedo": result["canRedo"],
                        },
                        echo=True,
                    )

        elif t == "ink_live":
            # Mid-drag, exactly like el_live: broadcast so the class watches
            # the ink move, store nothing until the finger lifts.
            sel = str(content.get("sel") or "")
            ids = clean_ids(content.get("ids"), MAX_XFORM_IDS)
            m = clean_matrix(content.get("m"))
            if SEL_RE.match(sel) and ids and m:
                await self._fan({"t": "ink_live", "sel": sel, "ids": ids, "m": m})

        elif t == "ink_xform":
            sel = str(content.get("sel") or "")
            ids = clean_ids(content.get("ids"), MAX_XFORM_IDS)
            m = clean_matrix(content.get("m"))
            if SEL_RE.match(sel) and ids and m:
                result = await self._ink_xform(ids, m)
                if result:
                    await self._fan(
                        {
                            "t": "ink",
                            "add": [],
                            "del": [],
                            "xform": [
                                {"sel": sel, "ids": result["ids"], "m": m}
                            ],
                            "canUndo": result["canUndo"],
                            "canRedo": result["canRedo"],
                        },
                        echo=True,
                    )

        elif t == "el_add":
            el = clean_el(content.get("el"))
            if el:
                self._sign(el)
                result = await self._el_add(el)
                if result:
                    await self._fan({"t": "el_add", "el": el, **result}, echo=True)

        elif t == "ink_wipe":
            # The duster, arriving in chunks so the wall keeps up with the
            # hand. Chunks that share a gid merge into one undo step.
            gid = str(content.get("gid") or "")
            path = clean_points(content.get("path"))[: DUSTER_MAX_PATH * 2]
            radius = _num(content.get("r"), 0.004, 0.16, 0.03)
            if SEL_RE.match(gid) and len(path) >= 2:
                result = await self._ink_wipe(gid, path, radius)
                if result:
                    await self._fan(
                        {
                            "t": "ink",
                            "add": result["add"],
                            "del": result["del"],
                            "xform": [],
                            "canUndo": result["canUndo"],
                            "canRedo": result["canRedo"],
                        },
                        echo=True,
                    )

        elif t == "ink_band":
            # Send handwriting behind the objects, or bring it back in front.
            ids = clean_ids(content.get("ids"), MAX_XFORM_IDS)
            if ids:
                front = bool(content.get("front"))
                result = await self._ink_band(ids, front)
                if result:
                    await self._fan(
                        {"t": "ink_band", "ids": result["ids"], "front": front},
                        echo=True,
                    )

        elif t == "el_multi":
            # One message, one undo step, and it fans out as ordinary
            # el_update frames so every client already understands it.
            raw = content.get("items")
            items = []
            if isinstance(raw, (list, tuple)):
                for it in raw[:MAX_TPL_ELS]:
                    if not isinstance(it, dict):
                        continue
                    eid = str(it.get("id") or "")
                    if not ID_RE.match(eid):
                        continue
                    patch = clean_el_fields(it.get("patch"), self._type_of(eid))
                    if patch:
                        items.append({"id": eid, "patch": patch})
            if items:
                result = await self._el_multi(items)
                if result:
                    for done in result["items"]:
                        await self._fan(
                            {
                                "t": "el_update",
                                "id": done["id"],
                                "patch": done["patch"],
                                "canUndo": result["canUndo"],
                                "canRedo": result["canRedo"],
                            },
                            echo=True,
                        )

        elif t == "el_live_many":
            # Mid-drag for a group. Broadcast, never stored.
            raw = content.get("items")
            items = []
            if isinstance(raw, (list, tuple)):
                for it in raw[:MAX_TPL_ELS]:
                    if not isinstance(it, dict):
                        continue
                    eid = str(it.get("id") or "")
                    if not ID_RE.match(eid):
                        continue
                    patch = clean_el_fields(it.get("patch"), self._type_of(eid))
                    if patch:
                        items.append({"id": eid, "patch": patch})
            if items:
                await self._fan({"t": "el_live_many", "items": items})

        elif t == "paste":
            # Copies arrive already built by the phone: new ids, nudged
            # across, everything else exactly as it was. The server's job is
            # to check them and land the objects and the writing in ONE undo
            # step, which is what the entry's `also` half is for.
            raw_els = content.get("els")
            raw_ink = content.get("strokes")
            els, strokes = [], []
            if isinstance(raw_els, (list, tuple)):
                for item in raw_els[:MAX_TPL_ELS]:
                    cleaned = clean_el(item)
                    if cleaned:
                        # A copy is the work of whoever pasted it, not of
                        # whoever drew the original.
                        self._sign(cleaned)
                        els.append(cleaned)
            if isinstance(raw_ink, (list, tuple)):
                for item in raw_ink[:MAX_PASTE_STROKES]:
                    cleaned = clean_stroke(item)
                    if cleaned:
                        self._sign(cleaned)
                        strokes.append(cleaned)
            if els or strokes:
                result = await self._paste(els, strokes)
                if result:
                    flags = {
                        "canUndo": result["canUndo"], "canRedo": result["canRedo"]
                    }
                    if result["add"]:
                        await self._fan(
                            {
                                "t": "ink", "add": result["add"], "del": [],
                                "xform": [], **flags,
                            },
                            echo=True,
                        )
                    for placed in result["els"]:
                        await self._fan(
                            {"t": "el_add", "el": placed, **flags}, echo=True
                        )

        elif t == "el_tpl":
            # A ready-made board. Many elements, one message, one undo entry.
            raw = content.get("els")
            els = []
            if isinstance(raw, (list, tuple)):
                for item in raw[:MAX_TPL_ELS]:
                    cleaned = clean_el(item)
                    if cleaned:
                        self._sign(cleaned)
                        els.append(cleaned)
            if els:
                result = await self._el_add_many(els)
                if result:
                    # Fanned one at a time, as ordinary el_add frames. A
                    # bulk frame would need every client to understand a new
                    # message type before a template showed up on the wall.
                    for placed in result["els"]:
                        await self._fan(
                            {
                                "t": "el_add",
                                "el": placed,
                                "canUndo": result["canUndo"],
                                "canRedo": result["canRedo"],
                            },
                            echo=True,
                        )

        elif t == "el_live":
            # Mid-drag. Broadcast, never store: a drag is one action and it is
            # the release that counts.
            eid = str(content.get("id") or "")
            patch = clean_el_fields(content.get("patch"), self._type_of(eid))
            if ID_RE.match(eid) and patch:
                await self._fan({"t": "el_live", "id": eid, "patch": patch})

        elif t == "el_update":
            eid = str(content.get("id") or "")
            if ID_RE.match(eid):
                patch = clean_el_fields(content.get("patch"), self._type_of(eid))
                if patch:
                    result = await self._el_update(eid, patch)
                    if result:
                        await self._fan({"t": "el_update", "id": eid, **result}, echo=True)

        elif t == "el_delete":
            raw = content.get("ids")
            ids = []
            if isinstance(raw, (list, tuple)):
                ids = [str(i) for i in raw if ID_RE.match(str(i))][:200]
            if ids:
                result = await self._el_delete(ids)
                if result:
                    await self._fan({"t": "el_delete", **result}, echo=True)

        elif t == "el_raise":
            eid = str(content.get("id") or "")
            if ID_RE.match(eid) and await self._el_raise(eid):
                await self._fan({"t": "el_raise", "id": eid}, echo=True)

        elif t in ("undo", "redo", "clear"):
            result = await self._history(t)
            if result and result["changed"]:
                await self._fan_ops(result)

        elif t == "surface":
            surface = content.get("surface")
            if surface in SURFACE_KEYS:
                await self._set_surface(surface)
                await self._fan({"t": "surface", "surface": surface}, echo=True)

        elif t == "page":
            idx = content.get("index")
            if _is_int(idx) and 0 <= idx < MAX_PAGES:
                if await self._goto_page(idx):
                    await self._broadcast_snapshot()

        elif t == "page_add":
            if await self._add_page():
                await self._broadcast_snapshot()

        elif t == "page_delete":
            if await self._delete_page():
                await self._broadcast_snapshot()

        elif t == "resync":
            # Explicit "I think I have drifted" request. Cheap safety valve
            # now that undo/redo no longer ships the whole page.
            state = await self._snapshot()
            await self.send_json({"t": "snapshot", **state})

        elif t == "pointer":
            now = time.monotonic()
            if now - self.last_pointer < POINTER_MIN_GAP:
                return
            self.last_pointer = now
            await self._fan(
                {
                    "t": "pointer",
                    "x": _num(content.get("x")),
                    "y": _num(content.get("y")),
                    "on": bool(content.get("on")),
                }
            )

    # ------------------------------------------------------------------
    # pairing
    # ------------------------------------------------------------------

    async def _hello(self, content):
        if self.can_draw:
            # Already paired. Replaying hello used to re-read the whole page
            # from the database and re-announce the peer, once per message.
            return

        role = content.get("role")
        token = str(content.get("token") or "")
        user = self.scope.get("user")
        self.is_owner = bool(
            user
            and getattr(user, "is_authenticated", False)
            and user.id == self.owner_id
        )

        if role == "stage":
            if not self.is_owner:
                return await self._deny(
                    "Only the person who owns this board can project it.", "not_owner"
                )
        elif role == "control":
            by_token = bool(token) and compare_digest(token, self.token)
            by_grant = await self._has_session_grant()
            if not (self.is_owner or by_token or by_grant):
                return await self._deny(
                    "This board number was regenerated. Scan the new one.", "bad_token"
                )
        elif role == "join":
            # A colleague or a student. Signing in is the whole gate: the
            # board number gets you to the door, an account gets you through
            # it, and everything you then draw has your name on it.
            signed_in = bool(user and getattr(user, "is_authenticated", False))
            if not signed_in:
                return await self._deny(
                    "Sign in to Knock-Knock to write on this board.", "sign_in"
                )
            if not (self.guests_allowed or self.is_owner):
                return await self._deny(
                    "This board is not open for other people to write on.", "closed"
                )
        else:
            return await self._deny("Unrecognised role.", "bad_role")

        self.role = role
        self.can_draw = True
        if self._reaper:
            self._reaper.cancel()
            self._reaper = None

        await self.channel_layer.group_add(self.group, self.channel_name)
        self.in_group = True
        self._watcher = asyncio.create_task(self._watch_pairing())

        self.person = await self._my_card()
        self.person_id = self.person["id"] if self.person else ""

        state = await self._snapshot()
        self._remember_types(state.get("els") or [])
        people = await self._page_people()
        await self.send_json({
            "t": "ready", "role": self.role, "me": self.person,
            "people": people, **state,
        })
        await self._fan({"t": "peer", "role": self.role, "state": "joined"})
        if self.person:
            # Tell the room who just arrived, and ask who is already here.
            # Nobody keeps a list of connections — each socket answers for
            # itself, which is the only kind of presence that survives more
            # than one web process without a shared store.
            await self._fan({"t": "person", "person": self.person, "on": True})
            await self._fan({"t": "whois", "ask": self.channel_name})

    def _sign(self, item):
        """Put this connection's name on something arriving from it."""
        if self.person_id:
            item["by"] = self.person_id
        return item

    async def _deny(self, reason, code="denied"):
        if self.closing:
            return
        self.closing = True
        try:
            await self.send_json({"t": "denied", "reason": reason, "code": code})
        finally:
            await self.close(code=4403)

    # ------------------------------------------------------------------
    # fanout
    # ------------------------------------------------------------------

    async def _fan(self, payload, echo=False):
        """`echo=True` sends the frame back to the originator too.

        Used for anything the sender cannot have applied correctly on its own
        — erases carry authoritative undo flags, and undo/redo ops are
        computed server-side.
        """
        await self.channel_layer.group_send(
            self.group,
            {
                "type": "fan.out",
                "payload": payload,
                "origin": "" if echo else self.channel_name,
            },
        )

    async def fan_out(self, event):
        payload = event["payload"]
        if payload.get("t") == "whois":
            await self.fan_whois(payload)
            return
        if event.get("origin") == self.channel_name and payload.get("t") in NO_ECHO:
            return
        await self.send_json(payload)

    async def fan_whois(self, event):
        """Somebody joined and asked who else is here.

        Answered straight down their channel rather than to the group: a
        class of thirty answering a group broadcast is nine hundred frames
        for one arrival.
        """
        asker = event.get("ask")
        if not asker or asker == self.channel_name or not self.person:
            return
        await self.channel_layer.send(
            asker,
            {"type": "fan.out", "payload": {
                "t": "person", "person": self.person, "on": True
            }, "origin": ""},
        )

    async def kick(self, event):
        """Group message from views.RotateCodeView — evict everyone here."""
        await self._deny(
            event.get("reason", "This pairing is no longer valid."),
            event.get("code", "expired"),
        )

    async def _fan_ops(self, result):
        """Send one frame per layer that actually changed.

        Both frames carry canUndo/canRedo, so a client that only understands
        one of them still tracks the buttons correctly.
        """
        ops = result["ops"]
        flags = {"canUndo": result["canUndo"], "canRedo": result["canRedo"]}
        sent = False
        for layer, name in (("ink", "ink"), ("els", "els")):
            part = ops.get(layer)
            if not part or not (
                part["add"] or part["del"] or part["edit"] or part.get("xform")
            ):
                continue
            frame = {"t": name, "add": part["add"], "del": part["del"], **flags}
            if layer == "els":
                frame["edit"] = part["edit"]
            else:
                frame["xform"] = part.get("xform") or []
            await self._fan(frame, echo=True)
            sent = True
        if not sent:
            # Nothing moved, but the buttons may still need to flip.
            await self._fan({"t": "ink", "add": [], "del": [], **flags}, echo=True)

    async def _broadcast_snapshot(self):
        state = await self._snapshot()
        self._remember_types(state.get("els") or [])
        await self.channel_layer.group_send(
            self.group,
            {"type": "fan.out", "payload": {"t": "snapshot", **state}, "origin": ""},
        )

    # ------------------------------------------------------------------
    # database
    # ------------------------------------------------------------------

    def _people_cards(self, ids):
        """Cards for a set of user ids, in one query."""
        from django.contrib.auth import get_user_model

        wanted = {int(i) for i in ids if str(i).isdigit()}
        if not wanted:
            return []
        users = get_user_model().objects.filter(id__in=sorted(wanted))
        return [person_card(u) for u in users]

    @database_sync_to_async
    def _page_people(self):
        """Everyone who has put something on this page, plus the owner.

        Sent with the snapshot, so a bubble can be labelled for somebody who
        drew yesterday and is not connected today. One query for the page and
        one for the people, however many marks they left.
        """
        from .models import Board, BoardPage, BoardSession

        board = Board.objects.filter(pk=self.board_id).first()
        if not board:
            return []
        session = BoardSession.objects.filter(board=board).first()
        page = BoardPage.objects.filter(
            board=board, index=session.page_index if session else 0
        ).first()
        ids = {str(board.owner_id)}
        for bag in ((page.strokes if page else []), (page.els if page else [])):
            for item in bag or []:
                if isinstance(item, dict) and item.get("by"):
                    ids.add(str(item["by"]))
        return self._people_cards(ids)

    @database_sync_to_async
    def _my_card(self):
        user = self.scope.get("user")
        if user and getattr(user, "is_authenticated", False):
            return person_card(user)
        # A phone paired by the number rather than by signing in is the
        # teacher's own phone — the owner granted it — so it draws as the
        # owner rather than as nobody.
        cards = self._people_cards([self.owner_id])
        return cards[0] if cards else None

    @database_sync_to_async
    def _session_info(self, code, extend=False):
        from .models import BoardSession

        s = BoardSession.objects.select_related("board").filter(code=code).first()
        if not s:
            return None
        if extend and s.is_live:
            s.extend()
        return {
            "board_id": s.board_id,
            "owner_id": s.board.owner_id,
            "token": s.token,
            "revision": s.revision,
            "live": s.is_live,
            "guests": s.board.guests_allowed,
        }

    @database_sync_to_async
    def _has_session_grant(self):
        """Was this browser handed a grant by ControlView?

        The phone's proof of pairing lives in its Django session, not in a
        token that has to survive a QR scan, a redirect and a JSON round-trip
        through the page. That round-trip was the reason a freshly scanned
        code could come back "pairing expired".
        """
        session = self.scope.get("session")
        if not session:
            return False
        grants = session.get("chalk_grants") or {}
        held = grants.get(str(self.board_id))
        return bool(held) and compare_digest(str(held), self.token)

    @database_sync_to_async
    def _snapshot(self):
        from .models import Board, BoardPage, BoardSession

        board = Board.objects.get(pk=self.board_id)
        session = BoardSession.objects.get(board=board)
        pages = list(BoardPage.objects.filter(board=board).order_by("index"))
        if not pages:
            pages = [board.ensure_page(0)]
        page = next((p for p in pages if p.index == session.page_index), None)
        if page is None:
            # The session points at a page that no longer exists. Land on the
            # last one rather than conjuring a blank via get_or_create.
            page = pages[-1]
            BoardSession.objects.filter(pk=session.pk).update(page_index=page.index)
        els, healed = heal_image_srcs(self.board_id, list(page.els or []))
        if healed:
            BoardPage.objects.filter(pk=page.pk).update(els=els)
        return {
            "title": board.title,
            "surface": board.surface,
            "pageIndex": page.index,
            "pageCount": len(pages),
            "strokes": page.strokes,
            "els": els,
            "canUndo": bool(page.history),
            "canRedo": bool(page.undone),
        }

    def _page_locked(self):
        from .models import BoardPage, BoardSession

        session = BoardSession.objects.select_for_update().get(board_id=self.board_id)
        page = (
            BoardPage.objects.select_for_update()
            .filter(board_id=self.board_id, index=session.page_index)
            .first()
        )
        if page is None:
            page, _ = BoardPage.objects.get_or_create(
                board_id=self.board_id, index=session.page_index
            )
            page = BoardPage.objects.select_for_update().get(pk=page.pk)
        return session, page

    def _touch_board(self):
        from .models import Board

        Board.objects.filter(pk=self.board_id).update(updated_at=self._now())

    @staticmethod
    def _now():
        from django.utils import timezone

        return timezone.now()

    # -- history -------------------------------------------------------
    #
    # One undo stack and one redo stack, shared by both layers. Entries:
    #
    #   {"op": "add"|"del", "layer": "ink"|"els",
    #    "items": [{"i": <index>, "s": <object>}]}
    #   {"op": "edit", "layer": "els",
    #    "items": [{"id": ..., "before": {...}, "after": {...}}]}
    #   {"op": "xform", "layer": "ink",
    #    "items": [{"ids": [...], "m": [a,b,c,d,e,f], "inv": [...]}]}
    #   {"op": "splice", "layer": "ink", "gid": "...",
    #    "items": [{"k": "out"|"in", "i": index, "s": {...}}]}
    #
    # "add" means those objects were put on the board; "del" means they were
    # taken off; "edit" means one element's fields changed. Undo applies the
    # opposite, redo applies it again. Storing the index lets an undone erase
    # come back in its original z-order.
    #
    # A wipe touches both layers at once and must undo as one action, so it is
    # stored as a single entry carrying its other half in `also`.
    #
    # Entries written before elements existed have no "layer" and default to
    # ink, so a page mid-lesson keeps working across the upgrade.

    @staticmethod
    def _apply(objects, entry, forward):
        """Mutate `objects` and return the ops a client needs to match:
        {"add": [{i, s}], "del": [ids], "edit": [{id, patch, drop}],
         "xform": [{sel, ids, m}]}."""
        op = entry.get("op")
        raw = entry.get("items") or []

        if op == "xform":
            # Forward replays the move, backward applies its inverse. Each
            # application gets a fresh `sel` so every client treats it as a
            # new gesture and re-reads its own ink as the starting point.
            moves = []
            for n, it in enumerate(raw):
                if not isinstance(it, dict):
                    continue
                m = it.get("m") if forward else it.get("inv")
                ids = it.get("ids") or []
                if not isinstance(m, (list, tuple)) or len(m) != 6 or not ids:
                    continue
                m = list(m)
                hit = xform_strokes(objects, ids, m)
                if not hit:
                    continue
                moves.append(
                    {"sel": "h%d%d" % (time.monotonic_ns(), n), "ids": hit, "m": m}
                )
            return {"add": [], "del": [], "edit": [], "xform": moves}

        if op == "edit":
            key, other = ("after", "before") if forward else ("before", "after")
            edits = []
            for it in raw:
                if not isinstance(it, dict):
                    continue
                eid = it.get("id")
                want = it.get(key) or {}
                had = it.get(other) or {}
                target = next((o for o in objects if o.get("id") == eid), None)
                if target is None:
                    continue
                # A key present on one side and absent on the other was absent
                # from the element too — remove it rather than leave it stale.
                drop = [k for k in had if k not in want]
                target.update(want)
                for k in drop:
                    target.pop(k, None)
                edits.append({"id": eid, "patch": want, "drop": drop})
            return {"add": [], "del": [], "edit": edits, "xform": []}

        if op == "splice":
            # Out and in together, in one step. Used by the duster (a stroke
            # leaves, its surviving pieces arrive) and by reordering, where
            # the same strokes leave and come back at different indices.
            outs = [it for it in raw if isinstance(it, dict) and it.get("k") == "out"]
            ins = [it for it in raw if isinstance(it, dict) and it.get("k") == "in"]
            drop, put = (outs, ins) if forward else (ins, outs)
            gone = {it["s"].get("id") for it in drop if "s" in it}
            objects[:] = [o for o in objects if o.get("id") not in gone]
            placed = []
            for it in sorted(put, key=lambda i: i.get("i", 0)):
                if "s" not in it:
                    continue
                idx = min(max(0, int(it.get("i", len(objects)))), len(objects))
                objects.insert(idx, it["s"])
                placed.append({"i": idx, "s": it["s"]})
            return {
                "add": placed, "del": sorted(i for i in gone if i),
                "edit": [], "xform": [],
            }

        items = [it for it in raw if isinstance(it, dict) and "s" in it]
        adding = (op == "add") == forward
        if adding:
            placed = []
            for it in sorted(items, key=lambda i: i.get("i", 0)):
                idx = min(max(0, int(it.get("i", len(objects)))), len(objects))
                objects.insert(idx, it["s"])
                placed.append({"i": idx, "s": it["s"]})
            return {"add": placed, "del": [], "edit": [], "xform": []}
        gone = {it["s"].get("id") for it in items}
        objects[:] = [o for o in objects if o.get("id") not in gone]
        return {
            "add": [], "del": sorted(i for i in gone if i),
            "edit": [], "xform": [],
        }

    @classmethod
    def _apply_entry(cls, strokes, els, entry, forward):
        """Apply an entry and its `also` half, routing each to its own layer."""
        ops = {"ink": None, "els": None}
        for part in (entry, entry.get("also")):
            if not isinstance(part, dict):
                continue
            layer = "els" if part.get("layer") == "els" else "ink"
            result = cls._apply(els if layer == "els" else strokes, part, forward)
            if ops[layer] is None:
                ops[layer] = result
            else:
                for k in ("add", "del", "edit", "xform"):
                    ops[layer][k] = ops[layer][k] + result[k]
        return ops

    @staticmethod
    def _trim_history(history, undone):
        """Bound both stacks by entry count AND by total strokes retained.

        Entry count alone was not enough: one `clear` on a full page copies
        every stroke into a single entry, so sixty entries could hold many
        times the page itself.
        """
        history = history[-MAX_UNDO:]
        undone = undone[-MAX_UNDO:]
        while _history_items([history, undone]) > MAX_HISTORY_ITEMS:
            if undone:
                undone.pop(0)
            elif history:
                history.pop(0)
            else:
                break
        return history, undone

    def _push(self, page, entry):
        history = list(page.history or [])
        history.append(entry)
        page.history, page.undone = self._trim_history(history, [])

    @database_sync_to_async
    def _commit_stroke(self, stroke):
        with transaction.atomic():
            _, page = self._page_locked()
            strokes = list(page.strokes or [])
            # A retried stroke_end must not double-commit.
            if any(s.get("id") == stroke["id"] for s in strokes):
                return
            strokes.append(stroke)
            self._push(
                page,
                {
                    "op": "add", "layer": "ink",
                    "items": [{"i": len(strokes) - 1, "s": stroke}],
                },
            )
            if len(strokes) > MAX_STROKES_PER_PAGE:
                # Dropping strokes invalidates every index held in history, so
                # the undo stack goes with them rather than silently
                # reinserting things at the wrong z-order.
                strokes = strokes[-MAX_STROKES_PER_PAGE:]
                page.history = []
                page.undone = []
            page.strokes = strokes
            page.save(update_fields=["strokes", "history", "undone", "updated_at"])
            self._touch_board()

    @database_sync_to_async
    def _erase(self, ids):
        with transaction.atomic():
            _, page = self._page_locked()
            wanted = set(ids)
            strokes = list(page.strokes or [])
            items = [
                {"i": i, "s": s} for i, s in enumerate(strokes) if s.get("id") in wanted
            ]
            if not items:
                return None
            entry = {"op": "del", "layer": "ink", "items": items}
            ops = self._apply(strokes, entry, True)
            self._push(page, entry)
            page.strokes = strokes
            page.save(update_fields=["strokes", "history", "undone", "updated_at"])
            self._touch_board()
            return {
                "ids": ops["del"],
                "canUndo": bool(page.history),
                "canRedo": bool(page.undone),
            }

    @database_sync_to_async
    def _paste(self, els, strokes):
        """Land a copied selection — objects, writing, or both — as one action.

        Both halves go in a single entry, the ink as the entry itself and the
        objects as its `also`, so pasting a labelled diagram is one Undo
        rather than one per piece.
        """
        with transaction.atomic():
            _, page = self._page_locked()
            cur_ink = list(page.strokes or [])
            cur_els = list(page.els or [])

            have_ink = {s.get("id") for s in cur_ink}
            room_ink = MAX_STROKES_PER_PAGE - len(cur_ink)
            ink_items, added = [], []
            for st in strokes:
                if len(added) >= room_ink or st["id"] in have_ink:
                    continue
                have_ink.add(st["id"])
                cur_ink.append(st)
                item = {"i": len(cur_ink) - 1, "s": st}
                ink_items.append(item)
                added.append(item)

            have_els = {e.get("id") for e in cur_els}
            room_els = MAX_ELS_PER_PAGE - len(cur_els)
            el_items, placed = [], []
            for el in els:
                if len(placed) >= room_els or el["id"] in have_els:
                    continue
                have_els.add(el["id"])
                cur_els.append(el)
                el_items.append({"i": len(cur_els) - 1, "s": el})
                placed.append(el)

            if not ink_items and not el_items:
                return None

            entry = {"op": "add", "layer": "ink", "items": ink_items}
            if el_items:
                entry["also"] = {"op": "add", "layer": "els", "items": el_items}
            self._push(page, entry)

            page.strokes = cur_ink
            page.els = cur_els
            page.save(
                update_fields=["strokes", "els", "history", "undone", "updated_at"]
            )
            self._touch_board()
            if placed:
                self._remember_types(cur_els)
            return {
                "add": added,
                "els": placed,
                "canUndo": bool(page.history),
                "canRedo": bool(page.undone),
            }

    @database_sync_to_async
    def _ink_wipe(self, gid, path, radius):
        """Rub out the part of every stroke the duster passed over.

        Consecutive chunks of one wipe merge into a single history entry, so
        a five-second rub is one Undo. Merging cancels pairs: a fragment that
        chunk two removed and chunk one had added disappears from both lists,
        or undo would put the intermediate fragment back alongside the
        original stroke.
        """
        with transaction.atomic():
            _, page = self._page_locked()
            strokes = list(page.strokes or [])
            counter = [0]

            def new_id():
                counter[0] += 1
                return "w%s%d" % (uuid.uuid4().hex[:10], counter[0])

            out, added = wipe_strokes(strokes, path, radius, new_id)
            if not out:
                return None

            gone = {s["id"] for _, s in out}
            strokes = [s for s in strokes if s["id"] not in gone]
            placed = []
            for idx, piece in sorted(added, key=lambda p: p[0]):
                at = min(max(0, idx), len(strokes))
                strokes.insert(at, piece)
                placed.append({"i": at, "s": piece})

            items = [{"k": "out", "i": i, "s": s} for i, s in out]
            items += [{"k": "in", "i": p["i"], "s": p["s"]} for p in placed]

            history = list(page.history or [])
            last = history[-1] if history else None
            if (
                isinstance(last, dict)
                and last.get("op") == "splice"
                and last.get("layer") == "ink"
                and last.get("gid") == gid
            ):
                merged = last.get("items", []) + items
                # A fragment this wipe created and then rubbed away again
                # never existed as far as the outside is concerned: drop both
                # halves, or undo would restore the intermediate piece
                # alongside the original stroke.
                arrived = {it["s"]["id"] for it in merged if it["k"] == "in"}
                left = {it["s"]["id"] for it in merged if it["k"] == "out"}
                cancelled = arrived & left
                last["items"] = [
                    it for it in merged if it["s"]["id"] not in cancelled
                ]
                page.history = history
                page.undone = []
            else:
                self._push(
                    page,
                    {"op": "splice", "layer": "ink", "gid": gid, "items": items},
                )

            page.strokes = strokes
            page.save(update_fields=["strokes", "history", "undone", "updated_at"])
            self._touch_board()
            return {
                "add": placed,
                "del": sorted(gone),
                "canUndo": bool(page.history),
                "canRedo": bool(page.undone),
            }

    @database_sync_to_async
    def _ink_band(self, ids, front):
        """Move handwriting in front of the objects, or behind them."""
        with transaction.atomic():
            _, page = self._page_locked()
            strokes = list(page.strokes or [])
            want = set(ids)
            moved = []
            for st in strokes:
                if st.get("id") in want and (st.get("top") is not False) != front:
                    st["top"] = front
                    moved.append(st["id"])
            if not moved:
                return None
            page.strokes = strokes
            page.save(update_fields=["strokes", "updated_at"])
            self._touch_board()
            return {"ids": moved}

    @database_sync_to_async
    def _el_multi(self, items):
        """Patch many elements as one action.

        Moving a group of eight is one thing the teacher did, so it is one
        entry, holding the before and after of each element.
        """
        with transaction.atomic():
            _, page = self._page_locked()
            els = list(page.els or [])
            by_id = {e.get("id"): e for e in els}
            entry_items, done = [], []
            for it in items:
                el = by_id.get(it["id"])
                if el is None:
                    continue
                patch = it["patch"]
                before = {k: el[k] for k in patch if k in el}
                if all(el.get(k) == v for k, v in patch.items()):
                    continue
                el.update(patch)
                entry_items.append(
                    {"id": it["id"], "before": before, "after": dict(patch)}
                )
                done.append({"id": it["id"], "patch": patch})
            if not done:
                return None
            self._push(page, {"op": "edit", "layer": "els", "items": entry_items})
            page.els = els
            page.save(update_fields=["els", "history", "undone", "updated_at"])
            self._touch_board()
            return {
                "items": done,
                "canUndo": bool(page.history),
                "canRedo": bool(page.undone),
            }

    @database_sync_to_async
    def _ink_xform(self, ids, m):
        """Move, resize or turn a set of strokes. One gesture, one entry.

        The whole drag is one row in the undo stack, the same way dragging an
        element is: it is one thing the teacher did, and stepping back through
        it point by point would be unusable.
        """
        with transaction.atomic():
            _, page = self._page_locked()
            strokes = list(page.strokes or [])
            touched = xform_strokes(strokes, ids, m)
            if not touched:
                return None
            self._push(
                page,
                {
                    "op": "xform", "layer": "ink",
                    "items": [{"ids": touched, "m": m, "inv": invert_matrix(m)}],
                },
            )
            page.strokes = strokes
            page.save(update_fields=["strokes", "history", "undone", "updated_at"])
            self._touch_board()
            return {
                "ids": touched,
                "canUndo": bool(page.history),
                "canRedo": bool(page.undone),
            }

    @database_sync_to_async
    def _history(self, action):
        """Returns the ops to broadcast, or {"changed": False}.

        This used to return nothing and the caller broadcast a full snapshot
        unconditionally, so holding Undo on an empty stack rebroadcast the
        entire page to every socket, repeatedly.
        """
        idle = {"changed": False}
        with transaction.atomic():
            _, page = self._page_locked()
            strokes = list(page.strokes or [])
            els = list(page.els or [])
            history = list(page.history or [])
            undone = list(page.undone or [])

            if action == "clear":
                if not strokes and not els:
                    return idle
                # One wipe, one undo: the ink and the objects come back
                # together, because that is what the teacher just did.
                entry = {
                    "op": "del", "layer": "ink",
                    "items": [{"i": i, "s": o} for i, o in enumerate(strokes)],
                    "also": {
                        "op": "del", "layer": "els",
                        "items": [{"i": i, "s": o} for i, o in enumerate(els)],
                    },
                }
                ops = self._apply_entry(strokes, els, entry, True)
                history.append(entry)
                undone = []
            elif action in ("undo", "redo"):
                stack, other = (history, undone) if action == "undo" else (undone, history)
                if not stack:
                    return idle
                entry = stack.pop()
                ops = self._apply_entry(strokes, els, entry, action == "redo")
                other.append(entry)
            else:
                return idle

            history, undone = self._trim_history(history, undone)
            page.strokes = strokes
            page.els = els
            page.history = history
            page.undone = undone
            page.save(
                update_fields=["strokes", "els", "history", "undone", "updated_at"]
            )
            self._touch_board()
            return {
                "changed": True,
                "ops": ops,
                "canUndo": bool(history),
                "canRedo": bool(undone),
            }

    # -- elements --------------------------------------------------------
    #
    # `_el_cache` mirrors id -> type for this socket. It exists so `el_live`,
    # which fires many times a second during a drag, can validate a `pts`
    # patch against the element's type without a database round-trip per
    # frame. It is only ever used to choose a validation branch.

    def _type_of(self, eid):
        return getattr(self, "_el_cache", {}).get(eid)

    def _remember_types(self, els):
        self._el_cache = {
            e.get("id"): e.get("type") for e in els if isinstance(e, dict)
        }

    @database_sync_to_async
    def _el_add(self, el):
        with transaction.atomic():
            _, page = self._page_locked()
            els = list(page.els or [])
            if len(els) >= MAX_ELS_PER_PAGE:
                return None
            if any(e.get("id") == el["id"] for e in els):
                return None
            els.append(el)
            self._push(
                page,
                {
                    "op": "add", "layer": "els",
                    "items": [{"i": len(els) - 1, "s": el}],
                },
            )
            page.els = els
            page.save(update_fields=["els", "history", "undone", "updated_at"])
            self._touch_board()
            self._remember_types(els)
            return {"canUndo": bool(page.history), "canRedo": bool(page.undone)}

    @database_sync_to_async
    def _el_add_many(self, incoming):
        """Add a whole template as a single action.

        One history entry for the lot: dropping in a times-table grid and
        changing your mind should be one Undo, not forty.
        """
        with transaction.atomic():
            _, page = self._page_locked()
            els = list(page.els or [])
            have = {e.get("id") for e in els}
            room = MAX_ELS_PER_PAGE - len(els)
            if room <= 0:
                return None
            placed, items = [], []
            for el in incoming:
                if len(placed) >= room:
                    break
                if el["id"] in have:
                    continue
                have.add(el["id"])
                els.append(el)
                items.append({"i": len(els) - 1, "s": el})
                placed.append(el)
            if not placed:
                return None
            self._push(page, {"op": "add", "layer": "els", "items": items})
            page.els = els
            page.save(update_fields=["els", "history", "undone", "updated_at"])
            self._touch_board()
            self._remember_types(els)
            return {
                "els": placed,
                "canUndo": bool(page.history),
                "canRedo": bool(page.undone),
            }

    @database_sync_to_async
    def _el_update(self, eid, patch):
        with transaction.atomic():
            _, page = self._page_locked()
            els = list(page.els or [])
            target = next((e for e in els if e.get("id") == eid), None)
            if target is None:
                return None
            # id and type are identity, never patchable, and a point list only
            # means anything on the type that has one.
            patch = {k: v for k, v in patch.items() if k not in ("id", "type")}
            if "pts" in patch and target.get("type") != "freeform":
                patch.pop("pts")
            if not patch:
                return None
            before = {k: target[k] for k in patch if k in target}
            if before == patch and set(before) == set(patch):
                return None  # nothing actually moved
            target.update(patch)
            self._push(
                page,
                {
                    "op": "edit", "layer": "els",
                    "items": [{"id": eid, "before": before, "after": dict(patch)}],
                },
            )
            page.els = els
            page.save(update_fields=["els", "history", "undone", "updated_at"])
            self._touch_board()
            return {
                "patch": patch,
                "canUndo": bool(page.history),
                "canRedo": bool(page.undone),
            }

    @database_sync_to_async
    def _el_delete(self, ids):
        with transaction.atomic():
            _, page = self._page_locked()
            els = list(page.els or [])
            wanted = set(ids)
            items = [
                {"i": i, "s": e} for i, e in enumerate(els) if e.get("id") in wanted
            ]
            if not items:
                return None
            entry = {"op": "del", "layer": "els", "items": items}
            ops = self._apply(els, entry, True)
            self._push(page, entry)
            page.els = els
            page.save(update_fields=["els", "history", "undone", "updated_at"])
            self._touch_board()
            self._remember_types(els)
            return {
                "ids": ops["del"],
                "canUndo": bool(page.history),
                "canRedo": bool(page.undone),
            }

    @database_sync_to_async
    def _el_raise(self, eid):
        """Bring to front.

        Deliberately not undoable. Z-order churn is constant while arranging a
        diagram, and putting it on the stack would bury the marks the teacher
        actually wants to step back through.
        """
        with transaction.atomic():
            _, page = self._page_locked()
            els = list(page.els or [])
            target = next((e for e in els if e.get("id") == eid), None)
            if target is None or els[-1] is target:
                return False
            els.remove(target)
            els.append(target)
            page.els = els
            page.save(update_fields=["els", "updated_at"])
            self._touch_board()
            return True

    @database_sync_to_async
    def _set_surface(self, surface):
        from .models import Board

        Board.objects.filter(pk=self.board_id).update(
            surface=surface, updated_at=self._now()
        )

    # -- pages ---------------------------------------------------------
    #
    # Indices are dense: 0..count-1, always. The phone navigates by
    # `index + 1`, so a gap used to make "previous page" resurrect a page you
    # had just deleted, via get_or_create.

    @database_sync_to_async
    def _goto_page(self, index):
        from .models import BoardPage, BoardSession

        with transaction.atomic():
            session = BoardSession.objects.select_for_update().get(
                board_id=self.board_id
            )
            if session.page_index == index:
                return False
            if not BoardPage.objects.filter(
                board_id=self.board_id, index=index
            ).exists():
                return False  # navigation never creates a page
            session.page_index = index
            session.save(update_fields=["page_index"])
            self._touch_board()
            return True

    @database_sync_to_async
    def _add_page(self):
        from .models import BoardPage, BoardSession

        with transaction.atomic():
            session = BoardSession.objects.select_for_update().get(
                board_id=self.board_id
            )
            count = BoardPage.objects.filter(board_id=self.board_id).count()
            if count >= MAX_PAGES:
                return False
            BoardPage.objects.create(board_id=self.board_id, index=count)
            session.page_index = count
            session.save(update_fields=["page_index"])
            self._touch_board()
            return True

    @database_sync_to_async
    def _delete_page(self):
        from .models import Board, BoardPage, BoardSession

        with transaction.atomic():
            session = BoardSession.objects.select_for_update().get(
                board_id=self.board_id
            )
            board = Board.objects.get(pk=self.board_id)
            pages = list(BoardPage.objects.filter(board=board).order_by("index"))
            if len(pages) <= 1:
                # Never leave a board with no page — wipe it instead.
                page = pages[0] if pages else None
                if page and (page.strokes or page.history or page.undone):
                    page.strokes = []
                    page.history = []
                    page.undone = []
                    page.save(
                        update_fields=["strokes", "history", "undone", "updated_at"]
                    )
                    self._touch_board()
                    return True
                return False

            position = next(
                (i for i, p in enumerate(pages) if p.index == session.page_index), 0
            )
            BoardPage.objects.filter(pk=pages[position].pk).delete()
            remaining = board.renumber_pages()
            # Land on the neighbour, not on the last page in the board.
            session.page_index = min(position, remaining - 1)
            session.save(update_fields=["page_index"])
            self._touch_board()
            return True
