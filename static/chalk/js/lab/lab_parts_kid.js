/* Chalk Circuit Lab — the toy box.
 *
 * Kid mode is the same physics with friendlier things to hold: every part
 * sits on a wooden block with two big brass posts, the way a school science
 * kit does, and wires are crocodile clips. Posts are four tenths apart so a
 * small finger on a tablet can still hit the right one.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var P = L.P, add = L.addPart, S = L.svg, text = S.text, post = S.post, base = S.base;
  var K = 5 * P;   /* post spacing */

  function two(n1, n2) { return [{ n: n1 || "a", x: 0, y: 0 }, { n: n2 || "b", x: K, y: 0 }]; }
  var BOX = { x: -1.2 * P, y: -5.6 * P, w: K + 2.4 * P, h: 6.8 * P };

  function face(cx, cy, mood) {
    /* Little faces on the parts. They are happy when they are working. */
    var m = mood === "happy" ? '<path d="M' + (cx - 6) + ' ' + (cy + 3) + 'q6 6 12 0" stroke="#3a2a1a" stroke-width="2.2" fill="none" stroke-linecap="round"/>'
          : mood === "ouch" ? '<ellipse cx="' + cx + '" cy="' + (cy + 5) + '" rx="4" ry="5" fill="#3a2a1a"/>'
          : '<path d="M' + (cx - 5) + ' ' + (cy + 4) + 'h10" stroke="#3a2a1a" stroke-width="2.2" stroke-linecap="round"/>';
    return '<circle cx="' + (cx - 6) + '" cy="' + (cy - 3) + '" r="2.6" fill="#3a2a1a"/><circle cx="' + (cx + 6) + '" cy="' + (cy - 3) + '" r="2.6" fill="#3a2a1a"/>' + m;
  }

  add("k_battery", {
    name: "Battery", cat: "Toy box", kid: true,
    blurb: "The battery pushes electricity out of + and pulls it back in at −. It needs a full loop to work.",
    pins: two("+", "-"),
    box: { x: -1.2 * P, y: -4.6 * P, w: K + 2.4 * P, h: 5.8 * P },
    props: { volts: 3 },
    spec: [{ k: "volts", label: "How strong", type: "select", options: [[1.5, "1.5 V — one cell"], [3, "3 V — two cells"], [4.5, "4.5 V — three cells"], [9, "9 V — a big one"]], live: true }],
    art: function (part, pr) {
      var s = base(-1.2 * P, -1.2 * P, K + 2.4 * P, 2.4 * P);
      var x = 0.4 * P, y = -4.4 * P, w = K - 0.8 * P, h = 3 * P;
      s += '<rect x="' + (x + 3) + '" y="' + (y + 4) + '" width="' + w + '" height="' + h + '" rx="14" fill="#000" opacity=".25"/>';
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="14" fill="#2b2b2e"/>';
      s += '<rect x="' + x + '" y="' + y + '" width="' + (w * 0.62) + '" height="' + h + '" rx="14" fill="#e8a317"/>';
      s += '<rect x="' + (x + w * 0.5) + '" y="' + y + '" width="' + (w * 0.12) + '" height="' + h + '" fill="#e8a317"/>';
      s += '<rect x="' + (x - 7) + '" y="' + (y + h / 2 - 9) + '" width="9" height="18" rx="3" fill="#c7cdd2" stroke="#8a9196"/>';
      s += '<rect x="' + (x + 8) + '" y="' + (y + 5) + '" width="' + (w - 16) + '" height="6" rx="3" fill="#fff" opacity=".3"/>';
      s += text(x + w * 0.3, y + h / 2 + 1, pr.volts + " V", 18, "#3a2405", { weight: 800 });
      s += text(x + w * 0.82, y + h / 2 + 1, "−", 22, "#e9e9e9", { weight: 800 });
      s += text(x + 8, y - 8, "+", 18, "#d23a2a", { weight: 800 });
      s += post(0, 0, "#d84a3a") + post(K, 0, "#3a3a3e");
      return s;
    },
    live: L.heatLive
  });

  add("k_bulb", {
    name: "Light bulb", cat: "Toy box", kid: true,
    blurb: "When electricity flows through the thin wire inside, it gets so hot that it glows.",
    pins: two(),
    box: BOX,
    props: { volts: 3, watts: 0.9 },
    art: function () {
      var cx = K / 2, cy = -3.6 * P;
      var s = base(-1.2 * P, -1.2 * P, K + 2.4 * P, 2.4 * P);
      s += '<rect x="' + (cx - 1.1 * P) + '" y="' + (cy + 1.2 * P) + '" width="' + (2.2 * P) + '" height="' + (1.5 * P) + '" rx="3" fill="#c7cdd2" stroke="#8a9196" stroke-width="1.5"/>';
      s += '<path d="M' + (cx - 1.1 * P) + ' ' + (cy + 1.7 * P) + 'h' + (2.2 * P) + 'M' + (cx - 1.1 * P) + ' ' + (cy + 2.2 * P) + 'h' + (2.2 * P) + '" stroke="#8a9196" stroke-width="1.5"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (1.9 * P) + '" fill="#eef6fb" opacity=".6" stroke="#bfd0db" stroke-width="2"/>';
      s += '<circle data-live="core" cx="' + cx + '" cy="' + cy + '" r="' + (1.85 * P) + '" fill="#ffe27a" opacity="0"/>';
      s += '<path data-live="fil" d="M' + (cx - 8) + ' ' + (cy + 1.3 * P) + 'V' + cy + 'q4 -10 8 0q4 10 8 0V' + (cy + 1.3 * P) + '" stroke="#6b5a40" stroke-width="2.4" fill="none"/>';
      s += '<ellipse cx="' + (cx - 14) + '" cy="' + (cy - 12) + '" rx="7" ry="13" fill="#fff" opacity=".6" transform="rotate(-30 ' + (cx - 14) + ' ' + (cy - 12) + ')"/>';
      s += '<g data-live="burnt" opacity="0"><circle cx="' + cx + '" cy="' + cy + '" r="' + (1.9 * P) + '" fill="#555" opacity=".4"/></g>';
      s += post(0, 0) + post(K, 0);
      return s;
    },
    live: function (g, st) { PARTS_BULB_LIVE(g, st); },
    glow: function (st) { return st.b > 0.02 ? [{ x: K / 2, y: -3.6 * P, r: 40 + 110 * Math.min(1, st.b), c: "#ffd36b", a: Math.min(1, 0.25 + st.b) }] : null; }
  });
  function PARTS_BULB_LIVE(g, st) { L.PARTS.bulb.live(g, st); }

  add("k_switch", {
    name: "Knife switch", cat: "Toy box", kid: true,
    blurb: "A gate for electricity. Down: the path is closed and electricity flows. Up: the path is open.",
    pins: two(),
    box: BOX,
    props: { on: false },
    toggle: "on",
    art: function () {
      var s = base(-1.2 * P, -1.2 * P, K + 2.4 * P, 2.4 * P);
      s += '<rect x="' + (K - 0.7 * P) + '" y="' + (-1.6 * P) + '" width="' + (1.4 * P) + '" height="' + (1.2 * P) + '" rx="2" fill="#c9a03c" stroke="#7a5a12"/>';
      s += '<rect x="' + (-0.4 * P) + '" y="' + (-1.6 * P) + '" width="' + (1.2 * P) + '" height="' + (1.2 * P) + '" rx="2" fill="#c9a03c" stroke="#7a5a12"/>';
      s += '<g data-live="blade"><path d="M' + (0.2 * P) + ' ' + (-1.2 * P) + 'L' + (K + 0.4 * P) + ' ' + (-1.2 * P) + '" stroke="#b8bec4" stroke-width="7" stroke-linecap="round"/>' +
           '<path d="M' + (0.2 * P) + ' ' + (-1.2 * P) + 'L' + (K + 0.4 * P) + ' ' + (-1.2 * P) + '" stroke="#eef2f5" stroke-width="2.4" stroke-linecap="round"/>' +
           '<rect x="' + (K + 0.2 * P) + '" y="' + (-2.4 * P) + '" width="' + (0.8 * P) + '" height="' + (1.6 * P) + '" rx="7" fill="#c4302b" transform="rotate(0)"/></g>';
      s += '<circle cx="' + (0.2 * P) + '" cy="' + (-1.2 * P) + '" r="5" fill="#7a5a12"/>';
      s += post(0, 0) + post(K, 0);
      return s;
    },
    live: function (g, st, pr) {
      if (!g.blade) return;
      var t = pr.on ? "" : "rotate(-42 " + (0.2 * P) + " " + (-1.2 * P) + ")";
      if (g.blade.getAttribute("transform") !== t) g.blade.setAttribute("transform", t);
    }
  });

  add("k_button", {
    name: "Press button", cat: "Toy box", kid: true,
    blurb: "Like a doorbell: electricity only flows while you hold it down.",
    pins: two(),
    box: BOX,
    props: {},
    press: true,
    art: function () {
      var cx = K / 2, cy = -2.2 * P;
      var s = base(-1.2 * P, -1.2 * P, K + 2.4 * P, 2.4 * P);
      s += '<rect x="' + (cx - 1.8 * P) + '" y="' + (cy - 0.4 * P) + '" width="' + (3.6 * P) + '" height="' + (1.6 * P) + '" rx="6" fill="#3a3a3e"/>';
      s += '<g data-live="cap"><ellipse cx="' + cx + '" cy="' + (cy + 0.2 * P) + '" rx="' + (1.4 * P) + '" ry="' + (0.6 * P) + '" fill="#8e1d18"/>' +
           '<rect x="' + (cx - 1.4 * P) + '" y="' + (cy - 1 * P) + '" width="' + (2.8 * P) + '" height="' + (1.2 * P) + '" fill="#c4302b"/>' +
           '<ellipse cx="' + cx + '" cy="' + (cy - 1 * P) + '" rx="' + (1.4 * P) + '" ry="' + (0.6 * P) + '" fill="#e5453d"/>' +
           '<ellipse cx="' + (cx - 8) + '" cy="' + (cy - 1.1 * P) + '" rx="9" ry="3.5" fill="#fff" opacity=".35"/></g>';
      s += post(0, 0) + post(K, 0);
      return s;
    },
    live: function (g, st) {
      if (!g.cap) return;
      var t = st.on ? "translate(0 " + (0.6 * P) + ")" : "";
      if (g.cap.getAttribute("transform") !== t) g.cap.setAttribute("transform", t);
    }
  });

  add("k_buzzer", {
    name: "Buzzer", cat: "Toy box", kid: true,
    blurb: "Makes a beep when electricity flows through it. Red post towards the + of the battery.",
    pins: two("+", "-"),
    box: BOX,
    props: {},
    art: function () {
      var cx = K / 2, cy = -2.8 * P;
      var s = base(-1.2 * P, -1.2 * P, K + 2.4 * P, 2.4 * P);
      s += '<circle cx="' + (cx + 3) + '" cy="' + (cy + 4) + '" r="' + (1.9 * P) + '" fill="#000" opacity=".25"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (1.9 * P) + '" fill="#26262a"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (1.3 * P) + '" fill="#333338"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="7" fill="#0b0b0c"/>';
      s += '<g data-live="waves" opacity="0" stroke="#ffcf5a" stroke-width="3" fill="none" stroke-linecap="round">' +
           '<path d="M' + (cx + 2.3 * P) + ' ' + (cy - 12) + 'q9 12 0 24"/><path d="M' + (cx + 2.9 * P) + ' ' + (cy - 20) + 'q14 20 0 40"/>' +
           '<path d="M' + (cx - 2.3 * P) + ' ' + (cy - 12) + 'q-9 12 0 24"/><path d="M' + (cx - 2.9 * P) + ' ' + (cy - 20) + 'q-14 20 0 40"/></g>';
      s += post(0, 0, "#d84a3a") + post(K, 0, "#3a3a3e");
      return s;
    },
    live: function (g, st) { if (g.waves) g.waves.setAttribute("opacity", st.sound ? (0.5 + 0.5 * Math.abs(Math.sin(Date.now() / 90))).toFixed(2) : 0); }
  });

  add("k_motor", {
    name: "Fan motor", cat: "Toy box", kid: true,
    blurb: "Electricity makes the motor spin. Swap the wires and it spins the other way!",
    pins: two(),
    box: { x: -1.2 * P, y: -8.6 * P, w: K + 2.4 * P, h: 9.8 * P },
    props: {},
    art: function () {
      var cx = K / 2;
      var s = base(-1.2 * P, -1.2 * P, K + 2.4 * P, 2.4 * P);
      s += '<rect x="' + (cx - 1.4 * P) + '" y="' + (-4.4 * P) + '" width="' + (2.8 * P) + '" height="' + (3.4 * P) + '" rx="12" fill="#c5cbd0" stroke="#7f878c" stroke-width="2"/>';
      s += '<rect x="' + (cx - 1 * P) + '" y="' + (-4.2 * P) + '" width="7" height="' + (2.8 * P) + '" rx="3" fill="#fff" opacity=".4"/>';
      s += '<rect x="' + (cx - 3) + '" y="' + (-5.3 * P) + '" width="6" height="' + P + '" fill="#dfe4e8" stroke="#8a9196"/>';
      s += '<g data-live="rot">' + L.fanBlades(cx, -5.4 * P, 3 * P, "#e8553d") + '</g>';
      s += post(0, 0) + post(K, 0);
      return s;
    },
    live: function (g, st) {
      if (!g.rot) return;
      g.rot.setAttribute("transform", "rotate(" + ((st.ang || 0) % 360).toFixed(1) + " " + (K / 2) + " " + (-5.4 * P) + ")");
      g.rot.style.opacity = Math.abs(st.w || 0) > 30 ? "0.7" : "1";
    }
  });

  add("k_led", {
    name: "LED light", cat: "Toy box", kid: true,
    blurb: "A tiny light that only lets electricity through one way: red post to +. This one has a helper resistor built in.",
    pins: two("+", "-"),
    box: BOX,
    props: { color: "green" },
    spec: [{ k: "color", label: "Colour", type: "select", options: Object.keys(L.LED_COLORS).map(function (k) { return [k, L.LED_COLORS[k].name]; }) }],
    art: function (part, pr) {
      var c = L.LED_COLORS[pr.color] || L.LED_COLORS.green, cx = K / 2, cy = -3.2 * P;
      var s = base(-1.2 * P, -1.2 * P, K + 2.4 * P, 2.4 * P);
      s += '<rect x="' + (cx - 1.5 * P) + '" y="' + (cy + 0.9 * P) + '" width="' + (3 * P) + '" height="' + (0.6 * P) + '" rx="3" fill="' + c.fill + '"/>';
      s += '<path d="M' + (cx - 1.5 * P) + ' ' + (cy + 1 * P) + 'v-' + (1.1 * P) + 'a' + (1.5 * P) + ' ' + (1.5 * P) + ' 0 0 1 ' + (3 * P) + ' 0v' + (1.1 * P) + 'z" fill="' + c.fill + '" opacity=".85"/>';
      s += '<path data-live="core" d="M' + (cx - 1.1 * P) + ' ' + (cy + 0.8 * P) + 'v-' + (0.9 * P) + 'a' + (1.1 * P) + ' ' + (1.1 * P) + ' 0 0 1 ' + (2.2 * P) + ' 0v' + (0.9 * P) + 'z" fill="' + c.light + '" opacity="0"/>';
      s += '<ellipse cx="' + (cx - 10) + '" cy="' + (cy - 6) + '" rx="5" ry="10" fill="#fff" opacity=".55"/>';
      s += text(cx, cy + 2.1 * P, "+ →  −", 11, "#5a3a1a", { weight: 800 });
      s += post(0, 0, "#d84a3a") + post(K, 0, "#3a3a3e");
      return s;
    },
    live: function (g, st) { if (g.core) g.core.setAttribute("opacity", Math.min(1, (st.b || 0) * 1.1).toFixed(2)); },
    glow: function (st, pr) {
      if (!(st.b > 0.01)) return null;
      var c = L.LED_COLORS[pr.color] || L.LED_COLORS.green;
      return [{ x: K / 2, y: -3.4 * P, r: 34 + 70 * Math.min(1, st.b), c: c.light, a: Math.min(1, 0.3 + st.b) }];
    }
  });

  add("k_resistor", {
    name: "Slow-down block", cat: "Toy box", kid: true,
    blurb: "A resistor. It makes it harder for electricity to flow, so lights get dimmer and motors slower.",
    pins: two(),
    box: { x: -1.2 * P, y: -3.6 * P, w: K + 2.4 * P, h: 4.8 * P },
    props: { ohms: 47 },
    spec: [{ k: "ohms", label: "How much it slows", type: "select", options: [[10, "A little (10 Ω)"], [47, "Some (47 Ω)"], [220, "A lot (220 Ω)"], [1000, "Loads (1 kΩ)"]], live: true }],
    art: function (part, pr) {
      var s = base(-1.2 * P, -1.2 * P, K + 2.4 * P, 2.4 * P);
      var x = 0.8 * P, y = -3.2 * P, w = K - 1.6 * P, h = 1.8 * P;
      s += '<rect x="' + (x + 3) + '" y="' + (y + 4) + '" width="' + w + '" height="' + h + '" rx="16" fill="#000" opacity=".2"/>';
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="16" fill="#dcc69c" stroke="#a8915f" stroke-width="2"/>';
      L.resistorBands(pr.ohms).forEach(function (b, i) {
        s += '<rect x="' + (x + 16 + i * 14 + (i === 3 ? 10 : 0)) + '" y="' + y + '" width="8" height="' + h + '" fill="' + b[1] + '"/>';
      });
      s += '<path d="M0 0V' + (y + h / 2) + 'H' + x + 'M' + K + ' 0V' + (y + h / 2) + 'H' + (x + w) + '" stroke="#b8bec4" stroke-width="4" fill="none"/>';
      s += post(0, 0) + post(K, 0);
      return s;
    }
  });

  add("k_ldr", {
    name: "Light sensor", cat: "Toy box", kid: true,
    blurb: "An eye for light. In bright light it lets lots of electricity through; in the dark, hardly any.",
    pins: two(),
    box: BOX,
    props: { light: 70 },
    spec: [{ k: "light", label: "How bright", type: "range", min: 0, max: 100, step: 1, unit: "%", live: true }],
    env: "light",
    art: function () {
      var cx = K / 2, cy = -2.8 * P;
      var s = base(-1.2 * P, -1.2 * P, K + 2.4 * P, 2.4 * P);
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (1.8 * P) + '" fill="#fffaf0" stroke="#c4b79c" stroke-width="2.5"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (1 * P) + '" fill="#6b4a2a"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (0.5 * P) + '" fill="#111"/>';
      s += '<circle cx="' + (cx - 6) + '" cy="' + (cy - 6) + '" r="4" fill="#fff"/>';
      s += '<g data-live="lid"><path d="M' + (cx - 1.8 * P) + ' ' + cy + 'a' + (1.8 * P) + ' ' + (1.8 * P) + ' 0 0 1 ' + (3.6 * P) + ' 0z" fill="#c9965c" stroke="#8a6234" stroke-width="2"/></g>';
      s += post(0, 0) + post(K, 0);
      return s;
    },
    live: function (g, st, pr) {
      if (!g.lid) return;
      var f = 1 - (pr.light == null ? 70 : pr.light) / 100;
      g.lid.setAttribute("transform", "translate(0 " + (-2.8 * P) + ") scale(1 " + f.toFixed(2) + ") translate(0 " + (2.8 * P) + ")");
    }
  });

  /* Robo Brain: a friendly microcontroller. Underneath it is the same chip
   * as an Uno, with its pins renamed for small hands:
   *   OUT 1-4 -> D3, D5, D6, D9 (all can dim, so "brightness" works)
   *   IN 1-2  -> D2, D4 with the pull-up on, so a button to GND just works
   *   EYE     -> A0                                                     */
  var BRAIN_MAP = { OUT1: "D3", OUT2: "D5", OUT3: "D6", OUT4: "D9", IN1: "D2", IN2: "D4", EYE: "A0" };
  L.BRAIN_MAP = BRAIN_MAP;
  var BW = 4 * K;
  add("k_brain", {
    name: "Robo Brain", cat: "Toy box", kid: true, mcu: true,
    blurb: "A tiny computer. Give it instructions with blocks and it turns its OUT posts on and off.",
    pins: [
      { n: "OUT1", x: 0, y: 0, label: "OUT 1" }, { n: "OUT2", x: K, y: 0, label: "OUT 2" },
      { n: "OUT3", x: 2 * K, y: 0, label: "OUT 3" }, { n: "OUT4", x: 3 * K, y: 0, label: "OUT 4" },
      { n: "GND1", x: 4 * K, y: 0, label: "− (ground)" },
      { n: "IN1", x: 0, y: 9 * P, label: "IN 1" }, { n: "IN2", x: K, y: 9 * P, label: "IN 2" },
      { n: "EYE", x: 2 * K, y: 9 * P, label: "EYE (sensor)" }, { n: "5V", x: 3 * K, y: 9 * P, label: "+ (power)" },
      { n: "GND2", x: 4 * K, y: 9 * P, label: "− (ground)" }
    ],
    buses: [["GND1", "GND2"]],
    box: { x: -1.6 * P, y: -1.6 * P, w: BW + 3.2 * P, h: 12.2 * P },
    props: {},
    art: function () {
      var x = -1.6 * P, y = -1.6 * P, w = BW + 3.2 * P, h = 12.2 * P;
      var s = '<rect x="' + (x + 4) + '" y="' + (y + 6) + '" width="' + w + '" height="' + h + '" rx="26" fill="#000" opacity=".3"/>';
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="26" fill="#3d7fe0" stroke="#1f4f9e" stroke-width="3"/>';
      s += '<rect x="' + (x + 10) + '" y="' + (y + 8) + '" width="' + (w - 20) + '" height="12" rx="6" fill="#fff" opacity=".18"/>';
      var fx = BW / 2, fy = 4.5 * P;
      s += '<rect x="' + (fx - 5 * P) + '" y="' + (fy - 2.4 * P) + '" width="' + (10 * P) + '" height="' + (4.8 * P) + '" rx="18" fill="#10223f"/>';
      s += '<g data-live="eyes"><circle cx="' + (fx - 2.4 * P) + '" cy="' + (fy - 0.4 * P) + '" r="' + (0.9 * P) + '" fill="#6ff0ff"/><circle cx="' + (fx + 2.4 * P) + '" cy="' + (fy - 0.4 * P) + '" r="' + (0.9 * P) + '" fill="#6ff0ff"/></g>';
      s += '<g data-live="mouth"><path d="M' + (fx - 1.6 * P) + ' ' + (fy + 1.1 * P) + 'q' + (1.6 * P) + ' ' + (0.9 * P) + ' ' + (3.2 * P) + ' 0" stroke="#6ff0ff" stroke-width="4" fill="none" stroke-linecap="round"/></g>';
      s += '<path d="M' + (fx) + ' ' + (y - 0.2 * P) + 'v-' + (1.2 * P) + '" stroke="#1f4f9e" stroke-width="4"/><circle data-live="antenna" cx="' + fx + '" cy="' + (y - 1.6 * P) + '" r="8" fill="#f2c230" stroke="#a7841a" stroke-width="2"/>';
      var top = ["OUT 1", "OUT 2", "OUT 3", "OUT 4", "−"], bot = ["IN 1", "IN 2", "EYE", "+", "−"];
      top.forEach(function (t, i) {
        s += '<g data-live="o' + (i + 1) + '"><circle cx="' + (i * K) + '" cy="' + (1.5 * P) + '" r="5" fill="#173a70"/></g>';
        s += text(i * K, 2.4 * P, t, 12, "#eaf2ff", { weight: 800 });
        s += S.post(i * K, 0, i === 4 ? "#3a3a3e" : null);
      });
      bot.forEach(function (t, i) {
        s += text(i * K, 7.6 * P, t, 12, "#eaf2ff", { weight: 800 });
        s += S.post(i * K, 9 * P, i === 3 ? "#d84a3a" : i === 4 ? "#3a3a3e" : null);
      });
      return s;
    },
    live: function (g, st) {
      for (var i = 1; i <= 4; i++) if (g["o" + i]) L.setFill(g["o" + i], st["o" + i] ? "#ffe14a" : "#173a70");
      if (g.antenna) g.antenna.setAttribute("fill", st.on ? (st.busy ? "#5bff7a" : "#f2c230") : "#7a6a3a");
      if (g.eyes) g.eyes.setAttribute("opacity", st.on ? 1 : 0.35);
    },
    glow: function (st) {
      var out = [];
      for (var i = 1; i <= 4; i++) if (st["o" + i]) out.push({ x: (i - 1) * K, y: 1.5 * P, r: 14, c: "#ffe14a", a: 0.8 });
      if (st.on) out.push({ x: BW / 2, y: -3.2 * P, r: 16, c: st.busy ? "#5bff7a" : "#f2c230", a: 0.6 });
      return out;
    }
  });
})(typeof window !== "undefined" ? window : globalThis);
