/* ═══════════════════════════════════════════════════════════════════
   HANNS · BIG SCREEN — DJ booth sound engine (Web Audio, no samples)
   ───────────────────────────────────────────────────────────────────
   Used by the PROJECTOR (it plays what the booth sends over the screen
   socket) and by the DJ booth itself when "Hear FX here" is on.

   Browsers never expose YouTube's audio, so a scratch can't drag the
   real track. Instead the projector mutes the track while the record is
   held, plays a synthesized scratch voice that follows the platter
   speed sample by sample, and the booth drops the needle where the
   hand lets go (a normal media seek).

     KKDJ.engine()                 one shared engine per page
       .unlock()                   call from a click/tap (autoplay rules)
       .scratchStart() / .scratch(v[], dtMs) / .scratchEnd()
             v = platter speed, 1 = normal play, <0 = backwards
       .horn() .siren() .rewind() .brake()
       .play(id)                   a built-in pad sound (SOUNDS below)
       .playUrl(url) .preload([url])  a sound file the host put on a pad
       .pad({sound, url})          whatever a pad holds
       .silence()                  stop everything that's sounding, now
       .handle(msg)                a {type:"dj_fx", kind, …} socket message
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.KKDJ) return;

  const AC = window.AudioContext || window.webkitAudioContext;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function Engine() {
    let ctx = null, out = null, voice = null, cursor = 0, bufF = null, bufR = null, bus = null, noise = null;
    const files = new Map();                    // url → Promise<AudioBuffer>

    function ensure() {
      if (!AC) return null;
      if (!ctx) {
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4;
        out = ctx.createGain(); out.gain.value = 0.9;
        out.connect(comp); comp.connect(ctx.destination);
        // every effect plays through this bus; silence() swaps in a fresh one
        bus = ctx.createGain(); bus.connect(out);
        const nn = ctx.sampleRate * 2; noise = ctx.createBuffer(1, nn, ctx.sampleRate);
        const nd = noise.getChannelData(0); for (let i = 0; i < nn; i++) nd[i] = Math.random() * 2 - 1;
        // the scratch "voice": a breathy vowel (harmonics + noise), plus a reversed copy
        const n = Math.floor(ctx.sampleRate * 1.6), f = ctx.createBuffer(1, n, ctx.sampleRate), d = f.getChannelData(0);
        const f0 = 140, sr = ctx.sampleRate;
        for (let i = 0; i < n; i++) {
          const t = i / sr, wob = 1 + 0.04 * Math.sin(2 * Math.PI * 5.5 * t);
          let s = 0;
          for (let h = 1; h <= 14; h++) {
            const fh = f0 * h * wob;
            // two formant bumps (~700 Hz and ~1200 Hz) give it an "ahh"
            const g = Math.exp(-Math.pow((fh - 700) / 260, 2)) + 0.7 * Math.exp(-Math.pow((fh - 1200) / 300, 2)) + 0.12 / h;
            s += g * Math.sin(2 * Math.PI * fh * t + h);
          }
          d[i] = 0.32 * s + 0.12 * (Math.random() * 2 - 1);
        }
        bufF = f;
        bufR = ctx.createBuffer(1, n, sr);
        const r = bufR.getChannelData(0);
        for (let i = 0; i < n; i++) r[i] = d[n - 1 - i];
      }
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return ctx;
    }

    /* ── scratch ── */
    function scratchStart() {
      if (!ensure()) return;
      scratchEnd(true);
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.1; bp.frequency.value = 900;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 120;
      const gF = ctx.createGain(), gR = ctx.createGain();
      gF.gain.value = 0; gR.gain.value = 0;
      const sF = ctx.createBufferSource(), sR = ctx.createBufferSource();
      sF.buffer = bufF; sR.buffer = bufR; sF.loop = sR.loop = true;
      sF.connect(gF); sR.connect(gR); gF.connect(bp); gR.connect(bp); bp.connect(hp); hp.connect(bus);
      sF.start(); sR.start(0, 0.4);
      voice = { sF, sR, gF, gR, bp };
      cursor = ctx.currentTime + 0.09;            // a small jitter buffer for network chunks
    }
    function scratch(v, dtMs) {
      if (!voice) scratchStart();
      if (!voice || !Array.isArray(v)) return;
      const dt = clamp(+dtMs || 30, 10, 100) / 1000, now = ctx.currentTime;
      if (cursor < now + 0.02) cursor = now + 0.02;
      if (cursor > now + 0.4) cursor = now + 0.12;   // fell too far behind: catch up
      for (const raw of v) {
        const x = clamp(+raw || 0, -8, 8), a = Math.abs(x);
        const loud = clamp(a * 0.9, 0, 1) * (a < 0.04 ? 0 : 1);
        const rate = clamp(0.12 + a * 0.85, 0.05, 4);
        voice.sF.playbackRate.setTargetAtTime(rate, cursor, 0.008);
        voice.sR.playbackRate.setTargetAtTime(rate, cursor, 0.008);
        voice.gF.gain.setTargetAtTime(x >= 0 ? loud : 0, cursor, 0.006);
        voice.gR.gain.setTargetAtTime(x < 0 ? loud : 0, cursor, 0.006);
        voice.bp.frequency.setTargetAtTime(450 + clamp(a, 0, 3) / 3 * 2600, cursor, 0.01);
        cursor += dt;
      }
    }
    function scratchEnd(now) {
      if (!voice || !ctx) { voice = null; return; }
      const v = voice, t = Math.max(ctx.currentTime, now ? 0 : cursor);
      v.gF.gain.setTargetAtTime(0, t, 0.02); v.gR.gain.setTargetAtTime(0, t, 0.02);
      setTimeout(() => { try { v.sF.stop(); v.sR.stop(); } catch (_) { /* gone */ } }, (t - ctx.currentTime) * 1000 + 250);
      voice = null;
    }
    // a pre-drawn platter-speed curve through the same voice
    function curve(fn, secs, step) {
      scratchStart();
      const v = [];
      for (let t = 0; t < secs; t += step / 1000) v.push(fn(t / secs));
      scratch(v, step);
      setTimeout(() => scratchEnd(), secs * 1000 + 150);
    }

    /* ── pads ── */
    function horn() {
      if (!ensure()) return;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200; lp.connect(bus);
      const blasts = [[0, 0.16], [0.24, 0.16], [0.48, 0.62]];
      for (const [at, len] of blasts) {
        const t0 = ctx.currentTime + at, g = ctx.createGain();
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.22, t0 + 0.02);
        g.gain.setValueAtTime(0.22, t0 + len - 0.06); g.gain.linearRampToValueAtTime(0, t0 + len);
        g.connect(lp);
        for (const [f, det] of [[415, -6], [523, 4], [622, 0], [830, 7]]) {
          const o = ctx.createOscillator(); o.type = "sawtooth"; o.detune.value = det;
          o.frequency.setValueAtTime(f * 0.94, t0); o.frequency.exponentialRampToValueAtTime(f, t0 + 0.05);
          if (len > 0.3) o.frequency.exponentialRampToValueAtTime(f * 0.97, t0 + len);
          o.connect(g); o.start(t0); o.stop(t0 + len + 0.02);
        }
      }
    }
    function siren() {
      if (!ensure()) return;
      const t0 = ctx.currentTime, dur = 2.4;
      const o = ctx.createOscillator(), lfo = ctx.createOscillator(), depth = ctx.createGain(), g = ctx.createGain();
      o.type = "square"; o.frequency.value = 760;
      lfo.type = "triangle"; lfo.frequency.setValueAtTime(1.6, t0); lfo.frequency.linearRampToValueAtTime(5, t0 + dur);
      depth.gain.value = 340; lfo.connect(depth); depth.connect(o.frequency);
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.1, t0 + 0.08);
      g.gain.setValueAtTime(0.1, t0 + dur - 0.25); g.gain.linearRampToValueAtTime(0, t0 + dur);
      o.connect(lp); lp.connect(g); g.connect(bus);
      o.start(t0); lfo.start(t0); o.stop(t0 + dur); lfo.stop(t0 + dur);
    }
    const rewind = () => ensure() && curve(p => -7 * Math.pow(1 - p, 1.6) - 0.3, 1.1, 25);
    const brake = () => ensure() && curve(p => Math.max(0, 1 - p * 1.05), 1.2, 25);

    /* ── Drums & FX pads: all synthesized, no samples ── */
    const T = () => ctx.currentTime;
    function env(node, t0, peak, attack, decay) {              // a gain envelope, exponential tail
      node.gain.setValueAtTime(0.0001, t0);
      node.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + Math.max(attack, 0.001));
      node.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
      return t0 + attack + decay;
    }
    function gainTo(dest) { const g = ctx.createGain(); g.connect(dest || bus); return g; }
    function filt(type, f, q, dest) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (q) b.Q.value = q; b.connect(dest); return b; }
    function burst(t0, dest, dur, off) {                        // a slice of white noise
      const n = ctx.createBufferSource(); n.buffer = noise; n.connect(dest);
      n.start(t0, off == null ? Math.random() * 1.5 : off, dur + 0.05);
      return n;
    }
    function tone(type, f0, f1, t0, glide, dest, stop) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + glide);
      o.connect(dest); o.start(t0); o.stop(stop + 0.05); return o;
    }
    const SOUNDS = {
      kick() { const t = T(), g = gainTo(); const end = env(g, t, 1, 0.002, 0.42); tone("sine", 150, 42, t, 0.12, g, end); },
      snare() { const t = T(), g = gainTo(), h = filt("highpass", 1100, 0, g); env(g, t, 0.55, 0.001, 0.2); burst(t, h, 0.25);
                const g2 = gainTo(); const e2 = env(g2, t, 0.45, 0.001, 0.1); tone("triangle", 190, 160, t, 0.08, g2, e2); },
      clap() { const t = T(), bp = filt("bandpass", 1500, 0.9, bus);
               [0, 0.011, 0.023].forEach(d => { const g = gainTo(bp); env(g, t + d, 0.8, 0.001, 0.012); burst(t + d, g, 0.03); });
               const g = gainTo(bp); env(g, t + 0.03, 0.6, 0.002, 0.22); burst(t + 0.03, g, 0.3); },
      hat() { const t = T(), g = gainTo(), h = filt("highpass", 7200, 0, g); env(g, t, 0.32, 0.001, 0.05); burst(t, h, 0.08); },
      openhat() { const t = T(), g = gainTo(), h = filt("highpass", 6800, 0, g); env(g, t, 0.3, 0.002, 0.4); burst(t, h, 0.5); },
      tom() { const t = T(), g = gainTo(); const end = env(g, t, 0.85, 0.002, 0.38); tone("sine", 160, 95, t, 0.25, g, end); },
      rim() { const t = T(), g = gainTo(), bp = filt("bandpass", 1800, 4, g); const end = env(g, t, 0.6, 0.001, 0.045);
              tone("square", 1750, 1750, t, 0, bp, end); burst(t, bp, 0.05); },
      crash() { const t = T(), g = gainTo(), h = filt("highpass", 4200, 0, g); env(g, t, 0.35, 0.003, 1.8); burst(t, h, 1.9, 0); },
      cowbell() { const t = T(), g = gainTo(), bp = filt("bandpass", 800, 2, g); const end = env(g, t, 0.45, 0.001, 0.4);
                  tone("square", 540, 540, t, 0, bp, end); tone("square", 800, 800, t, 0, bp, end); },
      bass808() { const t = T(), g = gainTo(), sh = ctx.createWaveShaper(), c = new Float32Array(256);
                  for (let i = 0; i < 256; i++) { const x = i / 128 - 1; c[i] = Math.tanh(2.2 * x); }
                  sh.curve = c; sh.connect(g); const end = env(g, t, 0.9, 0.003, 1.3); tone("sine", 75, 50, t, 0.06, sh, end); },
      gunshot() { const t = T(), g = gainTo(), lp = filt("lowpass", 7000, 0.7, g);
                  lp.frequency.setValueAtTime(7000, t); lp.frequency.exponentialRampToValueAtTime(380, t + 0.28);
                  env(g, t, 1, 0.001, 0.32); burst(t, lp, 0.35);
                  const g2 = gainTo(); const e2 = env(g2, t, 0.9, 0.001, 0.16); tone("sine", 110, 38, t, 0.14, g2, e2);
                  const g3 = gainTo(), lp3 = filt("lowpass", 700, 0, g3); env(g3, t + 0.05, 0.18, 0.02, 0.7); burst(t + 0.05, lp3, 0.8); },
      laser() { const t = T(), g = gainTo(), lp = filt("lowpass", 5000, 3, g); const end = env(g, t, 0.35, 0.002, 0.34);
                tone("sawtooth", 1900, 110, t, 0.32, lp, end); tone("square", 1910, 115, t, 0.32, lp, end); },
      explosion() { const t = T(), g = gainTo(), lp = filt("lowpass", 1400, 0.6, g);
                    lp.frequency.setValueAtTime(1400, t); lp.frequency.exponentialRampToValueAtTime(140, t + 2.2);
                    env(g, t, 1, 0.004, 2.4); burst(t, lp, 1.95, 0);
                    const g2 = gainTo(); const e2 = env(g2, t, 1, 0.003, 1.6); tone("sine", 58, 28, t, 1.4, g2, e2);
                    for (let k = 0; k < 14; k++) { const d = 0.05 + Math.random() * 1.2, gc = gainTo(), hp = filt("highpass", 2500, 0, gc);
                      env(gc, t + d, 0.12 * Math.random() + 0.04, 0.001, 0.02); burst(t + d, hp, 0.03); } },
      airhorn() { horn(); },
      siren() { siren(); },
      riser() { const t = T(), dur = 2.6, g = gainTo(), bp = filt("bandpass", 300, 1.5, g);
                bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(7000, t + dur);
                g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + dur); g.gain.setValueAtTime(0.0001, t + dur + 0.02);
                burst(t, bp, 1.95, 0); const g2 = gainTo(); g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.12, t + dur);
                g2.gain.setValueAtTime(0.0001, t + dur + 0.02); tone("sawtooth", 180, 1400, t, dur, g2, t + dur); },
      impact() { const t = T(), g = gainTo(); const e = env(g, t, 1, 0.002, 1.4); tone("sine", 68, 32, t, 1.2, g, e);
                 const g2 = gainTo(), lp = filt("lowpass", 2400, 0, g2); env(g2, t, 0.7, 0.001, 0.45); burst(t, lp, 0.5);
                 const g3 = gainTo(), hp = filt("highpass", 5000, 0, g3); env(g3, t + 0.01, 0.16, 0.004, 1.2); burst(t, hp, 1.3); },
      whoosh() { const t = T(), g = gainTo(), bp = filt("bandpass", 400, 1.2, g);
                 bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(3200, t + 0.45); bp.frequency.exponentialRampToValueAtTime(350, t + 0.9);
                 g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.42); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.92);
                 burst(t, bp, 1.0); },
      rewind() { rewind(); },
      applause() { const t = T(), dur = 3.2, bp = filt("bandpass", 1600, 0.7, bus);
                   for (let k = 0; k < 140; k++) { const d = Math.random() * dur, w = Math.sin(Math.PI * d / dur);   // swell and fade
                     const g = gainTo(bp); env(g, t + d, 0.05 + 0.25 * w * Math.random(), 0.001, 0.03 + Math.random() * 0.03); burst(t + d, g, 0.07); } },
    };
    function play(id) { if (!ensure() || !SOUNDS[id]) return false; try { SOUNDS[id](); return true; } catch (_) { return false; } }
    function load(url) {
      if (!files.has(url)) {
        files.set(url, fetch(url, { credentials: "same-origin" }).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
          .then(b => new Promise((res, rej) => { ensure(); ctx.decodeAudioData(b, res, rej); }))
          .catch(e => { files.delete(url); throw e; }));
      }
      return files.get(url);
    }
    function preload(urls) { if (!AC) return; (urls || []).forEach(u => { if (u) load(u).catch(() => {}); }); }
    function playUrl(url) {
      if (!ensure() || !url) return;
      const at = T();
      load(url).then(buf => {
        if (T() - at > 1.5) return;                                // arrived far too late to be in time
        const s = ctx.createBufferSource(); s.buffer = buf; s.connect(bus); s.start();
      }).catch(() => {});
    }
    function pad(p) { if (!p) return; if (p.sound === "custom") playUrl(p.url); else play(p.sound); }
    function silence() {                                         // SCREEN ONLY: everything, now
      if (!ctx) return;
      scratchEnd(true);
      const old = bus;
      bus = ctx.createGain(); bus.connect(out);
      try { old.gain.cancelScheduledValues(T()); old.gain.setValueAtTime(0, T()); old.disconnect(); } catch (_) { /* gone */ }
    }

    function handle(m) {
      if (!m || m.type !== "dj_fx") return;
      switch (m.kind) {
        case "silence": silence(); break;
        case "scratch_start": scratchStart(); break;
        case "scratch": scratch(m.v, m.dt); break;
        case "scratch_end": scratchEnd(); break;
        case "horn": horn(); break;
        case "siren": siren(); break;
        case "rewind": rewind(); break;
        case "brake": brake(); break;
      }
    }
    return { unlock: ensure, scratchStart, scratch, scratchEnd, horn, siren, rewind, brake, handle,
             play, playUrl, preload, pad, silence, sounds: () => Object.keys(SOUNDS),
             get supported() { return !!AC; } };
  }

  let one = null;
  window.KKDJ = { engine: () => (one = one || Engine()) };
})();
