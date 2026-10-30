/* ═══════════════════════════════════════════════════════════════════
   DOOR SCREEN · GREETER
   ───────────────────────────────────────────────────────────────────
   A full-body welcome host for the screens outside a room, drawn as one
   SVG rig so it stays crisp on any TV and needs no images.

     figure  man | woman
     outfit  official — grand mbubb, embroidered neckline, kufi cap /
                        tall tiko head-wrap
             casual   — tie-dye kaftan shirt & trousers /
                        wax-print top & malan wrapper with a head-wrap
     style   animated (smooth, friendly) | robot (LED eyes, antenna,
             visible joints, stepped "servo" motion)
     skin    1 | 2 | 3

   Gestures, one every few seconds (`every`):
     wave · open arms · sign-language WELCOME (flat hand sweeps in to the
     body, twice) · hand on heart with a small bow · "this way" toward
     the room · a nod. Speech bubbles cycle through `lines`.

   Usage:  DoorGreeter.mount(hostEl, {figure, outfit, style, skin, side,
                                      every, sign, lines}) → {update, destroy}
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const SKIN = { 1: ["#8a5a3b", "#6f4529"], 2: ["#5e3a22", "#4a2c18"], 3: ["#3b2416", "#2a190e"] };
  const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Outfit palettes: Gambian indigo, gold embroidery, the flag's red/blue/green.
  const LOOKS = {
    man_official:   { robe: "#1f3a8a", robe2: "#172c6b", trim: "#e7b84a", trousers: "#1f3a8a", cap: "#f1e6c8", capTrim: "#e7b84a", shoes: "#6b4423" },
    man_casual:     { shirt: "#0f8a8a", shirt2: "#f2c14e", dye: "#e2552d", trousers: "#e9dfc8", shoes: "#7a4a24" },
    woman_official: { robe: "#7a1f6b", robe2: "#5c1650", trim: "#e7b84a", wrap: "#7a1f6b", wrap2: "#e7b84a", shoes: "#b9862f" },
    woman_casual:   { top: "#e2552d", top2: "#f6c344", top3: "#1d7a4a", skirt: "#1f4fa3", skirt2: "#f6c344", wrap: "#f6c344", wrap2: "#e2552d", shoes: "#7a4a24" },
  };

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }

  /* ───────────── drawing ───────────── */
  function build(opts) {
    const o = Object.assign({ figure: "woman", outfit: "official", style: "animated", skin: 2 }, opts || {});
    const robot = o.style === "robot";
    const key = (o.figure === "man" ? "man" : "woman") + "_" + (o.outfit === "casual" ? "casual" : "official");
    const L = LOOKS[key];
    const [skin, skinD] = SKIN[o.skin] || SKIN[2];
    const metal = "#c9d3df", metalD = "#8e9bab";
    const svg = el("svg", { viewBox: "0 0 320 640", class: "dg-svg", role: "img", "aria-label": "Welcome host" });
    const uid = "dg" + Math.random().toString(36).slice(2, 8);
    const defs = el("defs", {}, svg);

    // patterns: tie-dye rings, wax-print tiles, embroidery dots
    const dye = el("radialGradient", { id: uid + "dye", cx: "50%", cy: "40%", r: "65%" }, defs);
    [[0, L.dye || "#e2552d"], [.25, L.shirt2 || "#f2c14e"], [.5, L.shirt || "#0f8a8a"], [.75, L.shirt2 || "#f2c14e"], [1, L.shirt || "#0f8a8a"]]
      .forEach(([off, c]) => el("stop", { offset: off, "stop-color": c }, dye));
    const wax = el("pattern", { id: uid + "wax", width: 34, height: 34, patternUnits: "userSpaceOnUse" }, defs);
    el("rect", { width: 34, height: 34, fill: L.top || L.skirt || "#e2552d" }, wax);
    el("circle", { cx: 17, cy: 17, r: 10, fill: L.top2 || "#f6c344" }, wax);
    el("circle", { cx: 17, cy: 17, r: 5, fill: L.top3 || "#1d7a4a" }, wax);
    el("path", { d: "M0 0L8 0L0 8ZM34 34L26 34L34 26Z", fill: L.top3 || "#1d7a4a" }, wax);
    const skirtP = el("pattern", { id: uid + "skirt", width: 40, height: 40, patternUnits: "userSpaceOnUse", patternTransform: "rotate(20)" }, defs);
    el("rect", { width: 40, height: 40, fill: L.skirt || "#1f4fa3" }, skirtP);
    el("rect", { width: 40, height: 9, y: 15, fill: L.skirt2 || "#f6c344" }, skirtP);
    el("circle", { cx: 10, cy: 6, r: 3, fill: "#fff", opacity: .7 }, skirtP);
    const shine = el("linearGradient", { id: uid + "shine", x1: 0, x2: 1 }, defs);
    el("stop", { offset: 0, "stop-color": "#fff", "stop-opacity": .0 }, shine);
    el("stop", { offset: .45, "stop-color": "#fff", "stop-opacity": .22 }, shine);
    el("stop", { offset: 1, "stop-color": "#fff", "stop-opacity": 0 }, shine);
    const steel = el("linearGradient", { id: uid + "steel", x1: 0, x2: 1 }, defs);
    el("stop", { offset: 0, "stop-color": metalD }, steel); el("stop", { offset: .5, "stop-color": metal }, steel); el("stop", { offset: 1, "stop-color": metalD }, steel);

    const skinFill = robot ? `url(#${uid}steel)` : skin;
    const skinShade = robot ? metalD : skinD;

    // shadow
    el("ellipse", { cx: 160, cy: 622, rx: 92, ry: 12, fill: "#000", opacity: .28, class: "dg-shadow" }, svg);
    const root = el("g", { class: "dg-root" }, svg);           // breathing / sway / bow pivot at the feet
    const parts = { root };

    // legs + shoes
    const legs = el("g", {}, root);
    const trouser = L.trousers || (robot ? metalD : skinShade);
    if (o.figure === "man") {
      el("rect", { x: 128, y: 470, width: 26, height: 132, rx: 10, fill: trouser }, legs);
      el("rect", { x: 166, y: 470, width: 26, height: 132, rx: 10, fill: trouser }, legs);
    } else {
      el("rect", { x: 134, y: 520, width: 20, height: 84, rx: 9, fill: skinFill }, legs);
      el("rect", { x: 166, y: 520, width: 20, height: 84, rx: 9, fill: skinFill }, legs);
    }
    el("path", { d: "M118 600 Q122 588 140 590 L156 592 Q160 606 150 610 L120 610 Q114 606 118 600Z", fill: L.shoes }, legs);
    el("path", { d: "M202 600 Q198 588 180 590 L164 592 Q160 606 170 610 L200 610 Q206 606 202 600Z", fill: L.shoes }, legs);

    // torso / garment
    const torso = el("g", { class: "dg-torso" }, root);
    parts.torso = torso;
    if (key === "man_official") {
      // grand mbubb: wide robe falling to the shins, embroidered chest
      el("path", { d: "M104 182 Q160 160 216 182 L262 548 Q160 572 58 548 Z", fill: L.robe }, torso);
      el("path", { d: "M104 182 Q160 160 216 182 L238 380 Q160 396 82 380 Z", fill: L.robe2, opacity: .55 }, torso);
      el("path", { d: "M136 176 Q160 236 184 176", fill: "none", stroke: L.trim, "stroke-width": 7, "stroke-linecap": "round" }, torso);
      el("path", { d: "M160 205 L160 330", stroke: L.trim, "stroke-width": 4, "stroke-dasharray": "2 7", "stroke-linecap": "round" }, torso);
      for (let i = 0; i < 6; i++) el("circle", { cx: 140 + i * 8, cy: 250 + Math.abs(2.5 - i) * 9, r: 3, fill: L.trim }, torso);
      el("path", { d: "M58 548 Q160 572 262 548", fill: "none", stroke: L.trim, "stroke-width": 5 }, torso);
    } else if (key === "woman_official") {
      el("path", { d: "M110 186 Q160 166 210 186 L252 602 Q160 620 68 602 Z", fill: L.robe }, torso);
      el("path", { d: "M110 186 Q160 166 210 186 L224 330 Q160 346 96 330 Z", fill: L.robe2, opacity: .55 }, torso);
      el("path", { d: "M134 180 Q160 232 186 180", fill: "none", stroke: L.trim, "stroke-width": 7, "stroke-linecap": "round" }, torso);
      el("path", { d: "M120 300 Q160 320 200 300", fill: "none", stroke: L.trim, "stroke-width": 4, "stroke-dasharray": "3 6" }, torso);
      el("path", { d: "M68 602 Q160 620 252 602", fill: "none", stroke: L.trim, "stroke-width": 6 }, torso);
      for (let i = 0; i < 5; i++) el("path", { d: `M${92 + i * 34} 560 l8 -14 l8 14 z`, fill: L.trim, opacity: .9 }, torso);
    } else if (key === "man_casual") {
      el("path", { d: "M108 184 Q160 166 212 184 L226 478 Q160 492 94 478 Z", fill: `url(#${uid}dye)` }, torso);
      el("path", { d: "M146 180 L160 214 L174 180", fill: "none", stroke: "#fff", "stroke-width": 4, opacity: .8 }, torso);
      el("path", { d: "M94 478 Q160 492 226 478", fill: "none", stroke: "#fff", "stroke-width": 4, opacity: .5 }, torso);
    } else {
      el("path", { d: "M112 186 Q160 168 208 186 L222 392 Q160 404 98 392 Z", fill: `url(#${uid}wax)` }, torso);
      el("path", { d: "M92 382 Q160 400 228 382 L240 600 Q160 616 80 600 Z", fill: `url(#${uid}skirt)` }, torso);
      el("path", { d: "M92 382 Q160 400 228 382", fill: "none", stroke: L.top3 || "#1d7a4a", "stroke-width": 6 }, torso);
    }
    if (robot) {
      el("rect", { x: 132, y: 270, width: 56, height: 40, rx: 8, fill: "#0b1626", opacity: .82 }, torso);
      [0, 1, 2].forEach(i => el("circle", { cx: 146 + i * 14, cy: 290, r: 4, fill: ["#22d3ee", "#a3e635", "#f59e0b"][i], class: "dg-led l" + i }, torso));
    }
    // a small Gambia flag pin
    const pin = el("g", { transform: "translate(186 214)" }, torso);
    [["#ce1126", 0, 5], ["#fff", 5, 1.2], ["#0c1c8c", 6.2, 4.6], ["#fff", 10.8, 1.2], ["#3a7728", 12, 5]]
      .forEach(([c, y, h]) => el("rect", { x: 0, y, width: 20, height: h, fill: c }, pin));
    el("rect", { x: 0, y: 0, width: 20, height: 17, fill: "none", stroke: "#0006", "stroke-width": .8 }, pin);

    // neck + head
    const head = el("g", { class: "dg-head" }, root);
    parts.head = head;
    el("rect", { x: 148, y: 150, width: 24, height: 34, rx: 9, fill: skinFill }, head);
    if (robot) {
      el("rect", { x: 112, y: 70, width: 96, height: 92, rx: 30, fill: `url(#${uid}steel)` }, head);
      el("rect", { x: 122, y: 92, width: 76, height: 44, rx: 18, fill: "#0b1626" }, head);
      parts.eyeL = el("rect", { x: 138, y: 106, width: 14, height: 14, rx: 7, fill: "#22d3ee", class: "dg-eye" }, head);
      parts.eyeR = el("rect", { x: 168, y: 106, width: 14, height: 14, rx: 7, fill: "#22d3ee", class: "dg-eye" }, head);
      parts.mouth = el("path", { d: "M146 146 Q160 154 174 146", stroke: "#22d3ee", "stroke-width": 4, fill: "none", "stroke-linecap": "round" }, head);
      el("line", { x1: 160, y1: 70, x2: 160, y2: 46, stroke: metalD, "stroke-width": 4 }, head);
      parts.antenna = el("circle", { cx: 160, cy: 42, r: 7, fill: "#f43f5e", class: "dg-antenna" }, head);
      el("circle", { cx: 112, cy: 116, r: 9, fill: metalD }, head); el("circle", { cx: 208, cy: 116, r: 9, fill: metalD }, head);
    } else {
      el("ellipse", { cx: 160, cy: 116, rx: 42, ry: 48, fill: skin }, head);
      el("ellipse", { cx: 118, cy: 120, rx: 7, ry: 11, fill: skinD }, head);
      el("ellipse", { cx: 202, cy: 120, rx: 7, ry: 11, fill: skinD }, head);
      parts.eyeL = el("ellipse", { cx: 145, cy: 114, rx: 5, ry: 6, fill: "#1b0f08", class: "dg-eye" }, head);
      parts.eyeR = el("ellipse", { cx: 175, cy: 114, rx: 5, ry: 6, fill: "#1b0f08", class: "dg-eye" }, head);
      el("circle", { cx: 147, cy: 112, r: 1.6, fill: "#fff" }, head); el("circle", { cx: 177, cy: 112, r: 1.6, fill: "#fff" }, head);
      el("path", { d: "M137 101 Q145 96 153 100 M167 100 Q175 96 183 101", stroke: "#1b0f08", "stroke-width": 3, fill: "none", "stroke-linecap": "round" }, head);
      el("path", { d: "M157 120 Q160 130 163 120", stroke: skinD, "stroke-width": 3, fill: "none", "stroke-linecap": "round" }, head);
      parts.mouth = el("path", { d: "M145 138 Q160 150 175 138", stroke: "#5a1d12", "stroke-width": 4, fill: "#7a2a1c", "stroke-linecap": "round" }, head);
      el("ellipse", { cx: 136, cy: 132, rx: 8, ry: 4, fill: "#e86b5a", opacity: .25 }, head);
      el("ellipse", { cx: 184, cy: 132, rx: 8, ry: 4, fill: "#e86b5a", opacity: .25 }, head);
      if (o.figure === "man") {
        el("path", { d: "M128 98 Q160 70 192 98 Q192 80 160 74 Q128 80 128 98Z", fill: "#1b0f08" }, head);
        el("path", { d: "M138 144 Q160 162 182 144 Q178 158 160 160 Q142 158 138 144Z", fill: "#1b0f08", opacity: .85 }, head);
      } else {
        el("circle", { cx: 118, cy: 134, r: 4, fill: "#e7b84a" }, head); el("circle", { cx: 202, cy: 134, r: 4, fill: "#e7b84a" }, head);
      }
    }
    // headwear
    if (key === "man_official") {
      el("path", { d: robot ? "M120 78 Q160 56 200 78 L198 60 Q160 40 122 60Z" : "M120 92 Q160 78 200 92 L196 62 Q160 48 124 62Z", fill: L.cap }, head);
      el("path", { d: robot ? "M121 74 Q160 58 199 74" : "M121 88 Q160 76 199 88", fill: "none", stroke: L.capTrim, "stroke-width": 4 }, head);
    } else if (key === "woman_official") {
      // tiko: a tall head-wrap with a fanned knot
      el("path", { d: "M112 104 Q108 48 160 40 Q214 46 208 104 Q160 86 112 104Z", fill: L.wrap }, head);
      el("path", { d: "M120 64 Q160 30 202 62 Q190 14 160 8 Q128 14 120 64Z", fill: L.wrap }, head);
      el("path", { d: "M150 26 Q138 -2 166 4 Q190 -4 176 30Z", fill: L.wrap2 }, head);
      el("path", { d: "M114 96 Q160 80 206 96", fill: "none", stroke: L.wrap2, "stroke-width": 5 }, head);
    } else if (key === "woman_casual") {
      el("path", { d: "M114 104 Q110 54 160 48 Q212 54 206 104 Q160 88 114 104Z", fill: L.wrap }, head);
      el("path", { d: "M188 54 Q222 40 214 74 Q206 62 192 66Z", fill: L.wrap2 }, head);
      el("path", { d: "M116 92 Q160 78 204 92", fill: "none", stroke: L.wrap2, "stroke-width": 4, "stroke-dasharray": "6 5" }, head);
    }

    // arms: shoulder → elbow → wrist, each rotating about its own joint
    function arm(side) {
      const s = side === "R" ? 1 : -1;
      const sx = 160 + s * 50, sy = 196;
      const sh = el("g", { class: "dg-arm" + side }, root);
      const sleeve = key.endsWith("official") ? (L.robe || L.wrap) : key === "man_casual" ? `url(#${uid}dye)` : `url(#${uid}wax)`;
      const wide = key.endsWith("official");
      // upper arm
      el("path", { d: wide ? `M${sx - 16} ${sy - 6} L${sx + 16} ${sy - 6} L${sx + s * 6 + 22} ${sy + 92} L${sx + s * 6 - 22} ${sy + 92} Z`
                           : `M${sx - 13} ${sy - 4} L${sx + 13} ${sy - 4} L${sx + 11} ${sy + 88} L${sx - 11} ${sy + 88} Z`,
                fill: sleeve }, sh);
      if (robot) el("circle", { cx: sx, cy: sy, r: 12, fill: metalD }, sh);
      const fore = el("g", {}, sh);
      const ex = sx, ey = sy + 86;
      if (robot) el("circle", { cx: ex, cy: ey, r: 10, fill: metalD }, fore);
      el("rect", { x: ex - 10, y: ey - 4, width: 20, height: 82, rx: 9, fill: skinFill }, fore);
      if (wide) el("path", { d: `M${ex - 24} ${ey + 4} L${ex + 24} ${ey + 4} L${ex + 16} ${ey + 34} L${ex - 16} ${ey + 34} Z`, fill: sleeve, opacity: .96 }, fore);
      const hand = el("g", {}, fore);
      const hx = ex, hy = ey + 82;
      if (robot) {
        el("rect", { x: hx - 13, y: hy - 4, width: 26, height: 26, rx: 9, fill: metal }, hand);
        el("rect", { x: hx - 12, y: hy + 18, width: 6, height: 12, rx: 3, fill: metalD }, hand);
        el("rect", { x: hx - 3, y: hy + 18, width: 6, height: 14, rx: 3, fill: metalD }, hand);
        el("rect", { x: hx + 6, y: hy + 18, width: 6, height: 12, rx: 3, fill: metalD }, hand);
      } else {
        el("path", { d: `M${hx - 12} ${hy - 2} Q${hx - 14} ${hy + 22} ${hx - 6} ${hy + 30} L${hx + 8} ${hy + 30} Q${hx + 15} ${hy + 20} ${hx + 12} ${hy - 2}Z`, fill: skin }, hand);
        el("path", { d: `M${hx + s * 12} ${hy + 4} q${s * 10} 4 ${s * 9} 14`, stroke: skin, "stroke-width": 8, "stroke-linecap": "round", fill: "none" }, hand);
        el("path", { d: `M${hx - 5} ${hy + 22} v8 M${hx + 1} ${hy + 22} v9 M${hx + 7} ${hy + 22} v7`, stroke: skinD, "stroke-width": 1.4, opacity: .5 }, hand);
      }
      return { sh, fore, hand, sx, sy, ex, ey, hx, hy };
    }
    parts.L = arm("L");
    parts.R = arm("R");
    // the right arm draws in front of the torso, the left behind the head layer order is fine as is
    root.appendChild(parts.R.sh);
    root.insertBefore(parts.L.sh, torso.nextSibling);
    return { svg, parts, robot };
  }

  /* ───────────── motion ───────────── */
  // Gestures place the HANDS; a two-bone IK solver turns each hand target into shoulder and
  // elbow angles, so hands travel in straight, natural paths (a sign sweeps in to the chest
  // instead of swinging through the hips). Coordinates are per arm and "outward-positive":
  // x > 0 is away from the body's centre line, x < 0 crosses in front of it; y is down from
  // the shoulder. `o*` = the OUTER arm (away from the speech bubble), `i*` = the INNER arm
  // (toward the room / screen centre). w = wrist tilt. head > 0 tilts toward the outer side.
  const LU = 86, LF = 82;                                   // upper arm, forearm (rig units)
  const REST = { ox: 12, oy: 160, ow: 0, ix: 12, iy: 160, iw: 0, head: 0, y: 0 };
  const P = (o) => Object.assign({}, REST, o);

  function solve(tx, ty) {
    // returns [upper, fore] absolute angles in degrees, 0 = hanging down, + = outward
    let d = Math.hypot(tx, ty);
    d = Math.max(Math.abs(LU - LF) + 1, Math.min(LU + LF - .5, d));
    const phiT = Math.atan2(tx, ty);
    const a = Math.acos(Math.max(-1, Math.min(1, (LU * LU + d * d - LF * LF) / (2 * LU * d))));
    const b = Math.acos(Math.max(-1, Math.min(1, (LU * LU + LF * LF - d * d) / (2 * LU * LF))));
    // two solutions; keep the one whose elbow sits further outward (a natural, relaxed elbow)
    const u1 = phiT + a, u2 = phiT - a;
    const pick = Math.sin(u1) >= Math.sin(u2) ? [u1, u1 - (Math.PI - b)] : [u2, u2 + (Math.PI - b)];
    return pick.map(r => r * 180 / Math.PI);
  }

  function gestures() {
    return {
      // big friendly wave with the outer hand, the hand rocking from the elbow
      wave: [[0, REST], [450, P({ ox: 52, oy: -112, ow: 0, head: 6 })],
             [700, P({ ox: 66, oy: -108, ow: 24, head: 6 })], [950, P({ ox: 40, oy: -114, ow: -24, head: 6 })],
             [1200, P({ ox: 66, oy: -108, ow: 24, head: 6 })], [1450, P({ ox: 40, oy: -114, ow: -24, head: 6 })],
             [1700, P({ ox: 60, oy: -110, ow: 16, head: 6 })], [2300, REST]],
      // arms open wide: "you are welcome here"
      open: [[0, REST], [650, P({ ox: 128, oy: -22, ow: -18, ix: 128, iy: -22, iw: -18, y: -4 })],
             [1600, P({ ox: 134, oy: -30, ow: -22, ix: 134, iy: -30, iw: -22, y: -5 })], [2300, REST]],
      // sign WELCOME: flat hand, palm up, out at the side → sweeps in to the body. Twice.
      sign: [[0, REST], [450, P({ ox: 108, oy: 84, ow: -28, head: -3 })], [1150, P({ ox: -28, oy: 72, ow: -28, head: -6 })],
             [1350, P({ ox: 108, oy: 84, ow: -28, head: -3 })], [2050, P({ ox: -28, oy: 72, ow: -28, head: -6 })], [2750, REST]],
      // hand on the heart with a small bow of the head
      heart: [[0, REST], [600, P({ ix: -36, iy: 58, iw: 12, head: -10, y: 5 })], [1700, P({ ix: -36, iy: 58, iw: 12, head: -12, y: 7 })], [2400, REST]],
      // "this way": the inner arm points toward the room
      point: [[0, REST], [600, P({ ix: 162, iy: -8, iw: -6, head: -12 })], [1700, P({ ix: 164, iy: -14, iw: -8, head: -14 })], [2400, REST]],
      nod: [[0, REST], [300, P({ head: -9, y: 2 })], [600, P({ head: 2 })], [900, P({ head: -8, y: 2 })], [1300, REST]],
    };
  }
  const BUBBLE = { wave: 0, open: 1, sign: "sign", heart: 2, point: "way", nod: null };

  function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function servo(t) { return Math.round(ease(t) * 6) / 6; }            // robot: stepped "servo" motion
  function sample(clip, ms, robot) {
    if (ms >= clip[clip.length - 1][0]) return clip[clip.length - 1][1];
    let i = 0; while (i < clip.length - 1 && clip[i + 1][0] <= ms) i++;
    const [t0, a] = clip[i], [t1, b] = clip[i + 1];
    const k = (robot ? servo : ease)((ms - t0) / Math.max(1, t1 - t0));
    const out = {};
    for (const key in a) out[key] = a[key] + (b[key] - a[key]) * k;
    return out;
  }

  function mount(host, options) {
    let opts = Object.assign({ figure: "woman", outfit: "official", style: "animated", skin: 2, side: "left", every: 6, sign: true,
                               lines: ["Welcome!", "Dalal ak jàmm", "I bisimila"] }, options || {});
    let rig, clips, order, idx = 0, clip = null, clipName = "", clipStart = 0, nextAt = 0, raf = 0, lineIdx = 0;
    const wrap = document.createElement("div");
    wrap.className = "dg-wrap";
    const bubble = document.createElement("div");
    bubble.className = "dg-bubble"; bubble.setAttribute("aria-live", "polite");
    const signTag = document.createElement("div");
    signTag.className = "dg-sign";
    signTag.innerHTML = '<span class="dg-sign-ico" aria-hidden="true">🤟</span><b>WELCOME</b><small>in sign language</small>';
    host.innerHTML = ""; host.appendChild(wrap); host.appendChild(bubble); host.appendChild(signTag);

    function setup() {
      rig = build(opts);
      wrap.innerHTML = ""; wrap.appendChild(rig.svg);
      host.classList.toggle("dg-robot", rig.robot);
      host.dataset.side = opts.side === "right" ? "right" : "left";
      clips = gestures();
      order = ["wave", "open", opts.sign ? "sign" : "nod", "heart", "point", opts.sign ? "sign" : "wave", "nod"];
      idx = 0; clip = null; nextAt = performance.now() + 900;
    }
    function apply(p, now) {
      const P_ = rig.parts;
      const breathe = REDUCED ? 0 : Math.sin(now / 900) * 1.6;
      const sway = REDUCED ? 0 : Math.sin(now / 2300) * 1.1;
      const outerIsRight = opts.side === "right";             // figure on the right → its outer arm is screen-right
      P_.root.setAttribute("transform", `rotate(${sway} 160 610) translate(0 ${(p.y || 0) + breathe * .5})`);
      P_.head.setAttribute("transform", `rotate(${(outerIsRight ? 1 : -1) * (p.head || 0)} 160 170)`);
      P_.torso.setAttribute("transform", `translate(0 ${breathe * .3})`);
      for (const [k, s] of [["R", 1], ["L", -1]]) {
        const a = P_[k];
        const isOuter = (k === "R") === outerIsRight;
        const [u, f] = solve(isOuter ? p.ox : p.ix, isOuter ? p.oy : p.iy);
        const w = isOuter ? p.ow : p.iw;
        a.sh.setAttribute("transform", `rotate(${-s * u} ${a.sx} ${a.sy})`);
        a.fore.setAttribute("transform", `rotate(${-s * (f - u)} ${a.ex} ${a.ey})`);
        a.hand.setAttribute("transform", `rotate(${-s * w} ${a.hx} ${a.hy})`);
      }
    }
    function say(name) {
      const b = BUBBLE[name];
      signTag.classList.toggle("on", name === "sign");
      if (b === null || b === undefined) { bubble.classList.remove("on"); return; }
      let text;
      if (b === "sign") text = "Welcome";
      else if (b === "way") text = opts.wayText || "Come in — this way";
      else { const lines = (opts.lines || []).filter(Boolean); text = lines.length ? lines[lineIdx++ % lines.length] : "Welcome!"; }
      bubble.textContent = text;
      bubble.classList.remove("on"); void bubble.offsetWidth; bubble.classList.add("on");
    }
    function blink(now) {
      const phase = now % 4200;
      const shut = phase < 120;
      for (const e of [rig.parts.eyeL, rig.parts.eyeR]) if (e) e.style.transform = shut ? "scaleY(.12)" : "";
    }
    function tick(now) {
      raf = requestAnimationFrame(tick);
      if (!clip && now >= nextAt) {
        clipName = order[idx++ % order.length]; clip = clips[clipName]; clipStart = now; say(clipName);
      }
      let pose = REST;
      if (clip) {
        const ms = now - clipStart;
        pose = sample(clip, ms, rig.robot);
        if (ms >= clip[clip.length - 1][0]) {
          clip = null; nextAt = now + Math.max(2, +opts.every || 6) * 1000;
          setTimeout(() => { if (!clip) { bubble.classList.remove("on"); signTag.classList.remove("on"); } }, 900);
        }
      }
      apply(pose, now); blink(now);
    }
    setup();
    raf = requestAnimationFrame(tick);
    return {
      update(next) {
        const before = JSON.stringify([opts.figure, opts.outfit, opts.style, opts.skin, opts.side, opts.sign]);
        opts = Object.assign(opts, next || {});
        if (JSON.stringify([opts.figure, opts.outfit, opts.style, opts.skin, opts.side, opts.sign]) !== before) setup();
      },
      play(name) { if (clips[name]) { clip = clips[name]; clipName = name; clipStart = performance.now(); say(name); } },
      destroy() { cancelAnimationFrame(raf); host.innerHTML = ""; },
      get options() { return Object.assign({}, opts); },
    };
  }

  // styles live with the rig so the greeter works on any page
  const css = document.createElement("style");
  css.textContent = `
  .dg-host{position:relative;width:100%;height:100%}
  .dg-wrap{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center}
  .dg-svg{height:100%;width:auto;max-width:100%;overflow:visible;filter:drop-shadow(0 18px 30px rgba(0,0,0,.35))}
  .dg-eye{transform-box:fill-box;transform-origin:center;transition:transform .06s}
  .dg-robot .dg-eye{animation:dgLed 2.4s ease-in-out infinite}
  .dg-antenna{animation:dgBlink 1.6s steps(2,start) infinite}
  .dg-led{animation:dgLed 1.2s ease-in-out infinite}.dg-led.l1{animation-delay:.3s}.dg-led.l2{animation-delay:.6s}
  @keyframes dgBlink{to{opacity:.25}}
  @keyframes dgLed{50%{opacity:.45}}
  .dg-bubble{position:absolute;top:2%;left:58%;max-width:min(26vw,360px);padding:.7em 1.05em;border-radius:22px 22px 22px 6px;
    background:#fff;color:#0b1626;font:800 clamp(18px,2.4vw,40px)/1.15 "Segoe UI",system-ui,sans-serif;box-shadow:0 18px 40px rgba(0,0,0,.35);
    opacity:0;transform:translateY(10px) scale(.9);transform-origin:bottom left;transition:opacity .35s,transform .35s cubic-bezier(.2,1.4,.4,1);pointer-events:none;white-space:normal}
  .dg-host[data-side=right] .dg-bubble{left:auto;right:58%;border-radius:22px 22px 6px 22px;transform-origin:bottom right}
  .dg-bubble.on{opacity:1;transform:none}
  .dg-robot .dg-bubble{background:#0b1626;color:#7dd3fc;border:2px solid #22d3ee;font-family:ui-monospace,"Cascadia Mono",monospace;letter-spacing:.02em}
  .dg-sign{position:absolute;bottom:2%;left:50%;transform:translate(-50%,12px);display:flex;align-items:center;gap:.5em;padding:.45em .9em;border-radius:999px;
    background:rgba(11,22,38,.82);color:#fff;font:700 clamp(12px,1.2vw,20px)/1 system-ui,sans-serif;opacity:0;transition:opacity .3s,transform .3s;white-space:nowrap}
  .dg-sign b{letter-spacing:.12em}.dg-sign small{font-weight:500;opacity:.75}.dg-sign.on{opacity:1;transform:translate(-50%,0)}
  @media (prefers-reduced-motion: reduce){.dg-bubble{transition:none}}
  `;
  document.head.appendChild(css);

  window.DoorGreeter = { mount, build, gestures, _sample: sample, _solve: solve };
})();
