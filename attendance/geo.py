"""
Venue location helpers — turn whatever an organizer has into a map pin.

The event form has one search box. Whatever is typed or pasted into it
goes through `resolve()`, which recognises, in this order:

  1. Plus Codes ("Google codes"), full or short:
        "7C559G8F+6W"   "9G8F+6W Banjul"   "9G8F+6W"
     Decoded right here (the Open Location Code algorithm is public and
     small), so no API key and no network call. A short code needs a
     nearby reference point: the town written after it, or else the
     centre of the organizer's map.
  2. Coordinates: "13.4549, -16.5790", "13.4549 -16.5790",
     "13°27'17.6\"N 16°34'44.4\"W" (what Google Maps shows when you
     tap a spot), "N 13.4549 W 16.5790".
  3. Google Maps links, long or short (maps.app.goo.gl/…, goo.gl/maps/…).
     Short links are expanded by following their redirect — only for
     those link-shortener hosts, never arbitrary URLs.
  4. Anything else is treated as an address or place name and sent to a
     geocoder: OpenStreetMap's Nominatim by default (free, no key), or
     Google's Geocoding API when GOOGLE_MAPS_API_KEY is set in the
     environment / .env (better coverage for named places in The Gambia).

The pin is stored on the event as geofence_lat / geofence_lng — the same
columns the public pages already use for "Get directions" and the ticket
map, so no database change is needed. Geofencing itself stays opt-in via
`require_geofence`.
"""

import hashlib
import json
import math
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass

from django.core.cache import cache


# ═══════════════════════════════════════════════════════════════════
# Plus Codes (Open Location Code)
# ═══════════════════════════════════════════════════════════════════
# Spec: https://github.com/google/open-location-code/blob/main/docs/specification.md

OLC_ALPHABET = "23456789CFGHJMPQRVWX"
_OLC_SEPARATOR = "+"
_OLC_SEPARATOR_POS = 8
_OLC_PAIR_LENGTH = 10
_OLC_GRID_ROWS, _OLC_GRID_COLS = 5, 4

_A = OLC_ALPHABET
# A full code: 8 digits, "+", then 0 or 2–7 more digits. Short codes
# drop 2, 4 or 6 leading digits.
_FULL_CODE_RE = re.compile(rf"^[{_A}]{{8}}\+(?:[{_A}]{{2,7}})?$")
_SHORT_CODE_RE = re.compile(rf"^(?:[{_A}]{{2}}|[{_A}]{{4}}|[{_A}]{{6}})\+[{_A}]{{2,7}}$")
# Finds a code at the start of free text: "9G8F+6W Banjul, The Gambia".
_CODE_IN_TEXT_RE = re.compile(rf"^\s*([{_A}{_A.lower()}]{{2,8}}\+[{_A}{_A.lower()}]{{0,7}})(?:[\s,]+(.*))?$")


def is_full_plus_code(code):
    code = (code or "").strip().upper()
    if not _FULL_CODE_RE.match(code):
        return False
    # First digit encodes latitude in 20° bands (max 180° → index 8);
    # second digit encodes longitude (max 360° → index 17).
    return _A.index(code[0]) * 20 < 180 and _A.index(code[1]) * 20 < 360


def is_short_plus_code(code):
    return bool(_SHORT_CODE_RE.match((code or "").strip().upper()))


def decode_plus_code(code):
    """Full Plus Code → (lat, lng) of the centre of its area."""
    code = (code or "").strip().upper()
    if not is_full_plus_code(code):
        raise ValueError(f"Not a full Plus Code: {code!r}")
    digits = code.replace(_OLC_SEPARATOR, "")

    lat, lng = -90.0, -180.0
    lat_size = lng_size = 20.0
    place = 20.0
    for i in range(0, min(len(digits), _OLC_PAIR_LENGTH), 2):
        lat += _A.index(digits[i]) * place
        lng += _A.index(digits[i + 1]) * place
        lat_size = lng_size = place
        place /= 20.0
    for ch in digits[_OLC_PAIR_LENGTH:]:
        row, col = divmod(_A.index(ch), _OLC_GRID_COLS)
        lat_size /= _OLC_GRID_ROWS
        lng_size /= _OLC_GRID_COLS
        lat += row * lat_size
        lng += col * lng_size

    return (min(lat + lat_size / 2, 90.0), _normalise_lng(lng + lng_size / 2))


def encode_plus_code(lat, lng):
    """(lat, lng) → 10-digit full Plus Code, e.g. '7C559G8F+6W' (~14 m square)."""
    lat = max(-90.0, min(90.0, float(lat)))
    lng = _normalise_lng(float(lng))
    # Work in integer units of the 10-digit resolution (1/8000 degree)
    # so boundaries don't wobble with floating-point error.
    scale = 20 ** 3
    lat_val = min(int(math.floor(round((lat + 90) * scale, 6))), 180 * scale - 1)
    lng_val = int(math.floor(round((lng + 180) * scale, 6))) % (360 * scale)
    pairs = []
    for _ in range(_OLC_PAIR_LENGTH // 2):
        pairs.append(_A[lat_val % 20] + _A[lng_val % 20])
        lat_val //= 20
        lng_val //= 20
    code = "".join(reversed(pairs))
    return code[:_OLC_SEPARATOR_POS] + _OLC_SEPARATOR + code[_OLC_SEPARATOR_POS:]


def recover_nearest(short_code, ref_lat, ref_lng):
    """Short Plus Code + a nearby point → (lat, lng) of the nearest match."""
    short_code = short_code.strip().upper()
    if is_full_plus_code(short_code):
        return decode_plus_code(short_code)
    if not is_short_plus_code(short_code):
        raise ValueError(f"Not a Plus Code: {short_code!r}")

    ref_lat = max(-90.0, min(90.0, float(ref_lat)))
    ref_lng = _normalise_lng(float(ref_lng))
    missing = _OLC_SEPARATOR_POS - short_code.index(_OLC_SEPARATOR)
    resolution = 20.0 ** (2 - missing / 2)
    half = resolution / 2.0
    prefix = encode_plus_code(ref_lat, ref_lng).replace(_OLC_SEPARATOR, "")[:missing]
    lat, lng = decode_plus_code(prefix + short_code)

    # The prefix came from the reference cell; the true location may be
    # in the neighbouring cell if the reference sits near an edge.
    if ref_lat + half < lat and lat - resolution >= -90:
        lat -= resolution
    elif ref_lat - half > lat and lat + resolution <= 90:
        lat += resolution
    if ref_lng + half < lng:
        lng -= resolution
    elif ref_lng - half > lng:
        lng += resolution
    return lat, _normalise_lng(lng)


def _normalise_lng(lng):
    while lng < -180:
        lng += 360
    while lng >= 180:
        lng -= 360
    return lng


# ═══════════════════════════════════════════════════════════════════
# Coordinates in text
# ═══════════════════════════════════════════════════════════════════

# One coordinate: degrees, optional minutes and seconds, and a
# hemisphere letter either before ("N 13.45") or after ("13.45N").
# Two patterns, so "N 13.45 W 16.57" can't read the W as belonging
# to the first number.
_NUM = r"""
    ([-+]?\d{1,3}(?:\.\d+)?)\s*(?:°|º|deg|d)?\s*
    (?:(\d{1,2}(?:\.\d+)?)\s*(?:'|′|’|m)\s*)?
    (?:(\d{1,2}(?:\.\d+)?)\s*(?:"|″|”|''|s)\s*)?
"""
_LEAD_PART = r"([NSEWnsew])\s*" + _NUM + r"()"
_TRAIL_PART = r"()" + _NUM + r"([NSEWnsew])?"
_COORDS_RES = [
    re.compile(rf"^\s*{part}\s*[,;/\s]\s*{part}\s*$", re.VERBOSE)
    for part in (_TRAIL_PART, _LEAD_PART)
]


def parse_coordinates(text):
    """'13.4549, -16.5790' (and DMS / hemisphere forms) → (lat, lng) or None."""
    m = next((m for m in (r.match(text or "") for r in _COORDS_RES) if m), None)
    if not m:
        return None
    g = [x or None for x in m.groups()]
    first = _part_to_degrees(*g[0:5])
    second = _part_to_degrees(*g[5:10])
    if first is None or second is None:
        return None
    (v1, h1), (v2, h2) = first, second
    lat_letters, lng_letters = ("N", "S"), ("E", "W")
    if h1 and h2 and ((h1 in lat_letters) == (h2 in lat_letters)):
        return None   # "N 13 N 16" — two latitudes, can't be a point
    # Hemisphere letters say which number is which; otherwise lat, lng.
    if h1 in ("E", "W") or h2 in ("N", "S"):
        (v1, h1), (v2, h2) = (v2, h2), (v1, h1)
    lat, lng = v1, v2
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return (lat, lng)


def _part_to_degrees(h_lead, deg, minutes, seconds, h_trail):
    hemi = (h_lead or h_trail or "").upper()
    if h_lead and h_trail and h_lead.upper() != h_trail.upper():
        return None
    try:
        value = abs(float(deg)) + float(minutes or 0) / 60 + float(seconds or 0) / 3600
    except ValueError:
        return None
    if minutes and float(minutes) >= 60 or seconds and float(seconds) >= 60:
        return None
    negative = deg.strip().startswith("-") or hemi in ("S", "W")
    return (-value if negative else value, hemi)


# ═══════════════════════════════════════════════════════════════════
# Google Maps links
# ═══════════════════════════════════════════════════════════════════

# Hosts we're willing to make a request to, purely to read their
# redirect. Anything else is parsed as-is and never fetched.
_SHORT_LINK_HOSTS = {"maps.app.goo.gl", "goo.gl", "g.co"}
_LATLNG = r"(-?\d{1,2}\.\d+)\s*,\s*\+?\s*(-?\d{1,3}\.\d+)"


def is_maps_link(text):
    try:
        u = urllib.parse.urlparse((text or "").strip())
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    if u.scheme not in ("http", "https"):
        return False
    if host in _SHORT_LINK_HOSTS:
        return True
    return ("google." in host and "/maps" in u.path) or host.startswith("maps.google.")


def parse_maps_url(url):
    """
    Pull a location out of a Google Maps URL.

    Returns ("point", (lat, lng)), ("text", "place name or plus code")
    or None. Prefers the place's own coordinates (!3d…!4d…) over the
    map's viewport centre (@lat,lng), which can be off by streets.
    """
    url = urllib.parse.unquote_plus(url or "")
    m = re.search(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", url)
    if m:
        return ("point", (float(m.group(1)), float(m.group(2))))
    m = re.search(r"[?&](?:q|query|ll|destination|daddr|center)=\s*" + _LATLNG, url)
    if m:
        return ("point", (float(m.group(1)), float(m.group(2))))
    m = re.search(r"/(?:place|search|dir)/[^/]*?" + _LATLNG, url)
    if m:
        return ("point", (float(m.group(1)), float(m.group(2))))
    m = re.search(r"@" + _LATLNG, url)
    if m:
        return ("point", (float(m.group(1)), float(m.group(2))))
    m = re.search(r"[?&](?:q|query|destination|daddr)=([^&]+)", url)
    if m and m.group(1).strip():
        return ("text", m.group(1).strip())
    m = re.search(r"/maps/(?:place|search)/([^/@?]+)", url)
    if m and m.group(1).strip():
        return ("text", m.group(1).strip())
    return None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def expand_short_link(url, *, opener=None, max_hops=4):
    """
    Follow a maps.app.goo.gl / goo.gl short link to the full Google Maps
    URL by reading Location headers. Only short-link hosts are ever
    requested; the first URL on another host is returned unfetched.
    """
    opener = opener or urllib.request.build_opener(_NoRedirect)
    current = url
    for _ in range(max_hops):
        host = (urllib.parse.urlparse(current).hostname or "").lower()
        if host not in _SHORT_LINK_HOSTS or not current.startswith("https://"):
            return current
        req = urllib.request.Request(current, method="GET", headers={"User-Agent": _user_agent()})
        try:
            resp = opener.open(req, timeout=6)
            location = resp.headers.get("Location")
            resp.close()
        except urllib.error.HTTPError as e:     # 3xx surfaces here with _NoRedirect
            location = e.headers.get("Location") if e.headers else None
        except (urllib.error.URLError, OSError, ValueError) as e:
            raise LookupUnavailable("We couldn't open that short link right now.") from e
        if not location:
            return current
        current = urllib.parse.urljoin(current, location)
    return current


# ═══════════════════════════════════════════════════════════════════
# Address search (geocoding)
# ═══════════════════════════════════════════════════════════════════

class LookupUnavailable(Exception):
    """The geocoding service couldn't be reached or refused the request."""


@dataclass
class Place:
    lat: float
    lng: float
    label: str
    plus_code: str = ""

    def as_json(self):
        d = asdict(self)
        d["lat"] = round(self.lat, 6)
        d["lng"] = round(self.lng, 6)
        d["plus_code"] = self.plus_code or encode_plus_code(self.lat, self.lng)
        return d


def _user_agent():
    # Nominatim's usage policy asks every app to identify itself.
    return os.environ.get("GEOCODER_USER_AGENT") or "KnockKnock-Attendance/1.0 (venue lookup)"


def _google_key():
    return os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()


def _http_json(url, *, timeout=6):
    req = urllib.request.Request(url, headers={
        "User-Agent": _user_agent(), "Accept": "application/json",
        "Accept-Language": "en",
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise LookupUnavailable("Address search is unavailable right now.") from e


def _nominatim_throttle():
    # Nominatim allows at most one request per second per application.
    for _ in range(12):
        if cache.add("kk-geo-nominatim-slot", 1, timeout=1):
            return
        time.sleep(0.1)


def _cached(key_parts, fn, ttl=60 * 60 * 24):
    key = "kk-geo:" + hashlib.sha1(json.dumps(key_parts).encode()).hexdigest()
    hit = cache.get(key)
    if hit is not None:
        return hit
    value = fn()
    cache.set(key, value, ttl)
    return value


def geocode(query, *, near=None, limit=5):
    """Address / place name → list[Place], best match first."""
    query = (query or "").strip()
    if not query:
        return []
    near_key = (round(near[0], 1), round(near[1], 1)) if near else None
    key = _google_key()

    def run():
        if key:
            return [p.as_json() for p in _google_geocode(query, near, limit, key)]
        return [p.as_json() for p in _nominatim_geocode(query, near, limit)]

    rows = _cached(["geocode", "google" if key else "osm", query.lower(), near_key, limit], run)
    return [Place(r["lat"], r["lng"], r["label"], r["plus_code"]) for r in rows]


def reverse_geocode(lat, lng):
    """(lat, lng) → a readable address, or "" if none could be found."""
    key = _google_key()

    def run():
        if key:
            params = {"latlng": f"{lat:.6f},{lng:.6f}", "key": key}
            data = _http_json("https://maps.googleapis.com/maps/api/geocode/json?"
                              + urllib.parse.urlencode(params))
            results = data.get("results") or []
            return results[0].get("formatted_address", "") if results else ""
        _nominatim_throttle()
        params = {"format": "jsonv2", "lat": f"{lat:.6f}", "lon": f"{lng:.6f}", "zoom": 18}
        data = _http_json("https://nominatim.openstreetmap.org/reverse?"
                          + urllib.parse.urlencode(params))
        return (data or {}).get("display_name", "") if isinstance(data, dict) else ""

    return _cached(["reverse", "google" if key else "osm", round(lat, 5), round(lng, 5)], run)


def _nominatim_geocode(query, near, limit):
    _nominatim_throttle()
    params = {"format": "jsonv2", "q": query, "limit": limit, "accept-language": "en"}
    if near:
        # Prefer results around the map's current area without excluding
        # the rest of the world (bounded=0).
        lat, lng = near
        params["viewbox"] = f"{lng - 1},{lat + 1},{lng + 1},{lat - 1}"
        params["bounded"] = 0
    data = _http_json("https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode(params))
    places = []
    for row in data if isinstance(data, list) else []:
        try:
            places.append(Place(float(row["lat"]), float(row["lon"]), row.get("display_name", query)))
        except (KeyError, TypeError, ValueError):
            continue
    return places


def _google_geocode(query, near, limit, key):
    params = {"address": query, "key": key}
    if near:
        lat, lng = near
        params["bounds"] = f"{lat - 1},{lng - 1}|{lat + 1},{lng + 1}"
    data = _http_json("https://maps.googleapis.com/maps/api/geocode/json?" + urllib.parse.urlencode(params))
    status = data.get("status")
    if status not in ("OK", "ZERO_RESULTS"):
        raise LookupUnavailable(f"Google address search failed ({status}).")
    places = []
    for row in (data.get("results") or [])[:limit]:
        loc = (row.get("geometry") or {}).get("location") or {}
        if "lat" in loc and "lng" in loc:
            places.append(Place(float(loc["lat"]), float(loc["lng"]),
                                row.get("formatted_address", query)))
    return places


# ═══════════════════════════════════════════════════════════════════
# One entry point for the event form's search box
# ═══════════════════════════════════════════════════════════════════

def resolve(text, *, near=None):
    """
    Whatever the organizer typed → {"kind": ..., "results": [...], "message": ...}

    kind is one of: "plus_code", "coordinates", "maps_link", "address".
    For the first three there's exactly one result (an exact point); for
    "address" there can be several candidates to choose from. `near` is
    the (lat, lng) of the organizer's map, used to place short Plus
    Codes and to rank address results nearby.
    """
    text = (text or "").strip()[:500]
    if not text:
        return {"kind": "empty", "results": [], "message": "Type an address, Plus Code, coordinates or a Google Maps link."}

    # 1. Plus Code, optionally followed by a town: "9G8F+6W Banjul".
    m = _CODE_IN_TEXT_RE.match(text)
    if m and (is_full_plus_code(m.group(1)) or is_short_plus_code(m.group(1))):
        code, locality = m.group(1).upper(), (m.group(2) or "").strip()
        if is_full_plus_code(code):
            lat, lng = decode_plus_code(code)
            return _point("plus_code", lat, lng, f"Plus Code {code}")
        ref = near
        if locality:
            towns = geocode(locality, near=near, limit=1)
            if not towns:
                return {"kind": "plus_code", "results": [],
                        "message": f"We couldn't find “{locality}” to place that Plus Code. "
                                   "Try the full code (8 characters before the +)."}
            ref = (towns[0].lat, towns[0].lng)
        if not ref:
            return {"kind": "plus_code", "results": [],
                    "message": "Add the town after a short Plus Code, like “9G8F+6W Banjul”."}
        lat, lng = recover_nearest(code, *ref)
        return _point("plus_code", lat, lng, f"Plus Code {code}{' ' + locality if locality else ''}")

    # 2. Plain coordinates.
    coords = parse_coordinates(text)
    if coords:
        return _point("coordinates", coords[0], coords[1], f"{coords[0]:.6f}, {coords[1]:.6f}")

    # 3. Google Maps link (short links are expanded first).
    if is_maps_link(text):
        url = text
        host = (urllib.parse.urlparse(url).hostname or "").lower()
        if host in _SHORT_LINK_HOSTS:
            url = expand_short_link(url)
        found = parse_maps_url(url)
        if found and found[0] == "point":
            lat, lng = found[1]
            if -90 <= lat <= 90 and -180 <= lng <= 180:
                return _point("maps_link", lat, lng, "Google Maps link")
        if found and found[0] == "text":
            inner = resolve(found[1], near=near)
            inner["kind"] = "maps_link"
            return inner
        return {"kind": "maps_link", "results": [],
                "message": "That link doesn't contain a location. In Google Maps, tap the place, "
                           "then Share, and paste that link."}

    # 4. Address or place name.
    places = geocode(text, near=near)
    if not places:
        return {"kind": "address", "results": [],
                "message": f"No places found for “{text}”. Try a nearby landmark or town, "
                           "a Plus Code, or tap the map."}
    return {"kind": "address", "results": [p.as_json() for p in places], "message": ""}


def _point(kind, lat, lng, label):
    return {"kind": kind, "results": [Place(lat, lng, label).as_json()], "message": ""}
