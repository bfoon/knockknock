/* HANNS — presenter stage with full-screen mode, screen wake lock, audience QR,
   phone-controller QR, live slide sync, and animated pointer support. */
(function(){
"use strict";
const Hx = window.Hanns || {};
const {paintSlide, clamp, W = 960, H = 540} = Hx;
const CFG = window.__HANNS_PRESENT__ || {};
const DECK = CFG.deck || {slides:[], code:"------", title:"Untitled"};
const $ = (s)=>document.querySelector(s);
const pCanvas = $("#present-canvas");
const emojiLayer = $("#emoji-layer");
const reactionCounter = $("#reaction-counter");
let pointerLayer = $("#pointer-layer");
if(!pointerLayer){
  pointerLayer = document.createElement("div");
  pointerLayer.id = "pointer-layer";
  pointerLayer.className = "pointer-layer";
  document.body.appendChild(pointerLayer);
}
let i = DECK.current_slide || 0;
let suppressBroadcast = false;
let wakeLock = null;
let wakeWanted = true;
let wakeRetryTimer = null;
const localReactionCounts = {};
function normalizeReactionCounts(counts){
  if(!counts)return {};
  if(Array.isArray(counts)){
    return counts.reduce((acc,row)=>{
      const emoji = row && (row.emoji || row.name || row.key);
      const n = Number(row && (row.count || row.total || row.value));
      if(emoji && Number.isFinite(n) && n > 0)acc[emoji]=n;
      return acc;
    },{});
  }
  if(typeof counts === "object"){
    return Object.keys(counts).reduce((acc,k)=>{
      const n = Number(counts[k]);
      if(k && Number.isFinite(n) && n > 0)acc[k]=n;
      return acc;
    },{});
  }
  return {};
}
function renderReactionCounts(counts){
  if(!reactionCounter)return;
  const clean = normalizeReactionCounts(counts);
  Object.keys(clean).forEach(k=>{ localReactionCounts[k] = clean[k]; });
  const rows = Object.entries(localReactionCounts)
    .filter(([,n])=>Number(n)>0)
    .sort((a,b)=>b[1]-a[1]);
  reactionCounter.innerHTML = "";
  reactionCounter.classList.toggle("has-counts", rows.length > 0);
  if(!rows.length)return;
  rows.slice(0,12).forEach(([emoji,count])=>{
    const chip = document.createElement("span");
    chip.className = "reaction-count-chip";
    chip.innerHTML = `<span class="reaction-count-emoji">${emoji}</span><b>${count}</b>`;
    reactionCounter.appendChild(chip);
  });
}
function incrementReactionCount(emoji){
  if(!emoji)return;
  localReactionCounts[emoji] = Number(localReactionCounts[emoji] || 0) + 1;
  renderReactionCounts(localReactionCounts);
}

function fit(){
  if(!pCanvas)return;
  const z=Math.min(window.innerWidth/W, window.innerHeight/H);
  pCanvas.style.width=W+"px";pCanvas.style.height=H+"px";
  pCanvas.style.transform=`scale(${z})`;pCanvas.style.transformOrigin="center center";
}
function transition(node,kind){
  if(!node || !node.animate)return;
  const map={none:[{opacity:1}],fade:[{opacity:0},{opacity:1}],slide:[{transform:"translateX(60px)",opacity:0},{transform:"translateX(0)",opacity:1}],push:[{transform:"translateX(100%)"},{transform:"translateX(0)"}],zoom:[{transform:"scale(1.08)",opacity:0},{transform:"scale(1)",opacity:1}],flip:[{transform:"perspective(1200px) rotateY(12deg)",opacity:0},{transform:"perspective(1200px) rotateY(0)",opacity:1}],reveal:[{clipPath:"inset(0 0 100% 0)"},{clipPath:"inset(0 0 0 0)"}]};
  node.animate(map[kind]||map.fade,{duration:480,easing:"cubic-bezier(.22,1,.36,1)",fill:"both"});
}
function show(n,broadcast=true){
  if(!DECK.slides.length || !paintSlide || !pCanvas)return;
  keepScreenAwake("slide-change");
  i=(clamp?clamp(n,0,DECK.slides.length-1):Math.max(0,Math.min(DECK.slides.length-1,n)));
  const s=DECK.slides[i];
  paintSlide(pCanvas,s,{live:true});transition(pCanvas,(s&&s.transition)||"fade");
  const pos=$("#pp-pos");if(pos)pos.textContent=`${i+1} / ${DECK.slides.length}`;
  if(broadcast&&!suppressBroadcast)Live.goto(i);
}
function spawnEmoji(em){
  if(!emojiLayer)return;
  keepScreenAwake("reaction");
  const e=document.createElement("div");e.className="emoji-fly";e.textContent=em;
  e.style.left=(8+Math.random()*84)+"%";e.style.setProperty("--spin",(Math.random()*40-20)+"deg");e.style.fontSize=(2+Math.random()*1.6)+"rem";
  emojiLayer.appendChild(e);setTimeout(()=>e.remove(),3700);
}
function showPointer(x,y){
  keepScreenAwake("controller-pointer");
  if(!pCanvas || !pointerLayer)return;
  const rect = pCanvas.getBoundingClientRect();
  const px = rect.left + (Number(x)||0) / W * rect.width;
  const py = rect.top + (Number(y)||0) / H * rect.height;
  const mark=document.createElement("div");
  mark.className="presenter-pointer";
  mark.style.left=px+"px";
  mark.style.top=py+"px";
  pointerLayer.appendChild(mark);
  setTimeout(()=>mark.remove(),3100);
}

function setWakeStatus(status, detail=""){
  const pill=$("#wake-pill");
  if(!pill)return;
  pill.dataset.status=status;
  if(status==="on")pill.textContent="☀ Screen awake";
  else if(status==="unsupported")pill.textContent="⚠ Wake lock unsupported";
  else if(status==="blocked")pill.textContent="⚠ Click Full screen to keep awake";
  else pill.textContent="☀ Keep screen awake";
  if(detail)pill.title=detail;
}
async function keepScreenAwake(reason="presenting"){
  wakeWanted = true;
  if(!("wakeLock" in navigator)){
    setWakeStatus("unsupported","Your browser does not support Screen Wake Lock. Use Chrome/Edge over HTTPS, or adjust your computer sleep settings.");
    return false;
  }
  if(document.visibilityState !== "visible")return false;
  if(wakeLock)return true;
  try{
    wakeLock = await navigator.wakeLock.request("screen");
    setWakeStatus("on",`Screen Wake Lock active: ${reason}`);
    wakeLock.addEventListener("release",()=>{
      wakeLock = null;
      if(wakeWanted && document.visibilityState === "visible"){
        clearTimeout(wakeRetryTimer);
        wakeRetryTimer = setTimeout(()=>keepScreenAwake("re-acquire"), 600);
      }
    });
    return true;
  }catch(err){
    wakeLock = null;
    setWakeStatus("blocked", err && err.message ? err.message : "Wake lock was blocked. Click Full screen or click on the presentation once.");
    return false;
  }
}
async function releaseWakeLock(){
  wakeWanted = false;
  clearTimeout(wakeRetryTimer);
  if(wakeLock){
    try{ await wakeLock.release(); }catch(e){}
    wakeLock = null;
  }
  setWakeStatus("off");
}

async function toggleFullscreen(){
  keepScreenAwake("fullscreen-button");
  const root = $("#present") || document.documentElement;
  try{
    if(!document.fullscreenElement){
      if(root.requestFullscreen) await root.requestFullscreen({navigationUI:"hide"});
    }else if(document.exitFullscreen){
      await document.exitFullscreen();
    }
  }catch(e){
    // Some browsers only allow full-screen from a direct click. Keep the UI usable.
  }finally{
    updateFullscreenButton();
    setTimeout(()=>keepScreenAwake("fullscreen-change"), 200);
    fit();
  }
}
function updateFullscreenButton(){
  const b=$("#present-fullscreen");
  if(!b)return;
  b.textContent = document.fullscreenElement ? "⛶ Exit full screen" : "⛶ Full screen";
  b.title = document.fullscreenElement ? "Exit full screen (press F)" : "Full screen (press F)";
}

document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState === "visible") keepScreenAwake("visible-again");
});
document.addEventListener("fullscreenchange",()=>{updateFullscreenButton();fit();keepScreenAwake("fullscreenchange");});

const Live={sock:null,retry:0,start(){if(!CFG.wsUrl)return;try{this.sock=new WebSocket(CFG.wsUrl);}catch(e){return;}this.sock.addEventListener("open",()=>{this.retry=0;this.send({type:"presenter_hello"});keepScreenAwake("websocket-open");});this.sock.addEventListener("message",ev=>{let m;try{m=JSON.parse(ev.data);}catch(e){return;}if(m.type==="reaction"){spawnEmoji(m.emoji);if(m.reaction_counts)renderReactionCounts(m.reaction_counts);else incrementReactionCount(m.emoji);}else if(m.type==="participants")setCount(m.count);else if(m.type==="state"){if(typeof m.count==="number")setCount(m.count);if(m.reaction_counts)renderReactionCounts(m.reaction_counts);}else if(m.type==="goto"&&typeof m.index==="number"){keepScreenAwake("phone-controller");if(m.index!==i){suppressBroadcast=true;show(m.index,false);suppressBroadcast=false;}}else if(m.type==="pointer"){showPointer(m.x,m.y);}});this.sock.addEventListener("close",()=>{if(this.retry++>6)return;setTimeout(()=>this.start(),Math.min(800*this.retry,5000));});},send(o){if(this.sock&&this.sock.readyState===1)this.sock.send(JSON.stringify(o));},goto(idx){this.send({type:"goto",index:idx});},stop(){if(this.sock){try{this.sock.close();}catch(e){}}this.sock=null;}};
function setCount(n){const el=$("#aud-count");if(el)el.textContent=n;}

/* Click an actor on the live stage to play its action once. If a phone
   controller / audience trigger arrives over the socket (Pass 2), the same
   playActorOnce path is reused. */
function actorActionFor(node){
  const AC=window.HannsActors;if(!AC)return "idle";
  const kind=node.dataset.kind;
  const acts=(AC.ACTOR_ACTIONS[kind]||["idle"]);
  const chosen=node.dataset.action && node.dataset.action!=="idle"
    ? node.dataset.action
    : (acts.filter(a=>a!=="idle")[0]||"idle");
  return chosen;
}
function wireActorClicks(){
  if(!pCanvas)return;
  pCanvas.addEventListener("click",(ev)=>{
    const node=ev.target.closest && ev.target.closest(".actor");
    if(!node)return;
    const AC=window.HannsActors;if(!AC)return;
    AC.playActorOnce(node, actorActionFor(node), 1500);
  });
}
function makeQR(box,text,size=180){if(!box||typeof QRCode==="undefined"||!text)return;box.innerHTML="";new QRCode(box,{text:text,width:size,height:size,colorDark:"#111827",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.H});}
function drawQRs(){makeQR($("#present-qr"),CFG.joinUrl,84);makeQR($("#qr-modal-code"),CFG.joinUrl,220);makeQR($("#controller-modal-qr"),CFG.controlUrl+(CFG.controlPin?`?pin=${encodeURIComponent(CFG.controlPin)}`:""),220);}
function openModal(id){const m=$(id);if(m)m.classList.add("on");keepScreenAwake("modal-open");}
function closeModals(){document.querySelectorAll(".present-modal").forEach(m=>m.classList.remove("on"));keepScreenAwake("modal-close");}
function ensureControllerQrFallback(){
  const ctrl = $("#controller-modal-qr");
  if(ctrl && !ctrl.querySelector("img") && !ctrl.querySelector("canvas")){
    ctrl.innerHTML = `<div style="font:800 13px Arial;color:#111827;line-height:1.45;padding:10px;word-break:break-word">Open on phone:<br>${(CFG.controlUrl||"").replace(/^https?:\/\//,"")}<br><br>PIN: ${CFG.controlPin||"----"}</div>`;
  }
  const join = $("#qr-modal-code");
  if(join && !join.querySelector("img") && !join.querySelector("canvas")){
    join.innerHTML = `<div style="font:800 13px Arial;color:#111827;line-height:1.45;padding:10px;word-break:break-word">Open:<br>${(CFG.joinUrl||"").replace(/^https?:\/\//,"")}</div>`;
  }
}
function qrImageFrom(box){const img=box&&box.querySelector("img");if(img)return img.src;const canvas=box&&box.querySelector("canvas");return canvas?canvas.toDataURL("image/png"):"";}
function downloadQR(){
  keepScreenAwake("download-qr");
  const src=qrImageFrom($("#qr-modal-code"));if(!src)return;
  const c=document.createElement("canvas");c.width=900;c.height=1150;const ctx=c.getContext("2d");
  ctx.fillStyle="#f8fafc";ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle="#111827";ctx.font="800 46px Arial";ctx.textAlign="center";ctx.fillText(DECK.title||"Hanns presentation",450,105);ctx.fillStyle="#64748b";ctx.font="700 24px Arial";ctx.fillText("Scan to join and react",450,155);
  const img=new Image();img.onload=()=>{ctx.fillStyle="#ffffff";roundRect(ctx,170,220,560,560,42);ctx.fill();ctx.drawImage(img,220,270,460,460);ctx.fillStyle="#111827";ctx.font="900 54px Arial";ctx.fillText(DECK.code||"",450,870);ctx.fillStyle="#64748b";ctx.font="22px Arial";ctx.fillText((CFG.joinUrl||"").replace(/^https?:\/\//,""),450,925);const a=document.createElement("a");a.download=(DECK.title||"hanns_qr").replace(/\s+/g,"_")+"_qr.png";a.href=c.toDataURL("image/png");a.click();};img.src=src;
}
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
async function endPresent(){Live.stop();await releaseWakeLock();if(CFG.stateUrl){try{await fetch(CFG.stateUrl,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","X-CSRFToken":CFG.csrftoken||""},body:"state=ended"});}catch(e){}}if(CFG.editUrl)window.location.href=CFG.editUrl;}
function init(){
  const controllerPillVisiblePatch = $("#open-controller");
  if(controllerPillVisiblePatch){controllerPillVisiblePatch.style.display="inline-flex";controllerPillVisiblePatch.style.alignItems="center";controllerPillVisiblePatch.style.gap=".4rem";}
  const code=$("#present-code");if(code)code.textContent=DECK.code;
  const url=$("#present-url");if(url)url.textContent=(CFG.joinUrl||"").replace(/^https?:\/\//,"");
  const qTitle=$("#qr-modal-title");if(qTitle)qTitle.textContent=DECK.title||"Hanns presentation";
  const cTitle=$("#controller-modal-title");if(cTitle)cTitle.textContent=DECK.title||"Hanns presentation";
  const cPin=$("#controller-pin");if(cPin)cPin.textContent=CFG.controlPin||"----";
  const cUrl=$("#controller-url");if(cUrl)cUrl.textContent=(CFG.controlUrl||"").replace(/^https?:\/\//,"");
  drawQRs();ensureControllerQrFallback();renderReactionCounts(CFG.reactionCounts || DECK.reaction_counts || {});fit();show(i,false);wireActorClicks();Live.start();keepScreenAwake("presentation-start");
  $("#pp-prev")?.addEventListener("click",()=>show(i-1));
  $("#pp-next")?.addEventListener("click",()=>show(i+1));
  $("#present-exit")?.addEventListener("click",endPresent);
  $("#present-fullscreen")?.addEventListener("click",toggleFullscreen);
  $("#wake-pill")?.addEventListener("click",()=>keepScreenAwake("wake-pill-click"));
  $("#present-qr")?.addEventListener("click",()=>openModal("#qr-modal"));
  $("#open-controller")?.addEventListener("click",()=>openModal("#controller-modal"));
  $("#download-qr")?.addEventListener("click",downloadQR);
  document.querySelectorAll("[data-close-present-modal]").forEach(b=>b.addEventListener("click",closeModals));
  document.addEventListener("pointerdown",()=>keepScreenAwake("user-pointer"),{passive:true});
  window.addEventListener("resize",fit);
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(document.querySelector(".present-modal.on"))closeModals();else endPresent();}else if(e.key.toLowerCase()==="c")openModal("#controller-modal");else if(e.key.toLowerCase()==="f")toggleFullscreen();else if(e.key==="ArrowRight"||e.key===" ")show(i+1);else if(e.key==="ArrowLeft")show(i-1);});
  window.addEventListener("beforeunload",()=>{Live.stop();releaseWakeLock();});
  updateFullscreenButton();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
