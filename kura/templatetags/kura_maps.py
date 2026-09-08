"""
kura/templatetags/kura_maps.py — {% kura_basemap %}

Drop this once in the <head> of any template that draws a Leaflet map and
every ``L.tileLayer(...)`` call in that page becomes:

    KURA_BASEMAP.addTo(map);

Emitting a small JS object rather than a Django context variable keeps the
templates free of provider details: swapping tile providers is a settings
change and nothing else has to be touched.
"""

from __future__ import annotations

import json

from django import template
from django.utils.safestring import mark_safe

from basemap import basemap_config

register = template.Library()


@register.simple_tag
def kura_basemap():
    cfg = basemap_config()

    options = {
        "maxZoom": cfg["max_zoom"],
        "attribution": cfg["attribution"],
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
  layer: function(extra){{
    return L.tileLayer(this.url, Object.assign({{}}, this.options, extra || {{}}));
  }},
  addTo: function(map, extra){{
    // The darkening filter is applied to the map container, not the page,
    // so a light-themed board on the same install stays light.
    if(this.darken && map && map.getContainer)
      map.getContainer().classList.add("kura-dark-tiles");
    return this.layer(extra).addTo(map);
  }}
}};
{warning_js}
</script>""")
