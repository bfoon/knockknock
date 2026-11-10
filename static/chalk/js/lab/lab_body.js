/* Chalk Circuit Lab — the body.
 *
 * A circuit on a bench is an experiment. Put it in a shell with wheels and
 * it is a toy car. This file is the shell: what it is made of, where the
 * electronics sit inside it, and how it becomes plastic.
 *
 *   doc.body = { kind, wall, split, splitZ, drive, bay, anchors,
 *                solids: [{id, name, shape, x, y, z, sx, sy, sz, rx, ry, rz,
 *                          color, op, group, role, p}],
 *                mounts: {itemId: {x, y, z, rx, ry, rz}} }
 *
 * Lengths are millimetres. X is forward, Y is left, Z is up, and the
 * ground is z = 0.
 *
 * A solid's `group` says what happens to it at the printer:
 *   hull     joined with the other hull solids, then hollowed out to
 *            `wall` thick — the shell the electronics go in
 *   attach   joined onto the shell solid (fins, a periscope)
 *   part     printed on its own (a wheel, a propeller); like parts are
 *            counted, not repeated
 * and `op: "cut"` makes it a hole instead: an axle bore, a headlight, a
 * window. `role` is what a solid does when the design is test-driven:
 * wheelL / wheelR turn with the motors, prop spins.
 *
 * Nothing here touches the page. The view is lab_body_view.js.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var S = L.Solid;
  var Body = L.Body = {};

  function r1(v) { return Math.round(v * 10) / 10; }

  function sol(name, shape, pos, size, o) {
    o = o || {};
    var s = { id: L.uid("s"), name: name, shape: shape, x: r1(pos[0]), y: r1(pos[1]), z: r1(pos[2]), sx: r1(size[0]), sy: r1(size[1]), sz: r1(size[2]),
              rx: (o.rot || [0, 0, 0])[0], ry: (o.rot || [0, 0, 0])[1], rz: (o.rot || [0, 0, 0])[2],
              color: o.color || "#d4893a", op: o.op === "cut" ? "cut" : "add", group: o.group || "hull" };
    if (o.role) s.role = o.role;
    if (o.p) s.p = o.p;
    return s;
  }
  Body.solid = sol;

  Body.blank = function () {
    return { v: 1, kind: "custom", wall: 2, split: "none", splitZ: 0, drive: "none", bay: null, anchors: {}, solids: [], mounts: {} };
  };

  /* -------------------------------------------------------- electronics */

  var SIZE = {   /* what the off-board parts take up, mm: along, across, tall */
    motor: [32, 20, 20], k_motor: [32, 20, 20], servo: [23, 12.5, 26], battery_9v: [48, 26, 17], battery_aa: [58, 32, 16],
    k_battery: [58, 32, 16], bulb: [14, 14, 24], k_bulb: [14, 14, 24], coin_cell: [22, 22, 6]
  };
  var TINT = { motor: "#b9c0c6", k_motor: "#b9c0c6", servo: "#3b6fd4", battery_9v: "#2b2f36", battery_aa: "#2b2f36", k_battery: "#c0392b", bulb: "#f6e7a1", k_bulb: "#f6e7a1" };
  var TALL = [[/^arduino_uno/, 14], [/^arduino_nano/, 8], [/^capacitor_e/, 12], [/^relay/, 16], [/^(led|k_led|rgb_led)/, 9], [/^hcsr04/, 16], [/^lcd/, 12], [/^(buzzer|piezo|k_buzzer)/, 10], [/^(ic|logic|lm358)/, 5], [/^resistor/, 3]];
  function tall(type) { for (var i = 0; i < TALL.length; i++) if (TALL[i][0].test(type)) return TALL[i][1]; return 7; }
  function tint(part) {
    var pr = L.propsOf(part), c = L.LED_COLORS && pr.color && L.LED_COLORS[pr.color];
    if (/led/.test(part.type) && c) return c.fill || "#e2574c";
    if (/^arduino/.test(part.type)) return "#1c6e8c";
    if (/^(ic|logic|lm358|npn|pnp|nmos)/.test(part.type)) return "#22262b";
    if (/^resistor/.test(part.type)) return "#d8c79a";
    if (/^capacitor/.test(part.type)) return "#3b6fd4";
    if (/^(button|k_button)/.test(part.type)) return "#d43a2f";
    return "#8b9aa8";
  }

  /* What has to fit inside: one board carrying everything that solders
   * down, plus the things that hang off it on wires. Each item is a box
   * (w along X, d along Y, h tall) with smaller boxes riding on it. */
  Body.items = function (doc) {
    var PCB = L.PCB, out = [], onb = [], ref = L.refdes(doc);
    doc.parts.forEach(function (p) {
      if (!L.def(p) || !PCB.onBoard(p.type)) return;
      if (PCB.offBoard(p.type)) {
        if (p.type === "psu") return;
        var sz = SIZE[p.type] || [20, 20, 15];
        out.push({ id: p.id, name: ref[p.id] + " " + L.partTitle(p), w: sz[0], d: sz[1], h: sz[2], color: TINT[p.type] || "#8b9aa8", type: p.type, kids: [] });
      } else onb.push(p);
    });
    if (!onb.length) return out;
    var board = { id: "@board", name: "Circuit board", w: 0, d: 0, h: 1.6, color: "#17603f", type: "board", kids: [] };
    var pcb = doc.pcb, placed = pcb && pcb.place && onb.every(function (p) { return pcb.place[p.id]; });
    if (placed) {
      board.w = pcb.w; board.d = pcb.h;
      onb.forEach(function (p) {
        var fp = PCB.footprint(p), pl = pcb.place[p.id], b = PCB.bounds(fp, pl.rot || 0);
        var x0 = Math.max(0, pl.x + b.x0), y0 = Math.max(0, pl.y + b.y0), x1 = Math.min(pcb.w, pl.x + b.x1), y1 = Math.min(pcb.h, pl.y + b.y1);
        board.kids.push({ id: p.id, x: (x0 + x1) / 2 - pcb.w / 2, y: -((y0 + y1) / 2 - pcb.h / 2), w: Math.max(1, x1 - x0 - 0.6), d: Math.max(1, y1 - y0 - 0.6), h: tall(p.type), color: tint(p), type: p.type });
      });
    } else {
      /* no board laid out yet: the bench itself, shrunk to life size */
      var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, boxes = [];
      doc.parts.forEach(function (p) {
        if (!L.def(p) || PCB.offBoard(p.type) || /^(multimeter|scope|rf_remote)/.test(p.type)) return;
        var b = L.boxOf(p), bb = { p: p, x0: b.x * PCB.MM, y0: b.y * PCB.MM, x1: (b.x + b.w) * PCB.MM, y1: (b.y + b.h) * PCB.MM };
        boxes.push(bb);
        x0 = Math.min(x0, bb.x0); y0 = Math.min(y0, bb.y0); x1 = Math.max(x1, bb.x1); y1 = Math.max(y1, bb.y1);
      });
      board.name = "Electronics (as on the bench)"; board.color = "#3a4650";
      board.w = x1 - x0; board.d = y1 - y0;
      boxes.forEach(function (bb) {
        var isBoard = /^(breadboard|perfboard|stripboard)/.test(bb.p.type);
        board.kids.push({ id: bb.p.id, x: (bb.x0 + bb.x1) / 2 - (x0 + x1) / 2, y: -((bb.y0 + bb.y1) / 2 - (y0 + y1) / 2), w: bb.x1 - bb.x0, d: bb.y1 - bb.y0,
                          h: isBoard ? 8.5 : tall(bb.p.type) + (isBoard ? 0 : 8.5), color: isBoard ? "#e9e6dc" : tint(bb.p), type: bb.p.type, base: isBoard });
      });
    }
    board.top = board.kids.reduce(function (m, k) { return Math.max(m, k.h); }, 0) + board.h;
    out.unshift(board);
    return out;
  };

  /* How much room the electronics need, for sizing a body round them. */
  Body.need = function (doc) {
    var board = Body.items(doc).filter(function (it) { return it.id === "@board"; })[0];
    var n = board ? { w: Math.max(40, board.w), d: Math.max(30, board.d), h: Math.max(14, board.top || 14) } : { w: 70, d: 54, h: 18 };
    /* a battery pack rides in front of the board, turned sideways */
    n.batt = doc.parts.some(function (p) { return /^(battery_|k_battery)/.test(p.type); }) ? 36 : 0;
    n.d = Math.max(n.d, n.batt ? 62 : 0);
    return n;
  };

  /* ---------------------------------------------------------- templates */

  var T = Body.TEMPLATES = {};

  T.car = {
    name: "Toy car", blurb: "Four wheels, two driven. A motor on each side steers it like a tank.",
    make: function (n, wall) {
      var Ln = Math.max(130, n.w + n.batt + 56), W = Math.max(74, n.d + 16), wd = L.clamp(Ln * 0.3, 36, 62), ww = wd * 0.42, cl = wd / 2 - 10 - wall, H = Math.max(52, n.h + 34);
      var zc = cl + H / 2, ax = Ln * 0.3, ay = W / 2 + ww / 2 + 1.5, b = Body.blank(), s = b.solids;
      s.push(sol("Body shell", "carbody", [0, 0, zc], [Ln, W, H], { color: "#e2574c" }));
      [[ax, ay, "Front left wheel", "wheelL"], [ax, -ay, "Front right wheel", "wheelR"], [-ax, ay, "Rear left wheel", "wheelL"], [-ax, -ay, "Rear right wheel", "wheelR"]].forEach(function (w) {
        s.push(sol(w[2], "wheel", [w[0], w[1], wd / 2], [wd, ww, wd], { group: "part", role: w[3], color: "#2a2f35" }));
      });
      [ax, -ax].forEach(function (x, i) { s.push(sol(i ? "Rear axle hole" : "Front axle hole", "cyl", [x, 0, wd / 2], [3.4, 3.4, W + 2 * ww + 12], { rot: [90, 0, 0], op: "cut" })); });
      [1, -1].forEach(function (k) { s.push(sol(k > 0 ? "Left headlight" : "Right headlight", "cyl", [Ln / 2 - 2, k * W * 0.28, cl + H * 0.3], [5.2, 5.2, 14], { rot: [0, 90, 0], op: "cut", role: "led" })); });
      b.kind = "car"; b.drive = "wheels"; b.split = "z"; b.splitZ = r1(cl + H * 0.44);
      b.bay = { x: -Ln * 0.03 - n.batt / 2, y: 0, z: r1(cl + wall), w: n.w + 4, d: W - 2 * wall - 2, h: H * 0.5 };
      b.anchors = { motorL: [-ax, W / 2 - wall - 17.5, wd / 2], motorR: [-ax, -(W / 2 - wall - 17.5), wd / 2], battery: [b.bay.x + n.w / 2 + n.batt / 2 + 1, 0, cl + wall], led: [[Ln / 2 - 5, W * 0.28, cl + H * 0.3], [Ln / 2 - 5, -W * 0.28, cl + H * 0.3]] };
      b.wheel = wd; b.track = 2 * ay;
      return b;
    }
  };

  T.robot = {
    name: "Rover robot", blurb: "Two drive wheels, a ball caster and a head with eyes for a distance sensor.",
    make: function (n, wall) {
      var Ln = Math.max(112, n.w + n.batt + 16), W = Math.max(88, n.d + 20), Hb = Math.max(42, n.h + 22), wd = 58, ww = 14, zc = 14 + Hb / 2, b = Body.blank(), s = b.solids;
      s.push(sol("Base", "box", [0, 0, zc], [Ln, W, Hb], { color: "#2aa198" }));
      s.push(sol("Head", "box", [Ln * 0.2, 0, 14 + Hb + 19], [Ln * 0.46, W * 0.62, 38], { color: "#2aa198" }));
      s.push(sol("Left wheel", "wheel", [-Ln * 0.14, W / 2 + ww / 2 + 1.5, wd / 2], [wd, ww, wd], { group: "part", role: "wheelL", color: "#2a2f35" }));
      s.push(sol("Right wheel", "wheel", [-Ln * 0.14, -(W / 2 + ww / 2 + 1.5), wd / 2], [wd, ww, wd], { group: "part", role: "wheelR", color: "#2a2f35" }));
      s.push(sol("Ball caster", "sphere", [Ln * 0.36, 0, 8.5], [17, 17, 17], { group: "attach", color: "#c9ced3" }));
      s.push(sol("Axle hole", "cyl", [-Ln * 0.14, 0, wd / 2], [3.4, 3.4, W + 2 * ww + 12], { rot: [90, 0, 0], op: "cut" }));
      [1, -1].forEach(function (k) { s.push(sol(k > 0 ? "Left eye (sensor)" : "Right eye (sensor)", "cyl", [Ln * 0.43, k * 13, 14 + Hb + 21], [16.4, 16.4, 14], { rot: [0, 90, 0], op: "cut", role: "led" })); });
      s.push(sol("Antenna", "cyl", [Ln * 0.08, W * 0.2, 14 + Hb + 38 + 12], [3, 3, 24], { group: "attach", color: "#c9ced3" }));
      s.push(sol("Antenna ball", "sphere", [Ln * 0.08, W * 0.2, 14 + Hb + 38 + 26], [8, 8, 8], { group: "attach", color: "#e2574c" }));
      b.kind = "robot"; b.drive = "wheels"; b.split = "z"; b.splitZ = r1(14 + Hb - 6);
      b.bay = { x: n.batt / 2, y: 0, z: r1(14 + wall), w: n.w + 4, d: W - 2 * wall - 2, h: Hb - 2 * wall };
      b.anchors = { motorL: [-Ln * 0.14, W / 2 - wall - 17.5, wd / 2], motorR: [-Ln * 0.14, -(W / 2 - wall - 17.5), wd / 2], battery: [b.bay.x - n.w / 2 - n.batt / 2 - 1, 0, 14 + wall], led: [[Ln * 0.41, 13, 14 + Hb + 21], [Ln * 0.41, -13, 14 + Hb + 21]] };
      b.wheel = wd; b.track = W + ww + 3;
      return b;
    }
  };

  T.submarine = {
    name: "Submarine", blurb: "A rounded hull in two halves, a conning tower, tail fins and a propeller.",
    make: function (n, wall) {
      var D = Math.max(66, Math.max(n.d, n.h * 1.6) + 24), Ln = Math.max(180, n.w + n.batt + 90, D * 2.6), zc = D / 2 + 18, b = Body.blank(), s = b.solids;
      s.push(sol("Hull", "capsule", [0, 0, zc], [Ln, D, D], { color: "#f2b13a" }));
      s.push(sol("Conning tower", "cyl", [Ln * 0.06, 0, zc + D * 0.5 + D * 0.1], [Ln * 0.2, D * 0.36, D * 0.36], { color: "#f2b13a" }));
      s.push(sol("Periscope", "cyl", [Ln * 0.09, 0, zc + D * 0.78 + 9], [4, 4, 22], { group: "attach", color: "#59636b" }));
      s.push(sol("Tail planes", "box", [-Ln * 0.4, 0, zc], [Ln * 0.1, D * 1.15, 2.6], { group: "attach", color: "#d4893a" }));
      s.push(sol("Rudder", "box", [-Ln * 0.4, 0, zc], [Ln * 0.1, 2.6, D * 1.05], { group: "attach", color: "#d4893a" }));
      s.push(sol("Propeller", "prop", [-Ln / 2 - 7, 0, zc], [10, D * 0.5, D * 0.5], { group: "part", role: "prop", color: "#c9a03c" }));
      s.push(sol("Propeller shaft hole", "cyl", [-Ln / 2 + 8, 0, zc], [3.4, 3.4, 30], { rot: [0, 90, 0], op: "cut" }));
      [0.24, 0.06, -0.12].forEach(function (k, i) { s.push(sol("Porthole " + (i + 1), "cyl", [Ln * k, 0, zc + D * 0.12], [9, 9, D + 12], { rot: [90, 0, 0], op: "cut", role: i ? "" : "led" })); });
      s.push(sol("Stand", "box", [0, 0, 9], [Ln * 0.3, D * 0.5, 18], { group: "part", color: "#59636b" }));
      b.kind = "submarine"; b.drive = "prop"; b.split = "z"; b.splitZ = r1(zc);
      b.bay = { x: -n.batt / 2, y: 0, z: r1(zc - D * 0.3), w: n.w + 4, d: D * 0.62, h: D * 0.56 };
      b.anchors = { motor: [-Ln * 0.5 + D * 0.5 + 6, 0, zc], battery: [b.bay.x + n.w / 2 + n.batt / 2 + 1, 0, zc - D * 0.3], led: [[Ln * 0.24, D * 0.42, zc + D * 0.12], [Ln * 0.24, -D * 0.42, zc + D * 0.12]] };
      return b;
    }
  };

  T.rocket = {
    name: "Space rocket", blurb: "A tube on four fins with a lift-off nose cone. The board stands upright inside.",
    make: function (n, wall) {
      var D = Math.max(56, n.d + 16, n.h * 2 + 16), tube = Math.max(130, n.w + 36), nose = D * 1.5, base = 30, fin = D * 0.72, b = Body.blank(), s = b.solids;
      s.push(sol("Body tube", "cyl", [0, 0, base + tube / 2], [D, D, tube], { color: "#e8eef4" }));
      s.push(sol("Nose cone", "nose", [0, 0, base + tube + nose / 2], [D, D, nose], { color: "#e2574c" }));
      for (var i = 0; i < 4; i++) {
        var a = i * Math.PI / 2, rr = D / 2 + fin / 2 - 2.5;
        s.push(sol("Fin " + (i + 1), "fin", [Math.cos(a) * rr, Math.sin(a) * rr, D * 0.75], [fin, 3.2, D * 1.5], { rot: [0, 0, i * 90], group: "attach", color: "#e2574c" }));
      }
      s.push(sol("Engine bell", "cone", [0, 0, base - 9], [D * 0.62, D * 0.62, 22], { rot: [180, 0, 0], group: "attach", color: "#59636b", p: { top: 0.55 } }));
      s.push(sol("Window", "cyl", [D / 2 - 2, 0, base + tube * 0.72], [13, 13, 16], { rot: [0, 90, 0], op: "cut", role: "led" }));
      b.kind = "rocket"; b.drive = "rocket"; b.split = "z"; b.splitZ = r1(base + tube);
      b.bay = { x: 0, y: 0, z: r1(base + wall + 2), w: D * 0.3, d: D - 2 * wall - 4, h: tube - 8, upright: true };
      b.anchors = { motor: [0, 0, base + 14], battery: [0, 0, base + wall + 2], led: [[D / 2 - 6, 0, base + tube * 0.72]], servo: [0, 0, base + tube - 22] };
      return b;
    }
  };

  T.boat = {
    name: "Boat", blurb: "An open hull with a pointed bow, a cabin and a propeller at the stern.",
    make: function (n, wall) {
      var Ln = Math.max(170, n.w + n.batt + 100), W = Math.max(84, n.d + 26), H = Math.max(40, n.h + 18), b = Body.blank(), s = b.solids;
      s.push(sol("Hull", "boat", [0, 0, H / 2], [Ln, W, H], { color: "#3b6fd4" }));
      s.push(sol("Open deck", "box", [-Ln * 0.08, 0, H / 2 + wall + 1], [Ln * 0.62, W - 2 * wall - 8, H], { op: "cut" }));
      s.push(sol("Cabin", "box", [-Ln * 0.36, 0, H + 13], [Ln * 0.2, W * 0.6, 26], { group: "part", color: "#e8eef4" }));
      s.push(sol("Propeller", "prop", [-Ln / 2 - 7, 0, H * 0.3], [9, H * 0.55, H * 0.55], { group: "part", role: "prop", color: "#c9a03c" }));
      s.push(sol("Propeller shaft hole", "cyl", [-Ln / 2 + 6, 0, H * 0.3], [3.4, 3.4, 26], { rot: [0, 90, 0], op: "cut" }));
      s.push(sol("Bow light", "cyl", [Ln * 0.36, 0, H - 4], [5.2, 5.2, 14], { op: "cut", role: "led" }));
      b.kind = "boat"; b.drive = "boat"; b.split = "none"; b.splitZ = 0;
      b.bay = { x: -Ln * 0.5 + wall + 40 + n.w / 2, y: 0, z: r1(wall), w: n.w + 4, d: W - 2 * wall - 10, h: H };
      b.anchors = { motor: [-Ln * 0.5 + wall + 19, 0, wall + 11], battery: [b.bay.x + n.w / 2 + n.batt / 2 + 1, 0, wall], led: [[Ln * 0.36, 0, H - 6]] };
      return b;
    }
  };

  T.box = {
    name: "Project box", blurb: "A plain case with a lid, sized to the board, with a light hole and a cable slot.",
    make: function (n, wall) {
      var Ln = n.w + 14, W = n.d + 14, H = n.h + 14, b = Body.blank(), s = b.solids;
      s.push(sol("Case", "box", [0, 0, H / 2], [Ln, W, H], { color: "#59636b" }));
      s.push(sol("Light hole", "cyl", [Ln * 0.25, 0, H - 2], [5.2, 5.2, 14], { op: "cut", role: "led" }));
      s.push(sol("Cable slot", "box", [-Ln / 2, 0, wall + 9], [14, 13, 8], { op: "cut" }));
      b.kind = "box"; b.drive = "none"; b.split = "z"; b.splitZ = r1(H - 6);
      b.bay = { x: 0, y: 0, z: r1(wall), w: Ln - 2 * wall - 2, d: W - 2 * wall - 2, h: H - 2 * wall };
      b.anchors = { led: [[Ln * 0.25, 0, H - 5]] };
      return b;
    }
  };

  T.tank = {
    name: "Tank", blurb: "A low hull on four wide wheels with a turret and a barrel. Steers like a tank, because it is one.",
    make: function (n, wall) {
      var Ln = Math.max(140, n.w + n.batt + 30), W = Math.max(90, n.d + 18), wd = 46, ww = 22, cl = wd / 2 - 10 - wall, H = Math.max(40, n.h + 20), zc = cl + H / 2;
      var ax = Ln * 0.32, ay = W / 2 + ww / 2 + 1.5, b = Body.blank(), s = b.solids;
      s.push(sol("Hull", "box", [0, 0, zc], [Ln, W, H], { color: "#5a7a3a" }));
      s.push(sol("Glacis", "wedge", [Ln / 2 + 9, 0, zc], [18, W, H], { rot: [0, 0, 180], group: "attach", color: "#5a7a3a" }));
      s.push(sol("Turret", "cyl", [-Ln * 0.05, 0, cl + H + 11], [W * 0.62, W * 0.62, 22], { group: "attach", color: "#4a6a2e" }));
      s.push(sol("Barrel", "cyl", [Ln * 0.28, 0, cl + H + 12], [8, 8, Ln * 0.5], { rot: [0, 90, 0], group: "attach", color: "#3a3f35" }));
      [[ax, ay, "Front left wheel", "wheelL"], [ax, -ay, "Front right wheel", "wheelR"], [-ax, ay, "Rear left wheel", "wheelL"], [-ax, -ay, "Rear right wheel", "wheelR"]].forEach(function (w) {
        s.push(sol(w[2], "wheel", [w[0], w[1], wd / 2], [wd, ww, wd], { group: "part", role: w[3], color: "#2a2f35" }));
      });
      [ax, -ax].forEach(function (x, i) { s.push(sol(i ? "Rear axle hole" : "Front axle hole", "cyl", [x, 0, wd / 2], [3.4, 3.4, W + 2 * ww + 12], { rot: [90, 0, 0], op: "cut" })); });
      s.push(sol("Headlight", "cyl", [Ln / 2 - 2, W * 0.3, zc + 4], [5.2, 5.2, 14], { rot: [0, 90, 0], op: "cut", role: "led" }));
      b.kind = "tank"; b.drive = "wheels"; b.split = "z"; b.splitZ = r1(cl + H - 5);
      b.bay = { x: -n.batt / 2, y: 0, z: r1(cl + wall), w: n.w + 4, d: W - 2 * wall - 2, h: H - 2 * wall };
      b.anchors = { motorL: [-ax, W / 2 - wall - 17.5, wd / 2], motorR: [-ax, -(W / 2 - wall - 17.5), wd / 2], battery: [b.bay.x + n.w / 2 + n.batt / 2 + 1, 0, cl + wall], led: [[Ln / 2 - 5, W * 0.3, zc + 4]] };
      b.wheel = wd; b.track = 2 * ay;
      return b;
    }
  };

  T.house = {
    name: "Model house", blurb: "Four walls, a pitched roof that lifts off, a door, windows and a porch light: a smart home to wire up.",
    make: function (n, wall) {
      var Ln = Math.max(120, n.w + n.batt + 20), W = Math.max(96, n.d + 20), H = Math.max(70, n.h + 40), b = Body.blank(), s = b.solids;
      s.push(sol("Walls", "box", [0, 0, H / 2], [Ln, W, H], { color: "#e9dcc3" }));
      s.push(sol("Roof slope (front)", "wedge", [0, W / 4, H + W * 0.19], [W / 2 + 6, Ln + 12, W * 0.38], { rot: [0, 0, 90], group: "part", color: "#b5483a" }));
      s.push(sol("Roof slope (back)", "wedge", [0, -W / 4, H + W * 0.19], [W / 2 + 6, Ln + 12, W * 0.38], { rot: [0, 0, -90], group: "part", color: "#b5483a" }));
      s.push(sol("Chimney", "box", [-Ln * 0.28, -W * 0.2, H + W * 0.3], [12, 12, 30], { group: "part", color: "#8a4a3a" }));
      s.push(sol("Door", "box", [Ln / 2, -W * 0.2, 20], [8, 20, 40], { op: "cut" }));
      s.push(sol("Front window", "box", [Ln / 2, W * 0.2, H * 0.55], [8, 24, 22], { op: "cut" }));
      s.push(sol("Side window", "box", [0, W / 2, H * 0.55], [30, 8, 22], { op: "cut" }));
      s.push(sol("Porch light", "cyl", [Ln / 2 - 2, -W * 0.2, 50], [5.2, 5.2, 14], { rot: [0, 90, 0], op: "cut", role: "led" }));
      b.kind = "house"; b.drive = "none"; b.split = "none"; b.splitZ = 0;
      s.push(sol("Open top", "box", [0, 0, H], [Ln - 2 * wall, W - 2 * wall, 12], { op: "cut" }));
      b.bay = { x: -n.batt / 2, y: 0, z: r1(wall), w: n.w + 4, d: W - 2 * wall - 2, h: H - 2 * wall };
      b.anchors = { battery: [b.bay.x + n.w / 2 + n.batt / 2 + 1, 0, wall], motor: [-Ln / 2 + wall + 18, W / 2 - wall - 12, H * 0.5], servo: [Ln / 2 - wall - 14, W * 0.2, H * 0.3], led: [[Ln / 2 - 5, -W * 0.2, 50]] };
      return b;
    }
  };

  T.tower = {
    name: "Tower", blurb: "A tapering tower with a lamp room and a dome: a lighthouse, a weather station or a control tower.",
    make: function (n, wall) {
      var D = Math.max(96, Math.hypot(n.w, n.d) + 14), baseH = Math.max(34, n.h + 16), towerH = 120, b = Body.blank(), s = b.solids;
      s.push(sol("Base", "cyl", [0, 0, baseH / 2], [D, D, baseH], { color: "#e8eef4" }));
      s.push(sol("Tower", "cone", [0, 0, baseH + towerH / 2], [D * 0.5, D * 0.5, towerH], { group: "part", color: "#e2574c", p: { top: 0.6 } }));
      s.push(sol("Gallery", "cyl", [0, 0, baseH + towerH + 2], [D * 0.44, D * 0.44, 4], { group: "part", color: "#59636b" }));
      s.push(sol("Lamp room", "tube", [0, 0, baseH + towerH + 17], [D * 0.3, D * 0.3, 26], { group: "part", color: "#f6e7a1", p: { wall: 0.08 } }));
      s.push(sol("Dome", "dome", [0, 0, baseH + towerH + 38], [D * 0.34, D * 0.34, 16], { group: "part", color: "#59636b" }));
      s.push(sol("Lamp hole", "cyl", [0, 0, baseH], [5.2, 5.2, 14], { op: "cut", role: "led" }));
      s.push(sol("Cable slot", "box", [-D / 2, 0, wall + 8], [14, 13, 8], { op: "cut" }));
      b.kind = "tower"; b.drive = "none"; b.split = "z"; b.splitZ = r1(baseH - 6);
      b.bay = { x: 0, y: 0, z: r1(wall), w: n.w + 4, d: n.d + 4, h: baseH - 2 * wall };
      b.anchors = { led: [[0, 0, baseH - 4]], servo: [0, 0, baseH - 30] };
      return b;
    }
  };

  T.pet = {
    name: "Desk pet", blurb: "A round little creature with big eyes, ears and feet. Give it a sensor and it has a personality.",
    make: function (n, wall) {
      var D = Math.max(110, Math.hypot(n.w + n.batt + 6, n.d + 6) + 34), H = Math.max(96, D * 0.86), b = Body.blank(), s = b.solids;
      var floor = H / 2 + 6 - n.h * 0.6 - 4;
      s.push(sol("Body", "sphere", [0, 0, H / 2 + 6], [D, D, H], { color: "#7b6cf6" }));
      [1, -1].forEach(function (k) {
        s.push(sol(k > 0 ? "Left eye" : "Right eye", "cyl", [D * 0.44, k * D * 0.16, H * 0.62 + 6], [16.4, 16.4, 30], { rot: [0, 90, 0], op: "cut", role: "led" }));
        s.push(sol(k > 0 ? "Left ear" : "Right ear", "cone", [0, k * D * 0.3, H + 10], [24, 14, 34], { rot: [k * -18, 0, 0], group: "attach", color: "#5b4bd6" }));
        s.push(sol(k > 0 ? "Left foot" : "Right foot", "dome", [D * 0.16, k * D * 0.24, 6], [44, 30, 14], { group: "attach", color: "#5b4bd6" }));
      });
      s.push(sol("Mouth", "box", [D * 0.46, 0, H * 0.36 + 6], [30, 26, 4], { op: "cut" }));
      s.push(sol("Tail", "cone", [-D * 0.5, 0, H * 0.3], [12, 12, 34], { rot: [0, -70, 0], group: "attach", color: "#5b4bd6" }));
      b.kind = "pet"; b.drive = "none"; b.split = "z"; b.splitZ = r1(H / 2 + 6);
      b.bay = { x: -n.batt / 2, y: 0, z: r1(floor), w: n.w + 4, d: n.d + 4, h: H * 0.4 };
      b.anchors = { battery: [b.bay.x + n.w / 2 + n.batt / 2 + 1, 0, floor], servo: [-D * 0.3, 0, H * 0.3], led: [[D * 0.4, D * 0.16, H * 0.62 + 6], [D * 0.4, -D * 0.16, H * 0.62 + 6]] };
      return b;
    }
  };

  Body.make = function (kind, doc, wall) {
    var t = T[kind] || T.box;
    wall = L.clamp(+wall || 2, 1.2, 5);
    var b = t.make(Body.need(doc), wall);
    b.wall = wall;
    b.mounts = Body.automount(doc, b);
    return b;
  };

  /* ------------------------------------------------------------ mounting */

  /* Put every item somewhere sensible: the board on the floor of the bay,
   * motors by the wheels or the propeller, the battery in its own corner.
   * A mount is the middle of the item's underside. */
  Body.automount = function (doc, body) {
    var items = Body.items(doc), bay = body.bay || { x: 0, y: 0, z: 0, w: 100, d: 80, h: 40 }, an = body.anchors || {}, out = {};
    var motors = 0, spare = 0;
    items.forEach(function (it) {
      if (it.id === "@board") {
        out[it.id] = bay.upright ? { x: bay.x, y: bay.y, z: bay.z + it.w / 2, rx: 0, ry: -90, rz: 0 } : { x: bay.x, y: bay.y, z: bay.z + 3, rx: 0, ry: 0, rz: 0 };
        return;
      }
      var a = null, rz = 0;
      if (/motor/.test(it.type)) {
        a = motors === 0 ? (an.motorL || an.motor) : motors === 1 ? (an.motorR || null) : null;
        if (a && an.motorL) { rz = motors === 0 ? 90 : -90; }
        else if (a && body.drive === "rocket") rz = 0;
        motors++;
      } else if (/battery/.test(it.type)) { a = an.battery; rz = body.drive === "rocket" ? 0 : 90; }
      else if (it.type === "servo") a = an.servo;
      if (a) out[it.id] = { x: r1(a[0]), y: r1(a[1]), z: r1(a[2] - (/motor/.test(it.type) ? it.h / 2 : 0)), rx: 0, ry: /motor/.test(it.type) && body.drive === "rocket" ? -90 : 0, rz: rz };
      else { out[it.id] = { x: r1(bay.x - bay.w / 2 + it.w / 2 + 2 + spare), y: r1(bay.y + bay.d / 2 - it.d / 2 - 1), z: r1(bay.z + (bay.upright ? 4 : 0)), rx: 0, ry: 0, rz: 0 }; spare += it.w + 2; }
    });
    return out;
  };

  /* Keep the mounts in step with the bench: new things get a place, gone
   * things lose theirs. Returns true when anything moved. */
  Body.ensure = function (doc) {
    var body = doc.body;
    if (!body) return false;
    body.mounts = body.mounts || {}; body.solids = body.solids || [];
    var items = Body.items(doc), ids = {}, changed = false, auto = null;
    items.forEach(function (it) {
      ids[it.id] = 1;
      if (!body.mounts[it.id]) { auto = auto || Body.automount(doc, body); body.mounts[it.id] = auto[it.id]; changed = true; }
    });
    Object.keys(body.mounts).forEach(function (id) { if (!ids[id]) { delete body.mounts[id]; changed = true; } });
    return changed;
  };

  /* Each item's box in the world: eight corners after its mount. */
  Body.itemBox = function (it, m) {
    var M = S.rot([m.rx || 0, m.ry || 0, m.rz || 0]), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], top = it.top || it.h;
    for (var i = 0; i < 8; i++) {
      var x = (i & 1 ? 0.5 : -0.5) * it.w, y = (i & 2 ? 0.5 : -0.5) * it.d, z = i & 4 ? top : 0;
      var w = [M[0] * x + M[1] * y + M[2] * z + m.x, M[3] * x + M[4] * y + M[5] * z + m.y, M[6] * x + M[7] * y + M[8] * z + m.z];
      for (var k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], w[k]); hi[k] = Math.max(hi[k], w[k]); }
    }
    return { lo: lo, hi: hi };
  };

  /* Does it all fit? Tested against the real hull, not a box round it:
   * a corner of each item is inside if a ray from it leaves through an odd
   * number of faces. */
  Body.fit = function (doc, body) {
    var hull = body.solids.filter(function (s) { return s.op !== "cut" && s.group === "hull"; });
    if (!hull.length) return [];
    /* a parity count over the union of overlapping solids would be wrong,
     * so ask each solid in turn */
    var each = hull.map(function (s) { return S.tris(S.fromSpec(s, -2 * (body.wall || 2))); });
    var inside = function (p) { return each.some(function (t) { return Body.inside(t, p); }); };
    var out = [];
    Body.items(doc).forEach(function (it) {
      var m = body.mounts[it.id]; if (!m) return;
      var b = Body.itemBox(it, m), bad = 0;
      /* a millimetre of grace: a part resting against a wall is not sticking out */
      for (var i = 0; i < 8; i++) { if (!inside([i & 1 ? b.hi[0] - 1.2 : b.lo[0] + 1.2, i & 2 ? b.hi[1] - 1.2 : b.lo[1] + 1.2, i & 4 ? b.hi[2] - 1.2 : b.lo[2] + 1.2])) bad++; }
      /* motors are allowed to reach out to their wheels */
      if (bad > (/motor/.test(it.type) ? 4 : 0)) out.push({ id: it.id, name: it.name, corners: bad });
    });
    return out;
  };
  Body.inside = function (tris, p) {
    var n = 0, dir = [0.577, 0.211, 0.789];
    for (var i = 0; i < tris.length; i++) { var t = Body.hit(p, dir, tris[i]); if (t != null && t > 0) n++; }
    return n % 2 === 1;
  };
  /* Möller–Trumbore: distance along a ray to a triangle, or null. */
  Body.hit = function (o, d, t) {
    var V = S.vec, e1 = V.sub(t[1], t[0]), e2 = V.sub(t[2], t[0]), h = V.cross(d, e2), a = V.dot(e1, h);
    if (a > -1e-9 && a < 1e-9) return null;
    var f = 1 / a, s = V.sub(o, t[0]), u = f * V.dot(s, h);
    if (u < 0 || u > 1) return null;
    var q = V.cross(s, e1), v = f * V.dot(d, q);
    if (v < 0 || u + v > 1) return null;
    return f * V.dot(e2, q);
  };

  /* ------------------------------------------------------------ printing */

  function unionAll(list) { var m = []; list.forEach(function (x) { m = m.length ? S.union(m, x) : x; }); return m; }

  /* Turn the design into the pieces a printer makes. Returns
   * [{name, file, mesh, qty, color, grams, note}], each lying flat on z = 0
   * the way it should be printed. */
  Body.build = function (doc, body) {
    var wall = body.wall || 2, out = [];
    var hull = body.solids.filter(function (s) { return s.op !== "cut" && s.group === "hull"; });
    var attach = body.solids.filter(function (s) { return s.op !== "cut" && s.group === "attach"; });
    var cuts = body.solids.filter(function (s) { return s.op === "cut"; });
    var parts = body.solids.filter(function (s) { return s.op !== "cut" && s.group === "part"; });
    var lay = function (m, flip) {
      if (flip) m = S.xf(m, { r: [180, 0, 0] });
      var bb = S.bbox(m);
      return S.xf(m, { t: [-(bb.lo[0] + bb.hi[0]) / 2, -(bb.lo[1] + bb.hi[1]) / 2, -bb.lo[2]] });
    };
    var grams = function (m, solid) { return Math.max(0, S.volume(S.tris(m))) / 1000 * 1.24 * (solid ? 0.4 : 1); };
    if (hull.length) {
      var outer = unionAll(hull.map(function (s) { return S.fromSpec(s); }));
      var inner = unionAll(hull.map(function (s) { return S.fromSpec(s, -2 * wall); }));
      var shell = S.subtract(outer, inner), adds = [], drill = [];
      /* posts for the board to screw down onto, grown from the floor */
      var items = Body.items(doc), board = items.filter(function (it) { return it.id === "@board"; })[0], m = board && body.mounts[board.id];
      if (board && m && !(m.rx || m.ry) && board.w > 16 && board.d > 16) {
        var ob = S.bbox(outer), M = S.rot([0, 0, m.rz || 0]), posts = [], holes = [];
        [[1, 1], [1, -1], [-1, 1], [-1, -1]].forEach(function (k) {
          var lx = k[0] * (board.w / 2 - 3.5), ly = k[1] * (board.d / 2 - 3.5), x = M[0] * lx + M[1] * ly + m.x, y = M[3] * lx + M[4] * ly + m.y;
          var h = m.z - ob.lo[2];
          if (h < 1) return;
          posts.push(S.fromSpec({ shape: "cyl", sx: 6.5, sy: 6.5, sz: h, x: x, y: y, z: ob.lo[2] + h / 2 }));
          holes.push(S.fromSpec({ shape: "cyl", sx: 2.4, sy: 2.4, sz: 12, x: x, y: y, z: m.z - 2 }));
        });
        adds = posts.map(function (p) { return S.intersect(p, outer); });
        drill = holes;
      }
      /* one union and one subtraction, however many fins and holes: every
       * boolean re-cuts the whole shell, so they are batched */
      adds = adds.concat(attach.map(function (s) { return S.fromSpec(s); }));
      drill = drill.concat(cuts.map(function (s) { return S.fromSpec(s); }));
      if (adds.length) shell = S.union(shell, unionAll(adds));
      if (drill.length) shell = S.subtract(shell, unionAll(drill));
      var bb = S.bbox(shell), big = Math.max(bb.size[0], bb.size[1], bb.size[2]) * 4 + 100;
      if (body.split === "z" && body.splitZ > bb.lo[2] + 1 && body.splitZ < bb.hi[2] - 1) {
        var top = S.intersect(shell, S.fromSpec({ shape: "box", sx: big, sy: big, sz: big, z: body.splitZ + big / 2 }));
        var bot = S.intersect(shell, S.fromSpec({ shape: "box", sx: big, sy: big, sz: big, z: body.splitZ - big / 2 }));
        out.push({ name: "Shell — lower half", file: "shell-lower", mesh: lay(bot, false), qty: 1, color: hull[0].color, note: "Print open side up. The board screws onto the four posts." });
        out.push({ name: "Shell — upper half", file: "shell-upper", mesh: lay(top, true), qty: 1, color: hull[0].color, note: "Printed upside down, open side up, so it needs no supports inside." });
      } else out.push({ name: "Shell", file: "shell", mesh: lay(shell, false), qty: 1, color: hull[0].color, note: "Print as it stands." });
    }
    /* like parts are printed several times, not listed several times */
    var seen = {};
    parts.forEach(function (s) {
      var key = [s.shape, s.sx, s.sy, s.sz, JSON.stringify(s.p || {})].join("|");
      if (seen[key]) { seen[key].qty++; return; }
      var m2 = S.fromSpec({ shape: s.shape, sx: s.sx, sy: s.sy, sz: s.sz, p: s.p, rx: s.shape === "wheel" ? 90 : s.shape === "prop" ? 0 : 0, ry: s.shape === "prop" ? 90 : 0 });
      if (s.shape === "wheel" || s.shape === "prop") m2 = S.subtract(m2, S.fromSpec({ shape: "cyl", sx: 3.1, sy: 3.1, sz: 200 }));
      var base = s.name.replace(/^(front|rear|left|right)\s+/i, "").replace(/\s+\d+$/, "");
      base = base.replace(/^(left|right)\s+/i, "");
      base = base.charAt(0).toUpperCase() + base.slice(1);
      seen[key] = { name: base, file: base.toLowerCase().replace(/[^a-z0-9]+/g, "-"), mesh: lay(m2, false), qty: 1, color: s.color, solid: true,
                    note: s.shape === "wheel" ? "Lying flat. The 3 mm bore is a push fit on a motor shaft or axle." : s.shape === "prop" ? "Flat, hub down. Push onto a 3 mm shaft." : "" };
      out.push(seen[key]);
    });
    out.forEach(function (o) { o.tris = S.sealed(o.mesh); o.grams = grams(o.mesh, o.solid) * o.qty; var b2 = S.bbox(o.mesh); o.size = b2.size; });
    return out;
  };

  /* The zip handed to the person with the printer. */
  Body.printFiles = function (doc, body, title) {
    var pieces = Body.build(doc, body), files = [], total = 0;
    var base = String(title || "body").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "body";
    var sheet = "3-D print sheet: " + (title || "body") + "\r\nMade in Chalk Circuit Lab. Units are millimetres.\r\n\r\n";
    pieces.forEach(function (p, i) {
      var fname = base + "-" + (i + 1) + "-" + p.file + (p.qty > 1 ? "-x" + p.qty : "") + ".stl";
      files.push({ name: fname, data: S.stl(p.tris, p.name) });
      total += p.grams;
      sheet += fname + "\r\n    " + p.name + (p.qty > 1 ? " — print " + p.qty : "") + "\r\n    " + p.size.map(function (v) { return v.toFixed(0); }).join(" x ") + " mm, about " + Math.max(1, Math.round(p.grams)) + " g" + (p.note ? "\r\n    " + p.note : "") + "\r\n\r\n";
    });
    sheet += "About " + Math.round(total) + " g of plastic in all.\r\n\r\nSuggested settings\r\n    PLA or PETG, 0.2 mm layers, 3 walls, 15-20 % infill.\r\n    Walls are " + (body.wall || 2) + " mm thick.\r\n" +
      "    Holes are sized for 5 mm LEDs (5.2 mm), 3 mm shafts and M2.5 self-tapping screws into the board posts.\r\n\r\n" +
      "Check the pieces in your slicer before printing: these shapes were made by a program for a classroom project,\r\nand a slicer's own repair step will tidy any tiny seams the hollowing leaves.\r\n" +
      "A printed body is a model, not a pressure hull or a flight article: don't put a submarine in deep water or anything hot in a rocket.\r\n";
    files.push({ name: "PRINT-SHEET.txt", data: sheet });
    return { files: files, pieces: pieces, grams: total };
  };
})(typeof window !== "undefined" ? window : globalThis);
