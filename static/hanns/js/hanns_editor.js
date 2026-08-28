/* ════════════════════════════════════════════════════════════════════
   HANNS — interaction layer (depends on logic_core's window.Hanns)
   ════════════════════════════════════════════════════════════════════ */
(function(){
"use strict";
const Hx = window.Hanns;
const {Deck,TEMPLATES,BACKGROUNDS,BG_FX,ANIMS,TRANSITIONS,PALETTE,FONTS,OBJECTS,SHAPES,
  newSlide,curSlide,selEl,paintSlide,renderElement,isStudioObject,motionOf,SHAPE_MOTIONS,MOTION_TYPES,
  makeText,makeShape,makeLine,makeImage,makeVideo,makeLink,makeObject,makeCreativeShape,makeTable,makeChart,makeMap,makeGallery,W,H,$,$$,uid,clamp,genCode}=Hx;

const canvas   = $("#canvas");
const wrap     = $("#canvas-wrap");
const stage    = $("#stage");
const slidesEl = $("#slides");
const inspBody = $("#insp-body");
let inspTab = "element";
let appReady = false;     // gates autosave until the deck has loaded
let zoom = 1;          // current canvas scale
let zoomMode = "fit";  // "fit" | number
let slideDragFrom = null;
let slideDragMoved = false;

// ── Undo / redo + clipboard ────────────────────────────────────────
// Keep the history entirely client-side. The existing save endpoint already
// persists the full deck JSON, so undo/redo only needs to restore Deck state
// and trigger the normal autosave afterwards.
const HISTORY_LIMIT = 80;
let undoStack = [];
let redoStack = [];
let lastHistory = "";
let historyLocked = false;
let internalClipboard = null;
let internalClipboardText = "";
let internalClipboardAt = 0;
// Multi-select is editor-only. Bound groups are saved as normal JSON elements.
let multiSel = new Set();

// ── Live collaboration ─────────────────────────────────────────────
const CLIENT_ID = "hanns-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
let collabSocket = null;
let collabReady = false;
let applyingRemoteDeck = false;

function deepClone(v){return JSON.parse(JSON.stringify(v));}
function cloneElement(el,offset=24,isChild=false){
  const copy=deepClone(el);
  copy.id=uid();
  if(!isChild){
    copy.x=clamp(Math.round((copy.x||0)+offset),0,Math.max(0,W-(copy.w||80)));
    copy.y=clamp(Math.round((copy.y||0)+offset),0,Math.max(0,H-(copy.h||40)));
  }
  if(Array.isArray(copy.children)){
    copy.children=copy.children.map(child=>cloneElement(child,0,true));
  }
  return copy;
}
function snapshotDeck(){
  return JSON.stringify({
    title:Deck.title,
    code:Deck.code,
    cur:Deck.cur,
    sel:Deck.sel,
    slides:Deck.slides,
  });
}
function restoreSnapshot(raw){
  const snap=typeof raw==="string"?JSON.parse(raw):raw;
  Deck.title=snap.title||"Untitled deck";
  Deck.code=snap.code||Deck.code;
  Deck.cur=clamp(Number(snap.cur)||0,0,Math.max(0,(snap.slides||[]).length-1));
  Deck.sel=snap.sel||null;
  multiSel.clear();
  Deck.slides=(snap.slides||[]).map(s=>Object.assign(newSlide(),deepClone(s)));
  const title=$("#deck-title"); if(title) title.value=Deck.title;
}
function resetHistory(){
  lastHistory=snapshotDeck();
  undoStack=[lastHistory];
  redoStack=[];
  updateUndoRedoButtons();
}
function pushHistory(){
  if(!appReady || historyLocked)return;
  const snap=snapshotDeck();
  if(snap===lastHistory)return;
  undoStack.push(snap);
  if(undoStack.length>HISTORY_LIMIT)undoStack.shift();
  lastHistory=snap;
  redoStack=[];
  updateUndoRedoButtons();
}
function syncDirtyAfterHistoryAction(){
  lastHistory=snapshotDeck();
  updateUndoRedoButtons();
  updateSaveState("dirty");
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>saveDeck(true),650);
}
function undo(){
  if(undoStack.length<=1){toast("Nothing to undo");return;}
  historyLocked=true;
  const current=undoStack.pop();
  redoStack.push(current);
  const prev=undoStack[undoStack.length-1];
  restoreSnapshot(prev);
  renderAll();
  historyLocked=false;
  syncDirtyAfterHistoryAction();
  toast("Undo");
}
function redo(){
  if(!redoStack.length){toast("Nothing to redo");return;}
  historyLocked=true;
  const snap=redoStack.pop();
  undoStack.push(snap);
  restoreSnapshot(snap);
  renderAll();
  historyLocked=false;
  syncDirtyAfterHistoryAction();
  toast("Redo");
}
function updateUndoRedoButtons(){
  const ub=$("#btn-undo"), rb=$("#btn-redo");
  if(ub){ub.disabled=undoStack.length<=1;ub.title="Undo (Ctrl+Z)";}
  if(rb){rb.disabled=redoStack.length===0;rb.title="Redo (Ctrl+Y or Ctrl+Shift+Z)";}
  updateBindButtons();
}
function normaliseClipboardPayload(payload){
  if(!payload)return null;
  if(payload.kind==="elements"&&Array.isArray(payload.elements)){
    return {kind:"elements",elements:deepClone(payload.elements)};
  }
  if(payload.kind==="element"&&payload.element){
    return {kind:"element",element:deepClone(payload.element)};
  }
  return null;
}
function encodeClipboardPayload(payload){
  const clean=normaliseClipboardPayload(payload);
  return clean?JSON.stringify({__hanns:true,version:2,...clean}):"";
}
function writeInternalClipboard(payload, clipboardData=null){
  const clean=normaliseClipboardPayload(payload);
  if(!clean)return "";
  internalClipboard=clean;
  internalClipboardText=encodeClipboardPayload(clean);
  internalClipboardAt=Date.now();
  // During a real copy/cut event, use event.clipboardData. This is the most
  // reliable path and does not need browser clipboard permission.
  if(clipboardData){
    try{clipboardData.setData("application/x-hanns", internalClipboardText);}catch(_){}
    try{clipboardData.setData("text/plain", internalClipboardText);}catch(_){}
  }
  // Best-effort async clipboard for copy/paste between Hanns tabs. Some
  // browsers block this without focus/permission, but the internal clipboard
  // and copy/cut event path above still keep Ctrl+C/Ctrl+X/Ctrl+V working.
  try{navigator.clipboard?.writeText?.(internalClipboardText);}catch(_){}
  return internalClipboardText;
}
function copySelected(clipboardData=null, silent=false){
  const els=selectedElements();
  if(!els.length){if(!silent)toast("Select an object first");return false;}
  const payload=els.length>1?{kind:"elements",elements:els}:{kind:"element",element:els[0]};
  writeInternalClipboard(payload,clipboardData);
  if(!silent)toast(els.length>1?`Copied ${els.length} objects`:"Copied");
  return true;
}
function cutSelected(clipboardData=null, silent=false){
  const els=selectedElements();
  if(!els.length){if(!silent)toast("Select an object first");return false;}
  const payload=els.length>1?{kind:"elements",elements:els}:{kind:"element",element:els[0]};
  writeInternalClipboard(payload,clipboardData);
  deleteSelected();
  if(!silent)toast(els.length>1?`Cut ${els.length} objects`:"Cut");
  return true;
}
function pasteHannsPayload(parsed){
  if(parsed&&parsed.__hanns&&parsed.kind==="element"&&parsed.element){
    pasteElement(parsed.element);return true;
  }
  if(parsed&&parsed.__hanns&&parsed.kind==="elements"&&Array.isArray(parsed.elements)){
    pasteElements(parsed.elements);return true;
  }
  return false;
}
async function pasteFromSystemText(){
  try{
    const txt=await navigator.clipboard?.readText?.();
    if(!txt)return false;
    const parsed=JSON.parse(txt);
    if(pasteHannsPayload(parsed))return true;
  }catch(_){}
  return false;
}
function pasteElement(el){
  const s=curSlide(); if(!s||!el)return false;
  const copy=cloneElement(el,28);
  s.els.push(copy);
  multiSel.clear();
  Deck.sel=copy.id;
  renderAll();
  markDirty();
  toast("Pasted");
  return true;
}
function pasteElements(elements){
  const s=curSlide(); if(!s||!Array.isArray(elements)||!elements.length)return false;
  const copies=elements.map(el=>cloneElement(el,28));
  s.els.push(...copies);
  multiSel=new Set(copies.map(e=>e.id));
  Deck.sel=copies[copies.length-1]?.id||null;
  renderAll();
  markDirty();
  toast(`Pasted ${copies.length} objects`);
  return true;
}
async function pasteFromSystemRich(){
  // Best-effort fallback for browsers that expose copied image files only via
  // the Async Clipboard API rather than `event.clipboardData.files`.
  try{
    if(!navigator.clipboard?.read)return false;
    const items=await navigator.clipboard.read();
    for(const item of items||[]){
      const imgType=(item.types||[]).find(t=>/^image\//i.test(t));
      if(!imgType)continue;
      const blob=await item.getType(imgType);
      const file=new File([blob], "pasted-image." + (imgType.split("/")[1]||"png"), {type:imgType});
      if(await addImageFiles([file]))return true;
    }
  }catch(_){ }
  return false;
}
async function pasteClipboard(){
  // Prefer the system clipboard first. This lets copied images/text/URLs from
  // outside Hanns win even if internalClipboard still contains an old object.
  if(await pasteFromSystemRich())return;
  if(await pasteFromSystemText())return;
  if(internalClipboard?.kind==="elements"&&Array.isArray(internalClipboard.elements)){
    pasteElements(internalClipboard.elements);
    return;
  }
  if(internalClipboard?.kind==="element"&&internalClipboard.element){
    pasteElement(internalClipboard.element);
    return;
  }
  toast("Nothing to paste");
}
function nudgeSelected(key,shift){
  const els=selectedElements(); if(!els.length)return false;
  const step=shift?10:1;
  let dx=0,dy=0;
  if(key==="ArrowLeft")dx=-step;
  else if(key==="ArrowRight")dx=step;
  else if(key==="ArrowUp")dy=-step;
  else if(key==="ArrowDown")dy=step;
  else return false;
  els.forEach(el=>{el.x=Math.round((el.x||0)+dx);el.y=Math.round((el.y||0)+dy);});
  renderCanvas();
  renderFilmstrip();
  syncInspectorPos();
  markDirty();
  return true;
}

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
  applySelectionDom();
  wireCanvasElements();
  $("#nav-pos").textContent=`${Deck.cur+1} / ${Deck.slides.length}`;
  applyZoom();
}
function renderFilmstrip(){
  const keepTop = slidesEl ? slidesEl.scrollTop : 0;
  slidesEl.innerHTML="";
  Deck.slides.forEach((s,i)=>{
    const th=document.createElement("div");
    th.className="thumb"+(i===Deck.cur?" active":"");
    th.draggable=true;
    th.dataset.index=i;
    th.title="Drag to reorder slides";
    th.innerHTML=`<span class="num">${i+1}</span><button class="dup" title="Duplicate slide" aria-label="Duplicate slide">⧉</button><button class="del" title="Delete" aria-label="Delete slide">✕</button><span class="drag-grip" title="Drag slide">⋮⋮</span>`;
    const mini=document.createElement("div");mini.className="mini";
    mini.style.width=W+"px";mini.style.height=H+"px";
    paintSlide(mini,s,{live:false});
    // scale mini into the thumb width
    requestAnimationFrame(()=>{const sc=th.clientWidth/W;mini.style.transform=`scale(${sc})`;});
    th.appendChild(mini);

    th.addEventListener("click",e=>{
      if(e.target.closest(".del")||e.target.closest(".dup"))return;
      if(slideDragMoved){slideDragMoved=false;return;}
      gotoSlide(i);
    });
    th.querySelector(".dup").addEventListener("click",e=>{e.stopPropagation();duplicateSlide(i);});
    th.querySelector(".del").addEventListener("click",e=>{e.stopPropagation();deleteSlide(i);});

    th.addEventListener("dragstart",e=>{
      slideDragFrom=i;
      slideDragMoved=false;
      th.classList.add("dragging");
      e.dataTransfer.effectAllowed="move";
      e.dataTransfer.setData("text/plain", String(i));
    });
    th.addEventListener("dragover",e=>{
      e.preventDefault();
      e.dataTransfer.dropEffect="move";
      $$(".thumb",slidesEl).forEach(x=>x.classList.remove("drop-target","drop-before","drop-after"));
      th.classList.add("drop-target");
      const r=th.getBoundingClientRect();
      th.classList.toggle("drop-before", e.clientY < r.top + r.height/2);
      th.classList.toggle("drop-after", e.clientY >= r.top + r.height/2);
    });
    th.addEventListener("dragleave",()=>th.classList.remove("drop-target","drop-before","drop-after"));
    th.addEventListener("drop",e=>{
      e.preventDefault();e.stopPropagation();
      const from = slideDragFrom!=null ? slideDragFrom : Number(e.dataTransfer.getData("text/plain"));
      const r=th.getBoundingClientRect();
      let to=i + (e.clientY >= r.top + r.height/2 ? 1 : 0);
      reorderSlide(from,to);
    });
    th.addEventListener("dragend",()=>{
      th.classList.remove("dragging");
      $$(".thumb",slidesEl).forEach(x=>x.classList.remove("drop-target","drop-before","drop-after"));
      slideDragFrom=null;
    });
    slidesEl.appendChild(th);
  });
  requestAnimationFrame(()=>{ if(slidesEl) slidesEl.scrollTop = keepTop; });
}

function reorderSlide(from,to){
  from=Number(from);to=Number(to);
  if(Number.isNaN(from)||Number.isNaN(to))return;
  if(from<0||from>=Deck.slides.length)return;
  // `to` is the insertion slot before removing the slide. If dragging down,
  // remove first means the target slot shifts left by one.
  if(to>from)to-=1;
  to=clamp(to,0,Deck.slides.length-1);
  if(from===to)return;
  const [moved]=Deck.slides.splice(from,1);
  Deck.slides.splice(to,0,moved);
  if(Deck.cur===from)Deck.cur=to;
  else if(from<Deck.cur && to>=Deck.cur)Deck.cur-=1;
  else if(from>Deck.cur && to<=Deck.cur)Deck.cur+=1;
  Deck.sel=null;
  slideDragMoved=true;
  renderAll();
  markDirty();
  toast("Slide order updated");
}
function renderAll(){renderCanvas();renderFilmstrip();renderInspector();updateNotesPanel();}
/* Call after any genuine content mutation (not navigation) to autosave. */
function markDirty(){if(appReady){pushHistory();if(typeof scheduleSave==="function")scheduleSave();}}

/* ════════════════════════════════════════════════════════════════════
   SLIDE ops
   ════════════════════════════════════════════════════════════════════ */
function gotoSlide(i){Deck.cur=clamp(i,0,Deck.slides.length-1);Deck.sel=null;renderAll();}
function addSlide(fromTpl){
  const s = fromTpl ? Object.assign(newSlide(),fromTpl) : newSlide();
  Deck.slides.splice(Deck.cur+1,0,s);
  gotoSlide(Deck.cur+1);
  markDirty();
  toast("Slide added");
}

function cloneSlide(slide){
  const copy = deepClone(slide || newSlide());
  copy.id = uid();
  delete copy.position;
  if(Array.isArray(copy.els)) copy.els.forEach(e=>{ e.id = uid(); });
  else copy.els = [];
  return Object.assign(newSlide(), copy);
}
function duplicateSlide(i=Deck.cur){
  if(!Deck.slides.length) return;
  i = clamp(Number(i)||0, 0, Deck.slides.length-1);
  const copy = cloneSlide(Deck.slides[i]);
  Deck.slides.splice(i+1, 0, copy);
  Deck.cur = i+1;
  Deck.sel = null;
  renderAll();
  markDirty();
  toast("Slide duplicated");
}
function deleteSlide(i){
  if(Deck.slides.length===1){toast("A deck needs at least one slide");return;}
  Deck.slides.splice(i,1);
  Deck.cur=clamp(Deck.cur,0,Deck.slides.length-1);Deck.sel=null;renderAll();markDirty();
}
function applyTemplate(tpl){
  const built=tpl.build();
  const s=curSlide();
  s.bg=built.bg;s.bgSize=built.bgSize||null;s.bgFx=built.bgFx||"none";
  s.els=built.els.map(e=>Object.assign({},e));
  Deck.sel=null;renderAll();markDirty();
  closeDrawers();toast(`Applied “${tpl.name}”`);
}

/* ── multi-select + bind/unbind ─────────────────────────────────── */
function topLevelEls(){return Array.from(canvas.children).filter(n=>n.classList&&n.classList.contains("el"));}
function currentElements(){const s=curSlide();return s&&Array.isArray(s.els)?s.els:[];}
function elById(id){return currentElements().find(e=>e.id===id)||null;}
function selectedIds(){
  const existing=new Set(currentElements().map(e=>e.id));
  multiSel=new Set([...multiSel].filter(id=>existing.has(id)));
  if(multiSel.size)return [...multiSel];
  return Deck.sel&&existing.has(Deck.sel)?[Deck.sel]:[];
}
function selectedElements(){return selectedIds().map(elById).filter(Boolean);}
function applySelectionDom(){
  const ids=new Set(selectedIds());
  const multi=ids.size>1;
  topLevelEls().forEach(n=>{
    const on=ids.has(n.dataset.id);
    n.classList.toggle("selected",on);
    n.classList.toggle("multi-selected",on&&multi);
    setMotionPaused(n,on);
  });
  updateBindButtons();
}

/* A selected shape holds still.
   Done inline rather than with a stylesheet rule: an inline declaration
   beats every selector in hanns.css regardless of specificity or source
   order, so there is no cascade argument to lose. Clearing the animation
   outright (rather than animation-play-state:paused) returns the shape to
   its untransformed position, so what you drag is where it will sit. */
function setMotionPaused(node,paused){
  const inner=node&&node.firstElementChild;
  if(!inner||!inner.classList||!inner.classList.contains("shape-motion"))return;
  inner.style.animation = paused ? "none" : "";
  inner.style.transform = paused ? "none" : "";
}
function updateBindButtons(){
  const count=selectedIds().length;
  const el=selEl();
  const bind=$("#btn-bind"), unbind=$("#btn-unbind");
  if(bind){bind.disabled=count<2;bind.title=count<2?"Select 2 or more objects to bind":"Bind selected objects (Ctrl/Cmd+G)";}
  if(unbind){unbind.disabled=!(el&&el.type==="group");unbind.title=(el&&el.type==="group")?"Unbind selected group (Ctrl/Cmd+Shift+G)":"Select a bound group to unbind";}
}
function selectEl(id,additive=false){
  if(additive){
    if(multiSel.has(id))multiSel.delete(id);
    else multiSel.add(id);
    if(multiSel.size===1){Deck.sel=[...multiSel][0];}
    else if(multiSel.size>1){Deck.sel=id;}
    else Deck.sel=null;
  }else{
    multiSel.clear();
    Deck.sel=id;
  }
  applySelectionDom();
  renderInspector();
}
function clearSelection(){Deck.sel=null;multiSel.clear();applySelectionDom();renderInspector();}
function boundsFor(els){
  const minX=Math.min(...els.map(e=>Number(e.x)||0));
  const minY=Math.min(...els.map(e=>Number(e.y)||0));
  const maxX=Math.max(...els.map(e=>(Number(e.x)||0)+(Number(e.w)||0)));
  const maxY=Math.max(...els.map(e=>(Number(e.y)||0)+(Number(e.h)||0)));
  return {x:minX,y:minY,w:Math.max(20,maxX-minX),h:Math.max(20,maxY-minY)};
}
function bindSelected(){
  const s=curSlide();const ids=selectedIds();
  if(!s||ids.length<2){toast("Select 2 or more objects, then click Bind");return;}
  const all=currentElements();
  const picked=all.filter(e=>ids.includes(e.id));
  if(picked.length<2){toast("Select 2 or more objects, then click Bind");return;}
  const b=boundsFor(picked);
  const children=picked.map(e=>{const c=deepClone(e);c.x=Math.round((c.x||0)-b.x);c.y=Math.round((c.y||0)-b.y);return c;});
  const firstIndex=Math.min(...picked.map(e=>all.findIndex(x=>x.id===e.id)).filter(i=>i>=0));
  const group={id:uid(),type:"group",x:b.x,y:b.y,w:b.w,h:b.h,rot:0,anim:"none",animDelay:0,name:"Bound group",children};
  s.els=all.filter(e=>!ids.includes(e.id));
  s.els.splice(Math.max(0,firstIndex),0,group);
  multiSel.clear();Deck.sel=group.id;
  renderAll();markDirty();toast(`Bound ${children.length} objects`);
}
function unbindSelected(){
  const s=curSlide();const group=selEl();
  if(!s||!group||group.type!=="group"||!Array.isArray(group.children)){toast("Select a bound group first");return;}
  const idx=s.els.findIndex(e=>e.id===group.id);
  const children=group.children.map(child=>{
    const c=deepClone(child);c.id=uid();
    c.x=Math.round((group.x||0)+(c.x||0));
    c.y=Math.round((group.y||0)+(c.y||0));
    c.rot=Math.round((c.rot||0)+(group.rot||0));
    if(Array.isArray(c.children))c.children=c.children.map(ch=>cloneElement(ch,0,true));
    return c;
  });
  s.els.splice(idx,1,...children);
  multiSel=new Set(children.map(e=>e.id));Deck.sel=children[children.length-1]?.id||null;
  renderAll();markDirty();toast(`Unbound ${children.length} objects`);
}
function deleteSelected(){
  const ids=selectedIds();
  if(!ids.length)return;
  const s=curSlide();s.els=s.els.filter(e=>!ids.includes(e.id));
  Deck.sel=null;multiSel.clear();renderAll();markDirty();
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
  else if(kind==="video"){el=makeVideo({x:W/2-320,y:H/2-180});}
  else if(kind==="gallery"){el=makeGallery({x:W/2-300,y:H/2-200});}
  else if(kind==="teleprompter"){el=makeObject("teleprompter",{x:W-330,y:H-160,script:""});}
  else if(kind==="link"){el=makeLink({x:W/2-260,y:H/2-60});}
  else if(kind==="object"){el=makeObject("water_glass",{x:W/2-115,y:H/2-150});}
  else if(kind==="table"){el=makeTable({x:W/2-310,y:H/2-145});}
  else if(kind==="chart"){el=makeChart("bar",{x:W/2-325,y:H/2-165});}
  else if(kind==="graph"){el=makeChart("line",{x:W/2-325,y:H/2-165,title:"Growth graph",accent:"#22c55e"});}
  else if(kind==="map"){el=makeMap("gambia",{x:W/2-325,y:H/2-180});}
  else if(kind==="creative_shape"){el=makeCreativeShape("blob_01",{x:W/2-120,y:H/2-120});}
  else if(kind==="freeform"){
    el=Hx.makeFreeform("polygon",{x:W/2-130,y:H/2-130});
  }
  else if(kind==="focus"){
    // Drop the region a little off-centre so it does not land exactly on
    // top of whatever the author just placed in the middle.
    el=Hx.makeFocus({x:W/2-240,y:H/2-110,w:220,h:220,label:"Zoom "+(focusCountOnSlide()+1)});
  }
  if(!el)return;
  s.els.push(el);multiSel.clear();Deck.sel=el.id;renderAll();markDirty();
  if(kind==="image")pickImageFor(el.id);
  if(kind==="gallery")pickGalleryPhotos(el.id);
  if(kind==="teleprompter"){
    // Jump straight into the script box so the presenter can start typing/pasting.
    setTimeout(()=>{
      const ta=$("#f-tp-script");
      if(ta){ta.focus();ta.scrollIntoView({block:"center",behavior:"smooth"});}
    },60);
  }
}
/* How many zoom regions this slide already has — only used to name the
   next one ("Zoom 1", "Zoom 2") so the phone list reads sensibly. */
function focusCountOnSlide(){
  return currentElements().filter(e=>e&&e.type==="focus").length;
}

/* Show the author exactly what the room will see when this region is
   called up. Paints the callout over the editor canvas, then clears it.
   This is a rehearsal, not state — nothing is saved and the socket is
   not touched. */
function previewFocus(el){
  if(!Hx.showFocus||!el)return;
  // Repaint in live mode first so the callout magnifies the SLIDE, not the
  // editor's selection outlines and drag handles.
  paintSlide(canvas,curSlide(),{live:true,revealAll:true});

  // The panel holds a copy of the stage, so it has to be taken AFTER the
  // entrances have landed — clone the slide on its first frame and every
  // animated element is still at opacity 0, i.e. an empty circle. Wait for
  // the entrances to finish, with a hard cap because looping animations
  // (idle actors, moving backgrounds) never resolve.
  const show=()=>{
    Hx.showFocus(canvas,el);
    clearTimeout(previewFocus._t);
    previewFocus._t=setTimeout(()=>{
      Hx.hideFocus&&Hx.hideFocus(canvas,{instant:true});renderCanvas();
    },4200);
  };
  let anims=[];
  try{ anims=canvas.getAnimations?canvas.getAnimations({subtree:true}):[]; }catch(e){ anims=[]; }
  const settled=anims.length
    ? Promise.all(anims.map(a=>a.finished.catch(()=>{})))
    : Promise.resolve();
  Promise.race([settled,new Promise(r=>setTimeout(r,1500))]).then(show);
}

function addObject(kind){
  const d=(OBJECTS||[]).find(o=>o.kind===kind);
  const el=makeObject(kind,{x:Math.round(W/2-(d?.w||320)/2),y:Math.round(H/2-(d?.h||220)/2)});
  curSlide().els.push(el);multiSel.clear();Deck.sel=el.id;renderAll();markDirty();closeDrawers();
}
function addCreativeShape(kind){
  const d=(SHAPES||[]).find(s=>s.kind===kind)||SHAPES[0];
  const el=makeCreativeShape(kind,{x:Math.round(W/2-120),y:Math.round(H/2-120),fill:d.accent||"#e8482b"});
  curSlide().els.push(el);multiSel.clear();Deck.sel=el.id;renderAll();markDirty();closeDrawers();
}
function deleteEl(id){const s=curSlide();s.els=s.els.filter(e=>e.id!==id);
  if(Deck.sel===id)Deck.sel=null;multiSel.delete(id);renderAll();markDirty();}

function moveElementLayer(action){
  const s=curSlide();const el=selEl();if(!s||!el)return;
  const i=s.els.findIndex(x=>x.id===el.id);
  if(i<0)return;
  let ni=i;
  if(action==="front")ni=s.els.length-1;
  else if(action==="back")ni=0;
  else if(action==="forward")ni=Math.min(s.els.length-1,i+1);
  else if(action==="backward")ni=Math.max(0,i-1);
  if(ni===i){toast(action==="front"?"Already in front":action==="back"?"Already behind":"No layer change");return;}
  s.els.splice(i,1);
  s.els.splice(ni,0,el);
  Deck.sel=el.id;
  renderAll();markDirty();
  toast(action==="front"?"Brought to front":action==="back"?"Sent behind":action==="forward"?"Moved forward":"Moved backward");
}

/* image picker + universal image import */
let pendingImgId=null;
function pickImageFor(id){pendingImgId=id;$("#img-input").click();}
// Gallery: multi-select photos appended to el.photos
let pendingGalleryId=null;
function pickGalleryPhotos(id){pendingGalleryId=id;const inp=$("#gallery-input");if(inp){inp.value="";inp.click();}}
async function addGalleryPhotos(galleryId, files){
  const el=curSlide().els.find(x=>x.id===galleryId);
  if(!el)return;
  if(!Array.isArray(el.photos))el.photos=[];
  let added=0;
  for(const file of files){
    try{
      const src=await fileToDataURL(file);
      el.photos.push({src, caption:""});
      added++;
    }catch(err){ toast("Couldn't add "+(file.name||"a photo")); }
  }
  if(added){renderAll();markDirty();toast(added+" photo"+(added>1?"s":"")+" added");}
}
function isImageFile(file){return !!file && ((file.type||"").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(file.name||""));}
async function uploadImageBlob(blob,name="image.png"){
  if(!SRV.imageUploadUrl)throw new Error("Image upload URL is missing");
  const safeName=String(name||"image.png").replace(/[^\w.\-]+/g,"_")||"image.png";
  const fd=new FormData();
  fd.append("image",blob,safeName);
  const r=await fetch(SRV.imageUploadUrl,{method:"POST",headers:{"X-CSRFToken":SRV.csrftoken||""},body:fd});
  let data=null;try{data=await r.json();}catch(_){ }
  if(!r.ok||!data||!data.ok||!data.url)throw new Error((data&&data.error)||("Image upload failed "+r.status));
  return data.url;
}
function readFileAsDataURL(file){
  return new Promise((resolve,reject)=>{
    const rd=new FileReader();
    rd.onload=()=>resolve(rd.result);
    rd.onerror=()=>reject(rd.error||new Error("Could not read image"));
    rd.readAsDataURL(file);
  });
}
function dataURLToBlob(dataURL){
  const parts=String(dataURL||"").split(",");
  const meta=parts[0]||"";
  const mime=(meta.match(/data:([^;]+)/)||[])[1]||"image/png";
  const bin=atob(parts.slice(1).join(","));
  const bytes=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
  return new Blob([bytes],{type:mime});
}
async function persistImageSource(src,name="image.png"){
  const val=String(src||"");
  if(/^data:image\//i.test(val)){
    const ext=((val.match(/^data:image\/([a-z0-9+.-]+)/i)||[])[1]||"png").replace("jpeg","jpg").replace("svg+xml","svg");
    return await uploadImageBlob(dataURLToBlob(val), name && /\.[a-z0-9]+$/i.test(name)?name:("image."+ext));
  }
  if(/^blob:/i.test(val)){
    const blob=await fetch(val).then(r=>r.blob());
    return await uploadImageBlob(blob,name||"image.png");
  }
  return val;
}
async function fileToDataURL(file){
  // Despite the historic name, this now returns a stable media URL when the
  // Django upload endpoint exists. Storing base64 data URLs inside slide JSON
  // makes autosave exceed DATA_UPLOAD_MAX_MEMORY_SIZE once users paste images.
  if(SRV.imageUploadUrl)return await uploadImageBlob(file,file.name||"image.png");
  if((file.size||0)>750*1024)throw new Error("Image upload endpoint missing for large image");
  return await readFileAsDataURL(file);
}
function canvasPointFromEvent(e){
  const r=canvas.getBoundingClientRect();
  const z=zoom||1;
  return {
    x:clamp(Math.round((e.clientX-r.left)/z),0,W),
    y:clamp(Math.round((e.clientY-r.top)/z),0,H),
  };
}
function guessImageSize(src, fallbackW=330, fallbackH=210){
  return new Promise(resolve=>{
    const im=new Image();
    im.onload=()=>{
      const ratio=(im.naturalWidth||fallbackW)/(im.naturalHeight||fallbackH);
      let w=Math.min(420,Math.max(120,im.naturalWidth||fallbackW));
      let h=Math.round(w/ratio);
      if(h>320){h=320;w=Math.round(h*ratio);}
      resolve({w,h});
    };
    im.onerror=()=>resolve({w:fallbackW,h:fallbackH});
    im.src=src;
  });
}
async function addImageSource(src,{x=W/2-170,y=H/2-105,name="Image",select=true}={}){
  if(!src)return null;
  try{src=await persistImageSource(src,name||"image.png");}
  catch(err){console.warn("Hanns image persist failed",err);toast("Image upload failed");return null;}
  const size=await guessImageSize(src);
  const el=makeImage(src,{
    x:clamp(Math.round(x),0,Math.max(0,W-size.w)),
    y:clamp(Math.round(y),0,Math.max(0,H-size.h)),
    w:size.w,h:size.h,
    alt:name||"Image",
  });
  curSlide().els.push(el);
  if(select){multiSel.clear();Deck.sel=el.id;}
  renderAll();markDirty();
  return el;
}
async function addImageFiles(files,origin){
  const imgs=[...(files||[])].filter(isImageFile);
  if(!imgs.length)return 0;
  const base=origin||{x:W/2-170,y:H/2-105};
  let n=0;
  for(const file of imgs){
    try{
      const src=await fileToDataURL(file);
      await addImageSource(src,{x:base.x+(n%3)*34,y:base.y+Math.floor(n/3)*34,name:file.name||"Image",select:true});
      n++;
    }catch(err){console.warn("Hanns image import failed",err);}
  }
  if(n)toast(n===1?"Image added":"Images added: "+n);
  return n;
}
function isLikelyImageUrl(url){
  if(!url)return false;
  const u=String(url).trim();
  return /^data:image\//i.test(u) || /^blob:/i.test(u) || /^https?:\/\//i.test(u) && (/\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|#|$)/i.test(u) || /images?\./i.test(u) || /unsplash|pexels|pixabay|cloudinary|imgur|googleusercontent|fbcdn|twimg|cdn/i.test(u));
}
function extractImageUrlsFromHtml(html){
  const urls=[];
  if(!html)return urls;
  try{
    const doc=new DOMParser().parseFromString(html,"text/html");
    doc.querySelectorAll("img,source").forEach(img=>{
      const src=img.getAttribute("src")||img.getAttribute("data-src")||img.getAttribute("srcset")||"";
      if(src){
        const first=src.split(",")[0].trim().split(/\s+/)[0];
        if(first)urls.push(first);
      }
    });
  }catch(_){ }
  const re=/url\(["']?([^"')]+)["']?\)|https?:[^\s"'<>]+?\.(?:png|jpe?g|gif|webp|svg|bmp|avif)(?:\?[^\s"'<>]*)?/ig;
  let m;
  while((m=re.exec(html))){urls.push((m[1]||m[0]||"").trim());}
  return [...new Set(urls)].filter(Boolean);
}
async function addImageUrls(urls,origin){
  const clean=[...new Set((urls||[]).map(x=>String(x||"").trim()).filter(Boolean))];
  let n=0;
  const base=origin||{x:W/2-170,y:H/2-105};
  for(const url of clean){
    if(!isLikelyImageUrl(url))continue;
    await addImageSource(url,{x:base.x+(n%3)*34,y:base.y+Math.floor(n/3)*34,name:"Web image",select:true});
    n++;
  }
  if(n)toast(n===1?"Web image added":"Web images added: "+n);
  return n;
}
async function collectImageFilesFromItems(items){
  const out=[];
  async function walkEntry(entry){
    if(!entry)return;
    if(entry.isFile){
      await new Promise(resolve=>entry.file(file=>{if(isImageFile(file))out.push(file);resolve();},()=>resolve()));
    }else if(entry.isDirectory){
      const reader=entry.createReader();
      let batch=[];
      do{
        batch=await new Promise(resolve=>reader.readEntries(resolve,()=>resolve([])));
        for(const child of batch)await walkEntry(child);
      }while(batch.length);
    }
  }
  for(const item of [...(items||[])]){
    const entry=item.webkitGetAsEntry?.();
    if(entry) await walkEntry(entry);
    else{
      const f=item.getAsFile?.();
      if(isImageFile(f))out.push(f);
    }
  }
  return out;
}
$("#img-input").addEventListener("change",async e=>{
  const files=[...(e.target.files||[])].filter(isImageFile);
  if(!files.length){pendingImgId=null;e.target.value="";return;}
  if(pendingImgId){
    const file=files[0];
    const src=await fileToDataURL(file);
    const el=curSlide().els.find(x=>x.id===pendingImgId);
    if(el){el.src=src;el.alt=file.name||el.alt||"Image";renderAll();markDirty();toast("Image replaced");}
  }else{
    await addImageFiles(files);
  }
  pendingImgId=null;e.target.value="";
});

const galleryInput=$("#gallery-input");
if(galleryInput){
  galleryInput.addEventListener("change",async e=>{
    const files=[...(e.target.files||[])].filter(isImageFile);
    const gid=pendingGalleryId;pendingGalleryId=null;e.target.value="";
    if(gid && files.length)await addGalleryPhotos(gid, files);
  });
}

$("#data-input")&&$("#data-input").addEventListener("change",e=>{
  const f=e.target.files[0];
  if(f&&pendingImport){
    const el=selEl();
    if(el&&el.id===pendingImport.id){importDataFile(f,pendingImport.kind);}
  }
  pendingImport=null;e.target.value="";
});

/* ════════════════════════════════════════════════════════════════════
   CANVAS interaction: select, drag, resize, rotate, inline text edit
   All maths happen in slide space (divide pointer deltas by zoom).
   ════════════════════════════════════════════════════════════════════ */
function wireCanvasElements(){
  topLevelEls().forEach(node=>{
    const id=node.dataset.id;
    node.addEventListener("pointerdown",e=>{
      if(e.target.closest("[data-handle]"))return; // handled below
      if(e.target.isContentEditable&&node.classList.contains("selected"))return; // editing text
      selectEl(id,e.shiftKey||e.metaKey||e.ctrlKey);startDrag(e,node,id);
    });
    // image element: click placeholder to choose a file
    if(node.classList.contains("image")){
      node.addEventListener("dblclick",()=>pickImageFor(id));
    }
    // text: double-click enters edit mode; blur/Esc/Ctrl+Enter returns to move mode.
    // Important: text is NOT permanently contenteditable, otherwise clicks on text
    // stop the parent drag handler and the user cannot move the text after editing.
    const ce=node.querySelector("[data-text-inner]");
    if(ce){
      const commitText=()=>{const el=curSlide().els.find(x=>x.id===id);
        if(el){el.text=ce.innerText;renderFilmstrip();markDirty();}
        ce.setAttribute("contenteditable","false");
        node.classList.remove("text-editing");
        window.getSelection()?.removeAllRanges?.();
      };
      node.addEventListener("dblclick",e=>{
        e.preventDefault();e.stopPropagation();selectEl(id);
        ce.setAttribute("contenteditable","true");node.classList.add("text-editing");ce.focus();
        const range=document.createRange();range.selectNodeContents(ce);
        const sel=window.getSelection();sel.removeAllRanges();sel.addRange(range);
      });
      ce.addEventListener("blur",commitText);
      ce.addEventListener("keydown",e=>{
        if(e.key==="Escape" || ((e.ctrlKey||e.metaKey)&&e.key==="Enter")){e.preventDefault();ce.blur();}
      });
      ce.addEventListener("pointerdown",e=>{if(ce.isContentEditable&&document.activeElement===ce)e.stopPropagation();});
    }
    // freeform: vertex editing right on the canvas
    decorateFreeform(node,id);

    // handles
    $$("[data-handle]",node).forEach(h=>{
      h.addEventListener("pointerdown",e=>{e.stopPropagation();selectEl(id,false);
        if(h.dataset.handle==="rot")startRotate(e,node,id);
        else startResize(e,node,id,h.dataset.handle);});
    });
  });
}
/* ── freeform vertex editing ─────────────────────────────────────────
   Dots appear on the selected shape: solid ones are its points, hollow
   ones sit at the midpoints and add a new point where you click. The
   path is redrawn live while dragging rather than re-rendering the whole
   canvas, so reshaping stays smooth on a busy slide.

   The moment a point moves, the preset's generated points are committed
   onto the element. After that the sides/inner-radius sliders no longer
   regenerate anything — losing hand-placed points to a stray slider nudge
   would be the worst possible surprise. "Back to the preset shape" in the
   inspector is the way out. */
function ensureFreeformEditorCss(){
  if(document.getElementById("hanns-ff-css"))return;
  const st=document.createElement("style");
  st.id="hanns-ff-css";
  st.textContent=`
.ff-vtx-layer{position:absolute;inset:0;pointer-events:none;z-index:6}
.ff-vtx{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;
  background:#fff;border:2px solid #8b5cf6;box-shadow:0 1px 4px rgba(0,0,0,.35);
  cursor:grab;pointer-events:auto;touch-action:none}
.ff-vtx:hover{background:#8b5cf6;border-color:#fff}
.ff-vtx.dragging{cursor:grabbing;background:#8b5cf6}
.ff-mid{position:absolute;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;
  background:rgba(255,255,255,.55);border:1.5px dashed #8b5cf6;cursor:copy;
  pointer-events:auto;opacity:.55;touch-action:none}
.ff-mid:hover{opacity:1;background:#fff}
`;
  (document.head||document.documentElement).appendChild(st);
}

function decorateFreeform(node,id){
  const el=elById(id);
  if(!el||el.type!=="freeform")return;
  if(!node.classList.contains("selected")||multiSel.size>1)return;
  if(!Hx.freeformPoints||!Hx.freeformPath)return;
  ensureFreeformEditorCss();

  const layer=document.createElement("div");
  layer.className="ff-vtx-layer";
  node.appendChild(layer);

  const pathOf=()=>node.querySelector(".freeform-path");
  const redraw=()=>{
    const p=pathOf();
    if(p)p.setAttribute("d",Hx.freeformPath(el.points,{
      closed:el.closed!==false, corner:el.corner, smooth:!!el.smooth}));
  };
  // Turn the preset into real, owned points before the first edit.
  const commit=()=>{
    if(!Array.isArray(el.points)||el.points.length<2){
      el.points=Hx.freeformPoints(el).map(p=>({x:p.x,y:p.y}));
    }
    return el.points;
  };

  /* The dots have to live in the SAME space as the artwork.
     Two transforms sit between a point's 0–100 coordinate and the pixel
     the user sees: rotate() on .el, and the Effects transform (flip,
     3-D tilt) on .el-inner. Ignoring them put the dots somewhere the
     shape is not, and — worse — made a drag travel the wrong way, since
     a flip mirrors the axis the pointer is moving along. Both flips on
     meant right went left and down went up.

     So: project a point THROUGH the transform to place its dot, and push
     the pointer delta back through the INVERSE to work out what the user
     actually meant. As a bonus this makes dragging a rotated shape
     behave, which it never did. */
  const matOf=n=>{
    try{
      const t=getComputedStyle(n).transform;
      return (!t||t==="none")?new DOMMatrix():new DOMMatrix(t);
    }catch(e){ return null; }
  };
  const inner=node.querySelector(".el-inner")||node;
  const mIn=matOf(inner), mNode=matOf(node);
  const cx=()=>(Number(el.w)||1)/2, cy=()=>(Number(el.h)||1)/2;

  // 0–100 shape coordinate → pixels inside .el, as actually drawn.
  const project=p=>{
    const px=p.x/100*(Number(el.w)||1), py=p.y/100*(Number(el.h)||1);
    if(!mIn)return {x:px,y:py};
    try{
      const q=mIn.transformPoint(new DOMPoint(px-cx(),py-cy(),0,1));
      const w=q.w||1;
      return {x:cx()+q.x/w, y:cy()+q.y/w};
    }catch(e){ return {x:px,y:py}; }
  };
  // Screen travel (already un-zoomed) → travel in the shape's own box.
  const unproject=(dxPx,dyPx)=>{
    const flat=()=>({dx:dxPx/Math.max(1,el.w)*100, dy:dyPx/Math.max(1,el.h)*100});
    if(!mIn||!mNode)return flat();
    try{
      const inv=mNode.multiply(mIn).inverse();
      const at=(x,y)=>{const q=inv.transformPoint(new DOMPoint(x,y,0,1));
        const w=q.w||1;return {x:q.x/w,y:q.y/w};};
      const a=at(0,0), b=at(dxPx,dyPx);
      return {dx:(b.x-a.x)/Math.max(1,el.w)*100, dy:(b.y-a.y)/Math.max(1,el.h)*100};
    }catch(e){ return flat(); }
  };

  const pts=Hx.freeformPoints(el);
  const place=(n,p)=>{const q=project(p);n.style.left=q.x+"px";n.style.top=q.y+"px";};

  pts.forEach((p,i)=>{
    const dot=document.createElement("div");
    dot.className="ff-vtx";
    dot.title="Drag to reshape · Alt-click to remove";
    place(dot,p);
    dot.addEventListener("pointerdown",ev=>{
      ev.stopPropagation();ev.preventDefault();
      const list=commit();
      if(ev.altKey){
        if(list.length<=3){setStatusSafe("A shape needs at least three points.");return;}
        list.splice(i,1);renderCanvas();renderInspector();markDirty();return;
      }
      dot.classList.add("dragging");
      dot.setPointerCapture&&dot.setPointerCapture(ev.pointerId);
      const sx=ev.clientX, sy=ev.clientY;
      const o={x:list[i].x, y:list[i].y};
      const mv=e2=>{
        // Pointer travel → the shape's own 0–100 box: un-zoom for the
        // canvas, then un-rotate and un-flip so the point follows the
        // mouse rather than mirroring it.
        const d=unproject((e2.clientX-sx)/zoom,(e2.clientY-sy)/zoom);
        let nx=o.x+d.dx, ny=o.y+d.dy;
        if(e2.shiftKey){nx=Math.round(nx/5)*5;ny=Math.round(ny/5)*5;}
        list[i].x=Math.round(nx*100)/100;
        list[i].y=Math.round(ny*100)/100;
        place(dot,list[i]);
        redraw();
      };
      const up=()=>{
        document.removeEventListener("pointermove",mv);
        document.removeEventListener("pointerup",up);
        dot.classList.remove("dragging");
        renderCanvas();renderFilmstrip();markDirty();
      };
      document.addEventListener("pointermove",mv);
      document.addEventListener("pointerup",up);
    });
    layer.appendChild(dot);
  });

  // Midpoint "add a point here" dots. An open path has no closing edge,
  // so it gets one fewer.
  const closed=el.closed!==false;
  const edges=closed?pts.length:pts.length-1;
  for(let i=0;i<edges;i++){
    const a=pts[i], b=pts[(i+1)%pts.length];
    const mid={x:(a.x+b.x)/2, y:(a.y+b.y)/2};
    const dot=document.createElement("div");
    dot.className="ff-mid";
    dot.title="Click to add a point here";
    place(dot,mid);
    dot.addEventListener("pointerdown",ev=>{
      ev.stopPropagation();ev.preventDefault();
      const list=commit();
      list.splice(i+1,0,{x:mid.x,y:mid.y});
      renderCanvas();renderInspector();markDirty();
    });
    layer.appendChild(dot);
  }
}
function setStatusSafe(msg){
  try{ if(typeof toast==="function")toast(msg); else console.info(msg); }catch(e){}
}

function startDrag(e,node,id){
  const el=elById(id);if(!el)return;
  const moving=(multiSel.size>1&&multiSel.has(id))?selectedElements():[el];
  const start=moving.map(x=>({el:x,x:Number(x.x)||0,y:Number(x.y)||0}));
  const sx=e.clientX, sy=e.clientY;
  const mv=ev=>{
    const dx=Math.round((ev.clientX-sx)/zoom), dy=Math.round((ev.clientY-sy)/zoom);
    start.forEach(o=>{o.el.x=o.x+dx;o.el.y=o.y+dy;});
    if(moving.length===1){node.style.left=el.x+"px";node.style.top=el.y+"px";}
    else renderCanvas();
  };
  const up=()=>{document.removeEventListener("pointermove",mv);document.removeEventListener("pointerup",up);renderFilmstrip();syncInspectorPos();markDirty();};
  document.addEventListener("pointermove",mv);document.addEventListener("pointerup",up);
}
function startResize(e,node,id,corner){
  const el=curSlide().els.find(x=>x.id===id);if(!el)return;
  const sx=e.clientX, sy=e.clientY;
  const o={x:el.x,y:el.y,w:el.w,h:el.h,children:Array.isArray(el.children)?deepClone(el.children):null};
  const mv=ev=>{
    const dx=(ev.clientX-sx)/zoom, dy=(ev.clientY-sy)/zoom;
    let {x,y,w,h}=o;
    if(corner.includes("e"))w=Math.max(20,o.w+dx);
    if(corner.includes("s"))h=Math.max(12,o.h+dy);
    if(corner.includes("w")){w=Math.max(20,o.w-dx);x=o.x+dx;}
    if(corner.includes("n")){h=Math.max(12,o.h-dy);y=o.y+dy;}
    el.x=Math.round(x);el.y=Math.round(y);el.w=Math.round(w);el.h=Math.round(h);
    if(el.type==="group"&&o.children&&o.w&&o.h){
      const rx=el.w/o.w, ry=el.h/o.h;
      el.children=o.children.map(c=>{const cc=deepClone(c);cc.x=Math.round((c.x||0)*rx);cc.y=Math.round((c.y||0)*ry);cc.w=Math.round((c.w||0)*rx);cc.h=Math.round((c.h||0)*ry);return cc;});
    }
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
canvas.addEventListener("pointerdown",e=>{if(e.target===canvas){clearSelection();}});

/* ════════════════════════════════════════════════════════════════════
   INSPECTOR
   ════════════════════════════════════════════════════════════════════ */
/* <input type="color"> only accepts #rrggbb, but a shadow colour is far
   more useful with alpha, so the stored value may be rgba(). Show the
   nearest hex in the picker and keep the alpha when writing back. */
function rgbaToHex(v){
  const s=String(v||"").trim();
  if(s.startsWith("#"))return s.length>=7?s.slice(0,7):s;
  const m=s.match(/rgba?\(([^)]+)\)/);
  if(!m)return "#000000";
  const n=m[1].split(",").map(x=>parseFloat(x));
  const hx=c=>Math.max(0,Math.min(255,Math.round(c||0))).toString(16).padStart(2,"0");
  return "#"+hx(n[0])+hx(n[1])+hx(n[2]);
}
function hexWithAlpha(hex,prev){
  const m=String(prev||"").match(/rgba\(([^)]+)\)/);
  const a=m?parseFloat(m[1].split(",")[3]):1;
  if(!isFinite(a)||a>=1)return hex;
  const h=String(hex).replace("#","");
  const n=parseInt(h.length===3?h.split("").map(c=>c+c).join(""):h,16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
}
function field(label,inner){return `<div class="field"><label>${label}</label>${inner}</div>`;}
function swatchRow(current,onAttr){
  let h='<div class="swatches">';
  h+=`<div class="sw none ${current==="none"?"active":""}" data-${onAttr}="none" title="None"></div>`;
  PALETTE.forEach(c=>{h+=`<div class="sw ${current===c?"active":""}" style="background:${c}" data-${onAttr}="${c}"></div>`;});
  h+="</div>";return h;
}

function escapeTA(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function escapeAttr(v){return String(v==null?"":v).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");}
function splitRow(line){return line.includes("\t")?line.split("\t"):line.split(",");}
function tableToText(el){return (el.tableData||[]).map(r=>(Array.isArray(r)?r:[]).join("\t")).join("\n");}
function parseTableText(txt){return String(txt||"").split(/\r?\n/).filter(l=>l.trim()).map(l=>splitRow(l).map(c=>c.trim()));}
function chartToText(el){return (el.chartData||[]).map(r=>[r.label,r.value,r.x,r.y,r.size,...(Array.isArray(r.series)?r.series:[])].filter(v=>v!==undefined&&v!==null&&v!=="").join(",")).join("\n");}
function parseChartText(txt){return String(txt||"").split(/\r?\n/).filter(l=>l.trim()).map((l,i)=>{const p=splitRow(l).map(x=>x.trim());return {label:p[0]||("Item "+(i+1)),value:Number(p[1])||0,x:p[2]!==undefined&&p[2]!==""?Number(p[2]):i+1,y:p[3]!==undefined&&p[3]!==""?Number(p[3]):Number(p[1])||0,size:p[4]!==undefined&&p[4]!==""?Number(p[4]):Number(p[1])||12,series:p.slice(5).map(Number).filter(v=>!Number.isNaN(v))};});}
function pinsToText(el){return (el.pins||[]).map(p=>{
  if(p.lon!=null&&p.lat!=null)return [p.label,p.lon,p.lat,p.value].filter(v=>v!==undefined&&v!==null&&v!=="").join(",");
  return [p.label,p.x,p.y,p.value].filter(v=>v!==undefined&&v!==null&&v!=="").join(",");
}).join("\n");}
function parsePinsText(txt){return String(txt||"").split(/\r?\n/).filter(l=>l.trim()).map(l=>{
  const p=splitRow(l).map(x=>x.trim());
  const a=Number(p[1]),b=Number(p[2]);
  // Heuristic: if either coord is outside 0–100, treat the pair as lon,lat.
  const isLonLat = (Math.abs(a)>100)||(Math.abs(b)>100)||a<0||b<0;
  if(isLonLat)return {label:p[0]||"Pin",lon:a||0,lat:b||0,value:p[3]||""};
  return {label:p[0]||"Pin",x:a||50,y:b||50,value:p[3]||""};
});}

function normaliseHeaderName(v){return String(v||"").trim().toLowerCase().replace(/[\s_\-]+/g,"");}
function rowLooksLikeHeader(row, names){
  const joined=(row||[]).map(normaliseHeaderName).join("|");
  return names.some(n=>joined.includes(n));
}
function valueFromRow(row, headerMap, names, fallbackIndex){
  for(const name of names){
    const idx=headerMap ? headerMap[normaliseHeaderName(name)] : undefined;
    if(idx!==undefined && row[idx]!==undefined) return row[idx];
  }
  return row[fallbackIndex];
}
function numClean(v){
  const n=Number(String(v==null?"":v).replace(/[, ]/g,"").trim());
  return Number.isFinite(n)?n:null;
}
function matrixHeaderMap(rows, headerNames){
  if(!rows.length) return {rows:[], headers:null, map:null};
  const first=rows[0]||[];
  if(!rowLooksLikeHeader(first,headerNames)) return {rows, headers:null, map:null};
  const map={};
  first.forEach((h,i)=>{map[normaliseHeaderName(h)]=i;});
  return {rows:rows.slice(1), headers:first, map};
}
function matrixToPins(matrix){
  const info=matrixHeaderMap(matrix||[],["name","label","lon","lng","longitude","lat","latitude","value"]);
  return (info.rows||[]).map((r,i)=>{
    const label=String(valueFromRow(r,info.map,["Name","Label","Location","Site"],0)||`Pin ${i+1}`).trim();
    const lon=numClean(valueFromRow(r,info.map,["Lon","Lng","Longitude"],1));
    const lat=numClean(valueFromRow(r,info.map,["Lat","Latitude"],2));
    const value=valueFromRow(r,info.map,["Value","Amount","Count"],3);
    if(lon==null||lat==null) return null;
    return {label:label||`Pin ${i+1}`,lon,lat,value:value==null?"":String(value).trim()};
  }).filter(Boolean);
}
function pinTemplateText(){
  return "Name,Lon,Lat,Value\nBanjul,-16.58,13.45,12\nBrikama,-16.65,13.27,28\nSoma,-15.53,13.43,18\nBasse,-14.21,13.31,10\n";
}
function areaTemplateText(){
  return "Area,Lon,Lat,Value,Fill,Stroke\nAffected Area 1,-16.62,13.48,45,#e8482b,#ffffff\nAffected Area 1,-16.54,13.49,45,#e8482b,#ffffff\nAffected Area 1,-16.52,13.39,45,#e8482b,#ffffff\nAffected Area 1,-16.63,13.37,45,#e8482b,#ffffff\nAffected Area 1,-16.62,13.48,45,#e8482b,#ffffff\n";
}
function matrixToAreas(matrix){
  const info=matrixHeaderMap(matrix||[],["area","name","lon","lng","longitude","lat","latitude","value","fill","stroke"]);
  const grouped=new Map();
  (info.rows||[]).forEach((r,i)=>{
    const label=String(valueFromRow(r,info.map,["Area","Name","Label"],0)||"Affected Area").trim() || "Affected Area";
    const lon=numClean(valueFromRow(r,info.map,["Lon","Lng","Longitude"],1));
    const lat=numClean(valueFromRow(r,info.map,["Lat","Latitude"],2));
    if(lon==null||lat==null) return;
    const value=valueFromRow(r,info.map,["Value","Amount","Count"],3);
    const fill=String(valueFromRow(r,info.map,["Fill","FillColor","Colour","Color"],4)||"").trim();
    const stroke=String(valueFromRow(r,info.map,["Stroke","Border","StrokeColor","BorderColor"],5)||"").trim();
    if(!grouped.has(label)) grouped.set(label,{label,value:value==null?"":String(value).trim(),fill:fill||undefined,stroke:stroke||undefined,coordinates:[]});
    const area=grouped.get(label);
    if(value!=null&&String(value).trim()!=="") area.value=String(value).trim();
    if(fill) area.fill=fill;
    if(stroke) area.stroke=stroke;
    area.coordinates.push([lon,lat]);
  });
  return [...grouped.values()].filter(a=>a.coordinates.length>=3).map(a=>{
    const first=a.coordinates[0], last=a.coordinates[a.coordinates.length-1];
    if(first && last && (first[0]!==last[0] || first[1]!==last[1])) a.coordinates.push([first[0],first[1]]);
    return a;
  });
}
function areasToText(el){
  return (Array.isArray(el.areas)?el.areas:[]).flatMap((a,i)=>{
    const label=a.label||a.name||`Affected Area ${i+1}`;
    const coords=Array.isArray(a.coordinates)?a.coordinates:(Array.isArray(a.coords)?a.coords:(Array.isArray(a.points)?a.points:[]));
    const fill=a.fill||el.areaFill||"";
    const stroke=a.stroke||el.areaStroke||"";
    const val=a.value==null?"":a.value;
    return coords.map(pt=>{
      const lon=Array.isArray(pt)?pt[0]:(pt.lon??pt.lng??"");
      const lat=Array.isArray(pt)?pt[1]:(pt.lat??"");
      return [label,lon,lat,val,fill,stroke].join(",");
    });
  }).join("\n");
}
function parseAreasText(txt){return matrixToAreas(parseDelimited(txt));}
function downloadTextFile(filename, text){
  const blob=new Blob([text],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{URL.revokeObjectURL(url);a.remove();},0);
}
function ensureAreaModal(){
  let modal=document.getElementById("hanns-area-modal");
  if(modal) return modal;
  modal=document.createElement("div");
  modal.className="hanns-geo-modal";
  modal.id="hanns-area-modal";
  modal.innerHTML=`<div class="hanns-geo-card" role="dialog" aria-modal="true" aria-labelledby="map-area-title">
    <button class="hanns-geo-x" id="map-area-close" type="button" aria-label="Close">✕</button>
    <h3 id="map-area-title">Affected area coordinates</h3>
    <p>Paste or type coordinate rows. Use the same area name on several rows to create one polygon.</p>
    <textarea id="map-area-text" rows="12" spellcheck="false" placeholder="${areaTemplateText().replace(/"/g,"&quot;")}"></textarea>
    <div class="hanns-geo-actions">
      <button class="chip" id="map-area-sample" type="button">Use sample</button>
      <button class="chip" id="map-area-download" type="button">Download template</button>
      <button class="chip" id="map-area-apply" type="button">Apply to map</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click",e=>{if(e.target===modal)modal.classList.remove("on");});
  modal.querySelector("#map-area-close").addEventListener("click",()=>modal.classList.remove("on"));
  modal.querySelector("#map-area-sample").addEventListener("click",()=>{modal.querySelector("#map-area-text").value=areaTemplateText();});
  modal.querySelector("#map-area-download").addEventListener("click",()=>downloadTextFile("hanns_map_area_template.csv",areaTemplateText()));
  return modal;
}
function openAreaModal(el){
  const modal=ensureAreaModal();
  const txt=modal.querySelector("#map-area-text");
  txt.value=areasToText(el)||areaTemplateText();
  const apply=modal.querySelector("#map-area-apply");
  apply.onclick=()=>{
    const areas=parseAreasText(txt.value);
    if(!areas.length){toast("No valid area polygons found. Use Area,Lon,Lat,Value,Fill,Stroke");return;}
    el.areas=areas;
    modal.classList.remove("on");
    renderCanvas();renderInspector();markDirty();toast(`Applied ${areas.length} affected area shape${areas.length>1?"s":""}`);
  };
  modal.classList.add("on");
  setTimeout(()=>txt.focus(),30);
}


/* ── CSV / Excel import ───────────────────────────────────────────────
   A proper CSV line splitter (handles quoted fields containing commas and
   escaped "" quotes), a delimiter-sniffing matrix parser, and a router
   that turns an imported sheet into chart data or table data. Excel files
   are read with SheetJS (window.XLSX, loaded in editor.html). */
function splitCSVLine(line, delim){
  const out=[]; let cur="", q=false;
  for(let i=0;i<line.length;i++){
    const c=line[i];
    if(q){
      if(c==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else q=false; }
      else cur+=c;
    } else {
      if(c==='"') q=true;
      else if(c===delim){ out.push(cur); cur=""; }
      else cur+=c;
    }
  }
  out.push(cur);
  return out.map(s=>s.trim());
}
function parseDelimited(text){
  const lines=String(text||"").replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n").filter(l=>l.trim().length);
  if(!lines.length) return [];
  // sniff delimiter from the first line: tab > semicolon > comma
  const first=lines[0];
  const delim=first.includes("\t")?"\t":(first.includes(";")&&!first.includes(",")?";":",");
  return lines.map(l=>splitCSVLine(l,delim));
}
/* Turn a matrix (array of string rows) into chart data.
   Assumes row 0 may be a header; col 0 = label, col 1 = value, the rest
   become extra series for grouped/stacked bars. */
function matrixToChartData(matrix){
  if(!matrix.length) return [];
  let rows=matrix.slice();
  // drop a header row if its second cell isn't numeric
  const looksHeader = rows[0].length>1 && rows[0].slice(1).some(c=>c!=="" && isNaN(Number(c)));
  let headers=null;
  if(looksHeader){ headers=rows[0]; rows=rows.slice(1); }
  const data=rows.map((r,i)=>{
    const label=(r[0]??("Item "+(i+1))).toString();
    const nums=r.slice(1).map(c=>Number(String(c).replace(/[, ]/g,""))).map(n=>Number.isFinite(n)?n:0);
    return {label, value:nums[0]||0, series:nums.length>1?nums:[]};
  });
  return {data, headers: headers?headers.slice(1):null};
}
function importDataFile(file, kind){
  const isExcel=/\.(xlsx|xls)$/i.test(file.name);
  const finish=(matrix)=>{
    if(!matrix||!matrix.length){toast("Couldn't read any rows from that file");return;}
    const el=selEl(); if(!el) return;
    if(kind==="table"){
      el.tableData=matrix.map(r=>r.map(c=>String(c)));
      el.rows=el.tableData.length; el.cols=Math.max(1,...el.tableData.map(r=>r.length));
      renderCanvas();renderInspector();markDirty();toast(`Imported ${el.rows}×${el.cols} into table`);
    } else if(kind==="mapPins"){
      const pins=matrixToPins(matrix);
      if(!pins.length){toast("No valid map pins found. Use Name,Lon,Lat,Value");return;}
      el.pins=pins; el.useCities=false;
      renderCanvas();renderInspector();markDirty();toast(`Imported ${pins.length} map pin${pins.length>1?"s":""}`);
    } else if(kind==="mapAreas"){
      const areas=matrixToAreas(matrix);
      if(!areas.length){toast("No valid area polygons found. Use Area,Lon,Lat,Value,Fill,Stroke");return;}
      el.areas=areas;
      renderCanvas();renderInspector();markDirty();toast(`Imported ${areas.length} area shape${areas.length>1?"s":""}`);
    } else {
      const {data,headers}=matrixToChartData(matrix);
      el.chartData=data;
      if(headers&&headers.length>1){el.seriesNames=headers;el.showLegend=true;}
      renderCanvas();renderInspector();markDirty();toast(`Imported ${data.length} rows into chart`);
    }
  };
  const rd=new FileReader();
  rd.onload=()=>{
    try{
      if(isExcel){
        if(typeof XLSX==="undefined"){toast("Excel support is still loading — try again in a second, or use CSV");return;}
        const wb=XLSX.read(rd.result,{type:"array"});
        const ws=wb.Sheets[wb.SheetNames[0]];
        const matrix=XLSX.utils.sheet_to_json(ws,{header:1,blankrows:false,raw:true})
          .map(r=>r.map(c=>c==null?"":c));
        finish(matrix.filter(r=>r.some(c=>String(c).trim()!=="")));
      } else {
        finish(parseDelimited(rd.result));
      }
    }catch(err){console.error(err);toast("Import failed — check the file format");}
  };
  rd.onerror=()=>toast("Couldn't read the file");
  if(isExcel) rd.readAsArrayBuffer(file); else rd.readAsText(file);
}
let pendingImport=null;   // {id, kind}
function pickDataFileFor(id,kind){pendingImport={id,kind};const di=$("#data-input");if(di)di.click();}

function renderInspector(){
  // tab state
  $$(".insp-tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===inspTab));
  const el=selEl();
  if(inspTab==="slide"){inspBody.innerHTML=slidePanel();bindSlidePanel();slideDesignPanel();return;}
  const selected=selectedElements();
  if(selected.length>1){
    inspBody.innerHTML=multiSelectionPanel(selected);bindMultiSelectionPanel();
    studioPanels(null);   // align & distribute across the whole selection
    return;
  }
  if(!el){
    inspBody.innerHTML=`<div class="insp-empty"><span class="big">Nothing selected</span>
      Pick an element on the canvas, or add one from the left rail. Switch to <b>Slide</b> to style the background &amp; transition.</div>`;
    return;
  }
  if(inspTab==="animate"){inspBody.innerHTML=animatePanel(el);bindAnimatePanel(el);return;}
  inspBody.innerHTML=elementPanel(el);bindElementPanel(el);
  studioPanels(el);
}
function multiSelectionPanel(els){
  return `<div class="group"><span class="glabel">Selected objects</span>
    <div class="bind-summary"><b>${els.length}</b><span>objects selected. Click Bind to move, copy, layer and resize them as one object.</span></div>
    <div class="bind-action-row">
      <button class="tbtn primary" id="f-bind-selected" type="button">🔗 Bind selected</button>
      <button class="tbtn" id="f-clear-selection" type="button">Clear</button>
    </div>
    <div class="insp-empty" style="padding-top:.8rem">Tip: hold Shift/Ctrl/Cmd and click objects to add or remove them from the selection.</div>
  </div>`;
}
function bindMultiSelectionPanel(){
  $("#f-bind-selected")?.addEventListener("click",bindSelected);
  $("#f-clear-selection")?.addEventListener("click",clearSelection);
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

  h+=`<div class="group"><span class="glabel">Arrange / layer order</span>
    <div class="arrange-grid">
      <button class="tbtn mini" id="f-layer-back" type="button" title="Send behind all elements">Send behind</button>
      <button class="tbtn mini" id="f-layer-backward" type="button" title="Move one step backward">Backward</button>
      <button class="tbtn mini" id="f-layer-forward" type="button" title="Move one step forward">Forward</button>
      <button class="tbtn mini" id="f-layer-front" type="button" title="Bring in front of all elements">Bring front</button>
    </div>
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

  if(el.type==="creative_shape"){
    const def=(SHAPES||[]).find(s=>s.kind===el.shapeType)||SHAPES[0];
    h+=`<div class="group"><span class="glabel">Creative shape</span>
      ${field("Shape",`<select id="f-shapetype">${SHAPES.map(s=>`<option value="${s.kind}" ${el.shapeType===s.kind?"selected":""}>${s.label}</option>`).join("")}</select>`)}
      <span class="glabel" style="margin-top:.7rem;display:block">Fill</span>${swatchRow(el.fill||def.accent,"fill")}
      <span class="glabel" style="margin-top:.8rem;display:block">Stroke</span>${swatchRow(el.stroke||"none","stroke")}
      ${field("Stroke width "+(el.strokeW||0),`<input type="range" id="f-shape-strokew" min="0" max="18" value="${el.strokeW||0}">`)}
      ${field("Opacity "+Math.round((el.opacity==null?1:el.opacity)*100)+"%",`<input type="range" id="f-shape-opacity" min="0.1" max="1" step="0.05" value="${el.opacity==null?1:el.opacity}">`)}
      <div class="insp-empty" style="padding-top:.2rem">${def.group||"Shape"} shape. Use it for cards, decorations, diagrams, icons, labels, and creative slide layouts.</div>
    </div>`;
  }

  if(el.type==="image"){
    h+=`<div class="group"><span class="glabel">Image</span>
      <button class="tbtn" id="f-pickimg" style="width:100%;justify-content:center">Replace image…</button>
      ${field("Fit",`<div class="seg" id="f-fit"><button data-fit="cover" class="${el.fit==="cover"?"active":""}">Cover</button><button data-fit="contain" class="${el.fit==="contain"?"active":""}">Contain</button></div>`)}
      ${field("Corner radius "+(el.radius||0),`<input type="range" id="f-radius" min="0" max="120" value="${el.radius||0}">`)}
    </div>`;
  }

  if(el.type==="video"){
    h+=`<div class="group"><span class="glabel">Video</span>
      ${field("Title",`<input type="text" id="f-videotitle" value="${escapeAttr(el.title||"Video")}">`)}
      ${field("Video URL",`<input type="url" id="f-videosrc" placeholder="https://...mp4 or YouTube embed URL" value="${escapeAttr(el.src||"")}">`)}
      ${field("Poster image URL",`<input type="url" id="f-videoposter" value="${escapeAttr(el.poster||"")}">`)}
      ${field("Fit",`<div class="seg" id="f-videofit"><button data-fit="cover" class="${(el.fit||"cover")==="cover"?"active":""}">Cover</button><button data-fit="contain" class="${el.fit==="contain"?"active":""}">Contain</button></div>`)}
      ${field("Controls",`<div class="seg" id="f-videocontrols"><button data-on="1" class="${el.controls!==false?"active":""}">On</button><button data-on="0" class="${el.controls===false?"active":""}">Off</button></div>`)}
      ${field("Autoplay",`<div class="seg" id="f-videoautoplay"><button data-on="1" class="${el.autoplay?"active":""}">On</button><button data-on="0" class="${!el.autoplay?"active":""}">Off</button></div>`)}
      ${field("Muted",`<div class="seg" id="f-videomuted"><button data-on="1" class="${el.muted?"active":""}">On</button><button data-on="0" class="${!el.muted?"active":""}">Off</button></div>`)}
      ${field("Corner radius "+(el.radius||18),`<input type="range" id="f-videoradius" min="0" max="80" value="${el.radius||18}">`)}
      <div class="insp-empty" style="padding-top:.2rem">For YouTube/Vimeo, use an embed URL. For direct video, paste an MP4/WebM URL.</div>
    </div>`;
  }
  if(el.type==="gallery"){
    const photos=Array.isArray(el.photos)?el.photos:[];
    const frames=[["none","None"],["border","Border"],["shadow","Shadow"],["polaroid","Polaroid"],["film","Film strip"],["card","Card"],["gold","Gold"],["tape","Tape"]];
    const anims=[["fade","Fade"],["zoom","Zoom"],["slide","Slide"],["rise","Rise"],["flip","Flip"],["reveal","Reveal"]];
    const photoRows=photos.map((p,idx)=>`
      <div class="gal-row" data-gal-idx="${idx}">
        <div class="gal-thumb" style="background-image:url('${escapeAttr(p.src||"")}')"></div>
        <div class="gal-row-main">
          <input type="text" class="gal-cap" data-gal-idx="${idx}" placeholder="Caption (optional)" value="${escapeAttr(p.caption||"")}">
          <div class="gal-row-btns">
            <button class="gal-mini" data-gal-up="${idx}" type="button" title="Move up" ${idx===0?"disabled":""}>↑</button>
            <button class="gal-mini" data-gal-down="${idx}" type="button" title="Move down" ${idx===photos.length-1?"disabled":""}>↓</button>
            <button class="gal-mini gal-del" data-gal-del="${idx}" type="button" title="Remove">✕</button>
          </div>
        </div>
      </div>`).join("");
    h+=`<div class="group"><span class="glabel">🖼️ Photo gallery (projected slideshow)</span>
      <button class="tbtn primary" id="f-gal-add" type="button" style="width:100%;justify-content:center">＋ Add photos</button>
      <div class="gal-list" id="f-gal-list">${photoRows||'<div class="insp-empty" style="padding:.4rem 0">No photos yet — tap “Add photos”.</div>'}</div>
      ${field("Frame style",`<select id="f-gal-frame">${frames.map(([v,l])=>`<option value="${v}" ${(el.frame||"polaroid")===v?"selected":""}>${l}</option>`).join("")}</select>`)}
      ${field("Photo fit",`<div class="seg" id="f-gal-fit"><button data-fit="cover" class="${(el.fit||"cover")==="cover"?"active":""}">Fill</button><button data-fit="contain" class="${el.fit==="contain"?"active":""}">Fit whole</button></div>`)}
      ${field("Per-photo animation",`<select id="f-gal-anim">${anims.map(([v,l])=>`<option value="${v}" ${(el.galleryAnim||"fade")===v?"selected":""}>${l}</option>`).join("")}</select>`)}
      ${field("Hold per photo "+((el.holdMs||2600)/1000).toFixed(1)+"s",`<input type="range" id="f-gal-hold" min="600" max="8000" step="100" value="${el.holdMs||2600}">`)}
      ${field("Transition speed "+(Number(el.stagger)||1).toFixed(2)+"×",`<input type="range" id="f-gal-speed" min="25" max="400" step="5" value="${Math.round((Number(el.stagger)||1)*100)}">`)}
      ${field("Loop",`<div class="seg" id="f-gal-loop"><button data-on="1" class="${el.galleryLoop!==false?"active":""}">On</button><button data-on="0" class="${el.galleryLoop===false?"active":""}">Off</button></div>`)}
      ${field("Backdrop",`<span style="display:flex;gap:.4rem;align-items:center"><input type="color" id="f-gal-bg" value="${el.galleryBg||"#000000"}"><button class="chip" id="f-gal-bg-clear" type="button" title="No backdrop">Clear</button></span>`)}
      <div class="insp-empty" style="padding-top:.2rem;font-size:.78em">Projected for the audience. Photos auto-advance one at a time (fly in → hold → fly out). The whole block also uses its own entrance under the <b>Animate</b> tab. ${photos.length} photo${photos.length===1?"":"s"}.</div>
    </div>`;
  }
  if(el.type==="link"){
    h+=`<div class="group"><span class="glabel">Clickable link</span>
      ${field("Label",`<input type="text" id="f-linklabel" value="${escapeAttr(el.label||"Open link")}">`)}
      ${field("URL",`<input type="url" id="f-linkurl" value="${escapeAttr(el.url||"https://")}">`)}
      ${field("Description",`<textarea id="f-linkdesc" rows="3">${escapeTA(el.description||"")}</textarea>`)}
      ${field("Style",`<select id="f-linkstyle"><option value="button" ${el.linkStyle==="button"?"selected":""}>Button</option><option value="card" ${el.linkStyle==="card"?"selected":""}>Card</option><option value="outline" ${el.linkStyle==="outline"?"selected":""}>Outline</option></select>`)}
      ${field("Background",`<input type="color" id="f-linkbg" value="${el.bg||el.accent||"#2563eb"}">`)}
      ${field("Text colour",`<input type="color" id="f-linkcolor" value="${el.textColor||"#ffffff"}">`)}
      ${field("Corner radius "+(el.radius||22),`<input type="range" id="f-linkradius" min="0" max="80" value="${el.radius||22}">`)}
    </div>`;
  }
  if(el.type==="table"){
    h+=`<div class="group"><span class="glabel">Table data</span>
      <button class="tbtn" id="f-tableimport" style="width:100%;justify-content:center;margin:.1rem 0 .5rem">⬆ Import from CSV / Excel</button>
      ${field("Paste table data",`<textarea id="f-tabledata" rows="8" placeholder="Header 1,Header 2&#10;A,10&#10;B,20">${escapeTA(tableToText(el))}</textarea>`)}
      <div class="row2">
        ${field("Rows",`<input type="number" id="f-tablerows" min="1" max="40" value="${el.rows||5}">`)}
        ${field("Columns",`<input type="number" id="f-tablecols" min="1" max="12" value="${el.cols||4}">`)}
      </div>
      ${field("Header row",`<div class="seg" id="f-tableheader"><button data-header="1" class="${el.header!==false?"active":""}">On</button><button data-header="0" class="${el.header===false?"active":""}">Off</button></div>`)}
      ${field("Style",`<select id="f-tabletheme"><option value="clean" ${el.theme==="clean"?"selected":""}>Clean</option><option value="glass" ${el.theme==="glass"?"selected":""}>Glass</option><option value="dark" ${el.theme==="dark"?"selected":""}>Dark</option></select>`)}
      ${field("Font size "+(el.size||18),`<input type="range" id="f-tablesize" min="10" max="40" value="${el.size||18}">`)}
      ${field("Header colour",`<input type="color" id="f-tableaccent" value="${el.headerColor||el.accent||"#1d4e89"}">`)}
      ${field("Header text colour",`<input type="color" id="f-tableheadertext" value="${el.headerTextColor||"#ffffff"}">`)}
      ${field("Body text colour",`<input type="color" id="f-tabletextcolor" value="${el.textColor||"#16140f"}">`)}
      ${field("Border colour",`<input type="color" id="f-tableborder" value="${el.borderColor||"#d8dee9"}">`)}
      ${field("Striped rows",`<div class="seg" id="f-tablestriped"><button data-on="1" class="${el.striped!==false?"active":""}">On</button><button data-on="0" class="${el.striped===false?"active":""}">Off</button></div>`)}
      <div class="insp-empty" style="padding-top:.2rem">Use comma-separated or tab-separated values. Example: Item,Value</div>
    </div>`;
  }
  if(el.type==="chart"){
    const palette=Array.isArray(el.palette)&&el.palette.length?el.palette:["#e8482b","#22c55e","#38bdf8","#f59e0b","#a855f7","#ef4444"];
    h+=`<div class="group"><span class="glabel">Chart / graph data</span>
      ${field("Title",`<input type="text" id="f-charttitle" value="${escapeAttr(el.title||"Chart")}">`)}
      ${field("Type",`<select id="f-chartkind">
        ${[
          ["bar","Bar"],["horizontalBar","Horizontal bar"],["groupedBar","Grouped bar"],["stackedBar","Stacked bar"],["lollipop","Lollipop"],["combo","Combo (bar + line)"],["pareto","Pareto (80/20)"],["line","Line"],["spline","Smooth line"],["area","Area"],["pie","Pie"],["donut","Donut"],["polarArea","Polar area"],["scatter","Scatter"],["bubble","Bubble"],["radar","Radar"],["pyramid","Pyramid"],["gauge","Gauge"],["progress","Progress"],["funnel","Funnel"],["waterfall","Waterfall"],["heatmap","Heatmap"],["treemap","Treemap"],["kpi","KPI card"]
        ].map(([k,l])=>`<option value="${k}" ${el.chartKind===k?"selected":""}>${l}</option>`).join("")}
      </select>`)}
      ${field("Render engine",`<select id="f-chartengine"><option value="svg" ${(el.renderEngine||"svg")==="svg"?"selected":""}>Classic SVG (fast)</option><option value="plotly" ${el.renderEngine==="plotly"?"selected":""}>Plotly rich interactive</option></select>`)}
      <button class="tbtn" id="f-chartimport" style="width:100%;justify-content:center;margin:.1rem 0 .5rem">⬆ Import from CSV / Excel</button>
      ${field("Data (or edit here)",`<textarea id="f-chartdata" rows="7" placeholder="Label,Value&#10;Jan,20&#10;Feb,35">${escapeTA(chartToText(el))}</textarea>`)}
      <div class="insp-empty" style="padding:0 0 .5rem">Label,Value. Scatter/bubble: Label,Value,X,Y,Size. Grouped/stacked: add extra numbers per row.</div>
    </div>
    <div class="group"><span class="glabel">Labels &amp; values</span>
      ${field("Show values",`<div class="seg" id="f-chartvalues"><button data-show="1" class="${el.showValues!==false?"active":""}">Show</button><button data-show="0" class="${el.showValues===false?"active":""}">Hide</button></div>`)}
      ${field("Sort data",`<div class="seg" id="f-chartsort"><button data-sort="none" class="${!el.sortOrder||el.sortOrder==="none"?"active":""}">As entered</button><button data-sort="desc" class="${el.sortOrder==="desc"?"active":""}">High → low</button><button data-sort="asc" class="${el.sortOrder==="asc"?"active":""}">Low → high</button></div>`)}
      <div class="row2">
        ${field("Value colour",`<input type="color" id="f-chartvaluecolor" value="${el.valueColor||(el.chartThemeMode==="dark"?"#f8fafc":"#0f172a")}">`)}
        ${field("Label colour",`<input type="color" id="f-chartlabelcolor" value="${el.labelColor||(el.chartThemeMode==="dark"?"#cbd5e1":"#475569")}">`)}
      </div>
      ${field("Text size "+(el.labelSize||26),`<input type="range" id="f-chartlabelsize" min="14" max="60" value="${el.labelSize||26}">`)}
      <div class="row2">
        ${field("Prefix",`<input type="text" id="f-chartprefix" placeholder="$" value="${escapeAttr(el.valuePrefix||"")}">`)}
        ${field("Suffix",`<input type="text" id="f-chartsuffix" placeholder="%, km…" value="${escapeAttr(el.valueSuffix||"")}">`)}
      </div>
      <div class="row2">
        ${field("Decimals",`<input type="number" id="f-chartdecimals" min="0" max="4" value="${el.decimals||0}">`)}
        ${field("Max (gauge/%)",`<input type="number" id="f-chartmax" min="1" value="${el.max||100}">`)}
      </div>
    </div>
    <div class="group"><span class="glabel">Appearance</span>
      ${field("Theme",`<div class="seg" id="f-charttheme"><button data-mode="light" class="${(el.chartThemeMode||"light")==="light"?"active":""}">Light</button><button data-mode="dark" class="${el.chartThemeMode==="dark"?"active":""}">Dark</button></div>`)}
      ${field("Chart title",`<div class="seg" id="f-chartshowtitle"><button data-on="1" class="${el.showTitle!==false?"active":""}">Show</button><button data-on="0" class="${el.showTitle===false?"active":""}">Hide</button></div>`)}
      ${field("Gridlines",`<div class="seg" id="f-chartgrid"><button data-on="1" class="${el.gridLines!==false?"active":""}">On</button><button data-on="0" class="${el.gridLines===false?"active":""}">Off</button></div>`)}
      ${field("Axis numbers",`<div class="seg" id="f-chartaxis"><button data-on="1" class="${el.axisValues!==false?"active":""}">On</button><button data-on="0" class="${el.axisValues===false?"active":""}">Off</button></div>`)}
      ${field("Legend (grouped/stacked)",`<div class="seg" id="f-chartlegend"><button data-on="1" class="${el.showLegend?"active":""}">On</button><button data-on="0" class="${!el.showLegend?"active":""}">Off</button></div>`)}
      ${field("Title colour",`<input type="color" id="f-charttitlecolor" value="${el.titleColor||"#111827"}">`)}
      ${field("Plotly template",`<select id="f-plotlytemplate"><option value="plotly_white" ${(el.plotlyTemplate||"plotly_white")==="plotly_white"?"selected":""}>White</option><option value="plotly_dark" ${el.plotlyTemplate==="plotly_dark"?"selected":""}>Dark</option><option value="presentation" ${el.plotlyTemplate==="presentation"?"selected":""}>Presentation</option><option value="simple_white" ${el.plotlyTemplate==="simple_white"?"selected":""}>Simple white</option></select>`)}
      ${field("Plotly toolbar",`<div class="seg" id="f-plotlymodebar"><button data-on="1" class="${el.plotlyModebar?"active":""}">Show</button><button data-on="0" class="${!el.plotlyModebar?"active":""}">Hide</button></div>`)}
      <span class="glabel" style="margin:.4rem 0 .25rem;display:block">Series colours</span>
      <div class="palette-row" id="f-chartpalette">
        ${palette.slice(0,6).map((c,i)=>`<input type="color" class="pal-sw" data-pi="${i}" value="${c}" title="Series ${i+1}">`).join("")}
      </div>
    </div>`;
  }
  if(el.type==="map"){
    h+=`<div class="group"><span class="glabel">Map</span>
      ${field("Title",`<input type="text" id="f-maptitle" value="${escapeAttr(el.title||"Map")}">`)}
      ${field("Region",`<select id="f-mapkind">
        ${[["gambia","The Gambia"],["senegal","Senegal"],["africa","Africa"],["europe","Europe"],["world","World"]].map(([k,l])=>`<option value="${k}" ${el.mapKind===k?"selected":""}>${l}</option>`).join("")}
      </select>`)}
      ${field("Map engine",`<select id="f-mapengine"><option value="svg" ${(el.mapEngine||"svg")==="svg"?"selected":""}>Classic SVG map</option><option value="folium" ${el.mapEngine==="folium"?"selected":""}>Folium / Leaflet rich map</option><option value="plotly" ${el.mapEngine==="plotly"?"selected":""}>Plotly geo map</option></select>`)}
      ${field("Tile layer (Folium)",`<select id="f-tilelayer"><option value="osm" ${(el.tileLayer||"osm")==="osm"?"selected":""}>OpenStreetMap</option><option value="light" ${el.tileLayer==="light"?"selected":""}>Carto light</option><option value="dark" ${el.tileLayer==="dark"?"selected":""}>Carto dark</option><option value="satellite" ${el.tileLayer==="satellite"?"selected":""}>Satellite</option></select>`)}
      ${field("Zoom (Folium)",`<input type="number" id="f-mapzoom" min="1" max="18" value="${el.zoom||""}" placeholder="Auto">`)}
      ${field("Quick fill",`<div class="seg" id="f-mapcities"><button data-on="0" class="${!el.useCities?"active":""}">My pins</button><button data-on="1" class="${el.useCities?"active":""}">Major cities</button></div>`)}
      ${field("Pins (Name, Lon, Lat, Value)",`<textarea id="f-mappins" rows="5" placeholder="Banjul,-16.58,13.45,12">${escapeTA(pinsToText(el))}</textarea>`)}
      <div class="geo-action-row"><button class="chip" id="btn-map-pin-file" type="button">Import pin CSV/Excel</button><button class="chip" id="btn-map-pin-template" type="button">Download pin template</button></div>
      <div class="insp-empty" style="padding:0 0 .5rem">Use real longitude,latitude (e.g. Banjul,-16.58,13.45,12). Pins land on the real map.</div>
      ${field("Affected area shapes",`<textarea id="f-mapareas" rows="6" placeholder="Area,Lon,Lat,Value,Fill,Stroke
Affected Area 1,-16.62,13.48,45,#e8482b,#ffffff
Affected Area 1,-16.54,13.49,45,#e8482b,#ffffff
Affected Area 1,-16.52,13.39,45,#e8482b,#ffffff">${escapeTA(areasToText(el))}</textarea>`)}
      <div class="geo-action-row"><button class="chip" id="btn-map-area-modal" type="button">Manual area form</button><button class="chip" id="btn-map-area-file" type="button">Import area CSV/Excel</button><button class="chip" id="btn-map-area-template" type="button">Download area template</button></div>
      <div class="insp-empty" style="padding:0 0 .5rem">Affected areas are polygons created from coordinate rows. Use the same Area name on several rows to build one shape.</div>
      <div class="row3">
        ${field("Area fill",`<input type="color" id="f-areafill" value="${el.areaFill||"#e8482b"}">`)}
        ${field("Area border",`<input type="color" id="f-areastroke" value="${el.areaStroke||"#ffffff"}">`)}
        ${field("Opacity",`<input type="number" id="f-areaopacity" min="0" max="1" step="0.05" value="${el.areaOpacity??0.42}">`)}
      </div>
    </div>
    <div class="group"><span class="glabel">Appearance</span>
      ${field("Land colour",`<input type="color" id="f-mapaccent" value="${el.accent||"#2f6f4f"}">`)}
      ${field("Theme",`<div class="seg" id="f-maptheme"><button data-mode="light" class="${(el.mapTheme||"light")==="light"?"active":""}">Light</button><button data-mode="dark" class="${el.mapTheme==="dark"?"active":""}">Dark</button></div>`)}
      ${field("Show labels",`<div class="seg" id="f-maplabels"><button data-show="1" class="${el.showLabels!==false?"active":""}">Show</button><button data-show="0" class="${el.showLabels===false?"active":""}">Hide</button></div>`)}
      ${field("River (Gambia)",`<div class="seg" id="f-mapriver"><button data-on="1" class="${el.showRiver!==false?"active":""}">On</button><button data-on="0" class="${el.showRiver===false?"active":""}">Off</button></div>`)}
      ${field("Label size "+(el.labelSize||24),`<input type="range" id="f-maplabelsize" min="14" max="48" value="${el.labelSize||24}">`)}
      ${field("Title colour",`<input type="color" id="f-maptitlecolor" value="${el.titleColor||"#064e3b"}">`)}
    </div>`;
  }

  if(el.type==="object"){
    const def=(OBJECTS||[]).find(o=>o.kind===el.objectType)||OBJECTS[0];
    // ── Studio objects (choropleth, KPI tiles, Sankey…) ──────────────
    // Their controls carry live per-row handlers, so studioPanels()
    // builds them as DOM after this markup is bound. Nothing to add here.
    if(isStudioObject(el.objectType)){
      /* intentionally empty — see studioPanels() */
    }
    // ── Teleprompter: presenter-only speech script. Dedicated panel. ──
    else if(el.objectType==="teleprompter"){
      const script=el.script!=null?String(el.script):"";
      const words=script.trim()?script.trim().split(/\s+/).length:0;
      const mins=words?Math.max(1,Math.round(words/130)):0;
      h+=`<div class="group"><span class="glabel">🎤 Teleprompter script (presenter-only)</span>
        ${field("Object type",`<select id="f-objtype">${OBJECTS.map(o=>`<option value="${o.kind}" ${el.objectType===o.kind?"selected":""}>${o.icon} ${o.label}</option>`).join("")}</select>`)}
        ${field("Label",`<input type="text" id="f-objlabel" value="${(el.label||def.label).replace(/"/g,"&quot;")}">`)}
        <div class="field"><label>Your speech / script</label>
          <textarea id="f-tp-script" rows="12" placeholder="Paste your whole speech here. It scrolls on your phone controller while you present — the audience never sees it.">${escapeTA(script)}</textarea></div>
        <div class="insp-empty" style="padding-top:.2rem;font-size:.78em">
          <b id="f-tp-stats">${words?words+" words · ~"+mins+" min read":"No script yet"}</b><br>
          Invisible to the audience. On the phone controller you'll get scroll speed, play/pause, restart, and font-size controls. Tip: add one teleprompter object per slide, or put your whole talk on a single slide.
        </div>
      </div>`;
    } else {
    const isSdg = el.objectType==="sdg_wheel"||el.objectType==="sdg_tiles"||el.objectType==="sdg";
    const AC = window.HannsActors || null;
    const isActor = !!(AC && AC.isActor(el.objectType));
    const actorHasMood  = isActor && AC.ACTOR_HAS_MOOD.has(el.objectType);
    const actorHasLevel = isActor && AC.ACTOR_HAS_LEVEL.has(el.objectType);
    const actorActions  = isActor ? (AC.ACTOR_ACTIONS[el.objectType]||["idle"]) : [];
    const curAction = el.action || "idle";
    const curMood   = el.mood || "neutral";
    h+=`<div class="group"><span class="glabel">Object / data visual</span>
      ${field("Object type",`<select id="f-objtype">${OBJECTS.map(o=>`<option value="${o.kind}" ${el.objectType===o.kind?"selected":""}>${o.icon} ${o.label}</option>`).join("")}</select>`)}
      ${isSdg ? "" : field("Label",`<input type="text" id="f-objlabel" value="${(el.label||def.label).replace(/"/g,"&quot;")}">`)}
      ${(isSdg||isActor) ? "" : field("Amount / count",`<input type="number" id="f-count" min="1" max="10000" value="${el.count||1}">`)}
      ${isActor ? `<div class="field"><label>Action (looping)</label>
        <div class="seg seg-wrap" id="f-actoraction">${actorActions.map(act=>`<button data-act="${act}" class="${curAction===act?"active":""}">${act.charAt(0).toUpperCase()+act.slice(1)}</button>`).join("")}</div></div>` : ""}
      ${actorHasMood ? `<div class="field"><label>Mood (face)</label>
        <div class="seg" id="f-actormood">
          <button data-mood="happy" class="${curMood==="happy"?"active":""}">🙂 Happy</button>
          <button data-mood="neutral" class="${curMood==="neutral"?"active":""}">😐 Neutral</button>
          <button data-mood="sad" class="${curMood==="sad"?"active":""}">🙁 Sad</button>
        </div></div>` : ""}
      ${isActor ? `<div class="field"><button class="tbtn" id="f-actorplay" type="button" style="width:100%;justify-content:center">▶ Play action once</button>
        <div class="insp-empty" style="font-size:.7em;padding-top:.3rem">On the live stage, click the character to play its action. ${actorHasLevel?"Level below sets growth / fill.":""}</div></div>` : ""}
      ${(isSdg||(isActor&&!actorHasLevel)) ? "" : field((actorHasLevel?(el.objectType==="water_tank"?"Fill ":"Growth ")+(el.level||0)+"%":"Level "+(el.level||0)+"%"),`<input type="range" id="f-level" min="0" max="100" value="${el.level||0}">`)}
      ${isSdg ? "" : field(isActor?"Tint colour":"Accent colour",`<input type="color" id="f-accent" value="${el.accent||def.accent||"#4cc9f0"}">`)}
      ${(isSdg||isActor) ? "" : field("Show number / count",`<div class="seg" id="f-showval"><button data-v="1" class="${((el.showValue!==undefined)?el.showValue!==false:(el.showCount!==false))?"active":""}">Show</button><button data-v="0" class="${((el.showValue!==undefined)?el.showValue===false:(el.showCount===false))?"active":""}">Hide</button></div>`)}
      ${isSdg ? "" : field("Show label",`<div class="seg" id="f-showlbl"><button data-l="1" class="${((el.showLabel!==undefined)?el.showLabel!==false:(el.showCount!==false))?"active":""}">Show</button><button data-l="0" class="${((el.showLabel!==undefined)?el.showLabel===false:(el.showCount===false))?"active":""}">Hide</button></div>`)}
      ${field("Container box",`<div class="seg" id="f-objbox"><button data-box="show" class="${!el.hideContainer?"active":""}">Show box</button><button data-box="hide" class="${el.hideContainer?"active":""}">Hide box</button></div>`)}
      ${(def.fill||el.objectType==="water_glass"||el.objectType==="sand_glass") ? `
      ${field("Number position",`<div class="seg" id="f-numpos">
        <button data-numpos="below" class="${(el.numberPos||"onfill")==="below"?"active":""}">Below</button>
        <button data-numpos="onfill" class="${(el.numberPos||"onfill")==="onfill"?"active":""}">On fill</button>
        <button data-numpos="center" class="${el.numberPos==="center"?"active":""}">Center</button></div>`)}
      ${field("Number behaviour",`<div class="seg" id="f-nummode">
        <button data-nummode="static" class="${(el.numberMode||"static")==="static"?"active":""}">Static</button>
        <button data-nummode="countup" class="${el.numberMode==="countup"?"active":""}">Count up</button></div>`)}
      ` : ""}
      ${field("Object size "+Math.round((el.objScale||1)*100)+"%",`<input type="range" id="f-objscale" min="40" max="400" step="5" value="${Math.round((el.objScale||1)*100)}">`)}
      ${(!isSdg && !isActor && ((el.showValue!==undefined)?el.showValue!==false:(el.showCount!==false))) ? `
      ${field("Count colour",`<span style="display:flex;gap:.4rem;align-items:center"><input type="color" id="f-numcolor" value="${el.numberColor||(el.objectType==="gauge"?"#ffffff":"#0e1116")}"><button class="chip" id="f-numcolor-auto" type="button" title="Reset to default">Auto</button></span>`)}
      ${field("Count size "+(Number(el.numberSize)>0?Number(el.numberSize)+"px":"(auto)"),`<input type="range" id="f-numsize" min="0" max="120" step="1" value="${Number(el.numberSize)||0}"> <span class="insp-empty" style="font-size:.7em">0 = auto</span>`)}
      ` : ""}
      ${(el.objectType==="sdg_wheel"||el.objectType==="sdg_tiles"||el.objectType==="sdg") ? `
      ${field("Goals shown ("+(el.count||17)+" of 17)",`<input type="range" id="f-sdgcount" min="1" max="17" value="${el.count||17}">`)}
      ${field("Goal icons",`<div class="seg" id="f-sdgicons"><button data-si="1" class="${el.sdgIcons!==false?"active":""}">Show</button><button data-si="0" class="${el.sdgIcons===false?"active":""}">Hide</button></div>`)}
      ${(el.objectType!=="sdg_tiles") ? `
      ${field("Centre logo",`<div class="seg" id="f-sdgcenter"><button data-sc="1" class="${el.sdgCenter!==false?"active":""}">Show</button><button data-sc="0" class="${el.sdgCenter===false?"active":""}">Hide</button></div>`)}
      ${field("Centre text",`<div class="seg" id="f-sdgtheme"><button data-st="dark" class="${(el.sdgTheme||"dark")!=="light"?"active":""}">SDG blue</button><button data-st="light" class="${el.sdgTheme==="light"?"active":""}">White</button></div>`)}
      ` : `
      ${field("Tile titles",`<div class="seg" id="f-sdgtitles"><button data-stt="1" class="${el.sdgTitles!==false?"active":""}">Show</button><button data-stt="0" class="${el.sdgTitles===false?"active":""}">Hide</button></div>`)}
      ${field("Columns "+(el.sdgCols||"auto"),`<input type="range" id="f-sdgcols" min="1" max="9" value="${el.sdgCols||0}"> <span class="insp-empty" style="font-size:.7em">0 = auto</span>`)}
      `}
      ` : ""}
      ${segObjectKind(el) ? segEditorMarkup(el) : ""}
      ${el.objectType==="food_wheel" ? `
      ${field("Centre title",`<input type="text" id="f-fwtitle" value="${((el.centerTitle!=null?el.centerTitle:"HEALTHY\\nFOOD")).replace(/\n/g,"\\n").replace(/"/g,"&quot;")}"> <span class="insp-empty" style="font-size:.7em">\\n = line break</span>`)}
      ` : ""}
      ${el.objectType==="teardrop_badge" ? `
      ${field("Number",`<input type="text" id="f-dropnum" value="${(el.dropNumber!=null?String(el.dropNumber):"01").replace(/"/g,"&quot;")}">`)}
      ${field("Point corner",`<div class="seg" id="f-dropcorner"><button data-dc="tl" class="${(el.dropCorner||"tl")==="tl"?"active":""}">↖</button><button data-dc="tr" class="${el.dropCorner==="tr"?"active":""}">↗</button><button data-dc="bl" class="${el.dropCorner==="bl"?"active":""}">↙</button><button data-dc="br" class="${el.dropCorner==="br"?"active":""}">↘</button></div>`)}
      ${field("Style",`<div class="seg" id="f-dropstyle"><button data-ds="solid" class="${el.dropStyle!=="outline"?"active":""}">Solid</button><button data-ds="outline" class="${el.dropStyle==="outline"?"active":""}">Outline</button></div>`)}
      ` : ""}
      ${el.objectType==="stat_item" ? `
      ${field("Number",`<input type="text" id="f-statnum" value="${(el.statNumber!=null?String(el.statNumber):"01").replace(/"/g,"&quot;")}">`)}
      ${field("Show number",`<div class="seg" id="f-statshownum"><button data-ssn="1" class="${el.statShowNumber!==false?"active":""}">Show</button><button data-ssn="0" class="${el.statShowNumber===false?"active":""}">Hide</button></div>`)}
      ${field("Title",`<input type="text" id="f-stattitle" value="${(el.statTitle!=null?el.statTitle:"Contents Title").replace(/"/g,"&quot;")}">`)}
      ${field("Show title",`<div class="seg" id="f-statshowtitle"><button data-sst="1" class="${el.statShowTitle!==false?"active":""}">Show</button><button data-sst="0" class="${el.statShowTitle===false?"active":""}">Hide</button></div>`)}
      ${field("Body text",`<input type="text" id="f-stattext" value="${(el.statText!=null?el.statText:"Get a modern presentation that is beautifully designed.").replace(/"/g,"&quot;")}">`)}
      ${field("Show text",`<div class="seg" id="f-statshowtext"><button data-ssx="1" class="${el.statShowText!==false?"active":""}">Show</button><button data-ssx="0" class="${el.statShowText===false?"active":""}">Hide</button></div>`)}
      ${field("Style",`<div class="seg" id="f-statstyle"><button data-sty="card" class="${el.statStyle!=="solid"?"active":""}">Card</button><button data-sty="solid" class="${el.statStyle==="solid"?"active":""}">Solid</button></div>`)}
      ` : ""}
      ${el.objectType==="info_node" ? `
      ${field("Node icon",`<select id="f-nodeicon">
        ${["mug","pot","carton","box","beans","orange","bread","milk","cheese","meat","broccoli","apple","fish","clipboard","megaphone","plane","person","handshake","diamond","bulb","briefcase","clock","chart","search","dollar","tap","chat"].map(k=>`<option value="${k}" ${(el.nodeIcon||"mug")===k?"selected":""}>${k.charAt(0).toUpperCase()+k.slice(1)}</option>`).join("")}
      </select>`)}
      ${field("Node title",`<input type="text" id="f-nodetitle" value="${(el.nodeTitle||"Lorem ipsum").replace(/"/g,"&quot;")}">`)}
      ${field("Show title",`<div class="seg" id="f-nodeshowtitle"><button data-nst="1" class="${el.nodeShowTitle!==false?"active":""}">Show</button><button data-nst="0" class="${el.nodeShowTitle===false?"active":""}">Hide</button></div>`)}
      ${field("Node text",`<input type="text" id="f-nodetext" value="${(el.nodeText||"dolor sit amet, consectetuer").replace(/"/g,"&quot;")}">`)}
      ${field("Show text",`<div class="seg" id="f-nodeshowtext"><button data-nsx="1" class="${el.nodeShowText!==false?"active":""}">Show</button><button data-nsx="0" class="${el.nodeShowText===false?"active":""}">Hide</button></div>`)}
      ${field("Text colour",`<span style="display:flex;gap:.4rem;align-items:center"><input type="color" id="f-nodetextcolor" value="${el.nodeTextColor||"#2f3a3f"}"><button class="chip" id="f-nodetextcolor-auto" type="button" title="Reset to default (white)">Auto</button></span>`)}
      ` : ""}
      ${(el.objectType==="counter"||el.objectType==="loading_bar") ? `
      ${el.objectType==="counter" ? field("Count from",`<input type="number" id="f-countfrom" value="${Number(el.countFrom)||0}">`) : ""}
      ${el.objectType==="counter" ? field("Count to",`<input type="number" id="f-countto" value="${el.countTo!=null?el.countTo:100}">`) : ""}
      ${field("Prefix",`<input type="text" id="f-numpre" value="${(el.numberPrefix||"").replace(/"/g,"&quot;")}" placeholder="e.g. D or $">`)}
      ${field("Suffix",`<input type="text" id="f-numsuf" value="${(el.numberSuffix||"").replace(/"/g,"&quot;")}" placeholder="${el.objectType==="loading_bar"?"% (default)":"e.g. + or km"}">`)}
      ${field("Decimals "+(Number(el.numberDecimals)||0),`<input type="range" id="f-numdec" min="0" max="4" step="1" value="${Number(el.numberDecimals)||0}">`)}
      ${field("Thousands separator",`<div class="seg" id="f-countsep"><button data-cs="1" class="${el.countSep!==false?"active":""}">1,000</button><button data-cs="0" class="${el.countSep===false?"active":""}">1000</button></div>`)}
      ${field("Load time "+((Number(el.countDur)||1600)/1000).toFixed(1)+"s",`<input type="range" id="f-countdur" min="300" max="5000" step="100" value="${Number(el.countDur)||1600}">`)}
      <div class="insp-empty" style="padding-top:.2rem;font-size:.78em">The number counts up on the live stage and in Preview. The editor always shows the final value so you can lay the slide out.</div>
      ` : ""}
      ${(def.fill && el.objectType!=="loading_bar") ? field("Fill behaviour",`<div class="seg" id="f-levelmode">
        <button data-lm="instant" class="${el.levelMode!=="load"?"active":""}">Instant</button>
        <button data-lm="load" class="${el.levelMode==="load"?"active":""}">Load up</button></div>`) : ""}
      ${field("Animation",`<div class="seg" id="f-objanim"><button data-objanim="on" class="${el.objAnim!==false?"active":""}">On</button><button data-objanim="off" class="${el.objAnim===false?"active":""}">Off</button></div>`)}
      <div class="insp-empty" style="padding-top:.2rem">${def.help||"Animated visual object"}</div>
    </div>`;
    }
  }
  if(el.type==="freeform"){
    const kinds=(Hx.FREEFORM_KINDS||[]);
    const pts=(Hx.freeformPoints?Hx.freeformPoints(el):[]).length;
    const edited=Array.isArray(el.points)&&el.points.length>=2;
    const mode=el.fillMode||"solid";
    h+=`<div class="group"><span class="glabel">Shape</span>
      ${field("Start from",`<select id="f-ff-kind">${kinds.map(k=>`<option value="${k.key}" ${(el.shapeKind||"polygon")===k.key?"selected":""}>${k.label}</option>`).join("")}</select>`)}
      ${field(`Points / sides ${Number(el.sides)||6}`,`<input type="range" id="f-ff-sides" min="3" max="24" step="1" value="${Number(el.sides)||6}">`)}
      ${field(`Inner radius ${Math.round((el.inset==null?.45:el.inset)*100)}%`,`<input type="range" id="f-ff-inset" min="0.08" max="0.95" step="0.01" value="${el.inset==null?.45:el.inset}">`)}
      ${field(`Corner rounding ${Math.round((Number(el.corner)||0)*100)}%`,`<input type="range" id="f-ff-corner" min="0" max="1" step="0.02" value="${Number(el.corner)||0}">`)}
      ${field("Edges",`<div class="seg" id="f-ff-smooth"><button data-ffs="0" class="${el.smooth?"":"active"}">Straight</button><button data-ffs="1" class="${el.smooth?"active":""}">Smooth curve</button></div>`)}
      ${field("Path",`<div class="seg" id="f-ff-closed"><button data-ffc="1" class="${el.closed!==false?"active":""}">Closed</button><button data-ffc="0" class="${el.closed===false?"active":""}">Open</button></div>`)}
      <div class="insp-empty" style="padding:.15rem 0 .5rem">${pts} point${pts===1?"":"s"}${edited?" · edited by hand":""}. Drag any dot on the canvas to reshape it, click a hollow dot to add one, Alt-click a solid one to remove it.</div>
      ${edited?`<button class="tbtn" id="f-ff-reset" type="button" style="width:100%;justify-content:center">↺ Back to the preset shape</button>`:""}
    </div>
    <div class="group"><span class="glabel">Fill &amp; outline</span>
      ${field("Fill",`<div class="seg" id="f-ff-fillmode">${[["solid","Solid"],["linear","Gradient"],["radial","Radial"],["none","None"]].map(([k,l])=>`<button data-ffm="${k}" class="${mode===k?"active":""}">${l}</button>`).join("")}</div>`)}
      ${mode!=="none"?field("Colour",`<input type="color" id="f-ff-fill" value="${el.fill||"#e8482b"}">`):""}
      ${(mode==="linear"||mode==="radial")?field("Second colour",`<input type="color" id="f-ff-fill2" value="${el.fill2||"#f2c14e"}">`):""}
      ${mode==="linear"?field(`Gradient angle ${Number(el.gradAngle)||0}°`,`<input type="range" id="f-ff-angle" min="0" max="360" step="5" value="${Number(el.gradAngle)||0}">`):""}
      ${field("Outline colour",`<input type="color" id="f-ff-stroke" value="${el.stroke&&el.stroke!=="none"?el.stroke:"#16140f"}">`)}
      ${field(`Outline width ${Number(el.strokeW)||0}`,`<input type="range" id="f-ff-strokew" min="0" max="14" step="0.5" value="${Number(el.strokeW)||0}">`)}
      ${field(`Dashes ${Number(el.dash)||0}`,`<input type="range" id="f-ff-dash" min="0" max="12" step="1" value="${Number(el.dash)||0}">`)}
    </div>`;
  }

  if(el.type==="focus"){
    const shapes=(Hx.FOCUS_SHAPES||[{key:"circle",label:"Circle"},{key:"rect",label:"Rectangle"}]);
    const places=(Hx.FOCUS_PLACES||[{key:"auto",label:"Auto"}]);
    const zoom=Number(el.zoom)||2.4;
    const dim=(el.dim==null?.55:Number(el.dim));
    h+=`<div class="group"><span class="glabel">Zoom region</span>
      <div class="insp-empty" style="padding:0 0 .6rem">Drag and size this marker over the part of the slide worth a closer look. It is invisible during the show until you tap it on the phone controller — then the slide dims behind and this area lifts forward, enlarged.</div>
      ${field("Name shown on your phone",`<input type="text" id="f-focus-label" value="${escapeAttr(el.label||"Zoom in")}" placeholder="e.g. 2024 spike">`)}
      ${field("Shape",`<div class="seg" id="f-focus-shape">${shapes.map(s=>`<button data-fshape="${s.key}" class="${(el.focusShape||"circle")===s.key?"active":""}">${s.label}</button>`).join("")}</div>`)}
      ${field(`Magnification ${zoom.toFixed(1)}×`,`<input type="range" id="f-focus-zoom" min="1.2" max="6" step="0.1" value="${zoom}">`)}
      ${field("Where the enlarged panel sits",`<select id="f-focus-place">${places.map(p=>`<option value="${p.key}" ${(el.place||"auto")===p.key?"selected":""}>${p.label}</option>`).join("")}</select>`)}
      ${field(`Dim the rest of the slide ${Math.round(dim*100)}%`,`<input type="range" id="f-focus-dim" min="0" max="0.9" step="0.05" value="${dim}">`)}
      ${field("Leader lines",`<div class="seg" id="f-focus-leaders"><button data-fl="1" class="${el.leaders!==false?"active":""}">Show</button><button data-fl="0" class="${el.leaders===false?"active":""}">Hide</button></div>`)}
      ${field("Caption under the panel",`<input type="text" id="f-focus-caption" value="${escapeAttr(el.focusCaption||"")}" placeholder="optional">`)}
      ${field("Ring &amp; line colour",`<input type="color" id="f-focus-accent" value="${el.accent||"#1d4e89"}">`)}
      <button class="tbtn primary" id="f-focus-preview" type="button" style="width:100%;justify-content:center;margin-top:.55rem">🔍 Preview this zoom</button>
      <div class="insp-empty" style="padding-top:.5rem">Auto placement puts the panel on whichever side of the region has the most room. A region can hold anything — chart, map, table, photo — because the panel magnifies the real slide, not a copy of one element.</div>
    </div>`;
  }
  // ── Effects: shadow / glow / 3-D / filters / blend, on ANY element ──
  if(el.type!=="group"){
    const f=(Hx.elFx?Hx.elFx(el):{});
    const blends=(Hx.BLEND_MODES||["normal"]);
    h+=`<div class="group"><span class="glabel">Effects</span>
      ${field(`Opacity ${Math.round((el.opacity==null?1:el.opacity)*100)}%`,`<input type="range" id="f-fx-op" min="0" max="1" step="0.02" value="${el.opacity==null?1:el.opacity}">`)}
      ${field("Drop shadow",`<div class="seg" id="f-fx-shadow"><button data-fxs="0" class="${f.shadow?"":"active"}">Off</button><button data-fxs="1" class="${f.shadow?"active":""}">On</button></div>`)}
      ${f.shadow?`
        ${field(`Shadow across ${f.sx}`,`<input type="range" id="f-fx-sx" min="-40" max="40" step="1" value="${f.sx}">`)}
        ${field(`Shadow down ${f.sy}`,`<input type="range" id="f-fx-sy" min="-40" max="40" step="1" value="${f.sy}">`)}
        ${field(`Shadow softness ${f.sblur}`,`<input type="range" id="f-fx-sblur" min="0" max="60" step="1" value="${f.sblur}">`)}
        ${field("Shadow colour",`<input type="color" id="f-fx-scolor" value="${rgbaToHex(f.scolor)}">`)}`:""}
      ${field("Glow",`<div class="seg" id="f-fx-glow"><button data-fxg="0" class="${f.glow?"":"active"}">Off</button><button data-fxg="1" class="${f.glow?"active":""}">On</button></div>`)}
      ${f.glow?`
        ${field(`Glow size ${f.gsize}`,`<input type="range" id="f-fx-gsize" min="2" max="60" step="1" value="${f.gsize}">`)}
        ${field("Glow colour",`<input type="color" id="f-fx-gcolor" value="${f.gcolor}">`)}`:""}
      ${field("3-D tilt",`<div class="seg" id="f-fx-d3"><button data-fx3="0" class="${f.d3?"":"active"}">Flat</button><button data-fx3="1" class="${f.d3?"active":""}">Tilted</button></div>`)}
      ${f.d3?`
        ${field(`Lean back / forward ${f.rx}°`,`<input type="range" id="f-fx-rx" min="-70" max="70" step="1" value="${f.rx}">`)}
        ${field(`Turn left / right ${f.ry}°`,`<input type="range" id="f-fx-ry" min="-70" max="70" step="1" value="${f.ry}">`)}
        ${field(`Perspective ${f.persp}`,`<input type="range" id="f-fx-persp" min="200" max="2400" step="20" value="${f.persp}">`)}`:""}
      ${field(`Extruded depth ${f.depth}`,`<input type="range" id="f-fx-depth" min="0" max="24" step="1" value="${f.depth}">`)}
      ${field("Depth colour",`<input type="color" id="f-fx-dcolor" value="${rgbaToHex(f.dcolor)}">`)}
      ${field(`Blur ${f.blur}`,`<input type="range" id="f-fx-blur" min="0" max="24" step="0.5" value="${f.blur}">`)}
      ${field(`Brightness ${f.bright}%`,`<input type="range" id="f-fx-bright" min="20" max="220" step="5" value="${f.bright}">`)}
      ${field(`Saturation ${f.sat}%`,`<input type="range" id="f-fx-sat" min="0" max="260" step="5" value="${f.sat}">`)}
      ${field("Blend with what is behind",`<select id="f-fx-blend">${blends.map(b=>`<option value="${b}" ${f.blend===b?"selected":""}>${b}</option>`).join("")}</select>`)}
      ${field("Flip",`<div class="seg" id="f-fx-flip"><button data-fxf="h" class="${f.flipH?"active":""}">↔ Across</button><button data-fxf="v" class="${f.flipV?"active":""}">↕ Down</button></div>`)}
      <div class="insp-empty" style="padding-top:.4rem">Extruded depth stacks hard copies behind the artwork and follows its real outline — so it works on a star or a letter, not just a box.</div>
    </div>`;
  }

  if(el.type==="group"){
    h+=`<div class="group"><span class="glabel">Bound group</span>
      <div class="bind-summary"><b>${Array.isArray(el.children)?el.children.length:0}</b><span>objects are bound together. You can move, resize, copy, layer, animate, or unbind them later.</span></div>
      <button class="tbtn primary" id="f-unbind-group" type="button" style="width:100%;justify-content:center">⛓ Unbind group</button>
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
  $("#f-layer-front")&&$("#f-layer-front").addEventListener("click",()=>moveElementLayer("front"));
  $("#f-layer-forward")&&$("#f-layer-forward").addEventListener("click",()=>moveElementLayer("forward"));
  $("#f-layer-backward")&&$("#f-layer-backward").addEventListener("click",()=>moveElementLayer("backward"));
  $("#f-layer-back")&&$("#f-layer-back").addEventListener("click",()=>moveElementLayer("back"));
  $("#f-unbind-group")&&$("#f-unbind-group").addEventListener("click",unbindSelected);
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

  if(el.type==="freeform"){
    const kd=$("#f-ff-kind");
    kd&&kd.addEventListener("change",()=>{
      // Choosing a new preset is an explicit "start over": it drops any
      // hand-dragged points, which is why the panel warns you first.
      if(Array.isArray(el.points)&&el.points.length>=2
         && !confirm("Switching preset replaces the points you dragged. Continue?")){
        kd.value=el.shapeKind||"polygon";return;
      }
      el.shapeKind=kd.value;el.points=null;renderCanvas();renderInspector();markDirty();
    });
    const reseed=()=>{ if(!Array.isArray(el.points))return; };
    bindRange("f-ff-sides",v=>{el.sides=v;if(!Array.isArray(el.points))renderCanvas();markDirty();},v=>String(v),"Points / sides");
    bindRange("f-ff-inset",v=>{el.inset=v;if(!Array.isArray(el.points))renderCanvas();markDirty();},v=>Math.round(v*100)+"%","Inner radius");
    bindRange("f-ff-corner",v=>{el.corner=v;renderCanvas();markDirty();},v=>Math.round(v*100)+"%","Corner rounding");
    seg("f-ff-smooth","ffs",v=>{el.smooth=v==="1";renderCanvas();markDirty();});
    seg("f-ff-closed","ffc",v=>{el.closed=v==="1";renderCanvas();markDirty();});
    seg("f-ff-fillmode","ffm",v=>{el.fillMode=v;renderCanvas();renderInspector();markDirty();});
    const c1=$("#f-ff-fill"); c1&&c1.addEventListener("input",()=>{el.fill=c1.value;renderCanvas();markDirty();});
    const c2=$("#f-ff-fill2");c2&&c2.addEventListener("input",()=>{el.fill2=c2.value;renderCanvas();markDirty();});
    bindRange("f-ff-angle",v=>{el.gradAngle=v;renderCanvas();markDirty();},v=>v+"\u00b0","Gradient angle");
    const st=$("#f-ff-stroke");
    st&&st.addEventListener("input",()=>{
      el.stroke=st.value;
      // Picking an outline colour on a shape that has no outline yet
      // should show one. Nudge the width field in place rather than
      // re-rendering the panel — a rebuild mid-drag closes the colour
      // picker the user is still holding open.
      if(!Number(el.strokeW)){
        el.strokeW=2;
        const w=$("#f-ff-strokew");
        if(w){w.value=2;const lab=w.closest(".field")?.querySelector("label");
          if(lab)lab.textContent="Outline width 2";}
      }
      renderCanvas();markDirty();
    });
    bindRange("f-ff-strokew",v=>{el.strokeW=v;if(v>0&&(!el.stroke||el.stroke==="none"))el.stroke="#16140f";renderCanvas();markDirty();},v=>String(v),"Outline width");
    bindRange("f-ff-dash",v=>{el.dash=v;renderCanvas();markDirty();},v=>String(v),"Dashes");
    $("#f-ff-reset")&&$("#f-ff-reset").addEventListener("click",()=>{
      el.points=null;renderCanvas();renderInspector();markDirty();
    });
  }

  // ── Effects, bound for every element type ──────────────────────────
  if(el.type!=="group"){
    const fx=()=>(el.fx||(el.fx={}));
    const touch=()=>{renderCanvas();markDirty();};
    bindRange("f-fx-op",v=>{el.opacity=v;touch();},v=>Math.round(v*100)+"%","Opacity");
    seg("f-fx-shadow","fxs",v=>{fx().shadow=v==="1";renderCanvas();renderInspector();markDirty();});
    bindRange("f-fx-sx",v=>{fx().sx=v;touch();},v=>String(v),"Shadow across");
    bindRange("f-fx-sy",v=>{fx().sy=v;touch();},v=>String(v),"Shadow down");
    bindRange("f-fx-sblur",v=>{fx().sblur=v;touch();},v=>String(v),"Shadow softness");
    const sc=$("#f-fx-scolor");
    sc&&sc.addEventListener("input",()=>{fx().scolor=hexWithAlpha(sc.value,fx().scolor);touch();});
    seg("f-fx-glow","fxg",v=>{fx().glow=v==="1";renderCanvas();renderInspector();markDirty();});
    bindRange("f-fx-gsize",v=>{fx().gsize=v;touch();},v=>String(v),"Glow size");
    const gc=$("#f-fx-gcolor");gc&&gc.addEventListener("input",()=>{fx().gcolor=gc.value;touch();});
    seg("f-fx-d3","fx3",v=>{
      const o=fx();o.d3=v==="1";
      // A tilt of nothing is invisible, which reads as "the button is broken".
      if(o.d3&&!o.rx&&!o.ry){o.rx=-12;o.ry=18;}
      renderCanvas();renderInspector();markDirty();
    });
    bindRange("f-fx-rx",v=>{fx().rx=v;touch();},v=>v+"\u00b0","Lean back / forward");
    bindRange("f-fx-ry",v=>{fx().ry=v;touch();},v=>v+"\u00b0","Turn left / right");
    bindRange("f-fx-persp",v=>{fx().persp=v;touch();},v=>String(v),"Perspective");
    // No renderInspector() here: rebuilding the panel while the slider is
    // still under the pointer drops the drag on the first step.
    bindRange("f-fx-depth",v=>{fx().depth=v;touch();},v=>String(v),"Extruded depth");
    const dc=$("#f-fx-dcolor");
    dc&&dc.addEventListener("input",()=>{fx().dcolor=hexWithAlpha(dc.value,fx().dcolor);touch();});
    bindRange("f-fx-blur",v=>{fx().blur=v;touch();},v=>String(v),"Blur");
    bindRange("f-fx-bright",v=>{fx().bright=v;touch();},v=>v+"%","Brightness");
    bindRange("f-fx-sat",v=>{fx().sat=v;touch();},v=>v+"%","Saturation");
    const bl=$("#f-fx-blend");bl&&bl.addEventListener("change",()=>{fx().blend=bl.value;touch();});
    const fl=$("#f-fx-flip");
    fl&&fl.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
      const o=fx();
      if(b.dataset.fxf==="h")o.flipH=!o.flipH; else o.flipV=!o.flipV;
      b.classList.toggle("active", b.dataset.fxf==="h"?!!o.flipH:!!o.flipV);
      touch();
    }));
  }

    if(el.type==="focus"){
    const lab=$("#f-focus-label");
    lab&&lab.addEventListener("input",()=>{el.label=lab.value;renderCanvas();markDirty();});
    const cap=$("#f-focus-caption");
    cap&&cap.addEventListener("input",()=>{el.focusCaption=cap.value;markDirty();});
    seg("f-focus-shape","fshape",v=>{el.focusShape=v;renderCanvas();markDirty();});
    seg("f-focus-leaders","fl",v=>{el.leaders=v==="1";markDirty();});
    bindRange("f-focus-zoom",v=>{el.zoom=v;renderCanvas();markDirty();},v=>v.toFixed(1)+"\u00d7","Magnification");
    bindRange("f-focus-dim",v=>{el.dim=v;markDirty();},v=>Math.round(v*100)+"%","Dim the rest of the slide");
    const pl=$("#f-focus-place");
    pl&&pl.addEventListener("change",()=>{el.place=pl.value;markDirty();});
    const ac=$("#f-focus-accent");
    ac&&ac.addEventListener("input",()=>{el.accent=ac.value;renderCanvas();markDirty();});
    $("#f-focus-preview")&&$("#f-focus-preview").addEventListener("click",()=>previewFocus(el));
  }

  if(el.type==="creative_shape"){
    const st=$("#f-shapetype");st&&st.addEventListener("change",()=>{const d=(SHAPES||[]).find(s=>s.kind===st.value)||SHAPES[0];el.shapeType=d.kind;el.fill=el.fill||d.accent||"#e8482b";renderCanvas();markDirty();renderInspector();});
    bindRange("f-shape-strokew",v=>{el.strokeW=v;renderCanvas();markDirty();},v=>v,"Stroke width");
    bindRange("f-shape-opacity",v=>{el.opacity=v;renderCanvas();markDirty();},v=>Math.round(v*100)+"%","Opacity");
  }

  if(el.type==="image"){bindRange("f-radius",v=>{el.radius=v;renderCanvas();markDirty();},v=>v,"Corner radius");
    $("#f-pickimg")&&$("#f-pickimg").addEventListener("click",()=>pickImageFor(el.id));
    seg("f-fit","fit",v=>{el.fit=v;renderCanvas();markDirty();});}
  if(el.type==="rect"||el.type==="ellipse"){bindRange("f-strokew",v=>{el.strokeW=v;renderCanvas();markDirty();},v=>v,"Stroke width");}

  if(el.type==="video"){
    const vt=$("#f-videotitle");vt&&vt.addEventListener("input",()=>{el.title=vt.value;renderCanvas();markDirty();});
    const vs=$("#f-videosrc");vs&&vs.addEventListener("input",()=>{el.src=vs.value;renderCanvas();markDirty();});
    const vp=$("#f-videoposter");vp&&vp.addEventListener("input",()=>{el.poster=vp.value;renderCanvas();markDirty();});
    seg("f-videofit","fit",v=>{el.fit=v;renderCanvas();markDirty();});
    seg("f-videocontrols","on",v=>{el.controls=v==="1";renderCanvas();markDirty();});
    seg("f-videoautoplay","on",v=>{el.autoplay=v==="1";renderCanvas();markDirty();});
    seg("f-videomuted","on",v=>{el.muted=v==="1";renderCanvas();markDirty();});
    bindRange("f-videoradius",v=>{el.radius=v;renderCanvas();markDirty();},v=>v,"Corner radius");
  }
  if(el.type==="gallery"){
    if(!Array.isArray(el.photos))el.photos=[];
    $("#f-gal-add")&&$("#f-gal-add").addEventListener("click",()=>pickGalleryPhotos(el.id));
    // caption edits
    $$(".gal-cap").forEach(inp=>inp.addEventListener("input",()=>{
      const idx=Number(inp.dataset.galIdx);
      if(el.photos[idx]){el.photos[idx].caption=inp.value;renderCanvas();markDirty();}
    }));
    // reorder + delete
    $$("[data-gal-up]").forEach(b=>b.addEventListener("click",()=>{
      const idx=Number(b.dataset.galUp);
      if(idx>0){const t=el.photos[idx-1];el.photos[idx-1]=el.photos[idx];el.photos[idx]=t;renderAll();markDirty();}
    }));
    $$("[data-gal-down]").forEach(b=>b.addEventListener("click",()=>{
      const idx=Number(b.dataset.galDown);
      if(idx<el.photos.length-1){const t=el.photos[idx+1];el.photos[idx+1]=el.photos[idx];el.photos[idx]=t;renderAll();markDirty();}
    }));
    $$("[data-gal-del]").forEach(b=>b.addEventListener("click",()=>{
      const idx=Number(b.dataset.galDel);
      el.photos.splice(idx,1);renderAll();markDirty();
    }));
    const gf=$("#f-gal-frame");gf&&gf.addEventListener("change",()=>{el.frame=gf.value;renderCanvas();markDirty();});
    seg("f-gal-fit","fit",v=>{el.fit=v;renderCanvas();markDirty();});
    const ga=$("#f-gal-anim");ga&&ga.addEventListener("change",()=>{el.galleryAnim=ga.value;renderCanvas();markDirty();});
    bindRange("f-gal-hold",v=>{el.holdMs=v;renderCanvas();markDirty();},v=>(v/1000).toFixed(1)+"s","Hold per photo");
    bindRange("f-gal-speed",v=>{el.stagger=v/100;renderCanvas();markDirty();},v=>(v/100).toFixed(2)+"×","Transition speed");
    seg("f-gal-loop","on",v=>{el.galleryLoop=v==="1";renderCanvas();markDirty();});
    const gbg=$("#f-gal-bg");gbg&&gbg.addEventListener("input",()=>{el.galleryBg=gbg.value;renderCanvas();markDirty();});
    const gbgc=$("#f-gal-bg-clear");gbgc&&gbgc.addEventListener("click",()=>{el.galleryBg="";renderInspector();renderCanvas();markDirty();});
  }
  if(el.type==="link"){
    const ll=$("#f-linklabel");ll&&ll.addEventListener("input",()=>{el.label=ll.value;renderCanvas();markDirty();});
    const lu=$("#f-linkurl");lu&&lu.addEventListener("input",()=>{el.url=lu.value;renderCanvas();markDirty();});
    const ld=$("#f-linkdesc");ld&&ld.addEventListener("input",()=>{el.description=ld.value;renderCanvas();markDirty();});
    const ls=$("#f-linkstyle");ls&&ls.addEventListener("change",()=>{el.linkStyle=ls.value;renderCanvas();markDirty();});
    const lb=$("#f-linkbg");lb&&lb.addEventListener("input",()=>{el.bg=lb.value;el.accent=lb.value;renderCanvas();markDirty();});
    const lc=$("#f-linkcolor");lc&&lc.addEventListener("input",()=>{el.textColor=lc.value;renderCanvas();markDirty();});
    bindRange("f-linkradius",v=>{el.radius=v;renderCanvas();markDirty();},v=>v,"Corner radius");
  }
  if(el.type==="table"){
    const data=$("#f-tabledata");data&&data.addEventListener("input",()=>{el.tableData=parseTableText(data.value);el.rows=el.tableData.length;el.cols=Math.max(1,...el.tableData.map(r=>r.length));renderCanvas();markDirty();});
    $("#f-tableimport")&&$("#f-tableimport").addEventListener("click",()=>pickDataFileFor(el.id,"table"));
    const rows=$("#f-tablerows");rows&&rows.addEventListener("input",()=>{el.rows=Math.max(1,Number(rows.value)||1);renderCanvas();markDirty();});
    const cols=$("#f-tablecols");cols&&cols.addEventListener("input",()=>{el.cols=Math.max(1,Number(cols.value)||1);renderCanvas();markDirty();});
    const theme=$("#f-tabletheme");theme&&theme.addEventListener("change",()=>{el.theme=theme.value;renderCanvas();markDirty();});
    bindRange("f-tablesize",v=>{el.size=v;renderCanvas();markDirty();},v=>v,"Font size");
    const acc=$("#f-tableaccent");acc&&acc.addEventListener("input",()=>{el.accent=acc.value;el.headerColor=acc.value;renderCanvas();markDirty();});
    const htc=$("#f-tableheadertext");htc&&htc.addEventListener("input",()=>{el.headerTextColor=htc.value;renderCanvas();markDirty();});
    const txc=$("#f-tabletextcolor");txc&&txc.addEventListener("input",()=>{el.textColor=txc.value;renderCanvas();markDirty();});
    const brd=$("#f-tableborder");brd&&brd.addEventListener("input",()=>{el.borderColor=brd.value;renderCanvas();markDirty();});
    seg("f-tablestriped","on",v=>{el.striped=v==="1";renderCanvas();markDirty();});
    seg("f-tableheader","header",v=>{el.header=v==="1";renderCanvas();markDirty();});
  }
  if(el.type==="chart"){
    const title=$("#f-charttitle");title&&title.addEventListener("input",()=>{el.title=title.value;renderCanvas();markDirty();});
    const kind=$("#f-chartkind");kind&&kind.addEventListener("change",()=>{el.chartKind=kind.value;renderCanvas();markDirty();});
    const engine=$("#f-chartengine");engine&&engine.addEventListener("change",()=>{el.renderEngine=engine.value;renderCanvas();markDirty();});
    const data=$("#f-chartdata");data&&data.addEventListener("input",()=>{el.chartData=parseChartText(data.value);renderCanvas();markDirty();});
    $("#f-chartimport")&&$("#f-chartimport").addEventListener("click",()=>pickDataFileFor(el.id,"chart"));
    seg("f-chartvalues","show",v=>{el.showValues=v==="1";renderCanvas();markDirty();});
    seg("f-chartsort","sort",v=>{el.sortOrder=v==="none"?null:v;renderCanvas();markDirty();});
    seg("f-chartshowtitle","on",v=>{el.showTitle=v==="1";renderCanvas();markDirty();});
    const vc=$("#f-chartvaluecolor");vc&&vc.addEventListener("input",()=>{el.valueColor=vc.value;renderCanvas();markDirty();});
    const lc=$("#f-chartlabelcolor");lc&&lc.addEventListener("input",()=>{el.labelColor=lc.value;renderCanvas();markDirty();});
    bindRange("f-chartlabelsize",v=>{el.labelSize=v;renderCanvas();markDirty();},v=>v,"Text size");
    const pre=$("#f-chartprefix");pre&&pre.addEventListener("input",()=>{el.valuePrefix=pre.value;renderCanvas();markDirty();});
    const suf=$("#f-chartsuffix");suf&&suf.addEventListener("input",()=>{el.valueSuffix=suf.value;renderCanvas();markDirty();});
    const dec=$("#f-chartdecimals");dec&&dec.addEventListener("input",()=>{el.decimals=Math.max(0,Number(dec.value)||0);renderCanvas();markDirty();});
    const mx=$("#f-chartmax");mx&&mx.addEventListener("input",()=>{el.max=Math.max(1,Number(mx.value)||100);renderCanvas();markDirty();});
    seg("f-charttheme","mode",v=>{el.chartThemeMode=v;renderCanvas();markDirty();});
    seg("f-chartgrid","on",v=>{el.gridLines=v==="1";renderCanvas();markDirty();});
    seg("f-chartaxis","on",v=>{el.axisValues=v==="1";renderCanvas();markDirty();});
    seg("f-chartlegend","on",v=>{el.showLegend=v==="1";renderCanvas();markDirty();});
    const tc=$("#f-charttitlecolor");tc&&tc.addEventListener("input",()=>{el.titleColor=tc.value;renderCanvas();markDirty();});
    const pt=$("#f-plotlytemplate");pt&&pt.addEventListener("change",()=>{el.plotlyTemplate=pt.value; if(pt.value==="plotly_dark") el.chartThemeMode="dark"; renderCanvas();markDirty();});
    seg("f-plotlymodebar","on",v=>{el.plotlyModebar=v==="1";renderCanvas();markDirty();});
    $$("#f-chartpalette .pal-sw").forEach(sw=>sw.addEventListener("input",()=>{
      const pal=Array.isArray(el.palette)&&el.palette.length?el.palette.slice():["#e8482b","#22c55e","#38bdf8","#f59e0b","#a855f7","#ef4444"];
      pal[Number(sw.dataset.pi)]=sw.value;el.palette=pal;el.accent=pal[0];renderCanvas();markDirty();
    }));
  }
  if(el.type==="map"){
    const title=$("#f-maptitle");title&&title.addEventListener("input",()=>{el.title=title.value;renderCanvas();markDirty();});
    const kind=$("#f-mapkind");kind&&kind.addEventListener("change",()=>{el.mapKind=kind.value;renderCanvas();renderInspector();markDirty();});
    const meng=$("#f-mapengine");meng&&meng.addEventListener("change",()=>{el.mapEngine=meng.value;renderCanvas();markDirty();});
    const tile=$("#f-tilelayer");tile&&tile.addEventListener("change",()=>{el.tileLayer=tile.value;renderCanvas();markDirty();});
    const zoom=$("#f-mapzoom");zoom&&zoom.addEventListener("input",()=>{el.zoom=zoom.value?Math.max(1,Math.min(18,Number(zoom.value)||7)):null;renderCanvas();markDirty();});
    const pins=$("#f-mappins");pins&&pins.addEventListener("input",()=>{el.pins=parsePinsText(pins.value);el.useCities=false;renderCanvas();markDirty();});
    $("#btn-map-pin-file")&&$("#btn-map-pin-file").addEventListener("click",()=>pickDataFileFor(el.id,"mapPins"));
    $("#btn-map-pin-template")&&$("#btn-map-pin-template").addEventListener("click",()=>downloadTextFile("hanns_map_pin_template.csv",pinTemplateText()));
    const areas=$("#f-mapareas");areas&&areas.addEventListener("input",()=>{el.areas=parseAreasText(areas.value);renderCanvas();markDirty();});
    $("#btn-map-area-modal")&&$("#btn-map-area-modal").addEventListener("click",()=>openAreaModal(el));
    $("#btn-map-area-file")&&$("#btn-map-area-file").addEventListener("click",()=>pickDataFileFor(el.id,"mapAreas"));
    $("#btn-map-area-template")&&$("#btn-map-area-template").addEventListener("click",()=>downloadTextFile("hanns_map_area_template.csv",areaTemplateText()));
    const af=$("#f-areafill");af&&af.addEventListener("input",()=>{el.areaFill=af.value;renderCanvas();markDirty();});
    const as=$("#f-areastroke");as&&as.addEventListener("input",()=>{el.areaStroke=as.value;renderCanvas();markDirty();});
    const ao=$("#f-areaopacity");ao&&ao.addEventListener("input",()=>{el.areaOpacity=Math.max(0,Math.min(1,Number(ao.value)||0));renderCanvas();markDirty();});
    const acc=$("#f-mapaccent");acc&&acc.addEventListener("input",()=>{el.accent=acc.value;renderCanvas();markDirty();});
    seg("f-mapcities","on",v=>{el.useCities=v==="1";renderCanvas();renderInspector();markDirty();});
    seg("f-maptheme","mode",v=>{el.mapTheme=v;renderCanvas();markDirty();});
    seg("f-maplabels","show",v=>{el.showLabels=v==="1";renderCanvas();markDirty();});
    seg("f-mapriver","on",v=>{el.showRiver=v==="1";renderCanvas();markDirty();});
    bindRange("f-maplabelsize",v=>{el.labelSize=v;renderCanvas();markDirty();},v=>v,"Label size");
    const tc=$("#f-maptitlecolor");tc&&tc.addEventListener("input",()=>{el.titleColor=tc.value;renderCanvas();markDirty();});
  }

  if(el.type==="object"){
    const type=$("#f-objtype");type&&type.addEventListener("change",()=>{
      const d=(OBJECTS||[]).find(o=>o.kind===type.value)||OBJECTS[0];
      el.objectType=d.kind;el.label=d.label;el.icon=d.icon;el.count=d.count;el.level=d.level||0;el.accent=d.accent||el.accent;
      el.numberPos=d.fill?"onfill":"below";
      const AC=window.HannsActors;
      if(AC && AC.isActor(d.kind)){
        el.action=el.action||"idle";
        if(AC.ACTOR_HAS_MOOD.has(d.kind)) el.mood=el.mood||"neutral";
      }
      if(d.kind==="teleprompter" && el.script==null) el.script="";
      el.w=d.w||el.w;el.h=d.h||el.h;renderAll();markDirty();
    });
    const lab=$("#f-objlabel");lab&&lab.addEventListener("input",()=>{el.label=lab.value;renderCanvas();markDirty();});
    // ── teleprompter script field ──
    const tp=$("#f-tp-script");
    if(tp){
      tp.addEventListener("input",()=>{
        el.script=tp.value;
        const t=tp.value.trim();
        const words=t?t.split(/\s+/).length:0;
        const mins=words?Math.max(1,Math.round(words/130)):0;
        const stats=$("#f-tp-stats");
        if(stats)stats.textContent=words?words+" words · ~"+mins+" min read":"No script yet";
        renderCanvas();markDirty();
      });
    }
    const count=$("#f-count");count&&count.addEventListener("input",()=>{el.count=Math.max(1,Number(count.value)||1);renderCanvas();markDirty();});
    // ── actor controls ──
    seg("f-actoraction","act",v=>{el.action=v;renderCanvas();markDirty();});
    seg("f-actormood","mood",v=>{el.mood=v;renderCanvas();markDirty();});
    const play=$("#f-actorplay");play&&play.addEventListener("click",()=>{
      const AC=window.HannsActors;if(!AC)return;
      const node=document.querySelector(`.el[data-id="${el.id}"] .actor`);
      if(node)AC.playActorOnce(node, el.action && el.action!=="idle" ? el.action : (AC.ACTOR_ACTIONS[el.objectType]||["idle"]).filter(a=>a!=="idle")[0]||"idle", 1500);
    });
    bindRange("f-level",v=>{el.level=v;renderCanvas();markDirty();},v=>v+"%","Level");
    const acc=$("#f-accent");acc&&acc.addEventListener("input",()=>{el.accent=acc.value;renderCanvas();markDirty();});
    seg("f-showval","v",v=>{el.showValue=v==="1";renderCanvas();markDirty();});
    seg("f-showlbl","l",v=>{el.showLabel=v==="1";renderCanvas();markDirty();});
    seg("f-objbox","box",v=>{el.hideContainer=(v==="hide");renderCanvas();markDirty();});
    seg("f-numpos","numpos",v=>{el.numberPos=v;renderCanvas();markDirty();});
    seg("f-nummode","nummode",v=>{el.numberMode=v;renderCanvas();markDirty();});
    seg("f-objanim","objanim",v=>{el.objAnim=(v==="on");renderCanvas();markDirty();});
    // animated readouts (counter / loading bar)
    const readout=(id,key,cast)=>{const i=$("#"+id);if(!i)return;
      i.addEventListener("input",()=>{el[key]=cast?cast(i.value):i.value;renderCanvas();markDirty();});};
    readout("f-countfrom","countFrom",v=>Number(v)||0);
    readout("f-countto","countTo",v=>Number(v)||0);
    readout("f-numpre","numberPrefix");
    readout("f-numsuf","numberSuffix");
    bindRange("f-numdec",v=>{el.numberDecimals=v;renderCanvas();markDirty();},v=>v,"Decimals");
    bindRange("f-countdur",v=>{el.countDur=v;renderCanvas();markDirty();},v=>(v/1000).toFixed(1)+"s","Load time");
    seg("f-countsep","cs",v=>{el.countSep=(v==="1");renderCanvas();markDirty();});
    seg("f-levelmode","lm",v=>{el.levelMode=v;renderCanvas();markDirty();});
    bindRange("f-objscale",v=>{el.objScale=Math.max(0.4,Math.min(4,v/100));renderCanvas();markDirty();},v=>v+"%","Object size");
    const numc=$("#f-numcolor");numc&&numc.addEventListener("input",()=>{el.numberColor=numc.value;renderCanvas();markDirty();});
    const numcAuto=$("#f-numcolor-auto");numcAuto&&numcAuto.addEventListener("click",()=>{el.numberColor="";renderInspector();renderCanvas();markDirty();});
    bindRange("f-numsize",v=>{el.numberSize=v||0;renderCanvas();markDirty();},v=>(v>0?v+"px":"(auto)"),"Count size");
    // SDG-specific controls
    bindRange("f-sdgcount",v=>{el.count=Math.max(1,Math.min(17,v));renderCanvas();markDirty();},v=>v+" of 17","Goals shown");
    seg("f-sdgicons","si",v=>{el.sdgIcons=(v==="1");renderCanvas();markDirty();});
    seg("f-sdgcenter","sc",v=>{el.sdgCenter=(v==="1");renderCanvas();markDirty();});
    seg("f-sdgtheme","st",v=>{el.sdgTheme=v;renderCanvas();markDirty();});
    seg("f-sdgtitles","stt",v=>{el.sdgTitles=(v==="1");renderCanvas();markDirty();});
    bindRange("f-sdgcols",v=>{el.sdgCols=v||0;renderCanvas();markDirty();},v=>v||"auto","Columns");
    // info_node controls
    const ni=$("#f-nodeicon");ni&&ni.addEventListener("change",()=>{el.nodeIcon=ni.value;renderCanvas();markDirty();});
    const nt=$("#f-nodetitle");nt&&nt.addEventListener("input",()=>{el.nodeTitle=nt.value;renderCanvas();markDirty();});
    seg("f-nodeshowtitle","nst",v=>{el.nodeShowTitle=(v==="1");renderCanvas();markDirty();});
    const nx=$("#f-nodetext");nx&&nx.addEventListener("input",()=>{el.nodeText=nx.value;renderCanvas();markDirty();});
    seg("f-nodeshowtext","nsx",v=>{el.nodeShowText=(v==="1");renderCanvas();markDirty();});
    const ntc=$("#f-nodetextcolor");ntc&&ntc.addEventListener("input",()=>{el.nodeTextColor=ntc.value;renderCanvas();markDirty();});
    const ntcAuto=$("#f-nodetextcolor-auto");ntcAuto&&ntcAuto.addEventListener("click",()=>{el.nodeTextColor="";renderInspector();renderCanvas();markDirty();});
    // food_wheel centre title (\n for line break)
    const fwt=$("#f-fwtitle");fwt&&fwt.addEventListener("input",()=>{el.centerTitle=fwt.value.replace(/\\n/g,"\n");renderCanvas();markDirty();});
    // segment / band editor (diet_plate, food_wheel, funnel_stack, coffee_segments)
    wireSegEditor(el);
    // stat_item controls
    const sn=$("#f-statnum");sn&&sn.addEventListener("input",()=>{el.statNumber=sn.value;renderCanvas();markDirty();});
    seg("f-statshownum","ssn",v=>{el.statShowNumber=(v==="1");renderCanvas();markDirty();});
    const st=$("#f-stattitle");st&&st.addEventListener("input",()=>{el.statTitle=st.value;renderCanvas();markDirty();});
    seg("f-statshowtitle","sst",v=>{el.statShowTitle=(v==="1");renderCanvas();markDirty();});
    const sx=$("#f-stattext");sx&&sx.addEventListener("input",()=>{el.statText=sx.value;renderCanvas();markDirty();});
    seg("f-statshowtext","ssx",v=>{el.statShowText=(v==="1");renderCanvas();markDirty();});
    seg("f-statstyle","sty",v=>{el.statStyle=v;renderCanvas();markDirty();});
    // teardrop_badge controls
    const dn=$("#f-dropnum");dn&&dn.addEventListener("input",()=>{el.dropNumber=dn.value;renderCanvas();markDirty();});
    seg("f-dropcorner","dc",v=>{el.dropCorner=v;renderCanvas();markDirty();});
    seg("f-dropstyle","ds",v=>{el.dropStyle=v;renderCanvas();markDirty();});
  }
  // swatches
  $$(".sw[data-color]",inspBody).forEach(s=>s.addEventListener("click",()=>{el.color=s.dataset.color;activateSwatch(s,"color");renderCanvas();markDirty();}));
  $$(".sw[data-fill]",inspBody).forEach(s=>s.addEventListener("click",()=>{el.fill=s.dataset.fill;activateSwatch(s,"fill");renderCanvas();markDirty();}));
  $$(".sw[data-stroke]",inspBody).forEach(s=>s.addEventListener("click",()=>{el.stroke=s.dataset.stroke;activateSwatch(s,"stroke");renderCanvas();markDirty();}));
  $("#f-del")&&$("#f-del").addEventListener("click",()=>deleteEl(el.id));
}
function activateSwatch(node,attr){node.parentElement.querySelectorAll(".sw").forEach(x=>x.classList.remove("active"));node.classList.add("active");}
/* ── Segment / band editor for composite objects ────────────────────────
   Lets the user edit the label, value (%) and colour of every slice/band in
   the diet plate, food wheel, funnel and coffee-cup objects — plus add or
   remove segments. The value drives the slice/segment size where the object
   is proportional (pie + donut). Funnel/coffee bands are equal-height, so
   their value is ignored for geometry but the % label is still editable.
   ──────────────────────────────────────────────────────────────────────── */

/* Which objects expose a segment editor, and where their data lives. */
function segObjectKind(el){
  return ({
    diet_plate:      {key:"segments", hasSub:true,  hasValue:true,  label:"Slices"},
    food_wheel:      {key:"segments", hasSub:false, hasValue:true,  label:"Segments"},
    radial_bars:     {key:"segments", hasSub:false, hasValue:true,  label:"Rings"},
    funnel_stack:    {key:"bands",    hasSub:false, hasValue:false, label:"Bands"},
    coffee_segments: {key:"bands",    hasSub:true,  hasValue:false, label:"Bands"},
  })[el.objectType] || null;
}

/* Default seed data per object (mirrors the renderers' own defaults) so the
   editor has rows to show even before the user customises anything. */
function segDefaults(kind){
  switch(kind){
    case "diet_plate": return [
      {label:"40%",sub:"fruits & vegetables",color:"#a9cf5a"},
      {label:"25%",sub:"cellulose",color:"#bfa074"},
      {label:"25%",sub:"protein",color:"#8fd0d8"},
      {label:"10%",sub:"fats",color:"#f5cd2a"}];
    case "food_wheel": return [
      {label:"15%",color:"#e8821e"},{label:"10%",color:"#f5cd2a"},
      {label:"35%",color:"#5a9e48"},{label:"25%",color:"#e8503a"},
      {label:"20%",color:"#5bb0cf"}];
    case "radial_bars": return [
      {label:"85%",color:"#3a7fc4",value:85},{label:"75%",color:"#6fae3a",value:75},
      {label:"65%",color:"#e0a81e",value:65},{label:"55%",color:"#e0633a",value:55}];
    case "funnel_stack": return [
      {label:"01",color:"#2f4fb0"},{label:"02",color:"#1f9e8a"},
      {label:"03",color:"#d83a3a"},{label:"04",color:"#e08a1e"},
      {label:"05",color:"#1f9e5a"}];
    case "coffee_segments": return [
      {label:"100%",color:"#a9805c"},{label:"",color:"#8c6443",sub:"Lorem ipsum"},
      {label:"50%",color:"#6f4a2e"},{label:"",color:"#56371f",sub:"Lorem ipsum"}];
    default: return [];
  }
}

/* Read the live segment array for an element (seeding defaults on first use). */
function segGet(el){
  const meta=segObjectKind(el); if(!meta) return [];
  let arr=el[meta.key];
  if(!Array.isArray(arr) || !arr.length){ arr=segDefaults(el.objectType); el[meta.key]=arr; }
  return arr;
}
function segValueOf(s){ const v=Number(s.value); return isFinite(v)&&v>0 ? v : (parseFloat(s.label)||1); }

function segEditorMarkup(el){
  const meta=segObjectKind(el); if(!meta) return "";
  const arr=segGet(el);
  const total=meta.hasValue ? arr.reduce((a,s)=>a+segValueOf(s),0) : 0;
  const rows=arr.map((s,i)=>{
    const pct = meta.hasValue && total>0 ? Math.round(segValueOf(s)/total*100) : null;
    return `<div class="seg-row" data-i="${i}">
      <input type="color" class="seg-color" data-i="${i}" value="${s.color||"#cccccc"}">
      <input type="text" class="seg-label" data-i="${i}" value="${(s.label||"").replace(/"/g,"&quot;")}" placeholder="label">
      ${meta.hasValue ? `<input type="number" class="seg-value" data-i="${i}" value="${segValueOf(s)}" min="0" step="1" title="value (slice size)">` : ""}
      ${meta.hasSub ? `<input type="text" class="seg-sub" data-i="${i}" value="${(s.sub||"").replace(/"/g,"&quot;")}" placeholder="sub-caption">` : ""}
      <button class="seg-del" data-i="${i}" type="button" title="Remove">✕</button>
      ${pct!=null?`<span class="seg-pct">${pct}%</span>`:""}
    </div>`;
  }).join("");
  return `<div class="group seg-editor"><span class="glabel">${meta.label} · label / value / colour</span>
    <div class="seg-rows">${rows}</div>
    <button class="chip seg-add" id="f-seg-add" type="button">+ Add ${meta.label.replace(/s$/,"").toLowerCase()}</button>
    ${meta.hasValue?`<div class="insp-empty" style="font-size:.7em;padding-top:.2rem">Slice size follows the value. Use the same scale (e.g. percentages that add to 100).</div>`:`<div class="insp-empty" style="font-size:.7em;padding-top:.2rem">Bands are equal height; edit the label text freely.</div>`}
  </div>`;
}

function wireSegEditor(el){
  const meta=segObjectKind(el); if(!meta) return;
  const refresh=()=>{ renderCanvas(); markDirty(); };
  const rerender=()=>{ renderInspector(); renderCanvas(); markDirty(); };
  // colour
  $$(".seg-color").forEach(inp=>inp.addEventListener("input",()=>{
    const arr=segGet(el); const i=+inp.dataset.i; if(arr[i]){ arr[i].color=inp.value; refresh(); }
  }));
  // label (also re-renders so the % readout updates when label is a number)
  $$(".seg-label").forEach(inp=>inp.addEventListener("input",()=>{
    const arr=segGet(el); const i=+inp.dataset.i; if(arr[i]){ arr[i].label=inp.value; refresh(); }
  }));
  // value (drives slice size) — soft refresh of the live % badges in the panel
  $$(".seg-value").forEach(inp=>inp.addEventListener("input",()=>{
    const arr=segGet(el); const i=+inp.dataset.i;
    if(arr[i]){ arr[i].value=Math.max(0,Number(inp.value)||0); refresh(); updateSegPct(el); }
  }));
  // sub-caption
  $$(".seg-sub").forEach(inp=>inp.addEventListener("input",()=>{
    const arr=segGet(el); const i=+inp.dataset.i; if(arr[i]){ arr[i].sub=inp.value; refresh(); }
  }));
  // remove
  $$(".seg-del").forEach(btn=>btn.addEventListener("click",()=>{
    const arr=segGet(el); const i=+btn.dataset.i;
    if(arr.length>1){ arr.splice(i,1); rerender(); }
  }));
  // add
  const add=$("#f-seg-add");
  add&&add.addEventListener("click",()=>{
    const arr=segGet(el);
    const pal=["#e8503a","#f5a623","#5a9e48","#5bb0cf","#a8328c","#3a2f6f","#2f4fb0","#1f9e8a"];
    const row={label:meta.hasValue?"10%":String(arr.length+1).padStart(2,"0"),color:pal[arr.length%pal.length]};
    if(meta.hasValue) row.value=10;
    if(meta.hasSub) row.sub="Lorem ipsum";
    arr.push(row); rerender();
  });
}

/* live-update the little % badges next to each row as values change */
function updateSegPct(el){
  const meta=segObjectKind(el); if(!meta||!meta.hasValue) return;
  const arr=segGet(el); const total=arr.reduce((a,s)=>a+segValueOf(s),0)||1;
  $$(".seg-row").forEach(row=>{
    const i=+row.dataset.i; const span=row.querySelector(".seg-pct");
    if(span&&arr[i]) span.textContent=Math.round(segValueOf(arr[i])/total*100)+"%";
  });
}

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

/* ── Animation magic: apply cinematic stagger to all elements ─────── */
const ANIM_PRESETS = [
  {key:"cinematic",  label:"✦ Cinematic",   hint:"Rise + stagger 0.15s each",    anim:"rise",   step:0.15},
  {key:"cascade",    label:"↓ Cascade",      hint:"Drop down, stagger 0.12s each", anim:"drop",   step:0.12},
  {key:"reveal",     label:"▶ Reveal",       hint:"Wipe reveal, stagger 0.18s",   anim:"reveal", step:0.18},
  {key:"zoom_all",   label:"⊕ Zoom burst",  hint:"Zoom in, stagger 0.1s each",   anim:"zoom",   step:0.10},
  {key:"fade_all",   label:"◌ Soft fade",   hint:"All fade in together",          anim:"fade",   step:0},
  {key:"pop_all",    label:"✦ Pop",          hint:"Pop, stagger 0.1s each",        anim:"pop",    step:0.10},
  {key:"none_all",   label:"✕ No animation",hint:"Remove all animations",         anim:"none",   step:0},
];
function applyAnimPreset(preset){
  const s=curSlide();if(!s||!s.els.length)return;
  s.els.forEach((el,i)=>{
    el.anim=preset.anim;
    el.animDelay=parseFloat((preset.step>0?i*preset.step:0).toFixed(2));
  });
  renderCanvas();renderInspector();markDirty();pushHistory();
  toast(preset.label+" applied to "+s.els.length+" elements");
}

/* animate tab */
const ANIM_ICONS = {
  none:   `<svg viewBox="0 0 28 28" width="26" height="26"><circle cx="14" cy="14" r="10" fill="none" stroke="currentColor" stroke-width="2"/><line x1="8" y1="8" x2="20" y2="20" stroke="currentColor" stroke-width="2"/></svg>`,
  fade:   `<svg viewBox="0 0 28 28" width="26" height="26"><circle cx="14" cy="14" r="9" fill="currentColor" opacity="0.22"/><circle cx="14" cy="14" r="9" fill="none" stroke="currentColor" stroke-width="2" opacity="0.7"/><text x="14" y="18" text-anchor="middle" font-size="8" fill="currentColor">abc</text></svg>`,
  rise:   `<svg viewBox="0 0 28 28" width="26" height="26"><rect x="6" y="14" width="16" height="9" rx="2" fill="currentColor" opacity="0.18"/><rect x="6" y="8" width="16" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><polyline points="14,16 14,5 11,9 14,5 17,9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  drop:   `<svg viewBox="0 0 28 28" width="26" height="26"><rect x="6" y="6" width="16" height="9" rx="2" fill="currentColor" opacity="0.18"/><rect x="6" y="13" width="16" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><polyline points="14,12 14,22 11,18 14,22 17,18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  left:   `<svg viewBox="0 0 28 28" width="26" height="26"><rect x="14" y="7" width="9" height="14" rx="2" fill="currentColor" opacity="0.18"/><rect x="5" y="7" width="9" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><polyline points="11,14 1,14 5,11 1,14 5,17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  right:  `<svg viewBox="0 0 28 28" width="26" height="26"><rect x="5" y="7" width="9" height="14" rx="2" fill="currentColor" opacity="0.18"/><rect x="14" y="7" width="9" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><polyline points="17,14 27,14 23,11 27,14 23,17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`,
  zoom:   `<svg viewBox="0 0 28 28" width="26" height="26"><circle cx="14" cy="14" r="5" fill="currentColor" opacity="0.18"/><circle cx="14" cy="14" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="14" y1="5" x2="14" y2="23" stroke="currentColor" stroke-width="1.2" opacity="0.45"/><line x1="5" y1="14" x2="23" y2="14" stroke="currentColor" stroke-width="1.2" opacity="0.45"/></svg>`,
  pop:    `<svg viewBox="0 0 28 28" width="26" height="26"><circle cx="14" cy="14" r="5" fill="currentColor"/><line x1="14" y1="2" x2="14" y2="6" stroke="currentColor" stroke-width="2"/><line x1="14" y1="22" x2="14" y2="26" stroke="currentColor" stroke-width="2"/><line x1="2" y1="14" x2="6" y2="14" stroke="currentColor" stroke-width="2"/><line x1="22" y1="14" x2="26" y2="14" stroke="currentColor" stroke-width="2"/><line x1="5" y1="5" x2="8" y2="8" stroke="currentColor" stroke-width="2"/><line x1="20" y1="20" x2="23" y2="23" stroke="currentColor" stroke-width="2"/><line x1="23" y1="5" x2="20" y2="8" stroke="currentColor" stroke-width="2"/><line x1="5" y1="23" x2="8" y2="20" stroke="currentColor" stroke-width="2"/></svg>`,
  blur:   `<svg viewBox="0 0 28 28" width="26" height="26"><text x="14" y="19" text-anchor="middle" font-size="14" fill="currentColor" opacity="0.25" filter="url(#b)">A</text><text x="14" y="19" text-anchor="middle" font-size="14" fill="currentColor">A</text><defs><filter id="b"><feGaussianBlur stdDeviation="2"/></filter></defs></svg>`,
  reveal: `<svg viewBox="0 0 28 28" width="26" height="26"><rect x="5" y="7" width="18" height="14" rx="2" fill="currentColor" opacity="0.12"/><rect x="5" y="7" width="9" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="14" y1="7" x2="14" y2="21" stroke="currentColor" stroke-width="2"/></svg>`,
  /* ── v31 advanced entrances ── */
  revealUp:  `<svg viewBox="0 0 28 28" width="26" height="26"><rect x="5" y="7" width="18" height="14" rx="2" fill="currentColor" opacity="0.12"/><rect x="5" y="14" width="18" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="5" y1="14" x2="23" y2="14" stroke="currentColor" stroke-width="2"/></svg>`,
  bounce:    `<svg viewBox="0 0 28 28" width="26" height="26"><circle cx="9" cy="8" r="4" fill="currentColor" opacity="0.2"/><circle cx="14" cy="16" r="4" fill="currentColor" opacity="0.45"/><circle cx="19" cy="21" r="4" fill="currentColor"/><path d="M6 25 h18" stroke="currentColor" stroke-width="1.6"/></svg>`,
  elastic:   `<svg viewBox="0 0 28 28" width="26" height="26"><path d="M4 14 q3 -8 6 0 t6 0 t6 0" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="22" cy="14" r="3.4" fill="currentColor"/></svg>`,
  flipx:     `<svg viewBox="0 0 28 28" width="26" height="26"><path d="M14 4 v20" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 2"/><path d="M11 7 L4 10 v9 l7 3 Z" fill="currentColor" opacity="0.25"/><path d="M17 7 L24 10 v9 l-7 3 Z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`,
  flipy:     `<svg viewBox="0 0 28 28" width="26" height="26"><path d="M4 14 h20" stroke="currentColor" stroke-width="1.4" stroke-dasharray="2 2"/><path d="M7 11 L10 4 h9 l3 7 Z" fill="currentColor" opacity="0.25"/><path d="M7 17 L10 24 h9 l3 -7 Z" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`,
  spin:      `<svg viewBox="0 0 28 28" width="26" height="26"><path d="M14 5 a9 9 0 1 1 -9 9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polygon points="14,1 14,9 9,5" fill="currentColor"/></svg>`,
  skew:      `<svg viewBox="0 0 28 28" width="26" height="26"><path d="M9 7 h14 l-4 14 H5 Z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 7 h8 l-4 14 H1 Z" fill="currentColor" opacity="0.18" transform="translate(1,0)"/></svg>`,
  blurzoom:  `<svg viewBox="0 0 28 28" width="26" height="26"><circle cx="14" cy="14" r="10" fill="currentColor" opacity="0.12"/><circle cx="14" cy="14" r="6.5" fill="currentColor" opacity="0.3"/><circle cx="14" cy="14" r="3.5" fill="currentColor"/></svg>`,
  typewriter:`<svg viewBox="0 0 28 28" width="26" height="26"><text x="4" y="18" font-size="11" font-family="monospace" fill="currentColor">ab</text><rect x="19" y="8" width="2.4" height="12" fill="currentColor"><animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></rect></svg>`,
  float:     `<svg viewBox="0 0 28 28" width="26" height="26"><ellipse cx="14" cy="22" rx="8" ry="2.4" fill="currentColor" opacity="0.2"/><rect x="8" y="6" width="12" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M14 20 v-2" stroke="currentColor" stroke-width="1.6"/></svg>`,
};
function animatePanel(el){
  const animCards=Object.entries(ANIMS).map(([k,v])=>`
    <button class="anim-card ${el.anim===k?"active":""}" data-anim="${k}" title="${v.label}">
      <span class="anim-card-icon">${ANIM_ICONS[k]||""}</span>
      <span class="anim-card-name">${v.label}</span>
    </button>`).join("");

  const presetBtns=ANIM_PRESETS.map(p=>`
    <button class="anim-preset-btn" data-preset="${p.key}" title="${p.hint}">${p.label}</button>`).join("");

  return `
    <div class="group">
      <span class="glabel">Entrance — this element</span>
      <div class="anim-card-grid">${animCards}</div>
    </div>
    <div class="group">
      ${field(`Delay ${(el.animDelay||0).toFixed(1)}s`,`<input type="range" id="f-delay" min="0" max="2" step="0.1" value="${el.animDelay||0}">`)}
      ${field(`Speed ${(Number(el.animDur)>0?Number(el.animDur).toFixed(1)+"s":"auto")}`,`<input type="range" id="f-animdur" min="0" max="3" step="0.1" value="${Number(el.animDur)||0}">`)}
      <div class="insp-empty" style="padding-top:.15rem">Speed 0 = automatic (each entrance has its own tuned duration).</div>
    </div>
    <div class="group">
      <span class="glabel">Reveal</span>
      ${field("When this appears on the projector",`<div class="seg" id="f-revealon">
        <button data-rv="entry" class="${(el.revealOn||"entry")!=="cue"?"active":""}">With the slide</button>
        <button data-rv="cue" class="${el.revealOn==="cue"?"active":""}">📱 On my cue</button></div>`)}
      <div class="insp-empty" style="padding-top:.2rem">On my cue holds this element back on the big screen until you tap it in on the phone controller. It then enters with the animation above. In the editor it stays visible, outlined in orange.</div>
    </div>
    <div class="group">
      <button class="tbtn" id="f-preview" style="width:100%;justify-content:center;margin-bottom:.5rem">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 4 14 8-14 8z"/></svg>
        Preview animations
      </button>
    </div>
    <div class="group">
      <span class="glabel">Apply to all elements on this slide</span>
      <div class="anim-preset-row">${presetBtns}</div>
      <div class="insp-empty" style="padding-top:.35rem">Stagger creates cinematic reveals — each element enters after the previous one.</div>
    </div>`;
}
function bindAnimatePanel(el){
  $$(".anim-card[data-anim]",inspBody).forEach(c=>c.addEventListener("click",()=>{
    el.anim=c.dataset.anim;
    $$(".anim-card[data-anim]",inspBody).forEach(x=>x.classList.remove("active"));
    c.classList.add("active");
    markDirty();
  }));
  bindRange("f-delay",v=>{el.animDelay=v;markDirty();},v=>v.toFixed(1)+"s","Delay");
  bindRange("f-animdur",v=>{el.animDur=v>0?v:0;markDirty();},v=>v>0?v.toFixed(1)+"s":"auto","Speed");
  seg("f-revealon","rv",v=>{el.revealOn=v;renderCanvas();markDirty();});
  $("#f-preview")&&$("#f-preview").addEventListener("click",previewAnimations);
  $$(".anim-preset-btn[data-preset]",inspBody).forEach(b=>b.addEventListener("click",()=>{
    const p=ANIM_PRESETS.find(x=>x.key===b.dataset.preset);
    if(p)applyAnimPreset(p);
  }));
}
function previewAnimations(){const s=curSlide();
  // Preview plays the slide as authored, cue-held elements included —
  // otherwise they would blink out for 1.4s and look broken. Their
  // timing on the night comes from your taps, not from here.
  paintSlide(canvas,s,{live:true,revealAll:true});
  // restore editor interactivity after the preview plays
  setTimeout(()=>renderCanvas(),1400);}

/* slide tab */
function slidePanel(){
  const s=curSlide();
  let bgs='<div class="bg-grid">';
  BACKGROUNDS.forEach((b,i)=>{const style=`background:${b.css};${b.size?`background-size:${b.size};`:""}`;
    bgs+=`<div class="bg-cell ${s.bg===b.css?"":""}" style="${style}" data-bgi="${i}"><span class="bgn">${b.name}</span></div>`;});
  bgs+="</div>";
  const curFx=s.bgFx||"none";
  let fx=(BG_FX||[]).map(f=>`<button class="chip bgfx-chip ${curFx===f.key?"active":""}" data-bgfx="${f.key}" title="${f.hint||""}">${f.label}</button>`).join("");
  let trans=Object.entries(TRANSITIONS).map(([k,v])=>`<button class="chip ${s.transition===k?"active":""}" data-trans="${k}">${v}</button>`).join("");
  // ── v51: custom background builder ───────────────────────────────
  // paintSlide() assigns slide.bg straight to container.style.background,
  // so ANY valid CSS background value works — solid, multi-stop gradient,
  // image URL, or a comma-separated stack. This UI just composes that
  // string; nothing in the renderer needed to change.
  const cur = s.bg || "";
  const c1 = (s.bgC1 || pickHex(cur, 0) || "#0f172a");
  const c2 = (s.bgC2 || pickHex(cur, 1) || "#38bdf8");
  const c3 = (s.bgC3 || pickHex(cur, 2) || "#8b5cf6");
  const ang = Number.isFinite(+s.bgAngle) ? +s.bgAngle : 135;
  const mode = s.bgMode || "preset";
  const useC3 = !!s.bgUse3;
  const custom = `
    <div class="bg-custom">
      <div class="chiprow bg-mode-row">
        <button class="chip bgmode-chip ${mode==="solid"?"active":""}" data-bgmode="solid">Solid</button>
        <button class="chip bgmode-chip ${mode==="linear"?"active":""}" data-bgmode="linear">Gradient</button>
        <button class="chip bgmode-chip ${mode==="radial"?"active":""}" data-bgmode="radial">Radial</button>
        <button class="chip bgmode-chip ${mode==="css"?"active":""}" data-bgmode="css">Custom CSS</button>
      </div>
      <div class="bg-swatches">
        <label class="bg-sw"><input type="color" id="bg-c1" value="${c1}"><span>Color 1</span></label>
        <label class="bg-sw bg-c2-wrap"><input type="color" id="bg-c2" value="${c2}"><span>Color 2</span></label>
        <label class="bg-sw bg-c3-wrap"><input type="color" id="bg-c3" value="${c3}"><span>Color 3</span></label>
        <label class="bg-sw bg-c3-toggle"><input type="checkbox" id="bg-use3" ${useC3?"checked":""}><span>3rd color</span></label>
      </div>
      <div class="bg-angle-wrap">
        <label class="bg-angle">Angle <b id="bg-angle-val">${ang}&deg;</b>
          <input type="range" id="bg-angle" min="0" max="360" step="1" value="${ang}">
        </label>
      </div>
      <div class="bg-css-wrap">
        <textarea id="bg-css" rows="3" spellcheck="false"
          placeholder="Any CSS background, e.g. linear-gradient(135deg,#0f172a,#38bdf8) or url('https://example.com/photo.jpg') center/cover">${escapeTA(cur)}</textarea>
      </div>
      <div class="bg-live-preview" id="bg-live-preview" style="background:${cur};${s.bgSize?`background-size:${s.bgSize};`:""}"></div>
      <div class="chiprow bg-apply-row">
        <button class="chip" id="bg-apply-all" title="Use this background on every slide in the deck">Apply to all slides</button>
        <button class="chip" id="bg-copy" title="Copy this background CSS to the clipboard">Copy CSS</button>
      </div>
    </div>`;

  return `<div class="group"><span class="glabel">Slide background</span>${bgs}${custom}</div>
    <div class="group"><span class="glabel">Moving background</span><div class="chiprow bgfx-row">${fx}</div></div>
    <div class="group"><span class="glabel">Presenter notes</span>${field("Notes for phone controller",`<textarea id="s-notes" rows="6" placeholder="Private notes visible on presenter phone only">${escapeTA(s.notes||"")}</textarea>`)}</div>
    <div class="group"><span class="glabel">Transition in</span><div class="chiprow">${trans}</div></div>
    <div class="group">
      <button class="tbtn" id="s-dup" style="width:100%;justify-content:center;margin-bottom:.5rem">Duplicate slide</button>
      <button class="del-el" id="s-del">Delete this slide</button>
    </div>`;
}
/* v51 — custom background helpers.
   pickHex pulls the Nth #rrggbb / #rgb out of an existing background string
   so switching to the custom builder starts from the colours already on the
   slide instead of resetting to defaults. */
function pickHex(css, n){
  const m = String(css||"").match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi);
  if(!m || !m[n])return null;
  let h = m[n];
  if(h.length === 4) h = "#" + h[1]+h[1] + h[2]+h[2] + h[3]+h[3];
  return h.toLowerCase();
}

/* v51 — the custom-builder state (mode, colours, angle) rides alongside
   bg/bgSize so reopening a deck restores the picker exactly as it was
   left. These keys are additive; older decks without them simply fall
   back to "preset". */
function bgMeta(s){
  return {
    bgMode : s.bgMode  || "preset",
    bgC1   : s.bgC1    || null,
    bgC2   : s.bgC2    || null,
    bgC3   : s.bgC3    || null,
    bgAngle: Number.isFinite(+s.bgAngle) ? +s.bgAngle : null,
    bgUse3 : !!s.bgUse3,
  };
}

/* Compose the CSS background string from the builder's current state. */
function buildBgCss(s){
  const c1 = s.bgC1 || "#0f172a";
  const c2 = s.bgC2 || "#38bdf8";
  const c3 = s.bgC3 || "#8b5cf6";
  const ang = Number.isFinite(+s.bgAngle) ? +s.bgAngle : 135;
  const stops = s.bgUse3 ? `${c1},${c2} 50%,${c3}` : `${c1},${c2}`;
  switch(s.bgMode){
    case "solid":  return c1;
    case "linear": return `linear-gradient(${ang}deg,${stops})`;
    case "radial": return `radial-gradient(80% 90% at 50% 20%,${stops})`;
    default:       return s.bg || c1;   // "css" mode — the textarea is source of truth
  }
}

function applyCustomBg(s, {repaint=true}={}){
  if(s.bgMode && s.bgMode !== "css" && s.bgMode !== "preset"){
    s.bg = buildBgCss(s);
    s.bgSize = null;              // builder output never needs a background-size
  }
  const prev = $("#bg-live-preview");
  if(prev){
    prev.style.background = s.bg || "";
    prev.style.backgroundSize = s.bgSize || "";
  }
  const ta = $("#bg-css");
  if(ta && document.activeElement !== ta) ta.value = s.bg || "";
  if(repaint){ renderAll(); markDirty(); }
}

function bindSlidePanel(){
  const s=curSlide();
  $$(".bg-cell[data-bgi]",inspBody).forEach(c=>c.addEventListener("click",()=>{
    const b=BACKGROUNDS[Number(c.dataset.bgi)];s.bg=b.css;s.bgSize=b.size||null;
    s.bgMode="preset";applyCustomBg(s,{repaint:false});renderAll();markDirty();}));

  // ── custom background builder ────────────────────────────────────
  $$(".bgmode-chip[data-bgmode]",inspBody).forEach(c=>c.addEventListener("click",()=>{
    s.bgMode=c.dataset.bgmode;
    $$(".bgmode-chip[data-bgmode]",inspBody).forEach(x=>x.classList.remove("active"));
    c.classList.add("active");
    const wrap=$(".bg-custom",inspBody);
    if(wrap)wrap.dataset.mode=s.bgMode;
    applyCustomBg(s);
  }));
  const wrap0=$(".bg-custom",inspBody);
  if(wrap0)wrap0.dataset.mode=s.bgMode||"preset";

  [["#bg-c1","bgC1"],["#bg-c2","bgC2"],["#bg-c3","bgC3"]].forEach(([sel,key])=>{
    const el=$(sel);
    el&&el.addEventListener("input",()=>{
      s[key]=el.value;
      if(!s.bgMode||s.bgMode==="preset"||s.bgMode==="css")s.bgMode="linear";
      applyCustomBg(s);
    });
  });
  const use3=$("#bg-use3");
  use3&&use3.addEventListener("change",()=>{s.bgUse3=use3.checked;applyCustomBg(s);});

  const angle=$("#bg-angle"), angleVal=$("#bg-angle-val");
  angle&&angle.addEventListener("input",()=>{
    s.bgAngle=Number(angle.value)||0;
    if(angleVal)angleVal.textContent=s.bgAngle+"\u00b0";
    if(!s.bgMode||s.bgMode==="preset"||s.bgMode==="css")s.bgMode="linear";
    applyCustomBg(s);
  });

  // Raw CSS — accepts anything paintSlide can hand to style.background.
  const bgcss=$("#bg-css");
  bgcss&&bgcss.addEventListener("input",()=>{
    s.bgMode="css";
    s.bg=bgcss.value.trim();
    s.bgSize=null;
    const wrap=$(".bg-custom",inspBody);
    if(wrap)wrap.dataset.mode="css";
    $$(".bgmode-chip[data-bgmode]",inspBody).forEach(x=>
      x.classList.toggle("active", x.dataset.bgmode==="css"));
    applyCustomBg(s);
  });

  $("#bg-apply-all")&&$("#bg-apply-all").addEventListener("click",()=>{
    const css=s.bg, size=s.bgSize||null, fx=s.bgFx||"none";
    Deck.slides.forEach(sl=>{sl.bg=css;sl.bgSize=size;sl.bgFx=fx;
      sl.bgMode=s.bgMode;sl.bgC1=s.bgC1;sl.bgC2=s.bgC2;sl.bgC3=s.bgC3;
      sl.bgAngle=s.bgAngle;sl.bgUse3=s.bgUse3;});
    renderAll();markDirty();
  });
  $("#bg-copy")&&$("#bg-copy").addEventListener("click",()=>{
    try{navigator.clipboard.writeText(s.bg||"");}catch(e){}
  });
  $$(".bgfx-chip[data-bgfx]",inspBody).forEach(c=>c.addEventListener("click",()=>{
    s.bgFx=c.dataset.bgfx;
    $$(".bgfx-chip[data-bgfx]",inspBody).forEach(x=>x.classList.remove("active"));c.classList.add("active");
    renderAll();markDirty();}));
  const notes=$("#s-notes");notes&&notes.addEventListener("input",()=>{s.notes=notes.value;renderFilmstrip();updateNotesPanel();markDirty();});
  $$(".chip[data-trans]",inspBody).forEach(c=>c.addEventListener("click",()=>{
    s.transition=c.dataset.trans;$$(".chip[data-trans]",inspBody).forEach(x=>x.classList.remove("active"));c.classList.add("active");markDirty();}));
  $("#s-dup")&&$("#s-dup").addEventListener("click",()=>duplicateSlide(Deck.cur));
  $("#s-del")&&$("#s-del").addEventListener("click",()=>deleteSlide(Deck.cur));
}

/* presenter notes quick panel */
function updateNotesPanel(){
  const panel=$("#presenter-notes-panel"), box=$("#presenter-notes-box"), label=$("#presenter-notes-slide");
  if(!panel||!box) return;
  const s=curSlide();
  if(label) label.textContent = `Slide ${Deck.cur+1} / ${Deck.slides.length}`;
  if(document.activeElement!==box) box.value = (s&&s.notes)||"";
  const btn=$("#btn-notes");
  const rail=$("#rail-notes");
  const hasNote=!!((s&&s.notes)||"").trim();
  btn&&btn.classList.toggle("has-notes",hasNote);
  rail&&rail.classList.toggle("has-notes",hasNote);
}
function openNotesPanel(){
  const panel=$("#presenter-notes-panel"), box=$("#presenter-notes-box");
  if(!panel||!box) return;
  panel.hidden=false;
  updateNotesPanel();
  setTimeout(()=>box.focus(),40);
}
function closeNotesPanel(){const panel=$("#presenter-notes-panel"); if(panel) panel.hidden=true;}
function toggleNotesPanel(){const panel=$("#presenter-notes-panel"); if(!panel) return; panel.hidden?openNotesPanel():closeNotesPanel();}
function bindNotesPanel(){
  const box=$("#presenter-notes-box");
  $("#btn-notes")?.addEventListener("click",toggleNotesPanel);
  $("#rail-notes")?.addEventListener("click",toggleNotesPanel);
  $("#presenter-notes-close")?.addEventListener("click",closeNotesPanel);
  box&&box.addEventListener("input",()=>{const s=curSlide(); if(!s) return; s.notes=box.value; const slideNotes=$("#s-notes"); if(slideNotes&&document.activeElement!==slideNotes) slideNotes.value=box.value; updateNotesPanel(); markDirty();});
  document.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="m"){e.preventDefault();toggleNotesPanel();}});
}

/* ════════════════════════════════════════════════════════════════════
   DRAWERS (templates / backgrounds)
   ════════════════════════════════════════════════════════════════════ */
function buildTplGallery(){
  const g=$("#tpl-grid");if(!g)return;g.innerHTML="";
  TEMPLATES.forEach(tpl=>{
    const card=document.createElement("div");card.className="tpl";
    card.innerHTML=`<span class="tname">${tpl.name}</span>`;
    const mini=document.createElement("div");mini.className="mini";mini.style.width=W+"px";mini.style.height=H+"px";
    const built=tpl.build();paintSlide(mini,Object.assign(newSlide(),{bg:built.bg,bgSize:built.bgSize,bgFx:built.bgFx||"none",els:built.els}),{live:false});
    requestAnimationFrame(()=>{mini.style.transform=`scale(${card.clientWidth/W})`;});
    card.appendChild(mini);
    card.addEventListener("click",()=>applyTemplate(tpl));
    g.appendChild(card);
  });
}
function buildBgGallery(){
  const g=$("#bg-grid");if(!g)return;g.innerHTML="";
  BACKGROUNDS.forEach((b,i)=>{const cell=document.createElement("div");cell.className="bg-cell";
    cell.style.background=b.css;if(b.size)cell.style.backgroundSize=b.size;
    cell.innerHTML=`<span class="bgn">${b.name}</span>`;
    cell.addEventListener("click",()=>{const s=curSlide();s.bg=b.css;s.bgSize=b.size||null;renderAll();markDirty();});
    g.appendChild(cell);});
}
function buildObjGallery(){
  const g=$("#obj-grid");if(!g)return;g.innerHTML="";
  (OBJECTS||[]).forEach(o=>{
    const card=document.createElement("button");card.type="button";card.className="obj-card";
    card.style.setProperty("--accent",o.accent||"#4cc9f0");
    card.innerHTML=`<span class="oi">${o.icon}</span><div class="on">${o.label}</div><div class="oh">${o.help||""}</div>`;
    card.addEventListener("click",()=>addObject(o.kind));
    g.appendChild(card);
  });
}

function buildShapeGallery(){
  const g=$("#shape-grid");if(!g)return;g.innerHTML="";
  (SHAPES||[]).forEach(s=>{
    const card=document.createElement("button");card.type="button";card.className="shape-card";
    card.style.setProperty("--accent",s.accent||"#e8482b");
    card.innerHTML=`<svg viewBox="0 0 100 100" preserveAspectRatio="none"><path d="${s.d}"></path></svg><span>${s.label}</span>`;
    card.addEventListener("click",()=>addCreativeShape(s.kind));
    g.appendChild(card);
  });
}

function openDrawer(which){closeDrawers();const d=$("#drawer-"+which);if(d)d.classList.add("open");
  $("#rail-tpl")?.classList.toggle("active",which==="tpl");$("#rail-bg")?.classList.toggle("active",which==="bg");$("#rail-obj")?.classList.toggle("active",which==="obj");$("#rail-shape")?.classList.toggle("active",which==="shape");}
function closeDrawers(){$$(".drawer").forEach(d=>d.classList.remove("open"));
  $("#rail-tpl")?.classList.remove("active");$("#rail-bg")?.classList.remove("active");$("#rail-obj")?.classList.remove("active");$("#rail-shape")?.classList.remove("active");}


/* ════════════════════════════════════════════════════════════════════
   POWERPOINT IMPORT
   ════════════════════════════════════════════════════════════════════ */
function applyImportedDeckPayload(deck){
  if(!deck || !Array.isArray(deck.slides))return false;
  historyLocked=true;
  Deck.title=deck.title||Deck.title||"Imported PowerPoint";
  Deck.code=deck.code||Deck.code;
  Deck.slides=deck.slides.map(s=>Object.assign(newSlide(),{
    id:String(s.id||uid()),
    bg:s.bg||"#f6f1e7",
    bgSize:s.bgSize||null,
    bgFx:s.bgFx||"none",
    ...bgMeta(s),
    transition:s.transition||"fade",
    notes:s.notes||"",
    els:(s.els||[]).map(e=>Object.assign({},e)),
  }));
  if(!Deck.slides.length)Deck.slides=[newSlide()];
  Deck.cur=0;
  Deck.sel=null;
  multiSel.clear();
  const title=$("#deck-title"); if(title) title.value=Deck.title;
  renderAll();
  resetHistory();
  historyLocked=false;
  updateSaveState("saved");
  broadcastDeckSaved();
  return true;
}
async function importPowerPointFile(file){
  if(!file)return;
  if(!SRV.powerpointImportUrl){toast("PowerPoint import URL is missing");return;}
  const name=String(file.name||"").toLowerCase();
  if(!/\.(pptx?|ppsx?)$/.test(name)){
    toast("Choose a .ppt or .pptx file");
    return;
  }
  const ok=confirm("Import this PowerPoint into the current Hanns deck? This will replace the current slides in this deck.");
  if(!ok)return;
  const oldState=$("#btn-import-powerpoint")?.textContent;
  updateSaveState("saving");
  toast("Importing PowerPoint…");
  const fd=new FormData();
  fd.append("powerpoint",file,file.name||"presentation.pptx");
  try{
    const r=await fetch(SRV.powerpointImportUrl,{method:"POST",headers:{"X-CSRFToken":SRV.csrftoken||""},body:fd});
    let data=null;try{data=await r.json();}catch(_){ }
    if(!r.ok || !data || !data.ok)throw new Error((data&&data.error)||("PowerPoint import failed "+r.status));
    if(applyImportedDeckPayload(data.deck)){
      const count=data.slide_count || (data.deck&&data.deck.slides?data.deck.slides.length:0);
      toast(`PowerPoint imported · ${count} slide${count===1?"":"s"}`);
      if(Array.isArray(data.warnings)&&data.warnings.length)console.warn("Hanns PowerPoint import warnings",data.warnings);
    }
  }catch(err){
    console.error(err);
    updateSaveState("error");
    toast(err&&err.message?err.message:"Could not import PowerPoint");
  }finally{
    const input=$("#ppt-import-input"); if(input)input.value="";
  }
}

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
async function exportPowerPoint(){
  // The .pptx is built server-side from the saved deck (real editable charts,
  // shapes, notes), so flush any pending edits first, then trigger the
  // download by navigating to the export endpoint.
  const url = (window.__HANNS__ && window.__HANNS__.powerpointExportUrl) || "";
  if(!url){ toast("PowerPoint export URL is missing"); return; }
  toast("Preparing PowerPoint…");
  try{ await saveDeck(true); }catch(_){ /* still try to export last saved state */ }
  // A hidden iframe download keeps the editor open (no full navigation away).
  let f=document.getElementById("hanns-pptx-dl");
  if(!f){ f=document.createElement("iframe"); f.id="hanns-pptx-dl"; f.style.display="none"; document.body.appendChild(f); }
  f.src=url;
  toast("Exported PowerPoint");
}

/* ── AI Slide Generator ───────────────────────────────────────────── */
function ensureAiSlideModal(){
  let m=document.getElementById("hanns-ai-modal");
  if(m)return m;
  m=document.createElement("div");
  m.id="hanns-ai-modal";
  m.className="hanns-geo-modal";
  m.innerHTML=`<div class="hanns-geo-card hanns-ai-card" role="dialog" aria-modal="true" aria-labelledby="hanns-ai-title">
    <button class="hanns-geo-close" id="hanns-ai-close" aria-label="Close">✕</button>
    <h3 id="hanns-ai-title">✦ AI slide designer</h3>
    <p>Describe what you want and Hanns AI will build you a complete, beautifully animated slide in seconds.</p>
    <div class="ai-topic-chips">
      <button class="ai-topic-chip" data-topic="Show our Q3 results with a big number, chart and bullet points">📊 Results</button>
      <button class="ai-topic-chip" data-topic="Create a bold title slide for a workshop on food security">🌾 Workshop title</button>
      <button class="ai-topic-chip" data-topic="Make a two-column comparison of before and after">↔ Before / After</button>
      <button class="ai-topic-chip" data-topic="A dramatic quote slide with a powerful statement">💬 Quote slide</button>
      <button class="ai-topic-chip" data-topic="Project update with progress percentage and key milestones">📋 Project update</button>
      <button class="ai-topic-chip" data-topic="Community health impact with stats and people visual">❤️ Health impact</button>
    </div>
    <textarea id="hanns-ai-prompt" rows="4" placeholder="e.g. &quot;A dramatic title slide for our annual report with the headline: The Future of Agriculture. Dark background, bold serif, animated rise effect.&quot;"></textarea>
    <div style="display:flex;gap:.5rem;margin:.6rem 0;flex-wrap:wrap;align-items:center">
      <label style="font-size:.76rem;color:var(--fog-2);flex:1;min-width:100px">Add to deck as:
        <select id="hanns-ai-mode" style="margin-left:.3rem;background:var(--ink-3);border:1px solid var(--line);color:var(--cream);border-radius:7px;padding:.2rem .4rem;font-size:.78rem">
          <option value="replace">Replace current slide</option>
          <option value="new" selected>Add new slide</option>
        </select>
      </label>
    </div>
    <div class="hanns-geo-actions" style="justify-content:flex-end">
      <button class="chip" id="hanns-ai-cancel">Cancel</button>
      <button id="hanns-ai-go" style="background:var(--signal);border:1px solid var(--signal);border-radius:12px;padding:.62rem 1.1rem;font-weight:900;color:#fff;cursor:pointer;font-size:.88rem">
        ✦ Design this slide
      </button>
    </div>
    <div id="hanns-ai-status" style="display:none;padding:.6rem .8rem;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid var(--line);font-size:.82rem;color:var(--fog-2);margin-top:.4rem"></div>
  </div>`;
  document.body.appendChild(m);
  m.addEventListener("click",e=>{if(e.target===m)closeAiModal();});
  m.querySelector("#hanns-ai-close").addEventListener("click",closeAiModal);
  m.querySelector("#hanns-ai-cancel").addEventListener("click",closeAiModal);
  m.querySelectorAll(".ai-topic-chip").forEach(c=>c.addEventListener("click",()=>{
    m.querySelector("#hanns-ai-prompt").value=c.dataset.topic;
  }));
  m.querySelector("#hanns-ai-go").addEventListener("click",runAiSlideGen);
  return m;
}
function openAiSlideModal(){
  const m=ensureAiSlideModal();m.classList.add("on");
  setTimeout(()=>m.querySelector("#hanns-ai-prompt").focus(),60);
}
function closeAiModal(){
  const m=document.getElementById("hanns-ai-modal");
  if(m)m.classList.remove("on");
}
function setAiStatus(msg,err=false){
  const s=document.getElementById("hanns-ai-status");
  if(!s)return;
  if(!msg){s.style.display="none";s.textContent="";return;}
  s.style.display="block";s.textContent=msg;
  s.style.color=err?"var(--signal-2)":"var(--fog-2)";
}

async function runAiSlideGen(){
  const promptEl=document.getElementById("hanns-ai-prompt");
  const modeEl=document.getElementById("hanns-ai-mode");
  const goBtn=document.getElementById("hanns-ai-go");
  const prompt=(promptEl?.value||"").trim();
  if(!prompt){toast("Please describe your slide first");return;}

  goBtn.disabled=true;goBtn.textContent="Designing…";
  setAiStatus("🤖 AI is designing your slide…");

  // Build the system prompt that tells the AI exactly which element schema to use
  const systemPrompt=`You are Hanns AI, an expert presentation designer. You create JSON slide data for the Hanns editor.

The slide canvas is 960×540px. Return ONLY valid JSON (no markdown, no explanation) in this exact shape:
{
  "bg": "<css background>",
  "transition": "fade|slide|zoom|reveal|flip",
  "bgFx": "none|drift|gradient|stars|bokeh|waves|rays|pulse",
  "els": [
    {
      "id": "unique_id",
      "type": "text|rect|ellipse|line|image",
      "x": number, "y": number, "w": number, "h": number, "rot": 0,
      "anim": "fade|rise|drop|left|right|zoom|pop|blur|reveal|none",
      "animDelay": number (0–2, stagger by 0.15 for cinematic effect),
      ...type-specific fields
    }
  ]
}

Text element extra fields: text, font (use "Fraunces,serif" for headlines, "Archivo,sans-serif" for body), size (10–260), weight (300|400|500|600|700|800), italic (bool), color (#hex), align (left|center|right), lh (0.9–2), ls (letter-spacing px), fill ("none" or #hex background).

Rect/ellipse extra fields: fill (#hex), stroke (#hex or "none"), strokeW (0–20), radius (0–120 for rect).

Line extra fields: fill (#hex).

Design principles:
- Use dramatic editorial layouts with large display type (80–160px headlines)
- Layer shapes behind text for depth (semi-transparent fills with opacity in rgba)
- Stagger animations: animDelay 0, 0.15, 0.30, 0.45 etc for cinematic reveal
- Use bold, high-contrast colour combinations
- Prefer Fraunces serif for display text and Archivo for body
- Make the design feel like a magazine cover — editorial, confident, beautiful
- Common background patterns: use linear-gradient or radial-gradient CSS values
- Keep text within safe area: x > 60, y > 40, right edge < 900, bottom < 500
- Accent colour #e8482b (signal red), warm paper #f6f1e7, dark ink #16140f

Available bgFx values: none, drift, gradient, stars, bokeh, waves, rays, pulse, confetti, orbit.
Return ONLY the JSON object. No markdown fences.`;

  try{
    const resp=await fetch("https://api.anthropic.com/v1/messages",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        model:"claude-sonnet-4-20250514",
        max_tokens:1800,
        system:systemPrompt,
        messages:[{role:"user",content:`Design a professional, visually striking Hanns presentation slide for:\n\n${prompt}\n\nMake it editorial, cinematic, and beautiful. Return only the JSON.`}]
      })
    });
    const data=await resp.json();
    if(!resp.ok||!data||data.error){
      throw new Error((data&&data.error&&(data.error.message||JSON.stringify(data.error)))||"API error");
    }
    const raw=(data.content||[]).map(b=>b.text||"").join("").trim();
    // Strip possible markdown fences
    const clean=raw.replace(/^```[a-z]*\n?/,"").replace(/\n?```$/,"").trim();
    let slide;
    try{slide=JSON.parse(clean);}
    catch(pe){throw new Error("AI returned invalid JSON. Try a different prompt.");}

    // Ensure IDs are unique
    (slide.els||[]).forEach(el=>{el.id=uid();});

    const mode=modeEl?.value||"new";
    if(mode==="replace"){
      const s=curSlide();
      s.bg=slide.bg||s.bg;
      s.transition=slide.transition||s.transition;
      s.bgFx=slide.bgFx||"none";
      s.els=slide.els||[];
    } else {
      // new slide
      const s=Object.assign(newSlide(),{bg:slide.bg||"#f6f1e7",transition:slide.transition||"fade",bgFx:slide.bgFx||"none",els:slide.els||[]});
      Deck.slides.splice(Deck.cur+1,0,s);
      Deck.cur=Deck.cur+1;
    }
    pushHistory();renderAll();markDirty();
    closeAiModal();
    toast("✦ AI slide ready!");
  }catch(err){
    setAiStatus("Error: "+(err&&err.message?err.message:"Something went wrong. Try again."),true);
  }finally{
    if(goBtn){goBtn.disabled=false;goBtn.textContent="✦ Design this slide";}
  }
}
/* Server hooks injected by the Django editor template (editor.html):
   window.__HANNS__ = {deck:{…}, saveUrl, presentUrl, csrftoken}        */
const SRV = (window.__HANNS__||{});

function loadServerDeck(){
  const d = SRV.deck;
  if(d && Array.isArray(d.slides) && d.slides.length){
    Deck.title = d.title || "Untitled deck";
    Deck.code  = d.code  || Deck.code;
    Deck.slides = d.slides.map(s=>Object.assign(newSlide(),{
      id:String(s.id||uid()), bg:s.bg, bgSize:s.bgSize||null, bgFx:s.bgFx||"none",
      ...bgMeta(s),
      transition:s.transition||"fade", notes:s.notes||"",
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
let saveTimer=null, saving=false, queuedSave=false;
function deckPayload(){
  return {title:Deck.title, allow_reactions:true,
    slides:Deck.slides.map(s=>Object.assign(
      {bg:s.bg,bgSize:s.bgSize,bgFx:s.bgFx||"none",transition:s.transition,notes:s.notes||"",els:s.els},
      bgMeta(s)))};
}

function applyRemoteDeckPayload(payload, fromClient){
  if(!payload || fromClient===CLIENT_ID)return;
  if(applyingRemoteDeck)return;
  const active=document.activeElement;
  const tag=(active&&active.tagName||"").toLowerCase();
  const editing=active && (active.isContentEditable || tag==="input" || tag==="textarea" || tag==="select");
  if(editing){
    toast("A collaborator saved changes — finish typing to refresh");
    return;
  }
  applyingRemoteDeck=true;
  historyLocked=true;
  Deck.title=payload.title||Deck.title||"Untitled deck";
  Deck.slides=(payload.slides||[]).map(s=>Object.assign(newSlide(),{
    id:String(s.id||uid()),
    bg:s.bg||"#f6f1e7",
    bgSize:s.bgSize||null,
    bgFx:s.bgFx||"none",
    ...bgMeta(s),
    transition:s.transition||"fade",
    notes:s.notes||"",
    els:(s.els||[]).map(e=>Object.assign({},e)),
  }));
  if(!Deck.slides.length)Deck.slides=[newSlide()];
  Deck.cur=clamp(Deck.cur,0,Deck.slides.length-1);
  Deck.sel=null;
  const title=$("#deck-title"); if(title) title.value=Deck.title;
  renderAll();
  resetHistory();
  updateSaveState("saved");
  historyLocked=false;
  applyingRemoteDeck=false;
  toast("Updated by collaborator");
}
function initLiveEditing(){
  if(!SRV.editorWsUrl || !("WebSocket" in window))return;
  try{
    collabSocket=new WebSocket(SRV.editorWsUrl);
    collabSocket.addEventListener("open",()=>{
      collabSocket.send(JSON.stringify({type:"editor_hello",clientId:CLIENT_ID}));
    });
    collabSocket.addEventListener("message",(ev)=>{
      let msg;try{msg=JSON.parse(ev.data||"{}");}catch(_){return;}
      if(msg.type==="editor_ok"){collabReady=true;return;}
      if(msg.type==="editor_denied"){collabReady=false;return;}
      if(msg.type==="deck_updated")applyRemoteDeckPayload(msg.deck,msg.clientId);
    });
    collabSocket.addEventListener("close",()=>{collabReady=false;setTimeout(initLiveEditing,2500);});
  }catch(err){console.warn("live collaboration unavailable",err);}
}
function broadcastDeckSaved(){
  if(collabSocket && collabReady && collabSocket.readyState===WebSocket.OPEN){
    collabSocket.send(JSON.stringify({type:"editor_saved",clientId:CLIENT_ID,deck:deckPayload()}));
  }
}


async function normalizeEmbeddedImagesInDeck(){
  let changed=false;
  const walk=(els)=>{
    const tasks=[];
    (els||[]).forEach(el=>{
      if(!el||typeof el!=="object")return;
      if(el.type==="image" && el.src && /^(data:image\/|blob:)/i.test(String(el.src))){
        tasks.push((async()=>{
          const old=el.src;
          el.src=await persistImageSource(el.src,el.alt||"image.png");
          if(el.src!==old)changed=true;
        })());
      }
      if(Array.isArray(el.children))tasks.push(...walk(el.children));
    });
    return tasks;
  };
  const tasks=[];
  (Deck.slides||[]).forEach(slide=>tasks.push(...walk(slide.els||[])));
  if(tasks.length)await Promise.all(tasks);
  return changed;
}

async function saveDeck(silent){
  if(!SRV.saveUrl){updateSaveState("error");if(!silent)toast("Save URL is missing");return false;}
  if(saving){queuedSave=true;return false;}
  clearTimeout(saveTimer);saving=true;queuedSave=false;updateSaveState("saving");
  try{
    if(await normalizeEmbeddedImagesInDeck()){renderAll();}
    const r=await fetch(SRV.saveUrl,{method:"POST",
      headers:{"Content-Type":"application/json","X-CSRFToken":SRV.csrftoken||""},
      body:JSON.stringify(deckPayload())});
    if(!r.ok){
      let data=null;try{data=await r.json();}catch(_){ }
      throw new Error((data&&data.error)||("save failed "+r.status));
    }
    await r.json();
    updateSaveState("saved");
    broadcastDeckSaved();
    if(!silent)toast("Saved");
    return true;
  }catch(err){console.error(err);updateSaveState("error");if(!silent)toast(err&&err.message?err.message:"Couldn’t save — check your connection");return false;}
  finally{saving=false;if(queuedSave){queuedSave=false;saveDeck(true);}}
}
function scheduleSave(){if(applyingRemoteDeck)return;updateSaveState("dirty");clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveDeck(true),900);}
function updateSaveState(state){
  const b=$("#btn-save");if(!b)return;
  const map={saving:"Saving…",saved:"Saved",dirty:"Save",error:"Retry save"};
  b.dataset.state=state;const lbl=b.querySelector(".save-lbl");if(lbl)lbl.textContent=map[state]||"Save";
}


function setPanelToggles(){
  const work = $("#work");
  if(!work) return;
  const slidesBtn = $("#btn-toggle-slides");
  const inspBtn = $("#btn-toggle-inspector");
  const edgeBtn = $("#filmstrip-edge-toggle");

  function slidesVisible(){
    return !work.classList.contains("hide-filmstrip") && (work.classList.contains("show-filmstrip") || window.innerWidth > 760);
  }
  function setSlidesVisible(visible){
    work.classList.toggle("hide-filmstrip", !visible);
    work.classList.toggle("show-filmstrip", !!visible);
    if(slidesBtn){
      slidesBtn.classList.toggle("active", !!visible);
      slidesBtn.setAttribute("aria-pressed", visible ? "true" : "false");
    }
    if(edgeBtn){
      edgeBtn.setAttribute("aria-label", visible ? "Hide slide thumbnails" : "Show slide thumbnails");
      edgeBtn.setAttribute("title", visible ? "Hide slides" : "Show slides");
      const chev=edgeBtn.querySelector(".edge-chev");
      if(chev) chev.textContent = visible ? "‹" : "›";
    }
    setTimeout(applyZoom,80);
  }
  function setInspectorVisible(visible){
    work.classList.toggle("hide-inspector", !visible);
    if(inspBtn){
      inspBtn.classList.toggle("active", !!visible);
      inspBtn.setAttribute("aria-pressed", visible ? "true" : "false");
    }
    setTimeout(applyZoom,80);
  }
  function sync(){
    const shouldShow = slidesVisible();
    if(slidesBtn){
      slidesBtn.classList.toggle("active", shouldShow);
      slidesBtn.setAttribute("aria-pressed", shouldShow ? "true" : "false");
    }
    if(inspBtn){
      const iv = !work.classList.contains("hide-inspector");
      inspBtn.classList.toggle("active", iv);
      inspBtn.setAttribute("aria-pressed", iv ? "true" : "false");
    }
    if(edgeBtn){
      const chev=edgeBtn.querySelector(".edge-chev");
      if(chev) chev.textContent = shouldShow ? "‹" : "›";
      edgeBtn.setAttribute("aria-label", shouldShow ? "Hide slide thumbnails" : "Show slide thumbnails");
      edgeBtn.setAttribute("title", shouldShow ? "Hide slides" : "Show slides");
    }
  }

  slidesBtn?.addEventListener("click",(e)=>{e.preventDefault();setSlidesVisible(!slidesVisible());});
  edgeBtn?.addEventListener("click",(e)=>{e.preventDefault();setSlidesVisible(!slidesVisible());});
  inspBtn?.addEventListener("click",(e)=>{e.preventDefault();setInspectorVisible(work.classList.contains("hide-inspector"));});
  window.addEventListener("resize",()=>{sync();setTimeout(applyZoom,60);});
  sync();
}


function openInviteModal(){
  const m=$("#invite-modal");
  if(!m)return;
  $("#invite-result")&&( $("#invite-result").hidden=true );
  m.classList.add("on");
  setTimeout(()=>$("#invite-emails")?.focus(),60);
}
function closeInviteModal(){ $("#invite-modal")?.classList.remove("on"); }
async function sendInvite(){
  const box=$("#invite-emails"), out=$("#invite-result");
  const emails=(box&&box.value||"").trim();
  if(!emails){toast("Enter at least one email");return;}
  if(out){out.hidden=false;out.textContent="Sending…";out.classList.remove("error");}
  try{
    const r=await fetch(SRV.inviteUrl,{method:"POST",
      headers:{"Content-Type":"application/json","X-CSRFToken":SRV.csrftoken||""},
      body:JSON.stringify({emails})});
    const data=await r.json().catch(()=>({}));
    if(!r.ok || !data.ok)throw new Error(data.error||"Invite failed");
    if(out)out.textContent=data.message||"Invite sent.";
    toast("Invite sent");
    if(box)box.value="";
  }catch(err){
    console.error(err);
    if(out){out.textContent=err.message||"Invite failed";out.classList.add("error");}
    toast("Could not send invite");
  }
}

function init(){
  loadServerDeck();
  setPanelToggles();
  bindNotesPanel();
  if(slidesEl){
    slidesEl.addEventListener("wheel",e=>{ e.stopPropagation(); },{passive:true});
  }

  // rail add buttons
  $$(".rail .tool[data-add]").forEach(b=>b.addEventListener("click",()=>addElement(b.dataset.add)));
  $("#btn-bind")?.addEventListener("click",bindSelected);
  $("#btn-unbind")?.addEventListener("click",unbindSelected);
  $("#rail-tpl")?.addEventListener("click",()=>{const open=$("#drawer-tpl").classList.contains("open");open?closeDrawers():openDrawer("tpl");});
  $("#rail-bg")?.addEventListener("click",()=>{const open=$("#drawer-bg").classList.contains("open");open?closeDrawers():openDrawer("bg");});
  $("#rail-obj")?.addEventListener("click",()=>{const open=$("#drawer-obj").classList.contains("open");open?closeDrawers():openDrawer("obj");});
  $("#rail-shape")?.addEventListener("click",()=>{const open=$("#drawer-shape").classList.contains("open");open?closeDrawers():openDrawer("shape");});
  $$("[data-close-drawer]").forEach(b=>b.addEventListener("click",closeDrawers));
  $("#btn-templates")?.addEventListener("click",()=>openDrawer("tpl"));
  $("#btn-objects")?.addEventListener("click",()=>openDrawer("obj"));
  $("#btn-shapes")?.addEventListener("click",()=>openDrawer("shape"));
  $("#btn-invite")?.addEventListener("click",openInviteModal);
  $("#invite-send")?.addEventListener("click",sendInvite);
  $$("[data-close-invite]").forEach(b=>b.addEventListener("click",closeInviteModal));
  $("#invite-modal")?.addEventListener("click",e=>{if(e.target&&e.target.id==="invite-modal")closeInviteModal();});

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
    const ok = await saveDeck(false);
    if(ok && SRV.presentUrl) window.location.href=SRV.presentUrl;
  });

  // save (explicit) + Ctrl/Cmd-S
  $("#btn-save")&&$("#btn-save").addEventListener("click",()=>saveDeck(false));
  $("#btn-undo")&&$("#btn-undo").addEventListener("click",undo);
  $("#btn-redo")&&$("#btn-redo").addEventListener("click",redo);
  $("#btn-duplicate-slide")&&$("#btn-duplicate-slide").addEventListener("click",()=>duplicateSlide(Deck.cur));

  // PowerPoint import
  $("#btn-import-powerpoint")&&$("#btn-import-powerpoint").addEventListener("click",()=>{$("#ppt-import-input")?.click();});
  $("#ppt-import-input")&&$("#ppt-import-input").addEventListener("change",e=>importPowerPointFile(e.target.files&&e.target.files[0]));

  // export
  $("#btn-export")&&$("#btn-export").addEventListener("click",()=>{$("#export-deckname").textContent=Deck.title;$("#export-modal").classList.add("on");});
  $$("[data-close-modal]").forEach(b=>b.addEventListener("click",()=>$("#export-modal").classList.remove("on")));
  $("#export-json")&&$("#export-json").addEventListener("click",()=>{exportJSON();$("#export-modal").classList.remove("on");});
  $("#export-html")&&$("#export-html").addEventListener("click",()=>{exportStandaloneHTML();$("#export-modal").classList.remove("on");});
  $("#export-pptx")&&$("#export-pptx").addEventListener("click",()=>{exportPowerPoint();$("#export-modal").classList.remove("on");});

  // AI Slide Generator — wired to the ✦ AI Design button in the topbar
  $("#btn-ai-design")&&$("#btn-ai-design").addEventListener("click",openAiSlideModal);
  document.addEventListener("keydown",e=>{
    const tag=(e.target.tagName||"").toLowerCase();
    const editing=e.target.isContentEditable||tag==="input"||tag==="textarea"||tag==="select";
    const key=e.key.toLowerCase();
    const mod=e.ctrlKey||e.metaKey;

    // Browser-like shortcuts, but scoped to the slide editor when not typing.
    if(mod&&key==="s"){e.preventDefault();saveDeck(false);return;}
    if(editing)return;

    if(mod&&key==="z"){e.preventDefault();e.shiftKey?redo():undo();return;}
    if(mod&&key==="y"){e.preventDefault();redo();return;}
    if(mod&&key==="c"){
      // Let the browser fire the real `copy` event so we can write the latest
      // Hanns object into event.clipboardData. If a browser suppresses the
      // event, a tiny fallback updates only Hanns' internal clipboard.
      const before=internalClipboardAt;
      setTimeout(()=>{if(internalClipboardAt===before&&selectedIds().length)copySelected(null,true);},60);
      return;
    }
    if(mod&&key==="x"){
      // Let the browser fire the real `cut` event so event.clipboardData gets
      // the latest Hanns payload. If it is suppressed, fall back after the key
      // event and cut through Hanns' internal clipboard.
      const before=internalClipboardAt;
      setTimeout(()=>{if(internalClipboardAt===before&&selectedIds().length)cutSelected(null,true);},60);
      return;
    }
    if(mod&&key==="v"){
      // Do not intercept Ctrl/Cmd+V here. Let the real browser `paste` event
      // run first so images/files/HTML/image URLs copied from outside Hanns can
      // be read from `event.clipboardData`. The paste handler below falls back
      // to the latest internal Hanns clipboard only when the system clipboard
      // has no current Hanns/image/link/text payload.
      return;
    }
    if(mod&&key==="d"){
      e.preventDefault();
      if(e.shiftKey){ duplicateSlide(Deck.cur); return; }
      const el=selEl();
      if(el) pasteElement(el);
      else duplicateSlide(Deck.cur);
      return;
    }

    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="g"){e.preventDefault(); if(e.shiftKey)unbindSelected(); else bindSelected(); return;}
    if((e.key==="Delete"||e.key==="Backspace")&&selectedIds().length){e.preventDefault();deleteSelected();return;}
    if(["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)){
      if(Deck.sel){e.preventDefault();nudgeSelected(e.key,e.shiftKey);return;}
      if(e.key==="ArrowRight")gotoSlide(Deck.cur+1);
      else if(e.key==="ArrowLeft")gotoSlide(Deck.cur-1);
    }
  });
  document.addEventListener("copy",e=>{
    const tag=(e.target.tagName||"").toLowerCase();
    const editing=e.target.isContentEditable||tag==="input"||tag==="textarea"||tag==="select";
    if(editing)return;
    if(!selectedIds().length)return;
    e.preventDefault();
    copySelected(e.clipboardData);
  });
  document.addEventListener("cut",e=>{
    const tag=(e.target.tagName||"").toLowerCase();
    const editing=e.target.isContentEditable||tag==="input"||tag==="textarea"||tag==="select";
    if(editing)return;
    if(!selectedIds().length)return;
    e.preventDefault();
    cutSelected(e.clipboardData);
  });

  document.addEventListener("paste",async e=>{
    const tag=(e.target.tagName||"").toLowerCase();
    const editing=e.target.isContentEditable||tag==="input"||tag==="textarea"||tag==="select";
    if(editing)return;
    const cd=e.clipboardData;
    if(!cd)return;
    const hannsRaw=cd.getData("application/x-hanns")||"";
    if(hannsRaw){
      try{
        const parsed=JSON.parse(hannsRaw);
        if(pasteHannsPayload(parsed)){e.preventDefault();return;}
      }catch(_){}
    }
    const items=[...(cd.items||[])];
    const files=[...(cd.files||[])].filter(isImageFile);
    const itemFiles=items.map(it=>it.type&&it.type.startsWith("image/")?it.getAsFile():null).filter(isImageFile);
    if(files.length||itemFiles.length){
      e.preventDefault();
      await addImageFiles([...files,...itemFiles]);
      return;
    }
    const html=cd.getData("text/html");
    const htmlUrls=extractImageUrlsFromHtml(html);
    if(htmlUrls.length){
      e.preventDefault();
      if(await addImageUrls(htmlUrls))return;
    }
    const uri=(cd.getData("text/uri-list")||"").split(/\r?\n/).find(x=>x&&!x.startsWith("#"));
    if(uri&&isLikelyImageUrl(uri)){
      e.preventDefault();
      await addImageUrls([uri]);
      return;
    }
    const txt=cd.getData("text/plain");
    if(txt){
      try{
        const parsed=JSON.parse(txt);
        if(pasteHannsPayload(parsed)){e.preventDefault();return;}
      }catch(_){}
      const trimmed=txt.trim();
      if(isLikelyImageUrl(trimmed)){
        e.preventDefault();
        await addImageUrls([trimmed]);
        return;
      }
      // Plain copied text becomes a text box when pasted onto the slide.
      if(trimmed){
        e.preventDefault();
        const el=makeText({x:W/2-210,y:H/2-60,text:trimmed.slice(0,2000)});
        curSlide().els.push(el);multiSel.clear();Deck.sel=el.id;renderAll();markDirty();toast("Pasted text");
        return;
      }
    }
    // If the system clipboard had no usable image/HTML/URL/text payload,
    // fall back to the last Hanns object copied inside the editor.
    if(internalClipboard){
      e.preventDefault();
      await pasteClipboard();
    }
  });

  // Drop images from your computer, a folder, or a web page directly onto the slide.
  const dropOverlay=document.createElement("div");
  dropOverlay.className="hanns-drop-overlay";
  dropOverlay.innerHTML='<div><b>Drop images on the slide</b><span>Files, folders, web images, image URLs and copied pictures become movable Hanns objects.</span></div>';
  stage.appendChild(dropOverlay);
  let dragDepth=0;
  function showDrop(){dragDepth++;dropOverlay.classList.add("on");}
  function hideDrop(force=false){dragDepth=force?0:Math.max(0,dragDepth-1);if(!dragDepth)dropOverlay.classList.remove("on");}
  ["dragenter","dragover"].forEach(type=>{
    stage.addEventListener(type,e=>{
      if(!e.dataTransfer)return;
      e.preventDefault();
      e.dataTransfer.dropEffect="copy";
      if(type==="dragenter")showDrop();
    });
  });
  stage.addEventListener("dragleave",()=>hideDrop());
  stage.addEventListener("drop",async e=>{
    if(!e.dataTransfer)return;
    e.preventDefault();hideDrop(true);
    const pt=canvasPointFromEvent(e);
    let files=[...(e.dataTransfer.files||[])].filter(isImageFile);
    if(!files.length && e.dataTransfer.items?.length){
      files=await collectImageFilesFromItems(e.dataTransfer.items);
    }
    if(await addImageFiles(files,pt))return;
    const html=e.dataTransfer.getData("text/html");
    const urls=extractImageUrlsFromHtml(html);
    const uri=(e.dataTransfer.getData("text/uri-list")||"").split(/\r?\n/).find(x=>x&&!x.startsWith("#"));
    const plain=e.dataTransfer.getData("text/plain");
    if(uri)urls.push(uri);
    if(plain&&isLikelyImageUrl(plain.trim()))urls.push(plain.trim());
    if(await addImageUrls(urls,pt))return;
    toast("Drop an image, folder, or image URL");
  });
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&appReady)saveDeck(true);});

  window.addEventListener("resize",()=>{applyZoom();renderFilmstrip();});

  buildTplGallery();buildBgGallery();buildObjGallery();buildShapeGallery();
  renderAll();
  resetHistory();
  initLiveEditing();
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
.shape{width:100%;height:100%}.imgbox{width:100%;height:100%;background-size:cover;background-position:center}.dataMini{width:100%;height:100%;background:#fff;border-radius:18px;overflow:hidden;color:#111;font-family:Archivo,sans-serif;box-shadow:0 16px 40px #0002}.dataMini table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed}.dataMini th,.dataMini td{border:1px solid #0001;padding:8px 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dataMini th{background:var(--accent,#1d4e89);color:#fff}.chartMini{padding:18px 22px}.chartMini h3,.mapMini h3{margin:0 0 14px;font-size:22px}.barMini{height:22px;background:var(--accent,#e8482b);border-radius:999px;margin:8px 0}.mapMini{padding:18px 22px;background:linear-gradient(135deg,#ecfeff,#f8fafc)}.pinMini{display:inline-block;background:var(--accent,#2f6f4f);color:#fff;border-radius:999px;padding:8px 12px;margin:6px;font-weight:700}.objectMini{width:100%;height:100%;display:grid;place-items:center;background:#fff;border-radius:18px;font-size:34px}
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
  else if(el.type==="table"){var tb=document.createElement("div");tb.className="dataMini";tb.style.setProperty("--accent",el.accent||"#1d4e89");var h="<table>";(el.tableData||[]).forEach(function(r,ri){h+="<tr>";(r||[]).forEach(function(c){h+=(ri===0&&el.header!==false?"<th>":"<td>")+String(c).replace(/[<>&]/g,function(x){return {"<":"&lt;",">":"&gt;","&":"&amp;"}[x]})+(ri===0&&el.header!==false?"</th>":"</td>")});h+="</tr>"});tb.innerHTML=h+"</table>";inr.appendChild(tb);}
  else if(el.type==="chart"){var ch=document.createElement("div");ch.className="dataMini chartMini";ch.style.setProperty("--accent",el.accent||"#e8482b");var cd=el.chartData||[];var m=Math.max(1);cd.forEach(function(d){m=Math.max(m,Number(d.value)||0)});var h2="<h3>"+(el.title||"Chart")+"</h3>";cd.forEach(function(d){var v=Number(d.value)||0;h2+="<div style='font-weight:700;margin-top:8px'>"+(d.label||"")+" <span style='float:right'>"+v+"</span></div><div class='barMini' style='width:"+(v/m*92+4)+"%'></div>"});ch.innerHTML=h2;inr.appendChild(ch);}
  else if(el.type==="map"){var mp=document.createElement("div");mp.className="dataMini mapMini";mp.style.setProperty("--accent",el.accent||"#2f6f4f");var mh="<h3>"+(el.title||"Map")+"</h3>";(el.pins||[]).forEach(function(pin){mh+="<span class='pinMini'>"+(pin.label||"Pin")+(pin.value?" · "+pin.value:"")+"</span>"});mp.innerHTML=mh;inr.appendChild(mp);}
  else if(el.type==="gallery"){var gm=document.createElement("div");gm.className="imgbox";var gp=(Array.isArray(el.photos)?el.photos:[]).filter(function(p){return p&&p.src;});if(gp.length){gm.style.backgroundImage='url("'+gp[0].src+'")';gm.style.backgroundSize=el.fit||"cover";}gm.style.borderRadius="6px";inr.appendChild(gm);}
  else if(el.type==="object"){var ob=document.createElement("div");ob.className="objectMini";var ic=el.icon||"●";var n=Math.min(Number(el.count)||1,60);ob.textContent=Array(n).fill(ic).join(" ");inr.appendChild(ob);}
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


/* ════════════════════════════════════════════════════════════════════
   STUDIO OBJECT INSPECTOR + ARRANGE TOOLS                        v57
   ────────────────────────────────────────────────────────────────────
   Studio objects (choropleth, KPI tiles, Sankey…) all read the same
   `rows` shape, so ONE data grid drives every one of them; the per-kind
   differences are declared as a field list in STUDIO_FIELDS and turned
   into controls by studioFields().

   These panels are built as DOM rather than as an HTML string because
   they carry live per-row handlers. They are appended after
   bindElementPanel() has run, so the Position / Arrange / Delete
   controls above them are the standard ones.
   ════════════════════════════════════════════════════════════════════ */

const hEl=(tag,attrs,kids)=>{
  const n=document.createElement(tag);
  for(const k in (attrs||{})){
    if(attrs[k]==null)continue;
    if(k==="class")n.className=attrs[k];
    else if(k==="text")n.textContent=attrs[k];
    else if(k.slice(0,2)==="on")n.addEventListener(k.slice(2),attrs[k]);
    else n.setAttribute(k,attrs[k]);
  }
  (kids||[]).forEach(c=>c&&n.appendChild(c));
  return n;
};
const hGroup=(title,kids)=>hEl("div",{class:"group hs-panel"},
  [hEl("span",{class:"glabel",text:title})].concat(kids||[]));
const hField=(label,ctrl)=>hEl("div",{class:"field"},[hEl("label",{text:label}),ctrl]);
const touch=()=>{renderCanvas();markDirty();};

function hText(el,key,ph){
  const i=hEl("input",{type:"text",value:el[key]==null?"":String(el[key]),placeholder:ph||""});
  i.addEventListener("input",()=>{el[key]=i.value;touch();});
  return i;
}
function hNum(el,key,min,max,step){
  const i=hEl("input",{type:"number",value:el[key]==null?"":el[key],min,max,step:step||"any"});
  i.addEventListener("input",()=>{el[key]=i.value===""?"":Number(i.value);touch();});
  return i;
}
function hColor(el,key,fb){
  const i=hEl("input",{type:"color",value:el[key]||fb||"#1d4e89"});
  i.addEventListener("input",()=>{el[key]=i.value;touch();});
  return i;
}
function hSelect(el,key,opts,redraw){
  const s=hEl("select",{});
  opts.forEach(o=>{
    const v=typeof o==="string"?o:o.v, l=typeof o==="string"?o:o.l;
    const op=hEl("option",{value:v,text:l});
    if(String(el[key]??"")===String(v))op.selected=true;
    s.appendChild(op);
  });
  s.addEventListener("change",()=>{
    el[key] = s.value==="true"?true : s.value==="false"?false : s.value;
    touch(); if(redraw)renderInspector();
  });
  return s;
}
function hToggle(el,key,onL,offL,defOn){
  const cur = el[key]===undefined ? !!defOn : el[key]!==false;
  const on =hEl("button",{type:"button",text:onL||"Show",class:cur?"active":""});
  const off=hEl("button",{type:"button",text:offL||"Hide",class:cur?"":"active"});
  on.addEventListener("click",()=>{el[key]=true;on.classList.add("active");off.classList.remove("active");touch();});
  off.addEventListener("click",()=>{el[key]=false;off.classList.add("active");on.classList.remove("active");touch();});
  return hEl("div",{class:"seg"},[on,off]);
}

/* ── the shared data grid ───────────────────────────────────────── */
function studioDataGrid(el){
  if(!Array.isArray(el.rows)){
    const seed=(Hx.STUDIO_SEED||{})[el.objectType];
    el.rows = seed && seed.rows ? JSON.parse(JSON.stringify(seed.rows)) : [];
  }
  const k=el.objectType;
  const wantsV2   = ["bullet_bars","slope_chart","matrix_2x2","stat_block"].indexOf(k)>=0;
  const wantsNote = ["heat_grid","process_steps","timeline_track","stat_block","kpi_grid",
                     "pyramid_tiers","ring_grid","choropleth"].indexOf(k)>=0;
  const labelHead = k==="choropleth"?"Country":(k==="heat_grid"?"Row":"Label");
  const noteHead  = k==="heat_grid"?"Cells (comma separated)":(k==="choropleth"?"Chip name":"Note");
  const vHead     = k==="matrix_2x2"?"X (0–100)":(k==="slope_chart"?"Before":"Value");
  const v2Head    = k==="matrix_2x2"?"Y (0–100)":(k==="slope_chart"?"After":(k==="stat_block"?"Delta":"Target"));

  const tbl=hEl("table",{class:"hs-grid-tbl"});
  const head=hEl("tr",{},[hEl("th",{text:labelHead})]);
  if(k!=="venn")head.appendChild(hEl("th",{text:vHead}));
  if(wantsV2)   head.appendChild(hEl("th",{text:v2Head}));
  if(wantsNote) head.appendChild(hEl("th",{text:noteHead}));
  head.appendChild(hEl("th",{text:""}));head.appendChild(hEl("th",{text:""}));
  tbl.appendChild(head);

  el.rows.forEach((r,idx)=>{
    const tr=hEl("tr",{});
    const cell=c=>{const td=hEl("td",{});td.appendChild(c);tr.appendChild(td);};
    const li=hEl("input",{type:"text",value:r.label==null?"":r.label});
    if(k==="choropleth"){li.setAttribute("list","hs-country-list");li.title="Country name or ISO3 code";}
    li.addEventListener("input",()=>{r.label=li.value;touch();});
    cell(li);
    if(k!=="venn"){
      const vi=hEl("input",{type:"number",step:"any",value:r.value==null?"":r.value});
      vi.addEventListener("input",()=>{r.value=vi.value===""?0:Number(vi.value);touch();});
      cell(vi);
    }
    if(wantsV2){
      const v2=hEl("input",{type:"number",step:"any",value:r.value2==null?"":r.value2});
      v2.addEventListener("input",()=>{r.value2=v2.value===""?null:Number(v2.value);touch();});
      cell(v2);
    }
    if(wantsNote){
      const ni=hEl("input",{type:"text",value:r.note==null?"":r.note});
      ni.addEventListener("input",()=>{r.note=ni.value;touch();});
      cell(ni);
    }
    const ci=hEl("input",{type:"color",value:r.color||"#94a3b8",title:"Override this row's colour"});
    ci.addEventListener("input",()=>{r.color=ci.value;touch();});
    cell(ci);
    const del=hEl("button",{class:"hs-grid-del",type:"button",text:"×",title:"Remove row",
      onclick:()=>{el.rows.splice(idx,1);touch();renderInspector();}});
    cell(del);
    tbl.appendChild(tr);
  });

  const ta=hEl("textarea",{class:"hs-paste-area",
    placeholder:"Paste rows from a spreadsheet — one per line.\nLabel, value, value2, note\n\nGhana, 22.9\nNigeria, 19.5"});
  const pasteWrap=hEl("div",{style:"display:none;margin-top:.45rem"},[ta,
    hEl("button",{class:"hs-mini",type:"button",text:"Apply",onclick:()=>{
      const lines=String(ta.value||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      if(!lines.length)return;
      const out=[];
      lines.forEach(line=>{
        const p=line.split(/\t|,|;/).map(s=>s.trim());
        if(!p[0])return;
        const row={label:p[0]};
        if(p[1])row.value=Number(String(p[1]).replace(/[^0-9.\-]/g,""))||0;
        if(p[2]){
          const n=Number(String(p[2]).replace(/[^0-9.\-]/g,""));
          if(/[0-9]/.test(p[2])&&isFinite(n))row.value2=n; else row.note=p[2];
        }
        if(p[3])row.note=p[3];
        out.push(row);
      });
      if(out.length){el.rows=out;touch();renderInspector();toast(out.length+" rows applied");}
    }})]);

  const btns=hEl("div",{class:"hs-row-btns"},[
    hEl("button",{class:"hs-mini",type:"button",text:"+ Row",
      onclick:()=>{el.rows.push({label:"New",value:0});touch();renderInspector();}}),
    hEl("button",{class:"hs-mini",type:"button",text:"↓ Sort",
      onclick:()=>{el.rows.sort((a,b)=>(Number(b.value)||0)-(Number(a.value)||0));touch();renderInspector();}}),
    hEl("button",{class:"hs-mini",type:"button",text:"Clear colours",
      onclick:()=>{el.rows.forEach(r=>{delete r.color;});touch();renderInspector();}}),
    hEl("button",{class:"hs-mini",type:"button",text:"⇪ Paste data",
      onclick:()=>{pasteWrap.style.display=pasteWrap.style.display==="none"?"block":"none";}}),
  ]);
  const hint = k==="choropleth"
    ? "Type a country name or ISO3 code. Anything unmatched simply is not shaded."
    : (k==="heat_grid" ? "Each row's cell values go in the Note column, comma separated."
                       : "Leave a colour untouched to let the palette assign it.");
  return hEl("div",{},[tbl,btns,pasteWrap,hEl("div",{class:"hs-hint",text:hint})]);
}

/* Country autocomplete for the choropleth grid. */
function ensureCountryList(){
  if(document.getElementById("hs-country-list"))return;
  const GEO=Hx.GEO||{};
  const dl=document.createElement("datalist");dl.id="hs-country-list";
  const seen={};
  Object.keys(GEO).forEach(set=>{
    const f=GEO[set].f;
    Object.keys(f).forEach(iso=>{
      const n=f[iso].n;
      if(n&&!seen[n]){seen[n]=1;dl.appendChild(hEl("option",{value:n}));}
    });
  });
  document.body.appendChild(dl);
}

/* ── per-kind controls ──────────────────────────────────────────── */
function studioFields(el,keys){
  const out=[], has=k=>keys.indexOf(k)>=0;
  const GEO_SETS=Hx.GEO_SETS||[], RAMP_KEYS=Hx.RAMP_KEYS||["accent"];

  if(has("title"))     out.push(hField("Title (blank to hide)",hText(el,"title","")));
  if(has("geoSet"))    out.push(hField("Region set",hSelect(el,"geoSet",GEO_SETS.map(s=>({v:s.key,l:s.label})),true)));
  if(has("ramp"))      out.push(hField("Colour scale",hSelect(el,"ramp",RAMP_KEYS.map(k=>({v:k,l:k==="accent"?"From accent colour":k[0].toUpperCase()+k.slice(1)})))));
  if(has("accent"))    out.push(hField("Accent colour",hColor(el,"accent","#1d4e89")));
  if(has("cols"))      out.push(hField("Columns",hNum(el,"cols",1,20,1)));
  if(has("ringW"))     out.push(hField("Ring thickness",hNum(el,"ringW",4,34,1)));
  if(has("max"))       out.push(hField("Scale maximum (blank = auto)",hNum(el,"max")));
  if(has("labelSize")) out.push(hField("Label size",hNum(el,"labelSize",10,60,1)));
  if(has("colLabels")) out.push(hField("Column names (comma separated)",hText(el,"colLabels","Q1, Q2, Q3, Q4")));
  if(has("align"))     out.push(hField("Text alignment",hSelect(el,"textAlign",[{v:"left",l:"Left"},{v:"center",l:"Centre"},{v:"right",l:"Right"}])));
  if(has("tileStyle")) out.push(hField("Tile style",hSelect(el,"tileStyle",[{v:"soft",l:"Soft tint"},{v:"solid",l:"Solid"},{v:"line",l:"Side rule"}])));
  if(has("stepStyle")) out.push(hField("Step style",hSelect(el,"stepStyle",[{v:"chevron",l:"Chevron"},{v:"card",l:"Card"},{v:"solid",l:"Solid"}])));
  if(has("orient"))    out.push(hField("Direction",hSelect(el,"orient",[{v:"horizontal",l:"Horizontal"},{v:"vertical",l:"Vertical"}])));
  if(has("sort"))      out.push(hField("Sort",hSelect(el,"sort",[{v:"desc",l:"Highest first"},{v:"asc",l:"Lowest first"},{v:"none",l:"Keep my order"}])));
  if(has("waffleShape"))out.push(hField("Cell shape",hSelect(el,"shape",[{v:"square",l:"Square"},{v:"circle",l:"Circle"}])));
  if(has("showValues"))out.push(hField("Show values",hToggle(el,"showValues","Show","Hide",true)));
  if(has("showNumbers"))out.push(hField("Show numbering",hToggle(el,"showNumbers","Show","Hide",true)));
  if(has("alternate"))out.push(hField("Alternate above / below",hToggle(el,"alternate","On","Off",true)));
  if(has("countup"))  out.push(hField("Number behaviour",hSelect(el,"numberMode",[{v:"static",l:"Static"},{v:"countup",l:"Count up on reveal"}])));
  if(has("dark"))     out.push(hField("Colour mode",hToggle(el,"dark","Dark","Light",false)));
  if(has("grid"))     out.push(hField("Container box",hToggle(el,"hideContainer","Hidden","Visible",true)));

  if(has("numfmt")){
    out.push(hEl("div",{class:"row2"},[hField("Prefix",hText(el,"valuePrefix","")),hField("Suffix",hText(el,"valueSuffix","%"))]));
    out.push(hField("Decimal places",hNum(el,"decimals",0,4,1)));
  }
  if(has("scaleRange"))out.push(hEl("div",{class:"row2"},[
    hField("Scale min (auto)",hNum(el,"scaleMin")),hField("Scale max (auto)",hNum(el,"scaleMax"))]));
  if(has("legend")){
    out.push(hField("Legend",hToggle(el,"showLegend","Show","Hide",true)));
    out.push(hField("Legend title",hText(el,"legendTitle","Value")));
    out.push(hEl("div",{class:"row2"},[hField("Ticks",hNum(el,"legendTicks",2,9,1)),
                                       hField("Gutter",hNum(el,"legendGutter",0,400,2))]));
  }
  if(has("chips")){
    out.push(hField("Value chips",hToggle(el,"showChips","Show","Hide",true)));
    out.push(hField("Chip style",hSelect(el,"chipStyle",[{v:"plain",l:"Plain text"},{v:"pill",l:"Pill"},{v:"bubble",l:"Bubble"}])));
    out.push(hField("Country name on chip",hToggle(el,"chipName","Show","Hide",true)));
    out.push(hField("Unshaded countries",hColor(el,"baseFill","#e8edf3")));
  }
  if(has("slopeAxes"))out.push(hEl("div",{class:"row2"},[
    hField("Left axis",hText(el,"leftLabel","Before")),hField("Right axis",hText(el,"rightLabel","After"))]));
  if(has("matrixAxes"))out.push(hEl("div",{class:"row2"},[
    hField("X axis label",hText(el,"xLabel","")),hField("Y axis label",hText(el,"yLabel",""))]));
  if(has("quadrants")){
    out.push(hEl("div",{class:"row2"},[hField("Top left",hText(el,"q1","")),hField("Top right",hText(el,"q2",""))]));
    out.push(hEl("div",{class:"row2"},[hField("Bottom left",hText(el,"q3","")),hField("Bottom right",hText(el,"q4",""))]));
  }
  if(has("vennOpts")){
    out.push(hField("Overlap label",hText(el,"centerLabel","")));
    out.push(hEl("div",{class:"row2"},[hField("Circle size",hNum(el,"circleR",.12,.42,.01)),
                                       hField("Opacity",hNum(el,"circleOpacity",.2,1,.05))]));
  }
  if(has("pyramidOpts")){
    out.push(hField("Direction",hSelect(el,"inverted",[{v:"false",l:"Widest at base"},{v:"true",l:"Inverted (funnel)"}])));
    out.push(hEl("div",{class:"row2"},[hField("Base width",hNum(el,"baseWidth",.15,.48,.01)),
                                       hField("Apex width",hNum(el,"apexRatio",0,.6,.02))]));
    out.push(hField("Horizontal position",hNum(el,"centerX",.2,.8,.02)));
  }
  if(has("sankeyOpts")){
    out.push(hField("Source label",hText(el,"sourceLabel","Total")));
    out.push(hField("Show percentage share",hToggle(el,"showShare","Show","Hide",true)));
    out.push(hEl("div",{class:"row2"},[hField("Node width",hNum(el,"nodeW",8,60,1)),
                                       hField("Ribbon opacity",hNum(el,"flowOpacity",.2,1,.05))]));
  }
  if(has("quoteOpts")){
    const ta=hEl("textarea",{rows:4});ta.value=el.quote||"";
    ta.addEventListener("input",()=>{el.quote=ta.value;touch();});
    out.push(hField("Quotation",ta));
    out.push(hField("Attribution",hText(el,"attribution","")));
    out.push(hField("Role / source",hText(el,"role","")));
    out.push(hField("Style",hSelect(el,"quoteStyle",[{v:"bar",l:"Side rule"},{v:"card",l:"Outlined card"},{v:"plain",l:"Plain"}])));
    out.push(hEl("div",{class:"row2"},[hField("Quote size",hNum(el,"quoteSize",14,72,1)),
                                       hField("Opening mark",hToggle(el,"showMark","Show","Hide",true))]));
  }
  if(has("objAnim")){
    out.push(hField("Movement",hToggle(el,"objAnim","Animate","Hold still",true)));
  }
  if(has("hourglassOpts")){
    out.push(hField("Seconds per turn",hNum(el,"duration",1,120,1)));
    out.push(hEl("div",{class:"row2"},[hField("Sand",hColor(el,"sandColor","#c2861a")),
                                       hField("Frame",hColor(el,"frameColor","#3f2f1c"))]));
    out.push(hEl("div",{class:"hs-hint",text:"The glass turns over at the end of each run and starts again."}));
  }
  if(has("clockOpts")){
    out.push(hField("Clock mode",hSelect(el,"clockMode",[
      {v:"live",l:"Live — real time now"},{v:"fixed",l:"Fixed time"},{v:"fast",l:"Fast sweep"}],true)));
    if(String(el.clockMode||"live")==="fixed"){
      out.push(hEl("div",{class:"row2"},[hField("Hour",hNum(el,"hour",0,23,1)),
                                         hField("Minute",hNum(el,"minute",0,59,1))]));
    }
    if(String(el.clockMode||"live")==="fast"){
      out.push(hField("Seconds per hour of dial",hNum(el,"sweepSeconds",.5,120,.5)));
    }
    out.push(hField("Dial",hSelect(el,"faceStyle",[{v:"ticks",l:"Ticks"},{v:"numbers",l:"Numbers"},
                                                   {v:"roman",l:"Roman numerals"},{v:"minimal",l:"Bare"}])));
    out.push(hField("Second hand",hToggle(el,"showSeconds","Show","Hide",true)));
    out.push(hEl("div",{class:"row2"},[hField("Face",hColor(el,"faceColor","#ffffff")),
                                       hField("Hands",hColor(el,"handColor","#0f172a"))]));
    out.push(hEl("div",{class:"hs-hint",
      text:"Live mode reads the clock when the slide paints and keeps real time from there."}));
  }
  if(has("gearOpts")){
    out.push(hField("Seconds per turn (12 teeth)",hNum(el,"speed",.5,60,.5)));
    out.push(hEl("div",{class:"row2"},[hField("Wheel size",hNum(el,"gearScale",.3,3,.05)),
                                       hField("Spokes",hToggle(el,"spokes","Show","Hide",true))]));
    out.push(hEl("div",{class:"hs-hint",
      text:"Each row is one wheel; its value is the tooth count. More teeth turn slower, and neighbours turn opposite ways."}));
  }
  if(has("batteryOpts")){
    out.push(hField("Orientation",hSelect(el,"orient",[{v:"horizontal",l:"Horizontal"},{v:"vertical",l:"Vertical"}])));
    out.push(hField("Charging",hToggle(el,"charging","Charging","Idle",false)));
    out.push(hEl("div",{class:"hs-hint",
      text:"Leave the accent colour empty to let the level colour itself — green, amber, then red."}));
  }
  if(has("legendTicksOnly"))out.push(hField("Scale ticks",hNum(el,"legendTicks",2,11,1)));
  if(has("benchmarks"))out.push(studioBenchmarks(el));
  return out;
}

/* ── shape motion: idle movement, on by default, off per shape ────── */
function shapeMotionPanel(el){
  if(!el||!MOTION_TYPES.has(el.type))return null;
  const cur=motionOf(el);
  const kids=[
    hField("Movement",hSelect(el,"motion",
      Object.keys(SHAPE_MOTIONS).map(k=>({v:k,l:SHAPE_MOTIONS[k].label})),true)),
  ];
  if(cur!=="none"){
    kids.push(hEl("div",{class:"row2"},[
      hField("Seconds per cycle",hNum(el,"motionSpeed",.4,60,.2)),
      hField("Amount",hNum(el,"motionAmount",0,4,.1)),
    ]));
    kids.push(hField("Start offset (s)",hNum(el,"motionDelay",-30,30,.1)));
    kids.push(hEl("div",{class:"hs-hint",
      text:"Give neighbouring shapes different cycles or offsets so they do not move in lockstep. A selected shape always holds still in the editor; it moves on the stage."}));
  }else{
    kids.push(hEl("div",{class:"hs-hint",text:"This shape stays still. Pick a movement above to animate it on the stage."}));
  }
  // Set the motion on every shape in the selection at once.
  const all=hEl("button",{class:"hs-mini",type:"button",text:"Apply to all selected shapes",
    onclick:()=>{
      const list=selectedElements().filter(e=>MOTION_TYPES.has(e.type));
      list.forEach(e=>{e.motion=el.motion;e.motionSpeed=el.motionSpeed;e.motionAmount=el.motionAmount;});
      pushHistory();renderAll();markDirty();
      toast("Movement applied to "+list.length+" shape"+(list.length>1?"s":""));
    }});
  kids.push(hEl("div",{class:"hs-row-btns"},[all]));
  return hGroup("Shape movement",kids);
}

function studioBenchmarks(el){
  if(!Array.isArray(el.benchmarks))el.benchmarks=[];
  const tbl=hEl("table",{class:"hs-grid-tbl"});
  el.benchmarks.forEach((b,i)=>{
    const li=hEl("input",{type:"text",value:b.label||""});
    li.addEventListener("input",()=>{b.label=li.value;touch();});
    const vi=hEl("input",{type:"number",step:"any",value:b.value==null?"":b.value});
    vi.addEventListener("input",()=>{b.value=Number(vi.value)||0;touch();});
    const ci=hEl("input",{type:"color",value:b.color||"#38bdf8"});
    ci.addEventListener("input",()=>{b.color=ci.value;touch();});
    const del=hEl("button",{class:"hs-grid-del",type:"button",text:"×",
      onclick:()=>{el.benchmarks.splice(i,1);touch();renderInspector();}});
    const tr=hEl("tr",{});
    [li,vi,ci,del].forEach(c=>{const td=hEl("td",{});td.appendChild(c);tr.appendChild(td);});
    tbl.appendChild(tr);
  });
  return hEl("div",{},[
    hEl("label",{text:"Benchmark markers",style:"font-size:.66rem;opacity:.7;font-weight:700"}),
    tbl,
    hEl("div",{class:"hs-row-btns"},[hEl("button",{class:"hs-mini",type:"button",text:"+ Benchmark",
      onclick:()=>{el.benchmarks.push({label:"Benchmark",value:0,color:"#38bdf8"});touch();renderInspector();}})]),
    hEl("div",{class:"hs-hint",text:"Markers sit beside the scale. An automatic range widens to include them."})
  ]);
}

/* ════════════════════════════════════════════════════════════════════
   ARRANGE, ALIGN & DISTRIBUTE — for every element type
   ────────────────────────────────────────────────────────────────────
   One element aligns to the slide; several align to their combined
   bounds, which is what every other design tool has taught people to
   expect. selectedElements() already resolves the multi-selection, so
   these work on whatever is picked.
   ════════════════════════════════════════════════════════════════════ */
let styleClip=null;

function arrangeTargets(){return selectedElements();}
function arrangeBBox(list){
  const x=Math.min(...list.map(e=>e.x)), y=Math.min(...list.map(e=>e.y));
  return {x,y,w:Math.max(...list.map(e=>e.x+e.w))-x,h:Math.max(...list.map(e=>e.y+e.h))-y};
}
function alignSelection(mode){
  const list=arrangeTargets();if(!list.length)return;
  const box=list.length>1?arrangeBBox(list):{x:0,y:0,w:W,h:H};
  list.forEach(e=>{
    if(mode==="left")   e.x=Math.round(box.x);
    if(mode==="center") e.x=Math.round(box.x+(box.w-e.w)/2);
    if(mode==="right")  e.x=Math.round(box.x+box.w-e.w);
    if(mode==="top")    e.y=Math.round(box.y);
    if(mode==="middle") e.y=Math.round(box.y+(box.h-e.h)/2);
    if(mode==="bottom") e.y=Math.round(box.y+box.h-e.h);
  });
  pushHistory();renderAll();markDirty();
}
function distributeSelection(axis){
  const list=arrangeTargets();
  if(list.length<3){toast("Select three or more objects to distribute");return;}
  const key=axis==="h"?"x":"y", size=axis==="h"?"w":"h";
  const sorted=list.slice().sort((a,b)=>a[key]-b[key]);
  const first=sorted[0], last=sorted[sorted.length-1];
  const gap=((last[key]+last[size])-first[key]-sorted.reduce((s,e)=>s+e[size],0))/(sorted.length-1);
  let cur=first[key];
  sorted.forEach(e=>{e[key]=Math.round(cur);cur+=e[size]+gap;});
  pushHistory();renderAll();markDirty();
}
function matchSizeSelection(dim){
  const list=arrangeTargets();
  if(list.length<2){toast("Select two or more objects to match size");return;}
  const ref=list[list.length-1];
  list.forEach(e=>{if(dim==="w"||dim==="both")e.w=ref.w;if(dim==="h"||dim==="both")e.h=ref.h;});
  pushHistory();renderAll();markDirty();
}
function flipSelection(axis){
  const list=arrangeTargets();if(!list.length)return;
  list.forEach(e=>{e.fx=Object.assign({},e.fx||{});const k=axis==="h"?"flipH":"flipV";e.fx[k]=!e.fx[k];});
  pushHistory();renderAll();markDirty();
}
function fitSelection(mode){
  const list=arrangeTargets();if(!list.length)return;
  list.forEach(e=>{
    if(mode==="width"||mode==="both"){e.x=0;e.w=W;}
    if(mode==="height"||mode==="both"){e.y=0;e.h=H;}
  });
  pushHistory();renderAll();markDirty();
}
const STUDIO_STYLE_KEYS=["fill","stroke","strokeW","radius","dashed","color","font","size","weight",
  "italic","lh","ls","align","accent","ramp","dark","hideContainer","labelSize","decimals",
  "valuePrefix","valueSuffix","theme","chartTheme","opacity","fx"];
function copySelectionStyle(){
  const one=selEl();if(!one){toast("Select an object first");return;}
  styleClip={};
  STUDIO_STYLE_KEYS.forEach(k=>{if(one[k]!==undefined)styleClip[k]=deepClone(one[k]);});
  toast("Style copied");
}
function pasteSelectionStyle(){
  if(!styleClip){toast("Copy a style first");return;}
  const list=arrangeTargets();if(!list.length)return;
  list.forEach(e=>{for(const k in styleClip){
    if(e[k]!==undefined||["accent","ramp","fx","dark"].indexOf(k)>=0)e[k]=deepClone(styleClip[k]);
  }});
  pushHistory();renderAll();markDirty();renderInspector();
  toast("Style applied to "+list.length+" object"+(list.length>1?"s":""));
}
function arrangePanel(){
  const n=arrangeTargets().length;
  const b=(label,title,fn)=>hEl("button",{type:"button",title,text:label,onclick:fn});
  return hGroup("Align & distribute",[
    hEl("div",{class:"hs-arrange"},[
      b("⭰","Align left",()=>alignSelection("left")),
      b("⭶","Align horizontal centres",()=>alignSelection("center")),
      b("⭲","Align right",()=>alignSelection("right")),
      b("⭱","Align top",()=>alignSelection("top")),
      b("⭷","Align vertical centres",()=>alignSelection("middle")),
      b("⭳","Align bottom",()=>alignSelection("bottom")),
    ]),
    hEl("div",{style:"height:.3rem"}),
    hEl("div",{class:"hs-arrange"},[
      b("↔","Distribute horizontally (needs 3+)",()=>distributeSelection("h")),
      b("↕","Distribute vertically (needs 3+)",()=>distributeSelection("v")),
      b("W","Match width to last selected",()=>matchSizeSelection("w")),
      b("H","Match height to last selected",()=>matchSizeSelection("h")),
      b("⇋","Flip horizontally",()=>flipSelection("h")),
      b("⇵","Flip vertically",()=>flipSelection("v")),
    ]),
    hEl("div",{class:"hs-hint",text: n>1
      ? n+" objects selected — alignment uses their combined bounds."
      : "One object selected — alignment uses the slide. Shift-click more objects to align them to each other."}),
    hEl("div",{class:"hs-row-btns"},[
      hEl("button",{class:"hs-mini",type:"button",text:"⧉ Copy style",onclick:copySelectionStyle}),
      hEl("button",{class:"hs-mini",type:"button",text:"⧉ Paste style",onclick:pasteSelectionStyle}),
      hEl("button",{class:"hs-mini",type:"button",text:"Full bleed",onclick:()=>fitSelection("both")}),
      hEl("button",{class:"hs-mini",type:"button",text:"Full width",onclick:()=>fitSelection("width")}),
    ]),
    hEl("div",{class:"hs-hint",text:"Arrow keys nudge by 1px, Shift+arrows by 10px."}),
  ]);
}

/* Append the studio panels underneath whatever the inspector just drew. */
function studioPanels(el){
  if(!inspBody)return;
  const mp = shapeMotionPanel(el);
  if(mp) inspBody.appendChild(mp);
  if(el && el.type==="object" && isStudioObject(el.objectType)){
    const def=(OBJECTS||[]).find(o=>o.kind===el.objectType)||{label:el.objectType,icon:"◆"};
    ensureCountryList();
    inspBody.appendChild(hGroup(def.icon+"  "+def.label, studioFields(el,(Hx.STUDIO_FIELDS||{})[el.objectType]||[])));
    inspBody.appendChild(hGroup("Data",[studioDataGrid(el)]));
  }
  inspBody.appendChild(arrangePanel());
}


/* ════════════════════════════════════════════════════════════════════
   DECK-WIDE DESIGN — apply to all slides, and auto-design
   ────────────────────────────────────────────────────────────────────
   Both of these change every slide at once, so both push history first:
   one undo puts the whole deck back.
   ════════════════════════════════════════════════════════════════════ */

/* Copy one property of the current slide onto every other slide. */
function applySlidePropToAll(prop){
  const s=curSlide(); if(!s)return 0;
  let n=0;
  pushHistory();
  Deck.slides.forEach(t=>{
    if(t===s)return;
    if(prop==="bg"){ t.bg=s.bg; t.bgSize=s.bgSize||null; t.bgMode=s.bgMode;
                     t.bgC1=s.bgC1; t.bgC2=s.bgC2; t.bgC3=s.bgC3;
                     t.bgAngle=s.bgAngle; t.bgUse3=s.bgUse3; }
    else t[prop]=s[prop];
    n++;
  });
  renderAll(); markDirty();
  return n;
}

/* Copy the entrance animation of THIS slide's elements onto the matching
   elements of every other slide.
   Matching is by type and by reading order within that type, not by id —
   ids are unique per element, so nothing would ever match. Two slides that
   both open with a heading and two paragraphs therefore build the same way,
   which is the point of setting it once. */
function applyAnimationsToAll(){
  const s=curSlide(); if(!s)return 0;
  const byType={};
  (s.els||[]).forEach(e=>{ (byType[e.type]=byType[e.type]||[]).push(e); });
  Object.keys(byType).forEach(k=>byType[k].sort((a,b)=>(a.y-b.y)||(a.x-b.x)));
  let n=0;
  pushHistory();
  Deck.slides.forEach(t=>{
    if(t===s)return;
    const seen={};
    (t.els||[]).slice().sort((a,b)=>(a.y-b.y)||(a.x-b.x)).forEach(e=>{
      const list=byType[e.type]; if(!list)return;
      const idx=(seen[e.type]=(seen[e.type]||0)+1)-1;
      const src=list[Math.min(idx,list.length-1)];
      e.anim=src.anim; e.animDelay=src.animDelay;
      if(src.animDur!==undefined)e.animDur=src.animDur;
      if(src.animEase!==undefined)e.animEase=src.animEase;
      n++;
    });
  });
  renderAll(); markDirty();
  return n;
}

let autoThemeKey=(Hx.AUTO_THEMES&&Hx.AUTO_THEMES[0]&&Hx.AUTO_THEMES[0].key)||"midnight";
let autoKeepPositions=false;

function runAutoDesign(scope){
  const themes=Hx.AUTO_THEMES||[];
  if(!themes.length){toast("Auto-design is unavailable");return;}
  pushHistory();
  const opts={keepPositions:autoKeepPositions,slideNumbers:true};
  let report;
  if(scope==="slide"){
    const s=curSlide();
    const kind=Hx.autoDesignSlide(s,Hx.autoTheme(autoThemeKey),Deck.cur,Deck.slides.length,opts);
    report={slides:[kind]};
  }else{
    report=Hx.autoDesignDeck(Deck.slides,autoThemeKey,opts);
  }
  Deck.sel=null;
  renderAll(); markDirty();
  const counts={};
  report.slides.forEach(k=>{counts[k]=(counts[k]||0)+1;});
  const summary=Object.keys(counts).map(k=>counts[k]+" "+k).join(", ");
  toast(scope==="slide" ? ("Designed as "+report.slides[0])
                        : ("Designed "+report.slides.length+" slides — "+summary));
}

function slideDesignPanel(){
  if(!inspBody||!Hx.AUTO_THEMES)return;
  const themes=Hx.AUTO_THEMES;

  // ── apply the current slide's settings across the deck ──
  const others=Math.max(0,Deck.slides.length-1);
  const applyBtn=(label,title,fn)=>hEl("button",{class:"hs-mini",type:"button",text:label,title,
    onclick:()=>{ const n=fn(); toast(n?("Applied to "+n+" other slide"+(n>1?"s":"")):"No other slides"); }});
  inspBody.appendChild(hGroup("Apply to all slides",[
    hEl("div",{class:"hs-row-btns"},[
      applyBtn("Transition","Give every slide this slide's transition",()=>applySlidePropToAll("transition")),
      applyBtn("Background","Give every slide this background",()=>applySlidePropToAll("bg")),
      applyBtn("Background effect","Give every slide this background effect",()=>applySlidePropToAll("bgFx")),
      applyBtn("Element animations","Match each slide's build to this one",applyAnimationsToAll),
    ]),
    hEl("div",{class:"hs-hint",text: others
      ? ("This slide's setting is copied onto the other "+others+" slide"+(others>1?"s":"")+". Undo reverses the lot.")
      : "There is only one slide in this deck."}),
  ]));

  // ── auto-design ──
  const grid=hEl("div",{class:"auto-theme-grid"});
  themes.forEach(t=>{
    const cell=hEl("button",{type:"button",
      class:"auto-theme"+(t.key===autoThemeKey?" active":""),
      title:t.name, onclick:()=>{ autoThemeKey=t.key; renderInspector(); }});
    cell.appendChild(hEl("span",{class:"auto-swatch",style:"background:"+(t.coverBg||t.bg)}));
    cell.appendChild(hEl("span",{class:"auto-name",text:t.name}));
    const dot=hEl("span",{class:"auto-dot",style:"background:"+t.accent});
    cell.appendChild(dot);
    grid.appendChild(cell);
  });

  const keep=hEl("button",{class:"hs-mini"+(autoKeepPositions?" on":""),type:"button",
    text:autoKeepPositions?"Keeping my layout":"Re-laying out",
    title:"Whether auto-design may move and resize your text",
    onclick:()=>{ autoKeepPositions=!autoKeepPositions; renderInspector(); }});

  inspBody.appendChild(hGroup("Auto-design",[
    grid,
    hEl("div",{class:"hs-row-btns"},[
      hEl("button",{class:"hs-mini",type:"button",text:"✨ Design all slides",
        onclick:()=>runAutoDesign("all")}),
      hEl("button",{class:"hs-mini",type:"button",text:"This slide only",
        onclick:()=>runAutoDesign("slide")}),
      keep,
      hEl("button",{class:"hs-mini",type:"button",text:"Remove decoration",
        title:"Strip the shapes and slide numbers auto-design added; your own content stays",
        onclick:()=>{ pushHistory(); const n=Hx.autoDesignStrip(Deck.slides);
          Deck.sel=null; renderAll(); markDirty();
          toast(n?("Removed "+n+" added element"+(n>1?"s":"")):"Nothing to remove"); }}),
    ]),
    hEl("div",{class:"hs-hint",text:
      "Each slide is read first — cover, statement, split, media or dense — and laid out to suit, "+
      "so the deck does not come out as the same template six times. Your text is restyled and moved, "+
      "never deleted. Undo puts everything back."}),
  ]));
}

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();

})();