"""
kura/basemap.py — one place that decides which map tiles Kura draws.

Background: CARTO began requiring an API key on their raster basemap
endpoint (basemaps.cartocdn.com/rastertiles/…) in late August 2026.
Unauthenticated requests still resolve, but every tile comes back stamped
"API KEY REQUIRED", which is what you are seeing. Nothing is broken and no
data is affected — it is the background imagery only.

Kura had that URL hardcoded in five templates. This module replaces all of
them so the next time a tile provider changes its terms it is one setting,
not a hunt through the templates.

Configure in settings.py:

    KURA_BASEMAP      = "auto"   # auto | carto | carto_dark | osm | custom
    KURA_BASEMAP_KEY  = ""       # free CARTO key — carto.com/basemaps/apikey
    KURA_BASEMAP_URL  = ""       # full Leaflet URL template, for "custom"
    KURA_BASEMAP_ATTRIBUTION = ""
    KURA_BASEMAP_SUBDOMAINS  = ""
    KURA_BASEMAP_MAX_ZOOM    = 19
    KURA_BASEMAP_DARKEN      = None   # None = decide from the provider

"auto" uses CARTO when a key is set and OpenStreetMap when it is not, so
the app works out of the box and gets prettier the moment you paste a key
in. The CARTO key is free (5 million tiles a month) and arrives by email
with no approval queue.

A note on OpenStreetMap's own tiles: they are genuinely free and need no
key, but OSM's tile usage policy is aimed at modest, non-commercial use.
For a product serving election-night dashboards to many screens, get the
CARTO key or self-host — do not lean on tile.openstreetmap.org at volume.
"""

from __future__ import annotations

from django.conf import settings

OSM_ATTRIBUTION = (
    '&copy; <a href="https://www.openstreetmap.org/copyright">'
    "OpenStreetMap</a> contributors"
)
CARTO_ATTRIBUTION = (
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, '
    '&copy; <a href="https://carto.com/attributions">CARTO</a>'
)

PROVIDERS = {
    # Keyless. Bright cartography, so dark themes get the tile filter.
    "osm": {
        "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "subdomains": "",            # OSM asks you not to use a,b,c any more
        "max_zoom": 19,
        "attribution": OSM_ATTRIBUTION,
        "needs_key": False,
        "darken": True,
    },
    # The look Kura was built around. Needs a free key since Aug 2026.
    "carto": {
        "url": "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
        "subdomains": "abcd",
        "max_zoom": 20,
        "attribution": CARTO_ATTRIBUTION,
        "needs_key": True,
        "darken": False,
    },
    # Better match for the studio/ops themes if you have a key.
    "carto_dark": {
        "url": "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        "subdomains": "abcd",
        "max_zoom": 20,
        "attribution": CARTO_ATTRIBUTION,
        "needs_key": True,
        "darken": False,
    },
}


def basemap_config():
    """Resolve the tile layer this install should use.

    Returns a dict the templates hand almost verbatim to L.tileLayer.
    """
    choice = getattr(settings, "KURA_BASEMAP", "auto") or "auto"
    key = (getattr(settings, "KURA_BASEMAP_KEY", "") or "").strip()

    if choice == "custom" or getattr(settings, "KURA_BASEMAP_URL", ""):
        url = getattr(settings, "KURA_BASEMAP_URL", "")
        if not url:
            raise ValueError(
                'KURA_BASEMAP = "custom" needs KURA_BASEMAP_URL to be set.'
            )
        return {
            "provider": "custom",
            "url": url,
            "subdomains": getattr(settings, "KURA_BASEMAP_SUBDOMAINS", ""),
            "max_zoom": int(getattr(settings, "KURA_BASEMAP_MAX_ZOOM", 19)),
            "attribution": getattr(settings, "KURA_BASEMAP_ATTRIBUTION", ""),
            "darken": bool(getattr(settings, "KURA_BASEMAP_DARKEN", False)),
            "warning": "",
        }

    if choice == "auto":
        choice = "carto" if key else "osm"

    spec = dict(PROVIDERS.get(choice) or PROVIDERS["osm"])

    warning = ""
    if spec["needs_key"] and not key:
        # Fall back rather than serve watermarked tiles. Silently rendering
        # "API KEY REQUIRED" across an ops screen is the worse outcome.
        spec = dict(PROVIDERS["osm"])
        choice = "osm"
        warning = (
            "CARTO basemaps require an API key since August 2026 — falling "
            "back to OpenStreetMap tiles. Set KURA_BASEMAP_KEY to a free key "
            "from https://carto.com/basemaps/apikey/"
        )

    url = spec["url"]
    if key and spec["needs_key"]:
        url = f"{url}?key={key}"

    darken = getattr(settings, "KURA_BASEMAP_DARKEN", None)
    return {
        "provider": choice,
        "url": url,
        "subdomains": spec["subdomains"],
        "max_zoom": spec["max_zoom"],
        "attribution": spec["attribution"],
        "darken": spec["darken"] if darken is None else bool(darken),
        "warning": warning,
    }
