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
];
const SHAPE_FOR = {
  fluid_tank:"rect", fluid_glass:"glass", fluid_bottle:"bottle",
  fluid_drop:"droplet", fluid_heart:"heart", fluid_circle:"circle",
};
const KIND_SET = new Set(Object.keys(SHAPE_FOR));

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
  if(restY!=null) this.rest=restY;
};
Surface.prototype.tick = function(){
  const {h,v,n,dL,dR,rest,k,damp,spread} = this;
  for(let i=0;i<n;i++){
    v[i] += k*(rest - h[i]);
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
    level:55, accent:"#22b8f0", shape:"rect",
    drops:true, bubbles:true, chop:34, spout:78, glow:true,
    frozen:false, onLevel:null,
  }, opts||{});

  this.w=0; this.h=0; this.d=1; this.t=0; this.acc=0; this.last=0;
  this.surface=null;
  this.drops=[]; this.spray=[]; this.bubbles=[]; this.foam=[];
  this.dropTimer=0; this.bubTimer=0; this.ambientTimer=0;
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

Fluid.prototype._colors = function(){
  const base = rgb(this.o.accent);
  this.cTop  = mix(base, {r:255,g:255,b:255}, 0.34);   // just under the surface
  this.cMid  = base;
  this.cDeep = mix(base, {r:4,g:24,b:52}, 0.62);       // toward the floor
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
  const restY=this._restY(); s.rest=restY;
  for(let i=0;i<s.n;i++){ s.h[i]=restY + Math.sin(i/s.n*Math.PI*2)*1.6; s.v[i]=0; }
  this.drops.length=this.spray.length=this.foam.length=0;
  this.draw();
  if(this.o.onLevel) this.o.onLevel(this.shown);
};

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

  const s = this.surface;
  s.rest = this._restY();

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

  if(o.bubbles && this.shown > 6){
    this.bubTimer -= dt;
    if(this.bubTimer<=0){ this.bubTimer = rand(0.22,0.75); this.spawnBubble(); }
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
Fluid.prototype.spawnBubble = function(){
  const s=this.surface; if(!s) return;
  const x = rand(this.w*0.08, this.w*0.92);
  const col = clamp(Math.round(x/this.w*(s.n-1)),0,s.n-1);
  const floor = this.h - rand(2,20);
  if(floor <= s.h[col] + 8) return;
  this.bubbles.push({x, y:floor, r:rand(1.2,3.4), vy:rand(14,38),
    phase:rand(0,6.28), wob:rand(1.1,2.4), a:rand(0.10,0.30)});
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
  if(this.o.chop<=0) return 0;
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

  const top = this._surfMin();

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

  if(this.mask) ctx.restore();
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
  const unit  = el.fluidUnit!=null ? String(el.fluidUnit) : "ml";
  const show  = el.fluidShowValue!==false;
  const frozen= el.objAnim===false;
  const shape = (el.fluidShape && el.fluidShape!=="auto")
    ? el.fluidShape : (SHAPE_FOR[el.objectType]||"rect");

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
    drops:   el.fluidDrops   !== false,
    bubbles: el.fluidBubbles !== false,
    glow:    el.fluidGlow    !== false,
    chop:  el.fluidChop  != null ? Number(el.fluidChop)  : 34,
    spout: el.fluidSpout != null ? Number(el.fluidSpout) : 78,
    frozen,
    onLevel: paint,
  });
  wrap._fluid = f;

  if(frozen){ paint(lvl); }
  else if(el.numberMode==="countup"){ f.shown=0; paint(0); f.setLevel(lvl); }
  else { f.shown = Math.max(0, lvl-9); paint(f.shown); f.setLevel(lvl); }

  // Click to pour — handy when rehearsing, harmless on the audience view.
  wrap.addEventListener("click", ()=>{
    if(frozen) return;
    f.wake();                       // it may have gone still
    for(let i=0;i<7;i++) setTimeout(()=>{ f.spawnDrop(); f.wake(); }, i*70);
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
      const lab=h("label",{text:label+" "+(el[key]!=null?el[key]:def)});
      const i=h("input",{type:"range",min,max,value:(el[key]!=null?el[key]:def)});
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
    function shapeSelect(el){
      const s=h("select",{});
      SHAPE_LABELS.forEach(o=>{
        const op=h("option",{value:o.v,text:o.l});
        if((el.fluidShape||"auto")===o.v) op.selected=true;
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

        const fx = group("🌊  Liquid effects", [
          field("Shape", shapeSelect(el)),
          field("Falling droplets", toggle(el,"fluidDrops","On","Off",true)),
          field("Rising bubbles",  toggle(el,"fluidBubbles","On","Off",true)),
          field("Surface glow",    toggle(el,"fluidGlow","On","Off",true)),
          slider(el,"fluidChop",0,100,34,"Choppiness"),
          slider(el,"fluidSpout",0,100,78,"Droplet position"),
          h("div",{class:"insp-empty",style:"font-size:.7em;padding-top:.3rem",
            text:"Set Number behaviour to Count up to make it fill from empty when the slide arrives. Click the liquid on the stage to pour."}),
        ]);

        body.appendChild(main);
        body.appendChild(fx);
      } finally { painting=false; }
    }

    new MutationObserver(()=>{ if(!painting) fluidPanels(); })
      .observe(inspBody,{childList:true});
    fluidPanels();
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
