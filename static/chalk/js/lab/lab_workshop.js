/* Chalk Circuit Lab — the workshop.
 *
 * A breadboard is for trying things; a perfboard or stripboard is for
 * keeping them, and on those nothing is connected until it is soldered.
 * The tools behave the way the real ones do, compressed in time so a
 * lesson isn't spent waiting:
 *
 *   Soldering iron   hold on a pad: the pad heats, solder flows, a shiny
 *                    cone forms (about a second). Let go too soon and you get
 *                    a dull, grainy COLD JOINT — it makes and breaks contact,
 *                    so the LED flickers, exactly as on a real board. Hold far
 *                    too long on an LED, transistor or chip leg and the heat
 *                    runs up the leg and damages it. Hold on a joint to reflow
 *                    a cold one. Drag from a hot pad to the next to bridge them.
 *   Solder sucker    hold on a joint: it melts and is pulled away.
 *   Hot air          hold over parts: every joint under the nozzle melts
 *                    (so the part can be lifted out) — and anything delicate
 *                    under it for too long cooks.
 *   Cutters          snip a wire, or a component's leg.
 *   Track cutter     spot-face a stripboard hole to break its copper strip.
 *
 * Joints, bridges and cuts live in the document (doc.joints, doc.bridges,
 * doc.cuts; wire.cut; part.cutPins) and the simulator reads them when it
 * works out what is connected — so a cold joint is a real fault, not a look.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var P = L.P, add = L.addPart, S = L.svg, text = S.text, shadow = S.shadow;
  var NS = "http://www.w3.org/2000/svg";

  /* ========================================================= THE BOARDS */

  function holeName(c, r) { return "h" + c + "_" + r; }
  function boardPins(cols, rows) {
    var out = [];
    for (var r = 1; r <= rows; r++) for (var c = 1; c <= cols; c++) out.push({ n: holeName(c, r), x: c * P, y: r * P, hole: true, label: "pad " + c + "," + r });
    return out;
  }

  var PB = { cols: 24, rows: 16 }, SB = { cols: 26, rows: 14 };
  var PB_PINS = boardPins(PB.cols, PB.rows), SB_PINS = boardPins(SB.cols, SB.rows);

  add("perfboard", {
    name: "Perfboard (solder)", cat: "Workshop", layer: "board", solder: true,
    blurb: "A board of separate plated pads. Push parts through, then solder every leg — and join pads with solder bridges or wire.",
    pins: PB_PINS,
    box: { x: 0, y: 0, w: (PB.cols + 1) * P, h: (PB.rows + 1) * P },
    props: {},
    art: function () {
      var W = (PB.cols + 1) * P, H = (PB.rows + 1) * P, s = shadow(0, 0, W, H, 6);
      s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="6" fill="#2f6b3e" stroke="#1d4a29" stroke-width="1.5"/>';
      var pads = "", holes = "";
      PB_PINS.forEach(function (p) {
        pads += "M" + (p.x + 6.2) + " " + p.y + "a6.2 6.2 0 1 0 -12.4 0a6.2 6.2 0 1 0 12.4 0z";
        holes += "M" + (p.x + 2.4) + " " + p.y + "a2.4 2.4 0 1 0 -4.8 0a2.4 2.4 0 1 0 4.8 0z";
      });
      s += '<path d="' + pads + '" fill="#c9ced3" stroke="#8d969c" stroke-width=".8"/>';
      s += '<path d="' + holes + '" fill="#10140f"/>';
      for (var c = 1; c <= PB.cols; c += 4) s += text(c * P, 0.45 * P, String(c), 7, "#bfe0c8");
      return s;
    }
  });

  add("stripboard", {
    name: "Stripboard (solder)", cat: "Workshop", layer: "board", solder: true, strips: true,
    blurb: "Each row of holes is joined by a copper strip underneath. Solder parts across the strips; break a strip with the track cutter where it shouldn't go on.",
    pins: SB_PINS,
    box: { x: 0, y: 0, w: (SB.cols + 1) * P, h: (SB.rows + 1) * P },
    props: {},
    /* one strip per row, broken wherever a hole has been cut */
    busesFor: function (part, doc) {
      var cuts = doc.cuts || {}, out = [];
      for (var r = 1; r <= SB.rows; r++) {
        var cur = [];
        for (var c = 1; c <= SB.cols; c++) {
          var nm = holeName(c, r);
          if (cuts[part.id + ":" + nm]) { if (cur.length) out.push(cur); cur = []; continue; }
          cur.push(nm);
        }
        if (cur.length) out.push(cur);
      }
      return out;
    },
    art: function () {
      var W = (SB.cols + 1) * P, H = (SB.rows + 1) * P, s = shadow(0, 0, W, H, 6);
      s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="6" fill="#c8a06a" stroke="#93703f" stroke-width="1.5"/>';
      for (var r = 1; r <= SB.rows; r++) {
        s += '<rect x="' + (0.45 * P) + '" y="' + (r * P - 0.36 * P) + '" width="' + (W - 0.9 * P) + '" height="' + (0.72 * P) + '" rx="2" fill="#d98a4e" opacity=".85"/>';
        s += '<rect x="' + (0.45 * P) + '" y="' + (r * P - 0.36 * P) + '" width="' + (W - 0.9 * P) + '" height="2.4" fill="#fff" opacity=".25"/>';
      }
      var holes = "";
      SB_PINS.forEach(function (p) { holes += "M" + (p.x + 2.6) + " " + p.y + "a2.6 2.6 0 1 0 -5.2 0a2.6 2.6 0 1 0 5.2 0z"; });
      s += '<path d="' + holes + '" fill="#2a1d10"/>';
      for (var c = 1; c <= SB.cols; c += 5) s += text(c * P, 0.32 * P, String(c), 7, "#6b4a22");
      return s;
    }
  });

  /* Parts that the heat can hurt, and how. */
  var DELICATE = { led: 1, rgb_led: 1, npn: 1, pnp: 1, nmos: 1, ic555: 1, logic_ic: 1, ic7404: 1, lm358: 1, tmp36: 1, capacitor_e: 1, hc05: 1, hc12: 1, seg7: 1 };

  /* ========================================================== THE TOOLS */

  var TOOLS = [
    { id: null, name: "Select", tip: "Move parts and draw wires", key: "v" },
    { id: "iron", name: "Soldering iron", tip: "Hold on a pad for about a second. Drag to the next pad to bridge", key: "s" },
    { id: "pump", name: "Solder sucker", tip: "Hold on a joint to suck the solder away", key: "d" },
    { id: "hotair", name: "Hot air", tip: "Hold over parts to melt every joint under the nozzle", key: "h" },
    { id: "cutter", name: "Cutters", tip: "Click a wire or a component leg to snip it", key: "x" },
    { id: "drill", name: "Track cutter", tip: "Click a stripboard hole to break its copper strip", key: "t" }
  ];
  var ICONS = {
    "null": '<path d="M5 3l11 7-5 1.2L8.5 17z" fill="currentColor"/>',
    iron: '<path d="M3 17l4-1 9-9-3-3-9 9z" fill="currentColor" opacity=".55"/><path d="M3 17l2.5-4.5 2 2z" fill="#ff9a4a"/><path d="M12 4l3 3 2-2-3-3z" fill="currentColor"/>',
    pump: '<rect x="8" y="2" width="5" height="11" rx="1.5" fill="currentColor" opacity=".7"/><path d="M9.5 13h2l-.5 5h-1z" fill="currentColor"/><path d="M10.5 0v2" stroke="currentColor" stroke-width="2"/>',
    hotair: '<rect x="6" y="2" width="9" height="8" rx="2" fill="currentColor" opacity=".6"/><path d="M8.5 10h4v3h-4z" fill="currentColor"/><path d="M8 15q1.2 1.5 0 3M10.5 15q1.2 1.5 0 3M13 15q1.2 1.5 0 3" stroke="#ff9a4a" stroke-width="1.3" fill="none"/>',
    cutter: '<path d="M4 16l6-8M16 16l-6-8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M8.5 6l1.5-4 1.5 4z" fill="currentColor"/>',
    drill: '<path d="M10 2v9" stroke="currentColor" stroke-width="3"/><circle cx="10" cy="14" r="4" fill="none" stroke="#d98a4e" stroke-width="2.2"/><circle cx="10" cy="14" r="1.4" fill="currentColor"/>'
  };

  function Workshop(app) {
    this.app = app;
    this.act = null;              /* the tool currently pressed on something */
    this.heat = {};               /* per-joint heat from the hot air, seconds */
    this.partHeat = {};
    this.fx = [];                 /* smoke, swarf, flecks */
    this.ptr = null;
    this.build();
  }
  L.Workshop = Workshop;

  Workshop.prototype.build = function () {
    var self = this, wrap = document.querySelector(".bench-wrap");
    var tray = document.createElement("div");
    tray.className = "ws-tray pro-only";
    tray.setAttribute("role", "toolbar");
    tray.setAttribute("aria-label", "Workshop tools");
    tray.innerHTML = TOOLS.map(function (t) {
      return '<button type="button" data-tool="' + (t.id || "") + '" aria-pressed="' + (t.id === null) + '" title="' + L.esc(t.name + " (" + t.key.toUpperCase() + ") — " + t.tip) + '" aria-label="' + L.esc(t.name) + '">' +
             '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">' + ICONS[String(t.id)] + '</svg></button>';
    }).join("");
    wrap.appendChild(tray);
    this.tray = tray;
    tray.querySelectorAll("[data-tool]").forEach(function (b) {
      b.addEventListener("click", function () { self.use(b.getAttribute("data-tool") || null); });
    });
    this.hint = document.createElement("p");
    this.hint.className = "ws-hint";
    this.hint.hidden = true;
    wrap.appendChild(this.hint);
    document.addEventListener("keydown", function (e) {
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (self.app.doc.mode === "kid") return;
      var t = TOOLS.filter(function (x) { return x.key === e.key.toLowerCase(); })[0];
      if (t && (t.id || self.app.bench.tool)) { self.use(t.id); e.preventDefault(); }
      if (e.key === "Escape" && self.app.bench.tool) self.use(null);
    });
  };

  Workshop.prototype.use = function (id) {
    var bench = this.app.bench;
    bench.tool = id;
    this.act = null;
    this.tray.querySelectorAll("[data-tool]").forEach(function (b) { b.setAttribute("aria-pressed", (b.getAttribute("data-tool") || null) === id ? "true" : "false"); });
    bench.svg.style.cursor = id ? "none" : "";
    document.body.classList.toggle("ws-tool", !!id);
    var t = TOOLS.filter(function (x) { return x.id === id; })[0];
    this.hint.hidden = !id;
    if (id) this.hint.textContent = t.name + ": " + t.tip + ". Esc to put it down.";
    if (id && !this.app.doc.parts.some(function (p) { return L.def(p).solder; }) && (id === "iron" || id === "pump" || id === "hotair" || id === "drill"))
      this.app.toast("Soldering tools work on perfboard and stripboard — find them in the Workshop drawer, or open the “Solder your first circuit” example.");
    this.renderJoints();
  };

  /* -------------------------------------------------------- what's where */

  Workshop.prototype.solderHoleAt = function (x, y, r) {
    var b = this.app.bench, best = null, bd = r * r, self = this;
    var gx = Math.round(x / P * 2), gy = Math.round(y / P * 2);
    for (var dx = -2; dx <= 2; dx++) for (var dy = -2; dy <= 2; dy++) {
      (b.pinGrid[(gx + dx) + "," + (gy + dy)] || []).forEach(function (q) {
        if (!q.hole) return;
        var part = self.app.partById(q.part), d = part && L.def(part);
        if (!d || !d.solder) return;
        var dd = (q.x - x) * (q.x - x) + (q.y - y) * (q.y - y);
        if (dd < bd) { bd = dd; best = q; }
      });
    }
    return best;
  };
  /* Anything sitting in this hole: legs, and wire ends. */
  Workshop.prototype.occupants = function (hole) {
    var app = this.app, out = [], k = L.gridKey(hole.x, hole.y);
    (app.bench.pinGrid[k] || []).forEach(function (q) { if (!q.hole && q.part !== hole.part) out.push({ part: q.part, pin: q.name }); });
    app.doc.wires.forEach(function (w) {
      ["a", "b"].forEach(function (s) {
        var e = w[s], pos = app.bench.endPos(e);
        if ((e.ref === hole.key) || (Math.abs(pos.x - hole.x) < 1 && Math.abs(pos.y - hole.y) < 1)) out.push({ wire: w.id });
      });
    });
    return out;
  };
  /* A part that is soldered in can't simply be pulled out. */
  Workshop.prototype.stuck = function (part) {
    var app = this.app, joints = app.doc.joints || {}, d = L.def(part);
    if (!d || d.layer === "board") return false;
    var pins = L.pinsOf(part);
    for (var i = 0; i < pins.length; i++) {
      var list = app.bench.pinGrid[L.gridKey(pins[i].x, pins[i].y)] || [];
      for (var j = 0; j < list.length; j++) {
        var q = list[j];
        if (q.hole && joints[q.key] > 0 && L.def(app.partById(q.part)).solder) return true;
      }
    }
    return false;
  };

  /* --------------------------------------------------------- gestures */

  Workshop.prototype.down = function (e, wp) {
    var tool = this.app.bench.tool, app = this.app, now = performance.now() / 1000;
    this.ptr = wp;
    var r = Math.max(9, 12 / app.bench.cam.z);
    if (tool === "iron" || tool === "pump") {
      var h = this.solderHoleAt(wp.x, wp.y, r);
      if (!h) {
        var any = app.bench.pinAt(wp.x, wp.y, r);
        app.toast(any && any.hole ? "That's a breadboard — no solder needed there (and the iron would melt its plastic)." : "Touch the tip to a pad on a perfboard or stripboard.");
        return true;
      }
      if (tool === "pump" && !((app.doc.joints || {})[h.key] > 0)) { app.toast("There's no solder on that pad to suck up."); return true; }
      this.act = { tool: tool, key: h.key, hole: h, t0: now, x: h.x, y: h.y, bridged: false, existed: (app.doc.joints || {})[h.key] || 0 };
      app.sound(tool === "iron" ? "sizzle" : "pumpcock");
      return true;
    }
    if (tool === "hotair") { this.act = { tool: tool, t0: now, x: wp.x, y: wp.y }; this.melted = 0; return true; }
    if (tool === "cutter") { this.cut(wp, r); return true; }
    if (tool === "drill") { this.drill(wp, r); return true; }
    return false;
  };
  Workshop.prototype.move = function (e, wp) {
    this.ptr = wp;
    var a = this.act;
    if (!a) return;
    if (a.tool === "hotair") { a.x = wp.x; a.y = wp.y; return; }
    if (a.tool === "iron") {
      /* dragging a hot iron to the next pad pulls a solder bridge across */
      var h = this.solderHoleAt(wp.x, wp.y, Math.max(8, 10 / this.app.bench.cam.z));
      var now = performance.now() / 1000;
      if (h && h.key !== a.key && h.part === a.hole.part && Math.abs(h.x - a.x) + Math.abs(h.y - a.y) <= P + 1 && now - a.t0 >= 0.6) {
        var from = a.key, self = this;
        this.app.edit(function () {
          var d = self.app.doc;
          d.joints = d.joints || {}; d.bridges = d.bridges || [];
          d.joints[from] = 1; d.joints[h.key] = Math.max(d.joints[h.key] || 0, 1);
          if (!d.bridges.some(function (b) { return (b[0] === from && b[1] === h.key) || (b[1] === from && b[0] === h.key); })) d.bridges.push([from, h.key]);
        });
        a.key = h.key; a.hole = h; a.x = h.x; a.y = h.y; a.t0 = now - 0.6; a.bridged = true;
        this.app.sound("sizzle");
        if (!this.bridgeTold) { this.bridgeTold = true; this.app.toast("Solder bridge: those two pads are joined now. On perfboard that's how you make a connection — anywhere else it's a short."); }
      }
    }
  };
  Workshop.prototype.up = function () {
    var a = this.act, app = this.app, now = performance.now() / 1000, self = this;
    this.act = null;
    if (!a) return true;
    var held = now - a.t0;
    if (a.tool === "iron") {
      if (held < 0.2) return true;
      var q = held >= 0.6 ? 1 : Math.min(0.55, 0.25 + (held - 0.2) * 0.75);
      if (a.existed >= 0.6 && q < 0.6) q = a.existed;   /* a quick touch doesn't spoil a good joint */
      app.edit(function () { var d = app.doc; d.joints = d.joints || {}; d.joints[a.key] = q; });
      var occ = this.occupants(a.hole);
      if (q < 0.6) app.toast("Cold joint! You lifted the iron before the solder flowed. It looks dull and grainy and only connects some of the time. Hold the iron on it again to reflow it.");
      else if (!occ.length && !a.bridged && !this.blobTold) { this.blobTold = true; app.toast("A blob of solder on an empty pad. Fine for building a bridge — drag the iron from here to the next pad."); }
      if (held > 3) this.cook(occ, "the soldering iron", held);
      this.puff(a.x, a.y, 5);
      app.sound("tick");
    } else if (a.tool === "pump") {
      if (held < 0.25) { app.toast("Hold the sucker on the joint a moment — it has to melt first."); return true; }
      app.edit(function () {
        var d = app.doc;
        if (d.joints) delete d.joints[a.key];
        if (d.bridges) d.bridges = d.bridges.filter(function (b) { return b[0] !== a.key && b[1] !== a.key; });
      });
      for (var i = 0; i < 10; i++) this.fx.push({ k: "bead", x: a.x + (Math.random() - 0.5) * 10, y: a.y + (Math.random() - 0.5) * 10, tx: a.x, ty: a.y - 60, age: 0, life: 0.35 + Math.random() * 0.2 });
      app.sound("thwip");
    } else if (a.tool === "hotair") {
      if (this.melted) app.toast(this.melted + " joint" + (this.melted > 1 ? "s" : "") + " melted. The parts on them are loose — switch to Select (V) to lift them out.");
    }
    return true;
  };

  /* Too much heat for too long: the delicate parts in range are damaged. */
  Workshop.prototype.cook = function (occ, by, secs) {
    var app = this.app, hurt = [];
    occ.forEach(function (o) {
      if (!o.part) return;
      var p = app.partById(o.part);
      if (!p || !DELICATE[p.type]) return;
      var st = app.sim.state[p.id] = app.sim.state[p.id] || {};
      if (!st.burnt) { st.burnt = true; app.sim.event(p.id, "burn"); hurt.push(L.def(p).name.toLowerCase()); }
    });
    if (hurt.length) {
      app.toast("Too much heat — " + Math.round(secs) + " s of " + by + " cooked the " + hurt.join(" and ") + ". Heat travels up the legs. Be quick: in, flow, out.");
      app.sim.invalidate();
      app.panels.inspect(app.bench.sel);
    }
  };

  Workshop.prototype.cut = function (wp, r) {
    var app = this.app, b = app.bench, best = null, bd = (r * 1.2) * (r * 1.2);
    /* a component leg? */
    var pin = b.pinAt(wp.x, wp.y, r);
    if (pin && !pin.hole) {
      var part = app.partById(pin.part), d = L.def(part);
      if (d && d.layer !== "board" && !d.mcu) {
        if ((part.cutPins || []).indexOf(pin.name) >= 0) { app.toast("That leg is already cut."); return; }
        app.edit(function () { part.cutPins = (part.cutPins || []).concat([pin.name]); });
        this.snip(pin.x, pin.y);
        app.toast("Snipped the " + pin.label + " leg of the " + d.name.toLowerCase() + ". Undo (Ctrl+Z) if you didn't mean to.");
        return;
      }
    }
    /* a wire? find the closest point along any wire */
    app.doc.wires.forEach(function (w) {
      var info = b.wires[w.id];
      if (!info || w.cut) return;
      for (var i = 1; i < info.pts.length; i++) {
        var p0 = info.pts[i - 1], p1 = info.pts[i], dx = p1[0] - p0[0], dy = p1[1] - p0[1], l2 = dx * dx + dy * dy || 1;
        var t = L.clamp(((wp.x - p0[0]) * dx + (wp.y - p0[1]) * dy) / l2, 0, 1), x = p0[0] + dx * t, y = p0[1] + dy * t;
        var dd = (x - wp.x) * (x - wp.x) + (y - wp.y) * (y - wp.y);
        if (dd < bd) { bd = dd; best = { w: w, t: (info.len[i - 1] + (info.len[i] - info.len[i - 1]) * t) / (info.total || 1), x: x, y: y }; }
      }
    });
    if (best) {
      app.edit(function () { best.w.cut = L.clamp(Math.round(best.t * 1000) / 1000, 0.05, 0.95); });
      this.snip(best.x, best.y);
      return;
    }
    app.toast("Snip a wire, or the leg of a part.");
  };
  Workshop.prototype.snip = function (x, y) {
    for (var i = 0; i < 8; i++) {
      var a = Math.random() * Math.PI * 2, s = 60 + Math.random() * 120;
      this.fx.push({ k: "fleck", x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, age: 0, life: 0.5 });
    }
    this.app.sound("snip");
  };
  Workshop.prototype.drill = function (wp, r) {
    var app = this.app, h = this.solderHoleAt(wp.x, wp.y, r);
    var part = h && app.partById(h.part);
    if (!h || !L.def(part).strips) { app.toast("The track cutter is for stripboard: click a hole to break the copper strip there."); return; }
    var on = !((app.doc.cuts || {})[h.key]);
    app.edit(function () { var d = app.doc; d.cuts = d.cuts || {}; if (on) d.cuts[h.key] = 1; else delete d.cuts[h.key]; });
    for (var i = 0; i < 12; i++) {
      var a = Math.random() * Math.PI * 2, s = 30 + Math.random() * 70;
      this.fx.push({ k: "swarf", x: h.x, y: h.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, age: 0, life: 0.6, rot: Math.random() * 6 });
    }
    app.sound("drill");
    if (on && !this.drillTold) { this.drillTold = true; app.toast("Strip broken at that hole: the copper either side is no longer joined."); }
  };
  Workshop.prototype.puff = function (x, y, n) {
    for (var i = 0; i < n; i++) this.fx.push({ k: "smoke", x: x + (Math.random() - 0.5) * 6, y: y - 4, vx: (Math.random() - 0.5) * 14, vy: -24 - Math.random() * 18, age: 0, life: 1.4 + Math.random() * 0.6, r: 3 });
  };

  /* ------------------------------------------------------------ drawing */

  /* Joints, bridges, cuts and snipped legs, as SVG over the parts. */
  Workshop.prototype.renderJoints = function () {
    var app = this.app, b = app.bench, doc = app.doc;
    if (!b.lJoints) {
      b.lJoints = document.createElementNS(NS, "g");
      b.lJoints.setAttribute("class", "bench-joints");
      b.world.insertBefore(b.lJoints, b.lWires);
      var defs = b.svg.querySelector("defs");
      defs.insertAdjacentHTML("beforeend",
        '<radialGradient id="lab-solder" cx=".35" cy=".3" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#dfe4e8"/><stop offset="1" stop-color="#8b949b"/></radialGradient>' +
        '<radialGradient id="lab-solder-cold" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#b9b8ae"/><stop offset="1" stop-color="#6f6e66"/></radialGradient>');
    }
    var s = "", joints = doc.joints || {}, cuts = doc.cuts || {}, all = b.pinAll || {};
    Object.keys(cuts).forEach(function (k) {
      var q = all[k]; if (!q) return;
      s += '<circle cx="' + q.x + '" cy="' + q.y + '" r="7.5" fill="#b08a55"/><circle cx="' + q.x + '" cy="' + q.y + '" r="5.5" fill="#8f6a3a"/><circle cx="' + q.x + '" cy="' + q.y + '" r="2.6" fill="#2a1d10"/>';
    });
    (doc.bridges || []).forEach(function (br) {
      var a = all[br[0]], c = all[br[1]]; if (!a || !c) return;
      s += '<path d="M' + a.x + ' ' + a.y + 'L' + c.x + ' ' + c.y + '" stroke="#8b949b" stroke-width="11" stroke-linecap="round"/>' +
           '<path d="M' + a.x + ' ' + a.y + 'L' + c.x + ' ' + c.y + '" stroke="#d7dce0" stroke-width="7.5" stroke-linecap="round"/>' +
           '<path d="M' + a.x + ' ' + (a.y - 1.5) + 'L' + c.x + ' ' + (c.y - 1.5) + '" stroke="#fff" stroke-opacity=".6" stroke-width="2" stroke-linecap="round"/>';
    });
    Object.keys(joints).forEach(function (k) {
      var q = all[k], v = joints[k]; if (!q || !(v > 0)) return;
      if (v >= 0.6) {
        s += '<circle cx="' + q.x + '" cy="' + q.y + '" r="7.2" fill="url(#lab-solder)" stroke="#7d868c" stroke-width=".8"/>' +
             '<ellipse cx="' + (q.x - 2.2) + '" cy="' + (q.y - 2.6) + '" rx="2.2" ry="1.4" fill="#fff" opacity=".9"/>';
      } else {
        /* cold: lumpy, dull, with a crack */
        var d = "", n = 9;
        for (var i = 0; i <= n; i++) {
          var a2 = i / n * Math.PI * 2, rr = 6 + ((i * 7 + q.x) % 3) * 0.9;
          d += (i ? "L" : "M") + (q.x + Math.cos(a2) * rr).toFixed(1) + " " + (q.y + Math.sin(a2) * rr).toFixed(1);
        }
        s += '<path d="' + d + 'z" fill="url(#lab-solder-cold)" stroke="#5c5b55" stroke-width=".8"/>' +
             '<path d="M' + (q.x - 3) + ' ' + (q.y - 1) + 'l2.5 1.5l1.5 -2l2 2" stroke="#4a4944" stroke-width="1" fill="none"/>' +
             '<circle cx="' + (q.x + 2) + '" cy="' + (q.y + 2) + '" r=".9" fill="#55544e"/><circle cx="' + (q.x - 2.5) + '" cy="' + (q.y + 2.5) + '" r=".7" fill="#55544e"/>';
      }
    });
    /* legs that are through a pad but not soldered yet: a dashed amber ring */
    doc.parts.forEach(function (p) {
      var d = L.def(p);
      if (!d || !d.solder) return;
      L.pinsOf(p).forEach(function (h) {
        if (joints[h.key] > 0) return;
        var occ = (b.pinGrid[L.gridKey(h.x, h.y)] || []).some(function (q) { return !q.hole; }) ||
                  doc.wires.some(function (w) { return ["a", "b"].some(function (sd) { var e = b.endPos(w[sd]); return Math.abs(e.x - h.x) < 1 && Math.abs(e.y - h.y) < 1; }); });
        if (occ) s += '<circle cx="' + h.x + '" cy="' + h.y + '" r="8.5" fill="none" stroke="#ffb02e" stroke-width="1.8" stroke-dasharray="3 2.4" class="needs-solder"/>';
      });
    });
    /* snipped legs */
    doc.parts.forEach(function (p) {
      (p.cutPins || []).forEach(function (nm) {
        var q = all[p.id + ":" + nm]; if (!q) return;
        var w = L.xform(0, -9, p.rot, p.flip);
        s += '<path d="M' + (q.x + w[0] - 4) + ' ' + (q.y + w[1]) + 'l8 0" stroke="#e8553d" stroke-width="2.5" stroke-linecap="round"/>' +
             '<circle cx="' + (q.x + w[0] * 0.55) + '" cy="' + (q.y + w[1] * 0.55) + '" r="2" fill="#d98a4e"/>';
      });
    });
    b.lJoints.innerHTML = s;
  };

  /* Every frame: the tool under the pointer, heat, and its effects. */
  Workshop.prototype.frame = function (ctx, dt) {
    var app = this.app, b = app.bench, z = b.cam.z, tool = b.tool, a = this.act, now = performance.now() / 1000, self = this;
    /* hot air at work */
    if (a && a.tool === "hotair") {
      var R = 2.4 * P, joints = app.doc.joints || {}, changed = false;
      Object.keys(joints).forEach(function (k) {
        var q = b.pinAll[k]; if (!q) return;
        if (Math.hypot(q.x - a.x, q.y - a.y) > R) { self.heat[k] = Math.max(0, (self.heat[k] || 0) - dt); return; }
        self.heat[k] = (self.heat[k] || 0) + dt;
        if (self.heat[k] > 1.1) { delete joints[k]; delete self.heat[k]; changed = true; self.melted = (self.melted || 0) + 1; }
      });
      if (changed) {
        app.doc.bridges = (app.doc.bridges || []).filter(function (br) { return joints[br[0]] && joints[br[1]]; });
        app.sim.invalidate(); app.changed(); this.renderJoints(); app.sound("tick");
      }
      app.doc.parts.forEach(function (p) {
        if (!DELICATE[p.type]) return;
        var bx = L.boxOf(p), cx = bx.x + bx.w / 2, cy = bx.y + bx.h / 2;
        if (Math.hypot(cx - a.x, cy - a.y) > R + Math.max(bx.w, bx.h) / 2) return;
        self.partHeat[p.id] = (self.partHeat[p.id] || 0) + dt;
        if (self.partHeat[p.id] > 4) { self.partHeat[p.id] = -99; self.cook([{ part: p.id }], "hot air", 4); }
      });
      /* the plume: a hot spot that grows the longer you hold, a shimmering
       * edge, and every joint in range glowing as it comes up to melting */
      var warm = Math.min(1, (now - a.t0) / 1.1);
      ctx.globalCompositeOperation = "lighter";
      var g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, R);
      g.addColorStop(0, "rgba(255,190,90," + (0.35 + 0.4 * warm).toFixed(2) + ")");
      g.addColorStop(0.55, "rgba(255,110,30," + (0.2 + 0.3 * warm).toFixed(2) + ")");
      g.addColorStop(1, "rgba(255,70,20,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(a.x, a.y, R, 0, 7); ctx.fill();
      ctx.strokeStyle = "rgba(255,150,70," + (0.25 + 0.25 * Math.sin(now * 18)).toFixed(2) + ")"; ctx.lineWidth = 2 / z;
      ctx.beginPath(); ctx.arc(a.x, a.y, R * (0.92 + 0.05 * Math.sin(now * 11)), 0, 7); ctx.stroke();
      Object.keys(self.heat).forEach(function (k) {
        var q = b.pinAll[k], h = Math.min(1, self.heat[k] / 1.1); if (!q || !h) return;
        var jg = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, 10 + 6 * h);
        jg.addColorStop(0, "rgba(255,245,220," + (0.4 + 0.6 * h).toFixed(2) + ")"); jg.addColorStop(1, "rgba(255,140,50,0)");
        ctx.fillStyle = jg; ctx.beginPath(); ctx.arc(q.x, q.y, 16, 0, 7); ctx.fill();
      });
      for (var w = 0; w < 4; w++) this.fx.push({ k: "air", x: a.x + (Math.random() - 0.5) * 22, y: a.y - 60 / z, vx: (Math.random() - 0.5) * 60, vy: 180 + Math.random() * 60, age: 0, life: 0.5 });
      ctx.globalCompositeOperation = "source-over";
    }
    /* molten joints glow */
    if (a && a.tool === "iron") {
      var held = now - a.t0, f = Math.min(1, held / 0.6);
      ctx.globalCompositeOperation = "lighter";
      var gl = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, 14 + 10 * f);
      gl.addColorStop(0, "rgba(255,240,210," + (0.5 + 0.4 * f).toFixed(2) + ")"); gl.addColorStop(1, "rgba(255,150,60,0)");
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(a.x, a.y, 24, 0, 7); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      /* the solder flowing in: a growing silver bead */
      if (held > 0.2) {
        var rr = 2 + 5 * Math.min(1, (held - 0.2) / 0.4);
        ctx.fillStyle = "#e6eaee"; ctx.beginPath(); ctx.arc(a.x, a.y, rr, 0, 7); ctx.fill();
      }
      /* progress ring: amber until the joint is good, green after, red when it's too long */
      ctx.strokeStyle = held > 3 ? "#ff5a4a" : held >= 0.6 ? "#5bd88a" : "#ffb02e";
      ctx.lineWidth = 3 / z;
      ctx.beginPath(); ctx.arc(a.x, a.y, 15, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, held / 0.6)); ctx.stroke();
      if (held > 0.15 && Math.random() < dt * 12) this.puff(a.x, a.y, 1);
      if (held > 0.3 && !a.sizzled) { a.sizzled = true; app.sound("sizzle"); }
      if (held > 3 && !a.warned) { a.warned = true; app.sound("err"); }
    }
    if (a && a.tool === "pump") {
      var hp = Math.min(1, (now - a.t0) / 0.25);
      ctx.fillStyle = "rgba(230,234,238," + (1 - hp * 0.6).toFixed(2) + ")"; ctx.beginPath(); ctx.arc(a.x, a.y, 6 * (1 - hp * 0.4), 0, 7); ctx.fill();
    }
    /* particles */
    this.fx = this.fx.filter(function (p) {
      p.age += dt;
      if (p.age > p.life) return false;
      var t = p.age / p.life;
      if (p.k === "smoke") {
        p.x += p.vx * dt; p.y += p.vy * dt; p.r += 10 * dt;
        ctx.fillStyle = "rgba(220,225,230," + (0.28 * (1 - t)).toFixed(3) + ")"; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      } else if (p.k === "fleck" || p.k === "swarf") {
        p.vy += 300 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.fillStyle = p.k === "fleck" ? "rgba(217,138,78," + (1 - t).toFixed(2) + ")" : "rgba(230,150,80," + (1 - t).toFixed(2) + ")";
        ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, p.k === "swarf" ? 1.6 : 3);
      } else if (p.k === "bead") {
        var e2 = t * t;
        ctx.fillStyle = "rgba(225,230,235," + (1 - t).toFixed(2) + ")"; ctx.beginPath(); ctx.arc(p.x + (p.tx - p.x) * e2, p.y + (p.ty - p.y) * e2, 2.2, 0, 7); ctx.fill();
      } else if (p.k === "air") {
        p.x += p.vx * dt; p.y += p.vy * dt;
        ctx.strokeStyle = "rgba(255,180,100," + (0.7 * (1 - t)).toFixed(2) + ")"; ctx.lineWidth = 2.2 / z;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.quadraticCurveTo(p.x + 4, p.y + 6, p.x, p.y + 12); ctx.stroke();
      }
      return true;
    });
    /* the tool itself, at the pointer */
    if (tool && this.ptr) this.drawTool(ctx, tool, this.ptr.x, this.ptr.y, z, !!a);
  };

  Workshop.prototype.drawTool = function (ctx, tool, x, y, z, busy) {
    var k = 1 / Math.max(0.45, z);
    ctx.save();
    ctx.translate(x, y); ctx.scale(k, k);
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 10; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 6;
    if (tool === "iron") {
      ctx.rotate(-0.8);
      ctx.fillStyle = busy ? "#ffb070" : "#9aa3ab"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-3, -16); ctx.lineTo(3, -16); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#c9ced3"; ctx.fillRect(-4, -46, 8, 30);
      ctx.fillStyle = "#2b63d6"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-7, -110, 14, 64, 6) : ctx.rect(-7, -110, 14, 64); ctx.fill();
      ctx.fillStyle = "#1d438c"; for (var i = 0; i < 5; i++) ctx.fillRect(-7, -100 + i * 11, 14, 3);
      ctx.fillStyle = "#222"; ctx.fillRect(-2, -130, 4, 20);
      if (busy) { ctx.shadowBlur = 0; ctx.fillStyle = "rgba(255,140,40,.9)"; ctx.beginPath(); ctx.arc(0, -2, 3, 0, 7); ctx.fill(); }
    } else if (tool === "pump") {
      ctx.fillStyle = "#e9eef2"; ctx.beginPath(); ctx.moveTo(-2, 0); ctx.lineTo(2, 0); ctx.lineTo(4, -12); ctx.lineTo(-4, -12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#c7cdd2"; ctx.fillRect(-9, -82, 18, 70);
      ctx.fillStyle = "#3d7fe0"; ctx.fillRect(-9, -82, 18, 10);
      ctx.fillStyle = "#555"; ctx.fillRect(-2, -102 + (busy ? 16 : 0), 4, 22);
      ctx.fillStyle = "#e0503a"; ctx.fillRect(-7, -108 + (busy ? 16 : 0), 14, 7);
    } else if (tool === "hotair") {
      ctx.fillStyle = "#9aa3ab"; ctx.fillRect(-6, -30, 12, 22);
      ctx.fillStyle = "#3a3f44"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-14, -96, 28, 68, 8) : ctx.rect(-14, -96, 28, 68); ctx.fill();
      ctx.fillStyle = "#e8553d"; ctx.fillRect(-14, -50, 28, 6);
      ctx.fillStyle = "#222"; ctx.fillRect(-3, -120, 6, 26);
      if (busy) { ctx.shadowBlur = 0; ctx.fillStyle = "rgba(255,140,60,.8)"; ctx.fillRect(-6, -9, 12, 3); }
    } else if (tool === "cutter") {
      ctx.rotate(-0.5);
      ctx.fillStyle = "#c9ced3"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-7, -18); ctx.lineTo(7, -18); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#d63a2f"; ctx.lineWidth = 8; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-4, -20); ctx.lineTo(-16, -80); ctx.moveTo(4, -20); ctx.lineTo(16, -80); ctx.stroke();
    } else if (tool === "drill") {
      ctx.strokeStyle = "#d98a4e"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 8, 0, 7); ctx.stroke();
      ctx.fillStyle = "#c9ced3"; ctx.fillRect(-3, -40, 6, 32);
      ctx.fillStyle = "#e0b84a"; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(-8, -80, 16, 40, 5) : ctx.rect(-8, -80, 16, 40); ctx.fill();
    }
    ctx.restore();
  };

  /* ============================================================ EXAMPLE */

  L.EXAMPLES.push({
    id: "solder_kit", mode: "pro", name: "Solder your first circuit", level: "Workshop",
    blurb: "Every leg is pushed through the stripboard but nothing is soldered — see the amber rings. Pick the soldering iron (top left of the bench) and hold it on each ring for about a second. Then power on. A cold joint will flicker.",
    build: function () {
      var B = new L.Builder("pro"), sb = B.add("stripboard", 0, 0);
      var bat = B.on(sb, "battery_9v", "h2_2", {}, 0, "+");
      B.on(sb, "resistor", "h6_2", { ohms: 470 }, 1, "1");
      B.on(sb, "led", "h10_6", { color: "red" }, 1, "A");
      B.wire([sb, "h14_7"], [sb, "h14_3"], L.WIRE_COLORS.black);
      return B.doc;
    },
    code: null
  });
})(typeof window !== "undefined" ? window : globalThis);
