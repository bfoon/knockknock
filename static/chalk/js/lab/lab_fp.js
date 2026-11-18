/* Chalk Circuit Lab — footprints, packages and the parts you make.
 *
 * Everything a board needs to know about a component's feet, in millimetres:
 * where each pad is, its shape and size, whether a hole goes through, the
 * silkscreen round it and the body that stands on it. Footprints are made by
 * generators — one per package family — from the numbers on a datasheet, so a
 * SOIC-14 and a SOIC-16 are the same few lines with a different pin count.
 *
 *   L.FP.get(id)                 a library footprint ("SOIC-8", "USB-C-16"…)
 *   L.FP.LIB                     the library, for the studio's browser
 *   L.FP.gen.<family>(params)    make one from numbers (the part designer)
 *   L.FP.PARTS                   real components (NE555, AMS1117, USB-C…)
 *                                with pin names, a footprint and, where the
 *                                bench has one, the part that simulates it
 *   L.FP.kicad(fp) / fromKicad   .kicad_mod out and in
 *   L.FP.fromText("qfn 32 5x5")  a footprint from a few words
 *   L.FP.register(custom)        a part you designed, onto the bench drawer
 *
 * A footprint is plain data:
 *   { id, name, ref, kind: "tht"|"smd", pads: [{n, name, x, y, shape, w, h,
 *     drill, slot, side, deg}], holes: [{x, y, d}], silk: [{l|c|a|t…}],
 *     body: {x, y, w, h, z, shape, color, look}, court: {x0, y0, x1, y1} }
 * The origin is the middle of the part, which is also what a pick-and-place
 * machine wants. y runs down the page, as on the bench.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab = root.ChalkLab || {};
  var FP = L.FP = {};
  var r3 = function (v) { return Math.round(v * 1000) / 1000; };

  /* ============================================================ BUILDING */

  function F(name, ref) { return { id: "", name: name, ref: ref || "U", kind: "tht", pads: [], holes: [], silk: [], body: null, pins: {} }; }
  function pad(f, n, x, y, shape, w, h, drill, extra) {
    var p = { n: String(n), x: r3(x), y: r3(y), shape: shape, w: r3(w), h: r3(h == null ? w : h), drill: drill || 0 };
    if (extra) for (var k in extra) p[k] = extra[k];
    if (!p.drill && !p.side) p.side = "top";
    f.pads.push(p);
    return p;
  }
  function line(f, x1, y1, x2, y2) { f.silk.push({ l: [r3(x1), r3(y1), r3(x2), r3(y2)] }); }
  function box(f, x0, y0, x1, y1) { line(f, x0, y0, x1, y0); line(f, x1, y0, x1, y1); line(f, x1, y1, x0, y1); line(f, x0, y1, x0, y0); }
  function circ(f, x, y, r) { f.silk.push({ c: [r3(x), r3(y), r3(r)] }); }
  function arc(f, x, y, r, a0, a1) { f.silk.push({ a: [r3(x), r3(y), r3(r), a0, a1] }); }
  function dot(f, x, y) { f.silk.push({ d: [r3(x), r3(y)] }); }
  function body(f, w, h, z, color, look, extra) {
    f.body = { x: 0, y: 0, w: r3(w), h: r3(h), z: z, shape: "box", color: color || "#1d1f22", look: look || "ic" };
    if (extra) for (var k in extra) f.body[k] = extra[k];
  }
  /* the courtyard: everything the part covers, plus a quarter of a millimetre */
  function finish(f, id) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, eat = function (x, y) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    f.pads.forEach(function (p) { var e = FP.padExtent(p); eat(p.x - e.hx, p.y - e.hy); eat(p.x + e.hx, p.y + e.hy); });
    f.holes.forEach(function (h) { eat(h.x - h.d / 2, h.y - h.d / 2); eat(h.x + h.d / 2, h.y + h.d / 2); });
    if (f.body) { var b = f.body; if (b.shape === "cyl") { eat(b.x - b.w / 2, b.y - b.w / 2); eat(b.x + b.w / 2, b.y + b.w / 2); } else { eat(b.x - b.w / 2, b.y - b.h / 2); eat(b.x + b.w / 2, b.y + b.h / 2); } }
    if (x1 < x0) { x0 = y0 = -1; x1 = y1 = 1; }
    f.court = { x0: r3(x0 - 0.25), y0: r3(y0 - 0.25), x1: r3(x1 + 0.25), y1: r3(y1 + 0.25) };
    f.kind = f.pads.some(function (p) { return p.drill; }) ? (f.pads.some(function (p) { return !p.drill; }) ? "mixed" : "tht") : "smd";
    if (id) f.id = id;
    return f;
  }
  FP.finish = finish;
  /* half-size of a pad's bounding box, turned */
  FP.padExtent = function (p) {
    var a = ((p.deg || 0) % 180 + 180) % 180;
    if (a === 90) return { hx: p.h / 2, hy: p.w / 2 };
    if (a === 0 || p.shape === "circle") return { hx: p.w / 2, hy: p.h / 2 };
    var r = Math.hypot(p.w, p.h) / 2;
    return { hx: r, hy: r };
  };

  var G = FP.gen = {};

  /* ---------------------------------------------------------------- ICs */

  /* Dual in-line: pin 1 top left, down the left, back up the right. */
  G.dip = function (o) {
    var n = o.n || 8, wideDefault = n >= 40, span = o.span || (wideDefault ? 15.24 : 7.62), pitch = o.pitch || 2.54, half = n / 2, f = F("DIP-" + n, o.ref || "U");
    for (var i = 0; i < half; i++) {
      var y = (i - (half - 1) / 2) * pitch;
      pad(f, i + 1, -span / 2, y, i ? "oval" : "rect", 1.6, 1.6, 0.8);
      pad(f, n - i, span / 2, y, "oval", 1.6, 1.6, 0.8);
    }
    var bw = span - 1.3, bh = half * pitch + 0.2, t = -bh / 2;
    line(f, -bw / 2, t, -1, t); line(f, 1, t, bw / 2, t); arc(f, 0, t, 1, 0, 180);
    line(f, bw / 2, t, bw / 2, -t); line(f, bw / 2, -t, -bw / 2, -t); line(f, -bw / 2, -t, -bw / 2, t);
    body(f, bw, bh, 3.6, "#1d1f22", "ic", { label: o.label || "" });
    return finish(f, "DIP-" + n + (span === 15.24 && !wideDefault ? "-W" : span === 7.62 && wideDefault ? "-N" : ""));
  };
  /* Gull-wing legs on two sides: SOIC, SSOP, TSSOP, MSOP. */
  G.so = function (o) {
    var n = o.n || 8, pitch = o.pitch || 1.27, span = o.span || 5.4, pl = o.padL || 1.55, pw = o.padW || 0.6, bw = o.bodyW || 3.9, half = n / 2;
    var f = F((o.name || "SOIC") + "-" + n, o.ref || "U"), bl = o.bodyL || (half * pitch + 0.4);
    for (var i = 0; i < half; i++) {
      var y = (i - (half - 1) / 2) * pitch;
      pad(f, i + 1, -span / 2, y, "roundrect", pl, pw);
      pad(f, n - i, span / 2, y, "roundrect", pl, pw);
    }
    line(f, -bw / 2, -bl / 2, bw / 2, -bl / 2); line(f, -bw / 2, bl / 2, bw / 2, bl / 2);
    dot(f, -span / 2 - pl / 2 - 0.4, -(half - 1) / 2 * pitch);
    body(f, bw, bl, o.z || 1.6, "#1d1f22", "ic");
    return finish(f, (o.name || "SOIC") + "-" + n);
  };
  /* Legs on four sides, under the body (QFN/DFN) or sticking out (QFP). */
  G.quad = function (o) {
    var n = o.n || 32, k = n / 4, size = o.size || 5, pitch = o.pitch || 0.5, out = !!o.leads;
    var pl = o.padL || (out ? 1.5 : 0.85), pw = o.padW || Math.min(0.3, pitch * 0.55);
    var c = out ? (o.span || size + 2) / 2 - pl / 2 + 0.2 : size / 2 - pl / 2 + 0.3;
    var name = o.name || (out ? "LQFP" : "QFN"), f = F(name + "-" + n, o.ref || "U");
    for (var i = 0; i < k; i++) {
      var d = (i - (k - 1) / 2) * pitch;
      pad(f, 1 + i, -c, d, "roundrect", pl, pw);
      pad(f, 1 + k + i, d, c, "roundrect", pw, pl);
      pad(f, 1 + 2 * k + i, c, -d, "roundrect", pl, pw);
      pad(f, 1 + 3 * k + i, -d, -c, "roundrect", pw, pl);
    }
    if (o.ep) pad(f, n + 1, 0, 0, "rect", o.ep, o.ep, 0, { name: "EP" });
    var s = size / 2, m = Math.min(0.6, s / 4);
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) { line(f, q[0] * s, q[1] * s, q[0] * (s - m), q[1] * s); line(f, q[0] * s, q[1] * s, q[0] * s, q[1] * (s - m)); });
    dot(f, -c - pl / 2 - 0.4, -(k - 1) / 2 * pitch);
    body(f, size, size, out ? 1.6 : 0.9, "#1d1f22", "ic");
    return finish(f, name + "-" + n + "-" + size + "x" + size + "-" + pitch);
  };
  G.sot23 = function (o) {
    var n = o.n || 3, f = F("SOT-23" + (n > 3 ? "-" + n : ""), o.ref || (n === 3 ? "Q" : "U"));
    if (n === 3) { pad(f, 1, -0.95, 1.1, "roundrect", 0.6, 1.05); pad(f, 2, 0.95, 1.1, "roundrect", 0.6, 1.05); pad(f, 3, 0, -1.1, "roundrect", 0.6, 1.05); }
    else {
      [-0.95, 0, 0.95].forEach(function (x, i) { pad(f, i + 1, x, 1.15, "roundrect", 0.6, 1.1); });
      if (n === 5) { pad(f, 4, 0.95, -1.15, "roundrect", 0.6, 1.1); pad(f, 5, -0.95, -1.15, "roundrect", 0.6, 1.1); }
      else [0.95, 0, -0.95].forEach(function (x, i) { pad(f, i + 4, x, -1.15, "roundrect", 0.6, 1.1); });
    }
    line(f, -1.5, -0.4, -1.5, 0.4); line(f, 1.5, -0.4, 1.5, 0.4);
    body(f, 2.9, 1.6, 1.1, "#1d1f22", "ic");
    return finish(f, "SOT-23" + (n > 3 ? "-" + n : ""));
  };
  G.sot223 = function (o) {
    var f = F("SOT-223", o.ref || "U");
    [-2.3, 0, 2.3].forEach(function (x, i) { pad(f, i + 1, x, 3.15, "roundrect", 1.0, 2.0); });
    pad(f, 4, 0, -3.15, "roundrect", 3.3, 2.0);
    line(f, -3.4, -1.9, -3.4, 1.9); line(f, 3.4, -1.9, 3.4, 1.9);
    body(f, 6.5, 3.5, 1.7, "#1d1f22", "ic");
    return finish(f, "SOT-223");
  };
  G.dpak = function (o) {
    var f = F("TO-252 (DPAK)", o.ref || "Q");
    pad(f, 1, -2.28, 4.0, "roundrect", 1.2, 2.2); pad(f, 3, 2.28, 4.0, "roundrect", 1.2, 2.2);
    pad(f, 2, 0, -2.2, "roundrect", 5.8, 6.2);
    body(f, 6.6, 6.1, 2.3, "#1d1f22", "ic");
    return finish(f, "TO-252");
  };
  G.to92 = function (o) {
    var pitch = o.pitch || 1.27, f = F("TO-92" + (pitch > 2 ? " wide" : ""), o.ref || "Q");
    for (var i = 0; i < 3; i++) pad(f, i + 1, (i - 1) * pitch, 0, i ? "oval" : "rect", 1.05, 1.5, 0.75);
    arc(f, 0, 0.6, 2.5, 200, 340); line(f, -2.35, -0.25, 2.35, -0.25);
    body(f, 4.8, 3.8, 4.8, "#1d1f22", "to92", { y: 0.4, shape: "half" });
    return finish(f, "TO-92" + (pitch > 2 ? "-W" : ""));
  };
  G.to220 = function (o) {
    var flat = !!o.flat, f = F("TO-220" + (flat ? " flat" : ""), o.ref || "Q");
    for (var i = 0; i < 3; i++) pad(f, i + 1, (i - 1) * 2.54, 0, i ? "oval" : "rect", 1.9, 2.4, 1.1);
    if (flat) {
      f.holes.push({ x: 0, y: -13.6, d: 3.6 });
      box(f, -5.2, -3.6, 5.2, -18.7);
      body(f, 10.2, 15.1, 4.5, "#1d1f22", "to220", { y: -11.15, flat: true });
    } else {
      box(f, -5.2, -3.2, 5.2, 1.6); line(f, -5.2, -1.9, 5.2, -1.9);
      body(f, 10.2, 4.6, 15.5, "#1d1f22", "to220", { y: -0.8 });
    }
    return finish(f, "TO-220" + (flat ? "-H" : ""));
  };

  /* ------------------------------------------------------------ PASSIVES */

  var CHIP = {
    "0402": [0.51, 0.6, 0.6, 1.0, 0.5, 0.35], "0603": [0.8, 0.9, 0.95, 1.6, 0.8, 0.45], "0805": [0.95, 1.0, 1.45, 2.0, 1.25, 0.5],
    "1206": [1.5, 1.15, 1.8, 3.2, 1.6, 0.55], "1210": [1.5, 1.15, 2.7, 3.2, 2.5, 0.6], "2512": [3.0, 1.6, 3.4, 6.3, 3.2, 0.6]
  };
  FP.CHIPS = Object.keys(CHIP);
  G.chip = function (o) {
    var code = CHIP[o.size] ? o.size : "0805", c = CHIP[code], kind = o.kind || "R", f = F(kind + " " + code, kind === "C" ? "C" : kind === "L" ? "L" : kind === "D" ? "D" : "R");
    pad(f, 1, -c[0], 0, "roundrect", c[1], c[2]); pad(f, 2, c[0], 0, "roundrect", c[1], c[2]);
    if (code !== "0402") { line(f, -c[3] / 2 + 0.6, -c[4] / 2 - 0.25, c[3] / 2 - 0.6, -c[4] / 2 - 0.25); line(f, -c[3] / 2 + 0.6, c[4] / 2 + 0.25, c[3] / 2 - 0.6, c[4] / 2 + 0.25); }
    var col = kind === "C" ? "#b98a52" : kind === "L" ? "#4a4d52" : kind === "D" ? "#f2f2ee" : "#1d1f22";
    body(f, c[3], c[4], c[5], col, kind === "C" ? "chipcap" : kind === "D" ? "chipled" : "chipres", { led: o.led || null });
    return finish(f, kind + "_" + code);
  };
  G.axial = function (o) {
    var pitch = o.pitch || 10.16, drill = o.drill || 0.8, kind = o.kind || "R", f = F((kind === "D" ? "Diode" : "Resistor") + " axial " + pitch, kind === "D" ? "D" : "R");
    var bl = o.bodyL || (kind === "D" ? (drill > 0.9 ? 5.2 : 3.8) : pitch > 8 ? 6.3 : 3.6), bd = o.bodyD || (kind === "D" ? (drill > 0.9 ? 2.7 : 1.9) : pitch > 8 ? 2.5 : 1.8);
    pad(f, 1, -pitch / 2, 0, kind === "D" ? "rect" : "circle", 1.6 + (drill > 0.9 ? 0.4 : 0), 1.6 + (drill > 0.9 ? 0.4 : 0), drill);
    pad(f, 2, pitch / 2, 0, "circle", 1.6 + (drill > 0.9 ? 0.4 : 0), null, drill);
    box(f, -bl / 2 - 0.15, -bd / 2 - 0.15, bl / 2 + 0.15, bd / 2 + 0.15);
    line(f, -pitch / 2 + 1, 0, -bl / 2 - 0.15, 0); line(f, bl / 2 + 0.15, 0, pitch / 2 - 1, 0);
    if (kind === "D") line(f, -bl / 2 + 0.6, -bd / 2 - 0.15, -bl / 2 + 0.6, bd / 2 + 0.15);
    body(f, bl, bd, bd, kind === "D" ? "#1d1f22" : "#d8c79a", kind === "D" ? "axiald" : "axialr", { shape: "rod", axis: "x" });
    var id = (kind === "D" ? "D_Axial_" : "R_Axial_") + (o.std || pitch);
    return finish(f, id);
  };
  G.radial = function (o) {
    var d = o.d || 6.3, pitch = o.pitch || (d < 6 ? 2.0 : d < 8 ? 2.5 : d < 10 ? 3.5 : 5.0), z = o.z || (d < 6 ? 11 : d < 8 ? 11 : d < 10 ? 12 : 16);
    var f = F("Electrolytic " + d + " mm", "C"), drill = d >= 10 ? 1.0 : 0.8;
    pad(f, 1, -pitch / 2, 0, "rect", 1.6, 1.6, drill, { name: "+" }); pad(f, 2, pitch / 2, 0, "circle", 1.6, 1.6, drill, { name: "-" });
    circ(f, 0, 0, d / 2 + 0.15);
    line(f, -d / 2 - 0.6, -d / 2 + 0.3, -d / 2 + 0.4, -d / 2 + 0.3); line(f, -d / 2 - 0.1, -d / 2 - 0.2, -d / 2 - 0.1, -d / 2 + 0.8);
    body(f, d, d, z, "#2b3a6a", "elcap", { shape: "cyl" });
    return finish(f, "C_EL_" + d + "x" + z);
  };
  G.disc = function (o) {
    var pitch = o.pitch || 5.08, f = F("Ceramic disc " + pitch, "C");
    pad(f, 1, -pitch / 2, 0, "circle", 1.6, 1.6, 0.8); pad(f, 2, pitch / 2, 0, "circle", 1.6, 1.6, 0.8);
    box(f, -pitch / 2 - 1.2, -1.4, pitch / 2 + 1.2, 1.4);
    body(f, pitch + 1.8, 2.5, 6, "#d58a2a", "disc");
    return finish(f, "C_Disc_" + pitch);
  };
  G.tant = function (o) {
    var big = o.case === "B", f = F("Tantalum case " + (big ? "B (3528)" : "A (3216)"), "C"), x = big ? 1.5 : 1.4;
    pad(f, 1, -x, 0, "roundrect", 1.3, big ? 2.3 : 1.4, 0, { name: "+" }); pad(f, 2, x, 0, "roundrect", 1.3, big ? 2.3 : 1.4, 0, { name: "-" });
    line(f, -x - 1.2, -1.2, -x - 1.2, 1.2);
    body(f, big ? 3.5 : 3.2, big ? 2.8 : 1.6, big ? 1.9 : 1.6, "#d9a72b", "tant");
    return finish(f, "C_Tant_" + (big ? "B" : "A"));
  };
  G.inductor = function (o) {
    var s = o.size || 4, f = F("Power inductor " + s + "×" + s, "L");
    pad(f, 1, -s * 0.38, 0, "roundrect", s * 0.3, s * 0.9); pad(f, 2, s * 0.38, 0, "roundrect", s * 0.3, s * 0.9);
    box(f, -s / 2 - 0.2, -s / 2 - 0.2, s / 2 + 0.2, s / 2 + 0.2);
    body(f, s, s, s * 0.5, "#3a3d42", "inductor");
    return finish(f, "L_" + s + "x" + s);
  };
  G.crystal = function (o) {
    var f;
    if (o.smd) {
      f = F("Crystal 3225 (4 pad)", "Y");
      pad(f, 1, -1.1, 0.8, "roundrect", 1.4, 1.15); pad(f, 2, 1.1, 0.8, "roundrect", 1.4, 1.15, 0, { name: "GND" }); pad(f, 3, 1.1, -0.8, "roundrect", 1.4, 1.15); pad(f, 4, -1.1, -0.8, "roundrect", 1.4, 1.15, 0, { name: "GND" });
      body(f, 3.2, 2.5, 0.8, "#c8ccd0", "xtal");
      return finish(f, "Crystal_3225");
    }
    f = F("Crystal HC-49/US", "Y");
    pad(f, 1, -2.44, 0, "circle", 1.5, 1.5, 0.8); pad(f, 2, 2.44, 0, "circle", 1.5, 1.5, 0.8);
    line(f, -3.5, -2.35, 3.5, -2.35); line(f, -3.5, 2.35, 3.5, 2.35); arc(f, -3.5, 0, 2.35, 90, 270); arc(f, 3.5, 0, 2.35, -90, 90);
    body(f, 11.0, 4.65, 3.6, "#c8ccd0", "xtal");
    return finish(f, "Crystal_HC49");
  };

  /* --------------------------------------------------- DIODES AND LEDS */

  G.led = function (o) {
    var d = o.d || 5, f = F("LED " + d + " mm", "D");
    pad(f, 1, -1.27, 0, "rect", 1.8, 1.8, 0.9, { name: "K" }); pad(f, 2, 1.27, 0, "circle", 1.8, 1.8, 0.9, { name: "A" });
    arc(f, 0, 0, d / 2 + 0.4, -60, 240); line(f, -(d / 2 + 0.4) * 0.5, -(d / 2 + 0.4) * 0.866, -(d / 2 + 0.4) * 0.5, (d / 2 + 0.4) * 0.866);
    body(f, d, d, d === 3 ? 5.3 : 8.6, L.LED_COLORS && L.LED_COLORS[o.color] ? L.LED_COLORS[o.color].fill : "#e0261c", "led", { shape: "cyl", led: o.color || "red" });
    return finish(f, "LED_D" + d);
  };
  G.diodeSmd = function (o) {
    var big = o.case === "SMA", f = F(big ? "Diode SMA (DO-214AC)" : "Diode SOD-123", "D"), x = big ? 2.0 : 1.65;
    pad(f, 1, -x, 0, "roundrect", big ? 1.5 : 0.9, big ? 2.0 : 1.2, 0, { name: "K" }); pad(f, 2, x, 0, "roundrect", big ? 1.5 : 0.9, big ? 2.0 : 1.2, 0, { name: "A" });
    line(f, -x - 1.0, -1.2, -x - 1.0, 1.2);
    body(f, big ? 4.3 : 2.7, big ? 2.6 : 1.6, big ? 2.1 : 1.1, "#1d1f22", "sod");
    return finish(f, big ? "D_SMA" : "D_SOD-123");
  };
  G.ledRgb = function (o) {
    var f = F("RGB LED 5050 (WS2812B)", "D");
    var names = ["VDD", "DOUT", "GND", "DIN"];
    [[-2.45, -1.6], [-2.45, 1.6], [2.45, 1.6], [2.45, -1.6]].forEach(function (q, i) { pad(f, i + 1, q[0], q[1], "roundrect", 1.5, 1.0, 0, { name: names[i] }); });
    box(f, -2.6, -2.6, 2.6, 2.6); line(f, 2.6, 2.6, 1.6, 2.6);
    body(f, 5, 5, 1.6, "#f4f4f0", "rgb");
    return finish(f, "LED_WS2812B");
  };

  /* ---------------------------------------------------------- CONNECTORS */

  G.header = function (o) {
    var rows = o.rows || 1, n = o.n || 4, pitch = o.pitch || 2.54, female = !!o.female, cols = Math.ceil(n / rows);
    var f = F((female ? "Socket " : "Pin header ") + rows + "×" + cols + " " + pitch, "J"), k = 1;
    var ps = pitch >= 2.5 ? 1.7 : pitch >= 2 ? 1.35 : 1.0, dr = pitch >= 2.5 ? 1.0 : pitch >= 2 ? 0.8 : 0.65;
    for (var c = 0; c < cols; c++) for (var r = 0; r < rows; r++) {
      if (k > n) break;
      pad(f, k, (r - (rows - 1) / 2) * pitch, (c - (cols - 1) / 2) * pitch, k === 1 ? "rect" : "oval", ps, ps, dr);
      k++;
    }
    box(f, -rows * pitch / 2, -cols * pitch / 2, rows * pitch / 2, cols * pitch / 2);
    body(f, rows * pitch, cols * pitch, female ? 8.5 : 2.5, "#1d1f22", female ? "socket" : "header", { pins: !female });
    return finish(f, (female ? "SKT-" : "HDR-") + rows + "x" + cols + "-" + pitch);
  };
  G.jst = function (o) {
    var type = o.type || "XH", n = o.n || 2, T = { XH: [2.5, 1.7, 2.0, 0.95, 4.9, 5.75, 7.0], PH: [2.0, 1.2, 1.75, 0.75, 3.9, 4.5, 6.0] }[type === "PH" ? "PH" : "XH"];
    if (type === "SH") {
      var fs = F("JST-SH " + n + "-pin (Qwiic)", "J");
      for (var i = 0; i < n; i++) pad(fs, i + 1, (i - (n - 1) / 2) * 1.0, -1.2, "roundrect", 0.6, 1.55);
      var mx = (n - 1) / 2 + 1.3;
      pad(fs, "MP", -mx, 1.3, "roundrect", 1.2, 1.8, 0, { name: "MP" }); pad(fs, "MP", mx, 1.3, "roundrect", 1.2, 1.8, 0, { name: "MP" });
      box(fs, -mx - 0.8, -0.3, mx + 0.8, 2.4);
      body(fs, n + 3, 4.25, 2.9, "#f2f0e8", "jst", { y: 0.9 });
      return finish(fs, "JST-SH-" + n);
    }
    var f = F("JST-" + type + " " + n + "-pin", "J"), p = T[0];
    for (var j = 0; j < n; j++) pad(f, j + 1, (j - (n - 1) / 2) * p, 0, j ? "oval" : "rect", T[1], T[2], T[3]);
    var bw = (n - 1) * p + T[4], y0 = -T[5] + 2.3;
    box(f, -bw / 2, y0, bw / 2, y0 + T[5]);
    body(f, bw, T[5], T[6], "#f2f0e8", "jst", { y: y0 + T[5] / 2 });
    return finish(f, "JST-" + type + "-" + n);
  };
  G.screw = function (o) {
    var n = o.n || 2, p = o.pitch || 5.08, big = p > 4, f = F("Screw terminal " + n + "-way " + p, "J");
    for (var i = 0; i < n; i++) pad(f, i + 1, (i - (n - 1) / 2) * p, 0, i ? "circle" : "rect", big ? 2.4 : 1.9, null, big ? 1.3 : 1.1);
    var bw = n * p + 0.2;
    box(f, -bw / 2, -(big ? 4.2 : 3.6), bw / 2, big ? 4.0 : 3.4);
    body(f, bw, big ? 8.2 : 7.0, big ? 10 : 8.5, big ? "#2f6fd1" : "#2fa35a", "screw", { y: -0.1, n: n, pitch: p });
    return finish(f, "TERM-" + p + "-" + n);
  };
  G.idc = function (o) {
    var n = o.n || 10, f = F("IDC box header 2×" + n / 2, "J"), cols = n / 2;
    for (var c = 0; c < cols; c++) for (var r = 0; r < 2; r++) { var k = c * 2 + r + 1; pad(f, k, (r - 0.5) * 2.54, (c - (cols - 1) / 2) * 2.54, k === 1 ? "rect" : "oval", 1.7, 1.7, 1.0); }
    var bh = cols * 2.54 + 7.6;
    box(f, -4.45, -bh / 2, 4.45, bh / 2); line(f, -4.45, -2.25, -3.45, -2.25); line(f, -3.45, -2.25, -3.45, 2.25); line(f, -3.45, 2.25, -4.45, 2.25);
    body(f, 8.9, bh, 9, "#1d1f22", "idc");
    return finish(f, "IDC-2x" + cols);
  };
  /* USB, HDMI, RJ45 and friends: the geometry of the common parts (HRO, Molex,
   * Amphenol, CUI), close enough to order a board with, named the way their
   * datasheets name the pins. */
  G.usbc = function () {
    var f = F("USB-C receptacle (USB 2.0, 16 pin)", "J");
    var cols = [[-3.2, ["A1", "B12"], "GND", 0.6], [-2.4, ["A4", "B9"], "VBUS", 0.6], [-1.75, ["B8"], "SBU2", 0.3], [-1.25, ["A5"], "CC1", 0.3], [-0.75, ["B7"], "D-", 0.3], [-0.25, ["A6"], "D+", 0.3],
      [0.25, ["A7"], "D-", 0.3], [0.75, ["B6"], "D+", 0.3], [1.25, ["A8"], "SBU1", 0.3], [1.75, ["B5"], "CC2", 0.3], [2.4, ["B4", "A9"], "VBUS", 0.6], [3.2, ["B1", "A12"], "GND", 0.6]];
    cols.forEach(function (c) { pad(f, c[1][0], c[0], -3.0, "roundrect", c[3], 1.45, 0, { name: c[2], also: c[1].slice(1) }); });
    [[-4.32, -2.4, 1.7], [4.32, -2.4, 1.7], [-4.32, 1.78, 1.4], [4.32, 1.78, 1.4]].forEach(function (q) { pad(f, "S1", q[0], q[1], "oval", 1.0, q[2] + 0.4, 0.6, { name: "SHIELD", slot: [0.6, q[2]] }); });
    f.holes.push({ x: -2.89, y: -1.95, d: 0.65 }, { x: 2.89, y: -1.95, d: 0.65 });
    line(f, -4.47, 3.7, 4.47, 3.7);
    body(f, 8.94, 7.35, 3.26, "#c3c9ce", "usbc", { y: 0.35, edge: "bottom" });
    return finish(f, "USB-C-16");
  };
  G.usbMicro = function () {
    var f = F("Micro-USB B (SMD)", "J"), nm = ["VBUS", "D-", "D+", "ID", "GND"];
    for (var i = 0; i < 5; i++) pad(f, i + 1, (i - 2) * 0.65, -2.68, "roundrect", 0.4, 1.35, 0, { name: nm[i] });
    pad(f, "6", -2.5, -2.45, "roundrect", 1.4, 1.6, 0, { name: "SHIELD" }); pad(f, "6", 2.5, -2.45, "roundrect", 1.4, 1.6, 0, { name: "SHIELD" });
    pad(f, "6", -1.2, 0.0, "roundrect", 1.9, 1.9, 0, { name: "SHIELD" }); pad(f, "6", 1.2, 0.0, "roundrect", 1.9, 1.9, 0, { name: "SHIELD" });
    line(f, -3.75, 2.45, 3.75, 2.45);
    body(f, 7.5, 5.0, 2.6, "#c3c9ce", "usbmicro", { y: 0.2, edge: "bottom" });
    return finish(f, "USB-MicroB");
  };
  G.usbMini = function () {
    var f = F("Mini-USB B (SMD)", "J"), nm = ["VBUS", "D-", "D+", "ID", "GND"];
    for (var i = 0; i < 5; i++) pad(f, i + 1, (i - 2) * 0.8, -3.0, "roundrect", 0.5, 2.25, 0, { name: nm[i] });
    [[-4.45, -2.9], [4.45, -2.9], [-4.45, 2.6], [4.45, 2.6]].forEach(function (q) { pad(f, "6", q[0], q[1], "roundrect", 2.0, 2.5, 0, { name: "SHIELD" }); });
    f.holes.push({ x: -2.2, y: 0, d: 0.9 }, { x: 2.2, y: 0, d: 0.9 });
    body(f, 7.7, 9.2, 4.0, "#c3c9ce", "usbmini", { edge: "bottom" });
    return finish(f, "USB-MiniB");
  };
  G.usbA = function () {
    var f = F("USB-A receptacle (through-hole)", "J"), nm = ["VBUS", "D-", "D+", "GND"];
    [3.5, 1.0, -1.0, -3.5].forEach(function (x, i) { pad(f, i + 1, x, -4.7, i ? "circle" : "rect", 1.5, 1.5, 0.92, { name: nm[i] }); });
    pad(f, "5", -6.57, -2.0, "oval", 3.0, 3.0, 2.3, { name: "SHIELD" }); pad(f, "5", 6.57, -2.0, "oval", 3.0, 3.0, 2.3, { name: "SHIELD" });
    box(f, -7.0, -6.2, 7.0, 7.9);
    body(f, 13.1, 14.0, 7.0, "#c3c9ce", "usba", { y: 0.85, edge: "bottom" });
    return finish(f, "USB-A");
  };
  G.usbB = function () {
    var f = F("USB-B receptacle (through-hole)", "J"), nm = ["VBUS", "D-", "D+", "GND"];
    [[1.25, -4.71], [-1.25, -4.71], [-1.25, -2.71], [1.25, -2.71]].forEach(function (q, i) { pad(f, i + 1, q[0], q[1], i ? "circle" : "rect", 1.5, 1.5, 0.92, { name: nm[i] }); });
    pad(f, "5", -6.02, 0, "circle", 3.2, 3.2, 2.3, { name: "SHIELD" }); pad(f, "5", 6.02, 0, "circle", 3.2, 3.2, 2.3, { name: "SHIELD" });
    box(f, -6.0, -6.5, 6.0, 10.0);
    body(f, 12.0, 16.5, 11.0, "#c3c9ce", "usbb", { y: 1.75, edge: "bottom" });
    return finish(f, "USB-B");
  };
  G.hdmi = function () {
    var f = F("HDMI type A receptacle (SMD)", "J");
    var nm = ["D2+", "D2 shield", "D2-", "D1+", "D1 shield", "D1-", "D0+", "D0 shield", "D0-", "CLK+", "CLK shield", "CLK-", "CEC", "UTILITY", "SCL", "SDA", "DDC GND", "+5V", "HPD"];
    for (var i = 0; i < 19; i++) pad(f, i + 1, (i - 9) * 0.5, i % 2 ? -3.05 : -3.95, "roundrect", 0.3, 1.4, 0, { name: nm[i] });
    pad(f, "20", -7.25, -2.25, "oval", 1.6, 2.6, 0.9, { name: "SHIELD", slot: [0.9, 1.9] }); pad(f, "20", 7.25, -2.25, "oval", 1.6, 2.6, 0.9, { name: "SHIELD", slot: [0.9, 1.9] });
    pad(f, "20", -7.85, 2.65, "oval", 1.6, 2.6, 0.9, { name: "SHIELD", slot: [0.9, 1.9] }); pad(f, "20", 7.85, 2.65, "oval", 1.6, 2.6, 0.9, { name: "SHIELD", slot: [0.9, 1.9] });
    line(f, -7.5, 5.6, 7.5, 5.6);
    body(f, 15.0, 11.2, 6.0, "#c3c9ce", "hdmi", { y: 0.0, edge: "bottom" });
    return finish(f, "HDMI-A");
  };
  G.rj45 = function () {
    var f = F("RJ45 Ethernet jack", "J");
    for (var i = 0; i < 8; i++) pad(f, i + 1, (i - 3.5) * 1.02, i % 2 ? -1.27 : -3.81, i ? "circle" : "rect", 1.5, 1.5, 0.89);
    f.holes.push({ x: -5.715, y: 2.54, d: 3.25 }, { x: 5.715, y: 2.54, d: 3.25 });
    pad(f, "9", -7.75, -0.5, "circle", 2.6, 2.6, 1.6, { name: "SHIELD" }); pad(f, "9", 7.75, -0.5, "circle", 2.6, 2.6, 1.6, { name: "SHIELD" });
    box(f, -8.0, -7.0, 8.0, 14.6);
    body(f, 16.0, 21.3, 13.5, "#c3c9ce", "rj45", { y: 3.7, edge: "bottom" });
    return finish(f, "RJ45");
  };
  G.barrel = function () {
    var f = F("DC barrel jack 2.1 mm", "J");
    pad(f, 1, 0, 0, "rect", 3.5, 3.5, 0, { name: "+", slot: [1.0, 3.0], drill: 1.0 });
    pad(f, 2, -6.0, 0, "oval", 3.5, 3.5, 0, { name: "-", slot: [1.0, 3.0], drill: 1.0 });
    pad(f, 3, -3.0, 4.7, "oval", 3.5, 3.5, 0, { name: "SW", slot: [3.0, 1.0], drill: 1.0 });
    box(f, -13.7, -4.5, 0.8, 4.5);
    body(f, 14.4, 9.0, 11.0, "#1d1f22", "barrel", { x: -6.4, edge: "left" });
    return finish(f, "DC-Jack-2.1");
  };
  G.audio = function () {
    var f = F("3.5 mm audio jack (PJ-320A)", "J"), nm = ["SLEEVE", "TIP", "RING", "TIP SW", "RING SW"];
    [[-2.5, 0], [2.5, -1.6], [2.5, 1.6], [6.0, -1.6], [6.0, 1.6]].forEach(function (q, i) { pad(f, i + 1, q[0], q[1], "roundrect", 1.2, 1.6, 0, { name: nm[i] }); });
    f.holes.push({ x: 0.5, y: 0, d: 1.0 }, { x: 7.5, y: 0, d: 1.0 });
    body(f, 12.0, 6.0, 5.0, "#1d1f22", "audio", { x: 2.0, edge: "left" });
    return finish(f, "Audio-3.5");
  };
  G.sma = function (o) {
    var f = F("SMA RF connector" + (o.edge ? " (edge)" : ""), "J");
    if (o.edge) {
      pad(f, 1, 0, 0, "roundrect", 1.5, 4.5, 0, { name: "SIG" });
      pad(f, 2, -2.825, 0, "roundrect", 1.35, 4.5, 0, { name: "GND" }); pad(f, 2, 2.825, 0, "roundrect", 1.35, 4.5, 0, { name: "GND" });
      body(f, 6.35, 9.5, 6.35, "#e3b54a", "sma", { y: -2.5, edge: "top" });
      return finish(f, "SMA-Edge");
    }
    pad(f, 1, 0, 0, "circle", 2.0, 2.0, 1.5, { name: "SIG" });
    [[-2.54, -2.54], [2.54, -2.54], [-2.54, 2.54], [2.54, 2.54]].forEach(function (q) { pad(f, 2, q[0], q[1], "circle", 2.5, 2.5, 1.7, { name: "GND" }); });
    box(f, -3.4, -3.4, 3.4, 3.4);
    body(f, 6.35, 6.35, 12.0, "#e3b54a", "sma", { shape: "cyl" });
    return finish(f, "SMA-THT");
  };
  G.microsd = function () {
    var f = F("microSD socket (push-push)", "J"), nm = ["DAT2", "CD/DAT3", "CMD", "VDD", "CLK", "VSS", "DAT0", "DAT1"];
    for (var i = 0; i < 8; i++) pad(f, i + 1, (i - 3.5) * 1.1, -5.2, "roundrect", 0.7, 1.4, 0, { name: nm[i] });
    pad(f, "9", 5.9, -5.0, "roundrect", 1.0, 1.4, 0, { name: "DET" });
    [[-6.85, -3.5], [6.85, -3.5], [-6.85, 4.8], [6.85, 4.8]].forEach(function (q) { pad(f, "10", q[0], q[1], "roundrect", 1.2, 1.6, 0, { name: "SHIELD" }); });
    body(f, 14.0, 15.0, 1.85, "#c3c9ce", "microsd", { y: 0.3, edge: "bottom" });
    return finish(f, "microSD");
  };

  /* -------------------------------------------- SWITCHES, RELAYS, SOUND */

  G.tactile = function (o) {
    var f = F("Tactile switch 6×6", "SW");
    pad(f, 1, -3.25, -2.25, "circle", 2.0, 2.0, 1.0, { name: "1a" }); pad(f, 2, 3.25, -2.25, "circle", 2.0, 2.0, 1.0, { name: "1b" });
    pad(f, 3, -3.25, 2.25, "circle", 2.0, 2.0, 1.0, { name: "2a" }); pad(f, 4, 3.25, 2.25, "circle", 2.0, 2.0, 1.0, { name: "2b" });
    box(f, -3.0, -3.0, 3.0, 3.0); circ(f, 0, 0, 1.75);
    body(f, 6, 6, 3.5, "#1d1f22", "tact", { cap: o && o.cap || "#2f64d4" });
    return finish(f, "SW-Tact-6x6");
  };
  G.slideSw = function () {
    var f = F("Slide switch SPDT (SS12D00)", "SW");
    ["L", "C", "R"].forEach(function (nm, i) { pad(f, i + 1, (i - 1) * 2.0, 0, i ? "oval" : "rect", 1.4, 2.0, 0.9, { name: nm }); });
    f.holes.push({ x: -4.1, y: 0, d: 1.5 }, { x: 4.1, y: 0, d: 1.5 });
    box(f, -4.3, -1.8, 4.3, 1.8);
    body(f, 8.6, 3.6, 3.5, "#c3c9ce", "slide");
    return finish(f, "SW-Slide-SPDT");
  };
  G.relay = function () {
    var f = F("Relay 5 V (SRD-05VDC)", "K"), nm = ["COM", "C1", "NC", "NO", "C2"];
    [[0, -6.0], [-6.0, -4.0], [-6.0, 8.0], [6.0, 8.0], [6.0, -4.0]].forEach(function (q, i) { pad(f, i + 1, q[0], q[1], i ? "circle" : "rect", 2.6, 2.6, 1.3, { name: nm[i] }); });
    box(f, -9.6, -8.0, 9.6, 11.0);
    body(f, 19.2, 15.6, 15.3, "#2f6fd1", "relay", { y: 1.5 });
    return finish(f, "Relay-SRD");
  };
  G.buzzer = function (o) {
    var f = F("Buzzer 12 mm", "BZ");
    pad(f, 1, -3.8, 0, "rect", 2.0, 2.0, 1.0, { name: "+" }); pad(f, 2, 3.8, 0, "circle", 2.0, 2.0, 1.0, { name: "-" });
    circ(f, 0, 0, 6.2);
    body(f, 12, 12, 9.5, "#1d1f22", "buzzer", { shape: "cyl" });
    return finish(f, "Buzzer-12mm");
  };
  G.pot = function (o) {
    var f = F(o.trim ? "Trimmer 3296W" : "Potentiometer RK09 (9 mm)", "RV"), nm = ["1", "W", "2"];
    if (o.trim) {
      ["1", "W", "2"].forEach(function (x, i) { pad(f, i + 1, (i - 1) * 2.54, 0, i ? "circle" : "rect", 1.6, 1.6, 0.8, { name: nm[i] }); });
      box(f, -4.8, -2.4, 4.8, 2.4);
      body(f, 9.5, 4.8, 10, "#2f6fd1", "trim");
      return finish(f, "Pot-3296W");
    }
    [0, 1, 2].forEach(function (i) { pad(f, i + 1, (i - 1) * 2.5, 0, i ? "circle" : "rect", 1.8, 1.8, 1.0, { name: nm[i] }); });
    pad(f, "MP", -4.4, -7.0, "oval", 2.2, 3.2, 0, { name: "MP", slot: [1.2, 2.2], drill: 1.2 }); pad(f, "MP", 4.4, -7.0, "oval", 2.2, 3.2, 0, { name: "MP", slot: [1.2, 2.2], drill: 1.2 });
    box(f, -4.9, -12.0, 4.9, -1.5);
    body(f, 9.8, 11.0, 6.5, "#2f6fd1", "pot", { y: -6.6 });
    return finish(f, "Pot-RK09");
  };
  G.coin = function () {
    var f = F("CR2032 holder", "BT");
    pad(f, 1, -10.0, 0, "rect", 2.5, 2.5, 1.2, { name: "+" }); pad(f, 2, 10.0, 0, "circle", 2.5, 2.5, 1.2, { name: "-" });
    circ(f, 0, 0, 10.5);
    body(f, 20.5, 20.5, 5.2, "#1d1f22", "coin", { shape: "cyl" });
    return finish(f, "CR2032");
  };
  G.seg7 = function () {
    var f = F("7-segment display 0.56\"", "DS"), top = ["G", "F", "COM", "A", "B"], bot = ["E", "D", "COM", "C", "DP"];
    for (var i = 0; i < 5; i++) { pad(f, i + 1, (i - 2) * 2.54, 7.62, i ? "circle" : "rect", 1.6, 1.6, 0.8, { name: bot[i] }); pad(f, 10 - i, (i - 2) * 2.54, -7.62, "circle", 1.6, 1.6, 0.8, { name: top[i] }); }
    box(f, -6.3, -9.6, 6.3, 9.6);
    body(f, 12.5, 19.0, 8, "#1b1b1d", "seg7");
    return finish(f, "7SEG-0.56");
  };

  /* -------------------------------------------------------- MECHANICAL */

  G.mount = function (o) {
    var d = o.d || 3.2, plated = o.plated !== false, f = F("Mounting hole M" + (d < 2.5 ? 2 : d < 3 ? 2.5 : 3), "H");
    if (plated) pad(f, 1, 0, 0, "circle", d * 1.9, null, d, { name: "MH" }); else f.holes.push({ x: 0, y: 0, d: d });
    circ(f, 0, 0, d * 0.95 + 0.4);
    return finish(f, "MountingHole_" + d + (plated ? "" : "_NPTH"));
  };
  G.testpoint = function (o) {
    var f = F("Test point", "TP");
    if (o.tht) pad(f, 1, 0, 0, "circle", 2.0, 2.0, 1.0); else pad(f, 1, 0, 0, "circle", 1.5, 1.5);
    circ(f, 0, 0, 1.2);
    return finish(f, o.tht ? "TestPoint_THT" : "TestPoint_1.5");
  };
  G.fiducial = function () {
    var f = F("Fiducial", "FID");
    pad(f, 1, 0, 0, "circle", 1.0, 1.0, 0, { mask: 2.0 });
    return finish(f, "Fiducial_1mm");
  };

  /* ------------------------------------------------------------ MODULES */

  G.esp32 = function () {
    var f = F("ESP32-WROOM-32 module", "U");
    var left = ["GND", "3V3", "EN", "SENSOR_VP", "SENSOR_VN", "IO34", "IO35", "IO32", "IO33", "IO25", "IO26", "IO27", "IO14", "IO12"];
    var bottom = ["GND", "IO13", "SD2", "SD3", "CMD", "CLK", "SD0", "SD1", "IO15", "IO2"];
    var right = ["IO0", "IO4", "IO16", "IO17", "IO5", "IO18", "IO19", "NC", "IO21", "RXD0", "TXD0", "IO22", "IO23", "GND"];
    left.forEach(function (nm, i) { pad(f, i + 1, -8.75, -3.24 + i * 1.27, "roundrect", 1.5, 0.9, 0, { name: nm }); });
    bottom.forEach(function (nm, i) { pad(f, 15 + i, -5.715 + i * 1.27, 14.25, "roundrect", 0.9, 1.5, 0, { name: nm }); });
    right.forEach(function (nm, i) { pad(f, 25 + i, 8.75, -3.24 + (13 - i) * 1.27, "roundrect", 1.5, 0.9, 0, { name: nm }); });
    pad(f, 39, -0.6, 4.0, "rect", 5.0, 5.0, 0, { name: "GND" });
    box(f, -9.0, -11.4, 9.0, 14.1); line(f, -9.0, -5.0, 9.0, -5.0);
    f.keepout = { x0: -9, y0: -11.4, x1: 9, y1: -5 };
    body(f, 18.0, 25.5, 3.1, "#c3c9ce", "esp32", { y: 1.35 });
    return finish(f, "ESP32-WROOM-32");
  };
  G.nanoSocket = function () {
    var f = F("Arduino Nano (2×15 socket)", "A");
    var left = ["D13", "3V3", "AREF", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "5V", "RST", "GND", "VIN"];
    var right = ["D12", "D11", "D10", "D9", "D8", "D7", "D6", "D5", "D4", "D3", "D2", "GND", "RST", "RX0", "TX1"];
    left.forEach(function (nm, i) { pad(f, i + 1, -7.62, (i - 7) * 2.54, i ? "oval" : "rect", 1.7, 1.7, 1.0, { name: nm }); });
    right.forEach(function (nm, i) { pad(f, 16 + i, 7.62, (7 - i) * 2.54 * -1 + 0, "oval", 1.7, 1.7, 1.0, { name: nm }); });
    box(f, -9.0, -21.6, 9.0, 21.6);
    body(f, 18.0, 43.2, 6.0, "#1b5fa8", "nano");
    return finish(f, "Arduino-Nano");
  };
  G.pico = function () {
    var f = F("Raspberry Pi Pico (castellated)", "U");
    for (var i = 0; i < 20; i++) { pad(f, i + 1, -8.89, -24.13 + i * 2.54, "oval", 1.7, 3.5, 1.0, { deg: 90 }); pad(f, 40 - i, 8.89, -24.13 + i * 2.54, "oval", 1.7, 3.5, 1.0, { deg: 90 }); }
    var nm = { 1: "GP0", 2: "GP1", 3: "GND", 4: "GP2", 5: "GP3", 6: "GP4", 7: "GP5", 8: "GND", 9: "GP6", 10: "GP7", 11: "GP8", 12: "GP9", 13: "GND", 14: "GP10", 15: "GP11", 16: "GP12", 17: "GP13", 18: "GND", 19: "GP14", 20: "GP15",
      21: "GP16", 22: "GP17", 23: "GND", 24: "GP18", 25: "GP19", 26: "GP20", 27: "GP21", 28: "GND", 29: "GP22", 30: "RUN", 31: "GP26", 32: "GP27", 33: "GND", 34: "GP28", 35: "ADC_VREF", 36: "3V3", 37: "3V3_EN", 38: "GND", 39: "VSYS", 40: "VBUS" };
    f.pads.forEach(function (p) { p.name = nm[p.n]; });
    box(f, -10.5, -25.5, 10.5, 25.5);
    body(f, 21, 51, 3.8, "#2fa35a", "pico");
    return finish(f, "RPi-Pico");
  };

  /* ============================================================= LIBRARY */

  FP.CATS = ["IC packages", "Resistors", "Capacitors", "Inductors & crystals", "Diodes & LEDs", "Transistors & regulators", "Headers & terminals", "USB, HDMI & data", "Power, audio & RF", "Switches, relays & sound", "Mechanical", "Modules"];
  var LIB = FP.LIB = [], BY = {};
  function lib(cat, make, desc) {
    var f = make();
    f.cat = cat; f.desc = desc || "";
    LIB.push(f); BY[f.id] = f;
    return f;
  }
  [4, 6, 8, 14, 16, 18, 20, 24, 28, 40].forEach(function (n) { lib("IC packages", function () { return G.dip({ n: n }); }, n + "-pin through-hole chip, " + (n >= 40 ? "0.6\"" : "0.3\"") + " wide"); });
  lib("IC packages", function () { return G.dip({ n: 28, span: 15.24 }); }, "28-pin wide DIP (0.6\")");
  [8, 14, 16].forEach(function (n) { lib("IC packages", function () { return G.so({ n: n }); }, "1.27 mm pitch, 3.9 mm body"); });
  [16, 20, 24, 28].forEach(function (n) { lib("IC packages", function () { return G.so({ n: n, name: "SOIC-W", span: 9.3, bodyW: 7.5, padL: 1.95 }); }, "1.27 mm pitch, 7.5 mm wide body"); });
  [8, 14, 16, 20, 24, 28].forEach(function (n) { lib("IC packages", function () { return G.so({ n: n, name: "TSSOP", pitch: 0.65, span: 5.8, padL: 1.5, padW: 0.4, bodyW: 4.4, z: 1.1 }); }, "0.65 mm pitch, 4.4 mm body"); });
  [16, 20, 28].forEach(function (n) { lib("IC packages", function () { return G.so({ n: n, name: "SSOP", pitch: 0.65, span: 7.2, padL: 1.75, padW: 0.45, bodyW: 5.3, z: 1.75 }); }, "0.65 mm pitch, 5.3 mm body"); });
  [8, 10].forEach(function (n) { lib("IC packages", function () { return G.so({ n: n, name: "MSOP", pitch: n === 8 ? 0.65 : 0.5, span: 4.4, padL: 1.45, padW: 0.35, bodyW: 3.0, bodyL: 3.0, z: 1.1 }); }, "small outline, 3×3 mm"); });
  [[16, 3, 0.5, 1.7], [20, 4, 0.5, 2.6], [24, 4, 0.5, 2.6], [28, 5, 0.5, 3.1], [32, 5, 0.5, 3.45], [48, 7, 0.5, 5.15], [56, 7, 0.4, 5.6], [64, 9, 0.5, 7.15]].forEach(function (q) {
    lib("IC packages", function () { return G.quad({ n: q[0], size: q[1], pitch: q[2], ep: q[3] }); }, q[1] + "×" + q[1] + " mm, " + q[2] + " mm pitch, thermal pad underneath");
  });
  [[32, 7, 0.8, 9], [44, 10, 0.8, 12], [48, 7, 0.5, 9], [64, 10, 0.5, 12], [100, 14, 0.5, 16]].forEach(function (q) {
    lib("IC packages", function () { return G.quad({ n: q[0], size: q[1], pitch: q[2], leads: true, span: q[3], name: q[0] === 44 || q[0] === 32 && q[2] === 0.8 ? "TQFP" : "LQFP" }); }, q[1] + "×" + q[1] + " mm body, " + q[2] + " mm pitch, legs out");
  });
  [3, 5, 6].forEach(function (n) { lib("IC packages", function () { return G.sot23({ n: n }); }, n === 3 ? "tiny transistors and diodes" : "tiny regulators, op-amps and logic"); });
  FP.CHIPS.forEach(function (c) { lib("Resistors", function () { return G.chip({ size: c, kind: "R" }); }, "surface-mount resistor, " + c + " (imperial)"); });
  lib("Resistors", function () { return G.axial({ pitch: 7.62, std: "0204" }); }, "¼ W mini, 7.62 mm (0.3\") between holes");
  lib("Resistors", function () { return G.axial({ pitch: 10.16, std: "0207" }); }, "¼ W standard, 10.16 mm (0.4\") between holes");
  lib("Resistors", function () { return G.axial({ pitch: 15.24, std: "0309", bodyL: 9, bodyD: 3.2, drill: 1.0 }); }, "1 W, 15.24 mm between holes");
  FP.CHIPS.forEach(function (c) { lib("Capacitors", function () { return G.chip({ size: c, kind: "C" }); }, "ceramic (MLCC), " + c); });
  [[4, 7], [5, 11], [6.3, 11], [8, 12], [10, 16], [12.5, 20]].forEach(function (q) { lib("Capacitors", function () { return G.radial({ d: q[0], z: q[1] }); }, "electrolytic, " + q[0] + " mm across"); });
  lib("Capacitors", function () { return G.disc({ pitch: 2.54 }); }, "ceramic disc, 2.54 mm"); lib("Capacitors", function () { return G.disc({ pitch: 5.08 }); }, "ceramic disc, 5.08 mm");
  lib("Capacitors", function () { return G.tant({ case: "A" }); }, "tantalum 3216"); lib("Capacitors", function () { return G.tant({ case: "B" }); }, "tantalum 3528");
  [3, 4, 6].forEach(function (s) { lib("Inductors & crystals", function () { return G.inductor({ size: s }); }, "shielded power inductor"); });
  lib("Inductors & crystals", function () { return G.chip({ size: "0805", kind: "L" }); }, "chip inductor / ferrite bead");
  lib("Inductors & crystals", function () { return G.crystal({}); }, "classic through-hole crystal");
  lib("Inductors & crystals", function () { return G.crystal({ smd: true }); }, "3.2×2.5 mm SMD crystal");
  lib("Diodes & LEDs", function () { return G.axial({ pitch: 7.62, kind: "D", std: "DO-35" }); }, "small signal (1N4148)");
  lib("Diodes & LEDs", function () { return G.axial({ pitch: 10.16, kind: "D", drill: 1.0, std: "DO-41" }); }, "rectifier (1N4007)");
  lib("Diodes & LEDs", function () { return G.diodeSmd({}); }, "SMD small signal"); lib("Diodes & LEDs", function () { return G.diodeSmd({ case: "SMA" }); }, "SMD Schottky / rectifier");
  lib("Diodes & LEDs", function () { return G.led({ d: 3 }); }, "3 mm through-hole LED"); lib("Diodes & LEDs", function () { return G.led({ d: 5 }); }, "5 mm through-hole LED");
  ["0603", "0805"].forEach(function (c) { lib("Diodes & LEDs", function () { var f = G.chip({ size: c, kind: "D" }); f.name = "LED " + c; f.pads[0].name = "K"; f.pads[1].name = "A"; f.id = "LED_" + c; return f; }, "SMD LED"); });
  lib("Diodes & LEDs", function () { return G.ledRgb({}); }, "addressable RGB LED");
  lib("Transistors & regulators", function () { return G.to92({}); }, "BC547, 2N2222, 2N3904…"); lib("Transistors & regulators", function () { return G.to92({ pitch: 2.54 }); }, "TO-92 with legs bent to 0.1\"");
  lib("Transistors & regulators", function () { return G.to220({}); }, "7805, IRLZ44N, TIP120 standing up"); lib("Transistors & regulators", function () { return G.to220({ flat: true }); }, "TO-220 lying flat, bolted down");
  lib("Transistors & regulators", function () { return G.sot223({}); }, "AMS1117 and other small regulators"); lib("Transistors & regulators", function () { return G.dpak({}); }, "power MOSFETs and regulators");
  [[1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 8], [1, 10], [1, 20], [2, 3], [2, 5], [2, 8], [2, 10], [2, 20]].forEach(function (q) { lib("Headers & terminals", function () { return G.header({ rows: q[0], n: q[0] * q[1] }); }, "0.1\" pin header"); });
  [[1, 4], [1, 8], [2, 20]].forEach(function (q) { lib("Headers & terminals", function () { return G.header({ rows: q[0], n: q[0] * q[1], female: true }); }, "0.1\" female socket"); });
  [[1, 4], [2, 5]].forEach(function (q) { lib("Headers & terminals", function () { return G.header({ rows: q[0], n: q[0] * q[1], pitch: 2.0 }); }, "2 mm pitch header"); });
  lib("Headers & terminals", function () { return G.header({ rows: 2, n: 10, pitch: 1.27 }); }, "1.27 mm (SWD/JTAG) header");
  [2, 3, 4, 5, 6].forEach(function (n) { lib("Headers & terminals", function () { return G.jst({ type: "XH", n: n }); }, "JST-XH 2.5 mm, batteries and sensors"); });
  [2, 3, 4].forEach(function (n) { lib("Headers & terminals", function () { return G.jst({ type: "PH", n: n }); }, "JST-PH 2.0 mm, LiPo batteries"); });
  lib("Headers & terminals", function () { return G.jst({ type: "SH", n: 4 }); }, "JST-SH 1.0 mm — Qwiic / STEMMA QT");
  [2, 3, 4].forEach(function (n) { lib("Headers & terminals", function () { return G.screw({ n: n, pitch: 5.08 }); }, "screw terminal, 5.08 mm"); });
  [2, 3].forEach(function (n) { lib("Headers & terminals", function () { return G.screw({ n: n, pitch: 3.5 }); }, "screw terminal, 3.5 mm"); });
  [10, 14, 16, 20, 40].forEach(function (n) { lib("Headers & terminals", function () { return G.idc({ n: n }); }, "shrouded ribbon-cable header"); });
  lib("USB, HDMI & data", G.usbc, "USB 2.0 Type-C, power and data"); lib("USB, HDMI & data", G.usbMicro, "micro-B, phones and Arduino clones");
  lib("USB, HDMI & data", G.usbMini, "mini-B"); lib("USB, HDMI & data", G.usbA, "full-size A socket (host)"); lib("USB, HDMI & data", G.usbB, "full-size B socket (printer style)");
  lib("USB, HDMI & data", G.hdmi, "HDMI type A, 19 pins"); lib("USB, HDMI & data", G.rj45, "Ethernet"); lib("USB, HDMI & data", G.microsd, "microSD card socket");
  lib("Power, audio & RF", G.barrel, "5.5/2.1 mm power jack"); lib("Power, audio & RF", G.audio, "headphone jack");
  lib("Power, audio & RF", function () { return G.sma({}); }, "antenna, through-hole"); lib("Power, audio & RF", function () { return G.sma({ edge: true }); }, "antenna, on the board edge");
  lib("Power, audio & RF", G.coin, "coin cell holder");
  lib("Switches, relays & sound", function () { return G.tactile({}); }, "push button"); lib("Switches, relays & sound", G.slideSw, "on/off slide switch");
  lib("Switches, relays & sound", G.relay, "5 V relay, 10 A contacts"); lib("Switches, relays & sound", function () { return G.buzzer({}); }, "buzzer or piezo");
  lib("Switches, relays & sound", function () { return G.pot({}); }, "panel potentiometer"); lib("Switches, relays & sound", function () { return G.pot({ trim: true }); }, "multi-turn trimmer");
  lib("Switches, relays & sound", G.seg7, "one digit, common cathode");
  [2.2, 2.7, 3.2].forEach(function (d) { lib("Mechanical", function () { return G.mount({ d: d }); }, "plated, for M" + (d < 2.5 ? "2" : d < 3 ? "2.5" : "3") + " screws"); });
  lib("Mechanical", function () { return G.mount({ d: 3.2, plated: false }); }, "bare hole, no copper");
  lib("Mechanical", function () { return G.testpoint({}); }, "SMD probe pad"); lib("Mechanical", function () { return G.testpoint({ tht: true }); }, "through-hole probe point");
  lib("Mechanical", G.fiducial, "camera mark for assembly machines");
  lib("Modules", G.esp32, "Wi-Fi + Bluetooth microcontroller module"); lib("Modules", G.nanoSocket, "plug an Arduino Nano in"); lib("Modules", G.pico, "solder a Pico flat on the board");

  FP.has = function (id) { return !!BY[id] || !!(L.CUSTOM && L.CUSTOM[id]); };
  FP.get = function (id) {
    if (BY[id]) return BY[id];
    var c = L.CUSTOM && L.CUSTOM[id];
    return c ? c.fp : null;
  };
  FP.clone = function (f) { return JSON.parse(JSON.stringify(f)); };

  /* ====================================================== REAL PARTS
   * A real component: a footprint, pin names, a value, and (when the bench
   * has one) the bench part that simulates it, with how its pins map onto
   * the pads. Placing one in the studio puts the working part on the bench
   * too, so the board and the circuit never disagree. */

  var PARTS = FP.PARTS = [];
  function part(o) { PARTS.push(o); return o; }
  part({ id: "r_0805", name: "Resistor 0805", fp: "R_0805", ref: "R", value: "10k", bench: "resistor", props: { ohms: 10000 }, cat: "Passives" });
  part({ id: "r_axial", name: "Resistor ¼ W", fp: "R_Axial_0207", ref: "R", value: "220", bench: "resistor", props: { ohms: 220 }, cat: "Passives" });
  part({ id: "c_0805", name: "Capacitor 100 nF (0805)", fp: "C_0805", ref: "C", value: "100n", bench: "capacitor", props: { farads: 1e-7 }, cat: "Passives" });
  part({ id: "c_el", name: "Electrolytic 100 µF", fp: "C_EL_6.3x11", ref: "C", value: "100u", bench: "capacitor_e", props: { farads: 1e-4 }, map: { "+": "1", "-": "2" }, cat: "Passives" });
  part({ id: "led5", name: "LED 5 mm", fp: "LED_D5", ref: "D", value: "red", bench: "led", props: { color: "red" }, map: { K: "1", A: "2" }, cat: "Diodes & LEDs" });
  part({ id: "led0805", name: "LED 0805", fp: "LED_0805", ref: "D", value: "green", bench: "led", props: { color: "green" }, map: { K: "1", A: "2" }, cat: "Diodes & LEDs" });
  part({ id: "d1n4148", name: "1N4148 diode", fp: "D_Axial_DO-35", ref: "D", value: "1N4148", bench: "diode", map: { K: "1", A: "2" }, cat: "Diodes & LEDs" });
  part({ id: "d1n4007", name: "1N4007 rectifier", fp: "D_Axial_DO-41", ref: "D", value: "1N4007", bench: "diode", map: { K: "1", A: "2" }, cat: "Diodes & LEDs" });
  part({ id: "ss34", name: "SS34 Schottky", fp: "D_SMA", ref: "D", value: "SS34", bench: "diode", map: { K: "1", A: "2" }, cat: "Diodes & LEDs" });
  part({ id: "ws2812", name: "WS2812B pixel", fp: "LED_WS2812B", ref: "D", value: "WS2812B", cat: "Diodes & LEDs" });
  part({ id: "bc547", name: "BC547 NPN", fp: "TO-92", ref: "Q", value: "BC547", bench: "npn", map: { C: "1", B: "2", E: "3" }, cat: "Transistors" });
  part({ id: "n2222", name: "2N2222 NPN", fp: "TO-92", ref: "Q", value: "PN2222A", bench: "npn", map: { E: "1", B: "2", C: "3" }, cat: "Transistors" });
  part({ id: "n3906", name: "2N3906 PNP", fp: "TO-92", ref: "Q", value: "2N3906", bench: "pnp", map: { E: "1", B: "2", C: "3" }, cat: "Transistors" });
  part({ id: "irlz44n", name: "IRLZ44N MOSFET", fp: "TO-220", ref: "Q", value: "IRLZ44N", bench: "nmos", map: { G: "1", D: "2", S: "3" }, cat: "Transistors" });
  part({ id: "ao3400", name: "AO3400 MOSFET (SMD)", fp: "SOT-23", ref: "Q", value: "AO3400", bench: "nmos", map: { G: "1", S: "2", D: "3" }, cat: "Transistors" });
  part({ id: "lm7805", name: "LM7805 regulator", fp: "TO-220", ref: "U", value: "LM7805", bench: "regulator", props: { volts: 5 }, map: { IN: "1", GND: "2", OUT: "3" }, cat: "Power" });
  part({ id: "ams1117", name: "AMS1117-3.3 regulator", fp: "SOT-223", ref: "U", value: "AMS1117-3.3", bench: "regulator", props: { volts: 3.3 }, map: { GND: "1", OUT: "2", IN: "3" }, also: { "4": "OUT" }, cat: "Power" });
  part({ id: "ne555", name: "NE555 timer (DIP)", fp: "DIP-8", ref: "U", value: "NE555", bench: "ic555", pins: ["GND", "TRIG", "OUT", "RESET", "CTRL", "THR", "DIS", "VCC"], cat: "Chips" });
  part({ id: "ne555s", name: "NE555 timer (SOIC)", fp: "SOIC-8", ref: "U", value: "NE555", bench: "ic555", pins: ["GND", "TRIG", "OUT", "RESET", "CTRL", "THR", "DIS", "VCC"], cat: "Chips" });
  part({ id: "lm358", name: "LM358 dual op-amp", fp: "SOIC-8", ref: "U", value: "LM358", bench: "lm358", pins: ["OUT1", "IN1-", "IN1+", "GND", "IN2+", "IN2-", "OUT2", "VCC"], cat: "Chips" });
  part({ id: "hc595", name: "74HC595 shift register", fp: "DIP-16", ref: "U", value: "74HC595", bench: "hc595", pins: ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "GND", "Q7'", "MR", "SHCP", "STCP", "OE", "DS", "Q0", "VCC"], cat: "Chips" });
  part({ id: "hc595s", name: "74HC595 (SOIC)", fp: "SOIC-16", ref: "U", value: "74HC595", bench: "hc595", pins: ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "GND", "Q7'", "MR", "SHCP", "STCP", "OE", "DS", "Q0", "VCC"], cat: "Chips" });
  part({ id: "mcp3008", name: "MCP3008 ADC", fp: "DIP-16", ref: "U", value: "MCP3008", bench: "mcp3008", pins: ["CH0", "CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7", "DGND", "CS", "DIN", "DOUT", "CLK", "AGND", "VREF", "VDD"], cat: "Chips" });
  part({ id: "pc817", name: "PC817 optocoupler", fp: "DIP-4", ref: "U", value: "PC817", bench: "optocoupler", pins: ["A", "K", "E", "C"], cat: "Chips" });
  part({ id: "atmega328", name: "ATmega328P (DIP)", fp: "DIP-28", ref: "U", value: "ATmega328P", pins: ["RESET", "D0/RX", "D1/TX", "D2", "D3", "D4", "VCC", "GND", "XTAL1", "XTAL2", "D5", "D6", "D7", "D8", "D9", "D10", "D11/MOSI", "D12/MISO", "D13/SCK", "AVCC", "AREF", "GND", "A0", "A1", "A2", "A3", "A4/SDA", "A5/SCL"], cat: "Chips" });
  part({ id: "atmega328t", name: "ATmega328P (TQFP-32)", fp: "TQFP-32-7x7-0.8", ref: "U", value: "ATmega328P-AU", pins: ["D3", "D4", "GND", "VCC", "GND", "VCC", "XTAL1", "XTAL2", "D5", "D6", "D7", "D8", "D9", "D10", "D11/MOSI", "D12/MISO", "D13/SCK", "AVCC", "ADC6", "AREF", "GND", "ADC7", "A0", "A1", "A2", "A3", "A4/SDA", "A5/SCL", "RESET", "D0/RX", "D1/TX", "D2"], cat: "Chips" });
  part({ id: "ch340g", name: "CH340G USB-serial", fp: "SOIC-16", ref: "U", value: "CH340G", pins: ["GND", "TXD", "RXD", "V3", "UD+", "UD-", "XI", "XO", "CTS", "DSR", "RI", "DCD", "DTR", "RTS", "R232", "VCC"], cat: "Chips" });
  part({ id: "lm386", name: "LM386 audio amplifier", fp: "DIP-8", ref: "U", value: "LM386", pins: ["GAIN", "IN-", "IN+", "GND", "VOUT", "VS", "BYPASS", "GAIN"], cat: "Chips" });
  part({ id: "esp32", name: "ESP32-WROOM-32", fp: "ESP32-WROOM-32", ref: "U", value: "ESP32-WROOM-32E", cat: "Modules" });
  part({ id: "pico", name: "Raspberry Pi Pico", fp: "RPi-Pico", ref: "U", value: "RP2040 Pico", cat: "Modules" });
  part({ id: "nano", name: "Arduino Nano socket", fp: "Arduino-Nano", ref: "A", value: "Arduino Nano", cat: "Modules" });
  part({ id: "usbc", name: "USB-C receptacle", fp: "USB-C-16", ref: "J", value: "USB-C 16P", model: "usb", cat: "Connectors" });
  part({ id: "usbmicro", name: "Micro-USB socket", fp: "USB-MicroB", ref: "J", value: "micro-B", model: "usb", cat: "Connectors" });
  part({ id: "usbmini", name: "Mini-USB socket", fp: "USB-MiniB", ref: "J", value: "mini-B", model: "usb", cat: "Connectors" });
  part({ id: "usba", name: "USB-A socket", fp: "USB-A", ref: "J", value: "USB-A", model: "usb", cat: "Connectors" });
  part({ id: "usbb", name: "USB-B socket", fp: "USB-B", ref: "J", value: "USB-B", model: "usb", cat: "Connectors" });
  part({ id: "hdmi", name: "HDMI socket", fp: "HDMI-A", ref: "J", value: "HDMI-A", cat: "Connectors" });
  part({ id: "rj45", name: "RJ45 Ethernet", fp: "RJ45", ref: "J", value: "RJ45", cat: "Connectors" });
  part({ id: "barrel", name: "DC barrel jack", fp: "DC-Jack-2.1", ref: "J", value: "PJ-002A", model: "barrel", cat: "Connectors" });
  part({ id: "audio", name: "3.5 mm audio jack", fp: "Audio-3.5", ref: "J", value: "PJ-320A", cat: "Connectors" });
  part({ id: "microsd", name: "microSD socket", fp: "microSD", ref: "J", value: "microSD", cat: "Connectors" });
  part({ id: "sma", name: "SMA antenna socket", fp: "SMA-Edge", ref: "J", value: "SMA", cat: "Connectors" });
  part({ id: "hdr1x4", name: "Header 1×4", fp: "HDR-1x4-2.54", ref: "J", value: "1x04", cat: "Connectors" });
  part({ id: "hdr2x20", name: "Header 2×20 (Pi GPIO)", fp: "HDR-2x20-2.54", ref: "J", value: "2x20", cat: "Connectors" });
  part({ id: "jstxh2", name: "JST-XH 2-pin", fp: "JST-XH-2", ref: "J", value: "XH-2", cat: "Connectors" });
  part({ id: "jstph2", name: "JST-PH 2-pin (LiPo)", fp: "JST-PH-2", ref: "J", value: "PH-2", cat: "Connectors" });
  part({ id: "qwiic", name: "Qwiic / STEMMA QT", fp: "JST-SH-4", ref: "J", value: "SH-4", pins: ["GND", "3V3", "SDA", "SCL"], cat: "Connectors" });
  part({ id: "term2", name: "Screw terminal 2-way", fp: "TERM-5.08-2", ref: "J", value: "5.08-2P", cat: "Connectors" });
  part({ id: "tact", name: "Push button 6×6", fp: "SW-Tact-6x6", ref: "SW", value: "6x6", bench: "button", map: { "1a": "1", "1b": "2", "2a": "3", "2b": "4" }, cat: "Switches" });
  part({ id: "slide", name: "Slide switch", fp: "SW-Slide-SPDT", ref: "SW", value: "SS12D00", bench: "slide_switch", map: { L: "1", C: "2", R: "3" }, cat: "Switches" });
  part({ id: "relay", name: "Relay SRD-05VDC", fp: "Relay-SRD", ref: "K", value: "SRD-05VDC", bench: "relay", map: { COM: "1", C1: "2", NC: "3", NO: "4", C2: "5" }, cat: "Switches" });
  part({ id: "buzzer", name: "Buzzer 12 mm", fp: "Buzzer-12mm", ref: "BZ", value: "5V buzzer", bench: "buzzer", map: { "+": "1", "-": "2" }, cat: "Switches" });
  part({ id: "pot", name: "Potentiometer 10k", fp: "Pot-RK09", ref: "RV", value: "10k", bench: "potentiometer", map: { "1": "1", W: "2", "2": "3" }, cat: "Switches" });
  part({ id: "xtal16", name: "Crystal 16 MHz", fp: "Crystal_HC49", ref: "Y", value: "16MHz", model: "crystal", cat: "Passives" });
  part({ id: "cr2032", name: "CR2032 holder", fp: "CR2032", ref: "BT", value: "CR2032", model: "cell", cat: "Power" });
  part({ id: "mh3", name: "Mounting hole M3", fp: "MountingHole_3.2", ref: "H", value: "M3", cat: "Mechanical" });
  part({ id: "tp", name: "Test point", fp: "TestPoint_1.5", ref: "TP", value: "TP", cat: "Mechanical" });
  part({ id: "fid", name: "Fiducial", fp: "Fiducial_1mm", ref: "FID", value: "FID", cat: "Mechanical" });
  /* more chips people reach for, with their datasheet pinouts */
  part({ id: "lm393", name: "LM393 dual comparator", fp: "DIP-8", ref: "U", value: "LM393", pins: ["OUT1", "IN1-", "IN1+", "GND", "IN2+", "IN2-", "OUT2", "VCC"], cat: "Chips" });
  part({ id: "mcp23017", name: "MCP23017 I/O expander", fp: "DIP-28", ref: "U", value: "MCP23017", pins: ["GPB0", "GPB1", "GPB2", "GPB3", "GPB4", "GPB5", "GPB6", "GPB7", "VDD", "VSS", "NC", "SCL", "SDA", "NC", "A0", "A1", "A2", "RESET", "INTB", "INTA", "GPA0", "GPA1", "GPA2", "GPA3", "GPA4", "GPA5", "GPA6", "GPA7"], cat: "Chips" });
  part({ id: "pcf8574", name: "PCF8574 I/O expander", fp: "DIP-16", ref: "U", value: "PCF8574", pins: ["A0", "A1", "A2", "P0", "P1", "P2", "P3", "VSS", "P4", "P5", "P6", "P7", "INT", "SCL", "SDA", "VDD"], cat: "Chips" });
  part({ id: "uln2003", name: "ULN2003A driver", fp: "DIP-16", ref: "U", value: "ULN2003A", pins: ["IN1", "IN2", "IN3", "IN4", "IN5", "IN6", "IN7", "GND", "COM", "OUT7", "OUT6", "OUT5", "OUT4", "OUT3", "OUT2", "OUT1"], cat: "Chips" });
  part({ id: "l293d", name: "L293D motor driver", fp: "DIP-16", ref: "U", value: "L293D", pins: ["EN1,2", "1A", "1Y", "GND", "GND", "2Y", "2A", "VCC2", "EN3,4", "3A", "3Y", "GND", "GND", "4Y", "4A", "VCC1"], cat: "Chips" });
  part({ id: "hc00", name: "74HC00 quad NAND", fp: "DIP-14", ref: "U", value: "74HC00", pins: ["1A", "1B", "1Y", "2A", "2B", "2Y", "GND", "3Y", "3A", "3B", "4Y", "4A", "4B", "VCC"], cat: "Chips" });
  part({ id: "hc04", name: "74HC04 hex inverter", fp: "DIP-14", ref: "U", value: "74HC04", pins: ["1A", "1Y", "2A", "2Y", "3A", "3Y", "GND", "4Y", "4A", "5Y", "5A", "6Y", "6A", "VCC"], cat: "Chips" });
  part({ id: "cd4017", name: "CD4017 decade counter", fp: "DIP-16", ref: "U", value: "CD4017", pins: ["Q5", "Q1", "Q0", "Q2", "Q6", "Q7", "Q3", "VSS", "Q8", "Q4", "Q9", "CO", "EN", "CLK", "RST", "VDD"], cat: "Chips" });
  part({ id: "eeprom24", name: "24LC256 EEPROM", fp: "DIP-8", ref: "U", value: "24LC256", pins: ["A0", "A1", "A2", "VSS", "SDA", "SCL", "WP", "VCC"], cat: "Chips" });
  part({ id: "ds1307", name: "DS1307 real-time clock", fp: "DIP-8", ref: "U", value: "DS1307", pins: ["X1", "X2", "VBAT", "GND", "SDA", "SCL", "SQW", "VCC"], cat: "Chips" });
  part({ id: "ds18b20", name: "DS18B20 temperature sensor", fp: "TO-92", ref: "U", value: "DS18B20", pins: ["GND", "DQ", "VDD"], cat: "Chips" });
  part({ id: "lm317", name: "LM317 adjustable regulator", fp: "TO-220", ref: "U", value: "LM317", pins: ["ADJ", "OUT", "IN"], cat: "Power" });
  part({ id: "tl431", name: "TL431 shunt reference", fp: "TO-92", ref: "U", value: "TL431", pins: ["REF", "ANODE", "CATHODE"], cat: "Power" });
  FP.part = function (id) { for (var i = 0; i < PARTS.length; i++) if (PARTS[i].id === id) return PARTS[i]; return null; };
  /* "an MCP23017 expander", "NE555 timer in SOIC": the real part the words name */
  FP.findPart = function (text) {
    var sq = String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, ""), best = null, len = 0, wantSmd = /soic|smd|surface|ssop|tssop|sot/i.test(text);
    PARTS.forEach(function (p) {
      [p.value, p.id].forEach(function (k) {
        var key = String(k || "").toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/(dc|vdc)$/, "");
        if (key.length >= 4 && sq.indexOf(key) >= 0 && (key.length > len || (key.length === len && wantSmd && FP.get(p.fp) && FP.get(p.fp).kind === "smd"))) { best = p; len = key.length; }
      });
    });
    return best;
  };
  /* A real part's footprint, with its pin names written onto the pads. */
  FP.ofPart = function (p) {
    var base = FP.get(p.fp);
    if (!base) return null;
    var f = FP.clone(base);
    if (p.pins) f.pads.forEach(function (q) { var i = parseInt(q.n, 10) - 1; if (p.pins[i] != null) q.name = p.pins[i]; });
    return f;
  };

  /* Which pad a bench pin lands on. Explicit maps first, then a pad with the
   * same number or name, then the same position in the list. */
  FP.pinMap = function (benchPins, fp, explicit) {
    var out = {}, used = {};
    benchPins.forEach(function (pin, i) {
      var want = explicit && explicit[pin], hit = null;
      if (want) hit = fp.pads.filter(function (q) { return q.n === want; })[0];
      if (!hit) hit = fp.pads.filter(function (q) { return !used[q.n] && q.n === pin; })[0];
      if (!hit) hit = fp.pads.filter(function (q) { return !used[q.n] && q.name === pin; })[0];
      if (!hit) { var uniq = []; fp.pads.forEach(function (q) { if (uniq.indexOf(q.n) < 0) uniq.push(q.n); }); var n = uniq[i]; if (n && !used[n]) hit = fp.pads.filter(function (q) { return q.n === n; })[0]; }
      if (hit) { out[pin] = hit.n; used[hit.n] = 1; }
    });
    return out;
  };
  /* Good real packages for the bench's parts, best first. */
  FP.SUGGEST = {
    resistor: ["R_Axial_0207", "R_0805", "R_0603", "R_1206", "R_Axial_0204"], capacitor: ["C_0805", "C_Disc_5.08", "C_0603", "C_1206"], capacitor_e: ["C_EL_6.3x11", "C_EL_5x11", "C_EL_8x12", "C_Tant_B"],
    led: ["LED_D5", "LED_D3", "LED_0805", "LED_0603"], diode: ["D_Axial_DO-41", "D_Axial_DO-35", "D_SMA", "D_SOD-123"], npn: ["TO-92", "SOT-23", "TO-92-W"], pnp: ["TO-92", "SOT-23", "TO-92-W"],
    nmos: ["TO-220", "SOT-23", "TO-252"], regulator: ["TO-220", "SOT-223", "TO-252"], ic555: ["DIP-8", "SOIC-8"], lm358: ["DIP-8", "SOIC-8"], logic_ic: ["DIP-14", "SOIC-14"], ic7404: ["DIP-14", "SOIC-14"],
    hc595: ["DIP-16", "SOIC-16", "TSSOP-16"], mcp3008: ["DIP-16", "SOIC-16"], optocoupler: ["DIP-4"], button: ["SW-Tact-6x6"], slide_switch: ["SW-Slide-SPDT"], relay: ["Relay-SRD"],
    buzzer: ["Buzzer-12mm"], piezo: ["Buzzer-12mm"], potentiometer: ["Pot-RK09", "Pot-3296W"], seg7: ["7SEG-0.56"], arduino_nano: ["Arduino-Nano"]
  };
  FP.suggest = function (type, pinCount) {
    var list = (FP.SUGGEST[type] || []).filter(function (id) { return BY[id]; });
    if (!list.length && pinCount) {
      if (pinCount <= 3) list = ["HDR-1x" + pinCount + "-2.54"];
      else if (pinCount <= 6) list = ["HDR-1x" + pinCount + "-2.54", "JST-XH-" + Math.min(6, pinCount)];
      else list = ["HDR-1x" + (pinCount <= 8 ? 8 : pinCount <= 10 ? 10 : 20) + "-2.54"];
      list = list.filter(function (id) { return BY[id]; });
    }
    return list;
  };

  /* ========================================================= FROM WORDS
   * "SOIC-14", "qfn 32 5x5 0.5", "2x20 header", "usb c", "jst xh 4",
   * "screw terminal 3", "0805 resistor", "electrolytic 8mm", "to-220"… */
  FP.fromText = function (text) {
    var t = String(text || "").toLowerCase().replace(/[“”"]/g, " "), m, n = function (re, d) { var q = re.exec(t); return q ? parseFloat(q[1]) : d; };
    var pins = n(/(\d+)\s*-?\s*(?:pins?|ways?|p\b|pos)/, null);
    if (/usb[\s-]*c|type[\s-]*c/.test(t)) return G.usbc();
    if (/micro[\s-]*usb|usb[\s-]*micro/.test(t)) return G.usbMicro();
    if (/mini[\s-]*usb|usb[\s-]*mini/.test(t)) return G.usbMini();
    if (/usb[\s-]*b\b/.test(t)) return G.usbB();
    if (/usb/.test(t)) return G.usbA();
    if (/hdmi/.test(t)) return G.hdmi();
    if (/rj[\s-]*45|ethernet/.test(t)) return G.rj45();
    if (/barrel|dc jack|power jack/.test(t)) return G.barrel();
    if (/audio|3\.5\s*mm|headphone/.test(t)) return G.audio();
    if (/sma|antenna/.test(t)) return G.sma({ edge: /edge/.test(t) });
    if (/micro\s*sd|sd card/.test(t)) return G.microsd();
    if (/esp32/.test(t)) return G.esp32();
    if (/pico/.test(t)) return G.pico();
    if (/nano/.test(t)) return G.nanoSocket();
    if ((m = /(dip|pdip)\D*(\d+)/.exec(t)) || (m = /(\d+)\D*(dip)/.exec(t))) return G.dip({ n: Math.max(4, Math.min(64, (parseInt(m[2], 10) || parseInt(m[1], 10)) & ~1)), span: /wide|600/.test(t) ? 15.24 : undefined });
    if ((m = /sot[\s-]*23[\s-]*(\d)/.exec(t))) return G.sot23({ n: +m[1] });
    if (/sot[\s-]*223/.test(t)) return G.sot223({});
    if (/sot[\s-]*23/.test(t)) return G.sot23({ n: 3 });
    if ((m = /\b(tssop|ssop|msop|soic|so)(?!t)\W*(\d+)/.exec(t))) {
      var k = m[1], nn = Math.max(4, Math.min(64, parseInt(m[2], 10) & ~1));
      if (k === "tssop") return G.so({ n: nn, name: "TSSOP", pitch: 0.65, span: 5.8, padL: 1.5, padW: 0.4, bodyW: 4.4, z: 1.1 });
      if (k === "ssop") return G.so({ n: nn, name: "SSOP", pitch: 0.65, span: 7.2, padL: 1.75, padW: 0.45, bodyW: 5.3 });
      if (k === "msop") return G.so({ n: nn, name: "MSOP", pitch: 0.65, span: 4.4, padL: 1.45, padW: 0.35, bodyW: 3.0, bodyL: 3.0 });
      return /wide|soic-w/.test(t) ? G.so({ n: nn, name: "SOIC-W", span: 9.3, bodyW: 7.5, padL: 1.95 }) : G.so({ n: nn });
    }
    if ((m = /(qfn|dfn|lqfp|tqfp|qfp)\D*(\d+)/.exec(t))) {
      var q = parseInt(m[2], 10), size = n(/(\d+(?:\.\d+)?)\s*[x×]\s*\d/, null), pitch = n(/(0\.\d+)\s*(?:mm)?\s*(?:pitch)?/, null);
      q = Math.max(8, Math.min(144, Math.round(q / 4) * 4));
      if (/qfp/.test(m[1])) {
        var qs = size || ({ 32: 7, 44: 10, 48: 7, 64: 10, 80: 12, 100: 14, 144: 20 }[q] || Math.round(q / 7));
        return G.quad({ n: q, size: qs, pitch: pitch || (q <= 44 ? 0.8 : 0.5), leads: true, span: qs + 2, name: m[1].toUpperCase() });
      }
      var ns = size || ({ 8: 2, 12: 3, 16: 3, 20: 4, 24: 4, 28: 5, 32: 5, 40: 6, 48: 7, 56: 7, 64: 9 }[q] || Math.ceil(q / 7));
      return G.quad({ n: q, size: ns, pitch: pitch || (ns * 4 / q < 0.5 ? 0.4 : 0.5), ep: ns * 0.62 });
    }
    if (/dpak|to[\s-]*252/.test(t)) return G.dpak({});
    if (/to[\s-]*92/.test(t)) return G.to92({ pitch: /wide|2\.54/.test(t) ? 2.54 : 1.27 });
    if (/to[\s-]*220/.test(t)) return G.to220({ flat: /flat|horizontal|lying/.test(t) });
    if ((m = /\b(0402|0603|0805|1206|1210|2512)\b/.exec(t))) return G.chip({ size: m[1], kind: /cap/.test(t) ? "C" : /induct|ferrite|bead/.test(t) ? "L" : /led/.test(t) ? "D" : "R" });
    if (/electrolytic|radial/.test(t)) return G.radial({ d: n(/(\d+(?:\.\d+)?)\s*mm/, 6.3) });
    if (/tantal/.test(t)) return G.tant({ case: /\bb\b|3528/.test(t) ? "B" : "A" });
    if (/disc|ceramic/.test(t)) return G.disc({ pitch: /2\.54/.test(t) ? 2.54 : 5.08 });
    if (/inductor|coil/.test(t)) return G.inductor({ size: n(/(\d)\s*[x×]/, 4) });
    if (/crystal|xtal/.test(t)) return G.crystal({ smd: /smd|3225/.test(t) });
    if (/ws2812|neopixel|5050/.test(t)) return G.ledRgb({});
    if (/led/.test(t)) return G.led({ d: /3\s*mm/.test(t) ? 3 : 5 });
    if (/1n400|rectifier|do-?41/.test(t)) return G.axial({ pitch: 10.16, kind: "D", drill: 1.0, std: "DO-41" });
    if (/diode|1n4148|do-?35/.test(t)) return G.axial({ pitch: 7.62, kind: "D", std: "DO-35" });
    if (/resistor|axial/.test(t)) return G.axial({ pitch: /0204|7\.62/.test(t) ? 7.62 : 10.16, std: /0204/.test(t) ? "0204" : "0207" });
    if ((m = /(\d+)\s*[x×]\s*(\d+)/.exec(t)) && /header|pin|socket|idc/.test(t)) {
      var a = +m[1], b = +m[2], rows = Math.min(a, b) <= 2 ? Math.min(a, b) : 1, cols = rows === 1 ? Math.max(a, b) : Math.max(a, b);
      if (/idc|box|ribbon/.test(t)) return G.idc({ n: Math.min(64, rows * cols) & ~1 });
      return G.header({ rows: rows, n: Math.min(80, rows * cols), pitch: /2\.0|2mm/.test(t) ? 2.0 : /1\.27/.test(t) ? 1.27 : 2.54, female: /socket|female/.test(t) });
    }
    if (/jst|xh|ph\b|qwiic|stemma/.test(t)) return G.jst({ type: /qwiic|stemma|\bsh\b/.test(t) ? "SH" : /\bph\b/.test(t) ? "PH" : "XH", n: /qwiic|stemma/.test(t) ? 4 : Math.max(2, Math.min(8, pins || n(/(\d)/, 2))) });
    if (/screw|terminal/.test(t)) return G.screw({ n: Math.max(2, Math.min(12, pins || n(/(\d+)/, 2))), pitch: /3\.5/.test(t) ? 3.5 : 5.08 });
    if (/header|pins?/.test(t)) return G.header({ rows: /2\s*row|double|dual/.test(t) ? 2 : 1, n: Math.max(1, Math.min(80, pins || n(/(\d+)/, 4))), female: /socket|female/.test(t) });
    if (/tact|button|push/.test(t)) return G.tactile({});
    if (/slide|toggle/.test(t)) return G.slideSw();
    if (/relay/.test(t)) return G.relay();
    if (/buzzer|piezo|beeper/.test(t)) return G.buzzer({});
    if (/trim/.test(t)) return G.pot({ trim: true });
    if (/pot|knob/.test(t)) return G.pot({});
    if (/cr2032|coin/.test(t)) return G.coin();
    if (/7[\s-]*seg/.test(t)) return G.seg7();
    if (/mount|screw hole|\bm[23]\b/.test(t)) return G.mount({ d: /m2\.5/.test(t) ? 2.7 : /\bm2\b/.test(t) ? 2.2 : 3.2, plated: !/npth|bare|unplated/.test(t) });
    if (/test\s*point/.test(t)) return G.testpoint({ tht: /tht|through/.test(t) });
    if (/fiducial/.test(t)) return G.fiducial();
    return null;
  };

  /* ============================================================== KiCad
   * Footprints go out as .kicad_mod (KiCad 6+), so a part designed here
   * opens in KiCad; and come in from .kicad_mod, so a part from a
   * manufacturer's library can be used here. */
  function q(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
  FP.kicad = function (f, name) {
    var nm = (name || f.id || f.name || "part").replace(/[^A-Za-z0-9_.\-]+/g, "_");
    var s = "(footprint " + q(nm) + " (version 20221018) (generator chalk_lab) (layer \"F.Cu\")\n";
    s += "  (descr " + q(f.name + (f.desc ? " — " + f.desc : "")) + ")\n  (attr " + (f.kind === "smd" ? "smd" : "through_hole") + ")\n";
    s += "  (fp_text reference \"REF**\" (at 0 " + r3(f.court.y0 - 1.2) + ") (layer \"F.SilkS\") (effects (font (size 1 1) (thickness 0.15))))\n";
    s += "  (fp_text value " + q(nm) + " (at 0 " + r3(f.court.y1 + 1.2) + ") (layer \"F.Fab\") (effects (font (size 1 1) (thickness 0.15))))\n";
    f.silk.forEach(function (k) {
      if (k.l) s += "  (fp_line (start " + k.l[0] + " " + k.l[1] + ") (end " + k.l[2] + " " + k.l[3] + ") (stroke (width 0.12) (type solid)) (layer \"F.SilkS\"))\n";
      else if (k.c) s += "  (fp_circle (center " + k.c[0] + " " + k.c[1] + ") (end " + r3(k.c[0] + k.c[2]) + " " + k.c[1] + ") (stroke (width 0.12) (type solid)) (fill none) (layer \"F.SilkS\"))\n";
      else if (k.a) {
        var a = k.a, rad = function (d) { return d * Math.PI / 180; }, pt = function (d) { return r3(a[0] + a[2] * Math.cos(rad(d))) + " " + r3(a[1] + a[2] * Math.sin(rad(d))); };
        s += "  (fp_arc (start " + pt(a[3]) + ") (mid " + pt((a[3] + a[4]) / 2) + ") (end " + pt(a[4]) + ") (stroke (width 0.12) (type solid)) (layer \"F.SilkS\"))\n";
      } else if (k.d) s += "  (fp_circle (center " + k.d[0] + " " + k.d[1] + ") (end " + r3(k.d[0] + 0.15) + " " + k.d[1] + ") (stroke (width 0.3) (type solid)) (fill solid) (layer \"F.SilkS\"))\n";
    });
    var c = f.court;
    s += "  (fp_rect (start " + c.x0 + " " + c.y0 + ") (end " + c.x1 + " " + c.y1 + ") (stroke (width 0.05) (type solid)) (fill none) (layer \"F.CrtYd\"))\n";
    if (f.body) { var b = f.body; s += "  (fp_rect (start " + r3(b.x - b.w / 2) + " " + r3(b.y - b.h / 2) + ") (end " + r3(b.x + b.w / 2) + " " + r3(b.y + b.h / 2) + ") (stroke (width 0.1) (type solid)) (fill none) (layer \"F.Fab\"))\n"; }
    f.pads.forEach(function (p) {
      var shape = p.shape === "circle" ? "circle" : p.shape === "oval" ? "oval" : p.shape === "roundrect" ? "roundrect" : "rect";
      var tht = p.drill || p.slot;
      s += "  (pad " + q(p.n) + " " + (tht ? "thru_hole" : "smd") + " " + shape + " (at " + p.x + " " + p.y + (p.deg ? " " + p.deg : "") + ") (size " + p.w + " " + p.h + ")";
      if (p.slot) s += " (drill oval " + p.slot[0] + " " + p.slot[1] + ")"; else if (tht) s += " (drill " + p.drill + ")";
      s += tht ? " (layers \"*.Cu\" \"*.Mask\")" : " (layers \"F.Cu\" \"F.Paste\" \"F.Mask\")";
      if (shape === "roundrect") s += " (roundrect_rratio 0.25)";
      if (p.name && p.name !== p.n) s += " (pinfunction " + q(p.name) + ")";
      s += ")\n";
    });
    f.holes.forEach(function (h) { s += "  (pad \"\" np_thru_hole circle (at " + h.x + " " + h.y + ") (size " + h.d + " " + h.d + ") (drill " + h.d + ") (layers \"*.Cu\" \"*.Mask\"))\n"; });
    return s + ")\n";
  };
  /* A small s-expression reader: enough for footprints. */
  function sexp(text) {
    var i = 0, n = text.length;
    function atom() {
      var c = text.charAt(i);
      if (c === '"') { var s = ""; i++; while (i < n && text.charAt(i) !== '"') { if (text.charAt(i) === "\\") i++; s += text.charAt(i++); } i++; return s; }
      var st = i; while (i < n && !/[\s()]/.test(text.charAt(i))) i++; return text.slice(st, i);
    }
    function list() {
      var out = []; i++;
      while (i < n) {
        var c = text.charAt(i);
        if (/\s/.test(c)) { i++; continue; }
        if (c === ")") { i++; return out; }
        out.push(c === "(" ? list() : atom());
      }
      return out;
    }
    while (i < n && text.charAt(i) !== "(") i++;
    if (i >= n) throw new Error("This doesn't look like a KiCad footprint (no opening bracket).");
    return list();
  }
  FP.fromKicad = function (text) {
    var t = sexp(text);
    if (t[0] !== "footprint" && t[0] !== "module") throw new Error("Not a KiCad footprint: it starts with (" + t[0] + ").");
    var f = F(String(t[1] || "Imported"), "U"), get = function (node, key) { for (var k = 0; k < node.length; k++) if (Array.isArray(node[k]) && node[k][0] === key) return node[k]; return null; };
    var nums = function (node) { return node ? node.slice(1).map(parseFloat) : []; }, onSilk = function (node) { var l = get(node, "layer"); return l && /SilkS/.test(l[1]) && /^F/.test(l[1]); };
    t.slice(2).forEach(function (node) {
      if (!Array.isArray(node)) return;
      if (node[0] === "fp_text" && node[1] === "reference") { var r = String(node[2]).replace(/[^A-Z]/g, ""); if (r) f.ref = r.slice(0, 3); }
      if (node[0] === "descr") f.desc = String(node[1]).slice(0, 120);
      if (node[0] === "fp_line" && onSilk(node)) { var a = nums(get(node, "start")), b = nums(get(node, "end")); line(f, a[0], a[1], b[0], b[1]); }
      if (node[0] === "fp_rect" && onSilk(node)) { var a2 = nums(get(node, "start")), b2 = nums(get(node, "end")); box(f, a2[0], a2[1], b2[0], b2[1]); }
      if (node[0] === "fp_circle" && onSilk(node)) { var c = nums(get(node, "center")), e = nums(get(node, "end")); circ(f, c[0], c[1], Math.hypot(e[0] - c[0], e[1] - c[1])); }
      if (node[0] === "fp_rect" && get(node, "layer") && /Fab/.test(get(node, "layer")[1]) && !f.body) {
        var a3 = nums(get(node, "start")), b3 = nums(get(node, "end"));
        body(f, Math.abs(b3[0] - a3[0]), Math.abs(b3[1] - a3[1]), 2, "#1d1f22", "ic", { x: (a3[0] + b3[0]) / 2, y: (a3[1] + b3[1]) / 2 });
      }
      if (node[0] === "pad") {
        var num = String(node[1] || ""), type = node[2], shape = node[3], at = nums(get(node, "at")), size = nums(get(node, "size")), drill = get(node, "drill");
        if (type === "np_thru_hole") { f.holes.push({ x: at[0], y: at[1], d: drill ? parseFloat(drill[drill[1] === "oval" ? 2 : 1]) : size[0] }); return; }
        var extra = { deg: at[2] || 0 }, pf = get(node, "pinfunction");
        if (pf) extra.name = String(pf[1]).slice(0, 16);
        var d = 0;
        if (drill) { if (drill[1] === "oval") { extra.slot = [parseFloat(drill[2]), parseFloat(drill[3])]; d = Math.min(extra.slot[0], extra.slot[1]); } else d = parseFloat(drill[1]); }
        var sh = shape === "circle" ? "circle" : shape === "oval" ? "oval" : shape === "roundrect" ? "roundrect" : "rect";
        pad(f, num || String(f.pads.length + 1), at[0], at[1], sh, size[0], size[1], type === "thru_hole" ? d : 0, extra);
      }
    });
    if (!f.pads.length && !f.holes.length) throw new Error("That footprint has no pads.");
    if (!f.body && f.pads.length) { var ext = finish(FP.clone(f)).court; body(f, Math.max(1, ext.x1 - ext.x0 - 1), Math.max(1, ext.y1 - ext.y0 - 1), 2, "#1d1f22", "ic"); }
    return finish(f, "kicad_" + String(t[1] || "part").replace(/[^A-Za-z0-9_.\-]+/g, "_").slice(0, 30));
  };

  /* ===================================================== CUSTOM PARTS
   * A part designed in the part maker becomes a bench part like any other:
   * it shows up in the drawer under the category you chose, simulates with
   * the behaviour you wrote for it, and keeps its real footprint for the
   * board. Its type is cp_ and a few letters; a copy of it is kept inside
   * every circuit that uses it, so the circuit still opens if the part is
   * later deleted from your library. */

  L.CUSTOM = L.CUSTOM || {};
  var P = L.P || 20;
  var LOOK_COL = { ic: "#1d1f22", conn: "#c3c9ce", res: "#d8c79a", cap: "#b98a52", led: "#e0261c", diode: "#1d1f22", xtal: "#c8ccd0", switch: "#2f64d4", module: "#1f8a46", sensor: "#1d4fa0", generic: "#3a4654" };
  FP.LOOKS = Object.keys(LOOK_COL);

  /* Where the part's legs go on the bench, on the 0.1" grid. A footprint
   * whose holes are already on that grid keeps its real shape (a DIP, a
   * header, a TO-220); anything else sits on a little breakout board with
   * its pins in a row, or two, the way it would be bought. */
  FP.benchPins = function (data) {
    var f = data.fp, pins = FP.pinsOf(data), mm = P / 2.54;
    var tht = f.pads.filter(function (p) { return p.drill || p.slot; });
    if (pins.length && tht.length === f.pads.length) {
      var first = {}, onGrid = true;
      pins.forEach(function (pn) { first[pn.n] = f.pads.filter(function (p) { return p.n === pn.n; })[0]; });
      var o = first[pins[0].n], seen = {};
      var pts = pins.map(function (pn) {
        var p = first[pn.n], gx = (p.x - o.x) / 2.54, gy = (p.y - o.y) / 2.54, rx = Math.round(gx), ry = Math.round(gy);
        if (Math.abs(gx - rx) > 0.06 || Math.abs(gy - ry) > 0.06) onGrid = false;
        var k = rx + "," + ry; if (seen[k]) onGrid = false; seen[k] = 1;
        return { n: pn.n, x: rx * P, y: ry * P, label: pn.name };
      });
      var span = pts.reduce(function (m, q) { return Math.max(m, Math.abs(q.x), Math.abs(q.y)); }, 0);
      if (onGrid && span <= 60 * P) return { layout: "true", pins: pts };
    }
    var n = pins.length, rows = n > 8 ? 2 : 1, per = rows === 2 ? Math.ceil(n / 2) : n, out = [];
    pins.forEach(function (pn, i) {
      if (rows === 1) out.push({ n: pn.n, x: i * P, y: 0, label: pn.name });
      else if (i < per) out.push({ n: pn.n, x: 0, y: i * P, label: pn.name });
      else out.push({ n: pn.n, x: 6 * P, y: (n - 1 - i) * P, label: pn.name });
    });
    return { layout: rows === 2 ? "dual" : "row", pins: out, per: per };
  };
  /* One entry per pin: a pad number, its name, and the other pads that are the same pin. */
  FP.pinsOf = function (data) {
    var seen = {}, out = [], named = data.pins || {};
    data.fp.pads.forEach(function (p) {
      var name = (named[p.n] && named[p.n].name) || p.name || p.n;
      if (seen[p.n]) return;
      seen[p.n] = 1;
      out.push({ n: p.n, name: name, type: (named[p.n] && named[p.n].type) || "" });
    });
    return out;
  };

  function benchArt(data, lay) {
    var S = L.svg, look = data.look || "generic", col = /^#[0-9a-fA-F]{3,8}$/.test(data.color || "") ? data.color : LOOK_COL[look] || "#3a4654", pins = lay.pins, s = "";
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    pins.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    var esc = L.esc, t = function (x, y, str, size, fill, o) { return S ? S.text(x, y, esc(String(str)), size, fill, o) : '<text x="' + x + '" y="' + y + '">' + esc(String(str)) + '</text>'; };
    var hdr = S ? S.hdr : function () { return ""; };
    if (lay.layout === "true") {
      var bx = x0 - 0.7 * P, by = y0 - 0.7 * P, bw = x1 - x0 + 1.4 * P, bh = y1 - y0 + 1.4 * P;
      if (look === "ic") { s += S.shadow(bx + 0.3 * P, by, bw - 0.6 * P, bh, 3) + '<rect x="' + (bx + 0.3 * P) + '" y="' + by + '" width="' + (bw - 0.6 * P) + '" height="' + bh + '" rx="3" fill="' + col + '"/>'; }
      else s += S.shadow(bx, by, bw, bh, 5) + '<rect x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + bh + '" rx="5" fill="' + col + '" stroke="rgba(0,0,0,.35)"/>';
      pins.forEach(function (p) { s += '<circle cx="' + p.x + '" cy="' + p.y + '" r="5" fill="#e3b54a"/><circle cx="' + p.x + '" cy="' + p.y + '" r="2.2" fill="#2a2a2a"/>'; });
      s += t((x0 + x1) / 2, (y0 + y1) / 2, data.value || data.name, Math.max(7, Math.min(12, bw / Math.max(4, (data.value || data.name).length) * 1.4)), look === "conn" || look === "xtal" ? "#222" : "#e8eef4", { weight: 700 });
      return { art: s, box: { x: bx, y: by, w: bw, h: bh } };
    }
    if (lay.layout === "row") {
      var w = Math.max(4 * P, x1 + 1.2 * P), top = -5.2 * P;
      s += S.shadow(-0.7 * P, top, w, 4.6 * P, 4) + '<rect x="' + (-0.7 * P) + '" y="' + top + '" width="' + w + '" height="' + (4.6 * P) + '" rx="4" fill="#5a2d82" stroke="#3a1a5a" stroke-width="1.5"/>';
      s += chipOnBoard(look, col, -0.7 * P + w / 2, top + 2.0 * P, Math.min(w - 1.4 * P, 3.4 * P), 2.4 * P);
      pins.forEach(function (p) { s += S.lead(p.x, 0, p.x, -0.65 * P) + hdr(p.x, -0.7 * P) + t(p.x, top + 4.15 * P, String(p.label).slice(0, 5), 6, "#f0e6ff", { rot: -90, anchor: "middle" }); });
      s += t(-0.7 * P + w / 2, top + 0.6 * P, (data.value || data.name).slice(0, 22), 8, "#f0e6ff", { weight: 700 });
      return { art: s, box: { x: -0.7 * P, y: top, w: w, h: 5.2 * P } };
    }
    var h = (lay.per - 1) * P + 1.6 * P;
    s += S.shadow(-0.8 * P, -0.8 * P, 7.6 * P, h, 4) + '<rect x="' + (-0.8 * P) + '" y="' + (-0.8 * P) + '" width="' + (7.6 * P) + '" height="' + h + '" rx="4" fill="#5a2d82" stroke="#3a1a5a" stroke-width="1.5"/>';
    s += chipOnBoard(look, col, 3 * P, -0.8 * P + h / 2, 3.0 * P, Math.min(h - 1.4 * P, 4.5 * P));
    pins.forEach(function (p) { var left = p.x < 3 * P; s += hdr(p.x, p.y) + t(p.x + (left ? 0.55 * P : -0.55 * P), p.y, String(p.label).slice(0, 6), 6.5, "#f0e6ff", { anchor: left ? "start" : "end" }); });
    s += t(3 * P, -0.8 * P + h - 0.45 * P, (data.value || data.name).slice(0, 16), 7, "#f0e6ff", { weight: 700 });
    return { art: s, box: { x: -0.8 * P, y: -0.8 * P, w: 7.6 * P, h: h } };
  }
  function chipOnBoard(look, col, cx, cy, w, h) {
    var s = '<rect x="' + (cx - w / 2) + '" y="' + (cy - h / 2) + '" width="' + w + '" height="' + h + '" rx="' + (look === "ic" ? 2 : 4) + '" fill="' + col + '"' + (look === "conn" ? ' stroke="#7d858b" stroke-width="1.5"' : '') + '/>';
    if (look === "ic") for (var i = 0; i < 4; i++) { var yy = cy - h / 2 + (i + 0.5) * h / 4; s += '<rect x="' + (cx - w / 2 - 3) + '" y="' + (yy - 1.5) + '" width="3" height="3" fill="#c9ced2"/><rect x="' + (cx + w / 2) + '" y="' + (yy - 1.5) + '" width="3" height="3" fill="#c9ced2"/>'; }
    if (look === "led") s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + Math.min(w, h) / 3 + '" fill="#ffffff" opacity=".35"/>';
    if (look === "conn") s += '<rect x="' + (cx - w / 3) + '" y="' + (cy - h / 6) + '" width="' + (w / 1.5) + '" height="' + (h / 3) + '" rx="3" fill="#2a2d31"/>';
    return s;
  }

  /* Names a behaviour can use for a pin: its pad number and its name. */
  FP.pinAliases = function (pins) {
    var map = {};
    pins.forEach(function (p) { map[p.n] = p.n; });
    pins.forEach(function (p) { var nm = String(p.label || "").replace(/\s+/g, "_"); if (nm && map[nm] == null) map[nm] = p.n; });
    return map;
  };
  /* Register (or replace) a custom part. data is what the part maker saves. */
  FP.register = function (type, data) {
    if (!/^cp_[a-z0-9_]{2,28}$/.test(type) || !data || !data.fp || !Array.isArray(data.fp.pads) || !data.fp.pads.length) return null;
    var fp = data.fp;
    if (!fp.court) finish(fp, fp.id || type);
    fp.id = type;
    var lay = FP.benchPins(data), drawn = benchArt(data, lay), cat = data.cat || "My parts";
    var spec = [], props = {}, model = null;
    if (data.behave && L.Behave) {
      var c = L.Behave.compile(data.behave, FP.pinAliases(lay.pins));
      if (c.ok) {
        model = c.model;
        c.params.forEach(function (pm) { props[pm.name] = pm.value; spec.push(pm.spec); });
      }
    }
    var pinNameToPad = {};
    lay.pins.forEach(function (p) { pinNameToPad[p.label] = p.n; });
    var buses = [];
    var byName = {};
    lay.pins.forEach(function (p) { (byName[p.label] = byName[p.label] || []).push(p.n); });
    Object.keys(byName).forEach(function (k) { if (byName[k].length > 1) buses.push(byName[k]); });
    var def = {
      name: data.name || "My part", cat: cat, custom: true,
      blurb: data.desc || (data.value ? data.value + " — " : "") + "a part you designed. " + (model ? "It simulates with its own behaviour." : "It has no behaviour yet, so it only joins its pins to the circuit."),
      pins: lay.pins.map(function (p) { return { n: p.n, x: p.x, y: p.y, label: p.label + (p.label !== p.n ? " (" + p.n + ")" : "") }; }),
      buses: buses, box: drawn.box, props: props, spec: spec, layer: "part",
      label: function () { return data.value || ""; },
      art: function () { return drawn.art + '<g data-live="glow"></g><g data-live="show"></g>'; },
      live: function (g, st) {
        if (g.show) { var txt = st.show == null ? "" : String(st.show); if (g.show._t !== txt) { g.show._t = txt; g.show.innerHTML = txt ? L.svg.text(drawn.box.x + drawn.box.w / 2, drawn.box.y + drawn.box.h + 9, L.esc(txt), 9, "#ffd36b", { weight: 700 }) : ""; } }
      },
      glow: function (st) { return st.glow > 0.02 ? [{ x: drawn.box.x + drawn.box.w / 2, y: drawn.box.y + drawn.box.h / 2, r: 14 + 24 * Math.min(1, st.glow), c: st.glowColor || "#ffd36b", a: Math.min(0.9, st.glow) }] : []; },
      fpData: fp, pinPad: pinNameToPad
    };
    if (L.PARTS && L.PARTS[type]) {
      var keep = L.PARTS[type];
      Object.keys(keep).forEach(function (k) { delete keep[k]; });
      Object.keys(def).forEach(function (k) { keep[k] = def[k]; });
      keep.type = type;
    } else if (L.addPart) L.addPart(type, def);
    if (L.MODELS) { if (model) L.MODELS[type] = model; else delete L.MODELS[type]; }
    L.CUSTOM[type] = { type: type, data: data, fp: fp };
    if (L.thumbReset) L.thumbReset(type);
    return L.PARTS ? L.PARTS[type] : def;
  };
  FP.unregister = function (type) {
    delete L.CUSTOM[type];
    if (L.PARTS && L.PARTS[type]) { delete L.PARTS[type]; var i = L.PART_ORDER.indexOf(type); if (i >= 0) L.PART_ORDER.splice(i, 1); }
    if (L.MODELS) delete L.MODELS[type];
  };

  /* Custom parts are numbered with their own reference letter (J, U, SW…). */
  FP.hookRefs = function () {
    if (!L.refPrefix || L.refPrefix.custom) return;
    var basePrefix = L.refPrefix;
    L.refPrefix = function (type) { var c = L.CUSTOM[type]; return c ? String(c.data.ref || (c.fp && c.fp.ref) || "U").replace(/[^A-Z]/g, "").slice(0, 3) || "U" : basePrefix(type); };
    L.refPrefix.custom = true;
  };
  FP.hookRefs();
  /* At page load: your library, and any parts a saved circuit carries with it. */
  FP.boot = function (cfg) {
    var n = 0;
    FP.hookRefs();
    (cfg && cfg.parts || []).forEach(function (p) { if (p && p.type && FP.register(p.type, p.data)) n++; });
    var lib = cfg && cfg.data && cfg.data.lib;
    if (lib && typeof lib === "object") Object.keys(lib).forEach(function (type) { if (!L.CUSTOM[type] && FP.register(type, lib[type])) n++; });
    return n;
  };
})(typeof window !== "undefined" ? window : globalThis);
