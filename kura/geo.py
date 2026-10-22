"""
kura/geo.py — server-side truth for the `mapper` question type.

A mapper answer is a GeoJSON FeatureCollection produced by the web runner
(static/kura/kura_mapper.js). Three ways to make features:

    track   walk or drive with the phone; GPS is recorded live → LineString
    area    walk / drive the boundary; closes into a geofence → Polygon
    draw    draw on the map: polygon, rectangle, circle, line, point

Everything a client sends is untrusted: we rebuild every feature from its
coordinates, clamp sizes, and RECOMPUTE all measurements here (distance,
area, perimeter, duration, speed) so the numbers in the dataset can't be
faked from the phone.

Stored value (what ends up in Submission.answers[name]):

    {"type": "FeatureCollection",
     "features": [{"type": "Feature",
                   "geometry": {"type": "LineString"|"Polygon"|"Point", "coordinates": …},
                   "properties": {"kind": "track"|"area"|"drawn",
                                  "shape": "line"|"polygon"|"rectangle"|"circle"|"point",
                                  "label": str, "color": "#hex",
                                  "radius_m": float (circles),
                                  "distance_m", "perimeter_m", "area_m2",
                                  "duration_s", "avg_speed_kmh", "max_speed_kmh",
                                  "points", "accuracy_m", "started_at", "ended_at"}}],
     "summary": {"features": n, "distance_m": …, "area_m2": …, "area_ha": …}}

GeoJSON order is [lng, lat] — note the swap relative to Kura's zones,
which store [lat, lng] for historical reasons.
"""

from __future__ import annotations

import json
import math
import re

R_EARTH = 6371008.8          # mean Earth radius, metres
MAX_FEATURES = 25
MAX_POINTS_PER_FEATURE = 20000
MAX_TOTAL_POINTS = 60000
HEX = re.compile(r"^#[0-9a-fA-F]{3,8}$")
SHAPES = {"line", "polygon", "rectangle", "circle", "point"}
KINDS = {"track", "area", "drawn"}


class MapperError(ValueError):
    pass


# ───────────────────────────── geometry maths ─────────────────────────────

def haversine_m(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH * math.asin(min(1.0, math.sqrt(h)))


def path_length_m(coords):
    """coords: [[lng, lat, …], …]"""
    return sum(haversine_m(a[1], a[0], b[1], b[0]) for a, b in zip(coords, coords[1:]))


def ring_area_m2(ring):
    """Geodesic area of a closed ring on the sphere (same method as
    Leaflet.draw / turf: spherical excess via the line-integral formula)."""
    if len(ring) < 4:
        return 0.0
    total = 0.0
    for (lng1, lat1, *_), (lng2, lat2, *_) in zip(ring, ring[1:]):
        total += math.radians(lng2 - lng1) * (2 + math.sin(math.radians(lat1)) + math.sin(math.radians(lat2)))
    return abs(total * R_EARTH * R_EARTH / 2.0)


def point_in_ring(lat, lng, ring):
    """Ray casting on [lng, lat] ring."""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


# ───────────────────────────── cleaning ─────────────────────────────

def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _pos(p):
    """Return a clean [lng, lat] or [lng, lat, t_ms, acc_m] position, or None."""
    if not isinstance(p, (list, tuple)) or len(p) < 2:
        return None
    lng, lat = _num(p[0]), _num(p[1])
    if lng is None or lat is None or not (-180 <= lng <= 180 and -90 <= lat <= 90):
        return None
    out = [round(lng, 7), round(lat, 7)]
    if len(p) >= 3 and _num(p[2]) is not None:          # timestamp (ms) from live tracking
        out.append(int(_num(p[2])))
        if len(p) >= 4 and _num(p[3]) is not None:      # GPS accuracy (m)
            out.append(round(max(0.0, _num(p[3])), 1))
    return out


def _dedupe(coords):
    out = []
    for c in coords:
        if not out or (c[0], c[1]) != (out[-1][0], out[-1][1]):
            out.append(c)
    return out


def _clean_feature(f, budget):
    if not isinstance(f, dict):
        return None
    geom = f.get("geometry") or {}
    props = f.get("properties") or {}
    gtype = geom.get("type")
    raw = geom.get("coordinates")
    kind = props.get("kind") if props.get("kind") in KINDS else "drawn"
    shape = props.get("shape") if props.get("shape") in SHAPES else None

    p = {"kind": kind}
    label = str(props.get("label") or "").strip()[:80]
    if label:
        p["label"] = label
    if isinstance(props.get("color"), str) and HEX.match(props["color"].strip()):
        p["color"] = props["color"].strip()

    if gtype == "Point":
        c = _pos(raw)
        if not c:
            return None
        radius = _num(props.get("radius_m"))
        if shape == "circle" and radius and radius > 0:
            radius = min(radius, 500_000.0)
            p.update(shape="circle", radius_m=round(radius, 2),
                     area_m2=round(math.pi * radius * radius, 2),
                     perimeter_m=round(2 * math.pi * radius, 2))
        else:
            p["shape"] = "point"
        budget[0] -= 1
        return {"type": "Feature", "geometry": {"type": "Point", "coordinates": c[:2]}, "properties": p}

    if gtype == "LineString":
        coords = _dedupe([c for c in (_pos(x) for x in (raw or [])[:MAX_POINTS_PER_FEATURE]) if c])
        if len(coords) < 2:
            return None
        budget[0] -= len(coords)
        if budget[0] < 0:
            raise MapperError("This map answer has too many points. Finish the track and start a new one.")
        p["shape"] = "line"
        p["distance_m"] = round(path_length_m(coords), 2)
        p["points"] = len(coords)
        _time_stats(coords, p)
        return {"type": "Feature", "geometry": {"type": "LineString", "coordinates": coords}, "properties": p}

    if gtype == "Polygon":
        rings = raw if isinstance(raw, list) else []
        outer = rings[0] if rings and isinstance(rings[0], list) else []
        coords = _dedupe([c for c in (_pos(x) for x in outer[:MAX_POINTS_PER_FEATURE]) if c])
        if len(coords) >= 2 and (coords[0][0], coords[0][1]) == (coords[-1][0], coords[-1][1]):
            coords = coords[:-1]
        if len(coords) < 3:
            return None
        budget[0] -= len(coords)
        if budget[0] < 0:
            raise MapperError("This map answer has too many points. Simplify the area and try again.")
        ring = coords + [coords[0]]
        p["shape"] = "rectangle" if shape == "rectangle" else "polygon"
        p["area_m2"] = round(ring_area_m2(ring), 2)
        p["perimeter_m"] = round(path_length_m(ring), 2)
        p["points"] = len(coords)
        _time_stats(coords, p)
        # Store the ring without per-point time/accuracy (keeps GIS tools happy).
        return {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [[c[:2] for c in ring]]}, "properties": p}

    return None


def _time_stats(coords, p):
    """Duration / speed / accuracy from live-tracked positions [lng, lat, t_ms, acc]."""
    timed = [c for c in coords if len(c) >= 3]
    if len(timed) >= 2:
        t0, t1 = timed[0][2], timed[-1][2]
        dur = max(0.0, (t1 - t0) / 1000.0)
        if 0 < dur < 7 * 24 * 3600:
            p["duration_s"] = round(dur, 1)
            p["started_at"] = t0
            p["ended_at"] = t1
            dist = path_length_m(timed)
            p["avg_speed_kmh"] = round(dist / dur * 3.6, 2)
            mx = 0.0
            for a, b in zip(timed, timed[1:]):
                dt = (b[2] - a[2]) / 1000.0
                if dt >= 1:
                    mx = max(mx, haversine_m(a[1], a[0], b[1], b[0]) / dt * 3.6)
            p["max_speed_kmh"] = round(min(mx, 400.0), 2)
    accs = [c[3] for c in coords if len(c) >= 4]
    if accs:
        p["accuracy_m"] = round(sum(accs) / len(accs), 1)


def _parse_latlng_text(text):
    """Accept '13.45, -16.57' typed into the Android app's fallback text box."""
    m = re.match(r"^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$", str(text or ""))
    if not m:
        return None
    lat, lng = float(m.group(1)), float(m.group(2))
    if -90 <= lat <= 90 and -180 <= lng <= 180:
        return {"type": "FeatureCollection", "features": [
            {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lng, lat]},
             "properties": {"kind": "drawn", "shape": "point"}}]}
    return None


def clean_mapper(value, q):
    """Validate one mapper answer. Returns (clean_value_or_None, error_or_None).

    None means "no answer" (lets the normal required-check decide).
    """
    cfg = q.get("mapper") or {}
    if value in (None, "", [], {}):
        return None, None
    if isinstance(value, str):
        s = value.strip()
        if s.startswith("{"):
            try:
                value = json.loads(s)
            except ValueError:
                value = None
        else:
            # Older Kura Collect (Android) builds show unknown types as a text box.
            # Coordinates typed there become a point; anything else is dropped
            # rather than blocking an offline sync.
            value = _parse_latlng_text(s)
        if value is None:
            return None, None
    if isinstance(value, dict) and value.get("type") == "Feature":
        value = {"type": "FeatureCollection", "features": [value]}
    if not isinstance(value, dict) or value.get("type") != "FeatureCollection":
        return None, "The map answer is not valid. Clear it and map again."

    feats_in = value.get("features") or []
    if not isinstance(feats_in, list):
        return None, "The map answer is not valid. Clear it and map again."
    max_features = int(_num(cfg.get("max_features")) or MAX_FEATURES)
    max_features = max(1, min(MAX_FEATURES, max_features))
    budget = [MAX_TOTAL_POINTS]
    try:
        feats = [f for f in (_clean_feature(f, budget) for f in feats_in[:MAX_FEATURES]) if f]
    except MapperError as e:
        return None, str(e)
    if not feats:
        return None, None
    if len(feats) > max_features:
        return None, f"Map at most {max_features} shape{'s' if max_features != 1 else ''} for this question."

    allowed = set(cfg.get("modes") or ["track", "area", "draw"])
    kinds = {f["properties"]["kind"] for f in feats}
    if "drawn" in kinds and "draw" not in allowed:
        return None, "Drawing on the map isn't allowed for this question — record it with GPS."
    if "track" in kinds and "track" not in allowed:
        return None, "GPS tracks aren't allowed for this question."
    if "area" in kinds and "area" not in allowed:
        return None, "Walked areas aren't allowed for this question."

    distance = round(sum(f["properties"].get("distance_m", 0) for f in feats), 2)
    area = round(sum(f["properties"].get("area_m2", 0) for f in feats), 2)
    summary = {
        "features": len(feats),
        "distance_m": distance,
        "distance_km": round(distance / 1000, 3),
        "area_m2": area,
        "area_ha": round(area / 10000, 4),
        "kinds": sorted(kinds),
    }

    min_area = _num(cfg.get("min_area_m2"))
    if min_area and area < min_area:
        return None, f"The mapped area is {area:,.0f} m² — it must be at least {min_area:,.0f} m²."
    min_dist = _num(cfg.get("min_distance_m"))
    if min_dist and distance < min_dist:
        return None, f"The track is {distance:,.0f} m — it must be at least {min_dist:,.0f} m."

    return {"type": "FeatureCollection", "features": feats, "summary": summary}, None


# ───────────────────────────── helpers for views ─────────────────────────────

def mapper_names(schema):
    return [q["name"] for q in (schema or {}).get("questions", [])
            if q.get("type") == "mapper" and q.get("name")]


def csv_columns(name):
    return [f"{name}__features", f"{name}__distance_m", f"{name}__area_m2", f"{name}__area_ha", f"{name}__geojson"]


def csv_values(v):
    s = (v or {}).get("summary") if isinstance(v, dict) else None
    if not s:
        return ["", "", "", "", ""]
    return [s.get("features", ""), s.get("distance_m", ""), s.get("area_m2", ""), s.get("area_ha", ""),
            json.dumps({"type": "FeatureCollection", "features": v.get("features", [])}, ensure_ascii=False, separators=(",", ":"))]


def zone_feature(z):
    """A Kura zone (schema['zones']) as a GeoJSON feature — zones store [lat, lng]."""
    props = {"layer": "zone", "id": z.get("id"), "label": z.get("name") or z.get("id"),
             "color": z.get("color") if isinstance(z.get("color"), str) and HEX.match(z.get("color", "")) else "#22d3ee"}
    if z.get("kind") == "polygon" and len(z.get("points") or []) >= 3:
        ring = [[float(p[1]), float(p[0])] for p in z["points"]]
        ring.append(ring[0])
        return {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": props}
    lat, lng, r = _num(z.get("lat")), _num(z.get("lng")), _num(z.get("radius_km"))
    if lat is None or lng is None:
        return None
    props.update(shape="circle", radius_m=round((r or 1) * 1000, 2))
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lng, lat]}, "properties": props}


def first_position(answers, schema):
    """[lat, lng] of the first mapped coordinate — a location fallback for
    submissions where the phone didn't share a separate GPS fix."""
    for name in mapper_names(schema):
        v = (answers or {}).get(name)
        for f in (v or {}).get("features", []) if isinstance(v, dict) else []:
            g = f.get("geometry") or {}
            c = g.get("coordinates")
            if g.get("type") == "Point" and c:
                return [c[1], c[0]]
            if g.get("type") == "LineString" and c:
                return [c[0][1], c[0][0]]
            if g.get("type") == "Polygon" and c and c[0]:
                return [c[0][0][1], c[0][0][0]]
    return None
