/* ════════════════════════════════════════════════════════════════════
   KURA MAPPER — the `mapper` question type for the Kura web runner
   ════════════════════════════════════════════════════════════════════
   Three ways to answer, each switchable by the form designer:

   🚶 Trace a route   Start → walk / ride / drive → Finish. GPS is recorded
                      live (accuracy-filtered, spike-rejected, simplified)
                      into a LineString with distance, time and speed.
   ⬡  Walk an area    Walk or drive around a field, compound, village… The
                      path closes into a polygon geofence with its area. A
                      "you're back at the start" cue tells you when to finish.
   ✏️ Draw on map     Polygons, rectangles, circles, lines and pins — as many
                      as allowed, each with its own colour and label.

   Field-proof:
   • the in-progress trace is saved on the phone after every point — a
     reload, a call or a dead tab resumes where you left off
   • keeps the screen awake while recording (Wake Lock) and warns on weak GPS
   • the map survives the runner's full re-renders: each question's map lives
     in a registry and is re-attached, so recording never stops
   • satellite / streets / terrain basemaps (keyless Esri)

   The answer is GeoJSON (FeatureCollection). The server (kura/geo.py)
   rebuilds and re-measures it, so the numbers can't be faked.

   API:  KuraMapper.hydrate(rootEl, {get(path), set(path, value), zones, surveyCode, onChange})
         KuraMapper.render(mapEl, featureCollection, {zones})   — read-only display
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const CDN = {
    css: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
    js: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
    drawCss: "https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css",
    drawJs: "https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js",
  };
  const PALETTE = ["#22d3ee", "#f472b6", "#a3e635", "#fbbf24", "#f97316", "#a78bfa", "#ef4444", "#ffffff"];
  const MODES = {
    track: { icon: "🚶", label: "Trace a route", tip: "Record a path live as you walk, ride or drive." },
    area: { icon: "⬡", label: "Walk an area", tip: "Walk or drive around the boundary — it closes into a geofence." },
    draw: { icon: "✏️", label: "Draw on map", tip: "Draw polygons, rectangles, circles, lines or pins." },
  };

  // ───────────────────────── loading ─────────────────────────
  const loaded = {};
  function loadCss(href) { if (document.querySelector(`link[href="${href}"]`)) return; const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l); }
  function loadJs(src) {
    if (loaded[src]) return loaded[src];
    return (loaded[src] = new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Map library failed to load — check the internet connection."));
      document.head.appendChild(s);
    }));
  }
  async function ensureLeaflet(withDraw) {
    loadCss(CDN.css);
    if (!window.L) await loadJs(CDN.js);
    if (withDraw) {
      loadCss(CDN.drawCss);
      if (!(window.L && L.Draw)) await loadJs(CDN.drawJs);
      patchDraw();
    }
  }
  // Same fix the builder applies: leaflet-draw 1.0.4 circle resize bug (#945/#967/#1013).
  let patched = false;
  function patchDraw() {
    if (patched || !(window.L && L.Edit && L.Edit.Circle)) return;
    patched = true;
    L.Edit.Circle.prototype._resize = function (latlng) {
      const radius = this._map.distance(this._moveMarker.getLatLng(), latlng);
      this._shape.setRadius(radius);
      this._map.fire(L.Draw.Event.EDITRESIZE, { layer: this._shape });
    };
  }

  // ───────────────────────── maths ─────────────────────────
  const R = 6371008.8;
  const rad = d => d * Math.PI / 180;
  function dist(a, b) { // [lng,lat]
    const p1 = rad(a[1]), p2 = rad(b[1]), dp = p2 - p1, dl = rad(b[0] - a[0]);
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  const pathLen = c => c.reduce((s, p, i) => i ? s + dist(c[i - 1], p) : 0, 0);
  function ringArea(ring) {
    if (ring.length < 3) return 0;
    const r = ring.concat([ring[0]]);
    let t = 0;
    for (let i = 0; i < r.length - 1; i++) t += rad(r[i + 1][0] - r[i][0]) * (2 + Math.sin(rad(r[i][1])) + Math.sin(rad(r[i + 1][1])));
    return Math.abs(t * R * R / 2);
  }
  // Ramer–Douglas–Peucker in local metres; keeps timestamps of kept points.
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const lat0 = rad(pts[0][1]), kx = Math.cos(lat0) * 111320, ky = 110540;
    const xy = pts.map(p => [p[0] * kx, p[1] * ky]);
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop(); let idx = -1, max = 0;
      const [x1, y1] = xy[a], [x2, y2] = xy[b], dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1e-9;
      for (let i = a + 1; i < b; i++) {
        const t = Math.max(0, Math.min(1, ((xy[i][0] - x1) * dx + (xy[i][1] - y1) * dy) / L2));
        const d = Math.hypot(xy[i][0] - (x1 + t * dx), xy[i][1] - (y1 + t * dy));
        if (d > max) { max = d; idx = i; }
      }
      if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 1 : 2) + " km" : Math.round(m) + " m"; }
  function fmtArea(m2) { return m2 >= 10000 ? (m2 / 10000).toFixed(m2 >= 1e6 ? 1 : 2) + " ha" : Math.round(m2).toLocaleString() + " m²"; }
  function fmtTime(s) { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); }
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function featureStats(f) {
    const g = f.geometry, p = f.properties || {};
    if (g.type === "LineString") return { distance: pathLen(g.coordinates) };
    if (g.type === "Polygon") { const r = g.coordinates[0].slice(0, -1); return { area: ringArea(r), perimeter: pathLen(g.coordinates[0]) }; }
    if (p.shape === "circle") return { area: Math.PI * p.radius_m ** 2, perimeter: 2 * Math.PI * p.radius_m };
    return {};
  }
  function statsText(f) {
    const s = featureStats(f), p = f.properties || {}, bits = [];
    if (s.distance != null) bits.push("📏 " + fmtDist(s.distance));
    if (s.area != null) bits.push("⬡ " + fmtArea(s.area));
    if (s.perimeter != null && f.geometry.type !== "LineString") bits.push("↻ " + fmtDist(s.perimeter));
    if (p.duration_s) bits.push("⏱ " + fmtTime(p.duration_s));
    if (p.shape === "point") bits.push("📍 " + f.geometry.coordinates[1].toFixed(5) + ", " + f.geometry.coordinates[0].toFixed(5));
    return bits.join(" · ");
  }

  // ───────────────────────── basemaps ─────────────────────────
  const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  const BASES = {
    streets: ["🛣 Streets", "World_Street_Map", 19, "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors"],
    satellite: ["🛰 Satellite", "World_Imagery", 19, "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics"],
    terrain: ["🏔 Terrain", "World_Topo_Map", 19, "Tiles © Esri — Esri, HERE, Garmin, © OpenStreetMap contributors"],
  };
  function baseLayer(key) {
    const b = BASES[key] || BASES.satellite;
    return L.tileLayer(ESRI + b[1] + "/MapServer/tile/{z}/{y}/{x}", { maxZoom: 21, maxNativeZoom: b[2], attribution: b[3] });
  }

  function zonesLayer(zones) {
    const g = L.featureGroup();
    (zones || []).forEach(z => {
      const color = /^#[0-9a-f]{3,8}$/i.test(z.color || "") ? z.color : "#22d3ee";
      const st = { color, weight: 2, dashArray: "6 6", fillColor: color, fillOpacity: z.fill_opacity != null ? +z.fill_opacity : 0.08, interactive: true };
      let l = null;
      if (z.kind === "polygon" && (z.points || []).length >= 3) l = L.polygon(z.points.map(p => [+p[0], +p[1]]), st);
      else if (z.lat != null && z.lng != null) l = L.circle([+z.lat, +z.lng], Object.assign({ radius: (+z.radius_km || 1) * 1000 }, st));
      if (l) { l.bindTooltip("Zone: " + esc(z.name || z.id)); g.addLayer(l); }
    });
    return g;
  }

  function styleOf(f) {
    const color = (f.properties && f.properties.color) || PALETTE[0];
    const kind = f.properties && f.properties.kind;
    return { color, weight: kind === "track" ? 5 : 3, opacity: 0.95, fillColor: color, fillOpacity: 0.22, lineCap: "round", lineJoin: "round" };
  }
  function featureLayer(f) {
    const g = f.geometry, p = f.properties || {}, st = styleOf(f);
    if (g.type === "LineString") return L.polyline(g.coordinates.map(c => [c[1], c[0]]), st);
    if (g.type === "Polygon") return L.polygon(g.coordinates[0].slice(0, -1).map(c => [c[1], c[0]]), st);
    if (p.shape === "circle") return L.circle([g.coordinates[1], g.coordinates[0]], Object.assign({ radius: p.radius_m }, st));
    return L.circleMarker([g.coordinates[1], g.coordinates[0]], Object.assign({}, st, { radius: 8, fillOpacity: 0.9, weight: 3 }));
  }

  // ═════════════════════════ the question widget ═════════════════════════
  const registry = new Map();   // path → Mapper instance (survives runner re-renders)

  class Mapper {
    constructor(path, cfg, opts) {
      this.path = path;
      this.cfg = Object.assign({ modes: ["track", "area", "draw"], accuracy_m: 30, step_m: 3, max_features: 10, basemap: "satellite", show_zones: true }, cfg || {});
      this.cfg.modes = (this.cfg.modes || []).filter(m => MODES[m]);
      if (!this.cfg.modes.length) this.cfg.modes = ["track", "area", "draw"];
      this.opts = opts;
      this.mode = this.cfg.modes.includes(this.cfg.default_mode) ? this.cfg.default_mode : this.cfg.modes[0];
      this.color = PALETTE[0];
      const v = opts.get(path);
      this.features = (v && Array.isArray(v.features)) ? v.features.slice() : [];
      this.rec = null;           // live recording state
      this.storeKey = "kmapper:" + (opts.surveyCode || location.pathname) + ":" + path;
      this.build();
    }

    // ── UI ──
    build() {
      const r = this.root = document.createElement("div");
      r.className = "kmp";
      r.innerHTML = `
        ${this.cfg.modes.length > 1 ? `<div class="kmp-modes" role="tablist">${this.cfg.modes.map(m =>
          `<button type="button" role="tab" data-mode="${m}" title="${esc(MODES[m].tip)}"><span>${MODES[m].icon}</span>${MODES[m].label}</button>`).join("")}</div>` : ""}
        <div class="kmp-resume" hidden></div>
        <div class="kmp-mapwrap">
          <div class="kmp-map"><div class="kmp-loading">Loading map…</div></div>
          <div class="kmp-hud" hidden>
            <div><b data-s="dist">0 m</b><small>distance</small></div>
            <div data-area><b data-s="area">—</b><small>area</small></div>
            <div><b data-s="time">0:00</b><small>time</small></div>
            <div><b data-s="speed">0</b><small>km/h</small></div>
          </div>
          <div class="kmp-gps" hidden><i></i><span>GPS</span></div>
          <div class="kmp-tools">
            <button type="button" data-act="base" title="Change map style">🛰</button>
            <button type="button" data-act="locate" title="Show my location">◎</button>
            <button type="button" data-act="follow" class="on" title="Follow me while recording" hidden>➤</button>
            <button type="button" data-act="full" title="Full screen">⛶</button>
          </div>
          <div class="kmp-toast" hidden></div>
        </div>
        <div class="kmp-ctrl"></div>
        <div class="kmp-palette" hidden>${PALETTE.map(c => `<button type="button" data-color="${c}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join("")}</div>
        <div class="kmp-list"></div>`;
      r.addEventListener("click", e => this.onClick(e));
      r.addEventListener("input", e => this.onInput(e));
      this.paintModes();
      this.paintCtrl();
      this.paintList();
      this.checkResume();
      this.initMap();
    }

    async initMap() {
      try { await ensureLeaflet(this.cfg.modes.includes("draw")); }
      catch (e) { this.$(".kmp-loading").textContent = e.message; return; }
      const el = this.$(".kmp-map");
      el.innerHTML = "";
      const map = this.map = L.map(el, { zoomControl: true, attributionControl: true, tap: false }).setView([13.45, -16.58], 9);
      this.baseKey = this.cfg.basemap in BASES ? this.cfg.basemap : "satellite";
      this.base = baseLayer(this.baseKey).addTo(map);
      if (this.cfg.show_zones !== false && (this.opts.zones || []).length) {
        this.zoneGroup = zonesLayer(this.opts.zones).addTo(map);
      }
      this.featGroup = L.featureGroup().addTo(map);
      this.drawn = L.featureGroup().addTo(map);       // editable layers in draw mode
      this.liveLine = L.polyline([], { color: "#fbbf24", weight: 6, opacity: 0.95, lineCap: "round" }).addTo(map);
      this.liveFill = L.polygon([], { color: "#fbbf24", weight: 0, fillOpacity: 0.18 }).addTo(map);
      this.closeLine = L.polyline([], { color: "#fbbf24", weight: 2, dashArray: "4 8", opacity: 0.9 }).addTo(map);
      this.me = L.marker([0, 0], { icon: L.divIcon({ className: "kmp-me", html: "<i></i><b></b>", iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false, keyboard: false });
      this.meAcc = L.circle([0, 0], { radius: 1, color: "#38bdf8", weight: 1, fillOpacity: 0.12, interactive: false });
      this.redrawFeatures(true);
      this.setupDraw();
      setTimeout(() => map.invalidateSize(), 50);
    }

    $(s) { return this.root.querySelector(s); }
    toast(msg, ms) {
      const t = this.$(".kmp-toast"); t.textContent = msg; t.hidden = false;
      clearTimeout(this._tt); this._tt = setTimeout(() => { t.hidden = true; }, ms || 3200);
    }

    paintModes() {
      this.root.querySelectorAll(".kmp-modes button").forEach(b => {
        const on = b.dataset.mode === this.mode;
        b.classList.toggle("on", on); b.setAttribute("aria-selected", on ? "true" : "false");
        b.disabled = !!this.rec && !on;
      });
      this.$(".kmp-palette").hidden = false;
      this.$(".kmp-hud [data-area]").hidden = this.mode !== "area";
    }

    paintCtrl() {
      const c = this.$(".kmp-ctrl"), full = this.features.length >= this.cfg.max_features;
      if (this.mode === "draw") {
        c.innerHTML = `<p class="kmp-tip">✏️ Use the drawing tools on the map (top-left): polygon, rectangle, circle, line or pin. Pick a colour first, then tap <b>Finish</b> on the map to close a shape.</p>
          ${full ? `<p class="kmp-warn">Maximum of ${this.cfg.max_features} shapes reached — delete one to add more.</p>` : ""}`;
        return;
      }
      const R = this.rec;
      if (!R) {
        c.innerHTML = `<button type="button" class="kmp-start" data-act="start" ${full ? "disabled" : ""}>
            <span class="kmp-pulse"></span>${this.mode === "area" ? "⬡ Start walking the boundary" : "▶ Start tracing"}</button>
          <p class="kmp-tip">${this.mode === "area"
            ? "Stand at a corner, tap Start, then walk (or drive) all the way around. Keep this screen open."
            : "Tap Start, then walk, ride or drive. Your path is drawn live. Keep this screen open."}</p>
          ${full ? `<p class="kmp-warn">Maximum of ${this.cfg.max_features} shapes reached.</p>` : ""}`;
      } else {
        c.innerHTML = `<div class="kmp-recbar ${R.paused ? "paused" : ""}">
            <span class="kmp-dot"></span><b>${R.paused ? "Paused" : "Recording"}</b><small>${R.pts.length} points</small></div>
          <div class="kmp-btnrow">
            <button type="button" data-act="${R.paused ? "resume" : "pause"}">${R.paused ? "▶ Resume" : "⏸ Pause"}</button>
            <button type="button" class="kmp-finish" data-act="finish">✔ Finish</button>
            <button type="button" class="kmp-cancel" data-act="cancel">✕ Discard</button>
          </div>`;
      }
    }

    paintList() {
      const host = this.$(".kmp-list");
      if (!this.features.length) { host.innerHTML = ""; return; }
      const tot = this.features.reduce((a, f) => { const s = featureStats(f); a.d += s.distance || 0; a.a += s.area || 0; return a; }, { d: 0, a: 0 });
      host.innerHTML = `<div class="kmp-total">${this.features.length} shape${this.features.length > 1 ? "s" : ""}${tot.d ? " · 📏 " + fmtDist(tot.d) : ""}${tot.a ? " · ⬡ " + fmtArea(tot.a) : ""}</div>` +
        this.features.map((f, i) => {
          const p = f.properties || {};
          const icon = p.kind === "track" ? "🚶" : p.kind === "area" ? "⬡" : ({ circle: "◯", rectangle: "▭", line: "〰", point: "📍" }[p.shape] || "▱");
          return `<div class="kmp-item" data-i="${i}">
            <button type="button" class="kmp-sw" data-act="recolor" data-i="${i}" style="--c:${esc(p.color || PALETTE[0])}" title="Change colour"></button>
            <div class="kmp-item-main">
              <input type="text" data-label="${i}" value="${esc(p.label || "")}" placeholder="${icon} ${p.kind === "track" ? "Route" : p.kind === "area" ? "Area" : "Shape"} ${i + 1} — add a name">
              <small>${esc(statsText(f))}</small>
            </div>
            <button type="button" data-act="zoom" data-i="${i}" title="Zoom to">⌖</button>
            <button type="button" data-act="del" data-i="${i}" title="Delete">🗑</button>
          </div>`;
        }).join("");
    }

    // ── value ──
    commit() {
      const v = this.features.length ? { type: "FeatureCollection", features: this.features } : null;
      this.opts.set(this.path, v);
      if (this.opts.onChange) this.opts.onChange(this.path, v);
      this.paintList(); this.paintCtrl();
    }

    redrawFeatures(fit) {
      if (!this.map) return;
      this.featGroup.clearLayers(); this.drawn.clearLayers();
      this.features.forEach((f, i) => {
        const l = featureLayer(f); l._kmpIndex = i;
        l.bindPopup(`<b>${esc((f.properties || {}).label || "Shape " + (i + 1))}</b><br>${esc(statsText(f))}`);
        (f.properties.kind === "drawn" && this.mode === "draw" ? this.drawn : this.featGroup).addLayer(l);
      });
      if (fit) this.fitAll();
    }
    fitAll() {
      const b = L.featureGroup([...this.featGroup.getLayers(), ...this.drawn.getLayers()]).getBounds();
      if (b.isValid()) this.map.fitBounds(b.pad(0.2), { maxZoom: 18 });
      else if (this.zoneGroup && this.zoneGroup.getBounds().isValid()) this.map.fitBounds(this.zoneGroup.getBounds().pad(0.1));
    }

    // ── draw mode (leaflet-draw) ──
    setupDraw() {
      if (!this.cfg.modes.includes("draw") || !L.Draw) return;
      const shape = () => ({ color: this.color, weight: 3, fillColor: this.color, fillOpacity: 0.22 });
      const tools = new Set(this.cfg.draw_tools || ["polygon", "rectangle", "circle", "polyline", "marker"]);
      this.drawCtl = new L.Control.Draw({
        position: "topleft",
        draw: {
          polygon: tools.has("polygon") ? { allowIntersection: false, showArea: true, shapeOptions: shape() } : false,
          rectangle: tools.has("rectangle") ? { shapeOptions: shape() } : false,
          circle: tools.has("circle") ? { shapeOptions: shape() } : false,
          polyline: tools.has("polyline") ? { shapeOptions: shape() } : false,
          marker: tools.has("marker") ? {} : false,
          circlemarker: false,
        },
        edit: { featureGroup: this.drawn, remove: true },
      });
      // Refresh tool colours when the palette changes.
      this.drawShapeOpts = shape;
      this.map.on(L.Draw.Event.DRAWSTART, () => {
        Object.values(this.drawCtl._toolbars.draw._modes).forEach(m => { if (m.handler.options.shapeOptions) Object.assign(m.handler.options.shapeOptions, shape()); });
      });
      this.map.on(L.Draw.Event.CREATED, e => {
        if (this.features.length >= this.cfg.max_features) { this.toast(`Maximum of ${this.cfg.max_features} shapes`); return; }
        const f = this.layerToFeature(e.layer, e.layerType);
        if (!f) return;
        this.features.push(f); this.commit(); this.redrawFeatures(false);
        this.toast("Added · " + statsText(f));
        setTimeout(() => { const inp = this.root.querySelector(`[data-label="${this.features.length - 1}"]`); inp && inp.focus({ preventScroll: true }); }, 50);
      });
      const sync = () => {
        this.drawn.eachLayer(l => {
          const i = l._kmpIndex; if (i == null || !this.features[i]) return;
          const old = this.features[i].properties;
          const f = this.layerToFeature(l, old.shape === "rectangle" ? "rectangle" : null);
          if (f) { f.properties = Object.assign({}, old, f.properties, { label: old.label, color: old.color }); this.features[i] = f; }
        });
        this.commit();
      };
      this.map.on(L.Draw.Event.EDITED, sync);
      this.map.on(L.Draw.Event.DELETED, e => {
        const gone = new Set(); e.layers.eachLayer(l => gone.add(l._kmpIndex));
        this.features = this.features.filter((_, i) => !gone.has(i));
        this.commit(); this.redrawFeatures(false);
      });
      if (this.mode === "draw") this.map.addControl(this.drawCtl);
    }

    layerToFeature(layer, type) {
      const props = { kind: "drawn", color: this.color };
      if (layer instanceof L.Circle) {
        const c = layer.getLatLng();
        return { type: "Feature", geometry: { type: "Point", coordinates: [+c.lng.toFixed(7), +c.lat.toFixed(7)] }, properties: Object.assign(props, { shape: "circle", radius_m: +layer.getRadius().toFixed(2) }) };
      }
      if (layer instanceof L.Polygon) {
        let ring = layer.getLatLngs(); ring = Array.isArray(ring[0]) ? ring[0] : ring;
        const c = ring.map(p => [+p.lng.toFixed(7), +p.lat.toFixed(7)]); c.push(c[0]);
        return { type: "Feature", geometry: { type: "Polygon", coordinates: [c] }, properties: Object.assign(props, { shape: type === "rectangle" || layer instanceof L.Rectangle ? "rectangle" : "polygon" }) };
      }
      if (layer instanceof L.Polyline) {
        const c = layer.getLatLngs().map(p => [+p.lng.toFixed(7), +p.lat.toFixed(7)]);
        return { type: "Feature", geometry: { type: "LineString", coordinates: c }, properties: Object.assign(props, { shape: "line" }) };
      }
      if (layer instanceof L.Marker) {
        const c = layer.getLatLng();
        return { type: "Feature", geometry: { type: "Point", coordinates: [+c.lng.toFixed(7), +c.lat.toFixed(7)] }, properties: Object.assign(props, { shape: "point" }) };
      }
      return null;
    }

    setMode(m) {
      if (this.rec || !MODES[m] || m === this.mode) return;
      this.mode = m;
      if (this.map && this.drawCtl) { if (m === "draw") this.map.addControl(this.drawCtl); else this.map.removeControl(this.drawCtl); }
      this.paintModes(); this.paintCtrl(); this.redrawFeatures(false);
    }

    // ── live GPS recording ──
    start(resumeFrom) {
      if (!navigator.geolocation) { this.toast("This browser can't access GPS."); return; }
      if (!window.isSecureContext) { this.toast("GPS needs a secure (https) page."); return; }
      this.rec = resumeFrom || { kind: this.mode === "area" ? "area" : "track", pts: [], t0: Date.now(), paused: false, color: this.color, closedNotified: false };
      this.follow = true;
      this.$('[data-act="follow"]').hidden = false;
      this.$(".kmp-hud").hidden = false; this.$(".kmp-gps").hidden = false;
      this.watch = navigator.geolocation.watchPosition(p => this.onFix(p), err => this.onGpsError(err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
      this.wake();
      this.timer = setInterval(() => this.paintHud(), 1000);
      this.paintModes(); this.paintCtrl(); this.paintLive(); this.paintHud();
      this.toast(this.rec.pts.length ? "Resumed — keep going" : "Waiting for a good GPS fix…", 2500);
    }

    onFix(p) {
      const c = p.coords, acc = Math.round(c.accuracy || 999), now = p.timestamp || Date.now();
      const pos = [+c.longitude.toFixed(7), +c.latitude.toFixed(7), now, acc];
      this.lastFix = pos;
      this.paintGps(acc);
      if (this.map) {
        this.me.setLatLng([pos[1], pos[0]]).addTo(this.map);
        this.meAcc.setLatLng([pos[1], pos[0]]).setRadius(acc).addTo(this.map);
        if (c.heading != null && !isNaN(c.heading)) { const b = this.me.getElement() && this.me.getElement().querySelector("b"); if (b) { b.style.opacity = 1; b.style.transform = `rotate(${c.heading}deg)`; } }
        if (this.follow && this.rec) this.map.setView([pos[1], pos[0]], Math.max(this.map.getZoom(), 17), { animate: true });
      }
      const R = this.rec;
      if (!R || R.paused) return;
      if (acc > this.cfg.accuracy_m) return;                 // too inaccurate to record
      const last = R.pts[R.pts.length - 1];
      if (last) {
        const d = dist(last, pos), dt = Math.max(1, (now - last[2]) / 1000);
        if (d / dt * 3.6 > 250) return;                       // GPS spike
        if (d < Math.max(this.cfg.step_m, acc * 0.4)) return;  // jitter while standing still
      }
      R.pts.push(pos);
      this.persist();
      this.paintLive();
      const cnt = this.root.querySelector(".kmp-recbar small"); if (cnt) cnt.textContent = R.pts.length + " points";
      // Walk-an-area: notice when you've come back to where you started.
      if (R.kind === "area" && !R.closedNotified && R.pts.length > 8) {
        const walked = pathLen(R.pts), back = dist(R.pts[0], pos);
        if (walked > 40 && back < Math.max(12, acc)) {
          R.closedNotified = true;
          this.toast("🎯 You're back at the start — tap ✔ Finish to close the area", 6000);
          try { navigator.vibrate && navigator.vibrate([80, 60, 80]); } catch (e) { /* no vibration */ }
        }
      }
    }

    onGpsError(err) {
      // A brief hiccup while good fixes are still arriving isn't worth a warning.
      if (err.code !== 1 && this.lastFix && Date.now() - this.lastFix[2] < 15000) return;
      const msg = err.code === 1 ? "Location permission denied — allow location for this site in the browser settings."
        : err.code === 3 ? "Still waiting for GPS… move to open sky." : "GPS unavailable right now.";
      this.toast(msg, 5000);
      if (err.code === 1) this.stopWatch();
    }

    paintGps(acc) {
      const g = this.$(".kmp-gps"); if (!g) return;
      const q = acc <= 8 ? "great" : acc <= 15 ? "good" : acc <= this.cfg.accuracy_m ? "fair" : "weak";
      g.className = "kmp-gps " + q;
      g.querySelector("span").textContent = (q === "weak" ? "Weak GPS " : "GPS ") + "±" + acc + " m";
    }

    paintLive() {
      if (!this.map || !this.rec) return;
      const ll = this.rec.pts.map(p => [p[1], p[0]]);
      this.liveLine.setLatLngs(ll).setStyle({ color: this.rec.color });
      if (this.rec.kind === "area" && ll.length >= 3) {
        this.liveFill.setLatLngs(ll).setStyle({ fillColor: this.rec.color });
        this.closeLine.setLatLngs([ll[ll.length - 1], ll[0]]).setStyle({ color: this.rec.color });
      } else { this.liveFill.setLatLngs([]); this.closeLine.setLatLngs([]); }
    }

    paintHud() {
      const R = this.rec; if (!R) return;
      const d = pathLen(R.pts), el = (Date.now() - R.t0) / 1000;
      const set = (k, v) => { const x = this.root.querySelector(`[data-s="${k}"]`); if (x) x.textContent = v; };
      set("dist", fmtDist(d));
      set("time", fmtTime(el));
      set("area", R.kind === "area" && R.pts.length >= 3 ? fmtArea(ringArea(R.pts)) : "—");
      // Speed over the last ~20 s of points.
      const recent = R.pts.filter(p => p[2] > Date.now() - 20000);
      let sp = 0; if (recent.length >= 2) { const dt = (recent[recent.length - 1][2] - recent[0][2]) / 1000; if (dt > 0) sp = pathLen(recent) / dt * 3.6; }
      set("speed", sp < 1 ? "0" : sp.toFixed(sp < 10 ? 1 : 0));
    }

    pause() { if (!this.rec) return; this.rec.paused = true; this.persist(); this.paintCtrl(); this.toast("Paused — nothing is recorded until you resume"); }
    resume() { if (!this.rec) return; this.rec.paused = false; this.persist(); this.paintCtrl(); }

    finish() {
      const R = this.rec; if (!R) return;
      const need = R.kind === "area" ? 3 : 2;
      if (R.pts.length < need) {
        if (!confirm(`Only ${R.pts.length} GPS point${R.pts.length === 1 ? "" : "s"} recorded — not enough for ${R.kind === "area" ? "an area" : "a route"}. Discard it?`)) return;
        this.stopRecording(); return;
      }
      const pts = simplify(R.pts, 1.5);
      const props = { kind: R.kind, color: R.color };
      const f = R.kind === "area"
        ? { type: "Feature", geometry: { type: "Polygon", coordinates: [pts.concat([pts[0]])] }, properties: Object.assign(props, { shape: "polygon" }) }
        : { type: "Feature", geometry: { type: "LineString", coordinates: pts }, properties: Object.assign(props, { shape: "line" }) };
      // keep time/accuracy on line points so the server can compute speed/duration
      if (R.kind === "area") f.properties.duration_s = Math.round((R.pts[R.pts.length - 1][2] - R.pts[0][2]) / 1000);
      this.features.push(f);
      this.stopRecording();
      this.commit(); this.redrawFeatures(false);
      this.toast("✔ Saved · " + statsText(f), 4500);
      try { navigator.vibrate && navigator.vibrate(120); } catch (e) { /* ignore */ }
      this.fitAll();
    }

    cancel() {
      if (this.rec && this.rec.pts.length > 3 && !confirm("Discard this recording?")) return;
      this.stopRecording();
    }

    stopWatch() { if (this.watch != null) navigator.geolocation.clearWatch(this.watch); this.watch = null; }
    stopRecording() {
      this.stopWatch(); clearInterval(this.timer); this.release();
      this.rec = null; this.clearPersist();
      if (this.map) { this.liveLine.setLatLngs([]); this.liveFill.setLatLngs([]); this.closeLine.setLatLngs([]); this.me.remove(); this.meAcc.remove(); }
      this.$(".kmp-hud").hidden = true; this.$(".kmp-gps").hidden = true; this.$('[data-act="follow"]').hidden = true;
      this.paintModes(); this.paintCtrl();
    }

    // Keep the screen on while recording (where supported).
    async wake() { try { if ("wakeLock" in navigator) { this.lock = await navigator.wakeLock.request("screen"); } } catch (e) { /* not granted */ } }
    release() { try { this.lock && this.lock.release(); } catch (e) { /* ignore */ } this.lock = null; }

    // ── crash-proof: save the in-progress trace on the phone ──
    persist() { try { localStorage.setItem(this.storeKey, JSON.stringify(this.rec)); } catch (e) { /* storage full */ } }
    clearPersist() { try { localStorage.removeItem(this.storeKey); } catch (e) { /* ignore */ } }
    checkResume() {
      let saved = null; try { saved = JSON.parse(localStorage.getItem(this.storeKey) || "null"); } catch (e) { saved = null; }
      if (!saved || !Array.isArray(saved.pts) || !saved.pts.length) return;
      const box = this.$(".kmp-resume");
      box.hidden = false;
      box.innerHTML = `<b>Unfinished ${saved.kind === "area" ? "area" : "route"}</b> — ${saved.pts.length} points, ${fmtDist(pathLen(saved.pts))}.
        <button type="button" data-act="resume-saved">▶ Continue it</button><button type="button" data-act="drop-saved">Discard</button>`;
      this._saved = saved;
    }

    // ── events ──
    onClick(e) {
      const m = e.target.closest("[data-mode]"); if (m) { this.setMode(m.dataset.mode); return; }
      const c = e.target.closest("[data-color]");
      if (c) {
        this.color = c.dataset.color;
        this.root.querySelectorAll(".kmp-palette button").forEach(b => b.classList.toggle("on", b === c));
        if (this._recolor != null && this.features[this._recolor]) { this.features[this._recolor].properties.color = this.color; this._recolor = null; this.commit(); this.redrawFeatures(false); }
        if (this.rec) { this.rec.color = this.color; this.paintLive(); }
        return;
      }
      const a = e.target.closest("[data-act]"); if (!a) return;
      const i = a.dataset.i != null ? +a.dataset.i : null;
      switch (a.dataset.act) {
        case "start": this.start(); break;
        case "pause": this.pause(); break;
        case "resume": this.resume(); break;
        case "finish": this.finish(); break;
        case "cancel": this.cancel(); break;
        case "resume-saved": this.$(".kmp-resume").hidden = true; this.mode = this._saved.kind === "area" ? "area" : "track"; this.paintModes(); this.start(Object.assign(this._saved, { paused: false })); break;
        case "drop-saved": this.$(".kmp-resume").hidden = true; this.clearPersist(); break;
        case "del": if (confirm("Delete this shape?")) { this.features.splice(i, 1); this.commit(); this.redrawFeatures(false); } break;
        case "zoom": { const l = [...this.featGroup.getLayers(), ...this.drawn.getLayers()].find(x => x._kmpIndex === i); if (l && this.map) { l.getBounds ? this.map.fitBounds(l.getBounds().pad(0.3), { maxZoom: 19 }) : this.map.setView(l.getLatLng(), 18); l.openPopup(); } break; }
        case "recolor": this._recolor = i; this.toast("Pick a colour below for this shape"); break;
        case "base": { const keys = Object.keys(BASES); this.baseKey = keys[(keys.indexOf(this.baseKey) + 1) % keys.length]; this.map.removeLayer(this.base); this.base = baseLayer(this.baseKey).addTo(this.map); this.base.bringToBack(); this.toast(BASES[this.baseKey][0], 1200); break; }
        case "locate": navigator.geolocation && navigator.geolocation.getCurrentPosition(p => { const ll = [p.coords.latitude, p.coords.longitude]; this.me.setLatLng(ll).addTo(this.map); this.meAcc.setLatLng(ll).setRadius(p.coords.accuracy).addTo(this.map); this.map.setView(ll, 17); this.paintGps(Math.round(p.coords.accuracy)); this.$(".kmp-gps").hidden = false; }, err => this.onGpsError(err), { enableHighAccuracy: true, timeout: 15000 }); break;
        case "follow": this.follow = !this.follow; a.classList.toggle("on", this.follow); break;
        case "full": this.root.classList.toggle("kmp-full"); document.body.classList.toggle("kmp-noscroll", this.root.classList.contains("kmp-full")); setTimeout(() => this.map && this.map.invalidateSize(), 60); break;
      }
    }
    onInput(e) {
      const t = e.target;
      if (t.dataset.label != null) {
        const f = this.features[+t.dataset.label]; if (!f) return;
        f.properties.label = t.value.slice(0, 80);
        this.opts.set(this.path, { type: "FeatureCollection", features: this.features });
      }
    }

    attach(slot) {
      slot.replaceWith(this.root);
      if (this.map) setTimeout(() => this.map.invalidateSize(), 0);
    }
  }

  // ═════════════════════════ public API ═════════════════════════
  function hydrate(rootEl, opts) {
    (rootEl || document).querySelectorAll(".kmapper-slot[data-mapper]").forEach(slot => {
      const path = slot.dataset.mapper;
      let inst = registry.get(path);
      if (!inst) {
        let cfg = {}; try { cfg = JSON.parse(slot.dataset.cfg || "{}"); } catch (e) { cfg = {}; }
        inst = new Mapper(path, cfg, opts);
        registry.set(path, inst);
      }
      inst.attach(slot);
    });
  }

  // Read-only rendering (data views, live map popups).
  async function render(mapEl, fc, opts) {
    await ensureLeaflet(false);
    const map = L.map(mapEl, { zoomControl: true }).setView([13.45, -16.58], 9);
    baseLayer((opts && opts.basemap) || "satellite").addTo(map);
    if (opts && opts.zones) zonesLayer(opts.zones).addTo(map);
    const g = L.featureGroup().addTo(map);
    ((fc && fc.features) || []).forEach(f => { try { const l = featureLayer(f); l.bindPopup(esc(statsText(f))); g.addLayer(l); } catch (e) { /* skip bad shape */ } });
    if (g.getBounds().isValid()) map.fitBounds(g.getBounds().pad(0.2), { maxZoom: 18 });
    return map;
  }

  window.KuraMapper = { hydrate, render, ensureLeaflet, featureLayer, zonesLayer, statsText, fmtDist, fmtArea, PALETTE };
})();
