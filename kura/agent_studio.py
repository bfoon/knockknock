"""
kura/agent_studio.py — Foon edits the studio you have open.

On the Dashboard Studio (/kura/<code>/dash/<id>/) and the Data Studio
(/kura/<code>/studio/) the page hands Foon a SNAPSHOT of what is on screen:
every card or every flow step, the board's own columns, themes, sources.
The model answers with a short list of edit operations ("add a donut of
region", "ocean theme with an orange accent", "insert a trim step before
the dedupe", "new flow called Field fixes"). This module turns those
operations into the complete DESIRED END STATE — validated against the
real columns, operations, themes and sources — plus a readable change list.

Why a desired state and not a script of clicks: the studio's hook checks
that nothing changed since Foon looked (the snapshot's `rev`), swaps the
state in, and lets the studio's own autosave persist it. On the Dashboard
Studio that is one entry in the studio's Undo stack; the Data Studio keeps
the previous flow so Foon's Undo restores it exactly.

Flows are DRY-RUN here on the flow's real source (survey submissions or the
uploaded file) with the studio's own step handlers, so the chat shows how
many rows survive each step before anything is applied.
"""

from __future__ import annotations

import copy
import difflib
import re

from . import agent_engine as eng

MAX_TILES = 60
MAX_STEPS = 60
MAX_OPS = 40

# Same catalogue as KINDS in templates/kura/live_dashboard.html.
CARD_KINDS = {
    "kpi": ("Big number", 3, 2), "delta": ("Change", 3, 2), "progress": ("Progress", 3, 2),
    "gauge": ("Gauge", 3, 3), "bar": ("Bar", 6, 4), "hbar": ("Ranked bar", 6, 4),
    "donut": ("Donut", 4, 4), "pie": ("Pie", 4, 4), "leaderboard": ("Leaderboard", 4, 4),
    "timeseries": ("Over time", 8, 4), "line": ("Line", 6, 4), "area": ("Area", 6, 4),
    "histogram": ("Spread", 6, 4), "scatter": ("Scatter", 6, 4), "feed": ("Live feed", 4, 5),
    "map": ("Map", 6, 5), "table": ("Table", 8, 4), "text": ("Text", 12, 1),
}
FIELD_KEYS = ("x", "y", "column", "group_by", "date", "headline", "color_by")
FIELD_LIST_KEYS = ("columns",)
SPEC_AGGS = {"count", "sum", "mean", "median", "min", "max", "distinct", "filled", "missing"}
THEME_KNOBS = ("accent", "font", "card", "backdrop", "density", "palette", "radius", "logo_text")


class StudioError(Exception):
    pass


def _s(v, n=140):
    return str(v if v is not None else "")[:n]


def _int(v, lo, hi, default):
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def _scalar_ok(v):
    if v is None or isinstance(v, (bool, int, float)):
        return True
    if isinstance(v, str):
        return len(v) <= 2000
    if isinstance(v, list):
        return len(v) <= 100 and all(_scalar_ok(x) for x in v)
    if isinstance(v, dict):
        return len(v) <= 100 and all(isinstance(k, str) and _scalar_ok(x) for k, x in v.items())
    return False


# ─────────────────────────────────────────────────────────────────────
#  Snapshot parsing
# ─────────────────────────────────────────────────────────────────────

def parse_snapshot(raw, page):
    """Validate what the studio page sent. Returns a clean dict or None."""
    if not isinstance(raw, dict):
        return None
    kind = raw.get("kind")
    if page == "dashboard" and kind == "dashboard":
        board = raw.get("board") if isinstance(raw.get("board"), dict) else {}
        tiles = []
        for t in (raw.get("tiles") or [])[:MAX_TILES]:
            if not isinstance(t, dict) or t.get("kind") not in CARD_KINDS:
                continue
            tiles.append({
                "id": t.get("id"), "kind": t["kind"], "title": _s(t.get("title")), "subtitle": _s(t.get("subtitle"), 200),
                "x": _int(t.get("x"), 0, 11, 0), "y": _int(t.get("y"), 0, 500, 0),
                "w": _int(t.get("w"), 1, 12, 4), "h": _int(t.get("h"), 1, 16, 3),
                "spec": t["spec"] if isinstance(t.get("spec"), dict) and _scalar_ok(t["spec"]) else {},
                "filters": t["filters"] if isinstance(t.get("filters"), list) and _scalar_ok(t["filters"]) else [],
                "filter_match": "any" if t.get("filter_match") == "any" else "all",
            })
        fields = [{"name": _s(f.get("name"), 120), "label": _s(f.get("label") or f.get("name"), 120),
                   "kind": _s(f.get("kind"), 20), "unique": f.get("unique"), "meta": bool(f.get("meta"))}
                  for f in (raw.get("fields") or [])[:400] if isinstance(f, dict) and f.get("name")]
        return {
            "kind": "dashboard", "rev": _s(raw.get("rev"), 64),
            "board": {
                "id": board.get("id"), "name": _s(board.get("name")), "description": _s(board.get("description"), 500),
                "theme": _s(board.get("theme"), 30) or "studio",
                "theme_config": board.get("theme_config") if isinstance(board.get("theme_config"), dict) else {},
                "filters": board.get("filters") if isinstance(board.get("filters"), list) and _scalar_ok(board.get("filters")) else [],
                "filter_match": "any" if board.get("filter_match") == "any" else "all",
                "source": _s(board.get("source"), 20) or "submissions",
                "pipeline_id": board.get("pipeline_id"), "dataset_id": board.get("dataset_id"),
                "refresh_seconds": _int(board.get("refresh_seconds"), 0, 3600, 0),
                "is_live": bool(board.get("is_live")),
            },
            "tiles": tiles, "fields": fields,
            "pipelines": [{"id": p.get("id"), "name": _s(p.get("name"))} for p in (raw.get("pipelines") or [])[:50] if isinstance(p, dict)],
            "datasets": [{"id": d.get("id"), "name": _s(d.get("name"))} for d in (raw.get("datasets") or [])[:50] if isinstance(d, dict)],
        }
    if page == "studio" and kind == "flow":
        p = raw.get("pipeline") if isinstance(raw.get("pipeline"), dict) else {}
        steps = []
        for st in (p.get("steps") or [])[:MAX_STEPS]:
            if not isinstance(st, dict) or not st.get("operation"):
                continue
            cfg = st.get("config") if isinstance(st.get("config"), dict) else {}
            cfg = {k: v for k, v in cfg.items() if k != "_ui"}
            steps.append({"operation": _s(st["operation"], 40), "name": _s(st.get("name")),
                          "config": cfg if _scalar_ok(cfg) else {}, "enabled": st.get("enabled", True) is not False,
                          "stop_on_error": st.get("stop_on_error", True) is not False})
        defaults = raw.get("op_defaults") if isinstance(raw.get("op_defaults"), dict) else {}
        return {
            "kind": "flow", "rev": _s(raw.get("rev"), 64),
            "pipeline": {"id": p.get("id"), "name": _s(p.get("name")) or "Cleaning pipeline",
                         "is_active": p.get("is_active", True) is not False,
                         "source": "dataset" if p.get("source") == "dataset" else "submissions",
                         "source_dataset_id": p.get("source_dataset_id"), "steps": steps},
            "pipelines": [{"id": x.get("id"), "name": _s(x.get("name")), "step_count": x.get("step_count")}
                          for x in (raw.get("pipelines") or [])[:50] if isinstance(x, dict)],
            "columns": [_s(c, 120) for c in (raw.get("columns") or [])[:400] if isinstance(c, str)],
            "datasets": [{"id": d.get("id"), "name": _s(d.get("name")), "row_count": d.get("row_count")}
                         for d in (raw.get("datasets") or [])[:50] if isinstance(d, dict)],
            "op_defaults": {k: v for k, v in list(defaults.items())[:80] if isinstance(v, dict) and _scalar_ok(v)},
        }
    return None


# ─────────────────────────────────────────────────────────────────────
#  Prompt context
# ─────────────────────────────────────────────────────────────────────

def display_order(tiles):
    return sorted(tiles, key=lambda t: (t["y"], t["x"]))


def _spec_text(spec):
    bits = []
    for k, v in (spec or {}).items():
        if isinstance(v, (dict, list)) and len(str(v)) > 60:
            v = "…"
        bits.append(f"{k}={v}")
    return ", ".join(bits)[:220]


def dashboard_context(snap):
    b = snap["board"]
    lines = [f"STUDIO: Dashboard Studio — board \"{b['name']}\" (theme {b['theme']}"
             + (f", accent {b['theme_config'].get('accent')}" if b["theme_config"].get("accent") else "")
             + f", source {b['source']}, {len(snap['tiles'])} cards). Grid: 12 columns; y grows downward."]
    if snap["tiles"]:
        lines.append("CARDS (refer to a card by its id, #number or title):")
        for i, t in enumerate(display_order(snap["tiles"]), 1):
            lines.append(f"  #{i} id={t['id']} {t['kind']} \"{t['title'] or CARD_KINDS[t['kind']][0]}\" "
                         f"at x{t['x']} y{t['y']} w{t['w']} h{t['h']} — {_spec_text(t['spec'])}"
                         + (f" — filters {len(t['filters'])}" if t["filters"] else ""))
    else:
        lines.append("CARDS: none yet — the board is empty.")
    if b["filters"]:
        lines.append(f"BOARD FILTERS ({b['filter_match']}): {b['filters']}"[:400])
    if snap["fields"]:
        lines.append("BOARD COLUMNS (card specs must use these names):")
        for f in snap["fields"][:120]:
            lines.append(f"  - {f['name']} [{f['kind']}{', meta' if f['meta'] else ''}] \"{f['label']}\""
                         + (f" ({f['unique']} different)" if f.get("unique") is not None else ""))
    if snap["pipelines"]:
        lines.append("CLEANING PIPELINES (possible sources): " + "; ".join(f"{p['id']}: {p['name']}" for p in snap["pipelines"]))
    if snap["datasets"]:
        lines.append("UPLOADED FILES (possible sources): " + "; ".join(f"{d['id']}: {d['name']}" for d in snap["datasets"]))
    return "\n".join(lines)


def flow_context(snap, op_labels):
    p = snap["pipeline"]
    src = "survey submissions"
    if p["source"] == "dataset":
        ds = next((d for d in snap["datasets"] if d["id"] == p["source_dataset_id"]), None)
        src = f"uploaded file \"{ds['name'] if ds else p['source_dataset_id']}\""
    lines = [f"STUDIO: Data Studio — flow \"{p['name']}\" (id {p['id'] or 'unsaved'}, "
             f"{'active' if p['is_active'] else 'inactive'}, source {src}, {len(p['steps'])} steps)."]
    if p["steps"]:
        lines.append("STEPS (refer to a step by #number or name):")
        for i, st in enumerate(p["steps"], 1):
            lines.append(f"  #{i} {st['operation']} \"{st['name']}\"{'' if st['enabled'] else ' (off)'} — {_spec_text(st['config'])}")
    else:
        lines.append("STEPS: none yet.")
    others = [x for x in snap["pipelines"] if x["id"] != p["id"]]
    if others:
        lines.append("OTHER FLOWS: " + "; ".join(f"{x['id']}: {x['name']} ({x.get('step_count') or 0} steps)" for x in others))
    if snap["columns"]:
        lines.append("SOURCE COLUMNS: " + ", ".join(snap["columns"][:150]))
    if snap["datasets"]:
        lines.append("UPLOADED FILES: " + "; ".join(f"{d['id']}: {d['name']} ({d.get('row_count')} rows)" for d in snap["datasets"]))
    if snap["op_defaults"]:
        lines.append("ALL OPERATIONS and their config keys (studio defaults):")
        for op, cfg in snap["op_defaults"].items():
            lines.append(f"  {op} ({op_labels.get(op, op)}): {_spec_text(cfg) or '{}'}")
    return "\n".join(lines)


STUDIO_SYSTEM = {
    "dashboard": """
STUDIO MODE — the user has the Dashboard Studio open (see STUDIO in CONTEXT). When they ask to change the board, use this tool; Foon applies it live and the studio's Undo can reverse it:
{"tool":"studio_dashboard","note":"one-line summary","ops":[ ... ]}
  {"op":"add","kind":"kpi|delta|progress|gauge|bar|hbar|donut|pie|leaderboard|timeseries|line|area|histogram|scatter|feed|map|table|text","title":"...","subtitle":"","spec":{...},"filters":[],"w":6,"h":4,"x":0,"y":0}   (x/y optional: a free spot is found)
  {"op":"update","card":"<id | #n | title>","title":"...","subtitle":"...","kind":"...","spec":{only the keys to change; null deletes a key},"filters":[...],"w":..,"h":..,"x":..,"y":..}
  {"op":"remove","card":"<id | #n | title>"}      {"op":"clear"}  (every card)
  {"op":"theme","theme":"studio|ops|midnight|ocean|forest|sunset|graphite|light|paper|unblue","accent":"#rrggbb","font":"archivo|jakarta|plex|grotesk|fraunces","card":"glass|solid|outline|raised","backdrop":"glow|mesh|grid|plain","density":"cozy|compact|roomy","palette":"theme|vivid|calm|mono","radius":0-28,"logo_text":"..."}
  {"op":"board","name":"...","description":"...","refresh_seconds":0|10|20|30|60|300,"is_live":true}
  {"op":"filters","filters":[filters],"match":"all|any"}   (board-wide; [] clears them)
  {"op":"source","source":"submissions|pipeline|dataset","id":<pipeline or file id>}
  {"op":"tidy"} (close the gaps)    {"op":"present"} (full-screen presentation mode)
Card specs: kpi/gauge {"agg","column","target","decimals","prefix","suffix"} · delta {"agg","window_minutes"} · progress {"agg","target"} · bar/hbar/donut/pie {"x","y","agg","group_by","sort":"value|label","limit"} · leaderboard {"group_by","column","agg","limit"} · timeseries/line/area {"date","freq":"H|D|W|M","agg","y","group_by","cumulative"} · histogram {"x","bins"} · scatter {"x","y"} · table {"columns":[...],"limit"} · feed {"headline","columns","limit"} · map {"color_by","point_size"} · text {"body","style":"heading|note"}
Design like a top dashboard designer: headline numbers in the top row, the trend wide beneath, comparisons in pairs, map/table/feed at the bottom; rows that fill all 12 columns; short, specific titles; a theme and accent that suit the audience. For "redesign", "remix" or "make it beautiful" you may clear and rebuild — say so in "say".""",
    "flow": """
STUDIO MODE — the user has the Data Studio open (see STUDIO in CONTEXT). When they ask to build or change a cleaning flow, use this tool; Foon dry-runs it on the real data, applies it live and can undo it:
{"tool":"studio_flow","note":"one-line summary","ops":[ ... ]}
  {"op":"new_flow","name":"...","steps":[steps],"source":"submissions|dataset","dataset_id":<id>}   (a brand-new flow; the current one is kept)
  {"op":"add","step":{"operation":"...","name":"plain-English name","config":{...}},"at":<1-based position> | "after":"<#n | name>"}   (default: at the end)
  {"op":"update","step":"<#n | name>","name":"...","config":{only keys to change; null deletes},"enabled":true|false}
  {"op":"remove","step":"<#n | name>"}     {"op":"move","step":"<#n | name>","to":<1-based position>}
  {"op":"replace","steps":[steps]}  (rewrite the whole flow)     {"op":"rename","name":"..."}     {"op":"active","value":true|false}
  {"op":"source","source":"submissions|dataset","dataset_id":<id>}     {"op":"switch","flow":"<id | name>"}  (open another flow; use alone)
  {"op":"layout"} (tidy the canvas)     {"op":"run"} (run the flow after applying)
Use operations and config keys from STUDIO → ALL OPERATIONS; column names from SOURCE COLUMNS (or ones an earlier step creates). Think like a senior data engineer: tidy text first (trim, case, accents), then recode/standardise, cast types, deduplicate, fill missing, handle outliers, derive new columns, and machine-learning steps last. Name every step in plain words ("Fix spelling of districts"). Prefer flagging over deleting when unsure.""",
}


# ─────────────────────────────────────────────────────────────────────
#  Dashboard: ops → desired state
# ─────────────────────────────────────────────────────────────────────

def _overlap(a, b):
    return a["x"] < b["x"] + b["w"] and b["x"] < a["x"] + a["w"] and a["y"] < b["y"] + b["h"] and b["y"] < a["y"] + a["h"]


def _free_spot(tiles, w, h):
    w = min(12, w)
    bottom = max([t["y"] + t["h"] for t in tiles] or [0])
    for y in range(0, bottom + 1):
        for x in range(0, 13 - w):
            probe = {"x": x, "y": y, "w": w, "h": h}
            if not any(_overlap(probe, t) for t in tiles):
                return x, y
    return 0, bottom


def _push_down(tiles, active):
    """Studio's resolve(): the active card stays, overlapped cards cascade down."""
    others = sorted([t for t in tiles if t is not active], key=lambda t: (t["y"], t["x"]))
    placed = [active] if active else []
    for t in others:
        hit = next((p for p in placed if _overlap(p, t)), None)
        while hit:
            t["y"] = hit["y"] + hit["h"]
            hit = next((p for p in placed if _overlap(p, t)), None)
        placed.append(t)


def _compact(tiles):
    """Studio's Tidy: float every card up as far as it will go."""
    placed = []
    for t in sorted(tiles, key=lambda t: (t["y"], t["x"])):
        while t["y"] > 0 and not any(_overlap(p, {**t, "y": t["y"] - 1}) for p in placed):
            t["y"] -= 1
        placed.append(t)


ORDINALS = {"first": 0, "second": 1, "third": 2, "fourth": 3, "fifth": 4, "sixth": 5, "last": -1}
CHARTISH = {"bar", "hbar", "donut", "pie", "line", "area", "timeseries", "histogram", "scatter"}


def _find_card(tiles, ref):
    if ref is None:
        return None
    order = display_order(tiles)
    s = str(ref).strip()
    om = re.fullmatch(r"(?:the )?(first|second|third|fourth|fifth|sixth|last) (chart|graph|card|tile|number)s?", s.lower())
    if om:
        pool = [t for t in order if t["kind"] in CHARTISH] if om.group(2) in ("chart", "graph") else \
               [t for t in order if t["kind"] in ("kpi", "delta", "progress", "gauge")] if om.group(2) == "number" else order
        i = ORDINALS[om.group(1)]
        return pool[i] if pool and (i == -1 or i < len(pool)) else None
    for t in tiles:
        if str(t["id"]) == s:
            return t
    m = re.fullmatch(r"#?(\d+)", s)
    if m and s.startswith("#") and 1 <= int(m.group(1)) <= len(order):
        return order[int(m.group(1)) - 1]
    low = s.lower().strip("“”\"'")
    for t in order:
        if (t["title"] or "").lower() == low:
            return t
    for t in order:
        if low and low in (t["title"] or "").lower():
            return t
    titles = {(t["title"] or CARD_KINDS[t["kind"]][0]).lower(): t for t in order}
    close = difflib.get_close_matches(low, list(titles), n=1, cutoff=0.72)
    if close:
        return titles[close[0]]
    kinds = [t for t in order if t["kind"] == low or CARD_KINDS[t["kind"]][0].lower() == low]
    return kinds[0] if len(kinds) == 1 else None


def _field_names(snap):
    return {f["name"] for f in snap["fields"]}


def _resolve_field(snap, name):
    if name in (None, ""):
        return None
    names = _field_names(snap)
    if name in names:
        return name
    low = str(name).lower()
    for f in snap["fields"]:
        if f["label"].lower() == low or f["name"].lower() == low:
            return f["name"]
    close = difflib.get_close_matches(low, [f["name"].lower() for f in snap["fields"]] +
                                      [f["label"].lower() for f in snap["fields"]], n=1, cutoff=0.8)
    if close:
        for f in snap["fields"]:
            if close[0] in (f["name"].lower(), f["label"].lower()):
                return f["name"]
    return False


def _clean_spec(snap, spec, warnings, base=None):
    out = dict(base or {})
    for k, v in (spec or {}).items():
        if not isinstance(k, str) or len(k) > 40:
            continue
        if v is None:
            out.pop(k, None)
            continue
        if k in FIELD_KEYS:
            r = _resolve_field(snap, v)
            if r is False:
                warnings.append(f"There's no column “{v}” on this board — left that setting out.")
                continue
            out[k] = r
        elif k in FIELD_LIST_KEYS and isinstance(v, list):
            keep = []
            for c in v[:40]:
                r = _resolve_field(snap, c)
                if r:
                    keep.append(r)
            out[k] = keep
        elif k == "agg":
            out[k] = v if v in SPEC_AGGS else "count"
        elif _scalar_ok(v):
            out[k] = v
    return out


def _clean_board_filters(snap, filters, warnings):
    out = []
    for f in (filters or [])[:20]:
        if not isinstance(f, dict):
            continue
        r = _resolve_field(snap, f.get("field"))
        if not r:
            warnings.append(f"Filter on unknown column “{f.get('field')}” left out.")
            continue
        op = f.get("operator") or f.get("op") or "eq"
        item = {"field": r, "operator": op if op in eng.FILTER_OPS else "eq", "value": f.get("value")}
        if op == "between":
            item["min"], item["max"] = f.get("min"), f.get("max")
        if _scalar_ok(item):
            out.append(item)
    return out


def _card_name(t):
    return t["title"] or CARD_KINDS[t["kind"]][0]


def plan_dashboard(snap, ops, note=""):
    from .models_dashboard import THEME_PRESETS, clean_theme_config

    tiles = copy.deepcopy(snap["tiles"])
    board = copy.deepcopy(snap["board"])
    changes, warnings = [], []
    flags = {"tidy": False, "present": False, "source_changed": False}
    touched, new_n = set(), 0
    removed_count = 0
    cleared = False

    for raw in (ops or [])[:MAX_OPS]:
        if not isinstance(raw, dict):
            continue
        op = raw.get("op")
        if op == "add":
            kind = raw.get("kind") if raw.get("kind") in CARD_KINDS else None
            if not kind:
                warnings.append(f"Unknown card type “{raw.get('kind')}” skipped.")
                continue
            name, dw, dh = CARD_KINDS[kind]
            new_n += 1
            t = {"id": f"new-{new_n}", "kind": kind, "title": _s(raw.get("title")), "subtitle": _s(raw.get("subtitle"), 200),
                 "w": _int(raw.get("w"), 1, 12, dw), "h": _int(raw.get("h"), 1, 16, dh),
                 "spec": _clean_spec(snap, raw.get("spec"), warnings),
                 "filters": _clean_board_filters(snap, raw.get("filters"), warnings), "filter_match": "all"}
            if raw.get("x") is not None and raw.get("y") is not None:
                t["x"] = _int(raw.get("x"), 0, 12 - t["w"], 0)
                t["y"] = _int(raw.get("y"), 0, 500, 0)
                tiles.append(t)
                _push_down(tiles, t)
            else:
                t["x"], t["y"] = _free_spot(tiles, t["w"], t["h"])
                tiles.append(t)
            touched.add(t["id"])
            changes.append({"type": "add", "id": t["id"], "text": f"Added {name.lower()} “{_card_name(t)}”"})
        elif op in ("update", "move", "resize"):
            t = _find_card(tiles, raw.get("card") or raw.get("id") or raw.get("title"))
            if not t:
                warnings.append(f"Couldn't find the card “{raw.get('card') or raw.get('id')}”.")
                continue
            what = []
            if raw.get("kind") in CARD_KINDS and raw["kind"] != t["kind"]:
                t["kind"] = raw["kind"]
                what.append(f"now a {CARD_KINDS[t['kind']][0].lower()}")
            for key in ("title", "subtitle"):
                if key in raw and raw[key] is not None:
                    t[key] = _s(raw[key], 140 if key == "title" else 200)
                    what.append(f"{key} “{t[key]}”" if t[key] else f"{key} cleared")
            if isinstance(raw.get("spec"), dict):
                before = dict(t["spec"])
                t["spec"] = _clean_spec(snap, raw["spec"], warnings, base=t["spec"])
                if t["spec"] != before:
                    what.append("settings")
            if isinstance(raw.get("filters"), list):
                t["filters"] = _clean_board_filters(snap, raw["filters"], warnings)
                what.append(f"{len(t['filters'])} filter(s)" if t["filters"] else "filters cleared")
            moved = False
            for key, lo, hi in (("w", 1, 12), ("h", 1, 16), ("x", 0, 11), ("y", 0, 500)):
                if raw.get(key) is not None:
                    nv = _int(raw[key], lo, hi, t[key])
                    if nv != t[key]:
                        t[key] = nv
                        moved = True
            if moved:
                t["x"] = min(t["x"], 12 - t["w"])
                _push_down(tiles, t)
                what.append(f"now {t['w']}×{t['h']} at column {t['x'] + 1}")
            if what:
                touched.add(t["id"])
                changes.append({"type": "update", "id": t["id"], "text": f"“{_card_name(t)}”: " + ", ".join(what)})
        elif op == "remove":
            t = _find_card(tiles, raw.get("card") or raw.get("id") or raw.get("title"))
            if not t:
                warnings.append(f"Couldn't find the card “{raw.get('card') or raw.get('id')}” to remove.")
                continue
            tiles.remove(t)
            removed_count += 1
            changes.append({"type": "remove", "id": t["id"], "text": f"Removed “{_card_name(t)}”"})
        elif op == "clear":
            if tiles:
                removed_count += len(tiles)
                changes.append({"type": "remove", "id": None, "text": f"Cleared all {len(tiles)} cards"})
                tiles = []
                cleared = True
        elif op == "theme":
            what = []
            if raw.get("theme") in THEME_PRESETS and raw["theme"] != board["theme"]:
                board["theme"] = raw["theme"]
                what.append(f"{THEME_PRESETS[raw['theme']]['label']} theme")
            patch = {k: raw[k] for k in THEME_KNOBS if k in raw and raw[k] is not None}
            if isinstance(raw.get("accent"), str) and not re.fullmatch(r"#[0-9a-fA-F]{6}", raw["accent"]):
                warnings.append(f"“{raw['accent']}” isn't a colour like #ff8a1f — accent unchanged.")
                patch.pop("accent", None)
            if patch:
                merged = clean_theme_config({**board["theme_config"], **patch})
                diff = [k for k in patch if merged.get(k) != board["theme_config"].get(k) and k in merged]
                board["theme_config"] = merged
                nice = {"accent": "accent {}", "font": "{} font", "card": "{} cards", "backdrop": "{} backdrop",
                        "density": "{} spacing", "palette": "{} palette", "radius": "corner radius {}", "logo_text": "label “{}”"}
                what += [nice.get(k, k + " {}").format(merged[k]) for k in diff]
            if what:
                if changes and changes[-1]["type"] == "theme":      # one line for the whole restyle
                    changes[-1]["text"] += ", " + ", ".join(what)
                else:
                    changes.append({"type": "theme", "id": None, "text": "Look: " + ", ".join(what)})
        elif op == "board":
            what = []
            if raw.get("name"):
                board["name"] = _s(raw["name"])
                what.append(f"renamed “{board['name']}”")
            if raw.get("description") is not None:
                board["description"] = _s(raw["description"], 500)
                what.append("description")
            if raw.get("refresh_seconds") is not None:
                board["refresh_seconds"] = _int(raw["refresh_seconds"], 0, 3600, 0)
                what.append(f"refresh every {board['refresh_seconds']} s" if board["refresh_seconds"] else "auto-refresh off")
            if raw.get("is_live") is not None:
                board["is_live"] = bool(raw["is_live"])
                what.append("live updates on" if board["is_live"] else "live updates off")
            if what:
                changes.append({"type": "board", "id": None, "text": "Board: " + ", ".join(what)})
        elif op == "filters":
            board["filters"] = _clean_board_filters(snap, raw.get("filters"), warnings)
            board["filter_match"] = "any" if raw.get("match") == "any" else "all"
            changes.append({"type": "board", "id": None,
                            "text": f"Board filters: {eng.describe_filters(_FakeCtx(snap), board['filters']) or 'cleared'}"})
        elif op == "source":
            src = raw.get("source")
            ident = raw.get("id")
            if src == "submissions":
                board.update({"source": "submissions", "pipeline_id": None, "dataset_id": None})
                label = "live survey submissions"
            elif src == "pipeline" and any(str(p["id"]) == str(ident) for p in snap["pipelines"]):
                p = next(p for p in snap["pipelines"] if str(p["id"]) == str(ident))
                board.update({"source": "pipeline", "pipeline_id": p["id"], "dataset_id": None})
                label = f"submissions cleaned by “{p['name']}”"
            elif src == "dataset" and any(str(d["id"]) == str(ident) for d in snap["datasets"]):
                d = next(d for d in snap["datasets"] if str(d["id"]) == str(ident))
                board.update({"source": "dataset", "dataset_id": d["id"], "pipeline_id": None})
                label = f"the uploaded file “{d['name']}”"
            else:
                warnings.append("That data source isn't available on this board.")
                continue
            flags["source_changed"] = True
            changes.append({"type": "board", "id": None, "text": f"Cards now read {label}"})
        elif op == "tidy":
            flags["tidy"] = True
            changes.append({"type": "layout", "id": None, "text": "Tidied the layout"})
        elif op == "present":
            flags["present"] = True
            changes.append({"type": "view", "id": None, "text": "Presentation mode"})
        else:
            warnings.append(f"I can't do “{op}” in the Dashboard Studio yet.")

    if cleared and tiles and all(str(t["id"]).startswith("new-") for t in tiles):
        # A rebuild: lay the new cards out row by row so every row spans all
        # 12 columns (same packer as Foon's chat dashboards).
        laid = eng.layout_tiles([{**t, "w": t["w"], "h": t["h"]} for t in tiles])
        for t, l in zip(tiles, laid):
            t.update({"x": l["x"], "y": l["y"], "w": l["w"], "h": l["h"]})
    if flags["tidy"]:
        _compact(tiles)
    big = cleared or removed_count >= 3 or (snap["tiles"] and removed_count > len(snap["tiles"]) / 2)
    return {
        "type": "studio", "studio": "dashboard", "title": note or "Dashboard edits",
        "base_rev": snap["rev"],
        "before": [{k: t[k] for k in ("id", "kind", "title", "x", "y", "w", "h")} for t in snap["tiles"]],
        "after": {"board": board, "tiles": tiles},
        "touched": sorted(str(x) for x in touched), "flags": flags,
        "changes": changes, "warnings": warnings[:10], "needs_confirm": bool(big),
        "spec": None,
    }


class _FakeCtx:
    """Just enough of AgentContext for describe_filters() on board columns."""

    def __init__(self, snap):
        self._labels = {f["name"]: f["label"] for f in snap["fields"]}

    def field(self, name):
        return None

    def label(self, name):
        return self._labels.get(name, name)


# ─────────────────────────────────────────────────────────────────────
#  Flow: ops → desired state + dry run
# ─────────────────────────────────────────────────────────────────────

CREATES = ("new_field", "new_name", "target_field", "output", "new_column", "prefix")


def _find_step(steps, ref):
    if ref is None:
        return None
    s = str(ref).strip()
    m = re.fullmatch(r"#?(\d+)", s)
    if m and 1 <= int(m.group(1)) <= len(steps):
        return int(m.group(1)) - 1
    low = s.lower().strip("“”\"'")
    for i, st in enumerate(steps):
        if st["name"].lower() == low:
            return i
    for i, st in enumerate(steps):
        if low and low in st["name"].lower():
            return i
    ops = [i for i, st in enumerate(steps) if st["operation"] == low]
    if len(ops) == 1:
        return ops[0]
    close = difflib.get_close_matches(low, [st["name"].lower() for st in steps], n=1, cutoff=0.72)
    if close:
        return next(i for i, st in enumerate(steps) if st["name"].lower() == close[0])
    return None


def _clean_step(raw, valid_ops, warnings):
    if not isinstance(raw, dict):
        return None
    op = raw.get("operation")
    if op not in valid_ops:
        warnings.append(f"“{op}” isn't a Data Studio operation — skipped.")
        return None
    cfg = raw.get("config") if isinstance(raw.get("config"), dict) else {}
    cfg = {k: v for k, v in cfg.items() if k != "_ui" and isinstance(k, str)}
    if not _scalar_ok(cfg):
        cfg = {}
    return {"operation": op, "name": _s(raw.get("name") or valid_ops[op]), "config": cfg,
            "enabled": raw.get("enabled", True) is not False, "stop_on_error": raw.get("stop_on_error", True) is not False,
            "origin": None}


def _column_refs(cfg):
    refs = []
    for k, v in cfg.items():
        if k in ("field", "target", "group_by", "date_field", "column") and isinstance(v, str) and v:
            refs.append(v)
        elif k in ("fields", "columns", "predictors") and isinstance(v, list):
            refs += [x for x in v if isinstance(x, str)]
        elif k == "conditions" and isinstance(v, list):
            refs += [c.get("field") for c in v if isinstance(c, dict) and isinstance(c.get("field"), str)]
    return refs


def _check_columns(steps, columns, warnings):
    known = set(columns)
    for i, st in enumerate(steps, 1):
        for c in _column_refs(st["config"]):
            if c not in known and not c.startswith("_"):
                warnings.append(f"Step {i} “{st['name']}” uses “{c}”, which isn't a column at that point.")
        for k in CREATES:
            v = st["config"].get(k)
            if isinstance(v, str) and v:
                known.add(v)
        if st["operation"] == "rename_column" and st["config"].get("new_name"):
            known.add(st["config"]["new_name"])


def _source_frame(ctx, pipeline):
    """Exactly the frame PipelineExecutor.execute() starts from, so a dry run
    predicts a real run row for row."""
    from .models import UploadedDataset
    from .pipeline_engine import dataset_dataframe, survey_dataframe
    if pipeline["source"] == "dataset" and pipeline.get("source_dataset_id"):
        ds = UploadedDataset.objects.filter(survey=ctx.survey, id=pipeline["source_dataset_id"]).first()
        if ds is None:
            raise StudioError("That uploaded file no longer exists.")
        return dataset_dataframe(ds)
    df, _subs = survey_dataframe(ctx.survey)
    return df


def dry_run(ctx, pipeline):
    """Run the flow's enabled steps on its real source, in memory."""
    df = _source_frame(ctx, pipeline)
    source_rows = int(len(df))
    source_columns = [str(c) for c in df.columns]
    ex = eng._executor()
    report = []
    for i, st in enumerate(pipeline["steps"]):
        if not st.get("enabled", True):
            report.append({"name": st["name"], "operation": st["operation"], "status": "off",
                           "rows_after": int(len(df)), "cols_after": int(len(df.columns)), "changes": 0})
            continue
        step = eng._Step(i, st["operation"], st["name"], st["config"])
        before = len(df)
        try:
            df = ex._apply_step(df.copy(), step)
            changed = sum(n for (sid, _t), n in ex.counts.items() if sid == step.id)
            report.append({"name": st["name"], "operation": st["operation"], "status": "ok",
                           "rows_after": int(len(df)), "cols_after": int(len(df.columns)),
                           "removed": int(before - len(df)), "changes": int(changed)})
        except Exception as exc:
            report.append({"name": st["name"], "operation": st["operation"], "status": "failed",
                           "error": eng._clip_text(str(exc), 180), "rows_after": int(len(df)),
                           "cols_after": int(len(df.columns)), "changes": 0})
    cols, rows = eng.frame_records(df[[c for c in eng.public_columns(df) if c != "_uuid"]].head(8))
    return {"source_rows": source_rows, "source_columns": source_columns, "steps": report, "result_rows": int(len(df)),
            "result_cols": len(eng.public_columns(df)), "columns": cols, "rows": rows}


def plan_flow(ctx, snap, ops, note=""):
    valid_ops = eng.valid_operations()
    p = copy.deepcopy(snap["pipeline"])
    steps = [{**st, "origin": i} for i, st in enumerate(p["steps"])]
    changes, warnings = [], []
    flags = {"new_flow": False, "run": False, "layout": False, "switch": None}
    removed = 0
    replaced = False

    ops = [o for o in (ops or [])[:MAX_OPS] if isinstance(o, dict)]
    switch = next((o for o in ops if o.get("op") == "switch"), None)
    if switch:
        ref = str(switch.get("flow") or switch.get("id") or "").strip().lower()
        target = next((x for x in snap["pipelines"] if str(x["id"]) == ref or x["name"].lower() == ref), None)
        if not target:
            close = difflib.get_close_matches(ref, [x["name"].lower() for x in snap["pipelines"]], n=1, cutoff=0.7)
            target = next((x for x in snap["pipelines"] if close and x["name"].lower() == close[0]), None)
        if not target:
            raise StudioError(f"There's no flow called “{switch.get('flow')}”.")
        flags["switch"] = target["id"]
        return {"type": "studio", "studio": "flow", "title": note or f"Open “{target['name']}”", "base_rev": snap["rev"],
                "after": None, "flags": flags, "changes": [{"type": "view", "text": f"Opened the flow “{target['name']}”"}],
                "warnings": ([] if len(ops) == 1 else ["I opened that flow first — ask again for changes to it."]),
                "needs_confirm": False, "preview": None, "before_steps": [], "spec": None}

    for raw in ops:
        op = raw.get("op")
        if op == "new_flow":
            flags["new_flow"] = True
            p["id"] = None
            p["name"] = _s(raw.get("name")) or "Foon's cleaning flow"
            p["is_active"] = False
            if raw.get("source") == "dataset" and any(str(d["id"]) == str(raw.get("dataset_id")) for d in snap["datasets"]):
                p["source"], p["source_dataset_id"] = "dataset", int(raw["dataset_id"])
            elif raw.get("source") == "submissions":
                p["source"], p["source_dataset_id"] = "submissions", None
            steps = [s for s in (_clean_step(x, valid_ops, warnings) for x in (raw.get("steps") or [])[:MAX_STEPS]) if s]
            changes.append({"type": "add", "text": f"New flow “{p['name']}” with {len(steps)} step(s)"})
        elif op == "add":
            st = _clean_step(raw.get("step") or raw, valid_ops, warnings)
            if not st:
                continue
            idx = len(steps)
            if raw.get("after") is not None:
                j = _find_step(steps, raw["after"])
                if j is None:
                    warnings.append(f"Couldn't find step “{raw['after']}” — added at the end.")
                else:
                    idx = j + 1
            elif raw.get("at") is not None:
                idx = _int(raw["at"], 1, len(steps) + 1, len(steps) + 1) - 1
            steps.insert(idx, st)
            changes.append({"type": "add", "text": f"Step {idx + 1}: {st['name']}"})
        elif op == "update":
            j = _find_step(steps, raw.get("step"))
            if j is None:
                warnings.append(f"Couldn't find step “{raw.get('step')}”.")
                continue
            st = steps[j]
            what = []
            if raw.get("name"):
                st["name"] = _s(raw["name"])
                what.append(f"renamed “{st['name']}”")
            if isinstance(raw.get("config"), dict):
                cfg = dict(st["config"])
                for k, v in raw["config"].items():
                    if k == "_ui" or not isinstance(k, str):
                        continue
                    if v is None:
                        cfg.pop(k, None)
                    elif _scalar_ok(v):
                        cfg[k] = v
                if cfg != st["config"]:
                    st["config"] = cfg
                    what.append("settings")
            if raw.get("enabled") is not None and bool(raw["enabled"]) != st["enabled"]:
                st["enabled"] = bool(raw["enabled"])
                what.append("switched on" if st["enabled"] else "switched off")
            if what:
                changes.append({"type": "update", "text": f"Step {j + 1} “{st['name']}”: " + ", ".join(what)})
        elif op == "remove":
            j = _find_step(steps, raw.get("step"))
            if j is None:
                warnings.append(f"Couldn't find step “{raw.get('step')}” to remove.")
                continue
            gone = steps.pop(j)
            removed += 1
            changes.append({"type": "remove", "text": f"Removed step {j + 1} “{gone['name']}”"})
        elif op == "move":
            j = _find_step(steps, raw.get("step"))
            if j is None:
                warnings.append(f"Couldn't find step “{raw.get('step')}” to move.")
                continue
            to = _int(raw.get("to"), 1, len(steps), j + 1) - 1
            st = steps.pop(j)
            steps.insert(to, st)
            changes.append({"type": "layout", "text": f"Moved “{st['name']}” to position {to + 1}"})
        elif op == "replace":
            new = [s for s in (_clean_step(x, valid_ops, warnings) for x in (raw.get("steps") or [])[:MAX_STEPS]) if s]
            removed += len(steps)
            replaced = True
            steps = new
            changes.append({"type": "update", "text": f"Rewrote the flow: {len(new)} step(s)"})
        elif op == "rename":
            if raw.get("name"):
                p["name"] = _s(raw["name"])
                changes.append({"type": "board", "text": f"Flow renamed “{p['name']}”"})
        elif op == "active":
            p["is_active"] = bool(raw.get("value", True))
            changes.append({"type": "board", "text": "Flow active — new data is cleaned automatically" if p["is_active"]
                            else "Flow inactive"})
        elif op == "source":
            if raw.get("source") == "dataset":
                d = next((d for d in snap["datasets"] if str(d["id"]) == str(raw.get("dataset_id"))), None)
                if not d:
                    warnings.append("That uploaded file isn't available.")
                    continue
                p["source"], p["source_dataset_id"] = "dataset", d["id"]
                changes.append({"type": "board", "text": f"Source: uploaded file “{d['name']}”"})
            else:
                p["source"], p["source_dataset_id"] = "submissions", None
                changes.append({"type": "board", "text": "Source: survey submissions"})
        elif op == "layout":
            flags["layout"] = True
            changes.append({"type": "layout", "text": "Tidied the canvas"})
        elif op == "run":
            flags["run"] = True
            changes.append({"type": "view", "text": "Run the flow after applying"})
        else:
            warnings.append(f"I can't do “{op}” in the Data Studio yet.")

    p["steps"] = steps
    preview = None
    try:
        preview = dry_run(ctx, p)
    except StudioError as exc:
        warnings.append(str(exc))
    except Exception as exc:  # pragma: no cover - defensive
        warnings.append(f"Couldn't dry-run the flow: {eng._clip_text(str(exc), 120)}")
    # Check column references against the flow's REAL source (it includes
    # calculated columns the studio's picker doesn't list).
    same_source = (p["source"] == snap["pipeline"]["source"]
                   and p.get("source_dataset_id") == snap["pipeline"].get("source_dataset_id"))
    columns = list(preview["source_columns"]) if preview else []
    if same_source:
        columns += snap["columns"]
    _check_columns(steps, columns or list(ctx.frame.columns), warnings)
    big = replaced and snap["pipeline"]["steps"] or removed >= 3
    old_steps = snap["pipeline"]["steps"]
    touched = []
    for i, st in enumerate(steps):
        o = st.get("origin")
        if o is None or flags["new_flow"]:
            touched.append(i)
        else:
            was = old_steps[o]
            if (st["name"], st["config"], st["enabled"]) != (was["name"], was["config"], was["enabled"]) or o != i:
                touched.append(i)
    return {
        "type": "studio", "studio": "flow", "title": note or "Flow edits", "base_rev": snap["rev"],
        "after": {"pipeline": p}, "flags": flags, "changes": changes, "warnings": warnings[:12], "touched": touched,
        "needs_confirm": bool(big), "preview": preview,
        "before_steps": [{"operation": s["operation"], "name": s["name"]} for s in snap["pipeline"]["steps"]],
        "spec": None,
    }


# ─────────────────────────────────────────────────────────────────────
#  Built-in skills for the studios (no AI needed)
# ─────────────────────────────────────────────────────────────────────

THEME_WORDS = {"studio": "studio", "ops": "ops", "ops room": "ops", "midnight": "midnight", "ocean": "ocean",
               "forest": "forest", "sunset": "sunset", "graphite": "graphite", "light": "light", "paper": "paper",
               "un blue": "unblue", "unblue": "unblue", "dark": "studio"}
COLOURS = {"orange": "#ff8a1f", "pink": "#ff3f98", "blue": "#3b82f6", "green": "#22c55e", "red": "#ef4444",
           "purple": "#8b5cf6", "violet": "#8b5cf6", "teal": "#14b8a6", "yellow": "#f59e0b", "gold": "#eab308",
           "cyan": "#22d3ee", "turquoise": "#22d3ee", "navy": "#1e3a8a", "magenta": "#d946ef"}
KIND_WORDS = [("big number", "kpi"), ("number", "kpi"), ("kpi", "kpi"), ("gauge", "gauge"), ("progress", "progress"),
              ("donut", "donut"), ("doughnut", "donut"), ("pie", "pie"), ("ranked", "hbar"), ("horizontal", "hbar"),
              ("leaderboard", "leaderboard"), ("over time", "timeseries"), ("trend", "timeseries"),
              ("timeline", "timeseries"), ("line", "line"), ("area", "area"), ("histogram", "histogram"),
              ("spread", "histogram"), ("distribution", "histogram"), ("scatter", "scatter"), ("feed", "feed"),
              ("map", "map"), ("table", "table"), ("heading", "text"), ("title", "text"), ("bar", "bar")]


def _match_column(names_labels, text):
    """Best column for free text, by word overlap then fuzziness."""
    toks = [t for t in re.findall(r"[a-zA-Z0-9_]+", text.lower()) if len(t) > 1]
    best, score = None, 0.0
    for name, label in names_labels:
        words = set(re.findall(r"[a-z0-9]+", f"{name.replace('_', ' ')} {label}".lower()))
        s = 0.0
        for t in toks:
            if t in words:
                s += 1
            else:
                c = max((difflib.SequenceMatcher(None, t, w).ratio() for w in words), default=0)
                if c >= .84:
                    s += .7
        if s > score:
            best, score = name, s
    return best if score >= 1 else None


def explain_board(snap):
    tiles = display_order(snap["tiles"])
    if not tiles:
        return "This board is empty. Ask me to “remix this board” and I'll build one from your questions."
    kinds = {}
    for t in tiles:
        kinds.setdefault(CARD_KINDS[t["kind"]][0].lower(), []).append(t["title"] or CARD_KINDS[t["kind"]][0])
    b = snap["board"]
    src = {"submissions": "live survey submissions", "pipeline": "submissions cleaned by a pipeline",
           "dataset": "an uploaded file"}.get(b["source"], b["source"])
    lines = [f"**{b['name'] or 'This board'}** has {len(tiles)} cards reading {src}"
             + (f", filtered on {len(b['filters'])} condition(s)" if b["filters"] else "") + ":"]
    for kind, titles in kinds.items():
        lines.append(f"- {len(titles)} {kind}{'s' if len(titles) > 1 else ''}: " + ", ".join(f"“{x}”" for x in titles[:5]))
    lines.append(f"It uses the {b['theme']} theme"
                 + (f" with a {b['theme_config'].get('accent')} accent" if b["theme_config"].get("accent") else "") + "."
                 + (" Live updates are on." if b["is_live"] else ""))
    return "\n".join(lines)


def remix_ops(ctx, snap):
    """Clear and rebuild from the survey's questions, keeping only cards whose
    columns exist on this board's source."""
    tiles = eng.auto_tiles(ctx) if ctx.survey is not None and not ctx.frame.empty else []
    names = _field_names(snap)
    ops = [{"op": "clear"}]
    for t in tiles:
        spec = t.get("spec") or {}
        if any(spec.get(k) and spec[k] not in names for k in ("x", "y", "column", "group_by", "color_by")):
            continue
        ops.append({"op": "add", "kind": t["kind"] if t["kind"] in CARD_KINDS else "timeseries",
                    "title": t.get("title", ""), "spec": spec})
    return ops if len(ops) > 2 else None


def builtin_dashboard(ctx, snap, m):
    low = m.lower()
    ops, says = [], []
    if re.search(r"\b(explain|describe|what does this board|tell me about this board|summari[sz]e this board)\b", low):
        return {"say": explain_board(snap), "mood": "happy", "actions": [],
                "suggestions": ["Remix this board", "Tidy the layout", "Add a map"]}
    if re.search(r"\b(remix|redesign|rebuild|makeover|make (it|this board) (look )?(great|beautiful|nicer|better))\b", low):
        rops = remix_ops(ctx, snap)
        if rops:
            return {"say": "Here's a remix: headline numbers on top, the trend wide beneath, comparisons in pairs and "
                           "the map at the bottom. It replaces the current cards, so it's waiting for your OK.",
                    "mood": "proud", "actions": [{"tool": "studio_dashboard", "note": "Board remix", "ops": rops}],
                    "suggestions": ["Try the sunset theme", "Make it compact", "Present it"]}
    theme = next((v for k, v in THEME_WORDS.items() if re.search(rf"\b{k}\b", low)), None)
    if theme and re.search(r"theme|look|style|make it|switch|use|go", low):
        ops.append({"op": "theme", "theme": theme})
        says.append(f"{theme} theme")
    colour = next((v for k, v in COLOURS.items() if re.search(rf"\b{k}\b", low)), None)
    hexm = re.search(r"#[0-9a-fA-F]{6}\b", m)
    if (colour or hexm) and re.search(r"accent|colou?r|highlight|brand", low):
        ops.append({"op": "theme", "accent": hexm.group(0) if hexm else colour})
        says.append("new accent colour")
    for word, knob, val in (("compact", "density", "compact"), ("roomy", "density", "roomy"), ("spacious", "density", "roomy"),
                            ("glass", "card", "glass"), ("outline", "card", "outline"), ("raised", "card", "raised"),
                            ("mesh", "backdrop", "mesh"), ("vivid", "palette", "vivid"), ("calm", "palette", "calm"),
                            ("monochrome", "palette", "mono")):
        if re.search(rf"\b{word}\b", low):
            ops.append({"op": "theme", knob: val})
            says.append({"density": f"{val} spacing", "card": f"{word} cards", "backdrop": f"{word} backdrop",
                         "palette": f"{word} colours"}[knob])
    if re.search(r"\b(tidy|close (the )?gaps|clean ?up (the )?layout|arrange)\b", low):
        ops.append({"op": "tidy"})
        says.append("tidy layout")
    if re.search(r"\b(present|presentation|full ?screen)\b", low):
        ops.append({"op": "present"})
        says.append("presentation mode")
    name = re.search(r"(?:rename|call) (?:the |this )?(?:board|dashboard|it) (?:to |as )?[“\"']?([^”\"'.]{2,80})", m, re.I)
    if name:
        ops.append({"op": "board", "name": name.group(1).strip()})
        says.append("new name")
    ref = re.search(r"refresh (?:every )?(\d+) ?(s|sec|seconds|min|minutes?)", low)
    if ref:
        secs = int(ref.group(1)) * (60 if ref.group(2).startswith("min") else 1)
        ops.append({"op": "board", "refresh_seconds": secs})
        says.append("auto-refresh")
    if re.search(r"\b(clear|remove|delete) (all|every|the whole)\b", low):
        ops.append({"op": "clear"})
        says.append("cleared the board")
    else:
        rm = re.search(r"\b(?:remove|delete|drop|get rid of) (?:the )?[“\"']?(.+?)[”\"']?(?: card| chart| tile)?$", m.strip(), re.I)
        if rm and not re.search(r"\bfilter", low):
            t = _find_card(snap["tiles"], rm.group(1).strip())
            if t:
                ops.append({"op": "remove", "card": t["id"]})
                says.append(f"removed “{_card_name(t)}”")
    size = re.search(r"\bmake (?:the )?[“\"']?(.+?)[”\"']? (bigger|wider|larger|smaller|narrower|full width)", m, re.I)
    if size:
        t = _find_card(snap["tiles"], size.group(1))
        if t:
            grow = size.group(2).lower()
            w = 12 if grow == "full width" else min(12, t["w"] + 3) if grow in ("bigger", "wider", "larger") else max(2, t["w"] - 2)
            h = t["h"] + (1 if grow in ("bigger", "larger") else 0)
            upd = {"op": "update", "card": t["id"], "w": w, "h": h}
            sp = re.search(r"split (?:it |this |that )?by (.+?)(?: and |$)", low)
            col = sp and _match_column([(f["name"], f["label"]) for f in snap["fields"] if not f["meta"]], sp.group(1))
            if col and t["kind"] in CHARTISH:
                upd["spec"] = {"group_by": col}
            ops.append(upd)
            says.append(f"resized “{_card_name(t)}”" + (" and split it" if upd.get("spec") else ""))
    if re.search(r"\b(add|show|put|insert|include|create|make)\b", low) and not size:
        kind = next((k for w, k in KIND_WORDS if re.search(rf"\b{w}\b", low)), None)
        col = _match_column([(f["name"], f["label"]) for f in snap["fields"] if not f["meta"]], re.sub(
            r"\b(add|show|put|insert|include|create|make|a|an|the|of|for|by|card|chart|graph|tile|donut|pie|bar|map|"
            r"table|big|number|trend|over|time|histogram|gauge|ranked|leaderboard)\b", " ", low))
        fkind = next((f["kind"] for f in snap["fields"] if f["name"] == col), None)
        if kind == "map":
            ops.append({"op": "add", "kind": "map", "title": "Where answers came from", "spec": {"color_by": col} if col else {}})
            says.append("added a map")
        elif kind == "table":
            ops.append({"op": "add", "kind": "table", "title": "Latest responses", "spec": {"limit": 25}})
            says.append("added a table")
        elif kind in ("kpi", "gauge", "progress") or (kind is None and re.search(r"\b(count|total|responses)\b", low)):
            spec = {"agg": "mean", "column": col} if col and fkind == "numeric" else {"agg": "count"}
            title = f"Average {next(f['label'] for f in snap['fields'] if f['name'] == col)}" if spec.get("column") else "Responses"
            ops.append({"op": "add", "kind": kind or "kpi", "title": title[:60], "spec": spec})
            says.append("added a number card")
        elif kind in ("timeseries", "line", "area"):
            date = next((f["name"] for f in snap["fields"] if f["kind"] == "datetime"), None)
            ops.append({"op": "add", "kind": "timeseries", "title": "Responses over time",
                        "spec": {"date": date, "freq": "D", "agg": "count", **({"group_by": col} if col and fkind == "categorical" else {})}})
            says.append("added a trend")
        elif kind == "text":
            body = re.search(r"[“\"']([^”\"']+)[”\"']", m)
            ops.append({"op": "add", "kind": "text", "w": 12, "h": 1, "spec": {"body": body.group(1) if body else "Section", "style": "heading"}})
            says.append("added a heading")
        elif col:
            label = next(f["label"] for f in snap["fields"] if f["name"] == col)
            if fkind == "numeric" and kind in (None, "histogram"):
                ops.append({"op": "add", "kind": "histogram", "title": f"Spread of {label}"[:80], "spec": {"x": col}})
            elif fkind == "numeric" and kind == "scatter":
                other = next((f["name"] for f in snap["fields"] if f["kind"] == "numeric" and f["name"] != col), col)
                ops.append({"op": "add", "kind": "scatter", "title": label[:80], "spec": {"x": col, "y": other}})
            else:
                k = kind if kind in ("bar", "hbar", "donut", "pie", "leaderboard") else "donut"
                spec = {"group_by": col, "agg": "count", "limit": 10} if k == "leaderboard" else \
                    {"x": col, "agg": "count", "sort": "value", "limit": 10}
                ops.append({"op": "add", "kind": k, "title": label[:80], "spec": spec})
            says.append(f"added “{label}”")
    if not ops:
        return None
    return {"say": "Done in the studio: " + ", ".join(dict.fromkeys(says)) + ".", "mood": "proud",
            "actions": [{"tool": "studio_dashboard", "ops": ops}],
            "suggestions": ["Tidy the layout", "Try the ocean theme", "Add a map"]}


STEP_ORDER = {"trim_text": 0, "case_text": 0, "strip_accents": 0, "replace_text": 0,
              "recode": 1, "replace": 1, "cast_type": 2, "rename_column": 3, "drop_columns": 3, "keep_columns": 3,
              "filter_rows": 4, "drop_rows": 4, "deduplicate": 4, "similar_duplicates": 4,
              "fill_missing": 5, "regression_impute": 5, "predict_column": 5,
              "outlier": 6, "winsorize": 6, "clip_range": 6,
              "calculate": 7, "bin_column": 7, "extract_datetime": 7, "concat_columns": 7, "make_id": 7,
              "group_aggregate": 7, "rank_rows": 7, "running_total": 7, "split_column": 7, "round_numbers": 7,
              "scale": 8, "encode": 8, "cluster": 9, "detect_anomalies": 9, "reduce_dimensions": 9,
              "flag_rows": 10, "sort_rows": 10, "sample": 10}


def best_order_ops(steps):
    """Move ops that put steps in a data engineer's order (stable within a stage)."""
    want = sorted(range(len(steps)), key=lambda i: (STEP_ORDER.get(steps[i]["operation"], 7), i))
    cur = list(range(len(steps)))
    ops = []
    for pos, orig in enumerate(want):
        j = cur.index(orig)
        if j != pos:
            ops.append({"op": "move", "step": f"#{j + 1}", "to": pos + 1})
            cur.insert(pos, cur.pop(j))
    return ops


def explain_flow(ctx, snap):
    p = snap["pipeline"]
    if not p["steps"]:
        return "This flow has no steps yet. Ask me to “build a cleaning flow” and I'll design one for this data."
    labels = eng.valid_operations()
    lines = [f"**{p['name']}** runs {len(p['steps'])} step(s) on "
             + ("an uploaded file" if p["source"] == "dataset" else "the survey submissions")
             + (" and re-runs on new data automatically:" if p["is_active"] else ":")]
    try:
        pv = dry_run(ctx, p)
    except Exception:
        pv = None
    for i, st in enumerate(p["steps"]):
        rep = pv["steps"][i] if pv else None
        extra = ""
        if rep and rep.get("status") == "ok":
            extra = (f" — removes {rep['removed']} row(s)" if rep.get("removed") else
                     f" — changes {rep['changes']} value(s)" if rep.get("changes") else " — nothing to change right now")
        elif rep and rep.get("status") == "failed":
            extra = f" — needs fixing: {rep.get('error')}"
        lines.append(f"{i + 1}. {st['name']} ({labels.get(st['operation'], st['operation'])}){'' if st['enabled'] else ' — switched off'}{extra}")
    if pv:
        lines.append(f"Result: {pv['source_rows']:,} rows in, {pv['result_rows']:,} rows out.")
    return "\n".join(lines)


def builtin_flow(ctx, snap, m):
    low = m.lower()
    if re.search(r"\b(explain|describe|what does this (flow|pipeline)|walk me through)\b", low):
        return {"say": explain_flow(ctx, snap), "mood": "happy", "actions": [],
                "suggestions": ["Put the steps in the best order", "Run the flow", "Build a cleaning flow"]}
    cols = [(c, c) for c in snap["columns"] if not c.startswith("_")]
    col = _match_column(cols, re.sub(r"\b(step|flow|pipeline|column|field|the|in|of|with|to|a|an|add|trim|spaces?|fill|"
                                     r"missing|blanks?|median|mean|mode|drop|rename|title|case|upper|lower)\b", " ", low))
    ops, say = [], []

    def step(op, name, cfg):
        return {"operation": op, "name": name, "config": cfg}

    newf = re.search(r"\bnew (?:flow|pipeline)(?: called| named)? ?[“\"']?([^”\"'.]{2,60})?", m, re.I)
    if newf or re.search(r"\b(build|make|create|design) (?:me )?(?:a |an )?(?:cleaning |data )?(?:flow|pipeline)", low):
        name = (newf.group(1).strip() if newf and newf.group(1) else "Foon's cleaning flow")
        steps = eng.auto_clean_steps(ctx) if re.search(r"clean|fix|auto|smart|build|design", low) or not newf else []
        ops.append({"op": "new_flow", "name": name, "steps": steps})
        say.append(f"new flow “{name}” with {len(steps)} step(s)")
    else:
        if re.search(r"\btrim\b|stray spaces|extra spaces", low) and col:
            ops.append({"op": "add", "step": step("trim_text", f"Tidy spaces in {col}", {"field": col})})
        if re.search(r"\b(title|proper) case\b|\bcapitali[sz]e\b", low) and col:
            ops.append({"op": "add", "step": step("case_text", f"Title-case {col}", {"field": col, "mode": "title"})})
        fm = re.search(r"\bfill (?:the )?(?:missing|blanks?|empty)", low)
        if fm and col:
            method = next((w for w in ("median", "mean", "mode") if w in low), None)
            const = re.search(r"\bwith [“\"']?([^”\"']+?)[”\"']?$", m.strip(), re.I)
            cfg = {"field": col, "method": method} if method or not const else {"field": col, "method": "constant", "value": const.group(1)}
            cfg["method"] = cfg["method"] or "median"
            ops.append({"op": "add", "step": step("fill_missing", f"Fill blanks in {col}", cfg)})
        if re.search(r"\b(remove|drop|delete) duplicates?\b|\bdedup", low):
            ops.append({"op": "add", "step": step("deduplicate", "Remove repeated rows", {"fields": [], "keep": "first"})})
        dm = re.search(r"\bdrop (?:the )?column", low)
        if dm and col:
            ops.append({"op": "add", "step": step("drop_columns", f"Drop {col}", {"columns": [col]})})
        rn = re.search(r"\brename (?:column )?[“\"']?(\w+)[”\"']? to [“\"']?(\w+)", m, re.I)
        if rn and not re.search(r"\brename (the )?(flow|pipeline)", low):
            ops.append({"op": "add", "step": step("rename_column", f"Rename {rn.group(1)}", {"field": rn.group(1), "new_name": rn.group(2)})})
        sm = re.search(r"\b(remove|delete|disable|enable|turn off|turn on) step (\d+)", low)
        if sm:
            verb, n = sm.group(1), sm.group(2)
            if verb in ("remove", "delete"):
                ops.append({"op": "remove", "step": f"#{n}"})
            else:
                ops.append({"op": "update", "step": f"#{n}", "enabled": verb in ("enable", "turn on")})
        mv = re.search(r"\bmove step (\d+) (up|down|to (?:position )?(\d+))", low)
        if mv:
            n = int(mv.group(1))
            to = int(mv.group(3)) if mv.group(3) else (n - 1 if mv.group(2) == "up" else n + 1)
            ops.append({"op": "move", "step": f"#{n}", "to": max(1, to)})
        rf = re.search(r"\brename (?:the )?(?:flow|pipeline) to [“\"']?([^”\"'.]{2,60})", m, re.I)
        if rf:
            ops.append({"op": "rename", "name": rf.group(1).strip()})
        if re.search(r"\b(best|right|sensible|logical|correct) order\b|\breorder\b", low):
            moves = best_order_ops(snap["pipeline"]["steps"])
            ops.extend(moves)
            if not moves:
                say.append("the steps were already in a good order")
        if re.search(r"\b(tidy|arrange|lay ?out) (the )?(canvas|nodes|flow)\b", low):
            ops.append({"op": "layout"})
        if re.search(r"\bactivate\b|\bturn (the )?flow on\b", low):
            ops.append({"op": "active", "value": True})
        if ops:
            say.append(f"{len(ops)} change(s) to the flow")
    if re.search(r"\b(run|execute)\b", low):
        ops.append({"op": "run"})
        say.append("then run it")
    if not ops:
        return None
    return {"say": "In the Data Studio: " + ", ".join(say) + ". I dry-ran it on your data first.", "mood": "proud",
            "actions": [{"tool": "studio_flow", "ops": ops}],
            "suggestions": ["Run the flow", "Tidy the canvas", "Add a step to remove duplicates"]}


def builtin_plan(ctx, message):
    snap = getattr(ctx, "studio", None)
    if not snap:
        return None
    if snap["kind"] == "dashboard":
        return builtin_dashboard(ctx, snap, message)
    return builtin_flow(ctx, snap, message)


# ─────────────────────────────────────────────────────────────────────
#  Tool entry points (registered in agent_engine.TOOLS)
# ─────────────────────────────────────────────────────────────────────

def tool_studio_dashboard(ctx, spec):
    snap = getattr(ctx, "studio", None)
    if not snap or snap["kind"] != "dashboard":
        raise eng.ToolError("Open a dashboard in the Dashboard Studio and I'll edit it with you.")
    if not ctx.can.get("dashboards"):
        raise eng.ToolError("You can view this board but not edit it.")
    block = plan_dashboard(snap, spec.get("ops"), _s(spec.get("note"), 120))
    if not block["changes"]:
        raise eng.ToolError("I couldn't turn that into a change on this board — " +
                            (block["warnings"][0] if block["warnings"] else "try naming the card or the column."))
    return block


def tool_studio_flow(ctx, spec):
    snap = getattr(ctx, "studio", None)
    if not snap or snap["kind"] != "flow":
        raise eng.ToolError("Open the Data Studio and I'll build flows with you there.")
    if not ctx.can.get("pipelines"):
        raise eng.ToolError("Only the survey owner can edit Data Studio flows.")
    try:
        block = plan_flow(ctx, snap, spec.get("ops"), _s(spec.get("note"), 120))
    except StudioError as exc:
        raise eng.ToolError(str(exc))
    if not block["changes"]:
        raise eng.ToolError("I couldn't turn that into a change to this flow — " +
                            (block["warnings"][0] if block["warnings"] else "try naming the step or the column."))
    return block
