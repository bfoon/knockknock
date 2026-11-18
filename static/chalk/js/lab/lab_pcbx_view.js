/* Chalk Circuit Lab — the board studio.
 *
 * Replaces the plain board view with a design studio on the same document
 * (the engine is lab_pcbx.js):
 *
 *   tools      Select · Track · Connect · Via · Hole · Hole pattern · Text ·
 *              Copper pour · Keep-out · Board shape · Cut-out · Measure
 *   canvas     zoom to the pad (wheel, pinch, + −), pan (drag the empty
 *              board, or hold Space), grid snap from 0.1 mm to 2.54 mm,
 *              45° track drawing, live air wires, net highlighting
 *   library    every footprint and real component in the left drawer, and
 *              the parts you designed; drag or click to place
 *   inspector  whatever is selected: package, position, side, pins and
 *              their nets and labels, track widths, hole sizes, patterns
 *   checks     the design-rule check, with markers you can click to
 *   assistant  ask about the board, or ask for changes; with an AI key on
 *              the server it is the AI, without one a built-in adviser —
 *              either way changes come back as a list you approve
 *   3-D        the finished board, parts standing on it, to turn round
 *   export     Gerber/drill zip, KiCad board + footprints, parts list,
 *              pick-and-place, picture, 3-D render, the whole design
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  if (!L || !L.PCBX) return;
  var X = L.PCBX, FP = L.FP, PCB = L.PCB, esc = L.esc;
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  var ICON = {
    select: "M5 3l13 8-6 1.5L9 19z", track: "M3 18h6l6-12h6", link: "M4 18c4-10 12-2 16-12", via: "M12 7a5 5 0 1 0 .01 0zM12 10a2 2 0 1 0 .01 0z",
    hole: "M12 5a7 7 0 1 0 .01 0z", pattern: "M5 5h2v2H5zM11 5h2v2h-2zM17 5h2v2h-2zM5 11h2v2H5zM11 11h2v2h-2zM17 11h2v2h-2zM5 17h2v2H5zM11 17h2v2h-2zM17 17h2v2h-2z",
    text: "M5 6V4h14v2M12 4v16M9 20h6", pour: "M4 4h16v16H4zM8 8h8v8H8z", keepout: "M5 5l14 14M19 5L5 19M4 4h16v16H4z", outline: "M4 9l5-5h7l4 4v8l-5 4H8l-4-4z",
    cut: "M4 4h16v16H4zM9 9h6v6H9z", measure: "M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2"
  };
  var TOOLS = [
    ["select", "Select", "V", "Pick and drag. R turns, B puts it on the back, Delete removes, arrows nudge."],
    ["track", "Track", "T", "Draw copper. Click to bend, double-click (or Enter) to finish. L drops a via and carries on on the other side."],
    ["link", "Connect", "C", "Draw a connection from pad to pad. It becomes an air wire the router turns into copper."],
    ["via", "Via", "I", "A hole that joins the top copper to the bottom."],
    ["hole", "Hole", "H", "A mounting hole or any bare hole."],
    ["pattern", "Hole pattern", "P", "A grid of prototyping holes, a stripboard area, a bolt circle or a row."],
    ["text", "Text", "X", "Words on the silkscreen or in copper."],
    ["pour", "Copper pour", "G", "Fill the board (or drag a box) with copper joined to a net — a ground plane."],
    ["keepout", "Keep-out", "K", "Drag a box no copper may enter."],
    ["outline", "Board shape", "O", "Pick a shape, or drag the outline's corners. Double-click an edge to add a corner."],
    ["cut", "Cut-out", "U", "Drag a hole through the board. Hold Shift for a round one."],
    ["measure", "Measure", "M", "Drag to measure."]
  ];
  var GRIDS = [[0.1, "0.1 mm"], [0.25, "0.25 mm"], [0.5, "0.5 mm"], [0.635, "0.635 mm (¼ of 0.1\")"], [1.27, "1.27 mm (½ of 0.1\")"], [2.54, "2.54 mm (0.1\")"]];
  var MASKS = [["#1f6b45", "Green"], ["#1b3f8f", "Blue"], ["#9b1c1c", "Red"], ["#16181b", "Black"], ["#e9ece8", "White"], ["#5b2a86", "Purple"], ["#c9a227", "Yellow"]];
  var FINISH = [["#d9b24a", "Gold (ENIG)"], ["#c6ccd2", "Silver (HASL)"]];
  function icon(k) { return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICON[k] + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>'; }

  /* ================================================================ STUDIO */

  function PcbStudio(app, host) {
    this.app = app; this.host = host;
    this.tool = "select"; this.layer = 0; this.width = 0; this.snap = 0.635;
    this.vis = { top: true, bottom: true, silk: true, rats: true, zones: true };
    this.look = "layers"; this.auto = true; this.cam = null; this.model = null;
    this.sel = null; this.hover = null; this.draw = null; this.ver = 0; this.tab = "inspect";
    this.issues = null; this.chat = []; this.hudBits = {};
    this.build();
  }
  L.PcbStudio = PcbStudio;

  PcbStudio.prototype.build = function () {
    var self = this, h = this.host;
    h.classList.add("px-host");
    var tools = TOOLS.map(function (t) { return '<button type="button" class="px-tool" data-tool="' + t[0] + '" title="' + esc(t[1] + (t[2] ? " (" + t[2] + ")" : "") + " — " + t[3]) + '" aria-label="' + esc(t[1]) + '" aria-pressed="' + (t[0] === "select") + '">' + icon(t[0]) + '</button>'; }).join("");
    h.innerHTML =
      '<div class="px-bar" role="toolbar" aria-label="Board studio">' +
        '<div class="px-tools" role="group" aria-label="Tools">' + tools + '</div>' +
        '<span class="st-sep" aria-hidden="true"></span>' +
        '<div class="mode px-layer" role="group" aria-label="Copper side"><button type="button" data-layer="0" aria-pressed="true" class="c-top">Top</button><button type="button" data-layer="1" aria-pressed="false" class="c-bot">Bottom</button></div>' +
        '<label class="st-num" title="Width of the tracks you draw">Width <select data-k="width"><option value="0">auto</option>' + [0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.5, 2.0].map(function (w) { return '<option value="' + w + '">' + w + ' mm</option>'; }).join("") + '</select></label>' +
        '<label class="st-num" title="What things snap to">Grid <select data-k="snap">' + GRIDS.map(function (g) { return '<option value="' + g[0] + '"' + (g[0] === 0.635 ? " selected" : "") + '>' + g[1] + '</option>'; }).join("") + '</select></label>' +
        '<span class="st-sep" aria-hidden="true"></span>' +
        '<button type="button" data-act="route" class="primary" title="Route every connection that isn\'t copper yet (hand-drawn tracks are kept)">Route</button>' +
        '<button type="button" data-act="arrange" title="Lay the parts out again">Arrange</button>' +
        '<button type="button" data-act="unroute" title="Take away the router\'s tracks (yours stay)">Unroute</button>' +
        '<label class="st-chk" title="Re-route whenever a part moves"><input type="checkbox" data-k="auto" checked> Auto</label>' +
        '<span class="st-sep" aria-hidden="true"></span>' +
        '<div class="mode st-look" role="group" aria-label="How to show the board"><button type="button" data-look="layers" aria-pressed="true">Layers</button><button type="button" data-look="real" aria-pressed="false">Finished</button><button type="button" data-look="3d" aria-pressed="false">3-D</button></div>' +
        '<span class="px-grow"></span>' +
        '<button type="button" data-act="checks" class="px-checks" title="Design-rule check">Check <b class="px-badge" hidden></b></button>' +
        '<button type="button" data-act="ai" title="Ask the assistant about this board">✦ Assistant</button>' +
        '<button type="button" data-act="export" class="primary">Export</button>' +
      '</div>' +
      '<div class="px-main">' +
        '<div class="px-stage">' +
          '<svg class="px-svg pcb-svg" role="application" aria-label="Circuit board design. Use the tools above; the inspector on the right shows what is selected.">' +
            '<defs><pattern id="px-dots" width="2.54" height="2.54" patternUnits="userSpaceOnUse"><circle cx="1.27" cy="1.27" r=".11" fill="#5c8a72"/></pattern></defs>' +
            '<g class="px-board"></g><g class="px-over"></g></svg>' +
          '<canvas class="px-3d" hidden></canvas>' +
          '<div class="px-vis" role="group" aria-label="Show">' +
            '<label class="c-top"><input type="checkbox" data-vis="top" checked> Top</label><label class="c-bot"><input type="checkbox" data-vis="bottom" checked> Bottom</label>' +
            '<label><input type="checkbox" data-vis="silk" checked> Silk</label><label class="c-rat"><input type="checkbox" data-vis="rats" checked> Air wires</label><label><input type="checkbox" data-vis="zones" checked> Pours</label></div>' +
          '<p class="px-hud" aria-live="polite"></p>' +
        '</div>' +
        '<aside class="px-side" aria-label="Board details">' +
          '<div class="px-tabs" role="tablist"><button type="button" role="tab" data-tab="inspect" aria-selected="true">Inspect</button><button type="button" role="tab" data-tab="checks" aria-selected="false">Checks</button><button type="button" role="tab" data-tab="ai" aria-selected="false">Assistant</button></div>' +
          '<div class="px-panel"></div>' +
        '</aside>' +
      '</div>' +
      '<p class="st-status" role="status" aria-live="polite"></p>';
    this.svg = h.querySelector(".px-svg"); this.gBoard = h.querySelector(".px-board"); this.gOver = h.querySelector(".px-over");
    this.sideEl = h.querySelector(".px-side"); this.mainEl = h.querySelector(".px-main");
    h.querySelector(".px-stage").appendChild(h.querySelector(".st-status"));
    this.canvas = h.querySelector(".px-3d"); this.hud = h.querySelector(".px-hud"); this.panel = h.querySelector(".px-panel"); this.status = h.querySelector(".st-status");
    h.querySelectorAll("[data-tool]").forEach(function (b) { b.addEventListener("click", function () { self.setTool(b.getAttribute("data-tool")); }); });
    h.querySelectorAll("[data-layer]").forEach(function (b) { b.addEventListener("click", function () { self.setLayer(+b.getAttribute("data-layer")); }); });
    h.querySelectorAll("[data-look]").forEach(function (b) { b.addEventListener("click", function () { self.setLook(b.getAttribute("data-look")); }); });
    h.querySelectorAll("[data-act]").forEach(function (b) { b.addEventListener("click", function () { self.action(b.getAttribute("data-act")); }); });
    h.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { self.showTab(b.getAttribute("data-tab")); }); });
    h.querySelectorAll("[data-vis]").forEach(function (b) { b.addEventListener("change", function () { self.vis[b.getAttribute("data-vis")] = b.checked; self.render(); }); });
    h.querySelector('[data-k="width"]').addEventListener("change", function () { self.width = parseFloat(this.value) || 0; });
    h.querySelector('[data-k="snap"]').addEventListener("change", function () { self.snap = parseFloat(this.value) || 0.635; });
    h.querySelector('[data-k="auto"]').addEventListener("change", function () { self.auto = this.checked; });
    this.bind();
    this.view3d = new Board3D(this);
  };

  /* ------------------------------------------------------------ state */

  /* While the Board is showing, its inspector lives in the lab's own side
   * panel (the bench's tabs step aside), so there is one panel, not two. */
  PcbStudio.prototype.activate = function (on) {
    var side = document.getElementById("lab-side");
    this.active = !!on;
    if (!side) return;
    if (on) {
      Array.prototype.forEach.call(side.children, function (c) { if (c.classList.contains("px-side")) return; c.setAttribute("data-px-was", c.hidden ? "1" : "0"); c.hidden = true; });
      side.appendChild(this.sideEl); side.classList.add("px-on");
    } else {
      if (this.sideEl.parentNode === side) this.mainEl.appendChild(this.sideEl);
      side.classList.remove("px-on");
      Array.prototype.forEach.call(side.children, function (c) { var w = c.getAttribute("data-px-was"); if (w != null) { c.hidden = w === "1"; c.removeAttribute("data-px-was"); } });
    }
  };

  PcbStudio.prototype.setTool = function (t) {
    if (this.draw && this.draw.kind === "track") this.finishTrack();
    this.tool = t; this.draw = null; this.drag = null;
    this.host.querySelectorAll("[data-tool]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-tool") === t ? "true" : "false"); });
    this.svg.setAttribute("data-tool", t);
    var tt = TOOLS.filter(function (x) { return x[0] === t; })[0];
    this.hint(tt ? tt[1] + ": " + tt[3] : "");
    if (t === "outline") { this.sel = { kind: "board" }; this.showTab("inspect"); }
    if (this.look === "3d") this.setLook("layers");
    this.render(); this.inspect();
  };
  PcbStudio.prototype.setLayer = function (l) {
    this.layer = l ? 1 : 0;
    this.host.querySelectorAll("[data-layer]").forEach(function (b) { b.setAttribute("aria-pressed", +b.getAttribute("data-layer") === (l ? 1 : 0) ? "true" : "false"); });
    this.render();
  };
  PcbStudio.prototype.setLook = function (k) {
    this.look = k;
    this.host.querySelectorAll("[data-look]").forEach(function (x) { x.setAttribute("aria-pressed", x.getAttribute("data-look") === k ? "true" : "false"); });
    this.canvas.hidden = k !== "3d"; this.svg.style.visibility = k === "3d" ? "hidden" : "";
    if (k === "3d") this.view3d.show(); else this.view3d.hide();
    this.render();
  };
  PcbStudio.prototype.hint = function (s) { this.status.textContent = s || ""; };
  PcbStudio.prototype.rules = function () { return X.rules(this.app.doc.pcb); };
  PcbStudio.prototype.trackWidth = function (net) { var R = this.rules(); return this.width || (net && this.model.nets[net - 1] && this.model.nets[net - 1].power ? R.power : R.track); };

  /* An edit: undoable, saved, and re-routed if asked. */
  PcbStudio.prototype.edit = function (fn, reroute) {
    var app = this.app, doc = app.doc;
    if (!doc.pcb) return;
    app.history.push(doc);
    fn(doc.pcb);
    this.remodel();
    if (reroute && this.auto) X.route(doc, this.model);
    this.ver++; this.issues = null;
    app.changed();
    this.render(); this.inspect(); this.autoCheck();
  };
  PcbStudio.prototype.remodel = function () {
    var doc = this.app.doc;
    this.model = X.model(doc, this.app.sim);
    X.ensure(doc, this.model);
    this.model = X.model(doc, this.app.sim);
    this.conn = null;
  };

  /* Bring the board up to date with the bench, then draw it. */
  PcbStudio.prototype.sync = function () {
    var app = this.app, doc = app.doc, had = !!doc.pcb;
    var m = X.model(doc, app.sim);
    if (!had && !m.items.length) { this.model = m; this.render(); this.inspect(); return; }
    var changed = X.ensure(doc, m);
    this.model = X.model(doc, app.sim);
    if (changed && this.auto && this.model.nets.length && !doc.pcb.tracks.some(function (t) { return !t.man; })) X.route(doc, this.model);
    if (changed && had) app.changed();
    if (!this.cam || !had) this.fit(true);
    if (this.sel && this.sel.kind === "item" && !this.model.index[this.sel.id]) this.sel = null;
    this.ver++; this.conn = null; this.issues = null;
    this.render(); this.inspect(); this.autoCheck();
  };
  PcbStudio.prototype.refreshAll = function () { this.sync(); };

  /* ----------------------------------------------------------- camera */

  PcbStudio.prototype.fit = function (quiet) {
    var pcb = this.app.doc.pcb || { w: 60, h: 40 }, r = this.svg.getBoundingClientRect();
    var W = Math.max(100, r.width), H = Math.max(100, r.height), pad = 8;
    var z = Math.min(W / (pcb.w + pad * 2), H / (pcb.h + pad * 2));
    this.cam = { x: pcb.w / 2, y: pcb.h / 2, z: z };
    this.applyCam();
    if (!quiet) this.render();
    if (this.look === "3d") this.view3d.reset();
  };
  PcbStudio.prototype.zoomBy = function (f, cx, cy) {
    if (this.look === "3d") { this.view3d.zoom(f); return; }
    var c = this.cam; if (!c) return;
    var r = this.svg.getBoundingClientRect();
    if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    var before = this.toBoard(cx, cy);
    c.z = L.clamp(c.z * f, 1, 400);
    this.applyCam();
    var after = this.toBoard(cx, cy);
    c.x += before.x - after.x; c.y += before.y - after.y;
    this.applyCam();
    this.hudZoom();
  };
  PcbStudio.prototype.applyCam = function () {
    var r = this.svg.getBoundingClientRect(), c = this.cam;
    if (!c || !r.width) return;
    this.svg.setAttribute("viewBox", r3(c.x - r.width / 2 / c.z) + " " + r3(c.y - r.height / 2 / c.z) + " " + r3(r.width / c.z) + " " + r3(r.height / c.z));
  };
  PcbStudio.prototype.toBoard = function (cx, cy) {
    var r = this.svg.getBoundingClientRect(), c = this.cam || { x: 0, y: 0, z: 1 };
    return { x: c.x + (cx - r.left - r.width / 2) / c.z, y: c.y + (cy - r.top - r.height / 2) / c.z };
  };
  PcbStudio.prototype.snapPt = function (x, y, free) {
    if (free) return [r3(x), r3(y)];
    var g = this.snap;
    return [r3(Math.round(x / g) * g), r3(Math.round(y / g) * g)];
  };
  PcbStudio.prototype.hudZoom = function () { if (this.cam) this.hudBits.zoom = Math.round(this.cam.z * 100 / 3.78) + "%"; this.paintHud(); };
  PcbStudio.prototype.paintHud = function () { var b = this.hudBits; this.hud.textContent = [b.xy, b.what, b.zoom].filter(Boolean).join("  ·  "); };

  /* --------------------------------------------------------- hit tests */

  PcbStudio.prototype.hit = function (x, y) {
    var doc = this.app.doc, m = this.model, pcb = doc.pcb, R = this.rules(), i;
    if (!pcb || !m) return null;
    var pads = X.pads(doc, m), best = null;
    for (i = 0; i < pads.length; i++) { var p = pads[i]; if (Math.abs(x - p.x) <= p.w / 2 + 0.05 && Math.abs(y - p.y) <= p.h / 2 + 0.05) { if (!best || (p.layers.indexOf(this.layer) >= 0 && best.layers.indexOf(this.layer) < 0)) best = p; } }
    if (best) return { kind: "pad", pad: best, id: best.id, net: best.net };
    for (i = pcb.vias.length - 1; i >= 0; i--) { var v = pcb.vias[i]; if (hyp(v[0] - x, v[1] - y) <= R.via / 2 + 0.1) return { kind: "via", i: i, net: v[2] + 1 }; }
    var tb = null, td = 1e9;
    pcb.tracks.forEach(function (t, ti) { if (!this.vis[t.l ? "bottom" : "top"]) return; for (var q = 1; q < t.pts.length; q++) { var d = X.segDist(x, y, t.pts[q - 1][0], t.pts[q - 1][1], t.pts[q][0], t.pts[q][1]); if (d <= t.w / 2 + 0.15 && (d < td || (t.l === this.layer && tb && pcb.tracks[tb].l !== this.layer))) { td = d; tb = ti; } } }, this);
    if (tb != null) return { kind: "track", i: tb, net: pcb.tracks[tb].n + 1 };
    for (i = pcb.items.length - 1; i >= 0; i--) {
      var it = pcb.items[i];
      if (it.kind === "text") { var w = String(it.s || "").length * 5.4 * (it.size || 1.5) / 6; if (Math.abs(x - it.x) <= w / 2 + 0.3 && Math.abs(y - it.y) <= (it.size || 1.5) / 2 + 0.3) return { kind: "item", id: it.id }; }
      if (it.kind === "hole" && !it.plated && hyp(x - it.x, y - it.y) <= it.d / 2 + 0.3) return { kind: "item", id: it.id };
    }
    var cand = null, area = 1e18;
    m.items.forEach(function (it2) {
      var pl = X.placeOf(doc, it2); if (!pl) return;
      var c = X.courtOf(it2.fp, pl), a = (c.x1 - c.x0) * (c.y1 - c.y0);
      if (x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1 && a < area) { area = a; cand = it2; }
    });
    if (cand) return { kind: "item", id: cand.id };
    for (i = pcb.cut.length - 1; i >= 0; i--) if (X.inPoly(X.cutouts({ cut: [pcb.cut[i]] })[0], x, y) || this.nearPoly(X.cutouts({ cut: [pcb.cut[i]] })[0], x, y, 0.4)) return { kind: "cut", i: i };
    for (i = pcb.items.length - 1; i >= 0; i--) {
      var z = pcb.items[i];
      if ((z.kind === "keepout" || (z.kind === "zone" && z.pts !== "board")) && z.pts && z.pts.length > 2 && X.inPoly(z.pts.concat([z.pts[0]]), x, y)) return { kind: "item", id: z.id };
    }
    for (i = pcb.items.length - 1; i >= 0; i--) { var zb = pcb.items[i]; if (zb.kind === "zone" && zb.pts === "board" && zb.layer === this.layer && X.onBoard(pcb, x, y)) return { kind: "zone", id: zb.id }; }
    return null;
  };
  PcbStudio.prototype.nearPoly = function (pts, x, y, d) { for (var i = 1; i < pts.length; i++) if (X.segDist(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) < d) return true; return false; };
  PcbStudio.prototype.item = function (id) { return this.model && this.model.index[id]; };
  PcbStudio.prototype.boardItem = function (id) { var pcb = this.app.doc.pcb; return pcb ? pcb.items.filter(function (it) { return it.id === id; })[0] : null; };
  PcbStudio.prototype.placeOf = function (id) { var it = this.item(id); return it ? X.placeOf(this.app.doc, it) : this.boardItem(id); };

  /* ----------------------------------------------------------- pointer */

  PcbStudio.prototype.bind = function () {
    var self = this, svg = this.svg, pointers = {}, pinch = null, space = false;
    document.addEventListener("keydown", function (e) { if (e.key === " " && self.host.offsetParent && !/INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || "")) { space = true; svg.classList.add("panning"); } });
    document.addEventListener("keyup", function (e) { if (e.key === " ") { space = false; svg.classList.remove("panning"); } });
    svg.addEventListener("wheel", function (e) { e.preventDefault(); self.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX, e.clientY); }, { passive: false });
    svg.addEventListener("pointerdown", function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      svg.setPointerCapture(e.pointerId);
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = { d: hyp(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        self.drag = null;
        return;
      }
      if (e.button === 1 || e.button === 2 && self.tool === "select" || space) { self.drag = { kind: "pan", x: e.clientX, y: e.clientY, cx: self.cam.x, cy: self.cam.y }; e.preventDefault(); return; }
      if (e.button === 2) return;
      /* double-clicks are spotted here: the board is redrawn on every press,
       * which takes away the element a browser's own dblclick would need */
      var now = Date.now(), ld = self.lastDown;
      if (ld && now - ld.t < 380 && hyp(e.clientX - ld.x, e.clientY - ld.y) < 7) { self.lastDown = null; self.dbl(e); return; }
      self.lastDown = { t: now, x: e.clientX, y: e.clientY };
      self.down(e);
    });
    svg.addEventListener("pointermove", function (e) {
      if (pointers[e.pointerId]) pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinch) {
        var ids = Object.keys(pointers); if (ids.length < 2) return;
        var a = pointers[ids[0]], b = pointers[ids[1]], d = hyp(a.x - b.x, a.y - b.y);
        if (d > 10) { self.zoomBy(d / pinch.d, pinch.cx, pinch.cy); pinch.d = d; }
        return;
      }
      self.move(e);
    });
    var up = function (e) {
      delete pointers[e.pointerId];
      if (pinch) { if (Object.keys(pointers).length < 2) pinch = null; return; }
      self.up(e);
    };
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    svg.addEventListener("contextmenu", function (e) { e.preventDefault(); if (self.draw && self.draw.kind === "track") self.finishTrack(); else if (self.draw) { self.draw = null; self.render(); } });
    svg.addEventListener("pointerleave", function () { self.hover = null; self.hudBits.xy = ""; self.paintHud(); self.renderOver(); });
    root.addEventListener("resize", function () { if (self.host.offsetParent) { self.applyCam(); if (self.look === "3d") self.view3d.draw(); } });
  };

  PcbStudio.prototype.down = function (e) {
    var doc = this.app.doc, pcb = doc.pcb;
    if (!pcb) return;
    var p = this.toBoard(e.clientX, e.clientY), s = this.snapPt(p.x, p.y, e.altKey), h = this.hit(p.x, p.y), t = this.tool, self = this;
    this.downAt = { x: e.clientX, y: e.clientY, t: Date.now() };
    if (this.placing) { this.dropPlacing(s); return; }
    if (t === "select") {
      if (h && (h.kind === "item" || h.kind === "pad")) {
        var id = h.id, pl = this.placeOf(id);
        this.select({ kind: "item", id: id });
        if (pl && pl.x != null) this.drag = { kind: "move", id: id, sx: p.x, sy: p.y, ox: pl.x, oy: pl.y, moved: false };
        return;
      }
      if (h && h.kind === "track") { this.select({ kind: "track", i: h.i }); this.drag = { kind: "track", i: h.i, sx: p.x, sy: p.y, orig: JSON.parse(JSON.stringify(pcb.tracks[h.i].pts)), moved: false }; return; }
      if (h && h.kind === "via") { this.select({ kind: "via", i: h.i }); this.drag = { kind: "via", i: h.i, moved: false }; return; }
      if (h && h.kind === "cut") { this.select({ kind: "cut", i: h.i }); var c = pcb.cut[h.i]; if (c.x != null) this.drag = { kind: "cut", i: h.i, sx: p.x, sy: p.y, ox: c.x, oy: c.y, moved: false }; return; }
      if (h && h.kind === "zone") { this.select({ kind: "item", id: h.id }); return; }
      this.select(null);
      this.drag = { kind: "pan", x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y };
      return;
    }
    if (t === "track") {
      var at = h && h.kind === "pad" ? [h.pad.x, h.pad.y] : this.snapToCopper(p, s);
      if (!this.draw) {
        var net = h ? h.net || 0 : 0;
        if (h && h.kind === "pad" && h.pad.layers.length === 1) this.setLayer(h.pad.layers[0]);
        this.draw = { kind: "track", net: net, layer: this.layer, w: this.trackWidth(net), pts: [at], segs: [], vias: [] };
        this.hint("Track" + (net ? " on " + this.model.nets[net - 1].name : "") + ": click to bend, double-click or Enter to finish, L for a via, Esc to stop.");
      } else {
        var d = this.draw, last = d.pts[d.pts.length - 1];
        this.posture(last, at).forEach(function (q) { d.pts.push(q); });
        if (!d.net && h && h.net) d.net = h.net;
        if (h && h.kind === "pad" && (h.net === d.net || !d.net)) this.finishTrack();
      }
      this.render(); return;
    }
    if (t === "link") {
      if (!h || h.kind !== "pad") { this.hint("Connect: start on a pad."); return; }
      if (!this.draw) { this.draw = { kind: "link", a: h.pad.key, x: h.pad.x, y: h.pad.y }; this.hint("Connect: now click the pad to join it to."); this.renderOver(); return; }
      var a = this.draw.a, b = h.pad.key;
      this.draw = null;
      if (a === b) { this.renderOver(); return; }
      if (this.model.padNet[a] && this.model.padNet[a] === this.model.padNet[b]) { this.app.toast("Those two are already on the same net."); this.renderOver(); return; }
      this.edit(function (pcb2) { pcb2.links.push({ a: a, b: b }); }, true);
      this.app.toast("Connected. It shows as an air wire until it is routed.");
      return;
    }
    if (t === "via") {
      var vn = h ? (h.net || 0) : 0, at2 = this.snapToCopper(p, s);
      this.edit(function (pcb2) { pcb2.vias.push([at2[0], at2[1], vn - 1, 1]); });
      return;
    }
    if (t === "hole") { this.addItem({ kind: "hole", x: s[0], y: s[1], d: 3.2, plated: false }); return; }
    if (t === "pattern") { this.addItem({ kind: "array", pattern: "grid", x: s[0], y: s[1], cols: 10, rows: 6, pitch: 2.54, d: 1.0, pad: 1.8, strip: "none" }); return; }
    if (t === "text") { this.addItem({ kind: "text", x: s[0], y: s[1], s: "TEXT", size: 1.5, layer: this.layer ? "bsilk" : "silk" }); setTimeout(function () { var f = self.panel.querySelector('[data-f="s"]'); if (f) { f.focus(); f.select(); } }, 30); return; }
    if (t === "pour" || t === "keepout" || t === "cut" || t === "measure") { this.drag = { kind: "box", tool: t, a: s, b: s, shift: e.shiftKey, free: e.altKey }; this.renderOver(); return; }
    if (t === "outline") {
      var hv = this.outlineHandle(p);
      if (hv) { this.convertToPoly(); this.app.history.push(doc); this.drag = { kind: "vertex", i: hv.i, insert: hv.insert }; if (hv.insert) { pcb.shape.pts.splice(hv.i, 0, s); } return; }
      this.drag = { kind: "pan", x: e.clientX, y: e.clientY, cx: this.cam.x, cy: this.cam.y };
    }
  };

  PcbStudio.prototype.move = function (e) {
    var p = this.toBoard(e.clientX, e.clientY), d = this.drag, doc = this.app.doc, pcb = doc.pcb;
    this.hudBits.xy = "x " + p.x.toFixed(2) + "  y " + p.y.toFixed(2) + " mm";
    if (d && d.kind === "pan") { this.cam.x = d.cx - (e.clientX - d.x) / this.cam.z; this.cam.y = d.cy - (e.clientY - d.y) / this.cam.z; this.applyCam(); this.paintHud(); return; }
    if (!pcb) return;
    var s = this.snapPt(p.x, p.y, e.altKey);
    if (d && d.kind === "move") {
      var pl = this.placeOf(d.id);
      if (!d.moved) { if (hyp(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 4) return; this.app.history.push(doc); d.moved = true; }
      var nx = d.ox + (p.x - d.sx), ny = d.oy + (p.y - d.sy), sn = this.snapPt(nx, ny, e.altKey);
      pl.x = sn[0]; pl.y = sn[1];
      this.ver++; this.conn = null;
      this.render(true); return;
    }
    if (d && d.kind === "track") {
      if (!d.moved) { if (hyp(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 4) return; this.app.history.push(doc); d.moved = true; }
      var t = pcb.tracks[d.i], dx = s[0] - this.snapPt(d.sx, d.sy)[0], dy = s[1] - this.snapPt(d.sx, d.sy)[1];
      /* drag the middle of a track: its inner points move, its ends stay on their pads */
      t.pts = d.orig.map(function (q, i) { return i === 0 || i === d.orig.length - 1 ? q : [r3(q[0] + dx), r3(q[1] + dy)]; });
      if (t.pts.length === 2) { t.pts = [d.orig[0], [r3((d.orig[0][0] + d.orig[1][0]) / 2 + dx), r3((d.orig[0][1] + d.orig[1][1]) / 2 + dy)], d.orig[1]]; }
      t.man = 1;
      this.ver++; this.conn = null; this.render(true); return;
    }
    if (d && d.kind === "via") { if (!d.moved) { this.app.history.push(doc); d.moved = true; } var v = pcb.vias[d.i]; v[0] = s[0]; v[1] = s[1]; v[3] = 1; this.ver++; this.render(true); return; }
    if (d && d.kind === "cut") { if (!d.moved) { this.app.history.push(doc); d.moved = true; } var c = pcb.cut[d.i]; var cs = this.snapPt(d.ox + p.x - d.sx, d.oy + p.y - d.sy, e.altKey); c.x = cs[0]; c.y = cs[1]; this.ver++; this.render(true); return; }
    if (d && d.kind === "vertex") { pcb.shape.pts[d.i] = s; this.ver++; this.render(true); return; }
    if (d && d.kind === "box") { d.b = s; d.shift = e.shiftKey; this.renderOver(); this.hudBits.what = Math.abs(d.b[0] - d.a[0]).toFixed(2) + " × " + Math.abs(d.b[1] - d.a[1]).toFixed(2) + " mm" + (d.tool === "measure" ? " — " + hyp(d.b[0] - d.a[0], d.b[1] - d.a[1]).toFixed(3) + " mm" : ""); this.paintHud(); return; }
    /* hovering */
    var h = this.hit(p.x, p.y), what = "";
    if (h && h.kind === "pad") what = (h.pad.item.ref || "") + "." + h.pad.name + (h.net ? " · " + this.model.nets[h.net - 1].name : " · no net");
    else if (h && h.kind === "track") { var tk = pcb.tracks[h.i]; what = (tk.l ? "bottom" : "top") + " track " + tk.w + " mm" + (h.net && this.model.nets[h.net - 1] ? " · " + this.model.nets[h.net - 1].name : ""); }
    else if (h && h.kind === "item") { var it = this.item(h.id) || this.boardItem(h.id); what = it ? (it.ref || it.kind) + (it.fp ? " · " + it.fp.name : "") : ""; }
    this.hudBits.what = what; this.paintHud();
    var hn = h && h.net ? h.net : 0;
    var changed = (this.hover && this.hover.net) !== hn || (this.hover && this.hover.id) !== (h && h.id);
    this.hover = h; this.cursor = s; this.cursorRaw = [p.x, p.y];
    if (this.draw || this.placing || this.tool === "outline") this.renderOver();
    else if (changed) this.render();
  };

  PcbStudio.prototype.up = function (e) {
    var d = this.drag, doc = this.app.doc, pcb = doc.pcb, self = this;
    this.drag = null;
    if (!d || !pcb) return;
    if (d.kind === "move" && d.moved) {
      this.remodel();
      if (this.auto) X.route(doc, this.model);
      this.ver++; this.issues = null; this.app.changed(); this.render(); this.inspect(); this.autoCheck();
      return;
    }
    if ((d.kind === "track" || d.kind === "via" || d.kind === "cut") && d.moved) { this.remodel(); this.ver++; this.issues = null; this.app.changed(); this.render(); this.autoCheck(); return; }
    if (d.kind === "vertex") { X.normalize(pcb); pcb.open = []; this.remodel(); this.ver++; this.issues = null; this.app.changed(); this.fit(true); this.render(); this.inspect(); this.autoCheck(); return; }
    if (d.kind === "box") {
      var x0 = Math.min(d.a[0], d.b[0]), y0 = Math.min(d.a[1], d.b[1]), x1 = Math.max(d.a[0], d.b[0]), y1 = Math.max(d.a[1], d.b[1]), small = x1 - x0 < 0.5 && y1 - y0 < 0.5;
      if (d.tool === "measure") { this.measure = small ? null : [d.a, d.b]; this.renderOver(); return; }
      if (d.tool === "pour") {
        var net = this.defaultNet();
        if (small) {
          var have = pcb.items.filter(function (it) { return it.kind === "zone" && it.pts === "board" && it.layer === self.layer; })[0];
          if (have) { this.select({ kind: "item", id: have.id }); return; }
          this.addItem({ kind: "zone", layer: this.layer, net: net, pts: "board" });
        } else this.addItem({ kind: "zone", layer: this.layer, net: net, pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
        this.app.toast("Copper pour on the " + (this.layer ? "bottom" : "top") + ", joined to " + net + ". Change its net in the inspector.");
        return;
      }
      if (d.tool === "keepout") { if (!small) this.addItem({ kind: "keepout", layer: 2, pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] }); return; }
      if (d.tool === "cut") {
        var cut = small ? { kind: "circle", x: d.a[0], y: d.a[1], d: 4 } : d.shift ? { kind: "circle", x: r3((x0 + x1) / 2), y: r3((y0 + y1) / 2), d: r3(Math.max(x1 - x0, y1 - y0)) } : { kind: "rect", x: x0, y: y0, w: r3(x1 - x0), h: r3(y1 - y0), r: 0 };
        this.edit(function (pcb2) { pcb2.cut.push(cut); }, true);
        this.select({ kind: "cut", i: pcb.cut.length - 1 });
        return;
      }
    }
  };
  PcbStudio.prototype.dbl = function (e) {
    var p = this.toBoard(e.clientX, e.clientY), pcb = this.app.doc.pcb;
    if (this.draw && this.draw.kind === "track") { this.finishTrack(); return; }
    if (this.tool === "outline" && pcb && pcb.shape && pcb.shape.kind === "poly") {
      var hv = this.outlineHandle(p);
      if (hv && !hv.insert && pcb.shape.pts.length > 3) { this.edit(function (pc) { pc.shape.pts.splice(hv.i, 1); X.normalize(pc); }); return; }
    }
    var h = this.hit(p.x, p.y);
    if (h && h.kind === "item") { this.select({ kind: "item", id: h.id }); this.showTab("inspect"); }
  };
  /* In the Track tool, ends land on pads, vias and track ends. */
  PcbStudio.prototype.snapToCopper = function (p, s) {
    var doc = this.app.doc, best = null, bd = 0.6;
    X.pads(doc, this.model).forEach(function (q) { var d = hyp(q.x - p.x, q.y - p.y); if (d < Math.max(bd, Math.min(q.w, q.h) / 2) && (!best || d < bd)) { bd = d; best = [q.x, q.y]; } });
    doc.pcb.vias.forEach(function (v) { var d = hyp(v[0] - p.x, v[1] - p.y); if (d < bd) { bd = d; best = [v[0], v[1]]; } });
    doc.pcb.tracks.forEach(function (t) { [t.pts[0], t.pts[t.pts.length - 1]].forEach(function (q) { var d = hyp(q[0] - p.x, q[1] - p.y); if (d < bd) { bd = d; best = [q[0], q[1]]; } }); });
    return best || s;
  };
  /* From a to b in two legs: straight, then 45° — the way boards are drawn. */
  PcbStudio.prototype.posture = function (a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], ax = Math.abs(dx), ay = Math.abs(dy);
    if (ax < 1e-6 || ay < 1e-6 || Math.abs(ax - ay) < 1e-6) return [b];
    var mid = ax > ay ? [r3(a[0] + Math.sign(dx) * (ax - ay)), a[1]] : [a[0], r3(a[1] + Math.sign(dy) * (ay - ax))];
    return [mid, b];
  };
  PcbStudio.prototype.finishTrack = function () {
    var d = this.draw;
    this.draw = null;
    if (!d || d.kind !== "track") { this.render(); return; }
    var segs = d.segs.slice();
    if (d.pts.length > 1) segs.push({ l: d.layer, pts: d.pts.slice() });
    if (!segs.length) { this.render(); return; }
    var net = d.net ? d.net - 1 : -1, w = d.w;
    this.edit(function (pcb) {
      segs.forEach(function (sg) { if (sg.pts.length > 1) pcb.tracks.push({ n: net, l: sg.l, w: w, pts: sg.pts.filter(function (q, i) { return !i || q[0] !== sg.pts[i - 1][0] || q[1] !== sg.pts[i - 1][1]; }), man: 1 }); });
      d.vias.forEach(function (v) { pcb.vias.push([v[0], v[1], net, 1]); });
    });
    this.hint("Track drawn. It stays where you put it when the router runs.");
  };
  /* L while drawing: a via here, and carry on on the other side. */
  PcbStudio.prototype.trackVia = function () {
    var d = this.draw;
    if (!d || d.kind !== "track") { this.setLayer(1 - this.layer); return; }
    var last = d.pts[d.pts.length - 1];
    if (d.pts.length > 1) d.segs.push({ l: d.layer, pts: d.pts.slice() });
    d.vias.push(last.slice());
    d.layer = 1 - d.layer; this.setLayer(d.layer);
    d.pts = [last.slice()];
    this.render();
  };
  PcbStudio.prototype.defaultNet = function () {
    var m = this.model, n = m.nets.filter(function (x) { return x.name === "GND"; })[0] || m.nets.filter(function (x) { return /^GND/.test(x.name); })[0];
    return n ? n.name : "GND";
  };
  PcbStudio.prototype.addItem = function (it) {
    it.id = X.uid(it.kind.charAt(0));
    this.edit(function (pcb) { pcb.items.push(it); }, it.kind === "array" || it.kind === "fp" || it.kind === "hole" || it.kind === "keepout");
    this.select({ kind: "item", id: it.id });
    this.showTab("inspect");
  };
  PcbStudio.prototype.select = function (s) {
    this.sel = s;
    if (s && s.kind === "item" && this.item(s.id) && this.item(s.id).kind === "part") { this.app.bench.sel = { kind: "part", id: s.id }; }
    this.render(); this.inspect();
  };
  /* The component list on the left is being hovered. */
  PcbStudio.prototype.hoverMark = function (id) { this.hover = id ? { kind: "item", id: id } : null; if (this.model) this.renderOver(); };
  /* A row of the component list (or a search hit) picked from outside. */
  PcbStudio.prototype.pickPart = function (id) {
    if (!this.item(id)) { this.app.toast("That one isn't on the board — it's part of the bench, not the circuit."); return; }
    this.select({ kind: "item", id: id });
    var pl = this.placeOf(id); if (pl && this.cam) { this.cam.x = pl.x; this.cam.y = pl.y; this.applyCam(); }
  };

  /* Outline handles: corners to drag, and a + in the middle of each edge. */
  PcbStudio.prototype.outlineHandle = function (p) {
    var pcb = this.app.doc.pcb, pts = X.outline(pcb).slice(0, -1), z = this.cam.z, r = 7 / z;
    if (pcb.shape && pcb.shape.kind === "poly") {
      for (var i = 0; i < pts.length; i++) if (hyp(pts[i][0] - p.x, pts[i][1] - p.y) < r) return { i: i };
      for (i = 0; i < pts.length; i++) { var a = pts[i], b = pts[(i + 1) % pts.length]; if (hyp((a[0] + b[0]) / 2 - p.x, (a[1] + b[1]) / 2 - p.y) < r) return { i: i + 1, insert: true }; }
      return null;
    }
    var w = pcb.w, h = pcb.h, cs = [[0, 0], [w, 0], [w, h], [0, h]];
    for (i = 0; i < 4; i++) if (hyp(cs[i][0] - p.x, cs[i][1] - p.y) < r) return { i: i, rectCorner: true };
    return null;
  };
  /* A rectangle or circle becomes points you can drag. */
  PcbStudio.prototype.convertToPoly = function () {
    var pcb = this.app.doc.pcb;
    if (pcb.shape && pcb.shape.kind === "poly") return;
    var pts = pcb.shape && pcb.shape.kind === "circle" ? X.outline(pcb).slice(0, -1).filter(function (_, i) { return i % 3 === 0; }) : [[0, 0], [pcb.w, 0], [pcb.w, pcb.h], [0, pcb.h]];
    pcb.shape = { kind: "poly", pts: pts.map(function (q) { return [r3(q[0]), r3(q[1])]; }) };
    pcb.r = 0;
  };

  /* -------------------------------------------------------------- keys */

  PcbStudio.prototype.key = function (e) {
    var k = e.key, sel = this.sel, doc = this.app.doc, self = this;
    if (k === "Escape") {
      if (this.placing) { this.placing = null; this.renderOver(); return true; }
      if (this.draw && this.draw.kind === "track") { this.finishTrack(); return true; }
      if (this.draw || this.measure) { this.draw = null; this.measure = null; this.render(); return true; }
      if (this.tool !== "select") { this.setTool("select"); return true; }
      this.select(null); return true;
    }
    if (k === "Enter" && this.draw && this.draw.kind === "track") { this.finishTrack(); return true; }
    if ((k === "l" || k === "L") && !e.ctrlKey && !e.metaKey) { this.trackVia(); return true; }
    var tool = TOOLS.filter(function (t) { return t[2] && t[2].toLowerCase() === k.toLowerCase(); })[0];
    if (tool && !e.ctrlKey && !e.metaKey && !e.altKey && !(k === "r" || k === "R")) { this.setTool(tool[0]); return true; }
    if (k === "+" || k === "=") { this.zoomBy(1.25); return true; }
    if (k === "-" || k === "_") { this.zoomBy(0.8); return true; }
    if ((k === "f" || k === "F") && !e.shiftKey) { this.fit(); return true; }
    if (!sel) return /^(Delete|Backspace|r|R|b|B|d|D)$/.test(k) || /^Arrow/.test(k);
    if (sel.kind === "item") {
      var pl = this.placeOf(sel.id), it = this.item(sel.id);
      if ((k === "r" || k === "R") && pl && pl.rot != null || (k === "r" || k === "R") && it && it.kind === "fp") { this.rotate(sel.id, e.shiftKey ? -1 : 1); return true; }
      if ((k === "b" || k === "B") && pl && it && (it.kind === "part" || it.kind === "fp")) { this.edit(function () { pl.side = pl.side === "bottom" ? undefined : "bottom"; if (!pl.side) delete pl.side; }, true); return true; }
      if (/^Arrow/.test(k) && pl && pl.x != null) {
        var g = e.shiftKey ? this.snap * 4 : this.snap, dx = k === "ArrowLeft" ? -g : k === "ArrowRight" ? g : 0, dy = k === "ArrowUp" ? -g : k === "ArrowDown" ? g : 0;
        this.edit(function () { pl.x = r3(pl.x + dx); pl.y = r3(pl.y + dy); }, true); return true;
      }
    }
    if (k === "Delete" || k === "Backspace") { this.remove(); return true; }
    return /^(r|R|b|B|d|D)$/.test(k) || /^Arrow/.test(k);
  };
  PcbStudio.prototype.rotate = function (id, dir) {
    var pl = this.placeOf(id);
    if (!pl) return;
    this.edit(function () { pl.rot = (((pl.rot || 0) + (dir || 1)) % 4 + 4) % 4; }, true);
  };
  PcbStudio.prototype.remove = function () {
    var sel = this.sel, self = this;
    if (!sel) return;
    if (sel.kind === "track") { this.edit(function (pcb) { pcb.tracks.splice(sel.i, 1); }); this.sel = null; this.inspect(); return; }
    if (sel.kind === "via") { this.edit(function (pcb) { pcb.vias.splice(sel.i, 1); }); this.sel = null; this.inspect(); return; }
    if (sel.kind === "cut") { this.edit(function (pcb) { pcb.cut.splice(sel.i, 1); }, true); this.sel = null; this.inspect(); return; }
    if (sel.kind === "item" || sel.kind === "zone") {
      var it = this.item(sel.id);
      if (it && it.kind === "part") { this.app.toast("That part is in the circuit. Delete it on the bench, or click it there."); return; }
      this.edit(function (pcb) {
        pcb.items = pcb.items.filter(function (x) { return x.id !== sel.id; });
        pcb.links = pcb.links.filter(function (lk) { return lk.a.split(":")[0] !== sel.id && lk.b.split(":")[0] !== sel.id; });
        Object.keys(pcb.labels).forEach(function (k2) { if (k2.split(":")[0] === sel.id) delete pcb.labels[k2]; });
      }, true);
      this.sel = null; this.inspect();
    }
  };

  /* ---------------------------------------------------------- actions */

  PcbStudio.prototype.action = function (k) {
    var self = this, app = this.app, doc = app.doc;
    if (k === "checks") { this.showTab("checks"); this.runChecks(); return; }
    if (k === "ai") { this.showTab("ai"); var q = this.panel.querySelector(".px-ask input"); if (q) q.focus(); return; }
    if (k === "export") { this.exportDialog(); return; }
    if (!doc.pcb || !this.model.items.length) { app.toast("Put some parts on the bench, or place footprints from the library on the left."); if (!doc.pcb) { doc.pcb = PCB.blank(); this.sync(); } return; }
    if (k === "arrange") { this.edit(function () { X.autoplace(doc, self.model); }, true); this.fit(); return; }
    if (k === "unroute") { this.edit(function (pcb) { pcb.tracks = pcb.tracks.filter(function (t) { return t.man; }); pcb.vias = pcb.vias.filter(function (v) { return v[3]; }); pcb.open = []; }); return; }
    if (k === "route") {
      var res = null, t0 = Date.now();
      this.edit(function () { res = X.route(doc, self.model, self.sel && self.sel.kind === "track" && self.sel.only ? { only: [self.sel.only] } : null); });
      var n = res.open.length;
      app.toast(n ? n + " connection" + (n > 1 ? "s" : "") + " couldn't be routed. Move parts apart, make the board bigger, use the other side, or draw those by hand." : "Routed every connection" + (res.vias.length ? " with " + res.vias.length + " via" + (res.vias.length > 1 ? "s" : "") : "") + " in " + (Date.now() - t0) + " ms.");
      app.sound(n ? "err" : "win");
    }
  };

  /* ============================================================ DRAWING */

  PcbStudio.prototype.render = function (fast) {
    var doc = this.app.doc, pcb = doc.pcb, m = this.model;
    if (!pcb || !m) { this.gBoard.innerHTML = ""; this.gOver.innerHTML = '<text x="0" y="0" font-size="3" fill="#9fb0bf" text-anchor="middle">Put parts on the bench — or place footprints from the library — and the board appears here.</text>'; this.svg.setAttribute("viewBox", "-60 -20 120 40"); return; }
    if (!this.cam) this.fit(true);
    this.applyCam();
    var net = this.hover && this.hover.net ? this.hover.net : this.sel && (this.sel.kind === "track" || this.sel.kind === "via") ? (this.sel.kind === "track" ? (pcb.tracks[this.sel.i] || {}).n + 1 : (pcb.vias[this.sel.i] || [])[2] + 1) : 0;
    var real = this.look === "real";
    this.gBoard.innerHTML = X.svg(doc, m, { look: real ? "real" : "layers", vis: this.vis, net: net || 0, selTrack: this.sel && this.sel.kind === "track" ? this.sel.i : -1, uid: "px", flip: this.layer === 1 && !real, mask: pcb.mask, finish: pcb.finish });
    this.renderOver(fast);
    if (this.look === "3d") this.view3d.draw();
  };
  PcbStudio.prototype.connectivity = function (fast) {
    if (fast) return { open: this.quickRats() };
    if (!this.conn || this.conn.ver !== this.ver) { this.conn = X.connectivity(this.app.doc, this.model); this.conn.ver = this.ver; }
    return this.conn;
  };
  /* While dragging: air wires from the pads alone, which is instant. */
  PcbStudio.prototype.quickRats = function () {
    var by = {}, out = [];
    X.pads(this.app.doc, this.model).forEach(function (p) { if (p.net) (by[p.net] = by[p.net] || []).push(p); });
    Object.keys(by).forEach(function (k) {
      var list = by[k], tree = [list[0]], rest = list.slice(1);
      while (rest.length) {
        var bi = 0, bj = 0, bd = 1e18;
        rest.forEach(function (p, i) { tree.forEach(function (t, j) { var d = (p.x - t.x) * (p.x - t.x) + (p.y - t.y) * (p.y - t.y); if (d < bd) { bd = d; bi = i; bj = j; } }); });
        if (bd > 1e-6) out.push([rest[bi].x, rest[bi].y, tree[bj].x, tree[bj].y, +k]);
        tree.push(rest.splice(bi, 1)[0]);
      }
    });
    return out;
  };
  PcbStudio.prototype.renderOver = function (fast) {
    var doc = this.app.doc, pcb = doc.pcb, m = this.model, s = "", z = this.cam ? this.cam.z : 4, px = function (n) { return r3(n / z); }, self = this;
    if (!pcb || !m) return;
    var R = this.rules();
    /* air wires and drawn links */
    if (this.vis.rats) {
      this.connectivity(fast).open.forEach(function (o) { s += '<line x1="' + o[0] + '" y1="' + o[1] + '" x2="' + o[2] + '" y2="' + o[3] + '" stroke="' + X.COL.rat + '" stroke-width="' + px(1.4) + '" stroke-dasharray="' + px(5) + " " + px(3) + '" opacity=".9"/>'; });
      var padAt = {};
      X.pads(doc, m).forEach(function (p) { padAt[p.key] = padAt[p.key] || p; });
      pcb.links.forEach(function (lk) { var a = padAt[lk.a], b = padAt[lk.b]; if (a && b) s += '<path d="M' + a.x + " " + a.y + "Q" + r3((a.x + b.x) / 2 + (b.y - a.y) * 0.15) + " " + r3((a.y + b.y) / 2 - (b.x - a.x) * 0.15) + " " + b.x + " " + b.y + '" stroke="#c18cff" stroke-width="' + px(1.6) + '" fill="none" stroke-dasharray="' + px(2) + " " + px(2) + '" opacity=".85"/>'; });
    }
    /* selection */
    var sel = this.sel;
    if (sel && sel.kind === "item") {
      var it = this.item(sel.id), bi = this.boardItem(sel.id);
      if (it) { var c = X.courtOf(it.fp, X.placeOf(doc, it)); s += '<rect x="' + r3(c.x0) + '" y="' + r3(c.y0) + '" width="' + r3(c.x1 - c.x0) + '" height="' + r3(c.y1 - c.y0) + '" fill="rgba(122,200,255,.07)" stroke="#7ac8ff" stroke-width="' + px(1.5) + '" stroke-dasharray="' + px(4) + " " + px(3) + '"/>'; }
      else if (bi && (bi.kind === "zone" || bi.kind === "keepout") && bi.pts && bi.pts !== "board") s += '<path d="' + X.pathOf(bi.pts.concat([bi.pts[0]]), true) + '" fill="none" stroke="#7ac8ff" stroke-width="' + px(1.5) + '" stroke-dasharray="' + px(4) + " " + px(3) + '"/>';
      else if (bi && bi.kind === "zone") s += '<path d="' + X.pathOf(X.outline(pcb), true) + '" fill="none" stroke="#7ac8ff" stroke-width="' + px(2) + '" stroke-dasharray="' + px(6) + " " + px(4) + '"/>';
      else if (bi && bi.kind === "text") { var tw = String(bi.s).length * 5.4 * (bi.size || 1.5) / 6; s += '<rect x="' + r3(bi.x - tw / 2 - 0.3) + '" y="' + r3(bi.y - (bi.size || 1.5) / 2 - 0.3) + '" width="' + r3(tw + 0.6) + '" height="' + r3((bi.size || 1.5) + 0.6) + '" fill="none" stroke="#7ac8ff" stroke-width="' + px(1.5) + '"/>'; }
      else if (bi && bi.kind === "hole") s += '<circle cx="' + bi.x + '" cy="' + bi.y + '" r="' + r3(bi.d / 2 + 0.4) + '" fill="none" stroke="#7ac8ff" stroke-width="' + px(1.5) + '"/>';
    }
    if (sel && sel.kind === "via" && pcb.vias[sel.i]) s += '<circle cx="' + pcb.vias[sel.i][0] + '" cy="' + pcb.vias[sel.i][1] + '" r="' + r3(R.via / 2 + 0.3) + '" fill="none" stroke="#7ac8ff" stroke-width="' + px(1.5) + '"/>';
    if (sel && sel.kind === "cut" && pcb.cut[sel.i]) s += '<path d="' + X.pathOf(X.cutouts({ cut: [pcb.cut[sel.i]] })[0], true) + '" fill="none" stroke="#7ac8ff" stroke-width="' + px(2) + '" stroke-dasharray="' + px(4) + " " + px(3) + '"/>';
    if (this.hover && this.hover.kind === "item" && (!sel || sel.id !== this.hover.id)) { var hi = this.item(this.hover.id); if (hi) { var hc = X.courtOf(hi.fp, X.placeOf(doc, hi)); s += '<rect x="' + r3(hc.x0) + '" y="' + r3(hc.y0) + '" width="' + r3(hc.x1 - hc.x0) + '" height="' + r3(hc.y1 - hc.y0) + '" fill="none" stroke="#7ac8ff" stroke-width="' + px(1) + '" opacity=".6"/>'; } }
    /* the track being drawn */
    var d = this.draw;
    if (d && d.kind === "track") {
      var col = d.layer ? X.COL.bottom : X.COL.top;
      d.segs.forEach(function (sg) { s += '<path d="' + X.pathOf(sg.pts) + '" stroke="' + (sg.l ? X.COL.bottom : X.COL.top) + '" stroke-width="' + d.w + '" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>'; });
      d.vias.forEach(function (v) { s += '<circle cx="' + v[0] + '" cy="' + v[1] + '" r="' + r3(R.via / 2) + '" fill="#b9c3cc"/>'; });
      var pts = d.pts.slice();
      if (this.cursor) { var cur = this.hover && this.hover.kind === "pad" ? [this.hover.pad.x, this.hover.pad.y] : this.cursor; this.posture(pts[pts.length - 1], cur).forEach(function (q) { pts.push(q); }); }
      if (pts.length > 1) s += '<path d="' + X.pathOf(pts) + '" stroke="' + col + '" stroke-width="' + d.w + '" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/><path d="' + X.pathOf(pts) + '" stroke="#fff" stroke-width="' + px(1) + '" fill="none" stroke-dasharray="' + px(3) + " " + px(3) + '"/>';
      s += '<circle cx="' + pts[pts.length - 1][0] + '" cy="' + pts[pts.length - 1][1] + '" r="' + r3(d.w / 2 + R.clear) + '" fill="none" stroke="' + col + '" stroke-width="' + px(1) + '" opacity=".7"/>';
    }
    if (d && d.kind === "link" && this.cursorRaw) s += '<line x1="' + d.x + '" y1="' + d.y + '" x2="' + this.cursorRaw[0] + '" y2="' + this.cursorRaw[1] + '" stroke="#c18cff" stroke-width="' + px(2) + '" stroke-dasharray="' + px(4) + " " + px(3) + '"/>';
    var bx = this.drag && this.drag.kind === "box" ? this.drag : null;
    if (bx) {
      var x0 = Math.min(bx.a[0], bx.b[0]), y0 = Math.min(bx.a[1], bx.b[1]), w = Math.abs(bx.b[0] - bx.a[0]), h = Math.abs(bx.b[1] - bx.a[1]);
      if (bx.tool === "measure") s += this.measureSvg(bx.a, bx.b);
      else if (bx.tool === "cut" && bx.shift) s += '<circle cx="' + r3(x0 + w / 2) + '" cy="' + r3(y0 + h / 2) + '" r="' + r3(Math.max(w, h) / 2) + '" fill="rgba(0,0,0,.5)" stroke="#fff" stroke-width="' + px(1.2) + '" stroke-dasharray="' + px(4) + " " + px(3) + '"/>';
      else s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + w + '" height="' + h + '" fill="' + (bx.tool === "pour" ? (this.layer ? "rgba(79,143,247,.25)" : "rgba(226,87,76,.25)") : bx.tool === "cut" ? "rgba(0,0,0,.5)" : "rgba(255,90,90,.15)") + '" stroke="#fff" stroke-width="' + px(1.2) + '" stroke-dasharray="' + px(4) + " " + px(3) + '"/>';
    }
    if (this.measure) s += this.measureSvg(this.measure[0], this.measure[1]);
    /* outline handles */
    if (this.tool === "outline") {
      var ol = X.outline(pcb).slice(0, -1), poly = pcb.shape && pcb.shape.kind === "poly", hr = px(6);
      if (poly) {
        ol.forEach(function (q, i) { var b = ol[(i + 1) % ol.length]; s += '<g class="px-add"><circle cx="' + r3((q[0] + b[0]) / 2) + '" cy="' + r3((q[1] + b[1]) / 2) + '" r="' + px(5) + '" fill="#18222b" stroke="#7ac8ff" stroke-width="' + px(1.2) + '"/><path d="M' + r3((q[0] + b[0]) / 2 - px(3)) + " " + r3((q[1] + b[1]) / 2) + "h" + px(6) + "M" + r3((q[0] + b[0]) / 2) + " " + r3((q[1] + b[1]) / 2 - px(3)) + "v" + px(6) + '" stroke="#7ac8ff" stroke-width="' + px(1.2) + '"/></g>'; });
        ol.forEach(function (q) { s += '<rect x="' + r3(q[0] - hr) + '" y="' + r3(q[1] - hr) + '" width="' + r3(hr * 2) + '" height="' + r3(hr * 2) + '" fill="#7ac8ff" stroke="#0b1620" stroke-width="' + px(1) + '"/>'; });
      } else [[0, 0], [pcb.w, 0], [pcb.w, pcb.h], [0, pcb.h]].forEach(function (q) { s += '<rect x="' + r3(q[0] - hr) + '" y="' + r3(q[1] - hr) + '" width="' + r3(hr * 2) + '" height="' + r3(hr * 2) + '" fill="#7ac8ff" stroke="#0b1620" stroke-width="' + px(1) + '"/>'; });
      s += '<text x="' + r3(pcb.w / 2) + '" y="' + r3(-px(10)) + '" font-size="' + px(12) + '" text-anchor="middle" fill="#cfe6ff">' + pcb.w.toFixed(2) + ' × ' + pcb.h.toFixed(2) + ' mm</text>';
    }
    /* check markers */
    if (this.issues && this.tab === "checks") this.issues.forEach(function (q, i) {
      if (!q.x && !q.y) return;
      var c = q.level === "danger" ? "#ff4d4d" : q.level === "warn" ? "#ffb02e" : "#7ac8ff";
      s += '<g class="px-mark" data-issue="' + i + '"><circle cx="' + q.x + '" cy="' + q.y + '" r="' + px(self.flash === i ? 14 : 8) + '" fill="none" stroke="' + c + '" stroke-width="' + px(2) + '"/><text x="' + q.x + '" y="' + r3(q.y + px(3.5)) + '" font-size="' + px(10) + '" text-anchor="middle" fill="' + c + '" font-weight="700">!</text></g>';
    });
    /* what is about to be placed */
    if (this.placing && this.cursor) {
      var f = this.placing.fpData;
      if (f) { var c2 = f.court; s += '<g opacity=".7" transform="translate(' + this.cursor[0] + " " + this.cursor[1] + ')"><rect x="' + c2.x0 + '" y="' + c2.y0 + '" width="' + r3(c2.x1 - c2.x0) + '" height="' + r3(c2.y1 - c2.y0) + '" fill="rgba(122,200,255,.12)" stroke="#7ac8ff" stroke-width="' + px(1.2) + '"/>' + f.pads.map(function (q) { var t2 = (q.deg || 0) % 180 === 90; return X.padSvg({ x: q.x, y: q.y, w: t2 ? q.h : q.w, h: t2 ? q.w : q.h, shape: q.shape }, "#e8c25a"); }).join("") + '</g>'; }
    }
    this.gOver.innerHTML = s;
    var self2 = this;
    this.gOver.querySelectorAll("[data-issue]").forEach(function (g) { g.style.cursor = "pointer"; g.addEventListener("pointerdown", function (e) { e.stopPropagation(); self2.flashIssue(+g.getAttribute("data-issue")); }); });
  };
  PcbStudio.prototype.measureSvg = function (a, b) {
    var z = this.cam.z, px = function (n) { return r3(n / z); }, d = hyp(b[0] - a[0], b[1] - a[1]);
    return '<line x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '" stroke="#fff" stroke-width="' + px(1.5) + '"/><circle cx="' + a[0] + '" cy="' + a[1] + '" r="' + px(3) + '" fill="#fff"/><circle cx="' + b[0] + '" cy="' + b[1] + '" r="' + px(3) + '" fill="#fff"/>' +
      '<text x="' + r3((a[0] + b[0]) / 2) + '" y="' + r3((a[1] + b[1]) / 2 - px(8)) + '" font-size="' + px(13) + '" text-anchor="middle" fill="#fff" stroke="#0b1620" stroke-width="' + px(3) + '" paint-order="stroke">' + d.toFixed(2) + ' mm (' + (d / 25.4 * 1000).toFixed(0) + ' mil)</text>';
  };

  /* ========================================================= INSPECTOR */

  PcbStudio.prototype.showTab = function (t) {
    this.tab = t;
    this.host.querySelectorAll("[data-tab]").forEach(function (b) { b.setAttribute("aria-selected", b.getAttribute("data-tab") === t ? "true" : "false"); });
    this.inspect();
    this.renderOver();
  };
  PcbStudio.prototype.inspect = function () {
    if (this.tab === "checks") return this.checksPanel();
    if (this.tab === "ai") return this.aiPanel();
    var doc = this.app.doc, pcb = doc.pcb, sel = this.sel, h = "", self = this;
    if (!pcb) { this.panel.innerHTML = '<p class="hint">No board yet. Add parts on the bench, or place a footprint from the library (left).</p><button type="button" class="primary" data-x="newboard">Start an empty board</button>'; this.wire(); return; }
    if (sel && sel.kind === "item") h = this.inspectItem(sel.id);
    else if (sel && sel.kind === "track") h = this.inspectTrack(sel.i);
    else if (sel && sel.kind === "via") h = this.inspectVia(sel.i);
    else if (sel && sel.kind === "cut") h = this.inspectCut(sel.i);
    else h = this.inspectBoard();
    this.panel.innerHTML = h;
    this.wire();
  };
  function num(label, f, v, step, unit, min, max) { return '<label class="px-f"><span>' + label + '</span><input type="number" data-f="' + f + '" value="' + (v == null ? "" : r3(v)) + '" step="' + (step || 0.1) + '"' + (min != null ? ' min="' + min + '"' : "") + (max != null ? ' max="' + max + '"' : "") + '>' + (unit ? "<i>" + unit + "</i>" : "") + '</label>'; }
  function sel_(label, f, v, opts) { return '<label class="px-f"><span>' + label + '</span><select data-f="' + f + '">' + opts.map(function (o) { return '<option value="' + esc(String(o[0])) + '"' + (String(o[0]) === String(v) ? " selected" : "") + '>' + esc(o[1]) + '</option>'; }).join("") + '</select></label>'; }
  function txt(label, f, v, ph) { return '<label class="px-f"><span>' + label + '</span><input type="text" data-f="' + f + '" value="' + esc(v == null ? "" : String(v)) + '"' + (ph ? ' placeholder="' + esc(ph) + '"' : "") + ' maxlength="60"></label>'; }

  PcbStudio.prototype.inspectBoard = function () {
    var pcb = this.app.doc.pcb, R = this.rules(), rep = X.report(this.app.doc, this.model), shape = pcb.shape ? pcb.shape.kind : "rect";
    var h = '<h3>Board</h3><p class="px-sub">' + pcb.w.toFixed(2) + ' × ' + pcb.h.toFixed(2) + ' mm · ' + rep.area.toFixed(0) + ' mm² · ' + rep.parts + ' parts · ' + rep.nets + ' nets · ' + (rep.open ? '<b class="bad">' + rep.open + ' to route</b>' : '<b class="good">all connected</b>') + '</p>';
    h += '<h4>Shape</h4><div class="px-shapes">' + X.PRESETS.map(function (p) { var o = p.make(pcb), pts = o.shape.kind === "poly" ? o.shape.pts : null; var mx = Math.max(o.w, o.h), sv = '<svg viewBox="-2 -2 ' + (mx + 4) + ' ' + (mx + 4) + '"><g transform="translate(' + r3((mx - o.w) / 2) + ' ' + r3((mx - o.h) / 2) + ')">' + (o.shape.kind === "circle" ? '<circle cx="' + o.w / 2 + '" cy="' + o.h / 2 + '" r="' + o.w / 2 + '"/>' : pts ? '<path d="' + X.pathOf(pts, true) + '"/>' : '<rect width="' + o.w + '" height="' + o.h + '" rx="' + (o.r || 0) + '"/>') + '</g></svg>'; return '<button type="button" data-preset="' + p.id + '" title="' + esc(p.blurb) + '">' + sv + '<span>' + esc(p.name) + '</span></button>'; }).join("") + '</div>';
    if (shape === "rect") h += '<div class="px-row">' + num("Width", "b.w", pcb.w, 1, "mm", 10, 400) + num("Height", "b.h", pcb.h, 1, "mm", 10, 400) + num("Corners", "b.r", pcb.r || 0, 0.5, "mm", 0, 20) + '</div>';
    else if (shape === "circle") h += '<div class="px-row">' + num("Diameter", "b.d", pcb.w, 1, "mm", 10, 400) + '</div>';
    else h += '<p class="hint">Free shape with ' + pcb.shape.pts.length + ' corners. Pick the Board shape tool (O) to drag them; double-click a corner to remove it.</p>';
    h += '<div class="px-btns"><button type="button" data-x="draw-shape">✎ Edit the outline</button><button type="button" data-x="trim"' + (shape !== "rect" ? " disabled" : "") + '>Trim to the parts</button></div>';
    h += '<label class="st-chk"><input type="checkbox" data-f="b.holes"' + (pcb.holes ? " checked" : "") + '> Mounting hole in each corner (M3)</label>';
    if (pcb.cut.length) h += '<p class="px-sub">' + pcb.cut.length + ' cut-out' + (pcb.cut.length > 1 ? "s" : "") + '. Pick one to change it, or the Cut-out tool (U) to add another.</p>';
    h += '<h4>Rules</h4><div class="px-row">' + num("Track", "r.track", R.track, 0.05, "mm", 0.1, 3) + num("Power", "r.power", R.power, 0.05, "mm", 0.1, 5) + num("Gap", "r.clear", R.clear, 0.05, "mm", 0.1, 2) + '</div>' +
      '<div class="px-row">' + num("Via", "r.via", R.via, 0.05, "mm", 0.4, 3) + num("Via hole", "r.viaDrill", R.viaDrill, 0.05, "mm", 0.2, 2) + num("Edge", "r.edge", R.edge, 0.1, "mm", 0.2, 5) + '</div>' +
      sel_("Router grid", "r.grid", R.grid, [[0.25, "0.25 mm — fine-pitch chips (slow)"], [0.5, "0.5 mm"], [0.635, "0.635 mm — good for most boards"], [1.27, "1.27 mm — fast, chunky"]]);
    h += '<h4>Looks</h4><div class="px-swatches" role="group" aria-label="Solder mask colour">' + MASKS.map(function (m2) { return '<button type="button" data-mask="' + m2[0] + '" title="' + m2[1] + '" style="background:' + m2[0] + '"' + ((pcb.mask || "#1f6b45") === m2[0] ? ' aria-pressed="true"' : "") + '></button>'; }).join("") + '</div>' +
      sel_("Pad finish", "b.finish", pcb.finish || "#d9b24a", FINISH);
    h += '<h4>What\'s on it</h4>' + this.itemList();
    return h;
  };
  PcbStudio.prototype.itemList = function () {
    var self = this, rows = this.model.items.slice().sort(function (a, b) { return String(a.ref).localeCompare(String(b.ref), undefined, { numeric: true }); });
    var extra = this.app.doc.pcb.items.filter(function (it) { return /^(hole|text|zone|keepout)$/.test(it.kind) && !(it.kind === "hole" && it.plated); });
    return '<ul class="px-list">' + rows.map(function (it) { var pl = X.placeOf(self.app.doc, it); return '<li><button type="button" data-pick="' + esc(it.id) + '"><b>' + esc(it.ref || "") + '</b> ' + esc(it.title || it.value || "") + ' <i>' + esc(it.fp.id.indexOf("bench:") === 0 ? "bench" : it.fp.id) + (pl && pl.side === "bottom" ? " · back" : "") + '</i></button></li>'; }).join("") +
      extra.map(function (it) { return '<li><button type="button" data-pick="' + esc(it.id) + '">' + ({ hole: "◯ Hole Ø" + it.d, text: "T “" + esc(it.s) + "”", zone: "▦ Pour " + esc(it.net) + " (" + (it.layer ? "bottom" : "top") + ")", keepout: "⊘ Keep-out" })[it.kind] + '</button></li>'; }).join("") + '</ul>';
  };
  PcbStudio.prototype.inspectItem = function (id) {
    var it = this.item(id), bi = this.boardItem(id), doc = this.app.doc, h = "", self = this;
    if (bi && !it) {
      if (bi.kind === "text") return '<h3>Text</h3>' + txt("Text", "s", bi.s) + '<div class="px-row">' + num("Size", "size", bi.size || 1.5, 0.1, "mm", 0.5, 20) + sel_("On", "layer", bi.layer || "silk", [["silk", "Silkscreen, top"], ["bsilk", "Silkscreen, back"], ["top", "Copper, top"], ["bottom", "Copper, bottom"]]) + '</div>' + this.xy(bi) + del();
      if (bi.kind === "hole") return '<h3>Hole</h3>' + '<div class="px-row">' + num("Diameter", "d", bi.d, 0.1, "mm", 0.3, 30) + '</div>' + this.xy(bi) + '<label class="st-chk"><input type="checkbox" data-f="plated"> Plated (copper round it)</label>' + del();
      if (bi.kind === "zone") return '<h3>Copper pour</h3><p class="px-sub">' + (bi.pts === "board" ? "The whole " : "Part of the ") + (bi.layer ? "bottom" : "top") + ', joined to a net. Everything else keeps ' + this.rules().clear + ' mm clear of it.</p>' + sel_("Net", "net", bi.net, this.netOptions(bi.net)) + sel_("Side", "layer", bi.layer, [[0, "Top"], [1, "Bottom"]]) + del();
      if (bi.kind === "keepout") return '<h3>Keep-out</h3><p class="px-sub">The router keeps copper out of this box.</p>' + sel_("Side", "layer", bi.layer == null ? 2 : bi.layer, [[2, "Both sides"], [0, "Top only"], [1, "Bottom only"]]) + del();
    }
    if (!it) return this.inspectBoard();
    var pl = X.placeOf(doc, it), fp = it.fp;
    h += '<h3>' + esc(it.ref || "") + ' <small>' + esc(it.title || "") + '</small></h3>';
    h += '<div class="px-fp">' + X.fpSvg(fp, null, { labels: "name" }) + '</div>';
    if (it.kind === "part") {
      var opts = [["", "As on the bench (" + (fp.off ? "wire pads" : "0.1\" pads") + ")"]].concat(X.packages(it.part).map(function (k) { return [k, (FP.get(k) || {}).name || k]; }));
      if (L.def(it.part).fpData) opts = [["", "Its own footprint (" + esc(L.def(it.part).fpData.name || "custom") + ")"]];
      h += sel_("Package", "fp", pl.fp || "", opts);
      if (fp.unmapped && fp.unmapped.length) h += '<p class="bad">No pad for pin' + (fp.unmapped.length > 1 ? "s " : " ") + esc(fp.unmapped.join(", ")) + '. Pick a package with more pins.</p>';
      h += '<p class="px-sub">' + esc(it.value || "") + (it.src === "lib" ? " · " + esc(fp.name) : "") + ' — a part of the circuit; its connections come from the bench.</p>';
    } else if (it.kind === "fp") {
      h += txt("Reference", "ref", bi.ref) + txt("Value", "value", bi.value || "", fp.name);
      h += '<p class="px-sub">' + esc(fp.name) + ' — on the board only. Join its pads with the Connect tool (C) or give them net labels below.</p>';
    } else if (it.kind === "array") {
      h += sel_("Pattern", "pattern", bi.pattern || "grid", [["grid", "Grid"], ["circle", "Circle"]]);
      if ((bi.pattern || "grid") === "grid") h += '<div class="px-row">' + num("Columns", "cols", bi.cols, 1, "", 1, 80) + num("Rows", "rows", bi.rows, 1, "", 1, 80) + num("Pitch", "pitch", bi.pitch, 0.01, "mm", 0.5, 20) + '</div>' + sel_("Copper", "strip", bi.strip || "none", [["none", "Separate pads (perfboard)"], ["rows", "Strips along rows (stripboard)"], ["cols", "Strips down columns"]]);
      else h += '<div class="px-row">' + num("Holes", "n", bi.n || 6, 1, "", 2, 64) + num("Radius", "radius", bi.radius || 10, 0.5, "mm", 1, 200) + '</div>';
      h += '<div class="px-row">' + num("Drill", "d", bi.d, 0.05, "mm", 0.3, 10) + num("Pad", "pad", bi.pad == null ? bi.d + 0.8 : bi.pad, 0.1, "mm", 0, 12) + '</div><p class="hint">Pad 0 makes bare holes, for screws or ventilation.</p>';
    }
    h += this.xy(pl, it.kind === "part" || it.kind === "fp");
    if (it.kind === "part" || it.kind === "fp") h += '<div class="px-btns"><button type="button" data-x="rot">⟳ Turn (R)</button><button type="button" data-x="flip">⇋ ' + (pl.side === "bottom" ? "Move to the top" : "Put on the back") + ' (B)</button>' + (it.kind === "part" ? '<button type="button" data-x="bench">Show on the bench</button>' : "") + '</div>';
    /* pins */
    if (it.kind !== "array" || (bi && bi.pad > bi.d)) {
      var pads = [], seen = {};
      fp.pads.forEach(function (q) { var k = it.keyOf[q.n]; if (seen[k]) return; seen[k] = 1; pads.push({ q: q, k: k }); });
      pads.sort(function (a, b) { return String(a.q.n).localeCompare(String(b.q.n), undefined, { numeric: true }); });
      if (pads.length <= 64) {
        h += '<h4>Pins</h4><table class="px-pins"><tr><th>Pad</th><th>Name</th><th>Net</th><th>Label</th></tr>' + pads.map(function (o) {
          var n = self.model.padNet[o.k], lab = doc.pcb.labels[o.k] || "";
          return '<tr><td>' + esc(o.q.n) + '</td><td>' + esc(o.q.name || "") + '</td><td>' + (n ? '<span class="px-net">' + esc(self.model.nets[n - 1].name) + '</span>' : '<span class="dim">—</span>') + '</td><td><input type="text" data-label="' + esc(o.k) + '" value="' + esc(lab) + '" placeholder="net…" list="px-nets" maxlength="24"></td></tr>';
        }).join("") + '</table><datalist id="px-nets">' + this.model.nets.map(function (n) { return '<option value="' + esc(n.name) + '">'; }).join("") + '</datalist>';
      }
    }
    if (it.kind === "fp" || it.kind === "array") h += del();
    if (it.kind === "fp" && fp.kind) h += '<p class="px-sub">Footprint: ' + esc(fp.id) + ' · ' + fp.pads.length + ' pads · ' + (fp.kind === "smd" ? "surface mount" : fp.kind === "tht" ? "through-hole" : "mixed") + '.</p>';
    return h;
  };
  function del() { return '<div class="px-btns"><button type="button" data-x="del" class="danger">Delete</button></div>'; }
  PcbStudio.prototype.xy = function (o, rot) { return '<div class="px-row">' + num("X", "x", o.x, this.snap, "mm") + num("Y", "y", o.y, this.snap, "mm") + (rot ? sel_("Turn", "rot", o.rot || 0, [[0, "0°"], [1, "90°"], [2, "180°"], [3, "270°"]]) : "") + '</div>'; };
  PcbStudio.prototype.netOptions = function (cur) { var o = this.model.nets.map(function (n) { return [n.name, n.name]; }); if (cur && !o.some(function (x) { return x[0] === cur; })) o.unshift([cur, cur + " (not on the board yet)"]); return o.length ? o : [["GND", "GND"]]; };
  PcbStudio.prototype.inspectTrack = function (i) {
    var t = this.app.doc.pcb.tracks[i]; if (!t) return this.inspectBoard();
    var len = 0; for (var q = 1; q < t.pts.length; q++) len += hyp(t.pts[q][0] - t.pts[q - 1][0], t.pts[q][1] - t.pts[q - 1][1]);
    var net = this.model.nets[t.n];
    /* IPC-2221, outer layer, 1 oz copper (1.378 mil), 10 °C rise: I = 0.048 · ΔT^0.44 · A^0.725 */
    var amps = 0.048 * Math.pow(10, 0.44) * Math.pow(t.w / 0.0254 * 1.378, 0.725);
    return '<h3>Track</h3><p class="px-sub">' + (t.l ? "Bottom" : "Top") + ' · ' + len.toFixed(2) + ' mm long · ' + (net ? esc(net.name) : "no net") + ' · ' + (t.man ? "drawn by hand (the router leaves it alone)" : "drawn by the router") + '</p>' +
      '<div class="px-row">' + num("Width", "w", t.w, 0.05, "mm", 0.1, 5) + sel_("Side", "l", t.l, [[0, "Top"], [1, "Bottom"]]) + '</div>' +
      '<p class="hint">At this width, 1 oz copper carries about ' + (amps).toFixed(1) + ' A with a 10 °C rise (IPC-2221, outer layer).</p>' +
      '<div class="px-btns">' + (!t.man ? '<button type="button" data-x="keep">Keep it (make it mine)</button>' : "") + '<button type="button" data-x="del" class="danger">Delete</button></div>';
  };
  PcbStudio.prototype.inspectVia = function (i) { var v = this.app.doc.pcb.vias[i]; if (!v) return this.inspectBoard(); var net = this.model.nets[v[2]]; return '<h3>Via</h3><p class="px-sub">' + (net ? esc(net.name) : "no net") + ' · ' + this.rules().via + ' mm, ' + this.rules().viaDrill + ' mm hole</p><div class="px-row">' + num("X", "vx", v[0], this.snap, "mm") + num("Y", "vy", v[1], this.snap, "mm") + '</div>' + del(); };
  PcbStudio.prototype.inspectCut = function (i) {
    var c = this.app.doc.pcb.cut[i]; if (!c) return this.inspectBoard();
    var h = '<h3>Cut-out</h3>' + sel_("Shape", "c.kind", c.kind, [["rect", "Rectangle"], ["circle", "Circle"]]);
    h += c.kind === "circle" ? '<div class="px-row">' + num("Diameter", "c.d", c.d, 0.5, "mm", 0.5, 300) + '</div>' : '<div class="px-row">' + num("Width", "c.w", c.w, 0.5, "mm", 0.5, 300) + num("Height", "c.h", c.h, 0.5, "mm", 0.5, 300) + num("Corners", "c.r", c.r || 0, 0.25, "mm", 0, 50) + '</div>';
    return h + '<div class="px-row">' + num("X", "c.x", c.x, this.snap, "mm") + num("Y", "c.y", c.y, this.snap, "mm") + '</div>' + del();
  };

  /* Wire up whatever the inspector just drew. */
  PcbStudio.prototype.wire = function () {
    var self = this, app = this.app, doc = app.doc, P = this.panel, sel = this.sel;
    var change = function (f, v) {
      var pcb = doc.pcb;
      if (!pcb) return;
      var reroute = false;
      self.edit(function () {
        var it = sel && sel.kind === "item" ? self.item(sel.id) : null, bi = sel && sel.kind === "item" ? self.boardItem(sel.id) : null, pl = it ? X.placeOf(doc, it) : bi;
        if (/^b\./.test(f)) {
          var k = f.slice(2);
          if (k === "w" || k === "h") { pcb[k] = r3(L.clamp(+v || 10, 10, 400)); reroute = true; }
          else if (k === "r") { pcb.r = r3(L.clamp(+v || 0, 0, Math.min(pcb.w, pcb.h) / 2)); reroute = true; }
          else if (k === "d") { var d = L.clamp(+v || 10, 10, 400); X.shift(pcb, (d - pcb.w) / 2, (d - pcb.h) / 2); pcb.w = pcb.h = r3(d); reroute = true; }
          else if (k === "holes") { pcb.holes = !!v; reroute = true; }
          else if (k === "finish") pcb.finish = v;
          return;
        }
        if (/^r\./.test(f)) { pcb.rules = pcb.rules || {}; pcb.rules[f.slice(2)] = +v; if (f === "r.grid") reroute = true; return; }
        if (/^c\./.test(f)) { var c = pcb.cut[sel.i], ck = f.slice(2); if (ck === "kind") { if (v === "circle") { c.d = Math.max(c.w || 4, c.h || 4); c.x = c.x + (c.w || 0) / 2; c.y = c.y + (c.h || 0) / 2; } else { c.w = c.h = c.d || 4; c.x -= c.w / 2; c.y -= c.h / 2; } c.kind = v; } else c[ck] = +v; reroute = true; return; }
        if (sel && sel.kind === "track") { var t = pcb.tracks[sel.i]; if (f === "w") t.w = r3(L.clamp(+v, 0.1, 5)); if (f === "l") t.l = +v; t.man = 1; return; }
        if (sel && sel.kind === "via") { var vv = pcb.vias[sel.i]; if (f === "vx") vv[0] = +v; if (f === "vy") vv[1] = +v; vv[3] = 1; return; }
        if (!pl) return;
        if (f === "x" || f === "y") { pl[f] = r3(+v); reroute = true; }
        else if (f === "rot") { pl.rot = +v; reroute = true; }
        else if (f === "fp") { if (v) pl.fp = v; else delete pl.fp; reroute = true; }
        else if (/^(cols|rows|n)$/.test(f)) { pl[f] = Math.max(1, Math.round(+v)); reroute = true; }
        else if (/^(pitch|d|pad|radius|size)$/.test(f)) { pl[f] = r3(+v); reroute = f !== "size"; }
        else if (f === "layer") { pl.layer = /^\d$/.test(v) ? +v : v; reroute = bi && bi.kind === "keepout"; }
        else if (f === "plated") { pl.plated = !!v; reroute = true; }
        else pl[f] = v;
        if (f === "strip" || f === "pattern" || f === "net") reroute = true;
      }, false);
      if (reroute && self.auto) { X.route(doc, self.model); self.ver++; self.render(); }
    };
    P.querySelectorAll("[data-f]").forEach(function (inp) {
      var f = inp.getAttribute("data-f");
      inp.addEventListener("change", function () { change(f, inp.type === "checkbox" ? inp.checked : inp.value); });
    });
    var pl0 = sel && sel.kind === "item" ? this.boardItem(sel.id) : null;
    var plated = P.querySelector('[data-f="plated"]'); if (plated && pl0) plated.checked = !!pl0.plated;
    P.querySelectorAll("[data-label]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var k = inp.getAttribute("data-label"), v = inp.value.trim().replace(/[^A-Za-z0-9_+\-./]/g, "").slice(0, 24);
        self.edit(function (pcb) { if (v) pcb.labels[k] = v; else delete pcb.labels[k]; }, true);
      });
    });
    P.querySelectorAll("[data-preset]").forEach(function (b) { b.addEventListener("click", function () { var id = b.getAttribute("data-preset"); self.edit(function () { X.applyPreset(doc, id); }, true); self.fit(); app.toast(X.PRESETS.filter(function (p) { return p.id === id; })[0].name + ". Parts kept their places — Arrange or drag them to fit."); }); });
    P.querySelectorAll("[data-mask]").forEach(function (b) { b.addEventListener("click", function () { self.edit(function (pcb) { pcb.mask = b.getAttribute("data-mask"); }); if (self.look === "layers") self.setLook("real"); }); });
    P.querySelectorAll("[data-pick]").forEach(function (b) { b.addEventListener("click", function () { var id = b.getAttribute("data-pick"); if (self.item(id)) self.pickPart(id); else self.select({ kind: "item", id: id }); }); });
    P.querySelectorAll("[data-x]").forEach(function (b) {
      b.addEventListener("click", function () {
        var x = b.getAttribute("data-x");
        if (x === "newboard") { doc.pcb = PCB.blank(); X.upgrade(doc.pcb); self.sync(); app.changed(); }
        else if (x === "del") self.remove();
        else if (x === "rot") self.rotate(sel.id);
        else if (x === "flip") { var pl = self.placeOf(sel.id); self.edit(function () { if (pl.side === "bottom") delete pl.side; else pl.side = "bottom"; }, true); }
        else if (x === "bench") { app.studio.setSpace("bench"); app.bench.select({ kind: "part", id: sel.id }); }
        else if (x === "trim") { self.edit(function () { X.fitBoard(doc, self.model); }, true); self.fit(); }
        else if (x === "draw-shape") self.setTool("outline");
        else if (x === "keep") self.edit(function (pcb) { pcb.tracks[sel.i].man = 1; });
      });
    });
  };

  /* ============================================================ CHECKS */

  PcbStudio.prototype.runChecks = function () {
    if (!this.app.doc.pcb) return;
    this.issues = X.drc(this.app.doc, this.model);
    this.badge();
    if (this.tab === "checks") this.checksPanel();
    this.renderOver();
  };
  PcbStudio.prototype.autoCheck = function () {
    var self = this;
    clearTimeout(this.checkT);
    this.checkT = setTimeout(function () { if (self.host.offsetParent && self.app.doc.pcb) self.runChecks(); }, 700);
  };
  PcbStudio.prototype.badge = function () {
    var b = this.host.querySelector(".px-badge"), n = (this.issues || []).filter(function (q) { return q.level !== "info"; }).length, bad = (this.issues || []).some(function (q) { return q.level === "danger"; });
    b.hidden = !this.issues; b.textContent = n ? String(n) : "✓"; b.className = "px-badge " + (bad ? "bad" : n ? "warn" : "good");
  };
  PcbStudio.prototype.checksPanel = function () {
    var self = this, list = this.issues;
    if (!list) { this.panel.innerHTML = '<h3>Checks</h3><p class="hint">Checking…</p>'; this.runChecks(); return; }
    var c = { danger: 0, warn: 0, info: 0 };
    list.forEach(function (q) { c[q.level]++; });
    var h = '<h3>Checks</h3><p class="px-sub">' + (c.danger ? '<b class="bad">' + c.danger + ' must fix</b> · ' : "") + (c.warn ? '<b class="warn">' + c.warn + ' to look at</b> · ' : "") + (c.info ? c.info + ' notes' : "") + (!list.length ? '<b class="good">Nothing found. The board passes every check.</b>' : "") + '</p>';
    h += '<div class="px-btns"><button type="button" data-c="run">Check again</button>' + (list.some(function (q) { return q.code === "open"; }) ? '<button type="button" data-c="route" class="primary">Route what\'s open</button>' : "") + '<button type="button" data-c="ask">Ask how to fix</button></div>';
    h += '<ol class="px-issues">' + list.slice(0, 200).map(function (q, i) { return '<li class="lv-' + q.level + '"><button type="button" data-i="' + i + '"><span class="dot" aria-hidden="true"></span>' + esc(q.msg) + '</button></li>'; }).join("") + '</ol>';
    this.panel.innerHTML = h;
    this.panel.querySelectorAll("[data-i]").forEach(function (b) { b.addEventListener("click", function () { self.flashIssue(+b.getAttribute("data-i")); }); });
    this.panel.querySelectorAll("[data-c]").forEach(function (b) { b.addEventListener("click", function () { var c2 = b.getAttribute("data-c"); if (c2 === "run") self.runChecks(); if (c2 === "route") self.action("route"); if (c2 === "ask") { self.showTab("ai"); self.ask("How do I fix the problems the check found?"); } }); });
  };
  PcbStudio.prototype.flashIssue = function (i) {
    var q = this.issues && this.issues[i]; if (!q) return;
    this.flash = i;
    if (q.x || q.y) { this.cam.x = q.x; this.cam.y = q.y; this.cam.z = Math.max(this.cam.z, 12); this.applyCam(); }
    if (q.ids && q.ids[0] && this.item(q.ids[0])) this.sel = { kind: "item", id: q.ids[0] };
    this.render();
    var self = this; setTimeout(function () { self.flash = null; self.renderOver(); }, 900);
    this.hint(q.msg);
  };

  /* ========================================================= ASSISTANT */

  PcbStudio.prototype.aiPanel = function () {
    var self = this, ai = this.app.cfg.aiEnabled && this.app.cfg.aiUrl;
    var chips = ["Check my board and tell me what to fix", "Make it a round badge", "Add a USB-C power input", "Add mounting holes and a ground plane", "Use surface-mount parts", "Make the power tracks wider", "Add a prototyping area", "Explain the parts on this board"];
    var h = '<h3>Assistant <small>' + (ai ? "AI" : "built-in adviser") + '</small></h3><div class="px-chat" aria-live="polite">' + (this.chat.length ? this.chat.map(this.chatHtml, this).join("") : '<p class="hint">Ask about the board, or ask for a change — a shape, a connector, a pour, a re-layout. Changes come back as a list you can tick and apply, and Undo takes them back.</p>') + '</div>' +
      '<div class="px-chips">' + chips.map(function (c) { return '<button type="button" data-chip="' + esc(c) + '">' + esc(c) + '</button>'; }).join("") + '</div>' +
      '<form class="px-ask"><input type="text" placeholder="Ask, or say what to change…" maxlength="400" aria-label="Ask the assistant"><button type="submit" class="primary">Ask</button></form>';
    this.panel.innerHTML = h;
    var form = this.panel.querySelector(".px-ask"), inp = form.querySelector("input");
    form.addEventListener("submit", function (e) { e.preventDefault(); if (inp.value.trim()) { self.ask(inp.value.trim()); inp.value = ""; } });
    this.panel.querySelectorAll("[data-chip]").forEach(function (b) { b.addEventListener("click", function () { self.ask(b.getAttribute("data-chip")); }); });
    this.panel.querySelectorAll("[data-apply]").forEach(function (b) {
      b.addEventListener("click", function () {
        var m = self.chat[+b.getAttribute("data-apply")], picks = [];
        self.panel.querySelectorAll('[data-act-of="' + b.getAttribute("data-apply") + '"]').forEach(function (cb) { if (cb.checked) picks.push(m.actions[+cb.getAttribute("data-n")]); });
        self.apply(picks); m.applied = true; self.aiPanel();
      });
    });
    var chat = this.panel.querySelector(".px-chat"); chat.scrollTop = chat.scrollHeight;
  };
  PcbStudio.prototype.chatHtml = function (m, i) {
    if (m.who === "me") return '<p class="me">' + esc(m.text) + '</p>';
    var h = '<div class="ai">' + (m.wait ? '<p class="dim">Thinking…</p>' : m.text.split(/\n{2,}/).map(function (p) { return '<p>' + esc(p).replace(/\n/g, "<br>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>") + '</p>'; }).join(""));
    if (m.actions && m.actions.length) {
      h += '<ul class="px-acts">' + m.actions.map(function (a, n) { return '<li><label><input type="checkbox" data-act-of="' + i + '" data-n="' + n + '" checked' + (m.applied ? " disabled" : "") + '> ' + esc(a.why || describe(a)) + '</label></li>'; }).join("") + '</ul>';
      h += m.applied ? '<p class="good">Applied. Undo (Ctrl+Z) takes it back.</p>' : '<button type="button" class="primary" data-apply="' + i + '">Apply ' + (m.actions.length > 1 ? "these " + m.actions.length + " changes" : "this change") + '</button>';
    }
    return h + '</div>';
  };
  function describe(a) {
    switch (a.do) {
      case "shape": return "Make the board " + (X.PRESETS.filter(function (p) { return p.id === a.preset; })[0] || { name: a.preset }).name.toLowerCase();
      case "size": return "Make the board " + a.w + " × " + a.h + " mm";
      case "place": return "Move " + a.ref + " to " + a.x + ", " + a.y + (a.rot != null ? ", turned " + a.rot * 90 + "°" : "");
      case "package": return "Give " + a.ref + " the " + a.fp + " package";
      case "add": return "Add " + ((FP.get(a.fp) || {}).name || a.fp) + (a.ref ? " as " + a.ref : "");
      case "hole": return "Add a " + (a.d || 3.2) + " mm hole at " + a.x + ", " + a.y;
      case "holes": return "Add a mounting hole in each corner";
      case "pattern": return "Add a " + (a.cols || 10) + " × " + (a.rows || 6) + " prototyping area";
      case "link": return "Connect " + a.a + " to " + a.b;
      case "label": return "Label " + a.pad + " as " + a.net;
      case "pour": return "Fill the " + (a.layer === "top" ? "top" : "bottom") + " with copper on " + (a.net || "GND");
      case "text": return "Write “" + a.s + "” on the board";
      case "rules": return "Change the rules (" + Object.keys(a).filter(function (k) { return k !== "do" && k !== "why"; }).map(function (k) { return k + " " + a[k]; }).join(", ") + ")";
      case "route": return "Route the tracks";
      case "arrange": return "Lay the parts out again";
      case "mask": return "Colour the board " + a.color;
      default: return a.do;
    }
  }

  /* A digest of the board for the AI: small, numeric, with references. */
  PcbStudio.prototype.digest = function () {
    var doc = this.app.doc, m = this.model, pcb = doc.pcb, R = this.rules();
    var issues = (this.issues || X.drc(doc, m)).slice(0, 25).map(function (q) { return q.level + ": " + q.msg; });
    return {
      size: [pcb.w, pcb.h], shape: pcb.shape ? pcb.shape.kind : "rect", cutouts: pcb.cut.length, rules: R, mask: pcb.mask || "#1f6b45",
      parts: m.items.slice(0, 80).map(function (it) { var pl = X.placeOf(doc, it); return { ref: it.ref, what: it.title, value: it.value, fp: it.fp.id, kind: it.kind, x: pl ? r3(pl.x) : null, y: pl ? r3(pl.y) : null, rot: pl ? pl.rot || 0 : 0, side: pl && pl.side || "top", pads: it.fp.pads.length }; }),
      nets: m.nets.slice(0, 120).map(function (n) { return { name: n.name, pins: n.pads.slice(0, 16).map(function (p) { var it = m.index[p.id], pin = p.key.slice(p.key.indexOf(":") + 1); return it.ref + "." + pin.replace(/^#/, ""); }) }; }),
      tracks: pcb.tracks.length, vias: pcb.vias.length, pours: pcb.items.filter(function (it) { return it.kind === "zone"; }).map(function (z) { return z.net + "@" + (z.layer ? "bottom" : "top"); }),
      holes: pcb.items.filter(function (it) { return it.kind === "hole"; }).length + (pcb.holes ? 4 : 0), issues: issues,
      library: FP.LIB.map(function (f) { return f.id; }).join(" "), presets: X.PRESETS.map(function (p) { return p.id; }).join(" ")
    };
  };
  PcbStudio.prototype.ask = function (q) {
    var self = this, app = this.app, cfg = app.cfg;
    if (!app.doc.pcb) { app.doc.pcb = PCB.blank(); X.upgrade(app.doc.pcb); this.sync(); }
    this.chat.push({ who: "me", text: q });
    var msg = { who: "ai", text: "", wait: true };
    this.chat.push(msg);
    if (this.tab === "ai") this.aiPanel();
    var done = function (res) { msg.wait = false; msg.text = res.answer || "Done."; msg.actions = (res.actions || []).filter(function (a) { return a && a.do; }).slice(0, 30); if (self.tab === "ai") self.aiPanel(); };
    if (!cfg.aiEnabled || !cfg.aiUrl) { setTimeout(function () { done(self.adviser(q)); }, 250); return; }
    fetch(cfg.aiUrl, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": cfg.csrf },
      body: JSON.stringify({ kind: "pcb", question: q, mode: "pro", circuit: app.digest(), code: "", board: this.digest() }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j || j.ok === false) throw j; done({ answer: j.reply || j.answer || "", actions: j.actions }); })
      .catch(function (e) { var local = self.adviser(q); local.answer = (e && e.error ? "(The AI couldn't answer: " + e.error + " Here is the built-in adviser instead.)\n\n" : "(The AI didn't answer, so this is the built-in adviser.)\n\n") + local.answer; done(local); });
  };

  /* The built-in adviser: reads the board and the check, knows the common
   * requests, and answers with the same kind of change list as the AI. */
  PcbStudio.prototype.adviser = function (q) {
    var t = q.toLowerCase(), doc = this.app.doc, pcb = doc.pcb, m = this.model, R = this.rules(), acts = [], say = [];
    var drc = X.drc(doc, m), rep = X.report(doc, m), has = function (re) { return re.test(t); };
    var gnd = m.nets.filter(function (n) { return /^GND/.test(n.name); })[0], pwr = m.nets.filter(function (n) { return /^(\+5V|PWR|VCC|VIN|\+3V3)/.test(n.name); })[0];
    var shapes = { circle: /round|circle|disc/, heart: /heart/, hex: /hex/, badge: /badge|shield shape|crest/, card: /credit|card/, arduino: /arduino|uno/, pihat: /\bhat\b|raspberry|pi hat/, pizero: /zero/, feather: /feather/, euro: /euro/, rect: /rectangle|rectangular|square/ };
    Object.keys(shapes).forEach(function (k) { if (shapes[k].test(t) && !acts.some(function (a) { return a.do === "shape"; }) && /shape|make|board|turn|into|outline|badge|hat|shield|round|heart/.test(t)) acts.push({ do: "shape", preset: k }); });
    if (acts.length) { say.push("A new outline. Parts keep their places, so you may want to Arrange or drag a few to fit inside — the check will flag anything hanging off the edge."); acts.push({ do: "route" }); }
    if (has(/usb/)) {
      acts.push({ do: "add", fp: "USB-C-16", x: r3(pcb.w / 2), y: r3(pcb.h - 4.5), rot: 0, ref: "J" + (m.items.filter(function (it) { return /^J/.test(it.ref || ""); }).length + 1), why: "Add a USB-C socket at the bottom edge" });
      say.push("A USB-C socket is placed at the bottom edge. Its VBUS pads carry 5 V and the A1/B12 pads are ground. For a USB-C charger to give you 5 V, each CC pin (A5 and B5) needs its own 5.1 kΩ resistor to ground — add two 0805 resistors on the bench and wire them, or label the pads here.");
      if (gnd) acts.push({ do: "label", pad: "new.A1", net: gnd.name, why: "Join the socket's ground to " + gnd.name });
      if (pwr) acts.push({ do: "label", pad: "new.A4", net: pwr.name, why: "Join VBUS to " + pwr.name });
      acts.push({ do: "route" });
    }
    if (has(/mount|screw hole|holes in the corner|corner holes/) || has(/mounting/)) { acts.push({ do: "holes", why: "A 3.2 mm (M3) mounting hole in each corner" }); say.push("Four M3 holes, 3.5 mm in from each corner — the usual spot. Keep tall parts a few millimetres away so a screw head fits."); }
    if (has(/ground plane|pour|gnd plane|copper fill|flood/) || (has(/ground/) && has(/plane|fill/))) { acts.push({ do: "pour", layer: "bottom", net: gnd ? gnd.name : "GND", why: "Fill the bottom with copper joined to " + (gnd ? gnd.name : "GND") }); say.push("A ground plane on the back gives every part a short way home, cuts noise and makes routing easier: the router no longer needs to draw most ground tracks."); }
    if (has(/surface|smd|smaller|tiny/)) {
      m.items.forEach(function (it) { if (it.kind !== "part") return; var smd = X.packages(it.part).filter(function (id) { var f = FP.get(id); return f && f.kind === "smd"; })[0]; if (smd) acts.push({ do: "package", ref: it.ref, fp: smd }); });
      if (acts.some(function (a) { return a.do === "package"; })) { acts.push({ do: "arrange" }, { do: "route" }); say.push("Surface-mount parts are smaller and sit on the top copper only. Solder them with a fine tip and flux — 0805 is still friendly by hand. Parts with no SMD version stay through-hole."); }
    }
    if (has(/through.?hole|tht|easier to solder|beginner/)) {
      m.items.forEach(function (it) { if (it.kind !== "part") return; var th = X.packages(it.part).filter(function (id) { var f = FP.get(id); return f && f.kind === "tht"; })[0]; if (th) acts.push({ do: "package", ref: it.ref, fp: th }); });
      acts.push({ do: "arrange" }, { do: "route" }); say.push("Through-hole parts are the easiest to solder: legs through the board, solder on the back.");
    }
    if (has(/wider|power track|current|thick/)) { acts.push({ do: "rules", power: Math.max(0.8, R.power), why: "Power tracks " + Math.max(0.8, R.power) + " mm wide" }, { do: "route" }); say.push("Wider power tracks carry more current and drop less voltage: 0.8 mm of 1 oz copper carries about 2 A comfortably."); }
    if (has(/proto|prototyp|perf|spare holes|breadboard area/)) { acts.push({ do: "pattern", x: r3(pcb.w / 2), y: r3(pcb.h / 2), cols: 10, rows: 6, pitch: 2.54, why: "A 10 × 6 prototyping area" }); say.push("A prototyping area: spare 0.1\" holes for adding parts later. Drag it to a free corner."); }
    if (has(/test point/)) m.nets.filter(function (n) { return n.power; }).slice(0, 4).forEach(function (n, i) { acts.push({ do: "add", fp: "TestPoint_THT", x: r3(4 + i * 4), y: 3, ref: "TP" + (i + 1), why: "A test point on " + n.name }); acts.push({ do: "label", pad: "new.1", net: n.name }); });
    if (has(/route|connect everything|tracks/) && !acts.some(function (a) { return a.do === "route"; })) acts.push({ do: "route" });
    if (has(/arrange|layout|lay out|tidy|organi/)) { acts.unshift({ do: "arrange" }); acts.push({ do: "route" }); say.push("Parts are laid out again, most-connected first so they end up beside each other."); }
    var mm = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*mm/.exec(t); if (mm) { acts.push({ do: "size", w: +mm[1], h: +mm[2] }); acts.push({ do: "route" }); }
    var col = /(green|blue|red|black|white|purple|yellow)/.exec(t); if (col && has(/colou?r|mask|make it/)) acts.push({ do: "mask", color: col[1] });
    var exp = /(?:explain|what (?:is|does)|tell me about)\s+([a-z]+\d+)/.exec(t);
    if (exp || has(/explain the parts|what's on|what is on/)) {
      var list = exp ? m.items.filter(function (it) { return (it.ref || "").toLowerCase() === exp[1]; }) : m.items.filter(function (it) { return it.kind !== "array"; }).slice(0, 12);
      list.forEach(function (it) {
        var nets = {}; it.fp.pads.forEach(function (p) { var n = m.padNet[it.keyOf[p.n]]; if (n) nets[m.nets[n - 1].name] = 1; });
        say.push("**" + it.ref + "** — " + (it.title || "") + (it.value ? " (" + it.value + ")" : "") + ", " + (it.fp.id.indexOf("bench:") === 0 ? "with pads where its legs are on the bench" : it.fp.name) + ". " + it.fp.pads.length + " pads" + (Object.keys(nets).length ? ", on " + Object.keys(nets).slice(0, 8).join(", ") : ", not connected to anything yet") + ".");
      });
      if (!list.length && exp) say.push("There's no " + exp[1].toUpperCase() + " on this board.");
    }
    if (has(/check|review|problem|wrong|fix|ready|manufactur|order/) || (!acts.length && say.length === 0)) {
      var bad = drc.filter(function (d) { return d.level === "danger"; }), warn = drc.filter(function (d) { return d.level === "warn"; });
      say.push("The board is " + pcb.w.toFixed(1) + " × " + pcb.h.toFixed(1) + " mm with " + rep.parts + " parts and " + rep.nets + " nets. " + (rep.open ? rep.open + " connection" + (rep.open > 1 ? "s are" : " is") + " still air wires." : "Everything is connected in copper."));
      if (bad.length) say.push("Must fix: " + bad.slice(0, 4).map(function (d) { return d.msg; }).join(" · ") + (bad.length > 4 ? " … and " + (bad.length - 4) + " more." : ""));
      if (warn.length) say.push("Worth a look: " + warn.slice(0, 4).map(function (d) { return d.msg; }).join(" · ") + (warn.length > 4 ? " … and " + (warn.length - 4) + " more." : ""));
      var tips = [];
      if (rep.open) { tips.push("route the open connections (or draw them with the Track tool)"); acts.push({ do: "route" }); }
      if (!pcb.holes && !pcb.items.some(function (it) { return it.kind === "hole"; })) { tips.push("add mounting holes so it can be screwed into a case"); acts.push({ do: "holes" }); }
      if (gnd && !pcb.items.some(function (it) { return it.kind === "zone"; })) { tips.push("pour ground on the back"); acts.push({ do: "pour", layer: "bottom", net: gnd.name }); }
      if (drc.some(function (d) { return d.code === "overlap"; })) { tips.push("spread out the parts that overlap"); acts.unshift({ do: "arrange" }); }
      if (drc.some(function (d) { return d.code === "off" || d.code === "edge"; })) tips.push("pull parts in from the edge — or Trim the board to fit them");
      if (tips.length) say.push("Next: " + tips.join("; ") + ".");
      else if (!bad.length) say.push("It looks ready. Export → Gerber files, upload the zip to a board house and check their preview before you order.");
    }
    if (!say.length && !acts.length) say.push("I can change the shape (round, heart, hexagon, badge, Arduino shield, Pi HAT), add USB-C, mounting holes, a ground plane, test points or a prototyping area, switch parts to surface-mount or through-hole, make power tracks wider, re-arrange and route — or check the board and explain what's on it.");
    if (!say.length) say.push("Here's what I'd change. Untick anything you don't want, then Apply.");
    var seen = {};
    acts = acts.filter(function (a) { var k = JSON.stringify(a); if (seen[k]) return false; seen[k] = 1; return true; });
    var routes = acts.filter(function (a) { return a.do === "route"; });
    acts = acts.filter(function (a) { return a.do !== "route"; }).concat(routes.length ? [routes[0]] : []);
    return { answer: say.join("\n\n"), actions: acts };
  };

  /* Apply a list of changes (from the AI or the adviser) as one undo step.
   * Every field is checked; unknown references and footprints are skipped. */
  PcbStudio.prototype.apply = function (acts) {
    var self = this, doc = this.app.doc, app = this.app, done = 0, skipped = [], lastNew = null;
    var byRef = function (ref) { return self.model.items.filter(function (it) { return (it.ref || "").toLowerCase() === String(ref || "").toLowerCase(); })[0]; };
    var padKey = function (spec) {
      var s = String(spec || ""), dot = s.lastIndexOf("."); if (dot < 1) return null;
      var refp = s.slice(0, dot), pin = s.slice(dot + 1), it = refp === "new" ? (lastNew && self.item(lastNew)) : byRef(refp);
      if (!it) return null;
      var q = it.fp.pads.filter(function (p) { return p.n === pin; })[0] || it.fp.pads.filter(function (p) { return (p.name || "").toLowerCase() === pin.toLowerCase(); })[0];
      if (!q && it.kind === "part") { var k = it.id + ":" + pin; if (Object.keys(it.keyOf).some(function (n) { return it.keyOf[n] === k; })) return k; }
      return q ? it.keyOf[q.n] : null;
    };
    var num = function (v, lo, hi, d) { v = +v; return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
    var route = false;
    app.history.push(doc);
    acts.forEach(function (a) {
      var pcb = doc.pcb, it;
      try {
        switch (a.do) {
          case "shape": if (X.applyPreset(doc, a.preset)) done++; else skipped.push(a); break;
          case "size": if (!pcb.shape || pcb.shape.kind === "rect") { pcb.w = r3(num(a.w, 10, 400, pcb.w)); pcb.h = r3(num(a.h, 10, 400, pcb.h)); if (a.r != null) pcb.r = num(a.r, 0, 20, 3); done++; } else skipped.push(a); break;
          case "place": it = byRef(a.ref); if (it) { var pl = X.placeOf(doc, it); pl.x = r3(num(a.x, -20, 420, pl.x)); pl.y = r3(num(a.y, -20, 420, pl.y)); if (a.rot != null) pl.rot = ((Math.round(+a.rot) % 4) + 4) % 4; if (a.side === "bottom" || a.side === "top") { if (a.side === "bottom") pl.side = "bottom"; else delete pl.side; } done++; } else skipped.push(a); break;
          case "package": it = byRef(a.ref); if (it && it.kind === "part" && FP.get(a.fp)) { doc.pcb.place[it.id].fp = a.fp; done++; } else skipped.push(a); break;
          case "add": if (FP.get(a.fp)) { var nid = X.uid("f"); pcb.items.push({ id: nid, kind: "fp", fp: a.fp, x: r3(num(a.x, 0, 400, pcb.w / 2)), y: r3(num(a.y, 0, 400, pcb.h / 2)), rot: ((Math.round(+a.rot || 0) % 4) + 4) % 4, ref: a.ref ? String(a.ref).replace(/[^A-Za-z0-9_]/g, "").slice(0, 8) : undefined, value: a.value ? String(a.value).slice(0, 40) : undefined }); lastNew = nid; self.remodel(); done++; } else skipped.push(a); break;
          case "hole": pcb.items.push({ id: X.uid("h"), kind: "hole", x: r3(num(a.x, 0, 400, 5)), y: r3(num(a.y, 0, 400, 5)), d: r3(num(a.d, 0.5, 20, 3.2)), plated: !!a.plated }); done++; break;
          case "holes":
            if (!pcb.shape || pcb.shape.kind === "rect") pcb.holes = true;
            else { var ol = X.outline(pcb), xs = ol.map(function (p) { return p[0]; }), ys = ol.map(function (p) { return p[1]; }), cx = pcb.w / 2, cy = pcb.h / 2; [[0.22, 0.22], [0.78, 0.22], [0.22, 0.78], [0.78, 0.78]].forEach(function (f) { var x = pcb.w * f[0], y = pcb.h * f[1]; if (X.onBoard(pcb, x, y)) pcb.items.push({ id: X.uid("h"), kind: "hole", x: r3(x), y: r3(y), d: 3.2, plated: false }); }); }
            done++; break;
          case "pattern": var pid = X.uid("a"); pcb.items.push({ id: pid, kind: "array", pattern: "grid", x: r3(num(a.x, 0, 400, pcb.w / 2)), y: r3(num(a.y, 0, 400, pcb.h / 2)), cols: Math.round(num(a.cols, 1, 60, 10)), rows: Math.round(num(a.rows, 1, 60, 6)), pitch: num(a.pitch, 1, 10, 2.54), d: 1.0, pad: 1.8, strip: /^(rows|cols)$/.test(a.strip) ? a.strip : "none" }); lastNew = pid; done++; break;
          case "link": self.remodel(); var ka = padKey(a.a), kb = padKey(a.b); if (ka && kb && ka !== kb) { pcb.links.push({ a: ka, b: kb }); done++; } else skipped.push(a); break;
          case "label": self.remodel(); var kl = padKey(a.pad), nm = String(a.net || "").replace(/[^A-Za-z0-9_+\-./]/g, "").slice(0, 24); if (kl && nm) { pcb.labels[kl] = nm; done++; } else skipped.push(a); break;
          case "pour": pcb.items = pcb.items.filter(function (z) { return !(z.kind === "zone" && z.pts === "board" && z.layer === (a.layer === "top" ? 0 : 1)); }); pcb.items.push({ id: X.uid("z"), kind: "zone", layer: a.layer === "top" ? 0 : 1, net: String(a.net || "GND").slice(0, 24), pts: "board" }); done++; break;
          case "text": pcb.items.push({ id: X.uid("t"), kind: "text", x: r3(num(a.x, 0, 400, pcb.w / 2)), y: r3(num(a.y, 0, 400, 3)), s: String(a.s || "").replace(/[^ -~]|[<>]/g, "").slice(0, 40), size: num(a.size, 0.6, 10, 1.5), layer: /^(silk|bsilk|top|bottom)$/.test(a.layer) ? a.layer : "silk" }); done++; break;
          case "rules": pcb.rules = pcb.rules || {}; ["track", "power", "clear", "via", "viaDrill", "edge", "grid"].forEach(function (k) { if (a[k] != null && isFinite(+a[k])) pcb.rules[k] = num(a[k], 0.1, 5, X.RULES[k]); }); done++; break;
          case "arrange": self.remodel(); X.autoplace(doc, self.model); done++; break;
          case "mask": var mk = MASKS.filter(function (x) { return x[1].toLowerCase() === String(a.color || "").toLowerCase() || x[0] === a.color; })[0]; if (mk) { pcb.mask = mk[0]; done++; } break;
          case "route": route = true; break;
          default: skipped.push(a);
        }
      } catch (e) { skipped.push(a); }
    });
    this.remodel();
    if (route) X.route(doc, this.model);
    this.ver++; this.issues = null;
    app.changed(); this.fit(true); this.render(); this.autoCheck();
    if (acts.some(function (a) { return a.do === "mask"; })) this.setLook("real");
    app.toast("Applied " + (done + (route ? 1 : 0)) + " change" + (done + (route ? 1 : 0) === 1 ? "" : "s") + (skipped.length ? "; skipped " + skipped.length + " that didn't fit this board" : "") + ".");
  };

  /* ===================================================== THE LIBRARY DRAWER */

  PcbStudio.prototype.drawer = function (box, tab) {
    var self = this, app = this.app, q = (this.libQ || "").toLowerCase();
    if (tab === "layers") { box.innerHTML = '<div class="px-dl">' + (app.doc.pcb && this.model ? this.itemList() : '<p class="hint">No board yet.</p>') + '</div>'; box.querySelectorAll("[data-pick]").forEach(function (b) { b.addEventListener("click", function () { var id = b.getAttribute("data-pick"); if (self.item(id)) self.pickPart(id); else self.select({ kind: "item", id: id }); }); }); return true; }
    var mine = Object.keys(L.CUSTOM || {}).map(function (t) { return L.CUSTOM[t]; });
    /* forgiving about spaces and hyphens: "usb c", "usbc" and "USB-C" all find USB-C */
    var squash = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9µ]+/g, ""); }, words = q.split(/[\s\-_]+/).filter(Boolean), sq = squash(q);
    var match = function (s) { if (!q) return true; var h = String(s).toLowerCase(); return squash(h).indexOf(sq) >= 0 || words.every(function (w) { return h.indexOf(w) >= 0; }); };
    var h = '<label class="drawer-search"><span class="sr">Find a footprint</span><input type="search" id="px-q" placeholder="Find — USB-C, SOIC-8, 0805, JST…" value="' + esc(this.libQ || "") + '"></label>';
    h += '<div class="px-lib-top"><button type="button" class="primary" data-lib="make">＋ Design a part</button><button type="button" data-lib="import" title="Open a KiCad footprint (.kicad_mod)">Import .kicad_mod</button></div>';
    var mineHit = mine.filter(function (c) { return match((c.data.name || "") + " " + (c.data.value || "") + " " + (c.data.cat || "")); });
    if (mineHit.length) h += '<h3>Parts you made</h3><div class="px-lib">' + mineHit.map(function (c) { return '<button type="button" class="px-libi" data-mine="' + esc(c.type) + '" title="' + esc((c.data.desc || c.data.name) + " — click to place, it joins the bench too") + '">' + X.fpSvg(c.fp, null, { body: true }) + '<span>' + esc(c.data.name) + '</span></button>'; }).join("") + '</div>';
    var parts = FP.PARTS.filter(function (p) { return match(p.name + " " + p.value + " " + p.cat + " " + p.fp); });
    if (parts.length) {
      var cats = {};
      parts.forEach(function (p) { (cats[p.cat] = cats[p.cat] || []).push(p); });
      h += '<h3>Real components</h3>' + Object.keys(cats).map(function (c) { return '<h4>' + esc(c) + '</h4><div class="px-lib">' + cats[c].map(function (p) { var f = FP.get(p.fp); return '<button type="button" class="px-libi" data-part="' + esc(p.id) + '" title="' + esc(p.name + " · " + p.fp + (p.bench ? " — simulates on the bench too" : " — board only")) + '">' + (f ? X.fpSvg(f) : "") + '<span>' + esc(p.name) + '</span>' + (p.bench ? '<em class="sim" title="Works in the simulator">sim</em>' : "") + '</button>'; }).join("") + '</div>'; }).join("");
    }
    FP.CATS.forEach(function (c) {
      var list = FP.LIB.filter(function (f) { return f.cat === c && match(f.id + " " + f.name + " " + f.desc + " " + c); });
      if (!list.length) return;
      h += '<h3>' + esc(c) + ' <small>' + list.length + '</small></h3><div class="px-lib">' + list.map(function (f) { return '<button type="button" class="px-libi" data-fp="' + esc(f.id) + '" title="' + esc(f.name + " — " + f.desc) + '">' + X.fpSvg(f) + '<span>' + esc(f.id) + '</span></button>'; }).join("") + '</div>';
    });
    if (q && !/<button type="button" class="px-libi"/.test(h)) { var g = FP.fromText(q); h += g ? '<h3>Made for you</h3><div class="px-lib"><button type="button" class="px-libi" data-gen="1" title="' + esc(g.name) + '">' + X.fpSvg(g) + '<span>' + esc(g.name) + '</span></button></div>' : '<p class="hint">Nothing matches “' + esc(q) + '”. Try a package name — SOIC-14, QFN-32 5x5, 2x8 header, screw terminal 3…</p>'; this.gen = g; }
    box.innerHTML = '<div class="px-dl">' + h + '</div>';
    var inp = box.querySelector("#px-q");
    inp.addEventListener("input", function () { self.libQ = inp.value; self.drawer(box, tab); var i2 = box.querySelector("#px-q"); i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); });
    box.querySelectorAll("[data-fp]").forEach(function (b) { b.addEventListener("click", function () { self.startPlacing({ fp: b.getAttribute("data-fp") }); }); });
    box.querySelectorAll("[data-part]").forEach(function (b) { b.addEventListener("click", function () { self.startPlacing({ part: FP.part(b.getAttribute("data-part")) }); }); });
    box.querySelectorAll("[data-mine]").forEach(function (b) { b.addEventListener("click", function () { self.startPlacing({ mine: b.getAttribute("data-mine") }); }); });
    box.querySelectorAll("[data-gen]").forEach(function (b) { b.addEventListener("click", function () { self.startPlacing({ gen: self.gen }); }); });
    box.querySelectorAll("[data-lib]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-lib");
        if (k === "make") { if (L.PartMaker) L.PartMaker.open(app); else app.toast("The part designer didn't load."); }
        if (k === "import") self.importKicad();
      });
    });
    return true;
  };
  PcbStudio.prototype.importKicad = function () {
    var self = this, inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".kicad_mod,.txt";
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try { var fp = FP.fromKicad(String(rd.result)); if (L.PartMaker) L.PartMaker.open(self.app, { fp: fp, name: fp.name, value: fp.name }); else self.startPlacing({ gen: fp }); }
        catch (e) { self.app.toast(e.message || "That file couldn't be read as a KiCad footprint."); }
      };
      rd.readAsText(f);
    });
    inp.click();
  };
  PcbStudio.prototype.startPlacing = function (what) {
    var f = what.fp ? FP.get(what.fp) : what.part ? FP.get(what.part.fp) : what.mine ? L.CUSTOM[what.mine].fp : what.gen;
    if (!f) return;
    if (!this.app.doc.pcb) { this.app.doc.pcb = PCB.blank(); X.upgrade(this.app.doc.pcb); this.sync(); }
    this.placing = { what: what, fpData: f };
    this.hint("Click on the board to place " + (f.name || "it") + ". Esc to cancel.");
    if (this.tool !== "select") this.setTool("select");
  };
  PcbStudio.prototype.dropPlacing = function (s) {
    var pl = this.placing, app = this.app, doc = app.doc, self = this;
    this.placing = null; this.hint("");
    var w = pl.what;
    var bench = w.mine || (w.part && w.part.bench);
    if (bench) {
      /* a part that simulates: it goes on the bench too, and wears its package here */
      var type = w.mine || w.part.bench, bc = app.bench.cam || { x: 0, y: 0 };
      var p = app.addPart(type, bc.x + (Math.random() - 0.5) * 8 * L.P, bc.y + (Math.random() - 0.5) * 8 * L.P);
      if (!p) return;
      if (w.part && w.part.props) Object.keys(w.part.props).forEach(function (k) { p.props[k] = w.part.props[k]; });
      this.remodel();
      var place = doc.pcb.place[p.id] || (doc.pcb.place[p.id] = { rot: 0 });
      place.x = s[0]; place.y = s[1];
      if (w.part && w.part.fp) place.fp = w.part.fp;
      this.remodel();
      if (this.auto) X.route(doc, this.model);
      this.ver++; app.changed(); this.select({ kind: "item", id: p.id });
      app.toast((w.part ? w.part.name : L.PARTS[type].name) + " is on the board and on the bench, where it simulates. Wire it there, or connect its pads here.");
      return;
    }
    var it = { kind: "fp", fp: w.fp || (w.part && w.part.fp), x: s[0], y: s[1], rot: 0 };
    if (w.part) { it.value = w.part.value; if (w.part.pins) it.names = w.part.pins.slice(); }
    if (w.gen) {
      /* made from words: it becomes a part of yours, so it can be found again */
      var type2 = "cp_" + String(w.gen.id || "gen").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 24);
      if (!L.CUSTOM[type2]) FP.register(type2, { name: w.gen.name, value: w.gen.name, cat: "My parts", fp: FP.clone(w.gen), look: "ic" });
      it.fp = type2;
    }
    this.addItem(it);
  };

  /* ============================================================= EXPORT */

  PcbStudio.prototype.exportDialog = function () {
    var self = this, app = this.app, doc = app.doc;
    if (!doc.pcb || !this.model.items.length) { app.toast("There's nothing on the board yet."); return; }
    var rep = X.report(doc, this.model), drc = X.drc(doc, this.model), bad = drc.filter(function (q) { return q.level === "danger"; }).length;
    var d = document.createElement("dialog");
    d.className = "dlg ask st-export px-export";
    d.innerHTML = '<form method="dialog"><h2>Export the board</h2>' +
      '<p>' + rep.w.toFixed(1) + ' × ' + rep.h.toFixed(1) + ' mm' + (rep.shape !== "rect" ? " (" + rep.shape + ")" : "") + ', two layers, ' + rep.parts + ' parts, ' + rep.nets + ' nets. ' +
      (rep.open ? '<b class="bad">' + rep.open + ' connection' + (rep.open > 1 ? "s are" : " is") + ' not copper yet.</b> ' : '<b class="good">Every connection is routed.</b> ') + (bad ? '<b class="bad">' + bad + ' check' + (bad > 1 ? "s" : "") + ' must be fixed first.</b>' : "") + '</p>' +
      '<div class="st-export-list">' +
      '<button type="button" data-x="gerber" class="primary"><b>Gerber + drill files (.zip)</b><span>For JLCPCB, PCBWay, Aisler, OSH Park: copper, mask, paste, silk, outline, plated and bare holes, parts list, positions.</span></button>' +
      '<button type="button" data-x="kicad"><b>KiCad board (.kicad_pcb + footprints)</b><span>Open the whole design in KiCad 7 or 8 to carry on there.</span></button>' +
      '<button type="button" data-x="bom"><b>Item list (.csv)</b><span>Every part with its reference, value and package — what to buy.</span></button>' +
      '<button type="button" data-x="pnp"><b>Pick-and-place (.csv)</b><span>Where each part sits, for an assembly service.</span></button>' +
      '<button type="button" data-x="svg"><b>Picture of the board (.svg)</b><span>Print at 100% to check parts against it.</span></button>' +
      '<button type="button" data-x="png"><b>3-D render (.png)</b><span>The finished board with its parts, as shown in 3-D.</span></button>' +
      '<button type="button" data-x="parts"><b>Footprints and parts you made (.zip)</b><span>Every footprint on the board as .kicad_mod and SVG, and your own parts as Chalk part files.</span></button>' +
      '<button type="button" data-x="json"><b>The whole design (.json)</b><span>Board, parts, nets and your own parts in one file.</span></button>' +
      '</div><div class="ask-actions"><button value="no" type="submit">Close</button></div></form>';
    document.body.appendChild(d);
    d.addEventListener("close", function () { d.remove(); });
    d.querySelectorAll("[data-x]").forEach(function (b) {
      b.addEventListener("click", function () { self.exportAs(b.getAttribute("data-x")); });
    });
    d.showModal();
  };
  PcbStudio.prototype.exportAs = function (x) {
    var app = this.app, doc = app.doc, m = this.model, name = app.title || "board", S = L.Solid, safe = String(name).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "board";
    if (x === "gerber") S.download(name + " — gerbers.zip", S.zip(X.gerbers(doc, m, name)), "application/zip");
    else if (x === "kicad") S.download(name + " — KiCad.zip", S.zip([{ name: safe + "/" + safe + ".kicad_pcb", data: X.kicadPcb(doc, m, name) }].concat(X.footprintFiles(m).map(function (f) { return { name: safe + "/" + f.name, data: f.data }; })).concat([{ name: safe + "/README.txt", data: "Open " + safe + ".kicad_pcb in KiCad's PCB editor.\r\nThe footprints are in Chalk.pretty: add it as a footprint library to edit them.\r\nPress B in KiCad to refill the copper pours.\r\n" }])), "application/zip");
    else if (x === "bom") S.download(name + " — item list.csv", X.bomCsv(doc, m), "text/csv");
    else if (x === "pnp") S.download(name + " — positions.csv", X.pnpCsv(doc, m), "text/csv");
    else if (x === "svg") S.download(name + " — board.svg", X.svgFile(doc, m, { look: this.look === "real" || this.look === "3d" ? "real" : "layers", mask: doc.pcb.mask, finish: doc.pcb.finish }), "image/svg+xml");
    else if (x === "json") S.download(name + " — design.json", X.project(doc, m, name), "application/json");
    else if (x === "parts") {
      var files = [];
      X.footprintFiles(m).forEach(function (f) { files.push(f); var id = f.name.split("/")[1].replace(/\.kicad_mod$/, ""); var it = m.items.filter(function (i2) { return i2.fp.id.replace(/[^A-Za-z0-9_.\-]+/g, "_") === id; })[0]; if (it) files.push({ name: "pictures/" + id + ".svg", data: X.fpSvg(it.fp, null, { labels: "name" }).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ') }); });
      Object.keys(L.CUSTOM || {}).forEach(function (t) { var c = L.CUSTOM[t]; files.push({ name: "my parts/" + t + ".chalkpart.json", data: JSON.stringify({ format: "chalk-part", version: 1, type: t, data: c.data }, null, 1) }); });
      S.download(name + " — footprints and parts.zip", S.zip(files), "application/zip");
    } else if (x === "png") { var self = this; this.view3d.snapshot(function (blob) { if (blob) S.download(name + " — 3D.png", blob, "image/png"); else app.toast("The 3-D render couldn't be made in this browser."); }); return; }
    app.toast("Downloaded.");
  };

  /* ================================================================ 3-D
   * The finished board in an axonometric view you can turn: the board
   * drawn as its own picture, bodies standing on it, lit from above-left. */

  function Board3D(studio) { this.s = studio; this.cv = studio.canvas; this.yaw = -0.5; this.pitch = 0.9; this.zoomK = 1; this.tex = null; this.texVer = -1; this.bind(); }
  Board3D.prototype.bind = function () {
    var self = this, cv = this.cv, drag = null;
    cv.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY, yaw: self.yaw, pitch: self.pitch }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", function (e) { if (!drag) return; self.yaw = drag.yaw + (e.clientX - drag.x) * 0.008; self.pitch = L.clamp(drag.pitch + (e.clientY - drag.y) * 0.006, 0.05, 1.45); self.draw(); });
    cv.addEventListener("pointerup", function () { drag = null; });
    cv.addEventListener("wheel", function (e) { e.preventDefault(); self.zoom(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    cv.addEventListener("dblclick", function () { self.reset(); });
  };
  Board3D.prototype.reset = function () { this.yaw = -0.5; this.pitch = 0.9; this.zoomK = 1; this.draw(); };
  Board3D.prototype.zoom = function (f) { this.zoomK = L.clamp(this.zoomK * f, 0.3, 8); this.draw(); };
  Board3D.prototype.show = function () { this.on = true; this.texVer = -1; this.draw(); };
  Board3D.prototype.hide = function () { this.on = false; };
  Board3D.prototype.texture = function (cb) {
    var s = this.s, doc = s.app.doc, self = this;
    if (this.tex && this.texVer === s.ver && this.texMask === doc.pcb.mask) { cb(this.tex); return; }
    var pcb = doc.pcb, k = Math.max(4, Math.min(16, 2048 / Math.max(pcb.w, pcb.h)));
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + pcb.w + " " + pcb.h + '" width="' + Math.round(pcb.w * k) + '" height="' + Math.round(pcb.h * k) + '">' + X.svg(doc, s.model, { look: "real", vis: { top: true, bottom: true, silk: true, zones: true }, uid: "t3", mask: pcb.mask, finish: pcb.finish }) + '</svg>';
    var img = new Image();
    img.onload = function () { self.tex = img; self.texVer = s.ver; self.texMask = pcb.mask; cb(img); };
    img.onerror = function () { cb(null); };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  };
  Board3D.prototype.draw = function () {
    if (!this.on) return;
    var self = this, s = this.s, doc = s.app.doc, pcb = doc.pcb, cv = this.cv;
    if (!pcb) return;
    var r = cv.getBoundingClientRect(), dpr = Math.min(2, root.devicePixelRatio || 1);
    if (!r.width) return;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    this.texture(function (img) { self.paint(cv.getContext("2d"), cv.width, cv.height, img); });
  };
  Board3D.prototype.paint = function (g, W, H, img) {
    var s = this.s, doc = s.app.doc, pcb = doc.pcb, m = s.model, T = 1.6;
    var cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    var mx = pcb.w / 2, my = pcb.h / 2;
    var span = Math.max(pcb.w, pcb.h) * 1.25, sc = Math.min(W, H) / span * this.zoomK, ox = W / 2, oy = H / 2 + 6;
    var P = function (x, y, z) { var X1 = (x - mx) * cy - (y - my) * sy, Y1 = (x - mx) * sy + (y - my) * cy; return [ox + sc * X1, oy + sc * (Y1 * cp - z * sp)]; };
    var depth = function (x, y, z) { var Y1 = (x - mx) * sy + (y - my) * cy; return Y1 * sp + z * cp; };
    var plane = function (z) { var a = sc * cy, b = sc * cp * sy, c = -sc * sy, d = sc * cp * cy; var o = P(0, 0, z); g.setTransform(a, b, c, d, o[0], o[1]); };
    g.setTransform(1, 0, 0, 1, 0, 0);
    var bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "#1c2833"); bg.addColorStop(1, "#0b1117"); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    /* shadow */
    var ol = X.outline(pcb);
    g.save(); plane(-6); g.beginPath(); ol.forEach(function (p, i) { if (i) g.lineTo(p[0] + 3, p[1] + 3); else g.moveTo(p[0] + 3, p[1] + 3); }); g.closePath(); g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "rgba(0,0,0,.35)"; g.filter = "blur(" + Math.round(sc * 2) + "px)"; g.fill(); g.filter = "none"; g.restore();
    /* the edge of the board */
    var mask = pcb.mask || "#1f6b45", edges = [];
    var addEdges = function (pts, inner) {
      for (var i = 1; i < pts.length; i++) {
        var a = pts[i - 1], b = pts[i], nx = b[1] - a[1], ny = -(b[0] - a[0]);
        var area = 0; for (var k = 1; k < pts.length; k++) area += pts[k - 1][0] * pts[k][1] - pts[k][0] * pts[k - 1][1];
        if ((area > 0) === !!inner) { nx = -nx; ny = -ny; }
        var vx = nx * cy - ny * sy, vy = nx * sy + ny * cy;
        if (vy * sp > -1e-9) edges.push({ a: a, b: b, d: depth((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, T / 2), light: 0.55 + 0.35 * Math.max(0, (vx - vy) / (Math.hypot(vx, vy) || 1)) });
      }
    };
    addEdges(ol, false); X.cutouts(pcb).forEach(function (c) { addEdges(c, true); });
    edges.sort(function (p, q) { return p.d - q.d; });
    g.setTransform(1, 0, 0, 1, 0, 0);
    edges.forEach(function (e) {
      var p1 = P(e.a[0], e.a[1], 0), p2 = P(e.b[0], e.b[1], 0), p3 = P(e.b[0], e.b[1], T), p4 = P(e.a[0], e.a[1], T);
      g.beginPath(); g.moveTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.lineTo(p4[0], p4[1]); g.closePath();
      g.fillStyle = shade("#c9b98a", e.light * 0.85); g.fill();
      g.strokeStyle = shade(mask, 0.6); g.lineWidth = 1; g.beginPath(); g.moveTo(p3[0], p3[1]); g.lineTo(p4[0], p4[1]); g.stroke();
    });
    /* the top, with everything printed on it */
    g.save(); plane(T);
    g.beginPath(); ol.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath();
    X.cutouts(pcb).forEach(function (c) { c.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath(); });
    g.clip("evenodd");
    if (img) g.drawImage(img, 0, 0, pcb.w, pcb.h); else { g.fillStyle = mask; g.fillRect(0, 0, pcb.w, pcb.h); }
    var lg = g.createLinearGradient(0, 0, pcb.w, pcb.h); lg.addColorStop(0, "rgba(255,255,255,.10)"); lg.addColorStop(1, "rgba(0,0,0,.12)"); g.fillStyle = lg; g.fillRect(0, 0, pcb.w, pcb.h);
    g.restore();
    /* parts */
    var bodies = [];
    m.items.forEach(function (it) {
      var pl = X.placeOf(doc, it), b = it.fp.body;
      if (!pl || !b || pl.side === "bottom") return;
      var c = X.xf(pl, b.x, b.y), odd = (pl.rot || 0) % 2 === 1, w = odd ? b.h : b.w, h = odd ? b.w : b.h;
      bodies.push({ it: it, b: b, x: c[0], y: c[1], w: w, h: h, z: b.z, d: depth(c[0], c[1], T + b.z / 2), rot: pl.rot || 0 });
    });
    bodies.sort(function (p, q) { return p.d - q.d; });
    bodies.forEach(function (o) { drawBody(g, o, P, plane, T, cy, sy, sp); });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "rgba(220,230,240,.55)"; g.font = Math.round(12 * (root.devicePixelRatio || 1)) + "px system-ui,sans-serif";
    g.fillText("Drag to turn · wheel to zoom · double-click to reset", 12 * (root.devicePixelRatio || 1), H - 12 * (root.devicePixelRatio || 1));
  };
  function shade(hex, k) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex || "#888888") || [0, "88", "88", "88"];
    var f = function (x) { return Math.max(0, Math.min(255, Math.round(parseInt(x, 16) * k))); };
    return "rgb(" + f(m[1]) + "," + f(m[2]) + "," + f(m[3]) + ")";
  }
  var LOOK = { ic: "#1d1f22", bench: "#2b3a4a" };
  function drawBody(g, o, P, plane, T, cy, sy, sp) {
    var b = o.b, col = b.color || "#2b3a4a", z0 = T, z1 = T + Math.max(0.3, o.z);
    g.setTransform(1, 0, 0, 1, 0, 0);
    var quad = function (pts, fill, stroke) { g.beginPath(); pts.forEach(function (p, i) { if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath(); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 0.8; g.stroke(); } };
    var facing = function (nx, ny) { var vy = nx * sy + ny * cy; return vy * sp > 1e-6; };
    var lightOf = function (nx, ny) { var vx = nx * cy - ny * sy, vy = nx * sy + ny * cy; return 0.62 + 0.3 * Math.max(-0.4, (vx - vy) / (Math.hypot(vx, vy) || 1)); };
    if (b.shape === "cyl") {
      var R = o.w / 2, n = 24, ring = [];
      for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2; ring.push([o.x + R * Math.cos(a), o.y + R * Math.sin(a), Math.cos(a), Math.sin(a)]); }
      ring.map(function (p, i) { return { p: p, q: ring[(i + 1) % n] }; }).filter(function (s) { return facing((s.p[2] + s.q[2]) / 2, (s.p[3] + s.q[3]) / 2); }).forEach(function (s) {
        quad([P(s.p[0], s.p[1], z0), P(s.q[0], s.q[1], z0), P(s.q[0], s.q[1], z1), P(s.p[0], s.p[1], z1)], shade(col, lightOf((s.p[2] + s.q[2]) / 2, (s.p[3] + s.q[3]) / 2)));
      });
      quad(ring.map(function (p) { return P(p[0], p[1], z1); }), shade(col, 1.15), "rgba(0,0,0,.25)");
      if (b.look === "elcap") { g.strokeStyle = "rgba(220,220,230,.6)"; g.lineWidth = 1; var c0 = P(o.x - R * 0.5, o.y - R * 0.5, z1), c1 = P(o.x + R * 0.5, o.y + R * 0.5, z1); g.beginPath(); g.moveTo(c0[0], c0[1]); g.lineTo(c1[0], c1[1]); g.stroke(); }
      if (b.look === "led") { var top = P(o.x, o.y, z1); g.beginPath(); g.arc(top[0], top[1], Math.max(2, R * 0.6 * Math.abs(P(o.x + 1, o.y, z1)[0] - top[0] || 1)), 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255,.35)"; g.fill(); }
      return;
    }
    var x0 = o.x - o.w / 2, x1 = o.x + o.w / 2, y0 = o.y - o.h / 2, y1 = o.y + o.h / 2;
    var faces = [[[x0, y0], [x1, y0], 0, -1], [[x1, y0], [x1, y1], 1, 0], [[x1, y1], [x0, y1], 0, 1], [[x0, y1], [x0, y0], -1, 0]];
    faces.forEach(function (f) { if (!facing(f[2], f[3])) return; quad([P(f[0][0], f[0][1], z0), P(f[1][0], f[1][1], z0), P(f[1][0], f[1][1], z1), P(f[0][0], f[0][1], z1)], shade(col, lightOf(f[2], f[3]))); });
    quad([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], shade(col, 1.12), "rgba(0,0,0,.3)");
    /* what is printed on top */
    var label = o.it.value || o.it.ref || "";
    if (label && (b.look === "ic" || b.look === "esp32" || b.look === "bench" || b.look === "relay" || b.look === "to220") && o.w > 1.5) {
      plane(z1);
      g.save(); g.translate(o.x, o.y); if (o.rot % 2 === 1 && o.h > o.w) g.rotate(Math.PI / 2);
      var size = Math.min(Math.max(o.w, o.h) / Math.max(4, label.length) * 1.3, Math.min(o.w, o.h) * 0.42);
      g.font = "600 " + size + "px system-ui,sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = b.look === "esp32" ? "#3a3f45" : "rgba(235,240,245,.75)";
      g.fillText(String(label).slice(0, 14), 0, 0); g.restore();
      g.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
  Board3D.prototype.snapshot = function (cb) {
    var was = this.on, s = this.s, self = this;
    if (!was) { this.cv.hidden = false; this.on = true; }
    var cv = document.createElement("canvas"); cv.width = 1600; cv.height = 1100;
    this.texture(function (img) { self.paint(cv.getContext("2d"), cv.width, cv.height, img); if (!was) { self.on = false; self.cv.hidden = s.look !== "3d"; } if (cv.toBlob) cv.toBlob(cb, "image/png"); else cb(null); });
  };
})(typeof window !== "undefined" ? window : globalThis);
