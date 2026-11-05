"""
kura/geostudio/imagery.py — get a picture of an area of interest.

Two sources:

1. Satellite tiles (default Esri World Imagery, ~0.3–0.6 m in most of The
   Gambia at zoom 18–19). Tiles are fetched SERVER-side and stitched with
   Pillow, so there are no browser CORS problems and the exact pixels that
   were analysed can be frozen and hashed as evidence.
2. An uploaded drone / orthophoto image pinned to [west, south, east, north].

Either way the caller gets a `Frame`: a PIL RGB image plus a mapping between
image pixels and lon/lat (Web Mercator, the same projection Leaflet draws).

Settings (.env or settings.py):

    GEO_IMAGERY_URL   tile template, {z}/{x}/{y}  (default Esri World Imagery)
    GEO_IMAGERY_ATTRIBUTION
    GEO_IMAGERY_MAX_ZOOM   default 19
    GEO_MAX_TILES          default 100   (≈ 2560×2560 px ceiling)

Licensing: check the imagery provider's terms for analytical use before
selling anything derived from it. For credit-grade MRV, fly a drone and upload
the orthophoto, or point GEO_IMAGERY_URL at a licensed provider.
"""

from __future__ import annotations

import io
import math
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.core.cache import cache

from . import geo

ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
ESRI_ATTR = "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community"
UA = "KnockKnock-Kura-GeoStudio/1.0"


class ImageryError(Exception):
    pass


def _setting(name, default):
    v = getattr(settings, name, None)
    if v in (None, ""):
        v = os.environ.get(name, default)
    return v


def tile_url():
    return str(_setting("GEO_IMAGERY_URL", ESRI))


def attribution():
    return str(_setting("GEO_IMAGERY_ATTRIBUTION", ESRI_ATTR))


def max_zoom():
    try:
        return int(_setting("GEO_IMAGERY_MAX_ZOOM", 19))
    except (TypeError, ValueError):
        return 19


def max_tiles():
    try:
        return int(_setting("GEO_MAX_TILES", 100))
    except (TypeError, ValueError):
        return 100


class Frame:
    """An image + where it sits on Earth (normalised Mercator 0..1 box)."""

    def __init__(self, image, mx0, my0, mx1, my1, source, zoom=None):
        self.image = image
        self.mx0, self.my0, self.mx1, self.my1 = mx0, my0, mx1, my1
        self.source = source
        self.zoom = zoom

    @property
    def size(self):
        return self.image.size

    def to_lonlat(self, px, py):
        w, h = self.image.size
        mx = self.mx0 + (px / w) * (self.mx1 - self.mx0)
        my = self.my0 + (py / h) * (self.my1 - self.my0)
        lon = mx * 360.0 - 180.0
        lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * my))))
        return lon, lat

    def to_pixel(self, lon, lat):
        w, h = self.image.size
        mx, my = _merc(lon, lat)
        return ((mx - self.mx0) / (self.mx1 - self.mx0) * w, (my - self.my0) / (self.my1 - self.my0) * h)

    def bounds(self):
        """[[south, west], [north, east]] — Leaflet imageOverlay order."""
        w, h = self.image.size
        west, north = self.to_lonlat(0, 0)
        east, south = self.to_lonlat(w, h)
        return [[south, west], [north, east]]

    def metres_per_pixel(self):
        w, h = self.image.size
        lon0, lat0 = self.to_lonlat(0, h / 2)
        lon1, lat1 = self.to_lonlat(w, h / 2)
        return geo.haversine([lon0, lat0], [lon1, lat1]) / max(1, w)


def _merc(lon, lat):
    lat = max(-85.05112878, min(85.05112878, lat))
    s = math.sin(math.radians(lat))
    return (lon + 180.0) / 360.0, 0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)


def choose_zoom(bb, requested=None):
    """Highest zoom whose tile count stays under GEO_MAX_TILES."""
    top = min(max_zoom(), int(requested) if requested else max_zoom())
    for z in range(top, 9, -1):
        x0, y0 = geo.lonlat_to_pixel(bb[0], bb[3], z)
        x1, y1 = geo.lonlat_to_pixel(bb[2], bb[1], z)
        n = (int(x1 // 256) - int(x0 // 256) + 1) * (int(y1 // 256) - int(y0 // 256) + 1)
        if n <= max_tiles():
            return z
    return 10


def _fetch(url):
    key = "geo-tile:" + url
    hit = cache.get(key)
    if hit:
        return hit
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = r.read()
    except Exception:
        return None
    try:
        cache.set(key, data, 6 * 3600)
    except Exception:
        pass
    return data


def from_tiles(geometry, zoom=None, pad=0.05):
    from PIL import Image

    bb = geo.bbox(geometry)
    if not bb:
        raise ImageryError("That shape has no coordinates.")
    dx, dy = (bb[2] - bb[0]) * pad, (bb[3] - bb[1]) * pad
    bb = [bb[0] - dx, bb[1] - dy, bb[2] + dx, bb[3] + dy]
    z = choose_zoom(bb, zoom)
    px0, py0 = geo.lonlat_to_pixel(bb[0], bb[3], z)
    px1, py1 = geo.lonlat_to_pixel(bb[2], bb[1], z)
    tx0, ty0, tx1, ty1 = int(px0 // 256), int(py0 // 256), int(px1 // 256), int(py1 // 256)
    cols, rows = tx1 - tx0 + 1, ty1 - ty0 + 1
    if cols * rows > max_tiles() * 1.2:
        raise ImageryError("This area is too large to analyse in one go — draw a smaller area of interest.")

    tmpl = tile_url()
    jobs = [(x, y, tmpl.format(z=z, x=x, y=y, s="a")) for y in range(ty0, ty1 + 1) for x in range(tx0, tx1 + 1)]
    canvas = Image.new("RGB", (cols * 256, rows * 256), (0, 0, 0))
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda j: (j[0], j[1], _fetch(j[2])), jobs))
    got = 0
    for x, y, data in results:
        if not data:
            continue
        try:
            t = Image.open(io.BytesIO(data)).convert("RGB")
        except Exception:
            continue
        canvas.paste(t, ((x - tx0) * 256, (y - ty0) * 256))
        got += 1
    if got == 0:
        raise ImageryError("The imagery server didn't send any tiles. Check GEO_IMAGERY_URL or the server's internet access.")

    # crop to the padded bbox
    cx0, cy0 = int(px0 - tx0 * 256), int(py0 - ty0 * 256)
    cx1, cy1 = int(math.ceil(px1 - tx0 * 256)), int(math.ceil(py1 - ty0 * 256))
    img = canvas.crop((cx0, cy0, max(cx0 + 8, cx1), max(cy0 + 8, cy1)))
    s = 256 * 2 ** z
    gx0, gy0 = tx0 * 256 + cx0, ty0 * 256 + cy0
    return Frame(img, gx0 / s, gy0 / s, (gx0 + img.size[0]) / s, (gy0 + img.size[1]) / s,
                 source="satellite", zoom=z)


def from_upload(layer, geometry=None, max_side=3000):
    """Frame for an ImageryLayer, optionally cropped to an AOI's bbox."""
    from PIL import Image

    Image.MAX_IMAGE_PIXELS = 120_000_000
    with layer.file.open("rb") as fh:
        img = Image.open(fh)
        img.load()
    img = img.convert("RGB")
    w, s, e, n = [float(v) for v in layer.bounds]
    mx0, my0 = _merc(w, n)
    mx1, my1 = _merc(e, s)
    frame = Frame(img, mx0, my0, mx1, my1, source="upload")
    if geometry:
        bb = geo.bbox(geometry)
        if bb:
            ax, ay = frame.to_pixel(bb[0], bb[3])
            bx, by = frame.to_pixel(bb[2], bb[1])
            W, H = img.size
            ax, ay = max(0, int(ax)), max(0, int(ay))
            bx, by = min(W, int(math.ceil(bx))), min(H, int(math.ceil(by)))
            if bx - ax < 8 or by - ay < 8:
                raise ImageryError("The area of interest is outside that drone image.")
            nmx0 = frame.mx0 + ax / W * (frame.mx1 - frame.mx0)
            nmy0 = frame.my0 + ay / H * (frame.my1 - frame.my0)
            nmx1 = frame.mx0 + bx / W * (frame.mx1 - frame.mx0)
            nmy1 = frame.my0 + by / H * (frame.my1 - frame.my0)
            frame = Frame(img.crop((ax, ay, bx, by)), nmx0, nmy0, nmx1, nmy1, source="upload")
    W, H = frame.image.size
    if max(W, H) > max_side:
        k = max_side / max(W, H)
        frame.image = frame.image.resize((int(W * k), int(H * k)))
    return frame


def aoi_mask(frame, geometry, props=None):
    """Boolean numpy mask of pixels inside the area of interest."""
    import numpy as np
    from PIL import Image, ImageDraw

    w, h = frame.size
    m = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(m)
    props = props or {}
    t = geometry.get("type")
    if t == "Point" and props.get("radius"):
        geometry = geo.circle_polygon(geometry["coordinates"][0], geometry["coordinates"][1], float(props["radius"]))
        t = "Polygon"
    polys = []
    if t == "Polygon":
        polys = [geometry["coordinates"]]
    elif t == "MultiPolygon":
        polys = geometry["coordinates"]
    if not polys:
        return np.ones((h, w), dtype=bool)
    for poly in polys:
        outer = [frame.to_pixel(float(p[0]), float(p[1])) for p in poly[0]]
        if len(outer) >= 3:
            d.polygon(outer, fill=255)
        for hole in poly[1:]:
            pts = [frame.to_pixel(float(p[0]), float(p[1])) for p in hole]
            if len(pts) >= 3:
                d.polygon(pts, fill=0)
    return np.array(m) > 0
