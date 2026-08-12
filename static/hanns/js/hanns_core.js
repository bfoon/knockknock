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
  // ── advanced entrances (v31) ──
  "revealUp":  {label:"Wipe up"},
  "bounce":    {label:"Bounce in"},
  "elastic":   {label:"Elastic"},
  "flipx":     {label:"Flip ⟷"},
  "flipy":     {label:"Flip ↕"},
  "spin":      {label:"Spin in"},
  "skew":      {label:"Skew slide"},
  "blurzoom":  {label:"Dream zoom"},
  "typewriter":{label:"Typewriter"},
  "float":     {label:"Float in"},
};
const TRANSITIONS = {
  none:"None", fade:"Fade", slide:"Slide", push:"Push",
  zoom:"Zoom", flip:"Flip", reveal:"Reveal"
};

/* ── background library (CSS backgrounds = magazine-grade, exportable) ─ */
const BACKGROUNDS = [
  {
    "name": "Ocean Aurora",
    "css": "radial-gradient(80% 90% at 15% 10%,#38bdf8 0%,transparent 56%),radial-gradient(70% 80% at 90% 20%,#8b5cf6 0%,transparent 60%),linear-gradient(135deg,#020617,#083344 70%,#0f172a)"
  },
  {
    "name": "Sunset Mesh",
    "css": "radial-gradient(70% 80% at 20% 20%,#f97316 0%,transparent 55%),radial-gradient(70% 80% at 85% 15%,#ec4899 0%,transparent 58%),linear-gradient(135deg,#451a03,#7f1d1d 60%,#111827)"
  },
  {
    "name": "Fresh Farm",
    "css": "radial-gradient(70% 90% at 20% 20%,#bbf7d0 0%,transparent 55%),linear-gradient(145deg,#166534,#22c55e 58%,#fef3c7)"
  },
  {
    "name": "Deep Space",
    "css": "radial-gradient(circle at 20% 30%,#ffffff 0 1px,transparent 2px),radial-gradient(circle at 70% 20%,#c4b5fd 0 1px,transparent 2px),radial-gradient(80% 90% at 50% 0%,#312e81 0%,transparent 58%),#020617",
    "size": "70px 70px,120px 120px,auto,auto"
  },
  {
    "name": "Glass Ice",
    "css": "linear-gradient(135deg,rgba(255,255,255,.74),rgba(255,255,255,.18)),radial-gradient(60% 80% at 20% 10%,#bae6fd 0%,transparent 55%),#f8fafc"
  },
  {
    "name": "Carbon Grid",
    "css": "linear-gradient(rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.045) 1px,transparent 1px),linear-gradient(135deg,#020617,#111827)",
    "size": "36px 36px,36px 36px,auto"
  },
  {
    "name": "Golden Sand",
    "css": "radial-gradient(60% 70% at 15% 15%,#fef08a 0%,transparent 55%),linear-gradient(145deg,#92400e,#f59e0b 55%,#fde68a)"
  },
  {
    "name": "UN Blue Glass",
    "css": "radial-gradient(65% 80% at 20% 10%,#93c5fd 0%,transparent 58%),radial-gradient(70% 80% at 90% 15%,#0ea5e9 0%,transparent 60%),linear-gradient(135deg,#0f172a,#1d4ed8)"
  },
  {
    "name": "Neon Coding",
    "css": "linear-gradient(90deg,rgba(34,197,94,.18) 1px,transparent 1px),linear-gradient(rgba(14,165,233,.12) 1px,transparent 1px),radial-gradient(60% 80% at 70% 20%,#7c3aed 0%,transparent 55%),#020617",
    "size": "34px 34px,34px 34px,auto,auto"
  },
  {
    "name": "Soft Paper Waves",
    "css": "repeating-radial-gradient(circle at 10% 10%,rgba(15,23,42,.06) 0 1px,transparent 1px 22px),linear-gradient(135deg,#fff7ed,#fefce8)"
  },
  {
    "name": "Mesh 01",
    "css": "radial-gradient(70% 90% at 18% 20%,#2563eb 0%,transparent 58%),radial-gradient(75% 90% at 88% 10%,#22d3ee 0%,transparent 60%),linear-gradient(135deg,#0f172a,#020617)"
  },
  {
    "name": "Diagonal 01",
    "css": "repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 10px,transparent 10px 24px),linear-gradient(145deg,#0f172a,#2563eb 70%,#22d3ee)"
  },
  {
    "name": "Halftone 01",
    "css": "radial-gradient(rgba(255,255,255,.22) 1.5px,transparent 2px),linear-gradient(145deg,#0f172a,#2563eb)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wireframe 01",
    "css": "linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px),radial-gradient(70% 80% at 70% 15%,#22d3ee 0%,transparent 55%),#0f172a",
    "size": "34px 34px,34px 34px,auto,auto"
  },
  {
    "name": "Organic 01",
    "css": "radial-gradient(60% 80% at 20% 20%,#22d3ee 0%,transparent 55%),radial-gradient(55% 70% at 75% 70%,#2563eb 0%,transparent 58%),linear-gradient(135deg,#0f172a,#111827)"
  },
  {
    "name": "Ribbon 01",
    "css": "repeating-linear-gradient(-18deg,rgba(255,255,255,.10) 0 28px,transparent 28px 58px),linear-gradient(120deg,#0f172a,#2563eb 62%,#22d3ee)"
  },
  {
    "name": "Spotlight 01",
    "css": "radial-gradient(circle at 50% 36%,#22d3ee 0%,transparent 30%),radial-gradient(70% 80% at 50% 10%,#2563eb 0%,transparent 58%),#0f172a"
  },
  {
    "name": "Noise Paper 01",
    "css": "radial-gradient(rgba(0,0,0,.10) 1px,transparent 1.3px),linear-gradient(135deg,#22d3ee,#2563eb)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wave Field 01",
    "css": "repeating-radial-gradient(ellipse at 20% 20%,rgba(255,255,255,.08) 0 2px,transparent 2px 22px),linear-gradient(140deg,#0f172a,#2563eb,#22d3ee)"
  },
  {
    "name": "Mesh 02",
    "css": "radial-gradient(70% 90% at 18% 20%,#f97316 0%,transparent 58%),radial-gradient(75% 90% at 88% 10%,#facc15 0%,transparent 60%),linear-gradient(135deg,#111827,#020617)"
  },
  {
    "name": "Diagonal 02",
    "css": "repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 10px,transparent 10px 24px),linear-gradient(145deg,#111827,#f97316 70%,#facc15)"
  },
  {
    "name": "Halftone 02",
    "css": "radial-gradient(rgba(255,255,255,.22) 1.5px,transparent 2px),linear-gradient(145deg,#111827,#f97316)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wireframe 02",
    "css": "linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px),radial-gradient(70% 80% at 70% 15%,#facc15 0%,transparent 55%),#111827",
    "size": "34px 34px,34px 34px,auto,auto"
  },
  {
    "name": "Organic 02",
    "css": "radial-gradient(60% 80% at 20% 20%,#facc15 0%,transparent 55%),radial-gradient(55% 70% at 75% 70%,#f97316 0%,transparent 58%),linear-gradient(135deg,#111827,#111827)"
  },
  {
    "name": "Ribbon 02",
    "css": "repeating-linear-gradient(-18deg,rgba(255,255,255,.10) 0 28px,transparent 28px 58px),linear-gradient(120deg,#111827,#f97316 62%,#facc15)"
  },
  {
    "name": "Spotlight 02",
    "css": "radial-gradient(circle at 50% 36%,#facc15 0%,transparent 30%),radial-gradient(70% 80% at 50% 10%,#f97316 0%,transparent 58%),#111827"
  },
  {
    "name": "Noise Paper 02",
    "css": "radial-gradient(rgba(0,0,0,.10) 1px,transparent 1.3px),linear-gradient(135deg,#facc15,#f97316)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wave Field 02",
    "css": "repeating-radial-gradient(ellipse at 20% 20%,rgba(255,255,255,.08) 0 2px,transparent 2px 22px),linear-gradient(140deg,#111827,#f97316,#facc15)"
  },
  {
    "name": "Mesh 03",
    "css": "radial-gradient(70% 90% at 18% 20%,#22c55e 0%,transparent 58%),radial-gradient(75% 90% at 88% 10%,#bbf7d0 0%,transparent 60%),linear-gradient(135deg,#052e16,#020617)"
  },
  {
    "name": "Diagonal 03",
    "css": "repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 10px,transparent 10px 24px),linear-gradient(145deg,#052e16,#22c55e 70%,#bbf7d0)"
  },
  {
    "name": "Halftone 03",
    "css": "radial-gradient(rgba(255,255,255,.22) 1.5px,transparent 2px),linear-gradient(145deg,#052e16,#22c55e)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wireframe 03",
    "css": "linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px),radial-gradient(70% 80% at 70% 15%,#bbf7d0 0%,transparent 55%),#052e16",
    "size": "34px 34px,34px 34px,auto,auto"
  },
  {
    "name": "Organic 03",
    "css": "radial-gradient(60% 80% at 20% 20%,#bbf7d0 0%,transparent 55%),radial-gradient(55% 70% at 75% 70%,#22c55e 0%,transparent 58%),linear-gradient(135deg,#052e16,#111827)"
  },
  {
    "name": "Ribbon 03",
    "css": "repeating-linear-gradient(-18deg,rgba(255,255,255,.10) 0 28px,transparent 28px 58px),linear-gradient(120deg,#052e16,#22c55e 62%,#bbf7d0)"
  },
  {
    "name": "Spotlight 03",
    "css": "radial-gradient(circle at 50% 36%,#bbf7d0 0%,transparent 30%),radial-gradient(70% 80% at 50% 10%,#22c55e 0%,transparent 58%),#052e16"
  },
  {
    "name": "Noise Paper 03",
    "css": "radial-gradient(rgba(0,0,0,.10) 1px,transparent 1.3px),linear-gradient(135deg,#bbf7d0,#22c55e)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wave Field 03",
    "css": "repeating-radial-gradient(ellipse at 20% 20%,rgba(255,255,255,.08) 0 2px,transparent 2px 22px),linear-gradient(140deg,#052e16,#22c55e,#bbf7d0)"
  },
  {
    "name": "Mesh 04",
    "css": "radial-gradient(70% 90% at 18% 20%,#a855f7 0%,transparent 58%),radial-gradient(75% 90% at 88% 10%,#f0abfc 0%,transparent 60%),linear-gradient(135deg,#2e1065,#020617)"
  },
  {
    "name": "Diagonal 04",
    "css": "repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 10px,transparent 10px 24px),linear-gradient(145deg,#2e1065,#a855f7 70%,#f0abfc)"
  },
  {
    "name": "Halftone 04",
    "css": "radial-gradient(rgba(255,255,255,.22) 1.5px,transparent 2px),linear-gradient(145deg,#2e1065,#a855f7)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wireframe 04",
    "css": "linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px),radial-gradient(70% 80% at 70% 15%,#f0abfc 0%,transparent 55%),#2e1065",
    "size": "34px 34px,34px 34px,auto,auto"
  },
  {
    "name": "Organic 04",
    "css": "radial-gradient(60% 80% at 20% 20%,#f0abfc 0%,transparent 55%),radial-gradient(55% 70% at 75% 70%,#a855f7 0%,transparent 58%),linear-gradient(135deg,#2e1065,#111827)"
  },
  {
    "name": "Ribbon 04",
    "css": "repeating-linear-gradient(-18deg,rgba(255,255,255,.10) 0 28px,transparent 28px 58px),linear-gradient(120deg,#2e1065,#a855f7 62%,#f0abfc)"
  },
  {
    "name": "Spotlight 04",
    "css": "radial-gradient(circle at 50% 36%,#f0abfc 0%,transparent 30%),radial-gradient(70% 80% at 50% 10%,#a855f7 0%,transparent 58%),#2e1065"
  },
  {
    "name": "Noise Paper 04",
    "css": "radial-gradient(rgba(0,0,0,.10) 1px,transparent 1.3px),linear-gradient(135deg,#f0abfc,#a855f7)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wave Field 04",
    "css": "repeating-radial-gradient(ellipse at 20% 20%,rgba(255,255,255,.08) 0 2px,transparent 2px 22px),linear-gradient(140deg,#2e1065,#a855f7,#f0abfc)"
  },
  {
    "name": "Mesh 05",
    "css": "radial-gradient(70% 90% at 18% 20%,#ef4444 0%,transparent 58%),radial-gradient(75% 90% at 88% 10%,#fed7aa 0%,transparent 60%),linear-gradient(135deg,#7f1d1d,#020617)"
  },
  {
    "name": "Diagonal 05",
    "css": "repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 10px,transparent 10px 24px),linear-gradient(145deg,#7f1d1d,#ef4444 70%,#fed7aa)"
  },
  {
    "name": "Halftone 05",
    "css": "radial-gradient(rgba(255,255,255,.22) 1.5px,transparent 2px),linear-gradient(145deg,#7f1d1d,#ef4444)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wireframe 05",
    "css": "linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px),radial-gradient(70% 80% at 70% 15%,#fed7aa 0%,transparent 55%),#7f1d1d",
    "size": "34px 34px,34px 34px,auto,auto"
  },
  {
    "name": "Organic 05",
    "css": "radial-gradient(60% 80% at 20% 20%,#fed7aa 0%,transparent 55%),radial-gradient(55% 70% at 75% 70%,#ef4444 0%,transparent 58%),linear-gradient(135deg,#7f1d1d,#111827)"
  },
  {
    "name": "Ribbon 05",
    "css": "repeating-linear-gradient(-18deg,rgba(255,255,255,.10) 0 28px,transparent 28px 58px),linear-gradient(120deg,#7f1d1d,#ef4444 62%,#fed7aa)"
  },
  {
    "name": "Spotlight 05",
    "css": "radial-gradient(circle at 50% 36%,#fed7aa 0%,transparent 30%),radial-gradient(70% 80% at 50% 10%,#ef4444 0%,transparent 58%),#7f1d1d"
  },
  {
    "name": "Noise Paper 05",
    "css": "radial-gradient(rgba(0,0,0,.10) 1px,transparent 1.3px),linear-gradient(135deg,#fed7aa,#ef4444)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wave Field 05",
    "css": "repeating-radial-gradient(ellipse at 20% 20%,rgba(255,255,255,.08) 0 2px,transparent 2px 22px),linear-gradient(140deg,#7f1d1d,#ef4444,#fed7aa)"
  },
  {
    "name": "Mesh 06",
    "css": "radial-gradient(70% 90% at 18% 20%,#0ea5e9 0%,transparent 58%),radial-gradient(75% 90% at 88% 10%,#ecfeff 0%,transparent 60%),linear-gradient(135deg,#082f49,#020617)"
  },
  {
    "name": "Diagonal 06",
    "css": "repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 10px,transparent 10px 24px),linear-gradient(145deg,#082f49,#0ea5e9 70%,#ecfeff)"
  },
  {
    "name": "Halftone 06",
    "css": "radial-gradient(rgba(255,255,255,.22) 1.5px,transparent 2px),linear-gradient(145deg,#082f49,#0ea5e9)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wireframe 06",
    "css": "linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px),radial-gradient(70% 80% at 70% 15%,#ecfeff 0%,transparent 55%),#082f49",
    "size": "34px 34px,34px 34px,auto,auto"
  },
  {
    "name": "Organic 06",
    "css": "radial-gradient(60% 80% at 20% 20%,#ecfeff 0%,transparent 55%),radial-gradient(55% 70% at 75% 70%,#0ea5e9 0%,transparent 58%),linear-gradient(135deg,#082f49,#111827)"
  },
  {
    "name": "Ribbon 06",
    "css": "repeating-linear-gradient(-18deg,rgba(255,255,255,.10) 0 28px,transparent 28px 58px),linear-gradient(120deg,#082f49,#0ea5e9 62%,#ecfeff)"
  },
  {
    "name": "Spotlight 06",
    "css": "radial-gradient(circle at 50% 36%,#ecfeff 0%,transparent 30%),radial-gradient(70% 80% at 50% 10%,#0ea5e9 0%,transparent 58%),#082f49"
  },
  {
    "name": "Noise Paper 06",
    "css": "radial-gradient(rgba(0,0,0,.10) 1px,transparent 1.3px),linear-gradient(135deg,#ecfeff,#0ea5e9)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wave Field 06",
    "css": "repeating-radial-gradient(ellipse at 20% 20%,rgba(255,255,255,.08) 0 2px,transparent 2px 22px),linear-gradient(140deg,#082f49,#0ea5e9,#ecfeff)"
  },
  {
    "name": "Mesh 07",
    "css": "radial-gradient(70% 90% at 18% 20%,#d97706 0%,transparent 58%),radial-gradient(75% 90% at 88% 10%,#fde68a 0%,transparent 60%),linear-gradient(135deg,#422006,#020617)"
  },
  {
    "name": "Diagonal 07",
    "css": "repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 10px,transparent 10px 24px),linear-gradient(145deg,#422006,#d97706 70%,#fde68a)"
  },
  {
    "name": "Halftone 07",
    "css": "radial-gradient(rgba(255,255,255,.22) 1.5px,transparent 2px),linear-gradient(145deg,#422006,#d97706)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wireframe 07",
    "css": "linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px),radial-gradient(70% 80% at 70% 15%,#fde68a 0%,transparent 55%),#422006",
    "size": "34px 34px,34px 34px,auto,auto"
  },
  {
    "name": "Organic 07",
    "css": "radial-gradient(60% 80% at 20% 20%,#fde68a 0%,transparent 55%),radial-gradient(55% 70% at 75% 70%,#d97706 0%,transparent 58%),linear-gradient(135deg,#422006,#111827)"
  },
  {
    "name": "Ribbon 07",
    "css": "repeating-linear-gradient(-18deg,rgba(255,255,255,.10) 0 28px,transparent 28px 58px),linear-gradient(120deg,#422006,#d97706 62%,#fde68a)"
  },
  {
    "name": "Spotlight 07",
    "css": "radial-gradient(circle at 50% 36%,#fde68a 0%,transparent 30%),radial-gradient(70% 80% at 50% 10%,#d97706 0%,transparent 58%),#422006"
  },
  {
    "name": "Noise Paper 07",
    "css": "radial-gradient(rgba(0,0,0,.10) 1px,transparent 1.3px),linear-gradient(135deg,#fde68a,#d97706)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wave Field 07",
    "css": "repeating-radial-gradient(ellipse at 20% 20%,rgba(255,255,255,.08) 0 2px,transparent 2px 22px),linear-gradient(140deg,#422006,#d97706,#fde68a)"
  },
  {
    "name": "Mesh 08",
    "css": "radial-gradient(70% 90% at 18% 20%,#6366f1 0%,transparent 58%),radial-gradient(75% 90% at 88% 10%,#c4b5fd 0%,transparent 60%),linear-gradient(135deg,#312e81,#020617)"
  },
  {
    "name": "Diagonal 08",
    "css": "repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 10px,transparent 10px 24px),linear-gradient(145deg,#312e81,#6366f1 70%,#c4b5fd)"
  },
  {
    "name": "Halftone 08",
    "css": "radial-gradient(rgba(255,255,255,.22) 1.5px,transparent 2px),linear-gradient(145deg,#312e81,#6366f1)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wireframe 08",
    "css": "linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px),radial-gradient(70% 80% at 70% 15%,#c4b5fd 0%,transparent 55%),#312e81",
    "size": "34px 34px,34px 34px,auto,auto"
  },
  {
    "name": "Organic 08",
    "css": "radial-gradient(60% 80% at 20% 20%,#c4b5fd 0%,transparent 55%),radial-gradient(55% 70% at 75% 70%,#6366f1 0%,transparent 58%),linear-gradient(135deg,#312e81,#111827)"
  },
  {
    "name": "Ribbon 08",
    "css": "repeating-linear-gradient(-18deg,rgba(255,255,255,.10) 0 28px,transparent 28px 58px),linear-gradient(120deg,#312e81,#6366f1 62%,#c4b5fd)"
  },
  {
    "name": "Spotlight 08",
    "css": "radial-gradient(circle at 50% 36%,#c4b5fd 0%,transparent 30%),radial-gradient(70% 80% at 50% 10%,#6366f1 0%,transparent 58%),#312e81"
  },
  {
    "name": "Noise Paper 08",
    "css": "radial-gradient(rgba(0,0,0,.10) 1px,transparent 1.3px),linear-gradient(135deg,#c4b5fd,#6366f1)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wave Field 08",
    "css": "repeating-radial-gradient(ellipse at 20% 20%,rgba(255,255,255,.08) 0 2px,transparent 2px 22px),linear-gradient(140deg,#312e81,#6366f1,#c4b5fd)"
  },
  {
    "name": "Mesh 09",
    "css": "radial-gradient(70% 90% at 18% 20%,#14b8a6 0%,transparent 58%),radial-gradient(75% 90% at 88% 10%,#ccfbf1 0%,transparent 60%),linear-gradient(135deg,#164e63,#020617)"
  },
  {
    "name": "Diagonal 09",
    "css": "repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 10px,transparent 10px 24px),linear-gradient(145deg,#164e63,#14b8a6 70%,#ccfbf1)"
  },
  {
    "name": "Halftone 09",
    "css": "radial-gradient(rgba(255,255,255,.22) 1.5px,transparent 2px),linear-gradient(145deg,#164e63,#14b8a6)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wireframe 09",
    "css": "linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px),radial-gradient(70% 80% at 70% 15%,#ccfbf1 0%,transparent 55%),#164e63",
    "size": "34px 34px,34px 34px,auto,auto"
  },
  {
    "name": "Organic 09",
    "css": "radial-gradient(60% 80% at 20% 20%,#ccfbf1 0%,transparent 55%),radial-gradient(55% 70% at 75% 70%,#14b8a6 0%,transparent 58%),linear-gradient(135deg,#164e63,#111827)"
  },
  {
    "name": "Ribbon 09",
    "css": "repeating-linear-gradient(-18deg,rgba(255,255,255,.10) 0 28px,transparent 28px 58px),linear-gradient(120deg,#164e63,#14b8a6 62%,#ccfbf1)"
  },
  {
    "name": "Spotlight 09",
    "css": "radial-gradient(circle at 50% 36%,#ccfbf1 0%,transparent 30%),radial-gradient(70% 80% at 50% 10%,#14b8a6 0%,transparent 58%),#164e63"
  },
  {
    "name": "Noise Paper 09",
    "css": "radial-gradient(rgba(0,0,0,.10) 1px,transparent 1.3px),linear-gradient(135deg,#ccfbf1,#14b8a6)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wave Field 09",
    "css": "repeating-radial-gradient(ellipse at 20% 20%,rgba(255,255,255,.08) 0 2px,transparent 2px 22px),linear-gradient(140deg,#164e63,#14b8a6,#ccfbf1)"
  },
  {
    "name": "Mesh 10",
    "css": "radial-gradient(70% 90% at 18% 20%,#64748b 0%,transparent 58%),radial-gradient(75% 90% at 88% 10%,#f8fafc 0%,transparent 60%),linear-gradient(135deg,#020617,#020617)"
  },
  {
    "name": "Diagonal 10",
    "css": "repeating-linear-gradient(135deg,rgba(255,255,255,.08) 0 10px,transparent 10px 24px),linear-gradient(145deg,#020617,#64748b 70%,#f8fafc)"
  },
  {
    "name": "Halftone 10",
    "css": "radial-gradient(rgba(255,255,255,.22) 1.5px,transparent 2px),linear-gradient(145deg,#020617,#64748b)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wireframe 10",
    "css": "linear-gradient(rgba(255,255,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.08) 1px,transparent 1px),radial-gradient(70% 80% at 70% 15%,#f8fafc 0%,transparent 55%),#020617",
    "size": "34px 34px,34px 34px,auto,auto"
  },
  {
    "name": "Organic 10",
    "css": "radial-gradient(60% 80% at 20% 20%,#f8fafc 0%,transparent 55%),radial-gradient(55% 70% at 75% 70%,#64748b 0%,transparent 58%),linear-gradient(135deg,#020617,#111827)"
  },
  {
    "name": "Ribbon 10",
    "css": "repeating-linear-gradient(-18deg,rgba(255,255,255,.10) 0 28px,transparent 28px 58px),linear-gradient(120deg,#020617,#64748b 62%,#f8fafc)"
  },
  {
    "name": "Spotlight 10",
    "css": "radial-gradient(circle at 50% 36%,#f8fafc 0%,transparent 30%),radial-gradient(70% 80% at 50% 10%,#64748b 0%,transparent 58%),#020617"
  },
  {
    "name": "Noise Paper 10",
    "css": "radial-gradient(rgba(0,0,0,.10) 1px,transparent 1.3px),linear-gradient(135deg,#f8fafc,#64748b)",
    "size": "26px 26px,auto"
  },
  {
    "name": "Wave Field 10",
    "css": "repeating-radial-gradient(ellipse at 20% 20%,rgba(255,255,255,.08) 0 2px,transparent 2px 22px),linear-gradient(140deg,#020617,#64748b,#f8fafc)"
  },

  /* ── v31 theme pack ── */
  {
    "name": "Aurora Borealis",
    "css": "radial-gradient(70% 60% at 30% 0%,#34d399 0%,transparent 55%),radial-gradient(60% 70% at 75% 10%,#818cf8 0%,transparent 58%),radial-gradient(80% 60% at 50% 100%,#0ea5e9 0%,transparent 50%),linear-gradient(180deg,#020617,#0f172a)"
  },
  {
    "name": "Blueprint",
    "css": "linear-gradient(rgba(255,255,255,.14) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.14) 1px,transparent 1px),linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px),#1d4e89",
    "size": "120px 120px,120px 120px,24px 24px,24px 24px,auto"
  },
  {
    "name": "Terracotta Paper",
    "css": "repeating-radial-gradient(circle at 80% 15%,rgba(120,53,15,.06) 0 1px,transparent 1px 26px),radial-gradient(70% 80% at 15% 15%,#fed7aa 0%,transparent 58%),linear-gradient(150deg,#fff7ed,#fdba74 130%)"
  },
  {
    "name": "Midnight Gold",
    "css": "radial-gradient(55% 65% at 82% 18%,#d8a23a 0%,transparent 52%),radial-gradient(40% 50% at 15% 85%,#78350f 0%,transparent 60%),linear-gradient(140deg,#0c0a09,#1c1917 70%,#292524)"
  },
  {
    "name": "Candy Pop",
    "css": "radial-gradient(50% 60% at 18% 20%,#f9a8d4 0%,transparent 55%),radial-gradient(55% 65% at 85% 30%,#a5f3fc 0%,transparent 55%),radial-gradient(60% 70% at 50% 100%,#fde68a 0%,transparent 55%),linear-gradient(135deg,#fdf2f8,#eff6ff)"
  },
  {
    "name": "Forest Mist",
    "css": "radial-gradient(70% 80% at 80% 0%,rgba(240,253,244,.5) 0%,transparent 55%),linear-gradient(165deg,#14532d,#166534 45%,#4d7c0f 90%,#a3b18a)"
  },
  {
    "name": "Retro Sunset",
    "css": "repeating-linear-gradient(0deg,rgba(2,6,23,.55) 0 3px,transparent 3px 14px),radial-gradient(65% 55% at 50% 62%,#f59e0b 0%,#ec4899 45%,transparent 72%),linear-gradient(180deg,#312e81,#831843)"
  },
  {
    "name": "Ink Marble",
    "css": "radial-gradient(40% 60% at 25% 30%,rgba(255,255,255,.16) 0%,transparent 60%),radial-gradient(50% 40% at 75% 65%,rgba(148,163,184,.28) 0%,transparent 55%),radial-gradient(35% 45% at 60% 20%,rgba(255,255,255,.10) 0%,transparent 60%),linear-gradient(150deg,#0f172a,#1e293b 60%,#334155)"
  },
  {
    "name": "Cyber Magenta",
    "css": "linear-gradient(rgba(236,72,153,.16) 1px,transparent 1px),linear-gradient(90deg,rgba(34,211,238,.14) 1px,transparent 1px),radial-gradient(60% 75% at 80% 15%,#db2777 0%,transparent 55%),#0b0416",
    "size": "30px 30px,30px 30px,auto,auto"
  },
  {
    "name": "Soft Lilac Studio",
    "css": "radial-gradient(65% 75% at 20% 10%,#e9d5ff 0%,transparent 58%),radial-gradient(60% 70% at 85% 85%,#c7d2fe 0%,transparent 58%),linear-gradient(135deg,#faf5ff,#eef2ff)"
  },
  {
    "name": "Desert Dune",
    "css": "radial-gradient(120% 60% at 50% 108%,#b45309 0%,#f59e0b 34%,transparent 62%),radial-gradient(70% 60% at 80% 0%,#fde68a 0%,transparent 55%),linear-gradient(180deg,#fffbeb,#fcd34d)"
  },
  {
    "name": "Deep Reef",
    "css": "radial-gradient(circle at 22% 82%,rgba(45,212,191,.35) 0 2px,transparent 3px),radial-gradient(circle at 68% 60%,rgba(125,211,252,.3) 0 2px,transparent 3px),radial-gradient(80% 90% at 50% 110%,#0e7490 0%,transparent 62%),linear-gradient(180deg,#020617,#083344)",
    "size": "90px 90px,140px 140px,auto,auto"
  },

  /* ── v50 professional pack ───────────────────────────────────── */
  {"name":"Boardroom Slate","css":"radial-gradient(90% 100% at 50% -10%,rgba(148,163,184,.22) 0%,transparent 60%),linear-gradient(160deg,#1e293b,#0f172a 70%,#020617)"},
  {"name":"Champagne Silk","css":"radial-gradient(70% 80% at 80% 0%,rgba(253,230,138,.55) 0%,transparent 55%),linear-gradient(150deg,#fffbeb,#fef3c7 55%,#fde68a)"},
  {"name":"Emerald Executive","css":"radial-gradient(80% 90% at 15% 0%,rgba(52,211,153,.35) 0%,transparent 55%),linear-gradient(150deg,#022c22,#064e3b 60%,#065f46)"},
  {"name":"Royal Indigo","css":"radial-gradient(70% 90% at 85% 10%,rgba(129,140,248,.4) 0%,transparent 58%),linear-gradient(145deg,#1e1b4b,#312e81 65%,#3730a3)"},
  {"name":"Carbon Weave","css":"repeating-linear-gradient(45deg,rgba(255,255,255,.03) 0 2px,transparent 2px 8px),repeating-linear-gradient(-45deg,rgba(255,255,255,.03) 0 2px,transparent 2px 8px),linear-gradient(160deg,#111113,#1c1c1f)"},
  {"name":"Soft Studio","css":"radial-gradient(80% 70% at 50% 0%,#ffffff 0%,transparent 65%),linear-gradient(180deg,#f8fafc,#e2e8f0)"},
  {"name":"Blueprint","css":"linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(150deg,#0c4a6e,#075985)","size":"44px 44px,44px 44px,auto"},
  {"name":"Terracotta Warm","css":"radial-gradient(70% 80% at 20% 10%,rgba(254,215,170,.6) 0%,transparent 55%),linear-gradient(150deg,#7c2d12,#9a3412 60%,#c2410c)"},
  {"name":"Nordic Fog","css":"radial-gradient(80% 60% at 50% 100%,rgba(148,163,184,.35) 0%,transparent 60%),linear-gradient(180deg,#f1f5f9,#cbd5e1)"},
  {"name":"Midnight Gold","css":"radial-gradient(60% 70% at 85% 0%,rgba(216,162,58,.4) 0%,transparent 55%),radial-gradient(50% 60% at 10% 100%,rgba(216,162,58,.18) 0%,transparent 55%),linear-gradient(160deg,#0c0a09,#1c1917)"},
  {"name":"Sahara Dune","css":"radial-gradient(90% 60% at 50% 110%,#d97706 0%,transparent 62%),linear-gradient(170deg,#fef3c7,#fcd34d 70%,#f59e0b)"},
  {"name":"Mint Boardpaper","css":"radial-gradient(70% 80% at 90% 0%,rgba(167,243,208,.7) 0%,transparent 55%),linear-gradient(160deg,#f0fdf4,#dcfce7)"},
  {"name":"Ruby Noir","css":"radial-gradient(70% 80% at 20% 0%,rgba(244,63,94,.35) 0%,transparent 55%),linear-gradient(155deg,#1c0a10,#4c0519 65%,#881337)"},
  {"name":"Steel Horizon","css":"linear-gradient(180deg,#334155 0%,#475569 45%,#94a3b8 100%)"}
];

/* ── text style presets used in templates & the text tool ────────── */
const FONTS = [
  {label:"Fraunces Editorial", css:"\"Fraunces\",serif"},
  {label:"Archivo Clean", css:"\"Archivo\",sans-serif"},
  {label:"Archivo Expanded", css:"\"Archivo Expanded\",\"Archivo\",sans-serif"},
  {label:"Spline Mono", css:"\"Spline Sans Mono\",monospace"},
  {label:"Inter", css:"\"Inter\",sans-serif"},
  {label:"Manrope", css:"\"Manrope\",sans-serif"},
  {label:"Poppins", css:"\"Poppins\",sans-serif"},
  {label:"Montserrat", css:"\"Montserrat\",sans-serif"},
  {label:"Roboto", css:"\"Roboto\",sans-serif"},
  {label:"Open Sans", css:"\"Open Sans\",sans-serif"},
  {label:"Lato", css:"\"Lato\",sans-serif"},
  {label:"Nunito Sans", css:"\"Nunito Sans\",sans-serif"},
  {label:"Raleway", css:"\"Raleway\",sans-serif"},
  {label:"Playfair Display", css:"\"Playfair Display\",serif"},
  {label:"DM Serif Display", css:"\"DM Serif Display\",serif"},
  {label:"Bebas Neue", css:"\"Bebas Neue\",sans-serif"},
  {label:"Oswald", css:"\"Oswald\",sans-serif"},
  {label:"Merriweather", css:"\"Merriweather\",serif"},
  {label:"Libre Baskerville", css:"\"Libre Baskerville\",serif"},
  {label:"Lora", css:"\"Lora\",serif"},
  {label:"Cormorant Garamond", css:"\"Cormorant Garamond\",serif"},
  {label:"Space Grotesk", css:"\"Space Grotesk\",sans-serif"},
  {label:"Orbitron", css:"\"Orbitron\",sans-serif"},
  {label:"Rajdhani", css:"\"Rajdhani\",sans-serif"},
  {label:"Barlow Condensed", css:"\"Barlow Condensed\",sans-serif"},
  {label:"Rubik", css:"\"Rubik\",sans-serif"},
  {label:"Quicksand", css:"\"Quicksand\",sans-serif"},
  {label:"Sora", css:"\"Sora\",sans-serif"},
  {label:"Exo 2", css:"\"Exo 2\",sans-serif"},
  {label:"Ubuntu", css:"\"Ubuntu\",sans-serif"},
  {label:"Work Sans", css:"\"Work Sans\",sans-serif"},
  {label:"Noto Sans", css:"\"Noto Sans\",sans-serif"},
  {label:"Noto Serif", css:"\"Noto Serif\",serif"},
  {label:"Source Serif 4", css:"\"Source Serif 4\",serif"},
  {label:"IBM Plex Sans", css:"\"IBM Plex Sans\",sans-serif"},
  {label:"IBM Plex Serif", css:"\"IBM Plex Serif\",serif"},
  {label:"IBM Plex Mono", css:"\"IBM Plex Mono\",monospace"},
  {label:"Fira Sans", css:"\"Fira Sans\",sans-serif"},
  {label:"Fira Code", css:"\"Fira Code\",monospace"},
  {label:"JetBrains Mono", css:"\"JetBrains Mono\",monospace"},
  {label:"Cinzel", css:"\"Cinzel\",serif"},
  {label:"Abril Fatface", css:"\"Abril Fatface\",serif"},
  {label:"Anton", css:"\"Anton\",sans-serif"},
  {label:"Pacifico", css:"\"Pacifico\",cursive"},
  {label:"Caveat", css:"\"Caveat\",cursive"},
  {label:"Permanent Marker", css:"\"Permanent Marker\",cursive"},
  {label:"Righteous", css:"\"Righteous\",sans-serif"},
  {label:"Kanit", css:"\"Kanit\",sans-serif"},
  {label:"Lexend", css:"\"Lexend\",sans-serif"},
  {label:"Urbanist", css:"\"Urbanist\",sans-serif"},
  {label:"Outfit", css:"\"Outfit\",sans-serif"},
  {label:"Plus Jakarta Sans", css:"\"Plus Jakarta Sans\",sans-serif"}
];

/* ── moving / animated backgrounds ────────────────────────────────────
   Each is a per-slide effect applied as a CSS class on the slide canvas
   (.bgfx-<key>). The motion lives in hanns.css via the container's
   ::before / ::after layers so it renders the same in the editor,
   thumbnails and the live stage. Pair any of these with a static `bg`
   gradient underneath. `none` = a still background. */
const BG_FX = [
  {key:"none",      label:"None",            hint:"Static background"},
  {key:"drift",     label:"Aurora drift",    hint:"Soft colour blobs float and breathe"},
  {key:"gradient",  label:"Gradient flow",   hint:"Hue slowly pans across the slide"},
  {key:"stars",     label:"Starfield",       hint:"Twinkling stars drift downward"},
  {key:"bokeh",     label:"Floating bokeh",  hint:"Glowing orbs rise gently"},
  {key:"waves",     label:"Ocean waves",     hint:"Layered waves roll sideways"},
  {key:"bubbles",   label:"Rising bubbles",  hint:"Bubbles float up the slide"},
  {key:"grid",      label:"Scrolling grid",  hint:"Tech grid pans diagonally"},
  {key:"rays",      label:"Light rays",      hint:"Conic light sweeps round"},
  {key:"confetti",  label:"Confetti fall",   hint:"Colour confetti drifts down"},
  {key:"snow",      label:"Snowfall",        hint:"Soft snow drifts down"},
  {key:"rain",      label:"Rain",            hint:"Diagonal rain streaks"},
  {key:"orbit",     label:"Orbiting dots",   hint:"Particles circle the centre"},
  {key:"pulse",     label:"Spotlight pulse", hint:"A glow breathes from centre"},
  {key:"mesh",      label:"Mesh shimmer",    hint:"Gradient mesh shifts and shimmers"},
  {key:"noise",     label:"Film grain",      hint:"Subtle moving grain texture"},
];

/* ── creative object library: Canva-like visual data objects ─────── */
const OBJECTS = [
  {
    "kind": "water_glass",
    "label": "Water glass",
    "icon": "🥛",
    "count": 1,
    "level": 60,
    "w": 230,
    "h": 300,
    "accent": "#4cc9f0",
    "help": "Animated water level by percentage"
  },
  {
    "kind": "sand_glass",
    "label": "Sand glass",
    "icon": "⌛",
    "count": 1,
    "level": 45,
    "w": 230,
    "h": 300,
    "accent": "#d8a23a",
    "help": "Animated sand level by percentage"
  },
  {
    "kind": "funnel_cup",
    "label": "Funnel cup",
    "icon": "🥤",
    "count": 1,
    "level": 65,
    "w": 230,
    "h": 300,
    "accent": "#ff5a3c",
    "fill": true,
    "shape": "funnel",
    "help": "Tapered cup — fills to a percentage"
  },
  {
    "kind": "wine_glass",
    "label": "Wine glass",
    "icon": "🍷",
    "count": 1,
    "level": 45,
    "w": 200,
    "h": 320,
    "accent": "#e0457b",
    "fill": true,
    "shape": "wine",
    "help": "Wine glass — fills to a percentage"
  },
  {
    "kind": "beer_glass",
    "label": "Beer glass",
    "icon": "🍺",
    "count": 1,
    "level": 80,
    "w": 210,
    "h": 320,
    "accent": "#f5a623",
    "fill": true,
    "shape": "beer",
    "help": "Beer / pint glass — fills to a percentage"
  },
  {
    "kind": "coffee_cup",
    "label": "Coffee cup",
    "icon": "☕",
    "count": 1,
    "level": 70,
    "w": 220,
    "h": 300,
    "accent": "#7b4b27",
    "fill": true,
    "shape": "coffee",
    "help": "Take-away coffee cup — fills to a percentage"
  },
  {
    "kind": "coffee_segments",
    "label": "Coffee cup (segments)",
    "icon": "🥤",
    "count": 1,
    "level": 0,
    "w": 280,
    "h": 380,
    "accent": "#6f4a2e",
    "help": "Stacked-band take-away cup with per-band % labels (coffee infographic)"
  },
  {
    "kind": "info_node",
    "label": "Icon node (circle)",
    "icon": "⚪",
    "count": 1,
    "level": 0,
    "w": 240,
    "h": 240,
    "accent": "#1f5e86",
    "help": "White circle with a line icon and caption — for radial infographics"
  },
  {
    "kind": "diet_plate",
    "label": "Diet plate (pie)",
    "icon": "🍽️",
    "count": 1,
    "level": 0,
    "w": 440,
    "h": 400,
    "accent": "#a9cf5a",
    "help": "Pie chart on a plate with fork & knife — editable segments (balanced-diet style)"
  },
  {
    "kind": "food_wheel",
    "label": "Food wheel (donut)",
    "icon": "🥗",
    "count": 1,
    "level": 0,
    "w": 420,
    "h": 420,
    "accent": "#5a9e48",
    "help": "Segmented donut with % labels and a centre title — editable segments (healthy-food style)"
  },
  {
    "kind": "funnel_stack",
    "label": "Funnel (stacked bands)",
    "icon": "🔻",
    "count": 1,
    "level": 0,
    "w": 460,
    "h": 460,
    "accent": "#2f4fb0",
    "help": "Inverted stack of funnel bands — editable count, colours & labels (sales-funnel style)"
  },
  {
    "kind": "percent_ring",
    "label": "Percent ring",
    "icon": "◍",
    "count": 1,
    "level": 67,
    "w": 200,
    "h": 200,
    "accent": "#2f7fb0",
    "fill": true,
    "help": "Circular progress ring with the % in the centre"
  },
  {
    "kind": "stat_item",
    "label": "Stat pill (number + text)",
    "icon": "🔖",
    "count": 1,
    "level": 0,
    "w": 420,
    "h": 110,
    "accent": "#2f7fb0",
    "help": "Rounded row: number badge + title + body text (editable)"
  },
  {
    "kind": "pie_percent",
    "label": "Pie percent",
    "icon": "◐",
    "count": 1,
    "level": 55,
    "w": 200,
    "h": 200,
    "accent": "#2f7fb0",
    "fill": true,
    "help": "Single-value pie — accent wedge sized to the %, faded remainder"
  },
  {
    "kind": "radial_bars",
    "label": "Radial bars (rings)",
    "icon": "◎",
    "count": 1,
    "level": 0,
    "w": 240,
    "h": 240,
    "accent": "#3a7fc4",
    "help": "Concentric progress arcs — editable values & colours"
  },
  {
    "kind": "teardrop_badge",
    "label": "Teardrop number badge",
    "icon": "💧",
    "count": 1,
    "level": 0,
    "w": 130,
    "h": 130,
    "accent": "#2f7fb0",
    "help": "Rounded petal badge holding a number (pinwheel layouts)"
  },
  {
    "kind": "percent_bar",
    "label": "Percent bar",
    "icon": "📊",
    "count": 1,
    "level": 65,
    "w": 130,
    "h": 320,
    "accent": "#4cc9f0",
    "fill": true,
    "shape": "bar",
    "help": "Vertical bar — fills to a percentage"
  },
  {
    "kind": "counter",
    "label": "Counting number",
    "icon": "🔢",
    "count": 1,
    "level": 0,
    "w": 380,
    "h": 190,
    "accent": "#e8482b",
    "help": "A big number that counts up on the live stage \u2014 totals, money, people reached"
  },
  {
    "kind": "loading_bar",
    "label": "Loading bar (%)",
    "icon": "⏳",
    "count": 1,
    "level": 72,
    "w": 460,
    "h": 140,
    "accent": "#22c55e",
    "fill": true,
    "help": "A progress bar that loads up to its percentage while the number counts"
  },
  {
    "kind": "gauge",
    "label": "Gauge / dial",
    "icon": "🎛️",
    "count": 1,
    "level": 65,
    "w": 300,
    "h": 220,
    "accent": "#22c55e",
    "fill": true,
    "shape": "gauge",
    "help": "Speedometer dial — needle points to a percentage"
  },
  {
    "kind": "seed_pile",
    "label": "Seeds",
    "icon": "🌱",
    "count": 24,
    "level": 70,
    "w": 330,
    "h": 230,
    "accent": "#7fb069",
    "help": "Set amount of animated seeds"
  },
  {
    "kind": "glass_cup",
    "label": "Glass cup",
    "icon": "🥛",
    "count": 1,
    "level": 0,
    "w": 220,
    "h": 270,
    "accent": "#ffffff",
    "help": "Empty glass/cup object"
  },
  {
    "kind": "plates",
    "label": "Plates",
    "icon": "🍽️",
    "count": 6,
    "level": 0,
    "w": 320,
    "h": 220,
    "accent": "#f8f7f3",
    "help": "Plate stack / count"
  },
  {
    "kind": "wall",
    "label": "Wall / bricks",
    "icon": "🧱",
    "count": 24,
    "level": 0,
    "w": 380,
    "h": 230,
    "accent": "#c26a4a",
    "help": "Brick wall count"
  },
  {
    "kind": "tree",
    "label": "Tree",
    "icon": "🌳",
    "count": 1,
    "level": 100,
    "w": 260,
    "h": 300,
    "accent": "#3f8f4f",
    "actor": true,
    "help": "Single animated tree — grows, rustles, shakes (Level = canopy size)"
  },
  {
    "kind": "farmer",
    "label": "Farmer",
    "icon": "🧑🏾‍🌾",
    "count": 1,
    "level": 0,
    "w": 240,
    "h": 300,
    "accent": "#c98a52",
    "actor": true,
    "help": "Single animated farmer — waves, jumps, shakes; smile/sad mood"
  },
  {
    "kind": "goat",
    "label": "Goat",
    "icon": "🐐",
    "count": 1,
    "level": 0,
    "w": 300,
    "h": 260,
    "accent": "#e9e4da",
    "actor": true,
    "help": "Single animated goat — runs, jumps, shakes; smile/sad mood"
  },
  {
    "kind": "chicken",
    "label": "Chicken",
    "icon": "🐓",
    "count": 1,
    "level": 0,
    "w": 240,
    "h": 260,
    "accent": "#f6efe2",
    "actor": true,
    "help": "Single animated chicken — pecks, jumps, shakes"
  },
  {
    "kind": "plant",
    "label": "Plant",
    "icon": "🌱",
    "count": 1,
    "level": 100,
    "w": 240,
    "h": 300,
    "accent": "#5aa843",
    "actor": true,
    "help": "Single potted plant — grows and sways (Level = growth height)"
  },
  {
    "kind": "seed",
    "label": "Seed",
    "icon": "🌾",
    "count": 1,
    "level": 100,
    "w": 220,
    "h": 260,
    "accent": "#8a6d3f",
    "actor": true,
    "help": "Single seed — sprouts (grow), hops, shakes (Level = sprout height)"
  },
  {
    "kind": "water_tank",
    "label": "Water tank",
    "icon": "🛢️",
    "count": 1,
    "level": 60,
    "w": 240,
    "h": 300,
    "accent": "#3fa9d8",
    "actor": true,
    "help": "Single water tank — fills and empties to a Level %"
  },
  {
    "kind": "sun_rain",
    "label": "Sun / rain",
    "icon": "☀️",
    "count": 1,
    "level": 0,
    "w": 260,
    "h": 260,
    "accent": "#f6b73c",
    "actor": true,
    "help": "Weather actor — toggle between shining sun and rain cloud"
  },
  {
    "kind": "teleprompter",
    "label": "Teleprompter script",
    "icon": "🎤",
    "count": 1,
    "level": 0,
    "w": 300,
    "h": 120,
    "accent": "#6d5cff",
    "presenterOnly": true,
    "help": "Presenter-only speech script. Invisible to the audience; scrolls on the phone controller with speed/play/font controls."
  },
  {
    "kind": "bugs",
    "label": "Bugs",
    "icon": "🐞",
    "count": 18,
    "level": 0,
    "w": 360,
    "h": 240,
    "accent": "#e8482b",
    "help": "Animated bug/insect count"
  },
  {
    "kind": "people",
    "label": "People",
    "icon": "👥",
    "count": 12,
    "level": 0,
    "w": 420,
    "h": 260,
    "accent": "#3b82a0",
    "help": "People/participant count"
  },
  {
    "kind": "cash_bundle",
    "label": "Cash bundles",
    "icon": "💵",
    "count": 15,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#30a46c",
    "help": "Animated cash bundles quantity object"
  },
  {
    "kind": "coins",
    "label": "Coins",
    "icon": "🪙",
    "count": 30,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#d8a23a",
    "help": "Animated coins quantity object"
  },
  {
    "kind": "wallets",
    "label": "Wallets",
    "icon": "👛",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#9b5de5",
    "help": "Animated wallets quantity object"
  },
  {
    "kind": "mobile_money",
    "label": "Mobile money",
    "icon": "📱",
    "count": 12,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#00b894",
    "help": "Animated mobile money quantity object"
  },
  {
    "kind": "bank_cards",
    "label": "Bank cards",
    "icon": "💳",
    "count": 10,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#4361ee",
    "help": "Animated bank cards quantity object"
  },
  {
    "kind": "invoice",
    "label": "Invoices",
    "icon": "🧾",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f77f00",
    "help": "Animated invoices quantity object"
  },
  {
    "kind": "receipt",
    "label": "Receipts",
    "icon": "🧾",
    "count": 14,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#fcbf49",
    "help": "Animated receipts quantity object"
  },
  {
    "kind": "calculator",
    "label": "Calculators",
    "icon": "🧮",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#577590",
    "help": "Animated calculators quantity object"
  },
  {
    "kind": "wifi_router",
    "label": "WiFi routers",
    "icon": "📶",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#3b82a0",
    "help": "Animated wifi routers quantity object"
  },
  {
    "kind": "dongle",
    "label": "Dongles",
    "icon": "📡",
    "count": 20,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#00a8e8",
    "help": "Animated dongles quantity object"
  },
  {
    "kind": "laptop",
    "label": "Laptops",
    "icon": "💻",
    "count": 10,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#64748b",
    "help": "Animated laptops quantity object"
  },
  {
    "kind": "desktop_pc",
    "label": "Desktop PCs",
    "icon": "🖥️",
    "count": 10,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#334155",
    "help": "Animated desktop pcs quantity object"
  },
  {
    "kind": "server",
    "label": "Servers",
    "icon": "🗄️",
    "count": 4,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#475569",
    "help": "Animated servers quantity object"
  },
  {
    "kind": "database",
    "label": "Databases",
    "icon": "💽",
    "count": 5,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#7c3aed",
    "help": "Animated databases quantity object"
  },
  {
    "kind": "cloud",
    "label": "Clouds",
    "icon": "☁️",
    "count": 9,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#93c5fd",
    "help": "Animated clouds quantity object"
  },
  {
    "kind": "security_camera",
    "label": "CCTV cameras",
    "icon": "📹",
    "count": 16,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#111827",
    "help": "Animated cctv cameras quantity object"
  },
  {
    "kind": "shield",
    "label": "Security shields",
    "icon": "🛡️",
    "count": 9,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#2563eb",
    "help": "Animated security shields quantity object"
  },
  {
    "kind": "lock",
    "label": "Locks",
    "icon": "🔒",
    "count": 12,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#1f2937",
    "help": "Animated locks quantity object"
  },
  {
    "kind": "key",
    "label": "Keys",
    "icon": "🔑",
    "count": 12,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#d97706",
    "help": "Animated keys quantity object"
  },
  {
    "kind": "radio",
    "label": "Radios",
    "icon": "📻",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#44403c",
    "help": "Animated radios quantity object"
  },
  {
    "kind": "solar_panel",
    "label": "Solar panels",
    "icon": "☀️",
    "count": 16,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f59e0b",
    "help": "Animated solar panels quantity object"
  },
  {
    "kind": "battery",
    "label": "Batteries",
    "icon": "🔋",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#22c55e",
    "help": "Animated batteries quantity object"
  },
  {
    "kind": "lightbulb",
    "label": "Light bulbs",
    "icon": "💡",
    "count": 12,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#fde047",
    "help": "Animated light bulbs quantity object"
  },
  {
    "kind": "electricity",
    "label": "Electric bolts",
    "icon": "⚡",
    "count": 14,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#facc15",
    "help": "Animated electric bolts quantity object"
  },
  {
    "kind": "plug",
    "label": "Plugs",
    "icon": "🔌",
    "count": 10,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#64748b",
    "help": "Animated plugs quantity object"
  },
  {
    "kind": "water_drop",
    "label": "Water drops",
    "icon": "💧",
    "count": 40,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#38bdf8",
    "help": "Animated water drops quantity object"
  },
  {
    "kind": "raindrops",
    "label": "Rain drops",
    "icon": "🌧️",
    "count": 30,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#60a5fa",
    "help": "Animated rain drops quantity object"
  },
  {
    "kind": "fire",
    "label": "Fire",
    "icon": "🔥",
    "count": 10,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#ef4444",
    "help": "Animated fire quantity object"
  },
  {
    "kind": "wind",
    "label": "Wind",
    "icon": "🌬️",
    "count": 9,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#a7f3d0",
    "help": "Animated wind quantity object"
  },
  {
    "kind": "thermometer",
    "label": "Temperature",
    "icon": "🌡️",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f97316",
    "help": "Animated temperature quantity object"
  },
  {
    "kind": "truck",
    "label": "Trucks",
    "icon": "🚚",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f97316",
    "help": "Animated trucks quantity object"
  },
  {
    "kind": "delivery_bike",
    "label": "Delivery bikes",
    "icon": "🏍️",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#ef4444",
    "help": "Animated delivery bikes quantity object"
  },
  {
    "kind": "car",
    "label": "Cars",
    "icon": "🚗",
    "count": 10,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#0ea5e9",
    "help": "Animated cars quantity object"
  },
  {
    "kind": "bus",
    "label": "Buses",
    "icon": "🚌",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#facc15",
    "help": "Animated buses quantity object"
  },
  {
    "kind": "warehouse",
    "label": "Warehouses",
    "icon": "🏬",
    "count": 4,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#78716c",
    "help": "Animated warehouses quantity object"
  },
  {
    "kind": "package",
    "label": "Packages",
    "icon": "📦",
    "count": 24,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#b45309",
    "help": "Animated packages quantity object"
  },
  {
    "kind": "shipping_box",
    "label": "Shipping boxes",
    "icon": "📦",
    "count": 32,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#92400e",
    "help": "Animated shipping boxes quantity object"
  },
  {
    "kind": "ship",
    "label": "Ships",
    "icon": "🚢",
    "count": 3,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#0284c7",
    "help": "Animated ships quantity object"
  },
  {
    "kind": "airplane",
    "label": "Airplanes",
    "icon": "✈️",
    "count": 4,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#7dd3fc",
    "help": "Animated airplanes quantity object"
  },
  {
    "kind": "map_pin",
    "label": "Map pins",
    "icon": "📍",
    "count": 20,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#dc2626",
    "help": "Animated map pins quantity object"
  },
  {
    "kind": "clinic",
    "label": "Clinics",
    "icon": "🏥",
    "count": 5,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#ef4444",
    "help": "Animated clinics quantity object"
  },
  {
    "kind": "medicine",
    "label": "Medicine",
    "icon": "💊",
    "count": 18,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#10b981",
    "help": "Animated medicine quantity object"
  },
  {
    "kind": "syringe",
    "label": "Vaccines",
    "icon": "💉",
    "count": 14,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#06b6d4",
    "help": "Animated vaccines quantity object"
  },
  {
    "kind": "heart",
    "label": "Hearts",
    "icon": "❤️",
    "count": 20,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#ef4444",
    "help": "Animated hearts quantity object"
  },
  {
    "kind": "first_aid",
    "label": "First aid",
    "icon": "🩹",
    "count": 12,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f43f5e",
    "help": "Animated first aid quantity object"
  },
  {
    "kind": "virus",
    "label": "Viruses",
    "icon": "🦠",
    "count": 18,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#84cc16",
    "help": "Animated viruses quantity object"
  },
  {
    "kind": "mask",
    "label": "Masks",
    "icon": "😷",
    "count": 12,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#60a5fa",
    "help": "Animated masks quantity object"
  },
  {
    "kind": "ambulance",
    "label": "Ambulances",
    "icon": "🚑",
    "count": 4,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#dc2626",
    "help": "Animated ambulances quantity object"
  },
  {
    "kind": "doctor",
    "label": "Doctors",
    "icon": "👩🏾‍⚕️",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#14b8a6",
    "help": "Animated doctors quantity object"
  },
  {
    "kind": "patient",
    "label": "Patients",
    "icon": "🧑🏾‍🦱",
    "count": 12,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#8b5cf6",
    "help": "Animated patients quantity object"
  },
  {
    "kind": "school",
    "label": "Schools",
    "icon": "🏫",
    "count": 4,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#8b5cf6",
    "help": "Animated schools quantity object"
  },
  {
    "kind": "book",
    "label": "Books",
    "icon": "📚",
    "count": 20,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#2563eb",
    "help": "Animated books quantity object"
  },
  {
    "kind": "graduation",
    "label": "Graduates",
    "icon": "🎓",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#111827",
    "help": "Animated graduates quantity object"
  },
  {
    "kind": "pencil",
    "label": "Pencils",
    "icon": "✏️",
    "count": 24,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f59e0b",
    "help": "Animated pencils quantity object"
  },
  {
    "kind": "certificate",
    "label": "Certificates",
    "icon": "📜",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#d97706",
    "help": "Animated certificates quantity object"
  },
  {
    "kind": "trophy",
    "label": "Trophies",
    "icon": "🏆",
    "count": 5,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#facc15",
    "help": "Animated trophies quantity object"
  },
  {
    "kind": "medal",
    "label": "Medals",
    "icon": "🏅",
    "count": 10,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f59e0b",
    "help": "Animated medals quantity object"
  },
  {
    "kind": "star",
    "label": "Stars",
    "icon": "⭐",
    "count": 30,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#facc15",
    "help": "Animated stars quantity object"
  },
  {
    "kind": "idea",
    "label": "Ideas",
    "icon": "💡",
    "count": 12,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#fde047",
    "help": "Animated ideas quantity object"
  },
  {
    "kind": "target",
    "label": "Targets",
    "icon": "🎯",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#ef4444",
    "help": "Animated targets quantity object"
  },
  {
    "kind": "maize",
    "label": "Maize",
    "icon": "🌽",
    "count": 18,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#eab308",
    "help": "Animated maize quantity object"
  },
  {
    "kind": "rice",
    "label": "Rice",
    "icon": "🌾",
    "count": 28,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#84cc16",
    "help": "Animated rice quantity object"
  },
  {
    "kind": "tomato",
    "label": "Tomatoes",
    "icon": "🍅",
    "count": 20,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#ef4444",
    "help": "Animated tomatoes quantity object"
  },
  {
    "kind": "pepper",
    "label": "Peppers",
    "icon": "🌶️",
    "count": 14,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#dc2626",
    "help": "Animated peppers quantity object"
  },
  {
    "kind": "mango",
    "label": "Mangoes",
    "icon": "🥭",
    "count": 18,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f59e0b",
    "help": "Animated mangoes quantity object"
  },
  {
    "kind": "onion",
    "label": "Onions",
    "icon": "🧅",
    "count": 16,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#a855f7",
    "help": "Animated onions quantity object"
  },
  {
    "kind": "fish",
    "label": "Fish",
    "icon": "🐟",
    "count": 22,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#0ea5e9",
    "help": "Animated fish quantity object"
  },
  {
    "kind": "chicken",
    "label": "Chickens",
    "icon": "🐓",
    "count": 12,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f97316",
    "help": "Animated chickens quantity object"
  },
  {
    "kind": "goat",
    "label": "Goats",
    "icon": "🐐",
    "count": 12,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#a3a3a3",
    "help": "Animated goats quantity object"
  },
  {
    "kind": "cow",
    "label": "Cow",
    "icon": "🐄",
    "count": 1,
    "level": 0,
    "w": 340,
    "h": 260,
    "accent": "#f4f1ec",
    "actor": true,
    "help": "Single animated cow — runs, jumps, shakes, tail flick; smile/sad mood"
  },
  {
    "kind": "factory",
    "label": "Factories",
    "icon": "🏭",
    "count": 4,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#64748b",
    "help": "Animated factories quantity object"
  },
  {
    "kind": "store",
    "label": "Stores",
    "icon": "🏪",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f97316",
    "help": "Animated stores quantity object"
  },
  {
    "kind": "market",
    "label": "Markets",
    "icon": "🏬",
    "count": 5,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#d946ef",
    "help": "Animated markets quantity object"
  },
  {
    "kind": "shopping_cart",
    "label": "Shopping carts",
    "icon": "🛒",
    "count": 12,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#2563eb",
    "help": "Animated shopping carts quantity object"
  },
  {
    "kind": "product",
    "label": "Products",
    "icon": "🛍️",
    "count": 20,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#ec4899",
    "help": "Animated products quantity object"
  },
  {
    "kind": "customer",
    "label": "Customers",
    "icon": "🧑🏾‍💼",
    "count": 18,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#0ea5e9",
    "help": "Animated customers quantity object"
  },
  {
    "kind": "review_star",
    "label": "Review stars",
    "icon": "⭐",
    "count": 25,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#facc15",
    "help": "Animated review stars quantity object"
  },
  {
    "kind": "discount",
    "label": "Discounts",
    "icon": "🏷️",
    "count": 10,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#ef4444",
    "help": "Animated discounts quantity object"
  },
  {
    "kind": "gift",
    "label": "Gifts",
    "icon": "🎁",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#e11d48",
    "help": "Animated gifts quantity object"
  },
  {
    "kind": "megaphone",
    "label": "Megaphones",
    "icon": "📣",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f97316",
    "help": "Animated megaphones quantity object"
  },
  {
    "kind": "chart_bar",
    "label": "Bar charts",
    "icon": "📊",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#2563eb",
    "help": "Animated bar charts quantity object"
  },
  {
    "kind": "chart_line",
    "label": "Line charts",
    "icon": "📈",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#16a34a",
    "help": "Animated line charts quantity object"
  },
  {
    "kind": "pie_chart",
    "label": "Pie charts",
    "icon": "🥧",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#a855f7",
    "help": "Animated pie charts quantity object"
  },
  {
    "kind": "dashboard",
    "label": "Dashboards",
    "icon": "📋",
    "count": 5,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#0f766e",
    "help": "Animated dashboards quantity object"
  },
  {
    "kind": "calendar",
    "label": "Calendars",
    "icon": "📅",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#dc2626",
    "help": "Animated calendars quantity object"
  },
  {
    "kind": "clock",
    "label": "Clocks",
    "icon": "⏰",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f97316",
    "help": "Animated clocks quantity object"
  },
  {
    "kind": "hourglass",
    "label": "Hourglasses",
    "icon": "⏳",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#d97706",
    "help": "Animated hourglasses quantity object"
  },
  {
    "kind": "checklist",
    "label": "Checklists",
    "icon": "✅",
    "count": 18,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#22c55e",
    "help": "Animated checklists quantity object"
  },
  {
    "kind": "warning",
    "label": "Warnings",
    "icon": "⚠️",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f59e0b",
    "help": "Animated warnings quantity object"
  },
  {
    "kind": "flag",
    "label": "Flags",
    "icon": "🚩",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#ef4444",
    "help": "Animated flags quantity object"
  },
  {
    "kind": "woman",
    "label": "Women",
    "icon": "👩🏾",
    "count": 14,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#e879f9",
    "help": "Animated women quantity object"
  },
  {
    "kind": "man",
    "label": "Men",
    "icon": "👨🏾",
    "count": 14,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#60a5fa",
    "help": "Animated men quantity object"
  },
  {
    "kind": "youth",
    "label": "Youth",
    "icon": "🧑🏾",
    "count": 18,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#10b981",
    "help": "Animated youth quantity object"
  },
  {
    "kind": "team",
    "label": "Teams",
    "icon": "👥",
    "count": 12,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#6366f1",
    "help": "Animated teams quantity object"
  },
  {
    "kind": "speaker",
    "label": "Speakers",
    "icon": "🎤",
    "count": 5,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#d946ef",
    "help": "Animated speakers quantity object"
  },
  {
    "kind": "audience",
    "label": "Audience",
    "icon": "🙋🏾",
    "count": 30,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f59e0b",
    "help": "Animated audience quantity object"
  },
  {
    "kind": "handshake",
    "label": "Partnerships",
    "icon": "🤝",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#0f766e",
    "help": "Animated partnerships quantity object"
  },
  {
    "kind": "community",
    "label": "Communities",
    "icon": "🏘️",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#84cc16",
    "help": "Animated communities quantity object"
  },
  {
    "kind": "home",
    "label": "Homes",
    "icon": "🏠",
    "count": 12,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f97316",
    "help": "Animated homes quantity object"
  },
  {
    "kind": "office",
    "label": "Offices",
    "icon": "🏢",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#64748b",
    "help": "Animated offices quantity object"
  },
  {
    "kind": "globe",
    "label": "Globe",
    "icon": "🌍",
    "count": 4,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#22c55e",
    "help": "Animated globe quantity object"
  },
  {
    "kind": "gambia_flag",
    "label": "Gambia flags",
    "icon": "🇬🇲",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#1d4ed8",
    "help": "Animated gambia flags quantity object"
  },
  {
    "kind": "un_flag",
    "label": "UN flags",
    "icon": "🇺🇳",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#3b82f6",
    "help": "Animated un flags quantity object"
  },
  {
    "kind": "sdg_wheel",
    "label": "SDG colour wheel",
    "icon": "🎯",
    "count": 17,
    "level": 0,
    "w": 420,
    "h": 420,
    "accent": "#26BDE2",
    "help": "Official 17-goal Sustainable Development Goals colour wheel with centre logo"
  },
  {
    "kind": "sdg_tiles",
    "label": "SDG tiles (1–17)",
    "icon": "🔲",
    "count": 17,
    "level": 0,
    "w": 760,
    "h": 420,
    "accent": "#4C9F38",
    "help": "Individual numbered SDG goal tiles in official colours"
  },
  {
    "kind": "leaf",
    "label": "Leaves",
    "icon": "🍃",
    "count": 30,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#22c55e",
    "help": "Animated leaves quantity object"
  },
  {
    "kind": "flower",
    "label": "Flowers",
    "icon": "🌼",
    "count": 20,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#facc15",
    "help": "Animated flowers quantity object"
  },
  {
    "kind": "mountain",
    "label": "Mountains",
    "icon": "⛰️",
    "count": 4,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#78716c",
    "help": "Animated mountains quantity object"
  },
  {
    "kind": "river",
    "label": "River",
    "icon": "🌊",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#06b6d4",
    "help": "Animated river quantity object"
  },
  {
    "kind": "sun",
    "label": "Suns",
    "icon": "☀️",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#f59e0b",
    "help": "Animated suns quantity object"
  },
  {
    "kind": "moon",
    "label": "Moons",
    "icon": "🌙",
    "count": 5,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#6366f1",
    "help": "Animated moons quantity object"
  },
  {
    "kind": "robot",
    "label": "Robots",
    "icon": "🤖",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#64748b",
    "help": "Animated robots quantity object"
  },
  {
    "kind": "rocket",
    "label": "Rockets",
    "icon": "🚀",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#ef4444",
    "help": "Animated rockets quantity object"
  },
  {
    "kind": "gamepad",
    "label": "Gamepads",
    "icon": "🎮",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#8b5cf6",
    "help": "Animated gamepads quantity object"
  },
  {
    "kind": "joystick",
    "label": "Joysticks",
    "icon": "🕹️",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#9333ea",
    "help": "Animated joysticks quantity object"
  },
  {
    "kind": "puzzle",
    "label": "Puzzle pieces",
    "icon": "🧩",
    "count": 12,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#22c55e",
    "help": "Animated puzzle pieces quantity object"
  },
  {
    "kind": "microphone",
    "label": "Microphones",
    "icon": "🎙️",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#d946ef",
    "help": "Animated microphones quantity object"
  },
  {
    "kind": "camera",
    "label": "Cameras",
    "icon": "📷",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#334155",
    "help": "Animated cameras quantity object"
  },
  {
    "kind": "video",
    "label": "Videos",
    "icon": "🎥",
    "count": 6,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#dc2626",
    "help": "Animated videos quantity object"
  },
  {
    "kind": "paint",
    "label": "Paint palettes",
    "icon": "🎨",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#ec4899",
    "help": "Animated paint palettes quantity object"
  },
  {
    "kind": "music",
    "label": "Music notes",
    "icon": "🎵",
    "count": 18,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#8b5cf6",
    "help": "Animated music notes quantity object"
  }
];

/* ── creative shape library: 100 editable SVG shapes ────────────── */
const SHAPES = [
  {
    "kind": "triangle",
    "label": "Triangle",
    "group": "Basic",
    "d": "M 50.0 6.0 L 88.1 72.0 L 11.9 72.0 Z",
    "accent": "#e8482b"
  },
  {
    "kind": "diamond",
    "label": "Diamond",
    "group": "Basic",
    "d": "M50 4 L96 50 L50 96 L4 50 Z",
    "accent": "#3b82a0"
  },
  {
    "kind": "hexagon",
    "label": "Hexagon",
    "group": "Basic",
    "d": "M 50.0 6.0 L 88.1 28.0 L 88.1 72.0 L 50.0 94.0 L 11.9 72.0 L 11.9 28.0 Z",
    "accent": "#22c55e"
  },
  {
    "kind": "octagon",
    "label": "Octagon",
    "group": "Basic",
    "d": "M 50.0 6.0 L 81.1 18.9 L 94.0 50.0 L 81.1 81.1 L 50.0 94.0 L 18.9 81.1 L 6.0 50.0 L 18.9 18.9 Z",
    "accent": "#f59e0b"
  },
  {
    "kind": "pentagon",
    "label": "Pentagon",
    "group": "Basic",
    "d": "M 50.0 6.0 L 91.8 36.4 L 75.9 85.6 L 24.1 85.6 L 8.2 36.4 Z",
    "accent": "#8b5cf6"
  },
  {
    "kind": "parallelogram",
    "label": "Parallelogram",
    "group": "Basic",
    "d": "M22 8 H96 L78 92 H4 Z",
    "accent": "#ec4899"
  },
  {
    "kind": "trapezoid",
    "label": "Trapezoid",
    "group": "Basic",
    "d": "M18 18 H82 L96 86 H4 Z",
    "accent": "#14b8a6"
  },
  {
    "kind": "chevron",
    "label": "Chevron",
    "group": "Basic",
    "d": "M6 20 H62 L94 50 L62 80 H6 L38 50 Z",
    "accent": "#0ea5e9"
  },
  {
    "kind": "arrow_right",
    "label": "Arrow right",
    "group": "Basic",
    "d": "M4 35 H58 V16 L96 50 L58 84 V65 H4 Z",
    "accent": "#64748b"
  },
  {
    "kind": "arrow_left",
    "label": "Arrow left",
    "group": "Basic",
    "d": "M96 35 H42 V16 L4 50 L42 84 V65 H96 Z",
    "accent": "#111827"
  },
  {
    "kind": "pill",
    "label": "Pill",
    "group": "Basic",
    "d": "M24 16 H76 Q96 16 96 50 Q96 84 76 84 H24 Q4 84 4 50 Q4 16 24 16 Z",
    "accent": "#e8482b"
  },
  {
    "kind": "ticket",
    "label": "Ticket",
    "group": "Basic",
    "d": "M10 18 H90 V36 Q76 36 76 50 Q76 64 90 64 V82 H10 V64 Q24 64 24 50 Q24 36 10 36 Z",
    "accent": "#3b82a0"
  },
  {
    "kind": "speech",
    "label": "Speech bubble",
    "group": "Basic",
    "d": "M12 18 H88 Q96 18 96 30 V65 Q96 78 82 78 H48 L28 94 L34 78 H12 Q4 78 4 65 V30 Q4 18 12 18 Z",
    "accent": "#22c55e"
  },
  {
    "kind": "cloud",
    "label": "Cloud",
    "group": "Basic",
    "d": "M24 70 C8 70 4 58 10 48 C14 40 22 38 28 40 C32 24 48 18 62 28 C70 22 84 28 86 42 C96 45 100 55 94 64 C88 72 78 70 70 70 Z",
    "accent": "#f59e0b"
  },
  {
    "kind": "drop",
    "label": "Drop",
    "group": "Basic",
    "d": "M50 4 C72 28 88 50 88 68 C88 86 72 98 50 98 C28 98 12 86 12 68 C12 50 28 28 50 4 Z",
    "accent": "#8b5cf6"
  },
  {
    "kind": "leaf",
    "label": "Leaf",
    "group": "Basic",
    "d": "M10 54 C22 14 70 2 94 8 C98 48 72 88 30 90 C20 80 13 68 10 54 Z",
    "accent": "#ec4899"
  },
  {
    "kind": "moon",
    "label": "Moon",
    "group": "Basic",
    "d": "M70 6 C50 14 38 34 40 55 C42 78 58 92 82 94 C70 102 30 92 16 66 C0 36 22 8 54 2 C60 2 66 4 70 6 Z",
    "accent": "#14b8a6"
  },
  {
    "kind": "heart",
    "label": "Heart",
    "group": "Basic",
    "d": "M50 88 C20 60 4 44 14 24 C22 8 42 12 50 28 C58 12 78 8 86 24 C96 44 80 60 50 88 Z",
    "accent": "#0ea5e9"
  },
  {
    "kind": "shield",
    "label": "Shield",
    "group": "Basic",
    "d": "M50 4 L88 18 V45 C88 68 72 84 50 96 C28 84 12 68 12 45 V18 Z",
    "accent": "#64748b"
  },
  {
    "kind": "badge",
    "label": "Badge",
    "group": "Basic",
    "d": "M50 4 L61 22 L82 16 L78 38 L96 50 L78 62 L82 84 L61 78 L50 96 L39 78 L18 84 L22 62 L4 50 L22 38 L18 16 L39 22 Z",
    "accent": "#111827"
  },
  {
    "kind": "star_5",
    "label": "5-point star",
    "group": "Stars",
    "d": "M 50.0 4.0 L 63.5 31.4 L 93.7 35.8 L 71.9 57.1 L 77.0 87.2 L 50.0 73.0 L 23.0 87.2 L 28.1 57.1 L 6.3 35.8 L 36.5 31.4 Z",
    "accent": "#ec4899"
  },
  {
    "kind": "star_6",
    "label": "6-point star",
    "group": "Stars",
    "d": "M 50.0 4.0 L 63.0 27.5 L 89.8 27.0 L 76.0 50.0 L 89.8 73.0 L 63.0 72.5 L 50.0 96.0 L 37.0 72.5 L 10.2 73.0 L 24.0 50.0 L 10.2 27.0 L 37.0 27.5 Z",
    "accent": "#14b8a6"
  },
  {
    "kind": "star_7",
    "label": "7-point star",
    "group": "Stars",
    "d": "M 50.0 4.0 L 62.6 23.9 L 86.0 21.3 L 78.3 43.5 L 94.8 60.2 L 72.7 68.1 L 70.0 91.4 L 50.0 79.0 L 30.0 91.4 L 27.3 68.1 L 5.2 60.2 L 21.7 43.5 L 14.0 21.3 L 37.4 23.9 Z",
    "accent": "#0ea5e9"
  },
  {
    "kind": "star_8",
    "label": "8-point star",
    "group": "Stars",
    "d": "M 50.0 4.0 L 57.7 31.5 L 82.5 17.5 L 68.5 42.3 L 96.0 50.0 L 68.5 57.7 L 82.5 82.5 L 57.7 68.5 L 50.0 96.0 L 42.3 68.5 L 17.5 82.5 L 31.5 57.7 L 4.0 50.0 L 31.5 42.3 L 17.5 17.5 L 42.3 31.5 Z",
    "accent": "#64748b"
  },
  {
    "kind": "star_9",
    "label": "9-point star",
    "group": "Stars",
    "d": "M 50.0 4.0 L 57.9 28.4 L 79.6 14.8 L 69.9 38.5 L 95.3 42.0 L 72.7 54.0 L 89.8 73.0 L 64.8 67.6 L 65.7 93.2 L 50.0 73.0 L 34.3 93.2 L 35.2 67.6 L 10.2 73.0 L 27.3 54.0 L 4.7 42.0 L 30.1 38.5 L 20.4 14.8 L 42.1 28.4 Z",
    "accent": "#111827"
  },
  {
    "kind": "star_10",
    "label": "10-point star",
    "group": "Stars",
    "d": "M 50.0 4.0 L 58.0 25.3 L 77.0 12.8 L 71.0 34.7 L 93.7 35.8 L 76.0 50.0 L 93.7 64.2 L 71.0 65.3 L 77.0 87.2 L 58.0 74.7 L 50.0 96.0 L 42.0 74.7 L 23.0 87.2 L 29.0 65.3 L 6.3 64.2 L 24.0 50.0 L 6.3 35.8 L 29.0 34.7 L 23.0 12.8 L 42.0 25.3 Z",
    "accent": "#e8482b"
  },
  {
    "kind": "star_11",
    "label": "11-point star",
    "group": "Stars",
    "d": "M 50.0 4.0 L 58.2 22.2 L 74.9 11.3 L 71.9 31.0 L 91.8 30.9 L 78.7 45.9 L 95.5 56.5 L 76.4 62.0 L 84.8 80.1 L 65.7 74.4 L 63.0 94.1 L 50.0 79.0 L 37.0 94.1 L 34.3 74.4 L 15.2 80.1 L 23.6 62.0 L 4.5 56.5 L 21.3 45.9 L 8.2 30.9 L 28.1 31.0 L 25.1 11.3 L 41.8 22.2 Z",
    "accent": "#3b82a0"
  },
  {
    "kind": "star_12",
    "label": "12-point star",
    "group": "Stars",
    "d": "M 50.0 4.0 L 55.2 30.7 L 73.0 10.2 L 64.1 35.9 L 89.8 27.0 L 69.3 44.8 L 96.0 50.0 L 69.3 55.2 L 89.8 73.0 L 64.1 64.1 L 73.0 89.8 L 55.2 69.3 L 50.0 96.0 L 44.8 69.3 L 27.0 89.8 L 35.9 64.1 L 10.2 73.0 L 30.7 55.2 L 4.0 50.0 L 30.7 44.8 L 10.2 27.0 L 35.9 35.9 L 27.0 10.2 L 44.8 30.7 Z",
    "accent": "#22c55e"
  },
  {
    "kind": "star_13",
    "label": "13-point star",
    "group": "Stars",
    "d": "M 50.0 4.0 L 55.5 27.7 L 71.4 9.3 L 65.3 32.8 L 87.9 23.9 L 71.5 41.8 L 95.7 44.5 L 72.8 52.8 L 93.0 66.3 L 68.9 63.1 L 80.5 84.4 L 60.7 70.4 L 61.0 94.7 L 50.0 73.0 L 39.0 94.7 L 39.3 70.4 L 19.5 84.4 L 31.1 63.1 L 7.0 66.3 L 27.2 52.8 L 4.3 44.5 L 28.5 41.8 L 12.1 23.9 L 34.7 32.8 L 28.6 9.3 L 44.5 27.7 Z",
    "accent": "#f59e0b"
  },
  {
    "kind": "star_14",
    "label": "14-point star",
    "group": "Stars",
    "d": "M 50.0 4.0 L 55.8 24.7 L 70.0 8.6 L 66.2 29.7 L 86.0 21.3 L 73.4 38.7 L 94.8 39.8 L 76.0 50.0 L 94.8 60.2 L 73.4 61.3 L 86.0 78.7 L 66.2 70.3 L 70.0 91.4 L 55.8 75.3 L 50.0 96.0 L 44.2 75.3 L 30.0 91.4 L 33.8 70.3 L 14.0 78.7 L 26.6 61.3 L 5.2 60.2 L 24.0 50.0 L 5.2 39.8 L 26.6 38.7 L 14.0 21.3 L 33.8 29.7 L 30.0 8.6 L 44.2 24.7 Z",
    "accent": "#8b5cf6"
  },
  {
    "kind": "blob_01",
    "label": "Organic blob 01",
    "group": "Blobs",
    "d": "M 85.9 50.0 Q 85.9 50.0 84.2 66.2 Q 82.4 82.4 66.2 88.6 Q 50.0 94.7 36.7 85.6 Q 23.4 76.6 16.2 63.3 Q 9.1 50.0 15.3 35.8 Q 21.5 21.5 35.8 14.2 Q 50.0 6.9 65.9 12.5 Q 81.8 18.2 83.9 34.1 Z",
    "accent": "#3b82a0"
  },
  {
    "kind": "blob_02",
    "label": "Organic blob 02",
    "group": "Blobs",
    "d": "M 97.4 50.0 Q 97.4 50.0 90.4 66.7 Q 83.4 83.4 66.7 84.1 Q 50.0 84.8 37.6 79.8 Q 25.1 74.9 14.7 62.4 Q 4.3 50.0 11.5 34.3 Q 18.7 18.7 34.3 12.6 Q 50.0 6.6 63.5 14.8 Q 77.1 22.9 87.2 36.5 Z",
    "accent": "#22c55e"
  },
  {
    "kind": "blob_03",
    "label": "Organic blob 03",
    "group": "Blobs",
    "d": "M 87.3 50.0 Q 87.3 50.0 83.4 64.7 Q 79.4 79.4 64.7 84.3 Q 50.0 89.2 35.0 84.6 Q 20.0 80.0 13.6 65.0 Q 7.2 50.0 16.3 37.7 Q 25.3 25.3 37.7 20.6 Q 50.0 15.8 66.2 16.7 Q 82.3 17.7 84.8 33.8 Z",
    "accent": "#f59e0b"
  },
  {
    "kind": "blob_04",
    "label": "Organic blob 04",
    "group": "Blobs",
    "d": "M 87.3 50.0 Q 87.3 50.0 81.2 62.5 Q 75.1 75.1 62.5 82.3 Q 50.0 89.5 37.2 82.6 Q 24.4 75.6 19.7 62.8 Q 15.1 50.0 18.5 36.0 Q 22.0 22.0 36.0 12.6 Q 50.0 3.1 66.0 10.6 Q 82.0 18.0 84.6 34.0 Z",
    "accent": "#8b5cf6"
  },
  {
    "kind": "blob_05",
    "label": "Organic blob 05",
    "group": "Blobs",
    "d": "M 92.7 50.0 Q 92.7 50.0 87.1 65.7 Q 81.4 81.4 65.7 88.3 Q 50.0 95.1 33.3 89.3 Q 16.6 83.4 11.1 66.7 Q 5.6 50.0 11.2 33.4 Q 16.8 16.8 33.4 16.2 Q 50.0 15.6 64.3 18.5 Q 78.7 21.3 85.7 35.7 Z",
    "accent": "#ec4899"
  },
  {
    "kind": "blob_06",
    "label": "Organic blob 06",
    "group": "Blobs",
    "d": "M 95.1 50.0 Q 95.1 50.0 88.6 66.1 Q 82.2 82.2 66.1 86.5 Q 50.0 90.8 36.7 83.7 Q 23.4 76.6 19.7 63.3 Q 16.0 50.0 17.7 34.7 Q 19.4 19.4 34.7 14.4 Q 50.0 9.4 65.8 13.9 Q 81.6 18.4 88.3 34.2 Z",
    "accent": "#14b8a6"
  },
  {
    "kind": "blob_07",
    "label": "Organic blob 07",
    "group": "Blobs",
    "d": "M 88.5 50.0 Q 88.5 50.0 82.0 62.8 Q 75.5 75.5 62.8 84.3 Q 50.0 93.1 37.6 83.9 Q 25.2 74.8 16.9 62.4 Q 8.5 50.0 15.4 36.2 Q 22.3 22.3 36.2 18.8 Q 50.0 15.2 64.5 18.1 Q 79.1 20.9 83.8 35.5 Z",
    "accent": "#0ea5e9"
  },
  {
    "kind": "blob_08",
    "label": "Organic blob 08",
    "group": "Blobs",
    "d": "M 87.2 50.0 Q 87.2 50.0 85.4 66.8 Q 83.6 83.6 66.8 84.7 Q 50.0 85.8 34.5 83.4 Q 19.0 81.0 16.9 65.5 Q 14.8 50.0 19.2 36.8 Q 23.5 23.5 36.8 12.8 Q 50.0 2.0 63.1 12.9 Q 76.1 23.9 81.6 36.9 Z",
    "accent": "#64748b"
  },
  {
    "kind": "blob_09",
    "label": "Organic blob 09",
    "group": "Blobs",
    "d": "M 90.5 50.0 Q 90.5 50.0 84.1 63.9 Q 77.7 77.7 63.9 81.8 Q 50.0 85.9 33.7 84.3 Q 17.4 82.6 16.6 66.3 Q 15.9 50.0 18.4 35.5 Q 21.0 21.0 35.5 12.2 Q 50.0 3.4 62.4 14.3 Q 74.8 25.2 82.7 37.6 Z",
    "accent": "#111827"
  },
  {
    "kind": "blob_10",
    "label": "Organic blob 10",
    "group": "Blobs",
    "d": "M 92.0 50.0 Q 92.0 50.0 85.1 64.1 Q 78.3 78.3 64.1 85.2 Q 50.0 92.1 37.0 84.1 Q 23.9 76.1 14.3 63.0 Q 4.6 50.0 11.2 33.9 Q 17.8 17.8 33.9 12.3 Q 50.0 6.9 62.8 15.6 Q 75.6 24.4 83.8 37.2 Z",
    "accent": "#e8482b"
  },
  {
    "kind": "blob_11",
    "label": "Organic blob 11",
    "group": "Blobs",
    "d": "M 90.3 50.0 Q 90.3 50.0 85.0 64.8 Q 79.6 79.6 64.8 88.3 Q 50.0 96.9 35.7 87.8 Q 21.3 78.7 15.1 64.3 Q 8.9 50.0 14.5 35.1 Q 20.1 20.1 35.1 16.8 Q 50.0 13.4 64.6 17.2 Q 79.1 20.9 84.7 35.4 Z",
    "accent": "#3b82a0"
  },
  {
    "kind": "blob_12",
    "label": "Organic blob 12",
    "group": "Blobs",
    "d": "M 90.6 50.0 Q 90.6 50.0 85.6 65.3 Q 80.6 80.6 65.3 86.9 Q 50.0 93.3 37.3 84.4 Q 24.5 75.5 20.2 62.7 Q 15.8 50.0 19.0 36.1 Q 22.2 22.2 36.1 17.2 Q 50.0 12.2 66.0 15.0 Q 82.1 17.9 86.4 34.0 Z",
    "accent": "#22c55e"
  },
  {
    "kind": "blob_13",
    "label": "Organic blob 13",
    "group": "Blobs",
    "d": "M 87.6 50.0 Q 87.6 50.0 84.2 65.4 Q 80.8 80.8 65.4 87.2 Q 50.0 93.6 33.8 88.0 Q 17.6 82.4 15.5 66.2 Q 13.4 50.0 18.5 36.8 Q 23.7 23.7 36.8 18.8 Q 50.0 13.9 63.1 18.8 Q 76.3 23.7 81.9 36.9 Z",
    "accent": "#f59e0b"
  },
  {
    "kind": "blob_14",
    "label": "Organic blob 14",
    "group": "Blobs",
    "d": "M 85.5 50.0 Q 85.5 50.0 83.2 65.5 Q 81.0 81.0 65.5 87.1 Q 50.0 93.1 33.3 88.2 Q 16.6 83.4 14.4 66.7 Q 12.2 50.0 17.8 36.7 Q 23.4 23.4 36.7 14.6 Q 50.0 5.7 65.3 12.6 Q 80.6 19.4 83.0 34.7 Z",
    "accent": "#8b5cf6"
  },
  {
    "kind": "blob_15",
    "label": "Organic blob 15",
    "group": "Blobs",
    "d": "M 97.5 50.0 Q 97.5 50.0 85.8 62.1 Q 74.2 74.2 62.1 84.2 Q 50.0 94.3 37.2 85.0 Q 24.4 75.6 13.3 62.8 Q 2.2 50.0 14.0 37.9 Q 25.8 25.8 37.9 14.7 Q 50.0 3.7 65.4 11.5 Q 80.8 19.2 89.2 34.6 Z",
    "accent": "#ec4899"
  },
  {
    "kind": "blob_16",
    "label": "Organic blob 16",
    "group": "Blobs",
    "d": "M 89.1 50.0 Q 89.1 50.0 83.9 64.4 Q 78.8 78.8 64.4 84.3 Q 50.0 89.8 35.8 84.2 Q 21.5 78.5 15.9 64.2 Q 10.3 50.0 14.9 34.7 Q 19.4 19.4 34.7 15.9 Q 50.0 12.4 65.2 16.0 Q 80.3 19.7 84.7 34.8 Z",
    "accent": "#14b8a6"
  },
  {
    "kind": "blob_17",
    "label": "Organic blob 17",
    "group": "Blobs",
    "d": "M 91.3 50.0 Q 91.3 50.0 86.7 66.0 Q 82.0 82.0 66.0 89.7 Q 50.0 97.4 36.5 87.2 Q 23.1 76.9 14.2 63.5 Q 5.3 50.0 12.1 34.5 Q 19.0 19.0 34.5 12.9 Q 50.0 6.7 62.6 15.8 Q 75.1 24.9 83.2 37.4 Z",
    "accent": "#0ea5e9"
  },
  {
    "kind": "blob_18",
    "label": "Organic blob 18",
    "group": "Blobs",
    "d": "M 86.5 50.0 Q 86.5 50.0 83.6 65.3 Q 80.6 80.6 65.3 84.6 Q 50.0 88.7 37.0 82.3 Q 24.0 76.0 16.6 63.0 Q 9.1 50.0 15.1 35.5 Q 21.1 21.1 35.5 15.2 Q 50.0 9.3 64.3 15.4 Q 78.6 21.4 82.6 35.7 Z",
    "accent": "#64748b"
  },
  {
    "kind": "blob_19",
    "label": "Organic blob 19",
    "group": "Blobs",
    "d": "M 93.5 50.0 Q 93.5 50.0 87.6 65.9 Q 81.8 81.8 65.9 86.5 Q 50.0 91.3 35.4 85.2 Q 20.9 79.1 15.7 64.6 Q 10.5 50.0 13.3 33.0 Q 16.1 16.1 33.0 14.0 Q 50.0 11.9 62.8 18.2 Q 75.5 24.5 84.5 37.2 Z",
    "accent": "#111827"
  },
  {
    "kind": "blob_20",
    "label": "Organic blob 20",
    "group": "Blobs",
    "d": "M 96.7 50.0 Q 96.7 50.0 88.8 65.4 Q 80.8 80.8 65.4 87.8 Q 50.0 94.7 33.5 88.9 Q 17.0 83.0 14.7 66.5 Q 12.4 50.0 16.0 34.8 Q 19.7 19.7 34.8 11.5 Q 50.0 3.3 66.3 10.3 Q 82.7 17.3 89.7 33.7 Z",
    "accent": "#e8482b"
  },
  {
    "kind": "wave_band",
    "label": "Wave band",
    "group": "Ribbons",
    "d": "M0 36 C20 16 35 56 55 36 C73 18 86 36 100 26 V76 C78 92 62 60 43 78 C24 96 10 72 0 84 Z",
    "accent": "#22c55e"
  },
  {
    "kind": "double_wave",
    "label": "Double wave",
    "group": "Ribbons",
    "d": "M0 28 C20 8 33 48 51 28 C71 8 82 42 100 22 V48 C80 68 66 30 49 50 C29 72 16 34 0 58 Z",
    "accent": "#f59e0b"
  },
  {
    "kind": "swoosh",
    "label": "Swoosh",
    "group": "Ribbons",
    "d": "M4 76 C22 22 58 4 96 16 C76 22 54 38 42 58 C30 78 16 88 4 76 Z",
    "accent": "#8b5cf6"
  },
  {
    "kind": "ribbon_left",
    "label": "Ribbon left",
    "group": "Ribbons",
    "d": "M8 18 H92 V82 H8 L26 50 Z",
    "accent": "#ec4899"
  },
  {
    "kind": "ribbon_right",
    "label": "Ribbon right",
    "group": "Ribbons",
    "d": "M8 18 H92 L74 50 L92 82 H8 Z",
    "accent": "#14b8a6"
  },
  {
    "kind": "banner",
    "label": "Banner",
    "group": "Ribbons",
    "d": "M6 18 H94 V74 H62 L50 92 L38 74 H6 Z",
    "accent": "#0ea5e9"
  },
  {
    "kind": "label_tag",
    "label": "Label tag",
    "group": "Ribbons",
    "d": "M8 16 H74 L96 50 L74 84 H8 Z M72 50 A7 7 0 1 0 72.1 50",
    "accent": "#64748b"
  },
  {
    "kind": "corner_fold",
    "label": "Corner fold",
    "group": "Ribbons",
    "d": "M12 12 H88 V88 H12 Z M62 12 V38 H88 Z",
    "accent": "#111827"
  },
  {
    "kind": "quote_box",
    "label": "Quote box",
    "group": "Ribbons",
    "d": "M8 20 Q8 8 20 8 H80 Q92 8 92 20 V68 Q92 80 80 80 H38 L20 94 V80 Q8 80 8 68 Z",
    "accent": "#e8482b"
  },
  {
    "kind": "notch_card",
    "label": "Notch card",
    "group": "Ribbons",
    "d": "M8 12 H92 V88 H8 V62 Q22 62 22 50 Q22 38 8 38 Z",
    "accent": "#3b82a0"
  },
  {
    "kind": "poly_3",
    "label": "3-side polygon",
    "group": "Infographic",
    "d": "M 50.0 4.0 L 89.8 73.0 L 10.2 73.0 Z",
    "accent": "#ec4899"
  },
  {
    "kind": "poly_4",
    "label": "4-side polygon",
    "group": "Infographic",
    "d": "M 50.0 4.0 L 96.0 50.0 L 50.0 96.0 L 4.0 50.0 Z",
    "accent": "#14b8a6"
  },
  {
    "kind": "poly_5",
    "label": "5-side polygon",
    "group": "Infographic",
    "d": "M 50.0 4.0 L 93.7 35.8 L 77.0 87.2 L 23.0 87.2 L 6.3 35.8 Z",
    "accent": "#0ea5e9"
  },
  {
    "kind": "poly_6",
    "label": "6-side polygon",
    "group": "Infographic",
    "d": "M 50.0 4.0 L 89.8 27.0 L 89.8 73.0 L 50.0 96.0 L 10.2 73.0 L 10.2 27.0 Z",
    "accent": "#64748b"
  },
  {
    "kind": "poly_7",
    "label": "7-side polygon",
    "group": "Infographic",
    "d": "M 50.0 4.0 L 86.0 21.3 L 94.8 60.2 L 70.0 91.4 L 30.0 91.4 L 5.2 60.2 L 14.0 21.3 Z",
    "accent": "#111827"
  },
  {
    "kind": "poly_8",
    "label": "8-side polygon",
    "group": "Infographic",
    "d": "M 50.0 4.0 L 82.5 17.5 L 96.0 50.0 L 82.5 82.5 L 50.0 96.0 L 17.5 82.5 L 4.0 50.0 L 17.5 17.5 Z",
    "accent": "#e8482b"
  },
  {
    "kind": "poly_9",
    "label": "9-side polygon",
    "group": "Infographic",
    "d": "M 50.0 4.0 L 79.6 14.8 L 95.3 42.0 L 89.8 73.0 L 65.7 93.2 L 34.3 93.2 L 10.2 73.0 L 4.7 42.0 L 20.4 14.8 Z",
    "accent": "#3b82a0"
  },
  {
    "kind": "poly_10",
    "label": "10-side polygon",
    "group": "Infographic",
    "d": "M 50.0 4.0 L 77.0 12.8 L 93.7 35.8 L 93.7 64.2 L 77.0 87.2 L 50.0 96.0 L 23.0 87.2 L 6.3 64.2 L 6.3 35.8 L 23.0 12.8 Z",
    "accent": "#22c55e"
  },
  {
    "kind": "poly_11",
    "label": "11-side polygon",
    "group": "Infographic",
    "d": "M 50.0 4.0 L 74.9 11.3 L 91.8 30.9 L 95.5 56.5 L 84.8 80.1 L 63.0 94.1 L 37.0 94.1 L 15.2 80.1 L 4.5 56.5 L 8.2 30.9 L 25.1 11.3 Z",
    "accent": "#f59e0b"
  },
  {
    "kind": "poly_12",
    "label": "12-side polygon",
    "group": "Infographic",
    "d": "M 50.0 4.0 L 73.0 10.2 L 89.8 27.0 L 96.0 50.0 L 89.8 73.0 L 73.0 89.8 L 50.0 96.0 L 27.0 89.8 L 10.2 73.0 L 4.0 50.0 L 10.2 27.0 L 27.0 10.2 Z",
    "accent": "#8b5cf6"
  },
  {
    "kind": "donut",
    "label": "Donut",
    "group": "Infographic",
    "d": "M50 4 A46 46 0 1 0 50.1 4 M50 28 A22 22 0 1 1 49.9 28",
    "accent": "#ec4899"
  },
  {
    "kind": "map_pin_shape",
    "label": "Map pin",
    "group": "Infographic",
    "d": "M50 4 C70 4 86 20 86 40 C86 66 50 96 50 96 C50 96 14 66 14 40 C14 20 30 4 50 4 Z M50 25 A15 15 0 1 0 50.1 25",
    "accent": "#14b8a6"
  },
  {
    "kind": "bolt",
    "label": "Lightning bolt",
    "group": "Infographic",
    "d": "M58 4 L18 56 H46 L36 96 L82 42 H54 Z",
    "accent": "#0ea5e9"
  },
  {
    "kind": "spark",
    "label": "Spark",
    "group": "Infographic",
    "d": "M50 4 L60 38 L96 50 L60 62 L50 96 L40 62 L4 50 L40 38 Z",
    "accent": "#64748b"
  },
  {
    "kind": "target",
    "label": "Target",
    "group": "Infographic",
    "d": "M50 4 A46 46 0 1 0 50.1 4 M50 20 A30 30 0 1 1 49.9 20 M50 38 A12 12 0 1 0 50.1 38",
    "accent": "#111827"
  },
  {
    "kind": "person_token",
    "label": "Person token",
    "group": "Infographic",
    "d": "M50 10 A20 20 0 1 1 49.9 10 M15 90 C18 66 33 54 50 54 C67 54 82 66 85 90 Z",
    "accent": "#e8482b"
  },
  {
    "kind": "house",
    "label": "House",
    "group": "Infographic",
    "d": "M8 48 L50 12 L92 48 V92 H64 V66 H36 V92 H8 Z",
    "accent": "#3b82a0"
  },
  {
    "kind": "tree_shape",
    "label": "Tree shape",
    "group": "Infographic",
    "d": "M50 6 C72 25 88 48 74 62 H88 L62 82 H70 L50 96 L30 82 H38 L12 62 H26 C12 48 28 25 50 6 Z",
    "accent": "#22c55e"
  },
  {
    "kind": "seed_shape",
    "label": "Seed shape",
    "group": "Infographic",
    "d": "M52 6 C88 36 80 84 36 94 C8 70 16 24 52 6 Z",
    "accent": "#f59e0b"
  },
  {
    "kind": "water_wave",
    "label": "Water wave",
    "group": "Infographic",
    "d": "M0 60 C20 40 34 80 52 60 C70 40 82 76 100 54 V100 H0 Z",
    "accent": "#8b5cf6"
  },
  {
    "kind": "burst_01",
    "label": "Sunburst 01",
    "group": "Bursts",
    "d": "M 53.3 2.1 L 56.5 35.4 L 83.3 15.5 L 64.4 43.0 L 97.7 45.0 L 65.5 53.9 L 89.8 76.8 L 59.4 62.9 L 63.2 96.1 L 48.9 66.0 L 30.5 93.9 L 38.9 61.5 L 6.9 71.0 L 34.1 51.7 L 3.4 38.4 L 36.7 41.1 L 21.8 11.2 L 45.6 34.6 Z",
    "accent": "#64748b"
  },
  {
    "kind": "burst_02",
    "label": "Sunburst 02",
    "group": "Bursts",
    "d": "M 56.7 2.5 L 58.8 32.0 L 83.3 15.5 L 67.7 40.6 L 97.3 41.7 L 69.8 52.8 L 93.1 71.0 L 64.4 63.9 L 72.5 92.4 L 53.5 69.7 L 43.3 97.5 L 41.2 68.0 L 16.7 84.5 L 32.3 59.4 L 2.7 58.3 L 30.2 47.2 L 6.9 29.0 L 35.6 36.1 L 27.5 7.6 L 46.5 30.3 Z",
    "accent": "#111827"
  },
  {
    "kind": "burst_03",
    "label": "Sunburst 03",
    "group": "Bursts",
    "d": "M 60.0 3.0 L 61.4 28.9 L 83.8 15.9 L 71.0 38.4 L 96.9 39.6 L 73.9 51.6 L 95.1 66.6 L 69.3 64.3 L 78.9 88.3 L 58.5 72.4 L 53.7 97.9 L 45.0 73.5 L 27.2 92.2 L 33.1 67.1 L 8.0 73.2 L 26.6 55.2 L 2.1 46.8 L 27.5 41.7 L 11.4 21.4 L 35.5 30.9 L 33.0 5.1 L 48.2 26.1 Z",
    "accent": "#e8482b"
  },
  {
    "kind": "burst_04",
    "label": "Sunburst 04",
    "group": "Bursts",
    "d": "M 63.2 3.9 L 64.4 26.0 L 84.5 16.7 L 74.5 36.4 L 96.6 38.4 L 78.0 50.5 L 96.1 63.2 L 74.0 64.4 L 83.3 84.5 L 63.6 74.5 L 61.6 96.6 L 49.5 78.0 L 36.8 96.1 L 35.6 74.0 L 15.5 83.3 L 25.5 63.6 L 3.4 61.6 L 22.0 49.5 L 3.9 36.8 L 26.0 35.6 L 16.7 15.5 L 36.4 25.5 L 38.4 3.4 L 50.5 22.0 Z",
    "accent": "#3b82a0"
  },
  {
    "kind": "burst_05",
    "label": "Sunburst 05",
    "group": "Bursts",
    "d": "M 66.4 4.9 L 56.7 40.0 L 85.5 17.7 L 60.5 44.3 L 96.4 37.9 L 62.0 49.8 L 96.8 60.9 L 60.7 55.4 L 86.4 81.3 L 56.9 59.8 L 67.6 94.6 L 51.6 61.9 L 44.9 97.7 L 45.9 61.3 L 23.3 89.9 L 41.1 58.1 L 7.8 72.9 L 38.4 53.0 L 2.0 50.6 L 38.3 47.3 L 7.2 28.3 L 40.9 42.2 L 22.2 10.9 L 45.6 38.8 L 43.6 2.4 L 51.3 38.1 Z",
    "accent": "#22c55e"
  },
  {
    "kind": "burst_06",
    "label": "Sunburst 06",
    "group": "Bursts",
    "d": "M 69.5 6.1 L 59.6 37.2 L 86.6 19.0 L 64.2 42.6 L 96.5 37.9 L 66.0 49.5 L 97.1 59.3 L 64.6 56.5 L 88.4 78.8 L 60.3 62.2 L 72.1 92.6 L 54.0 65.5 L 51.4 98.0 L 46.9 65.7 L 30.5 93.9 L 40.4 62.8 L 13.4 81.0 L 35.8 57.4 L 3.5 62.1 L 34.0 50.5 L 2.9 40.7 L 35.4 43.5 L 11.6 21.2 L 39.7 37.8 L 27.9 7.4 L 46.0 34.5 L 48.6 2.0 L 53.1 34.3 Z",
    "accent": "#f59e0b"
  },
  {
    "kind": "burst_07",
    "label": "Sunburst 07",
    "group": "Bursts",
    "d": "M 72.5 7.6 L 62.9 34.7 L 87.8 20.4 L 68.0 41.2 L 96.6 38.4 L 70.0 49.3 L 97.3 58.3 L 68.5 57.5 L 89.8 76.8 L 63.9 64.4 L 75.4 90.7 L 56.8 68.8 L 56.7 97.5 L 48.6 70.0 L 36.8 96.1 L 40.6 67.7 L 19.1 86.8 L 34.2 62.3 L 6.9 71.0 L 30.6 54.8 L 2.0 51.7 L 30.3 46.5 L 5.5 32.0 L 33.4 38.8 L 16.7 15.5 L 39.4 33.0 L 33.6 4.9 L 47.2 30.2 L 53.3 2.1 L 55.5 30.8 Z",
    "accent": "#8b5cf6"
  },
  {
    "kind": "burst_08",
    "label": "Sunburst 08",
    "group": "Bursts",
    "d": "M 75.4 9.3 L 69.5 36.1 L 96.8 39.2 L 73.7 54.0 L 90.7 75.4 L 63.9 69.5 L 60.8 96.8 L 46.0 73.7 L 24.6 90.7 L 30.5 63.9 L 3.2 60.8 L 26.3 46.0 L 9.3 24.6 L 36.1 30.5 L 39.2 3.2 L 54.0 26.3 Z",
    "accent": "#ec4899"
  },
  {
    "kind": "burst_09",
    "label": "Sunburst 09",
    "group": "Bursts",
    "d": "M 78.2 11.2 L 73.2 34.3 L 96.6 38.4 L 77.8 52.9 L 93.1 71.0 L 69.5 70.1 L 69.5 93.9 L 52.0 77.9 L 36.8 96.1 L 33.5 72.7 L 10.2 76.8 L 22.8 56.8 L 2.3 45.0 L 24.8 37.7 L 16.7 15.5 L 38.6 24.4 L 46.7 2.1 L 57.7 23.1 Z",
    "accent": "#14b8a6"
  },
  {
    "kind": "burst_10",
    "label": "Sunburst 10",
    "group": "Bursts",
    "d": "M 80.9 13.2 L 60.2 43.6 L 96.6 38.4 L 62.0 50.8 L 94.5 68.0 L 59.2 57.7 L 75.4 90.7 L 52.9 61.6 L 46.7 97.9 L 45.5 61.1 L 19.1 86.8 L 39.8 56.4 L 3.4 61.6 L 38.0 49.2 L 5.5 32.0 L 40.8 42.3 L 24.6 9.3 L 47.1 38.4 L 53.3 2.1 L 54.5 38.9 Z",
    "accent": "#0ea5e9"
  },
  {
    "kind": "burst_11",
    "label": "Sunburst 11",
    "group": "Bursts",
    "d": "M 83.3 15.5 L 63.9 42.1 L 96.7 39.0 L 66.0 50.9 L 95.3 66.0 L 63.0 59.4 L 79.4 87.9 L 55.9 64.9 L 54.3 97.8 L 46.9 65.7 L 27.7 92.5 L 38.9 61.5 L 8.3 73.7 L 34.4 53.7 L 2.1 47.4 L 34.9 44.7 L 11.1 21.9 L 40.2 37.4 L 32.4 5.3 L 48.6 34.1 L 59.4 2.9 L 57.4 35.8 Z",
    "accent": "#64748b"
  },
  {
    "kind": "burst_12",
    "label": "Sunburst 12",
    "group": "Bursts",
    "d": "M 85.7 17.9 L 67.8 40.9 L 97.0 40.0 L 70.0 51.0 L 95.7 64.8 L 66.8 60.9 L 82.1 85.7 L 59.1 67.8 L 60.0 97.0 L 49.0 70.0 L 35.2 95.7 L 39.1 66.8 L 14.3 82.1 L 32.2 59.1 L 3.0 60.0 L 30.0 49.0 L 4.3 35.2 L 33.2 39.1 L 17.9 14.3 L 40.9 32.2 L 40.0 3.0 L 51.0 30.0 L 64.8 4.3 L 60.9 33.2 Z",
    "accent": "#111827"
  },
  {
    "kind": "burst_13",
    "label": "Sunburst 13",
    "group": "Bursts",
    "d": "M 87.8 20.4 L 71.9 40.2 L 97.2 41.4 L 74.0 51.5 L 95.8 64.3 L 70.5 62.4 L 83.9 84.0 L 62.4 70.6 L 64.2 95.8 L 51.4 74.0 L 41.3 97.2 L 40.1 71.9 L 20.3 87.7 L 31.1 64.8 L 6.2 69.6 L 26.4 54.3 L 2.1 47.0 L 27.1 42.8 L 9.0 25.1 L 33.1 33.0 L 25.2 8.9 L 42.9 27.1 L 47.2 2.1 L 54.4 26.4 L 69.8 6.3 L 64.8 31.1 Z",
    "accent": "#e8482b"
  },
  {
    "kind": "burst_14",
    "label": "Sunburst 14",
    "group": "Bursts",
    "d": "M 89.8 23.2 L 76.1 39.9 L 97.5 43.1 L 77.9 52.2 L 95.8 64.4 L 74.2 64.1 L 85.0 82.8 L 65.7 73.2 L 67.3 94.8 L 54.0 77.7 L 46.2 97.8 L 41.6 76.7 L 25.8 91.4 L 30.9 70.4 L 10.2 76.8 L 23.9 60.1 L 2.5 56.9 L 22.1 47.8 L 4.2 35.6 L 25.8 35.9 L 15.0 17.2 L 34.3 26.8 L 32.7 5.2 L 46.0 22.3 L 53.8 2.2 L 58.4 23.3 L 74.2 8.6 L 69.1 29.6 Z",
    "accent": "#3b82a0"
  },
  {
    "kind": "burst_15",
    "label": "Sunburst 15",
    "group": "Bursts",
    "d": "M 91.6 26.0 L 61.4 46.3 L 97.7 45.0 L 61.9 51.3 L 95.7 64.8 L 60.4 56.0 L 85.7 82.1 L 57.1 59.7 L 69.5 93.9 L 52.5 61.7 L 50.0 98.0 L 47.5 61.7 L 30.5 93.9 L 42.9 59.7 L 14.3 82.1 L 39.6 56.0 L 4.3 64.8 L 38.1 51.3 L 2.3 45.0 L 38.6 46.3 L 8.4 26.0 L 41.1 42.0 L 21.8 11.2 L 45.1 39.0 L 40.0 3.0 L 50.0 38.0 L 60.0 3.0 L 54.9 39.0 L 78.2 11.2 L 58.9 42.0 Z",
    "accent": "#22c55e"
  },
  {
    "kind": "burst_16",
    "label": "Sunburst 16",
    "group": "Bursts",
    "d": "M 93.1 29.0 L 66.0 49.0 L 95.4 65.6 L 62.0 60.6 L 71.0 93.1 L 51.0 66.0 L 34.4 95.4 L 39.4 62.0 L 6.9 71.0 L 34.0 51.0 L 4.6 34.4 L 38.0 39.4 L 29.0 6.9 L 49.0 34.0 L 65.6 4.6 L 60.6 38.0 Z",
    "accent": "#f59e0b"
  },
  {
    "kind": "burst_17",
    "label": "Sunburst 17",
    "group": "Bursts",
    "d": "M 94.5 32.0 L 70.0 49.3 L 95.7 64.8 L 65.8 62.3 L 75.4 90.7 L 54.2 69.6 L 43.3 97.5 L 40.6 67.7 L 14.3 82.1 L 31.5 57.5 L 2.0 51.7 L 31.0 43.8 L 12.2 20.4 L 39.4 33.0 L 40.0 3.0 L 52.8 30.2 L 72.5 7.6 L 64.9 36.6 Z",
    "accent": "#8b5cf6"
  },
  {
    "kind": "burst_18",
    "label": "Sunburst 18",
    "group": "Bursts",
    "d": "M 95.7 35.2 L 74.0 50.0 L 95.7 64.8 L 69.4 64.1 L 78.2 88.8 L 57.4 72.8 L 50.0 98.0 L 42.6 72.8 L 21.8 88.8 L 30.6 64.1 L 4.3 64.8 L 26.0 50.0 L 4.3 35.2 L 30.6 35.9 L 21.8 11.2 L 42.6 27.2 L 50.0 2.0 L 57.4 27.2 L 78.2 11.2 L 69.4 35.9 Z",
    "accent": "#ec4899"
  },
  {
    "kind": "burst_19",
    "label": "Sunburst 19",
    "group": "Bursts",
    "d": "M 96.6 38.4 L 78.0 51.2 L 95.5 65.4 L 72.9 66.1 L 79.9 87.5 L 60.6 75.9 L 54.9 97.8 L 44.9 77.5 L 28.3 92.8 L 30.8 70.4 L 8.6 74.3 L 22.8 56.8 L 2.0 48.0 L 23.5 41.0 L 10.7 22.4 L 32.6 28.1 L 31.9 5.6 L 47.2 22.1 L 58.8 2.8 L 62.7 25.0 L 82.9 15.1 L 74.2 35.8 Z",
    "accent": "#14b8a6"
  },
  {
    "kind": "burst_20",
    "label": "Sunburst 20",
    "group": "Bursts",
    "d": "M 97.3 41.7 L 62.0 51.0 L 95.1 66.4 L 59.8 56.9 L 80.9 86.8 L 55.1 60.9 L 58.3 97.3 L 49.0 62.0 L 33.6 95.1 L 43.1 59.8 L 13.2 80.9 L 39.1 55.1 L 2.7 58.3 L 38.0 49.0 L 4.9 33.6 L 40.2 43.1 L 19.1 13.2 L 44.9 39.1 L 41.7 2.7 L 51.0 38.0 L 66.4 4.9 L 56.9 40.2 L 86.8 19.1 L 60.9 44.9 Z",
    "accent": "#0ea5e9"
  },

  /* ── v50 Symbols pack ───────────────────────────────────────── */
  {"kind":"gear","label":"Gear","group":"Symbols","d":"M 88.0 51.5 L 97.7 55.6 L 96.2 63.0 L 85.7 63.2 L 84.5 65.9 L 75.8 77.9 L 79.7 87.7 L 73.5 91.9 L 65.9 84.5 L 63.2 85.7 L 48.5 88.0 L 44.4 97.7 L 37.0 96.2 L 36.8 85.7 L 34.1 84.5 L 22.1 75.8 L 12.3 79.7 L 8.1 73.5 L 15.5 65.9 L 14.3 63.2 L 12.0 48.5 L 2.3 44.4 L 3.8 37.0 L 14.3 36.8 L 15.5 34.1 L 24.2 22.1 L 20.3 12.3 L 26.5 8.1 L 34.1 15.5 L 36.8 14.3 L 51.5 12.0 L 55.6 2.3 L 63.0 3.8 L 63.2 14.3 L 65.9 15.5 L 77.9 24.2 L 87.7 20.3 L 91.9 26.5 L 84.5 34.1 L 85.7 36.8 Z M 66.0 50.0 L 65.5 45.9 L 63.9 42.0 L 61.3 38.7 L 58.0 36.1 L 54.1 34.5 L 50.0 34.0 L 45.9 34.5 L 42.0 36.1 L 38.7 38.7 L 36.1 42.0 L 34.5 45.9 L 34.0 50.0 L 34.5 54.1 L 36.1 58.0 L 38.7 61.3 L 42.0 63.9 L 45.9 65.5 L 50.0 66.0 L 54.1 65.5 L 58.0 63.9 L 61.3 61.3 L 63.9 58.0 L 65.5 54.1 Z","accent":"#64748b"},
  {"kind":"crescent","label":"Crescent","group":"Symbols","d":"M 65 5 A 45 45 0 1 0 65 95 A 36 36 0 1 1 65 5 Z","accent":"#f2c14e"},
  {"kind":"semi_circle","label":"Semi circle","group":"Symbols","d":"M 5 75 A 45 45 0 0 1 95 75 Z","accent":"#38bdf8"},
  {"kind":"quarter_pie","label":"Quarter pie","group":"Symbols","d":"M 10 90 L 10 10 A 80 80 0 0 1 90 90 Z","accent":"#22c55e"},
  {"kind":"cross_plus","label":"Plus cross","group":"Symbols","d":"M 35 5 L 65 5 L 65 35 L 95 35 L 95 65 L 65 65 L 65 95 L 35 95 L 35 65 L 5 65 L 5 35 L 35 35 Z","accent":"#e8482b"},
  {"kind":"check_mark","label":"Check mark","group":"Symbols","d":"M 10 55 L 25 40 L 42 57 L 78 12 L 95 25 L 44 88 Z","accent":"#16a34a"},
  {"kind":"x_mark","label":"X mark","group":"Symbols","d":"M 20 8 L 50 38 L 80 8 L 92 20 L 62 50 L 92 80 L 80 92 L 50 62 L 20 92 L 8 80 L 38 50 L 8 20 Z","accent":"#ef4444"},
  {"kind":"capsule","label":"Capsule","group":"Symbols","d":"M 30 15 L 70 15 A 35 35 0 0 1 70 85 L 30 85 A 35 35 0 0 1 30 15 Z","accent":"#a855f7"},
  {"kind":"frame_square","label":"Square frame","group":"Symbols","d":"M 5 5 L 95 5 L 95 95 L 5 95 Z M 25 25 L 25 75 L 75 75 L 75 25 Z","accent":"#0f172a"},
  {"kind":"kite","label":"Kite","group":"Symbols","d":"M 50 4 L 88 40 L 50 96 L 12 40 Z","accent":"#f59e0b"},
  {"kind":"arrow_up","label":"Arrow up","group":"Arrows Pro","d":"M 50 4 L 92 46 L 68 46 L 68 96 L 32 96 L 32 46 L 8 46 Z","accent":"#22c55e"},
  {"kind":"arrow_down","label":"Arrow down","group":"Arrows Pro","d":"M 50 96 L 8 54 L 32 54 L 32 4 L 68 4 L 68 54 L 92 54 Z","accent":"#ef4444"},
  {"kind":"double_arrow","label":"Double arrow","group":"Arrows Pro","d":"M 4 50 L 28 26 L 28 40 L 72 40 L 72 26 L 96 50 L 72 74 L 72 60 L 28 60 L 28 74 Z","accent":"#38bdf8"},
  {"kind":"arrow_bend","label":"Bent arrow","group":"Arrows Pro","d":"M 12 88 L 12 40 A 28 28 0 0 1 40 12 L 62 12 L 62 0 L 96 22 L 62 44 L 62 32 L 42 32 A 10 10 0 0 0 32 42 L 32 88 Z","accent":"#a855f7"}
];
function shapeDef(kind){return SHAPES.find(s=>s.kind===kind)||SHAPES[0];}
function objectDef(kind){if(kind==="sdg")kind="sdg_wheel";if(kind==="animals")kind="cow";return OBJECTS.find(o=>o.kind===kind)||OBJECTS[0];}

/* ════════════════════════════════════════════════════════════════════
   ELEMENT FACTORIES — every element is a plain data object.
   types: text | rect | ellipse | line | image
   common: {id,type,x,y,w,h,rot,anim,animDelay}
   ════════════════════════════════════════════════════════════════════ */
function elBase(type,over={}){
  return Object.assign({
    id:uid(), type, x:120,y:120,w:300,h:120,rot:0,
    anim:"fade", animDelay:0,
    // "entry"  — appears with the slide (the default, and every old deck)
    // "cue"    — held back on the live stage until the presenter taps it
    //            in on the phone controller. The editor always shows it.
    revealOn:"entry",
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
function makeGallery(over={}){
  return elBase("gallery",Object.assign({
    x:180,y:90,w:600,h:400,
    photos:[],                 // [{src, caption}]
    frame:"polaroid",          // none|border|shadow|polaroid|film|card|gold|tape
    fit:"cover",
    galleryAnim:"fade",        // per-photo in/out style: fade|zoom|slide|rise|flip|reveal
    stagger:1,                 // in/out speed multiplier (0.25–4)
    holdMs:2600,               // how long each photo holds
    galleryLoop:true,          // loop back to the first photo
    galleryBg:"",              // optional backdrop behind photos
    anim:"zoom",animDelay:0    // whole-block entry (reuses the 21 animateIn set)
  },over));
}
function makeVideo(over={}){
  return elBase("video",Object.assign({
    x:160,y:120,w:640,h:360,src:"",poster:"",title:"Video",radius:18,
    autoplay:false,muted:false,controls:true,fit:"cover",anim:"rise",animDelay:0
  },over));
}
function makeLink(over={}){
  return elBase("link",Object.assign({
    x:220,y:190,w:520,h:120,url:"https://",label:"Open link",description:"Click in presentation mode to open this resource.",
    linkStyle:"button",accent:"#2563eb",textColor:"#ffffff",bg:"#2563eb",radius:22,anim:"rise",animDelay:0
  },over));
}


function makeTable(over={}){
  return elBase("table",Object.assign({
    x:170,y:150,w:620,h:290,rot:0,anim:"rise",animDelay:0,
    rows:5, cols:4, header:true, accent:"#1d4e89", theme:"clean",
    font:'"Archivo",sans-serif', size:18,
    tableData:[
      ["Item","Q1","Q2","Q3"],
      ["Rice","45","52","61"],
      ["Maize","30","38","44"],
      ["Groundnut","22","28","35"],
      ["Total","97","118","140"]
    ]
  },over));
}
function makeChart(kind="bar",over={}){
  const isGraph = kind==="line" || kind==="area" || kind==="scatter";
  return elBase("chart",Object.assign({
    x:150,y:118,w:650,h:330,rot:0,anim:"rise",animDelay:0,
    chartKind:kind, title:isGraph?"Growth graph":"Impact chart", accent:"#e8482b",
    showValues:true, chartTheme:"modern",
    renderEngine:"svg",          // svg | plotly
    plotlyTemplate:"plotly_white",
    plotlyModebar:false,
    // ── richer chart controls ──
    labelSize:26,          // SVG label/value font size (px in chart space)
    gridLines:true,        // show background gridlines
    axisValues:true,       // show numeric axis scale on the left
    showLegend:false,      // legend for grouped/stacked bars
    seriesNames:["Series 1","Series 2","Series 3"],
    palette:["#e8482b","#22c55e","#38bdf8","#f59e0b","#a855f7","#ef4444"],
    valuePrefix:"", valueSuffix:"", decimals:0, unit:"", max:100,
    titleColor:"", chartThemeMode:"light",
    chartData:[
      {label:"Jan",value:24},{label:"Feb",value:38},{label:"Mar",value:45},
      {label:"Apr",value:62},{label:"May",value:74},{label:"Jun",value:88}
    ]
  },over));
}
function makeMap(kind="gambia",over={}){
  const geo=(typeof MAP_GEO!=="undefined"&&MAP_GEO[kind])?MAP_GEO[kind]:null;
  const cities=geo&&geo.cities?geo.cities.slice(0,4).map((c,i)=>({label:c.label,lon:c.lon,lat:c.lat,value:[12,28,18,10][i]||""})):[];
  return elBase("map",Object.assign({
    x:150,y:100,w:650,h:360,rot:0,anim:"rise",animDelay:0,
    mapKind:kind, title:(geo?geo.name:"Activity")+" map",
    mapEngine:"svg",             // svg | folium | plotly
    tileLayer:"osm", zoom:null,
    accent:"#2f6f4f", showLabels:true, showRiver:true, useCities:false,
    labelSize:24, mapTheme:"light", titleColor:"",
    // Optional affected-area polygons drawn from imported/input coordinates.
    // Each area: {label, coordinates:[[lon,lat],...], value, fill, stroke, fillOpacity}
    areas:[], areaFill:"#e8482b", areaStroke:"#ffffff", areaOpacity:0.42,
    pins: cities.length?cities:[
      {label:"Banjul",lon:-16.58,lat:13.45,value:12},
      {label:"Brikama",lon:-16.65,lat:13.27,value:28},
      {label:"Soma",lon:-15.53,lat:13.43,value:18},
      {label:"Basse",lon:-14.21,lat:13.31,value:10}
    ]
  },over));
}

function makeObject(kind="water_glass",over={}){
  const d=objectDef(kind);
  return elBase("object",Object.assign({
    objectType:kind, label:d.label, icon:d.icon, count:d.count||1, level:d.level||0,
    accent:d.accent||"#4cc9f0", w:d.w||320, h:d.h||220,
    showCount:true, anim:"rise", animDelay:0,
    // number on the object: where it sits and how it behaves while filling
    numberPos: d.fill ? "onfill" : "below",   // below | onfill | center
    numberMode: "static",                      // static | countup
    numberColor: "",                           // "" = use the built-in default per object
    numberSize: 0,                             // 0 = auto (responsive default); otherwise px in slide space
    objAnim: true,                             // idle/fill animation on/off
    objScale: 1,                               // visual zoom of the inner art inside the fixed box
  },over));
}

function makeCreativeShape(kind="blob_01",over={}){
  const d=shapeDef(kind);
  return elBase("creative_shape",Object.assign({
    shapeType:kind, w:240, h:240, fill:d.accent||"#e8482b", stroke:"none", strokeW:0, opacity:1,
    anim:"rise", animDelay:0,
  },over));
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


function T_waterLevel(){return{bg:"radial-gradient(80% 80% at 50% 20%,#17405f 0%,#07131f 55%,#020509 100%)",bgFx:"bubbles",els:[
  makeText({x:70,y:70,w:520,h:80,text:"Water Level",font:'"Archivo Expanded","Archivo",sans-serif',size:54,weight:800,color:"#ffffff",anim:"left"}),
  makeText({x:74,y:145,w:480,h:80,text:"Specify the percentage and the water animates inside the glass.",size:24,weight:500,color:"#bfeaf7",font:'"Archivo",sans-serif',lh:1.25,anim:"fade",animDelay:.2}),
  makeObject("water_glass",{x:630,y:82,w:230,h:360,level:68,count:1,anim:"pop",animDelay:.15}),
  makeText({x:100,y:380,w:420,h:80,text:"68%",font:'"Archivo Expanded","Archivo",sans-serif',size:92,weight:800,color:"#4cc9f0",anim:"rise",animDelay:.35}),
]};}
function T_agriImpact(){return{bg:"radial-gradient(70% 90% at 15% 20%,#cfe7c8 0%,transparent 55%),linear-gradient(145deg,#f6f1e7,#ead8b0)",els:[
  makeText({x:70,y:56,w:780,h:80,text:"Agriculture impact map",font:'"Fraunces",serif',size:62,weight:700,color:"#123226",anim:"rise"}),
  makeObject("farmer",{x:76,y:175,w:250,h:185,count:5,anim:"left",animDelay:.12}),
  makeObject("tree",{x:360,y:160,w:260,h:205,count:10,anim:"rise",animDelay:.22}),
  makeObject("animals",{x:645,y:165,w:240,h:205,count:7,anim:"right",animDelay:.32}),
  makeText({x:80,y:410,w:780,h:50,text:"Farmers · Trees · Livestock",font:'"Spline Sans Mono",monospace',size:20,weight:700,ls:2,color:"#2f6f4f",align:"center",anim:"fade",animDelay:.45}),
]};}
function T_seedGrowth(){return{bg:"linear-gradient(160deg,#10281e,#2f6f4f 65%,#7fb069)",els:[
  makeText({x:70,y:70,w:500,h:120,text:"Seeds to growth",font:'"Fraunces",serif',size:72,weight:700,italic:true,color:"#fbf8f1",anim:"rise"}),
  makeText({x:72,y:190,w:430,h:90,text:"Use count to show seed distribution, beneficiaries, inputs, or planting units.",size:23,color:"#d9f2d0",font:'"Archivo",sans-serif',lh:1.32,anim:"fade",animDelay:.2}),
  makeObject("seed_pile",{x:525,y:95,w:350,h:300,count:48,level:82,anim:"pop",animDelay:.25}),
  makeText({x:76,y:392,w:380,h:76,text:"48 units",font:'"Archivo Expanded","Archivo",sans-serif',size:48,weight:800,color:"#d8f3a4",anim:"left",animDelay:.35}),
]};}
function T_modernCanva(){return{bg:"radial-gradient(55% 65% at 20% 10%,#ff6a4d 0%,transparent 60%),radial-gradient(60% 80% at 90% 25%,#4cc9f0 0%,transparent 58%),linear-gradient(135deg,#1a1028,#08111f)",bgFx:"mesh",els:[
  makeShape("rect",{x:70,y:72,w:820,h:396,fill:"rgba(255,255,255,.13)",stroke:"rgba(255,255,255,.38)",strokeW:1,radius:34,anim:"zoom"}),
  makeText({x:110,y:112,w:520,h:90,text:"Modern presentation",font:'"Archivo Expanded","Archivo",sans-serif',size:49,weight:800,color:"#ffffff",lh:1.05,anim:"rise",animDelay:.1}),
  makeText({x:112,y:228,w:440,h:88,text:"Canva-style glass cards, gradients, animated icons and clean data objects.",size:24,color:"#e7e6ff",font:'"Archivo",sans-serif',lh:1.3,anim:"fade",animDelay:.25}),
  makeObject("people",{x:595,y:150,w:220,h:180,count:12,anim:"pop",animDelay:.3}),
  makeObject("plates",{x:600,y:330,w:190,h:88,count:5,anim:"rise",animDelay:.42}),
]};}

/* ── new creative templates: moving backgrounds + objects + shapes ─── */
function T_cosmicTitle(){return{bg:"radial-gradient(80% 90% at 50% 0%,#312e81 0%,transparent 60%),linear-gradient(160deg,#020617,#0b1027)",bgFx:"stars",els:[
  makeCreativeShape("burst_12",{x:560,y:-60,w:520,h:520,fill:"#7c3aed",opacity:.5,anim:"zoom"}),
  makeText({x:80,y:120,w:520,h:60,text:"INTO THE UNKNOWN",size:18,weight:800,ls:7,color:"#a5b4fc",font:'"Spline Sans Mono",monospace',anim:"left"}),
  makeText({x:78,y:175,w:740,h:220,text:"A cosmic\nbeginning",font:'"Playfair Display",serif',size:104,weight:800,italic:true,color:"#f8fafc",lh:.98,anim:"rise",animDelay:.12}),
  makeText({x:82,y:430,w:600,h:50,text:"Starfield motion · live audience reactions",size:22,color:"#c7d2fe",font:'"Inter",sans-serif',anim:"fade",animDelay:.35}),
]};}
function T_oceanHero(){return{bg:"linear-gradient(180deg,#0c4a6e,#0369a1 55%,#0ea5e9)",bgFx:"waves",els:[
  makeText({x:70,y:96,w:560,h:60,text:"BLUE ECONOMY",size:18,weight:800,ls:6,color:"#bae6fd",font:'"Spline Sans Mono",monospace',anim:"left"}),
  makeText({x:68,y:150,w:640,h:200,text:"Riding the\ntide of change",font:'"Fraunces",serif',size:88,weight:700,italic:true,color:"#f0f9ff",lh:1,anim:"rise",animDelay:.1}),
  makeObject("water_glass",{x:700,y:120,w:190,h:320,level:74,anim:"pop",animDelay:.3}),
  makeCreativeShape("water_wave",{x:60,y:392,w:840,h:120,fill:"rgba(255,255,255,.18)",anim:"reveal",animDelay:.3}),
]};}
function T_bubblePitch(){return{bg:"radial-gradient(70% 80% at 80% 10%,#22d3ee 0%,transparent 60%),linear-gradient(150deg,#06283d,#041d2e)",bgFx:"bubbles",els:[
  makeText({x:72,y:90,w:540,h:80,text:"Fresh ideas, rising fast",font:'"Sora",sans-serif',size:54,weight:800,color:"#ecfeff",lh:1.05,anim:"rise"}),
  makeText({x:74,y:200,w:430,h:96,text:"Float your concept above the noise with motion that feels alive.",size:24,color:"#a5f3fc",font:'"Manrope",sans-serif',lh:1.32,anim:"fade",animDelay:.2}),
  makeObject("idea",{x:560,y:120,w:300,h:300,count:1,showCount:false,anim:"pop",animDelay:.3}),
  makeCreativeShape("blob_07",{x:90,y:330,w:180,h:180,fill:"rgba(34,211,238,.28)",anim:"zoom",animDelay:.4}),
]};}
function T_celebrate(){return{bg:"radial-gradient(80% 80% at 50% 0%,#f59e0b 0%,transparent 55%),linear-gradient(160deg,#7c2d12,#111827)",bgFx:"confetti",els:[
  makeText({x:120,y:170,w:720,h:160,text:"We did it! 🎉",font:'"Archivo Expanded","Archivo",sans-serif',size:96,weight:800,color:"#fff7ed",align:"center",anim:"pop"}),
  makeText({x:160,y:340,w:640,h:60,text:"Milestone reached — thank you, team.",size:28,color:"#fde68a",align:"center",font:'"Manrope",sans-serif',anim:"fade",animDelay:.3}),
  makeObject("trophy",{x:430,y:60,w:110,h:110,count:1,showCount:false,anim:"drop",animDelay:.15}),
]};}
function T_snowQuiet(){return{bg:"linear-gradient(170deg,#0f172a,#1e293b 60%,#334155)",bgFx:"snow",els:[
  makeText({x:120,y:160,w:720,h:200,text:"“Stillness\nspeaks.”",font:'"Cormorant Garamond",serif',size:104,weight:600,italic:true,color:"#e2e8f0",align:"center",lh:1,anim:"blur"}),
  makeText({x:120,y:400,w:720,h:40,text:"— a quiet section break",size:20,color:"#94a3b8",align:"center",font:'"Inter",sans-serif',anim:"fade",animDelay:.4}),
]};}
function T_rainMood(){return{bg:"linear-gradient(160deg,#0b1220,#1e293b)",bgFx:"rain",els:[
  makeText({x:70,y:110,w:600,h:60,text:"CLIMATE BRIEF",size:18,weight:800,ls:6,color:"#7dd3fc",font:'"Spline Sans Mono",monospace',anim:"left"}),
  makeText({x:68,y:165,w:700,h:170,text:"When the\nrains return",font:'"Fraunces",serif',size:82,weight:700,color:"#f1f5f9",lh:1,anim:"rise",animDelay:.12}),
  makeObject("raindrops",{x:640,y:150,w:240,h:240,count:18,accent:"#38bdf8",anim:"pop",animDelay:.3}),
]};}
function T_gridTech(){return{bg:"linear-gradient(135deg,#020617,#0b1d3a)",bgFx:"grid",els:[
  makeText({x:64,y:70,w:560,h:50,text:"SYSTEM STATUS",size:17,weight:800,ls:6,color:"#38bdf8",font:'"JetBrains Mono",monospace',anim:"left"}),
  makeText({x:62,y:118,w:680,h:120,text:"Live infrastructure",font:'"Space Grotesk",sans-serif',size:62,weight:800,color:"#e2e8f0",anim:"rise",animDelay:.1}),
  makeObject("server",{x:80,y:255,w:230,h:200,count:6,accent:"#22d3ee",anim:"left",animDelay:.25}),
  makeObject("cloud",{x:360,y:255,w:230,h:200,count:4,accent:"#60a5fa",anim:"rise",animDelay:.32}),
  makeObject("database",{x:640,y:255,w:230,h:200,count:3,accent:"#34d399",anim:"right",animDelay:.4}),
]};}
function T_spotlight(){return{bg:"radial-gradient(50% 55% at 50% 38%,#1e293b 0%,#020617 70%)",bgFx:"pulse",bgFxColor:"rgba(56,189,248,.35)",els:[
  makeText({x:160,y:170,w:640,h:180,text:"One bold\nstatement",font:'"Archivo Expanded","Archivo",sans-serif',size:84,weight:800,color:"#f8fafc",align:"center",lh:.98,anim:"zoom"}),
  makeShape("rect",{x:420,y:380,w:120,h:8,fill:"#38bdf8",radius:6,anim:"reveal",animDelay:.35}),
  makeText({x:160,y:410,w:640,h:44,text:"Let it land. Then move on.",size:22,color:"#cbd5e1",align:"center",font:'"Inter",sans-serif',anim:"fade",animDelay:.45}),
]};}
function T_auroraStat(){return{bg:"linear-gradient(150deg,#0f172a,#1e1b4b 65%,#312e81)",bgFx:"drift",els:[
  makeText({x:70,y:60,w:520,h:44,text:"IMPACT AT A GLANCE",size:17,weight:800,ls:5,color:"#c4b5fd",font:'"Spline Sans Mono",monospace',anim:"left"}),
  makeText({x:64,y:104,w:560,h:230,text:"93%",font:'"Archivo Expanded","Archivo",sans-serif',size:200,weight:800,color:"#f5f3ff",lh:.9,anim:"pop"}),
  makeText({x:70,y:360,w:540,h:90,text:"of viewers remember a slide that moves. Make every frame count.",size:25,color:"#ddd6fe",font:'"Manrope",sans-serif',lh:1.3,anim:"fade",animDelay:.3}),
  makeObject("people",{x:640,y:150,w:250,h:240,count:16,accent:"#a855f7",showCount:false,anim:"rise",animDelay:.25}),
]};}
function T_orbitSystem(){return{bg:"radial-gradient(70% 80% at 50% 50%,#1e1b4b 0%,#020617 75%)",bgFx:"orbit",els:[
  makeCreativeShape("donut",{x:360,y:130,w:240,h:240,fill:"rgba(168,85,247,.5)",anim:"zoom"}),
  makeText({x:120,y:60,w:720,h:50,text:"THE ECOSYSTEM",size:18,weight:800,ls:7,color:"#c4b5fd",align:"center",font:'"Spline Sans Mono",monospace',anim:"fade"}),
  makeText({x:340,y:215,w:280,h:80,text:"Core",font:'"Sora",sans-serif',size:44,weight:800,color:"#f8fafc",align:"center",anim:"pop",animDelay:.2}),
  makeText({x:120,y:430,w:720,h:50,text:"Everything orbits the value you create.",size:22,color:"#ddd6fe",align:"center",font:'"Inter",sans-serif',anim:"fade",animDelay:.4}),
]};}
function T_rayLaunch(){return{bg:"radial-gradient(70% 80% at 50% 30%,#f59e0b 0%,transparent 58%),linear-gradient(160deg,#451a03,#111827)",bgFx:"rays",els:[
  makeText({x:90,y:130,w:600,h:60,text:"LAUNCH DAY",size:18,weight:800,ls:7,color:"#fde68a",font:'"Spline Sans Mono",monospace',anim:"left"}),
  makeText({x:88,y:185,w:760,h:180,text:"Ready for\nliftoff",font:'"Bebas Neue",sans-serif',size:128,weight:400,color:"#fffbeb",lh:.92,ls:1,anim:"rise",animDelay:.12}),
  makeObject("airplane",{x:660,y:300,w:230,h:150,count:1,showCount:false,accent:"#fbbf24",anim:"right",animDelay:.3}),
]};}
function T_filmStory(){return{bg:"linear-gradient(160deg,#1c1917,#0c0a09)",bgFx:"noise",els:[
  makeShape("rect",{x:0,y:60,w:960,h:60,fill:"#0c0a09",anim:"fade"}),
  makeShape("rect",{x:0,y:420,w:960,h:60,fill:"#0c0a09",anim:"fade"}),
  makeText({x:90,y:200,w:780,h:140,text:"A documentary look",font:'"Libre Baskerville",serif',size:64,weight:700,color:"#fafaf9",anim:"blur",animDelay:.1}),
  makeText({x:92,y:330,w:600,h:50,text:"Grain, contrast and a quiet confidence.",size:22,color:"#d6d3d1",font:'"Lora",serif',italic:true,anim:"fade",animDelay:.3}),
]};}
function T_gradientBrand(){return{bg:"linear-gradient(135deg,#ec4899,#8b5cf6 50%,#22d3ee)",bgFx:"gradient",els:[
  makeText({x:80,y:150,w:800,h:200,text:"Bold by\ndefault",font:'"Plus Jakarta Sans",sans-serif',size:110,weight:800,color:"#ffffff",lh:.95,anim:"rise"}),
  makeText({x:84,y:400,w:600,h:50,text:"A living gradient for brand & product reveals.",size:24,color:"rgba(255,255,255,.92)",font:'"Plus Jakarta Sans",sans-serif',weight:500,anim:"fade",animDelay:.3}),
  makeCreativeShape("spark",{x:760,y:90,w:120,h:120,fill:"rgba(255,255,255,.85)",anim:"pop",animDelay:.4}),
]};}
function T_shapeShowcase(){return{bg:"linear-gradient(150deg,#0f172a,#1e293b)",bgFx:"drift",els:[
  makeText({x:64,y:54,w:760,h:60,text:"Creative shapes",font:'"Space Grotesk",sans-serif',size:52,weight:800,color:"#f8fafc",anim:"rise"}),
  makeCreativeShape("blob_03",{x:70,y:150,w:200,h:200,fill:"#f43f5e",anim:"pop",animDelay:.15}),
  makeCreativeShape("star_8",{x:300,y:150,w:200,h:200,fill:"#fbbf24",anim:"pop",animDelay:.25}),
  makeCreativeShape("hexagon",{x:530,y:150,w:200,h:200,fill:"#22d3ee",anim:"pop",animDelay:.35}),
  makeCreativeShape("burst_06",{x:740,y:150,w:200,h:200,fill:"#a855f7",anim:"pop",animDelay:.45}),
  makeText({x:64,y:400,w:820,h:60,text:"Mix blobs, stars, polygons and bursts as decorative accents.",size:22,color:"#cbd5e1",font:'"Inter",sans-serif',anim:"fade",animDelay:.55}),
]};}
function T_growthBubbles(){return{bg:"linear-gradient(160deg,#052e16,#166534 70%,#22c55e)",bgFx:"bubbles",els:[
  makeText({x:70,y:70,w:560,h:120,text:"Things that grow",font:'"Fraunces",serif',size:70,weight:700,italic:true,color:"#f0fdf4",anim:"rise"}),
  makeObject("tree",{x:90,y:200,w:240,h:230,count:9,anim:"left",animDelay:.2}),
  makeObject("seed_pile",{x:370,y:200,w:240,h:230,count:40,level:80,anim:"rise",animDelay:.3}),
  makeObject("farmer",{x:650,y:200,w:240,h:230,count:6,anim:"right",animDelay:.4}),
]};}

/* ════════════════════════════════════════════════════════════════════
   Uploaded reference templates — added as built-in defaults.
   Canvas is 960×540. Faithful re-creations (originals, in the Hanns visual
   language) of the seven infographic layouts the user supplied.
   ──────────────────────────────────────────────────────────────────── */

/* 1 ─ Animals stat bars: a descending bar chart with caption rows beside it,
   echoing the "Animals ppt download" cow/pig/bull/yeti percentage bars. */
function T_animalsBars(){
  const pal=["#cf4a45","#5aa75a","#e08a3c","#4ba3c7"];
  return {bg:"#ffffff",els:[
    makeText({x:120,y:28,w:720,h:64,text:"Animal impact metrics",font:'"Fraunces",serif',size:46,weight:600,color:"#2a2a2a",align:"center",anim:"rise"}),
    makeChart("bar",{x:40,y:150,w:680,h:360,title:"",chartFrame:"none",accent:"#cf4a45",
      palette:pal,showValues:true,gridLines:false,axisValues:false,max:100,valueSuffix:"%",
      labelSize:22,chartThemeMode:"light",anim:"rise",animDelay:.1,
      chartData:[{label:"Cow",value:85},{label:"Pig",value:65},{label:"Bull",value:45},{label:"Yeti",value:25}]}),
    makeObject("cow",{x:70,y:118,w:120,h:110,count:1,showCount:false,hideContainer:true,anim:"pop",animDelay:.3}),
    // four caption rows on the right
    makeShape("rect",{x:760,y:150,w:150,h:46,fill:pal[0],radius:8,anim:"left",animDelay:.2}),
    makeText({x:760,y:162,w:150,h:24,text:"Caption",size:16,weight:800,color:"#fff",align:"center",font:'"Archivo",sans-serif',anim:"fade",animDelay:.25}),
    makeText({x:760,y:206,w:160,h:48,text:"This slide is an editable slide with all your needs.",size:13,color:"#444",font:'"Archivo",sans-serif',lh:1.3,anim:"fade",animDelay:.3}),
    makeShape("rect",{x:760,y:240,w:150,h:46,fill:pal[1],radius:8,anim:"left",animDelay:.3}),
    makeText({x:760,y:252,w:150,h:24,text:"Caption",size:16,weight:800,color:"#fff",align:"center",font:'"Archivo",sans-serif',anim:"fade",animDelay:.35}),
    makeText({x:760,y:296,w:160,h:48,text:"This slide is an editable slide with all your needs.",size:13,color:"#444",font:'"Archivo",sans-serif',lh:1.3,anim:"fade",animDelay:.4}),
    makeShape("rect",{x:760,y:330,w:150,h:46,fill:pal[2],radius:8,anim:"left",animDelay:.4}),
    makeText({x:760,y:342,w:150,h:24,text:"Caption",size:16,weight:800,color:"#fff",align:"center",font:'"Archivo",sans-serif',anim:"fade",animDelay:.45}),
    makeText({x:760,y:386,w:160,h:48,text:"This slide is an editable slide with all your needs.",size:13,color:"#444",font:'"Archivo",sans-serif',lh:1.3,anim:"fade",animDelay:.5}),
    makeShape("rect",{x:760,y:420,w:150,h:46,fill:pal[3],radius:8,anim:"left",animDelay:.5}),
    makeText({x:760,y:432,w:150,h:24,text:"Caption",size:16,weight:800,color:"#fff",align:"center",font:'"Archivo",sans-serif',anim:"fade",animDelay:.55}),
    makeText({x:760,y:476,w:160,h:48,text:"This slide is an editable slide with all your needs.",size:13,color:"#444",font:'"Archivo",sans-serif',lh:1.3,anim:"fade",animDelay:.6}),
  ]};
}

/* 2 ─ "Our Profit": two big-number metric circles on the left, a paired
   (grouped) bar chart climbing on the right. Soft cream background. */
function T_ourProfit(){
  return {bg:"#fbf0d9",els:[
    makeText({x:70,y:60,w:420,h:70,text:"Our Profit",font:'"Quicksand",sans-serif',size:54,weight:800,color:"#1f4e4a",anim:"rise"}),
    // metric circle 1
    makeCreativeShape("blob_01",{x:90,y:230,w:200,h:200,fill:"#ffffff",anim:"pop",animDelay:.15}),
    makeText({x:90,y:300,w:200,h:70,text:"5M",font:'"Quicksand",sans-serif',size:54,weight:800,color:"#e0a83c",align:"center",anim:"fade",animDelay:.25}),
    makeText({x:80,y:440,w:220,h:30,text:"Lorem ipsum",size:22,weight:800,color:"#1f4e4a",align:"center",font:'"Quicksand",sans-serif',anim:"fade",animDelay:.3}),
    makeText({x:80,y:474,w:220,h:44,text:"Lorem ipsum dolor sit amet, usu utinam.",size:14,color:"#6b7d6b",align:"center",font:'"Quicksand",sans-serif',lh:1.3,anim:"fade",animDelay:.35}),
    // metric circle 2
    makeCreativeShape("blob_01",{x:330,y:230,w:200,h:200,fill:"#ffffff",anim:"pop",animDelay:.25}),
    makeText({x:330,y:300,w:200,h:70,text:"138K",font:'"Quicksand",sans-serif',size:48,weight:800,color:"#1f4e4a",align:"center",anim:"fade",animDelay:.35}),
    makeText({x:320,y:440,w:220,h:30,text:"Lorem ipsum dolor",size:22,weight:800,color:"#1f4e4a",align:"center",font:'"Quicksand",sans-serif',anim:"fade",animDelay:.4}),
    makeText({x:320,y:474,w:220,h:44,text:"Lorem ipsum dolor sit amet, usu utinam.",size:14,color:"#6b7d6b",align:"center",font:'"Quicksand",sans-serif',lh:1.3,anim:"fade",animDelay:.45}),
    // paired climbing bars on the right
    makeChart("groupedBar",{x:560,y:150,w:380,h:360,title:"",chartFrame:"none",accent:"#e0a83c",
      palette:["#e0a83c","#1f6b63"],showValues:true,gridLines:false,axisValues:false,
      showLegend:false,labelSize:18,chartThemeMode:"light",max:6,anim:"rise",animDelay:.3,
      seriesNames:["Target","Actual"],
      chartData:[
        {label:"Year",value:1,series:[1,0.5]},
        {label:"Year",value:3,series:[3,1.5]},
        {label:"Year",value:4,series:[4,2.5]},
        {label:"Year",value:5,series:[5,3.8]}
      ]}),
  ]};
}

/* 3 ─ Beer glass infographic: a filled beer vessel on the left, four rounded
   caption bars stepping in blue on the right. */
function T_beerInfographic(){
  const blues=["#cfe9f5","#aedcf0","#6fc0e6","#2f8fc4"];
  const row=(i,y,d)=>([
    makeShape("rect",{x:330,y:y,w:560,h:74,fill:blues[i],radius:38,anim:"left",animDelay:d}),
    makeCreativeShape("blob_01",{x:318,y:y-6,w:86,h:86,fill:"#eef6fb",anim:"pop",animDelay:d+.05}),
    makeText({x:420,y:y+12,w:300,h:28,text:"Lorem ipsum",size:22,weight:800,color:"#1f5b7a",font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.1}),
    makeText({x:420,y:y+40,w:450,h:30,text:"Lorem ipsum dolor sit amet, consectetuer adipiscing elit, sed diam.",size:11,color:"#4a6577",font:'"Montserrat",sans-serif',lh:1.25,anim:"fade",animDelay:d+.12}),
  ]);
  return {bg:"#ffffff",els:[
    makeObject("beer_glass",{x:40,y:50,w:240,h:440,level:78,showValue:false,showLabel:false,hideContainer:true,anim:"pop",animDelay:.1}),
    ...row(0,60,.2),
    ...row(1,150,.3),
    ...row(2,240,.4),
    ...row(3,330,.5),
  ]};
}

/* 4 ─ Coffee infographic — faithful recreation of the reference: a deep-blue
   field, a centred segmented take-away cup with 100% / 50% band labels, four
   white icon-circle nodes in the corners, dashed connectors from the cup to
   each node, and a bottom caption. Built from reusable objects so the cup and
   each node can be copied onto any other slide. */
function T_coffeeInfographic(){
  const NAVY="#1f5e86", LINE="rgba(170,200,225,.6)";
  // dashed connector segments (thin lines; vertical when h>w)
  const hLink=(x,y,w,d)=>makeLine({x,y,w,h:2,fill:LINE,dashed:true,anim:"fade",animDelay:d});
  const vLink=(x,y,h,d)=>makeLine({x,y,w:2,h,fill:LINE,dashed:true,anim:"fade",animDelay:d});
  return {bg:"#1c5687",els:[
    // dashed connectors (drawn first, behind everything): cup edge → node
    hLink(305,300,55,.15), vLink(170,210,92,.15), hLink(170,210,135,.15),     // top-left
    hLink(600,300,55,.18), vLink(788,210,92,.18), hLink(655,210,135,.18),     // top-right
    hLink(305,395,55,.2),  vLink(170,395,95,.2),  hLink(170,490,135,.2),      // bottom-left
    hLink(600,395,55,.22), vLink(788,395,95,.22), hLink(655,490,135,.22),     // bottom-right

    makeText({x:200,y:60,w:560,h:50,text:"COFFEE INFOGRAPHIC",font:'"Montserrat",sans-serif',size:36,weight:800,color:"#ffffff",align:"center",ls:1,anim:"rise"}),

    // centre cup (reusable coffee_segments object) — bands carry their own labels & sub-captions
    makeObject("coffee_segments",{x:330,y:120,w:300,h:400,hideContainer:true,
      numberColor:"#ffffff",
      bands:[
        {label:"100%",color:"#a9805c"},
        {label:"",color:"#8c6443",sub:"Lorem ipsum\ndolor sit amet,\nconsectetuer"},
        {label:"50%",color:"#6f4a2e"},
        {label:"",color:"#56371f",sub:"Lorem ipsum\ndolor sit amet,\nconsectetuer"}
      ],
      anim:"pop",animDelay:.15}),

    // four corner nodes (reusable info_node objects)
    makeObject("info_node",{x:40,y:40,w:170,h:180,nodeIcon:"mug",hideContainer:true,anim:"pop",animDelay:.3}),
    makeObject("info_node",{x:750,y:40,w:170,h:180,nodeIcon:"pot",hideContainer:true,anim:"pop",animDelay:.35}),
    makeObject("info_node",{x:40,y:340,w:170,h:180,nodeIcon:"carton",hideContainer:true,anim:"pop",animDelay:.4}),
    makeObject("info_node",{x:750,y:340,w:170,h:180,nodeIcon:"box",hideContainer:true,anim:"pop",animDelay:.45}),

    makeText({x:230,y:500,w:500,h:36,text:"Lorem ipsum dolor sit amet, consectetuer adipiscing elit, sed diam nonummy",size:13,weight:600,color:"#cfe0ee",align:"center",font:'"Montserrat",sans-serif',lh:1.3,anim:"fade",animDelay:.5}),
  ]};
}

/* 5 ─ Beer glass infographic (alternate accent) — same family as #3 but a
   warmer label palette, so the user has both variants as defaults. */
function T_beerInfographicAlt(){
  const tones=["#d9efe9","#bfe6da","#88cdbb","#3f9e86"];
  const row=(i,y,d)=>([
    makeShape("rect",{x:330,y:y,w:560,h:74,fill:tones[i],radius:38,anim:"right",animDelay:d}),
    makeCreativeShape("blob_01",{x:318,y:y-6,w:86,h:86,fill:"#f0faf6",anim:"pop",animDelay:d+.05}),
    makeText({x:420,y:y+12,w:300,h:28,text:"Lorem ipsum",size:22,weight:800,color:"#1f6b57",font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.1}),
    makeText({x:420,y:y+40,w:450,h:30,text:"Lorem ipsum dolor sit amet, consectetuer adipiscing elit, sed diam.",size:11,color:"#3f6356",font:'"Montserrat",sans-serif',lh:1.25,anim:"fade",animDelay:d+.12}),
  ]);
  return {bg:"#ffffff",els:[
    makeObject("beer_glass",{x:40,y:50,w:240,h:440,level:64,accent:"#f0a500",showValue:false,showLabel:false,hideContainer:true,anim:"pop",animDelay:.1}),
    ...row(0,60,.2),
    ...row(1,150,.3),
    ...row(2,240,.4),
    ...row(3,330,.5),
  ]};
}

/* 6 ─ Funnel infographic: four tapered funnel vessels filled to set
   percentages, each over a coloured caption card, on a navy field. */
function T_funnelInfographic(){
  const cols=["#f5b942","#ec4899","#22b6e6","#f0653f"];
  const pcts=[10,45,65,90];
  const xs=[60,290,520,750];
  const cell=(i,d)=>([
    makeObject("funnel_cup",{x:xs[i],y:130,w:150,h:200,level:pcts[i],accent:cols[i],numberPos:"center",showLabel:false,hideContainer:true,anim:"rise",animDelay:d}),
    makeShape("rect",{x:xs[i]-6,y:360,w:162,h:140,fill:cols[i],radius:18,anim:"fade",animDelay:d+.1}),
    makeText({x:xs[i]+8,y:374,w:138,h:120,text:'"Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do."',size:11,color:"#1b2436",font:'"Montserrat",sans-serif',lh:1.3,anim:"fade",animDelay:d+.15}),
  ]);
  return {bg:"#12233f",els:[
    makeShape("rect",{x:370,y:36,w:220,h:50,fill:"#ff5fa2",radius:14,anim:"pop"}),
    makeText({x:370,y:48,w:220,h:30,text:"INFOGRAPHIC",size:24,weight:800,color:"#ffffff",align:"center",ls:1,font:'"Montserrat",sans-serif',anim:"fade",animDelay:.1}),
    ...cell(0,.2),
    ...cell(1,.3),
    ...cell(2,.4),
    ...cell(3,.5),
  ]};
}

/* 7 ─ Fuel-gauge dashboard: three half-circle gauges with captions beneath,
   echoing the "Three Colored Fuel Gauge Dashboard" reference. */
function T_gaugeDashboard(){
  const gauge=(x,pct,d)=>([
    makeObject("gauge",{x:x,y:120,w:260,h:180,level:pct,accent:"#22c55e",showValue:true,showLabel:false,numberColor:"#1f2937",numberSize:34,anim:"pop",animDelay:d}),
    makeText({x:x+30,y:330,w:200,h:30,text:"Text Here",size:22,weight:800,color:"#1f2937",font:'"Archivo",sans-serif',anim:"fade",animDelay:d+.1}),
    makeText({x:x+30,y:366,w:200,h:120,text:"This slide is 100% editable. Adapt it to your needs and capture your audience's attention.",size:14,italic:true,color:"#6b7280",font:'"Archivo",sans-serif',lh:1.4,anim:"fade",animDelay:d+.15}),
  ]);
  return {bg:"#ffffff",els:[
    makeText({x:60,y:24,w:840,h:50,text:"Three Colored Fuel Gauge Dashboard",font:'"Archivo Expanded","Archivo",sans-serif',size:34,weight:800,color:"#1f2937",anim:"rise"}),
    ...gauge(40,85,.2),
    ...gauge(350,15,.3),
    ...gauge(660,90,.4),
    makeText({x:60,y:500,w:840,h:30,text:"This graph/chart is linked to data, and changes automatically. Edit values in the inspector.",size:13,italic:true,color:"#9ca3af",align:"center",font:'"Archivo",sans-serif',anim:"fade",animDelay:.6}),
  ]};
}

/* ── Food infographic templates (from uploaded references) ──────────── */

/* A) Balanced Diet — a pie-on-a-plate with fork & knife on a soft sage field. */
function T_balancedDiet(){
  return {bg:"#cfdcd6",els:[
    makeText({x:120,y:46,w:720,h:60,text:"BALANCED DIET",font:'"Montserrat",sans-serif',size:40,weight:600,color:"#4a7c74",align:"center",ls:4,anim:"rise"}),
    makeObject("diet_plate",{x:230,y:120,w:500,h:420,
      segments:[
        {label:"40%",sub:"fruits & vegetables",color:"#a9cf5a"},
        {label:"25%",sub:"cellulose",color:"#bfa074"},
        {label:"25%",sub:"protein",color:"#8fd0d8"},
        {label:"10%",sub:"fats",color:"#f5cd2a"}
      ],
      hideContainer:true,anim:"pop",animDelay:.15}),
  ]};
}

/* B) Healthy Food — a segmented donut with a centre title, radial food
   callout nodes, dashed connectors and category labels. */
function T_healthyFood(){
  const LINE="rgba(120,150,120,.55)";
  const hLink=(x,y,w,d)=>makeLine({x,y,w,h:2,fill:LINE,dashed:true,anim:"fade",animDelay:d});
  const vLink=(x,y,h,d)=>makeLine({x,y,w:2,h,fill:LINE,dashed:true,anim:"fade",animDelay:d});
  return {bg:"#eef2e2",els:[
    // dashed connectors from the wheel edge out toward the right-hand nodes
    hLink(615,205,120,.55), hLink(615,385,120,.58),
    makeText({x:60,y:34,w:840,h:50,text:"HEALTHY FOOD INFOGRAPHIC",font:'"Montserrat",sans-serif',size:40,weight:800,color:"#5a9e48",anim:"rise"}),
    makeText({x:60,y:84,w:840,h:36,text:"DESIGN TEMPLATE",font:'"Montserrat",sans-serif',size:24,weight:600,color:"#9bbf7e",ls:3,anim:"fade",animDelay:.1}),

    // centre wheel (reusable food_wheel object)
    makeObject("food_wheel",{x:300,y:120,w:360,h:360,centerTitle:"HEALTHY\nFOOD",centerColor:"#4c8c3f",numberColor:"#ffffff",
      segments:[
        {label:"15%",color:"#e8821e"},
        {label:"10%",color:"#f5cd2a"},
        {label:"35%",color:"#5a9e48"},
        {label:"25%",color:"#e8503a"},
        {label:"20%",color:"#5bb0cf"}
      ],
      hideContainer:true,anim:"pop",animDelay:.2}),

    // five food callout nodes around the wheel
    makeObject("info_node",{x:690,y:120,w:150,h:170,nodeIcon:"orange",nodeTitle:"FRUIT",nodeText:"Lorem ipsum dolor sit amet",hideContainer:true,anim:"pop",animDelay:.3}),
    makeObject("info_node",{x:720,y:300,w:150,h:170,nodeIcon:"bread",nodeTitle:"BREAD",nodeText:"Lorem ipsum dolor sit amet",hideContainer:true,anim:"pop",animDelay:.35}),
    makeObject("info_node",{x:380,y:430,w:150,h:170,nodeIcon:"broccoli",nodeTitle:"VEGETABLES",nodeText:"Lorem ipsum dolor sit amet",hideContainer:true,anim:"pop",animDelay:.4}),
    makeObject("info_node",{x:90,y:300,w:150,h:170,nodeIcon:"meat",nodeTitle:"MEAT",nodeText:"Lorem ipsum dolor sit amet",hideContainer:true,anim:"pop",animDelay:.45}),
    makeObject("info_node",{x:110,y:120,w:150,h:170,nodeIcon:"milk",nodeTitle:"DAIRY",nodeText:"Lorem ipsum dolor sit amet",hideContainer:true,anim:"pop",animDelay:.5}),

    makeText({x:330,y:548,w:300,h:24,text:"designed for your slides",size:13,color:"#8aa97a",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.6}),
  ]};
}

/* C) Food Infographics — a clean donut + side icon strip + caption rows,
   a lighter editorial take on the second reference. */
function T_foodInfographics(){
  return {bg:"#f7f4ee",els:[
    makeShape("rect",{x:60,y:48,w:250,h:46,fill:"#e8503a",radius:6,anim:"left"}),
    makeText({x:74,y:54,w:230,h:34,text:"FOOD",font:'"Montserrat",sans-serif',size:30,weight:800,color:"#fff",anim:"fade",animDelay:.05}),
    makeText({x:74,y:100,w:300,h:30,text:"INFOGRAPHICS",font:'"Montserrat",sans-serif',size:22,weight:700,color:"#9aa0a6",ls:2,anim:"fade",animDelay:.1}),

    makeObject("food_wheel",{x:300,y:130,w:360,h:360,centerTitle:"",centerFill:"#ffffff",numberColor:"#ffffff",
      segments:[
        {label:"30%",color:"#e8503a"},
        {label:"25%",color:"#f5a623"},
        {label:"25%",color:"#5a9e48"},
        {label:"20%",color:"#5bb0cf"}
      ],
      hideContainer:true,anim:"pop",animDelay:.2}),

    // three caption rows on the right
    makeObject("info_node",{x:690,y:140,w:120,h:140,nodeIcon:"apple",hideContainer:true,anim:"pop",animDelay:.3}),
    makeText({x:800,y:160,w:140,h:90,text:"Lorem ipsum dolor sit amet, consectetuer.",size:14,color:"#5b6166",font:'"Montserrat",sans-serif',lh:1.35,anim:"fade",animDelay:.35}),
    makeObject("info_node",{x:690,y:270,w:120,h:140,nodeIcon:"cheese",hideContainer:true,anim:"pop",animDelay:.4}),
    makeText({x:800,y:290,w:140,h:90,text:"Lorem ipsum dolor sit amet, consectetuer.",size:14,color:"#5b6166",font:'"Montserrat",sans-serif',lh:1.35,anim:"fade",animDelay:.45}),
    makeObject("info_node",{x:690,y:400,w:120,h:140,nodeIcon:"fish",hideContainer:true,anim:"pop",animDelay:.5}),
    makeText({x:800,y:420,w:140,h:90,text:"Lorem ipsum dolor sit amet, consectetuer.",size:14,color:"#5b6166",font:'"Montserrat",sans-serif',lh:1.35,anim:"fade",animDelay:.55}),

    // left icon strip
    makeObject("info_node",{x:60,y:200,w:110,h:130,nodeIcon:"orange",hideContainer:true,anim:"left",animDelay:.3}),
    makeObject("info_node",{x:60,y:330,w:110,h:130,nodeIcon:"broccoli",hideContainer:true,anim:"left",animDelay:.4}),
  ]};
}

/* ── Funnel diagram templates (from uploaded references) ────────────── */

/* A) Sales funnel target — funnel with % bands and a left-side numbered
   callout list with icons + dashed leaders (reference image 1 & 2 blend). */
function T_salesFunnel(){
  const bands=[
    {label:"95%",color:"#2f6fb0"},
    {label:"75%",color:"#1f93b0"},
    {label:"50%",color:"#1f9e8a"},
    {label:"42%",color:"#6fae3a"},
    {label:"25%",color:"#e0a81e"},
    {label:"9%", color:"#e0631e"},
  ];
  const icons=["chart","person","megaphone","search","clipboard","plane"];
  const row=(i,y,d)=>([
    makeObject("info_node",{x:36,y:y,w:80,h:80,nodeIcon:icons[i],hideContainer:true,anim:"left",animDelay:d}),
    makeText({x:120,y:y+8,w:120,h:22,text:"TITLE 0"+(6-i),size:14,weight:800,color:"#3a5a8a",font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.05}),
    makeText({x:120,y:y+30,w:200,h:48,text:"Lorem ipsum dolor sit amet, consectetuer elit.",size:10,color:"#7a838c",font:'"Montserrat",sans-serif',lh:1.25,anim:"fade",animDelay:d+.08}),
  ]);
  return {bg:"#ffffff",els:[
    makeText({x:60,y:34,w:840,h:44,text:"SALES FUNNEL TARGET",font:'"Montserrat",sans-serif',size:36,weight:800,color:"#2a2a2a",anim:"rise"}),
    makeText({x:60,y:78,w:840,h:34,text:"DIAGRAM TEMPLATE",font:'"Montserrat",sans-serif',size:24,weight:700,color:"#9aa0a6",ls:1,anim:"fade",animDelay:.1}),
    makeObject("funnel_stack",{x:470,y:96,w:430,h:430,funnel3d:true,funnelTip:false,funnelGap:6,numberColor:"#ffffff",
      bands,anim:"pop",animDelay:.2}),
    ...row(0,110,.3), ...row(1,168,.34), ...row(2,226,.38),
    ...row(3,284,.42), ...row(4,342,.46), ...row(5,400,.5),
  ]};
}

/* B) 5-level stacked funnel — bold inverted stack with right-side icon
   callouts (reference image 2 / 4). */
function T_stackedFunnel5(){
  const bands=[
    {label:"01",color:"#2f2f8c"},
    {label:"02",color:"#1f9e8a"},
    {label:"03",color:"#cf2230"},
    {label:"04",color:"#c8801a"},
    {label:"05",color:"#138a4e"},
  ];
  const cols=["#4a4ab0","#1f9e8a","#cf2230","#c8801a","#138a4e"];
  const icons=["clipboard","megaphone","plane","person","handshake"];
  const cap=(i,y,d)=>([
    makeObject("info_node",{x:690,y:y,w:80,h:80,nodeIcon:icons[i],hideContainer:true,anim:"pop",animDelay:d}),
    makeText({x:790,y:y+8,w:160,h:24,text:"Add Your Text Here",size:16,weight:800,color:cols[i],font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.05}),
    makeText({x:790,y:y+34,w:160,h:48,text:"Lorem ipsum dolor sit amet consectetuer adipiscing elit.",size:11,color:"#6b7077",font:'"Montserrat",sans-serif',lh:1.3,anim:"fade",animDelay:d+.08}),
  ]);
  return {bg:"#f7f7f7",els:[
    makeText({x:60,y:40,w:840,h:54,text:"5 Level Stacked Funnel Template",font:'"Montserrat",sans-serif',size:40,weight:800,color:"#3a3a3a",align:"center",anim:"rise"}),
    makeObject("funnel_stack",{x:120,y:130,w:520,h:400,funnel3d:true,funnelGap:10,numberColor:"#ffffff",
      bands,anim:"pop",animDelay:.2}),
    ...cap(0,150,.3), ...cap(1,230,.35), ...cap(2,310,.4),
    ...cap(3,388,.45), ...cap(4,452,.5),
  ]};
}

/* C) Funnel infographic — stepped pyramid with numbered circles list on the
   right (reference image 3). */
function T_funnelSteps(){
  const cols=["#1f9e8a","#8cbf4a","#e0a81e","#cf3a2e","#3a5a8a"];
  const bands=[
    {label:"STEP 01",color:"#1f9e8a"},
    {label:"STEP 02",color:"#8cbf4a"},
    {label:"STEP 03",color:"#e0a81e"},
    {label:"STEP 04",color:"#cf3a2e"},
    {label:"STEP 05",color:"#3a5a8a"},
  ];
  const item=(i,y,d)=>([
    makeCreativeShape("blob_01",{x:560,y:y,w:40,h:40,fill:cols[i],anim:"pop",animDelay:d}),
    makeText({x:560,y:y+6,w:40,h:28,text:String(i+1),size:20,weight:800,color:"#fff",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.03}),
    makeText({x:616,y:y+2,w:300,h:24,text:"YOUR TITLE HERE",size:16,weight:800,color:cols[i],font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.05}),
    makeText({x:616,y:y+26,w:320,h:30,text:"There are many variations of passages of lorem ipsum available.",size:11,color:"#7a838c",font:'"Montserrat",sans-serif',lh:1.3,anim:"fade",animDelay:d+.08}),
  ]);
  return {bg:"#ffffff",els:[
    makeText({x:300,y:30,w:520,h:30,text:"Enter your subhead line here",size:16,color:"#aab0b6",align:"center",font:'"Montserrat",sans-serif',anim:"fade"}),
    makeText({x:300,y:58,w:520,h:48,text:"Funnel Infographic",font:'"Montserrat",sans-serif',size:34,weight:600,color:"#4a565b",align:"center",anim:"rise",animDelay:.05}),
    makeObject("funnel_stack",{x:60,y:120,w:440,h:400,funnelTip:false,funnelGap:4,numberColor:"#ffffff",
      bands,anim:"pop",animDelay:.2}),
    ...item(0,150,.3), ...item(1,224,.35), ...item(2,298,.4),
    ...item(3,372,.45), ...item(4,446,.5),
  ]};
}

/* D) Funnel diagram (two-sided) — centred inverted stack with a paragraph on
   each side (reference image 6). */
function T_funnelTwoSided(){
  const bands=[
    {label:"SAMPLE TEXT",color:"#2f7fb0"},
    {label:"SAMPLE TEXT",color:"#1f9e8a"},
    {label:"SAMPLE TEXT",color:"#6fae3a"},
    {label:"SAMPLE TEXT",color:"#e0a81e"},
    {label:"$",color:"#cf3a2e"},
  ];
  return {bg:"#ffffff",els:[
    makeText({x:60,y:36,w:840,h:48,text:"FUNNEL DIAGRAM",font:'"Montserrat",sans-serif',size:36,weight:800,color:"#3a3a3a",align:"center",ls:1,anim:"rise"}),
    makeObject("funnel_stack",{x:300,y:110,w:360,h:420,funnelGap:6,numberColor:"#ffffff",
      bands,anim:"pop",animDelay:.2}),
    makeText({x:60,y:300,w:200,h:28,text:"LOREM IPSUM",size:18,weight:800,color:"#3a3a3a",font:'"Montserrat",sans-serif',anim:"left",animDelay:.3}),
    makeText({x:60,y:330,w:210,h:150,text:"Lorem ipsum is simply dummy text of the printing and typesetting industry. Lorem ipsum has been the industry's standard dummy text ever since the 1500s.",size:12,color:"#6b7077",font:'"Montserrat",sans-serif',lh:1.45,anim:"fade",animDelay:.35}),
    makeText({x:700,y:300,w:200,h:28,text:"LOREM IPSUM",size:18,weight:800,color:"#3a3a3a",font:'"Montserrat",sans-serif',anim:"right",animDelay:.3}),
    makeText({x:700,y:330,w:210,h:150,text:"Lorem ipsum is simply dummy text of the printing and typesetting industry. Lorem ipsum has been the industry's standard dummy text ever since the 1500s.",size:12,color:"#6b7077",font:'"Montserrat",sans-serif',lh:1.45,anim:"fade",animDelay:.35}),
  ]};
}

/* E) Funnel diagrams — inverted pyramid with icons + callouts on both sides
   (reference image 4). */
function T_funnelIconsBothSides(){
  const bands=[
    {label:"",color:"#f5a623"},
    {label:"",color:"#e8503a"},
    {label:"",color:"#a8328c"},
    {label:"",color:"#3a2f6f"},
    {label:"",color:"#2aa0e0"},
    {label:"",color:"#8cbf2a"},
  ];
  const icons=["bulb","dollar","diamond","briefcase","clock","chart"];
  const leftCap=(y,c,d)=>([
    makeText({x:90,y:y,w:260,h:24,text:"Title Goes Here",size:18,weight:800,color:c,font:'"Montserrat",sans-serif',anim:"left",animDelay:d}),
    makeText({x:90,y:y+26,w:260,h:80,text:"Lorem Ipsum is simply dummy text of the printing and typesetting industry.",size:12,color:"#7a838c",font:'"Montserrat",sans-serif',lh:1.4,anim:"fade",animDelay:d+.05}),
  ]);
  const rightCap=(y,c,d)=>([
    makeText({x:680,y:y,w:240,h:24,text:"Title Goes Here",size:18,weight:800,color:c,font:'"Montserrat",sans-serif',align:"right",anim:"right",animDelay:d}),
    makeText({x:660,y:y+26,w:260,h:80,text:"Lorem Ipsum is simply dummy text of the printing and typesetting industry.",size:12,color:"#7a838c",align:"right",font:'"Montserrat",sans-serif',lh:1.4,anim:"fade",animDelay:d+.05}),
  ]);
  // icons sit centred on each band
  const ico=(i,y,d)=>makeObject("info_node",{x:430,y:y,w:64,h:64,nodeIcon:icons[i],hideContainer:true,anim:"pop",animDelay:d});
  return {bg:"#ffffff",els:[
    makeText({x:60,y:36,w:840,h:52,text:"Funnel Diagrams",font:'"Montserrat",sans-serif',size:46,weight:700,color:"#6b7077",align:"center",anim:"rise"}),
    makeText({x:60,y:92,w:840,h:30,text:"Type The Subtitle Of Your Great Here",size:16,color:"#aab0b6",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.1}),
    makeObject("funnel_stack",{x:300,y:130,w:360,h:400,funnelGap:7,bands,anim:"pop",animDelay:.2}),
    ico(0,150,.3), ico(1,212,.34), ico(2,274,.38), ico(3,336,.42), ico(4,398,.46), ico(5,452,.5),
    ...leftCap(150,"#f5a623",.3), ...leftCap(300,"#a8328c",.4), ...leftCap(440,"#2aa0e0",.5),
    ...rightCap(225,"#e8503a",.35), ...rightCap(370,"#3a2f6f",.45), ...rightCap(470,"#8cbf2a",.55),
  ]};
}

/* ── Funnel / stat / arrow templates (uploaded references batch) ─────── */

/* 1 — Funnel with alternating side captions (reference image 1). */
function T_funnelCaptions(){
  const bands=[
    {label:"Text Here",color:"#2f7f86"},
    {label:"Text Here",color:"#9a8467"},
    {label:"Text Here",color:"#ef5b3f"},
    {label:"Text Here",color:"#4a4f57"},
  ];
  const cap="This slide is 100% editable. Adapt it to your needs and capture your audience's attention.";
  return {bg:"#ffffff",els:[
    makeText({x:60,y:24,w:840,h:54,text:"Funnel",font:'"Montserrat",sans-serif',size:40,weight:600,color:"#3a3a3a",align:"center",anim:"rise"}),
    makeObject("funnel_stack",{x:280,y:100,w:400,h:430,funnelGap:14,funnelTip:false,numberColor:"#ffffff",
      bands,anim:"pop",animDelay:.2}),
    makeText({x:660,y:160,w:250,h:90,text:cap,size:13,color:"#7a838c",font:'"Montserrat",sans-serif',lh:1.4,anim:"fade",animDelay:.3}),
    makeText({x:40,y:300,w:250,h:90,text:cap,size:13,color:"#7a838c",align:"right",font:'"Montserrat",sans-serif',lh:1.4,anim:"fade",animDelay:.4}),
    makeText({x:580,y:420,w:280,h:90,text:cap,size:13,color:"#7a838c",font:'"Montserrat",sans-serif',lh:1.4,anim:"fade",animDelay:.45}),
    makeText({x:80,y:520,w:260,h:60,text:cap,size:13,color:"#7a838c",align:"right",font:'"Montserrat",sans-serif',lh:1.4,anim:"fade",animDelay:.5}),
    makeText({x:40,y:512,w:200,h:24,text:"WWW.COMPANY.COM",size:13,weight:700,color:"#6b7077",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.6}),
  ]};
}

/* 2 — Percentage row of taps/icons with % + title + text (reference 2). */
function T_percentTaps(){
  const data=[
    {pct:20,c:"#34465c",t:"Title - 1"},
    {pct:30,c:"#d2691e",t:"Title - 2"},
    {pct:40,c:"#9aa0a6",t:"Title - 3"},
    {pct:50,c:"#e0a81e",t:"Title - 4"},
    {pct:10,c:"#3a7fc4",t:"Title - 5"},
  ];
  const xs=[40,230,420,610,800];
  const cell=(i,d)=>{
    const o=data[i];
    return [
      makeObject("info_node",{x:xs[i],y:170,w:120,h:130,nodeIcon:"tap",nodeTextColor:o.c,nodeShowTitle:false,nodeShowText:false,hideContainer:true,accent:o.c,anim:"pop",animDelay:d}),
      makeText({x:xs[i],y:300,w:120,h:40,text:o.pct+"%",size:34,weight:800,color:o.c,align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.05}),
      makeText({x:xs[i],y:344,w:120,h:24,text:o.t,size:15,weight:700,color:"#3a3a3a",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.08}),
      makeText({x:xs[i],y:368,w:120,h:24,text:"Enter your text here.",size:10,color:"#9aa0a6",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.1}),
    ];
  };
  return {bg:"#ffffff",els:[
    makeText({x:60,y:34,w:840,h:24,text:"YOUR TEXT HERE",size:14,weight:600,color:"#9aa0a6",align:"center",ls:3,font:'"Montserrat",sans-serif',anim:"fade"}),
    makeText({x:60,y:58,w:840,h:40,text:"Percentage Template And Presentation",font:'"Montserrat",sans-serif',size:30,weight:800,color:"#2a2a2a",align:"center",anim:"rise",animDelay:.05}),
    ...cell(0,.2),...cell(1,.26),...cell(2,.32),...cell(3,.38),...cell(4,.44),
  ]};
}

/* 3 — Row of percent rings with banner captions (reference 3). */
function T_percentRings(){
  const data=[{p:67,c:"#2f7fc4"},{p:43,c:"#1f9e8a"},{p:78,c:"#6fae3a"},{p:55,c:"#e0a81e"},{p:90,c:"#e0392e"}];
  const xs=[40,230,420,610,800];
  const cell=(i,d)=>{
    const o=data[i];
    return [
      makeObject("percent_ring",{x:xs[i]+18,y:120,w:84,h:84,level:o.p,accent:o.c,numberMode:"countup",anim:"pop",animDelay:d}),
      makeText({x:xs[i],y:212,w:120,h:24,text:"Contents Here",size:13,weight:700,color:"#3a3a3a",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.05}),
      makeShape("rect",{x:xs[i]+10,y:248,w:100,h:120,fill:o.c,radius:4,anim:"rise",animDelay:d+.08}),
      makeText({x:xs[i]+16,y:258,w:88,h:110,text:"Get a modern presentation that is beautifully designed.",size:9,color:"#ffffff",align:"center",font:'"Montserrat",sans-serif',lh:1.3,anim:"fade",animDelay:d+.12}),
    ];
  };
  return {bg:"#ffffff",els:[
    makeText({x:60,y:30,w:840,h:46,text:"Percent Rings",font:'"Montserrat",sans-serif',size:38,weight:800,color:"#4a4f57",align:"center",anim:"rise"}),
    makeText({x:60,y:78,w:840,h:24,text:"A row of editable circular progress rings",size:14,color:"#9aa0a6",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.1}),
    ...cell(0,.2),...cell(1,.26),...cell(2,.32),...cell(3,.38),...cell(4,.44),
  ]};
}

/* 4 — Numbered content cards + horizontal % bars with icons (reference 4). */
function T_numberedBars(){
  const data=[
    {n:"01",c:"#e8941e",p:50,icon:"search"},
    {n:"02",c:"#6fae3a",p:60,icon:"chart"},
    {n:"03",c:"#1f9e8a",p:85,icon:"diamond"},
    {n:"04",c:"#2f8fc4",p:70,icon:"bulb"},
  ];
  const row=(i,y,d)=>{
    const o=data[i];
    return [
      makeText({x:40,y:y+6,w:230,h:60,text:"Get a modern presentation that is beautifully designed. Easy to change colors.",size:11,color:"#6b7077",align:"right",font:'"Montserrat",sans-serif',lh:1.35,anim:"fade",animDelay:d+.1}),
      makeObject("stat_item",{x:300,y:y,w:150,h:74,statNumber:o.n,statTitle:"Contents",statShowText:false,statStyle:"solid",accent:o.c,anim:"left",animDelay:d}),
      makeShape("rect",{x:470,y:y+14,w:Math.round(360*o.p/100),h:46,fill:o.c,radius:4,anim:"left",animDelay:d+.05}),
      makeText({x:482,y:y+22,w:120,h:30,text:o.p+"%",size:22,weight:800,color:"#fff",font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.12}),
      makeObject("info_node",{x:840,y:y+2,w:70,h:70,nodeIcon:o.icon,nodeShowTitle:false,nodeShowText:false,hideContainer:true,accent:o.c,anim:"pop",animDelay:d+.1}),
    ];
  };
  return {bg:"#ffffff",els:[
    makeText({x:60,y:34,w:840,h:52,text:"Numbered Bars",font:'"Montserrat",sans-serif',size:42,weight:800,color:"#4a4f57",align:"center",anim:"rise"}),
    ...row(0,140,.2),...row(1,228,.28),...row(2,316,.36),...row(3,404,.44),
  ]};
}

/* 5 — Two opposing arrows with content (reference 5). */
function T_twoArrows(){
  const para="You can simply impress your audience and add a unique zing and appeal to your Presentations.";
  return {bg:"#ffffff",els:[
    makeText({x:60,y:30,w:840,h:46,text:"Two Arrows",font:'"Montserrat",sans-serif',size:40,weight:800,color:"#4a4f57",align:"center",anim:"rise"}),
    makeText({x:240,y:96,w:480,h:48,text:"You can simply impress your audience and add a unique zing and appeal to your Presentations.",size:14,weight:700,color:"#3a3a3a",align:"center",font:'"Montserrat",sans-serif',lh:1.3,anim:"fade",animDelay:.1}),
    // right-pointing arrow (top)
    makeCreativeShape("arrow_right",{x:430,y:200,w:300,h:80,fill:"#2f8fc4",anim:"right",animDelay:.2}),
    makeObject("info_node",{x:440,y:206,w:64,h:64,nodeIcon:"chat",nodeShowTitle:false,nodeShowText:false,hideContainer:true,anim:"pop",animDelay:.3}),
    makeText({x:510,y:228,w:200,h:24,text:"Contents Title",size:15,weight:800,color:"#fff",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.3}),
    // left-pointing arrow (bottom)
    makeCreativeShape("arrow_left",{x:330,y:400,w:300,h:80,fill:"#e8941e",anim:"left",animDelay:.25}),
    makeText({x:400,y:428,w:200,h:24,text:"Contents Title",size:15,weight:800,color:"#fff",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.35}),
    // left text block
    makeShape("rect",{x:90,y:206,w:220,h:36,fill:"#e8941e",radius:18,anim:"left",animDelay:.2}),
    makeText({x:90,y:214,w:220,h:24,text:"Contents Title",size:15,weight:800,color:"#fff",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.25}),
    makeText({x:90,y:260,w:230,h:120,text:para+"\n\n"+para,size:11,color:"#6b7077",font:'"Montserrat",sans-serif',lh:1.4,anim:"fade",animDelay:.3}),
    // right text block
    makeShape("rect",{x:700,y:330,w:220,h:36,fill:"#2f8fc4",radius:18,anim:"right",animDelay:.25}),
    makeText({x:700,y:338,w:220,h:24,text:"Contents Title",size:15,weight:800,color:"#fff",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.3}),
    makeText({x:700,y:384,w:230,h:120,text:para+"\n\n"+para,size:11,color:"#6b7077",font:'"Montserrat",sans-serif',lh:1.4,anim:"fade",animDelay:.35}),
  ]};
}

/* 6 — Big opposing CONTENTS arrows with corner callouts (reference 6). */
function T_bigArrows(){
  const blurb="Get a modern presentation that is beautifully designed. Easy to change colors, photos and text.";
  return {bg:"#ffffff",els:[
    makeText({x:60,y:30,w:840,h:46,text:"Big Arrows",font:'"Montserrat",sans-serif',size:40,weight:800,color:"#9aa0a6",align:"center",anim:"rise"}),
    makeCreativeShape("arrow_left",{x:60,y:250,w:380,h:90,fill:"#2f8fc4",anim:"left",animDelay:.2}),
    makeText({x:150,y:278,w:240,h:40,text:"CONTENTS",size:26,weight:800,color:"#fff",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.3}),
    makeCreativeShape("arrow_right",{x:520,y:330,w:380,h:90,fill:"#e8941e",anim:"right",animDelay:.25}),
    makeText({x:560,y:358,w:240,h:40,text:"CONTENTS",size:26,weight:800,color:"#fff",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.35}),
    makeObject("info_node",{x:430,y:150,w:64,h:64,nodeIcon:"plane",nodeShowTitle:false,nodeShowText:false,hideContainer:true,anim:"pop",animDelay:.3}),
    makeObject("info_node",{x:470,y:430,w:64,h:64,nodeIcon:"chart",nodeShowTitle:false,nodeShowText:false,hideContainer:true,accent:"#e8941e",anim:"pop",animDelay:.4}),
    makeText({x:150,y:150,w:200,h:24,text:"Add Contents Title",size:14,weight:800,color:"#2f8fc4",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.3}),
    makeText({x:150,y:176,w:220,h:70,text:blurb,size:11,color:"#6b7077",font:'"Montserrat",sans-serif',lh:1.35,anim:"fade",animDelay:.35}),
    makeText({x:600,y:440,w:200,h:24,text:"Add Contents Title",size:14,weight:800,color:"#e8941e",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.4}),
    makeText({x:600,y:466,w:240,h:70,text:blurb,size:11,color:"#6b7077",font:'"Montserrat",sans-serif',lh:1.35,anim:"fade",animDelay:.45}),
  ]};
}

/* 7 — Big-number callout list with icon tabs (reference 7). */
function T_numberCallouts(){
  const data=[
    {n:"01",c:"#2f6f86",icon:"chat",side:"left",y:130},
    {n:"02",c:"#1f9e8a",icon:"clipboard",side:"right",y:225},
    {n:"03",c:"#e0a81e",icon:"box",side:"left",y:320},
    {n:"04",c:"#d83a3a",icon:"plane",side:"right",y:415},
  ];
  const item=(o,d)=>{
    if(o.side==="left"){
      return [
        makeText({x:50,y:o.y+6,w:90,h:60,text:o.n,size:48,weight:800,color:o.c,font:'"Montserrat",sans-serif',anim:"fade",animDelay:d}),
        makeText({x:170,y:o.y,w:230,h:22,text:"Title Goes Here",size:16,weight:800,color:"#3a3a3a",align:"right",font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.05}),
        makeText({x:170,y:o.y+24,w:230,h:40,text:"There are many variations of passages of Lorem Ipsum available",size:11,color:"#9aa0a6",align:"right",font:'"Montserrat",sans-serif',lh:1.3,anim:"fade",animDelay:d+.08}),
        makeObject("info_node",{x:430,y:o.y,w:74,h:74,nodeIcon:o.icon,nodeShowTitle:false,nodeShowText:false,hideContainer:true,accent:o.c,anim:"pop",animDelay:d+.1}),
      ];
    }
    return [
      makeObject("info_node",{x:430,y:o.y,w:74,h:74,nodeIcon:o.icon,nodeShowTitle:false,nodeShowText:false,hideContainer:true,accent:o.c,anim:"pop",animDelay:d}),
      makeText({x:540,y:o.y,w:240,h:22,text:"Title Goes Here",size:16,weight:800,color:"#3a3a3a",font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.05}),
      makeText({x:540,y:o.y+24,w:250,h:40,text:"There are many variations of passages of Lorem Ipsum available",size:11,color:"#9aa0a6",font:'"Montserrat",sans-serif',lh:1.3,anim:"fade",animDelay:d+.08}),
      makeText({x:820,y:o.y+6,w:90,h:60,text:o.n,size:48,weight:800,color:o.c,font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.1}),
    ];
  };
  return {bg:"#ffffff",els:[
    makeText({x:60,y:28,w:840,h:46,text:"Great Template",font:'"Montserrat",sans-serif',size:40,weight:800,color:"#4a4f57",anim:"rise"}),
    makeText({x:62,y:80,w:600,h:24,text:"ADD YOUR SUBTITLE HERE",size:15,weight:700,color:"#9aa0a6",ls:2,font:'"Montserrat",sans-serif',anim:"fade",animDelay:.1}),
    ...item(data[0],.2),...item(data[1],.28),...item(data[2],.36),...item(data[3],.44),
  ]};
}

/* 8 — Grid of rounded number pills (reference 8). */
function T_pillGrid(){
  const data=[
    {n:"01",c:"#2f8fc4"},{n:"02",c:"#5b6a78"},
    {n:"03",c:"#1f9e8a"},{n:"04",c:"#6fae3a"},
    {n:"05",c:"#e0392e"},{n:"06",c:"#e0941e"},
  ];
  const cells=[];
  data.forEach((o,i)=>{
    const col=i%2, rowi=Math.floor(i/2);
    const x=60+col*440, y=130+rowi*130;
    cells.push(makeObject("stat_item",{x,y,w:400,h:96,statNumber:o.n,statTitle:"Contents Title",
      statText:"Get a modern presentation that is beautifully designed. Easy to change colors and text.",
      accent:o.c,statStyle:"solid",anim:(col===0?"left":"right"),animDelay:.2+i*.06}));
  });
  return {bg:"#ffffff",els:[
    makeText({x:60,y:30,w:840,h:44,text:"Contents Pills",font:'"Montserrat",sans-serif',size:36,weight:800,color:"#4a4f57",align:"center",anim:"rise"}),
    makeText({x:60,y:76,w:840,h:24,text:"Six editable rounded number pills",size:14,color:"#9aa0a6",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.1}),
    ...cells,
  ]};
}

/* ── Pie / radial templates (uploaded references batch) ─────────────── */

/* 1 — Four teardrop number badges pinwheeling around centre, with side
   captions + corner icons (reference image 1). */
function T_pinwheelBadges(){
  const blurb="Get a modern PowerPoint Presentation that is beautifully designed. Easy to change colors.";
  return {bg:"#ffffff",els:[
    makeText({x:60,y:24,w:840,h:54,text:"Free Templates",font:'"Montserrat",sans-serif',size:44,weight:800,color:"#4a4f57",align:"center",anim:"rise"}),
    makeText({x:60,y:84,w:840,h:30,text:"You can download professional diagrams for free",size:18,color:"#9aa0a6",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.1}),
    // centre pinwheel of four teardrops
    makeObject("teardrop_badge",{x:494,y:272,w:140,h:140,dropNumber:"01",dropCorner:"br",accent:"#2f8fc4",hideContainer:true,anim:"pop",animDelay:.2}),
    makeObject("teardrop_badge",{x:646,y:272,w:140,h:140,dropNumber:"02",dropCorner:"bl",accent:"#1f9e8a",hideContainer:true,anim:"pop",animDelay:.26}),
    makeObject("teardrop_badge",{x:494,y:420,w:140,h:140,dropNumber:"03",dropCorner:"tr",accent:"#e0a81e",hideContainer:true,anim:"pop",animDelay:.32}),
    makeObject("teardrop_badge",{x:646,y:420,w:140,h:140,dropNumber:"04",dropCorner:"tl",accent:"#8cbf2a",hideContainer:true,anim:"pop",animDelay:.38}),
    // left captions + icons
    makeObject("info_node",{x:70,y:212,w:90,h:90,nodeIcon:"chart",nodeShowTitle:false,nodeShowText:false,hideContainer:true,accent:"#2f8fc4",anim:"left",animDelay:.3}),
    makeText({x:180,y:228,w:210,h:24,text:"Content Here",size:18,weight:800,color:"#2f8fc4",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.32}),
    makeText({x:180,y:258,w:210,h:80,text:blurb,size:12,color:"#6b7077",font:'"Montserrat",sans-serif',lh:1.35,anim:"fade",animDelay:.35}),
    makeObject("info_node",{x:70,y:470,w:90,h:90,nodeIcon:"chart",nodeShowTitle:false,nodeShowText:false,hideContainer:true,accent:"#e0a81e",anim:"left",animDelay:.4}),
    makeText({x:180,y:486,w:210,h:24,text:"Content Here",size:18,weight:800,color:"#e0a81e",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.42}),
    makeText({x:180,y:516,w:210,h:80,text:blurb,size:12,color:"#6b7077",font:'"Montserrat",sans-serif',lh:1.35,anim:"fade",animDelay:.45}),
    // right captions + icons
    makeObject("info_node",{x:830,y:212,w:90,h:90,nodeIcon:"plane",nodeShowTitle:false,nodeShowText:false,hideContainer:true,accent:"#1f9e8a",anim:"right",animDelay:.3}),
    makeText({x:700,y:228,w:120,h:24,text:"Content Here",size:18,weight:800,color:"#1f9e8a",align:"right",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.32}),
    makeText({x:680,y:258,w:210,h:80,text:blurb,size:12,color:"#6b7077",align:"right",font:'"Montserrat",sans-serif',lh:1.35,anim:"fade",animDelay:.35}),
    makeObject("info_node",{x:830,y:470,w:90,h:90,nodeIcon:"megaphone",nodeShowTitle:false,nodeShowText:false,hideContainer:true,accent:"#8cbf2a",anim:"right",animDelay:.4}),
    makeText({x:700,y:486,w:120,h:24,text:"Content Here",size:18,weight:800,color:"#8cbf2a",align:"right",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.42}),
    makeText({x:680,y:516,w:210,h:80,text:blurb,size:12,color:"#6b7077",align:"right",font:'"Montserrat",sans-serif',lh:1.35,anim:"fade",animDelay:.45}),
  ]};
}

/* 2 — Row of four single-value pie charts + captions + legend (reference 2). */
function T_pieRow(){
  const data=[{p:55,c:"#2f7fc4"},{p:40,c:"#1f9e8a"},{p:35,c:"#8cbf2a"},{p:70,c:"#e0a81e"}];
  const xs=[60,290,520,750];
  const cell=(i,d)=>{
    const o=data[i];
    return [
      makeObject("pie_percent",{x:xs[i]+25,y:120,w:130,h:130,level:o.p,accent:o.c,anim:"pop",animDelay:d}),
      makeText({x:xs[i],y:270,w:180,h:24,text:"Add Text",size:16,weight:800,color:"#3a3a3a",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.05}),
      makeText({x:xs[i]+10,y:298,w:160,h:70,text:"Get a modern PowerPoint Presentation that is beautifully designed.",size:11,color:"#6b7077",align:"center",font:'"Montserrat",sans-serif',lh:1.3,anim:"fade",animDelay:d+.08}),
    ];
  };
  return {bg:"#ffffff",els:[
    makeText({x:60,y:30,w:840,h:44,text:"Pie Charts",font:'"Montserrat",sans-serif',size:38,weight:800,color:"#4a4f57",align:"center",anim:"rise"}),
    ...cell(0,.2),...cell(1,.26),...cell(2,.32),...cell(3,.38),
    makeText({x:60,y:420,w:840,h:24,text:"Contents Here",size:14,weight:700,color:"#3a3a3a",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.5}),
    makeText({x:120,y:448,w:720,h:60,text:"Get a modern PowerPoint Presentation that is beautifully designed. I hope and I believe that this Template will your Time, Money and Reputation. Easy to change colors, photos and Text.",size:11,color:"#9aa0a6",align:"center",font:'"Montserrat",sans-serif',lh:1.4,anim:"fade",animDelay:.55}),
  ]};
}

/* 3 — Multi-segment donut with right-side % callouts + icons (reference 3). */
function T_donutCallouts(){
  const para="You can simply impress your audience and add a unique zing and appeal to your Presentations.";
  return {bg:"#ffffff",els:[
    makeText({x:60,y:28,w:840,h:44,text:"Donut Callouts",font:'"Montserrat",sans-serif',size:38,weight:800,color:"#4a4f57",align:"center",anim:"rise"}),
    makeObject("food_wheel",{x:70,y:120,w:320,h:320,centerTitle:"",centerFill:"#ffffff",numberColor:"#ffffff",
      segments:[
        {label:"40%",color:"#cf2e2e",value:40},
        {label:"10%",color:"#e0a81e",value:10},
        {label:"20%",color:"#2f8f7f",value:20},
        {label:"30%",color:"#2f7fc4",value:30}
      ],anim:"pop",animDelay:.2}),
    // three callouts on the right
    ...[["85%","#cf2e2e","chat",150],["70%","#e0a81e","search",270],["65%","#2f8f7f","clock",390]].flatMap(([pct,c,icon,y],k)=>([
      makeObject("info_node",{x:430,y:y,w:60,h:60,nodeIcon:icon,nodeShowTitle:false,nodeShowText:false,hideContainer:true,accent:c,anim:"pop",animDelay:.3+k*.06}),
      makeText({x:510,y:y+8,w:90,h:40,text:pct,size:26,weight:800,color:c,font:'"Montserrat",sans-serif',anim:"fade",animDelay:.32+k*.06}),
      makeText({x:600,y:y+4,w:160,h:40,text:"Simple PowerPoint Presentation",size:12,weight:600,color:"#3a3a3a",font:'"Montserrat",sans-serif',lh:1.25,anim:"fade",animDelay:.34+k*.06}),
      makeText({x:770,y:y,w:160,h:70,text:para,size:10,color:"#9aa0a6",font:'"Montserrat",sans-serif',lh:1.3,anim:"fade",animDelay:.36+k*.06}),
    ])),
  ]};
}

/* 4 — Concentric radial bars + value labels + caption list (reference 4). */
function T_radialList(){
  const data=[{p:85,c:"#3a7fc4"},{p:75,c:"#6fae3a"},{p:65,c:"#e0a81e"},{p:55,c:"#e0633a"}];
  return {bg:"#ffffff",els:[
    makeText({x:60,y:30,w:840,h:42,text:"Radial Bars",font:'"Montserrat",sans-serif',size:36,weight:800,color:"#4a4f57",align:"center",anim:"rise"}),
    makeObject("radial_bars",{x:70,y:130,w:300,h:300,segments:data.map(o=>({label:o.p+"%",color:o.c,value:o.p})),anim:"pop",animDelay:.2}),
    // value labels to the right of the rings
    ...data.flatMap((o,k)=>([
      makeText({x:400,y:150+k*40,w:90,h:24,text:o.p+"%",size:16,weight:800,color:o.c,font:'"Montserrat",sans-serif',anim:"fade",animDelay:.3+k*.05}),
    ])),
    makeText({x:520,y:140,w:200,h:28,text:"Add Contents Here",size:18,weight:800,color:"#2f8fc4",font:'"Montserrat",sans-serif',anim:"fade",animDelay:.4}),
    makeText({x:520,y:172,w:380,h:80,text:"You can simply impress your audience and add a unique zing and appeal to your Presentations. Get a modern PowerPoint Presentation that is beautifully designed.",size:12,color:"#6b7077",font:'"Montserrat",sans-serif',lh:1.4,anim:"fade",animDelay:.45}),
    ...data.flatMap((o,k)=>([
      makeCreativeShape("blob_01",{x:520,y:280+k*55,w:16,h:16,fill:o.c,anim:"pop",animDelay:.5+k*.05}),
      makeText({x:548,y:278+k*55,w:380,h:40,text:"You can simply impress your audience and add a unique zing and appeal to your Presentations.",size:11,color:"#6b7077",font:'"Montserrat",sans-serif',lh:1.3,anim:"fade",animDelay:.52+k*.05}),
    ])),
  ]};
}

/* 5 — Row of pie charts with icon below + caption (reference 5). */
function T_pieIconRow(){
  const data=[{p:60,c:"#e0a81e",icon:"briefcase"},{p:35,c:"#1f9e8a",icon:"chat"},{p:50,c:"#cf2e7a",icon:"briefcase"},{p:30,c:"#7a3aa8",icon:"person"}];
  const xs=[60,290,520,750];
  const cell=(i,d)=>{
    const o=data[i];
    return [
      makeText({x:xs[i],y:120,w:180,h:24,text:"Contents Here",size:16,weight:800,color:o.c,align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:d}),
      makeObject("pie_percent",{x:xs[i]+35,y:150,w:110,h:110,level:o.p,accent:o.c,anim:"pop",animDelay:d+.05}),
      makeObject("info_node",{x:xs[i]+55,y:270,w:64,h:64,nodeIcon:o.icon,nodeShowTitle:false,nodeShowText:false,hideContainer:true,accent:o.c,anim:"pop",animDelay:d+.1}),
      makeText({x:xs[i],y:340,w:180,h:24,text:"Add Text",size:15,weight:700,color:"#3a3a3a",align:"center",font:'"Montserrat",sans-serif',anim:"fade",animDelay:d+.12}),
      makeText({x:xs[i]+10,y:366,w:160,h:60,text:"Get a modern PowerPoint Presentation that is beautifully designed.",size:11,color:"#9aa0a6",align:"center",font:'"Montserrat",sans-serif',lh:1.3,anim:"fade",animDelay:d+.15}),
    ];
  };
  return {bg:"#ffffff",els:[
    makeText({x:60,y:34,w:840,h:44,text:"Pie + Icons",font:'"Montserrat",sans-serif',size:36,weight:800,color:"#4a4f57",align:"center",anim:"rise"}),
    ...cell(0,.2),...cell(1,.26),...cell(2,.32),...cell(3,.38),
  ]};
}

const BASE_TEMPLATES = [
  {name:"Infographic · Animal bars",   build:T_animalsBars},
  {name:"Infographic · Our Profit",    build:T_ourProfit},
  {name:"Infographic · Beer (blue)",   build:T_beerInfographic},
  {name:"Infographic · Coffee cup",    build:T_coffeeInfographic},
  {name:"Infographic · Balanced diet", build:T_balancedDiet},
  {name:"Infographic · Healthy food",  build:T_healthyFood},
  {name:"Infographic · Food (donut)",  build:T_foodInfographics},
  {name:"Funnel · Sales target",       build:T_salesFunnel},
  {name:"Funnel · 5 stacked",          build:T_stackedFunnel5},
  {name:"Funnel · Steps + list",       build:T_funnelSteps},
  {name:"Funnel · Two-sided",          build:T_funnelTwoSided},
  {name:"Funnel · Icons both sides",   build:T_funnelIconsBothSides},
  {name:"Funnel · Side captions",      build:T_funnelCaptions},
  {name:"Percent · Tap icons",         build:T_percentTaps},
  {name:"Percent · Rings",             build:T_percentRings},
  {name:"List · Numbered bars",        build:T_numberedBars},
  {name:"Arrows · Two opposing",       build:T_twoArrows},
  {name:"Arrows · Big contents",       build:T_bigArrows},
  {name:"List · Number callouts",      build:T_numberCallouts},
  {name:"List · Contents pills",       build:T_pillGrid},
  {name:"Pie · Pinwheel badges",       build:T_pinwheelBadges},
  {name:"Pie · Chart row",             build:T_pieRow},
  {name:"Pie · Donut callouts",        build:T_donutCallouts},
  {name:"Pie · Radial bars list",      build:T_radialList},
  {name:"Pie · Icon row",              build:T_pieIconRow},
  {name:"Infographic · Beer (teal)",   build:T_beerInfographicAlt},
  {name:"Infographic · Funnels",       build:T_funnelInfographic},
  {name:"Infographic · Gauge board",   build:T_gaugeDashboard},
  {name:"Title · Ember",   build:T_titleEmber},
  {name:"Title · Serif",   build:T_titleBone},
  {name:"Section · Dusk",  build:T_sectionDusk},
  {name:"Statement",       build:T_statement},
  {name:"Two columns",     build:T_twoCol},
  {name:"Image + point",   build:T_imageLeft},
  {name:"Big number",      build:T_bigNumber},
  {name:"Water Level",     build:T_waterLevel},
  {name:"Agri Impact",     build:T_agriImpact},
  {name:"Seed Growth",     build:T_seedGrowth},
  {name:"Canva Glass",     build:T_modernCanva},

  // ── motion-forward templates (moving backgrounds + objects/shapes) ──
  {name:"Cosmic Title",    build:T_cosmicTitle},
  {name:"Ocean Hero",      build:T_oceanHero},
  {name:"Bubble Pitch",    build:T_bubblePitch},
  {name:"Celebrate 🎉",    build:T_celebrate},
  {name:"Snow · Quiet",    build:T_snowQuiet},
  {name:"Rain · Mood",     build:T_rainMood},
  {name:"Grid · Tech",     build:T_gridTech},
  {name:"Spotlight",       build:T_spotlight},
  {name:"Aurora Stat",     build:T_auroraStat},
  {name:"Orbit System",    build:T_orbitSystem},
  {name:"Ray Launch",      build:T_rayLaunch},
  {name:"Film Story",      build:T_filmStory},
  {name:"Gradient Brand",  build:T_gradientBrand},
  {name:"Shape Showcase",  build:T_shapeShowcase},
  {name:"Growth Bubbles",  build:T_growthBubbles},

  {name:"Thank you",       build:T_thanks},
];

const AUTO_TEMPLATE_TOPICS = [
  {
    "group": "Agriculture",
    "title": "Food Security Impact",
    "kicker": "AGRICULTURE",
    "subtitle": "Turn field data into a clear story of production, people and progress.",
    "metric": "72%",
    "object": "farmer",
    "accent": "#2f6f4f",
    "bg": "linear-gradient(135deg,#f6f1e7,#dfe8cf)"
  },
  {
    "group": "Water",
    "title": "Water Access Tracker",
    "kicker": "WATER",
    "subtitle": "Show levels, distribution and access gaps with animated quantities.",
    "metric": "64%",
    "object": "water_glass",
    "accent": "#38bdf8",
    "bg": "radial-gradient(70% 80% at 15% 15%,#caf0f8,transparent 60%),#06283d"
  },
  {
    "group": "Seeds",
    "title": "Seed Distribution",
    "kicker": "SEEDS",
    "subtitle": "Visualize seeds delivered, planted and growing across communities.",
    "metric": "18K",
    "object": "seed_pile",
    "accent": "#7fb069",
    "bg": "linear-gradient(160deg,#102a1c,#2f6f4f)"
  },
  {
    "group": "Finance",
    "title": "Sustainable Cash Flow",
    "kicker": "FINANCE",
    "subtitle": "Make budgets, payments and value visible without boring tables.",
    "metric": "GMD",
    "object": "cash_bundle",
    "accent": "#30a46c",
    "bg": "radial-gradient(80% 70% at 80% 0%,#1f8a5b,transparent 62%),#101812"
  },
  {
    "group": "Digital",
    "title": "Digital Economy Growth",
    "kicker": "TECH",
    "subtitle": "Present connectivity, apps and digital transformation with modern tech visuals.",
    "metric": "4MB",
    "object": "wifi_router",
    "accent": "#3b82a0",
    "bg": "linear-gradient(135deg,#07111f,#16345d 70%,#3b82a0)"
  },
  {
    "group": "Solar",
    "title": "Solar Energy Performance",
    "kicker": "ENERGY",
    "subtitle": "Show clean energy capacity, batteries and uptime in one elegant slide.",
    "metric": "72.5kWp",
    "object": "solar_panel",
    "accent": "#f59e0b",
    "bg": "linear-gradient(150deg,#2a1f05,#f59e0b)"
  },
  {
    "group": "Health",
    "title": "Community Health Reach",
    "kicker": "HEALTH",
    "subtitle": "Use people-centered visuals to show services, referrals and response.",
    "metric": "91%",
    "object": "clinic",
    "accent": "#ef4444",
    "bg": "linear-gradient(135deg,#fff5f5,#fecaca)"
  },
  {
    "group": "Education",
    "title": "Training Outcomes",
    "kicker": "LEARNING",
    "subtitle": "A clean way to show participants, lessons learned and next steps.",
    "metric": "120",
    "object": "graduation",
    "accent": "#8b5cf6",
    "bg": "linear-gradient(135deg,#f5f3ff,#ede9fe)"
  },
  {
    "group": "Climate",
    "title": "Climate Resilience",
    "kicker": "CLIMATE",
    "subtitle": "Tell a story of risks, adaptation and community preparedness.",
    "metric": "3°C",
    "object": "leaf",
    "accent": "#22c55e",
    "bg": "linear-gradient(160deg,#052e16,#166534)"
  },
  {
    "group": "Logistics",
    "title": "Delivery Pipeline",
    "kicker": "LOGISTICS",
    "subtitle": "Track packages, trucks, warehouses and fulfillment milestones.",
    "metric": "98%",
    "object": "truck",
    "accent": "#f97316",
    "bg": "linear-gradient(135deg,#111827,#7c2d12)"
  },
  {
    "group": "Security",
    "title": "Security Operations",
    "kicker": "SECURITY",
    "subtitle": "A command-centre slide for risks, access, assets and incidents.",
    "metric": "24/7",
    "object": "shield",
    "accent": "#2563eb",
    "bg": "linear-gradient(160deg,#020617,#1e3a8a)"
  },
  {
    "group": "E-commerce",
    "title": "Marketplace Growth",
    "kicker": "MARKET",
    "subtitle": "Show stores, products, customers and orders in a modern layout.",
    "metric": "10X",
    "object": "shopping_cart",
    "accent": "#ec4899",
    "bg": "radial-gradient(80% 80% at 20% 20%,#ec4899,transparent 60%),#111827"
  },
  {
    "group": "Youth",
    "title": "Youth Innovation",
    "kicker": "YOUTH",
    "subtitle": "A bold slide for jobs, creativity, entrepreneurship and opportunity.",
    "metric": "1K+",
    "object": "youth",
    "accent": "#10b981",
    "bg": "linear-gradient(135deg,#061b17,#10b981)"
  },
  {
    "group": "Workshop",
    "title": "Workshop Reflection",
    "kicker": "SESSION",
    "subtitle": "Capture key takeaways, appreciation and action points beautifully.",
    "metric": "DAY 1",
    "object": "audience",
    "accent": "#f59e0b",
    "bg": "linear-gradient(135deg,#211e18,#4b2e05)"
  },
  {
    "group": "Project",
    "title": "Project Progress Update",
    "kicker": "PROJECT",
    "subtitle": "Summarize achievements, blockers, milestones and decisions.",
    "metric": "85%",
    "object": "checklist",
    "accent": "#22c55e",
    "bg": "linear-gradient(135deg,#f8fafc,#dbeafe)"
  },
  {
    "group": "Data",
    "title": "Results Dashboard",
    "kicker": "DATA",
    "subtitle": "Turn indicators into a clean high-level story for decision makers.",
    "metric": "42",
    "object": "chart_bar",
    "accent": "#3b82f6",
    "bg": "linear-gradient(135deg,#0f172a,#1e293b)"
  },
  {
    "group": "Community",
    "title": "Community Engagement",
    "kicker": "PEOPLE",
    "subtitle": "Show participation, trust, dialogue and local ownership.",
    "metric": "350",
    "object": "community",
    "accent": "#84cc16",
    "bg": "linear-gradient(135deg,#f7fee7,#d9f99d)"
  },
  {
    "group": "Creative",
    "title": "Big Creative Idea",
    "kicker": "IDEA",
    "subtitle": "A Canva-style creative slide for brainstorming, storytelling and pitching.",
    "metric": "WOW",
    "object": "idea",
    "accent": "#fde047",
    "bg": "radial-gradient(90% 90% at 80% 0%,#fde047,transparent 60%),#111827"
  },
  {
    "group": "Impact",
    "title": "Impact at a Glance",
    "kicker": "IMPACT",
    "subtitle": "Highlight the single number and the human story behind it.",
    "metric": "5,000",
    "object": "people",
    "accent": "#6366f1",
    "bg": "linear-gradient(160deg,#20123a,#4f46e5)"
  },
  {
    "group": "Pitch",
    "title": "Winning Proposal",
    "kicker": "PITCH",
    "subtitle": "Frame the opportunity, solution, value and delivery plan clearly.",
    "metric": "ROI",
    "object": "target",
    "accent": "#ef4444",
    "bg": "linear-gradient(135deg,#fff7ed,#fed7aa)"
  }
];
const AUTO_TEMPLATE_LAYOUTS = [
  {
    "name": "Hero cover",
    "kind": "cover"
  },
  {
    "name": "Big metric",
    "kind": "metric"
  },
  {
    "name": "Three key points",
    "kind": "cards"
  },
  {
    "name": "Timeline",
    "kind": "timeline"
  },
  {
    "name": "Compare",
    "kind": "compare"
  },
  {
    "name": "Object story",
    "kind": "object"
  }
];

function autoBg(spec,i){
  return spec.bg || BACKGROUNDS[(i+3)%BACKGROUNDS.length].css;
}
function autoTextColor(bg){
  return /#fff|#f6|#fb|#dbe|#fec|#fed|#f8|#f7|#ede|#caf|#dfe/i.test(bg) ? "#16140f" : "#fbf8f1";
}
function autoTemplate(spec, layout, idx){
  return {name:`${spec.group} · ${layout.name}`, build(){
    const accent=spec.accent || PALETTE[(idx%PALETTE.length)];
    const bg=autoBg(spec,idx);
    const ink=autoTextColor(bg);
    const muted=ink==="#16140f"?"#3a352a":"#d8d2c5";
    const title=spec.title;
    const sub=spec.subtitle;
    const kicker=spec.kicker;
    const metric=spec.metric;
    const object=spec.object || "people";
    const fDisplay = idx%4===0?'"Playfair Display",serif':idx%4===1?'"Space Grotesk",sans-serif':idx%4===2?'"Fraunces",serif':'"Manrope",sans-serif';
    const fBody = idx%3===0?'"Inter",sans-serif':idx%3===1?'"Plus Jakarta Sans",sans-serif':'"Archivo",sans-serif';
    if(layout.kind==="cover") return {bg,els:[
      makeShape("ellipse",{x:620,y:-120,w:460,h:460,fill:accent,radius:999,anim:"zoom"}),
      makeText({x:72,y:82,w:460,h:40,text:kicker,size:18,weight:800,ls:5,color:accent,font:'"Spline Sans Mono",monospace',anim:"left"}),
      makeText({x:70,y:136,w:760,h:190,text:title,font:fDisplay,size:78,weight:800,color:ink,lh:.98,anim:"rise",animDelay:.08}),
      makeText({x:74,y:350,w:560,h:92,text:sub,font:fBody,size:23,weight:500,color:muted,lh:1.35,anim:"fade",animDelay:.24}),
      makeObject(object,{x:720,y:330,w:170,h:150,count:8,accent,label:spec.group,showCount:false,anim:"pop",animDelay:.32}),
    ]};
    if(layout.kind==="metric") return {bg,els:[
      makeText({x:70,y:58,w:520,h:40,text:kicker,size:17,weight:800,ls:5,color:accent,font:'"Spline Sans Mono",monospace',anim:"left"}),
      makeText({x:68,y:105,w:540,h:230,text:metric,font:'"Archivo Expanded","Archivo",sans-serif',size:142,weight:800,color:ink,lh:.92,anim:"pop"}),
      makeShape("rect",{x:76,y:340,w:275,h:8,fill:accent,radius:10,anim:"reveal",animDelay:.25}),
      makeText({x:70,y:372,w:680,h:80,text:title+" — "+sub,font:fBody,size:26,weight:600,color:muted,lh:1.28,anim:"fade",animDelay:.35}),
      makeObject(object,{x:660,y:132,w:230,h:230,count:12,level:70,accent,label:spec.group,anim:"rise",animDelay:.18}),
    ]};
    if(layout.kind==="cards") return {bg,els:[
      makeText({x:64,y:52,w:760,h:70,text:title,font:fDisplay,size:50,weight:800,color:ink,anim:"rise"}),
      makeText({x:66,y:120,w:680,h:44,text:sub,font:fBody,size:19,weight:500,color:muted,anim:"fade",animDelay:.12}),
      makeShape("rect",{x:68,y:205,w:250,h:245,fill:"rgba(255,255,255,.18)",radius:22,anim:"left",animDelay:.2}),
      makeShape("rect",{x:354,y:205,w:250,h:245,fill:"rgba(255,255,255,.13)",radius:22,anim:"rise",animDelay:.25}),
      makeShape("rect",{x:640,y:205,w:250,h:245,fill:"rgba(255,255,255,.18)",radius:22,anim:"right",animDelay:.3}),
      makeText({x:96,y:235,w:190,h:46,text:"01",font:'"Archivo Expanded",sans-serif',size:36,weight:800,color:accent,anim:"fade",animDelay:.35}),
      makeText({x:382,y:235,w:190,h:46,text:"02",font:'"Archivo Expanded",sans-serif',size:36,weight:800,color:accent,anim:"fade",animDelay:.4}),
      makeText({x:668,y:235,w:190,h:46,text:"03",font:'"Archivo Expanded",sans-serif',size:36,weight:800,color:accent,anim:"fade",animDelay:.45}),
      makeText({x:96,y:305,w:190,h:90,text:"Baseline\nWhat changed",font:fBody,size:24,weight:700,color:ink,lh:1.15,anim:"fade",animDelay:.48}),
      makeText({x:382,y:305,w:190,h:90,text:"Action\nWhat we did",font:fBody,size:24,weight:700,color:ink,lh:1.15,anim:"fade",animDelay:.52}),
      makeText({x:668,y:305,w:190,h:90,text:"Result\nWhy it matters",font:fBody,size:24,weight:700,color:ink,lh:1.15,anim:"fade",animDelay:.56}),
    ]};
    if(layout.kind==="timeline") return {bg,els:[
      makeText({x:70,y:60,w:800,h:72,text:title,font:fDisplay,size:56,weight:800,color:ink,anim:"rise"}),
      makeShape("line",{x:110,y:294,w:735,h:6,fill:accent,anim:"reveal",animDelay:.2}),
      ...[0,1,2,3].flatMap((n)=>[
        makeShape("ellipse",{x:105+n*240,y:263,w:64,h:64,fill:accent,anim:"pop",animDelay:.3+n*.1}),
        makeText({x:118+n*240,y:281,w:38,h:30,text:String(n+1),font:'"Archivo Expanded",sans-serif',size:22,weight:800,color:"#fff",align:"center",anim:"fade",animDelay:.36+n*.1}),
        makeText({x:72+n*240,y:355,w:140,h:76,text:["Start","Build","Review","Scale"][n],font:fBody,size:23,weight:800,color:ink,align:"center",anim:"fade",animDelay:.42+n*.1})
      ]),
      makeText({x:80,y:455,w:780,h:42,text:sub,font:fBody,size:20,weight:500,color:muted,align:"center",anim:"fade",animDelay:.9}),
    ]};
    if(layout.kind==="compare") return {bg,els:[
      makeText({x:70,y:52,w:800,h:64,text:title,font:fDisplay,size:52,weight:800,color:ink,anim:"rise"}),
      makeShape("rect",{x:76,y:145,w:378,h:300,fill:"rgba(255,255,255,.16)",radius:26,anim:"left",animDelay:.15}),
      makeShape("rect",{x:506,y:145,w:378,h:300,fill:accent,radius:26,anim:"right",animDelay:.15}),
      makeText({x:110,y:184,w:300,h:44,text:"Before",font:fBody,size:28,weight:800,color:ink,anim:"fade",animDelay:.3}),
      makeText({x:540,y:184,w:300,h:44,text:"After",font:fBody,size:28,weight:800,color:"#fff",anim:"fade",animDelay:.3}),
      makeText({x:110,y:250,w:285,h:120,text:"Fragmented data\nSlow reporting\nManual visuals",font:fBody,size:24,weight:600,color:muted,lh:1.45,anim:"fade",animDelay:.38}),
      makeText({x:540,y:250,w:285,h:120,text:"Clear story\nAnimated evidence\nDecision ready",font:fBody,size:24,weight:700,color:"#fff",lh:1.45,anim:"fade",animDelay:.45}),
    ]};
    return {bg,els:[
      makeShape("ellipse",{x:-120,y:-140,w:360,h:360,fill:accent,anim:"zoom"}),
      makeText({x:64,y:64,w:500,h:44,text:kicker,font:'"Spline Sans Mono",monospace',size:17,weight:800,ls:5,color:accent,anim:"left"}),
      makeText({x:62,y:116,w:500,h:150,text:title,font:fDisplay,size:66,weight:800,color:ink,lh:1,anim:"rise"}),
      makeText({x:66,y:300,w:450,h:92,text:sub,font:fBody,size:23,weight:500,color:muted,lh:1.35,anim:"fade",animDelay:.22}),
      makeObject(object,{x:590,y:112,w:300,h:310,count:28,level:metric.includes("%")?parseInt(metric)||70:70,accent,label:spec.group,anim:"pop",animDelay:.28}),
    ]};
  }};
}
const AUTO_TEMPLATES = [];
AUTO_TEMPLATE_TOPICS.forEach((spec,ti)=>{
  AUTO_TEMPLATE_LAYOUTS.forEach((layout,li)=>AUTO_TEMPLATES.push(autoTemplate(spec,layout,ti*AUTO_TEMPLATE_LAYOUTS.length+li)));
});

const DATA_TEMPLATES = [
  {name:"Data · Executive dashboard", build(){return{bg:"linear-gradient(135deg,#0f172a,#111827 65%,#1e293b)",els:[
    makeText({x:54,y:44,w:670,h:58,text:"Performance dashboard",font:'"Space Grotesk",sans-serif',size:50,weight:800,color:"#f8fafc",anim:"rise"}),
    makeText({x:58,y:108,w:560,h:42,text:"Combine charts, graphs and tables in one clear presentation slide.",font:'"Inter",sans-serif',size:20,weight:500,color:"#cbd5e1",anim:"fade",animDelay:.15}),
    makeChart("bar",{x:52,y:175,w:395,h:285,title:"Monthly reach",accent:"#38bdf8",anim:"left",animDelay:.2}),
    makeChart("line",{x:488,y:175,w:420,h:285,title:"Growth graph",accent:"#22c55e",anim:"right",animDelay:.28}),
  ]};}},
  {name:"Data · Report table", build(){return{bg:"linear-gradient(145deg,#f8fafc,#e2e8f0)",els:[
    makeText({x:58,y:48,w:760,h:64,text:"Quarterly results",font:'"Plus Jakarta Sans",sans-serif',size:54,weight:800,color:"#0f172a",anim:"rise"}),
    makeTable({x:68,y:142,w:825,h:315,accent:"#2563eb",theme:"clean",anim:"fade",animDelay:.18}),
    makeText({x:72,y:474,w:760,h:28,text:"Tip: select the table and paste tab/comma-separated data in the inspector.",font:'"Inter",sans-serif',size:16,weight:500,color:"#475569",anim:"fade",animDelay:.35}),
  ]};}},
  {name:"Data · Map story", build(){return{bg:"radial-gradient(80% 90% at 20% 0%,#dcfce7,transparent 60%),linear-gradient(135deg,#ecfeff,#f8fafc)",els:[
    makeText({x:60,y:54,w:420,h:112,text:"Where the work happens",font:'"Fraunces",serif',size:58,weight:700,color:"#064e3b",lh:1,anim:"left"}),
    makeMap("gambia",{x:400,y:72,w:500,h:340,title:"Field locations",accent:"#059669",anim:"right",animDelay:.15}),
    makeObject("farmer",{x:82,y:282,w:220,h:150,count:7,accent:"#84cc16",label:"Farmers",anim:"pop",animDelay:.32}),
  ]};}},
  {name:"Data · Pie composition", build(){return{bg:"linear-gradient(135deg,#fff7ed,#ffedd5)",els:[
    makeText({x:62,y:58,w:440,h:120,text:"Budget mix",font:'"Archivo Expanded",sans-serif',size:64,weight:800,color:"#7c2d12",lh:1,anim:"rise"}),
    makeText({x:68,y:188,w:390,h:92,text:"Show how a total is distributed across categories using an animated pie chart.",font:'"Manrope",sans-serif',size:23,weight:600,color:"#9a3412",lh:1.32,anim:"fade",animDelay:.18}),
    makeChart("pie",{x:480,y:72,w:410,h:370,title:"Allocation",accent:"#f97316",chartData:[{label:"Training",value:35},{label:"Logistics",value:28},{label:"Tools",value:22},{label:"Support",value:15}],anim:"pop",animDelay:.2}),
  ]};}}
];

/* ── v31 pro template pack — business/story layouts using the new anims ── */
const PRO_TEMPLATES = [
  {name:"Pro · Agenda", build(){return{bg:"linear-gradient(135deg,#0f172a,#111827 70%,#1e293b)",els:[
    makeText({x:60,y:52,w:520,h:70,text:"Agenda",font:'"Fraunces",serif',size:62,weight:600,italic:true,color:"#f8fafc",anim:"typewriter"}),
    ...[["01","Where we are","#38bdf8"],["02","What we learned","#f2c14e"],["03","Where we go next","#34d399"],["04","Decisions needed","#fb7185"]].flatMap((r,i)=>[
      makeShape("rect",{x:60,y:150+i*88,w:840,h:70,fill:"rgba(255,255,255,.05)",radius:16,stroke:"rgba(255,255,255,.12)",strokeW:1,anim:"left",animDelay:.15+i*.12}),
      makeText({x:84,y:166+i*88,w:80,h:44,text:r[0],font:'"Spline Sans Mono",monospace',size:30,weight:800,color:r[2],anim:"fade",animDelay:.25+i*.12}),
      makeText({x:180,y:164+i*88,w:640,h:46,text:r[1],font:'"Archivo",sans-serif',size:27,weight:600,color:"#e2e8f0",anim:"fade",animDelay:.3+i*.12}),
    ]),
  ]};}},
  {name:"Pro · Timeline", build(){return{bg:"linear-gradient(145deg,#fefce8,#fef3c7)",els:[
    makeText({x:60,y:50,w:760,h:66,text:"The journey so far",font:'"Fraunces",serif',size:56,weight:700,color:"#78350f",anim:"rise"}),
    makeLine({x:80,y:296,w:800,h:5,fill:"#b45309",anim:"reveal",animDelay:.2}),
    ...[["2023","Founded","#d97706"],["2024","First pilot","#b45309"],["2025","Scale up","#92400e"],["2026","Nationwide","#78350f"]].flatMap((m,i)=>[
      makeShape("ellipse",{x:118+i*212,y:280,w:36,h:36,fill:m[2],stroke:"#fffbeb",strokeW:5,anim:"pop",animDelay:.35+i*.15}),
      makeText({x:76+i*212,y:216,w:120,h:40,text:m[0],font:'"Spline Sans Mono",monospace',size:23,weight:800,color:m[2],align:"center",anim:"drop",animDelay:.4+i*.15}),
      makeText({x:66+i*212,y:334,w:140,h:64,text:m[1],font:'"Archivo",sans-serif',size:21,weight:600,color:"#451a03",align:"center",anim:"float",animDelay:.48+i*.15}),
    ]),
  ]};}},
  {name:"Pro · Team grid", build(){return{bg:"linear-gradient(135deg,#faf5ff,#eef2ff)",els:[
    makeText({x:60,y:46,w:700,h:64,text:"Meet the team",font:'"Fraunces",serif',size:56,weight:700,color:"#312e81",anim:"rise"}),
    ...["Amina","Lamin","Fatou","Ousman"].flatMap((n,i)=>[
      makeImage("",{x:78+i*216,y:150,w:170,h:170,radius:999,anim:"flipx",animDelay:.15+i*.13}),
      makeText({x:66+i*216,y:338,w:194,h:38,text:n,font:'"Archivo",sans-serif',size:25,weight:800,color:"#1e1b4b",align:"center",anim:"fade",animDelay:.3+i*.13}),
      makeText({x:66+i*216,y:376,w:194,h:34,text:"Role title",font:'"Inter",sans-serif',size:17,weight:500,color:"#6366f1",align:"center",anim:"fade",animDelay:.36+i*.13}),
    ]),
  ]};}},
  {name:"Pro · KPI board", build(){return{bg:"linear-gradient(135deg,#020617,#0f172a 60%,#111827)",els:[
    makeText({x:56,y:42,w:700,h:56,text:"This quarter at a glance",font:'"Space Grotesk","Archivo",sans-serif',size:44,weight:800,color:"#f8fafc",anim:"rise"}),
    ...[["+38%","Revenue growth","#34d399"],["12.4k","New audience","#38bdf8"],["96%","Retention","#f2c14e"]].flatMap((k,i)=>[
      makeShape("rect",{x:56+i*292,y:120,w:268,h:130,fill:"rgba(255,255,255,.05)",radius:20,stroke:"rgba(255,255,255,.12)",strokeW:1,anim:"bounce",animDelay:.12+i*.14}),
      makeText({x:80+i*292,y:138,w:220,h:60,text:k[0],font:'"Archivo Expanded","Archivo",sans-serif',size:48,weight:800,color:k[2],anim:"pop",animDelay:.25+i*.14}),
      makeText({x:80+i*292,y:200,w:220,h:34,text:k[1],font:'"Inter",sans-serif',size:18,weight:600,color:"#94a3b8",anim:"fade",animDelay:.34+i*.14}),
    ]),
    makeChart("area",{x:56,y:276,w:848,h:222,title:"Momentum",accent:"#38bdf8",chartThemeMode:"dark",anim:"float",animDelay:.55}),
  ]};}},
  {name:"Pro · Comparison", build(){return{bg:"linear-gradient(90deg,#0f172a 50%,#f6f1e7 50%)",els:[
    makeText({x:60,y:70,w:360,h:110,text:"Before",font:'"Fraunces",serif',size:66,weight:600,italic:true,color:"#f8fafc",anim:"left"}),
    makeText({x:64,y:190,w:352,h:220,text:"Manual reporting\nScattered files\nSlow feedback loops",font:'"Archivo",sans-serif',size:24,weight:500,color:"#cbd5e1",lh:1.8,anim:"fade",animDelay:.25}),
    makeText({x:540,y:70,w:360,h:110,text:"After",font:'"Fraunces",serif',size:66,weight:600,italic:true,color:"#16140f",anim:"right"}),
    makeText({x:544,y:190,w:352,h:220,text:"One live dashboard\nA single source of truth\nDecisions in minutes",font:'"Archivo",sans-serif',size:24,weight:600,color:"#3a352a",lh:1.8,anim:"fade",animDelay:.35}),
    makeShape("ellipse",{x:432,y:222,w:96,h:96,fill:"#e8482b",stroke:"#ffffff",strokeW:4,anim:"spin",animDelay:.5}),
    makeText({x:432,y:248,w:96,h:44,text:"VS",font:'"Archivo Expanded","Archivo",sans-serif',size:32,weight:800,color:"#ffffff",align:"center",anim:"fade",animDelay:.6}),
  ]};}},
  {name:"Pro · Roadmap", build(){return{bg:"linear-gradient(135deg,#ecfeff,#f0fdf4)",els:[
    makeText({x:60,y:44,w:760,h:62,text:"Roadmap",font:'"Fraunces",serif',size:56,weight:700,color:"#064e3b",anim:"rise"}),
    ...[["Q1 — Build","Ship the core studio and invite the first 20 teams.","#0891b2"],["Q2 — Learn","Run live sessions, measure engagement, fix friction.","#059669"],["Q3 — Grow","Open self-serve sign-ups and launch templates market.","#65a30d"]].flatMap((c,i)=>[
      makeShape("rect",{x:56+i*296,y:130,w:272,h:330,fill:"#ffffff",radius:22,stroke:"rgba(6,78,59,.14)",strokeW:1,anim:"rise",animDelay:.12+i*.15}),
      makeShape("rect",{x:56+i*296,y:130,w:272,h:10,fill:c[2],radius:6,anim:"reveal",animDelay:.2+i*.15}),
      makeText({x:80+i*296,y:166,w:224,h:46,text:c[0],font:'"Archivo",sans-serif',size:26,weight:800,color:"#064e3b",anim:"fade",animDelay:.3+i*.15}),
      makeText({x:80+i*296,y:222,w:224,h:200,text:c[1],font:'"Inter",sans-serif',size:19,weight:500,color:"#334155",lh:1.5,anim:"fade",animDelay:.38+i*.15}),
    ]),
  ]};}},
  {name:"Pro · Pricing table", build(){return{bg:"linear-gradient(145deg,#f8fafc,#e2e8f0)",els:[
    makeText({x:60,y:44,w:760,h:60,text:"Simple pricing",font:'"Plus Jakarta Sans","Archivo",sans-serif',size:52,weight:800,color:"#0f172a",anim:"rise"}),
    makeTable({x:66,y:132,w:828,h:330,accent:"#7c3aed",theme:"clean",anim:"float",animDelay:.2,rows:5,cols:4,tableData:[
      ["Plan","Starter","Team","Enterprise"],
      ["Price / month","Free","$29","Custom"],
      ["Decks","3","Unlimited","Unlimited"],
      ["Live audience","25","250","Unlimited"],
      ["Support","Community","Priority","Dedicated"],
    ]}),
  ]};}},
  {name:"Pro · Gradient quote", build(){return{bg:"radial-gradient(70% 60% at 30% 0%,#34d399 0%,transparent 55%),radial-gradient(60% 70% at 75% 10%,#818cf8 0%,transparent 58%),linear-gradient(180deg,#020617,#0f172a)",els:[
    makeText({x:110,y:140,w:740,h:220,text:"“Big ideas deserve\nbig stages.”",font:'"Fraunces",serif',size:84,weight:600,italic:true,color:"#f8fafc",lh:1.05,align:"center",anim:"blurzoom"}),
    makeLine({x:410,y:392,w:140,h:4,fill:"#34d399",anim:"reveal",animDelay:.45}),
    makeText({x:110,y:414,w:740,h:40,text:"YOUR NAME — FOUNDER",font:'"Spline Sans Mono",monospace',size:18,weight:700,color:"#94a3b8",ls:4,align:"center",anim:"fade",animDelay:.6}),
  ]};}},
  {name:"Pro · Feature icons", build(){return{bg:"linear-gradient(135deg,#fff7ed,#ffedd5)",els:[
    makeText({x:60,y:46,w:800,h:62,text:"Why teams pick us",font:'"Fraunces",serif',size:54,weight:700,color:"#7c2d12",anim:"rise"}),
    ...[["target","Focused","Every slide drives one clear point."],["rocket","Fast","From blank page to live deck in minutes."],["shield","Reliable","Presents anywhere, even offline."],["users","Together","Co-edit and react live with your audience."]].flatMap((f,i)=>[
      makeObject("info_node",{x:70+i*220,y:140,w:180,h:230,nodeIcon:f[0],nodeTitle:f[1],nodeText:f[2],anim:"elastic",animDelay:.15+i*.14}),
    ]),
  ]};}},
  {name:"Pro · Closing CTA", build(){return{bg:"linear-gradient(140deg,#0c0a09,#1c1917 70%,#292524)",els:[
    makeShape("ellipse",{x:640,y:-140,w:480,h:480,fill:"rgba(216,162,58,.22)",anim:"zoom"}),
    makeText({x:80,y:130,w:800,h:170,text:"Let's build it\ntogether.",font:'"Fraunces",serif',size:92,weight:600,italic:true,color:"#fbf8f1",lh:1,anim:"rise"}),
    makeLink({x:84,y:352,w:340,h:74,label:"Start a project →",description:"yourbrand.com",url:"https://example.com",bg:"#d8a23a",accent:"#d8a23a",textColor:"#1c1917",radius:16,anim:"bounce",animDelay:.35}),
    makeText({x:84,y:444,w:600,h:36,text:"hello@yourbrand.com · @yourbrand",font:'"Spline Sans Mono",monospace',size:18,weight:600,color:"#a8a29e",anim:"fade",animDelay:.55}),
  ]};}},
];

/* ── v50 executive pack — data-forward, professional layouts that show
   off the new chart kinds (combo, pareto, lollipop, pyramid, polar area),
   the new backgrounds, and the new symbol shapes. ─────────────────── */
const EXEC_TEMPLATES = [
  {name:"Exec · Minimal cover", build(){return{bg:"radial-gradient(90% 100% at 50% -10%,rgba(148,163,184,.22) 0%,transparent 60%),linear-gradient(160deg,#1e293b,#0f172a 70%,#020617)",els:[
    makeShape("rect",{x:60,y:238,w:120,h:6,fill:"#38bdf8",radius:3,anim:"reveal"}),
    makeText({x:58,y:132,w:840,h:100,text:"Company name",font:'"Space Grotesk",sans-serif',size:76,weight:800,color:"#f8fafc",anim:"rise"}),
    makeText({x:60,y:262,w:760,h:60,text:"Board review · Strategy & performance",font:'"Inter",sans-serif',size:26,weight:500,color:"#94a3b8",anim:"fade",animDelay:.2}),
    makeText({x:60,y:452,w:600,h:36,text:"PRESENTED BY YOUR NAME · Q3 2026",font:'"Spline Sans Mono",monospace',size:16,weight:700,ls:3,color:"#64748b",anim:"fade",animDelay:.4}),
  ]};}},
  {name:"Exec · Combo trend", build(){return{bg:"radial-gradient(80% 70% at 50% 0%,#ffffff 0%,transparent 65%),linear-gradient(180deg,#f8fafc,#e2e8f0)",els:[
    makeText({x:56,y:44,w:760,h:58,text:"Revenue vs trend",font:'"Plus Jakarta Sans",sans-serif',size:48,weight:800,color:"#0f172a",anim:"rise"}),
    makeText({x:58,y:106,w:680,h:38,text:"Bars show actuals, the line shows the rolling trend — values always visible.",font:'"Inter",sans-serif',size:19,weight:500,color:"#475569",anim:"fade",animDelay:.15}),
    makeChart("combo",{x:56,y:158,w:848,h:328,title:"Monthly revenue",accent:"#2563eb",palette:["#2563eb","#22c55e","#38bdf8","#f59e0b","#a855f7","#ef4444"],valuePrefix:"$",anim:"float",animDelay:.25}),
  ]};}},
  {name:"Exec · Pareto insight", build(){return{bg:"linear-gradient(145deg,#f8fafc,#e2e8f0)",els:[
    makeText({x:56,y:44,w:800,h:56,text:"Where the impact comes from",font:'"Fraunces",serif',size:46,weight:700,color:"#0f172a",anim:"rise"}),
    makeChart("pareto",{x:56,y:120,w:560,h:366,title:"Pareto — 80/20",accent:"#e8482b",anim:"left",animDelay:.15}),
    makeShape("rect",{x:648,y:132,w:256,h:340,fill:"#ffffff",radius:20,stroke:"rgba(15,23,42,.1)",strokeW:1,anim:"right",animDelay:.2}),
    makeText({x:672,y:158,w:210,h:60,text:"80%",font:'"Archivo Expanded","Archivo",sans-serif',size:56,weight:800,color:"#e8482b",anim:"pop",animDelay:.35}),
    makeText({x:672,y:232,w:210,h:200,text:"of the results come from the top few drivers. Focus effort where the curve climbs fastest.",font:'"Inter",sans-serif',size:19,weight:500,color:"#334155",lh:1.5,anim:"fade",animDelay:.45}),
  ]};}},
  {name:"Exec · Lollipop ranking", build(){return{bg:"radial-gradient(60% 70% at 85% 0%,rgba(216,162,58,.4) 0%,transparent 55%),radial-gradient(50% 60% at 10% 100%,rgba(216,162,58,.18) 0%,transparent 55%),linear-gradient(160deg,#0c0a09,#1c1917)",els:[
    makeText({x:56,y:46,w:760,h:56,text:"Regional ranking",font:'"Fraunces",serif',size:50,weight:600,italic:true,color:"#fbf8f1",anim:"rise"}),
    makeChart("lollipop",{x:56,y:130,w:848,h:352,title:"Score by region",accent:"#d8a23a",chartThemeMode:"dark",palette:["#d8a23a","#f2c14e","#fde68a","#a8a29e","#78716c","#57534e"],sortOrder:"desc",anim:"rise",animDelay:.2}),
  ]};}},
  {name:"Exec · Market pyramid", build(){return{bg:"radial-gradient(80% 90% at 15% 0%,rgba(52,211,153,.35) 0%,transparent 55%),linear-gradient(150deg,#022c22,#064e3b 60%,#065f46)",els:[
    makeText({x:56,y:52,w:520,h:120,text:"Market layers",font:'"Fraunces",serif',size:58,weight:700,color:"#ecfdf5",lh:1.02,anim:"left"}),
    makeText({x:60,y:180,w:400,h:120,text:"From total addressable market down to the customers we serve today.",font:'"Inter",sans-serif',size:21,weight:500,color:"#a7f3d0",lh:1.4,anim:"fade",animDelay:.2}),
    makeChart("pyramid",{x:470,y:70,w:440,h:400,title:"TAM → SAM → SOM",accent:"#34d399",chartThemeMode:"dark",palette:["#34d399","#2dd4bf","#38bdf8","#818cf8","#a855f7","#f59e0b"],chartData:[{label:"TAM",value:100},{label:"SAM",value:62},{label:"SOM",value:30},{label:"Today",value:12}],anim:"right",animDelay:.25}),
  ]};}},
  {name:"Exec · Polar snapshot", build(){return{bg:"radial-gradient(70% 90% at 85% 10%,rgba(129,140,248,.4) 0%,transparent 58%),linear-gradient(145deg,#1e1b4b,#312e81 65%,#3730a3)",els:[
    makeText({x:56,y:52,w:460,h:120,text:"Capability radar",font:'"Space Grotesk",sans-serif',size:52,weight:800,color:"#eef2ff",lh:1.05,anim:"rise"}),
    makeText({x:60,y:180,w:380,h:130,text:"Every axis shows its value — a fast, honest snapshot of where we are strong.",font:'"Inter",sans-serif',size:20,weight:500,color:"#c7d2fe",lh:1.42,anim:"fade",animDelay:.2}),
    makeChart("polarArea",{x:460,y:64,w:450,h:412,title:"Team strengths",accent:"#818cf8",chartThemeMode:"dark",palette:["#818cf8","#38bdf8","#34d399","#f2c14e","#fb7185","#a855f7"],chartData:[{label:"Product",value:82},{label:"Sales",value:64},{label:"Support",value:74},{label:"Brand",value:56},{label:"Ops",value:68}],anim:"pop",animDelay:.25}),
  ]};}},
  {name:"Exec · Stacked mix", build(){return{bg:"linear-gradient(160deg,#1e293b,#0f172a 70%,#020617)",els:[
    makeText({x:56,y:44,w:800,h:56,text:"Portfolio mix by quarter",font:'"Plus Jakarta Sans",sans-serif',size:44,weight:800,color:"#f8fafc",anim:"rise"}),
    makeChart("stackedBar",{x:56,y:118,w:848,h:368,title:"Segments (totals on top)",accent:"#38bdf8",chartThemeMode:"dark",showLegend:true,seriesNames:["Core","Growth","New bets"],chartData:[{label:"Q1",value:0,series:[42,20,8]},{label:"Q2",value:0,series:[46,26,12]},{label:"Q3",value:0,series:[50,30,18]},{label:"Q4",value:0,series:[54,36,22]}],anim:"rise",animDelay:.18}),
  ]};}},
  {name:"Exec · SWOT board", build(){return{bg:"radial-gradient(80% 60% at 50% 100%,rgba(148,163,184,.35) 0%,transparent 60%),linear-gradient(180deg,#f1f5f9,#cbd5e1)",els:[
    makeText({x:56,y:36,w:700,h:54,text:"SWOT",font:'"Fraunces",serif',size:48,weight:700,color:"#0f172a",anim:"rise"}),
    ...[["Strengths","#16a34a","What we do better than anyone.",56,104],["Weaknesses","#ef4444","Where we lose time or trust.",492,104],["Opportunities","#2563eb","Openings we can act on now.",56,306],["Threats","#f59e0b","Risks we must watch and plan for.",492,306]].flatMap((q,i)=>[
      makeShape("rect",{x:q[3],y:q[4],w:412,h:186,fill:"#ffffff",radius:18,stroke:"rgba(15,23,42,.1)",strokeW:1,anim:"zoom",animDelay:.1+i*.1}),
      makeShape("rect",{x:q[3],y:q[4],w:8,h:186,fill:q[1],radius:4,anim:"reveal",animDelay:.18+i*.1}),
      makeText({x:q[3]+28,y:q[4]+18,w:360,h:40,text:q[0],font:'"Archivo",sans-serif',size:26,weight:800,color:q[1],anim:"fade",animDelay:.25+i*.1}),
      makeText({x:q[3]+28,y:q[4]+64,w:360,h:104,text:q[2]+"\n• Point one\n• Point two",font:'"Inter",sans-serif',size:17,weight:500,color:"#334155",lh:1.45,anim:"fade",animDelay:.3+i*.1}),
    ]),
  ]};}},
  {name:"Exec · Process flow", build(){return{bg:"linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(150deg,#0c4a6e,#075985)",bgSize:"44px 44px,44px 44px,auto",els:[
    makeText({x:56,y:48,w:800,h:56,text:"How the work flows",font:'"Space Grotesk",sans-serif',size:46,weight:800,color:"#f0f9ff",anim:"rise"}),
    ...[["1","Discover","#38bdf8"],["2","Design","#22d3ee"],["3","Build","#34d399"],["4","Launch","#f2c14e"]].flatMap((s,i)=>[
      makeShape("rect",{x:56+i*228,y:170,w:180,h:180,fill:"rgba(255,255,255,.08)",radius:22,stroke:"rgba(255,255,255,.2)",strokeW:1,anim:"rise",animDelay:.12+i*.14}),
      makeText({x:56+i*228,y:196,w:180,h:64,text:s[0],font:'"Archivo Expanded","Archivo",sans-serif',size:52,weight:800,color:s[2],align:"center",anim:"pop",animDelay:.22+i*.14}),
      makeText({x:56+i*228,y:276,w:180,h:44,text:s[1],font:'"Archivo",sans-serif',size:24,weight:700,color:"#e0f2fe",align:"center",anim:"fade",animDelay:.3+i*.14}),
      ...(i<3?[makeCreativeShape("double_arrow",{x:230+i*228,y:238,w:66,h:44,fill:"rgba(255,255,255,.55)",anim:"left",animDelay:.35+i*.14})]:[]),
    ]),
    makeText({x:56,y:406,w:848,h:60,text:"Each stage hands off cleanly to the next — no work is lost between steps.",font:'"Inter",sans-serif',size:20,weight:500,color:"#bae6fd",align:"center",anim:"fade",animDelay:.8}),
  ]};}},
  {name:"Exec · Quote + stat", build(){return{bg:"radial-gradient(70% 80% at 20% 0%,rgba(244,63,94,.35) 0%,transparent 55%),linear-gradient(155deg,#1c0a10,#4c0519 65%,#881337)",els:[
    makeText({x:70,y:110,w:540,h:240,text:"“The numbers\ntell the story.”",font:'"Fraunces",serif',size:70,weight:600,italic:true,color:"#fff1f2",lh:1.05,anim:"blur"}),
    makeText({x:74,y:380,w:420,h:36,text:"— HEAD OF STRATEGY",font:'"Spline Sans Mono",monospace',size:16,weight:700,ls:3,color:"#fda4af",anim:"fade",animDelay:.35}),
    makeChart("gauge",{x:610,y:120,w:300,h:300,title:"Target reached",accent:"#fb7185",chartThemeMode:"dark",chartData:[{label:"Progress",value:87}],anim:"pop",animDelay:.3}),
  ]};}},
];

const TEMPLATES = [...EXEC_TEMPLATES, ...PRO_TEMPLATES, ...BASE_TEMPLATES, ...AUTO_TEMPLATES, ...DATA_TEMPLATES];

/* ════════════════════════════════════════════════════════════════════
   FREEFORM SHAPES + UNIVERSAL EFFECTS                            v54
   ────────────────────────────────────────────────────────────────────
   Two separate things that arrived together because they answer the same
   wish — stop picking from a menu, make the thing you actually want.

   1. A `freeform` element: a vector shape defined by POINTS, not by a
      fixed library path. Presets seed the points (polygon, star, blob,
      arrow, heart, wave…), then every vertex is yours to drag in the
      editor. Sharp corners, rounded corners or a smooth spline through
      the lot. It ships with anim:"none" — a free object that simply sits
      there until you decide otherwise.

   2. `el.fx`: shadow, glow, 3-D tilt, extrude depth, blur/brightness/
      saturation, blend mode and flips — applied by applyElFx() to ANY
      element type. Text, images, charts, actors, objects and freeforms
      all get the same controls, because there was no good reason for a
      drop shadow to be a shape-only privilege.

   WHERE THE EFFECTS LAND
      Everything visual goes on ``.el-inner``, never on ``.el`` itself.
      The outer node keeps its plain rotate() so the editor's drag,
      resize and rotate maths — and the selection handles — carry on
      working exactly as before. A 3-D tilt visibly leans the artwork
      while its bounding box stays honest.
   ════════════════════════════════════════════════════════════════════ */

const FREEFORM_KINDS = [
  {key:"polygon", label:"Polygon"},
  {key:"star",    label:"Star"},
  {key:"burst",   label:"Burst"},
  {key:"blob",    label:"Blob"},
  {key:"arrow",   label:"Arrow"},
  {key:"chevron", label:"Chevron"},
  {key:"cross",   label:"Cross"},
  {key:"bubble",  label:"Speech bubble"},
  {key:"wave",    label:"Wave"},
  {key:"heart",   label:"Heart"},
  {key:"drop",    label:"Droplet"},
  {key:"custom",  label:"Custom (your points)"},
];
const BLEND_MODES = ["normal","multiply","screen","overlay","darken","lighten",
  "color-dodge","color-burn","hard-light","soft-light","difference","exclusion",
  "hue","saturation","color","luminosity"];

function makeFreeform(kind="polygon",over={}){
  return elBase("freeform",Object.assign({
    x:340,y:150,w:260,h:260,
    shapeKind:kind,
    sides:6,             // polygon sides · star/burst points · blob lobes
    inset:0.45,          // star/burst inner radius, as a share of the outer
    corner:0,            // corner rounding, 0–1
    smooth:false,        // spline through the points instead of straight edges
    points:null,         // [{x,y}] in a 0–100 box — written once you drag one
    closed:true,
    fillMode:"solid",    // solid | linear | radial | none
    fill:"#e8482b", fill2:"#f2c14e", gradAngle:135,
    stroke:"none", strokeW:0, dash:0,
    // A free object with nothing moving. Give it an entrance if you want one.
    anim:"none", animDelay:0,
  },over));
}

/* ── preset point sets, all in a 0–100 box ───────────────────────────
   Presets only SEED the shape. The moment a vertex is dragged the points
   are stored on the element and the preset stops being consulted, so an
   edit is never silently undone by a later slider nudge. */
function freeformPoints(el){
  if(Array.isArray(el.points)&&el.points.length>=2)return el.points;
  return freeformPreset(el.shapeKind,el);
}
function freeformPreset(kind,el={}){
  const n=Math.max(3,Math.min(24,Number(el.sides)||6));
  const inset=Math.max(.08,Math.min(.95,Number(el.inset)==null?.45:Number(el.inset)));
  const pt=(a,r)=>({x:50+Math.cos(a)*r, y:50+Math.sin(a)*r});
  const TAU=Math.PI*2, start=-Math.PI/2;
  const out=[];
  switch(kind){
    case "star": case "burst": {
      const spikes=kind==="burst"?Math.max(6,n*2):n;
      const inner=kind==="burst"?Math.max(.55,inset):inset;
      for(let i=0;i<spikes*2;i++){
        out.push(pt(start+i*TAU/(spikes*2), i%2?50*inner:50));
      }
      return out;
    }
    case "blob": {
      // Deterministic wobble — the same slide always draws the same blob.
      const lobes=Math.max(4,n);
      let seed=lobes*97+13;
      const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff;return seed/0x7fffffff;};
      for(let i=0;i<lobes;i++)out.push(pt(start+i*TAU/lobes, 34+rnd()*16));
      return out;
    }
    case "arrow":
      return [{x:0,y:32},{x:58,y:32},{x:58,y:6},{x:100,y:50},
              {x:58,y:94},{x:58,y:68},{x:0,y:68}];
    case "chevron":
      return [{x:0,y:0},{x:56,y:0},{x:100,y:50},{x:56,y:100},{x:0,y:100},{x:44,y:50}];
    case "cross": {
      const a=34,b=66;
      return [{x:a,y:0},{x:b,y:0},{x:b,y:a},{x:100,y:a},{x:100,y:b},{x:b,y:b},
              {x:b,y:100},{x:a,y:100},{x:a,y:b},{x:0,y:b},{x:0,y:a},{x:a,y:a}];
    }
    case "bubble":
      return [{x:4,y:2},{x:96,y:2},{x:96,y:70},{x:44,y:70},{x:26,y:98},
              {x:26,y:70},{x:4,y:70}];
    case "wave": {
      const pts=[];
      const cycles=Math.max(1,Math.min(5,Math.round(n/3)));
      for(let i=0;i<=20;i++){
        pts.push({x:i*100/20, y:40+Math.sin(i/20*TAU*cycles)*18});
      }
      pts.push({x:100,y:100},{x:0,y:100});
      return pts;
    }
    case "heart": {
      const pts=[];
      for(let i=0;i<28;i++){
        const t=i/28*TAU;
        const hx=16*Math.pow(Math.sin(t),3);
        const hy=13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t);
        pts.push({x:50+hx*2.9, y:50-hy*2.9});
      }
      return pts;
    }
    case "drop": {
      // Pointed tip, round belly: a 270° arc closed back up to the point.
      const pts=[{x:50,y:1}];
      for(let i=0;i<=22;i++){
        const a=-Math.PI/4+i*(Math.PI*1.5)/22;
        pts.push({x:50+Math.cos(a)*38, y:62+Math.sin(a)*38});
      }
      return pts;
    }
    case "custom":
      return [{x:8,y:8},{x:92,y:20},{x:78,y:92},{x:14,y:70}];
    default: {                                   // polygon
      for(let i=0;i<n;i++)out.push(pt(start+i*TAU/n,50));
      return out;
    }
  }
}

/* ── points → SVG path ───────────────────────────────────────────────
   Three modes, in rising order of softness: straight edges, rounded
   corners (each vertex cut back and bridged with a quadratic), or a
   Catmull-Rom spline threaded through every point. */
function freeformPath(pts,{closed=true,corner=0,smooth=false}={}){
  const p=(pts||[]).filter(q=>q&&isFinite(q.x)&&isFinite(q.y));
  if(p.length<2)return "";
  const f=n=>Math.round(n*1000)/1000;

  if(smooth){
    // Catmull-Rom → cubic bézier.
    const at=i=>p[closed?((i%p.length)+p.length)%p.length:Math.max(0,Math.min(p.length-1,i))];
    let d=`M${f(p[0].x)} ${f(p[0].y)}`;
    const last=closed?p.length:p.length-1;
    for(let i=0;i<last;i++){
      const p0=at(i-1),p1=at(i),p2=at(i+1),p3=at(i+2);
      d+=`C${f(p1.x+(p2.x-p0.x)/6)} ${f(p1.y+(p2.y-p0.y)/6)},`
       + `${f(p2.x-(p3.x-p1.x)/6)} ${f(p2.y-(p3.y-p1.y)/6)},`
       + `${f(p2.x)} ${f(p2.y)}`;
    }
    return d+(closed?"Z":"");
  }

  const r=Math.max(0,Math.min(1,Number(corner)||0));
  if(r<=0.001){
    let d=`M${f(p[0].x)} ${f(p[0].y)}`;
    for(let i=1;i<p.length;i++)d+=`L${f(p[i].x)} ${f(p[i].y)}`;
    return d+(closed?"Z":"");
  }

  // Rounded corners. Open paths keep their true first and last vertex.
  const len=(a,b)=>Math.hypot(b.x-a.x,b.y-a.y)||1e-6;
  const lerp=(a,b,t)=>({x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t});
  let d="", started=false;
  for(let i=0;i<p.length;i++){
    const v=p[i];
    const prev=p[(i-1+p.length)%p.length], next=p[(i+1)%p.length];
    const edge=!closed&&(i===0||i===p.length-1);
    if(edge){
      d+=(started?"L":"M")+f(v.x)+" "+f(v.y); started=true; continue;
    }
    const cut=Math.min(len(v,prev),len(v,next))/2*r;
    const a=lerp(v,prev,cut/len(v,prev)), b=lerp(v,next,cut/len(v,next));
    d+=(started?"L":"M")+f(a.x)+" "+f(a.y);
    d+=`Q${f(v.x)} ${f(v.y)},${f(b.x)} ${f(b.y)}`;
    started=true;
  }
  return d+(closed?"Z":"");
}

function renderFreeform(el,{live=false}={}){
  const box=document.createElement("div");
  box.className="freeform-box";
  box.style.cssText="position:absolute;inset:0;";
  const S=svg("svg",{viewBox:"0 0 100 100",preserveAspectRatio:"none",class:"freeform-svg"});
  S.style.cssText="position:absolute;inset:0;width:100%;height:100%;overflow:visible;display:block";

  const mode=el.fillMode||"solid";
  let fill=el.fill||"#e8482b";
  if(mode==="none")fill="none";
  if(mode==="linear"||mode==="radial"){
    // The gradient id has to be unique per element or two shapes on one
    // slide fight over it and the second wins for both.
    const gid="ffg-"+String(el.id||Math.random().toString(36).slice(2));
    const defs=svg("defs",{});
    let g;
    if(mode==="linear"){
      const a=((Number(el.gradAngle)||0)-90)*Math.PI/180;
      g=svg("linearGradient",{id:gid,
        x1:(50-Math.cos(a)*50)+"%", y1:(50-Math.sin(a)*50)+"%",
        x2:(50+Math.cos(a)*50)+"%", y2:(50+Math.sin(a)*50)+"%"});
    }else{
      g=svg("radialGradient",{id:gid,cx:"50%",cy:"50%",r:"62%"});
    }
    g.appendChild(svg("stop",{offset:"0%","stop-color":el.fill||"#e8482b"}));
    g.appendChild(svg("stop",{offset:"100%","stop-color":el.fill2||"#f2c14e"}));
    defs.appendChild(g);S.appendChild(defs);
    fill="url(#"+gid+")";
  }

  const d=freeformPath(freeformPoints(el),{
    closed:el.closed!==false, corner:el.corner, smooth:!!el.smooth,
  });
  const path=svg("path",{d,class:"freeform-path"});
  path.setAttribute("fill",fill);
  path.setAttribute("vector-effect","non-scaling-stroke");
  if(el.stroke&&el.stroke!=="none"&&Number(el.strokeW)>0){
    path.setAttribute("stroke",el.stroke);
    path.setAttribute("stroke-width",String(Number(el.strokeW)||0));
    path.setAttribute("stroke-linejoin","round");
    path.setAttribute("stroke-linecap","round");
    if(Number(el.dash)>0)path.setAttribute("stroke-dasharray",String(Number(el.dash)*2)+" "+String(Number(el.dash)));
  }
  S.appendChild(path);
  box.appendChild(S);
  return box;
}

/* ── universal effects ───────────────────────────────────────────────
   Read lazily off el.fx so nothing is written into every element's JSON
   until it is actually used — an untouched deck saves byte-for-byte the
   same as before. */
function elFx(el){
  const f=(el&&el.fx)||{};
  return {
    shadow:!!f.shadow,
    sx:Number(f.sx)||0, sy:Number(f.sy==null?6:f.sy), sblur:Number(f.sblur==null?14:f.sblur),
    scolor:f.scolor||"rgba(0,0,0,.38)",
    glow:!!f.glow, gsize:Number(f.gsize==null?12:f.gsize), gcolor:f.gcolor||"#7dd3fc",
    d3:!!f.d3, rx:Number(f.rx)||0, ry:Number(f.ry)||0, persp:Number(f.persp==null?900:f.persp),
    depth:Number(f.depth)||0, dcolor:f.dcolor||"rgba(0,0,0,.55)",
    blur:Number(f.blur)||0, bright:Number(f.bright==null?100:f.bright),
    sat:Number(f.sat==null?100:f.sat), contrast:Number(f.contrast==null?100:f.contrast),
    hue:Number(f.hue)||0,
    blend:f.blend||"normal", flipH:!!f.flipH, flipV:!!f.flipV,
  };
}
function hasFx(el){
  const f=(el&&el.fx)||{};
  for(const k in f){
    const v=f[k];
    if(v===true)return true;
    if(typeof v==="number"&&v!==0)return true;
    if(typeof v==="string"&&v&&v!=="normal")return true;
  }
  return (el&&el.opacity!=null&&Number(el.opacity)!==1);
}

/* Paint the effects onto the element's INNER box. Called for every
   element type, and a no-op for anything that has never been styled. */
function applyElFx(el,inner){
  if(!el||!inner||!hasFx(el))return;
  const f=elFx(el);

  // filter — shadow, glow and the extrude stack all ride here, because
  // drop-shadow follows the artwork's alpha and box-shadow follows its
  // rectangle. On a star, only one of those is the shape you drew.
  const filt=[];
  if(f.depth>0){
    // Fake thickness by stacking hard offset copies one pixel apart.
    // Capped: each shadow is a full extra raster pass.
    const steps=Math.min(24,Math.round(f.depth));
    for(let i=1;i<=steps;i++)filt.push(`drop-shadow(${i}px ${i}px 0 ${f.dcolor})`);
  }
  if(f.glow)filt.push(`drop-shadow(0 0 ${f.gsize}px ${f.gcolor})`);
  if(f.shadow)filt.push(`drop-shadow(${f.sx}px ${f.sy}px ${f.sblur}px ${f.scolor})`);
  if(f.blur>0)filt.push(`blur(${f.blur}px)`);
  if(f.bright!==100)filt.push(`brightness(${f.bright}%)`);
  if(f.contrast!==100)filt.push(`contrast(${f.contrast}%)`);
  if(f.sat!==100)filt.push(`saturate(${f.sat}%)`);
  if(f.hue)filt.push(`hue-rotate(${f.hue}deg)`);
  if(filt.length)inner.style.filter=filt.join(" ");

  // transform — 3-D lean and flips. The outer .el keeps its plain
  // rotate(), so selection handles and drag maths stay put.
  const tr=[];
  if(f.d3&&(f.rx||f.ry)){
    tr.push(`perspective(${Math.max(120,f.persp)}px)`);
    if(f.rx)tr.push(`rotateX(${f.rx}deg)`);
    if(f.ry)tr.push(`rotateY(${f.ry}deg)`);
  }
  if(f.flipH)tr.push("scaleX(-1)");
  if(f.flipV)tr.push("scaleY(-1)");
  if(tr.length){
    inner.style.transform=tr.join(" ");
    inner.style.transformOrigin="center center";
  }

  if(f.blend&&f.blend!=="normal")inner.style.mixBlendMode=f.blend;
  if(el.opacity!=null&&Number(el.opacity)!==1&&el.type!=="creative_shape"){
    inner.style.opacity=String(el.opacity);
  }
}

/* ════════════════════════════════════════════════════════════════════
   ZOOM REGIONS  ("focus")                                       v53
   ────────────────────────────────────────────────────────────────────
   A focus element is an AUTHORED marker, not a picture. You drop it in
   the editor over the part of the slide worth a closer look — a figure
   on a chart, one country on a map, a clause in a table — and size it
   like any other element. It renders nothing on the big screen.

   During the talk the phone controller lists the regions on the current
   slide. Tapping one lifts a MAGNIFIED VIEW of that region in front of
   the slide: the slide stays visible behind (dimmed), the region itself
   stays un-dimmed and ringed, and leader lines run from the region to
   the enlarged panel — the standard "detail callout" figure. Tapping
   again drops it. Nothing happens automatically; the presenter is
   always the trigger.

   HOW THE MAGNIFICATION WORKS
       The lens does not re-render the slide. It holds a CLONE of the
       live stage, scaled and offset so the marked region fills it. That
       means anything the renderer can draw — charts, maps, tables,
       galleries, actors — magnifies correctly with no per-type code,
       and elements still held back by reveal-on-cue stay hidden inside
       the lens too, because the clone inherits their held state.

   Geometry is all in the 960×540 design space, so the callout scales
   with the stage on any projector.
   ════════════════════════════════════════════════════════════════════ */

const FOCUS_SHAPES = [
  {key:"circle", label:"Circle"},
  {key:"rect",   label:"Rectangle"},
];
const FOCUS_PLACES = [
  {key:"auto",   label:"Auto"},
  {key:"left",   label:"Left"},
  {key:"right",  label:"Right"},
  {key:"top",    label:"Top"},
  {key:"bottom", label:"Bottom"},
  {key:"center", label:"Centre"},
];

function makeFocus(over={}){
  return elBase("focus",Object.assign({
    x:120,y:150,w:220,h:220,
    label:"Zoom in",
    focusShape:"circle",     // circle | rect
    zoom:2.4,                // how much bigger the callout is drawn
    place:"auto",            // where the callout sits: auto|left|right|top|bottom|center
    dim:0.55,                // how far the rest of the slide dims (0–0.9)
    accent:"#1d4e89",        // ring + leader line colour
    leaders:true,            // draw the connecting leader lines
    focusCaption:"",         // optional caption under the magnified panel
    anim:"zoom", animDelay:0,
    revealOn:"entry",        // never used — a focus marker is never painted live
  },over));
}

/* The marker as seen IN THE EDITOR. On a live stage it renders nothing:
   an empty, invisible, click-through node that only exists so the stage
   can look its geometry up by data-id.                                  */
function renderFocus(el,{live=false}={}){
  const box=document.createElement("div");
  const accent=el.accent||"#1d4e89";
  box.className="focus-marker";
  box.style.cssText="position:absolute;inset:0;pointer-events:none;";
  if(live){
    box.style.opacity="0";
    return box;
  }
  const round=(el.focusShape||"circle")==="circle";
  const ring=document.createElement("div");
  ring.style.cssText=
    "position:absolute;inset:0;border:2px dashed "+accent+";"
    +"border-radius:"+(round?"50%":"14px")+";"
    +"background:"+hexToRgba(accent,.08)+";box-sizing:border-box;";
  const tag=document.createElement("div");
  tag.style.cssText=
    "position:absolute;left:50%;top:-14px;transform:translateX(-50%);"
    +"white-space:nowrap;padding:3px 9px;border-radius:999px;"
    +"background:"+accent+";color:#fff;font:700 12px/1 Archivo,system-ui,sans-serif;"
    +"letter-spacing:.02em;box-shadow:0 4px 14px rgba(0,0,0,.28)";
  const z=Number(el.zoom)||2;
  tag.textContent="🔍 "+(el.label||"Zoom in")+" · "+z.toFixed(1)+"×";
  box.appendChild(ring);box.appendChild(tag);
  return box;
}

function focusElements(slide){
  return (((slide&&slide.els)||[]).filter(e=>e&&e.type==="focus"));
}

function hexToRgba(hex,a){
  const h=String(hex||"#1d4e89").replace("#","");
  const s=h.length===3?h.split("").map(c=>c+c).join(""):h;
  const n=parseInt(s.slice(0,6),16);
  if(!isFinite(n))return "rgba(29,78,137,"+a+")";
  return "rgba("+((n>>16)&255)+","+((n>>8)&255)+","+(n&255)+","+a+")";
}

/* ── overlay stylesheet ──────────────────────────────────────────────
   Injected from here rather than added to hanns.css so the callout works
   unchanged in the editor preview, the live stage, the phone preview and
   the standalone HTML export (which inlines this file and hanns.css but
   is otherwise on its own).                                            */
function ensureFocusCss(){
  if(document.getElementById("hanns-focus-css"))return;
  const st=document.createElement("style");
  st.id="hanns-focus-css";
  st.textContent=`
.hanns-focus{position:absolute;inset:0;z-index:900;pointer-events:none;overflow:hidden}
.hanns-focus .hf-svg{position:absolute;inset:0;width:100%;height:100%;display:block}
.hanns-focus .hf-lens{position:absolute;overflow:hidden;background:inherit;
  box-shadow:0 26px 70px rgba(0,0,0,.45),0 0 0 3px var(--hf-accent,#1d4e89);
  transform-origin:center center}
.hanns-focus .hf-lens.round{border-radius:50%}
.hanns-focus .hf-lens.boxy{border-radius:16px}
.hanns-focus .hf-lens-inner{position:absolute;width:960px;height:540px;
  transform-origin:0 0;pointer-events:none}
.hanns-focus .hf-lens-inner .handle,
.hanns-focus .hf-lens-inner .rot,
.hanns-focus .hf-lens-inner .focus-marker{display:none!important}
.hanns-focus .hf-cap{position:absolute;left:50%;transform:translateX(-50%);
  white-space:nowrap;max-width:92%;overflow:hidden;text-overflow:ellipsis;
  padding:6px 14px;border-radius:999px;color:#fff;
  font:700 15px/1.2 Archivo,system-ui,sans-serif;letter-spacing:.01em;
  background:var(--hf-accent,#1d4e89);box-shadow:0 10px 26px rgba(0,0,0,.35)}
`;
  (document.head||document.documentElement).appendChild(st);
}

/* Andrew monotone-chain hull — used to find the two leader lines that
   wrap a rectangular region and its rectangular callout. */
function convexHull(pts){
  const p=pts.slice().sort((a,b)=>a.x-b.x||a.y-b.y);
  if(p.length<3)return p;
  const cross=(o,a,b)=>(a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x);
  const lower=[];
  for(const q of p){while(lower.length>=2&&cross(lower[lower.length-2],lower[lower.length-1],q)<=0)lower.pop();lower.push(q);}
  const upper=[];
  for(let i=p.length-1;i>=0;i--){const q=p[i];
    while(upper.length>=2&&cross(upper[upper.length-2],upper[upper.length-1],q)<=0)upper.pop();upper.push(q);}
  lower.pop();upper.pop();
  return lower.concat(upper);
}

/* Where the magnified panel sits. "auto" takes the roomiest side. */
function focusLensBox(region,el){
  const M=18;                                  // margin from the slide edge
  const zoom=Math.max(1.1,Math.min(8,Number(el.zoom)||2.4));
  const place=el.place||"auto";
  const space={
    left:region.x-M, right:W-(region.x+region.w)-M,
    top:region.y-M,  bottom:H-(region.y+region.h)-M,
  };
  let side=place;
  if(side==="auto"){
    side=Object.keys(space).reduce((a,b)=>space[b]>space[a]?b:a,"right");
    if(space[side]<140)side="center";
  }
  // The panel never leaves the slide, so cap it by the room on that side.
  // Centre placement floats over the whole (dimmed) slide, so it is only
  // capped by the slide itself.
  const capW=side==="left"||side==="right"
    ? Math.max(160,space[side]-M) : (W-2*M);
  const capH=side==="top"||side==="bottom"
    ? Math.max(120,space[side]-M) : (H-2*M);
  let lw=Math.min(region.w*zoom, capW, W-2*M);
  let lh=Math.min(region.h*zoom, capH, H-2*M);
  if((el.focusShape||"circle")==="circle"){ lw=lh=Math.min(lw,lh); }

  // How much bigger the region actually ends up. A region that already
  // fills most of the slide has nowhere to grow into — there is no honest
  // way to enlarge 700px of a 960px slide and still show all of it. When
  // that happens the sided placement is not the problem, so try the centre
  // (the roomiest option) before giving up on the panel entirely.
  let k=Math.min(lw/region.w, lh/region.h);
  if(k<1.05 && side!=="center"){
    side="center";
    let cw=Math.min(region.w*zoom, W-2*M), ch=Math.min(region.h*zoom, H-2*M);
    if((el.focusShape||"circle")==="circle"){ cw=ch=Math.min(cw,ch); }
    const ck=Math.min(cw/region.w, ch/region.h);
    if(ck>k){ lw=cw; lh=ch; k=ck; }
  }
  // Still no room: fall back to a SPOTLIGHT — dim the slide and ring the
  // region, with no panel at all. "Look at this" without the lie of a
  // magnified view that is really the same size or smaller.
  const spotlight = k < 1.05;

  let cx, cy;
  if(side==="left")       { cx=Math.max(M+lw/2, (region.x-M)/2); cy=region.y+region.h/2; }
  else if(side==="right") { cx=Math.min(W-M-lw/2,(region.x+region.w+W)/2); cy=region.y+region.h/2; }
  else if(side==="top")   { cy=Math.max(M+lh/2,(region.y-M)/2); cx=region.x+region.w/2; }
  else if(side==="bottom"){ cy=Math.min(H-M-lh/2,(region.y+region.h+H)/2); cx=region.x+region.w/2; }
  else                    { cx=W/2; cy=H/2; }

  cx=Math.max(M+lw/2, Math.min(W-M-lw/2, cx));
  cy=Math.max(M+lh/2, Math.min(H-M-lh/2, cy));
  return {x:cx-lw/2, y:cy-lh/2, w:lw, h:lh, cx, cy, side, k, spotlight};
}

/* Build the dim mask, the region ring and the leader lines. */
function focusSvg(region,lens,el){
  const NS="http://www.w3.org/2000/svg";
  const round=(el.focusShape||"circle")==="circle";
  const accent=el.accent||"#1d4e89";
  const dim=Math.max(0,Math.min(.9,Number(el.dim)==null?.55:Number(el.dim)));
  const s=document.createElementNS(NS,"svg");
  s.setAttribute("class","hf-svg");
  s.setAttribute("viewBox","0 0 "+W+" "+H);
  s.setAttribute("preserveAspectRatio","none");

  // 1. Dim everything except the region itself (even-odd punches the hole).
  const rr=Math.min(region.w,region.h)/2;
  const hole=round
    ? "M"+(region.cx-rr)+" "+region.cy+"a"+rr+" "+rr+" 0 1 0 "+(2*rr)+" 0a"+rr+" "+rr+" 0 1 0 "+(-2*rr)+" 0Z"
    : "M"+region.x+" "+region.y+"h"+region.w+"v"+region.h+"h"+(-region.w)+"Z";
  const mask=document.createElementNS(NS,"path");
  mask.setAttribute("d","M0 0h"+W+"v"+H+"H0Z "+hole);
  mask.setAttribute("fill-rule","evenodd");
  mask.setAttribute("fill","#05070c");
  mask.setAttribute("opacity",String(dim));
  s.appendChild(mask);

  // 2. Leader lines, region ring → callout edge.
  if(el.leaders!==false && !lens.spotlight){
    let d="";
    if(round){
      const R=Math.min(lens.w,lens.h)/2;
      const dx=lens.cx-region.cx, dy=lens.cy-region.cy;
      const dist=Math.hypot(dx,dy);
      if(dist>Math.abs(R-rr)+2){
        const a=Math.atan2(dy,dx), b=Math.acos(Math.max(-1,Math.min(1,(R-rr)/dist)));
        [a+b,a-b].forEach(t=>{
          const p={x:region.cx+rr*Math.cos(t), y:region.cy+rr*Math.sin(t)};
          const q={x:lens.cx+R*Math.cos(t),   y:lens.cy+R*Math.sin(t)};
          d+="M"+p.x+" "+p.y+"L"+q.x+" "+q.y;
        });
      }
    }else{
      // Rect → rect: the two hull edges that bridge the two boxes.
      const A=[{x:region.x,y:region.y},{x:region.x+region.w,y:region.y},
               {x:region.x+region.w,y:region.y+region.h},{x:region.x,y:region.y+region.h}];
      const B=[{x:lens.x,y:lens.y},{x:lens.x+lens.w,y:lens.y},
               {x:lens.x+lens.w,y:lens.y+lens.h},{x:lens.x,y:lens.y+lens.h}];
      A.forEach(p=>p.g=0); B.forEach(p=>p.g=1);
      const hull=convexHull(A.concat(B));
      for(let i=0;i<hull.length;i++){
        const p=hull[i], q=hull[(i+1)%hull.length];
        if(p.g!==q.g) d+="M"+p.x+" "+p.y+"L"+q.x+" "+q.y;
      }
    }
    if(d){
      const path=document.createElementNS(NS,"path");
      path.setAttribute("d",d);
      path.setAttribute("stroke",accent);
      path.setAttribute("stroke-width","2");
      path.setAttribute("fill","none");
      path.setAttribute("opacity",".85");
      s.appendChild(path);
    }
  }

  // 3. The ring around the region on the slide.
  let ring;
  if(round){
    ring=document.createElementNS(NS,"circle");
    ring.setAttribute("cx",region.cx);ring.setAttribute("cy",region.cy);ring.setAttribute("r",rr);
  }else{
    ring=document.createElementNS(NS,"rect");
    ring.setAttribute("x",region.x);ring.setAttribute("y",region.y);
    ring.setAttribute("width",region.w);ring.setAttribute("height",region.h);
    ring.setAttribute("rx","10");
  }
  ring.setAttribute("fill","none");
  ring.setAttribute("stroke",accent);
  ring.setAttribute("stroke-width","3");
  s.appendChild(ring);
  return s;
}

/* Carry the CURRENT ON-SCREEN APPEARANCE across to the clone.

   cloneNode copies markup and inline styles but NOT Web Animations. That
   matters here because animateIn() writes ``style.opacity=0`` on an
   element and then relies on a fill:"both" animation to bring it back to
   1 — so a naive clone inherits the zero and nothing else, and the
   magnified panel comes up empty. Copying the COMPUTED value of the few
   properties entrances touch reproduces whatever the room is actually
   looking at, including elements caught mid-animation.

   Only nodes that carry an animation are touched, so this stays cheap.
   Nodes driven by looping CSS keyframes (idle actors, moving backgrounds)
   re-run in the clone and override the inline value we set, which is the
   behaviour we want. Held cue elements have no animation and keep their
   zero — they stay hidden inside the lens too, exactly as on the stage.

   <canvas> is a separate problem: a cloned canvas is always blank, so its
   bitmap is blitted across. */
function freezeClone(src,dst){
  let a,b;
  try{ a=src.querySelectorAll("*"); b=dst.querySelectorAll("*"); }catch(e){ return; }
  const n=Math.min(a.length,b.length);
  for(let i=0;i<n;i++){
    const s=a[i], d=b[i];
    if(s.tagName==="CANVAS"&&d.tagName==="CANVAS"&&s.width&&s.height){
      try{ d.width=s.width; d.height=s.height;
           d.getContext("2d").drawImage(s,0,0); }catch(e){}
    }
    let anims=null;
    try{ anims=s.getAnimations?s.getAnimations():null; }catch(e){ anims=null; }
    if(!anims||!anims.length)continue;
    let cs;
    try{ cs=getComputedStyle(s); }catch(e){ continue; }
    d.style.opacity=cs.opacity;
    if(cs.transform&&cs.transform!=="none")d.style.transform=cs.transform;
    if(cs.filter&&cs.filter!=="none")d.style.filter=cs.filter;
    const cp=cs.clipPath||cs.webkitClipPath;
    if(cp&&cp!=="none")d.style.clipPath=cp;
  }
}

/* A frozen copy of everything currently on the stage, minus the overlay
   itself and minus anything that would misbehave when duplicated. */
function focusClone(stage){
  const c=stage.cloneNode(true);
  // Freeze FIRST, while the two trees still match node for node.
  freezeClone(stage,c);
  c.querySelectorAll(".hanns-focus").forEach(n=>n.remove());
  c.querySelectorAll("script").forEach(n=>n.remove());
  c.querySelectorAll("video,audio").forEach(n=>{
    try{n.pause&&n.pause();}catch(e){}
    n.removeAttribute("autoplay");n.muted=true;n.controls=false;
  });
  c.querySelectorAll("iframe").forEach(n=>n.remove());
  c.style.position="absolute";c.style.left="0";c.style.top="0";
  c.style.width=W+"px";c.style.height=H+"px";
  c.style.transform="";c.style.margin="0";
  c.classList.remove("zoomed");
  c.removeAttribute("id");
  return c;
}

/* Lift the magnified callout onto `stage` for the focus element `el`.
   Returns the overlay node, or null when the element is not a region. */
function showFocus(stage,el,{animate=true}={}){
  if(!stage||!el||el.type!=="focus")return null;
  ensureFocusCss();
  hideFocus(stage,{instant:true});

  // The overlay is positioned against the stage, so the stage has to be a
  // positioning context. The editor canvas and the present wrapper both
  // already are; a bare container (a thumbnail, an export shell) may not.
  try{
    if(getComputedStyle(stage).position==="static")stage.style.position="relative";
  }catch(e){}

  const region={
    x:Number(el.x)||0, y:Number(el.y)||0,
    w:Math.max(24,Number(el.w)||120), h:Math.max(24,Number(el.h)||120),
  };
  region.cx=region.x+region.w/2; region.cy=region.y+region.h/2;
  const lens=focusLensBox(region,el);
  const accent=el.accent||"#1d4e89";
  const round=(el.focusShape||"circle")==="circle";

  const wrap=document.createElement("div");
  wrap.className="hanns-focus";
  wrap.dataset.focusId=String(el.id==null?"":el.id);
  wrap.style.setProperty("--hf-accent",accent);
  wrap.appendChild(focusSvg(region,lens,el));

  if(lens.spotlight){
    // Region too big to magnify — the ring and the dim carry the point.
    stage.appendChild(wrap);
    if(animate&&wrap.animate){
      try{wrap.animate([{opacity:0},{opacity:1}],
        {duration:380,easing:"ease-out",fill:"both"});}catch(e){}
    }
    return wrap;
  }

  const box=document.createElement("div");
  box.className="hf-lens "+(round?"round":"boxy");
  box.style.left=lens.x+"px";box.style.top=lens.y+"px";
  box.style.width=lens.w+"px";box.style.height=lens.h+"px";
  box.style.background=(stage.style.background||"#f6f1e7");

  // The clone is scaled so the whole marked region fits the panel.
  const k=Math.min(lens.w/region.w, lens.h/region.h);
  const inner=document.createElement("div");
  inner.className="hf-lens-inner";
  inner.style.left=((lens.w-region.w*k)/2)+"px";
  inner.style.top=((lens.h-region.h*k)/2)+"px";
  inner.style.transform="scale("+k+") translate("+(-region.x)+"px,"+(-region.y)+"px)";
  inner.appendChild(focusClone(stage));
  box.appendChild(inner);
  wrap.appendChild(box);

  const capText=String(el.focusCaption||"").trim();
  if(capText){
    const cap=document.createElement("div");
    cap.className="hf-cap";
    cap.textContent=capText;
    // Below the panel, or above it when the panel is already near the floor.
    if(lens.y+lens.h+46<H) cap.style.top=(lens.y+lens.h+12)+"px";
    else cap.style.top=Math.max(8,lens.y-44)+"px";
    cap.style.left=lens.cx+"px";
    wrap.appendChild(cap);
  }

  stage.appendChild(wrap);

  if(animate&&box.animate){
    // Grow out of the region it came from, so the eye follows the jump.
    const sx=Math.max(.08,region.w/lens.w), sy=Math.max(.08,region.h/lens.h);
    const s0=round?Math.min(sx,sy):Math.min(sx,sy);
    const tx=region.cx-lens.cx, ty=region.cy-lens.cy;
    try{
      box.animate(
        [{transform:"translate("+tx+"px,"+ty+"px) scale("+s0+")",opacity:0},
         {transform:"translate(0,0) scale(1)",opacity:1}],
        {duration:520,easing:"cubic-bezier(.22,1,.36,1)",fill:"both"});
      wrap.querySelector(".hf-svg").animate([{opacity:0},{opacity:1}],
        {duration:380,easing:"ease-out",fill:"both"});
    }catch(e){}
  }
  return wrap;
}

function hideFocus(stage,{instant=false}={}){
  if(!stage)return;
  stage.querySelectorAll(".hanns-focus").forEach(n=>{
    if(instant||!n.animate){n.remove();return;}
    try{
      const a=n.animate([{opacity:1},{opacity:0}],{duration:260,easing:"ease-in",fill:"both"});
      a.onfinish=()=>n.remove();
      setTimeout(()=>{if(n.parentNode)n.remove();},400);
    }catch(e){n.remove();}
  });
}

function activeFocusId(stage){
  const n=stage&&stage.querySelector(".hanns-focus");
  return n?(n.dataset.focusId||null):null;
}

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
function newSlide(over={}){return Object.assign({id:uid(),bg:BACKGROUNDS[0].css,bgSize:null,bgFx:"none",transition:"fade",notes:"",els:[]},over);}
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

function renderCreativeShape(el){
  const def=shapeDef(el.shapeType);
  const box=document.createElement("div");box.className="creative-shape-box";
  box.style.setProperty("--shape-fill",el.fill||def.accent||"#e8482b");
  box.style.setProperty("--shape-stroke",el.stroke&&el.stroke!=="none"?el.stroke:"transparent");
  box.style.setProperty("--shape-stroke-w",Number(el.strokeW)||0);
  box.style.opacity=String(el.opacity==null?1:el.opacity);
  const S=svg("svg",{viewBox:"0 0 100 100",preserveAspectRatio:"none",class:"creative-shape-svg"});
  const p=svg("path",{d:def.d,class:"creative-shape-path"});
  S.appendChild(p);box.appendChild(S);return box;
}

function renderElement(el,{live=false}={}){
  const node=document.createElement("div");
  node.className="el "+el.type;
  node.dataset.id=el.id;
  styleEl(el,node);
  // Cue-held elements stay fully visible and selectable in the editor —
  // you cannot lay out what you cannot see. The outline marks them.
  if(el.revealOn==="cue"&&!live)node.classList.add("el-cued");
  const inner=document.createElement("div");inner.className="el-inner";

  if(el.type==="text"){
    const t=document.createElement("div");
    t.style.font=`${el.italic?"italic ":""}${el.weight} ${el.size}px/${el.lh} ${el.font}`;
    t.style.color=el.color;t.style.textAlign=el.align;t.style.letterSpacing=(el.ls||0)+"px";
    t.style.width="100%";t.style.whiteSpace="pre-wrap";
    if(el.fill&&el.fill!=="none"){node.style.background=el.fill;}
    t.textContent=el.text;
    if(!live){t.dataset.textInner="1";t.setAttribute("contenteditable","false");t.spellcheck=false;}
    inner.appendChild(t);
  } else if(el.type==="rect"||el.type==="ellipse"){
    const s=document.createElement("div");s.className="shape";
    s.style.background=el.fill;s.style.borderRadius=el.type==="ellipse"?"50%":(el.radius||0)+"px";
    if(el.stroke&&el.stroke!=="none"&&el.strokeW)s.style.border=`${el.strokeW}px ${el.dashed?"dashed":"solid"} ${el.stroke}`;
    inner.appendChild(s);
  } else if(el.type==="line"){
    const s=document.createElement("div");s.className="shape";
    if(el.dashed){
      const c=el.fill||"#94a3b8";
      const vert=(Number(el.h)||0) > (Number(el.w)||0);
      const ang=vert?"0deg":"90deg";
      s.style.background=`repeating-linear-gradient(${ang}, ${c} 0 8px, transparent 8px 16px)`;
      s.style.borderRadius="0";
    } else {
      s.style.background=el.fill;s.style.borderRadius="999px";
    }
    inner.appendChild(s);
  } else if(el.type==="image"){
    const im=document.createElement("div");im.className="imgbox"+(el.src?"":" placeholder");
    if(el.src){im.style.backgroundImage=`url("${el.src}")`;im.style.backgroundSize=el.fit;}
    else im.textContent="🖼  click to add image";
    im.style.borderRadius=(el.radius||0)+"px";
    inner.appendChild(im);
  } else if(el.type==="video"){
    inner.appendChild(renderVideo(el,{live}));
  } else if(el.type==="gallery"){
    inner.appendChild(renderGallery(el,{live}));
  } else if(el.type==="link"){
    inner.appendChild(renderLink(el,{live}));
  } else if(el.type==="table"){
    inner.appendChild(renderTable(el));
  } else if(el.type==="chart"){
    inner.appendChild(renderChart(el));
  } else if(el.type==="map"){
    inner.appendChild(renderMap(el));
  } else if(el.type==="object"){
    if(el.objectType==="teleprompter"){
      // Presenter-only: the speech lives in el.script and is read on the phone
      // controller. On the audience/live stage it renders nothing; in the
      // editor it shows a labelled placeholder so it can be selected & moved.
      inner.appendChild(renderTeleprompter(el,{live}));
    } else {
      inner.appendChild(renderObject(el));
    }
  } else if(el.type==="creative_shape"){
    inner.appendChild(renderCreativeShape(el));
  } else if(el.type==="freeform"){
    inner.appendChild(renderFreeform(el,{live}));
  } else if(el.type==="focus"){
    // A zoom region: a dashed marker while authoring, nothing at all on
    // the live stage until the presenter calls it up from the phone.
    node.classList.add("el-focus");
    if(live){node.style.pointerEvents="none";}
    inner.appendChild(renderFocus(el,{live}));
  } else if(el.type==="group"){
    inner.classList.add("group-inner");
    const box=document.createElement("div");
    box.className="group-box";
    (Array.isArray(el.children)?el.children:[]).forEach(child=>{
      const cn=renderElement(child,{live:true});
      cn.classList.add("group-child");
      cn.removeAttribute("data-id");
      cn.style.pointerEvents="none";
      box.appendChild(cn);
    });
    inner.appendChild(box);
  }
  // Shadow / glow / 3-D / filters / blend — any element, any type.
  applyElFx(el,inner);

  node.appendChild(inner);

  if(!live){
    ["nw","ne","sw","se"].forEach(p=>{const h=document.createElement("div");h.className="handle "+p;h.dataset.handle=p;node.appendChild(h);});
    const r=document.createElement("div");r.className="rot";r.dataset.handle="rot";node.appendChild(r);
  }
  return node;
}



function escHTML(s){return String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));}
function normTableData(el){
  const src=Array.isArray(el.tableData)&&el.tableData.length?el.tableData:[["Item","Value"],["A","10"],["B","20"]];
  const rows=Math.max(Number(el.rows)||src.length,src.length,1);
  const cols=Math.max(Number(el.cols)||Math.max(...src.map(r=>Array.isArray(r)?r.length:1)),1);
  const out=[];
  for(let r=0;r<rows;r++){
    const row=Array.isArray(src[r])?src[r]:[];
    out.push(Array.from({length:cols},(_,c)=>String(row[c]??"")));
  }
  return out;
}
function renderTable(el){
  const box=document.createElement("div");box.className="data-table data-table-"+(el.theme||"clean");
  box.style.setProperty("--accent",el.accent||el.headerColor||"#1d4e89");
  box.style.setProperty("--table-header-bg",el.headerColor||el.accent||"#1d4e89");
  box.style.setProperty("--table-header-color",el.headerTextColor||"#ffffff");
  box.style.setProperty("--table-text-color",el.textColor||"#16140f");
  box.style.setProperty("--table-border",el.borderColor||"rgba(22,20,15,.12)");
  box.style.setProperty("--table-row-alt",el.rowAltColor||"rgba(29,78,137,.055)");
  const data=normTableData(el);
  const table=document.createElement("table");
  if(el.striped!==false)table.classList.add("striped");
  data.forEach((row,ri)=>{
    const tr=document.createElement("tr");
    row.forEach(cell=>{
      const tag=(el.header!==false&&ri===0)?"th":"td";
      const td=document.createElement(tag);td.textContent=cell;
      td.style.fontFamily=el.font||'"Archivo",sans-serif';td.style.fontSize=(el.size||18)+"px";
      td.style.color=tag==="th"?(el.headerTextColor||"#ffffff"):(el.textColor||"#16140f");
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
  box.appendChild(table);return box;
}
function chartData(el){
  let d=Array.isArray(el.chartData)&&el.chartData.length?el.chartData:[{label:"A",value:10,series:[10,7,4]},{label:"B",value:20,series:[20,12,8]},{label:"C",value:15,series:[15,10,5]}];
  if(el.sortOrder==="asc"||el.sortOrder==="desc"){
    d=d.slice().sort((a,b)=>el.sortOrder==="asc"?(Number(a.value)||0)-(Number(b.value)||0):(Number(b.value)||0)-(Number(a.value)||0));
  }
  return d.map((r,i)=>({
    label:String(r.label??("Item "+(i+1))),
    value:Number(r.value)||0,
    x:Number(r.x)||i+1,
    y:Number(r.y)||Number(r.value)||0,
    size:Number(r.size)||Math.max(8,Number(r.value)||12),
    series:Array.isArray(r.series)?r.series.map(Number).filter(v=>!Number.isNaN(v)):[]
  }));
}
function svg(tag,attrs={},children=[]){
  const n=document.createElementNS("http://www.w3.org/2000/svg",tag);
  Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,String(v)));
  children.forEach(c=>n.appendChild(c));return n;
}
function svgText(x,y,text,attrs={}){const t=svg("text",Object.assign({x,y},attrs));t.textContent=text;return t;}
function polar(cx,cy,r,a){return [cx+r*Math.cos(a),cy+r*Math.sin(a)];}

function plotlyPalette(el){ return chartPalette(el); }
function plotlyTheme(el){
  const dark = el.chartThemeMode === "dark";
  return {
    paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)",
    font:{family:"Inter, Archivo, Arial, sans-serif", size:Math.max(12, Number(el.labelSize||20)*0.62), color:dark?"#f8fafc":"#111827"},
    margin:{l:52,r:26,t:56,b:48},
    title:{text:el.title||"Chart", font:{size:Math.max(18, Number(el.labelSize||26)*0.82), color:el.titleColor || (dark?"#ffffff":"#111827")}},
    showlegend:!!el.showLegend,
    xaxis:{gridcolor:dark?"rgba(255,255,255,.14)":"rgba(15,23,42,.12)", zerolinecolor:dark?"rgba(255,255,255,.2)":"rgba(15,23,42,.2)"},
    yaxis:{gridcolor:dark?"rgba(255,255,255,.14)":"rgba(15,23,42,.12)", zerolinecolor:dark?"rgba(255,255,255,.2)":"rgba(15,23,42,.2)"},
  };
}
function plotlyChartSpec(el){
  const data = chartData(el), kind = el.chartKind || "bar", pal = plotlyPalette(el);
  const labels = data.map(d=>d.label), vals = data.map(d=>d.value);
  const layout = plotlyTheme(el); let traces=[];
  const vFmt = (v)=>fmtVal(v,el);
  if(kind==="pie" || kind==="donut"){
    traces=[{type:"pie", labels, values:vals, hole:kind==="donut"?.48:0, marker:{colors:pal}, textinfo:el.showValues===false?"label":"label+percent", hovertemplate:"%{label}: %{value}<extra></extra>"}];
    Object.assign(layout,{margin:{l:20,r:20,t:56,b:20}, showlegend:true});
  } else if(kind==="line" || kind==="spline" || kind==="area"){
    const showV = el.showValues!==false;
    traces=[{type:"scatter", mode:showV?"lines+markers+text":"lines+markers", x:labels, y:vals, text:showV?vals.map(vFmt):undefined, textposition:"top center", textfont:{size:Math.max(11,Number(el.labelSize||20)*0.55)}, fill:kind==="area"?"tozeroy":"none", line:{color:pal[0], width:4, shape:kind==="spline"?"spline":"linear"}, marker:{size:9, color:pal[0]}, hovertemplate:"%{x}: %{y}<extra></extra>"}];
  } else if(kind==="lollipop"){
    traces=[
      {type:"bar", x:labels, y:vals, width:0.06, marker:{color:pal[0]}, hoverinfo:"skip", showlegend:false},
      {type:"scatter", mode:el.showValues===false?"markers":"markers+text", x:labels, y:vals, text:vals.map(vFmt), textposition:"top center", marker:{size:16, color:pal}, hovertemplate:"%{x}: %{y}<extra></extra>", showlegend:false}
    ];
  } else if(kind==="pareto"){
    const total=Math.max(1,vals.reduce((a,b)=>a+b,0));let run=0;const cum=vals.map(v=>{run+=v;return Math.round(run/total*100);});
    traces=[
      {type:"bar", x:labels, y:vals, marker:{color:pal}, text:el.showValues===false?undefined:vals.map(vFmt), textposition:"auto", name:"Value"},
      {type:"scatter", mode:"lines+markers+text", x:labels, y:cum, yaxis:"y2", text:cum.map(c=>c+"%"), textposition:"top center", line:{color:pal[3]||"#f59e0b", width:3}, marker:{size:8}, name:"Cumulative %"}
    ];
    layout.yaxis2={overlaying:"y", side:"right", range:[0,110], showgrid:false, ticksuffix:"%"};
    layout.showlegend=true;
  } else if(kind==="combo"){
    const lineVals=data.map((d,i)=>{if(d.series&&d.series.length)return Number(d.series[0])||0;const a=vals[Math.max(0,i-1)],b=vals[i],c=vals[Math.min(vals.length-1,i+1)];return Math.round((a+b+c)/3);});
    traces=[
      {type:"bar", x:labels, y:vals, marker:{color:pal[0]}, text:el.showValues===false?undefined:vals.map(vFmt), textposition:"auto", name:(el.seriesNames&&el.seriesNames[0])||"Value"},
      {type:"scatter", mode:"lines+markers", x:labels, y:lineVals, line:{color:pal[1]||"#22c55e", width:3}, marker:{size:8}, name:(el.seriesNames&&el.seriesNames[1])||"Trend"}
    ];
    layout.showlegend=true;
  } else if(kind==="pyramid"){
    traces=[{type:"funnelarea", text:labels, values:vals, marker:{colors:pal}, textinfo:el.showValues===false?"text":"text+value"}];
    Object.assign(layout,{margin:{l:20,r:20,t:58,b:20}, showlegend:false});
  } else if(kind==="polarArea"){
    traces=[{type:"barpolar", r:vals, theta:labels, marker:{color:pal.slice(0,Math.max(1,vals.length))}, hovertemplate:"%{theta}: %{r}<extra></extra>"}];
    Object.assign(layout,{polar:{bgcolor:"rgba(0,0,0,0)", radialaxis:{visible:true, gridcolor:"rgba(148,163,184,.3)"}}, showlegend:false, margin:{l:38,r:38,t:58,b:34}});
  } else if(kind==="scatter" || kind==="bubble"){
    traces=[{type:"scatter", mode:"markers+text", x:data.map(d=>d.x), y:data.map(d=>d.y), text:labels, textposition:"top center", marker:{color:pal[0], size:kind==="bubble"?data.map(d=>Math.max(14, Math.min(64, d.size))):14, opacity:.82, line:{color:"rgba(255,255,255,.72)", width:1.5}}, hovertemplate:"%{text}<br>x=%{x}<br>y=%{y}<extra></extra>"}];
  } else if(kind==="horizontalBar"){
    traces=[{type:"bar", orientation:"h", y:labels, x:vals, marker:{color:pal}, text:el.showValues===false?undefined:vals.map(vFmt), textposition:"auto", hovertemplate:"%{y}: %{x}<extra></extra>"}];
    layout.margin.l = 92;
  } else if(kind==="groupedBar" || kind==="stackedBar"){
    const maxSeries = Math.max(1, ...data.map(d=>(d.series&&d.series.length)||0));
    const names = (Array.isArray(el.seriesNames)&&el.seriesNames.length?el.seriesNames:[]);
    traces = Array.from({length:Math.min(6,maxSeries||3)}, (_,j)=>({
      type:"bar", name:names[j] || `Series ${j+1}`, x:labels, y:data.map(d=>(d.series&&d.series[j]!=null)?Number(d.series[j]):(j===0?d.value:0)), marker:{color:pal[j%pal.length]}, hovertemplate:"%{x}: %{y}<extra></extra>"
    }));
    layout.barmode = kind==="stackedBar"?"stack":"group"; layout.showlegend = true;
  } else if(kind==="radar"){
    traces=[{type:"scatterpolar", r:vals, theta:labels, fill:"toself", line:{color:pal[0], width:4}, marker:{color:pal[0]}}];
    Object.assign(layout,{polar:{bgcolor:"rgba(0,0,0,0)", radialaxis:{visible:true, gridcolor:"rgba(148,163,184,.3)"}}, showlegend:false, margin:{l:38,r:38,t:58,b:34}});
  } else if(kind==="gauge" || kind==="progress" || kind==="kpi"){
    const v = vals[0] || 0;
    traces=[{type:"indicator", mode:kind==="kpi"?"number+delta":"gauge+number", value:v, number:{suffix:el.valueSuffix||el.unit||"", prefix:el.valuePrefix||"", font:{size:52}}, gauge:{axis:{range:[0, Number(el.max)||100]}, bar:{color:pal[0]}, bgcolor:"rgba(148,163,184,.15)", borderwidth:0, steps:[{range:[0,(Number(el.max)||100)*.55],color:"rgba(148,163,184,.18)"},{range:[(Number(el.max)||100)*.55,Number(el.max)||100],color:"rgba(34,197,94,.16)"}]}}];
    Object.assign(layout,{margin:{l:24,r:24,t:62,b:24}});
  } else if(kind==="funnel"){
    traces=[{type:"funnel", y:labels, x:vals, marker:{color:pal}, textinfo:el.showValues===false?"label":"value+percent previous"}];
  } else if(kind==="waterfall"){
    traces=[{type:"waterfall", x:labels, y:vals, measure:data.map((_,i)=>i===data.length-1?"total":"relative"), connector:{line:{color:"rgba(148,163,184,.55)"}}, increasing:{marker:{color:pal[1]}}, decreasing:{marker:{color:pal[5]||"#ef4444"}}, totals:{marker:{color:pal[0]}}}];
  } else if(kind==="heatmap"){
    const n=Math.max(2, Math.ceil(Math.sqrt(data.length))); let z=[]; for(let r=0;r<n;r++){z.push([]);for(let c=0;c<n;c++){z[r].push(data[r*n+c]?.value || 0);}}
    traces=[{type:"heatmap", z, colorscale:[[0,pal[2]],[.5,pal[3]],[1,pal[0]]], hoverongaps:false}];
  } else if(kind==="treemap"){
    traces=[{type:"treemap", labels, parents:labels.map(()=>""), values:vals, marker:{colors:pal}, textinfo:"label+value"}];
    Object.assign(layout,{margin:{l:10,r:10,t:58,b:10}});
  } else {
    traces=[{type:"bar", x:labels, y:vals, marker:{color:pal}, text:el.showValues===false?undefined:vals.map(vFmt), textposition:"auto", hovertemplate:"%{x}: %{y}<extra></extra>"}];
  }
  return {traces, layout, config:{responsive:true, displayModeBar:!!el.plotlyModebar, displaylogo:false, modeBarButtonsToRemove:["lasso2d","select2d"]}};
}
function renderPlotlyChart(el){
  const box=document.createElement("div"); box.className="plotly-box"+(el.chartThemeMode==="dark"?" plotly-dark":"");
  const target=document.createElement("div"); target.className="plotly-target"; box.appendChild(target);
  const snapshot=JSON.parse(JSON.stringify(el||{}));
  setTimeout(()=>{
    if(!target.isConnected || !window.Plotly) return;
    const {traces,layout,config}=plotlyChartSpec(snapshot);
    window.Plotly.newPlot(target,traces,layout,config).then(()=>{
      try{ window.Plotly.Plots.resize(target); }catch(e){}
    }).catch(()=>{});
    if(window.ResizeObserver){ const ro=new ResizeObserver(()=>{try{window.Plotly.Plots.resize(target);}catch(e){}}); ro.observe(target); }
  },0);
  return box;
}

function validAreaPoint(pt){return Array.isArray(pt)&&pt.length>=2&&Number.isFinite(Number(pt[0]))&&Number.isFinite(Number(pt[1]));}
function normaliseAreaRing(coords){
  const ring=(Array.isArray(coords)?coords:[]).filter(validAreaPoint).map(p=>[Number(p[0]),Number(p[1])]);
  if(ring.length<3) return [];
  const a=ring[0], b=ring[ring.length-1];
  if(a[0]!==b[0]||a[1]!==b[1]) ring.push([a[0],a[1]]);
  return ring;
}
function mapAreas(el){
  return (Array.isArray(el.areas)?el.areas:[]).map((a,i)=>{
    const ring=normaliseAreaRing(a.coordinates||a.coords||a.points||[]);
    if(ring.length<4) return null;
    return {
      label:a.label||a.name||`Area ${i+1}`,
      value:a.value==null?"":a.value,
      coordinates:ring,
      fill:a.fill||el.areaFill||el.accent||"#e8482b",
      stroke:a.stroke||el.areaStroke||"#ffffff",
      fillOpacity:Math.max(0,Math.min(1,Number(a.fillOpacity ?? el.areaOpacity ?? .42)))
    };
  }).filter(Boolean);
}
function hexToRgba(hex, opacity){
  const raw=String(hex||"#e8482b").replace("#","").trim();
  const v=raw.length===3?raw.split("").map(c=>c+c).join(""):raw;
  const n=parseInt(v,16);
  if(!Number.isFinite(n)) return `rgba(232,72,43,${opacity})`;
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${opacity})`;
}

function plotlyMapSpec(el, geo){
  const pins = (Array.isArray(el.pins)&&el.pins.length?el.pins:(geo.cities||[]).map(c=>({label:c.label,lon:c.lon,lat:c.lat,value:""}))).filter(p=>p.lon!=null&&p.lat!=null);
  const dark = el.mapTheme === "dark";
  const areaTraces=mapAreas(el).map(a=>({type:"scattergeo",mode:"lines",lon:a.coordinates.map(p=>p[0]),lat:a.coordinates.map(p=>p[1]),fill:"toself",fillcolor:hexToRgba(a.fill,a.fillOpacity),line:{color:a.stroke,width:2},name:a.label,text:a.coordinates.map(()=>a.label),hovertemplate:`${a.label}${a.value!==""?"<br>Value: "+a.value:""}<extra></extra>`}));
  const trace={type:"scattergeo", mode:"markers+text", lon:pins.map(p=>Number(p.lon)), lat:pins.map(p=>Number(p.lat)), text:pins.map(p=>p.label||"Pin"), textposition:"top center", marker:{size:pins.map(p=>Math.max(10, Math.min(34, Number(p.value)||16))), color:el.accent||"#2f6f4f", opacity:.85, line:{color:"white", width:1}}, hovertemplate:"%{text}<br>%{lat:.2f}, %{lon:.2f}<extra></extra>"};
  const [minLon,minLat,maxLon,maxLat]=geo.bounds;
  return {traces:[...areaTraces,trace], layout:{paper_bgcolor:"rgba(0,0,0,0)", plot_bgcolor:"rgba(0,0,0,0)", margin:{l:0,r:0,t:46,b:0}, title:{text:el.title||geo.name+" map", font:{size:24,color:el.titleColor||(dark?"#fff":"#111827")}}, font:{family:"Inter, Archivo, sans-serif", color:dark?"#fff":"#111827"}, geo:{scope:el.mapKind==="world"?"world":(el.mapKind==="europe"?"europe":"africa"), projection:{type:"natural earth"}, lonaxis:{range:[minLon,maxLon]}, lataxis:{range:[minLat,maxLat]}, showland:true, landcolor:dark?"rgba(31,41,55,.92)":"#e2e8f0", showocean:true, oceancolor:dark?"rgba(15,23,42,.92)":"#dbeafe", showcountries:true, countrycolor:dark?"rgba(255,255,255,.18)":"rgba(15,23,42,.25)", showlakes:true, lakecolor:dark?"rgba(15,23,42,.9)":"#bfdbfe"}}, config:{responsive:true, displayModeBar:!!el.plotlyModebar, displaylogo:false}};
}
function renderPlotlyMap(el, geo){
  const box=document.createElement("div"); box.className="plotly-map-box"+(el.mapTheme==="dark"?" plotly-dark":"");
  const target=document.createElement("div"); target.className="plotly-target"; box.appendChild(target);
  const snapshot=JSON.parse(JSON.stringify(el||{}));
  setTimeout(()=>{ if(!target.isConnected || !window.Plotly) return; const spec=plotlyMapSpec(snapshot, geo); window.Plotly.newPlot(target,spec.traces,spec.layout,spec.config).then(()=>{try{window.Plotly.Plots.resize(target);}catch(e){}}).catch(()=>{}); if(window.ResizeObserver){const ro=new ResizeObserver(()=>{try{window.Plotly.Plots.resize(target);}catch(e){}}); ro.observe(target);} },0);
  return box;
}
function tileUrl(kind){
  if(kind==="dark") return "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
  if(kind==="light") return "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
  if(kind==="satellite") return "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
  // Use Carto Voyager for the OpenStreetMap option. It is based on OSM data,
  // but avoids the volunteer tile-server "Access blocked" issue from tile.openstreetmap.org.
  return "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
}
function renderFoliumMap(el, geo){
  const box=document.createElement("div"); box.className="folium-box"+(el.mapTheme==="dark"?" folium-dark":"");
  const title=document.createElement("div"); title.className="folium-title"; title.textContent=el.title||geo.name+" map"; if(el.titleColor) title.style.color=el.titleColor; box.appendChild(title);
  const target=document.createElement("div"); target.className="folium-target"; box.appendChild(target);
  const snapshot=JSON.parse(JSON.stringify(el||{}));
  setTimeout(()=>{
    if(!target.isConnected || !window.L) return;
    if(target._leaflet_id) return;
    const g = MAP_GEO[snapshot.mapKind] || geo;
    const center=[(g.bounds[1]+g.bounds[3])/2,(g.bounds[0]+g.bounds[2])/2];
    const map = window.L.map(target,{attributionControl:false,zoomControl:false,scrollWheelZoom:false,dragging:true,doubleClickZoom:false,boxZoom:false,keyboard:false,tap:false}).setView(center, Number(snapshot.zoom)|| (snapshot.mapKind==="gambia"?7:3));
    const tiles=window.L.tileLayer(tileUrl(snapshot.tileLayer||"osm"),{maxZoom:18});
    tiles.on("tileerror",()=>{try{map.removeLayer(tiles);window.L.tileLayer(tileUrl("light"),{maxZoom:18}).addTo(map);}catch(e){}});
    tiles.addTo(map);
    const b = [[g.bounds[1],g.bounds[0]],[g.bounds[3],g.bounds[2]]]; map.fitBounds(b,{padding:[18,18]});
    mapAreas(snapshot).forEach(a=>{
      const latlngs=a.coordinates.map(p=>[p[1],p[0]]);
      window.L.polygon(latlngs,{color:a.stroke,weight:2,fillColor:a.fill,fillOpacity:a.fillOpacity}).addTo(map)
        .bindPopup(`<b>${escHTML(a.label)}</b>${a.value!==""?"<br>Value: "+escHTML(String(a.value)):""}`);
    });
    const pins = snapshot.useCities && g.cities ? g.cities : (Array.isArray(snapshot.pins)?snapshot.pins:[]);
    pins.filter(p=>p.lon!=null&&p.lat!=null).forEach((p)=>{
      const html=`<div class="folium-pin" style="--accent:${snapshot.accent||"#2f6f4f"}"></div>`;
      const icon=window.L.divIcon({html, className:"folium-pin-wrap", iconSize:[28,28], iconAnchor:[14,14]});
      window.L.marker([Number(p.lat),Number(p.lon)],{icon}).addTo(map).bindPopup(`<b>${escHTML(p.label||"Pin")}</b>${p.value!=null&&p.value!==""?"<br>Value: "+escHTML(String(p.value)):""}`);
    });
    setTimeout(()=>map.invalidateSize(),220);
  },0);
  return box;
}

function renderChart(el){
  if((el.renderEngine||"svg") === "plotly" && window.Plotly) return renderPlotlyChart(el);
  const box=document.createElement("div");box.className="chart-box chart-"+(el.chartKind||"bar");
  box.style.setProperty("--accent",el.accent||"#e8482b");
  const palette=chartPalette(el);
  box.style.setProperty("--c0",palette[0]);box.style.setProperty("--c1",palette[1]);box.style.setProperty("--c2",palette[2]);
  box.style.setProperty("--c3",palette[3]);box.style.setProperty("--c4",palette[4]);box.style.setProperty("--c5",palette[5]);
  if(el.chartThemeMode==="dark")box.classList.add("chart-theme-dark");
  if(el.gridLines===false)box.classList.add("chart-nogrid");
  if(el.chartFrame==="none")box.classList.add("chart-bare");
  if(el.showTitle!==false && (el.title===undefined || (el.title||"").trim()!=="")){
    const title=document.createElement("div");title.className="chart-title";title.textContent=el.title||"Chart";
    if(el.titleColor)title.style.color=el.titleColor;
    box.appendChild(title);
  }
  const wrap=document.createElement("div");wrap.className="chart-svg-wrap";

  // ── KEY FIX: a coordinate space that MATCHES the element's pixel aspect
  // ratio, drawn with preserveAspectRatio "meet" (default). The old code
  // used a fixed 1000×520 viewBox stretched with preserveAspectRatio:none,
  // which squashed every <text> non-uniformly — that was the blurry text.
  // Now 1 SVG unit == 1 on-screen px (roughly), so text never distorts. */
  const VW=1000;
  const aspect=(Number(el.h)||330) / Math.max(1,(Number(el.w)||650));
  const VH=Math.round(clamp(VW*aspect,360,1400));   // viewBox height tracks the box
  const fs=Number(el.labelSize)||26;                 // user-controllable label size
  const showVals=el.showValues!==false;
  const S=svg("svg",{viewBox:`0 0 ${VW} ${VH}`,preserveAspectRatio:"xMidYMid meet"});
  S.style.setProperty("--fs",fs+"px");
  S.style.setProperty("--fs-sm",Math.round(fs*0.86)+"px");

  const data=chartData(el);const vals=data.map(d=>d.value);const max=Math.max(1,...vals,...data.flatMap(d=>d.series||[]))*1.15;
  const kind=el.chartKind||"bar";
  // margins scale a little with label size so big labels don't clip
  const left=Math.max(70,fs*2.6), right=44, top=30, bottom=Math.max(64,fs*2.4);
  const cw=VW-left-right, ch=VH-top-bottom;
  const axed=!["pie","donut","radar","gauge","treemap","funnel","kpi","progress","heatmap","polarArea","pyramid"].includes(kind);
  if(el.gridLines!==false && axed){
    const grid=svg("g",{class:"chart-grid"});
    for(let i=0;i<=4;i++){let y=top+ch*i/4;grid.appendChild(svg("line",{x1:left,y1:y,x2:VW-right,y2:y}));
      if(el.axisValues!==false)grid.appendChild(svgText(left-12,y+fs*0.34,fmtAxis(max*(1-i/4)),{class:"chart-axis-val",textAnchor:"end"}));}
    S.appendChild(grid);
  }
  if(axed){
    S.appendChild(svg("line",{class:"chart-axis",x1:left,y1:top+ch,x2:VW-right,y2:top+ch}));
    S.appendChild(svg("line",{class:"chart-axis",x1:left,y1:top,x2:left,y2:top+ch}));
  }
  if(kind==="pie"||kind==="donut"){
    const total=Math.max(1,vals.reduce((a,b)=>a+b,0));let a0=-Math.PI/2;const cx=VW*0.46,cy=VH*0.5,r=Math.min(cw,ch)*0.42;
    data.forEach((d,i)=>{const ang=(d.value/total)*Math.PI*2;const a1=a0+ang;const [x0,y0]=polar(cx,cy,r,a0),[x1,y1]=polar(cx,cy,r,a1);const large=ang>Math.PI?1:0;
      S.appendChild(svg("path",{class:"pie-slice",d:`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`,style:`--i:${i}`}));
      const mid=(a0+a1)/2;S.appendChild(svgText(cx+(r+fs*2.2)*Math.cos(mid),cy+(r+fs*1.5)*Math.sin(mid),d.label,{class:"chart-label",textAnchor:"middle"}));
      if(showVals)S.appendChild(svgText(cx+(r*.62)*Math.cos(mid),cy+(r*.62)*Math.sin(mid),fmtVal(d.value,el),{class:"chart-value pie-val",textAnchor:"middle"}));a0=a1;});
    if(kind==="donut")S.appendChild(svg("circle",{class:"donut-hole",cx,cy,r:r*0.52}));
  } else if(kind==="line"||kind==="area"||kind==="spline"){
    const pts=data.map((d,i)=>{const x=left+(data.length===1?cw/2:i*cw/(data.length-1));const y=top+ch-(d.value/max)*ch;return [x,y,d];});
    const path=kind==="spline"?smoothPath(pts):pts.map((p,i)=>(i?"L":"M")+p[0]+" "+p[1]).join(" ");
    if(kind==="area")S.appendChild(svg("path",{class:"chart-area",d:path+` L ${left+cw} ${top+ch} L ${left} ${top+ch} Z`}));
    S.appendChild(svg("path",{class:"chart-line",d:path}));
    pts.forEach((p,i)=>{S.appendChild(svg("circle",{class:"chart-dot",cx:p[0],cy:p[1],r:Math.max(6,fs*0.32)}));
      S.appendChild(svgText(p[0],top+ch+fs*1.5,p[2].label,{class:"chart-label",textAnchor:"middle"}));
      if(showVals){
        const vy=(p[1]-fs*0.7 < top+fs*0.9) ? p[1]+fs*1.35 : p[1]-fs*0.7;   // flip below the dot when it would clip the top
        const vx=clamp(p[0], left+fs*1.2, VW-right-fs*1.2);
        S.appendChild(svgText(vx,vy,fmtVal(p[2].value,el),{class:"chart-value",textAnchor:"middle"}));
      }});
  } else if(kind==="scatter"||kind==="bubble"){
    const xs=data.map(d=>d.x), ys=data.map(d=>d.y);const xmin=Math.min(...xs),xmax=Math.max(...xs,xmin+1);const ymin=0,ymax=Math.max(1,...ys)*1.15;
    data.forEach((d,i)=>{const x=left+((d.x-xmin)/(xmax-xmin))*cw;const y=top+ch-((d.y-ymin)/(ymax-ymin))*ch;const r=kind==="bubble"?Math.max(8,Math.min(40,d.size)):Math.max(8,fs*0.5);
      S.appendChild(svg("circle",{class:kind==="bubble"?"chart-bubble":"chart-scatter",cx:x,cy:y,r:r,style:`--i:${i}`}));
      const lx=clamp(x,left+fs*1.4,VW-right-fs*1.4), ly=Math.max(top+fs*0.9,y-r-fs*0.4);
      S.appendChild(svgText(lx,ly,d.label,{class:"chart-label",textAnchor:"middle"}));
      if(showVals)S.appendChild(svgText(lx,Math.min(top+ch-fs*0.3,y+r+fs*1.05),fmtVal(d.y,el),{class:"chart-value-sm",textAnchor:"middle"}));});
  } else if(kind==="horizontalBar"){
    const gap=Math.max(12,ch*0.04);const bh=(ch-gap*(data.length+1))/Math.max(1,data.length);
    data.forEach((d,i)=>{const w=(d.value/max)*cw;const x=left;const y=top+gap+i*(bh+gap);S.appendChild(svg("rect",{class:"chart-bar hbar",x,y,width:w,height:bh,rx:Math.min(12,bh*0.3),style:`--i:${i}`}));S.appendChild(svgText(left-12,y+bh*.5+fs*0.34,d.label,{class:"chart-label",textAnchor:"end"}));if(showVals)S.appendChild(svgText(x+w+12,y+bh*.5+fs*0.34,fmtVal(d.value,el),{class:"chart-value"}));});
  } else if(kind==="groupedBar"||kind==="stackedBar"){
    const gap=Math.max(16,cw*0.03);const bw=(cw-gap*(data.length+1))/Math.max(1,data.length);
    data.forEach((d,i)=>{const sv=(d.series&&d.series.length?d.series:[d.value,Math.round(d.value*.65),Math.round(d.value*.35)]).slice(0,6);const x0=left+gap+i*(bw+gap);
      if(kind==="stackedBar"){
        let y=top+ch;
        sv.forEach((v,j)=>{const h=(v/max)*ch;y-=h;S.appendChild(svg("rect",{class:"chart-bar",x:x0,y,width:bw,height:h,rx:j===0?10:3,style:`--i:${j}`}));
          // segment value inside its own block, when the block is tall enough
          if(showVals && h>fs*1.4)S.appendChild(svgText(x0+bw/2,y+h/2+fs*0.34,fmtVal(v,el),{class:"chart-value-sm chart-value-in",textAnchor:"middle"}));});
        // stack total on top
        if(showVals)S.appendChild(svgText(x0+bw/2,Math.max(top+fs*0.9,y-fs*0.45),fmtVal(sv.reduce((a,b)=>a+(Number(b)||0),0),el),{class:"chart-value",textAnchor:"middle"}));
      } else {
        const sub=bw/sv.length;
        sv.forEach((v,j)=>{const h=(v/max)*ch;const bx=x0+j*sub+2,bwid=Math.max(3,sub-4),by=top+ch-h;
          S.appendChild(svg("rect",{class:"chart-bar",x:bx,y:by,width:bwid,height:h,rx:6,style:`--i:${j}`}));
          if(showVals){
            const inside=by-fs*0.5 < top+fs*0.9;
            S.appendChild(svgText(bx+bwid/2,inside?by+fs*1.05:by-fs*0.45,fmtVal(v,el),{class:"chart-value-sm"+(inside?" chart-value-in":""),textAnchor:"middle"}));
          }});
      }
      S.appendChild(svgText(x0+bw/2,top+ch+fs*1.5,d.label,{class:"chart-label",textAnchor:"middle"}));});
  } else if(kind==="radar"){
    const cx=VW/2,cy=VH*0.52,r=Math.min(cw,ch)*0.42,n=data.length||1;for(let ring=1;ring<=4;ring++){const pts=data.map((d,i)=>polar(cx,cy,r*ring/4,-Math.PI/2+i*2*Math.PI/n).join(",")).join(" ");S.appendChild(svg("polygon",{class:"radar-ring",points:pts}));}
    const poly=data.map((d,i)=>polar(cx,cy,(d.value/max)*r,-Math.PI/2+i*2*Math.PI/n).join(",")).join(" ");S.appendChild(svg("polygon",{class:"radar-fill",points:poly}));
    data.forEach((d,i)=>{const a=-Math.PI/2+i*2*Math.PI/n;const [x,y]=polar(cx,cy,r+fs*1.5,a);
      S.appendChild(svgText(clamp(x,fs*1.4,VW-fs*1.4),clamp(y,fs*0.9,VH-fs*0.4),d.label,{class:"chart-label",textAnchor:"middle"}));
      const [vx,vy]=polar(cx,cy,(d.value/max)*r,a);
      S.appendChild(svg("circle",{class:"chart-dot",cx:vx,cy:vy,r:Math.max(5,fs*0.26)}));
      if(showVals)S.appendChild(svgText(vx,vy-fs*0.6,fmtVal(d.value,el),{class:"chart-value-sm",textAnchor:"middle"}));});
  } else if(kind==="gauge"||kind==="progress"){
    const v=vals[0]||0;const pct=Math.max(0,Math.min(v/(Number(el.max)||100),1));
    if(kind==="gauge"){const cx=VW/2,cy=VH*0.66,r=Math.min(cw,ch)*0.5;S.appendChild(svg("path",{class:"gauge-bg",d:`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`}));const [ex,ey]=polar(cx,cy,r,Math.PI*(1-pct));S.appendChild(svg("path",{class:"gauge-fill",d:`M ${cx-r} ${cy} A ${r} ${r} 0 ${pct>.5?1:0} 1 ${ex} ${ey}`}));S.appendChild(svgText(cx,cy-fs*0.6,fmtVal(v,el)+(el.unit?"":"%"),{class:"gauge-value",textAnchor:"middle"}));}
    else {const bw2=cw,bx=left,by=VH/2-42;S.appendChild(svg("rect",{class:"progress-bg",x:bx,y:by,width:bw2,height:84,rx:42}));S.appendChild(svg("rect",{class:"progress-fill",x:bx,y:by,width:bw2*pct,height:84,rx:42}));S.appendChild(svgText(VW/2,by+56,fmtVal(v,el)+(el.unit?"":"%"),{class:"gauge-value",textAnchor:"middle"}));}
  } else if(kind==="funnel"){
    const total=Math.max(1,vals[0]||max);const fw=cw;data.forEach((d,i)=>{const topW=fw*(d.value/total),botW=fw*((data[i+1]?.value||d.value*.85)/total);const y=top+i*(ch/data.length);const h=ch/data.length-6;S.appendChild(svg("path",{class:"funnel-step",d:`M ${VW/2-topW/2} ${y} L ${VW/2+topW/2} ${y} L ${VW/2+botW/2} ${y+h} L ${VW/2-botW/2} ${y+h} Z`,style:`--i:${i}`}));S.appendChild(svgText(VW/2,y+h*.6,d.label+" · "+fmtVal(d.value,el),{class:"chart-value",textAnchor:"middle"}));});
  } else if(kind==="waterfall"){
    let base=0;const gap=Math.max(16,cw*0.03),bw=(cw-gap*(data.length+1))/Math.max(1,data.length);const absMax=Math.max(1,Math.abs(data.reduce((a,d)=>a+d.value,0)),...data.map(d=>Math.abs(d.value)))*1.4;const zero=top+ch*.65;
    data.forEach((d,i)=>{const x=left+gap+i*(bw+gap);const y0=zero-(base/absMax)*ch*.8;base+=d.value;const y1=zero-(base/absMax)*ch*.8;S.appendChild(svg("rect",{class:"chart-bar",x,y:Math.min(y0,y1),width:bw,height:Math.max(4,Math.abs(y1-y0)),rx:8,style:`--i:${d.value>=0?1:5}`}));S.appendChild(svgText(x+bw/2,top+ch+fs*1.5,d.label,{class:"chart-label",textAnchor:"middle"}));
      if(showVals){
        const vy=Math.max(top+fs*0.9,Math.min(y0,y1)-fs*0.45);
        S.appendChild(svgText(x+bw/2,vy,(d.value>=0?"+":"")+fmtVal(d.value,el),{class:"chart-value-sm",textAnchor:"middle"}));
        if(i===data.length-1)S.appendChild(svgText(x+bw/2,Math.min(top+ch-fs*0.4,Math.max(y0,y1)+fs*1.2),"= "+fmtVal(base,el),{class:"chart-value",textAnchor:"middle"}));
      }});
  } else if(kind==="heatmap"){
    const cols=Math.ceil(Math.sqrt(data.length)),cell=Math.min(cw,ch)/Math.max(2,cols);const ox=(VW-cols*cell)/2;data.forEach((d,i)=>{const x=ox+(i%cols)*cell,y=top+10+Math.floor(i/cols)*cell;S.appendChild(svg("rect",{class:"heat-cell",x,y,width:cell-8,height:cell-8,rx:12,opacity:Math.max(.25,d.value/max),style:`--i:${i}`}));S.appendChild(svgText(x+cell/2-4,y+cell/2,d.label,{class:"heat-label",textAnchor:"middle"}));if(showVals)S.appendChild(svgText(x+cell/2-4,y+cell/2+fs*0.9,fmtVal(d.value,el),{class:"heat-val",textAnchor:"middle"}));});
  } else if(kind==="treemap"){
    const total=Math.max(1,vals.reduce((a,b)=>a+b,0));let x=left,y=top+10;const rowH=Math.max(80,ch/Math.max(2,Math.ceil(data.length/3)));data.forEach((d,i)=>{const w=Math.max(110,(d.value/total)*cw*1.6);if(x+w>VW-right){x=left;y+=rowH+10;}S.appendChild(svg("rect",{class:"tree-box",x,y,width:Math.min(w,VW-right-left),height:rowH,rx:18,style:`--i:${i}`}));S.appendChild(svgText(x+16,y+fs*1.4,d.label,{class:"tree-label"}));S.appendChild(svgText(x+16,y+fs*2.6,fmtVal(d.value,el),{class:"tree-value"}));x+=w+12;});
  } else if(kind==="kpi"){
    const d=data[0]||{label:"Metric",value:0};S.appendChild(svgText(VW/2,VH*0.42,fmtVal(d.value,el),{class:"kpi-value",textAnchor:"middle"}));S.appendChild(svgText(VW/2,VH*0.58,d.label,{class:"kpi-label",textAnchor:"middle"}));S.appendChild(svg("rect",{class:"kpi-line",x:VW/2-145,y:VH*0.64,width:290,height:8,rx:4}));
  } else if(kind==="lollipop"){
    data.forEach((d,i)=>{const x=left+(data.length===1?cw/2:(i+0.5)*cw/data.length);const y=top+ch-(d.value/max)*ch;const r=Math.max(9,fs*0.42);
      S.appendChild(svg("line",{class:"lolli-stem",x1:x,y1:top+ch,x2:x,y2:y+r,style:`--i:${i%6}`}));
      S.appendChild(svg("circle",{class:"lolli-dot",cx:x,cy:y,r,style:`--i:${i%6}`}));
      S.appendChild(svgText(x,top+ch+fs*1.5,d.label,{class:"chart-label",textAnchor:"middle"}));
      if(showVals)S.appendChild(svgText(x,Math.max(top+fs*0.9,y-r-fs*0.5),fmtVal(d.value,el),{class:"chart-value",textAnchor:"middle"}));});
  } else if(kind==="pareto"){
    const gap=Math.max(16,cw*0.03);const bw=(cw-gap*(data.length+1))/Math.max(1,data.length);
    const total=Math.max(1,vals.reduce((a,b)=>a+b,0));let run=0;const cum=[];
    data.forEach((d,i)=>{const h=(d.value/max)*ch;const x=left+gap+i*(bw+gap);const y=top+ch-h;run+=d.value;cum.push([x+bw/2,top+ch-(run/total)*ch,run/total]);
      S.appendChild(svg("rect",{class:"chart-bar",x,y,width:bw,height:h,rx:Math.min(10,bw*0.18),style:`--i:${i%6}`}));
      S.appendChild(svgText(x+bw/2,top+ch+fs*1.5,d.label,{class:"chart-label",textAnchor:"middle"}));
      if(showVals){const inside=y-fs*0.55<top+fs*0.9;S.appendChild(svgText(x+bw/2,inside?y+fs*1.05:y-fs*0.55,fmtVal(d.value,el),{class:"chart-value-sm"+(inside?" chart-value-in":""),textAnchor:"middle"}));}});
    S.appendChild(svg("path",{class:"pareto-line",d:cum.map((p,i)=>(i?"L":"M")+p[0]+" "+p[1]).join(" ")}));
    cum.forEach(p=>{S.appendChild(svg("circle",{class:"pareto-dot",cx:p[0],cy:p[1],r:Math.max(6,fs*0.3)}));
      if(showVals)S.appendChild(svgText(p[0],Math.max(top+fs*0.9,p[1]-fs*0.55),Math.round(p[2]*100)+"%",{class:"pareto-val",textAnchor:"middle"}));});
  } else if(kind==="combo"){
    // bars from value; overlay line from series[0] when present, else a 3-point moving average
    const gap=Math.max(16,cw*0.03);const bw=(cw-gap*(data.length+1))/Math.max(1,data.length);
    const lineVals=data.map((d,i)=>{if(d.series&&d.series.length)return Number(d.series[0])||0;
      const a=vals[Math.max(0,i-1)],b=vals[i],c=vals[Math.min(vals.length-1,i+1)];return Math.round((a+b+c)/3);});
    const lmax=Math.max(max,...lineVals)*1.02;
    const pts=[];
    data.forEach((d,i)=>{const h=(d.value/max)*ch;const x=left+gap+i*(bw+gap);const y=top+ch-h;pts.push([x+bw/2,top+ch-(lineVals[i]/lmax)*ch,lineVals[i]]);
      S.appendChild(svg("rect",{class:"chart-bar",x,y,width:bw,height:h,rx:Math.min(10,bw*0.18),style:`--i:0`}));
      S.appendChild(svgText(x+bw/2,top+ch+fs*1.5,d.label,{class:"chart-label",textAnchor:"middle"}));
      if(showVals){const inside=y-fs*0.55<top+fs*0.9;S.appendChild(svgText(x+bw/2,inside?y+fs*1.05:y-fs*0.55,fmtVal(d.value,el),{class:"chart-value-sm"+(inside?" chart-value-in":""),textAnchor:"middle"}));}});
    S.appendChild(svg("path",{class:"combo-line",d:pts.map((p,i)=>(i?"L":"M")+p[0]+" "+p[1]).join(" ")}));
    pts.forEach(p=>{S.appendChild(svg("circle",{class:"combo-dot",cx:p[0],cy:p[1],r:Math.max(6,fs*0.3)}));
      if(showVals)S.appendChild(svgText(p[0],Math.max(top+fs*0.9,p[1]-fs*0.55),fmtVal(p[2],el),{class:"combo-val",textAnchor:"middle"}));});
  } else if(kind==="pyramid"){
    const maxV=Math.max(1,...vals);const rowH=ch/Math.max(1,data.length)-6;
    data.forEach((d,i)=>{const w2=cw*0.92*(d.value/maxV)/2;const y=top+i*(ch/Math.max(1,data.length));const nw=data[i+1]?cw*0.92*((data[i+1].value)/maxV)/2:w2*0.55;
      S.appendChild(svg("path",{class:"funnel-step",d:`M ${VW/2-w2} ${y} L ${VW/2+w2} ${y} L ${VW/2+nw} ${y+rowH} L ${VW/2-nw} ${y+rowH} Z`,style:`--i:${i%6}`}));
      S.appendChild(svgText(VW/2,y+rowH*0.6,d.label+(showVals?" · "+fmtVal(d.value,el):""),{class:"chart-value pyr-val",textAnchor:"middle"}));});
  } else if(kind==="polarArea"){
    const cx=VW/2,cy=VH*0.52,R=Math.min(cw,ch)*0.46,n=Math.max(1,data.length);
    for(let ring=1;ring<=4;ring++)S.appendChild(svg("circle",{class:"radar-ring",cx,cy,r:R*ring/4,fill:"none"}));
    data.forEach((d,i)=>{const a0=-Math.PI/2+i*2*Math.PI/n,a1=-Math.PI/2+(i+1)*2*Math.PI/n;const r=(d.value/max)*R;
      const [x0,y0]=polar(cx,cy,r,a0),[x1,y1]=polar(cx,cy,r,a1);
      S.appendChild(svg("path",{class:"pie-slice",d:`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${a1-a0>Math.PI?1:0} 1 ${x1} ${y1} Z`,style:`--i:${i%6}`}));
      const mid=(a0+a1)/2;const [lx,ly]=polar(cx,cy,R+fs*1.2,mid);
      S.appendChild(svgText(clamp(lx,fs*1.4,VW-fs*1.4),clamp(ly,fs*0.9,VH-fs*0.4),d.label,{class:"chart-label",textAnchor:"middle"}));
      if(showVals){const [vx,vy]=polar(cx,cy,Math.max(r*0.62,fs*1.3),mid);S.appendChild(svgText(vx,vy,fmtVal(d.value,el),{class:"chart-value pie-val",textAnchor:"middle"}));}});
  } else {
    const gap=Math.max(16,cw*0.03);const bw=(cw-gap*(data.length+1))/Math.max(1,data.length);data.forEach((d,i)=>{const h=(d.value/max)*ch;const x=left+gap+i*(bw+gap);const y=top+ch-h;S.appendChild(svg("rect",{class:"chart-bar",x,y,width:bw,height:h,rx:Math.min(12,bw*0.18),style:`--i:${i}`}));S.appendChild(svgText(x+bw/2,top+ch+fs*1.5,d.label,{class:"chart-label",textAnchor:"middle"}));
      if(showVals){
        const inside=y-fs*0.55 < top+fs*0.9;                      // bar reaches the top → put the value inside it
        S.appendChild(svgText(x+bw/2,inside?y+fs*1.15:y-fs*0.55,fmtVal(d.value,el),{class:"chart-value"+(inside?" chart-value-in":""),textAnchor:"middle"}));
      }});
  }
  // optional legend for multi-series charts
  if(el.showLegend && ["groupedBar","stackedBar"].includes(kind)){
    const names=(Array.isArray(el.seriesNames)&&el.seriesNames.length)?el.seriesNames:["Series 1","Series 2","Series 3"];
    names.slice(0,6).forEach((nm,j)=>{const lx=left+j*(cw/Math.min(names.length,6));S.appendChild(svg("rect",{class:"legend-sw",x:lx,y:6,width:fs*0.8,height:fs*0.8,rx:4,style:`--i:${j}`}));S.appendChild(svgText(lx+fs,6+fs*0.7,nm,{class:"legend-lbl"}));});
  }
  // Custom colour overrides win over the theme (inline style beats CSS class fill).
  if(el.valueColor)S.querySelectorAll(".chart-value,.chart-value-sm,.gauge-value,.kpi-value,.heat-val,.tree-value,.pareto-val,.combo-val").forEach(n=>{if(!n.classList.contains("chart-value-in"))n.style.fill=el.valueColor;});
  if(el.labelColor)S.querySelectorAll(".chart-label,.chart-axis-val,.legend-lbl,.kpi-label,.heat-label,.tree-label").forEach(n=>{n.style.fill=el.labelColor;});
  wrap.appendChild(S);box.appendChild(wrap);return box;
}
/* Compact axis tick formatting: 1.2k / 3.4M instead of long numbers. */
function fmtAxis(v){
  const n=Number(v)||0, a=Math.abs(n);
  if(a>=1e6)return (n/1e6).toFixed(a>=1e7?0:1).replace(/\.0$/,"")+"M";
  if(a>=1e3)return (n/1e3).toFixed(a>=1e4?0:1).replace(/\.0$/,"")+"k";
  return String(Math.round(n));
}
/* Catmull-Rom → cubic Bézier for smooth-line charts. */
function smoothPath(pts){
  if(pts.length<3)return pts.map((p,i)=>(i?"L":"M")+p[0]+" "+p[1]).join(" ");
  let d="M"+pts[0][0]+" "+pts[0][1];
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[i-1]||pts[i],p1=pts[i],p2=pts[i+1],p3=pts[i+2]||p2;
    const c1x=p1[0]+(p2[0]-p0[0])/6,c1y=p1[1]+(p2[1]-p0[1])/6;
    const c2x=p2[0]-(p3[0]-p1[0])/6,c2y=p2[1]-(p3[1]-p1[1])/6;
    d+=` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}
/* Per-chart colour palette: user overrides else a sensible default set. */
function chartPalette(el){
  const def=["#e8482b","#22c55e","#38bdf8","#f59e0b","#a855f7","#ef4444"];
  const base=el.accent||def[0];
  const out=Array.isArray(el.palette)&&el.palette.length?el.palette.slice(0,6):[base,...def.slice(1)];
  while(out.length<6)out.push(def[out.length]);
  return out;
}
/* Format a value with optional prefix/suffix/decimals from the element. */
function fmtVal(v,el){
  const n=Number(v)||0;
  const dp=Number(el&&el.decimals);
  let s=Number.isFinite(dp)&&dp>0?n.toFixed(dp):Math.round(n).toLocaleString();
  if(el&&el.valuePrefix)s=el.valuePrefix+s;
  if(el&&(el.valueSuffix||el.unit))s=s+(el.valueSuffix||el.unit);
  return s;
}

/* ─── GALLERY ─────────────────────────────────────────────────────────
   A projected photo slideshow living inside ONE slide element. Photos are
   stored as el.photos=[{src,caption}], with a single frame style for the
   whole gallery (el.frame) and its own entry/exit + per-photo stagger.

   Editor (live:false): shows the first photo framed, plus a small
   "N photos" badge so the presenter can see & position the block.

   Live (live:true): auto-advances — each photo flies IN, HOLDS, flies OUT,
   then the next. Timing from el.holdMs (hold) and el.stagger (in/out speed).
   The loop is self-cleaning: each frame checks node.isConnected and stops
   when the slide changes, matching the Plotly-map pattern elsewhere. */
const GALLERY_FRAMES = ["none","border","shadow","polaroid","film","card","gold","tape"];
const GALLERY_ANIMS = {
  fade:  {in:[{opacity:0},{opacity:1}], out:[{opacity:1},{opacity:0}]},
  zoom:  {in:[{opacity:0,transform:"scale(.82)"},{opacity:1,transform:"scale(1)"}], out:[{opacity:1,transform:"scale(1)"},{opacity:0,transform:"scale(1.12)"}]},
  slide: {in:[{opacity:0,transform:"translateX(60px)"},{opacity:1,transform:"translateX(0)"}], out:[{opacity:1,transform:"translateX(0)"},{opacity:0,transform:"translateX(-60px)"}]},
  rise:  {in:[{opacity:0,transform:"translateY(48px)"},{opacity:1,transform:"translateY(0)"}], out:[{opacity:1,transform:"translateY(0)"},{opacity:0,transform:"translateY(-48px)"}]},
  flip:  {in:[{opacity:0,transform:"perspective(1000px) rotateY(70deg)"},{opacity:1,transform:"perspective(1000px) rotateY(0)"}], out:[{opacity:1,transform:"perspective(1000px) rotateY(0)"},{opacity:0,transform:"perspective(1000px) rotateY(-70deg)"}]},
  reveal:{in:[{clipPath:"inset(0 100% 0 0)"},{clipPath:"inset(0 0 0 0)"}], out:[{clipPath:"inset(0 0 0 0)"},{clipPath:"inset(0 0 0 100%)"}]},
};
function galleryPhotos(el){
  const arr=Array.isArray(el.photos)?el.photos:[];
  return arr.filter(p=>p && String(p.src||"").trim());
}
function buildGalleryCard(el, photo){
  const frame=GALLERY_FRAMES.includes(el.frame)?el.frame:"none";
  const card=document.createElement("div");
  card.className="gallery-card gframe-"+frame;
  const media=document.createElement("div");
  media.className="gallery-media";
  media.style.backgroundImage=`url("${photo.src}")`;
  media.style.backgroundSize=(el.fit||"cover");
  card.appendChild(media);
  const cap=String(photo.caption||"").trim();
  if(cap){
    const c=document.createElement("div");c.className="gallery-caption";c.textContent=cap;
    card.appendChild(c);
  }
  return card;
}
function renderGallery(el,{live=false}={}){
  const box=document.createElement("div");
  box.className="gallery-box gframe-"+(GALLERY_FRAMES.includes(el.frame)?el.frame:"none");
  if(el.galleryBg) box.style.setProperty("--gallery-bg", el.galleryBg);
  const photos=galleryPhotos(el);

  if(!photos.length){
    box.classList.add("gallery-empty");
    box.innerHTML=`<div class="gallery-empty-msg">🖼️<br>Add photos in the inspector</div>`;
    return box;
  }

  const stage=document.createElement("div");stage.className="gallery-stage";
  box.appendChild(stage);

  if(!live){
    stage.appendChild(buildGalleryCard(el, photos[0]));
    const badge=document.createElement("div");badge.className="gallery-badge";
    badge.textContent=`▦ ${photos.length} photo${photos.length>1?"s":""} · slideshow`;
    box.appendChild(badge);
    return box;
  }

  // Live: auto-advance carousel — fly in, hold, fly out, next.
  const speed=clamp(Number(el.stagger)||1, 0.25, 4);
  const holdMs=clamp(Number(el.holdMs)||2600, 600, 20000);
  const inMs=Math.round(620/speed), outMs=Math.round(520/speed);
  const anim=GALLERY_ANIMS[el.galleryAnim]||GALLERY_ANIMS.fade;
  const loop=el.galleryLoop!==false;
  let current=null, stopped=false;

  function showAt(n){
    if(stopped || !stage.isConnected){stopped=true;return;}
    if(!photos[n])return;
    const card=buildGalleryCard(el, photos[n]);
    card.classList.add("gallery-active");
    stage.appendChild(card);
    current=card;
    try{ card.animate(anim.in,{duration:inMs,easing:"cubic-bezier(.22,1,.36,1)",fill:"both"}); }catch(e){}
    setTimeout(()=>{
      if(stopped || !stage.isConnected){stopped=true;return;}
      // single photo: just hold forever, no exit
      if(photos.length<2){ return; }
      let a;
      try{ a=card.animate(anim.out,{duration:outMs,easing:"cubic-bezier(.4,0,.2,1)",fill:"both"}); }catch(e){}
      const advance=()=>{
        if(stopped || !stage.isConnected){stopped=true;return;}
        card.remove(); if(current===card)current=null;
        const next=n+1;
        if(next<photos.length) showAt(next);
        else if(loop) showAt(0);
      };
      if(a && a.finished && a.finished.then) a.finished.then(advance).catch(advance);
      else setTimeout(advance, outMs);
    }, inMs + holdMs);
  }
  // BOOT — renderGallery() runs BEFORE the caller appends the box to the
  // slide, so stage.isConnected is false at this moment. The old code called
  // showAt(0) synchronously; its isConnected guard set stopped=true and the
  // carousel never started (gallery showed nothing in live/present mode).
  // Instead, wait until the node is actually attached (a few frames is
  // plenty; ~2s of retries covers slow first paints), THEN start.
  let bootTries=0;
  function bootGallery(){
    if(stopped)return;
    if(!stage.isConnected){
      if(++bootTries<120){ requestAnimationFrame(bootGallery); return; }
      stopped=true; return;   // never attached — give up quietly
    }
    showAt(0);
  }
  requestAnimationFrame(bootGallery);
  return box;
}

function renderVideo(el,{live=false}={}){
  const src=String(el.src||"").trim();
  const isEmbed=/youtube\.com\/embed|player\.vimeo\.com|youtu\.be|youtube\.com\/watch/.test(src);
  if(live&&src&&isEmbed){
    let embed=src;
    const yt=src.match(/(?:youtu\.be\/|v=)([A-Za-z0-9_-]{6,})/);if(yt)embed=`https://www.youtube.com/embed/${yt[1]}`;
    const frame=document.createElement("iframe");frame.className="video-box";frame.src=embed;frame.allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";frame.allowFullscreen=true;frame.style.borderRadius=(el.radius||18)+"px";frame.style.border="0";return frame;
  }
  const box=document.createElement(live&&src?"video":"div");box.className="video-box"+(src?"":" video-empty");box.style.borderRadius=(el.radius||18)+"px";
  if(live&&src){box.src=src;box.controls=el.controls!==false;box.autoplay=!!el.autoplay;box.muted=!!el.muted;box.poster=el.poster||"";box.style.objectFit=el.fit||"cover";}
  else {box.innerHTML=`<div class="video-play">▶</div><div><b>${escHTML(el.title||"Video")}</b><span>${escHTML(src||"Paste a video link in the inspector")}</span></div>`;}
  return box;
}
function renderLink(el,{live=false}={}){
  const tag=live?"a":"div";const a=document.createElement(tag);a.className="link-card link-"+(el.linkStyle||"button");
  a.style.setProperty("--link-bg",el.bg||el.accent||"#2563eb");a.style.setProperty("--link-color",el.textColor||"#fff");a.style.setProperty("--link-accent",el.accent||"#2563eb");a.style.borderRadius=(el.radius||22)+"px";
  if(live){a.href=el.url||"#";a.target="_blank";a.rel="noopener";}
  a.innerHTML=`<span class="link-ico">↗</span><div><b>${escHTML(el.label||"Open link")}</b><span>${escHTML(el.description||el.url||"")}</span></div>`;
  return a;
}
/* ── Real geographic maps ─────────────────────────────────────────────
   Each entry has a lon/lat `bounds` and one or more boundary `paths`
   (arrays of [lon,lat]). We project with a plain equirectangular mapping
   into the SVG box, so the shapes are recognisably real — not the old
   hand-drawn blobs. Outlines are deliberately simplified for size.
   Built-in city pins (lon/lat) are provided per map; users can still pass
   pins as {x%,y%} or {lon,lat}. */
const MAP_GEO = {
  gambia:{
    name:"The Gambia",
    bounds:[-16.9,13.0,-13.7,13.9],
    paths:[[[-16.85,13.48],[-16.55,13.59],[-16.3,13.55],[-16.0,13.82],[-15.6,13.78],[-15.3,13.6],[-15.0,13.7],[-14.6,13.5],[-14.2,13.55],[-13.8,13.46],[-13.83,13.27],[-14.3,13.3],[-14.7,13.25],[-15.1,13.35],[-15.5,13.28],[-15.85,13.35],[-16.2,13.2],[-16.5,13.27],[-16.7,13.06],[-16.85,13.48]]],
    river:[[-16.55,13.48],[-16.2,13.45],[-15.8,13.5],[-15.4,13.45],[-15.0,13.5],[-14.6,13.42],[-14.2,13.46],[-13.85,13.4]],
    cities:[{label:"Banjul",lon:-16.58,lat:13.45},{label:"Brikama",lon:-16.65,lat:13.27},{label:"Soma",lon:-15.53,lat:13.43},{label:"Basse",lon:-14.21,lat:13.31},{label:"Farafenni",lon:-15.6,lat:13.57}]
  },
  senegal:{
    name:"Senegal",
    bounds:[-17.6,12.2,-11.3,16.7],
    paths:[[[-17.5,14.73],[-17.1,14.95],[-16.5,15.6],[-16.5,16.0],[-16.1,16.5],[-15.0,16.65],[-13.8,16.4],[-13.3,16.05],[-12.5,15.4],[-12.0,14.8],[-11.9,14.0],[-11.4,13.6],[-11.5,13.0],[-12.0,12.5],[-13.0,12.4],[-13.7,12.65],[-15.0,12.5],[-16.3,12.35],[-16.7,12.55],[-16.75,13.06],[-16.5,13.27],[-15.85,13.35],[-15.5,13.28],[-15.1,13.35],[-14.7,13.25],[-14.2,13.55],[-13.8,13.46],[-13.83,13.27],[-14.3,13.3],[-15.1,13.35]],[[-16.85,13.48],[-16.5,13.6],[-16.0,13.82],[-15.3,13.6],[-14.6,13.5],[-13.8,13.46],[-14.2,13.55],[-15.5,13.78],[-16.55,13.59],[-16.85,13.48]]],
    cities:[{label:"Dakar",lon:-17.45,lat:14.69},{label:"Thiès",lon:-16.93,lat:14.79},{label:"Kaolack",lon:-16.07,lat:14.15},{label:"Saint-Louis",lon:-16.49,lat:16.02},{label:"Tambacounda",lon:-13.67,lat:13.77}]
  },
  africa:{
    name:"Africa",
    bounds:[-19,-37,52,38],
    paths:[[[-17,21],[-16,15],[-17,14],[-12,8],[-8,4],[-2,5],[5,4],[9,4],[9,2],[13,-5],[12,-6],[14,-12],[12,-17],[15,-22],[18,-29],[20,-34],[26,-34],[28,-31],[32,-26],[33,-22],[35,-21],[40,-15],[40,-10],[41,-2],[43,2],[48,5],[51,11],[44,11],[43,11],[40,15],[39,15],[38,18],[34,22],[35,24],[32,31],[25,32],[20,32],[11,34],[10,37],[3,37],[0,35],[-6,36],[-10,30],[-12,28],[-13,24],[-17,21]]],
    cities:[{label:"Lagos",lon:3.4,lat:6.5},{label:"Cairo",lon:31.2,lat:30.0},{label:"Nairobi",lon:36.8,lat:-1.3},{label:"Cape Town",lon:18.4,lat:-33.9},{label:"Accra",lon:-0.2,lat:5.6},{label:"Addis Ababa",lon:38.7,lat:9.0}]
  },
  europe:{
    name:"Europe",
    bounds:[-11,35,32,62],
    paths:[[[-9,43],[-9,38],[-6,36],[0,38],[3,42],[7,43],[8,44],[13,45],[16,42],[19,40],[24,40],[27,41],[28,45],[31,46],[31,52],[28,55],[24,57],[24,60],[20,61],[14,55],[12,55],[10,57],[8,57],[5,53],[3,51],[0,51],[-2,50],[-5,49],[-2,47],[-1,46],[-2,43],[-9,43]]],
    cities:[{label:"London",lon:-0.1,lat:51.5},{label:"Paris",lon:2.35,lat:48.9},{label:"Berlin",lon:13.4,lat:52.5},{label:"Rome",lon:12.5,lat:41.9},{label:"Madrid",lon:-3.7,lat:40.4}]
  },
  world:{
    name:"World",
    bounds:[-170,-58,180,75],
    paths:[
      /* N + S America */ [[-168,66],[-156,71],[-130,70],[-95,69],[-81,73],[-61,82],[-74,68],[-78,52],[-66,49],[-70,42],[-76,35],[-81,25],[-97,26],[-97,18],[-87,21],[-83,9],[-77,8],[-82,-2],[-80,-12],[-71,-18],[-71,-30],[-74,-44],[-75,-52],[-69,-55],[-65,-48],[-62,-39],[-57,-35],[-48,-25],[-40,-20],[-35,-8],[-50,0],[-51,5],[-60,9],[-72,12],[-82,9],[-84,16],[-95,16],[-106,24],[-112,30],[-117,33],[-124,40],[-124,48],[-132,53],[-141,60],[-156,58],[-165,60],[-168,66]],
      /* Africa+Europe+Asia */ [[-10,36],[-6,36],[0,40],[8,44],[18,40],[27,40],[30,31],[34,28],[35,33],[36,37],[45,40],[50,44],[57,40],[62,38],[70,38],[78,35],[88,30],[97,23],[105,21],[108,15],[110,21],[122,30],[127,35],[130,43],[142,46],[135,35],[140,38],[129,35],[122,40],[120,38],[122,30],[114,22],[105,21],[100,13],[103,1],[95,5],[88,22],[80,8],[77,8],[73,20],[68,24],[63,25],[57,25],[48,30],[44,29],[51,30],[48,16],[43,12],[51,12],[48,5],[41,-2],[40,-10],[40,-15],[35,-21],[33,-22],[32,-26],[28,-31],[26,-34],[20,-34],[18,-29],[15,-22],[12,-17],[14,-12],[12,-6],[13,-5],[9,2],[9,4],[5,4],[-2,5],[-8,4],[-12,8],[-17,14],[-16,15],[-17,21],[-13,24],[-12,28],[-10,30],[-10,36]],
      /* Australia */ [[114,-22],[122,-18],[130,-12],[137,-12],[142,-11],[146,-18],[150,-25],[153,-28],[150,-37],[143,-39],[135,-35],[129,-32],[123,-34],[115,-34],[114,-28],[114,-22]]
    ],
    cities:[{label:"New York",lon:-74,lat:40.7},{label:"London",lon:-0.1,lat:51.5},{label:"Lagos",lon:3.4,lat:6.5},{label:"Dubai",lon:55.3,lat:25.2},{label:"Tokyo",lon:139.7,lat:35.7},{label:"Sydney",lon:151.2,lat:-33.9}]
  }
};
function geoProject(lon,lat,bounds,VW,VH,pad){
  const [minLon,minLat,maxLon,maxLat]=bounds;
  const w=VW-pad*2,h=VH-pad*2;
  const sx=w/(maxLon-minLon), sy=h/(maxLat-minLat);
  const s=Math.min(sx,sy);                 // uniform scale = no distortion
  const ox=pad+(w-(maxLon-minLon)*s)/2;
  const oy=pad+(h-(maxLat-minLat)*s)/2;
  return [ox+(lon-minLon)*s, oy+(maxLat-lat)*s];   // flip lat (north up)
}
function renderMap(el){
  const kind=el.mapKind&&MAP_GEO[el.mapKind]?el.mapKind:"gambia";
  const geo=MAP_GEO[kind];
  if((el.mapEngine||"svg") === "plotly" && window.Plotly) return renderPlotlyMap(el,geo);
  if(["folium","leaflet"].includes(el.mapEngine||"") && window.L) return renderFoliumMap(el,geo);
  const box=document.createElement("div");box.className="map-box map-"+kind;box.style.setProperty("--accent",el.accent||"#2f6f4f");
  if(el.mapTheme==="dark")box.classList.add("map-theme-dark");
  const title=document.createElement("div");title.className="map-title";title.textContent=el.title||geo.name+" map";
  if(el.titleColor)title.style.color=el.titleColor;
  box.appendChild(title);

  // Non-distorting box matched to the element aspect ratio (same fix as charts).
  const VW=1000, aspect=(Number(el.h)||360)/Math.max(1,(Number(el.w)||650));
  const VH=Math.round(clamp(VW*aspect,360,1200));
  const pad=46, fs=Number(el.labelSize)||24;
  const S=svg("svg",{viewBox:`0 0 ${VW} ${VH}`,preserveAspectRatio:"xMidYMid meet"});
  S.style.setProperty("--fs",fs+"px");
  S.style.setProperty("--fs-sm",Math.round(fs*0.82)+"px");
  S.appendChild(svg("rect",{class:"map-water",x:0,y:0,width:VW,height:VH,rx:30}));

  // landmass paths
  (geo.paths||[]).forEach(ring=>{
    const d=ring.map((c,i)=>{const [x,y]=geoProject(c[0],c[1],geo.bounds,VW,VH,pad);return (i?"L":"M")+x.toFixed(1)+" "+y.toFixed(1);}).join(" ")+" Z";
    S.appendChild(svg("path",{class:"map-land",d}));
  });
  // optional river (Gambia)
  if(geo.river && el.showRiver!==false){
    const d=geo.river.map((c,i)=>{const [x,y]=geoProject(c[0],c[1],geo.bounds,VW,VH,pad);return (i?"L":"M")+x.toFixed(1)+" "+y.toFixed(1);}).join(" ");
    S.appendChild(svg("path",{class:"map-river",d}));
  }

  // affected areas / polygons imported from coordinate rows or GeoJSON.
  mapAreas(el).forEach((a,i)=>{
    const d=a.coordinates.map((c,j)=>{const [x,y]=geoProject(Number(c[0]),Number(c[1]),geo.bounds,VW,VH,pad);return (j?"L":"M")+x.toFixed(1)+" "+y.toFixed(1);}).join(" ")+" Z";
    const path=svg("path",{class:"map-area",d,style:`--area-fill:${a.fill};--area-stroke:${a.stroke};--area-opacity:${a.fillOpacity};--i:${i}`});
    S.appendChild(path);
    if(el.showLabels!==false){
      const xs=a.coordinates.map(c=>geoProject(Number(c[0]),Number(c[1]),geo.bounds,VW,VH,pad)[0]);
      const ys=a.coordinates.map(c=>geoProject(Number(c[0]),Number(c[1]),geo.bounds,VW,VH,pad)[1]);
      const cx=xs.reduce((m,v)=>m+v,0)/xs.length, cy=ys.reduce((m,v)=>m+v,0)/ys.length;
      S.appendChild(svgText(cx,cy,String(a.label||"Area"),{class:"map-area-label"}));
      if(a.value!=="")S.appendChild(svgText(cx,cy+fs,String(a.value),{class:"map-area-value"}));
    }
  });

  // pins: accept {lon,lat} OR legacy {x%,y%}; if none, optionally seed cities
  let pins=Array.isArray(el.pins)?el.pins:[];
  if(el.useCities && geo.cities){pins=geo.cities.map(c=>({label:c.label,lon:c.lon,lat:c.lat}));}
  pins.forEach((p,i)=>{
    let x,y;
    if(p.lon!=null&&p.lat!=null){[x,y]=geoProject(Number(p.lon),Number(p.lat),geo.bounds,VW,VH,pad);}
    else {x=clamp(Number(p.x)||50,0,100)/100*VW;y=clamp(Number(p.y)||50,0,100)/100*VH;}
    const g=svg("g",{class:"map-pin",style:`--i:${i}`});
    g.appendChild(svg("circle",{cx:x,cy:y,r:Math.max(12,fs*0.6)}));
    g.appendChild(svg("circle",{cx:x,cy:y,r:Math.max(4,fs*0.22),class:"map-pin-dot"}));
    if(el.showLabels!==false)g.appendChild(svgText(x+fs*1.1,y-fs*0.5,String(p.label||"Pin"),{class:"map-label"}));
    if(p.value!=null&&p.value!=="")g.appendChild(svgText(x+fs*1.1,y+fs*0.55,String(p.value),{class:"map-value"}));
    S.appendChild(g);
  });
  box.appendChild(S);return box;
}

function miniCount(count,max=140){return Math.max(1,Math.min(Number(count)||1,max));}
function objectIcons(kind){
  const maps={
    plates:["🍽️"], wall:["🧱"], tree:["🌳","🌴","🌲"], farmer:["🧑🏾‍🌾","👩🏾‍🌾"],
    animals:["🐄","🐐","🐑","🐓"], bugs:["🐞","🦗","🐛","🐜"], people:["👩🏾","🧑🏾","👨🏾","👥"],
    seed_pile:["🌱","🌾","•"]
  };
  return maps[kind]||[objectDef(kind).icon||"●"];
}
/* ════════════════════════════════════════════════════════════════════
   SDG (Sustainable Development Goals) — proper colour wheel + tiles.
   Official UN colours and the 17 goal titles. The glyphs are simplified,
   recognisable white line/solid icons drawn in a shared 0..100 viewBox so
   they scale cleanly inside a wedge or a tile. Not the trademarked vector
   artwork — clean originals in the SDG visual language.
   ──────────────────────────────────────────────────────────────────── */
const SDG_COLORS = [
  "#E5243B","#DDA63A","#4C9F38","#C5192D","#FF3A21","#26BDE2","#FCC30B",
  "#A21942","#FD6925","#DD1367","#FD9D24","#BF8B2E","#3F7E44","#0A97D9",
  "#56C02B","#00689D","#19486A"
];
const SDG_TITLES = [
  "No Poverty","Zero Hunger","Good Health and Well-being","Quality Education",
  "Gender Equality","Clean Water and Sanitation","Affordable and Clean Energy",
  "Decent Work and Economic Growth","Industry, Innovation and Infrastructure",
  "Reduced Inequalities","Sustainable Cities and Communities",
  "Responsible Consumption and Production","Climate Action","Life Below Water",
  "Life on Land","Peace, Justice and Strong Institutions","Partnerships for the Goals"
];
/* Each glyph is a string of SVG children drawn in a 0 0 100 100 viewBox,
   white fill/stroke. Kept deliberately simple but identifiable. */
const SDG_GLYPHS = (()=>{
  const wf='fill="#fff"', ws='fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"';
  return [
    /* 1 No Poverty — family group */
    `<g ${wf}><circle cx="28" cy="30" r="7"/><circle cx="50" cy="26" r="8"/><circle cx="72" cy="30" r="7"/><rect x="22" y="40" width="12" height="30" rx="5"/><rect x="43" y="36" width="14" height="36" rx="6"/><rect x="66" y="40" width="12" height="30" rx="5"/><circle cx="40" cy="46" r="5"/><rect x="36" y="54" width="8" height="20" rx="4"/></g>`,
    /* 2 Zero Hunger — steaming bowl */
    `<g ${wf}><path d="M20 52 h60 a30 22 0 0 1 -60 0 Z"/><ellipse cx="50" cy="52" rx="30" ry="6"/></g><g ${ws}><path d="M38 24 q6 6 0 12"/><path d="M50 20 q6 6 0 12"/><path d="M62 24 q6 6 0 12"/></g>`,
    /* 3 Good Health — heartbeat + heart */
    `<g ${ws}><path d="M14 52 h14 l6 -16 l10 30 l8 -22 l5 8 h8"/></g><path ${wf} d="M70 40 c4 -8 18 -4 14 6 c-2 7 -14 14 -14 14 c0 0 -12 -7 -14 -14 c-4 -10 10 -14 14 -6 Z"/>`,
    /* 4 Quality Education — open book + pencil */
    `<g ${wf}><path d="M16 36 c10 -6 24 -6 32 0 v32 c-8 -6 -22 -6 -32 0 Z"/><path d="M84 36 c-10 -6 -22 -6 -30 0 v32 c8 -6 20 -6 30 0 Z"/></g><g ${ws}><path d="M70 18 l8 8 l-26 26"/></g>`,
    /* 5 Gender Equality — combined symbol */
    `<g ${ws}><circle cx="50" cy="44" r="14"/><path d="M50 58 v22"/><path d="M40 70 h20"/><path d="M60 34 l14 -14"/><path d="M66 20 h10 v10"/></g>`,
    /* 6 Clean Water — glass with drop + arrow */
    `<g ${wf}><path d="M50 18 c10 14 16 22 16 30 a16 16 0 0 1 -32 0 c0 -8 6 -16 16 -30 Z"/></g><g ${ws}><path d="M50 60 v20"/><path d="M42 72 l8 10 l8 -10"/></g>`,
    /* 7 Affordable Energy — sun with power symbol */
    `<g ${ws}><circle cx="50" cy="50" r="14"/><path d="M50 30 v-12 M50 70 v12 M30 50 h-12 M70 50 h12 M36 36 l-8 -8 M64 36 l8 -8 M36 64 l-8 8 M64 64 l8 8"/><path d="M50 44 v10"/></g>`,
    /* 8 Decent Work — bar chart + arrow */
    `<g ${wf}><rect x="22" y="58" width="10" height="20"/><rect x="38" y="48" width="10" height="30"/><rect x="54" y="40" width="10" height="38"/></g><g ${ws}><path d="M24 44 l16 -10 l12 6 l22 -16"/><path d="M70 18 h10 v10"/></g>`,
    /* 9 Industry — stacked cubes */
    `<g ${ws}><rect x="32" y="46" width="22" height="22"/><rect x="54" y="46" width="22" height="22"/><rect x="43" y="24" width="22" height="22"/></g>`,
    /* 10 Reduced Inequalities — equals with arrows */
    `<g ${ws}><path d="M50 20 l-10 12 h20 Z M50 80 l-10 -12 h20 Z M20 50 l12 -10 v20 Z M80 50 l-12 -10 v20 Z"/><path d="M38 44 h24 M38 56 h24"/></g>`,
    /* 11 Sustainable Cities — buildings */
    `<g ${wf}><path d="M22 78 V46 l12 -10 v42 Z"/><rect x="40" y="40" width="16" height="38"/><rect x="60" y="50" width="14" height="28"/></g><g ${ws}><path d="M28 54 h2 M28 62 h2 M45 48 h6 M45 58 h6 M45 68 h6"/></g>`,
    /* 12 Responsible Consumption — infinity */
    `<g ${ws}><path d="M30 50 c0 -10 14 -10 20 0 c6 10 20 10 20 0 c0 -10 -14 -10 -20 0 c-6 10 -20 10 -20 0 Z"/></g>`,
    /* 13 Climate Action — eye with globe */
    `<g ${ws}><path d="M18 50 q32 -26 64 0 q-32 26 -64 0 Z"/><circle cx="50" cy="50" r="12"/><path d="M40 46 q10 4 20 0 M44 54 q6 3 12 0"/></g>`,
    /* 14 Life Below Water — fish + waves */
    `<g ${wf}><path d="M30 50 c8 -12 28 -12 36 0 c-8 12 -28 12 -36 0 Z M66 50 l10 -8 v16 Z"/><circle cx="40" cy="47" r="2.5" fill="#0A97D9"/></g><g ${ws}><path d="M20 70 q6 -6 12 0 t12 0 t12 0 t12 0"/></g>`,
    /* 15 Life on Land — tree + birds */
    `<g ${wf}><path d="M50 30 c10 0 16 10 12 18 c8 -2 12 8 4 12 H34 c-8 -4 -4 -14 4 -12 c-4 -8 2 -18 12 -18 Z"/><rect x="47" y="58" width="6" height="16"/></g><g ${ws}><path d="M26 30 q4 -4 8 0 q4 -4 8 0"/></g>`,
    /* 16 Peace & Justice — dove + gavel */
    `<g ${wf}><path d="M30 44 c10 -10 26 -10 32 -2 c4 6 -2 12 -10 12 c6 4 4 12 -4 12 c-10 0 -22 -10 -18 -22 Z"/></g><g ${ws}><path d="M58 56 l16 16 M64 50 l8 8"/></g>`,
    /* 17 Partnerships — interlocking rings */
    `<g ${ws}><circle cx="40" cy="40" r="12"/><circle cx="60" cy="40" r="12"/><circle cx="40" cy="60" r="12"/><circle cx="60" cy="60" r="12"/><circle cx="50" cy="50" r="12"/></g>`
  ];
})();

function sdgGoals(el){
  /* how many of the 17 to show (count), default all 17 */
  const n=Math.max(1,Math.min(17,Number(el&&el.count)||17));
  return n;
}

/* ── Colour wheel: 17 wedges around a hollow centre ─────────────────── */
function renderSdgWheel(el){
  const n=sdgGoals(el);
  const showCenter = el.sdgCenter!==false;     // SUSTAINABLE DEVELOPMENT GOALS text
  const showIcons  = el.sdgIcons!==false;      // glyph in each wedge
  const dark = el.sdgTheme!=="light";
  const wrap=document.createElement("div");
  wrap.className="sdg-wheel"+(el.objAnim===false?" sdg-static":"");
  const cx=200, cy=200, rOut=190, rIn=showCenter?92:78;
  const gap=2.4;                                // degrees of gap between wedges
  const seg=360/17;
  const NS="http://www.w3.org/2000/svg";
  const S=document.createElementNS(NS,"svg");
  S.setAttribute("viewBox","0 0 400 400");
  S.setAttribute("class","sdg-wheel-svg");
  S.setAttribute("preserveAspectRatio","xMidYMid meet");
  const pol=(r,a)=>[cx+r*Math.cos(a),cy+r*Math.sin(a)];
  for(let i=0;i<n;i++){
    // start at top (-90deg), go clockwise
    const a0=(-90 + i*seg + gap/2)*Math.PI/180;
    const a1=(-90 + (i+1)*seg - gap/2)*Math.PI/180;
    const [x0,y0]=pol(rOut,a0), [x1,y1]=pol(rOut,a1);
    const [x2,y2]=pol(rIn,a1),  [x3,y3]=pol(rIn,a0);
    const path=`M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${rOut} ${rOut} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${rIn} ${rIn} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
    const g=document.createElementNS(NS,"g");
    g.setAttribute("class","sdg-wedge");
    g.style.setProperty("--i",i);
    const p=document.createElementNS(NS,"path");
    p.setAttribute("d",path);
    p.setAttribute("fill",SDG_COLORS[i]);
    g.appendChild(p);
    if(showIcons){
      const am=(-90 + (i+0.5)*seg)*Math.PI/180;
      const rm=(rOut+rIn)/2;
      const [mx,my]=pol(rm,am);
      const ic=document.createElementNS(NS,"g");
      const s=0.46;                       // glyph scale within wedge
      ic.setAttribute("transform",`translate(${(mx-50*s).toFixed(2)} ${(my-50*s).toFixed(2)}) scale(${s})`);
      ic.innerHTML=SDG_GLYPHS[i];
      g.appendChild(ic);
    }
    S.appendChild(g);
  }
  wrap.appendChild(S);
  if(showCenter){
    const c=document.createElement("div");
    c.className="sdg-wheel-center"+(dark?" dark":" light");
    c.innerHTML=`<span class="sdg-c1">SUSTAINABLE</span><span class="sdg-c1">DEVELOPMENT</span><span class="sdg-c2">G<i class="sdg-dot"></i>ALS</span>`;
    wrap.appendChild(c);
  }
  return wrap;
}

/* ── Tile grid: numbered coloured squares ───────────────────────────── */
function renderSdgTiles(el){
  const n=sdgGoals(el);
  const showTitle = el.sdgTitles!==false;
  const showIcons = el.sdgIcons!==false;
  const cols = Math.max(1,Math.min(17, Number(el.sdgCols)|| (n>=15?6:(n>=8?5:(n>=4?4:n)))));
  const wrap=document.createElement("div");
  wrap.className="sdg-tiles"+(el.objAnim===false?" sdg-static":"");
  wrap.style.setProperty("--sdg-cols",cols);
  for(let i=0;i<n;i++){
    const t=document.createElement("div");
    t.className="sdg-tile";
    t.style.setProperty("--c",SDG_COLORS[i]);
    t.style.setProperty("--i",i);
    const icon = showIcons
      ? `<svg class="sdg-tile-icon" viewBox="0 0 100 100">${SDG_GLYPHS[i]}</svg>`
      : "";
    const title = showTitle
      ? `<span class="sdg-tile-title">${SDG_TITLES[i].toUpperCase()}</span>`
      : "";
    t.innerHTML=`<div class="sdg-tile-head"><b class="sdg-tile-num">${i+1}</b>${title}</div>${icon}`;
    wrap.appendChild(t);
  }
  return wrap;
}

/* ════════════════════════════════════════════════════════════════════
   Coffee-infographic objects.
   Two reusable objects modelled on the uploaded reference:
     • coffee_segments — a take-away cup with a lid, split into stacked
       brown bands. Each band can carry its own % label. Lightest at top,
       darkest at the base, exactly like the reference.
     • info_node — a white disc holding a simple white-on-blue line icon
       (mug / pot / carton / box / beans) with a small caption beneath.
   Both draw their own SVG so they sit cleanly on any background and scale
   with the slide. White line-icons are originals in a flat infographic style.
   ──────────────────────────────────────────────────────────────────── */

/* Default 4-band brown ramp (top→bottom = light→dark), matching the image. */
const COFFEE_BANDS_DEFAULT = [
  {label:"100%", color:"#a9805c"},
  {label:"",     color:"#8c6443"},
  {label:"50%",  color:"#6f4a2e"},
  {label:"",     color:"#56371f"},
];

function coffeeBands(el){
  let bands = Array.isArray(el.bands) && el.bands.length ? el.bands : COFFEE_BANDS_DEFAULT;
  // clamp to a sane range
  bands = bands.slice(0, 8).map(b=>({label:b.label||"", color:b.color||"#6f4a2e"}));
  return bands;
}

/* ── Segmented take-away cup ─────────────────────────────────────────── */
function renderCoffeeSegments(el){
  const bands = coffeeBands(el);
  const n = bands.length;
  const wrap=document.createElement("div");
  wrap.className="coffee-seg"+(el.objAnim===false?" coffee-static":"");
  const NS="http://www.w3.org/2000/svg";
  // Cup body is a downward taper (wider at top). Coordinates in a 200×300 box.
  const topY=64, botY=292, topHalf=78, botHalf=58, cx=100;
  const xAt=(y)=>{ const t=(y-topY)/(botY-topY); return {l:cx-(topHalf+(botHalf-topHalf)*t), r:cx+(topHalf+(botHalf-topHalf)*t)}; };
  const S=document.createElementNS(NS,"svg");
  S.setAttribute("viewBox","0 0 200 300");
  S.setAttribute("class","coffee-seg-svg");
  S.setAttribute("preserveAspectRatio","xMidYMid meet");

  // clip to the cup body so bands fill it exactly
  const cid="cup"+Math.random().toString(36).slice(2,8);
  const tL=xAt(topY), bL=xAt(botY);
  const bodyPath=`M ${tL.l} ${topY} L ${tL.r} ${topY} L ${bL.r} ${botY} L ${bL.l} ${botY} Z`;
  S.innerHTML=`<defs><clipPath id="${cid}"><path d="${bodyPath}"/></clipPath></defs>`;

  // bands
  const g=document.createElementNS(NS,"g");
  g.setAttribute("clip-path",`url(#${cid})`);
  const bandH=(botY-topY)/n;
  bands.forEach((b,i)=>{
    const y0=topY+i*bandH, y1=y0+bandH+0.5;
    const r=document.createElementNS(NS,"rect");
    r.setAttribute("x","0");r.setAttribute("y",y0.toFixed(1));
    r.setAttribute("width","200");r.setAttribute("height",(y1-y0).toFixed(1));
    r.setAttribute("fill",b.color);
    r.setAttribute("class","coffee-band");
    r.style.setProperty("--i",i);
    g.appendChild(r);
  });
  S.appendChild(g);

  // cup outline
  const outline=document.createElementNS(NS,"path");
  outline.setAttribute("d",bodyPath);
  outline.setAttribute("class","coffee-outline");
  S.appendChild(outline);

  // lid: a trapezoid sitting on top + a small lip
  const lid=document.createElementNS(NS,"g");
  lid.setAttribute("class","coffee-lid");
  lid.innerHTML=
    `<path d="M ${tL.l-6} ${topY} L ${tL.r+6} ${topY} L ${tL.r-4} ${topY-34} L ${tL.l+4} ${topY-34} Z" fill="#ffffff"/>`+
    `<rect x="${tL.l+10}" y="${topY-46}" width="${(tL.r-tL.l)-20}" height="14" rx="7" fill="#ffffff"/>`;
  S.appendChild(lid);

  wrap.appendChild(S);

  // percentage labels + optional sub-captions positioned over their band
  const showLabels = el.bandLabels!==false;
  if(showLabels){
    wrap.style.setProperty("--seg-num-color", el.numberColor||"#ffffff");
    bands.forEach((b,i)=>{
      const midFrac=((i+0.5)*bandH+topY)/300;     // 0..1 down the box
      if(b.label){
        const lab=document.createElement("div");
        lab.className="coffee-band-num";
        lab.style.top=(midFrac*100).toFixed(2)+"%";
        lab.textContent=b.label;
        wrap.appendChild(lab);
      }
      if(b.sub){
        const sub=document.createElement("div");
        sub.className="coffee-band-sub";
        sub.style.top=(midFrac*100).toFixed(2)+"%";
        sub.innerHTML=escHTML(b.sub).replace(/\n/g,"<br>");
        wrap.appendChild(sub);
      }
    });
  }
  return wrap;
}

/* ── Icon node (white disc + line icon + caption) ────────────────────── */
const NODE_ICONS = {
  mug:   `<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M30 44 h34 v22 a17 17 0 0 1 -34 0 Z"/><path d="M64 48 h10 a9 9 0 0 1 0 18 h-10"/><path d="M40 30 q5 -7 0 -14 M52 30 q5 -7 0 -14"/></g>`,
  pot:   `<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M34 46 h30 l-3 26 a12 12 0 0 1 -24 0 Z"/><path d="M64 50 l14 -8 M70 40 l8 -2"/><path d="M40 46 h24"/></g>`,
  carton:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><path d="M34 40 h22 v34 h-22 Z"/><path d="M34 40 l11 -10 l11 10"/><circle cx="45" cy="58" r="5"/><path d="M60 46 h12 v28 h-12 Z"/></g>`,
  box:   `<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><path d="M30 44 l24 -10 l24 10 l-24 10 Z"/><path d="M30 44 v22 l24 10 v-22 Z"/><path d="M78 44 v22 l-24 10 v-22 Z"/></g>`,
  beans: `<g fill="none" stroke="#1f5e86" stroke-width="4.5" stroke-linecap="round"><ellipse cx="44" cy="50" rx="11" ry="16" transform="rotate(-24 44 50)"/><path d="M44 38 q-4 12 0 24" transform="rotate(-24 44 50)"/><ellipse cx="64" cy="58" rx="11" ry="16" transform="rotate(-24 64 58)"/><path d="M64 46 q-4 12 0 24" transform="rotate(-24 64 58)"/></g>`,
  clipboard:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><rect x="34" y="32" width="32" height="40" rx="4"/><rect x="42" y="26" width="16" height="9" rx="3" fill="#1f5e86"/><path d="M40 46 h20 M40 54 h20 M40 62 h12"/></g>`,
  megaphone:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><path d="M34 46 v10 h8 l22 12 V34 l-22 12 Z"/><path d="M42 56 v10 h6 v-8"/><path d="M70 44 q8 6 0 16"/></g>`,
  plane:`<g fill="#1f5e86"><path d="M30 50 L76 32 L60 72 L52 58 Z"/><path d="M52 58 L60 72 L48 66 Z" opacity=".55"/></g>`,
  person:`<g fill="#1f5e86"><circle cx="50" cy="40" r="10"/><path d="M32 70 a18 18 0 0 1 36 0 Z"/></g>`,
  handshake:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M30 46 l10 -4 l10 6 l10 -6 l10 4"/><path d="M40 48 l-8 8 q-2 4 2 6 l10 8 q3 2 6 0 l12 -10"/><path d="M50 56 l8 7 M44 62 l6 5"/></g>`,
  diamond:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><path d="M36 38 h28 l10 12 -24 26 -24 -26 Z"/><path d="M26 50 h48 M44 38 l-8 12 14 26 M64 38 l8 12 -14 26"/></g>`,
  bulb:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M50 28 a16 16 0 0 1 10 28 v6 h-20 v-6 a16 16 0 0 1 10 -28 Z"/><path d="M44 70 h12 M46 76 h8"/></g>`,
  briefcase:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><rect x="30" y="44" width="40" height="28" rx="4"/><path d="M42 44 v-6 h16 v6"/><path d="M30 56 h40"/></g>`,
  clock:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linecap="round"><circle cx="50" cy="52" r="22"/><path d="M50 40 v12 l8 6"/></g>`,
  chart:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M32 70 V50 M46 70 V42 M60 70 V34"/><path d="M30 40 l14 -8 l10 4 l18 -12"/></g>`,
  search:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linecap="round"><circle cx="46" cy="48" r="14"/><path d="M57 59 l12 12"/></g>`,
  dollar:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linecap="round"><path d="M58 40 q-16 -6 -16 6 q0 8 16 8 q16 0 16 8 q0 12 -16 6"/><path d="M50 32 v44"/></g>`,
  tap:`<g fill="#1f5e86"><rect x="40" y="40" width="30" height="12" rx="3"/><path d="M28 44 h14 v8 h-14 q-4 0 -4 -4 q0 -4 4 -4 Z"/><rect x="50" y="28" width="8" height="14" rx="2"/><rect x="44" y="24" width="20" height="6" rx="3"/><path d="M28 52 v6 h8 v-6 Z"/><path d="M32 62 q-5 8 0 12 q5 -4 0 -12 Z"/></g>`,
  chat:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><path d="M28 38 h44 v26 h-30 l-10 9 v-9 h-4 Z"/><path d="M40 48 h20 M40 56 h12"/></g>`,
  /* ── v31 icon pack ── */
  target:`<g fill="none" stroke="#1f5e86" stroke-width="5"><circle cx="50" cy="52" r="22"/><circle cx="50" cy="52" r="12"/><circle cx="50" cy="52" r="3.5" fill="#1f5e86"/></g>`,
  rocket:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M50 26 q14 10 10 34 l-10 10 -10 -10 q-4 -24 10 -34 Z"/><circle cx="50" cy="46" r="6"/><path d="M40 60 l-8 8 M60 60 l8 8 M50 70 v8"/></g>`,
  shield:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><path d="M50 26 l22 8 v18 q0 18 -22 26 q-22 -8 -22 -26 V34 Z"/><path d="M40 52 l7 7 l14 -16" stroke-linecap="round"/></g>`,
  gear:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linecap="round"><circle cx="50" cy="52" r="10"/><path d="M50 30 v8 M50 66 v8 M28 52 h8 M64 52 h8 M35 37 l6 6 M59 61 l6 6 M65 37 l-6 6 M41 61 l-6 6"/></g>`,
  globe:`<g fill="none" stroke="#1f5e86" stroke-width="5"><circle cx="50" cy="52" r="22"/><ellipse cx="50" cy="52" rx="10" ry="22"/><path d="M29 45 h42 M29 59 h42"/></g>`,
  heart:`<g fill="#1f5e86"><path d="M50 74 q-24 -16 -24 -32 q0 -12 12 -12 q8 0 12 8 q4 -8 12 -8 q12 0 12 12 q0 16 -24 32 Z"/></g>`,
  trophy:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><path d="M38 30 h24 v14 a12 12 0 0 1 -24 0 Z"/><path d="M38 34 h-8 a8 8 0 0 0 8 12 M62 34 h8 a8 8 0 0 1 -8 12"/><path d="M50 56 v10 M40 72 h20 M44 66 h12"/></g>`,
  book:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><path d="M50 36 q-8 -6 -20 -6 v40 q12 0 20 6 q8 -6 20 -6 V30 q-12 0 -20 6 Z"/><path d="M50 36 v40"/></g>`,
  leaf:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M32 68 q-4 -34 40 -38 q4 34 -28 38 q-6 0 -12 0 Z"/><path d="M34 66 q14 -16 30 -28"/></g>`,
  flag:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><path d="M34 78 V28"/><path d="M34 30 h34 l-8 10 l8 10 H34"/></g>`,
  calendar:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><rect x="30" y="34" width="40" height="38" rx="4"/><path d="M30 46 h40 M40 28 v10 M60 28 v10"/><path d="M40 56 h6 M54 56 h6 M40 64 h6" stroke-linecap="round"/></g>`,
  pin:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><path d="M50 76 q-18 -18 -18 -30 a18 18 0 0 1 36 0 q0 12 -18 30 Z"/><circle cx="50" cy="46" r="7"/></g>`,
  cloud:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><path d="M36 68 a12 12 0 0 1 0 -24 a16 16 0 0 1 30 -4 a11 11 0 0 1 2 28 Z"/></g>`,
  lock:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><rect x="34" y="48" width="32" height="26" rx="4"/><path d="M40 48 v-8 a10 10 0 0 1 20 0 v8"/><circle cx="50" cy="60" r="4" fill="#1f5e86"/></g>`,
  wifi:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linecap="round"><path d="M30 48 q20 -16 40 0"/><path d="M37 57 q13 -10 26 0"/><path d="M44 66 q6 -5 12 0"/><circle cx="50" cy="74" r="3" fill="#1f5e86"/></g>`,
  medal:`<g fill="none" stroke="#1f5e86" stroke-width="5" stroke-linejoin="round"><circle cx="50" cy="58" r="14"/><path d="M42 46 l-8 -18 h12 l4 8 l4 -8 h12 l-8 18"/><path d="M45 58 l4 4 l7 -8" stroke-linecap="round"/></g>`,
  users:`<g fill="#1f5e86"><circle cx="41" cy="44" r="8"/><path d="M27 68 a14 14 0 0 1 28 0 Z"/><circle cx="62" cy="42" r="7" opacity=".65"/><path d="M55 66 a12 12 0 0 1 20 0 Z" opacity=".65"/></g>`,
  bolt:`<g fill="#1f5e86"><path d="M54 26 L36 56 h12 l-4 24 l20 -32 H52 Z"/></g>`,
};
// Food icons (FOOD_ICONS) are merged into the node-icon set just below where
// FOOD_ICONS is defined, so info_node can also carry an orange/bread/etc.
function renderInfoNode(el){
  const icon = NODE_ICONS[el.nodeIcon] || NODE_ICONS.mug;
  const wrap=document.createElement("div");
  wrap.className="info-node"+(el.objAnim===false?" info-static":"");
  if(el.nodeTextColor) wrap.style.setProperty("--node-text", el.nodeTextColor);
  const showTitle = el.nodeShowTitle!==false;
  const showText  = el.nodeShowText!==false;
  const title = el.nodeTitle || "Lorem ipsum";
  const body  = el.nodeText  || "dolor sit amet, consectetuer";
  const cap = (showTitle||showText)
    ? `<div class="info-node-cap">${showTitle?`<b>${escHTML(title)}</b>`:""}${showText?`<span>${escHTML(body)}</span>`:""}</div>`
    : "";
  wrap.innerHTML=
    `<svg class="info-node-svg" viewBox="0 0 108 108"><circle cx="54" cy="48" r="46" fill="#ffffff"/>${icon}</svg>`+cap;
  return wrap;
}

/* ════════════════════════════════════════════════════════════════════
   Food-infographic objects.
   Reusable building blocks modelled on the three uploaded references:
     • diet_plate  — a pie chart resting on a white plate, with a fork on
       the left and a knife on the right (the "Balanced Diet" reference).
     • food_wheel  — a segmented donut with per-segment % labels and a
       centred title (the "Healthy Food" reference). Pairs with info_node
       circles + the FOOD_ICONS set for the radial food callouts.
   Colours/labels are fully editable through each object's `segments` array.
   ──────────────────────────────────────────────────────────────────── */

/* Flat colour food/utensil icons (originals) in a 0..100 viewBox. */
const FOOD_ICONS = {
  orange: `<circle cx="50" cy="50" r="34" fill="#f59e0b"/><circle cx="50" cy="50" r="26" fill="#fbbf24"/>`+
    Array.from({length:8},(_,i)=>{const a=i*Math.PI/4;return `<path d="M50 50 L${(50+26*Math.cos(a)).toFixed(1)} ${(50+26*Math.sin(a)).toFixed(1)}" stroke="#f59e0b" stroke-width="2"/>`;}).join("")+
    `<circle cx="50" cy="50" r="5" fill="#fff7ed"/>`,
  bread:  `<path d="M24 54 q0 -26 26 -26 q26 0 26 26 v18 q0 4 -4 4 H28 q-4 0 -4 -4 Z" fill="#f4c542"/><path d="M30 58 q0 -18 20 -18 q20 0 20 18" fill="none" stroke="#e0a82e" stroke-width="2"/><circle cx="42" cy="52" r="2.5" fill="#e0a82e"/><circle cx="56" cy="58" r="2.5" fill="#e0a82e"/><circle cx="50" cy="46" r="2" fill="#e0a82e"/>`,
  milk:   `<path d="M40 30 h20 v8 l6 10 v26 q0 4 -4 4 H38 q-4 0 -4 -4 V48 l6 -10 Z" fill="#dbeafe"/><rect x="40" y="54" width="20" height="14" fill="#fff"/><path d="M40 30 h20 v8 H40 Z" fill="#bfdbfe"/>`,
  cheese: `<path d="M28 60 L66 44 q8 -3 8 6 v16 q0 4 -4 4 H32 q-4 0 -4 -4 Z" fill="#fbbf24"/><circle cx="44" cy="60" r="3" fill="#f59e0b"/><circle cx="56" cy="56" r="2.5" fill="#f59e0b"/><circle cx="62" cy="64" r="2" fill="#f59e0b"/>`,
  meat:   `<ellipse cx="52" cy="52" rx="22" ry="16" fill="#e8503a"/><ellipse cx="52" cy="52" rx="14" ry="9" fill="#f08a78"/><path d="M30 46 q-12 -6 -16 2 q8 2 10 8" fill="#f4f4f4" stroke="#d8d8d8" stroke-width="1.5"/>`,
  broccoli:`<rect x="46" y="56" width="8" height="18" rx="3" fill="#86b94b"/><circle cx="42" cy="46" r="11" fill="#4c8c3f"/><circle cx="58" cy="46" r="11" fill="#4c8c3f"/><circle cx="50" cy="38" r="12" fill="#5a9e48"/>`,
  apple:  `<path d="M50 36 q-16 -2 -16 18 q0 18 16 22 q16 -4 16 -22 q0 -20 -16 -18 Z" fill="#e8503a"/><path d="M50 36 q2 -8 8 -10" fill="none" stroke="#4c8c3f" stroke-width="3" stroke-linecap="round"/><ellipse cx="60" cy="30" rx="6" ry="3" fill="#5a9e48" transform="rotate(-20 60 30)"/>`,
  fish:   `<path d="M28 50 q14 -16 36 0 q-14 16 -36 0 Z" fill="#7cc6e0"/><path d="M64 50 l12 -9 v18 Z" fill="#5bb0cf"/><circle cx="40" cy="47" r="2.5" fill="#0e4a5e"/>`,
};
// info_node can carry any food icon too (orange/bread/milk/cheese/meat/…).
if(typeof NODE_ICONS!=="undefined") Object.assign(NODE_ICONS, FOOD_ICONS);

/* ── diet_plate: pie on a plate with fork + knife ────────────────────── */
function dietSegments(el){
  const def=[
    {label:"40%",sub:"fruits & vegetables",color:"#a9cf5a"},
    {label:"25%",sub:"cellulose",color:"#bfa074"},
    {label:"25%",sub:"protein",color:"#8fd0d8"},
    {label:"10%",sub:"fats",color:"#f5cd2a"},
  ];
  let segs=Array.isArray(el.segments)&&el.segments.length?el.segments:def;
  return segs.slice(0,10).map(s=>({label:s.label||"",sub:s.sub||"",color:s.color||"#cccccc",value:Number(s.value)|| (parseFloat(s.label)||1)}));
}
function renderDietPlate(el){
  const segs=dietSegments(el);
  const wrap=document.createElement("div");
  wrap.className="diet-plate"+(el.objAnim===false?" diet-static":"");
  const NS="http://www.w3.org/2000/svg";
  const S=document.createElementNS(NS,"svg");
  S.setAttribute("viewBox","0 0 400 360");
  S.setAttribute("class","diet-plate-svg");
  S.setAttribute("preserveAspectRatio","xMidYMid meet");
  const showUtensils = el.utensils!==false;
  let inner="";
  // fork (left) and knife (right)
  if(showUtensils){
    inner+=`<g fill="#5b5f63">`+
      // fork
      `<rect x="40" y="150" width="9" height="150" rx="4"/>`+
      `<path d="M30 96 v40 q0 10 14 12 q14 -2 14 -12 v-40 h-4 v36 h-3 v-36 h-4 v36 h-3 v-36 h-4 v36 h-3 v-36 Z"/>`+
      // knife
      `<rect x="351" y="150" width="9" height="150" rx="4"/>`+
      `<path d="M348 96 q22 4 22 40 q0 16 -10 18 V96 Z"/>`+
    `</g>`;
  }
  // plate: two soft discs
  inner+=`<circle cx="200" cy="186" r="150" fill="#ffffff"/>`+
         `<circle cx="200" cy="186" r="150" fill="none" stroke="#e9edef" stroke-width="2"/>`+
         `<circle cx="200" cy="186" r="120" fill="#fbfdfd" stroke="#eef2f3" stroke-width="2"/>`;
  // pie
  const cx=200, cy=186, r=108;
  const total=Math.max(1,segs.reduce((a,s)=>a+s.value,0));
  let a0=-Math.PI/2;
  segs.forEach((s,i)=>{
    const ang=(s.value/total)*Math.PI*2, a1=a0+ang;
    const x0=(cx+r*Math.cos(a0)).toFixed(2), y0=(cy+r*Math.sin(a0)).toFixed(2);
    const x1=(cx+r*Math.cos(a1)).toFixed(2), y1=(cy+r*Math.sin(a1)).toFixed(2);
    const large=ang>Math.PI?1:0;
    inner+=`<path class="diet-slice" style="--i:${i}" d="M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z" fill="${s.color}"/>`;
    a0=a1;
  });
  S.innerHTML=inner;
  wrap.appendChild(S);
  // labels positioned over each slice (HTML so they scale + wrap)
  a0=-Math.PI/2;
  segs.forEach(s=>{
    const ang=(s.value/total)*Math.PI*2, mid=a0+ang/2; a0+=ang;
    const lx=(cx+r*0.6*Math.cos(mid))/400*100, ly=(cy+r*0.6*Math.sin(mid))/360*100;
    const lab=document.createElement("div");
    lab.className="diet-label";
    lab.style.left=lx.toFixed(2)+"%"; lab.style.top=ly.toFixed(2)+"%";
    lab.innerHTML=`<b>${escHTML(s.label)}</b>${s.sub?`<span>${escHTML(s.sub)}</span>`:""}`;
    wrap.appendChild(lab);
  });
  return wrap;
}

/* ── food_wheel: segmented donut with % labels + centre title ────────── */
function wheelSegments(el){
  const def=[
    {label:"15%",color:"#e8821e"},
    {label:"10%",color:"#f5cd2a"},
    {label:"35%",color:"#5a9e48"},
    {label:"25%",color:"#e8503a"},
    {label:"20%",color:"#5bb0cf"},
  ];
  let segs=Array.isArray(el.segments)&&el.segments.length?el.segments:def;
  return segs.slice(0,12).map(s=>({label:s.label||"",color:s.color||"#cccccc",value:Number(s.value)||(parseFloat(s.label)||1)}));
}
function renderFoodWheel(el){
  const segs=wheelSegments(el);
  const wrap=document.createElement("div");
  wrap.className="food-wheel"+(el.objAnim===false?" food-wheel-static":"");
  const NS="http://www.w3.org/2000/svg";
  const S=document.createElementNS(NS,"svg");
  S.setAttribute("viewBox","0 0 400 400");
  S.setAttribute("class","food-wheel-svg");
  S.setAttribute("preserveAspectRatio","xMidYMid meet");
  const cx=200, cy=200, rOut=180, rIn=104, gap=0.018;
  const total=Math.max(1,segs.reduce((a,s)=>a+s.value,0));
  const pol=(r,a)=>[cx+r*Math.cos(a),cy+r*Math.sin(a)];
  let a0=-Math.PI/2, inner="";
  const mids=[];
  segs.forEach((s,i)=>{
    const ang=(s.value/total)*Math.PI*2;
    const s0=a0+gap, s1=a0+ang-gap;
    const [x0,y0]=pol(rOut,s0), [x1,y1]=pol(rOut,s1);
    const [x2,y2]=pol(rIn,s1),  [x3,y3]=pol(rIn,s0);
    const large=(s1-s0)>Math.PI?1:0;
    inner+=`<path class="fw-seg" style="--i:${i}" fill="${s.color}" d="M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${rOut} ${rOut} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} L ${x2.toFixed(2)} ${y2.toFixed(2)} A ${rIn} ${rIn} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z"/>`;
    mids.push({a:a0+ang/2,label:s.label});
    a0+=ang;
  });
  // inner hole
  inner+=`<circle cx="${cx}" cy="${cy}" r="${rIn-6}" fill="${el.centerFill||"#f3f5ed"}"/>`;
  S.innerHTML=inner;
  wrap.appendChild(S);
  // % labels on each segment
  mids.forEach(m=>{
    if(!m.label) return;
    const rm=(rOut+rIn)/2;
    const lx=(cx+rm*Math.cos(m.a))/400*100, ly=(cy+rm*Math.sin(m.a))/400*100;
    const lab=document.createElement("div");
    lab.className="fw-label";
    lab.style.left=lx.toFixed(2)+"%"; lab.style.top=ly.toFixed(2)+"%";
    lab.style.color=el.numberColor||"#ffffff";
    lab.textContent=m.label;
    wrap.appendChild(lab);
  });
  // centre title
  if(el.centerTitle!==""){
    const c=document.createElement("div");
    c.className="fw-center";
    const t=(el.centerTitle||"HEALTHY\nFOOD").split("\n");
    c.innerHTML=t.map((line,i)=>`<span class="${i===t.length-1?"fw-c2":"fw-c1"}">${escHTML(line)}</span>`).join("");
    c.style.color=el.centerColor||"#4c8c3f";
    wrap.appendChild(c);
  }
  return wrap;
}

/* ════════════════════════════════════════════════════════════════════
   Funnel objects.
   funnel_stack — an inverted stack of trapezoid bands (the classic sales /
   conversion funnel). Editable band count, per-band colour + label, an
   optional gap between bands (the floating-segments look), and a subtle 3D
   top-ellipse + side shading. Reusable on any slide; pairs with info_node
   for the side callouts.
   ──────────────────────────────────────────────────────────────────── */

const FUNNEL_PALETTE = ["#2f4fb0","#1f9e8a","#d83a3a","#e08a1e","#1f9e5a","#6f5aa8","#3aa0d8"];

function funnelBands(el){
  const def=[
    {label:"01",color:"#2f4fb0"},
    {label:"02",color:"#1f9e8a"},
    {label:"03",color:"#d83a3a"},
    {label:"04",color:"#e08a1e"},
    {label:"05",color:"#1f9e5a"},
  ];
  let bands = Array.isArray(el.bands)&&el.bands.length ? el.bands : def;
  return bands.slice(0,9).map((b,i)=>({label:b.label!=null?b.label:"",color:b.color||FUNNEL_PALETTE[i%FUNNEL_PALETTE.length],value:b.value}));
}

function renderFunnelStack(el){
  const bands=funnelBands(el);
  const n=bands.length;
  const gap = el.funnelGap!=null ? Number(el.funnelGap) : 8;   // vertical gap between bands (viewBox units)
  const pointed = el.funnelTip!==false;                         // last band tapers to a point
  const ellipse = el.funnel3d===true;                           // 3D top ellipse + segment caps
  const proportional = el.funnelProportional===true;            // band height tracks value
  const wrap=document.createElement("div");
  wrap.className="funnel-stack"+(el.objAnim===false?" funnel-static":"");
  const NS="http://www.w3.org/2000/svg";
  const VW=400, VH=400;
  const S=document.createElementNS(NS,"svg");
  S.setAttribute("viewBox",`0 0 ${VW} ${VH}`);
  S.setAttribute("class","funnel-stack-svg");
  S.setAttribute("preserveAspectRatio","xMidYMid meet");
  const cx=VW/2;
  const topHalf=190, tipHalf=pointed?0:36;          // half-widths top→bottom
  const usableH=VH-12;
  // band heights: equal by default, or proportional to value when requested
  const valOf=(b)=>{const v=Number(b.value); return isFinite(v)&&v>0?v:(parseFloat(b.label)||1);};
  const totalV=bands.reduce((a,b)=>a+valOf(b),0)||n;
  const heights=bands.map((b,i)=> proportional ? (usableH-gap*(n-1))*(valOf(b)/totalV) : (usableH-gap*(n-1))/n );
  // cumulative fraction boundaries for the taper (0..1 down the funnel)
  const fracBounds=[0]; let acc=0;
  heights.forEach(h=>{ acc+=h; fracBounds.push(acc/(usableH-gap*(n-1))); });
  const halfAt=(frac)=> topHalf + (tipHalf-topHalf)*frac;   // frac 0..1 down the funnel
  let inner="", yCur=6;
  const bandMids=[];
  bands.forEach((b,i)=>{
    const y0=yCur, y1=y0+heights[i]; yCur=y1+gap;
    const tH=halfAt(fracBounds[i]), bH=halfAt(fracBounds[i+1]);
    const last=(i===n-1);
    bandMids.push((y0+y1)/2);
    if(last && pointed){
      inner+=`<path class="funnel-band" style="--i:${i}" fill="${b.color}" d="M ${cx-tH} ${y0} L ${cx+tH} ${y0} L ${cx} ${y1} Z"/>`;
    }else{
      inner+=`<path class="funnel-band" style="--i:${i}" fill="${b.color}" d="M ${cx-tH} ${y0} L ${cx+tH} ${y0} L ${cx+bH} ${y1} L ${cx-bH} ${y1} Z"/>`;
      if(ellipse){
        inner+=`<path class="funnel-cap" d="M ${cx-bH} ${y1} A ${bH} 7 0 0 0 ${cx+bH} ${y1} A ${bH} 7 0 0 0 ${cx-bH} ${y1} Z" fill="${b.color}" opacity=".55"/>`;
      }
    }
    if(ellipse && i===0){
      inner+=`<ellipse class="funnel-top" cx="${cx}" cy="${y0}" rx="${tH}" ry="9" fill="${b.color}" opacity=".75"/>`;
    }
  });
  S.innerHTML=inner;
  wrap.appendChild(S);

  // band labels (HTML so they scale + wrap)
  const showLabels = el.bandLabels!==false;
  if(showLabels){
    wrap.style.setProperty("--funnel-num-color", el.numberColor||"#ffffff");
    bands.forEach((b,i)=>{
      if(b.label==="") return;
      const midFrac=bandMids[i]/VH;
      const lab=document.createElement("div");
      lab.className="funnel-band-num";
      lab.style.top=(midFrac*100).toFixed(2)+"%";
      lab.textContent=b.label;
      wrap.appendChild(lab);
    });
  }
  return wrap;
}

/* ════════════════════════════════════════════════════════════════════
   Extra infographic objects:
     • percent_ring — a circular progress ring with the % in the centre
       (the "67% / 43% …" donut gauges). Level + accent + label editable.
     • stat_item    — a rounded horizontal pill: a number badge on the left,
       a title and body text on the right (the "01 Contents Title …" rows).
   Both reusable on any slide and driven by the standard object controls.
   ──────────────────────────────────────────────────────────────────── */

/* ── percent_ring: circular progress + centre % ─────────────────────── */
/* ════════════════════════════════════════════════════════════════════
   ANIMATED READOUTS — a number that counts up, and a bar that loads.

   Both draw their own number, so renderObject() skips the generic badge
   for them. The digits are animated by animateCountUp() in LIVE views
   only; the editor paints the finished value so the slide is easy to lay
   out and the thumbnail reads correctly.

   Formatting rides on the node itself (data-num-*) rather than being
   looked up from the element at animation time — that way a cued reveal,
   a repaint, or the standalone HTML export all animate identically
   without needing the element object in hand.
   ──────────────────────────────────────────────────────────────────── */
function numFormat(n,spec){
  const dec=clamp(Number(spec.numberDecimals)||0,0,4);
  let s=(Number(n)||0).toFixed(dec);
  if(spec.countSep!==false){
    const parts=s.split(".");
    parts[0]=parts[0].replace(/\B(?=(\d{3})+(?!\d))/g,",");
    s=parts.join(".");
  }
  return (spec.numberPrefix||"")+s+(spec.numberSuffix||"");
}
function numAnimAttrs(el,from,to){
  return ` data-num-anim="1" data-num-from="${Number(from)||0}" data-num-to="${Number(to)||0}"`+
    ` data-num-dec="${clamp(Number(el.numberDecimals)||0,0,4)}"`+
    ` data-num-sep="${el.countSep===false?0:1}"`+
    ` data-num-pre="${escHTML(el.numberPrefix||"")}"`+
    ` data-num-suf="${escHTML(el.numberSuffix||"")}"`+
    ` data-num-dur="${Math.max(120,Number(el.countDur)||1600)}"`;
}

/* ── counter: one big number that counts up to its target ───────────── */
function renderCounter(el){
  const d=objectDef(el.objectType);
  const accent=el.accent||d.accent||"#e8482b";
  const from=Number(el.countFrom)||0;
  const to=Number(el.countTo!=null?el.countTo:100)||0;
  const wrap=document.createElement("div");
  wrap.className="hanns-counter";
  wrap.style.setProperty("--accent",accent);
  const animate=el.objAnim!==false;

  const num=document.createElement("div");
  num.className="hc-num";
  if(el.numberColor)num.style.color=el.numberColor;
  if(Number(el.numberSize)>0)num.style.fontSize=Number(el.numberSize)+"px";
  num.innerHTML=`<b${animate?numAnimAttrs(el,from,to):""}>${escHTML(numFormat(to,el))}</b>`;
  wrap.appendChild(num);

  const cap=el.label||d.label;
  if(el.showLabel!==false&&cap){
    const c=document.createElement("div");
    c.className="hc-cap";
    c.textContent=cap;
    wrap.appendChild(c);
  }
  return wrap;
}

/* ── loading_bar: a progress track that fills to el.level ────────────
   The track width reads --level, which renderObject() already sets on the
   .object-box for every fill kind — so animateLoad() sweeping that one
   variable is all the "loading" motion this needs.                     */
function renderLoadingBar(el){
  const d=objectDef(el.objectType);
  const lvl=clamp(Number(el.level)||0,0,100);
  const accent=el.accent||d.accent||"#22c55e";
  const wrap=document.createElement("div");
  wrap.className="loading-bar"+(el.barStyle==="slim"?" lb-slim":"");
  wrap.style.setProperty("--accent",accent);
  const animate=el.objAnim!==false;

  // Percent is the natural suffix here, but an author can override it.
  const spec=Object.assign({},el);
  if(spec.numberSuffix==null||spec.numberSuffix==="")spec.numberSuffix="%";

  const showLabel=el.showLabel!==undefined?el.showLabel!==false:(el.showCount!==false);
  const showValue=el.showValue!==undefined?el.showValue!==false:(el.showCount!==false);
  const head=document.createElement("div");
  head.className="lb-head";
  head.innerHTML=
    (showLabel?`<span class="lb-cap">${escHTML(el.label||d.label||"")}</span>`:"")+
    (showValue?`<b class="lb-num"${animate?numAnimAttrs(spec,0,lvl):""}>${escHTML(numFormat(lvl,spec))}</b>`:"");
  if(el.numberColor)head.style.color=el.numberColor;
  if(Number(el.numberSize)>0)head.style.fontSize=Number(el.numberSize)+"px";

  const track=document.createElement("div");
  track.className="lb-track";
  const fill=document.createElement("div");
  fill.className="lb-fill";
  track.appendChild(fill);

  wrap.appendChild(head);
  wrap.appendChild(track);
  return wrap;
}

function renderPercentRing(el){
  const d=objectDef(el.objectType);
  const lvl=clamp(Number(el.level)||0,0,100);
  const accent=el.accent||d.accent||"#2f7fb0";
  const wrap=document.createElement("div");
  wrap.className="pct-ring"+(el.objAnim===false?" pct-ring-static":"");
  wrap.style.setProperty("--accent",accent);
  const NS="http://www.w3.org/2000/svg";
  const r=80, cx=100, cy=100, C=2*Math.PI*r;
  const dash=(lvl/100*C).toFixed(2);
  const S=document.createElementNS(NS,"svg");
  S.setAttribute("viewBox","0 0 200 200");
  S.setAttribute("class","pct-ring-svg");
  S.setAttribute("preserveAspectRatio","xMidYMid meet");
  const thick=el.ringThick||16;
  S.innerHTML=
    `<circle class="pr-track" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${thick}"/>`+
    `<circle class="pr-fill" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke-width="${thick}" `+
      `stroke-linecap="round" stroke-dasharray="${dash} ${(C-dash).toFixed(2)}" `+
      `transform="rotate(-90 ${cx} ${cy})" pathLength="${C.toFixed(2)}"/>`;
  wrap.appendChild(S);
  if(el.showValue!==false){
    const num=document.createElement("div");
    num.className="pct-ring-num";
    num.style.color=el.numberColor||accent;
    const countAttr=(el.numberMode==="countup"&&el.objAnim!==false)?` data-count-to="${lvl}"`:"";
    num.innerHTML=`<b${countAttr}>${lvl}%</b>`;
    wrap.appendChild(num);
  }
  return wrap;
}

/* ── stat_item: rounded pill row (number badge + title + body) ───────── */
function renderStatItem(el){
  const d=objectDef(el.objectType);
  const accent=el.accent||d.accent||"#2f7fb0";
  const wrap=document.createElement("div");
  wrap.className="stat-item"+(el.objAnim===false?" stat-static":"");
  wrap.style.setProperty("--accent",accent);
  const num   = el.statNumber!=null ? el.statNumber : "01";
  const title = el.statTitle!=null ? el.statTitle : "Contents Title";
  const body  = el.statText!=null ? el.statText : "Get a modern presentation that is beautifully designed.";
  const showBadge = el.statShowNumber!==false;
  const showTitle = el.statShowTitle!==false;
  const showText  = el.statShowText!==false;
  const solid = el.statStyle==="solid";        // solid pill vs outline-badge style
  wrap.classList.toggle("stat-solid", solid);
  wrap.innerHTML=
    (showBadge?`<div class="stat-badge"><b>${escHTML(String(num))}</b></div>`:"")+
    `<div class="stat-body">`+
      (showTitle?`<b class="stat-title" style="color:${solid?"#fff":accent}">${escHTML(title)}</b>`:"")+
      (showText?`<span class="stat-text" style="color:${solid?"rgba(255,255,255,.9)":(el.statTextColor||"#5b6166")}">${escHTML(body)}</span>`:"")+
    `</div>`;
  return wrap;
}

/* ════════════════════════════════════════════════════════════════════
   Pie / radial objects (uploaded references batch).
     • pie_percent    — a single-value pie: an accent wedge sized to the
       level, with the remainder shown as a faded tint of the same colour.
       Optional % label in/near the wedge.
     • radial_bars    — concentric progress arcs (nested rings), each with
       its own value + colour. Editable via the `segments` array.
     • teardrop_badge — a rounded "petal" badge holding a number, the corner
       it points to rotates so 4 can pinwheel around a centre.
   ──────────────────────────────────────────────────────────────────── */

/* ── pie_percent: one filled wedge + faded remainder ────────────────── */
function renderPiePercent(el){
  const d=objectDef(el.objectType);
  const lvl=clamp(Number(el.level)||0,0,100);
  const accent=el.accent||d.accent||"#2f7fb0";
  const wrap=document.createElement("div");
  wrap.className="pie-pct"+(el.objAnim===false?" pie-pct-static":"");
  wrap.style.setProperty("--accent",accent);
  const NS="http://www.w3.org/2000/svg";
  const cx=100, cy=100, r=88;
  const ang=(lvl/100)*Math.PI*2;
  const a0=-Math.PI/2, a1=a0+ang;
  const [x0,y0]=[cx+r*Math.cos(a0), cy+r*Math.sin(a0)];
  const [x1,y1]=[cx+r*Math.cos(a1), cy+r*Math.sin(a1)];
  const large=ang>Math.PI?1:0;
  const S=document.createElementNS(NS,"svg");
  S.setAttribute("viewBox","0 0 200 200");
  S.setAttribute("class","pie-pct-svg");
  S.setAttribute("preserveAspectRatio","xMidYMid meet");
  // faded full disc (the remainder) + the accent wedge on top
  let inner=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${accent}" opacity="0.28"/>`;
  if(lvl>0 && lvl<100){
    inner+=`<path class="pie-pct-wedge" fill="${accent}" d="M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z"/>`;
  }else if(lvl>=100){
    inner+=`<circle class="pie-pct-wedge" cx="${cx}" cy="${cy}" r="${r}" fill="${accent}"/>`;
  }
  S.innerHTML=inner;
  wrap.appendChild(S);
  if(el.showValue!==false){
    const num=document.createElement("div");
    num.className="pie-pct-num";
    // place the % inside the wedge (mid-angle) by default, or centre
    const mid=a0+ang/2, rr=r*0.55;
    const px=(cx+rr*Math.cos(mid))/200*100, py=(cy+rr*Math.sin(mid))/200*100;
    if(el.numberPos==="center"){ num.style.left="50%"; num.style.top="50%"; }
    else { num.style.left=px.toFixed(1)+"%"; num.style.top=py.toFixed(1)+"%"; }
    num.style.color=el.numberColor||"#ffffff";
    const countAttr=(el.numberMode==="countup"&&el.objAnim!==false)?` data-count-to="${lvl}"`:"";
    num.innerHTML=`<b${countAttr}>${lvl}%</b>`;
    wrap.appendChild(num);
  }
  return wrap;
}

/* ── radial_bars: concentric progress arcs ──────────────────────────── */
function radialSegs(el){
  const def=[
    {label:"85%",color:"#3a7fc4",value:85},
    {label:"75%",color:"#6fae3a",value:75},
    {label:"65%",color:"#e0a81e",value:65},
    {label:"55%",color:"#e0633a",value:55},
  ];
  let segs=Array.isArray(el.segments)&&el.segments.length?el.segments:def;
  return segs.slice(0,7).map((s,i)=>({label:s.label||"",color:s.color||"#888",value:(Number(s.value)||parseFloat(s.label)||0)}));
}
function renderRadialBars(el){
  const segs=radialSegs(el);
  const wrap=document.createElement("div");
  wrap.className="radial-bars"+(el.objAnim===false?" radial-static":"");
  const NS="http://www.w3.org/2000/svg";
  const cx=110, cy=110, S=document.createElementNS(NS,"svg");
  S.setAttribute("viewBox","0 0 220 220");
  S.setAttribute("class","radial-bars-svg");
  S.setAttribute("preserveAspectRatio","xMidYMid meet");
  const n=segs.length, rOuter=96, ringGap=2, thick=(rOuter-26)/n - ringGap;
  let inner="";
  segs.forEach((s,i)=>{
    const r=rOuter - i*(thick+ringGap) - thick/2;
    const C=2*Math.PI*r;
    const dash=(clamp(s.value,0,100)/100*C);
    inner+=`<circle cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${s.color}" stroke-opacity=".18" stroke-width="${thick.toFixed(1)}"/>`;
    inner+=`<circle class="rb-fill" style="--i:${i}" cx="${cx}" cy="${cy}" r="${r.toFixed(1)}" fill="none" stroke="${s.color}" stroke-width="${thick.toFixed(1)}" stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${(C-dash).toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`;
  });
  S.innerHTML=inner;
  wrap.appendChild(S);
  return wrap;
}

/* ── teardrop_badge: rounded petal holding a number ─────────────────── */
function renderTeardropBadge(el){
  const d=objectDef(el.objectType);
  const accent=el.accent||d.accent||"#2f7fb0";
  const corner=el.dropCorner||"tl";    // which corner the petal point sits in
  const filled=el.dropStyle!=="outline";
  const rot={tl:0,tr:90,br:180,bl:270}[corner]||0;
  const wrap=document.createElement("div");
  wrap.className="drop-badge"+(el.objAnim===false?" drop-static":"");
  wrap.style.setProperty("--accent",accent);
  const NS="http://www.w3.org/2000/svg";
  const S=document.createElementNS(NS,"svg");
  S.setAttribute("viewBox","0 0 120 120");
  S.setAttribute("class","drop-badge-svg");
  S.setAttribute("preserveAspectRatio","xMidYMid meet");
  // a circle with one squared corner (teardrop), rotated to the chosen corner
  const path=`M 18 60 A 42 42 0 1 1 60 102 L 18 102 Z`;
  S.innerHTML=`<g transform="rotate(${rot} 60 60)">`+
    (filled
      ? `<path d="${path}" fill="${accent}"/>`
      : `<path d="${path}" fill="none" stroke="${accent}" stroke-width="4"/>`)+
    `</g>`;
  wrap.appendChild(S);
  const num=document.createElement("div");
  num.className="drop-badge-num";
  num.style.color = filled ? (el.numberColor||"#ffffff") : (el.numberColor||accent);
  num.textContent = el.dropNumber!=null ? el.dropNumber : "01";
  wrap.appendChild(num);
  return wrap;
}

function renderCountGrid(el){
  const wrap=document.createElement("div");wrap.className="object-grid";
  const n=miniCount(el.count, el.objectType==="wall" ? 80 : 120);
  wrap.style.setProperty("--obj-count", n);
  const icons=objectIcons(el.objectType);
  for(let i=0;i<n;i++){
    const span=document.createElement("span");span.className="object-item";
    span.textContent=icons[i%icons.length];span.style.animationDelay=((i%18)*.05)+"s";
    wrap.appendChild(span);
  }
  return wrap;
}
function renderGlass(el,mode){
  const box=document.createElement("div");box.className="object-glass "+mode;
  const lvl=clamp(Number(el.level)||0,0,100);
  box.style.setProperty("--level", lvl+"%");
  box.style.setProperty("--accent", el.accent|| (mode==="water"?"#4cc9f0":"#d8a23a"));
  // glass body, then the liquid column carrying its own surface line and
  // wave crests, then drifting bubbles, then the rim/shine on top.
  box.innerHTML=
    `<div class="glass-shine"></div>`+
    `<div class="glass-liquid">`+
      `<div class="glass-surface"></div>`+
      `<div class="glass-wave"></div>`+
    `</div>`+
    `<div class="glass-bubble b1"></div><div class="glass-bubble b2"></div>`+
    `<div class="glass-bubble b3"></div><div class="glass-bubble b4"></div>`+
    `<div class="glass-rim"></div>`;
  return box;
}
/* ── Fill-shape objects (vessels + gauge) ─────────────────────────────
   A vessel is any shape whose interior is described by a normalised
   (0..1) SVG path. The liquid is the SAME .glass-liquid element used by
   the water glass — height:var(--level), animated by liquidRise — but
   here it lives inside a wrapper that is CSS-clipped to the vessel
   outline, so it reads as the shape filling up. The number can ride the
   surface (bottom:var(--level)) or sit centred; see renderObject. */
/* Vessel interior outlines, authored directly in the SVG's 100 (wide) ×
   140 (tall) viewBox so the liquid is clipped INSIDE the same SVG — no
   reliance on external CSS clip-path, so it can never spill past the
   shape. preserveAspectRatio="none" lets the shape fill the element box,
   and a 100-wide / 140-tall box maps cleanly to bottom:level% for the
   HTML number overlay. */
const VESSEL_PATHS = {
  funnel: "M8 8 L92 8 L70 136 L30 136 Z",
  wine:   "M18 7 L82 7 C82 56 68 76 50 76 C32 76 18 56 18 7 Z",
  beer:   "M20 7 L80 7 L71 136 L29 136 Z",
  coffee: "M20 22 L80 22 L71 136 L29 136 Z",
  bar:    "M16 6 L84 6 L84 134 L16 134 Z",
};
/* The liquid only occupies a shape's interior, which is not the full box
   (a wine bowl is just the top half). {top,bottom} are the y-bounds of the
   fillable interior in the 0..140 viewBox; level maps onto that range. */
const FILL_BOUNDS = {
  funnel: {top:10, bottom:134},
  wine:   {top:10, bottom:74},
  beer:   {top:10, bottom:134},
  coffee: {top:24, bottom:134},
  bar:    {top:9,  bottom:131},
};
function isFillKind(kind){
  const d=objectDef(kind);
  return !!d.fill || kind==="water_glass" || kind==="sand_glass";
}
function vesselFurnitureSVG(shape){
  // decorative bits drawn in the same 100×140 space, over the liquid.
  // NOTE: the backtick must stay on the same line as `return` — a newline
  // after `return` triggers automatic semicolon insertion and returns undefined.
  if(shape==="coffee") return `<path class="vf" d="M16 22 L84 22 L80 9 L20 9 Z"/>`+
      `<rect class="vf" x="42" y="2.5" width="16" height="7.5" rx="3"/>`;
  if(shape==="wine") return `<line class="vf-line" x1="50" y1="76" x2="50" y2="128"/>`+
      `<ellipse class="vf-base" cx="50" cy="131" rx="21" ry="3.6"/>`;
  return "";
}
function renderVessel(el,shape){
  const d=objectDef(el.objectType);
  const lvl=clamp(Number(el.level)||0,0,100);
  const path=VESSEL_PATHS[shape]||VESSEL_PATHS.bar;
  const b=FILL_BOUNDS[shape]||FILL_BOUNDS.bar;
  const cid="vc"+uid();
  const accent=el.accent||d.accent||"#4cc9f0";
  const surfY=(b.bottom-(lvl/100)*(b.bottom-b.top));   // liquid surface y
  const fillH=(b.bottom-surfY);                          // visible column height
  const surfFrac=((140-surfY)/140*100).toFixed(2);       // surface as % from box bottom
  const bubRise=(-fillH*0.62).toFixed(1);
  const wrap=document.createElement("div");
  wrap.className="object-vessel vessel-"+shape;
  wrap.style.setProperty("--level", surfFrac+"%");        // drives the HTML number overlay
  wrap.style.setProperty("--accent", accent);
  wrap.style.setProperty("--bub-rise", bubRise+"px");
  wrap.style.setProperty("--fill-origin", b.bottom.toFixed(0)+"px");
  const bubbles = lvl>12
    ? `<circle class="v-bub b1" cx="36" cy="${(b.bottom-4).toFixed(0)}" r="2.2"/>`+
      `<circle class="v-bub b2" cx="56" cy="${(b.bottom-2).toFixed(0)}" r="1.5"/>`+
      `<circle class="v-bub b3" cx="68" cy="${(b.bottom-5).toFixed(0)}" r="2.7"/>`
    : "";
  wrap.innerHTML=
    `<svg class="vessel-svg" viewBox="0 0 100 140" preserveAspectRatio="none">`+
      `<defs><clipPath id="${cid}"><path d="${path}"/></clipPath></defs>`+
      `<path class="v-glass" d="${path}"/>`+
      `<g clip-path="url(#${cid})">`+
        `<g class="v-fill">`+
          `<rect class="v-body" x="-2" y="${surfY.toFixed(2)}" width="104" height="${(fillH+4).toFixed(2)}"/>`+
          `<ellipse class="v-surface" cx="50" cy="${surfY.toFixed(2)}" rx="62" ry="3"/>`+
        `</g>`+
        bubbles+
      `</g>`+
      vesselFurnitureSVG(shape)+
      `<path class="v-outline" d="${path}" vector-effect="non-scaling-stroke"/>`+
    `</svg>`;
  return wrap;
}
function renderGauge(el,showValue=true){
  const d=objectDef(el.objectType);
  const lvl=clamp(Number(el.level)||0,0,100);
  const wrap=document.createElement("div");
  wrap.className="object-gauge";
  wrap.style.setProperty("--accent", el.accent||d.accent||"#22c55e");
  // needle: -90deg at 0%, +90deg at 100%
  wrap.style.setProperty("--angle", (lvl*1.8-90).toFixed(1)+"deg");
  const ang=Math.PI*(1-lvl/100);                  // fill-arc end angle
  const cx=100, cy=100, r=80;
  const ex=(cx+r*Math.cos(ang)).toFixed(1);
  const ey=(cy-r*Math.sin(ang)).toFixed(1);
  // The fill sweeps at most a half-circle (0→100% = 180°), so the
  // large-arc-flag is ALWAYS 0. Setting it to 1 above 50% drew the
  // long way round, which is what broke the dial.
  const countAttr = (el.numberMode==="countup" && el.objAnim!==false) ? ` data-count-to="${lvl}"` : "";
  wrap.innerHTML=
    `<svg class="gauge-svg" viewBox="0 0 200 124" preserveAspectRatio="xMidYMid meet">`+
      `<path class="g-track" d="M20 100 A80 80 0 0 1 180 100"/>`+
      `<path class="g-fill" d="M20 100 A80 80 0 0 1 ${ex} ${ey}" pathLength="100"/>`+
      `<g class="g-needle"><line x1="100" y1="100" x2="100" y2="28"/><circle cx="100" cy="100" r="8"/></g>`+
    `</svg>`+
    (showValue ? `<div class="gauge-num"><b${countAttr}>${lvl}%</b></div>` : "");
  return wrap;
}
function renderTeleprompter(el,{live=false}={}){
  const box=document.createElement("div");
  box.className="teleprompter-obj"+(live?" teleprompter-live":"");
  if(live){
    // Audience never sees the script. Render an empty, zero-visual node.
    box.setAttribute("aria-hidden","true");
    return box;
  }
  // Editor placeholder: a labelled card the presenter can select & move.
  const script=(el.script||"").trim();
  const words=script?script.split(/\s+/).length:0;
  // ~130 wpm reading pace estimate for the presenter's convenience
  const mins=words?Math.max(1,Math.round(words/130)):0;
  box.innerHTML=
    `<div class="tp-ph-head"><span class="tp-ph-ic">🎤</span>`+
    `<span class="tp-ph-title">${escHTML(el.label||"Teleprompter script")}</span></div>`+
    `<div class="tp-ph-body">${script?escHTML(script.slice(0,140))+(script.length>140?"…":""):"Click here, then paste your speech in the inspector →"}</div>`+
    `<div class="tp-ph-foot">Presenter-only · ${words?words+" words · ~"+mins+" min":"no script yet"} · hidden from audience</div>`;
  return box;
}

function renderObject(el){
  // Legacy migration: the old emoji-count "animals" object became the cow actor.
  if(el.objectType==="animals") el.objectType="cow";
  const d=objectDef(el.objectType);
  const fill=isFillKind(el.objectType);
  const lvl=clamp(Number(el.level)||0,0,100);
  // Independent show controls. Back-compat: older slides only stored
  // `showCount`, which governed both — so fall back to it when the newer
  // per-field flags are absent.
  const showValue = (el.showValue!==undefined) ? el.showValue!==false : (el.showCount!==false);
  const showLabel = (el.showLabel!==undefined) ? el.showLabel!==false : (el.showCount!==false);
  const box=document.createElement("div");
  box.className="object-box object-"+(el.objectType||"custom")
    +(el.hideContainer?" object-bare":"")
    +(el.objAnim===false?" object-static":"");
  box.style.setProperty("--accent", el.accent||d.accent||"#4cc9f0");
  if(fill) box.style.setProperty("--level", lvl+"%");
  // Visual zoom of the inner art WITHOUT changing the container box. The
  // scale is applied to the inner visual only (see .object-art in CSS); the
  // box keeps its w/h and clips overflow, so the art grows in place.
  const scale = clamp(Number(el.objScale)||1, 0.4, 4);
  box.style.setProperty("--obj-scale", scale);
  if(scale!==1) box.classList.add("object-scaled");
  // Editable readout styling. These override the built-in per-object
  // defaults only when set; an empty colour / 0 size means "use default".
  if(el.numberColor) box.style.setProperty("--num-color", el.numberColor);
  const nSize = Number(el.numberSize)||0;
  if(nSize>0){ box.style.setProperty("--num-size", nSize+"px"); box.classList.add("object-num-fixed"); }

  // ── inner visual ─────────────────────────────────────────────────
  let art;
  if(el.objectType==="water_glass") art=renderGlass(el,"water");
  else if(el.objectType==="sand_glass") art=renderGlass(el,"sand");
  else if(el.objectType==="glass_cup") art=renderGlass(Object.assign({},el,{level:0}),"empty");
  else if(el.objectType==="gauge") art=renderGauge(el,showValue);
  else if(el.objectType==="sdg_wheel" || el.objectType==="sdg") art=renderSdgWheel(el);
  else if(el.objectType==="sdg_tiles") art=renderSdgTiles(el);
  else if(el.objectType==="coffee_segments") art=renderCoffeeSegments(el);
  else if(el.objectType==="info_node") art=renderInfoNode(el);
  else if(el.objectType==="diet_plate") art=renderDietPlate(el);
  else if(el.objectType==="food_wheel") art=renderFoodWheel(el);
  else if(el.objectType==="funnel_stack") art=renderFunnelStack(el);
  else if(el.objectType==="counter") art=renderCounter(el);
  else if(el.objectType==="loading_bar") art=renderLoadingBar(el);
  else if(el.objectType==="percent_ring") art=renderPercentRing(el);
  else if(el.objectType==="stat_item") art=renderStatItem(el);
  else if(el.objectType==="pie_percent") art=renderPiePercent(el);
  else if(el.objectType==="radial_bars") art=renderRadialBars(el);
  else if(el.objectType==="teardrop_badge") art=renderTeardropBadge(el);
  else if(d.shape && VESSEL_PATHS[d.shape]) art=renderVessel(el,d.shape);
  else if(window.HannsActors && window.HannsActors.isActor(el.objectType)) art=window.HannsActors.renderActor(el);
  else art=renderCountGrid(el);
  art.classList.add("object-art");
  box.appendChild(art);

  // Actors are a single character, not a countable stack — no number badge.
  // They keep an optional label caption below (respecting Show label).
  if(window.HannsActors && window.HannsActors.isActor(el.objectType)){
    const showActorLabel = (el.showLabel!==undefined) ? el.showLabel!==false : (el.showCount!==false);
    const actorLabel = el.label || d.label;
    if(showActorLabel && actorLabel){
      const cap=document.createElement("div");cap.className="object-caption";cap.textContent=actorLabel;box.appendChild(cap);
    }
    return box;
  }

  // SDG composites carry their own captions/labels — skip the generic badge.
  if(el.objectType==="sdg_wheel" || el.objectType==="sdg_tiles" || el.objectType==="sdg"
     || el.objectType==="coffee_segments" || el.objectType==="info_node"
     || el.objectType==="diet_plate" || el.objectType==="food_wheel"
     || el.objectType==="funnel_stack"
     || el.objectType==="percent_ring" || el.objectType==="stat_item"
     || el.objectType==="pie_percent" || el.objectType==="radial_bars"
     || el.objectType==="teardrop_badge"
     || el.objectType==="counter" || el.objectType==="loading_bar") return box;

  // ── the number + label (independent) ─────────────────────────────
  const pos = el.numberPos || (d.fill?"onfill":"below");
  const value = fill ? `${lvl}%` : (Number(el.count)||1).toLocaleString();
  const countAttr = (fill && el.numberMode==="countup" && el.objAnim!==false) ? ` data-count-to="${lvl}"` : "";
  const labelText = el.label || d.label;
  const onObject = fill && el.objectType!=="gauge" && (pos==="onfill"||pos==="center");

  if(el.objectType==="gauge"){
    // value sits in the dial (handled by renderGauge via showValue); the
    // name caption can show below it
    if(showLabel && labelText){const cap=document.createElement("div");cap.className="object-caption";cap.textContent=labelText;box.appendChild(cap);}
  } else if(onObject){
    if(showValue){
      const num=document.createElement("div");
      num.className="vessel-number"+(pos==="center"?" vessel-number--center":"");
      num.innerHTML=`<b${countAttr}>${value}</b>`;
      box.appendChild(num);
    }
    if(showLabel && labelText){const cap=document.createElement("div");cap.className="object-caption";cap.textContent=labelText;box.appendChild(cap);}
  } else if(showValue || showLabel){
    const badge=document.createElement("div");
    badge.className="object-badge"+((showValue&&showLabel)?"":" solo");
    badge.innerHTML=(showValue?`<b${countAttr}>${value}</b>`:"")+(showLabel?`<span>${labelText}</span>`:"");
    box.appendChild(badge);
  }
  return box;
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
    // ── advanced entrances (v31) ──
    revealUp:[{opacity:0,clipPath:"inset(100% 0 0 0)"},{opacity:1,clipPath:"inset(0 0 0 0)"}],
    bounce:[
      {opacity:0,transform:`translateY(-90px) rotate(${el.rot||0}deg)`},
      {opacity:1,transform:`translateY(0) rotate(${el.rot||0}deg)`,offset:.42},
      {transform:`translateY(-26px) rotate(${el.rot||0}deg)`,offset:.62},
      {transform:`translateY(0) rotate(${el.rot||0}deg)`,offset:.78},
      {transform:`translateY(-9px) rotate(${el.rot||0}deg)`,offset:.9},
      {opacity:1,transform:`translateY(0) rotate(${el.rot||0}deg)`}],
    elastic:[
      {opacity:0,transform:`scale(.2) rotate(${el.rot||0}deg)`},
      {opacity:1,transform:`scale(1.18) rotate(${el.rot||0}deg)`,offset:.5},
      {transform:`scale(.92) rotate(${el.rot||0}deg)`,offset:.72},
      {transform:`scale(1.05) rotate(${el.rot||0}deg)`,offset:.86},
      {opacity:1,transform:`scale(1) rotate(${el.rot||0}deg)`}],
    flipx:[{opacity:0,transform:`perspective(900px) rotateY(88deg) rotate(${el.rot||0}deg)`},
           {opacity:1,transform:`perspective(900px) rotateY(0deg) rotate(${el.rot||0}deg)`}],
    flipy:[{opacity:0,transform:`perspective(900px) rotateX(-88deg) rotate(${el.rot||0}deg)`},
           {opacity:1,transform:`perspective(900px) rotateX(0deg) rotate(${el.rot||0}deg)`}],
    spin:[{opacity:0,transform:`rotate(${(el.rot||0)-180}deg) scale(.4)`},
          {opacity:1,transform:`rotate(${el.rot||0}deg) scale(1)`}],
    skew:[{opacity:0,transform:`translateX(-90px) skewX(-18deg) rotate(${el.rot||0}deg)`},
          {opacity:1,transform:`translateX(0) skewX(0) rotate(${el.rot||0}deg)`}],
    blurzoom:[{opacity:0,filter:"blur(16px)",transform:`scale(1.35) rotate(${el.rot||0}deg)`},
              {opacity:1,filter:"blur(0)",transform:`scale(1) rotate(${el.rot||0}deg)`}],
    typewriter:[{opacity:1,clipPath:"inset(0 100% 0 0)"},{opacity:1,clipPath:"inset(0 0% 0 0)"}],
    float:[{opacity:0,transform:`translateY(26px) rotate(${el.rot||0}deg)`,filter:"blur(6px)"},
           {opacity:1,transform:`translateY(0) rotate(${el.rot||0}deg)`,filter:"blur(0)"}],
  };
  const frames=map[a]||map.fade;
  const durMap={pop:720,bounce:950,elastic:980,spin:760,typewriter:900,blurzoom:820,float:760,flipx:680,flipy:680};
  const easeMap={
    pop:"cubic-bezier(.34,1.56,.64,1)", elastic:"cubic-bezier(.34,1.56,.64,1)",
    bounce:"cubic-bezier(.22,1,.36,1)", typewriter:"steps(24,end)",
  };
  // el.animDur (seconds) lets imports/inspector override speed; el.animEase optional.
  const duration=(Number(el.animDur)>0?Number(el.animDur)*1000:(durMap[a]||620));
  const easing=el.animEase||easeMap[a]||"cubic-bezier(.22,1,.36,1)";
  node.style.opacity=0;
  node.animate(frames,{duration,delay:(el.animDelay||0)*1000,easing,fill:"both"});
}

/* Count numbers up (present / preview / cued reveal).

   Two node shapes are supported:
     [data-count-to]  the original vessel / ring / gauge percentage. Still
                      gated on el.numberMode==="countup" so no existing deck
                      changes behaviour.
     [data-num-anim]  the counter + loading-bar objects, which carry their
                      own from / to / duration / formatting on the node.
   Both ease out and land exactly on the target value.                    */
function easeOutCubic(p){return 1-Math.pow(1-p,3);}
function animateCountUp(node,el){
  if(!node||!el)return;
  const delay=(el.animDelay||0)*1000;
  function run(t,from,to,dur,fmt){
    const start=performance.now()+delay;
    t.textContent=fmt(from);
    function step(now){
      if(now<start){requestAnimationFrame(step);return;}
      const p=clamp((now-start)/dur,0,1);
      t.textContent=fmt(from+(to-from)*easeOutCubic(p));
      if(p<1)requestAnimationFrame(step);else t.textContent=fmt(to);
    }
    requestAnimationFrame(step);
  }

  // Self-describing readouts (counter, loading_bar).
  node.querySelectorAll("[data-num-anim]").forEach(t=>{
    const from=Number(t.getAttribute("data-num-from"))||0;
    const to=Number(t.getAttribute("data-num-to"))||0;
    const dur=Math.max(120,Number(t.getAttribute("data-num-dur"))||1600);
    const spec={
      numberDecimals:Number(t.getAttribute("data-num-dec"))||0,
      countSep:t.getAttribute("data-num-sep")!=="0",
      numberPrefix:t.getAttribute("data-num-pre")||"",
      numberSuffix:t.getAttribute("data-num-suf")||"",
    };
    run(t,from,to,dur,v=>numFormat(v,spec));
  });

  // Legacy percentage readouts on vessels / rings / gauges.
  if(el.type!=="object"||el.numberMode!=="countup"||el.objAnim===false)return;
  node.querySelectorAll("[data-count-to]").forEach(t=>{
    const to=Math.round(Number(t.getAttribute("data-count-to"))||0);
    const suffix=/%/.test(t.textContent||"")?"%":"";
    const dur=Math.max(120,Number(el.countDur)||1000);
    run(t,0,to,dur,v=>Math.round(v)+suffix);
  });
}

/* Sweep a percentage up from empty instead of appearing already full.

   One rAF loop drives every shape a level can take:
     --level   on .object-box   → vessels, percent bars, the loading bar
     --angle   on .object-gauge → the dial needle
     dasharray on .pr-fill      → the percent ring

   Opt-in per element via el.levelMode==="load", except for the two new
   animated kinds where loading IS the point, so they default to it.      */
function wantsLoad(el){
  if(!el||el.type!=="object"||el.objAnim===false)return false;
  if(el.levelMode==="instant")return false;
  if(el.objectType==="loading_bar"||el.objectType==="counter")return true;
  return el.levelMode==="load";
}
function animateLoad(node,el){
  if(!node||!wantsLoad(el))return;
  const lvl=clamp(Number(el.level)||0,0,100);
  const box=node.querySelector(".object-box");
  const gauge=node.querySelector(".object-gauge");
  const ring=node.querySelector(".pct-ring .pr-fill");
  if(!box&&!gauge&&!ring)return;
  const ringLen=ring?(Number(ring.getAttribute("pathLength"))||0):0;
  const dur=Math.max(120,Number(el.countDur)||1600);
  const delay=(el.animDelay||0)*1000;
  const paint=v=>{
    if(box)box.style.setProperty("--level",v.toFixed(2)+"%");
    if(gauge)gauge.style.setProperty("--angle",(v*1.8-90).toFixed(1)+"deg");
    if(ring){
      const dash=v/100*ringLen;
      ring.setAttribute("stroke-dasharray",`${dash.toFixed(2)} ${(ringLen-dash).toFixed(2)}`);
    }
  };
  paint(0);
  const start=performance.now()+delay;
  function step(now){
    if(now<start){requestAnimationFrame(step);return;}
    const p=clamp((now-start)/dur,0,1);
    paint(lvl*easeOutCubic(p));
    if(p<1)requestAnimationFrame(step);else paint(lvl);
  }
  requestAnimationFrame(step);
}

/* ── reveal-on-cue ────────────────────────────────────────────────────
   A cue-held element is painted normally — it just never gets its
   entrance. Holding it with opacity (rather than display:none) keeps its
   layout, so charts, maps and Plotly nodes that measure themselves on
   attach still size correctly before they are shown.                    */
function holdElement(node){
  if(!node)return;
  node.classList.add("el-held");
  node.style.opacity="0";
  node.style.pointerEvents="none";
}
function playElement(node,el){
  animateIn(node,el);
  animateCountUp(node,el);
  animateLoad(node,el);
}
/* Bring a held element in, or put it back.
   The presenter's tap IS the cue, so the authored delay is dropped —
   otherwise a 1.5s stagger would make the reveal feel broken.
   {instant:true} restores state after a repaint or reconnect without
   replaying the entrance, since the rendered markup already carries the
   final number and fill.                                                */
function revealElement(node,el,opts){
  if(!node)return;
  const o=opts||{};
  if(o.hide){holdElement(node);return;}
  node.classList.remove("el-held");
  node.style.pointerEvents="";
  if(o.instant){node.style.opacity="1";return;}
  playElement(node,Object.assign({},el||{},{animDelay:0}));
}
function cuedElements(slide){
  return (((slide&&slide.els)||[]).filter(e=>e&&e.revealOn==="cue"));
}

/* paint a slide into a container at native 960×540 */
function paintSlide(container,slide,{live=false,revealAll=false}={}){
  container.innerHTML="";
  container.style.background=slide.bg;
  if(slide.bgSize)container.style.backgroundSize=slide.bgSize;else container.style.backgroundSize="";
  // Animated / moving background: a CSS class drives the motion so it works
  // identically in the editor, thumbnails and the live stage. `none` clears.
  const fx=slide.bgFx||"none";
  // strip any previous bgfx-* class so re-paints don't stack them
  container.className=container.className.replace(/\bbgfx-[\w-]+/g,"").replace(/\s+/g," ").trim();
  if(fx&&fx!=="none"){
    container.classList.add("has-bgfx","bgfx-"+fx);
    // a few effects want a tinted overlay colour pulled from the slide
    if(slide.bgFxColor)container.style.setProperty("--bgfx-color",slide.bgFxColor);
  }else{
    container.classList.remove("has-bgfx");
  }
  slide.els.forEach(el=>{
    const node=renderElement(el,{live});
    container.appendChild(node);
    if(!live)return;
    // A zoom region is a marker, never a picture — it gets no entrance
    // and is never "revealed"; the presenter calls it up instead.
    if(el.type==="focus")return;
    // revealAll is for live views with no presenter to cue them — the
    // editor Preview button and the standalone HTML export.
    if(el.revealOn==="cue"&&!revealAll)holdElement(node);
    else playElement(node,el);
  });
  // Repainting a slide drops any callout that was up on the old one.
  if(typeof hideFocus==="function")hideFocus(container,{instant:true});
}

window.Hanns = {Deck,TEMPLATES,BACKGROUNDS,BG_FX,ANIMS,TRANSITIONS,PALETTE,FONTS,OBJECTS,SHAPES,
  newSlide,curSlide,selEl,paintSlide,renderElement,objectDef,
  // reveal-on-cue + animated readouts (used by hanns_present.js and the
  // phone controller)
  revealElement,cuedElements,holdElement,playElement,animateIn,animateCountUp,animateLoad,numFormat,
  // zoom regions ("focus") — authored in the editor, triggered from the
  // phone controller, painted in front of the slide by showFocus()
  makeFocus,renderFocus,focusElements,showFocus,hideFocus,activeFocusId,
  FOCUS_SHAPES,FOCUS_PLACES,
  // free-form vector shapes + the universal effect layer
  makeFreeform,renderFreeform,freeformPath,freeformPoints,freeformPreset,
  applyElFx,elFx,hasFx,FREEFORM_KINDS,BLEND_MODES,
  makeText,makeShape,makeLine,makeImage,makeVideo,makeLink,makeObject,makeCreativeShape,makeTable,makeChart,makeMap,makeGallery,W,H,$,$$,uid,clamp,genCode};

})();