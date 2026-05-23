/* ════════════════════════════════════════════════════════════════════
   HANNS — interaction layer (depends on logic_core's window.Hanns)
   ════════════════════════════════════════════════════════════════════ */
(function(){
"use strict";
const Hx = window.Hanns;
const {Deck,TEMPLATES,BACKGROUNDS,ANIMS,TRANSITIONS,PALETTE,FONTS,
  newSlide,curSlide,selEl,paintSlide,renderElement,
  makeText,makeShape,makeLine,makeImage,W,H,$,$$,uid,clamp,genCode}=Hx;

const canvas   = $("#canvas");
const wrap     = $("#canvas-wrap");
const stage    = $("#stage");
const slidesEl = $("#slides");
const inspBody = $("#insp-body");
let inspTab = "element";
let appReady = false;     // gates autosave until the deck has loaded
let zoom = 1;          // current canvas scale
let zoomMode = "fit";  // "fit" | number

function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.add("on");
  clearTimeout(t._t);t._t=setTimeout(()=>t.classList.remove("on"),1800);}

/* ── zoom: fit the 960×540 canvas into the stage ─────────────────── */
function fitZoom(){
  const pad=72;
  const aw=stage.clientWidth-pad, ah=stage.clientHeight-pad;
  const z=Math.min(aw/W, ah/H);
  return clamp(z,0.2,2);
}
function applyZoom(){
  const z = zoomMode==="fit"?fitZoom():zoom;
  zoom=z;
  wrap.style.width=(W*z)+"px";wrap.style.height=(H*z)+"px";
  canvas.style.transform=`scale(${z})`;
  canvas.style.transformOrigin="top left";
  canvas.style.position="absolute";canvas.style.left="0";canvas.style.top="0";
  wrap.style.position="relative";
  $("#zoom-val").textContent = zoomMode==="fit" ? "Fit" : Math.round(z*100)+"%";
}

/* ════════════════════════════════════════════════════════════════════
   RENDER editor canvas + filmstrip
   ════════════════════════════════════════════════════════════════════ */
function renderCanvas(){
  const s=curSlide();if(!s)return;
  paintSlide(canvas,s,{live:false});
  // re-mark selection
  if(Deck.sel){const n=canvas.querySelector(`.el[data-id="${Deck.sel}"]`);if(n)n.classList.add("selected");}
  wireCanvasElements();
  $("#nav-pos").textContent=`${Deck.cur+1} / ${Deck.slides.length}`;
  applyZoom();
}
function renderFilmstrip(){
  slidesEl.innerHTML="";
  Deck.slides.forEach((s,i)=>{
    const th=document.createElement("div");
    th.className="thumb"+(i===Deck.cur?" active":"");
    th.innerHTML=`<span class="num">${i+1}</span><button class="del" title="Delete">✕</button>`;
    const mini=document.createElement("div");mini.className="mini";
    mini.style.width=W+"px";mini.style.height=H+"px";
    paintSlide(mini,s,{live:false});
    // scale mini into the thumb width
    requestAnimationFrame(()=>{const sc=th.clientWidth/W;mini.style.transform=`scale(${sc})`;});
    th.appendChild(mini);
    th.addEventListener("click",e=>{if(e.target.closest(".del"))return;gotoSlide(i);});
    th.querySelector(".del").addEventListener("click",e=>{e.stopPropagation();deleteSlide(i);});
    slidesEl.appendChild(th);
  });
}
function renderAll(){renderCanvas();renderFilmstrip();renderInspector();}
/* Call after any genuine content mutation (not navigation) to autosave. */
function markDirty(){if(appReady&&typeof scheduleSave==="function")scheduleSave();}

/* ════════════════════════════════════════════════════════════════════
   SLIDE ops
   ════════════════════════════════════════════════════════════════════ */
function gotoSlide(i){Deck.cur=clamp(i,0,Deck.slides.length-1);Deck.sel=null;renderAll();}
function addSlide(fromTpl){
  const s = fromTpl ? Object.assign(newSlide(),fromTpl) : newSlide();
  Deck.slides.splice(Deck.cur+1,0,s);
  gotoSlide(Deck.cur+1);
  toast("Slide added");
}
function deleteSlide(i){
  if(Deck.slides.length===1){toast("A deck needs at least one slide");return;}
  Deck.slides.splice(i,1);
  Deck.cur=clamp(Deck.cur,0,Deck.slides.length-1);Deck.sel=null;renderAll();
}
function applyTemplate(tpl){
  const built=tpl.build();
  const s=curSlide();
  s.bg=built.bg;s.bgSize=built.bgSize||null;
  s.els=built.els.map(e=>Object.assign({},e));
  Deck.sel=null;renderAll();
  closeDrawers();toast(`Applied “${tpl.name}”`);
}

/* ════════════════════════════════════════════════════════════════════
   ELEMENT add / select / delete
   ════════════════════════════════════════════════════════════════════ */
function addElement(kind){
  const s=curSlide();let el;
  const cx=W/2-150, cy=H/2-60;
  if(kind==="text") el=makeText({x:cx,y:cy});
  else if(kind==="rect") el=makeShape("rect",{x:cx,y:cy});
  else if(kind==="ellipse") el=makeShape("ellipse",{x:cx,y:cy});
  else if(kind==="line") el=makeLine({x:cx,y:H/2});
  else if(kind==="image"){el=makeImage("",{x:cx,y:cy});}
  s.els.push(el);Deck.sel=el.id;renderAll();
  if(kind==="image")pickImageFor(el.id);
}
function selectEl(id){Deck.sel=id;
  $$(".el",canvas).forEach(n=>n.classList.toggle("selected",n.dataset.id===id));
  renderInspector();
}
function deleteEl(id){const s=curSlide();s.els=s.els.filter(e=>e.id!==id);
  if(Deck.sel===id)Deck.sel=null;renderAll();}

/* image picker */
let pendingImgId=null;
function pickImageFor(id){pendingImgId=id;$("#img-input").click();}
$("#img-input").addEventListener("change",e=>{
  const f=e.target.files[0];if(!f||!pendingImgId)return;
  const rd=new FileReader();
  rd.onload=()=>{const el=curSlide().els.find(x=>x.id===pendingImgId);
    if(el){el.src=rd.result;renderAll();markDirty();}pendingImgId=null;e.target.value="";};
  rd.readAsDataURL(f);
});

/* ════════════════════════════════════════════════════════════════════
   CANVAS interaction: select, drag, resize, rotate, inline text edit
   All maths happen in slide space (divide pointer deltas by zoom).
   ════════════════════════════════════════════════════════════════════ */
function wireCanvasElements(){
  $$(".el",canvas).forEach(node=>{
    const id=node.dataset.id;
    node.addEventListener("pointerdown",e=>{
      if(e.target.closest("[data-handle]"))return; // handled below
      if(e.target.isContentEditable&&node.classList.contains("selected"))return; // editing text
      selectEl(id);startDrag(e,node,id);
    });
    // image element: click placeholder to choose a file
    if(node.classList.contains("image")){
      node.addEventListener("dblclick",()=>pickImageFor(id));
    }
    // text: dbl-click to edit, commit on blur
    const ce=node.querySelector("[contenteditable]");
    if(ce){
      node.addEventListener("dblclick",()=>{ce.focus();
        document.getSelection().selectAllChildren(ce);});
      ce.addEventListener("blur",()=>{const el=curSlide().els.find(x=>x.id===id);
        if(el){el.text=ce.innerText;renderFilmstrip();markDirty();}});
      ce.addEventListener("pointerdown",e=>e.stopPropagation());
    }
    // handles
    $$("[data-handle]",node).forEach(h=>{
      h.addEventListener("pointerdown",e=>{e.stopPropagation();selectEl(id);
        if(h.dataset.handle==="rot")startRotate(e,node,id);
        else startResize(e,node,id,h.dataset.handle);});
    });
  });
}
function startDrag(e,node,id){
  const el=curSlide().els.find(x=>x.id===id);if(!el)return;
  const sx=e.clientX, sy=e.clientY, ox=el.x, oy=el.y;
  const mv=ev=>{el.x=Math.round(ox+(ev.clientX-sx)/zoom);el.y=Math.round(oy+(ev.clientY-sy)/zoom);
    node.style.left=el.x+"px";node.style.top=el.y+"px";};
  const up=()=>{document.removeEventListener("pointermove",mv);document.removeEventListener("pointerup",up);renderFilmstrip();syncInspectorPos();markDirty();};
  document.addEventListener("pointermove",mv);document.addEventListener("pointerup",up);
}
function startResize(e,node,id,corner){
  const el=curSlide().els.find(x=>x.id===id);if(!el)return;
  const sx=e.clientX, sy=e.clientY;
  const o={x:el.x,y:el.y,w:el.w,h:el.h};
  const mv=ev=>{
    const dx=(ev.clientX-sx)/zoom, dy=(ev.clientY-sy)/zoom;
    let {x,y,w,h}=o;
    if(corner.includes("e"))w=Math.max(20,o.w+dx);
    if(corner.includes("s"))h=Math.max(12,o.h+dy);
    if(corner.includes("w")){w=Math.max(20,o.w-dx);x=o.x+dx;}
    if(corner.includes("n")){h=Math.max(12,o.h-dy);y=o.y+dy;}
    el.x=Math.round(x);el.y=Math.round(y);el.w=Math.round(w);el.h=Math.round(h);
    node.style.left=el.x+"px";node.style.top=el.y+"px";
    node.style.width=el.w+"px";node.style.height=el.h+"px";
  };
  const up=()=>{document.removeEventListener("pointermove",mv);document.removeEventListener("pointerup",up);renderFilmstrip();syncInspectorPos();markDirty();};
  document.addEventListener("pointermove",mv);document.addEventListener("pointerup",up);
}
function startRotate(e,node,id){
  const el=curSlide().els.find(x=>x.id===id);if(!el)return;
  const r=node.getBoundingClientRect();const cx=r.left+r.width/2, cy=r.top+r.height/2;
  const mv=ev=>{let a=Math.atan2(ev.clientY-cy,ev.clientX-cx)*180/Math.PI+90;
    if(ev.shiftKey)a=Math.round(a/15)*15;el.rot=Math.round(a);
    node.style.transform=`rotate(${el.rot}deg)`;};
  const up=()=>{document.removeEventListener("pointermove",mv);document.removeEventListener("pointerup",up);renderInspector();markDirty();};
  document.addEventListener("pointermove",mv);document.addEventListener("pointerup",up);
}
// click empty canvas → deselect
canvas.addEventListener("pointerdown",e=>{if(e.target===canvas){Deck.sel=null;
  $$(".el",canvas).forEach(n=>n.classList.remove("selected"));renderInspector();}});

/* ════════════════════════════════════════════════════════════════════
   INSPECTOR
   ════════════════════════════════════════════════════════════════════ */
function field(label,inner){return `<div class="field"><label>${label}</label>${inner}</div>`;}
function swatchRow(current,onAttr){
  let h='<div class="swatches">';
  h+=`<div class="sw none ${current==="none"?"active":""}" data-${onAttr}="none" title="None"></div>`;
  PALETTE.forEach(c=>{h+=`<div class="sw ${current===c?"active":""}" style="background:${c}" data-${onAttr}="${c}"></div>`;});
  h+="</div>";return h;
}
function renderInspector(){
  // tab state
  $$(".insp-tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===inspTab));
  const el=selEl();
  if(inspTab==="slide"){inspBody.innerHTML=slidePanel();bindSlidePanel();return;}
  if(!el){
    inspBody.innerHTML=`<div class="insp-empty"><span class="big">Nothing selected</span>
      Pick an element on the canvas, or add one from the left rail. Switch to <b>Slide</b> to style the background &amp; transition.</div>`;
    return;
  }
  if(inspTab==="animate"){inspBody.innerHTML=animatePanel(el);bindAnimatePanel(el);return;}
  inspBody.innerHTML=elementPanel(el);bindElementPanel(el);
}
function elementPanel(el){
  let h="";
  // position group
  h+=`<div class="group"><span class="glabel">Position &amp; size</span>
    <div class="row2">
      ${field("X",`<input type="number" id="f-x" value="${el.x}">`)}
      ${field("Y",`<input type="number" id="f-y" value="${el.y}">`)}
    </div>
    <div class="row2">
      ${field("W",`<input type="number" id="f-w" value="${el.w}">`)}
      ${field("H",`<input type="number" id="f-h" value="${el.h}">`)}
    </div>
    ${field("Rotation "+(el.rot||0)+"°",`<input type="range" id="f-rot" min="-180" max="180" value="${el.rot||0}">`)}
  </div>`;

  if(el.type==="text"){
    h+=`<div class="group"><span class="glabel">Text</span>
      ${field("Content",`<textarea id="f-text">${el.text.replace(/</g,"&lt;")}</textarea>`)}
      ${field("Font",`<select id="f-font">${FONTS.map(f=>`<option value='${f.css}' ${el.font===f.css?"selected":""}>${f.label}</option>`).join("")}</select>`)}
      <div class="row2">
        ${field("Size "+el.size,`<input type="range" id="f-size" min="10" max="260" value="${el.size}">`)}
        ${field("Weight",`<select id="f-weight">${[300,400,500,600,700,800].map(w=>`<option ${el.weight==w?"selected":""}>${w}</option>`).join("")}</select>`)}
      </div>
      ${field("Alignment",`<div class="seg" id="f-align">
        ${["left","center","right"].map(a=>`<button data-align="${a}" class="${el.align===a?"active":""}">${a[0].toUpperCase()+a.slice(1)}</button>`).join("")}</div>`)}
      <div class="row2">
        ${field("Line height "+el.lh,`<input type="range" id="f-lh" min="0.8" max="2" step="0.05" value="${el.lh}">`)}
        ${field("Letter sp "+el.ls,`<input type="range" id="f-ls" min="-3" max="12" step="0.5" value="${el.ls||0}">`)}
      </div>
      ${field("Italic",`<div class="seg" id="f-italic"><button data-it="0" class="${!el.italic?"active":""}">Roman</button><button data-it="1" class="${el.italic?"active":""}">Italic</button></div>`)}
      <span class="glabel" style="margin-top:.4rem;display:block">Text colour</span>
      ${swatchRow(el.color,"color")}
      <span class="glabel" style="margin-top:.8rem;display:block">Highlight box</span>
      ${swatchRow(el.fill||"none","fill")}
    </div>`;
  }
  if(el.type==="rect"||el.type==="ellipse"||el.type==="line"){
    h+=`<div class="group"><span class="glabel">Fill</span>${swatchRow(el.fill,"fill")}</div>`;
    if(el.type!=="line"){
      h+=`<div class="group"><span class="glabel">Stroke</span>${swatchRow(el.stroke||"none","stroke")}
        ${field("Stroke width "+(el.strokeW||0),`<input type="range" id="f-strokew" min="0" max="20" value="${el.strokeW||0}">`)}</div>`;
      if(el.type==="rect")h+=`<div class="group">${field("Corner radius "+(el.radius||0),`<input type="range" id="f-radius" min="0" max="120" value="${el.radius||0}">`)}</div>`;
    }
  }
  if(el.type==="image"){
    h+=`<div class="group"><span class="glabel">Image</span>
      <button class="tbtn" id="f-pickimg" style="width:100%;justify-content:center">Replace image…</button>
      ${field("Fit",`<div class="seg" id="f-fit"><button data-fit="cover" class="${el.fit==="cover"?"active":""}">Cover</button><button data-fit="contain" class="${el.fit==="contain"?"active":""}">Contain</button></div>`)}
      ${field("Corner radius "+(el.radius||0),`<input type="range" id="f-radius" min="0" max="120" value="${el.radius||0}">`)}
    </div>`;
  }
  h+=`<button class="del-el" id="f-del">Delete element</button>`;
  return h;
}
function bindElementPanel(el){
  const set=(k,v,fmt)=>{el[k]=v;renderCanvas();markDirty();if(fmt)renderInspectorSoft();};
  const num=(id,k)=>{const i=$("#"+id);if(i)i.addEventListener("input",()=>{el[k]=Number(i.value)||0;renderCanvas();markDirty();});};
  num("f-x","x");num("f-y","y");num("f-w","w");num("f-h","h");
  bindRange("f-rot",v=>{el.rot=v;renderCanvas();markDirty();},v=>v+"°","Rotation");
  if(el.type==="text"){
    const ta=$("#f-text");ta&&ta.addEventListener("input",()=>{el.text=ta.value;renderCanvas();markDirty();});
    const fo=$("#f-font");fo&&fo.addEventListener("change",()=>{el.font=fo.value;renderCanvas();markDirty();});
    bindRange("f-size",v=>{el.size=v;renderCanvas();markDirty();},v=>v,"Size");
    const we=$("#f-weight");we&&we.addEventListener("change",()=>{el.weight=Number(we.value);renderCanvas();markDirty();});
    seg("f-align","align",v=>{el.align=v;renderCanvas();markDirty();});
    bindRange("f-lh",v=>{el.lh=v;renderCanvas();markDirty();},v=>v,"Line height");
    bindRange("f-ls",v=>{el.ls=v;renderCanvas();markDirty();},v=>v,"Letter sp");
    seg("f-italic","it",v=>{el.italic=v==="1";renderCanvas();markDirty();});
  }
  if(el.type==="rect"){bindRange("f-radius",v=>{el.radius=v;renderCanvas();markDirty();},v=>v,"Corner radius");}
  if(el.type==="image"){bindRange("f-radius",v=>{el.radius=v;renderCanvas();markDirty();},v=>v,"Corner radius");
    $("#f-pickimg")&&$("#f-pickimg").addEventListener("click",()=>pickImageFor(el.id));
    seg("f-fit","fit",v=>{el.fit=v;renderCanvas();markDirty();});}
  if(el.type==="rect"||el.type==="ellipse"){bindRange("f-strokew",v=>{el.strokeW=v;renderCanvas();markDirty();},v=>v,"Stroke width");}
  // swatches
  $$(".sw[data-color]",inspBody).forEach(s=>s.addEventListener("click",()=>{el.color=s.dataset.color;activateSwatch(s,"color");renderCanvas();markDirty();}));
  $$(".sw[data-fill]",inspBody).forEach(s=>s.addEventListener("click",()=>{el.fill=s.dataset.fill;activateSwatch(s,"fill");renderCanvas();markDirty();}));
  $$(".sw[data-stroke]",inspBody).forEach(s=>s.addEventListener("click",()=>{el.stroke=s.dataset.stroke;activateSwatch(s,"stroke");renderCanvas();markDirty();}));
  $("#f-del")&&$("#f-del").addEventListener("click",()=>deleteEl(el.id));
}
function activateSwatch(node,attr){node.parentElement.querySelectorAll(".sw").forEach(x=>x.classList.remove("active"));node.classList.add("active");}
function bindRange(id,onVal,fmt,labelName){const i=$("#"+id);if(!i)return;
  i.addEventListener("input",()=>{const v=Number(i.value);onVal(v);
    const lab=i.closest(".field")?.querySelector("label");if(lab&&labelName)lab.textContent=`${labelName} ${fmt?fmt(v):v}`;});
}
function seg(id,attr,onVal){const c=$("#"+id);if(!c)return;
  c.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
    c.querySelectorAll("button").forEach(x=>x.classList.remove("active"));b.classList.add("active");
    onVal(b.dataset[attr]);}));}
function syncInspectorPos(){const el=selEl();if(!el||inspTab!=="element")return;
  ["x","y","w","h"].forEach(k=>{const i=$("#f-"+k);if(i)i.value=el[k];});}
function renderInspectorSoft(){/* placeholder for partial refreshes */}

/* animate tab */
function animatePanel(el){
  let chips=Object.entries(ANIMS).map(([k,v])=>`<button class="chip ${el.anim===k?"active":""}" data-anim="${k}">${v.label}</button>`).join("");
  return `<div class="group"><span class="glabel">Entrance — this element</span>
    <div class="chiprow">${chips}</div></div>
    <div class="group">${field("Delay "+(el.animDelay||0).toFixed(1)+"s",`<input type="range" id="f-delay" min="0" max="2" step="0.1" value="${el.animDelay||0}">`)}</div>
    <div class="group"><button class="tbtn" id="f-preview" style="width:100%;justify-content:center"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 4 14 8-14 8z"/></svg> Preview animations</button></div>
    <div class="insp-empty" style="padding-top:.5rem">Entrance plays when the slide appears in <b>Present</b>. Set a per-element delay to stagger the reveal — the magazine trick.</div>`;
}
function bindAnimatePanel(el){
  $$(".chip[data-anim]",inspBody).forEach(c=>c.addEventListener("click",()=>{
    el.anim=c.dataset.anim;$$(".chip[data-anim]",inspBody).forEach(x=>x.classList.remove("active"));c.classList.add("active");markDirty();}));
  bindRange("f-delay",v=>{el.animDelay=v;markDirty();},v=>v.toFixed(1)+"s","Delay");
  $("#f-preview")&&$("#f-preview").addEventListener("click",previewAnimations);
}
function previewAnimations(){const s=curSlide();paintSlide(canvas,s,{live:true});
  // restore editor interactivity after the preview plays
  setTimeout(()=>renderCanvas(),1400);}

/* slide tab */
function slidePanel(){
  const s=curSlide();
  let bgs='<div class="bg-grid">';
  BACKGROUNDS.forEach((b,i)=>{const style=`background:${b.css};${b.size?`background-size:${b.size};`:""}`;
    bgs+=`<div class="bg-cell ${s.bg===b.css?"":""}" style="${style}" data-bgi="${i}"><span class="bgn">${b.name}</span></div>`;});
  bgs+="</div>";
  let trans=Object.entries(TRANSITIONS).map(([k,v])=>`<button class="chip ${s.transition===k?"active":""}" data-trans="${k}">${v}</button>`).join("");
  return `<div class="group"><span class="glabel">Slide background</span>${bgs}</div>
    <div class="group"><span class="glabel">Transition in</span><div class="chiprow">${trans}</div></div>
    <div class="group">
      <button class="tbtn" id="s-dup" style="width:100%;justify-content:center;margin-bottom:.5rem">Duplicate slide</button>
      <button class="del-el" id="s-del">Delete this slide</button>
    </div>`;
}
function bindSlidePanel(){
  const s=curSlide();
  $$(".bg-cell[data-bgi]",inspBody).forEach(c=>c.addEventListener("click",()=>{
    const b=BACKGROUNDS[Number(c.dataset.bgi)];s.bg=b.css;s.bgSize=b.size||null;renderAll();markDirty();}));
  $$(".chip[data-trans]",inspBody).forEach(c=>c.addEventListener("click",()=>{
    s.transition=c.dataset.trans;$$(".chip[data-trans]",inspBody).forEach(x=>x.classList.remove("active"));c.classList.add("active");markDirty();}));
  $("#s-dup")&&$("#s-dup").addEventListener("click",()=>{const copy=JSON.parse(JSON.stringify(s));copy.id=uid();copy.els.forEach(e=>e.id=uid());
    Deck.slides.splice(Deck.cur+1,0,copy);gotoSlide(Deck.cur+1);toast("Slide duplicated");});
  $("#s-del")&&$("#s-del").addEventListener("click",()=>deleteSlide(Deck.cur));
}

/* ════════════════════════════════════════════════════════════════════
   DRAWERS (templates / backgrounds)
   ════════════════════════════════════════════════════════════════════ */
function buildTplGallery(){
  const g=$("#tpl-grid");g.innerHTML="";
  TEMPLATES.forEach(tpl=>{
    const card=document.createElement("div");card.className="tpl";
    card.innerHTML=`<span class="tname">${tpl.name}</span>`;
    const mini=document.createElement("div");mini.className="mini";mini.style.width=W+"px";mini.style.height=H+"px";
    const built=tpl.build();paintSlide(mini,Object.assign(newSlide(),{bg:built.bg,bgSize:built.bgSize,els:built.els}),{live:false});
    requestAnimationFrame(()=>{mini.style.transform=`scale(${card.clientWidth/W})`;});
    card.appendChild(mini);
    card.addEventListener("click",()=>applyTemplate(tpl));
    g.appendChild(card);
  });
}
function buildBgGallery(){
  const g=$("#bg-grid");g.innerHTML="";
  BACKGROUNDS.forEach((b,i)=>{const cell=document.createElement("div");cell.className="bg-cell";
    cell.style.background=b.css;if(b.size)cell.style.backgroundSize=b.size;
    cell.innerHTML=`<span class="bgn">${b.name}</span>`;
    cell.addEventListener("click",()=>{const s=curSlide();s.bg=b.css;s.bgSize=b.size||null;renderAll();});
    g.appendChild(cell);});
}
function openDrawer(which){closeDrawers();$("#drawer-"+which).classList.add("open");
  $("#rail-tpl").classList.toggle("active",which==="tpl");$("#rail-bg").classList.toggle("active",which==="bg");}
function closeDrawers(){$$(".drawer").forEach(d=>d.classList.remove("open"));
  $("#rail-tpl").classList.remove("active");$("#rail-bg").classList.remove("active");}

/* ════════════════════════════════════════════════════════════════════
   PRESENT MODE  +  live audience emoji
   ════════════════════════════════════════════════════════════════════ */
const REACTIONS=["❤️","👏","🔥","😂","😮","💯","🎉","👍","✨","🙌","🤯","💜"];
const present   = $("#present");
const pCanvas   = $("#present-canvas");
const emojiLayer= $("#emoji-layer");
let pIndex=0;

function fitPresentCanvas(){
  const pad=0;const aw=window.innerWidth-pad, ah=window.innerHeight-pad;
  const z=Math.min(aw/W, ah/H);
  pCanvas.style.width=W+"px";pCanvas.style.height=H+"px";
  pCanvas.style.transform=`scale(${z})`;pCanvas.style.transformOrigin="center center";
}
function presentTransition(node,kind){
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
function showPresentSlide(i){
  pIndex=clamp(i,0,Deck.slides.length-1);
  const s=Deck.slides[pIndex];
  paintSlide(pCanvas,s,{live:true});
  presentTransition(pCanvas,s.transition||"fade");
  $("#pp-pos").textContent=`${pIndex+1} / ${Deck.slides.length}`;
  Live.goto(pIndex);
}
function enterPresent(){
  present.classList.add("on");
  document.body.style.overflow="hidden";
  $("#present-code").textContent=Deck.code;
  $("#sim-code").textContent=Deck.code;
  $("#sim-title").textContent=Deck.title;
  $("#present-url").textContent="hanns.live/"+Deck.code.toLowerCase();
  drawPresentQR();
  buildReactionPad();
  fitPresentCanvas();
  showPresentSlide(Deck.cur);
  Live.start(Deck.code);
}
function exitPresent(){present.classList.remove("on");document.body.style.overflow="";Live.stop();}
function drawPresentQR(){
  const box=$("#present-qr");box.innerHTML="";
  if(typeof QRCode==="undefined")return;
  new QRCode(box,{text:"https://hanns.live/"+Deck.code.toLowerCase(),width:84,height:84,
    colorDark:"#16140f",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
}
function buildReactionPad(){
  const g=$("#react-grid");g.innerHTML="";
  REACTIONS.forEach(em=>{const b=document.createElement("button");b.className="react";b.textContent=em;
    b.addEventListener("click",()=>Live.react(em));g.appendChild(b);});
}
function spawnEmoji(em){
  const e=document.createElement("div");e.className="emoji-fly";e.textContent=em;
  e.style.left=(8+Math.random()*84)+"%";
  e.style.setProperty("--spin",(Math.random()*40-20)+"deg");
  e.style.fontSize=(2+Math.random()*1.6)+"rem";
  emojiLayer.appendChild(e);
  setTimeout(()=>e.remove(),3700);
}

/* ── Live: local stand-in for the WebSocket layer ─────────────────────
   Replace these four methods with a real socket to go multi-device.
   start(code): open ws/hanns/<code>/ ; presenter_hello
   react(em):   send {type:"react",emoji} (or, here, echo locally)
   goto(i):     send {type:"goto",index:i}
   stop():      close
   Incoming {type:"reaction",emoji} → spawnEmoji(emoji).               */
const Live={
  _demo:null,
  start(code){
    // Demo heartbeat so you can SEE reactions flowing from "the audience".
    this.stop();
    this._demo=setInterval(()=>{
      if(Math.random()<0.7) spawnEmoji(REACTIONS[Math.random()*REACTIONS.length|0]);
    },900);
  },
  react(em){ spawnEmoji(em); /* + socket.send({type:"react",emoji:em}) */ },
  goto(i){ /* socket.send({type:"goto",index:i}) */ },
  stop(){ if(this._demo){clearInterval(this._demo);this._demo=null;} },
};

/* ════════════════════════════════════════════════════════════════════
   EXPORT (save / standalone html)
   ════════════════════════════════════════════════════════════════════ */
function download(name,blob){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),2000);}
function exportJSON(){
  const data=JSON.stringify({title:Deck.title,slides:Deck.slides,code:Deck.code},null,2);
  download((Deck.title||"deck").replace(/\s+/g,"_")+".hanns",new Blob([data],{type:"application/json"}));
  toast("Saved .hanns file");
}
function exportStandaloneHTML(){
  // A tiny self-running viewer with the deck embedded — opens in any browser.
  const deck=JSON.stringify({title:Deck.title,slides:Deck.slides});
  const html=STANDALONE_VIEWER.replace("/*__DECK__*/","window.__DECK__="+deck+";");
  download((Deck.title||"deck").replace(/\s+/g,"_")+".html",new Blob([html],{type:"text/html"}));
  toast("Exported standalone HTML");
}

/* ════════════════════════════════════════════════════════════════════
   WIRING
   ════════════════════════════════════════════════════════════════════ */
/* Server hooks injected by the Django editor template (editor.html):
   window.__HANNS__ = {deck:{…}, saveUrl, presentUrl, csrftoken}        */
const SRV = (window.__HANNS__||{});

function loadServerDeck(){
  const d = SRV.deck;
  if(d && Array.isArray(d.slides) && d.slides.length){
    Deck.title = d.title || "Untitled deck";
    Deck.code  = d.code  || Deck.code;
    Deck.slides = d.slides.map(s=>Object.assign(newSlide(),{
      id:String(s.id||uid()), bg:s.bg, bgSize:s.bgSize||null,
      transition:s.transition||"fade",
      els:(s.els||[]).map(e=>Object.assign({},e)),
    }));
  } else {
    // No slides yet — open on a title template so it's never blank.
    const b=TEMPLATES[0].build();
    Deck.slides=[Object.assign(newSlide(),{bg:b.bg,bgSize:b.bgSize||null,transition:"fade",els:b.els})];
    if(d&&d.title)Deck.title=d.title;
    if(d&&d.code)Deck.code=d.code;
  }
  Deck.cur=0;
}

/* Persist the whole deck to Django (deck_save). Debounced autosave + an
   explicit Save button both call this. */
let saveTimer=null, saving=false;
function deckPayload(){
  return {title:Deck.title, allow_reactions:true,
    slides:Deck.slides.map(s=>({bg:s.bg,bgSize:s.bgSize,transition:s.transition,els:s.els}))};
}
async function saveDeck(silent){
  if(!SRV.saveUrl||saving)return;
  saving=true;updateSaveState("saving");
  try{
    const r=await fetch(SRV.saveUrl,{method:"POST",
      headers:{"Content-Type":"application/json","X-CSRFToken":SRV.csrftoken||""},
      body:JSON.stringify(deckPayload())});
    if(!r.ok)throw new Error("save failed "+r.status);
    await r.json();
    updateSaveState("saved");
    if(!silent)toast("Saved");
  }catch(err){console.error(err);updateSaveState("error");if(!silent)toast("Couldn’t save — check your connection");}
  finally{saving=false;}
}
function scheduleSave(){updateSaveState("dirty");clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveDeck(true),1400);}
function updateSaveState(state){
  const b=$("#btn-save");if(!b)return;
  const map={saving:"Saving…",saved:"Saved",dirty:"Save",error:"Retry save"};
  b.dataset.state=state;const lbl=b.querySelector(".save-lbl");if(lbl)lbl.textContent=map[state]||"Save";
}

function init(){
  loadServerDeck();

  // rail add buttons
  $$(".rail .tool[data-add]").forEach(b=>b.addEventListener("click",()=>addElement(b.dataset.add)));
  $("#rail-tpl").addEventListener("click",()=>{const open=$("#drawer-tpl").classList.contains("open");open?closeDrawers():openDrawer("tpl");});
  $("#rail-bg").addEventListener("click",()=>{const open=$("#drawer-bg").classList.contains("open");open?closeDrawers():openDrawer("bg");});
  $$("[data-close-drawer]").forEach(b=>b.addEventListener("click",closeDrawers));
  $("#btn-templates").addEventListener("click",()=>openDrawer("tpl"));

  // filmstrip
  $("#add-slide").addEventListener("click",()=>addSlide());
  $("#nav-prev").addEventListener("click",()=>gotoSlide(Deck.cur-1));
  $("#nav-next").addEventListener("click",()=>gotoSlide(Deck.cur+1));

  // inspector tabs
  $$(".insp-tab").forEach(t=>t.addEventListener("click",()=>{inspTab=t.dataset.tab;renderInspector();}));

  // zoom
  $("#zoom-in").addEventListener("click",()=>{zoomMode=clamp((zoomMode==="fit"?fitZoom():zoom)+0.1,0.2,2);applyZoom();});
  $("#zoom-out").addEventListener("click",()=>{zoomMode=clamp((zoomMode==="fit"?fitZoom():zoom)-0.1,0.2,2);applyZoom();});
  $("#zoom-val").addEventListener("click",()=>{zoomMode="fit";applyZoom();});

  // title
  $("#deck-title").addEventListener("input",e=>{Deck.title=e.target.value||"Untitled deck";if(appReady)scheduleSave();});
  $("#deck-title").value=Deck.title;

  // present — save first, then open the server-rendered stage (real socket)
  $("#btn-present").addEventListener("click",async()=>{
    await saveDeck(true);
    if(SRV.presentUrl)window.location.href=SRV.presentUrl;
    else enterPresent(); // fallback (standalone)
  });
  $("#present-exit").addEventListener("click",exitPresent);
  $("#pp-prev").addEventListener("click",()=>showPresentSlide(pIndex-1));
  $("#pp-next").addEventListener("click",()=>showPresentSlide(pIndex+1));

  // save (explicit) + Ctrl/Cmd-S
  $("#btn-save")&&$("#btn-save").addEventListener("click",()=>saveDeck(false));
  document.addEventListener("keydown",e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();saveDeck(false);}
  });

  // keyboard
  document.addEventListener("keydown",e=>{
    if(present.classList.contains("on")){
      if(e.key==="Escape")exitPresent();
      else if(e.key==="ArrowRight"||e.key===" ")showPresentSlide(pIndex+1);
      else if(e.key==="ArrowLeft")showPresentSlide(pIndex-1);
      return;
    }
    const tag=(e.target.tagName||"").toLowerCase();
    const editing=e.target.isContentEditable||tag==="input"||tag==="textarea";
    if(editing)return;
    if((e.key==="Delete"||e.key==="Backspace")&&Deck.sel){e.preventDefault();deleteEl(Deck.sel);}
    else if(e.key==="ArrowRight")gotoSlide(Deck.cur+1);
    else if(e.key==="ArrowLeft")gotoSlide(Deck.cur-1);
  });

  window.addEventListener("resize",()=>{applyZoom();if(present.classList.contains("on"))fitPresentCanvas();renderFilmstrip();});

  buildTplGallery();buildBgGallery();
  renderAll();
  appReady=true;
  updateSaveState("saved");
}

/* the standalone viewer template (kept as a string; deck injected on export) */
const STANDALONE_VIEWER = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hanns deck</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Archivo:wght@400;500;600;700;800&family=Archivo+Expanded:wght@600;700;800&family=Spline+Sans+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:Archivo,sans-serif}
#st{position:fixed;inset:0;display:grid;place-items:center}
#cv{width:960px;height:540px;position:relative;overflow:hidden;transform-origin:center}
.el{position:absolute}.el-inner{width:100%;height:100%;position:relative}
.shape{width:100%;height:100%}.imgbox{width:100%;height:100%;background-size:cover;background-position:center}
.nav{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);display:flex;gap:.5rem;
background:rgba(20,18,14,.8);border:1px solid #333;border-radius:999px;padding:.4rem .6rem;z-index:5}
.nav button{background:0;border:0;color:#fff;font-size:1.1rem;cursor:pointer;width:30px;height:30px;border-radius:50%}
.nav button:hover{background:#fff2}.nav .p{color:#cfc6b2;font:.8rem 'Spline Sans Mono',monospace;padding:0 .4rem;align-self:center}
</style></head><body>
<div id="st"><div id="cv"></div></div>
<div class="nav"><button id="pv">‹</button><span class="p" id="po">1</span><button id="nx">›</button></div>
<script>/*__DECK__*/
var D=window.__DECK__,i=0,W=960,H=540,cv=document.getElementById("cv");
function paint(s,live){cv.innerHTML="";cv.style.background=s.bg;if(s.bgSize)cv.style.backgroundSize=s.bgSize;
 s.els.forEach(function(el){var n=document.createElement("div");n.className="el "+el.type;
  n.style.cssText="left:"+el.x+"px;top:"+el.y+"px;width:"+el.w+"px;height:"+el.h+"px;transform:rotate("+(el.rot||0)+"deg)";
  var inr=document.createElement("div");inr.className="el-inner";
  if(el.type==="text"){var t=document.createElement("div");
    t.style.cssText="width:100%;white-space:pre-wrap;font:"+(el.italic?"italic ":"")+el.weight+" "+el.size+"px/"+el.lh+" "+el.font+";color:"+el.color+";text-align:"+el.align+";letter-spacing:"+(el.ls||0)+"px";
    if(el.fill&&el.fill!=="none")n.style.background=el.fill;t.textContent=el.text;inr.appendChild(t);}
  else if(el.type==="rect"||el.type==="ellipse"){var sh=document.createElement("div");sh.className="shape";
    sh.style.background=el.fill;sh.style.borderRadius=el.type==="ellipse"?"50%":(el.radius||0)+"px";
    if(el.stroke&&el.stroke!=="none"&&el.strokeW)sh.style.border=el.strokeW+"px solid "+el.stroke;inr.appendChild(sh);}
  else if(el.type==="line"){var ln=document.createElement("div");ln.className="shape";ln.style.background=el.fill;ln.style.borderRadius="999px";inr.appendChild(ln);}
  else if(el.type==="image"){var im=document.createElement("div");im.className="imgbox";if(el.src){im.style.backgroundImage='url("'+el.src+'")';im.style.backgroundSize=el.fit;}im.style.borderRadius=(el.radius||0)+"px";inr.appendChild(im);}
  n.appendChild(inr);cv.appendChild(n);
  if(live&&el.anim&&el.anim!=="none"){var f={fade:[{opacity:0},{opacity:1}],rise:[{opacity:0,transform:"translateY(40px) rotate("+(el.rot||0)+"deg)"},{opacity:1,transform:"translateY(0) rotate("+(el.rot||0)+"deg)"}],drop:[{opacity:0,transform:"translateY(-40px)"},{opacity:1,transform:"translateY(0)"}],left:[{opacity:0,transform:"translateX(-60px)"},{opacity:1,transform:"translateX(0)"}],right:[{opacity:0,transform:"translateX(60px)"},{opacity:1,transform:"translateX(0)"}],zoom:[{opacity:0,transform:"scale(.6)"},{opacity:1,transform:"scale(1)"}],pop:[{opacity:0,transform:"scale(.3)"},{opacity:1,transform:"scale(1)"}],blur:[{opacity:0,filter:"blur(14px)"},{opacity:1,filter:"blur(0)"}],reveal:[{opacity:0,clipPath:"inset(0 100% 0 0)"},{opacity:1,clipPath:"inset(0 0 0 0)"}]};
   n.style.opacity=0;n.animate(f[el.anim]||f.fade,{duration:640,delay:(el.animDelay||0)*1000,easing:"cubic-bezier(.22,1,.36,1)",fill:"both"});}
 });}
function fit(){var z=Math.min(innerWidth/W,innerHeight/H);cv.style.transform="scale("+z+")";}
function go(n){i=Math.max(0,Math.min(n,D.slides.length-1));paint(D.slides[i],true);document.getElementById("po").textContent=(i+1)+" / "+D.slides.length;}
document.getElementById("nx").onclick=function(){go(i+1)};document.getElementById("pv").onclick=function(){go(i-1)};
addEventListener("keydown",function(e){if(e.key==="ArrowRight"||e.key===" ")go(i+1);if(e.key==="ArrowLeft")go(i-1)});
addEventListener("resize",fit);fit();go(0);
<\/script></body></html>`;

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();

})();