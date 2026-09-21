/* ═══════════════════════════════════════════════════════════════════
   HANNS · BIG SCREEN — the room display shell.

   One page, opened once, left in full screen for the whole event.

   • The deck on air runs in an <iframe> of its own presentation stage
     (present.html in embed mode). Swapping decks swaps the frame, never
     this document, so the browser stays in full screen throughout. The
     incoming frame loads invisibly and cross-fades over the old one.

   • Everything the host needs lives behind a near-transparent arrow at
     the top edge: the queue of shared decks (who shared, a live
     thumbnail, slide count), put-on-screen, control codes for presenters
     without a laptop, the share code, and "Stop big screen".

   • State comes from ONE snapshot pushed over ws/hanns/screen/<token>/
     after every change. The page renders from it and never patches its
     own copy, so a reconnect is just "draw the snapshot again". A slow
     poll backs the socket up.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
"use strict";

const $ = (s, r=document)=>r.querySelector(s);
const W = 960, H = 540;
const CFG = JSON.parse($("#scr-cfg").textContent || "{}");
let state = JSON.parse($("#scr-state").textContent || "{}");
const CSRF = window.__SCR_CSRF__ || "";

const body = document.body;
const stageEl = $("#scr-stage");
const lobby = $("#scr-lobby");
const panel = $("#scr-panel");
const handle = $("#scr-handle");
const listEl = $("#scr-list");

let onAir = null;            // share id currently loaded in the frame
let frame = null;            // the visible <iframe>
let liveSlide = {index:0, total:0};
let codeVisible = false;     // share code in the panel header
let quiet = false;
let seenShares = new Set();  // ids the host has already been told about
let unseen = new Set();      // arrived since the panel was last opened
const thumbCache = new Map();// share id → painted 960×540 node

try{ quiet = localStorage.getItem("hanns_screen_quiet") === "1"; }catch(e){}

/* ── helpers ──────────────────────────────────────────────────────── */
function esc(s){
  return String(s ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function initials(name){
  const p = String(name||"?").trim().split(/\s+/).filter(Boolean);
  return ((p[0]||"?")[0] + (p.length>1 ? p[p.length-1][0] : "")).toUpperCase();
}
function hue(str){
  let h = 0; for(const ch of String(str||"")) h = (h*31 + ch.charCodeAt(0)) % 360;
  return h;
}
function avatarStyle(name){
  const h = hue(name);
  return `background:linear-gradient(135deg,hsl(${h} 70% 55%),hsl(${(h+50)%360} 70% 42%))`;
}
function groupCode(code){
  const c = String(code||"");
  return c.length === 6 ? c.slice(0,3) + " " + c.slice(3) : c;
}
async function post(url, data){
  const r = await fetch(url, {
    method:"POST", credentials:"same-origin",
    headers:{"Content-Type":"application/json","X-CSRFToken":CSRF},
    body: JSON.stringify(data || {}),
  });
  let j = {}; try{ j = await r.json(); }catch(e){}
  if(r.status === 410 || j.stopped){ showStopped(); }
  return {ok: r.ok && j.ok !== false, status: r.status, data: j};
}
function shareById(id){ return (state.shares||[]).find(s=>s.id === id) || null; }

/* ── thumbnails, painted by the real renderer ─────────────────────── */
function thumbFor(share){
  if(!share) return null;
  let node = thumbCache.get(share.id);
  if(node) return node;
  node = document.createElement("div");
  node.className = "scr-mini";
  if(share.first && window.Hanns && typeof window.Hanns.paintSlide === "function"){
    try{ window.Hanns.paintSlide(node, share.first, {live:false}); }
    catch(e){ node.style.background = "#1a1730"; }
  }else{
    node.style.background = "linear-gradient(135deg,#1e1b3a,#0e0c1c)";
  }
  thumbCache.set(share.id, node);
  return node;
}
function mountThumb(host, share, width){
  const src = thumbFor(share);
  if(!src || !host) return;
  // A painted slide can only live in one place, so toasts get a clone.
  const node = host.closest(".scr-toast") ? src.cloneNode(true) : src;
  host.prepend(node);
  const w = width || host.clientWidth || 250;
  node.style.transform = `scale(${w / W})`;
}

/* ── the lobby ────────────────────────────────────────────────────── */
function renderLobby(){
  $("#scr-name").textContent = state.name || "Big screen";
  $("#scr-ph-name").textContent = state.name || "Big screen";
  document.title = `${state.name || "Big screen"} · Big Screen · Hanns`;
  const showCode = !!state.show_code && !!state.share_code;
  $("#scr-code-wrap").hidden = !showCode;
  $("#scr-private").hidden = showCode;
  const box = $("#scr-code");
  const code = state.share_code || "";
  if(box.dataset.code !== code){
    box.dataset.code = code;
    box.innerHTML = code.split("").map(d=>`<span>${esc(d)}</span>`).join("");
  }
  const u = (CFG.hannsUrl || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  $("#scr-url").textContent = u;
  const waiting = state.waiting || 0;
  $("#scr-waiting").hidden = waiting === 0;
  $("#scr-waiting-txt").textContent = `${waiting} deck${waiting===1?"":"s"} waiting to go on screen`;
}

/* ── the queue panel ──────────────────────────────────────────────── */
function renderPanel(){
  const shares = state.shares || [];
  $("#scr-count").textContent = shares.length ? `${shares.length} deck${shares.length===1?"":"s"}` : "";
  $("#scr-ph-code").textContent = codeVisible ? groupCode(state.share_code) : "••• •••";
  $("#scr-code-eye").innerHTML = codeVisible ? '<i class="bi bi-eye-slash"></i>' : '<i class="bi bi-eye"></i>';
  $("#scr-showcode").classList.toggle("on", !!state.show_code);
  $("#scr-showcode span").textContent = state.show_code ? "Code on lobby" : "Code hidden";
  $("#scr-quiet").innerHTML = quiet
    ? '<i class="bi bi-bell-slash"></i> <span>Quiet alerts</span>'
    : '<i class="bi bi-bell"></i> <span>Alerts on</span>';
  $("#scr-lobby-btn").disabled = !state.current;

  if(!shares.length){
    listEl.innerHTML = `
      <div class="scr-empty" style="grid-column:1/-1">
        <div class="big">📺</div>
        <div>Nothing shared yet.</div>
        <div style="margin-top:.4rem;font-size:.86rem">Presenters open their deck in Hanns, tap
          <b style="font-family:inherit;letter-spacing:0">Big screen</b> and enter
          <b>${codeVisible ? esc(groupCode(state.share_code)) : "the share code"}</b>.</div>
      </div>`;
    return;
  }

  // Live first, then newest waiting, then the ones already shown.
  const rank = s => s.id === state.current ? 0 : (s.status === "waiting" ? 1 : 2);
  const sorted = shares.slice().sort((a,b)=> rank(a)-rank(b) || (rank(a)===1 ? a.created.localeCompare(b.created) : b.created.localeCompare(a.created)));

  listEl.innerHTML = sorted.map(s=>{
    const live = s.id === state.current;
    const isNew = unseen.has(s.id) && !live;
    const tag = live ? '<span class="scr-tag live">On screen</span>'
      : isNew ? '<span class="scr-tag new">New</span>'
      : s.status === "shown" ? '<span class="scr-tag">Shown</span>'
      : '<span class="scr-tag">Waiting</span>';
    const pct = live && liveSlide.total ? Math.round((liveSlide.index+1)/liveSlide.total*100) : 0;
    return `
    <article class="scr-card${live?" is-live":""}${isNew?" is-new":""}" data-id="${esc(s.id)}">
      <div class="scr-thumb" data-act="play" title="${live ? "On screen now" : "Put on screen"}">
        ${tag}
        <span class="scr-slides">${s.slides} slide${s.slides===1?"":"s"}</span>
        <div class="play"><span><i class="bi bi-play-fill"></i></span></div>
      </div>
      <div class="scr-cb">
        <div class="scr-ct" title="${esc(s.title)}">${esc(s.title)}</div>
        <div class="scr-who">
          <span class="scr-av" style="${avatarStyle(s.sharer)}">${esc(initials(s.sharer))}</span>
          <span>${esc(s.sharer)}</span><span class="ago">· ${esc(s.age)}</span>
        </div>
        ${s.note ? `<div class="scr-note" title="${esc(s.note)}">“${esc(s.note)}”</div>` : ""}
        ${live ? `<div class="scr-live-meta"><span>Slide ${liveSlide.total ? liveSlide.index+1 : 1} / ${liveSlide.total || s.slides}</span><span class="bar"><i style="width:${pct}%"></i></span></div>` : ""}
        <div class="scr-ca">
          ${live
            ? `<button class="scr-btn onair" type="button" disabled><i class="bi bi-broadcast"></i> On screen</button>`
            : `<button class="scr-btn primary" type="button" data-act="play"><i class="bi bi-play-fill"></i> Put on screen</button>`}
          <button class="scr-btn sq" type="button" data-act="code" title="Control code — for a presenter without a laptop">
            <i class="bi bi-phone"></i>${s.control_code ? ' <i class="bi bi-check2" style="color:var(--scr-ok)"></i>' : ""}
          </button>
          <button class="scr-btn sq danger" type="button" data-act="remove" title="Remove from this screen"><i class="bi bi-x-lg"></i></button>
        </div>
      </div>
    </article>`;
  }).join("");

  listEl.querySelectorAll(".scr-card").forEach(card=>{
    mountThumb(card.querySelector(".scr-thumb"), shareById(card.dataset.id));
  });
}

listEl.addEventListener("click", ev=>{
  const btn = ev.target.closest("[data-act]");
  const card = ev.target.closest(".scr-card");
  if(!btn || !card) return;
  const id = card.dataset.id;
  const act = btn.dataset.act;
  if(act === "play") putOnScreen(id);
  else if(act === "code") openControlCode(id);
  else if(act === "remove") confirmRemove(id);
});

function openPanel(){
  body.classList.add("scr-panel-open");
  panel.setAttribute("aria-hidden","false");
  handle.setAttribute("aria-expanded","true");
  renderPanel();
  // Opening the queue is "I have seen them": the badge clears, but the
  // NEW tags stay on the cards until the panel is closed again.
  handle.classList.remove("has-new");
}
function closePanel(){
  body.classList.remove("scr-panel-open");
  panel.setAttribute("aria-hidden","true");
  handle.setAttribute("aria-expanded","false");
  unseen.clear();
  updateBadge();
  frameFocus();
}
function togglePanel(){ body.classList.contains("scr-panel-open") ? closePanel() : openPanel(); }
function updateBadge(){
  const n = unseen.size;
  $("#scr-badge").textContent = n > 9 ? "9+" : String(n);
  handle.classList.toggle("has-new", n > 0 && !body.classList.contains("scr-panel-open"));
}

/* ── putting a deck on air ────────────────────────────────────────── */
async function putOnScreen(id){
  if(id === state.current){ closePanel(); return; }
  const r = await post(CFG.selectUrl, {share:id});
  if(!r.ok){
    toast({kicker:"Could not switch", warn:true, title:r.data.error || "That deck is no longer shared."});
    return;
  }
  // The snapshot push will follow; switch now so it feels instant.
  state.current = id;
  syncFrame();
  closePanel();
}

async function backToLobby(){
  await post(CFG.lobbyUrl, {});
  state.current = null;
  syncFrame();
}

function syncFrame(){
  const want = state.current && shareById(state.current) ? state.current : null;
  if(want === onAir) { renderLobbyVisibility(); return; }
  onAir = want;
  liveSlide = {index:0, total:0};
  if(!want){
    // Fade the deck out, reveal the lobby.
    const old = frame; frame = null;
    renderLobbyVisibility();
    if(old){ old.classList.remove("on"); setTimeout(()=>old.remove(), 750); }
    return;
  }
  const share = shareById(want);
  const next = document.createElement("iframe");
  next.className = "scr-frame";
  next.title = share ? share.title : "Presentation";
  next.allow = "autoplay; fullscreen; screen-wake-lock; clipboard-write";
  next.src = share.frame_url;
  stageEl.appendChild(next);
  const old = frame;
  frame = next;
  let shown = false;
  const reveal = ()=>{
    if(shown || frame !== next) return;
    shown = true;
    requestAnimationFrame(()=>{
      next.classList.add("on");
      renderLobbyVisibility();
      if(old){ old.classList.remove("on"); setTimeout(()=>old.remove(), 750); }
      nowPresenting(share);
      frameFocus();
    });
  };
  // Give the stage a beat after load to paint its first slide, so the
  // cross-fade lands on a finished slide, not a blank frame.
  next.addEventListener("load", ()=>setTimeout(reveal, 280));
  setTimeout(reveal, 6000);  // never leave the room staring at the old deck
}
function renderLobbyVisibility(){
  // The lobby steps aside only once a deck has actually faded in. Between
  // two decks the outgoing one stays up until the incoming one is ready,
  // so the room never flashes back to the lobby mid-switch.
  lobby.classList.toggle("off", !!onAir && !!stageEl.querySelector(".scr-frame.on"));
}
function frameFocus(){
  if(frame && !body.classList.contains("scr-panel-open")){
    try{ frame.contentWindow.focus(); }catch(e){}
  }
}
function toFrame(cmd){
  if(!frame) return;
  try{ frame.contentWindow.postMessage({hannsScreenCmd:cmd}, location.origin); }catch(e){}
}

let nowTimer = 0;
function nowPresenting(share){
  if(!share) return;
  $("#scr-now-av").textContent = initials(share.sharer);
  $("#scr-now-av").setAttribute("style", avatarStyle(share.sharer));
  $("#scr-now-t").textContent = share.title;
  $("#scr-now-w").textContent = share.sharer;
  const el = $("#scr-now");
  clearTimeout(nowTimer);
  el.classList.remove("on");
  setTimeout(()=>el.classList.add("on"), 500);
  nowTimer = setTimeout(()=>el.classList.remove("on"), 5200);
}

/* Messages from the embedded stage. */
window.addEventListener("message", ev=>{
  if(ev.origin !== location.origin || !ev.data || !ev.data.hannsScreen) return;
  if(frame && ev.source !== frame.contentWindow) return;
  const m = ev.data;
  if(m.type === "slide" || m.type === "ready"){
    liveSlide = {index: m.index|0, total: m.total|0};
    if(body.classList.contains("scr-panel-open")){
      const meta = listEl.querySelector(".scr-card.is-live .scr-live-meta");
      if(meta){
        const pct = liveSlide.total ? Math.round((liveSlide.index+1)/liveSlide.total*100) : 0;
        meta.innerHTML = `<span>Slide ${liveSlide.index+1} / ${liveSlide.total}</span><span class="bar"><i style="width:${pct}%"></i></span>`;
      }
    }
  }else if(m.type === "ended"){
    // The presenter ended their show: hand the room back to the lobby.
    backToLobby();
  }else if(m.type === "activity"){
    wake();
  }else if(m.type === "key"){
    const k = String(m.key||"").toLowerCase();
    if(k === "f") toggleFullscreen();
    else if(k === "q") togglePanel();
    else if(k === "l" && state.current) backToLobby();
    else if(k === "escape" && body.classList.contains("scr-panel-open")) closePanel();
    wake();
  }
});

/* ── toasts ───────────────────────────────────────────────────────── */
function toast({kicker, title, who, share, warn, action}){
  const box = $("#scr-toasts");
  const t = document.createElement("div");
  t.className = "scr-toast";
  t.innerHTML = `
    ${share ? '<div class="tt"></div>' : ""}
    <div class="tb">
      <div class="tk${warn?" warn":""}">${esc(kicker||"")}</div>
      <div class="ttl">${esc(title||"")}</div>
      ${who ? `<div class="tw">${esc(who)}</div>` : ""}
    </div>
    ${action ? `<div class="tx"><button class="scr-btn primary" type="button">${esc(action.label)}</button></div>` : ""}`;
  box.prepend(t);
  if(share) mountThumb(t.querySelector(".tt"), share, 88);
  if(action) t.querySelector(".tx button").addEventListener("click", ()=>{ action.run(); dismiss(); });
  while(box.children.length > 3) box.lastElementChild.remove();
  let gone = false;
  function dismiss(){ if(gone) return; gone = true; t.classList.add("out"); setTimeout(()=>t.remove(), 420); }
  setTimeout(dismiss, 7000);
}

function handleNotice(n){
  if(!n) return;
  if(n.kind === "new" || n.kind === "again"){
    if(!body.classList.contains("scr-panel-open") || n.kind === "new") unseen.add(n.share);
    updateBadge();
    if(body.classList.contains("scr-panel-open")) return;   // the host is already looking
    if(quiet) return;
    const share = shareById(n.share);
    toast({
      kicker: n.kind === "new" ? "New deck shared" : "Shared again",
      title: n.title, who: `${n.sharer} · ${n.slides || (share && share.slides) || 0} slides`,
      share,
      action: {label:"Show", run:()=>putOnScreen(n.share)},
    });
  }else if(n.kind === "withdrawn"){
    unseen.delete(n.share); updateBadge();
    if(!quiet) toast({kicker:"Withdrawn", warn:true, title:n.title, who:`${n.sharer} took it back`});
  }
}

/* ── control codes: for a presenter without a laptop ──────────────── */
function dialog(html){
  const host = $("#scr-dialogs");
  host.innerHTML = `<div class="scr-dlg" role="dialog" aria-modal="true"><div class="scr-dlg-card">${html}</div></div>`;
  const d = host.firstElementChild;
  d.addEventListener("click", e=>{ if(e.target === d) closeDialog(); });
  return d;
}
function closeDialog(){ $("#scr-dialogs").innerHTML = ""; }

async function openControlCode(id, reissue){
  const share = shareById(id);
  if(!share) return;
  const r = await post(`${CFG.shareBase}${id}/control-code/`, reissue ? {reissue:true} : {});
  if(!r.ok){ toast({kicker:"Control code", warn:true, title:r.data.error || "Could not issue a code."}); return; }
  const code = r.data.code || "";
  const entry = r.data.entry_url || CFG.controlEntryUrl;
  const d = dialog(`
    <button class="scr-icon x" type="button" data-x><i class="bi bi-x-lg"></i></button>
    <div class="k"><i class="bi bi-phone"></i> Control code</div>
    <h2>${esc(share.title)}</h2>
    <p>For <b>${esc(share.sharer)}</b>. It drives this deck only, and stops working when you remove the deck or stop the screen.</p>
    <div class="scr-dlg-code masked" id="dlg-code">${code.split("").map(c=>`<span>${esc(c)}</span>`).join("")}</div>
    <div style="text-align:center;margin-bottom:.4rem">
      <button class="scr-btn" type="button" data-reveal><i class="bi bi-eye"></i> <span>Reveal code</span></button>
    </div>
    <div class="scr-dlg-row">
      <div class="scr-dlg-qr" id="dlg-qr"></div>
      <div class="scr-dlg-steps">
        On their phone:<br>
        <b>1.</b> Scan this QR, or open <code>${esc(entry.replace(/^https?:\/\//,""))}</code><br>
        <b>2.</b> Enter the six-digit code<br>
        <b>3.</b> They're driving the slides — notes, reveals and zoom included.
      </div>
    </div>
    <div class="scr-dlg-act">
      <button class="scr-btn" type="button" data-reissue title="The old code stops working at once"><i class="bi bi-arrow-repeat"></i> New code</button>
      <button class="scr-btn primary" type="button" data-x style="flex:0 0 auto">Done</button>
    </div>`);
  // The QR carries only the entry page — never the code. Scanning it from
  // across the room gets you a keypad, not the controls.
  try{
    if(window.QRCode) new QRCode(d.querySelector("#dlg-qr"), {text: entry, width:112, height:112, colorDark:"#111827", colorLight:"#ffffff", correctLevel:QRCode.CorrectLevel.M});
  }catch(e){}
  d.querySelectorAll("[data-x]").forEach(b=>b.addEventListener("click", closeDialog));
  d.querySelector("[data-reveal]").addEventListener("click", e=>{
    const box = d.querySelector("#dlg-code");
    const masked = box.classList.toggle("masked");
    e.currentTarget.querySelector("span").textContent = masked ? "Reveal code" : "Hide code";
  });
  d.querySelector("[data-reissue]").addEventListener("click", ()=>openControlCode(id, true));
}

function confirmRemove(id){
  const share = shareById(id);
  if(!share) return;
  const live = id === state.current;
  const d = dialog(`
    <div class="k danger"><i class="bi bi-x-circle"></i> Remove deck</div>
    <h2>Remove “${esc(share.title)}”?</h2>
    <p>${live ? "It is on screen now — the room returns to the lobby. " : ""}${esc(share.sharer)} can share it again with the code.${share.control_code ? " Its control code stops working." : ""}</p>
    <div class="scr-dlg-act">
      <button class="scr-btn" type="button" data-x>Keep it</button>
      <button class="scr-btn danger" type="button" data-go style="flex:0 0 auto"><i class="bi bi-x-lg"></i> Remove</button>
    </div>`);
  d.querySelector("[data-x]").addEventListener("click", closeDialog);
  d.querySelector("[data-go]").addEventListener("click", async ()=>{
    closeDialog();
    await post(`${CFG.shareBase}${id}/remove/`, {});
  });
}

function confirmStop(){
  const n = (state.shares||[]).length;
  const d = dialog(`
    <div class="k danger"><i class="bi bi-power"></i> Stop big screen</div>
    <h2>End this big screen?</h2>
    <p>The link stops working, ${n ? `all ${n} shared deck${n===1?" is":"s are"} released, ` : ""}and every control code dies at once.
       To host again later you will open a new screen with a new code.</p>
    <div class="scr-dlg-act">
      <button class="scr-btn" type="button" data-x>Keep running</button>
      <button class="scr-btn danger" type="button" data-go style="flex:0 0 auto"><i class="bi bi-power"></i> Stop screen</button>
    </div>`);
  d.querySelector("[data-x]").addEventListener("click", closeDialog);
  d.querySelector("[data-go]").addEventListener("click", async ()=>{
    closeDialog();
    await post(CFG.stopUrl, {});
    showStopped();
  });
}

function openRename(){
  const d = dialog(`
    <div class="k"><i class="bi bi-pencil"></i> Screen name</div>
    <h2>What should the room see?</h2>
    <input class="scr-input" id="dlg-name" maxlength="80" value="${esc(state.name||"")}">
    <div class="scr-dlg-act">
      <button class="scr-btn" type="button" data-x>Cancel</button>
      <button class="scr-btn primary" type="button" data-go style="flex:0 0 auto">Save</button>
    </div>`);
  const inp = d.querySelector("#dlg-name");
  setTimeout(()=>{ inp.focus(); inp.select(); }, 30);
  const save = async ()=>{ const v = inp.value.trim(); closeDialog(); if(v) await post(CFG.settingsUrl, {name:v}); };
  d.querySelector("[data-x]").addEventListener("click", closeDialog);
  d.querySelector("[data-go]").addEventListener("click", save);
  inp.addEventListener("keydown", e=>{ if(e.key === "Enter") save(); });
}

/* ── stopped ──────────────────────────────────────────────────────── */
let stoppedShown = false;
function showStopped(){
  if(stoppedShown) return;
  stoppedShown = true;
  closePanel(); closeDialog();
  if(frame){ frame.remove(); frame = null; }
  onAir = null;
  Live.stop();
  $("#scr-stopped").hidden = false;
  releaseWake();
}
$("#scr-exit-fs").addEventListener("click", ()=>{
  if(document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(()=>{});
});

/* ── full screen + wake lock ──────────────────────────────────────── */
async function toggleFullscreen(){
  try{
    if(!document.fullscreenElement){
      await document.documentElement.requestFullscreen({navigationUI:"hide"});
    }else{
      await document.exitFullscreen();
    }
  }catch(e){}
  keepAwake();
}
function onFsChange(){
  const fs = !!document.fullscreenElement;
  body.classList.toggle("scr-fs", fs);
  $("#scr-fs-btn span").textContent = fs ? "Exit full screen" : "Full screen";
  $("#scr-fs-btn i").className = fs ? "bi bi-fullscreen-exit" : "bi bi-arrows-fullscreen";
  toFrame("refit");
  wake();
}
document.addEventListener("fullscreenchange", onFsChange);

let wakeLock = null;
async function keepAwake(){
  if(!("wakeLock" in navigator) || document.visibilityState !== "visible" || wakeLock || stoppedShown) return;
  try{
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", ()=>{ wakeLock = null; if(!stoppedShown) setTimeout(keepAwake, 800); });
  }catch(e){ wakeLock = null; }
}
function releaseWake(){ if(wakeLock){ try{ wakeLock.release(); }catch(e){} wakeLock = null; } }
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState === "visible") keepAwake(); });

/* ── "the host is reaching for the screen" ────────────────────────── */
let wakeTimer = 0;
function wake(){
  body.classList.add("scr-awake");
  clearTimeout(wakeTimer);
  wakeTimer = setTimeout(()=>body.classList.remove("scr-awake"), 2400);
}
["pointermove","pointerdown","touchstart","wheel"].forEach(ev=>document.addEventListener(ev, wake, {passive:true}));
$("#scr-hotzone").addEventListener("pointerenter", wake);

/* ── keyboard (when this page, not the frame, has focus) ──────────── */
document.addEventListener("keydown", e=>{
  if(e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  const k = e.key;
  wake();
  if(k === "Escape"){
    if($("#scr-dialogs").firstElementChild){ closeDialog(); return; }
    if(body.classList.contains("scr-panel-open")){ closePanel(); return; }
  }
  if($("#scr-dialogs").firstElementChild) return;
  const lk = k.toLowerCase();
  if(lk === "q" || k === "ArrowDown" && !frame){ togglePanel(); e.preventDefault(); }
  else if(lk === "f"){ toggleFullscreen(); e.preventDefault(); }
  else if(lk === "l"){ if(state.current) backToLobby(); e.preventDefault(); }
  else if(k === "ArrowRight" || k === " " || k === "PageDown"){ toFrame("next"); e.preventDefault(); }
  else if(k === "ArrowLeft" || k === "PageUp"){ toFrame("prev"); e.preventDefault(); }
  else if(lk === "z"){ toFrame("zoom"); }
});

/* ── wiring ───────────────────────────────────────────────────────── */
handle.addEventListener("click", togglePanel);
$("#scr-scrim").addEventListener("click", closePanel);
$("#scr-close").addEventListener("click", closePanel);
$("#scr-go-fs").addEventListener("click", toggleFullscreen);
$("#scr-fs-btn").addEventListener("click", toggleFullscreen);
$("#scr-lobby-btn").addEventListener("click", ()=>{ backToLobby(); closePanel(); });
$("#scr-stop").addEventListener("click", confirmStop);
$("#scr-rename").addEventListener("click", openRename);
$("#scr-code-eye").addEventListener("click", ()=>{ codeVisible = !codeVisible; renderPanel(); });
$("#scr-code-copy").addEventListener("click", async e=>{
  try{ await navigator.clipboard.writeText(state.share_code || ""); }catch(err){}
  const i = e.currentTarget.querySelector("i");
  i.className = "bi bi-check2"; setTimeout(()=>{ i.className = "bi bi-copy"; }, 1200);
});
$("#scr-code-rotate").addEventListener("click", async ()=>{
  const r = await post(CFG.rotateUrl, {});
  if(r.ok){ codeVisible = true; toast({kicker:"New share code", title:groupCode(r.data.share_code), who:"Decks already shared stay in the queue"}); }
});
$("#scr-showcode").addEventListener("click", ()=>post(CFG.settingsUrl, {show_code: !state.show_code}));
$("#scr-quiet").addEventListener("click", ()=>{
  quiet = !quiet;
  try{ localStorage.setItem("hanns_screen_quiet", quiet ? "1" : "0"); }catch(e){}
  renderPanel();
});

function tickClock(){
  const d = new Date();
  $("#scr-clock").textContent = d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}
setInterval(tickClock, 15000); tickClock();

/* ── apply a snapshot ─────────────────────────────────────────────── */
let firstApplied = false;
function apply(next, notice){
  if(!next) return;
  if(next.active === false){ state = next; showStopped(); return; }
  // Drop cached thumbnails for decks that have left the queue.
  const ids = new Set((next.shares||[]).map(s=>s.id));
  for(const id of [...thumbCache.keys()]) if(!ids.has(id)) thumbCache.delete(id);
  for(const id of [...unseen]) if(!ids.has(id)) unseen.delete(id);
  // Decks that turned up while we were disconnected still get flagged.
  for(const s of next.shares||[]){
    if(!seenShares.has(s.id)){
      seenShares.add(s.id);
      if(firstApplied && s.status === "waiting" && !(notice && notice.share === s.id)) unseen.add(s.id);
    }
  }
  state = next;
  renderLobby();
  if(body.classList.contains("scr-panel-open")) renderPanel();
  syncFrame();
  updateBadge();
  if(notice) handleNotice(notice);
}

/* ── realtime ─────────────────────────────────────────────────────── */
const HB_MS = 20000, STALE_MS = 50000;
const Live = {
  sock:null, gen:0, retry:0, timer:null, lastRx:0, closed:false,
  start(){
    if(this.closed) return;
    const gen = ++this.gen;
    const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + CFG.wsPath;
    let s;
    try{ s = new WebSocket(url); }catch(e){ this.again(gen); return; }
    this.sock = s;
    s.addEventListener("open", ()=>{
      if(gen !== this.gen) return;
      this.retry = 0; this.lastRx = Date.now(); setConn(true);
      clearInterval(this.timer);
      this.timer = setInterval(()=>{
        if(!this.sock || this.sock.readyState !== 1) return;
        if(Date.now() - this.lastRx > STALE_MS){ this.revive(); return; }
        try{ this.sock.send(JSON.stringify({type:"ping"})); }catch(e){ this.revive(); }
      }, HB_MS);
    });
    s.addEventListener("message", ev=>{
      if(gen !== this.gen) return;
      this.lastRx = Date.now();
      let m; try{ m = JSON.parse(ev.data); }catch(e){ return; }
      if(m.type === "ping"){ try{ s.send(JSON.stringify({type:"pong"})); }catch(e){} return; }
      if(m.type === "screen_state") apply(m.state, m.notice);
      else if(m.type === "screen_stopped") showStopped();
    });
    s.addEventListener("close", ()=>{
      if(gen !== this.gen) return;
      clearInterval(this.timer); setConn(false);
      this.again(gen);
    });
    s.addEventListener("error", ()=>{ try{ s.close(); }catch(e){} });
  },
  again(gen){
    if(this.closed || gen !== this.gen) return;
    this.retry++;
    setTimeout(()=>this.start(), Math.min(1000 * this.retry, 15000));
  },
  revive(){ clearInterval(this.timer); const d = this.sock; this.sock = null; try{ d && d.close(); }catch(e){} this.start(); },
  healthy(){ return !!this.sock && this.sock.readyState === 1 && Date.now() - this.lastRx < STALE_MS; },
  stop(){ this.closed = true; this.gen++; clearInterval(this.timer); try{ this.sock && this.sock.close(); }catch(e){} },
};
function setConn(ok){
  const c = $("#scr-conn");
  c.classList.toggle("bad", !ok);
  c.title = ok ? "Connected" : "Reconnecting…";
  $("#scr-live-dot").classList.toggle("off", !ok);
}
["online","focus"].forEach(ev=>window.addEventListener(ev, ()=>{ if(!Live.closed && !Live.healthy()) Live.revive(); }));

// Backstop poll: slow when the socket is healthy, the only source when not.
setInterval(async ()=>{
  if(stoppedShown || Live.healthy()) return;
  try{
    const r = await fetch(CFG.stateUrl, {credentials:"same-origin"});
    if(r.ok){ const j = await r.json(); apply(j.state); }
  }catch(e){}
}, 8000);

/* ── boot ─────────────────────────────────────────────────────────── */
if(state.active === false){
  stoppedShown = true;
}else{
  (state.shares||[]).forEach(s=>seenShares.add(s.id));
  apply(state);
  firstApplied = true;
  Live.start();
  keepAwake();
  wake();
}
})();
