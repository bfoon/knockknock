/* Chalk Circuit Lab — solids.
 *
 * The geometry under the body designer: the shapes a toy car, a submarine
 * or a rocket is made from, the boolean operations that turn a pile of
 * shapes into one printable shell, and the files a 3-D printer wants.
 * Nothing here touches the page, so all of it runs under Node for tests.
 *
 *   Solid.unit(shape, p)        a shape that fills a 1 × 1 × 1 box at the origin
 *   Solid.fromSpec(spec, grow)  that shape sized, turned and placed (mm)
 *   Solid.union / subtract / intersect
 *   Solid.tris(mesh)            triangles, for drawing and for STL
 *   Solid.stl(tris, name)       a binary STL file (Uint8Array)
 *   Solid.zip(files)            several files in one .zip, stored uncompressed
 *
 * A mesh is a list of convex polygons, each {v: [[x, y, z], …]} wound
 * anticlockwise seen from outside. X is forward, Y is left, Z is up, and
 * every length is a millimetre — the units a slicer assumes.
 *
 * The booleans are the classic BSP-tree method (after Evan Wallace's
 * csg.js): each solid becomes a tree of planes, and each solid's polygons
 * are clipped against the other's tree. It is exact enough for printing
 * and small enough to read.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab = root.ChalkLab || {};
  var S = L.Solid = {};
  var EPS = 1e-5;

  /* ------------------------------------------------------------ vectors */

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function lerp(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  S.vec = { sub: sub, dot: dot, cross: cross };

  /* Newell's method: the plane of a polygon, steady even when three of its
   * corners happen to be nearly in a line. */
  function planeOf(v) {
    var n = [0, 0, 0];
    for (var i = 0; i < v.length; i++) {
      var a = v[i], b = v[(i + 1) % v.length];
      n[0] += (a[1] - b[1]) * (a[2] + b[2]);
      n[1] += (a[2] - b[2]) * (a[0] + b[0]);
      n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    var len = Math.sqrt(dot(n, n));
    if (len < 1e-12) return null;
    n = [n[0] / len, n[1] / len, n[2] / len];
    return { n: n, w: dot(n, v[0]) };
  }
  function poly(v) { var p = planeOf(v); return p ? { v: v, p: p } : null; }
  function flip(pg) { return { v: pg.v.slice().reverse(), p: { n: [-pg.p.n[0], -pg.p.n[1], -pg.p.n[2]], w: -pg.p.w } }; }

  function mesh(list) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var pg = list[i].p ? list[i] : poly(list[i].v || list[i]);
      if (pg && pg.v.length >= 3) out.push(pg);
    }
    return out;
  }
  S.mesh = mesh;

  /* ----------------------------------------------------------- booleans */

  var COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;

  function split(plane, pg, coFront, coBack, front, back) {
    var type = 0, types = [], i, n = pg.v.length;
    for (i = 0; i < n; i++) {
      var t = dot(plane.n, pg.v[i]) - plane.w;
      var ty = t < -EPS ? BACK : t > EPS ? FRONT : COPLANAR;
      type |= ty; types.push(ty);
    }
    switch (type) {
      case COPLANAR: (dot(plane.n, pg.p.n) > 0 ? coFront : coBack).push(pg); break;
      case FRONT: front.push(pg); break;
      case BACK: back.push(pg); break;
      default: {
        var f = [], b = [];
        for (i = 0; i < n; i++) {
          var j = (i + 1) % n, ti = types[i], tj = types[j], vi = pg.v[i], vj = pg.v[j];
          if (ti !== BACK) f.push(vi);
          if (ti !== FRONT) b.push(vi);
          if ((ti | tj) === SPANNING) {
            var d = sub(vj, vi), tt = (plane.w - dot(plane.n, vi)) / dot(plane.n, d), v = lerp(vi, vj, tt);
            f.push(v); b.push(v);
          }
        }
        if (f.length >= 3) { var pf = { v: f, p: pg.p }; front.push(pf); }
        if (b.length >= 3) { var pb = { v: b, p: pg.p }; back.push(pb); }
      }
    }
  }

  function Node(polys) { this.plane = null; this.front = null; this.back = null; this.polys = []; if (polys && polys.length) this.build(polys); }
  Node.prototype.invert = function () {
    for (var i = 0; i < this.polys.length; i++) this.polys[i] = flip(this.polys[i]);
    if (this.plane) this.plane = { n: [-this.plane.n[0], -this.plane.n[1], -this.plane.n[2]], w: -this.plane.w };
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    var t = this.front; this.front = this.back; this.back = t;
  };
  Node.prototype.clipPolygons = function (polys) {
    if (!this.plane) return polys.slice();
    var front = [], back = [];
    for (var i = 0; i < polys.length; i++) split(this.plane, polys[i], front, back, front, back);
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return front.concat(back);
  };
  Node.prototype.clipTo = function (bsp) {
    this.polys = bsp.clipPolygons(this.polys);
    if (this.front) this.front.clipTo(bsp);
    if (this.back) this.back.clipTo(bsp);
  };
  Node.prototype.all = function () {
    var out = this.polys.slice();
    if (this.front) out = out.concat(this.front.all());
    if (this.back) out = out.concat(this.back.all());
    return out;
  };
  Node.prototype.build = function (polys) {
    if (!polys.length) return;
    /* a plane from the middle of the list keeps the tree shallower than
     * always taking the first, which matters for round shapes */
    if (!this.plane) this.plane = polys[polys.length >> 1].p;
    var front = [], back = [];
    for (var i = 0; i < polys.length; i++) split(this.plane, polys[i], this.polys, this.polys, front, back);
    if (front.length) { if (!this.front) this.front = new Node(); this.front.build(front); }
    if (back.length) { if (!this.back) this.back = new Node(); this.back.build(back); }
  };

  function bbox(m) {
    var lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (var i = 0; i < m.length; i++) for (var j = 0; j < m[i].v.length; j++) for (var k = 0; k < 3; k++) {
      var c = m[i].v[j][k];
      if (c < lo[k]) lo[k] = c;
      if (c > hi[k]) hi[k] = c;
    }
    return { lo: lo, hi: hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
  }
  S.bbox = bbox;
  function apart(a, b) {
    if (!a.length || !b.length) return true;
    var A = bbox(a), B = bbox(b);
    for (var k = 0; k < 3; k++) if (A.lo[k] > B.hi[k] + EPS || B.lo[k] > A.hi[k] + EPS) return true;
    return false;
  }

  S.union = function (A, B) {
    if (!A.length) return B.slice();
    if (!B.length) return A.slice();
    if (apart(A, B)) return A.concat(B);
    var a = new Node(A), b = new Node(B);
    a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
    a.build(b.all());
    return a.all();
  };
  S.subtract = function (A, B) {
    if (!A.length || !B.length || apart(A, B)) return A.slice();
    var a = new Node(A), b = new Node(B);
    a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert();
    a.build(b.all()); a.invert();
    return a.all();
  };
  S.intersect = function (A, B) {
    if (!A.length || !B.length || apart(A, B)) return [];
    var a = new Node(A), b = new Node(B);
    a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a);
    a.build(b.all()); a.invert();
    return a.all();
  };

  /* -------------------------------------------------------- unit shapes */

  var SEG = 28;

  function box() {
    var q = [[[0, 4, 6, 2], [-1, 0, 0]], [[1, 3, 7, 5], [1, 0, 0]], [[0, 1, 5, 4], [0, -1, 0]],
             [[2, 6, 7, 3], [0, 1, 0]], [[0, 2, 3, 1], [0, 0, -1]], [[4, 5, 7, 6], [0, 0, 1]]];
    return mesh(q.map(function (f) {
      return { v: f[0].map(function (i) { return [(i & 1 ? 0.5 : -0.5), (i & 2 ? 0.5 : -0.5), (i & 4 ? 0.5 : -0.5)]; }) };
    }));
  }

  /* Spin a profile [[r, z], …] (z rising) round the Z axis. */
  function revolve(profile, seg) {
    seg = seg || SEG;
    var out = [], n = profile.length, k, i;
    var at = function (r, a, z) { return [r * Math.cos(a), r * Math.sin(a), z]; };
    for (k = 0; k < seg; k++) {
      var a0 = 2 * Math.PI * k / seg, a1 = 2 * Math.PI * (k + 1) / seg;
      for (i = 0; i < n - 1; i++) {
        var p = profile[i], q = profile[i + 1], v = [];
        if (p[0] < 1e-9 && q[0] < 1e-9) continue;
        v.push(at(p[0], a0, p[1]));
        if (p[0] > 1e-9) v.push(at(p[0], a1, p[1]));
        v.push(at(q[0], a1, q[1]));
        if (q[0] > 1e-9) v.push(at(q[0], a0, q[1]));
        out.push({ v: v });
      }
    }
    var cap = function (r, z, up) {
      var v = [];
      for (k = 0; k < seg; k++) { var a = 2 * Math.PI * (up ? k : seg - k) / seg; v.push(at(r, a, z)); }
      out.push({ v: v });
    };
    if (profile[0][0] > 1e-9) cap(profile[0][0], profile[0][1], false);
    if (profile[n - 1][0] > 1e-9) cap(profile[n - 1][0], profile[n - 1][1], true);
    return mesh(out);
  }
  S.revolve = revolve;

  /* Ear clipping: cut a simple (possibly dented) outline into triangles. */
  function triangulate(pts) {
    var idx = pts.map(function (_, i) { return i; }), out = [], guard = 0;
    var area = function (a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); };
    var inside = function (p, a, b, c) { return area(a, b, p) >= -1e-12 && area(b, c, p) >= -1e-12 && area(c, a, p) >= -1e-12; };
    while (idx.length > 3 && guard++ < 5000) {
      var cut = false;
      for (var i = 0; i < idx.length; i++) {
        var ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
        var a = pts[ia], b = pts[ib], c = pts[ic];
        if (area(a, b, c) <= 1e-12) continue;
        var ear = true;
        for (var j = 0; j < idx.length; j++) {
          var k = idx[j];
          if (k === ia || k === ib || k === ic) continue;
          if (inside(pts[k], a, b, c)) { ear = false; break; }
        }
        if (!ear) continue;
        out.push([ia, ib, ic]); idx.splice(i, 1); cut = true; break;
      }
      if (!cut) idx.splice(0, 1);        /* a degenerate corner: drop it and carry on */
    }
    if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
    return out;
  }
  S.triangulate = triangulate;

  /* Push an anticlockwise outline [[x, y], …] up from z = -½ to z = ½. */
  function extrude(pts) {
    var out = [], n = pts.length, t = triangulate(pts);
    t.forEach(function (f) {
      out.push({ v: [f[2], f[1], f[0]].map(function (i) { return [pts[i][0], pts[i][1], -0.5]; }) });
      out.push({ v: f.map(function (i) { return [pts[i][0], pts[i][1], 0.5]; }) });
    });
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      out.push({ v: [[a[0], a[1], -0.5], [b[0], b[1], -0.5], [b[0], b[1], 0.5], [a[0], a[1], 0.5]] });
    }
    return mesh(out);
  }
  S.extrude = extrude;

  /* Turn, size and place a mesh. r is degrees about X, then Y, then Z. */
  function xf(m, o) {
    o = o || {};
    var s = o.s || [1, 1, 1], t = o.t || [0, 0, 0], M = S.rot(o.r || [0, 0, 0]);
    var mirror = s[0] * s[1] * s[2] < 0, out = [];
    for (var i = 0; i < m.length; i++) {
      var v = m[i].v.map(function (q) {
        var x = q[0] * s[0], y = q[1] * s[1], z = q[2] * s[2];
        return [M[0] * x + M[1] * y + M[2] * z + t[0], M[3] * x + M[4] * y + M[5] * z + t[1], M[6] * x + M[7] * y + M[8] * z + t[2]];
      });
      if (mirror) v.reverse();
      var pg = poly(v);
      if (pg) out.push(pg);
    }
    return out;
  }
  S.xf = xf;
  S.rot = function (r) {
    var d = Math.PI / 180, cx = Math.cos(r[0] * d), sx = Math.sin(r[0] * d), cy = Math.cos(r[1] * d), sy = Math.sin(r[1] * d), cz = Math.cos(r[2] * d), sz = Math.sin(r[2] * d);
    /* Rz · Ry · Rx, row-major */
    return [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
            sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
            -sy, cy * sx, cy * cx];
  };

  var UNIT = {
    box: box,
    cyl: function () { return revolve([[0.5, -0.5], [0.5, 0.5]]); },
    cone: function (p) { var top = L.clamp(+(p && p.top) || 0, 0, 1); return revolve([[0.5, -0.5], [0.5 * top, 0.5]]); },
    sphere: function () {
      var pr = [], n = 14;
      for (var i = 0; i <= n; i++) { var a = -Math.PI / 2 + Math.PI * i / n; pr.push([i === 0 || i === n ? 0 : 0.5 * Math.cos(a), 0.5 * Math.sin(a)]); }
      return revolve(pr);
    },
    dome: function () {
      var pr = [], n = 9;
      for (var i = 0; i <= n; i++) { var a = Math.PI / 2 * i / n; pr.push([i === n ? 0 : 0.5 * Math.cos(a), -0.5 + Math.sin(a)]); }
      return revolve(pr);
    },
    /* a rocket's nose: blunt-tipped and tangent to the tube it sits on */
    nose: function () {
      var pr = [], n = 12;
      for (var i = 0; i <= n; i++) { var t = i / n; pr.push([i === n ? 0 : 0.5 * Math.sqrt(1 - Math.pow(t, 1.7)), -0.5 + t]); }
      return revolve(pr);
    },
    /* a hull with rounded ends, lying along X. `long` is length ÷ width,
     * so the ends stay round however long the hull is stretched. */
    capsule: function (p) {
      var k = Math.max(1, +(p && p.long) || 3), pr = [], n = 8, i, a;
      for (i = 0; i <= n; i++) { a = -Math.PI / 2 + Math.PI / 2 * i / n; pr.push([i === 0 ? 0 : 0.5 * Math.cos(a), (-0.5 * k + 0.5 + 0.5 * Math.sin(a)) / k]); }
      for (i = 0; i <= n; i++) { a = Math.PI / 2 * i / n; pr.push([i === n ? 0 : 0.5 * Math.cos(a), (0.5 * k - 0.5 + 0.5 * Math.sin(a)) / k]); }
      return xf(revolve(pr), { r: [0, 90, 0] });
    },
    tube: function (p) {
      var w = L.clamp(+(p && p.wall) || 0.12, 0.02, 0.45);
      return S.subtract(UNIT.cyl(), xf(UNIT.cyl(), { s: [1 - 2 * w, 1 - 2 * w, 1.2] }));
    },
    /* a ramp: full height at the back, nothing at the front */
    wedge: function () { return xf(extrude([[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5]]), { r: [90, 0, 0] }); },
    /* a swept fin standing in the XZ plane, root on its -X edge */
    fin: function () { return xf(extrude([[-0.5, -0.5], [0.5, -0.5], [0.5, -0.12], [-0.5, 0.5]]), { r: [90, 0, 0] }); },
    /* a car seen from the side, pushed across its width */
    carbody: function () {
      return xf(extrude([[-0.5, -0.5], [0.5, -0.5], [0.5, -0.02], [0.3, 0.06], [0.14, 0.5], [-0.3, 0.5], [-0.46, 0.08], [-0.5, 0.0]]), { r: [90, 0, 0] });
    },
    /* a boat seen from above: square stern, pointed bow */
    boat: function () { return extrude([[-0.5, -0.5], [0.15, -0.5], [0.5, 0], [0.15, 0.5], [-0.5, 0.5]]); },
    /* a wheel that rolls along X: tyre, rim and a recessed hub */
    wheel: function () {
      var pr = [[0.5 * 0.86, -0.5], [0.5 * 0.97, -0.42], [0.5, -0.28], [0.5, 0.28], [0.5 * 0.97, 0.42], [0.5 * 0.86, 0.5]];
      return xf(revolve(pr), { r: [90, 0, 0] });
    },
    /* a three-bladed propeller on the X axis */
    prop: function () {
      var m = xf(UNIT.cyl(), { s: [0.3, 0.3, 1], r: [0, 90, 0] });
      for (var i = 0; i < 3; i++) {
        var blade = xf(box(), { s: [0.5, 0.07, 0.4], r: [0, 0, 28], t: [0, 0, 0.29] });
        m = S.union(m, xf(blade, { r: [i * 120, 0, 0] }));
      }
      return m;
    }
  };
  S.SHAPES = {
    box: "Box", cyl: "Cylinder", cone: "Cone", sphere: "Ball", dome: "Dome", nose: "Nose cone", capsule: "Rounded hull",
    tube: "Tube", wedge: "Ramp", fin: "Fin", carbody: "Car body", boat: "Boat hull", wheel: "Wheel", prop: "Propeller"
  };

  var cache = {};
  S.unit = function (shape, p) {
    if (!UNIT[shape]) shape = "box";
    var key = shape + "|" + (shape === "cone" ? (p && p.top) || 0 : shape === "capsule" ? Math.round(Math.max(1, (p && p.long) || 3) * 20) / 20 : shape === "tube" ? (p && p.wall) || 0.12 : "");
    return cache[key] || (cache[key] = UNIT[shape](p || {}));
  };

  /* A solid from the document: {shape, sx, sy, sz, x, y, z, rx, ry, rz, p}.
   * `grow` adds to every size (negative to shrink) — the inside of a
   * hollow shell is the same shape, smaller by twice the wall. */
  S.fromSpec = function (s, grow) {
    var g = grow || 0, sx = Math.max(0.2, (+s.sx || 10) + g), sy = Math.max(0.2, (+s.sy || 10) + g), sz = Math.max(0.2, (+s.sz || 10) + g);
    var p = s.p || {};
    if (s.shape === "capsule") p = { long: sx / Math.max(sy, sz) };
    return xf(S.unit(s.shape, p), { s: [sx, sy, sz], r: [+s.rx || 0, +s.ry || 0, +s.rz || 0], t: [+s.x || 0, +s.y || 0, +s.z || 0] });
  };

  /* -------------------------------------------------------- triangles */

  S.tris = function (m) {
    var out = [];
    for (var i = 0; i < m.length; i++) {
      var v = m[i].v;
      for (var j = 1; j < v.length - 1; j++) out.push([v[0], v[j], v[j + 1], m[i].p.n]);
    }
    return out;
  };

  /* Triangles for printing. Cutting solids against each other leaves
   * "T-junctions": a corner of one face sitting part-way along the edge of
   * its neighbour. They are invisible, but a slicer sees a crack. This
   * snaps corners that should coincide, puts every such corner into the
   * edge it sits on, and then triangulates, so each edge is shared by
   * exactly two triangles — a closed, printable skin. */
  S.sealed = function (m) {
    var Q = 2000, verts = {}, list = [], cell = 4, grid = {};
    var canon = function (v) {
      var k = Math.round(v[0] * Q) + "," + Math.round(v[1] * Q) + "," + Math.round(v[2] * Q);
      if (!verts[k]) {
        var c = [Math.round(v[0] * Q) / Q, Math.round(v[1] * Q) / Q, Math.round(v[2] * Q) / Q];
        c.id = list.length; verts[k] = c; list.push(c);
        var g = Math.floor(c[0] / cell) + "," + Math.floor(c[1] / cell) + "," + Math.floor(c[2] / cell);
        (grid[g] = grid[g] || []).push(c);
      }
      return verts[k];
    };
    var polys = m.map(function (pg) {
      var v = [];
      pg.v.forEach(function (q) { var c = canon(q); if (!v.length || v[v.length - 1] !== c) v.push(c); });
      if (v.length > 1 && v[0] === v[v.length - 1]) v.pop();
      return { v: v, n: pg.p.n };
    }).filter(function (pg) { return pg.v.length >= 3; });
    var out = [];
    polys.forEach(function (pg) {
      var ring = [], n = pg.v.length;
      for (var i = 0; i < n; i++) {
        var a = pg.v[i], b = pg.v[(i + 1) % n], d = sub(b, a), len2 = dot(d, d), mid = [];
        ring.push(a);
        if (len2 < 1e-12) continue;
        var lo = [0, 1, 2].map(function (k) { return Math.floor((Math.min(a[k], b[k]) - 0.01) / cell); });
        var hi = [0, 1, 2].map(function (k) { return Math.floor((Math.max(a[k], b[k]) + 0.01) / cell); });
        /* a long slanting edge crosses many cells; walking its box is still
         * far cheaper than asking every corner in the mesh */
        if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 4000) continue;
        for (var x = lo[0]; x <= hi[0]; x++) for (var y = lo[1]; y <= hi[1]; y++) for (var z = lo[2]; z <= hi[2]; z++) {
          var bucket = grid[x + "," + y + "," + z];
          if (!bucket) continue;
          for (var j = 0; j < bucket.length; j++) {
            var p = bucket[j];
            if (p === a || p === b) continue;
            var ap = sub(p, a), t = dot(ap, d) / len2;
            if (t <= 1e-6 || t >= 1 - 1e-6) continue;
            var off = [ap[0] - d[0] * t, ap[1] - d[1] * t, ap[2] - d[2] * t];
            if (dot(off, off) < 1e-6) mid.push([t, p]);
          }
        }
        mid.sort(function (u, w) { return u[0] - w[0]; });
        mid.forEach(function (u) { if (ring[ring.length - 1] !== u[1]) ring.push(u[1]); });
      }
      if (ring.length === 3) { out.push([ring[0], ring[1], ring[2], pg.n]); return; }
      /* flatten along the face's steepest axis, keeping it anticlockwise */
      var ax = Math.abs(pg.n[0]), ay = Math.abs(pg.n[1]), az = Math.abs(pg.n[2]), flat;
      if (az >= ax && az >= ay) flat = ring.map(function (q) { return pg.n[2] > 0 ? [q[0], q[1]] : [q[1], q[0]]; });
      else if (ay >= ax) flat = ring.map(function (q) { return pg.n[1] > 0 ? [q[2], q[0]] : [q[0], q[2]]; });
      else flat = ring.map(function (q) { return pg.n[0] > 0 ? [q[1], q[2]] : [q[2], q[1]]; });
      triangulate(flat).forEach(function (f) { out.push([ring[f[0]], ring[f[1]], ring[f[2]], pg.n]); });
    });
    return out;
  };

  /* How many edges are not shared by exactly two triangles, the right way
   * round. Zero means the skin is closed. */
  S.leaks = function (tris) {
    var e = {}, bad = 0, key = function (v) { return Math.round(v[0] * 2000) + "," + Math.round(v[1] * 2000) + "," + Math.round(v[2] * 2000); };
    tris.forEach(function (t) { for (var i = 0; i < 3; i++) { var k = key(t[i]) + "|" + key(t[(i + 1) % 3]); e[k] = (e[k] || 0) + 1; } });
    Object.keys(e).forEach(function (k) { var q = k.split("|"); if (e[k] !== (e[q[1] + "|" + q[0]] || 0) || e[k] > 1) bad++; });
    return bad;
  };

  /* Signed volume, mm³ — also a quick proof that a mesh is closed and the
   * right way out: a leaky or inside-out one gives nonsense or a negative. */
  S.volume = function (tris) {
    var v = 0;
    for (var i = 0; i < tris.length; i++) v += dot(tris[i][0], cross(tris[i][1], tris[i][2])) / 6;
    return v;
  };

  S.stl = function (tris, name) {
    var buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf), head = ("Chalk Circuit Lab — " + (name || "part")).slice(0, 79);
    for (var i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 127);
    dv.setUint32(80, tris.length, true);
    var o = 84;
    for (i = 0; i < tris.length; i++) {
      var t = tris[i], n = t[3] || [0, 0, 0];
      dv.setFloat32(o, n[0], true); dv.setFloat32(o + 4, n[1], true); dv.setFloat32(o + 8, n[2], true); o += 12;
      for (var k = 0; k < 3; k++) { dv.setFloat32(o, t[k][0], true); dv.setFloat32(o + 4, t[k][1], true); dv.setFloat32(o + 8, t[k][2], true); o += 12; }
      dv.setUint16(o, 0, true); o += 2;
    }
    return new Uint8Array(buf);
  };

  /* ---------------------------------------------------------------- zip */

  var CRC = null;
  function crc32(u8) {
    if (!CRC) { CRC = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
    var crc = 0xffffffff;
    for (var i = 0; i < u8.length; i++) crc = CRC[(crc ^ u8[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  S.crc32 = crc32;
  function utf8(s) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
    var out = [], e = unescape(encodeURIComponent(s));
    for (var i = 0; i < e.length; i++) out.push(e.charCodeAt(i));
    return new Uint8Array(out);
  }
  S.utf8 = utf8;

  /* files: [{name, data}] where data is text or bytes. Stored, not
   * compressed: STL and Gerber are small, and "stored" needs no library. */
  S.zip = function (files) {
    var parts = [], central = [], offset = 0, total = 0;
    files.forEach(function (f) {
      var name = utf8(f.name), data = typeof f.data === "string" ? utf8(f.data) : f.data, crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var csize = central.reduce(function (n, u) { return n + u.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, csize, true); e.setUint32(16, offset, true);
    var all = parts.concat(central, [new Uint8Array(e.buffer)]);
    all.forEach(function (u) { total += u.length; });
    var out = new Uint8Array(total), o = 0;
    all.forEach(function (u) { out.set(u, o); o += u.length; });
    return out;
  };

  /* Hand a file to the browser's download shelf. */
  S.download = function (name, data, mime) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: mime || "application/octet-stream" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  };
})(typeof window !== "undefined" ? window : globalThis);
