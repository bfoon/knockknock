/* ════════════════════════════════════════════════════════════════════
   HANNS — application logic
   A single-file editorial presentation studio: slide editor, template &
   background galleries, per-element animation, live present mode with a
   QR + floating audience-emoji reactions.

   PORTING NOTE (KnockKnock / Django):
   The present-mode audience loop here is simulated locally so it runs in
   one file with no server. To go live, replace `Live.*` with a WebSocket
   to a Channels consumer (mirror Boardly's BoardConsumer): the presenter
   opens ws/hanns/<CODE>/, audience phones POST {type:"react", emoji} and
   the consumer fans out {type:"reaction", emoji} → spawnEmoji(). Slide
   sync is just {type:"goto", index}. Everything else is presentational.
   ════════════════════════════════════════════════════════════════════ */
(function(){
"use strict";

const W = 960, H = 540;     // slide design size (16:9), all coords are in this space
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const uid = ()=>Math.random().toString(36).slice(2,9);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/* ── palette presented in colour pickers ─────────────────────────── */
const PALETTE = ["#16140f","#3a352a","#6b6354","#a59c88","#f6f1e7","#ffffff",
  "#e8482b","#ff6a4d","#d8a23a","#f2c14e","#2f6f4f","#5b8c5a",
  "#1d4e89","#3b82a0","#7d4f9c","#b15fa3"];

/* ── animation catalogue (entrance) ──────────────────────────────── */
const ANIMS = {
  none:     {label:"None"},
  fade:     {label:"Fade in"},
  "rise":   {label:"Rise up"},
  "drop":   {label:"Drop down"},
  "left":   {label:"Slide from left"},
  "right":  {label:"Slide from right"},
  "zoom":   {label:"Zoom in"},
  "pop":    {label:"Pop"},
  "blur":   {label:"Focus / unblur"},
  "reveal": {label:"Wipe reveal"},
};
const TRANSITIONS = {
  none:"None", fade:"Fade", slide:"Slide", push:"Push",
  zoom:"Zoom", flip:"Flip", reveal:"Reveal"
};

/* ── background library (CSS backgrounds = magazine-grade, exportable) ─ */
const BACKGROUNDS = [
  {name:"Paper",      css:"#f6f1e7"},
  {name:"Ink",        css:"#16140f"},
  {name:"Bone",       css:"#fbf8f1"},
  {name:"Ember",      css:"linear-gradient(135deg,#e8482b,#7a1f12)"},
  {name:"Dusk",       css:"linear-gradient(160deg,#1d2440,#3b2a52 55%,#7d4f9c)"},
  {name:"Sahara",     css:"linear-gradient(150deg,#f2c14e,#d8732a 70%,#9a3b1f)"},
  {name:"Pine",       css:"linear-gradient(160deg,#0f2a22,#2f6f4f)"},
  {name:"Cobalt",     css:"linear-gradient(150deg,#0b1d3a,#1d4e89 60%,#3b82a0)"},
  {name:"Mesh Coral", css:"radial-gradient(60% 80% at 20% 20%,#ff6a4d 0%,transparent 60%),radial-gradient(50% 70% at 85% 30%,#d8a23a 0%,transparent 55%),radial-gradient(70% 80% at 60% 100%,#7d4f9c 0%,transparent 60%),#1a1712"},
  {name:"Mesh Mint",  css:"radial-gradient(60% 80% at 15% 25%,#5b8c5a 0%,transparent 60%),radial-gradient(55% 70% at 90% 20%,#3b82a0 0%,transparent 55%),radial-gradient(80% 80% at 50% 110%,#1d4e89 0%,transparent 60%),#0d1410"},
  {name:"Grid",       css:"linear-gradient(#e9e0cf 1px,transparent 1px),linear-gradient(90deg,#e9e0cf 1px,transparent 1px),#f6f1e7", size:"32px 32px"},
  {name:"Dots",       css:"radial-gradient(#c9bfa6 1.4px,transparent 1.5px),#f6f1e7", size:"22px 22px"},
  {name:"Stripes",    css:"repeating-linear-gradient(45deg,#16140f 0 14px,#211e18 14px 28px)"},
  {name:"Halftone",   css:"radial-gradient(#e8482b 22%,transparent 23%),#16140f", size:"18px 18px"},
  {name:"Sunburst",   css:"repeating-conic-gradient(from 0deg at 50% 120%,#f2c14e 0deg 6deg,#e8842b 6deg 12deg)"},
  {name:"Aurora",     css:"linear-gradient(120deg,#0b1d3a,#2f6f4f 40%,#7d4f9c 75%,#e8482b)"},
];

/* ── text style presets used in templates & the text tool ────────── */
const FONTS = [
  {label:"Fraunces (display)", css:'"Fraunces",serif'},
  {label:"Archivo Expanded",   css:'"Archivo Expanded","Archivo",sans-serif'},
  {label:"Archivo",            css:'"Archivo",sans-serif'},
  {label:"Spline Mono",        css:'"Spline Sans Mono",monospace'},
];

/* ════════════════════════════════════════════════════════════════════
   ELEMENT FACTORIES — every element is a plain data object.
   types: text | rect | ellipse | line | image
   common: {id,type,x,y,w,h,rot,anim,animDelay}
   ════════════════════════════════════════════════════════════════════ */
function elBase(type,over={}){
  return Object.assign({
    id:uid(), type, x:120,y:120,w:300,h:120,rot:0,
    anim:"fade", animDelay:0,
  },over);
}
function makeText(over={}){
  return elBase("text",Object.assign({
    w:420,h:120,text:"Double-click to edit",
    font:'"Fraunces",serif', size:44, weight:600, italic:false,
    color:"#16140f", align:"left", lh:1.1, ls:0, fill:"none",
  },over));
}
function makeShape(type,over={}){
  return elBase(type,Object.assign({
    w:220,h:220, fill:"#e8482b", stroke:"none", strokeW:0, radius:14,
  },over));
}
function makeLine(over={}){
  return elBase("line",Object.assign({w:360,h:6,fill:"#16140f"},over));
}
function makeImage(src,over={}){
  return elBase("image",Object.assign({w:360,h:240,src:src||"",fit:"cover",radius:12},over));
}

/* ════════════════════════════════════════════════════════════════════
   TEMPLATES — each is {name, build()->{bg,bgSize,els[]}}.
   Designed to look editorial / magazine out of the box.
   ════════════════════════════════════════════════════════════════════ */
function T_titleEmber(){return{bg:BACKGROUNDS[3].css,els:[
  makeText({x:90,y:150,w:780,h:170,text:"The Big Idea",font:'"Fraunces",serif',size:118,weight:600,italic:true,color:"#fbf8f1",anim:"rise"}),
  makeShape("rect",{x:92,y:330,w:120,h:8,fill:"#f2c14e",anim:"left",animDelay:.2,radius:4}),
  makeText({x:92,y:352,w:680,h:60,text:"A subtitle that sets the tone",size:30,weight:400,color:"#ffd9cf",anim:"fade",animDelay:.35,font:'"Archivo",sans-serif'}),
  makeText({x:92,y:470,w:400,h:40,text:"YOUR NAME · 2025",size:16,weight:700,color:"#ffb9a8",ls:3,font:'"Spline Sans Mono",monospace',anim:"fade",animDelay:.5}),
]};}
function T_titleBone(){return{bg:BACKGROUNDS[2].css,els:[
  makeText({x:90,y:120,w:300,h:40,text:"CHAPTER 01",size:18,weight:800,ls:6,color:"#e8482b",font:'"Archivo Expanded","Archivo",sans-serif',anim:"left"}),
  makeText({x:88,y:170,w:800,h:220,text:"A headline\nset in serif",font:'"Fraunces",serif',size:104,weight:600,color:"#16140f",lh:.98,anim:"rise",animDelay:.1}),
  makeShape("rect",{x:90,y:410,w:780,h:3,fill:"#16140f",anim:"reveal",animDelay:.35}),
  makeText({x:90,y:428,w:780,h:60,text:"Supporting line of context that frames the whole talk.",size:22,color:"#3a352a",font:'"Archivo",sans-serif',anim:"fade",animDelay:.45}),
]};}
function T_sectionDusk(){return{bg:BACKGROUNDS[4].css,els:[
  makeShape("ellipse",{x:560,y:-120,w:520,h:520,fill:"#e8482b",anim:"zoom"}),
  makeText({x:90,y:200,w:560,h:60,text:"SECTION",size:18,weight:800,ls:8,color:"#cdbce6",font:'"Spline Sans Mono",monospace',anim:"left"}),
  makeText({x:88,y:240,w:620,h:180,text:"Where we\nare going",font:'"Fraunces",serif',size:92,weight:500,italic:true,color:"#fbf8f1",lh:1,anim:"rise",animDelay:.15}),
]};}
function T_statement(){return{bg:BACKGROUNDS[1].css,els:[
  makeText({x:120,y:150,w:720,h:260,text:"“Make it\nunforgettable.”",font:'"Fraunces",serif',size:96,weight:600,italic:true,color:"#f6f1e7",lh:1.02,align:"center",anim:"blur"}),
  makeText({x:120,y:430,w:720,h:40,text:"— Hanns",size:20,weight:600,color:"#d8a23a",align:"center",font:'"Archivo",sans-serif',anim:"fade",animDelay:.4}),
]};}
function T_twoCol(){return{bg:BACKGROUNDS[0].css,els:[
  makeText({x:80,y:90,w:800,h:80,text:"Two columns",font:'"Fraunces",serif',size:60,weight:600,color:"#16140f",anim:"rise"}),
  makeShape("rect",{x:80,y:190,w:380,h:280,fill:"#16140f",radius:16,anim:"left",animDelay:.1}),
  makeText({x:104,y:214,w:332,h:60,text:"Point one",size:30,weight:700,color:"#f6f1e7",font:'"Archivo",sans-serif',anim:"fade",animDelay:.25}),
  makeText({x:104,y:268,w:332,h:180,text:"Describe the first idea here with a sentence or two of supporting detail.",size:19,color:"#cfc6b2",font:'"Archivo",sans-serif',lh:1.4,anim:"fade",animDelay:.3}),
  makeShape("rect",{x:500,y:190,w:380,h:280,fill:"#e8482b",radius:16,anim:"right",animDelay:.1}),
  makeText({x:524,y:214,w:332,h:60,text:"Point two",size:30,weight:700,color:"#fff",font:'"Archivo",sans-serif',anim:"fade",animDelay:.35}),
  makeText({x:524,y:268,w:332,h:180,text:"And the second idea, balanced against the first for visual rhythm.",size:19,color:"#ffe2d9",font:'"Archivo",sans-serif',lh:1.4,anim:"fade",animDelay:.4}),
]};}
function T_imageLeft(){return{bg:BACKGROUNDS[2].css,els:[
  makeImage("",{x:0,y:0,w:430,h:540,radius:0,anim:"left"}),
  makeText({x:480,y:130,w:400,h:40,text:"FEATURE",size:16,weight:800,ls:6,color:"#e8482b",font:'"Spline Sans Mono",monospace',anim:"fade",animDelay:.2}),
  makeText({x:478,y:168,w:420,h:160,text:"A picture\nand a point",font:'"Fraunces",serif',size:64,weight:600,color:"#16140f",lh:1,anim:"rise",animDelay:.25}),
  makeText({x:480,y:350,w:400,h:120,text:"Pair an image with a clear, confident caption to carry the idea.",size:20,color:"#3a352a",font:'"Archivo",sans-serif',lh:1.45,anim:"fade",animDelay:.4}),
]};}
function T_bigNumber(){return{bg:BACKGROUNDS[9].css,els:[
  makeText({x:90,y:120,w:780,h:280,text:"87%",font:'"Archivo Expanded","Archivo",sans-serif',size:240,weight:800,color:"#fbf8f1",anim:"pop"}),
  makeText({x:96,y:400,w:780,h:80,text:"of presentations are forgotten. Yours won't be.",size:28,color:"#cfe7d8",font:'"Archivo",sans-serif',anim:"fade",animDelay:.3}),
]};}
function T_thanks(){return{bg:BACKGROUNDS[8].css,els:[
  makeText({x:120,y:190,w:720,h:160,text:"Thank you",font:'"Fraunces",serif',size:108,weight:600,italic:true,color:"#fbf8f1",align:"center",anim:"zoom"}),
  makeText({x:120,y:360,w:720,h:40,text:"hello@yourbrand.com",size:22,color:"#ffd9cf",align:"center",font:'"Spline Sans Mono",monospace',anim:"fade",animDelay:.3}),
]};}

const TEMPLATES = [
  {name:"Title · Ember",   build:T_titleEmber},
  {name:"Title · Serif",   build:T_titleBone},
  {name:"Section · Dusk",  build:T_sectionDusk},
  {name:"Statement",       build:T_statement},
  {name:"Two columns",     build:T_twoCol},
  {name:"Image + point",   build:T_imageLeft},
  {name:"Big number",      build:T_bigNumber},
  {name:"Thank you",       build:T_thanks},
];

/* ════════════════════════════════════════════════════════════════════
   DECK STATE
   ════════════════════════════════════════════════════════════════════ */
const Deck = {
  title:"Untitled deck",
  slides:[],            // [{id,bg,bgSize,transition,els:[]}]
  cur:0,
  sel:null,             // selected element id
  code: genCode(),
};
function genCode(){const a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";let s="";for(let i=0;i<6;i++)s+=a[Math.random()*a.length|0];return s;}
function newSlide(over={}){return Object.assign({id:uid(),bg:BACKGROUNDS[0].css,bgSize:null,transition:"fade",els:[]},over);}
function curSlide(){return Deck.slides[Deck.cur];}
function selEl(){const s=curSlide();return s?s.els.find(e=>e.id===Deck.sel):null;}

/* ════════════════════════════════════════════════════════════════════
   RENDER — build the DOM for an element. Shared by editor + present +
   thumbnails, so a slide always looks identical everywhere.
   `live` true = presentation (run entrance animations), false = editor.
   ════════════════════════════════════════════════════════════════════ */
function styleEl(el,node){
  node.style.left=el.x+"px";node.style.top=el.y+"px";
  node.style.width=el.w+"px";node.style.height=el.h+"px";
  node.style.transform=`rotate(${el.rot||0}deg)`;
}
function renderElement(el,{live=false}={}){
  const node=document.createElement("div");
  node.className="el "+el.type;
  node.dataset.id=el.id;
  styleEl(el,node);
  const inner=document.createElement("div");inner.className="el-inner";

  if(el.type==="text"){
    const t=document.createElement("div");
    t.style.font=`${el.italic?"italic ":""}${el.weight} ${el.size}px/${el.lh} ${el.font}`;
    t.style.color=el.color;t.style.textAlign=el.align;t.style.letterSpacing=(el.ls||0)+"px";
    t.style.width="100%";t.style.whiteSpace="pre-wrap";
    if(el.fill&&el.fill!=="none"){node.style.background=el.fill;}
    t.textContent=el.text;
    if(!live){t.setAttribute("contenteditable","true");t.spellcheck=false;}
    inner.appendChild(t);
  } else if(el.type==="rect"||el.type==="ellipse"){
    const s=document.createElement("div");s.className="shape";
    s.style.background=el.fill;s.style.borderRadius=el.type==="ellipse"?"50%":(el.radius||0)+"px";
    if(el.stroke&&el.stroke!=="none"&&el.strokeW)s.style.border=`${el.strokeW}px solid ${el.stroke}`;
    inner.appendChild(s);
  } else if(el.type==="line"){
    const s=document.createElement("div");s.className="shape";
    s.style.background=el.fill;s.style.borderRadius="999px";
    inner.appendChild(s);
  } else if(el.type==="image"){
    const im=document.createElement("div");im.className="imgbox"+(el.src?"":" placeholder");
    if(el.src){im.style.backgroundImage=`url("${el.src}")`;im.style.backgroundSize=el.fit;}
    else im.textContent="🖼  click to add image";
    im.style.borderRadius=(el.radius||0)+"px";
    inner.appendChild(im);
  }
  node.appendChild(inner);

  if(!live){
    ["nw","ne","sw","se"].forEach(p=>{const h=document.createElement("div");h.className="handle "+p;h.dataset.handle=p;node.appendChild(h);});
    const r=document.createElement("div");r.className="rot";r.dataset.handle="rot";node.appendChild(r);
  }
  return node;
}

/* entrance animation keyframe application (present mode) */
function animateIn(node,el){
  const a=el.anim||"none";if(a==="none"){node.style.opacity=1;return;}
  const map={
    fade:[{opacity:0},{opacity:1}],
    rise:[{opacity:0,transform:`translateY(40px) rotate(${el.rot||0}deg)`},{opacity:1,transform:`translateY(0) rotate(${el.rot||0}deg)`}],
    drop:[{opacity:0,transform:`translateY(-40px) rotate(${el.rot||0}deg)`},{opacity:1,transform:`translateY(0) rotate(${el.rot||0}deg)`}],
    left:[{opacity:0,transform:`translateX(-60px) rotate(${el.rot||0}deg)`},{opacity:1,transform:`translateX(0) rotate(${el.rot||0}deg)`}],
    right:[{opacity:0,transform:`translateX(60px) rotate(${el.rot||0}deg)`},{opacity:1,transform:`translateX(0) rotate(${el.rot||0}deg)`}],
    zoom:[{opacity:0,transform:`scale(.6) rotate(${el.rot||0}deg)`},{opacity:1,transform:`scale(1) rotate(${el.rot||0}deg)`}],
    pop:[{opacity:0,transform:`scale(.3) rotate(${el.rot||0}deg)`},{opacity:1,transform:`scale(1.08) rotate(${el.rot||0}deg)`,offset:.7},{transform:`scale(1) rotate(${el.rot||0}deg)`,opacity:1}],
    blur:[{opacity:0,filter:"blur(14px)"},{opacity:1,filter:"blur(0)"}],
    reveal:[{opacity:0,clipPath:"inset(0 100% 0 0)"},{opacity:1,clipPath:"inset(0 0 0 0)"}],
  };
  const frames=map[a]||map.fade;
  node.style.opacity=0;
  node.animate(frames,{duration:a==="pop"?720:620,delay:(el.animDelay||0)*1000,
    easing:a==="pop"?"cubic-bezier(.34,1.56,.64,1)":"cubic-bezier(.22,1,.36,1)",fill:"both"});
}

/* paint a slide into a container at native 960×540 */
function paintSlide(container,slide,{live=false}={}){
  container.innerHTML="";
  container.style.background=slide.bg;
  if(slide.bgSize)container.style.backgroundSize=slide.bgSize;else container.style.backgroundSize="";
  slide.els.forEach(el=>{
    const node=renderElement(el,{live});
    container.appendChild(node);
    if(live)animateIn(node,el);
  });
}

window.Hanns = {Deck,TEMPLATES,BACKGROUNDS,ANIMS,TRANSITIONS,PALETTE,FONTS,
  newSlide,curSlide,selEl,paintSlide,renderElement,
  makeText,makeShape,makeLine,makeImage,W,H,$,$$,uid,clamp,genCode};

})();