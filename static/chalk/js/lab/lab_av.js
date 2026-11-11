/* Chalk Circuit Lab — eyes, ears and a voice.
 *
 *   Camera      a smart camera module on I²C. It does the looking itself
 *               and answers in numbers: how bright the scene is, how much
 *               is moving, whether it can see something red, green or blue
 *               and where. `#include <SmartCamera.h>`
 *   Microphone  an amplified microphone. Its OUT leg is a voltage that
 *               follows how loud it is — read it with analogRead(). Click
 *               the part to clap at it.
 *   Speaker     a speaker with its own amplifier and voice module. It plays
 *               tone() like a piezo, only louder, and it can talk:
 *               `#include <Speaker.h>`, then voice.say("Hello").
 *
 * Each can run on a made-up scene you set in the Inspect panel — so a
 * lesson works on any computer — or, with one tick, on the real thing:
 * this computer's own camera and microphone. Nothing is recorded and
 * nothing leaves the browser: every frame is boiled down to the same few
 * numbers on the spot and thrown away, and the camera and microphone are
 * released the moment no powered part is asking for them.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var P = L.P, add = L.addPart, S = L.svg, text = S.text, lead = S.lead, shadow = S.shadow;
  var MODELS = L.MODELS, Sim = L.Sim;

  function R(b, a, c, ohms) { return b.add(new (L.Norton)(1 / ohms, 0), [a, c]); }
  function setV(dev, volts, r) { dev.gv = 1 / r; dev.is = volts / r; }
  function vAcross(ctx, dev) { return ctx.v(dev.n[0]) - ctx.v(dev.n[1]); }

  /* ====================================================== LIVE CAPTURE */

  /* The real camera and microphone, reduced to numbers. Browser only. */
  var AV = L.AV = { mic: { level: 0, on: false, want: 0 }, cam: { view: null, on: false, want: 0 }, told: {} };

  function tell(key, msg) {
    if (AV.told[key]) return;
    AV.told[key] = 1;
    if (root.chalkLab && root.chalkLab.toast) root.chalkLab.toast(msg);
  }
  function media() { return root.navigator && root.navigator.mediaDevices && root.navigator.mediaDevices.getUserMedia ? root.navigator.mediaDevices : null; }

  AV.needMic = function () {
    var m = AV.mic;
    m.want = Date.now();
    if (m.on || m.starting || m.failed) return;
    if (!media()) { m.failed = true; tell("mic", "This browser can't share its microphone here, so the microphone part is using its slider instead."); return; }
    m.starting = true;
    media().getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function (stream) {
      var AC = root.AudioContext || root.webkitAudioContext, ac = new AC(), src = ac.createMediaStreamSource(stream), an = ac.createAnalyser();
      an.fftSize = 512;
      src.connect(an);                       /* not connected to the speakers: listening only */
      m.stream = stream; m.ac = ac; m.an = an; m.buf = new Uint8Array(an.fftSize); m.on = true; m.starting = false;
    }, function () { m.failed = true; m.starting = false; tell("mic", "The microphone wasn't allowed, so the microphone part is using its slider instead."); });
  };
  AV.needCam = function () {
    var c = AV.cam;
    c.want = Date.now();
    if (c.on || c.starting || c.failed) return;
    if (!media()) { c.failed = true; tell("cam", "This browser can't share its camera here, so the camera part is using its made-up scene instead."); return; }
    c.starting = true;
    media().getUserMedia({ video: { width: 160, height: 120, facingMode: "user" } }).then(function (stream) {
      var v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.srcObject = stream;
      var p = v.play(); if (p && p.catch) p.catch(function () {});
      c.stream = stream; c.video = v; c.canvas = document.createElement("canvas"); c.canvas.width = 80; c.canvas.height = 60;
      c.ctx = c.canvas.getContext("2d", { willReadFrequently: true }); c.prev = null; c.on = true; c.starting = false;
    }, function () { c.failed = true; c.starting = false; tell("cam", "The camera wasn't allowed, so the camera part is using its made-up scene instead."); });
  };
  function release(dev) {
    if (dev.stream) dev.stream.getTracks().forEach(function (t) { t.stop(); });
    if (dev.ac && dev.ac.close) { try { dev.ac.close(); } catch (e) {} }
    dev.stream = dev.ac = dev.an = dev.video = dev.ctx = null; dev.on = false;
  }

  /* One camera frame → what a smart camera would report. Colours are found
   * the way cheap colour trackers do it: count the pixels that are clearly
   * more one primary than the other two, and take the middle of them. */
  AV.look = function (data, w, h, prev) {
    var n = w * h, sum = 0, diff = 0, cnt = [0, 0, 0], sx = [0, 0, 0], sy = [0, 0, 0], gray = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], y = (r * 3 + g * 6 + b) / 10;
      gray[i] = y; sum += y;
      if (prev) diff += Math.abs(y - prev[i]) > 18 ? 1 : 0;
      var mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx > 80 && mx - mn > 70) {
        var k = r === mx && r > g * 1.5 && r > b * 1.5 ? 0 : g === mx && g > r * 1.25 && g > b * 1.25 ? 1 : b === mx && b > r * 1.4 && b > g * 1.15 ? 2 : -1;
        if (k >= 0) { cnt[k]++; sx[k] += i % w; sy[k] += (i / w) | 0; }
      }
    }
    var best = cnt[0] >= cnt[1] && cnt[0] >= cnt[2] ? 0 : cnt[1] >= cnt[2] ? 1 : 2, share = cnt[best] / n;
    var seen = share > 0.02;
    return {
      gray: gray,
      view: {
        brightness: Math.round(sum / n), motion: Math.min(100, Math.round(diff / n * 400)),
        colour: seen ? best + 1 : 0,
        /* the webcam picture is a mirror image: flip it so right is right */
        x: seen ? Math.round(-(sx[best] / cnt[best] / (w - 1) * 200 - 100)) : 0,
        y: seen ? Math.round(100 - sy[best] / cnt[best] / (h - 1) * 200) : 0,
        size: seen ? Math.min(100, Math.round(share * 250)) : 0, faces: 0
      }
    };
  };

  if (typeof document !== "undefined") {
    root.setInterval(function () {
      var m = AV.mic, c = AV.cam, now = Date.now();
      if (m.on) {
        if (now - m.want > 2500) release(m);
        else {
          m.an.getByteTimeDomainData(m.buf);
          var sq = 0;
          for (var i = 0; i < m.buf.length; i++) { var d = (m.buf[i] - 128) / 128; sq += d * d; }
          /* loudness on a scale where talking is about 40 and a clap is 90+ */
          var lvl = Math.min(100, Math.sqrt(sq / m.buf.length) * 420);
          m.level = lvl > m.level ? lvl : m.level * 0.75 + lvl * 0.25;
        }
      }
      if (c.on) {
        if (now - c.want > 2500) { release(c); c.view = null; }
        else if (c.video && c.video.readyState >= 2) {
          try {
            c.ctx.drawImage(c.video, 0, 0, 80, 60);
            var res = AV.look(c.ctx.getImageData(0, 0, 80, 60).data, 80, 60, c.prev);
            c.prev = res.gray; c.view = res.view;
          } catch (e) {}
        }
      }
    }, 90);
    root.addEventListener("pagehide", function () { release(AV.mic); release(AV.cam); });
  }

  /* ================================================================ ART */

  function pinsRow(names, y) { var s = ""; names.forEach(function (_, i) { s += lead(i * P, 0, i * P, y); }); return s; }
  function pinLabels(names, y, col) { var s = ""; names.forEach(function (nm, i) { s += text(i * P, y, nm, 6, col || "#e8eef4", { rot: -90 }); }); return s; }

  function micArt() {
    var x = -0.8 * P, y = -5.4 * P, w = 3.6 * P, h = 4.9 * P, cx = P, cy = -3.4 * P, s = pinsRow(["VCC", "GND", "OUT"], -0.6 * P);
    s += shadow(x, y, w, h, 4) + '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="4" fill="#b3261e" stroke="#7a1712"/>';
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (1.05 * P) + '" fill="#c9ced3" stroke="#7f878c" stroke-width="1.5"/>';
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (0.8 * P) + '" fill="#17191b"/>';
    for (var i = -1; i <= 1; i++) for (var j = -1; j <= 1; j++) s += '<circle cx="' + (cx + i * 6) + '" cy="' + (cy + j * 6) + '" r="1.5" fill="#3a3d40"/>';
    s += '<g data-live="bars">';
    for (var k = 0; k < 5; k++) s += '<rect x="' + (x + 6 + k * 12.5) + '" y="' + (y + 5) + '" width="9" height="5" rx="1.5" fill="#4a0f0b"/>';
    s += '</g>' + text(cx, -1.9 * P, "MIC", 7.5, "#ffd9d5", { weight: 800 }) + pinLabels(["VCC", "GND", "OUT"], -1.15 * P);
    return s;
  }
  function micLive(g, st) {
    if (!g.bars) return;
    var lit = Math.round((st.level || 0) / 20), kids = g.bars.childNodes;
    for (var i = 0; i < kids.length; i++) kids[i].setAttribute("fill", i < lit ? (i > 3 ? "#ff6a5a" : i > 2 ? "#ffd36b" : "#7dffa8") : "#4a0f0b");
  }

  function speakerArt() {
    var x = -1.2 * P, y = -7.4 * P, w = 4.4 * P, h = 6.9 * P, cx = P, cy = -4.4 * P, r = 1.85 * P, s = pinsRow(["VCC", "GND", "IN"], -0.6 * P);
    s += shadow(x, y, w, h, 5) + '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="5" fill="#22303c" stroke="#111a22"/>';
    s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#101418" stroke="#59636b" stroke-width="2"/>';
    s += '<g data-live="cone"><circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.78) + '" fill="#2a2f35" stroke="#3a4046"/><circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 0.3) + '" fill="#15181b"/></g>';
    s += '<g data-live="waves" opacity="0" stroke="#ffcf5a" stroke-width="2.4" fill="none" stroke-linecap="round">' +
      '<path d="M' + (cx + r + 5) + ' ' + (cy - 9) + 'q8 9 0 18"/><path d="M' + (cx + r + 13) + ' ' + (cy - 16) + 'q14 16 0 32"/><path d="M' + (cx - r - 5) + ' ' + (cy - 9) + 'q-8 9 0 18"/><path d="M' + (cx - r - 13) + ' ' + (cy - 16) + 'q-14 16 0 32"/></g>';
    s += '<g data-live="bubble" opacity="0"><rect x="' + (cx - 3.4 * P) + '" y="' + (y - 1.9 * P) + '" width="' + (6.8 * P) + '" height="' + (1.5 * P) + '" rx="9" fill="#fff8e1" stroke="#c9a03c"/>' +
      '<path d="M' + (cx - 6) + ' ' + (y - 0.4 * P - 1) + 'l6 9 6 -9z" fill="#fff8e1" stroke="#c9a03c"/>' +
      '<text data-live="words" x="' + cx + '" y="' + (y - 1.15 * P) + '" font-size="11" font-weight="700" fill="#3a2a00" text-anchor="middle" dominant-baseline="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif"></text></g>';
    s += text(cx, -1.9 * P, "SPEAKER", 6.5, "#9fb3c4", { weight: 800 }) + pinLabels(["VCC", "GND", "IN"], -1.15 * P);
    return s;
  }
  function speakerLive(g, st) {
    var loud = st.sound || st.say;
    if (g.waves) g.waves.setAttribute("opacity", loud ? (0.45 + 0.55 * Math.abs(Math.sin(Date.now() / 80))).toFixed(2) : 0);
    if (g.cone) g.cone.setAttribute("transform", loud ? "translate(0 " + (Math.sin(Date.now() / 22) * 0.9).toFixed(2) + ")" : "");
    if (g.bubble) g.bubble.setAttribute("opacity", st.say ? 1 : 0);
    if (g.words && st.say) { var want = st.say.length > 23 ? st.say.slice(0, 22) + "…" : st.say; if (g.words.textContent !== want) g.words.textContent = want; }
  }

  var CAM_COL = ["none", "#ff4a3a", "#4dff7a", "#4a8dff"];
  function camArt() {
    var x = -1.1 * P, y = -8.2 * P, w = 5.2 * P, h = 7.7 * P, cx = 1.5 * P, s = pinsRow(["VCC", "GND", "SDA", "SCL"], -0.6 * P);
    s += shadow(x, y, w, h, 5) + '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="5" fill="#16202a" stroke="#0b1218"/>';
    /* the lens */
    s += '<circle cx="' + cx + '" cy="' + (y + 1.75 * P) + '" r="' + (1.25 * P) + '" fill="#0c0f12" stroke="#7f878c" stroke-width="2.5"/>';
    s += '<circle cx="' + cx + '" cy="' + (y + 1.75 * P) + '" r="' + (0.75 * P) + '" fill="#1b2a44"/><circle cx="' + (cx - 5) + '" cy="' + (y + 1.75 * P - 5) + '" r="3.5" fill="#fff" opacity=".45"/>';
    s += '<g data-live="rec" opacity="0"><circle cx="' + (x + w - 9) + '" cy="' + (y + 9) + '" r="4" fill="#ff3b30"/></g>';
    s += '<circle data-live="flash" cx="' + (x + 9) + '" cy="' + (y + 9) + '" r="4" fill="#3a4046"/>';
    /* what it sees: a little viewfinder */
    var vx = x + 0.45 * P, vy = y + 3.4 * P, vw = w - 0.9 * P, vh = 2.6 * P;
    s += '<rect data-live="view" x="' + vx + '" y="' + vy + '" width="' + vw + '" height="' + vh + '" rx="3" fill="#0a0d10" stroke="#3a4856"/>';
    s += '<path d="M' + (vx + vw / 2) + ' ' + (vy + 3) + 'v' + (vh - 6) + '" stroke="#3a4856" stroke-width=".8" stroke-dasharray="2 2"/>';
    s += '<g data-live="person" opacity="0" fill="#cfd8e0"><circle cx="' + (vx + vw / 2) + '" cy="' + (vy + 13) + '" r="6"/><path d="M' + (vx + vw / 2 - 11) + ' ' + (vy + vh - 2) + 'q11 -34 22 0z"/></g>';
    s += '<circle data-live="blob" cx="' + (vx + vw / 2) + '" cy="' + (vy + vh / 2) + '" r="8" fill="#ff4a3a" opacity="0"/>';
    s += text(cx, -1.9 * P, "SMART CAM", 6, "#9fb3c4", { weight: 800 }) + pinLabels(["VCC", "GND", "SDA", "SCL"], -1.15 * P);
    return s;
  }
  camArt.view = { x: -1.1 * P + 0.45 * P, y: -8.2 * P + 3.4 * P, w: 5.2 * P - 0.9 * P, h: 2.6 * P };
  function camLive(g, st) {
    var v = st.view, box = camArt.view;
    if (g.view) { var b = v ? Math.round(10 + v.brightness / 255 * 70) : 10; g.view.setAttribute("fill", "rgb(" + b + "," + (b + 4) + "," + (b + 10) + ")"); }
    if (g.blob) {
      if (v && v.colour) {
        g.blob.setAttribute("opacity", 1); g.blob.setAttribute("fill", CAM_COL[v.colour]);
        g.blob.setAttribute("cx", (box.x + box.w / 2 + v.x / 100 * (box.w / 2 - 8)).toFixed(1));
        g.blob.setAttribute("cy", (box.y + box.h / 2 - (v.y || 0) / 100 * (box.h / 2 - 8)).toFixed(1));
        g.blob.setAttribute("r", (3 + v.size / 100 * 12).toFixed(1));
      } else g.blob.setAttribute("opacity", 0);
    }
    if (g.person) g.person.setAttribute("opacity", v && v.faces ? 0.9 : 0);
    if (g.rec) g.rec.setAttribute("opacity", v && v.motion > 25 ? (0.4 + 0.6 * Math.abs(Math.sin(Date.now() / 140))).toFixed(2) : 0);
    if (g.flash) g.flash.setAttribute("fill", st.flash > 0 ? "#ffffff" : st.on ? "#7dffa8" : "#3a4046");
  }

  /* ============================================================== PARTS */

  add("mic", {
    name: "Microphone module", cat: "Sound & vision", press: true,
    blurb: "An amplified microphone. OUT is a voltage that follows how loud it is — quiet near 0 V, a clap near 5 V. Read it with analogRead(). Click and hold it to clap at it.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: P, y: 0 }, { n: "OUT", x: 2 * P, y: 0, label: "OUT (loudness, analog)" }],
    box: { x: -0.8 * P, y: -5.4 * P, w: 3.6 * P, h: 5.6 * P },
    props: { level: 8, live: false },
    spec: [{ k: "level", label: "How loud it is", type: "range", min: 0, max: 100, step: 1, unit: "%" },
           { k: "live", label: "Use this computer's microphone", type: "bool" }],
    art: micArt,
    live: function (g, st, pr) { if (pr.live && st.on) AV.needMic(); micLive(g, st); }
  });

  add("speaker", {
    name: "Speaker with voice", cat: "Sound & vision",
    blurb: "A speaker with its own amplifier and a voice module. tone() plays notes through it, louder than a piezo — and with Speaker.h it can talk: voice.say(\"Hello\").",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: P, y: 0 }, { n: "IN", x: 2 * P, y: 0, label: "IN (signal from a pin)" }],
    box: { x: -1.2 * P, y: -7.4 * P, w: 4.4 * P, h: 7.6 * P },
    props: {}, art: speakerArt, live: speakerLive
  });

  add("smart_cam", {
    name: "Smart camera", cat: "Sound & vision",
    blurb: "A camera that does its own looking and answers over I²C: how bright the scene is, how much is moving, and whether it can see something red, green or blue — and where. Set the scene below, or let it use this computer's camera.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: P, y: 0 }, { n: "SDA", x: 2 * P, y: 0, label: "SDA (to A4)" }, { n: "SCL", x: 3 * P, y: 0, label: "SCL (to A5)" }],
    box: { x: -1.1 * P, y: -8.2 * P, w: 5.2 * P, h: 8.4 * P },
    props: { scene: "room", pos: 0, near: 35, live: false },
    spec: [{ k: "scene", label: "It is looking at", type: "select", options: [["room", "An empty room"], ["person", "Someone walking past"], ["red", "A red ball"], ["green", "A green ball"], ["blue", "A blue ball"], ["dark", "A dark room"]] },
           { k: "pos", label: "Where it is, left to right", type: "range", min: -100, max: 100, step: 5 },
           { k: "near", label: "How near it is", type: "range", min: 5, max: 95, step: 5, unit: "%" },
           { k: "live", label: "Use this computer's camera", type: "bool" }],
    art: camArt,
    live: function (g, st, pr) { if (pr.live && st.on) AV.needCam(); camLive(g, st); }
  });

  /* ============================================================= MODELS */

  MODELS.mic = {
    build: function (b) { return { pwr: R(b, "VCC", "GND", 1e6), out: R(b, "OUT", "GND", 1e6) }; },
    pre: function (m, ctx) {
      var st = ctx.st, on = st.on, pr = ctx.props, lvl = pr.level || 0;
      if (pr.live && AV.mic.on) lvl = AV.mic.level;
      if (ctx.sim.pressed[ctx.part.id]) lvl = 96;                     /* a clap */
      /* a real microphone is never perfectly still */
      lvl = L.clamp(lvl + (lvl > 1 ? (Math.random() - 0.5) * 3 : 0), 0, 100);
      st.level = on ? lvl : 0;
      m.pwr.gv = on ? 1 / 2000 : 1e-6;
      setV(m.out, on ? 0.15 + lvl / 100 * 4.4 : 0, on ? 300 : 1e7);
    },
    post: function (m, ctx) {
      var vcc = vAcross(ctx, m.pwr);
      ctx.st.on = vcc > 2.6;
      if (vcc > 0.5 && vcc < 2.6) ctx.sim.warn(ctx.part.id, "warn", "lowpower", "The microphone needs 3–5 V on VCC.");
      if (vcc < -1) ctx.sim.warn(ctx.part.id, "danger", "reverse", "The microphone's power is the wrong way round.");
    }
  };

  MODELS.speaker = {
    build: function (b) { return { pwr: R(b, "VCC", "GND", 1e6), inp: R(b, "IN", "GND", 2e4) }; },
    pre: function (m, ctx) { m.pwr.gv = ctx.st.on ? 1 / (ctx.st.sound || ctx.st.say ? 60 : 800) : 1e-6; },
    post: function (m, ctx) {
      var st = ctx.st, vcc = vAcross(ctx, m.pwr), f = ctx.sim.toneOn(m.inp.n[0]);
      st.on = vcc > 3.5;
      st.sound = st.on && f ? f : 0;
      if (st.say && (ctx.sim.wall || ctx.sim.t || 0) > (st.sayUntil || 0)) { st.say = ""; st.shown = ""; }
      if (!st.on) st.say = "";
      if (vcc > 0.5 && vcc < 3.5) ctx.sim.warn(ctx.part.id, "warn", "lowpower", "The speaker's amplifier needs 5 V on VCC.");
      if (vcc < -1) ctx.sim.warn(ctx.part.id, "danger", "reverse", "The speaker's power is the wrong way round.");
    },
    reset: function () {}
  };

  /* What the made-up scene looks like to the camera. */
  function scene(pr, st, t, dt) {
    var s = pr.scene, v = { brightness: s === "dark" ? 12 : 150, motion: 0, colour: 0, x: 0, y: 0, size: 0, faces: 0 };
    if (s === "person") { v.faces = 1; v.motion = Math.round(60 + 30 * Math.sin(t * 3)); v.x = Math.round(70 * Math.sin(t * 0.9)); v.size = 45; }
    if (s === "red" || s === "green" || s === "blue") { v.colour = { red: 1, green: 2, blue: 3 }[s]; v.x = pr.pos || 0; v.size = pr.near == null ? 35 : pr.near; }
    /* moving the thing it is looking at is movement too */
    var key = s + "|" + pr.pos + "|" + pr.near;
    if (st.sceneKey !== undefined && st.sceneKey !== key) st.stir = 100;
    st.sceneKey = key;
    st.stir = Math.max(0, (st.stir || 0) - 160 * (dt > 0 && isFinite(dt) ? dt : 0.016));
    v.motion = Math.max(v.motion, Math.round(st.stir));
    return v;
  }
  MODELS.smart_cam = {
    build: function (b) { return { pwr: R(b, "VCC", "GND", 1e6), sda: R(b, "SDA", "GND", 1e6), scl: R(b, "SCL", "GND", 1e6) }; },
    pre: function (m, ctx) { m.pwr.gv = ctx.st.on ? 1 / 60 : 1e-6; },
    post: function (m, ctx) {
      var st = ctx.st, vcc = vAcross(ctx, m.pwr), pr = ctx.props;
      st.on = vcc > 3.2;
      st.view = !st.on ? null : pr.live && AV.cam.on && AV.cam.view ? AV.cam.view : scene(pr, st, ctx.sim.wall || ctx.sim.t, ctx.dt);
      if (st.flash > 0) st.flash -= ctx.dt > 0 && isFinite(ctx.dt) ? ctx.dt : 0.016;
      if (vcc > 0.5 && vcc < 3.2) ctx.sim.warn(ctx.part.id, "warn", "lowpower", "The camera needs 5 V on VCC.");
      if (vcc < -1) ctx.sim.warn(ctx.part.id, "danger", "reverse", "The camera's power is the wrong way round.");
    }
  };

  /* ======================================================= DATA ROUTES */

  function partsOfType(sim, type) { return sim.topo ? sim.topo.inst.filter(function (it) { return it.part.type === type; }) : []; }
  function nodeOfMcuPin(sim, mcuId, num) {
    var node = 0;
    if (sim.topo) sim.topo.inst.forEach(function (it) { if (it.part.id === mcuId && it.m.pins && it.m.pins[num]) node = it.m.pins[num].n[0]; });
    return node;
  }

  /* The powered camera on this board's A4 and A5, if there is one. */
  Sim.prototype.cameraPart = function (mcuId) {
    var sda = nodeOfMcuPin(this, mcuId, 18), scl = nodeOfMcuPin(this, mcuId, 19), self = this, hit = null;
    if (!sda || !scl) return null;
    partsOfType(this, "smart_cam").forEach(function (it) {
      var st = self.state[it.part.id] || {};
      if (!hit && st.on && st.view && it.m.sda.n[0] === sda && it.m.scl.n[0] === scl) hit = it.part;
    });
    return hit;
  };
  Sim.prototype.cameraFor = function (mcuId) { var p = this.cameraPart(mcuId); return p ? this.state[p.id].view : null; };
  Sim.prototype.cameraSnap = function (mcuId) { var p = this.cameraPart(mcuId); if (p) { this.state[p.id].flash = 0.18; this.event(p.id, "snap"); } };

  /* A board told the speaker on one of its pins to say something. */
  Sim.prototype.sayOn = function (mcuId, pinNum, words, vol) {
    var node = nodeOfMcuPin(this, mcuId, pinNum), self = this, any = false;
    if (!node) return false;
    partsOfType(this, "speaker").forEach(function (it) {
      var st = self.state[it.part.id] || {};
      if (it.m.inp.n[0] !== node || !st.on) return;
      st.say = words; st.shown = ""; st.sayUntil = (self.wall || self.t || 0) + 0.35 + words.length * 0.065;
      any = true;
      if (words) self.event(it.part.id, "say", { text: words });
      if (self.onSay) self.onSay(it.part.id, words, vol);
    });
    return any;
  };
})(typeof window !== "undefined" ? window : globalThis);
