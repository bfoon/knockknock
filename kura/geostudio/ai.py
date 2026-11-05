"""
kura/geostudio/ai.py — "ask the map": search + natural-language commands.

The search bar in Geo Studio takes anything:

    GM-7K3Q-9XA2-M             → a Location ID (exact registry lookup)
    7FG9+QX Banjul / 7FG9QX2C+ → a plus code
    13.45, -16.57              → coordinates
    "mangroves"                → features in this project by name / category
    "Tanji fish market"        → a place (OpenStreetMap Nominatim geocoder)
    "draw a 5 hectare circle at Brikama and call it Nursery" → a command

Commands become a small list of ACTIONS the browser executes. A built-in
parser handles the common phrasings with no AI at all (so the studio works
with no key and no quota); anything it can't parse goes to Gemini (via the
shared Hanns engine and its fallback chain) which must answer with the same
action vocabulary. The browser never runs anything outside that vocabulary.
"""

from __future__ import annotations

import json
import math
import re
import urllib.parse
import urllib.request

from django.core.cache import cache

from . import geo

ACTION_TYPES = {"fly_to", "geocode", "draw", "style", "select", "analyze", "buffer", "grid",
                "register", "geofence", "measure", "layer", "message", "basemap", "carbon"}

COLORS = {
    "red": "#ef4444", "green": "#22c55e", "dark green": "#15803d", "blue": "#3b82f6", "yellow": "#facc15",
    "orange": "#f97316", "purple": "#a855f7", "pink": "#ec4899", "cyan": "#22d3ee", "teal": "#14b8a6",
    "white": "#ffffff", "black": "#111827", "brown": "#92400e", "grey": "#9ca3af", "gray": "#9ca3af",
    "gold": "#f59e0b", "lime": "#84cc16",
}
CATEGORY_WORDS = {
    "mangrove": "mangrove", "mangroves": "mangrove", "palm": "palm", "palms": "palm", "forest": "forest",
    "parcel": "parcel", "parcels": "parcel", "plot": "plot", "plots": "plot", "farm": "farm", "farms": "farm",
    "solar": "solar", "geofence": "geofence", "geofences": "geofence", "fence": "geofence", "road": "road",
    "roads": "road", "building": "building", "buildings": "building", "water": "water", "cashew": "cashew",
    "agroforestry": "agroforestry", "aoi": "aoi",
}
NOMINATIM = "https://nominatim.openstreetmap.org/search"
UA = "KnockKnock-Kura-GeoStudio/1.0 (+https://nokknock.app)"

COORD = re.compile(r"^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$")
LOCID = re.compile(r"\b([A-Z]{2,4}-[0-9A-Z]{4}-[0-9A-Z]{4}(?:-[0-9A-Z]{2,4})?-[0-9A-Z*~$=U])\b", re.I)
PLUS = re.compile(r"\b([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{0,3})\b", re.I)


# ───────────────────────────── geocoder ─────────────────────────────

def geocode(q, near=None, limit=5):
    q = (q or "").strip()
    if not q:
        return []
    key = "geo-gc:" + q.lower()[:120]
    hit = cache.get(key)
    if hit is not None:
        return hit
    params = {"q": q, "format": "jsonv2", "limit": str(limit), "polygon_geojson": "1"}
    if near:
        lat, lng = near
        d = 1.5
        params.update(viewbox=f"{lng - d},{lat + d},{lng + d},{lat - d}", bounded="0")
    url = NOMINATIM + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    try:
        with urllib.request.urlopen(req, timeout=12) as r:
            rows = json.loads(r.read().decode("utf-8") or "[]")
    except Exception:
        return []
    out = []
    for r in rows[:limit]:
        try:
            item = {"name": r.get("display_name", "")[:200], "lat": float(r["lat"]), "lng": float(r["lon"]),
                    "type": r.get("type") or r.get("category") or "place"}
        except (KeyError, TypeError, ValueError):
            continue
        bb = r.get("boundingbox")
        if bb and len(bb) == 4:
            item["bbox"] = [float(bb[0]), float(bb[2]), float(bb[1]), float(bb[3])]  # s, w, n, e
        g = r.get("geojson")
        if isinstance(g, dict) and g.get("type") in ("Polygon", "MultiPolygon") and len(json.dumps(g)) < 200_000:
            item["geometry"] = g
        out.append(item)
    cache.set(key, out, 24 * 3600)
    return out


# ───────────────────────────── built-in parser ─────────────────────────────

def _num_unit(text):
    """'5 hectares' → ('ha', 5); '300 m' → ('m', 300); '2 km' → ('m', 2000)."""
    m = re.search(r"(\d+(?:\.\d+)?)\s*(hectares?|ha|acres?|km2|km²|sq ?km|m2|m²|square met(?:er|re)s?|km|kilomet(?:er|re)s?|met(?:er|re)s?|m)\b", text, re.I)
    if not m:
        return None, None
    v = float(m.group(1))
    u = m.group(2).lower()
    if u.startswith("hect") or u == "ha":
        return "area", v * 10000
    if u.startswith("acre"):
        return "area", v * 4046.856
    if u in ("km2", "km²") or u.startswith("sq"):
        return "area", v * 1e6
    if u in ("m2", "m²") or u.startswith("square"):
        return "area", v
    if u in ("km",) or u.startswith("kilo"):
        return "len", v * 1000
    return "len", v


def _color(text):
    t = text.lower()
    for name in sorted(COLORS, key=len, reverse=True):
        if re.search(r"\b" + name + r"\b", t):
            return COLORS[name]
    m = re.search(r"#[0-9a-f]{6}\b", t)
    return m.group(0) if m else None


def _category(text):
    for w in re.findall(r"[a-z]+", text.lower()):
        if w in CATEGORY_WORDS:
            return CATEGORY_WORDS[w]
    return None


def _named(text):
    m = re.search(r"\b(?:called|call it|named|name it|labell?ed|label it)\s+[\"']?([^\"'.,]{1,60})", text, re.I)
    return m.group(1).strip() if m else ""


def _place(text):
    m = re.search(r"\b(?:at|in|around|near|over)\s+([A-Z][\w' -]{2,60}?)(?:\s+(?:and|called|named|with|in)\b|[.,]|$)", text)
    return m.group(1).strip() if m else None


def builtin(message, ctx):
    t = (message or "").strip()
    low = t.lower()
    acts = []

    m = COORD.match(t)
    if m:
        return [{"type": "fly_to", "lat": float(m.group(1)), "lng": float(m.group(2)), "zoom": 18}]
    m = LOCID.search(t.upper())
    if m and geo.location_id_valid(m.group(1)):
        return [{"type": "select", "filter": {"location_id": geo.normalise_location_id(m.group(1))}}]

    # basemap
    if re.search(r"\b(satellite|imagery)\b.*\b(view|map|mode)\b|\bswitch to (satellite|street|dark|topo)", low):
        bm = "satellite" if "satell" in low or "imagery" in low else ("dark" if "dark" in low else ("topo" if "topo" in low else "streets"))
        return [{"type": "basemap", "name": bm}]

    # analyse / count / detect / measure trees or solar
    if re.search(r"\b(count|detect|find|identify|analy[sz]e|measure|how many)\b", low) and \
            re.search(r"\b(trees?|palms?|mangroves?|canopy|solar|panels?|land ?cover|vegetation)\b", low):
        kind = "solar" if re.search(r"solar|panel", low) else ("landcover" if "cover" in low else "trees")
        engine = "ai" if re.search(r"\b(ai|gemini|smart)\b", low) else "hybrid"
        target = "view" if re.search(r"\b(view|screen|here|visible)\b", low) else "selected"
        return [{"type": "analyze", "kind": kind, "engine": engine, "target": target}]

    if re.search(r"\b(carbon|credits?|co2|sequest)", low):
        return [{"type": "carbon", "ecosystem": _category(low) or "mangrove"}]

    if re.search(r"\bregister\b|\blocation id\b|\bparcel id\b", low):
        return [{"type": "register"}]

    if re.search(r"\bgeo-?fence\b", low) and re.search(r"\b(make|turn|set|mark|create)\b", low) and not re.search(r"\bdraw\b", low):
        return [{"type": "geofence", "on": "off" not in low and "remove" not in low}]

    m = re.search(r"\bbuffer\b.*?(\d+(?:\.\d+)?)\s*(m|km|met)", low)
    if m:
        d = float(m.group(1)) * (1000 if m.group(2) == "km" else 1)
        return [{"type": "buffer", "distance_m": d}]

    if re.search(r"\b(grid|sample plots?|sampling)\b", low):
        _, v = _num_unit(low)
        return [{"type": "grid", "cell_m": v if v and v < 5000 else 100}]

    # draw
    if re.search(r"\b(draw|create|add|make|put|mark|place)\b", low) and \
            re.search(r"\b(circle|square|rectangle|box|marker|pin|point|polygon|area|zone|geofence|buffer|label|text)\b", low):
        unit, v = _num_unit(low)
        shape = "circle"
        if re.search(r"\b(square|rectangle|box)\b", low):
            shape = "rectangle"
        elif re.search(r"\b(marker|pin|point)\b", low):
            shape = "point"
        elif re.search(r"\b(label|text)\b", low):
            shape = "text"
        radius = None
        if shape in ("circle", "rectangle"):
            if unit == "area":
                radius = math.sqrt(v / math.pi) if shape == "circle" else math.sqrt(v) / 2
            elif unit == "len":
                radius = v if shape == "circle" else v / 2
            else:
                radius = 100
        place = _place(t)
        cat = _category(low) or ("geofence" if "geofence" in low else "aoi")
        act = {"type": "draw", "shape": shape, "radius_m": radius, "name": _named(t), "category": cat,
               "style": {k: v for k, v in {"color": _color(low)}.items() if v},
               "is_geofence": "geofence" in low or "fence" in low}
        if shape == "text":
            m2 = re.search(r"[\"“](.+?)[\"”]", t)
            act["text"] = m2.group(1) if m2 else (_named(t) or "Label")
        if place:
            act["place"] = place
        else:
            act["at"] = "center"
        return [act]

    # colour / style
    col = _color(low)
    if col and re.search(r"\b(colou?r|paint|make|fill|turn|set|style)\b", low):
        cat = _category(low)
        f = {"category": cat} if cat else {"selected": True}
        return [{"type": "style", "filter": f, "style": {"color": col, "fillColor": col}}]

    # select / filter
    m = re.search(r"(bigger|larger|more|over|above|smaller|less|under|below)\s+than\s+(\d+(?:\.\d+)?)\s*(ha|hectares?|acres?|m2|m²)?", low)
    if m or re.search(r"\b(show|list|select|highlight|find)\b", low):
        f = {}
        cat = _category(low)
        if cat:
            f["category"] = cat
        if m:
            v = float(m.group(2))
            if m.group(3) and m.group(3).startswith("acre"):
                v *= 0.4047
            elif m.group(3) in ("m2", "m²"):
                v /= 10000
            f["min_ha" if m.group(1) in ("bigger", "larger", "more", "over", "above") else "max_ha"] = v
        if f:
            return [{"type": "select", "filter": f}]

    # go to
    m = re.match(r"^\s*(?:go to|fly to|zoom to|show me|take me to|where is|find)\s+(.+)$", t, re.I)
    if m:
        return [{"type": "geocode", "query": m.group(1).strip(" ?.")}]
    return acts


# ───────────────────────────── AI planner ─────────────────────────────

SYSTEM = """You are the map assistant inside Kura Geo Studio (a GIS / MRV / land-registry tool in The Gambia, West Africa).
Turn the user's request into actions. Reply with ONE JSON object: {"reply": "short friendly sentence", "actions": [ ... ]}.
Allowed actions (use only these; coordinates are WGS84 decimal degrees):
- {"type":"fly_to","lat":n,"lng":n,"zoom":3-20}
- {"type":"geocode","query":"place name"}            # find a place by name, then fly there
- {"type":"draw","shape":"circle|rectangle|point|text|polygon|line","lat":n,"lng":n,"radius_m":n,"coords":[[lat,lng],...],"place":"name instead of lat/lng","at":"center","name":"","category":"parcel|geofence|aoi|mangrove|palm|forest|agroforestry|cashew|farm|solar|building|road|water|plot|poi|note","icon":"emoji","text":"","style":{"color":"#hex","fillColor":"#hex","fillOpacity":0-1,"weight":n,"dashArray":"6 4"},"is_geofence":bool}
- {"type":"style","filter":{"category":"..","name_contains":"..","selected":true},"style":{...}}
- {"type":"select","filter":{"category":"..","name_contains":"..","min_ha":n,"max_ha":n,"location_id":".."}}
- {"type":"analyze","kind":"trees|solar|landcover|full","engine":"pixel|ai|hybrid","target":"selected|view"}
- {"type":"buffer","distance_m":n}        # around the selected feature
- {"type":"grid","cell_m":n}              # sample-plot grid inside the selected polygon
- {"type":"register"}                     # issue a Location ID for the selected feature
- {"type":"geofence","on":true|false}     # toggle geofence on selected
- {"type":"carbon","ecosystem":"mangrove|palm|forest|agroforestry|cashew|solar"}
- {"type":"basemap","name":"satellite|streets|dark|topo"}
- {"type":"message","text":"..."}
Hectares → circle radius_m = sqrt(ha*10000/pi). Prefer "place" over guessing coordinates you don't know.
Never invent data about land ownership."""


def plan(message, ctx, user_id=None, use_ai=True):
    acts = builtin(message, ctx)
    if acts:
        return {"reply": "", "actions": acts, "engine": "builtin"}

    # plain search fallthrough (no verbs) → project search first, then place
    if not use_ai:
        return {"reply": "", "actions": [{"type": "geocode", "query": message}], "engine": "builtin"}
    try:
        from hanns import ai as hai
        if not hai.is_enabled():
            return {"reply": "", "actions": [{"type": "geocode", "query": message}], "engine": "builtin"}
        if user_id:
            hai.take_quota(user_id)
        user = json.dumps({"request": message, "context": ctx}, default=str)[:12000]
        data, model = hai.ai_json(SYSTEM, user, temperature=0.3, max_tokens=2048)
    except Exception as e:
        return {"reply": f"AI is unavailable ({str(e)[:120]}) — searched for the place instead.",
                "actions": [{"type": "geocode", "query": message}], "engine": "builtin"}
    actions = [a for a in (data.get("actions") or []) if isinstance(a, dict) and a.get("type") in ACTION_TYPES][:12]
    return {"reply": str(data.get("reply") or "")[:400], "actions": actions, "engine": model}
