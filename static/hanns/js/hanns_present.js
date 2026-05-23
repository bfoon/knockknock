/* ════════════════════════════════════════════════════════════════════
   HANNS — presenter stage (present.html)
   Runs the deck fullscreen with entrance animations + slide transitions,
   shows a QR + join link, and floats audience emoji reactions arriving
   over the live WebSocket (consumers.PresentConsumer). Depends on
   hanns_core.js for the shared slide renderer (window.Hanns).
   ════════════════════════════════════════════════════════════════════ */
(function(){
"use strict";
const Hx = window.Hanns;
const {paintSlide, clamp, W, H} = Hx;
const CFG = window.__HANNS_PRESENT__ || {};   // {deck, wsUrl, joinUrl, stateUrl, csrftoken}
const DECK = CFG.deck || {slides:[], code:"------", title:"Untitled"};

const $ = (s)=>document.querySelector(s);
const pCanvas    = $("#present-canvas");
const emojiLayer = $("#emoji-layer");
let i = DECK.current_slide || 0;

/* ── render / transitions ─────────────────────────────────────────── */
function fit(){
  const z=Math.min(window.innerWidth/W, window.innerHeight/H);
  pCanvas.style.width=W+"px";pCanvas.style.height=H+"px";
  pCanvas.style.transform=`scale(${z})`;pCanvas.style.transformOrigin="center center";
}
function transition(node,kind){
  const map={
    none:[{opacity:1}],
    fade:[{opacity:0},{opacity:1}],
    slide:[{transform:"translateX(60px)",opacity:0},{transform:"translateX(0)",opacity:1}],
    push:[{transform:"translateX(100%)"},{transform:"translateX(0)"}],
    zoom:[{transform:"scale(1.08)",opacity:0},{transform:"scale(1)",opacity:1}],
    flip:[{transform:"perspective(1200px) rotateY(12deg)",opacity:0},{transform:"perspective(1200px) rotateY(0)",opacity:1}],
    reveal:[{clipPath:"inset(0 0 100% 0)"},{clipPath:"inset(0 0 0 0)"}],
  };
  node.animate(map[kind]||map.fade,{duration:480,easing:"cubic-bezier(.22,1,.36,1)",fill:"both"});
}
function show(n){
  i=clamp(n,0,DECK.slides.length-1);
  const s=DECK.slides[i];
  paintSlide(pCanvas,s,{live:true});
  transition(pCanvas,(s&&s.transition)||"fade");
  $("#pp-pos").textContent=`${i+1} / ${DECK.slides.length}`;
  Live.goto(i);
}

/* ── floating emoji ───────────────────────────────────────────────── */
function spawnEmoji(em){
  const e=document.createElement("div");e.className="emoji-fly";e.textContent=em;
  e.style.left=(8+Math.random()*84)+"%";
  e.style.setProperty("--spin",(Math.random()*40-20)+"deg");
  e.style.fontSize=(2+Math.random()*1.6)+"rem";
  emojiLayer.appendChild(e);
  setTimeout(()=>e.remove(),3700);
}

/* ── live WebSocket (mirrors Boardly's client socket pattern) ─────── */
const Live={
  sock:null, retry:0,
  start(){
    if(!CFG.wsUrl)return;
    try{ this.sock=new WebSocket(CFG.wsUrl); }catch(e){ return; }
    this.sock.addEventListener("open",()=>{ this.retry=0;
      this.send({type:"presenter_hello"}); });
    this.sock.addEventListener("message",(ev)=>{
      let m; try{ m=JSON.parse(ev.data); }catch(e){ return; }
      if(m.type==="reaction") spawnEmoji(m.emoji);
      else if(m.type==="participants") setCount(m.count);
      else if(m.type==="state" && typeof m.count==="number") setCount(m.count);
    });
    this.sock.addEventListener("close",()=>{ // reconnect with backoff
      if(this.retry++>6)return;
      setTimeout(()=>this.start(),Math.min(800*this.retry,5000)); });
  },
  send(o){ if(this.sock&&this.sock.readyState===1) this.sock.send(JSON.stringify(o)); },
  goto(idx){ this.send({type:"goto",index:idx}); },
  stop(){ if(this.sock){try{this.sock.close();}catch(e){}} this.sock=null; },
};
function setCount(n){const el=$("#aud-count");if(el)el.textContent=n;}

/* ── QR ───────────────────────────────────────────────────────────── */
function drawQR(){
  const box=$("#present-qr");if(!box||typeof QRCode==="undefined"||!CFG.joinUrl)return;
  box.innerHTML="";
  new QRCode(box,{text:CFG.joinUrl,width:84,height:84,
    colorDark:"#16140f",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
}

/* ── end-present → flip the deck to "ended" so reactions stop ─────── */
async function endPresent(){
  Live.stop();
  if(CFG.stateUrl){
    try{ await fetch(CFG.stateUrl,{method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded","X-CSRFToken":CFG.csrftoken||""},
      body:"state=ended"}); }catch(e){}
  }
  if(CFG.editUrl)window.location.href=CFG.editUrl;
}

/* ── wire ─────────────────────────────────────────────────────────── */
function init(){
  $("#present-code").textContent=DECK.code;
  $("#present-url").textContent=(CFG.joinUrl||"").replace(/^https?:\/\//,"");
  drawQR();
  fit();show(i);
  Live.start();

  $("#pp-prev").addEventListener("click",()=>show(i-1));
  $("#pp-next").addEventListener("click",()=>show(i+1));
  $("#present-exit").addEventListener("click",endPresent);
  window.addEventListener("resize",fit);
  document.addEventListener("keydown",(e)=>{
    if(e.key==="Escape")endPresent();
    else if(e.key==="ArrowRight"||e.key===" ")show(i+1);
    else if(e.key==="ArrowLeft")show(i-1);
  });
  window.addEventListener("beforeunload",()=>Live.stop());
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
