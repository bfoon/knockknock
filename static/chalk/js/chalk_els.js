/* Chalk — the element layer.
 *
 * Elements sit above the ink in a plain DOM layer. Everything is positioned in
 * percentages of the board box, so the same element JSON renders identically on
 * the phone pad and the projector without a single pixel constant.
 *
 * An element:
 *   { id, type, x, y, w, h, rot, ...type fields, fx }
 * with x/y/w/h normalised 0..1 and rot in degrees.
 *
 * window.ChalkEls = { Layer, defaults, FONTS, blank }
 */
(function (global) {
  "use strict";

  var SVGNS = "http://www.w3.org/2000/svg";

  /* The hands. Each of these is a family declared in chalk_fonts.css and
   * served from the board's own static files, with a system handwriting font
   * behind it so a missing file still lands somewhere handwritten.
   *
   * Keep the four original keys exactly as they were: boards saved before
   * any of this existed have `font: "sans"` written into their pages, and a
   * lesson from last term is not a thing to break for a nicer list. */
  var FONTS = {
    sans:  'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono:  'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    hand:  '"Chalk Patrick", "Comic Sans MS", "Segoe Print", cursive',

    chalk:      '"Chalk Gloria", "Chalkboard SE", "Segoe Print", cursive',
    rough:      '"Chalk Rock", "Chalkduster", "Segoe Print", cursive',
    caps:       '"Chalk Amatic", "Haettenschweiler", "Impact", sans-serif',
    pencil:     '"Chalk Indie", "Segoe Print", "Bradley Hand", cursive',
    print:      '"Chalk Patrick", "Comic Sans MS", "Segoe Print", cursive',
    architect:  '"Chalk Architect", "Segoe Print", "Courier New", monospace',
    pen:        '"Chalk Caveat", "Bradley Hand", "Segoe Script", cursive',
    fountain:   '"Chalk Dancing", "Snell Roundhand", "Segoe Script", cursive',
    marker:     '"Chalk Marker", "Marker Felt", Impact, sans-serif',
    sketch:     '"Chalk Sketch", "Chalkduster", Impact, sans-serif',
    fine:       '"Chalk Shadows", "Segoe Script", "Bradley Hand", cursive',
    typewriter: '"Chalk Elite", "Courier New", ui-monospace, monospace'
  };

  /* What each hand was written with. The font decides the shape of the
   * letter; this decides whether it is dusty, waxy, wet or flat. Anything
   * not listed here is drawn as plain colour. */
  var INK = {
    chalk: "chalk", rough: "chalk", caps: "chalk", sketch: "chalk",
    pencil: "pencil", architect: "pencil",
    pen: "pen", fine: "pen", fountain: "pen",
    marker: "marker"
  };

  /* For the picker: key, what a teacher calls it, and which drawer it is in.
   * Written out here so the phone and the board cannot disagree about it. */
  var FONT_LIST = [
    ["chalk", "Chalk", "hand"],
    ["rough", "Rough chalk", "hand"],
    ["caps", "Tall chalk", "hand"],
    ["pencil", "Pencil", "hand"],
    ["pen", "Pen", "hand"],
    ["fine", "Fine liner", "hand"],
    ["fountain", "Fountain pen", "hand"],
    ["marker", "Marker", "hand"],
    ["print", "Neat print", "print"],
    ["architect", "Architect", "print"],
    ["sketch", "Sketched", "print"],
    ["typewriter", "Typewriter", "print"],
    ["sans", "Plain", "plain"],
    ["serif", "Book", "plain"],
    ["mono", "Code", "plain"],
    ["hand", "Handwriting", "plain"]
  ];

  var idSeed = 0;
  function newId() {
    idSeed = (idSeed + 1) % 100000;
    return "e" + Date.now().toString(36) + idSeed.toString(36);
  }

  /* ---- colour helpers ---------------------------------------------- */

  function parseHex(hex) {
    if (typeof hex !== "string") return null;
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6 && h.length !== 8) return null;
    var v = parseInt(h.slice(0, 6), 16);
    if (isNaN(v)) return null;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  /* amount > 0 lightens, < 0 darkens. Used to shade the faces of a solid. */
  function shade(hex, amount) {
    var c = parseHex(hex);
    if (!c) return hex;
    var f = function (v) {
      var out = amount > 0 ? v + (255 - v) * amount : v * (1 + amount);
      return Math.round(Math.min(255, Math.max(0, out)));
    };
    return "rgb(" + f(c[0]) + "," + f(c[1]) + "," + f(c[2]) + ")";
  }

  /* ---- defaults ----------------------------------------------------- */

  function blank(type, opts) {
    opts = opts || {};
    var base = {
      id: newId(), type: type,
      x: 0.34, y: 0.34, w: 0.24, h: 0.2, rot: 0
    };
    if (type === "text") {
      return Object.assign(base, {
        w: 0.36, h: 0.12,
        text: opts.text || "",
        size: 0.06, color: opts.color || "#ffffff", font: "sans",
        align: "left", bold: false, italic: false, bg: ""
      });
    }
    if (type === "figure") {
      return Object.assign(base, {
        w: 0.5, h: 0.34,
        kind: opts.kind || "rabbit",
        enter: opts.enter || "",          /* "" means the figure's own way in */
        show: 0,                          /* labels up so far; -1 is all of them */
        flip: false,
        alive: true,
        speed: 1,
        play: 1,
        size: 0.026,
        color: opts.color || "#ffffff",
        font: "print",
        stroke: opts.stroke || opts.color || "#ffffff",
        accent: opts.accent || "#d9a441",
        strokeW: 2
      });
    }
    if (type === "card") {
      return Object.assign(base, {
        w: 0.21, h: 0.17,
        text: opts.text || "",
        num: opts.num == null ? "1" : String(opts.num),
        numAt: "bottom",
        size: 0.034, color: opts.color || "#ffffff", font: "print",
        align: "center", bold: true, italic: false,
        fill: opts.fill || "#16202a", fillOn: true,
        stroke: opts.stroke || "#56b7e6", accent: opts.accent || opts.stroke || "#56b7e6",
        strokeW: 2, dash: 0, radius: 14
      });
    }
    if (type === "image") {
      return Object.assign(base, {
        w: 0.3, h: 0.24, src: opts.src || "", fit: "contain", radius: 0
      });
    }
    if (type === "shape") {
      return Object.assign(base, {
        shape: opts.shape || "rect",
        fill: opts.fill || "#3d5a73", stroke: opts.stroke || "#ffffff",
        strokeW: 2, dash: 0, fillOn: true,
        sides: 6, inset: 45, depth: 22, radius: 14,
        thickness: 30, slant: 22, head: 22, degrees: 45, hole: 40
      });
    }
    /* freeform */
    var preset = opts.preset || "polygon";
    return Object.assign(base, {
      preset: preset,
      pts: ChalkShapes.seedPoints(preset, 6, 45),
      closed: preset !== "wave",
      edge: "sharp", radius: 14,
      fill: opts.fill || "#3d5a73", stroke: opts.stroke || "#ffffff",
      strokeW: 2, dash: 0, fillOn: preset !== "wave",
      sides: 6, inset: 45,
      edited: false
    });
  }

  /* ---- animation ----------------------------------------------------- */

  /* Hand-drawn animation has always been three drawings of the same thing,
   * held for two frames each. The line never sits still, and that shimmer —
   * animators call it boil — is most of what makes a drawing read as drawn
   * rather than plotted. Three turbulence filters, cycled by CSS at eight
   * frames a second, is the same trick with the same result.
   *
   * They live in one hidden SVG at the end of the page, made once, shared by
   * every element on the board. */
  var BOIL_ID = "chalk-boil-defs";

  function ensureBoil() {
    if (!global.document || document.getElementById(BOIL_ID)) return;
    var svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("id", BOIL_ID);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    var defs = document.createElementNS(SVGNS, "defs");
    [[0.021, 7], [0.026, 19], [0.019, 41]].forEach(function (spec, i) {
      var f = document.createElementNS(SVGNS, "filter");
      f.setAttribute("id", "chalk-boil-" + (i + 1));
      /* Room to wobble into: a displacement map clips at the filter box. */
      f.setAttribute("x", "-12%"); f.setAttribute("y", "-12%");
      f.setAttribute("width", "124%"); f.setAttribute("height", "124%");
      var t = document.createElementNS(SVGNS, "feTurbulence");
      t.setAttribute("type", "fractalNoise");
      t.setAttribute("baseFrequency", spec[0]);
      t.setAttribute("numOctaves", "2");
      t.setAttribute("seed", spec[1]);
      t.setAttribute("result", "n");
      var d = document.createElementNS(SVGNS, "feDisplacementMap");
      d.setAttribute("in", "SourceGraphic");
      d.setAttribute("in2", "n");
      d.setAttribute("scale", "2.4");
      d.setAttribute("xChannelSelector", "R");
      d.setAttribute("yChannelSelector", "G");
      f.appendChild(t); f.appendChild(d);
      defs.appendChild(f);
    });
    svg.appendChild(defs);
    (document.body || document.documentElement).appendChild(svg);
  }

  /* name -> [seconds at normal speed, easing] */
  var ANIM_IN = {
    none: null,
    draw: [1.15, "cubic-bezier(.5,0,.35,1)"],
    write: [0.9, "steps(26, end)"],
    fade: [0.55, "ease-out"],
    rise: [0.7, "cubic-bezier(.2,.9,.3,1.25)"],
    pop: [0.5, "cubic-bezier(.2,1.4,.4,1)"],
    unfold: [0.85, "cubic-bezier(.25,.9,.3,1.1)"],
    turnin: [0.9, "cubic-bezier(.2,.9,.3,1.05)"],
    popup: [0.95, "cubic-bezier(.2,1.15,.35,1)"]
  };
  var ANIM_LOOP = {
    none: null,
    boil: [0.36, "step-end"],
    bob: [3.2, "ease-in-out"],
    sway: [5.5, "ease-in-out"],
    turn: [9, "linear"],
    pulse: [2.6, "ease-in-out"]
  };

  function applyAnim(node, el) {
    var a = el.anim || {};
    var into = ANIM_IN[a["in"]] ? a["in"] : "none";
    var loop = ANIM_LOOP[a.loop] ? a.loop : "none";
    var spd = a.spd > 0 ? Math.min(4, Math.max(0.25, a.spd)) : 1;
    var delay = Math.min(10, Math.max(0, a.delay || 0));

    node.dataset["in"] = into;
    node.dataset.loop = loop;
    /* The rotation the element already has, handed to the keyframes so a
     * spin can happen to something that was drawn on a slant. */
    node.style.setProperty("--rot", (el.rot || 0) + "deg");

    var inSecs = 0;
    if (into !== "none") {
      var spec = ANIM_IN[into];
      inSecs = spec[0] / spd;
      /* The paths draw themselves on their own timer, in CSS, so it needs
       * the same numbers the box is using. */
      node.style.setProperty("--draw-secs", inSecs.toFixed(3) + "s");
      node.style.setProperty("--draw-delay", delay.toFixed(2) + "s");
      node.style.setProperty("--anim-in",
        "chalk-in-" + into + " " + inSecs.toFixed(3) + "s " + spec[1] + " " +
        delay.toFixed(2) + "s both");
    } else {
      node.style.removeProperty("--anim-in");
    }

    if (loop !== "none") {
      var lspec = ANIM_LOOP[loop];
      /* The loop waits for the entrance. Two animations touching the same
       * property means the later one wins outright, so without the wait a
       * bob would flatten the pop it was meant to follow. */
      node.style.setProperty("--anim-loop",
        "chalk-loop-" + loop + " " + (lspec[0] / spd).toFixed(3) + "s " +
        lspec[1] + " " + (delay + inSecs).toFixed(3) + "s infinite");
      if (loop === "boil") ensureBoil();
    } else {
      node.style.removeProperty("--anim-loop");
    }

    /* Playing it again: the counter changes, the animation is restarted. */
    var n = Math.round(a.n || 0);
    if (node.dataset.animN !== String(n)) {
      node.dataset.animN = String(n);
      if (into !== "none") {
        node.style.animationName = "none";
        void node.offsetWidth;
        node.style.animationName = "";
      }
    }
  }

  /* ---- effects ------------------------------------------------------ */

  function applyFx(node, fx) {
    var filters = [], transforms = [];
    node.style.filter = "";
    node.style.transform = "";
    node.style.mixBlendMode = "";
    node.style.opacity = "";
    if (!fx) return;

    if (fx.shadow) {
      filters.push("drop-shadow(" + (fx.sx || 0) + "px " + (fx.sy || 4) + "px " +
        (fx.blur == null ? 8 : fx.blur) + "px " + (fx.shadowColor || "rgba(0,0,0,.55)") + ")");
    }
    if (fx.glow) {
      filters.push("drop-shadow(0 0 " + (fx.glowSize || 10) + "px " + (fx.glowColor || "#56b7e6") + ")");
    }
    /* Extruded depth: stacked hard shadows follow the real alpha outline, so it
     * works on a star or a letter, not just a box. */
    if (fx.extrude) {
      var steps = Math.min(24, Math.round(fx.extrude));
      var col = fx.extrudeColor || "rgba(0,0,0,.5)";
      for (var i = 1; i <= steps; i++) filters.push("drop-shadow(1px 1px 0 " + col + ")");
    }
    if (fx.softBlur) filters.push("blur(" + fx.softBlur + "px)");
    if (fx.tiltX || fx.tiltY) {
      transforms.push("perspective(" + (fx.perspective || 800) + "px)");
      if (fx.tiltX) transforms.push("rotateX(" + fx.tiltX + "deg)");
      if (fx.tiltY) transforms.push("rotateY(" + fx.tiltY + "deg)");
    }
    if (fx.flipH) transforms.push("scaleX(-1)");
    if (fx.flipV) transforms.push("scaleY(-1)");

    if (filters.length) node.style.filter = filters.join(" ");
    if (transforms.length) node.style.transform = transforms.join(" ");
    if (fx.blend && fx.blend !== "normal") node.style.mixBlendMode = fx.blend;
    if (fx.opacity != null && fx.opacity !== 1) node.style.opacity = fx.opacity;
  }

  /* ---- renderers ---------------------------------------------------- */

  /* The hand and the material, shared by anything that shows words — a text
   * element, and the words inside a card. */
  function writeWith(t, el, fallbackSize) {
    t.style.fontFamily = FONTS[el.font] || FONTS.sans;
    /* The texture is painted with a background rather than a colour, and by
     * then currentColor is transparent — so the colour goes in as its own
     * property for chalk_fonts.css to pick up. */
    var ink = INK[el.font] || "";
    if (ink) {
      t.dataset.ink = ink;
      t.style.setProperty("--ink", el.color || "#ffffff");
    } else {
      delete t.dataset.ink;
    }
    t.style.fontSize = "calc(var(--chalk-bh, 100px) * " +
      (el.size || fallbackSize || 0.06) + ")";
    t.style.color = el.color || "#ffffff";
    t.style.textAlign = el.align || "left";
    t.style.fontWeight = el.bold ? "700" : "400";
    t.style.fontStyle = el.italic ? "italic" : "normal";
  }

  function renderText(inner, el) {
    inner.textContent = "";
    var t = document.createElement("div");
    t.className = "chalk-text";
    /* textContent, never innerHTML — a lesson title is not markup. */
    t.textContent = el.text || "";
    writeWith(t, el, 0.06);
    if (el.bg) {
      t.style.background = el.bg;
      t.style.padding = ".25em .5em";
      t.style.borderRadius = ".25em";
    }
    if (!el.text) {
      t.classList.add("is-empty");
      t.textContent = "Type on your phone";
    }
    inner.appendChild(t);
  }

  /* A photo that cannot be fetched used to render as an empty box: the
   * element was on the board, the frame was on the board, and the picture
   * simply was not. Nothing anywhere said why. The two usual causes are a
   * media root the web server is not serving and a MEDIA_URL the board never
   * stored, and both look identical from the classroom. So say it on the
   * board itself, and put the path in the title for whoever is fixing it. */
  function renderImage(inner, el) {
    var img = inner.firstChild;
    if (!img || img.tagName !== "IMG") {
      inner.textContent = "";
      img = document.createElement("img");
      img.alt = "";
      img.draggable = false;
      img.decoding = "async";
      inner.appendChild(img);
    }
    var box = inner.parentNode;
    if (img.getAttribute("src") !== (el.src || "")) {
      img.onload = function () {
        if (box) box.dataset.img = "ok";
      };
      img.onerror = function () {
        if (box) {
          box.dataset.img = "err";
          box.title = "This photo could not be loaded: " + (el.src || "(no address)");
        }
      };
      if (box) box.dataset.img = el.src ? "loading" : "err";
      /* Setting src to "" makes the browser re-request the page itself, so
       * an element with no photo yet is left with no src at all. */
      if (el.src) img.setAttribute("src", el.src);
      else img.removeAttribute("src");
    }
    img.style.objectFit = el.fit === "cover" ? "cover" : "contain";
    img.style.borderRadius = (el.radius || 0) + "%";
  }

  function paintParts(svg, parts, el) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var fill = el.fillOn === false ? "none" : (el.fill || "none");
    parts.forEach(function (part) {
      var p = document.createElementNS(SVGNS, "path");
      p.setAttribute("d", part.d);
      /* Every path is one unit long as far as the dash array is concerned,
       * so "draw yourself on" is one line of CSS and needs no measuring —
       * which matters, because getTotalLength on twenty shapes at once is a
       * layout stall on the projector. */
      p.setAttribute("pathLength", "1");
      if (part.rule) p.setAttribute("fill-rule", part.rule);

      if (part.role === "line") {
        p.setAttribute("fill", "none");
      } else if (part.role === "linefill") {
        p.setAttribute("fill", el.stroke || "#ffffff");
      } else if (part.role === "side") {
        p.setAttribute("fill", fill === "none" ? "none" : shade(el.fill, -0.32));
      } else if (part.role === "top") {
        p.setAttribute("fill", fill === "none" ? "none" : shade(el.fill, 0.24));
      } else {
        p.setAttribute("fill", fill);
      }

      if (part.role === "linefill") {
        p.setAttribute("stroke", "none");
      } else if (el.strokeW > 0) {
        p.setAttribute("stroke", el.stroke || "#ffffff");
        p.setAttribute("stroke-width", el.strokeW);
        p.setAttribute("stroke-linejoin", "round");
        p.setAttribute("stroke-linecap", "round");
        /* Shapes are stretched non-uniformly, so keep the outline even. */
        p.setAttribute("vector-effect", "non-scaling-stroke");
        if (el.dash) p.setAttribute("stroke-dasharray", el.dash + " " + el.dash * 0.8);
      } else {
        p.setAttribute("stroke", "none");
      }
      svg.appendChild(p);
    });
  }

  function ensureSvg(inner) {
    var svg = inner.firstChild;
    if (!svg || svg.tagName !== "svg") {
      inner.textContent = "";
      svg = document.createElementNS(SVGNS, "svg");
      svg.setAttribute("viewBox", "0 0 100 100");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("class", "chalk-svg");
      inner.appendChild(svg);
    }
    return svg;
  }

  function renderShape(inner, el) {
    paintParts(ensureSvg(inner), ChalkShapes.build(el.shape, el).parts, el);
  }

  function renderFreeform(inner, el) {
    var d = ChalkShapes.pathFromPoints(el.pts || [], el.closed !== false, el.edge, el.radius);
    paintParts(ensureSvg(inner), [{ d: d, role: el.closed === false ? "line" : "face" }], el);
  }

  /* A card: a box with a number on its edge and room to write in it. The
   * numbered row of them across the top of a lesson is the thing people draw
   * by hand every single time, so it is one object rather than a rectangle,
   * a text box and a little circle that have to be dragged about together.
   *
   * Everything is sized in em off the card's own text, so stretching the box
   * on the board keeps the badge in proportion with the words. */
  function renderCard(inner, el) {
    var card = inner.firstChild;
    if (!card || card.className !== "chalk-card") {
      inner.textContent = "";
      card = document.createElement("div");
      card.className = "chalk-card";
      card.appendChild(document.createElement("div")).className = "card-body";
      card.appendChild(document.createElement("span")).className = "card-num";
      inner.appendChild(card);
    }
    var body = card.firstChild, badge = card.lastChild;

    card.style.setProperty("--fill", el.fillOn === false ? "transparent" : (el.fill || "transparent"));
    card.style.setProperty("--stroke", el.stroke || "#56b7e6");
    card.style.setProperty("--accent", el.accent || el.stroke || "#56b7e6");
    card.style.setProperty("--sw", (el.strokeW == null ? 2 : el.strokeW) + "px");
    card.style.setProperty("--radius", (el.radius == null ? 14 : el.radius) + "px");
    card.style.setProperty("--dash", el.dash ? el.dash + "px" : "0");
    card.dataset.dashed = el.dash ? "1" : "0";

    var text = document.createElement("div");
    text.className = "chalk-text card-title";
    text.textContent = el.text || "";
    writeWith(text, el, 0.035);
    if (!el.text) {
      text.classList.add("is-empty");
      text.textContent = "Tap and type";
    }
    body.textContent = "";
    body.appendChild(text);

    var num = String(el.num == null ? "" : el.num).slice(0, 4);
    var where = el.numAt === "top" ? "top" : el.numAt === "none" ? "none" : "bottom";
    card.dataset.numat = where;
    badge.hidden = where === "none" || !num;
    badge.textContent = num;
    badge.style.fontSize = "calc(var(--chalk-bh, 100px) * " +
      ((el.size || 0.035) * 0.8) + ")";
  }

  /* A figure: a chalk drawing that arrives the way the thing itself would,
   * and then puts its own labels up.
   *
   * The whole plate lives in one 300x190 viewBox — drawing in the middle,
   * a gutter each side for the labels — so the leader lines are worked out
   * once here and never collide, whatever the figure.
   *
   * The animation is entirely in CSS. This builds the nodes, hands the
   * stylesheet its variables, and gets out of the way. The one thing it has
   * to do in script is rebuild when `play` changes: a CSS animation will not
   * run a second time on a node that has already finished it. */
  function renderFigure(inner, el) {
    var FIGS = global.ChalkFigures;
    if (!FIGS) { inner.textContent = "figures not loaded"; return; }
    var fig = FIGS.get(el.kind) || FIGS.get(FIGS.ids[0]);
    if (!fig) return;

    var V = FIGS.view;
    var stamp = [el.kind, el.play, el.enter, fig.parts.length].join("|");
    var root = inner.firstChild;

    if (!root || root.dataset.stamp !== stamp) {
      inner.textContent = "";
      root = document.createElementNS(SVGNS, "svg");
      root.setAttribute("viewBox", "0 0 " + V.w + " " + V.h);
      root.setAttribute("preserveAspectRatio", "xMidYMid meet");
      root.setAttribute("class", "chalk-figure");
      root.dataset.stamp = stamp;

      var art = document.createElementNS(SVGNS, "g");
      art.setAttribute("class", "fig-art");
      fig.parts.forEach(function (part) {
        var path = document.createElementNS(SVGNS, "path");
        path.setAttribute("d", part.d);
        path.setAttribute("class", "fig-part " + (part.cls || ""));
        art.appendChild(path);
      });
      root.appendChild(art);

      var labels = document.createElementNS(SVGNS, "g");
      labels.setAttribute("class", "fig-labels");
      fig.labels.forEach(function (lab, i) {
        var g = document.createElementNS(SVGNS, "g");
        g.setAttribute("class", "fig-label");
        g.style.setProperty("--i", i);
        g.dataset.i = i;

        var toX = lab.side === "l" ? V.gutterL + 10 : V.gutterR - 10;
        var endX = lab.side === "l" ? V.gutterL + 2 : V.gutterR - 2;
        var line = document.createElementNS(SVGNS, "path");
        line.setAttribute("class", "fig-leader");
        line.setAttribute("d", "M" + lab.at[0] + "," + lab.at[1] +
          " L" + toX + "," + lab.y + " L" + endX + "," + lab.y);
        g.appendChild(line);

        var dot = document.createElementNS(SVGNS, "circle");
        dot.setAttribute("class", "fig-dot");
        dot.setAttribute("cx", lab.at[0]);
        dot.setAttribute("cy", lab.at[1]);
        dot.setAttribute("r", 2.4);
        g.appendChild(dot);

        var t = document.createElementNS(SVGNS, "text");
        t.setAttribute("class", "fig-text");
        t.setAttribute("x", lab.side === "l" ? V.gutterL : V.gutterR);
        t.setAttribute("y", lab.y);
        t.setAttribute("text-anchor", lab.side === "l" ? "end" : "start");
        t.setAttribute("dominant-baseline", "middle");
        t.textContent = lab.t;
        g.appendChild(t);

        labels.appendChild(g);
      });
      root.appendChild(labels);
      inner.appendChild(root);
    }

    root.dataset.enter = el.enter || fig.enter;
    root.dataset.alive = el.alive === false ? "0" : "1";
    root.dataset.ground = fig.ground ? "1" : "0";
    root.style.setProperty("--speed", el.speed || 1);
    root.style.setProperty("--ink", el.stroke || el.color || "#ffffff");
    root.style.setProperty("--accent", el.accent || "#d9a441");
    root.style.setProperty("--sw", (el.strokeW == null ? 2 : el.strokeW));
    root.style.setProperty("--label-size", (el.size || 0.026) * 380);
    root.style.setProperty("--label-color", el.color || "#ffffff");
    root.style.setProperty("--fig-font", FONTS[el.font] || FONTS.sans);
    /* Turning it round is a rotation, so the labels have to be turned back
     * or they read backwards from the far side of the room. */
    root.dataset.flip = el.flip ? "1" : "0";

    /* The picker hands this back as a string, so the number has to be made
     * one before -1 can mean "all of them". */
    var want = Number(el.show);
    var upTo = want === -1 ? fig.labels.length : (want > 0 ? want : 0);
    var list = root.querySelectorAll(".fig-label");
    for (var i = 0; i < list.length; i++) {
      list[i].dataset.on = i < upTo ? "1" : "0";
    }
  }

  var RENDER = {
    text: renderText, image: renderImage, shape: renderShape,
    freeform: renderFreeform, card: renderCard, figure: renderFigure
  };

  /* ---- layer -------------------------------------------------------- */

  function Layer(host) {
    this.host = host;
    this.els = [];
    this.nodes = Object.create(null);
    this.view = { x: 0, y: 0, s: 1 };
    var self = this;
    this._sync = function () { self.resize(); };
    if (global.ResizeObserver) {
      this._ro = new ResizeObserver(this._sync);
      this._ro.observe(host);
    } else {
      global.addEventListener("resize", this._sync);
    }
    liveLayers.push(this);
    this.resize();
  }

  /* Text size is a fraction of board height, so the layer publishes its own
   * height as a CSS variable and font sizes follow it for free. */
  /* Nothing animates while it is being dragged. An element that bobs as you
   * line its corner up with a gridline is an element you cannot place. */
  Layer.prototype.setEditing = function (id) {
    var self = this;
    Object.keys(this.nodes).forEach(function (key) {
      if (key === id) self.nodes[key].dataset.editing = "1";
      else delete self.nodes[key].dataset.editing;
    });
  };

  Layer.prototype.resize = function () {
    var r = this.host.getBoundingClientRect();
    this.W = r.width; this.H = r.height;
    this.host.style.setProperty("--chalk-bh", (r.height / this.view.s) + "px");
  };

  Layer.prototype.setView = function (view) {
    this.view = { x: view.x, y: view.y, s: view.s };
    this.resize();
    this.els.forEach(this._place, this);
  };

  Layer.prototype.setEls = function (list) {
    var keep = Object.create(null);
    (list || []).forEach(function (el) { keep[el.id] = 1; });
    for (var id in this.nodes) {
      if (!keep[id]) { this.nodes[id].remove(); delete this.nodes[id]; }
    }
    this.els = (list || []).map(function (e) { return JSON.parse(JSON.stringify(e)); });
    this.els.forEach(this._draw, this);
  };

  Layer.prototype.get = function (id) {
    for (var i = 0; i < this.els.length; i++) if (this.els[i].id === id) return this.els[i];
    return null;
  };

  Layer.prototype.upsert = function (el) {
    var cur = this.get(el.id);
    if (cur) Object.assign(cur, el);
    else { cur = JSON.parse(JSON.stringify(el)); this.els.push(cur); }
    this._draw(cur);
    return cur;
  };

  Layer.prototype.patch = function (id, patch) {
    var cur = this.get(id);
    if (!cur) return null;
    Object.assign(cur, patch);
    this._draw(cur);
    return cur;
  };

  Layer.prototype.remove = function (ids) {
    var gone = Object.create(null);
    ids.forEach(function (i) { gone[i] = 1; });
    this.els = this.els.filter(function (e) { return !gone[e.id]; });
    ids.forEach(function (id) {
      if (this.nodes[id]) { this.nodes[id].remove(); delete this.nodes[id]; }
    }, this);
  };

  Layer.prototype.clear = function () {
    this.setEls([]);
  };

  /* Apply a server "els" op: delete these ids, insert these at these indices,
   * apply these field patches. Mirrors ChalkInk.Surface.applyOps, so undo on
   * a page full of photos costs a few hundred bytes instead of the page. */
  Layer.prototype.applyOps = function (add, del, edit) {
    var self = this;
    if (del && del.length) this.remove(del);
    if (add && add.length) {
      add.slice().sort(function (a, b) { return (a.i | 0) - (b.i | 0); })
        .forEach(function (item) {
          if (!item || !item.s) return;
          if (self.get(item.s.id)) return;
          var at = Math.max(0, Math.min(self.els.length, item.i | 0));
          var copy = JSON.parse(JSON.stringify(item.s));
          self.els.splice(at, 0, copy);
          self._draw(copy);
        });
      this._restack();
    }
    if (edit && edit.length) {
      edit.forEach(function (e) {
        var el = self.get(e.id);
        if (!el) return;
        (e.drop || []).forEach(function (k) { delete el[k]; });
        Object.assign(el, e.patch || {});
        self._draw(el);
      });
    }
  };

  /* The DOM order has to match the array order after an insert, or an
   * undone element comes back on top of things it used to sit behind. */
  Layer.prototype._restack = function () {
    this.els.forEach(function (el) {
      var node = this.nodes[el.id];
      if (node) this.host.appendChild(node);
    }, this);
  };

  Layer.prototype._node = function (el) {
    var node = this.nodes[el.id];
    if (!node) {
      node = document.createElement("div");
      node.className = "chalk-el";
      node.dataset.id = el.id;
      var inner = document.createElement("div");
      inner.className = "chalk-el-inner";
      node.appendChild(inner);
      this.host.appendChild(node);
      this.nodes[el.id] = node;
    }
    return node;
  };

  Layer.prototype._place = function (el) {
    var node = this.nodes[el.id];
    if (!node) return;
    var v = this.view;
    node.style.left = ((el.x - v.x) * v.s * 100) + "%";
    node.style.top = ((el.y - v.y) * v.s * 100) + "%";
    node.style.width = (el.w * v.s * 100) + "%";
    node.style.height = (el.h * v.s * 100) + "%";
    /* Always written, so every element is its own stacking context and a blend
     * mode has something real to blend against. */
    node.style.transform = "rotate(" + (el.rot || 0) + "deg)";
    /* Which side of the handwriting this object sits on. The bands are set
     * out in chalk.css by .chalk-layer. */
    if (el.top) node.dataset.top = "1";
    else delete node.dataset.top;
  };

  Layer.prototype._draw = function (el) {
    var node = this._node(el);
    node.dataset.type = el.type;
    this._place(el);
    var inner = node.firstChild;
    if (node.dataset.rendered !== el.type) {
      inner.textContent = "";
      node.dataset.rendered = el.type;
    }
    (RENDER[el.type] || RENDER.shape)(inner, el);
    /* Effects land on the inner node so the outer box keeps clean geometry for
     * dragging and handles; blend needs the outer node to have a backdrop. */
    applyFx(inner, el.fx);
    applyAnim(node, el);
    if (el.fx && el.fx.blend && el.fx.blend !== "normal") {
      node.style.mixBlendMode = el.fx.blend;
      inner.style.mixBlendMode = "";
    } else {
      node.style.mixBlendMode = "";
    }
    /* Outward effects paint beyond the box — don't let it crop them. */
    node.style.overflow = (el.fx && (el.fx.shadow || el.fx.glow || el.fx.extrude))
      ? "visible" : "";
  };

  /* Topmost element whose (rotated) box contains the normalised point. */
  Layer.prototype.hit = function (nx, ny) {
    for (var i = this.els.length - 1; i >= 0; i--) {
      var el = this.els[i];
      var cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      var px = nx - cx, py = ny - cy;
      if (el.rot) {
        var a = -el.rot * Math.PI / 180;
        var rx = px * Math.cos(a) - py * Math.sin(a);
        var ry = px * Math.sin(a) + py * Math.cos(a);
        px = rx; py = ry;
      }
      if (Math.abs(px) <= el.w / 2 && Math.abs(py) <= el.h / 2) return el.id;
    }
    return null;
  };

  Layer.prototype.raise = function (id) {
    var el = this.get(id);
    if (!el) return;
    this.els = this.els.filter(function (e) { return e.id !== id; });
    this.els.push(el);
    if (this.nodes[id]) this.host.appendChild(this.nodes[id]);
  };

  /* Every layer on the page, so a bulk element frame can be applied without
   * the page's own message handler knowing the frame type exists — the same
   * arrangement ChalkInk uses for moved ink, and for the same reason: a
   * dropped frame does not look like a missing case, it looks like the
   * feature is broken. chalk_net.js calls this on every inbound frame. */
  var liveLayers = [];

  function applyElFrame(msg) {
    if (!msg || !liveLayers.length) return;
    if (msg.t !== "el_live_many" || !msg.items) return;
    msg.items.forEach(function (item) {
      if (!item || !item.id || !item.patch) return;
      liveLayers.forEach(function (l) { l.patch(item.id, item.patch); });
    });
  }

  global.ChalkEls = {
    Layer: Layer, blank: blank, newId: newId, FONTS: FONTS, shade: shade,
    INK: INK, FONT_LIST: FONT_LIST,
    applyFx: applyFx, applyElFrame: applyElFrame, layers: liveLayers
  };
})(window);
