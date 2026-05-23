/* ════════════════════════════════════════════════════════════════════
   HANNS — audience phone (join.html)
   The QR target. Connects to the live deck socket and shows a reaction
   pad; tapping an emoji sends {type:"react",emoji} which the consumer
   fans out to the presenter stage (and any other phones). Also gives a
   little local "sent" pop so the tap feels responsive even before the
   round-trip.
   ════════════════════════════════════════════════════════════════════ */
(function(){
"use strict";
const CFG = window.__HANNS_JOIN__ || {};   // {wsUrl, code, title, reactions[]}
const $ = (s)=>document.querySelector(s);

let sock=null, retry=0, live=false;
function connect(){
  if(!CFG.wsUrl)return;
  try{ sock=new WebSocket(CFG.wsUrl); }catch(e){ return; }
  sock.addEventListener("open",()=>{ retry=0; send({type:"join",nick:"Guest"}); setStatus(true); });
  sock.addEventListener("message",(ev)=>{
    let m; try{ m=JSON.parse(ev.data);}catch(e){return;}
    if(m.type==="state"){ live = !!m.live; reflectLive(m.allow_reactions!==false); }
  });
  sock.addEventListener("close",()=>{ setStatus(false); if(retry++>8)return;
    setTimeout(connect,Math.min(800*retry,5000)); });
}
function send(o){ if(sock&&sock.readyState===1) sock.send(JSON.stringify(o)); }
function setStatus(ok){ const d=$("#dot"); if(d)d.classList.toggle("on",ok); }
function reflectLive(allowed){
  const pad=$("#pad"), msg=$("#pad-msg");
  if(pad)pad.classList.toggle("disabled",!allowed);
  if(msg)msg.textContent = allowed ? "Tap to react — your reaction floats up on the big screen."
                                   : "Reactions are closed for this presentation.";
}

function buildPad(){
  const g=$("#pad");g.innerHTML="";
  (CFG.reactions||[]).forEach(em=>{
    const b=document.createElement("button");b.className="react";b.textContent=em;
    b.addEventListener("click",()=>react(em,b));
    g.appendChild(b);
  });
}
function react(em,btn){
  send({type:"react",emoji:em});
  // local feedback pop
  btn.animate([{transform:"scale(1)"},{transform:"scale(1.35)"},{transform:"scale(1)"}],
    {duration:240,easing:"cubic-bezier(.34,1.56,.64,1)"});
  burst(em);
}
function burst(em){
  const layer=$("#burst");if(!layer)return;
  const e=document.createElement("div");e.className="burst-em";e.textContent=em;
  e.style.left=(20+Math.random()*60)+"%";
  layer.appendChild(e);setTimeout(()=>e.remove(),1200);
}

function init(){
  $("#join-title").textContent=CFG.title||"Live presentation";
  $("#join-code").textContent=CFG.code||"------";
  buildPad();connect();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
