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
  .pm-video.pm-deck-b{z-index:20;transition:opacity .25s,visibility .6s}
  .pm-video.pm-deck-b.audio{left:2px}
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

    // ── two YouTube decks, mixed like a DJ mixer ──
    // Each deck has its own player. Sound: master × channel fader × crossfader
    // curve (× a duck while that deck is being scratched). Picture (video
    // mode): deck B's layer sits over deck A and fades with the crossfader,
    // so a video mix crossfades on the wall too.
    const chip = document.createElement("div"); chip.className = "pm-chip";
    const soundAsk = document.createElement("div"); soundAsk.className = "pm-sound";
    soundAsk.innerHTML = "<div>🔊 Click anywhere to start the sound<small>Browsers only play sound after someone clicks the screen once.</small></div>";
    document.body.append(chip, soundAsk);
    let apiAsked = false, apiReady = false, skew = 0, askTimer = null, skewFrom = null;
    const fx = window.KKDJ ? window.KKDJ.engine() : null;
    function api() {
      if (apiAsked) return; apiAsked = true;
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev && prev(); apiReady = true; decks.a.make(); decks.b.make(); };
      const s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; s.async = true;
      document.head.appendChild(s);
    }
    const deckOf = (m, id) => (id === "a" ? m : (m.b || {}));
    function gains(m) {
      const mix = m.mix || {}, xf = +mix.xf || 0, cut = mix.curve === "cut";
      const cA = cut ? (xf > 0.92 ? 0 : 1) : Math.max(0, Math.min(1, 1 - xf));
      const cB = cut ? (xf < -0.92 ? 0 : 1) : Math.max(0, Math.min(1, 1 + xf));
      const master = (m.volume ?? 80) / 100;
      return { a: master * (mix.a ?? 100) / 100 * cA, b: master * (mix.b ?? 100) / 100 * cB, va: cA, vb: cB };
    }
    function post(body) {
      return fetch(base + "media/", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() }, body: JSON.stringify(body) })
        .then(r => r.json()).then(d => d && d.state && apply(d.state)).catch(() => {});
    }
    function Deck(id) {
      const wrap = document.createElement("div"); wrap.className = `pm-video pm-deck-${id}`;
      wrap.innerHTML = `<div id="pm-yt-${id}"></div>`;
      document.body.appendChild(wrap);
      const self = { id, wrap, yt: null, ready: false, loadedKey: null, seekRev: null, duck: 1, duckTimer: null, fadeTimer: null, durKey: null, gain: 0 };
      self.make = () => {
        self.yt = new YT.Player(`pm-yt-${id}`, {
          width: "100%", height: "100%",
          playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, disablekb: 1, fs: 0 },
          events: {
            onReady: () => { self.ready = true; sync(true); },
            onStateChange: e => {
              const d = deckOf(state.media || {}, id), cur = d.current;
              if (e.data === 0 && cur) post({ action: "ended", deck: id, key: cur.key });   // the server moves on
              if (e.data === 1) {
                soundAsk.classList.remove("on");
                // tell the booth how long the track is (once): remaining time + needle search
                if (cur && !cur.duration && self.durKey !== cur.key && self.yt.getDuration) {
                  const dur = self.yt.getDuration();
                  if (dur > 0) { self.durKey = cur.key; post({ action: "duration", deck: id, key: cur.key, duration: dur }); }
                }
              }
            },
          },
        });
      };
      self.setVol = () => { if (self.ready) self.yt.setVolume(Math.round(100 * self.gain * self.duck)); };
      self.setDuck = (x, ms) => {
        self.duck = x; clearTimeout(self.duckTimer); clearInterval(self.fadeTimer); self.setVol();
        if (ms) self.duckTimer = setTimeout(() => self.setDuck(1), ms);
      };
      self.fadeOut = ms => {             // the brake: this deck sinks away while its platter stops
        clearInterval(self.fadeTimer);
        const t0 = Date.now();
        self.fadeTimer = setInterval(() => {
          const p = Math.min(1, (Date.now() - t0) / ms);
          self.duck = 1 - p; self.setVol();
          if (p >= 1) { clearInterval(self.fadeTimer); self.duckTimer = setTimeout(() => self.setDuck(1), 1500); }
        }, 50);
      };
      self.sync = (m, force, g, vis) => {
        const d = deckOf(m, id), cur = d.current, yt = self.yt;
        self.gain = g;
        const showVideo = !!(cur && m.mode === "video");
        wrap.classList.toggle("on", showVideo && vis > 0.001);
        wrap.classList.toggle("audio", !!(cur && m.mode !== "video"));
        wrap.style.opacity = showVideo ? String(vis) : "";
        if (!cur) { self.loadedKey = null; if (self.ready) yt.stopVideo(); return; }
        if (!self.ready) { api(); return; }
        self.setVol();
        if (yt.setPlaybackRate && yt.getPlaybackRate && Math.abs(yt.getPlaybackRate() - (+d.rate || 1)) > 0.001) yt.setPlaybackRate(+d.rate || 1);
        const jumped = d.seek_rev != null && d.seek_rev !== self.seekRev;   // a scratch release, cue, needle search…
        self.seekRev = d.seek_rev;
        const pos = wantPos(d);
        if (cur.key !== self.loadedKey) {
          self.loadedKey = cur.key;
          if (d.playing) yt.loadVideoById({ videoId: cur.id, startSeconds: pos }); else yt.cueVideoById({ videoId: cur.id, startSeconds: pos });
        } else {
          const st = yt.getPlayerState ? yt.getPlayerState() : -1;
          if (d.playing && st !== 1 && st !== 3) yt.playVideo();
          if (!d.playing && st === 1) yt.pauseVideo();
          const t = yt.getCurrentTime ? yt.getCurrentTime() : 0;
          if (jumped && !force) yt.seekTo(pos, true);
          else if (d.playing && st === 1 && (force || Math.abs(t - pos) > 4)) yt.seekTo(pos, true);
          else if (!d.playing && jumped) yt.seekTo(pos, true);
        }
      };
      return self;
    }
    const decks = { a: Deck("a"), b: Deck("b") };
    function wantPos(d) {
      if (!d.playing) return d.position || 0;
      return (d.position || 0) + Math.max(0, (Date.now() + skew - (d.started_at || 0)) / 1000) * (+d.rate || 1);
    }
    function sync(force) {
      const m = state.media || {};
      // The server's clock vs this projector's: measured ONCE per update, when it arrives.
      // (Re-measuring on every check against the same old server timestamp froze the target
      // position, so the player kept jumping back a few seconds — a short loop.)
      if (m.server_now && m.server_now !== skewFrom) { skewFrom = m.server_now; skew = m.server_now - Date.now(); }
      const g = gains(m), A = m.current, B = (m.b || {}).current;
      // picture: A underneath at full, B on top fading in with the crossfader
      const visB = !B ? 0 : !A ? 1 : (g.vb + g.va ? g.vb / (g.va + g.vb) : 0);
      decks.a.sync(m, force, g.a, A ? 1 : 0);
      decks.b.sync(m, force, g.b, visB);
      const showVideo = !!((A || B) && m.mode === "video");
      document.body.classList.toggle("pm-on", showVideo);
      // the "Now playing" chip follows whichever deck the room hears most
      const onB = B && (m.b.playing && (!A || !m.playing || g.b > g.a));
      const air = onB ? m.b : m, cur = air.current;
      if (cur && m.chip && m.mode !== "video") {
        chip.innerHTML = `<div class="pm-eq"><i></i><i></i><i></i></div><img src="${thumb(cur.id)}" alt=""><div style="min-width:0"><small>${air.playing ? "Now playing" : "Paused"}</small><span>${esc(cur.title)}</span></div>`;
        chip.classList.add("on"); chip.classList.toggle("paused", !air.playing);
      } else chip.classList.remove("on");
      if (!A && !B) { soundAsk.classList.remove("on"); return; }
      if (!apiReady) { api(); return; }
      // sound blocked until someone clicks the projector page once
      clearTimeout(askTimer);
      if (m.playing || (m.b || {}).playing) askTimer = setTimeout(() => {
        const stuck = ["a", "b"].some(id => {
          const d = deckOf(state.media || {}, id), dk = decks[id];
          if (!d.playing || !dk.ready) return false;
          const st = dk.yt.getPlayerState ? dk.yt.getPlayerState() : -1;
          return st !== 1 && st !== 3;
        });
        if (stuck) soundAsk.classList.add("on");
      }, 2500);
    }
    soundAsk.addEventListener("click", () => {
      soundAsk.classList.remove("on"); fx && fx.unlock();
      Object.values(decks).forEach(d => { if (d.ready && deckOf(state.media || {}, d.id).playing) { d.yt.unMute(); d.yt.playVideo(); } });
    });
    document.addEventListener("pointerdown", () => fx && fx.unlock(), { passive: true });
    setInterval(() => { const m = state.media || {}; if (m.playing || (m.b || {}).playing) sync(false); }, 5000);

    // ── DJ booth effects (from the screen socket, never stored) ──
    document.addEventListener("scr:djfx", e => {
      const m = e.detail || {}, dk = decks[m.deck === "b" ? "b" : "a"];
      const loaded = !!deckOf(state.media || {}, dk.id).current;
      if (!loaded && m.kind !== "horn" && m.kind !== "siren") return;
      if (m.kind === "scratch_start") { dk.setDuck(0, 15000); chip.classList.add("scratch"); }   // hand on the platter
      else if (m.kind === "scratch_end") { setTimeout(() => dk.setDuck(1), 220); chip.classList.remove("scratch"); }
      else if (m.kind === "rewind") dk.setDuck(0, 1300);
      else if (m.kind === "brake") dk.fadeOut(1150);
      else if (m.kind === "horn") { decks.a.setDuck(0.55, 1100); decks.b.setDuck(0.55, 1100); }
      if (fx) fx.handle(m);
    });

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
  /* The DJ booth: two CDJ-style decks and a two-channel mixer.
       Deck 1 / Deck 2   LCD (BPM, tempo, elapsed / remaining, needle search
                         strip with cue marks), jog wheel (VINYL: grab to
                         scratch · CDJ: turn to search), CUE + PLAY/PAUSE,
                         hot cues A–D, tempo fader ±8/±16, TAP and SYNC
       Mixer             channel faders, crossfader (MIX / CUT curve),
                         master, level meters, FX pads, video / audio out
       Crate             paste a link → load on deck 1 or 2, or keep it in
                         the crate; deck 1 plays the crate on by itself
     Keys in the booth: Z / X cue / play deck 1 · N / M cue / play deck 2 ·
     1–4 and 7–0 hot cues · ← → crossfader · Q W E R pads.          */
  const RPM33 = 100 / 3, SEC_PER_REV = 60 / RPM33;
  const fmt = s => { s = Math.max(0, s || 0); const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`; };
  const fmtR = s => { s = Math.max(0, Math.round(s || 0)); return `-${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
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
  details.pg-fold{border-top:1px solid rgba(255,255,255,.09);padding:0}
  details.pg-fold>summary{padding:.75rem 1.2rem;gap:.9rem}
  details.pg-fold>summary::after{margin-right:.2rem}
  details.pg-fold>summary .ico{flex:none;width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:1.1rem;color:#67e8f9;background:rgba(34,211,238,.1)}
  details.pg-fold>summary .tx{display:flex;flex-direction:column;gap:.15rem;min-width:0}
  details.pg-fold>summary .tx small{font-size:.8rem}
  details.pg-fold .pg-e{padding:0 1.2rem 1rem}
  @keyframes djSpin{to{transform:rotate(360deg)}}

  dialog.dj{--d1:#22d3ee;--d2:#ff8a3d;--mono:"Spline Sans Mono",ui-monospace,monospace;
    width:min(1460px,98vw);max-height:96vh;padding:0;border:0;border-radius:24px;color:#eef0f6;overflow:auto;
    background:#08080c;box-shadow:0 40px 120px -20px rgba(0,0,0,.92),0 0 0 1px rgba(255,255,255,.08);font-family:"Inter",system-ui,sans-serif}
  dialog.dj::backdrop{background:rgba(2,2,6,.82);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px)}
  dialog.dj[open]{animation:djIn .3s cubic-bezier(.2,.9,.3,1.12) both}
  @keyframes djIn{from{opacity:0;transform:translateY(16px) scale(.98)}}
  .dj button{font-family:inherit}
  .dj button:focus-visible,.dj input:focus-visible,.dj [tabindex]:focus-visible{outline:2px solid #fff;outline-offset:2px}
  .dj-top{display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.85rem 1.2rem;border-bottom:1px solid rgba(255,255,255,.07);flex-wrap:wrap}
  .dj-top .k{font:600 .58rem/1 var(--mono);letter-spacing:.24em;text-transform:uppercase;color:#9a98ad}
  .dj-top h3{margin:.3rem 0 0;font:800 1.35rem/1 "Archivo",system-ui,sans-serif;letter-spacing:-.02em}
  .dj-tr{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap}
  .dj-ear,.dj-x{min-height:42px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#e2e8f0;cursor:pointer}
  .dj-ear{padding:0 .85rem;display:inline-flex;align-items:center;gap:.45rem;font-size:.8rem;font-weight:600}
  .dj-ear[aria-pressed="true"]{color:#04121a;background:#22d3ee;border-color:#22d3ee}
  .dj-x{width:42px;font-size:1rem}

  .desk{display:grid;grid-template-columns:minmax(0,1fr) 250px minmax(0,1fr);gap:.9rem;padding:1rem 1.2rem}
  /* ── a CDJ ── */
  .cdj{--c:var(--d1);border-radius:20px;padding:.9rem;display:flex;flex-direction:column;gap:.8rem;min-width:0;
    background:linear-gradient(180deg,#1c1c22,#121217);border:1px solid rgba(255,255,255,.07);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 18px 40px -20px rgba(0,0,0,.9)}
  .cdj[data-deck="b"]{--c:var(--d2)}
  .lcd{border-radius:12px;padding:.65rem .75rem;background:#05070a;border:1px solid #1a2028;box-shadow:inset 0 0 22px rgba(0,0,0,.8);display:flex;flex-direction:column;gap:.45rem;min-width:0}
  .lcd-r1{display:flex;align-items:center;gap:.55rem;min-width:0}
  .lcd-dk{flex:none;font:800 .62rem/1 var(--mono);letter-spacing:.14em;color:#05070a;background:var(--c);padding:.28rem .45rem;border-radius:5px}
  .lcd-st{flex:none;font:700 .6rem/1 var(--mono);letter-spacing:.16em;color:#64748b}
  .cdj.playing .lcd-st{color:#4ade80}
  .lcd-t{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:700;font-size:.86rem;color:#e5e7eb}
  .lcd-r2{display:flex;align-items:flex-end;justify-content:space-between;gap:.6rem;flex-wrap:wrap}
  .lcd-time{font:700 1.7rem/1 var(--mono);color:var(--c);text-shadow:0 0 10px color-mix(in srgb,var(--c) 50%,transparent)}
  .lcd-time small{font-size:.8rem;margin-left:.45rem;color:#94a3b8;text-shadow:none}
  .lcd-bpm{text-align:right;font:700 1.25rem/1 var(--mono);color:#f8fafc}
  .lcd-bpm small{display:block;margin-top:.25rem;font-size:.62rem;letter-spacing:.12em;color:#94a3b8}
  .needle{position:relative;height:26px;border-radius:6px;background:#0d1117;border:1px solid #1d2530;cursor:pointer;overflow:hidden;touch-action:none}
  .needle.off{cursor:not-allowed}
  .needle i.fill{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,color-mix(in srgb,var(--c) 25%,transparent),color-mix(in srgb,var(--c) 55%,transparent))}
  .needle i.ph{position:absolute;top:0;bottom:0;width:2px;margin-left:-1px;background:#fff;box-shadow:0 0 6px #fff}
  .needle i.mk{position:absolute;top:0;width:2px;height:9px;margin-left:-1px}
  .needle i.cue{position:absolute;bottom:0;width:0;height:0;margin-left:-5px;border:5px solid transparent;border-bottom:7px solid #fbbf24}
  .needle span{position:absolute;inset:0;display:grid;place-items:center;font:600 .6rem/1 var(--mono);color:#475569;letter-spacing:.08em;pointer-events:none}
  .cdj-mid{display:grid;grid-template-columns:minmax(0,1fr) 64px;gap:.8rem;align-items:center}
  .jog{position:relative;width:min(100%,330px);aspect-ratio:1;margin:0 auto;touch-action:none;user-select:none;-webkit-user-select:none;border-radius:50%;cursor:grab}
  .jog.held{cursor:grabbing}
  .jog .ring{position:absolute;inset:0;border-radius:50%;
    background:repeating-conic-gradient(from 0deg,#2a2a31 0 2.5deg,#3a3a43 2.5deg 5deg);box-shadow:0 12px 30px rgba(0,0,0,.75),inset 0 0 0 2px #000,inset 0 2px 0 rgba(255,255,255,.08)}
  .jog .plate{position:absolute;inset:10%;border-radius:50%;will-change:transform;
    background:radial-gradient(circle,#2c2c34 0 30%,#1b1b21 31%,#131318 70%,#1e1e25 71%,#0f0f13 100%);box-shadow:inset 0 0 0 2px #050507}
  .jog .plate::after{content:"";position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 30deg,transparent 0 40deg,rgba(255,255,255,.08) 55deg,transparent 70deg 210deg,rgba(255,255,255,.05) 228deg,transparent 245deg)}
  .jog .art{position:absolute;inset:31%;border-radius:50%;background:#1f2937 center/cover no-repeat;border:2px solid #000;box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 55%,transparent)}
  .jog .dot{position:absolute;left:50%;top:13%;width:9px;height:9px;margin-left:-4.5px;border-radius:50%;background:var(--c);box-shadow:0 0 10px var(--c)}
  .jog .hub{position:absolute;inset:46%;border-radius:50%;background:radial-gradient(circle at 35% 30%,#f5f5f7,#8b8a93)}
  .jog-hint{text-align:center;font-size:.7rem;color:#77768a;margin-top:.55rem}
  .jog.held+.jog-hint{color:#fbbf24}
  .tempo{display:flex;flex-direction:column;align-items:center;gap:.4rem}
  .tempo .k,.mx .k{font:600 .52rem/1 var(--mono);letter-spacing:.18em;color:#8a889c;text-transform:uppercase}
  .tempo .m{font:700 .72rem/1 var(--mono);color:#6b6980}
  .vf{position:relative;width:40px;display:flex;justify-content:center}
  .vf::before{content:"";position:absolute;top:8px;bottom:8px;left:50%;width:6px;margin-left:-3px;border-radius:3px;background:#030305;box-shadow:inset 0 1px 2px #000}
  .tempo .vf{height:200px}
  .tempo .vf::after{content:"";position:absolute;top:50%;left:4px;right:4px;height:2px;margin-top:-1px;background:#22c55e;box-shadow:0 0 6px #22c55e}
  .vf input{-webkit-appearance:none;appearance:none;writing-mode:vertical-lr;width:40px;height:100%;block-size:40px;inline-size:100%;margin:0;background:transparent;position:relative;z-index:1;cursor:ns-resize}
  .vf input.up{direction:rtl}
  .dj input[type=range]::-webkit-slider-runnable-track{background:transparent}
  .dj input[type=range]::-moz-range-track{background:transparent}
  .dj input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:38px;height:22px;border-radius:5px;border:1px solid #000;
    background:linear-gradient(180deg,#ecebf0 0,#bdbcc5 44%,#2f2e37 45%,#2f2e37 55%,#bdbcc5 56%,#ecebf0 100%);box-shadow:0 3px 6px rgba(0,0,0,.6)}
  .dj input[type=range]::-moz-range-thumb{width:38px;height:22px;border-radius:5px;border:1px solid #000;
    background:linear-gradient(180deg,#ecebf0 0,#bdbcc5 44%,#2f2e37 45%,#2f2e37 55%,#bdbcc5 56%,#ecebf0 100%);box-shadow:0 3px 6px rgba(0,0,0,.6)}
  .tempo .pv{font:700 .72rem/1 var(--mono);color:#5eead4}
  .chip2{display:flex;gap:.2rem}
  .chip2 button,.sm{min-height:30px;padding:0 .4rem;border-radius:7px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#cbd5e1;font:600 .6rem/1 var(--mono);cursor:pointer}
  .chip2 button[aria-pressed="true"],.sm[aria-pressed="true"]{border-color:var(--c,#5eead4);color:var(--c,#5eead4)}
  .cdj-hot{display:grid;grid-template-columns:repeat(4,minmax(0,1fr)) auto auto;gap:.4rem}
  .hc{--k:#22d3ee;min-height:46px;border-radius:9px;border:1px solid rgba(0,0,0,.6);cursor:pointer;color:#f8fafc;text-align:left;padding:.35rem .45rem;
    background:linear-gradient(180deg,#24242c,#18181e);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 3px 0 #060609;display:flex;flex-direction:column;justify-content:space-between}
  .hc b{font:800 .82rem/1 "Archivo",system-ui,sans-serif}
  .hc small{font:600 .58rem/1 var(--mono);color:#7c7a90}
  .hc.set{background:linear-gradient(180deg,color-mix(in srgb,var(--k) 34%,#24242c),color-mix(in srgb,var(--k) 16%,#18181e));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--k) 70%,transparent),0 3px 0 #060609}
  .hc.set small{color:#f1f5f9}
  .hc:active,.hc.hit{transform:translateY(2px);box-shadow:0 1px 0 #060609,0 0 18px -4px var(--k)}
  .hc:disabled{opacity:.4;cursor:default}
  .tap,.sync{min-width:54px;min-height:46px;border-radius:9px;border:1px solid #000;cursor:pointer;color:#cbd5e1;font:800 .64rem/1 var(--mono);letter-spacing:.1em;
    background:linear-gradient(180deg,#2c2c35,#1d1d24);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 3px 0 #060609}
  .tap.hit,.sync.on{color:#05070a;background:var(--c);box-shadow:0 0 14px -2px var(--c)}
  .cdj-bot{display:flex;align-items:center;gap:.7rem;flex-wrap:wrap}
  .rb{width:72px;height:72px;border-radius:50%;border:2px solid #000;cursor:pointer;color:#e5e7eb;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.25rem;
    background:radial-gradient(circle at 50% 35%,#3a3a44,#1c1c22);box-shadow:inset 0 0 0 3px #111,inset 0 0 0 5px #3b3b44,0 5px 0 #050507,0 8px 16px rgba(0,0,0,.6);font:800 .6rem/1 var(--mono);letter-spacing:.12em;transition:transform .05s}
  .rb:active{transform:translateY(3px)}
  .rb i.bi{font-size:1.25rem}
  .rb.cue{box-shadow:inset 0 0 0 3px #111,inset 0 0 0 5px #6b4f12,0 5px 0 #050507,0 8px 16px rgba(0,0,0,.6);color:#fbbf24}
  .rb.cue.blink{animation:cueBlink 1s steps(2) infinite}
  @keyframes cueBlink{50%{box-shadow:inset 0 0 0 3px #111,inset 0 0 0 5px #fbbf24,0 5px 0 #050507,0 0 18px #fbbf24}}
  .rb.play{color:#4ade80;box-shadow:inset 0 0 0 3px #111,inset 0 0 0 5px #14532d,0 5px 0 #050507,0 8px 16px rgba(0,0,0,.6)}
  .cdj.playing .rb.play{box-shadow:inset 0 0 0 3px #111,inset 0 0 0 5px #4ade80,0 5px 0 #050507,0 0 20px -2px #4ade80}
  .cdj-bot .sp{flex:1}
  .nb{min-width:46px;min-height:44px;border-radius:9px;border:1px solid #000;cursor:pointer;color:#cbd5e1;font:700 .72rem/1 var(--mono);
    background:linear-gradient(180deg,#2c2c35,#1d1d24);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 3px 0 #060609}
  .nb[aria-pressed="true"]{color:var(--c);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 3px 0 #060609,inset 0 -3px 0 var(--c)}

  /* ── mixer ── */
  .mx{border-radius:20px;padding:.9rem .8rem;display:flex;flex-direction:column;gap:.85rem;background:linear-gradient(180deg,#19191f,#101014);border:1px solid rgba(255,255,255,.07);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.06)}
  .mx h4{margin:0;text-align:center;font:800 .7rem/1 var(--mono);letter-spacing:.3em;color:#cbd5e1}
  .mx-ch{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.5rem}
  .strip{display:flex;flex-direction:column;align-items:center;gap:.4rem}
  .strip .lbl{font:800 .62rem/1 var(--mono);letter-spacing:.1em;color:var(--c)}
  .strip[data-ch="a"]{--c:var(--d1)}.strip[data-ch="b"]{--c:var(--d2)}
  .strip .row{display:flex;gap:.35rem;align-items:stretch;height:170px}
  .meter{width:10px;display:flex;flex-direction:column-reverse;gap:2px;padding:2px;border-radius:4px;background:#030305}
  .meter i{flex:1;border-radius:1px;background:#14251a}
  .meter i.on{background:#22c55e}.meter i.on.hi{background:#facc15}.meter i.on.pk{background:#ef4444}
  .strip .vf{height:100%}
  .xf{display:flex;flex-direction:column;gap:.35rem}
  .xf .ends{display:flex;justify-content:space-between;font:800 .62rem/1 var(--mono)}
  .xf .ends b:first-child{color:var(--d1)}.xf .ends b:last-child{color:var(--d2)}
  .xf .trk{position:relative;height:40px}
  .xf .trk::before{content:"";position:absolute;left:6px;right:6px;top:50%;height:6px;margin-top:-3px;border-radius:3px;background:#030305;box-shadow:inset 0 1px 2px #000}
  .xf .trk::after{content:"";position:absolute;left:50%;top:6px;bottom:6px;width:2px;margin-left:-1px;background:#3f3f46}
  .xf input{-webkit-appearance:none;appearance:none;position:absolute;inset:0;width:100%;height:40px;margin:0;background:transparent;cursor:ew-resize;z-index:1}
  .xf input::-webkit-slider-thumb{width:26px !important;height:36px !important}
  .xf input::-moz-range-thumb{width:26px !important;height:36px !important}
  .mx .line{display:flex;align-items:center;justify-content:space-between;gap:.4rem}
  .mx .master{display:flex;align-items:center;gap:.5rem}
  .mx .master input{flex:1;accent-color:#e5e7eb}
  .mx-fx{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.4rem}
  .fx{--k:#f5a524;min-height:52px;border-radius:10px;border:1px solid rgba(0,0,0,.6);cursor:pointer;color:#f8fafc;display:flex;flex-direction:column;align-items:flex-start;justify-content:space-between;
    padding:.4rem .5rem;text-align:left;background:linear-gradient(180deg,#24242c,#18181e);box-shadow:inset 0 1px 0 rgba(255,255,255,.07),0 3px 0 #060609;font:700 .74rem/1 inherit}
  .fx i.bi{color:var(--k)}
  .fx small{font:600 .52rem/1 var(--mono);color:#6b6980}
  .fx:active,.fx.hit{transform:translateY(2px);box-shadow:0 1px 0 #060609,0 0 20px -4px var(--k),inset 0 0 0 2px var(--k)}
  .seg{display:flex;padding:3px;border-radius:9px;background:#030305;gap:3px}
  .seg button{flex:1;min-height:32px;border:0;border-radius:7px;background:none;color:#94a3b8;font:700 .6rem/1 var(--mono);letter-spacing:.08em;cursor:pointer}
  .seg button[aria-pressed="true"]{background:#e5e7eb;color:#0b0b0f}

  /* ── crate ── */
  .crate{margin:0 1.2rem 1.2rem;border-radius:18px;padding:.9rem 1rem;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07)}
  .crate h4{margin:0 0 .6rem;display:flex;justify-content:space-between;gap:.5rem;font:700 .6rem/1 var(--mono);letter-spacing:.2em;text-transform:uppercase;color:#a9a6c2;flex-wrap:wrap}
  .crate h4 small{letter-spacing:0;text-transform:none;font-family:inherit;color:#77738f}
  .crate .in{display:flex;gap:.45rem;flex-wrap:wrap}
  .crate input[type=url]{flex:1 1 300px;min-width:0;min-height:44px;border-radius:11px;padding:0 .8rem;border:1px solid rgba(255,255,255,.16);background:#05050a;color:#f1f5f9;font:inherit}
  .crate .ld{min-height:44px;padding:0 .9rem;border-radius:11px;border:0;cursor:pointer;font:800 .74rem/1 var(--mono);letter-spacing:.06em;color:#05070a}
  .crate .ld.a{background:var(--d1)}.crate .ld.b{background:var(--d2)}
  .crate .ld.q{background:rgba(255,255,255,.08);color:#e5e7eb;border:1px solid rgba(255,255,255,.14)}
  .crate ul{list-style:none;margin:.7rem 0 0;padding:0;display:flex;flex-direction:column;gap:.35rem}
  .crate li{display:grid;grid-template-columns:72px minmax(0,1fr) auto;gap:.6rem;align-items:center;padding:.35rem;border-radius:11px;background:rgba(255,255,255,.03)}
  .crate li img{width:72px;aspect-ratio:16/9;object-fit:cover;border-radius:7px;background:#111}
  .crate li span{font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .crate li .b2{display:flex;gap:.3rem}
  .crate li button{min-width:40px;min-height:36px;border-radius:9px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#e5e7eb;cursor:pointer;font:800 .68rem/1 var(--mono)}
  .crate li button.a{color:var(--d1)}.crate li button.b{color:var(--d2)}
  .crate .empty{padding:.9rem;border-radius:11px;border:1px dashed rgba(255,255,255,.14);color:#8a889c;font-size:.82rem;text-align:center;margin-top:.7rem}
  .crate .opts{display:flex;gap:1rem;flex-wrap:wrap;margin-top:.7rem;font-size:.78rem;color:#a9a6c2}
  .crate .opts label{display:inline-flex;gap:.4rem;align-items:center;cursor:pointer}
  .dj-toast{position:sticky;bottom:1rem;margin:0 auto;width:max-content;max-width:90%;padding:.55rem .9rem;border-radius:999px;background:#fbbf24;color:#1c1300;
    font-weight:700;font-size:.82rem;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;pointer-events:none}
  .dj-toast.on{opacity:1;transform:none}
  @media (max-width:1150px){
    .desk{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
    .mx{grid-column:1/-1;order:3;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));align-items:start}
    .mx h4{grid-column:1/-1}
  }
  @media (max-width:760px){
    .desk{grid-template-columns:1fr}
    .cdj-mid{grid-template-columns:minmax(0,1fr) 56px}
    .cdj-hot{grid-template-columns:repeat(4,minmax(0,1fr))}
    .cdj-hot .tap,.cdj-hot .sync{grid-column:span 2}
  }
  @media (prefers-reduced-motion:reduce){.dj-row .ico i,.rb.cue.blink{animation:none!important}}`;
  document.head.appendChild(djCss);

  const HC = ["#22d3ee", "#a78bfa", "#f5a524", "#fb7185"];
  const FX = [["horn", "Air horn", "bi-megaphone-fill", "Q", "#f5a524"], ["siren", "Siren", "bi-bell-fill", "W", "#fb7185"],
              ["rewind", "Rewind", "bi-rewind-fill", "E", "#22d3ee"], ["brake", "Brake", "bi-stop-circle-fill", "R", "#a78bfa"]];
  const deckHtml = (id, n) => `<section class="cdj" data-deck="${id}" aria-label="Deck ${n}">
      <div class="lcd">
        <div class="lcd-r1"><span class="lcd-dk">DECK ${n}</span><span class="lcd-st" data-st>EMPTY</span><span class="lcd-t" data-t>Load a track from the crate</span></div>
        <div class="lcd-r2"><span class="lcd-time"><span data-time>0:00.0</span><small data-rem></small></span>
          <span class="lcd-bpm"><span data-bpm>---.-</span><small data-tmp>BPM · 0.0 %</small></span></div>
        <div class="needle off" data-needle role="slider" tabindex="0" aria-label="Deck ${n} needle search"><i class="fill"></i><span data-ns>NEEDLE SEARCH</span><i class="ph"></i></div>
      </div>
      <div class="cdj-hot">
        ${[0, 1, 2, 3].map(i => `<button type="button" class="hc" data-hc="${i}" style="--k:${HC[i]}"><b>${"ABCD"[i]}</b><small>set</small></button>`).join("")}
        <button type="button" class="tap" data-tap title="Tap along with the beat">TAP</button>
        <button type="button" class="sync" data-sync title="Match this deck's BPM to the other deck">SYNC</button>
      </div>
      <div class="cdj-mid">
        <div><div class="jog" data-jog tabindex="0" role="slider" aria-label="Deck ${n} jog wheel" aria-valuetext="0:00">
          <div class="ring"></div><div class="plate" data-plate><div class="art" data-art></div><div class="dot"></div></div><div class="hub"></div></div>
          <div class="jog-hint" data-hint>Grab to scratch</div></div>
        <div class="tempo"><span class="k">Tempo</span><span class="m">−</span>
          <div class="vf"><input type="range" min="-8" max="8" step="0.1" value="0" data-tempo aria-label="Deck ${n} tempo"></div>
          <span class="m">+</span><span class="pv" data-pv>0.0%</span>
          <div class="chip2"><button type="button" data-range="8" aria-pressed="true">±8</button><button type="button" data-range="16" aria-pressed="false">±16</button><button type="button" data-range="50" aria-pressed="false" title="Wide: ±50 %">W</button></div>
          <button type="button" class="sm" data-t0>RESET</button></div>
      </div>
      <div class="cdj-bot">
        <button type="button" class="rb cue" data-cue title="CUE: paused → set the cue here · playing → back to the cue"><span>CUE</span></button>
        <button type="button" class="rb play" data-play title="Play / pause"><i class="bi bi-play-pause-fill"></i><span>▶ ‖</span></button>
        <span class="sp"></span>
        <button type="button" class="nb" data-nudge="-5" aria-label="Back 5 seconds">◀◀</button>
        <button type="button" class="nb" data-nudge="5" aria-label="Forward 5 seconds">▶▶</button>
        <button type="button" class="nb" data-vinyl aria-pressed="true" title="VINYL: grab the jog to scratch · off: turn it to search">VINYL</button>
      </div>
    </section>`;

  document.querySelectorAll("[data-screen]").forEach(root => {
    const base = `/screenart/s/${root.dataset.token}/`;
    let state = {};
    try { state = JSON.parse(root.querySelector("[data-state]").textContent || "{}"); } catch (_) { /* ignore */ }
    const box = document.createElement("div");
    box.innerHTML = `<div class="dj-row" data-pg="media">
        <span class="ico" aria-hidden="true"><i class="bi bi-vinyl-fill"></i></span>
        <span class="tx"><b>Music &amp; video</b><small class="pg-sum-m"></small></span>
        <span class="acts"><button type="button" class="go" data-dj-open><i class="bi bi-disc"></i> Open DJ booth</button></span></div>
      <details class="pg-fold" data-pg="event"><summary><span class="ico" aria-hidden="true"><i class="bi bi-clipboard-check"></i></span>
        <span class="tx"><b>Event</b><small class="pg-sum-e"></small></span></summary><div class="pg-e"></div></details>`;
    const slot = root.querySelector("[data-addons]"), link = root.querySelector(".bs-link");
    if (slot) slot.appendChild(box);
    else if (link) link.parentNode.insertBefore(box, link); else root.appendChild(box);

    const dj = document.createElement("dialog");
    dj.className = "dj";
    dj.setAttribute("aria-label", "DJ booth");
    dj.innerHTML = `<div class="dj-top"><div><div class="k">DJ booth · 2 decks + mixer · plays on the projector</div><h3 class="dj-name"></h3></div>
        <div class="dj-tr"><button type="button" class="dj-ear" data-ear aria-pressed="false" title="Play the scratches and pads on this device too"><i class="bi bi-headphones"></i> Hear FX here</button>
          <button type="button" class="dj-x" data-dj-close aria-label="Close the DJ booth">✕</button></div></div>
      <div class="desk">
        ${deckHtml("a", 1)}
        <section class="mx" aria-label="Mixer"><h4>MIXER</h4>
          <div class="mx-ch">
            ${["a", "b"].map((c, i) => `<div class="strip" data-ch="${c}"><span class="lbl">CH ${i + 1}</span>
              <div class="row"><div class="meter" data-meter aria-hidden="true">${"<i></i>".repeat(14)}</div>
                <div class="vf"><input class="up" type="range" min="0" max="100" step="1" value="100" data-chf aria-label="Channel ${i + 1} fader"></div></div></div>`).join("")}
          </div>
          <div class="xf"><div class="line"><span class="k">Crossfader</span>
              <div class="chip2" style="--c:#e5e7eb"><button type="button" data-curve="mix" aria-pressed="true">MIX</button><button type="button" data-curve="cut" aria-pressed="false">CUT</button></div></div>
            <div class="ends"><b>1</b><b>2</b></div>
            <div class="trk"><input type="range" min="-1" max="1" step="0.01" value="0" data-xf aria-label="Crossfader"></div></div>
          <div><span class="k">Master</span><div class="master"><i class="bi bi-volume-up" aria-hidden="true"></i><input type="range" min="0" max="100" step="1" data-master aria-label="Master volume"></div></div>
          <div><span class="k">Output</span><div class="seg" role="group" aria-label="Output"><button type="button" data-mode="audio" aria-pressed="true">AUDIO</button><button type="button" data-mode="video" aria-pressed="false">VIDEO</button></div></div>
          <div><span class="k">FX · on-air deck</span><div class="mx-fx" style="margin-top:.4rem">
            ${FX.map(([k, l, ic, key, c]) => `<button type="button" class="fx" data-fx="${k}" style="--k:${c}"><i class="bi ${ic}"></i>${l}<small>${key}</small></button>`).join("")}</div></div>
        </section>
        ${deckHtml("b", 2)}
      </div>
      <div class="crate"><h4>Crate <small>deck 1 plays the crate on by itself when a track ends</small></h4>
        <div class="in"><input type="url" data-url placeholder="Paste a YouTube link — a track, a mix, a showreel…" aria-label="YouTube link">
          <button type="button" class="ld a" data-load="a">LOAD ▸ 1</button><button type="button" class="ld b" data-load="b">LOAD ▸ 2</button>
          <button type="button" class="ld q" data-load="q">+ CRATE</button></div>
        <ul data-crate></ul>
        <div class="opts"><label><input type="checkbox" data-loop> Loop</label><label><input type="checkbox" data-chipopt> “Now playing” strip on screen</label></div>
      </div>
      <div class="dj-toast" data-toast></div>`;
    document.body.appendChild(dj);

    // ProgramUI still runs the Event fold; the booth below runs the music itself
    const ui = ProgramUI(document.createElement("div"), box.querySelector(".pg-e"), base, s => { state = s; render(); }, {});
    const evFold = box.querySelector('[data-pg="event"]');
    evFold.addEventListener("toggle", e => { if (e.target.open) ui.loadEvents(); });

    const $ = sel => dj.querySelector(sel);
    const fx = window.KKDJ ? window.KKDJ.engine() : null;
    let ear = false, skew = 0, skewFrom = null, toastT = null;
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
    const M = () => state.media || {};
    const deckState = id => (id === "a" ? M() : (M().b || {}));
    function posOf(d) {
      if (!d.current) return 0;
      if (!d.playing) return d.position || 0;
      return (d.position || 0) + Math.max(0, (Date.now() + skew - (d.started_at || 0)) / 1000) * (+d.rate || 1);
    }
    function gains() {
      const mix = M().mix || {}, xf = +mix.xf || 0, cut = mix.curve === "cut";
      const cA = cut ? (xf > 0.92 ? 0 : 1) : Math.max(0, Math.min(1, 1 - xf));
      const cB = cut ? (xf < -0.92 ? 0 : 1) : Math.max(0, Math.min(1, 1 + xf));
      return { a: (mix.a ?? 100) / 100 * cA, b: (mix.b ?? 100) / 100 * cB };
    }
    function onAir() {                         // the deck the room hears most
      const a = deckState("a"), b = deckState("b"), g = gains();
      const la = a.current && a.playing ? g.a : -1, lb = b.current && b.playing ? g.b : -1;
      if (la < 0 && lb < 0) return a.current ? "a" : (b.current ? "b" : null);
      return lb > la ? "b" : "a";
    }
    // a slider that sends at most every 150 ms while dragged, and always its last value
    function throttled(el, send) {
      let t = 0, timer = null;
      el._touched = 0;
      const go = () => { t = Date.now(); send(+el.value); };
      el.addEventListener("input", () => {
        el._touched = Date.now();
        clearTimeout(timer);
        if (Date.now() - t > 150) go(); else timer = setTimeout(go, 150);
      });
    }
    const touched = el => Date.now() - (el._touched || 0) < 1200;

    /* ── one CDJ ── */
    function Deck(id) {
      const el = dj.querySelector(`.cdj[data-deck="${id}"]`), q = s => el.querySelector(s);
      const n = id === "a" ? 1 : 2;
      const jog = q("[data-jog]"), plate = q("[data-plate]"), needle = q("[data-needle]");
      const self = { id, el, angle: 0, motor: 0, held: null, vinyl: true, range: 8, base: 1, taps: [], tapTimer: null };
      const d = () => deckState(id), cur = () => d().current || null;
      const need = () => { if (cur()) return true; toast(`Load a track on deck ${n} first`); return false; };
      const send = body => media(Object.assign({ deck: id }, body));
      const sendFx = (kind, extra) => post("dj/fx/", Object.assign({ kind, deck: id }, extra || {}));
      self.pos = () => posOf(d());
      // transport
      self.play = () => { if (need()) send({ action: d().playing ? "pause" : "play" }); };
      self.cue = () => { if (!need()) return; if (d().playing) send({ action: "cue_return" }); else send({ action: "cue_main", position: self.pos() }); };
      q("[data-play]").addEventListener("click", self.play);
      q("[data-cue]").addEventListener("click", self.cue);
      el.querySelectorAll("[data-nudge]").forEach(b => b.addEventListener("click", () => { if (need()) send({ action: "seek", position: Math.max(0, self.pos() + +b.dataset.nudge) }); }));
      q("[data-vinyl]").addEventListener("click", e => {
        self.vinyl = !self.vinyl; e.currentTarget.setAttribute("aria-pressed", String(self.vinyl));
        q("[data-hint]").textContent = self.vinyl ? "Grab to scratch" : "Turn to search";
      });
      // hot cues: tap set · tap jump · hold (or right-click) clear
      self.hot = (i, clear) => {
        if (!need()) return;
        const v = (cur().cues || [])[i];
        if (clear) { if (v != null) { send({ action: "cue_clear", slot: i }); toast(`Deck ${n}: cue ${"ABCD"[i]} cleared`); } return; }
        const b = q(`[data-hc="${i}"]`); b.classList.add("hit"); setTimeout(() => b.classList.remove("hit"), 160);
        if (v == null) send({ action: "cue_set", slot: i, position: self.pos() }); else send({ action: "seek", position: v });
      };
      el.querySelectorAll("[data-hc]").forEach(b => {
        let t = null, long = false;
        b.addEventListener("pointerdown", () => { long = false; t = setTimeout(() => { long = true; self.hot(+b.dataset.hc, true); }, 600); });
        ["pointerup", "pointerleave", "pointercancel"].forEach(ev => b.addEventListener(ev, () => clearTimeout(t)));
        b.addEventListener("click", e => { e.preventDefault(); if (!long) self.hot(+b.dataset.hc, false); });
        b.addEventListener("contextmenu", e => { e.preventDefault(); self.hot(+b.dataset.hc, true); });
      });
      // tempo
      const tempo = q("[data-tempo]");
      const rateFrom = () => Math.round(self.base * (1 + (+tempo.value || 0) / 100) * 1000) / 1000;
      throttled(tempo, () => { if (cur()) send({ action: "rate", rate: rateFrom() }); });
      tempo.addEventListener("input", () => self.showTempo(rateFrom()));
      tempo.addEventListener("dblclick", () => { tempo.value = 0; tempo._touched = Date.now(); send({ action: "rate", rate: self.base }); });
      q("[data-t0]").addEventListener("click", () => { tempo.value = 0; tempo._touched = Date.now(); self.base = 1; send({ action: "rate", rate: 1 }); });
      el.querySelectorAll("[data-range]").forEach(b => b.addEventListener("click", () => {
        self.range = +b.dataset.range; tempo.min = -self.range; tempo.max = self.range;
        el.querySelectorAll("[data-range]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      }));
      self.showTempo = rate => {
        const pct = (rate - 1) * 100, bpm = (cur() && cur().bpm) ? cur().bpm * rate : null;
        q("[data-pv]").textContent = `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
        q("[data-bpm]").textContent = self.tapBpm ? self.tapBpm.toFixed(1) : bpm ? bpm.toFixed(1) : "---.-";
        q("[data-tmp]").textContent = `BPM · ${pct >= 0 ? "+" : ""}${pct.toFixed(1)} %`;
      };
      // TAP tempo → the track's own BPM (what you tap ÷ the current rate)
      q("[data-tap]").addEventListener("click", e => {
        if (!need()) return;
        const now = performance.now(), b = e.currentTarget;
        b.classList.add("hit"); setTimeout(() => b.classList.remove("hit"), 90);
        if (self.taps.length && now - self.taps[self.taps.length - 1] > 2000) self.taps = [];
        self.taps.push(now); self.taps = self.taps.slice(-9);
        if (self.taps.length >= 4) {
          const iv = []; for (let i = 1; i < self.taps.length; i++) iv.push(self.taps[i] - self.taps[i - 1]);
          self.tapBpm = 60000 / (iv.reduce((x, y) => x + y, 0) / iv.length);
          self.showTempo(+d().rate || 1);
          clearTimeout(self.tapTimer);
          self.tapTimer = setTimeout(() => { send({ action: "bpm", bpm: self.tapBpm / (+d().rate || 1) }); self.tapBpm = null; }, 1600);
        } else q("[data-bpm]").textContent = `TAP ${self.taps.length}`;
      });
      q("[data-sync]").addEventListener("click", async e => {
        if (!need()) return;
        const b = e.currentTarget, r = await send({ action: "sync" });
        if (r) { b.classList.add("on"); setTimeout(() => b.classList.remove("on"), 900); toast(`Deck ${n} synced to deck ${3 - n}`); }
      });
      // needle search: tap or drag along the strip
      let nsDrag = false;
      const nsAt = e => { const r = needle.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
      needle.addEventListener("pointerdown", e => {
        const c = cur(); if (!c || !c.duration) { if (c) toast("Track length shows once it has played on the projector"); else need(); return; }
        nsDrag = true; needle.setPointerCapture(e.pointerId); self.nsPreview = nsAt(e) * c.duration;
      });
      needle.addEventListener("pointermove", e => { if (nsDrag && cur()) self.nsPreview = nsAt(e) * cur().duration; });
      const nsEnd = () => { if (!nsDrag) return; nsDrag = false; if (self.nsPreview != null) send({ action: "seek", position: self.nsPreview }); self.nsPreview = null; };
      needle.addEventListener("pointerup", nsEnd); needle.addEventListener("pointercancel", nsEnd);
      needle.addEventListener("keydown", e => {
        if (!cur() || !cur().duration) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); send({ action: "seek", position: Math.max(0, self.pos() + (e.key === "ArrowLeft" ? -10 : 10)) }); }
      });

      /* jog: VINYL → scratch (streams to the projector), CDJ → search */
      const angleAt = e => { const r = jog.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
      const flush = () => { const h = self.held; if (h && h.vinyl && h.samples.length) sendFx("scratch", { v: h.samples.splice(0, 64), dt: 30 }); };
      jog.addEventListener("pointerdown", e => {
        if (e.button !== 0) return;
        if (!need()) return;
        e.preventDefault(); jog.setPointerCapture(e.pointerId); fx && fx.unlock();
        const h = self.held = { lastA: angleAt(e), grabPos: self.pos(), revs: 0, acc: 0, samples: [], tick: 0, vinyl: self.vinyl };
        jog.classList.add("held");
        if (h.vinyl) {
          self.motor = 0;
          q("[data-hint]").textContent = "Scratching — let go to drop the needle";
          sendFx("scratch_start"); if (ear && fx) fx.scratchStart();
          h.timer = setInterval(() => {
            if (self.held !== h) return;
            const v = Math.round((h.acc / 360) / 0.03 / (RPM33 / 60) * 1000) / 1000;
            h.acc = 0; h.samples.push(v);
            if (ear && fx) fx.scratch([v], 30);
            if (++h.tick % 3 === 0) flush();
          }, 30);
        } else q("[data-hint]").textContent = "Searching — let go to jump";
      });
      jog.addEventListener("pointermove", e => {
        const h = self.held; if (!h) return;
        const a = angleAt(e);
        let dlt = a - h.lastA; if (dlt > 180) dlt -= 360; if (dlt < -180) dlt += 360;
        h.lastA = a; self.angle += dlt; h.revs += dlt / 360; h.acc += dlt;
      });
      self.release = () => {
        const h = self.held; if (!h) return;
        clearInterval(h.timer); self.held = null; jog.classList.remove("held");
        q("[data-hint]").textContent = self.vinyl ? "Grab to scratch" : "Turn to search";
        const to = Math.max(0, h.grabPos + h.revs * SEC_PER_REV * (h.vinyl ? 1 : 2));
        if (h.vinyl) { h.samples.push(0); flush(); if (ear && fx) fx.scratchEnd(); sendFx("scratch_end", { position: to }); }
        send({ action: "seek", position: to });
      };
      jog.addEventListener("pointerup", self.release);
      jog.addEventListener("pointercancel", self.release);
      jog.addEventListener("lostpointercapture", self.release);
      jog.addEventListener("keydown", e => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); if (need()) send({ action: "seek", position: Math.max(0, self.pos() + (e.key === "ArrowLeft" ? -2 : 2)) }); }
        else if (e.key === "Enter") { e.preventDefault(); self.play(); }
      });

      self.frame = dt => {
        const ds = d(), c = cur();
        if (!self.held) {
          const tgt = c && ds.playing ? (+ds.rate || 1) : 0;
          self.motor += (tgt - self.motor) * Math.min(1, dt * (tgt > self.motor ? 7 : 4));
          self.angle += self.motor * dt * 360 * RPM33 / 60;
        }
        plate.style.transform = `rotate(${self.angle}deg)`;
        const h = self.held;
        const p = h ? Math.max(0, h.grabPos + h.revs * SEC_PER_REV * (h.vinyl ? 1 : 2)) : (self.nsPreview != null ? self.nsPreview : self.pos());
        q("[data-time]").textContent = fmt(p);
        jog.setAttribute("aria-valuetext", fmt(p));
        const dur = c && c.duration;
        q("[data-rem]").textContent = dur ? fmtR(dur - p) : "";
        const f = dur ? Math.min(1, p / dur) : 0;
        needle.querySelector(".fill").style.width = `${f * 100}%`;
        needle.querySelector(".ph").style.left = `${f * 100}%`;
        const cueBtn = q("[data-cue]"), cueAt = c && (c.cue != null ? c.cue : c.start || 0);
        cueBtn.classList.toggle("blink", !!(c && !ds.playing && Math.abs(p - cueAt) > 0.15));
      };
      self.render = () => {
        const ds = d(), c = cur();
        el.classList.toggle("playing", !!(c && ds.playing));
        q("[data-st]").textContent = !c ? "EMPTY" : ds.playing ? "PLAYING" : "PAUSED";
        q("[data-t]").textContent = c ? c.title : "Load a track from the crate";
        q("[data-art]").style.backgroundImage = c ? `url("${thumb(c.id)}")` : "";
        const dur = c && c.duration;
        needle.classList.toggle("off", !dur);
        q("[data-ns]").textContent = !c ? "NEEDLE SEARCH" : dur ? "" : "LENGTH SHOWS ONCE PLAYING";
        // cue marks on the needle strip
        needle.querySelectorAll(".mk,.cue").forEach(x => x.remove());
        if (dur) {
          (c.cues || []).forEach((v, i) => { if (v != null) { const m = document.createElement("i"); m.className = "mk"; m.style.left = `${v / dur * 100}%`; m.style.background = HC[i]; needle.appendChild(m); } });
          if (c.cue != null) { const m = document.createElement("i"); m.className = "cue"; m.style.left = `${c.cue / dur * 100}%`; needle.appendChild(m); }
        }
        el.querySelectorAll("[data-hc]").forEach(b => {
          const i = +b.dataset.hc, v = c && (c.cues || [])[i];
          b.classList.toggle("set", v != null && v !== undefined);
          b.querySelector("small").textContent = v != null ? fmt(v) : "set";
          b.disabled = !c;
        });
        const rate = +ds.rate || 1;
        if (!touched(tempo)) {
          const pct = (rate - 1) * 100;
          if (Math.abs(pct) > self.range) {           // SYNC can land outside the fader: widen it
            self.range = Math.abs(pct) > 16 ? 50 : 16; tempo.min = -self.range; tempo.max = self.range;
            el.querySelectorAll("[data-range]").forEach(x => x.setAttribute("aria-pressed", String(+x.dataset.range === self.range))); }
          tempo.value = pct.toFixed(1);
        }
        self.showTempo(touched(tempo) ? rateFrom() : rate);
      };
      return self;
    }
    const decks = { a: Deck("a"), b: Deck("b") };

    /* ── mixer ── */
    const chf = { a: dj.querySelector('[data-ch="a"] [data-chf]'), b: dj.querySelector('[data-ch="b"] [data-chf]') };
    throttled(chf.a, v => media({ action: "mix", a: v }));
    throttled(chf.b, v => media({ action: "mix", b: v }));
    const xf = $("[data-xf]"), master = $("[data-master]");
    throttled(xf, v => media({ action: "mix", xf: v }));
    xf.addEventListener("dblclick", () => { xf.value = 0; xf._touched = Date.now(); media({ action: "mix", xf: 0 }); });
    throttled(master, v => media({ action: "volume", volume: v }));
    function pad(kind) {
      const air = onAir();
      if (kind !== "horn" && kind !== "siren") { if (!air) { toast("Nothing is playing"); return; } }
      fx && fx.unlock();
      post("dj/fx/", { kind, deck: air || "a" });
      if (ear && fx) fx[kind]();
      const p = dj.querySelector(`[data-fx="${kind}"]`); p.classList.add("hit"); setTimeout(() => p.classList.remove("hit"), 180);
      const dk = air && decks[air];
      if (kind === "rewind") {          // spin back to cue A (or 10 s), then carry on
        const c = deckState(air).current, a = (c.cues || [])[0], to = a != null && a < dk.pos() ? a : Math.max(0, dk.pos() - 10);
        dk.motor = -6; setTimeout(() => media({ action: "seek", deck: air, position: to }), 1000);
      } else if (kind === "brake") setTimeout(() => media({ action: "pause", deck: air }), 1150);
      if (air && kind !== "horn" && kind !== "siren") toast(`${kind === "brake" ? "Brake" : "Rewind"} on deck ${air === "a" ? 1 : 2}`);
    }

    /* ── crate ── */
    const url = $("[data-url]");
    async function load(where) {
      if (!url.value.trim()) { toast("Paste a YouTube link first"); url.focus(); return; }
      const body = where === "q" ? { action: "queue", url: url.value } : { action: "load", deck: where, url: url.value, autoplay: false };
      const r = await media(body);
      if (r) { url.value = ""; toast(where === "q" ? "Added to the crate" : `Loaded on deck ${where === "a" ? 1 : 2} — press ▶ ‖ to play`); }
    }
    url.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); load(e.shiftKey ? "b" : "a"); } });

    // one click handler for the booth's shared controls
    dj.addEventListener("click", e => {
      if (e.target === dj || e.target.closest("[data-dj-close]")) { closeDj(); return; }
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.load) load(b.dataset.load);
      else if (b.dataset.fx) pad(b.dataset.fx);
      else if (b.dataset.curve) media({ action: "mix", curve: b.dataset.curve });
      else if (b.dataset.mode) media({ action: "mode", mode: b.dataset.mode });
      else if (b.dataset.crate) {
        const [act, key] = [b.dataset.crate, b.dataset.key];
        if (act === "x") media({ action: "remove", key }); else media({ action: "load_queued", deck: act, key });
      } else if (b.hasAttribute("data-ear")) {
        ear = !ear; b.setAttribute("aria-pressed", String(ear));
        if (ear && fx) fx.unlock();
        if (ear && !(fx && fx.supported)) toast("This browser can't play the effects");
      }
    });
    $("[data-loop]").addEventListener("change", e => media({ action: "loop", loop: e.target.checked }));
    $("[data-chipopt]").addEventListener("change", e => media({ action: "chip", chip: e.target.checked }));
    dj.addEventListener("keydown", e => {
      if (e.target.matches("input[type=url],input[type=text],select,textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const map = { z: () => decks.a.cue(), x: () => decks.a.play(), n: () => decks.b.cue(), m: () => decks.b.play() };
      if (map[k]) { e.preventDefault(); map[k](); return; }
      if ("1234".includes(k) && k.length === 1) { e.preventDefault(); decks.a.hot(+k - 1, e.shiftKey); return; }
      const bi = ["7", "8", "9", "0"].indexOf(k);
      if (bi >= 0) { e.preventDefault(); decks.b.hot(bi, e.shiftKey); return; }
      const fi = "qwer".indexOf(k);
      if (fi >= 0 && k.length === 1) { e.preventDefault(); pad(FX[fi][0]); return; }
      if ((k === "arrowleft" || k === "arrowright") && !e.target.matches("input[type=range]")) {
        e.preventDefault();
        xf.value = Math.max(-1, Math.min(1, +xf.value + (k === "arrowleft" ? -0.1 : 0.1))).toFixed(2);
        xf.dispatchEvent(new Event("input"));
      }
    });

    /* ── animation: jogs, times, meters ── */
    let raf = 0, last = performance.now();
    const meters = { a: dj.querySelector('[data-ch="a"] [data-meter]'), b: dj.querySelector('[data-ch="b"] [data-meter]') };
    function frame(t) {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      decks.a.frame(dt); decks.b.frame(dt);
      const g = gains();
      ["a", "b"].forEach(id => {   // decorative level meters: post-fader, with a little life in them
        const ds = deckState(id), live = ds.current && ds.playing && !decks[id].held;
        const lvl = live ? g[id] * (0.62 + 0.3 * Math.abs(Math.sin(t / 180 + (id === "b" ? 1.7 : 0))) + Math.random() * 0.08) : 0;
        const on = Math.round(lvl * 14);
        meters[id].querySelectorAll("i").forEach((seg, i) => { seg.className = i < on ? (i >= 12 ? "on pk" : i >= 9 ? "on hi" : "on") : ""; });
      });
      raf = dj.open ? requestAnimationFrame(frame) : 0;
    }

    function openDj() {
      if (typeof dj.showModal === "function") { if (!dj.open) dj.showModal(); } else dj.setAttribute("open", "");
      last = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
      if (!M().current && !(M().b || {}).current) setTimeout(() => url.focus(), 60);
    }
    function closeDj() { decks.a.release(); decks.b.release(); if (typeof dj.close === "function") dj.close(); else dj.removeAttribute("open"); }
    dj.addEventListener("close", () => { decks.a.release(); decks.b.release(); });

    root.addEventListener("click", e => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-dj-open")) { e.preventDefault(); openDj(); }
      else if (b.hasAttribute("data-event-open")) {
        e.preventDefault();
        evFold.open = true;
        evFold.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });

    function render() {
      ui.render(state);
      const m = M(), e = state.event || {}, A = m.current, B = (m.b || {}).current;
      if (m.server_now && m.server_now !== skewFrom) { skewFrom = m.server_now; skew = m.server_now - Date.now(); }
      const line = (n, d) => d.current ? `${d.playing ? "▶" : "⏸"} ${n}: ${d.current.title}` : "";
      box.querySelector(".pg-sum-m").textContent = [line(1, m), line(2, m.b || {})].filter(Boolean).join("   ·   ") || "Two decks and a mixer — play YouTube tracks, mix and scratch";
      box.querySelector(".pg-sum-e").textContent = e.view && e.view !== "off" ? { register: "Showing registration", checkin: "Showing check-in", agenda: "Showing the agenda" }[e.view] : "Registration, check-in or agenda on the big screen";
      const playing = !!((A && m.playing) || (B && m.b.playing));
      box.querySelector(".dj-row").classList.toggle("playing", playing);
      $(".dj-name").textContent = state.name || "Big screen";
      decks.a.render(); decks.b.render();
      const mix = m.mix || {};
      ["a", "b"].forEach(c => { if (!touched(chf[c])) chf[c].value = mix[c] ?? 100; });
      if (!touched(xf)) xf.value = mix.xf ?? 0;
      if (!touched(master)) master.value = m.volume ?? 80;
      dj.querySelectorAll("[data-curve]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.curve === (mix.curve || "mix"))));
      dj.querySelectorAll("[data-mode]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.mode === (m.mode || "audio"))));
      $("[data-loop]").checked = !!m.loop;
      $("[data-chipopt]").checked = m.chip !== false;
      const q = m.queue || [], ul = $("[data-crate]");
      ul.innerHTML = q.map(i => `<li><img src="${thumb(i.id)}" alt="" onerror="this.style.visibility='hidden'"><span title="${esc(i.title)}">${esc(i.title)}</span><span class="b2">
          <button type="button" class="a" data-crate="a" data-key="${esc(i.key)}" title="Load on deck 1">▸1</button>
          <button type="button" class="b" data-crate="b" data-key="${esc(i.key)}" title="Load on deck 2">▸2</button>
          <button type="button" data-crate="x" data-key="${esc(i.key)}" title="Remove" aria-label="Remove">✕</button></span></li>`).join("");
      if (!q.length) ul.innerHTML = `<li class="empty" style="display:block;background:none">The crate is empty — paste links above with <b>+ CRATE</b> to line up tracks.</li>`;
      const djKey = root.querySelector(".st-key[data-dj-open]");
      if (djKey) djKey.classList.toggle("on", playing);
      const evKey = root.querySelector(".st-key[data-event-open]");
      if (evKey) evKey.classList.toggle("on", !!(e.view && e.view !== "off"));
    }
    root.addEventListener("bs:state", ev => { state = ev.detail || state; render(); });
    render();
  });
})();
