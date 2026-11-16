/* Chalk Circuit Lab — the Raspberry Pi.
 *
 * A Pi is not a bigger Arduino: it is a computer. So it gets no "upload"
 * button — you switch the bench on, it boots Linux, and you log in at a
 * terminal and run things, exactly as on the real one. This file is the
 * board itself and its place in the circuit:
 *
 *   the part      a Raspberry Pi 4 with its 40-pin header on the bench's
 *                 0.1 inch grid, so jumper wires land pin for pin
 *   the physics   GPIO at 3.3 V (not the Arduino's 5 V), about 16 mA a
 *                 pin, the 50 kΩ pulls every pin wakes up with, and a
 *                 loud warning if 5 V ever reaches a GPIO pin
 *   the pins      ChalkLab.Pi.gpio(): the one object the shell tools,
 *                 /sys/class/gpio and Python all drive
 *   the rig       ChalkLab.Pi.Rig: one Linux machine (lab_pi_os.js) per Pi
 *                 on the bench, booted when the power comes on, its SD
 *                 card kept in the saved circuit
 *
 * The terminal window is lab_pi_term.js. Everything here runs under Node.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var P = L.P, add = L.addPart, S = L.svg, text = S.text, shadow = S.shadow;
  var OS = L.PiOS, MODELS = L.MODELS;
  var Pi = L.Pi = {};
  var VHI = 3.3;

  /* ================================================================ PINS */

  var counts = {}, PINS = [], GROUPS = { GND: [], "5V": [], "3V3": [] };
  OS.J8.forEach(function (p, i) {
    var name = p[0], bcm = p[1];
    if (bcm == null) { counts[name] = (counts[name] || 0) + 1; var n = name === "GND" ? "GND" + counts[name] : counts[name] === 1 ? name : name + counts[name]; GROUPS[name].push(n); name = n; }
    else if (bcm < 2) name = p[2];
    /* odd pins are the inner row, even pins the row along the board's edge */
    PINS.push({ n: name, x: (4 + Math.floor(i / 2)) * P, y: (i % 2 ? 1 : 2) * P, label: p[0] + (p[2] && bcm >= 2 ? " (" + p[2] + ")" : "") + " · pin " + (i + 1), phys: i + 1, bcm: bcm, kind: p[0] });
  });
  Pi.PINS = PINS;
  Pi.pinName = function (bcm) { return "GPIO" + bcm; };
  var BCMS = PINS.filter(function (p) { return p.bcm != null && p.bcm >= 2; }).map(function (p) { return p.bcm; });

  /* The pins as software sees them. host says what the circuit is doing:
   *   host.volts(n)  volts on GPIOn, or null when there is no circuit yet
   *   host.echo(n)   centimetres from an HC-SR04 whose ECHO is on GPIOn
   *   host.stamp()   changes whenever the circuit has been re-solved
   *   host.fx(kind, n, value)   something worth showing on the bench */
  Pi.gpio = function (host) {
    host = host || {};
    var pins = {}, servos = {};
    var idle = function (n) { return n <= 8 ? 1 : 0; };          /* the pull each pin has at power-on */
    var stamp = function () { return host.stamp ? host.stamp() : 0; };
    var fx = function (kind, n, v) { if (host.fx) host.fx(kind, n, v); };
    var g = {
      pins: pins, servos: servos,
      valid: function (n) { return typeof n === "number" && n % 1 === 0 && n >= 2 && n <= 27; },
      setup: function (n, mode, user) {
        var m = mode === "out" ? "OUT" : mode === "pu" ? "PU" : mode === "pd" ? "PD" : "IN", was = pins[n];
        pins[n] = { mode: m, out: was && was.mode === "OUT" && m === "OUT" ? was.out : false, pwm: null, freq: 100, tone: 0, t0: stamp(), user: user || (was && was.user) || null };
        delete servos[n];
        fx("mode", n, m);
      },
      write: function (n, v) { var p = pins[n]; if (!p || p.mode !== "OUT") return; var on = !!v; p.pwm = null; p.tone = 0; if (p.out !== on) { p.out = on; fx("write", n, on ? 1 : 0); } },
      pwm: function (n, duty, freq) {
        var p = pins[n]; if (!p) return;
        if (duty == null) { p.pwm = null; return; }
        var v = Math.round(Math.max(0, Math.min(1, duty)) * 255);
        if (freq) p.freq = freq;
        if (p.pwm !== v) { p.pwm = v; p.tone = 0; fx("pwm", n, v); }
      },
      tone: function (n, hz) { var p = pins[n]; if (!p) return; if (p.tone !== hz) { p.tone = hz || 0; p.pwm = null; fx("tone", n, hz || 0); } },
      servo: function (n, angle) { if (angle == null) delete servos[n]; else if (servos[n] !== angle) { servos[n] = angle; fx("servo", n, Math.round(angle)); } },
      read: function (n) {
        var p = pins[n];
        if (p && p.mode === "OUT") return p.tone ? 0 : p.pwm != null ? (p.pwm > 127 ? 1 : 0) : p.out ? 1 : 0;
        var rest = !p ? idle(n) : p.mode === "PU" ? 1 : 0;
        /* a pull set this instant hasn't reached the wire yet: answer what it will settle to */
        if (p && p.t0 === stamp() && p.mode !== "IN") return rest;
        var v = host.volts ? host.volts(n) : null;
        return v == null ? rest : v > 1.65 ? 1 : 0;
      },
      volts: function (n) { return host.volts ? host.volts(n) : null; },
      echo: function (n) { return host.echo ? host.echo(n) : null; },
      release: function (n) { if (pins[n] || servos[n] != null) { delete pins[n]; delete servos[n]; fx("mode", n, "free"); } },
      busy: function (n) { return !!pins[n] && pins[n].mode === "OUT"; },
      state: function (n) {
        var p = pins[n];
        return { fn: p && p.mode === "OUT" ? "op" : "ip", pull: !p ? (idle(n) ? "pu" : "pd") : p.mode === "PU" ? "pu" : p.mode === "PD" ? "pd" : "pn", level: g.read(n), user: p ? p.user : null, pwm: p ? p.pwm : null, tone: p ? p.tone : 0, set: !!p };
      },
      inUse: function () { return BCMS.filter(function (n) { return pins[n]; }).sort(function (a, b) { return a - b; }).map(function (n) { return "GPIO" + n; }); },
      resetAll: function () { Object.keys(pins).forEach(function (k) { delete pins[k]; }); Object.keys(servos).forEach(function (k) { delete servos[k]; }); },
      /* the same pins, with every claim signed: gpioinfo then says who holds a line */
      as: function (user) {
        var o = Object.create(g);
        o.setup = function (n, mode) { g.setup(n, mode, user); if (pins[n]) pins[n].user = user; };
        return o;
      }
    };
    return g;
  };

  /* ================================================================ PART */

  var OS_LABEL = { raspios: ["Pi OS", "#c51a4a"], ubuntu: ["Ubuntu", "#e95420"], debian: ["Debian", "#a80030"] };
  var PAD = { "3V3": "#f0a03c", "5V": "#e2463c", GND: "#3a3f45" };

  add("raspberry_pi", {
    name: "Raspberry Pi", cat: "Boards", layer: "part", computer: true, under: true,
    blurb: "A small Linux computer. Its 40 pins work at 3.3 V, not 5 V. Switch the power on, open the Terminal, and run Python on it.",
    pins: PINS.map(function (p) { return { n: p.n, x: p.x, y: p.y, label: p.label }; }),
    buses: [GROUPS.GND, GROUPS["5V"], GROUPS["3V3"]],
    box: { x: 0, y: 0, w: 35 * P, h: 22.4 * P },
    props: { os: "raspios" },
    spec: [{ k: "os", label: "SD card", type: "select", options: [["raspios", "Raspberry Pi OS"], ["ubuntu", "Ubuntu 24.04"], ["debian", "Debian 12"]] }],
    label: function (pr) { return (OS_LABEL[pr.os] || OS_LABEL.raspios)[0]; },
    art: function (part, pr) {
      var W = 34 * P, H = 22.4 * P, s = shadow(0, 0, W, H, 14), os = OS_LABEL[pr.os] || OS_LABEL.raspios, r = function (x, y, w, h, rx, fill, extra) { return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + (rx || 0) + '" fill="' + fill + '"' + (extra || "") + '/>'; };
      s += r(0, 0, W, H, 14, "#1f8a46", ' stroke="#156233" stroke-width="2"');
      /* faint traces, so it reads as a circuit board at a glance */
      s += '<g stroke="#3fae66" stroke-width="1.6" fill="none" opacity=".4"><path d="M100 70V150H250L290 190V250"/><path d="M180 70V120H380V200"/><path d="M300 70V104H470V240H560"/><path d="M420 70V130H520"/><path d="M90 330H230V290"/><path d="M360 330V380H520"/><path d="M130 250H60V180"/></g>';
      [[3.5 * P / 1, 3.5 * P], [W - 9.5 * P, 3.5 * P], [3.5 * P, H - 3.5 * P], [W - 9.5 * P, H - 3.5 * P]].forEach(function (h) { s += '<circle cx="' + h[0] + '" cy="' + h[1] + '" r="9" fill="#e9d8a6" stroke="#b49b55"/><circle cx="' + h[0] + '" cy="' + h[1] + '" r="5" fill="#1d2a2c"/>'; });
      /* the SD card, peeking out of the left edge with its Linux written on it */
      s += r(-10, 8.2 * P, 3.4 * P, 4.6 * P, 3, "#2b2f36", ' stroke="#111"') + r(-6, 8.6 * P, 2.3 * P, 3.8 * P, 2, os[1]) + text(-6 + 1.15 * P, 10.5 * P, os[0], 8.5, "#fff", { rot: -90, weight: 800 });
      /* USB-C power, two micro-HDMI, audio — along the bottom edge */
      s += r(3.6 * P, H - 1.5 * P, 3.6 * P, 1.9 * P, 4, "#c3c9ce", ' stroke="#7d858b" stroke-width="1.5"') + text(5.4 * P, H - 2.2 * P, "PWR IN", 7.5, "#d8f3e0", { weight: 700 });
      [9.6, 15].forEach(function (x, i) { s += r(x * P, H - 1.4 * P, 2.9 * P, 1.8 * P, 3, "#c3c9ce", ' stroke="#7d858b" stroke-width="1.5"') + text((x + 1.45) * P, H - 2.1 * P, "HDMI" + i, 7.5, "#d8f3e0", { weight: 700 }); });
      s += '<circle cx="' + (21.8 * P) + '" cy="' + (H - 0.3 * P) + '" r="15" fill="#1b1b1d"/><circle cx="' + (21.8 * P) + '" cy="' + (H - 0.3 * P) + '" r="7" fill="#3a3f45"/>';
      /* camera and display ribbons */
      s += r(18.4 * P, 13.2 * P, 0.9 * P, 5.6 * P, 2, "#ece8dd", ' stroke="#8f8a7c"') + r(1.2 * P, 6.2 * P, 0.9 * P, 5.6 * P, 2, "#ece8dd", ' stroke="#8f8a7c"');
      /* the processor, memory and the radio can */
      s += r(9.2 * P, 7.6 * P, 5.6 * P, 5.6 * P, 5, "#c9ced3", ' stroke="#8a9196" stroke-width="2"') + text(12 * P, 9.9 * P, "BROADCOM", 9, "#5a6066", { weight: 800 }) + text(12 * P, 11.1 * P, "BCM2711", 9, "#5a6066", { weight: 700 });
      s += r(16.6 * P, 7.9 * P, 4.4 * P, 4.9 * P, 3, "#1b1b1d") + text(18.8 * P, 10.4 * P, "4GB", 11, "#8f979e", { weight: 700 });
      s += r(3.4 * P, 5 * P, 4.4 * P, 3.4 * P, 3, "#d6dade", ' stroke="#8a9196" stroke-width="1.5"') + '<path d="M' + (4.2 * P) + ' ' + (6.9 * P) + 'q' + (0.7 * P) + ' -' + (1.4 * P) + ' ' + (1.4 * P) + ' 0M' + (4.7 * P) + ' ' + (7.3 * P) + 'q' + (0.4 * P) + ' -' + (0.8 * P) + ' ' + (0.9 * P) + ' 0" stroke="#6a7177" stroke-width="2" fill="none"/>' + text(6.7 * P, 6.7 * P, "Wi-Fi", 7.5, "#5a6066", { weight: 700 });
      s += r(22.6 * P, 13.4 * P, 2.6 * P, 2.6 * P, 3, "#1b1b1d") + r(24.2 * P, 7.6 * P, 2.4 * P, 2.4 * P, 3, "#1b1b1d");
      /* Ethernet and the two USB stacks hang over the right-hand edge */
      s += r(W - 6.6 * P, 1.2 * P, 7.4 * P, 5.6 * P, 4, "#c3c9ce", ' stroke="#7d858b" stroke-width="2"') + r(W - 0.6 * P, 2 * P, 1.2 * P, 4 * P, 2, "#8e969c") + text(W - 3.2 * P, 4 * P, "ETHERNET", 9, "#5a6066", { weight: 800 });
      [8.2, 15].forEach(function (y, i) { s += r(W - 6 * P, y * P, 7 * P, 5.4 * P, 4, "#c3c9ce", ' stroke="#7d858b" stroke-width="2"') + r(W - 0.3 * P, (y + 0.7) * P, 1.1 * P, 1.6 * P, 1, i ? "#2a2a2c" : "#2f6fd1") + r(W - 0.3 * P, (y + 3.1) * P, 1.1 * P, 1.6 * P, 1, i ? "#2a2a2c" : "#2f6fd1") + text(W - 3 * P, (y + 2.7) * P, i ? "USB 2" : "USB 3", 9, "#5a6066", { weight: 800 }); });
      s += text(12.4 * P, 15.6 * P, "Raspberry Pi 4", 21, "#eafff0", { weight: 800 }) + text(12.4 * P, 17.1 * P, "Model B · 3.3 V logic", 10.5, "#bfe8cb", { weight: 700 });
      /* the 40-pin header */
      s += r(3.4 * P, 0.42 * P, 20.2 * P, 2.16 * P, 3, "#17181a", ' stroke="#000"');
      PINS.forEach(function (p) {
        var fill = PAD[p.kind] || "#e3b54a";
        s += '<rect x="' + (p.x - 4.4) + '" y="' + (p.y - 4.4) + '" width="8.8" height="8.8" rx="1.5" fill="' + (p.phys === 1 ? "#f0a03c" : "#2a2c2f") + '"/><circle cx="' + p.x + '" cy="' + p.y + '" r="2.9" fill="' + fill + '"/>';
        if (p.y > 1.5 * P) s += text(p.x, 3.55 * P, p.bcm != null ? String(p.bcm) : p.kind, 7.6, p.bcm != null ? "#eafff0" : p.kind === "GND" ? "#a8d8b6" : "#ffd9a8", { rot: -90, weight: 700, anchor: "end" });
      });
      s += text(3 * P, 2 * P, "1", 8, "#ffd9a8", { weight: 800 }) + text(24.2 * P, 1 * P, "40", 8, "#eafff0", { weight: 800 });
      s += text(25.4 * P, 4.3 * P, "GPIO", 9, "#bfe8cb", { weight: 800, anchor: "start" });
      /* power and activity lights */
      s += '<g data-live="pwr"><rect x="' + (0.7 * P) + '" y="' + (14.6 * P) + '" width="13" height="8" rx="2" fill="#5a1a1a"/></g>' + text(1.6 * P, 15.1 * P, "PWR", 7.5, "#d8f3e0", { anchor: "start", weight: 700 });
      s += '<g data-live="act"><rect x="' + (0.7 * P) + '" y="' + (15.9 * P) + '" width="13" height="8" rx="2" fill="#1d4a25"/></g>' + text(1.6 * P, 16.4 * P, "ACT", 7.5, "#d8f3e0", { anchor: "start", weight: 700 });
      return s;
    },
    live: function (g, st) { L.setFill(g.pwr, st.on ? "#ff4a3a" : "#5a1a1a"); L.setFill(g.act, st.act ? "#5bff7a" : "#1d4a25"); },
    glow: function (st) {
      var out = [];
      if (st.on) out.push({ x: 1.05 * P, y: 14.8 * P, r: 15, c: "#ff4a3a", a: 0.7 });
      if (st.act) out.push({ x: 1.05 * P, y: 16.1 * P, r: 15, c: "#5bff7a", a: 0.75 });
      return out;
    }
  });

  /* ============================================================= PHYSICS */

  function entry(sim, id) { return sim.pi ? sim.pi[id] || null : null; }
  Pi.entry = entry;

  MODELS.raspberry_pi = {
    dynamic: true, mcu: true,
    build: function (b) {
      var m = { v5: b.add(new L.Norton(1 / 0.05, 5 / 0.05), ["5V", "GND1"]), v33: b.add(new L.Norton(1 / 0.3, VHI / 0.3), ["3V3", "GND1"]), pins: {}, nameOf: {} };
      BCMS.forEach(function (n) { m.pins[n] = b.add(new L.Norton(1e-8, 0), ["GPIO" + n, "GND1"]); m.nameOf[n] = "GPIO" + n; });
      return m;
    },
    pre: function (m, ctx) {
      var e = entry(ctx.sim, ctx.part.id), up = e && e.rt.running, t = ctx.sim.t;
      for (var num in m.pins) {
        var dev = m.pins[num], ps = up ? e.gpio.pins[num] : null;
        if (!up) { dev.gv = 1e-8; dev.is = 0; continue; }
        if (!ps) { dev.gv = 1 / 50000; dev.is = +num <= 8 ? VHI / 50000 : 0; continue; }       /* untouched since boot: its default pull */
        if (ps.mode === "IN") { dev.gv = 1e-8; dev.is = 0; continue; }
        if (ps.mode === "PU") { dev.gv = 1 / 50000; dev.is = VHI / 50000; continue; }
        if (ps.mode === "PD") { dev.gv = 1 / 50000; dev.is = 0; continue; }
        var hi = ps.out;
        if (ps.tone > 0) hi = ((t * 125) % 1) < 0.5;
        else if (ps.pwm != null) { var duty = ps.pwm / 255; hi = duty >= 1 ? true : duty <= 0 ? false : ((t * 125) % 1) < duty; }
        dev.gv = 1 / 30; dev.is = hi ? VHI / 30 : 0;
      }
    },
    post: function (m, ctx) {
      var e = entry(ctx.sim, ctx.part.id), st = ctx.st, total = 0;
      st.on = true;
      st.act = !!(e && e.act);
      st.busy = !!(e && e.rt.running);
      for (var num in m.pins) {
        var dev = m.pins[num], i = Math.abs(dev.cur[0]), v = ctx.v(dev.n[0]) - ctx.v(dev.n[1]), ps = e && e.gpio.pins[num], out = ps && ps.mode === "OUT";
        if (out) total += i;
        if (out && i > 0.017) ctx.sim.warn(ctx.part.id, "danger", "pin" + num, "GPIO" + num + " is supplying " + L.si(i, "A") + ". A Pi pin can safely give about 16 mA — less than an Arduino's. Use a bigger resistor (220 Ω suits an LED), or a transistor for anything hungrier.");
        if (v > 3.7) ctx.sim.warn(ctx.part.id, "danger", "over" + num, "GPIO" + num + " has " + v.toFixed(1) + " V on it. A Pi's pins are 3.3 V only — on a real Pi this would damage it for good. Power the part from a 3V3 pin instead, or bring the signal down with two resistors.");
      }
      if (total > 0.051) ctx.sim.warn(ctx.part.id, "danger", "sum", "The GPIO pins are supplying " + L.si(total, "A") + " between them. All of them together should stay under about 50 mA.");
      var i33 = Math.abs(m.v33.cur[0] - VHI / 0.3 + (ctx.v(m.v33.n[0]) - ctx.v(m.v33.n[1])) / 0.3);
      if (i33 > 0.5) ctx.sim.warn(ctx.part.id, "danger", "3v3", "The 3V3 pin is supplying " + L.si(i33, "A") + ". Its regulator manages about 500 mA — is something shorted?");
    }
  };

  /* =================================================================== RIG */

  /* Keeps one Linux machine per Pi on the bench in step with the bench:
   * boots it when the power comes on, feeds it time, and writes its SD card
   * back into the document (as that part's "program") whenever it changes. */
  function Rig(sim, getDoc, hooks) { this.sim = sim; this.getDoc = getDoc; this.hooks = hooks || {}; sim.pi = sim.pi || {}; this.doc = null; }
  Pi.Rig = Rig;

  Rig.prototype.parts = function () { return (this.getDoc().parts || []).filter(function (p) { return p.type === "raspberry_pi"; }); };
  Rig.prototype.label = function (part) { var list = this.parts(); return "Raspberry Pi" + (list.length > 1 ? " " + (list.indexOf(part) + 1) : ""); };
  Rig.prototype.entry = function (id) { return this.sim.pi[id] || null; };

  Rig.prototype.make = function (part) {
    var self = this, sim = this.sim, doc = this.getDoc(), pr = L.propsOf(part), id = part.id, e = { id: id, os: pr.os, act: false };
    var saved = doc.programs && doc.programs[id] && typeof doc.programs[id].code === "string" ? doc.programs[id].code : "";
    e.gpio = Pi.gpio({
      volts: function (n) { return sim.topo && !sim.topoDirty ? sim.mcuVolts(id, n) : null; },
      echo: function (n) { return sim.topo ? sim.echoDistance(id, n) : null; },
      stamp: function () { return sim.t; },
      fx: function (kind, n, v) { if (self.hooks.fx) self.hooks.fx(id, kind, n, v); }
    });
    e.rt = { keep: true, isPi: true, running: false, paused: false, pins: e.gpio.pins, servos: e.gpio.servos, txUntil: 0, stop: function () {}, advance: function () {}, uartIn: function () {}, send: function () {} };
    e.m = new OS.Machine({
      os: pr.os, host: typeof pr.host === "string" && pr.host ? pr.host : null, gpio: e.gpio, sd: /^#!chalk-sd/.test(saved) ? saved : "",
      clock: this.hooks.clock,
      link: this.hooks.link ? this.hooks.link() : null,
      onChange: function (sd) {
        var d = self.getDoc();
        d.programs = d.programs || {};
        d.programs[id] = { code: sd, prog: "code", blocks: null };
        if (self.hooks.changed) self.hooks.changed(id);
      },
      onHost: function (name) { var p = self.parts().filter(function (q) { return q.id === id; })[0]; if (p) { p.props = p.props || {}; p.props.host = name; if (self.hooks.changed) self.hooks.changed(id); } }
    });
    sim.pi[id] = e;
    return e;
  };

  /* Call once a frame (and after every sim.step in a test). */
  Rig.prototype.sync = function (running) {
    var sim = this.sim, self = this, doc = this.getDoc(), seen = {};
    if (doc !== this.doc) { this.drop(); this.doc = doc; }
    this.parts().forEach(function (part) {
      var e = sim.pi[part.id], pr = L.propsOf(part);
      seen[part.id] = 1;
      if (e && e.os !== pr.os) {
        /* a different Linux was flashed onto the card: the home folder is kept */
        var sd = e.m.fs ? e.m.packSD() : e.m.sdText;
        e.m.powerOff(); delete sim.pi[part.id];
        doc.programs = doc.programs || {}; doc.programs[part.id] = { code: sd, prog: "code", blocks: null };
        e = null;
        if (self.hooks.flashed) self.hooks.flashed(part.id, pr.os);
      }
      if (!e) e = self.make(part);
      sim.runtimes[part.id] = e.rt;
      var m = e.m;
      if (running && m.state === "off") m.powerOn(sim.t);
      else if (!running && m.state !== "off") m.powerOff();
      if (running) m.advance(sim.t);
      e.rt.running = m.state === "booting" || m.state === "on" || m.state === "halting";
      /* the green light: busy while booting, a flicker whenever a program is running, a slow fade once halted */
      var busy = m.procs.some(function (p) { return !p.sys; });
      e.act = m.state === "booting" || m.state === "halting" ? (sim.wall * 9) % 1 < 0.6 : m.state === "on" ? (busy ? (sim.wall * 5) % 1 < 0.35 : (sim.wall * 0.5) % 1 < 0.06) : m.state === "halted" && m.haltT != null && sim.t - m.haltT < 2.2 ? ((sim.t - m.haltT) * 4.5) % 1 < 0.5 : false;
    });
    Object.keys(sim.pi).forEach(function (id) { if (!seen[id]) { sim.pi[id].m.powerOff(); delete sim.pi[id]; if (sim.runtimes[id] && sim.runtimes[id].isPi) delete sim.runtimes[id]; } });
  };
  Rig.prototype.drop = function () {
    var sim = this.sim;
    Object.keys(sim.pi).forEach(function (id) { sim.pi[id].m.powerOff(); delete sim.pi[id]; if (sim.runtimes[id] && sim.runtimes[id].isPi) delete sim.runtimes[id]; });
  };
  /* Unplug one Pi and plug it back in. */
  Rig.prototype.cycle = function (id) { var e = this.sim.pi[id]; if (e) { e.m.powerOff(); e.m.powerOn(this.sim.t); } };

  /* The files on a Pi's card, for the Files panel and for examples. */
  Pi.sdOf = function (doc, id) { var p = doc.programs && doc.programs[id]; return p && /^#!chalk-sd/.test(p.code || "") ? p.code : ""; };
  Pi.setSD = function (doc, id, sd) { doc.programs = doc.programs || {}; doc.programs[id] = { code: sd, prog: "code", blocks: null }; };
  Pi.pis = function (doc) { return (doc.parts || []).filter(function (p) { return p.type === "raspberry_pi"; }); };
})(typeof window !== "undefined" ? window : globalThis);
