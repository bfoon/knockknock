/* ═══════════════════════════════════════════════════════════════════
   HANNS · BIG SCREEN — the paired slide remote  (server: hanns/remote.py)
   ───────────────────────────────────────────────────────────────────
   Control board (each screen card, in Sources):
     nothing paired  → "Pair a phone": QR + link (screen code filled in)
     a phone asks    → its match symbol (🦊 Amber Fox) + Approve / Deny
     paired          → the phone, a lock switch ("only this phone moves
                       the slides"), Unpair
   Projector lobby:
     while a phone is asking, a match card shows the same symbol, so the
     person holding the phone and the host can both see it's the right one;
     a short "paired" flourish when it's approved.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function csrf() {
    const i = document.querySelector("[name=csrfmiddlewaretoken]");
    if (i && i.value) return i.value;
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  const REMOTE_URL = "/hanns/screen/remote/";
  const css = document.createElement("style");
  css.textContent = `
  .rm-row{padding:.75rem 1.2rem;display:flex;flex-direction:column;gap:.7rem}
  .rm-head{display:flex;align-items:center;gap:.9rem;flex-wrap:wrap}
  .rm-ico{flex:none;width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:1.15rem;color:#5eead4;background:rgba(45,212,191,.12)}
  .rm-tx{flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:.15rem}
  .rm-tx b{font-size:.95rem}
  .rm-tx small{font-size:.8rem;color:#a9a6c2}
  .rm-btn{min-height:40px;border-radius:11px;padding:0 .9rem;font:600 .82rem/1 inherit;cursor:pointer;border:1px solid rgba(255,255,255,.14);
    background:rgba(255,255,255,.05);color:#f1f5f9;display:inline-flex;align-items:center;gap:.4rem}
  .rm-btn.ok{border:0;color:#05201c;background:#2dd4bf}
  .rm-btn.no{color:#fda4af;border-color:rgba(251,113,133,.4)}
  .rm-pair{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;padding:.8rem;border-radius:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08)}
  .rm-pair img{width:120px;height:120px;border-radius:10px;background:#fff;flex:none}
  .rm-pair ol{margin:0;padding-left:1.1rem;font-size:.84rem;line-height:1.55;color:#cbd5e1;flex:1 1 220px}
  .rm-pair code{font-size:.78rem;word-break:break-all;color:#5eead4}
  .rm-req{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;padding:.7rem .8rem;border-radius:14px;
    background:color-mix(in srgb,var(--c) 10%,transparent);border:1px solid color-mix(in srgb,var(--c) 55%,transparent);animation:rmIn .35s ease both}
  @keyframes rmIn{from{opacity:0;transform:translateY(6px)}}
  .rm-face{flex:none;width:52px;height:52px;border-radius:50%;display:grid;place-items:center;font-size:1.7rem;
    background:color-mix(in srgb,var(--c) 30%,#14121e);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 40%,transparent);animation:rmPulse 1.8s ease-in-out infinite}
  @keyframes rmPulse{50%{box-shadow:0 0 0 8px color-mix(in srgb,var(--c) 10%,transparent)}}
  .rm-req .who{flex:1 1 160px;min-width:0}
  .rm-req .who b{display:block;color:var(--c);font-size:.95rem}
  .rm-req .who small{color:#cbd5e1;font-size:.8rem}
  .rm-dev{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap}
  .rm-switch{display:inline-flex;align-items:center;gap:.6rem;cursor:pointer;font-size:.84rem;color:#e5e7eb;user-select:none}
  .rm-switch input{appearance:none;-webkit-appearance:none;width:46px;height:26px;border-radius:13px;background:#3f3f46;position:relative;cursor:pointer;transition:background .2s;margin:0}
  .rm-switch input::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:transform .2s}
  .rm-switch input:checked{background:#2dd4bf}
  .rm-switch input:checked::after{transform:translateX(20px)}
  .rm-switch input:focus-visible{outline:2px solid #fff;outline-offset:2px}
  .rm-lockline{font-size:.8rem;color:#a9a6c2}
  .rm-lockline b{color:#5eead4}
  @media (prefers-reduced-motion:reduce){.rm-face,.rm-req{animation:none}}

  /* projector lobby: the match card */
  .rm-lobby{position:fixed;right:3vw;bottom:calc(3vh + 96px);z-index:40;display:flex;align-items:center;gap:1.1rem;padding:1rem 1.4rem 1rem 1rem;border-radius:24px;
    color:#f6f4ff;background:rgba(10,9,18,.86);border:2px solid var(--c);box-shadow:0 30px 80px -20px rgba(0,0,0,.8),0 0 50px -10px var(--c);
    font-family:"Archivo",system-ui,sans-serif;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
    transform:translateY(20px);opacity:0;transition:opacity .4s,transform .4s;pointer-events:none;max-width:min(560px,90vw)}
  .rm-lobby.on{opacity:1;transform:none}
  .rm-lobby .face{flex:none;width:clamp(64px,7vw,110px);height:clamp(64px,7vw,110px);border-radius:50%;display:grid;place-items:center;
    font-size:clamp(2.2rem,4vw,3.8rem);background:color-mix(in srgb,var(--c) 30%,#14121e);animation:rmPulse 1.8s ease-in-out infinite}
  .rm-lobby small{display:block;font:600 clamp(.6rem,.9vw,.8rem)/1 "Spline Sans Mono",ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#a9a6c2}
  .rm-lobby b{display:block;margin:.35rem 0 .25rem;font-size:clamp(1.3rem,2.4vw,2.2rem);color:var(--c);line-height:1}
  .rm-lobby span{font-size:clamp(.8rem,1.1vw,1rem);color:#d7d4e8}`;
  document.head.appendChild(css);

  /* ───────────── control board ───────────── */
  document.querySelectorAll("[data-screen]").forEach(root => {
    if (root.hasAttribute("data-dj-page")) return;
    const token = root.dataset.token;
    let state = {};
    try { state = JSON.parse(root.querySelector("[data-state]").textContent || "{}"); } catch (_) { /* ignore */ }
    const host = document.createElement("div");
    host.className = "rm-row";
    const slot = root.querySelector("[data-addons]");
    if (slot) slot.appendChild(host); else root.appendChild(host);
    let showPair = false, busy = false;

    async function act(body) {
      if (busy) return; busy = true;
      try {
        const r = await fetch(`/hanns/screen/s/${token}/remote/`, { method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) alert(j.error || "Couldn't do that.");
        else if (j.state) { state = j.state; render(); }
      } catch (_) { alert("No connection to the screen."); }
      busy = false;
    }
    function render() {
      const rm = state.remote || { pending: [], device: null, lock: false };
      const code = String(state.share_code || "").replace(/\D/g, "");
      const link = `${location.origin}${REMOTE_URL}?code=${code}`;
      let html = `<div class="rm-head"><span class="rm-ico" aria-hidden="true"><i class="bi bi-phone"></i></span>
        <span class="rm-tx"><b>Slide remote</b><small>${rm.device
          ? (rm.lock ? `Only <b style="color:#5eead4">${esc(rm.device.name)}</b> moves the slides on this screen` : `${esc(rm.device.name)} is paired — the lock is off, anyone with a code can drive`)
          : "Pair one phone or tablet so it's the only thing that moves the slides here"}</small></span>
        ${rm.device || (rm.pending || []).length ? "" : `<button type="button" class="rm-btn" data-rm="toggle" aria-expanded="${showPair}"><i class="bi bi-qr-code"></i> ${showPair ? "Hide" : "Pair a phone"}</button>`}</div>`;
      (rm.pending || []).forEach(p => {
        html += `<div class="rm-req" style="--c:${esc(p.match.color)}"><span class="rm-face" aria-hidden="true">${esc(p.match.emoji)}</span>
          <span class="who"><b>${esc(p.match.word)}</b><small>${esc(p.name)} wants to be the slide remote — check its screen shows the same symbol</small></span>
          <button type="button" class="rm-btn ok" data-rm="approve" data-id="${esc(p.id)}"><i class="bi bi-check-lg"></i> Approve</button>
          <button type="button" class="rm-btn no" data-rm="deny" data-id="${esc(p.id)}">Deny</button></div>`;
      });
      if (rm.device) {
        html += `<div class="rm-dev"><span class="rm-face" style="--c:${esc(rm.device.match.color)};animation:none;width:40px;height:40px;font-size:1.25rem" aria-hidden="true">${esc(rm.device.match.emoji)}</span>
          <label class="rm-switch"><input type="checkbox" data-rm="lock" ${rm.lock ? "checked" : ""}> Only this phone moves the slides</label>
          <span style="flex:1"></span>
          <button type="button" class="rm-btn no" data-rm="unpair"><i class="bi bi-x-lg"></i> Unpair</button></div>
          <div class="rm-lockline">${rm.lock
            ? "Other phones (deck PIN or control codes) and presenter laptops follow along but can't change slides."
            : "Lock is off: everything works as usual. Switch it on to hand the slides to this phone only."}</div>`;
      } else if (showPair || (rm.pending || []).length) {
        html += `<div class="rm-pair"><img alt="QR code to pair a phone" src="/hanns/screen/remote/qr.svg?code=${code}">
          <ol><li>On the phone, scan this — or open <code>${esc(link)}</code></li>
          <li>Give it a name and tap <b>Ask to pair</b></li>
          <li>Its symbol shows up here and on the lobby — tap <b>Approve</b></li></ol></div>`;
      }
      host.innerHTML = html;
    }
    host.addEventListener("click", e => {
      const b = e.target.closest("[data-rm]"); if (!b || b.tagName === "INPUT") return;
      const a = b.dataset.rm;
      if (a === "toggle") { showPair = !showPair; render(); }
      else if (a === "approve" || a === "deny") act({ action: a, id: b.dataset.id });
      else if (a === "unpair" && confirm("Unpair this phone? Anyone with the deck PIN or a control code can drive the slides again.")) act({ action: "unpair" });
    });
    host.addEventListener("change", e => {
      if (e.target.matches('[data-rm="lock"]')) act({ action: "lock", lock: e.target.checked });
    });
    root.addEventListener("bs:state", ev => { state = ev.detail || state; render(); });
    render();
  });

  /* ───────────── projector lobby ───────────── */
  if (document.getElementById("scr-cfg") && document.getElementById("scr-stage")) {
    const card = document.createElement("div");
    card.className = "rm-lobby"; card.setAttribute("aria-live", "polite");
    document.body.appendChild(card);
    let lastDevice = null, flourish = null;
    const sig = rm => (rm && rm.device ? rm.device.name + "|" + rm.device.match.word : null);
    function draw(s) {
      const rm = (s && s.remote) || {}, p = (rm.pending || [])[0], dev = sig(rm);
      if (p) {                                     // a phone is asking: show its symbol
        clearTimeout(flourish); flourish = null;
        card.style.setProperty("--c", p.match.color);
        card.innerHTML = `<div class="face" aria-hidden="true">${esc(p.match.emoji)}</div><div><small>Slide remote · pairing</small>
          <b>${esc(p.match.word)}</b><span>${esc(p.name)} — the host approves on the control board</span></div>`;
        card.classList.add("on");
      } else if (dev && dev !== lastDevice) {      // just approved: a short flourish
        card.style.setProperty("--c", rm.device.match.color);
        card.innerHTML = `<div class="face" aria-hidden="true">${esc(rm.device.match.emoji)}</div><div><small>Slide remote · paired</small>
          <b>${esc(rm.device.name)}</b><span>is now driving the slides</span></div>`;
        card.classList.add("on");
        clearTimeout(flourish);
        flourish = setTimeout(() => { flourish = null; card.classList.remove("on"); }, 4500);
      } else if (!flourish) card.classList.remove("on");
      lastDevice = dev;
    }
    let first = {};
    try { first = JSON.parse((document.getElementById("scr-state") || {}).textContent || "{}"); } catch (_) { /* ignore */ }
    lastDevice = sig(first.remote);
    document.addEventListener("scr:state", e => draw(e.detail));
    draw(first);
  }
})();
