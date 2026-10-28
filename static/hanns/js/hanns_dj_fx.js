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
       .handle(msg)                a {type:"dj_fx", kind, …} socket message
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (window.KKDJ) return;

  const AC = window.AudioContext || window.webkitAudioContext;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  function Engine() {
    let ctx = null, out = null, voice = null, cursor = 0, bufF = null, bufR = null;

    function ensure() {
      if (!AC) return null;
      if (!ctx) {
        ctx = new AC();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4;
        out = ctx.createGain(); out.gain.value = 0.9;
        out.connect(comp); comp.connect(ctx.destination);
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
      sF.connect(gF); sR.connect(gR); gF.connect(bp); gR.connect(bp); bp.connect(hp); hp.connect(out);
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
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3200; lp.connect(out);
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
      o.connect(lp); lp.connect(g); g.connect(out);
      o.start(t0); lfo.start(t0); o.stop(t0 + dur); lfo.stop(t0 + dur);
    }
    const rewind = () => ensure() && curve(p => -7 * Math.pow(1 - p, 1.6) - 0.3, 1.1, 25);
    const brake = () => ensure() && curve(p => Math.max(0, 1 - p * 1.05), 1.2, 25);

    function handle(m) {
      if (!m || m.type !== "dj_fx") return;
      switch (m.kind) {
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
             get supported() { return !!AC; } };
  }

  let one = null;
  window.KKDJ = { engine: () => (one = one || Engine()) };
})();
