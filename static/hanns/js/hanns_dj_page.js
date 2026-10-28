/* ═══════════════════════════════════════════════════════════════════
   HANNS · BIG SCREEN — the DJ booth's own page  (/hanns/screen/s/<token>/dj/)
   ───────────────────────────────────────────────────────────────────
   hanns_screen_program.js mounts the booth (page mode: no dialog chrome,
   edge to edge). This file adds what a booth on a DJ table needs:
     • live state — the screen socket, with a polling backstop
     • keep awake — Screen Wake Lock, re-taken whenever the page is shown
       again; where the API is missing (older iPhones) a tiny silent video
       loops inline, the classic way to stop a phone from sleeping
     • full screen — entered from the start button (browsers only allow it
       from a tap); iPhone gets the "Add to Home Screen" tip instead
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const root = document.querySelector("[data-screen][data-dj-page]");
  if (!root) return;
  const base = `/hanns/screen/s/${root.dataset.token}/`;
  const $ = id => document.getElementById(id);
  const push = s => root.dispatchEvent(new CustomEvent("bs:state", { detail: s }));

  /* ── live state ── */
  let sock = null, lastRx = 0;
  function connect() {
    try { sock = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + root.dataset.ws); }
    catch (_) { setTimeout(connect, 3000); return; }
    sock.onmessage = ev => {
      lastRx = Date.now();
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.type === "ping") { try { sock.send('{"type":"pong"}'); } catch (_) { /* closed */ } return; }
      if (m.type === "screen_state") push(m.state);
      else if (m.type === "screen_stopped") gone();
    };
    sock.onclose = () => setTimeout(connect, 3000);
  }
  connect();
  async function poll(force) {
    if (!force && sock && sock.readyState === 1 && Date.now() - lastRx < 50000) return;
    try {
      const r = await fetch(base + "state/", { credentials: "same-origin", cache: "no-store" });
      if (r.status === 404 || r.status === 410) { gone(); return; }
      const j = await r.json();
      if (j.state) { if (j.state.active === false) gone(); else push(j.state); }
    } catch (_) { /* offline for a moment */ }
  }
  setInterval(poll, 8000);
  setInterval(() => { if (sock && sock.readyState === 1) { try { sock.send('{"type":"ping"}'); } catch (_) { /* closed */ } } }, 20000);
  function gone() { $("djp-gone").hidden = false; release(); }

  /* ── keep the screen awake ── */
  const KEEP_AWAKE_MP4 = "data:video/mp4;base64,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b21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0wIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MSBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0xIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTAgd2VpZ2h0cD0wIGtleWludD0yNTAga2V5aW50X21pbj0xIHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAADmWIhAW///8PRQABT3+AARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAcAAAAGQZo4CvqAARggBwEYIAcBGCAHARggBwEYIAcBGCAHARggBwEYIAc=";
  let lock = null, video = null, want = true;
  const canLock = "wakeLock" in navigator;
  function status(on, why) {
    document.querySelectorAll("[data-wake]").forEach(n => {
      n.hidden = false;
      n.classList.toggle("on", on);
      n.innerHTML = on ? '<i class="bi bi-sun-fill"></i> Screen stays on' : '<i class="bi bi-moon"></i> May sleep';
      n.title = on ? "This device won't go to sleep while the booth is open." : (why || "Tap to keep this device awake.");
    });
  }
  async function keepAwake() {
    want = true;
    if (document.visibilityState !== "visible") return;
    if (canLock) {
      try {
        if (lock && !lock.released) { status(true); return; }
        lock = await navigator.wakeLock.request("screen");
        lock.addEventListener("release", () => { if (document.visibilityState !== "visible") status(false, "Paused while the booth is hidden — it comes back when you return."); else status(false); });
        status(true);
        return;
      } catch (e) {
        // e.g. battery saver, or not allowed until a tap: fall through to the video trick
        status(false, "This browser said no (battery saver?) — tap to try again.");
      }
    }
    try {
      if (!video) {
        video = document.createElement("video");
        video.setAttribute("playsinline", ""); video.setAttribute("muted", ""); video.muted = true; video.loop = true;
        video.setAttribute("aria-hidden", "true");
        video.style.cssText = "position:fixed;width:1px;height:1px;left:-10px;top:-10px;opacity:0;pointer-events:none";
        video.src = KEEP_AWAKE_MP4;
        document.body.appendChild(video);
      }
      await video.play();
      status(true);
    } catch (_) { status(false, "Couldn't keep the screen awake here — set auto-lock to Never while you play."); }
  }
  function release() {
    want = false;
    if (lock) { lock.release().catch(() => {}); lock = null; }
    if (video) video.pause();
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && want) keepAwake(); });
  keepAwake();                                    // allowed without a tap in most browsers; the start button retries

  /* ── full screen ── */
  const de = document.documentElement;
  const fsOk = !!(de.requestFullscreen || de.webkitRequestFullscreen);
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  async function enterFs() {
    if (!fsOk || isFs()) return;
    try { await (de.requestFullscreen ? de.requestFullscreen({ navigationUI: "hide" }) : de.webkitRequestFullscreen()); } catch (_) { /* refused */ }
  }
  async function exitFs() {
    try { await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen()); } catch (_) { /* not in it */ }
  }
  function fsButtons() {
    document.querySelectorAll("[data-fs]").forEach(b => {
      b.hidden = !fsOk;
      b.innerHTML = isFs() ? '<i class="bi bi-fullscreen-exit"></i> Exit full screen' : '<i class="bi bi-arrows-fullscreen"></i> Full screen';
    });
  }
  document.addEventListener("fullscreenchange", fsButtons);
  document.addEventListener("webkitfullscreenchange", fsButtons);
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-fs],[data-wake]");
    if (!b) return;
    if (b.hasAttribute("data-fs")) { isFs() ? exitFs() : enterFs(); }
    else keepAwake();
  });
  fsButtons();

  /* ── start ── */
  const start = $("djp-start");
  if (!fsOk && !standalone) {
    const tip = $("djp-tip");
    tip.hidden = false;
    tip.textContent = /iPhone|iPad|iPod/.test(navigator.userAgent)
      ? "For true full screen on iPhone: Share → Add to Home Screen, then open DJ booth from there."
      : "This browser can't go full screen, but the booth fills the window.";
    $("djp-skip").hidden = true;
    $("djp-go").innerHTML = '<i class="bi bi-play-fill"></i> Start the booth';
  }
  if (standalone) start.hidden = true;
  function begin(fs) {
    if (fs) enterFs();
    keepAwake();
    if (window.KKDJ) window.KKDJ.engine().unlock();   // "Hear FX here" can play straight away
    start.hidden = true;
    poll(true);
  }
  $("djp-go").addEventListener("click", () => begin(true));
  $("djp-skip").addEventListener("click", () => begin(false));
})();
