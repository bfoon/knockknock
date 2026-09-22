/* ═══════════════════════════════════════════════════════════════════
   HANNS · BIG SCREEN EXTRAS

   Big screen behavior:
   1) Keep the projector slide clean
      - page number / slide HUD appears briefly, then hides
      - reaction stack appears briefly, then hides
   2) Hide the audience react QR card by default
      - show only a subtle transparent arrow
      - clicking the arrow reveals the react QR card for a few seconds
      - then it hides again automatically
   3) Presenter phone-controller QR card stays on the lobby only
      - never on top of a live slide
      - it auto-hides after a few seconds

   This file enhances only the Big Screen shell / embedded frame.
   ═══════════════════════════════════════════════════════════════════ */
(function(){
"use strict";

const $ = (s, root=document)=>root.querySelector(s);
const CFG = (()=>{
  try{
    const el = $("#scr-cfg");
    return el ? JSON.parse(el.textContent || "{}") : {};
  }catch(e){
    return {};
  }
})();

const CONTROLLER_LOBBY_SHOW_MS = 6000;
const REACT_BADGE_SHOW_MS = 6000;

let currentRoomFrame = null;
let controllerLobbyVisible = false;
let controllerLobbyTimer = 0;
let controllerLobbyData = {
  title:"",
  sharer:"",
  code:"",
  entryUrl:"",
};

/* ──────────────────────────────────────────────────────────────────
   CSS for Big Screen shell additions.
   ────────────────────────────────────────────────────────────────── */
function installShellStyles(){
  if($("#hanns-screen-extras-style")) return;

  const style = document.createElement("style");
  style.id = "hanns-screen-extras-style";
  style.textContent = `
    .scr-controller-lobby-extra{
      position:relative;
      display:flex;
      align-items:center;
      justify-content:center;
      gap:1.35rem;
      width:min(760px,92vw);
      margin:1.1rem auto 1rem;
      padding:1rem 1.2rem;
      border-radius:18px;
      text-align:left;
      background:rgba(10,8,18,.84);
      border:1px solid rgba(139,92,246,.38);
      box-shadow:0 20px 60px rgba(0,0,0,.36);
      backdrop-filter:blur(16px);
      -webkit-backdrop-filter:blur(16px);
      animation:scrLobbyCardIn .26s ease;
    }
    .scr-controller-lobby-extra[hidden]{display:none!important}
    @keyframes scrLobbyCardIn{
      from{opacity:0;transform:translateY(8px) scale(.985)}
      to{opacity:1;transform:none}
    }

    .scr-controller-lobby-extra .copy{min-width:0;flex:1}
    .scr-controller-lobby-extra .eyebrow{
      display:block;
      margin-bottom:.28rem;
      font:700 .58rem/1 var(--scr-mono);
      letter-spacing:.18em;
      text-transform:uppercase;
      color:var(--scr-cyan);
    }
    .scr-controller-lobby-extra h2{
      margin:.15rem 0 .2rem;
      font:600 clamp(1.1rem,2vw,1.55rem)/1.2 var(--scr-display);
      overflow-wrap:anywhere;
    }
    .scr-controller-lobby-extra p{
      margin:0 0 .7rem;
      color:var(--scr-dim);
      font-size:.88rem;
    }
    .scr-controller-lobby-extra small{
      display:block;
      margin-top:.5rem;
      color:var(--scr-dim);
      font-size:.76rem;
      line-height:1.45;
    }
    .scr-controller-lobby-code-extra{
      display:inline-block;
      padding:.55rem .8rem;
      border-radius:10px;
      background:rgba(255,255,255,.07);
      border:1px solid var(--scr-line-2);
      font:700 clamp(1.25rem,2.8vw,2rem)/1 var(--scr-mono);
      letter-spacing:.16em;
      color:#fff;
    }
    .scr-controller-lobby-qr-extra{
      flex:0 0 auto;
      background:#fff;
      padding:9px;
      border-radius:14px;
      line-height:0;
      box-shadow:0 12px 28px rgba(0,0,0,.22);
    }
    .scr-controller-lobby-qr-extra img,
    .scr-controller-lobby-qr-extra canvas{
      display:block;
      width:154px;
      height:154px;
    }
    .scr-controller-lobby-close-extra{
      position:absolute;
      right:8px;
      top:8px;
      width:32px;
      height:32px;
      border-radius:50%;
      display:grid;
      place-items:center;
      background:rgba(255,255,255,.06);
      border:1px solid var(--scr-line);
      color:var(--scr-dim);
      cursor:pointer;
    }
    .scr-controller-lobby-close-extra:hover{
      color:#fff;
      background:rgba(255,255,255,.12);
    }
    .scr-controller-lobby-note-extra{
      margin:.7rem 0 0;
      color:#a9a6c2;
      font-size:.78rem;
      line-height:1.45;
    }

    @media (max-width:700px){
      .scr-controller-lobby-extra{
        flex-direction:column;
        text-align:center;
      }
      .scr-controller-lobby-extra .copy{
        text-align:center;
      }
    }
  `;
  document.head.appendChild(style);
}

/* ──────────────────────────────────────────────────────────────────
   Current Big Screen iframe helpers.
   ────────────────────────────────────────────────────────────────── */
function visibleRoomFrame(){
  return $("#scr-stage .scr-frame.on") || $("#scr-stage .scr-frame");
}

function isLobbyVisible(){
  const lobby = $("#scr-lobby");
  return !!lobby && !lobby.classList.contains("off");
}

function groupedCode(value){
  const code = String(value || "").replace(/\s+/g, "");
  return code.length === 6 ? code.slice(0,3) + " " + code.slice(3) : code;
}

/* ──────────────────────────────────────────────────────────────────
   CLEAN PROJECTOR HUD + REACT BADGE ARROW
   Injected only into the embedded presentation iframe used by Big Screen.
   ────────────────────────────────────────────────────────────────── */
function installCleanHud(frame){
  if(!frame) return;

  let doc;
  try{ doc = frame.contentDocument; }catch(e){ return; }

  if(!doc || !doc.head || !doc.body){
    setTimeout(()=>installCleanHud(frame), 80);
    return;
  }

  const styleId = "hanns-bigscreen-room-clean";
  if(!doc.getElementById(styleId)){
    const style = doc.createElement("style");
    style.id = styleId;
    style.textContent = `
      /* Slide/page HUD appears briefly, then hides */
      body.hanns-embed .present-controls,
      body.hanns-embed .reaction-top-stack{
        opacity:0!important;
        pointer-events:none!important;
        transition:opacity .32s ease,transform .32s ease!important;
      }
      body.hanns-embed .present-controls{
        transform:translateY(8px)!important;
      }
      body.hanns-embed .reaction-top-stack{
        transform:translateY(-8px)!important;
      }
      body.hanns-embed .present-controls button{
        display:none!important;
      }
      body.hanns-embed.hanns-room-hud .present-controls,
      body.hanns-embed.hanns-room-hud .reaction-top-stack{
        opacity:1!important;
        transform:none!important;
      }

      /* React QR card: hidden by default, shown only when explicitly opened */
      body.hanns-embed .present-badge{
        opacity:0!important;
        pointer-events:none!important;
        transform:translateY(8px)!important;
        transition:opacity .24s ease,transform .24s ease!important;
      }
      body.hanns-embed.hanns-room-badge-open .present-badge{
        opacity:1!important;
        pointer-events:auto!important;
        transform:none!important;
      }

      /* Small transparent reveal arrow */
      #hanns-react-reveal{
        position:fixed;
        right:16px;
        bottom:18px;
        width:38px;
        height:38px;
        border-radius:999px;
        display:grid;
        place-items:center;
        background:rgba(7,9,20,.12);
        border:1px solid rgba(255,255,255,.14);
        color:rgba(255,255,255,.58);
        backdrop-filter:blur(8px);
        -webkit-backdrop-filter:blur(8px);
        box-shadow:0 8px 22px rgba(0,0,0,.18);
        z-index:9998;
        cursor:pointer;
        user-select:none;
        transition:background .2s ease,color .2s ease,opacity .2s ease,transform .2s ease;
      }
      #hanns-react-reveal:hover{
        background:rgba(7,9,20,.22);
        color:rgba(255,255,255,.9);
      }
      #hanns-react-reveal svg{
        display:block;
        width:16px;
        height:16px;
      }
      body.hanns-embed.hanns-room-badge-open #hanns-react-reveal{
        opacity:.75;
        transform:translateX(-2px);
      }
    `;
    doc.head.appendChild(style);
  }

  if(!doc.getElementById("hanns-react-reveal")){
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.id = "hanns-react-reveal";
    btn.setAttribute("aria-label", "Show react QR");
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
           aria-hidden="true">
        <path d="M9 6l6 6-6 6"/>
      </svg>
    `;
    btn.addEventListener("click", ()=>{
      showReactBadge(frame, REACT_BADGE_SHOW_MS);
    });
    doc.body.appendChild(btn);
  }

  if(frame.__hannsCleanHudInstalled) return;
  frame.__hannsCleanHudInstalled = true;

  function flash(ms){
    let body;
    try{
      body = frame.contentDocument && frame.contentDocument.body;
    }catch(e){
      return;
    }
    if(!body) return;

    body.classList.add("hanns-room-hud");
    clearTimeout(frame.__hannsCleanHudTimer);
    frame.__hannsCleanHudTimer = setTimeout(()=>{
      try{
        const b = frame.contentDocument && frame.contentDocument.body;
        if(b) b.classList.remove("hanns-room-hud");
      }catch(e){}
    }, Number(ms) || 2800);
  }

  frame.__hannsFlashRoomHud = flash;

  const reaction = doc.getElementById("reaction-counter");
  if(reaction && window.MutationObserver){
    const reactionObserver = new MutationObserver(()=>flash(1800));
    reactionObserver.observe(reaction,{childList:true,subtree:true,characterData:true});
    frame.__hannsReactionObserver = reactionObserver;
  }

  /* Do not auto-show the react QR card anymore. Only the arrow reveals it. */
  flash(3000);
}

function showReactBadge(frame, ms){
  if(!frame) return;

  let body;
  try{
    body = frame.contentDocument && frame.contentDocument.body;
  }catch(e){
    return;
  }
  if(!body) return;

  body.classList.add("hanns-room-badge-open");
  clearTimeout(frame.__hannsBadgeTimer);
  frame.__hannsBadgeTimer = setTimeout(()=>{
    try{
      const b = frame.contentDocument && frame.contentDocument.body;
      if(b) b.classList.remove("hanns-room-badge-open");
    }catch(e){}
  }, Number(ms) || REACT_BADGE_SHOW_MS);
}

function prepareCurrentRoomFrame(){
  const frame = visibleRoomFrame();
  if(!frame || frame === currentRoomFrame) return;
  currentRoomFrame = frame;

  if(frame.contentDocument && frame.contentDocument.readyState === "complete"){
    installCleanHud(frame);
  }else{
    frame.addEventListener("load",()=>installCleanHud(frame),{once:true});
  }
}

/* ──────────────────────────────────────────────────────────────────
   PRESENTER CONTROLLER QR ON LOBBY
   Shown only on the lobby and auto-hidden after a few seconds.
   ────────────────────────────────────────────────────────────────── */
function ensureControllerLobbyCard(){
  const lobby = $("#scr-lobby .scr-lobby-card");
  if(!lobby) return null;

  let card = $("#scr-controller-lobby-extra");
  if(card) return card;

  card = document.createElement("section");
  card.id = "scr-controller-lobby-extra";
  card.className = "scr-controller-lobby-extra";
  card.hidden = true;
  card.innerHTML = `
    <button class="scr-controller-lobby-close-extra" type="button"
            title="Hide controller QR" aria-label="Hide controller QR">
      <i class="bi bi-x-lg"></i>
    </button>
    <div class="copy">
      <span class="eyebrow">Presenter phone controller</span>
      <h2 id="scr-controller-lobby-title-extra">Phone controller</h2>
      <p id="scr-controller-lobby-who-extra"></p>
      <div class="scr-controller-lobby-code-extra" id="scr-controller-lobby-code-extra"></div>
      <small>Scan this QR, then enter the six-digit code on the phone.</small>
      <div class="scr-controller-lobby-note-extra">
        This card auto-hides after a few seconds and is shown only on the lobby,
        never on top of a live slide.
      </div>
    </div>
    <div class="scr-controller-lobby-qr-extra" id="scr-controller-lobby-qr-extra"></div>
  `;

  const fullScreenButton = $("#scr-go-fs");
  lobby.insertBefore(card, fullScreenButton || null);

  card.querySelector(".scr-controller-lobby-close-extra")
    .addEventListener("click", hideControllerLobby);

  return card;
}

function scheduleControllerLobbyHide(){
  clearTimeout(controllerLobbyTimer);
  controllerLobbyTimer = setTimeout(()=>{
    hideControllerLobby();
  }, CONTROLLER_LOBBY_SHOW_MS);
}

function drawControllerLobby(){
  const card = ensureControllerLobbyCard();
  if(!card) return;

  card.hidden = !controllerLobbyVisible || !isLobbyVisible();
  if(card.hidden) return;

  $("#scr-controller-lobby-title-extra").textContent =
    controllerLobbyData.title || "Phone controller";
  $("#scr-controller-lobby-who-extra").textContent =
    controllerLobbyData.sharer
      ? "For " + controllerLobbyData.sharer
      : "For the presenter";
  $("#scr-controller-lobby-code-extra").textContent =
    groupedCode(controllerLobbyData.code);

  const qr = $("#scr-controller-lobby-qr-extra");
  if(qr && qr.dataset.url !== controllerLobbyData.entryUrl){
    qr.dataset.url = controllerLobbyData.entryUrl || "";
    qr.innerHTML = "";
    try{
      if(window.QRCode && controllerLobbyData.entryUrl){
        new QRCode(qr,{
          text:controllerLobbyData.entryUrl,
          width:154,
          height:154,
          colorDark:"#111827",
          colorLight:"#ffffff",
          correctLevel:QRCode.CorrectLevel.M,
        });
      }
    }catch(e){
      qr.innerHTML = "";
    }
  }

  scheduleControllerLobbyHide();
}

function hideControllerLobby(){
  controllerLobbyVisible = false;
  clearTimeout(controllerLobbyTimer);
  const card = $("#scr-controller-lobby-extra");
  if(card) card.hidden = true;
}

function showControllerLobby(data){
  controllerLobbyData = Object.assign(
    {title:"",sharer:"",code:"",entryUrl:""},
    data || {}
  );
  controllerLobbyVisible = true;

  const lobbyButton = $("#scr-lobby-btn");
  if(!isLobbyVisible() && lobbyButton && !lobbyButton.disabled){
    lobbyButton.click();
  }

  let tries = 0;
  const showWhenReady = ()=>{
    tries += 1;
    drawControllerLobby();
    if(!isLobbyVisible() && tries < 20){
      setTimeout(showWhenReady, 100);
    }
  };
  showWhenReady();
}

function codeFromControlDialog(dialog){
  const spans = dialog.querySelectorAll("#dlg-code span");
  return Array.from(spans).map(el=>(el.textContent || "").trim()).join("");
}

function detailsFromControlDialog(dialog){
  const title = (dialog.querySelector("h2")?.textContent || "Phone controller").trim();
  const sharer = (dialog.querySelector("p b")?.textContent || "").trim();
  const code = codeFromControlDialog(dialog);
  const entryUrl = CFG.controlEntryUrl || "";
  return {title, sharer, code, entryUrl};
}

function enhanceControlDialog(){
  const dialog = $("#scr-dialogs .scr-dlg-card");
  if(!dialog || dialog.dataset.lobbyQrEnhanced === "1") return;
  if(!dialog.querySelector("#dlg-code") || !dialog.querySelector("#dlg-qr")) return;

  dialog.dataset.lobbyQrEnhanced = "1";
  const actions = dialog.querySelector(".scr-dlg-act");
  if(!actions) return;

  const show = document.createElement("button");
  show.type = "button";
  show.className = "scr-btn";
  show.innerHTML = '<i class="bi bi-qr-code"></i> Show on lobby';
  show.addEventListener("click", ()=>{
    const data = detailsFromControlDialog(dialog);
    const close = dialog.querySelector("[data-x]");
    if(close) close.click();
    showControllerLobby(data);
  });

  const hide = document.createElement("button");
  hide.type = "button";
  hide.className = "scr-btn";
  hide.innerHTML = '<i class="bi bi-eye-slash"></i> Hide from lobby';
  hide.addEventListener("click", ()=>{
    hideControllerLobby();
    const close = dialog.querySelector("[data-x]");
    if(close) close.click();
  });

  const done = actions.querySelector("[data-x]");
  if(done){
    actions.insertBefore(show, done);
    actions.insertBefore(hide, done);
  }else{
    actions.append(show, hide);
  }
}

/* ──────────────────────────────────────────────────────────────────
   OBSERVERS
   ────────────────────────────────────────────────────────────────── */
const stage = $("#scr-stage");
if(stage && window.MutationObserver){
  new MutationObserver(()=>{
    prepareCurrentRoomFrame();
    if(!isLobbyVisible()){
      const card = $("#scr-controller-lobby-extra");
      if(card) card.hidden = true;
    }
  }).observe(stage,{childList:true,subtree:false,attributes:true,attributeFilter:["class"]});
}

const lobby = $("#scr-lobby");
if(lobby && window.MutationObserver){
  new MutationObserver(()=>{
    if(!isLobbyVisible()){
      const card = $("#scr-controller-lobby-extra");
      if(card) card.hidden = true;
    }else{
      drawControllerLobby();
    }
  }).observe(lobby,{attributes:true,attributeFilter:["class"]});
}

const dialogs = $("#scr-dialogs");
if(dialogs && window.MutationObserver){
  new MutationObserver(()=>enhanceControlDialog())
    .observe(dialogs,{childList:true,subtree:true});
}

/* ──────────────────────────────────────────────────────────────────
   BOOT
   ────────────────────────────────────────────────────────────────── */
function boot(){
  installShellStyles();
  ensureControllerLobbyCard();
  prepareCurrentRoomFrame();
  enhanceControlDialog();
  drawControllerLobby();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", boot, {once:true});
}else{
  boot();
}

})();
