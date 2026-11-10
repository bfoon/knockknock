/* Chalk Circuit Lab — things that talk without wires.
 *
 *   HC-05      Bluetooth serial module. Pair it with the phone controller
 *              in the side panel; what the phone sends comes out of TXD,
 *              what arrives on RXD shows up on the phone.
 *   HC-12      433 MHz radio serial module. Bytes into one HC-12's RXD come
 *              out of every other HC-12 on the same channel — so two
 *              Arduinos can talk across the bench.
 *   433 MHz    a four-button key fob and its receiver. Press A–D on the fob
 *   remote kit and D0–D3 on the receiver go high. No code needed.
 *
 * All three are serial or logic parts electrically (power, a TX that drives,
 * an RX that listens) and the data itself is routed here, between steps of
 * the circuit, with the time a real link takes. Each transmission becomes an
 * event the bench draws as waves and a travelling packet.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var P = L.P, add = L.addPart, S = L.svg, text = S.text, lead = S.lead, shadow = S.shadow;
  var MODELS = L.MODELS;

  /* ================================================================ ART */

  function hc05Art() {
    var x = -0.7 * P, y = -9.4 * P, w = 6.4 * P, h = 8.9 * P;
    var s = "";
    [0, 1, 2, 3, 4, 5].forEach(function (i) { s += lead(i * P, 0, i * P, -0.6 * P); });
    s += shadow(x, y, w, h, 4) + '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="#1d4fa0" stroke="#123673"/>';
    /* the radio module itself, with its zig-zag antenna trace */
    var mx = x + 0.6 * P, my = y + 0.5 * P, mw = w - 1.2 * P, mh = 6 * P;
    s += '<rect x="' + mx + '" y="' + my + '" width="' + mw + '" height="' + mh + '" rx="2" fill="#2f8a43" stroke="#1d5c2c"/>';
    s += '<path d="M' + (mx + 6) + ' ' + (my + 8) + 'h' + (mw - 12) + 'v10h-' + (mw - 20) + 'v10h' + (mw - 20) + 'v10h-' + (mw - 20) + '" stroke="#e7c35a" stroke-width="3" fill="none"/>';
    s += '<rect x="' + (mx + 0.9 * P) + '" y="' + (my + 2.9 * P) + '" width="' + (mw - 1.8 * P) + '" height="' + (2.4 * P) + '" rx="2" fill="#1b1b1d"/>';
    s += text(mx + mw / 2, my + 4.1 * P, "HC-05", 11, "#cfd5da", { weight: 800 });
    s += text(x + w / 2, y + 7.1 * P, "Bluetooth", 8.5, "#dfe9ff", { weight: 700 });
    ["STATE", "RXD", "TXD", "GND", "VCC", "EN"].forEach(function (nm, i) { s += text(i * P, -1.2 * P, nm, 6, "#dfe9ff", { rot: -90 }); });
    s += '<g data-live="led"><circle cx="' + (x + w - 0.8 * P) + '" cy="' + (y + 7.9 * P) + '" r="4.5" fill="#5a1a1a"/></g>';
    return s;
  }
  function hc12Art() {
    var x = -0.7 * P, y = -6.8 * P, w = 6.6 * P, h = 6.3 * P;
    var s = "";
    [0, 1, 2, 3, 4].forEach(function (i) { s += lead(i * P, 0, i * P, -0.6 * P); });
    s += shadow(x, y, w, h, 3) + '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="#2b2b2e" stroke="#111"/>';
    s += '<rect x="' + (x + 0.4 * P) + '" y="' + (y + 0.5 * P) + '" width="' + (4.2 * P) + '" height="' + (3.8 * P) + '" rx="2" fill="#c9ced3" stroke="#8a9196"/>';
    s += text(x + 2.5 * P, y + 1.9 * P, "HC-12", 11, "#3a4046", { weight: 800 });
    s += text(x + 2.5 * P, y + 3.2 * P, "433 MHz", 8, "#5a6066", { weight: 700 });
    /* spring antenna */
    var ax = x + w - 0.9 * P, ay = y + 0.4 * P, coil = "";
    for (var i = 0; i < 9; i++) coil += "M" + (ax - 6) + " " + (ay + i * 5) + "q6 -4 12 0";
    s += '<path d="M' + ax + ' ' + (y + h - 0.6 * P) + 'V' + (ay + 46) + '" stroke="#cfd5da" stroke-width="2"/>';
    s += '<path data-live="coil" d="' + coil + '" stroke="#e3b54a" stroke-width="2.4" fill="none"/>';
    ["VCC", "GND", "RXD", "TXD", "SET"].forEach(function (nm, i) { s += text(i * P, -1.2 * P, nm, 6, "#dfe9ff", { rot: -90 }); });
    s += '<g data-live="ch">' + text(x + 2.5 * P, y + 5.1 * P, "CH 1", 8, "#9aa3ab", { weight: 700 }) + '</g>';
    return s;
  }
  function rfRxArt() {
    var x = -0.7 * P, y = -5.2 * P, w = 7.4 * P, h = 4.7 * P;
    var s = "";
    [0, 1, 2, 3, 4, 5, 6].forEach(function (i) { s += lead(i * P, 0, i * P, -0.6 * P); });
    s += shadow(x, y, w, h, 3) + '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="3" fill="#1f7a3e" stroke="#145a2c"/>';
    s += '<rect x="' + (x + 0.5 * P) + '" y="' + (y + 0.5 * P) + '" width="' + (2.2 * P) + '" height="' + (1.6 * P) + '" rx="2" fill="#141414"/>';
    s += '<rect x="' + (x + 3 * P) + '" y="' + (y + 0.6 * P) + '" width="' + (1.4 * P) + '" height="' + (1.4 * P) + '" fill="#c9ced3"/>';
    var coil = "", cx = x + w - 1.1 * P;
    for (var i = 0; i < 6; i++) coil += "M" + (cx - 5) + " " + (y + 0.6 * P + i * 4.5) + "q5 -4 10 0";
    s += '<path d="' + coil + '" stroke="#e3b54a" stroke-width="2.2" fill="none"/>';
    s += text(x + 3.2 * P, y + 2.9 * P, "433 MHz RX", 7.5, "#dff5e6", { weight: 700 });
    ["GND", "+5V", "D0", "D1", "D2", "D3", "VT"].forEach(function (nm, i) { s += text(i * P, -1.2 * P, nm, 6, "#dff5e6", { rot: -90 }); });
    s += '<g data-live="led"><circle cx="' + (x + w - 1.1 * P) + '" cy="' + (y + 3.8 * P) + '" r="4" fill="#5a1a1a"/></g>';
    return s;
  }
  var FOB_ZONES = [{ n: "A", x: 1.3 * P, y: 2.6 * P }, { n: "B", x: 2.9 * P, y: 2.6 * P }, { n: "C", x: 1.3 * P, y: 4.2 * P }, { n: "D", x: 2.9 * P, y: 4.2 * P }];
  function fobArt() {
    var s = '<circle cx="' + (2.1 * P) + '" cy="' + (-0.2 * P) + '" r="' + (0.7 * P) + '" fill="none" stroke="#9aa3ab" stroke-width="3.5"/>';
    s += '<rect x="' + (0.2 * P + 3) + '" y="' + (0.3 * P + 4) + '" width="' + (3.8 * P) + '" height="' + (5.6 * P) + '" rx="22" fill="#000" opacity=".3"/>';
    s += '<rect x="' + (0.2 * P) + '" y="' + (0.3 * P) + '" width="' + (3.8 * P) + '" height="' + (5.6 * P) + '" rx="22" fill="#26282c" stroke="#111" stroke-width="1.5"/>';
    s += '<rect x="' + (0.5 * P) + '" y="' + (0.6 * P) + '" width="' + (3.2 * P) + '" height="10" rx="5" fill="#fff" opacity=".07"/>';
    s += '<g data-live="led"><circle cx="' + (2.1 * P) + '" cy="' + (1.2 * P) + '" r="3.5" fill="#4a1515"/></g>';
    FOB_ZONES.forEach(function (z) {
      s += '<g data-live="btn' + z.n + '"><circle cx="' + z.x + '" cy="' + z.y + '" r="' + (0.62 * P) + '" fill="#8e969c" stroke="#5f666c" stroke-width="1.5"/>' +
           '<circle cx="' + z.x + '" cy="' + (z.y - 2) + '" r="' + (0.5 * P) + '" fill="#c3c9ce"/></g>';
      s += text(z.x, z.y, z.n, 11, "#2a2d31", { weight: 800 });
    });
    return s;
  }

  /* ============================================================== PARTS */

  add("hc05", {
    name: "Bluetooth module (HC-05)", cat: "Wireless",
    blurb: "Talks to a phone. Wire TXD to the Arduino's RX pin and RXD to its TX pin, then pair it with the phone controller in the side panel.",
    pins: [{ n: "STATE", x: 0, y: 0, label: "STATE (high when paired)" }, { n: "RXD", x: P, y: 0, label: "RXD (data in, 3.3 V)" },
           { n: "TXD", x: 2 * P, y: 0, label: "TXD (data out)" }, { n: "GND", x: 3 * P, y: 0 }, { n: "VCC", x: 4 * P, y: 0, label: "VCC (5 V)" }, { n: "EN", x: 5 * P, y: 0 }],
    box: { x: -0.7 * P, y: -9.4 * P, w: 6.4 * P, h: 9.6 * P },
    props: {},
    art: hc05Art,
    live: function (g, st) { if (g.led) L.setFill(g.led, st.ledOn ? "#ff3a2a" : "#5a1a1a"); },
    glow: function (st) { return st.ledOn ? [{ x: 5 * P, y: -1.5 * P, r: 14, c: "#ff3a2a", a: 0.8 }] : null; },
    antenna: { x: 2.5 * P, y: -8.2 * P }
  });

  add("hc12", {
    name: "Radio module (HC-12, 433 MHz)", cat: "Wireless",
    blurb: "A radio serial link. Whatever one HC-12 receives on RXD comes out of TXD on every other HC-12 on the same channel — up to hundreds of metres away.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: P, y: 0 }, { n: "RXD", x: 2 * P, y: 0, label: "RXD (data in)" }, { n: "TXD", x: 3 * P, y: 0, label: "TXD (data out)" }, { n: "SET", x: 4 * P, y: 0, label: "SET (leave unconnected)" }],
    box: { x: -0.7 * P, y: -6.8 * P, w: 6.6 * P, h: 7 * P },
    props: { channel: 1, loss: 0 },
    spec: [
      { k: "channel", label: "Channel", type: "select", options: [[1, "1 (433.4 MHz)"], [2, "2"], [3, "3"], [4, "4"], [5, "5"], [6, "6"], [7, "7"], [8, "8"]] },
      { k: "loss", label: "Interference — packets lost", type: "range", min: 0, max: 90, step: 5, unit: "%", live: true }
    ],
    art: hc12Art,
    live: function (g, st, pr) {
      if (g.ch) { var t = g.ch.firstChild, v = "CH " + (pr.channel || 1); if (t.textContent !== v) t.textContent = v; }
      if (g.coil) g.coil.setAttribute("stroke", st.txT > 0 ? "#ffe9a0" : "#e3b54a");
    },
    glow: function (st) { return st.txT > 0 ? [{ x: 5 * P, y: -5.5 * P, r: 22, c: "#ffe9a0", a: 0.6 }] : null; },
    antenna: { x: 5.2 * P, y: -6.2 * P }
  });

  add("rf_rx", {
    name: "433 MHz remote receiver", cat: "Wireless",
    blurb: "The receiver for the key fob. While button A is held, D0 goes high; B is D1, C is D2, D is D3. VT is high whenever any button is pressed.",
    pins: [{ n: "GND", x: 0, y: 0 }, { n: "VCC", x: P, y: 0, label: "+5V" }, { n: "D0", x: 2 * P, y: 0, label: "D0 (button A)" }, { n: "D1", x: 3 * P, y: 0, label: "D1 (button B)" },
           { n: "D2", x: 4 * P, y: 0, label: "D2 (button C)" }, { n: "D3", x: 5 * P, y: 0, label: "D3 (button D)" }, { n: "VT", x: 6 * P, y: 0, label: "VT (any button)" }],
    box: { x: -0.7 * P, y: -5.2 * P, w: 7.4 * P, h: 5.4 * P },
    props: { latch: false },
    spec: [{ k: "latch", label: "Latching (each press toggles)", type: "bool" }],
    art: rfRxArt,
    live: function (g, st) { if (g.led) L.setFill(g.led, st.vt ? "#ff3a2a" : "#5a1a1a"); },
    glow: function (st) { return st.vt ? [{ x: 5.6 * P, y: -1.4 * P, r: 12, c: "#ff3a2a", a: 0.8 }] : null; },
    antenna: { x: 5.6 * P, y: -4.4 * P }
  });

  add("rf_remote", {
    name: "433 MHz key fob", cat: "Wireless",
    blurb: "A four-button remote with its own battery. Hold a button down to transmit to the remote receiver.",
    pins: [],
    box: { x: 0.2 * P, y: -0.9 * P, w: 3.8 * P, h: 6.8 * P },
    props: {},
    zones: FOB_ZONES.map(function (z) { return { n: z.n, x: z.x, y: z.y, r: 0.75 * P }; }),
    art: fobArt,
    live: function (g, st) {
      var any = false;
      FOB_ZONES.forEach(function (z) {
        var el = g["btn" + z.n]; if (!el) return;
        var on = st.press && st.press[z.n];
        any = any || on;
        var t = on ? "translate(" + z.x + " " + z.y + ") scale(.88) translate(" + (-z.x) + " " + (-z.y) + ")" : "";
        if (el.getAttribute("transform") !== t) el.setAttribute("transform", t);
      });
      if (g.led) L.setFill(g.led, any ? "#ff3a2a" : "#4a1515");
    },
    glow: function (st) {
      var any = st.press && Object.keys(st.press).some(function (k) { return st.press[k]; });
      return any ? [{ x: 2.1 * P, y: 1.2 * P, r: 12, c: "#ff3a2a", a: 0.9 }] : null;
    },
    antenna: { x: 2.1 * P, y: 0.6 * P }
  });

  /* Where the waves come from, in world space. */
  L.antennaOf = function (part) {
    var d = L.def(part), a = (d && d.antenna) || { x: 0, y: 0 };
    var w = L.xform(a.x, a.y, part.rot, part.flip);
    return { x: part.x + w[0], y: part.y + w[1] };
  };

  /* ============================================================= MODELS */

  function R(b, a, c, ohms) { return b.add(new (L.Norton)(1 / ohms, 0), [a, c]); }
  function setV(dev, volts, r) { dev.gv = 1 / r; dev.is = volts / r; }
  function vAcross(ctx, dev) { return ctx.v(dev.n[0]) - ctx.v(dev.n[1]); }

  MODELS.hc05 = {
    build: function (b) {
      return { pwr: R(b, "VCC", "GND", 1e6), txd: R(b, "TXD", "GND", 1e6), rxd: R(b, "RXD", "GND", 1e5), state: R(b, "STATE", "GND", 1e6) };
    },
    pre: function (m, ctx) {
      var on = ctx.st.on, paired = on && ctx.sim.btPaired(ctx.part.id);
      m.pwr.gv = on ? 1 / 120 : 1e-6;
      setV(m.txd, on ? 3.3 : 0, on ? 200 : 1e7);
      setV(m.state, paired ? 3.3 : 0, on ? 200 : 1e7);
    },
    post: function (m, ctx) {
      var vcc = vAcross(ctx, m.pwr), st = ctx.st;
      st.on = vcc > 3.4;
      st.paired = st.on && ctx.sim.btPaired(ctx.part.id);
      var t = ctx.sim.wall;
      /* the real module's LED: fast blink while waiting, two quick blinks every two seconds once paired */
      st.ledOn = st.on && (st.paired ? ((t % 2) < 0.1 || ((t % 2) > 0.2 && (t % 2) < 0.3)) : (t % 0.5) < 0.25);
      if (st.on && vAcross(ctx, m.rxd) > 3.8) ctx.sim.warn(ctx.part.id, "info", "rxd5v", "The HC-05's RXD pin is a 3.3 V input. Many modules put up with 5 V, but the safe way is a divider from the Arduino's TX pin: 1 kΩ in series, 2 kΩ to ground.");
      if (vcc > 0.5 && vcc < 3.4) ctx.sim.warn(ctx.part.id, "warn", "lowpower", "The Bluetooth module needs about 5 V on VCC to start.");
    }
  };

  MODELS.hc12 = {
    build: function (b) {
      return { pwr: R(b, "VCC", "GND", 1e6), txd: R(b, "TXD", "GND", 1e6), rxd: R(b, "RXD", "GND", 1e5), set: R(b, "SET", "VCC", 1e4) };
    },
    pre: function (m, ctx) {
      var on = ctx.st.on, vcc = ctx.st.vcc || 0;
      m.pwr.gv = on ? 1 / 300 : 1e-6;
      setV(m.txd, on ? vcc : 0, on ? 200 : 1e7);
    },
    post: function (m, ctx) {
      var st = ctx.st, vcc = vAcross(ctx, m.pwr);
      st.vcc = vcc; st.on = vcc > 3.2;
      if (st.txT > 0) st.txT -= ctx.dt > 0 && isFinite(ctx.dt) ? ctx.dt : 0.016;
      if (vcc > 0.5 && vcc < 3.2) ctx.sim.warn(ctx.part.id, "warn", "lowpower", "The HC-12 needs 3.2–5.5 V on VCC.");
      if (st.on && ctx.pinWired("SET") && ctx.v(m.set.n[0]) - ctx.v(m.pwr.n[1]) < 1) ctx.sim.warn(ctx.part.id, "info", "set", "SET is pulled low, which puts the HC-12 into command mode. Leave SET unconnected to send data.");
    }
  };

  MODELS.rf_rx = {
    build: function (b) {
      var m = { pwr: R(b, "VCC", "GND", 1e6), outs: {}, vt: R(b, "VT", "GND", 1e6), latched: {}, was: {} };
      ["D0", "D1", "D2", "D3"].forEach(function (d) { m.outs[d] = R(b, d, "GND", 1e6); });
      return m;
    },
    pre: function (m, ctx) {
      var st = ctx.st, vcc = st.vcc || 0, on = vcc > 3, press = ctx.sim.fobPressed();
      m.pwr.gv = on ? 1 / 1000 : 1e-6;
      var any = false;
      ["A", "B", "C", "D"].forEach(function (z, i) {
        var d = "D" + i, held = on && !!press[z];
        if (ctx.props.latch) { if (held && !m.was[z]) m.latched[z] = !m.latched[z]; m.was[z] = held; }
        var hi = ctx.props.latch ? !!m.latched[z] && on : held;
        setV(m.outs[d], hi ? vcc * 0.95 : 0, on ? 200 : 1e7);
        any = any || held;
      });
      setV(m.vt, any ? vcc * 0.95 : 0, on ? 200 : 1e7);
      st.vt = any;
    },
    post: function (m, ctx) {
      var vcc = vAcross(ctx, m.pwr);
      ctx.st.vcc = vcc;
      if (vcc > 0.5 && vcc < 3) ctx.sim.warn(ctx.part.id, "warn", "lowpower", "The receiver needs about 5 V on +5V.");
    },
    reset: function (m) { m.latched = {}; m.was = {}; }
  };

  MODELS.rf_remote = {
    build: function () { return {}; },
    pre: function (m, ctx) {
      var press = {}, any = false, id = ctx.part.id, pressed = ctx.sim.pressed;
      ["A", "B", "C", "D"].forEach(function (z) { if (pressed[id + ":" + z]) { press[z] = true; any = true; } });
      if (any && !ctx.st.sending) ctx.sim.event(id, "fob");
      ctx.st.press = press; ctx.st.sending = any;
    },
    post: function () {}
  };

  /* ========================================================= DATA ROUTES */

  var Sim = L.Sim;

  Sim.prototype.btPaired = function (id) { return !!(this.bt && this.bt[id]); };
  Sim.prototype.fobPressed = function () {
    var out = {}, pressed = this.pressed;
    Object.keys(pressed).forEach(function (k) {
      var m = /:(A|B|C|D)$/.exec(k);
      if (m && pressed[k]) out[m[1]] = true;
    });
    return out;
  };

  function nodeOfPin(sim, key) { return sim.topo ? sim.topo.pinNode[key] || 0 : 0; }
  function partsOfType(sim, type) { return sim.topo ? sim.topo.inst.filter(function (it) { return it.part.type === type; }) : []; }

  /* Queue bytes to arrive somewhere after `delay` simulated seconds. */
  /* Bytes on one line go one after another: a message can't overtake the
   * one sent before it. `line` names the wire or radio link. */
  Sim.prototype.uartQueue = function (node, text, delay, from, line) {
    this.uLast = this.uLast || {};
    var key = line || ("n" + node), due = Math.max(this.t, this.uLast[key] || 0) + delay;
    this.uLast[key] = due;
    (this.uq = this.uq || []).push({ due: due, node: node, text: text, from: from });
  };
  /* Called every step: deliver what is due to every board pin on that node. */
  Sim.prototype.uartTick = function () {
    if (!this.uq || !this.uq.length) return;
    var now = this.t, keep = [], self = this;
    this.uq.forEach(function (q) {
      if (q.due > now) { keep.push(q); return; }
      self.mcuPinsOnNode(q.node).forEach(function (p) {
        if (q.from && p.id === q.from.id && p.num === q.from.num) return;
        var rt = self.runtimes[p.id];
        if (rt && rt.running) rt.uartIn(p.num, q.text);
      });
    });
    this.uq = keep;
  };

  /* A board printed on one of its pins. Follow the wire. */
  Sim.prototype.uartOut = function (mcuId, pinNum, text) {
    var T = this.topo, self = this;
    if (!T || !text) return;
    var node = 0;
    T.inst.forEach(function (it) { if (it.part.id === mcuId && it.m.pins && it.m.pins[pinNum]) node = it.m.pins[pinNum].n[0]; });
    if (!node) return;
    var byteTime = text.length * 10 / 9600;
    /* straight into another board's RX */
    this.uartQueue(node, text, byteTime, { id: mcuId, num: pinNum }, "w" + mcuId + ":" + pinNum);
    /* into a Bluetooth module, and on to the phone */
    partsOfType(this, "hc05").forEach(function (it) {
      var st = self.state[it.part.id] || {};
      if (it.m.rxd.n[0] !== node || !st.on) return;
      if (st.paired && self.onPhone) {
        self.onPhone(it.part.id, text);
        self.event(it.part.id, "bt", { text: text, up: true });
      }
    });
    /* into an HC-12, and through the air to the others on its channel */
    partsOfType(this, "hc12").forEach(function (it) {
      var st = self.state[it.part.id] || {};
      if (it.m.rxd.n[0] !== node || !st.on) return;
      var ch = L.propsOf(it.part).channel || 1, to = [], lost = [];
      st.txT = 0.15;
      partsOfType(self, "hc12").forEach(function (o) {
        if (o === it) return;
        var ost = self.state[o.part.id] || {}, opr = L.propsOf(o.part);
        if (!ost.on || (opr.channel || 1) !== ch) return;
        var loss = Math.max(L.propsOf(it.part).loss || 0, opr.loss || 0) / 100;
        if (Math.random() < loss) { lost.push(o.part.id); return; }
        to.push(o.part.id);
        self.uartQueue(o.m.txd.n[0], text, byteTime + 0.004, null, "r" + it.part.id + ">" + o.part.id);
      });
      self.event(it.part.id, "radio", { to: to, lost: lost, text: text });
    });
  };

  /* The phone sends to a paired HC-05: out of its TXD pin. */
  Sim.prototype.phoneSend = function (moduleId, text) {
    var self = this, sent = false;
    partsOfType(this, "hc05").forEach(function (it) {
      var st = self.state[it.part.id] || {};
      if (it.part.id !== moduleId || !st.on || !st.paired) return;
      self.uartQueue(it.m.txd.n[0], text, text.length * 10 / 9600 + 0.01, null, "bt" + it.part.id);
      self.event(it.part.id, "bt", { text: text, up: false });
      sent = true;
    });
    return sent;
  };

})(typeof window !== "undefined" ? window : globalThis);
