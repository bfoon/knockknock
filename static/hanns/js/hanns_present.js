/* HANNS — presenter stage with audience QR, phone-controller QR, and live slide sync. */
(function(){
"use strict";
const Hx = window.Hanns;
const {paintSlide, clamp, W, H} = Hx;
const CFG = window.__HANNS_PRESENT__ || {};
const DECK = CFG.deck || {slides:[], code:"------", title:"Untitled"};
const $ = (s)=>document.querySelector(s);
const pCanvas = $("#present-canvas");
const emojiLayer = $("#emoji-layer");
let i = DECK.current_slide || 0;
let suppressBroadcast = false;

function fit(){
  const z=Math.min(window.innerWidth/W, window.innerHeight/H);
  pCanvas.style.width=W+"px";pCanvas.style.height=H+"px";
  pCanvas.style.transform=`scale(${z})`;pCanvas.style.transformOrigin="center center";
}
function transition(node,kind){
  const map={none:[{opacity:1}],fade:[{opacity:0},{opacity:1}],slide:[{transform:"translateX(60px)",opacity:0},{transform:"translateX(0)",opacity:1}],push:[{transform:"translateX(100%)"},{transform:"translateX(0)"}],zoom:[{transform:"scale(1.08)",opacity:0},{transform:"scale(1)",opacity:1}],flip:[{transform:"perspective(1200px) rotateY(12deg)",opacity:0},{transform:"perspective(1200px) rotateY(0)",opacity:1}],reveal:[{clipPath:"inset(0 0 100% 0)"},{clipPath:"inset(0 0 0 0)"}]};
  node.animate(map[kind]||map.fade,{duration:480,easing:"cubic-bezier(.22,1,.36,1)",fill:"both"});
}
function show(n,broadcast=true){
  if(!DECK.slides.length)return;
  i=clamp(n,0,DECK.slides.length-1);
  const s=DECK.slides[i];
  paintSlide(pCanvas,s,{live:true});transition(pCanvas,(s&&s.transition)||"fade");
  const pos=$("#pp-pos");if(pos)pos.textContent=`${i+1} / ${DECK.slides.length}`;
  if(broadcast&&!suppressBroadcast)Live.goto(i);
}
function spawnEmoji(em){
  const e=document.createElement("div");e.className="emoji-fly";e.textContent=em;
  e.style.left=(8+Math.random()*84)+"%";e.style.setProperty("--spin",(Math.random()*40-20)+"deg");e.style.fontSize=(2+Math.random()*1.6)+"rem";
  emojiLayer.appendChild(e);setTimeout(()=>e.remove(),3700);
}
const Live={sock:null,retry:0,start(){if(!CFG.wsUrl)return;try{this.sock=new WebSocket(CFG.wsUrl);}catch(e){return;}this.sock.addEventListener("open",()=>{this.retry=0;this.send({type:"presenter_hello"});});this.sock.addEventListener("message",ev=>{let m;try{m=JSON.parse(ev.data);}catch(e){return;}if(m.type==="reaction")spawnEmoji(m.emoji);else if(m.type==="participants")setCount(m.count);else if(m.type==="state"&&typeof m.count==="number")setCount(m.count);else if(m.type==="goto"&&typeof m.index==="number"&&m.index!==i){suppressBroadcast=true;show(m.index,false);suppressBroadcast=false;}});this.sock.addEventListener("close",()=>{if(this.retry++>6)return;setTimeout(()=>this.start(),Math.min(800*this.retry,5000));});},send(o){if(this.sock&&this.sock.readyState===1)this.sock.send(JSON.stringify(o));},goto(idx){this.send({type:"goto",index:idx});},stop(){if(this.sock){try{this.sock.close();}catch(e){}}this.sock=null;}};
function setCount(n){const el=$("#aud-count");if(el)el.textContent=n;}
function makeQR(box,text,size=180){if(!box||typeof QRCode==="undefined"||!text)return;box.innerHTML="";new QRCode(box,{text,width:size,height:size,colorDark:"#111827",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.H});}
function drawQRs(){makeQR($("#present-qr"),CFG.joinUrl,84);makeQR($("#qr-modal-code"),CFG.joinUrl,220);makeQR($("#controller-modal-qr"),CFG.controlUrl+(CFG.controlPin?`?pin=${encodeURIComponent(CFG.controlPin)}`:""),220);}
function openModal(id){const m=$(id);if(m)m.classList.add("on");}
function closeModals(){document.querySelectorAll(".present-modal").forEach(m=>m.classList.remove("on"));}

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
  const src=qrImageFrom($("#qr-modal-code"));if(!src)return;
  const c=document.createElement("canvas");c.width=900;c.height=1150;const ctx=c.getContext("2d");
  ctx.fillStyle="#f8fafc";ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle="#111827";ctx.font="800 46px Arial";ctx.textAlign="center";ctx.fillText(DECK.title||"Hanns presentation",450,105);ctx.fillStyle="#64748b";ctx.font="700 24px Arial";ctx.fillText("Scan to join and react",450,155);
  const img=new Image();img.onload=()=>{ctx.fillStyle="#ffffff";roundRect(ctx,170,220,560,560,42);ctx.fill();ctx.drawImage(img,220,270,460,460);ctx.fillStyle="#111827";ctx.font="900 54px Arial";ctx.fillText(DECK.code||"",450,870);ctx.fillStyle="#64748b";ctx.font="22px Arial";ctx.fillText((CFG.joinUrl||"").replace(/^https?:\/\//,""),450,925);const a=document.createElement("a");a.download=(DECK.title||"hanns_qr").replace(/\s+/g,"_")+"_qr.png";a.href=c.toDataURL("image/png");a.click();};img.src=src;
}
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
async function endPresent(){Live.stop();if(CFG.stateUrl){try{await fetch(CFG.stateUrl,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded","X-CSRFToken":CFG.csrftoken||""},body:"state=ended"});}catch(e){}}if(CFG.editUrl)window.location.href=CFG.editUrl;}
function init(){
  const controllerPillVisiblePatch = $("#open-controller");
  if(controllerPillVisiblePatch){controllerPillVisiblePatch.style.display="inline-flex";controllerPillVisiblePatch.style.alignItems="center";controllerPillVisiblePatch.style.gap=".4rem";}
  $("#present-code").textContent=DECK.code;$("#present-url").textContent=(CFG.joinUrl||"").replace(/^https?:\/\//,"");
  const qTitle=$("#qr-modal-title");if(qTitle)qTitle.textContent=DECK.title||"Hanns presentation";
  const cTitle=$("#controller-modal-title");if(cTitle)cTitle.textContent=DECK.title||"Hanns presentation";
  const cPin=$("#controller-pin");if(cPin)cPin.textContent=CFG.controlPin||"----";
  const cUrl=$("#controller-url");if(cUrl)cUrl.textContent=(CFG.controlUrl||"").replace(/^https?:\/\//,"");
  drawQRs();ensureControllerQrFallback();fit();show(i,false);Live.start();
  $("#pp-prev").addEventListener("click",()=>show(i-1));$("#pp-next").addEventListener("click",()=>show(i+1));$("#present-exit").addEventListener("click",endPresent);
  $("#present-qr")?.addEventListener("click",()=>openModal("#qr-modal"));$("#open-controller")?.addEventListener("click",()=>openModal("#controller-modal"));
  $("#download-qr")?.addEventListener("click",downloadQR);document.querySelectorAll("[data-close-present-modal]").forEach(b=>b.addEventListener("click",closeModals));
  window.addEventListener("resize",fit);document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(document.querySelector(".present-modal.on"))closeModals();else endPresent();}else if(e.key.toLowerCase()==="c")openModal("#controller-modal");else if(e.key==="ArrowRight"||e.key===" ")show(i+1);else if(e.key==="ArrowLeft")show(i-1);});
  window.addEventListener("beforeunload",()=>Live.stop());
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
