/* Chalk Circuit Lab — the bench.
 *
 * The silicone mat everything sits on. Parts and wires are SVG, so they
 * stay sharp on a projector at any zoom; everything that glows or moves —
 * light from LEDs, charge flowing down wires, sparks, smoke — is painted on
 * a canvas over the top with additive blending, which is what makes a lit
 * LED actually look lit.
 *
 * The bench never decides anything about the circuit. It draws the
 * document, turns pointer gestures into edits (move, wire, rotate, delete),
 * and every frame asks the simulator what each part and wire is doing.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var P = L.P;
  var NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  var DEFS = '<defs>' +
    '<pattern id="lab-mesh" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="#3a3d40"/><circle cx="2" cy="2" r="1.1" fill="#1a1c1e"/></pattern>' +
    '<pattern id="lab-mat" width="' + P + '" height="' + P + '" patternUnits="userSpaceOnUse"><path d="M' + P + ' 0H0V' + P + '" fill="none" style="stroke:var(--mat-line)" stroke-width="1"/></pattern>' +
    '<pattern id="lab-mat5" width="' + (P * 5) + '" height="' + (P * 5) + '" patternUnits="userSpaceOnUse"><path d="M' + (P * 5) + ' 0H0V' + (P * 5) + '" fill="none" style="stroke:var(--mat-line-strong)" stroke-width="1.4"/></pattern>' +
    '</defs>';

  function Bench(host, app) {
    this.host = host;
    this.app = app;
    this.cam = { x: 0, y: 0, z: 1 };
    this.sel = null;              /* {kind: "part"|"wire", id} */
    this.hoverPin = null;
    this.draft = null;            /* a wire being drawn */
    this.parts = {};              /* id -> <g> */
    this.wires = {};              /* id -> {g, pts, len} */
    this.particles = [];
    this.ripples = [];
    this.flowPhase = {};
    this.showFlow = "conventional";   /* or "electrons", or "off" */
    this.showVolts = false;
    this.room = 1;
    this.build();
  }
  L.Bench = Bench;

  /* ---------------------------------------------------------------- DOM */

  Bench.prototype.build = function () {
    var h = this.host;
    h.innerHTML = "";
    h.classList.add("bench");
    this.svg = el("svg", { "class": "bench-svg", role: "application", "aria-label": "Circuit bench. Drag parts in from the drawer; drag from one leg to another to wire them." }, h);
    this.svg.innerHTML = DEFS;
    this.world = el("g", { "class": "bench-world" }, this.svg);
    this.matRect = el("rect", { x: -20000, y: -20000, width: 40000, height: 40000, fill: "url(#lab-mat)" }, this.world);
    el("rect", { x: -20000, y: -20000, width: 40000, height: 40000, fill: "url(#lab-mat5)" }, this.world);
    this.lBoards = el("g", {}, this.world);
    this.lParts = el("g", {}, this.world);
    this.lWires = el("g", {}, this.world);
    this.lUi = el("g", { "class": "bench-ui" }, this.world);
    this.canvas = document.createElement("canvas");
    this.canvas.className = "bench-fx";
    this.canvas.setAttribute("aria-hidden", "true");
    h.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.tip = document.createElement("div");
    this.tip.className = "bench-tip";
    this.tip.hidden = true;
    h.appendChild(this.tip);
    this.bubbles = document.createElement("div");
    this.bubbles.className = "bench-bubbles";
    h.appendChild(this.bubbles);
    this.bind();
    this.resize();
    var self = this;
    if (root.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(h);
    else root.addEventListener("resize", function () { self.resize(); });
  };

  Bench.prototype.resize = function () {
    var r = this.host.getBoundingClientRect(), dpr = root.devicePixelRatio || 1;
    this.W = r.width; this.H = r.height; this.dpr = dpr;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = r.width + "px"; this.canvas.style.height = r.height + "px";
    /* "fit on open" waits until the bench has its real size: on first load
     * the panels around it may not have settled yet */
    if (this.app.needFit && r.width > 80 && r.height > 80) { this.app.needFit = false; this.fit(); return; }
    this.applyCam();
  };

  Bench.prototype.applyCam = function () {
    var c = this.cam;
    this.world.setAttribute("transform", "translate(" + (this.W / 2 - c.x * c.z).toFixed(2) + " " + (this.H / 2 - c.y * c.z).toFixed(2) + ") scale(" + c.z.toFixed(4) + ")");
    this.host.style.setProperty("--zoom", c.z);
    if (this.app.doc) this.app.doc.view = { x: c.x, y: c.y, z: c.z };
  };
  Bench.prototype.toWorld = function (cx, cy) {
    var r = this.host.getBoundingClientRect(), c = this.cam;
    return { x: (cx - r.left - this.W / 2) / c.z + c.x, y: (cy - r.top - this.H / 2) / c.z + c.y };
  };
  Bench.prototype.toScreen = function (x, y) {
    var c = this.cam;
    return { x: (x - c.x) * c.z + this.W / 2, y: (y - c.y) * c.z + this.H / 2 };
  };
  Bench.prototype.zoomAt = function (factor, cx, cy) {
    var before = this.toWorld(cx, cy);
    this.cam.z = L.clamp(this.cam.z * factor, 0.15, 5);
    var after = this.toWorld(cx, cy);
    this.cam.x += before.x - after.x; this.cam.y += before.y - after.y;
    this.applyCam();
  };
  Bench.prototype.fit = function () {
    var b = L.boundsOf(this.app.doc);
    if (!b.w) { this.cam = { x: 0, y: 0, z: 1 }; this.applyCam(); return; }
    var pad = 80;
    this.cam.z = L.clamp(Math.min((this.W - pad) / b.w, (this.H - pad) / b.h), 0.2, 2.2);
    this.cam.x = b.x + b.w / 2; this.cam.y = b.y + b.h / 2;
    this.applyCam();
  };

  /* ------------------------------------------------------------- render */

  Bench.prototype.render = function () {
    var doc = this.app.doc, self = this;
    this.lBoards.innerHTML = ""; this.lParts.innerHTML = ""; this.lWires.innerHTML = "";
    this.parts = {}; this.wires = {};
    this.host.classList.toggle("kid", doc.mode === "kid");
    /* boards first, then the rest in document order */
    doc.parts.forEach(function (p) { if ((L.def(p) || {}).layer === "board") self.renderPart(p); });
    doc.parts.forEach(function (p) { if ((L.def(p) || {}).layer !== "board") self.renderPart(p); });
    this.indexPins();
    doc.wires.forEach(function (w) { self.renderWire(w); });
    if (this.app.workshop) this.app.workshop.renderJoints();
    this.renderSel();
  };

  Bench.prototype.renderPart = function (p) {
    var d = L.def(p);
    if (!d) return;
    var layer = d.layer === "board" ? this.lBoards : this.lParts;
    var old = this.parts[p.id], g = el("g", { "class": "part", "data-id": p.id });
    var props = L.propsOf(p);
    g.innerHTML = d.art(p, props);
    g.setAttribute("transform", this.partXform(p));
    /* hidden from the component list: faint, and out of the pointer's way */
    if (p.hide) { g.setAttribute("opacity", ".1"); g.setAttribute("pointer-events", "none"); }
    if (old && old.parentNode) old.parentNode.replaceChild(g, old); else layer.appendChild(g);
    var live = { root: g };
    g.querySelectorAll("[data-live]").forEach(function (n) { live[n.getAttribute("data-live")] = n; });
    g._live = live;
    this.parts[p.id] = g;
  };
  Bench.prototype.partXform = function (p) {
    return "translate(" + p.x + " " + p.y + ")" + (p.rot ? " rotate(" + (p.rot * 90) + ")" : "") + (p.flip ? " scale(-1 1)" : "");
  };
  Bench.prototype.movePart = function (p) { var g = this.parts[p.id]; if (g) g.setAttribute("transform", this.partXform(p)); };

  /* Where every pin is, so pointer hits and wire ends are a lookup. */
  Bench.prototype.indexPins = function () {
    var grid = {}, all = {};
    this.app.doc.parts.forEach(function (p) {
      L.pinsOf(p).forEach(function (q) {
        all[q.key] = q;
        var k = L.gridKey(q.x, q.y);
        (grid[k] = grid[k] || []).push(q);
      });
    });
    this.pinGrid = grid; this.pinAll = all;
  };
  Bench.prototype.pinAt = function (x, y, radius) {
    var best = null, bd = radius * radius;
    var gx = Math.round(x / P * 2), gy = Math.round(y / P * 2);
    for (var dx = -1; dx <= 1; dx++) for (var dy = -1; dy <= 1; dy++) {
      var list = this.pinGrid[(gx + dx) + "," + (gy + dy)];
      if (!list) continue;
      for (var i = 0; i < list.length; i++) {
        var q = list[i], d = (q.x - x) * (q.x - x) + (q.y - y) * (q.y - y);
        /* a part's own leg beats the hole it sits in */
        if (d < bd || (best && d === bd && best.hole && !q.hole)) { bd = d; best = q; }
      }
    }
    return best;
  };

  Bench.prototype.endPos = function (e) {
    if (e.ref && this.pinAll[e.ref]) return { x: this.pinAll[e.ref].x, y: this.pinAll[e.ref].y };
    return { x: e.x || 0, y: e.y || 0 };
  };

  /* A jumper wire: smooth through its bend points, with a little sag when
   * it is long, because real wires are not straight. */
  Bench.prototype.wirePoints = function (w) {
    var a = this.endPos(w.a), b = this.endPos(w.b), pts = [a];
    (w.pts || []).forEach(function (q) { pts.push({ x: q[0], y: q[1] }); });
    pts.push(b);
    return pts;
  };
  function curve(pts) {
    if (pts.length === 2) {
      var a = pts[0], b = pts[1], dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy);
      if (len < 3.5 * P) return [[a.x, a.y, a.x, a.y, b.x, b.y, b.x, b.y]];
      var sag = Math.min(46, len * 0.14);
      return [[a.x, a.y, a.x + dx / 3, a.y + dy / 3 + sag, a.x + 2 * dx / 3, a.y + 2 * dy / 3 + sag, b.x, b.y]];
    }
    var segs = [];
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      segs.push([p1.x, p1.y, p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y]);
    }
    return segs;
  }
  function pathOf(segs) {
    var d = "M" + segs[0][0].toFixed(1) + " " + segs[0][1].toFixed(1);
    segs.forEach(function (s) { d += "C" + s[2].toFixed(1) + " " + s[3].toFixed(1) + " " + s[4].toFixed(1) + " " + s[5].toFixed(1) + " " + s[6].toFixed(1) + " " + s[7].toFixed(1); });
    return d;
  }
  function sample(segs) {
    var out = [];
    segs.forEach(function (s, si) {
      for (var i = si ? 1 : 0; i <= 14; i++) {
        var t = i / 14, u = 1 - t;
        out.push([u * u * u * s[0] + 3 * u * u * t * s[2] + 3 * u * t * t * s[4] + t * t * t * s[6],
                  u * u * u * s[1] + 3 * u * u * t * s[3] + 3 * u * t * t * s[5] + t * t * t * s[7]]);
      }
    });
    var len = [0];
    for (var i = 1; i < out.length; i++) len.push(len[i - 1] + Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]));
    return { pts: out, len: len, total: len[len.length - 1] };
  }

  function shade(hex, k) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var f = function (c) { return Math.round(L.clamp(c * k, 0, 255)); };
    return "rgb(" + f(r) + "," + f(g) + "," + f(b) + ")";
  }

  /* A snipped wire: two halves with a gap and bare copper at the cut. */
  function cutPath(segs, t) {
    var smp = sample(segs), total = smp.total, gap = 9, a = t * total - gap / 2, b = t * total + gap / 2;
    var first = "", second = "", ca = null, cb = null;
    smp.pts.forEach(function (q, i) {
      var l = smp.len[i];
      if (l <= a) { first += (first ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); ca = q; }
      else if (l >= b) { if (!cb) cb = q; second += (second ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); }
    });
    return { d: first + " " + second, ends: [ca, cb] };
  }

  Bench.prototype.renderWire = function (w) {
    var kid = this.app.doc.mode === "kid";
    var pts = this.wirePoints(w), segs = curve(pts), d = pathOf(segs), cut = null;
    if (w.cut) { cut = cutPath(segs, w.cut); d = cut.d; }
    var old = this.wires[w.id] && this.wires[w.id].g;
    var g = el("g", { "class": "wire", "data-id": w.id });
    var col = w.color || "#e8c22a", width = kid ? 7 : 4.2;
    el("path", { d: d, stroke: "#000", "stroke-opacity": ".28", "stroke-width": width + 3, fill: "none", "stroke-linecap": "round", transform: "translate(2 4)" }, g);
    el("path", { d: d, stroke: shade(col, 0.55), "stroke-width": width + 1.8, fill: "none", "stroke-linecap": "round" }, g);
    var core = el("path", { d: d, stroke: col, "stroke-width": width, fill: "none", "stroke-linecap": "round", "class": "wire-core" }, g);
    el("path", { d: d, stroke: "#fff", "stroke-opacity": ".35", "stroke-width": width * 0.3, fill: "none", "stroke-linecap": "round", transform: "translate(-.6 -1)" }, g);
    [pts[0], pts[pts.length - 1]].forEach(function (q, i) {
      var nb = i === 0 ? pts[1] : pts[pts.length - 2], ang = Math.atan2(q.y - nb.y, q.x - nb.x) * 180 / Math.PI;
      if (kid) {
        /* crocodile clips */
        g.insertAdjacentHTML("beforeend", '<g transform="translate(' + q.x + ' ' + q.y + ') rotate(' + (ang + 180) + ')">' +
          '<path d="M0 -5L22 -9L26 -4L22 0L26 4L22 9L0 5z" fill="' + shade(col, 0.9) + '" stroke="' + shade(col, 0.5) + '" stroke-width="1.5"/>' +
          '<path d="M-2 -3l-6 -2M-2 3l-6 2" stroke="#9aa3ab" stroke-width="2.5" stroke-linecap="round"/></g>');
      } else {
        g.insertAdjacentHTML("beforeend", '<g transform="translate(' + q.x + ' ' + q.y + ') rotate(' + (ang + 180) + ')">' +
          '<rect x="2" y="-3.2" width="9" height="6.4" rx="1.2" fill="' + shade(col, 0.75) + '"/><rect x="-1.5" y="-1.4" width="5" height="2.8" fill="#c9ced3"/></g>');
      }
    });
    if (cut) cut.ends.forEach(function (q) { if (q) el("circle", { cx: q[0], cy: q[1], r: 2.6, fill: "#d98a4e", stroke: "#8a5a2a", "stroke-width": ".8" }, g); });
    el("path", { d: d, stroke: "transparent", "stroke-width": 14, fill: "none", "class": "wire-hit", "data-wire": w.id }, g);
    if (old && old.parentNode) old.parentNode.replaceChild(g, old); else this.lWires.appendChild(g);
    var s = sample(segs);
    this.wires[w.id] = { g: g, core: core, color: col, pts: s.pts, len: s.len, total: s.total };
  };

  Bench.prototype.refreshWiresOf = function (partIds) {
    var self = this, set = {};
    partIds.forEach(function (id) { set[id] = 1; });
    this.app.doc.wires.forEach(function (w) {
      var pa = w.a.ref && w.a.ref.split(":")[0], pb = w.b.ref && w.b.ref.split(":")[0];
      if (set[pa] || set[pb]) self.renderWire(w);
    });
  };

  /* ---------------------------------------------------------- selection */

  Bench.prototype.select = function (sel) {
    this.sel = sel;
    this.renderSel();
    this.app.onSelect(sel);
  };
  Bench.prototype.renderSel = function () {
    this.lUi.innerHTML = "";
    var s = this.sel;
    if (!s) return;
    if (s.kind === "part") {
      var p = this.app.partById(s.id);
      if (!p) { this.sel = null; return; }
      var b = L.boxOf(p);
      el("rect", { x: b.x - 6, y: b.y - 6, width: b.w + 12, height: b.h + 12, rx: 8, "class": "sel-box" }, this.lUi);
    } else if (s.kind === "wire") {
      var w = this.app.wireById(s.id), info = this.wires[s.id];
      if (!w || !info) { this.sel = null; return; }
      var self = this;
      el("path", { d: info.g.querySelector(".wire-core").getAttribute("d"), "class": "sel-wire" }, this.lUi);
      this.wirePoints(w).forEach(function (q, i, arr) {
        var end = i === 0 || i === arr.length - 1;
        el("circle", { cx: q.x, cy: q.y, r: end ? 7 : 6, "class": end ? "sel-end" : "sel-bend", "data-handle": i }, self.lUi);
      });
    }
  };

  /* Where a row of the component list is pointing: a soft outline, drawn
   * without disturbing the selection. */
  Bench.prototype.hoverMark = function (kind, id) {
    var old = this.svg.querySelector(".hover-mark");
    if (old) old.remove();
    if (!kind) return;
    if (kind === "part") {
      var p = this.app.partById(id);
      if (!p) return;
      var b = L.boxOf(p);
      el("rect", { x: b.x - 9, y: b.y - 9, width: b.w + 18, height: b.h + 18, rx: 10, "class": "hover-mark" }, this.world);
    } else if (this.wires[id]) {
      el("path", { d: this.wires[id].core.getAttribute("d"), "class": "hover-mark wire-mark" }, this.world);
    }
  };
  /* Bring a part into view if it is off the edge — without zooming, so
   * walking down the list doesn't throw the bench around. */
  Bench.prototype.reveal = function (id) {
    var p = this.app.partById(id);
    if (!p) return;
    var b = L.boxOf(p), a = this.toScreen(b.x, b.y), z = this.toScreen(b.x + b.w, b.y + b.h), m = 30;
    if (a.x >= m && a.y >= m && z.x <= this.W - m && z.y <= this.H - m) return;
    if (b.w * this.cam.z > this.W - 2 * m || b.h * this.cam.z > this.H - 2 * m) this.cam.z = L.clamp(Math.min((this.W - 4 * m) / b.w, (this.H - 4 * m) / b.h), 0.2, this.cam.z);
    this.cam.x = b.x + b.w / 2; this.cam.y = b.y + b.h / 2;
    this.applyCam();
  };
  Bench.prototype.revealWire = function (id) {
    var info = this.wires[id];
    if (!info || !info.pts.length) return;
    var mid = info.pts[info.pts.length >> 1];
    this.cam.x = mid[0]; this.cam.y = mid[1];
    this.applyCam();
  };

  /* ------------------------------------------------------------- input */

  Bench.prototype.bind = function () {
    var self = this, svg = this.svg, pointers = {}, pinch = null;

    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX) * 2 && !e.shiftKey) {
        /* a knob under the cursor turns instead of zooming */
        var pg = e.target.closest && e.target.closest(".part");
        var part = pg && self.app.partById(pg.getAttribute("data-id")), d = part && L.def(part);
        if (d && d.knob && !e.ctrlKey) {
          var pr = L.propsOf(part), v = L.clamp((pr[d.knob] || 0) - Math.sign(e.deltaY) * 0.04, 0, 1);
          self.app.setProp(part, d.knob, Math.round(v * 100) / 100, true);
          return;
        }
        self.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY);
      } else {
        self.cam.x += e.deltaX / self.cam.z; self.cam.y += e.deltaY / self.cam.z;
        self.applyCam();
      }
    }, { passive: false });

    svg.addEventListener("pointerdown", function (e) {
      svg.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        self.cancelGesture();
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        return;
      }
      self.down(e);
    });
    svg.addEventListener("pointermove", function (e) {
      if (pointers[e.pointerId]) pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (pinch && Object.keys(pointers).length === 2) {
        var ids = Object.keys(pointers), a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        self.zoomAt(d / pinch.d, cx, cy);
        self.cam.x -= (cx - pinch.cx) / self.cam.z; self.cam.y -= (cy - pinch.cy) / self.cam.z;
        self.applyCam();
        pinch = { d: d, cx: cx, cy: cy };
        return;
      }
      self.move(e);
    });
    var end = function (e) {
      delete pointers[e.pointerId];
      if (pinch) { if (!Object.keys(pointers).length) pinch = null; return; }
      self.up(e);
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", function (e) { delete pointers[e.pointerId]; pinch = null; self.cancelGesture(); });
    svg.addEventListener("dblclick", function (e) {
      var hit = e.target.closest(".wire-hit"), hb = e.target.getAttribute && e.target.getAttribute("data-handle");
      if (hb != null && self.sel && self.sel.kind === "wire") {
        var w = self.app.wireById(self.sel.id), i = +hb;
        if (i > 0 && i <= (w.pts || []).length) { self.app.edit(function () { w.pts.splice(i - 1, 1); }); }
        return;
      }
      if (hit) {
        var wp = self.toWorld(e.clientX, e.clientY), wire = self.app.wireById(hit.getAttribute("data-wire"));
        self.app.edit(function () { self.insertBend(wire, wp); });
      }
    });
    svg.addEventListener("pointerleave", function () { self.tip.hidden = true; self.hoverPin = null; });
    svg.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  };

  Bench.prototype.cancelGesture = function () {
    if (this.g && this.g.kind === "press") this.app.release(this.g.part);
    if (this.g && this.g.zoneKey) this.app.releaseKey(this.g.zoneKey);
    this.g = null;
    this.draft = null;
    this.drawDraft();
  };

  Bench.prototype.down = function (e) {
    var wp = this.toWorld(e.clientX, e.clientY), t = e.target;
    if (this.tool && this.app.workshop && this.app.workshop.down(e, wp)) { this.g = { kind: "tool" }; return; }
    var tapWiring = this.draft && this.draft.tap;
    var r = Math.max(7, 9 / this.cam.z);
    var pin = this.pinAt(wp.x, wp.y, r);
    this.downAt = { x: e.clientX, y: e.clientY, t: Date.now() };

    if (tapWiring) {
      if (pin && pin.key !== this.draft.from.key) { this.finishWire(pin); return; }
      if (!pin) { this.draft.bends.push([L.snap(wp.x), L.snap(wp.y)]); this.drawDraft(wp); return; }
    }
    /* handles on a selected wire */
    var handle = t.getAttribute && t.getAttribute("data-handle");
    if (handle != null && this.sel && this.sel.kind === "wire") {
      this.g = { kind: "handle", wire: this.sel.id, i: +handle, start: wp };
      return;
    }
    if (pin) {
      this.g = { kind: "wire", from: pin, start: wp };
      return;
    }
    var wh = t.closest && t.closest(".wire-hit");
    if (wh) {
      var wid = wh.getAttribute("data-wire");
      this.select({ kind: "wire", id: wid });
      this.g = { kind: "wirebody", wire: wid, start: wp, bend: null };
      return;
    }
    var pg = t.closest && t.closest(".part");
    if (pg) {
      var part = this.app.partById(pg.getAttribute("data-id")), d = L.def(part), zoneKey = null;
      if (d.zones) {
        /* parts with several buttons: which one is under the finger? */
        var lp = L.toLocal(part, wp.x, wp.y);
        d.zones.forEach(function (z) { if (Math.hypot(lp.x - z.x, lp.y - z.y) <= z.r) zoneKey = part.id + ":" + z.n; });
        if (zoneKey) this.app.pressKey(zoneKey);
      }
      if (d.press) this.app.press(part);
      this.g = { kind: "part", part: part, start: wp, ox: part.x, oy: part.y, pressed: !!d.press, zoneKey: zoneKey, carry: this.carried(part), moved: false };
      return;
    }
    this.g = { kind: "pan", sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y };
  };

  /* A breadboard carries whatever is plugged into it. */
  Bench.prototype.carried = function (part) {
    var d = L.def(part);
    if (!d || d.layer !== "board" || !/^breadboard/.test(part.type)) return [];
    var holes = {}, out = [];
    L.pinsOf(part).forEach(function (q) { holes[L.gridKey(q.x, q.y)] = 1; });
    this.app.doc.parts.forEach(function (p) {
      if (p === part) return;
      var pins = L.pinsOf(p);
      if (pins.some(function (q) { return holes[L.gridKey(q.x, q.y)]; })) out.push({ p: p, ox: p.x, oy: p.y });
    });
    return out;
  };

  Bench.prototype.move = function (e) {
    var wp = this.toWorld(e.clientX, e.clientY), g = this.g;
    if (this.tool && this.app.workshop) { this.app.workshop.move(e, wp); if (!g || g.kind === "tool") return; }
    if (!g) {
      if (this.draft && this.draft.tap) { this.drawDraft(wp); return; }
      this.hover(wp, e);
      return;
    }
    var dist = this.downAt ? Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) : 99;
    switch (g.kind) {
      case "pan":
        this.cam.x = g.cx - (e.clientX - g.sx) / this.cam.z; this.cam.y = g.cy - (e.clientY - g.sy) / this.cam.z;
        this.applyCam();
        break;
      case "part": {
        if (!g.moved && dist < 5) return;
        if (!g.moved && g.part.lock) {
          this.g = null;
          this.select({ kind: "part", id: g.part.id });
          this.app.toast("That part is locked in place. Unlock it in the component list to move it.");
          return;
        }
        if (!g.moved && this.app.workshop && this.app.workshop.stuck(g.part)) {
          this.g = null;
          this.app.toast("It's soldered in. Melt its joints with hot air, or suck each one with the solder sucker, to free it.");
          return;
        }
        if (!g.moved) {
          g.moved = true;
          if (g.pressed) { this.app.release(g.part); g.pressed = false; }
          if (g.zoneKey) { this.app.releaseKey(g.zoneKey); g.zoneKey = null; }
          this.app.beginEdit();
          this.select({ kind: "part", id: g.part.id });
        }
        var nx = L.snap(g.ox + wp.x - g.start.x), ny = L.snap(g.oy + wp.y - g.start.y);
        var dx = nx - g.part.x, dy = ny - g.part.y;
        if (!dx && !dy) return;
        g.part.x = nx; g.part.y = ny;
        this.movePart(g.part);
        var ids = [g.part.id], self = this;
        g.carry.forEach(function (c) { c.p.x += dx; c.p.y += dy; self.movePart(c.p); ids.push(c.p.id); });
        this.indexPins();
        this.refreshWiresOf(ids);
        this.renderSel();
        break;
      }
      case "wire":
        if (dist < 4) return;
        this.draft = { from: g.from, bends: [], tap: false };
        if (this.app.coach) this.app.coach.wireStart(g.from);
        this.drawDraft(wp);
        break;
      case "wirebody": {
        if (dist < 5) return;
        var w = this.app.wireById(g.wire);
        if (!g.bend) { this.app.beginEdit(); g.bend = this.insertBend(w, wp); }
        g.bend[0] = L.snap(wp.x); g.bend[1] = L.snap(wp.y);
        this.renderWire(w); this.renderSel();
        break;
      }
      case "handle": {
        var ww = this.app.wireById(g.wire), n = (ww.pts || []).length;
        if (!g.began) { this.app.beginEdit(); g.began = true; }
        if (g.i === 0 || g.i === n + 1) {
          var side = g.i === 0 ? "a" : "b";
          var pin = this.pinAt(wp.x, wp.y, Math.max(8, 12 / this.cam.z));
          ww[side] = pin ? { ref: pin.key, x: pin.x, y: pin.y } : { x: wp.x, y: wp.y };
          this.showSnap(pin);
        } else ww.pts[g.i - 1] = [L.snap(wp.x), L.snap(wp.y)];
        this.renderWire(ww); this.renderSel();
        break;
      }
    }
  };

  Bench.prototype.up = function (e) {
    var g = this.g, wp = this.toWorld(e.clientX, e.clientY);
    this.g = null;
    if (!g) return;
    if (g.kind === "tool") { if (this.app.workshop) this.app.workshop.up(e, wp); return; }
    var dist = this.downAt ? Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) : 99;
    switch (g.kind) {
      case "pan":
        if (dist < 4) { this.select(null); if (this.draft) { this.draft = null; this.drawDraft(); } }
        break;
      case "part":
        if (g.pressed) this.app.release(g.part);
        if (g.zoneKey) this.app.releaseKey(g.zoneKey);
        if (g.moved) { this.app.commitEdit(); return; }
        this.select({ kind: "part", id: g.part.id });
        this.app.clickPart(g.part, wp);
        break;
      case "wire": {
        if (!this.draft) {
          /* a tap on a leg: start wiring by clicks, which is easier on a touch screen */
          this.draft = { from: g.from, bends: [], tap: true };
          if (this.app.coach) this.app.coach.wireStart(g.from);
          this.drawDraft(wp);
          this.app.toast("Now tap the leg or hole to connect to. Tap empty space to bend the wire. Esc cancels.");
          return;
        }
        var pin = this.pinAt(wp.x, wp.y, Math.max(8, 12 / this.cam.z));
        if (pin && pin.key !== g.from.key) this.finishWire(pin);
        else { this.draft = null; this.drawDraft(); }
        break;
      }
      case "wirebody": if (g.bend) this.app.commitEdit(); break;
      case "handle": this.showSnap(null); if (g.began) this.app.commitEdit(); break;
    }
  };

  Bench.prototype.finishWire = function (pin) {
    var d = this.draft, self = this;
    /* the coach keeps what it knew when the wire was started, to tell a
     * new mistake from an old one */
    if (this.app.coach) this.app.coach.from = null;
    this.draft = null; this.drawDraft();
    var color = this.app.wireColor(d.from, pin);
    var w = { id: L.uid("w"), a: { ref: d.from.key, x: d.from.x, y: d.from.y }, b: { ref: pin.key, x: pin.x, y: pin.y }, color: color, pts: d.bends };
    this.app.edit(function () { self.app.doc.wires.push(w); });
    this.select({ kind: "wire", id: w.id });
    this.app.sound("snap");
    if (this.app.coach) this.app.coach.wired(d.from, pin);
  };

  Bench.prototype.insertBend = function (w, wp) {
    var pts = this.wirePoints(w), best = 0, bd = 1e9;
    for (var i = 0; i < pts.length - 1; i++) {
      var mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2, d = Math.hypot(mx - wp.x, my - wp.y);
      if (d < bd) { bd = d; best = i; }
    }
    w.pts = w.pts || [];
    var b = [L.snap(wp.x), L.snap(wp.y)];
    w.pts.splice(best, 0, b);
    return b;
  };

  Bench.prototype.drawDraft = function (wp) {
    var old = this.svg.querySelector(".draft");
    if (old) old.remove();
    var coach = this.app.coach;
    if (!this.draft && coach) coach.wireEnd();
    if (!this.draft || !wp) return;
    var pin = this.pinAt(wp.x, wp.y, Math.max(8, 12 / this.cam.z));
    var end = pin && pin.key !== this.draft.from.key ? pin : wp;
    var pts = [{ x: this.draft.from.x, y: this.draft.from.y }].concat(this.draft.bends.map(function (b) { return { x: b[0], y: b[1] }; }), [{ x: end.x, y: end.y }]);
    var g = el("g", { "class": "draft" }, this.lUi);
    el("path", { d: pathOf(curve(pts)), "class": "draft-wire" }, g);
    el("circle", { cx: this.draft.from.x, cy: this.draft.from.y, r: 6, "class": "draft-dot" }, g);
    if (pin) el("circle", { cx: pin.x, cy: pin.y, r: 9, "class": "snap-ring" }, g);
    /* the coach rings the legs worth aiming for, and says what it thinks
     * of the one the wire is hovering over */
    if (coach) { coach.drawTargets(g); coach.wireOver(pin && pin.key !== this.draft.from.key ? pin : null); }
    this.showStrip(pin);
  };
  Bench.prototype.showSnap = function (pin) {
    var old = this.lUi.querySelector(".snap-ring.solo");
    if (old) old.remove();
    if (pin) el("circle", { cx: pin.x, cy: pin.y, r: 9, "class": "snap-ring solo" }, this.lUi);
  };

  /* Hovering a hole lights up every hole joined to it — the single most
   * useful thing for understanding a breadboard. */
  Bench.prototype.showStrip = function (pin) {
    var old = this.lUi.querySelector(".strip");
    if (old) old.remove();
    if (!pin || !pin.hole) return;
    var part = this.app.partById(pin.part), d = L.def(part), g = el("g", { "class": "strip" }, this.lUi);
    var bus = (d.buses || []).filter(function (b) { return b.indexOf(pin.name) >= 0; })[0] || [pin.name];
    var self = this, pts = bus.map(function (nm) { return self.pinAll[part.id + ":" + nm]; }).filter(Boolean);
    pts.forEach(function (q) { el("rect", { x: q.x - 5, y: q.y - 5, width: 10, height: 10, rx: 2, "class": "strip-hole" }, g); });
  };

  Bench.prototype.hover = function (wp, e) {
    var pin = this.pinAt(wp.x, wp.y, Math.max(7, 9 / this.cam.z));
    var key = pin ? pin.key : null;
    if (key !== (this.hoverPin && this.hoverPin.key)) { this.hoverPin = pin; this.showStrip(pin); }
    this.svg.style.cursor = pin ? "crosshair" : "";
    if (!pin) { this.tip.hidden = true; return; }
    this.tipFor(pin, e);
  };
  Bench.prototype.tipFor = function (pin, e) {
    var part = this.app.partById(pin.part), d = L.def(part);
    var label = pin.hole ? holeLabel(pin.name) : (d.name + " · " + pin.label);
    var v = this.app.running ? this.app.sim.pinVolts(pin.key) : null;
    var html = "<strong>" + L.esc(label) + "</strong>";
    if (v != null) {
      html += '<span class="tip-v">' + v.toFixed(2) + " V</span>";
      if (!pin.hole) { var i = this.app.sim.pinCurrent(pin.key); if (Math.abs(i) > 1e-6) html += '<span class="tip-i">' + L.si(Math.abs(i), "A") + (i > 0 ? " in" : " out") + '</span>'; }
    }
    this.tip.innerHTML = html;
    var r = this.host.getBoundingClientRect();
    this.tip.style.transform = "translate(" + Math.min(r.width - 180, e.clientX - r.left + 14) + "px," + (e.clientY - r.top + 16) + "px)";
    this.tip.hidden = false;
  };
  function holeLabel(n) {
    var m = /^(tp|tn|bp|bn)(\d+)$/.exec(n);
    if (m) return { tp: "Top + rail", tn: "Top − rail", bp: "Bottom + rail", bn: "Bottom − rail" }[m[1]];
    return "Hole " + n.charAt(0) + n.slice(1) + " · column " + n.slice(1);
  }

  /* ------------------------------------------------------------- frame */

  Bench.prototype.frame = function (sim, dt, running) {
    var ctx = this.ctx, self = this, dpr = this.dpr, c = this.cam;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.room < 1) {
      ctx.fillStyle = "rgba(4,8,14," + ((1 - this.room) * 0.78).toFixed(2) + ")";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    ctx.setTransform(dpr * c.z, 0, 0, dpr * c.z, dpr * (this.W / 2 - c.x * c.z), dpr * (this.H / 2 - c.y * c.z));
    var doc = this.app.doc, kid = doc.mode === "kid";

    /* parts: their own moving bits, then their light */
    ctx.globalCompositeOperation = "lighter";
    doc.parts.forEach(function (p) {
      var d = L.def(p), g = self.parts[p.id];
      if (!d || !g) return;
      var st = (running && sim.state[p.id]) || {}, pr = L.propsOf(p);
      if (d.live) d.live(g._live, st, pr);
      if (running && d.glow) {
        var lights = d.glow(st, pr);
        (lights || []).forEach(function (l) {
          var w = L.xform(l.x, l.y, p.rot, p.flip), x = p.x + w[0], y = p.y + w[1];
          var a = l.a * (self.room < 1 ? 1.25 : 1);
          var grad = ctx.createRadialGradient(x, y, 0, x, y, l.r);
          grad.addColorStop(0, rgba(l.c, Math.min(1, a)));
          grad.addColorStop(0.25, rgba(l.c, Math.min(1, a * 0.45)));
          grad.addColorStop(1, rgba(l.c, 0));
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(x, y, l.r, 0, Math.PI * 2); ctx.fill();
        });
      }
    });

    /* current: a glow down each wire, and charges moving along it */
    if (running && this.showFlow !== "off") {
      var dir = this.showFlow === "electrons" ? -1 : 1;
      var dotCol = this.showFlow === "electrons" ? "#7fd4ff" : "#ffd36b";
      doc.wires.forEach(function (w) {
        var info = self.wires[w.id], i = sim.wireI[w.id] || 0;
        if (!info || Math.abs(i) < 2e-5) return;
        var lvl = Math.log10(1 + Math.abs(i) / 1e-4);           /* 0.1 mA -> 0.3, 20 mA -> 2.3 */
        var ph = (self.flowPhase[w.id] || 0) + dir * Math.sign(i) * (18 + 26 * lvl) * dt;
        self.flowPhase[w.id] = ph;
        ctx.globalAlpha = Math.min(0.5, 0.08 + lvl * 0.12);
        ctx.strokeStyle = dotCol; ctx.lineWidth = (kid ? 12 : 8); ctx.lineCap = "round";
        ctx.beginPath();
        info.pts.forEach(function (q, k) { if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
        ctx.stroke();
        ctx.globalAlpha = 1;
        dots(ctx, info, ph, kid ? 22 : 15, (kid ? 3.6 : 2.1) + Math.min(1.6, lvl * 0.5), dotCol, kid);
      });
      /* inside the breadboard strips, fainter */
      (sim.busFlows || []).forEach(function (f) {
        var a = self.pinAll[f.a], b = self.pinAll[f.b];
        if (!a || !b || Math.abs(f.i) < 2e-5) return;
        var key = f.a + ">" + f.b, lvl = Math.log10(1 + Math.abs(f.i) / 1e-4);
        var ph = (self.flowPhase[key] || 0) + dir * Math.sign(f.i) * (18 + 26 * lvl) * dt;
        self.flowPhase[key] = ph;
        var len = Math.hypot(b.x - a.x, b.y - a.y);
        ctx.globalAlpha = 0.55;
        dots(ctx, { pts: [[a.x, a.y], [b.x, b.y]], len: [0, len], total: len }, ph, 15, 1.7, dotCol, false);
        ctx.globalAlpha = 1;
      });
    }

    /* voltage colours: what potential each wire sits at */
    if (running && this.showVolts) {
      ctx.globalCompositeOperation = "source-over";
      var vmax = 5;
      doc.wires.forEach(function (w) {
        var key = w.a.ref || w.b.ref, v = key ? sim.pinVolts(key) : null;
        if (v == null) return;
        var info = self.wires[w.id]; if (!info) return;
        vmax = Math.max(vmax, Math.abs(v));
        ctx.strokeStyle = voltColor(v / 9);
        ctx.globalAlpha = 0.75; ctx.lineWidth = kid ? 5 : 3.2;
        ctx.beginPath();
        info.pts.forEach(function (q, k) { if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
        ctx.stroke(); ctx.globalAlpha = 1;
      });
    }

    this.effects(sim, dt, running);
    ctx.globalCompositeOperation = "source-over";
    this.drawParticles(dt);
    this.drawRipples(dt);
    this.drawRadio(dt);
    if (this.app.workshop) this.app.workshop.frame(ctx, dt);
  };

  function dots(ctx, info, phase, gap, r, col, kid) {
    var total = info.total;
    if (total < 2) return;
    var off = ((phase % gap) + gap) % gap, k = 1;
    ctx.fillStyle = col;
    for (var s = off; s < total; s += gap) {
      while (k < info.len.length - 1 && info.len[k] < s) k++;
      var l0 = info.len[k - 1], l1 = info.len[k], t = l1 > l0 ? (s - l0) / (l1 - l0) : 0;
      var x = info.pts[k - 1][0] + (info.pts[k][0] - info.pts[k - 1][0]) * t;
      var y = info.pts[k - 1][1] + (info.pts[k][1] - info.pts[k - 1][1]) * t;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      if (kid) {
        /* little faces: kid-mode electricity is friendly */
        ctx.save(); ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = "#5a3a00";
        ctx.beginPath(); ctx.arc(x - 1.2, y - 0.8, 0.55, 0, 7); ctx.arc(x + 1.2, y - 0.8, 0.55, 0, 7); ctx.fill();
        ctx.strokeStyle = "#5a3a00"; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.arc(x, y + 0.2, 1.3, 0.3, Math.PI - 0.3); ctx.stroke();
        ctx.restore(); ctx.fillStyle = col;
      }
    }
  }
  function voltColor(f) {
    f = L.clamp(f, -0.2, 1);
    if (f < 0) return "rgb(160,90,255)";
    var r = Math.round(60 + 195 * f), g = Math.round(150 - 60 * Math.abs(f - 0.5) * 2), b = Math.round(255 - 215 * f);
    return "rgb(" + r + "," + g + "," + b + ")";
  }
  var COLCACHE = {};
  function rgba(c, a) {
    var rgb = COLCACHE[c];
    if (!rgb) {
      if (c.charAt(0) === "#") { var n = parseInt(c.slice(1), 16); rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
      else { var m = /(\d+)\D+(\d+)\D+(\d+)/.exec(c); rgb = m ? [+m[1], +m[2], +m[3]] : [255, 255, 255]; }
      COLCACHE[c] = rgb;
    }
    return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a.toFixed(3) + ")";
  }

  /* Smoke from cooked parts, sparks from shorts and coil kicks. */
  Bench.prototype.effects = function (sim, dt, running) {
    var self = this;
    if (!running) return;
    (sim.events || []).splice(0).forEach(function (ev) {
      var p = self.app.partById(ev.part); if (!p) return;
      var b = L.boxOf(p), x = b.x + b.w / 2, y = b.y + b.h / 2;
      if (ev.kind === "spark" || ev.kind === "pop" || ev.kind === "burn") {
        for (var i = 0; i < (ev.kind === "spark" ? 26 : 16); i++) {
          var a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 180;
          self.particles.push({ k: "spark", x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 60, life: 0.4 + Math.random() * 0.4, age: 0 });
        }
        self.app.sound(ev.kind === "spark" ? "spark" : "pop");
      }
      if (ev.kind === "click") self.app.sound("click");
      if (ev.kind === "radio" || ev.kind === "bt" || ev.kind === "fob") self.radio(p, ev);
    });
    this.smokeT = (this.smokeT || 0) + dt;
    if (this.smokeT > 0.09) {
      this.smokeT = 0;
      this.app.doc.parts.forEach(function (p) {
        var st = sim.state[p.id];
        if (!st) return;
        var hot = st.burnt ? 0.6 : st.hot > 0.4 ? st.hot : st.heat > 0.9 ? 0.4 : 0;
        if (!hot || Math.random() > hot) return;
        var b = L.boxOf(p);
        self.particles.push({ k: "smoke", x: b.x + b.w * (0.3 + Math.random() * 0.4), y: b.y + b.h * 0.3, vx: (Math.random() - 0.5) * 14, vy: -26 - Math.random() * 20, life: 2.2, age: 0, r: 6 });
      });
    }
  };
  Bench.prototype.drawParticles = function (dt) {
    var ctx = this.ctx;
    this.particles = this.particles.filter(function (q) {
      q.age += dt;
      if (q.age > q.life) return false;
      q.x += q.vx * dt; q.y += q.vy * dt;
      var f = 1 - q.age / q.life;
      if (q.k === "spark") {
        q.vy += 400 * dt;
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(255," + Math.round(180 + 70 * f) + ",90," + f.toFixed(2) + ")";
        ctx.beginPath(); ctx.arc(q.x, q.y, 1.6 + f * 1.4, 0, 7); ctx.fill();
      } else {
        q.r += 14 * dt;
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(150,150,150," + (0.35 * f).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill();
      }
      return true;
    });
    ctx.globalCompositeOperation = "source-over";
  };

  /* Radio: rings from the sender's antenna, and a packet that flies to each
   * receiver with what it carries. A lost packet fades halfway with a ✕. */
  Bench.prototype.radio = function (part, ev) {
    var a = L.antennaOf(part), self = this, data = ev.data || {};
    var color = ev.kind === "bt" ? "#7fb8ff" : ev.kind === "fob" ? "#ff8a7a" : "#ffe9a0";
    this.waves = this.waves || []; this.packets = this.packets || [];
    this.waves.push({ x: a.x, y: a.y, age: 0, c: color });
    if (this.waves.length > 30) this.waves.shift();
    var label = String(data.text || "").replace(/\n/g, "⏎").slice(0, 16);
    var targets = [];
    if (ev.kind === "radio") {
      (data.to || []).forEach(function (id) { targets.push({ id: id, lost: false }); });
      (data.lost || []).forEach(function (id) { targets.push({ id: id, lost: true }); });
    } else if (ev.kind === "fob") {
      this.app.doc.parts.forEach(function (q) { if (q.type === "rf_rx") targets.push({ id: q.id, lost: false }); });
      var st = this.app.sim.state[part.id] || {};
      label = Object.keys(st.press || {}).join("");
    } else if (ev.kind === "bt") {
      /* to or from the phone, which lives off the top of the bench */
      var phone = { x: a.x + 260, y: a.y - 260 };
      this.packets.push(data.up ? { x0: a.x, y0: a.y, x1: phone.x, y1: phone.y, age: 0, dur: 0.6, label: label, c: color, phone: true }
                                : { x0: phone.x, y0: phone.y, x1: a.x, y1: a.y, age: 0, dur: 0.6, label: label, c: color, phone: true });
    }
    targets.forEach(function (t) {
      var q = self.app.partById(t.id); if (!q) return;
      var b = L.antennaOf(q);
      self.packets.push({ x0: a.x, y0: a.y, x1: b.x, y1: b.y, age: 0, dur: 0.55, label: label, c: color, lost: t.lost });
    });
    if (this.packets.length > 40) this.packets.splice(0, this.packets.length - 40);
  };
  Bench.prototype.drawRadio = function (dt) {
    var ctx = this.ctx, z = this.cam.z;
    ctx.globalCompositeOperation = "lighter";
    this.waves = (this.waves || []).filter(function (w) {
      w.age += dt;
      if (w.age > 1.1) return false;
      for (var k = 0; k < 3; k++) {
        var f = (w.age - k * 0.15) / 0.8;
        if (f < 0 || f > 1) continue;
        ctx.strokeStyle = rgba(w.c, (1 - f) * 0.8);
        ctx.lineWidth = 2.5 / z + 2;
        ctx.beginPath(); ctx.arc(w.x, w.y, 8 + 150 * f, 0, Math.PI * 2); ctx.stroke();
      }
      return true;
    });
    this.packets = (this.packets || []).filter(function (p) {
      p.age += dt;
      var f = p.age / p.dur;
      if (f > 1.15) return false;
      if (p.lost && f > 0.55) {
        var fx = p.x0 + (p.x1 - p.x0) * 0.5, fy = p.y0 + (p.y1 - p.y0) * 0.5, fade = Math.max(0, 1 - (f - 0.55) / 0.4);
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "rgba(255,106,90," + fade.toFixed(2) + ")"; ctx.lineWidth = 3 / z + 1;
        ctx.beginPath(); ctx.moveTo(fx - 8, fy - 8); ctx.lineTo(fx + 8, fy + 8); ctx.moveTo(fx + 8, fy - 8); ctx.lineTo(fx - 8, fy + 8); ctx.stroke();
        ctx.globalCompositeOperation = "lighter";
        return true;
      }
      var t = Math.min(1, f), e = t * t * (3 - 2 * t);
      var x = p.x0 + (p.x1 - p.x0) * e, y = p.y0 + (p.y1 - p.y0) * e - Math.sin(Math.PI * e) * 30;
      var gr = ctx.createRadialGradient(x, y, 0, x, y, 16);
      gr.addColorStop(0, rgba(p.c, 1)); gr.addColorStop(1, rgba(p.c, 0));
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, 16, 0, 7); ctx.fill();
      if (p.label) {
        ctx.globalCompositeOperation = "source-over";
        ctx.font = "700 " + (12 / Math.max(0.5, z)).toFixed(1) + "px ui-monospace, Menlo, monospace";
        var w = ctx.measureText(p.label).width + 10 / Math.max(0.5, z);
        ctx.fillStyle = "rgba(10,14,18,.85)";
        ctx.fillRect(x - w / 2, y - 30 / Math.max(0.5, z), w, 18 / Math.max(0.5, z));
        ctx.fillStyle = p.c; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(p.label, x, y - 21 / Math.max(0.5, z));
        ctx.globalCompositeOperation = "lighter";
      }
      return true;
    });
    ctx.globalCompositeOperation = "source-over";
  };

  /* A program line touched a pin: ripple out from it so the class can see
   * where the code reached into the circuit. */
  Bench.prototype.ripple = function (key, label, color) {
    var q = this.pinAll[key];
    if (!q) return;
    this.ripples.push({ x: q.x, y: q.y, age: 0, color: color || "#ffd36b" });
    if (this.ripples.length > 24) this.ripples.shift();
    if (label) {
      var s = this.toScreen(q.x, q.y), b = document.createElement("span");
      b.className = "bench-bubble";
      b.textContent = label;
      b.style.transform = "translate(" + Math.round(s.x) + "px," + Math.round(s.y - 18) + "px)";
      b.style.setProperty("--c", color || "#ffd36b");
      this.bubbles.appendChild(b);
      while (this.bubbles.childNodes.length > 6) this.bubbles.removeChild(this.bubbles.firstChild);
      setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 1400);
    }
  };
  Bench.prototype.drawRipples = function (dt) {
    var ctx = this.ctx;
    this.ripples = this.ripples.filter(function (r) {
      r.age += dt;
      if (r.age > 0.7) return false;
      var f = r.age / 0.7;
      ctx.strokeStyle = rgba(r.color, 1 - f);
      ctx.lineWidth = 3 * (1 - f) + 0.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, 6 + 34 * f, 0, 7); ctx.stroke();
      return true;
    });
  };

  /* Problem parts get a pulsing outline: red for danger, amber for advice. */
  Bench.prototype.flag = function (warnings) {
    var self = this;
    this.lUi.querySelectorAll(".flag").forEach(function (n) { n.remove(); });
    var seen = {};
    warnings.forEach(function (w) {
      if (seen[w.part] || w.level === "info") return;
      seen[w.part] = 1;
      var p = self.app.partById(w.part); if (!p) return;
      var b = L.boxOf(p);
      el("rect", { x: b.x - 4, y: b.y - 4, width: b.w + 8, height: b.h + 8, rx: 8, "class": "flag " + w.level }, self.lUi);
    });
  };

  /* For "Pin to board": the bench as a picture, glow and all. */
  Bench.prototype.snapshot = function (scale) {
    var self = this, b = L.boundsOf(this.app.doc), pad = 40;
    scale = scale || 1.5;
    var w = Math.round((b.w + pad * 2) * scale), h = Math.round((b.h + pad * 2) * scale);
    var clone = this.svg.cloneNode(true);
    clone.setAttribute("xmlns", NS);
    clone.setAttribute("width", w); clone.setAttribute("height", h);
    clone.setAttribute("viewBox", (b.x - pad) + " " + (b.y - pad) + " " + (b.w + pad * 2) + " " + (b.h + pad * 2));
    var world = clone.querySelector(".bench-world");
    world.removeAttribute("transform");
    var ui = clone.querySelector(".bench-ui"); if (ui) ui.innerHTML = "";
    var style = getComputedStyle(this.host);
    clone.querySelectorAll("pattern path").forEach(function (p) {
      var m = /var\((--[\w-]+)\)/.exec(p.getAttribute("style") || "");
      if (m) { p.removeAttribute("style"); p.setAttribute("stroke", style.getPropertyValue(m[1]).trim() || "#2b444b"); }
    });
    var bg = document.createElementNS(NS, "rect");
    bg.setAttribute("x", b.x - pad); bg.setAttribute("y", b.y - pad); bg.setAttribute("width", b.w + pad * 2); bg.setAttribute("height", b.h + pad * 2);
    bg.setAttribute("fill", style.getPropertyValue("--mat").trim() || "#1f3238");
    world.insertBefore(bg, world.firstChild);
    var xml = new XMLSerializer().serializeToString(clone);
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var cv = document.createElement("canvas");
        cv.width = w; cv.height = h;
        var cx = cv.getContext("2d");
        cx.drawImage(img, 0, 0);
        /* lay the current glow on top, scaled into the same frame */
        var sx = w / (b.w + pad * 2);
        cx.setTransform(sx, 0, 0, sx, -(b.x - pad) * sx, -(b.y - pad) * sx);
        cx.globalCompositeOperation = "lighter";
        self.app.doc.parts.forEach(function (p) {
          var d = L.def(p), st = (self.app.running && self.app.sim.state[p.id]) || {};
          if (!d.glow || !self.app.running) return;
          (d.glow(st, L.propsOf(p)) || []).forEach(function (l) {
            var ww = L.xform(l.x, l.y, p.rot, p.flip), x = p.x + ww[0], y = p.y + ww[1];
            var gr = cx.createRadialGradient(x, y, 0, x, y, l.r);
            gr.addColorStop(0, rgba(l.c, Math.min(1, l.a))); gr.addColorStop(1, rgba(l.c, 0));
            cx.fillStyle = gr; cx.beginPath(); cx.arc(x, y, l.r, 0, 7); cx.fill();
          });
        });
        cv.toBlob(function (blob) { blob ? resolve({ blob: blob, w: w, h: h }) : reject(new Error("no image")); }, "image/png");
      };
      img.onerror = function () { reject(new Error("The bench could not be turned into a picture.")); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
