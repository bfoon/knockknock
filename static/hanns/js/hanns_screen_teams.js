/* ═══════════════════════════════════════════════════════════════════
   HANNS · BIG SCREEN — a Microsoft Teams meeting on the big screen
   (server: screenart/teams.py)
   ───────────────────────────────────────────────────────────────────
   Microsoft doesn't let Teams run inside another web page, so it can't
   live inside the big screen like YouTube does. Instead:

   Projector:  a "Teams" scene comes in (with the screen's transition) and
               the meeting opens in its OWN window on the projector laptop,
               sized to the screen. If the browser blocks that window, the
               scene shows one big "Open the meeting" button (one click on
               the projector) and how to allow it for next time. If someone
               closes the Teams window by hand, the control board hears it.
   Board:      paste the invitation, a link or the meeting ID (+ passcode);
               "Put it on the big screen" / "Back to Knock Knock"; recent
               meetings one tap away (kept in this browser only).
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function csrf() {
    if (window.__SCR_CSRF__) return window.__SCR_CSRF__;
    const i = document.querySelector("[name=csrfmiddlewaretoken]");
    if (i && i.value) return i.value;
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  const post = (token, body) => fetch(`/screenart/s/${token}/teams/`, {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() }, body: JSON.stringify(body),
  }).then(r => r.json().then(j => ({ ok: r.ok && j.ok, j })).catch(() => ({ ok: false, j: {} })));
  const TEAMS = "#7b83eb";               // a Teams-like violet for the scene and buttons

  /* ───────────── projector ───────────── */
  const cfgEl = document.getElementById("scr-cfg");
  if (cfgEl && document.getElementById("scr-stage")) {
    let token = "";
    try { token = (JSON.parse(cfgEl.textContent || "{}").token) || ""; } catch (_) { /* below */ }
    if (!token) { const m = location.pathname.match(/\/screen\/s\/([^/]+)\//); token = m ? m[1] : ""; }
    const css = document.createElement("style");
    css.textContent = `
    .tm-layer{position:fixed;inset:0;z-index:30;display:none;align-items:center;justify-content:center;padding:4vh 4vw;
      background:radial-gradient(70% 60% at 50% 40%,rgba(123,131,235,.22),transparent 70%),#0b0b16;color:#eef0ff;
      font-family:"Archivo",system-ui,sans-serif;text-align:center}
    .tm-layer.on{display:flex}
    .tm-card{display:flex;flex-direction:column;align-items:center;gap:2.2vh;max-width:min(900px,92vw)}
    .tm-rings{position:relative;width:15vh;height:15vh;display:grid;place-items:center}
    .tm-rings i{position:absolute;inset:0;border-radius:50%;border:2px solid ${TEAMS};opacity:0;animation:tmRing 2.4s ease-out infinite}
    .tm-rings i:nth-child(2){animation-delay:.8s}.tm-rings i:nth-child(3){animation-delay:1.6s}
    @keyframes tmRing{0%{transform:scale(.5);opacity:.85}100%{transform:scale(1.35);opacity:0}}
    .tm-face{width:9vh;height:9vh;border-radius:26%;display:grid;place-items:center;background:${TEAMS};color:#fff;
      font:800 4.6vh/1 "Archivo",system-ui,sans-serif;box-shadow:0 2vh 6vh -1vh rgba(123,131,235,.6)}
    .tm-k{font:600 clamp(.7rem,1.3vh,1rem)/1 "Spline Sans Mono",ui-monospace,monospace;letter-spacing:.28em;text-transform:uppercase;color:#b8bdf7}
    .tm-t{font:800 clamp(1.8rem,6vh,4.2rem)/1.05 "Archivo",system-ui,sans-serif;letter-spacing:-.02em}
    .tm-s{font:500 clamp(1rem,2.3vh,1.5rem)/1.4 "Inter",system-ui,sans-serif;color:#c9cbe6;max-width:46em}
    .tm-go{margin-top:1vh;min-height:7vh;padding:0 4vh;border:0;border-radius:2vh;cursor:pointer;color:#fff;background:${TEAMS};
      font:800 clamp(1rem,2.6vh,1.7rem)/1 "Archivo",system-ui,sans-serif;box-shadow:0 1.6vh 5vh -1vh rgba(123,131,235,.7)}
    .tm-go[hidden]{display:none}
    .tm-tips{font:500 clamp(.8rem,1.7vh,1.1rem)/1.5 "Inter",system-ui,sans-serif;color:#9a9cc0}
    .tm-tips b{color:#e0e2ff}
    @media (prefers-reduced-motion:reduce){.tm-rings i{animation:none;opacity:.4}}`;
    document.head.appendChild(css);
    const layer = document.createElement("div");
    layer.className = "tm-layer"; layer.setAttribute("role", "status");
    layer.innerHTML = `<video class="tm-video" data-tm-video muted playsinline hidden></video>
      <div class="tm-card" data-tm-card>
        <div class="tm-rings" aria-hidden="true"><i></i><i></i><i></i><span class="tm-face">T</span></div>
        <div class="tm-k">Microsoft Teams</div>
        <div class="tm-t" data-tm-t>Teams meeting</div>
        <div class="tm-s" data-tm-s>Opening the meeting on this screen…</div>
        <div class="tm-acts"><button type="button" class="tm-go" data-tm-go hidden>Open the meeting</button>
          <button type="button" class="tm-go tm-cap" data-tm-cap hidden>Show it inside the big screen</button></div>
        <div class="tm-tips" data-tm-tips></div></div>`;
    document.body.appendChild(layer);
    css.textContent += `
    .tm-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000}
    .tm-video[hidden],.tm-card[hidden]{display:none}
    .tm-acts{display:flex;gap:1.5vh;flex-wrap:wrap;justify-content:center}
    .tm-cap{background:#16a34a;box-shadow:0 1.6vh 5vh -1vh rgba(22,163,74,.6)}`;
    const $ = s => layer.querySelector(s);
    const video = $("[data-tm-video]");
    let win = null, key = "", stream = null, mode = "";
    const report = m => { if (m !== mode) { mode = m; post(token, { action: "report", mode: m }); } };

    function open(st) {
      const w = (screen.availWidth || 1920), h = (screen.availHeight || 1080);
      try { win = window.open(st.url, `kk-teams-${token}`, `popup=yes,left=0,top=0,width=${w},height=${h}`); } catch (_) { win = null; }
      if (win) {
        try { win.focus(); } catch (_) { /* fine */ }
        $("[data-tm-s]").textContent = "The meeting opened in its own window on this screen.";
        $("[data-tm-go]").hidden = true;
        $("[data-tm-cap]").hidden = false;
        $("[data-tm-tips]").innerHTML = "1 · In Teams: <b>Continue on this browser</b> → <b>Join now</b>.<br>" +
          "2 · Come back to this window and click <b>Show it inside the big screen</b>, then pick the Teams window — " +
          "the control board can then switch between Teams and Knock Knock without leaving the meeting.";
        report("window");
      } else {
        // the browser blocked the window: one click here, and how to stop it happening
        $("[data-tm-s]").textContent = "This browser needs one click here to open the meeting.";
        $("[data-tm-go]").hidden = false;
        $("[data-tm-tips]").innerHTML = "To skip this next time: allow <b>pop-ups</b> for this site (the icon at the end of the address bar).";
      }
    }
    async function capture() {
      // The browser asks which window to show — pick the Teams one. (A rule of every
      // browser: only a person at this computer can start a capture.)
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: "window", frameRate: { ideal: 30 }, cursor: "never" },
          audio: false, selfBrowserSurface: "exclude", surfaceSwitching: "include",
        });
      } catch (_) { stream = null; return; }                   // cancelled: nothing changes
      video.srcObject = stream; video.hidden = false; $("[data-tm-card]").hidden = true;
      try { await video.play(); } catch (_) { /* muted: plays */ }
      report("inside");
      stream.getVideoTracks()[0].addEventListener("ended", () => {   // sharing stopped / the window went away
        stopCapture(); if (render.last && render.last.on) report("window");
      });
    }
    function stopCapture() {
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = null; video.srcObject = null; video.hidden = true; $("[data-tm-card]").hidden = false;
    }
    $("[data-tm-go]").addEventListener("click", () => { const st = render.last; if (st && st.on) open(st); });
    $("[data-tm-cap]").addEventListener("click", capture);
    function end() {
      stopCapture();
      if (win) { try { if (!win.closed) win.close(); } catch (_) { /* cut off: can't */ } }   // works while the browser still lets us
      win = null; mode = "";
      try { window.focus(); } catch (_) { /* fine */ }
    }
    function render(s) {
      const st = (s && s.teams) || { on: false };
      render.last = st;
      // the meeting keeps running while hidden: showing it again is instant
      layer.classList.toggle("on", !!(st.on && st.shown));
      if (!st.on) { if (key) { key = ""; end(); } return; }
      $("[data-tm-t]").textContent = st.label || "Teams meeting";
      const k = st.url + "|" + st.since;
      if (k !== key) { key = k; stopCapture(); mode = ""; open(st); }   // a new meeting: open it
    }
    let first = {};
    try { first = JSON.parse((document.getElementById("scr-state") || {}).textContent || "{}"); } catch (_) { /* ignore */ }
    render(first);
    document.addEventListener("scr:state", e => render(e.detail));
  }

  /* ───────────── control board ───────────── */
  const cssB = document.createElement("style");
  cssB.textContent = `
  .tmb{padding:.75rem 1.2rem;display:flex;flex-direction:column;gap:.6rem}
  .tmb-head{display:flex;align-items:center;gap:.9rem;flex-wrap:wrap}
  .tmb-ico{flex:none;width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font:800 1.1rem/1 "Archivo",system-ui,sans-serif;color:#fff;background:${TEAMS}}
  .tmb-tx{flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:.15rem}
  .tmb-tx b{font-size:.95rem}.tmb-tx small{font-size:.8rem;color:#a9a6c2}
  .tmb-live{display:inline-flex;align-items:center;gap:.4rem;font:700 .66rem/1 ui-monospace,monospace;letter-spacing:.14em;color:#c7ccff;
    padding:.35rem .55rem;border-radius:999px;background:rgba(123,131,235,.16);border:1px solid rgba(123,131,235,.5)}
  .tmb-live::before{content:"";width:7px;height:7px;border-radius:50%;background:#a5acff;box-shadow:0 0 8px #a5acff}
  .tmb-form{display:grid;grid-template-columns:minmax(0,1fr) 170px;gap:.45rem}
  .tmb textarea,.tmb input{width:100%;box-sizing:border-box;border-radius:11px;border:1px solid rgba(255,255,255,.16);background:#05050a;color:#f1f5f9;
    padding:.6rem .75rem;font:500 .86rem/1.35 inherit}
  .tmb textarea{min-height:46px;resize:vertical}
  .tmb input{min-height:46px}
  .tmb .row{display:flex;gap:.45rem;flex-wrap:wrap;align-items:center}
  .tmb .seg{display:inline-flex;padding:3px;border-radius:10px;background:#05050a;border:1px solid rgba(255,255,255,.12)}
  .tmb .seg button{min-height:34px;border:0;border-radius:8px;background:none;color:#a9a6c2;padding:0 .7rem;font:600 .76rem/1 inherit;cursor:pointer}
  .tmb .seg button[aria-pressed="true"]{background:#e5e7eb;color:#0b0b0f}
  .tmb .go{min-height:42px;border:0;border-radius:11px;padding:0 1rem;cursor:pointer;color:#fff;background:${TEAMS};font:700 .84rem/1 inherit}
  .tmb .back{min-height:42px;border-radius:11px;padding:0 1rem;cursor:pointer;color:#fecaca;background:#450a0a;border:1px solid #ef4444;font:700 .84rem/1 inherit}
  .tmb .go:disabled{opacity:.5;cursor:default}
  .tmb-check{font-size:.8rem;min-height:1.2em;color:#a9a6c2}
  .tmb-hint{margin-top:.5rem;font-size:.8rem;line-height:1.45;color:#c7c9e8;padding:.55rem .7rem;border-radius:10px;
    background:rgba(123,131,235,.08);border:1px solid rgba(123,131,235,.3)}
  .tmb-hint:empty{display:none}
  .tmb-hint b{color:#fff}
  .tmb-check.ok{color:#86efac}.tmb-check.bad{color:#fda4af}
  .tmb-recent{display:flex;gap:.35rem;flex-wrap:wrap}
  .tmb-recent button{min-height:32px;border-radius:999px;padding:0 .75rem;border:1px solid rgba(123,131,235,.45);background:rgba(123,131,235,.1);
    color:#d6d9ff;font:600 .74rem/1 inherit;cursor:pointer}
  .tmb [hidden]{display:none!important}
  @media (max-width:700px){.tmb-form{grid-template-columns:1fr}}`;
  document.head.appendChild(cssB);
  document.querySelectorAll("[data-screen]").forEach(root => {
    if (root.hasAttribute("data-dj-page")) return;
    const token = root.dataset.token;
    let state = {};
    try { state = JSON.parse(root.querySelector("[data-state]").textContent || "{}"); } catch (_) { /* ignore */ }
    const host = document.createElement("div");
    host.className = "tmb";
    host.innerHTML = `<div class="tmb-head"><span class="tmb-ico" aria-hidden="true">T</span>
        <span class="tmb-tx"><b>Teams meeting</b><small data-tmb-sub>Paste the invitation — the big screen opens the meeting</small></span>
        <span class="tmb-live" data-tmb-live hidden>ON THE BIG SCREEN</span></div>
      <div data-tmb-edit>
        <div class="tmb-form">
          <textarea data-tmb-invite rows="2" placeholder="Paste the Teams invitation, a join link, or the meeting ID" aria-label="Teams invitation, link or meeting ID"></textarea>
          <input data-tmb-pass autocomplete="off" placeholder="Passcode" aria-label="Passcode (if not in the invitation)">
        </div>
        <div class="row" style="margin-top:.45rem">
          <span class="seg" role="group" aria-label="Kind of meeting"><button type="button" data-tmb-kind="work" aria-pressed="true">Work / school</button><button type="button" data-tmb-kind="personal" aria-pressed="false">Personal</button></span>
          <input data-tmb-label maxlength="60" placeholder="Name it (optional) — e.g. Board call" aria-label="Name for the big screen" style="flex:1 1 200px;min-height:42px">
          <button type="button" class="go" data-tmb-go disabled>Put it on the big screen</button>
        </div>
      </div>
      <div data-tmb-on hidden>
        <div class="row">
          <button type="button" class="go" data-tmb-show>Show Teams</button>
          <button type="button" class="back" data-tmb-hide>Back to Knock Knock</button>
          <button type="button" class="back" data-tmb-end>End meeting</button>
        </div>
        <div class="tmb-hint" data-tmb-hint></div>
      </div>
      <div class="tmb-check" data-tmb-check aria-live="polite"></div>
      <div class="tmb-recent" data-tmb-recent></div>`;
    const slot = root.querySelector("[data-addons]");
    if (slot) slot.appendChild(host); else root.appendChild(host);
    const $ = s => host.querySelector(s);
    const inv = $("[data-tmb-invite]"), pass = $("[data-tmb-pass]"), label = $("[data-tmb-label]"), go = $("[data-tmb-go]"), check = $("[data-tmb-check]");
    let kind = "work", ckT = null, parsed = null;
    const RKEY = `kk-teams-recent-${token}`;
    const recent = () => { try { return JSON.parse(localStorage.getItem(RKEY) || "[]"); } catch (_) { return []; } };
    function remember(p, name) {
      const list = recent().filter(r => r.url !== p.url);
      list.unshift({ url: p.url, label: name || p.label, id: p.id, kind: p.kind });
      try { localStorage.setItem(RKEY, JSON.stringify(list.slice(0, 5))); } catch (_) { /* private mode */ }
      drawRecent();
    }
    function drawRecent() {
      const list = recent();
      $("[data-tmb-recent]").innerHTML = list.length ? `<small style="color:#77738f;align-self:center">Recent:</small>` +
        list.map((r, i) => `<button type="button" data-tmb-recent-i="${i}" title="${esc(r.url.replace(/\?p=.*/, "?p=…"))}">${esc(r.label)}</button>`).join("") : "";
    }
    const say = (t, cls) => { check.className = "tmb-check" + (cls ? " " + cls : ""); check.textContent = t; };
    const body = () => ({ invite: inv.value, passcode: pass.value, id: "", kind, label: label.value.trim() });
    function recheck() {
      clearTimeout(ckT); parsed = null; go.disabled = true;
      if (!inv.value.trim() && !pass.value.trim()) { say(""); return; }
      ckT = setTimeout(async () => {
        const { ok, j } = await post(token, Object.assign({ action: "check" }, body()));
        if (!ok) { say(j.error || "Couldn't read that.", "bad"); return; }
        parsed = j.teams; go.disabled = false;
        // what we understood, passcode hidden
        const p = (parsed.url.match(/[?&]p=([^&]+)/) || [])[1];
        if (parsed.kind !== kind) { kind = parsed.kind; drawKind(); }
        say(`✓ ${parsed.label}${p ? " · passcode ••••" + decodeURIComponent(p).slice(-2) : ""}${parsed.kind === "personal" ? " · personal meeting" : ""}`, "ok");
      }, 350);
    }
    function drawKind() { host.querySelectorAll("[data-tmb-kind]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tmbKind === kind))); }
    inv.addEventListener("input", recheck); pass.addEventListener("input", recheck);
    host.addEventListener("click", async e => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.tmbKind) { kind = b.dataset.tmbKind; drawKind(); recheck(); }
      else if (b.hasAttribute("data-tmb-go")) {
        go.disabled = true;
        const { ok, j } = await post(token, Object.assign({ action: "open" }, body()));
        if (!ok) { say(j.error || "Couldn't open it.", "bad"); go.disabled = false; return; }
        remember(j.teams, label.value.trim());
        state.teams = j.teams; render();
        say("Opening on the big screen… In Teams pick “Continue on this browser”, then “Join now”.", "ok");
      } else if (b.hasAttribute("data-tmb-show") || b.hasAttribute("data-tmb-hide") || b.hasAttribute("data-tmb-end")) {
        const act = b.hasAttribute("data-tmb-show") ? "show" : b.hasAttribute("data-tmb-hide") ? "hide" : "close";
        const { ok, j } = await post(token, { action: act });
        if (ok) {
          state.teams = j.teams; render();
          say(act === "show" ? "Teams is on the big screen." : act === "hide" ? "Back to Knock Knock — the meeting keeps running." : "Meeting ended on the big screen.");
        } else say(j.error || "Couldn't do that.", "bad");
      } else if (b.dataset.tmbRecentI != null) {
        const r = recent()[+b.dataset.tmbRecentI]; if (!r) return;
        inv.value = r.url; pass.value = ""; label.value = r.label || ""; kind = r.kind || "work"; drawKind(); recheck();
      }
    });
    function render() {
      const t = state.teams || { on: false };
      const inside = t.on && t.mode === "inside";
      $("[data-tmb-live]").hidden = !(t.on && t.shown);
      $("[data-tmb-on]").hidden = !t.on;
      $("[data-tmb-edit]").hidden = !!t.on;
      // what can really be done depends on how the projector has the meeting
      $("[data-tmb-show]").hidden = !(inside && !t.shown);
      $("[data-tmb-hide]").hidden = !(inside && t.shown);
      $("[data-tmb-end]").textContent = inside ? "End meeting" : "End & back to Knock Knock";
      $("[data-tmb-hint]").innerHTML = !t.on ? "" : inside
        ? (t.shown ? "Teams is on the big screen. <b>Back to Knock Knock</b> keeps the meeting running in the background."
                   : "The meeting is running in the background — <b>Show Teams</b> puts it back on the big screen.")
        : "On the projector: join in Teams (<b>Continue on this browser</b> → <b>Join now</b>), then click <b>Show it inside the big screen</b> " +
          "on the Knock Knock window and pick the Teams window. After that you can switch between Teams and Knock Knock from here.";
      $("[data-tmb-sub]").textContent = t.on
        ? `${t.label || "Teams meeting"}${t.since ? " · since " + new Date(t.since).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}${inside && !t.shown ? " · in the background" : ""}`
        : "Paste the invitation — the big screen opens the meeting";
    }
    root.addEventListener("bs:state", ev => { state = ev.detail || state; render(); });
    render(); drawRecent();
  });
})();
