/* ════════════════════════════════════════════════════════════════════
   HANNS — interaction layer (depends on logic_core's window.Hanns)
   ════════════════════════════════════════════════════════════════════ */
(function(){
"use strict";
const Hx = window.Hanns;
const {Deck,TEMPLATES,BACKGROUNDS,BG_FX,ANIMS,TRANSITIONS,PALETTE,FONTS,OBJECTS,SHAPES,
  newSlide,curSlide,selEl,paintSlide,renderElement,
  makeText,makeShape,makeLine,makeImage,makeVideo,makeLink,makeObject,makeCreativeShape,makeTable,makeChart,makeMap,W,H,$,$$,uid,clamp,genCode}=Hx;

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
  const keepTop = slidesEl ? slidesEl.scrollTop : 0;
  slidesEl.innerHTML="";
  Deck.slides.forEach((s,i)=>{
    const th=document.createElement("div");
    th.className="thumb"+(i===Deck.cur?" active":"");
    th.draggable=true;
    th.dataset.index=i;
    th.title="Drag to reorder slides";
    th.innerHTML=`<span class="num">${i+1}</span><button class="del" title="Delete">✕</button><span class="drag-grip" title="Drag slide">⋮⋮</span>`;
    const mini=document.createElement("div");mini.className="mini";
    mini.style.width=W+"px";mini.style.height=H+"px";
    paintSlide(mini,s,{live:false});
    // scale mini into the thumb width
    requestAnimationFrame(()=>{const sc=th.clientWidth/W;mini.style.transform=`scale(${sc})`;});
    th.appendChild(mini);

    th.addEventListener("click",e=>{
      if(e.target.closest(".del"))return;
      if(slideDragMoved){slideDragMoved=false;return;}
      gotoSlide(i);
    });
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
function markDirty(){if(appReady&&typeof scheduleSave==="function")scheduleSave();}

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
  else if(kind==="link"){el=makeLink({x:W/2-260,y:H/2-60});}
  else if(kind==="object"){el=makeObject("water_glass",{x:W/2-115,y:H/2-150});}
  else if(kind==="table"){el=makeTable({x:W/2-310,y:H/2-145});}
  else if(kind==="chart"){el=makeChart("bar",{x:W/2-325,y:H/2-165});}
  else if(kind==="graph"){el=makeChart("line",{x:W/2-325,y:H/2-165,title:"Growth graph",accent:"#22c55e"});}
  else if(kind==="map"){el=makeMap("gambia",{x:W/2-325,y:H/2-180});}
  else if(kind==="creative_shape"){el=makeCreativeShape("blob_01",{x:W/2-120,y:H/2-120});}
  if(!el)return;
  s.els.push(el);Deck.sel=el.id;renderAll();markDirty();
  if(kind==="image")pickImageFor(el.id);
}
function addObject(kind){
  const d=(OBJECTS||[]).find(o=>o.kind===kind);
  const el=makeObject(kind,{x:Math.round(W/2-(d?.w||320)/2),y:Math.round(H/2-(d?.h||220)/2)});
  curSlide().els.push(el);Deck.sel=el.id;renderAll();markDirty();closeDrawers();
}
function addCreativeShape(kind){
  const d=(SHAPES||[]).find(s=>s.kind===kind)||SHAPES[0];
  const el=makeCreativeShape(kind,{x:Math.round(W/2-120),y:Math.round(H/2-120),fill:d.accent||"#e8482b"});
  curSlide().els.push(el);Deck.sel=el.id;renderAll();markDirty();closeDrawers();
}
function selectEl(id){Deck.sel=id;
  $$(".el",canvas).forEach(n=>n.classList.toggle("selected",n.dataset.id===id));
  renderInspector();
}
function deleteEl(id){const s=curSlide();s.els=s.els.filter(e=>e.id!==id);
  if(Deck.sel===id)Deck.sel=null;renderAll();markDirty();}

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
          ["bar","Bar"],["horizontalBar","Horizontal bar"],["groupedBar","Grouped bar"],["stackedBar","Stacked bar"],["line","Line"],["spline","Smooth line"],["area","Area"],["pie","Pie"],["donut","Donut"],["scatter","Scatter"],["bubble","Bubble"],["radar","Radar"],["gauge","Gauge"],["progress","Progress"],["funnel","Funnel"],["waterfall","Waterfall"],["heatmap","Heatmap"],["treemap","Treemap"],["kpi","KPI card"]
        ].map(([k,l])=>`<option value="${k}" ${el.chartKind===k?"selected":""}>${l}</option>`).join("")}
      </select>`)}
      <button class="tbtn" id="f-chartimport" style="width:100%;justify-content:center;margin:.1rem 0 .5rem">⬆ Import from CSV / Excel</button>
      ${field("Data (or edit here)",`<textarea id="f-chartdata" rows="7" placeholder="Label,Value&#10;Jan,20&#10;Feb,35">${escapeTA(chartToText(el))}</textarea>`)}
      <div class="insp-empty" style="padding:0 0 .5rem">Label,Value. Scatter/bubble: Label,Value,X,Y,Size. Grouped/stacked: add extra numbers per row.</div>
    </div>
    <div class="group"><span class="glabel">Labels &amp; values</span>
      ${field("Show values",`<div class="seg" id="f-chartvalues"><button data-show="1" class="${el.showValues!==false?"active":""}">Show</button><button data-show="0" class="${el.showValues===false?"active":""}">Hide</button></div>`)}
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
      ${field("Gridlines",`<div class="seg" id="f-chartgrid"><button data-on="1" class="${el.gridLines!==false?"active":""}">On</button><button data-on="0" class="${el.gridLines===false?"active":""}">Off</button></div>`)}
      ${field("Axis numbers",`<div class="seg" id="f-chartaxis"><button data-on="1" class="${el.axisValues!==false?"active":""}">On</button><button data-on="0" class="${el.axisValues===false?"active":""}">Off</button></div>`)}
      ${field("Legend (grouped/stacked)",`<div class="seg" id="f-chartlegend"><button data-on="1" class="${el.showLegend?"active":""}">On</button><button data-on="0" class="${!el.showLegend?"active":""}">Off</button></div>`)}
      ${field("Title colour",`<input type="color" id="f-charttitlecolor" value="${el.titleColor||"#111827"}">`)}
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
      ${field("Quick fill",`<div class="seg" id="f-mapcities"><button data-on="0" class="${!el.useCities?"active":""}">My pins</button><button data-on="1" class="${el.useCities?"active":""}">Major cities</button></div>`)}
      ${field("Pins (Name, Lon, Lat, Value)",`<textarea id="f-mappins" rows="6" placeholder="Banjul,-16.58,13.45,12">${escapeTA(pinsToText(el))}</textarea>`)}
      <div class="insp-empty" style="padding:0 0 .5rem">Use real longitude,latitude (e.g. Banjul,-16.58,13.45,12). Pins land on the real map. Switch "Major cities" to auto-place well-known cities.</div>
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
    h+=`<div class="group"><span class="glabel">Object / data visual</span>
      ${field("Object type",`<select id="f-objtype">${OBJECTS.map(o=>`<option value="${o.kind}" ${el.objectType===o.kind?"selected":""}>${o.icon} ${o.label}</option>`).join("")}</select>`)}
      ${field("Label",`<input type="text" id="f-objlabel" value="${(el.label||def.label).replace(/"/g,"&quot;")}">`)}
      ${field("Amount / count",`<input type="number" id="f-count" min="1" max="10000" value="${el.count||1}">`)}
      ${field("Level "+(el.level||0)+"%",`<input type="range" id="f-level" min="0" max="100" value="${el.level||0}">`)}
      ${field("Accent colour",`<input type="color" id="f-accent" value="${el.accent||def.accent||"#4cc9f0"}">`)}
      ${field("Show label/count",`<div class="seg" id="f-showcount"><button data-show="1" class="${el.showCount!==false?"active":""}">Show</button><button data-show="0" class="${el.showCount===false?"active":""}">Hide</button></div>`)}
      ${field("Container box",`<div class="seg" id="f-objbox"><button data-box="show" class="${!el.hideContainer?"active":""}">Show box</button><button data-box="hide" class="${el.hideContainer?"active":""}">Hide box</button></div>`)}
      <div class="insp-empty" style="padding-top:.2rem">${def.help||"Animated visual object"}</div>
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
    const data=$("#f-chartdata");data&&data.addEventListener("input",()=>{el.chartData=parseChartText(data.value);renderCanvas();markDirty();});
    $("#f-chartimport")&&$("#f-chartimport").addEventListener("click",()=>pickDataFileFor(el.id,"chart"));
    seg("f-chartvalues","show",v=>{el.showValues=v==="1";renderCanvas();markDirty();});
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
    $$("#f-chartpalette .pal-sw").forEach(sw=>sw.addEventListener("input",()=>{
      const pal=Array.isArray(el.palette)&&el.palette.length?el.palette.slice():["#e8482b","#22c55e","#38bdf8","#f59e0b","#a855f7","#ef4444"];
      pal[Number(sw.dataset.pi)]=sw.value;el.palette=pal;el.accent=pal[0];renderCanvas();markDirty();
    }));
  }
  if(el.type==="map"){
    const title=$("#f-maptitle");title&&title.addEventListener("input",()=>{el.title=title.value;renderCanvas();markDirty();});
    const kind=$("#f-mapkind");kind&&kind.addEventListener("change",()=>{el.mapKind=kind.value;renderCanvas();renderInspector();markDirty();});
    const pins=$("#f-mappins");pins&&pins.addEventListener("input",()=>{el.pins=parsePinsText(pins.value);el.useCities=false;renderCanvas();markDirty();});
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
      el.w=d.w||el.w;el.h=d.h||el.h;renderAll();markDirty();
    });
    const lab=$("#f-objlabel");lab&&lab.addEventListener("input",()=>{el.label=lab.value;renderCanvas();markDirty();});
    const count=$("#f-count");count&&count.addEventListener("input",()=>{el.count=Math.max(1,Number(count.value)||1);renderCanvas();markDirty();});
    bindRange("f-level",v=>{el.level=v;renderCanvas();markDirty();},v=>v+"%","Level");
    const acc=$("#f-accent");acc&&acc.addEventListener("input",()=>{el.accent=acc.value;renderCanvas();markDirty();});
    seg("f-showcount","show",v=>{el.showCount=v==="1";renderCanvas();markDirty();});
    seg("f-objbox","box",v=>{el.hideContainer=(v==="hide");renderCanvas();markDirty();});
  }
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
  const curFx=s.bgFx||"none";
  let fx=(BG_FX||[]).map(f=>`<button class="chip bgfx-chip ${curFx===f.key?"active":""}" data-bgfx="${f.key}" title="${f.hint||""}">${f.label}</button>`).join("");
  let trans=Object.entries(TRANSITIONS).map(([k,v])=>`<button class="chip ${s.transition===k?"active":""}" data-trans="${k}">${v}</button>`).join("");
  return `<div class="group"><span class="glabel">Slide background</span>${bgs}</div>
    <div class="group"><span class="glabel">Moving background</span><div class="chiprow bgfx-row">${fx}</div></div>
    <div class="group"><span class="glabel">Presenter notes</span>${field("Notes for phone controller",`<textarea id="s-notes" rows="6" placeholder="Private notes visible on presenter phone only">${escapeTA(s.notes||"")}</textarea>`)}</div>
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
  $$(".bgfx-chip[data-bgfx]",inspBody).forEach(c=>c.addEventListener("click",()=>{
    s.bgFx=c.dataset.bgfx;
    $$(".bgfx-chip[data-bgfx]",inspBody).forEach(x=>x.classList.remove("active"));c.classList.add("active");
    renderAll();markDirty();}));
  const notes=$("#s-notes");notes&&notes.addEventListener("input",()=>{s.notes=notes.value;renderFilmstrip();updateNotesPanel();markDirty();});
  $$(".chip[data-trans]",inspBody).forEach(c=>c.addEventListener("click",()=>{
    s.transition=c.dataset.trans;$$(".chip[data-trans]",inspBody).forEach(x=>x.classList.remove("active"));c.classList.add("active");markDirty();}));
  $("#s-dup")&&$("#s-dup").addEventListener("click",()=>{const copy=JSON.parse(JSON.stringify(s));copy.id=uid();copy.els.forEach(e=>e.id=uid());
    Deck.slides.splice(Deck.cur+1,0,copy);gotoSlide(Deck.cur+1);toast("Slide duplicated");});
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
      id:String(s.id||uid()), bg:s.bg, bgSize:s.bgSize||null, bgFx:s.bgFx||"none",
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
    slides:Deck.slides.map(s=>({bg:s.bg,bgSize:s.bgSize,bgFx:s.bgFx||"none",transition:s.transition,notes:s.notes||"",els:s.els}))};
}
async function saveDeck(silent){
  if(!SRV.saveUrl){updateSaveState("error");if(!silent)toast("Save URL is missing");return false;}
  if(saving){queuedSave=true;return false;}
  clearTimeout(saveTimer);saving=true;queuedSave=false;updateSaveState("saving");
  try{
    const r=await fetch(SRV.saveUrl,{method:"POST",
      headers:{"Content-Type":"application/json","X-CSRFToken":SRV.csrftoken||""},
      body:JSON.stringify(deckPayload())});
    if(!r.ok)throw new Error("save failed "+r.status);
    await r.json();
    updateSaveState("saved");
    if(!silent)toast("Saved");
    return true;
  }catch(err){console.error(err);updateSaveState("error");if(!silent)toast("Couldn’t save — check your connection");return false;}
  finally{saving=false;if(queuedSave){queuedSave=false;saveDeck(true);}}
}
function scheduleSave(){updateSaveState("dirty");clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveDeck(true),900);}
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

function init(){
  loadServerDeck();
  setPanelToggles();
  bindNotesPanel();
  if(slidesEl){
    slidesEl.addEventListener("wheel",e=>{ e.stopPropagation(); },{passive:true});
  }

  // rail add buttons
  $$(".rail .tool[data-add]").forEach(b=>b.addEventListener("click",()=>addElement(b.dataset.add)));
  $("#rail-tpl")?.addEventListener("click",()=>{const open=$("#drawer-tpl").classList.contains("open");open?closeDrawers():openDrawer("tpl");});
  $("#rail-bg")?.addEventListener("click",()=>{const open=$("#drawer-bg").classList.contains("open");open?closeDrawers():openDrawer("bg");});
  $("#rail-obj")?.addEventListener("click",()=>{const open=$("#drawer-obj").classList.contains("open");open?closeDrawers():openDrawer("obj");});
  $("#rail-shape")?.addEventListener("click",()=>{const open=$("#drawer-shape").classList.contains("open");open?closeDrawers():openDrawer("shape");});
  $$("[data-close-drawer]").forEach(b=>b.addEventListener("click",closeDrawers));
  $("#btn-templates")?.addEventListener("click",()=>openDrawer("tpl"));
  $("#btn-objects")?.addEventListener("click",()=>openDrawer("obj"));
  $("#btn-shapes")?.addEventListener("click",()=>openDrawer("shape"));

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

  // export
  $("#btn-export")&&$("#btn-export").addEventListener("click",()=>{$("#export-deckname").textContent=Deck.title;$("#export-modal").classList.add("on");});
  $$("[data-close-modal]").forEach(b=>b.addEventListener("click",()=>$("#export-modal").classList.remove("on")));
  $("#export-json")&&$("#export-json").addEventListener("click",()=>{exportJSON();$("#export-modal").classList.remove("on");});
  $("#export-html")&&$("#export-html").addEventListener("click",()=>{exportStandaloneHTML();$("#export-modal").classList.remove("on");});
  document.addEventListener("keydown",e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();saveDeck(false);}
  });
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&appReady)saveDeck(true);});

  // keyboard
  document.addEventListener("keydown",e=>{
    const tag=(e.target.tagName||"").toLowerCase();
    const editing=e.target.isContentEditable||tag==="input"||tag==="textarea";
    if(editing)return;
    if((e.key==="Delete"||e.key==="Backspace")&&Deck.sel){e.preventDefault();deleteEl(Deck.sel);}
    else if(e.key==="ArrowRight")gotoSlide(Deck.cur+1);
    else if(e.key==="ArrowLeft")gotoSlide(Deck.cur-1);
  });

  window.addEventListener("resize",()=>{applyZoom();renderFilmstrip();});

  buildTplGallery();buildBgGallery();buildObjGallery();buildShapeGallery();
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

if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();

})();