/* Chalk — shared ink engine.
 *
 * Strokes are stored in normalised board space (0..1 on both axes) so the same
 * page draws identically on a 5" phone pad and a 4K projector.
 *
 * Exposes window.ChalkInk = { TOOLS, smooth, drawStroke, hit, newId, Surface }
 */
(function (global) {
  "use strict";

  var TOOLS = {
    pen:         { alpha: 1.00, taper: true,  grain: 0, widthx: 1.00, cap: "round" },
    marker:      { alpha: 0.88, taper: false, grain: 0, widthx: 2.10, cap: "round" },
    chalk:       { alpha: 0.90, taper: false, grain: 1, widthx: 1.50, cap: "round" },
    highlighter: { alpha: 0.24, taper: false, grain: 0, widthx: 5.00, cap: "butt"  }
  };

  /* A live stroke with no stroke_end after this long is assumed lost — the
   * phone was closed, or a second finger orphaned it. Without this an
   * abandoned half-stroke sits on the projector for the rest of the lesson. */
  var LIVE_TTL_MS = 20000;

  var idSeed = 0;
  function newId() {
    idSeed = (idSeed + 1) % 100000;
    return "s" + Date.now().toString(36) + idSeed.toString(36);
  }

  /* Catmull-Rom resample of a flat [x,y,x,y] list into a denser flat list. */
  function smooth(pts, step) {
    var n = pts.length >> 1;
    if (n < 3) return pts.slice();
    step = step || 0.2;
    var out = [], i, t, t2, t3, a, b, c, d;
    for (i = 0; i < n - 1; i++) {
      var i0 = i > 0 ? i - 1 : 0, i1 = i, i2 = i + 1, i3 = i + 2 < n ? i + 2 : n - 1;
      var x0 = pts[i0 * 2], y0 = pts[i0 * 2 + 1];
      var x1 = pts[i1 * 2], y1 = pts[i1 * 2 + 1];
      var x2 = pts[i2 * 2], y2 = pts[i2 * 2 + 1];
      var x3 = pts[i3 * 2], y3 = pts[i3 * 2 + 1];
      for (t = 0; t < 1; t += step) {
        t2 = t * t; t3 = t2 * t;
        a = 2 * x1; b = -x0 + x2; c = 2 * x0 - 5 * x1 + 4 * x2 - x3; d = -x0 + 3 * x1 - 3 * x2 + x3;
        out.push(0.5 * (a + b * t + c * t2 + d * t3));
        a = 2 * y1; b = -y0 + y2; c = 2 * y0 - 5 * y1 + 4 * y2 - y3; d = -y0 + 3 * y1 - 3 * y2 + y3;
        out.push(0.5 * (a + b * t + c * t2 + d * t3));
      }
    }
    out.push(pts[(n - 1) * 2], pts[(n - 1) * 2 + 1]);
    return out;
  }

  function smoothed(s) {
    /* cache per stroke, invalidated when the point list grows */
    if (s._smN === s.pts.length && s._sm) return s._sm;
    s._sm = smooth(s.pts);
    s._smN = s.pts.length;
    return s._sm;
  }

  /* Chalk grain used Math.random() on every frame, so the dust crawled while
   * the stroke sat still. Seed it off the stroke instead: same stroke, same
   * speckles, every redraw. */
  function seededRandom(seed) {
    var v = seed >>> 0;
    return function () {
      v = (v * 1664525 + 1013904223) >>> 0;
      return v / 4294967296;
    };
  }

  function seedOf(s) {
    if (s._seed !== undefined) return s._seed;
    var h = 2166136261, id = String(s.id || "");
    for (var i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    s._seed = h;
    return h;
  }

  /* view = {x, y, s} — the normalised top-left of the visible window and its
   * magnification. Stage always uses {0,0,1}; the phone pad zooms in. */
  function pxX(n, view, W) { return (n - view.x) * view.s * W; }
  function pxY(n, view, H) { return (n - view.y) * view.s * H; }

  function drawStroke(ctx, s, view, W, H) {
    var cfg = TOOLS[s.tool] || TOOLS.pen;
    var pts = smoothed(s);
    if (pts.length < 4) return;
    var base = Math.max(0.6, s.w * W * view.s * cfg.widthx);

    ctx.save();
    ctx.globalAlpha = cfg.alpha;
    ctx.strokeStyle = s.color;
    ctx.lineCap = cfg.cap;
    ctx.lineJoin = "round";

    if (cfg.taper) {
      /* Width follows speed: fast strokes thin out, like a real pen. */
      var prev = base, i, x0, y0, x1, y1, dist, w;
      for (i = 2; i < pts.length; i += 2) {
        x0 = pxX(pts[i - 2], view, W); y0 = pxY(pts[i - 1], view, H);
        x1 = pxX(pts[i], view, W);     y1 = pxY(pts[i + 1], view, H);
        dist = Math.hypot(x1 - x0, y1 - y0);
        w = base * (1.18 - 0.5 * Math.min(1, dist / 26));
        prev = prev * 0.75 + w * 0.25;
        ctx.beginPath();
        ctx.lineWidth = prev;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.lineWidth = base;
      ctx.moveTo(pxX(pts[0], view, W), pxY(pts[1], view, H));
      for (var j = 2; j < pts.length; j += 2) {
        ctx.lineTo(pxX(pts[j], view, W), pxY(pts[j + 1], view, H));
      }
      ctx.stroke();
    }

    if (cfg.grain) {
      /* Chalk dust: scatter along the path so a blackboard reads as chalk,
       * not as a glowing neon line. */
      var rnd = seededRandom(seedOf(s));
      ctx.globalAlpha = cfg.alpha * 0.35;
      ctx.fillStyle = s.color;
      var spread = base * 0.62;
      var dot = Math.max(0.7, base * 0.16);
      for (var k = 0; k < pts.length; k += 4) {
        var cx = pxX(pts[k], view, W), cy = pxY(pts[k + 1], view, H);
        for (var g = 0; g < 3; g++) {
          ctx.fillRect(
            cx + (rnd() - 0.5) * spread * 2,
            cy + (rnd() - 0.5) * spread * 2,
            dot,
            dot
          );
        }
      }
    }
    ctx.restore();
  }

  /* Distance from a normalised point to a stroke, in normalised units. */
  function distToStroke(s, nx, ny) {
    var p = s.pts, best = Infinity, i;
    for (i = 2; i < p.length; i += 2) {
      var ax = p[i - 2], ay = p[i - 1], bx = p[i], by = p[i + 1];
      var vx = bx - ax, vy = by - ay;
      var len2 = vx * vx + vy * vy;
      var t = len2 ? ((nx - ax) * vx + (ny - ay) * vy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      var dx = nx - (ax + t * vx), dy = ny - (ay + t * vy);
      var d = Math.hypot(dx, dy);
      if (d < best) best = d;
    }
    if (p.length === 2) best = Math.hypot(nx - p[0], ny - p[1]);
    return best;
  }

  /* Topmost stroke within `radius` of (nx, ny). */
  function hit(strokes, nx, ny, radius) {
    for (var i = strokes.length - 1; i >= 0; i--) {
      var s = strokes[i];
      var r = Math.max(radius, (s.w || 0.003) * 1.6);
      if (distToStroke(s, nx, ny) <= r) return s.id;
    }
    return null;
  }

  function copyStroke(s) {
    return {
      id: s.id, tool: s.tool, color: s.color,
      w: s.w, pts: (s.pts || []).slice()
    };
  }

  /* ------------------------------------------------------------------ */
  /* moving and resizing ink                                             */
  /*                                                                     */
  /* A stroke is a flat point list, so "move this handwriting" is just an */
  /* affine map over those points. The matrix is [a,b,c,d,e,f], the same  */
  /* order SVG uses:                                                      */
  /*     x' = a*x + c*y + e                                               */
  /*     y' = b*x + d*y + f                                               */
  /* One matrix moves, scales and rotates in a single step, and it is six */
  /* numbers on the wire whatever the selection weighs.                   */
  /* ------------------------------------------------------------------ */

  function mapPoints(pts, m) {
    var out = new Array(pts.length);
    for (var i = 0; i < pts.length; i += 2) {
      var x = pts[i], y = pts[i + 1];
      /* Ink may be dragged past the edge of the board on the way somewhere
       * else. Clamp wide rather than to 0..1, which would flatten a stroke
       * against the edge and lose its shape for good. */
      out[i] = Math.round(Math.min(2, Math.max(-1, m[0] * x + m[2] * y + m[4])) * 10000) / 10000;
      out[i + 1] = Math.round(Math.min(2, Math.max(-1, m[1] * x + m[3] * y + m[5])) * 10000) / 10000;
    }
    return out;
  }

  /* How much the matrix scales area, as a single linear factor. Used to
   * carry stroke width along with a resize — handwriting scaled to twice the
   * size with the same hairline width reads as a different pen. */
  function matrixScale(m) {
    var det = Math.abs(m[0] * m[3] - m[1] * m[2]);
    var s = Math.sqrt(det);
    return s > 0.0001 && s < 10000 ? s : 1;
  }

  function boundsOf(list) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    list.forEach(function (s) {
      var p = s.pts || [];
      for (var i = 0; i < p.length; i += 2) {
        if (p[i] < minX) minX = p[i];
        if (p[i] > maxX) maxX = p[i];
        if (p[i + 1] < minY) minY = p[i + 1];
        if (p[i + 1] > maxY) maxY = p[i + 1];
      }
    });
    if (minX === Infinity) return null;
    /* Never hand back a zero-width box: a single dot would give a scale
     * factor of infinity the moment somebody grabbed a corner. */
    var pad = 0.004;
    return {
      x: minX - pad, y: minY - pad,
      w: Math.max(0.012, maxX - minX + pad * 2),
      h: Math.max(0.012, maxY - minY + pad * 2)
    };
  }

  /* ------------------------------------------------------------------ */
  /* Surface: two stacked canvases — committed ink and the in-flight stroke. */
  /* ------------------------------------------------------------------ */

  /* Every surface on the page, so a moved-ink frame can be applied without
   * the page's own message handler knowing the frame type exists. See
   * applyInkFrame below. */
  var liveSurfaces = [];

  function Surface(host) {
    this.host = host;
    this.strokes = [];
    this.live = Object.create(null);
    this.view = { x: 0, y: 0, s: 1 };
    this.dpr = Math.min(global.devicePixelRatio || 1, 2.5);

    this.base = document.createElement("canvas");
    this.base.className = "chalk-layer chalk-layer-base";
    this.top = document.createElement("canvas");
    this.top.className = "chalk-layer chalk-layer-live";
    host.appendChild(this.base);
    host.appendChild(this.top);

    this.bctx = this.base.getContext("2d");
    this.tctx = this.top.getContext("2d");

    this._liveDirty = false;
    this._rect = null;
    this._reapAt = 0;
    this._tick = this._tick.bind(this);
    this.resize();

    var self = this;
    if (global.ResizeObserver) {
      this._ro = new ResizeObserver(function () { self.resize(); });
      this._ro.observe(host);
    } else {
      global.addEventListener("resize", function () { self.resize(); });
    }
    /* The cached rect is also invalidated by scrolling, which no observer
     * reports. Both listeners are passive; neither blocks the compositor. */
    global.addEventListener("scroll", function () { self._rect = null; }, true);
    global.addEventListener("orientationchange", function () { self._rect = null; });

    liveSurfaces.push(this);
    requestAnimationFrame(this._tick);
  }

  Surface.prototype.resize = function () {
    var r = this.host.getBoundingClientRect();
    this._rect = r;
    this.W = Math.max(1, Math.round(r.width));
    this.H = Math.max(1, Math.round(r.height));
    [this.base, this.top].forEach(function (c) {
      c.width = Math.round(this.W * this.dpr);
      c.height = Math.round(this.H * this.dpr);
      c.style.width = this.W + "px";
      c.style.height = this.H + "px";
    }, this);
    this.bctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.tctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.redrawBase();
    this._liveDirty = true;
  };

  /* Cached because moveLaser used to call getBoundingClientRect up to 50
   * times a second, forcing a layout on every laser frame. */
  Surface.prototype.rect = function () {
    if (!this._rect) this._rect = this.host.getBoundingClientRect();
    return this._rect;
  };

  Surface.prototype.setView = function (view) {
    this.view = { x: view.x, y: view.y, s: view.s };
    this.redrawBase();
    this._liveDirty = true;
  };

  Surface.prototype.setStrokes = function (list) {
    this.strokes = (list || []).map(copyStroke);
    this.live = Object.create(null);
    this.dropXformBase();
    this.redrawBase();
    this._liveDirty = true;
  };

  Surface.prototype.redrawBase = function () {
    if (!this.W) return;
    this.bctx.clearRect(0, 0, this.W, this.H);
    for (var i = 0; i < this.strokes.length; i++) {
      drawStroke(this.bctx, this.strokes[i], this.view, this.W, this.H);
    }
  };

  Surface.prototype._tick = function (now) {
    if (this._liveDirty) {
      this._liveDirty = false;
      this.tctx.clearRect(0, 0, this.W, this.H);
      for (var k in this.live) {
        drawStroke(this.tctx, this.live[k], this.view, this.W, this.H);
      }
    }
    /* Sweep abandoned live strokes once a second. */
    if (!now || now - this._reapAt > 1000) {
      this._reapAt = now || 0;
      this.reapLive();
    }
    requestAnimationFrame(this._tick);
  };

  Surface.prototype.begin = function (stroke) {
    var s = copyStroke(stroke);
    s._born = Date.now();
    this.live[stroke.id] = s;
    this._liveDirty = true;
  };

  Surface.prototype.extend = function (id, pts) {
    var s = this.live[id];
    if (!s) return;
    for (var i = 0; i < pts.length; i++) s.pts.push(pts[i]);
    s._born = Date.now();
    this._liveDirty = true;
  };

  Surface.prototype.commit = function (stroke) {
    delete this.live[stroke.id];
    if (!this.strokes.some(function (s) { return s.id === stroke.id; })) {
      var s = copyStroke(stroke);
      this.strokes.push(s);
      drawStroke(this.bctx, s, this.view, this.W, this.H);
    }
    this._liveDirty = true;
  };

  /* Drop an in-flight stroke without committing it. */
  Surface.prototype.abandon = function (id) {
    if (this.live[id]) {
      delete this.live[id];
      this._liveDirty = true;
    }
  };

  Surface.prototype.reapLive = function () {
    var cutoff = Date.now() - LIVE_TTL_MS, dropped = false;
    for (var k in this.live) {
      if ((this.live[k]._born || 0) < cutoff) {
        delete this.live[k];
        dropped = true;
      }
    }
    if (dropped) this._liveDirty = true;
  };

  Surface.prototype.remove = function (ids) {
    var gone = {};
    ids.forEach(function (i) { gone[i] = 1; });
    var before = this.strokes.length;
    this.strokes = this.strokes.filter(function (s) { return !gone[s.id]; });
    if (this.strokes.length !== before) { this.dropXformBase(); this.redrawBase(); }
  };

  Surface.prototype.byId = function (id) {
    for (var i = 0; i < this.strokes.length; i++) {
      if (this.strokes[i].id === id) return this.strokes[i];
    }
    return null;
  };

  /* Bounding box of a set of strokes, in normalised board space. */
  Surface.prototype.bboxOf = function (ids) {
    var self = this;
    var list = (ids || []).map(function (id) { return self.byId(id); })
      .filter(function (s) { return !!s; });
    return list.length ? boundsOf(list) : null;
  };

  /* Every stroke with at least one point inside `rect` ({x,y,w,h}). Touch,
   * not containment: a teacher lassoing a word should not have to enclose
   * the tail of every letter. */
  Surface.prototype.idsIn = function (rect) {
    var x2 = rect.x + rect.w, y2 = rect.y + rect.h, out = [];
    this.strokes.forEach(function (s) {
      var p = s.pts || [];
      for (var i = 0; i < p.length; i += 2) {
        if (p[i] >= rect.x && p[i] <= x2 && p[i + 1] >= rect.y && p[i + 1] <= y2) {
          out.push(s.id);
          return;
        }
      }
    });
    return out;
  };

  Surface.prototype.allIds = function () {
    return this.strokes.map(function (s) { return s.id; });
  };

  /* --- transform ------------------------------------------------------
   *
   * Every frame of a drag sends the SAME matrix shape: the map from where
   * the ink was when the finger went down to where it is now. So the base
   * has to be remembered, keyed by `sel` — one id per gesture. Applying the
   * same (sel, matrix) twice is then a no-op rather than a double move,
   * which is what makes the mid-drag broadcast and the committed frame safe
   * to both arrive at the same screen.
   */

  Surface.prototype._baseFor = function (sel, ids) {
    if (this._xsel === sel && this._xbase) return this._xbase;
    var base = Object.create(null), self = this;
    (ids || []).forEach(function (id) {
      var s = self.byId(id);
      if (s) base[id] = { pts: s.pts.slice(), w: s.w };
    });
    this._xsel = sel;
    this._xbase = base;
    return base;
  };

  /* A committed move is applied exactly once per gesture, wherever it comes
   * from. The phone that made the move has already drawn it, so it claims
   * the gesture before sending; the echo then lands here and is ignored. */
  Surface.prototype.markXformDone = function (sel) {
    if (!this._xdone) this._xdone = Object.create(null);
    this._xdone[sel] = 1;
    var keys = Object.keys(this._xdone);
    if (keys.length > 80) delete this._xdone[keys[0]];
  };

  Surface.prototype.xformOnce = function (sel, ids, m) {
    if (!this._xdone) this._xdone = Object.create(null);
    if (this._xdone[sel]) return false;
    var moved = this.xform(sel, ids, m);
    this.markXformDone(sel);
    return moved;
  };

  Surface.prototype.dropXformBase = function () {
    this._xsel = null;
    this._xbase = null;
  };

  Surface.prototype.xform = function (sel, ids, m) {
    if (!m || m.length !== 6) return false;
    var base = this._baseFor(sel, ids);
    var ws = matrixScale(m), moved = false, self = this;
    (ids || []).forEach(function (id) {
      var s = self.byId(id), b = base[id];
      if (!s || !b) return;
      s.pts = mapPoints(b.pts, m);
      s.w = Math.min(0.12, Math.max(0.0004, b.w * ws));
      /* The smoothing cache is keyed on point COUNT, which a transform does
       * not change. Without this the projector redraws the old curve at the
       * new width and the ink appears not to move at all. */
      s._sm = null;
      s._smN = -1;
      moved = true;
    });
    if (moved) {
      this.redrawBase();
      this._liveDirty = true;
    }
    return moved;
  };

  /* Apply a server "ink" op: delete these ids, insert these strokes at these
   * indices, move these ones. Replaces the old full-page snapshot on every
   * undo/redo. */
  Surface.prototype.applyOps = function (add, del, xform) {
    var changed = false;
    if (del && del.length) {
      var gone = {};
      del.forEach(function (i) { gone[i] = 1; });
      var before = this.strokes.length;
      this.strokes = this.strokes.filter(function (s) { return !gone[s.id]; });
      changed = changed || this.strokes.length !== before;
    }
    if (add && add.length) {
      var self = this;
      add.forEach(function (item) {
        if (!item || !item.s) return;
        if (self.strokes.some(function (s) { return s.id === item.s.id; })) return;
        var at = Math.max(0, Math.min(self.strokes.length, item.i | 0));
        self.strokes.splice(at, 0, copyStroke(item.s));
        changed = true;
      });
    }
    if (changed) {
      /* Inserting or removing strokes invalidates any half-finished drag:
       * the base was captured against a page that no longer exists. */
      this.dropXformBase();
      this.redrawBase();
      this._liveDirty = true;
    }
    if (xform && xform.length) {
      var self2 = this;
      xform.forEach(function (op) {
        if (op && self2.xformOnce(op.sel, op.ids, op.m)) changed = true;
      });
    }
    return changed;
  };

  Surface.prototype.clear = function () {
    this.strokes = [];
    this.live = Object.create(null);
    this.dropXformBase();
    this.redrawBase();
    this._liveDirty = true;
  };

  Surface.prototype.hit = function (nx, ny, radius) {
    return hit(this.strokes, nx, ny, radius);
  };

  /* Screen point -> normalised board point, honouring the zoom window. */
  Surface.prototype.toBoard = function (clientX, clientY) {
    var r = this.rect();
    return {
      x: this.view.x + ((clientX - r.left) / Math.max(1, r.width)) / this.view.s,
      y: this.view.y + ((clientY - r.top) / Math.max(1, r.height)) / this.view.s
    };
  };

  /* ------------------------------------------------------------------ */
  /* moved-ink frames, applied for any page that loads this file          */
  /*                                                                      */
  /* chalk_net.js calls this on every inbound frame, before handing it to  */
  /* the page. The projector therefore follows moved handwriting without   */
  /* a case for it in its own switch — which matters because a page whose  */
  /* handler drops these frames does not look broken, it looks like the    */
  /* feature simply does not work on the wall.                             */
  /*                                                                      */
  /* Applying twice is safe: `sel` identifies the gesture, the surface     */
  /* remembers the ink as it was when that gesture began, and a committed  */
  /* one is claimed once and then ignored. So a page that DOES handle      */
  /* these frames itself loses nothing.                                    */
  /* ------------------------------------------------------------------ */

  function applyInkFrame(msg) {
    if (!msg || !liveSurfaces.length) return;
    if (msg.t === "ink_live") {
      liveSurfaces.forEach(function (s) { s.xform(msg.sel, msg.ids, msg.m); });
      return;
    }
    if (msg.t === "ink" && msg.xform && msg.xform.length) {
      msg.xform.forEach(function (op) {
        if (!op) return;
        liveSurfaces.forEach(function (s) { s.xformOnce(op.sel, op.ids, op.m); });
      });
    }
  }

  global.ChalkInk = {
    TOOLS: TOOLS,
    smooth: smooth,
    drawStroke: drawStroke,
    hit: hit,
    newId: newId,
    bounds: boundsOf,
    applyInkFrame: applyInkFrame,
    surfaces: liveSurfaces,
    mapPoints: mapPoints,
    matrixScale: matrixScale,
    Surface: Surface
  };
})(window);
