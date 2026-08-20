/* Chalk — shape geometry.
 *
 * Every shape is drawn inside a 0..100 x 0..100 box and stretched to the
 * element's real size by the SVG viewBox, so one builder serves any size.
 *
 * A builder returns { parts: [{ d, role, rule? }], open: bool }.
 * role tells the renderer how to paint it:
 *   face      fill with the element's fill colour
 *   side      fill, darkened  (the shaded face of a solid)
 *   top       fill, lightened (the lit face of a solid)
 *   line      stroke only, no fill
 *   linefill  fill with the element's stroke colour (arrow heads, dots)
 *
 * window.ChalkShapes = { list, build, presets, seedPoints, pathFromPoints }
 */
(function (global) {
  "use strict";

  var TAU = Math.PI * 2;
  function n(v) { return Math.round(v * 100) / 100; }
  function P(x, y) { return n(x) + "," + n(y); }
  function poly(pts, close) {
    var d = "M" + P(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) d += "L" + P(pts[i][0], pts[i][1]);
    return close === false ? d : d + "Z";
  }
  /* Full ellipse as two arcs. */
  function ell(cx, cy, rx, ry) {
    return "M" + P(cx - rx, cy) +
      "A" + n(rx) + "," + n(ry) + " 0 1 0 " + P(cx + rx, cy) +
      "A" + n(rx) + "," + n(ry) + " 0 1 0 " + P(cx - rx, cy) + "Z";
  }
  function clampNum(v, lo, hi, dflt) {
    v = Number(v);
    if (!isFinite(v)) return dflt;
    return Math.min(hi, Math.max(lo, v));
  }

  /* ------------------------------------------------------------------ */
  /* 2D                                                                  */
  /* ------------------------------------------------------------------ */

  var B = {};

  B.line = function () {
    return { parts: [{ d: "M" + P(0, 50) + "L" + P(100, 50), role: "line" }], open: true };
  };

  B.arrow = function (o) {
    var hw = clampNum(o.head, 8, 45, 22), hh = hw * 0.72;
    return {
      parts: [
        { d: "M" + P(0, 50) + "L" + P(100 - hw * 0.65, 50), role: "line" },
        { d: poly([[100, 50], [100 - hw, 50 - hh], [100 - hw, 50 + hh]]), role: "linefill" }
      ],
      open: true
    };
  };

  B.darrow = function (o) {
    var hw = clampNum(o.head, 8, 40, 20), hh = hw * 0.72;
    return {
      parts: [
        { d: "M" + P(hw * 0.65, 50) + "L" + P(100 - hw * 0.65, 50), role: "line" },
        { d: poly([[100, 50], [100 - hw, 50 - hh], [100 - hw, 50 + hh]]), role: "linefill" },
        { d: poly([[0, 50], [hw, 50 - hh], [hw, 50 + hh]]), role: "linefill" }
      ],
      open: true
    };
  };

  B.rect = function () {
    return { parts: [{ d: poly([[0, 0], [100, 0], [100, 100], [0, 100]]), role: "face" }] };
  };

  B.rrect = function (o) {
    var r = clampNum(o.radius, 0, 50, 14);
    var d = "M" + P(r, 0) +
      "L" + P(100 - r, 0) + "A" + n(r) + "," + n(r) + " 0 0 1 " + P(100, r) +
      "L" + P(100, 100 - r) + "A" + n(r) + "," + n(r) + " 0 0 1 " + P(100 - r, 100) +
      "L" + P(r, 100) + "A" + n(r) + "," + n(r) + " 0 0 1 " + P(0, 100 - r) +
      "L" + P(0, r) + "A" + n(r) + "," + n(r) + " 0 0 1 " + P(r, 0) + "Z";
    return { parts: [{ d: d, role: "face" }] };
  };

  B.ellipse = function () { return { parts: [{ d: ell(50, 50, 50, 50), role: "face" }] }; };

  B.triangle = function () {
    return { parts: [{ d: poly([[50, 0], [100, 100], [0, 100]]), role: "face" }] };
  };

  B.rtriangle = function () {
    return { parts: [{ d: poly([[0, 0], [0, 100], [100, 100]]), role: "face" }] };
  };

  B.diamond = function () {
    return { parts: [{ d: poly([[50, 0], [100, 50], [50, 100], [0, 50]]), role: "face" }] };
  };

  B.parallelogram = function (o) {
    var s = clampNum(o.slant, 0, 45, 22);
    return { parts: [{ d: poly([[s, 0], [100, 0], [100 - s, 100], [0, 100]]), role: "face" }] };
  };

  B.trapezoid = function (o) {
    var s = clampNum(o.slant, 0, 45, 22);
    return { parts: [{ d: poly([[s, 0], [100 - s, 0], [100, 100], [0, 100]]), role: "face" }] };
  };

  B.polygon = function (o) {
    var k = Math.round(clampNum(o.sides, 3, 24, 6)), pts = [], i, a;
    for (i = 0; i < k; i++) {
      a = -Math.PI / 2 + (i / k) * TAU;
      pts.push([50 + 50 * Math.cos(a), 50 + 50 * Math.sin(a)]);
    }
    return { parts: [{ d: poly(pts), role: "face" }] };
  };

  B.star = function (o) {
    var k = Math.round(clampNum(o.sides, 3, 20, 5));
    var inset = clampNum(o.inset, 10, 90, 45) / 100;
    var pts = [], i, a, r;
    for (i = 0; i < k * 2; i++) {
      a = -Math.PI / 2 + (i / (k * 2)) * TAU;
      r = i % 2 ? 50 * inset : 50;
      pts.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
    }
    return { parts: [{ d: poly(pts), role: "face" }] };
  };

  B.cross = function (o) {
    var t = clampNum(o.thickness, 10, 45, 30);
    var a = 50 - t / 2, b = 50 + t / 2;
    return {
      parts: [{
        d: poly([[a, 0], [b, 0], [b, a], [100, a], [100, b], [b, b],
                 [b, 100], [a, 100], [a, b], [0, b], [0, a], [a, a]]),
        role: "face"
      }]
    };
  };

  B.chevron = function (o) {
    var t = clampNum(o.thickness, 10, 60, 34);
    return {
      parts: [{
        d: poly([[0, 0], [t, 0], [100, 50], [t, 100], [0, 100], [100 - t, 50]]),
        role: "face"
      }]
    };
  };

  B.brace = function () {
    return {
      parts: [{
        d: "M" + P(90, 0) + "C" + P(55, 4) + " " + P(62, 44) + " " + P(14, 50) +
           "C" + P(62, 56) + " " + P(55, 96) + " " + P(90, 100),
        role: "line"
      }],
      open: true
    };
  };

  /* Geometry angle: two rays from the corner plus the marker arc. */
  B.angle = function (o) {
    var deg = clampNum(o.degrees, 5, 175, 45);
    var a = deg * Math.PI / 180;
    var ex = 100 * Math.cos(a), ey = 100 - 100 * Math.sin(a);
    var r = 30;
    var ax = r, ay = 100;
    var bx = r * Math.cos(a), by = 100 - r * Math.sin(a);
    var large = deg > 180 ? 1 : 0;
    return {
      parts: [
        { d: "M" + P(0, 100) + "L" + P(100, 100), role: "line" },
        { d: "M" + P(0, 100) + "L" + P(ex, ey), role: "line" },
        { d: "M" + P(ax, ay) + "A" + r + "," + r + " 0 " + large + " 1 " + P(bx, by), role: "line" }
      ],
      open: true
    };
  };

  /* ------------------------------------------------------------------ */
  /* 3D solids — parametric isometrics, not real 3D. Fast, crisp on a    */
  /* projector, and they take the board's own colours.                   */
  /* ------------------------------------------------------------------ */

  B.cube = function (o) {
    var d = clampNum(o.depth, 4, 45, 22);
    return {
      parts: [
        { d: poly([[0, d], [d, 0], [100, 0], [100 - d, d]]), role: "top" },
        { d: poly([[100 - d, d], [100, 0], [100, 100 - d], [100 - d, 100]]), role: "side" },
        { d: poly([[0, d], [100 - d, d], [100 - d, 100], [0, 100]]), role: "face" }
      ]
    };
  };

  B.cylinder = function (o) {
    var d = clampNum(o.depth, 4, 40, 15);
    return {
      parts: [
        { d: "M" + P(0, d) + "L" + P(0, 100 - d) +
             "A50," + n(d) + " 0 0 0 " + P(100, 100 - d) + "L" + P(100, d) + "Z", role: "face" },
        { d: ell(50, d, 50, d), role: "top" }
      ]
    };
  };

  B.cone = function (o) {
    var d = clampNum(o.depth, 4, 40, 15);
    return {
      parts: [
        { d: ell(50, 100 - d, 50, d), role: "side" },
        { d: "M" + P(50, 0) + "L" + P(0, 100 - d) +
             "A50," + n(d) + " 0 0 0 " + P(100, 100 - d) + "Z", role: "face" }
      ]
    };
  };

  B.sphere = function () {
    return {
      parts: [
        { d: ell(50, 50, 50, 50), role: "face" },
        { d: ell(34, 33, 15, 11), role: "top" },
        { d: "M" + P(0, 50) + "A50,14 0 0 0 " + P(100, 50), role: "line" }
      ]
    };
  };

  B.pyramid = function (o) {
    var d = clampNum(o.depth, 4, 45, 22);
    var FL = [0, 100], FR = [100 - d, 100], BR = [100, 100 - d], A = [50, 0];
    return {
      parts: [
        { d: poly([A, FR, BR]), role: "side" },
        { d: poly([A, FL, FR]), role: "face" }
      ]
    };
  };

  B.prism = function (o) {
    var d = clampNum(o.depth, 4, 45, 22);
    var FA = [(100 - d) / 2, d], FL = [0, 100], FR = [100 - d, 100];
    var BA = [(100 - d) / 2 + d, 0], BR = [100, 100 - d];
    return {
      parts: [
        { d: poly([FA, BA, BR, FR]), role: "top" },
        { d: poly([FA, FR, FL]), role: "face" }
      ]
    };
  };

  B.torus = function (o) {
    var hole = clampNum(o.hole, 10, 70, 40) / 100;
    return {
      parts: [
        { d: ell(50, 50, 50, 30) + ell(50, 50, 50 * hole, 30 * hole), role: "face", rule: "evenodd" },
        { d: "M" + P(50 - 50 * hole, 50) + "A" + n(50 * hole) + "," + n(30 * hole) +
             " 0 0 0 " + P(50 + 50 * hole, 50), role: "line" }
      ]
    };
  };

  var LIST = [
    { id: "line", name: "Line", group: "2D" },
    { id: "arrow", name: "Arrow", group: "2D" },
    { id: "darrow", name: "Double arrow", group: "2D" },
    { id: "rect", name: "Rectangle", group: "2D" },
    { id: "rrect", name: "Rounded box", group: "2D" },
    { id: "ellipse", name: "Circle", group: "2D" },
    { id: "triangle", name: "Triangle", group: "2D" },
    { id: "rtriangle", name: "Right triangle", group: "2D" },
    { id: "diamond", name: "Diamond", group: "2D" },
    { id: "parallelogram", name: "Parallelogram", group: "2D" },
    { id: "trapezoid", name: "Trapezium", group: "2D" },
    { id: "polygon", name: "Polygon", group: "2D" },
    { id: "star", name: "Star", group: "2D" },
    { id: "cross", name: "Cross", group: "2D" },
    { id: "chevron", name: "Chevron", group: "2D" },
    { id: "brace", name: "Brace", group: "2D" },
    { id: "angle", name: "Angle", group: "2D" },
    { id: "cube", name: "Cube", group: "3D" },
    { id: "cylinder", name: "Cylinder", group: "3D" },
    { id: "cone", name: "Cone", group: "3D" },
    { id: "sphere", name: "Sphere", group: "3D" },
    { id: "pyramid", name: "Pyramid", group: "3D" },
    { id: "prism", name: "Prism", group: "3D" },
    { id: "torus", name: "Ring", group: "3D" }
  ];

  function build(shape, opts) {
    var fn = B[shape] || B.rect;
    return fn(opts || {});
  }

  /* ------------------------------------------------------------------ */
  /* Freeform — presets only SEED the points; every vertex is editable.  */
  /* ------------------------------------------------------------------ */

  var PRESETS = [
    { id: "polygon", name: "Polygon", closed: true },
    { id: "star", name: "Star", closed: true },
    { id: "burst", name: "Burst", closed: true },
    { id: "blob", name: "Blob", closed: true },
    { id: "arrow", name: "Block arrow", closed: true },
    { id: "chevron", name: "Chevron", closed: true },
    { id: "cross", name: "Cross", closed: true },
    { id: "bubble", name: "Speech bubble", closed: true },
    { id: "heart", name: "Heart", closed: true },
    { id: "drop", name: "Drop", closed: true },
    { id: "wave", name: "Wave", closed: false },
    { id: "custom", name: "Blank", closed: true }
  ];

  function seedPoints(preset, sides, inset) {
    sides = Math.round(clampNum(sides, 3, 24, 6));
    inset = clampNum(inset, 10, 90, 45) / 100;
    var pts = [], i, a, r;

    switch (preset) {
      case "star":
      case "burst":
        var k = preset === "burst" ? Math.max(sides, 10) : sides;
        var ins = preset === "burst" ? Math.min(inset, 0.62) : inset;
        for (i = 0; i < k * 2; i++) {
          a = -Math.PI / 2 + (i / (k * 2)) * TAU;
          r = i % 2 ? 50 * ins : 50;
          pts.push(50 + r * Math.cos(a), 50 + r * Math.sin(a));
        }
        return pts;

      case "blob":
        var wob = [1, .82, .95, .74, 1, .86, .92, .78];
        for (i = 0; i < 8; i++) {
          a = -Math.PI / 2 + (i / 8) * TAU;
          r = 50 * wob[i];
          pts.push(50 + r * Math.cos(a), 50 + r * Math.sin(a));
        }
        return pts;

      case "arrow":
        return [0, 32, 58, 32, 58, 8, 100, 50, 58, 92, 58, 68, 0, 68];

      case "chevron":
        return [0, 0, 34, 0, 100, 50, 34, 100, 0, 100, 66, 50];

      case "cross":
        return [35, 0, 65, 0, 65, 35, 100, 35, 100, 65, 65, 65,
                65, 100, 35, 100, 35, 65, 0, 65, 0, 35, 35, 35];

      case "bubble":
        return [6, 4, 94, 4, 94, 68, 42, 68, 22, 96, 26, 68, 6, 68];

      case "heart":
        for (i = 0; i < 20; i++) {
          var t = (i / 20) * TAU;
          var hx = 16 * Math.pow(Math.sin(t), 3);
          var hy = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
          pts.push(50 + hx * 3, 48 - hy * 3);
        }
        return pts;

      case "drop":
        pts.push(50, 0);
        for (i = 1; i < 14; i++) {
          a = -Math.PI / 2 + (i / 14) * TAU;
          r = 42 * (0.55 + 0.45 * Math.abs(Math.sin(a / 2 + Math.PI / 4)));
          pts.push(50 + r * Math.cos(a), 62 + r * Math.sin(a) * 0.9);
        }
        return pts;

      case "wave":
        for (i = 0; i <= 12; i++) {
          pts.push((i / 12) * 100, 50 - 34 * Math.sin((i / 12) * TAU));
        }
        return pts;

      case "custom":
        return [20, 20, 80, 26, 70, 82, 26, 74];

      default: /* polygon */
        for (i = 0; i < sides; i++) {
          a = -Math.PI / 2 + (i / sides) * TAU;
          pts.push(50 + 50 * Math.cos(a), 50 + 50 * Math.sin(a));
        }
        return pts;
    }
  }

  /* Build an SVG path from a flat point list in 0..100 space.
   * edge: "sharp" | "round" (corner cut-back) | "smooth" (Catmull-Rom) */
  function pathFromPoints(pts, closed, edge, radius) {
    var k = pts.length >> 1;
    if (k < 2) return "";
    var i, d;
    var at = function (j) {
      var m = ((j % k) + k) % k;
      return [pts[m * 2], pts[m * 2 + 1]];
    };

    if (edge === "smooth" && k >= 3) {
      d = "M" + P(at(0)[0], at(0)[1]);
      var last = closed ? k : k - 1;
      for (i = 0; i < last; i++) {
        var p0 = at(closed ? i - 1 : Math.max(0, i - 1));
        var p1 = at(i), p2 = at(closed ? i + 1 : Math.min(k - 1, i + 1));
        var p3 = at(closed ? i + 2 : Math.min(k - 1, i + 2));
        d += "C" + P(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6) +
             " " + P(p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6) +
             " " + P(p2[0], p2[1]);
      }
      return closed ? d + "Z" : d;
    }

    if (edge === "round" && k >= 3) {
      var r = clampNum(radius, 0, 50, 14);
      d = "";
      var start = closed ? 0 : 1;
      var end = closed ? k : k - 1;
      if (!closed) d = "M" + P(at(0)[0], at(0)[1]);
      for (i = start; i < end; i++) {
        var c = at(i), a1 = at(i - 1), b1 = at(i + 1);
        var v1 = [a1[0] - c[0], a1[1] - c[1]], v2 = [b1[0] - c[0], b1[1] - c[1]];
        var l1 = Math.hypot(v1[0], v1[1]) || 1, l2 = Math.hypot(v2[0], v2[1]) || 1;
        var cut = Math.min(r, l1 / 2, l2 / 2);
        var s1 = [c[0] + v1[0] / l1 * cut, c[1] + v1[1] / l1 * cut];
        var s2 = [c[0] + v2[0] / l2 * cut, c[1] + v2[1] / l2 * cut];
        d += (i === start && closed ? "M" + P(s1[0], s1[1]) : "L" + P(s1[0], s1[1]));
        d += "Q" + P(c[0], c[1]) + " " + P(s2[0], s2[1]);
      }
      return closed ? d + "Z" : d;
    }

    d = "M" + P(at(0)[0], at(0)[1]);
    for (i = 1; i < k; i++) d += "L" + P(at(i)[0], at(i)[1]);
    return closed ? d + "Z" : d;
  }

  global.ChalkShapes = {
    list: LIST,
    build: build,
    presets: PRESETS,
    seedPoints: seedPoints,
    pathFromPoints: pathFromPoints
  };
})(window);
