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

  /* ---------------- keep the screen awake ----------------
   * 1. Screen Wake Lock API (Chrome/Edge/Android, Safari 16.4+). The browser
   *    drops the lock whenever the page is hidden, so it is re-requested each
   *    time the page becomes visible again, and on the first tap if the very
   *    first request was refused.
   * 2. Older phones: a 3 KB silent looping video, muted and invisible, which
   *    browsers treat as "media playing" and so don't dim the screen.
   * onChange(state) reports "on" | "fallback" | "off" for the little sun icon.
   */
  var awake = null;
  function keepAwake(onChange) {
    if (awake) { if (onChange) awake.listeners.push(onChange); awake.report(); return awake; }
    var state = "off", lock = null, video = null, listeners = onChange ? [onChange] : [];
    function set(s) { state = s; listeners.forEach(function (f) { try { f(s); } catch (e) { /* ignore */ } }); }
    function startVideo() {
      var m = window.TT_MEDIA || {};
      if (!m.awakeMp4) return;
      if (!video) {
        video = document.createElement("video");
        video.setAttribute("playsinline", ""); video.setAttribute("muted", ""); video.muted = true; video.loop = true;
        video.setAttribute("aria-hidden", "true");
        video.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0.01;pointer-events:none;z-index:-1";
        [["awakeWebm", "video/webm"], ["awakeMp4", "video/mp4"]].forEach(function (src) {
          if (!m[src[0]]) return;
          var so = document.createElement("source"); so.src = m[src[0]]; so.type = src[1]; video.appendChild(so);
        });
        document.body.appendChild(video);
      }
      var pr = video.play();
      if (pr && pr.then) pr.then(function () { if (state !== "on") set("fallback"); }).catch(function () { /* needs a tap */ });
    }
    function request() {
      if (document.visibilityState !== "visible") return;
      if ("wakeLock" in navigator) {
        if (lock) return;
        navigator.wakeLock.request("screen").then(function (l) {
          lock = l; set("on");
          l.addEventListener("release", function () { lock = null; if (state === "on") set("off"); });
        }).catch(function () { startVideo(); });   // refused (no tap yet / battery saver)
      } else {
        startVideo();
      }
    }
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") { request(); if (video && state === "fallback") video.play().catch(function () {}); }
    });
    ["pointerdown", "keydown", "touchend"].forEach(function (ev) {
      document.addEventListener(ev, function () { if (!lock && state !== "fallback") request(); }, { passive: true });
    });
    request();
    awake = { state: function () { return state; }, listeners: listeners, report: function () { set(state); }, request: request };
    return awake;
  }
  function awakeBadge(el) {
    if (!el) return;
    keepAwake(function (s) {
      el.dataset.state = s;
      el.textContent = s === "off" ? "😴" : "☀️";
      el.title = s === "off" ? "This screen may go to sleep — tap anywhere to keep it on"
                             : "Screen stays on during the game";
    });
  }

  return {
    keepAwake: keepAwake, awakeBadge: awakeBadge,
    esc: esc, $: $, el: el, vibrate: vibrate, connect: connect, avatar: avatar,
    sfx: sfx, setMuted: setMuted, isMuted: function () { return muted; },
    GAME_LABEL: { chess: "Chess", dam: "Dam", ludo: "Ludo", words: "Scramble",
                  oware: "Oware", snakes: "Snakes & Ladders", four: "Four in a Row", quest: "Dragon's Hoard" },
    GAME_EMOJI: { chess: "♞", dam: "⛀", ludo: "🎲", words: "🔤", oware: "🌰", snakes: "🐍", four: "🔴", quest: "🐉" },
    LUDO_COLORS: ["#ef4444", "#22c55e", "#facc15", "#3b82f6"],
    LUDO_NAMES: ["Red", "Green", "Yellow", "Blue"],
  };
})();
