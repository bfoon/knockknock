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

  var RENDER = {
    text: renderText, image: renderImage, shape: renderShape,
    freeform: renderFreeform, card: renderCard
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
