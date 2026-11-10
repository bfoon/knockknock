/* Chalk Circuit Lab — core.
 *
 * Everything on the bench lives on one grid. P is a tenth of an inch, the
 * pitch of a breadboard hole and of an Arduino header, and every pin of
 * every part sits on a multiple of it. That one decision is what makes
 * "plugging in" work: a leg is in a hole when their coordinates are equal,
 * not when they are near each other, so connectivity is a hash lookup and
 * never a judgement call.
 *
 *   ChalkLab.P                       grid pitch in world units
 *   ChalkLab.uid(prefix)             short random id
 *   ChalkLab.pinsOf(part)            world positions of a part's pins
 *   ChalkLab.History                 undo / redo over whole-document snapshots
 *   ChalkLab.bus                     tiny event emitter shared by the panels
 *
 * The document is plain JSON, saved as-is:
 *   { v, mode, parts:[{id,type,x,y,rot,flip,props}],
 *     wires:[{id,a,b,color,pts}], code, blocks, prog, view }
 * A wire end is either {ref:"partId:pin"} (it follows that pin around) or
 * {x,y} (it is lying loose on the mat).
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab = root.ChalkLab || {};

  var P = L.P = 20;

  L.uid = function (prefix) {
    var s = "";
    var abc = "abcdefghijkmnpqrstuvwxyz23456789";
    for (var i = 0; i < 6; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
    return (prefix || "x") + "_" + s;
  };

  L.clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };

  L.snap = function (v) { return Math.round(v / P) * P; };

  L.gridKey = function (x, y) { return Math.round(x / P * 2) + "," + Math.round(y / P * 2); };

  /* Rotate (and optionally mirror) a local point by quarter turns. */
  L.xform = function (x, y, rot, flip) {
    if (flip) x = -x;
    switch (((rot || 0) % 4 + 4) % 4) {
      case 1: return [-y, x];
      case 2: return [-x, -y];
      case 3: return [y, -x];
      default: return [x, y];
    }
  };

  /* World point -> a part's own coordinates (undoing rotation and flip). */
  L.toLocal = function (part, x, y) {
    var w = L.xform(x - part.x, y - part.y, (4 - ((part.rot || 0) % 4)) % 4, false);
    if (part.flip) w[0] = -w[0];
    return { x: w[0], y: w[1] };
  };

  L.def = function (part) { return (L.PARTS && L.PARTS[part.type]) || null; };

  L.pinList = function (part) {
    var d = L.def(part);
    if (!d) return [];
    return typeof d.pins === "function" ? d.pins(part.props || {}) : d.pins;
  };

  /* World positions of every pin on a part. */
  L.pinsOf = function (part) {
    var list = L.pinList(part), out = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var w = L.xform(p.x, p.y, part.rot, part.flip);
      out.push({
        key: part.id + ":" + p.n, part: part.id, name: p.n, label: p.label || p.n,
        x: part.x + w[0], y: part.y + w[1], hole: !!p.hole
      });
    }
    return out;
  };

  /* Bounding box of a part in world space, for hit tests and selection. */
  L.boxOf = function (part) {
    var d = L.def(part);
    var b = d && d.box ? (typeof d.box === "function" ? d.box(part.props || {}) : d.box)
                       : { x: -P, y: -P, w: 2 * P, h: 2 * P };
    var pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    pts.forEach(function (q) {
      var w = L.xform(q[0], q[1], part.rot, part.flip);
      x0 = Math.min(x0, w[0]); y0 = Math.min(y0, w[1]);
      x1 = Math.max(x1, w[0]); y1 = Math.max(y1, w[1]);
    });
    return { x: part.x + x0, y: part.y + y0, w: x1 - x0, h: y1 - y0 };
  };

  /* Props with the type's defaults filled in. Kept separate from the saved
   * props so a document only stores what somebody actually changed. */
  L.propsOf = function (part) {
    var d = L.def(part), out = {}, k;
    var dflt = (d && d.props) || {};
    for (k in dflt) out[k] = dflt[k];
    var own = part.props || {};
    for (k in own) out[k] = own[k];
    return out;
  };

  L.blankDoc = function (mode) {
    return {
      v: 1, mode: mode === "kid" ? "kid" : "pro",
      parts: [], wires: [], code: "", blocks: null, prog: "code",
      view: { x: 0, y: 0, z: 1 }
    };
  };

  /* --------------------------------------------------------------- bus */

  var handlers = {};
  L.bus = {
    on: function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    off: function (name, fn) {
      var list = handlers[name] || [];
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    emit: function (name, data) {
      var list = (handlers[name] || []).slice();
      for (var i = 0; i < list.length; i++) {
        try { list[i](data); } catch (e) { if (root.console) console.error(e); }
      }
    }
  };

  /* ----------------------------------------------------------- history */

  /* Whole-document snapshots. A circuit is a few kilobytes of JSON, so a
   * stack of sixty copies is cheaper than getting a diff-based undo right
   * for every kind of edit, and it can never fall out of step. */
  function History(limit) { this.limit = limit || 60; this.past = []; this.future = []; }
  History.prototype.push = function (doc) {
    var snap = JSON.stringify(strip(doc));
    if (this.past.length && this.past[this.past.length - 1] === snap) return;
    this.past.push(snap);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  };
  History.prototype.undo = function (doc) {
    if (!this.past.length) return null;
    this.future.push(JSON.stringify(strip(doc)));
    return JSON.parse(this.past.pop());
  };
  History.prototype.redo = function (doc) {
    if (!this.future.length) return null;
    this.past.push(JSON.stringify(strip(doc)));
    return JSON.parse(this.future.pop());
  };
  function strip(doc) {
    return { parts: doc.parts, wires: doc.wires, code: doc.code, blocks: doc.blocks, prog: doc.prog };
  }
  L.History = History;

  /* --------------------------------------------------------- formatting */

  var SI = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];

  /* 4700 -> "4.7k", 0.0000047 -> "4.7µ". */
  L.si = function (v, unit, digits) {
    if (v === 0 || !isFinite(v)) return (isFinite(v) ? "0 " : "∞ ") + (unit || "");
    var a = Math.abs(v);
    for (var i = 0; i < SI.length; i++) {
      if (a >= SI[i][0] * 0.9995 || i === SI.length - 1) {
        var n = v / SI[i][0];
        var s = n.toPrecision(digits || 3);
        if (s.indexOf(".") >= 0 && s.indexOf("e") < 0) s = s.replace(/\.?0+$/, "");
        return s + " " + SI[i][1] + (unit || "");
      }
    }
    return String(v);
  };

  L.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
