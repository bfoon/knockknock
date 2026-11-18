"""The parts people design in the Circuit Lab, and the board studio's data.

A part is a footprint (pads, holes, silkscreen, a body for the 3-D view), a
name for each pin, a few lines saying how it behaves in the simulator, and
the drawer it lives in. They are designed in the browser
(static/chalk/js/lab/lab_partmaker.js, lab_fp.js) and saved here, per
person, so a part made for one project is in the drawer for every project.

Everything that arrives is whitelisted and bounded: numbers are clamped,
strings are trimmed and pattern-checked, lists are capped. The browser does
the real work (and re-checks the behaviour when it compiles it); this only
makes sure what is stored is small, numeric and well-formed.

Also here: the cleaners for the board studio's v2 board (shapes, cut-outs,
board-only footprints, holes, pours, links, net labels) and for the
experiments saved with a circuit, used by chalk.lab.clean_circuit.
"""

import json
import re

from django.contrib.auth.mixins import LoginRequiredMixin
from django.http import JsonResponse
from django.views import View

from . import throttle
from .models import ChalkPart

PART_TYPE_RE = re.compile(r"^cp_[a-z0-9_]{2,28}$")
PAD_RE = re.compile(r"^[A-Za-z0-9+\-_]{1,6}$")
FP_ID_RE = re.compile(r"^[A-Za-z0-9_.:\-]{1,48}$")
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
NET_RE = re.compile(r"^[A-Za-z0-9_+\-./]{1,24}$")
KEY_RE = re.compile(r"^([A-Za-z0-9_-]{1,40}):([#A-Za-z0-9_+\-./']{1,24})$")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{3,8}$")
REF_LETTERS = re.compile(r"^[A-Z]{1,3}$")

PAD_SHAPES = {"rect", "roundrect", "circle", "oval"}
BODY_SHAPES = {"box", "cyl", "rod", "half"}
LOOKS = {"ic", "conn", "res", "cap", "led", "diode", "xtal", "switch", "module", "sensor", "generic"}
PIN_KINDS = {"", "power", "ground", "input", "output", "bidir", "passive", "nc"}

MAX_PADS = 400
MAX_HOLES = 64
MAX_SILK = 600
MAX_BEHAVE = 8000
MAX_PART_BYTES = 120_000
MAX_LIB = 40            # parts carried inside one circuit
MAX_PARTS_PER_USER = 300
MAX_SIMS = 30
MAX_SIM = 8000
PART_LIMIT = 60         # saves a minute

MAX_ITEMS = 400         # board-only things on a board
MAX_LINKS = 400
MAX_LABELS = 800
MAX_OUTLINE = 400
MAX_CUTS = 40


class Invalid(ValueError):
    """What was sent isn't a part (or a board) we can keep."""


def _f(v, lo, hi, default=0.0):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return default
    return round(min(hi, max(lo, float(v))), 4)


def _s(v, limit, pattern=None, default=""):
    if not isinstance(v, str):
        return default
    v = v.strip()[:limit]
    if pattern is not None and v and not pattern.match(v):
        return default
    return v


def _text(v, limit):
    """Free text: printable, no angle brackets (it ends up inside SVG)."""
    if not isinstance(v, str):
        return ""
    return re.sub(r"[<>\x00-\x08\x0b\x0c\x0e-\x1f]", "", v).strip()[:limit]


def _pts(raw, limit, lo=-500.0, hi=1000.0):
    out = []
    if not isinstance(raw, list):
        return out
    for q in raw[:limit]:
        if isinstance(q, list) and len(q) >= 2 and all(isinstance(c, (int, float)) and not isinstance(c, bool) for c in q[:2]):
            out.append([_f(q[0], lo, hi), _f(q[1], lo, hi)])
    return out


# --------------------------------------------------------------------------
# a footprint and a part
# --------------------------------------------------------------------------

def clean_footprint(raw):
    if not isinstance(raw, dict):
        raise Invalid("the part has no footprint")
    pads = []
    for p in (raw.get("pads") or [])[:MAX_PADS] if isinstance(raw.get("pads"), list) else []:
        if not isinstance(p, dict):
            continue
        n = _s(p.get("n") if not isinstance(p.get("n"), (int, float)) or isinstance(p.get("n"), bool) else str(int(p.get("n"))), 6, PAD_RE)
        if not n:
            continue
        pad = {
            "n": n, "x": _f(p.get("x"), -200, 200), "y": _f(p.get("y"), -200, 200),
            "shape": p.get("shape") if p.get("shape") in PAD_SHAPES else "rect",
            "w": _f(p.get("w"), 0.05, 60, 1.6), "h": _f(p.get("h"), 0.05, 60, 1.6),
        }
        name = _text(p.get("name"), 16)
        if name:
            pad["name"] = name
        drill = _f(p.get("drill"), 0, 20)
        if drill > 0:
            pad["drill"] = drill
        slot = p.get("slot")
        if isinstance(slot, list) and len(slot) == 2:
            pad["slot"] = [_f(slot[0], 0.1, 30, 1), _f(slot[1], 0.1, 30, 1)]
            pad["drill"] = pad.get("drill") or min(pad["slot"])
        if not pad.get("drill"):
            pad["side"] = "bottom" if p.get("side") == "bottom" else "top"
        deg = p.get("deg")
        if deg in (90, 180, 270):
            pad["deg"] = deg
        mask = _f(p.get("mask"), 0, 10)
        if mask:
            pad["mask"] = mask
        pads.append(pad)
    if not pads:
        raise Invalid("a part needs at least one pad")
    holes = []
    for h in (raw.get("holes") or [])[:MAX_HOLES] if isinstance(raw.get("holes"), list) else []:
        if isinstance(h, dict):
            holes.append({"x": _f(h.get("x"), -200, 200), "y": _f(h.get("y"), -200, 200), "d": _f(h.get("d"), 0.2, 30, 3.2)})
    silk = []
    sizes = {"l": 4, "c": 3, "a": 5, "d": 2}
    for s in (raw.get("silk") or [])[:MAX_SILK] if isinstance(raw.get("silk"), list) else []:
        if not isinstance(s, dict):
            continue
        for k, n in sizes.items():
            v = s.get(k)
            if isinstance(v, list) and len(v) == n and all(isinstance(c, (int, float)) and not isinstance(c, bool) for c in v):
                silk.append({k: [_f(c, -400, 400) for c in v]})
                break
    out = {
        "id": _s(raw.get("id"), 48, FP_ID_RE) or "custom",
        "name": _text(raw.get("name"), 80) or "Custom footprint",
        "ref": _s(raw.get("ref"), 3, REF_LETTERS) or "U",
        "kind": raw.get("kind") if raw.get("kind") in ("tht", "smd", "mixed") else "tht",
        "pads": pads, "holes": holes, "silk": silk,
    }
    body = raw.get("body")
    if isinstance(body, dict):
        b = {"x": _f(body.get("x"), -200, 200), "y": _f(body.get("y"), -200, 200), "w": _f(body.get("w"), 0.1, 200, 2),
             "h": _f(body.get("h"), 0.1, 200, 2), "z": _f(body.get("z"), 0.05, 60, 2),
             "shape": body.get("shape") if body.get("shape") in BODY_SHAPES else "box",
             "color": body.get("color") if isinstance(body.get("color"), str) and HEX_RE.match(body.get("color")) else "#1d1f22",
             "look": _s(body.get("look"), 12, re.compile(r"^[a-z0-9]+$")) or "ic"}
        if body.get("edge") in ("top", "bottom", "left", "right"):
            b["edge"] = body["edge"]
        out["body"] = b
    court = raw.get("court")
    if isinstance(court, dict):
        out["court"] = {k: _f(court.get(k), -400, 400) for k in ("x0", "y0", "x1", "y1")}
    keepout = raw.get("keepout")
    if isinstance(keepout, dict):
        out["keepout"] = {k: _f(keepout.get(k), -400, 400) for k in ("x0", "y0", "x1", "y1")}
    return out


def clean_part(ptype, raw):
    """One designed part. Raises Invalid with a reason."""
    if not isinstance(ptype, str) or not PART_TYPE_RE.match(ptype):
        raise Invalid("a part's type must look like cp_my_part")
    if not isinstance(raw, dict):
        raise Invalid("the part is not an object")
    pins = {}
    for n, v in list((raw.get("pins") or {}).items())[:MAX_PADS] if isinstance(raw.get("pins"), dict) else []:
        if isinstance(n, str) and PAD_RE.match(n) and isinstance(v, dict):
            pins[n] = {"name": _text(v.get("name"), 16) or n, "type": v.get("type") if v.get("type") in PIN_KINDS else ""}
    behave = raw.get("behave") or ""
    if not isinstance(behave, str):
        raise Invalid("the behaviour is not text")
    if len(behave) > MAX_BEHAVE:
        raise Invalid("the behaviour is too long")
    out = {
        "name": _text(raw.get("name"), 40) or "My part",
        "value": _text(raw.get("value"), 24),
        "ref": _s(raw.get("ref"), 3, REF_LETTERS) or "U",
        "cat": _text(raw.get("cat"), 24) or "My parts",
        "look": raw.get("look") if raw.get("look") in LOOKS else "generic",
        "color": raw.get("color") if isinstance(raw.get("color"), str) and HEX_RE.match(raw.get("color")) else "",
        "desc": _text(raw.get("desc"), 200),
        "fp": clean_footprint(raw.get("fp")),
        "pins": pins,
        "behave": behave.replace("\x00", ""),
    }
    if len(json.dumps(out)) > MAX_PART_BYTES:
        raise Invalid("the part is too big")
    return out


def clean_lib(raw, used_types=None):
    """The parts a circuit carries with it. Bad entries are dropped."""
    out = {}
    if not isinstance(raw, dict):
        return out
    for t, data in list(raw.items())[:MAX_LIB]:
        if used_types is not None and t not in used_types:
            continue
        try:
            out[t] = clean_part(t, data)
        except Invalid:
            continue
    return out


def clean_sims(raw):
    """Experiments saved with a circuit: a name and the scenario text."""
    out = []
    for s in (raw or [])[:MAX_SIMS] if isinstance(raw, list) else []:
        if isinstance(s, dict) and isinstance(s.get("src"), str):
            out.append({"name": _text(s.get("name"), 60) or "Experiment", "src": s["src"].replace("\x00", "")[:MAX_SIM]})
    return out


# --------------------------------------------------------------------------
# the board studio's extra board fields (v2)
# --------------------------------------------------------------------------

def _shape(raw):
    if not isinstance(raw, dict):
        return {"kind": "rect"}
    kind = raw.get("kind")
    if kind == "poly":
        pts = _pts(raw.get("pts"), MAX_OUTLINE, 0, 500)
        if len(pts) >= 3:
            return {"kind": "poly", "pts": pts}
        return {"kind": "rect"}
    return {"kind": "circle"} if kind == "circle" else {"kind": "rect"}


def _cut(c):
    if not isinstance(c, dict):
        return None
    kind = c.get("kind")
    if kind not in ("rect", "circle", "poly"):
        return None
    if kind == "circle":
        return {"kind": "circle", "x": _f(c.get("x"), -50, 500), "y": _f(c.get("y"), -50, 500), "d": _f(c.get("d"), 0.5, 400, 4)}
    if kind == "poly":
        pts = _pts(c.get("pts"), MAX_OUTLINE, -50, 500)
        return {"kind": "poly", "pts": pts} if len(pts) >= 3 else None
    return {"kind": "rect", "x": _f(c.get("x"), -50, 500), "y": _f(c.get("y"), -50, 500), "w": _f(c.get("w"), 0.5, 400, 4),
            "h": _f(c.get("h"), 0.5, 400, 4), "r": _f(c.get("r"), 0, 50)}


def _item(it):
    if not isinstance(it, dict):
        return None
    iid, kind = it.get("id"), it.get("kind")
    if not isinstance(iid, str) or not ID_RE.match(iid):
        return None
    xy = {"x": _f(it.get("x"), -50, 500), "y": _f(it.get("y"), -50, 500)}
    if kind == "fp":
        fp = _s(it.get("fp"), 48, FP_ID_RE)
        if not fp:
            return None
        out = {"id": iid, "kind": "fp", "fp": fp, **xy, "rot": it["rot"] % 4 if isinstance(it.get("rot"), int) and not isinstance(it.get("rot"), bool) else 0}
        if it.get("side") == "bottom":
            out["side"] = "bottom"
        ref = _s(it.get("ref"), 8, re.compile(r"^[A-Za-z0-9_]+$"))
        if ref:
            out["ref"] = ref
        value = _text(it.get("value"), 40)
        if value:
            out["value"] = value
        if isinstance(it.get("names"), list):
            out["names"] = [_text(n, 16) for n in it["names"][:MAX_PADS]]
        return out
    if kind == "hole":
        return {"id": iid, "kind": "hole", **xy, "d": _f(it.get("d"), 0.3, 30, 3.2), "plated": bool(it.get("plated"))}
    if kind == "array":
        return {"id": iid, "kind": "array", **xy, "pattern": "circle" if it.get("pattern") == "circle" else "grid",
                "cols": int(_f(it.get("cols"), 1, 80, 10)), "rows": int(_f(it.get("rows"), 1, 80, 6)), "pitch": _f(it.get("pitch"), 0.5, 20, 2.54),
                "d": _f(it.get("d"), 0.3, 10, 1.0), "pad": _f(it.get("pad"), 0, 12, 1.8), "n": int(_f(it.get("n"), 2, 64, 6)),
                "radius": _f(it.get("radius"), 1, 200, 10), "strip": it.get("strip") if it.get("strip") in ("rows", "cols") else "none",
                "square": bool(it.get("square"))}
    if kind == "text":
        s = _text(it.get("s"), 60)
        if not s:
            return None
        return {"id": iid, "kind": "text", **xy, "s": s, "size": _f(it.get("size"), 0.5, 20, 1.5),
                "layer": it.get("layer") if it.get("layer") in ("silk", "bsilk", "top", "bottom") else "silk"}
    if kind == "zone":
        pts = "board" if it.get("pts") == "board" else _pts(it.get("pts"), MAX_OUTLINE, -50, 500)
        if pts != "board" and len(pts) < 3:
            return None
        return {"id": iid, "kind": "zone", "layer": 0 if it.get("layer") == 0 else 1, "net": _s(it.get("net"), 24, NET_RE) or "GND", "pts": pts}
    if kind == "keepout":
        pts = _pts(it.get("pts"), MAX_OUTLINE, -50, 500)
        if len(pts) < 3:
            return None
        layer = it.get("layer")
        return {"id": iid, "kind": "keepout", "layer": layer if layer in (0, 1) else 2, "pts": pts}
    return None


def clean_board_extras(raw, part_ids):
    """The v2 board fields, cleaned. Returns a dict to merge into the board."""
    items, seen = [], set()
    for it in (raw.get("items") or [])[:MAX_ITEMS] if isinstance(raw.get("items"), list) else []:
        c = _item(it)
        if c and c["id"] not in seen:
            seen.add(c["id"])
            items.append(c)
    owners = set(part_ids) | seen

    def key_ok(k):
        m = KEY_RE.match(k) if isinstance(k, str) else None
        return bool(m and m.group(1) in owners)

    links = []
    for lk in (raw.get("links") or [])[:MAX_LINKS] if isinstance(raw.get("links"), list) else []:
        if isinstance(lk, dict) and key_ok(lk.get("a")) and key_ok(lk.get("b")) and lk["a"] != lk["b"]:
            links.append({"a": lk["a"], "b": lk["b"]})
    labels = {}
    for k, v in list((raw.get("labels") or {}).items())[:MAX_LABELS] if isinstance(raw.get("labels"), dict) else []:
        if key_ok(k) and isinstance(v, str) and NET_RE.match(v):
            labels[k] = v
    rules = {}
    limits = {"track": (0.1, 3), "power": (0.1, 5), "clear": (0.1, 2), "via": (0.4, 3), "viaDrill": (0.2, 2), "edge": (0.2, 5), "grid": (0.25, 2.54),
              "minDrill": (0.2, 2), "minTrack": (0.1, 1), "ring": (0.05, 1)}
    for k, (lo, hi) in limits.items():
        v = (raw.get("rules") or {}).get(k) if isinstance(raw.get("rules"), dict) else None
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            rules[k] = _f(v, lo, hi)
    out = {"shape": _shape(raw.get("shape")), "cut": [c for c in (_cut(c) for c in (raw.get("cut") or [])[:MAX_CUTS]) if c] if isinstance(raw.get("cut"), list) else [],
           "items": items, "links": links, "labels": labels}
    if rules:
        out["rules"] = rules
    for k in ("mask", "finish"):
        if isinstance(raw.get(k), str) and HEX_RE.match(raw[k]):
            out[k] = raw[k]
    return out


# --------------------------------------------------------------------------
# the library
# --------------------------------------------------------------------------

def user_parts(user, limit=MAX_PARTS_PER_USER):
    """What the lab page hands the browser at load."""
    return [{"type": p.type, "data": p.data} for p in ChalkPart.objects.filter(owner=user).only("type", "data")[:limit]]


def _err(msg, status=400):
    return JsonResponse({"ok": False, "error": msg}, status=status)


class PartsView(LoginRequiredMixin, View):
    """GET your parts · POST {type, data} to save one · DELETE ?type= to remove it."""

    def get(self, request):
        return JsonResponse({"ok": True, "parts": user_parts(request.user)})

    def post(self, request):
        if not throttle.hit("lab-part", request.user.id, PART_LIMIT, 60):
            return _err("Saving parts too often. Wait a moment.", 429)
        try:
            body = json.loads(request.body.decode("utf-8") or "{}")
        except (ValueError, UnicodeDecodeError):
            return _err("That wasn't valid JSON.")
        if not isinstance(body, dict):
            return _err("Nothing was sent.")
        try:
            data = clean_part(body.get("type"), body.get("data"))
        except Invalid as e:
            return _err(f"Couldn't save the part: {e}.")
        ptype = body["type"]
        part = ChalkPart.objects.filter(owner=request.user, type=ptype).first()
        if part is None and ChalkPart.objects.filter(owner=request.user).count() >= MAX_PARTS_PER_USER:
            return _err(f"You have {MAX_PARTS_PER_USER} parts already. Delete some you don't use.", 400)
        if part is None:
            part = ChalkPart(owner=request.user, type=ptype)
        part.name, part.category, part.data = data["name"], data["cat"], data
        part.save()
        return JsonResponse({"ok": True, "type": ptype, "data": data})

    def delete(self, request):
        ptype = request.GET.get("type") or ""
        if not PART_TYPE_RE.match(ptype):
            return _err("Which part?")
        n, _ = ChalkPart.objects.filter(owner=request.user, type=ptype).delete()
        return JsonResponse({"ok": True, "deleted": bool(n)})
