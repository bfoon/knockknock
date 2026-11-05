# Kura Geo Studio

AI-assisted mapping inside Kura, at **/kura/geo/**. You can also reach it from the
**🗺 Geo** button in the survey builder (it opens or creates that survey's map) and from **Geo Studio** on the Kura survey list.

## What it does

| Area | What you get |
|---|---|
| **Draw & style** | Icons (56 emoji markers), text labels, lines, polygons, boxes, circles. Edit vertices, move, rotate, cut holes, measure distance and area, undo. Each shape has a colour, fill, opacity, width, dash, category, layer, notes and custom fields. |
| **AI search bar** | One box for a place name (OpenStreetMap), a Location ID, a plus code, coordinates, or a command such as *"draw a 5 ha circle at Brikama called Nursery"*, *"count the trees in view"*, *"colour all mangroves dark green"* or *"show parcels bigger than 2 ha"*. A built-in parser handles common phrasings with no AI. Anything else goes to Gemini, which may only reply with a fixed set of safe actions. |
| **Analysis** | Trees and canopy, solar panels, or land cover, over the selected shape or the current view. **Pixel engine** (offline, deterministic): Excess-Green canopy, crown counting, water, built and bare land, and rectangular dark-panel detection that gives m² and kWp. **AI vision** (Gemini): labelled boxes for palm, mangrove, tree, solar and building, plus a written reading of the scene. **Hybrid** runs both. The analysed pixels are saved and SHA-256 fingerprinted as evidence. |
| **Drone imagery** | Upload a JPEG/PNG orthophoto with its bounds. It is pinned to the map and can be analysed at full drone resolution. |
| **Carbon MRV** | Turn an area into an asset (mangrove, palm, forest, agroforestry, cashew or solar). It shows credits to date, removals per year, standing stock, value, area-vs-claim and tree-survival checks, a canopy timeline across monitoring runs, and a methodology hint. All factors can be edited per asset. These are screening numbers, not issued credits. |
| **Location IDs** | `GM-XXXX-XXXX-C`, minted from the SHA-256 of the boundary (Crockford base-32 plus a mod-37 check letter, so a mistyped ID is rejected). Registration checks for overlaps. Allocation, transfer, verification, dispute, subdivision and retirement are recorded in a **hash-chained ledger**. The public certificate at `/kura/geo/id/<code>/` has a QR code, masks holder names and shows the integrity check. |
| **Geofencing & tracking** | Any shape can be a geofence. Share a tracker link with a phone: it streams GPS, and the studio shows enter/exit events live over WebSocket. A **Probe** tool tells you which geofence and Location ID cover a clicked point. |
| **Kura data** | Import a survey's GPS points, mapper tracks and areas, and zones as layers. |
| **Outputs** | GeoJSON, KML and CSV (with hectares and IDs), PNG of the view, a printable MRV report, and a public share link with a QR code. |

## Settings (.env), all optional

```
GEMINI_API_KEY=…                # already used by Hanns / Foon — turns on AI vision + AI commands
GEO_ID_PREFIX=GM                # Location ID prefix
GEO_IMAGERY_URL=https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}
GEO_IMAGERY_ATTRIBUTION=Imagery © Esri, Maxar, Earthstar Geographics
GEO_IMAGERY_MAX_ZOOM=19
GEO_MAX_TILES=100               # per analysis (~2560×2560 px)
```

Check the imagery provider's terms before selling anything derived from its imagery. For credit-grade
evidence, fly a drone and upload the orthophoto, or point `GEO_IMAGERY_URL` at a licensed source.

## Deploy

* New app `kura.geostudio` (label `kura_geo`) with its **own** migrations folder. Its only Kura dependency is
  `kura.0001_initial`, so it never collides with the Kura migrations the server generates.
  `docker compose` already runs `migrate` on start.
* No new Python packages. It uses numpy, scipy and Pillow, which are already in requirements.txt.
* Analyses can take 10–60 s with AI vision. If nginx cuts them off, give `/kura/geo/` the same
  `proxy_read_timeout 180s` as `/hanns/`.

Tests: `python manage.py test kura.geostudio` (27 tests).
