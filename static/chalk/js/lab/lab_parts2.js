/* Chalk Circuit Lab — the rest of the drawer: transistors, chips, switches,
 * things that move and make noise, sensors and meters. See lab_parts.js for
 * what each field means. */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var P = L.P, add = L.addPart, S = L.svg;
  var lead = S.lead, leadPath = S.leadPath, shadow = S.shadow, text = S.text, sock = S.sock;

  /* ============================================================ TRANSISTORS */

  function to92(label, pins) {
    return function () {
      var s = leadPath("M0 0V" + (-0.5 * P) + "L" + (0.45 * P) + " " + (-1 * P)) +
              lead(P, 0, P, -1 * P) +
              leadPath("M" + (2 * P) + " 0V" + (-0.5 * P) + "L" + (1.55 * P) + " " + (-1 * P));
      s += '<path d="M' + (-0.1 * P + 3) + ' ' + (-1 * P + 4) + 'h' + (2.2 * P) + 'v-' + (0.8 * P) + 'a' + (1.1 * P) + ' ' + (1 * P) + ' 0 0 0 -' + (2.2 * P) + ' 0z" fill="#000" opacity=".28"/>';
      s += '<path d="M' + (-0.1 * P) + ' ' + (-1 * P) + 'h' + (2.2 * P) + 'v-' + (0.8 * P) + 'a' + (1.1 * P) + ' ' + (1 * P) + ' 0 0 0 -' + (2.2 * P) + ' 0z" fill="#222" stroke="#000"/>';
      s += '<path d="M' + (-0.1 * P) + ' ' + (-1 * P) + 'h' + (2.2 * P) + '" stroke="#555" stroke-width="2"/>';
      s += text(P, -1.45 * P, label, 7.5, "#b9c0c6", { weight: 700 });
      s += text(0, 0.75 * P, pins[0], 8, "#d8dee3", { weight: 700 }) + text(P, 0.75 * P, pins[1], 8, "#d8dee3", { weight: 700 }) + text(2 * P, 0.75 * P, pins[2], 8, "#d8dee3", { weight: 700 });
      s += '<g data-live="burnt" opacity="0"><path d="M' + (0.2 * P) + ' ' + (-1.6 * P) + 'l6 5l5 -6l6 6l5 -4" stroke="#ff7a3a" stroke-width="1.5" fill="none"/></g>';
      return s;
    };
  }
  function burntLive(g, st) { if (g.burnt) g.burnt.setAttribute("opacity", st.burnt ? 1 : 0); L.heatLive(g, st); }

  add("npn", {
    name: "NPN transistor (2N2222)", cat: "Semiconductors",
    blurb: "An electronic switch. A small current into the base (B) lets a big current flow from collector (C) to emitter (E).",
    pins: [{ n: "E", x: 0, y: 0, label: "emitter" }, { n: "B", x: P, y: 0, label: "base" }, { n: "C", x: 2 * P, y: 0, label: "collector" }],
    box: { x: -0.3 * P, y: -2.2 * P, w: 2.6 * P, h: 3.2 * P },
    props: { beta: 150 },
    spec: [{ k: "beta", label: "Gain (β)", type: "select", options: [[50, "50"], [100, "100"], [150, "150"], [300, "300"]] }],
    art: to92("2N2222", ["E", "B", "C"]), live: burntLive
  });
  add("pnp", {
    name: "PNP transistor (2N3906)", cat: "Semiconductors",
    blurb: "The mirror of an NPN: pull its base low and current flows from emitter to collector.",
    pins: [{ n: "E", x: 0, y: 0, label: "emitter" }, { n: "B", x: P, y: 0, label: "base" }, { n: "C", x: 2 * P, y: 0, label: "collector" }],
    box: { x: -0.3 * P, y: -2.2 * P, w: 2.6 * P, h: 3.2 * P },
    props: { beta: 150 },
    art: to92("2N3906", ["E", "B", "C"]), live: burntLive
  });
  add("nmos", {
    name: "N-MOSFET (IRLZ44N)", cat: "Semiconductors",
    blurb: "A logic-level power switch. 5 V on the gate lets amps flow from drain to source — perfect for motors.",
    pins: [{ n: "G", x: 0, y: 0, label: "gate" }, { n: "D", x: P, y: 0, label: "drain" }, { n: "S", x: 2 * P, y: 0, label: "source" }],
    box: { x: -0.4 * P, y: -4.4 * P, w: 2.8 * P, h: 5.2 * P },
    props: {},
    art: function () {
      var s = lead(0, 0, 0, -1 * P) + lead(P, 0, P, -1 * P) + lead(2 * P, 0, 2 * P, -1 * P);
      s += shadow(-0.4 * P, -4.4 * P, 2.8 * P, 3.5 * P, 3);
      s += '<rect x="' + (-0.4 * P) + '" y="' + (-4.4 * P) + '" width="' + (2.8 * P) + '" height="' + (1.4 * P) + '" rx="2" fill="#c6ccd1" stroke="#8a9196"/>';
      s += '<circle cx="' + P + '" cy="' + (-3.7 * P) + '" r="6" fill="#4a5056"/>';
      s += '<rect x="' + (-0.4 * P) + '" y="' + (-3.1 * P) + '" width="' + (2.8 * P) + '" height="' + (2.2 * P) + '" rx="2" fill="#1e1e1e"/>';
      s += text(P, -2.3 * P, "IRLZ44N", 7.5, "#b9c0c6", { weight: 700 });
      s += text(0, 0.75 * P, "G", 8, "#d8dee3", { weight: 700 }) + text(P, 0.75 * P, "D", 8, "#d8dee3", { weight: 700 }) + text(2 * P, 0.75 * P, "S", 8, "#d8dee3", { weight: 700 });
      s += '<g data-live="burnt" opacity="0"><path d="M' + (0.1 * P) + ' ' + (-1.6 * P) + 'l7 4l6 -5l6 6l6 -4" stroke="#ff7a3a" stroke-width="1.5" fill="none"/></g>';
      return s;
    },
    live: burntLive
  });

  /* =================================================================== CHIPS */

  /* A DIP chip straddling the channel: top row on row e, bottom row on f.
   * Pin 1 is bottom-left with the notch to the left, counting anticlockwise,
   * the way every datasheet draws it. */
  function dip(count, label, names, sub) {
    var half = count / 2, pins = [];
    for (var i = 0; i < half; i++) pins.push({ n: String(i + 1), x: i * P, y: 3 * P, label: (i + 1) + " " + names[i] });
    for (i = half; i < count; i++) pins.push({ n: String(i + 1), x: (count - 1 - i) * P, y: 0, label: (i + 1) + " " + names[i] });
    return {
      pins: pins,
      box: { x: -0.6 * P, y: -0.3 * P, w: half * P + 0.2 * P, h: 3.6 * P },
      art: function (part, pr) {
        var w = (half - 1) * P + 1.2 * P, x = -0.6 * P, y = 0.35 * P, h = 2.3 * P;
        var s = "";
        pins.forEach(function (p) {
          var yy = p.y === 0 ? 0 : 3 * P;
          s += '<rect x="' + (p.x - 3.5) + '" y="' + (yy === 0 ? -1 : y + h - 2) + '" width="7" height="' + (yy === 0 ? y + 3 : 3 * P - y - h + 3) + '" fill="#c6ccd1" stroke="#7d858b" stroke-width=".8"/>';
        });
        s += shadow(x, y, w, h, 3);
        s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="#1c1c1e"/>';
        s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="5" rx="2" fill="#fff" opacity=".07"/>';
        s += '<path d="M' + x + ' ' + (y + h / 2 - 7) + 'a7 7 0 0 1 0 14z" fill="#0c0c0d"/>';
        s += '<circle cx="' + (x + 9) + '" cy="' + (y + h - 8) + '" r="3" fill="#0c0c0d"/>';
        s += text(x + w / 2 + 4, y + h / 2 - (sub ? 5 : 0), typeof label === "function" ? label(pr) : label, 11, "#c6ccd1", { weight: 700 });
        if (sub) s += text(x + w / 2 + 4, y + h / 2 + 8, typeof sub === "function" ? sub(pr) : sub, 8, "#8b949b");
        s += '<g data-live="burnt" opacity="0"><path d="M' + (x + 14) + ' ' + (y + 10) + 'l8 6l8 -7l8 7" stroke="#ff7a3a" stroke-width="1.6" fill="none"/></g>';
        return s;
      },
      live: burntLive
    };
  }

  var t555 = dip(8, "NE555", ["GND", "TRIG", "OUT", "RESET", "CTRL", "THRES", "DISCH", "VCC"], "timer");
  t555.name = "555 timer"; t555.cat = "Chips";
  t555.blurb = "The famous timer chip. With two resistors and a capacitor it blinks, beeps and counts time.";
  t555.props = {};
  add("ic555", t555);

  var GATES = {
    "7400": { name: "NAND", fn: function (a, b) { return !(a && b); } },
    "7408": { name: "AND",  fn: function (a, b) { return a && b; } },
    "7432": { name: "OR",   fn: function (a, b) { return a || b; } },
    "7486": { name: "XOR",  fn: function (a, b) { return a !== b; } },
    "7402": { name: "NOR",  fn: function (a, b) { return !(a || b); } }
  };
  L.GATES = GATES;
  var gate = dip(14, function (pr) { return "74HC" + (pr.chip || "7408").slice(2); },
    ["1A", "1B", "1Y", "2A", "2B", "2Y", "GND", "3Y", "3A", "3B", "4Y", "4A", "4B", "VCC"],
    function (pr) { return "quad " + (GATES[pr.chip] || GATES["7408"]).name; });
  gate.name = "Logic gate chip"; gate.cat = "Chips";
  gate.blurb = "Four two-input logic gates in one chip. Give it 5 V on pin 14 and ground on pin 7.";
  gate.props = { chip: "7408" };
  gate.spec = [{ k: "chip", label: "Gate", type: "select", options: Object.keys(GATES).map(function (k) { return [k, "74HC" + k.slice(2) + " — " + GATES[k].name]; }) }];
  add("logic_ic", gate);

  var inv = dip(14, "74HC04", ["1A", "1Y", "2A", "2Y", "3A", "3Y", "GND", "4Y", "4A", "5Y", "5A", "6Y", "6A", "VCC"], "hex NOT");
  inv.name = "NOT gate chip (74HC04)"; inv.cat = "Chips";
  inv.blurb = "Six inverters. Whatever goes in comes out flipped: HIGH becomes LOW.";
  inv.props = {};
  add("ic7404", inv);

  var opamp = dip(8, "LM358", ["OUT A", "IN A−", "IN A+", "GND", "IN B+", "IN B−", "OUT B", "VCC"], "dual op-amp");
  opamp.name = "Op-amp (LM358)"; opamp.cat = "Chips";
  opamp.blurb = "Two amplifiers. Used open-loop it is a comparator: the output goes high when + is above −.";
  opamp.props = {};
  add("lm358", opamp);

  /* ================================================================ SWITCHES */

  add("button", {
    name: "Push button", cat: "Switches",
    blurb: "Joins its two sides only while you hold it. The legs on each side are always joined to each other.",
    pins: [{ n: "1a", x: 0, y: 0 }, { n: "2a", x: 2 * P, y: 0 }, { n: "1b", x: 0, y: 3 * P }, { n: "2b", x: 2 * P, y: 3 * P }],
    buses: [["1a", "1b"], ["2a", "2b"]],
    box: { x: -0.4 * P, y: -0.2 * P, w: 2.8 * P, h: 3.4 * P },
    props: { cap: "#d43a2f" },
    spec: [{ k: "cap", label: "Cap colour", type: "select", options: [["#d43a2f", "Red"], ["#2f64d4", "Blue"], ["#2b2b2b", "Black"], ["#f2c230", "Yellow"], ["#e9e9e9", "White"], ["#33a852", "Green"]] }],
    press: true,
    art: function (part, pr) {
      var s = shadow(-0.3 * P, 0.25 * P, 2.6 * P, 2.5 * P, 3);
      s += '<rect x="' + (-0.35 * P) + '" y="' + (0.2 * P) + '" width="' + (2.7 * P) + '" height="' + (2.6 * P) + '" rx="2" fill="#2a2a2c"/>';
      s += '<rect x="' + (-0.15 * P) + '" y="' + (0.4 * P) + '" width="' + (2.3 * P) + '" height="' + (2.2 * P) + '" rx="2" fill="#c6ccd1"/>';
      [[0, 0.2], [2, 0.2], [0, 2.8], [2, 2.8]].forEach(function (q) { s += '<rect x="' + (q[0] * P - 3) + '" y="' + (q[1] < 1 ? -1 : q[1] * P - 1) + '" width="6" height="' + (q[1] < 1 ? 0.2 * P + 2 : 0.2 * P + 2) + '" fill="#c6ccd1"/>'; });
      s += '<g data-live="cap"><circle cx="' + P + '" cy="' + (1.5 * P) + '" r="' + (0.82 * P) + '" fill="#000" opacity=".35"/>' +
           '<circle cx="' + P + '" cy="' + (1.45 * P) + '" r="' + (0.78 * P) + '" fill="' + pr.cap + '"/>' +
           '<circle cx="' + (P - 4) + '" cy="' + (1.45 * P - 5) + '" r="' + (0.35 * P) + '" fill="#fff" opacity=".28"/></g>';
      return s;
    },
    live: function (g, st) {
      if (!g.cap) return;
      var t = st.on ? "translate(" + P + " " + (1.5 * P) + ") scale(.86) translate(" + (-P) + " " + (-1.5 * P) + ")" : "";
      if (g.cap.getAttribute("transform") !== t) g.cap.setAttribute("transform", t);
    }
  });

  add("slide_switch", {
    name: "Slide switch", cat: "Switches",
    blurb: "Connects the middle leg to the left leg or the right leg. Click it to slide.",
    pins: [{ n: "L", x: 0, y: 0, label: "left" }, { n: "C", x: P, y: 0, label: "common" }, { n: "R", x: 2 * P, y: 0, label: "right" }],
    box: { x: -0.6 * P, y: -1.8 * P, w: 3.2 * P, h: 2 * P },
    props: { on: false },
    toggle: "on",
    art: function () {
      var s = lead(0, 0, 0, -0.5 * P) + lead(P, 0, P, -0.5 * P) + lead(2 * P, 0, 2 * P, -0.5 * P);
      s += shadow(-0.6 * P, -1.8 * P, 3.2 * P, 1.4 * P, 2);
      s += '<rect x="' + (-0.6 * P) + '" y="' + (-1.8 * P) + '" width="' + (3.2 * P) + '" height="' + (1.4 * P) + '" rx="2" fill="#c6ccd1" stroke="#7d858b"/>';
      s += '<rect x="' + (-0.2 * P) + '" y="' + (-1.45 * P) + '" width="' + (2.4 * P) + '" height="' + (0.7 * P) + '" rx="2" fill="#2a2a2a"/>';
      s += '<g data-live="knob"><rect x="' + (-0.1 * P) + '" y="' + (-1.75 * P) + '" width="' + (1.1 * P) + '" height="' + (1.3 * P) + '" rx="2" fill="#1d1d1d" stroke="#000"/></g>';
      return s;
    },
    live: function (g, st, pr) {
      if (!g.knob) return;
      var t = pr.on ? "translate(" + (1.1 * P) + " 0)" : "";
      if (g.knob.getAttribute("transform") !== t) g.knob.setAttribute("transform", t);
    }
  });

  add("tilt_switch", {
    name: "Tilt switch", cat: "Sensors",
    blurb: "A tiny ball inside closes the circuit when it is upright and opens it when tipped over.",
    pins: [{ n: "1", x: 0, y: 0 }, { n: "2", x: P, y: 0 }],
    box: { x: -0.6 * P, y: -2.8 * P, w: 2.2 * P, h: 3 * P },
    props: { tilted: false },
    toggle: "tilted",
    art: function () {
      var s = lead(0, 0, 0, -0.6 * P) + lead(P, 0, P, -0.6 * P);
      s += '<rect x="' + (-0.45 * P + 2) + '" y="' + (-2.6 * P + 3) + '" width="' + (1.9 * P) + '" height="' + (2.1 * P) + '" rx="8" fill="#000" opacity=".25"/>';
      s += '<rect x="' + (-0.45 * P) + '" y="' + (-2.6 * P) + '" width="' + (1.9 * P) + '" height="' + (2.1 * P) + '" rx="8" fill="#c6ccd1" stroke="#8a9196"/>';
      s += '<g data-live="ball"><circle cx="' + (0.5 * P) + '" cy="' + (-1 * P) + '" r="6" fill="#6b737a"/></g>';
      return s;
    },
    live: function (g, st, pr) {
      if (!g.ball) return;
      var t = pr.tilted ? "translate(0 " + (-0.9 * P) + ")" : "";
      if (g.ball.getAttribute("transform") !== t) g.ball.setAttribute("transform", t);
    }
  });

  /* ======================================================== LIGHTS & SOUND */

  add("bulb", {
    name: "Light bulb (6 V)", cat: "Lights & sound",
    blurb: "A small filament lamp. It glows brighter the more power you give it — and pops if you give it far too much.",
    pins: [{ n: "1", x: 0, y: 0 }, { n: "2", x: 3 * P, y: 0 }],
    box: { x: -0.7 * P, y: -4.6 * P, w: 4.4 * P, h: 5.3 * P },
    props: { volts: 6, watts: 1.8 },
    spec: [{ k: "volts", label: "Rated for", type: "select", options: [[2.5, "2.5 V"], [3.5, "3.5 V"], [6, "6 V"], [12, "12 V"]] }],
    art: function () {
      var cx = 1.5 * P, cy = -3 * P;
      var s = shadow(-0.6 * P, -1.3 * P, 4.2 * P, 1.8 * P, 6);
      s += '<rect x="' + (-0.6 * P) + '" y="' + (-1.3 * P) + '" width="' + (4.2 * P) + '" height="' + (1.6 * P) + '" rx="6" fill="#2f7d46" stroke="#1d5530"/>';
      s += '<circle cx="0" cy="0" r="7" fill="#d9b44a" stroke="#8a6c1a"/><circle cx="' + (3 * P) + '" cy="0" r="7" fill="#d9b44a" stroke="#8a6c1a"/>';
      s += '<rect x="' + (cx - 0.65 * P) + '" y="' + (cy + 0.6 * P) + '" width="' + (1.3 * P) + '" height="' + (1.3 * P) + '" fill="#c6ccd1" stroke="#8a9196"/>';
      s += '<path d="M' + (cx - 0.65 * P) + ' ' + (cy + 1 * P) + 'h' + (1.3 * P) + 'M' + (cx - 0.65 * P) + ' ' + (cy + 1.4 * P) + 'h' + (1.3 * P) + '" stroke="#8a9196"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (1.25 * P) + '" fill="#eef4f8" opacity=".55" stroke="#c8d3da" stroke-width="1.5"/>';
      s += '<circle data-live="core" cx="' + cx + '" cy="' + cy + '" r="' + (1.2 * P) + '" fill="#ffe28a" opacity="0"/>';
      s += '<path data-live="fil" d="M' + (cx - 5) + ' ' + (cy + 0.9 * P) + 'V' + (cy) + 'q2.5 -6 5 0q2.5 6 5 0V' + (cy + 0.9 * P) + '" stroke="#6b5a40" stroke-width="1.6" fill="none"/>';
      s += '<ellipse cx="' + (cx - 8) + '" cy="' + (cy - 8) + '" rx="5" ry="9" fill="#fff" opacity=".55" transform="rotate(-30 ' + (cx - 8) + ' ' + (cy - 8) + ')"/>';
      s += '<g data-live="burnt" opacity="0"><path d="M' + (cx - 5) + ' ' + (cy - 1) + 'l4 3M' + (cx + 5) + ' ' + (cy - 1) + 'l-3 4" stroke="#222" stroke-width="2"/><circle cx="' + cx + '" cy="' + cy + '" r="' + (1.25 * P) + '" fill="#555" opacity=".35"/></g>';
      return s;
    },
    live: function (g, st) {
      var b = Math.min(1, st.b || 0);
      if (g.core) g.core.setAttribute("opacity", (b * 0.95).toFixed(2));
      if (g.fil) g.fil.setAttribute("stroke", b > 0.05 ? "rgb(255," + Math.round(160 + 90 * b) + "," + Math.round(60 + 160 * b) + ")" : "#6b5a40");
      if (g.burnt) g.burnt.setAttribute("opacity", st.burnt ? 1 : 0);
    },
    glow: function (st) { return st.b > 0.02 ? [{ x: 1.5 * P, y: -3 * P, r: 30 + 90 * Math.min(1, st.b), c: "#ffd36b", a: Math.min(1, 0.2 + st.b) }] : null; }
  });

  function speaker(label) {
    return function () {
      var cx = P, cy = -1.4 * P, r = 1.25 * P;
      var s = lead(0, 0, 0, -0.4 * P) + lead(2 * P, 0, 2 * P, -0.4 * P);
      s += '<circle cx="' + (cx + 2) + '" cy="' + (cy + 4) + '" r="' + r + '" fill="#000" opacity=".3"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#1d1d1f" stroke="#000"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.72) + '" fill="#262628"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="#0a0a0a"/>';
      s += text(cx - r * 0.55, cy - r * 0.55, "+", 10, "#ddd", { weight: 800 });
      if (label) s += text(cx, cy + r * 0.5, label, 6.5, "#999", { weight: 700 });
      s += '<g data-live="waves" opacity="0" stroke="#ffcf5a" stroke-width="2" fill="none" stroke-linecap="round">' +
           '<path d="M' + (cx + r + 4) + ' ' + (cy - 8) + 'q6 8 0 16"/><path d="M' + (cx + r + 10) + ' ' + (cy - 13) + 'q9 13 0 26"/>' +
           '<path d="M' + (cx - r - 4) + ' ' + (cy - 8) + 'q-6 8 0 16"/><path d="M' + (cx - r - 10) + ' ' + (cy - 13) + 'q-9 13 0 26"/></g>';
      return s;
    };
  }
  function soundLive(g, st) { if (g.waves) g.waves.setAttribute("opacity", st.sound ? (0.5 + 0.5 * Math.abs(Math.sin(Date.now() / 90))).toFixed(2) : 0); }

  add("buzzer", {
    name: "Buzzer (active)", cat: "Lights & sound",
    blurb: "Beeps by itself whenever it gets power. Long leg (+) to the positive side.",
    pins: [{ n: "+", x: 0, y: 0 }, { n: "-", x: 2 * P, y: 0, label: "−" }],
    box: { x: -0.4 * P, y: -2.8 * P, w: 2.8 * P, h: 3 * P },
    props: {}, art: speaker(""), live: soundLive
  });
  add("piezo", {
    name: "Piezo speaker (passive)", cat: "Lights & sound",
    blurb: "Silent on its own. Use tone() on an Arduino pin to play any note through it.",
    pins: [{ n: "+", x: 0, y: 0 }, { n: "-", x: 2 * P, y: 0, label: "−" }],
    box: { x: -0.4 * P, y: -2.8 * P, w: 2.8 * P, h: 3 * P },
    props: {}, art: speaker("PIEZO"), live: soundLive
  });

  /* =================================================================== MOTION */

  function fanBlades(cx, cy, r, color) {
    var s = "";
    for (var i = 0; i < 3; i++) {
      s += '<path d="M' + cx + ' ' + cy + 'q' + (r * 0.55) + ' ' + (-r * 0.25) + ' ' + (r * 0.95) + ' ' + (r * 0.1) + 'q' + (-r * 0.25) + ' ' + (r * 0.45) + ' ' + (-r * 0.95) + ' ' + (-r * 0.1) + 'z" fill="' + color + '" opacity=".92" transform="rotate(' + (i * 120) + ' ' + cx + ' ' + cy + ')"/>';
    }
    return s + '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.16) + '" fill="#333"/>';
  }
  L.fanBlades = fanBlades;

  add("motor", {
    name: "DC motor", cat: "Motion",
    blurb: "Spins when current flows; reverse the wires and it spins the other way. Too hungry for an Arduino pin on its own.",
    pins: [{ n: "1", x: 0, y: 0 }, { n: "2", x: 2 * P, y: 0 }],
    box: { x: -2.2 * P, y: -7.4 * P, w: 6.4 * P, h: 7.6 * P },
    props: { load: "fan" },
    spec: [{ k: "load", label: "On the shaft", type: "select", options: [["fan", "Fan"], ["wheel", "Wheel"], ["none", "Nothing"]] }],
    art: function (part, pr) {
      var cx = P, s = "";
      s += leadPath("M0 0V" + (-0.6 * P) + "Q0 " + (-1.2 * P) + " " + (0.4 * P) + " " + (-1.5 * P), 2.2);
      s += leadPath("M" + (2 * P) + " 0V" + (-0.6 * P) + "Q" + (2 * P) + " " + (-1.2 * P) + " " + (1.6 * P) + " " + (-1.5 * P), 2.2);
      s += shadow(cx - 1.3 * P, -4.6 * P, 2.6 * P, 3.2 * P, 10);
      s += '<rect x="' + (cx - 1.3 * P) + '" y="' + (-4.6 * P) + '" width="' + (2.6 * P) + '" height="' + (3.2 * P) + '" rx="10" fill="#c5cbd0" stroke="#7f878c" stroke-width="1.5"/>';
      s += '<rect x="' + (cx - 1.3 * P) + '" y="' + (-1.9 * P) + '" width="' + (2.6 * P) + '" height="' + (0.55 * P) + '" rx="3" fill="#2f2f33"/>';
      s += '<rect x="' + (cx - 0.9 * P) + '" y="' + (-4.4 * P) + '" width="6" height="' + (2.4 * P) + '" rx="3" fill="#fff" opacity=".35"/>';
      s += '<rect x="' + (cx - 3) + '" y="' + (-5.4 * P) + '" width="6" height="' + (0.9 * P) + '" fill="#dfe4e8" stroke="#8a9196"/>';
      if (pr.load === "fan") s += '<g data-live="rot">' + fanBlades(cx, -5.4 * P, 2 * P, "#3d8fd6") + '</g>';
      else if (pr.load === "wheel") {
        s += '<g data-live="rot"><circle cx="' + cx + '" cy="' + (-5.4 * P) + '" r="' + (1.6 * P) + '" fill="#222" stroke="#000"/>' +
             '<circle cx="' + cx + '" cy="' + (-5.4 * P) + '" r="' + (0.9 * P) + '" fill="#f2c230"/>' +
             '<path d="M' + cx + ' ' + (-6.3 * P) + 'V' + (-4.5 * P) + 'M' + (cx - 0.9 * P) + ' ' + (-5.4 * P) + 'H' + (cx + 0.9 * P) + '" stroke="#a7841a" stroke-width="3"/></g>';
      } else s += '<g data-live="rot"><rect x="' + (cx - 2) + '" y="' + (-6 * P) + '" width="4" height="' + (0.8 * P) + '" fill="#888"/></g>';
      return s;
    },
    live: function (g, st) {
      if (!g.rot) return;
      g.rot.setAttribute("transform", "rotate(" + ((st.ang || 0) % 360).toFixed(1) + " " + P + " " + (-5.4 * P) + ")");
      g.rot.style.opacity = Math.abs(st.w || 0) > 30 ? "0.75" : "1";
    }
  });

  add("servo", {
    name: "Servo motor (SG90)", cat: "Motion",
    blurb: "Turns its arm to an exact angle from 0° to 180°. Brown is ground, red is 5 V, orange is the signal.",
    pins: [{ n: "GND", x: 0, y: 0, label: "ground (brown)" }, { n: "V+", x: P, y: 0, label: "5 V (red)" }, { n: "SIG", x: 2 * P, y: 0, label: "signal (orange)" }],
    box: { x: -2 * P, y: -8.4 * P, w: 6 * P, h: 8.6 * P },
    props: {},
    art: function () {
      var cx = P, s = "";
      s += '<path d="M0 0C0 ' + (-1.5 * P) + ' ' + (cx - 6) + ' ' + (-1.4 * P) + ' ' + (cx - 6) + ' ' + (-2.6 * P) + '" stroke="#6b3d1e" stroke-width="3.4" fill="none"/>';
      s += '<path d="M' + P + ' 0C' + P + ' ' + (-1.5 * P) + ' ' + cx + ' ' + (-1.4 * P) + ' ' + cx + ' ' + (-2.6 * P) + '" stroke="#d23a2a" stroke-width="3.4" fill="none"/>';
      s += '<path d="M' + (2 * P) + ' 0C' + (2 * P) + ' ' + (-1.5 * P) + ' ' + (cx + 6) + ' ' + (-1.4 * P) + ' ' + (cx + 6) + ' ' + (-2.6 * P) + '" stroke="#ef8a1f" stroke-width="3.4" fill="none"/>';
      s += '<rect x="' + (-0.5 * P) + '" y="' + (-0.5 * P) + '" width="' + (3 * P) + '" height="' + P + '" rx="2" fill="#111"/>';
      s += shadow(cx - 1.3 * P, -7.4 * P, 2.6 * P, 4.8 * P, 4);
      s += '<rect x="' + (cx - 1.3 * P) + '" y="' + (-7.4 * P) + '" width="' + (2.6 * P) + '" height="' + (4.8 * P) + '" rx="4" fill="#2d63c8" stroke="#1d438c"/>';
      s += '<rect x="' + (cx - 2 * P) + '" y="' + (-5.9 * P) + '" width="' + (4 * P) + '" height="' + (0.7 * P) + '" rx="2" fill="#2d63c8" stroke="#1d438c"/>';
      s += text(cx, -3.7 * P, "SG90", 9, "#d9e5ff", { weight: 800 });
      s += '<circle cx="' + cx + '" cy="' + (-6.6 * P) + '" r="' + (0.55 * P) + '" fill="#f5f5f5" stroke="#bbb"/>';
      s += '<g data-live="arm"><path d="M' + (cx - 5) + ' ' + (-6.6 * P) + 'L' + (cx - 3) + ' ' + (-9.2 * P) + 'h6L' + (cx + 5) + ' ' + (-6.6 * P) + 'z" fill="#f5f5f5" stroke="#aaa"/>' +
           '<circle cx="' + cx + '" cy="' + (-6.6 * P) + '" r="4" fill="#ccc"/></g>';
      return s;
    },
    live: function (g, st) {
      if (!g.arm) return;
      var a = (st.ang == null ? 90 : st.ang) - 90;
      g.arm.setAttribute("transform", "rotate(" + a.toFixed(1) + " " + P + " " + (-6.6 * P) + ")");
    }
  });

  /* ============================================================ RELAYS */

  add("relay_module", {
    name: "Relay module (5 V)", cat: "Motion",
    blurb: "Lets an Arduino switch a separate, bigger circuit. IN high clicks the relay: COM joins NO instead of NC.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: 0, y: P }, { n: "IN", x: 0, y: 2 * P },
           { n: "NO", x: 8 * P, y: 0, label: "normally open" }, { n: "COM", x: 8 * P, y: P, label: "common" }, { n: "NC", x: 8 * P, y: 2 * P, label: "normally closed" }],
    box: { x: -0.6 * P, y: -1.6 * P, w: 9.6 * P, h: 5.2 * P },
    props: {},
    art: function () {
      var s = shadow(-0.6 * P, -1.6 * P, 9.6 * P, 5.2 * P, 4);
      s += '<rect x="' + (-0.6 * P) + '" y="' + (-1.6 * P) + '" width="' + (9.6 * P) + '" height="' + (5.2 * P) + '" rx="4" fill="#1b4fa0" stroke="#123673"/>';
      [0, 1, 2].forEach(function (i) { s += S.hdr(0, i * P); });
      s += text(0.9 * P, 0, "VCC", 7.5, "#dfe9ff", { anchor: "start", weight: 700 }) + text(0.9 * P, P, "GND", 7.5, "#dfe9ff", { anchor: "start", weight: 700 }) + text(0.9 * P, 2 * P, "IN", 7.5, "#dfe9ff", { anchor: "start", weight: 700 });
      s += '<rect x="' + (2.8 * P) + '" y="' + (-1.2 * P) + '" width="' + (3.8 * P) + '" height="' + (4.4 * P) + '" rx="3" fill="#2a6fe0" stroke="#174ba8"/>';
      s += text(4.7 * P, 0.2 * P, "SRD-05VDC", 7, "#e6efff", { weight: 700 }) + text(4.7 * P, 1.2 * P, "10A 250VAC", 6.5, "#c5d8ff");
      s += '<g data-live="arm"><path d="M' + (3.4 * P) + ' ' + (2.4 * P) + 'h' + (2.6 * P) + '" stroke="#e8eef4" stroke-width="2.5" stroke-linecap="round"/></g>';
      s += '<rect x="' + (7.2 * P) + '" y="' + (-0.6 * P) + '" width="' + (1.6 * P) + '" height="' + (3.2 * P) + '" rx="2" fill="#1f8a4c" stroke="#145c33"/>';
      [0, 1, 2].forEach(function (i) { s += '<circle cx="' + (8 * P) + '" cy="' + (i * P) + '" r="6.5" fill="#cfd5da" stroke="#7d858b"/><path d="M' + (8 * P - 4) + ' ' + (i * P) + 'h8" stroke="#555" stroke-width="1.8"/>'; });
      s += text(6.95 * P, 0, "NO", 7, "#dfe9ff", { anchor: "end", weight: 700 }) + text(6.95 * P, P, "COM", 7, "#dfe9ff", { anchor: "end", weight: 700 }) + text(6.95 * P, 2 * P, "NC", 7, "#dfe9ff", { anchor: "end", weight: 700 });
      s += '<g data-live="led"><circle cx="' + (1.6 * P) + '" cy="' + (2.9 * P) + '" r="4" fill="#5a1a1a"/></g>';
      return s;
    },
    live: function (g, st) {
      if (g.led) L.setFill(g.led, st.on ? "#ff4a3a" : "#5a1a1a");
      if (g.arm) g.arm.setAttribute("transform", st.on ? "rotate(-9 " + (3.4 * P) + " " + (2.4 * P) + ")" : "");
    },
    glow: function (st) { return st.on ? [{ x: 1.6 * P, y: 2.9 * P, r: 12, c: "#ff4a3a", a: 0.8 }] : null; }
  });

  add("relay", {
    name: "Relay (5 V coil)", cat: "Motion",
    blurb: "A bare relay. Drive its coil through a transistor and put a diode across the coil to catch the kick.",
    pins: [{ n: "C1", x: 0, y: 0, label: "coil" }, { n: "NC", x: 2 * P, y: 0, label: "normally closed" }, { n: "NO", x: 4 * P, y: 0, label: "normally open" },
           { n: "C2", x: 0, y: 3 * P, label: "coil" }, { n: "COM", x: 4 * P, y: 3 * P, label: "common" }],
    box: { x: -0.6 * P, y: -0.6 * P, w: 5.2 * P, h: 4.2 * P },
    props: {},
    art: function () {
      var s = shadow(-0.6 * P, -0.5 * P, 5.2 * P, 4 * P, 3);
      s += '<rect x="' + (-0.6 * P) + '" y="' + (-0.5 * P) + '" width="' + (5.2 * P) + '" height="' + (4 * P) + '" rx="3" fill="#2b2b2e" stroke="#111"/>';
      s += text(2 * P, 0.9 * P, "5VDC", 9, "#cfd5da", { weight: 700 });
      s += '<g data-live="arm"><path d="M' + (0.4 * P) + ' ' + (2.3 * P) + 'h' + (3.2 * P) + '" stroke="#cfd5da" stroke-width="2.5" stroke-linecap="round"/></g>';
      return s;
    },
    live: function (g, st) { if (g.arm) g.arm.setAttribute("transform", st.on ? "rotate(-8 " + (0.4 * P) + " " + (2.3 * P) + ")" : ""); }
  });

  /* ================================================================= DISPLAY */

  var SEG = {
    A: "M12 6h22l-4 5h-14z", B: "M36 8l-3 22l-5 -4l3 -14z", C: "M32 34l-3 22l-4 -4l2 -15z",
    D: "M8 58h22l-4 -5h-14z", E: "M6 34l-3 22l5 -4l2 -15z", F: "M10 8l-3 22l5 -4l2 -14z", G: "M9 32l4 -4h18l4 4l-4 4h-18z"
  };
  add("seg7", {
    name: "7-segment display", cat: "Lights & sound",
    blurb: "Seven LED bars that draw any digit. Common cathode: the two middle COM legs go to ground.",
    pins: [{ n: "G", x: 0, y: 0 }, { n: "F", x: P, y: 0 }, { n: "COM1", x: 2 * P, y: 0, label: "COM" }, { n: "A", x: 3 * P, y: 0 }, { n: "B", x: 4 * P, y: 0 },
           { n: "E", x: 0, y: 6 * P }, { n: "D", x: P, y: 6 * P }, { n: "COM2", x: 2 * P, y: 6 * P, label: "COM" }, { n: "C", x: 3 * P, y: 6 * P }, { n: "DP", x: 4 * P, y: 6 * P }],
    buses: [["COM1", "COM2"]],
    box: { x: -0.6 * P, y: -0.4 * P, w: 5.2 * P, h: 6.8 * P },
    props: { color: "red", common: "cathode" },
    spec: [{ k: "common", label: "Common pin", type: "select", options: [["cathode", "Cathode (to GND)"], ["anode", "Anode (to 5 V)"]] }],
    art: function () {
      var s = shadow(-0.6 * P, 0.4 * P, 5.2 * P, 5.2 * P, 3);
      s += '<rect x="' + (-0.6 * P) + '" y="' + (0.4 * P) + '" width="' + (5.2 * P) + '" height="' + (5.2 * P) + '" rx="3" fill="#1a1a1c"/>';
      s += '<g transform="translate(' + (0.6 * P) + ' ' + (0.8 * P) + ') scale(1.1)">';
      ["A", "B", "C", "D", "E", "F", "G"].forEach(function (k) { s += '<path data-live="s' + k + '" d="' + SEG[k] + '" fill="#3a1512"/>'; });
      s += '<circle data-live="sDP" cx="40" cy="57" r="3.2" fill="#3a1512"/></g>';
      return s;
    },
    live: function (g, st) {
      ["A", "B", "C", "D", "E", "F", "G", "DP"].forEach(function (k) {
        var el = g["s" + k]; if (!el) return;
        var on = st.seg && st.seg[k] > 0.05;
        var c = on ? "rgb(255," + Math.round(40 + 60 * st.seg[k]) + ",40)" : "#3a1512";
        if (el.getAttribute("fill") !== c) el.setAttribute("fill", c);
      });
    },
    glow: function (st) {
      if (!st.seg) return null;
      var n = 0; for (var k in st.seg) if (st.seg[k] > 0.05) n++;
      return n ? [{ x: 2 * P, y: 3 * P, r: 30 + n * 4, c: "#ff3a2a", a: 0.45 }] : null;
    }
  });

  add("lcd_i2c", {
    name: "LCD 16×2 (I²C)", cat: "Lights & sound",
    blurb: "Two lines of sixteen characters. Wire SDA to A4 and SCL to A5, then use lcd.print().",
    pins: [{ n: "GND", x: 0, y: 0 }, { n: "VCC", x: 0, y: P }, { n: "SDA", x: 0, y: 2 * P }, { n: "SCL", x: 0, y: 3 * P }],
    box: { x: -0.6 * P, y: -1.8 * P, w: 19.4 * P, h: 6.6 * P },
    props: {},
    art: function () {
      var x = 0.8 * P, y = -1.8 * P, s = shadow(-0.6 * P, y, 19.4 * P, 6.6 * P, 5);
      s += '<rect x="' + (-0.6 * P) + '" y="' + y + '" width="' + (19.4 * P) + '" height="' + (6.6 * P) + '" rx="5" fill="#1f7a3e" stroke="#145a2c"/>';
      [0, 1, 2, 3].forEach(function (i) { s += S.hdr(0, i * P); });
      s += '<rect x="' + (x + 0.4 * P) + '" y="' + (y + 0.5 * P) + '" width="' + (17.4 * P) + '" height="' + (5.6 * P) + '" rx="3" fill="#111"/>';
      s += '<rect data-live="panel" x="' + (x + 0.9 * P) + '" y="' + (y + 1.1 * P) + '" width="' + (16.4 * P) + '" height="' + (4.4 * P) + '" rx="2" fill="#2d4a1a"/>';
      s += '<g data-live="txt" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace" font-size="17" font-weight="700" fill="#0d1a06">' +
           '<text x="' + (x + 1.3 * P) + '" y="' + (y + 2.75 * P) + '" xml:space="preserve"></text>' +
           '<text x="' + (x + 1.3 * P) + '" y="' + (y + 4.55 * P) + '" xml:space="preserve"></text></g>';
      return s;
    },
    live: function (g, st) {
      if (g.panel) {
        var c = st.on ? "#8fd14f" : "#2d4a1a";
        if (g.panel.getAttribute("fill") !== c) g.panel.setAttribute("fill", c);
      }
      if (g.txt) {
        var t = g.txt.querySelectorAll("text"), rows = st.rows || ["", ""];
        for (var i = 0; i < 2; i++) if (t[i].textContent !== (rows[i] || "")) t[i].textContent = rows[i] || "";
      }
    }
  });

  /* ================================================================= SENSORS */

  add("tmp36", {
    name: "Temperature sensor (TMP36)", cat: "Sensors",
    blurb: "Gives 0.5 V at 0 °C and 10 mV more for every degree. Flat side facing you: +V, out, ground.",
    pins: [{ n: "+V", x: 0, y: 0 }, { n: "OUT", x: P, y: 0 }, { n: "GND", x: 2 * P, y: 0 }],
    box: { x: -0.3 * P, y: -2.2 * P, w: 2.6 * P, h: 3.2 * P },
    props: { temp: 22 },
    spec: [{ k: "temp", label: "Temperature", type: "range", min: -40, max: 125, step: 1, unit: "°C", live: true }],
    env: "temp",
    art: to92("TMP36", ["+V", "OUT", "GND"])
  });

  add("hcsr04", {
    name: "Ultrasonic distance (HC-SR04)", cat: "Sensors",
    blurb: "Pings sound and times the echo. Pulse TRIG, then pulseIn() on ECHO: microseconds ÷ 58 is centimetres.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "TRIG", x: P, y: 0 }, { n: "ECHO", x: 2 * P, y: 0 }, { n: "GND", x: 3 * P, y: 0 }],
    box: { x: -3.4 * P, y: -5.2 * P, w: 9.8 * P, h: 5.4 * P },
    props: { cm: 40 },
    spec: [{ k: "cm", label: "Object distance", type: "range", min: 2, max: 400, step: 1, unit: "cm", live: true }],
    art: function () {
      var x = -3.4 * P, y = -4.6 * P, w = 9.8 * P, h = 4.2 * P;
      var s = "";
      [0, 1, 2, 3].forEach(function (i) { s += lead(i * P, 0, i * P, -0.5 * P); });
      s += shadow(x, y, w, h, 4) + '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="#1d4f9e" stroke="#133670"/>';
      [x + 2.1 * P, x + w - 2.1 * P].forEach(function (cx) {
        s += '<circle cx="' + cx + '" cy="' + (y + 2 * P) + '" r="' + (1.8 * P) + '" fill="#cfd5da" stroke="#8a9196" stroke-width="2"/>';
        s += '<circle cx="' + cx + '" cy="' + (y + 2 * P) + '" r="' + (1.3 * P) + '" fill="#2b2b2b"/>';
        s += '<circle cx="' + cx + '" cy="' + (y + 2 * P) + '" r="' + (1.1 * P) + '" fill="url(#lab-mesh)"/>';
      });
      s += '<rect x="' + (x + w / 2 - 0.9 * P) + '" y="' + (y + 0.5 * P) + '" width="' + (1.8 * P) + '" height="' + (0.9 * P) + '" rx="3" fill="#cfd5da"/>';
      s += text(x + w / 2, y + 2.4 * P, "HC-SR04", 8, "#dfe9ff", { weight: 700 });
      s += text(0, -0.9 * P, "VCC", 6.5, "#dfe9ff", { rot: -90 }) + text(P, -0.9 * P, "TRIG", 6.5, "#dfe9ff", { rot: -90 }) + text(2 * P, -0.9 * P, "ECHO", 6.5, "#dfe9ff", { rot: -90 }) + text(3 * P, -0.9 * P, "GND", 6.5, "#dfe9ff", { rot: -90 });
      s += '<g data-live="ping" opacity="0" stroke="#7fe0ff" stroke-width="2" fill="none"><path d="M' + (x + 1 * P) + ' ' + (y - 6) + 'q' + (1.1 * P) + ' -10 ' + (2.2 * P) + ' 0"/><path d="M' + (x + 0.4 * P) + ' ' + (y - 14) + 'q' + (1.7 * P) + ' -14 ' + (3.4 * P) + ' 0"/></g>';
      return s;
    },
    live: function (g, st) { if (g.ping) g.ping.setAttribute("opacity", st.ping ? 0.9 : 0); }
  });

  add("pir", {
    name: "Motion sensor (PIR)", cat: "Sensors",
    blurb: "Sees warm bodies moving. OUT goes high for a few seconds when something moves in front of it.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "OUT", x: P, y: 0 }, { n: "GND", x: 2 * P, y: 0 }],
    box: { x: -1.6 * P, y: -5.8 * P, w: 5.2 * P, h: 6 * P },
    props: { motion: false },
    toggle: "motion",
    spec: [{ k: "motion", label: "Something is moving", type: "bool", live: true }],
    art: function () {
      var cx = P, cy = -3.2 * P, s = "";
      [0, 1, 2].forEach(function (i) { s += lead(i * P, 0, i * P, -0.5 * P); });
      s += shadow(cx - 2.6 * P, cy - 2.6 * P, 5.2 * P, 5.2 * P, 4);
      s += '<rect x="' + (cx - 2.6 * P) + '" y="' + (cy - 2.6 * P) + '" width="' + (5.2 * P) + '" height="' + (5.2 * P) + '" rx="4" fill="#1f7a3e" stroke="#145a2c"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (2.1 * P) + '" fill="#f4f4f0" stroke="#cfcfc8" stroke-width="2"/>';
      for (var i = 0; i < 4; i++) s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + ((0.5 + i * 0.45) * P) + '" fill="none" stroke="#dcdcd4" stroke-width="1.2"/>';
      s += '<ellipse cx="' + (cx - 10) + '" cy="' + (cy - 12) + '" rx="8" ry="12" fill="#fff" opacity=".6" transform="rotate(-30 ' + (cx - 10) + ' ' + (cy - 12) + ')"/>';
      s += '<g data-live="hand" opacity="0"><text x="' + (cx + 2.4 * P) + '" y="' + (cy - 1.6 * P) + '" font-size="26">👋</text></g>';
      return s;
    },
    live: function (g, st, pr) { if (g.hand) g.hand.setAttribute("opacity", pr.motion ? 1 : 0); }
  });

  /* The cheap little sensor modules that come in every kit. They all look
   * alike and all speak the same four pins; only the bit on top differs. */
  function moduleArt(kind) {
    return function () {
      var x = -0.6 * P, y = -4 * P, w = 4.2 * P, h = 3.6 * P, s = "";
      [0, 1, 2, 3].forEach(function (i) { s += lead(i * P, 0, i * P, -0.5 * P); });
      s += shadow(x, y, w, h, 3) + '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="#1b4fa0" stroke="#123673"/>';
      s += '<rect x="' + (x + 0.4 * P) + '" y="' + (y + 0.4 * P) + '" width="' + (1.2 * P) + '" height="' + (1.2 * P) + '" fill="#2a6fe0" stroke="#174ba8"/><circle cx="' + (x + P) + '" cy="' + (y + P) + '" r="5" fill="#ddd"/><path d="M' + (x + P) + ' ' + (y + P) + 'l3 -3" stroke="#333" stroke-width="1.5"/>';
      s += text(0, -0.9 * P, "VCC", 6, "#dfe9ff", { rot: -90 }) + text(P, -0.9 * P, "GND", 6, "#dfe9ff", { rot: -90 }) + text(2 * P, -0.9 * P, "DO", 6, "#dfe9ff", { rot: -90 }) + text(3 * P, -0.9 * P, "AO", 6, "#dfe9ff", { rot: -90 });
      s += '<g data-live="led"><circle cx="' + (x + 3.6 * P) + '" cy="' + (y + 0.6 * P) + '" r="3.5" fill="#5a1a1a"/></g>';
      var tx = x + 2.6 * P, ty = y;
      if (kind === "soil") s += '<path d="M' + (tx - 12) + ' ' + ty + 'v-' + (3.4 * P) + 'q0 -6 5 -6t5 6v' + (3.4 * P) + 'M' + (tx + 4) + ' ' + ty + 'v-' + (3.4 * P) + 'q0 -6 5 -6t5 6v' + (3.4 * P) + '" stroke="#c9a64a" stroke-width="5" fill="none"/>';
      else if (kind === "gas") s += '<circle cx="' + tx + '" cy="' + (ty - 1.1 * P) + '" r="' + (1.2 * P) + '" fill="#c6ccd1" stroke="#7d858b" stroke-width="2"/><circle cx="' + tx + '" cy="' + (ty - 1.1 * P) + '" r="' + (0.9 * P) + '" fill="url(#lab-mesh)"/>';
      else if (kind === "sound") s += '<circle cx="' + tx + '" cy="' + (ty - 0.8 * P) + '" r="' + (0.9 * P) + '" fill="#2b2b2b" stroke="#000"/><circle cx="' + tx + '" cy="' + (ty - 0.8 * P) + '" r="' + (0.6 * P) + '" fill="url(#lab-mesh)"/>';
      else if (kind === "flame") s += leadPath("M" + tx + " " + ty + "v-" + (0.8 * P)) + '<circle cx="' + tx + '" cy="' + (ty - 1.2 * P) + '" r="' + (0.55 * P) + '" fill="#141414"/><ellipse cx="' + (tx - 3) + '" cy="' + (ty - 1.4 * P) + '" rx="2" ry="4" fill="#fff" opacity=".4"/>';
      else if (kind === "ir") s += leadPath("M" + (tx - 6) + " " + ty + "v-" + (0.8 * P)) + leadPath("M" + (tx + 8) + " " + ty + "v-" + (0.8 * P)) +
        '<circle cx="' + (tx - 6) + '" cy="' + (ty - 1.2 * P) + '" r="6" fill="#ddd" opacity=".9"/><circle cx="' + (tx + 8) + '" cy="' + (ty - 1.2 * P) + '" r="6" fill="#141414"/>';
      return s;
    };
  }
  function moduleLive(g, st) { if (g.led) L.setFill(g.led, st.d ? "#ff4a3a" : "#5a1a1a"); }
  var MODULES = {
    soil:  { name: "Soil moisture sensor", label: "Wetness", blurb: "Two prongs in the soil. Wet soil conducts, so AO drops as the soil gets wetter." },
    gas:   { name: "Gas sensor (MQ-2)", label: "Gas / smoke", blurb: "Smells smoke and gas. AO rises as the air gets dirtier; DO goes low past the threshold." },
    sound: { name: "Sound sensor", label: "Loudness", blurb: "A microphone with an amplifier. AO follows how loud the room is; DO trips on a clap." },
    flame: { name: "Flame sensor", label: "Flame", blurb: "Sees the infrared light from a flame. DO goes low when it spots one." },
    ir:    { name: "IR obstacle sensor", label: "Obstacle", blurb: "Bounces infrared light off things. DO goes low when something is close in front." }
  };
  Object.keys(MODULES).forEach(function (k) {
    var m = MODULES[k];
    add("mod_" + k, {
      name: m.name, cat: "Sensors", blurb: m.blurb, module: k,
      pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: P, y: 0 }, { n: "DO", x: 2 * P, y: 0, label: "digital out" }, { n: "AO", x: 3 * P, y: 0, label: "analog out" }],
      box: { x: -0.6 * P, y: -7.6 * P, w: 4.2 * P, h: 7.8 * P },
      props: { level: 30, threshold: 60 },
      spec: [
        { k: "level", label: m.label, type: "range", min: 0, max: 100, step: 1, unit: "%", live: true },
        { k: "threshold", label: "DO trips at", type: "range", min: 0, max: 100, step: 1, unit: "%", live: true }
      ],
      art: moduleArt(k), live: moduleLive,
      glow: function (st) { return st.d ? [{ x: 3 * P, y: -3.4 * P, r: 10, c: "#ff4a3a", a: 0.7 }] : null; }
    });
  });

  /* ============================================================= INSTRUMENTS */

  add("multimeter", {
    name: "Multimeter", cat: "Measure",
    blurb: "Run a red and a black wire from its jacks to your circuit. Volts go across a part; amps go in line with it.",
    pins: [{ n: "COM", x: 0, y: 0, label: "COM (black)" }, { n: "V", x: 3 * P, y: 0, label: "V Ω mA (red)" }],
    box: { x: -2.5 * P, y: -11.6 * P, w: 8 * P, h: 12.4 * P },
    props: { mode: "V" },
    spec: [{ k: "mode", label: "Measure", type: "select", options: [["V", "Volts (DC)"], ["A", "Current (DC)"], ["R", "Resistance (Ω)"]], rebuild: true }],
    cycle: { k: "mode", values: ["V", "A", "R"] },
    art: function (part, pr) {
      var x = -2.5 * P, y = -11.6 * P, w = 8 * P, h = 12.2 * P, s = shadow(x, y, w, h, 12);
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="12" fill="#f2c230" stroke="#a7841a" stroke-width="2"/>';
      s += '<rect x="' + (x + 0.5 * P) + '" y="' + (y + 0.5 * P) + '" width="' + (w - P) + '" height="' + (h - P) + '" rx="8" fill="#2b2d30"/>';
      s += '<rect x="' + (x + 1 * P) + '" y="' + (y + 1 * P) + '" width="' + (w - 2 * P) + '" height="' + (3 * P) + '" rx="4" fill="#a9b89a" stroke="#6f7c63" stroke-width="2"/>';
      s += '<g data-live="read">' + text(x + w / 2, y + 2.6 * P, "0.00", 28, "#1d2418", { weight: 700 }) + '</g>';
      s += '<g data-live="unit">' + text(x + w - 1.4 * P, y + 3.5 * P, "V", 11, "#1d2418", { weight: 700, anchor: "end" }) + '</g>';
      var cx = x + w / 2, cy = y + 7.3 * P;
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (2 * P) + '" fill="#1a1a1c" stroke="#000"/>';
      s += text(cx - 2.6 * P, cy - 1.4 * P, "V⎓", 11, "#f2c230", { weight: 700 }) + text(cx + 2.6 * P, cy - 1.4 * P, "A⎓", 11, "#f2c230", { weight: 700 }) + text(cx, cy - 2.5 * P, "Ω", 11, "#f2c230", { weight: 700 });
      s += '<g data-live="dial"><path d="M' + cx + ' ' + cy + 'L' + cx + ' ' + (cy - 1.7 * P) + '" stroke="#f2f2f2" stroke-width="5" stroke-linecap="round"/></g>';
      s += '<circle cx="0" cy="0" r="9" fill="#111" stroke="#555" stroke-width="2"/><circle cx="0" cy="0" r="4" fill="#333"/>';
      s += '<circle cx="' + (3 * P) + '" cy="0" r="9" fill="#a31b1b" stroke="#e33" stroke-width="2"/><circle cx="' + (3 * P) + '" cy="0" r="4" fill="#5a0d0d"/>';
      s += text(0, -0.95 * P, "COM", 7, "#bbb", { weight: 700 }) + text(3 * P, -0.95 * P, "VΩmA", 7, "#f88", { weight: 700 });
      return s;
    },
    live: function (g, st, pr) {
      if (g.read) { var t = g.read.firstChild; if (t.textContent !== st.text) t.textContent = st.text || "0.00"; }
      if (g.unit) { var u = g.unit.firstChild; var unit = st.unit || "V"; if (u.textContent !== unit) u.textContent = unit; }
      if (g.dial) {
        var a = pr.mode === "A" ? 55 : pr.mode === "R" ? 0 : -55;
        g.dial.setAttribute("transform", "rotate(" + a + " " + (1.5 * P) + " " + (-4.3 * P) + ")");
      }
    }
  });

  add("scope", {
    name: "Oscilloscope", cat: "Measure",
    blurb: "Draws voltage against time. Clip CH1 and CH2 to points in your circuit and GND to ground.",
    pins: [{ n: "CH1", x: 0, y: 0, label: "channel 1 (yellow)" }, { n: "CH2", x: 2 * P, y: 0, label: "channel 2 (cyan)" }, { n: "GND", x: 4 * P, y: 0, label: "ground" }],
    box: { x: -3 * P, y: -9.6 * P, w: 10 * P, h: 10.4 * P },
    props: {},
    art: function () {
      var x = -3 * P, y = -9.6 * P, w = 10 * P, h = 9 * P, s = shadow(x, y, w, h, 6);
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="6" fill="#3a3f44" stroke="#1f2225" stroke-width="2"/>';
      s += '<rect x="' + (x + 0.5 * P) + '" y="' + (y + 0.5 * P) + '" width="' + (w - P) + '" height="' + (5.6 * P) + '" rx="3" fill="#06110c" stroke="#111"/>';
      var gx = x + 0.5 * P, gy = y + 0.5 * P, gw = w - P, gh = 5.6 * P, d = "";
      for (var i = 1; i < 8; i++) d += "M" + (gx + gw * i / 8) + " " + gy + "v" + gh;
      for (i = 1; i < 6; i++) d += "M" + gx + " " + (gy + gh * i / 6) + "h" + gw;
      s += '<path d="' + d + '" stroke="#1f3b2c" stroke-width="1"/>';
      s += '<path data-live="t1" d="" stroke="#ffe14a" stroke-width="2" fill="none"/><path data-live="t2" d="" stroke="#4adfff" stroke-width="2" fill="none"/>';
      [[0, "#ffe14a"], [2 * P, "#4adfff"], [4 * P, "#222"]].forEach(function (q) {
        s += '<circle cx="' + q[0] + '" cy="0" r="8.5" fill="#cfd5da" stroke="#7d858b" stroke-width="2"/><circle cx="' + q[0] + '" cy="0" r="4" fill="' + q[1] + '"/>';
      });
      s += text(0, -0.95 * P, "CH1", 7, "#ffe14a", { weight: 700 }) + text(2 * P, -0.95 * P, "CH2", 7, "#4adfff", { weight: 700 }) + text(4 * P, -0.95 * P, "GND", 7, "#bbb", { weight: 700 });
      return s;
    },
    live: function (g, st) {
      if (!g.t1 || !st.trace) return;
      var x = -2.5 * P, y = -9.1 * P, w = 9 * P, h = 5.6 * P;
      ["t1", "t2"].forEach(function (k, ch) {
        var arr = st.trace[ch], d = "";
        if (!arr || arr.length < 2) { g[k].setAttribute("d", ""); return; }
        var top = st.vmax || 5;
        for (var i = 0; i < arr.length; i++) {
          var px = x + w * i / (arr.length - 1), py = y + h - h * L.clamp(arr[i] / top, -0.05, 1.05) * 0.9 - h * 0.05;
          d += (i ? "L" : "M") + px.toFixed(1) + " " + py.toFixed(1);
        }
        g[k].setAttribute("d", d);
      });
    }
  });
})(typeof window !== "undefined" ? window : globalThis);
