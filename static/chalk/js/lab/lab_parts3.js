/* Chalk Circuit Lab — the advanced drawer.
 *
 * Water: a water-level stick, a rain plate, a float switch, a flow meter
 * that ticks as water passes, a 5 V pump and a 12 V solenoid valve.
 *
 * Sensors: temperature + humidity (DHT11/DHT22), a joystick, a rotary
 * encoder, a touch pad, a heartbeat sensor, a 3-axis accelerometer, a
 * current sensor, a voltage divider module, force and flex sensors, a UV
 * sensor, and three more of the four-pin kit modules (magnet, vibration,
 * line tracker).
 *
 * Advanced: an L298N motor driver, a 28BYJ-48 stepper on its ULN2003
 * board, a 74HC595 shift register, an MCP3008 ADC (so a Raspberry Pi can
 * read analog sensors), a PC817 optocoupler, voltage regulators, a NeoPixel
 * ring and a solar panel.
 *
 * Each part is drawn here and its physics lives here too, built from the
 * simulator's own primitives (L.SimKit), so nothing is faked: the pump runs
 * because current flows through it, the regulator heats up because volts
 * are being thrown away across it, the stepper turns only when the coil
 * pattern really steps.
 *
 * The parts that talk in a protocol rather than a voltage are looked up by
 * wiring, the way the HC-SR04 and the I²C screen already are:
 *   sim.dhtFor(boardId, pin)     a powered DHT whose DATA is on that pin
 *   sim.neoOn(node)              the colours a board last show()ed on that node
 *   sim.adcFor(piId, ce)         an MCP3008 wired to a Pi's SPI pins
 *   sim.pinChange(id, pin, lvl)  a program switched a pin between two solves
 *                                (how a 74HC595 sees a clock edge that is over
 *                                in microseconds)
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var P = L.P, add = L.addPart, S = L.svg, text = S.text, lead = S.lead, leadPath = S.leadPath, shadow = S.shadow;
  var MODELS = L.MODELS, Sim = L.Sim, K = L.SimKit;
  var Rr = K.R, Vs = K.Vs, setV = K.setV, setR = K.setR, setSw = K.setSw, vAcross = K.vAcross, iThrough = K.iThrough, smooth = K.smooth, warn = K.warn;
  var clamp = L.clamp;

  /* ============================================================ HELPERS */

  function dtOf(ctx) { return ctx.dt > 0 && isFinite(ctx.dt) ? ctx.dt : 0.016; }
  function off(dev) { setR(dev, 1e8); }
  function rect(x, y, w, h, rx, fill, extra) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (rx || 0) + '" fill="' + fill + '"' + (extra || "") + '/>'; }
  function board(x, y, w, h, fill, edge) { return shadow(x, y, w, h, 4) + rect(x, y, w, h, 4, fill, ' stroke="' + edge + '" stroke-width="1.5"'); }
  /* header pins along y=0, labels turned up the board */
  function header(names, col, start) {
    var s = "";
    names.forEach(function (nm, i) {
      var x = (start || 0) + i * P;
      s += lead(x, 0, x, -0.5 * P) + text(x, -0.95 * P, nm, 6, col || "#dfe9ff", { rot: -90 });
    });
    return s;
  }
  function ledG(name, x, y, r, offFill) { return '<g data-live="' + name + '"><circle cx="' + x + '" cy="' + y + '" r="' + (r || 3.5) + '" fill="' + (offFill || "#5a1a1a") + '"/></g>'; }
  function screw(x, y) { return '<circle cx="' + x + '" cy="' + y + '" r="7" fill="#c9ced3" stroke="#7d858b" stroke-width="1.5"/><path d="M' + (x - 4.5) + ' ' + y + 'h9" stroke="#5f666d" stroke-width="2"/>'; }
  function terminal(x, y, w, h, screws) {
    var s = rect(x, y, w, h, 2, "#2f6fd1", ' stroke="#1d4a8c" stroke-width="1.5"');
    screws.forEach(function (sx) { s += screw(sx, y + h / 2); });
    return s;
  }
  function setText(g, t) { if (g && g.firstChild && g.firstChild.textContent !== t) g.firstChild.textContent = t; }
  function powered(ctx, dev, need) { return vAcross(ctx, dev) > (need || 2.5); }

  /* ================================================================ WATER */

  /* --- Water level sensor: the red stick with ten bare traces. The more of
   * them water covers, the better it conducts and the higher S reads. */
  var WL = { x: -1.2 * P, top: -12 * P, bot: -4.5 * P, w: 4.4 * P };
  add("water_level", {
    name: "Water level sensor", cat: "Water",
    blurb: "Stand it in water: the deeper it goes, the higher S reads (0 dry, about 700 at 4 cm on an Arduino). Power it only when you read it — bare traces corrode.",
    pins: [{ n: "S", x: 0, y: 0, label: "signal" }, { n: "+", x: P, y: 0 }, { n: "-", x: 2 * P, y: 0 }],
    box: { x: -1.4 * P, y: -12.8 * P, w: 4.8 * P, h: 13.4 * P },
    props: { depth: 0 },
    spec: [{ k: "depth", label: "Water depth", type: "range", min: 0, max: 40, step: 1, unit: "mm", live: true }],
    art: function () {
      var s = header(["S", "+", "-"], "#ffe2dc");
      s += board(WL.x, -12.6 * P, WL.w, 12.2 * P, "#c0262d", "#7d1419");
      var d = "", i, xs = [];
      for (i = 0; i < 10; i++) xs.push(WL.x + 0.45 * P + i * 0.39 * P);
      xs.forEach(function (x, j) { d += "M" + x.toFixed(1) + " " + (j % 2 ? WL.top + 0.4 * P : WL.top) + "V" + (j % 2 ? WL.bot : WL.bot - 0.4 * P); });
      s += '<path d="M' + xs[0] + ' ' + WL.top + 'H' + xs[9] + 'M' + xs[0] + ' ' + WL.bot + 'H' + xs[9] + '" stroke="#d9b45a" stroke-width="2.4"/>';
      s += '<path d="' + d + '" stroke="#e7c76a" stroke-width="2.2" fill="none"/>';
      s += '<rect data-live="water" x="' + WL.x + '" y="' + WL.bot + '" width="' + WL.w + '" height="0" fill="#3a9be8" opacity=".5"/>';
      s += text(P, -3.1 * P, "WATER", 8, "#ffe2dc", { weight: 800 }) + text(P, -2.2 * P, "SENSOR", 7, "#ffe2dc", { weight: 700 });
      s += ledG("led", 2.6 * P, -1.4 * P, 3, "#5a1a1a");
      return s;
    },
    live: function (g, st, pr) {
      if (g.water) {
        var h = (WL.bot - WL.top) * clamp(pr.depth || 0, 0, 40) / 40;
        g.water.setAttribute("y", (WL.bot - h).toFixed(1)); g.water.setAttribute("height", h.toFixed(1));
      }
      L.setFill(g.led, st.on ? "#ff4a3a" : "#5a1a1a");
    }
  });
  MODELS.water_level = {
    build: function (b) { return { pwr: Rr(b, "+", "-", 2e4), out: Vs(b, "S", "-", 0, 2000) }; },
    pre: function (m, ctx) {
      var v = vAcross(ctx, m.pwr), on = v > 2.5;
      ctx.st.on = on;
      if (!on) { off(m.out); return; }
      var d = clamp(ctx.props.depth || 0, 0, 40);
      setV(m.out, v * 0.68 * (1 - Math.exp(-d / 14)) / (1 - Math.exp(-40 / 14)), 2000);
    },
    post: function () {}
  };

  /* --- The four-pin kit modules: VCC GND DO AO, a trimmer and a red LED.
   * What sits on top is the only difference. */
  var MOD = {
    rain: { name: "Rain sensor", cat: "Water", label: "Rain on the plate", tall: true,
      blurb: "The plate's comb of traces conducts when raindrops bridge it. AO drops as it gets wetter; DO goes LOW (and the LED lights) past the threshold.",
      curve: function (f) { return 1 - 0.8 * f; } },
    hall: { name: "Hall magnet sensor", cat: "Sensors", label: "Magnet nearby",
      blurb: "Feels a magnetic field. Bring a magnet close and DO goes LOW; AO follows how strong the field is. Count wheel turns, spot a closed door.",
      curve: function (f) { return 0.5 + 0.4 * f; } },
    vibe: { name: "Vibration sensor (SW-420)", cat: "Sensors", label: "Shaking", high: true,
      blurb: "A tiny spring switch. Knock or shake it and DO goes HIGH for as long as it rattles. Earthquake alarms, knock locks, washing-machine done.",
      curve: function (f) { return f < 0.02 ? 0.02 : (0.1 + 0.8 * f) * (0.55 + 0.45 * Math.random()); } },
    line: { name: "Line tracker (TCRT5000)", cat: "Sensors", label: "Black line under it", high: true,
      blurb: "Shines infrared at the floor and watches the bounce. White floor reflects (DO LOW); black tape swallows the light (DO HIGH). Two of these steer a line-following robot.",
      curve: function (f) { return 0.1 + 0.8 * f; } }
  };
  function modArt(kind) {
    return function (part, pr) {
      var x = -0.6 * P, y = -4 * P, w = 4.2 * P, h = 3.6 * P, s = "";
      [0, 1, 2, 3].forEach(function (i) { s += lead(i * P, 0, i * P, -0.5 * P); });
      s += shadow(x, y, w, h, 3) + rect(x, y, w, h, 3, "#1b4fa0", ' stroke="#123673"');
      s += rect(x + 0.4 * P, y + 0.4 * P, 1.2 * P, 1.2 * P, 0, "#2a6fe0", ' stroke="#174ba8"') + '<circle cx="' + (x + P) + '" cy="' + (y + P) + '" r="5" fill="#ddd"/><path d="M' + (x + P) + ' ' + (y + P) + 'l3 -3" stroke="#333" stroke-width="1.5"/>';
      s += text(0, -0.9 * P, "VCC", 6, "#dfe9ff", { rot: -90 }) + text(P, -0.9 * P, "GND", 6, "#dfe9ff", { rot: -90 }) + text(2 * P, -0.9 * P, "DO", 6, "#dfe9ff", { rot: -90 }) + text(3 * P, -0.9 * P, "AO", 6, "#dfe9ff", { rot: -90 });
      s += ledG("led", x + 3.6 * P, y + 0.6 * P);
      var tx = x + 2.6 * P, ty = y;
      if (kind === "rain") {
        /* the plate, on two wires above the module */
        var px = -1.6 * P, py = -12.6 * P, pw = 6.2 * P, ph = 6.4 * P, d = "";
        s += leadPath("M" + (tx - 5) + " " + ty + "V" + (py + ph)) + leadPath("M" + (tx + 7) + " " + ty + "V" + (py + ph));
        s += shadow(px, py, pw, ph, 3) + rect(px, py, pw, ph, 3, "#1f2a24", ' stroke="#0d1310"');
        for (var i = 0; i < 9; i++) {
          var yy = py + 0.6 * P + i * 0.62 * P;
          d += i % 2 ? "M" + (px + 0.5 * P) + " " + yy + "H" + (px + pw - 1.1 * P) : "M" + (px + 1.1 * P) + " " + yy + "H" + (px + pw - 0.5 * P);
        }
        d += "M" + (px + 0.5 * P) + " " + (py + 0.6 * P) + "V" + (py + 0.6 * P + 8 * 0.62 * P) + "M" + (px + pw - 0.5 * P) + " " + (py + 0.6 * P) + "V" + (py + 0.6 * P + 8 * 0.62 * P);
        s += '<path d="' + d + '" stroke="#d6b25a" stroke-width="2.2" fill="none"/>';
        s += '<g data-live="drops" opacity="0">';
        [[0.3, 0.2], [0.65, 0.35], [0.2, 0.6], [0.55, 0.72], [0.8, 0.55], [0.42, 0.9]].forEach(function (q) {
          var cx = px + pw * q[0], cy = py + ph * q[1];
          s += '<path d="M' + cx + ' ' + (cy - 7) + 'q5 7 0 11q-5 -4 0 -11z" fill="#7cc4ff" stroke="#3a8ad8" stroke-width=".8"/>';
        });
        s += '</g>';
      } else if (kind === "hall") {
        s += leadPath("M" + (tx - 6) + " " + ty + "v-" + (0.7 * P)) + leadPath("M" + tx + " " + ty + "v-" + (0.7 * P)) + leadPath("M" + (tx + 6) + " " + ty + "v-" + (0.7 * P));
        s += rect(tx - 9, ty - 1.6 * P, 18, 0.9 * P, 2, "#1d1d1f") + text(tx, ty - 1.15 * P, "49E", 6, "#bbb", { weight: 700 });
        s += '<g data-live="mag" opacity="0">' + rect(tx - 14, ty - 3.2 * P, 28, 1.1 * P, 2, "#c83030") + rect(tx, ty - 3.2 * P, 14, 1.1 * P, 2, "#3058c8") + text(tx - 7, ty - 2.65 * P, "N", 7, "#fff", { weight: 800 }) + text(tx + 7, ty - 2.65 * P, "S", 7, "#fff", { weight: 800 }) + '</g>';
      } else if (kind === "vibe") {
        s += '<g data-live="can">' + rect(tx - 9, ty - 2.1 * P, 18, 2.1 * P, 4, "#c3c9ce", ' stroke="#7d858b" stroke-width="1.5"') + '<path d="M' + (tx - 6) + ' ' + (ty - 1.6 * P) + 'q3 4 6 0t6 0" stroke="#5f666d" stroke-width="1.4" fill="none"/></g>';
      } else if (kind === "line") {
        s += rect(tx - 13, ty - 1.6 * P, 26, 1.6 * P, 2, "#1d1d1f");
        s += '<circle cx="' + (tx - 6) + '" cy="' + (ty - 0.8 * P) + '" r="5" fill="#3a6fd8"/><circle cx="' + (tx + 6) + '" cy="' + (ty - 0.8 * P) + '" r="5" fill="#141414" stroke="#444"/>';
        s += '<g data-live="tape" opacity="0">' + rect(tx - 24, ty - 3 * P, 48, 0.9 * P, 1, "#111") + '</g>';
      }
      return s;
    };
  }
  Object.keys(MOD).forEach(function (k) {
    var md = MOD[k];
    add("mod_" + k, {
      name: md.name, cat: md.cat, blurb: md.blurb, module: k,
      pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: P, y: 0 }, { n: "DO", x: 2 * P, y: 0, label: "digital out" }, { n: "AO", x: 3 * P, y: 0, label: "analog out" }],
      box: md.tall ? { x: -1.8 * P, y: -12.8 * P, w: 6.6 * P, h: 13 * P } : { x: -0.6 * P, y: -7.6 * P, w: 4.2 * P, h: 7.8 * P },
      props: { level: k === "line" ? 0 : 30, threshold: 60 },
      spec: [
        { k: "level", label: md.label, type: "range", min: 0, max: 100, step: 1, unit: "%", live: true },
        { k: "threshold", label: "DO trips at", type: "range", min: 0, max: 100, step: 1, unit: "%", live: true }
      ],
      art: modArt(k),
      live: function (g, st, pr) {
        L.setFill(g.led, st.d ? "#ff4a3a" : "#5a1a1a");
        var f = clamp(pr.level || 0, 0, 100) / 100;
        if (g.drops) g.drops.setAttribute("opacity", (f * 0.95).toFixed(2));
        if (g.mag) g.mag.setAttribute("opacity", (0.15 + f * 0.85).toFixed(2));
        if (g.tape) g.tape.setAttribute("opacity", f.toFixed(2));
        if (g.can) g.can.setAttribute("transform", st.d ? "translate(" + (Math.random() * 4 - 2).toFixed(1) + " 0)" : "");
      },
      glow: function (st) { return st.d ? [{ x: 3 * P, y: -3.4 * P, r: 10, c: "#ff4a3a", a: 0.7 }] : null; }
    });
    MODELS["mod_" + k] = {
      dynamic: k === "vibe",
      build: function (b) { return { pwr: Rr(b, "VCC", "GND", 1000), ao: Vs(b, "AO", "GND", 0, 1000), dout: Vs(b, "DO", "GND", 0, 1000) }; },
      pre: function (m, ctx) {
        var v = vAcross(ctx, m.pwr);
        if (v < 2.5) { off(m.ao); off(m.dout); ctx.st.d = false; return; }
        var f = clamp(ctx.props.level, 0, 100) / 100, trip = ctx.props.level >= ctx.props.threshold;
        setV(m.ao, v * md.curve(f), 1000);
        setV(m.dout, (md.high ? trip : !trip) ? v : 0, 1000);
        ctx.st.d = trip;
      },
      post: function () {}
    };
  });

  /* --- Float switch: a magnet in the float closes a reed switch in the stem. */
  add("float_switch", {
    name: "Float switch", cat: "Water",
    blurb: "A float on a stem. When the water lifts it, the switch inside closes. Wire it like a button (INPUT_PULLUP) to know when a tank is full.",
    pins: [{ n: "1", x: 0, y: 0 }, { n: "2", x: P, y: 0 }],
    box: { x: -1.8 * P, y: -9.4 * P, w: 4.6 * P, h: 10 * P },
    props: { water: false },
    toggle: "water",
    spec: [{ k: "water", label: "Water has lifted the float", type: "bool", live: true }],
    art: function () {
      var cx = 0.5 * P, s = "";
      s += leadPath("M0 0V" + (-0.8 * P) + "L" + (cx - 3) + " " + (-1.6 * P)) + leadPath("M" + P + " 0V" + (-0.8 * P) + "L" + (cx + 3) + " " + (-1.6 * P));
      s += '<g data-live="water" opacity="0">' + rect(-1.8 * P, -7.4 * P, 4.6 * P, 5.6 * P, 3, "#3a9be8", ' opacity=".35"') + '<path d="M' + (-1.8 * P) + ' ' + (-7.4 * P) + 'q' + (0.6 * P) + ' -5 ' + (1.15 * P) + ' 0t' + (1.15 * P) + ' 0t' + (1.15 * P) + ' 0t' + (1.15 * P) + ' 0" stroke="#7cc4ff" stroke-width="2" fill="none"/></g>';
      s += rect(cx - 3.5, -9 * P, 7, 7.4 * P, 2, "#d3d8dc", ' stroke="#8a9196"');
      s += rect(cx - 9, -9.3 * P, 18, 0.7 * P, 2, "#9aa1a6") + rect(cx - 8, -1.9 * P, 16, 0.5 * P, 2, "#9aa1a6");
      s += '<g data-live="float">' + rect(cx - 1.4 * P, -4.2 * P, 2.8 * P, 2.2 * P, 7, "#f4f4f0", ' stroke="#bfbfb6" stroke-width="1.5"') + rect(cx - 1.4 * P, -3.4 * P, 2.8 * P, 0.4 * P, 0, "#ddddd4") + '</g>';
      return s;
    },
    live: function (g, st, pr) {
      if (g.water) g.water.setAttribute("opacity", pr.water ? 1 : 0);
      if (g.float) g.float.setAttribute("transform", pr.water ? "translate(0 " + (-2.6 * P) + ")" : "");
    }
  });
  MODELS.float_switch = {
    build: function (b) { return { sw: Rr(b, "1", "2", 1e10) }; },
    pre: function (m, ctx) { setSw(m.sw, !!ctx.props.water); },
    post: function () {}
  };

  /* --- Flow meter (YF-S201): a turbine with a magnet on it, a hall sensor
   * outside. Every turn is a pulse: 7.5 pulses a second per litre a minute. */
  var FLOW = { cx: P, cy: -3.6 * P };
  add("flow_sensor", {
    name: "Water flow meter (YF-S201)", cat: "Water",
    blurb: "Water spins a little turbine and SIG pulses once per turn: about 7.5 pulses a second for every litre per minute. Count them with attachInterrupt().",
    pins: [{ n: "VCC", x: 0, y: 0, label: "VCC (red)" }, { n: "GND", x: P, y: 0, label: "GND (black)" }, { n: "SIG", x: 2 * P, y: 0, label: "pulses (yellow)" }],
    box: { x: -4.8 * P, y: -6.4 * P, w: 11.6 * P, h: 7 * P },
    props: { flow: 0 },
    spec: [{ k: "flow", label: "Water flowing", type: "range", min: 0, max: 30, step: 0.5, unit: "L/min", live: true }],
    art: function () {
      var s = "", x = -3 * P, y = -5.6 * P, w = 8 * P, h = 4 * P;
      [["#d43a2f", 0], ["#2a2a2c", P], ["#e8c22a", 2 * P]].forEach(function (c) { s += '<path d="M' + c[1] + ' 0V' + (y + h) + '" stroke="' + c[0] + '" stroke-width="4" stroke-linecap="round"/>'; });
      [[-4.6 * P, 1.6 * P], [5 * P, 1.6 * P]].forEach(function (e) {
        s += rect(e[0], y + 0.6 * P, e[1], h - 1.2 * P, 2, "#c9a03c", ' stroke="#8a6a1c" stroke-width="1.5"');
        for (var i = 1; i < 5; i++) s += '<path d="M' + (e[0] + i * e[1] / 5) + ' ' + (y + 0.6 * P) + 'v' + (h - 1.2 * P) + '" stroke="#8a6a1c" stroke-width="1"/>';
      });
      s += shadow(x, y, w, h, 6) + rect(x, y, w, h, 6, "#1d1d1f", ' stroke="#000"');
      s += '<circle cx="' + FLOW.cx + '" cy="' + FLOW.cy + '" r="' + (1.6 * P) + '" fill="#2b3a44" stroke="#555" stroke-width="2"/>';
      s += '<circle data-live="wet" cx="' + FLOW.cx + '" cy="' + FLOW.cy + '" r="' + (1.5 * P) + '" fill="#3a9be8" opacity="0"/>';
      s += '<g data-live="imp">';
      for (var b = 0; b < 6; b++) s += '<path d="M' + FLOW.cx + ' ' + FLOW.cy + 'l' + (1.3 * P) + ' -6l0 8z" fill="#e8e8e0" transform="rotate(' + b * 60 + ' ' + FLOW.cx + ' ' + FLOW.cy + ')"/>';
      s += '<circle cx="' + FLOW.cx + '" cy="' + FLOW.cy + '" r="4" fill="#888"/></g>';
      s += text(x + 1.2 * P, y + 0.8 * P, "YF-S201", 7, "#aaa", { weight: 700, anchor: "start" }) + text(x + w - 1.1 * P, y + 2 * P, "→", 18, "#7cc4ff", { weight: 700 });
      s += '<g data-live="rate">' + text(FLOW.cx, y - 0.7 * P, "", 8, "#7cc4ff", { weight: 700 }) + '</g>';
      return s;
    },
    live: function (g, st, pr) {
      if (g.imp) g.imp.setAttribute("transform", "rotate(" + ((st.ang || 0) % 360).toFixed(1) + " " + FLOW.cx + " " + FLOW.cy + ")");
      if (g.wet) g.wet.setAttribute("opacity", pr.flow > 0 ? 0.55 : 0);
      setText(g.rate, pr.flow > 0 ? pr.flow + " L/min" : "");
    }
  });
  MODELS.flow_sensor = {
    dynamic: true,
    build: function (b) { return { pwr: Rr(b, "VCC", "GND", 330), sig: Vs(b, "SIG", "GND", 0, 1000), ph: 0 }; },
    pre: function (m, ctx) {
      var v = vAcross(ctx, m.pwr), q = clamp(ctx.props.flow || 0, 0, 30);
      m.ph += 7.5 * q * dtOf(ctx);
      ctx.st.ang = (m.ph * 360) % 3600;
      if (v < 3) { off(m.sig); return; }
      setV(m.sig, (m.ph % 1) < 0.5 ? v : 0, 1000);
    },
    post: function () {},
    reset: function (m) { m.ph = 0; }
  };

  /* --- 5 V submersible pump: a little DC motor that pushes water. */
  add("water_pump", {
    name: "Water pump (3–6 V)", cat: "Water",
    blurb: "A submersible pump: about 200 mA at 5 V. Far too much for an Arduino pin, so switch it with a MOSFET, transistor or relay — and put a diode across it.",
    pins: [{ n: "+", x: 0, y: 0, label: "+ (red)" }, { n: "-", x: P, y: 0, label: "− (black)" }],
    box: { x: -2.4 * P, y: -12.2 * P, w: 11 * P, h: 12.8 * P },
    props: {},
    art: function () {
      var s = "", tx = -2.2 * P, ty = -9.4 * P, tw = 7 * P, th = 8.2 * P;
      s += '<path d="M0 0V' + (-2.6 * P) + '" stroke="#d43a2f" stroke-width="4" stroke-linecap="round"/><path d="M' + P + ' 0V' + (-2.6 * P) + '" stroke="#2a2a2c" stroke-width="4" stroke-linecap="round"/>';
      s += rect(tx, ty, tw, th, 4, "#dfeefb", ' opacity=".55" stroke="#9fb7cc" stroke-width="2"');
      s += rect(tx + 2, ty + th * 0.35, tw - 4, th * 0.65 - 2, 3, "#3a9be8", ' opacity=".45"');
      s += rect(-1 * P, -6.4 * P, 3 * P, 3.8 * P, 8, "#20242a", ' stroke="#000"') + rect(-0.8 * P, -4.2 * P, 2.6 * P, 1.2 * P, 3, "#3a3f45");
      s += text(0.5 * P, -5.4 * P, "PUMP", 7, "#9fb7cc", { weight: 800 });
      s += '<path d="M' + (0.5 * P) + ' ' + (-6.4 * P) + 'V' + (-10.6 * P) + 'H' + (6.4 * P) + 'V' + (-9 * P) + '" stroke="#e9e9e9" stroke-width="7" fill="none" stroke-linejoin="round" opacity=".9"/>';
      s += '<path data-live="jet" d="M' + (6.4 * P) + ' ' + (-9 * P) + 'q' + (0.8 * P) + ' ' + (3 * P) + ' ' + (1.6 * P) + ' ' + (8 * P) + '" stroke="#3a9be8" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="7 5" opacity="0"/>';
      return s;
    },
    live: function (g, st) {
      if (!g.jet) return;
      var f = Math.abs(st.flow || 0);
      g.jet.setAttribute("opacity", f > 0.08 ? Math.min(1, f).toFixed(2) : 0);
      g.jet.setAttribute("stroke-dashoffset", (-(st.ph || 0) * 60 % 120).toFixed(1));
    }
  });
  MODELS.water_pump = {
    dynamic: true,
    build: function (b) { return { r: Rr(b, "+", "-", 22), w: 0, ph: 0 }; },
    pre: function () {},
    post: function (m, ctx) {
      var i = iThrough(m.r), v = vAcross(ctx, m.r), dt = dtOf(ctx);
      var want = clamp(i / 0.2, -1.5, 1.5);
      if (Math.abs(i) < 0.04) want = 0;                         /* not enough to turn the impeller */
      m.w += (want - m.w) * Math.min(1, dt * 5);
      m.ph += m.w * dt;
      ctx.st.flow = m.w; ctx.st.ph = m.ph; ctx.st.i = i;
      if (v > 7.5) warn(ctx, "danger", "over", "The pump has " + v.toFixed(1) + " V across it. It is made for 3–6 V and will overheat.");
      if (v < -1) warn(ctx, "info", "back", "The pump is wired backwards: it is barely pushing water. Swap + and −.");
    },
    reset: function (m) { m.w = 0; m.ph = 0; }
  };

  /* --- 12 V solenoid valve: a coil that lifts a plunger and lets water by. */
  add("solenoid_valve", {
    name: "Solenoid valve (12 V)", cat: "Water",
    blurb: "A coil pulls a plunger and the water goes through. 12 V, about 400 mA. It is a coil, so it kicks back when switched off — put a diode across it.",
    pins: [{ n: "+", x: 0, y: 0 }, { n: "-", x: P, y: 0 }],
    box: { x: -3.8 * P, y: -9.2 * P, w: 9.6 * P, h: 9.8 * P },
    props: {},
    art: function () {
      var s = "";
      s += lead(0, 0, 0, -2 * P) + lead(P, 0, P, -2 * P);
      [-3.6 * P, 4.2 * P].forEach(function (x) { s += rect(x, -4.4 * P, 1.4 * P, 2.6 * P, 2, "#c9a03c", ' stroke="#8a6a1c" stroke-width="1.5"'); });
      s += shadow(-2.4 * P, -4 * P, 6.8 * P, 1.8 * P, 3) + rect(-2.4 * P, -4 * P, 6.8 * P, 1.8 * P, 3, "#d4ad4a", ' stroke="#8a6a1c" stroke-width="1.5"');
      s += '<rect data-live="flow" x="' + (-3.4 * P) + '" y="' + (-3.6 * P) + '" width="' + (8.4 * P) + '" height="' + P + '" fill="#3a9be8" opacity="0"/>';
      s += rect(-3.4 * P, -3.6 * P, 3.4 * P, P, 0, "#3a9be8", ' opacity=".45"');
      s += shadow(-1 * P, -8.8 * P, 3 * P, 4.8 * P, 3) + rect(-1 * P, -8.8 * P, 3 * P, 4.8 * P, 3, "#1d1d1f", ' stroke="#000"');
      s += text(0.5 * P, -7.4 * P, "12V", 9, "#bbb", { weight: 800 }) + text(0.5 * P, -6.2 * P, "DC", 7, "#888", { weight: 700 });
      s += '<g data-live="open" opacity="0">' + text(0.5 * P, -5 * P, "OPEN", 7, "#7cc4ff", { weight: 800 }) + '</g>';
      return s;
    },
    live: function (g, st) {
      if (g.flow) g.flow.setAttribute("opacity", st.on ? 0.6 : 0);
      if (g.open) g.open.setAttribute("opacity", st.on ? 1 : 0);
    }
  });
  MODELS.solenoid_valve = {
    dynamic: true,
    build: function (b) {
      var mid = b.node("c");
      return { r: Rr(b, "+", mid, 30), l: b.add(new K.Ind(0.08), [mid, "-"]), par: Rr(b, "+", "-", 8000), on: false };
    },
    pre: function (m, ctx) { m.l.dt = ctx.dt; },
    post: function (m, ctx) {
      var i = Math.abs(m.l.cur[0]), v = vAcross(ctx, m.par);
      var want = m.on ? i > 0.12 : i > 0.25;
      if (want !== m.on) { m.on = want; ctx.sim.event(ctx.part.id, "click"); }
      ctx.st.on = m.on;
      if (!m.on && v > 1 && v < 9) warn(ctx, "info", "low", "The valve has " + v.toFixed(1) + " V. It needs about 12 V to lift its plunger.");
      var before = Math.abs(m.l.iL);
      if (before > 0.05 && i < before * 0.3) {
        ctx.sim.kick(m.par.n[0], before * 8000); ctx.sim.kick(m.par.n[1], before * 8000);
        ctx.sim.event(ctx.part.id, "spark");
        m.kickT = 1.5; m.kickV = before * 8000;
      }
      if (m.kickT > 0) {
        m.kickT -= dtOf(ctx);
        warn(ctx, "danger", "kickback", "The valve's coil kicked back about " + L.si(m.kickV || 1000, "V", 2) + " when it switched off. Put a diode across it (stripe to +).");
      }
    },
    commit: function (m) { m.l.commit(); },
    reset: function (m) { m.l.iL = 0; m.on = false; }
  };

  /* ============================================================== SENSORS */

  /* --- DHT11 / DHT22: temperature and humidity over one data wire. */
  add("dht", {
    name: "Temperature & humidity (DHT11)", cat: "Sensors",
    blurb: "Temperature and humidity on one wire. #include <DHT.h>, then dht.readTemperature() and dht.readHumidity(). On a Pi: adafruit_dht. A reading takes a moment — ask once every two seconds.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "DATA", x: P, y: 0 }, { n: "GND", x: 2 * P, y: 0 }],
    box: { x: -0.8 * P, y: -7.6 * P, w: 3.6 * P, h: 8.2 * P },
    props: { model: "DHT11", temp: 24, humidity: 55 },
    spec: [
      { k: "model", label: "Sensor", type: "select", options: [["DHT11", "DHT11 (blue, whole numbers)"], ["DHT22", "DHT22 (white, 0.1 steps)"]], rebuild: true },
      { k: "temp", label: "Temperature", type: "range", min: -40, max: 80, step: 0.5, unit: "°C", live: true },
      { k: "humidity", label: "Humidity", type: "range", min: 0, max: 100, step: 1, unit: "%", live: true }
    ],
    label: function (pr) { return pr.model === "DHT22" ? "DHT22" : "DHT11"; },
    art: function (part, pr) {
      var white = pr.model === "DHT22", s = header(["VCC", "DATA", "GND"]);
      s += board(-0.6 * P, -2.2 * P, 3.2 * P, 1.8 * P, "#1b4fa0", "#123673");
      s += shadow(-0.4 * P, -7.4 * P, 2.8 * P, 5.4 * P, 3) + rect(-0.4 * P, -7.4 * P, 2.8 * P, 5.4 * P, 3, white ? "#f2f2ee" : "#2f78d8", ' stroke="' + (white ? "#b8b8b0" : "#1d4fa0") + '" stroke-width="1.5"');
      for (var r = 0; r < 4; r++) for (var c = 0; c < 3; c++) s += rect(-0.1 * P + c * 0.8 * P, -7 * P + r * 0.85 * P, 0.55 * P, 0.5 * P, 1, white ? "#c9c9c1" : "#1c4e9a");
      s += text(P, -2.9 * P, white ? "DHT22" : "DHT11", 7, white ? "#555" : "#e6f0ff", { weight: 800 });
      s += ledG("led", 2.2 * P, -1.3 * P, 2.6, "#5a1a1a");
      return s;
    },
    live: function (g, st) { L.setFill(g.led, st.on ? "#ff4a3a" : "#5a1a1a"); }
  });
  MODELS.dht = {
    build: function (b) { return { pwr: Rr(b, "VCC", "GND", 2e4), data: Vs(b, "DATA", "GND", 0, 1e4) }; },
    pre: function (m, ctx) {
      var v = vAcross(ctx, m.pwr), on = v > 3;
      ctx.st.on = on;
      if (on) setV(m.data, v, 1e4); else off(m.data);     /* the module's own 10 kΩ pull-up on DATA */
    },
    post: function (m, ctx) {
      var v = vAcross(ctx, m.pwr);
      if (v > 5.8) warn(ctx, "danger", "over", "A DHT runs on 3.3–5.5 V. " + v.toFixed(1) + " V will damage it.");
    }
  };
  /* What a DHT on this board's pin would answer, or null. */
  Sim.prototype.dhtFor = function (id, num) {
    var node = pinNodeOf(this, id, num), found = null, self = this;
    if (!node) return null;
    this.topo.inst.forEach(function (it) {
      if (found || it.part.type !== "dht" || it.m.data.n[0] !== node) return;
      var st = self.state[it.part.id] || {}, pr = L.propsOf(it.part);
      if (!st.on) return;
      var dht22 = pr.model === "DHT22", t = +pr.temp, h = +pr.humidity;
      if (!dht22) { t = clamp(Math.round(t), 0, 50); h = clamp(Math.round(h), 20, 90); }
      else { t = Math.round(clamp(t, -40, 80) * 10) / 10; h = Math.round(clamp(h, 0, 100) * 10) / 10; }
      st.read = 0.25;
      found = { t: t, h: h, model: dht22 ? 22 : 11 };
    });
    return found;
  };

  /* --- Joystick (KY-023): two potentiometers and a push switch. */
  add("joystick", {
    name: "Joystick module", cat: "Sensors",
    blurb: "Two knobs in one stick: VRx and VRy sit at the middle (about 512) and swing to 0 and 1023. Press down and SW connects to GND — read it with INPUT_PULLUP.",
    pins: [{ n: "GND", x: 0, y: 0 }, { n: "+5V", x: P, y: 0 }, { n: "VRx", x: 2 * P, y: 0 }, { n: "VRy", x: 3 * P, y: 0 }, { n: "SW", x: 4 * P, y: 0 }],
    box: { x: -0.8 * P, y: -7.8 * P, w: 5.6 * P, h: 8.4 * P },
    props: { x: 0, y: 0, pressed: false },
    toggle: "pressed",
    spec: [
      { k: "x", label: "Left ↔ right", type: "range", min: -100, max: 100, step: 1, unit: "%", live: true },
      { k: "y", label: "Down ↕ up", type: "range", min: -100, max: 100, step: 1, unit: "%", live: true },
      { k: "pressed", label: "Pressed down", type: "bool", live: true }
    ],
    art: function () {
      var s = header(["GND", "+5V", "VRx", "VRy", "SW"]), cx = 2 * P, cy = -4.4 * P;
      s += board(-0.6 * P, -7.6 * P, 5.2 * P, 7.2 * P, "#1d1d1f", "#000");
      s += rect(cx - 1.9 * P, cy - 1.9 * P, 3.8 * P, 3.8 * P, 4, "#e4e4dc", ' stroke="#a8a89f"');
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (1.5 * P) + '" fill="#b8b8b0"/>';
      s += '<g data-live="knob"><circle cx="' + cx + '" cy="' + cy + '" r="' + (1.25 * P) + '" fill="#2a2a2c" stroke="#000" stroke-width="1.5"/>';
      for (var i = 0; i < 8; i++) s += '<path d="M' + cx + ' ' + (cy - 1.15 * P) + 'v6" stroke="#4a4a4e" stroke-width="2" transform="rotate(' + i * 45 + ' ' + cx + ' ' + cy + ')"/>';
      s += '<circle cx="' + (cx - 5) + '" cy="' + (cy - 6) + '" r="5" fill="#fff" opacity=".12"/></g>';
      return s;
    },
    live: function (g, st, pr) {
      if (!g.knob) return;
      var dx = clamp(pr.x || 0, -100, 100) / 100 * 0.8 * P, dy = -clamp(pr.y || 0, -100, 100) / 100 * 0.8 * P;
      g.knob.setAttribute("transform", "translate(" + dx.toFixed(1) + " " + dy.toFixed(1) + ")");
      g.knob.setAttribute("opacity", pr.pressed ? 0.75 : 1);
    }
  });
  MODELS.joystick = {
    build: function (b) { return { pwr: Rr(b, "+5V", "GND", 2e4), x: Vs(b, "VRx", "GND", 0, 2500), y: Vs(b, "VRy", "GND", 0, 2500), sw: Rr(b, "SW", "GND", 1e10) }; },
    pre: function (m, ctx) {
      var v = vAcross(ctx, m.pwr), pr = ctx.props;
      setSw(m.sw, !!pr.pressed);
      if (v < 1) { off(m.x); off(m.y); return; }
      setV(m.x, v * (0.5 + clamp(pr.x || 0, -100, 100) / 200), 2500);
      setV(m.y, v * (0.5 + clamp(pr.y || 0, -100, 100) / 200), 2500);
    },
    post: function () {}
  };

  /* --- Rotary encoder (KY-040): two switches, a quarter-turn apart. Which
   * one changes first tells you the direction. */
  add("rotary_encoder", {
    name: "Rotary encoder (KY-040)", cat: "Sensors",
    blurb: "A knob that turns forever. Each click makes CLK change; if DT differs from CLK at that moment it went clockwise. Press the knob and SW goes LOW.",
    pins: [{ n: "GND", x: 0, y: 0 }, { n: "+", x: P, y: 0 }, { n: "SW", x: 2 * P, y: 0 }, { n: "DT", x: 3 * P, y: 0 }, { n: "CLK", x: 4 * P, y: 0 }],
    box: { x: -0.8 * P, y: -7 * P, w: 5.6 * P, h: 7.6 * P },
    props: { clicks: 0, pressed: false },
    toggle: "pressed",
    spec: [
      { k: "clicks", label: "Turned to (clicks)", type: "range", min: -60, max: 60, step: 1, unit: "", live: true },
      { k: "pressed", label: "Knob pressed", type: "bool", live: true }
    ],
    art: function () {
      var s = header(["GND", "+", "SW", "DT", "CLK"]), cx = 2 * P, cy = -3.9 * P;
      s += board(-0.6 * P, -6.8 * P, 5.2 * P, 6.4 * P, "#1b4fa0", "#123673");
      s += rect(cx - 1.5 * P, cy - 1.5 * P, 3 * P, 3 * P, 2, "#b9c0c6", ' stroke="#7d858b"');
      s += '<g data-live="knob"><circle cx="' + cx + '" cy="' + cy + '" r="' + (1.15 * P) + '" fill="#d3d8dc" stroke="#8a9196" stroke-width="2"/>';
      for (var i = 0; i < 18; i++) s += '<path d="M' + cx + ' ' + (cy - 1.15 * P) + 'v4" stroke="#8a9196" stroke-width="1.3" transform="rotate(' + i * 20 + ' ' + cx + ' ' + cy + ')"/>';
      s += '<path d="M' + cx + ' ' + (cy - 0.9 * P) + 'V' + (cy - 0.15 * P) + '" stroke="#2a2a2c" stroke-width="3" stroke-linecap="round"/></g>';
      return s;
    },
    live: function (g, st) { if (g.knob) g.knob.setAttribute("transform", "rotate(" + (st.ang || 0).toFixed(1) + " " + 2 * P + " " + (-3.9 * P) + ")"); }
  });
  MODELS.rotary_encoder = {
    dynamic: true,
    build: function (b) { return { pwr: Rr(b, "+", "GND", 2e4), clk: Vs(b, "CLK", "GND", 0, 1e4), dt: Vs(b, "DT", "GND", 0, 1e4), sw: Vs(b, "SW", "GND", 0, 1e4), pos: null, acc: 0 }; },
    pre: function (m, ctx) {
      var v = vAcross(ctx, m.pwr), target = Math.round(+ctx.props.clicks || 0) * 4;
      if (m.pos === null) m.pos = target;                       /* where it was left: no burst of clicks on power-up */
      m.acc += dtOf(ctx);
      while (m.pos !== target && m.acc >= 0.002) { m.pos += m.pos < target ? 1 : -1; m.acc -= 0.002; }
      if (m.pos === target) m.acc = Math.min(m.acc, 0.002);
      ctx.st.ang = m.pos / 4 * 18;
      if (v < 2.5) { off(m.clk); off(m.dt); off(m.sw); return; }
      var q = ((m.pos % 4) + 4) % 4, a = q === 0 || q === 3, bb = q === 0 || q === 1;   /* Gray code: CLK leads DT clockwise */
      setV(m.clk, a ? v : 0, a ? 1e4 : 100);
      setV(m.dt, bb ? v : 0, bb ? 1e4 : 100);
      setV(m.sw, ctx.props.pressed ? 0 : v, ctx.props.pressed ? 100 : 1e4);
    },
    post: function () {},
    reset: function (m) { m.pos = null; m.acc = 0; }
  };

  /* --- Touch pad (TTP223): a capacitive button with no moving parts. */
  add("touch_sensor", {
    name: "Touch sensor (TTP223)", cat: "Sensors",
    blurb: "A button you just touch. SIG goes HIGH while a finger is on the pad — through a sheet of paper or thin plastic too.",
    pins: [{ n: "GND", x: 0, y: 0 }, { n: "SIG", x: P, y: 0, label: "I/O" }, { n: "VCC", x: 2 * P, y: 0 }],
    box: { x: -0.8 * P, y: -5 * P, w: 3.6 * P, h: 5.6 * P },
    props: { touched: false },
    toggle: "touched",
    spec: [{ k: "touched", label: "Finger on the pad", type: "bool", live: true }],
    art: function () {
      var s = header(["GND", "SIG", "VCC"], "#ffe2dc"), cx = P, cy = -2.7 * P;
      s += board(-0.6 * P, -4.8 * P, 3.2 * P, 4.4 * P, "#c0262d", "#7d1419");
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (1.25 * P) + '" fill="#d9b45a" stroke="#a8862f" stroke-width="1.5"/>';
      for (var i = 1; i < 4; i++) s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (i * 0.32 * P) + '" fill="none" stroke="#a8862f" stroke-width="1"/>';
      s += ledG("led", 2.2 * P, -4.3 * P, 2.6);
      s += '<g data-live="finger" opacity="0"><text x="' + (cx + 4) + '" y="' + (cy + 10) + '" font-size="22" text-anchor="middle">👆</text></g>';
      return s;
    },
    live: function (g, st, pr) { L.setFill(g.led, st.d ? "#ff4a3a" : "#5a1a1a"); if (g.finger) g.finger.setAttribute("opacity", pr.touched ? 1 : 0); },
    glow: function (st) { return st.d ? [{ x: 2.2 * P, y: -4.3 * P, r: 9, c: "#ff4a3a", a: 0.7 }] : null; }
  });
  MODELS.touch_sensor = {
    build: function (b) { return { pwr: Rr(b, "VCC", "GND", 5e4), sig: Vs(b, "SIG", "GND", 0, 300) }; },
    pre: function (m, ctx) {
      var v = vAcross(ctx, m.pwr), on = v > 2;
      ctx.st.d = on && !!ctx.props.touched;
      if (!on) { off(m.sig); return; }
      setV(m.sig, ctx.props.touched ? v : 0, 300);
    },
    post: function () {}
  };

  /* --- Heartbeat sensor: green light into a fingertip, a light sensor
   * watching the blood pulse through it. */
  function beat(p) {
    var g = function (c, w) { var z = (p - c) / w; return Math.exp(-z * z); };
    return g(0.12, 0.035) - 0.12 * g(0.22, 0.03) + 0.32 * g(0.38, 0.06);
  }
  add("pulse_sensor", {
    name: "Heartbeat sensor", cat: "Sensors",
    blurb: "Put a fingertip on it and S rises with every heartbeat (about 500 at rest, peaks near 700). Count the peaks in 15 seconds and multiply by 4 for beats per minute.",
    pins: [{ n: "S", x: 0, y: 0, label: "signal (purple)" }, { n: "+", x: P, y: 0 }, { n: "-", x: 2 * P, y: 0 }],
    box: { x: -1.3 * P, y: -6.6 * P, w: 4.6 * P, h: 7.2 * P },
    props: { bpm: 72, finger: true },
    toggle: "finger",
    spec: [
      { k: "bpm", label: "Heart rate", type: "range", min: 40, max: 180, step: 1, unit: "bpm", live: true },
      { k: "finger", label: "Finger on the sensor", type: "bool", live: true }
    ],
    art: function () {
      var s = "", cx = P, cy = -4 * P;
      [["#8b4fc9", 0], ["#d43a2f", P], ["#2a2a2c", 2 * P]].forEach(function (c) { s += '<path d="M' + c[1] + ' 0V' + (cy + 1.5 * P) + '" stroke="' + c[0] + '" stroke-width="4" stroke-linecap="round"/>'; });
      s += shadow(cx - 2.2 * P, cy - 2.2 * P, 4.4 * P, 4.4 * P, 2.2 * P) + '<circle cx="' + cx + '" cy="' + cy + '" r="' + (2.2 * P) + '" fill="#7a3fb8" stroke="#4e2479" stroke-width="2"/>';
      s += '<g data-live="heart"><path d="M' + cx + ' ' + (cy + 12) + 'c-26 -16 -16 -34 0 -22c16 -12 26 6 0 22z" fill="#f3f3f0"/></g>';
      s += ledG("led", cx, cy - 1, 4, "#1d4a25");
      return s;
    },
    live: function (g, st) {
      if (g.heart) g.heart.setAttribute("transform", st.beat ? "translate(" + P + " " + (-4 * P) + ") scale(1.12) translate(" + (-P) + " " + (4 * P) + ")" : "");
      L.setFill(g.led, st.on ? (st.beat ? "#9dff7a" : "#3fbf4a") : "#1d4a25");
    },
    glow: function (st) { return st.on ? [{ x: P, y: -4 * P, r: st.beat ? 18 : 11, c: "#5bff7a", a: st.beat ? 0.8 : 0.45 }] : null; }
  });
  MODELS.pulse_sensor = {
    dynamic: true,
    build: function (b) { return { pwr: Rr(b, "+", "-", 1.5e3), out: Vs(b, "S", "-", 0, 1000), ph: 0 }; },
    pre: function (m, ctx) {
      var v = vAcross(ctx, m.pwr), pr = ctx.props, on = v > 2.8;
      ctx.st.on = on;
      m.ph += clamp(+pr.bpm || 72, 30, 220) / 60 * dtOf(ctx);
      var p = m.ph % 1;
      ctx.st.beat = on && pr.finger && p < 0.16;
      if (!on) { off(m.out); return; }
      setV(m.out, pr.finger ? v * (0.48 + 0.2 * beat(p)) : v * (0.5 + 0.004 * (Math.random() - 0.5)), 1000);
    },
    post: function () {},
    reset: function (m) { m.ph = 0; }
  };

  /* --- Accelerometer (ADXL335): three outputs, one per axis, half the
   * supply at 0 g and a tenth of it more per g. Gravity is 1 g, so tilting
   * it moves the readings. */
  add("accel", {
    name: "Accelerometer (ADXL335)", cat: "Sensors",
    blurb: "Feels which way is down. X, Y and Z sit at about half the supply and move 1/10 of it per g: lying flat, Z reads 1 g and X, Y read 0. Tilt it and watch them trade.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "X", x: P, y: 0 }, { n: "Y", x: 2 * P, y: 0 }, { n: "Z", x: 3 * P, y: 0 }, { n: "GND", x: 4 * P, y: 0 }],
    box: { x: -0.8 * P, y: -6 * P, w: 5.6 * P, h: 6.6 * P },
    props: { tiltX: 0, tiltY: 0, shake: false },
    toggle: "shake",
    spec: [
      { k: "tiltX", label: "Tilt left ↔ right", type: "range", min: -90, max: 90, step: 1, unit: "°", live: true },
      { k: "tiltY", label: "Tilt back ↕ forward", type: "range", min: -90, max: 90, step: 1, unit: "°", live: true },
      { k: "shake", label: "Shaking it", type: "bool", live: true }
    ],
    art: function () {
      var s = header(["VCC", "X", "Y", "Z", "GND"]), cx = 2 * P, cy = -3.2 * P;
      s += board(-0.6 * P, -5.8 * P, 5.2 * P, 5.4 * P, "#6b3fa8", "#47267a");
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (1.5 * P) + '" fill="#4a2a78" stroke="#8a6ac8" stroke-width="1"/>';
      s += rect(cx - 0.7 * P, cy - 0.7 * P, 1.4 * P, 1.4 * P, 2, "#1d1d1f");
      s += '<g data-live="dot"><circle cx="' + cx + '" cy="' + cy + '" r="5" fill="#7cffb0" opacity=".9"/></g>';
      s += text(3.9 * P, -4.9 * P, "X→", 7, "#e8dcff", { weight: 700 }) + text(0.1 * P, -4.9 * P, "Y↑", 7, "#e8dcff", { weight: 700 });
      return s;
    },
    live: function (g, st, pr) {
      if (!g.dot) return;
      var dx = Math.sin((pr.tiltX || 0) * Math.PI / 180) * 1.2 * P, dy = -Math.sin((pr.tiltY || 0) * Math.PI / 180) * 1.2 * P;
      if (pr.shake) { dx += (Math.random() - 0.5) * 10; dy += (Math.random() - 0.5) * 10; }
      g.dot.setAttribute("transform", "translate(" + dx.toFixed(1) + " " + dy.toFixed(1) + ")");
    }
  });
  MODELS.accel = {
    dynamic: true,
    build: function (b) { return { pwr: Rr(b, "VCC", "GND", 1.5e4), x: Vs(b, "X", "GND", 0, 1000), y: Vs(b, "Y", "GND", 0, 1000), z: Vs(b, "Z", "GND", 0, 1000) }; },
    pre: function (m, ctx) {
      var v = vAcross(ctx, m.pwr), pr = ctx.props;
      if (v < 2) { off(m.x); off(m.y); off(m.z); return; }
      var ref = Math.min(v, 3.3), tx = (pr.tiltX || 0) * Math.PI / 180, ty = (pr.tiltY || 0) * Math.PI / 180;
      var g = [Math.sin(tx), Math.sin(ty), Math.cos(tx) * Math.cos(ty)];
      if (pr.shake) g = g.map(function (a) { return a + (Math.random() - 0.5) * 3; });
      [m.x, m.y, m.z].forEach(function (d, i) { setV(d, clamp(ref / 2 + ref / 10 * g[i], 0, ref), 1000); });
    },
    post: function () {}
  };

  /* --- Current sensor (ACS712, 5 A): the current runs through a copper
   * strip; a hall sensor beside it turns the field into a voltage. */
  add("acs712", {
    name: "Current sensor (ACS712, 5 A)", cat: "Sensors",
    blurb: "Put it in line with a motor or lamp (IP+ in, IP− out). OUT sits at half the supply with no current and moves 185 mV per amp — so (reading − 512) × 0.0264 is amps on an Arduino.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "OUT", x: P, y: 0 }, { n: "GND", x: 2 * P, y: 0 }, { n: "IP+", x: 0, y: -7 * P, label: "current in" }, { n: "IP-", x: 2 * P, y: -7 * P, label: "current out" }],
    box: { x: -1 * P, y: -7.8 * P, w: 4 * P, h: 8.4 * P },
    props: {},
    art: function () {
      var s = header(["VCC", "OUT", "GND"], "#ffe2dc");
      s += board(-0.8 * P, -6.4 * P, 3.6 * P, 6 * P, "#c0262d", "#7d1419");
      s += terminal(-0.8 * P, -7.7 * P, 3.6 * P, 1.4 * P, [0, 2 * P]);
      s += text(0, -5.7 * P, "IP+", 6.5, "#ffe2dc", { weight: 700 }) + text(2 * P, -5.7 * P, "IP−", 6.5, "#ffe2dc", { weight: 700 });
      s += rect(0.2 * P, -4.6 * P, 1.6 * P, 1.6 * P, 1, "#1d1d1f") + text(P, -3.8 * P, "712", 6, "#bbb", { weight: 700 });
      s += '<g data-live="amps">' + text(P, -2.2 * P, "", 7.5, "#fff", { weight: 800 }) + '</g>';
      return s;
    },
    live: function (g, st) { setText(g.amps, st.on && Math.abs(st.i || 0) > 0.005 ? L.si(st.i, "A", 2) : "5A"); }
  });
  MODELS.acs712 = {
    build: function (b) { return { path: Rr(b, "IP+", "IP-", 0.01), pwr: Rr(b, "VCC", "GND", 5e2), out: Vs(b, "OUT", "GND", 0, 100), i: 0 }; },
    pre: function (m, ctx) {
      var v = vAcross(ctx, m.pwr), on = v > 4;
      ctx.st.on = on;
      if (!on) { off(m.out); return; }
      setV(m.out, clamp(v / 2 + 0.185 * (v / 5) * m.i, 0, v), 100);
    },
    post: function (m, ctx) {
      m.i = iThrough(m.path);
      ctx.st.i = smooth(ctx.st, "ia", m.i, ctx);
      var a = Math.abs(m.i);
      if (a > 20) warn(ctx, "danger", "over", L.si(a, "A") + " through the sensor's copper strip — it is rated for 5 A and is burning.");
      else if (a > 5) warn(ctx, "warn", "range", L.si(a, "A") + " is past this sensor's 5 A range: OUT has hit the rail. Use the 20 A or 30 A version.");
    }
  };

  /* --- Voltage sensor module: 30 kΩ over 7.5 kΩ, so S is a fifth of VIN. */
  add("voltage_sensor", {
    name: "Voltage sensor (0–25 V)", cat: "Sensors",
    blurb: "Two resistors that turn up to 25 V into something a 5 V pin can read: S is VIN ÷ 5. Measure a battery: analogRead(A0) × 5.0 / 1023 × 5.",
    pins: [{ n: "S", x: 0, y: 0, label: "signal (VIN ÷ 5)" }, { n: "+", x: P, y: 0, label: "not connected" }, { n: "-", x: 2 * P, y: 0, label: "ground" }, { n: "VIN", x: 0, y: -6 * P, label: "voltage to measure" }, { n: "GND", x: 2 * P, y: -6 * P, label: "its ground" }],
    box: { x: -1 * P, y: -6.8 * P, w: 4 * P, h: 7.4 * P },
    props: {},
    art: function () {
      var s = header(["S", "+", "-"]);
      s += board(-0.8 * P, -5.4 * P, 3.6 * P, 5 * P, "#1b4fa0", "#123673");
      s += terminal(-0.8 * P, -6.7 * P, 3.6 * P, 1.4 * P, [0, 2 * P]);
      s += text(0, -4.7 * P, "VCC", 6, "#dfe9ff", { weight: 700 }) + text(2 * P, -4.7 * P, "GND", 6, "#dfe9ff", { weight: 700 });
      [[-0.2 * P, "30k"], [1.2 * P, "7k5"]].forEach(function (r) { s += rect(r[0], -3.6 * P, P, 0.6 * P, 1, "#1d1d1f") + text(r[0] + 0.5 * P, -2.7 * P, r[1], 6, "#dfe9ff"); });
      return s;
    }
  });
  MODELS.voltage_sensor = {
    build: function (b) { return { top: Rr(b, "VIN", "S", 30000), bot: Rr(b, "S", "-", 7500), gnd: Rr(b, "GND", "-", 0.01) }; },
    pre: function () {},
    post: function (m, ctx) {
      var v = ctx.pinV("VIN") - ctx.pinV("GND");
      if (v > 25.5) warn(ctx, "warn", "over", v.toFixed(1) + " V is over this module's 25 V: S is now above 5 V, which a 5 V board's pin can't take.");
    }
  };

  /* --- Force sensor: pressing squeezes conductive ink together. */
  add("fsr", {
    name: "Force sensor (FSR 402)", cat: "Sensors",
    blurb: "A pad whose resistance falls as you press it: open circuit when untouched, about 100 kΩ for a light touch, a few hundred ohms for a hard squeeze. Use it with a 10 kΩ resistor as a divider.",
    pins: [{ n: "1", x: 0, y: 0 }, { n: "2", x: P, y: 0 }],
    box: { x: -1.6 * P, y: -7.2 * P, w: 4.2 * P, h: 7.8 * P },
    props: { force: 0 },
    spec: [{ k: "force", label: "Pressing with", type: "range", min: 0, max: 10000, step: 50, unit: "g", live: true }],
    art: function () {
      var s = lead(0, 0, 0, -0.5 * P) + lead(P, 0, P, -0.5 * P), cx = 0.5 * P, cy = -5 * P;
      s += rect(-0.15 * P, -3.4 * P, 1.3 * P, 3 * P, 2, "#2a2a2c") + '<path d="M' + (0.2 * P) + ' ' + (-3.4 * P) + 'V' + (-0.5 * P) + 'M' + (0.8 * P) + ' ' + (-3.4 * P) + 'V' + (-0.5 * P) + '" stroke="#c6ccd1" stroke-width="2"/>';
      s += shadow(cx - 1.9 * P, cy - 1.9 * P, 3.8 * P, 3.8 * P, 1.9 * P) + '<circle cx="' + cx + '" cy="' + cy + '" r="' + (1.9 * P) + '" fill="#2a2a2c" stroke="#000"/>';
      s += '<circle data-live="pad" cx="' + cx + '" cy="' + cy + '" r="' + (1.4 * P) + '" fill="#3a3f45" stroke="#6a7177"/>';
      s += '<g data-live="thumb" opacity="0"><text x="' + cx + '" y="' + (cy + 9) + '" font-size="24" text-anchor="middle">👍</text></g>';
      return s;
    },
    live: function (g, st, pr) {
      var f = clamp((pr.force || 0) / 10000, 0, 1);
      if (g.pad) g.pad.setAttribute("fill", f > 0.002 ? "rgb(" + Math.round(58 + f * 140) + "," + Math.round(63 + f * 40) + "," + Math.round(69 - f * 20) + ")" : "#3a3f45");
      if (g.thumb) g.thumb.setAttribute("opacity", f > 0.002 ? 0.9 : 0);
    }
  });
  MODELS.fsr = {
    build: function (b) { return { r: Rr(b, "1", "2", 1e8) }; },
    pre: function (m, ctx) { var f = +ctx.props.force || 0; setR(m.r, f < 15 ? 1e8 : Math.max(200, 2e6 / f)); },
    post: function () {}
  };

  /* --- Flex sensor: 25 kΩ lying flat, about 100 kΩ bent right over. */
  add("flex_sensor", {
    name: "Flex sensor (2.2\")", cat: "Sensors",
    blurb: "A strip that changes resistance as it bends: about 25 kΩ flat, 100 kΩ bent 90°. Tape it to a glove finger and the Arduino knows how far it curls.",
    pins: [{ n: "1", x: 0, y: 0 }, { n: "2", x: P, y: 0 }],
    box: { x: -0.8 * P, y: -10 * P, w: 8 * P, h: 10.6 * P },
    props: { bend: 0 },
    spec: [{ k: "bend", label: "Bent by", type: "range", min: 0, max: 90, step: 1, unit: "°", live: true }],
    art: function (part, pr) {
      var s = lead(0, 0, 0, -0.6 * P) + lead(P, 0, P, -0.6 * P);
      s += rect(-0.3 * P, -1.4 * P, 1.6 * P, 0.9 * P, 1, "#c6ccd1");
      s += '<path data-live="strip" d="' + flexPath(pr.bend) + '" stroke="#1d1d1f" stroke-width="13" fill="none" stroke-linecap="round"/>';
      return s;
    },
    live: function (g, st, pr) { if (g.strip) g.strip.setAttribute("d", flexPath(pr.bend)); }
  });
  /* the strip as an arc of fixed length, bent by `bend` degrees */
  function flexPath(bend) {
    var b = clamp(+bend || 0, 0, 90) * Math.PI / 180, len = 8.4 * P, x0 = 0.5 * P, y0 = -1.5 * P;
    var ex = x0 + len * (b > 0.01 ? (1 - Math.cos(b)) / b : 0), ey = y0 - len * (b > 0.01 ? Math.sin(b) / b : 1);
    return "M" + x0 + " " + y0 + "Q" + x0 + " " + (y0 - len * 0.55).toFixed(1) + " " + ex.toFixed(1) + " " + ey.toFixed(1);
  }
  MODELS.flex_sensor = {
    build: function (b) { return { r: Rr(b, "1", "2", 25000) }; },
    pre: function (m, ctx) { setR(m.r, 25000 + 75000 * clamp(+ctx.props.bend || 0, 0, 90) / 90); },
    post: function () {}
  };

  /* --- UV sensor (GUVA-S12SD): OUT in volts is the UV index ÷ 10. */
  add("uv_sensor", {
    name: "UV light sensor", cat: "Sensors",
    blurb: "Sees the ultraviolet in sunlight that burns skin. OUT is the UV index ÷ 10 in volts: 0.3 V is a gentle UV 3, 1.1 V is an extreme 11 — time for shade.",
    pins: [{ n: "GND", x: 0, y: 0 }, { n: "VCC", x: P, y: 0 }, { n: "OUT", x: 2 * P, y: 0 }],
    box: { x: -0.8 * P, y: -4.8 * P, w: 3.6 * P, h: 5.4 * P },
    props: { uv: 3 },
    spec: [{ k: "uv", label: "UV index", type: "range", min: 0, max: 11, step: 0.5, unit: "", live: true }],
    art: function () {
      var s = header(["GND", "VCC", "OUT"], "#e8dcff");
      s += board(-0.6 * P, -4.6 * P, 3.2 * P, 4.2 * P, "#6b3fa8", "#47267a");
      s += rect(0.5 * P, -3.8 * P, P, P, 1, "#e6e6e0") + rect(0.7 * P, -3.6 * P, 0.6 * P, 0.6 * P, 1, "#8a6ac8");
      s += text(P, -2.1 * P, "UV", 9, "#e8dcff", { weight: 800 });
      s += '<g data-live="sun" opacity="0"><text x="' + (2.2 * P) + '" y="' + (-4.4 * P) + '" font-size="16" text-anchor="middle">☀️</text></g>';
      return s;
    },
    live: function (g, st, pr) { if (g.sun) g.sun.setAttribute("opacity", clamp((pr.uv || 0) / 8, 0, 1).toFixed(2)); }
  });
  MODELS.uv_sensor = {
    build: function (b) { return { pwr: Rr(b, "VCC", "GND", 2e4), out: Vs(b, "OUT", "GND", 0, 1000) }; },
    pre: function (m, ctx) {
      var v = vAcross(ctx, m.pwr);
      if (v < 2.5) { off(m.out); return; }
      setV(m.out, Math.min(v, 0.1 * clamp(+ctx.props.uv || 0, 0, 15)), 1000);
    },
    post: function () {}
  };

  /* ============================================================= ADVANCED */

  /* --- L298N: two H-bridges. IN1/IN2 choose motor A's direction, ENA lets
   * it run (pulse ENA with analogWrite for speed). The bridge eats about
   * 2 V, and its own regulator makes 5 V from anything over 7 V. */
  var L298 = ["12V", "GND", "5V", "ENA", "IN1", "IN2", "IN3", "IN4", "ENB"];
  add("l298n", {
    name: "Motor driver (L298N)", cat: "Advanced",
    blurb: "Drives two DC motors forwards and backwards. IN1 HIGH + IN2 LOW: motor A forwards; swap them: backwards; both the same: stop. Take ENA's jumper off and analogWrite() it for speed. Motor power goes on 12V; GND must be shared with the Arduino.",
    pins: [
      { n: "12V", x: -4 * P, y: 0, label: "motor supply (5–12 V)" }, { n: "GND", x: -3 * P, y: 0, label: "ground" }, { n: "5V", x: -2 * P, y: 0, label: "5 V (out when the jumper is on)" },
      { n: "ENA", x: 0, y: 0, label: "enable A (speed)" }, { n: "IN1", x: P, y: 0 }, { n: "IN2", x: 2 * P, y: 0 }, { n: "IN3", x: 3 * P, y: 0 }, { n: "IN4", x: 4 * P, y: 0 }, { n: "ENB", x: 5 * P, y: 0, label: "enable B (speed)" },
      { n: "OUT1", x: -5 * P, y: -11 * P, label: "motor A" }, { n: "OUT2", x: -5 * P, y: -9 * P, label: "motor A" },
      { n: "OUT3", x: 7 * P, y: -9 * P, label: "motor B" }, { n: "OUT4", x: 7 * P, y: -11 * P, label: "motor B" }
    ],
    box: { x: -5.8 * P, y: -15.4 * P, w: 13.6 * P, h: 16.2 * P },
    props: { jumperA: true, jumperB: true, reg: true },
    spec: [
      { k: "jumperA", label: "ENA jumper on (A always enabled)", type: "bool", rebuild: true },
      { k: "jumperB", label: "ENB jumper on (B always enabled)", type: "bool", rebuild: true },
      { k: "reg", label: "5 V regulator jumper on", type: "bool", rebuild: true }
    ],
    art: function (part, pr) {
      var s = "", x = -5 * P, y = -15 * P, w = 12 * P, h = 14.4 * P;
      s += shadow(x, y, w, h, 6) + rect(x, y, w, h, 6, "#c0262d", ' stroke="#7d1419" stroke-width="2"');
      /* heatsink */
      s += rect(-2.2 * P, -14.6 * P, 6.4 * P, 4.6 * P, 2, "#1d1d1f");
      for (var f = 0; f < 9; f++) s += rect(-2 * P + f * 0.7 * P, -14.6 * P, 0.35 * P, 4.6 * P, 1, "#3a3f45");
      s += rect(-0.8 * P, -10 * P, 3.6 * P, 1.6 * P, 1, "#1d1d1f") + text(P, -9.2 * P, "L298N", 8, "#c6ccd1", { weight: 800 });
      /* motor terminals */
      s += terminal(x - 0.6 * P, -11.8 * P, 1.4 * P, 3.6 * P, []) + screw(-5 * P, -11 * P) + screw(-5 * P, -9 * P);
      s += terminal(7 * P - 0.8 * P, -11.8 * P, 1.4 * P, 3.6 * P, []) + screw(7 * P, -11 * P) + screw(7 * P, -9 * P);
      s += text(-3.6 * P, -11 * P, "OUT1", 6.5, "#ffe2dc", { weight: 700, anchor: "start" }) + text(-3.6 * P, -9 * P, "OUT2", 6.5, "#ffe2dc", { weight: 700, anchor: "start" });
      s += text(5.6 * P, -11 * P, "OUT4", 6.5, "#ffe2dc", { weight: 700, anchor: "end" }) + text(5.6 * P, -9 * P, "OUT3", 6.5, "#ffe2dc", { weight: 700, anchor: "end" });
      s += '<g data-live="dirA">' + text(-3.2 * P, -7.6 * P, "", 14, "#fff", { weight: 800 }) + '</g><g data-live="dirB">' + text(5.2 * P, -7.6 * P, "", 14, "#fff", { weight: 800 }) + '</g>';
      /* power terminal block and logic header */
      s += terminal(-4.7 * P, -0.7 * P, 3.4 * P, 1.4 * P, [-4 * P, -3 * P, -2 * P]);
      s += text(-4 * P, -1.5 * P, "12V", 6, "#ffe2dc", { weight: 700 }) + text(-3 * P, -1.5 * P, "GND", 6, "#ffe2dc", { weight: 700 }) + text(-2 * P, -1.5 * P, "5V", 6, "#ffe2dc", { weight: 700 });
      s += rect(-0.5 * P, -0.5 * P, 6 * P, P, 1, "#141414");
      ["ENA", "IN1", "IN2", "IN3", "IN4", "ENB"].forEach(function (nm, i) {
        s += rect(i * P - 2, -2, 4, 4, 0, "#e3b54a") + text(i * P, -1.4 * P, nm, 6, "#ffe2dc", { rot: -90 });
      });
      if (pr.jumperA) s += rect(-0.35 * P, -0.9 * P, 0.7 * P, 1.1 * P, 2, "#1d1d1f", ' stroke="#555"');
      if (pr.jumperB) s += rect(4.65 * P, -0.9 * P, 0.7 * P, 1.1 * P, 2, "#1d1d1f", ' stroke="#555"');
      s += rect(-4.4 * P, -4 * P, 1.6 * P, 1.2 * P, 1, "#1d1d1f") + text(-3.6 * P, -3.4 * P, "78M05", 5.5, "#aaa");
      if (pr.reg) s += rect(-2.4 * P, -4 * P, 0.7 * P, 1.1 * P, 2, "#1d1d1f", ' stroke="#555"');
      s += ledG("pwr", -1 * P, -5.4 * P, 3.5);
      return s;
    },
    live: function (g, st) {
      L.setFill(g.pwr, st.on ? "#ff4a3a" : "#5a1a1a");
      setText(g.dirA, st.a > 0 ? "⟳" : st.a < 0 ? "⟲" : "");
      setText(g.dirB, st.b > 0 ? "⟳" : st.b < 0 ? "⟲" : "");
    },
    glow: function (st) { return st.on ? [{ x: -1 * P, y: -5.4 * P, r: 10, c: "#ff4a3a", a: 0.6 }] : null; }
  });
  MODELS.l298n = {
    build: function (b) {
      var m = { ins: {}, outs: [], draw: b.add(new K.Norton(1e-9, 0), ["12V", "GND"]), reg: Vs(b, "5V", "GND", 0, 0.3), need: 0 };
      ["ENA", "IN1", "IN2", "IN3", "IN4", "ENB"].forEach(function (n) { m.ins[n] = Rr(b, n, "GND", 1e5); });
      ["OUT1", "OUT2", "OUT3", "OUT4"].forEach(function (n) { m.outs.push(Vs(b, n, "GND", 0, 0.3)); });
      return m;
    },
    pre: function (m, ctx) {
      var pr = ctx.props, g = ctx.pinV("GND"), vs = ctx.pinV("12V") - g, v5 = ctx.pinV("5V") - g;
      var hi = function (n) { return vAcross(ctx, m.ins[n]) > 2.3; };
      var regOn = !!pr.reg && vs > 7;
      if (regOn) setV(m.reg, 5, 0.3); else off(m.reg);
      var logic = regOn || v5 > 4.5;
      var enA = logic && (pr.jumperA || hi("ENA")), enB = logic && (pr.jumperB || hi("ENB"));
      var ins = [hi("IN1"), hi("IN2"), hi("IN3"), hi("IN4")], top = Math.max(0, vs - 1.8);
      m.outs.forEach(function (d, i) { if ((i < 2 ? enA : enB) && vs > 1) setV(d, ins[i] ? top : 0, 0.3); else off(d); });
      m.draw.gv = 1e-9; m.draw.is = -m.need;
      ctx.st.on = logic;
      ctx.st.a = enA && ins[0] !== ins[1] ? (ins[0] ? 1 : -1) : 0;
      ctx.st.b = enB && ins[2] !== ins[3] ? (ins[2] ? 1 : -1) : 0;
      m.vs = vs; m.logic = logic; m.anyIn = ins.some(Boolean);
    },
    post: function (m, ctx) {
      var need = m.vs > 1 ? 0.036 : 0, worst = 0;
      m.outs.forEach(function (d) { var src = -iThrough(d); if (src > 0) need += src; worst = Math.max(worst, Math.abs(src)); });
      var r5 = -iThrough(m.reg); if (r5 > 0) need += r5;
      m.need = need;
      if (worst > 2) warn(ctx, "danger", "over", "A motor is pulling " + L.si(worst, "A") + " through the L298N. It manages 2 A per side and is overheating.");
      if (m.logic && m.anyIn && m.vs < 4.5) warn(ctx, "warn", "nomotor", "The L298N is getting commands but has no motor power. Connect a battery's + to 12V and − to GND.");
      if (!m.logic && m.anyIn) warn(ctx, "warn", "nologic", ctx.props.reg ? "The L298N's own 5 V regulator needs more than 7 V on 12V. Give it more, or take the 5V jumper off and feed 5 V into the 5V pin." : "With the 5V jumper off, the L298N needs 5 V on its 5V pin to think.");
    }
  };

  /* --- 28BYJ-48 stepper on a ULN2003 board. Four coils; energise them in
   * order and the shaft takes one small step each time — 2048 full steps
   * (4096 half steps) for one turn of the geared-down shaft. */
  var HALF = { "1000": 0, "1100": 1, "0100": 2, "0110": 3, "0010": 4, "0011": 5, "0001": 6, "1001": 7 };
  var STEP = { cx: 3 * P, cy: -11.6 * P };
  add("stepper", {
    name: "Stepper motor (28BYJ-48 + ULN2003)", cat: "Advanced",
    blurb: "Turns a precise amount: 2048 steps is exactly one revolution. #include <Stepper.h>, then Stepper motor(2048, 8, 10, 9, 11); — note the 8, 10, 9, 11 order. The LEDs show which coils are on. Give it 5 V on + and −.",
    pins: [{ n: "IN1", x: 0, y: 0 }, { n: "IN2", x: P, y: 0 }, { n: "IN3", x: 2 * P, y: 0 }, { n: "IN4", x: 3 * P, y: 0 }, { n: "+", x: 5 * P, y: 0, label: "+ 5 V" }, { n: "-", x: 6 * P, y: 0, label: "− ground" }],
    box: { x: -1.6 * P, y: -16.6 * P, w: 9.8 * P, h: 17.2 * P },
    props: {},
    art: function () {
      var s = header(["IN1", "IN2", "IN3", "IN4"], "#e3ffe8") + header(["+", "−"], "#e3ffe8", 5 * P);
      s += board(-0.6 * P, -6.6 * P, 7.4 * P, 6.2 * P, "#1f8a46", "#156233");
      s += rect(0.2 * P, -3.6 * P, 3.4 * P, 1.6 * P, 1, "#1d1d1f") + text(1.9 * P, -2.8 * P, "ULN2003", 6.5, "#c6ccd1", { weight: 700 });
      ["A", "B", "C", "D"].forEach(function (l, i) { s += ledG("l" + i, 0.4 * P + i * 0.9 * P, -5.4 * P, 3.4) + text(0.4 * P + i * 0.9 * P, -4.6 * P, l, 6, "#e3ffe8", { weight: 700 }); });
      s += rect(4.2 * P, -6.4 * P, 2.4 * P, 1.6 * P, 1, "#f2f2ee", ' stroke="#b8b8b0"');
      ["#2f6fd1", "#e88aa8", "#e8c22a", "#ef8a1f", "#d63a2f"].forEach(function (c, i) {
        s += '<path d="M' + (4.5 * P + i * 0.45 * P) + ' ' + (-6.4 * P) + 'C' + (4.5 * P + i * 0.45 * P) + ' ' + (-7.6 * P) + ' ' + (3 * P + i * 0.3 * P) + ' ' + (-6.8 * P) + ' ' + (2.4 * P + i * 0.3 * P) + ' ' + (-7.8 * P) + '" stroke="' + c + '" stroke-width="2.4" fill="none"/>';
      });
      /* the motor: a can with two ears and an off-centre shaft */
      s += rect(STEP.cx - 5.6 * P, STEP.cy - 0.7 * P, 11.2 * P, 1.4 * P, 7, "#c3c9ce", ' stroke="#7d858b"');
      s += '<circle cx="' + (STEP.cx - 5 * P) + '" cy="' + STEP.cy + '" r="5" fill="#4a5056"/><circle cx="' + (STEP.cx + 5 * P) + '" cy="' + STEP.cy + '" r="5" fill="#4a5056"/>';
      s += shadow(STEP.cx - 4 * P, STEP.cy - 4 * P, 8 * P, 8 * P, 4 * P) + '<circle cx="' + STEP.cx + '" cy="' + STEP.cy + '" r="' + (4 * P) + '" fill="#d3d8dc" stroke="#8a9196" stroke-width="2"/>';
      s += '<circle cx="' + STEP.cx + '" cy="' + (STEP.cy - 1.6 * P) + '" r="' + (1.4 * P) + '" fill="#b9c0c6" stroke="#7d858b"/>';
      s += '<g data-live="shaft"><circle cx="' + STEP.cx + '" cy="' + (STEP.cy - 1.6 * P) + '" r="' + (0.7 * P) + '" fill="#e8c86a" stroke="#8a6a1c"/>' + rect(STEP.cx - 0.15 * P, STEP.cy - 4.2 * P, 0.3 * P, 2.6 * P, 1, "#d63a2f") + '</g>';
      s += text(STEP.cx, STEP.cy + 1.4 * P, "28BYJ-48", 8, "#5a6066", { weight: 800 }) + text(STEP.cx, STEP.cy + 2.4 * P, "5V DC", 7, "#5a6066", { weight: 700 });
      return s;
    },
    live: function (g, st) {
      for (var i = 0; i < 4; i++) L.setFill(g["l" + i], st.l && st.l[i] ? "#ff4a3a" : "#5a1a1a");
      if (g.shaft) g.shaft.setAttribute("transform", "rotate(" + ((st.ang || 0) % 360).toFixed(2) + " " + STEP.cx + " " + (STEP.cy - 1.6 * P) + ")");
    }
  });
  MODELS.stepper = {
    dynamic: true,
    build: function (b) {
      var m = { load: Rr(b, "+", "-", 1e7), ins: [], idx: -1, ang: 0, active: 0, fastT: 0 };
      ["IN1", "IN2", "IN3", "IN4"].forEach(function (n) { m.ins.push(Rr(b, n, "-", 3300)); });
      return m;
    },
    pre: function (m) { setR(m.load, m.active ? 55 / m.active : 1e7); },
    post: function (m, ctx) {
      var v = vAcross(ctx, m.load), bits = m.ins.map(function (d) { return vAcross(ctx, d) > 1.8 ? 1 : 0; });
      var count = bits.reduce(function (a, x) { return a + x; }, 0);
      ctx.st.l = bits;
      m.active = v > 4 ? count : 0;
      if (count && v < 4) { warn(ctx, "warn", "nopower", "The stepper's driver has signals but no power. Connect + to 5 V and − to GND."); return; }
      var idx = HALF[bits.join("")];
      if (idx != null && m.idx >= 0 && idx !== m.idx) {
        var d = ((idx - m.idx) % 8 + 8) % 8;
        if (d > 4) d -= 8;
        if (Math.abs(d) <= 2) m.ang += d * 360 / 4096;
        else m.fastT = 1;                                       /* it skipped a coil: a real motor just shudders */
      }
      if (idx != null) m.idx = idx;
      if (m.fastT > 0) {
        m.fastT -= dtOf(ctx);
        warn(ctx, "warn", "fast", "Steps are coming too fast for the 28BYJ-48 to follow, so it only shudders. Keep setSpeed() at 15 RPM or less.");
      }
      ctx.st.ang = m.ang;
    },
    reset: function (m) { m.idx = -1; m.ang = 0; m.active = 0; m.fastT = 0; }
  };

  /* --- 74HC595 shift register: three pins in, eight outputs. */
  var Q595 = ["15", "1", "2", "3", "4", "5", "6", "7"];
  var sr = L.dipChip(16, "74HC595", ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "GND", "Q7'", "MR", "SH_CP (clock)", "ST_CP (latch)", "OE", "DS (data)", "Q0", "VCC"], "shift register");
  sr.name = "Shift register (74HC595)"; sr.cat = "Advanced";
  sr.blurb = "Eight outputs from three pins. shiftOut(dataPin, clockPin, MSBFIRST, value) clocks 8 bits in; a LOW-then-HIGH on the latch pin shows them on Q0–Q7. Tie MR (10) to 5 V and OE (13) to GND.";
  sr.props = {};
  add("hc595", sr);
  MODELS.hc595 = {
    build: function (b) {
      var m = { pwr: Rr(b, "16", "8", 2e4), ds: Rr(b, "14", "8", 1e7), sh: Rr(b, "11", "8", 1e7), stc: Rr(b, "12", "8", 1e7), oe: Rr(b, "13", "8", 1e7), mr: Rr(b, "10", "8", 1e7),
        q: Q595.map(function (n) { return Vs(b, n, "8", 0, 40); }), q7s: Vs(b, "9", "8", 0, 40), reg: 0, latch: 0, lastSh: false, lastSt: false, v: 0 };
      return m;
    },
    pre: function (m, ctx) {
      var v = vAcross(ctx, m.pwr);
      m.v = v;
      if (v < 2) { m.q.forEach(off); off(m.q7s); m.reg = 0; m.latch = 0; return; }
      var en = vAcross(ctx, m.oe) < v / 2;
      m.q.forEach(function (d, i) { if (en) setV(d, (m.latch >> i) & 1 ? v : 0, 40); else off(d); });
      setV(m.q7s, (m.reg >> 7) & 1 ? v : 0, 40);
    },
    post: function (m, ctx) {
      var v = m.v;
      if (v < 2) return;
      if (vAcross(ctx, m.mr) < v / 2) m.reg = 0;
      var sh = vAcross(ctx, m.sh) > v / 2, st = vAcross(ctx, m.stc) > v / 2;
      if (sh && !m.lastSh) m.reg = ((m.reg << 1) | (vAcross(ctx, m.ds) > v / 2 ? 1 : 0)) & 0xFF;
      if (st && !m.lastSt) m.latch = m.reg;
      m.lastSh = sh; m.lastSt = st;
      ctx.st.latch = m.latch;
      var worst = 0, total = 0;
      m.q.forEach(function (d) { var i = Math.abs(iThrough(d)); worst = Math.max(worst, i); total += i; });
      if (worst > 0.035) warn(ctx, "danger", "pin", "A 74HC595 output is giving " + L.si(worst, "A") + ". Each output wants a 220 Ω resistor in series.");
      else if (total > 0.075) warn(ctx, "warn", "total", "The 74HC595 is supplying " + L.si(total, "A") + " in all; it is rated for 70 mA. Use bigger resistors.");
    },
    /* a program switched a pin faster than the circuit is solved: catch the edge now */
    onPin: function (m, sim, node, level) {
      if (m.v < 2) return;
      if (node === m.sh.n[0]) { if (level && !m.lastSh) m.reg = ((m.reg << 1) | (sim.levelOn(m.ds.n[0], m.v) ? 1 : 0)) & 0xFF; m.lastSh = !!level; }
      if (node === m.stc.n[0]) { if (level && !m.lastSt) m.latch = m.reg; m.lastSt = !!level; }
    }
  };

  /* --- MCP3008: eight analog inputs over SPI, for a Raspberry Pi that has
   * none of its own. gpiozero's MCP3008(channel=0) reads it. */
  var adc = L.dipChip(16, "MCP3008", ["CH0", "CH1", "CH2", "CH3", "CH4", "CH5", "CH6", "CH7", "DGND", "CS (to GPIO8)", "DIN (to GPIO10)", "DOUT (to GPIO9)", "CLK (to GPIO11)", "AGND", "VREF", "VDD"], "8-ch ADC");
  adc.name = "Analog-to-digital chip (MCP3008)"; adc.cat = "Advanced";
  adc.blurb = "Gives a Raspberry Pi eight analog inputs. VDD (16) and VREF (15) to 3.3 V, both grounds to GND, CLK→GPIO11, DOUT→GPIO9, DIN→GPIO10, CS→GPIO8. Then in Python: MCP3008(channel=0).value is 0.0–1.0.";
  adc.props = {};
  add("mcp3008", adc);
  MODELS.mcp3008 = {
    build: function (b) {
      var m = { pwr: Rr(b, "16", "9", 1.5e4), vref: Rr(b, "15", "14", 1e5), g: Rr(b, "14", "9", 0.01) };
      ["1", "2", "3", "4", "5", "6", "7", "8", "10", "11", "12", "13"].forEach(function (n) { Rr(b, n, "9", 1e8); });
      return m;
    },
    pre: function () {},
    post: function (m, ctx) {
      var v = vAcross(ctx, m.pwr);
      ctx.st.on = v > 2.5;
      if (v > 5.6) warn(ctx, "danger", "over", "The MCP3008 runs on 2.7–5.5 V. On a Raspberry Pi, power it from 3.3 V.");
    }
  };
  /* An MCP3008 on this Pi's SPI pins (CE0 or CE1): {read(ch) -> 0..1}, or a
   * string saying what is missing. */
  Sim.prototype.adcFor = function (id, ce) {
    var T = this.topo, self = this, pi = null;
    if (!T) return "no circuit";
    T.inst.forEach(function (it) { if (it.part.id === id) pi = it; });
    if (!pi || !pi.m.pins[11]) return "no board";
    var want = { "13": pi.m.pins[11].n[0], "12": pi.m.pins[9].n[0], "11": pi.m.pins[10].n[0], "10": pi.m.pins[ce ? 7 : 8].n[0] };
    var best = null, why = "no MCP3008 is wired to the SPI pins";
    T.inst.forEach(function (it) {
      if (best || it.part.type !== "mcp3008") return;
      var pn = function (n) { return T.pinNode[it.part.id + ":" + n] || 0; };
      var miss = Object.keys(want).filter(function (n) { return pn(n) !== want[n]; });
      if (miss.length) { why = "the MCP3008's pin" + (miss.length > 1 ? "s " : " ") + miss.join(", ") + (miss.length > 1 ? " aren't" : " isn't") + " on the right GPIO"; return; }
      if (!(self.state[it.part.id] || {}).on) { why = "the MCP3008 has no power on VDD (16) and DGND (9)"; return; }
      var V = function (n) { var k = pn(n); return k ? T.x[k - 1] : 0; };
      best = { read: function (ch) { var ref = V("15") - V("14"); return ref < 0.5 ? 0 : clamp((V(String(ch + 1)) - V("14")) / ref, 0, 1); } };
    });
    return best || why;
  };

  /* --- PC817 optocoupler: an infrared LED shining on a phototransistor in
   * one sealed package. Two circuits that never touch can still talk. */
  var opto = L.dipChip(4, "817", ["anode", "cathode", "emitter", "collector"], null);
  opto.name = "Optocoupler (PC817)"; opto.cat = "Advanced";
  opto.blurb = "Light carries the signal across a gap, so the two sides share no wire. Pin 1→2 is an infrared LED (use a resistor); when it shines, pin 4 (collector) connects to pin 3 (emitter).";
  opto.props = {};
  add("optocoupler", opto);
  MODELS.optocoupler = {
    build: function (b) {
      var nvt = 2 * K.VT;
      return { led: b.add(new K.Diode(0.02 / Math.exp(1.2 / nvt), nvt), ["1", "2"]), out: b.add(new K.Norton(1e-9, 0), ["4", "3"]), il: 0 };
    },
    pre: function (m) { var ic = Math.max(0, m.il); m.out.gv = ic > 1e-6 ? ic / 0.15 : 1e-9; m.out.is = 0; },
    post: function (m, ctx) {
      m.il = iThrough(m.led);
      ctx.st.on = m.il > 0.001;
      if (m.il > 0.05) warn(ctx, "danger", "over", "The optocoupler's LED is taking " + L.si(m.il, "A") + ". Put a resistor (330 Ω–1 kΩ) in series with pin 1.");
    }
  };

  /* --- Linear regulators: steady volts out, the rest burnt off as heat. */
  var REG = { "5": { name: "7805", drop: 2 }, "3.3": { name: "LD1117", drop: 1.1 }, "12": { name: "7812", drop: 2 } };
  add("regulator", {
    name: "Voltage regulator (7805)", cat: "Power",
    blurb: "Turns a higher, wobbly voltage into a steady one. A 7805 needs at least 7 V in for 5 V out; everything above that becomes heat. A 9 V battery to 5 V at 200 mA warms it by 0.8 W.",
    pins: [{ n: "IN", x: 0, y: 0, label: "in" }, { n: "GND", x: P, y: 0, label: "ground" }, { n: "OUT", x: 2 * P, y: 0, label: "out" }],
    box: { x: -0.6 * P, y: -6.2 * P, w: 3.2 * P, h: 6.8 * P },
    props: { volts: 5 },
    spec: [{ k: "volts", label: "Chip", type: "select", options: [[5, "7805 — 5 V"], [3.3, "LD1117 — 3.3 V"], [12, "7812 — 12 V"]], rebuild: true }],
    label: function (pr) { return (REG[String(+pr.volts)] || REG["5"]).name; },
    art: function (part, pr) {
      var r = REG[String(+pr.volts)] || REG["5"], s = lead(0, 0, 0, -1.4 * P) + lead(P, 0, P, -1.4 * P) + lead(2 * P, 0, 2 * P, -1.4 * P);
      s += rect(-0.5 * P, -6 * P, 3 * P, 2.4 * P, 2, "#c6ccd1", ' stroke="#8a9196"') + '<circle cx="' + P + '" cy="' + (-5.1 * P) + '" r="6" fill="#4a5056"/>';
      s += shadow(-0.5 * P, -3.8 * P, 3 * P, 2.5 * P, 2) + rect(-0.5 * P, -3.8 * P, 3 * P, 2.5 * P, 2, "#1d1d1f");
      s += text(P, -2.8 * P, r.name, 7.5, "#c6ccd1", { weight: 800 }) + text(P, -1.9 * P, (+pr.volts) + " V", 6.5, "#8b949b", { weight: 700 });
      s += text(0, 0.75 * P, "I", 7, "#d8dee3", { weight: 700 }) + text(P, 0.75 * P, "G", 7, "#d8dee3", { weight: 700 }) + text(2 * P, 0.75 * P, "O", 7, "#d8dee3", { weight: 700 });
      return s;
    },
    live: function (g, st) { L.heatLive(g, st); }
  });
  MODELS.regulator = {
    dynamic: true,
    build: function (b) { return { out: Vs(b, "OUT", "GND", 0, 0.05), draw: b.add(new K.Norton(1e-9, 0), ["IN", "GND"]), iout: 0, heat: 0, shut: false }; },
    pre: function (m, ctx) {
      var r = REG[String(+ctx.props.volts)] || REG["5"], vset = +ctx.props.volts || 5, vin = ctx.pinV("IN") - ctx.pinV("GND");
      m.vin = vin; m.vset = vset; m.drop = r.drop;
      if (m.shut || vin < 1.2) off(m.out);
      else setV(m.out, Math.min(vset, Math.max(0, vin - r.drop)), 0.05);
      m.draw.gv = 1e-9; m.draw.is = -(Math.max(0, m.iout) + (vin > 1.2 ? 0.005 : 0));
    },
    post: function (m, ctx) {
      var vout = ctx.pinV("OUT") - ctx.pinV("GND"), dt = dtOf(ctx);
      m.iout = -iThrough(m.out);
      var p = Math.max(0, (m.vin - vout) * m.iout);
      m.heat += (p - m.heat) * Math.min(1, dt / 1.5);              /* the tab takes a moment to warm */
      ctx.st.hot = clamp((m.heat - 0.6) / 1.6, 0, 1);
      ctx.st.p = m.heat;
      if (m.shut && m.heat < 1.2) m.shut = false;
      if (m.heat > 2.4) { m.shut = true; warn(ctx, "danger", "shutdown", "The regulator is burning " + m.heat.toFixed(1) + " W and has shut itself off to cool down. Use a lower input voltage or a heatsink."); }
      else if (m.heat > 1) warn(ctx, "warn", "hot", "The regulator is turning " + m.heat.toFixed(1) + " W into heat ((in − out) × current). Above 1 W it needs a heatsink.");
      if (m.iout > 0.002 && m.vin > 1.2 && m.vin < m.vset + m.drop) warn(ctx, "info", "dropout", "The regulator needs at least " + (m.vset + m.drop).toFixed(1) + " V in to give a steady " + m.vset + " V; it has " + m.vin.toFixed(1) + " V, so the output is sagging.");
      if (m.iout > 1.5) warn(ctx, "danger", "over", "The regulator is supplying " + L.si(m.iout, "A") + "; it is good for about 1 A.");
    },
    reset: function (m) { m.iout = 0; m.heat = 0; m.shut = false; }
  };

  /* --- NeoPixel ring: every LED has a tiny chip that takes its colour
   * from the data line and passes the rest along. */
  var RING = { cx: P, cy: -5.6 * P, r: 3.8 * P };
  function ringPos(i, n) { var a = -Math.PI / 2 + i * 2 * Math.PI / n; return { x: RING.cx + RING.r * Math.cos(a), y: RING.cy + RING.r * Math.sin(a) }; }
  add("neopixel", {
    name: "NeoPixel ring (WS2812B)", cat: "Lights & sound",
    blurb: "Every LED can be any colour, all from one data pin. #include <Adafruit_NeoPixel.h>, then strip.setPixelColor(i, strip.Color(r, g, b)); strip.show();. Each LED can draw 60 mA at full white — big rings need their own 5 V supply.",
    pins: [{ n: "DIN", x: 0, y: 0, label: "data in" }, { n: "5V", x: P, y: 0 }, { n: "GND", x: 2 * P, y: 0 }],
    box: { x: -4.6 * P, y: -11.2 * P, w: 11.2 * P, h: 11.8 * P },
    props: { count: 12 },
    spec: [{ k: "count", label: "LEDs", type: "select", options: [[8, "8"], [12, "12"], [16, "16"], [24, "24"]], rebuild: true }],
    art: function (part, pr) {
      var n = +pr.count || 12, s = header(["DIN", "5V", "GND"]), sz = n > 16 ? 0.62 * P : n > 12 ? 0.78 * P : 0.9 * P;
      s += leadPath("M0 " + (-0.5 * P) + "V" + (-1.6 * P)) + leadPath("M" + P + " " + (-0.5 * P) + "V" + (-1.6 * P)) + leadPath("M" + 2 * P + " " + (-0.5 * P) + "V" + (-1.6 * P));
      s += '<circle cx="' + RING.cx + '" cy="' + (RING.cy + 3) + '" r="' + (RING.r + 0.8 * P) + '" fill="#000" opacity=".25"/>';
      s += '<circle cx="' + RING.cx + '" cy="' + RING.cy + '" r="' + (RING.r + 0.8 * P) + '" fill="none" stroke="#1d1d1f" stroke-width="' + (1.6 * P) + '"/>';
      for (var i = 0; i < n; i++) {
        var q = ringPos(i, n);
        s += rect(q.x - sz / 2 - 2, q.y - sz / 2 - 2, sz + 4, sz + 4, 2, "#f2f2ee");
        s += '<g data-live="p' + i + '">' + rect(q.x - sz / 2, q.y - sz / 2, sz, sz, 2, "#3a3a36") + '</g>';
      }
      s += text(RING.cx, RING.cy, "WS2812B", 8, "#8b949b", { weight: 800 }) + text(RING.cx, RING.cy + 0.9 * P, n + " LEDs", 7, "#8b949b");
      return s;
    },
    live: function (g, st, pr) {
      var n = +pr.count || 12, px = st.px;
      for (var i = 0; i < n; i++) {
        var c = px && px[i], k = c ? Math.max(c[0], c[1], c[2]) : 0;
        L.setFill(g["p" + i], k > 2 ? "rgb(" + Math.round(40 + c[0] * 215 / 255) + "," + Math.round(40 + c[1] * 215 / 255) + "," + Math.round(40 + c[2] * 215 / 255) + ")" : "#3a3a36");
      }
    },
    glow: function (st, pr) {
      var n = +pr.count || 12, px = st.px, out = [];
      if (!px) return null;
      for (var i = 0; i < n; i++) {
        var c = px[i], k = c ? Math.max(c[0], c[1], c[2]) : 0;
        if (k > 6) { var q = ringPos(i, n); out.push({ x: q.x, y: q.y, r: 9 + k / 255 * 12, c: "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")", a: 0.35 + 0.55 * k / 255 }); }
      }
      return out;
    }
  });
  MODELS.neopixel = {
    build: function (b) { return { pwr: Rr(b, "5V", "GND", 1e5), din: Rr(b, "DIN", "GND", 1e6), amps: 0, v: 0 }; },
    pre: function (m) { setR(m.pwr, m.amps > 1e-4 && m.v > 1 ? Math.max(1, m.v / m.amps) : 1e5); },
    post: function (m, ctx) {
      var v = vAcross(ctx, m.pwr), n = +ctx.props.count || 12, on = v > 3.5;
      var px = on ? ctx.sim.neoOn(m.din.n[0]) : null, amps = on ? 0.0008 * n : 0;
      ctx.st.px = px ? px.slice(0, n) : null;
      if (px) for (var i = 0; i < n && i < px.length; i++) amps += (px[i][0] + px[i][1] + px[i][2]) / 255 * 0.02;
      m.amps = amps; m.v = v;
      ctx.st.amps = amps;
      if (v > 5.6) warn(ctx, "danger", "over", "NeoPixels take 5 V. " + v.toFixed(1) + " V will burn out the LEDs' chips.");
      if (amps > 0.45) warn(ctx, "warn", "amps", "The ring is drawing " + L.si(amps, "A") + ". An Arduino's 5V pin shouldn't give more than about 500 mA: lower setBrightness() or give the ring its own 5 V supply.");
      if (on && !px && ctx.sim.mcuRunning) warn(ctx, "info", "nodata", "The ring has power but no colours yet. Wire DIN to a pin, then strip.begin() and strip.show().");
    }
  };
  /* The colours a board last show()ed on a pin on this node. */
  Sim.prototype.neoOn = function (node) {
    var list = this.mcuPinsOnNode(node);
    for (var i = 0; i < list.length; i++) {
      var rt = this.runtimes[list[i].id], nx = rt && rt.neo;
      if (nx && nx[list[i].num]) return nx[list[i].num];
    }
    return null;
  };

  /* --- Solar panel: a light-driven current source with the cells' own
   * diode across it, so it acts like the real thing: about 6.9 V with
   * nothing connected, about 190 mA into a short, and both fall with the sun. */
  add("solar_panel", {
    name: "Solar panel (6 V, 1 W)", cat: "Power",
    blurb: "Sunlight in, electricity out: about 6.9 V with nothing connected and up to 190 mA in full sun. Clouds lower the current far more than the voltage. Its best power is at about 5.5 V.",
    pins: [{ n: "+", x: 0, y: 0 }, { n: "-", x: P, y: 0 }],
    box: { x: -3.6 * P, y: -12 * P, w: 8.2 * P, h: 12.6 * P },
    props: { sun: 80 },
    spec: [{ k: "sun", label: "Sunlight", type: "range", min: 0, max: 100, step: 1, unit: "%", live: true }],
    art: function () {
      var s = '<path d="M0 0V' + (-2 * P) + '" stroke="#d43a2f" stroke-width="4" stroke-linecap="round"/><path d="M' + P + ' 0V' + (-2 * P) + '" stroke="#2a2a2c" stroke-width="4" stroke-linecap="round"/>';
      var x = -3.4 * P, y = -10 * P, w = 7.8 * P, h = 8 * P;
      s += shadow(x, y, w, h, 3) + rect(x, y, w, h, 3, "#d3d8dc", ' stroke="#8a9196" stroke-width="1.5"');
      for (var r = 0; r < 3; r++) for (var c = 0; c < 4; c++) s += rect(x + 0.3 * P + c * 1.82 * P, y + 0.3 * P + r * 2.48 * P, 1.7 * P, 2.36 * P, 1, "#1f3a78", ' stroke="#2f5ab8" stroke-width=".8"');
      s += '<g data-live="sun" opacity="0"><circle cx="' + (x + w - 0.6 * P) + '" cy="' + (y - 0.6 * P) + '" r="' + (0.9 * P) + '" fill="#ffd23a"/>';
      for (var i = 0; i < 8; i++) s += '<path d="M' + (x + w - 0.6 * P) + ' ' + (y - 2 * P) + 'v' + (0.5 * P) + '" stroke="#ffd23a" stroke-width="2.4" stroke-linecap="round" transform="rotate(' + i * 45 + ' ' + (x + w - 0.6 * P) + ' ' + (y - 0.6 * P) + ')"/>';
      s += '</g><g data-live="watts">' + text(x + w / 2, y + h + 0.6 * P, "", 8, "#2a6a2a", { weight: 800 }) + '</g>';
      return s;
    },
    live: function (g, st, pr) {
      if (g.sun) g.sun.setAttribute("opacity", clamp((pr.sun || 0) / 100, 0, 1).toFixed(2));
      setText(g.watts, st.w > 0.005 ? L.si(st.w, "W", 2) : "");
    }
  });
  MODELS.solar_panel = {
    build: function (b) {
      return { src: b.add(new K.Norton(1e-6, 0), ["+", "-"]), d: b.add(new K.Diode(7e-9, 0.403), ["+", "-"]) };
    },
    pre: function (m, ctx) { m.src.gv = 1e-6; m.src.is = 0.19 * clamp(+ctx.props.sun || 0, 0, 100) / 100; },
    post: function (m, ctx) {
      var v = vAcross(ctx, m.src), i = -(iThrough(m.src) + iThrough(m.d));
      ctx.st.v = v; ctx.st.i = i;
      ctx.st.w = smooth(ctx.st, "w_", Math.max(0, v * i), ctx);
      if (i < -0.01) warn(ctx, "warn", "back", "Current is being pushed backwards into the solar panel. Put a diode in series (stripe away from the panel) so a battery can't drain into it at night.");
    }
  };

  /* ============================================= WHAT A PROGRAM'S PINS DO */

  function pinNodeOf(sim, id, num) {
    var T = sim.topo, node = 0;
    if (!T) return 0;
    T.inst.forEach(function (it) { if (it.part.id === id && it.m.pins && it.m.pins[num]) node = it.m.pins[num].n[0]; });
    return node;
  }
  /* Is this node high? A board pin driving it answers this instant; anything
   * else answers from the last solve. */
  Sim.prototype.levelOn = function (node, vcc) {
    var list = this.mcuPinsOnNode(node);
    for (var i = 0; i < list.length; i++) {
      var rt = this.runtimes[list[i].id], ps = rt && rt.pins && rt.pins[list[i].num];
      if (ps && ps.mode === "OUT") return !!ps.out;
    }
    return (node ? this.topo.x[node - 1] : 0) > (vcc || 5) / 2;
  };
  /* A board just switched a pin. Most parts only need the next solve, but a
   * chip clocked by that pin may need to see this edge now: a program can
   * pulse a pin high and low again in a few microseconds. */
  Sim.prototype.pinChange = function (id, num, level) {
    var T = this.topo;
    if (!T || this.topoDirty) return;
    var node = pinNodeOf(this, id, num);
    if (!node) return;
    for (var i = 0; i < T.inst.length; i++) if (T.inst[i].model.onPin) T.inst[i].model.onPin(T.inst[i].m, this, node, level);
  };
})(typeof window !== "undefined" ? window : globalThis);
