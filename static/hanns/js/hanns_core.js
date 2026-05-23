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
  }
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
    "label": "Trees",
    "icon": "🌳",
    "count": 8,
    "level": 0,
    "w": 400,
    "h": 260,
    "accent": "#2f6f4f",
    "help": "Tree/orchard count"
  },
  {
    "kind": "farmer",
    "label": "Farmers",
    "icon": "🧑🏾‍🌾",
    "count": 4,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#8c6d3f",
    "help": "Farmer/worker count"
  },
  {
    "kind": "animals",
    "label": "Animals",
    "icon": "🐄",
    "count": 9,
    "level": 0,
    "w": 400,
    "h": 250,
    "accent": "#ffffff",
    "help": "Animal count"
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
    "label": "Cows",
    "icon": "🐄",
    "count": 8,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#78716c",
    "help": "Animated cows quantity object"
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
    "kind": "sdg",
    "label": "SDG icons",
    "icon": "⭕",
    "count": 17,
    "level": 0,
    "w": 360,
    "h": 230,
    "accent": "#e11d48",
    "help": "Animated sdg icons quantity object"
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
  }
];
function shapeDef(kind){return SHAPES.find(s=>s.kind===kind)||SHAPES[0];}
function objectDef(kind){return OBJECTS.find(o=>o.kind===kind)||OBJECTS[0];}

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
    chartData:[
      {label:"Jan",value:24},{label:"Feb",value:38},{label:"Mar",value:45},
      {label:"Apr",value:62},{label:"May",value:74},{label:"Jun",value:88}
    ]
  },over));
}
function makeMap(kind="gambia",over={}){
  return elBase("map",Object.assign({
    x:150,y:100,w:650,h:360,rot:0,anim:"rise",animDelay:0,
    mapKind:kind, title:kind==="gambia"?"Gambia activity map":"Activity map",
    accent:"#2f6f4f", showLabels:true,
    pins:[
      {label:"Banjul",x:28,y:44,value:12},
      {label:"Brikama",x:39,y:54,value:28},
      {label:"Soma",x:61,y:48,value:18},
      {label:"Basse",x:82,y:43,value:10}
    ]
  },over));
}

function makeObject(kind="water_glass",over={}){
  const d=objectDef(kind);
  return elBase("object",Object.assign({
    objectType:kind, label:d.label, icon:d.icon, count:d.count||1, level:d.level||0,
    accent:d.accent||"#4cc9f0", w:d.w||320, h:d.h||220,
    showCount:true, anim:"rise", animDelay:0,
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


function T_waterLevel(){return{bg:"radial-gradient(80% 80% at 50% 20%,#17405f 0%,#07131f 55%,#020509 100%)",els:[
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
function T_modernCanva(){return{bg:"radial-gradient(55% 65% at 20% 10%,#ff6a4d 0%,transparent 60%),radial-gradient(60% 80% at 90% 25%,#4cc9f0 0%,transparent 58%),linear-gradient(135deg,#1a1028,#08111f)",els:[
  makeShape("rect",{x:70,y:72,w:820,h:396,fill:"rgba(255,255,255,.13)",stroke:"rgba(255,255,255,.38)",strokeW:1,radius:34,anim:"zoom"}),
  makeText({x:110,y:112,w:520,h:90,text:"Modern presentation",font:'"Archivo Expanded","Archivo",sans-serif',size:49,weight:800,color:"#ffffff",lh:1.05,anim:"rise",animDelay:.1}),
  makeText({x:112,y:228,w:440,h:88,text:"Canva-style glass cards, gradients, animated icons and clean data objects.",size:24,color:"#e7e6ff",font:'"Archivo",sans-serif',lh:1.3,anim:"fade",animDelay:.25}),
  makeObject("people",{x:595,y:150,w:220,h:180,count:12,anim:"pop",animDelay:.3}),
  makeObject("plates",{x:600,y:330,w:190,h:88,count:5,anim:"rise",animDelay:.42}),
]};}

const BASE_TEMPLATES = [
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

const TEMPLATES = [...BASE_TEMPLATES, ...AUTO_TEMPLATES, ...DATA_TEMPLATES];

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
function newSlide(over={}){return Object.assign({id:uid(),bg:BACKGROUNDS[0].css,bgSize:null,transition:"fade",notes:"",els:[]},over);}
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
  } else if(el.type==="video"){
    inner.appendChild(renderVideo(el,{live}));
  } else if(el.type==="link"){
    inner.appendChild(renderLink(el,{live}));
  } else if(el.type==="table"){
    inner.appendChild(renderTable(el));
  } else if(el.type==="chart"){
    inner.appendChild(renderChart(el));
  } else if(el.type==="map"){
    inner.appendChild(renderMap(el));
  } else if(el.type==="object"){
    inner.appendChild(renderObject(el));
  } else if(el.type==="creative_shape"){
    inner.appendChild(renderCreativeShape(el));
  }
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
  const d=Array.isArray(el.chartData)&&el.chartData.length?el.chartData:[{label:"A",value:10,series:[10,7,4]},{label:"B",value:20,series:[20,12,8]},{label:"C",value:15,series:[15,10,5]}];
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
function renderChart(el){
  const box=document.createElement("div");box.className="chart-box chart-"+(el.chartKind||"bar");
  box.style.setProperty("--accent",el.accent||"#e8482b");
  const title=document.createElement("div");title.className="chart-title";title.textContent=el.title||"Chart";box.appendChild(title);
  const wrap=document.createElement("div");wrap.className="chart-svg-wrap";
  const S=svg("svg",{viewBox:"0 0 1000 520",preserveAspectRatio:"none"});
  const data=chartData(el);const vals=data.map(d=>d.value);const max=Math.max(1,...vals,...data.flatMap(d=>d.series||[]))*1.15;
  const kind=el.chartKind||"bar";const left=85,right=50,top=35,bottom=78,cw=1000-left-right,ch=520-top-bottom;
  const grid=svg("g",{class:"chart-grid"});for(let i=0;i<=4;i++){let y=top+ch*i/4;grid.appendChild(svg("line",{x1:left,y1:y,x2:1000-right,y2:y}));}S.appendChild(grid);
  if(!["pie","donut","radar","gauge","treemap","funnel","kpi","progress","heatmap"].includes(kind)){
    S.appendChild(svg("line",{class:"chart-axis",x1:left,y1:top+ch,x2:1000-right,y2:top+ch}));
    S.appendChild(svg("line",{class:"chart-axis",x1:left,y1:top,x2:left,y2:top+ch}));
  }
  if(kind==="pie"||kind==="donut"){
    const total=Math.max(1,vals.reduce((a,b)=>a+b,0));let a0=-Math.PI/2;const cx=470,cy=250,r=150;
    data.forEach((d,i)=>{const ang=(d.value/total)*Math.PI*2;const a1=a0+ang;const [x0,y0]=polar(cx,cy,r,a0),[x1,y1]=polar(cx,cy,r,a1);const large=ang>Math.PI?1:0;
      S.appendChild(svg("path",{class:"pie-slice",d:`M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`,style:`--i:${i}`}));
      const mid=(a0+a1)/2;S.appendChild(svgText(cx+(r+66)*Math.cos(mid),cy+(r+45)*Math.sin(mid),d.label,{class:"chart-label",textAnchor:"middle"}));
      if(el.showValues!==false)S.appendChild(svgText(cx+(r*.62)*Math.cos(mid),cy+(r*.62)*Math.sin(mid),Math.round(d.value),{class:"chart-value",textAnchor:"middle"}));a0=a1;});
    if(kind==="donut")S.appendChild(svg("circle",{class:"donut-hole",cx:470,cy:250,r:78}));
  } else if(kind==="line"||kind==="area"||kind==="spline"){
    const pts=data.map((d,i)=>{const x=left+(data.length===1?cw/2:i*cw/(data.length-1));const y=top+ch-(d.value/max)*ch;return [x,y,d];});
    const path=pts.map((p,i)=>(i?"L":"M")+p[0]+" "+p[1]).join(" ");
    if(kind==="area")S.appendChild(svg("path",{class:"chart-area",d:path+` L ${left+cw} ${top+ch} L ${left} ${top+ch} Z`}));
    S.appendChild(svg("path",{class:"chart-line",d:path}));
    pts.forEach((p,i)=>{S.appendChild(svg("circle",{class:"chart-dot",cx:p[0],cy:p[1],r:8}));S.appendChild(svgText(p[0],top+ch+38,p[2].label,{class:"chart-label",textAnchor:"middle"}));if(el.showValues!==false)S.appendChild(svgText(p[0],p[1]-16,Math.round(p[2].value),{class:"chart-value",textAnchor:"middle"}));});
  } else if(kind==="scatter"||kind==="bubble"){
    const xs=data.map(d=>d.x), ys=data.map(d=>d.y);const xmin=Math.min(...xs),xmax=Math.max(...xs,xmin+1);const ymin=0,ymax=Math.max(1,...ys)*1.15;
    data.forEach((d,i)=>{const x=left+((d.x-xmin)/(xmax-xmin))*cw;const y=top+ch-((d.y-ymin)/(ymax-ymin))*ch;const r=kind==="bubble"?Math.max(8,Math.min(38,d.size)):12;
      S.appendChild(svg("circle",{class:kind==="bubble"?"chart-bubble":"chart-scatter",cx:x,cy:y,r:r,style:`--i:${i}`}));S.appendChild(svgText(x,y-r-8,d.label,{class:"chart-label",textAnchor:"middle"}));});
  } else if(kind==="horizontalBar"){
    const gap=18;const bh=(ch-gap*(data.length+1))/Math.max(1,data.length);
    data.forEach((d,i)=>{const w=(d.value/max)*cw;const x=left;const y=top+gap+i*(bh+gap);S.appendChild(svg("rect",{class:"chart-bar",x,y,width:w,height:bh,rx:12,style:`--i:${i}`}));S.appendChild(svgText(left-12,y+bh*.65,d.label,{class:"chart-label",textAnchor:"end"}));if(el.showValues!==false)S.appendChild(svgText(x+w+12,y+bh*.65,Math.round(d.value),{class:"chart-value"}));});
  } else if(kind==="groupedBar"||kind==="stackedBar"){
    const gap=24;const bw=(cw-gap*(data.length+1))/Math.max(1,data.length);const colors=3;
    data.forEach((d,i)=>{const vals=(d.series&&d.series.length?d.series:[d.value,Math.round(d.value*.65),Math.round(d.value*.35)]).slice(0,4);const x0=left+gap+i*(bw+gap);
      if(kind==="stackedBar"){let y=top+ch;vals.forEach((v,j)=>{const h=(v/max)*ch;y-=h;S.appendChild(svg("rect",{class:"chart-bar",x:x0,y,width:bw,height:h,rx:j===0?12:3,style:`--i:${j}`}));});}
      else {const sub=bw/vals.length;vals.forEach((v,j)=>{const h=(v/max)*ch;S.appendChild(svg("rect",{class:"chart-bar",x:x0+j*sub+2,y:top+ch-h,width:Math.max(3,sub-4),height:h,rx:7,style:`--i:${j}`}));});}
      S.appendChild(svgText(x0+bw/2,top+ch+38,d.label,{class:"chart-label",textAnchor:"middle"}));});
  } else if(kind==="radar"){
    const cx=500,cy=260,r=170,n=data.length||1;for(let ring=1;ring<=4;ring++){const pts=data.map((d,i)=>polar(cx,cy,r*ring/4,-Math.PI/2+i*2*Math.PI/n).join(",")).join(" ");S.appendChild(svg("polygon",{class:"radar-ring",points:pts}));}
    const poly=data.map((d,i)=>polar(cx,cy,(d.value/max)*r,-Math.PI/2+i*2*Math.PI/n).join(",")).join(" ");S.appendChild(svg("polygon",{class:"radar-fill",points:poly}));data.forEach((d,i)=>{const [x,y]=polar(cx,cy,r+38,-Math.PI/2+i*2*Math.PI/n);S.appendChild(svgText(x,y,d.label,{class:"chart-label",textAnchor:"middle"}));});
  } else if(kind==="gauge"||kind==="progress"){
    const v=vals[0]||0;const pct=Math.max(0,Math.min(v/(Number(el.max)||100),1));
    if(kind==="gauge"){const cx=500,cy=340,r=190;S.appendChild(svg("path",{class:"gauge-bg",d:`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`}));const [ex,ey]=polar(cx,cy,r,Math.PI*(1-pct));S.appendChild(svg("path",{class:"gauge-fill",d:`M ${cx-r} ${cy} A ${r} ${r} 0 ${pct>.5?1:0} 1 ${ex} ${ey}`}));S.appendChild(svgText(cx,cy-20,Math.round(v)+"%",{class:"gauge-value",textAnchor:"middle"}));}
    else {S.appendChild(svg("rect",{class:"progress-bg",x:150,y:220,width:700,height:84,rx:42}));S.appendChild(svg("rect",{class:"progress-fill",x:150,y:220,width:700*pct,height:84,rx:42}));S.appendChild(svgText(500,276,Math.round(v)+"%",{class:"gauge-value",textAnchor:"middle"}));}
  } else if(kind==="funnel"){
    const total=Math.max(1,vals[0]||max);data.forEach((d,i)=>{const topW=700*(d.value/total),botW=700*((data[i+1]?.value||d.value*.85)/total);const y=70+i*(360/data.length);const h=330/data.length;S.appendChild(svg("path",{class:"funnel-step",d:`M ${500-topW/2} ${y} L ${500+topW/2} ${y} L ${500+botW/2} ${y+h} L ${500-botW/2} ${y+h} Z`,style:`--i:${i}`}));S.appendChild(svgText(500,y+h*.62,d.label+" · "+Math.round(d.value),{class:"chart-value",textAnchor:"middle"}));});
  } else if(kind==="waterfall"){
    let base=0;const gap=22,bw=(cw-gap*(data.length+1))/Math.max(1,data.length);const absMax=Math.max(1,Math.abs(data.reduce((a,d)=>a+d.value,0)),...data.map(d=>Math.abs(d.value)))*1.4;const zero=top+ch*.65;
    data.forEach((d,i)=>{const x=left+gap+i*(bw+gap);const y0=zero-(base/absMax)*ch*.8;base+=d.value;const y1=zero-(base/absMax)*ch*.8;S.appendChild(svg("rect",{class:"chart-bar",x,y:Math.min(y0,y1),width:bw,height:Math.max(4,Math.abs(y1-y0)),rx:8,style:`--i:${d.value>=0?1:5}`}));S.appendChild(svgText(x+bw/2,top+ch+38,d.label,{class:"chart-label",textAnchor:"middle"}));});
  } else if(kind==="heatmap"){
    const cols=Math.ceil(Math.sqrt(data.length)),cell=80;data.forEach((d,i)=>{const x=190+(i%cols)*cell,y=82+Math.floor(i/cols)*cell;S.appendChild(svg("rect",{class:"heat-cell",x,y,width:cell-8,height:cell-8,rx:12,opacity:Math.max(.25,d.value/max),style:`--i:${i}`}));S.appendChild(svgText(x+cell/2-4,y+cell/2+5,d.label,{class:"heat-label",textAnchor:"middle"}));});
  } else if(kind==="treemap"){
    const total=Math.max(1,vals.reduce((a,b)=>a+b,0));let x=110,y=80;data.forEach((d,i)=>{const w=Math.max(90,(d.value/total)*760),h=90;if(x+w>900){x=110;y+=105;}S.appendChild(svg("rect",{class:"tree-box",x,y,width:Math.min(w,790),height:h,rx:18,style:`--i:${i}`}));S.appendChild(svgText(x+16,y+36,d.label,{class:"tree-label"}));S.appendChild(svgText(x+16,y+66,Math.round(d.value),{class:"tree-value"}));x+=w+12;});
  } else if(kind==="kpi"){
    const d=data[0]||{label:"Metric",value:0};S.appendChild(svgText(500,210,Math.round(d.value).toLocaleString(),{class:"kpi-value",textAnchor:"middle"}));S.appendChild(svgText(500,282,d.label,{class:"kpi-label",textAnchor:"middle"}));S.appendChild(svg("rect",{class:"kpi-line",x:355,y:315,width:290,height:8,rx:4}));
  } else {
    const gap=22;const bw=(cw-gap*(data.length+1))/Math.max(1,data.length);data.forEach((d,i)=>{const h=(d.value/max)*ch;const x=left+gap+i*(bw+gap);const y=top+ch-h;S.appendChild(svg("rect",{class:"chart-bar",x,y,width:bw,height:h,rx:12,style:`--i:${i}`}));S.appendChild(svgText(x+bw/2,top+ch+38,d.label,{class:"chart-label",textAnchor:"middle"}));if(el.showValues!==false)S.appendChild(svgText(x+bw/2,y-14,Math.round(d.value),{class:"chart-value",textAnchor:"middle"}));});
  }
  wrap.appendChild(S);box.appendChild(wrap);return box;
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
function renderMap(el){
  const box=document.createElement("div");box.className="map-box map-"+(el.mapKind||"gambia");box.style.setProperty("--accent",el.accent||"#2f6f4f");
  const title=document.createElement("div");title.className="map-title";title.textContent=el.title||"Map";box.appendChild(title);
  const S=svg("svg",{viewBox:"0 0 1000 520",preserveAspectRatio:"none"});
  S.appendChild(svg("rect",{class:"map-water",x:0,y:0,width:1000,height:520,rx:34}));
  if((el.mapKind||"gambia")==="world"){
    S.appendChild(svg("path",{class:"map-land",d:"M90 190 C150 95 250 120 300 185 C350 230 305 290 235 292 C160 310 70 270 90 190Z M430 165 C520 95 640 125 690 205 C740 290 625 330 535 305 C450 285 365 230 430 165Z M710 310 C785 260 895 300 920 380 C865 450 740 445 705 375 C690 350 690 328 710 310Z"}));
  } else if((el.mapKind||"gambia")==="africa"){
    S.appendChild(svg("path",{class:"map-land",d:"M510 72 C630 90 735 180 744 285 C755 404 650 442 590 478 C548 504 495 450 505 388 C418 358 352 284 380 195 C398 138 445 92 510 72Z"}));
    S.appendChild(svg("path",{class:"map-river",d:"M355 242 C455 220 538 232 650 252"}));
  } else {
    S.appendChild(svg("path",{class:"map-land",d:"M110 270 C250 210 390 250 515 236 C650 221 772 180 896 220 C865 282 712 305 590 310 C425 318 275 310 110 270Z"}));
    S.appendChild(svg("path",{class:"map-river",d:"M135 264 C300 247 450 278 610 262 C720 252 805 218 885 223"}));
  }
  const pins=Array.isArray(el.pins)?el.pins:[];
  pins.forEach((p,i)=>{const x=clamp(Number(p.x)||50,2,98)*10;const y=clamp(Number(p.y)||50,2,98)*5.2;
    const g=svg("g",{class:"map-pin",style:`--i:${i}`});g.appendChild(svg("circle",{cx:x,cy:y,r:18}));g.appendChild(svg("circle",{cx:x,cy:y,r:6,class:"map-pin-dot"}));
    if(el.showLabels!==false)g.appendChild(svgText(x+26,y-14,String(p.label||"Pin"),{class:"map-label"}));
    if(p.value!=null&&p.value!=="")g.appendChild(svgText(x+26,y+12,String(p.value),{class:"map-value"}));
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
  box.style.setProperty("--level", clamp(Number(el.level)||0,0,100)+"%");
  box.style.setProperty("--accent", el.accent|| (mode==="water"?"#4cc9f0":"#d8a23a"));
  box.innerHTML=`<div class="glass-shine"></div><div class="glass-liquid"><span></span></div><div class="glass-rim"></div>`;
  return box;
}
function renderObject(el){
  const d=objectDef(el.objectType);
  const box=document.createElement("div");box.className="object-box object-"+(el.objectType||"custom");
  box.style.setProperty("--accent", el.accent||d.accent||"#4cc9f0");
  if(el.objectType==="water_glass") box.appendChild(renderGlass(el,"water"));
  else if(el.objectType==="sand_glass") box.appendChild(renderGlass(el,"sand"));
  else if(el.objectType==="glass_cup") box.appendChild(renderGlass(Object.assign({},el,{level:0}),"empty"));
  else box.appendChild(renderCountGrid(el));
  if(el.showCount!==false){
    const badge=document.createElement("div");badge.className="object-badge";
    const value = (el.objectType==="water_glass"||el.objectType==="sand_glass") ? `${clamp(Number(el.level)||0,0,100)}%` : (Number(el.count)||1).toLocaleString();
    badge.innerHTML=`<b>${value}</b><span>${el.label||d.label}</span>`;box.appendChild(badge);
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

window.Hanns = {Deck,TEMPLATES,BACKGROUNDS,ANIMS,TRANSITIONS,PALETTE,FONTS,OBJECTS,SHAPES,
  newSlide,curSlide,selEl,paintSlide,renderElement,
  makeText,makeShape,makeLine,makeImage,makeVideo,makeLink,makeObject,makeCreativeShape,makeTable,makeChart,makeMap,W,H,$,$$,uid,clamp,genCode};

})();