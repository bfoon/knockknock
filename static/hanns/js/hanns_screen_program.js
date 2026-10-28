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
  .pm-chip.scratch img{animation:pmWig .18s ease-in-out infinite alternate}
  @keyframes pmWig{from{transform:rotate(-8deg)}to{transform:rotate(8deg)}}
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
    return { render(state) { renderMedia(state.media); renderEvent(state.event); }, loadEvents, media: mediaDo };
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
    let seekRev = null, duck = 1, duckTimer = null, fadeTimer = null;   // DJ booth: needle drops + FX ducking
    const fx = window.KKDJ ? window.KKDJ.engine() : null;
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
      return (m.position || 0) + Math.max(0, (Date.now() + skew - (m.started_at || 0)) / 1000) * (+m.rate || 1);
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
      yt.setVolume(Math.round((m.volume ?? 80) * duck));
      if (yt.setPlaybackRate && yt.getPlaybackRate && Math.abs(yt.getPlaybackRate() - (+m.rate || 1)) > 0.001) yt.setPlaybackRate(+m.rate || 1);
      const jumped = m.seek_rev != null && m.seek_rev !== seekRev;   // a scratch release, hot cue, nudge…
      seekRev = m.seek_rev;
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
        if (jumped && !force) yt.seekTo(pos, true);
        else if (m.playing && st === 1 && (force || Math.abs(t - pos) > 4)) yt.seekTo(pos, true);
      }
      // sound blocked until someone clicks the projector page once
      clearTimeout(askTimer);
      if (m.playing) askTimer = setTimeout(() => {
        const st = yt.getPlayerState ? yt.getPlayerState() : -1;
        if ((state.media || {}).playing && st !== 1 && st !== 3) soundAsk.classList.add("on");
      }, 2500);
    }
    soundAsk.addEventListener("click", () => { soundAsk.classList.remove("on"); fx && fx.unlock(); if (ytReady) { yt.unMute(); yt.playVideo(); } });
    document.addEventListener("pointerdown", () => fx && fx.unlock(), { passive: true });

    // ── DJ booth effects (from the screen socket, never stored) ──
    function setDuck(x, ms) {
      duck = x; clearTimeout(duckTimer); clearInterval(fadeTimer);
      if (ytReady) yt.setVolume(Math.round(((state.media || {}).volume ?? 80) * duck));
      if (ms) duckTimer = setTimeout(() => setDuck(1), ms);
    }
    function fadeOut(ms) {               // the brake: the track sinks away while the platter stops
      clearInterval(fadeTimer);
      const t0 = Date.now();
      fadeTimer = setInterval(() => {
        const p = Math.min(1, (Date.now() - t0) / ms);
        duck = 1 - p;
        if (ytReady) yt.setVolume(Math.round(((state.media || {}).volume ?? 80) * duck));
        if (p >= 1) { clearInterval(fadeTimer); duckTimer = setTimeout(() => setDuck(1), 1500); }
      }, 50);
    }
    document.addEventListener("scr:djfx", e => {
      const m = e.detail || {};
      if (!(state.media || {}).current && m.kind !== "horn" && m.kind !== "siren") return;
      if (m.kind === "scratch_start") { setDuck(0, 15000); chip.classList.add("scratch"); }   // hand on the record
      else if (m.kind === "scratch_end") { setTimeout(() => setDuck(1), 220); chip.classList.remove("scratch"); }
      else if (m.kind === "rewind") setDuck(0, 1300);
      else if (m.kind === "brake") fadeOut(1150);
      else if (m.kind === "horn") setDuck(0.55, 1100);
      if (fx) fx.handle(m);
    });
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
  /* Music & video lives in the DJ booth: a turntable you can actually play.
       • grab the record and scratch — your hand's speed streams to the
         projector (scratch voice + muted track), and on release the needle
         drops exactly where you left it
       • START·STOP, 33 / 45, a pitch fader (±8 / ±16 %), ⟲ ⟳ nudge
       • four hot cues (tap to set, tap to jump, hold to clear)
       • FX pads: air horn, siren, rewind, brake
       • 🎧 "Hear FX here" monitors the scratches and pads on this device
     Keys inside the booth: Space start/stop · 1–4 cues · Q W E R pads ·
     ← → nudge. The source row on the card shows what's playing, with a
     quick play/pause, and "Open DJ booth" (or the F3 scene key) pops it. */
  const RPM33 = 100 / 3, SEC_PER_REV = 60 / RPM33;            // 1.8 s of music per turn at 33⅓
  const fmt = s => { s = Math.max(0, s || 0); const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`; };
  const djCss = document.createElement("style");
  djCss.textContent = `
  .dj-row{display:flex;align-items:center;gap:.9rem;padding:.75rem 1.2rem;flex-wrap:wrap}
  .dj-row .ico{flex:none;width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:1.15rem;color:#c4b5fd;background:rgba(167,139,250,.12)}
  .dj-row.playing .ico i{animation:djSpin 2.4s linear infinite}
  .dj-row .tx{flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:.15rem}
  .dj-row .tx b{font-size:.95rem}
  .dj-row .tx small{font-size:.8rem;color:#a9a6c2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dj-row .acts{display:flex;gap:.45rem;flex-wrap:wrap}
  .dj-row .acts button{min-height:40px;border-radius:11px;padding:0 .9rem;font:600 .82rem/1 system-ui,sans-serif;cursor:pointer;
    border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#f1f5f9;display:inline-flex;align-items:center;gap:.4rem}
  .dj-row .acts .go{border:0;color:#1b1030;background:linear-gradient(135deg,#c4b5fd,#22d3ee)}
  .dj-row .acts button[hidden]{display:none}
  details.pg-fold{border-top:1px solid rgba(255,255,255,.09);padding:0}
  details.pg-fold>summary{padding:.75rem 1.2rem;gap:.9rem}
  details.pg-fold>summary::after{margin-right:.2rem}
  details.pg-fold>summary .ico{flex:none;width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:1.1rem;color:#67e8f9;background:rgba(34,211,238,.1)}
  details.pg-fold>summary .tx{display:flex;flex-direction:column;gap:.15rem;min-width:0}
  details.pg-fold>summary .tx small{font-size:.8rem}
  details.pg-fold .pg-e{padding:0 1.2rem 1rem}
  @keyframes djSpin{to{transform:rotate(360deg)}}

  /* ── the booth ── */
  dialog.dj{width:min(1000px,96vw);max-height:94vh;padding:0;border:0;border-radius:26px;color:#f3f1fa;overflow:auto;
    background:#0b0a12;box-shadow:0 40px 120px -20px rgba(0,0,0,.9),0 0 0 1px rgba(255,255,255,.08);
    font-family:"Inter",system-ui,sans-serif}
  dialog.dj::backdrop{background:rgba(3,2,8,.78);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px)}
  dialog.dj[open]{animation:djIn .3s cubic-bezier(.2,.9,.3,1.15) both}
  @keyframes djIn{from{opacity:0;transform:translateY(16px) scale(.97)}}
  .dj button{font-family:inherit}
  .dj button:focus-visible,.dj input:focus-visible{outline:2px solid #22d3ee;outline-offset:2px}
  .dj-top{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:1rem 1.3rem;border-bottom:1px solid rgba(255,255,255,.07);flex-wrap:wrap}
  .dj-top .k{font:600 .6rem/1 "Spline Sans Mono",ui-monospace,monospace;letter-spacing:.24em;text-transform:uppercase;color:#a9a6c2}
  .dj-top h3{margin:.32rem 0 0;font:800 1.45rem/1 "Archivo",system-ui,sans-serif;letter-spacing:-.02em}
  .dj-tr{display:flex;gap:.5rem;align-items:center}
  .dj-ear{min-height:42px;padding:0 .85rem;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#cbd5e1;
    display:inline-flex;align-items:center;gap:.45rem;cursor:pointer;font-size:.8rem;font-weight:600}
  .dj-ear[aria-pressed="true"]{color:#04121a;background:#22d3ee;border-color:#22d3ee}
  .dj-x{width:42px;height:42px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#f1f5f9;cursor:pointer;font-size:1.05rem}

  /* plinth */
  .tt{margin:1.1rem 1.3rem 0;border-radius:22px;padding:1.2rem;display:grid;grid-template-columns:minmax(0,1fr) 92px;gap:1.2rem;
    background:linear-gradient(180deg,#22212b,#17161e);border:1px solid rgba(255,255,255,.08);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.08),inset 0 -20px 40px rgba(0,0,0,.35),0 18px 40px -18px rgba(0,0,0,.9)}
  .tt-left{display:flex;flex-direction:column;gap:1rem;min-width:0}
  .tt-plat{position:relative;width:min(100%,430px);aspect-ratio:1;margin:0 auto;touch-action:none;user-select:none;-webkit-user-select:none}
  .tt-rim{position:absolute;inset:0;border-radius:50%;
    background:conic-gradient(from 0deg,#8d8c96,#d9d8de,#6f6e78,#c8c7cf,#7c7b85,#e3e2e8,#73727c,#bfbec6,#8d8c96);
    box-shadow:0 14px 34px rgba(0,0,0,.75),inset 0 0 0 2px rgba(0,0,0,.5)}
  .tt-strobe{position:absolute;inset:1.4%;border-radius:50%;
    background:repeating-conic-gradient(from 0deg,#2b2a33 0 3deg,#55545e 3deg 6deg);
    -webkit-mask:radial-gradient(circle,transparent 66%,#000 66.5%,#000 69%,transparent 69.5%);mask:radial-gradient(circle,transparent 66%,#000 66.5%,#000 69%,transparent 69.5%)}
  .tt-rec{position:absolute;inset:4.5%;border-radius:50%;cursor:grab;will-change:transform;
    background:
      radial-gradient(circle,transparent 31%,rgba(255,255,255,.05) 31.4%,transparent 32%),
      repeating-radial-gradient(circle,#0a0a0d 0 1.4px,#17161c 1.4px 2.8px);
    box-shadow:inset 0 0 0 3px #050507,0 0 0 1px rgba(0,0,0,.6)}
  .tt-rec::before{content:"";position:absolute;inset:0;border-radius:50%;
    background:conic-gradient(from 35deg,transparent 0 30deg,rgba(255,255,255,.09) 45deg,transparent 60deg 205deg,rgba(255,255,255,.06) 222deg,transparent 240deg)}
  .tt-sheen{position:absolute;inset:4.5%;border-radius:50%;pointer-events:none;
    background:conic-gradient(from 300deg,transparent 0 20deg,rgba(255,255,255,.08) 34deg,transparent 48deg 180deg,rgba(255,255,255,.05) 200deg,transparent 220deg)}
  .tt-plat.held .tt-rec{cursor:grabbing}
  .tt-lab{position:absolute;inset:33%;border-radius:50%;background:#7c3aed center/cover no-repeat;border:3px solid #0a0a0d;
    display:grid;place-items:center;overflow:hidden}
  .tt-lab span{font:800 .62rem/1.1 "Archivo",system-ui,sans-serif;color:#fff;text-align:center;padding:0 14%;text-shadow:0 1px 6px rgba(0,0,0,.9)}
  .tt-lab.art span{display:none}
  .tt-spin{position:absolute;left:50%;top:50%;width:3.2%;aspect-ratio:1;margin:-1.6%;border-radius:50%;
    background:radial-gradient(circle at 35% 30%,#f5f5f7,#8b8a93);box-shadow:0 1px 3px rgba(0,0,0,.8);pointer-events:none}
  .tt-mark{position:absolute;left:50%;top:5%;width:2px;height:7%;margin-left:-1px;background:rgba(255,255,255,.55);border-radius:1px}
  .tt-hint{position:absolute;left:50%;bottom:-2px;translate:-50% 100%;font-size:.72rem;color:#8f8ba6;white-space:nowrap;padding-top:.45rem}
  .tt-plat.held .tt-hint{color:#fbbf24}
  .tt-arm{position:absolute;top:-3%;right:-6%;width:30%;height:82%;pointer-events:none;transform-origin:72% 9%;
    transform:rotate(-30deg);transition:transform .9s cubic-bezier(.3,.85,.25,1.1);filter:drop-shadow(0 10px 8px rgba(0,0,0,.55))}
  .tt.on .tt-arm{transform:rotate(var(--arm,2deg))}
  .tt-arm svg{width:100%;height:100%;overflow:visible}

  .tt-bar{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap}
  .tt-ss{min-width:108px;min-height:62px;border-radius:12px;border:1px solid #000;cursor:pointer;color:#e5e7eb;
    font:800 .72rem/1.15 "Archivo",system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase;
    background:linear-gradient(180deg,#3a3944,#24232c);box-shadow:inset 0 1px 0 rgba(255,255,255,.14),0 4px 0 #0b0a10,0 6px 12px rgba(0,0,0,.5);
    display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.3rem;transition:transform .06s,box-shadow .06s}
  .tt-ss:active{transform:translateY(3px);box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 1px 0 #0b0a10}
  .tt-ss i.led{width:26px;height:4px;border-radius:2px;background:#3f1d12}
  .tt.on .tt-ss i.led{background:#ff6a2b;box-shadow:0 0 10px #ff6a2b}
  .tt-spd{display:flex;gap:.35rem}
  .tt-spd button,.tt-nudge button{min-width:50px;min-height:44px;border-radius:10px;border:1px solid #000;cursor:pointer;color:#cbd5e1;
    font:700 .82rem/1 "Spline Sans Mono",ui-monospace,monospace;background:linear-gradient(180deg,#32313b,#22212a);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 3px 0 #0b0a10}
  .tt-spd button:active,.tt-nudge button:active{transform:translateY(2px);box-shadow:0 1px 0 #0b0a10}
  .tt-spd button[aria-pressed="true"]{color:#ffb38a;box-shadow:inset 0 1px 0 rgba(255,255,255,.1),0 3px 0 #0b0a10,inset 0 -3px 0 #ff6a2b}
  .tt-nudge{display:flex;gap:.35rem}
  .tt-lcd{margin-left:auto;min-width:150px;padding:.55rem .8rem;border-radius:10px;background:#071512;border:1px solid #0f2a24;
    font:700 1.35rem/1 "Spline Sans Mono",ui-monospace,monospace;color:#5eead4;text-shadow:0 0 8px rgba(94,234,212,.45);text-align:right}
  .tt-lcd small{display:block;margin-top:.3rem;font-size:.6rem;letter-spacing:.14em;color:#2dd4bf;opacity:.75}

  /* pitch fader column */
  .tt-pitch{align-self:center;display:flex;flex-direction:column;align-items:center;gap:.55rem;padding:.6rem .4rem;border-radius:14px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.06)}
  .tt-pitch .k{font:600 .56rem/1 "Spline Sans Mono",ui-monospace,monospace;letter-spacing:.18em;color:#8f8ba6}
  .tt-track{position:relative;flex:none;height:min(300px,44vh);width:44px;display:flex;justify-content:center}
  .tt-track::before{content:"";position:absolute;top:6px;bottom:6px;left:50%;width:6px;margin-left:-3px;border-radius:3px;background:#050508;box-shadow:inset 0 1px 2px #000}
  .tt-track::after{content:"";position:absolute;top:50%;left:4px;right:4px;height:2px;margin-top:-1px;background:#22c55e;box-shadow:0 0 6px #22c55e}
  .tt-fader{-webkit-appearance:none;appearance:none;writing-mode:vertical-lr;direction:ltr;width:44px;height:100%;block-size:44px;inline-size:100%;margin:0;background:transparent;cursor:ns-resize;position:relative;z-index:1}
  .tt-fader::-webkit-slider-runnable-track{width:44px;background:transparent}
  .tt-fader::-moz-range-track{background:transparent}
  .tt-fader::-webkit-slider-thumb{-webkit-appearance:none;width:40px;height:24px;border-radius:5px;border:1px solid #000;
    background:linear-gradient(180deg,#e7e6ec 0,#b9b8c1 45%,#3b3a44 46%,#3b3a44 54%,#b9b8c1 55%,#e7e6ec 100%);box-shadow:0 3px 6px rgba(0,0,0,.6)}
  .tt-fader::-moz-range-thumb{width:40px;height:24px;border-radius:5px;border:1px solid #000;
    background:linear-gradient(180deg,#e7e6ec 0,#b9b8c1 45%,#3b3a44 46%,#3b3a44 54%,#b9b8c1 55%,#e7e6ec 100%);box-shadow:0 3px 6px rgba(0,0,0,.6)}
  .tt-m{font:700 .8rem/1 "Spline Sans Mono",ui-monospace,monospace;color:#77738f;margin:-.2rem 0}
  .tt-pv{font:700 .78rem/1 "Spline Sans Mono",ui-monospace,monospace;color:#5eead4;min-width:4.6em;text-align:center}
  .tt-pitch .row{display:flex;gap:.25rem}
  .tt-pitch .row button{min-height:32px;padding:0 .4rem;border-radius:7px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);
    color:#cbd5e1;font:600 .62rem/1 "Spline Sans Mono",ui-monospace,monospace;cursor:pointer}
  .tt-pitch .row button[aria-pressed="true"]{border-color:#5eead4;color:#5eead4}
  .tt-pitch .zero{width:100%;min-height:32px;border-radius:7px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#cbd5e1;font-size:.66rem;cursor:pointer}

  /* pads */
  .dj-pads{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;padding:1.1rem 1.3rem 0}
  .dj-pads h4{margin:0 0 .5rem;display:flex;justify-content:space-between;gap:.5rem;font:600 .6rem/1 "Spline Sans Mono",ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#a9a6c2}
  .dj-pads h4 small{letter-spacing:0;text-transform:none;font-family:inherit;color:#77738f}
  .dj-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.5rem}
  .pad{--c:#22d3ee;position:relative;min-height:74px;border-radius:12px;border:1px solid rgba(0,0,0,.6);cursor:pointer;color:#f8fafc;
    background:linear-gradient(180deg,#1f1e27,#16151d);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),inset 0 0 0 1px rgba(255,255,255,.03),0 3px 0 #08070c;
    display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;padding:.55rem .6rem;text-align:left;transition:transform .05s,box-shadow .12s,background .12s}
  .pad b{font:800 .95rem/1 "Archivo",system-ui,sans-serif}
  .pad small{font:600 .66rem/1 "Spline Sans Mono",ui-monospace,monospace;color:#8f8ba6}
  .pad i.bi{font-size:1.1rem;color:var(--c)}
  .pad:active,.pad.hit{transform:translateY(2px);box-shadow:0 1px 0 #08070c,0 0 24px -4px var(--c),inset 0 0 0 2px var(--c)}
  .pad.set{background:linear-gradient(180deg,color-mix(in srgb,var(--c) 30%,#1f1e27),color-mix(in srgb,var(--c) 14%,#16151d));
    box-shadow:inset 0 1px 0 rgba(255,255,255,.12),inset 0 0 0 1px color-mix(in srgb,var(--c) 70%,transparent),0 3px 0 #08070c}
  .pad.set small{color:#f1f5f9}
  .pad .key{position:absolute;top:.45rem;right:.5rem;font:600 .55rem/1 "Spline Sans Mono",ui-monospace,monospace;color:#5c5873}
  .pad:disabled{opacity:.4;cursor:default}

  .dj-now{display:flex;align-items:center;gap:.8rem;margin:1.1rem 1.3rem 0;padding:.7rem .9rem;border-radius:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);min-width:0}
  .dj-now .k{flex:none;font:600 .56rem/1 "Spline Sans Mono",ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#a9a6c2}
  .dj-now b{flex:1;min-width:0;font-size:.92rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .dj-now small{flex:none;color:#a9a6c2;font-size:.78rem}
  .dj-body{padding:.2rem 1.3rem 1.3rem}
  .dj-body .pg-h h3::before{content:"Crate · "}
  .dj-body .pg-sec{margin-top:.8rem}
  .dj-body .pg-now{display:block;margin:.6rem 0 0;padding:.7rem;border-radius:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07)}
  .dj-body .pg-now>img,.dj-body .pg-now>div:not(.pg-ctl),.dj-body [data-ma="toggle"]{display:none}
  .dj-body .pg-ctl{display:flex;gap:.45rem;flex-wrap:wrap;align-items:center}
  .dj-body .pg-cur:empty+.pg-q:empty::before{content:"The crate is empty — paste a YouTube link above to put a record on.";display:block;padding:1rem;border-radius:12px;
    border:1px dashed rgba(255,255,255,.14);color:#a9a6c2;font-size:.85rem;text-align:center}
  .dj-toast{position:sticky;bottom:1rem;margin:0 auto;width:max-content;max-width:90%;padding:.55rem .9rem;border-radius:999px;background:#fbbf24;color:#1c1300;
    font-weight:700;font-size:.82rem;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;pointer-events:none}
  .dj-toast.on{opacity:1;transform:none}
  @media (max-width:760px){
    .tt{grid-template-columns:1fr}
    .tt-pitch{flex-direction:row;flex-wrap:wrap;justify-content:center}
    .tt-track{min-height:0;height:44px;width:100%;max-width:260px}
    .tt-track::before{top:50%;bottom:auto;left:6px;right:6px;width:auto;height:6px;margin:-3px 0 0}
    .tt-track::after{left:50%;right:auto;top:4px;bottom:4px;width:2px;height:auto;margin:0 0 0 -1px}
    .tt-fader{writing-mode:horizontal-tb;width:100%;height:44px;inline-size:100%;block-size:44px}
    .dj-pads{grid-template-columns:1fr}
    .tt-lcd{margin-left:0}
  }
  @media (prefers-reduced-motion:reduce){.dj-row .ico i{animation:none!important}}`;
  document.head.appendChild(djCss);

  const ARM_SVG = `<svg viewBox="0 0 100 300" aria-hidden="true">
    <circle cx="72" cy="27" r="22" fill="#2a2933" stroke="#4a4955" stroke-width="3"/><circle cx="72" cy="27" r="9" fill="#9d9ca6"/>
    <rect x="58" y="-8" width="28" height="20" rx="4" fill="#3a3944"/>
    <path d="M72 27 L66 210 L44 262" fill="none" stroke="#c9c8d0" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M72 27 L66 210 L44 262" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round"/>
    <rect x="28" y="250" width="30" height="36" rx="5" transform="rotate(24 43 268)" fill="#1d1c24" stroke="#5b5a66" stroke-width="2"/>
    <rect x="34" y="282" width="8" height="10" rx="2" transform="rotate(24 43 268)" fill="#ff6a2b"/></svg>`;

  document.querySelectorAll("[data-screen]").forEach(root => {
    const base = `/screenart/s/${root.dataset.token}/`;
    let state = {};
    try { state = JSON.parse(root.querySelector("[data-state]").textContent || "{}"); } catch (_) { /* ignore */ }
    const box = document.createElement("div");
    box.innerHTML = `<div class="dj-row" data-pg="media">
        <span class="ico" aria-hidden="true"><i class="bi bi-vinyl-fill"></i></span>
        <span class="tx"><b>Music &amp; video</b><small class="pg-sum-m"></small></span>
        <span class="acts">
          <button type="button" data-dj-quick hidden></button>
          <button type="button" class="go" data-dj-open><i class="bi bi-vinyl"></i> Open DJ booth</button>
        </span></div>
      <details class="pg-fold" data-pg="event"><summary><span class="ico" aria-hidden="true"><i class="bi bi-clipboard-check"></i></span>
        <span class="tx"><b>Event</b><small class="pg-sum-e"></small></span></summary><div class="pg-e"></div></details>`;
    const slot = root.querySelector("[data-addons]"), link = root.querySelector(".bs-link");
    if (slot) slot.appendChild(box);
    else if (link) link.parentNode.insertBefore(box, link); else root.appendChild(box);

    const CUE_COLORS = ["#22d3ee", "#a78bfa", "#f5a524", "#fb7185"];
    const FX = [["horn", "Air horn", "bi-megaphone-fill", "Q", "#f5a524"], ["siren", "Siren", "bi-bell-fill", "W", "#fb7185"],
                ["rewind", "Rewind", "bi-rewind-fill", "E", "#22d3ee"], ["brake", "Brake", "bi-stop-circle-fill", "R", "#a78bfa"]];
    const dj = document.createElement("dialog");
    dj.className = "dj";
    dj.setAttribute("aria-label", "DJ booth");
    dj.innerHTML = `<div class="dj-top"><div><div class="k">DJ booth · plays on the projector</div><h3 class="dj-name"></h3></div>
        <div class="dj-tr">
          <button type="button" class="dj-ear" data-ear aria-pressed="false" title="Play the scratches and pads on this device too"><i class="bi bi-headphones"></i> Hear FX here</button>
          <button type="button" class="dj-x" data-dj-close aria-label="Close the DJ booth">✕</button></div></div>
      <div class="tt">
        <div class="tt-left">
          <div class="tt-plat" data-plat role="slider" tabindex="0" aria-label="Record — drag to scratch" aria-valuetext="0:00">
            <div class="tt-rim"></div><div class="tt-strobe" data-strobe></div>
            <div class="tt-rec" data-rec><div class="tt-mark"></div><div class="tt-lab" data-lab><span data-lab-t>Hanns</span></div></div>
            <div class="tt-sheen"></div><div class="tt-spin"></div>
            <div class="tt-arm">${ARM_SVG}</div>
            <div class="tt-hint" data-hint>Grab the record to scratch</div>
          </div>
          <div class="tt-bar" style="margin-top:1.4rem">
            <button type="button" class="tt-ss" data-ss title="Start / stop (Space)"><i class="led"></i>Start · Stop</button>
            <div class="tt-spd" role="group" aria-label="Speed">
              <button type="button" data-spd="1" aria-pressed="true">33</button><button type="button" data-spd="1.35" aria-pressed="false">45</button></div>
            <div class="tt-nudge" role="group" aria-label="Nudge">
              <button type="button" data-nudge="-5" title="Back 5 s (←)" aria-label="Back 5 seconds"><i class="bi bi-arrow-counterclockwise"></i> 5</button>
              <button type="button" data-nudge="5" title="Forward 5 s (→)" aria-label="Forward 5 seconds">5 <i class="bi bi-arrow-clockwise"></i></button></div>
            <div class="tt-lcd" aria-live="off"><span data-time>0:00.0</span><small data-spdtxt>33 RPM · 0.0 %</small></div>
          </div>
        </div>
        <div class="tt-pitch">
          <span class="k">Pitch</span>
          <span class="tt-m" aria-hidden="true">−</span>
          <div class="tt-track"><input class="tt-fader" type="range" min="-8" max="8" step="0.1" value="0" data-pitch aria-label="Pitch"></div>
          <span class="tt-m" aria-hidden="true">+</span>
          <span class="tt-pv" data-pv>0.0 %</span>
          <div class="row"><button type="button" data-prange="8" aria-pressed="true">±8</button><button type="button" data-prange="16" aria-pressed="false">±16</button></div>
          <button type="button" class="zero" data-pzero>Reset</button>
        </div>
      </div>
      <div class="dj-pads">
        <div><h4>Hot cues <small>tap set · tap jump · hold clear</small></h4><div class="dj-grid" data-cues>
          ${[0, 1, 2, 3].map(i => `<button type="button" class="pad" data-cue="${i}" style="--c:${CUE_COLORS[i]}"><span class="key">${i + 1}</span><b>${"ABCD"[i]}</b><small>set</small></button>`).join("")}</div></div>
        <div><h4>Effects <small>Q W E R</small></h4><div class="dj-grid">
          ${FX.map(([k, l, ic, key, c]) => `<button type="button" class="pad" data-fx="${k}" style="--c:${c}"><span class="key">${key}</span><i class="bi ${ic}"></i><b>${l}</b></button>`).join("")}</div></div>
      </div>
      <div class="dj-now"><span class="k">On the deck</span><b class="dj-t">Nothing yet</b><small class="dj-s"></small></div>
      <div class="dj-body pg-m"></div>
      <div class="dj-toast" data-toast></div>`;
    document.body.appendChild(dj);

    const ui = ProgramUI(dj.querySelector(".pg-m"), box.querySelector(".pg-e"), base, s => { state = s; render(); }, {});
    const evFold = box.querySelector('[data-pg="event"]');
    evFold.addEventListener("toggle", e => { if (e.target.open) ui.loadEvents(); });

    const $ = sel => dj.querySelector(sel);
    const plat = $("[data-plat]"), rec = $("[data-rec]"), strobe = $("[data-strobe]"), tt = dj.querySelector(".tt");
    const fx = window.KKDJ ? window.KKDJ.engine() : null;
    let ear = false, skew = 0, skewFrom = null, toastT = null;
    let speedBase = 1, pitchRange = 8, pitchPending = null, pitchUntil = 0;

    function toast(t) {
      const n = $("[data-toast]"); n.textContent = t; n.classList.add("on");
      clearTimeout(toastT); toastT = setTimeout(() => n.classList.remove("on"), 2600);
    }
    async function post(path, body) {
      try {
        const r = await fetch(base + path, { method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() }, body: JSON.stringify(body || {}) });
        let d = null; try { d = await r.json(); } catch (_) { /* html */ }
        if (r.status === 410) { location.reload(); return null; }
        if (!r.ok || !d || !d.ok) { toast((d && d.error) || "Something went wrong"); return null; }
        if (d.state) { state = d.state; render(); }
        return d;
      } catch (_) { toast("No connection to the screen"); return null; }
    }
    const media = body => post("media/", body);
    const sendFx = (kind, extra) => post("dj/fx/", Object.assign({ kind }, extra || {}));
    const cur = () => (state.media || {}).current || null;
    function pos() {                            // where the needle is now, on the server's clock
      const m = state.media || {};
      if (!m.current) return 0;
      if (!m.playing) return m.position || 0;
      return (m.position || 0) + Math.max(0, (Date.now() + skew - (m.started_at || 0)) / 1000) * (+m.rate || 1);
    }
    function needTrack() { if (cur()) return true; toast("Put a record on first — paste a YouTube link in the crate."); return false; }

    /* ── the platter: motor + hand ── */
    let angle = 0, motor = 0, last = performance.now(), raf = 0, armTwitch = 0, strobeA = 0, prevAngle = 0;
    let held = null;            // {lastA, lastT, grabPos, revs, samples:[], playing, sendT}
    function targetSpeed() { const m = state.media || {}; return m.current && m.playing ? (+m.rate || 1) : 0; }
    function frame(t) {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      if (!held) {
        // a direct-drive motor: quick to start, a little slower to stop
        const tgt = targetSpeed(), k = tgt > motor ? 7 : 4;
        motor += (tgt - motor) * Math.min(1, dt * k);
        angle += motor * dt * 360 * RPM33 / 60;
      }
      rec.style.transform = `rotate(${angle}deg)`;
      // strobe dots look still at exactly 33⅓ / 45 with the pitch at zero, and drift as you pitch
      if (held) strobeA += angle - prevAngle;
      else if (motor > 0.05) strobeA += (motor / (speedBase || 1) - 1) * dt * 360 * 0.8;
      prevAngle = angle;
      strobe.style.transform = `rotate(${strobeA}deg)`;
      const p = pos();
      $("[data-time]").textContent = fmt(held ? Math.max(0, held.grabPos + held.revs * SEC_PER_REV) : p);
      plat.setAttribute("aria-valuetext", fmt(p));
      armTwitch = (armTwitch + dt) % 1000;
      tt.style.setProperty("--arm", `${2 + Math.min(16, p / 30) + Math.sin(armTwitch * 2) * 0.15}deg`);
      raf = dj.open ? requestAnimationFrame(frame) : 0;
    }
    const angleAt = e => { const r = plat.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
    function flush(final) {
      if (!held || !held.samples.length) return;
      const v = held.samples.splice(0, 64);
      sendFx("scratch", { v, dt: 30 });
      if (final && held.samples.length) flush(true);
    }
    plat.addEventListener("pointerdown", e => {
      if (e.button !== 0 || !cur()) { if (!cur()) needTrack(); return; }
      e.preventDefault();
      plat.setPointerCapture(e.pointerId);
      fx && fx.unlock();
      held = { lastA: angleAt(e), grabPos: pos(), revs: 0, samples: [], acc: 0, tick: 0 };
      // every 30 ms: platter speed relative to 33⅓ (1 = normal play); every 3rd tick → projector
      held.timer = setInterval(() => {
        if (!held) return;
        const v = Math.round((held.acc / 360) / 0.03 / (RPM33 / 60) * 1000) / 1000;
        held.acc = 0;
        held.samples.push(v);
        if (ear && fx) fx.scratch([v], 30);
        if (++held.tick % 3 === 0) flush(false);
      }, 30);
      motor = 0;
      plat.classList.add("held");
      $("[data-hint]").textContent = "Scratching — let go to drop the needle";
      sendFx("scratch_start");
      if (ear && fx) fx.scratchStart();
    });
    plat.addEventListener("pointermove", e => {
      if (!held) return;
      const a = angleAt(e);
      let d = a - held.lastA; if (d > 180) d -= 360; if (d < -180) d += 360;
      held.lastA = a; angle += d; held.revs += d / 360; held.acc += d;
    });
    function release() {
      if (!held) return;
      clearInterval(held.timer);
      held.samples.push(0); flush(true);
      const to = Math.max(0, held.grabPos + held.revs * SEC_PER_REV);
      held = null;
      plat.classList.remove("held");
      $("[data-hint]").textContent = "Grab the record to scratch";
      if (ear && fx) fx.scratchEnd();
      sendFx("scratch_end", { position: to });
      media({ action: "seek", position: to });
    }
    plat.addEventListener("pointerup", release);
    plat.addEventListener("pointercancel", release);
    plat.addEventListener("lostpointercapture", release);
    plat.addEventListener("keydown", e => {             // keyboard: ← → nudge the record
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); nudge(e.key === "ArrowLeft" ? -2 : 2); }
    });

    function nudge(s) { if (needTrack()) media({ action: "seek", position: Math.max(0, pos() + s) }); }
    function startStop() {
      if (!needTrack()) return;
      const m = state.media || {};
      media({ action: m.playing ? "pause" : "play" });
    }
    function setRate() {
      const pitch = +$("[data-pitch]").value || 0;
      const r = Math.round(speedBase * (1 + pitch / 100) * 1000) / 1000;
      clearTimeout(pitchPending);
      pitchUntil = Date.now() + 900;
      pitchPending = setTimeout(() => { pitchPending = null; media({ action: "rate", rate: r }); }, 220);
      showSpeed(r);
    }
    function showSpeed(rate) {
      const pitch = (rate / speedBase - 1) * 100;
      $("[data-pv]").textContent = `${pitch >= 0 ? "+" : ""}${pitch.toFixed(1)} %`;
      $("[data-spdtxt]").textContent = `${speedBase > 1.1 ? 45 : 33} RPM · ${pitch >= 0 ? "+" : ""}${pitch.toFixed(1)} %`;
    }
    function cueTap(i, long) {
      if (!needTrack()) return;
      const cues = cur().cues || [];
      if (long) { if (cues[i] != null) { media({ action: "cue_clear", slot: i }); toast(`Cue ${"ABCD"[i]} cleared`); } return; }
      if (cues[i] == null) media({ action: "cue_set", slot: i, position: pos() });
      else media({ action: "seek", position: cues[i] });
    }
    function pad(kind) {
      if (kind !== "horn" && kind !== "siren" && !needTrack()) return;
      fx && fx.unlock();
      sendFx(kind);
      if (ear && fx) fx[kind]();
      const p = dj.querySelector(`[data-fx="${kind}"]`); p.classList.add("hit"); setTimeout(() => p.classList.remove("hit"), 180);
      if (kind === "rewind") {           // spin back to cue A (or 10 s), then carry on
        const a = (cur().cues || [])[0], to = a != null && a < pos() ? a : Math.max(0, pos() - 10);
        motor = -6; setTimeout(() => media({ action: "seek", position: to }), 1000);
      } else if (kind === "brake") {
        setTimeout(() => media({ action: "pause" }), 1150);
      }
    }

    // long-press for cue pads
    dj.querySelectorAll("[data-cue]").forEach(b => {
      let t = null, long = false;
      b.addEventListener("pointerdown", () => { long = false; t = setTimeout(() => { long = true; cueTap(+b.dataset.cue, true); }, 600); });
      ["pointerup", "pointerleave", "pointercancel"].forEach(ev => b.addEventListener(ev, () => clearTimeout(t)));
      b.addEventListener("click", e => { e.preventDefault(); if (!long) cueTap(+b.dataset.cue, false); });
      b.addEventListener("contextmenu", e => { e.preventDefault(); cueTap(+b.dataset.cue, true); });
    });
    dj.addEventListener("click", e => {
      if (e.target === dj || e.target.closest("[data-dj-close]")) { closeDj(); return; }
      const b = e.target.closest("button"); if (!b) return;
      if (b.hasAttribute("data-ss")) startStop();
      else if (b.dataset.spd) {
        speedBase = +b.dataset.spd;
        dj.querySelectorAll("[data-spd]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
        setRate();
      } else if (b.dataset.nudge) nudge(+b.dataset.nudge);
      else if (b.dataset.fx) pad(b.dataset.fx);
      else if (b.dataset.prange) {
        pitchRange = +b.dataset.prange;
        const f = $("[data-pitch]"); f.min = -pitchRange; f.max = pitchRange;
        dj.querySelectorAll("[data-prange]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
        setRate();
      } else if (b.hasAttribute("data-pzero")) { $("[data-pitch]").value = 0; setRate(); }
      else if (b.hasAttribute("data-ear")) {
        ear = !ear; b.setAttribute("aria-pressed", String(ear));
        if (ear && fx) fx.unlock();
        if (ear && !(fx && fx.supported)) toast("This browser can't play the effects");
      }
    });
    $("[data-pitch]").addEventListener("input", setRate);
    $("[data-pitch]").addEventListener("dblclick", () => { $("[data-pitch]").value = 0; setRate(); });
    dj.addEventListener("keydown", e => {
      if (e.target.matches("input[type=url],input[type=text],select,textarea")) return;
      const k = e.key.toLowerCase();
      if (k === " " && !e.target.matches("button")) { e.preventDefault(); startStop(); }
      else if ("1234".includes(k) && k.length === 1) { e.preventDefault(); cueTap(+k - 1, e.shiftKey); }
      else if ("qwer".includes(k) && k.length === 1) { e.preventDefault(); pad(FX["qwer".indexOf(k)][0]); }
      else if (k === "arrowleft" || k === "arrowright") { if (e.target.matches("input[type=range]")) return; e.preventDefault(); nudge(k === "arrowleft" ? -5 : 5); }
    });

    function openDj() {
      if (typeof dj.showModal === "function") { if (!dj.open) dj.showModal(); } else dj.setAttribute("open", "");
      last = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
      const url = dj.querySelector(".pg-url");
      if (url && !cur()) setTimeout(() => url.focus(), 60);
      else setTimeout(() => plat.focus(), 60);
    }
    function closeDj() { release(); if (typeof dj.close === "function") dj.close(); else dj.removeAttribute("open"); }
    dj.addEventListener("close", release);

    // the card's F3 / F4 scene keys and the row buttons
    root.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-dj-open")) { e.preventDefault(); openDj(); }
      else if (b.hasAttribute("data-dj-quick")) { e.preventDefault(); if (cur()) startStop(); }
      else if (b.hasAttribute("data-event-open")) {
        e.preventDefault();
        evFold.open = true;
        evFold.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    function render() {
      ui.render(state);
      const m = state.media || {}, e = state.event || {}, c = m.current;
      if (m.server_now && m.server_now !== skewFrom) { skewFrom = m.server_now; skew = m.server_now - Date.now(); }
      box.querySelector(".pg-sum-m").textContent = c ? `${m.playing ? (m.mode === "video" ? "▶ " : "♪ ") : "⏸ "}${c.title}` : "Play a YouTube video or just its sound";
      box.querySelector(".pg-sum-e").textContent = e.view && e.view !== "off" ? { register: "Showing registration", checkin: "Showing check-in", agenda: "Showing the agenda" }[e.view] : "Registration, check-in or agenda on the big screen";
      box.querySelector(".dj-row").classList.toggle("playing", !!(c && m.playing));
      const q = box.querySelector("[data-dj-quick]");
      q.hidden = !c;
      q.innerHTML = m.playing ? '<i class="bi bi-pause-fill"></i> Pause' : '<i class="bi bi-play-fill"></i> Play';

      // the deck
      $(".dj-name").textContent = state.name || "Big screen";
      tt.classList.toggle("on", !!(c && m.playing));
      $(".dj-t").textContent = c ? c.title : "Nothing yet — paste a YouTube link in the crate";
      $(".dj-s").textContent = c ? `${m.mode === "video" ? "Video on screen" : "Audio only"}${(m.queue || []).length ? ` · ${m.queue.length} up next` : ""}` : "";
      const lab = $("[data-lab]");
      lab.style.backgroundImage = c ? `url("${thumb(c.id)}")` : "";
      lab.classList.toggle("art", !!c);
      $("[data-lab-t]").textContent = state.name || "Hanns";
      // speed: infer 33/45 from the stored rate, keep the fader where the server says
      const rate = +m.rate || 1;
      if (Date.now() > pitchUntil || !dj.open) {
        speedBase = rate > 1.25 ? 1.35 : 1;
        dj.querySelectorAll("[data-spd]").forEach(x => x.setAttribute("aria-pressed", String(+x.dataset.spd === speedBase)));
        const pitch = (rate / speedBase - 1) * 100;
        if (Math.abs(pitch) > pitchRange) {
          pitchRange = 16; const f = $("[data-pitch]"); f.min = -16; f.max = 16;
          dj.querySelectorAll("[data-prange]").forEach(x => x.setAttribute("aria-pressed", String(+x.dataset.prange === 16)));
        }
        if (document.activeElement !== $("[data-pitch]")) $("[data-pitch]").value = pitch.toFixed(1);
        showSpeed(rate);
      }
      // hot cues
      const cues = (c && c.cues) || [];
      dj.querySelectorAll("[data-cue]").forEach(b => {
        const i = +b.dataset.cue, v = cues[i];
        b.classList.toggle("set", v != null);
        b.querySelector("small").textContent = v != null ? fmt(v) : "set";
        b.disabled = !c;
        b.title = v != null ? `Jump to ${fmt(v)} — hold to clear` : "Set a cue here";
      });
      const djKey = root.querySelector(".st-key[data-dj-open]");
      if (djKey) djKey.classList.toggle("on", !!(c && m.playing));
      const evKey = root.querySelector(".st-key[data-event-open]");
      if (evKey) evKey.classList.toggle("on", !!(e.view && e.view !== "off"));
    }
    root.addEventListener("bs:state", ev => { state = ev.detail || state; render(); });
    render();
  });
})();
