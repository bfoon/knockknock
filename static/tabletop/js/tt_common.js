/* tt_common.js — shared by the stage (big screen) and the phones.
 *
 * window.TT:
 *   connect(code, hello, onMsg) -> {send(obj), close()}   auto-reconnects
 *   avatar(id, size)            -> HTML for any avatar id (hero / built / emoji)
 *   sfx(name)                   tiny WebAudio sounds, no files
 *   esc(s), $(id), el(tag, cls, html), vibrate(ms)
 *   GAME_LABEL, LUDO_COLORS
 */
window.TT = (function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function vibrate(ms) {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;   // needs a tap first
    try { navigator.vibrate && navigator.vibrate(ms); } catch (e) { /* ignore */ }
  }

  /* ---------------- socket ---------------- */
  function connect(code, hello, onMsg, onState) {
    var ws = null, closed = false, tries = 0, pingT = null;
    var proto = location.protocol === "https:" ? "wss://" : "ws://";
    function open() {
      onState && onState("connecting");
      ws = new WebSocket(proto + location.host + "/ws/tabletop/" + code + "/");
      ws.onopen = function () {
        tries = 0;
        ws.send(JSON.stringify(hello));
        onState && onState("live");
        clearInterval(pingT);
        pingT = setInterval(function () { send({ t: "ping" }); }, 20000);
      };
      ws.onmessage = function (e) {
        var m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (m.t === "resync") { send({ t: "sync" }); return; }
        if (m.t === "kicked" || m.t === "denied") closed = true;
        onMsg(m);
      };
      ws.onclose = function () {
        clearInterval(pingT);
        if (closed) { onState && onState("closed"); return; }
        onState && onState("offline");
        tries++;
        setTimeout(open, Math.min(8000, 500 * Math.pow(1.7, tries)));
      };
    }
    function send(obj) {
      if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
      return false;
    }
    open();
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && ws && ws.readyState > 1 && !closed) open();
    });
    return { send: send, close: function () { closed = true; ws && ws.close(); } };
  }

  /* ---------------- avatars ---------------- */
  function avatar(id, size) {
    size = size || 48;
    id = String(id || "dragon");
    if (window.KKHero && KKHero.isHero(id)) return KKHero.html(id, size);
    if (window.KKAvatar && KKAvatar.isBuilt && KKAvatar.isBuilt(id)) {
      return '<span class="tt-av" style="width:' + size + "px;height:" + size + 'px">' + KKAvatar.html(id, { size: size }) + "</span>";
    }
    var a = (window.kkAvatarsById || {})[id] || {};
    return '<span class="tt-av tt-av-emoji" style="width:' + size + "px;height:" + size + "px;font-size:" + Math.round(size * 0.6) + "px;background:" +
      (a.color || "#334155") + '33">' + esc(a.emoji || "🙂") + "</span>";
  }

  /* ---------------- sound ---------------- */
  var ctx = null, muted = false;
  try { muted = localStorage.getItem("tt-mute") === "1"; } catch (e) { /* ignore */ }
  function ac() {
    // browsers refuse audio before the first tap/click on the page
    if (!ctx && navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; } }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function tone(f, d, type, vol, slide, delay) {
    var c = ac(); if (!c) return;
    var t = c.currentTime + (delay || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || "sine";
    o.frequency.setValueAtTime(f, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + d);
    g.gain.setValueAtTime(vol || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + d + 0.02);
  }
  function noise(d, vol, hp) {
    var c = ac(); if (!c) return;
    var n = Math.floor(c.sampleRate * d), buf = c.createBuffer(1, n, c.sampleRate), data = buf.getChannelData(0);
    for (var i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var s = c.createBufferSource(), g = c.createGain(), f = c.createBiquadFilter();
    f.type = "highpass"; f.frequency.value = hp || 1500;
    s.buffer = buf; g.gain.value = vol || 0.2;
    s.connect(f); f.connect(g); g.connect(c.destination); s.start();
  }
  var SOUNDS = {
    tap: function () { tone(660, 0.06, "triangle", 0.08); },
    move: function () { tone(330, 0.08, "triangle", 0.12, 520); },
    land: function () { tone(180, 0.12, "sine", 0.2, 90); },
    slash: function () { noise(0.25, 0.35, 2500); tone(1400, 0.2, "sawtooth", 0.05, 200); },
    split: function () { tone(140, 0.35, "square", 0.08, 50); noise(0.4, 0.15, 400); },
    crown: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.18, "triangle", 0.12, null, i * 0.08); }); },
    dice: function () { for (var i = 0; i < 6; i++) tone(800 + Math.random() * 600, 0.03, "square", 0.04, null, i * 0.05); },
    tile: function () { tone(900, 0.05, "triangle", 0.1, 600); },
    score: function () { [659, 880, 1175].forEach(function (f, i) { tone(f, 0.15, "sine", 0.12, null, i * 0.07); }); },
    win: function () { [523, 659, 784, 659, 784, 1047].forEach(function (f, i) { tone(f, 0.22, "triangle", 0.14, null, i * 0.12); }); },
    bad: function () { tone(200, 0.2, "sawtooth", 0.08, 120); },
    turn: function () { tone(880, 0.1, "sine", 0.1); tone(1320, 0.14, "sine", 0.08, null, 0.1); },
    check: function () { tone(440, 0.12, "square", 0.08); tone(440, 0.12, "square", 0.08, null, 0.18); },
  };
  function sfx(name) { if (!muted && SOUNDS[name]) { try { SOUNDS[name](); } catch (e) { /* ignore */ } } }
  function setMuted(m) { muted = !!m; try { localStorage.setItem("tt-mute", muted ? "1" : "0"); } catch (e) { /* ignore */ } }

  return {
    esc: esc, $: $, el: el, vibrate: vibrate, connect: connect, avatar: avatar,
    sfx: sfx, setMuted: setMuted, isMuted: function () { return muted; },
    GAME_LABEL: { chess: "Chess", dam: "Dam", ludo: "Ludo", words: "Scramble" },
    GAME_EMOJI: { chess: "♞", dam: "⛀", ludo: "🎲", words: "🔤" },
    LUDO_COLORS: ["#ef4444", "#22c55e", "#facc15", "#3b82f6"],
    LUDO_NAMES: ["Red", "Green", "Yellow", "Blue"],
  };
})();
