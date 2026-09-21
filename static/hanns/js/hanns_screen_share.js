/* ═══════════════════════════════════════════════════════════════════
   HANNS · SHARE TO BIG SCREEN — the presenter's side.

   Any element with [data-screen-share] opens the share dialog:

     <button data-screen-share
             data-share-url="/hanns/ABC123/screen-share/"
             data-deck-code="ABC123"
             data-deck-title="Q3 results"
             data-save-first="1">          ← editor only: save before sharing

   The presenter types the six-digit code shown by the host, and the deck
   joins that screen's queue. A small status chip then follows the share
   while it is open — "In the queue" → "On the big screen" — and when the
   host puts it on air, offers "Present & take control" (owner) or explains
   the control-code route (collaborators / no laptop).

   Self-contained: injects its own styles, needs nothing else on the page.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
"use strict";
if(window.__hannsScreenShare) return;
window.__hannsScreenShare = true;

const STORE = "hanns_screen_share:";
const POLL_MS = 4000;

function csrf(){
  const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  if(m) return decodeURIComponent(m[1]);
  const cfg = window.__HANNS__ || window.__HANNS_PRESENT__ || {};
  return cfg.csrftoken || "";
}
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function load(code){ try{ return JSON.parse(localStorage.getItem(STORE + code) || "null"); }catch(e){ return null; } }
function save(code, v){ try{ v ? localStorage.setItem(STORE + code, JSON.stringify(v)) : localStorage.removeItem(STORE + code); }catch(e){} }

/* ── styles ───────────────────────────────────────────────────────── */
const css = `
.hss-dlg{position:fixed;inset:0;z-index:2147483600;display:grid;place-items:center;padding:1rem;
  background:rgba(4,3,10,.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);animation:hssFade .2s ease both;
  font:400 15px/1.5 "Inter","Archivo",system-ui,-apple-system,"Segoe UI",sans-serif;color:#f6f4ff}
@keyframes hssFade{from{opacity:0}to{opacity:1}}
.hss-card{position:relative;width:min(460px,100%);border-radius:22px;padding:1.6rem 1.5rem 1.35rem;
  background:linear-gradient(180deg,rgba(35,30,64,.97),rgba(18,16,34,.99));border:1px solid rgba(255,255,255,.14);
  box-shadow:0 40px 120px -20px rgba(0,0,0,.85);animation:hssPop .3s cubic-bezier(.22,1,.36,1) both}
@keyframes hssPop{from{opacity:0;transform:translateY(10px) scale(.98)}to{opacity:1;transform:none}}
.hss-x{position:absolute;right:.8rem;top:.8rem;width:34px;height:34px;border-radius:10px;border:0;background:transparent;color:#a9a6c2;cursor:pointer;font-size:1.1rem}
.hss-x:hover{background:rgba(255,255,255,.08);color:#fff}
.hss-k{display:flex;align-items:center;gap:.45rem;font:700 .64rem/1 "Spline Sans Mono",ui-monospace,monospace;letter-spacing:.2em;text-transform:uppercase;color:#22d3ee}
.hss-card h2{margin:.55rem 0 .3rem;font:600 1.45rem/1.2 "Fraunces",Georgia,serif}
.hss-sub{margin:0 0 1.2rem;color:#a9a6c2;font-size:.9rem}
.hss-deck{display:inline-flex;align-items:center;gap:.4rem;max-width:100%;padding:.3rem .65rem;border-radius:999px;
  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);font-size:.8rem;color:#d9d6ee;margin-bottom:1rem}
.hss-deck span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hss-boxes{display:flex;gap:.4rem}
.hss-boxes input{width:100%;min-width:0;aspect-ratio:3/4;text-align:center;border-radius:13px;
  background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.14);color:#fff;font:600 1.55rem/1 "Spline Sans Mono",ui-monospace,monospace;
  transition:border-color .15s,background .15s}
.hss-boxes input:nth-child(4){margin-left:.45rem}
.hss-boxes input:focus{outline:none;border-color:#8b5cf6;background:rgba(139,92,246,.14)}
.hss-boxes.bad input{border-color:rgba(253,164,175,.6);animation:hssShake .36s}
@keyframes hssShake{25%,75%{transform:translateX(-4px)}50%{transform:translateX(4px)}}
.hss-note{width:100%;margin-top:.9rem;padding:.7rem .85rem;border-radius:12px;background:rgba(0,0,0,.3);
  border:1px solid rgba(255,255,255,.12);color:#fff;font-size:.9rem}
.hss-note:focus{outline:none;border-color:#8b5cf6}
.hss-msg{min-height:1.3rem;margin-top:.7rem;font-size:.85rem;color:#a9a6c2}
.hss-msg.bad{color:#fda4af}
.hss-act{display:flex;gap:.5rem;justify-content:flex-end;flex-wrap:wrap;margin-top:1rem}
.hss-btn{display:inline-flex;align-items:center;justify-content:center;gap:.45rem;padding:.7rem 1rem;border-radius:12px;cursor:pointer;
  font:650 .88rem/1 inherit;color:#f6f4ff;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);text-decoration:none}
.hss-btn:hover{background:rgba(255,255,255,.12)}
.hss-btn.primary{border:0;background:linear-gradient(135deg,#8b5cf6,#6d28d9 60%,#0891b2);box-shadow:0 12px 32px -12px rgba(139,92,246,.85)}
.hss-btn.live{border:0;background:linear-gradient(135deg,#ff3b5c,#e11d48);box-shadow:0 12px 32px -12px rgba(255,59,92,.85)}
.hss-btn.ghost-danger{color:#fda4af;border-color:rgba(244,63,94,.3)}
.hss-btn:disabled{opacity:.55;cursor:default}
.hss-status{display:flex;gap:.9rem;align-items:flex-start;padding:1rem;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1)}
.hss-status.live{background:rgba(255,59,92,.08);border-color:rgba(255,59,92,.35)}
.hss-orb{width:40px;height:40px;border-radius:50%;flex:0 0 auto;display:grid;place-items:center;font-size:1.1rem;background:rgba(34,211,238,.14);color:#67e8f9}
.hss-status.waiting .hss-orb{animation:hssBreath 2.4s ease-in-out infinite}
.hss-status.live .hss-orb{background:#ff3b5c;color:#fff;animation:hssRing 1.6s infinite}
.hss-status.closed .hss-orb{background:rgba(255,255,255,.08);color:#a9a6c2}
@keyframes hssBreath{50%{transform:scale(1.08);box-shadow:0 0 0 8px rgba(34,211,238,.06)}}
@keyframes hssRing{0%{box-shadow:0 0 0 0 rgba(255,59,92,.55)}70%{box-shadow:0 0 0 14px rgba(255,59,92,0)}100%{box-shadow:0 0 0 0 rgba(255,59,92,0)}}
.hss-status b{display:block;font-size:1rem;margin-bottom:.15rem}
.hss-status p{margin:0;color:#b8b5d0;font-size:.86rem}
.hss-steps{margin:.9rem 0 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:.45rem;font-size:.86rem;color:#c9c6de}
.hss-steps li{display:flex;gap:.55rem;align-items:flex-start}
.hss-steps .n{flex:0 0 auto;width:1.45rem;height:1.45rem;border-radius:50%;display:grid;place-items:center;background:rgba(139,92,246,.22);color:#ddd6fe;font:700 .7rem/1 "Spline Sans Mono",monospace}
.hss-steps code{font:600 .8rem/1 "Spline Sans Mono",monospace;color:#c4b5fd;overflow-wrap:anywhere}
.hss-chip{position:fixed;left:1rem;bottom:1rem;z-index:2147483500;display:flex;align-items:center;gap:.6rem;
  padding:.55rem .9rem .55rem .6rem;border-radius:999px;cursor:pointer;border:1px solid rgba(255,255,255,.14);
  background:rgba(18,16,34,.9);color:#f6f4ff;box-shadow:0 18px 50px -12px rgba(0,0,0,.7);
  backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  font:600 .82rem/1 "Inter",system-ui,sans-serif;animation:hssPop .35s cubic-bezier(.22,1,.36,1) both;max-width:calc(100vw - 2rem)}
.hss-chip .d{width:10px;height:10px;border-radius:50%;background:#22d3ee;flex:0 0 auto}
.hss-chip.waiting .d{animation:hssBreath 2.4s infinite}
.hss-chip.live{border-color:rgba(255,59,92,.55);background:rgba(60,10,24,.92)}
.hss-chip.live .d{background:#ff3b5c;animation:hssRing 1.6s infinite}
.hss-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;
const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);

/* ── dialog plumbing ──────────────────────────────────────────────── */
let dlg = null;
function openDlg(html){
  closeDlg();
  dlg = document.createElement("div");
  dlg.className = "hss-dlg";
  dlg.setAttribute("role","dialog"); dlg.setAttribute("aria-modal","true");
  dlg.innerHTML = `<div class="hss-card"><button class="hss-x" type="button" aria-label="Close">✕</button>${html}</div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener("click", e=>{ if(e.target === dlg) closeDlg(); });
  dlg.querySelector(".hss-x").addEventListener("click", closeDlg);
  document.addEventListener("keydown", escClose);
  return dlg;
}
function escClose(e){ if(e.key === "Escape") closeDlg(); }
function closeDlg(){
  if(dlg){ dlg.remove(); dlg = null; }
  document.removeEventListener("keydown", escClose);
}

/* ── tracked shares (one per deck on this browser) ────────────────── */
const tracked = new Map();   // deck code → {share, ctx, timer}

function ctxFrom(btn){
  return {
    shareUrl: btn.dataset.shareUrl,
    code: btn.dataset.deckCode,
    title: btn.dataset.deckTitle || "this deck",
    saveFirst: btn.dataset.saveFirst === "1",
  };
}

async function saveEditorFirst(){
  // The screen loads the deck from the server when it goes on air, so an
  // unsaved edit would not be there. Nudge the editor's own Save.
  const b = document.getElementById("btn-save");
  if(!b || b.dataset.state === "saved") return;
  b.click();
  for(let n = 0; n < 30; n++){
    await new Promise(r=>setTimeout(r, 150));
    if(b.dataset.state === "saved") return;
  }
}

function openShare(ctx){
  const t = tracked.get(ctx.code);
  if(t && t.share && t.share.is_open){ openStatus(ctx.code); return; }
  const d = openDlg(`
    <div class="hss-k">📺 Share to a big screen</div>
    <h2>Enter the screen code</h2>
    <p class="hss-sub">The host shows or sends you a six-digit code. Your deck goes into their queue — they choose when it plays.</p>
    <div class="hss-deck">🎞 <span>${esc(ctx.title)}</span></div>
    <div class="hss-boxes" id="hss-boxes">${"<input inputmode='numeric' pattern='[0-9]*' maxlength='1'>".repeat(6)}</div>
    <input class="hss-note" id="hss-note" maxlength="140" placeholder="Note for the host (optional) — e.g. “I'm on after the break”">
    <div class="hss-msg" id="hss-msg"></div>
    <div class="hss-act">
      <button class="hss-btn" type="button" data-cancel>Cancel</button>
      <button class="hss-btn primary" type="button" id="hss-go">Share deck</button>
    </div>`);
  const inputs = [...d.querySelectorAll("#hss-boxes input")];
  const msg = d.querySelector("#hss-msg");
  const go = d.querySelector("#hss-go");
  const val = ()=>inputs.map(i=>i.value).join("");
  const say = (t, bad)=>{ msg.textContent = t || ""; msg.className = "hss-msg" + (bad ? " bad" : ""); };
  function fill(str){
    const dg = String(str||"").replace(/\D/g,"").slice(0,6).split("");
    inputs.forEach((i,n)=>i.value = dg[n] || "");
    (inputs[Math.min(dg.length,5)]||inputs[0]).focus();
  }
  inputs.forEach((inp,n)=>{
    inp.addEventListener("input", ()=>{
      const v = inp.value.replace(/\D/g,"");
      if(v.length > 1){ fill(val().slice(0,n) + v); return; }
      inp.value = v; d.querySelector("#hss-boxes").classList.remove("bad");
      if(v && n < 5) inputs[n+1].focus();
    });
    inp.addEventListener("keydown", e=>{
      if(e.key === "Backspace" && !inp.value && n > 0){ inputs[n-1].focus(); inputs[n-1].value = ""; e.preventDefault(); }
      else if(e.key === "Enter") submit();
    });
    inp.addEventListener("paste", e=>{ const t = e.clipboardData.getData("text"); if(t){ e.preventDefault(); fill(t); } });
  });
  d.querySelector("[data-cancel]").addEventListener("click", closeDlg);
  go.addEventListener("click", submit);
  setTimeout(()=>inputs[0].focus(), 40);

  async function submit(){
    const code = val();
    if(code.length !== 6){ say("Enter all six digits.", true); return; }
    go.disabled = true; say(ctx.saveFirst ? "Saving your latest changes…" : "Sharing…");
    try{
      if(ctx.saveFirst) await saveEditorFirst();
      say("Sharing…");
      const r = await fetch(ctx.shareUrl, {
        method:"POST", credentials:"same-origin",
        headers:{"Content-Type":"application/json","X-CSRFToken":csrf()},
        body: JSON.stringify({screen_code: code, note: d.querySelector("#hss-note").value.trim()}),
      });
      const j = await r.json().catch(()=>({}));
      if(!j.ok){
        d.querySelector("#hss-boxes").classList.add("bad");
        let t = j.error || "That did not work.";
        if(typeof j.tries_left === "number" && j.tries_left > 0 && j.tries_left <= 3) t += ` ${j.tries_left} attempt${j.tries_left===1?"":"s"} left.`;
        say(t, true);
        if(j.locked){ inputs.forEach(i=>i.disabled = true); return; }
        inputs.forEach(i=>i.value = ""); inputs[0].focus();
        go.disabled = false;
        return;
      }
      track(ctx, j.share);
      openStatus(ctx.code);
    }catch(e){
      say("Could not reach the server. Check your connection.", true);
      go.disabled = false;
    }
  }
}

function statusHtml(s, ctx){
  if(!s.is_open){
    const why = {
      removed: "The host removed it from the screen.",
      withdrawn: "You took it back.",
      ended: "The big screen has been stopped.",
    }[s.status] || "It is no longer shared.";
    return `
      <div class="hss-k">📺 ${esc(s.screen_name)}</div>
      <h2>No longer shared</h2>
      <div class="hss-status closed"><div class="hss-orb">⏏</div><div><b>${esc(s.deck_title)}</b><p>${esc(why)}</p></div></div>
      <div class="hss-act">
        <button class="hss-btn" type="button" data-close>Close</button>
        ${s.screen_active ? `<button class="hss-btn primary" type="button" data-again>Share again</button>` : ""}
      </div>`;
  }
  if(s.on_screen){
    const steps = s.is_owner
      ? `<ol class="hss-steps">
           <li><span class="n">1</span><span>Tap <b>Present &amp; take control</b> — your presenter screen opens with the controller QR.</span></li>
           <li><span class="n">2</span><span>Scan it with your phone and enter your PIN.</span></li>
           <li><span class="n">3</span><span>Your phone now drives the big screen — notes, reveals and zoom included.</span></li>
         </ol>
         <p class="hss-sub" style="margin:.8rem 0 0">No laptop with you? Ask the host for a <b>control code</b> and open <code style="font:600 .8rem/1 monospace;color:#c4b5fd">${esc(s.control_entry_url.replace(/^https?:\/\//,""))}</code> on your phone.</p>`
      : `<ol class="hss-steps">
           <li><span class="n">1</span><span>Ask the host for a <b>control code</b> for this deck.</span></li>
           <li><span class="n">2</span><span>On your phone open <code>${esc(s.control_entry_url.replace(/^https?:\/\//,""))}</code></span></li>
           <li><span class="n">3</span><span>Enter the code — your phone drives the slides on the big screen.</span></li>
         </ol>`;
    return `
      <div class="hss-k" style="color:#ff8fa3">● Live on ${esc(s.screen_name)}</div>
      <h2>You're on the big screen</h2>
      <div class="hss-status live"><div class="hss-orb">📡</div><div><b>${esc(s.deck_title)}</b><p>The room can see your first slide. Take control when you're ready.</p></div></div>
      ${steps}
      <div class="hss-act">
        <button class="hss-btn ghost-danger" type="button" data-withdraw>Take it back</button>
        ${s.is_owner ? `<a class="hss-btn live" href="${esc(s.present_url)}" target="_blank" rel="noopener">▶ Present &amp; take control</a>` : `<button class="hss-btn" type="button" data-close>Got it</button>`}
      </div>`;
  }
  const shown = s.status === "shown";
  return `
    <div class="hss-k">📺 ${esc(s.screen_name)}</div>
    <h2>${shown ? "Back in the queue" : "You're in the queue"}</h2>
    <div class="hss-status waiting"><div class="hss-orb">⏳</div><div><b>${esc(s.deck_title)}</b>
      <p>${shown ? "It has been on screen. The host can bring it back any time." : "The host has been notified. This updates the moment your deck goes on screen — you can keep editing."}</p></div></div>
    <div class="hss-act">
      <button class="hss-btn ghost-danger" type="button" data-withdraw>Withdraw</button>
      <button class="hss-btn primary" type="button" data-close>OK</button>
    </div>`;
}

function openStatus(code){
  const t = tracked.get(code);
  if(!t) return;
  const d = openDlg(statusHtml(t.share, t.ctx));
  d.dataset.deck = code;
  wireStatus(d, code);
}
function wireStatus(d, code){
  const t = tracked.get(code);
  d.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click", closeDlg));
  const again = d.querySelector("[data-again]");
  if(again) again.addEventListener("click", ()=>{ untrack(code); openShare(t.ctx); });
  const wd = d.querySelector("[data-withdraw]");
  if(wd) wd.addEventListener("click", async ()=>{
    wd.disabled = true;
    try{
      const r = await fetch(t.share.withdraw_url, {method:"POST", credentials:"same-origin", headers:{"X-CSRFToken":csrf()}});
      const j = await r.json(); if(j.share) update(code, j.share);
    }catch(e){ wd.disabled = false; }
  });
  const pres = d.querySelector('a.hss-btn.live');
  if(pres) pres.addEventListener("click", ()=>setTimeout(closeDlg, 200));
}

/* ── the status chip + polling ────────────────────────────────────── */
let chip = null;
function renderChip(){
  // One chip for whichever tracked share matters most on this page.
  const open = [...tracked.values()].filter(t=>t.share && t.share.is_open);
  if(!open.length){ if(chip){ chip.remove(); chip = null; } return; }
  const t = open.find(x=>x.share.on_screen) || open[0];
  if(!chip){
    chip = document.createElement("button");
    chip.type = "button";
    document.body.appendChild(chip);
    chip.addEventListener("click", ()=>openStatus(chip.dataset.deck));
  }
  chip.dataset.deck = t.ctx.code;
  chip.className = "hss-chip " + (t.share.on_screen ? "live" : "waiting");
  chip.innerHTML = `<span class="d"></span><span>${t.share.on_screen
    ? `Live on ${esc(t.share.screen_name)} · take control`
    : `In the queue · ${esc(t.share.screen_name)}`}</span>`;
}

function update(code, share){
  const t = tracked.get(code);
  if(!t) return;
  const was = t.share || {};
  t.share = share;
  if(share.is_open) save(code, {id:share.id, status_url:share.status_url});
  else { save(code, null); stopPoll(t); }
  renderChip();
  // Went live: say so loudly on THIS screen (the presenter's), and flash
  // the tab title in case they are in another tab.
  if(share.on_screen && !was.on_screen) flashTitle("● You're live on the big screen");
  if(dlg && dlg.dataset.deck === code){
    const html = statusHtml(share, t.ctx);
    dlg.querySelector(".hss-card").innerHTML = `<button class="hss-x" type="button" aria-label="Close">✕</button>${html}`;
    dlg.querySelector(".hss-x").addEventListener("click", closeDlg);
    wireStatus(dlg, code);
  }else if(share.on_screen && !was.on_screen){
    openStatus(code);
  }
}

let titleTimer = 0;
function flashTitle(text){
  const orig = document.title.replace(/^● .*? · /, "");
  let on = false, n = 0;
  clearInterval(titleTimer);
  titleTimer = setInterval(()=>{
    on = !on; n++;
    document.title = on ? `${text} · ${orig}` : orig;
    if(n > 12 || (!document.hidden && n > 4)){ clearInterval(titleTimer); document.title = orig; }
  }, 900);
}

function track(ctx, share){
  let t = tracked.get(ctx.code);
  if(!t){ t = {ctx, share:null, timer:0}; tracked.set(ctx.code, t); }
  t.ctx = ctx;
  update(ctx.code, share);
  if(share.is_open) startPoll(t);
}
function untrack(code){
  const t = tracked.get(code);
  if(t) stopPoll(t);
  tracked.delete(code); save(code, null); renderChip();
}
function startPoll(t){
  stopPoll(t);
  t.timer = setInterval(async ()=>{
    if(document.hidden && !(t.share && t.share.is_open)) return;
    try{
      const r = await fetch(t.share.status_url, {credentials:"same-origin"});
      if(r.status === 404){ untrack(t.ctx.code); return; }
      const j = await r.json();
      if(j.share) update(t.ctx.code, j.share);
    }catch(e){}
  }, POLL_MS);
}
function stopPoll(t){ if(t.timer){ clearInterval(t.timer); t.timer = 0; } }

/* ── boot ─────────────────────────────────────────────────────────── */
document.addEventListener("click", e=>{
  const b = e.target.closest("[data-screen-share]");
  if(!b) return;
  e.preventDefault();
  openShare(ctxFrom(b));
});

// Pick up shares that were open when this page was last loaded.
document.querySelectorAll("[data-screen-share]").forEach(async b=>{
  const ctx = ctxFrom(b);
  if(!ctx.code || tracked.has(ctx.code)) return;
  const saved = load(ctx.code);
  if(!saved || !saved.status_url) return;
  tracked.set(ctx.code, {ctx, share:null, timer:0});
  try{
    const r = await fetch(saved.status_url, {credentials:"same-origin"});
    if(!r.ok){ untrack(ctx.code); return; }
    const j = await r.json();
    if(j.share && j.share.is_open){ track(ctx, j.share); }
    else untrack(ctx.code);
  }catch(e){ tracked.delete(ctx.code); }
});
})();
