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
     style   animated (a 3D-cartoon look: big glossy eyes, soft light,
             warm skin, curly hair) | robot (LED eyes, antenna,
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
  // 3D-cartoon skin: base, light, shadow, deep shadow, blush, lips
  const SKIN = {
    1: { base: "#c68b62", light: "#ecb48c", dark: "#94603f", deep: "#6e432a", blush: "#ef7f66", lip: "#a8574a", palm: "#efc3a0", nail: "#f1d2bd" },
    2: { base: "#99603d", light: "#c98a5f", dark: "#6b3f25", deep: "#4c2a17", blush: "#e06d55", lip: "#87412f", palm: "#d9a17b", nail: "#e3b9a0" },
    3: { base: "#6b3f25", light: "#93603d", dark: "#4a2a17", deep: "#33190c", blush: "#c45a43", lip: "#5e2b1f", palm: "#bb8460", nail: "#c99c80" },
  };
  const HAIR = { base: "#22170f", light: "#5a4030", dark: "#0d0805" };
  const REDUCED = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Office wear (the "official" choice), Gambian traditional dress, and casual Gambian wear.
  const LOOKS = {
    man_official:      { cloth: ["#26324f", "#3d4f78", "#151d31"], shirt: "#f5f7fa", tie: "#8e2233", tie2: "#bd3a4c", shoes: "#1a1412" },
    woman_official:    { cloth: ["#3a3550", "#585274", "#25213a"], blouse: "#f6ecd9", shoes: "#1a1412", accent: "#e8bf68" },
    man_traditional:   { cloth: ["#2340a0", "#3d63cf", "#172b70"], trim: "#f0c25a", cap: "#f4ead0", trousers: "#2340a0", shoes: "#7a4b26" },
    woman_traditional: { cloth: ["#8a2373", "#b0409a", "#621655"], trim: "#f0c25a", wrap: "#8a2373", wrap2: "#f0c25a", shoes: "#c8923a" },
    man_casual:        { shirt: "#11a0a0", shirt2: "#f6c752", dye: "#ee5d33", trousers: ["#e6dac2", "#f7eedb", "#c6b691"], shoes: "#7a4b26" },
    woman_casual:      { top: "#ee5d33", top2: "#f7c84c", top3: "#1f8a52", skirt: "#2459b8", skirt2: "#f7c84c", band: "#ff8a6b", band2: "#ffd2c2", shoes: "#8b5cf6" },
  };

  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  // stable pseudo-random numbers, so the curls are the same on every screen
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  /* ───────────── hands: a jointed rig ─────────────
     Every finger has three joints (knuckle, middle, tip) and the thumb its own three. A joint bending toward
     the viewer foreshortens its segment and, past 90°, folds it back over the palm — how a curling finger
     looks from the front. Spread fans the fingers in the plane of the hand. Poses blend joint by joint, and
     a little idle motion keeps the hands alive. Palms are lighter than the back of the hand; nails and
     knuckles show when the back faces the viewer. */
  const FINGERS = [                        // x from the hand's centre (negative = toward the thumb), segment lengths, width
    { x: -6.9, L: [8.4, 5.6, 4.6], w: 5.1 },   // index
    { x: -2.3, L: [9.2, 6.1, 4.8], w: 5.3 },   // middle
    { x: 2.3, L: [8.6, 5.7, 4.6], w: 5.0 },    // ring
    { x: 6.7, L: [6.8, 4.6, 3.9], w: 4.4 },    // little
  ];
  const FLEX = [74, 96, 64];               // how far each joint bends at full curl (degrees)
  const HANDS = {
    relax: { c: [.30, .34, .38, .43], s: [-3, 0, 3, 6], ta: 6, tc: .28, b: 1, fl: 0 },
    open:  { c: [.04, .02, .05, .09], s: [-13, -4, 6, 15], ta: 44, tc: .04, b: 0, fl: 0 },
    wave:  { c: [.05, .03, .06, .1], s: [-11, -3, 5, 13], ta: 40, tc: .05, b: 0, fl: 1 },
    flat:  { c: [.02, .02, .03, .05], s: [-2, 0, 1, 3], ta: 12, tc: .1, b: 0, fl: 0 },
    heart: { c: [.15, .15, .17, .21], s: [-3, 0, 2, 4], ta: 10, tc: .26, b: 1, fl: 0 },
    point: { c: [.02, .88, .92, .95], s: [-2, 3, 5, 7], ta: -36, tc: .55, b: 1, fl: 0 },
  };
  function H(pre, name) {                  // a hand pose as flat numbers, so it blends like any joint
    const h = HANDS[name], o = {};
    h.c.forEach((v, i) => { o[pre + "c" + i] = v; }); h.s.forEach((v, i) => { o[pre + "s" + i] = v; });
    o[pre + "ta"] = h.ta; o[pre + "tc"] = h.tc; o[pre + "b"] = h.b; o[pre + "fl"] = h.fl;
    return o;
  }

  function makeHand(g, hx, hy, s, C, robot) {
    // s = +1 for the arm on screen-right; the thumb is on the inner side (toward the body), i.e. at -s.
    const mk = (tag, a) => el(tag, a, g);
    const palmBack = mk("path", { fill: C.base });
    const knuckles = FINGERS.map(f => mk("ellipse", { cx: hx + s * f.x, cy: hy + 16.5, rx: 2.4, ry: 1.6, fill: C.light, opacity: .5 }));
    const palmFront = mk("path", { fill: C.palm });
    const creases = mk("path", { stroke: C.dark, "stroke-width": .8, fill: "none", opacity: .45 });
    const PB = `M${hx - 9} ${hy - 2} Q${hx - 11.5} ${hy + 8} ${hx - 10.5} ${hy + 18.5} Q${hx} ${hy + 21} ${hx + 10.5} ${hy + 18.5} Q${hx + 11.5} ${hy + 8} ${hx + 9} ${hy - 2}Z`;
    palmBack.setAttribute("d", PB); palmFront.setAttribute("d", PB);
    creases.setAttribute("d", `M${hx - s * 9} ${hy + 9} Q${hx} ${hy + 6} ${hx + s * 9} ${hy + 11} M${hx - s * 8} ${hy + 13.5} Q${hx + s * 1} ${hy + 11} ${hx + s * 9} ${hy + 15}`);
    const seg = () => ({ sh: mk("path", { stroke: robot ? "#6b7788" : C.dark, fill: "none", "stroke-linecap": "round" }),
                         base: mk("path", { stroke: robot ? "#cdd6e2" : C.base, fill: "none", "stroke-linecap": "round" }),
                         hi: mk("path", { stroke: robot ? "#f4f7fb" : C.light, fill: "none", "stroke-linecap": "round", opacity: .55 }) });
    const fingers = FINGERS.map(f => ({ f, segs: [seg(), seg(), seg()],
      nail: mk("path", { stroke: C.nail, fill: "none", "stroke-linecap": "round" }),
      joints: robot ? [mk("circle", { r: 1.6, fill: "#6b7788" }), mk("circle", { r: 1.5, fill: "#6b7788" })] : [] }));
    const thumb = { segs: [seg(), seg(), seg()], nail: mk("path", { stroke: C.nail, fill: "none", "stroke-linecap": "round" }) };
    const TL = [7.2, 6.4, 5.2], TW = [6.6, 6, 5.4];
    const line = (a, b) => `M${a[0].toFixed(2)} ${a[1].toFixed(2)} L${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
    function drawSeg(sg, a, b, w, front) {
      const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1, px = -dy / n, py = dx / n;   // a perpendicular
      const off = (k) => [[a[0] + px * k, a[1] + py * k], [b[0] + px * k, b[1] + py * k]];
      const [s1, s2] = off(.55 * s), [h1, h2] = off(-.32 * w * s);
      sg.sh.setAttribute("d", line(s1, s2)); sg.sh.setAttribute("stroke-width", w);
      sg.base.setAttribute("d", line(a, b)); sg.base.setAttribute("stroke-width", w - .9);
      sg.base.setAttribute("stroke", robot ? "#cdd6e2" : (front ? C.palm : C.base));
      sg.hi.setAttribute("d", line(h1, h2)); sg.hi.setAttribute("stroke-width", w * .3);
    }
    function chain(start, dirAngle, Ls, curls, w, front) {
      // dirAngle: in-plane direction in degrees (0 = down, + = toward the outer side); curls: per-joint flex 0..1
      const a = dirAngle * Math.PI / 180, d = [s * Math.sin(a), Math.cos(a)];
      const pts = [start]; let phi = 0;
      for (let k = 0; k < Ls.length; k++) {
        phi += curls[k];
        const len = Ls[k] * Math.cos(phi * Math.PI / 180);
        const last = pts[pts.length - 1];
        pts.push([last[0] + d[0] * len, last[1] + d[1] * len]);
      }
      return { pts, d, tipCos: Math.cos(phi * Math.PI / 180) };
    }
    return {
      set(p, now) {
        const back = p.b >= .5;
        palmFront.setAttribute("opacity", back ? 0 : 1); creases.setAttribute("opacity", back ? 0 : .45);
        knuckles.forEach(k => k.setAttribute("opacity", back ? .5 : 0));
        fingers.forEach((F, i) => {
          const live = REDUCED ? 0 : .035 * Math.sin(now / 650 + i * 1.7 + s);
          const ripple = (p.fl || 0) * .16 * (.5 + .5 * Math.sin(now / 105 - i * .95));
          const c = Math.max(0, Math.min(1, p.c[i] + live + ripple));
          const base = [hx + s * F.f.x, hy + 18];
          const { pts, d, tipCos } = chain(base, p.s[i] + c * 4, F.f.L, FLEX.map(v => v * c), F.f.w, !back);
          for (let k = 0; k < 3; k++) drawSeg(F.segs[k], pts[k], pts[k + 1], F.f.w * (1 - k * .09), !back);
          F.joints.forEach((j, k) => { j.setAttribute("cx", pts[k + 1][0]); j.setAttribute("cy", pts[k + 1][1]); });
          const showNail = back && tipCos > .35 && !robot;
          const tip = pts[3], L3 = F.f.L[2] * tipCos;
          F.nail.setAttribute("d", showNail ? line([tip[0] - d[0] * L3 * .62, tip[1] - d[1] * L3 * .62], [tip[0] - d[0] * .3, tip[1] - d[1] * .3]) : "");
          F.nail.setAttribute("stroke-width", F.f.w * .55);
        });
        // thumb: out to the side (ta > 0) or tucked across the palm (ta < 0)
        const tc = Math.max(0, Math.min(1, p.tc + (REDUCED ? 0 : .03 * Math.sin(now / 800 + s))));
        const t0 = [hx - s * 8.6, hy + 4];
        const { pts, d, tipCos } = chain(t0, -(24 + p.ta), TL, [18 * tc, 46 * tc, 58 * tc], 6, !back);
        for (let k = 0; k < 3; k++) drawSeg(thumb.segs[k], pts[k], pts[k + 1], TW[k], !back);
        const tip = pts[3], L3 = TL[2] * tipCos;
        thumb.nail.setAttribute("d", back && tipCos > .3 && !robot ? line([tip[0] - d[0] * L3 * .6, tip[1] - d[1] * L3 * .6], [tip[0] - d[0] * .3, tip[1] - d[1] * .3]) : "");
        thumb.nail.setAttribute("stroke-width", 3.2);
      },
    };
  }

  /* ───────────── drawing: a 3D-cartoon look made of lit SVG shapes ───────────── */
  function build(opts) {
    const o = Object.assign({ figure: "woman", outfit: "official", style: "animated", skin: 2 }, opts || {});
    const robot = o.style === "robot";
    const fig = o.figure === "man" ? "man" : "woman";
    const outfit = ["official", "traditional", "casual"].includes(o.outfit) ? o.outfit : "official";
    const key = fig + "_" + outfit;
    const L = LOOKS[key];
    const K = SKIN[o.skin] || SKIN[2];
    const metal = "#cdd6e2", metalD = "#8794a6";
    const svg = el("svg", { viewBox: "0 0 320 640", class: "dg-svg", role: "img", "aria-label": "Welcome host" });
    const uid = "dg" + Math.random().toString(36).slice(2, 8);
    const defs = el("defs", {}, svg);
    const id = n => uid + n, url = n => `url(#${uid + n})`;
    function lin(name, stops, a) {
      const g = el("linearGradient", Object.assign({ id: id(name) }, a || {}), defs);
      stops.forEach(([off, c, op]) => el("stop", { offset: off, "stop-color": c, "stop-opacity": op == null ? 1 : op }, g));
    }
    function rad(name, stops, a) {
      const g = el("radialGradient", Object.assign({ id: id(name) }, a || {}), defs);
      stops.forEach(([off, c, op]) => el("stop", { offset: off, "stop-color": c, "stop-opacity": op == null ? 1 : op }, g));
    }
    const cyl = (name, [base, light, dark]) => lin(name, [[0, dark], [.28, base], [.44, light], [.62, base], [1, dark]], { x1: 0, x2: 1, y1: 0, y2: 0 });
    [["b1", 1.2], ["b2", 2.2], ["b4", 4], ["b7", 7]].forEach(([n, sd]) => {
      const f = el("filter", { id: id(n), x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
      el("feGaussianBlur", { stdDeviation: sd }, f);
    });
    // skin, lit from the upper left, warm in the shadows
    rad("face", [[0, K.light], [.45, K.base], [.82, K.dark], [1, K.deep]], { cx: ".40", cy: ".34", r: ".78" });
    rad("ear", [[0, K.light], [.6, K.base], [1, K.dark]], { cx: ".35", cy: ".4", r: ".8" });
    cyl("limb", [K.base, K.light, K.dark]);
    lin("rim", [[0, "#fff", 0], [.84, "#fff", 0], [1, "#ffe7cf", .2]], { x1: 0, x2: 1 });
    lin("lip", [[0, K.lip], [1, K.deep]], { x1: 0, x2: 0, y1: 0, y2: 1 });
    lin("lipL", [[0, K.deep], [.45, K.lip], [1, K.lip]], { x1: 0, x2: 0, y1: 0, y2: 1 });
    lin("sclera", [[0, "#e3d6ca"], [.32, "#fdfaf6"], [1, "#f1e8df"]], { x1: 0, x2: 0, y1: 0, y2: 1 });
    rad("iris", [[0, "#d99a4e"], [.38, "#9a5520"], [.8, "#42210c"], [1, "#160a03"]], { cx: ".5", cy: ".58", r: ".6" });
    rad("curl", [[0, HAIR.light], [.55, HAIR.base], [1, HAIR.dark]], { cx: ".35", cy: ".3", r: ".75" });
    rad("hairCap", [[0, HAIR.light], [.5, HAIR.base], [1, HAIR.dark]], { cx: ".4", cy: ".25", r: ".85" });
    cyl("steel", [metal, "#f2f5f9", metalD]);
    if (L.cloth) cyl("cloth", L.cloth);
    if (outfit === "official" && fig === "man") cyl("shirt", [L.shirt, "#ffffff", "#c9d1dc"]);
    if (L.blouse) cyl("blouse", [L.blouse, "#fffaf0", "#dccfb6"]);
    if (L.trousers && Array.isArray(L.trousers)) cyl("trousers", L.trousers);
    lin("gloss", [[0, "#fff", .32], [.5, "#fff", 0]], { x1: 0, x2: 0, y1: 0, y2: 1 });
    if (key === "man_official") {
      const p = el("pattern", { id: id("tie"), width: 10, height: 10, patternUnits: "userSpaceOnUse", patternTransform: "rotate(35)" }, defs);
      el("rect", { width: 10, height: 10, fill: L.tie }, p); el("rect", { width: 10, height: 2.4, y: 4, fill: L.tie2 }, p);
    }
    if (key === "man_casual") rad("dye", [[0, L.dye], [.22, L.shirt2], [.45, L.shirt], [.7, L.shirt2], [1, L.shirt]], { cx: "50%", cy: "40%", r: "65%" });
    if (key === "woman_casual") {
      const wax = el("pattern", { id: id("wax"), width: 30, height: 30, patternUnits: "userSpaceOnUse" }, defs);
      el("rect", { width: 30, height: 30, fill: L.top }, wax); el("circle", { cx: 15, cy: 15, r: 9, fill: L.top2 }, wax);
      el("circle", { cx: 15, cy: 15, r: 4.5, fill: L.top3 }, wax); el("path", { d: "M0 0L7 0L0 7ZM30 30L23 30L30 23Z", fill: L.top3 }, wax);
      const sk = el("pattern", { id: id("skirt"), width: 36, height: 36, patternUnits: "userSpaceOnUse", patternTransform: "rotate(20)" }, defs);
      el("rect", { width: 36, height: 36, fill: L.skirt }, sk); el("rect", { width: 36, height: 8, y: 14, fill: L.skirt2 }, sk);
      el("circle", { cx: 9, cy: 5, r: 2.6, fill: "#fff", opacity: .7 }, sk);
      cyl("band", [L.band, L.band2, "#d0563c"]);
    }
    const limbFill = robot ? url("steel") : url("limb");
    const blurred = (tag, a, b, parent) => el(tag, Object.assign({ filter: `url(#${uid}${b})` }, a), parent);

    el("ellipse", { cx: 160, cy: 610, rx: 84, ry: 11, fill: "#000", opacity: .32, class: "dg-shadow", filter: url("b4") }, svg);
    const root = el("g", { class: "dg-root" }, svg);
    const parts = { root };

    /* legs & shoes — rounded, with a gloss on the shoes */
    const legs = el("g", {}, root);
    function shoe(x, s, color, heel) {
      if (heel) {
        el("path", { d: `M${x - 10 * s} 582 Q${x - 14 * s} 598 ${x - 11 * s} 603 L${x + 9 * s} 603 L${x + 8 * s} 592 Q${x + 5 * s} 582 ${x - 10 * s} 582Z`, fill: color }, legs);
        el("rect", { x: s > 0 ? x + 5 : x - 8, y: 594, width: 3.4, height: 10, rx: 1.5, fill: color }, legs);
      } else {
        el("path", { d: `M${x - 15 * s} 586 Q${x - 18 * s} 602 ${x - 13 * s} 606 L${x + 14 * s} 606 Q${x + 18 * s} 597 ${x + 11 * s} 586Z`, fill: color }, legs);
      }
      el("ellipse", { cx: x - 2 * s, cy: 592, rx: 7, ry: 2.4, fill: "#fff", opacity: .22 }, legs);
    }
    if (key === "woman_official") {
      for (const s of [-1, 1]) {
        const x = 160 + s * 15;
        el("path", { d: `M${x - 12} 492 Q${x - 15} 526 ${x - 7.5} 556 L${x - 5} 586 L${x + 5} 586 L${x + 7.5} 556 Q${x + 14} 524 ${x + 11} 492Z`, fill: limbFill }, legs);
        shoe(x, s, L.shoes, true);
      }
    } else if (fig === "man") {
      const tfill = key === "man_official" ? url("cloth") : key === "man_casual" ? url("trousers") : L.trousers;
      for (const s of [-1, 1]) {
        const x = 160 + s * 17;
        el("path", { d: `M${x - 17} 376 Q${x} 372 ${x + 16} 376 L${x + 13} 590 Q${x} 594 ${x - 13} 590Z`, fill: tfill }, legs);
        shoe(x, s, L.shoes, false);
      }
    } else {
      for (const s of [-1, 1]) { const x = 160 + s * 15; el("rect", { x: x - 9, y: 538, width: 18, height: 50, rx: 8, fill: limbFill }, legs); shoe(x, s, L.shoes, false); }
    }

    /* body — the same tailoring as before, with soft 3D light and contact shadows */
    const torso = el("g", { class: "dg-torso" }, root);
    parts.torso = torso;
    const fold = (d, op) => el("path", { d, stroke: "#000", "stroke-opacity": op || .14, "stroke-width": 2, fill: "none", "stroke-linecap": "round", filter: url("b1") }, torso);
    if (key === "man_official") {
      el("path", { d: "M106 200 Q108 186 130 182 L147 180 L160 200 L173 180 L190 182 Q212 186 214 200 L210 300 Q206 330 205 352 L209 402 Q160 414 111 402 L115 352 Q114 330 110 300Z", fill: url("cloth") }, torso);
      el("path", { d: "M147 181 L173 181 L160 318Z", fill: url("shirt") }, torso);
      el("path", { d: "M154 196 L166 196 L164 208 L156 208Z", fill: L.tie }, torso);
      el("path", { d: "M156 208 L164 208 L169 290 L160 302 L151 290Z", fill: url("tie") }, torso);
      el("path", { d: "M147 181 L160 199 L149 208Z", fill: "#ffffff" }, torso);
      el("path", { d: "M173 181 L160 199 L171 208Z", fill: "#e6ebf1" }, torso);
      el("path", { d: "M146 180 L126 188 L130 214 L141 222 L136 230 L160 320Z", fill: L.cloth[2] }, torso);
      el("path", { d: "M174 180 L194 188 L190 214 L179 222 L184 230 L160 320Z", fill: L.cloth[2] }, torso);
      el("path", { d: "M136 230 L160 320 M184 230 L160 320", stroke: L.cloth[1], "stroke-width": 1.2, opacity: .8 }, torso);
      [334, 364].forEach(y => { el("circle", { cx: 163, cy: y, r: 3.2, fill: "#0b0f18" }, torso); el("circle", { cx: 162, cy: y - 1, r: 1, fill: "#fff", opacity: .35 }, torso); });
      el("path", { d: "M178 238 L198 238", stroke: "#000", "stroke-opacity": .35, "stroke-width": 1.4 }, torso);
      el("path", { d: "M182 238 L186 230 L190 236 L194 229 L196 238Z", fill: "#eef2f6" }, torso);
      fold("M120 300 Q127 332 122 354"); fold("M200 300 Q193 332 198 354");
    } else if (key === "woman_official") {
      el("path", { d: "M116 366 L204 366 Q207 430 196 496 Q160 503 124 496 Q113 430 116 366Z", fill: url("cloth") }, torso);
      el("path", { d: "M108 202 Q110 189 130 185 L148 183 L160 210 L172 183 L190 185 Q210 189 212 202 L206 290 Q198 318 200 336 L206 380 Q160 391 114 380 L120 336 Q122 318 114 290Z", fill: url("cloth") }, torso);
      el("path", { d: "M148 184 L172 184 L160 298Z", fill: url("blouse") }, torso);
      el("path", { d: "M149 186 Q160 206 171 186", fill: "none", stroke: L.accent, "stroke-width": 1.3 }, torso);
      el("path", { d: "M160 200 l-3 5 l3 4 l3 -4z", fill: L.accent }, torso);
      el("path", { d: "M147 183 L129 190 L133 214 L143 220 L139 228 L160 300Z", fill: L.cloth[2] }, torso);
      el("path", { d: "M173 183 L191 190 L187 214 L177 220 L181 228 L160 300Z", fill: L.cloth[2] }, torso);
      el("circle", { cx: 160, cy: 310, r: 3.4, fill: "#11131a" }, torso);
      fold("M122 290 Q131 318 126 338"); fold("M198 290 Q189 318 194 338");
    } else if (key === "man_traditional") {
      el("path", { d: "M104 188 Q160 168 216 188 L262 548 Q160 572 58 548Z", fill: url("cloth") }, torso);
      el("path", { d: "M136 182 Q160 238 184 182", fill: "none", stroke: L.trim, "stroke-width": 6.5, "stroke-linecap": "round" }, torso);
      el("path", { d: "M160 208 L160 330", stroke: L.trim, "stroke-width": 3.5, "stroke-dasharray": "2 7", "stroke-linecap": "round" }, torso);
      for (let i = 0; i < 6; i++) el("circle", { cx: 140 + i * 8, cy: 254 + Math.abs(2.5 - i) * 9, r: 2.8, fill: L.trim }, torso);
      el("path", { d: "M58 548 Q160 572 262 548", fill: "none", stroke: L.trim, "stroke-width": 5 }, torso);
      fold("M120 262 Q100 400 92 540"); fold("M200 262 Q220 400 228 540"); fold("M150 362 Q146 452 140 556", .1); fold("M172 362 Q176 452 182 556", .1);
    } else if (key === "woman_traditional") {
      el("path", { d: "M110 190 Q160 170 210 190 L252 600 Q160 618 68 600Z", fill: url("cloth") }, torso);
      el("path", { d: "M134 184 Q160 234 186 184", fill: "none", stroke: L.trim, "stroke-width": 6.5, "stroke-linecap": "round" }, torso);
      el("path", { d: "M120 302 Q160 322 200 302", fill: "none", stroke: L.trim, "stroke-width": 3.5, "stroke-dasharray": "3 6" }, torso);
      el("path", { d: "M68 600 Q160 618 252 600", fill: "none", stroke: L.trim, "stroke-width": 5.5 }, torso);
      for (let i = 0; i < 5; i++) el("path", { d: `M${92 + i * 34} 560 l7 -12 l7 12z`, fill: L.trim }, torso);
      fold("M124 322 Q108 452 98 596"); fold("M196 322 Q212 452 222 596");
    } else if (key === "man_casual") {
      el("path", { d: "M108 190 Q160 172 212 190 L226 450 Q160 464 94 450Z", fill: url("dye") }, torso);
      el("path", { d: "M147 186 L160 216 L173 186", fill: "none", stroke: "#fff", "stroke-width": 3.2, opacity: .85 }, torso);
      fold("M128 262 Q122 362 118 448"); fold("M192 262 Q198 362 202 448");
    } else {
      el("path", { d: "M112 190 Q160 172 208 190 L222 392 Q160 404 98 392Z", fill: url("wax") }, torso);
      el("path", { d: "M92 382 Q160 400 228 382 L240 600 Q160 616 80 600Z", fill: url("skirt") }, torso);
      el("path", { d: "M92 382 Q160 400 228 382", fill: "none", stroke: L.top3, "stroke-width": 5 }, torso);
    }
    // soft contact shadow under the head on the chest, and a light sheen across the shoulders
    blurred("ellipse", { cx: 160, cy: 196, rx: 32, ry: 10, fill: "#000", opacity: .28 }, "b4", torso);
    el("path", { d: "M114 196 Q160 184 206 196 L204 214 Q160 202 116 214Z", fill: "#fff", opacity: .07 }, torso);
    if (robot) {
      el("rect", { x: 140, y: 252, width: 40, height: 26, rx: 7, fill: "#0b1626", opacity: .88 }, torso);
      [0, 1, 2].forEach(i => el("circle", { cx: 150 + i * 10, cy: 265, r: 3, fill: ["#22d3ee", "#a3e635", "#f59e0b"][i], class: "dg-led l" + i }, torso));
    }

    /* head */
    const head = el("g", { class: "dg-head" }, root);
    parts.head = head;
    el("path", { d: "M146 150 L174 150 L176 194 Q160 203 144 194Z", fill: limbFill }, head);                     // neck
    if (!robot) blurred("ellipse", { cx: 160, cy: 168, rx: 20, ry: 8, fill: K.deep, opacity: .6 }, "b4", head);

    // hair behind the head
    function curlCluster(cx, cy, rx, ry, n, rmin, rmax, seed, parent) {
      const r = rng(seed);
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, d = Math.sqrt(r());
        const x = cx + Math.cos(a) * rx * d, y = cy + Math.sin(a) * ry * d, rr = rmin + r() * (rmax - rmin);
        el("circle", { cx: x.toFixed(1), cy: y.toFixed(1), r: rr.toFixed(1), fill: url("curl") }, parent);
        el("path", { d: `M${(x - rr * .5).toFixed(1)} ${(y - rr * .1).toFixed(1)} a${(rr * .55).toFixed(1)} ${(rr * .55).toFixed(1)} 0 1 1 ${(rr * .8).toFixed(1)} ${(rr * .3).toFixed(1)}`,
          stroke: HAIR.light, "stroke-width": 1.1, fill: "none", opacity: .45 }, parent);
      }
    }
    if (!robot && key === "woman_official") {
      // curls gathered up into a big soft puff behind the head
      curlCluster(160, 62, 50, 30, 70, 7, 12, 7, head);
      curlCluster(116, 108, 12, 30, 18, 6, 10, 11, head);
      curlCluster(204, 108, 12, 30, 18, 6, 10, 13, head);
    } else if (!robot && key === "woman_casual") {
      // two afro puffs
      curlCluster(122, 66, 26, 22, 46, 6, 10, 21, head);
      curlCluster(198, 66, 26, 22, 46, 6, 10, 23, head);
    }

    if (robot) {
      el("rect", { x: 118, y: 64, width: 84, height: 90, rx: 32, fill: url("steel") }, head);
      el("rect", { x: 128, y: 86, width: 64, height: 40, rx: 18, fill: "#0b1626" }, head);
      el("rect", { x: 128, y: 86, width: 64, height: 40, rx: 18, fill: url("gloss") }, head);
      parts.eyeL = el("rect", { x: 140, y: 99, width: 13, height: 13, rx: 6.5, fill: "#22d3ee", class: "dg-eye" }, head);
      parts.eyeR = el("rect", { x: 167, y: 99, width: 13, height: 13, rx: 6.5, fill: "#22d3ee", class: "dg-eye" }, head);
      parts.mouth = el("path", { d: "M147 138 Q160 146 173 138", stroke: "#22d3ee", "stroke-width": 3.5, fill: "none", "stroke-linecap": "round" }, head);
      el("line", { x1: 160, y1: 64, x2: 160, y2: 42, stroke: metalD, "stroke-width": 3.5 }, head);
      parts.antenna = el("circle", { cx: 160, cy: 38, r: 6.5, fill: "#f43f5e", class: "dg-antenna" }, head);
      el("circle", { cx: 118, cy: 108, r: 8, fill: metalD }, head); el("circle", { cx: 202, cy: 108, r: 8, fill: metalD }, head);
    } else {
      // ears
      for (const x of [113, 207]) {
        el("ellipse", { cx: x, cy: 120, rx: 9, ry: 13, fill: url("ear") }, head);
        el("ellipse", { cx: x + (x < 160 ? 1.5 : -1.5), cy: 121, rx: 4.5, ry: 7.5, fill: K.dark, opacity: .55 }, head);
      }
      // the face: a big soft cranium and a small chin
      const FACE = "M160 58 C199 58 210 88 209 116 C208 146 189 167 160 169 C131 167 112 146 111 116 C110 88 121 58 160 58Z";
      el("path", { d: FACE, fill: url("face") }, head);
      el("path", { d: FACE, fill: url("rim") }, head);                                       // cool rim light, shadow side
      blurred("ellipse", { cx: 152, cy: 82, rx: 24, ry: 11, fill: "#fff", opacity: .2 }, "b7", head);   // forehead sheen
      blurred("ellipse", { cx: 131, cy: 141, rx: 13, ry: 8, fill: K.blush, opacity: .5 }, "b4", head);
      blurred("ellipse", { cx: 189, cy: 141, rx: 13, ry: 8, fill: K.blush, opacity: .42 }, "b4", head);
      blurred("ellipse", { cx: 133, cy: 133, rx: 6, ry: 3.2, fill: "#fff", opacity: .3 }, "b2", head);    // cheek highlight
      blurred("path", { d: "M128 150 Q160 176 192 150 Q160 168 128 150Z", fill: K.deep, opacity: .35 }, "b2", head);   // under the chin line
      // eyes: big and glossy (the outer group places it, the inner one blinks)
      function eye(cx, s) {
        blurred("ellipse", { cx, cy: 112, rx: 17, ry: 13, fill: K.deep, opacity: .32 }, "b4", head);           // socket
        const at = el("g", { transform: `translate(${cx} 116)` }, head);
        const clip = el("clipPath", { id: id("eye" + s) }, defs);
        el("ellipse", { cx: 0, cy: 0, rx: 12.5, ry: 11.5 }, clip);
        const e = el("g", { class: "dg-eye" }, at);
        el("ellipse", { cx: 0, cy: 0, rx: 12.5, ry: 11.5, fill: url("sclera") }, e);
        const inner = el("g", { "clip-path": `url(#${uid}eye${s})` }, e);
        el("circle", { cx: s * .6, cy: 1.2, r: 8.8, fill: url("iris") }, inner);
        el("circle", { cx: s * .6, cy: 1.2, r: 8.8, fill: "none", stroke: "#130904", "stroke-width": 1.2 }, inner);
        el("circle", { cx: s * .6, cy: 1.4, r: 4.3, fill: "#080402" }, inner);
        el("path", { d: "M-13 -3.2 Q0 -10.6 13 -3.2 L13 -13 L-13 -13Z", fill: "#3a1d10", opacity: .2 }, inner);       // lid shadow
        el("path", { d: "M-13 -4.6 Q0 -12.4 13 -4.6 L13 -13 L-13 -13Z", fill: K.base }, inner);                     // upper lid
        el("path", { d: "M-13 -7 Q0 -13 13 -7", stroke: K.light, "stroke-width": 1.4, fill: "none", opacity: .5 }, inner);
        el("ellipse", { cx: s * .6 - 3.2, cy: -1.6, rx: 3, ry: 2.5, fill: "#fff" }, e);                // catch-lights
        el("circle", { cx: s * .6 + 3.4, cy: 4.6, r: 1.4, fill: "#fff", opacity: .85 }, e);
        el("path", { d: "M-13.6 -3.6 Q0 -13.2 13.6 -3.6", stroke: HAIR.dark, "stroke-width": fig === "woman" ? 3.2 : 2.4, fill: "none", "stroke-linecap": "round" }, e);
        if (fig === "woman") [[10.5, -7.6, 15.5, -11.4], [12.8, -5, 17.8, -7.2]].forEach(([x1, y1, x2, y2]) =>
          el("path", { d: `M${s * x1} ${y1} Q${s * (x1 + 3.4)} ${y1 - 1.6} ${s * x2} ${y2}`, stroke: HAIR.dark, "stroke-width": 2.2, fill: "none", "stroke-linecap": "round" }, e));
        el("path", { d: "M-10 8.6 Q0 13 10 8.6", stroke: K.deep, "stroke-width": 1.1, fill: "none", opacity: .5 }, e);
        return e;
      }
      parts.eyeL = eye(140, -1); parts.eyeR = eye(180, 1);
      // brows: thick, shaped
      const bw = fig === "man" ? 5 : 4;
      el("path", { d: fig === "man" ? "M126 96 Q138 89 152 94" : "M127 96 Q138 87 152 92", stroke: HAIR.base, "stroke-width": bw, fill: "none", "stroke-linecap": "round" }, head);
      el("path", { d: fig === "man" ? "M168 94 Q182 89 194 96" : "M168 92 Q182 87 193 96", stroke: HAIR.base, "stroke-width": bw, fill: "none", "stroke-linecap": "round" }, head);
      // nose: small and rounded, with a highlight on the tip
      blurred("path", { d: "M156 118 Q152 130 152 136", stroke: K.deep, "stroke-width": 3, fill: "none", opacity: .35 }, "b2", head);
      el("ellipse", { cx: 160, cy: 136, rx: 9, ry: 6, fill: K.base }, head);
      blurred("ellipse", { cx: 160, cy: 138.5, rx: 8, ry: 3.5, fill: K.deep, opacity: .45 }, "b1", head);
      el("ellipse", { cx: 155.5, cy: 139, rx: 2.2, ry: 1.4, fill: "#1a0c06", opacity: .65 }, head);
      el("ellipse", { cx: 164.5, cy: 139, rx: 2.2, ry: 1.4, fill: "#1a0c06", opacity: .65 }, head);
      blurred("ellipse", { cx: 158, cy: 133, rx: 3.4, ry: 2.2, fill: "#fff", opacity: .55 }, "b1", head);
      // beard (man): neat and short, around the jaw and chin
      if (fig === "man") {
        el("path", { d: "M117 128 C118 150 136 172 160 173 C184 172 202 150 203 128 C198 146 190 152 182 154 C176 146 168 145 160 146 C152 145 144 146 138 154 C130 152 122 146 117 128Z", fill: url("hairCap"), opacity: .96 }, head);
        el("path", { d: "M146 146 Q160 140 174 146 Q170 150 160 149 Q150 150 146 146Z", fill: HAIR.base }, head);   // moustache
      }
      // an open, friendly smile
      const m = el("g", { transform: "translate(160 152)" }, head); parts.mouth = m;
      el("path", { d: "M-15 -2 Q0 3 15 -2 Q10 8.5 0 9.2 Q-10 8.5 -15 -2Z", fill: "#4a130f" }, m);
      el("path", { d: "M-13.5 -1.2 Q0 3.2 13.5 -1.2 L12 2.8 Q0 5.8 -12 2.8Z", fill: "#fbf7f1" }, m);
      el("ellipse", { cx: 0, cy: 7.2, rx: 5.5, ry: 2.2, fill: "#b9483f" }, m);
      el("path", { d: "M-17 -2.6 Q-8 -7 0 -4.4 Q8 -7 17 -2.6 Q8 -.6 0 -1.2 Q-8 -.6 -17 -2.6Z", fill: url("lip") }, m);
      el("path", { d: "M-13.5 5 Q0 14.5 13.5 5 Q0 11 -13.5 5Z", fill: url("lipL") }, m);
      el("ellipse", { cx: 0, cy: 10.4, rx: 5, ry: 1.3, fill: "#fff", opacity: .35 }, m);
      el("circle", { cx: -17, cy: -2.6, r: 1.4, fill: K.deep, opacity: .7 }, m); el("circle", { cx: 17, cy: -2.6, r: 1.4, fill: K.deep, opacity: .7 }, m);
      // hair in front / earrings
      if (fig === "man") {
        el("path", { d: "M112 112 C108 70 132 52 160 51 C188 52 212 70 208 112 C204 94 196 80 184 76 C176 84 144 84 136 76 C124 80 116 94 112 112Z", fill: url("hairCap") }, head);
        blurred("path", { d: "M130 70 Q150 60 176 64", stroke: HAIR.light, "stroke-width": 3, fill: "none", opacity: .45 }, "b1", head);
      } else {
        if (key !== "woman_traditional") {
          // hair pulled back smoothly over the crown
          el("path", { d: "M112 112 C109 72 132 54 160 53 C188 54 211 72 208 112 C204 90 190 76 160 74 C130 76 116 90 112 112Z", fill: url("hairCap") }, head);
          [[124, 84, 148, 62], [140, 72, 160, 58], [180, 72, 162, 58], [196, 84, 172, 62]].forEach(([x1, y1, x2, y2]) =>
            el("path", { d: `M${x1} ${y1} Q${(x1 + x2) / 2} ${Math.min(y1, y2) - 2} ${x2} ${y2}`, stroke: HAIR.light, "stroke-width": 1.4, fill: "none", opacity: .5 }, head));
        }
        // drop earrings with a gloss
        for (const x of [111, 209]) {
          el("line", { x1: x, y1: 132, x2: x, y2: 142, stroke: "#d9a845", "stroke-width": 1.4 }, head);
          el("ellipse", { cx: x, cy: 152, rx: 4.5, ry: 10, fill: "#e3b04b" }, head);
          el("ellipse", { cx: x - 1.5, cy: 148, rx: 1.4, ry: 4, fill: "#fff", opacity: .55 }, head);
        }
      }
    }
    if (key === "woman_casual" && !robot) {
      el("path", { d: "M113 86 Q160 50 207 86 L205 96 Q160 62 115 96Z", fill: url("band") }, head);               // coral headband at the hairline
      el("path", { d: "M119 86 Q160 56 201 86", stroke: "#fff", "stroke-opacity": .4, "stroke-width": 1.8, fill: "none" }, head);
    }
    if (key === "man_traditional") {
      el("path", { d: robot ? "M122 72 Q160 54 198 72 L196 52 Q160 36 124 52Z" : "M116 88 Q160 70 204 88 L200 56 Q160 40 120 56Z", fill: L.cap }, head);
      el("path", { d: robot ? "M123 68 Q160 55 197 68" : "M117 84 Q160 68 203 84", fill: "none", stroke: L.trim, "stroke-width": 4 }, head);
      el("path", { d: robot ? "M126 56 Q160 44 194 56" : "M124 60 Q160 47 196 60", fill: "none", stroke: "#fff", "stroke-opacity": .4, "stroke-width": 3 }, head);
    } else if (key === "woman_traditional") {
      // fanned knot first (behind), then the wrap around the head
      [[-62, 0], [-34, 1], [-6, 0], [22, 1], [50, 0]].forEach(([a, c]) => el("path", {
        d: "M0 0 C-14 -16 -12 -44 0 -52 C12 -44 14 -16 0 0Z", fill: c ? L.wrap2 : L.wrap,
        transform: `translate(160 54) rotate(${a})` }, head));
      el("path", { d: "M104 110 Q96 60 120 44 Q160 26 200 44 Q224 60 216 110 Q160 88 104 110Z", fill: L.wrap }, head);
      el("path", { d: "M106 100 Q160 80 214 100", fill: "none", stroke: L.wrap2, "stroke-width": 5 }, head);
      [["M116 82 Q140 60 170 56", .22], ["M150 92 Q176 70 204 70", .18]].forEach(([d, op]) => blurred("path", { d, stroke: "#000", "stroke-width": 3, fill: "none", opacity: op }, "b2", head));
      blurred("path", { d: "M124 58 Q156 42 192 52", stroke: "#fff", "stroke-width": 5, fill: "none", opacity: .25 }, "b2", head);
    }

    /* arms: shoulder → elbow → wrist, each rotating about its own joint (see motion) */
    function arm(side) {
      const s = side === "R" ? 1 : -1;
      const sx = 160 + s * 50, sy = 196, ex = sx, ey = sy + 86, hx = ex, hy = ey + 82;
      const sh = el("g", { class: "dg-arm" + side }, root);
      const sleeve = L.cloth ? url("cloth") : key === "man_casual" ? url("dye") : url("wax");
      const wide = outfit === "traditional";
      if (wide) el("path", { d: `M${sx - 19} ${sy - 7} L${sx + 19} ${sy - 7} L${ex + 25} ${ey + 4} L${ex - 25} ${ey + 4}Z`, fill: sleeve }, sh);
      else el("path", { d: `M${sx - 17} ${sy - 5} Q${sx} ${sy - 17} ${sx + 17} ${sy - 5} L${ex + 13} ${ey + 4} L${ex - 13} ${ey + 4}Z`, fill: sleeve }, sh);
      if (robot) el("circle", { cx: sx, cy: sy, r: 9.5, fill: metalD }, sh);
      const fore = el("g", {}, sh);
      if (robot) el("circle", { cx: ex, cy: ey, r: 8.5, fill: metalD }, fore);
      el("path", { d: `M${ex - 10} ${ey} L${ex + 10} ${ey} L${hx + 8} ${hy} L${hx - 8} ${hy}Z`, fill: limbFill }, fore);
      if (outfit === "official") {
        el("ellipse", { cx: ex, cy: ey + 2, rx: 13, ry: 7.5, fill: sleeve }, fore);
        el("path", { d: `M${ex - 13} ${ey} L${ex + 13} ${ey} L${hx + 11} ${hy - 9} L${hx - 11} ${hy - 9}Z`, fill: sleeve }, fore);
        el("rect", { x: hx - 10, y: hy - 10, width: 20, height: 6.5, rx: 2.5, fill: fig === "man" ? "#f5f7fa" : L.blouse }, fore);
      } else if (wide) {
        el("path", { d: `M${ex - 25} ${ey + 2} L${ex + 25} ${ey + 2} L${hx + 18} ${hy - 12} L${hx - 18} ${hy - 12}Z`, fill: sleeve }, fore);
        el("path", { d: `M${hx - 18} ${hy - 12} L${hx + 18} ${hy - 12}`, stroke: L.trim, "stroke-width": 3.2 }, fore);
      } else if (key === "man_casual") {
        el("path", { d: `M${ex - 14} ${ey} L${ex + 14} ${ey} L${ex + 12} ${ey + 34} L${ex - 12} ${ey + 34}Z`, fill: sleeve }, fore);
      }
      // hand: a jointed rig (see makeHand) — fingers bend at every joint
      const hand = el("g", {}, fore);
      const hr = makeHand(hand, hx, hy, s, robot ? { base: "#cdd6e2", light: "#f4f7fb", dark: "#6b7788", palm: "#dfe6ee", nail: "#ffffff" } : K, robot);
      return { sh, fore, hand, hr, sx, sy, ex, ey, hx, hy };
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
  const REST = Object.assign({ ox: 12, oy: 160, ow: 0, ix: 12, iy: 160, iw: 0, head: 0, y: 0 }, H("oh", "relax"), H("ih", "relax"));
  const P = (o, ...hands) => Object.assign({}, REST, ...hands, o);

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
    const WAVE = H("oh", "wave"), OPEN2 = [H("oh", "open"), H("ih", "open")], FLAT = H("oh", "flat");
    return {
      // big friendly wave with the outer hand: palm out, fingers spread, a soft ripple through them
      wave: [[0, REST], [450, P({ ox: 52, oy: -112, ow: 0, head: 6 }, WAVE)],
             [700, P({ ox: 66, oy: -108, ow: 24, head: 6 }, WAVE)], [950, P({ ox: 40, oy: -114, ow: -24, head: 6 }, WAVE)],
             [1200, P({ ox: 66, oy: -108, ow: 24, head: 6 }, WAVE)], [1450, P({ ox: 40, oy: -114, ow: -24, head: 6 }, WAVE)],
             [1700, P({ ox: 60, oy: -110, ow: 16, head: 6 }, WAVE)], [2300, REST]],
      // arms open wide, palms open: "you are welcome here"
      open: [[0, REST], [650, P({ ox: 128, oy: -22, ow: -18, ix: 128, iy: -22, iw: -18, y: -4 }, ...OPEN2)],
             [1600, P({ ox: 134, oy: -30, ow: -22, ix: 134, iy: -30, iw: -22, y: -5 }, ...OPEN2)], [2300, REST]],
      // sign WELCOME: flat hand, fingers together, palm up, out at the side → sweeps in to the body. Twice.
      sign: [[0, REST], [450, P({ ox: 108, oy: 84, ow: -28, head: -3 }, FLAT)], [1150, P({ ox: -28, oy: 72, ow: -28, head: -6 }, FLAT)],
             [1350, P({ ox: 108, oy: 84, ow: -28, head: -3 }, FLAT)], [2050, P({ ox: -28, oy: 72, ow: -28, head: -6 }, FLAT)], [2750, REST]],
      // hand on the heart, fingers gently curved, with a small bow of the head
      heart: [[0, REST], [600, P({ ix: -36, iy: 58, iw: 12, head: -10, y: 5 }, H("ih", "heart"))],
              [1700, P({ ix: -36, iy: 58, iw: 12, head: -12, y: 7 }, H("ih", "heart"))], [2400, REST]],
      // "this way": index finger out, the others curled, thumb tucked
      point: [[0, REST], [600, P({ ix: 162, iy: -8, iw: -6, head: -12 }, H("ih", "point"))],
              [1700, P({ ix: 164, iy: -14, iw: -8, head: -14 }, H("ih", "point"))], [2400, REST]],
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
        const pre = isOuter ? "oh" : "ih";
        a.hr.set({ c: [0, 1, 2, 3].map(n => p[pre + "c" + n]), s: [0, 1, 2, 3].map(n => p[pre + "s" + n]),
                   ta: p[pre + "ta"], tc: p[pre + "tc"], b: p[pre + "b"], fl: p[pre + "fl"] }, now);
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
