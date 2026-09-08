/* ════════════════════════════════════════════════════════════════════
   hanns_bars3d.js — 3D bar chart studio object            objectType: bars_3d
   ────────────────────────────────────────────────────────────────────
   Bars grow up out of a ground plane. Two skins:

     barSkin: "solid"  — extruded colour blocks (front + top + right face)
     barSkin: "coins"  — stacks of coins, one coin per unit of value

   WHY IT LOOKS THE WAY IT DOES
   ────────────────────────────
   * SVG, not WebGL or CSS 3D. Every studio object in hanns_core.js is
     SVG, and powerpoint_exporter.py rebuilds studio objects from native
     PPTX shapes. An extruded bar here is three <path> quads, so it
     survives that pipeline; a <canvas> would export as a flat picture.

   * Oblique, not isometric. Under a true isometric projection a row of
     bars runs diagonally down the screen: the baseline tilts, the
     category labels stair-step, and a lot of the box goes to empty
     corner. Oblique keeps x horizontal and sends only the depth axis
     back and to the right — same 3D read, straight baseline, labels in
     a line.

   * The grow is JavaScript, not a `.present` CSS rule. Every other
     studio object animates with a CSS keyframe because a <div> fill only
     needs scaleX. An extruded bar cannot: the front face would scale
     correctly, but the right face is a parallelogram whose bottom edge
     is not horizontal, so scaleY shears it off the ground plane. Each
     frame therefore rewrites the three path `d` strings — which is
     cheap, because z maps 1:1 onto screen y, so growing is pure
     translation with no scaling and the top face never squashes.

     The trigger still matches the CSS convention: static in the editor,
     animated on a `.present` stage (which is what the HTML exporter sets
     too), and held back until a revealOn:"cue" element is released.

   DATA
   ────
   The common studio shape, so the one inspector data grid drives it:

       el.rows = [{label, value, color}]

   Element keys, all standard except the two marked:
       title, ramp, accent, max, sort, showValues, decimals,
       valuePrefix, valueSuffix, dark, hideContainer, objAnim
       barSkin      NEW — "solid" | "coins"
       coinSymbol   NEW — glyph on the top coin, e.g. "D", "$", "" for none

   WIRING
   ──────
   1. Save as  hanns/static/hanns/js/hanns_bars3d.js
   2. Append hanns_bars3d.css to hanns/static/hanns/css/hanns.css
   3. Load AFTER hanns_fluid.js and BEFORE hanns_editor.js, in
      editor.html, present.html, review.html and control.html:

        <script src="{% static 'hanns/js/hanns_bars3d.js' %}?v=62"></script>

      Order matters for the same reason it does for hanns_fluid.js: this
      file reads window.Hanns at load time, and the editor builds its
      object drawer from Hanns.OBJECTS after all of these have run.
   4. views.py — add this file to whatever the HTML exporter passes as
      `post_core_js_text`, alongside hanns_studio / hanns_fluid, or a
      downloaded deck loses the chart.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var Hx = window.Hanns;

  /* ── projection ───────────────────────────────────────────────────
       x  →  along the baseline, straight right
       y  →  depth, back and to the right
       z  →  height, straight up                                      */
  var DX = 0.50;   // screen x gained per unit of depth
  var DY = 0.38;   // screen y lost per unit of depth

  function project(x, y, z) { return [x + y * DX, -z - y * DY]; }

  function poly(pts) {
    return "M" + pts.map(function (p) {
      return p[0].toFixed(2) + " " + p[1].toFixed(2);
    }).join("L") + "Z";
  }

  /* ── helpers ──────────────────────────────────────────────────── */

  function svg(name, attrs) {
    var n = document.createElementNS(NS, name);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }
  function div(cls, txt) {
    var d = document.createElement("div");
    if (cls) d.className = cls;
    if (txt != null) d.textContent = txt;
    return d;
  }
  function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d || 0); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function hexToRgb(h) {
    var s = String(h || "#000").trim().replace("#", "");
    if (s.length === 3) s = s.split("").map(function (c) { return c + c; }).join("");
    var n = parseInt(s, 16);
    return isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
  }
  /* amt > 0 lightens toward white, amt < 0 darkens toward black. */
  function shade(hex, amt) {
    var c = hexToRgb(hex), t = amt < 0 ? 0 : 255, p = Math.abs(amt);
    return "#" + c.map(function (v) {
      return ("0" + Math.round(v + (t - v) * p).toString(16)).slice(-2);
    }).join("");
  }

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  /* A little overshoot, so a bar lands rather than gliding to a stop. */
  function easeOutBack(t) {
    var c = 1.34;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  }
  function reducedMotion() {
    return !!(window.matchMedia &&
              window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /* Same shape as fmtNum() in hanns_core.js, so a bars_3d value reads
     identically to the same number on a ranked bar beside it. */
  function fmtNum(v, el) {
    var n = Number(v);
    if (!isFinite(n)) return String(v == null ? "" : v);
    var dec = clamp(num(el && el.decimals, 0), 0, 4);
    var s = n.toLocaleString(undefined, {
      minimumFractionDigits: dec, maximumFractionDigits: dec
    });
    return (el && el.valuePrefix || "") + s + (el && el.valueSuffix || "");
  }

  /* Core owns the ramps, including "accent", which derives a ramp from
     whatever accent colour the element carries. A local copy would
     silently drop that, so defer and only fall back if core is absent. */
  function rampFor(el) {
    if (Hx && typeof Hx.rampFor === "function") return Hx.rampFor(el);
    var a = (el && el.accent) || "#1d4e89";
    return [shade(a, 0.88), shade(a, 0.66), shade(a, 0.38), a, shade(a, -0.22), shade(a, -0.44)];
  }
  function seriesColor(stops, i, n) {
    if (Hx && typeof Hx.seriesColor === "function") return Hx.seriesColor(stops, i, n);
    return stops[clamp(1 + Math.round((n > 1 ? i / (n - 1) : 0.5) * 3), 0, stops.length - 1)];
  }

  function readRows(el) {
    var r = Array.isArray(el && el.rows) ? el.rows : [];
    return r.filter(function (x) { return x && (x.label != null || x.value != null); })
            .slice(0, 12)
            .map(function (x) {
              return {
                label: x.label == null ? "" : String(x.label),
                value: num(x.value, 0),
                color: x.color || ""
              };
            });
  }

  var seq = 0;
  function uid(p) { return p + "-" + (++seq) + "-" + Math.random().toString(36).slice(2, 7); }

  /* ── render ───────────────────────────────────────────────────── */

  function renderBars3D(el) {
    el = el || {};
    var box = div("hs-box hs-bars3d" + (el.dark ? " hs-dark" : "") +
                  (el.hideContainer ? " hs-bare" : ""));
    box.style.setProperty("--accent", el.accent || "#1d4e89");

    var data = readRows(el);
    if (el.sort === "desc") data = data.slice().sort(function (a, b) { return b.value - a.value; });
    else if (el.sort === "asc") data = data.slice().sort(function (a, b) { return a.value - b.value; });

    if (el.title) box.appendChild(div("hs-block-title", el.title));
    if (!data.length) {
      box.appendChild(div("hs-bars3d-empty", "Add rows to draw the chart."));
      return box;
    }

    var skin = el.barSkin === "coins" ? "coins" : "solid";
    var stops = rampFor(el);
    var n = data.length;
    var vmax = (el.max != null && el.max !== "")
      ? num(el.max, 100)
      : Math.max.apply(null, data.map(function (d) { return d.value; }));
    if (!(vmax > 0)) vmax = 1;

    // Footprint shrinks as the series gets longer, so a 12-bar chart
    // occupies the same box as a 3-bar one.
    var side  = clamp(150 - n * 8, 58, 116);
    var gap   = side * (skin === "coins" ? 0.50 : 0.42);
    var depth = side * 0.55;
    var span  = n * side + (n - 1) * gap;
    var maxH  = clamp(span * 0.52, 210, 340);

    // A coin is a short cylinder standing on the ground: top ellipse plus
    // a side band. ry is the foreshortening, tuned to sit with DY rather
    // than derived from it — the exact oblique ellipse is a rotated one
    // and reads worse at slide distance.
    var coinR     = side * 0.46;
    var coinRY    = coinR * 0.40;
    var maxCoins  = clamp(Math.round(16 - n * 0.4), 7, 16);
    var pitch     = maxH / maxCoins;
    var coinThick = pitch * 0.72;
    var symbol    = el.coinSymbol == null ? "D" : String(el.coinSymbol);

    function coinCount(v) { return Math.max(1, Math.round(maxCoins * clamp(v / vmax, 0, 1))); }
    function barHeight(v) {
      return skin === "coins" ? coinCount(v) * pitch
                              : Math.max(6, maxH * clamp(v / vmax, 0, 1));
    }

    // ── view box, fitted to the geometry ────────────────────────
    var padX = side * 0.42;
    var yF = -side * 0.16;            // ground plane, toward the viewer
    var yB = depth + side * 0.34;     // ground plane, away from the viewer

    var minX = -padX + yF * DX;
    var maxX = (span + padX) + yB * DX;
    var minY = -maxH - depth * DY - (skin === "coins" ? 58 : 46);
    var maxY = -yF * DY + 52;

    var S = svg("svg", {
      viewBox: [minX, minY, maxX - minX, maxY - minY].join(" "),
      preserveAspectRatio: "xMidYMid meet",
      class: "hs-svg hs-bars3d-svg"
    });
    S.setAttribute("aria-label",
      (el.title ? el.title + ". " : "") +
      data.map(function (d) { return d.label + " " + fmtNum(d.value, el); }).join(", "));

    var defs = svg("defs");
    S.appendChild(defs);

    var blurId = uid("b3d-shadow");
    var blur = svg("filter", { id: blurId, x: "-60%", y: "-60%", width: "220%", height: "220%" });
    blur.appendChild(svg("feGaussianBlur", { stdDeviation: "8" }));
    defs.appendChild(blur);

    // ── ground plane ────────────────────────────────────────────
    if (!el.hideGround) {
      var ground = svg("g", { class: "hs-bars3d-ground" });
      S.appendChild(ground);

      ground.appendChild(svg("path", {
        d: poly([project(-padX, yF, 0), project(span + padX, yF, 0),
                 project(span + padX, yB, 0), project(-padX, yB, 0)]),
        class: "hs-bars3d-plate"
      }));

      // Depth lines at the bar boundaries only. A full grid competes with
      // the bars, and the bars should win.
      for (var g = 0; g <= n; g++) {
        var gx = g === 0 ? -padX
               : g === n ? span + padX
               : g * (side + gap) - gap / 2;
        var a = project(gx, yF, 0), b = project(gx, yB, 0);
        ground.appendChild(svg("line", {
          x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: "hs-bars3d-depth"
        }));
      }

      var fa = project(-padX, 0, 0), fb = project(span + padX, 0, 0);
      ground.appendChild(svg("line", {
        x1: fa[0], y1: fa[1], x2: fb[0], y2: fb[1], class: "hs-bars3d-base"
      }));
    }

    // ── bars ────────────────────────────────────────────────────
    var bars = [];

    // Left to right: a bar's receding top and right face pass behind the
    // next bar along, so later bars must paint over earlier ones.
    data.forEach(function (d, i) {
      var x0 = i * (side + gap), x1 = x0 + side, cx = (x0 + x1) / 2;
      var base = d.color || seriesColor(stops, i, n);

      var g = svg("g", { class: "hs-bars3d-bar" });
      g.style.setProperty("--i", i);
      S.appendChild(g);

      var sc = project(cx, depth / 2, 0);
      var shadow = svg("ellipse", {
        cx: sc[0], cy: sc[1], rx: side * 0.8, ry: side * 0.3,
        class: "hs-bars3d-shadow", filter: "url(#" + blurId + ")",
        "fill-opacity": "0"
      });
      g.appendChild(shadow);

      var bar = {
        x0: x0, x1: x1, cx: cx, row: d,
        target: barHeight(d.value), shadow: shadow, parts: null, coins: null
      };

      if (skin === "solid") {
        // Light reads as coming from above and in front: top brightest,
        // front the true colour, the receding right face darkest.
        var right = svg("path", { fill: shade(base, -0.26) });
        var front = svg("path", { fill: base });
        var top   = svg("path", {
          fill: shade(base, 0.26), stroke: shade(base, 0.44), "stroke-width": "1"
        });
        g.appendChild(right); g.appendChild(front); g.appendChild(top);
        bar.parts = { top: top, front: front, right: right };
      } else {
        bar.coins = [];
        var count = coinCount(d.value);
        var ccx = cx + (depth / 2) * DX;
        var cz0 = -(depth / 2) * DY;

        var gradId = uid("b3d-coin");
        var grad = svg("linearGradient", { id: gradId, x1: "0", y1: "0", x2: "1", y2: "0" });
        grad.appendChild(svg("stop", { offset: "0",    "stop-color": shade(base, -0.34) }));
        grad.appendChild(svg("stop", { offset: "0.40", "stop-color": base }));
        grad.appendChild(svg("stop", { offset: "1",    "stop-color": shade(base, -0.18) }));
        defs.appendChild(grad);

        // Bottom coin first, so each coin overlaps the one below it.
        for (var k = 0; k < count; k++) {
          var cy = cz0 - (k + 1) * pitch;
          var cg = svg("g", { opacity: "0" });

          // Side band: down the left edge, under the bottom arc, back up
          // the right edge. The straight closing line is covered by the
          // top ellipse, which is drawn immediately after.
          cg.appendChild(svg("path", {
            d: "M" + (ccx - coinR).toFixed(2) + " " + cy.toFixed(2) +
               "V" + (cy + coinThick).toFixed(2) +
               "A" + coinR.toFixed(2) + " " + coinRY.toFixed(2) + " 0 0 0 " +
               (ccx + coinR).toFixed(2) + " " + (cy + coinThick).toFixed(2) +
               "V" + cy.toFixed(2) + "Z",
            fill: "url(#" + gradId + ")"
          }));
          cg.appendChild(svg("ellipse", {
            cx: ccx, cy: cy, rx: coinR, ry: coinRY,
            fill: shade(base, 0.34), stroke: shade(base, -0.20), "stroke-width": "1"
          }));
          cg.appendChild(svg("ellipse", {
            cx: ccx, cy: cy, rx: coinR * 0.64, ry: coinRY * 0.64,
            fill: "none", stroke: shade(base, -0.16),
            "stroke-width": "1", "stroke-opacity": "0.5"
          }));

          // The face value goes on the top coin only — a stack of glyphs
          // is noise at slide distance.
          if (k === count - 1 && symbol) {
            var glyph = svg("text", {
              "text-anchor": "middle", fill: shade(base, -0.44),
              "font-size": String(Math.round(coinR * 0.72)), "font-weight": "800",
              y: Math.round(coinR * 0.26),
              transform: "translate(" + ccx.toFixed(2) + "," + cy.toFixed(2) + ") scale(1,0.42)"
            });
            glyph.textContent = symbol;
            cg.appendChild(glyph);
          }

          g.appendChild(cg);
          bar.coins.push(cg);
        }
      }

      if (el.showValues !== false) {
        var vt = svg("text", {
          x: project(cx, depth / 2, 0)[0], "text-anchor": "middle",
          class: "hs-bars3d-value", opacity: "0"
        });
        g.appendChild(vt);
        bar.valueText = vt;
      }

      var lp = project(cx, yF, 0);
      var lt = svg("text", {
        x: lp[0], y: lp[1] + 34, "text-anchor": "middle", class: "hs-bars3d-label"
      });
      lt.textContent = d.label;
      g.appendChild(lt);

      bars.push(bar);
    });

    box.appendChild(S);

    var state = {
      el: el, bars: bars, skin: skin, depth: depth,
      growMs: clamp(num(el.growMs, 850), 120, 6000),
      stagger: clamp(num(el.stagger, 130), 0, 2000),
      raf: 0
    };
    box.__bars3d = state;

    // Static in the editor, animated on a stage — the same split every
    // `.present`-scoped studio object uses. objAnim:false opts out.
    var animates = el.objAnim !== false && !reducedMotion();
    paint(state, animates ? 0 : 1);
    if (animates) whenOnStage(box, function () { play(box); });

    return box;
  }

  /* Play once the box is on a live stage AND actually visible. The second
     half matters for revealOn:"cue" elements: paintSlide() renders them
     up front and holds them with .el-held, so a chart that started
     growing at paint time would be sitting at rest by the time the
     presenter cued it. */
  function whenOnStage(box, run) {
    requestAnimationFrame(function () {
      if (!box.isConnected || !box.closest(".present")) return;

      var held = box.closest(".el-held");
      if (!held) { run(); return; }

      var mo = new MutationObserver(function () {
        if (!held.classList.contains("el-held")) { mo.disconnect(); run(); }
      });
      mo.observe(held, { attributes: true, attributeFilter: ["class"] });
    });
  }

  /* ── paint one frame ──────────────────────────────────────────────
     Every bar owns a window carved out of the global 0..1 progress, so a
     single rAF loop drives the whole chart. */
  function paint(state, p) {
    var n = state.bars.length;
    var total = state.growMs + state.stagger * (n - 1);
    var depth = state.depth;

    state.bars.forEach(function (bar, i) {
      var start = (state.stagger * i) / total;
      var end = start + state.growMs / total;
      var lp = clamp((p - start) / (end - start || 1), 0, 1);

      if (state.skin === "solid") {
        var h = Math.max(0.5, bar.target * easeOutBack(lp));
        var x0 = bar.x0, x1 = bar.x1;
        bar.parts.front.setAttribute("d", poly([
          project(x0, 0, 0), project(x1, 0, 0),
          project(x1, 0, h), project(x0, 0, h)
        ]));
        bar.parts.top.setAttribute("d", poly([
          project(x0, 0, h), project(x1, 0, h),
          project(x1, depth, h), project(x0, depth, h)
        ]));
        bar.parts.right.setAttribute("d", poly([
          project(x1, 0, 0), project(x1, depth, 0),
          project(x1, depth, h), project(x1, 0, h)
        ]));
      } else {
        // One coin lands per slice of this bar's window.
        var count = bar.coins.length;
        bar.coins.forEach(function (cg, k) {
          var cp = clamp((lp - k / count) / (1 / count), 0, 1);
          cg.setAttribute("opacity", clamp(cp * 2.4, 0, 1).toFixed(3));
          cg.setAttribute("transform",
            "translate(0," + ((1 - easeOutBack(cp)) * 20).toFixed(2) + ")");
        });
      }

      // The shadow deepens and spreads as the bar rises off the plane.
      var sp = easeOutCubic(lp), w = bar.x1 - bar.x0;
      bar.shadow.setAttribute("fill-opacity", (0.32 * sp).toFixed(3));
      bar.shadow.setAttribute("rx", (w * (0.62 + 0.26 * sp)).toFixed(2));
      bar.shadow.setAttribute("ry", (w * (0.20 + 0.12 * sp)).toFixed(2));

      if (bar.valueText) {
        var hh = bar.target * (state.skin === "coins" ? easeOutCubic(lp) : easeOutBack(lp));
        // A coin stack's top ellipse bulges above the bar's nominal
        // height, so the label needs extra clearance in that skin.
        var lift = state.skin === "coins" ? 36 : 24;
        bar.valueText.setAttribute("y", (project(0, depth, hh)[1] - lift).toFixed(2));
        bar.valueText.setAttribute("opacity", clamp((lp - 0.2) / 0.4, 0, 1).toFixed(3));
        bar.valueText.textContent = fmtNum(bar.row.value * easeOutCubic(lp), state.el);
      }
    });
  }

  function play(box) {
    var state = box && box.__bars3d;
    if (!state) return;
    if (state.raf) cancelAnimationFrame(state.raf);
    if (reducedMotion()) { paint(state, 1); return; }

    var total = state.growMs + state.stagger * (state.bars.length - 1);
    var t0 = 0;

    function frame(ts) {
      if (!t0) t0 = ts;
      var p = clamp((ts - t0) / total, 0, 1);
      paint(state, p);
      state.raf = p < 1 ? requestAnimationFrame(frame) : 0;
    }
    paint(state, 0);
    state.raf = requestAnimationFrame(frame);
  }

  /* ════════════════════════════════════════════════════════════════
     REGISTRATION — nothing below here edits core
     ────────────────────────────────────────────────────────────────
     hanns_core.js keeps its STUDIO table in a closure, but exports every
     lookup table it dispatches on by reference, so adding a key to those
     objects registers a kind outright:

       STUDIO_RENDER  isStudioObject() and renderStudioObject() read it,
                      which is what makes renderObject() route here
       STUDIO_SEED    makeObject() deep-copies it onto a new element
       STUDIO_FIELDS  studioFields() in hanns_editor.js builds the
                      inspector from it
       OBJECTS        objectDef() and the editor's object drawer
     ════════════════════════════════════════════════════════════════ */

  var DEF = {
    kind: "bars_3d",
    label: "3D bars (grow up)",
    icon: "📊",
    group: "Data",
    w: 720, h: 420,
    accent: "#1d4e89",
    help: "Bars rise out of the ground — solid blocks, or stacks of coins for money"
  };

  var SEED = {
    title: "",
    barSkin: "solid",
    coinSymbol: "D",
    ramp: "ocean",
    sort: "none",
    max: "",
    showValues: true,
    decimals: 0,
    valuePrefix: "",
    valueSuffix: "M",
    growMs: 850,
    stagger: 130,
    objAnim: true,
    showLabel: false,
    hideContainer: true,
    rows: [
      { label: "Q1", value: 32 },
      { label: "Q2", value: 47 },
      { label: "Q3", value: 41 },
      { label: "Q4", value: 68 }
    ]
  };

  // Every key here already has a control in studioFields(), except
  // "bars3dOpts" — see the one snippet to paste into hanns_editor.js.
  var FIELDS = ["title", "bars3dOpts", "ramp", "accent", "max", "sort",
                "numfmt", "showValues", "objAnim", "dark", "grid"];

  window.HannsBars3D = {
    DEF: DEF, SEED: SEED, FIELDS: FIELDS,
    render: renderBars3D, play: play, project: project
  };

  if (!Hx) {
    console.warn("[hanns-bars3d] window.Hanns missing — the renderer is " +
                 "available as HannsBars3D.render(), but the object is not " +
                 "registered. Load this after hanns_core.js.");
    return;
  }

  if (Hx.STUDIO_RENDER) Hx.STUDIO_RENDER.bars_3d = renderBars3D;
  if (Hx.STUDIO_SEED)   Hx.STUDIO_SEED.bars_3d   = SEED;
  if (Hx.STUDIO_FIELDS) Hx.STUDIO_FIELDS.bars_3d = FIELDS;
  if (Hx.STUDIO) Hx.STUDIO.bars_3d = { def: DEF, seed: SEED, render: renderBars3D, fields: FIELDS };
  if (Array.isArray(Hx.STUDIO_KINDS) && Hx.STUDIO_KINDS.indexOf("bars_3d") < 0) {
    Hx.STUDIO_KINDS.push("bars_3d");
  }
  if (Array.isArray(Hx.STUDIO_OBJECTS) &&
      !Hx.STUDIO_OBJECTS.some(function (o) { return o.kind === "bars_3d"; })) {
    Hx.STUDIO_OBJECTS.push(DEF);
  }
  if (Array.isArray(Hx.OBJECTS) &&
      !Hx.OBJECTS.some(function (o) { return o.kind === "bars_3d"; })) {
    Hx.OBJECTS.push(DEF);
  }

  console.info("[hanns-bars3d] 3D bar chart registered as objectType \"bars_3d\".");
})();
