/* ───────────────────────────────────────────────────────────────────
   Kora — the AI assistant in Kura (Knock-Knock). A headphone-wearing
   music robot that lives in the corner of every owner-facing Kura page.

   Injected by kura/agent_middleware.py, which also writes the config
   block <script type="application/json" id="kora-config">. Everything
   renders inside a shadow root so Kura's page CSS and Kora's can't mix.

   The server does the maths (kura/agent_engine.py); this file draws the
   results, offers downloads, and keeps the robot lively.
   ─────────────────────────────────────────────────────────────────── */
(function(){
"use strict";
if(window.__koraLoaded) return;
window.__koraLoaded = true;

const cfgEl = document.getElementById("kora-config");
if(!cfgEl) return;
let CFG;
try{ CFG = JSON.parse(cfgEl.textContent); }catch(e){ return; }

const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
const FONT = "Archivo, system-ui, sans-serif";
const PALETTE = ["#22d3ee","#ff3f98","#ff8a1f","#8b5cf6","#34d399","#fbbf24","#38bdf8","#f472b6"];
const MAX_STORE = 2_400_000;

/* ── small helpers ─────────────────────────────────────────────────── */
const esc = s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = v=>{
  if(v==null || v==="") return "—";
  const n = Number(v);
  if(typeof v==="boolean" || !isFinite(n) || (typeof v==="string" && v.trim()==="")) return esc(v);
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined,{maximumFractionDigits:1});
};
const isNum = v=>v!==null && v!=="" && typeof v!=="boolean" && isFinite(Number(v));
function h(tag, cls, html){
  const e = document.createElement(tag);
  if(cls) e.className = cls;
  if(html!=null) e.innerHTML = html;
  return e;
}
function store(kind){ try{ return kind==="local" ? window.localStorage : window.sessionStorage; }catch(e){ return null; } }
function sget(key, kind){ const s=store(kind); if(!s) return null; try{ return JSON.parse(s.getItem(key)); }catch(e){ return null; } }
function sset(key, val, kind){ const s=store(kind); if(!s) return; try{ s.setItem(key, JSON.stringify(val)); }catch(e){} }
function md(src){
  const lines = esc(src||"").split(/\n/);
  let out = "", list = false, para = [];
  const flush = ()=>{ if(para.length){ out += "<p>"+para.join("<br>")+"</p>"; para=[]; } };
  for(const ln of lines){
    const m = ln.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if(m){ flush(); if(!list){ out+="<ul>"; list=true; } out += "<li>"+m[1]+"</li>"; continue; }
    if(list){ out += "</ul>"; list=false; }
    if(!ln.trim()){ flush(); continue; }
    para.push(ln);
  }
  flush(); if(list) out += "</ul>";
  return out.replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/`([^`]+)`/g,"<code>$1</code>");
}
function loadScript(src, test){
  if(test()) return Promise.resolve();
  return new Promise((res, rej)=>{
    let s = document.querySelector('script[data-kora-src="'+src+'"]');
    if(!s){ s = document.createElement("script"); s.src = src; s.async = true; s.dataset.koraSrc = src; document.head.appendChild(s); }
    s.addEventListener("load", ()=>test()?res():rej(new Error("library missing")));
    s.addEventListener("error", ()=>rej(new Error("could not load "+src)));
  });
}
const ensureChart = ()=>loadScript(CFG.libs.chart, ()=>!!window.Chart);
let leafletCss = false;
function ensureLeaflet(){
  if(!leafletCss){ const l = h("link"); l.rel="stylesheet"; l.href=CFG.libs.leafletCss; ROOT.appendChild(l); leafletCss = true; }
  return loadScript(CFG.libs.leaflet, ()=>!!window.L);
}

const I = (d, extra)=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'+(extra||"")+'>'+d+'</svg>';
const ICON = {
  send: I('<path d="M4.5 12 20 4.5 15.5 20l-3.2-6.3z"/><path d="m12.3 13.7 7.7-9.2"/>'),
  stop: I('<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  wide: I('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  narrow: I('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>'),
  sound: I('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="M16.5 9a4.5 4.5 0 0 1 0 6"/>'),
  mute: I('<path d="M4 10v4h4l5 4V6L8 10z"/><path d="m17 9.5 4 5M21 9.5l-4 5"/>'),
  close: I('<path d="M6 6l12 12M18 6 6 18"/>'),
  side: I('<path d="M7 8h12l-3-3M17 16H5l3 3"/>'),
  down: I('<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>'),
  open: I('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  alert: I('<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>'),
  check: I('<path d="m5 12 4.5 4.5L19 7"/>'),
  form: I('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>'),
  chart: I('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  pulse: I('<path d="M3 12h4l3-7 4 14 3-7h4"/>'),
  grid: I('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  broom: I('<path d="M14 4 20 10M17 7l-7 7M10 14l-6 6M8 12l4 4"/>'),
  shield: I('<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>'),
  pin: I('<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
};

/* ── the robot ─────────────────────────────────────────────────────── */
let uid = 0;
const NOTE = '<ellipse cx="3" cy="11" rx="3.3" ry="2.5" transform="rotate(-20 3 11)"/><path d="M5.5 11V1h1.6c1.4 2 3.8 2.8 3.2 6.6-.6-2-1.8-2.8-3.2-3V11z"/>';
function robotSVG(){
  const u = "kr" + (++uid);
  const eq = [47,53,59,65,71].map(x=>'<rect x="'+x+'" y="98" width="3.6" height="11" rx="1.6"/>').join("");
  return '<svg class="kbot" viewBox="0 0 120 132" data-state="idle" data-face="norm" data-mouth="smile" aria-hidden="true" focusable="false">'+
  '<defs>'+
    '<linearGradient id="'+u+'h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a61e0"/><stop offset="1" stop-color="#22256c"/></linearGradient>'+
    '<linearGradient id="'+u+'b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d43bd"/><stop offset="1" stop-color="#1b1e5e"/></linearGradient>'+
    '<linearGradient id="'+u+'p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff8a1f"/><stop offset="1" stop-color="#ff3f98"/></linearGradient>'+
    '<filter id="'+u+'g" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.1" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'+
  '</defs>'+
  '<ellipse class="k-shadow" cx="60" cy="126" rx="25" ry="4.5"/>'+
  '<g class="k-bot">'+
    '<g class="k-neckphones"><path d="M28 101 C30 81 90 81 92 101" stroke="url(#'+u+'p)"/>'+
      '<rect x="17" y="90" width="14" height="21" rx="7" fill="url(#'+u+'p)" transform="rotate(-16 24 100)"/>'+
      '<rect x="89" y="90" width="14" height="21" rx="7" fill="url(#'+u+'p)" transform="rotate(16 96 100)"/></g>'+
    '<g class="k-arm k-arm-l"><rect x="26" y="92" width="11" height="24" rx="5.5"/></g>'+
    '<g class="k-arm k-arm-r"><rect x="83" y="92" width="11" height="24" rx="5.5"/></g>'+
    '<rect class="k-neck" x="53" y="79" width="14" height="10" rx="3"/>'+
    '<rect class="k-torso" x="34" y="86" width="52" height="36" rx="15" fill="url(#'+u+'b)"/>'+
    '<rect class="k-screen" x="43" y="95" width="34" height="17" rx="5"/>'+
    '<g class="k-eq">'+eq+'</g>'+
    '<g class="k-head">'+
      '<g class="k-ant"><line x1="70" y1="27" x2="77" y2="13"/><circle class="k-ant-ball" cx="78.5" cy="10" r="4.5"/></g>'+
      '<rect class="k-skull" x="22" y="24" width="76" height="58" rx="25" fill="url(#'+u+'h)"/>'+
      '<path class="k-shine" d="M35 33 Q44 27.5 56 27.5"/>'+
      '<rect class="k-visor" x="30" y="36" width="60" height="34" rx="16"/>'+
      '<g filter="url(#'+u+'g)">'+
        '<g class="k-eyes">'+
          '<g class="k-ex k-ex-norm"><rect class="k-eye" x="43" y="45" width="9" height="15" rx="4.5"/><rect class="k-eye" x="68" y="45" width="9" height="15" rx="4.5"/></g>'+
          '<g class="k-ex k-ex-happy"><path d="M42 55 Q47.5 46 53 55"/><path d="M67 55 Q72.5 46 78 55"/></g>'+
          '<g class="k-ex k-ex-think"><circle cx="48" cy="53" r="3"/><circle cx="60" cy="53" r="3"/><circle cx="72" cy="53" r="3"/></g>'+
          '<g class="k-ex k-ex-note"><g transform="translate(42 44)">'+NOTE+'</g><g transform="translate(67 44)">'+NOTE+'</g></g>'+
          '<g class="k-ex k-ex-wow"><circle cx="47.5" cy="52.5" r="5"/><circle cx="72.5" cy="52.5" r="5"/></g>'+
          '<g class="k-ex k-ex-sad"><rect x="43" y="50" width="9" height="9" rx="4.5" transform="rotate(-20 47.5 54.5)"/><rect x="68" y="50" width="9" height="9" rx="4.5" transform="rotate(20 72.5 54.5)"/></g>'+
          '<g class="k-ex k-ex-sleep"><path d="M42 54 Q47.5 58.5 53 54"/><path d="M67 54 Q72.5 58.5 78 54"/></g>'+
        '</g>'+
        '<path class="k-mouth k-m-smile" d="M54.5 63.5 Q60 67.5 65.5 63.5"/>'+
        '<path class="k-mouth k-m-grin" d="M53.5 62.3 Q60 70.5 66.5 62.3 Z"/>'+
        '<ellipse class="k-mouth k-m-o" cx="60" cy="64.5" rx="2.8" ry="3.2"/>'+
        '<path class="k-mouth k-m-flat" d="M55.5 64.5 L64.5 64.5"/>'+
      '</g>'+
      '<ellipse class="k-cheek" cx="36.5" cy="63.5" rx="4.2" ry="2.4"/><ellipse class="k-cheek" cx="83.5" cy="63.5" rx="4.2" ry="2.4"/>'+
      '<g class="k-headphones"><path class="k-band" d="M18 58 C15 12 105 12 102 58" stroke="url(#'+u+'p)"/>'+
        '<rect x="8" y="43" width="17" height="31" rx="8.5" fill="url(#'+u+'p)"/><rect x="95" y="43" width="17" height="31" rx="8.5" fill="url(#'+u+'p)"/>'+
        '<rect class="k-cup-in" x="12.5" y="50" width="6" height="17" rx="3"/><rect class="k-cup-in" x="101.5" y="50" width="6" height="17" rx="3"/></g>'+
    '</g>'+
    '<g class="k-notes"><g transform="translate(100 34)"><g class="k-note">'+NOTE+'</g></g>'+
      '<g transform="translate(106 46)"><g class="k-note">'+NOTE+'</g></g>'+
      '<g transform="translate(94 40)"><g class="k-note">'+NOTE+'</g></g></g>'+
    '<g class="k-zz"><text x="92" y="24">z</text><text x="101" y="14">Z</text></g>'+
  '</g></svg>';
}

const FACE = {idle:"norm", groove:"norm", listen:"norm", typing:"norm", think:"think", happy:"happy", oops:"sad",
  curious:"wow", wave:"happy", dance:"happy", sleep:"sleep"};
const MOUTH = {happy:"grin", wave:"grin", dance:"grin", oops:"flat", curious:"o", think:"flat", sleep:"flat"};

const Bot = {
  svgs: [], state: "idle", transient: null, tTimer: 0, gx: 0, gy: 0,
  attach(svg){ this.svgs.push(svg); this.paint(); },
  each(fn){ this.svgs.forEach(fn); },
  base(){
    if(S.busy) return "think";
    if(S.open) return S.typing ? "typing" : "listen";
    return S.idleMode;
  },
  paint(){
    const st = this.transient || this.base();
    this.state = st;
    const face = this.faceOverride || FACE[st] || "norm";
    this.each(svg=>{
      svg.setAttribute("data-state", st);
      svg.setAttribute("data-face", face);
      svg.setAttribute("data-mouth", MOUTH[st] || "smile");
      svg.classList.toggle("k-down", S.open && st!=="sleep");
      svg.classList.toggle("k-notes-on", st==="groove" && !REDUCED);
    });
  },
  flash(state, ms){
    clearTimeout(this.tTimer);
    this.transient = state; this.paint();
    this.tTimer = setTimeout(()=>{ this.transient = null; this.paint(); }, ms || 1200);
  },
  burst(){
    if(REDUCED) return;
    this.each(svg=>svg.classList.remove("k-burst"));
    requestAnimationFrame(()=>requestAnimationFrame(()=>this.each(svg=>svg.classList.add("k-burst"))));
    clearTimeout(this.bTimer);
    this.bTimer = setTimeout(()=>this.each(svg=>svg.classList.remove("k-burst")), 1600);
  },
  face(f, ms){
    this.faceOverride = f; this.paint();
    setTimeout(()=>{ this.faceOverride = null; this.paint(); }, ms || 1200);
  },
  blink(){
    if(this.state==="sleep" || this.faceOverride) return;
    this.each(svg=>svg.classList.add("k-blink"));
    setTimeout(()=>this.each(svg=>svg.classList.remove("k-blink")), 120);
  },
  look(px, py){
    if(this.state==="think" || this.state==="sleep") px = py = null;
    this.each(svg=>{
      const eyes = svg.querySelector(".k-eyes");
      if(!eyes) return;
      let gx = 0, gy = 0;
      if(this.state==="typing"){ gx = -2.6; gy = 2.6; }
      else if(px!=null){
        const r = svg.getBoundingClientRect();
        if(!r.width) return;
        const cx = r.left + r.width*.5, cy = r.top + r.height*.4;
        const dx = px - cx, dy = py - cy, d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d/160);
        gx = dx/d*3.4*k; gy = dy/d*2.6*k;
      }
      eyes.setAttribute("transform", "translate("+gx.toFixed(2)+" "+gy.toFixed(2)+")");
    });
  },
};

/* ── tiny synth (off unless the user turns it on) ──────────────────── */
const Sound = {
  on: !!sget("kora:sound","local"), ctx: null,
  play(kind){
    if(!this.on) return;
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = this.ctx || new AC();
      const ctx = this.ctx;
      const notes = {open:[659,988], reply:[523,659,784], oops:[392,294], tap:[880], dance:[523,659,784,1047]}[kind] || [660];
      let t = ctx.currentTime + .01;
      notes.forEach(f=>{
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "triangle"; o.frequency.value = f;
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.07, t+.012);
        g.gain.exponentialRampToValueAtTime(.0001, t+.2);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t+.22); t += .085;
      });
    }catch(e){}
  },
};

/* ── state ─────────────────────────────────────────────────────────── */
const S = {
  code: CFG.code || null, page: CFG.page || "list", title: CFG.title || "", can: CFG.can || {},
  open: !!sget("kora:open"), wide: !!sget("kora:wide","local"), left: sget("kora:side","local")==="left",
  busy: false, typing: false, idleMode: "idle", messages: [], status: null, unread: 0,
  lastActive: Date.now(), controller: null, autoWidened: false,
};
const storeKey = ()=>"kora:v1:" + (S.code || "_");
function loadConversation(){
  const saved = sget(storeKey());
  S.messages = saved && Array.isArray(saved.messages) ? saved.messages : [];
}
function saveConversation(){
  let msgs = S.messages.slice(-40);
  let json = JSON.stringify({messages: msgs});
  let i = 0;
  while(json.length > MAX_STORE && i < msgs.length){
    if(msgs[i].blocks && msgs[i].blocks.length)
      msgs[i] = {...msgs[i], blocks: [{type:"text", text:"(An earlier result — ask again to redraw it.)"}]};
    i++; json = JSON.stringify({messages: msgs});
  }
  sset(storeKey(), {messages: msgs});
}

/* ── build the shell ───────────────────────────────────────────────── */
const host = document.createElement("div");
host.id = "kora-host";
host.setAttribute("data-kora", "1");
document.body.appendChild(host);
const ROOT = host.attachShadow({mode:"open"});
// Keys typed in Kora must not trigger the page's shortcuts (builder delete, dashboard hotkeys…).
["keydown","keyup","keypress"].forEach(t=>host.addEventListener(t, e=>e.stopPropagation()));

if(CFG.libs && CFG.libs.fonts && !document.querySelector('link[data-kora-fonts]')){
  const f = document.createElement("link"); f.rel="stylesheet"; f.href=CFG.libs.fonts; f.dataset.koraFonts="1";
  document.head.appendChild(f);
}

ROOT.innerHTML =
  '<link rel="stylesheet" href="'+esc(CFG.css)+'">'+
  '<div class="kora" style="visibility:hidden">'+
    '<button class="launcher" type="button" aria-expanded="false" aria-label="Open Kora, your Kura assistant (Alt+K)">'+
      '<span class="pad"></span>'+robotSVG()+'<span class="badge" aria-hidden="true"></span></button>'+
    '<div class="teaser" role="status"><span class="tx"></span><button class="x" type="button" aria-label="Dismiss">×</button></div>'+
    '<section class="panel" role="dialog" aria-label="Kora assistant">'+
      '<header class="ph">'+
        '<button class="ph-avatar" type="button" title="Give Kora a spin">'+robotSVG()+'</button>'+
        '<div class="ph-id"><div class="ph-name">Kora <span class="ph-live" title=""></span></div><div class="ph-ctx"></div></div>'+
        '<div class="ph-tools">'+
          '<button class="ib b-new" type="button" title="New conversation" aria-label="New conversation">'+ICON.plus+'</button>'+
          '<button class="ib b-wide" type="button" aria-label="Wide view">'+ICON.wide+'</button>'+
          '<button class="ib b-side" type="button" title="Move Kora to the other side" aria-label="Move Kora to the other side">'+ICON.side+'</button>'+
          '<button class="ib b-sound" type="button" aria-label="Sounds">'+ICON.mute+'</button>'+
          '<button class="ib b-close" type="button" title="Close (Esc)" aria-label="Close">'+ICON.close+'</button>'+
        '</div>'+
      '</header>'+
      '<div class="log" aria-live="polite"></div>'+
      '<div class="chips"></div>'+
      '<form class="composer" autocomplete="off">'+
        '<textarea rows="1" placeholder="Ask Kora anything…" aria-label="Message Kora"></textarea>'+
        '<button class="send" type="submit" aria-label="Send">'+ICON.send+'</button>'+
      '</form>'+
      '<p class="fine">Kora shares question wording and summary numbers with Google Gemini — never individual answers. Check important results.</p>'+
    '</section>'+
    '<div class="toast" role="status"></div>'+
  '</div>';

const $ = s=>ROOT.querySelector(s);
const K = $(".kora"), LOG = $(".log"), TA = $("textarea"), SEND = $(".send");
ROOT.querySelector("link").addEventListener("load", ()=>{ K.style.visibility = ""; boot(); }, {once:true});
ROOT.querySelector("link").addEventListener("error", ()=>{ K.style.visibility = ""; boot(); }, {once:true});
ROOT.querySelectorAll(".kbot").forEach(svg=>Bot.attach(svg));

/* ── toasts, fetch, downloads ──────────────────────────────────────── */
let toastTimer = 0;
function toast(text, link){
  const t = $(".toast");
  t.innerHTML = esc(text) + (link ? '<a href="'+esc(link.href)+'"'+(link.blank?' target="_blank" rel="noopener"':'')+'>'+esc(link.label)+'</a>' : "");
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove("on"), link ? 7000 : 3200);
}
function headers(){ return {"Content-Type":"application/json","X-CSRFToken":CFG.csrf,"X-Requested-With":"XMLHttpRequest"}; }
function builderDraft(){
  try{
    if(S.page==="builder" && window.KuraBuilder && S.code===CFG.code) return window.KuraBuilder.snapshot().schema;
  }catch(e){}
  return null;
}
async function postJSON(url, body){
  const res = await fetch(url, {method:"POST", headers:headers(), credentials:"same-origin", body:JSON.stringify(body)});
  let data = null;
  try{ data = await res.json(); }catch(e){}
  if(!res.ok || !data || data.ok===false){
    const msg = (data && data.error) || (res.status===403 ? "Your session expired — reload the page." : "The server didn't answer (HTTP "+res.status+").");
    throw new Error(msg);
  }
  return data;
}
function saveBlob(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.style.display = "none";
  ROOT.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
async function download(spec, fmt, btn){
  if(!spec) return;
  btn && btn.classList.add("busy");
  try{
    const res = await fetch(CFG.endpoints.export, {method:"POST", headers:headers(), credentials:"same-origin",
      body:JSON.stringify({code:S.code, page:S.page, spec, format:fmt, draft:builderDraft()})});
    if(!res.ok){
      let j = {}; try{ j = await res.json(); }catch(e){}
      throw new Error(j.error || "The download failed (HTTP "+res.status+").");
    }
    const blob = await res.blob();
    saveBlob(blob, res.headers.get("X-Kora-Filename") || ("kora-export."+fmt));
    if(btn){ btn.classList.add("done"); setTimeout(()=>btn.classList.remove("done"), 1600); }
    Bot.face("happy", 900);
  }catch(e){ toast(e.message); Bot.flash("oops", 900); }
  finally{ btn && btn.classList.remove("busy"); }
}
async function apply(action, payload, btn){
  btn && btn.classList.add("busy");
  try{
    const data = await postJSON(CFG.endpoints.apply, {action, code:S.code, page:S.page, ...payload});
    Bot.flash("happy", 1100); Bot.burst(); Sound.play("reply");
    if(btn){ btn.classList.add("done"); btn.innerHTML = ICON.check + " Done"; }
    return data;
  }catch(e){ toast(e.message); Bot.flash("oops", 900); Sound.play("oops"); return null; }
  finally{ btn && btn.classList.remove("busy"); }
}
function pngFromCanvas(canvas, title){
  const dpr = canvas.width / (canvas.clientWidth || canvas.width);
  const pad = Math.round(20*dpr), head = title ? Math.round(44*dpr) : 0;
  const out = document.createElement("canvas");
  out.width = canvas.width + pad*2; out.height = canvas.height + pad*2 + head;
  const c = out.getContext("2d");
  c.fillStyle = "#0d0f2b"; c.fillRect(0,0,out.width,out.height);
  if(title){ c.fillStyle = "#ffffff"; c.font = "700 "+Math.round(16*dpr)+"px "+FONT; c.fillText(title, pad, pad + Math.round(18*dpr)); }
  c.drawImage(canvas, pad, pad + head);
  return new Promise(res=>out.toBlob(res, "image/png"));
}
function svgBlob(svgEl){
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
  clone.setAttribute("font-family", FONT);
  const vb = (clone.getAttribute("viewBox")||"0 0 400 200").split(/\s+/).map(Number);
  const bg = document.createElementNS("http://www.w3.org/2000/svg","rect");
  bg.setAttribute("x", vb[0]-10); bg.setAttribute("y", vb[1]-10); bg.setAttribute("width", vb[2]+20); bg.setAttribute("height", vb[3]+20);
  bg.setAttribute("fill", "#0d0f2b");
  clone.insertBefore(bg, clone.firstChild);
  clone.setAttribute("viewBox", (vb[0]-10)+" "+(vb[1]-10)+" "+(vb[2]+20)+" "+(vb[3]+20));
  return new Blob([new XMLSerializer().serializeToString(clone)], {type:"image/svg+xml"});
}
function svgToPng(svgEl){
  return new Promise((res, rej)=>{
    const blob = svgBlob(svgEl), url = URL.createObjectURL(blob), img = new Image();
    img.onload = ()=>{
      const scale = 2, c = document.createElement("canvas");
      c.width = (img.width||800)*scale; c.height = (img.height||400)*scale;
      const x = c.getContext("2d"); x.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url); c.toBlob(res, "image/png");
    };
    img.onerror = rej; img.src = url;
  });
}

/* ── block renderers ───────────────────────────────────────────────── */
const LIVE = {charts: new Set(), maps: new Set()};
function destroyLive(){
  LIVE.charts.forEach(c=>{ try{ c.destroy(); }catch(e){} }); LIVE.charts.clear();
  LIVE.maps.forEach(m=>{ try{ m.remove(); }catch(e){} }); LIVE.maps.clear();
}
function shell(b, ctx){
  if(ctx && ctx.compact){
    const wrap = h("div","tile");
    if(b.title) wrap.appendChild(h("div","tt", esc(b.title)));
    const body = h("div",""); wrap.appendChild(body);
    return {wrap, body, head:null, foot:null};
  }
  const wrap = h("div","blk");
  const head = h("div","blk-h");
  head.appendChild(h("div","blk-t", esc(b.title || "")+(b.subtitle?'<div class="blk-sub">'+esc(b.subtitle)+'</div>':"")));
  if(b.title || b.subtitle) wrap.appendChild(head);
  const body = h("div","blk-b"); wrap.appendChild(body);
  const foot = h("div","blk-f");
  return {wrap, body, head, foot, finish(){ if(foot.children.length) wrap.appendChild(foot); }};
}
function btn(label, icon, cls){
  const b = h("button","btn"+(cls?" "+cls:""), (icon?ICON[icon]:"")+esc(label));
  b.type = "button"; return b;
}
function dlButtons(foot, spec, formats){
  if(!spec) return;
  const names = {png:"PNG", svg:"SVG", xlsx:"Excel", csv:"CSV", html:"HTML", geojson:"GeoJSON", kuraform:"Kura Form (Excel)", json:"JSON"};
  formats.forEach(f=>{
    if(typeof f === "function"){ f(foot); return; }
    const b = btn(names[f]||f, "down");
    b.title = "Download as "+(names[f]||f);
    b.addEventListener("click", ()=>download(spec, f, b));
    foot.appendChild(b);
  });
}
function promptBtn(foot, label, text, icon){
  const b = btn(label, icon || null);
  b.addEventListener("click", ()=>send(text));
  foot.appendChild(b);
}
function noteFilters(body, b){
  if(b.filters) body.appendChild(h("span","filt", "Only: "+esc(b.filters)));
}
function caption(body, b){ if(b.caption) body.appendChild(h("p","cap", esc(b.caption))); }

function chartConfig(b, pal, compact){
  const t = b.chart || "bar";
  const type = t==="hbar"||t==="stacked" ? "bar" : t==="donut" ? "doughnut" : t==="area" ? "line" : t;
  const round = ["pie","doughnut","polarArea"].includes(type);
  const labels = b.labels || [];
  const series = b.series || [];
  const many = series.length > 1;
  const datasets = series.map((s,i)=>{
    const col = pal[i % pal.length];
    if(type==="scatter") return {label:s.name, data:s.data, backgroundColor:col+"cc", borderColor:col, pointRadius:3.5};
    return {
      label: s.name, data: s.data,
      backgroundColor: round ? labels.map((_,j)=>pal[j%pal.length]) : (type==="line" ? col+"33" : col),
      borderColor: round ? "#0d0f2b" : col,
      borderWidth: round ? 2 : (type==="line" ? 2.4 : 0),
      fill: t==="area", tension: .35,
      pointRadius: type==="line" ? (labels.length > 40 ? 0 : 2.5) : 3,
      borderRadius: type==="bar" ? 6 : 0, maxBarThickness: 46,
    };
  });
  const tick = {color:"#a9b2d8", font:{family:FONT, size:11}};
  const trunc = v=>{ const s = String(v); return s.length > 22 ? s.slice(0,21)+"…" : s; };
  return {type, data:{labels, datasets}, options:{
    responsive:true, maintainAspectRatio:false, animation: REDUCED ? false : {duration:650},
    indexAxis: t==="hbar" ? "y" : "x",
    plugins:{
      legend:{display: round || many, position: (round && !compact) ? "right" : "bottom",
        labels:{color:"#c8cff0", boxWidth:10, boxHeight:10, font:{family:FONT, size:11}}},
      tooltip:{callbacks:{label:(c)=>{
        const v = type==="scatter" ? "("+fmt(c.raw.x)+", "+fmt(c.raw.y)+")" : fmt(c.raw);
        const p = b.percent && !many && b.percent[c.dataIndex]!=null ? " ("+b.percent[c.dataIndex]+"%)" : "";
        return " "+(c.dataset.label||"")+": "+v+p;
      }}},
    },
    scales: round ? {} : type==="radar" ? {r:{grid:{color:"rgba(255,255,255,.1)"}, angleLines:{color:"rgba(255,255,255,.1)"},
        pointLabels:{color:"#c8cff0", font:{family:FONT, size:11}}, ticks:{display:false}}} : {
      x:{stacked:t==="stacked", grid:{display:t==="hbar"||type==="scatter", color:"rgba(255,255,255,.07)"},
        ticks:{...tick, maxRotation:40, autoSkip:true, callback: t==="hbar" ? undefined : function(v){ return trunc(this.getLabelForValue ? this.getLabelForValue(v) : v); }},
        title:{display:!!(b.x_label && !compact && type==="scatter"), text:b.x_label, color:"#a9b2d8"}},
      y:{stacked:t==="stacked", beginAtZero:type!=="scatter", grid:{color:"rgba(255,255,255,.07)", display:t!=="hbar"},
        ticks:{...tick, callback: t==="hbar" ? function(v){ return trunc(this.getLabelForValue(v)); } : undefined},
        title:{display:!!(b.y_label && !compact && type==="scatter"), text:b.y_label, color:"#a9b2d8"}},
    },
  }};
}
function drawChart(box, b, pal, compact){
  ensureChart().then(()=>{
    const old = box.querySelector("canvas");
    if(old && old._kchart){ old._kchart.destroy(); LIVE.charts.delete(old._kchart); old.remove(); }
    const c = document.createElement("canvas"); box.appendChild(c);
    const chart = new window.Chart(c, chartConfig(b, pal, compact));
    c._kchart = chart; LIVE.charts.add(chart);
  }).catch(()=>{ box.innerHTML = '<p class="cap">Charts need the Chart.js library — check your connection.</p>'; });
}

const R = {};
R.text = (b, ctx)=>{ const s = shell(b, ctx); s.body.innerHTML = '<div class="say">'+md(b.text)+'</div>'; s.finish && s.finish(); return s.wrap; };
R.error = (b, ctx)=>{
  if(ctx && ctx.compact){ const s = shell(b, ctx); s.body.innerHTML = '<p class="cap">'+esc(b.text)+'</p>'; return s.wrap; }
  return h("div","err", ICON.alert + "<span>"+esc(b.text||"That didn't work.")+"</span>");
};

R.chart = (b, ctx)=>{
  const s = shell(b, ctx);
  const pal = (ctx && ctx.palette) || PALETTE;
  const box = h("div","chartbox"); s.body.appendChild(box);
  drawChart(box, b, pal, ctx && ctx.compact);
  if(ctx && ctx.compact) return s.wrap;
  const single = (b.series||[]).length === 1 && ["bar","hbar","pie","donut"].includes(b.chart) && b.spec;
  if(single){
    const seg = h("div","seg");
    [["bar","Bars"],["hbar","Rows"],["donut","Donut"],["pie","Pie"]].forEach(([k,l])=>{
      const x = h("button","",l); x.type="button"; x.setAttribute("aria-pressed", String(b.chart===k));
      x.addEventListener("click", ()=>{
        b.chart = k; b.spec.kind = k;
        seg.querySelectorAll("button").forEach(y=>y.setAttribute("aria-pressed", String(y===x)));
        drawChart(box, b, pal, false); saveConversation();
      });
      seg.appendChild(x);
    });
    s.head.appendChild(seg);
  }
  noteFilters(s.body, b); caption(s.body, b);
  const png = btn("PNG","down");
  png.addEventListener("click", async ()=>{
    const c = box.querySelector("canvas"); if(!c) return;
    const blob = await pngFromCanvas(c, b.title);
    saveBlob(blob, (b.title||"kora-chart").replace(/[^\w-]+/g,"-").slice(0,50)+".png");
  });
  s.foot.appendChild(png);
  dlButtons(s.foot, b.spec, ["xlsx","csv","html"]);
  s.finish(); return s.wrap;
};

function tableEl(cols, rows, links){
  const numeric = cols.map(c=>rows.slice(0,40).every(r=>r[c]==null || r[c]==="" || isNum(r[c])));
  const wrap = h("div","tbl");
  let html = "<table><thead><tr>"+cols.map(c=>"<th>"+esc(c)+"</th>").join("")+"</tr></thead><tbody>";
  rows.forEach(r=>{
    html += "<tr>"+cols.map((c,i)=>{
      const v = r[c];
      if(links && c==="Code" && links[v]) return '<td><a href="'+esc(links[v])+'">'+esc(v)+'</a></td>';
      return '<td class="'+(numeric[i]?"num":"")+'" title="'+esc(v)+'">'+(numeric[i]?fmt(v):esc(v))+"</td>";
    }).join("")+"</tr>";
  });
  wrap.innerHTML = html + "</tbody></table>";
  return wrap;
}
R.table = (b, ctx)=>{
  const s = shell(b, ctx);
  const cols = b.columns || (b.rows && b.rows[0] ? Object.keys(b.rows[0]) : []);
  s.body.appendChild(tableEl(cols, b.rows || [], b.links));
  if(ctx && ctx.compact) return s.wrap;
  if(b.total && b.rows && b.total > b.rows.length)
    s.body.appendChild(h("div","more", "Showing "+fmt(b.rows.length)+" of "+fmt(b.total)+" — the download has every row."));
  noteFilters(s.body, b);
  if(b.row_level && !S.can.export) s.body.appendChild(h("p","cap","Row-level downloads need export rights on this survey."));
  else dlButtons(s.foot, b.spec, ["xlsx","csv","html"]);
  s.finish(); return s.wrap;
};

R.cards = (b, ctx)=>{
  const s = shell(b, ctx);
  const g = h("div","cards");
  (b.cards||[]).forEach(c=>{
    const v = c.format==="percent" ? fmt(c.value)+"%" : fmt(c.value);
    g.appendChild(h("div","card", '<div class="v">'+v+'</div><div class="l">'+esc(c.label)+'</div>'+
      (c.hint?'<div class="h">'+esc(c.hint)+'</div>':"")+
      (c.progress!=null?'<div class="bar"><i style="width:'+Math.max(0,Math.min(100,c.progress))+'%"></i></div>':"")));
  });
  s.body.appendChild(g);
  if(ctx && ctx.compact) return s.wrap;
  dlButtons(s.foot, b.spec, ["xlsx","csv","html"]);
  s.finish(); return s.wrap;
};

R.map = (b, ctx)=>{
  const s = shell(b, ctx);
  const pal = (ctx && ctx.palette) || PALETTE;
  const box = h("div","mapbox"); s.body.appendChild(box);
  const groups = b.legend || [];
  const colour = g=>pal[Math.max(0, groups.indexOf(g)) % pal.length];
  ensureLeaflet().then(()=>{
    const L = window.L;
    const m = L.map(box, {scrollWheelZoom:false, attributionControl:true, zoomControl:!(ctx&&ctx.compact)});
    LIVE.maps.add(m);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
      {attribution:"© OpenStreetMap © CARTO", maxZoom:19}).addTo(m);
    (b.points||[]).forEach(p=>{
      const mk = L.circleMarker([p.lat, p.lng], {radius:5, weight:1, color:"#ffffff", fillColor:colour(p.group), fillOpacity:.88});
      if(p.group) mk.bindTooltip(esc(p.group));
      mk.addTo(m);
    });
    if(b.bounds) m.fitBounds(b.bounds, {padding:[18,18], maxZoom:14}); else m.setView([13.45,-15.4], 8);
    setTimeout(()=>m.invalidateSize(), 120);
  }).catch(()=>{ box.innerHTML = '<p class="cap" style="padding:10px">Maps need the Leaflet library — check your connection.</p>'; });
  if(groups.length){
    s.body.appendChild(h("div","legend", groups.map(g=>'<span><i style="background:'+colour(g)+'"></i>'+esc(g)+'</span>').join("")));
  }
  if(ctx && ctx.compact) return s.wrap;
  noteFilters(s.body, b); caption(s.body, b);
  dlButtons(s.foot, b.spec, ["csv","geojson","html"]);
  s.finish(); return s.wrap;
};

const SHAPE_ICONS = {
  person:'<circle cx="12" cy="6" r="4"/><path d="M4 22c0-5 3.6-8 8-8s8 3 8 8z"/>',
  home:'<path d="M3 11 12 3l9 8v10H3z"/>',
  drop:'<path d="M12 2s7 8 7 13a7 7 0 0 1-14 0c0-5 7-13 7-13z"/>',
  leaf:'<path d="M4 20C4 9 11 4 21 3c-1 10-6 17-17 17z"/>',
  star:'<path d="m12 2 3 7h7l-5.5 4.5 2 7.5L12 17l-6.5 4 2-7.5L2 9h7z"/>',
  heart:'<path d="M12 21s-9-6-9-12a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6-9 12-9 12z"/>',
};
function shapeSVG(b, pal){
  const items = b.items || [], k = b.kind, T = "#f4f6ff", M = "#a9b2d8";
  const val = it=>it.pct!=null ? it.pct+"%" : fmt(it.value);
  if(k==="pictogram"){
    const rows = items.slice(0,3);
    let out = "";
    rows.forEach((it,r)=>{
      const on = Math.round((it.pct||0)/10);
      for(let i=0;i<10;i++) out += '<g transform="translate('+(i*36)+' '+(r*62)+') scale(1.3)" fill="'+(i<on?pal[r%pal.length]:"rgba(255,255,255,.14)")+'">'+SHAPE_ICONS[b.icon||"person"]+'</g>';
      out += '<text x="0" y="'+(r*62+50)+'" fill="'+T+'" font-size="14" font-weight="700">'+esc(val(it))+' <tspan fill="'+M+'" font-weight="500">'+esc(it.label)+'</tspan></text>';
    });
    return '<svg viewBox="0 0 360 '+(rows.length*62)+'" font-family="'+FONT+'">'+out+'</svg>';
  }
  if(k==="funnel"){
    const max = Math.max(1, ...items.map(i=>Number(i.value)||0)), hgt = 34;
    return '<svg viewBox="0 0 400 '+(items.length*(hgt+8))+'" font-family="'+FONT+'">'+items.map((it,i)=>{
      const w = 130 + 270*(Number(it.value)||0)/max, x = (400-w)/2, y = i*(hgt+8);
      return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+hgt+'" rx="10" fill="'+pal[i%pal.length]+'"/>'+
        '<text x="200" y="'+(y+22)+'" text-anchor="middle" fill="#fff" font-size="12.5" font-weight="700">'+esc(String(it.label).slice(0,28))+' · '+fmt(it.value)+(it.pct!=null?' ('+it.pct+'%)':'')+'</text>';
    }).join("")+'</svg>';
  }
  if(k==="bars" || k==="pill"){
    return '<svg viewBox="0 0 400 '+(items.length*44)+'" font-family="'+FONT+'">'+items.map((it,i)=>{
      const y = i*44, p = Math.max(0, Math.min(100, it.pct||0));
      return '<text x="0" y="'+(y+14)+'" fill="'+M+'" font-size="12">'+esc(String(it.label).slice(0,46))+'</text>'+
        '<rect x="0" y="'+(y+21)+'" width="340" height="12" rx="6" fill="rgba(255,255,255,.12)"/>'+
        '<rect x="0" y="'+(y+21)+'" width="'+(3.4*p)+'" height="12" rx="6" fill="'+pal[i%pal.length]+'"/>'+
        '<text x="400" y="'+(y+32)+'" text-anchor="end" fill="'+T+'" font-size="13" font-weight="800">'+esc(val(it))+'</text>';
    }).join("")+'</svg>';
  }
  const n = Math.max(1, items.length), r = 44, gap = 124;
  return '<svg viewBox="0 0 '+(n*gap)+' 150" font-family="'+FONT+'">'+items.map((it,i)=>{
    const cx = i*gap + gap/2, c = 2*Math.PI*r, p = Math.max(0, Math.min(100, it.pct||0));
    const sweep = k==="gauge" ? .75 : 1, rot = k==="gauge" ? 135 : -90;
    return '<circle cx="'+cx+'" cy="62" r="'+r+'" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="11" stroke-linecap="round" stroke-dasharray="'+(c*sweep)+' '+c+'" transform="rotate('+rot+' '+cx+' 62)"/>'+
      '<circle class="k-ring" cx="'+cx+'" cy="62" r="'+r+'" fill="none" stroke="'+pal[i%pal.length]+'" stroke-width="11" stroke-linecap="round" stroke-dasharray="'+(c*sweep*p/100)+' '+c+'" transform="rotate('+rot+' '+cx+' 62)"/>'+
      '<text x="'+cx+'" y="69" text-anchor="middle" fill="'+T+'" font-size="20" font-weight="800">'+esc(val(it))+'</text>'+
      '<text x="'+cx+'" y="134" text-anchor="middle" fill="'+M+'" font-size="12">'+esc(String(it.label).slice(0,20))+'</text>';
  }).join("")+'</svg>';
}
R.shape = (b, ctx)=>{
  const s = shell(b, ctx);
  const pal = (ctx && ctx.palette) || PALETTE;
  const box = h("div","shapebox", shapeSVG(b, pal)); s.body.appendChild(box);
  if(ctx && ctx.compact) return s.wrap;
  const name = (b.title||"kora-shape").replace(/[^\w-]+/g,"-").slice(0,50);
  const sv = btn("SVG","down"); sv.addEventListener("click", ()=>saveBlob(svgBlob(box.querySelector("svg")), name+".svg"));
  const pn = btn("PNG","down"); pn.addEventListener("click", async ()=>{ try{ saveBlob(await svgToPng(box.querySelector("svg")), name+".png"); }catch(e){ toast("Could not make the PNG."); } });
  s.foot.append(sv, pn);
  dlButtons(s.foot, b.spec, ["xlsx","html"]);
  s.finish(); return s.wrap;
};

function sparkline(trend){
  const vals = trend.map(d=>d.n), max = Math.max(1, ...vals), w = 300, ht = 56, step = w/Math.max(1, vals.length-1);
  const pts = vals.map((v,i)=>[i*step, ht-6-(v/max)*(ht-14)]);
  const line = pts.map((p,i)=>(i?"L":"M")+p[0].toFixed(1)+" "+p[1].toFixed(1)).join(" ");
  const last = pts[pts.length-1] || [0, ht];
  return '<svg class="spark" viewBox="0 0 '+w+' '+ht+'" preserveAspectRatio="none" aria-label="Responses over the last 14 days">'+
    '<defs><linearGradient id="kspk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22d3ee" stop-opacity=".35"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></linearGradient></defs>'+
    '<path d="'+line+' L'+w+' '+ht+' L0 '+ht+' Z" fill="url(#kspk)"/>'+
    '<path d="'+line+'" fill="none" stroke="#22d3ee" stroke-width="2" vector-effect="non-scaling-stroke"/>'+
    '<circle cx="'+last[0]+'" cy="'+last[1]+'" r="3.5" fill="#ff8a1f"/></svg>';
}
R.overview = (b, ctx)=>{
  const s = shell(b, ctx);
  if(s.head) s.head.appendChild(h("span","state-pill "+esc(b.state), esc({collecting:"Collecting",paused:"Paused",closed:"Closed",draft:"Draft"}[b.state]||b.state)));
  const g = h("div","ov-stats");
  (b.stats||[]).forEach(st=>g.appendChild(h("div","card",'<div class="v">'+fmt(st.value)+'</div><div class="l">'+esc(st.label)+'</div>'+(st.hint?'<div class="h">'+esc(st.hint)+'</div>':""))));
  s.body.appendChild(g);
  if((b.trend||[]).length){ const sp = h("div","", sparkline(b.trend)); s.body.appendChild(sp); s.body.appendChild(h("div","more","Last 14 days, one point per day.")); }
  if((b.notes||[]).length) s.body.appendChild(h("ul","ov-notes", b.notes.map(n=>"<li>"+esc(n)+"</li>").join("")));
  if(ctx && ctx.compact) return s.wrap;
  if(S.can.state && S.code){
    const actions = b.state==="collecting" ? [["paused","Pause collection"],["closed","Close the survey"]]
      : (b.state==="paused"||b.state==="closed") ? [["collecting","Resume collection"]] : [];
    actions.forEach(([st,label])=>{
      const x = btn(label, null, st==="collecting"?"primary":"");
      x.addEventListener("click", async ()=>{
        if(st==="closed" && !confirm("Close this survey? Phones and the web link will stop accepting answers.")) return;
        const d = await apply("set_state", {state:st}, x);
        if(d){ toast(d.message); b.state = st; saveConversation(); }
      });
      s.foot.appendChild(x);
    });
  }
  dlButtons(s.foot, b.spec || {tool:"overview"}, ["xlsx","html"]);
  s.finish(); return s.wrap;
};

R.profile = (b, ctx)=>{
  const s = shell(b, ctx);
  const issues = b.issues || [];
  s.body.appendChild(h("p","cap", fmt(b.total_rows)+" rows checked across "+fmt((b.rows||[]).length)+" questions. "+
    (issues.length ? issues.length+" thing(s) to look at:" : "Nothing worrying found.")));
  const list = (arr)=>h("ul","issues", arr.map(i=>'<li class="'+esc(i.level)+'"><span class="dot"></span><span>'+esc(i.text)+'</span></li>').join(""));
  if(issues.length) s.body.appendChild(list(issues.slice(0,8)));
  if(issues.length > 8){
    const d = h("details","more-d", "<summary>"+(issues.length-8)+" more</summary>");
    const inner = h("div",""); inner.appendChild(list(issues.slice(8))); d.appendChild(inner); s.body.appendChild(d);
  }
  const d2 = h("details","more-d", "<summary>Every column</summary>");
  const rows = (b.rows||[]).map(r=>({"Question":r.label, "Answered":r.answered,
    "Health": r.health, "Summary":r.summary}));
  const inner2 = h("div","");
  const t = tableEl(["Question","Answered","Health","Summary"], rows);
  t.querySelectorAll("tbody tr").forEach((tr,i)=>{
    const hv = rows[i].Health, cell = tr.children[2];
    cell.innerHTML = '<span class="health '+(hv<60?"low":hv<90?"mid":"")+'"><i style="width:'+hv+'%"></i></span> '+fmt(hv)+'%';
  });
  inner2.appendChild(t); d2.appendChild(inner2); s.body.appendChild(d2);
  promptBtn(s.foot, "Clean it for me", "Clean my data", "broom");
  if(issues.some(i=>i.level==="privacy")) promptBtn(s.foot, "Make a privacy-safe copy", "Make a privacy-safe copy of my data", "shield");
  dlButtons(s.foot, b.spec, ["xlsx","html"]);
  s.finish(); return s.wrap;
};

R.clean = (b, ctx)=>{
  const s = shell(b, ctx);
  const ba = h("div","ba",
    '<div class="side">Before<b>'+fmt(b.before.rows)+' rows</b>'+fmt(b.before.cols)+' columns · '+fmt(b.before.missing_pct)+'% blank</div>'+
    '<div class="arrow" aria-hidden="true">⟶</div>'+
    '<div class="side">After<b>'+fmt(b.after.rows)+' rows</b>'+fmt(b.after.cols)+' columns · '+fmt(b.after.missing_pct)+'% blank</div>');
  s.body.appendChild(ba);
  s.body.appendChild(h("ol","steps", (b.steps||[]).map(st=>'<li class="'+(st.status==="failed"?"failed":"")+'">'+esc(st.name)+
    '<span class="meta">'+(st.status==="failed" ? "Skipped — "+esc(st.error) :
      (st.changes ? fmt(st.changes)+" change(s)" : "no changes needed")+(st.rows_after!==st.rows_before ? " · "+fmt(st.rows_before-st.rows_after)+" row(s) removed" : ""))+'</span></li>').join("")));
  if(b.note) s.body.appendChild(h("p","cap", esc(b.note)));
  if((b.rows||[]).length){
    const d = h("details","more-d","<summary>Preview the cleaned rows</summary>");
    const inner = h("div",""); inner.appendChild(tableEl(b.columns, b.rows)); d.appendChild(inner); s.body.appendChild(d);
  }
  if(S.can.export) dlButtons(s.foot, b.spec, ["xlsx","csv"]);
  if(S.can.pipelines){
    const sv = btn("Save as Studio pipeline", "grid", "primary");
    sv.addEventListener("click", async ()=>{
      const d = await apply("save_pipeline", {name: b.title || "Kora cleaning pipeline", steps: b.spec.steps}, sv);
      if(d) toast(d.message, {href:d.url, label:"Open in Studio"});
    });
    s.foot.appendChild(sv);
  }
  s.finish(); return s.wrap;
};

R.privacy = (b, ctx)=>{
  const s = shell(b, ctx);
  const kept = b.cols_out - 1;
  s.body.appendChild(h("div","pv-sum",
    '<div class="card"><div class="v">'+fmt(b.rows_out)+'</div><div class="l">rows in the safe copy</div></div>'+
    '<div class="card"><div class="v">'+fmt(b.removed)+'</div><div class="l">columns removed</div></div>'+
    '<div class="card"><div class="v">'+fmt(b.changed)+'</div><div class="l">columns generalised or coded</div></div>'+
    '<div class="card"><div class="v">'+fmt(kept)+'</div><div class="l">columns kept</div></div>'));
  const order = {direct:0, quasi:1, sensitive:2, meta:3, none:4};
  const plan = (b.plan||[]).slice().sort((x,y)=>(order[x.level]??5)-(order[y.level]??5));
  const item = p=>{
    const cls = p.action==="drop" ? "drop" : p.action==="keep" ? "keep" : "change";
    return '<li><span class="lvl '+esc(p.level)+'" title="'+esc(p.level)+'"></span><span class="nm">'+esc(p.label)+
      '<span class="why">'+esc(p.reason || "ordinary answer")+(p.why==="requested"?" · as you asked":"")+'</span></span>'+
      '<span class="tag '+cls+'">'+esc(p.action_text)+'</span></li>';
  };
  const flagged = plan.filter(p=>p.level!=="none"), plain = plan.filter(p=>p.level==="none");
  s.body.appendChild(h("ul","plan", flagged.map(item).join("")));
  if(plain.length){
    const d = h("details","more-d","<summary>"+plain.length+" ordinary column(s), kept as they are</summary>");
    const inner = h("div",""); inner.appendChild(h("ul","plan", plain.map(item).join(""))); d.appendChild(inner); s.body.appendChild(d);
  }
  const k = b.kanon || {};
  if(k.quasi && k.quasi.length){
    s.body.appendChild(h("p","cap", "Re-identification check on "+esc(k.quasi.join(", "))+": smallest group "+fmt(k.min_group)+
      " (target ≥ "+fmt(k.k)+")"+(k.suppressed ? " — "+fmt(k.suppressed)+" row(s) removed to protect people in tiny groups." : ".")));
  }
  if((b.warnings||[]).length) s.body.appendChild(h("div","warns", b.warnings.map(w=>"<p>"+esc(w)+"</p>").join("")));
  if((b.rows||[]).length){
    const d = h("details","more-d","<summary>Preview the safe copy</summary>");
    const inner = h("div",""); inner.appendChild(tableEl(b.columns, b.rows)); d.appendChild(inner); s.body.appendChild(d);
  }
  if(S.can.export) dlButtons(s.foot, b.spec, ["xlsx","csv"]);
  else s.body.appendChild(h("p","cap","Downloads need export rights on this survey."));
  if(S.can.datasets){
    const sv = btn("Save to Data Studio files", "shield", "primary");
    sv.addEventListener("click", async ()=>{
      const d = await apply("save_dataset", {spec:b.spec, name:(S.title||"Survey")+" — privacy-safe"}, sv);
      if(d) toast(d.message, {href:d.url, label:"Open Studio"});
    });
    s.foot.appendChild(sv);
  }
  if(k.at_risk && !k.suppressed) promptBtn(s.foot, "Hide small groups too", "Make the privacy-safe copy again and hide small groups (suppress rows that stay unique)");
  s.finish(); return s.wrap;
};

R.dashboard = (b, ctx)=>{
  const s = shell(b, ctx);
  const grid = h("div","dash");
  (b.items||[]).forEach(it=>{
    const r = R[it.block.type] || R.error;
    const el = r(it.block, {compact:true, palette:b.palette});
    el.style.setProperty("--w", it.w);
    if(it.w <= 4) el.classList.add("half");
    grid.appendChild(el);
  });
  s.body.appendChild(grid);
  if(S.can.dashboards){
    const op = btn("Open as live dashboard", "open", "primary");
    op.addEventListener("click", async ()=>{
      const d = await apply("create_dashboard", {title:b.title, theme:b.theme, tiles:b.spec.tiles}, op);
      if(d) toast(d.message, {href:d.url, label:"Open it"});
    });
    s.foot.appendChild(op);
  }
  dlButtons(s.foot, b.spec, ["html","xlsx"]);
  s.finish(); return s.wrap;
};

const QGLYPH = {section:"§", note:"i", text:"Aa", long_text:"¶", integer:"#", decimal:"#.#", select_one:"◉",
  select_multiple:"☑", rank:"⇅", likert:"⚖", rating:"★", date:"D", time:"T", datetime:"DT", gps:"⌖", mapper:"⬡",
  photo:"▣", barcode:"▮▯", calculate:"ƒ", repeat:"⟳"};
function ruleText(rel){
  if(!rel || !rel.rules || !rel.rules.length) return "";
  const W = {eq:"=", ne:"≠", gt:">", gte:"≥", lt:"<", lte:"≤", selected:"has selected", not_selected:"hasn't selected",
    answered:"is answered", not_answered:"is blank", contains:"contains", between:"between", matches:"matches"};
  return "Shown if "+rel.rules.map(r=>r.rules ? "(…)" : r.q+" "+(W[r.cmp]||"=")+(["answered","not_answered"].includes(r.cmp)?"":" "+r.value))
    .join(rel.op==="or"?" or ":" and ");
}
R.questionnaire = (b, ctx)=>{
  const s = shell({...b, subtitle: fmt(b.count)+" questions"+(b.logic_count?" · "+b.logic_count+" with skip logic":"")}, ctx);
  if(b.description) s.body.appendChild(h("p","cap", esc(b.description)));
  const li = (q, child)=>{
    const opts = (q.choices||[]).map(c=>c.label);
    return '<li class="'+(child?"child ":"")+(q.type==="section"?"sec":"")+'"><span class="ty" title="'+esc(q.type)+'">'+esc(QGLYPH[q.type]||"?")+'</span>'+
      '<span class="qb"><span class="ql">'+esc(q.label)+'</span>'+(q.required?'<span class="req" title="Required">*</span>':"")+
      (opts.length?'<span class="opts">'+esc(opts.slice(0,5).join(" · "))+(opts.length>5?" · +"+(opts.length-5):"")+'</span>':"")+
      (q.relevant?'<span class="logic">'+esc(ruleText(q.relevant))+'</span>':"")+'</span></li>';
  };
  // Show a skip rule only where it changes, so a form gated on consent
  // doesn't repeat "Shown if consent = yes" on every row.
  let html = "", prevRule = "";
  const row = (q, child)=>{
    const rule = q.relevant ? JSON.stringify(q.relevant) : "";
    const out = li(rule && rule===prevRule ? {...q, relevant:null} : q, child);
    prevRule = rule; return out;
  };
  (b.questions||[]).forEach(q=>{ html += row(q,false); (q.children||[]).forEach(c=>{ html += row(c,true); }); });
  s.body.appendChild(h("ul","qlist", html));
  const qs = b.questions || [];
  const onBuilder = S.page==="builder" && window.KuraBuilder && S.code===CFG.code;
  if(onBuilder){
    const add = btn("Add to this form", "plus", "primary");
    add.addEventListener("click", ()=>{
      const n = window.KuraBuilder.addQuestions(JSON.parse(JSON.stringify(qs)));
      if(n){ add.classList.add("done"); add.innerHTML = ICON.check+" Added "+n; toast("Added "+n+" question(s) to your form — it saves automatically."); Bot.flash("happy",1100); Bot.burst(); Sound.play("reply"); }
    });
    const rep = btn("Replace this form", null);
    rep.addEventListener("click", ()=>{
      if(!confirm("Replace every question in this form with Kora's draft? You can't undo this.")) return;
      const n = window.KuraBuilder.replaceQuestions(JSON.parse(JSON.stringify(qs)), {title:b.title, description:b.description});
      if(n){ rep.classList.add("done"); rep.innerHTML = ICON.check+" Replaced"; toast("Form replaced with "+n+" question(s)."); Bot.flash("happy",1100); }
    });
    s.foot.append(add, rep);
  } else if(S.code && S.can.build){
    const add = btn("Add to this survey's form", "plus", "primary");
    add.addEventListener("click", async ()=>{
      const d = await apply("add_questions", {questions:qs, mode:"append"}, add);
      if(d) toast(d.message, {href:d.url, label:"Open the builder"});
    });
    s.foot.appendChild(add);
  }
  const mk = btn("Create a new survey", "form", onBuilder || (S.code && S.can.build) ? "" : "primary");
  mk.addEventListener("click", async ()=>{
    const d = await apply("create_survey", {title:b.title, description:b.description, questions:qs}, mk);
    if(d) toast(d.message, {href:d.url, label:"Open the builder"});
  });
  s.foot.appendChild(mk);
  dlButtons(s.foot, b.spec, ["kuraform","json"]);
  s.finish(); return s.wrap;
};

R.lint = (b, ctx)=>{
  const s = shell(b, ctx);
  const sm = b.summary || {};
  s.body.appendChild(h("p","cap", fmt(sm.questions)+" questions, "+fmt(sm.required)+" required, "+fmt(sm.warnings)+" warning(s)."));
  const issues = b.issues || [];
  if(issues.length) s.body.appendChild(h("ul","issues", issues.map(i=>'<li class="'+esc(i.level)+'"><span class="dot"></span><span>'+esc(i.text)+'</span></li>').join("")));
  else s.body.appendChild(h("p","cap","No problems found — nice work."));
  dlButtons(s.foot, b.spec, ["xlsx"]);
  s.finish(); return s.wrap;
};

/* ── conversation rendering ────────────────────────────────────────── */
function renderMessage(m){
  const wrap = h("div","msg "+(m.role==="user"?"user":"bot"));   // not "kora": that's the root's class
  if(m.role==="user"){ wrap.appendChild(h("div","bub", esc(m.text))); return wrap; }
  if(m.text) wrap.appendChild(h("div","say", md(m.text)));
  (m.blocks||[]).forEach(b=>{
    try{ wrap.appendChild((R[b.type] || R.error)(b, null)); }
    catch(e){ wrap.appendChild(R.error({text:"Could not draw this result."})); }
  });
  if(m.notice) wrap.appendChild(h("div","notice", ICON.info+"<span>"+esc(m.notice)+"</span>"));
  if((m.suggestions||[]).length && m === S.messages[S.messages.length-1]){
    const sg = h("div","sugg");
    m.suggestions.forEach(t=>{ const c = h("button","chip", esc(t)); c.type="button"; c.addEventListener("click", ()=>send(t)); sg.appendChild(c); });
    wrap.appendChild(sg);
  }
  return wrap;
}
function welcome(){
  const name = CFG.user ? ", "+CFG.user : "";
  const w = h("div","hello");
  const onSurvey = !!S.code;
  w.innerHTML = '<h3>Hi'+esc(name)+'. I’m Kora.</h3><p>'+(onSurvey
    ? "I can tell you how <strong>"+esc(S.title||"this survey")+"</strong> is doing, chart and map its answers, clean it, and make a privacy-safe copy — all downloadable."
    : "I can draft a questionnaire for you, or pick a survey above and I’ll dig into its data.")+'</p>';
  const skills = onSurvey ? [
    ["pulse","How is it going?","Responses, today, trend","How is collection going?"],
    ["chart","Charts and tables","Any question, any split","Chart the main questions"],
    ["grid","A dashboard","Live board or HTML file","Make a dashboard"],
    ["pin","Map it","Where answers came from","Map the responses"],
    ["broom","Clean my data","Find and fix problems","Find data problems in my data"],
    ["shield","Privacy-safe copy","Remove personal data","Make a privacy-safe copy of my data"],
  ] : [
    ["form","Draft a questionnaire","Tell me the topic","Draft a questionnaire about "],
    ["pulse","My surveys","Responses at a glance","Show my surveys"],
  ];
  if(onSurvey && S.page==="builder") skills.unshift(["form","Review this form","Spot problems early","Review my form"]);
  const g = h("div","skills");
  skills.slice(0,6).forEach(([ic,t,sub,prompt])=>{
    const b = h("button","skill", ICON[ic]+"<span><b>"+esc(t)+"</b><span>"+esc(sub)+"</span></span>");
    b.type = "button";
    b.addEventListener("click", ()=>{ if(prompt.endsWith(" ")){ TA.value = prompt; TA.focus(); autosize(); } else send(prompt); });
    g.appendChild(b);
  });
  w.appendChild(g);
  return w;
}
function renderLog(){
  destroyLive();
  LOG.innerHTML = "";
  if(!S.messages.length) LOG.appendChild(welcome());
  S.messages.forEach(m=>LOG.appendChild(renderMessage(m)));
  renderChips();
  scrollEnd(true);
}
function renderChips(){
  const box = $(".chips");
  box.innerHTML = "";
  if(S.messages.length) return;
  const chips = (S.status && S.status.chips) || [];
  chips.forEach(t=>{ const c = h("button","chip", esc(t)); c.type="button"; c.addEventListener("click", ()=>send(t)); box.appendChild(c); });
}
function scrollEnd(instant){
  requestAnimationFrame(()=>{ LOG.style.scrollBehavior = instant ? "auto" : ""; LOG.scrollTop = LOG.scrollHeight; LOG.style.scrollBehavior = ""; });
}
function appendMessage(m){
  LOG.querySelectorAll(".sugg").forEach(x=>x.remove());
  const hello = LOG.querySelector(".hello"); if(hello) hello.remove();
  $(".chips").innerHTML = "";
  const el = renderMessage(m);
  LOG.appendChild(el);
  // Scroll only the log (scrollIntoView would also nudge the host page).
  // A reply is shown from its top, so a tall dashboard reads from the start.
  if(m.role==="kora") requestAnimationFrame(()=>{
    LOG.scrollTo({top: Math.max(0, el.offsetTop - LOG.offsetTop - 10), behavior: REDUCED ? "auto" : "smooth"});
  });
  else scrollEnd();
}

/* ── sending ───────────────────────────────────────────────────────── */
const THINKING = ["Listening closely…","Reading your columns…","Counting the beats…","Mixing the numbers…","Laying down the tracks…"];
let typingEl = null, typingTimer = 0;
function showTyping(){
  typingEl = h("div","typing", '<span class="eq"><i></i><i></i><i></i><i></i></span><span class="tx">'+THINKING[0]+'</span>');
  LOG.appendChild(typingEl); scrollEnd();
  let i = 0;
  typingTimer = setInterval(()=>{ i = (i+1) % THINKING.length; const t = typingEl && typingEl.querySelector(".tx"); if(t) t.textContent = THINKING[i]; }, 2600);
}
function hideTyping(){ clearInterval(typingTimer); if(typingEl){ typingEl.remove(); typingEl = null; } }
function setBusy(on){
  S.busy = on;
  SEND.classList.toggle("stop", on);
  SEND.innerHTML = on ? ICON.stop : ICON.send;
  SEND.setAttribute("aria-label", on ? "Stop" : "Send");
  Bot.paint();
}
function historyForServer(){
  return S.messages.slice(-9, -1).map(m=>({role:m.role==="user"?"user":"kora", text:m.text||"", made:m.made||[]}));
}
async function send(text){
  text = String(text||"").trim();
  if(!text || S.busy) return;
  if(!S.open) openPanel(true);
  S.messages.push({role:"user", text, ts:Date.now()});
  appendMessage(S.messages[S.messages.length-1]);
  TA.value = ""; autosize(); S.typing = false;
  setBusy(true); showTyping();
  S.controller = window.AbortController ? new AbortController() : null;
  let msg;
  try{
    const res = await fetch(CFG.endpoints.chat, {method:"POST", headers:headers(), credentials:"same-origin",
      signal: S.controller ? S.controller.signal : undefined,
      body: JSON.stringify({message:text, code:S.code, page:S.page, history:historyForServer(), draft:builderDraft()})});
    let data = null; try{ data = await res.json(); }catch(e){}
    if(!res.ok || !data || !data.ok) throw new Error((data && data.error) || (res.status===403 ? "Your session expired — reload the page and try again." : res.status===504 ? "That took too long — try a smaller request." : "I couldn't reach the server (HTTP "+res.status+")."));
    msg = {role:"kora", text:data.say, blocks:data.blocks||[], suggestions:data.suggestions||[], notice:data.notice||null,
      made:data.made||[], mood:data.mood, ts:Date.now()};
    if(S.status) S.status.quotaLeft = data.quotaLeft;
    // Say why Kora is in built-in mode once, not under every reply.
    const prevNotice = [...S.messages].reverse().find(x=>x.role==="kora" && x.notice);
    if(msg.notice && prevNotice && prevNotice.notice===msg.notice) msg.notice = null;
    if(!S.autoWidened && !S.wide && window.innerWidth > 980 && msg.blocks.some(b=>b.type==="dashboard")){ S.autoWidened = true; setWide(true); }
  }catch(e){
    const aborted = e && e.name==="AbortError";
    msg = {role:"kora", text: aborted ? "Stopped. Ask me again whenever you're ready." : "", blocks: aborted ? [] : [{type:"error", text:e.message||"Something went wrong."}], mood: aborted?"curious":"oops", ts:Date.now()};
  }finally{
    hideTyping(); setBusy(false); S.controller = null;
  }
  S.messages.push(msg);
  appendMessage(msg);
  saveConversation(); updateLive();
  react(msg.mood);
  if(!S.open || document.hidden){ S.unread++; updateBadge(); }
}
function react(mood){
  if(mood==="oops"){ Bot.flash("oops", 1200); Sound.play("oops"); return; }
  if(mood==="curious"){ Bot.flash("curious", 1300); Sound.play("tap"); return; }
  if(mood==="thinking"){ Bot.face("wow", 700); Sound.play("tap"); return; }
  Bot.flash("happy", 1200); Bot.burst(); Sound.play("reply");
}

/* ── panel behaviour ───────────────────────────────────────────────── */
function openPanel(on){
  S.open = on;
  K.classList.toggle("open", on);
  $(".launcher").setAttribute("aria-expanded", String(on));
  sset("kora:open", on);
  hideTeaser(true);
  if(on){
    S.unread = 0; updateBadge();
    if(booted) Sound.play("open");
    setTimeout(()=>{ if(window.innerWidth > 640 || !S.messages.length) TA.focus({preventScroll:true}); }, 60);
    LIVE.maps.forEach(m=>setTimeout(()=>m.invalidateSize(), 340));
    LIVE.charts.forEach(c=>setTimeout(()=>c.resize(), 340));
  }
  Bot.paint();
}
function setWide(on){
  S.wide = on; K.classList.toggle("wide", on); sset("kora:wide", on, "local");
  const b = $(".b-wide"); b.innerHTML = on ? ICON.narrow : ICON.wide;
  b.title = on ? "Narrow view" : "Wide view (good for dashboards)";
  b.setAttribute("aria-pressed", String(on));
  setTimeout(()=>{ LIVE.charts.forEach(c=>c.resize()); LIVE.maps.forEach(m=>m.invalidateSize()); }, 340);
}
function setSide(left){
  S.left = left; K.classList.toggle("left", left); sset("kora:side", left ? "left" : "right", "local");
}
function setSound(on, quiet){
  Sound.on = on; sset("kora:sound", on, "local");
  const b = $(".b-sound"); b.innerHTML = on ? ICON.sound : ICON.mute;
  b.title = on ? "Sounds on" : "Sounds off"; b.setAttribute("aria-pressed", String(on));
  if(on && !quiet) Sound.play("tap");
}
function updateBadge(){
  const b = $(".badge");
  b.textContent = S.unread > 9 ? "9+" : String(S.unread);
  b.classList.toggle("on", S.unread > 0);
}
function updateLive(){
  const st = S.status, live = $(".ph-live");
  if(!st){ live.textContent = ""; return; }
  const on = st.ai && st.quotaLeft > 0;
  live.classList.toggle("off", !on);
  live.textContent = on ? "AI on" : "Built-in mode";
  live.title = st.ai ? (st.quotaLeft+" of "+st.hourlyLimit+" AI turns left this hour") : "AI isn't set up on this server — Kora uses its built-in skills.";
}
function renderContext(){
  const ctx = $(".ph-ctx");
  if(S.page==="list" && S.status && (S.status.surveys||[]).length){
    const sel = h("select","");
    sel.setAttribute("aria-label","Survey Kora works on");
    sel.innerHTML = '<option value="">No survey — drafting mode</option>' +
      S.status.surveys.map(s=>'<option value="'+esc(s.code)+'"'+(s.code===S.code?" selected":"")+'>'+esc(s.title)+'</option>').join("");
    sel.addEventListener("change", ()=>switchSurvey(sel.value || null, sel.options[sel.selectedIndex].text));
    ctx.innerHTML = ""; ctx.appendChild(sel);
  } else {
    const pages = {list:"Your surveys", builder:"Form builder", data:"Data", studio:"Data Studio", dashboards:"Dashboards",
      dashboard:"Dashboard", monitor:"Live monitor", live_map:"Live map", teams:"Teams", team_board:"Team board"};
    ctx.textContent = (S.title ? S.title+" — " : "") + (pages[S.page] || "Kura");
    ctx.title = ctx.textContent;
  }
}
async function switchSurvey(code, title){
  saveConversation();
  S.code = code; S.title = code ? title : "";
  loadConversation();
  await fetchStatus();
  renderLog();
}
async function fetchStatus(){
  try{
    const q = new URLSearchParams({page:S.page}); if(S.code) q.set("code", S.code);
    const res = await fetch(CFG.endpoints.status+"?"+q.toString(), {credentials:"same-origin", headers:{"X-Requested-With":"XMLHttpRequest"}});
    const data = await res.json();
    if(data && data.ok){
      const surveys = S.status && S.status.surveys;
      S.status = data;
      if(!data.surveys.length && surveys) S.status.surveys = surveys;
      if(data.can) S.can = data.can;
      if(!data.enabled){ host.style.display = "none"; return; }
    }
  }catch(e){}
  updateLive(); renderContext(); renderChips();
}

/* teaser bubble, once per browser session */
const TEASE = {
  list:"Hi"+(CFG.user?" "+CFG.user:"")+"! Tell me a topic and I’ll draft a whole questionnaire.",
  builder:"Want me to review this form, or add a few questions?",
  data:"I can spot data problems or make a privacy-safe copy for you.",
  studio:"Ask me to clean this data — I’ll build the pipeline steps.",
  dashboards:"I can build a whole dashboard in one go.",
  dashboard:"Need more cards? I can suggest a few.",
  monitor:"Ask me how collection is going today.",
  live_map:"I can map responses by any question.",
  teams:"Ask me how the teams are doing.",
  team_board:"Ask me how your team is doing today.",
};
let teaseTimer = 0;
function showTeaser(){
  if(S.open || S.messages.length || sget("kora:teased")) return;
  $(".teaser .tx").innerHTML = esc(TEASE[S.page] || TEASE.list);
  $(".teaser").classList.add("on"); sset("kora:teased", true);
  Bot.flash("wave", 1400);
  teaseTimer = setTimeout(()=>hideTeaser(), 9000);
}
function hideTeaser(){ clearTimeout(teaseTimer); $(".teaser").classList.remove("on"); }

function autosize(){ TA.style.height = "auto"; TA.style.height = Math.min(140, TA.scrollHeight)+"px"; }

/* ── wiring ────────────────────────────────────────────────────────── */
let lastWave = 0;
$(".launcher").addEventListener("click", ()=>openPanel(!S.open));
$(".launcher").addEventListener("mouseenter", ()=>{
  if(S.open || S.busy || Date.now()-lastWave < 4000) return;
  lastWave = Date.now();
  if(S.idleMode==="sleep"){ S.idleMode = "idle"; Bot.face("wow", 900); }
  Bot.flash("wave", 1300);
});
$(".teaser").addEventListener("click", e=>{ if(e.target.closest(".x")){ hideTeaser(); return; } openPanel(true); });
$(".ph-avatar").addEventListener("click", ()=>{ Bot.flash("dance", 1850); Sound.play("dance"); Bot.burst(); });
$(".b-close").addEventListener("click", ()=>openPanel(false));
$(".b-wide").addEventListener("click", ()=>setWide(!S.wide));
$(".b-side").addEventListener("click", ()=>setSide(!S.left));
$(".b-sound").addEventListener("click", ()=>setSound(!Sound.on));
$(".b-new").addEventListener("click", ()=>{
  if(S.busy) return;
  if(S.messages.length && !confirm("Start a new conversation? This one will be cleared.")) return;
  S.messages = []; saveConversation(); renderLog(); Bot.face("wow", 700); TA.focus();
});
$(".composer").addEventListener("submit", e=>{
  e.preventDefault();
  if(S.busy){ if(S.controller) S.controller.abort(); return; }
  send(TA.value);
});
let typeTimer = 0;
TA.addEventListener("input", ()=>{
  autosize();
  S.typing = !!TA.value.trim(); Bot.paint(); Bot.look();
  clearTimeout(typeTimer);
  typeTimer = setTimeout(()=>{ S.typing = false; Bot.paint(); }, 1400);
});
TA.addEventListener("keydown", e=>{
  if(e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); if(!S.busy) send(TA.value); }
});
ROOT.addEventListener("keydown", e=>{ if(e.key==="Escape" && S.open){ e.preventDefault(); openPanel(false); $(".launcher").focus(); } });
document.addEventListener("keydown", e=>{
  if(e.altKey && !e.ctrlKey && !e.metaKey && (e.key==="k" || e.key==="K" || e.code==="KeyK")){ e.preventDefault(); openPanel(!S.open); }
});
document.addEventListener("fullscreenchange", ()=>{ host.style.display = document.fullscreenElement ? "none" : ""; });

/* eyes follow the pointer; idle → groove → sleep */
let raf = 0, px = null, py = null;
const activity = ()=>{
  S.lastActive = Date.now();
  if(S.idleMode !== "idle" && !S.open){ const was = S.idleMode; S.idleMode = "idle"; if(was==="sleep") Bot.face("wow", 900); Bot.paint(); }
};
document.addEventListener("pointermove", e=>{
  px = e.clientX; py = e.clientY;
  if(!raf) raf = requestAnimationFrame(()=>{ raf = 0; Bot.look(px, py); });
  if(Date.now() - S.lastActive > 2000) activity();
}, {passive:true});
["keydown","pointerdown","scroll"].forEach(t=>document.addEventListener(t, activity, {passive:true, capture:true}));
setInterval(()=>{
  if(S.open || S.busy) return;
  const idle = Date.now() - S.lastActive;
  const mode = idle > 240000 ? "sleep" : idle > 20000 ? "groove" : "idle";
  if(mode !== S.idleMode){ S.idleMode = mode; Bot.paint(); }
}, 4000);
(function blinkLoop(){
  setTimeout(()=>{ Bot.blink(); if(Math.random() < .2) setTimeout(()=>Bot.blink(), 220); blinkLoop(); }, 2200 + Math.random()*3800);
})();
setInterval(()=>{ if(Bot.state==="groove" && !REDUCED) Bot.face("note", 1500); }, 7000);

/* ── boot ──────────────────────────────────────────────────────────── */
let booted = false;
function boot(){
  if(booted) return; booted = true;
  setSide(S.left); setWide(S.wide); setSound(Sound.on, true);
  loadConversation();
  renderContext(); renderLog();
  if(!REDUCED){ Bot.each(svg=>svg.classList.add("k-boot")); setTimeout(()=>Bot.each(svg=>svg.classList.remove("k-boot")), 1300); }
  if(S.open) openPanel(true);
  fetchStatus();
  setTimeout(showTeaser, 3500);
}
setTimeout(boot, 2500); // safety net if the stylesheet load event never fires
})();
