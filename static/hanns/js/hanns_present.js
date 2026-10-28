/* HANNS — presenter stage with full-screen mode, screen wake lock, audience QR,
   phone-controller QR, live slide sync, and animated pointer support. */
(function(){
"use strict";
const Hx = window.Hanns || {};
const {paintSlide, clamp, W = 960, H = 540} = Hx;
const CFG = window.__HANNS_PRESENT__ || {};
const DECK = CFG.deck || {slides:[], code:"------", title:"Untitled"};
/* Big Screen embed: this stage is running inside the room's Big Screen
   shell. The shell owns full screen, the wake lock and leaving; this page
   only plays the deck and reports where it is. */
const EMBED = !!CFG.embed;
function tellScreen(msg){
  if(!EMBED || window.parent === window) return;
  try{ window.parent.postMessage(Object.assign({hannsScreen:true}, msg), location.origin); }catch(e){}
}
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

/* ── Fit / transition separation ──────────────────────────────────────
   BUG (v37): fit() wrote transform:scale(z) inline on #present-canvas,
   and transition() then ran a Web Animation on the SAME node whose
   keyframes also set `transform` (slide/push/zoom/flip). The Web
   Animations API composites with "replace" by default and the animation
   used fill:"both", so the animation's final transform (e.g.
   translateX(0)) permanently replaced the inline scale(z) — the slide
   snapped back to its natural 960x540 and sat centered in the black
   stage instead of filling the screen. fade/reveal never touched
   transform, which is why only some transitions broke fullscreen.

   FIX: two nested elements with one job each.
     #present-canvas  — owns the fit scale ONLY (never animated)
     .present-anim    — owns the transition ONLY (never scaled)
   paintSlide() still receives the inner node, so element rendering,
   backgrounds and bgFx are unchanged.                                  */

let animWrap = null;
function ensureAnimWrap(){
  if(!pCanvas)return null;
  if(animWrap && animWrap.parentNode === pCanvas)return animWrap;
  animWrap = pCanvas.querySelector(":scope > .present-anim");
  if(!animWrap){
    animWrap = document.createElement("div");
    animWrap.className = "present-anim";
    while(pCanvas.firstChild) animWrap.appendChild(pCanvas.firstChild);
    pCanvas.appendChild(animWrap);
  }
  return animWrap;
}

/* ── Fit vs fill ──────────────────────────────────────────────────────
   The deck is authored in a fixed 960×540 space. Scaling it with
   Math.min() shows every slide whole, but guarantees black bars on any
   screen that is not exactly 16:9 — a 16:10 laptop loses ~45px top and
   bottom, a 4:3 projector ~96px.

   In FULLSCREEN we scale the axes independently so the slide reaches
   every edge. Stretching a 16:10 screen distorts by 11%, which nobody
   notices in a slide. Past MAX_DISTORTION we fall back to the
   proportional fit, because the alternatives on a 4:3 projector are
   both worse: stretching distorts 33% (circles become ovals) and
   cropping would silently cut 25% of the slide width, hiding whatever
   sits near the edges.

   Windowed (non-fullscreen) presenting keeps the proportional fit so
   the slide still reads as a slide inside the page chrome.            */
const MAX_DISTORTION = 0.14;

function fit(){
  if(!pCanvas)return;
  const vw = window.innerWidth, vh = window.innerHeight;
  // Inside the Big Screen the PARENT is full screen, which this document
  // cannot see — so an embedded stage always fills its frame.
  const isFull = EMBED || !!(document.fullscreenElement || document.webkitFullscreenElement);

  let sx, sy;
  if(isFull){
    sx = vw / W;
    sy = vh / H;
    const distortion = Math.max(sx, sy) / Math.min(sx, sy) - 1;
    if(distortion > MAX_DISTORTION){
      sx = sy = Math.min(sx, sy);      // too extreme — protect the layout
    }
  }else{
    sx = sy = Math.min(vw / W, vh / H);
  }

  pCanvas.style.width=W+"px";pCanvas.style.height=H+"px";
  // The outer canvas carries ONLY the fit scale. Nothing animates it.
  // Two-argument scale() so the axes can differ in fullscreen; the stage
  // still centres it, so a fallback fit stays centred as before.
  pCanvas.style.transform=`scale(${sx}, ${sy})`;
  pCanvas.style.transformOrigin="center center";
  // Expose for the magnifier, which composes with this scale.
  window.__hannsFitScale = { sx, sy, full: isFull };
  const wrap=ensureAnimWrap();
  if(wrap){wrap.style.width=W+"px";wrap.style.height=H+"px";}
}

/* Transitions now live in hanns_core.js so the live stage and the exported
   HTML run identical code — keeping two copies of the map is exactly how
   they drifted apart before. Exit effects (the hand, the shatter, the burn)
   need the OUTGOING slide, so show() captures it before repainting. */
function transition(node,kind,ghost,seed){
  if(!node)return;
  if(Hx.playTransition){ Hx.playTransition(node,kind,ghost||null,{seed:seed||1}); return; }
  // Older core: fall back to a plain fade rather than nothing at all.
  if(node.animate)node.animate([{opacity:0},{opacity:1}],{duration:420,fill:"both"});
}
/* The highest slide-clock value this screen has acted on. The server
   stamps every goto; anything at or below this has already been applied
   or superseded. */
let lastSlideSeq = 0;

function show(n,broadcast=true){
  if(!DECK.slides.length || !paintSlide || !pCanvas)return;
  keepScreenAwake("slide-change");
  i=(clamp?clamp(n,0,DECK.slides.length-1):Math.max(0,Math.min(DECK.slides.length-1,n)));
  const s=DECK.slides[i];
  // Paint into the inner wrapper and animate THAT — the outer canvas keeps
  // its fit scale untouched, so fullscreen survives every transition.
  const wrap=ensureAnimWrap()||pCanvas;
  // A new slide starts with its cue-held elements hidden again, matching
  // the consumer, which clears the revealed set on every goto.
  revealedNow.clear();
  focusNow=null;
  // Only the theatrical EXIT transitions need a copy of the outgoing slide.
  // Normal fade/slide/push/zoom/flip/reveal transitions animate the incoming
  // slide only. Cloning a 960x540 DOM tree containing a full-frame photo on
  // every command was unnecessary work and could make image-heavy decks feel
  // unresponsive on projectors and lower-powered laptops.
  const kind=(s&&s.transition)||"fade";
  const needsGhost=new Set([
    "paper_grab","paper_pull","shatter","burn","wind",
    "curtain","fold","dissolve","swipe"
  ]).has(kind);
  const ghost=(needsGhost&&Hx.captureSlide)?Hx.captureSlide(wrap):null;
  paintSlide(wrap,s,{live:true});
  transition(wrap,kind,ghost,i+1);
  scheduleDecodeAhead(i);
  const pos=$("#pp-pos");if(pos)pos.textContent=`${i+1} / ${DECK.slides.length}`;
  if(broadcast&&!suppressBroadcast)Live.goto(i);
  tellScreen({type:"slide", index:i, total:DECK.slides.length});
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
// Some projectors and TVs report the pre-fullscreen viewport for a frame
// or two, which would leave the slide sized for the old window. Re-measure
// once things settle. Safari/iOS still needs the webkit-prefixed event.
document.addEventListener("fullscreenchange",()=>{setTimeout(fit,60);setTimeout(fit,400);});
document.addEventListener("webkitfullscreenchange",()=>{updateFullscreenButton();fit();setTimeout(fit,60);setTimeout(fit,400);});

/* ── reveal-on-cue ────────────────────────────────────────────────────
   Elements authored with revealOn:"cue" are painted by paintSlide() but
   held at opacity 0. The phone controller sends {type:"reveal", ids:[…]}
   and they enter here with their own entrance animation, count-up and
   fill sweep — identical to how they would have arrived on entry.

   `revealedNow` mirrors what the server believes is showing on this
   slide, so a reconnect snapshot can restore the same state WITHOUT
   replaying every entrance in front of the room.                       */
let revealedNow = new Set();

function elNodeById(id){
  const wrap = ensureAnimWrap() || pCanvas;
  if(!wrap || id == null) return null;
  return wrap.querySelector(`.el[data-id="${String(id).replace(/["\\]/g,"\\$&")}"]`);
}
function slideElById(id){
  const s = DECK.slides[i] || {};
  return ((s.els) || []).find(e => e && e.id === id) || null;
}
function applyReveal(ids, hide, instant){
  const Hh = window.Hanns || {};
  if(!Hh.revealElement || !Array.isArray(ids)) return;
  ids.forEach(id => {
    const node = elNodeById(id);
    if(!node) return;
    Hh.revealElement(node, slideElById(id), {hide: !!hide, instant: !!instant});
    if(hide) revealedNow.delete(id); else revealedNow.add(id);
  });
}
/* After a repaint or a reconnect: put back what was already on screen,
   with no animation, so nothing replays mid-sentence. */
function restoreRevealed(){
  if(!revealedNow.size) return;
  applyReveal([...revealedNow], false, true);
}
/* Play a one-off actor action triggered from the phone controller. This
   is the same path as clicking the character on the stage. */
/* ── liquids driven from the phone ────────────────────────────────────
   The controller sends {elId, action, value}; the stage finds the live
   canvas instance and asks it to do the thing. Nothing is re-rendered,
   so a level change pours rather than snapping. */
function applyFluidCue(m){
  const node = elNodeById(m.elId);
  const wrap = node && node.querySelector(".fluid-obj");
  const f = wrap && wrap._fluid;
  if(!f || !f.remote) return;
  f.remote(m.action, m.value);
}

/* ── background prefetch ──────────────────────────────────────────────
   The deck itself is already in memory — CFG.deck carries every slide.
   What is not local is the media those slides point at, and a projector
   that loses the venue wifi mid-talk will render slide 12 as a grey box.

   So once the first slide is up and the machine is otherwise idle, walk
   the rest of the deck and pull every image through the browser cache,
   nearest slides first. It is deliberately unhurried: one at a time, so
   it can never compete with the slide the room is actually looking at. */
function scheduleIdle(fn, timeoutMs){
  const ms=Math.max(0, Number(timeoutMs)||0);
  if(typeof window.requestIdleCallback === "function"){
    // requestIdleCallback(callback, options) — Firefox rejects a number as
    // the second argument. `timeout` guarantees the job still runs even when
    // the browser never becomes truly idle. If an older/quirky implementation
    // still rejects the call, fall back without breaking presenter startup.
    try{return window.requestIdleCallback(fn, {timeout: ms});}
    catch(err){console.warn("[hanns] requestIdleCallback unavailable; using setTimeout", err);}
  }
  return window.setTimeout(fn, ms);
}

/* ── decode-ahead ─────────────────────────────────────────────────────
   Measured on the big screen: moving to a photo slide spent ~0 ms in
   script but ~145 ms DECODING the photo and ~230 ms rasterising it, all
   inside the frame that should have shown the new slide — the hitch you
   see at every slide change. prefetchDeckMedia() below only puts bytes in
   the HTTP cache; decoding still happened on arrival.

   So keep the slides around the current one (next, the one after, and the
   previous) fetched AND decoded ahead of time, holding the decoded images
   so the browser keeps them. It runs once the transition has finished, so
   it never competes with the slide the room is watching, and it only holds
   a small window — a 60-photo deck isn't kept decoded in memory.        */
const AHEAD = [1, 2, -1];                  // which neighbours to have ready (in this order)
const aheadHeld = new Map();               // url → decoded HTMLImageElement
let aheadTimer = null;
function slideMediaUrls(slide){
  const out = [], seen = new Set();
  const add = v => {
    v = String(v || "").trim();
    if(!v || seen.has(v) || v.slice(0,5) === "data:" || v.slice(0,5) === "blob:") return;
    seen.add(v); out.push(v);
  };
  const isImg = v => /^(https?:|\/)/.test(v) &&
    (/\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(v) || v.indexOf("/media/") >= 0);
  const walk = (o, depth)=>{
    if(!o || depth > 6) return;
    if(typeof o === "string"){
      if(isImg(o)) add(o);
      else if(o.indexOf("url(") >= 0){          // CSS backgrounds: url("…") center/cover
        o.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (_, q, u)=>{ if(isImg(u)) add(u); return _; });
      }
      return;
    }
    if(Array.isArray(o)){ o.forEach(x=>walk(x, depth+1)); return; }
    if(typeof o === "object"){ for(const k in o) walk(o[k], depth+1); }
  };
  walk(slide, 0);
  return out;
}
/* ── screen-sized renditions ──────────────────────────────────────────
   A 3000-px photo on a 1920-px projector is decoded and scaled down on
   every arrival. A worker makes a copy at this screen's size, off the main
   thread, while the speaker talks; the stage then paints the copy (fewer
   bytes, ~⅓ the pixels to decode and rasterise).
   Deliberately narrow, so nothing can look different:
     • JPEG only — no PNG/GIF/SVG/WebP, so transparency and animation are
       never touched; and only when the photo is clearly bigger than the screen
     • same-origin or CORS-readable images only; anything else stays as is
     • a copy is used for the NEXT paint only — the slide that's up is never
       repainted — and the magnifier / zoom regions put the originals back
   No Worker / OffscreenCanvas / createImageBitmap → everything as before. */
const RENDITION_OK = typeof Worker === "function" && typeof OffscreenCanvas === "function" &&
  typeof createImageBitmap === "function" && typeof URL.createObjectURL === "function" && !!Hx.setMediaRendition;
const renditions = new Map();      // raw url → blob: url | "skip" | Promise (in flight)
let renditionWorker = null, renditionSeq = 0;
const renditionWaiters = new Map();
const isJpeg = u => /\.jpe?g(\?|#|$)/i.test(u);
function renditionTarget(){
  // the stage's pixel size: the fit scale × device pixels, long side
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = Math.max(window.innerWidth || 1920, window.innerHeight || 1080) * dpr;
  return Math.round(Math.max(1280, Math.min(2560, px)));
}
function startRenditionWorker(){
  if(renditionWorker || !RENDITION_OK) return renditionWorker;
  const code = `self.onmessage = async e => {
    const { id, url, max } = e.data;
    try{
      const r = await fetch(url, { credentials: "same-origin" });
      if(!r.ok) throw 0;
      const blob = await r.blob();
      if(!/^image\\/jpe?g$/i.test(blob.type)) throw 0;
      // the size, from the JPEG header — without decoding the whole photo
      const b = new Uint8Array(await blob.slice(0, 262144).arrayBuffer());
      let w = 0, h = 0;
      for(let p = 2; p + 9 < b.length;){
        if(b[p] !== 0xFF){ p++; continue; }
        const m = b[p + 1], len = (b[p + 2] << 8) | b[p + 3];
        if(m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC){ h = (b[p + 5] << 8) | b[p + 6]; w = (b[p + 7] << 8) | b[p + 8]; break; }
        p += 2 + len;
      }
      if(!w || !h || Math.max(w, h) <= max * 1.2) throw 0;      // unknown, or already about screen-sized
      // Width only, so the aspect ratio is kept by construction (EXIF rotation
      // can't stretch it); decoding straight to size is far cheaper than
      // decoding 3000 px and shrinking afterwards.
      const k = max / Math.max(w, h);
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image",
                                                  resizeWidth: Math.max(1, Math.round(w * k)), resizeQuality: "high" });
      const tw = bmp.width, th = bmp.height;
      if(Math.max(tw, th) < max * 0.5){ bmp.close(); throw 0; } // came out oddly small: keep the original
      const c = new OffscreenCanvas(tw, th);
      c.getContext("2d").drawImage(bmp, 0, 0); bmp.close();
      const out = await c.convertToBlob({ type: "image/jpeg", quality: 0.9 });
      self.postMessage({ id, blob: out });
    }catch(_){ self.postMessage({ id, blob: null }); }
  };`;
  try{
    startRenditionWorker.src = startRenditionWorker.src || URL.createObjectURL(new Blob([code], {type: "text/javascript"}));
    renditionWorker = new Worker(startRenditionWorker.src);
    renditionWorker.onmessage = e => { const w = renditionWaiters.get(e.data.id); if(w){ renditionWaiters.delete(e.data.id); w(e.data.blob); } };
    renditionWorker.onerror = () => {               // a crashed worker must not stall the queue
      const job = renditionJob;
      renditionWorker = null; renditionBusy = false; renditionJob = null; renditionWaiters.clear();
      if(job) job.done(null);
      pumpRenditions();
    };
  }catch(_){ renditionWorker = null; }
  return renditionWorker;
}
/* One photo at a time, nearest slides first, and only when the page is
   idle — several decodes at once fought the transitions for the CPU. */
const renditionQueue = [];
let renditionBusy = false, renditionHoldUntil = 0, renditionHoldTimer = null, renditionJob = null;
/* A slide change is on: the worker yields to the room. The trace showed a
   conversion still running when Next was pressed (its JPEG encode took the
   CPU the transition needed). So stop the worker on the spot — the photo
   goes back to the front of the queue — and start again only once the
   slide has been up for a moment. */
function holdRenditions(ms){
  renditionHoldUntil = Math.max(renditionHoldUntil, performance.now() + ms);
  if(renditionBusy){
    if(renditionWorker){ try{ renditionWorker.terminate(); }catch(_){} }
    renditionWorker = null;
    renditionWaiters.clear();
    renditionBusy = false;
    if(renditionJob){ renditionQueue.unshift(renditionJob); renditionJob = null; }
  }
}
/* Bytes the stage already has. The worker only converts these, so it never
   adds network traffic next to what the room is waiting for. */
const mediaFetched = new Set();
function warmBytes(u){                  // fetch into the HTTP cache, don't decode
  if(mediaFetched.has(u) || warmBytes.inflight.has(u)) return;
  const im = new Image();
  warmBytes.inflight.set(u, im);
  im.onload = im.onerror = ()=>{ warmBytes.inflight.delete(u); mediaFetched.add(u); pumpRenditions(); };
  im.src = u;
}
warmBytes.inflight = new Map();
function pumpRenditions(){
  if(renditionBusy || !renditionQueue.length) return;
  const wait = renditionHoldUntil - performance.now();
  if(wait > 0){ clearTimeout(renditionHoldTimer); renditionHoldTimer = setTimeout(pumpRenditions, wait + 20); return; }
  const k = renditionQueue.findIndex(j=>mediaFetched.has(j.raw));
  if(k < 0){ clearTimeout(renditionHoldTimer); renditionHoldTimer = setTimeout(pumpRenditions, 500); return; }
  renditionBusy = true;
  const job = renditionJob = renditionQueue.splice(k, 1)[0];
  scheduleIdle(()=>{
    if(renditionJob !== job) return;               // stopped by a slide change meanwhile
    if(!startRenditionWorker()){ renditionBusy = false; renditionJob = null; job.done(null); return; }
    const id = ++renditionSeq;
    renditionWaiters.set(id, blob=>{ renditionBusy = false; renditionJob = null; job.done(blob); pumpRenditions(); });
    try{ renditionWorker.postMessage({ id, url: new URL(job.raw, location.href).href, max: renditionTarget() }); }
    catch(_){ renditionWaiters.delete(id); renditionBusy = false; renditionJob = null; job.done(null); pumpRenditions(); }
  }, 600);
}
function rendition(raw, urgent){
  const have = renditions.get(raw);
  if(have){
    // already queued: an urgent ask (a neighbour) moves it to the front
    if(urgent && typeof have.then === "function"){
      const k = renditionQueue.findIndex(j=>j.raw === raw);
      if(k > 0) renditionQueue.unshift(renditionQueue.splice(k, 1)[0]);
    }
    return have;                                          // a blob: url, "skip", or the promise
  }
  if(!RENDITION_OK || !isJpeg(raw) || !startRenditionWorker()){ renditions.set(raw, "skip"); return "skip"; }
  const p = new Promise(resolve => {
    const job = { raw, done: blob=>{
      if(blob && blob.size){
        const url = URL.createObjectURL(blob);
        renditions.set(raw, url);
        Hx.setMediaRendition(raw, url);                    // used from the next paint on
        resolve(url);
      }else{ renditions.set(raw, "skip"); resolve("skip"); }
    }};
    if(urgent) renditionQueue.unshift(job); else renditionQueue.push(job);
  });
  renditions.set(raw, p);
  pumpRenditions();
  return p;
}
/* Magnifier / zoom region: put the full-resolution originals back on the
   slide that's up (the copies are screen-sized, a zoom is not). */
function restoreFullRes(){
  const wrap = ensureAnimWrap() || pCanvas;
  if(!wrap) return;
  wrap.querySelectorAll("[data-full-src]").forEach(b=>{
    b.style.backgroundImage = `url("${b.dataset.fullSrc}")`;
    delete b.dataset.fullSrc;
  });
}
window.__hannsFullRes = restoreFullRes;

function holdDecoded(u){
  if(aheadHeld.has(u)) return;
  const img = new Image();
  img.decoding = "async";
  img.src = u;
  aheadHeld.set(u, img);
  if(img.decode) img.decode().catch(()=>{});    // a 404 or a blocked host just stays undecoded
}
function decodeAhead(at){
  if(!DECK || !Array.isArray(DECK.slides)) return;
  const raw = Hx.mediaSrcRaw || Hx.mediaSrc || (u=>u);
  const want = [];
  AHEAD.forEach(d=>{ const sl = DECK.slides[at + d]; if(sl) slideMediaUrls(sl).forEach(u=>want.push(raw(u))); });
  // what will actually be painted: the screen-sized copy when there is one
  const painted = u => { const r = renditions.get(u); return typeof r === "string" && r !== "skip" ? r : u; };
  const keep = new Set(want.map(painted));
  // let go of what fell out of the window, so memory stays flat on long decks
  for(const u of aheadHeld.keys()) if(!keep.has(u)) aheadHeld.delete(u);
  want.forEach(u=>{
    const r = rendition(u, true);
    if(r && typeof r.then === "function"){
      warmBytes(u);                         // the next slides' bytes come in now, as before
      // A copy is on its way. Don't pre-decode the original meanwhile: the
      // trace showed an <img> decode is at full size, the slide paints it
      // scaled, so Chrome decodes it again anyway — it only added CPU load
      // next to the transition. The bytes are already in the HTTP cache.
      r.then(url=>{
        if(Math.abs(i - at) > 2) return;
        holdDecoded(url === "skip" ? u : url);
      });
    }else holdDecoded(painted(u));
  });
  // then, quietly, the rest of the deck — nearest first — so every slide
  // has its copy by the time the talk reaches it
  if(!decodeAhead.queuedAll){
    decodeAhead.queuedAll = true;
    // forward first (that's where a talk goes), the slide that's up last
    const rank = k => k === at ? 1e6 : (k > at ? (k - at) * 2 - 1 : (at - k) * 2);
    DECK.slides.map((sl, k)=>({sl, k})).sort((a, b)=>rank(a.k) - rank(b.k))
      .forEach(o=>slideMediaUrls(o.sl).forEach(u=>rendition(raw(u), false)));
  }
}
function scheduleDecodeAhead(at){
  clearTimeout(aheadTimer);
  // after the incoming transition, so it never steals frames from it
  const s = DECK.slides[at], kind = (s && s.transition) || "fade";
  const dur = (Hx.TRANSITION_DUR && Hx.TRANSITION_DUR[kind]) || 700;
  holdRenditions(Number(dur) + 1200);
  aheadTimer = setTimeout(()=>{
    try{ decodeAhead(at); }catch(err){ console.warn("[hanns] decode-ahead skipped", err); }
  }, Math.min(1500, Number(dur) + 80));
}

function prefetchDeckMedia(){
  if(!DECK || !Array.isArray(DECK.slides)) return;
  const urls = [], seen = new Set();
  const collect = (v)=>{
    if(typeof v!=="string" || v.length<5 || seen.has(v)) return;
    if(!/^(https?:|\/|data:image)/.test(v)) return;
    if(v.slice(0,5)==="data:") return;              // already inline
    if(!/\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(v) && v.indexOf("/media/")<0) return;
    seen.add(v); urls.push(v);
  };
  const walk = (o, depth)=>{
    if(!o || depth>6) return;
    if(Array.isArray(o)){ o.forEach(x=>walk(x,depth+1)); return; }
    if(typeof o==="object"){
      for(const k in o){
        const v=o[k];
        if(typeof v==="string") collect(v);
        else walk(v, depth+1);
      }
      return;
    }
  };
  // nearest slides first — the ones most likely to be needed next
  const order = DECK.slides.map((s,idx)=>({s,idx}))
    .sort((a,b)=>Math.abs(a.idx-i)-Math.abs(b.idx-i));
  order.forEach(o=>walk(o.s,0));
  if(!urls.length) return;

  let n = 0;
  const pull = ()=>{
    if(n>=urls.length) return;
    const url = urls[n++];
    const img = new Image();
    img.decoding = "async";
    const done = (Hx.mediaSrcRaw || (u=>u))(url);
    const next = ()=>{ mediaFetched.add(done); pumpRenditions(); scheduleIdle(pull, 120); };
    img.onload = next;
    img.onerror = next;      // a 404 must not stall the queue
    img.src = url;
  };
  scheduleIdle(pull, 400);
}

function playActorFromCue(elId, action){
  const AC = window.HannsActors;
  if(!AC) return;
  const node = elNodeById(elId);
  const actor = node && node.querySelector(".actor");
  if(actor) AC.playActorOnce(actor, action || "idle", 1500);
}

/* ── zoom regions ─────────────────────────────────────────────────────
   The author marks a region in the editor; the phone taps it in here.
   The callout is painted INTO the same wrapper the slide lives in, so it
   inherits the stage's fit scale, the fullscreen stretch and any
   controller magnification without a line of extra maths.

   Only one region is up at a time and it never survives a slide change —
   both rules are enforced by the consumer as well, so a second presenter
   screen sees exactly the same thing.                                    */
let focusNow = null;

function stageWrap(){ return ensureAnimWrap() || pCanvas; }

function focusElById(id){
  const s = DECK.slides[i] || {};
  return ((s.els) || []).find(e => e && e.type === "focus" && e.id === id) || null;
}
function applyFocus(elId, off, index){
  if(!off) restoreFullRes();                 // a callout enlarges: use the originals
  const Hh = window.Hanns || {};
  const wrap = stageWrap();
  if(!wrap || !Hh.showFocus) return;
  // The cue names the slide it was authored on. If this screen has moved
  // on since the phone drew its panel, magnifying a region from a slide
  // nobody is looking at is worse than doing nothing.
  if(index != null && Number(index) !== i) return;
  if(off || !elId){
    Hh.hideFocus(wrap);
    focusNow = null;
    return;
  }
  const el = focusElById(elId);
  if(!el) return;
  Hh.showFocus(wrap, el);
  focusNow = elId;
}
function clearFocus(){
  const Hh = window.Hanns || {};
  const wrap = stageWrap();
  if(wrap && Hh.hideFocus) Hh.hideFocus(wrap, {instant:true});
  focusNow = null;
}
/* Keyboard equivalent for a presenter driving from the laptop: Z steps
   through this slide's regions and then back to the plain slide. The tap
   goes through the socket like the phone's would, so the controller's
   panel stays in step. */
function cycleFocus(){
  const s = DECK.slides[i] || {};
  const regions = ((s.els) || []).filter(e => e && e.type === "focus" && e.id);
  if(!regions.length) return;
  const at = regions.findIndex(r => r.id === focusNow);
  const next = regions[at + 1] || null;
  Live.focus(next ? next.id : "", !next);
}

/* ── live socket ──────────────────────────────────────────────────────
   Two failures used to cost a talk, and both are handled here.

   1. A HALF-OPEN socket. nginx cuts an idle proxied WebSocket at 60s by
      default and CDNs are similar. No close frame reaches the browser, so
      readyState stays OPEN(1): the phone still shows "connected", every
      send() succeeds, and nothing happens. Only a refresh cleared it.
      readyState cannot be trusted on its own, so we ping and watch for
      traffic coming back; if the socket has gone quiet for STALE_MS we
      close it ourselves and reconnect.

   2. GIVING UP. Retries stopped after six attempts, permanently. A laptop
      asleep between rehearsal and the talk woke with a dead socket and no
      route back. The backoff is now capped rather than counted, and a
      reconnect is attempted the moment the tab is shown or the network
      returns.

   Each socket carries a generation number. A close arriving from a socket
   we have already replaced is ignored, so a reconnect cannot race with the
   old socket's close handler and open two connections at once.           */
/* A big screen's paired slide remote has the slides (hanns/remote.py):
   say so on this presenter screen instead of silently bouncing the keys. */
function remoteLockNote(screen,on){
  let n=document.getElementById("hanns-remote-lock");
  if(!n){
    n=document.createElement("div"); n.id="hanns-remote-lock"; n.setAttribute("role","status");
    n.style.cssText="position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:9999;padding:10px 16px;border-radius:999px;"+
      "background:rgba(12,10,20,.92);color:#fde68a;border:1px solid rgba(251,191,36,.5);font:600 14px/1.3 system-ui,sans-serif;"+
      "box-shadow:0 10px 30px rgba(0,0,0,.5);transition:opacity .3s;pointer-events:none";
    document.body.appendChild(n);
  }
  n.textContent=on?`🔒 ${screen||"The big screen"}'s slide remote is driving — your keys follow the room.`:"🔓 The slide remote let go — you can drive again.";
  n.style.opacity="1";
  clearTimeout(remoteLockNote.t);
  remoteLockNote.t=setTimeout(()=>{n.style.opacity="0";},on?5000:3000);
}
const HEARTBEAT_MS=20000, STALE_MS=50000;
const Live={
  sock:null, retry:0, gen:0, lastRx:0, timer:null, closed:false,
  start(){
    if(!CFG.wsUrl)return;
    this.closed=false;
    const gen=++this.gen;
    let sock;
    try{ sock=new WebSocket(CFG.wsUrl); }catch(e){ this.scheduleRetry(gen); return; }
    this.sock=sock;
    sock.addEventListener("open",()=>{
      if(gen!==this.gen)return;
      this.retry=0; this.lastRx=Date.now();
      // On a big screen, say which one: a paired slide remote's lock still
      // lets the screen's own stage resync (hanns/remote.py).
      this.send(EMBED && CFG.screenToken
        ? {type:"presenter_hello", screen:CFG.screenToken, share:CFG.screenShare}
        : {type:"presenter_hello"});
      // The stage is the source of truth for where the talk is. If the
      // socket was down while the presenter drove with the keyboard, the
      // server's stored slide is stale — so say where we actually are
      // instead of waiting to be told, and let the room catch up to us.
      this.send({type:"goto", index:i, resync:true});
      keepScreenAwake("websocket-open");
      this.beat();
    });
    sock.addEventListener("message",ev=>{
      if(gen!==this.gen)return;
      this.lastRx=Date.now();
      let m; try{ m=JSON.parse(ev.data);}catch(e){return;}
      if(m.type==="ping"){ this.send({type:"pong"}); return; }
      if(m.type==="pong") return;
      if(m.type==="reaction"){spawnEmoji(m.emoji);if(m.reaction_counts)renderReactionCounts(m.reaction_counts);else incrementReactionCount(m.emoji);}else if(m.type==="participants")setCount(m.count);else if(m.type==="state"){if(typeof m.seq==="number"&&m.seq>lastSlideSeq)lastSlideSeq=m.seq;if(typeof m.count==="number")setCount(m.count);if(m.reaction_counts)renderReactionCounts(m.reaction_counts);if(Array.isArray(m.revealed)){revealedNow=new Set(m.revealed);restoreRevealed();}if(m.focus)setTimeout(()=>applyFocus(m.focus,false),60);}else if(m.type==="reveal"){keepScreenAwake("cue-reveal");applyReveal(m.ids,m.hide,false);}else if(m.type==="focus"){keepScreenAwake("zoom-region");applyFocus(m.elId,m.off,m.index);}else if(m.type==="actor_action"){keepScreenAwake("actor-cue");playActorFromCue(m.elId,m.action);}else if(m.type==="goto"&&typeof m.index==="number"){
        keepScreenAwake("phone-controller");
        // Ignore anything older than the last move we applied. Without this
        // a goto that was queued behind a dead socket can land after the
        // presenter has moved on and drag the room backwards.
        if(typeof m.seq==="number"){
          if(m.seq<=lastSlideSeq) return;
          lastSlideSeq=m.seq;
        }
        // Our own resync echo: we are already there, so do not repaint and
        // do not wipe the cues that are currently up.
        if(m.resync && m.index===i) return;
        if(m.index!==i){suppressBroadcast=true;show(m.index,false);suppressBroadcast=false;}
      }else if(m.type==="fluid"){keepScreenAwake("fluid-cue");applyFluidCue(m);}else if(m.type==="pointer"){showPointer(m.x,m.y);}
      else if(m.type==="controller_locked"&&!EMBED){remoteLockNote(m.screen,true);}
      else if(m.type==="controller_unlocked"&&!EMBED){remoteLockNote("",false);}
    });
    sock.addEventListener("close",()=>{
      if(gen!==this.gen)return;              // superseded by a reconnect
      this.idle();
      if(!this.closed)this.scheduleRetry(gen);
    });
    sock.addEventListener("error",()=>{ try{sock.close();}catch(e){} });
  },
  scheduleRetry(gen){
    if(gen!==undefined&&gen!==this.gen)return;
    this.retry++;
    // Capped, never abandoned — a presentation can outlast any outage.
    setTimeout(()=>{ if(!this.closed)this.start(); },Math.min(1000*this.retry,15000));
  },
  beat(){
    this.idle();
    this.timer=setInterval(()=>{
      if(!this.sock||this.sock.readyState!==1)return;
      if(this.lastRx&&Date.now()-this.lastRx>STALE_MS){ this.revive(); return; }
      this.send({type:"ping"});
    },HEARTBEAT_MS);
  },
  idle(){ if(this.timer){clearInterval(this.timer);this.timer=null;} },
  revive(){
    // Drop the socket we no longer trust and build a fresh one. Bumping the
    // generation in start() makes the old close handler a no-op.
    this.idle();
    const dead=this.sock; this.sock=null;
    if(dead){ try{dead.close();}catch(e){} }
    this.retry=0;
    this.start();
  },
  healthy(){ return !!this.sock && this.sock.readyState===1 &&
    (!this.lastRx || Date.now()-this.lastRx<STALE_MS); },
  send(o){
    if(this.sock&&this.sock.readyState===1){
      try{ this.sock.send(JSON.stringify(o)); }
      catch(e){ this.revive(); }
    }
  },
  goto(idx){this.send({type:"goto",index:idx});},
  focus(elId,off){this.send({type:"focus",index:i,elId:elId||"",off:!!off});},
  stop(){ this.closed=true; this.gen++; this.idle();
    if(this.sock){try{this.sock.close();}catch(e){}} this.sock=null; }
};
/* Waking from sleep, regaining Wi-Fi or switching back to the tab are the
   moments a socket is most likely to be dead-but-open. Check on each. */
(function watchLiveness(){
  const check=()=>{ if(!Live.closed && CFG.wsUrl && !Live.healthy()) Live.revive(); };
  window.addEventListener("online",check);
  window.addEventListener("focus",check);
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden)check(); });
})();
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
// Shared with the end-of-show download card so every QR on the stage is
// generated the same way.
window.makeQR = makeQR;
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
/* ── Ending the presentation ──────────────────────────────────────────
   Previously this jumped straight back to the editor. That gave the room
   no chance to save the deck, so when audience downloads are enabled we
   now mark the deck ended, put the download QR on the big screen, and
   only return to the editor when the presenter dismisses it. With
   downloads off the behaviour is unchanged: end and leave.            */
async function endPresent(){
  if(EMBED){
    // Never flips the deck's state from here — the screen may not even be
    // signed in. Show the download card if the owner allows it, otherwise
    // hand the room straight back to the Big Screen lobby.
    let showed=false;
    try{ if(typeof window.__hannsShowEndShare==="function") showed=window.__hannsShowEndShare(); }catch(e){}
    if(!showed) tellScreen({type:"ended"});
    return;
  }
  await releaseWakeLock();
  if(CFG.stateUrl){
    try{
      await fetch(CFG.stateUrl,{method:"POST",
        headers:{"Content-Type":"application/x-www-form-urlencoded","X-CSRFToken":CFG.csrftoken||""},
        body:"state=ended"});
    }catch(e){}
  }
  // Ask the shared overlay whether it has a QR to show. It returns true
  // when it took over the screen; the socket stays open so a phone
  // controller still sees the ended state.
  var showed = false;
  try{
    if(typeof window.__hannsShowEndShare === "function"){
      showed = window.__hannsShowEndShare();
    }
  }catch(e){}
  if(showed){
    // Leaving is now the presenter's call — the overlay's Close button
    // (and Esc) call finishPresent().
    return;
  }
  Live.stop();
  if(CFG.editUrl)window.location.href=CFG.editUrl;
}

/* Leave for real — used by the end-of-show overlay's Close button. */
function finishPresent(){
  if(EMBED){ tellScreen({type:"ended"}); return; }
  Live.stop();
  if(CFG.editUrl)window.location.href=CFG.editUrl;
}
window.__hannsFinishPresent = finishPresent;

/* The phone controller ended the show: the consumer already flipped the
   deck to "ended", so the stage only needs to release the wake lock. The
   socket stays open so the controller still gets state, and the presenter
   leaves via the overlay's Close button. */
window.__hannsStandDown = function(){
  try{ releaseWakeLock(); }catch(e){}
};
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
  // Only once the first slide is actually up — the opening frame is the
  // one moment in a talk where nothing else may compete for bandwidth.
  try{prefetchDeckMedia();}
  catch(err){console.warn("[hanns] media prefetch skipped; presentation remains active", err);}
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
  if(EMBED){
    // Keys typed while the frame has focus: slides stay here, everything
    // that belongs to the room (full screen, the queue) goes to the shell.
    document.addEventListener("keydown",e=>{
      const k=e.key;
      if(k==="ArrowRight"||k===" "||k==="PageDown"){show(i+1);e.preventDefault();}
      else if(k==="ArrowLeft"||k==="PageUp"){show(i-1);e.preventDefault();}
      else if(k.toLowerCase()==="z"){cycleFocus();e.preventDefault();}
      else if(k==="Escape"||["f","q","l"].includes(k.toLowerCase())){tellScreen({type:"key",key:k});e.preventDefault();}
    });
    // Mouse movement over the slide lands in THIS document, not the
    // shell's, so tell the shell — that is what wakes its queue arrow.
    let lastAct=0;
    ["pointermove","pointerdown","touchstart","wheel"].forEach(ev=>document.addEventListener(ev,()=>{
      const now=Date.now(); if(now-lastAct<350)return; lastAct=now; tellScreen({type:"activity"});
    },{passive:true}));
    // And keys the shell forwards when IT has focus.
    window.addEventListener("message",ev=>{
      if(ev.origin!==location.origin||!ev.data||!ev.data.hannsScreenCmd)return;
      const d=ev.data;
      if(d.hannsScreenCmd==="next")show(i+1);
      else if(d.hannsScreenCmd==="prev")show(i-1);
      else if(d.hannsScreenCmd==="zoom")cycleFocus();
      else if(d.hannsScreenCmd==="refit")fit();
    });
  }else{
  document.addEventListener("keydown",e=>{if(e.key==="Escape"){if(document.querySelector(".present-modal.on"))closeModals();else endPresent();}else if(e.key.toLowerCase()==="c")openModal("#controller-modal");else if(e.key.toLowerCase()==="f")toggleFullscreen();else if(e.key.toLowerCase()==="z"){cycleFocus();e.preventDefault();}else if(e.key==="ArrowRight"||e.key===" ")show(i+1);else if(e.key==="ArrowLeft")show(i-1);});
  // Arriving from "Present & take control" (Big Screen share card): open
  // the phone-controller QR straight away so the presenter can scan it.
  try{ if(new URLSearchParams(location.search).get("controller")==="1") setTimeout(()=>openModal("#controller-modal"),350); }catch(e){}
  }
  window.addEventListener("beforeunload",()=>{Live.stop();releaseWakeLock();});
  updateFullscreenButton();
  tellScreen({type:"ready", index:i, total:DECK.slides.length, title:DECK.title});
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
