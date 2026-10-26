/* ═══════════════════════════════════════════════════════════════════
   HANNS · BIG SCREEN — Menti polls & games
   ───────────────────────────────────────────────────────────────────
   Presenters send a live poll or game to a big screen (📺 Big screen on
   their presenter screen + the screen's share code). Here the host:
     • sees it waiting in "Live polls & games"
     • ▶ Put on screen  → the projector shows it full screen (display only)
     • ◀ Back · Next ▶ · Reveal · +30 s · ■ End → runs it, question by question
       (on the projector the arrow keys / Page keys / Space do the same)
     • ⏏ Back to lobby → off air;  ✕ → remove it from this screen
   Works on the projector (state from hanns_screen.js's "scr:state") and on
   the Big screens dashboard (each card's "bs:state").
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

  const css = document.createElement("style");
  css.textContent = `
  .lv-sec{margin-top:1rem}
  .lv-row{display:grid;grid-template-columns:auto 1fr auto;gap:.6rem .8rem;align-items:center;padding:.7rem .8rem;border-radius:14px;
    background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.10);margin-bottom:.5rem}
  .lv-row.on{border-color:rgba(255,59,92,.55);background:rgba(255,59,92,.08);box-shadow:0 0 0 3px rgba(255,59,92,.12)}
  .lv-ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:1.25rem;background:rgba(255,255,255,.07)}
  .lv-row.game .lv-ic{background:linear-gradient(135deg,rgba(250,204,21,.25),rgba(249,115,22,.2))}
  .lv-row.poll .lv-ic{background:linear-gradient(135deg,rgba(34,211,238,.22),rgba(167,139,250,.22))}
  .lv-t{min-width:0}.lv-t b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .lv-t small{color:#a9a6c2;font-size:.76rem}
  .lv-live{display:inline-flex;align-items:center;gap:.3rem;font:700 .62rem/1 ui-monospace,monospace;letter-spacing:.14em;color:#ff3b5c;margin-right:.35rem}
  .lv-live::before{content:"";width:7px;height:7px;border-radius:50%;background:#ff3b5c;animation:lvP 1.4s ease-in-out infinite}
  @keyframes lvP{50%{opacity:.35}}
  .lv-acts{display:flex;gap:.35rem;flex-wrap:wrap;justify-content:flex-end}
  .lv-acts button,.lv-ctl button{border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#f1f5f9;border-radius:10px;
    padding:.42rem .7rem;font:600 .78rem/1 system-ui,sans-serif;cursor:pointer;white-space:nowrap}
  .lv-acts button:hover,.lv-ctl button:hover{border-color:#a78bfa}
  .lv-acts .go{border:0;color:#fff;background:linear-gradient(135deg,#ff3b5c,#f97316)}
  .lv-acts .nx,.lv-ctl .nx{border:0;color:#04121a;background:linear-gradient(135deg,#22d3ee,#a78bfa)}
  .lv-acts .x{color:#fda4af}
  .lv-ctl{grid-column:1/-1;display:flex;gap:.35rem;flex-wrap:wrap}
  .lv-ctl button{flex:1 1 auto}
  .lv-empty{color:#a9a6c2;font-size:.8rem;padding:.2rem 0 .4rem}
  .lv-note{font-size:.78rem;margin:.2rem 0 .5rem;color:#fde68a}
  .lv-layer{position:fixed;inset:0;z-index:15;border:0;width:100%;height:100%;background:#05060e;opacity:0;visibility:hidden;transition:opacity .6s,visibility .6s}
  .lv-layer.on{opacity:1;visibility:visible}
  body.lv-on .scr-now{opacity:0;pointer-events:none}
  .bs-live{padding:.9rem 1.2rem;border-bottom:1px solid rgba(255,255,255,.08);margin:0}
  .bs-live .bs-sec-k{display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem}
  .bs-live .bs-sec-k h3{margin:0;font:600 .7rem/1 ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:#a9a6c2}
  .bs-live .bs-sec-k .count{font-size:.8rem;color:#a9a6c2}`;
  document.head.appendChild(css);

  function stateText(s) {
    if (s.state === "running" && s.index != null) return `Question ${s.index + 1} of ${s.total}`;
    if (s.state === "ended") return "Finished — results on screen";
    return s.total ? `Lobby · ${s.total} question${s.total === 1 ? "" : "s"} ready` : "Lobby";
  }

  /* One list + controls, used by both pages. */
  function LiveUI(host, base, onState) {
    let live = null, busy = false;
    async function post(path, body) {
      const r = await fetch(base + path, { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() }, body: JSON.stringify(body || {}) });
      let d = null; try { d = await r.json(); } catch (_) { /* html */ }
      if (r.status === 410) { location.reload(); return null; }
      if (!r.ok || !d || !d.ok) throw new Error((d && d.error) || "Something went wrong (" + r.status + ")");
      if (d.state) onState(d.state);
      return d;
    }
    function note(t) {
      const n = host.querySelector(".lv-note"); if (!n) return;
      n.textContent = t; n.hidden = false; clearTimeout(note.t); note.t = setTimeout(() => { n.hidden = true; }, 4000);
    }
    async function act(id, what) {
      if (busy) return;
      busy = true;
      try {
        if (what === "air") await post(`live/${id}/air/`, { on: true });
        else if (what === "off") await post(`live/${id}/air/`, { on: false });
        else if (what === "remove") await post(`live/${id}/remove/`, {});
        else await post(`live/${id}/control/`, { action: what });
      } catch (e) { note(e.message); }
      finally { busy = false; }
    }
    host.addEventListener("click", e => {
      const b = e.target.closest("[data-lv]"); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      act(b.closest("[data-lv-id]").dataset.lvId, b.dataset.lv);
    });
    function render(l) {
      live = l;
      const shares = (l && l.shares) || [];
      host.hidden = false;
      host.innerHTML = `<div class="scr-sec bs-sec-k"><h3>Live polls &amp; games</h3><span class="count">${shares.length || ""}</span></div>
        <div class="lv-note" hidden></div>` + (shares.length ? shares.map(s => {
          const on = s.status === "onair", game = s.kind === "game";
          const acts = on
            ? `<button type="button" data-lv="off" title="Take it off air — back to the lobby">⏏ Back to lobby</button>`
            : `<button type="button" class="go" data-lv="air" title="Show it full screen on the projector">▶ Put on screen</button>
               <button type="button" class="x" data-lv="remove" title="Remove it from this screen">✕</button>`;
          const ctl = on ? `<div class="lv-ctl">
              <button type="button" data-lv="back" title="Previous question (←)">◀ Back</button>
              <button type="button" class="nx" data-lv="next" title="Next question (→)">${s.state === "lobby" ? "▶ Start" : s.state === "ended" ? "Finished" : "Next ▶"}</button>
              ${game ? `<button type="button" data-lv="reveal" title="Reveal the right answer (R)">✓ Reveal</button>` : ""}
              <button type="button" data-lv="extend" title="Give 30 more seconds">+30 s</button>
              <button type="button" data-lv="end" title="Finish now and show the results">■ End</button>
              ${s.state === "ended" ? `<button type="button" data-lv="restart" title="Back to the first question">↺ From the start</button>` : ""}
            </div>` : "";
          return `<div class="lv-row ${game ? "game" : "poll"}${on ? " on" : ""}" data-lv-id="${esc(s.id)}">
            <div class="lv-ic">${game ? "🎮" : "🗳️"}</div>
            <div class="lv-t"><b>${esc(s.title)}</b><small>${on ? '<span class="lv-live">ON AIR</span>' : ""}${game ? "Game" : "Poll"} · ${esc(stateText(s))} · join ${esc(s.code)}${s.owner ? " · " + esc(s.owner) : ""}</small></div>
            <div class="lv-acts">${acts}</div>${ctl}</div>`;
        }).join("") : `<div class="lv-empty">Nothing yet. Presenters open their Menti poll or game, tap <b>📺 Big screen</b> and type this screen's share code.</div>`);
    }
    return { render, act, get: () => live };
  }

  /* ── on the projector ── */
  const cfgEl = document.getElementById("scr-cfg");
  if (cfgEl && document.getElementById("scr-panel")) {
    const CFG = JSON.parse(cfgEl.textContent || "{}");
    const base = CFG.backdropBase;
    if (!base) return;
    let state = JSON.parse((document.getElementById("scr-state") || {}).textContent || "{}");
    const frame = document.createElement("iframe");
    frame.className = "lv-layer"; frame.title = "Live poll or game"; frame.setAttribute("allow", "fullscreen");
    document.body.appendChild(frame);
    const host = document.createElement("section");
    host.className = "lv-sec";
    const pb = document.querySelector("#scr-panel .scr-pb");
    const bg = pb && pb.querySelector(".sbd-panel");
    if (pb) pb.insertBefore(host, bg || null);
    const apply = s => { document.dispatchEvent(new CustomEvent("scr:state", { detail: s })); };
    const ui = LiveUI(host, base, apply);
    let shownId = null;
    function render() {
      const l = state.live || { shares: [], on_air: null };
      ui.render(l);
      const id = l.on_air;
      if (id !== shownId) {
        shownId = id;
        if (id) frame.src = `${base}live/${id}/view/`;
        else setTimeout(() => { if (!shownId) frame.removeAttribute("src"); }, 700);
      }
      frame.classList.toggle("on", !!id);
      document.body.classList.toggle("lv-on", !!id);
    }
    document.addEventListener("scr:state", e => { state = e.detail || state; render(); });
    // on air, the arrow keys run the poll / game instead of a deck behind it
    document.addEventListener("keydown", e => {
      const l = state.live; if (!l || !l.on_air) return;
      if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const map = { ArrowRight: "next", PageDown: "next", " ": "next", ArrowLeft: "back", PageUp: "back", r: "reveal", R: "reveal" };
      const what = map[e.key]; if (!what) return;
      e.preventDefault(); e.stopImmediatePropagation();
      ui.act(l.on_air, what);
    }, true);
    // keys pressed while the embedded poll / game has focus come up from it
    window.addEventListener("message", e => {
      if (e.origin !== location.origin || !e.data || typeof e.data.kkScreenKey !== "string") return;
      document.dispatchEvent(new KeyboardEvent("keydown", { key: e.data.kkScreenKey, bubbles: true, cancelable: true }));
    });
    render();
    return;
  }

  /* ── on the Big screens dashboard ── */
  document.querySelectorAll("[data-screen]").forEach(root => {
    const base = `/screenart/s/${root.dataset.token}/`;
    let state = {};
    try { state = JSON.parse(root.querySelector("[data-state]").textContent || "{}"); } catch (_) { /* ignore */ }
    const host = document.createElement("div");
    host.className = "bs-live lv-sec";
    const link = root.querySelector(".bs-link");
    if (link) link.parentNode.insertBefore(host, link); else root.appendChild(host);
    const ui = LiveUI(host, base, s => { state = s; render(); });
    function render() {
      const l = state.live || { shares: [] };
      if (!(l.shares || []).length) { host.hidden = true; host.innerHTML = ""; return; }   // only when something is shared
      ui.render(l);
      const mon = root.querySelector("[data-monitor-k]");
      const on = (l.shares || []).find(s => s.status === "onair");
      if (on && mon && !(state.backdrop && state.backdrop.show)) mon.textContent = (on.kind === "game" ? "Live game" : "Live poll") + " · on screen";
    }
    root.addEventListener("bs:state", e => { state = e.detail || state; render(); });
    render();
  });
})();
