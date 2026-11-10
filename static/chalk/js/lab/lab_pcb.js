/* Chalk Circuit Lab — the circuit board.
 *
 * The bench is where a circuit is tried; this is where it becomes a board
 * you can have made. Nothing is drawn twice: the board is worked out from
 * the same parts and the same netlist the simulator uses, so a board can
 * never disagree with the circuit it came from.
 *
 *   footprints   every leg of every part already sits on the 0.1 inch grid,
 *                so a part's footprint is simply its legs as pads, with its
 *                outline printed around them. Things that live off the
 *                board — motors, batteries, servos — become a row of pads
 *                to solder their leads to.
 *   placement    parts are packed in order of how much they talk to each
 *                other, then dragged wherever you like.
 *   routing      a two-layer maze router on a 1.27 mm grid: red on top
 *                prefers to run across, blue underneath prefers to run up
 *                and down, and a via joins them when a track must cross.
 *   output       Gerber and drill files in one zip, as a board house wants.
 *
 * The engine (ChalkLab.PCB) is plain data in, plain data out, and runs
 * under Node; the view (ChalkLab.PcbView) draws it and takes the mouse.
 *
 * doc.pcb = { w, h, r, holes, place: {partId: {x, y, rot}}, tracks:
 *             [{n, l, w, pts}], vias: [[x, y]], open: [[x1, y1, x2, y2]], sig }
 * Lengths are millimetres from the board's top-left corner.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var PCB = L.PCB = {};
  var MM = PCB.MM = 2.54 / L.P;          /* one bench unit in millimetres */
  var G = PCB.G = 1.27;                  /* routing grid */
  var PAD = 1.6, DRILL = 0.9, VIA = 1.2, VIA_DRILL = 0.6, HOLE = 3.2, EDGE = 6;

  var SKIP = /^(breadboard|perfboard|stripboard|multimeter|scope|rf_remote)/;
  var OFF = /^(motor|k_motor|servo|battery_9v|battery_aa|k_battery|psu|bulb|k_bulb)$/;
  PCB.offBoard = function (type) { return OFF.test(type); };
  PCB.onBoard = function (type) { return !SKIP.test(type); };

  function r3(v) { return Math.round(v * 1000) / 1000; }
  function snapG(v) { return Math.round(v / G) * G; }

  /* --------------------------------------------------------- footprints */

  PCB.footprint = function (part) {
    var d = L.def(part);
    var pins = L.pinList(part).filter(function (q) { return !q.hole; });
    if (OFF.test(part.type)) {
      return {
        off: true,
        pads: pins.map(function (q, i) { return { n: q.n, x: i * 2.54, y: 0 }; }),
        box: { x: -1.9, y: -2.7, w: (pins.length - 1) * 2.54 + 3.8, h: 5.4 }
      };
    }
    var b = d.box ? (typeof d.box === "function" ? d.box(part.props || {}) : d.box) : { x: -L.P, y: -L.P, w: 2 * L.P, h: 2 * L.P };
    return {
      off: false,
      pads: pins.map(function (q) { return { n: q.n, x: snapG(q.x * MM), y: snapG(q.y * MM) }; }),
      box: { x: b.x * MM, y: b.y * MM, w: b.w * MM, h: b.h * MM }
    };
  };

  /* A footprint's extent once turned: pads, plus its printed outline. */
  PCB.bounds = function (fp, rot) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    var eat = function (x, y, m) {
      var w = L.xform(x, y, rot, false);
      x0 = Math.min(x0, w[0] - m); y0 = Math.min(y0, w[1] - m); x1 = Math.max(x1, w[0] + m); y1 = Math.max(y1, w[1] + m);
    };
    fp.pads.forEach(function (p) { eat(p.x, p.y, PAD / 2 + 0.3); });
    var b = fp.box;
    eat(b.x, b.y, 0); eat(b.x + b.w, b.y, 0); eat(b.x, b.y + b.h, 0); eat(b.x + b.w, b.y + b.h, 0);
    return { x0: x0, y0: y0, x1: x1, y1: y1, w: x1 - x0, h: y1 - y0 };
  };

  PCB.padPos = function (place, pad) {
    var w = L.xform(pad.x, pad.y, place.rot || 0, false);
    return [r3(place.x + w[0]), r3(place.y + w[1])];
  };

  /* ------------------------------------------------------------- model */

  /* The board's view of the circuit: which parts go on it, and which pads
   * must be joined. Read straight from the simulator's topology. */
  PCB.model = function (doc, sim) {
    var ref = L.refdes(doc), items = [], index = {};
    doc.parts.forEach(function (p) {
      if (!L.def(p) || SKIP.test(p.type)) return;
      var fp = PCB.footprint(p);
      if (!fp.pads.length) return;
      var it = { id: p.id, part: p, ref: ref[p.id], fp: fp, pad: {} };
      fp.pads.forEach(function (q) { it.pad[q.n] = q; });
      items.push(it); index[p.id] = it;
    });
    var nets = [], padNet = {}, names = {};
    L.nets(doc, sim).forEach(function (keys) {
      var pads = [];
      keys.forEach(function (k) {
        var i = k.indexOf(":"), id = k.slice(0, i), pin = k.slice(i + 1);
        if (index[id] && index[id].pad[pin]) pads.push({ id: id, pin: pin, key: k });
      });
      if (pads.length < 2) return;
      var pinNames = pads.map(function (q) { return q.pin; });
      var source = function (pin) { return pads.some(function (q) { return q.pin === pin && /battery|coin_cell|psu/.test(index[q.id].part.type); }); };
      var name = pinNames.some(function (n) { return /^GND\d?$/.test(n); }) || source("-") ? "GND"
               : pinNames.indexOf("5V") >= 0 ? "+5V" : pinNames.indexOf("3V3") >= 0 ? "+3V3"
               : source("+") || pinNames.some(function (n) { return /^(VCC|VIN|V\+|\+V)$/.test(n); }) ? "PWR" : "N";
      var power = name !== "N";
      names[name] = (names[name] || 0) + 1;
      if (name === "N" || name === "PWR" || names[name] > 1) name = name + (name === "N" ? "" : "_") + names[name];
      pads.forEach(function (q) { padNet[q.key] = nets.length + 1; });
      nets.push({ name: name, power: power, pads: pads });
    });
    var sig = items.map(function (it) { return it.id + ":" + it.fp.pads.length; }).join(",") + "|" +
      nets.map(function (n) { return n.pads.map(function (q) { return q.key; }).sort().join("+"); }).sort().join("|");
    return { items: items, index: index, nets: nets, padNet: padNet, sig: sig };
  };

  /* -------------------------------------------------------- placement */

  PCB.blank = function () { return { v: 1, w: 60, h: 40, r: 3, holes: true, place: {}, tracks: [], vias: [], open: [], sig: "" }; };

  /* Pack the parts into rows, most-connected first so that parts which
   * talk to each other start out as neighbours. */
  PCB.autoplace = function (doc, model, onlyNew) {
    var pcb = doc.pcb, items = model.items;
    if (!items.length) return;
    var link = {};
    model.nets.forEach(function (n) {
      n.pads.forEach(function (a) { n.pads.forEach(function (b) { if (a.id !== b.id) { link[a.id] = link[a.id] || {}; link[a.id][b.id] = (link[a.id][b.id] || 0) + (n.power ? 0.25 : 1); } }); });
    });
    if (onlyNew) {
      /* new arrivals queue up under what is already placed */
      var y = EDGE;
      items.forEach(function (it) { var pl = pcb.place[it.id]; if (pl) { var b = PCB.bounds(it.fp, pl.rot || 0); y = Math.max(y, pl.y + b.y1 + 2.54); } });
      var x = EDGE;
      items.forEach(function (it) {
        if (pcb.place[it.id]) return;
        var b = PCB.bounds(it.fp, 0);
        pcb.place[it.id] = { x: snapG(x - b.x0 + G), y: snapG(y - b.y0 + G), rot: 0 };
        x += b.w + 2.54;
      });
      PCB.grow(doc, model);
      return;
    }
    var order = [], left = items.slice();
    left.sort(function (a, b) { return b.fp.pads.length - a.fp.pads.length; });
    order.push(left.shift());
    while (left.length) {
      var best = 0, score = -1;
      left.forEach(function (it, i) {
        var s = 0;
        order.forEach(function (o, j) { s += ((link[it.id] || {})[o.id] || 0) * (1 + j / order.length); });
        if (s > score) { score = s; best = i; }
      });
      order.push(left.splice(best, 1)[0]);
    }
    var area = 0, widest = 0;
    order.forEach(function (it) { var b = PCB.bounds(it.fp, 0); area += (b.w + 3) * (b.h + 3); widest = Math.max(widest, b.w); });
    var maxW = Math.max(widest + 1, Math.sqrt(area) * 1.3), cx = 0, cy = 0, rowH = 0;
    pcb.place = {};
    order.forEach(function (it) {
      var b = PCB.bounds(it.fp, 0);
      if (cx > 0 && cx + b.w > maxW) { cx = 0; cy += rowH + 2.54; rowH = 0; }
      pcb.place[it.id] = { x: snapG(EDGE + cx - b.x0 + G / 2), y: snapG(EDGE + cy - b.y0 + G / 2), rot: 0 };
      cx += b.w + 2.54; rowH = Math.max(rowH, b.h);
    });
    PCB.fitBoard(doc, model);
  };

  PCB.extent = function (doc, model) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    model.items.forEach(function (it) {
      var pl = doc.pcb.place[it.id]; if (!pl) return;
      var b = PCB.bounds(it.fp, pl.rot || 0);
      x0 = Math.min(x0, pl.x + b.x0); y0 = Math.min(y0, pl.y + b.y0); x1 = Math.max(x1, pl.x + b.x1); y1 = Math.max(y1, pl.y + b.y1);
    });
    return x1 < x0 ? null : { x0: x0, y0: y0, x1: x1, y1: y1 };
  };
  /* Shrink (or grow) the board to wrap the parts, with room for the edge
   * and the mounting holes. Everything shifts together. */
  PCB.fitBoard = function (doc, model) {
    var pcb = doc.pcb, e = PCB.extent(doc, model);
    if (!e) return;
    var dx = snapG(EDGE - e.x0), dy = snapG(EDGE - e.y0);
    model.items.forEach(function (it) { var pl = pcb.place[it.id]; if (pl) { pl.x = r3(pl.x + dx); pl.y = r3(pl.y + dy); } });
    pcb.w = Math.max(20, Math.ceil((e.x1 - e.x0 + 2 * EDGE) / 2.54) * 2.54);
    pcb.h = Math.max(20, Math.ceil((e.y1 - e.y0 + 2 * EDGE) / 2.54) * 2.54);
    pcb.w = r3(pcb.w); pcb.h = r3(pcb.h);
    pcb.tracks = []; pcb.vias = []; pcb.open = [];
  };
  /* Only ever make the board bigger: used when a new part arrives. */
  PCB.grow = function (doc, model) {
    var pcb = doc.pcb, e = PCB.extent(doc, model);
    if (!e) return;
    pcb.w = r3(Math.max(pcb.w, Math.ceil((e.x1 + EDGE) / 2.54) * 2.54));
    pcb.h = r3(Math.max(pcb.h, Math.ceil((e.y1 + EDGE) / 2.54) * 2.54));
  };

  /* Make doc.pcb agree with the circuit: place what is new, forget what is
   * gone, and throw away tracks that were routed for a different netlist. */
  PCB.ensure = function (doc, model) {
    var fresh = !doc.pcb;
    if (fresh) doc.pcb = PCB.blank();
    var pcb = doc.pcb, changed = false;
    pcb.place = pcb.place || {}; pcb.tracks = pcb.tracks || []; pcb.vias = pcb.vias || []; pcb.open = pcb.open || [];
    Object.keys(pcb.place).forEach(function (id) { if (!model.index[id]) { delete pcb.place[id]; changed = true; } });
    var missing = model.items.filter(function (it) { return !pcb.place[it.id]; });
    if (missing.length) { PCB.autoplace(doc, model, !fresh && missing.length < model.items.length); changed = true; }
    if (pcb.sig !== model.sig) {
      if (pcb.tracks.length || pcb.vias.length) changed = true;
      pcb.tracks = []; pcb.vias = []; pcb.open = [];
      pcb.sig = model.sig;
    }
    return changed || fresh;
  };

  PCB.holes = function (pcb) {
    if (!pcb.holes) return [];
    var m = 3.5;
    return [[m, m], [pcb.w - m, m], [m, pcb.h - m], [pcb.w - m, pcb.h - m]];
  };

  /* Every pad on the board, where it is and which net it belongs to. */
  PCB.pads = function (doc, model) {
    var out = [];
    model.items.forEach(function (it) {
      var pl = doc.pcb.place[it.id]; if (!pl) return;
      it.fp.pads.forEach(function (q, i) {
        var w = PCB.padPos(pl, q);
        out.push({ id: it.id, pin: q.n, key: it.id + ":" + q.n, x: w[0], y: w[1], net: model.padNet[it.id + ":" + q.n] || 0, first: i === 0 });
      });
    });
    return out;
  };

  /* The connections still to make, as straight "air wires": each net's
   * pads joined into the shortest tree. */
  PCB.ratsnest = function (doc, model) {
    var by = {}, out = [];
    PCB.pads(doc, model).forEach(function (p) { if (p.net) (by[p.net] = by[p.net] || []).push(p); });
    Object.keys(by).forEach(function (k) {
      var list = by[k], inTree = [list[0]], rest = list.slice(1);
      while (rest.length) {
        var bi = 0, bj = 0, bd = 1e18;
        rest.forEach(function (p, i) { inTree.forEach(function (t, j) { var d = (p.x - t.x) * (p.x - t.x) + (p.y - t.y) * (p.y - t.y); if (d < bd) { bd = d; bi = i; bj = j; } }); });
        out.push([rest[bi].x, rest[bi].y, inTree[bj].x, inTree[bj].y]);
        inTree.push(rest.splice(bi, 1)[0]);
      }
    });
    return out;
  };

  /* ------------------------------------------------------------ router */

  function Heap() { this.c = []; this.v = []; }
  Heap.prototype.push = function (cost, val) {
    var c = this.c, v = this.v, i = c.length;
    c.push(cost); v.push(val);
    while (i > 0) { var p = (i - 1) >> 1; if (c[p] <= cost) break; c[i] = c[p]; v[i] = v[p]; i = p; }
    c[i] = cost; v[i] = val;
  };
  Heap.prototype.pop = function () {
    var c = this.c, v = this.v, top = v[0], lc = c.pop(), lv = v.pop(), n = c.length;
    if (n) {
      var i = 0;
      for (;;) {
        var a = 2 * i + 1, b = a + 1;
        if (a >= n) break;
        if (b < n && c[b] < c[a]) a = b;
        if (c[a] >= lc) break;
        c[i] = c[a]; v[i] = v[a]; i = a;
      }
      c[i] = lc; v[i] = lv;
    }
    return top;
  };

  /* Corners cut at 45°, as on a real board: a sharp inside corner is where
   * etchant collects, and it simply looks wrong. */
  function chamfer(pts, keep) {
    if (pts.length < 3) return pts;
    var out = [pts[0]], h = G / 2;
    for (var i = 1; i < pts.length - 1; i++) {
      var a = pts[i - 1], b = pts[i], c = pts[i + 1];
      /* a corner another track ends on stays square: cut it and that
       * track would be left ending in thin air */
      if (keep[b[0] + "," + b[1]]) { out.push(b); continue; }
      var la = Math.hypot(b[0] - a[0], b[1] - a[1]), lc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      out.push([r3(b[0] - (b[0] - a[0]) / la * h), r3(b[1] - (b[1] - a[1]) / la * h)]);
      out.push([r3(b[0] + (c[0] - b[0]) / lc * h), r3(b[1] + (c[1] - b[1]) / lc * h)]);
    }
    out.push(pts[pts.length - 1]);
    return out.filter(function (p, i) { return !i || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]; });
  }

  function routeOnce(doc, model, order) {
    var pcb = doc.pcb, cols = Math.floor(pcb.w / G + 1e-6) + 1, rows = Math.floor(pcb.h / G + 1e-6) + 1, N = cols * rows;
    var owner = new Int16Array(2 * N), fat = new Int16Array(N), tree = new Uint8Array(2 * N);
    var c, r, i;
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
      if (c * G < 1 || r * G < 1 || c * G > pcb.w - 1 || r * G > pcb.h - 1) { owner[r * cols + c] = -1; owner[N + r * cols + c] = -1; fat[r * cols + c] = -1; }
    }
    PCB.holes(pcb).forEach(function (h) {
      for (var rr = 0; rr < rows; rr++) for (var cc = 0; cc < cols; cc++) {
        if (Math.hypot(cc * G - h[0], rr * G - h[1]) < HOLE / 2 + 1.2) { owner[rr * cols + cc] = -1; owner[N + rr * cols + cc] = -1; fat[rr * cols + cc] = -1; }
      }
    });
    var pads = PCB.pads(doc, model), byNet = {}, clash = 0;
    pads.forEach(function (p) {
      var cc = Math.round(p.x / G), rr = Math.round(p.y / G);
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) { p.cell = -1; return; }
      var cell = rr * cols + cc, k = p.net || -1;
      if (fat[cell] > 0 && fat[cell] !== k) clash++;
      owner[cell] = k; owner[N + cell] = k; fat[cell] = k; p.cell = cell;
      if (p.net) (byNet[p.net] = byNet[p.net] || []).push(p);
    });

    var tracks = [], vias = [], open = [], length = 0;
    var dist = new Float32Array(2 * N), prev = new Int32Array(2 * N), stamp = new Int32Array(2 * N), gen = 0;
    var DC = [1, -1, 0, 0], DR = [0, 0, 1, -1];

    var viaOk = function (cell, k) {
      var cc = cell % cols, rr = (cell / cols) | 0;
      for (var d = 0; d < 4; d++) {
        var c2 = cc + DC[d], r2 = rr + DR[d];
        if (c2 < 0 || r2 < 0 || c2 >= cols || r2 >= rows) return false;
        var f = fat[r2 * cols + c2];
        if (f !== 0 && f !== k) return false;
      }
      return true;
    };

    var connect = function (k, from) {
      gen++;
      var heap = new Heap(), s, found = -1;
      for (s = 0; s < 2; s++) { var n0 = s * N + from.cell; dist[n0] = 0; prev[n0] = -1; stamp[n0] = gen; heap.push(0, n0); }
      while (heap.c.length) {
        var u = heap.pop();
        if (tree[u]) { found = u; break; }
        var layer = u >= N ? 1 : 0, cell = u - layer * N, cc = cell % cols, rr = (cell / cols) | 0, du = dist[u];
        for (var d = 0; d < 4; d++) {
          var c2 = cc + DC[d], r2 = rr + DR[d];
          if (c2 < 0 || r2 < 0 || c2 >= cols || r2 >= rows) continue;
          var v = layer * N + r2 * cols + c2, o = owner[v];
          if (o !== 0 && o !== k) continue;
          /* top likes to run across, bottom up and down: tracks on the two
           * sides cross instead of fighting for the same channel */
          var nd = du + 10 + ((layer === 0) === (d >= 2) ? 4 : 0);
          if (stamp[v] !== gen || nd < dist[v]) { stamp[v] = gen; dist[v] = nd; prev[v] = u; heap.push(nd, v); }
        }
        var w = (1 - layer) * N + cell, ow = owner[w];
        if (ow === 0 || ow === k) {
          var own = fat[cell] === k, cost = own ? 1 : 90;
          if (own || viaOk(cell, k)) {
            var nd2 = du + cost;
            if (stamp[w] !== gen || nd2 < dist[w]) { stamp[w] = gen; dist[w] = nd2; prev[w] = u; heap.push(nd2, w); }
          }
        }
      }
      if (found < 0) return false;
      var path = [], n = found;
      while (n !== -1) { path.push(n); n = prev[n]; }
      var run = [], runLayer = -1;
      var flush = function () {
        if (run.length > 1) {
          var pts = [run[0]];
          for (var q = 1; q < run.length - 1; q++) {
            var a = run[q - 1], b = run[q], c3 = run[q + 1];
            if ((b[0] - a[0]) * (c3[1] - b[1]) !== (b[1] - a[1]) * (c3[0] - b[0])) pts.push(b);
          }
          pts.push(run[run.length - 1]);
          for (q = 1; q < pts.length; q++) length += Math.abs(pts[q][0] - pts[q - 1][0]) + Math.abs(pts[q][1] - pts[q - 1][1]);
          tracks.push({ n: k - 1, l: runLayer, w: model.nets[k - 1].power ? 0.6 : 0.4, pts: pts });
        }
        run = [];
      };
      for (var j = 0; j < path.length; j++) {
        var node = path[j], ly = node >= N ? 1 : 0, cl = node - ly * N;
        if (ly !== runLayer) {
          flush(); runLayer = ly;
          if (j > 0 && fat[cl] !== k) { vias.push([r3((cl % cols) * G), r3(((cl / cols) | 0) * G), k - 1]); fat[cl] = k; }
        }
        run.push([r3((cl % cols) * G), r3(((cl / cols) | 0) * G)]);
        owner[node] = k; tree[node] = 1;
        if (fat[cl] === k) { owner[cl] = k; owner[N + cl] = k; tree[cl] = 1; tree[N + cl] = 1; }
      }
      flush();
      return true;
    };

    var failedNets = [];
    order.forEach(function (k) {
      var list = (byNet[k] || []).filter(function (p) { return p.cell >= 0; });
      if (list.length < 2) return;
      tree.fill(0);
      var first = list[0];
      tree[first.cell] = 1; tree[N + first.cell] = 1;
      var rest = list.slice(1).sort(function (a, b) {
        return (Math.abs(a.x - first.x) + Math.abs(a.y - first.y)) - (Math.abs(b.x - first.x) + Math.abs(b.y - first.y));
      });
      var done = [first], bad = false;
      rest.forEach(function (p) {
        if (tree[p.cell]) { done.push(p); return; }
        if (connect(k, p)) { done.push(p); return; }
        bad = true;
        var near = done[0], bd = 1e18;
        done.forEach(function (t) { var dd = Math.hypot(t.x - p.x, t.y - p.y); if (dd < bd) { bd = dd; near = t; } });
        open.push([p.x, p.y, near.x, near.y]);
      });
      if (bad) failedNets.push(k);
    });
    var keep = {};
    tracks.forEach(function (t) { [t.pts[0], t.pts[t.pts.length - 1]].forEach(function (q) { keep[q[0] + "," + q[1]] = 1; }); });
    tracks.forEach(function (t) { t.pts = chamfer(t.pts, keep); });
    return { tracks: tracks, vias: vias, open: open, length: length, failed: failedNets, clash: clash };
  }

  /* Route every net. A net that fails is tried first on the next attempt:
   * usually it only failed because an earlier one took the long way round. */
  PCB.route = function (doc, model) {
    var pcb = doc.pcb, pads = PCB.pads(doc, model), span = {};
    pads.forEach(function (p) {
      if (!p.net) return;
      var s = span[p.net] = span[p.net] || { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, n: 0 };
      s.x0 = Math.min(s.x0, p.x); s.y0 = Math.min(s.y0, p.y); s.x1 = Math.max(s.x1, p.x); s.y1 = Math.max(s.y1, p.y); s.n++;
    });
    var size = function (k) { var s = span[k]; return s ? (s.x1 - s.x0) + (s.y1 - s.y0) : 0; };
    var all = model.nets.map(function (_, i) { return i + 1; }).filter(function (k) { return span[k]; });
    var order = all.slice().sort(function (a, b) { return size(a) - size(b); });
    var best = null;
    for (var attempt = 0; attempt < 5; attempt++) {
      var res = routeOnce(doc, model, order);
      if (!best || res.open.length < best.open.length || (res.open.length === best.open.length && res.vias.length < best.vias.length)) best = res;
      if (!res.open.length) break;
      var failed = res.failed;
      order = failed.concat(order.filter(function (k) { return failed.indexOf(k) < 0; }));
      if (attempt === 3) order = all.slice().sort(function (a, b) { return size(b) - size(a); });
    }
    pcb.tracks = best.tracks; pcb.vias = best.vias; pcb.open = best.open;
    return best;
  };

  /* What the board is and whether it is finished. */
  PCB.report = function (doc, model) {
    var pcb = doc.pcb, joins = 0, length = 0;
    model.nets.forEach(function (n) { joins += n.pads.length - 1; });
    (pcb.tracks || []).forEach(function (t) { for (var i = 1; i < t.pts.length; i++) length += Math.hypot(t.pts[i][0] - t.pts[i - 1][0], t.pts[i][1] - t.pts[i - 1][1]); });
    var routed = (pcb.tracks || []).length > 0 || !joins;
    return { parts: model.items.length, nets: model.nets.length, joins: joins, routed: routed, open: routed ? (pcb.open || []).length : joins,
             vias: (pcb.vias || []).length, length: length, w: pcb.w, h: pcb.h };
  };

  /* ------------------------------------------------------------ gerber */

  /* A small stroke font for the silkscreen: capitals, digits, + and -, on
   * a 4 × 6 grid. Gerber has no text, only lines. */
  var O = "1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0", Pp = "0,6 0,0 3,0 4,1 4,2 3,3 0,3";
  var FONT = {
    A: "0,6 0,2 2,0 4,2 4,6;0,4 4,4", B: "0,0 0,6 3,6 4,5 4,4 3,3 0,3;3,3 4,2 4,1 3,0 0,0", C: "4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5",
    D: "0,0 0,6 3,6 4,5 4,1 3,0 0,0", E: "4,0 0,0 0,6 4,6;0,3 3,3", F: "4,0 0,0 0,6;0,3 3,3", G: "4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3 2,3",
    H: "0,0 0,6;4,0 4,6;0,3 4,3", I: "1,0 3,0;2,0 2,6;1,6 3,6", J: "4,0 4,5 3,6 1,6 0,5", K: "0,0 0,6;4,0 0,3 4,6", L: "0,0 0,6 4,6",
    M: "0,6 0,0 2,3 4,0 4,6", N: "0,6 0,0 4,6 4,0", O: O, P: Pp, Q: O + ";2,4 4,6", R: Pp + ";2,3 4,6",
    S: "4,1 3,0 1,0 0,1 0,2 1,3 3,3 4,4 4,5 3,6 1,6 0,5", T: "0,0 4,0;2,0 2,6", U: "0,0 0,5 1,6 3,6 4,5 4,0", V: "0,0 2,6 4,0",
    W: "0,0 1,6 2,3 3,6 4,0", X: "0,0 4,6;4,0 0,6", Y: "0,0 2,3 4,0;2,3 2,6", Z: "0,0 4,0 0,6 4,6",
    "0": O + ";1,5 3,1", "1": "1,1 2,0 2,6;1,6 3,6", "2": "0,1 1,0 3,0 4,1 4,2 0,6 4,6", "3": "0,0 4,0 2,2 3,2 4,3 4,5 3,6 1,6 0,5",
    "4": "3,6 3,0 0,4 4,4", "5": "4,0 0,0 0,3 3,3 4,4 4,5 3,6 0,6", "6": "3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,4 3,3 0,3", "7": "0,0 4,0 1,6",
    "8": "1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3 1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3", "9": "1,6 3,6 4,5 4,1 3,0 1,0 0,1 0,2 1,3 4,3",
    "+": "0,3 4,3;2,1 2,5", "-": "0,3 4,3", "_": "0,6 4,6", ".": "2,5 2,6"
  };
  /* Polylines for a string, top-left at (x, y), capital height `size` mm. */
  PCB.strokes = function (str, x, y, size) {
    var u = size / 6, out = [], cx = x;
    String(str).toUpperCase().split("").forEach(function (ch) {
      var g = FONT[ch];
      if (g) g.split(";").forEach(function (line) {
        out.push(line.split(" ").map(function (p) { var q = p.split(","); return [cx + q[0] * u, y + q[1] * u]; }));
      });
      cx += 5.4 * u;
    });
    return out;
  };

  /* Where each part's outline and name go on the silkscreen. */
  PCB.silk = function (doc, model) {
    var out = [];
    model.items.forEach(function (it) {
      var pl = doc.pcb.place[it.id]; if (!pl) return;
      var b = it.fp.box, rot = pl.rot || 0, cs = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(function (q) {
        var w = L.xform(q[0], q[1], rot, false); return [pl.x + w[0], pl.y + w[1]];
      });
      var xs = cs.map(function (q) { return q[0]; }), ys = cs.map(function (q) { return q[1]; });
      var x0 = Math.min.apply(null, xs), y0 = Math.min.apply(null, ys), x1 = Math.max.apply(null, xs), y1 = Math.max.apply(null, ys);
      /* keep the outline on the board even when the bench picture is bigger */
      x0 = Math.max(0.6, x0); y0 = Math.max(0.6, y0); x1 = Math.min(doc.pcb.w - 0.6, x1); y1 = Math.min(doc.pcb.h - 0.6, y1);
      var first = it.fp.pads[0] ? PCB.padPos(pl, it.fp.pads[0]) : null;
      out.push({ id: it.id, ref: it.ref, x0: x0, y0: y0, x1: x1, y1: y1, first: first, off: it.fp.off, value: L.partValue(it.part), title: L.partTitle(it.part) });
    });
    return out;
  };

  function outline(pcb, steps) {
    var w = pcb.w, h = pcb.h, r = Math.min(pcb.r || 0, w / 2, h / 2), pts = [], n = steps || 8;
    var corner = function (cx, cy, a0) { for (var i = 0; i <= n; i++) { var a = a0 + Math.PI / 2 * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
    if (r < 0.01) return [[0, 0], [w, 0], [w, h], [0, h], [0, 0]];
    corner(w - r, r, -Math.PI / 2); corner(w - r, h - r, 0); corner(r, h - r, Math.PI / 2); corner(r, r, Math.PI);
    pts.push(pts[0]);
    return pts;
  }
  PCB.outline = outline;

  /* The files a board house asks for. Gerber's Y runs up the page, so the
   * board is flipped top to bottom on the way out. */
  PCB.gerbers = function (doc, model, title) {
    var pcb = doc.pcb, H = pcb.h, pads = PCB.pads(doc, model), holes = PCB.holes(pcb), silk = PCB.silk(doc, model);
    var fmt = function (v) { return String(Math.round(v * 1e6)); };
    var XY = function (x, y) { return "X" + fmt(x) + "Y" + fmt(H - y); };
    var file = function (func, apertures, body) {
      var s = "G04 Chalk Circuit Lab — " + (title || "board") + "*\n%TF.GenerationSoftware,Chalk,CircuitLab,1*%\n%TF.FileFunction," + func + "*%\n%FSLAX46Y46*%\n%MOMM*%\n%LPD*%\n";
      apertures.forEach(function (a, i) { s += "%ADD" + (10 + i) + "C," + a.toFixed(3) + "*%\n"; });
      return s + body + "M02*\n";
    };
    var line = function (pts) { var s = ""; pts.forEach(function (p, i) { s += XY(p[0], p[1]) + (i ? "D01*\n" : "D02*\n"); }); return s; };
    var copper = function (layer) {
      var ap = [0.4, 0.6, PAD, VIA], s = "G01*\n";
      [0.4, 0.6].forEach(function (w, i) {
        var seg = pcb.tracks.filter(function (t) { return t.l === layer && Math.abs(t.w - w) < 0.01; });
        if (!seg.length) return;
        s += "D" + (10 + i) + "*\n";
        seg.forEach(function (t) { s += line(t.pts); });
      });
      s += "D12*\n"; pads.forEach(function (p) { s += XY(p.x, p.y) + "D03*\n"; });
      if (pcb.vias.length) { s += "D13*\n"; pcb.vias.forEach(function (v) { s += XY(v[0], v[1]) + "D03*\n"; }); }
      return file("Copper,L" + (layer + 1) + "," + (layer ? "Bot" : "Top"), ap, s);
    };
    var mask = function (side) {
      var s = "G01*\nD10*\n";
      pads.forEach(function (p) { s += XY(p.x, p.y) + "D03*\n"; });
      return file("Soldermask," + side, [PAD + 0.1], s);
    };
    var silkBody = "G01*\nD10*\n";
    silk.forEach(function (k) {
      silkBody += line([[k.x0, k.y0], [k.x1, k.y0], [k.x1, k.y1], [k.x0, k.y1], [k.x0, k.y0]]);
      PCB.strokes(k.ref, k.x0 + 0.5, k.y0 + 0.5, 1.3).forEach(function (st) { silkBody += line(st); });
    });
    PCB.strokes(String(title || "").replace(/[^A-Za-z0-9 +\-_.]/g, "").slice(0, 28), 8, H - 2.6, 1.4).forEach(function (st) { silkBody += line(st); });
    var edge = "G01*\nD10*\n" + line(outline(pcb, 10));
    var drill = "M48\n; Chalk Circuit Lab — " + (title || "board") + "\nMETRIC,TZ\nFMAT,2\nT1C" + DRILL.toFixed(3) + "\nT2C" + VIA_DRILL.toFixed(3) + "\nT3C" + HOLE.toFixed(3) + "\n%\nG90\nG05\n";
    var hit = function (x, y) { return "X" + x.toFixed(3) + "Y" + (H - y).toFixed(3) + "\n"; };
    drill += "T1\n"; pads.forEach(function (p) { drill += hit(p.x, p.y); });
    if (pcb.vias.length) { drill += "T2\n"; pcb.vias.forEach(function (v) { drill += hit(v[0], v[1]); }); }
    if (holes.length) { drill += "T3\n"; holes.forEach(function (h) { drill += hit(h[0], h[1]); }); }
    drill += "T0\nM30\n";
    var rep = PCB.report(doc, model), base = String(title || "board").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "board";
    var readme = "Circuit board: " + (title || "board") + "\r\nMade in Chalk Circuit Lab.\r\n\r\n" +
      "Size: " + pcb.w.toFixed(1) + " x " + pcb.h.toFixed(1) + " mm, 2 copper layers, 1.6 mm FR4.\r\n" +
      "Tracks 0.4 mm (signals) and 0.6 mm (power), smallest gap 0.2 mm. Pads " + PAD + " mm with " + DRILL + " mm holes; vias " + VIA + "/" + VIA_DRILL + " mm.\r\n" +
      rep.parts + " parts, " + rep.nets + " nets, " + rep.vias + " vias. " + (rep.open ? "WARNING: " + rep.open + " connection(s) are NOT routed — finish them with wire links, or go back and re-route.\r\n" : "Every connection is routed.\r\n") +
      "\r\nFiles\r\n  " + base + "-F_Cu.gtl        top copper\r\n  " + base + "-B_Cu.gbl        bottom copper\r\n  " + base + "-F_Mask.gts      top solder mask\r\n  " + base + "-B_Mask.gbs      bottom solder mask\r\n  " +
      base + "-F_SilkS.gto     top silkscreen\r\n  " + base + "-Edge_Cuts.gm1   board outline\r\n  " + base + ".drl              drill hits (Excellon, mm)\r\n  parts-list.csv       what to buy and where it goes\r\n" +
      "\r\nUpload the zip as it is to a board house (JLCPCB, PCBWay, Aisler, OSH Park all take it), and look at their preview before you pay.\r\n" +
      "Parts that live off the board (motors, batteries, servos) have a row of pads marked with their reference: solder their leads there.\r\n" +
      "This board was laid out by a program for a classroom project. Have someone who knows boards look it over before trusting it with anything that matters.\r\n";
    return [
      { name: base + "-F_Cu.gtl", data: copper(0) }, { name: base + "-B_Cu.gbl", data: copper(1) },
      { name: base + "-F_Mask.gts", data: mask("Top") }, { name: base + "-B_Mask.gbs", data: mask("Bot") },
      { name: base + "-F_SilkS.gto", data: file("Legend,Top", [0.15], silkBody) },
      { name: base + "-Edge_Cuts.gm1", data: file("Profile,NP", [0.1], edge) },
      { name: base + ".drl", data: drill },
      { name: "parts-list.csv", data: L.bomCsv(doc) },
      { name: "README.txt", data: readme }
    ];
  };

  /* ============================================================ THE VIEW */

  var esc = L.esc;
  var COL = { top: "#e2574c", bottom: "#4f8ff7", pad: "#e0b84e", silk: "#f3f6f8", rat: "#ffd36b" };

  function PcbView(app, host) {
    this.app = app;
    this.host = host;
    this.vis = { top: true, bottom: true, silk: true, rats: true };
    this.look = "layers";
    this.auto = true;
    this.cam = null;
    this.model = null;
    this.build();
  }
  L.PcbView = PcbView;

  PcbView.prototype.build = function () {
    var self = this, h = this.host;
    h.innerHTML =
      '<div class="st-bar" role="toolbar" aria-label="Circuit board">' +
        '<button type="button" data-pcb="place" title="Lay the parts out again from scratch">Auto-arrange</button>' +
        '<button type="button" data-pcb="route" class="primary" title="Draw the copper tracks">Route tracks</button>' +
        '<button type="button" data-pcb="fit" title="Shrink the board to wrap the parts">Trim board</button>' +
        '<label class="st-chk"><input type="checkbox" data-pcb="auto" checked> Re-route as I move parts</label>' +
        '<span class="st-sep" aria-hidden="true"></span>' +
        '<label class="st-chk c-top"><input type="checkbox" data-vis="top" checked> Top</label>' +
        '<label class="st-chk c-bot"><input type="checkbox" data-vis="bottom" checked> Bottom</label>' +
        '<label class="st-chk"><input type="checkbox" data-vis="silk" checked> Labels</label>' +
        '<label class="st-chk c-rat"><input type="checkbox" data-vis="rats" checked> Air wires</label>' +
        '<span class="st-sep" aria-hidden="true"></span>' +
        '<label class="st-num">W <input type="number" data-size="w" min="15" max="300" step="2.54"></label>' +
        '<label class="st-num">H <input type="number" data-size="h" min="15" max="300" step="2.54"> mm</label>' +
        '<label class="st-chk"><input type="checkbox" data-pcb="holes"> Mounting holes</label>' +
        '<span class="st-sep" aria-hidden="true"></span>' +
        '<div class="mode st-look" role="group" aria-label="How to draw the board"><button type="button" data-look="layers" aria-pressed="true">Layers</button><button type="button" data-look="real" aria-pressed="false">Finished</button></div>' +
        '<button type="button" data-pcb="export" class="primary" title="Gerber and drill files for a board house">Export for manufacture</button>' +
      '</div>' +
      '<svg class="pcb-svg" role="application" aria-label="Circuit board. Drag a part to move it; R turns it."></svg>' +
      '<p class="st-status" role="status" aria-live="polite"></p>';
    this.svg = h.querySelector("svg");
    this.status = h.querySelector(".st-status");
    h.querySelectorAll("[data-pcb]").forEach(function (b) {
      var k = b.getAttribute("data-pcb");
      b.addEventListener(b.type === "checkbox" ? "change" : "click", function () {
        if (k === "auto") { self.auto = b.checked; return; }
        if (k === "holes") { self.edit(function (pcb) { pcb.holes = b.checked; }, true); return; }
        self.action(k);
      });
    });
    h.querySelectorAll("[data-vis]").forEach(function (b) { b.addEventListener("change", function () { self.vis[b.getAttribute("data-vis")] = b.checked; self.render(); }); });
    h.querySelectorAll("[data-look]").forEach(function (b) {
      b.addEventListener("click", function () {
        self.look = b.getAttribute("data-look");
        h.querySelectorAll("[data-look]").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        self.render();
      });
    });
    h.querySelectorAll("[data-size]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var v = L.clamp(parseFloat(inp.value) || 0, 15, 300), k = inp.getAttribute("data-size");
        self.edit(function (pcb) { pcb[k] = r3(v); }, true);
      });
    });
    this.bind();
  };

  /* An edit to the board: undoable, saved, and re-routed if tracks moved. */
  PcbView.prototype.edit = function (fn, reroute) {
    var app = this.app, pcb = app.doc.pcb;
    app.history.push(app.doc);
    fn(pcb);
    if (reroute) { pcb.tracks = []; pcb.vias = []; pcb.open = []; if (this.auto) PCB.route(app.doc, this.model); }
    app.changed();
    this.render();
  };

  PcbView.prototype.action = function (k) {
    var self = this, app = this.app, doc = app.doc;
    if (!this.model.items.length) { app.toast("Put some parts on the bench first — the board is made from them."); return; }
    if (k === "place") { this.edit(function () { PCB.autoplace(doc, self.model); if (self.auto) PCB.route(doc, self.model); }); this.fit(); }
    if (k === "fit") { this.edit(function () { PCB.fitBoard(doc, self.model); if (self.auto) PCB.route(doc, self.model); }); this.fit(); }
    if (k === "route") {
      var res = null;
      this.edit(function () { res = PCB.route(doc, self.model); });
      app.toast(res.open.length ? res.open.length + " connection" + (res.open.length > 1 ? "s" : "") + " couldn't be routed. Spread the parts out or make the board bigger, then route again."
                                : "Routed every connection" + (res.vias.length ? " with " + res.vias.length + " via" + (res.vias.length > 1 ? "s" : "") : "") + ".");
      app.sound(res.open.length ? "err" : "win");
    }
    if (k === "export") this.exportDialog();
  };

  PcbView.prototype.exportDialog = function () {
    var self = this, app = this.app, rep = PCB.report(app.doc, this.model);
    var d = document.createElement("dialog");
    d.className = "dlg ask st-export";
    d.innerHTML = '<form method="dialog"><h2>Get the board made</h2>' +
      '<p>' + rep.w.toFixed(1) + ' × ' + rep.h.toFixed(1) + ' mm, two layers, ' + rep.parts + ' parts. ' +
      (rep.routed ? (rep.open ? '<b class="bad">' + rep.open + ' connection' + (rep.open > 1 ? "s are" : " is") + ' not routed</b> — you would have to add wire links by hand.' : 'Every connection is routed.') : '<b class="bad">The tracks haven\'t been routed yet.</b>') + '</p>' +
      '<div class="st-export-list">' +
      '<button type="button" data-x="gerber" class="primary"><b>Gerber + drill files (.zip)</b><span>Upload to JLCPCB, PCBWay, Aisler or OSH Park. Includes the parts list.</span></button>' +
      '<button type="button" data-x="svg"><b>Picture of the board (.svg)</b><span>For a worksheet, or to print 1:1 and check parts against it.</span></button>' +
      '<button type="button" data-x="bom"><b>Parts list (.csv)</b><span>What to buy, with the reference printed next to each part.</span></button>' +
      '</div><div class="ask-actions"><button value="no" type="submit">Close</button></div></form>';
    document.body.appendChild(d);
    d.addEventListener("close", function () { d.remove(); });
    d.querySelectorAll("[data-x]").forEach(function (b) {
      b.addEventListener("click", function () {
        var x = b.getAttribute("data-x"), name = app.title || "board";
        if (x === "gerber") {
          if (!rep.routed) PCB.route(app.doc, self.model), self.render();
          L.Solid.download(name + " — gerbers.zip", L.Solid.zip(PCB.gerbers(app.doc, self.model, name)), "application/zip");
        } else if (x === "svg") L.Solid.download(name + " — board.svg", self.svgText(true), "image/svg+xml");
        else L.Solid.download(name + " — parts list.csv", L.bomCsv(app.doc), "text/csv");
        app.toast("Downloaded.");
      });
    });
    d.showModal();
  };

  /* Bring the board up to date with the bench, then draw it. */
  PcbView.prototype.sync = function () {
    var app = this.app, doc = app.doc;
    this.model = PCB.model(doc, app.sim);
    var had = !!doc.pcb;
    if (!had && !this.model.items.length) { this.render(); return; }
    var changed = PCB.ensure(doc, this.model);
    if (changed && this.auto && this.model.nets.length && !doc.pcb.tracks.length) PCB.route(doc, this.model);
    if (changed && had) app.changed();
    if (!this.cam || !had) this.fit(true);
    this.render();
  };

  PcbView.prototype.fit = function (quiet) {
    var pcb = this.app.doc.pcb || { w: 60, h: 40 }, r = this.host.getBoundingClientRect();
    var W = Math.max(100, r.width), H = Math.max(100, r.height - 60), pad = 14;
    var z = Math.min(W / (pcb.w + pad * 2), H / (pcb.h + pad * 2));
    this.cam = { x: pcb.w / 2, y: pcb.h / 2 - 18 / z, z: z };
    if (!quiet) this.render();
  };
  PcbView.prototype.zoomBy = function (f) { this.cam.z = L.clamp(this.cam.z * f, 1.5, 80); this.applyCam(); };
  PcbView.prototype.applyCam = function () {
    var r = this.host.getBoundingClientRect(), c = this.cam;
    if (!c || !r.width) return;
    this.svg.setAttribute("viewBox", r3(c.x - r.width / 2 / c.z) + " " + r3(c.y - r.height / 2 / c.z) + " " + r3(r.width / c.z) + " " + r3(r.height / c.z));
  };
  PcbView.prototype.toBoard = function (cx, cy) {
    var r = this.host.getBoundingClientRect(), c = this.cam;
    return { x: (cx - r.left - r.width / 2) / c.z + c.x, y: (cy - r.top - r.height / 2) / c.z + c.y };
  };

  PcbView.prototype.svgText = function (standalone) {
    var app = this.app, doc = app.doc, pcb = doc.pcb, model = this.model, vis = this.vis, real = this.look === "real" || standalone === "real";
    if (!pcb || !model) return "";
    var sel = app.bench.sel && app.bench.sel.kind === "part" ? app.bench.sel.id : null;
    var path = function (pts) { return pts.map(function (p, i) { return (i ? "L" : "M") + p[0] + " " + p[1]; }).join(""); };
    var s = "";
    var maskCol = real ? "#17603f" : "#101a16";
    s += '<path d="' + path(outline(pcb, 10)) + 'Z" fill="' + maskCol + '" stroke="' + (real ? "#0c3b26" : "#c9a23a") + '" stroke-width="' + (real ? 0.3 : 0.15) + '"/>';
    if (!real) {
      s += '<g opacity=".16" stroke="#9fb8ad" stroke-width=".05">';
      for (var gx = 2.54; gx < pcb.w; gx += 2.54) s += '<path d="M' + r3(gx) + ' 0V' + pcb.h + '"/>';
      for (var gy = 2.54; gy < pcb.h; gy += 2.54) s += '<path d="M0 ' + r3(gy) + 'H' + pcb.w + '"/>';
      s += '</g>';
    }
    var tracks = function (layer, col, op) {
      var t = "";
      pcb.tracks.forEach(function (tr) { if (tr.l === layer) t += '<path d="' + path(tr.pts) + '" stroke-width="' + tr.w + '"/>'; });
      return '<g fill="none" stroke="' + col + '" stroke-linecap="round" stroke-linejoin="round" opacity="' + op + '">' + t + '</g>';
    };
    if (real) { if (vis.top) s += tracks(0, "#2a8a5c", 1); }
    else {
      if (vis.bottom) s += tracks(1, COL.bottom, 0.85);
      if (vis.top) s += tracks(0, COL.top, 0.9);
    }
    PCB.holes(pcb).forEach(function (hh) { s += '<circle cx="' + hh[0] + '" cy="' + hh[1] + '" r="' + (HOLE / 2 + 0.7) + '" fill="' + (real ? "#c9ced3" : "#3a4640") + '"/><circle cx="' + hh[0] + '" cy="' + hh[1] + '" r="' + HOLE / 2 + '" fill="#0b1014"/>'; });
    var silk = PCB.silk(doc, model);
    if (vis.silk) {
      s += '<g fill="none" stroke="' + COL.silk + '" stroke-width=".15" opacity="' + (real ? 0.95 : 0.6) + '">';
      silk.forEach(function (k) { s += '<rect x="' + r3(k.x0) + '" y="' + r3(k.y0) + '" width="' + r3(Math.max(0.2, k.x1 - k.x0)) + '" height="' + r3(Math.max(0.2, k.y1 - k.y0)) + '" rx=".4"' + (k.off ? ' stroke-dasharray=".6 .4"' : '') + '/>'; });
      s += '</g>';
    }
    var pads = PCB.pads(doc, model);
    pads.forEach(function (p) {
      var sq = p.first ? '<rect x="' + r3(p.x - PAD / 2) + '" y="' + r3(p.y - PAD / 2) + '" width="' + PAD + '" height="' + PAD + '" rx=".25" fill="' + (real ? "#d8dde0" : COL.pad) + '"/>'
                       : '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + PAD / 2 + '" fill="' + (real ? "#d8dde0" : COL.pad) + '"/>';
      s += sq + '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + DRILL / 2 + '" fill="#0b1014"/>';
    });
    pcb.vias.forEach(function (v) { s += '<circle cx="' + v[0] + '" cy="' + v[1] + '" r="' + VIA / 2 + '" fill="' + (real ? "#2a8a5c" : "#b7c2c9") + '"/><circle cx="' + v[0] + '" cy="' + v[1] + '" r="' + VIA_DRILL / 2 + '" fill="#0b1014"/>'; });
    if (vis.silk) {
      silk.forEach(function (k) {
        var fs = L.clamp(Math.min((k.x1 - k.x0) / (k.ref.length * 0.75), (k.y1 - k.y0) * 0.5), 1.1, 2.2);
        s += '<text x="' + r3(k.x0 + 0.5) + '" y="' + r3(k.y0 + 0.4 + fs * 0.85) + '" font-size="' + r3(fs) + '" font-family="ui-monospace,Menlo,Consolas,monospace" font-weight="700" fill="' + COL.silk + '" opacity="' + (real ? 1 : 0.85) + '">' + esc(k.ref) + '</text>';
        if (k.off && k.x1 - k.x0 > 6) s += '<text x="' + r3(k.x0 + 0.5) + '" y="' + r3(k.y1 - 0.5) + '" font-size="1" font-family="system-ui,sans-serif" fill="' + COL.silk + '" opacity=".7">' + esc(k.title.slice(0, 14)) + ' →</text>';
      });
    }
    if (vis.rats && !real) {
      var rats = pcb.tracks.length ? pcb.open : PCB.ratsnest(doc, model);
      s += '<g stroke="' + (pcb.tracks.length ? "#ff6a5a" : COL.rat) + '" stroke-width="' + (pcb.tracks.length ? 0.22 : 0.12) + '" stroke-dasharray="' + (pcb.tracks.length ? ".7 .5" : "none") + '" opacity=".9">';
      rats.forEach(function (q) { s += '<path d="M' + q[0] + ' ' + q[1] + 'L' + q[2] + ' ' + q[3] + '"/>'; });
      s += '</g>';
    }
    if (!standalone) {
      silk.forEach(function (k) {
        var p = app.partById(k.id), on = k.id === sel;
        s += '<rect class="fp' + (on ? " on" : "") + (p && p.lock ? " locked" : "") + '" data-id="' + k.id + '" x="' + r3(k.x0 - 0.4) + '" y="' + r3(k.y0 - 0.4) + '" width="' + r3(k.x1 - k.x0 + 0.8) + '" height="' + r3(k.y1 - k.y0 + 0.8) + '" rx=".6"><title>' + esc(k.ref + " — " + k.title + (k.value ? " " + k.value : "")) + '</title></rect>';
      });
      var hid = this.hoverId, hk = hid ? silk.filter(function (k) { return k.id === hid; })[0] : null;
      {
        if (hk) s += '<rect class="fp-hover" x="' + r3(hk.x0 - 1) + '" y="' + r3(hk.y0 - 1) + '" width="' + r3(hk.x1 - hk.x0 + 2) + '" height="' + r3(hk.y1 - hk.y0 + 2) + '" rx="1"/>';
      }
      return s;
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ' + (pcb.w + 4) + ' ' + (pcb.h + 4) + '" width="' + (pcb.w + 4) + 'mm" height="' + (pcb.h + 4) + 'mm">' + s + '</svg>';
  };

  PcbView.prototype.render = function () {
    var app = this.app, doc = app.doc, h = this.host;
    if (!this.model) return;
    if (!doc.pcb || !this.model.items.length) {
      this.svg.innerHTML = "";
      this.status.innerHTML = "";
      var em = h.querySelector(".st-empty");
      if (!em) { em = document.createElement("div"); em.className = "st-empty"; h.appendChild(em); }
      em.innerHTML = '<p class="big">A circuit board is made from the circuit on your bench.</p><p>Build and test a circuit on the Bench first — or ask the AI to design a whole project — then come back here and it will be laid out and routed for you.</p>';
      return;
    }
    var old = h.querySelector(".st-empty"); if (old) old.remove();
    this.svg.innerHTML = this.svgText(false);
    this.applyCam();
    var rep = PCB.report(doc, this.model), pcb = doc.pcb;
    h.querySelector('[data-size="w"]').value = pcb.w; h.querySelector('[data-size="h"]').value = pcb.h;
    h.querySelector('[data-pcb="holes"]').checked = !!pcb.holes;
    this.status.innerHTML = '<b>' + rep.w.toFixed(1) + ' × ' + rep.h.toFixed(1) + ' mm</b> · ' + rep.parts + ' parts · ' + rep.nets + ' nets · ' +
      (!rep.routed ? '<span class="warn">not routed yet — press Route tracks</span>'
        : rep.open ? '<span class="bad">' + rep.open + ' connection' + (rep.open > 1 ? "s" : "") + ' not routed</span>' : '<span class="good">every connection routed</span>') +
      (rep.routed ? ' · ' + rep.vias + ' vias · ' + Math.round(rep.length) + ' mm of track' : '');
  };

  PcbView.prototype.hoverMark = function (id) { if (this.hoverId !== id) { this.hoverId = id; this.render(); } };

  PcbView.prototype.rotate = function (id) {
    var self = this, pl = this.app.doc.pcb && this.app.doc.pcb.place[id];
    if (!pl) return;
    this.edit(function () { pl.rot = ((pl.rot || 0) + 1) % 4; PCB.grow(self.app.doc, self.model); }, true);
  };

  PcbView.prototype.bind = function () {
    var self = this, svg = this.svg, g = null;
    svg.addEventListener("wheel", function (e) {
      e.preventDefault();
      var before = self.toBoard(e.clientX, e.clientY);
      self.cam.z = L.clamp(self.cam.z * Math.exp(-e.deltaY * 0.0015), 1.5, 80);
      var after = self.toBoard(e.clientX, e.clientY);
      self.cam.x += before.x - after.x; self.cam.y += before.y - after.y;
      self.applyCam();
    }, { passive: false });
    svg.addEventListener("pointerdown", function (e) {
      svg.setPointerCapture(e.pointerId);
      var fp = e.target.closest && e.target.closest(".fp"), wp = self.toBoard(e.clientX, e.clientY);
      if (fp) {
        var id = fp.getAttribute("data-id"), pl = self.app.doc.pcb.place[id];
        self.app.bench.select({ kind: "part", id: id });
        g = { kind: "part", id: id, start: wp, ox: pl.x, oy: pl.y, moved: false };
      } else g = { kind: "pan", sx: e.clientX, sy: e.clientY, cx: self.cam.x, cy: self.cam.y, moved: false };
    });
    svg.addEventListener("pointermove", function (e) {
      if (!g) return;
      if (g.kind === "pan") {
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 3) g.moved = true;
        self.cam.x = g.cx - (e.clientX - g.sx) / self.cam.z; self.cam.y = g.cy - (e.clientY - g.sy) / self.cam.z;
        self.applyCam();
        return;
      }
      var app = self.app, pcb = app.doc.pcb, pl = pcb.place[g.id], wp = self.toBoard(e.clientX, e.clientY), part = app.partById(g.id);
      var nx = snapG(g.ox + wp.x - g.start.x), ny = snapG(g.oy + wp.y - g.start.y);
      if (nx === pl.x && ny === pl.y) return;
      if (part && part.lock) { g = null; app.toast("That part is locked in place. Unlock it in the component list to move it."); return; }
      if (!g.moved) { g.moved = true; app.history.push(app.doc); pcb.tracks = []; pcb.vias = []; pcb.open = []; }
      var b = PCB.bounds(self.model.index[g.id].fp, pl.rot || 0);
      pl.x = r3(L.clamp(nx, snapG(1.27 - b.x0 + G / 2), snapG(pcb.w - 1.27 - b.x1 - G / 2)));
      pl.y = r3(L.clamp(ny, snapG(1.27 - b.y0 + G / 2), snapG(pcb.h - 1.27 - b.y1 - G / 2)));
      self.render();
    });
    var up = function () {
      var was = g; g = null;
      if (!was) return;
      if (was.kind === "pan") { if (!was.moved) self.app.bench.select(null); return; }
      if (was.moved) {
        if (self.auto) PCB.route(self.app.doc, self.model);
        self.app.changed();
        self.render();
      }
    };
    svg.addEventListener("pointerup", up);
    svg.addEventListener("pointercancel", up);
    svg.addEventListener("dblclick", function (e) { var fp = e.target.closest && e.target.closest(".fp"); if (fp) self.rotate(fp.getAttribute("data-id")); });
    if (root.ResizeObserver) new ResizeObserver(function () { if (self.cam) self.applyCam(); }).observe(this.host);
  };
})(typeof window !== "undefined" ? window : globalThis);
