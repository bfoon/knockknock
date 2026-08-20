/* Chalk — the editing overlay on the phone.
 *
 * Handles selection, move, resize, rotate and freeform vertex editing on the
 * pad. Nothing here renders the artwork — that is chalk_els.js. This only draws
 * the handles and turns finger travel into element geometry.
 *
 * window.ChalkEdit(padWrap, layer, hooks) -> controller
 *   hooks.live(id, patch)    fired continuously during a drag  (never stored)
 *   hooks.commit(id, patch)  fired once on release             (undoable)
 *   hooks.select(el|null)    selection changed
 */
(function (global) {
  "use strict";

  var HANDLES = [
    ["nw", 0, 0], ["ne", 1, 0], ["se", 1, 1], ["sw", 0, 1]
  ];
  var MIN_SIZE = 0.02;

  function Edit(host, layer, hooks) {
    this.host = host;
    this.layer = layer;
    this.hooks = hooks || {};
    this.selected = null;
    this.vertexMode = false;
    this.activeVertex = -1;
    this.snap = false;

    this.box = document.createElement("div");
    this.box.className = "chalk-sel";
    this.box.hidden = true;
    host.appendChild(this.box);

    this.frame = document.createElement("div");
    this.frame.className = "chalk-sel-frame";
    this.box.appendChild(this.frame);

    this.handles = {};
    HANDLES.forEach(function (h) {
      var el = document.createElement("div");
      el.className = "chalk-h chalk-h-" + h[0];
      el.dataset.corner = h[0];
      this.box.appendChild(el);
      this.handles[h[0]] = el;
    }, this);

    this.rotor = document.createElement("div");
    this.rotor.className = "chalk-h chalk-h-rot";
    this.box.appendChild(this.rotor);

    this.verts = document.createElement("div");
    this.verts.className = "chalk-verts";
    this.box.appendChild(this.verts);

    this._bind();
  }

  /* --- geometry ------------------------------------------------------ */

  Edit.prototype._rect = function () {
    return this.host.getBoundingClientRect();
  };

  /* Pointer -> normalised board point, through the pad's zoom window. */
  Edit.prototype._toBoard = function (cx, cy) {
    var r = this._rect(), v = this.layer.view;
    return {
      x: v.x + ((cx - r.left) / Math.max(1, r.width)) / v.s,
      y: v.y + ((cy - r.top) / Math.max(1, r.height)) / v.s
    };
  };

  /* Undo the element's rotation so a drag reads in the shape's own axes. */
  function unrotate(dx, dy, deg) {
    if (!deg) return { x: dx, y: dy };
    var a = -deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  }

  Edit.prototype.place = function () {
    var el = this.selected && this.layer.get(this.selected);
    if (!el) { this.box.hidden = true; return; }
    var v = this.layer.view;
    this.box.hidden = false;
    this.box.style.left = ((el.x - v.x) * v.s * 100) + "%";
    this.box.style.top = ((el.y - v.y) * v.s * 100) + "%";
    this.box.style.width = (el.w * v.s * 100) + "%";
    this.box.style.height = (el.h * v.s * 100) + "%";
    this.box.style.transform = "rotate(" + (el.rot || 0) + "deg)";
    this.box.dataset.mode = this.vertexMode ? "verts" : "box";
    if (this.vertexMode) this._drawVerts(el);
  };

  /* --- vertices ------------------------------------------------------ */

  Edit.prototype._drawVerts = function (el) {
    var pts = el.pts || [], k = pts.length >> 1;
    var want = k + (el.closed === false ? k - 1 : k); /* vertices + midpoints */
    while (this.verts.children.length > want) this.verts.lastChild.remove();
    while (this.verts.children.length < want) {
      var d = document.createElement("div");
      this.verts.appendChild(d);
    }
    var i, node;
    for (i = 0; i < k; i++) {
      node = this.verts.children[i];
      node.className = "chalk-v" + (i === this.activeVertex ? " is-on" : "");
      node.dataset.vi = i;
      node.dataset.kind = "vertex";
      node.style.left = pts[i * 2] + "%";
      node.style.top = pts[i * 2 + 1] + "%";
    }
    var mids = el.closed === false ? k - 1 : k;
    for (i = 0; i < mids; i++) {
      var j = (i + 1) % k;
      node = this.verts.children[k + i];
      node.className = "chalk-v chalk-v-mid";
      node.dataset.vi = i;
      node.dataset.kind = "mid";
      node.style.left = ((pts[i * 2] + pts[j * 2]) / 2) + "%";
      node.style.top = ((pts[i * 2 + 1] + pts[j * 2 + 1]) / 2) + "%";
    }
  };

  /* --- interaction ---------------------------------------------------- */

  Edit.prototype._bind = function () {
    var self = this;
    var drag = null;

    function start(e) {
      var el = self.selected && self.layer.get(self.selected);
      if (!el) return;
      var t = e.target;
      var vtx = t.closest && t.closest(".chalk-v");
      var handle = t.closest && t.closest(".chalk-h");
      if (!vtx && !handle) return;

      e.preventDefault();
      e.stopPropagation();
      self.box.setPointerCapture(e.pointerId);
      var p = self._toBoard(e.clientX, e.clientY);

      if (vtx) {
        var vi = Number(vtx.dataset.vi);
        if (vtx.dataset.kind === "mid") {
          /* Tapping a hollow midpoint inserts a vertex there and grabs it. */
          var pts = (el.pts || []).slice();
          var k = pts.length >> 1, j = (vi + 1) % k;
          var nx = (pts[vi * 2] + pts[j * 2]) / 2;
          var ny = (pts[vi * 2 + 1] + pts[j * 2 + 1]) / 2;
          pts.splice((vi + 1) * 2, 0, nx, ny);
          self.layer.patch(el.id, { pts: pts, edited: true });
          self.activeVertex = vi + 1;
          self.hooks.commit && self.hooks.commit(el.id, { pts: pts, edited: true });
          self.place();
          drag = { kind: "vertex", vi: vi + 1, start: p, pts: pts.slice(), el: el };
          return;
        }
        self.activeVertex = vi;
        self.place();
        self.hooks.select && self.hooks.select(el);
        drag = { kind: "vertex", vi: vi, start: p, pts: (el.pts || []).slice(), el: el };
        return;
      }

      if (handle === self.rotor) {
        drag = { kind: "rotate", start: p, rot0: el.rot || 0,
                 cx: el.x + el.w / 2, cy: el.y + el.h / 2, el: el };
        drag.a0 = Math.atan2(p.y - drag.cy, p.x - drag.cx);
        return;
      }
      drag = {
        kind: "resize", corner: handle.dataset.corner, start: p,
        box: { x: el.x, y: el.y, w: el.w, h: el.h }, rot: el.rot || 0, el: el
      };
    }

    function move(e) {
      if (!drag) return;
      e.preventDefault();
      var p = self._toBoard(e.clientX, e.clientY);
      var el = drag.el;
      var patch = null;

      if (drag.kind === "vertex") {
        var pts = drag.pts.slice();
        /* Board delta -> the shape's own 0..100 box, rotation removed. */
        var d = unrotate(p.x - drag.start.x, p.y - drag.start.y, el.rot || 0);
        var vx = pts[drag.vi * 2] + (d.x / el.w) * 100;
        var vy = pts[drag.vi * 2 + 1] + (d.y / el.h) * 100;
        if (self.snap) { vx = Math.round(vx / 5) * 5; vy = Math.round(vy / 5) * 5; }
        pts[drag.vi * 2] = Math.round(Math.min(200, Math.max(-100, vx)) * 100) / 100;
        pts[drag.vi * 2 + 1] = Math.round(Math.min(200, Math.max(-100, vy)) * 100) / 100;
        patch = { pts: pts, edited: true };
      } else if (drag.kind === "rotate") {
        var a = Math.atan2(p.y - drag.cy, p.x - drag.cx);
        var deg = drag.rot0 + (a - drag.a0) * 180 / Math.PI;
        if (self.snap) deg = Math.round(deg / 15) * 15;
        patch = { rot: Math.round(deg * 10) / 10 };
      } else {
        var dd = unrotate(p.x - drag.start.x, p.y - drag.start.y, drag.rot);
        var b = drag.box, x = b.x, y = b.y, w = b.w, h = b.h;
        var c = drag.corner;
        if (c === "se") { w = b.w + dd.x; h = b.h + dd.y; }
        else if (c === "ne") { w = b.w + dd.x; h = b.h - dd.y; y = b.y + dd.y; }
        else if (c === "sw") { w = b.w - dd.x; x = b.x + dd.x; h = b.h + dd.y; }
        else { w = b.w - dd.x; x = b.x + dd.x; h = b.h - dd.y; y = b.y + dd.y; }
        if (w < MIN_SIZE) { if (c === "sw" || c === "nw") x = b.x + b.w - MIN_SIZE; w = MIN_SIZE; }
        if (h < MIN_SIZE) { if (c === "nw" || c === "ne") y = b.y + b.h - MIN_SIZE; h = MIN_SIZE; }
        patch = { x: r4(x), y: r4(y), w: r4(w), h: r4(h) };
      }

      self.layer.patch(el.id, patch);
      self.place();
      self.hooks.live && self.hooks.live(el.id, patch);
      drag.last = patch;
    }

    function end(e) {
      if (!drag) return;
      if (drag.last) self.hooks.commit && self.hooks.commit(drag.el.id, drag.last);
      var el = self.layer.get(drag.el.id);
      if (el) self.hooks.select && self.hooks.select(el);
      drag = null;
      try { self.box.releasePointerCapture(e.pointerId); } catch (err) {}
    }

    this.box.addEventListener("pointerdown", start);
    this.box.addEventListener("pointermove", move);
    this.box.addEventListener("pointerup", end);
    this.box.addEventListener("pointercancel", end);

    /* Dragging the body of the selection moves it. */
    var bodyDrag = null;
    this.frame.addEventListener("pointerdown", function (e) {
      var el = self.selected && self.layer.get(self.selected);
      if (!el || self.vertexMode) return;
      e.preventDefault();
      e.stopPropagation();
      self.frame.setPointerCapture(e.pointerId);
      bodyDrag = { start: self._toBoard(e.clientX, e.clientY), x0: el.x, y0: el.y, el: el };
    });
    this.frame.addEventListener("pointermove", function (e) {
      if (!bodyDrag) return;
      e.preventDefault();
      var p = self._toBoard(e.clientX, e.clientY);
      var patch = {
        x: r4(bodyDrag.x0 + p.x - bodyDrag.start.x),
        y: r4(bodyDrag.y0 + p.y - bodyDrag.start.y)
      };
      self.layer.patch(bodyDrag.el.id, patch);
      self.place();
      self.hooks.live && self.hooks.live(bodyDrag.el.id, patch);
      bodyDrag.last = patch;
    });
    function endBody(e) {
      if (!bodyDrag) return;
      if (bodyDrag.last) self.hooks.commit && self.hooks.commit(bodyDrag.el.id, bodyDrag.last);
      bodyDrag = null;
      try { self.frame.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    this.frame.addEventListener("pointerup", endBody);
    this.frame.addEventListener("pointercancel", endBody);
  };

  function r4(v) { return Math.round(v * 10000) / 10000; }

  /* --- public --------------------------------------------------------- */

  Edit.prototype.select = function (id) {
    this.selected = id || null;
    this.activeVertex = -1;
    if (!id) this.vertexMode = false;
    this.place();
    this.hooks.select && this.hooks.select(id ? this.layer.get(id) : null);
  };

  Edit.prototype.setVertexMode = function (on) {
    var el = this.selected && this.layer.get(this.selected);
    this.vertexMode = !!on && !!el && el.type === "freeform";
    this.activeVertex = -1;
    this.place();
    return this.vertexMode;
  };

  /* Remove the vertex the teacher last touched. Three is the floor — below
   * that there is no shape left to edit. */
  Edit.prototype.removeVertex = function () {
    var el = this.selected && this.layer.get(this.selected);
    if (!el || el.type !== "freeform" || this.activeVertex < 0) return null;
    var pts = (el.pts || []).slice();
    if (pts.length <= 6) return null;
    pts.splice(this.activeVertex * 2, 2);
    this.activeVertex = -1;
    this.layer.patch(el.id, { pts: pts, edited: true });
    this.place();
    return { pts: pts, edited: true };
  };

  Edit.prototype.refresh = function () { this.place(); };

  global.ChalkEdit = function (host, layer, hooks) { return new Edit(host, layer, hooks); };
})(window);
