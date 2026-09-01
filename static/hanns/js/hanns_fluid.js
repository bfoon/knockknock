/* ════════════════════════════════════════════════════════════════════
   HANNS FLUID — realistic liquid objects
   ────────────────────────────────────────────────────────────────────
   A purely ADDITIVE module, built to the same contract as
   hanns_studio.js. It does not modify hanns_core.js or hanns_editor.js;
   it registers into the extension points they already expose:

     • window.HannsActors.isActor / renderActor
         renderObject() consults these AT RENDER TIME, so a module loaded
         after core can own entirely new object kinds. The previous
         HannsActors (core's farm characters, then studio's data objects)
         is kept and delegated to, so the chain composes.
     • window.Hanns.OBJECTS
         The editor destructures the same array reference at load and
         reads it when it builds the Objects drawer, so pushing works.
     • window.Hanns.makeObject
         Wrapped so a freshly dropped liquid arrives filled and labelled.
     • #insp-body
         Re-rendered with innerHTML on every selection change. A
         MutationObserver appends the Liquid panels afterwards.

   LOAD ORDER (editor.html and present.html):
       hanns_actors.js
       hanns_core.js
       hanns_studio.js
       hanns_fluid.js      ← this file
       hanns_editor.js

   WHAT IT ADDS
     6 liquid objects   full bleed, glass, bottle, droplet, heart, circle
     A real surface     32–220 coupled springs stepped at a fixed 120 Hz.
                        Falling droplets punch a velocity well into the
                        surface; neighbours trade momentum, so the dent
                        travels outward as a ripple rather than sinking
                        in place. Spray, foam rings, entrained bubbles.
     Level physics      changes ride a critically damped spring, and
                        droplets pour for the duration, so a refill reads
                        as caused by the pouring rather than tweened.
     A live readout     counts off the actual level, never its own timer.

   The engine also runs standalone, outside the studio:
       const f = HannsFluid.mount(canvasEl, {level:0, accent:"#22b8f0"});
       f.setLevel(75);
   ════════════════════════════════════════════════════════════════════ */
(function () {
"use strict";

/* ════════════════════════════════════════════════════════════════════
   1. SHAPE MASKS — authored in the 100×140 box core's vessels use
   ════════════════════════════════════════════════════════════════════ */
const SHAPES = {
  rect:    null,   // full bleed
  round:   "M8 2 H92 A6 6 0 0 1 98 8 V132 A6 6 0 0 1 92 138 H8 A6 6 0 0 1 2 132 V8 A6 6 0 0 1 8 2 Z",
  glass:   "M21 6 H79 L72 133 A3 3 0 0 1 69 136 H31 A3 3 0 0 1 28 133 Z",
  bottle:  "M42 4 H58 V26 L74 52 A18 18 0 0 1 78 64 V126 A10 10 0 0 1 68 136 H32 A10 10 0 0 1 22 126 V64 A18 18 0 0 1 26 52 L42 26 Z",
  droplet: "M50 4 C74 46 86 68 86 90 A36 36 0 0 1 14 90 C14 68 26 46 50 4 Z",
  heart:   "M50 132 C14 104 6 78 6 56 A28 28 0 0 1 50 34 A28 28 0 0 1 94 56 C94 78 86 104 50 132 Z",
  circle:  "M50 6 A64 64 0 1 1 49.9 6 Z",
};
const SHAPE_LABELS = [
  {v:"auto",    l:"Match the object"},
  {v:"rect",    l:"Full bleed"},
  {v:"round",   l:"Rounded panel"},
  {v:"glass",   l:"Glass"},
  {v:"bottle",  l:"Bottle"},
  {v:"droplet", l:"Droplet"},
  {v:"heart",   l:"Heart"},
  {v:"circle",  l:"Circle"},
];

/* ════════════════════════════════════════════════════════════════════
   2. OBJECT DEFINITIONS
   No `shape` key: renderObject() checks `d.shape && VESSEL_PATHS[d.shape]`
   BEFORE it asks HannsActors, so a def carrying one would be intercepted
   by the old static vessel renderer. `fill:true` is wanted — it is what
   makes the editor show the Number position / Number behaviour controls.
   ════════════════════════════════════════════════════════════════════ */
const OBJECT_DEFS = [
  {kind:"fluid_tank",   label:"Liquid — full bleed", icon:"🌊", group:"Liquid", count:2000, level:55, w:520, h:340, accent:"#22b8f0", fill:true,
   help:"A real liquid surface — waves, falling droplets, splash craters and rising bubbles"},
  {kind:"fluid_glass",  label:"Liquid — glass",      icon:"🥛", group:"Liquid", count:500,  level:62, w:230, h:320, accent:"#22b8f0", fill:true,
   help:"The same liquid, poured into a tumbler"},
  {kind:"fluid_bottle", label:"Liquid — bottle",     icon:"🍾", group:"Liquid", count:750,  level:70, w:220, h:330, accent:"#38d39f", fill:true,
   help:"The same liquid, in a bottle silhouette"},
  {kind:"fluid_drop",   label:"Liquid — droplet",    icon:"💧", group:"Liquid", count:100,  level:66, w:250, h:320, accent:"#22b8f0", fill:true,
   help:"Liquid filling a droplet outline — for a hydration or water-access stat"},
  {kind:"fluid_heart",  label:"Liquid — heart",      icon:"❤️", group:"Liquid", count:100,  level:72, w:260, h:300, accent:"#f0436a", fill:true,
   help:"Liquid filling a heart — for a giving, donor or health stat"},
  {kind:"fluid_circle", label:"Liquid — circle",     icon:"⚪", group:"Liquid", count:100,  level:58, w:290, h:290, accent:"#7c9cff", fill:true,
   help:"Liquid filling a disc"},

  // ── behaviours, not just silhouettes ─────────────────────────────
  {kind:"fluid_sweat",  label:"Sweating glass",      icon:"🧊", group:"Liquid", count:500,  level:64, w:240, h:340, accent:"#3fb8e8", fill:true,
   help:"A cold drink beading with condensation — droplets grow, merge and run down the glass"},
  {kind:"fluid_sea",    label:"Sea",                 icon:"🌊", group:"Liquid", count:100,  level:46, w:640, h:300, accent:"#1a86c9", fill:true,
   help:"Rolling swell with whitecaps and a slower wave layer behind it"},
  {kind:"fluid_flood",  label:"Flood line",          icon:"🏚", group:"Liquid", count:100,  level:38, w:620, h:320, accent:"#6f7f52", fill:true,
   help:"Murky water rising to a marked threshold — for a climate or risk figure"},
  {kind:"fluid_soda",   label:"Fizzy drink",         icon:"🥤", group:"Liquid", count:330,  level:68, w:230, h:330, accent:"#c9761f", fill:true,
   help:"Carbonated liquid with a foam head and a constant rise of fine bubbles"},
  {kind:"fluid_honey",  label:"Honey / thick liquid",icon:"🍯", group:"Liquid", count:100,  level:58, w:250, h:320, accent:"#e0a325", fill:true,
   help:"A viscous liquid: slow fat drops, sluggish surface, long settle"},
  {kind:"fluid_rain",   label:"Rain on glass",       icon:"🌧", group:"Liquid", count:100,  level:0,  w:420, h:320, accent:"#8fb6d4", fill:true,
   help:"A wet windowpane — beads streak down and swallow the ones they pass"},

  // ── different techniques entirely, not a surface seen from the side ──
  {kind:"fluid_lava",   label:"Lava lamp",           icon:"🫧", group:"Liquid", count:100,  level:60, w:250, h:380, accent:"#ff5a7a", fill:true,
   help:"Blobs that heat, rise, merge and split — an implicit surface, no waterline"},
  {kind:"fluid_pond",   label:"Pond — from above",   icon:"🎯", group:"Liquid", count:100,  level:50, w:480, h:340, accent:"#1f8fbf", fill:true,
   help:"Looking down at still water: rain rings spread and cross"},
  {kind:"fluid_ink",    label:"Ink in water",        icon:"🖋", group:"Liquid", count:100,  level:50, w:420, h:400, accent:"#5b3fd6", fill:true,
   help:"Dye curling through water and slowly diffusing"},
  {kind:"fluid_paint",  label:"Running paint",       icon:"🎨", group:"Liquid", count:100,  level:26, w:460, h:340, accent:"#e04b2f", fill:true,
   help:"Opaque paint dripping from an edge — matte, no shine, some drips stall"},
  {kind:"fluid_vortex", label:"Whirlpool",           icon:"🌀", group:"Liquid", count:100,  level:60, w:340, h:340, accent:"#1e8fd0", fill:true,
   help:"A rotational drain — the centre outruns the rim"},
  {kind:"fluid_layers", label:"Oil on water",        icon:"🛢", group:"Liquid", count:100,  level:52, w:300, h:340, accent:"#2f9fd0", fill:true,
   help:"Two liquids that will not mix, meeting at a wobbling interface"},

  // ── grid solvers, automata and real particle physics ──────────────
  {kind:"fluid_ripple",  label:"Ripple field",   icon:"〰", group:"Liquid", count:100, level:50, w:520, h:360, accent:"#2aa7d8", fill:true,
   help:"The wave equation solved on a grid — reflections and interference come out of the maths"},
  {kind:"fluid_caustic", label:"Pool caustics",  icon:"✨", group:"Liquid", count:100, level:50, w:520, h:360, accent:"#3fd0e8", fill:true,
   help:"The light a rippling surface throws on the floor beneath it"},
  {kind:"fluid_sand",    label:"Cellular liquid",icon:"⏳", group:"Liquid", count:100, level:62, w:360, h:400, accent:"#39b0e6", fill:true,
   help:"A falling-sand automaton: grains stack, water finds its level, all from per-cell rules"},
  {kind:"fluid_jelly",   label:"Water balloon",  icon:"🫧", group:"Liquid", count:100, level:50, w:340, h:340, accent:"#31c4d8", fill:true,
   help:"A pressurised soft body — squashes on landing and wobbles back"},
  {kind:"fluid_sph",     label:"Particle fluid", icon:"💠", group:"Liquid", count:100, level:55, w:400, h:360, accent:"#2f9be0", fill:true,
   help:"A real particle solver — it splashes, piles and sloshes because the physics says so"},
  {kind:"fluid_foam",    label:"Foam",           icon:"🧼", group:"Liquid", count:100, level:60, w:340, h:380, accent:"#8fd8f0", fill:true,
   help:"Bubbles rising, packing against each other and popping"},
];
const SHAPE_FOR = {
  fluid_tank:"rect", fluid_glass:"glass", fluid_bottle:"bottle",
  fluid_drop:"droplet", fluid_heart:"heart", fluid_circle:"circle",
  fluid_sweat:"glass", fluid_sea:"rect", fluid_flood:"rect",
  fluid_soda:"glass", fluid_honey:"glass", fluid_rain:"round",
  fluid_lava:"bottle", fluid_pond:"rect", fluid_ink:"rect",
  fluid_paint:"rect", fluid_vortex:"circle", fluid_layers:"glass",
  fluid_ripple:"rect", fluid_caustic:"rect", fluid_sand:"rect",
  fluid_jelly:"rect", fluid_sph:"rect", fluid_foam:"glass",
};

/* Per-kind character. Everything here is a plain element property, so a
   preset is only a starting point — every value stays editable afterwards
   and any of them can be mixed onto any other kind. */
const PRESETS = {
  fluid_sweat: {fluidCondensation:74, fluidChop:16, fluidDrops:false, fluidBubbles:true, fluidFizz:14},
  fluid_sea:   {fluidMode:"sea", fluidChop:62, fluidParallax:true, fluidWhitecaps:70,
                fluidDrops:false, fluidBubbles:false, fluidShowValue:false},
  fluid_flood: {fluidMode:"sea", fluidChop:26, fluidMurk:64, fluidMarker:62,
                fluidMarkerLabel:"flood level", fluidDrops:false, fluidWhitecaps:18},
  fluid_soda:  {fluidFoam:34, fluidFizz:88, fluidChop:22, fluidDrops:false},
  fluid_honey: {fluidViscosity:86, fluidChop:20, fluidStream:true, fluidBubbles:false, fluidSpout:50},
  fluid_rain:  {fluidCondensation:92, fluidRainy:true, fluidDrops:false, fluidBubbles:false,
                fluidChop:0, fluidShowValue:false},

  fluid_lava:   {fluidStyle:"metaball", fluidViscosity:30, fluidShowValue:false, fluidGlow:true},
  fluid_pond:   {fluidStyle:"pond",     fluidChop:52, fluidShowValue:false},
  fluid_ink:    {fluidStyle:"ink",      fluidSpout:50, fluidViscosity:20, fluidShowValue:false},
  fluid_paint:  {fluidStyle:"drip",     fluidChop:55, fluidViscosity:35, fluidShowValue:false, fluidGlow:false},
  fluid_vortex: {fluidStyle:"vortex",   fluidChop:50, fluidShowValue:false},
  fluid_layers: {fluidStyle:"layers",   fluidChop:24, fluidShowValue:false},

  fluid_ripple: {fluidStyle:"ripple2d", fluidChop:58, fluidShowValue:false},
  fluid_caustic:{fluidStyle:"caustics", fluidChop:64, fluidShowValue:false},
  fluid_sand:   {fluidStyle:"sand",     fluidSpout:62, fluidMurk:40, fluidShowValue:false},
  fluid_jelly:  {fluidStyle:"jelly",    fluidViscosity:20, fluidShowValue:false},
  fluid_sph:    {fluidStyle:"sph",      fluidViscosity:15, fluidShowValue:false},
  fluid_foam:   {fluidStyle:"foamPack", fluidViscosity:30, fluidShowValue:false},
};
const KIND_SET = new Set(Object.keys(SHAPE_FOR));

/* The single source of truth for every knob's fallback. Reading through
   this (rather than scattering `!= null ?` ladders) is what keeps the
   renderer, the inspector and the presets from drifting apart. */
const DEFAULTS = {
  fluidMode:"tank", fluidUnit:"ml", fluidShape:"auto", fluidShowValue:true,
  fluidDrops:true, fluidBubbles:true, fluidGlow:true, fluidStream:false,
  fluidChop:34, fluidSpout:78, fluidViscosity:0, fluidFizz:0, fluidFoam:0,
  fluidCondensation:0, fluidWhitecaps:0, fluidMurk:0, fluidParallax:false,
  fluidRainy:false, fluidMarker:-1, fluidMarkerLabel:"", fluidStyle:"surface",
};
/* Read a property: element value, else the kind's preset, else default. */
function opt(el, key){
  if(el && el[key] !== undefined && el[key] !== "") return el[key];
  const p = PRESETS[el && el.objectType];
  if(p && p[key] !== undefined) return p[key];
  return DEFAULTS[key];
}

const SEED = {
  fluidUnit:"ml", fluidDrops:true, fluidBubbles:true, fluidGlow:true,
  fluidChop:34, fluidSpout:78, fluidShape:"auto", fluidShowValue:true,
  numberMode:"countup", numberPos:"onfill",
  showLabel:false, hideContainer:true,
};

/* ════════════════════════════════════════════════════════════════════
   3. HELPERS
   ════════════════════════════════════════════════════════════════════ */
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const rand  = (a,b)=>a+Math.random()*(b-a);
const dpr   = ()=>clamp(window.devicePixelRatio||1, 1, 2.5);
const numFmt= v=>Math.round(v).toLocaleString();
const reduceMotion = ()=>!!(window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches);

/* Parse any CSS colour by leaning on the browser rather than a regex zoo.
   getComputedStyle forces a style recalculation, so results are memoised —
   a filmstrip rebuild would otherwise pay for it once per thumbnail. */
const _probe = document.createElement("span");
_probe.style.cssText = "position:absolute;left:-9999px;top:-9999px";
const _rgbCache = new Map();
function rgb(cssColor, fallback){
  const key = String(cssColor);
  if(_rgbCache.has(key)) return _rgbCache.get(key);
  const out = _rgbParse(cssColor, fallback);
  _rgbCache.set(key, out);
  return out;
}
function _rgbParse(cssColor, fallback){
  try{
    _probe.style.color = "";
    _probe.style.color = cssColor;
    if(!_probe.style.color) throw 0;
    if(document.body) document.body.appendChild(_probe);
    const m = getComputedStyle(_probe).color.match(/(\d+(?:\.\d+)?)/g);
    _probe.remove();
    if(m) return {r:+m[0], g:+m[1], b:+m[2]};
  }catch(e){}
  return fallback || {r:34,g:184,b:240};
}
const mix  = (a,b,t)=>({r:a.r+(b.r-a.r)*t, g:a.g+(b.g-a.g)*t, b:a.b+(b.b-a.b)*t});
const rgba = (c,a)=>`rgba(${c.r|0},${c.g|0},${c.b|0},${a==null?1:a})`;

/* ════════════════════════════════════════════════════════════════════
   3b. THE SCHEDULER — one rAF loop for every instance on the page
   ────────────────────────────────────────────────────────────────────
   hanns_editor.js rebuilds the filmstrip with innerHTML on every edit and
   calls paintSlide() on each slide's thumbnail, so a deck with liquids on
   several slides re-creates a lot of instances at once. One loop per
   instance meant N loops competing every frame, and a layout read in each
   constructor meant N forced reflows per rebuild.

   So: one loop for everything, instances measure themselves inside it
   rather than at construction, and anything drawn into a thumbnail paints
   a single still frame and then leaves the loop entirely. When every
   instance is still or off-screen the loop stops outright.
   ════════════════════════════════════════════════════════════════════ */
const LIVE = new Set();          // instances currently in the rAF loop
const ALL  = new Set();          // every instance, including still ones
const MAX_ANIMATED = 8;          // beyond this, extra instances go still
let _raf = 0, _lastT = 0, _sweep = 0;

/* A still instance has left the loop, so it would never notice its node
   being discarded — and the filmstrip discards nodes constantly. This
   prunes them, then stops itself once nothing is left. */
function ensureSweep(){
  if(_sweep) return;
  _sweep = setInterval(()=>{
    for(const f of Array.from(ALL)) if(!f.cv.isConnected) f.destroy();
    if(!ALL.size){ clearInterval(_sweep); _sweep = 0; }
  }, 3000);
}

function pump(now){
  _raf = requestAnimationFrame(pump);
  let dt = (now - _lastT)/1000;
  _lastT = now;
  if(dt > 0.1) dt = 0.1;         // came back from a background tab

  let animated = 0;
  for(const f of Array.from(LIVE)){
    if(!f.cv.isConnected){ f.destroy(); continue; }

    if(f.needsMeasure){
      f._measure();
      if(!f.w || !f.h) continue;              // not laid out yet — wait
      f.needsMeasure = false;
      if(f._isThumb()) f.frozenByHost = true; // a filmstrip mini: one frame
    }

    if(f.o.frozen || f.frozenByHost || reduceMotion() || animated >= MAX_ANIMATED){
      f._still();
      LIVE.delete(f);
      continue;
    }
    animated++;
    if(document.hidden || !f.visible) continue;
    f.update(dt);
    f.draw();
  }

  if(!LIVE.size){ cancelAnimationFrame(_raf); _raf = 0; }
}
function ensurePump(){
  if(_raf) return;
  _lastT = performance.now();
  _raf = requestAnimationFrame(pump);
}

/* ════════════════════════════════════════════════════════════════════
   4. THE SURFACE — N coupled springs
   Each column is pulled toward the rest level and damped; then two
   spread passes let neighbours trade momentum, which is what turns a
   local dent into a travelling ripple instead of a hole that fills in.
   ════════════════════════════════════════════════════════════════════ */
function Surface(n, restY){
  this.n = n;
  this.h = new Float32Array(n).fill(restY);
  this.v = new Float32Array(n);
  this.dL = new Float32Array(n);
  this.dR = new Float32Array(n);
  this.rest = restY;
  this.restArr = null; // optional per-column rest line (sea mode)
  this.k = 0.026;      // stiffness toward the rest level
  this.damp = 0.984;   // velocity retained per tick
  this.spread = 0.17;  // how fast a dent travels sideways
}
Surface.prototype.resize = function(n, restY){
  const old = this.h, on = this.n;
  const h = new Float32Array(n);
  for(let i=0;i<n;i++){
    const s = on>1 ? (i/Math.max(1,n-1))*(on-1) : 0;
    const a = Math.floor(s), b = Math.min(on-1, a+1), t = s-a;
    h[i] = old[a]+(old[b]-old[a])*t;
  }
  this.n=n; this.h=h; this.v=new Float32Array(n);
  this.dL=new Float32Array(n); this.dR=new Float32Array(n);
  if(this.restArr) this.restArr=new Float32Array(n);
  if(restY!=null) this.rest=restY;
};
Surface.prototype.tick = function(){
  const {h,v,n,dL,dR,rest,restArr,k,damp,spread} = this;
  for(let i=0;i<n;i++){
    // A per-column rest line lets an analytic swell drive the springs, so
    // sea mode gets rolling waves AND still reacts to anything that lands
    // in it. Tank mode leaves restArr null and uses the flat level.
    v[i] += k*((restArr ? restArr[i] : rest) - h[i]);
    v[i] *= damp;
    h[i] += v[i];
  }
  for(let pass=0; pass<2; pass++){
    for(let i=0;i<n;i++){
      if(i>0)   { dL[i] = spread*(h[i]-h[i-1]); v[i-1] += dL[i]; }
      if(i<n-1) { dR[i] = spread*(h[i]-h[i+1]); v[i+1] += dR[i]; }
    }
    for(let i=0;i<n;i++){
      if(i>0)   h[i-1] += dL[i];
      if(i<n-1) h[i+1] += dR[i];
    }
  }
};
/* A splash: push a gaussian well of velocity into the surface. */
Surface.prototype.disturb = function(idx, power, width){
  const n=this.n, w=Math.max(1, width|0);
  const lo=Math.max(0, idx-w), hi=Math.min(n-1, idx+w);
  for(let i=lo;i<=hi;i++){
    const d=(i-idx)/w;
    this.v[i] += power*Math.exp(-d*d*2.2);
  }
};

/* ════════════════════════════════════════════════════════════════════
   5. ONE LIVE INSTANCE, BOUND TO A <canvas>
   ════════════════════════════════════════════════════════════════════ */
function Fluid(canvas, opts){
  this.cv = canvas;
  this.ctx = canvas.getContext("2d");
  this.o = Object.assign({
    level:55, accent:"#22b8f0", shape:"rect", mode:"tank", style:"surface",
    drops:true, bubbles:true, chop:34, spout:78, glow:true,
    viscosity:0, fizz:0, foam:0, condensation:0, whitecaps:0, murk:0,
    parallax:false, rainy:false, stream:false, marker:-1, markerLabel:"",
    frozen:false, onLevel:null,
  }, opts||{});

  this.w=0; this.h=0; this.d=1; this.t=0; this.acc=0; this.last=0;
  this.surface=null;
  this.drops=[]; this.spray=[]; this.bubbles=[]; this.foam=[];
  this.beads=[]; this.streaks=[];          // condensation / rain on glass
  this.dropTimer=0; this.bubTimer=0; this.ambientTimer=0; this.beadTimer=0;
  this.target = clamp(this.o.level,0,100);
  this.shown  = this.target;
  this.vel = 0;
  this.mask = null;
  this.visible = true;
  this.dead = false;
  this.frozenByHost = false;
  // No getBoundingClientRect here. Measuring in the constructor forces a
  // synchronous reflow, and paintSlide() builds a detached tree anyway, so
  // the numbers would be zero. The scheduler measures on the first frame
  // after the node is actually in the document.
  this.needsMeasure = true;

  this.style = STYLES[this.o.style] || null;
  this._styleReady = false;

  this._colors();
  this._observe();
  ALL.add(this);
  LIVE.add(this);
  ensurePump();
  ensureSweep();
}

/* Is this instance being drawn into a filmstrip thumbnail? Those are
   rebuilt constantly and are far too small to read, so they get one still
   frame rather than a place in the loop. */
Fluid.prototype._isThumb = function(){
  if(this.w && this.w < 150) return true;
  return !!(this.cv.closest && this.cv.closest(".mini,.thumb,.gal-thumb"));
};

/* Bring a still instance back for one frame — after a colour, level or
   shape change, or a resize. */
Fluid.prototype.wake = function(){
  if(this.dead) return;
  LIVE.add(this);
  ensurePump();
};

/* Viscosity is not a cosmetic multiplier — it retunes the springs. A
   thick liquid is slack (low stiffness), heavily damped and slow to pass
   momentum sideways, which is what makes honey wallow where water rings. */
Fluid.prototype._applyViscosity = function(){
  const s = this.surface; if(!s) return;
  const v = clamp(this.o.viscosity,0,100)/100;
  s.k      = 0.026 * (1 - v*0.72);
  s.damp   = 0.984 - v*0.055;
  s.spread = 0.17  * (1 - v*0.66);
};

Fluid.prototype._colors = function(){
  const base = rgb(this.o.accent);
  this.cTop  = mix(base, {r:255,g:255,b:255}, 0.34);   // just under the surface
  this.cMid  = base;
  this.cDeep = mix(base, {r:4,g:24,b:52}, 0.62);       // toward the floor
  const murk = clamp(this.o.murk,0,100)/100;
  if(murk>0){                                         // silty flood water
    const silt = {r:96,g:104,b:62};
    this.cTop  = mix(this.cTop,  silt, murk*0.72);
    this.cMid  = mix(this.cMid,  silt, murk*0.66);
    this.cDeep = mix(this.cDeep, {r:34,g:38,b:24}, murk*0.7);
  }
};

Fluid.prototype._measure = function(){
  const r = this.cv.getBoundingClientRect();
  const w = Math.round(r.width  || this.cv.clientWidth  || 0);
  const h = Math.round(r.height || this.cv.clientHeight || 0);
  // Detached, display:none, or a slide that hasn't been laid out yet.
  // Report nothing rather than inventing a size and baking it in.
  if(w < 1 || h < 1){ this.w = 0; this.h = 0; return false; }
  const d = dpr();
  if(w===this.w && h===this.h && this.cv.width===Math.round(w*d)) return false;
  this.w=w; this.h=h; this.d=d;
  this.cv.width  = Math.round(w*d);
  this.cv.height = Math.round(h*d);
  const n = clamp(Math.round(w/5), 32, 220);
  const restY = this._restY();
  if(!this.surface) this.surface = new Surface(n, restY);
  else this.surface.resize(n, restY);
  if(this.o.mode==="sea"){
    if(!this.surface.restArr || this.surface.restArr.length!==n)
      this.surface.restArr = new Float32Array(n);
  } else this.surface.restArr = null;
  this._applyViscosity();
  this._styleReady = false;      // styles seed themselves against the size
  this.mask = this._buildMask();
  return true;
};

/* Surface y for the level currently shown. A small pad keeps a full
   vessel reading as liquid rather than as a solid block of colour. */
Fluid.prototype._restY = function(){
  const pad = 2;
  return pad + (1 - this.shown/100) * (this.h - pad*2);
};

Fluid.prototype._buildMask = function(){
  const d = SHAPES[this.o.shape];
  if(!d || typeof Path2D==="undefined" || typeof DOMMatrix==="undefined") return null;
  try{
    const p = new Path2D(d);
    const s = Math.min(this.w/100, this.h/140);           // uniform fit, centred
    const ox = (this.w - 100*s)/2, oy = (this.h - 140*s)/2;
    const m = new Path2D();
    m.addPath(p, new DOMMatrix([s,0,0,s,ox,oy]));
    return m;
  }catch(e){ return null; }
};

Fluid.prototype._observe = function(){
  if(typeof ResizeObserver!=="undefined"){
    // Flag only — measuring here would read layout from inside a layout
    // callback, which is exactly the thrash this module is avoiding.
    this.ro = new ResizeObserver(()=>{ this.needsMeasure = true; this.wake(); });
    this.ro.observe(this.cv);
  }
  if(typeof IntersectionObserver!=="undefined"){
    this.io = new IntersectionObserver(es=>{ this.visible = es.some(e=>e.isIntersecting); },{threshold:0});
    this.io.observe(this.cv);
  }
};

Fluid.prototype.setLevel = function(pct, o){
  const pour = !o || o.pour !== false;
  this.target = clamp(Number(pct)||0, 0, 100);
  if(!pour){ this.shown = this.target; this.vel = 0; }
  this.wake();
};
Fluid.prototype.setAccent = function(c){ this.o.accent=c; this._colors(); this.wake(); };
Fluid.prototype.setShape  = function(s){ this.o.shape=s; this.mask=this._buildMask(); this.wake(); };
/* A click means different things to different techniques: pour into a
   waterline, drop a stone in a ripple field, shove a soft body. */
Fluid.prototype.poke = function(ev){
  let px = this.w*0.5, py = this.h*0.5;
  if(ev && this.cv.getBoundingClientRect){
    const r = this.cv.getBoundingClientRect();
    if(r.width){ px = (ev.clientX - r.left)/r.width*this.w; py = (ev.clientY - r.top)/r.height*this.h; }
  }
  const st = this.o.style;
  if(st==="ripple2d" || st==="caustics"){
    if(!this.rCur) return;
    const gx = clamp(Math.round(px/this.w*this.rw),1,this.rw-2);
    const gy = clamp(Math.round(py/this.h*this.rh),1,this.rh-2);
    this.rCur[gy*this.rw+gx] = -520;
  } else if(st==="jelly"){
    for(const p of (this.jp||[])){
      const d=Math.hypot(p.x-px,p.y-py);
      if(d<this.w*0.3){ p.py += 9; p.px += (p.x-px)/(d||1)*5; }
    }
  } else if(st==="sph"){
    for(const p of (this.pts||[])){
      const dx=p.x-px, dy=p.y-py, d=Math.hypot(dx,dy)||1;
      if(d<this.w*0.35){ p.vx += dx/d*260; p.vy += dy/d*260 - 120; }
    }
  } else if(st==="metaball"){
    for(const b of (this.blobs||[])) b.vy -= 26;
  } else if(st==="sand"){
    if(!this.cells) return;
    const gx=clamp(Math.round(px/this.w*this.cw),0,this.cw-1);
    for(let k=0;k<40;k++){
      const x=clamp(gx+((Math.random()*9)|0)-4,0,this.cw-1);
      if(!this.cells[x]) this.cells[x]=1;
    }
  } else if(st==="foamPack"){
    for(const b of (this.fb||[])) b.vy -= 14;
  } else if(!this.style){
    for(let i=0;i<7;i++) setTimeout(()=>{ this.spawnDrop(); this.wake(); }, i*70);
  }
  this.wake();
};

Fluid.prototype.setStyle  = function(name){
  this.o.style = name;
  this.style = STYLES[name] || null;
  this._styleReady = false;
  this.wake();
};

Fluid.prototype.destroy = function(){
  if(this.dead) return;
  this.dead = true;
  LIVE.delete(this);
  ALL.delete(this);
  if(this.ro) this.ro.disconnect();
  if(this.io) this.io.disconnect();
  this.drops.length = this.spray.length = this.bubbles.length = this.foam.length = 0;
};

/* One frozen frame — reduced motion, or Animation: off in the inspector. */
Fluid.prototype._still = function(){
  const s=this.surface;
  if(!s || !this.w || !this.h) return;   // the scheduler measures for us
  if(this.style){
    // Styles have no meaningful rest state, so settle them by running a
    // short simulation and painting the result once.
    if(!this._styleReady){ if(this.style.init) this.style.init(this); this._styleReady=true; }
    for(let i=0;i<40;i++) this.style.update(this, 1/60);
    this.draw();
    if(this.o.onLevel) this.o.onLevel(this.shown);
    return;
  }
  const restY=this._restY(); s.rest=restY;
  for(let i=0;i<s.n;i++){ s.h[i]=restY + Math.sin(i/s.n*Math.PI*2)*1.6; s.v[i]=0; }
  this.drops.length=this.spray.length=this.foam.length=0;
  this.draw();
  if(this.o.onLevel) this.o.onLevel(this.shown);
};


/* ════════════════════════════════════════════════════════════════════
   5b. ALTERNATIVE STYLES
   ────────────────────────────────────────────────────────────────────
   Everything above renders a height-field surface seen from the side.
   These do not. Each one is a different technique wearing the same
   plumbing (measuring, masking, the shared scheduler, the readout):

     metaball  an implicit surface — blobs merge and split, no surface array
     pond      a top-down camera: interfering ripple rings on still water
     ink       dye advected through a flow field, accumulated over frames
     drip      opaque paint running from an edge — no meniscus, no gloss
     vortex    a rotational field draining to a centre
     layers    two immiscible liquids meeting at a wobbling interface

   A style owns update() and draw() outright. Level easing, the readout
   and teardown still run above it.
   ════════════════════════════════════════════════════════════════════ */

/* A scratch canvas for styles that need compositing. Sized in device
   pixels and reused; `persist` keeps last frame's content for trails. */
function buffer(f, key, persist){
  const k = key||"_buf";
  let b = f[k];
  if(!b){ b = f[k] = document.createElement("canvas"); b._w = -1; }
  const W = Math.round(f.w*f.d), H = Math.round(f.h*f.d);
  if(b.width!==W || b.height!==H){ b.width=W; b.height=H; b._w=W; }
  else if(!persist){ const c=b.getContext("2d"); c.setTransform(1,0,0,1,0,0); c.clearRect(0,0,W,H); }
  return b;
}
function bctx(f, b){
  const c = b.getContext("2d");
  c.setTransform(1,0,0,1,0,0);
  c.scale(f.d, f.d);
  return c;
}
const CAN_FILTER = (()=>{ try{
  const c=document.createElement("canvas").getContext("2d");
  c.filter="blur(2px)"; return c.filter!=="none";
}catch(e){ return false; } })();

const STYLES = {

/* ── lava lamp ──────────────────────────────────────────────────────
   No surface array at all. Blobs carry heat: they warm at the floor,
   rise, cool at the ceiling and sink, which is what gives a lava lamp
   its slow irregular cycle. The gooey merging is a blur-plus-contrast
   threshold — the cheap way to a real implicit surface. */
metaball: {
  init(f){
    const n = 4 + Math.round(clamp(f.o.level,0,100)/100 * 7);
    f.blobs = [];
    for(let i=0;i<n;i++){
      f.blobs.push({
        x: rand(f.w*0.2, f.w*0.8),
        y: rand(f.h*0.1, f.h*0.9),
        r: rand(f.h*0.055, f.h*0.12),
        vy: rand(-8,8), vx: rand(-4,4),
        heat: Math.random(), phase: rand(0,6.28),
      });
    }
  },
  update(f, dt){
    const B=f.blobs, speed = 1 - clamp(f.o.viscosity,0,100)/140;
    for(const b of B){
      // heat exchange with the floor and the ceiling
      if(b.y > f.h*0.82) b.heat = Math.min(1, b.heat + dt*0.42);
      if(b.y < f.h*0.18) b.heat = Math.max(0, b.heat - dt*0.36);
      const buoy = (b.heat - 0.5) * -34 * speed;
      b.vy += (buoy - b.vy) * dt * 0.7;
      b.phase += dt*0.6;
      b.vx += Math.sin(b.phase)*dt*5;
      b.vx *= 0.985;
      b.x += b.vx*dt*speed*8;
      b.y += b.vy*dt*speed*1.6;
      const m = b.r*0.5;
      if(b.x < m){ b.x=m; b.vx=Math.abs(b.vx); }
      if(b.x > f.w-m){ b.x=f.w-m; b.vx=-Math.abs(b.vx); }
      b.y = clamp(b.y, b.r*0.3, f.h-b.r*0.3);
    }
    // merge on contact, area-conserving
    for(let i=B.length-1;i>0;i--){
      for(let j=i-1;j>=0;j--){
        const a=B[i], c=B[j];
        const d=Math.hypot(a.x-c.x, a.y-c.y);
        if(d < (a.r+c.r)*0.42){
          c.r = Math.sqrt(a.r*a.r + c.r*c.r);
          c.heat = (a.heat+c.heat)/2;
          c.vy = (a.vy+c.vy)/2;
          B.splice(i,1);
          break;
        }
      }
    }
    // and split again once one gets too fat, so the cycle never stalls
    const maxR = f.h*0.19;
    for(let i=B.length-1;i>=0;i--){
      const b=B[i];
      if(b.r > maxR && B.length < 14){
        const nr = b.r/Math.SQRT2;
        b.r = nr;
        B.push({x:b.x+rand(-nr,nr), y:b.y+rand(-nr,nr), r:nr,
          vx:rand(-6,6), vy:b.vy, heat:b.heat, phase:rand(0,6.28)});
      }
    }
  },
  draw(f, ctx){
    const b = buffer(f), c = bctx(f, b);
    c.clearRect(0,0,f.w,f.h);
    const blur = Math.max(6, f.h*0.035);
    if(CAN_FILTER) c.filter = `blur(${blur}px) contrast(24)`;
    c.fillStyle = "#fff";
    for(const bl of f.blobs){
      c.beginPath(); c.arc(bl.x, bl.y, bl.r, 0, 6.2832); c.fill();
    }
    if(CAN_FILTER) c.filter = "none";
    // colourise through the threshold shape
    c.globalCompositeOperation = "source-in";
    const g = c.createLinearGradient(0,0,0,f.h);
    g.addColorStop(0,   rgba(f.cTop, 0.98));
    g.addColorStop(0.55,rgba(f.cMid, 0.98));
    g.addColorStop(1,   rgba(f.cDeep,0.98));
    c.fillStyle = g;
    c.fillRect(0,0,f.w,f.h);
    c.globalCompositeOperation = "source-over";

    if(f.o.glow){ ctx.shadowColor = rgba(f.cMid, 0.55); ctx.shadowBlur = 26; }
    ctx.drawImage(b, 0, 0, f.w, f.h);
    ctx.shadowBlur = 0;

    // a specular kiss on each blob so they read as volumes, not stickers
    for(const bl of f.blobs){
      const sg = ctx.createRadialGradient(bl.x-bl.r*0.32, bl.y-bl.r*0.38, 1,
                                          bl.x-bl.r*0.32, bl.y-bl.r*0.38, bl.r*0.7);
      sg.addColorStop(0,"rgba(255,255,255,.30)");
      sg.addColorStop(1,"rgba(255,255,255,0)");
      ctx.fillStyle=sg;
      ctx.beginPath(); ctx.arc(bl.x, bl.y, bl.r, 0, 6.2832); ctx.fill();
    }
  }
},

/* ── still pond, seen from above ────────────────────────────────────
   The only style with a different camera. Each drop emits a train of
   wavefronts; where two trains cross they simply overdraw, which is
   enough to read as interference. The light/dark pair on each crest is
   doing the work — it fakes the lens a real ripple makes. */
pond: {
  init(f){ f.rings=[]; f.ringTimer=0; },
  update(f, dt){
    f.ringTimer -= dt;
    const rate = 0.25 + (100 - clamp(f.o.chop,0,100))/45;
    if(f.ringTimer <= 0){
      f.ringTimer = rand(rate*0.5, rate*1.5);
      f.rings.push({x:rand(f.w*0.08,f.w*0.92), y:rand(f.h*0.08,f.h*0.92),
        r:0, life:1, speed:rand(46,74), amp:rand(0.7,1)});
    }
    const maxR = Math.hypot(f.w,f.h)*0.6;
    for(let i=f.rings.length-1;i>=0;i--){
      const g=f.rings[i];
      g.r += g.speed*dt;
      g.life = 1 - g.r/maxR;
      if(g.life <= 0) f.rings.splice(i,1);
    }
  },
  draw(f, ctx){
    // water seen from above: darker at the edges, light pooling in
    const g = ctx.createRadialGradient(f.w*0.42, f.h*0.34, 0, f.w*0.5, f.h*0.5, Math.max(f.w,f.h)*0.75);
    g.addColorStop(0, rgba(f.cMid, 0.95));
    g.addColorStop(1, rgba(f.cDeep, 0.98));
    ctx.fillStyle = g;
    ctx.fillRect(0,0,f.w,f.h);

    // slow caustic drift so the surface is never dead between drops
    ctx.globalCompositeOperation = "lighter";
    for(let i=0;i<3;i++){
      const cx = f.w*(0.25+0.25*i) + Math.sin(f.t*(0.19+0.07*i)+i)*f.w*0.22;
      const cy = f.h*(0.35+0.18*i) + Math.cos(f.t*(0.15+0.05*i)+i*2)*f.h*0.18;
      const rr = Math.max(40, f.w*0.3);
      const cg = ctx.createRadialGradient(cx,cy,0,cx,cy,rr);
      cg.addColorStop(0, rgba(f.cTop, 0.10));
      cg.addColorStop(1, rgba(f.cTop, 0));
      ctx.fillStyle=cg;
      ctx.beginPath(); ctx.arc(cx,cy,rr,0,6.2832); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";

    for(const ring of f.rings){
      const fade = clamp(ring.life,0,1);
      for(let k=0;k<3;k++){                     // a short train per drop
        const r = ring.r - k*11;
        if(r <= 1) continue;
        const a = fade*fade * ring.amp * (0.55 - k*0.16);
        if(a <= 0.01) continue;
        ctx.lineWidth = 2.0;
        ctx.strokeStyle = `rgba(255,255,255,${a})`;
        ctx.beginPath(); ctx.arc(ring.x, ring.y-1, r, 0, 6.2832); ctx.stroke();
        ctx.lineWidth = 2.4;
        ctx.strokeStyle = rgba(f.cDeep, a*0.8);
        ctx.beginPath(); ctx.arc(ring.x, ring.y+2, r, 0, 6.2832); ctx.stroke();
      }
      if(ring.r < 6){
        ctx.beginPath(); ctx.arc(ring.x, ring.y, 2.2, 0, 6.2832);
        ctx.fillStyle="rgba(255,255,255,.9)"; ctx.fill();
      }
    }
  }
},

/* ── ink in water ───────────────────────────────────────────────────
   Dye particles ride a flow field and paint into a buffer that only
   partly clears each frame. The tendrils are the accumulation, not the
   particles — one frame of this looks like nothing at all. */
ink: {
  init(f){ f.dye=[]; f.dyeTimer=0; },
  flow(f, x, y){
    const a = Math.sin(x*0.011 + f.t*0.32)
            + Math.cos(y*0.014 - f.t*0.24)
            + Math.sin((x+y)*0.008 + f.t*0.17);
    return a * Math.PI;
  },
  update(f, dt){
    f.dyeTimer -= dt;
    if(f.dyeTimer <= 0 && f.dye.length < 900){
      f.dyeTimer = rand(0.05,0.16);
      const sx = f.w*(clamp(f.o.spout,0,100)/100), sy = f.h*0.16;
      for(let i=0;i<14;i++){
        const a=rand(0,6.28), d=rand(0,10);
        f.dye.push({x:sx+Math.cos(a)*d, y:sy+Math.sin(a)*d,
          vx:rand(-6,6), vy:rand(6,26), r:rand(3,9), life:rand(2.6,5.2), max:5.2});
      }
    }
    const visc = 1 - clamp(f.o.viscosity,0,100)/160;
    for(let i=f.dye.length-1;i>=0;i--){
      const p=f.dye[i];
      const a = STYLES.ink.flow(f, p.x, p.y);
      p.vx += Math.cos(a)*24*dt;
      p.vy += (Math.sin(a)*24 + 9)*dt;      // a little heavier than water
      p.vx *= 0.97; p.vy *= 0.97;
      p.x += p.vx*dt*22*visc;
      p.y += p.vy*dt*22*visc;
      p.r += dt*1.5;                        // diffuses as it travels
      p.life -= dt;
      if(p.life<=0 || p.y > f.h+20 || p.x < -20 || p.x > f.w+20) f.dye.splice(i,1);
    }
  },
  draw(f, ctx){
    const b = buffer(f, "_ink", true), c = bctx(f, b);
    // clear only partly — what stays behind is the tendril
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = "rgba(0,0,0,.045)";
    c.fillRect(0,0,f.w,f.h);
    c.globalCompositeOperation = "source-over";
    for(const p of f.dye){
      const a = clamp(p.life/p.max,0,1)*0.30;
      const g = c.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r);
      g.addColorStop(0, rgba(f.cMid, a));
      g.addColorStop(0.6, rgba(f.cDeep, a*0.6));
      g.addColorStop(1, rgba(f.cDeep, 0));
      c.fillStyle=g;
      c.beginPath(); c.arc(p.x,p.y,p.r,0,6.2832); c.fill();
    }
    // the water it is spreading through
    const wg = ctx.createLinearGradient(0,0,0,f.h);
    wg.addColorStop(0, rgba(f.cDeep, 0.16));
    wg.addColorStop(1, rgba(f.cDeep, 0.34));
    ctx.fillStyle = wg;
    ctx.fillRect(0,0,f.w,f.h);
    ctx.drawImage(b, 0, 0, f.w, f.h);
  }
},

/* ── running paint ──────────────────────────────────────────────────
   Deliberately unlike the water styles: opaque, matte, no meniscus and
   no glow. Drips accelerate, thin as they stretch, and some stall part
   way down and just stop — which is most of what makes it read as paint
   rather than as falling rectangles. */
drip: {
  init(f){ f.drips=[]; f.dripTimer=0; f.pool=0; },
  update(f, dt){
    const bandY = f.h * (1 - clamp(f.shown,0,100)/100) * 0.55 + f.h*0.06;
    f.bandY = bandY;
    f.dripTimer -= dt;
    const density = 0.1 + clamp(f.o.chop,0,100)/100 * 0.9;
    if(f.dripTimer <= 0 && f.drips.length < 26){
      f.dripTimer = rand(0.3, 1.6)/density;
      f.drips.push({x:rand(f.w*0.04,f.w*0.96), y:bandY, w:rand(3,9),
        vy:0, stall: Math.random()<0.34 ? rand(0.25,0.75) : 1, dead:false});
    }
    const g = 90 * (1 - clamp(f.o.viscosity,0,100)/130);
    for(const d of f.drips){
      if(d.dead) continue;
      // How far it gets is measured from the band it left, not from the
      // top of the canvas — otherwise a low band puts every stall point
      // above the drip's own starting line and it dies on frame one.
      const limit = bandY + (f.h - bandY) * d.stall;
      if(d.y >= limit){ d.dead = true; continue; }
      d.vy += g*dt;
      d.y += d.vy*dt;
      d.w = Math.max(1.6, d.w - dt*0.5);     // thins as it stretches
      if(d.y >= f.h-2){ d.y=f.h-2; d.dead=true; f.pool=Math.min(f.h*0.18, f.pool+1.2); }
    }
    if(f.drips.length > 40) f.drips.splice(0, f.drips.length-40);
  },
  draw(f, ctx){
    const col = rgba(f.cMid, 1);
    ctx.fillStyle = col;
    // the band the paint is running from, with a wobbling lower edge
    ctx.beginPath();
    ctx.moveTo(0,0); ctx.lineTo(f.w,0);
    const steps = Math.max(10, Math.round(f.w/14));
    for(let i=steps;i>=0;i--){
      const u=i/steps, x=u*f.w;
      const y = f.bandY + Math.sin(u*9 + f.t*0.4)*3 + Math.sin(u*21 - f.t*0.25)*1.6;
      ctx.lineTo(x,y);
    }
    ctx.closePath(); ctx.fill();

    for(const d of f.drips){
      ctx.beginPath();
      ctx.moveTo(d.x-d.w, f.bandY);
      ctx.lineTo(d.x-d.w*0.62, d.y);
      ctx.lineTo(d.x+d.w*0.62, d.y);
      ctx.lineTo(d.x+d.w, f.bandY);
      ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      ctx.beginPath(); ctx.arc(d.x, d.y, d.w*0.85, 0, 6.2832);
      ctx.fillStyle = col; ctx.fill();
      // one soft highlight down the left of the bead — paint is matte,
      // so this stays subtle
      ctx.beginPath(); ctx.arc(d.x-d.w*0.25, d.y-d.w*0.2, d.w*0.34, 0, 6.2832);
      ctx.fillStyle = rgba(f.cTop, 0.4); ctx.fill();
    }
    if(f.pool > 0.5){
      ctx.fillStyle = col;
      ctx.fillRect(0, f.h-f.pool, f.w, f.pool);
    }
  }
},

/* ── whirlpool ──────────────────────────────────────────────────────
   Angular speed rises as radius falls, the way it does over a drain, so
   the centre outruns the rim on its own rather than by decree. */
vortex: {
  init(f){
    f.motes=[];
    const n = 130 + Math.round(clamp(f.o.level,0,100)*1.6);
    const R = Math.min(f.w,f.h)*0.48;
    for(let i=0;i<n;i++){
      f.motes.push({a:rand(0,6.2832), r:rand(R*0.08,R), z:rand(0.3,1)});
    }
  },
  update(f, dt){
    const R = Math.min(f.w,f.h)*0.48;
    const spin = 1 + clamp(f.o.chop,0,100)/50;
    const pull = 1 - clamp(f.o.viscosity,0,100)/180;
    for(const m of f.motes){
      m.a += (2.6/Math.max(0.10, m.r/R)) * dt * 0.35 * spin;
      m.r -= (10 + 26*(1-m.r/R)) * dt * pull * 0.42;
      if(m.r < R*0.05){ m.r = R*rand(0.85,1.0); m.a = rand(0,6.2832); }
    }
  },
  draw(f, ctx){
    const cx=f.w/2, cy=f.h/2, R=Math.min(f.w,f.h)*0.48;
    const g = ctx.createRadialGradient(cx,cy,R*0.03,cx,cy,R);
    g.addColorStop(0,   "rgba(2,8,16,.96)");        // the throat
    g.addColorStop(0.28,rgba(f.cDeep,0.96));
    g.addColorStop(1,   rgba(f.cMid, 0.94));
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.ellipse(cx,cy,R,R*0.92,0,0,6.2832); ctx.fill();

    // funnel walls
    for(let i=1;i<=5;i++){
      const rr = R*(i/5);
      ctx.beginPath();
      ctx.ellipse(cx, cy + (1-i/5)*R*0.08, rr, rr*0.9, 0, 0, 6.2832);
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = rgba(f.cTop, 0.10 + 0.06*i);
      ctx.stroke();
    }

    // motes drawn as arc streaks, which is the motion blur
    for(const m of f.motes){
      const x=cx+Math.cos(m.a)*m.r, y=cy+Math.sin(m.a)*m.r*0.92;
      const len = 0.10 + 0.28*(1-m.r/R);
      ctx.beginPath();
      ctx.ellipse(cx, cy, m.r, m.r*0.92, 0, m.a-len, m.a);
      ctx.lineWidth = 1.1 + m.z*1.5;
      ctx.strokeStyle = `rgba(255,255,255,${0.05 + m.z*0.20*(1-m.r/R*0.6)})`;
      ctx.stroke();
      if(m.z > 0.82){
        ctx.beginPath(); ctx.arc(x,y,1.0,0,6.2832);
        ctx.fillStyle="rgba(255,255,255,.5)"; ctx.fill();
      }
    }
    ctx.beginPath();
    ctx.ellipse(cx,cy,R*0.055,R*0.05,0,0,6.2832);
    ctx.fillStyle="rgba(0,0,0,.85)"; ctx.fill();
  }
},

/* ── two immiscible liquids ─────────────────────────────────────────
   Oil floating on water. Two surfaces: the interface between them and
   the top of the oil. Beads of oil break off the interface and rise,
   which is what stops it looking like two stacked rectangles. */
layers: {
  init(f){
    const n = f.surface.n;
    f.iface = new Surface(n, f.h*0.62);
    f.iface.k = 0.019; f.iface.damp = 0.988; f.iface.spread = 0.13;
    f.globs = []; f.globTimer = 0;
  },
  update(f, dt){
    const split = clamp(f.shown,0,100)/100;
    const topY = f.h*(1-Math.min(0.94, split+0.28));
    const midY = f.h*(1-split*0.62);
    f.surface.rest = topY;
    f.iface.rest   = midY;
    let guard=0; f._acc2=(f._acc2||0)+dt;
    while(f._acc2 >= 1/120 && guard++<8){ f.surface.tick(); f.iface.tick(); f._acc2 -= 1/120; }

    f.globTimer -= dt;
    if(f.globTimer<=0 && f.globs.length<14){
      f.globTimer = rand(0.6,2.2);
      const i = (Math.random()*f.iface.n)|0;
      f.globs.push({x:(i/(f.iface.n-1))*f.w, y:f.iface.h[i]-2,
        r:rand(3,9), vy:rand(6,18), phase:rand(0,6.28)});
      f.iface.disturb(i, -0.5, 4);
    }
    for(let i=f.globs.length-1;i>=0;i--){
      const g=f.globs[i];
      g.y -= g.vy*dt; g.phase += dt*1.5;
      const col = clamp(Math.round(g.x/f.w*(f.surface.n-1)),0,f.surface.n-1);
      if(g.y - g.r <= f.surface.h[col]){
        f.surface.disturb(col, -0.3, 4);
        f.globs.splice(i,1);
      }
    }
  },
  draw(f, ctx){
    const path=(surf, close)=>{
      const n=surf.n;
      ctx.beginPath();
      ctx.moveTo(0, surf.h[0]);
      for(let i=1;i<n-1;i++){
        const xc=((i+i+1)/2/(n-1))*f.w, yc=(surf.h[i]+surf.h[i+1])/2;
        ctx.quadraticCurveTo((i/(n-1))*f.w, surf.h[i], xc, yc);
      }
      ctx.lineTo(f.w, surf.h[n-1]);
      if(close){ ctx.lineTo(f.w,f.h+4); ctx.lineTo(0,f.h+4); ctx.closePath(); }
    };
    // heavier liquid underneath
    const wg = ctx.createLinearGradient(0,f.iface.rest,0,f.h);
    wg.addColorStop(0, rgba(f.cMid, 0.97));
    wg.addColorStop(1, rgba(f.cDeep,0.98));
    ctx.fillStyle=wg; path(f.iface,true); ctx.fill();

    // lighter liquid on top, drawn between the two surfaces
    ctx.save();
    path(f.surface,true); ctx.clip();
    const og = ctx.createLinearGradient(0,f.surface.rest,0,f.iface.rest);
    const oil = mix(f.cTop,{r:250,g:214,b:96},0.62);
    og.addColorStop(0, rgba(oil,0.94));
    og.addColorStop(1, rgba(mix(oil,{r:120,g:70,b:10},0.4),0.92));
    ctx.fillStyle=og;
    ctx.beginPath(); ctx.rect(0,0,f.w,f.h);
    path(f.iface,true);
    ctx.fill("evenodd");
    ctx.restore();

    for(const g of f.globs){
      const x=g.x+Math.sin(g.phase)*2;
      const gg=ctx.createRadialGradient(x-g.r*0.3,g.y-g.r*0.3,1,x,g.y,g.r);
      gg.addColorStop(0, rgba(mix(oil,{r:255,g:255,b:255},0.4),0.95));
      gg.addColorStop(1, rgba(oil,0.9));
      ctx.fillStyle=gg;
      ctx.beginPath(); ctx.arc(x,g.y,g.r,0,6.2832); ctx.fill();
    }

    ctx.lineWidth=1.4;
    ctx.strokeStyle=rgba(mix(oil,{r:60,g:30,b:0},0.5),0.5);
    path(f.iface,false); ctx.stroke();
    ctx.lineWidth=2.0;
    ctx.strokeStyle="rgba(255,255,255,.8)";
    path(f.surface,false); ctx.stroke();
  }
},

};


/* A small fixed-resolution offscreen canvas for grid techniques. The
   simulation runs at grid resolution and is scaled up on draw, which is
   both far cheaper and softer-looking than simulating at screen size. */
function gridBuffer(f, key, gw, gh){
  let g = f[key];
  if(!g || g.gw!==gw || g.gh!==gh){
    const cv = document.createElement("canvas");
    cv.width = gw; cv.height = gh;
    const cx = cv.getContext("2d");
    g = f[key] = {cv, cx, gw, gh, img: cx.createImageData(gw, gh)};
  }
  return g;
}

Object.assign(STYLES, {

/* ── 2D wave equation ───────────────────────────────────────────────
   Not the analytic rings of `pond`: this integrates the actual wave
   equation on a grid, so reflections off the walls, interference and
   the slow decay all fall out of the maths rather than being drawn in.
   Shading comes from the surface normal, which is what makes it look
   like water rather than like moving contour lines. */
ripple2d: {
  init(f){
    const gw = clamp(Math.round(f.w/5), 48, 150);
    const gh = clamp(Math.round(f.h/5), 36, 130);
    f.rw = gw; f.rh = gh;
    f.rCur  = new Float32Array(gw*gh);
    f.rPrev = new Float32Array(gw*gh);
    f.rTimer = 0;
    gridBuffer(f, "_rip", gw, gh);
  },
  update(f, dt){
    const gw=f.rw, gh=f.rh, cur=f.rCur, prev=f.rPrev;
    const damp = 0.992 - clamp(f.o.viscosity,0,100)/100*0.02;
    for(let y=1;y<gh-1;y++){
      const row=y*gw;
      for(let x=1;x<gw-1;x++){
        const i=row+x;
        // u(t+1) = (sum of neighbours)/2 - u(t-1), the discrete wave step
        let v = (cur[i-1]+cur[i+1]+cur[i-gw]+cur[i+gw])*0.5 - prev[i];
        prev[i] = v*damp;
      }
    }
    f.rCur = prev; f.rPrev = cur;      // swap, no allocation

    f.rTimer -= dt;
    if(f.rTimer<=0){
      f.rTimer = rand(0.25,1.3) * (1.8 - clamp(f.o.chop,0,100)/100);
      const x=(rand(3,gw-4))|0, y=(rand(3,gh-4))|0;
      f.rCur[y*gw+x] = -260;
    }
  },
  draw(f, ctx){
    const g = gridBuffer(f,"_rip",f.rw,f.rh);
    const {gw,gh,img} = g, d = img.data, cur = f.rCur;
    const top=f.cTop, mid=f.cMid, deep=f.cDeep;
    for(let y=0;y<gh;y++){
      const row=y*gw, t=y/(gh-1);
      // base colour: a vertical gradient, as if looking into depth
      const br = mid.r+(deep.r-mid.r)*t, bg = mid.g+(deep.g-mid.g)*t, bb = mid.b+(deep.b-mid.b)*t;
      for(let x=0;x<gw;x++){
        const i=row+x, o=i*4;
        const xl = x>0?cur[i-1]:cur[i], xr = x<gw-1?cur[i+1]:cur[i];
        const yu = y>0?cur[i-gw]:cur[i], yd = y<gh-1?cur[i+gw]:cur[i];
        const nx = (xl-xr)*0.06, ny = (yu-yd)*0.06;   // surface normal
        const lum = 1 + nx*0.55 + ny*0.35;
        const spec = Math.max(0, nx*0.7 + ny*0.7);
        const sp = Math.min(255, spec*spec*90);
        d[o]   = clamp(br*lum + sp + top.r*0.05, 0, 255);
        d[o+1] = clamp(bg*lum + sp + top.g*0.05, 0, 255);
        d[o+2] = clamp(bb*lum + sp + top.b*0.05, 0, 255);
        d[o+3] = 250;
      }
    }
    g.cx.putImageData(img,0,0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(g.cv, 0, 0, f.w, f.h);
  }
},

/* ── caustics on a pool floor ───────────────────────────────────────
   The same wave grid, but drawn as the light it throws rather than as
   the water itself. Where the surface curves inward it focuses light,
   so brightness follows the Laplacian — the second derivative is doing
   the physics here, not a texture. */
caustics: {
  init(f){ STYLES.ripple2d.init(f); },
  update(f, dt){ STYLES.ripple2d.update(f, dt); },
  draw(f, ctx){
    const g = gridBuffer(f,"_rip",f.rw,f.rh);
    const {gw,gh,img} = g, d = img.data, cur = f.rCur;
    const floor = mix(f.cDeep, {r:12,g:30,b:44}, 0.35);
    const lightC = mix(f.cTop, {r:255,g:255,b:255}, 0.55);
    for(let y=0;y<gh;y++){
      const row=y*gw;
      for(let x=0;x<gw;x++){
        const i=row+x, o=i*4;
        const xl = x>0?cur[i-1]:cur[i], xr = x<gw-1?cur[i+1]:cur[i];
        const yu = y>0?cur[i-gw]:cur[i], yd = y<gh-1?cur[i+gw]:cur[i];
        const lap = (xl+xr+yu+yd) - 4*cur[i];
        let k = 1 - lap*0.028;                 // convergence of the rays
        k = k<0.05 ? 0.05 : k;
        let bright = 1/(k*k);
        if(bright>7) bright=7;
        const a = clamp((bright-0.6)*0.34, 0, 1);
        // tiled floor, so the caustic has something to fall on
        const tile = ((x*6/gw|0)+(y*5/gh|0))%2 ? 1 : 0.9;
        d[o]   = clamp(floor.r*tile + lightC.r*a, 0, 255);
        d[o+1] = clamp(floor.g*tile + lightC.g*a, 0, 255);
        d[o+2] = clamp(floor.b*tile + lightC.b*a, 0, 255);
        d[o+3] = 252;
      }
    }
    g.cx.putImageData(img,0,0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(g.cv, 0, 0, f.w, f.h);
  }
},

/* ── cellular liquid ────────────────────────────────────────────────
   A falling-sand automaton. There is no surface and no physics in the
   usual sense — just per-cell rules, applied bottom-up so a cell cannot
   move twice in a frame. Grains stack at an angle of repose because
   they may only fall diagonally; water levels out because it may also
   move sideways. Every liquid property here is emergent. */
sand: {
  init(f){
    const gw = clamp(Math.round(f.w/6), 40, 110);
    const gh = clamp(Math.round(f.h/6), 40, 130);
    f.cw=gw; f.ch=gh;
    f.cells = new Uint8Array(gw*gh);      // 0 empty, 1 water, 2 grain
    f.cTimer = 0; f.cFlip = 0;
    gridBuffer(f,"_cell",gw,gh);
  },
  update(f, dt){
    const gw=f.cw, gh=f.ch, c=f.cells;
    // pour: water at the spout, grains offset from it
    const wx = clamp(Math.round(gw*(clamp(f.o.spout,0,100)/100)), 1, gw-2);
    const gx = clamp(Math.round(gw*0.28), 1, gw-2);
    const grains = clamp(f.o.murk,0,100) > 12;
    for(let k=-1;k<=1;k++){
      const w1 = wx+k; if(w1>=0 && w1<gw && !c[w1]) c[w1] = 1;
      if(grains && k!==0){ const g1=gx+k; if(g1>=0 && g1<gw && !c[g1]) c[g1] = 2; }
    }
    const swap=(a,b)=>{ const t=c[a]; c[a]=c[b]; c[b]=t; };
    f.cFlip ^= 1;
    for(let y=gh-2;y>=0;y--){
      const row=y*gw, below=row+gw;
      // alternate scan direction each frame or piles lean one way
      const x0 = f.cFlip?0:gw-1, x1 = f.cFlip?gw:-1, step = f.cFlip?1:-1;
      for(let x=x0;x!==x1;x+=step){
        const i=row+x, v=c[i];
        if(!v) continue;
        if(!c[below+x]){ swap(i, below+x); continue; }
        const dl = x>0    && !c[below+x-1];
        const dr = x<gw-1 && !c[below+x+1];
        if(dl||dr){ swap(i, below + x + ((dl&&dr) ? (Math.random()<0.5?-1:1) : (dl?-1:1))); continue; }
        if(v===1){                                   // only water spreads
          const l = x>0    && !c[i-1];
          const r = x<gw-1 && !c[i+1];
          if(l||r) swap(i, i + ((l&&r) ? (Math.random()<0.5?-1:1) : (l?-1:1)));
        }
      }
    }
    // Drain from the floor only once the box has reached the level the
    // element asks for. Draining unconditionally emptied it faster than
    // the spout could fill it.
    f._cCount = (f._cCount||0) + 1;
    if(f._cCount % 4 === 0){
      let filled = 0;
      for(let i=0;i<c.length;i++) if(c[i]) filled++;
      const target = clamp(f.shown,0,100)/100 * gw*gh*0.8;
      if(filled > target){
        const last=(gh-1)*gw;
        const excess = Math.min(gw, Math.ceil((filled-target)/12));
        for(let n=0;n<excess;n++){
          const x=(Math.random()*gw)|0;
          if(c[last+x]) c[last+x]=0;
        }
      }
    }
  },
  draw(f, ctx){
    const g=gridBuffer(f,"_cell",f.cw,f.ch);
    const {gw,gh,img}=g, d=img.data, c=f.cells;
    const grain = mix(f.cMid,{r:214,g:186,b:126},0.82);
    for(let i=0;i<c.length;i++){
      const o=i*4, v=c[i];
      if(!v){ d[o+3]=0; continue; }
      const t=(i/gw|0)/gh;
      const col = v===1 ? mix(f.cTop, f.cDeep, t) : grain;
      const j = 0.9 + ((i*2654435761)%97)/97*0.2;   // per-cell grain
      d[o]=clamp(col.r*j,0,255); d[o+1]=clamp(col.g*j,0,255);
      d[o+2]=clamp(col.b*j,0,255); d[o+3]=255;
    }
    g.cx.putImageData(img,0,0);
    ctx.imageSmoothingEnabled = false;    // keep the cells crisp
    ctx.drawImage(g.cv, 0, 0, f.w, f.h);
    ctx.imageSmoothingEnabled = true;
  }
},

/* ── soft body ──────────────────────────────────────────────────────
   A closed loop of Verlet points held together by springs and pushed
   outward by a pressure term proportional to how far the enclosed area
   has strayed from its target. That single area term is what makes it
   wobble like a water balloon instead of collapsing like a rope. */
jelly: {
  init(f){
    const N = 42, cx=f.w/2, cy=f.h*0.55;
    const R = Math.min(f.w,f.h)*0.31;
    f.jp=[]; f.jN=N;
    for(let i=0;i<N;i++){
      const a=i/N*6.2832;
      const x=cx+Math.cos(a)*R, y=cy+Math.sin(a)*R;
      f.jp.push({x,y,px:x,py:y});
    }
    f.jRest = 2*Math.PI*R/N;
    f.jArea = Math.PI*R*R;
  },
  update(f, dt){
    const P=f.jp, N=f.jN;
    const step = Math.min(dt, 1/50);
    const g = 900*(1 - clamp(f.o.viscosity,0,100)/220);
    // Verlet integration
    for(const p of P){
      const vx=(p.x-p.px)*0.985, vy=(p.y-p.py)*0.985;
      p.px=p.x; p.py=p.y;
      p.x+=vx; p.y+=vy + g*step*step;
    }
    // signed area of the current outline
    let area=0;
    for(let i=0;i<N;i++){
      const a=P[i], b=P[(i+1)%N];
      area += (a.x*b.y - b.x*a.y);
    }
    area = Math.abs(area)/2;
    const push = clamp((f.jArea/Math.max(1,area) - 1), -0.5, 1.4) * 2.4;

    for(let it=0; it<4; it++){
      for(let i=0;i<N;i++){
        const a=P[i], b=P[(i+1)%N];
        let dx=b.x-a.x, dy=b.y-a.y;
        const d=Math.hypot(dx,dy)||1;
        const diff=(d-f.jRest)/d*0.5*0.6;
        dx*=diff; dy*=diff;
        a.x+=dx; a.y+=dy; b.x-=dx; b.y-=dy;
        // pressure along the outward normal of this edge
        const nx=-(b.y-a.y)/d, ny=(b.x-a.x)/d;
        a.x+=nx*push; a.y+=ny*push; b.x+=nx*push; b.y+=ny*push;
      }
      // container
      const m=3;
      for(const p of P){
        if(p.x<m){p.x=m;p.px=p.x+(p.px-p.x)*-0.4;}
        if(p.x>f.w-m){p.x=f.w-m;p.px=p.x+(p.px-p.x)*-0.4;}
        if(p.y>f.h-m){p.y=f.h-m;p.px=p.x+(p.px-p.x)*0.6;p.py=p.y+(p.py-p.y)*-0.35;}
        if(p.y<m){p.y=m;p.py=p.y+(p.py-p.y)*-0.4;}
      }
    }
  },
  draw(f, ctx){
    const P=f.jp, N=f.jN;
    ctx.beginPath();
    ctx.moveTo((P[0].x+P[N-1].x)/2, (P[0].y+P[N-1].y)/2);
    for(let i=0;i<N;i++){
      const a=P[i], b=P[(i+1)%N];
      ctx.quadraticCurveTo(a.x, a.y, (a.x+b.x)/2, (a.y+b.y)/2);
    }
    ctx.closePath();
    let minY=Infinity,maxY=-Infinity;
    for(const p of P){ if(p.y<minY)minY=p.y; if(p.y>maxY)maxY=p.y; }
    const g=ctx.createLinearGradient(0,minY,0,maxY);
    g.addColorStop(0, rgba(f.cTop,0.95));
    g.addColorStop(0.5,rgba(f.cMid,0.95));
    g.addColorStop(1, rgba(f.cDeep,0.96));
    ctx.fillStyle=g;
    if(f.o.glow){ ctx.shadowColor=rgba(f.cMid,0.5); ctx.shadowBlur=22; }
    ctx.fill();
    ctx.shadowBlur=0;
    ctx.lineWidth=1.6; ctx.strokeStyle="rgba(255,255,255,.55)"; ctx.stroke();
    ctx.save(); ctx.clip();
    const hx=(P[0].x+P[(N>>1)].x)/2;
    const sg=ctx.createRadialGradient(hx-20, minY+24, 2, hx-20, minY+24, Math.max(30,f.w*0.3));
    sg.addColorStop(0,"rgba(255,255,255,.42)");
    sg.addColorStop(1,"rgba(255,255,255,0)");
    ctx.fillStyle=sg; ctx.fillRect(0,0,f.w,f.h);
    ctx.restore();
  }
},

/* ── particle fluid ─────────────────────────────────────────────────
   Double-density relaxation: each particle measures how crowded it is,
   then pushes its neighbours away in proportion. A near-density term
   with a sharper falloff supplies surface tension, which is what stops
   it fizzing apart into a gas. Splashing, piling and sloshing are all
   consequences — none of them is scripted. */
sph: {
  init(f){
    const n = 110 + Math.round(clamp(f.o.level,0,100)*1.5);
    f.pts=[];
    for(let i=0;i<n;i++){
      f.pts.push({x:rand(f.w*0.15,f.w*0.85), y:rand(f.h*0.15,f.h*0.6), vx:0, vy:0, ox:0, oy:0});
    }
    f.hR = Math.max(14, Math.min(f.w,f.h)/9);
  },
  update(f, dt){
    const P=f.pts, h=f.hR, h2=h*h;
    const step = Math.min(dt, 1/50);
    const k = 0.09, kNear = 0.55, rest = 3.2;
    const grav = 900*(1 - clamp(f.o.viscosity,0,100)/200);

    for(const p of P){ p.vy += grav*step; p.ox=p.x; p.oy=p.y; p.x+=p.vx*step; p.y+=p.vy*step; }

    // uniform grid, so this stays linear rather than quadratic
    const cell=h, cols=Math.max(1,Math.ceil(f.w/cell)), rows=Math.max(1,Math.ceil(f.h/cell));
    const grid=new Array(cols*rows);
    for(let i=0;i<P.length;i++){
      const p=P[i];
      const cxi=clamp(Math.floor(p.x/cell),0,cols-1), cyi=clamp(Math.floor(p.y/cell),0,rows-1);
      const gi=cyi*cols+cxi;
      (grid[gi]||(grid[gi]=[])).push(p);
    }
    const near=[];
    for(const p of P){
      near.length=0;
      const cxi=clamp(Math.floor(p.x/cell),0,cols-1), cyi=clamp(Math.floor(p.y/cell),0,rows-1);
      for(let yy=cyi-1;yy<=cyi+1;yy++){
        if(yy<0||yy>=rows) continue;
        for(let xx=cxi-1;xx<=cxi+1;xx++){
          if(xx<0||xx>=cols) continue;
          const b=grid[yy*cols+xx];
          if(b) for(const q of b) if(q!==p) near.push(q);
        }
      }
      let dens=0, densN=0;
      for(const q of near){
        const dx=q.x-p.x, dy=q.y-p.y, d2=dx*dx+dy*dy;
        if(d2>=h2||d2===0) continue;
        const q1=1-Math.sqrt(d2)/h;
        dens += q1*q1; densN += q1*q1*q1;
      }
      const press=k*(dens-rest), pressN=kNear*densN;
      for(const q of near){
        const dx=q.x-p.x, dy=q.y-p.y, d=Math.sqrt(dx*dx+dy*dy);
        if(d>=h||d===0) continue;
        const q1=1-d/h;
        const disp=(press*q1 + pressN*q1*q1)*step*step*900;
        const ux=dx/d*disp, uy=dy/d*disp;
        q.x+=ux*0.5; q.y+=uy*0.5;
        p.x-=ux*0.5; p.y-=uy*0.5;
      }
    }

    const m=4, bounce=0.35;
    for(const p of P){
      if(p.x<m){p.x=m;} if(p.x>f.w-m){p.x=f.w-m;}
      if(p.y<m){p.y=m;} if(p.y>f.h-m){p.y=f.h-m; p.vy*=-bounce;}
      p.vx=(p.x-p.ox)/step; p.vy=(p.y-p.oy)/step;
      p.vx*=0.995;
    }
  },
  draw(f, ctx){
    const b=buffer(f,"_sph"), c=bctx(f,b);
    c.clearRect(0,0,f.w,f.h);
    const r=f.hR*0.62;
    if(CAN_FILTER) c.filter=`blur(${Math.max(4,r*0.5)}px) contrast(20)`;
    c.fillStyle="#fff";
    for(const p of f.pts){ c.beginPath(); c.arc(p.x,p.y,r,0,6.2832); c.fill(); }
    if(CAN_FILTER) c.filter="none";
    c.globalCompositeOperation="source-in";
    const g=c.createLinearGradient(0,0,0,f.h);
    g.addColorStop(0,rgba(f.cTop,0.97));
    g.addColorStop(1,rgba(f.cDeep,0.97));
    c.fillStyle=g; c.fillRect(0,0,f.w,f.h);
    c.globalCompositeOperation="source-over";
    ctx.drawImage(b,0,0,f.w,f.h);
    // fast particles read as spray on top of the body
    for(const p of f.pts){
      const sp=Math.hypot(p.vx,p.vy);
      if(sp<180) continue;
      ctx.beginPath(); ctx.arc(p.x,p.y,2.2,0,6.2832);
      ctx.fillStyle=`rgba(255,255,255,${clamp((sp-180)/400,0,0.55)})`;
      ctx.fill();
    }
  }
},

/* ── foam ───────────────────────────────────────────────────────────
   Circle packing under buoyancy. Bubbles rise, jostle each other apart,
   crowd against the ceiling and pop. The flat facets where two bubbles
   meet come from the overlap resolution, not from drawing polygons. */
foamPack: {
  init(f){ f.fb=[]; f.fbTimer=0; },
  update(f, dt){
    const B=f.fb;
    f.fbTimer -= dt;
    const target = 18 + Math.round(clamp(f.o.level,0,100)*0.5);
    if(f.fbTimer<=0 && B.length<target){
      f.fbTimer = rand(0.06,0.3);
      B.push({x:rand(f.w*0.1,f.w*0.9), y:f.h+8,
        r:rand(Math.min(f.w,f.h)*0.035, Math.min(f.w,f.h)*0.10),
        vx:0, vy:0, life:rand(4,12), phase:rand(0,6.28)});
    }
    const rise = 26*(1 - clamp(f.o.viscosity,0,100)/200);
    for(const b of B){
      b.phase += dt*1.4;
      b.vy -= rise*dt*(0.5 + 6/b.r);     // small bubbles rise faster
      b.vy *= 0.94; b.vx *= 0.9;
      b.x += b.vx*dt*10 + Math.sin(b.phase)*dt*6;
      b.y += b.vy*dt*10;
      b.life -= dt;
    }
    // separation — the packing itself
    for(let it=0; it<2; it++){
      for(let i=0;i<B.length;i++){
        for(let j=i+1;j<B.length;j++){
          const a=B[i], c=B[j];
          const dx=c.x-a.x, dy=c.y-a.y;
          const d=Math.hypot(dx,dy)||0.01, want=(a.r+c.r)*0.92;
          if(d<want){
            const push=(want-d)/d*0.5;
            a.x-=dx*push; a.y-=dy*push;
            c.x+=dx*push; c.y+=dy*push;
          }
        }
      }
      for(const b of B){
        b.x=clamp(b.x, b.r*0.4, f.w-b.r*0.4);
        if(b.y < b.r*0.5){ b.y=b.r*0.5; b.vy=0; }
      }
    }
    for(let i=B.length-1;i>=0;i--){
      const b=B[i];
      if(b.life<=0 || b.y<b.r*0.55 && Math.random()<dt*0.35){
        f.foam.push({x:b.x, y:b.y, r:b.r*0.6, grow:b.r*3, life:0.32, max:0.32});
        B.splice(i,1);
      }
    }
    for(let i=f.foam.length-1;i>=0;i--){
      const p=f.foam[i]; p.life-=dt; p.r+=p.grow*dt;
      if(p.life<=0) f.foam.splice(i,1);
    }
  },
  draw(f, ctx){
    for(const b of f.fb){
      const g=ctx.createRadialGradient(b.x-b.r*0.3,b.y-b.r*0.35,b.r*0.05,b.x,b.y,b.r);
      g.addColorStop(0, rgba(f.cTop,0.30));
      g.addColorStop(0.72, rgba(f.cMid,0.16));
      g.addColorStop(1, rgba(f.cTop,0.40));
      ctx.fillStyle=g;
      ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,6.2832); ctx.fill();
      ctx.lineWidth=1.1;
      ctx.strokeStyle="rgba(255,255,255,.55)";
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(b.x-b.r*0.3, b.y-b.r*0.33, b.r*0.20, 0, 6.2832);
      ctx.fillStyle="rgba(255,255,255,.75)"; ctx.fill();
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r*0.78, 0.7, 1.9);
      ctx.lineWidth=1.4; ctx.strokeStyle="rgba(255,255,255,.22)"; ctx.stroke();
    }
    for(const p of f.foam){
      const a=clamp(p.life/p.max,0,1);
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,6.2832);
      ctx.lineWidth=1.6; ctx.strokeStyle=`rgba(255,255,255,${a*0.6})`; ctx.stroke();
    }
  }
},

});

/* ── simulation ───────────────────────────────────────────────────── */
Fluid.prototype.update = function(dt){
  this.t += dt;
  const o = this.o;

  const diff = this.target - this.shown;
  if(Math.abs(diff) > 0.01 || Math.abs(this.vel) > 0.01){
    const stiff = 26, damp = 2*Math.sqrt(stiff)*0.92;   // critically damped
    this.vel += (diff*stiff - this.vel*damp)*dt;
    this.shown = clamp(this.shown + this.vel*dt, 0, 100);
    if(o.onLevel) o.onLevel(this.shown);
  }
  const pouring = diff > 0.35;

  // A style owns the simulation outright. Level easing above still runs,
  // so `level` keeps driving whatever the style chooses to do with it.
  if(this.style){
    if(!this._styleReady){ if(this.style.init) this.style.init(this); this._styleReady=true; }
    this.style.update(this, dt);
    return;
  }

  const s = this.surface;
  s.rest = this._restY();

  // Sea mode: three travelling components of different wavelength and
  // speed become the rest line the springs chase. Summing them means the
  // crests never repeat on a visible cycle.
  if(this.o.mode==="sea" && s.restArr){
    const base = s.rest, n = s.n;
    const amp = clamp(this.o.chop,0,100)/100 * Math.min(this.h*0.075, 30);
    for(let i=0;i<n;i++){
      const u = i/(n-1);
      s.restArr[i] = base
        + Math.sin(u*6.1  + this.t*0.92)*amp
        + Math.sin(u*11.7 - this.t*1.38)*amp*0.42
        + Math.sin(u*2.4  + this.t*0.47)*amp*0.72;
    }
  }

  // Fixed-step physics, so the wave behaves the same at 60 and 144 Hz.
  this.acc += dt;
  const step = 1/120;
  let guard = 0;
  while(this.acc >= step && guard++ < 8){ s.tick(); this.acc -= step; }

  const chop = clamp(o.chop,0,100)/100;

  // Ambient life — an occasional nudge keeps a still surface breathing.
  this.ambientTimer -= dt;
  if(this.ambientTimer <= 0 && chop > 0){
    this.ambientTimer = rand(0.7, 2.1) / (0.4 + chop);
    s.disturb((Math.random()*s.n)|0, rand(-0.5,0.5)*chop, Math.max(3, s.n*0.12));
  }

  // Droplets pour while the level climbs, and trickle otherwise so the
  // object is never wholly inert on a slide that just sits there.
  if(o.drops){
    this.dropTimer -= dt;
    if(this.dropTimer <= 0){
      this.dropTimer = pouring ? rand(0.10,0.20) : rand(1.8,4.2);
      this.spawnDrop();
    }
  }

  // A continuous pour, rather than discrete drops. Thick liquids read far
  // better as a ribbon than as a string of beads.
  if(this.o.stream){
    const col = clamp(Math.round((clamp(this.o.spout,0,100)/100)*(s.n-1)),0,s.n-1);
    s.disturb(col, 0.42 + this.o.viscosity/260, Math.max(2, Math.round(s.n*0.03)));
    if(Math.random() < 0.22){
      const sx = this.w*(clamp(this.o.spout,0,100)/100);
      this.spray.push({x:sx+rand(-4,4), y:s.h[col]-2, vx:rand(-40,40), vy:rand(-120,-40),
        r:rand(0.7,1.6), life:rand(0.2,0.4), foam:Math.random()<0.3});
    }
  }

  this._updateCondensation(dt);

  const surfMin = this._surfMin();

  for(let i=this.drops.length-1;i>=0;i--){
    const p=this.drops[i];
    p.vy += 1500*dt; p.y += p.vy*dt;
    const col = clamp(Math.round(p.x/this.w*(s.n-1)), 0, s.n-1);
    if(p.y >= s.h[col]) { this.splash(p, col); this.drops.splice(i,1); }
    else if(p.y > this.h + 40) this.drops.splice(i,1);
  }

  for(let i=this.spray.length-1;i>=0;i--){
    const p=this.spray[i];
    p.vy += 1750*dt; p.x += p.vx*dt; p.y += p.vy*dt; p.life -= dt;
    const col = clamp(Math.round(p.x/this.w*(s.n-1)),0,s.n-1);
    if(p.life<=0 || (p.vy>0 && p.y >= s.h[col])){
      if(p.life>0 && p.r>1.1) s.disturb(col, 0.28, 3);
      this.spray.splice(i,1);
    }
  }

  for(let i=this.foam.length-1;i>=0;i--){
    const f=this.foam[i]; f.life-=dt; f.r += f.grow*dt;
    if(f.life<=0) this.foam.splice(i,1);
  }

  const fizz = clamp(o.fizz,0,100)/100;
  if((o.bubbles || fizz>0) && this.shown > 6){
    this.bubTimer -= dt;
    if(this.bubTimer<=0){
      // Carbonation is a rate change, not a different particle: many more
      // bubbles, smaller and faster, all through the body of the liquid.
      this.bubTimer = fizz>0 ? rand(0.012,0.05)/(0.25+fizz) : rand(0.22,0.75);
      this.spawnBubble(fizz);
    }
  }
  for(let i=this.bubbles.length-1;i>=0;i--){
    const b=this.bubbles[i];
    b.y -= b.vy*dt; b.phase += dt*b.wob;
    const col = clamp(Math.round(b.x/this.w*(s.n-1)),0,s.n-1);
    if(b.y - b.r <= s.h[col] || b.y < surfMin-10){
      s.disturb(col, -0.16*b.r, 3);        // pops, tugging the surface up
      this.bubbles.splice(i,1);
    }
  }
};

Fluid.prototype._surfMin = function(){
  const h=this.surface.h; let m=Infinity;
  for(let i=0;i<h.length;i++) if(h[i]<m) m=h[i];
  return m;
};

Fluid.prototype.spawnDrop = function(){
  if(!this.w) return;
  const x = clamp(this.w*(clamp(this.o.spout,0,100)/100) + rand(-3,3), 6, this.w-6);
  this.drops.push({x, y:-14, vy:rand(70,140), r:rand(3.4,6.2)});
};
Fluid.prototype.spawnBubble = function(fizz){
  const s=this.surface; if(!s) return;
  if(this.bubbles.length > 260) return;
  const x = rand(this.w*0.06, this.w*0.94);
  const col = clamp(Math.round(x/this.w*(s.n-1)),0,s.n-1);
  const f = fizz||0;
  // Fizz rises from anywhere in the body, not just off the floor.
  const floor = f>0 ? rand(s.h[col]+10, this.h-2) : this.h - rand(2,20);
  if(floor <= s.h[col] + 8) return;
  this.bubbles.push({x, y:floor,
    r: f>0 ? rand(0.6,1.9) : rand(1.2,3.4),
    vy: f>0 ? rand(26,74) : rand(14,38),
    phase:rand(0,6.28), wob:rand(1.1,2.4),
    a: f>0 ? rand(0.18,0.46) : rand(0.10,0.30)});
};

/* ── condensation / rain on glass ──────────────────────────────────────
   Beads nucleate all over the vessel, grow slowly, and past a threshold
   break loose and run. A runner absorbs every bead it passes, which is
   the behaviour that reads as condensation rather than as falling dots —
   the track it clears is as recognisable as the drop itself. */
Fluid.prototype._updateCondensation = function(dt){
  const dens = clamp(this.o.condensation,0,100)/100;
  if(dens<=0){ if(this.beads.length){this.beads.length=0;this.streaks.length=0;} return; }
  const rainy = !!this.o.rainy;
  const maxBeads = Math.round(dens * (rainy?150:95));

  this.beadTimer -= dt;
  if(this.beadTimer<=0 && this.beads.length < maxBeads){
    this.beadTimer = rand(0.01,0.06)/(0.2+dens);
    this.beads.push({x:rand(this.w*0.03,this.w*0.97), y:rand(this.h*0.02,this.h*0.98),
      r:rand(0.7,1.9), vy:0, run:false});
  }

  const growth = (rainy?1.5:0.55)*dens;
  const trigger = rainy ? rand(3.0,5.0) : rand(4.2,7.0);

  for(let i=this.beads.length-1;i>=0;i--){
    const b=this.beads[i];
    if(!b.run){
      b.r += growth*dt*rand(0.5,1.5);
      if(b.r > trigger){ b.run=true; b.vy=rand(4,16); b.y0=b.y; }
      continue;
    }
    b.vy += (rainy?260:120)*dt;
    b.y  += b.vy*dt;

    // Absorb what it runs over — area-conserving, so a runner fattens.
    for(let j=this.beads.length-1;j>=0;j--){
      if(j===i) continue;
      const o2=this.beads[j];
      if(o2.run) continue;
      if(Math.abs(o2.x-b.x) < b.r*1.15 && o2.y > b.y-b.r && o2.y < b.y+b.r*2.2){
        b.r = Math.sqrt(b.r*b.r + o2.r*o2.r);
        this.beads.splice(j,1);
        if(j<i) i--;
      }
    }
    b.r -= dt*(rainy?1.1:0.55);            // leaves itself behind as a track

    if(b.r < 1.1 || b.y > this.h+6){
      if(b.y0!=null && b.y-b.y0 > 6)
        this.streaks.push({x:b.x, y0:b.y0, y1:Math.min(b.y,this.h), w:Math.max(0.8,b.r*0.7), life:rainy?0.9:2.2, max:rainy?0.9:2.2});
      this.beads.splice(i,1);
    }
  }

  for(let i=this.streaks.length-1;i>=0;i--){
    const st=this.streaks[i]; st.life-=dt;
    if(st.life<=0) this.streaks.splice(i,1);
  }
};

/* The moment a drop lands: crater, spray, foam ring, entrained bubbles. */
Fluid.prototype.splash = function(p, col){
  const s = this.surface;
  const power = clamp(p.vy/1400, 0.12, 0.85) * (p.r/5) * 3.6;
  s.disturb(col, power, Math.max(3, Math.round(s.n*0.045)));

  const n = 5 + Math.round(Math.random()*6);
  for(let i=0;i<n;i++){
    this.spray.push({
      x:p.x+rand(-3,3), y:s.h[col]-2,
      vx:rand(-95,95), vy:rand(-260,-90),
      r:rand(0.7,2.0), life:rand(0.28,0.62),
      foam: Math.random()<0.45,
    });
  }
  this.foam.push({x:p.x, y:s.h[col], r:p.r*1.1, grow:rand(38,66), life:rand(0.3,0.5), max:0.5});
  for(let i=0;i<3;i++){
    if(this.h - s.h[col] < 14) break;
    this.bubbles.push({x:p.x+rand(-9,9), y:s.h[col]+rand(6,22), r:rand(0.9,2.2),
      vy:rand(16,30), phase:rand(0,6.28), wob:rand(1.2,2.6), a:rand(0.2,0.42)});
  }
};

/* ── rendering ────────────────────────────────────────────────────── */

/* A slow two-component swell added at DRAW time. The simulation stays
   stable and the surface still rolls the way standing water does. */
Fluid.prototype._swell = function(i, n){
  if(this.o.chop<=0 || this.o.mode==="sea") return 0;
  const a = clamp(this.o.chop,0,100)/100;
  const u = n>1 ? i/(n-1) : 0;
  return (Math.sin(u*4.1 + this.t*0.62)*1.5 + Math.sin(u*9.3 - this.t*0.41)*0.7) * a;
};

Fluid.prototype._surfacePath = function(ctx, close){
  const s=this.surface, n=s.n, w=this.w;
  const px=i=>(i/(n-1))*w;
  const py=i=>s.h[i] + this._swell(i,n);
  ctx.beginPath();
  ctx.moveTo(0, py(0));
  for(let i=1;i<n-1;i++){
    const xc=(px(i)+px(i+1))/2, yc=(py(i)+py(i+1))/2;
    ctx.quadraticCurveTo(px(i), py(i), xc, yc);
  }
  ctx.lineTo(px(n-1), py(n-1));
  if(close){ ctx.lineTo(w, this.h+4); ctx.lineTo(0, this.h+4); ctx.closePath(); }
};

Fluid.prototype.draw = function(){
  const ctx=this.ctx, w=this.w, h=this.h;
  if(!ctx || !this.surface) return;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.clearRect(0,0,this.cv.width,this.cv.height);
  ctx.scale(this.d,this.d);

  if(this.mask){ ctx.save(); ctx.clip(this.mask); }

  if(this.style){
    if(!this._styleReady){ if(this.style.init) this.style.init(this); this._styleReady=true; }
    this.style.draw(this, ctx);
    if(this.mask) ctx.restore();
    return;
  }

  const top = this._surfMin();

  /* a slower, darker swell behind the main body — the whole reason a sea
     reads as deep rather than as a single moving line */
  if(this.o.parallax && this.o.mode==="sea"){
    const base = this.surface.rest, n = Math.max(24, Math.round(w/10));
    const amp = clamp(this.o.chop,0,100)/100 * Math.min(h*0.06,22);
    ctx.beginPath();
    ctx.moveTo(0, base + 10);
    for(let i=0;i<=n;i++){
      const u=i/n, x=u*w;
      const y = base + 12 + Math.sin(u*4.3 - this.t*0.42)*amp
                          + Math.sin(u*8.1 + this.t*0.26)*amp*0.4;
      ctx.lineTo(x,y);
    }
    ctx.lineTo(w,h+4); ctx.lineTo(0,h+4); ctx.closePath();
    ctx.fillStyle = rgba(this.cDeep, 0.55);
    ctx.fill();
  }

  /* body */
  const g = ctx.createLinearGradient(0, top-6, 0, h);
  g.addColorStop(0,    rgba(this.cTop, 0.97));
  g.addColorStop(0.22, rgba(this.cMid, 0.96));
  g.addColorStop(1,    rgba(this.cDeep, 0.98));
  ctx.fillStyle=g;
  this._surfacePath(ctx, true);
  ctx.fill();

  /* everything below is confined to the liquid */
  ctx.save();
  this._surfacePath(ctx, true);
  ctx.clip();

  const band = ctx.createLinearGradient(0, top, 0, top + Math.min(90, h*0.4));
  band.addColorStop(0, "rgba(255,255,255,.30)");
  band.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle=band;
  ctx.fillRect(0, top-2, w, Math.min(92, h*0.42));

  if(this.o.chop>0){
    ctx.globalCompositeOperation="lighter";
    for(let i=0;i<2;i++){
      const cx = w*(0.3+0.4*i) + Math.sin(this.t*(0.21+0.09*i) + i*2.1)*w*0.28;
      const cy = top + h*0.18 + Math.cos(this.t*0.17 + i)*10;
      const rr = Math.max(30, w*0.32);
      const cg = ctx.createRadialGradient(cx,cy,0,cx,cy,rr);
      cg.addColorStop(0, rgba(this.cTop, 0.13));
      cg.addColorStop(1, rgba(this.cTop, 0));
      ctx.fillStyle=cg;
      ctx.beginPath(); ctx.arc(cx,cy,rr,0,6.2832); ctx.fill();
    }
    ctx.globalCompositeOperation="source-over";
  }

  for(const b of this.bubbles){
    const bx = b.x + Math.sin(b.phase)*2.2;
    ctx.beginPath(); ctx.arc(bx, b.y, b.r, 0, 6.2832);
    ctx.fillStyle=`rgba(255,255,255,${b.a*0.5})`; ctx.fill();
    ctx.lineWidth=0.8; ctx.strokeStyle=`rgba(255,255,255,${b.a})`; ctx.stroke();
  }
  ctx.restore();

  /* meniscus */
  ctx.save();
  if(this.o.glow){ ctx.shadowColor = rgba(this.cTop, 0.9); ctx.shadowBlur = 14; }
  ctx.lineWidth = 2.1; ctx.lineJoin="round"; ctx.lineCap="round";
  ctx.strokeStyle = "rgba(255,255,255,.94)";
  this._surfacePath(ctx, false);
  ctx.stroke();
  ctx.restore();

  for(const f of this.foam){
    const a = clamp(f.life/f.max, 0, 1);
    ctx.beginPath();
    ctx.ellipse(f.x, f.y, f.r, f.r*0.34, 0, 0, 6.2832);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = `rgba(255,255,255,${0.5*a})`;
    ctx.stroke();
  }

  for(const p of this.drops) this._drawDrop(ctx, p);

  for(const p of this.spray){
    const a = clamp(p.life*2.4, 0, 1);
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832);
    ctx.fillStyle = p.foam ? `rgba(255,255,255,${0.72*a})` : rgba(this.cTop, 0.85*a);
    ctx.fill();
  }

  if(this.o.stream) this._drawStream(ctx);
  if(this.o.foam>0) this._drawFoamHead(ctx);
  if(this.o.whitecaps>0) this._drawWhitecaps(ctx);
  if(this.o.marker>=0) this._drawMarker(ctx);
  if(this.o.condensation>0) this._drawCondensation(ctx);

  if(this.mask) ctx.restore();
};

/* A pour, as a ribbon that narrows as it accelerates. */
Fluid.prototype._drawStream = function(ctx){
  const s=this.surface;
  const u = clamp(this.o.spout,0,100)/100;
  const x = this.w*u;
  const col = clamp(Math.round(u*(s.n-1)),0,s.n-1);
  const yEnd = s.h[col];
  if(yEnd <= 0) return;
  const wTop = 3.4 + this.o.viscosity/16, wBot = wTop*0.62;
  ctx.beginPath();
  ctx.moveTo(x-wTop, -4);
  for(let y=-4; y<=yEnd; y+=8){
    const k = y/Math.max(1,yEnd);
    ctx.lineTo(x - (wTop+(wBot-wTop)*k) + Math.sin(y*0.05 + this.t*3)*0.9, y);
  }
  for(let y=yEnd; y>=-4; y-=8){
    const k = y/Math.max(1,yEnd);
    ctx.lineTo(x + (wTop+(wBot-wTop)*k) + Math.sin(y*0.05 + this.t*3)*0.9, y);
  }
  ctx.closePath();
  const g=ctx.createLinearGradient(x-wTop,0,x+wTop,0);
  g.addColorStop(0,   rgba(this.cMid,0.9));
  g.addColorStop(0.35,rgba(this.cTop,0.98));
  g.addColorStop(1,   rgba(this.cDeep,0.92));
  ctx.fillStyle=g;
  if(this.o.glow){ ctx.shadowColor=rgba(this.cTop,0.7); ctx.shadowBlur=10; }
  ctx.fill();
  ctx.shadowBlur=0;
};

/* Foam head. Positions come from a hash of the column index rather than
   Math.random, so the head sits still instead of boiling every frame. */
Fluid.prototype._drawFoamHead = function(ctx){
  const s=this.surface, n=s.n;
  const thick = clamp(this.o.foam,0,100)/100 * Math.min(this.h*0.16, 46);
  if(thick < 1) return;
  ctx.save();
  this._surfacePath(ctx, true);
  ctx.clip();
  const step = Math.max(4, Math.round(this.w/44));
  for(let x=0; x<=this.w; x+=step){
    const i = clamp(Math.round(x/this.w*(n-1)),0,n-1);
    const y = s.h[i] + this._swell(i,n);
    const hash = (Math.sin(i*12.9898)*43758.5453) % 1;
    const jitter = (hash - Math.floor(hash));
    const rows = Math.max(1, Math.round(thick/7));
    for(let r=0;r<rows;r++){
      const rr = 3 + jitter*4 + r*0.6;
      ctx.beginPath();
      ctx.arc(x + (jitter-0.5)*step, y + 2 + r*(thick/rows), rr, 0, 6.2832);
      ctx.fillStyle = `rgba(255,251,240,${0.92 - r*(0.62/rows)})`;
      ctx.fill();
    }
  }
  ctx.restore();
};

/* Whitecaps break where the surface is steep, which is where a real one
   breaks — so they appear on the front of a rising wave and nowhere else. */
Fluid.prototype._drawWhitecaps = function(ctx){
  const s=this.surface, n=s.n;
  const sens = clamp(this.o.whitecaps,0,100)/100;
  if(sens<=0) return;
  const thresh = 1.5 - sens*1.15;
  for(let i=2;i<n-2;i++){
    const slope = Math.abs(s.h[i+2]-s.h[i-2])/4;
    if(slope < thresh) continue;
    const x=(i/(n-1))*this.w, y=s.h[i];
    const a = clamp((slope-thresh)*0.9, 0, 0.85);
    for(let k=0;k<2;k++){
      ctx.beginPath();
      ctx.arc(x+rand(-3,3), y+rand(-1,4), rand(0.8,2.2), 0, 6.2832);
      ctx.fillStyle=`rgba(255,255,255,${a})`;
      ctx.fill();
    }
  }
};

/* A labelled threshold — the point of a flood graphic. */
Fluid.prototype._drawMarker = function(ctx){
  const m = clamp(this.o.marker,0,100);
  const y = 2 + (1 - m/100)*(this.h-4);
  ctx.save();
  ctx.setLineDash([7,6]);
  ctx.lineWidth=1.6;
  ctx.strokeStyle="rgba(255,255,255,.72)";
  ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(this.w,y); ctx.stroke();
  ctx.setLineDash([]);
  const label=String(this.o.markerLabel||"");
  if(label){
    ctx.font="600 11px ui-sans-serif,system-ui,sans-serif";
    const tw=ctx.measureText(label).width;
    const bx=this.w-tw-20, by=y-9;
    ctx.fillStyle="rgba(8,14,22,.72)";
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(bx,by,tw+14,18,9);
    else ctx.rect(bx,by,tw+14,18);
    ctx.fill();
    ctx.fillStyle="rgba(255,255,255,.92)";
    ctx.fillText(label, bx+7, by+13);
  }
  ctx.restore();
};

/* Beads on the glass, and the tracks the runners cleared. */
Fluid.prototype._drawCondensation = function(ctx){
  for(const st of this.streaks){
    const a = clamp(st.life/st.max,0,1)*0.42;
    const g = ctx.createLinearGradient(st.x,st.y0,st.x,st.y1);
    g.addColorStop(0,"rgba(255,255,255,0)");
    g.addColorStop(0.35,`rgba(255,255,255,${a})`);
    g.addColorStop(1,`rgba(255,255,255,${a*0.5})`);
    ctx.strokeStyle=g;
    ctx.lineWidth=st.w*1.6;
    ctx.lineCap="round";
    ctx.beginPath(); ctx.moveTo(st.x,st.y0); ctx.lineTo(st.x,st.y1); ctx.stroke();
  }
  for(const b of this.beads){
    const g = ctx.createRadialGradient(b.x-b.r*0.35, b.y-b.r*0.4, b.r*0.1, b.x, b.y, b.r);
    g.addColorStop(0,"rgba(255,255,255,.78)");
    g.addColorStop(0.55,"rgba(255,255,255,.24)");
    g.addColorStop(1,"rgba(255,255,255,.06)");
    ctx.fillStyle=g;
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,6.2832); ctx.fill();
    ctx.lineWidth=0.7;
    ctx.strokeStyle="rgba(255,255,255,.26)";
    ctx.stroke();
    if(b.r>2){
      ctx.beginPath();
      ctx.arc(b.x-b.r*0.32,b.y-b.r*0.36,Math.max(0.5,b.r*0.2),0,6.2832);
      ctx.fillStyle="rgba(255,255,255,.9)"; ctx.fill();
    }
  }
};

Fluid.prototype._drawDrop = function(ctx, p){
  const r = p.r;
  const st = clamp(1 + p.vy/900, 1, 2.5);   // elongates with speed
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(1, st);
  if(this.o.glow){ ctx.shadowColor = rgba(this.cTop, 0.85); ctx.shadowBlur = 12; }

  ctx.beginPath();
  ctx.moveTo(0, -r*2.35);
  ctx.quadraticCurveTo(r*1.12, -r*0.5, r*0.88, r*0.32);
  ctx.arc(0, r*0.32, r*0.88, 0, Math.PI, false);
  ctx.quadraticCurveTo(-r*1.12, -r*0.5, 0, -r*2.35);
  ctx.closePath();

  const dg = ctx.createLinearGradient(0, -r*2, 0, r*1.2);
  dg.addColorStop(0, rgba(this.cTop, 0.95));
  dg.addColorStop(0.55, rgba(this.cMid, 0.98));
  dg.addColorStop(1, rgba(this.cDeep, 0.98));
  ctx.fillStyle = dg;
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(0, r*0.18, Math.max(0.9, r*0.24), 0, 6.2832);
  ctx.fillStyle = "rgba(255,255,255,.95)";
  ctx.fill();
  ctx.restore();
};

/* ════════════════════════════════════════════════════════════════════
   6. THE HANNS OBJECT RENDERER
   ════════════════════════════════════════════════════════════════════ */
function defFor(kind){ return OBJECT_DEFS.find(o=>o.kind===kind) || OBJECT_DEFS[0]; }

function renderFluid(el){
  const def   = defFor(el.objectType);
  const lvl   = clamp(Number(el.level)||0, 0, 100);
  const total = Number(el.count)>0 ? Number(el.count) : 0;
  const unit  = String(opt(el,"fluidUnit"));
  const show  = opt(el,"fluidShowValue")!==false;
  const frozen= el.objAnim===false;
  const shapeOpt = opt(el,"fluidShape");
  const shape = (shapeOpt && shapeOpt!=="auto")
    ? shapeOpt : (SHAPE_FOR[el.objectType]||"rect");

  const wrap = document.createElement("div");
  wrap.className = "fluid-obj fluid-"+el.objectType;
  wrap.style.cssText = "position:absolute;inset:0;overflow:hidden;border-radius:inherit;container-type:size;";

  const cv = document.createElement("canvas");
  cv.className = "fluid-canvas";
  cv.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  wrap.appendChild(cv);

  let big=null, sub=null;
  if(show){
    const pos = el.numberPos || "onfill";
    const place = pos==="center" ? "top:50%;transform:translateY(-50%);"
                : pos==="below"  ? "bottom:8%;"
                :                  "top:13%;";
    const size = Number(el.numberSize)>0
      ? Number(el.numberSize)+"px"
      : "clamp(26px,13cqw,84px)";
    const read = document.createElement("div");
    read.className = "fluid-readout";
    read.style.cssText = "position:absolute;left:0;right:0;"+place+
      "text-align:center;pointer-events:none;color:"+(el.numberColor||"#fff")+
      ";text-shadow:0 2px 20px rgba(0,0,0,.38);";
    big = document.createElement("div");
    big.className="fluid-value";
    big.style.cssText = "font:800 "+size+"/1 inherit;letter-spacing:-.025em;font-variant-numeric:tabular-nums;";
    sub = document.createElement("div");
    sub.className="fluid-sub";
    sub.style.cssText = "margin-top:.5em;font-size:.30em;font-weight:500;opacity:.62;";
    read.appendChild(big); read.appendChild(sub);
    wrap.appendChild(read);
  }

  const paint = pct => {
    if(!big) return;
    big.textContent = total ? numFmt(total*pct/100) : Math.round(pct)+"%";
    sub.textContent = total
      ? "of "+numFmt(total)+(unit?" "+unit:"")+" · "+Math.round(pct)+"%"
      : (unit||"");
  };

  const f = new Fluid(cv, {
    level: lvl,
    accent: el.accent || def.accent,
    shape,
    mode:    opt(el,"fluidMode"),
    style:   opt(el,"fluidStyle"),
    drops:   opt(el,"fluidDrops")   !== false,
    bubbles: opt(el,"fluidBubbles") !== false,
    glow:    opt(el,"fluidGlow")    !== false,
    parallax:opt(el,"fluidParallax")=== true,
    rainy:   opt(el,"fluidRainy")   === true,
    stream:  opt(el,"fluidStream")  === true,
    chop:         Number(opt(el,"fluidChop")),
    spout:        Number(opt(el,"fluidSpout")),
    viscosity:    Number(opt(el,"fluidViscosity")),
    fizz:         Number(opt(el,"fluidFizz")),
    foam:         Number(opt(el,"fluidFoam")),
    condensation: Number(opt(el,"fluidCondensation")),
    whitecaps:    Number(opt(el,"fluidWhitecaps")),
    murk:         Number(opt(el,"fluidMurk")),
    marker:       Number(opt(el,"fluidMarker")),
    markerLabel:  String(opt(el,"fluidMarkerLabel")||""),
    frozen,
    onLevel: paint,
  });
  wrap._fluid = f;

  if(frozen){ paint(lvl); }
  else if(el.numberMode==="countup"){ f.shown=0; paint(0); f.setLevel(lvl); }
  else { f.shown = Math.max(0, lvl-9); paint(f.shown); f.setLevel(lvl); }

  // Click to pour — handy when rehearsing, harmless on the audience view.
  wrap.addEventListener("click", (ev)=>{
    if(frozen) return;
    f.wake();                       // it may have gone still
    f.poke(ev);
  });

  return wrap;
}

/* ════════════════════════════════════════════════════════════════════
   7. REGISTRATION — nothing below here touches core
   ════════════════════════════════════════════════════════════════════ */
const Hx = window.Hanns;

if(!Hx){
  console.warn("[hanns-fluid] window.Hanns missing — the engine is available "+
               "as HannsFluid.mount(), but the objects are not registered. "+
               "Load this after hanns_core.js.");
} else {

  /* ── 7a. the Objects drawer ─────────────────────────────────────── */
  const OBJECTS = Hx.OBJECTS || [];
  OBJECT_DEFS.forEach(d=>{ if(!OBJECTS.some(o=>o.kind===d.kind)) OBJECTS.push(d); });

  /* ── 7b. the render hook ────────────────────────────────────────────
     renderObject() asks HannsActors at render time, so wrapping whatever
     is there (core's actors, then studio's data objects) is enough to own
     new kinds outright. Unknown kinds fall through to the previous one. */
  const prev = window.HannsActors || {};
  window.HannsActors = Object.assign({}, prev, {
    ACTOR_KINDS:     prev.ACTOR_KINDS     || new Set(),
    ACTOR_ACTIONS:   prev.ACTOR_ACTIONS   || {},
    ACTOR_HAS_MOOD:  prev.ACTOR_HAS_MOOD  || new Set(),
    ACTOR_HAS_LEVEL: prev.ACTOR_HAS_LEVEL || new Set(),
    isActor(kind){
      return KIND_SET.has(kind) || !!(prev.isActor && prev.isActor(kind));
    },
    renderActor(el){
      if(el && KIND_SET.has(el.objectType)){
        try{ return renderFluid(el); }
        catch(err){
          console.error("[hanns-fluid] render failed for "+el.objectType, err);
          const b=document.createElement("div");
          b.className="hs-box hs-error";
          b.textContent="⚠ "+(el.label||el.objectType)+" could not be drawn.";
          return b;
        }
      }
      return prev.renderActor ? prev.renderActor(el) : document.createElement("div");
    },
    playActorOnce(node, kind, ms){
      if(KIND_SET.has(kind)){
        // "Play once" on a liquid means pour a splash.
        const w = node && node.closest ? node.closest(".fluid-obj") : null;
        const f = w && w._fluid;
        if(f){ f.wake(); for(let i=0;i<7;i++) setTimeout(()=>{ f.spawnDrop(); f.wake(); }, i*70); }
        return;
      }
      if(prev.playActorOnce) prev.playActorOnce(node, kind, ms);
    },
  });

  /* ── 7c. seed a fresh element ───────────────────────────────────── */
  const coreMakeObject = Hx.makeObject;
  if(typeof coreMakeObject === "function"){
    Hx.makeObject = function(kind, over){
      const el = coreMakeObject(kind, over||{});
      if(KIND_SET.has(kind)){
        for(const k in SEED) if(el[k]===undefined) el[k]=SEED[k];
        const preset = PRESETS[kind];
        if(preset) for(const k in preset) if(el[k]===undefined || SEED[k]===el[k]) el[k]=preset[k];
        // core's makeObject always writes numberMode:"static" and
        // showCount:true, so these need overriding rather than defaulting.
        if(!over || over.numberMode   ===undefined) el.numberMode   = SEED.numberMode;
        if(!over || over.numberPos    ===undefined) el.numberPos    = SEED.numberPos;
        if(!over || over.hideContainer===undefined) el.hideContainer = true;
        if(!over || over.showLabel    ===undefined) el.showLabel     = false;
        if(over) Object.assign(el, over);
      }
      return el;
    };
  }

  /* ── 7d. the inspector panels ───────────────────────────────────────
     hanns_editor.js rebuilds #insp-body with innerHTML on every selection
     change. A MutationObserver appends the Liquid panels afterwards.

     The panels are IDEMPOTENT — if the panel already matches the selected
     element the observer returns without touching the DOM. That matters
     because hanns_studio.js watches the same node: without it the two
     observers would retrigger each other forever.

     Every native panel binds `input` on #f-x with
     `el.x = Number(value); renderCanvas(); markDirty();`, so re-dispatching
     that event is a clean way to ask the editor to repaint and mark the
     deck dirty, without reaching into its closure. */
  const inspBody = document.getElementById("insp-body");
  if(inspBody){

    const refresh = ()=>{
      const i=document.getElementById("f-x");
      if(i){ i.dispatchEvent(new Event("input",{bubbles:true})); return true; }
      return false;
    };
    const h=(tag,attrs,kids)=>{
      const n=document.createElement(tag);
      for(const k in (attrs||{})){
        if(k==="class")n.className=attrs[k];
        else if(k==="text")n.textContent=attrs[k];
        else if(k==="html")n.innerHTML=attrs[k];
        else if(k.slice(0,2)==="on")n.addEventListener(k.slice(2),attrs[k]);
        else if(attrs[k]!=null)n.setAttribute(k,attrs[k]);
      }
      (kids||[]).forEach(c=>c&&n.appendChild(c));
      return n;
    };
    const group=(title,kids)=>h("div",{class:"group hf-panel"},
      [h("span",{class:"glabel",text:title})].concat(kids||[]));
    const field=(label,ctrl)=>h("div",{class:"field"},[h("label",{text:label}),ctrl]);

    function slider(el,key,min,max,def,label){
      const box=h("div",{class:"field"});
      const val=(el[key]!=null&&el[key]!=="")?el[key]:def;
      const lab=h("label",{text:label+" "+val});
      const i=h("input",{type:"range",min,max,value:val});
      i.addEventListener("input",()=>{
        el[key]=Number(i.value);
        lab.textContent=label+" "+i.value;
        refresh();
      });
      box.appendChild(lab); box.appendChild(i);
      return box;
    }
    function numberBox(el,key,min,max,def){
      const i=h("input",{type:"number",min,max,value:(el[key]!=null?el[key]:def)});
      i.addEventListener("input",()=>{ el[key]=i.value===""?"":Number(i.value); refresh(); });
      return i;
    }
    function textBox(el,key,ph){
      const i=h("input",{type:"text",value:el[key]==null?"":String(el[key]),placeholder:ph||""});
      i.addEventListener("input",()=>{ el[key]=i.value; refresh(); });
      return i;
    }
    function colourBox(el,key,fallback){
      const i=h("input",{type:"color",value:el[key]||fallback});
      i.addEventListener("input",()=>{ el[key]=i.value; refresh(); });
      return i;
    }
    function toggle(el,key,onLabel,offLabel,defaultOn){
      const cur = el[key]===undefined ? !!defaultOn : el[key]!==false;
      const seg=h("div",{class:"seg"});
      const on =h("button",{type:"button",text:onLabel||"On",class:cur?"active":""});
      const off=h("button",{type:"button",text:offLabel||"Off",class:cur?"":"active"});
      on.addEventListener("click",()=>{el[key]=true;on.classList.add("active");off.classList.remove("active");refresh();});
      off.addEventListener("click",()=>{el[key]=false;off.classList.add("active");on.classList.remove("active");refresh();});
      seg.appendChild(on); seg.appendChild(off);
      return seg;
    }
    function pick(el,key,opts,cur){
      const sel=h("select",{});
      opts.forEach(o=>{
        const op=h("option",{value:o.v,text:o.l});
        if(String(cur)===o.v) op.selected=true;
        sel.appendChild(op);
      });
      sel.addEventListener("change",()=>{ el[key]=sel.value; refresh(); });
      return sel;
    }
    function shapeSelect(el){
      const s=h("select",{});
      SHAPE_LABELS.forEach(o=>{
        const op=h("option",{value:o.v,text:o.l});
        if(String(opt(el,"fluidShape")||"auto")===o.v) op.selected=true;
        s.appendChild(op);
      });
      s.addEventListener("change",()=>{ el.fluidShape=s.value; refresh(); });
      return s;
    }

    let painting=false;
    function fluidPanels(){
      if(painting) return;
      const body=document.getElementById("insp-body");
      if(!body) return;
      const el = Hx.selEl && Hx.selEl();
      const owned = !!(el && el.type==="object" && KIND_SET.has(el.objectType));
      const hasElementPanel = !!document.getElementById("f-x");
      const existing = body.querySelector(".hf-panel");

      if(!owned || !hasElementPanel){
        if(existing) [...body.querySelectorAll(".hf-panel")].forEach(n=>n.remove());
        return;
      }
      // Already correct for this element — leave the DOM alone, or this
      // observer and the studio one will bounce off each other.
      if(existing && existing.getAttribute("data-el")===String(el.id)) return;

      painting=true;
      try{
        [...body.querySelectorAll(".hf-panel")].forEach(n=>n.remove());

        // A liquid has no idle action to play, so the actor controls the
        // editor renders for anything HannsActors claims are removed.
        ["f-actoraction","f-actormood","f-actorplay"].forEach(id=>{
          const n=document.getElementById(id);
          const w=n&&n.closest?n.closest(".field"):null;
          if(w) w.remove(); else if(n) n.remove();
        });

        const def = defFor(el.objectType);

        const main = group("💧  Liquid", [
          slider(el,"level",0,100,def.level,"Fill"),
          field("Total (the “of N” figure)", numberBox(el,"count",0,1000000000,def.count)),
          field("Unit", textBox(el,"fluidUnit","ml")),
          field("Readout", toggle(el,"fluidShowValue","Show","Hide",true)),
          field("Readout colour", colourBox(el,"numberColor","#ffffff")),
          slider(el,"numberSize",0,140,0,"Readout size (0 = auto)"),
        ]);
        main.setAttribute("data-el", String(el.id));

        const d = k => opt(el, k);

        const fx = group("🌊  Surface", [
          field("Style", pick(el,"fluidStyle",[
            {v:"surface", l:"Waterline (waves, drops)"},
            {v:"metaball",l:"Lava lamp (blobs)"},
            {v:"pond",    l:"Pond — from above"},
            {v:"ink",     l:"Ink in water"},
            {v:"drip",    l:"Running paint"},
            {v:"vortex",  l:"Whirlpool"},
            {v:"layers",  l:"Oil on water"},
            {v:"ripple2d",l:"Ripple field (wave grid)"},
            {v:"caustics",l:"Pool caustics"},
            {v:"sand",    l:"Cellular liquid"},
            {v:"jelly",   l:"Water balloon (soft body)"},
            {v:"sph",     l:"Particle fluid"},
            {v:"foamPack",l:"Foam"},
          ],d("fluidStyle"))),
          field("Shape", shapeSelect(el)),
          field("Motion", pick(el,"fluidMode",[
            {v:"tank",l:"Still — springs and ripples"},
            {v:"sea", l:"Sea — rolling swell"},
          ],d("fluidMode"))),
          slider(el,"fluidChop",0,100,d("fluidChop"),"Choppiness"),
          slider(el,"fluidViscosity",0,100,d("fluidViscosity"),"Viscosity (water → honey)"),
          slider(el,"fluidWhitecaps",0,100,d("fluidWhitecaps"),"Whitecaps"),
          field("Wave layer behind", toggle(el,"fluidParallax","On","Off",d("fluidParallax")===true)),
          field("Surface glow",      toggle(el,"fluidGlow","On","Off",d("fluidGlow")!==false)),
        ]);

        const pour = group("💦  Pour & body", [
          field("Falling droplets", toggle(el,"fluidDrops","On","Off",d("fluidDrops")!==false)),
          field("Continuous stream",toggle(el,"fluidStream","On","Off",d("fluidStream")===true)),
          slider(el,"fluidSpout",0,100,d("fluidSpout"),"Pour position"),
          field("Rising bubbles",   toggle(el,"fluidBubbles","On","Off",d("fluidBubbles")!==false)),
          slider(el,"fluidFizz",0,100,d("fluidFizz"),"Carbonation"),
          slider(el,"fluidFoam",0,100,d("fluidFoam"),"Foam head"),
          slider(el,"fluidMurk",0,100,d("fluidMurk"),"Silt / murk"),
        ]);

        const glass = group("🧊  Glass & markers", [
          slider(el,"fluidCondensation",0,100,d("fluidCondensation"),"Condensation"),
          field("Fast streaks (rain)", toggle(el,"fluidRainy","On","Off",d("fluidRainy")===true)),
          slider(el,"fluidMarker",-1,100,d("fluidMarker"),"Threshold line (-1 = off)"),
          field("Threshold label", textBox(el,"fluidMarkerLabel","flood level")),
          h("div",{class:"insp-empty",style:"font-size:.7em;padding-top:.3rem",
            text:"Set Number behaviour to Count up to fill from empty when the slide arrives. Click the liquid on the stage to pour."}),
        ]);

        body.appendChild(main);
        body.appendChild(fx);
        body.appendChild(pour);
        body.appendChild(glass);
      } finally { painting=false; }
    }

    // Do not hear our own edits. The data-el check below already broke
    // the cycle, but disconnecting for the paint is cheaper and stops the
    // studio observer being woken for nothing.
    const mo = new MutationObserver(()=>{ if(!painting) paintPanels(); });
    const watch = ()=>mo.observe(inspBody,{childList:true});
    function paintPanels(){
      mo.disconnect();
      try{ fluidPanels(); }
      finally{ mo.takeRecords(); watch(); }
    }
    watch();
    paintPanels();
  }
}

/* ════════════════════════════════════════════════════════════════════
   8. PUBLIC SURFACE
   ════════════════════════════════════════════════════════════════════ */
window.HannsFluid = {
  version:"1.1.0",
  OBJECTS: OBJECT_DEFS,
  SHAPES,
  Fluid, Surface,
  isFluid: kind => KIND_SET.has(kind),
  renderFluid,
  /* Standalone: HannsFluid.mount(canvas, {level:0, accent:"#22b8f0"}) */
  mount(canvas, opts){ return new Fluid(canvas, opts); },
  /* Programmatic: HannsFluid.make("fluid_tank",{x:60,y:60,level:40}) */
  make(kind, over){
    return (window.Hanns && window.Hanns.makeObject)
      ? window.Hanns.makeObject(kind, over||{}) : null;
  },
};

if(window.Hanns) console.info("[hanns-fluid] "+OBJECT_DEFS.length+" liquid objects registered.");
})();
