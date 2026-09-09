"""
kura/templatetags/kura_maps.py — {% kura_basemap %}

Drop this once in the <head> of any template that draws a Leaflet map and
every ``L.tileLayer(...)`` call in that page becomes:

    KURA_BASEMAP.addTo(map);

Emitting a small JS object rather than a Django context variable keeps the
templates free of provider details: swapping tile providers is a settings
change and nothing else has to be touched.

Referrer policy
---------------
OpenStreetMap's tile servers return a 403 "Access blocked — Referer is
required" tile when a request arrives with no ``Referer`` header. Django's
SecurityMiddleware sets ``Referrer-Policy: same-origin`` by default, which
strips the header on every cross-origin request — so a stock Django install
pointed at tile.openstreetmap.org gets blocked out of the box.

Rather than loosening the policy site-wide, we set ``referrerPolicy`` on the
tile layer itself. Leaflet (>= 1.7) puts it on the generated <img> elements,
and an element-level referrerpolicy overrides the document policy for just
those requests. Everything else on the page keeps whatever
SECURE_REFERRER_POLICY says.
"""

from __future__ import annotations

import json

from django import template
from django.utils.safestring import mark_safe

from basemap import basemap_config

register = template.Library()

# Policies OSM accepts. `no-referrer` and `same-origin` are explicitly
# rejected; anything not in this set is either unknown to us or unsafe to
# assume, so we fall back to the default below.
# https://wiki.openstreetmap.org/wiki/Referer
REFERRER_POLICIES = {
    "no-referrer-when-downgrade",
    "origin",
    "origin-when-cross-origin",
    "strict-origin",
    "strict-origin-when-cross-origin",
}

DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin"


def _referrer_policy(cfg):
    """Pick the referrer policy for tile requests.

    A provider may override it via ``basemap_config()["referrer_policy"]``;
    an unrecognised or policy-violating value is ignored rather than passed
    through, because the failure mode is a wall of 403 tiles on a projector.
    """
    requested = (cfg.get("referrer_policy") or "").strip()
    if requested in REFERRER_POLICIES:
        return requested
    return DEFAULT_REFERRER_POLICY


@register.simple_tag
def kura_basemap():
    cfg = basemap_config()

    options = {
        "maxZoom": cfg["max_zoom"],
        "attribution": cfg["attribution"],
        "referrerPolicy": _referrer_policy(cfg),
    }
    if cfg["subdomains"]:
        options["subdomains"] = cfg["subdomains"]

    # Bright tiles under a dark UI look wrong, so invert the tile pane only.
    # Filtering the whole map container would invert the markers with it.
    darken_css = """
<style>
.kura-dark-tiles .leaflet-tile-pane{
  filter:invert(1) hue-rotate(180deg) brightness(.86) contrast(1.05) saturate(.7);
}
</style>""" if cfg["darken"] else ""

    warning_js = (
        f'console.warn({json.dumps(cfg["warning"])});' if cfg["warning"] else ""
    )

    return mark_safe(f"""{darken_css}
<script>
window.KURA_BASEMAP = {{
  provider: {json.dumps(cfg["provider"])},
  url: {json.dumps(cfg["url"])},
  options: {json.dumps(options)},
  darken: {json.dumps(cfg["darken"])},
  attribution: {json.dumps(cfg["attribution"])},
  layer: function(extra){{
    var opts = Object.assign({{}}, this.options, extra || {{}});
    // Never let a caller drop the referrer policy: without it the OSM
    // servers answer every tile with a 403 placeholder.
    if(!opts.referrerPolicy) opts.referrerPolicy = this.options.referrerPolicy;
    return L.tileLayer(this.url, opts);
  }},
  addTo: function(map, extra){{
    // The darkening filter is applied to the map container, not the page,
    // so a light-themed board on the same install stays light.
    if(this.darken && map && map.getContainer)
      map.getContainer().classList.add("kura-dark-tiles");
    var layer = this.layer(extra).addTo(map);
    // Boards that build the map with {{attributionControl:false}} still owe
    // the provider a credit, so put one back if the control is missing.
    if(map && !map.attributionControl && L.control && L.control.attribution){{
      L.control.attribution({{prefix:false}})
        .addAttribution(this.attribution)
        .addTo(map);
    }}
    return layer;
  }}
}};
{warning_js}
</script>""")
