/* Chalk Circuit Lab — the parts drawer.
 *
 * One entry per kind of component. An entry says where the legs are (in
 * tenths of an inch, so they land in breadboard holes), what can be changed
 * about it, and how to draw it. The physics lives in lab_sim.js and is keyed
 * by the same type name; this file only knows what things look like.
 *
 *   pins   [{n, x, y}] in local units, or fn(props) -> that
 *   buses  groups of pins joined inside the part (a button's two legs per
 *          side, a breadboard's strips, an Arduino's GND pins)
 *   box    local bounding box
 *   props  defaults; spec describes them for the inspector
 *   art    fn(part, props) -> SVG string, local coordinates
 *   live   fn(g, st, props) -> update the bits that move or light up
 *   glow   fn(st, props) -> [{x, y, r, c, a}] light for the overlay canvas
 *
 * Art is drawn with presentation attributes rather than CSS classes, so a
 * snapshot of the bench serialises to an image that looks the same.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab = root.ChalkLab || {};
  var P = L.P;
  var PARTS = L.PARTS = {};
  var ORDER = L.PART_ORDER = [];

  function add(type, def) { def.type = type; PARTS[type] = def; ORDER.push(type); return def; }
  L.addPart = add;

  /* ------------------------------------------------------------ helpers */

  var n = function (v) { return Math.round(v * 100) / 100; };

  /* A tinned component lead: dark edge, bright core, so it reads as round. */
  function lead(x1, y1, x2, y2, w) {
    w = w || 2.4;
    var d = "M" + n(x1) + " " + n(y1) + "L" + n(x2) + " " + n(y2);
    return '<path d="' + d + '" stroke="#5f666d" stroke-width="' + (w + 1.6) + '" stroke-linecap="round" fill="none"/>' +
           '<path d="' + d + '" stroke="#d3d8dc" stroke-width="' + w + '" stroke-linecap="round" fill="none"/>' +
           '<path d="' + d + '" stroke="#ffffff" stroke-opacity=".55" stroke-width="' + (w * 0.35) + '" stroke-linecap="round" fill="none"/>';
  }
  /* A lead with a bend in it — LEDs and transistors stand up off the board. */
  function leadPath(d, w) {
    w = w || 2.4;
    return '<path d="' + d + '" stroke="#5f666d" stroke-width="' + (w + 1.6) + '" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
           '<path d="' + d + '" stroke="#d3d8dc" stroke-width="' + w + '" stroke-linecap="round" stroke-linejoin="round" fill="none"/>';
  }
  /* A gold header pin seen from above. */
  function hdr(x, y) {
    return '<rect x="' + n(x - 3.2) + '" y="' + n(y - 3.2) + '" width="6.4" height="6.4" fill="#1a1a1a"/>' +
           '<rect x="' + n(x - 1.8) + '" y="' + n(y - 1.8) + '" width="3.6" height="3.6" fill="#e3b54a"/>';
  }
  /* A female header socket. */
  function sock(x, y) {
    return '<rect x="' + n(x - 3.6) + '" y="' + n(y - 3.6) + '" width="7.2" height="7.2" rx="1" fill="#141414"/>' +
           '<rect x="' + n(x - 1.6) + '" y="' + n(y - 1.6) + '" width="3.2" height="3.2" fill="#000"/>';
  }
  function shadow(x, y, w, h, r) {
    return '<rect x="' + n(x + 3) + '" y="' + n(y + 4) + '" width="' + n(w) + '" height="' + n(h) + '" rx="' + (r || 4) +
           '" fill="#000" opacity=".28"/>';
  }
  function text(x, y, s, size, fill, opts) {
    opts = opts || {};
    return '<text x="' + n(x) + '" y="' + n(y) + '" font-size="' + size + '" fill="' + (fill || "#fff") + '"' +
           ' font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"' +
           (opts.weight ? ' font-weight="' + opts.weight + '"' : '') +
           ' text-anchor="' + (opts.anchor || "middle") + '"' +
           (opts.rot ? ' transform="rotate(' + opts.rot + ' ' + n(x) + ' ' + n(y) + ')"' : '') +
           ' dominant-baseline="middle">' + L.esc(s) + '</text>';
  }
  /* A brass screw post — every kid part connects with these. */
  function post(x, y, color) {
    return '<circle cx="' + n(x) + '" cy="' + n(y) + '" r="11" fill="#000" opacity=".25" transform="translate(2 3)"/>' +
           '<circle cx="' + n(x) + '" cy="' + n(y) + '" r="11" fill="' + (color || "#c9a03c") + '" stroke="#7a5a12" stroke-width="1.5"/>' +
           '<circle cx="' + n(x) + '" cy="' + n(y) + '" r="7" fill="#e9c860" stroke="#9c7a20" stroke-width="1"/>' +
           '<path d="M' + n(x - 5) + ' ' + n(y) + 'H' + n(x + 5) + '" stroke="#6d5010" stroke-width="2" stroke-linecap="round"/>';
  }
  function base(x, y, w, h) {
    return shadow(x, y, w, h, 10) +
      '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) + '" rx="10" fill="#c9965c" stroke="#8a6234" stroke-width="2"/>' +
      '<path d="M' + n(x + 8) + ' ' + n(y + h * 0.35) + 'q' + n(w * 0.3) + ' -6 ' + n(w - 16) + ' 2M' + n(x + 10) + ' ' + n(y + h * 0.7) +
      'q' + n(w * 0.4) + ' 5 ' + n(w - 22) + ' -1" stroke="#b07d47" stroke-width="1.5" fill="none" opacity=".7"/>';
  }
  L.svg = { lead: lead, leadPath: leadPath, hdr: hdr, sock: sock, shadow: shadow, text: text, post: post, base: base };

  /* -------------------------------------------------------- colour codes */

  var BANDS = [
    ["black", "#1b1b1b"], ["brown", "#7b4a26"], ["red", "#d0312d"], ["orange", "#f07f1d"],
    ["yellow", "#f4d03f"], ["green", "#2e9b4f"], ["blue", "#2f6fd1"], ["violet", "#8b4fc9"],
    ["grey", "#8d8d8d"], ["white", "#f2f2f2"]
  ];
  var GOLD = ["gold", "#c9a43b"], SILVER = ["silver", "#b8bcc2"];
  L.BANDS = BANDS; L.GOLD = GOLD; L.SILVER = SILVER;

  /* Resistance -> colour bands. 4-band is two digits and a multiplier;
   * 5-band (metal film) is three. Values are rounded to what the code can
   * actually say, which is also what a real part would be. */
  L.resistorBands = function (ohms, five) {
    var digits = five ? 3 : 2;
    if (!(ohms > 0)) ohms = 0.1;
    var exp = Math.floor(Math.log10(ohms)) - (digits - 1);
    var sig = Math.round(ohms / Math.pow(10, exp));
    if (sig >= Math.pow(10, digits)) { sig = Math.round(sig / 10); exp += 1; }
    exp = L.clamp(exp, -2, 9);
    var s = String(sig);
    while (s.length < digits) s = "0" + s;
    var out = [];
    for (var i = 0; i < digits; i++) out.push(BANDS[+s.charAt(i)]);
    out.push(exp === -1 ? GOLD : exp === -2 ? SILVER : BANDS[exp]);
    out.push(five ? BANDS[1] : GOLD);           /* tolerance: 1% brown, 5% gold */
    return out;
  };
  L.bandsToOhms = function (names) {
    var idx = function (nm) {
      for (var i = 0; i < BANDS.length; i++) if (BANDS[i][0] === nm) return i;
      return nm === "gold" ? -1 : nm === "silver" ? -2 : 0;
    };
    var d = names.slice(0, names.length - 1), mult = idx(d.pop()), v = 0;
    for (var i = 0; i < d.length; i++) v = v * 10 + Math.max(0, idx(d[i]));
    return v * Math.pow(10, mult);
  };

  var E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
  L.E12 = [];
  for (var dec = 0; dec <= 6; dec++) E12.forEach(function (m) { L.E12.push(Math.round(m * Math.pow(10, dec) * 10) / 10); });
  L.E12.push(10000000);

  var LED_COLORS = {
    red:    { fill: "#e0261c", light: "#ff4a3a", vf: 1.9,  name: "Red" },
    orange: { fill: "#f07b14", light: "#ff9a3a", vf: 2.0,  name: "Orange" },
    yellow: { fill: "#f2cf1f", light: "#ffe25a", vf: 2.05, name: "Yellow" },
    green:  { fill: "#24b24a", light: "#4dff7a", vf: 2.2,  name: "Green" },
    blue:   { fill: "#2f6cf5", light: "#5aa0ff", vf: 3.0,  name: "Blue" },
    white:  { fill: "#e9eef5", light: "#ffffff", vf: 3.1,  name: "White" },
    purple: { fill: "#9b3cf0", light: "#c27dff", vf: 3.2,  name: "Purple" }
  };
  L.LED_COLORS = LED_COLORS;
  var ledOptions = Object.keys(LED_COLORS).map(function (k) { return [k, LED_COLORS[k].name]; });

  /* ================================================================ BOARDS */

  /* Breadboard. Holes are pins like any other — the strips are buses — so a
   * leg in a hole and a wire in a hole are found the same way. */
  function breadboard(cols) {
    var W = (cols + 3) * P, H = 19 * P;
    var ROWS = { a: 4, b: 5, c: 6, d: 7, e: 8, f: 11, g: 12, h: 13, i: 14, j: 15 };
    var RAILS = { tp: 1, tn: 2, bp: 17, bn: 18 };
    var railHole = function (c) { return (c - 1) % 6 !== 5; };
    var pins = [], buses = [], c, r;
    for (c = 1; c <= cols; c++) {
      var top = [], bot = [];
      for (r in ROWS) {
        pins.push({ n: r + c, x: (c + 1) * P, y: ROWS[r] * P, hole: true });
        (ROWS[r] < 10 ? top : bot).push(r + c);
      }
      buses.push(top, bot);
    }
    for (r in RAILS) {
      var bus = [];
      for (c = 1; c <= cols; c++) {
        if (!railHole(c)) continue;
        pins.push({ n: r + c, x: (c + 1) * P, y: RAILS[r] * P, hole: true });
        bus.push(r + c);
      }
      buses.push(bus);
    }
    return {
      name: cols > 40 ? "Breadboard" : "Half breadboard",
      cat: "Boards", layer: "board",
      blurb: "Push legs into the holes. Each column of five is joined underneath, and so is each long rail.",
      pins: pins, buses: buses,
      box: { x: 0, y: 0, w: W, h: H },
      props: {},
      rows: ROWS, rails: RAILS, cols: cols,
      art: function () {
        var s = shadow(0, 0, W, H, 8);
        s += '<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="8" fill="#f1efe9" stroke="#cfcbc2" stroke-width="1.5"/>';
        s += '<rect x="' + P + '" y="' + (9.35 * P) + '" width="' + (W - 2 * P) + '" height="' + (1.3 * P) + '" rx="3" fill="#dedad1"/>';
        /* rail stripes */
        s += '<path d="M' + P + ' ' + (0.45 * P) + 'H' + (W - P) + '" stroke="#d6453d" stroke-width="2"/>';
        s += '<path d="M' + P + ' ' + (2.55 * P) + 'H' + (W - P) + '" stroke="#3567c7" stroke-width="2"/>';
        s += '<path d="M' + P + ' ' + (16.45 * P) + 'H' + (W - P) + '" stroke="#d6453d" stroke-width="2"/>';
        s += '<path d="M' + P + ' ' + (18.55 * P) + 'H' + (W - P) + '" stroke="#3567c7" stroke-width="2"/>';
        s += text(0.55 * P, 1 * P, "+", 12, "#d6453d", { weight: 700 }) + text(0.55 * P, 2 * P, "−", 13, "#3567c7", { weight: 700 });
        s += text(0.55 * P, 17 * P, "+", 12, "#d6453d", { weight: 700 }) + text(0.55 * P, 18 * P, "−", 13, "#3567c7", { weight: 700 });
        s += text(W - 0.55 * P, 1 * P, "+", 12, "#d6453d", { weight: 700 }) + text(W - 0.55 * P, 2 * P, "−", 13, "#3567c7", { weight: 700 });
        s += text(W - 0.55 * P, 17 * P, "+", 12, "#d6453d", { weight: 700 }) + text(W - 0.55 * P, 18 * P, "−", 13, "#3567c7", { weight: 700 });
        /* holes: one path per board is far cheaper than eight hundred rects */
        var d = "";
        pins.forEach(function (p) { d += "M" + (p.x - 3) + " " + (p.y - 3) + "h6v6h-6z"; });
        s += '<path d="' + d + '" fill="#3b3a37"/>';
        var d2 = "";
        pins.forEach(function (p) { d2 += "M" + (p.x - 3) + " " + (p.y - 3) + "h6v1.6h-6z"; });
        s += '<path d="' + d2 + '" fill="#141413" opacity=".7"/>';
        for (r in ROWS) {
          s += text(1 * P, ROWS[r] * P, r, 10, "#a19c91");
          s += text(W - 1 * P, ROWS[r] * P, r, 10, "#a19c91");
        }
        for (c = 1; c <= cols; c++) {
          if (c === 1 || c % 5 === 0) {
            s += text((c + 1) * P, 3.15 * P, String(c), 9, "#a19c91");
            s += text((c + 1) * P, 15.85 * P, String(c), 9, "#a19c91");
          }
        }
        return s;
      }
    };
  }
  add("breadboard_half", breadboard(30));
  add("breadboard_full", breadboard(63));

  /* Arduino Uno. Coordinates are the real header order, so a wiring diagram
   * from any tutorial maps across pin for pin. */
  var UNO_TOP = ["SCL", "SDA", "AREF", "GND3", "D13", "D12", "D11", "D10", "D9", "D8", null, "D7", "D6", "D5", "D4", "D3", "D2", "D1", "D0"];
  var UNO_BOT = [null, "IOREF", "RESET", "3V3", "5V", "GND1", "GND2", "VIN", null, "A0", "A1", "A2", "A3", "A4", "A5"];
  var PWM = { D3: 1, D5: 1, D6: 1, D9: 1, D10: 1, D11: 1 };
  L.PWM_PINS = PWM;

  function unoPins() {
    var out = [];
    UNO_TOP.forEach(function (nm, i) { if (nm) out.push({ n: nm, x: (8 + i) * P, y: 1 * P, label: nm.replace(/^GND\d/, "GND") }); });
    UNO_BOT.forEach(function (nm, i) { if (nm) out.push({ n: nm, x: (10 + i) * P, y: 20 * P, label: nm.replace(/^GND\d/, "GND") }); });
    return out;
  }
  var UNO_PINS = unoPins();

  add("arduino_uno", {
    name: "Arduino Uno", cat: "Boards", layer: "board", mcu: true,
    blurb: "The classic microcontroller board. It runs your program and powers small parts from its 5V pin.",
    pins: UNO_PINS,
    buses: [["GND1", "GND2", "GND3"], ["SDA", "A4"], ["SCL", "A5"]],
    box: { x: 0, y: 0, w: 28 * P, h: 21 * P },
    props: {},
    art: function () {
      var W = 28 * P, H = 21 * P, s = shadow(0, 0, W, H, 14);
      s += '<path d="M14 0H' + (W - 30) + 'l30 30V' + (H - 14) + 'q0 14 -14 14H14Q0 ' + H + ' 0 ' + (H - 14) + 'V14Q0 0 14 0z" fill="#00838c" stroke="#00666d" stroke-width="2"/>';
      /* traces, faint, so the board reads as a circuit board at a glance */
      s += '<g stroke="#2aa3aa" stroke-width="1.6" fill="none" opacity=".45">' +
        '<path d="M190 60V120H300L330 150V210"/><path d="M210 60V100H340"/><path d="M250 60V90H380V180"/>' +
        '<path d="M410 60V140H470"/><path d="M300 400V340H420"/><path d="M220 400V330H160"/></g>';
      /* mounting holes */
      [[30, 40], [W - 40, 60], [W - 40, H - 40], [60, H - 30]].forEach(function (h) {
        s += '<circle cx="' + h[0] + '" cy="' + h[1] + '" r="8" fill="#e9d8a6" stroke="#b49b55"/><circle cx="' + h[0] + '" cy="' + h[1] + '" r="4.5" fill="#1d2a2c"/>';
      });
      /* USB-B and the barrel jack */
      s += '<rect x="-14" y="' + (2.6 * P) + '" width="' + (3.4 * P) + '" height="' + (4.2 * P) + '" rx="3" fill="#b9bfc4" stroke="#7d858b" stroke-width="2"/>';
      s += '<rect x="-6" y="' + (3.3 * P) + '" width="' + (2.4 * P) + '" height="' + (2.8 * P) + '" rx="2" fill="#8e969c"/>';
      s += '<rect x="-12" y="' + (13.4 * P) + '" width="' + (4.4 * P) + '" height="' + (3.6 * P) + '" rx="4" fill="#1b1b1b"/>';
      s += '<circle cx="' + (0.8 * P) + '" cy="' + (15.2 * P) + '" r="9" fill="#333"/><circle cx="' + (0.8 * P) + '" cy="' + (15.2 * P) + '" r="3.5" fill="#999"/>';
      /* reset button */
      s += '<rect x="' + (2.6 * P) + '" y="' + (1.2 * P) + '" width="' + (1.6 * P) + '" height="' + (1.6 * P) + '" rx="3" fill="#c7c7c7"/>' +
           '<circle cx="' + (3.4 * P) + '" cy="' + (2 * P) + '" r="9" fill="#b0282a"/>';
      /* ATmega328P, 28 legs */
      var cx = 13 * P, cy = 15.2 * P;
      s += '<rect x="' + (cx - 7.4 * P) + '" y="' + (cy - 1.6 * P) + '" width="' + (14.8 * P) + '" height="' + (3.2 * P) + '" rx="3" fill="#222"/>';
      for (var i = 0; i < 14; i++) {
        var px = cx - 6.5 * P + i * P;
        s += '<rect x="' + (px - 3) + '" y="' + (cy - 2.05 * P) + '" width="6" height="9" fill="#c9ced2"/>';
        s += '<rect x="' + (px - 3) + '" y="' + (cy + 1.6 * P) + '" width="6" height="9" fill="#c9ced2"/>';
      }
      s += '<circle cx="' + (cx - 6.6 * P) + '" cy="' + cy + '" r="6" fill="#151515"/>';
      s += text(cx, cy, "ATMEGA328P", 14, "#9aa2a8", { weight: 600 });
      /* crystal, regulator, caps */
      s += '<rect x="' + (9 * P) + '" y="' + (10.6 * P) + '" width="' + (2.6 * P) + '" height="' + (1.1 * P) + '" rx="10" fill="#c7cdd2" stroke="#8b9398"/>';
      s += '<rect x="' + (3 * P) + '" y="' + (9.5 * P) + '" width="' + (2.2 * P) + '" height="' + (2.2 * P) + '" rx="2" fill="#2a2a2a"/>';
      s += '<circle cx="' + (6.4 * P) + '" cy="' + (17.8 * P) + '" r="14" fill="#555" stroke="#333"/><circle cx="' + (8 * P) + '" cy="' + (17.8 * P) + '" r="14" fill="#555" stroke="#333"/>';
      /* logo */
      s += '<g transform="translate(' + (17.5 * P) + ' ' + (8.6 * P) + ')" fill="none" stroke="#e8f6f6" stroke-width="5">' +
           '<circle cx="-18" cy="0" r="14"/><circle cx="18" cy="0" r="14"/>' +
           '<path d="M-24 0h12M12 0h12M18 -6v12" stroke-width="3.5"/></g>';
      s += text(17.5 * P, 11 * P, "UNO", 30, "#e8f6f6", { weight: 800 });
      s += text(23.6 * P, 11.1 * P, "ARDUINO", 11, "#bfe6e8", { weight: 700 });
      /* header strips */
      s += '<rect x="' + (7.5 * P) + '" y="' + (0.5 * P) + '" width="' + (10 * P) + '" height="' + P + '" fill="#141414"/>';
      s += '<rect x="' + (18.5 * P) + '" y="' + (0.5 * P) + '" width="' + (8 * P) + '" height="' + P + '" fill="#141414"/>';
      s += '<rect x="' + (10.5 * P) + '" y="' + (19.5 * P) + '" width="' + (7 * P) + '" height="' + P + '" fill="#141414"/>';
      s += '<rect x="' + (18.5 * P) + '" y="' + (19.5 * P) + '" width="' + (6 * P) + '" height="' + P + '" fill="#141414"/>';
      UNO_PINS.forEach(function (p) {
        s += '<rect x="' + (p.x - 2.6) + '" y="' + (p.y - 2.6) + '" width="5.2" height="5.2" fill="#000"/>';
        var lbl = p.label.replace(/^D/, "");
        if (PWM[p.n]) lbl = "~" + lbl;
        var ly = p.y < 10 * P ? p.y + 0.95 * P : p.y - 0.95 * P;
        s += text(p.x, ly, lbl, 8.5, "#e8f6f6", { rot: -90, weight: 600 });
      });
      s += text(22 * P, 2.9 * P, "DIGITAL (PWM~)", 10, "#e8f6f6", { weight: 700 });
      s += text(14 * P, 18.1 * P, "POWER", 10, "#e8f6f6", { weight: 700 });
      s += text(21.5 * P, 18.1 * P, "ANALOG IN", 10, "#e8f6f6", { weight: 700 });
      /* status LEDs: ON, L, TX, RX */
      s += '<g data-live="ledL"><rect x="' + (9.4 * P) + '" y="' + (3.6 * P) + '" width="12" height="7" rx="1.5" fill="#6b5a1a"/></g>' + text(10.6 * P, 3.8 * P, "L", 9, "#e8f6f6", { anchor: "start" });
      s += '<g data-live="ledTX"><rect x="' + (9.4 * P) + '" y="' + (4.6 * P) + '" width="12" height="7" rx="1.5" fill="#6b5a1a"/></g>' + text(10.6 * P, 4.8 * P, "TX", 9, "#e8f6f6", { anchor: "start" });
      s += '<g data-live="ledRX"><rect x="' + (9.4 * P) + '" y="' + (5.6 * P) + '" width="12" height="7" rx="1.5" fill="#6b5a1a"/></g>' + text(10.6 * P, 5.8 * P, "RX", 9, "#e8f6f6", { anchor: "start" });
      s += '<g data-live="ledON"><rect x="' + (25.4 * P) + '" y="' + (13 * P) + '" width="12" height="7" rx="1.5" fill="#1d5a2a"/></g>' + text(25.1 * P, 13.2 * P, "ON", 9, "#e8f6f6", { anchor: "end" });
      return s;
    },
    live: function (g, st) {
      setFill(g.ledON, st.on ? "#5bff7a" : "#1d5a2a");
      setFill(g.ledL, st.l ? "#ffd23a" : "#6b5a1a");
      setFill(g.ledTX, st.tx ? "#ffd23a" : "#6b5a1a");
      setFill(g.ledRX, st.rx ? "#ffd23a" : "#6b5a1a");
    },
    glow: function (st) {
      var out = [];
      if (st.on) out.push({ x: 25.7 * P, y: 13.2 * P, r: 16, c: "#5bff7a", a: 0.7 });
      if (st.l) out.push({ x: 9.7 * P, y: 3.8 * P, r: 18, c: "#ffd23a", a: 0.8 });
      if (st.tx) out.push({ x: 9.7 * P, y: 4.8 * P, r: 12, c: "#ffd23a", a: 0.6 });
      return out;
    }
  });

  function setFill(el, c) { if (el && el.firstChild && el.firstChild.getAttribute("fill") !== c) el.firstChild.setAttribute("fill", c); }
  L.setFill = setFill;

  /* Nano: the same chip on a stick that straddles the breadboard channel. */
  var NANO_TOP = ["D12", "D11", "D10", "D9", "D8", "D7", "D6", "D5", "D4", "D3", "D2", "GND1", "RST1", "D0", "D1"];
  var NANO_BOT = ["D13", "3V3", "AREF", "A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "5V", "RST2", "GND2", "VIN"];
  var NANO_PINS = [];
  NANO_TOP.forEach(function (nm, i) { NANO_PINS.push({ n: nm, x: (i + 1) * P, y: 0, label: nm.replace(/\d$/, function (d) { return /GND|RST/.test(nm) ? "" : d; }) }); });
  NANO_BOT.forEach(function (nm, i) { NANO_PINS.push({ n: nm, x: (i + 1) * P, y: 6 * P, label: nm.replace(/\d$/, function (d) { return /GND|RST/.test(nm) ? "" : d; }) }); });

  add("arduino_nano", {
    name: "Arduino Nano", cat: "Boards", layer: "part", mcu: true,
    blurb: "A small Arduino that plugs straight into a breadboard, across the middle channel.",
    pins: NANO_PINS,
    buses: [["GND1", "GND2"], ["RST1", "RST2"]],
    box: { x: -1.6 * P, y: -0.7 * P, w: 18.2 * P, h: 7.4 * P },
    props: {},
    art: function () {
      var s = shadow(-1.6 * P, -0.7 * P, 18.2 * P, 7.4 * P, 4);
      s += '<rect x="' + (-0.4 * P) + '" y="' + (-0.7 * P) + '" width="' + (17 * P) + '" height="' + (7.4 * P) + '" rx="4" fill="#1b5fa8" stroke="#124478" stroke-width="1.5"/>';
      s += '<rect x="' + (-1.6 * P) + '" y="' + (2 * P) + '" width="' + (2.6 * P) + '" height="' + (2 * P) + '" rx="2" fill="#b9bfc4" stroke="#7d858b"/>';
      s += '<rect x="' + (6 * P) + '" y="' + (2 * P) + '" width="' + (2.2 * P) + '" height="' + (2.2 * P) + '" fill="#1b1b1b" transform="rotate(45 ' + (7.1 * P) + ' ' + (3.1 * P) + ')"/>';
      s += '<rect x="' + (11.5 * P) + '" y="' + (2.5 * P) + '" width="' + (1.4 * P) + '" height="' + P + '" rx="2" fill="#ddd"/><circle cx="' + (12.2 * P) + '" cy="' + (3 * P) + '" r="5" fill="#b0282a"/>';
      s += text(9.6 * P, 1.6 * P, "NANO", 12, "#e6f0fb", { weight: 800 });
      NANO_PINS.forEach(function (p) {
        s += '<circle cx="' + p.x + '" cy="' + p.y + '" r="5.5" fill="#e3b54a"/><circle cx="' + p.x + '" cy="' + p.y + '" r="2.5" fill="#333"/>';
        s += text(p.x, p.y < P ? p.y + 0.95 * P : p.y - 0.95 * P, p.label.replace(/^D/, ""), 7.5, "#e6f0fb", { rot: -90 });
      });
      s += '<g data-live="ledON"><rect x="' + (14.2 * P) + '" y="' + (2.4 * P) + '" width="9" height="6" rx="1" fill="#1d5a2a"/></g>';
      s += '<g data-live="ledL"><rect x="' + (14.2 * P) + '" y="' + (3.3 * P) + '" width="9" height="6" rx="1" fill="#6b5a1a"/></g>';
      return s;
    },
    live: function (g, st) { setFill(g.ledON, st.on ? "#5bff7a" : "#1d5a2a"); setFill(g.ledL, st.l ? "#ffd23a" : "#6b5a1a"); },
    glow: function (st) {
      var out = [];
      if (st.on) out.push({ x: 14.4 * P, y: 2.55 * P, r: 12, c: "#5bff7a", a: 0.6 });
      if (st.l) out.push({ x: 14.4 * P, y: 3.45 * P, r: 14, c: "#ffd23a", a: 0.8 });
      return out;
    }
  });

  /* ================================================================= POWER */

  function batteryLeads(bx, by) {
    /* red and black leads from a battery's snap to two pins that drop into
     * the rails: + above −, one tenth apart, exactly like the rail rows. */
    return '<path d="M' + bx + ' ' + (by - 6) + 'C' + (bx + 40) + ' ' + (by - 10) + ' -40 0 0 0" stroke="#7a1010" stroke-width="5.6" fill="none" stroke-linecap="round"/>' +
           '<path d="M' + bx + ' ' + (by - 6) + 'C' + (bx + 40) + ' ' + (by - 10) + ' -40 0 0 0" stroke="#d72c2c" stroke-width="3.8" fill="none" stroke-linecap="round"/>' +
           '<path d="M' + bx + ' ' + (by + 6) + 'C' + (bx + 40) + ' ' + (by + 10) + ' -40 ' + P + ' 0 ' + P + '" stroke="#000" stroke-width="5.6" fill="none" stroke-linecap="round"/>' +
           '<path d="M' + bx + ' ' + (by + 6) + 'C' + (bx + 40) + ' ' + (by + 10) + ' -40 ' + P + ' 0 ' + P + '" stroke="#2a2a2a" stroke-width="3.8" fill="none" stroke-linecap="round"/>' +
           '<rect x="-5" y="-4" width="9" height="8" rx="1" fill="#c7cdd2"/><rect x="-5" y="' + (P - 4) + '" width="9" height="8" rx="1" fill="#c7cdd2"/>';
  }

  add("battery_9v", {
    name: "9V battery", cat: "Power",
    blurb: "A 9 volt battery on a snap clip. The two leads plug into a breadboard's + and − rails.",
    pins: [{ n: "+", x: 0, y: 0 }, { n: "-", x: 0, y: P, label: "−" }],
    box: { x: -8 * P, y: -1.8 * P, w: 8.4 * P, h: 4.6 * P },
    props: { volts: 9 },
    art: function () {
      var x = -8 * P, y = -1.8 * P, s = shadow(x, y, 4.8 * P, 4.6 * P, 5);
      s += '<rect x="' + x + '" y="' + y + '" width="' + (4.8 * P) + '" height="' + (4.6 * P) + '" rx="5" fill="#1d1d1f"/>';
      s += '<rect x="' + x + '" y="' + y + '" width="' + (2 * P) + '" height="' + (4.6 * P) + '" rx="5" fill="#d8a31c"/>';
      s += '<rect x="' + (x + 2 * P) + '" y="' + y + '" width="6" height="' + (4.6 * P) + '" fill="#9b7310"/>';
      s += text(x + 3.5 * P, y + 2.3 * P, "9V", 18, "#fff", { weight: 800, rot: -90 });
      s += '<rect x="' + (x + 4.6 * P) + '" y="' + (y + 0.7 * P) + '" width="' + (0.9 * P) + '" height="' + (3.2 * P) + '" rx="3" fill="#222" stroke="#444"/>';
      return s + batteryLeads(x + 5.5 * P, 0.5 * P);
    },
    live: heatLive, glow: null
  });

  add("battery_aa", {
    name: "AA battery pack", cat: "Power",
    blurb: "AA cells in a holder. Each cell adds 1.5 volts.",
    pins: [{ n: "+", x: 0, y: 0 }, { n: "-", x: 0, y: P, label: "−" }],
    box: function (pr) { return { x: -(3.3 * (pr.cells || 2) + 2.2) * P, y: -2 * P, w: (3.3 * (pr.cells || 2) + 2.6) * P, h: 5 * P }; },
    props: { cells: 2 },
    spec: [{ k: "cells", label: "Cells", type: "select", options: [[1, "1 × AA (1.5 V)"], [2, "2 × AA (3 V)"], [3, "3 × AA (4.5 V)"], [4, "4 × AA (6 V)"]], rebuild: true }],
    art: function (part, pr) {
      var cells = pr.cells || 2, w = (3.3 * cells + 0.6) * P, x = -(3.3 * cells + 2.2) * P, y = -2 * P;
      var s = shadow(x, y, w, 5 * P, 6) + '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + (5 * P) + '" rx="6" fill="#202022"/>';
      for (var i = 0; i < cells; i++) {
        var cx = x + 0.3 * P + i * 3.3 * P, cy = y + 0.7 * P;
        s += '<rect x="' + cx + '" y="' + cy + '" width="' + (3 * P) + '" height="' + (3.6 * P) + '" rx="5" fill="#d23b2a"/>';
        s += '<rect x="' + cx + '" y="' + cy + '" width="' + (3 * P) + '" height="' + (1.1 * P) + '" rx="5" fill="#2b2b2b"/>';
        s += '<rect x="' + (cx + 1.1 * P) + '" y="' + (cy - 4) + '" width="' + (0.8 * P) + '" height="6" rx="2" fill="#c7cdd2"/>';
        s += text(cx + 1.5 * P, cy + 2.4 * P, "AA", 12, "#fff", { weight: 800 });
        s += '<rect x="' + cx + '" y="' + cy + '" width="' + (0.8 * P) + '" height="' + (3.6 * P) + '" rx="4" fill="#fff" opacity=".18"/>';
      }
      return s + batteryLeads(x + w, 0.5 * P);
    },
    live: heatLive
  });

  add("coin_cell", {
    name: "Coin cell (CR2032)", cat: "Power",
    blurb: "A flat 3 volt cell. It cannot push much current, which makes it a gentle LED driver.",
    pins: [{ n: "+", x: 0, y: 0 }, { n: "-", x: 0, y: P, label: "−" }],
    box: { x: -4.8 * P, y: -1.8 * P, w: 5.2 * P, h: 4.6 * P },
    props: { volts: 3 },
    art: function () {
      var cx = -2.8 * P, cy = 0.5 * P;
      var s = '<circle cx="' + (cx + 3) + '" cy="' + (cy + 4) + '" r="' + (2.1 * P) + '" fill="#000" opacity=".28"/>';
      s += '<rect x="' + (cx - 2.2 * P) + '" y="' + (cy - 2.2 * P) + '" width="' + (4.4 * P) + '" height="' + (4.4 * P) + '" rx="8" fill="#222"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (1.9 * P) + '" fill="#c5cbd0" stroke="#8a9196" stroke-width="2"/>';
      s += '<circle cx="' + (cx - 10) + '" cy="' + (cy - 10) + '" r="' + (0.9 * P) + '" fill="#fff" opacity=".35"/>';
      s += text(cx, cy - 4, "CR2032", 9, "#555", { weight: 700 }) + text(cx, cy + 9, "+ 3V", 10, "#555", { weight: 700 });
      return s + batteryLeads(cx + 2.2 * P, cy);
    },
    live: heatLive
  });

  add("psu", {
    name: "Bench power supply", cat: "Power",
    blurb: "Dial any voltage from 0 to 15 V. The screen shows how much current your circuit is pulling.",
    pins: [{ n: "+", x: 0, y: 0 }, { n: "-", x: 3 * P, y: 0, label: "−" }],
    box: { x: -2.5 * P, y: -7.5 * P, w: 8 * P, h: 8.4 * P },
    props: { volts: 5, limit: 1 },
    spec: [
      { k: "volts", label: "Voltage", type: "range", min: 0, max: 15, step: 0.1, unit: "V", live: true },
      { k: "limit", label: "Current limit", type: "range", min: 0.05, max: 3, step: 0.05, unit: "A", live: true }
    ],
    art: function () {
      var x = -2.5 * P, y = -7.5 * P, s = shadow(x, y, 8 * P, 8 * P, 6);
      s += '<rect x="' + x + '" y="' + y + '" width="' + (8 * P) + '" height="' + (8 * P) + '" rx="6" fill="#3c4247" stroke="#22272b" stroke-width="2"/>';
      s += '<rect x="' + (x + 0.5 * P) + '" y="' + (y + 0.6 * P) + '" width="' + (7 * P) + '" height="' + (3.2 * P) + '" rx="3" fill="#0d1a12"/>';
      s += '<g data-live="disp">' + text(x + 4 * P, y + 1.5 * P, "5.00 V", 17, "#7dff9a", { weight: 700 }) + text(x + 4 * P, y + 3 * P, "0.000 A", 13, "#ffb35a", { weight: 600 }) + '</g>';
      s += '<circle cx="' + (x + 2 * P) + '" cy="' + (y + 5.2 * P) + '" r="13" fill="#202326" stroke="#555"/><path d="M' + (x + 2 * P) + ' ' + (y + 5.2 * P) + 'l0 -10" stroke="#ddd" stroke-width="2.5" stroke-linecap="round"/>';
      s += '<circle cx="' + (x + 6 * P) + '" cy="' + (y + 5.2 * P) + '" r="13" fill="#202326" stroke="#555"/><path d="M' + (x + 6 * P) + ' ' + (y + 5.2 * P) + 'l7 -7" stroke="#ddd" stroke-width="2.5" stroke-linecap="round"/>';
      s += text(x + 2 * P, y + 6.6 * P, "VOLTS", 8, "#aab", { weight: 700 }) + text(x + 6 * P, y + 6.6 * P, "AMPS", 8, "#aab", { weight: 700 });
      s += '<circle cx="0" cy="0" r="9" fill="#c62828" stroke="#7a1010" stroke-width="2"/><circle cx="0" cy="0" r="3.5" fill="#e0b84a"/>';
      s += '<circle cx="' + (3 * P) + '" cy="0" r="9" fill="#1e1e1e" stroke="#000" stroke-width="2"/><circle cx="' + (3 * P) + '" cy="0" r="3.5" fill="#e0b84a"/>';
      s += '<g data-live="cc"></g>';
      return s;
    },
    live: function (g, st, pr) {
      if (!g.disp) return;
      var v = (st.v || 0).toFixed(2) + " V", a = Math.abs(st.i || 0).toFixed(3) + " A";
      var t = g.disp.querySelectorAll("text");
      if (t[0].textContent !== v) t[0].textContent = v;
      if (t[1].textContent !== a) t[1].textContent = a;
      t[1].setAttribute("fill", st.cc ? "#ff5a4a" : "#ffb35a");
    }
  });

  /* Hot batteries: a short circuit is the one mistake every class makes. */
  function heatLive(g, st) {
    if (!g.root) return;
    var hot = st.hot || 0;
    g.root.style.filter = hot > 0.05 ? "drop-shadow(0 0 " + Math.round(4 + hot * 14) + "px rgba(255," + Math.round(120 - hot * 80) + ",40," + (0.4 + hot * 0.5).toFixed(2) + "))" : "";
  }
  L.heatLive = heatLive;

  /* =============================================================== PASSIVE */

  add("resistor", {
    name: "Resistor", cat: "Passive",
    blurb: "Slows current down. The coloured stripes spell out its value.",
    pins: [{ n: "1", x: 0, y: 0 }, { n: "2", x: 4 * P, y: 0 }],
    box: { x: 0, y: -0.6 * P, w: 4 * P, h: 1.2 * P },
    props: { ohms: 220, style: "carbon", watts: 0.25 },
    spec: [
      { k: "ohms", label: "Resistance", type: "ohms" },
      { k: "style", label: "Type", type: "select", options: [["carbon", "Carbon film (4 stripes)"], ["metal", "Metal film (5 stripes)"]] },
      { k: "watts", label: "Power rating", type: "select", options: [[0.125, "⅛ W"], [0.25, "¼ W"], [0.5, "½ W"], [1, "1 W"]] }
    ],
    label: function (pr) { return L.si(pr.ohms, "Ω"); },
    art: function (part, pr) {
      var metal = pr.style === "metal";
      var body = metal ? "#7fb0d9" : "#dcc69c", edge = metal ? "#4f7fa8" : "#a8915f";
      var x0 = 0.7 * P, x1 = 3.3 * P, h = 0.42 * P;
      var s = lead(0, 0, x0 + 4, 0) + lead(x1 - 4, 0, 4 * P, 0);
      s += '<path d="M' + x0 + ' ' + (-h) + 'q-4 0 -4 ' + h + 'q0 ' + h + ' 4 ' + h + 'h4q3 -3 8 -3H' + (x1 - 12) + 'q5 0 8 3h4q4 0 4 ' + (-h) + 'q0 ' + (-h) + ' -4 ' + (-h) + 'h-4q-3 3 -8 3H' + (x0 + 12) + 'q-5 0 -8 -3z" fill="' + body + '" stroke="' + edge + '" stroke-width="1.2"/>';
      var bands = L.resistorBands(pr.ohms, metal);
      var xs = metal ? [0.95, 1.3, 1.6, 1.9, 2.9] : [1.0, 1.4, 1.75, 2.85];
      bands.forEach(function (b, i) {
        var bx = xs[i] * P, tall = (i === 0 || i === bands.length - 1);
        s += '<rect x="' + (bx - 2.5) + '" y="' + (tall ? -h : -h + 3) + '" width="5" height="' + (tall ? 2 * h : 2 * h - 6) + '" fill="' + b[1] + '"/>';
      });
      s += '<rect x="' + (x0 - 2) + '" y="' + (-h + 2) + '" width="' + (x1 - x0 + 4) + '" height="3" rx="1.5" fill="#fff" opacity=".35"/>';
      s += '<rect data-live="heat" x="' + (x0 - 3) + '" y="' + (-h - 1) + '" width="' + (x1 - x0 + 6) + '" height="' + (2 * h + 2) + '" rx="6" fill="#ff5a14" opacity="0"/>';
      s += '<g data-live="burnt" opacity="0"><rect x="' + (x0 - 3) + '" y="' + (-h - 1) + '" width="' + (x1 - x0 + 6) + '" height="' + (2 * h + 2) + '" rx="6" fill="#1a120c" opacity=".85"/>' +
           '<path d="M' + (x0 + 8) + ' -2l6 4l5 -5l6 6" stroke="#5a3a20" stroke-width="1.5" fill="none"/></g>';
      return s;
    },
    live: function (g, st) {
      if (g.heat) g.heat.setAttribute("opacity", Math.min(0.75, (st.heat || 0) * 0.8).toFixed(2));
      if (g.burnt) g.burnt.setAttribute("opacity", st.burnt ? 1 : 0);
    },
    glow: function (st) { return st.heat > 0.4 ? [{ x: 2 * P, y: 0, r: 26, c: "#ff6a1a", a: Math.min(0.8, st.heat - 0.3) }] : null; }
  });

  add("potentiometer", {
    name: "Potentiometer", cat: "Passive",
    blurb: "A resistor with a knob. The middle leg slides along it, so it makes any voltage between its ends.",
    pins: [{ n: "1", x: 0, y: 0 }, { n: "W", x: P, y: 0, label: "wiper" }, { n: "2", x: 2 * P, y: 0 }],
    box: { x: -1.4 * P, y: -3.4 * P, w: 4.8 * P, h: 3.9 * P },
    props: { ohms: 10000, pos: 0.5 },
    spec: [
      { k: "ohms", label: "Total resistance", type: "select", options: [[1000, "1 kΩ"], [5000, "5 kΩ"], [10000, "10 kΩ"], [50000, "50 kΩ"], [100000, "100 kΩ"]] },
      { k: "pos", label: "Knob", type: "range", min: 0, max: 1, step: 0.01, live: true, pct: true }
    ],
    knob: "pos",
    label: function (pr) { return L.si(pr.ohms, "Ω"); },
    art: function () {
      var cx = P, cy = -1.9 * P;
      var s = lead(0, 0, 0, -0.6 * P) + lead(P, 0, P, -0.6 * P) + lead(2 * P, 0, 2 * P, -0.6 * P);
      s += shadow(-1.3 * P, -3.4 * P, 4.6 * P, 3 * P, 5);
      s += '<rect x="' + (-1.3 * P) + '" y="' + (-3.4 * P) + '" width="' + (4.6 * P) + '" height="' + (3 * P) + '" rx="5" fill="#2e5fa3" stroke="#1d3f70" stroke-width="1.5"/>';
      s += '<circle cx="' + (cx + 2) + '" cy="' + (cy + 3) + '" r="' + (1.25 * P) + '" fill="#000" opacity=".3"/>';
      s += '<g data-live="knob" transform="rotate(0 ' + cx + ' ' + cy + ')">' +
           '<circle cx="' + cx + '" cy="' + cy + '" r="' + (1.25 * P) + '" fill="#e9ecef" stroke="#9aa3ab" stroke-width="1.5"/>' +
           '<circle cx="' + cx + '" cy="' + cy + '" r="' + (0.9 * P) + '" fill="#d4d9de"/>' +
           '<path d="M' + cx + ' ' + cy + 'V' + (cy - 1.1 * P) + '" stroke="#333" stroke-width="3" stroke-linecap="round"/></g>';
      return s;
    },
    live: function (g, st, pr) {
      if (!g.knob) return;
      var a = -135 + 270 * (pr.pos == null ? 0.5 : pr.pos);
      g.knob.setAttribute("transform", "rotate(" + a.toFixed(1) + " " + P + " " + (-1.9 * P) + ")");
    }
  });

  add("capacitor", {
    name: "Capacitor (ceramic)", cat: "Passive",
    blurb: "Stores a little charge. Small and unpolarised — it can go either way round.",
    pins: [{ n: "1", x: 0, y: 0 }, { n: "2", x: P, y: 0 }],
    box: { x: -0.7 * P, y: -2.2 * P, w: 2.4 * P, h: 2.5 * P },
    props: { farads: 1e-7 },
    spec: [{ k: "farads", label: "Capacitance", type: "select", options: [[1e-9, "1 nF (102)"], [1e-8, "10 nF (103)"], [1e-7, "100 nF (104)"], [1e-6, "1 µF (105)"]] }],
    label: function (pr) { return L.si(pr.farads, "F"); },
    art: function (part, pr) {
      var code = { 1e-9: "102", 1e-8: "103", 1e-7: "104", 1e-6: "105" }[pr.farads] || "104";
      var s = leadPath("M0 0V" + (-0.5 * P) + "L" + (0.3 * P) + " " + (-1 * P)) + leadPath("M" + P + " 0V" + (-0.5 * P) + "L" + (0.7 * P) + " " + (-1 * P));
      s += '<ellipse cx="' + (0.5 * P + 2) + '" cy="' + (-1.45 * P + 3) + '" rx="' + (0.95 * P) + '" ry="' + (0.75 * P) + '" fill="#000" opacity=".25"/>';
      s += '<ellipse cx="' + (0.5 * P) + '" cy="' + (-1.45 * P) + '" rx="' + (0.95 * P) + '" ry="' + (0.75 * P) + '" fill="#d98a2b" stroke="#a35f15" stroke-width="1.2"/>';
      s += '<ellipse cx="' + (0.35 * P) + '" cy="' + (-1.7 * P) + '" rx="' + (0.45 * P) + '" ry="' + (0.25 * P) + '" fill="#fff" opacity=".3"/>';
      s += text(0.5 * P, -1.4 * P, code, 9, "#4a2a08", { weight: 700 });
      return s;
    }
  });

  add("capacitor_e", {
    name: "Capacitor (electrolytic)", cat: "Passive",
    blurb: "Stores a lot of charge. It has a + and a − leg: the stripe marks the − side. Backwards, it can burst.",
    pins: [{ n: "+", x: 0, y: 0 }, { n: "-", x: P, y: 0, label: "−" }],
    box: { x: -0.8 * P, y: -3.2 * P, w: 2.6 * P, h: 3.4 * P },
    props: { farads: 1e-4, vmax: 16 },
    spec: [
      { k: "farads", label: "Capacitance", type: "select", options: [[1e-6, "1 µF"], [1e-5, "10 µF"], [4.7e-5, "47 µF"], [1e-4, "100 µF"], [4.7e-4, "470 µF"], [1e-3, "1000 µF"]] },
      { k: "vmax", label: "Voltage rating", type: "select", options: [[6.3, "6.3 V"], [16, "16 V"], [25, "25 V"], [50, "50 V"]] }
    ],
    label: function (pr) { return L.si(pr.farads, "F"); },
    art: function (part, pr) {
      var x = -0.75 * P, y = -3.1 * P, w = 2.5 * P, h = 2.6 * P;
      var s = lead(0, 0, 0, -0.5 * P) + lead(P, 0, P, -0.5 * P);
      s += shadow(x, y, w, h, 7);
      s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="7" fill="#1f3c8a" stroke="#132457" stroke-width="1.2"/>';
      s += '<rect x="' + (x + w - 0.75 * P) + '" y="' + y + '" width="' + (0.6 * P) + '" height="' + h + '" fill="#b9c6e6"/>';
      [0.3, 0.7, 1.1, 1.5, 1.9].forEach(function (f) { s += text(x + w - 0.45 * P, y + f * P + 4, "−", 9, "#1f3c8a", { weight: 800 }); });
      s += '<rect x="' + (x + 3) + '" y="' + (y + 3) + '" width="' + (w - 6) + '" height="7" rx="3" fill="#c3cad4"/>';
      s += text(x + w * 0.38, y + h * 0.55, L.si(pr.farads, "F", 2).replace(" ", ""), 9, "#fff", { weight: 700, rot: -90 });
      s += '<rect x="' + (x + 4) + '" y="' + (y + 2) + '" width="4" height="' + (h - 4) + '" rx="2" fill="#fff" opacity=".22"/>';
      s += '<g data-live="charge"><rect x="' + (x - 4) + '" y="' + (y + h - 3) + '" width="4" height="0" fill="#ffcf5a"/></g>';
      s += '<g data-live="burst" opacity="0"><path d="M' + (x + 4) + ' ' + (y + 2) + 'l6 -8l4 6l6 -9l3 8l5 -5l2 8" stroke="#9aa" stroke-width="2" fill="#3a3a3a"/></g>';
      return s;
    },
    live: function (g, st) {
      if (g.charge) {
        var f = Math.max(0, Math.min(1, st.fill || 0)), h = 2.6 * P - 6;
        var r = g.charge.firstChild;
        r.setAttribute("y", (-3.1 * P + 3 + h * (1 - f)).toFixed(1));
        r.setAttribute("height", (h * f).toFixed(1));
      }
      if (g.burst) g.burst.setAttribute("opacity", st.burnt ? 1 : 0);
    }
  });

  add("ldr", {
    name: "Light sensor (LDR)", cat: "Sensors",
    blurb: "Its resistance drops as light gets brighter: about 1 MΩ in the dark, about 1 kΩ in sunshine.",
    pins: [{ n: "1", x: 0, y: 0 }, { n: "2", x: P, y: 0 }],
    box: { x: -0.7 * P, y: -2.4 * P, w: 2.4 * P, h: 2.6 * P },
    props: { light: 60 },
    spec: [{ k: "light", label: "Light", type: "range", min: 0, max: 100, step: 1, unit: "%", live: true }],
    env: "light",
    art: function () {
      var cx = 0.5 * P, cy = -1.4 * P;
      var s = lead(0, 0, 0, -0.5 * P) + lead(P, 0, P, -0.5 * P);
      s += '<circle cx="' + (cx + 2) + '" cy="' + (cy + 3) + '" r="' + (0.95 * P) + '" fill="#000" opacity=".25"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (0.95 * P) + '" fill="#f6efe2" stroke="#b9ad97" stroke-width="1.2"/>';
      s += '<path d="M' + (cx - 11) + ' ' + (cy - 8) + 'h20M' + (cx - 11) + ' ' + (cy - 3) + 'h20M' + (cx - 11) + ' ' + (cy + 2) + 'h20M' + (cx - 11) + ' ' + (cy + 7) + 'h20" stroke="#c4672a" stroke-width="2.2"/>';
      s += '<path d="M' + (cx - 11) + ' ' + (cy - 8) + 'v15M' + (cx + 9) + ' ' + (cy - 3) + 'v15" stroke="#c4672a" stroke-width="2.2"/>';
      s += '<circle cx="' + (cx - 5) + '" cy="' + (cy - 6) + '" r="5" fill="#fff" opacity=".5"/>';
      return s;
    }
  });

  add("thermistor", {
    name: "Thermistor (NTC 10k)", cat: "Sensors",
    blurb: "A resistor that drops as it warms up. 10 kΩ at 25 °C.",
    pins: [{ n: "1", x: 0, y: 0 }, { n: "2", x: P, y: 0 }],
    box: { x: -0.6 * P, y: -2 * P, w: 2.2 * P, h: 2.2 * P },
    props: { temp: 25 },
    spec: [{ k: "temp", label: "Temperature", type: "range", min: -10, max: 100, step: 1, unit: "°C", live: true }],
    env: "temp",
    art: function () {
      var s = leadPath("M0 0V" + (-0.6 * P) + "L" + (0.4 * P) + " " + (-1.1 * P)) + leadPath("M" + P + " 0V" + (-0.6 * P) + "L" + (0.6 * P) + " " + (-1.1 * P));
      s += '<ellipse cx="' + (0.5 * P) + '" cy="' + (-1.45 * P) + '" rx="' + (0.55 * P) + '" ry="' + (0.6 * P) + '" fill="#18324f" stroke="#0c1c2e"/>';
      s += '<ellipse cx="' + (0.4 * P) + '" cy="' + (-1.65 * P) + '" rx="4" ry="3" fill="#fff" opacity=".35"/>';
      return s;
    }
  });

  add("diode", {
    name: "Diode (1N4007)", cat: "Semiconductors",
    blurb: "A one-way valve for current. It flows from the plain end to the striped end.",
    pins: [{ n: "A", x: 0, y: 0, label: "anode" }, { n: "K", x: 4 * P, y: 0, label: "cathode" }],
    box: { x: 0, y: -0.5 * P, w: 4 * P, h: 1 * P },
    props: {},
    art: function () {
      var x0 = 1.1 * P, x1 = 2.9 * P, h = 0.36 * P;
      var s = lead(0, 0, x0, 0) + lead(x1, 0, 4 * P, 0);
      s += '<rect x="' + x0 + '" y="' + (-h) + '" width="' + (x1 - x0) + '" height="' + (2 * h) + '" rx="3" fill="#202020"/>';
      s += '<rect x="' + (x1 - 0.45 * P) + '" y="' + (-h) + '" width="' + (0.28 * P) + '" height="' + (2 * h) + '" fill="#c9ced2"/>';
      s += '<rect x="' + (x0 + 2) + '" y="' + (-h + 2) + '" width="' + (x1 - x0 - 4) + '" height="3" rx="1.5" fill="#fff" opacity=".25"/>';
      return s;
    }
  });

  /* LED, standing up off the board, seen from slightly above. */
  add("led", {
    name: "LED", cat: "Lights & sound",
    blurb: "A light that only works one way round: long leg (anode, +) towards the power. Always give it a resistor.",
    pins: [{ n: "A", x: 0, y: 0, label: "anode (+)" }, { n: "K", x: P, y: 0, label: "cathode (−)" }],
    box: { x: -0.7 * P, y: -2.7 * P, w: 2.4 * P, h: 2.9 * P },
    props: { color: "red" },
    spec: [{ k: "color", label: "Colour", type: "select", options: ledOptions }],
    art: function (part, pr) {
      var c = LED_COLORS[pr.color] || LED_COLORS.red, cx = 0.5 * P, cy = -1.65 * P;
      var s = leadPath("M0 0V" + (-0.3 * P) + "l-2 -3V" + (-0.85 * P)) + leadPath("M" + P + " 0V" + (-0.85 * P));
      s += '<ellipse cx="' + (cx + 2) + '" cy="' + (cy + 4) + '" rx="' + (0.98 * P) + '" ry="' + (0.98 * P) + '" fill="#000" opacity=".3"/>';
      s += '<ellipse cx="' + cx + '" cy="' + (cy + 0.55 * P) + '" rx="' + (1.08 * P) + '" ry="' + (0.38 * P) + '" fill="' + c.fill + '" opacity=".9"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (0.95 * P) + '" fill="' + c.fill + '" opacity=".78"/>';
      s += '<path d="M' + (cx + 0.95 * P) + ' ' + (cy - 0.6 * P) + 'V' + (cy + 0.6 * P) + '" stroke="' + c.fill + '" stroke-width="3" opacity=".9"/>';
      s += '<path d="M' + (cx - 4) + ' ' + (cy + 6) + 'v-7h5l3 4" stroke="#8a8f94" stroke-width="2" fill="none"/>';
      s += '<circle data-live="core" cx="' + cx + '" cy="' + cy + '" r="' + (0.62 * P) + '" fill="' + c.light + '" opacity="0"/>';
      s += '<ellipse cx="' + (cx - 5) + '" cy="' + (cy - 7) + '" rx="5" ry="7" fill="#fff" opacity=".5" transform="rotate(-25 ' + (cx - 5) + ' ' + (cy - 7) + ')"/>';
      s += '<g data-live="burnt" opacity="0"><circle cx="' + cx + '" cy="' + cy + '" r="' + (0.95 * P) + '" fill="#2b2420" opacity=".85"/>' +
           '<path d="M' + (cx - 6) + ' ' + (cy - 3) + 'l5 4l4 -6l4 5" stroke="#000" stroke-width="1.6" fill="none"/></g>';
      return s;
    },
    live: function (g, st) {
      if (g.core) g.core.setAttribute("opacity", Math.min(1, (st.b || 0) * 1.1).toFixed(2));
      if (g.burnt) g.burnt.setAttribute("opacity", st.burnt ? 1 : 0);
    },
    glow: function (st, pr) {
      if (!(st.b > 0.01)) return null;
      var c = LED_COLORS[pr.color] || LED_COLORS.red;
      return [{ x: 0.5 * P, y: -1.65 * P, r: 22 + 46 * Math.min(1, st.b), c: c.light, a: Math.min(1, 0.25 + st.b) }];
    }
  });

  add("rgb_led", {
    name: "RGB LED", cat: "Lights & sound",
    blurb: "Three LEDs in one dome — red, green and blue — sharing the long cathode leg. Mix them for any colour.",
    pins: [{ n: "R", x: 0, y: 0, label: "red" }, { n: "K", x: P, y: 0, label: "common cathode (−)" }, { n: "G", x: 2 * P, y: 0, label: "green" }, { n: "B", x: 3 * P, y: 0, label: "blue" }],
    box: { x: 0, y: -3 * P, w: 3 * P, h: 3.2 * P },
    props: {},
    art: function () {
      var cx = 1.5 * P, cy = -1.9 * P;
      var s = leadPath("M0 0V" + (-0.4 * P) + "L" + (cx - 9) + " " + (-1 * P)) + leadPath("M" + P + " 0V" + (-1 * P)) +
              leadPath("M" + 2 * P + " 0V" + (-0.4 * P) + "L" + (cx + 4) + " " + (-1 * P)) + leadPath("M" + 3 * P + " 0V" + (-0.4 * P) + "L" + (cx + 9) + " " + (-1 * P));
      s += '<circle cx="' + (cx + 2) + '" cy="' + (cy + 4) + '" r="' + (1.05 * P) + '" fill="#000" opacity=".3"/>';
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (1.05 * P) + '" fill="#eef2f6" opacity=".85" stroke="#c9d1d8"/>';
      s += '<circle data-live="core" cx="' + cx + '" cy="' + cy + '" r="' + (0.75 * P) + '" fill="#fff" opacity="0"/>';
      s += '<ellipse cx="' + (cx - 6) + '" cy="' + (cy - 8) + '" rx="5" ry="8" fill="#fff" opacity=".55" transform="rotate(-25 ' + (cx - 6) + ' ' + (cy - 8) + ')"/>';
      return s;
    },
    live: function (g, st) {
      if (!g.core) return;
      var r = st.r || 0, gg = st.g || 0, b = st.bl || 0, m = Math.max(r, gg, b);
      g.core.setAttribute("opacity", Math.min(1, m * 1.1).toFixed(2));
      if (m > 0) g.core.setAttribute("fill", "rgb(" + Math.round(255 * r / m) + "," + Math.round(255 * gg / m) + "," + Math.round(255 * b / m) + ")");
    },
    glow: function (st) {
      var r = st.r || 0, gg = st.g || 0, b = st.bl || 0, m = Math.max(r, gg, b);
      if (m < 0.01) return null;
      return [{ x: 1.5 * P, y: -1.9 * P, r: 24 + 46 * m, c: "rgb(" + Math.round(255 * r / m) + "," + Math.round(255 * gg / m) + "," + Math.round(255 * b / m) + ")", a: Math.min(1, 0.3 + m) }];
    }
  });
})(typeof window !== "undefined" ? window : globalThis);
