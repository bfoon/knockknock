/* ════════════════════════════════════════════════════════════════════
   HANNS — ACTORS  (single-object 2D animated farm characters)
   ════════════════════════════════════════════════════════════════════
   Each actor is ONE inline <svg> rig, not a grid of repeated emoji. Parts
   are grouped with stable classes (.ac-body, .ac-face, .ac-legs, .ac-leaf,
   .ac-fill …) so hanns.css can animate individual limbs per action/mood.

   The rendered markup is:

     <div class="actor actor-<kind>" data-action="idle" data-mood="neutral">
        <svg class="actor-svg" viewBox="0 0 100 100">…rig…</svg>
     </div>

   State is driven purely by two data-attributes the CSS keys off:
       data-action : idle | grow | run | shake | jump | fill | empty
       data-mood   : happy | sad | neutral        (characters with a face)
   plus --fill (0..1) for the water tank and plant growth height.

   Nothing here repeats by `count` — an actor is a single character. (The
   old count-grid objects like wall/bricks/plates still use renderCountGrid
   in hanns_core.js; only the farm kinds below became single actors.)

   Exposed on window.HannsActors so hanns_core.js can call renderActor(el).
   ──────────────────────────────────────────────────────────────────── */
(function(){
"use strict";

/* Which object kinds are single-character actors (replaced the old
   emoji-count farm objects in place). hanns_core.js checks this to route
   renderObject() to renderActor() instead of renderCountGrid(). */
const ACTOR_KINDS = new Set([
  "farmer", "cow", "goat", "chicken",
  "plant", "tree", "seed", "water_tank", "sun_rain",
]);

/* Actions each actor supports. The editor uses this to show only the
   relevant action buttons; CSS provides a keyframe for every pair. Every
   actor supports "idle". Fill-type actors (plant, water_tank) additionally
   respond to el.level via --fill. */
const ACTOR_ACTIONS = {
  farmer:    ["idle", "wave", "shake", "jump"],
  cow:       ["idle", "run", "shake", "jump"],
  goat:      ["idle", "run", "shake", "jump"],
  chicken:   ["idle", "peck", "shake", "jump"],
  plant:     ["idle", "grow", "shake"],
  tree:      ["idle", "grow", "shake"],
  seed:      ["idle", "grow", "shake", "jump"],
  water_tank:["idle", "fill", "empty", "shake"],
  sun_rain:  ["idle", "shine", "rain"],
};

/* Which actors have a face that can smile / frown. */
const ACTOR_HAS_MOOD = new Set(["farmer", "cow", "goat", "chicken"]);

/* Which actors read a 0–100 level (fill / growth). */
const ACTOR_HAS_LEVEL = new Set(["plant", "tree", "seed", "water_tank"]);

function has(set, kind){ return set.has(kind); }
function clamp01(n){ n = Number(n); if(!isFinite(n)) return 0; return n<0?0:(n>1?1:n); }

/* ─────────────────────────────────────────────────────────────────────
   RIGS. Each returns an SVG string in a shared 0 0 100 100 viewBox.
   `a` is the accent colour (skin/hide/leaf tint); rigs derive shades from
   it with color-mix in CSS where possible, but pass explicit fallbacks so
   the art reads even without color-mix. Keep parts in named <g>/elements
   so CSS animations can target limbs, not the whole body.
   ───────────────────────────────────────────────────────────────────── */
const RIGS = {

  /* FARMER — a person: hat, head w/ face, torso, two arms, two legs.
     .ac-arm-r waves; .ac-legs shift for jump; face swaps via data-mood. */
  farmer(a){
    a = a || "#c98a52";
    return `
    <g class="ac-root">
      <!-- shadow -->
      <ellipse class="ac-shadow" cx="50" cy="93" rx="24" ry="4"/>
      <!-- legs -->
      <g class="ac-legs">
        <rect class="ac-leg ac-leg-l" x="41" y="66" width="7" height="22" rx="3.5" fill="#3f5d8a"/>
        <rect class="ac-leg ac-leg-r" x="52" y="66" width="7" height="22" rx="3.5" fill="#34507a"/>
        <ellipse cx="44.5" cy="90" rx="6" ry="3" fill="#26313f"/>
        <ellipse cx="55.5" cy="90" rx="6" ry="3" fill="#26313f"/>
      </g>
      <!-- torso -->
      <rect class="ac-body" x="37" y="44" width="26" height="26" rx="9" fill="#e7d9b8"/>
      <rect class="ac-body-strap" x="45" y="44" width="4" height="24" fill="#b98a4e"/>
      <!-- arms (sleeve + hand) -->
      <g class="ac-arm ac-arm-l"><rect x="29" y="46" width="8" height="16" rx="4" fill="#e7d9b8"/><circle cx="33" cy="63" r="4" fill="${a}"/></g>
      <g class="ac-arm ac-arm-r"><rect x="63" y="46" width="8" height="16" rx="4" fill="#e7d9b8"/><circle cx="67" cy="63" r="4" fill="${a}"/></g>
      <!-- head -->
      <g class="ac-head">
        <circle class="ac-skin" cx="50" cy="30" r="13" fill="${a}"/>
        <!-- hat -->
        <path class="ac-hat" d="M31 26 q19 -14 38 0 q-6 -3 -19 -3 q-13 0 -19 3 Z" fill="#caa15a"/>
        <ellipse class="ac-hat-top" cx="50" cy="20" rx="11" ry="7" fill="#d8b063"/>
        <!-- face -->
        <g class="ac-face">
          <circle class="ac-eye ac-eye-l" cx="45" cy="30" r="1.8" fill="#25201a"/>
          <circle class="ac-eye ac-eye-r" cx="55" cy="30" r="1.8" fill="#25201a"/>
          <path class="ac-mouth ac-mouth-happy" d="M45 35 q5 5 10 0" fill="none" stroke="#25201a" stroke-width="1.8" stroke-linecap="round"/>
          <path class="ac-mouth ac-mouth-sad"   d="M45 37 q5 -5 10 0" fill="none" stroke="#25201a" stroke-width="1.8" stroke-linecap="round"/>
          <path class="ac-mouth ac-mouth-neutral" d="M45 36 h10" fill="none" stroke="#25201a" stroke-width="1.8" stroke-linecap="round"/>
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
      <!-- body -->
      <ellipse class="ac-body" cx="52" cy="52" rx="27" ry="18" fill="${a}"/>
      <ellipse class="ac-spot" cx="44" cy="48" rx="7" ry="5" fill="#b7a99a"/>
      <ellipse class="ac-spot" cx="62" cy="56" rx="6" ry="4.5" fill="#c2b4a4"/>
      <!-- head -->
      <g class="ac-head">
        <ellipse class="ac-skin" cx="26" cy="46" rx="13" ry="12" fill="${a}"/>
        <path class="ac-ear ac-ear-l" d="M16 38 q-8 -3 -6 6 q5 2 8 -2 Z" fill="#d8d0c4"/>
        <path class="ac-ear ac-ear-r" d="M34 34 q6 -6 9 2 q-3 5 -8 2 Z" fill="#d8d0c4"/>
        <path class="ac-horn" d="M20 34 q-2 -6 3 -6" fill="none" stroke="#e6ddca" stroke-width="2.4" stroke-linecap="round"/>
        <ellipse class="ac-muzzle" cx="20" cy="52" rx="8" ry="6" fill="#f0c9c2"/>
        <circle cx="17" cy="52" r="1.3" fill="#7a5a55"/><circle cx="23" cy="52" r="1.3" fill="#7a5a55"/>
        <g class="ac-face">
          <circle class="ac-eye ac-eye-l" cx="22" cy="42" r="1.9" fill="#2a2622"/>
          <circle class="ac-eye ac-eye-r" cx="31" cy="42" r="1.9" fill="#2a2622"/>
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
          <circle class="ac-eye ac-eye-l" cx="25" cy="41" r="1.7" fill="#2a2622"/>
          <circle class="ac-eye ac-eye-r" cx="33" cy="41" r="1.7" fill="#2a2622"/>
          <path class="ac-mouth ac-mouth-happy" d="M20 49 q3 3 6 1" fill="none" stroke="#8a7d68" stroke-width="1.3" stroke-linecap="round"/>
          <path class="ac-mouth ac-mouth-sad"   d="M20 51 q3 -3 6 -1" fill="none" stroke="#8a7d68" stroke-width="1.3" stroke-linecap="round"/>
          <path class="ac-mouth ac-mouth-neutral" d="M20 50 h6" fill="none" stroke="#8a7d68" stroke-width="1.3" stroke-linecap="round"/>
        </g>
      </g>
    </g>`;
  },

  /* CHICKEN — round body, wing, comb, beak, two thin legs; pecks. */
  chicken(a){
    a = a || "#f6efe2";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="52" cy="92" rx="20" ry="3.5"/>
      <g class="ac-legs">
        <path class="ac-leg ac-leg-l" d="M47 80 v9 M44 90 h7" fill="none" stroke="#e0a53a" stroke-width="2.4" stroke-linecap="round"/>
        <path class="ac-leg ac-leg-r" d="M58 80 v9 M55 90 h7" fill="none" stroke="#e0a53a" stroke-width="2.4" stroke-linecap="round"/>
      </g>
      <!-- tail feathers -->
      <path class="ac-tail" d="M72 52 q18 -8 20 4 q-10 2 -14 8 Z" fill="#e7ddc9"/>
      <!-- body -->
      <ellipse class="ac-body" cx="54" cy="60" rx="22" ry="19" fill="${a}"/>
      <path class="ac-wing" d="M58 54 q14 4 10 20 q-9 0 -13 -10 Z" fill="#e7ddc9"/>
      <!-- head sits forward/left on top of the body -->
      <g class="ac-head">
        <circle class="ac-skin" cx="40" cy="36" r="12" fill="${a}"/>
        <path class="ac-comb" d="M33 25 q3 -6 6 -1 q3 -6 6 0 q3 -5 5 1 q-4 4 -8 4 q-5 0 -9 -4 Z" fill="#e14b3b"/>
        <path class="ac-beak" d="M28 36 l-10 4 l10 3 Z" fill="#f3a935"/>
        <path class="ac-wattle" d="M31 44 q-2 7 2 8 q3 -2 1 -8 Z" fill="#e14b3b"/>
        <g class="ac-face">
          <circle class="ac-eye" cx="38" cy="33" r="2.1" fill="#2a2622"/>
          <circle cx="38.7" cy="32.3" r=".7" fill="#fff"/>
        </g>
      </g>
    </g>`;
  },

  /* PLANT — pot + stem + leaves that grow. --fill (0..1) scales the sprout
     height for the level slider; grow action replays the rise. */
  plant(a){
    a = a || "#5aa843";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="50" cy="92" rx="18" ry="3.5"/>
      <!-- pot -->
      <path class="ac-pot" d="M36 74 h28 l-3 16 h-22 Z" fill="#c96a44"/>
      <rect class="ac-pot-rim" x="33" y="70" width="34" height="7" rx="3" fill="#d97a52"/>
      <!-- soil -->
      <ellipse cx="50" cy="73" rx="15" ry="3" fill="#5a4632"/>
      <!-- growing sprout: scaleY driven by --fill from the pot base -->
      <g class="ac-sprout">
        <path class="ac-stem" d="M50 73 v-34" fill="none" stroke="${a}" stroke-width="3.4" stroke-linecap="round"/>
        <path class="ac-leaf ac-leaf-l" d="M50 54 q-16 -4 -18 -16 q14 0 18 12 Z" fill="${a}"/>
        <path class="ac-leaf ac-leaf-r" d="M50 48 q16 -4 18 -16 q-14 0 -18 12 Z" fill="#6cbb4f"/>
        <circle class="ac-bud" cx="50" cy="38" r="5" fill="#8fd06a"/>
      </g>
    </g>`;
  },

  /* TREE — trunk + layered canopy; grow scales the canopy; shake rustles. */
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

  /* SEED — a single seed/kernel that can sprout (grow) or hop (jump). */
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

  /* WATER_TANK — tank whose water level = --fill; fill/empty animate it. */
  water_tank(a){
    a = a || "#3fa9d8";
    return `
    <g class="ac-root">
      <ellipse class="ac-shadow" cx="50" cy="92" rx="22" ry="4"/>
      <!-- legs -->
      <rect x="34" y="78" width="5" height="12" fill="#9aa3ab"/>
      <rect x="61" y="78" width="5" height="12" fill="#9aa3ab"/>
      <!-- tank shell (clip for water) -->
      <defs><clipPath id="ac-tank-clip"><rect x="30" y="24" width="40" height="56" rx="10"/></clipPath></defs>
      <g clip-path="url(#ac-tank-clip)">
        <rect x="30" y="24" width="40" height="56" fill="#eef4f7"/>
        <rect class="ac-water" x="28" y="26" width="44" height="56" fill="${a}"/>
        <ellipse class="ac-water-top" cx="50" cy="26" rx="22" ry="3" fill="#7fd0ee"/>
      </g>
      <rect class="ac-tank-outline" x="30" y="24" width="40" height="56" rx="10" fill="none" stroke="#7d8b95" stroke-width="2.4"/>
      <rect x="44" y="16" width="12" height="10" rx="3" fill="#9aa3ab"/>
      <path d="M40 80 h20 l-3 6 h-14 Z" fill="#b7c0c7"/>
    </g>`;
  },

  /* SUN_RAIN — a sun with rays that can shine, or a cloud that rains. */
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
};

/* ─────────────────────────────────────────────────────────────────────
   renderActor(el) → the .actor wrapper div (goes inside .object-art).
   Reads:
     el.objectType : which rig
     el.accent     : tint
     el.action     : current looping action (default the kind's first non-idle
                     is NOT auto — default is "idle")
     el.mood       : happy | sad | neutral (mood-capable actors)
     el.level      : 0..100 → --fill for plant/tree/seed/water_tank
   ───────────────────────────────────────────────────────────────────── */
function renderActor(el){
  const kind = el.objectType;
  const rig = RIGS[kind] || RIGS.farmer;
  const wrap = document.createElement("div");
  wrap.className = "actor actor-" + kind;

  const action = el.action || "idle";
  const mood   = ACTOR_HAS_MOOD.has(kind) ? (el.mood || "neutral") : "";
  wrap.dataset.action = action;
  if(mood) wrap.dataset.mood = mood;
  wrap.dataset.kind = kind;

  // level → --fill (0..1) for growth/water objects
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

/* Fire a one-shot action on a rendered actor node: adds data-playing so CSS
   can run a non-looping variant, then restores the looping action. Used by
   click-to-trigger (present) and the inspector "play once" preview. */
function playActorOnce(actorNode, action, ms){
  if(!actorNode) return;
  const prev = actorNode.dataset.action;
  actorNode.dataset.action = action;
  actorNode.dataset.playing = "1";
  // restart the CSS animation reliably
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
  isActor(kind){ return ACTOR_KINDS.has(kind); },
};

})();
