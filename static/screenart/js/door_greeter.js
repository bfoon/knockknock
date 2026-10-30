/* ═══════════════════════════════════════════════════════════════════
   DOOR SCREEN · GREETER
   ───────────────────────────────────────────────────────────────────
   A full-body welcome host for the screens outside a room, drawn as one
   SVG rig so it stays crisp on any TV and needs no images.

     figure  man | woman
     outfit  official    — office wear: dark suit, white shirt, tie /
                            tailored blazer, cream blouse, pencil skirt
             traditional — grand mbubb, embroidered neckline, kufi cap /
                            tall tiko head-wrap
             casual      — tie-dye kaftan shirt & trousers /
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
  // skin: [base, shadow, highlight, lips]
  const SKIN = { 1: ["#a06a47", "#7a4c31", "#c08d69", "#7d4136"], 2: ["#6e442b", "#50301d", "#8c5b3e", "#5c2d23"], 3: ["#462b1b", "#301d12", "#5e3e2a", "#3e2018"] };
  const HAIR = "#15100d";
  const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Office wear (the "official" choice), Gambian traditional dress, and casual Gambian wear.
  const LOOKS = {
    man_official:      { cloth: ["#1d2840", "#2f3f62", "#121a2c"], shirt: "#f3f5f8", tie: "#7d1f2c", tie2: "#a83242", shoes: "#141414" },
    woman_official:    { cloth: ["#33384a", "#4a5168", "#232633"], blouse: "#f2e9d8", shoes: "#141414", accent: "#d8b46a" },
    man_traditional:   { cloth: ["#1f3a8a", "#3152ad", "#152a66"], trim: "#e2b44f", cap: "#f1e6c8", trousers: "#1f3a8a", shoes: "#6b4423" },
    woman_traditional: { cloth: ["#762063", "#94307f", "#561548"], trim: "#e2b44f", wrap: "#762063", wrap2: "#e2b44f", shoes: "#b9862f" },
    man_casual:        { shirt: "#0f8a8a", shirt2: "#f2c14e", dye: "#e2552d", trousers: ["#e3d7bd", "#f1e8d4", "#c8b996"], shoes: "#6e4423" },
    woman_casual:      { top: "#e2552d", top2: "#f6c344", top3: "#1d7a4a", skirt: "#1f4fa3", skirt2: "#f6c344", wrap: "#f6c344", wrap2: "#e2552d", shoes: "#6e4423" },
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
    const fig = o.figure === "man" ? "man" : "woman";
    const outfit = ["official", "traditional", "casual"].includes(o.outfit) ? o.outfit : "official";
    const key = fig + "_" + outfit;
    const L = LOOKS[key];
    const [skin, skinD, skinH, lip] = SKIN[o.skin] || SKIN[2];
    const metal = "#c9d3df", metalD = "#8e9bab";
    const svg = el("svg", { viewBox: "0 0 320 640", class: "dg-svg", role: "img", "aria-label": "Welcome host" });
    const uid = "dg" + Math.random().toString(36).slice(2, 8);
    const defs = el("defs", {}, svg);
    const id = n => uid + n, url = n => `url(#${uid + n})`;
    function lin(name, stops, a) {
      const g = el("linearGradient", Object.assign({ id: id(name) }, a || {}), defs);
      stops.forEach(([off, c, op]) => el("stop", { offset: off, "stop-color": c, "stop-opacity": op == null ? 1 : op }, g));
    }
    // a cloth / limb "cylinder": darker at both edges, lit a little left of centre
    const cyl = (name, [base, light, dark]) => lin(name, [[0, dark], [.32, base], [.46, light], [.62, base], [1, dark]], { x1: 0, x2: 1, y1: 0, y2: 0 });
    // skin
    const face = el("radialGradient", { id: id("face"), cx: ".42", cy: ".36", r: ".72" }, defs);
    [[0, skinH], [.55, skin], [1, skinD]].forEach(([off, c]) => el("stop", { offset: off, "stop-color": c }, face));
    cyl("limb", [skin, skinH, skinD]);
    lin("lipsU", [[0, lip], [1, skinD]], { x1: 0, x2: 0, y1: 0, y2: 1 });
    lin("lipsL", [[0, skinD], [.5, lip], [1, lip]], { x1: 0, x2: 0, y1: 0, y2: 1 });
    // metal (robot)
    cyl("steel", [metal, "#eef2f7", metalD]);
    // outfit fabrics
    if (L.cloth) cyl("cloth", L.cloth);
    if (L.shirt && outfit === "official") cyl("shirt", [L.shirt, "#ffffff", "#cfd5de"]);
    if (L.blouse) cyl("blouse", [L.blouse, "#fff8ea", "#d8ccb4"]);
    if (L.trousers && Array.isArray(L.trousers)) cyl("trousers", L.trousers);
    lin("shade", [[0, "#000", .28], [.25, "#000", 0], [.75, "#000", 0], [1, "#000", .28]], { x1: 0, x2: 1 });
    if (key === "man_official") {                                       // a striped silk tie
      const p = el("pattern", { id: id("tie"), width: 10, height: 10, patternUnits: "userSpaceOnUse", patternTransform: "rotate(35)" }, defs);
      el("rect", { width: 10, height: 10, fill: L.tie }, p);
      el("rect", { width: 10, height: 2.2, y: 4, fill: L.tie2 }, p);
    }
    if (key === "man_casual") {
      const dye = el("radialGradient", { id: id("dye"), cx: "50%", cy: "40%", r: "65%" }, defs);
      [[0, L.dye], [.22, L.shirt2], [.45, L.shirt], [.7, L.shirt2], [1, L.shirt]].forEach(([off, c]) => el("stop", { offset: off, "stop-color": c }, dye));
    }
    if (key === "woman_casual") {
      const wax = el("pattern", { id: id("wax"), width: 30, height: 30, patternUnits: "userSpaceOnUse" }, defs);
      el("rect", { width: 30, height: 30, fill: L.top }, wax);
      el("circle", { cx: 15, cy: 15, r: 9, fill: L.top2 }, wax);
      el("circle", { cx: 15, cy: 15, r: 4.5, fill: L.top3 }, wax);
      el("path", { d: "M0 0L7 0L0 7ZM30 30L23 30L30 23Z", fill: L.top3 }, wax);
      const sk = el("pattern", { id: id("skirt"), width: 36, height: 36, patternUnits: "userSpaceOnUse", patternTransform: "rotate(20)" }, defs);
      el("rect", { width: 36, height: 36, fill: L.skirt }, sk);
      el("rect", { width: 36, height: 8, y: 14, fill: L.skirt2 }, sk);
      el("circle", { cx: 9, cy: 5, r: 2.6, fill: "#fff", opacity: .7 }, sk);
    }
    const limbFill = robot ? url("steel") : url("limb");

    el("ellipse", { cx: 160, cy: 610, rx: 86, ry: 10, fill: "#000", opacity: .3, class: "dg-shadow" }, svg);
    const root = el("g", { class: "dg-root" }, svg);
    const parts = { root };

    /* legs & shoes */
    const legs = el("g", {}, root);
    function shoe(x, s, color, heel) {          // s = +1 right foot (screen right), -1 left
      if (heel) {
        el("path", { d: `M${x - 9 * s} 584 Q${x - 12 * s} 598 ${x - 10 * s} 602 L${x + 8 * s} 602 L${x + 7 * s} 592 Q${x + 4 * s} 584 ${x - 9 * s} 584Z`, fill: color }, legs);
        el("rect", { x: s > 0 ? x + 4 : x - 7, y: 594, width: 3, height: 10, fill: color }, legs);
      } else {
        el("path", { d: `M${x - 13 * s} 588 Q${x - 15 * s} 600 ${x - 12 * s} 604 L${x + 13 * s} 604 Q${x + 15 * s} 596 ${x + 10 * s} 588Z`, fill: color }, legs);
        el("path", { d: `M${x - 10 * s} 593 Q${x} 590 ${x + 9 * s} 593`, stroke: "#fff", "stroke-opacity": .18, "stroke-width": 2, fill: "none" }, legs);
      }
    }
    if (key === "woman_official") {
      for (const s of [-1, 1]) {
        const x = 160 + s * 15;
        el("path", { d: `M${x - 11} 494 Q${x - 14} 526 ${x - 7} 556 L${x - 4.5} 586 L${x + 4.5} 586 L${x + 7} 556 Q${x + 13} 524 ${x + 10} 494Z`, fill: limbFill }, legs);
        shoe(x, s, L.shoes, true);
      }
    } else if (key === "man_official" || key === "man_casual" || key === "man_traditional") {
      const tfill = key === "man_official" ? url("cloth") : key === "man_casual" ? url("trousers") : L.trousers;
      for (const s of [-1, 1]) {
        const x = 160 + s * 16;
        el("path", { d: `M${x - 15} 380 L${x + 14} 380 L${x + 11} 590 L${x - 11} 590Z`, fill: tfill }, legs);
        el("path", { d: `M${x} 400 L${x} 586`, stroke: "#000", "stroke-opacity": .18, "stroke-width": 1.2 }, legs);   // crease
        shoe(x, s, L.shoes, false);
      }
    } else {
      for (const s of [-1, 1]) { const x = 160 + s * 15; el("rect", { x: x - 8, y: 540, width: 16, height: 48, rx: 7, fill: limbFill }, legs); shoe(x, s, L.shoes, false); }
    }

    /* body */
    const torso = el("g", { class: "dg-torso" }, root);
    parts.torso = torso;
    const fold = (d, op) => el("path", { d, stroke: "#000", "stroke-opacity": op || .16, "stroke-width": 1.4, fill: "none", "stroke-linecap": "round" }, torso);
    if (key === "man_official") {
      // suit jacket, white shirt, striped tie, pocket square
      el("path", { d: "M106 198 Q108 188 128 184 L147 181 L160 200 L173 181 L192 184 Q212 188 214 198 L210 300 Q206 330 204 352 L208 404 Q160 414 112 404 L116 352 Q114 330 110 300Z", fill: url("cloth") }, torso);
      el("path", { d: "M147 182 L173 182 L160 320Z", fill: url("shirt") }, torso);
      el("path", { d: "M155 197 L165 197 L163.5 208 L156.5 208Z", fill: L.tie }, torso);
      el("path", { d: "M156.5 208 L163.5 208 L168 290 L160 302 L152 290Z", fill: url("tie") }, torso);
      el("path", { d: "M147 182 L160 199 L150 207Z", fill: "#ffffff" }, torso);
      el("path", { d: "M173 182 L160 199 L170 207Z", fill: "#e9edf2" }, torso);
      el("path", { d: "M146 181 L127 188 L131 214 L141 222 L136 230 L160 322Z", fill: L.cloth[2] }, torso);     // lapels
      el("path", { d: "M174 181 L193 188 L189 214 L179 222 L184 230 L160 322Z", fill: L.cloth[2] }, torso);
      el("path", { d: "M136 230 L160 322 M184 230 L160 322", stroke: L.cloth[1], "stroke-width": 1, opacity: .7 }, torso);
      el("path", { d: "M160 322 Q158 365 160 410", stroke: "#000", "stroke-opacity": .3, "stroke-width": 1.2, fill: "none" }, torso);
      [334, 364].forEach(y => el("circle", { cx: 163, cy: y, r: 2.6, fill: "#0b0f18" }, torso));
      el("path", { d: "M117 372 L141 372 M179 372 L203 372", stroke: "#000", "stroke-opacity": .35, "stroke-width": 1.4 }, torso);
      el("path", { d: "M178 238 L198 238", stroke: "#000", "stroke-opacity": .35, "stroke-width": 1.3 }, torso);
      el("path", { d: "M182 238 L186 231 L190 236 L194 230 L196 238Z", fill: "#e9edf2" }, torso);
      fold("M120 300 Q126 330 122 352", .12); fold("M200 300 Q194 330 198 352", .12);
    } else if (key === "woman_official") {
      // tailored blazer over a cream blouse, pencil skirt, a fine necklace
      el("path", { d: "M116 368 L204 368 Q206 430 196 498 Q160 504 124 498 Q114 430 116 368Z", fill: url("cloth") }, torso);
      el("path", { d: "M160 452 L160 500", stroke: "#000", "stroke-opacity": .3, "stroke-width": 1.2 }, torso);
      el("path", { d: "M108 200 Q110 191 128 187 L148 184 L160 210 L172 184 L192 187 Q210 191 212 200 L206 290 Q198 318 200 336 L206 382 Q160 392 114 382 L120 336 Q122 318 114 290Z", fill: url("cloth") }, torso);
      el("path", { d: "M148 185 L172 185 L160 300Z", fill: url("blouse") }, torso);
      el("path", { d: "M150 186 Q160 204 170 186", fill: "none", stroke: L.accent, "stroke-width": 1.2 }, torso);
      el("circle", { cx: 160, cy: 198, r: 2.2, fill: L.accent }, torso);
      el("path", { d: "M147 184 L130 190 L134 214 L143 220 L139 228 L160 302Z", fill: L.cloth[2] }, torso);
      el("path", { d: "M173 184 L190 190 L186 214 L177 220 L181 228 L160 302Z", fill: L.cloth[2] }, torso);
      el("circle", { cx: 160, cy: 312, r: 3, fill: "#11131a" }, torso);
      el("path", { d: "M160 312 Q157 350 160 386", stroke: "#000", "stroke-opacity": .28, "stroke-width": 1.2, fill: "none" }, torso);
      fold("M122 290 Q130 318 126 336", .12); fold("M198 290 Q190 318 194 336", .12);
    } else if (key === "man_traditional") {
      el("path", { d: "M104 186 Q160 166 216 186 L262 548 Q160 572 58 548Z", fill: url("cloth") }, torso);
      el("path", { d: "M136 180 Q160 238 184 180", fill: "none", stroke: L.trim, "stroke-width": 6, "stroke-linecap": "round" }, torso);
      el("path", { d: "M160 206 L160 330", stroke: L.trim, "stroke-width": 3.5, "stroke-dasharray": "2 7", "stroke-linecap": "round" }, torso);
      for (let i = 0; i < 6; i++) el("circle", { cx: 140 + i * 8, cy: 252 + Math.abs(2.5 - i) * 9, r: 2.6, fill: L.trim }, torso);
      el("path", { d: "M58 548 Q160 572 262 548", fill: "none", stroke: L.trim, "stroke-width": 4.5 }, torso);
      fold("M120 260 Q100 400 92 540"); fold("M200 260 Q220 400 228 540"); fold("M150 360 Q146 450 140 556", .1); fold("M172 360 Q176 450 182 556", .1);
    } else if (key === "woman_traditional") {
      el("path", { d: "M110 188 Q160 168 210 188 L252 600 Q160 618 68 600Z", fill: url("cloth") }, torso);
      el("path", { d: "M134 182 Q160 232 186 182", fill: "none", stroke: L.trim, "stroke-width": 6, "stroke-linecap": "round" }, torso);
      el("path", { d: "M120 300 Q160 320 200 300", fill: "none", stroke: L.trim, "stroke-width": 3.5, "stroke-dasharray": "3 6" }, torso);
      el("path", { d: "M68 600 Q160 618 252 600", fill: "none", stroke: L.trim, "stroke-width": 5 }, torso);
      for (let i = 0; i < 5; i++) el("path", { d: `M${92 + i * 34} 560 l7 -12 l7 12z`, fill: L.trim, opacity: .9 }, torso);
      fold("M124 320 Q108 450 98 596"); fold("M196 320 Q212 450 222 596"); fold("M160 330 L160 606", .08);
    } else if (key === "man_casual") {
      el("path", { d: "M108 188 Q160 170 212 188 L226 450 Q160 464 94 450Z", fill: url("dye") }, torso);
      el("path", { d: "M147 184 L160 214 L173 184", fill: "none", stroke: "#fff", "stroke-width": 3, opacity: .8 }, torso);
      fold("M128 260 Q122 360 118 448"); fold("M192 260 Q198 360 202 448");
    } else {
      el("path", { d: "M112 188 Q160 170 208 188 L222 392 Q160 404 98 392Z", fill: url("wax") }, torso);
      el("path", { d: "M92 382 Q160 400 228 382 L240 600 Q160 616 80 600Z", fill: url("skirt") }, torso);
      el("path", { d: "M92 382 Q160 400 228 382", fill: "none", stroke: L.top3, "stroke-width": 5 }, torso);
    }
    if (robot) {
      el("rect", { x: 140, y: 252, width: 40, height: 26, rx: 6, fill: "#0b1626", opacity: .85 }, torso);
      [0, 1, 2].forEach(i => el("circle", { cx: 150 + i * 10, cy: 265, r: 3, fill: ["#22d3ee", "#a3e635", "#f59e0b"][i], class: "dg-led l" + i }, torso));
    }

    /* head */
    const headPivot = el("g", { class: "dg-head" }, root);
    parts.head = headPivot;
    el("path", { d: "M150 140 L170 140 L172 188 Q160 196 148 188Z", fill: limbFill }, headPivot);                 // neck
    if (!robot) el("ellipse", { cx: 160, cy: 156, rx: 13, ry: 5, fill: skinD, opacity: .55 }, headPivot);
    const head = el("g", { transform: "translate(0 10)" }, headPivot);           // the head sits 10 lower: a natural neck length
    if (robot) {
      el("rect", { x: 126, y: 70, width: 68, height: 74, rx: 24, fill: url("steel") }, head);
      el("rect", { x: 134, y: 88, width: 52, height: 32, rx: 14, fill: "#0b1626" }, head);
      parts.eyeL = el("rect", { x: 144, y: 99, width: 10, height: 10, rx: 5, fill: "#22d3ee", class: "dg-eye" }, head);
      parts.eyeR = el("rect", { x: 166, y: 99, width: 10, height: 10, rx: 5, fill: "#22d3ee", class: "dg-eye" }, head);
      parts.mouth = el("path", { d: "M150 131 Q160 137 170 131", stroke: "#22d3ee", "stroke-width": 3, fill: "none", "stroke-linecap": "round" }, head);
      el("line", { x1: 160, y1: 70, x2: 160, y2: 50, stroke: metalD, "stroke-width": 3 }, head);
      parts.antenna = el("circle", { cx: 160, cy: 46, r: 5.5, fill: "#f43f5e", class: "dg-antenna" }, head);
      el("circle", { cx: 126, cy: 106, r: 7, fill: metalD }, head); el("circle", { cx: 194, cy: 106, r: 7, fill: metalD }, head);
    } else {
      // hair behind the head (woman, office: natural hair in a neat bun)
      if (key === "woman_official") {
        el("ellipse", { cx: 160, cy: 68, rx: 17, ry: 12, fill: HAIR }, head);
        el("path", { d: "M127 116 C122 80 138 62 160 62 C182 62 198 80 193 116 C190 100 182 88 160 88 C138 88 130 100 127 116Z", fill: HAIR }, head);
      }
      el("ellipse", { cx: 131, cy: 110, rx: 5, ry: 8.5, fill: skinD }, head);                                      // ears
      el("ellipse", { cx: 189, cy: 110, rx: 5, ry: 8.5, fill: skinD }, head);
      el("path", { d: "M160 72 C182 72 192 90 191 110 C190 130 180 146 160 150 C140 146 130 130 129 110 C128 90 138 72 160 72Z", fill: url("face") }, head);
      el("path", { d: "M131 116 C134 136 146 148 160 150 C174 148 186 136 189 116 C184 138 172 145 160 146 C148 145 136 138 131 116Z", fill: skinD, opacity: .35 }, head);   // jaw shadow
      el("ellipse", { cx: 144, cy: 119, rx: 6, ry: 3, fill: skinH, opacity: .16 }, head);                       // cheek light
      el("ellipse", { cx: 176, cy: 119, rx: 6, ry: 3, fill: skinH, opacity: .1 }, head);
      // brows
      const bw = fig === "man" ? 3.2 : 2.2;
      el("path", { d: fig === "man" ? "M139 98 Q146 94 154 97" : "M140 98 Q147 92.5 154 96", stroke: HAIR, "stroke-width": bw, fill: "none", "stroke-linecap": "round" }, head);
      el("path", { d: fig === "man" ? "M166 97 Q174 94 181 98" : "M166 96 Q173 92.5 180 98", stroke: HAIR, "stroke-width": bw, fill: "none", "stroke-linecap": "round" }, head);
      // eyes (an outer group places it, an inner group blinks)
      function eye(x) {
        const at = el("g", { transform: `translate(${x} 107)` }, head);
        const e = el("g", { class: "dg-eye" }, at);
        el("path", { d: "M-7 0 Q0 -5 7 0 Q0 4 -7 0Z", fill: "#f3ece2" }, e);
        el("circle", { cx: 0, cy: -.2, r: 3.4, fill: "#2b170c" }, e);
        el("circle", { cx: 0, cy: -.2, r: 1.6, fill: "#050302" }, e);
        el("circle", { cx: 1, cy: -1.3, r: .9, fill: "#fff" }, e);
        el("path", { d: "M-7.6 .2 Q0 -6.2 7.6 .2", stroke: fig === "woman" ? HAIR : skinD, "stroke-width": fig === "woman" ? 2 : 1.6, fill: "none", "stroke-linecap": "round" }, e);
        if (fig === "woman") el("path", { d: `M${x < 160 ? -7.6 : 7.6} .2 l${x < 160 ? -2 : 2} -1.6`, stroke: HAIR, "stroke-width": 1.4 }, e);
        el("path", { d: "M-6 2.6 Q0 4.6 6 2.6", stroke: skinD, "stroke-width": .9, fill: "none", opacity: .6 }, e);
        return e;
      }
      parts.eyeL = eye(147); parts.eyeR = eye(173);
      // nose
      el("path", { d: "M157 106 Q156 116 153 123", stroke: skinD, "stroke-width": 1.4, fill: "none", opacity: .55 }, head);
      el("path", { d: "M151 123 Q153 129 160 129.5 Q167 129 169 123 Q166 126.5 160 126.5 Q154 126.5 151 123Z", fill: skinD, opacity: .7 }, head);
      el("ellipse", { cx: 155.5, cy: 126.3, rx: 2, ry: 1.2, fill: "#1f120b", opacity: .7 }, head);
      el("ellipse", { cx: 164.5, cy: 126.3, rx: 2, ry: 1.2, fill: "#1f120b", opacity: .7 }, head);
      el("path", { d: "M160 110 L160 121", stroke: skinH, "stroke-width": 2, opacity: .3, "stroke-linecap": "round" }, head);
      // lips, a calm friendly smile
      const m = el("g", {}, head); parts.mouth = m;
      el("path", { d: "M149 136 Q154 132.5 160 134.5 Q166 132.5 171 136 Q160 138.5 149 136Z", fill: url("lipsU") }, m);
      el("path", { d: "M150 136.4 Q160 144.5 170 136.4 Q160 139 150 136.4Z", fill: url("lipsL") }, m);
      el("path", { d: "M149 136 Q160 139.2 171 136", stroke: "#2a120c", "stroke-width": 1, fill: "none", "stroke-linecap": "round" }, m);
      el("ellipse", { cx: 160, cy: 140.5, rx: 4, ry: 1.2, fill: "#fff", opacity: .12 }, m);
      // hair / headwear in front
      if (fig === "man") {
        el("path", { d: "M130 104 C129 80 141 68 160 67 C179 68 191 80 190 104 C187 92 180 85 160 84 C140 85 133 92 130 104Z", fill: HAIR }, head);
        el("path", { d: "M131 112 C132 132 144 147 160 150 C176 147 188 132 189 112", stroke: HAIR, "stroke-width": 3, fill: "none", opacity: .18 }, head);   // light stubble line
      } else if (key === "woman_official") {
        el("path", { d: "M129 104 C130 82 142 72 160 72 C178 72 190 82 191 104 C186 90 174 84 160 84 C146 84 134 90 129 104Z", fill: HAIR }, head);
        el("circle", { cx: 130.5, cy: 120, r: 2.4, fill: L.accent }, head); el("circle", { cx: 189.5, cy: 120, r: 2.4, fill: L.accent }, head);
      } else {
        el("circle", { cx: 130.5, cy: 121, r: 3, fill: "#e2b44f" }, head); el("circle", { cx: 189.5, cy: 121, r: 3, fill: "#e2b44f" }, head);
      }
    }
    if (key === "man_traditional") {
      el("path", { d: robot ? "M128 76 Q160 60 192 76 L190 58 Q160 44 130 58Z" : "M129 90 Q160 78 191 90 L188 64 Q160 52 132 64Z", fill: L.cap }, head);
      el("path", { d: robot ? "M129 72 Q160 61 191 72" : "M130 86 Q160 76 190 86", fill: "none", stroke: L.trim, "stroke-width": 3.5 }, head);
    } else if (key === "woman_traditional") {
      el("path", { d: "M124 102 Q120 52 160 44 Q202 50 196 102 Q160 86 124 102Z", fill: L.wrap }, head);
      el("path", { d: "M130 66 Q160 34 192 64 Q182 20 160 14 Q136 20 130 66Z", fill: L.wrap }, head);
      el("path", { d: "M150 30 Q140 6 164 10 Q186 4 174 34Z", fill: L.wrap2 }, head);
      el("path", { d: "M126 94 Q160 80 194 94", fill: "none", stroke: L.wrap2, "stroke-width": 4 }, head);
      fold("M140 60 Q150 48 172 56", .2);
    } else if (key === "woman_casual") {
      el("path", { d: "M126 102 Q122 56 160 50 Q200 56 194 102 Q160 88 126 102Z", fill: L.wrap }, head);
      el("path", { d: "M180 56 Q210 42 204 72 Q196 62 184 66Z", fill: L.wrap2 }, head);
      el("path", { d: "M128 92 Q160 79 192 92", fill: "none", stroke: L.wrap2, "stroke-width": 3.5, "stroke-dasharray": "6 5" }, head);
    }

    /* arms: shoulder → elbow → wrist, each rotating about its own joint (see motion) */
    function arm(side) {
      const s = side === "R" ? 1 : -1;
      const sx = 160 + s * 50, sy = 196, ex = sx, ey = sy + 86, hx = ex, hy = ey + 82;
      const sh = el("g", { class: "dg-arm" + side }, root);
      const sleeve = L.cloth ? url("cloth") : key === "man_casual" ? url("dye") : url("wax");
      const wide = outfit === "traditional";
      // upper arm
      if (wide) el("path", { d: `M${sx - 18} ${sy - 6} L${sx + 18} ${sy - 6} L${ex + 24} ${ey + 4} L${ex - 24} ${ey + 4}Z`, fill: sleeve }, sh);
      else el("path", { d: `M${sx - 16} ${sy - 4} Q${sx} ${sy - 15} ${sx + 16} ${sy - 4} L${ex + 12} ${ey + 4} L${ex - 12} ${ey + 4}Z`, fill: sleeve }, sh);
      if (robot) el("circle", { cx: sx, cy: sy, r: 9, fill: metalD }, sh);
      const fore = el("g", {}, sh);
      if (robot) el("circle", { cx: ex, cy: ey, r: 8, fill: metalD }, fore);
      // forearm: skin, then the sleeve over it
      el("path", { d: `M${ex - 9} ${ey} L${ex + 9} ${ey} L${hx + 7} ${hy} L${hx - 7} ${hy}Z`, fill: limbFill }, fore);
      if (outfit === "official") {
        el("ellipse", { cx: ex, cy: ey + 2, rx: 12, ry: 7, fill: sleeve }, fore);
        el("path", { d: `M${ex - 12} ${ey} L${ex + 12} ${ey} L${hx + 10} ${hy - 9} L${hx - 10} ${hy - 9}Z`, fill: sleeve }, fore);
        el("rect", { x: hx - 9, y: hy - 10, width: 18, height: 6, rx: 2, fill: fig === "man" ? "#f3f5f8" : L.blouse }, fore);   // shirt cuff
      } else if (wide) {
        el("path", { d: `M${ex - 24} ${ey + 2} L${ex + 24} ${ey + 2} L${hx + 17} ${hy - 12} L${hx - 17} ${hy - 12}Z`, fill: sleeve }, fore);
        el("path", { d: `M${hx - 17} ${hy - 12} L${hx + 17} ${hy - 12}`, stroke: L.trim, "stroke-width": 3 }, fore);
      } else if (key === "man_casual") {
        el("path", { d: `M${ex - 13} ${ey} L${ex + 13} ${ey} L${ex + 11} ${ey + 34} L${ex - 11} ${ey + 34}Z`, fill: sleeve }, fore);
      }
      // hand: palm, four fingers, a thumb on the inner side
      const hand = el("g", {}, fore);
      if (robot) {
        el("rect", { x: hx - 10, y: hy - 3, width: 20, height: 20, rx: 7, fill: metal }, hand);
        [-7, -1, 5].forEach(dx => el("rect", { x: hx + dx - 2, y: hy + 15, width: 5, height: 11, rx: 2.5, fill: metalD }, hand));
      } else {
        el("path", { d: `M${hx - 9} ${hy - 2} Q${hx - 10.5} ${hy + 12} ${hx - 8} ${hy + 19} L${hx + 8} ${hy + 19} Q${hx + 10.5} ${hy + 12} ${hx + 9} ${hy - 2}Z`, fill: url("limb") }, hand);
        [[-6.6, 11], [-2.2, 13.5], [2.2, 13], [6.4, 10.5]].forEach(([dx, len]) =>
          el("rect", { x: hx + dx - 2.2, y: hy + 16, width: 4.4, height: len, rx: 2.2, fill: skin }, hand));
        el("path", { d: `M${hx - s * 8.5} ${hy + 3} Q${hx - s * 14} ${hy + 9} ${hx - s * 11} ${hy + 17}`, stroke: skin, "stroke-width": 4.6, fill: "none", "stroke-linecap": "round" }, hand);
        el("path", { d: `M${hx - 7} ${hy + 16.5} L${hx + 7} ${hy + 16.5}`, stroke: skinD, "stroke-width": .9, opacity: .55 }, hand);
      }
      return { sh, fore, hand, sx, sy, ex, ey, hx, hy };
    }
    parts.L = arm("L");
    parts.R = arm("R");
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
