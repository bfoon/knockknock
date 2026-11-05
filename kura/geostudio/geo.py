"""
kura/geostudio/geo.py — pure-Python geometry for Kura Geo Studio.

No GEOS / GDAL / shapely needed, so the Docker image does not change.
Everything works on plain GeoJSON dicts in WGS84 (lon, lat).

What lives here
───────────────
* geodesic area (same spherical-excess formula Turf.js and Google use, so the
  hectares the browser shows and the hectares the server stores agree to the
  square metre) and haversine length
* centroid, bbox, point-in-polygon, polygon overlap test
* Web Mercator tile maths used by the imagery stitcher
* Open Location Code (Google Plus Code) encoder — the centroid's plus code is
  part of every Location ID, so the ID can be found on Google Maps
* Location IDs:  GM-7K3Q-9XA2-M
      prefix  — country / programme prefix (settings.GEO_ID_PREFIX)
      body    — Crockford base-32 of the SHA-256 of the canonical geometry
      check   — one check character (mod-37, ISO 7064 style) so a mistyped
                ID is rejected instead of finding the wrong land
  The full SHA-256 is kept as well: anyone holding the boundary GeoJSON can
  recompute it and prove the boundary was not moved after registration.
"""

from __future__ import annotations

import hashlib
import json
import math

EARTH_R = 6378137.0                    # WGS84 semi-major axis, metres
CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
CHECK_ALPHABET = CROCKFORD + "*~$=U"   # 37 symbols for the mod-37 check


# ───────────────────────────── basic helpers ─────────────────────────────

def _rings(geom):
    """Yield (outer, holes) for every polygon in a Polygon/MultiPolygon."""
    t = (geom or {}).get("type")
    c = (geom or {}).get("coordinates") or []
    if t == "Polygon" and c:
        yield c[0], c[1:]
    elif t == "MultiPolygon":
        for poly in c:
            if poly:
                yield poly[0], poly[1:]


def all_points(geom):
    t = (geom or {}).get("type")
    c = (geom or {}).get("coordinates")
    if t == "Point":
        return [c]
    if t in ("LineString", "MultiPoint"):
        return list(c or [])
    if t in ("Polygon", "MultiLineString"):
        return [p for ring in (c or []) for p in ring]
    if t == "MultiPolygon":
        return [p for poly in (c or []) for ring in poly for p in ring]
    if t == "GeometryCollection":
        return [p for g in (geom.get("geometries") or []) for p in all_points(g)]
    return []


def valid_geometry(geom) -> bool:
    try:
        pts = all_points(geom)
        if not pts:
            return False
        for p in pts:
            lon, lat = float(p[0]), float(p[1])
            if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                return False
        if geom["type"] in ("Polygon", "MultiPolygon"):
            for outer, _ in _rings(geom):
                if len(outer) < 4:
                    return False
        if geom["type"] == "LineString" and len(geom["coordinates"]) < 2:
            return False
        return True
    except (KeyError, TypeError, ValueError, IndexError):
        return False


def bbox(geom):
    pts = all_points(geom)
    if not pts:
        return None
    xs = [float(p[0]) for p in pts]
    ys = [float(p[1]) for p in pts]
    return [min(xs), min(ys), max(xs), max(ys)]


# ───────────────────────────── measurement ─────────────────────────────

def _ring_area(coords):
    """Signed spherical ring area in m² (Chamberlain & Duquette, as Turf)."""
    n = len(coords)
    if n < 3:
        return 0.0
    total = 0.0
    for i in range(n):
        lo = coords[i]
        mi = coords[(i + 1) % n]
        hi = coords[(i + 2) % n]
        total += (math.radians(float(hi[0])) - math.radians(float(lo[0]))) * math.sin(math.radians(float(mi[1])))
    return total * EARTH_R * EARTH_R / 2.0


def area_m2(geom) -> float:
    total = 0.0
    for outer, holes in _rings(geom):
        a = abs(_ring_area(outer))
        for h in holes:
            a -= abs(_ring_area(h))
        total += max(0.0, a)
    return total


def haversine(a, b) -> float:
    lon1, lat1, lon2, lat2 = map(math.radians, (float(a[0]), float(a[1]), float(b[0]), float(b[1])))
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_R * math.asin(min(1.0, math.sqrt(h)))


def length_m(geom) -> float:
    t = (geom or {}).get("type")
    c = (geom or {}).get("coordinates") or []
    lines = []
    if t == "LineString":
        lines = [c]
    elif t == "MultiLineString":
        lines = c
    elif t in ("Polygon", "MultiPolygon"):
        lines = [outer for outer, _ in _rings(geom)]     # perimeter
    return sum(haversine(l[i], l[i + 1]) for l in lines for i in range(len(l) - 1))


def centroid(geom):
    """Area-weighted centroid for polygons, mean for everything else."""
    if (geom or {}).get("type") in ("Polygon", "MultiPolygon"):
        cx = cy = aw = 0.0
        for outer, _ in _rings(geom):
            ring = outer
            a = 0.0
            x = y = 0.0
            for i in range(len(ring) - 1):
                x0, y0 = float(ring[i][0]), float(ring[i][1])
                x1, y1 = float(ring[i + 1][0]), float(ring[i + 1][1])
                f = x0 * y1 - x1 * y0
                a += f
                x += (x0 + x1) * f
                y += (y0 + y1) * f
            if abs(a) > 1e-18:
                cx += x / 3.0
                cy += y / 3.0
                aw += a
        if abs(aw) > 1e-18:
            return [cx / aw, cy / aw]
    pts = all_points(geom)
    if not pts:
        return None
    return [sum(float(p[0]) for p in pts) / len(pts), sum(float(p[1]) for p in pts) / len(pts)]


def circle_polygon(lon, lat, radius_m, steps=64):
    """A geodesic circle as a GeoJSON Polygon (Leaflet circles → storable)."""
    lat_r, lon_r = math.radians(lat), math.radians(lon)
    d = radius_m / EARTH_R
    ring = []
    for i in range(steps):
        brg = 2 * math.pi * i / steps
        la = math.asin(math.sin(lat_r) * math.cos(d) + math.cos(lat_r) * math.sin(d) * math.cos(brg))
        lo = lon_r + math.atan2(math.sin(brg) * math.sin(d) * math.cos(lat_r), math.cos(d) - math.sin(lat_r) * math.sin(la))
        ring.append([round(math.degrees(lo), 7), round(math.degrees(la), 7)])
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}


def measure(geom, props=None):
    """Area/length/centroid summary stored on every feature."""
    props = props or {}
    out = {"area_m2": 0.0, "length_m": 0.0, "centroid": centroid(geom)}
    if props.get("radius") and (geom or {}).get("type") == "Point":
        r = float(props["radius"])
        out["area_m2"] = math.pi * r * r
        out["length_m"] = 2 * math.pi * r
    else:
        out["area_m2"] = area_m2(geom)
        out["length_m"] = length_m(geom)
    return out


# ───────────────────────────── topology ─────────────────────────────

def _pip_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = float(ring[i][0]), float(ring[i][1])
        xj, yj = float(ring[j][0]), float(ring[j][1])
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-30) + xi:
            inside = not inside
        j = i
    return inside


def point_in_geometry(lon, lat, geom, props=None) -> bool:
    props = props or {}
    t = (geom or {}).get("type")
    if t == "Point" and props.get("radius"):
        return haversine([lon, lat], geom["coordinates"]) <= float(props["radius"])
    for outer, holes in _rings(geom):
        if _pip_ring(lon, lat, outer) and not any(_pip_ring(lon, lat, h) for h in holes):
            return True
    return False


def _seg_cross(p1, p2, p3, p4):
    def o(a, b, c):
        v = (float(b[1]) - float(a[1])) * (float(c[0]) - float(b[0])) - (float(b[0]) - float(a[0])) * (float(c[1]) - float(b[1]))
        return 0 if abs(v) < 1e-15 else (1 if v > 0 else 2)
    return o(p1, p2, p3) != o(p1, p2, p4) and o(p3, p4, p1) != o(p3, p4, p2) \
        and 0 not in (o(p1, p2, p3), o(p1, p2, p4), o(p3, p4, p1), o(p3, p4, p2))


def polygons_overlap(a, b) -> bool:
    """True when two (multi)polygons share interior area. Touching edges do
    not count, so neighbouring parcels that share a boundary are fine."""
    ba, bb = bbox(a), bbox(b)
    if not ba or not bb or ba[2] <= bb[0] or bb[2] <= ba[0] or ba[3] <= bb[1] or bb[3] <= ba[1]:
        return False
    ra = [o for o, _ in _rings(a)]
    rb = [o for o, _ in _rings(b)]
    for r1 in ra:
        for r2 in rb:
            for i in range(len(r1) - 1):
                for j in range(len(r2) - 1):
                    if _seg_cross(r1[i], r1[i + 1], r2[j], r2[j + 1]):
                        return True
    # one fully inside the other (test an interior-ish point: the centroid)
    ca, cb = centroid(a), centroid(b)
    if ca and point_in_geometry(ca[0], ca[1], b):
        return True
    if cb and point_in_geometry(cb[0], cb[1], a):
        return True
    return False


# ───────────────────────────── Web Mercator tiles ─────────────────────────────

def lonlat_to_pixel(lon, lat, z):
    """Global pixel coords at zoom z (256-px tiles)."""
    s = 256 * (2 ** z)
    lat = max(-85.05112878, min(85.05112878, lat))
    x = (lon + 180.0) / 360.0 * s
    sl = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + sl) / (1 - sl)) / (4 * math.pi)) * s
    return x, y


def pixel_to_lonlat(x, y, z):
    s = 256 * (2 ** z)
    lon = x / s * 360.0 - 180.0
    n = math.pi - 2 * math.pi * y / s
    lat = math.degrees(math.atan(math.sinh(n)))
    return lon, lat


def metres_per_pixel(lat, z):
    return math.cos(math.radians(lat)) * 2 * math.pi * EARTH_R / (256 * 2 ** z)


# ───────────────────────────── Plus Codes ─────────────────────────────

_OLC = "23456789CFGHJMPQRVWX"


def plus_code(lat, lon, length=10):
    """Open Location Code (pair encoding, 10 digits ≈ 14 m × 14 m).
    Integer arithmetic, as the reference implementation, so float drift
    never flips the last digit."""
    pairs = max(1, min(5, length // 2))
    lat = min(90.0, max(-90.0, float(lat)))
    lon = ((float(lon) + 180.0) % 360.0) - 180.0
    li = int(math.floor(round((lat + 90.0) * 8000, 6)))
    ni = int(math.floor(round((lon + 180.0) * 8000, 6)))
    li = min(li, 180 * 8000 - 1)
    lat_d, lon_d = [], []
    for _ in range(5):
        lat_d.append(_OLC[li % 20])
        lon_d.append(_OLC[ni % 20])
        li //= 20
        ni //= 20
    lat_d.reverse()
    lon_d.reverse()
    code = "".join(a + b for a, b in zip(lat_d, lon_d))[: pairs * 2]
    code = code.ljust(8, "0")
    return code[:8] + "+" + code[8:]


# ───────────────────────────── canonical hashing ─────────────────────────────

def canonical_geometry(geom, props=None):
    """Rounded (≈1 cm), closed-ring-normalised geometry so the same boundary
    always hashes the same, whatever tool drew it."""
    props = props or {}

    def r(p):
        return [round(float(p[0]), 7), round(float(p[1]), 7)]

    t = geom.get("type")
    c = geom.get("coordinates")
    if t == "Point" and props.get("radius"):
        return {"type": "Circle", "center": r(c), "radius_m": round(float(props["radius"]), 2)}
    if t == "Point":
        return {"type": t, "coordinates": r(c)}
    if t in ("LineString", "MultiPoint"):
        return {"type": t, "coordinates": [r(p) for p in c]}
    if t == "Polygon":
        return {"type": t, "coordinates": [_norm_ring([r(p) for p in ring]) for ring in c]}
    if t == "MultiPolygon":
        return {"type": t, "coordinates": [[_norm_ring([r(p) for p in ring]) for ring in poly] for poly in c]}
    if t == "MultiLineString":
        return {"type": t, "coordinates": [[r(p) for p in l] for l in c]}
    return geom


def _norm_ring(ring):
    """Drop the closing vertex, rotate so the smallest vertex is first, force
    counter-clockwise, then close again — the hash must not depend on where
    the surveyor happened to start walking or which way round they went."""
    if len(ring) > 1 and ring[0] == ring[-1]:
        ring = ring[:-1]
    if not ring:
        return ring
    if _ring_area(ring + [ring[0]]) < 0:
        ring = ring[::-1]
    k = ring.index(min(ring))
    ring = ring[k:] + ring[:k]
    return ring + [ring[0]]


def geometry_hash(geom, props=None) -> str:
    blob = json.dumps(canonical_geometry(geom, props), separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def crockford(hexdigest, chars):
    n = int(hexdigest, 16)
    bits = len(hexdigest) * 4
    n >>= max(0, bits - chars * 5)
    out = ""
    for _ in range(chars):
        out = CROCKFORD[n & 31] + out
        n >>= 5
    return out


def check_char(body: str) -> str:
    """ISO 7064 MOD 37,36-style check over the Crockford symbols."""
    total = 0
    for ch in body:
        if ch in CROCKFORD:
            total = (total * 32 + CROCKFORD.index(ch)) % 37
    return CHECK_ALPHABET[(37 - total) % 37 if total else 0]


def make_location_id(hexhash, prefix="GM", chars=8):
    body = crockford(hexhash, chars)
    grouped = "-".join(body[i:i + 4] for i in range(0, len(body), 4))
    return f"{prefix}-{grouped}-{check_char(prefix + body)}"


def normalise_location_id(code: str) -> str:
    """Accept what people actually type: lower case, O for 0, I/L for 1,
    spaces instead of dashes."""
    c = (code or "").strip().upper().replace(" ", "-")
    parts = c.split("-")
    if len(parts) < 3:
        return c
    prefix, check = parts[0], parts[-1]
    body = "".join(parts[1:-1]).translate(str.maketrans({"O": "0", "I": "1", "L": "1"}))
    grouped = "-".join(body[i:i + 4] for i in range(0, len(body), 4))
    return f"{prefix}-{grouped}-{check}"


def location_id_valid(code: str) -> bool:
    c = normalise_location_id(code)
    parts = c.split("-")
    if len(parts) < 3:
        return False
    prefix, check = parts[0], parts[-1]
    body = "".join(parts[1:-1])
    if not body or any(ch not in CROCKFORD for ch in body):
        return False
    return check_char(prefix + body) == check


def chain_hash(prev_hash: str, payload: dict) -> str:
    blob = (prev_hash or "GENESIS") + "|" + json.dumps(payload, separators=(",", ":"), sort_keys=True, default=str)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()
