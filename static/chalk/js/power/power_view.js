/* Chalk Power Lab — the drawing board.
 *
 * One canvas: the plan, drawn as the parts themselves rather than as
 * symbols, with cables that show what is going through them. Drag a part
 * to move it; click a terminal and then another to run a cable; with the
 * power on, click a switch to throw it.
 *
 *   var view = new ChalkPower.View(app, hostElement);
 *   view.draw()            repaint (the app calls this every frame)
 *   view.fit()             everything in view
 *   view.select(ids, wire) what is picked
 *   view.png(cb)           a picture of the plan, for pinning to the board
 */
(function (root) {
  "use strict";

  var W = root.ChalkPower;
  var TAU = Math.PI * 2;

  function View(app, host) {
    this.app = app; this.host = host;
    this.cam = { x: -40, y: -40, z: 1 };
    this.sel = {}; this.selWire = null; this.hover = null; this.wiring = null; this.drag = null; this.thermal = false; this.flags = {};
    this.canvas = document.createElement("canvas");
    this.canvas.className = "pw-canvas"; this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", "The plan. Drag parts to move them; click one terminal and then another to run a cable.");
    host.appendChild(this.canvas);
    this.c = this.canvas.getContext("2d");
    this.pointers = {};
    this.bind();
    var self = this;
    if (root.ResizeObserver) new ResizeObserver(function () { self.resize(); }).observe(host);
    this.resize();
  }
  W.View = View;

  View.prototype.resize = function () {
    var r = this.host.getBoundingClientRect(), d = root.devicePixelRatio || 1;
    this.w = Math.max(50, r.width); this.h = Math.max(50, r.height); this.dpr = d;
    this.canvas.width = Math.round(this.w * d); this.canvas.height = Math.round(this.h * d);
    this.canvas.style.width = this.w + "px"; this.canvas.style.height = this.h + "px";
  };
  View.prototype.world = function (e) {
    var r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.cam.z + this.cam.x, y: (e.clientY - r.top) / this.cam.z + this.cam.y, sx: e.clientX - r.left, sy: e.clientY - r.top };
  };
  View.prototype.bounds = function () {
    var doc = this.app.doc, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    doc.parts.forEach(function (p) { var s = W.sizeOf(p); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + s.w); y1 = Math.max(y1, p.y + s.h); });
    return x1 < x0 ? { x: 0, y: 0, w: 800, h: 500 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };
  View.prototype.fit = function () {
    var b = this.bounds(), pad = 70;
    this.cam.z = W.clamp(Math.min(this.w / (b.w + 2 * pad), this.h / (b.h + 2 * pad)), 0.15, 1.6);
    this.cam.x = b.x + b.w / 2 - this.w / this.cam.z / 2; this.cam.y = b.y + b.h / 2 - this.h / this.cam.z / 2;
  };
  View.prototype.centre = function () { return { x: this.cam.x + this.w / this.cam.z / 2, y: this.cam.y + this.h / this.cam.z / 2 }; };
  View.prototype.zoomBy = function (f, sx, sy) {
    var z0 = this.cam.z, z1 = W.clamp(z0 * f, 0.12, 3.5);
    sx = sx == null ? this.w / 2 : sx; sy = sy == null ? this.h / 2 : sy;
    this.cam.x += sx / z0 - sx / z1; this.cam.y += sy / z0 - sy / z1; this.cam.z = z1;
  };
  View.prototype.focus = function (ids, wires) {
    var doc = this.app.doc, self = this, pts = [];
    this.flags = {};
    (ids || []).forEach(function (id) { var p = W.partById(doc, id); if (p) { var s = W.sizeOf(p); pts.push([p.x + s.w / 2, p.y + s.h / 2]); self.flags[id] = 1; } });
    (wires || []).forEach(function (id) { self.flags["w:" + id] = 1; var w = doc.wires.filter(function (q) { return q.id === id; })[0]; if (w) { var r = self.route(w); if (r) pts.push(r[Math.floor(r.length / 2)]); } });
    if (!pts.length) return;
    var x = 0, y = 0; pts.forEach(function (q) { x += q[0]; y += q[1]; });
    x /= pts.length; y /= pts.length;
    if (this.cam.z < 0.5) this.cam.z = 0.7;
    this.cam.x = x - this.w / this.cam.z / 2; this.cam.y = y - this.h / this.cam.z / 2;
    this.flagT = Date.now();
  };

  /* ------------------------------------------------------------- cables */

  /* What a cable is, from what it is screwed into — followed through
   * breakers and bars, so the live side of a breaker is brown both ends. */
  View.prototype.kinds = function () {
    var app = this.app, doc = app.doc;
    if (this.kindRev === app.rev) return this.kindMap;
    var tk = {}, wk = {}, byId = {};
    doc.parts.forEach(function (p) { byId[p.id] = p; W.termsOf(p).forEach(function (t) { if (t.k !== "X") tk[p.id + ":" + t.n] = t.k; }); });
    for (var pass = 0; pass < 5; pass++) {
      doc.wires.forEach(function (w) { var k = tk[w.a] || tk[w.b]; if (k) { wk[w.id] = k; if (!tk[w.a]) tk[w.a] = k; if (!tk[w.b]) tk[w.b] = k; } });
      doc.parts.forEach(function (p) {
        (W.PATHS[p.type] || []).forEach(function (l) { var a = p.id + ":" + l[0], b = p.id + ":" + l[1]; if (tk[a] && !tk[b]) tk[b] = tk[a]; else if (tk[b] && !tk[a]) tk[a] = tk[b]; });
      });
    }
    this.kindRev = app.rev; this.kindMap = wk; this.termKind = tk;
    return wk;
  };

  /* Out of the terminal, then square corners to the other one. */
  View.prototype.route = function (w, idx) {
    var doc = this.app.doc, ia = w.a.split(":")[0], ib = w.b.split(":")[0], pa = W.partById(doc, ia), pb = W.partById(doc, ib);
    if (!pa || !pb) return null;
    var a = W.termPos(pa, w.a.slice(ia.length + 1)), b = W.termPos(pb, w.b.slice(ib.length + 1));
    if (!a || !b) return null;
    var out = function (t, n) { return t.side === "t" ? [t.x, t.y - n] : t.side === "b" ? [t.x, t.y + n] : t.side === "l" ? [t.x - n, t.y] : [t.x + n, t.y]; };
    var h = 0; for (var i = 0; i < w.id.length; i++) h = (h * 33 + w.id.charCodeAt(i)) % 7;
    var a1 = out(a, 12 + h * 3), b1 = out(b, 12 + h * 3), va = a.side === "t" || a.side === "b", vb = b.side === "t" || b.side === "b", pts = [[a.x, a.y], a1];
    if (va && vb) {
      if (a.side === b.side) { var ey = a.side === "t" ? Math.min(a1[1], b1[1]) : Math.max(a1[1], b1[1]); pts.push([a1[0], ey], [b1[0], ey]); }
      else if (a.side === "b" ? b1[1] >= a1[1] : a1[1] >= b1[1]) { var my = (a1[1] + b1[1]) / 2 + (h - 3) * 2; pts.push([a1[0], my], [b1[0], my]); }
      else { var mx = (a1[0] + b1[0]) / 2 + (h - 3) * 4; pts.push([mx, a1[1]], [mx, b1[1]]); }
    } else if (!va && !vb) { var mx2 = (a1[0] + b1[0]) / 2 + (h - 3) * 2; pts.push([mx2, a1[1]], [mx2, b1[1]]); }
    else if (va) pts.push([a1[0], b1[1]]);
    else pts.push([b1[0], a1[1]]);
    pts.push(b1, [b.x, b.y]);
    return pts;
  };

  function polyLen(p) { var n = 0; for (var i = 1; i < p.length; i++) n += Math.abs(p[i][0] - p[i - 1][0]) + Math.abs(p[i][1] - p[i - 1][1]); return n; }
  function along(p, d) {
    for (var i = 1; i < p.length; i++) {
      var seg = Math.abs(p[i][0] - p[i - 1][0]) + Math.abs(p[i][1] - p[i - 1][1]);
      if (d <= seg && seg > 0) return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * d / seg, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * d / seg];
      d -= seg;
    }
    return p[p.length - 1];
  }
  function heatColor(r) { r = W.clamp(r, 0, 1.4) / 1.4; return "hsl(" + Math.round(220 - 220 * r) + ",85%," + Math.round(38 + 22 * r) + "%)"; }
  W.heatColor = heatColor;

  View.prototype.draw = function () {
    var app = this.app, doc = app.doc, c = this.c, z = this.cam.z, self = this, on = app.on, sim = app.sim, t = (Date.now() - app.t0) / 1000;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.fillStyle = this.thermal ? "#0c1014" : "#15242b"; c.fillRect(0, 0, this.w, this.h);
    c.setTransform(this.dpr * z, 0, 0, this.dpr * z, -this.cam.x * z * this.dpr, -this.cam.y * z * this.dpr);
    /* squared paper */
    var step = z < 0.35 ? 200 : z < 0.8 ? 100 : 20, x0 = Math.floor(this.cam.x / step) * step, y0 = Math.floor(this.cam.y / step) * step, x1 = this.cam.x + this.w / z, y1 = this.cam.y + this.h / z;
    c.lineWidth = 1 / z; c.beginPath();
    for (var gx = x0; gx < x1; gx += step) { c.moveTo(gx, y0); c.lineTo(gx, y1); }
    for (var gy = y0; gy < y1; gy += step) { c.moveTo(x0, gy); c.lineTo(x1, gy); }
    c.strokeStyle = this.thermal ? "rgba(255,255,255,.035)" : "rgba(120,170,190,.08)"; c.stroke();

    var o = { on: on, t: t, G: sim.env.G }, flagged = this.flags, pulse = this.flagT && Date.now() - this.flagT < 6000 ? 0.5 + 0.5 * Math.sin(Date.now() / 140) : 0;
    doc.parts.forEach(function (p) { if (W.def(p) && W.def(p).back) self.part(c, p, o); });

    /* cables */
    var kinds = this.kinds();
    this.routes = {};
    doc.wires.forEach(function (w, i) {
      var pts = self.route(w); if (!pts) return;
      self.routes[w.id] = pts;
      var ws = sim.wstate[w.id] || {}, k = kinds[w.id] || "X", lw = 1.8 + Math.log(Math.max(1, +w.mm2 || 2.5)) / Math.LN2 * 0.75, col = W.KIND_COLOR[k];
      c.lineJoin = "round"; c.lineCap = "round";
      c.beginPath(); pts.forEach(function (q, j) { if (j) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
      if (self.selWire === w.id || flagged["w:" + w.id]) { c.strokeStyle = flagged["w:" + w.id] ? "rgba(255,106,90," + (0.5 + 0.4 * pulse) + ")" : "rgba(240,173,98,.9)"; c.lineWidth = lw + 7; c.stroke(); }
      if (on && ws.ratio > 1 && !ws.burnt) { c.strokeStyle = "rgba(255,90,60," + (0.35 + 0.3 * Math.sin(t * 9)) + ")"; c.lineWidth = lw + 9; c.stroke(); }
      c.strokeStyle = "rgba(0,0,0,.45)"; c.lineWidth = lw + 2; c.stroke();
      if (ws.burnt) { c.setLineDash([4, 7]); c.strokeStyle = "#3a2d2a"; c.lineWidth = lw; c.stroke(); c.setLineDash([]); var m = along(pts, polyLen(pts) / 2); c.font = "700 16px system-ui"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#ff6a5a"; c.fillText("✕", m[0], m[1]); return; }
      c.strokeStyle = self.thermal ? heatColor(on ? (ws.ratio || 0) : 0) : col; c.lineWidth = lw; c.stroke();
      if (k === "PE" && !self.thermal) { c.setLineDash([7, 7]); c.strokeStyle = "#e8d44a"; c.lineWidth = lw * 0.5; c.stroke(); c.setLineDash([]); }
      /* energy on the move */
      if (on && ws.mag > 0.02 && ws.dir && !self.thermal && z > 0.3) {
        var len = polyLen(pts), gap = 26, sp = 14 + 22 * Math.min(1, Math.log(1 + ws.mag) / 4), off = (t * sp) % gap;
        c.fillStyle = k === "M" || k === "N" ? "rgba(190,225,255,.9)" : "rgba(255,225,150,.95)";
        for (var d = off; d < len; d += gap) { var q = along(pts, ws.dir > 0 ? d : len - d); c.beginPath(); c.arc(q[0], q[1], Math.min(2.6, lw * 0.5), 0, TAU); c.fill(); }
      }
    });

    doc.parts.forEach(function (p) { if (W.def(p) && !W.def(p).back) self.part(c, p, o); });

    /* terminals */
    var hov = this.hover && this.hover.term, tk = this.termKind || {};
    if (z > 0.28) doc.parts.forEach(function (p) {
      W.termsOf(p).forEach(function (q) {
        var key = p.id + ":" + q.n, x = p.x + q.x, y = p.y + q.y, k = q.k === "X" ? tk[key] || "X" : q.k, big = hov === key || (self.wiring && self.wiring.from === key);
        c.beginPath(); c.arc(x, y, big ? 7 : 4.6, 0, TAU); c.fillStyle = W.KIND_COLOR[k]; c.fill();
        c.lineWidth = big ? 2.5 : 1.3; c.strokeStyle = big ? "#ffd36b" : "rgba(255,255,255,.75)"; c.stroke();
        if (z > 0.85 || big) {
          c.font = "600 8px system-ui"; c.fillStyle = "rgba(232,238,244,.75)"; c.textBaseline = "middle";
          if (q.side === "t") { c.textAlign = "center"; c.fillText(q.n, x, y - 11); } else if (q.side === "b") { c.textAlign = "center"; c.fillText(q.n, x, y + 12); }
          else if (q.side === "l") { c.textAlign = "right"; c.fillText(q.n, x - 9, y); } else { c.textAlign = "left"; c.fillText(q.n, x + 9, y); }
        }
      });
    });

    /* a cable being run */
    if (this.wiring && this.wiring.x != null) {
      var fp = this.termXY(this.wiring.from);
      if (fp) { c.setLineDash([6, 5]); c.strokeStyle = "#ffd36b"; c.lineWidth = 2; c.beginPath(); c.moveTo(fp.x, fp.y); c.lineTo(this.wiring.x, this.wiring.y); c.stroke(); c.setLineDash([]); }
    }
    if (this.marq) { c.strokeStyle = "#f0ad62"; c.lineWidth = 1 / z; c.setLineDash([5 / z, 4 / z]); c.strokeRect(this.marq.x0, this.marq.y0, this.marq.x1 - this.marq.x0, this.marq.y1 - this.marq.y0); c.setLineDash([]); }
    if (app.testers) app.testers.draw(c, this);
    if (this.flagT && Date.now() - this.flagT > 6000) { this.flags = {}; this.flagT = 0; }
  };

  View.prototype.part = function (c, p, o) {
    var d = W.def(p), s = W.sizeOf(p), app = this.app, st = app.sim.state[p.id] || {}, pr = W.propsOf(p);
    c.save(); c.translate(p.x, p.y);
    o.w = s.w; o.h = s.h;
    try { d.draw(c, p, pr, app.on ? st : {}, o); } catch (e) { if (root.console) console.error(e); }
    if (this.thermal && app.on && st.heat > 0.05 && !d.back) { var g = c.createRadialGradient(s.w / 2, s.h / 2, 2, s.w / 2, s.h / 2, Math.max(s.w, s.h) * 0.75); g.addColorStop(0, heatColor(st.heat * 1.4)); g.addColorStop(1, "rgba(0,0,0,0)"); c.globalAlpha = 0.75; c.fillStyle = g; c.fillRect(-20, -20, s.w + 40, s.h + 40); c.globalAlpha = 1; }
    if (this.sel[p.id] || this.flags[p.id]) {
      c.strokeStyle = this.flags[p.id] ? "#ff6a5a" : "#f0ad62"; c.lineWidth = 2; c.setLineDash(this.flags[p.id] ? [] : [6, 4]);
      W.draw.rr(c, -5, -5, s.w + 10, s.h + 10, 9); c.stroke(); c.setLineDash([]);
    }
    if (this.cam.z > 0.6 && !d.back && p.type !== "label") {
      c.font = "600 9px system-ui"; c.textAlign = "left"; c.textBaseline = "alphabetic"; c.fillStyle = "rgba(232,238,244,.6)";
      var hasTop = W.termsOf(p).some(function (q) { return q.side === "t"; });
      c.fillText((app.refs[p.id] || "") + (p.name ? " · " + p.name : ""), 0, hasTop ? s.h + 12 + (W.termsOf(p).some(function (q) { return q.side === "b"; }) ? 12 : 0) : -6);
    }
    c.restore();
  };

  View.prototype.termXY = function (key) {
    var id = key.split(":")[0], p = W.partById(this.app.doc, id);
    return p ? W.termPos(p, key.slice(id.length + 1)) : null;
  };

  /* -------------------------------------------------------------- picking */

  View.prototype.hit = function (x, y) {
    var doc = this.app.doc, z = this.cam.z, i, best = null, bd = 11 / Math.min(1, z);
    for (i = doc.parts.length - 1; i >= 0; i--) {
      var p = doc.parts[i], terms = W.termsOf(p);
      for (var j = 0; j < terms.length; j++) { var dd = Math.hypot(p.x + terms[j].x - x, p.y + terms[j].y - y); if (dd < bd) { bd = dd; best = { term: p.id + ":" + terms[j].n, part: p.id }; } }
    }
    if (best) return best;
    for (i = doc.parts.length - 1; i >= 0; i--) {
      p = doc.parts[i]; var d = W.def(p), s = W.sizeOf(p);
      if (!d) continue;
      if (d.back) { if (x >= p.x && x <= p.x + s.w && y >= p.y && y <= p.y + 26) return { part: p.id }; continue; }
      if (x >= p.x && x <= p.x + s.w && y >= p.y && y <= p.y + s.h) return { part: p.id };
    }
    var routes = this.routes || {}, tol = 6 / Math.min(1, z), wb = null, wd = tol;
    Object.keys(routes).forEach(function (id) {
      var pts = routes[id];
      for (var k = 1; k < pts.length; k++) {
        var ax = pts[k - 1][0], ay = pts[k - 1][1], bx = pts[k][0], by = pts[k][1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
        var u = W.clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1), dist = Math.hypot(ax + u * dx - x, ay + u * dy - y);
        if (dist < wd) { wd = dist; wb = id; }
      }
    });
    return wb ? { wire: wb } : null;
  };

  View.prototype.select = function (ids, wire) {
    var s = {}; (ids || []).forEach(function (id) { s[id] = 1; });
    this.sel = s; this.selWire = wire || null;
    this.app.onSelect();
  };
  View.prototype.selected = function () { return Object.keys(this.sel); };

  /* What clicking a part does when the power is on. */
  var TAP = {
    switch1: function (pr) { return { on: !pr.on }; }, mcb: function (pr) { return { on: pr.on === false }; }, isolator: function (pr) { return { on: pr.on === false }; },
    rcd: function (pr) { return { on: pr.on === false }; }, switch2: function (pr) { return { pos: +pr.pos ? 0 : 1 }; },
    changeover: function (pr) { return pr.auto ? null : { pos: +pr.pos === 1 ? 0 : +pr.pos === 0 ? 2 : 1 }; },
    socket: function (pr) { return { on: pr.on === false }; }, load: function (pr) { return { on: pr.on === false }; }, dcload: function (pr) { return { on: pr.on === false }; },
    grid1: function (pr) { return { on: pr.on === false }; }, grid3: function (pr) { return { on: pr.on === false }; }, genset: function (pr) { return { run: !pr.run }; },
    inverter: function (pr) { return { on: pr.on === false }; }, hybrid: function (pr) { return { on: pr.on === false }; }
  };
  View.prototype.tap = function (id) {
    var app = this.app, p = W.partById(app.doc, id), st = app.sim.state[id] || {};
    if (!p || !app.on) return false;
    if (st.trip || st.blown === true || (Array.isArray(st.blown) && st.blown.some(Boolean)) || /^(overload|backfeed|wrong battery)$/.test(st.err || "") || st.over) {
      app.sim.resetPart(id); app.toast(W.def(p).name + " reset." + (st.blown ? " (A new fuse.)" : "")); return true;
    }
    if (st.pvdead || st.mode === "dead") { st.pvdead = false; st.mode = "off"; app.toast("Replaced with a new one. It will die again unless the string is shortened."); return true; }
    var f = TAP[p.type], change = f ? f(W.propsOf(p)) : null;
    if (!change) return false;
    app.live(function () { p.props = p.props || {}; for (var k in change) p.props[k] = change[k]; });
    return true;
  };

  /* --------------------------------------------------------------- input */

  View.prototype.bind = function () {
    var self = this, cv = this.canvas, app = this.app;
    cv.addEventListener("wheel", function (e) { e.preventDefault(); var r = cv.getBoundingClientRect(); self.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    cv.addEventListener("pointerdown", function (e) {
      cv.focus({ preventScroll: true });
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* fine */ }
      self.pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(self.pointers);
      if (ids.length === 2) { var a = self.pointers[ids[0]], b = self.pointers[ids[1]]; self.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) }; self.drag = null; self.wiring = null; return; }
      var w = self.world(e), h = self.hit(w.x, w.y);
      self.down = { sx: w.sx, sy: w.sy, moved: false, hit: h };
      if (app.testers && app.testers.tool) { self.drag = { kind: "pan", cx: self.cam.x, cy: self.cam.y, tool: true }; return; }
      if (h && h.term) {
        if (self.wiring && self.wiring.from !== h.term) { app.addWire(self.wiring.from, h.term); self.wiring = null; self.drag = null; self.down = null; return; }
        self.wiring = { from: h.term, x: w.x, y: w.y, fresh: true }; self.drag = { kind: "wire" };
        return;
      }
      if (self.wiring) { self.wiring = null; }
      if (h && h.part) {
        if (e.shiftKey) { var s2 = self.selected(); if (self.sel[h.part]) s2 = s2.filter(function (q) { return q !== h.part; }); else s2.push(h.part); self.select(s2); }
        else if (!self.sel[h.part]) self.select([h.part]);
        var moving = self.selected().map(function (id) { var p = W.partById(app.doc, id); return { p: p, x: p.x, y: p.y }; });
        /* a room carries its furniture */
        var pp = W.partById(app.doc, h.part);
        if (pp && W.def(pp).back && moving.length === 1) { var sz = W.sizeOf(pp); app.doc.parts.forEach(function (q) { if (q !== pp && q.x >= pp.x && q.y >= pp.y && q.x <= pp.x + sz.w && q.y <= pp.y + sz.h) moving.push({ p: q, x: q.x, y: q.y }); }); }
        self.drag = { kind: "move", wx: w.x, wy: w.y, items: moving, pushed: false };
        return;
      }
      if (h && h.wire) { self.select([], h.wire); self.drag = null; return; }
      if (e.shiftKey) { self.marq = { x0: w.x, y0: w.y, x1: w.x, y1: w.y }; self.drag = { kind: "marq" }; return; }
      self.drag = { kind: "pan", cx: self.cam.x, cy: self.cam.y };
    });
    cv.addEventListener("pointermove", function (e) {
      if (self.pointers[e.pointerId]) { self.pointers[e.pointerId] = { x: e.clientX, y: e.clientY }; }
      var ids = Object.keys(self.pointers);
      if (self.pinch && ids.length === 2) {
        var a = self.pointers[ids[0]], b = self.pointers[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y), r = cv.getBoundingClientRect();
        self.zoomBy(d / (self.pinch.d || d), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); self.pinch.d = d; return;
      }
      var w = self.world(e), dn = self.down;
      if (dn && Math.hypot(w.sx - dn.sx, w.sy - dn.sy) > 4) dn.moved = true;
      if (self.wiring) { self.wiring.x = w.x; self.wiring.y = w.y; }
      var dr = self.drag;
      if (!dr) { var h = self.hit(w.x, w.y); self.hover = h; cv.style.cursor = app.testers && app.testers.tool ? "crosshair" : h && h.term ? "crosshair" : h && h.part ? "grab" : h && h.wire ? "pointer" : "default"; if (app.testers) app.testers.hover(h); return; }
      if (dr.kind === "wire") { self.hover = self.hit(w.x, w.y); return; }
      if (dr.kind === "pan" && dn) { self.cam.x = dr.cx - (w.sx - dn.sx) / self.cam.z; self.cam.y = dr.cy - (w.sy - dn.sy) / self.cam.z; }
      else if (dr.kind === "move" && dn && dn.moved) {
        if (!dr.pushed) { app.history.push(app.doc); dr.pushed = true; }
        dr.items.forEach(function (it) { it.p.x = Math.round((it.x + w.x - dr.wx) / 10) * 10; it.p.y = Math.round((it.y + w.y - dr.wy) / 10) * 10; });
        app.rev++;
      } else if (dr.kind === "marq") { self.marq.x1 = w.x; self.marq.y1 = w.y; }
    });
    var up = function (e) {
      delete self.pointers[e.pointerId];
      if (self.pinch) { if (Object.keys(self.pointers).length < 2) self.pinch = null; self.drag = null; self.down = null; return; }
      var w = self.world(e), dr = self.drag, dn = self.down;
      self.drag = null; self.down = null;
      if (!dr || !dn) return;
      if (dr.tool) { if (!dn.moved) app.testers.click(self.hit(w.x, w.y), w); return; }
      if (dr.kind === "wire") {
        var h = self.hit(w.x, w.y);
        if (h && h.term && h.term !== self.wiring.from) { app.addWire(self.wiring.from, h.term); self.wiring = null; }
        else if (dn.moved) self.wiring = null;
        return;
      }
      if (dr.kind === "move") {
        if (dr.pushed) app.changed();
        else if (dn.hit && dn.hit.part && !e.shiftKey) { if (!self.tap(dn.hit.part)) self.select([dn.hit.part]); }
        return;
      }
      if (dr.kind === "marq") {
        var m = self.marq, x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1);
        self.select(app.doc.parts.filter(function (p) { var s = W.sizeOf(p); return !W.def(p).back && p.x >= x0 && p.y >= y0 && p.x + s.w <= x1 && p.y + s.h <= y1; }).map(function (p) { return p.id; }));
        self.marq = null; return;
      }
      if (dr.kind === "pan" && !dn.moved) self.select([]);
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", function (e) { delete self.pointers[e.pointerId]; self.drag = null; self.down = null; self.pinch = null; self.marq = null; });
    cv.addEventListener("dblclick", function (e) { var w = self.world(e), h = self.hit(w.x, w.y); if (h && h.part && !h.term) { self.select([h.part]); app.showSide("inspect"); } });
  };

  /* A picture of the whole plan on a plain background. */
  View.prototype.png = function (cb) {
    var keep = { cam: this.cam, w: this.w, h: this.h, dpr: this.dpr, canvas: this.canvas, c: this.c, sel: this.sel, selWire: this.selWire };
    var b = this.bounds(), pad = 60, sc = Math.min(2, 2400 / (b.w + 2 * pad)), cv = document.createElement("canvas");
    cv.width = Math.round((b.w + 2 * pad) * sc); cv.height = Math.round((b.h + 2 * pad) * sc);
    this.canvas = cv; this.c = cv.getContext("2d"); this.dpr = 1; this.w = cv.width; this.h = cv.height; this.cam = { x: b.x - pad, y: b.y - pad, z: sc }; this.sel = {}; this.selWire = null;
    try { this.draw(); } finally { for (var k in keep) this[k] = keep[k]; }
    cv.toBlob(function (blob) { cb(blob, cv); }, "image/png");
  };
})(typeof window !== "undefined" ? window : globalThis);
