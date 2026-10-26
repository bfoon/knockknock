/* ═══════════════════════════════════════════════════════════════════
   HANNS · BIG SCREEN — Music & video (YouTube) and your Event (Attendance)
   ───────────────────────────────────────────────────────────────────
   Host controls live in the projector's pull-down panel and on each card of
   the Big screens dashboard. Only the PROJECTOR plays and draws; the
   dashboard just controls (so a laptop never blares audio by accident).

   🎵 Music & video — paste a YouTube link:
        ▶ Video        full screen on the projector
        ♪ Audio only   just the sound, behind whatever is showing
        queue · pause/play · next · stop · volume · loop · "Now playing" strip
      B (event background) still works over a video: sound keeps going.
   📋 Event — pick an Attendance event, then show
        Registration (QR + live count) · Check-in (QR + live count, optional
        first-name welcomes) · Agenda (Now / Up next, in the event's time zone)
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const thumb = id => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
  function csrf() {
    if (window.__SCR_CSRF__) return window.__SCR_CSRF__;
    const i = document.querySelector("[name=csrfmiddlewaretoken]");
    if (i && i.value) return i.value;
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  const css = document.createElement("style");
  css.textContent = `
  .pg-sec{margin-top:1rem}
  .pg-h{display:flex;justify-content:space-between;align-items:center;margin-bottom:.55rem}
  .pg-h h3{margin:0;font:600 .7rem/1 ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:#a9a6c2}
  .pg-row{display:flex;gap:.45rem;flex-wrap:wrap;align-items:center}
  .pg-url{flex:1 1 260px;min-width:0;border-radius:11px;padding:.55rem .7rem;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:#f6f4ff;font:inherit}
  .pg-url:focus{outline:2px solid #a78bfa}
  .pg-b{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#f1f5f9;border-radius:10px;padding:.5rem .75rem;font:600 .8rem/1 system-ui,sans-serif;cursor:pointer;white-space:nowrap}
  .pg-b:hover{border-color:#a78bfa}.pg-b:disabled{opacity:.45;cursor:default}
  .pg-b.hot{border:0;color:#fff;background:linear-gradient(135deg,#ff3b5c,#f97316)}
  .pg-b.cool{border:0;color:#04121a;background:linear-gradient(135deg,#22d3ee,#a78bfa)}
  .pg-b.on{background:rgba(34,211,238,.18);border-color:rgba(34,211,238,.55)}
  .pg-now{display:grid;grid-template-columns:auto 1fr;gap:.7rem;align-items:center;margin:.6rem 0;padding:.6rem;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1)}
  .pg-now.playing{border-color:rgba(255,59,92,.45);background:rgba(255,59,92,.07)}
  .pg-now img{width:120px;aspect-ratio:16/9;object-fit:cover;border-radius:9px;background:#111}
  .pg-now b{display:block;font-size:.9rem;line-height:1.25;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .pg-now small{color:#a9a6c2;font-size:.75rem}
  .pg-ctl{grid-column:1/-1;display:flex;gap:.4rem;flex-wrap:wrap;align-items:center}
  .pg-ctl input[type=range]{flex:1 1 120px;accent-color:#a78bfa}
  .pg-chk{display:inline-flex;gap:.35rem;align-items:center;font-size:.78rem;color:#a9a6c2;cursor:pointer}
  .pg-q{list-style:none;margin:.3rem 0 0;padding:0;display:flex;flex-direction:column;gap:.3rem}
  .pg-q li{display:grid;grid-template-columns:64px 1fr auto;gap:.5rem;align-items:center;font-size:.78rem;color:#e2e8f0}
  .pg-q img{width:64px;aspect-ratio:16/9;object-fit:cover;border-radius:6px}
  .pg-q button{border:0;background:none;color:#fda4af;cursor:pointer}
  .pg-sel{flex:1 1 220px;border-radius:11px;padding:.5rem .6rem;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.05);color:#f6f4ff;font:inherit;color-scheme:dark}
  .pg-seg{display:inline-flex;gap:3px;padding:3px;border-radius:12px;background:rgba(255,255,255,.06);flex-wrap:wrap}
  .pg-seg button{border:0;background:none;color:#cbd5e1;border-radius:9px;padding:.45rem .7rem;font:600 .78rem/1 system-ui,sans-serif;cursor:pointer}
  .pg-seg button.on{background:linear-gradient(135deg,#22d3ee,#a78bfa);color:#04121a}
  .pg-note{font-size:.78rem;color:#fde68a;margin:.3rem 0}
  details.pg-fold{border-top:1px solid rgba(255,255,255,.08);padding:.7rem 1.2rem}
  details.pg-fold>summary{cursor:pointer;list-style:none;display:flex;gap:.6rem;align-items:center;font-weight:600;font-size:.9rem}
  details.pg-fold>summary::-webkit-details-marker{display:none}
  details.pg-fold>summary small{color:#a9a6c2;font-weight:500}
  details.pg-fold>summary::after{content:"▾";margin-left:auto;color:#a9a6c2;transition:transform .2s}
  details.pg-fold[open]>summary::after{transform:rotate(180deg)}
  details.pg-fold .pg-sec{margin-top:.6rem}
  /* projector layers */
  .pm-video{position:fixed;inset:0;z-index:19;background:#000;opacity:0;visibility:hidden;transition:opacity .6s,visibility .6s}
  .pm-video.on{opacity:1;visibility:visible}
  .pm-video.audio{inset:auto;left:0;bottom:0;width:2px;height:2px;opacity:.01;visibility:visible;pointer-events:none;overflow:hidden}
  .pm-video iframe,.pm-video>div{width:100%;height:100%;border:0}
  .pm-chip{position:fixed;left:50%;bottom:3vh;z-index:25;margin-left:0;translate:-50% 0;display:flex;gap:.8rem;align-items:center;padding:.7rem 1.1rem .7rem .8rem;border-radius:18px;
    background:rgba(7,6,13,.66);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#fff;
    font:600 clamp(.8rem,1.25vw,1.15rem)/1.25 system-ui,sans-serif;max-width:46vw;opacity:0;transform:translateY(12px);transition:opacity .5s,transform .5s;pointer-events:none}
  .pm-chip.on{opacity:1;transform:none}
  .pm-chip img{width:4.2em;aspect-ratio:16/9;object-fit:cover;border-radius:8px}
  .pm-chip small{display:block;font-weight:500;opacity:.7;font-size:.8em}
  .pm-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
  .pm-eq{display:flex;gap:3px;align-items:flex-end;height:1.1em}
  .pm-eq i{width:4px;background:#22d3ee;border-radius:2px;animation:pmEq 1s ease-in-out infinite}
  .pm-eq i:nth-child(2){animation-delay:-.3s;background:#a78bfa}.pm-eq i:nth-child(3){animation-delay:-.6s;background:#fb7185}
  @keyframes pmEq{0%,100%{height:25%}50%{height:100%}}
  .pm-chip.paused .pm-eq i{animation-play-state:paused}
  .pm-sound{position:fixed;inset:0;z-index:95;display:none;place-items:center;background:rgba(5,6,14,.55);cursor:pointer}
  .pm-sound.on{display:grid}
  .pm-sound div{padding:1.2rem 1.8rem;border-radius:20px;background:#12101f;border:1px solid rgba(255,255,255,.2);color:#fff;font:700 clamp(1rem,2vw,1.6rem)/1.3 system-ui,sans-serif;text-align:center}
  .pm-sound small{display:block;font-weight:500;opacity:.7;font-size:.6em;margin-top:.4rem}
  .pe-layer{position:fixed;inset:0;z-index:17;display:none;color:#f6f4ff;font-family:"Archivo",system-ui,sans-serif;
    background:radial-gradient(70% 90% at 85% 10%,rgba(34,211,238,.22),transparent 60%),radial-gradient(60% 80% at 0% 100%,rgba(251,113,133,.22),transparent 60%),#0b0a1f;overflow:hidden}
  .pe-layer.on{display:flex}
  .pe-reg{margin:auto;width:min(92vw,1500px);display:grid;grid-template-columns:1.25fr 1fr;gap:5vw;align-items:center}
  .pe-reg h1{font:800 clamp(2rem,5.2vw,5.4rem)/1 "Archivo",system-ui,sans-serif;letter-spacing:-.03em;margin:0 0 2vh}
  .pe-reg p{font-size:clamp(1rem,1.7vw,1.6rem);color:#cfcbe8;margin:0 0 3vh}
  .pe-url{font:700 clamp(.9rem,1.5vw,1.4rem)/1.2 ui-monospace,monospace;color:#22d3ee;word-break:break-all}
  .pe-count{display:flex;align-items:baseline;gap:.6rem;margin-top:4vh}
  .pe-count b{font:800 clamp(3rem,8vw,8rem)/1 "Archivo",system-ui,sans-serif;font-variant-numeric:tabular-nums;background:linear-gradient(135deg,#22d3ee,#a78bfa);-webkit-background-clip:text;background-clip:text;color:transparent}
  .pe-count span{font-size:clamp(1rem,1.8vw,1.7rem);color:#cfcbe8}
  .pe-bar{height:12px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden;margin-top:1.6vh;max-width:620px}
  .pe-bar i{display:block;height:100%;background:linear-gradient(90deg,#22d3ee,#a78bfa,#fb7185);border-radius:inherit;transition:width .8s}
  .pe-qr{background:#fff;border-radius:28px;padding:2.2vw;box-shadow:0 30px 80px rgba(0,0,0,.5);justify-self:center;width:min(36vw,62vh)}
  .pe-qr img,.pe-qr canvas{width:100%!important;height:auto!important;display:block}
  .pe-welcome{position:absolute;left:0;right:0;bottom:5vh;display:flex;justify-content:center;gap:1rem;flex-wrap:wrap;padding:0 4vw}
  .pe-welcome span{padding:.55rem 1.1rem;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);font-size:clamp(.9rem,1.4vw,1.3rem);animation:peIn .6s ease both}
  .pe-welcome span:first-child{background:linear-gradient(135deg,rgba(34,211,238,.35),rgba(167,139,250,.35));border-color:transparent;font-weight:700}
  @keyframes peIn{from{opacity:0;transform:translateY(10px)}}
  .pe-ag{margin:auto;width:min(92vw,1500px);display:flex;flex-direction:column;max-height:92vh}
  .pe-ag header{display:flex;justify-content:space-between;align-items:flex-end;gap:2rem;margin-bottom:3vh}
  .pe-ag h1{font:800 clamp(1.8rem,4vw,4.2rem)/1 "Archivo",system-ui,sans-serif;letter-spacing:-.02em;margin:0}
  .pe-ag header small{display:block;color:#cfcbe8;font-size:clamp(.9rem,1.4vw,1.3rem);margin-top:.6rem}
  .pe-clock{font:800 clamp(1.6rem,3.6vw,3.6rem)/1 ui-monospace,monospace;font-variant-numeric:tabular-nums;color:#22d3ee;white-space:nowrap}
  .pe-list{display:flex;flex-direction:column;gap:1.2vh;overflow:hidden}
  .pe-it{display:grid;grid-template-columns:minmax(8.5em,auto) 1fr auto;gap:2vw;align-items:center;padding:1.6vh 1.6vw;border-radius:18px;
    background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);border-left:6px solid var(--c,#a78bfa);transition:all .4s}
  .pe-it time{font:700 clamp(.9rem,1.6vw,1.5rem)/1 ui-monospace,monospace;color:#cfcbe8;font-variant-numeric:tabular-nums}
  .pe-it b{display:block;font-size:clamp(1rem,1.9vw,1.9rem);line-height:1.15}
  .pe-it small{color:#a9a6c2;font-size:clamp(.8rem,1.2vw,1.15rem)}
  .pe-it em{font-style:normal;font-weight:800;font-size:clamp(.75rem,1.1vw,1rem);padding:.4em .8em;border-radius:999px;white-space:nowrap}
  .pe-it.past{opacity:.38}
  .pe-it.now{background:linear-gradient(90deg,rgba(255,59,92,.22),rgba(255,59,92,.06));border-color:rgba(255,59,92,.5);transform:scale(1.015);box-shadow:0 20px 50px -20px rgba(255,59,92,.5)}
  .pe-it.now em{background:#ff3b5c;color:#fff}
  .pe-it.next em{background:rgba(34,211,238,.2);color:#a5f3fc}
  .pe-empty{margin:auto;text-align:center;font-size:clamp(1rem,2vw,1.8rem);color:#cfcbe8}`;
  document.head.appendChild(css);

  /* ───────────── host controls (projector panel + dashboard card) ───────────── */
  function ProgramUI(mediaHost, eventHost, base, onState, opts) {
    let media = null, ev = null, events = null, busy = false;
    async function call(path, body, method) {
      const r = await fetch(base + path, method === "GET" ? { credentials: "same-origin" } : {
        method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() }, body: JSON.stringify(body || {}) });
      let d = null; try { d = await r.json(); } catch (_) { /* html */ }
      if (r.status === 410) { location.reload(); return null; }
      if (!r.ok || !d || !d.ok) throw new Error((d && d.error) || "Something went wrong (" + r.status + ")");
      if (d.state) onState(d.state);
      return d;
    }
    function note(host, t) {
      const n = host.querySelector(".pg-note"); if (!n) return;
      n.textContent = t; n.hidden = !t; clearTimeout(n._t); if (t) n._t = setTimeout(() => { n.hidden = true; }, 4500);
    }
    async function mediaDo(body) {
      if (busy) return; busy = true;
      try { await call("media/", body); } catch (e) { note(mediaHost, e.message); }
      finally { busy = false; }
    }
    // ── music & video ──
    mediaHost.innerHTML = `<div class="pg-sec">
      <div class="pg-h"><h3>Music &amp; video</h3><span class="pg-now-k" style="font-size:.78rem;color:#a9a6c2"></span></div>
      <div class="pg-row"><input class="pg-url" type="url" placeholder="Paste a YouTube link — welcome music, a break playlist, someone's showreel…" aria-label="YouTube link">
        <button type="button" class="pg-b cool" data-m="video" title="Play it full screen on the projector">▶ Video</button>
        <button type="button" class="pg-b" data-m="audio" title="Just the sound — the screen keeps showing what it shows">♪ Audio only</button>
        <button type="button" class="pg-b" data-m="queue" title="Play it after the current one">＋ Queue</button></div>
      <div class="pg-note" hidden></div>
      <div class="pg-cur"></div><ul class="pg-q"></ul></div>`;
    const url = mediaHost.querySelector(".pg-url");
    mediaHost.addEventListener("click", e => {
      const b = e.target.closest("[data-m],[data-ma]"); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      if (b.dataset.m) {
        if (!url.value.trim()) { note(mediaHost, "Paste a YouTube link first."); url.focus(); return; }
        const body = b.dataset.m === "queue" ? { action: "queue", url: url.value } : { action: "load", url: url.value, mode: b.dataset.m };
        mediaDo(body).then(() => { url.value = ""; });
        return;
      }
      const a = b.dataset.ma;
      if (a === "toggle") mediaDo({ action: media && media.playing ? "pause" : "play" });
      else if (a === "mode") mediaDo({ action: "mode", mode: b.dataset.v });
      else if (a === "remove") mediaDo({ action: "remove", key: b.dataset.key });
      else mediaDo({ action: a });
    });
    url.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); mediaHost.querySelector('[data-m="audio"]').click(); } });
    mediaHost.addEventListener("change", e => {
      if (e.target.matches("[data-mv]")) mediaDo({ action: "volume", volume: +e.target.value });
      if (e.target.matches("[data-ml]")) mediaDo({ action: "loop", loop: e.target.checked });
      if (e.target.matches("[data-mc]")) mediaDo({ action: "chip", chip: e.target.checked });
    });
    function renderMedia(m) {
      media = m || {};
      const cur = media.current, q = media.queue || [];
      mediaHost.querySelector(".pg-now-k").textContent = cur ? (media.playing ? (media.mode === "video" ? "▶ Playing on screen" : "♪ Playing (audio only)") : "Paused") : "";
      mediaHost.querySelector(".pg-cur").innerHTML = cur ? `
        <div class="pg-now${media.playing ? " playing" : ""}"><img src="${thumb(cur.id)}" alt="">
          <div><b>${esc(cur.title)}</b><small>${media.mode === "video" ? "Video on the big screen" : "Audio only — the screen keeps its picture"}${q.length ? ` · ${q.length} in the queue` : ""}</small></div>
          <div class="pg-ctl">
            <button type="button" class="pg-b ${media.playing ? "" : "hot"}" data-ma="toggle">${media.playing ? "⏸ Pause" : "▶ Play"}</button>
            <button type="button" class="pg-b" data-ma="next" ${q.length ? "" : "disabled"} title="Skip to the next in the queue">⏭ Next</button>
            <button type="button" class="pg-b" data-ma="stop">⏹ Stop</button>
            <span class="pg-seg"><button type="button" data-ma="mode" data-v="video" class="${media.mode === "video" ? "on" : ""}">Video</button><button type="button" data-ma="mode" data-v="audio" class="${media.mode === "audio" ? "on" : ""}">Audio only</button></span>
            <span title="Volume">🔉</span><input type="range" min="0" max="100" step="5" value="${media.volume ?? 80}" data-mv aria-label="Volume">
            <label class="pg-chk"><input type="checkbox" data-ml ${media.loop ? "checked" : ""}> Loop</label>
            <label class="pg-chk" title="Show a small 'Now playing' strip on the big screen"><input type="checkbox" data-mc ${media.chip ? "checked" : ""}> Now playing strip</label>
          </div></div>` : "";
      mediaHost.querySelector(".pg-q").innerHTML = q.map((i, n) => `<li><img src="${thumb(i.id)}" alt=""><span>${n + 1}. ${esc(i.title)}</span>
        <button type="button" data-ma="remove" data-key="${esc(i.key)}" title="Remove from the queue">✕</button></li>`).join("");
    }
    // ── event ──
    eventHost.innerHTML = `<div class="pg-sec">
      <div class="pg-h"><h3>Event</h3></div>
      <div class="pg-row"><select class="pg-sel" aria-label="Attendance event"><option value="">Choose one of your Attendance events…</option></select></div>
      <div class="pg-row" style="margin-top:.5rem"><span class="pg-seg">
        <button type="button" data-ev="off">Off</button><button type="button" data-ev="register">Registration</button>
        <button type="button" data-ev="checkin">Check-in</button><button type="button" data-ev="agenda">Agenda</button></span>
        <label class="pg-chk" title="Greet people on the big screen by first name as they check in"><input type="checkbox" data-ew> Welcome arrivals by first name</label></div>
      <div class="pg-note" hidden></div></div>`;
    const sel = eventHost.querySelector(".pg-sel");
    async function loadEvents() {
      if (events) return;
      try { events = (await call("events/", null, "GET")).events; } catch (e) { note(eventHost, e.message); events = []; }
      sel.innerHTML = `<option value="">${events.length ? "Choose one of your Attendance events…" : "No Attendance events yet — create one in Attendance"}</option>` +
        events.map(x => `<option value="${x.id}">${esc(x.title)} · ${new Date(x.starts).toLocaleDateString()}</option>`).join("");
      renderEvent(ev);
    }
    async function evDo(body) {
      try { await call("event/", body); } catch (e) { note(eventHost, e.message); }
    }
    sel.addEventListener("focus", loadEvents);
    sel.addEventListener("change", () => evDo({ id: sel.value ? +sel.value : null }));
    eventHost.addEventListener("click", e => {
      const b = e.target.closest("[data-ev]"); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      evDo({ view: b.dataset.ev });
    });
    eventHost.addEventListener("change", e => { if (e.target.matches("[data-ew]")) evDo({ welcome: e.target.checked }); });
    function renderEvent(e) {
      ev = e || { id: null, view: "off", welcome: false };
      if (ev.id && events) sel.value = String(ev.id);
      else if (ev.id && !events) loadEvents();
      eventHost.querySelectorAll("[data-ev]").forEach(b => { b.classList.toggle("on", b.dataset.ev === ev.view); b.disabled = !ev.id && b.dataset.ev !== "off"; });
      eventHost.querySelector("[data-ew]").checked = !!ev.welcome;
    }
    return { render(state) { renderMedia(state.media); renderEvent(state.event); }, loadEvents };
  }

  /* ───────────── projector ───────────── */
  const cfgEl = document.getElementById("scr-cfg");
  if (cfgEl && document.getElementById("scr-panel")) {
    const CFG = JSON.parse(cfgEl.textContent || "{}");
    const base = CFG.backdropBase;
    if (!base) return;
    let state = JSON.parse((document.getElementById("scr-state") || {}).textContent || "{}");
    const pb = document.querySelector("#scr-panel .scr-pb");
    const anchor = pb && (pb.querySelector(".lv-sec") || pb.querySelector(".sbd-panel"));
    const mh = document.createElement("section"), eh = document.createElement("section");
    if (pb) { pb.insertBefore(mh, anchor || null); pb.insertBefore(eh, anchor || null); }
    const apply = s => document.dispatchEvent(new CustomEvent("scr:state", { detail: s }));
    const ui = ProgramUI(mh, eh, base, apply, {});

    // ── YouTube player ──
    const vwrap = document.createElement("div"); vwrap.className = "pm-video"; vwrap.innerHTML = '<div id="pm-yt"></div>';
    const chip = document.createElement("div"); chip.className = "pm-chip";
    const soundAsk = document.createElement("div"); soundAsk.className = "pm-sound";
    soundAsk.innerHTML = "<div>🔊 Click anywhere to start the sound<small>Browsers only play sound after someone clicks the screen once.</small></div>";
    document.body.append(vwrap, chip, soundAsk);
    let yt = null, ytReady = false, loadedKey = null, apiAsked = false, skew = 0, askTimer = null, skewFrom = null;
    function api() {
      if (apiAsked) return; apiAsked = true;
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev && prev(); makePlayer(); };
      const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true;
      document.head.appendChild(s);
    }
    function makePlayer() {
      yt = new YT.Player("pm-yt", {
        width: "100%", height: "100%",
        playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, disablekb: 1, fs: 0 },
        events: {
          onReady: () => { ytReady = true; sync(true); },
          onStateChange: e => {
            if (e.data === 0) {                      // ended → tell the server (it moves the queue on)
              const cur = state.media && state.media.current;
              if (cur) fetch(base + "media/", { method: "POST", credentials: "same-origin",
                headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() }, body: JSON.stringify({ action: "ended", key: cur.key }) })
                .then(r => r.json()).then(d => d && d.state && apply(d.state)).catch(() => {});
            }
            if (e.data === 1) soundAsk.classList.remove("on");
          },
        },
      });
    }
    function wantPos(m) {
      if (!m.playing) return m.position || 0;
      return (m.position || 0) + Math.max(0, (Date.now() + skew - (m.started_at || 0)) / 1000);
    }
    function sync(force) {
      const m = state.media || {}, cur = m.current;
      // The server's clock vs this projector's: measured ONCE per update, when it arrives.
      // (Re-measuring on every check against the same old server timestamp froze the target
      // position, so the player kept jumping back a few seconds — a short loop.)
      if (m.server_now && m.server_now !== skewFrom) { skewFrom = m.server_now; skew = m.server_now - Date.now(); }
      // layers
      const showVideo = !!(cur && m.mode === "video");
      vwrap.classList.toggle("on", showVideo);
      vwrap.classList.toggle("audio", !!(cur && m.mode !== "video"));
      document.body.classList.toggle("pm-on", showVideo);
      if (cur && m.chip && (m.mode !== "video")) {
        chip.innerHTML = `<div class="pm-eq"><i></i><i></i><i></i></div><img src="${thumb(cur.id)}" alt=""><div style="min-width:0"><small>${m.playing ? "Now playing" : "Paused"}</small><span>${esc(cur.title)}</span></div>`;
        chip.classList.add("on"); chip.classList.toggle("paused", !m.playing);
      } else chip.classList.remove("on");
      if (!cur) { loadedKey = null; if (ytReady) yt.stopVideo(); soundAsk.classList.remove("on"); return; }
      if (!ytReady) { api(); return; }
      yt.setVolume(m.volume ?? 80);
      const pos = wantPos(m);
      if (cur.key !== loadedKey) {
        loadedKey = cur.key;
        if (m.playing) yt.loadVideoById({ videoId: cur.id, startSeconds: pos }); else yt.cueVideoById({ videoId: cur.id, startSeconds: pos });
      } else {
        const st = yt.getPlayerState ? yt.getPlayerState() : -1;
        if (m.playing && st !== 1 && st !== 3) yt.playVideo();
        if (!m.playing && st === 1) yt.pauseVideo();
        const t = yt.getCurrentTime ? yt.getCurrentTime() : 0;
        // only correct real drift, and never while YouTube is still buffering
        if (m.playing && st === 1 && (force || Math.abs(t - pos) > 4)) yt.seekTo(pos, true);
      }
      // sound blocked until someone clicks the projector page once
      clearTimeout(askTimer);
      if (m.playing) askTimer = setTimeout(() => {
        const st = yt.getPlayerState ? yt.getPlayerState() : -1;
        if ((state.media || {}).playing && st !== 1 && st !== 3) soundAsk.classList.add("on");
      }, 2500);
    }
    soundAsk.addEventListener("click", () => { soundAsk.classList.remove("on"); if (ytReady) { yt.unMute(); yt.playVideo(); } });
    setInterval(() => { if (ytReady && (state.media || {}).playing) sync(false); }, 5000);

    // ── event views ──
    const layer = document.createElement("div"); layer.className = "pe-layer"; document.body.appendChild(layer);
    let evData = null, evTimer = null, evShownKey = "", clockTimer = null;
    async function pullEvent() {
      try {
        const r = await fetch(base + "event/data/", { credentials: "same-origin" }); const d = await r.json();
        evData = d && d.event; evData && (evData._fetched = Date.now());
        drawEvent();
      } catch (_) { /* keep showing the last data */ }
    }
    function qrInto(box, text, fallback) {
      box.innerHTML = "";
      if (window.QRCode) new QRCode(box, { text, width: 600, height: 600, colorDark: "#0b0a14", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.M });
      else if (fallback) box.innerHTML = `<img src="${esc(fallback)}" alt="QR code">`;
    }
    function eventNow() {                       // "now" in the event's own time zone
      const ms = Date.now();
      const f = new Intl.DateTimeFormat("en-GB", { timeZone: evData.tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ms));
      const g = k => (f.find(p => p.type === k) || {}).value;
      return { date: `${g("year")}-${g("month")}-${g("day")}`, mins: (+g("hour")) * 60 + (+g("minute")), clock: `${g("hour")}:${g("minute")}` };
    }
    const toMin = t => { const m = /^(\d\d):(\d\d)/.exec(t || ""); return m ? (+m[1]) * 60 + (+m[2]) : null; };
    function drawEvent() {
      const e = state.event || {};
      const on = !!(e.view && e.view !== "off" && evData);
      layer.classList.toggle("on", on);
      document.body.classList.toggle("pe-on", on);
      clearInterval(clockTimer);
      if (!on) { evShownKey = ""; return; }
      const d = evData, key = e.view + ":" + d.id;
      if (e.view === "register" || e.view === "checkin") {
        const reg = e.view === "register";
        const n = reg ? d.registered : d.checked_in, cap = d.capacity;
        const pct = reg && cap ? Math.min(100, Math.round(100 * n / cap)) : (!reg && d.registered ? Math.min(100, Math.round(100 * n / d.registered)) : 0);
        if (evShownKey !== key) {
          layer.innerHTML = `<div class="pe-reg"><div>
              <h1>${reg ? "Register for " : "Welcome to "}${esc(d.title)}</h1>
              <p>${reg ? "Scan the code with your phone camera, or type the link." : "Already registered? Scan to check in — it takes a few seconds."}</p>
              <div class="pe-url">${esc(reg ? d.register_url : d.checkin_url)}</div>
              <div class="pe-count"><b class="pe-n">0</b><span class="pe-l"></span></div>
              <div class="pe-bar"><i style="width:0%"></i></div></div>
            <div class="pe-qr"></div></div><div class="pe-welcome"></div>`;
          qrInto(layer.querySelector(".pe-qr"), reg ? d.register_url : d.checkin_url, reg ? d.qr_url : null);
          evShownKey = key;
        }
        layer.querySelector(".pe-n").textContent = n;
        layer.querySelector(".pe-l").textContent = reg ? (cap ? `registered of ${cap} places` : "registered so far") : (d.registered ? `checked in of ${d.registered} registered` : "checked in");
        layer.querySelector(".pe-bar").style.display = (reg ? cap : d.registered) ? "" : "none";
        layer.querySelector(".pe-bar i").style.width = pct + "%";
        const w = layer.querySelector(".pe-welcome");
        w.innerHTML = !reg && d.arrivals && d.arrivals.length ? d.arrivals.slice(0, 6).map((a, i) => `<span>${i ? "" : "👋 Welcome, "}${esc(a.name)}${i ? "" : "!"}</span>`).join("") : "";
        return;
      }
      // agenda
      const draw = () => {
        const now = eventNow();
        const days = d.agenda || [];
        const day = days.find(x => x.date === now.date) || days.find(x => x.date > now.date) || days[0];
        if (!day || !day.items.length) {
          layer.innerHTML = `<div class="pe-empty"><b style="font-size:1.4em">${esc(d.title)}</b><br>The agenda for this event is still empty.<br><small>Add sessions in Attendance → Agenda.</small></div>`;
          return;
        }
        const isToday = day.date === now.date;
        let nowIdx = -1, nextIdx = -1;
        day.items.forEach((it, i) => {
          const s = toMin(it.start), en = toMin(it.end) ?? (day.items[i + 1] ? toMin(day.items[i + 1].start) : null);
          if (isToday && s != null && s <= now.mins && (en == null || now.mins < en)) nowIdx = i;
          if (nextIdx < 0 && (!isToday ? i === 0 : (s != null && s > now.mins))) nextIdx = i;
        });
        const label = day.label || new Date(day.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
        const rows = day.items.map((it, i) => {
          const s = toMin(it.start), en = toMin(it.end);
          const past = isToday && ((en != null && en <= now.mins) || (en == null && i < nowIdx));
          let tag = "";
          if (i === nowIdx) tag = `<em>Now${en != null ? ` · ${en - now.mins} min left` : ""}</em>`;
          else if (i === nextIdx) tag = `<em>${isToday && s != null ? (s - now.mins < 60 ? `Up next · in ${s - now.mins} min` : `Up next · ${it.start}`) : "First up"}</em>`;
          return `<div class="pe-it${i === nowIdx ? " now" : ""}${i === nextIdx ? " next" : ""}${past ? " past" : ""}" style="--c:${esc(it.colour || "#a78bfa")}">
            <time>${esc(it.start)}${it.end ? "–" + esc(it.end) : ""}</time>
            <div><b>${esc(it.title)}</b>${it.speaker || it.track ? `<small>${esc([it.speaker, it.track].filter(Boolean).join(" · "))}</small>` : ""}</div>${tag}</div>`;
        }).join("");
        layer.innerHTML = `<div class="pe-ag"><header><div><h1>${esc(d.title)}</h1><small>${esc(label)}${d.location ? " · " + esc(d.location) : ""}</small></div>
          <div class="pe-clock">${isToday ? now.clock : ""}</div></header><div class="pe-list">${rows}</div></div>`;
        // keep "now" in view on long days
        const list = layer.querySelector(".pe-list"), cur = list.querySelector(".now") || list.querySelector(".next");
        if (cur && cur.offsetTop + cur.offsetHeight > list.clientHeight) list.scrollTop = cur.offsetTop - list.clientHeight / 3;
      };
      evShownKey = key;
      draw();
      clockTimer = setInterval(draw, 20000);
    }
    function render() {
      ui.render(state);
      sync(false);
      const e = state.event || {};
      clearInterval(evTimer);
      if (e.view && e.view !== "off" && e.id) {
        if (!evData || evData.id !== e.id || evShownKey.split(":")[0] !== e.view) { evData = evData && evData.id === e.id ? evData : null; pullEvent(); }
        else drawEvent();
        evTimer = setInterval(pullEvent, e.view === "agenda" ? 60000 : 12000);
      } else { evData = evData; drawEvent(); }
    }
    document.addEventListener("scr:state", ev => { state = ev.detail || state; render(); });
    render();
    return;
  }

  /* ───────────── dashboard ───────────── */
  document.querySelectorAll("[data-screen]").forEach(root => {
    const base = `/screenart/s/${root.dataset.token}/`;
    let state = {};
    try { state = JSON.parse(root.querySelector("[data-state]").textContent || "{}"); } catch (_) { /* ignore */ }
    const box = document.createElement("div");
    box.innerHTML = `<details class="pg-fold" data-pg="media"><summary>🎵 Music &amp; video <small class="pg-sum-m"></small></summary><div class="pg-m"></div></details>
      <details class="pg-fold" data-pg="event"><summary>📋 Event <small class="pg-sum-e"></small></summary><div class="pg-e"></div></details>`;
    const link = root.querySelector(".bs-link");
    if (link) link.parentNode.insertBefore(box, link); else root.appendChild(box);
    const ui = ProgramUI(box.querySelector(".pg-m"), box.querySelector(".pg-e"), base, s => { state = s; render(); }, {});
    box.querySelector('[data-pg="event"]').addEventListener("toggle", e => { if (e.target.open) ui.loadEvents(); });
    function render() {
      ui.render(state);
      const m = state.media || {}, e = state.event || {};
      box.querySelector(".pg-sum-m").textContent = m.current ? `${m.playing ? (m.mode === "video" ? "▶ " : "♪ ") : "⏸ "}${m.current.title}` : "Play a YouTube video or just its sound";
      box.querySelector(".pg-sum-e").textContent = e.view && e.view !== "off" ? { register: "Showing registration", checkin: "Showing check-in", agenda: "Showing the agenda" }[e.view] : "Registration, check-in or agenda on the big screen";
    }
    root.addEventListener("bs:state", ev => { state = ev.detail || state; render(); });
    render();
  });
})();
