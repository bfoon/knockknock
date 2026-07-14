/* ════════════════════════════════════════════════════════════════════
   HANNS — ACTORS v2 (single-object 2D animated characters)
   ════════════════════════════════════════════════════════════════════
   Each actor is ONE inline <svg> rig. Parts are grouped with stable
   classes (.ac-body, .ac-face, .ac-legs, .ac-leaf, .ac-wing …) so CSS
   can animate individual limbs per action/mood.

   Rendered markup:
     <div class="actor actor-<kind>" data-kind="<kind>"
          data-action="idle" data-mood="neutral">
        <svg class="actor-svg" viewBox="0 0 100 100">…rig…</svg>
     </div>

   State is driven purely by data-attributes the CSS keys off:
     data-action : idle | grow | run | shake | jump | fill | empty | wave |
                   dance | eat | peck | flap | wag | fly | swim | spin |
                   launch | flash | shine | rain
     data-mood   : happy | sad | neutral   (characters with a face)
   plus --fill (0..1) for water tank / plant growth.

   v2 additions:
   • 10 new actors: pig, sheep, dog, bee, butterfly, fish, windmill,
     rocket, lightbulb, trophy.
   • New actions on existing actors: farmer dance, cow/goat eat,
     chicken flap.
   • Self-contained animation stylesheet injected at runtime
     (#hanns-actors-v2-css). It loads after hanns.css so its improved
     keyframes (breathing idle, eye blinks, real leg gaits, jump squash
     with shadow, springy grow, eased fill) win on equal specificity —
     no hanns.css edits required.
   • Bug fix: water tank clip-path id is now unique per instance, so
     multiple tanks on one slide no longer share a clip.

   Exposed on window.HannsActors so hanns_core.js can call renderActor(el).
   ──────────────────────────────────────────────────────────────────── */
(function(){
"use strict";

/* Which object kinds are single-character actors. hanns_core.js checks
   this to route renderObject() to renderActor() instead of grids. */
const ACTOR_KINDS = new Set([
  "farmer", "cow", "goat", "chicken",
  "plant", "tree", "seed", "water_tank", "sun_rain",
  // v2
  "pig", "sheep", "dog", "bee", "butterfly", "fish",
  "windmill", "rocket", "lightbulb", "trophy",
]);

/* Actions each actor supports. The editor uses this to show only the
   relevant action buttons; the injected CSS provides a keyframe for
   every pair. Every actor supports "idle". */
const ACTOR_ACTIONS = {
  farmer:    ["idle", "wave", "dance", "shake", "jump"],
  cow:       ["idle", "run", "eat", "shake", "jump"],
  goat:      ["idle", "run", "eat", "shake", "jump"],
  chicken:   ["idle", "peck", "flap", "shake", "jump"],
  plant:     ["idle", "grow", "shake"],
  tree:      ["idle", "grow", "shake"],
  seed:      ["idle", "grow", "shake", "jump"],
  water_tank:["idle", "fill", "empty", "shake"],
  sun_rain:  ["idle", "shine", "rain"],
  // v2
  pig:       ["idle", "run", "shake", "jump"],
  sheep:     ["idle", "run", "shake", "jump"],
  dog:       ["idle", "run", "wag", "shake", "jump"],
  bee:       ["idle", "fly", "shake"],
  butterfly: ["idle", "fly", "shake"],
  fish:      ["idle", "swim", "jump"],
  windmill:  ["idle", "spin", "shake"],
  rocket:    ["idle", "launch", "shake"],
  lightbulb: ["idle", "flash", "shake"],
  trophy:    ["idle", "shine", "jump", "shake"],
};

/* Which actors have a face that can smile / frown. */
const ACTOR_HAS_MOOD = new Set(["farmer","cow","goat","chicken","pig","sheep","dog"]);

/* Which actors read a 0–100 level (fill / growth). */
const ACTOR_HAS_LEVEL = new Set(["plant","tree","seed","water_tank"]);

function clamp01(n){ n = Number(n); if(!isFinite(n)) return 0; return n<0?0:(n>1?1:n); }
let _uidN = 0;
function acUid(){ return "acid" + (Date.now().toString(36)) + (_uidN++).toString(36); }

/* Shared mood-face fragment. cx = mouth center x, y = mouth y. */
function faceMouths(cx, y, stroke, w){
  w = w || 1.6;
  const half = 5;
  return `
    <path class="ac-mouth ac-mouth-happy" d="M${cx-half} ${y} q${half} ${half} ${half*2} 0" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>
    <path class="ac-mouth ac-mouth-sad"   d="M${cx-half} ${y+2} q${half} ${-half} ${half*2} 0" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>
    <path class="ac-mouth ac-mouth-neutral" d="M${cx-half} ${y+1} h${half*2}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;
}

/* ─────────────────────────────────────────────────────────────────────
   RIGS. Each returns an SVG string in a shared 0 0 100 100 viewBox.
   `a` is the accent colour. Keep parts in named <g>/elements so CSS
   animations can target limbs, not the whole body.
   ───────────────────────────────────────────────────────────────────── */
const RIGS = {

  /* FARMER — hat, head w/ face, torso, two arms, two legs. */
  farmer(a){
    a = a || "#c98a52";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="50" cy="93" rx="24" ry="4"/>
      <g class="ac-legs">
        <rect class="ac-leg ac-leg-l" x="41" y="66" width="7" height="22" rx="3.5" fill="#3f5d8a"/>
        <rect class="ac-leg ac-leg-r" x="52" y="66" width="7" height="22" rx="3.5" fill="#34507a"/>
        <ellipse cx="44.5" cy="90" rx="6" ry="3" fill="#26313f"/>
        <ellipse cx="55.5" cy="90" rx="6" ry="3" fill="#26313f"/>
      </g>
      <rect class="ac-body" x="37" y="44" width="26" height="26" rx="9" fill="#e7d9b8"/>
      <rect class="ac-body-strap" x="45" y="44" width="4" height="24" fill="#b98a4e"/>
      <g class="ac-arm ac-arm-l"><rect x="29" y="46" width="8" height="16" rx="4" fill="#e7d9b8"/><circle cx="33" cy="63" r="4" fill="${a}"/></g>
      <g class="ac-arm ac-arm-r"><rect x="63" y="46" width="8" height="16" rx="4" fill="#e7d9b8"/><circle cx="67" cy="63" r="4" fill="${a}"/></g>
      <g class="ac-head">
        <circle class="ac-skin" cx="50" cy="30" r="13" fill="${a}"/>
        <path class="ac-hat" d="M31 26 q19 -14 38 0 q-6 -3 -19 -3 q-13 0 -19 3 Z" fill="#caa15a"/>
        <ellipse class="ac-hat-top" cx="50" cy="20" rx="11" ry="7" fill="#d8b063"/>
        <g class="ac-face">
          <g class="ac-eye ac-eye-l"><circle cx="45" cy="30" r="1.8" fill="#25201a"/><circle cx="45.6" cy="29.4" r=".55" fill="#fff"/></g>
          <g class="ac-eye ac-eye-r"><circle cx="55" cy="30" r="1.8" fill="#25201a"/><circle cx="55.6" cy="29.4" r=".55" fill="#fff"/></g>
          ${faceMouths(50, 35, "#25201a", 1.8)}
        </g>
      </g>
    </g>`;
  },

  /* COW — body, head, four legs, ears, spots, tail, face. */
  cow(a){
    a = a || "#f4f1ec";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="52" cy="90" rx="30" ry="4"/>
      <g class="ac-legs">
        <rect class="ac-leg ac-leg-1" x="30" y="62" width="7" height="24" rx="3" fill="#cfc7bb"/>
        <rect class="ac-leg ac-leg-2" x="42" y="64" width="7" height="22" rx="3" fill="#d8d0c4"/>
        <rect class="ac-leg ac-leg-3" x="58" y="64" width="7" height="22" rx="3" fill="#d8d0c4"/>
        <rect class="ac-leg ac-leg-4" x="70" y="62" width="7" height="24" rx="3" fill="#cfc7bb"/>
      </g>
      <g class="ac-tail"><path d="M78 50 q12 6 8 22" fill="none" stroke="#cfc7bb" stroke-width="3" stroke-linecap="round"/><circle cx="86" cy="72" r="3" fill="#8a7f70"/></g>
      <ellipse class="ac-body" cx="52" cy="52" rx="27" ry="18" fill="${a}"/>
      <ellipse class="ac-spot" cx="44" cy="48" rx="7" ry="5" fill="#b7a99a"/>
      <ellipse class="ac-spot" cx="62" cy="56" rx="6" ry="4.5" fill="#c2b4a4"/>
      <g class="ac-head">
        <ellipse class="ac-skin" cx="26" cy="46" rx="13" ry="12" fill="${a}"/>
        <path class="ac-ear ac-ear-l" d="M16 38 q-8 -3 -6 6 q5 2 8 -2 Z" fill="#d8d0c4"/>
        <path class="ac-ear ac-ear-r" d="M34 34 q6 -6 9 2 q-3 5 -8 2 Z" fill="#d8d0c4"/>
        <path class="ac-horn" d="M20 34 q-2 -6 3 -6" fill="none" stroke="#e6ddca" stroke-width="2.4" stroke-linecap="round"/>
        <ellipse class="ac-muzzle" cx="20" cy="52" rx="8" ry="6" fill="#f0c9c2"/>
        <circle cx="17" cy="52" r="1.3" fill="#7a5a55"/><circle cx="23" cy="52" r="1.3" fill="#7a5a55"/>
        <g class="ac-face">
          <g class="ac-eye ac-eye-l"><circle cx="22" cy="42" r="1.9" fill="#2a2622"/><circle cx="22.6" cy="41.4" r=".6" fill="#fff"/></g>
          <g class="ac-eye ac-eye-r"><circle cx="31" cy="42" r="1.9" fill="#2a2622"/><circle cx="31.6" cy="41.4" r=".6" fill="#fff"/></g>
          <path class="ac-mouth ac-mouth-happy" d="M17 55 q4 4 8 1" fill="none" stroke="#7a5a55" stroke-width="1.4" stroke-linecap="round"/>
          <path class="ac-mouth ac-mouth-sad"   d="M17 57 q4 -4 8 -1" fill="none" stroke="#7a5a55" stroke-width="1.4" stroke-linecap="round"/>
          <path class="ac-mouth ac-mouth-neutral" d="M18 56 h7" fill="none" stroke="#7a5a55" stroke-width="1.4" stroke-linecap="round"/>
        </g>
      </g>
    </g>`;
  },

  /* GOAT — leaner body, beard, curved horns, four legs. */
  goat(a){
    a = a || "#e9e4da";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="52" cy="90" rx="26" ry="4"/>
      <g class="ac-legs">
        <rect class="ac-leg ac-leg-1" x="34" y="60" width="6" height="26" rx="3" fill="#cdc6ba"/>
        <rect class="ac-leg ac-leg-2" x="44" y="62" width="6" height="24" rx="3" fill="#d6cfc3"/>
        <rect class="ac-leg ac-leg-3" x="58" y="62" width="6" height="24" rx="3" fill="#d6cfc3"/>
        <rect class="ac-leg ac-leg-4" x="68" y="60" width="6" height="26" rx="3" fill="#cdc6ba"/>
      </g>
      <g class="ac-tail"><path d="M74 48 q7 2 5 10" fill="none" stroke="#cdc6ba" stroke-width="3" stroke-linecap="round"/></g>
      <ellipse class="ac-body" cx="52" cy="50" rx="24" ry="15" fill="${a}"/>
      <g class="ac-head">
        <ellipse class="ac-skin" cx="28" cy="44" rx="11" ry="10" fill="${a}"/>
        <path class="ac-horn" d="M24 34 q-4 -10 4 -12" fill="none" stroke="#b7ac97" stroke-width="2.6" stroke-linecap="round"/>
        <path class="ac-horn" d="M32 34 q0 -10 7 -11" fill="none" stroke="#b7ac97" stroke-width="2.6" stroke-linecap="round"/>
        <path class="ac-ear ac-ear-l" d="M18 44 q-8 0 -9 5 q6 3 10 -1 Z" fill="#d6cfc3"/>
        <ellipse class="ac-muzzle" cx="22" cy="48" rx="6" ry="5" fill="#f2ede4"/>
        <path class="ac-beard" d="M24 52 q0 8 3 11 q3 -3 3 -11 Z" fill="#d6cfc3"/>
        <g class="ac-face">
          <g class="ac-eye ac-eye-l"><circle cx="25" cy="41" r="1.7" fill="#2a2622"/><circle cx="25.5" cy="40.5" r=".55" fill="#fff"/></g>
          <g class="ac-eye ac-eye-r"><circle cx="33" cy="41" r="1.7" fill="#2a2622"/><circle cx="33.5" cy="40.5" r=".55" fill="#fff"/></g>
          <path class="ac-mouth ac-mouth-happy" d="M20 49 q3 3 6 1" fill="none" stroke="#8a7d68" stroke-width="1.3" stroke-linecap="round"/>
          <path class="ac-mouth ac-mouth-sad"   d="M20 51 q3 -3 6 -1" fill="none" stroke="#8a7d68" stroke-width="1.3" stroke-linecap="round"/>
          <path class="ac-mouth ac-mouth-neutral" d="M20 50 h6" fill="none" stroke="#8a7d68" stroke-width="1.3" stroke-linecap="round"/>
        </g>
      </g>
    </g>`;
  },

  /* CHICKEN — round body, wing, comb, beak, two thin legs; pecks/flaps. */
  chicken(a){
    a = a || "#f6efe2";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="52" cy="92" rx="20" ry="3.5"/>
      <g class="ac-legs">
        <path class="ac-leg ac-leg-l" d="M47 80 v9 M44 90 h7" fill="none" stroke="#e0a53a" stroke-width="2.4" stroke-linecap="round"/>
        <path class="ac-leg ac-leg-r" d="M58 80 v9 M55 90 h7" fill="none" stroke="#e0a53a" stroke-width="2.4" stroke-linecap="round"/>
      </g>
      <path class="ac-tail" d="M72 52 q18 -8 20 4 q-10 2 -14 8 Z" fill="#e7ddc9"/>
      <ellipse class="ac-body" cx="54" cy="60" rx="22" ry="19" fill="${a}"/>
      <path class="ac-wing" d="M58 54 q14 4 10 20 q-9 0 -13 -10 Z" fill="#e7ddc9"/>
      <g class="ac-head">
        <circle class="ac-skin" cx="40" cy="36" r="12" fill="${a}"/>
        <path class="ac-comb" d="M33 25 q3 -6 6 -1 q3 -6 6 0 q3 -5 5 1 q-4 4 -8 4 q-5 0 -9 -4 Z" fill="#e14b3b"/>
        <path class="ac-beak" d="M28 36 l-10 4 l10 3 Z" fill="#f3a935"/>
        <path class="ac-wattle" d="M31 44 q-2 7 2 8 q3 -2 1 -8 Z" fill="#e14b3b"/>
        <g class="ac-face">
          <g class="ac-eye"><circle cx="38" cy="33" r="2.1" fill="#2a2622"/><circle cx="38.7" cy="32.3" r=".7" fill="#fff"/></g>
        </g>
      </g>
    </g>`;
  },

  /* PLANT — pot + growing sprout. */
  plant(a){
    a = a || "#5aa843";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="50" cy="92" rx="18" ry="3.5"/>
      <path class="ac-pot" d="M36 74 h28 l-3 16 h-22 Z" fill="#c96a44"/>
      <rect class="ac-pot-rim" x="33" y="70" width="34" height="7" rx="3" fill="#d97a52"/>
      <ellipse cx="50" cy="73" rx="15" ry="3" fill="#5a4632"/>
      <g class="ac-sprout">
        <path class="ac-stem" d="M50 73 v-34" fill="none" stroke="${a}" stroke-width="3.4" stroke-linecap="round"/>
        <path class="ac-leaf ac-leaf-l" d="M50 54 q-16 -4 -18 -16 q14 0 18 12 Z" fill="${a}"/>
        <path class="ac-leaf ac-leaf-r" d="M50 48 q16 -4 18 -16 q-14 0 -18 12 Z" fill="#6cbb4f"/>
        <circle class="ac-bud" cx="50" cy="38" r="5" fill="#8fd06a"/>
      </g>
    </g>`;
  },

  /* TREE — trunk + layered canopy. */
  tree(a){
    a = a || "#3f8f4f";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="50" cy="92" rx="24" ry="4"/>
      <rect class="ac-trunk" x="45" y="58" width="10" height="32" rx="4" fill="#8a5a34"/>
      <g class="ac-canopy">
        <circle cx="50" cy="42" r="20" fill="${a}"/>
        <circle cx="34" cy="50" r="14" fill="#4c9d5b"/>
        <circle cx="66" cy="50" r="14" fill="#4c9d5b"/>
        <circle cx="50" cy="30" r="14" fill="#59ab68"/>
      </g>
    </g>`;
  },

  /* SEED — a kernel that sprouts or hops. */
  seed(a){
    a = a || "#8a6d3f";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="50" cy="88" rx="12" ry="3"/>
      <g class="ac-sprout">
        <path class="ac-shoot" d="M50 78 v-18" fill="none" stroke="#5aa843" stroke-width="2.6" stroke-linecap="round"/>
        <path class="ac-leaf ac-leaf-l" d="M50 66 q-10 -3 -12 -11 q9 0 12 8 Z" fill="#6cbb4f"/>
        <path class="ac-leaf ac-leaf-r" d="M50 62 q10 -3 12 -11 q-9 0 -12 8 Z" fill="#5aa843"/>
      </g>
      <ellipse class="ac-seed" cx="50" cy="78" rx="10" ry="13" fill="${a}"/>
      <path class="ac-seed-line" d="M50 66 q4 12 0 24" fill="none" stroke="#6b5230" stroke-width="1.6"/>
    </g>`;
  },

  /* WATER_TANK — tank whose water level = --fill. Unique clip id per
     instance (v2 fix: two tanks on one slide used to share a clip). */
  water_tank(a){
    a = a || "#3fa9d8";
    const cid = acUid();
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="50" cy="92" rx="22" ry="4"/>
      <rect x="34" y="78" width="5" height="12" fill="#9aa3ab"/>
      <rect x="61" y="78" width="5" height="12" fill="#9aa3ab"/>
      <defs><clipPath id="${cid}"><rect x="30" y="24" width="40" height="56" rx="10"/></clipPath></defs>
      <g clip-path="url(#${cid})">
        <rect x="30" y="24" width="40" height="56" fill="#eef4f7"/>
        <rect class="ac-water" x="28" y="26" width="44" height="56" fill="${a}"/>
        <ellipse class="ac-water-top" cx="50" cy="26" rx="22" ry="3" fill="#7fd0ee"/>
      </g>
      <rect class="ac-tank-outline" x="30" y="24" width="40" height="56" rx="10" fill="none" stroke="#7d8b95" stroke-width="2.4"/>
      <rect x="44" y="16" width="12" height="10" rx="3" fill="#9aa3ab"/>
      <path d="M40 80 h20 l-3 6 h-14 Z" fill="#b7c0c7"/>
    </g>`;
  },

  /* SUN_RAIN — sun with rays that shine, or cloud that rains. */
  sun_rain(a){
    a = a || "#f6b73c";
    return `
    <g class="ac-root">
      <g class="ac-sun">
        <g class="ac-rays" stroke="${a}" stroke-width="3" stroke-linecap="round">
          <line x1="50" y1="8"  x2="50" y2="18"/>
          <line x1="50" y1="62" x2="50" y2="72"/>
          <line x1="12" y1="40" x2="22" y2="40"/>
          <line x1="78" y1="40" x2="88" y2="40"/>
          <line x1="22" y1="16" x2="29" y2="23"/>
          <line x1="71" y1="16" x2="78" y2="23"/>
          <line x1="22" y1="64" x2="29" y2="57"/>
          <line x1="71" y1="64" x2="78" y2="57"/>
        </g>
        <circle class="ac-sun-core" cx="50" cy="40" r="16" fill="${a}"/>
      </g>
      <g class="ac-cloud">
        <ellipse cx="42" cy="42" rx="16" ry="12" fill="#dfe7ec"/>
        <ellipse cx="60" cy="44" rx="14" ry="11" fill="#eef3f6"/>
        <rect x="30" y="42" width="42" height="12" rx="6" fill="#e7edf1"/>
        <g class="ac-drops" stroke="#4aa8d6" stroke-width="3" stroke-linecap="round">
          <line class="ac-drop d1" x1="38" y1="60" x2="36" y2="70"/>
          <line class="ac-drop d2" x1="50" y1="62" x2="48" y2="72"/>
          <line class="ac-drop d3" x1="62" y1="60" x2="60" y2="70"/>
        </g>
      </g>
    </g>`;
  },

  /* ── v2 rigs ─────────────────────────────────────────────────────── */

  /* PIG — round body, snout, ears, curly tail, four legs; mood face. */
  pig(a){
    a = a || "#f3b5c2";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="52" cy="90" rx="27" ry="4"/>
      <g class="ac-legs">
        <rect class="ac-leg ac-leg-1" x="34" y="64" width="7" height="21" rx="3" fill="#e59aae"/>
        <rect class="ac-leg ac-leg-2" x="45" y="66" width="7" height="19" rx="3" fill="#eda6b8"/>
        <rect class="ac-leg ac-leg-3" x="58" y="66" width="7" height="19" rx="3" fill="#eda6b8"/>
        <rect class="ac-leg ac-leg-4" x="69" y="64" width="7" height="21" rx="3" fill="#e59aae"/>
      </g>
      <g class="ac-tail"><path d="M79 52 q8 -4 6 3 q-2 6 4 4" fill="none" stroke="#e59aae" stroke-width="2.6" stroke-linecap="round"/></g>
      <ellipse class="ac-body" cx="54" cy="54" rx="27" ry="19" fill="${a}"/>
      <g class="ac-head">
        <circle class="ac-skin" cx="28" cy="44" r="14" fill="${a}"/>
        <path class="ac-ear ac-ear-l" d="M17 33 q-5 -8 3 -9 q4 3 2 9 Z" fill="#e59aae"/>
        <path class="ac-ear ac-ear-r" d="M36 31 q3 -9 9 -6 q1 5 -5 9 Z" fill="#e59aae"/>
        <ellipse class="ac-snout" cx="21" cy="49" rx="7" ry="5.5" fill="#eda6b8"/>
        <ellipse cx="18.5" cy="49" rx="1.4" ry="2" fill="#b76a80"/>
        <ellipse cx="23.5" cy="49" rx="1.4" ry="2" fill="#b76a80"/>
        <g class="ac-face">
          <g class="ac-eye ac-eye-l"><circle cx="24" cy="40" r="1.8" fill="#3a2a2e"/><circle cx="24.6" cy="39.4" r=".55" fill="#fff"/></g>
          <g class="ac-eye ac-eye-r"><circle cx="33" cy="40" r="1.8" fill="#3a2a2e"/><circle cx="33.6" cy="39.4" r=".55" fill="#fff"/></g>
          <path class="ac-mouth ac-mouth-happy" d="M25 55 q4 4 8 1" fill="none" stroke="#b76a80" stroke-width="1.4" stroke-linecap="round"/>
          <path class="ac-mouth ac-mouth-sad"   d="M25 57 q4 -4 8 -1" fill="none" stroke="#b76a80" stroke-width="1.4" stroke-linecap="round"/>
          <path class="ac-mouth ac-mouth-neutral" d="M26 56 h7" fill="none" stroke="#b76a80" stroke-width="1.4" stroke-linecap="round"/>
        </g>
      </g>
    </g>`;
  },

  /* SHEEP — fluffy cloud body, dark head, ears, four legs; mood face. */
  sheep(a){
    a = a || "#f2ede3";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="52" cy="90" rx="26" ry="4"/>
      <g class="ac-legs">
        <rect class="ac-leg ac-leg-1" x="36" y="62" width="6" height="24" rx="3" fill="#4a4038"/>
        <rect class="ac-leg ac-leg-2" x="46" y="64" width="6" height="22" rx="3" fill="#5a4f45"/>
        <rect class="ac-leg ac-leg-3" x="58" y="64" width="6" height="22" rx="3" fill="#5a4f45"/>
        <rect class="ac-leg ac-leg-4" x="68" y="62" width="6" height="24" rx="3" fill="#4a4038"/>
      </g>
      <g class="ac-body ac-wool">
        <circle cx="42" cy="48" r="13" fill="${a}"/>
        <circle cx="56" cy="44" r="14" fill="${a}"/>
        <circle cx="68" cy="50" r="12" fill="#e9e2d4"/>
        <circle cx="50" cy="56" r="13" fill="#e9e2d4"/>
        <circle cx="63" cy="58" r="11" fill="${a}"/>
      </g>
      <g class="ac-head">
        <ellipse class="ac-skin" cx="28" cy="46" rx="11" ry="10" fill="#6b5a4c"/>
        <ellipse class="ac-wool-tuft" cx="31" cy="35" rx="8" ry="5.5" fill="${a}"/>
        <path class="ac-ear ac-ear-l" d="M18 42 q-9 -1 -9 5 q6 4 10 -1 Z" fill="#5a4a3e"/>
        <path class="ac-ear ac-ear-r" d="M38 40 q9 -3 10 3 q-5 5 -10 1 Z" fill="#5a4a3e"/>
        <g class="ac-face">
          <g class="ac-eye ac-eye-l"><circle cx="24" cy="44" r="1.8" fill="#f4efe6"/><circle cx="24" cy="44" r="1" fill="#231d18"/></g>
          <g class="ac-eye ac-eye-r"><circle cx="33" cy="44" r="1.8" fill="#f4efe6"/><circle cx="33" cy="44" r="1" fill="#231d18"/></g>
          <path class="ac-mouth ac-mouth-happy" d="M24 52 q4 4 8 1" fill="none" stroke="#d9cfc0" stroke-width="1.4" stroke-linecap="round"/>
          <path class="ac-mouth ac-mouth-sad"   d="M24 54 q4 -4 8 -1" fill="none" stroke="#d9cfc0" stroke-width="1.4" stroke-linecap="round"/>
          <path class="ac-mouth ac-mouth-neutral" d="M25 53 h7" fill="none" stroke="#d9cfc0" stroke-width="1.4" stroke-linecap="round"/>
        </g>
      </g>
    </g>`;
  },

  /* DOG — body, head with floppy ear, wagging tail, four legs; mood. */
  dog(a){
    a = a || "#caa06a";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="52" cy="90" rx="27" ry="4"/>
      <g class="ac-legs">
        <rect class="ac-leg ac-leg-1" x="33" y="60" width="7" height="26" rx="3" fill="#b58a55"/>
        <rect class="ac-leg ac-leg-2" x="44" y="62" width="7" height="24" rx="3" fill="#c2975f"/>
        <rect class="ac-leg ac-leg-3" x="58" y="62" width="7" height="24" rx="3" fill="#c2975f"/>
        <rect class="ac-leg ac-leg-4" x="69" y="60" width="7" height="26" rx="3" fill="#b58a55"/>
      </g>
      <g class="ac-tail"><path d="M78 50 q10 -8 8 -18" fill="none" stroke="#b58a55" stroke-width="4" stroke-linecap="round"/></g>
      <ellipse class="ac-body" cx="53" cy="52" rx="26" ry="17" fill="${a}"/>
      <ellipse class="ac-spot" cx="62" cy="47" rx="7" ry="5" fill="#b58a55"/>
      <g class="ac-head">
        <circle class="ac-skin" cx="28" cy="42" r="13" fill="${a}"/>
        <path class="ac-ear ac-ear-l" d="M16 32 q-4 14 4 18 q4 -6 2 -16 Z" fill="#9a734a"/>
        <path class="ac-ear ac-ear-r" d="M38 30 q8 8 4 16 q-6 -2 -8 -12 Z" fill="#9a734a"/>
        <ellipse class="ac-muzzle" cx="21" cy="48" rx="7.5" ry="6" fill="#e9d3ae"/>
        <ellipse cx="17" cy="46" rx="2.4" ry="2" fill="#2e2620"/>
        <g class="ac-face">
          <g class="ac-eye ac-eye-l"><circle cx="24" cy="39" r="1.9" fill="#2e2620"/><circle cx="24.6" cy="38.4" r=".6" fill="#fff"/></g>
          <g class="ac-eye ac-eye-r"><circle cx="33" cy="39" r="1.9" fill="#2e2620"/><circle cx="33.6" cy="38.4" r=".6" fill="#fff"/></g>
          <path class="ac-mouth ac-mouth-happy" d="M18 52 q4 4 8 1" fill="none" stroke="#7a5f42" stroke-width="1.4" stroke-linecap="round"/>
          <path class="ac-mouth ac-mouth-sad"   d="M18 54 q4 -4 8 -1" fill="none" stroke="#7a5f42" stroke-width="1.4" stroke-linecap="round"/>
          <path class="ac-mouth ac-mouth-neutral" d="M19 53 h7" fill="none" stroke="#7a5f42" stroke-width="1.4" stroke-linecap="round"/>
        </g>
      </g>
    </g>`;
  },

  /* BEE — striped body, two wings, antennae; hovers/flies. */
  bee(a){
    a = a || "#f6c445";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="50" cy="88" rx="16" ry="3"/>
      <g class="ac-fly-rig">
        <g class="ac-wing ac-wing-l"><ellipse cx="41" cy="32" rx="13" ry="9" fill="#dff0fa" opacity=".85"/></g>
        <g class="ac-wing ac-wing-r"><ellipse cx="61" cy="32" rx="13" ry="9" fill="#eef7fc" opacity=".85"/></g>
        <ellipse class="ac-body" cx="50" cy="52" rx="20" ry="15" fill="${a}"/>
        <path class="ac-stripe" d="M42 38 q-3 14 0 28" fill="none" stroke="#3a2f18" stroke-width="5" stroke-linecap="round"/>
        <path class="ac-stripe" d="M56 38 q3 14 0 28" fill="none" stroke="#3a2f18" stroke-width="5" stroke-linecap="round"/>
        <path class="ac-sting" d="M68 54 l8 2 l-8 3 Z" fill="#3a2f18"/>
        <g class="ac-head">
          <circle class="ac-skin" cx="32" cy="48" r="9" fill="#3a2f18"/>
          <path class="ac-antenna" d="M28 40 q-4 -7 -9 -6" fill="none" stroke="#3a2f18" stroke-width="2" stroke-linecap="round"/>
          <path class="ac-antenna" d="M35 39 q0 -8 -4 -10" fill="none" stroke="#3a2f18" stroke-width="2" stroke-linecap="round"/>
          <g class="ac-face">
            <g class="ac-eye"><circle cx="30" cy="47" r="2.2" fill="#fff"/><circle cx="29.6" cy="47.2" r="1.1" fill="#171310"/></g>
          </g>
        </g>
      </g>
    </g>`;
  },

  /* BUTTERFLY — body + two wing pairs that flap; flies in loops. */
  butterfly(a){
    a = a || "#a78bfa";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="50" cy="90" rx="14" ry="3"/>
      <g class="ac-fly-rig">
        <g class="ac-wing ac-wing-l">
          <path d="M47 48 q-28 -26 -30 -6 q-1 12 14 15 q-16 2 -10 13 q5 9 26 -8 Z" fill="${a}"/>
          <circle cx="30" cy="42" r="3.4" fill="#f3ecff" opacity=".8"/>
          <circle cx="30" cy="62" r="2.6" fill="#f3ecff" opacity=".7"/>
        </g>
        <g class="ac-wing ac-wing-r">
          <path d="M53 48 q28 -26 30 -6 q1 12 -14 15 q16 2 10 13 q-5 9 -26 -8 Z" fill="#c4a9ff"/>
          <circle cx="70" cy="42" r="3.4" fill="#f3ecff" opacity=".8"/>
          <circle cx="70" cy="62" r="2.6" fill="#f3ecff" opacity=".7"/>
        </g>
        <ellipse class="ac-body" cx="50" cy="52" rx="4" ry="15" fill="#3d3350"/>
        <path class="ac-antenna" d="M48 39 q-4 -8 -9 -9" fill="none" stroke="#3d3350" stroke-width="1.8" stroke-linecap="round"/>
        <path class="ac-antenna" d="M52 39 q4 -8 9 -9" fill="none" stroke="#3d3350" stroke-width="1.8" stroke-linecap="round"/>
      </g>
    </g>`;
  },

  /* FISH — body, tail fin, side fin, bubbles; sways/swims. */
  fish(a){
    a = a || "#4aa8d6";
    return `
    <g class="ac-root">
      <g class="ac-bubbles" fill="none" stroke="#9fd6ef" stroke-width="1.6">
        <circle class="ac-bubble b1" cx="24" cy="34" r="2.6"/>
        <circle class="ac-bubble b2" cx="18" cy="24" r="1.8"/>
        <circle class="ac-bubble b3" cx="28" cy="18" r="1.4"/>
      </g>
      <g class="ac-swim-rig">
        <g class="ac-tail"><path d="M76 50 l16 -12 q-4 12 0 24 Z" fill="#3c8ab2"/></g>
        <ellipse class="ac-body" cx="50" cy="50" rx="28" ry="17" fill="${a}"/>
        <path class="ac-fin" d="M48 42 q10 -12 18 -6 q-6 8 -12 10 Z" fill="#3c8ab2"/>
        <path class="ac-belly" d="M28 56 q22 12 44 0 q-20 8 -44 0 Z" fill="#8fd0ec"/>
        <g class="ac-face">
          <g class="ac-eye"><circle cx="32" cy="46" r="3" fill="#fff"/><circle cx="31.4" cy="46.4" r="1.5" fill="#16303c"/></g>
        </g>
        <path class="ac-mouth" d="M22 52 q3 2 6 1" fill="none" stroke="#2c6c8c" stroke-width="1.5" stroke-linecap="round"/>
        <path class="ac-gill" d="M40 42 q-4 8 0 16" fill="none" stroke="#3c8ab2" stroke-width="1.8" stroke-linecap="round"/>
      </g>
    </g>`;
  },

  /* WINDMILL — tower + hub + four blades (.ac-blades spins). Blades are
     drawn symmetric about the hub so fill-box center = hub. */
  windmill(a){
    a = a || "#93a8b8";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="50" cy="93" rx="20" ry="3.5"/>
      <path class="ac-tower" d="M44 40 L40 90 h20 L56 40 Z" fill="${a}"/>
      <rect class="ac-door" x="46.5" y="74" width="7" height="16" rx="3" fill="#5b7181"/>
      <g class="ac-blades">
        <path d="M50 34 L47.4 6 h5.2 Z" fill="#e8eef2"/>
        <path d="M50 34 L78 31.4 v5.2 Z" fill="#dbe4ea"/>
        <path d="M50 34 L52.6 62 h-5.2 Z" fill="#e8eef2"/>
        <path d="M50 34 L22 36.6 v-5.2 Z" fill="#dbe4ea"/>
      </g>
      <circle class="ac-hub" cx="50" cy="34" r="4.5" fill="#5b7181"/>
      <circle cx="50" cy="34" r="1.8" fill="#e8eef2"/>
    </g>`;
  },

  /* ROCKET — body, window, fins, flickering flame; launches. */
  rocket(a){
    a = a || "#e8482b";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="50" cy="93" rx="16" ry="3.5"/>
      <g class="ac-ship">
        <g class="ac-flame">
          <path d="M44 78 q6 16 12 0 q-3 8 -6 12 q-3 -4 -6 -12 Z" fill="#f6a13c"/>
          <path d="M47 78 q3 9 6 0 q-1.5 6 -3 8 q-1.5 -2 -3 -8 Z" fill="#ffd66b"/>
        </g>
        <path class="ac-fin ac-fin-l" d="M40 62 q-12 6 -10 20 q8 -4 12 -12 Z" fill="#b53420"/>
        <path class="ac-fin ac-fin-r" d="M60 62 q12 6 10 20 q-8 -4 -12 -12 Z" fill="#b53420"/>
        <path class="ac-hull" d="M50 8 q16 16 12 46 q-1 10 -12 14 q-11 -4 -12 -14 q-4 -30 12 -46 Z" fill="#f2f5f7"/>
        <path class="ac-nose" d="M50 8 q10 10 12 26 h-24 q2 -16 12 -26 Z" fill="${a}"/>
        <circle class="ac-window" cx="50" cy="44" r="7.5" fill="#bfe3f4" stroke="#37596b" stroke-width="2.4"/>
        <circle cx="47.5" cy="41.5" r="2.2" fill="#eef8fd"/>
      </g>
      <g class="ac-stars" fill="#f6c445">
        <circle class="ac-star s1" cx="22" cy="26" r="1.6"/>
        <circle class="ac-star s2" cx="80" cy="20" r="1.3"/>
        <circle class="ac-star s3" cx="78" cy="52" r="1.5"/>
      </g>
    </g>`;
  },

  /* LIGHTBULB — glass, filament, base, glow + rays; flashes. */
  lightbulb(a){
    a = a || "#f6b73c";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="50" cy="92" rx="14" ry="3"/>
      <circle class="ac-glow" cx="50" cy="42" r="30" fill="${a}" opacity=".18"/>
      <g class="ac-rays" stroke="${a}" stroke-width="2.6" stroke-linecap="round">
        <line x1="50" y1="4"  x2="50" y2="12"/>
        <line x1="18" y1="42" x2="26" y2="42"/>
        <line x1="74" y1="42" x2="82" y2="42"/>
        <line x1="26" y1="19" x2="32" y2="25"/>
        <line x1="68" y1="25" x2="74" y2="19"/>
      </g>
      <path class="ac-glass" d="M50 18 q20 0 20 20 q0 12 -9 18 l-2 8 h-18 l-2 -8 q-9 -6 -9 -18 q0 -20 20 -20 Z" fill="#fff6dd" stroke="${a}" stroke-width="2.6"/>
      <path class="ac-filament" d="M44 58 q2 -10 -3 -14 M56 58 q-2 -10 3 -14 M41 44 q9 6 18 0" fill="none" stroke="#d98a1f" stroke-width="2" stroke-linecap="round"/>
      <g class="ac-base">
        <rect x="42" y="64" width="16" height="4.5" rx="2" fill="#9aa3ab"/>
        <rect x="43" y="70" width="14" height="4.5" rx="2" fill="#8a939b"/>
        <path d="M45 76 h10 l-3 6 h-4 Z" fill="#7d868e"/>
      </g>
    </g>`;
  },

  /* TROPHY — cup, handles, base, star, moving gleam; shines. */
  trophy(a){
    a = a || "#eab308";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="50" cy="93" rx="18" ry="3.5"/>
      <g class="ac-cup-rig">
        <path class="ac-handle" d="M30 28 q-14 2 -10 16 q3 10 14 10" fill="none" stroke="#c98f06" stroke-width="4" stroke-linecap="round"/>
        <path class="ac-handle" d="M70 28 q14 2 10 16 q-3 10 -14 10" fill="none" stroke="#c98f06" stroke-width="4" stroke-linecap="round"/>
        <path class="ac-cup" d="M30 22 h40 q0 26 -12 34 q-4 3 -8 3 q-4 0 -8 -3 q-12 -8 -12 -34 Z" fill="${a}"/>
        <path class="ac-shine" d="M37 26 q-1 18 7 27 l-6 1 q-9 -10 -8 -28 Z" fill="#ffe9a3" opacity=".85"/>
        <path class="ac-star" d="M50 32 l2.6 5.4 6 .8 -4.4 4.1 1.1 5.9 -5.3 -2.9 -5.3 2.9 1.1 -5.9 -4.4 -4.1 6 -.8 Z" fill="#fff4cc"/>
        <rect class="ac-stem" x="45" y="59" width="10" height="9" rx="2" fill="#c98f06"/>
        <rect class="ac-base" x="34" y="68" width="32" height="7" rx="2.5" fill="#8a6206"/>
        <rect class="ac-base" x="30" y="76" width="40" height="8" rx="3" fill="#6e4e05"/>
      </g>
      <g class="ac-sparkles" fill="#ffe9a3">
        <circle class="ac-spark s1" cx="24" cy="18" r="1.8"/>
        <circle class="ac-spark s2" cx="78" cy="14" r="1.4"/>
        <circle class="ac-spark s3" cx="80" cy="58" r="1.6"/>
      </g>
    </g>`;
  },
};

/* ─────────────────────────────────────────────────────────────────────
   INJECTED ANIMATION STYLESHEET (v2)
   Loaded after hanns.css, so equal-specificity rules here win — this is
   how existing actions get their improved timing without editing
   hanns.css. Selectors use [data-kind] to bump specificity one notch
   above legacy `.actor[data-action=…]` rules.
   ───────────────────────────────────────────────────────────────────── */
const ACTOR_CSS = `
/* parts transform around their own box */
.actor .ac-root,.actor .ac-body,.actor .ac-head,.actor .ac-legs,.actor .ac-leg,
.actor .ac-arm,.actor .ac-tail,.actor .ac-wing,.actor .ac-sprout,.actor .ac-canopy,
.actor .ac-eye,.actor .ac-shadow,.actor .ac-blades,.actor .ac-ship,.actor .ac-flame,
.actor .ac-fly-rig,.actor .ac-swim-rig,.actor .ac-cup-rig,.actor .ac-rays,
.actor .ac-glow,.actor .ac-sun,.actor .ac-cloud,.actor .ac-ear,.actor .ac-wool{
  transform-box:fill-box;transform-origin:center;
}
.actor .ac-root{transform-origin:50% 100%;}
.actor .ac-legs .ac-leg{transform-origin:50% 0%;}
.actor .ac-arm{transform-origin:50% 12%;}
.actor .ac-tail{transform-origin:0% 50%;}
.actor .ac-head{transform-origin:70% 80%;}
.actor .ac-sprout{transform-origin:50% 100%;}
.actor .ac-canopy{transform-origin:50% 90%;}
.actor .ac-body{transform-origin:50% 100%;}
.actor .ac-wing-l{transform-origin:100% 60%;}
.actor .ac-wing-r{transform-origin:0% 60%;}
.actor .ac-shadow{transform-origin:center;}

/* mood faces */
.actor .ac-mouth{display:none;}
.actor .ac-mouth-neutral{display:block;}
.actor[data-mood="happy"] .ac-mouth-neutral,
.actor[data-mood="sad"] .ac-mouth-neutral{display:none;}
.actor[data-mood="happy"] .ac-mouth-happy{display:block;}
.actor[data-mood="sad"] .ac-mouth-sad{display:block;}

/* ── life: blink + idle breathing (runs on every actor) ── */
.actor[data-kind] .ac-eye{animation:acxBlink 4.4s ease-in-out infinite;}
.actor[data-kind] .ac-eye:nth-of-type(2){animation-delay:.06s;}
@keyframes acxBlink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}98%{transform:scaleY(1)}}
.actor[data-kind][data-action="idle"] .ac-body{animation:acxBreathe 3.2s ease-in-out infinite;}
@keyframes acxBreathe{0%,100%{transform:scaleY(1)}50%{transform:scaleY(1.025) scaleX(1.008)}}
.actor[data-kind][data-action="idle"] .ac-head{animation:acxHeadBob 3.2s ease-in-out infinite;}
@keyframes acxHeadBob{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-2.5deg)}}
.actor[data-kind][data-action="idle"] .ac-tail{animation:acxTailIdle 2.6s ease-in-out infinite;}
@keyframes acxTailIdle{0%,100%{transform:rotate(0deg)}50%{transform:rotate(8deg)}}

/* ── shared actions ── */
.actor[data-kind][data-action="shake"] .ac-root{animation:acxShake .5s ease-in-out infinite;}
@keyframes acxShake{0%,100%{transform:rotate(0deg)}25%{transform:rotate(-5deg)}75%{transform:rotate(5deg)}}

.actor[data-kind][data-action="jump"] .ac-root{animation:acxJump 1s cubic-bezier(.34,1.2,.5,1) infinite;}
@keyframes acxJump{
  0%,100%{transform:translateY(0) scaleY(1)}
  12%{transform:translateY(2px) scaleY(.92)}
  40%{transform:translateY(-16px) scaleY(1.05)}
  62%{transform:translateY(-16px) scaleY(1)}
  88%{transform:translateY(1px) scaleY(.94)}
}
.actor[data-kind][data-action="jump"] .ac-shadow{animation:acxShadowJump 1s ease-in-out infinite;}
@keyframes acxShadowJump{0%,100%{transform:scale(1);opacity:1}45%,62%{transform:scale(.62);opacity:.45}}

/* run: body bob + alternating leg gait + tail streaming */
.actor[data-kind][data-action="run"] .ac-root{animation:acxRunBob .46s ease-in-out infinite;}
@keyframes acxRunBob{0%,100%{transform:translateY(0) rotate(-1.5deg)}50%{transform:translateY(-4px) rotate(1.5deg)}}
.actor[data-kind][data-action="run"] .ac-leg-1,
.actor[data-kind][data-action="run"] .ac-leg-3,
.actor[data-kind][data-action="run"] .ac-leg-l{animation:acxGaitA .46s ease-in-out infinite;}
.actor[data-kind][data-action="run"] .ac-leg-2,
.actor[data-kind][data-action="run"] .ac-leg-4,
.actor[data-kind][data-action="run"] .ac-leg-r{animation:acxGaitB .46s ease-in-out infinite;}
@keyframes acxGaitA{0%,100%{transform:rotate(24deg)}50%{transform:rotate(-24deg)}}
@keyframes acxGaitB{0%,100%{transform:rotate(-24deg)}50%{transform:rotate(24deg)}}
.actor[data-kind][data-action="run"] .ac-tail{animation:acxTailRun .46s ease-in-out infinite;}
@keyframes acxTailRun{0%,100%{transform:rotate(14deg)}50%{transform:rotate(24deg)}}

/* ── farmer ── */
.actor[data-kind="farmer"][data-action="wave"] .ac-arm-r{animation:acxWave .9s ease-in-out infinite;}
@keyframes acxWave{0%,100%{transform:rotate(-118deg)}50%{transform:rotate(-152deg)}}
.actor[data-kind="farmer"][data-action="wave"] .ac-head{animation:acxHeadBob 1.8s ease-in-out infinite;}
.actor[data-kind="farmer"][data-action="dance"] .ac-root{animation:acxDance .84s ease-in-out infinite;}
@keyframes acxDance{0%,100%{transform:rotate(-6deg) translateY(0)}25%{transform:rotate(0deg) translateY(-6px)}50%{transform:rotate(6deg) translateY(0)}75%{transform:rotate(0deg) translateY(-6px)}}
.actor[data-kind="farmer"][data-action="dance"] .ac-arm-l{animation:acxDanceArmL .84s ease-in-out infinite;}
.actor[data-kind="farmer"][data-action="dance"] .ac-arm-r{animation:acxDanceArmR .84s ease-in-out infinite;}
@keyframes acxDanceArmL{0%,100%{transform:rotate(-130deg)}50%{transform:rotate(-30deg)}}
@keyframes acxDanceArmR{0%,100%{transform:rotate(30deg)}50%{transform:rotate(130deg)}}

/* ── grazing / pecking / flapping / wagging ── */
.actor[data-kind][data-action="eat"] .ac-head{animation:acxEat 1.5s ease-in-out infinite;}
@keyframes acxEat{0%,100%{transform:rotate(0deg)}35%,65%{transform:rotate(26deg) translateY(3px)}45%,55%{transform:rotate(30deg) translateY(4px)}}
.actor[data-kind][data-action="eat"] .ac-tail{animation:acxTailIdle 1.5s ease-in-out infinite;}

.actor[data-kind="chicken"][data-action="peck"] .ac-head{animation:acxPeck .74s ease-in-out infinite;}
@keyframes acxPeck{0%,55%,100%{transform:translate(0,0) rotate(0deg)}25%,40%{transform:translate(-3px,9px) rotate(-14deg)}}
.actor[data-kind="chicken"][data-action="peck"] .ac-tail{animation:acxTailIdle .74s ease-in-out infinite;}

.actor[data-kind="chicken"][data-action="flap"] .ac-wing{animation:acxFlap .22s ease-in-out infinite;}
@keyframes acxFlap{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-42deg)}}
.actor[data-kind="chicken"][data-action="flap"] .ac-root{animation:acxFlapHop .66s ease-in-out infinite;}
@keyframes acxFlapHop{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}

.actor[data-kind="dog"][data-action="wag"] .ac-tail{animation:acxWag .3s ease-in-out infinite;}
@keyframes acxWag{0%,100%{transform:rotate(-18deg)}50%{transform:rotate(26deg)}}
.actor[data-kind="dog"][data-action="wag"] .ac-root{animation:acxWagWiggle .6s ease-in-out infinite;}
@keyframes acxWagWiggle{0%,100%{transform:rotate(-1.2deg)}50%{transform:rotate(1.2deg)}}

/* ── growth: springy overshoot, leaves unfurl ── */
.actor[data-kind][data-action="grow"] .ac-sprout{animation:acxGrow 1.7s cubic-bezier(.34,1.45,.5,1) both;}
@keyframes acxGrow{0%{transform:scale(.06)}62%{transform:scale(1.1)}80%{transform:scale(.97)}100%{transform:scale(1)}}
.actor[data-kind][data-action="grow"] .ac-leaf{animation:acxLeafUnfurl 1.7s cubic-bezier(.34,1.45,.5,1) both;}
@keyframes acxLeafUnfurl{0%,45%{transform:scale(.1) rotate(-30deg)}85%{transform:scale(1.08)}100%{transform:scale(1)}}
.actor[data-kind="tree"][data-action="grow"] .ac-canopy{animation:acxGrow 1.7s cubic-bezier(.34,1.45,.5,1) both;}
.actor[data-kind][data-action="shake"] .ac-canopy,
.actor[data-kind][data-action="shake"] .ac-leaf{animation:acxRustle .34s ease-in-out infinite;}
@keyframes acxRustle{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(4deg)}}

/* ── water tank: eased fill/empty + surface wave ── */
.actor[data-kind="water_tank"] .ac-water{transform:translateY(calc((1 - var(--fill,0)) * 54px));transition:transform .5s cubic-bezier(.22,1,.36,1);}
.actor[data-kind="water_tank"] .ac-water-top{transform:translateY(calc((1 - var(--fill,0)) * 54px));transition:transform .5s cubic-bezier(.22,1,.36,1);}
.actor[data-kind="water_tank"][data-action="fill"] .ac-water,
.actor[data-kind="water_tank"][data-action="fill"] .ac-water-top{animation:acxFill 2.4s cubic-bezier(.22,1,.36,1) both;}
@keyframes acxFill{0%{transform:translateY(54px)}100%{transform:translateY(calc((1 - var(--fill,1)) * 54px))}}
.actor[data-kind="water_tank"][data-action="empty"] .ac-water,
.actor[data-kind="water_tank"][data-action="empty"] .ac-water-top{animation:acxEmpty 2.4s cubic-bezier(.55,0,.55,.2) both;}
@keyframes acxEmpty{0%{transform:translateY(calc((1 - var(--fill,0)) * 54px))}100%{transform:translateY(56px)}}
.actor[data-kind="water_tank"] .ac-water-top{animation:acxWave 2.2s ease-in-out infinite;}
@keyframes acxWave{0%,100%{transform:translateY(calc((1 - var(--fill,0)) * 54px)) scaleX(1)}50%{transform:translateY(calc((1 - var(--fill,0)) * 54px - 1.5px)) scaleX(1.03)}}

/* ── sun / rain ── */
.actor[data-kind="sun_rain"] .ac-cloud{opacity:0;transition:opacity .4s ease;}
.actor[data-kind="sun_rain"] .ac-sun{opacity:1;transition:opacity .4s ease;}
.actor[data-kind="sun_rain"][data-action="rain"] .ac-cloud{opacity:1;}
.actor[data-kind="sun_rain"][data-action="rain"] .ac-sun{opacity:0;}
.actor[data-kind="sun_rain"] .ac-rays{animation:acxRaySpin 14s linear infinite;}
.actor[data-kind="sun_rain"][data-action="shine"] .ac-rays{animation:acxRaySpin 3.5s linear infinite;}
@keyframes acxRaySpin{to{transform:rotate(360deg)}}
.actor[data-kind="sun_rain"][data-action="shine"] .ac-sun-core{animation:acxSunPulse 1.4s ease-in-out infinite;}
@keyframes acxSunPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
.actor[data-kind="sun_rain"] .ac-drop{opacity:0;}
.actor[data-kind="sun_rain"][data-action="rain"] .ac-drop{animation:acxDrop 1s linear infinite;}
.actor[data-kind="sun_rain"][data-action="rain"] .ac-drop.d2{animation-delay:.33s;}
.actor[data-kind="sun_rain"][data-action="rain"] .ac-drop.d3{animation-delay:.66s;}
@keyframes acxDrop{0%{transform:translateY(-4px);opacity:0}25%{opacity:1}85%{opacity:1}100%{transform:translateY(16px);opacity:0}}

/* ── bee & butterfly: hover + flight loop, wing flutter ── */
.actor[data-kind="bee"] .ac-wing,
.actor[data-kind="butterfly"] .ac-wing{animation:acxFlutter .18s ease-in-out infinite;}
.actor[data-kind="butterfly"] .ac-wing{animation-duration:.42s;}
.actor[data-kind="bee"] .ac-wing-r,
.actor[data-kind="butterfly"] .ac-wing-r{animation-name:acxFlutterR;}
@keyframes acxFlutter{0%,100%{transform:scaleX(1) rotate(0deg)}50%{transform:scaleX(.45) rotate(-8deg)}}
@keyframes acxFlutterR{0%,100%{transform:scaleX(1) rotate(0deg)}50%{transform:scaleX(.45) rotate(8deg)}}
.actor[data-kind="bee"][data-action="idle"] .ac-fly-rig,
.actor[data-kind="butterfly"][data-action="idle"] .ac-fly-rig{animation:acxHover 2.4s ease-in-out infinite;}
@keyframes acxHover{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
.actor[data-kind="bee"][data-action="fly"] .ac-fly-rig,
.actor[data-kind="butterfly"][data-action="fly"] .ac-fly-rig{animation:acxFlyLoop 3.4s ease-in-out infinite;}
@keyframes acxFlyLoop{
  0%,100%{transform:translate(0,0) rotate(0deg)}
  20%{transform:translate(-14px,-12px) rotate(-10deg)}
  45%{transform:translate(4px,-20px) rotate(6deg)}
  70%{transform:translate(15px,-8px) rotate(10deg)}
  88%{transform:translate(5px,2px) rotate(2deg)}
}
.actor[data-kind="bee"][data-action="fly"] .ac-shadow,
.actor[data-kind="butterfly"][data-action="fly"] .ac-shadow{animation:acxShadowJump 3.4s ease-in-out infinite;}

/* ── fish ── */
.actor[data-kind="fish"] .ac-tail{animation:acxFishTail .6s ease-in-out infinite;}
@keyframes acxFishTail{0%,100%{transform:rotate(-8deg)}50%{transform:rotate(10deg)}}
.actor[data-kind="fish"][data-action="idle"] .ac-swim-rig{animation:acxHover 3s ease-in-out infinite;}
.actor[data-kind="fish"][data-action="swim"] .ac-swim-rig{animation:acxSwim 2.2s ease-in-out infinite;}
@keyframes acxSwim{0%,100%{transform:translateX(0) rotate(0deg)}25%{transform:translateX(-12px) rotate(-5deg)}75%{transform:translateX(12px) rotate(5deg)}}
.actor[data-kind="fish"][data-action="swim"] .ac-tail{animation-duration:.3s;}
.actor[data-kind="fish"][data-action="jump"] .ac-swim-rig{animation:acxFishJump 1.4s cubic-bezier(.34,1.2,.5,1) infinite;}
@keyframes acxFishJump{0%,100%{transform:translateY(0) rotate(0deg)}35%{transform:translateY(-22px) rotate(-16deg)}60%{transform:translateY(-22px) rotate(14deg)}}
.actor[data-kind="fish"] .ac-bubble{opacity:0;}
.actor[data-kind="fish"][data-action="swim"] .ac-bubble,
.actor[data-kind="fish"][data-action="idle"] .ac-bubble{animation:acxBubble 2.4s linear infinite;}
.actor[data-kind="fish"] .ac-bubble.b2{animation-delay:.8s;}
.actor[data-kind="fish"] .ac-bubble.b3{animation-delay:1.6s;}
@keyframes acxBubble{0%{transform:translateY(6px);opacity:0}20%{opacity:.9}80%{opacity:.6}100%{transform:translateY(-14px);opacity:0}}

/* ── windmill ── */
.actor[data-kind="windmill"] .ac-blades{animation:acxRaySpin 9s linear infinite;}
.actor[data-kind="windmill"][data-action="spin"] .ac-blades{animation:acxRaySpin 1.1s linear infinite;}
.actor[data-kind="windmill"][data-action="shake"] .ac-root{animation:acxShake .5s ease-in-out infinite;}

/* ── rocket ── */
.actor[data-kind="rocket"] .ac-flame{animation:acxFlicker .16s ease-in-out infinite;transform-origin:50% 0%;}
@keyframes acxFlicker{0%,100%{transform:scaleY(1) scaleX(1)}50%{transform:scaleY(1.25) scaleX(.88)}}
.actor[data-kind="rocket"][data-action="idle"] .ac-ship{animation:acxHover 2.6s ease-in-out infinite;}
.actor[data-kind="rocket"][data-action="launch"] .ac-ship{animation:acxLaunch 2.6s cubic-bezier(.5,0,.75,.4) infinite;}
@keyframes acxLaunch{
  0%{transform:translateY(0) rotate(0deg)}
  8%{transform:translateY(1px) rotate(-1.5deg)}
  14%{transform:translateY(0) rotate(1.5deg)}
  55%{transform:translateY(-72px);opacity:1}
  56%{opacity:0;transform:translateY(-72px)}
  57%{opacity:0;transform:translateY(34px)}
  75%{opacity:1}
  100%{transform:translateY(0)}
}
.actor[data-kind="rocket"][data-action="launch"] .ac-shadow{animation:acxShadowJump 2.6s ease-in-out infinite;}
.actor[data-kind="rocket"] .ac-star{animation:acxTwinkle 1.8s ease-in-out infinite;}
.actor[data-kind="rocket"] .ac-star.s2{animation-delay:.5s;}
.actor[data-kind="rocket"] .ac-star.s3{animation-delay:1s;}
@keyframes acxTwinkle{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1.2)}}

/* ── lightbulb ── */
.actor[data-kind="lightbulb"] .ac-glow{opacity:.14;}
.actor[data-kind="lightbulb"] .ac-rays{opacity:.35;}
.actor[data-kind="lightbulb"][data-action="idle"] .ac-glow{animation:acxGlowIdle 3s ease-in-out infinite;}
@keyframes acxGlowIdle{0%,100%{opacity:.12;transform:scale(.96)}50%{opacity:.22;transform:scale(1)}}
.actor[data-kind="lightbulb"][data-action="flash"] .ac-glow{animation:acxFlash 1.1s ease-in-out infinite;}
@keyframes acxFlash{0%,100%{opacity:.1;transform:scale(.9)}45%,60%{opacity:.55;transform:scale(1.12)}}
.actor[data-kind="lightbulb"][data-action="flash"] .ac-rays{animation:acxRayFlash 1.1s ease-in-out infinite;}
@keyframes acxRayFlash{0%,100%{opacity:.2;transform:scale(.9)}45%,60%{opacity:1;transform:scale(1.1)}}
.actor[data-kind="lightbulb"][data-action="flash"] .ac-glass{animation:acxBulbPop 1.1s ease-in-out infinite;}
@keyframes acxBulbPop{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}

/* ── trophy ── */
.actor[data-kind="trophy"] .ac-shine{animation:acxGleam 3.4s ease-in-out infinite;}
@keyframes acxGleam{0%,60%,100%{transform:translateX(0);opacity:.85}75%{transform:translateX(20px);opacity:.25}90%{transform:translateX(0);opacity:.85}}
.actor[data-kind="trophy"][data-action="shine"] .ac-cup-rig{animation:acxTrophyRock 1.6s ease-in-out infinite;}
@keyframes acxTrophyRock{0%,100%{transform:rotate(-3deg) scale(1)}50%{transform:rotate(3deg) scale(1.04)}}
.actor[data-kind="trophy"] .ac-spark{opacity:0;}
.actor[data-kind="trophy"][data-action="shine"] .ac-spark{animation:acxTwinkle 1.2s ease-in-out infinite;}
.actor[data-kind="trophy"][data-action="shine"] .ac-spark.s2{animation-delay:.4s;}
.actor[data-kind="trophy"][data-action="shine"] .ac-spark.s3{animation-delay:.8s;}
.actor[data-kind="trophy"][data-action="shine"] .ac-star{animation:acxSunPulse 1.2s ease-in-out infinite;}

/* respect users who prefer less motion */
@media (prefers-reduced-motion: reduce){
  .actor *{animation-duration:0s!important;animation-iteration-count:1!important;transition:none!important;}
}
`;

function ensureActorStyles(){
  if(document.getElementById("hanns-actors-v2-css"))return;
  const st = document.createElement("style");
  st.id = "hanns-actors-v2-css";
  st.textContent = ACTOR_CSS;
  document.head.appendChild(st);
}
if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ensureActorStyles);
}else{
  ensureActorStyles();
}

/* ─────────────────────────────────────────────────────────────────────
   renderActor(el) → the .actor wrapper div (goes inside .object-art).
   Reads: el.objectType, el.accent, el.action, el.mood, el.level.
   ───────────────────────────────────────────────────────────────────── */
function renderActor(el){
  ensureActorStyles();
  const kind = el.objectType;
  const rig = RIGS[kind] || RIGS.farmer;
  const wrap = document.createElement("div");
  wrap.className = "actor actor-" + kind;

  const action = el.action || "idle";
  const mood   = ACTOR_HAS_MOOD.has(kind) ? (el.mood || "neutral") : "";
  wrap.dataset.action = action;
  if(mood) wrap.dataset.mood = mood;
  wrap.dataset.kind = kind;

  if(ACTOR_HAS_LEVEL.has(kind)){
    const f = clamp01((Number(el.level)||0)/100);
    wrap.style.setProperty("--fill", f);
  }
  wrap.style.setProperty("--accent", el.accent || "#5aa843");

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "actor-svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.innerHTML = rig(el.accent);
  wrap.appendChild(svg);
  return wrap;
}

/* Fire a one-shot action on a rendered actor node, then restore the
   looping action. Used by click-to-trigger (present) and the inspector
   "play once" preview. */
function playActorOnce(actorNode, action, ms){
  if(!actorNode) return;
  const prev = actorNode.dataset.action;
  actorNode.dataset.action = action;
  actorNode.dataset.playing = "1";
  void actorNode.offsetWidth;
  clearTimeout(actorNode.__acTimer);
  actorNode.__acTimer = setTimeout(()=>{
    delete actorNode.dataset.playing;
    actorNode.dataset.action = prev || "idle";
  }, ms || 1400);
}

window.HannsActors = {
  ACTOR_KINDS,
  ACTOR_ACTIONS,
  ACTOR_HAS_MOOD,
  ACTOR_HAS_LEVEL,
  RIGS,
  renderActor,
  playActorOnce,
  ensureActorStyles,
  isActor(kind){ return ACTOR_KINDS.has(kind); },
};

})();