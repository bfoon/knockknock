/* Kura Geo Studio — studio.js
 *
 * Leaflet 1.9.4 + Geoman (free) for drawing/editing, Turf 7 for geometry,
 * all server state through /kura/geo/p/<id>/api/… (see views.py).
 * GeoJSON order is [lng, lat]; Leaflet is [lat, lng] — every conversion
 * goes through toGeo()/fromGeo() so the swap lives in one place.
 */
(function () {
  "use strict";

  const CFG = JSON.parse(document.getElementById("geo-config").textContent);
  const API = CFG.api;
  const CSRF = (document.querySelector("[name=csrfmiddlewaretoken]") || {}).value || "";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v, d = 1) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 }));

  const CAT = Object.fromEntries(CFG.categories);
  const CAT_COLORS = {
    none: "#22d3ee", parcel: "#f59e0b", geofence: "#f43f5e", aoi: "#a78bfa", mangrove: "#10b981", palm: "#a3e635",
    forest: "#16a34a", agroforestry: "#ca8a04", cashew: "#fb923c", farm: "#eab308", solar: "#38bdf8", building: "#f97316",
    road: "#e5e7eb", water: "#3b82f6", plot: "#e879f9", poi: "#22d3ee", note: "#fde68a",
  };
  const ICONS = ["📍", "🌳", "🌴", "🌿", "🌱", "🌾", "🥜", "🍋", "☀️", "⚡", "🔋", "🏠", "🏘️", "🏫", "🏥", "🕌", "⛪", "🏪",
    "🏭", "🏗️", "💧", "🚰", "⛽", "🚧", "🚩", "🎯", "⭐", "❗", "⚠️", "🔒", "📡", "🐄", "🐐", "🐟", "🐝", "🚜", "🚗", "🚚",
    "🛶", "⚓", "🔥", "🗑️", "🌊", "🏖️", "🛣️", "🌉", "🪧", "📷", "🧭", "👥", "🛰️", "🦩", "🐢", "🌲", "🪵", "⛺"];
  const SWATCHES = ["#22d3ee", "#22c55e", "#10b981", "#15803d", "#a3e635", "#facc15", "#f59e0b", "#f97316", "#f43f5e",
    "#ec4899", "#a855f7", "#6366f1", "#3b82f6", "#ffffff", "#9ca3af", "#111827"];

  const S = {
    feats: new Map(), lay: new Map(), records: [], analyses: [], assets: [], trackers: [], imagery: [], events: [],
    sel: null, tool: "select", undo: [], an: { target: "selected", kind: "trees", engine: "hybrid" },
    overlay: null, dets: null, imgLayers: new Map(), trkMarkers: new Map(), project: {}, measure: null, tempPlace: null,
  };

  // ───────────────────────────── utilities ─────────────────────────────
  let toastT;
  function toast(msg, kind) {
    const t = $("#gs-toast");
    t.className = "gs-toast" + (kind ? " " + kind : "");
    t.innerHTML = msg;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), kind === "err" ? 7000 : 4200);
  }
  function busy(on, text) {
    $("#gs-busy").hidden = !on;
    if (text) $("#gs-busy-text").textContent = text;
  }
  async function call(path, body, opts = {}) {
    const init = { method: body === undefined ? "GET" : "POST", headers: { "X-CSRFToken": CSRF }, credentials: "same-origin" };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }
    const r = await fetch(API + path, init);
    let data;
    try { data = await r.json(); } catch (e) { data = { ok: false, error: `Server error (${r.status})` }; }
    if (!data.ok && !opts.quiet) toast(esc(data.error || "Something went wrong"), "err");
    return data;
  }
  const fmtArea = (m2) => m2 >= 10000 ? `${num(m2 / 10000, 3)} ha` : `${num(m2, 0)} m²`;
  const fmtLen = (m) => m >= 1000 ? `${num(m / 1000, 2)} km` : `${num(m, 1)} m`;
  function colorOf(f) { return (f.style && f.style.color) || CAT_COLORS[f.category] || "#22d3ee"; }

  // plus code (same algorithm as geo.py)
  const OLC = "23456789CFGHJMPQRVWX";
  function plusCode(lat, lng) {
    let li = Math.floor(Math.round((Math.min(90, Math.max(-90, lat)) + 90) * 8000 * 1e6) / 1e6);
    let ni = Math.floor(Math.round(((((lng + 180) % 360) + 360) % 360) * 8000 * 1e6) / 1e6);
    li = Math.min(li, 180 * 8000 - 1);
    const a = [], b = [];
    for (let i = 0; i < 5; i++) { a.unshift(OLC[li % 20]); b.unshift(OLC[ni % 20]); li = Math.floor(li / 20); ni = Math.floor(ni / 20); }
    const c = a.map((x, i) => x + b[i]).join("");
    return c.slice(0, 8) + "+" + c.slice(8);
  }

  // ───────────────────────────── map ─────────────────────────────
  const map = L.map("gs-map", { zoomControl: true, maxZoom: 21, preferCanvas: false, worldCopyJump: true })
    .setView([13.4549, -16.579], 13);
  const canvas = L.canvas({ padding: 0.3 });
  const esri = (svc) => `https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`;
  const BASE = {
    satellite: () => L.tileLayer(CFG.imagery_url, { maxNativeZoom: CFG.imagery_max_zoom, maxZoom: 21, crossOrigin: true, attribution: CFG.imagery_attribution }),
    streets: () => L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxNativeZoom: 19, maxZoom: 21, crossOrigin: true, attribution: "© OpenStreetMap contributors" }),
    topo: () => L.tileLayer(esri("World_Topo_Map"), { maxNativeZoom: 19, maxZoom: 21, crossOrigin: true, attribution: "Esri World Topo" }),
    dark: () => L.tileLayer(esri("Canvas/World_Dark_Gray_Base"), { maxNativeZoom: 16, maxZoom: 21, crossOrigin: true, attribution: "Esri Dark Gray" }),
  };
  let baseLayer = null, labelLayer = null;
  function setBase(name) {
    if (baseLayer) map.removeLayer(baseLayer);
    if (labelLayer) { map.removeLayer(labelLayer); labelLayer = null; }
    baseLayer = (BASE[name === "hybrid" ? "satellite" : name] || BASE.satellite)().addTo(map);
    baseLayer.bringToBack();
    if (name === "hybrid") labelLayer = L.tileLayer(esri("Reference/World_Boundaries_and_Places"), { maxNativeZoom: 19, maxZoom: 21, pane: "overlayPane" }).addTo(map);
    $("#gs-basemap").value = name;
    $("#gs-attrib").textContent = (baseLayer.options.attribution || "").replace(/<[^>]+>/g, "");
  }
  $("#gs-basemap").addEventListener("change", (e) => { setBase(e.target.value); call("project/", { basemap: e.target.value }, { quiet: true }); });

  map.on("mousemove", (e) => {
    $("#gs-cursor").textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
    $("#gs-plus").textContent = plusCode(e.latlng.lat, e.latlng.lng);
  });
  map.on("zoomend", () => ($("#gs-zoom").textContent = "z" + map.getZoom()));
  let moveT;
  map.on("moveend", () => {
    clearTimeout(moveT);
    moveT = setTimeout(() => { const c = map.getCenter(); call("project/", { center: [c.lat, c.lng], zoom: map.getZoom() }, { quiet: true }); }, 4000);
  });

  // Geoman: our own toolbar drives it, its controls stay hidden.
  map.pm.setGlobalOptions({ snappable: true, snapDistance: 14, allowSelfIntersection: false,
    templineStyle: { color: "#ff8a1f" }, hintlineStyle: { color: "#ff8a1f", dashArray: "5 5" },
    pathOptions: { color: "#ff8a1f", fillOpacity: 0.2 } });
  map.pm.setLang("en");

  // ───────────────────────────── geometry conversion ─────────────────────────────
  function geomOfLayer(layer, shape) {
    if (layer instanceof L.Circle) {
      const c = layer.getLatLng();
      return { geometry: { type: "Point", coordinates: [+c.lng.toFixed(7), +c.lat.toFixed(7)] }, properties: { radius: +layer.getRadius().toFixed(2) } };
    }
    if (layer instanceof L.Marker) {
      const c = layer.getLatLng();
      return { geometry: { type: "Point", coordinates: [+c.lng.toFixed(7), +c.lat.toFixed(7)] }, properties: {} };
    }
    const g = layer.toGeoJSON(7).geometry;
    return { geometry: g, properties: shape === "Rectangle" ? { shape: "rectangle" } : {} };
  }
  function turfOf(f) {
    const g = f.geometry;
    if (g.type === "Point" && f.properties && f.properties.radius) return turf.circle(g.coordinates, f.properties.radius / 1000, { steps: 64, units: "kilometers" });
    return turf.feature(g);
  }

  // ───────────────────────────── rendering features ─────────────────────────────
  function iconHtml(f, sel) {
    const st = f.style || {};
    const size = st.iconSize || 30;
    return L.divIcon({
      className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      html: `<div class="gs-icon${sel ? " sel" : ""}" style="--c:${esc(colorOf(f))};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.55)}px">${esc((f.properties || {}).icon || "📍")}</div>`,
    });
  }
  function textIcon(f, sel) {
    const st = f.style || {};
    return L.divIcon({
      className: "", iconSize: [0, 0],
      html: `<span class="gs-text${sel ? " sel" : ""}" style="color:${esc(st.color || "#fff")};font-size:${st.fontSize || 16}px">${esc((f.properties || {}).text || f.name || "Label")}</span>`,
    });
  }
  function pathStyle(f, sel) {
    const st = f.style || {};
    const c = colorOf(f);
    const line = f.geometry.type === "LineString" || f.geometry.type === "MultiLineString";
    return {
      color: sel ? "#ff8a1f" : c, weight: (st.weight != null ? st.weight : line ? 3 : 2) + (sel ? 1.5 : 0),
      opacity: st.opacity != null ? st.opacity : 1, fillColor: st.fillColor || c,
      fillOpacity: st.fillOpacity != null ? st.fillOpacity : (f.is_geofence ? 0.12 : 0.22),
      dashArray: st.dashArray || (f.is_geofence ? "8 6" : null),
    };
  }
  function makeLayer(f) {
    const g = f.geometry, p = f.properties || {}, sel = S.sel === f.id;
    let layer;
    if (g.type === "Point") {
      const ll = [g.coordinates[1], g.coordinates[0]];
      if (p.radius) layer = L.circle(ll, Object.assign({ radius: p.radius }, pathStyle(f, sel)));
      else if (p.text != null && !p.icon) layer = L.marker(ll, { icon: textIcon(f, sel) });
      else if ((f.layer || "").startsWith("Detected") && f.category !== "solar") {
        layer = L.circleMarker(ll, { renderer: canvas, radius: 4, color: colorOf(f), weight: 1, fillOpacity: 0.8 });
      } else layer = L.marker(ll, { icon: iconHtml(f, sel) });
    } else {
      layer = L.geoJSON(g, { style: () => pathStyle(f, sel) }).getLayers()[0];
      if (!layer) return null;
    }
    layer._fid = f.id;
    layer.on("click", (e) => {
      if (S.tool === "probe" || S.tool === "measure") return;
      L.DomEvent.stopPropagation(e);
      select(f.id);
    });
    const label = f.name || CAT[f.category] || "";
    if (label && !(p.text != null && !p.icon)) layer.bindTooltip(esc(label), { className: "gs-tip", direction: "top", sticky: g.type !== "Point" });
    return layer;
  }
  function draw(f) {
    const old = S.lay.get(f.id);
    if (old) {
      // Unbind first: a sticky tooltip still listening for mousemove on a
      // removed layer throws "reading 'layerPointToLatLng'" in Leaflet.
      try { old.pm && old.pm.disable && old.pm.disable(); old.unbindTooltip(); } catch (e) { /* gone */ }
      map.removeLayer(old);
    }
    S.lay.delete(f.id);
    if (f.hidden) return;
    const layer = makeLayer(f);
    if (!layer) return;
    layer.addTo(map);
    S.lay.set(f.id, layer);
  }
  function upsert(f, redraw = true) { S.feats.set(f.id, f); if (redraw) draw(f); }
  function removeFeat(id) { const l = S.lay.get(id); if (l) { try { l.unbindTooltip(); } catch (e) {} map.removeLayer(l); } S.lay.delete(id); S.feats.delete(id); if (S.sel === id) select(null); }

  // ───────────────────────────── selection & tools ─────────────────────────────
  function select(id, opts = {}) {
    const prev = S.sel;
    disableEditing();
    S.sel = id;
    if (prev && S.feats.get(prev)) draw(S.feats.get(prev));
    if (id && S.feats.get(id)) {
      draw(S.feats.get(id));
      if (opts.zoom) zoomTo(id);
      if (["edit", "drag", "rotate"].includes(S.tool)) enableEditing(S.tool);
      showTab("inspect");
    }
    renderInspector();
    renderLayers();
  }
  function zoomTo(id) {
    const l = S.lay.get(id);
    if (!l) return;
    if (l.getBounds) map.fitBounds(l.getBounds().pad(0.3), { maxZoom: 19 });
    else map.setView(l.getLatLng(), Math.max(map.getZoom(), 18));
  }
  function setTool(t) {
    map.pm.disableDraw();
    map.pm.disableGlobalCutMode && map.pm.disableGlobalCutMode();
    disableEditing();
    endMeasure();
    S.tool = t;
    $$("#gs-rail [data-tool]").forEach((b) => b.classList.toggle("on", b.dataset.tool === t));
    map.getContainer().style.cursor = ["Marker", "Text", "probe", "measure"].includes(t) ? "crosshair" : "";
    if (["Line", "Polygon", "Rectangle", "Circle"].includes(t)) {
      map.pm.enableDraw(t, { finishOn: t === "Line" ? "dblclick" : null });
      hud(`Drawing <b>${t === "Polygon" ? "shape" : t.toLowerCase()}</b> — click to add points${t === "Polygon" || t === "Line" ? ", double-click / click first point to finish" : ""} · Esc cancels`);
    } else if (t === "measure") {
      startMeasure();
    } else if (["edit", "drag", "rotate"].includes(t)) {
      if (!S.sel) { toast("Select a shape first."); setTool("select"); return; }
      enableEditing(t);
    } else if (t === "cut") {
      const l = S.sel && S.lay.get(S.sel);
      if (!l || !(l instanceof L.Polygon)) { toast("Select a polygon to cut."); setTool("select"); return; }
      map.pm.enableGlobalCutMode({ layersToCut: [l], allowSelfIntersection: false });
      hud("Draw the piece to <b>cut out</b> of the selected shape");
    } else if (t === "probe") hud("Click anywhere to check <b>geofences</b>, <b>Location IDs</b> and the plus code");
    else if (t === "Marker") hud("Click the map to drop an <b>icon</b>");
    else if (t === "Text") hud("Click the map to place a <b>text label</b>");
    else hud(null);
  }
  function hud(html) { const h = $("#gs-hud"); h.hidden = !html; if (html) h.innerHTML = html; }

  let editing = null;
  function enableEditing(mode) {
    const l = S.sel && S.lay.get(S.sel);
    const f = S.sel && S.feats.get(S.sel);
    if (!l || !f) return;
    if (f.locked) { toast("This shape is locked — unlock it in Inspect."); return; }
    editing = { l, mode };
    if (l instanceof L.Marker) { l.dragging && l.dragging.enable(); l.once("dragend", () => commitLayer(f.id, l)); hud("Drag the icon, then let go"); return; }
    if (mode === "edit") { l.pm.enable({ allowSelfIntersection: false, snappable: true }); hud("Drag vertices · click a midpoint to add · right-click a vertex to remove"); }
    if (mode === "drag") { l.pm.enableLayerDrag(); hud("Drag the shape to move it"); }
    if (mode === "rotate") { if (l.pm.enableRotate) { l.pm.enableRotate(); hud("Drag the corner handle to rotate"); } }
    l.on("pm:edit pm:dragend pm:rotateend", onEdited);
  }
  let editT;
  function onEdited(e) {
    const l = e.layer || e.target;
    clearTimeout(editT);
    editT = setTimeout(() => commitLayer(l._fid, l), 250);
  }
  function disableEditing() {
    if (!editing) return;
    const { l } = editing;
    try {
      l.off("pm:edit pm:dragend pm:rotateend", onEdited);
      if (l.pm) { l.pm.disable(); l.pm.disableLayerDrag && l.pm.disableLayerDrag(); l.pm.disableRotate && l.pm.rotateEnabled && l.pm.rotateEnabled() && l.pm.disableRotate(); }
      if (l.dragging && l instanceof L.Marker) l.dragging.disable();
    } catch (e) { /* layer already gone */ }
    editing = null;
  }
  async function commitLayer(id, layer) {
    const f = S.feats.get(id);
    if (!f) return;
    const { geometry, properties } = geomOfLayer(layer);
    pushUndo(f);
    const r = await call(`feature/${id}/`, { geometry, properties: Object.assign({}, f.properties, properties) });
    if (r.ok) { S.feats.set(id, r.feature); if (!editing) draw(r.feature); renderInspector(); }
  }

  // ───────────────────────────── create ─────────────────────────────
  async function createFeature(data, opts = {}) {
    const body = Object.assign({ layer: data.layer || "Main" }, data);
    if (!body.style) body.style = {};
    const r = await call("feature/", body);
    if (!r.ok) return null;
    upsert(r.feature);
    S.undo.push({ op: "create", id: r.feature.id });
    if (opts.select !== false) select(r.feature.id);
    refreshKPIs();
    return r.feature;
  }
  map.on("pm:create", async (e) => {
    const shape = e.shape;
    const { geometry, properties } = geomOfLayer(e.layer, shape);
    map.removeLayer(e.layer);
    const cat = shape === "Line" ? "road" : shape === "Circle" ? "geofence" : "none";
    await createFeature({ geometry, properties, category: shape === "Circle" ? "aoi" : cat === "road" ? "road" : "none" });
    setTool("select");
  });
  map.on("pm:cut", async (e) => {
    const id = e.originalLayer && e.originalLayer._fid;
    const newLayer = e.layer;
    map.removeLayer(newLayer);
    if (!id) return;
    const f = S.feats.get(id);
    pushUndo(f);
    const g = newLayer.toGeoJSON(7).geometry;
    const r = await call(`feature/${id}/`, { geometry: g });
    if (r.ok) { upsert(r.feature); renderInspector(); }
    setTool("select");
  });
  map.on("click", async (e) => {
    const t = S.tool;
    const coords = [+e.latlng.lng.toFixed(7), +e.latlng.lat.toFixed(7)];
    if (t === "Marker") { await createFeature({ geometry: { type: "Point", coordinates: coords }, properties: { icon: "📍" }, category: "poi" }); setTool("select"); }
    else if (t === "Text") { await createFeature({ geometry: { type: "Point", coordinates: coords }, properties: { text: "Label" }, category: "note", style: { color: "#ffffff", fontSize: 18 } }); setTool("select"); setTimeout(() => { const i = $("#f-text"); i && i.select(); }, 60); }
    else if (t === "probe") probe(e.latlng);
    else if (t === "measure") measureClick(e.latlng);
    else if (t === "select" && S.sel) select(null);
  });

  // ───────────────────────────── undo ─────────────────────────────
  function pushUndo(f) { if (f) S.undo.push({ op: "update", before: JSON.parse(JSON.stringify(f)) }); if (S.undo.length > 60) S.undo.shift(); }
  async function undo() {
    const u = S.undo.pop();
    if (!u) return toast("Nothing to undo.");
    if (u.op === "create") { const r = await call(`feature-delete/${u.id}/`, {}); if (r.ok) removeFeat(u.id); }
    else if (u.op === "update") {
      const b = u.before;
      const r = await call(`feature/${b.id}/`, { geometry: b.geometry, properties: b.properties, style: b.style, name: b.name, category: b.category, layer: b.layer, is_geofence: b.is_geofence, notes: b.notes });
      if (r.ok) { upsert(r.feature); renderInspector(); }
    } else if (u.op === "delete") {
      const b = u.before;
      const r = await call("feature/", Object.assign({}, b));
      if (r.ok) upsert(r.feature);
    }
    renderLayers();
  }

  // ───────────────────────────── measure tool ─────────────────────────────
  function startMeasure() {
    S.measure = { pts: [], line: L.polyline([], { color: "#22d3ee", weight: 3, dashArray: "6 6" }).addTo(map),
      poly: L.polygon([], { color: "#22d3ee", weight: 0, fillOpacity: 0.15 }).addTo(map), marks: L.layerGroup().addTo(map) };
    hud("Click to measure · double-click to finish · <b>Esc</b> clears");
    map.doubleClickZoom.disable();
  }
  function measureClick(ll) {
    const m = S.measure;
    if (!m) return;
    m.pts.push(ll);
    L.circleMarker(ll, { radius: 4, color: "#fff", fillColor: "#22d3ee", fillOpacity: 1, weight: 2 }).addTo(m.marks);
    m.line.setLatLngs(m.pts);
    if (m.pts.length >= 3) m.poly.setLatLngs(m.pts);
    updateMeasure();
  }
  function updateMeasure(hover) {
    const m = S.measure;
    if (!m) return;
    const pts = hover ? m.pts.concat([hover]) : m.pts;
    if (pts.length < 2) return;
    const line = turf.lineString(pts.map((p) => [p.lng, p.lat]));
    const len = turf.length(line, { units: "kilometers" }) * 1000;
    let txt = `Distance <b>${fmtLen(len)}</b>`;
    if (pts.length >= 3) {
      const ring = pts.map((p) => [p.lng, p.lat]); ring.push(ring[0]);
      const a = turf.area(turf.polygon([ring]));
      txt += ` · Area <b>${fmtArea(a)}</b> · <b>${num(a / 4046.856, 2)}</b> acres`;
    }
    hud(txt + (m.pts.length >= 3 ? ` · <a href="#" id="m-save" style="color:#ff8a1f">save as shape</a>` : ""));
    const s = $("#m-save");
    if (s) s.onclick = (ev) => { ev.preventDefault(); saveMeasure(); };
  }
  map.on("mousemove", (e) => { if (S.measure && S.measure.pts.length) updateMeasure(e.latlng); });
  map.on("dblclick", () => { if (S.measure) { updateMeasure(); } });
  async function saveMeasure() {
    const m = S.measure;
    const ring = m.pts.map((p) => [+p.lng.toFixed(7), +p.lat.toFixed(7)]); ring.push(ring[0]);
    endMeasure();
    await createFeature({ geometry: { type: "Polygon", coordinates: [ring] }, category: "aoi", name: "Measured area" });
    setTool("select");
  }
  function endMeasure() {
    const m = S.measure;
    if (!m) return;
    [m.line, m.poly, m.marks].forEach((l) => map.removeLayer(l));
    S.measure = null;
    map.doubleClickZoom.enable();
    hud(null);
  }

  // ───────────────────────────── probe ─────────────────────────────
  async function probe(ll) {
    const r = await call(`geofence-check/?lat=${ll.lat}&lng=${ll.lng}`);
    if (!r.ok) return;
    const html = `<div style="min-width:200px;font-size:.82rem"><b>${ll.lat.toFixed(6)}, ${ll.lng.toFixed(6)}</b><br>
      Plus code <code>${esc(r.plus_code)}</code><br>
      ${r.inside.length ? "Inside geofence: <b>" + r.inside.map((x) => esc(x.name || "geofence")).join(", ") + "</b>" : "<span style='opacity:.6'>Not inside any geofence</span>"}<br>
      ${r.location_ids.length ? "Location ID: " + r.location_ids.map((c) => `<a target="_blank" href="${CFG.verify_base}${encodeURIComponent(c)}/">${esc(c)}</a>`).join(", ") : "<span style='opacity:.6'>No registered land here</span>"}</div>`;
    L.popup().setLatLng(ll).setContent(html).openOn(map);
  }

  // ───────────────────────────── inspector ─────────────────────────────
  function showTab(name) {
    $$(".gs-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === name));
    $$(".gs-pane").forEach((p) => p.classList.toggle("on", p.dataset.pane === name));
    if (name === "registry") renderRegistry();
    if (name === "carbon") renderCarbon();
    if (name === "track") renderTrack();
    if (name === "layers") renderLayers();
    if (name === "analyse") renderAnalyse();
  }
  $$(".gs-tabs button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  function measuresHtml(f) {
    const g = f.geometry, out = [];
    if (f.area_m2) { out.push(["Area", fmtArea(f.area_m2)]); out.push(["Acres", num(f.area_m2 / 4046.856, 3)]); }
    if (f.length_m) out.push([g.type === "LineString" ? "Length" : "Perimeter", fmtLen(f.length_m)]);
    if (f.properties && f.properties.radius) out.push(["Radius", fmtLen(f.properties.radius)]);
    if (f.centroid) { out.push(["Centre", `${f.centroid[0].toFixed(5)}, ${f.centroid[1].toFixed(5)}`]); out.push(["Plus code", plusCode(f.centroid[0], f.centroid[1])]); }
    return `<div class="gs-measure">${out.map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join("")}</div>`;
  }
  function renderInspector() {
    const f = S.sel && S.feats.get(S.sel);
    $("#insp-empty").hidden = !!f;
    const box = $("#insp");
    box.hidden = !f;
    if (!f) { refreshKPIs(); return; }
    const st = f.style || {}, p = f.properties || {};
    const isPoint = f.geometry.type === "Point" && !p.radius;
    const isText = isPoint && p.text != null && !p.icon;
    const isArea = !isPoint && f.geometry.type !== "LineString";
    const recs = S.records.filter((r) => r.feature_id === f.id);
    const layers = Array.from(new Set(Array.from(S.feats.values()).map((x) => x.layer)));
    const fields = Object.entries(p.fields || {});
    box.innerHTML = `
      <div class="gs-sec">
        <div class="gs-sec-head"><h4>${isText ? "Text label" : isPoint ? "Icon / point" : f.geometry.type === "LineString" ? "Line" : p.radius ? "Circle" : "Shape"}</h4>
          <span class="gs-pill">${esc(CAT[f.category] || f.category)}</span></div>
        ${recs.map((r) => `<div class="gs-good">🔏 Registered as <b class="gs-id" style="font-size:.85rem;padding:.15rem .4rem">${esc(r.code)}</b></div>`).join("")}
        <label class="gs-lbl">Name <input class="gs-in" id="f-name" value="${esc(f.name)}" placeholder="e.g. Kartong mangrove block A"></label>
        ${isText ? `<label class="gs-lbl">Text <input class="gs-in" id="f-text" value="${esc(p.text)}"></label>` : ""}
        <div class="gs-grid2">
          <label class="gs-lbl">Category <select class="gs-select" id="f-cat">${CFG.categories.map(([k, v]) => `<option value="${k}"${k === f.category ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
          <label class="gs-lbl">Layer <input class="gs-in" id="f-layer" list="f-layers" value="${esc(f.layer)}"><datalist id="f-layers">${layers.map((l) => `<option value="${esc(l)}">`).join("")}</datalist></label>
        </div>
        ${measuresHtml(f)}
        ${p.radius ? `<label class="gs-lbl">Radius (m) <input class="gs-in" type="number" min="1" id="f-radius" value="${(+p.radius).toFixed(1)}"></label>` : ""}
      </div>
      <div class="gs-sec">
        <h4>Style</h4>
        <div class="gs-swatches" id="f-sw">${SWATCHES.map((c) => `<button style="background:${c}" data-c="${c}" title="${c}"></button>`).join("")}</div>
        <div class="gs-row">
          <label class="gs-lbl">${isText ? "Colour" : "Line"} <input type="color" class="gs-color" id="f-color" value="${esc(colorOf(f).slice(0, 7))}"></label>
          ${isArea ? `<label class="gs-lbl">Fill <input type="color" class="gs-color" id="f-fill" value="${esc((st.fillColor || colorOf(f)).slice(0, 7))}"></label>` : ""}
          ${!isPoint ? `<label class="gs-lbl gs-grow">Width <input type="range" min="0" max="12" step="0.5" id="f-weight" value="${st.weight != null ? st.weight : 2}"></label>` : ""}
        </div>
        ${isArea ? `<label class="gs-lbl">Fill opacity <input type="range" min="0" max="1" step="0.05" id="f-fo" value="${st.fillOpacity != null ? st.fillOpacity : 0.22}"></label>` : ""}
        ${!isPoint ? `<label class="gs-lbl">Dash <select class="gs-select" id="f-dash">${[["", "Solid"], ["6 4", "Dashed"], ["2 6", "Dotted"], ["12 6", "Long dash"], ["10 4 2 4", "Dash-dot"]].map(([v, n]) => `<option value="${v}"${(st.dashArray || "") === v ? " selected" : ""}>${n}</option>`).join("")}</select></label>` : ""}
        ${isText ? `<label class="gs-lbl">Size <input type="range" min="10" max="64" id="f-fs" value="${st.fontSize || 16}"></label>` : ""}
        ${isPoint && !isText ? `<label class="gs-lbl">Icon</label><div class="gs-icons" id="f-icons">${ICONS.map((i) => `<button data-i="${i}" class="${p.icon === i ? "on" : ""}">${i}</button>`).join("")}</div>
          <label class="gs-lbl">Icon size <input type="range" min="16" max="72" id="f-is" value="${st.iconSize || 30}"></label>` : ""}
      </div>
      <div class="gs-sec">
        <h4>Behaviour &amp; data</h4>
        ${!isPoint || p.radius ? `<label class="gs-switch"><input type="checkbox" id="f-fence"${f.is_geofence ? " checked" : ""}><span></span> Geofence — trackers raise enter/exit events</label>` : ""}
        <label class="gs-switch"><input type="checkbox" id="f-lock"${f.locked ? " checked" : ""}><span></span> Lock (no accidental edits)</label>
        <label class="gs-lbl">Notes <textarea class="gs-in" id="f-notes" placeholder="Survey notes, owner remarks, evidence…">${esc(f.notes)}</textarea></label>
        <label class="gs-lbl">Custom fields</label>
        <div class="gs-fields" id="f-fields">${fields.map(([k, v]) => `<div class="gs-row"><input class="gs-in" value="${esc(k)}" data-k><input class="gs-in" value="${esc(v)}" data-v><button class="gs-btn gs-btn-ghost" data-rm>×</button></div>`).join("")}</div>
        <button class="gs-btn gs-btn-ghost" id="f-addfield"><i class="bi bi-plus"></i> Field</button>
      </div>
      <div class="gs-actions">
        <button class="gs-btn" data-a="zoom"><i class="bi bi-zoom-in"></i>Zoom</button>
        <button class="gs-btn" data-a="dup"><i class="bi bi-copy"></i>Duplicate</button>
        <button class="gs-btn" data-a="buffer"${isPoint && !p.radius ? "" : ""}><i class="bi bi-bullseye"></i>Buffer</button>
        ${isArea ? `<button class="gs-btn" data-a="analyse"><i class="bi bi-radar"></i>Analyse</button>
        <button class="gs-btn" data-a="carbon"><i class="bi bi-tree"></i>Carbon</button>
        <button class="gs-btn" data-a="grid"><i class="bi bi-grid-3x3"></i>Plots</button>` : ""}
        <button class="gs-btn" data-a="register"><i class="bi bi-fingerprint"></i>Location ID</button>
        <button class="gs-btn" data-a="front"><i class="bi bi-front"></i>Front</button>
        <button class="gs-btn gs-btn-danger" data-a="delete"><i class="bi bi-trash"></i>Delete</button>
      </div>`;

    const save = debounce((patch) => saveSel(patch), 350);
    const styleNow = () => Object.assign({}, S.feats.get(f.id).style || {});
    const bind = (sel, ev, fn) => { const el = $(sel, box); if (el) el.addEventListener(ev, fn); };
    bind("#f-name", "input", (e) => save({ name: e.target.value }));
    bind("#f-text", "input", (e) => save({ properties: Object.assign({}, p, { text: e.target.value }) }));
    bind("#f-cat", "change", (e) => saveSel({ category: e.target.value, is_geofence: e.target.value === "geofence" ? true : f.is_geofence }, true));
    bind("#f-layer", "change", (e) => saveSel({ layer: e.target.value }));
    bind("#f-radius", "change", (e) => saveSel({ properties: Object.assign({}, p, { radius: +e.target.value }) }, true));
    const live = (patch) => { const nf = Object.assign({}, S.feats.get(f.id)); nf.style = Object.assign({}, nf.style, patch); S.feats.set(f.id, nf); draw(nf); save({ style: nf.style }); };
    bind("#f-color", "input", (e) => live({ color: e.target.value }));
    bind("#f-fill", "input", (e) => live({ fillColor: e.target.value }));
    bind("#f-weight", "input", (e) => live({ weight: +e.target.value }));
    bind("#f-fo", "input", (e) => live({ fillOpacity: +e.target.value }));
    bind("#f-dash", "change", (e) => live({ dashArray: e.target.value }));
    bind("#f-fs", "input", (e) => live({ fontSize: +e.target.value }));
    bind("#f-is", "input", (e) => live({ iconSize: +e.target.value }));
    $$("#f-sw button", box).forEach((b) => b.addEventListener("click", () => { live({ color: b.dataset.c, fillColor: b.dataset.c }); renderInspector(); }));
    $$("#f-icons button", box).forEach((b) => b.addEventListener("click", () => saveSel({ properties: Object.assign({}, p, { icon: b.dataset.i }) }, true)));
    bind("#f-fence", "change", (e) => saveSel({ is_geofence: e.target.checked }, true));
    bind("#f-lock", "change", (e) => saveSel({ locked: e.target.checked }, true));
    bind("#f-notes", "input", (e) => save({ notes: e.target.value }));
    const saveFields = () => {
      const o = {};
      $$("#f-fields .gs-row", box).forEach((r) => { const k = $("[data-k]", r).value.trim(); if (k) o[k] = $("[data-v]", r).value; });
      save({ properties: Object.assign({}, S.feats.get(f.id).properties, { fields: o }) });
    };
    $("#f-fields", box).addEventListener("input", saveFields);
    $("#f-fields", box).addEventListener("click", (e) => { if (e.target.dataset.rm !== undefined) { e.target.closest(".gs-row").remove(); saveFields(); } });
    bind("#f-addfield", "click", () => { $("#f-fields", box).insertAdjacentHTML("beforeend", `<div class="gs-row"><input class="gs-in" placeholder="field" data-k><input class="gs-in" placeholder="value" data-v><button class="gs-btn gs-btn-ghost" data-rm>×</button></div>`); });
    $$("[data-a]", box).forEach((b) => b.addEventListener("click", () => featureAction(b.dataset.a, f)));
  }
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  async function saveSel(patch, rerender) {
    const id = S.sel;
    if (!id) return;
    pushUndo(S.feats.get(id));
    const r = await call(`feature/${id}/`, patch);
    if (r.ok) { upsert(r.feature); if (rerender) renderInspector(); renderLayers(); }
  }
  async function featureAction(a, f) {
    if (a === "zoom") zoomTo(f.id);
    if (a === "dup") {
      const g = JSON.parse(JSON.stringify(f.geometry));
      const shift = (c) => [c[0] + 0.0002, c[1] - 0.0002];
      const walk = (x) => (typeof x[0] === "number" ? shift(x) : x.map(walk));
      g.coordinates = walk(g.coordinates);
      createFeature({ geometry: g, properties: f.properties, style: f.style, name: (f.name || "") + " copy", category: f.category, layer: f.layer });
    }
    if (a === "buffer") {
      const d = parseFloat(prompt("Buffer distance in metres", "50"));
      if (d > 0) bufferSel(d);
    }
    if (a === "analyse") { S.an.target = "selected"; showTab("analyse"); }
    if (a === "carbon") showTab("carbon");
    if (a === "register") showTab("registry");
    if (a === "grid") { const c = parseFloat(prompt("Sample plot spacing in metres", "100")); if (c > 0) gridSel(c); }
    if (a === "front") saveSel({ z: Math.max(0, ...Array.from(S.feats.values()).map((x) => x.z || 0)) + 1 });
    if (a === "delete") {
      if (!confirm(`Delete “${f.name || CAT[f.category]}”?`)) return;
      const r = await call(`feature-delete/${f.id}/`, {});
      if (r.ok) { S.undo.push({ op: "delete", before: f }); removeFeat(f.id); renderLayers(); refreshKPIs(); }
    }
  }
  async function bufferSel(d) {
    const f = S.feats.get(S.sel);
    if (!f) return toast("Select something to buffer.");
    const b = turf.buffer(turfOf(f), d / 1000, { units: "kilometers", steps: 24 });
    if (!b) return;
    await createFeature({ geometry: roundGeom(b.geometry), name: `${f.name || CAT[f.category]} + ${d} m buffer`, category: "geofence", is_geofence: true, style: { color: "#f43f5e", dashArray: "6 4", fillOpacity: 0.08 } });
  }
  async function gridSel(cell) {
    const f = S.feats.get(S.sel);
    if (!f) return toast("Select an area first.");
    const poly = turfOf(f);
    const bb = turf.bbox(poly);
    const pts = turf.pointGrid(bb, cell / 1000, { units: "kilometers", mask: poly.geometry ? poly : turf.feature(poly) });
    if (!pts.features.length) return toast("Spacing is larger than the area — try a smaller number.");
    if (pts.features.length > 800) return toast(`That makes ${pts.features.length} plots — use a wider spacing (max 800).`, "err");
    const r = await call("features-bulk/", { features: pts.features.map((p, i) => ({
      geometry: { type: "Point", coordinates: p.geometry.coordinates.map((v) => +v.toFixed(7)) }, name: `Plot ${i + 1}`,
      category: "plot", layer: `Sample plots · ${f.name || "area"}`, properties: { icon: "🎯", radius: undefined }, style: { iconSize: 22, color: "#e879f9" } })) });
    if (r.ok) { r.features.forEach((x) => upsert(x)); renderLayers(); toast(`${r.created} field sample plots laid out every ${cell} m — export as GPX/GeoJSON for the field team.`, "ok"); }
  }
  function roundGeom(g) { const w = (x) => (typeof x[0] === "number" ? [+x[0].toFixed(7), +x[1].toFixed(7)] : x.map(w)); return { type: g.type, coordinates: w(g.coordinates) }; }

  // ───────────────────────────── KPIs ─────────────────────────────
  function refreshKPIs() {
    const fs = Array.from(S.feats.values());
    const ha = fs.reduce((s, f) => s + (f.geometry.type !== "LineString" ? f.area_m2 : 0), 0) / 10000;
    const credits = S.assets.reduce((s, a) => s + (a.to_date.credits || 0), 0);
    $("#proj-kpis").innerHTML = [
      ["Shapes", num(fs.length, 0)], ["Mapped area", num(ha, 2) + " ha"],
      ["Location IDs", num(S.records.length, 0)], ["Est. credits", num(credits, 0), "hot"],
    ].map(([k, v, c]) => `<div class="gs-kpi ${c || ""}"><b>${v}</b><small>${k}</small></div>`).join("");
  }

  // ───────────────────────────── layers pane ─────────────────────────────
  const closedLayers = new Set();
  function renderLayers() {
    const groups = {};
    S.feats.forEach((f) => (groups[f.layer] = groups[f.layer] || []).push(f));
    $("#layer-count").textContent = `${S.feats.size} shapes`;
    $("#layer-list").innerHTML = Object.keys(groups).sort().map((name) => {
      const fs = groups[name];
      const hidden = fs.every((f) => f.hidden);
      const ha = fs.reduce((s, f) => s + f.area_m2, 0) / 10000;
      return `<div class="gs-layer${closedLayers.has(name) ? " closed" : ""}" data-layer="${esc(name)}">
        <div class="gs-layer-head">
          <button class="ic gs-btn gs-btn-ghost" data-l="eye" title="Show / hide"><i class="bi bi-eye${hidden ? "-slash" : ""}"></i></button>
          <span class="nm" data-l="toggle">${esc(name)} <span class="gs-dim">(${fs.length}${ha ? " · " + num(ha, 2) + " ha" : ""})</span></span>
          <button class="ic gs-btn gs-btn-ghost" data-l="fit" title="Zoom to layer"><i class="bi bi-arrows-fullscreen"></i></button>
          <button class="ic gs-btn gs-btn-ghost" data-l="rename" title="Rename"><i class="bi bi-pencil"></i></button>
          <button class="ic gs-btn gs-btn-ghost" data-l="del" title="Delete layer"><i class="bi bi-trash"></i></button>
        </div>
        <div class="gs-layer-body">${fs.slice(0, 300).map((f) => `<div class="gs-item${S.sel === f.id ? " sel" : ""}" data-id="${f.id}">
          <span class="sw" style="background:${esc(colorOf(f))}"></span>
          <span class="nm">${esc((f.properties || {}).icon || "")} ${esc(f.name || CAT[f.category])}</span>
          <span class="mt">${f.area_m2 ? fmtArea(f.area_m2) : f.length_m ? fmtLen(f.length_m) : ""}</span>
          ${f.is_geofence ? '<i class="bi bi-shield-check" title="geofence" style="color:#f43f5e"></i>' : ""}
          ${f.locked ? '<i class="bi bi-lock" title="locked"></i>' : ""}</div>`).join("")}
          ${fs.length > 300 ? `<div class="gs-dim">…and ${fs.length - 300} more</div>` : ""}</div></div>`;
    }).join("") || `<p class="gs-dim">Nothing drawn yet.</p>`;
    $$("#layer-list .gs-item").forEach((el) => el.addEventListener("click", () => select(el.dataset.id, { zoom: true })));
    $$("#layer-list .gs-layer").forEach((el) => {
      const name = el.dataset.layer;
      el.querySelectorAll("[data-l]").forEach((b) => b.addEventListener("click", async (e) => {
        e.stopPropagation();
        const op = b.dataset.l;
        if (op === "toggle") { closedLayers.has(name) ? closedLayers.delete(name) : closedLayers.add(name); el.classList.toggle("closed"); return; }
        if (op === "fit") { const g = L.featureGroup(Array.from(S.lay.values()).filter((l) => (S.feats.get(l._fid) || {}).layer === name)); if (g.getLayers().length) map.fitBounds(g.getBounds().pad(0.2)); return; }
        let body = { layer: name };
        if (op === "eye") body = Object.assign(body, { op: "hide", hidden: !Array.from(S.feats.values()).filter((f) => f.layer === name).every((f) => f.hidden) });
        if (op === "rename") { const to = prompt("Rename layer", name); if (!to) return; body = Object.assign(body, { op: "rename", to }); }
        if (op === "del") { if (!confirm(`Delete every unlocked, unregistered shape in “${name}”?`)) return; body.op = "delete"; }
        const r = await call("layer/", body);
        if (r.ok) loadState(r);
      }));
    });
    renderImagery();
  }

  // ───────────────────────────── imagery ─────────────────────────────
  function renderImagery() {
    S.imgLayers.forEach((l, id) => { if (!S.imagery.find((i) => i.id === id)) { map.removeLayer(l); S.imgLayers.delete(id); } });
    S.imagery.forEach((im) => {
      if (!S.imgLayers.has(im.id)) {
        const [w, s, e, n] = im.bounds;
        S.imgLayers.set(im.id, L.imageOverlay(im.url, [[s, w], [n, e]], { opacity: im.opacity, zIndex: 250 }).addTo(map));
      }
    });
    $("#imagery-list").innerHTML = S.imagery.map((im) => `<div class="gs-item" data-img="${im.id}">
      <span class="nm">🛩️ ${esc(im.name)} <span class="gs-dim">${esc(im.captured_on || "")}</span></span>
      <input type="range" min="0" max="1" step="0.05" value="${im.opacity}" style="width:80px">
      <button class="ic" data-fit title="Zoom"><i class="bi bi-arrows-fullscreen"></i></button>
      <button class="ic" data-del title="Remove"><i class="bi bi-trash"></i></button></div>`).join("");
    $$("#imagery-list [data-img]").forEach((el) => {
      const id = el.dataset.img, l = S.imgLayers.get(id);
      $("input", el).addEventListener("input", (e) => l.setOpacity(+e.target.value));
      $("input", el).addEventListener("change", (e) => call(`imagery/${id}/`, { opacity: +e.target.value }, { quiet: true }));
      $("[data-fit]", el).addEventListener("click", () => map.fitBounds(l.getBounds()));
      $("[data-del]", el).addEventListener("click", async () => { if (confirm("Remove this image?")) { const r = await call(`imagery/${id}/`, { delete: true }); if (r.ok) { S.imagery = S.imagery.filter((i) => i.id !== id); renderImagery(); renderAnalyse(); } } });
    });
  }
  function fillBounds(b) { $("#img-w").value = b.getWest().toFixed(7); $("#img-s").value = b.getSouth().toFixed(7); $("#img-e").value = b.getEast().toFixed(7); $("#img-n").value = b.getNorth().toFixed(7); }
  $("#img-fit-view").addEventListener("click", () => fillBounds(map.getBounds()));
  $("#img-fit-sel").addEventListener("click", () => { const l = S.sel && S.lay.get(S.sel); if (l && l.getBounds) fillBounds(l.getBounds()); else toast("Select an area first."); });
  $("#img-upload").addEventListener("click", async () => {
    const f = $("#img-file").files[0];
    if (!f) return toast("Choose an orthophoto image first.");
    const fd = new FormData();
    fd.append("file", f); fd.append("name", f.name);
    ["w", "s", "e", "n"].forEach((k, i) => fd.append(["west", "south", "east", "north"][i], $("#img-" + k).value));
    fd.append("captured_on", $("#img-date").value);
    busy(true, "Uploading imagery…");
    const r = await call("imagery/", fd);
    busy(false);
    if (r.ok) { S.imagery.push(r.imagery); renderImagery(); renderAnalyse(); map.fitBounds(S.imgLayers.get(r.imagery.id).getBounds()); toast("Drone image pinned. Pick it as the imagery source in Analyse.", "ok"); }
  });

  // imports
  $("#imp-survey").innerHTML = `<option value="">Choose a survey…</option>` + CFG.surveys.map((s) => `<option value="${esc(s.code)}">${esc(s.title)} (${esc(s.code)})</option>`).join("");
  $("#imp-survey-go").addEventListener("click", async () => {
    const code = $("#imp-survey").value;
    if (!code) return;
    busy(true, "Importing survey layers…");
    const r = await call("import-survey/", { code });
    busy(false);
    if (r.ok) { r.features.forEach((f) => upsert(f)); renderLayers(); fitAll(); toast(`${r.created} shapes imported from ${esc(code)}.`, "ok"); }
  });
  $("#imp-file").addEventListener("change", async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fd = new FormData(); fd.append("file", f);
    const r = await call("import-file/?layer=" + encodeURIComponent(f.name.replace(/\.[^.]+$/, "")), fd);
    if (r.ok) { r.features.forEach((x) => upsert(x)); renderLayers(); fitAll(); toast(`${r.created} shapes imported.`, "ok"); }
    e.target.value = "";
  });

  // ───────────────────────────── analysis ─────────────────────────────
  function seg(id, key) {
    $$(`#${id} button`).forEach((b) => {
      b.classList.toggle("on", b.dataset.v === S.an[key]);
      b.onclick = () => { S.an[key] = b.dataset.v; seg(id, key); };
    });
  }
  function renderAnalyse() {
    seg("an-target", "target"); seg("an-kind", "kind"); seg("an-engine", "engine");
    const ai = $(`#an-engine [data-v="ai"]`);
    ai.disabled = !CFG.ai_enabled;
    $("#an-ai-note").innerHTML = CFG.ai_enabled ? "AI vision uses your Gemini key (same quota as Hanns &amp; Foon)." : "AI vision is off — add <code>GEMINI_API_KEY</code> to .env. The pixel engine works without it.";
    if (!CFG.ai_enabled && S.an.engine === "ai") { S.an.engine = "pixel"; seg("an-engine", "engine"); }
    const src = $("#an-source"), v = src.value;
    src.innerHTML = `<option value="">Satellite tiles</option>` + S.imagery.map((i) => `<option value="${i.id}">🛩️ ${esc(i.name)}</option>`).join("");
    src.value = v;
    $("#an-history").innerHTML = S.analyses.map((a) => {
      const s = a.summary || {};
      const f = a.feature_id && S.feats.get(a.feature_id);
      return `<div class="gs-item" data-an="${a.id}"><span class="nm">${{ trees: "🌳", solar: "☀️", landcover: "🧩", full: "✨" }[a.kind] || ""} ${esc(f ? f.name || CAT[f.category] : "View area")}
        <span class="gs-dim">${new Date(a.created_at).toLocaleString()}</span></span>
        <span class="mt">${s.tree_count != null ? num(s.tree_count, 0) + " 🌳" : ""} ${s.canopy_ha != null ? num(s.canopy_ha, 2) + " ha" : ""} ${s.solar_area_m2 ? num(s.solar_kwp, 0) + " kWp" : ""}</span></div>`;
    }).join("") || `<p class="gs-dim">No analyses yet.</p>`;
    $$("#an-history [data-an]").forEach((el) => el.addEventListener("click", async () => {
      const r = await call(`analysis/${el.dataset.an}/`);
      if (r.ok) showAnalysis(r.analysis, true);
    }));
  }
  function viewPolygon() {
    const b = map.getBounds().pad(-0.04);
    const r = [[b.getWest(), b.getSouth()], [b.getEast(), b.getSouth()], [b.getEast(), b.getNorth()], [b.getWest(), b.getNorth()], [b.getWest(), b.getSouth()]];
    return { type: "Polygon", coordinates: [r.map((p) => p.map((v) => +v.toFixed(7)))] };
  }
  async function runAnalysis(opts = {}) {
    Object.assign(S.an, opts);
    const body = { kind: S.an.kind, engine: S.an.engine, imagery_id: $("#an-source").value || null, zoom: $("#an-zoom").value || null };
    const f = S.sel && S.feats.get(S.sel);
    if (S.an.target === "selected") {
      if (!f || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon" && !(f.properties || {}).radius)) {
        toast("Select an area (shape, box or circle) — or switch Area to “Current view”.");
        showTab("analyse");
        return;
      }
      body.feature_id = f.id;
    } else body.geometry = viewPolygon();
    showTab("analyse");
    busy(true, { trees: "Counting trees & measuring canopy…", solar: "Scanning rooftops for solar panels…", landcover: "Classifying land cover…", full: "Running full scene analysis…" }[S.an.kind]);
    const r = await call("analyze/", body);
    busy(false);
    if (!r.ok) return;
    S.analyses.unshift(Object.assign({}, r.analysis, { result: undefined }));
    showAnalysis(r.analysis, false);
    renderAnalyse();
    reloadAssets();
  }
  $("#an-run").addEventListener("click", () => runAnalysis());

  function showAnalysis(a, fit) {
    const res = a.result || {}, s = res.summary || {}, px = res.pixel || {}, ai = res.ai || {};
    if (S.overlay) map.removeLayer(S.overlay);
    if (S.dets) map.removeLayer(S.dets);
    S.overlay = a.overlay ? L.imageOverlay(a.overlay, a.bounds, { opacity: 0.8, zIndex: 300 }).addTo(map) : null;
    S.dets = L.layerGroup().addTo(map);
    (res.detections || []).forEach((d) => {
      const c = { tree: "#22c55e", palm: "#a3e635", mangrove: "#10b981", solar: "#38bdf8", building: "#f97316", water: "#3b82f6" }[d.label] || "#facc15";
      if (d.polygon && (d.label === "solar" || d.source === "ai")) {
        L.polygon(d.polygon.map((p) => [p[1], p[0]]), { color: c, weight: d.source === "ai" ? 1.5 : 2, fillOpacity: 0.15, dashArray: d.source === "ai" ? "4 3" : null, renderer: canvas })
          .bindTooltip(`${esc(d.raw_label || d.label)}${d.area_m2 ? " · " + num(d.area_m2, 0) + " m²" : ""}${d.confidence ? " · " + Math.round(d.confidence * 100) + "%" : ""} (${d.source})`, { className: "gs-tip" }).addTo(S.dets);
      } else L.circleMarker([d.lat, d.lng], { radius: 3, color: c, weight: 1, fillOpacity: 0.9, renderer: canvas }).addTo(S.dets);
    });
    if (fit && a.bounds && a.bounds.length) map.fitBounds(a.bounds);
    const lc = px.landcover_pct || {};
    const coverBar = Object.keys(lc).length ? `<div class="gs-cover">${[["canopy", "#22c55e"], ["water", "#3b82f6"], ["built", "#f97316"], ["bare", "#d6b38a"]].map(([k, c]) => `<i style="width:${lc[k] || 0}%;background:${c}"></i>`).join("")}</div>
      <div class="gs-legend">${[["canopy", "#22c55e"], ["water", "#3b82f6"], ["built", "#f97316"], ["bare", "#d6b38a"]].map(([k, c]) => `<span style="--c:${c}">${k} ${num(lc[k], 1)}%</span>`).join("")}</div>` : "";
    const counts = s.ai_counts ? Object.entries(s.ai_counts).map(([k, v]) => `${k}: <b>${v}</b>`).join(" · ") : "";
    $("#an-result").innerHTML = `<div class="gs-result">
      <div class="gs-sec-head"><h4>Result · ${esc(a.engine)}${s.ai_model ? " · " + esc(s.ai_model) : ""}</h4>
        <span class="gs-dim">${s.resolution_m ? num(s.resolution_m, 2) + " m/px" : ""}</span></div>
      <div class="gs-big">
        <div><small>Area analysed</small><b>${num(s.aoi_ha, 2)} ha</b></div>
        ${s.canopy_ha != null ? `<div><small>Tree canopy</small><b>${num(s.canopy_ha, 2)} ha</b><small>${num(s.canopy_pct, 1)}% cover</small></div>` : ""}
        ${s.tree_count != null ? `<div><small>Trees / crowns</small><b>${num(s.tree_count, 0)}</b><small>${esc(s.tree_count_source)}${s.tree_count_ai ? " · AI saw " + num(s.tree_count_ai, 0) : ""}</small></div>` : ""}
        ${s.solar_area_m2 != null ? `<div><small>Solar panels</small><b>${num(s.solar_area_m2, 0)} m²</b><small>≈ ${num(s.solar_kwp, 1)} kWp · ${num(s.solar_count, 0)} arrays</small></div>` : ""}
      </div>
      ${coverBar}
      ${s.note ? `<div class="gs-warn">${esc(s.note)}</div>` : ""}
      ${res.ai_error ? `<div class="gs-warn">AI layer skipped: ${esc(res.ai_error)}</div>` : ""}
      ${counts ? `<div class="gs-notes">AI detections — ${counts}</div>` : ""}
      ${s.ai_notes ? `<div class="gs-notes">🤖 ${esc(s.ai_notes)}</div>` : ""}
      <label class="gs-switch"><input type="checkbox" id="ar-ov" checked><span></span> Show classification overlay</label>
      <label class="gs-switch"><input type="checkbox" id="ar-dt" checked><span></span> Show detections (${(res.detections || []).length})</label>
      <div class="gs-row">
        <button class="gs-btn" id="ar-feat"><i class="bi bi-box-arrow-in-down"></i> Save detections as shapes</button>
        ${a.snapshot ? `<a class="gs-btn gs-btn-ghost" href="${esc(a.snapshot)}" target="_blank"><i class="bi bi-image"></i> Evidence image</a>` : ""}
        <button class="gs-btn gs-btn-ghost" id="ar-del" title="Delete this analysis"><i class="bi bi-trash"></i></button>
      </div>
      <div class="gs-hash">SHA-256 of analysed pixels: ${esc(a.sha256 || res.snapshot_sha256 || "")}</div></div>`;
    $("#ar-ov").onchange = (e) => S.overlay && (e.target.checked ? S.overlay.addTo(map) : map.removeLayer(S.overlay));
    $("#ar-dt").onchange = (e) => (e.target.checked ? S.dets.addTo(map) : map.removeLayer(S.dets));
    $("#ar-feat").onclick = async () => {
      const r = await call(`analysis-features/${a.id}/`, {});
      if (r.ok) { r.features.forEach((f) => upsert(f)); renderLayers(); toast(`${r.created} detections saved as editable shapes.`, "ok"); }
    };
    $("#ar-del").onclick = async () => {
      if (!confirm("Delete this analysis and its evidence image?")) return;
      const r = await call(`analysis/${a.id}/`, { delete: true });
      if (r.ok) { S.analyses = S.analyses.filter((x) => x.id !== a.id); $("#an-result").innerHTML = ""; S.overlay && map.removeLayer(S.overlay); S.dets && map.removeLayer(S.dets); renderAnalyse(); }
    };
  }

  // ───────────────────────────── carbon ─────────────────────────────
  async function reloadAssets() { const r = await call("state/", undefined, { quiet: true }); if (r.ok) { S.assets = r.assets; renderCarbon(); refreshKPIs(); } }
  function spark(tl) {
    const pts = tl.filter((t) => t.canopy_ha != null);
    if (pts.length < 2) return "";
    const max = Math.max(...pts.map((p) => p.canopy_ha)) || 1;
    const d = pts.map((p, i) => `${(i / (pts.length - 1)) * 100},${40 - (p.canopy_ha / max) * 34}`).join(" ");
    return `<svg class="gs-spark" viewBox="0 0 100 44" preserveAspectRatio="none"><polyline points="${d}" fill="none" stroke="#22c55e" stroke-width="2" vector-effect="non-scaling-stroke"/></svg><div class="gs-dim gs-small">Canopy over ${pts.length} monitoring runs</div>`;
  }
  function renderCarbon() {
    const A = S.assets;
    const credits = A.reduce((s, a) => s + a.to_date.credits, 0);
    const annual = A.reduce((s, a) => s + a.annual.net_tco2e, 0);
    const value = A.reduce((s, a) => s + (a.to_date.value_usd || 0), 0);
    const ha = A.reduce((s, a) => s + a.hectares, 0);
    $("#carbon-hero").innerHTML = `<small>Estimated credits to date</small><h3>${num(credits, 0)} tCO₂e</h3>
      <div class="gs-grid3"><div><small class="gs-dim">Per year</small><b>${num(annual, 1)}</b></div><div><small class="gs-dim">Hectares</small><b>${num(ha, 2)}</b></div><div><small class="gs-dim">Value</small><b>${value ? "$" + num(value, 0) : "—"}</b></div></div>`;
    const f = S.sel && S.feats.get(S.sel);
    const areaOk = f && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon" || (f.properties || {}).radius);
    const eco = CFG.ecosystems;
    const has = areaOk && A.find((a) => a.feature_id === f.id);
    $("#carbon-form").innerHTML = !areaOk ? `<p class="gs-dim">Select a polygon or circle on the map first.</p>`
      : has ? `<div class="gs-good">“${esc(f.name || CAT[f.category])}” is already an MRV asset — see its card below.</div>` : `
      <div class="gs-good">Area: <b>${esc(f.name || CAT[f.category])}</b> · ${fmtArea(f.area_m2)}</div>
      <label class="gs-lbl">Ecosystem <select class="gs-select" id="c-eco">${Object.entries(eco).map(([k, v]) => `<option value="${k}"${k === f.category ? " selected" : ""}>${v.icon} ${esc(v.label)}</option>`).join("")}</select></label>
      <div class="gs-grid2">
        <label class="gs-lbl">Planted on <input type="date" class="gs-in" id="c-date"></label>
        <label class="gs-lbl">Claimed ha <input type="number" step="0.01" class="gs-in" id="c-ha" placeholder="${num(f.area_m2 / 10000, 2)}"></label>
        <label class="gs-lbl">Trees planted <input type="number" class="gs-in" id="c-trees"></label>
        <label class="gs-lbl">Price $/credit <input type="number" step="0.5" class="gs-in" id="c-price" placeholder="e.g. 15"></label>
      </div>
      <button class="gs-btn gs-btn-hot gs-wide" id="c-add"><i class="bi bi-plus-circle"></i> Create MRV asset</button>`;
    const add = $("#c-add");
    if (add) add.onclick = async () => {
      const r = await call("asset/", { feature_id: f.id, ecosystem: $("#c-eco").value, planted_on: $("#c-date").value, claimed_hectares: $("#c-ha").value || 0, claimed_trees: $("#c-trees").value || 0, price_usd: $("#c-price").value });
      if (r.ok) { S.assets.push(r.asset); renderCarbon(); refreshKPIs(); toast("Asset created. Run an analysis on it to add a monitoring point.", "ok"); }
    };
    $("#carbon-list").innerHTML = A.map((a) => {
      const v = a.verification || {};
      const checks = [];
      if (v.hectares_claimed != null) checks.push([Math.abs(v.hectares_diff_pct) <= 5, `Mapped ${num(v.hectares_mapped, 2)} ha vs claimed ${num(v.hectares_claimed, 2)} ha (${v.hectares_diff_pct > 0 ? "+" : ""}${num(v.hectares_diff_pct, 1)}%)`]);
      if (v.canopy_vs_claim_pct != null) checks.push([v.canopy_vs_claim_pct >= 60, `Canopy covers ${num(v.canopy_vs_claim_pct, 0)}% of the claimed hectares`]);
      if (v.survival_pct != null) checks.push([v.survival_pct >= 70, `${num(v.trees_detected, 0)} trees detected of ${num(v.trees_claimed, 0)} planted — ${num(v.survival_pct, 0)}% survival`]);
      if (!a.latest) checks.push([null, "No monitoring analysis yet — select the area and run Analyse"]);
      const e = a.to_date;
      return `<div class="gs-asset" data-asset="${a.id}">
        <div class="gs-asset-head"><span class="ico">${a.icon}</span><div class="gs-grow"><b>${esc(a.feature_name)}</b><span class="gs-dim">${esc(a.ecosystem_label)} · ${num(a.hectares, 2)} ha${a.planted_on ? " · planted " + esc(a.planted_on) : ""}</span></div>
          <select class="gs-select" data-st>${["planning", "monitoring", "validated", "verified", "issued"].map((s) => `<option${s === a.status ? " selected" : ""}>${s}</option>`).join("")}</select></div>
        <div class="gs-big">
          <div><small>Credits to date</small><b>${num(e.credits, 0)}</b><small>${num(a.years, 1)} yrs · net of ${Math.round(e.buffer * 100)}% buffer</small></div>
          <div><small>${a.ecosystem === "solar" ? "Avoided / yr" : "Removals / yr"}</small><b>${num(a.annual.net_tco2e, 1)} t</b><small>${a.ecosystem === "solar" ? num(a.annual.kwp, 0) + " kWp · " + num(a.annual.mwh_yr, 0) + " MWh/yr" : num(a.annual.seq_t_ha_yr, 1) + " t/ha/yr"}</small></div>
          ${a.ecosystem !== "solar" ? `<div><small>Standing stock</small><b>${num(e.standing_stock_tco2e, 0)} t</b><small>CO₂e in biomass</small></div>` : ""}
          <div><small>Expected trees</small><b>${num(e.expected_trees, 0)}</b><small>at typical density</small></div>
          ${e.value_usd ? `<div><small>Value</small><b>$${num(e.value_usd, 0)}</b><small>at $${num(a.price_usd, 2)}</small></div>` : ""}
        </div>
        ${spark(a.timeline)}
        <ul class="gs-checks">${checks.map(([ok, t]) => `<li>${ok === null ? "⏳" : ok ? "✅" : "⚠️"} ${esc(t)}</li>`).join("")}</ul>
        <div class="gs-dim gs-small">Methodology to look at: ${esc(e.methodology_hint)}</div>
        <details><summary class="gs-dim gs-small" style="cursor:pointer">Adjust factors</summary>
          <div class="gs-grid2">
            ${a.ecosystem === "solar"
              ? `<label class="gs-lbl">Grid EF t/MWh <input class="gs-in" data-ov="grid_ef_t_mwh" value="${a.overrides.grid_ef_t_mwh || a.annual.grid_ef_t_mwh}"></label><label class="gs-lbl">Yield kWh/kWp <input class="gs-in" data-ov="yield_kwh_kwp_yr" value="${a.overrides.yield_kwh_kwp_yr || a.annual.yield_kwh_kwp_yr}"></label>`
              : `<label class="gs-lbl">tCO₂e/ha/yr <input class="gs-in" data-ov="seq_t_ha_yr" value="${a.overrides.seq_t_ha_yr || a.annual.seq_t_ha_yr}"></label>`}
            <label class="gs-lbl">Buffer (0–1) <input class="gs-in" data-ov="buffer" value="${a.overrides.buffer != null ? a.overrides.buffer : e.buffer}"></label>
          </div>
          <button class="gs-btn" data-saveov>Save factors</button>
        </details>
        <div class="gs-row"><button class="gs-btn" data-zoom><i class="bi bi-zoom-in"></i> Show</button><button class="gs-btn" data-mon><i class="bi bi-radar"></i> Monitor now</button><button class="gs-btn gs-btn-ghost" data-del><i class="bi bi-trash"></i></button></div>
      </div>`;
    }).join("");
    $$("#carbon-list [data-asset]").forEach((el) => {
      const a = S.assets.find((x) => x.id === el.dataset.asset);
      const upd = async (body) => { const r = await call(`asset/${a.id}/`, body); if (r.ok && r.asset) { Object.assign(a, r.asset); renderCarbon(); refreshKPIs(); } return r; };
      $("[data-st]", el).onchange = (e) => upd({ status: e.target.value });
      $("[data-zoom]", el).onclick = () => select(a.feature_id, { zoom: true });
      $("[data-mon]", el).onclick = () => { select(a.feature_id, { zoom: true }); runAnalysis({ target: "selected", kind: a.ecosystem === "solar" ? "solar" : "trees" }); };
      $("[data-del]", el).onclick = async () => { if (confirm("Remove this MRV asset? (The shape stays.)")) { const r = await call(`asset/${a.id}/`, { delete: true }); if (r.ok) { S.assets = S.assets.filter((x) => x.id !== a.id); renderCarbon(); } } };
      $("[data-saveov]", el).onclick = () => { const ov = {}; $$("[data-ov]", el).forEach((i) => (ov[i.dataset.ov] = i.value)); upd({ overrides: ov }); };
    });
  }

  // ───────────────────────────── registry ─────────────────────────────
  async function renderRegistry() {
    const f = S.sel && S.feats.get(S.sel);
    const form = $("#reg-form");
    if (!f) form.innerHTML = `<p class="gs-dim">Select a parcel, circle or point on the map to issue a Location ID.</p>`;
    else {
      const existing = S.records.filter((r) => r.feature_id === f.id && r.status !== "retired");
      form.innerHTML = `<div class="gs-dim">Checking boundary…</div>`;
      const pv = await call("overlap/", { feature_id: f.id }, { quiet: true });
      if (S.sel !== f.id) return;
      form.innerHTML = `
        <div class="gs-row"><span class="gs-id">${esc(pv.preview_id || "")}</span>${existing.length ? '<span class="gs-pill">already issued</span>' : '<span class="gs-pill">preview</span>'}</div>
        <div class="gs-hash">SHA-256 ${esc(pv.hash || "")}</div>
        <div class="gs-dim">Plus code <code>${esc(pv.plus_code || "")}</code> · ${fmtArea(f.area_m2)}</div>
        ${(pv.overlaps || []).length ? `<div class="gs-warn gs-bad">⚠ Overlaps registered land: ${pv.overlaps.map((o) => esc(o.code + (o.label ? " (" + o.label + ")" : ""))).join(", ")}</div>` : `<div class="gs-good">✓ No overlap with registered land</div>`}
        ${existing.length ? "" : `
        <label class="gs-lbl">Label <input class="gs-in" id="r-label" value="${esc(f.name)}" placeholder="e.g. Plot 14, Brufut extension"></label>
        <div class="gs-grid2">
          <label class="gs-lbl">Holder / allocatee <input class="gs-in" id="r-holder" placeholder="Name or organisation"></label>
          <label class="gs-lbl">Contact <input class="gs-in" id="r-contact" placeholder="Phone / email (private)"></label>
          <label class="gs-lbl">Tenure <select class="gs-select" id="r-tenure">${CFG.tenures.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select></label>
          <label class="gs-lbl">Land use <input class="gs-in" id="r-use" placeholder="Residential, farm, mangrove…"></label>
        </div>
        <label class="gs-lbl">Parent ID <span class="gs-dim">for a subdivision</span><input class="gs-in" id="r-parent" placeholder="${esc(CFG.id_prefix)}-…"></label>
        ${(pv.overlaps || []).length ? `<label class="gs-switch"><input type="checkbox" id="r-ovl"><span></span> Allow overlap (lease / easement — recorded in the ledger)</label>` : ""}
        <button class="gs-btn gs-btn-hot gs-wide" id="r-go"><i class="bi bi-fingerprint"></i> Issue Location ID</button>`}`;
      const go = $("#r-go");
      if (go) go.onclick = async () => {
        const r = await call("register/", { feature_id: f.id, label: $("#r-label").value, holder_name: $("#r-holder").value, holder_contact: $("#r-contact").value, tenure: $("#r-tenure").value, land_use: $("#r-use").value, parent: $("#r-parent").value, allow_overlap: !!($("#r-ovl") && $("#r-ovl").checked) });
        if (r.ok) { S.records.unshift(r.record); upsert(r.feature); toast(`Issued <b>${esc(r.record.code)}</b>`, "ok"); renderRegistry(); openRecord(r.record.id); refreshKPIs(); }
      };
    }
    const q = ($("#reg-filter").value || "").toLowerCase();
    $("#reg-list").innerHTML = S.records.filter((r) => !q || (r.code + r.label + r.holder_name + r.plus_code).toLowerCase().includes(q)).map((r) =>
      `<div class="gs-item" data-rec="${r.id}"><span class="nm"><b style="font-family:var(--mono)">${esc(r.code)}</b> ${esc(r.label)}<br><span class="gs-dim">${esc(r.holder_name || "—")} · ${esc(r.tenure_label)} · ${num(r.hectares, 3)} ha</span></span><span class="gs-pill">${esc(r.status_label)}</span></div>`).join("") || `<p class="gs-dim">No Location IDs yet.</p>`;
    $$("#reg-list [data-rec]").forEach((el) => el.onclick = () => openRecord(el.dataset.rec));
  }
  $("#reg-filter").addEventListener("input", () => renderRegistry());
  async function openRecord(id) {
    const r = await call(`record/${id}/`);
    if (!r.ok) return;
    const rec = r.record;
    if (rec.feature_id && S.feats.get(rec.feature_id)) { S.sel = null; select(rec.feature_id, { zoom: true }); showTab("registry"); }
    const url = CFG.verify_base + encodeURIComponent(rec.code) + "/";
    $("#reg-detail").innerHTML = `<div class="gs-sec">
      <div class="gs-sec-head"><span class="gs-id">${esc(rec.code)}</span><span class="gs-pill">${esc(rec.status_label)}</span></div>
      ${r.chain.ok ? `<div class="gs-good">🔗 Ledger intact · ${r.chain.events} events · boundary unchanged</div>` : `<div class="gs-warn gs-bad">⛓ Chain broken at event #${r.chain.broken_at || "?"} — ${esc(r.chain.reason)}</div>`}
      ${(r.overlaps || []).length ? `<div class="gs-warn">Overlaps ${r.overlaps.map((o) => esc(o.code)).join(", ")}</div>` : ""}
      <div class="gs-measure"><div><small>Holder</small><b>${esc(rec.holder_name || "—")}</b></div><div><small>Area</small><b>${num(rec.hectares, 4)} ha</b></div>
        <div><small>Tenure</small><b>${esc(rec.tenure_label)}</b></div><div><small>Plus code</small><b>${esc(rec.plus_code)}</b></div></div>
      <div class="gs-qr" id="rec-qr"></div>
      <div class="gs-row"><a class="gs-btn" target="_blank" href="${url}"><i class="bi bi-patch-check"></i> Public certificate</a><button class="gs-btn gs-btn-ghost" id="rec-copy"><i class="bi bi-clipboard"></i> Copy link</button></div>
      <h4 style="margin-top:.8rem">History</h4>
      <ul class="gs-ledger">${r.ledger.map((e) => `<li><b>${esc(e.label)}</b>${e.party ? " → " + esc(e.party) : ""}${e.details && e.details.note ? `<br>${esc(e.details.note)}` : ""}${e.details && e.details.from ? `<small>from ${esc(e.details.from)}</small>` : ""}<small>${new Date(e.at).toLocaleString()} · ${esc(e.actor)} · #${e.hash.slice(0, 12)}</small></li>`).join("")}</ul>
      ${rec.status !== "retired" ? `<h4>Record an event</h4>
      <div class="gs-grid2"><select class="gs-select" id="ev-kind">${CFG.events.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select><input class="gs-in" id="ev-party" placeholder="Party (new holder…)"></div>
      <textarea class="gs-in" id="ev-note" placeholder="Note, reference number, witness…" style="margin-top:.4rem"></textarea>
      <button class="gs-btn gs-btn-hot gs-wide" id="ev-go">Append to ledger</button>` : ""}</div>`;
    try { new QRCode($("#rec-qr"), { text: url, width: 128, height: 128 }); } catch (e) { /* qrcode lib missing */ }
    $("#rec-copy").onclick = () => navigator.clipboard.writeText(url).then(() => toast("Link copied", "ok"));
    const go = $("#ev-go");
    if (go) go.onclick = async () => {
      const x = await call(`record/${id}/`, { kind: $("#ev-kind").value, party: $("#ev-party").value, note: $("#ev-note").value });
      if (x.ok) { const i = S.records.findIndex((q) => q.id === id); if (i >= 0) S.records[i] = x.record; openRecord(id); renderRegistry(); toast("Event chained to the ledger.", "ok"); }
    };
  }

  // ───────────────────────────── tracking ─────────────────────────────
  function renderTrack() {
    const fences = Array.from(S.feats.values()).filter((f) => f.is_geofence);
    $("#fence-list").innerHTML = fences.map((f) => `<div class="gs-item" data-id="${f.id}"><span class="sw" style="background:${esc(colorOf(f))}"></span><span class="nm">${esc(f.name || "Geofence")}</span><span class="mt">${fmtArea(f.area_m2)}</span></div>`).join("") || `<p class="gs-dim">No geofences yet — draw a circle or shape and switch on Geofence.</p>`;
    $$("#fence-list [data-id]").forEach((el) => (el.onclick = () => select(el.dataset.id, { zoom: true })));
    $("#trk-list").innerHTML = S.trackers.map((t) => {
      const url = CFG.tracker_base + t.token + "/";
      const inside = (t.inside || []).map((id) => (S.feats.get(id) || {}).name || "geofence");
      return `<div class="gs-asset" data-trk="${t.id}">
        <div class="gs-asset-head"><span class="gs-tracker" style="--c:${esc(t.color)};animation:none"></span><div class="gs-grow"><b>${esc(t.name)}</b>
          <span class="gs-dim">${t.last_seen ? "seen " + new Date(t.last_seen).toLocaleTimeString() : "not started"}${inside.length ? " · in " + esc(inside.join(", ")) : ""}</span></div>
          <label class="gs-switch" title="Active"><input type="checkbox" data-act${t.active ? " checked" : ""}><span></span></label></div>
        <div class="gs-row"><input class="gs-in gs-grow" value="${esc(url)}" readonly><button class="gs-btn" data-copy>Copy</button></div>
        <div class="gs-qr" data-qr hidden></div>
        <div class="gs-row"><button class="gs-btn gs-btn-ghost" data-showqr><i class="bi bi-qr-code"></i> QR</button><button class="gs-btn gs-btn-ghost" data-trail><i class="bi bi-signpost-split"></i> Trail</button><button class="gs-btn gs-btn-ghost" data-go><i class="bi bi-geo"></i> Find</button><button class="gs-btn gs-btn-ghost" data-del><i class="bi bi-trash"></i></button></div></div>`;
    }).join("");
    $$("#trk-list [data-trk]").forEach((el) => {
      const t = S.trackers.find((x) => x.id === el.dataset.trk);
      const url = CFG.tracker_base + t.token + "/";
      $("[data-copy]", el).onclick = () => navigator.clipboard.writeText(url).then(() => toast("Tracker link copied — open it on the phone.", "ok"));
      $("[data-showqr]", el).onclick = () => { const q = $("[data-qr]", el); q.hidden = !q.hidden; if (!q.innerHTML) try { new QRCode(q, { text: url, width: 140, height: 140 }); } catch (e) {} };
      $("[data-act]", el).onchange = (e) => call(`tracker/${t.id}/`, { active: e.target.checked });
      $("[data-go]", el).onclick = () => (t.lat != null ? map.setView([t.lat, t.lng], 17) : toast("No position yet."));
      $("[data-del]", el).onclick = async () => { if (confirm("Delete this tracker and its trail?")) { const r = await call(`tracker/${t.id}/`, { delete: true }); if (r.ok) { S.trackers = S.trackers.filter((x) => x.id !== t.id); const m = S.trkMarkers.get(t.id); m && map.removeLayer(m); renderTrack(); } } };
      $("[data-trail]", el).onclick = async () => {
        const r = await call(`tracker/${t.id}/`, { trail: true });
        if (r.ok && r.trail.length) { const l = L.polyline(r.trail.map((p) => [p[0], p[1]]), { color: t.color, weight: 3, opacity: 0.85 }).addTo(map); map.fitBounds(l.getBounds().pad(0.2)); toast(`${r.trail.length} points · ${fmtLen(turf.length(turf.lineString(r.trail.length > 1 ? r.trail.map((p) => [p[1], p[0]]) : [[r.trail[0][1], r.trail[0][0]], [r.trail[0][1], r.trail[0][0]]]), { units: "kilometers" }) * 1000)}`); }
        else toast("No trail yet.");
      };
    });
    $("#evt-list").innerHTML = S.events.map((e) => `<div class="${e.kind}">${e.kind === "enter" ? "⬇ entered" : "⬆ left"} <b>${esc(e.feature)}</b> — ${esc(e.tracker)}<br><span class="gs-dim">${new Date(e.at).toLocaleString()}</span></div>`).join("") || `<p class="gs-dim">No events yet.</p>`;
    S.trackers.forEach(drawTracker);
  }
  function drawTracker(t) {
    if (t.lat == null) return;
    let m = S.trkMarkers.get(t.id);
    const icon = L.divIcon({ className: "", iconSize: [18, 18], iconAnchor: [9, 9], html: `<div class="gs-tracker" style="--c:${esc(t.color)}"></div><span class="gs-tracker-label">${esc(t.name)}</span>` });
    if (!m) { m = L.marker([t.lat, t.lng], { icon, zIndexOffset: 1000 }).addTo(map); S.trkMarkers.set(t.id, m); }
    else { m.setLatLng([t.lat, t.lng]); m.setIcon(icon); }
  }
  $("#trk-add").addEventListener("click", async () => {
    const r = await call("tracker/", { name: $("#trk-name").value, color: $("#trk-color").value });
    if (r.ok) { S.trackers.push(r.tracker); $("#trk-name").value = ""; renderTrack(); }
  });

  // ───────────────────────────── AI search bar ─────────────────────────────
  const Q = $("#gs-q"), RES = $("#gs-results");
  function closeResults() { RES.hidden = true; }
  document.addEventListener("click", (e) => { if (!e.target.closest("#gs-search")) closeResults(); });
  Q.addEventListener("keydown", (e) => { if (e.key === "Enter") ask(Q.value); if (e.key === "Escape") closeResults(); });
  $("#gs-q-go").addEventListener("click", () => ask(Q.value));
  $$("[data-ask]").forEach((a) => a.addEventListener("click", () => { Q.value = a.dataset.ask; ask(a.dataset.ask); }));

  async function ask(msg) {
    msg = (msg || "").trim();
    if (!msg) return;
    RES.hidden = false;
    RES.innerHTML = `<div class="reply">✦ Thinking…</div>`;
    const sel = S.sel && S.feats.get(S.sel);
    const b = map.getBounds();
    const r = await call("ai/", { message: msg, view: { center: [map.getCenter().lat, map.getCenter().lng], zoom: map.getZoom(), bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] },
      selected: sel ? { id: sel.id, name: sel.name, category: sel.category, hectares: sel.area_m2 / 10000, type: sel.geometry.type } : null });
    if (!r.ok) { closeResults(); return; }
    RES.innerHTML = r.reply ? `<div class="reply">✦ ${esc(r.reply)}</div>` : "";
    let shown = !!r.reply;
    for (const a of r.actions || []) { const keep = await runAction(a); shown = shown || keep; }
    if (!shown) closeResults();
  }

  async function geocodeTo(q, opts = {}) {
    const r = await call("search/?q=" + encodeURIComponent(q), undefined, { quiet: true });
    if (!r.ok) return null;
    const items = [];
    r.records.forEach((x) => items.push({ kind: "record", icon: "🔏", title: x.code, sub: `${x.label || ""} ${x.holder || ""}`.trim() || "Location ID", x }));
    r.features.forEach((x) => items.push({ kind: "feature", icon: "🗺", title: x.name || CAT[x.category], sub: CAT[x.category], x }));
    r.places.forEach((x) => items.push({ kind: "place", icon: "📍", title: x.name.split(",")[0], sub: x.name, x }));
    if (opts.silent) return items[0] || null;
    if (!items.length) { RES.innerHTML += `<div class="reply">Nothing found for “${esc(q)}”.</div>`; return null; }
    RES.innerHTML += `<div class="h">Results</div>` + items.map((it, i) => `<div class="r" data-i="${i}"><span>${it.icon}</span><div><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></div></div>`).join("");
    $$(".r", RES).forEach((el) => el.addEventListener("click", () => { goItem(items[+el.dataset.i]); closeResults(); }));
    goItem(items[0]);
    return items[0];
  }
  function goItem(it) {
    if (!it) return;
    const x = it.x;
    if (it.kind === "feature") return select(x.id, { zoom: true });
    if (it.kind === "record") {
      if (x.external) { window.open(x.verify, "_blank"); return; }
      if (x.feature_id && S.feats.get(x.feature_id)) select(x.feature_id, { zoom: true });
      else map.setView(x.centroid, 18);
      showTab("registry"); openRecord(x.id);
      return;
    }
    if (S.tempPlace) map.removeLayer(S.tempPlace);
    if (x.geometry) {
      S.tempPlace = L.geoJSON(x.geometry, { style: { color: "#ff8a1f", weight: 2, dashArray: "6 4", fillOpacity: 0.06 } }).addTo(map);
      S.tempPlace.bindPopup(`<b>${esc(x.name.split(",")[0])}</b><br><a href="#" id="tp-save">Save boundary as a shape</a>`).openPopup();
      map.fitBounds(S.tempPlace.getBounds(), { maxZoom: 17 });
      setTimeout(() => { const s = $("#tp-save"); if (s) s.onclick = (e) => { e.preventDefault(); createFeature({ geometry: roundGeom(x.geometry), name: x.name.split(",")[0], category: "aoi", layer: "Places" }); map.removeLayer(S.tempPlace); }; }, 50);
    } else if (x.bbox) map.fitBounds([[x.bbox[0], x.bbox[1]], [x.bbox[2], x.bbox[3]]], { maxZoom: 17 });
    else map.setView([x.lat, x.lng], 16);
  }

  function matchFilter(f, flt) {
    if (!flt) return false;
    if (flt.selected) return f.id === S.sel;
    if (flt.category && f.category !== flt.category) return false;
    if (flt.name_contains && !(f.name || "").toLowerCase().includes(String(flt.name_contains).toLowerCase())) return false;
    if (flt.min_ha != null && f.area_m2 / 10000 < flt.min_ha) return false;
    if (flt.max_ha != null && f.area_m2 / 10000 > flt.max_ha) return false;
    return true;
  }
  async function centerFor(a) {
    if (a.lat != null && a.lng != null) return L.latLng(a.lat, a.lng);
    if (a.place) { const it = await geocodeTo(a.place, { silent: true }); if (it && it.x) { const x = it.x; const ll = x.lat != null ? L.latLng(x.lat, x.lng) : L.latLng(x.centroid[0], x.centroid[1]); return ll; } toast(`Couldn't find “${esc(a.place)}” — drew it at the map centre.`); }
    return map.getCenter();
  }

  async function runAction(a) {
    switch (a.type) {
      case "fly_to": map.setView([a.lat, a.lng], a.zoom || 16); return false;
      case "geocode": await geocodeTo(a.query); return true;
      case "basemap": setBase(a.name); return false;
      case "message": RES.innerHTML += `<div class="reply">${esc(a.text)}</div>`; return true;
      case "draw": {
        const c = await centerFor(a);
        const cat = a.category || "aoi";
        const style = Object.assign({}, a.style || {});
        let g, props = {};
        if (a.shape === "circle") { g = { type: "Point", coordinates: [+c.lng.toFixed(7), +c.lat.toFixed(7)] }; props.radius = Math.max(1, a.radius_m || 100); }
        else if (a.shape === "rectangle") { const h = (a.radius_m || 100) / 1000; const sq = turf.bboxPolygon(turf.bbox(turf.buffer(turf.point([c.lng, c.lat]), h, { units: "kilometers" }))); g = roundGeom(sq.geometry); }
        else if (a.shape === "text") { g = { type: "Point", coordinates: [c.lng, c.lat] }; props.text = a.text || a.name || "Label"; style.color = style.color || "#ffffff"; style.fontSize = 20; }
        else if ((a.shape === "polygon" || a.shape === "line") && Array.isArray(a.coords) && a.coords.length >= 2) {
          const pts = a.coords.map((p) => [+p[1], +p[0]]);
          g = a.shape === "line" ? { type: "LineString", coordinates: pts } : { type: "Polygon", coordinates: [pts.concat([pts[0]])] };
        } else { g = { type: "Point", coordinates: [c.lng, c.lat] }; props.icon = a.icon || "📍"; }
        const f = await createFeature({ geometry: g, properties: props, name: a.name || "", category: cat, style, is_geofence: !!a.is_geofence || cat === "geofence" });
        if (f) zoomTo(f.id);
        return false;
      }
      case "style": {
        const hits = Array.from(S.feats.values()).filter((f) => matchFilter(f, a.filter));
        for (const f of hits) { const r = await call(`feature/${f.id}/`, { style: Object.assign({}, f.style, a.style || {}) }, { quiet: true }); if (r.ok) upsert(r.feature); }
        toast(`Restyled ${hits.length} shape${hits.length === 1 ? "" : "s"}.`, "ok");
        renderInspector();
        return false;
      }
      case "select": {
        if (a.filter && a.filter.location_id) { await geocodeTo(a.filter.location_id); return true; }
        const hits = Array.from(S.feats.values()).filter((f) => matchFilter(f, a.filter));
        RES.innerHTML += `<div class="h">${hits.length} match${hits.length === 1 ? "" : "es"}</div>` + hits.slice(0, 40).map((f) => `<div class="r" data-id="${f.id}"><span class="sw" style="width:12px;height:12px;border-radius:4px;background:${esc(colorOf(f))}"></span><div><b>${esc(f.name || CAT[f.category])}</b><small>${fmtArea(f.area_m2)}</small></div></div>`).join("");
        $$(".r[data-id]", RES).forEach((el) => el.addEventListener("click", () => { select(el.dataset.id, { zoom: true }); closeResults(); }));
        const g = L.featureGroup(hits.map((f) => S.lay.get(f.id)).filter(Boolean));
        if (g.getLayers().length) { map.fitBounds(g.getBounds().pad(0.2), { maxZoom: 18 }); g.eachLayer((l) => { const el = l.getElement && l.getElement(); if (el) { el.classList.remove("gs-flash"); void el.offsetWidth; el.classList.add("gs-flash"); } }); }
        return true;
      }
      case "analyze": closeResults(); await runAnalysis({ kind: a.kind || "trees", engine: CFG.ai_enabled ? a.engine || "hybrid" : "pixel", target: a.target === "view" || !S.sel ? "view" : "selected" }); return false;
      case "buffer": await bufferSel(a.distance_m || 50); return false;
      case "grid": await gridSel(a.cell_m || 100); return false;
      case "register": showTab("registry"); if (!S.sel) toast("Select the parcel to register first."); return false;
      case "geofence": if (S.sel) await saveSel({ is_geofence: a.on !== false }, true); else toast("Select a shape first."); return false;
      case "carbon": showTab("carbon"); setTimeout(() => { const e = $("#c-eco"); if (e && a.ecosystem) e.value = a.ecosystem; }, 30); return false;
      case "measure": setTool("measure"); return false;
      case "layer": return false;
    }
    return false;
  }

  // ───────────────────────────── share / export ─────────────────────────────
  $$("[data-dd]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); const m = $("#dd-" + b.dataset.dd); m.hidden = !m.hidden; }));
  document.addEventListener("click", () => $$(".gs-dd-menu").forEach((m) => (m.hidden = true)));
  $$("[data-export]").forEach((a) => a.addEventListener("click", () => (location.href = API + "export/?format=" + a.dataset.export)));
  $("#gs-png").addEventListener("click", async () => {
    if (!window.html2canvas) return toast("Image export is still loading — try again in a second.");
    busy(true, "Rendering image…");
    try {
      const c = await html2canvas($("#gs-map"), { useCORS: true, backgroundColor: "#0b0d1e", logging: false });
      const a = document.createElement("a"); a.download = (S.project.title || "map") + ".png"; a.href = c.toDataURL("image/png"); a.click();
    } catch (e) { toast("This basemap doesn't allow image export — switch basemap and try again.", "err"); }
    busy(false);
  });
  function shareRefresh() {
    $("#share-on").checked = !!S.project.is_public;
    const url = CFG.public_report.replace(/r\/[^/]+\/$/, "r/" + S.project.share_token + "/");
    $("#share-url").value = url;
    $("#share-qr").innerHTML = "";
    if (S.project.is_public) try { new QRCode($("#share-qr"), { text: url, width: 150, height: 150 }); } catch (e) {}
  }
  $("#gs-share").addEventListener("click", () => { $("#share-modal").hidden = false; shareRefresh(); });
  $("#share-modal").addEventListener("click", (e) => { if (e.target.id === "share-modal" || e.target.dataset.close !== undefined) $("#share-modal").hidden = true; });
  $("#share-on").addEventListener("change", async (e) => { const r = await call("project/", { is_public: e.target.checked }); if (r.ok) { S.project.is_public = r.is_public; shareRefresh(); } });
  $("#share-copy").addEventListener("click", () => navigator.clipboard.writeText($("#share-url").value).then(() => toast("Copied", "ok")));
  $("#share-rotate").addEventListener("click", async () => { if (!confirm("Make a new link? The old one stops working.")) return; const r = await call("project/", { rotate_share: true }); if (r.ok) { S.project.share_token = r.share_token; shareRefresh(); } });
  $("#gs-title").addEventListener("change", (e) => call("project/", { title: e.target.value }).then((r) => r.ok && (document.title = e.target.value + " · Geo Studio · Kura")));

  // ───────────────────────────── rail & keys ─────────────────────────────
  $$("#gs-rail [data-tool]").forEach((b) => b.addEventListener("click", () => setTool(S.tool === b.dataset.tool && b.dataset.tool !== "select" ? "select" : b.dataset.tool)));
  $$("#gs-rail [data-act]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.act === "undo") undo();
    if (b.dataset.act === "locate") map.locate({ setView: true, maxZoom: 18 });
  }));
  map.on("locationfound", (e) => L.circle(e.latlng, { radius: e.accuracy, color: "#22d3ee", weight: 1, fillOpacity: 0.1 }).addTo(map));
  map.on("locationerror", () => toast("Location is blocked in this browser."));
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input,textarea,select")) return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); undo(); return; }
    if (k === "escape") { setTool("select"); closeResults(); return; }
    if ((k === "delete" || k === "backspace") && S.sel) { featureAction("delete", S.feats.get(S.sel)); return; }
    const map_ = { i: "Marker", t: "Text", l: "Line", p: "Polygon", r: "Rectangle", c: "Circle", m: "measure", e: "edit" };
    if (map_[k] && !e.ctrlKey && !e.metaKey) setTool(map_[k]);
    if (k === "/") { e.preventDefault(); Q.focus(); }
  });

  // ───────────────────────────── live socket ─────────────────────────────
  function connect() {
    let ws;
    try { ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + CFG.ws); } catch (e) { return; }
    let ping;
    ws.onopen = () => { $("#gs-live").classList.add("on"); ping = setInterval(() => ws.readyState === 1 && ws.send('{"type":"ping"}'), 25000); };
    ws.onclose = () => { $("#gs-live").classList.remove("on"); clearInterval(ping); setTimeout(connect, 4000); };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.type === "feature" && m.feature) { if (!editing || editing.l._fid !== m.feature.id) upsert(m.feature); }
      if (m.type === "feature_deleted") removeFeat(m.id);
      if (m.type === "tracker") { const i = S.trackers.findIndex((t) => t.id === m.tracker.id); if (i >= 0) { Object.assign(S.trackers[i], m.tracker); drawTracker(S.trackers[i]); } }
      if (m.type === "geofence_event") { S.events.unshift(m.event); S.events = S.events.slice(0, 50); toast(`${m.event.kind === "enter" ? "⬇" : "⬆"} <b>${esc(m.event.tracker)}</b> ${m.event.kind === "enter" ? "entered" : "left"} <b>${esc(m.event.feature)}</b>`, m.event.kind === "enter" ? "ok" : ""); if ($('[data-pane="track"]').classList.contains("on")) renderTrack(); }
    };
  }

  // ───────────────────────────── boot ─────────────────────────────
  function fitAll() {
    const g = L.featureGroup(Array.from(S.lay.values()));
    if (g.getLayers().length) map.fitBounds(g.getBounds().pad(0.15), { maxZoom: 18 });
  }
  function loadState(st) {
    S.lay.forEach((l) => map.removeLayer(l));
    S.lay.clear(); S.feats.clear();
    st.features.sort((a, b) => (a.z || 0) - (b.z || 0)).forEach((f) => upsert(f));
    S.records = st.records; S.analyses = st.analyses; S.assets = st.assets; S.trackers = st.trackers; S.imagery = st.imagery; S.events = st.events;
    S.project = st.project;
    if (S.sel && !S.feats.get(S.sel)) S.sel = null;
    renderLayers(); renderInspector(); refreshKPIs(); renderTrack();
  }
  (async function boot() {
    const st = await call("state/");
    if (!st.ok) return;
    setBase(st.project.basemap || "satellite");
    map.setView(st.project.center, st.project.zoom);
    loadState(st);
    if (st.features.length && st.project.zoom <= 13) fitAll();
    renderAnalyse();
    connect();
  })();
})();
