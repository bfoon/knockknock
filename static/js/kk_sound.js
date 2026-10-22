/* KnockKnock Arena — sound engine.
 *
 * Everything is synthesised live with WebAudio: original procedural music
 * loops and game sound effects. No audio files to host, nothing to license,
 * nothing to download on a slow phone connection.
 *
 * window.KKSound:
 *   init({role})          "presenter" | "phone" — picks defaults + storage key
 *   sfx(name)             join · lock · tick · tickUrgent · correct · wrong ·
 *                         timeup · whoosh · beep · go · drumroll · fanfare ·
 *                         streak · reveal · allin · boing · podium · swoosh
 *   music(name|null)      lobby · think · victory   (null = stop)
 *   urgency(on)           speeds up + brightens the current loop
 *   enabled() / setEnabled(b) / musicOn() / setMusic(b) / volume() / setVolume(v)
 *   unlocked()            true once the browser allowed audio (needs a tap)
 *   onChange(fn)          called whenever a setting changes
 *
 * Browsers block audio until the user interacts with the page; the engine
 * arms itself on the first tap/click/key and then starts whatever music
 * was requested in the meantime.
 */
(function () {
  "use strict";

  var ctx = null, master = null, musicBus = null, sfxBus = null, comp = null, noiseBuf = null;
  var role = "presenter";
  var storeKey = "kka-sound:presenter";
  var settings = { on: true, music: true, vol: 0.7 };
  var listeners = [];
  var wantMusic = null;
  var isUnlocked = false;

  function load() {
    try {
      var raw = localStorage.getItem(storeKey);
      if (raw) {
        var s = JSON.parse(raw);
        if (typeof s.on === "boolean") settings.on = s.on;
        if (typeof s.music === "boolean") settings.music = s.music;
        if (typeof s.vol === "number") settings.vol = Math.max(0, Math.min(1, s.vol));
      }
    } catch (e) { /* private mode */ }
  }
  function save() {
    try { localStorage.setItem(storeKey, JSON.stringify(settings)); } catch (e) { /* ignore */ }
    listeners.forEach(function (fn) { try { fn(settings); } catch (e) { /* ignore */ } });
  }

  // ───────────────────────── graph ─────────────────────────
  function ensureCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ctx.createGain();
    musicBus = ctx.createGain();
    sfxBus = ctx.createGain();
    musicBus.gain.value = 0.55;
    sfxBus.gain.value = 0.9;
    musicBus.connect(master); sfxBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
    applyVolume();

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function applyVolume() {
    if (!master) return;
    var v = settings.on ? settings.vol : 0;
    master.gain.setTargetAtTime(v * v * 0.9, ctx.currentTime, 0.05);
    if (musicBus) musicBus.gain.setTargetAtTime(settings.music ? 0.55 : 0, ctx.currentTime, 0.08);
  }

  function unlock() {
    if (!ensureCtx()) return;
    if (ctx.state === "suspended") ctx.resume();
    if (!isUnlocked) {
      // A silent blip fully unlocks iOS.
      var o = ctx.createOscillator(), g = ctx.createGain();
      g.gain.value = 0.0001; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.02);
      isUnlocked = true;
      save();
      if (wantMusic) startMusic(wantMusic);
    }
  }
  ["pointerdown", "touchend", "keydown", "click"].forEach(function (ev) {
    window.addEventListener(ev, unlock, { passive: true, capture: true });
  });
  document.addEventListener("visibilitychange", function () {
    if (!ctx) return;
    if (document.hidden) ctx.suspend(); else if (isUnlocked) ctx.resume();
  });

  // ───────────────────────── instruments ─────────────────────────
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function env(g, t, a, peak, d, sustainTo) {
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustainTo || 0.0001), t + a + d);
  }

  function tone(bus, t, f, dur, type, vol, opt) {
    opt = opt || {};
    var o = ctx.createOscillator(), g = ctx.createGain(), last = g;
    o.type = type || "sine";
    o.frequency.setValueAtTime(f, t);
    if (opt.to) o.frequency.exponentialRampToValueAtTime(opt.to, t + (opt.glide || dur));
    if (opt.detune) o.detune.value = opt.detune;
    o.connect(g);
    if (opt.lp) {
      var flt = ctx.createBiquadFilter();
      flt.type = "lowpass"; flt.frequency.value = opt.lp; flt.Q.value = opt.q || 0.7;
      g.connect(flt); last = flt;
    }
    last.connect(bus);
    env(g, t, opt.a || 0.005, vol, dur);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  function noise(bus, t, dur, vol, type, freq, q, toFreq) {
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = type || "highpass"; f.frequency.setValueAtTime(freq || 6000, t); f.Q.value = q || 0.8;
    if (toFreq) f.frequency.exponentialRampToValueAtTime(toFreq, t + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    env(g, t, 0.003, vol, dur);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  function kick(bus, t, vol) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.14);
    o.connect(g); g.connect(bus); env(g, t, 0.002, vol || 0.9, 0.22);
    o.start(t); o.stop(t + 0.3);
  }
  function snare(bus, t, vol) {
    noise(bus, t, 0.14, vol || 0.35, "bandpass", 1900, 0.9);
    tone(bus, t, 210, 0.08, "triangle", (vol || 0.35) * 0.6);
  }
  function hat(bus, t, vol) { noise(bus, t, 0.035, vol || 0.12, "highpass", 8000); }
  function pluck(bus, t, m, vol, dur) { tone(bus, t, mtof(m), dur || 0.18, "triangle", vol || 0.16); }
  function lead(bus, t, m, vol, dur) {
    tone(bus, t, mtof(m), dur, "square", (vol || 0.09), { lp: 2600, a: 0.01 });
    tone(bus, t, mtof(m), dur, "triangle", (vol || 0.09) * 0.9, { detune: 7, a: 0.01 });
  }
  function bass(bus, t, m, vol, dur) { tone(bus, t, mtof(m), dur || 0.2, "sawtooth", vol || 0.2, { lp: 520, q: 4 }); }
  function stab(bus, t, ms, vol, dur) {
    ms.forEach(function (m, i) {
      tone(bus, t, mtof(m), dur || 0.3, "sawtooth", (vol || 0.08), { lp: 2200, detune: i % 2 ? -8 : 8, a: 0.008 });
    });
  }

  // ───────────────────────── sound effects ─────────────────────────
  var SFX = {
    join: function (t) { tone(sfxBus, t, 700, 0.12, "sine", 0.35, { to: 1400, glide: 0.08 }); tone(sfxBus, t + 0.07, 1400, 0.12, "triangle", 0.2); },
    lock: function (t) { tone(sfxBus, t, 520, 0.07, "square", 0.14, { lp: 3000 }); tone(sfxBus, t + 0.06, 880, 0.12, "square", 0.14, { lp: 3000 }); },
    tick: function (t) { tone(sfxBus, t, 1550, 0.035, "sine", 0.22); },
    tickUrgent: function (t) { tone(sfxBus, t, 2100, 0.05, "square", 0.12, { lp: 4000 }); tone(sfxBus, t + 0.5, 1300, 0.05, "square", 0.08, { lp: 4000 }); },
    correct: function (t) {
      [72, 76, 79, 84].forEach(function (m, i) { tone(sfxBus, t + i * 0.075, mtof(m), 0.28, "triangle", 0.3); tone(sfxBus, t + i * 0.075, mtof(m + 12), 0.2, "sine", 0.08); });
      noise(sfxBus, t + 0.3, 0.5, 0.06, "highpass", 9000);
    },
    wrong: function (t) {
      tone(sfxBus, t, 330, 0.22, "sawtooth", 0.18, { to: 300, lp: 1200 });
      tone(sfxBus, t + 0.2, 262, 0.42, "sawtooth", 0.18, { to: 196, lp: 900 });
    },
    timeup: function (t) {
      tone(sfxBus, t, 220, 0.55, "square", 0.14, { lp: 900 });
      tone(sfxBus, t, 233, 0.55, "square", 0.12, { lp: 900 });
      kick(sfxBus, t, 0.7);
    },
    whoosh: function (t) { noise(sfxBus, t, 0.5, 0.28, "bandpass", 300, 1.4, 4200); },
    swoosh: function (t) { noise(sfxBus, t, 0.32, 0.22, "bandpass", 3800, 1.2, 500); },
    beep: function (t) { tone(sfxBus, t, 880, 0.14, "square", 0.14, { lp: 3500 }); },
    go: function (t) { tone(sfxBus, t, 1320, 0.32, "square", 0.16, { lp: 4000 }); tone(sfxBus, t, 660, 0.32, "triangle", 0.2); },
    allin: function (t) { [79, 84, 88].forEach(function (m, i) { tone(sfxBus, t + i * 0.06, mtof(m), 0.4, "sine", 0.22); }); },
    streak: function (t) { [72, 76, 79, 83, 86, 91].forEach(function (m, i) { tone(sfxBus, t + i * 0.05, mtof(m), 0.16, "triangle", 0.18); }); },
    boing: function (t) { tone(sfxBus, t, 260, 0.3, "sine", 0.35, { to: 620, glide: 0.12 }); tone(sfxBus, t + 0.12, 620, 0.2, "sine", 0.2, { to: 380, glide: 0.18 }); },
    reveal: function (t) {
      kick(sfxBus, t, 0.9);
      noise(sfxBus, t, 0.9, 0.16, "highpass", 5000);
      stab(sfxBus, t, [60, 64, 67, 72], 0.07, 0.5);
    },
    drumroll: function (t) {
      var n = 34, total = 2.2;
      for (var i = 0; i < n; i++) {
        var p = i / n, at = t + total * (1 - Math.pow(1 - p, 1.6));
        noise(sfxBus, at, 0.06, 0.08 + p * 0.28, "bandpass", 1800, 0.8);
      }
    },
    podium: function (t) {
      kick(sfxBus, t, 1); noise(sfxBus, t, 1.4, 0.22, "highpass", 4000);
      stab(sfxBus, t, [60, 64, 67, 72, 76], 0.07, 0.9);
    },
    fanfare: function (t) {
      var seq = [[0, [67]], [0.14, [72]], [0.28, [76]], [0.42, [79]], [0.7, [76]], [0.84, [79, 84]]];
      seq.forEach(function (s) { s[1].forEach(function (m) { lead(sfxBus, t + s[0], m, 0.12, s[0] > 0.8 ? 1.1 : 0.22); }); });
      stab(sfxBus, t + 0.84, [60, 64, 67], 0.06, 1.1);
      kick(sfxBus, t + 0.84, 0.8);
    },
  };

  function sfx(name) {
    if (!settings.on || !isUnlocked || !ensureCtx() || !SFX[name]) return;
    try { SFX[name](ctx.currentTime + 0.01); } catch (e) { /* ignore */ }
  }

  // ───────────────────────── music sequencer ─────────────────────────
  // Each song is 4 bars × 16 steps. step(i, t, loop) schedules one 16th.
  var SONGS = {
    lobby: {
      bpm: 116,
      chords: [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]],
      roots: [36, 33, 29, 31],
      melody: [
        [0, 76, 2], [2, 79, 2], [4, 84, 4], [8, 83, 2], [10, 79, 2], [12, 76, 4],
        [16, 81, 2], [18, 84, 2], [20, 88, 4], [24, 86, 2], [26, 84, 2], [28, 81, 4],
        [32, 77, 2], [34, 81, 2], [36, 84, 4], [40, 81, 2], [42, 79, 2], [44, 77, 4],
        [48, 79, 2], [50, 83, 2], [52, 86, 4], [56, 84, 2], [58, 83, 2], [60, 79, 4],
      ],
      step: function (i, t, loop, sp) {
        var bar = Math.floor(i / 16), s = i % 16, ch = this.chords[bar];
        if (s === 0 || s === 8 || s === 11) kick(musicBus, t, 0.55);
        if (s === 4 || s === 12) snare(musicBus, t, 0.22);
        if (s % 2 === 1) hat(musicBus, t, 0.06);
        if ([0, 3, 6, 8, 10, 14].indexOf(s) >= 0) bass(musicBus, t, this.roots[bar] + (s === 6 || s === 14 ? 12 : 0), 0.16, sp * 1.6);
        if (s % 2 === 0) pluck(musicBus, t, ch[[0, 1, 2, 1][(s / 2) % 4]] + 12, 0.07, sp * 1.8);
        if (loop % 2 === 1) {
          this.melody.forEach(function (n) { if (n[0] === i) lead(musicBus, t, n[1], 0.06, sp * n[2] * 0.95); });
        }
      },
    },
    think: {
      bpm: 128,
      chords: [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]],
      roots: [33, 29, 26, 28],
      bells: [[0, 76], [16, 72], [32, 74], [48, 71], [56, 68]],
      step: function (i, t, loop, sp) {
        var bar = Math.floor(i / 16), s = i % 16, ch = this.chords[bar];
        if (s % 4 === 0) kick(musicBus, t, 0.5);
        if (s === 4 || s === 12) noise(musicBus, t, 0.1, 0.1, "bandpass", 2500, 1);
        hat(musicBus, t, s % 2 ? 0.035 : 0.06);
        if (s % 2 === 0) bass(musicBus, t, this.roots[bar] + (s % 4 === 2 ? 12 : 0), 0.15, sp * 1.4);
        pluck(musicBus, t, ch[s % 3] + 24, s % 4 === 0 ? 0.06 : 0.035, sp * 0.9);
        this.bells.forEach(function (n) { if (n[0] === i) tone(musicBus, t, mtof(n[1]), 0.9, "sine", 0.08); });
      },
    },
    victory: {
      bpm: 124,
      chords: [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67, 72]],
      roots: [36, 41, 43, 36],
      melody: [[0, 79, 2], [2, 84, 2], [4, 88, 4], [10, 86, 2], [12, 84, 4], [16, 81, 2], [18, 84, 2], [20, 89, 6], [32, 83, 2], [34, 86, 2], [36, 91, 4], [42, 89, 2], [44, 88, 4], [48, 84, 8]],
      step: function (i, t, loop, sp) {
        var bar = Math.floor(i / 16), s = i % 16, ch = this.chords[bar];
        if (s % 4 === 0) kick(musicBus, t, 0.6);
        if (s === 4 || s === 12) snare(musicBus, t, 0.25);
        if (s % 2 === 1) hat(musicBus, t, 0.07);
        if ([0, 3, 6, 10, 12].indexOf(s) >= 0) stab(musicBus, t, ch, 0.035, sp * 1.5);
        if (s % 2 === 0) bass(musicBus, t, this.roots[bar] + (s % 4 ? 12 : 0), 0.15, sp * 1.6);
        this.melody.forEach(function (n) { if (n[0] === i) lead(musicBus, t, n[1], 0.065, sp * n[2] * 0.95); });
      },
    },
  };

  var seq = { song: null, name: null, step: 0, loop: 0, next: 0, timer: null, rate: 1 };

  function stepDur() { return 60 / (seq.song.bpm * seq.rate) / 4; }

  function schedule() {
    if (!seq.song || !ctx) return;
    var ahead = ctx.currentTime + 0.12;
    while (seq.next < ahead) {
      try { seq.song.step(seq.step, seq.next, seq.loop, stepDur()); } catch (e) { /* keep the clock running */ }
      seq.next += stepDur();
      seq.step += 1;
      if (seq.step >= 64) { seq.step = 0; seq.loop += 1; }
    }
  }

  function startMusic(name) {
    if (!ensureCtx() || !SONGS[name]) return;
    if (seq.name === name && seq.timer) return;
    stopMusic(true);
    seq.song = SONGS[name]; seq.name = name; seq.step = 0; seq.loop = 0; seq.rate = 1;
    seq.next = ctx.currentTime + 0.08;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(0.0001, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(settings.music ? 0.55 : 0, ctx.currentTime + 0.6);
    seq.timer = setInterval(schedule, 25);
    schedule();
  }

  function stopMusic(hard) {
    if (seq.timer) { clearInterval(seq.timer); seq.timer = null; }
    if (ctx && musicBus && !hard) {
      musicBus.gain.cancelScheduledValues(ctx.currentTime);
      musicBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15);
      setTimeout(function () { if (!seq.timer && musicBus) musicBus.gain.value = settings.music ? 0.55 : 0; }, 700);
    }
    seq.song = null; seq.name = null;
  }

  function music(name) {
    wantMusic = name || null;
    if (!name) { stopMusic(false); return; }
    if (!isUnlocked) return;           // will start on first gesture
    startMusic(name);
  }

  function urgency(on) { seq.rate = on ? 1.22 : 1; }

  // ───────────────────────── public ─────────────────────────
  window.KKSound = {
    init: function (opts) {
      role = (opts && opts.role) || "presenter";
      storeKey = "kka-sound:" + role;
      // Phones default to silent: a room full of phones all playing music is
      // chaos. The big screen defaults to sound on.
      settings = role === "phone" ? { on: false, music: false, vol: 0.8 } : { on: true, music: true, vol: 0.7 };
      load();
    },
    sfx: sfx,
    music: music,
    urgency: urgency,
    current: function () { return wantMusic; },
    enabled: function () { return settings.on; },
    setEnabled: function (b) { settings.on = !!b; if (b) unlock(); applyVolume(); save(); },
    musicOn: function () { return settings.music; },
    setMusic: function (b) { settings.music = !!b; if (b) unlock(); applyVolume(); save(); },
    volume: function () { return settings.vol; },
    setVolume: function (v) { settings.vol = Math.max(0, Math.min(1, Number(v) || 0)); applyVolume(); save(); },
    unlocked: function () { return isUnlocked; },
    unlock: unlock,
    onChange: function (fn) { listeners.push(fn); },
  };
})();
