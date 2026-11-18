/* Chalk Circuit Lab — the board studio's engine.
 *
 * lab_pcb.js made the bench's circuit into a rectangle of copper. This is
 * the rest of a real board tool, on the same document:
 *
 *   shape      any outline: rounded rectangles, circles, hexagons, a heart,
 *              a polygon you draw point by point, Arduino-shield and
 *              Raspberry Pi HAT outlines — and cut-outs inside it
 *   packages   every bench part can wear a real package (a 555 as DIP-8 or
 *              SOIC-8, a resistor as 0805), and parts that exist only on
 *              the board — USB-C, HDMI, RJ45, headers, test points — come
 *              from the footprint library (lab_fp.js)
 *   holes      single holes, mounting holes and hole patterns: a grid of
 *              prototyping holes, a bolt circle, a row; plated or bare
 *   copper     tracks you draw yourself on either side, tracks the router
 *              draws, vias, and copper pours (a ground plane)
 *   nets       the circuit's own connections, plus board-only links you
 *              draw between pads and net labels (call a pad GND and it
 *              joins every other GND)
 *   checks     a design-rule check: gaps, shorts, the edge, drills,
 *              annular rings, overlapping parts, unrouted connections
 *   out        Gerber X2 + Excellon (plated and bare) with real pad shapes,
 *              solder paste, both silkscreens; pick-and-place; parts list
 *              with packages; a KiCad board (.kicad_pcb) and every
 *              footprint as .kicad_mod; SVG; the whole design as JSON
 *
 * doc.pcb v2 keeps every v1 field (an old board opens as it was) and adds:
 *   shape {kind: rect|circle|poly, pts}, cut [{kind, x, y, w, h | d | pts}],
 *   items [{id, kind: fp|hole|array|text|zone|keepout, …}], links [{a, b}],
 *   labels {padKey: net}, rules {track, power, clear, via, viaDrill, edge,
 *   grid}, place[id].fp / .side, tracks[].man (drawn by hand, kept when
 *   re-routing). Lengths are millimetres from the board's top-left corner.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  if (!L || !L.PCB || !L.FP) return;
  var PCB = L.PCB, FP = L.FP, MM = PCB.MM;
  var X = L.PCBX = {};
  function r3(v) { return Math.round(v * 1000) / 1000; }
  function hyp(x, y) { return Math.sqrt(x * x + y * y); }

  X.RULES = { track: 0.3, power: 0.6, clear: 0.2, via: 0.8, viaDrill: 0.4, edge: 0.5, grid: 0.635, minDrill: 0.3, minTrack: 0.15, ring: 0.15 };
  X.rules = function (pcb) { var r = {}, k, own = (pcb && pcb.rules) || {}; for (k in X.RULES) r[k] = own[k] != null && isFinite(own[k]) ? +own[k] : X.RULES[k]; return r; };
  X.uid = function (pre) { return (pre || "b") + Math.random().toString(36).slice(2, 8); };

  /* Bring any board up to v2: nothing is lost, only filled in. */
  X.upgrade = function (pcb) {
    if (!pcb) return pcb;
    pcb.v = 2;
    pcb.place = pcb.place || {}; pcb.tracks = pcb.tracks || []; pcb.vias = pcb.vias || []; pcb.open = pcb.open || [];
    pcb.items = Array.isArray(pcb.items) ? pcb.items : [];
    pcb.links = Array.isArray(pcb.links) ? pcb.links : [];
    pcb.labels = pcb.labels && typeof pcb.labels === "object" ? pcb.labels : {};
    pcb.cut = Array.isArray(pcb.cut) ? pcb.cut : [];
    if (!pcb.shape) pcb.shape = { kind: "rect" };
    return pcb;
  };

  /* ============================================================ OUTLINE */

  function circlePts(cx, cy, r, n) { var out = []; for (var i = 0; i < n; i++) { var a = i / n * Math.PI * 2; out.push([r3(cx + r * Math.cos(a)), r3(cy + r * Math.sin(a))]); } return out; }
  /* The board's edge as one closed polygon (last point = first). */
  X.outline = function (pcb) {
    var s = pcb.shape || { kind: "rect" }, pts;
    if (s.kind === "circle") pts = circlePts(pcb.w / 2, pcb.h / 2, Math.min(pcb.w, pcb.h) / 2, 72);
    else if (s.kind === "poly" && Array.isArray(s.pts) && s.pts.length >= 3) pts = s.pts.map(function (p) { return [p[0], p[1]]; });
    else return PCB.outline(pcb, 8);
    pts.push(pts[0]);
    return pts;
  };
  /* Cut-outs, each a closed polygon. */
  X.cutouts = function (pcb) {
    return (pcb.cut || []).map(function (c) {
      var pts;
      if (c.kind === "circle") pts = circlePts(c.x, c.y, c.d / 2, 36);
      else if (c.kind === "poly" && c.pts && c.pts.length >= 3) pts = c.pts.map(function (p) { return [p[0], p[1]]; });
      else { var r = Math.min(c.r || 0, c.w / 2, c.h / 2); pts = PCB.outline({ w: c.w, h: c.h, r: r }, 6).slice(0, -1).map(function (p) { return [r3(p[0] + c.x), r3(p[1] + c.y)]; }); }
      pts.push(pts[0]);
      return pts;
    });
  };
  function inPoly(pts, x, y) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  X.inPoly = inPoly;
  function segDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return hyp(px - ax - t * dx, py - ay - t * dy);
  }
  X.segDist = segDist;
  function polyDist(pts, x, y) { var d = 1e9; for (var i = 1; i < pts.length; i++) d = Math.min(d, segDist(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])); return d; }
  /* On the board, and not in a cut-out. */
  X.onBoard = function (pcb, x, y, ol, cuts) {
    ol = ol || X.outline(pcb); cuts = cuts || X.cutouts(pcb);
    if (!inPoly(ol, x, y)) return false;
    for (var i = 0; i < cuts.length; i++) if (inPoly(cuts[i], x, y)) return false;
    return true;
  };
  X.area = function (pts) { var a = 0; for (var i = 1; i < pts.length; i++) a += pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1]; return Math.abs(a) / 2; };

  /* Ready-made shapes. Holes and headers come with the ones that need them. */
  var PI_GPIO = ["3V3", "5V", "GPIO2/SDA", "5V", "GPIO3/SCL", "GND", "GPIO4", "GPIO14/TXD", "GND", "GPIO15/RXD", "GPIO17", "GPIO18", "GPIO27", "GND", "GPIO22", "GPIO23", "3V3", "GPIO24", "GPIO10/MOSI", "GND",
    "GPIO9/MISO", "GPIO25", "GPIO11/SCLK", "GPIO8/CE0", "GND", "GPIO7/CE1", "ID_SD", "ID_SC", "GPIO5", "GND", "GPIO6", "GPIO12", "GPIO13", "GND", "GPIO19", "GPIO16", "GPIO26", "GPIO20", "GND", "GPIO21"];
  X.PI_GPIO = PI_GPIO;
  function heart(w) {
    var pts = [];
    for (var i = 0; i < 64; i++) {
      var t = i / 64 * Math.PI * 2, x = 16 * Math.pow(Math.sin(t), 3), y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
      pts.push([x, y]);
    }
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; }), x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys), k = w / (Math.max.apply(null, xs) - x0);
    return pts.map(function (p) { return [r3((p[0] - x0) * k), r3((p[1] - y0) * k)]; });
  }
  X.PRESETS = [
    { id: "rect", name: "Rectangle", blurb: "Rounded corners, any size", make: function (pcb) { return { shape: { kind: "rect" }, w: pcb.w, h: pcb.h, r: pcb.r == null ? 3 : pcb.r }; } },
    { id: "circle", name: "Circle", blurb: "50 mm round — badges, rings of LEDs", make: function () { return { shape: { kind: "circle" }, w: 50, h: 50, r: 0 }; } },
    { id: "hex", name: "Hexagon", blurb: "Tiles together, 50 mm across", make: function () { var p = []; for (var i = 0; i < 6; i++) { var a = Math.PI / 6 + i * Math.PI / 3; p.push([r3(25 * Math.cos(a) * 1.0 + 21.651), r3(25 * Math.sin(a) + 25)]); } return { shape: { kind: "poly", pts: p }, w: 43.302, h: 50, r: 0 }; } },
    { id: "heart", name: "Heart", blurb: "A 55 mm heart — an LED badge", make: function () { var p = heart(55), ys = p.map(function (q) { return q[1]; }); return { shape: { kind: "poly", pts: p }, w: 55, h: r3(Math.max.apply(null, ys)), r: 0 }; } },
    { id: "badge", name: "Shield badge", blurb: "A crest with a point at the bottom", make: function () { return { shape: { kind: "poly", pts: [[0, 0], [45, 0], [45, 32], [38, 44], [22.5, 55], [7, 44], [0, 32]] }, w: 45, h: 55, r: 0 }; } },
    { id: "card", name: "Credit card", blurb: "85.6 × 54 mm, fits a wallet", make: function () { return { shape: { kind: "rect" }, w: 85.6, h: 53.98, r: 3.18 }; } },
    { id: "arduino", name: "Arduino Uno shield", blurb: "Uno outline and its four holes", make: function () {
      return { shape: { kind: "poly", pts: [[0, 0], [66.04, 0], [68.58, 2.54], [68.58, 37.85], [66.04, 40.39], [66.04, 53.34], [0, 53.34]] }, w: 68.58, h: 53.34, r: 0,
        items: [[13.97, 50.8], [15.24, 2.54], [66.04, 45.72], [66.04, 17.78]].map(function (q) { return { kind: "hole", x: q[0], y: q[1], d: 3.2, plated: false }; }) };
    } },
    { id: "pihat", name: "Raspberry Pi HAT", blurb: "65 × 56.5 mm with the 40-pin header", make: function () { return pi(56.5); } },
    { id: "pizero", name: "Pi Zero pHAT", blurb: "65 × 30 mm with the 40-pin header", make: function () { return pi(30); } },
    { id: "feather", name: "Feather wing", blurb: "50.8 × 22.86 mm", make: function () { return { shape: { kind: "rect" }, w: 50.8, h: 22.86, r: 2.54 }; } },
    { id: "euro", name: "Eurocard", blurb: "160 × 100 mm, for a rack", make: function () { return { shape: { kind: "rect" }, w: 160, h: 100, r: 1 }; } }
  ];
  function pi(h) {
    var labels = {}, id = "pihdr";
    /* one of each supply pin is enough to join the board's own nets */
    PI_GPIO.forEach(function (n, i) { if (!/^(GND|3V3|5V)$/.test(n)) labels[id + ":" + (i + 1)] = n.split("/")[0]; });
    labels[id + ":1"] = "+3V3"; labels[id + ":2"] = "+5V"; labels[id + ":6"] = "GND";
    return { shape: { kind: "rect" }, w: 65, h: h, r: 3,
      items: [[3.5, 3.5], [61.5, 3.5], [3.5, h - 3.5], [61.5, h - 3.5]].map(function (q) { return { kind: "hole", x: q[0], y: q[1], d: 2.75, plated: false }; })
        .concat([{ kind: "fp", id: id, fp: "HDR-2x20-2.54", x: 32.5, y: 3.5, rot: 1, ref: "J1", value: "Pi GPIO", names: PI_GPIO }]),
      labels: labels };
  }
  /* Put a preset on the board. Everything already there moves with the
   * board's middle, so a layout survives a change of shape. */
  X.applyPreset = function (doc, id) {
    var pcb = X.upgrade(doc.pcb), p = X.PRESETS.filter(function (q) { return q.id === id; })[0];
    if (!p) return false;
    var o = p.make(pcb), dx = r3((o.w - pcb.w) / 2), dy = r3((o.h - pcb.h) / 2);
    X.shift(pcb, dx, dy);
    pcb.shape = o.shape; pcb.w = o.w; pcb.h = o.h; pcb.r = o.r;
    (o.items || []).forEach(function (it) {
      if (it.id) pcb.items = pcb.items.filter(function (q) { return q.id !== it.id; });
      it.id = it.id || X.uid("h");
      pcb.items.push(it);
    });
    if (o.labels) Object.keys(o.labels).forEach(function (k) { pcb.labels[k] = o.labels[k]; });
    pcb.holes = id === "rect" || id === "card" || id === "feather" || id === "euro" ? pcb.holes : false;
    pcb.tracks = pcb.tracks.filter(function (t) { return t.man; }); pcb.vias = pcb.vias.filter(function (v) { return v[3]; }); pcb.open = [];
    return true;
  };
  /* Move everything on the board by (dx, dy). */
  X.shift = function (pcb, dx, dy) {
    if (!dx && !dy) return;
    var mv = function (p) { p[0] = r3(p[0] + dx); p[1] = r3(p[1] + dy); };
    Object.keys(pcb.place).forEach(function (k) { pcb.place[k].x = r3(pcb.place[k].x + dx); pcb.place[k].y = r3(pcb.place[k].y + dy); });
    pcb.tracks.forEach(function (t) { t.pts.forEach(mv); });
    pcb.vias.forEach(mv);
    pcb.open = [];
    (pcb.items || []).forEach(function (it) { if (it.x != null) { it.x = r3(it.x + dx); it.y = r3(it.y + dy); } if (it.pts && it.pts !== "board") it.pts.forEach(mv); });
    (pcb.cut || []).forEach(function (c) { if (c.x != null) { c.x = r3(c.x + dx); c.y = r3(c.y + dy); } if (c.pts) c.pts.forEach(mv); });
  };
  /* After the outline is edited by hand: the board's box starts at 0, 0. */
  X.normalize = function (pcb) {
    if (!pcb.shape || pcb.shape.kind !== "poly") return;
    var xs = pcb.shape.pts.map(function (p) { return p[0]; }), ys = pcb.shape.pts.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys);
    pcb.shape.pts.forEach(function (p) { p[0] = r3(p[0] - x0); p[1] = r3(p[1] - y0); });
    X.shift(pcb, -x0, -y0);
    pcb.w = r3(Math.max.apply(null, xs) - x0); pcb.h = r3(Math.max.apply(null, ys) - y0);
  };

  /* ========================================================= FOOTPRINTS */

  var BODY_Z = { Power: 6, Passive: 3, "Lights & sound": 8, Switches: 5, Semiconductors: 4.5, Chips: 3.6, Sensors: 4, Motion: 10, Boards: 1.6, Advanced: 4 };
  /* A bench part's own footprint, its legs as pads — what v1 made. */
  function benchFp(part) {
    var d = L.def(part), v1 = PCB.footprint(part), f = { id: "bench:" + part.type, name: (d.name || part.type) + (v1.off ? " (wire pads)" : ""), ref: L.refPrefix(part.type), pads: [], holes: [], silk: [], pins: {} };
    v1.pads.forEach(function (q, i) { f.pads.push({ n: q.n, x: r3(q.x), y: r3(q.y), shape: i ? "circle" : "rect", w: 1.7, h: 1.7, drill: 0.9 }); });
    var b = v1.box;
    f.silk.push({ l: [b.x, b.y, b.x + b.w, b.y] }, { l: [b.x + b.w, b.y, b.x + b.w, b.y + b.h] }, { l: [b.x + b.w, b.y + b.h, b.x, b.y + b.h] }, { l: [b.x, b.y + b.h, b.x, b.y] });
    f.body = v1.off ? null : { x: r3(b.x + b.w / 2), y: r3(b.y + b.h / 2), w: r3(Math.max(1, b.w - 0.4)), h: r3(Math.max(1, b.h - 0.4)), z: BODY_Z[d.cat] || 4, shape: "box", color: d.cat === "Boards" ? "#0e7a83" : "#2b3a4a", look: d.cat === "Boards" ? "module" : "bench", type: part.type };
    /* for the 3-D view: the real thing's body (a resistor's rod, an LED's dome,
     * a DIP chip) when a through-hole package with the same legs exists */
    if (f.body) {
      var like = (FP.SUGGEST[part.type] || []).map(FP.get).filter(function (g) { return g && g.kind === "tht" && g.body && g.pads.length === f.pads.length; })[0];
      if (like) {
        var cx = 0, cy = 0, lx = 0, ly = 0;
        f.pads.forEach(function (q) { cx += q.x / f.pads.length; cy += q.y / f.pads.length; });
        like.pads.forEach(function (q) { lx += q.x / like.pads.length; ly += q.y / like.pads.length; });
        var span = function (list) { var xs = list.map(function (q) { return q.x; }), ys = list.map(function (q) { return q.y; }); return [Math.max.apply(null, xs) - Math.min.apply(null, xs), Math.max.apply(null, ys) - Math.min.apply(null, ys)]; };
        var sa = span(f.pads), sb = span(like.pads), turned = Math.abs(sa[0] - sb[1]) + Math.abs(sa[1] - sb[0]) < Math.abs(sa[0] - sb[0]) + Math.abs(sa[1] - sb[1]) - 0.5;
        var lb = like.body, bx = lb.x - lx, by = lb.y - ly;
        f.body = { x: r3(cx + (turned ? by : bx)), y: r3(cy + (turned ? bx : by)), w: turned ? lb.h : lb.w, h: turned ? lb.w : lb.h, z: lb.z, shape: lb.shape, color: lb.color, look: lb.look, led: lb.led, type: part.type };
        if (part.type === "led" && L.LED_COLORS) { var lc = L.LED_COLORS[(part.props || {}).color] || L.LED_COLORS.red; f.body.color = lc.fill; }
      }
    }
    FP.finish(f, f.id);
    f.off = v1.off;
    return f;
  }
  /* What a bench part wears on the board, and which of its pins each pad is. */
  X.fpOf = function (part, pl) {
    var d = L.def(part), pins = L.pinList(part).filter(function (q) { return !q.hole; }).map(function (q) { return q.n; }), fp, keyOf = {}, src = "bench";
    var want = pl && pl.fp;
    if (want && FP.get(want) && want.indexOf("bench:") !== 0) {
      fp = FP.clone(FP.get(want)); src = "lib";
      var preset = FP.PARTS.filter(function (p) { return p.bench === part.type && p.fp === want; })[0];
      var pm = FP.pinMap(pins, fp, preset && preset.map);
      var padTo = {};
      Object.keys(pm).forEach(function (pin) { padTo[pm[pin]] = pin; });
      fp.pads.forEach(function (q) { keyOf[q.n] = padTo[q.n] != null ? part.id + ":" + padTo[q.n] : part.id + ":#" + q.n; if (padTo[q.n] != null && !q.name) q.name = padTo[q.n]; });
      fp.unmapped = pins.filter(function (p) { return pm[p] == null; });
    } else if (d && d.fpData) {
      fp = FP.clone(d.fpData); src = "custom";
      fp.pads.forEach(function (q) { keyOf[q.n] = pins.indexOf(q.n) >= 0 ? part.id + ":" + q.n : part.id + ":#" + q.n; });
    } else {
      fp = benchFp(part);
      fp.pads.forEach(function (q) { keyOf[q.n] = part.id + ":" + q.n; });
    }
    return { fp: fp, keyOf: keyOf, src: src };
  };
  /* Packages that fit a bench part, best first, and the one it wears now. */
  X.packages = function (part) {
    var d = L.def(part), n = L.pinList(part).filter(function (q) { return !q.hole; }).length;
    var list = FP.suggest(part.type, n).slice();
    FP.LIB.forEach(function (f) {
      if (list.indexOf(f.id) >= 0) return;
      var uniq = {}; f.pads.forEach(function (p) { uniq[p.n] = 1; });
      if (Object.keys(uniq).length === n && !/^Mount|^Fid|^TestPoint/.test(f.id)) list.push(f.id);
    });
    return list.slice(0, 40);
  };

  /* Turn a footprint point into board coordinates. */
  X.xf = function (pl, x, y) {
    var w = L.xform(pl.side === "bottom" ? -x : x, y, pl.rot || 0, false);
    return [r3(pl.x + w[0]), r3(pl.y + w[1])];
  };
  X.courtOf = function (fp, pl) {
    var c = fp.court, pts = [[c.x0, c.y0], [c.x1, c.y0], [c.x1, c.y1], [c.x0, c.y1]].map(function (q) { return X.xf(pl, q[0], q[1]); });
    var xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; });
    return { x0: Math.min.apply(null, xs), y0: Math.min.apply(null, ys), x1: Math.max.apply(null, xs), y1: Math.max.apply(null, ys) };
  };

  /* ============================================================== MODEL */

  /* Everything that has copper on the board, and how it is all connected:
   * the circuit's nets, board-only links and net labels together. */
  X.model = function (doc, sim) {
    var pcb = X.upgrade(doc.pcb || PCB.blank()), ref = L.refdes(doc), items = [], index = {}, keys = {}, counts = {};
    Object.keys(ref).forEach(function (id) { var m = /^([A-Z]+)(\d+)$/.exec(ref[id]); if (m) counts[m[1]] = Math.max(counts[m[1]] || 0, +m[2]); });
    var add = function (it) { items.push(it); index[it.id] = it; it.fp.pads.forEach(function (q) { var k = it.keyOf[q.n]; (keys[k] = keys[k] || []).push(it.id); }); };
    doc.parts.forEach(function (p) {
      if (!L.def(p) || !PCB.onBoard(p.type)) return;
      var o = X.fpOf(p, pcb.place[p.id]);
      if (!o.fp.pads.length) return;
      add({ id: p.id, kind: "part", part: p, ref: ref[p.id], value: L.partValue(p) || "", title: L.partTitle(p), fp: o.fp, keyOf: o.keyOf, src: o.src });
    });
    pcb.items.forEach(function (it) {
      var fp = null, keyOf = {}, rf = it.ref, val = it.value || "";
      if (it.kind === "fp") {
        var base = FP.get(it.fp);
        if (!base) return;
        fp = FP.clone(base);
        if (it.names) fp.pads.forEach(function (q) { var i = parseInt(q.n, 10) - 1; if (it.names[i]) q.name = it.names[i]; });
        fp.pads.forEach(function (q) { keyOf[q.n] = it.id + ":" + q.n; });
        if (!rf) { var pre = base.ref || "U"; counts[pre] = (counts[pre] || 0) + 1; rf = pre + counts[pre]; it.ref = rf; }
        val = val || base.name;
      } else if (it.kind === "hole" && it.plated) {
        fp = FP.finish({ id: "hole", name: "Plated hole", pads: [{ n: "1", x: 0, y: 0, shape: "circle", w: r3(it.d + 0.8), h: r3(it.d + 0.8), drill: it.d }], holes: [], silk: [] }, "hole");
        keyOf["1"] = it.id + ":1"; rf = rf || "H"; val = "Ø" + it.d + " plated";
      } else if (it.kind === "array") {
        fp = X.arrayFp(it);
        fp.pads.forEach(function (q) { keyOf[q.n] = it.id + ":" + (it.strip && it.strip !== "none" ? stripOf(it, q.n) : q.n); });
        rf = rf || "PROTO"; val = fp.name;
      } else return;
      add({ id: it.id, kind: it.kind, item: it, ref: rf, value: val, title: fp.name, fp: fp, keyOf: keyOf, src: "board" });
    });

    /* which pad keys are one net */
    var parent = {};
    var find = function (k) { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; };
    var union = function (a, b) { if (parent[a] == null || parent[b] == null) return; a = find(a); b = find(b); if (a !== b) parent[a] = b; };
    Object.keys(keys).forEach(function (k) { parent[k] = k; });
    if (sim) L.nets(doc, sim).forEach(function (group) { var ks = group.filter(function (k) { return parent[k] != null; }); for (var i = 1; i < ks.length; i++) union(ks[0], ks[i]); });
    var bench = {};
    Object.keys(parent).forEach(function (k) { bench[k] = find(k); });
    var linkOk = [];
    pcb.links.forEach(function (lk) { if (parent[lk.a] != null && parent[lk.b] != null) { linkOk.push(lk); union(lk.a, lk.b); } });
    /* a net's name, from what its pins are called and what drives it */
    var autoName = function (ks) {
      var pinNames = ks.map(function (k) { return k.slice(k.indexOf(":") + 1); });
      var from = function (pin) { return ks.some(function (k) { var id = k.slice(0, k.indexOf(":")); return k.slice(k.indexOf(":") + 1) === pin && index[id] && index[id].part && /battery|coin_cell|psu/.test(index[id].part.type); }); };
      return pinNames.some(function (n) { return /^GND\d?$/.test(n); }) || from("-") ? "GND" : pinNames.indexOf("5V") >= 0 ? "+5V" : pinNames.indexOf("3V3") >= 0 ? "+3V3"
        : from("+") || pinNames.some(function (n) { return /^(VCC|VIN|V\+|\+V)$/.test(n); }) ? "PWR" : "N";
    };
    var grouped = function () { var gr = {}; Object.keys(parent).forEach(function (k) { var r = find(k); (gr[r] = gr[r] || []).push(k); }); return gr; };
    var nameAll = function (gr) {
      var used = {}, out = {};
      Object.keys(gr).forEach(function (r) {
        var ks = gr[r], label = null;
        ks.forEach(function (k) { if (pcb.labels[k] && !label) label = pcb.labels[k]; });
        if (ks.length < 2 && !label) return;
        var name = label || autoName(ks);
        if (!label) { used[name] = (used[name] || 0) + 1; if (name === "N" || used[name] > 1) name = name + (name === "N" ? "" : "_") + used[name]; }
        out[r] = { name: name, label: label };
      });
      return out;
    };
    /* labels: pads with the same label are one net, and a label that is
     * the name of one of the circuit's nets (GND, +5V, N3…) joins it */
    var byLabel = {};
    Object.keys(pcb.labels).forEach(function (k) { if (parent[k] == null) return; var nm = pcb.labels[k]; if (byLabel[nm]) union(byLabel[nm], k); else byLabel[nm] = k; });
    var before = nameAll(grouped());
    Object.keys(byLabel).forEach(function (nm) {
      Object.keys(before).forEach(function (r) { if (!before[r].label && before[r].name === nm) union(byLabel[nm], r); });
    });
    var groups = grouped(), names = nameAll(groups), nets = [], padNet = {};
    Object.keys(groups).forEach(function (r) {
      if (!names[r]) return;
      var ks = groups[r], name = names[r].name;
      var power = /^(GND|PWR|VCC|VDD|VIN|VBUS|\+.*|.*V\d*)$/i.test(name) && !/^N\d*$/.test(name);
      var circuit = {};
      ks.forEach(function (k) { circuit[bench[k]] = 1; });
      ks.forEach(function (k) { padNet[k] = nets.length + 1; });
      nets.push({ name: name, power: power, keys: ks, label: names[r].label, boardOnly: Object.keys(circuit).length > 1 });
    });
    nets.forEach(function (n) {
      n.pads = [];
      n.keys.forEach(function (k) { keys[k].forEach(function (id) { n.pads.push({ id: id, key: k }); }); });
    });
    var sig = items.map(function (it) { return it.id + ":" + it.fp.id + ":" + it.fp.pads.length; }).join(",") + "|" +
      nets.map(function (n) { return n.keys.slice().sort().join("+"); }).sort().join("|");
    return { items: items, index: index, nets: nets, padNet: padNet, sig: sig, links: linkOk, keyItems: keys };
  };
  function stripOf(it, n) { var i = parseInt(n, 10) - 1, c = i % it.cols, r = Math.floor(i / it.cols); return it.strip === "rows" ? "row" + r : "col" + c; }

  /* A pattern of holes as a footprint: a grid, a bolt circle or a row. */
  X.arrayFp = function (it) {
    var f = { id: "array", name: "", pads: [], holes: [], silk: [] }, d = it.d || 1.0, pad = it.pad == null ? d + 0.8 : it.pad, k = 0;
    var put = function (x, y) { k++; if (pad > d) f.pads.push({ n: String(k), x: r3(x), y: r3(y), shape: it.square ? "rect" : "circle", w: pad, h: pad, drill: d }); else f.holes.push({ x: r3(x), y: r3(y), d: d }); };
    if (it.pattern === "circle") {
      var n = Math.max(2, Math.min(64, it.n || 6)), rad = it.radius || 10;
      for (var i = 0; i < n; i++) { var a = -Math.PI / 2 + i / n * Math.PI * 2; put(rad * Math.cos(a), rad * Math.sin(a)); }
      f.name = n + " holes on a " + r3(rad * 2) + " mm circle";
    } else {
      var cols = Math.max(1, Math.min(80, it.cols || 1)), rows = Math.max(1, Math.min(80, it.rows || 1)), p = it.pitch || 2.54;
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) put((c - (cols - 1) / 2) * p, (r - (rows - 1) / 2) * p);
      f.name = rows === 1 || cols === 1 ? Math.max(rows, cols) + " holes in a row, " + p + " mm apart" : cols + " × " + rows + " " + (it.strip && it.strip !== "none" ? "stripboard" : "prototyping") + " holes, " + p + " mm";
      if (it.strip && it.strip !== "none" && pad > d) {
        f.strips = [];
        if (it.strip === "rows") for (r = 0; r < rows; r++) f.strips.push([-(cols - 1) / 2 * p, (r - (rows - 1) / 2) * p, (cols - 1) / 2 * p, (r - (rows - 1) / 2) * p]);
        else for (c = 0; c < cols; c++) f.strips.push([(c - (cols - 1) / 2) * p, -(rows - 1) / 2 * p, (c - (cols - 1) / 2) * p, (rows - 1) / 2 * p]);
      }
    }
    return FP.finish(f, "array");
  };

  /* Parts of a v2 board that aren't on the bench: placed, given refs, kept. */
  X.ensure = function (doc, model) {
    var fresh = !doc.pcb;
    if (fresh) doc.pcb = PCB.blank();
    var pcb = X.upgrade(doc.pcb), changed = false;
    Object.keys(pcb.place).forEach(function (id) { if (!model.index[id] || model.index[id].kind !== "part") { delete pcb.place[id]; changed = true; } });
    var missing = model.items.filter(function (it) { return it.kind === "part" && !pcb.place[it.id]; });
    if (missing.length) { X.autoplace(doc, model, !fresh && missing.length < model.items.filter(function (it) { return it.kind === "part"; }).length); changed = true; }
    if (pcb.sig !== model.sig) {
      if (pcb.tracks.some(function (t) { return !t.man; }) || pcb.vias.some(function (v) { return !v[3]; })) changed = true;
      pcb.tracks = pcb.tracks.filter(function (t) { return t.man; }); pcb.vias = pcb.vias.filter(function (v) { return v[3]; }); pcb.open = [];
      pcb.sig = model.sig;
    }
    var keyOk = {};
    model.items.forEach(function (it) { it.fp.pads.forEach(function (q) { keyOk[it.keyOf[q.n]] = 1; }); });
    var nl = pcb.links.length;
    pcb.links = pcb.links.filter(function (lk) { return keyOk[lk.a] && keyOk[lk.b]; });
    if (pcb.links.length !== nl) changed = true;
    Object.keys(pcb.labels).forEach(function (k) { if (!keyOk[k]) { delete pcb.labels[k]; changed = true; } });
    return changed || fresh;
  };
  X.placeOf = function (doc, it) { return it.kind === "part" ? doc.pcb.place[it.id] : it.item; };

  X.autoplace = function (doc, model, onlyNew) {
    var pcb = doc.pcb, EDGE = 6, G = 1.27;
    /* the circuit's parts, and the parts that are only on the board */
    var items = model.items.filter(function (it) { return it.kind === "part" || it.kind === "fp"; });
    if (!items.length) return;
    var size = function (it) { var c = it.fp.court; return { w: c.x1 - c.x0, h: c.y1 - c.y0, x0: c.x0, y0: c.y0 }; };
    var spot = function (it) { if (it.kind === "fp") return it.item; var keep = pcb.place[it.id] || {}; pcb.place[it.id] = { x: 0, y: 0, rot: 0 }; if (keep.fp) pcb.place[it.id].fp = keep.fp; if (keep.side) pcb.place[it.id].side = keep.side; return pcb.place[it.id]; };
    if (onlyNew) {
      var y = EDGE;
      items.forEach(function (it) { var pl = X.placeOf(doc, it); if (pl && (it.kind === "fp" || pcb.place[it.id])) y = Math.max(y, X.courtOf(it.fp, pl).y1 + 2.54); });
      var x = EDGE;
      items.forEach(function (it) { if (it.kind !== "part" || pcb.place[it.id]) return; var b = size(it); pcb.place[it.id] = { x: r3(Math.round((x - b.x0 + G) / G) * G), y: r3(Math.round((y - b.y0 + G) / G) * G), rot: 0 }; x += b.w + 2.54; });
      X.grow(doc, model);
      return;
    }
    var link = {};
    model.nets.forEach(function (n) { n.pads.forEach(function (a) { n.pads.forEach(function (b) { if (a.id !== b.id) { link[a.id] = link[a.id] || {}; link[a.id][b.id] = (link[a.id][b.id] || 0) + (n.power ? 0.25 : 1); } }); }); });
    var order = [], left = items.slice();
    left.sort(function (a, b) { return b.fp.pads.length - a.fp.pads.length; });
    order.push(left.shift());
    while (left.length) {
      var best = 0, score = -1;
      left.forEach(function (it, i) { var s2 = 0; order.forEach(function (o, j) { s2 += ((link[it.id] || {})[o.id] || 0) * (1 + j / order.length); }); if (s2 > score) { score = s2; best = i; } });
      order.push(left.splice(best, 1)[0]);
    }
    var area = 0, widest = 0;
    order.forEach(function (it) { var b = size(it); area += (b.w + 3) * (b.h + 3); widest = Math.max(widest, b.w); });
    var maxW = Math.max(widest + 1, Math.sqrt(area) * 1.3), cx = 0, cy = 0, rowH = 0, spots = [];
    order.forEach(function (it) {
      var b = size(it), pl = spot(it);
      if (cx > 0 && cx + b.w > maxW) { cx = 0; cy += rowH + 2.54; rowH = 0; }
      pl.x = cx - b.x0; pl.y = cy - b.y0; pl.rot = 0;
      spots.push(pl);
      cx += b.w + 2.54; rowH = Math.max(rowH, b.h);
    });
    /* a rectangle wraps the parts; any other outline gets them packed into its middle */
    var rect = !pcb.shape || pcb.shape.kind === "rect";
    var e = X.extent(doc, model), mid = rect ? [EDGE + (e.x1 - e.x0) / 2, EDGE + (e.y1 - e.y0) / 2] : X.centroid(X.outline(pcb));
    var dx = mid[0] - (e.x0 + e.x1) / 2, dy = mid[1] - (e.y0 + e.y1) / 2;
    spots.forEach(function (pl) { pl.x = r3(Math.round((pl.x + dx) / G) * G); pl.y = r3(Math.round((pl.y + dy) / G) * G); });
    if (rect) X.fitBoard(doc, model);
  };
  /* the middle of an outline (the centre of its area) */
  X.centroid = function (pts) {
    var a = 0, cx = 0, cy = 0;
    for (var i = 1; i < pts.length; i++) { var f = pts[i - 1][0] * pts[i][1] - pts[i][0] * pts[i - 1][1]; a += f; cx += (pts[i - 1][0] + pts[i][0]) * f; cy += (pts[i - 1][1] + pts[i][1]) * f; }
    if (Math.abs(a) < 1e-9) return [pts[0][0], pts[0][1]];
    return [cx / (3 * a), cy / (3 * a)];
  };
  X.extent = function (doc, model) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    model.items.forEach(function (it) {
      var pl = X.placeOf(doc, it); if (!pl) return;
      var c = X.courtOf(it.fp, pl);
      x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0); x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1);
    });
    return x1 < x0 ? null : { x0: x0, y0: y0, x1: x1, y1: y1 };
  };
  /* Rectangular boards wrap the parts; drawn shapes are left alone. */
  X.fitBoard = function (doc, model) {
    var pcb = doc.pcb, e = X.extent(doc, model), EDGE = 6;
    if (!e || (pcb.shape && pcb.shape.kind !== "rect")) return false;
    X.shift(pcb, r3(Math.round((EDGE - e.x0) / 1.27) * 1.27), r3(Math.round((EDGE - e.y0) / 1.27) * 1.27));
    pcb.w = r3(Math.max(15, Math.ceil((e.x1 - e.x0 + 2 * EDGE) / 2.54) * 2.54));
    pcb.h = r3(Math.max(15, Math.ceil((e.y1 - e.y0 + 2 * EDGE) / 2.54) * 2.54));
    pcb.tracks = pcb.tracks.filter(function (t) { return t.man; }); pcb.vias = pcb.vias.filter(function (v) { return v[3]; }); pcb.open = [];
    return true;
  };
  X.grow = function (doc, model) {
    var pcb = doc.pcb, e = X.extent(doc, model);
    if (!e || (pcb.shape && pcb.shape.kind !== "rect")) return;
    pcb.w = r3(Math.max(pcb.w, Math.ceil((e.x1 + 6) / 2.54) * 2.54));
    pcb.h = r3(Math.max(pcb.h, Math.ceil((e.y1 + 6) / 2.54) * 2.54));
  };

  /* ============================================================== COPPER */

  /* Every pad on the board, in board coordinates. */
  X.pads = function (doc, model) {
    var out = [];
    model.items.forEach(function (it) {
      var pl = X.placeOf(doc, it); if (!pl) return;
      var odd = (pl.rot || 0) % 2 === 1, bottom = pl.side === "bottom";
      it.fp.pads.forEach(function (q, i) {
        var w = X.xf(pl, q.x, q.y), k = it.keyOf[q.n], tht = !!(q.drill || q.slot);
        var turned = odd !== ((q.deg || 0) % 180 === 90), pw = turned ? q.h : q.w, ph = turned ? q.w : q.h;
        var slot = q.slot ? (odd ? [q.slot[1], q.slot[0]] : [q.slot[0], q.slot[1]]) : null;
        var side = q.side === "bottom" ? !bottom : bottom;
        out.push({ id: it.id, key: k, n: q.n, name: q.name || q.n, x: w[0], y: w[1], w: pw, h: ph, shape: q.shape || "circle", drill: q.drill || (q.slot ? Math.min(q.slot[0], q.slot[1]) : 0), slot: slot,
          layers: tht ? [0, 1] : [side ? 1 : 0], net: model.padNet[k] || 0, first: i === 0 && it.fp.pads.length > 1 && !/^(array|hole)$/.test(it.kind), mask: q.mask || 0, item: it });
      });
    });
    return out;
  };
  /* Holes with no copper: from footprints, hole items and bare hole patterns. */
  X.npth = function (doc, model) {
    var pcb = doc.pcb, out = [];
    model.items.forEach(function (it) { var pl = X.placeOf(doc, it); if (!pl) return; (it.fp.holes || []).forEach(function (h) { var w = X.xf(pl, h.x, h.y); out.push({ x: w[0], y: w[1], d: h.d, id: it.id }); }); });
    pcb.items.forEach(function (it) { if (it.kind === "hole" && !it.plated) out.push({ x: it.x, y: it.y, d: it.d, id: it.id }); });
    PCB.holes(pcb).forEach(function (h) { out.push({ x: h[0], y: h[1], d: 3.2, id: "corner" }); });
    return out;
  };
  /* Copper as simple shapes: capsules (tracks, round pads, vias) and
   * rectangles, per layer, with their net. Used by the checks and the router. */
  X.copper = function (doc, model) {
    var pcb = doc.pcb, R = X.rules(pcb), out = [];
    X.pads(doc, model).forEach(function (p) {
      p.layers.forEach(function (l) {
        var o = { l: l, net: p.net, kind: "pad", pad: p, id: p.id };
        if (p.shape === "circle" || p.shape === "oval") {
          var lx = p.w > p.h, r = Math.min(p.w, p.h) / 2, half = Math.abs(p.w - p.h) / 2;
          o.a = [lx ? p.x - half : p.x, lx ? p.y : p.y - half]; o.b = [lx ? p.x + half : p.x, lx ? p.y : p.y + half]; o.r = r;
        } else o.rect = [p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2];
        out.push(o);
      });
    });
    pcb.tracks.forEach(function (t, ti) {
      for (var i = 1; i < t.pts.length; i++) out.push({ l: t.l, net: (t.n || 0) + 1 > 0 && t.n != null ? t.n + 1 : 0, kind: "track", a: t.pts[i - 1], b: t.pts[i], r: t.w / 2, t: ti });
    });
    pcb.vias.forEach(function (v, vi) { [0, 1].forEach(function (l) { out.push({ l: l, net: v[2] != null ? v[2] + 1 : 0, kind: "via", a: [v[0], v[1]], b: [v[0], v[1]], r: R.via / 2, v: vi }); }); });
    model.items.forEach(function (it) {
      if (!it.fp.strips) return;
      var pl = X.placeOf(doc, it);
      it.fp.strips.forEach(function (s, si) { var a = X.xf(pl, s[0], s[1]), b = X.xf(pl, s[2], s[3]); out.push({ l: pl.side === "bottom" ? 0 : 1, net: model.padNet[it.keyOf[String(it.item.strip === "rows" ? si * it.item.cols + 1 : si + 1)]] || 0, kind: "strip", a: a, b: b, r: 0.9, id: it.id, strip: si, item: it }); });
    });
    return out;
  };

  /* ===================================================== CONNECTIVITY */

  /* Which pads the copper already joins: tracks, vias and strips. Two
   * things touch when their copper overlaps. */
  function touches(a, b) { return gap(a, b) <= 0.01; }
  function segSeg(a1, b1, a2, b2) {
    if (segsCross(a1, b1, a2, b2)) return 0;
    return Math.min(segDist(a1[0], a1[1], a2[0], a2[1], b2[0], b2[1]), segDist(b1[0], b1[1], a2[0], a2[1], b2[0], b2[1]), segDist(a2[0], a2[1], a1[0], a1[1], b1[0], b1[1]), segDist(b2[0], b2[1], a1[0], a1[1], b1[0], b1[1]));
  }
  function orient(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
  function segsCross(a, b, c, d) {
    var o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    return ((o1 > 0) !== (o2 > 0)) && ((o3 > 0) !== (o4 > 0)) && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
  }
  function segRect(a, b, r) {
    var inR = function (p) { return p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]; };
    if (inR(a) || inR(b)) return 0;
    var c = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], d = 1e9;
    for (var i = 0; i < 4; i++) d = Math.min(d, segSeg(a, b, c[i], c[(i + 1) % 4]));
    return d;
  }
  function rectRect(p, q) { var dx = Math.max(0, Math.max(p[0], q[0]) - Math.min(p[2], q[2])), dy = Math.max(0, Math.max(p[1], q[1]) - Math.min(p[3], q[3])); return hyp(dx, dy); }
  /* the copper-to-copper gap between two shapes (negative: they overlap) */
  function gap(a, b) {
    if (a.rect && b.rect) return rectRect(a.rect, b.rect);
    if (a.rect) return segRect(b.a, b.b, a.rect) - b.r;
    if (b.rect) return segRect(a.a, a.b, b.rect) - a.r;
    return segSeg(a.a, a.b, b.a, b.b) - a.r - b.r;
  }
  X.gap = gap;
  function box(o) { if (o.rect) return o.rect; var r = o.r; return [Math.min(o.a[0], o.b[0]) - r, Math.min(o.a[1], o.b[1]) - r, Math.max(o.a[0], o.b[0]) + r, Math.max(o.a[1], o.b[1]) + r]; }
  /* pairs of shapes whose boxes come within `m` of each other */
  function nearPairs(objs, m, fn) {
    var cell = 4, grid = {};
    objs.forEach(function (o, i) {
      var b = o._b || (o._b = box(o));
      for (var gx = Math.floor((b[0] - m) / cell); gx <= Math.floor((b[2] + m) / cell); gx++) for (var gy = Math.floor((b[1] - m) / cell); gy <= Math.floor((b[3] + m) / cell); gy++) (grid[gx + "," + gy] = grid[gx + "," + gy] || []).push(i);
    });
    var seen = {};
    Object.keys(grid).forEach(function (k) {
      var list = grid[k];
      for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
        var a = list[i], b = list[j], key = a < b ? a + "_" + b : b + "_" + a;
        if (seen[key]) continue;
        seen[key] = 1;
        var A = objs[a], B = objs[b];
        if (A.l !== B.l) continue;
        var ba = A._b, bb = B._b;
        if (ba[0] - m > bb[2] || bb[0] - m > ba[2] || ba[1] - m > bb[3] || bb[1] - m > ba[3]) continue;
        fn(A, B);
      }
    });
  }
  /* For each net: which of its pads are already joined by copper, and the
   * air wires still to draw between the islands. */
  X.connectivity = function (doc, model) {
    var objs = X.copper(doc, model), parent = objs.map(function (_, i) { return i; });
    var find = function (i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    objs.forEach(function (o, i) { o.i = i; });
    /* a through-hole pad and a via are one thing on both sides */
    var same = {};
    objs.forEach(function (o) { var k = o.kind === "pad" ? "p" + o.pad.key + "@" + o.pad.x + "," + o.pad.y : o.kind === "via" ? "v" + o.v : o.kind === "track" ? "t" + o.t : null; if (k) { if (same[k] != null) parent[find(o.i)] = find(same[k]); else same[k] = o.i; } });
    nearPairs(objs, 0.02, function (a, b) { if ((a.kind === "pad" && b.kind === "pad") || !touches(a, b)) return; parent[find(a.i)] = find(b.i); });
    /* a strip of stripboard joins the holes it runs through */
    var out = { open: [], done: 0, todo: 0, islands: {} };
    var padObj = {};
    objs.forEach(function (o) { if (o.kind === "pad") padObj[o.pad.key + "@" + o.pad.x + "," + o.pad.y] = o.i; });
    var byNet = {};
    X.pads(doc, model).forEach(function (p) { if (p.net) (byNet[p.net] = byNet[p.net] || []).push(p); });
    Object.keys(byNet).forEach(function (k) {
      var list = byNet[k], groups = {}, order = [];
      /* pads that are the same pin of one part (two GND pins of a chip) are
       * joined inside the part only if the footprint says so — treat pads
       * with the same key on one item as already one */
      list.forEach(function (p) { var r = find(padObj[p.key + "@" + p.x + "," + p.y]); if (!groups[r]) { groups[r] = []; order.push(r); } groups[r].push(p); });
      var isl = order.map(function (r) { return groups[r]; });
      /* same key on the same item: one pin, many pads */
      for (var i = 0; i < isl.length; i++) for (var j = i + 1; j < isl.length; j++) {
        if (isl[i] && isl[j] && isl[i].some(function (p) { return isl[j].some(function (q) { return q.key === p.key && q.id === p.id; }); })) { isl[i] = isl[i].concat(isl[j]); isl[j] = null; }
      }
      isl = isl.filter(Boolean);
      out.islands[k] = isl.length;
      out.todo += isl.length - 1;
      var tree = [isl[0]], rest = isl.slice(1);
      while (rest.length) {
        var bd = 1e18, bi = 0, bp = null, bq = null;
        rest.forEach(function (g, gi) { g.forEach(function (p) { tree.forEach(function (t) { t.forEach(function (q) { var d = (p.x - q.x) * (p.x - q.x) + (p.y - q.y) * (p.y - q.y); if (d < bd) { bd = d; bi = gi; bp = p; bq = q; } }); }); }); });
        out.open.push([bp.x, bp.y, bq.x, bq.y, +k]);
        tree.push(rest.splice(bi, 1)[0]);
      }
    });
    out.done = 0;
    return out;
  };
  X.ratsnest = function (doc, model) { return X.connectivity(doc, model).open; };

  /* =============================================================== ROUTER
   * A two-layer maze router on a fine grid (0.635 mm by default), eight
   * directions, that respects the board's shape, cut-outs, holes, keep-outs
   * and every track you drew yourself. Top prefers to run across, bottom up
   * and down. A net that fails goes first next time round. */
  function Heap() { this.c = []; this.v = []; }
  Heap.prototype.push = function (cost, val) { var c = this.c, v = this.v, i = c.length; c.push(cost); v.push(val); while (i > 0) { var p = (i - 1) >> 1; if (c[p] <= cost) break; c[i] = c[p]; v[i] = v[p]; i = p; } c[i] = cost; v[i] = val; };
  Heap.prototype.pop = function () { var c = this.c, v = this.v, top = v[0], lc = c.pop(), lv = v.pop(), n = c.length; if (n) { var i = 0; for (;;) { var a = 2 * i + 1, b = a + 1; if (a >= n) break; if (b < n && c[b] < c[a]) a = b; if (c[a] >= lc) break; c[i] = c[a]; v[i] = v[a]; i = a; } c[i] = lc; v[i] = lv; } return top; };

  X.grid = function (doc) {
    var pcb = doc.pcb, R = X.rules(pcb), g = R.grid;
    while ((pcb.w / g + 1) * (pcb.h / g + 1) > 260000) g *= 1.5;
    var cols = Math.floor(pcb.w / g + 1e-6) + 1, rows = Math.floor(pcb.h / g + 1e-6) + 1;
    return { g: r3(g), cols: cols, rows: rows, N: cols * rows };
  };

  function routeOnce(doc, model, order, opts) {
    var pcb = doc.pcb, R = X.rules(pcb), GR = X.grid(doc), g = GR.g, cols = GR.cols, rows = GR.rows, N = GR.N;
    /* per cell per layer:
     *   owner  0 free, -1 blocked, k: only net k may pass (its copper, or close to it)
     *   cu     there is copper here    pad   it is a pad's copper
     *   near   0, k or -1: which net's copper is close enough to stop a wide (power) track */
    var owner = new Int32Array(2 * N), pad = new Uint8Array(2 * N), cu = new Uint8Array(2 * N), near = new Int32Array(2 * N), tree = new Uint8Array(2 * N);
    var haloT = R.clear + R.track / 2, haloP = R.clear + R.power / 2, slack = 0.002;
    var ol = X.outline(pcb), cuts = X.cutouts(pcb), edgeKeep = R.edge + R.track / 2, edgeWide = R.edge + R.power / 2;
    var c, r, i;
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
      var x = c * g, y = r * g, ok = inPoly(ol, x, y), ed = ok ? polyDist(ol, x, y) : 0;
      if (ok) for (i = 0; i < cuts.length; i++) { if (inPoly(cuts[i], x, y)) { ok = false; break; } ed = Math.min(ed, polyDist(cuts[i], x, y)); }
      var cell = r * cols + c;
      if (!ok || ed < edgeKeep) { owner[cell] = -1; owner[N + cell] = -1; }
      else if (ed < edgeWide) { near[cell] = -1; near[N + cell] = -1; }
    }
    var cellsNear = function (x0, y0, x1, y1, fn) {
      var ca = Math.max(0, Math.floor(x0 / g)), cb = Math.min(cols - 1, Math.ceil(x1 / g)), ra = Math.max(0, Math.floor(y0 / g)), rb = Math.min(rows - 1, Math.ceil(y1 / g));
      for (var rr = ra; rr <= rb; rr++) for (var cc = ca; cc <= cb; cc++) fn(rr * cols + cc, cc * g, rr * g);
    };
    /* copper of net k (k < 0: belongs to no net) whose edge is d from this cell */
    var mark = function (v, k, d, isPad) {
      if (d <= 0.0001) {
        if (isPad) {
          if (pad[v] && owner[v] !== k) { owner[v] = -1; return false; }
          if (owner[v] === -1 && !pad[v]) return false;
          owner[v] = k; pad[v] = 1; cu[v] = 1; near[v] = near[v] && near[v] !== k ? -1 : k;
          return true;
        }
        if (owner[v] === 0 || owner[v] === k) { owner[v] = k; cu[v] = 1; } else if (!pad[v]) owner[v] = -1;
        near[v] = near[v] && near[v] !== k ? -1 : k;
        return false;
      }
      if (d < haloT - slack) { var o = owner[v]; if (o !== -1) { if (o === 0 || o === k) owner[v] = k; else if (!pad[v]) owner[v] = -1; } }
      if (d < haloP - slack) near[v] = near[v] && near[v] !== k ? -1 : k;
      return false;
    };
    X.npth(doc, model).forEach(function (h) {
      var rad = h.d / 2 + haloP;
      cellsNear(h.x - rad, h.y - rad, h.x + rad, h.y + rad, function (cell, x, y) {
        var d = hyp(x - h.x, y - h.y) - h.d / 2;
        if (d < haloT) { owner[cell] = -1; owner[N + cell] = -1; } else if (d < haloP) { near[cell] = -1; near[N + cell] = -1; }
      });
    });
    pcb.items.forEach(function (it) {
      if (it.kind !== "keepout" || !it.pts || it.pts.length < 3) return;
      var xs = it.pts.map(function (p) { return p[0]; }), ys = it.pts.map(function (p) { return p[1]; }), poly = it.pts.concat([it.pts[0]]);
      cellsNear(Math.min.apply(null, xs) - haloT, Math.min.apply(null, ys) - haloT, Math.max.apply(null, xs) + haloT, Math.max.apply(null, ys) + haloT, function (cell, x, y) {
        if (inPoly(poly, x, y) || polyDist(poly, x, y) < haloT) { if (it.layer !== 1) owner[cell] = -1; if (it.layer !== 0) owner[N + cell] = -1; }
      });
    });
    model.items.forEach(function (it) {
      if (!it.fp.keepout) return;
      var pl = X.placeOf(doc, it), k = it.fp.keepout, a = X.xf(pl, k.x0, k.y0), b = X.xf(pl, k.x1, k.y1);
      cellsNear(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), function (cell) { owner[cell] = -1; owner[N + cell] = -1; });
    });
    /* pads */
    var pads = X.pads(doc, model), byNet = {}, clash = 0;
    pads.forEach(function (p) {
      var k = p.net || -2 - (pads.indexOf(p) % 1000);
      p.cells = [];
      var hw = p.w / 2, hh = p.h / 2, round = p.shape === "circle" || p.shape === "oval", rr2 = Math.min(hw, hh);
      var edge = function (x, y) {
        if (round) return hyp(Math.max(0, Math.abs(x - p.x) - (hw - rr2)), Math.max(0, Math.abs(y - p.y) - (hh - rr2))) - rr2;
        var dx = Math.abs(x - p.x) - hw, dy = Math.abs(y - p.y) - hh;
        return dx <= 0 && dy <= 0 ? Math.max(dx, dy) : hyp(Math.max(0, dx), Math.max(0, dy));
      };
      p.layers.forEach(function (layer) {
        cellsNear(p.x - hw - haloP, p.y - hh - haloP, p.x + hw + haloP, p.y + hh + haloP, function (cell, x, y) {
          var v = layer * N + cell;
          if (mark(v, k, edge(x, y), true)) p.cells.push(v);
        });
        /* the cell nearest the middle, even when the pad is smaller than the grid */
        var cc = Math.round(p.x / g), rr = Math.round(p.y / g);
        if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) { var v = layer * N + rr * cols + cc; if (p.cells.indexOf(v) < 0 && (!pad[v] || owner[v] === k)) { owner[v] = k; pad[v] = 1; cu[v] = 1; p.cells.push(v); } }
      });
      if (p.net) (byNet[p.net] = byNet[p.net] || []).push(p);
      else clash += 0;
    });
    /* copper already there: tracks and vias drawn by hand */
    var paintSeg = function (k, layer, a, b, w) {
      var rad = w / 2 + haloP;
      cellsNear(Math.min(a[0], b[0]) - rad, Math.min(a[1], b[1]) - rad, Math.max(a[0], b[0]) + rad, Math.max(a[1], b[1]) + rad, function (cell, x, y) {
        mark(layer * N + cell, k, segDist(x, y, a[0], a[1], b[0], b[1]) - w / 2, false);
      });
    };
    pcb.tracks.forEach(function (t) { if (!t.man) return; for (var q = 1; q < t.pts.length; q++) paintSeg(t.n != null && t.n >= 0 ? t.n + 1 : -3, t.l, t.pts[q - 1], t.pts[q], t.w); });
    pcb.vias.forEach(function (v) { if (!v[3]) return; [0, 1].forEach(function (layer) { paintSeg(v[2] != null && v[2] >= 0 ? v[2] + 1 : -3, layer, [v[0], v[1]], [v[0], v[1]], R.via); }); });

    var tracks = [], vias = [], open = [], length = 0, failed = [];
    var dist = new Float32Array(2 * N), prev = new Int32Array(2 * N), stamp = new Int32Array(2 * N), gen = 0;
    var DC = [1, -1, 0, 0, 1, 1, -1, -1], DR = [0, 0, 1, -1, 1, -1, 1, -1];
    var viaR = R.via / 2 + R.clear + R.track / 2, viaCells = Math.ceil(viaR / g);
    var free = function (v, k, wide) { var o = owner[v]; if (o !== 0 && o !== k) return false; if (wide && !(cu[v] && o === k)) { var n = near[v]; if (n !== 0 && n !== k) return false; } return true; };
    var viaOk = function (cell, k, wide) {
      var cc = cell % cols, rr = (cell / cols) | 0, rad = wide ? R.via / 2 + R.clear + R.power / 2 : viaR, nc = Math.ceil(rad / g);
      for (var dy = -nc; dy <= nc; dy++) for (var dx = -nc; dx <= nc; dx++) {
        if (hyp(dx * g, dy * g) >= rad) continue;
        var c2 = cc + dx, r2 = rr + dy;
        if (c2 < 0 || r2 < 0 || c2 >= cols || r2 >= rows) return false;
        var a = owner[r2 * cols + c2], b = owner[N + r2 * cols + c2];
        if ((a !== 0 && a !== k) || (b !== 0 && b !== k)) return false;
      }
      return true;
    };

    var connect = function (k, from, wide) {
      gen++;
      var heap = new Heap(), found = -1;
      from.cells.forEach(function (v) { dist[v] = 0; prev[v] = -1; stamp[v] = gen; heap.push(0, v); });
      var guard = 0;
      while (heap.c.length) {
        var u = heap.pop();
        if (tree[u]) { found = u; break; }
        if (++guard > 6e5) break;
        var layer = u >= N ? 1 : 0, cell = u - layer * N, cc = cell % cols, rr = (cell / cols) | 0, du = dist[u];
        for (var d = 0; d < 8; d++) {
          var c2 = cc + DC[d], r2 = rr + DR[d];
          if (c2 < 0 || r2 < 0 || c2 >= cols || r2 >= rows) continue;
          var v = layer * N + r2 * cols + c2;
          if (!free(v, k, wide)) continue;
          if (d >= 4 && (!free(layer * N + rr * cols + c2, k, wide) || !free(layer * N + r2 * cols + cc, k, wide))) continue;
          var vert = DC[d] === 0, horiz = DR[d] === 0;
          /* straight with the layer's grain 10, against it 13, diagonal 17:
           * a diagonal is worth it for a real diagonal, never as a zig-zag */
          var nd = du + (d >= 4 ? 17 : (layer === 0 && vert) || (layer === 1 && horiz) ? 13 : 10);
          if (stamp[v] !== gen || nd < dist[v]) { stamp[v] = gen; dist[v] = nd; prev[v] = u; heap.push(nd, v); }
        }
        var w = (1 - layer) * N + cell;
        if (free(w, k, wide)) {
          var through = pad[u] && pad[w] && owner[u] === k && owner[w] === k, cost = through ? 1 : 120;
          if (through || viaOk(cell, k, wide)) {
            var nd2 = du + cost;
            if (stamp[w] !== gen || nd2 < dist[w]) { stamp[w] = gen; dist[w] = nd2; prev[w] = u; heap.push(nd2, w); }
          }
        }
      }
      if (found < 0) return null;
      var path = [], n = found;
      while (n !== -1) { path.push(n); n = prev[n]; }
      path.reverse();
      return path;
    };
    /* lay a found path down as copper: tracks, vias, and the room round them */
    var lay = function (k, path, from, width) {
      var runLayer = path[0] >= N ? 1 : 0, run = [[from.x, from.y]], made = [];
      var flush = function () {
        if (run.length > 1) {
          var pts = [run[0]];
          for (var q = 1; q < run.length - 1; q++) {
            var a = run[q - 1], b = run[q], c3 = run[q + 1];
            if (Math.abs((b[0] - a[0]) * (c3[1] - b[1]) - (b[1] - a[1]) * (c3[0] - b[0])) > 1e-9) pts.push(b);
          }
          pts.push(run[run.length - 1]);
          var t = { n: k - 1, l: runLayer, w: width, pts: pts };
          tracks.push(t); made.push(t);
        }
        run = [];
      };
      for (var j = 0; j < path.length; j++) {
        var node = path[j], ly = node >= N ? 1 : 0, cl = node - ly * N, pt = [r3((cl % cols) * g), r3(((cl / cols) | 0) * g)];
        if (ly !== runLayer) {
          var lastPt = run[run.length - 1];
          flush();
          if (!(pad[node] && pad[ly === 1 ? cl : N + cl])) { vias.push([lastPt[0], lastPt[1], k - 1]); [0, 1].forEach(function (L2) { paintSeg(k, L2, lastPt, lastPt, R.via); }); }
          run = [lastPt]; runLayer = ly;
        }
        if (run[run.length - 1][0] !== pt[0] || run[run.length - 1][1] !== pt[1]) run.push(pt);
        tree[node] = 1;
      }
      flush();
      return made;
    };
    var paintTrack = function (t, k) { for (var q = 1; q < t.pts.length; q++) paintSeg(k, t.l, t.pts[q - 1], t.pts[q], t.w); };

    order.forEach(function (k) {
      var list = (byNet[k] || []).filter(function (p) { return p.cells.length; });
      if (list.length < 2) return;
      tree.fill(0);
      for (var v = 0; v < 2 * N; v++) if (owner[v] === k && cu[v] && !pad[v]) tree[v] = 1;
      var first = list[0];
      first.cells.forEach(function (v2) { tree[v2] = 1; });
      var rest = list.slice(1).sort(function (a, b) { return (Math.abs(a.x - first.x) + Math.abs(a.y - first.y)) - (Math.abs(b.x - first.x) + Math.abs(b.y - first.y)); });
      var done = [first], bad = false, wide = !!(model.nets[k - 1] && model.nets[k - 1].power) && R.power > R.track;
      rest.forEach(function (p) {
        if (p.cells.some(function (v2) { return tree[v2]; })) { p.cells.forEach(function (v2) { tree[v2] = 1; }); done.push(p); return; }
        /* a power net tries for a fat track first, then makes do with a thin one */
        var path = wide ? connect(k, p, true) : null, width = R.power;
        if (!path) { path = connect(k, p, false); width = R.track; }
        if (path) {
          var made = lay(k, path, p, width), t = made[made.length - 1], end = t && t.pts[t.pts.length - 1];
          if (end) for (var q = 0; q < done.length; q++) { var d0 = done[q]; if (Math.abs(d0.x - end[0]) <= d0.w / 2 && Math.abs(d0.y - end[1]) <= d0.h / 2 && t.l === (d0.layers.length === 2 ? t.l : d0.layers[0])) { if (end[0] !== d0.x || end[1] !== d0.y) t.pts.push([d0.x, d0.y]); break; } }
          made.forEach(function (tk) { tk.pts = chamfer(tk.pts, {}, g, function (a, b) { return segClear(a, b, k, tk.l, tk.w); }); paintTrack(tk, k); for (var q2 = 1; q2 < tk.pts.length; q2++) length += hyp(tk.pts[q2][0] - tk.pts[q2 - 1][0], tk.pts[q2][1] - tk.pts[q2 - 1][1]); });
          p.cells.forEach(function (v2) { tree[v2] = 1; });
          done.push(p); return;
        }
        bad = true;
        var near0 = done[0], bd = 1e18;
        done.forEach(function (t2) { var dd = hyp(t2.x - p.x, t2.y - p.y); if (dd < bd) { bd = dd; near0 = t2; } });
        open.push([p.x, p.y, near0.x, near0.y, k]);
      });
      if (bad) failed.push(k);
    });
    /* is a straight piece of track of net k clear of everything else? (for cutting corners) */
    function segClear(a, b, k, layer, w) {
      var rad = w / 2 + R.clear, ok = true;
      cellsNear(Math.min(a[0], b[0]) - rad - g, Math.min(a[1], b[1]) - rad - g, Math.max(a[0], b[0]) + rad + g, Math.max(a[1], b[1]) + rad + g, function (cell, x, y) {
        if (!ok) return;
        var v = layer * N + cell, o = owner[v];
        if (o === k || o === 0) { if (!cu[v] || o === k) return; }
        if (o === -1 && !cu[v]) { if (segDist(x, y, a[0], a[1], b[0], b[1]) < w / 2 + 0.05) ok = false; return; }
        if (cu[v] && o !== k && segDist(x, y, a[0], a[1], b[0], b[1]) < rad + g * 0.75) ok = false;
      });
      if (!ok) return false;
      for (var q = 0; q < pads.length; q++) {
        var p = pads[q];
        if (p.net === k || p.layers.indexOf(layer) < 0) continue;
        if (gap({ a: a, b: b, r: w / 2 }, p.shape === "circle" || p.shape === "oval" ? (function () { var lx = p.w > p.h, h = Math.abs(p.w - p.h) / 2; return { a: [lx ? p.x - h : p.x, lx ? p.y : p.y - h], b: [lx ? p.x + h : p.x, lx ? p.y : p.y + h], r: Math.min(p.w, p.h) / 2 }; })() : { rect: [p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2] }) < R.clear) return false;
      }
      for (q = 0; q < tracks.length; q++) {
        var t = tracks[q];
        if (t.l !== layer || t.n === k - 1) continue;
        for (var s = 1; s < t.pts.length; s++) if (segSeg(a, b, t.pts[s - 1], t.pts[s]) - w / 2 - t.w / 2 < R.clear) return false;
      }
      for (q = 0; q < vias.length; q++) if (vias[q][2] !== k - 1 && segDist(vias[q][0], vias[q][1], a[0], a[1], b[0], b[1]) - w / 2 - R.via / 2 < R.clear) return false;
      return true;
    }
    return { tracks: tracks, vias: vias, open: open, length: length, failed: failed, clash: clash, grid: g };
  }
  /* Square corners cut to 45°, where the cut stays clear of everything. */
  function chamfer(pts, keep, g, clear) {
    if (pts.length < 3) return pts;
    var out = [pts[0]];
    for (var i = 1; i < pts.length - 1; i++) {
      var a = out[out.length - 1], b = pts[i], c = pts[i + 1];
      var ax = b[0] - a[0], ay = b[1] - a[1], cx = c[0] - b[0], cy = c[1] - b[1], la = hyp(ax, ay), lc = hyp(cx, cy);
      var square = la > 0 && lc > 0 && Math.abs(ax * cx + ay * cy) < 1e-6 * la * lc;
      var h = Math.min(g, la / 2, lc / 2);
      if (!square || keep[b[0] + "," + b[1]] || h < g * 0.5) { out.push(b); continue; }
      var p1 = [r3(b[0] - ax / la * h), r3(b[1] - ay / la * h)], p2 = [r3(b[0] + cx / lc * h), r3(b[1] + cy / lc * h)];
      if (clear && !clear(p1, p2)) { out.push(b); continue; }
      out.push(p1); out.push(p2);
    }
    out.push(pts[pts.length - 1]);
    return out.filter(function (p, j) { return !j || p[0] !== out[j - 1][0] || p[1] !== out[j - 1][1]; });
  }

  /* Route every net (or only some). Hand-drawn copper is never touched. */
  X.route = function (doc, model, opts) {
    opts = opts || {};
    var pcb = X.upgrade(doc.pcb), pads = X.pads(doc, model), span = {};
    pads.forEach(function (p) {
      if (!p.net) return;
      var s = span[p.net] = span[p.net] || { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 };
      s.x0 = Math.min(s.x0, p.x); s.y0 = Math.min(s.y0, p.y); s.x1 = Math.max(s.x1, p.x); s.y1 = Math.max(s.y1, p.y);
    });
    var size = function (k) { var s = span[k]; return s ? (s.x1 - s.x0) + (s.y1 - s.y0) : 0; };
    var all = model.nets.map(function (_, i) { return i + 1; }).filter(function (k) { return span[k] && (!opts.only || opts.only.indexOf(k) >= 0); });
    var keepAuto = opts.only ? pcb.tracks.filter(function (t) { return !t.man && opts.only.indexOf(t.n + 1) < 0; }) : [];
    var keepAutoV = opts.only ? pcb.vias.filter(function (v) { return !v[3] && opts.only.indexOf(v[2] + 1) < 0; }) : [];
    /* when only some nets are re-routed the others are treated as fixed */
    var saveT = pcb.tracks, saveV = pcb.vias;
    pcb.tracks = saveT.filter(function (t) { return t.man; }).concat(keepAuto.map(function (t) { var c = JSON.parse(JSON.stringify(t)); c.man = 1; c._tmp = 1; return c; }));
    pcb.vias = saveV.filter(function (v) { return v[3]; }).concat(keepAutoV.map(function (v) { return [v[0], v[1], v[2], 1, 1]; }));
    var order = all.slice().sort(function (a, b) { return size(a) - size(b); });
    var best = null, seed = 7, tries = opts.tries || 6;
    var rnd = function () { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (var attempt = 0; attempt < tries; attempt++) {
      var res = routeOnce(doc, model, order, opts);
      if (!best || res.open.length < best.open.length || (res.open.length === best.open.length && res.vias.length < best.vias.length)) best = res;
      if (!res.open.length) break;
      /* what failed goes first; later tries shake the rest up a little */
      var failed = res.failed;
      order = failed.concat(order.filter(function (k) { return failed.indexOf(k) < 0; }));
      if (attempt === 2) order = all.slice().sort(function (a, b) { return size(b) - size(a); });
      if (attempt >= 3) { var head = order.slice(0, failed.length), tail = order.slice(failed.length); tail.sort(function () { return rnd() - 0.5; }); order = head.concat(tail); }
    }
    var manT = pcb.tracks.filter(function (t) { return !t._tmp; }), manV = pcb.vias.filter(function (v) { return !v[4]; });
    pcb.tracks = manT.concat(keepAuto, best.tracks);
    pcb.vias = manV.concat(keepAutoV, best.vias);
    best.open = X.ratsnest(doc, model);
    pcb.open = best.open.map(function (o) { return o.slice(0, 4); });
    return best;
  };

  /* ============================================================= CHECKS */

  /* The design-rule check. Each problem says where it is and what to do. */
  X.drc = function (doc, model) {
    var pcb = X.upgrade(doc.pcb), R = X.rules(pcb), out = [], seen = {};
    var add = function (level, code, msg, x, y, ids) { var k = code + Math.round(x * 2) + "," + Math.round(y * 2); if (seen[k]) return; seen[k] = 1; out.push({ level: level, code: code, msg: msg, x: r3(x), y: r3(y), ids: ids || [] }); };
    var objs = X.copper(doc, model), ol = X.outline(pcb), cuts = X.cutouts(pcb), netName = function (k) { return k && model.nets[k - 1] ? model.nets[k - 1].name : "no net"; };
    var where = function (o) { if (o.kind === "pad") return [o.pad.x, o.pad.y]; return [(o.a[0] + o.b[0]) / 2, (o.a[1] + o.b[1]) / 2]; };
    var what = function (o) { return o.kind === "pad" ? (o.pad.item.ref || "") + " pad " + o.pad.name : o.kind === "via" ? "a via" : o.kind === "strip" ? "a copper strip" : "a " + (o.l ? "bottom" : "top") + " track"; };
    nearPairs(objs, R.clear, function (a, b) {
      if (a.kind === "pad" && b.kind === "pad" && a.id === b.id) return;
      if (a.kind === "track" && b.kind === "track" && a.t === b.t) return;
      if (a.net && a.net === b.net) return;
      if (a.kind === "strip" || b.kind === "strip") return;
      var d = gap(a, b);
      if (d >= R.clear - 0.005) return;
      var p = where(a), q = where(b), x = (p[0] + q[0]) / 2, y = (p[1] + q[1]) / 2;
      if (d <= 0) add("danger", "short", "Short: " + what(a) + " (" + netName(a.net) + ") touches " + what(b) + " (" + netName(b.net) + ").", x, y, [a.id, b.id]);
      else add("warn", "clear", "Too close: " + what(a) + " and " + what(b) + " are " + r3(d) + " mm apart; the rule is " + R.clear + " mm.", x, y, [a.id, b.id]);
    });
    objs.forEach(function (o) {
      if (o.kind === "strip") return;
      var c = where(o), b = o._b || box(o);
      var corners = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], c];
      if (!corners.every(function (q) { return X.onBoard(pcb, q[0], q[1], ol, cuts); })) { add("danger", "off", what(o) + " hangs off the board" + (cuts.length ? " or into a cut-out" : "") + ".", c[0], c[1], [o.id]); return; }
      var ed = Math.min(polyDist(ol, c[0], c[1]) - (o.rect ? Math.max(b[2] - b[0], b[3] - b[1]) / 2 : o.r + hyp(o.a[0] - o.b[0], o.a[1] - o.b[1]) / 2));
      cuts.forEach(function (ct) { ed = Math.min(ed, polyDist(ct, c[0], c[1]) - (o.rect ? Math.max(b[2] - b[0], b[3] - b[1]) / 2 : o.r)); });
      if (ed < R.edge - 0.01 && !(o.kind === "pad" && /edge/.test(o.pad.item.fp.body && o.pad.item.fp.body.edge || ""))) add("warn", "edge", what(o) + " is " + r3(Math.max(0, ed)) + " mm from the edge; keep copper " + R.edge + " mm in, or the board house may cut it.", c[0], c[1], [o.id]);
    });
    X.npth(doc, model).forEach(function (h) {
      var hole = { a: [h.x, h.y], b: [h.x, h.y], r: h.d / 2 };
      objs.forEach(function (o) {
        if (o.kind === "pad" && o.id === h.id) return;
        var d = gap(hole, o);
        if (d < R.clear) add(d <= 0 ? "danger" : "warn", "hole", "A " + h.d + " mm hole is " + (d <= 0 ? "drilled through " : "too close to ") + what(o) + ".", h.x, h.y, [o.id]);
      });
      if (!X.onBoard(pcb, h.x, h.y, ol, cuts)) add("danger", "off", "A hole is off the board.", h.x, h.y);
    });
    X.pads(doc, model).forEach(function (p) {
      if (p.drill && p.drill < R.minDrill) add("warn", "drill", (p.item.ref || "") + " pad " + p.name + ": a " + p.drill + " mm drill is smaller than most board houses make (" + R.minDrill + " mm).", p.x, p.y, [p.id]);
      if (p.drill && !p.slot && (Math.min(p.w, p.h) - p.drill) / 2 < R.ring - 0.001) add("warn", "ring", (p.item.ref || "") + " pad " + p.name + ": the copper ring round the hole is only " + r3((Math.min(p.w, p.h) - p.drill) / 2) + " mm.", p.x, p.y, [p.id]);
    });
    pcb.tracks.forEach(function (t) { if (t.w < R.minTrack) add("warn", "thin", "A track " + t.w + " mm wide is thinner than " + R.minTrack + " mm.", t.pts[0][0], t.pts[0][1]); });
    pcb.tracks.forEach(function (t) {
      if (!model.nets[t.n] || !t.man) return;
      var ok = model.nets[t.n].power;
      if (ok && t.w < R.power * 0.66) add("info", "power", "A " + model.nets[t.n].name + " track is only " + t.w + " mm. Power tracks carry more current: " + R.power + " mm or wider is safer.", t.pts[0][0], t.pts[0][1]);
    });
    /* parts on top of each other */
    var its = model.items.filter(function (it) { return X.placeOf(doc, it) && it.kind !== "array"; }).map(function (it) { var pl = X.placeOf(doc, it); return { it: it, c: X.courtOf(it.fp, pl), side: pl.side || "top" }; });
    for (var i = 0; i < its.length; i++) for (var j = i + 1; j < its.length; j++) {
      var A = its[i], B = its[j];
      if (A.side !== B.side && A.it.fp.kind === "smd" && B.it.fp.kind === "smd") continue;
      var ox = Math.min(A.c.x1, B.c.x1) - Math.max(A.c.x0, B.c.x0), oy = Math.min(A.c.y1, B.c.y1) - Math.max(A.c.y0, B.c.y0);
      if (ox > 0.3 && oy > 0.3) add("warn", "overlap", A.it.ref + " and " + B.it.ref + " sit on top of each other.", (Math.max(A.c.x0, B.c.x0) + Math.min(A.c.x1, B.c.x1)) / 2, (Math.max(A.c.y0, B.c.y0) + Math.min(A.c.y1, B.c.y1)) / 2, [A.it.id, B.it.id]);
    }
    var con = X.connectivity(doc, model);
    con.open.forEach(function (o) { add("warn", "open", "Not connected yet: " + netName(o[4]) + ". Route it, or draw a track.", (o[0] + o[2]) / 2, (o[1] + o[3]) / 2); });
    model.nets.forEach(function (n) { if (n.boardOnly) add("info", "boardonly", "Net " + n.name + " joins pins the bench circuit keeps apart (a link or a label did it). The simulation won't know.", 0, 0); });
    model.items.forEach(function (it) { if (it.fp.unmapped && it.fp.unmapped.length) { var pl = X.placeOf(doc, it); add("warn", "unmapped", it.ref + " (" + it.fp.name + ") has no pad for pin" + (it.fp.unmapped.length > 1 ? "s " : " ") + it.fp.unmapped.join(", ") + ". Pick a package with enough pins.", pl.x, pl.y, [it.id]); } });
    var order = { danger: 0, warn: 1, info: 2 };
    out.sort(function (a, b) { return order[a.level] - order[b.level]; });
    return out;
  };

  X.report = function (doc, model) {
    var pcb = doc.pcb, length = 0, con = X.connectivity(doc, model);
    pcb.tracks.forEach(function (t) { for (var i = 1; i < t.pts.length; i++) length += hyp(t.pts[i][0] - t.pts[i - 1][0], t.pts[i][1] - t.pts[i - 1][1]); });
    var joins = con.todo;
    return { parts: model.items.filter(function (it) { return it.kind !== "array"; }).length, nets: model.nets.length, joins: joins, open: con.open.length, routed: !con.open.length,
      vias: pcb.vias.length, length: length, w: pcb.w, h: pcb.h, area: X.area(X.outline(pcb)), shape: pcb.shape ? pcb.shape.kind : "rect", tracks: pcb.tracks.length, man: pcb.tracks.filter(function (t) { return t.man; }).length };
  };

  /* ============================================================== OUTPUT */

  /* The item list: everything that goes on the board, with its package. */
  X.bom = function (doc, model) {
    var rows = {}, order = [];
    model.items.forEach(function (it) {
      if (it.kind === "hole" || it.kind === "array") return;
      var pkg = it.fp.id.indexOf("bench:") === 0 ? (it.fp.off ? "wire pads" : "as on the bench") : it.fp.id;
      var key = it.title + "|" + it.value + "|" + pkg;
      if (!rows[key]) { rows[key] = { refs: [], name: it.title, value: it.value, pkg: pkg, smd: it.fp.kind === "smd", side: [] }; order.push(key); }
      rows[key].refs.push(it.ref);
      var pl = X.placeOf(doc, it); if (pl && pl.side === "bottom" && rows[key].side.indexOf("bottom") < 0) rows[key].side.push("bottom");
    });
    return order.map(function (k) { var r = rows[k]; r.qty = r.refs.length; r.refs.sort(refSort); return r; }).sort(function (a, b) { return refSort(a.refs[0], b.refs[0]); });
  };
  function refSort(a, b) { var ma = /^([A-Z]+)(\d+)/.exec(a || "") || [0, a, 0], mb = /^([A-Z]+)(\d+)/.exec(b || "") || [0, b, 0]; return ma[1] < mb[1] ? -1 : ma[1] > mb[1] ? 1 : (+ma[2]) - (+mb[2]); }
  function csv(rows) { return rows.map(function (r) { return r.map(function (c) { c = String(c == null ? "" : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(","); }).join("\r\n") + "\r\n"; }
  X.bomCsv = function (doc, model) {
    return csv([["Qty", "References", "Part", "Value", "Package", "Mount", "Side"]].concat(X.bom(doc, model).map(function (r) { return [r.qty, r.refs.join(" "), r.name, r.value, r.pkg, r.smd ? "SMD" : "through-hole", r.side.length ? "bottom" : "top"]; })));
  };
  /* Where each part goes, for an assembly machine (origin: bottom-left, y up). */
  X.pnpCsv = function (doc, model) {
    var H = doc.pcb.h, rows = [["Designator", "Val", "Package", "Mid X", "Mid Y", "Rotation", "Layer"]];
    model.items.forEach(function (it) {
      if (it.kind === "hole" || it.kind === "array") return;
      var pl = X.placeOf(doc, it);
      rows.push([it.ref, it.value, it.fp.id, r3(pl.x).toFixed(3) + "mm", r3(H - pl.y).toFixed(3) + "mm", String((360 - (pl.rot || 0) * 90) % 360), pl.side === "bottom" ? "bottom" : "top"]);
    });
    return csv(rows);
  };
  X.netlist = function (doc, model) {
    var s = "Netlist — Chalk Circuit Lab\r\n\r\n";
    model.nets.forEach(function (n) {
      s += n.name + (n.boardOnly ? "  (board only)" : "") + "\r\n";
      n.pads.forEach(function (p) { var it = model.index[p.id]; s += "    " + it.ref + "." + p.key.slice(p.key.indexOf(":") + 1).replace(/^#/, "pad ") + "\r\n"; });
    });
    return s;
  };

  /* Silkscreen as strokes: footprint drawings, references, and text items. */
  X.silk = function (doc, model) {
    var pcb = doc.pcb, top = [], bot = [];
    model.items.forEach(function (it) {
      var pl = X.placeOf(doc, it); if (!pl || it.kind === "hole") return;
      var list = pl.side === "bottom" ? bot : top, P = function (x, y) { return X.xf(pl, x, y); };
      it.fp.silk.forEach(function (s) {
        if (s.l) list.push([P(s.l[0], s.l[1]), P(s.l[2], s.l[3])]);
        else if (s.c || s.a) {
          var a = s.c || s.a, a0 = s.a ? a[3] : 0, a1 = s.a ? a[4] : 360, n = Math.max(6, Math.round(Math.abs(a1 - a0) / 15)), pts = [];
          for (var i = 0; i <= n; i++) { var t = (a0 + (a1 - a0) * i / n) * Math.PI / 180; pts.push(P(a[0] + a[2] * Math.cos(t), a[1] + a[2] * Math.sin(t))); }
          list.push(pts);
        } else if (s.d) { var c = P(s.d[0], s.d[1]); list.push([[c[0] - 0.15, c[1]], [c[0] + 0.15, c[1]]]); list.push([[c[0], c[1] - 0.15], [c[0], c[1] + 0.15]]); }
      });
      if (it.ref && it.kind !== "array") {
        var c2 = X.courtOf(it.fp, pl), size = 1.0, wch = String(it.ref).length * 5.4 * size / 6;
        var tx = (c2.x0 + c2.x1) / 2 - wch / 2, ty = c2.y0 - size - 0.35;
        if (ty < 0.4) ty = c2.y1 + 0.35;
        PCB.strokes(it.ref, tx, ty, size).forEach(function (st) { list.push(pl.side === "bottom" ? mirrorStroke(st, (c2.x0 + c2.x1) / 2) : st); });
      }
    });
    pcb.items.forEach(function (it) {
      if (it.kind !== "text" || !it.s) return;
      var layer = it.layer === "bsilk" ? bot : it.layer === "silk" || !it.layer ? top : null;
      if (!layer) return;
      var size = it.size || 1.5, wch = String(it.s).length * 5.4 * size / 6;
      PCB.strokes(String(it.s).slice(0, 60), it.x - wch / 2, it.y - size / 2, size).forEach(function (st) { layer.push(it.layer === "bsilk" ? mirrorStroke(st, it.x) : st); });
    });
    return { top: top, bottom: bot };
  };
  function mirrorStroke(st, cx) { return st.map(function (p) { return [r3(2 * cx - p[0]), p[1]]; }); }
  /* Copper text items, drawn as strokes on a copper layer. */
  X.copperText = function (doc) {
    var out = [];
    doc.pcb.items.forEach(function (it) {
      if (it.kind !== "text" || (it.layer !== "top" && it.layer !== "bottom") || !it.s) return;
      var size = it.size || 1.5, wch = String(it.s).length * 5.4 * size / 6;
      PCB.strokes(String(it.s).slice(0, 60), it.x - wch / 2, it.y - size / 2, size).forEach(function (st) { out.push({ l: it.layer === "bottom" ? 1 : 0, pts: it.layer === "bottom" ? mirrorStroke(st, it.x) : st, w: Math.max(0.15, size / 8) }); });
    });
    return out;
  };
  X.zones = function (doc, model) {
    var pcb = doc.pcb, out = [];
    pcb.items.forEach(function (it) {
      if (it.kind !== "zone") return;
      var net = 0;
      model.nets.forEach(function (n, i) { if (n.name === it.net) net = i + 1; });
      var pts = it.pts === "board" || !it.pts ? X.outline(pcb) : it.pts.concat([it.pts[0]]);
      out.push({ id: it.id, l: it.layer === 0 ? 0 : 1, net: net, name: it.net, pts: pts });
    });
    return out;
  };

  /* Gerber X2 and Excellon. Gerber's y runs up the page, so everything is
   * flipped top to bottom on the way out. */
  X.gerbers = function (doc, model, title) {
    var pcb = doc.pcb, R = X.rules(pcb), H = pcb.h, pads = X.pads(doc, model), silk = X.silk(doc, model), zones = X.zones(doc, model), ctext = X.copperText(doc);
    var fmt = function (v) { return String(Math.round(v * 1e6)); };
    var XY = function (x, y) { return "X" + fmt(x) + "Y" + fmt(H - y); };
    var head = function (func, pol) { return "G04 Chalk Circuit Lab — " + (title || "board") + "*\n%TF.GenerationSoftware,Chalk,CircuitLab,2*%\n%TF.SameCoordinates,Original*%\n%TF.FileFunction," + func + "*%\n" + (pol ? "%TF.FilePolarity," + pol + "*%\n" : "") + "%FSLAX46Y46*%\n%MOMM*%\n%LPD*%\n"; };
    /* apertures, made as they are needed */
    var mkAps = function () {
      var ap = {}, list = [];
      return {
        get: function (shape, w, h) {
          w = r3(w); h = r3(h == null ? w : h);
          var key = shape === "circle" || (shape !== "rect" && shape !== "roundrect" && w === h && shape !== "oval") ? "C," + w : shape === "oval" ? (w === h ? "C," + w : "O," + w + "X" + h) : "R," + w + "X" + h;
          if (!ap[key]) { ap[key] = "D" + (10 + list.length); list.push("%ADD" + (10 + list.length) + key + "*%"); }
          return ap[key];
        },
        defs: function () { return list.join("\n") + (list.length ? "\n" : ""); }
      };
    };
    var line = function (pts) { var s = ""; pts.forEach(function (p, i) { s += XY(p[0], p[1]) + (i ? "D01*\n" : "D02*\n"); }); return s; };
    var region = function (pts) { var s = "G36*\n" + XY(pts[0][0], pts[0][1]) + "D02*\n"; for (var i = 1; i < pts.length; i++) s += XY(pts[i][0], pts[i][1]) + "D01*\n"; return s + "G37*\n"; };
    var copper = function (layer) {
      var A = mkAps(), body = "G01*\n", ol = X.outline(pcb), cuts = X.cutouts(pcb);
      zones.filter(function (z) { return z.l === layer; }).forEach(function (z) {
        body += "%TA.AperFunction,Conductor*%\n" + region(z.pts) + "%TD*%\n%LPC*%\n";
        /* clear round everything that isn't this net, and the edges */
        pcb.tracks.forEach(function (t) { if (t.l === layer && t.n + 1 !== z.net) body += A.get("circle", t.w + 2 * R.clear) + "*\n" + line(t.pts); });
        pads.forEach(function (p) { if (p.layers.indexOf(layer) >= 0 && p.net !== z.net) body += A.get(p.shape, p.w + 2 * R.clear, p.h + 2 * R.clear) + "*\n" + XY(p.x, p.y) + "D03*\n"; });
        pcb.vias.forEach(function (v) { if (v[2] + 1 !== z.net) body += A.get("circle", R.via + 2 * R.clear) + "*\n" + XY(v[0], v[1]) + "D03*\n"; });
        X.npth(doc, model).forEach(function (h) { body += A.get("circle", h.d + 2 * R.clear) + "*\n" + XY(h.x, h.y) + "D03*\n"; });
        ctext.forEach(function (ct) { if (ct.l === layer) body += A.get("circle", ct.w + 2 * R.clear) + "*\n" + line(ct.pts); });
        body += A.get("circle", 2 * R.edge) + "*\n" + line(ol);
        cuts.forEach(function (c) { body += line(c); });
        body += "%LPD*%\n";
      });
      var segs = {};
      pcb.tracks.forEach(function (t) { if (t.l === layer) (segs[t.w] = segs[t.w] || []).push(t); });
      Object.keys(segs).forEach(function (w) { body += "%TA.AperFunction,Conductor*%\n" + A.get("circle", +w) + "*\n%TD*%\n"; segs[w].forEach(function (t) { body += line(t.pts); }); });
      ctext.forEach(function (ct) { if (ct.l === layer) body += A.get("circle", ct.w) + "*\n" + line(ct.pts); });
      model.items.forEach(function (it) { if (!it.fp.strips) return; var pl = X.placeOf(doc, it); if ((pl.side === "bottom" ? 0 : 1) !== layer) return; body += A.get("circle", 1.8) + "*\n"; it.fp.strips.forEach(function (s) { body += line([X.xf(pl, s[0], s[1]), X.xf(pl, s[2], s[3])]); }); });
      pads.forEach(function (p) { if (p.layers.indexOf(layer) >= 0) body += A.get(p.shape, p.w, p.h) + "*\n" + XY(p.x, p.y) + "D03*\n"; });
      if (pcb.vias.length) { body += A.get("circle", R.via) + "*\n"; pcb.vias.forEach(function (v) { body += XY(v[0], v[1]) + "D03*\n"; }); }
      return head("Copper,L" + (layer + 1) + "," + (layer ? "Bot" : "Top"), "Positive") + A.defs() + body + "M02*\n";
    };
    var mask = function (layer) {
      var A = mkAps(), body = "G01*\n";
      pads.forEach(function (p) { if (p.layers.indexOf(layer) < 0) return; var m = p.mask || 0; body += (m ? A.get("circle", m) : A.get(p.shape, p.w + 0.1, p.h + 0.1)) + "*\n" + XY(p.x, p.y) + "D03*\n"; });
      return head("Soldermask," + (layer ? "Bot" : "Top"), "Negative") + A.defs() + body + "M02*\n";
    };
    var paste = function (layer) {
      var A = mkAps(), body = "G01*\n";
      pads.forEach(function (p) { if (p.drill || p.layers.length !== 1 || p.layers[0] !== layer || p.mask) return; body += A.get(p.shape, p.w, p.h) + "*\n" + XY(p.x, p.y) + "D03*\n"; });
      return head("Paste," + (layer ? "Bot" : "Top"), "Positive") + A.defs() + body + "M02*\n";
    };
    var legend = function (list, side) {
      var A = mkAps(), body = "G01*\n" + A.get("circle", 0.15) + "*\n";
      list.forEach(function (st) { body += line(st); });
      if (side === "Top" && title) PCB.strokes(String(title).replace(/[^A-Za-z0-9 +\-_.]/g, "").slice(0, 28), 2, H - 2.4, 1.2).forEach(function (st) { if (st.every(function (p) { return X.onBoard(pcb, p[0], p[1]); })) body += line(st); });
      return head("Legend," + side, "Positive") + A.defs() + body + "M02*\n";
    };
    var edge = (function () { var A = mkAps(), body = "G01*\n" + A.get("circle", 0.1) + "*\n" + line(X.outline(pcb)); X.cutouts(pcb).forEach(function (c) { body += line(c); }); return head("Profile,NP") + A.defs() + body + "M02*\n"; })();
    var drill = function (plated) {
      var tools = {}, toolList = [], hits = [];
      var tool = function (d) { d = r3(d); if (!tools[d]) { tools[d] = "T" + (toolList.length + 1); toolList.push(d); } return tools[d]; };
      if (plated) {
        pads.forEach(function (p) { if (!p.drill) return; hits.push({ t: tool(p.drill), x: p.x, y: p.y, slot: p.slot }); });
        pcb.vias.forEach(function (v) { hits.push({ t: tool(R.viaDrill), x: v[0], y: v[1] }); });
      } else X.npth(doc, model).forEach(function (h) { hits.push({ t: tool(h.d), x: h.x, y: h.y }); });
      var s = "M48\n; Chalk Circuit Lab — " + (title || "board") + "\n; #@! TF.FileFunction," + (plated ? "Plated,1,2,PTH" : "NonPlated,1,2,NPTH") + "\nMETRIC,TZ\nFMAT,2\n";
      toolList.forEach(function (d, i) { s += "T" + (i + 1) + "C" + d.toFixed(3) + "\n"; });
      s += "%\nG90\nG05\n";
      var hit = function (x, y) { return "X" + x.toFixed(3) + "Y" + (H - y).toFixed(3); };
      toolList.forEach(function (d, i) {
        s += "T" + (i + 1) + "\n";
        hits.forEach(function (h) {
          if (h.t !== "T" + (i + 1)) return;
          if (h.slot && Math.abs(h.slot[0] - h.slot[1]) > 0.01) {
            var half = Math.abs(h.slot[0] - h.slot[1]) / 2, along = h.slot[0] > h.slot[1];
            s += hit(along ? h.x - half : h.x, along ? h.y : h.y - half) + "G85" + hit(along ? h.x + half : h.x, along ? h.y : h.y + half) + "\n";
          } else s += hit(h.x, h.y) + "\n";
        });
      });
      return s + "T0\nM30\n";
    };
    var rep = X.report(doc, model), base = String(title || "board").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "board";
    var bottomParts = model.items.some(function (it) { var pl = X.placeOf(doc, it); return pl && pl.side === "bottom"; });
    var readme = "Circuit board: " + (title || "board") + "\r\nMade in Chalk Circuit Lab's board studio.\r\n\r\n" +
      "Outline: " + (rep.shape === "rect" ? "rectangle" : rep.shape === "circle" ? "circle" : "custom shape") + ", " + pcb.w.toFixed(2) + " x " + pcb.h.toFixed(2) + " mm (" + rep.area.toFixed(0) + " mm²)" + (pcb.cut.length ? ", " + pcb.cut.length + " cut-out(s)" : "") + ". 2 copper layers, 1.6 mm FR4.\r\n" +
      "Rules: tracks " + R.track + " mm (power " + R.power + " mm), gap " + R.clear + " mm, vias " + R.via + "/" + R.viaDrill + " mm, copper kept " + R.edge + " mm from the edge.\r\n" +
      rep.parts + " parts, " + rep.nets + " nets, " + rep.vias + " vias, " + rep.length.toFixed(0) + " mm of track" + (zones.length ? ", " + zones.length + " copper pour(s) (solid, no thermal spokes)" : "") + ".\r\n" +
      (rep.open ? "WARNING: " + rep.open + " connection(s) are NOT routed — finish them with wire links, or go back and route.\r\n" : "Every connection is routed.\r\n") +
      "\r\nFiles\r\n" +
      "  " + base + "-F_Cu.gtl / -B_Cu.gbl          copper, top and bottom\r\n" +
      "  " + base + "-F_Mask.gts / -B_Mask.gbs      solder mask\r\n" +
      "  " + base + "-F_Paste.gtp" + (bottomParts ? " / -B_Paste.gbp" : "") + "          solder paste (for a stencil)\r\n" +
      "  " + base + "-F_SilkS.gto / -B_SilkS.gbo    silkscreen\r\n" +
      "  " + base + "-Edge_Cuts.gm1                 outline and cut-outs\r\n" +
      "  " + base + "-PTH.drl / -NPTH.drl           plated and bare holes (Excellon, mm)\r\n" +
      "  bom.csv, positions.csv, netlist.txt      parts, where they go, what joins what\r\n" +
      "\r\nUpload the zip as it is to a board house (JLCPCB, PCBWay, Aisler, OSH Park) and look at their preview before you pay.\r\n" +
      "This board was laid out in a classroom tool. Have someone who knows boards look it over before trusting it with anything that matters.\r\n";
    var files = [
      { name: base + "-F_Cu.gtl", data: copper(0) }, { name: base + "-B_Cu.gbl", data: copper(1) },
      { name: base + "-F_Mask.gts", data: mask(0) }, { name: base + "-B_Mask.gbs", data: mask(1) },
      { name: base + "-F_Paste.gtp", data: paste(0) },
      { name: base + "-F_SilkS.gto", data: legend(silk.top, "Top") }, { name: base + "-B_SilkS.gbo", data: legend(silk.bottom, "Bot") },
      { name: base + "-Edge_Cuts.gm1", data: edge },
      { name: base + "-PTH.drl", data: drill(true) }, { name: base + "-NPTH.drl", data: drill(false) },
      { name: "bom.csv", data: X.bomCsv(doc, model) }, { name: "positions.csv", data: X.pnpCsv(doc, model) }, { name: "netlist.txt", data: X.netlist(doc, model) },
      { name: "README.txt", data: readme }
    ];
    if (bottomParts) files.splice(5, 0, { name: base + "-B_Paste.gbp", data: paste(1) });
    return files;
  };

  /* The board for KiCad (.kicad_pcb, KiCad 7 format): footprints with their
   * nets, tracks, vias, pours (KiCad refills them), outline, text. */
  function q(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
  X.kicadPcb = function (doc, model, title) {
    var pcb = doc.pcb, R = X.rules(pcb), s = "(kicad_pcb (version 20221018) (generator chalk_lab)\n  (general (thickness 1.6))\n  (paper \"A4\")\n  (title_block (title " + q(title || "board") + ") (comment 1 \"Chalk Circuit Lab\"))\n";
    s += "  (layers\n    (0 \"F.Cu\" signal) (31 \"B.Cu\" signal) (34 \"B.Paste\" user) (35 \"F.Paste\" user) (36 \"B.SilkS\" user \"B.Silkscreen\") (37 \"F.SilkS\" user \"F.Silkscreen\")\n    (38 \"B.Mask\" user) (39 \"F.Mask\" user) (44 \"Edge.Cuts\" user) (46 \"B.CrtYd\" user \"B.Courtyard\") (47 \"F.CrtYd\" user \"F.Courtyard\") (48 \"B.Fab\" user) (49 \"F.Fab\" user)\n  )\n";
    s += "  (setup (pad_to_mask_clearance 0.05))\n  (net 0 \"\")\n";
    model.nets.forEach(function (n, i) { s += "  (net " + (i + 1) + " " + q(n.name) + ")\n"; });
    var netOf = function (key) { var k = model.padNet[key]; return k ? " (net " + k + " " + q(model.nets[k - 1].name) + ")" : ""; };
    model.items.forEach(function (it) {
      var pl = X.placeOf(doc, it); if (!pl) return;
      var bot = pl.side === "bottom", ang = (360 - (pl.rot || 0) * 90) % 360, F = bot ? "B" : "F";
      s += "  (footprint " + q("Chalk:" + it.fp.id.replace(/[^A-Za-z0-9_.\-]+/g, "_")) + " (layer \"" + F + ".Cu\") (at " + r3(pl.x) + " " + r3(pl.y) + (ang ? " " + ang : "") + ")\n";
      s += "    (property \"Reference\" " + q(it.ref || "") + ") (property \"Value\" " + q(it.value || it.title || "") + ")\n";
      s += "    (fp_text reference " + q(it.ref || "") + " (at 0 " + r3(it.fp.court.y0 - 1) + (ang ? " " + ang : "") + ") (layer \"" + F + ".SilkS\") (effects (font (size 1 1) (thickness 0.15))" + (bot ? " (justify mirror)" : "") + "))\n";
      s += "    (fp_text value " + q(it.value || "") + " (at 0 " + r3(it.fp.court.y1 + 1) + (ang ? " " + ang : "") + ") (layer \"" + F + ".Fab\") (effects (font (size 1 1) (thickness 0.15))" + (bot ? " (justify mirror)" : "") + "))\n";
      var mx = function (x) { return r3(bot ? -x : x); };
      it.fp.silk.forEach(function (k) { if (k.l) s += "    (fp_line (start " + mx(k.l[0]) + " " + k.l[1] + ") (end " + mx(k.l[2]) + " " + k.l[3] + ") (stroke (width 0.12) (type solid)) (layer \"" + F + ".SilkS\"))\n"; else if (k.c) s += "    (fp_circle (center " + mx(k.c[0]) + " " + k.c[1] + ") (end " + mx(k.c[0] + k.c[2]) + " " + k.c[1] + ") (stroke (width 0.12) (type solid)) (fill none) (layer \"" + F + ".SilkS\"))\n"; });
      var c = it.fp.court;
      s += "    (fp_rect (start " + mx(c.x0) + " " + c.y0 + ") (end " + mx(c.x1) + " " + c.y1 + ") (stroke (width 0.05) (type solid)) (fill none) (layer \"" + F + ".CrtYd\"))\n";
      it.fp.pads.forEach(function (p) {
        var shape = p.shape === "circle" ? "circle" : p.shape === "oval" ? "oval" : p.shape === "roundrect" ? "roundrect" : "rect", tht = p.drill || p.slot;
        var side = p.side === "bottom" ? !bot : bot, padAng = (ang + (p.deg || 0)) % 360;
        s += "    (pad " + q(p.n) + " " + (tht ? "thru_hole" : "smd") + " " + shape + " (at " + mx(p.x) + " " + p.y + (padAng ? " " + padAng : "") + ") (size " + p.w + " " + p.h + ")";
        if (p.slot) s += " (drill oval " + p.slot[0] + " " + p.slot[1] + ")"; else if (tht) s += " (drill " + p.drill + ")";
        s += tht ? " (layers \"*.Cu\" \"*.Mask\")" : side ? " (layers \"B.Cu\" \"B.Paste\" \"B.Mask\")" : " (layers \"F.Cu\" \"F.Paste\" \"F.Mask\")";
        if (shape === "roundrect") s += " (roundrect_rratio 0.25)";
        s += netOf(it.keyOf[p.n]) + (p.name && p.name !== p.n ? " (pinfunction " + q(p.name) + ")" : "") + ")\n";
      });
      (it.fp.holes || []).forEach(function (h) { s += "    (pad \"\" np_thru_hole circle (at " + mx(h.x) + " " + h.y + ") (size " + h.d + " " + h.d + ") (drill " + h.d + ") (layers \"*.Cu\" \"*.Mask\"))\n"; });
      s += "  )\n";
    });
    pcb.items.forEach(function (it) {
      if (it.kind === "hole" && !it.plated) s += "  (footprint \"Chalk:MountingHole_" + it.d + "\" (layer \"F.Cu\") (at " + r3(it.x) + " " + r3(it.y) + ")\n    (property \"Reference\" \"H\")\n    (pad \"\" np_thru_hole circle (at 0 0) (size " + it.d + " " + it.d + ") (drill " + it.d + ") (layers \"*.Cu\" \"*.Mask\"))\n  )\n";
      if (it.kind === "text" && it.s) s += "  (gr_text " + q(it.s) + " (at " + r3(it.x) + " " + r3(it.y) + ") (layer \"" + ({ silk: "F.SilkS", bsilk: "B.SilkS", top: "F.Cu", bottom: "B.Cu" }[it.layer || "silk"]) + "\") (effects (font (size " + (it.size || 1.5) + " " + (it.size || 1.5) + ") (thickness " + r3(Math.max(0.15, (it.size || 1.5) / 8)) + "))" + (it.layer === "bsilk" || it.layer === "bottom" ? " (justify mirror)" : "") + "))\n";
    });
    PCB.holes(pcb).forEach(function (h) { s += "  (footprint \"Chalk:MountingHole_3.2\" (layer \"F.Cu\") (at " + r3(h[0]) + " " + r3(h[1]) + ")\n    (property \"Reference\" \"H\")\n    (pad \"\" np_thru_hole circle (at 0 0) (size 3.2 3.2) (drill 3.2) (layers \"*.Cu\" \"*.Mask\"))\n  )\n"; });
    var edgeLines = function (pts) { for (var i = 1; i < pts.length; i++) s += "  (gr_line (start " + r3(pts[i - 1][0]) + " " + r3(pts[i - 1][1]) + ") (end " + r3(pts[i][0]) + " " + r3(pts[i][1]) + ") (stroke (width 0.1) (type solid)) (layer \"Edge.Cuts\"))\n"; };
    edgeLines(X.outline(pcb)); X.cutouts(pcb).forEach(edgeLines);
    pcb.tracks.forEach(function (t) { for (var i = 1; i < t.pts.length; i++) s += "  (segment (start " + t.pts[i - 1][0] + " " + t.pts[i - 1][1] + ") (end " + t.pts[i][0] + " " + t.pts[i][1] + ") (width " + t.w + ") (layer \"" + (t.l ? "B" : "F") + ".Cu\") (net " + (t.n != null && model.nets[t.n] ? t.n + 1 : 0) + "))\n"; });
    pcb.vias.forEach(function (v) { s += "  (via (at " + v[0] + " " + v[1] + ") (size " + R.via + ") (drill " + R.viaDrill + ") (layers \"F.Cu\" \"B.Cu\") (net " + (v[2] != null && model.nets[v[2]] ? v[2] + 1 : 0) + "))\n"; });
    X.zones(doc, model).forEach(function (z) {
      s += "  (zone (net " + z.net + ") (net_name " + q(z.name) + ") (layer \"" + (z.l ? "B" : "F") + ".Cu\") (hatch edge 0.5) (connect_pads (clearance " + R.clear + ")) (min_thickness 0.25) (fill yes (thermal_gap 0.5) (thermal_bridge_width 0.5))\n    (polygon (pts";
      z.pts.slice(0, -1).forEach(function (p) { s += " (xy " + r3(p[0]) + " " + r3(p[1]) + ")"; });
      s += "))\n  )\n";
    });
    return s + ")\n";
  };

  /* Every footprint on the board, for KiCad's library (one .kicad_mod each). */
  X.footprintFiles = function (model) {
    var seen = {}, out = [];
    model.items.forEach(function (it) {
      if (it.kind !== "part" && it.kind !== "fp") return;
      var id = it.fp.id.replace(/[^A-Za-z0-9_.\-]+/g, "_");
      if (seen[id]) return;
      seen[id] = 1;
      out.push({ name: "Chalk.pretty/" + id + ".kicad_mod", data: FP.kicad(it.fp, id) });
    });
    return out;
  };

  /* The whole design, as data: board, packages and the parts you made. */
  X.project = function (doc, model, title) {
    var lib = {};
    doc.parts.forEach(function (p) { if (L.CUSTOM && L.CUSTOM[p.type]) lib[p.type] = L.CUSTOM[p.type].data; });
    return JSON.stringify({ format: "chalk-board", version: 2, title: title || "board", made: new Date().toISOString(), pcb: doc.pcb, parts: doc.parts, wires: doc.wires, lib: lib,
      bom: X.bom(doc, model), nets: model.nets.map(function (n) { return { name: n.name, pads: n.pads.map(function (p) { return model.index[p.id].ref + "." + p.key.slice(p.key.indexOf(":") + 1); }) }; }) }, null, 1);
  };

  /* ============================================================ DRAWING
   * The board as SVG, in millimetres. The studio draws with this and the
   * "picture" export is the same drawing. */
  var esc = L.esc;
  X.COL = { top: "#e2574c", bottom: "#4f8ff7", pad: "#d9b24a", silk: "#f3f6f8", bsilk: "#c8b8ff", rat: "#ffd36b", board: "#0f3a2a", hole: "#0a0e12", zoneTop: "rgba(226,87,76,.28)", zoneBot: "rgba(79,143,247,.28)", strip: "#b07a3a" };
  function pathOf(pts, close) { return "M" + pts.map(function (p) { return r3(p[0]) + " " + r3(p[1]); }).join("L") + (close ? "Z" : ""); }
  X.pathOf = pathOf;
  X.padSvg = function (p, fill, extra) {
    var e = extra || "", w = p.w, h = p.h;
    if (p.shape === "circle" && Math.abs(w - h) < 0.01) return '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + r3(w / 2) + '" fill="' + fill + '"' + e + '/>';
    var rx = p.shape === "oval" || p.shape === "circle" ? Math.min(w, h) / 2 : p.shape === "roundrect" ? Math.min(w, h) * 0.25 : 0;
    return '<rect x="' + r3(p.x - w / 2) + '" y="' + r3(p.y - h / 2) + '" width="' + r3(w) + '" height="' + r3(h) + '" rx="' + r3(rx) + '" fill="' + fill + '"' + e + '/>';
  };
  X.drillSvg = function (p, fill) {
    if (p.slot && Math.abs(p.slot[0] - p.slot[1]) > 0.01) { var w = p.slot[0], h = p.slot[1]; return '<rect x="' + r3(p.x - w / 2) + '" y="' + r3(p.y - h / 2) + '" width="' + w + '" height="' + h + '" rx="' + r3(Math.min(w, h) / 2) + '" fill="' + fill + '"/>'; }
    return '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + r3(p.drill / 2) + '" fill="' + fill + '"/>';
  };
  /* opts: { look: "layers"|"real", vis: {top, bottom, silk, rats, zones}, sel, hover, flip, mask: "#2e7d4f", finish: "#d9b24a" } */
  X.svg = function (doc, model, opts) {
    opts = opts || {};
    var pcb = doc.pcb, R = X.rules(pcb), vis = opts.vis || { top: true, bottom: true, silk: true, rats: true, zones: true }, real = opts.look === "real", s = "", C = X.COL;
    var ol = X.outline(pcb), cuts = X.cutouts(pcb), pads = X.pads(doc, model), zones = X.zones(doc, model), uid = opts.uid || "b";
    var boardPath = pathOf(ol, true) + cuts.map(function (c) { return pathOf(c, true); }).join("");
    var maskCol = opts.mask || "#1f6b45", finish = opts.finish || "#d9b24a";
    var flipBottom = opts.flip;
    s += '<defs><clipPath id="' + uid + '-clip"><path d="' + boardPath + '" clip-rule="evenodd"/></clipPath></defs>';
    s += '<path d="' + boardPath + '" fill-rule="evenodd" fill="' + (real ? maskCol : C.board) + '" stroke="' + (real ? "#0b2a1c" : "#d9e6dc") + '" stroke-width="' + (real ? 0.25 : 0.2) + '"/>';
    if (!real) s += '<path d="' + boardPath + '" fill-rule="evenodd" fill="url(#' + uid + '-dots)" opacity=".5"/>';
    s += '<g clip-path="url(#' + uid + '-clip)">';
    var layerOrder = flipBottom ? [0, 1] : [1, 0];
    var copperSvg = function (l, col, alpha) {
      var g = "";
      if (vis.zones !== false) zones.filter(function (z) { return z.l === l; }).forEach(function (z) {
        var mid = uid + "-z" + z.id;
        g += '<mask id="' + mid + '"><path d="' + pathOf(z.pts, true) + '" fill="#fff"/>';
        pcb.tracks.forEach(function (t) { if (t.l === l && t.n + 1 !== z.net) g += '<path d="' + pathOf(t.pts) + '" stroke="#000" stroke-width="' + r3(t.w + 2 * R.clear) + '" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'; });
        pads.forEach(function (p) { if (p.layers.indexOf(l) >= 0 && p.net !== z.net) g += X.padSvg({ x: p.x, y: p.y, w: p.w + 2 * R.clear, h: p.h + 2 * R.clear, shape: p.shape }, "#000"); });
        pcb.vias.forEach(function (v) { if (v[2] + 1 !== z.net) g += '<circle cx="' + v[0] + '" cy="' + v[1] + '" r="' + r3(R.via / 2 + R.clear) + '" fill="#000"/>'; });
        X.npth(doc, model).forEach(function (h) { g += '<circle cx="' + h.x + '" cy="' + h.y + '" r="' + r3(h.d / 2 + R.clear) + '" fill="#000"/>'; });
        g += '<path d="' + pathOf(ol) + '" stroke="#000" stroke-width="' + r3(2 * R.edge) + '" fill="none"/>';
        cuts.forEach(function (c) { g += '<path d="' + pathOf(c) + '" stroke="#000" stroke-width="' + r3(2 * R.edge) + '" fill="none"/>'; });
        g += '</mask><path d="' + pathOf(z.pts, true) + '" fill="' + (real ? "rgba(255,255,255,.07)" : col) + '" opacity="' + (real ? 1 : 0.32) + '" mask="url(#' + mid + ')" data-zone="' + esc(z.id) + '"/>';
      });
      model.items.forEach(function (it) { if (!it.fp.strips) return; var pl = X.placeOf(doc, it); if ((pl.side === "bottom" ? 0 : 1) !== l) return; it.fp.strips.forEach(function (st) { var a = X.xf(pl, st[0], st[1]), b = X.xf(pl, st[2], st[3]); g += '<path d="M' + a[0] + " " + a[1] + "L" + b[0] + " " + b[1] + '" stroke="' + (real ? "rgba(255,255,255,.1)" : C.strip) + '" stroke-width="1.8" stroke-linecap="round" opacity="' + alpha + '"/>'; }); });
      pcb.tracks.forEach(function (t, i) {
        if (t.l !== l) return;
        var sel = opts.selTrack === i, hl = opts.net && t.n + 1 === opts.net;
        g += '<path d="' + pathOf(t.pts) + '" stroke="' + (real ? "rgba(255,255,255,.13)" : col) + '" stroke-width="' + t.w + '" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="' + (hl || sel ? 1 : alpha) + '" data-track="' + i + '"' + (sel ? ' class="sel"' : "") + '/>';
        if (sel || hl) g += '<path d="' + pathOf(t.pts) + '" stroke="#fff" stroke-width="' + r3(Math.max(0.08, t.w * 0.25)) + '" fill="none" stroke-dasharray="0.6 0.4" pointer-events="none"/>';
      });
      X.copperText(doc).forEach(function (ct) { if (ct.l === l) g += '<path d="' + pathOf(ct.pts) + '" stroke="' + (real ? "rgba(255,255,255,.13)" : col) + '" stroke-width="' + ct.w + '" fill="none" stroke-linecap="round" opacity="' + alpha + '"/>'; });
      return g;
    };
    layerOrder.forEach(function (l) { if (l === 0 ? vis.top !== false : vis.bottom !== false) s += copperSvg(l, l ? C.bottom : C.top, real ? 1 : (l === (flipBottom ? 1 : 0) ? 0.95 : 0.6)); });
    s += '</g>';
    /* pads, vias, holes */
    pads.forEach(function (p) {
      var onTop = p.layers.indexOf(flipBottom ? 1 : 0) >= 0;
      if (!onTop && real) return;
      if (!real && p.layers.length === 1 && ((p.layers[0] === 0 && vis.top === false) || (p.layers[0] === 1 && vis.bottom === false))) return;
      var hl = opts.net && p.net === opts.net;
      var col = real ? finish : p.layers.length === 2 ? C.pad : p.layers[0] === 1 ? "#7fa8e8" : "#e8a24a";
      s += X.padSvg(p, col, ' data-pad="' + esc(p.key) + '" data-item="' + esc(p.id) + '"' + (onTop ? "" : ' opacity=".55"') + (hl ? ' stroke="#fff" stroke-width="0.12"' : ""));
      if (p.drill) s += X.drillSvg(p, C.hole);
    });
    pcb.vias.forEach(function (v, i) { s += '<circle cx="' + v[0] + '" cy="' + v[1] + '" r="' + r3(R.via / 2) + '" fill="' + (real ? maskCol : "#b9c3cc") + '" stroke="' + (real ? "rgba(255,255,255,.18)" : "none") + '" stroke-width=".08" data-via="' + i + '"/><circle cx="' + v[0] + '" cy="' + v[1] + '" r="' + r3(R.viaDrill / 2) + '" fill="' + C.hole + '"/>'; });
    X.npth(doc, model).forEach(function (h) { s += '<circle cx="' + h.x + '" cy="' + h.y + '" r="' + r3(h.d / 2) + '" fill="' + C.hole + '" stroke="' + (real ? "#0b2a1c" : "#8a96a0") + '" stroke-width=".1"' + (h.id && h.id !== "corner" ? ' data-item="' + esc(h.id) + '"' : "") + '/>'; });
    /* silkscreen */
    if (vis.silk !== false) {
      var silk = X.silk(doc, model);
      [["bottom", real ? null : C.bsilk], ["top", real ? "#f6f7f2" : C.silk]].forEach(function (pair) {
        if (!pair[1]) return;
        var d = silk[pair[0]].map(function (st) { return pathOf(st); }).join("");
        if (d) s += '<path d="' + d + '" stroke="' + pair[1] + '" stroke-width=".15" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="' + (pair[0] === "bottom" ? 0.55 : 0.95) + '" pointer-events="none"/>';
      });
    }
    return s;
  };

  /* A standalone picture of the board. */
  X.svgFile = function (doc, model, opts) {
    var pcb = doc.pcb, m = 3;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (-m) + " " + (-m) + " " + r3(pcb.w + 2 * m) + " " + r3(pcb.h + 2 * m) + '" width="' + r3(pcb.w + 2 * m) + 'mm" height="' + r3(pcb.h + 2 * m) + 'mm">' +
      '<defs><pattern id="b-dots" width="2.54" height="2.54" patternUnits="userSpaceOnUse"><circle cx="1.27" cy="1.27" r=".12" fill="#5c8a72"/></pattern></defs>' +
      X.svg(doc, model, opts) + '</svg>';
  };

  /* One footprint as a picture, for the library browser and the part maker. */
  X.fpSvg = function (fp, size, opts) {
    opts = opts || {};
    var c = fp.court, m = 0.6, w = c.x1 - c.x0 + 2 * m, h = c.y1 - c.y0 + 2 * m, s = "";
    if (fp.body && opts.body !== false) { var b = fp.body; s += b.shape === "cyl" ? '<circle cx="' + b.x + '" cy="' + b.y + '" r="' + r3(b.w / 2) + '" fill="' + b.color + '" opacity=".55"/>' : '<rect x="' + r3(b.x - b.w / 2) + '" y="' + r3(b.y - b.h / 2) + '" width="' + b.w + '" height="' + b.h + '" rx=".3" fill="' + b.color + '" opacity=".55"/>'; }
    fp.pads.forEach(function (p) {
      var turned = (p.deg || 0) % 180 === 90, q = { x: p.x, y: p.y, w: turned ? p.h : p.w, h: turned ? p.w : p.h, shape: p.shape, drill: p.drill, slot: p.slot };
      s += X.padSvg(q, p.drill || p.slot ? X.COL.pad : "#e8a24a", opts.pins ? ' data-pad="' + esc(p.n) + '"' + (opts.pick === p.n ? ' stroke="#fff" stroke-width="' + r3(Math.max(0.1, w / 120)) + '"' : "") : "");
      if (p.drill || p.slot) s += X.drillSvg(q, X.COL.hole);
    });
    (fp.holes || []).forEach(function (hh) { s += '<circle cx="' + hh.x + '" cy="' + hh.y + '" r="' + r3(hh.d / 2) + '" fill="' + X.COL.hole + '" stroke="#8a96a0" stroke-width=".08"/>'; });
    var sw = r3(Math.max(0.1, w / 140));
    fp.silk.forEach(function (k) {
      if (k.l) s += '<line x1="' + k.l[0] + '" y1="' + k.l[1] + '" x2="' + k.l[2] + '" y2="' + k.l[3] + '" stroke="#f3f6f8" stroke-width="' + sw + '"/>';
      else if (k.c) s += '<circle cx="' + k.c[0] + '" cy="' + k.c[1] + '" r="' + k.c[2] + '" fill="none" stroke="#f3f6f8" stroke-width="' + sw + '"/>';
      else if (k.a) { var a = k.a, rad = function (d) { return d * Math.PI / 180; }; s += '<path d="M' + r3(a[0] + a[2] * Math.cos(rad(a[3]))) + " " + r3(a[1] + a[2] * Math.sin(rad(a[3]))) + "A" + a[2] + " " + a[2] + " 0 " + (Math.abs(a[4] - a[3]) > 180 ? 1 : 0) + " 1 " + r3(a[0] + a[2] * Math.cos(rad(a[4]))) + " " + r3(a[1] + a[2] * Math.sin(rad(a[4]))) + '" fill="none" stroke="#f3f6f8" stroke-width="' + sw + '"/>'; }
      else if (k.d) s += '<circle cx="' + k.d[0] + '" cy="' + k.d[1] + '" r="' + r3(Math.max(0.2, w / 60)) + '" fill="#f3f6f8"/>';
    });
    /* each label sized to fit inside its own pad; on a tall pad it runs up the pad */
    if (opts.labels) fp.pads.forEach(function (p) {
      var t = (p.deg || 0) % 180 === 90, pw = t ? p.h : p.w, ph = t ? p.w : p.h, label = String(opts.labels === "name" ? (p.name || p.n) : p.n).slice(0, 8);
      var up = ph > pw * 1.4, along = up ? ph : pw, across = up ? pw : ph;
      var fs = r3(Math.min(across * 0.62, along * 0.92 / Math.max(1, label.length * 0.6), w / 16));
      if (fs < 0.12) return;
      s += '<text x="' + p.x + '" y="' + p.y + '" dy="0.35em" font-size="' + fs + '" text-anchor="middle" fill="' + (p.drill || p.slot ? "#f3f6f8" : "#10161c") + '" font-family="system-ui,sans-serif" font-weight="700" pointer-events="none"' + (up ? ' transform="rotate(-90 ' + p.x + " " + p.y + ')"' : "") + '>' + esc(label) + '</text>';
    });
    return '<svg viewBox="' + r3(c.x0 - m) + " " + r3(c.y0 - m) + " " + r3(w) + " " + r3(h) + '"' + (size ? ' width="' + size + '" height="' + size + '"' : "") + ' aria-hidden="true"><rect x="' + r3(c.x0 - m) + '" y="' + r3(c.y0 - m) + '" width="' + r3(w) + '" height="' + r3(h) + '" fill="#123a2b" rx="' + r3(w / 30) + '"/>' + s + '</svg>';
  };
})(typeof window !== "undefined" ? window : globalThis);
