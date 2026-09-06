/* chart_fx.js — Knock-Knock animated result charts.
 *
 * Drops in behind the existing renderers: it wraps window.kkRenderExtraChart,
 * handles the chart ids it knows about, and hands everything else back to
 * whatever chart_extra.js / chart_preview.js already do.
 *
 * Load order in present.html:
 *     chart_preview.js  →  chart_extra.js  →  chart_fx.js  →  present.js
 *
 * Chart ids handled here:
 *     answer_bubbles   every single answer is its own floating bubble
 *     bubble_groups    the same bubbles, but they swarm into per-option columns
 *     dot_matrix       one dot per respondent, staggered pop-in
 *     bee_swarm        every numeric answer as a dot + a live average line
 *     radial_bar       nightingale rose with a counting core
 *     packed_circles   circle pack, spring-settled
 *     hero_number      giant count-up of the leading answer
 *     racing_bars      bars that overtake each other as votes land
 *     liquid_fill      pillars that fill with a moving wave
 *
 * Everything is one <canvas> per scene plus a small HTML overlay for legends,
 * so there is no new dependency. Data updates diff against what is already on
 * screen: an incoming answer pops in on its own, the rest keep their positions.
 *
 * Escape hatches:
 *     window.KK_FX_CONFIG = { disabled: ["dot_matrix"], maxAtoms: 400 }
 */

(function () {
  "use strict";

  var CFG = window.KK_FX_CONFIG || {};
  var DISABLED = CFG.disabled || [];
  var MAX_ATOMS = CFG.maxAtoms || 360;

  var REDUCED = !!(window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* ══════════════════════════ small helpers ══════════════════════════ */

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) {
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  /* Deterministic per-key jitter, so a bubble lands in the same spot on a
     re-render instead of jumping around every time a tally arrives. */
  function hash(str) {
    var h = 2166136261;
    str = String(str);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  /* Critically-ish damped spring. obj[key] is position, obj[key+"_v"] velocity. */
  function spring(obj, key, target, dt, stiffness, damping) {
    var k = stiffness == null ? 140 : stiffness;
    var d = damping == null ? 18 : damping;
    var vKey = key + "_v";
    var v = obj[vKey] || 0;
    var x = obj[key] || 0;
    // sub-step so a dropped frame can't blow the spring up
    var steps = Math.max(1, Math.ceil(dt / 0.016));
    var h = dt / steps;
    for (var i = 0; i < steps; i++) {
      var a = (target - x) * k - v * d;
      v += a * h;
      x += v * h;
    }
    obj[key] = x;
    obj[vKey] = v;
    return x;
  }

  function hexToRgb(hex) {
    var h = String(hex || "").trim();
    if (h[0] === "#") h = h.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (isNaN(n)) return { r: 124, g: 58, b: 237 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgba(hex, alpha) {
    var c = hexToRgb(hex);
    return "rgba(" + c.r + "," + c.g + "," + c.b + "," + alpha + ")";
  }

  function shade(hex, amount) {           // amount -1..1
    var c = hexToRgb(hex);
    var f = amount < 0 ? 0 : 255;
    var p = Math.abs(amount);
    return "rgb(" +
      Math.round(lerp(c.r, f, p)) + "," +
      Math.round(lerp(c.g, f, p)) + "," +
      Math.round(lerp(c.b, f, p)) + ")";
  }

  function cssVar(el, name, fallback) {
    try {
      var v = getComputedStyle(el).getPropertyValue(name);
      v = (v || "").trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function roundRect(g, x, y, w, h, r) {
    var rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  function fitLabel(g, text, maxWidth) {
    var s = String(text == null ? "" : text);
    if (g.measureText(s).width <= maxWidth) return s;
    var lo = 0, hi = s.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (g.measureText(s.slice(0, mid) + "…").width <= maxWidth) lo = mid + 1;
      else hi = mid;
    }
    return lo <= 1 ? "" : s.slice(0, lo - 1) + "…";
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ══════════════════════════ theme ══════════════════════════ */

  /* Colours come from the live stage so per-questionnaire templates carry
     through. The extra hues are spaced round the wheel from the primary
     accent, which keeps eight options readable without hardcoding a palette
     that clashes with a template someone picks later. */
  function buildTheme(el) {
    var accent = cssVar(el, "--stage-accent", "") || cssVar(el, "--kk-accent", "#7c3aed");
    var accent2 = cssVar(el, "--stage-accent-2", "") || cssVar(el, "--kk-accent-2", "#22d3ee");
    var accent3 = cssVar(el, "--kk-accent-3", "#fb7185");
    var text = cssVar(el, "--stage-fg", "") || cssVar(el, "--kk-text", "#f5f6ff");
    var dim = cssVar(el, "--kk-text-dim", "#a0a0b8");
    var font = cssVar(el, "font-family", "") ||
      "Inter, system-ui, -apple-system, Segoe UI, sans-serif";

    var extra = ["#f59e0b", "#34d399", "#f472b6", "#60a5fa", "#a3e635", "#fb923c"];
    var series = [accent, accent2, accent3].concat(extra);

    return {
      accent: accent, accent2: accent2, text: text, dim: dim, font: font,
      series: series,
      colorFor: function (i) { return series[i % series.length]; },
    };
  }

  /* ══════════════════════════ styles ══════════════════════════ */

  function ensureStyles() {
    if (document.getElementById("kk-fx-styles")) return;
    var st = document.createElement("style");
    st.id = "kk-fx-styles";
    st.textContent = [
      ".kk-fx{position:absolute;inset:0;overflow:hidden;}",
      ".kk-fx-canvas{position:absolute;inset:0;width:100%;height:100%;display:block;}",
      ".kk-fx-overlay{position:absolute;inset:0;pointer-events:none;}",
      ".kk-fx-legend{position:absolute;left:0;right:0;bottom:10px;display:flex;",
      "  flex-wrap:wrap;justify-content:center;gap:.4rem .55rem;padding:0 1rem;}",
      ".kk-fx-chip{display:inline-flex;align-items:center;gap:.45rem;",
      "  padding:.3rem .7rem;border-radius:999px;font-size:.85rem;font-weight:600;",
      "  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.10);",
      "  backdrop-filter:blur(6px);white-space:nowrap;}",
      ".kk-fx-chip i{width:.6rem;height:.6rem;border-radius:50%;display:block;}",
      ".kk-fx-chip b{font-variant-numeric:tabular-nums;opacity:.95;}",
      ".kk-fx-total{position:absolute;top:12px;right:16px;display:flex;",
      "  align-items:baseline;gap:.4rem;padding:.35rem .8rem;border-radius:999px;",
      "  background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.10);",
      "  font-size:.8rem;letter-spacing:.02em;}",
      ".kk-fx-total b{font-size:1.15rem;font-variant-numeric:tabular-nums;}",
      ".kk-fx-total.is-bump{animation:kkFxBump .45s cubic-bezier(.2,1.4,.4,1);}",
      "@keyframes kkFxBump{0%{transform:scale(1);}40%{transform:scale(1.16);}100%{transform:scale(1);}}",
      ".kk-fx-empty{position:absolute;inset:0;display:grid;place-items:center;",
      "  font-size:1.05rem;opacity:.55;text-align:center;padding:2rem;}",
      "@media (prefers-reduced-motion: reduce){.kk-fx-total.is-bump{animation:none;}}",
    ].join("\n");
    document.head.appendChild(st);
  }

  /* ══════════════════════════ data ══════════════════════════ */

  /* Turns whatever the consumer broadcast into two views of the same answers:
   *
   *   series  one entry per option / bucket, with a running count
   *   atoms   one entry per individual answer, with a stable key
   *
   * The key is what lets a bubble that is already on screen stay put while a
   * new one pops in, instead of the whole scene restarting on every tally.
   */
  function readData(ctx) {
    var q = ctx.question || {};
    var tally = ctx.tallyData || {};
    var counts = tally.counts || {};
    var choices = [];

    if (Array.isArray(ctx.labels) && ctx.labels.length && typeof ctx.labels[0] === "object") {
      choices = ctx.labels;
    } else if (Array.isArray(q.choices)) {
      choices = q.choices;
    }

    var series = [];
    var atoms = [];
    var seen = {};

    function pushAtoms(key, label, value, color, index, n) {
      for (var i = 0; i < n; i++) {
        atoms.push({
          key: key + "#" + i,
          label: label,
          value: value,
          color: color,
          group: index,
        });
      }
    }

    if (choices.length) {
      choices.forEach(function (c, i) {
        var id = String(c.id != null ? c.id : (c.value != null ? c.value : i));
        var n = Number(counts[id] != null ? counts[id] : (counts[c.id] || 0)) || 0;
        seen[id] = true;
        series.push({
          key: id, label: c.text != null ? c.text : (c.label || String(c)),
          value: n, index: i, image: c.image_url || c.image || "",
        });
        pushAtoms("c" + id, c.text != null ? c.text : c.label, n, null, i, n);
      });
    }

    /* Free-text answers: word cloud, open text, anything text-shaped. Each
       entry becomes its own atom so "one bubble per answer" stays literal. */
    var texts = Array.isArray(tally.texts) ? tally.texts : [];
    if (texts.length) {
      var byText = {};
      var order = [];
      // Text answers may sit alongside choice answers; offset their group
      // index so the two don't collide on the same colours.
      var groupOffset = series.length;
      texts.forEach(function (t, i) {
        var word, n = 1;
        if (t && typeof t === "object") {
          word = t.text != null ? t.text : (t.value != null ? t.value : "");
          n = Number(t.count != null ? t.count : 1) || 1;
        } else {
          word = t;
        }
        word = String(word == null ? "" : word).trim();
        if (!word) return;
        var norm = word.toLowerCase();
        if (byText[norm] == null) { byText[norm] = { label: word, value: 0 }; order.push(norm); }
        byText[norm].value += n;
        for (var k = 0; k < n; k++) {
          atoms.push({
            key: "t" + norm + "#" + (byText[norm].value - n + k),
            label: word, value: 1, color: null,
            group: groupOffset + order.indexOf(norm),
          });
        }
      });
      order.forEach(function (norm, i) {
        series.push({ key: "t" + norm, label: byText[norm].label, value: byText[norm].value, index: series.length });
      });
    }

    /* Numeric answers (scale / slider / nps / rating / numeric). */
    var values = [];
    if (Array.isArray(tally.values)) {
      values = tally.values.map(Number).filter(function (v) { return isFinite(v); });
    } else if (!choices.length && !texts.length) {
      // Some consumers ship numeric answers as a count map keyed by the value.
      Object.keys(counts).forEach(function (k) {
        var v = Number(k), n = Number(counts[k]) || 0;
        if (!isFinite(v)) return;
        for (var i = 0; i < n; i++) values.push(v);
      });
    }
    if (values.length && !atoms.length) {
      values.forEach(function (v, i) {
        atoms.push({ key: "n" + i + ":" + v, label: String(v), value: v, color: null, group: 0, numeric: true });
      });
      var buckets = {};
      values.forEach(function (v) { buckets[v] = (buckets[v] || 0) + 1; });
      Object.keys(buckets).sort(function (a, b) { return a - b; }).forEach(function (k, i) {
        series.push({ key: "n" + k, label: k, value: buckets[k], index: i });
      });
    }

    var total = atoms.length || series.reduce(function (a, s) { return a + s.value; }, 0);
    var truncated = 0;
    if (atoms.length > MAX_ATOMS) {
      truncated = atoms.length - MAX_ATOMS;
      atoms = atoms.slice(0, MAX_ATOMS);
    }

    return {
      series: series, atoms: atoms, values: values, total: total,
      truncated: truncated,
      questionText: q.text || "",
      questionType: ctx.questionType || q.type || "mcq",
    };
  }

  /* ══════════════════════════ scene base ══════════════════════════ */

  function Scene(host, data, ctx) {
    ensureStyles();
    this.host = host;
    this.data = data;
    this.ctx = ctx;

    this.wrap = document.createElement("div");
    this.wrap.className = "kk-fx";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "kk-fx-canvas";

    this.overlay = document.createElement("div");
    this.overlay.className = "kk-fx-overlay";

    this.wrap.appendChild(this.canvas);
    this.wrap.appendChild(this.overlay);
    host.appendChild(this.wrap);

    this.g = this.canvas.getContext("2d");
    this.theme = buildTheme(host.closest(".kk-stage") || host);
    this.w = 0; this.h = 0; this.dpr = 1;
    this.time = 0;
    this.lastTs = 0;
    this.ripples = [];
    this.lastTotal = 0;

    var self = this;
    this._tick = function (ts) { self.tick(ts); };

    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(function () { self.resize(); });
      this.ro.observe(this.wrap);
    } else {
      this._onWinResize = function () { self.resize(); };
      window.addEventListener("resize", this._onWinResize);
    }
    this.resize();
  }

  Scene.prototype.resize = function () {
    var r = this.wrap.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width));
    var h = Math.max(1, Math.round(r.height));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    if (this.onResize) this.onResize();
  };

  Scene.prototype.start = function () {
    this.lastTs = performance.now();
    this.raf = requestAnimationFrame(this._tick);
  };

  Scene.prototype.tick = function (ts) {
    /* present.js wipes #special-display when it switches views or hands the
       slide to another renderer. If our canvas is gone, so are we — this is
       what stops an orphan animation loop burning CPU behind a title slide. */
    if (!this.canvas.isConnected) { this.destroy(); return; }

    var dt = Math.min(0.05, (ts - this.lastTs) / 1000) || 0.016;
    this.lastTs = ts;
    this.time += dt;

    this.updateRipples(dt);
    if (this.update) this.update(dt);

    var g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    if (this.draw) this.draw(g, dt);
    this.drawRipples(g);

    this.raf = requestAnimationFrame(this._tick);
  };

  Scene.prototype.destroy = function () {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.ro) { try { this.ro.disconnect(); } catch (e) {} }
    if (this._onWinResize) window.removeEventListener("resize", this._onWinResize);
    if (this.wrap && this.wrap.parentNode) this.wrap.parentNode.removeChild(this.wrap);
  };

  Scene.prototype.setData = function (data) {
    this.data = data;
    if (this.onData) this.onData(data);
    this.bumpTotal(data.total);
  };

  /* A ring that expands where an answer landed. One cheap, shared "something
     just happened" cue across every scene. */
  Scene.prototype.ripple = function (x, y, color, size) {
    if (REDUCED) return;
    if (this.ripples.length > 24) this.ripples.shift();
    this.ripples.push({ x: x, y: y, color: color, r: (size || 20), t: 0 });
  };

  Scene.prototype.updateRipples = function (dt) {
    for (var i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].t += dt;
      if (this.ripples[i].t > 0.75) this.ripples.splice(i, 1);
    }
  };

  Scene.prototype.drawRipples = function (g) {
    for (var i = 0; i < this.ripples.length; i++) {
      var rp = this.ripples[i];
      var p = rp.t / 0.75;
      var r = rp.r * (1 + easeOutCubic(p) * 1.9);
      g.beginPath();
      g.arc(rp.x, rp.y, r, 0, Math.PI * 2);
      g.strokeStyle = rgba(rp.color || this.theme.accent2, 0.5 * (1 - p));
      g.lineWidth = 2.5 * (1 - p) + 0.5;
      g.stroke();
    }
  };

  Scene.prototype.totalPill = function (label) {
    if (!this.totalEl) {
      this.totalEl = document.createElement("div");
      this.totalEl.className = "kk-fx-total";
      this.overlay.appendChild(this.totalEl);
    }
    this.totalEl.innerHTML = "<b>" + (this.data.total || 0) + "</b><span>" +
      escapeHtml(label || (this.data.total === 1 ? "answer" : "answers")) + "</span>";
  };

  Scene.prototype.bumpTotal = function (total) {
    if (this.totalEl && total > this.lastTotal) {
      this.totalPill(this.totalLabel);
      var el = this.totalEl;
      el.classList.remove("is-bump");
      void el.offsetWidth;
      el.classList.add("is-bump");
    } else if (this.totalEl) {
      this.totalPill(this.totalLabel);
    }
    this.lastTotal = total;
  };

  Scene.prototype.legend = function (items) {
    if (!this.legendEl) {
      this.legendEl = document.createElement("div");
      this.legendEl.className = "kk-fx-legend";
      this.overlay.appendChild(this.legendEl);
    }
    var self = this;
    this.legendEl.innerHTML = items.map(function (s) {
      var pct = self.data.total ? Math.round(s.value / self.data.total * 100) : 0;
      return '<span class="kk-fx-chip"><i style="background:' +
        (s.color || self.theme.colorFor(s.index)) + '"></i>' +
        escapeHtml(s.label) + ' <b>' + s.value + '</b>' +
        '<span style="opacity:.6">' + pct + '%</span></span>';
    }).join("");
  };

  Scene.prototype.emptyState = function (msg) {
    if (!this.emptyEl) {
      this.emptyEl = document.createElement("div");
      this.emptyEl.className = "kk-fx-empty";
      this.overlay.appendChild(this.emptyEl);
    }
    this.emptyEl.textContent = msg || "";
    this.emptyEl.style.display = msg ? "grid" : "none";
  };

  function extend(Child, init, proto) {
    Child.prototype = Object.create(Scene.prototype);
    Child.prototype.constructor = Child;
    Object.keys(proto).forEach(function (k) { Child.prototype[k] = proto[k]; });
    return Child;
  }

  /* ══════════════════════════ 1 & 2 · answer bubbles ══════════════════════════
   *
   * One bubble per answer. Two layouts share the engine:
   *   free    bubbles drift in a loose cloud, lightly attracted to centre
   *   groups  bubbles swarm into a column above their option
   *
   * A bubble that is already on screen keeps its position and velocity when a
   * new tally arrives; only genuinely new answers spawn, from the bottom edge,
   * with a pop and a ripple. That is the whole point of the atom keys.
   */

  function BubbleScene(host, data, ctx, layout) {
    Scene.call(this, host, data, ctx);
    this.layout = layout || "free";
    this.bubbles = [];
    this.byKey = {};
    this.totalLabel = null;
    this.totalPill();
    this.onData(data);
  }

  extend(BubbleScene, null, {

    radiusFor: function (n) {
      var area = this.w * this.h;
      if (!area || !n) return 46;
      /* Bubbles keep a constant share of the canvas, so 6 answers read big and
         200 answers still fit without overlapping into mush. */
      var target = Math.sqrt(area * 0.30 / (Math.PI * n));
      return clamp(target, 9, this.layout === "groups" ? 54 : 78);
    },

    onResize: function () {
      if (this.bubbles) this.relayout();
    },

    relayout: function () {
      var self = this;
      this.groupCount = Math.max(1, this.data.series.length);
      this.baseR = this.radiusFor(Math.max(1, this.bubbles.length));
      this.bubbles.forEach(function (b) { b.tr = self.baseR * b.sizeJitter; });
    },

    onData: function (data) {
      var self = this;
      var next = [];
      var nextByKey = {};
      var isFirstFill = this.bubbles.length === 0;

      data.atoms.forEach(function (a) {
        var b = self.byKey[a.key];
        if (b) {
          b.label = a.label;
          b.group = a.group;
          b.dead = false;
        } else {
          var jx = hash(a.key + "x"), jy = hash(a.key + "y");
          b = {
            key: a.key, label: a.label, group: a.group,
            x: lerp(self.w * 0.15, self.w * 0.85, jx),
            y: self.h + 40 + jy * 60,
            vx: (jx - 0.5) * 40,
            vy: -60 - jy * 60,
            r: 0, tr: 24,
            sizeJitter: 0.82 + hash(a.key + "s") * 0.36,
            born: self.time,
            phase: hash(a.key + "p") * Math.PI * 2,
          };
          if (isFirstFill) {
            // First paint after a refresh: don't fountain 80 bubbles up the
            // screen, just place them where they belong and fade in.
            b.x = lerp(self.w * 0.2, self.w * 0.8, jx);
            b.y = lerp(self.h * 0.25, self.h * 0.75, jy);
            b.vy = 0;
          } else {
            self.ripple(b.x, self.h - 6, self.theme.colorFor(a.group), 14);
          }
        }
        next.push(b);
        nextByKey[a.key] = b;
      });

      this.bubbles = next;
      this.byKey = nextByKey;
      this.relayout();

      this.legend(data.series.filter(function (s) { return s.value > 0 || data.series.length <= 8; })
        .slice(0, 12)
        .map(function (s, i) { return { label: s.label, value: s.value, index: s.index != null ? s.index : i }; }));

      this.emptyState(data.total ? "" : "Waiting for the first answer…");
    },

    update: function (dt) {
      var self = this;
      var bs = this.bubbles;
      var n = bs.length;
      if (!n) return;

      var pad = 8;
      var floorY = this.h - (this.legendEl ? 52 : 16);
      var groupW = this.w / Math.max(1, this.data.series.length);

      for (var i = 0; i < n; i++) {
        var b = bs[i];
        var age = this.time - b.born;

        // grow into place
        b.r = lerp(b.r, b.tr, 1 - Math.pow(0.001, dt));

        var tx, ty;
        if (this.layout === "groups") {
          var col = (b.group + 0.5) * groupW;
          tx = col + Math.sin(b.phase + this.time * 0.6) * groupW * 0.12;
          ty = floorY - 40 - (hash(b.key + "h") * (this.h * 0.5));
        } else {
          tx = this.w / 2 + Math.cos(b.phase + this.time * 0.22) * this.w * 0.28;
          ty = this.h / 2 + Math.sin(b.phase * 1.7 + this.time * 0.19) * this.h * 0.28;
        }

        var k = this.layout === "groups" ? 3.2 : 1.1;
        b.vx += (tx - b.x) * k * dt;
        b.vy += (ty - b.y) * k * dt;

        if (!REDUCED) {
          b.vy += Math.sin(this.time * 1.3 + b.phase) * 6 * dt;   // idle buoyancy
        }

        var damp = Math.pow(0.06, dt);
        b.vx *= damp; b.vy *= damp;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        // walls
        if (b.x < b.r + pad) { b.x = b.r + pad; b.vx = Math.abs(b.vx) * 0.4; }
        if (b.x > this.w - b.r - pad) { b.x = this.w - b.r - pad; b.vx = -Math.abs(b.vx) * 0.4; }
        if (b.y < b.r + pad + 26) { b.y = b.r + pad + 26; b.vy = Math.abs(b.vy) * 0.4; }
        if (age > 0.6 && b.y > floorY - b.r) { b.y = floorY - b.r; b.vy = -Math.abs(b.vy) * 0.35; }
      }

      /* Separation. Two relaxation passes over a neighbour-limited loop: with
         a few hundred bubbles that is cheap enough at 60fps and stops the
         cluster collapsing into a single blob. */
      var passes = n > 180 ? 1 : 2;
      for (var pass = 0; pass < passes; pass++) {
        for (var a = 0; a < n; a++) {
          for (var c = a + 1; c < n; c++) {
            var p = bs[a], q = bs[c];
            var dx = q.x - p.x, dy = q.y - p.y;
            var min = p.r + q.r + 2;
            var d2 = dx * dx + dy * dy;
            if (d2 >= min * min || d2 === 0) continue;
            var d = Math.sqrt(d2);
            var push = (min - d) / d * 0.5;
            var ox = dx * push, oy = dy * push;
            p.x -= ox; p.y -= oy;
            q.x += ox; q.y += oy;
          }
        }
      }
    },

    draw: function (g) {
      var self = this;
      var bs = this.bubbles;

      for (var i = 0; i < bs.length; i++) {
        var b = bs[i];
        var color = this.theme.colorFor(b.group);
        var age = this.time - b.born;
        var pop = clamp(age / 0.45, 0, 1);
        var scale = REDUCED ? 1 : easeOutBack(pop);
        var r = Math.max(0.5, b.r * scale);

        // body
        var grad = g.createRadialGradient(
          b.x - r * 0.35, b.y - r * 0.4, r * 0.15,
          b.x, b.y, r
        );
        grad.addColorStop(0, rgba(shade(color, 0.35), 0.95));
        grad.addColorStop(1, rgba(color, 0.82));
        g.beginPath();
        g.arc(b.x, b.y, r, 0, Math.PI * 2);
        g.fillStyle = grad;
        g.fill();

        // rim + highlight give it volume without a drop shadow per bubble
        g.lineWidth = 1.2;
        g.strokeStyle = rgba("#ffffff", 0.22);
        g.stroke();

        g.beginPath();
        g.arc(b.x - r * 0.32, b.y - r * 0.36, r * 0.22, 0, Math.PI * 2);
        g.fillStyle = rgba("#ffffff", 0.28);
        g.fill();

        // label
        if (r > 17 && b.label) {
          var fs = clamp(r * 0.42, 9, 20);
          g.font = "700 " + fs + "px " + this.theme.font;
          g.textAlign = "center";
          g.textBaseline = "middle";
          var txt = fitLabel(g, b.label, r * 1.7);
          if (txt) {
            g.fillStyle = "#0b0b16";
            g.fillText(txt, b.x, b.y + 0.5);
            g.fillStyle = "rgba(255,255,255,.95)";
            g.fillText(txt, b.x, b.y - 0.5);
          }
        }
      }

      if (this.layout === "groups") this.drawGroupLabels(g);

      if (this.data.truncated) {
        g.font = "600 13px " + this.theme.font;
        g.textAlign = "left";
        g.fillStyle = rgba(this.theme.text, 0.5);
        g.fillText("+" + this.data.truncated + " more answers", 16, 24);
      }
    },

    drawGroupLabels: function (g) {
      var series = this.data.series;
      if (!series.length || series.length > 10) return;
      var groupW = this.w / series.length;
      var y = this.h - (this.legendEl ? 58 : 22);
      for (var i = 0; i < series.length; i++) {
        var x = (i + 0.5) * groupW;
        g.font = "700 " + clamp(groupW * 0.11, 11, 18) + "px " + this.theme.font;
        g.textAlign = "center";
        g.textBaseline = "alphabetic";
        g.fillStyle = rgba(this.theme.text, 0.62);
        g.fillText(fitLabel(g, series[i].label, groupW - 16), x, y);
      }
    },
  });

  /* ══════════════════════════ 3 · dot matrix ══════════════════════════ */

  function DotMatrix(host, data, ctx) {
    Scene.call(this, host, data, ctx);
    this.dots = [];
    this.byKey = {};
    this.totalPill();
    this.onData(data);
  }

  extend(DotMatrix, null, {
    /* Scene's constructor calls resize() before this subclass has built its
       arrays, so every onResize has to tolerate being called with nothing
       to lay out yet. */
    onResize: function () { if (this.dots) this.layoutDots(); },

    onData: function (data) {
      var self = this;
      var next = [], byKey = {};
      data.atoms.forEach(function (a) {
        var d = self.byKey[a.key];
        if (!d) {
          d = { key: a.key, group: a.group, label: a.label, born: self.time, x: 0, y: 0, r: 4 };
        }
        d.group = a.group;
        next.push(d);
        byKey[a.key] = d;
      });
      this.dots = next;
      this.byKey = byKey;
      this.layoutDots();
      this.legend(data.series.slice(0, 12).map(function (s, i) {
        return { label: s.label, value: s.value, index: s.index != null ? s.index : i };
      }));
      this.emptyState(data.total ? "" : "Every answer becomes a dot.");
    },

    layoutDots: function () {
      var n = this.dots.length;
      if (!n || !this.w) return;
      var padX = 40, padTop = 46, padBottom = this.legendEl ? 70 : 30;
      var availW = this.w - padX * 2;
      var availH = this.h - padTop - padBottom;
      // Choose a column count whose cell aspect is closest to square.
      var cols = Math.max(1, Math.round(Math.sqrt(n * availW / Math.max(1, availH))));
      var rows = Math.ceil(n / cols);
      var cw = availW / cols, ch = availH / rows;
      var cell = Math.min(cw, ch);
      var r = clamp(cell * 0.34, 3, 26);
      var gridW = cols * cell, gridH = rows * cell;
      var ox = (this.w - gridW) / 2 + cell / 2;
      var oy = padTop + (availH - gridH) / 2 + cell / 2;
      this.dots.forEach(function (d, i) {
        d.tx = ox + (i % cols) * cell;
        d.ty = oy + Math.floor(i / cols) * cell;
        d.tr = r;
      });
    },

    update: function (dt) {
      for (var i = 0; i < this.dots.length; i++) {
        var d = this.dots[i];
        spring(d, "x", d.tx, dt, 120, 20);
        spring(d, "y", d.ty, dt, 120, 20);
        d.r = lerp(d.r, d.tr, 1 - Math.pow(0.002, dt));
      }
    },

    draw: function (g) {
      for (var i = 0; i < this.dots.length; i++) {
        var d = this.dots[i];
        var age = this.time - d.born;
        var pop = REDUCED ? 1 : easeOutBack(clamp(age / 0.4, 0, 1));
        var color = this.theme.colorFor(d.group);
        g.beginPath();
        g.arc(d.x, d.y, Math.max(0.5, d.r * pop), 0, Math.PI * 2);
        g.fillStyle = color;
        g.fill();
        if (age < 0.9 && !REDUCED) {
          g.beginPath();
          g.arc(d.x, d.y, d.r * (1 + (age / 0.9) * 1.4), 0, Math.PI * 2);
          g.strokeStyle = rgba(color, 0.35 * (1 - age / 0.9));
          g.lineWidth = 2;
          g.stroke();
        }
      }
    },
  });

  /* ══════════════════════════ 4 · bee swarm ══════════════════════════ */

  function BeeSwarm(host, data, ctx) {
    Scene.call(this, host, data, ctx);
    this.dots = [];
    this.byKey = {};
    this.avg = { x: 0, x_v: 0 };
    this.totalPill();
    this.onData(data);
  }

  extend(BeeSwarm, null, {
    onResize: function () { if (this.dots) this.layoutDots(); },

    scaleBounds: function () {
      var q = (this.ctx && this.ctx.question) || {};
      var cfg = q.config || {};
      var vals = this.data.values.length ? this.data.values
        : this.data.atoms.map(function (a) { return Number(a.value); }).filter(isFinite);
      var lo = cfg.min != null ? Number(cfg.min) : (vals.length ? Math.min.apply(null, vals) : 0);
      var hi = cfg.max != null ? Number(cfg.max) : (vals.length ? Math.max.apply(null, vals) : 10);
      if (this.data.questionType === "nps") { lo = 0; hi = 10; }
      if (hi <= lo) hi = lo + 1;
      return { lo: lo, hi: hi };
    },

    onData: function (data) {
      var self = this;
      var next = [], byKey = {};
      var atoms = data.atoms.filter(function (a) { return isFinite(Number(a.value)); });
      atoms.forEach(function (a) {
        var d = self.byKey[a.key] || {
          key: a.key, born: self.time, x: self.w / 2, y: self.h / 2, value: Number(a.value),
        };
        d.value = Number(a.value);
        next.push(d);
        byKey[a.key] = d;
      });
      this.dots = next;
      this.byKey = byKey;
      this.layoutDots();
      this.emptyState(this.dots.length ? "" : "Numeric answers land here as dots.");
      if (this.legendEl) this.legendEl.innerHTML = "";
    },

    layoutDots: function () {
      var b = this.scaleBounds();
      var padX = 60, midY = this.h * 0.5;
      var w = this.w - padX * 2;
      var self = this;
      var r = clamp(Math.sqrt((this.w * this.h * 0.10) / Math.max(1, Math.PI * this.dots.length)), 4, 18);
      this.r = r;
      this.dots.forEach(function (d) {
        var t = (d.value - b.lo) / (b.hi - b.lo);
        d.tx = padX + clamp(t, 0, 1) * w;
        d.ty = midY + (hash(d.key) - 0.5) * Math.min(self.h * 0.5, 260);
      });
      this.bounds = b;
      var sum = this.dots.reduce(function (a, d) { return a + d.value; }, 0);
      this.mean = this.dots.length ? sum / this.dots.length : null;
    },

    update: function (dt) {
      var self = this;
      var midY = this.h * 0.5;
      for (var i = 0; i < this.dots.length; i++) {
        var d = this.dots[i];
        spring(d, "x", d.tx, dt, 90, 16);
        spring(d, "y", d.ty, dt, 60, 14);
      }
      // vertical separation only — the x position carries the value and must
      // not drift, so collisions are resolved along y alone.
      for (var pass = 0; pass < 2; pass++) {
        for (var a = 0; a < this.dots.length; a++) {
          for (var c = a + 1; c < this.dots.length; c++) {
            var p = this.dots[a], q = this.dots[c];
            var dx = q.x - p.x, dy = q.y - p.y;
            var min = this.r * 2 + 2;
            if (Math.abs(dx) > min) continue;
            var dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
            if (dist >= min) continue;
            var push = (min - dist) * 0.5 * (dy / dist || (a % 2 ? 1 : -1));
            p.y -= push; q.y += push;
          }
        }
      }
      if (this.mean != null && this.bounds) {
        var t = (this.mean - this.bounds.lo) / (this.bounds.hi - this.bounds.lo);
        spring(this.avg, "x", 60 + clamp(t, 0, 1) * (this.w - 120), dt, 60, 14);
      }
    },

    draw: function (g) {
      var b = this.bounds || { lo: 0, hi: 10 };
      var padX = 60;
      var midY = this.h * 0.5;

      // baseline
      g.strokeStyle = rgba(this.theme.text, 0.14);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(padX, this.h - 54);
      g.lineTo(this.w - padX, this.h - 54);
      g.stroke();

      g.font = "600 13px " + this.theme.font;
      g.fillStyle = rgba(this.theme.text, 0.5);
      g.textBaseline = "top";
      g.textAlign = "left";
      g.fillText(String(b.lo), padX, this.h - 46);
      g.textAlign = "right";
      g.fillText(String(b.hi), this.w - padX, this.h - 46);

      for (var i = 0; i < this.dots.length; i++) {
        var d = this.dots[i];
        var age = this.time - d.born;
        var pop = REDUCED ? 1 : easeOutBack(clamp(age / 0.4, 0, 1));
        var t = (d.value - b.lo) / (b.hi - b.lo);
        var color = this.theme.colorFor(Math.floor(clamp(t, 0, 0.999) * 5));
        g.beginPath();
        g.arc(d.x, d.y, Math.max(0.5, this.r * pop), 0, Math.PI * 2);
        g.fillStyle = rgba(color, 0.9);
        g.fill();
      }

      if (this.mean != null) {
        var x = this.avg.x;
        g.setLineDash([6, 6]);
        g.strokeStyle = rgba(this.theme.accent2, 0.85);
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, 44);
        g.lineTo(x, this.h - 58);
        g.stroke();
        g.setLineDash([]);

        var label = "avg " + (Math.round(this.mean * 10) / 10);
        g.font = "700 15px " + this.theme.font;
        var tw = g.measureText(label).width + 20;
        roundRect(g, x - tw / 2, 18, tw, 26, 13);
        g.fillStyle = rgba(this.theme.accent2, 0.9);
        g.fill();
        g.fillStyle = "#08111a";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(label, x, 32);
      }
    },
  });

  /* ══════════════════════════ 5 · radial bar (rose) ══════════════════════════ */

  function RadialBar(host, data, ctx) {
    Scene.call(this, host, data, ctx);
    this.arcs = [];
    this.core = { v: 0, v_v: 0 };
    this.onData(data);
  }

  extend(RadialBar, null, {
    onData: function (data) {
      var self = this;
      var map = {};
      this.arcs.forEach(function (a) { map[a.key] = a; });
      this.arcs = data.series.slice(0, 14).map(function (s, i) {
        var a = map[s.key] || { key: s.key, v: 0, v_v: 0 };
        a.label = s.label;
        a.target = s.value;
        a.index = s.index != null ? s.index : i;
        return a;
      });
      this.max = Math.max(1, this.arcs.reduce(function (m, a) { return Math.max(m, a.target); }, 0));
      this.emptyState(data.total ? "" : "Answers bloom outward from the centre.");
      if (this.legendEl) this.legendEl.innerHTML = "";
    },

    update: function (dt) {
      for (var i = 0; i < this.arcs.length; i++) spring(this.arcs[i], "v", this.arcs[i].target, dt, 90, 16);
      spring(this.core, "v", this.data.total, dt, 70, 15);
    },

    draw: function (g) {
      var cx = this.w / 2, cy = this.h / 2;
      var outer = Math.min(this.w, this.h) * 0.44;
      var inner = outer * 0.30;
      var n = this.arcs.length;
      if (!n) return;
      var step = (Math.PI * 2) / n;
      var gap = Math.min(step * 0.14, 0.06);

      for (var i = 0; i < n; i++) {
        var a = this.arcs[i];
        var frac = clamp(a.v / this.max, 0, 1);
        var r = inner + (outer - inner) * frac;
        var a0 = -Math.PI / 2 + i * step + gap / 2;
        var a1 = a0 + step - gap;
        var color = this.theme.colorFor(a.index);

        g.beginPath();
        g.arc(cx, cy, inner, a0, a1);
        g.arc(cx, cy, r, a1, a0, true);
        g.closePath();
        var grad = g.createRadialGradient(cx, cy, inner, cx, cy, outer);
        grad.addColorStop(0, rgba(color, 0.55));
        grad.addColorStop(1, rgba(shade(color, 0.2), 0.95));
        g.fillStyle = grad;
        g.fill();

        // label rides just outside its own petal
        var mid = (a0 + a1) / 2;
        var lx = cx + Math.cos(mid) * (r + 16);
        var ly = cy + Math.sin(mid) * (r + 16);
        g.font = "600 13px " + this.theme.font;
        g.fillStyle = rgba(this.theme.text, 0.72);
        g.textAlign = Math.cos(mid) > 0.15 ? "left" : (Math.cos(mid) < -0.15 ? "right" : "center");
        g.textBaseline = "middle";
        g.fillText(fitLabel(g, a.label, this.w * 0.22), lx, ly);
      }

      // core total
      g.beginPath();
      g.arc(cx, cy, inner - 6, 0, Math.PI * 2);
      g.fillStyle = rgba("#000000", 0.28);
      g.fill();
      g.font = "800 " + clamp(inner * 0.55, 18, 54) + "px " + this.theme.font;
      g.fillStyle = this.theme.text;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(String(Math.round(this.core.v)), cx, cy - 4);
      g.font = "600 12px " + this.theme.font;
      g.fillStyle = rgba(this.theme.text, 0.5);
      g.fillText("answers", cx, cy + clamp(inner * 0.36, 14, 30));
    },
  });

  /* ══════════════════════════ 6 · packed circles ══════════════════════════ */

  function PackedCircles(host, data, ctx) {
    Scene.call(this, host, data, ctx);
    this.nodes = [];
    this.totalPill();
    this.onData(data);
  }

  extend(PackedCircles, null, {
    onResize: function () { if (this.nodes) this.sizeNodes(); },

    onData: function (data) {
      var self = this;
      var map = {};
      this.nodes.forEach(function (nd) { map[nd.key] = nd; });
      this.nodes = data.series.filter(function (s) { return s.value > 0; }).slice(0, 30)
        .map(function (s, i) {
          var nd = map[s.key] || {
            key: s.key,
            x: self.w / 2 + (hash(s.key + "x") - 0.5) * self.w * 0.5,
            y: self.h / 2 + (hash(s.key + "y") - 0.5) * self.h * 0.5,
            r: 2, born: self.time,
          };
          nd.label = s.label;
          nd.value = s.value;
          nd.index = s.index != null ? s.index : i;
          return nd;
        });
      this.sizeNodes();
      this.emptyState(data.total ? "" : "");
    },

    sizeNodes: function () {
      var total = this.nodes.reduce(function (a, n) { return a + n.value; }, 0) || 1;
      var area = this.w * this.h * 0.42;
      var self = this;
      this.nodes.forEach(function (n) {
        n.tr = clamp(Math.sqrt((n.value / total) * area / Math.PI), 14, Math.min(self.w, self.h) * 0.34);
      });
    },

    update: function (dt) {
      var cx = this.w / 2, cy = this.h / 2;
      var ns = this.nodes;
      for (var i = 0; i < ns.length; i++) {
        var n = ns[i];
        n.r = lerp(n.r, n.tr, 1 - Math.pow(0.004, dt));
        n.x += (cx - n.x) * 0.9 * dt;
        n.y += (cy - n.y) * 0.9 * dt;
      }
      for (var pass = 0; pass < 3; pass++) {
        for (var a = 0; a < ns.length; a++) {
          for (var c = a + 1; c < ns.length; c++) {
            var p = ns[a], q = ns[c];
            var dx = q.x - p.x, dy = q.y - p.y;
            var min = p.r + q.r + 3;
            var d2 = dx * dx + dy * dy;
            if (d2 >= min * min) continue;
            var d = Math.sqrt(d2) || 0.01;
            var push = (min - d) / d * 0.5;
            p.x -= dx * push; p.y -= dy * push;
            q.x += dx * push; q.y += dy * push;
          }
        }
      }
      for (var k = 0; k < ns.length; k++) {
        ns[k].x = clamp(ns[k].x, ns[k].r + 4, this.w - ns[k].r - 4);
        ns[k].y = clamp(ns[k].y, ns[k].r + 34, this.h - ns[k].r - 12);
      }
    },

    draw: function (g) {
      for (var i = 0; i < this.nodes.length; i++) {
        var n = this.nodes[i];
        var color = this.theme.colorFor(n.index);
        var pop = REDUCED ? 1 : easeOutBack(clamp((this.time - n.born) / 0.5, 0, 1));
        var r = Math.max(0.5, n.r * pop);
        var grad = g.createRadialGradient(n.x - r * 0.3, n.y - r * 0.35, r * 0.1, n.x, n.y, r);
        grad.addColorStop(0, rgba(shade(color, 0.3), 0.95));
        grad.addColorStop(1, rgba(color, 0.8));
        g.beginPath();
        g.arc(n.x, n.y, r, 0, Math.PI * 2);
        g.fillStyle = grad;
        g.fill();
        g.strokeStyle = rgba("#ffffff", 0.18);
        g.lineWidth = 1;
        g.stroke();

        if (r > 26) {
          g.textAlign = "center"; g.textBaseline = "middle";
          g.font = "700 " + clamp(r * 0.3, 11, 26) + "px " + this.theme.font;
          g.fillStyle = "rgba(255,255,255,.96)";
          g.fillText(fitLabel(g, n.label, r * 1.6), n.x, n.y - r * 0.12);
          g.font = "800 " + clamp(r * 0.34, 12, 30) + "px " + this.theme.font;
          g.fillStyle = "rgba(10,10,20,.55)";
          g.fillText(String(n.value), n.x, n.y + r * 0.3);
        }
      }
    },
  });

  /* ══════════════════════════ 7 · hero number ══════════════════════════ */

  function HeroNumber(host, data, ctx) {
    Scene.call(this, host, data, ctx);
    this.shown = { v: 0, v_v: 0, pct: 0, pct_v: 0 };
    this.onData(data);
  }

  extend(HeroNumber, null, {
    onData: function (data) {
      var sorted = data.series.slice().sort(function (a, b) { return b.value - a.value; });
      this.leader = sorted[0] || null;
      this.runners = sorted.slice(1, 4);
      this.emptyState(data.total ? "" : "The leading answer will appear here.");
    },

    update: function (dt) {
      if (!this.leader) return;
      spring(this.shown, "v", this.leader.value, dt, 60, 15);
      var pct = this.data.total ? this.leader.value / this.data.total : 0;
      spring(this.shown, "pct", pct, dt, 60, 15);
    },

    draw: function (g) {
      if (!this.leader) return;
      var cx = this.w / 2, cy = this.h * 0.44;
      var R = Math.min(this.w, this.h) * 0.30;
      var color = this.theme.colorFor(this.leader.index || 0);

      // progress ring
      g.beginPath();
      g.arc(cx, cy, R, 0, Math.PI * 2);
      g.strokeStyle = rgba(this.theme.text, 0.10);
      g.lineWidth = 14;
      g.stroke();

      g.beginPath();
      g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(this.shown.pct, 0, 1));
      g.strokeStyle = color;
      g.lineCap = "round";
      g.lineWidth = 14;
      g.stroke();
      g.lineCap = "butt";

      // pulse halo, one beat per second — the only idle motion here
      if (!REDUCED) {
        var pulse = (Math.sin(this.time * 2.2) + 1) / 2;
        g.beginPath();
        g.arc(cx, cy, R + 12 + pulse * 8, 0, Math.PI * 2);
        g.strokeStyle = rgba(color, 0.10 + pulse * 0.08);
        g.lineWidth = 2;
        g.stroke();
      }

      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = "800 " + clamp(R * 0.86, 30, 150) + "px " + this.theme.font;
      g.fillStyle = this.theme.text;
      g.fillText(String(Math.round(this.shown.v)), cx, cy - R * 0.06);

      g.font = "600 " + clamp(R * 0.17, 12, 26) + "px " + this.theme.font;
      g.fillStyle = rgba(this.theme.text, 0.55);
      g.fillText(Math.round(this.shown.pct * 100) + "% of answers", cx, cy + R * 0.42);

      g.font = "700 " + clamp(this.w * 0.035, 16, 40) + "px " + this.theme.font;
      g.fillStyle = color;
      g.fillText(fitLabel(g, this.leader.label, this.w * 0.8), cx, cy + R + 46);

      // runners-up
      var y = cy + R + 90;
      for (var i = 0; i < this.runners.length; i++) {
        var r = this.runners[i];
        g.font = "600 14px " + this.theme.font;
        g.fillStyle = rgba(this.theme.text, 0.45);
        g.fillText(fitLabel(g, r.label + " · " + r.value, this.w * 0.7), cx, y + i * 22);
      }
    },
  });

  /* ══════════════════════════ 8 · racing bars ══════════════════════════ */

  function RacingBars(host, data, ctx) {
    Scene.call(this, host, data, ctx);
    this.bars = [];
    this.totalPill();
    this.onData(data);
  }

  extend(RacingBars, null, {
    onData: function (data) {
      var self = this;
      var map = {};
      this.bars.forEach(function (b) { map[b.key] = b; });
      var sorted = data.series.slice().sort(function (a, b) { return b.value - a.value; }).slice(0, 12);
      this.bars = sorted.map(function (s, rank) {
        var b = map[s.key] || { key: s.key, w: 0, w_v: 0, y: rank, y_v: 0, shown: 0, shown_v: 0, born: self.time };
        b.label = s.label;
        b.value = s.value;
        b.index = s.index != null ? s.index : rank;
        b.rank = rank;
        return b;
      });
      this.max = Math.max(1, this.bars.reduce(function (m, b) { return Math.max(m, b.value); }, 0));
      this.emptyState(data.total ? "" : "Bars overtake each other as answers land.");
      if (this.legendEl) this.legendEl.innerHTML = "";
    },

    update: function (dt) {
      for (var i = 0; i < this.bars.length; i++) {
        var b = this.bars[i];
        spring(b, "y", b.rank, dt, 90, 17);
        spring(b, "w", b.value / this.max, dt, 80, 16);
        spring(b, "shown", b.value, dt, 70, 15);
      }
    },

    draw: function (g) {
      var n = this.bars.length;
      if (!n) return;
      var padL = Math.min(this.w * 0.26, 240);
      var padR = 70, padT = 46, padB = 24;
      var rowH = (this.h - padT - padB) / n;
      var barH = Math.min(rowH * 0.68, 62);
      var maxW = this.w - padL - padR;

      for (var i = 0; i < n; i++) {
        var b = this.bars[i];
        var y = padT + b.y * rowH + (rowH - barH) / 2;
        var w = Math.max(2, clamp(b.w, 0, 1) * maxW);
        var color = this.theme.colorFor(b.index);
        var leading = b.rank === 0 && b.value > 0;

        // track
        roundRect(g, padL, y, maxW, barH, barH / 2);
        g.fillStyle = rgba(this.theme.text, 0.05);
        g.fill();

        // bar
        roundRect(g, padL, y, w, barH, barH / 2);
        var grad = g.createLinearGradient(padL, y, padL + w, y);
        grad.addColorStop(0, rgba(color, 0.85));
        grad.addColorStop(1, shade(color, 0.22));
        g.fillStyle = grad;
        g.fill();

        if (leading && !REDUCED) {
          // travelling sheen on the front-runner only, so the eye knows
          // where the race currently stands without a legend
          var sheen = ((this.time * 0.35) % 1) * w;
          var sg = g.createLinearGradient(padL + sheen - 60, 0, padL + sheen + 60, 0);
          sg.addColorStop(0, "rgba(255,255,255,0)");
          sg.addColorStop(0.5, "rgba(255,255,255,.18)");
          sg.addColorStop(1, "rgba(255,255,255,0)");
          g.save();
          roundRect(g, padL, y, w, barH, barH / 2);
          g.clip();
          g.fillStyle = sg;
          g.fillRect(padL, y, w, barH);
          g.restore();
        }

        // label
        g.textAlign = "right";
        g.textBaseline = "middle";
        g.font = (leading ? "700 " : "600 ") + clamp(barH * 0.42, 12, 22) + "px " + this.theme.font;
        g.fillStyle = leading ? this.theme.text : rgba(this.theme.text, 0.72);
        g.fillText(fitLabel(g, b.label, padL - 18), padL - 14, y + barH / 2);

        // value
        g.textAlign = "left";
        g.font = "800 " + clamp(barH * 0.46, 13, 24) + "px " + this.theme.font;
        g.fillStyle = rgba(this.theme.text, 0.9);
        g.fillText(String(Math.round(b.shown)), padL + w + 12, y + barH / 2);
      }
    },
  });

  /* ══════════════════════════ 9 · liquid fill ══════════════════════════ */

  function LiquidFill(host, data, ctx) {
    Scene.call(this, host, data, ctx);
    this.cols = [];
    this.totalPill();
    this.onData(data);
  }

  extend(LiquidFill, null, {
    onData: function (data) {
      var self = this;
      var map = {};
      this.cols.forEach(function (c) { map[c.key] = c; });
      this.cols = data.series.slice(0, 8).map(function (s, i) {
        var c = map[s.key] || { key: s.key, fill: 0, fill_v: 0, shown: 0, shown_v: 0, phase: hash(s.key) * 6.28 };
        c.label = s.label;
        c.value = s.value;
        c.index = s.index != null ? s.index : i;
        return c;
      });
      this.max = Math.max(1, this.cols.reduce(function (m, c) { return Math.max(m, c.value); }, 0));
      this.emptyState(data.total ? "" : "Each option fills as answers arrive.");
      if (this.legendEl) this.legendEl.innerHTML = "";
    },

    update: function (dt) {
      for (var i = 0; i < this.cols.length; i++) {
        spring(this.cols[i], "fill", this.cols[i].value / this.max, dt, 55, 14);
        spring(this.cols[i], "shown", this.cols[i].value, dt, 70, 15);
      }
    },

    draw: function (g) {
      var n = this.cols.length;
      if (!n) return;
      var padT = 56, padB = 62;
      var gap = clamp(this.w * 0.02, 8, 28);
      var colW = (this.w - gap * (n + 1)) / n;
      var colH = this.h - padT - padB;

      for (var i = 0; i < n; i++) {
        var c = this.cols[i];
        var x = gap + i * (colW + gap);
        var color = this.theme.colorFor(c.index);
        var radius = Math.min(colW * 0.28, 34);

        roundRect(g, x, padT, colW, colH, radius);
        g.fillStyle = rgba(this.theme.text, 0.05);
        g.fill();
        g.strokeStyle = rgba(this.theme.text, 0.09);
        g.lineWidth = 1;
        g.stroke();

        var level = padT + colH * (1 - clamp(c.fill, 0, 1));

        g.save();
        roundRect(g, x, padT, colW, colH, radius);
        g.clip();

        // two offset sine waves read as liquid; one alone looks like a slider
        for (var layer = 0; layer < 2; layer++) {
          var amp = (layer ? 5 : 8) * (REDUCED ? 0 : 1);
          var speed = layer ? 1.7 : 1.1;
          var off = layer ? 1.9 : 0;
          g.beginPath();
          g.moveTo(x, this.h);
          for (var px = 0; px <= colW; px += 4) {
            var y = level + Math.sin((px / colW) * Math.PI * 2 + this.time * speed + c.phase + off) * amp;
            if (px === 0) g.lineTo(x, y); else g.lineTo(x + px, y);
          }
          g.lineTo(x + colW, this.h);
          g.closePath();
          g.fillStyle = layer ? rgba(shade(color, 0.25), 0.55) : rgba(color, 0.85);
          g.fill();
        }
        g.restore();

        // value inside, label under
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = "800 " + clamp(colW * 0.30, 16, 46) + "px " + this.theme.font;
        g.fillStyle = c.fill > 0.22 ? "rgba(255,255,255,.96)" : rgba(this.theme.text, 0.85);
        var vy = c.fill > 0.22 ? level + 34 : level - 26;
        g.fillText(String(Math.round(c.shown)), x + colW / 2, clamp(vy, padT + 24, padT + colH - 20));

        g.font = "600 " + clamp(colW * 0.15, 11, 19) + "px " + this.theme.font;
        g.fillStyle = rgba(this.theme.text, 0.7);
        g.fillText(fitLabel(g, c.label, colW + gap * 0.7), x + colW / 2, this.h - 36);

        var pct = this.data.total ? Math.round(c.value / this.data.total * 100) : 0;
        g.font = "700 12px " + this.theme.font;
        g.fillStyle = rgba(this.theme.text, 0.42);
        g.fillText(pct + "%", x + colW / 2, this.h - 16);
      }
    },
  });

  /* ══════════════════════════ registry + wiring ══════════════════════════ */

  var SCENES = {
    answer_bubbles: function (h, d, c) { return new BubbleScene(h, d, c, "free"); },
    bubble_groups: function (h, d, c) { return new BubbleScene(h, d, c, "groups"); },
    dot_matrix: function (h, d, c) { return new DotMatrix(h, d, c); },
    bee_swarm: function (h, d, c) { return new BeeSwarm(h, d, c); },
    radial_bar: function (h, d, c) { return new RadialBar(h, d, c); },
    packed_circles: function (h, d, c) { return new PackedCircles(h, d, c); },
    hero_number: function (h, d, c) { return new HeroNumber(h, d, c); },
    racing_bars: function (h, d, c) { return new RacingBars(h, d, c); },
    liquid_fill: function (h, d, c) { return new LiquidFill(h, d, c); },
  };

  DISABLED.forEach(function (id) { delete SCENES[id]; });

  var active = null;   // { key, scene }

  function teardown() {
    if (active) {
      try { active.scene.destroy(); } catch (e) {}
      active = null;
    }
  }

  var previous = window.kkRenderExtraChart;

  window.kkRenderExtraChart = function (ctx) {
    var factory = ctx && SCENES[ctx.chartId];

    if (!factory) {
      // Not ours — stop any running scene before the next renderer paints.
      teardown();
      return typeof previous === "function" ? previous(ctx) : false;
    }

    var q = ctx.question || {};
    var key = ctx.chartId + "::" + (q.id != null ? q.id : "?");
    var data = readData(ctx);

    if (active && active.key === key && active.scene.canvas.isConnected) {
      active.scene.setData(data);
      return true;
    }

    teardown();

    // Clears #special-display and hides the Chart.js canvas for us.
    if (typeof ctx.destroyChartForSpecialDisplay === "function") {
      ctx.destroyChartForSpecialDisplay();
    } else {
      if (ctx.liveCanvas) ctx.liveCanvas.style.display = "none";
      if (ctx.specialEl) { ctx.specialEl.style.display = "block"; ctx.specialEl.innerHTML = ""; }
    }

    var scene;
    try {
      scene = factory(ctx.specialEl, data, ctx);
    } catch (e) {
      console.error("[chart_fx] scene failed for " + ctx.chartId, e);
      return typeof previous === "function" ? previous(ctx) : false;
    }
    scene.start();
    active = { key: key, scene: scene };
    return true;
  };

  window.kkChartFx = {
    scenes: Object.keys(SCENES),
    teardown: teardown,
    version: 1,
  };
})();
