/* Chalk — ready-made boards.
 *
 * A template is a function that returns a list of ordinary elements. Nothing
 * here is a special kind of object: once a template is on the board it is a
 * pile of text, shapes and free shapes like any other, so every one of them
 * can be dragged, resized, recoloured, deleted, or written over by hand. That
 * is the whole point — a teacher should be able to start from a number line
 * and end up somewhere the number line did not plan for.
 *
 * Everything is laid out in normalised board space, 0..1 on both axes, on a
 * 16:9 board. So a template drawn here is the same template on a phone pad
 * and on a 4K projector.
 *
 * Two rules worth knowing before adding one:
 *
 *   - Colours come from the palette, never hard-coded. The same template has
 *     to read on a blackboard and on a whiteboard, and white chalk on white
 *     paper is a template nobody can use.
 *   - Lines are free shapes with explicit points, not the "line" shape. A
 *     free shape's geometry is in the element, so it survives being stretched
 *     into any box and can have its corners dragged afterwards.
 *
 * window.ChalkTemplates = { subjects, list, palette }
 */
(function (global) {
  "use strict";

  function r(v) { return Math.round(v * 10000) / 10000; }
  function rr(v) { return Math.round(v * 100) / 100; }

  /* The board can be nearly black or nearly white, and a template that only
   * works on one of them is half a template. */
  function palette(surface) {
    var dark = surface !== "white" && surface !== "grid" && surface !== "ruled";
    return {
      dark: dark,
      ink: dark ? "#ffffff" : "#111827",
      faint: dark ? "#93a7b4" : "#64748b",
      amber: "#d9a441",
      blue: "#56b7e6",
      green: "#4bbf7a",
      red: "#d9614a",
      violet: "#b98cf0"
    };
  }

  /* ---- element helpers ---------------------------------------------- */

  function put(e, x, y, w, h) {
    e.x = r(x);
    e.y = r(y);
    e.w = r(Math.max(0.012, w));
    e.h = r(Math.max(0.012, h));
    return e;
  }

  function text(p, x, y, w, str, o) {
    o = o || {};
    var size = o.size || 0.05;
    var e = ChalkEls.blank("text", { text: str, color: o.color || p.ink });
    e.size = size;
    e.align = o.align || "left";
    e.bold = !!o.bold;
    e.italic = !!o.italic;
    e.font = o.font || "sans";
    if (o.bg) e.bg = o.bg;
    if (o.rot) e.rot = o.rot;
    return put(e, x, y, w, o.h || size * 1.45);
  }

  var SHAPE_KNOBS = [
    "sides", "inset", "depth", "radius", "thickness",
    "slant", "head", "degrees", "hole"
  ];

  function shp(p, name, x, y, w, h, o) {
    o = o || {};
    var e = ChalkEls.blank("shape", { shape: name, stroke: o.stroke || p.ink });
    e.fillOn = !!o.fill;
    if (o.fill) e.fill = o.fill;
    e.strokeW = o.strokeW == null ? 2 : o.strokeW;
    e.dash = o.dash || 0;
    if (o.rot) e.rot = o.rot;
    SHAPE_KNOBS.forEach(function (k) { if (o[k] != null) e[k] = o[k]; });
    return put(e, x, y, w, h);
  }

  /* A free shape from board coordinates. The element's box is the bounding
   * box of the points, and the points are re-expressed inside it, so the
   * corner handles land where the drawing actually is. */
  function poly(p, coords, o) {
    o = o || {};
    var xs = [], ys = [], i;
    for (i = 0; i < coords.length; i += 2) {
      xs.push(coords[i]);
      ys.push(coords[i + 1]);
    }
    var x = Math.min.apply(null, xs), y = Math.min.apply(null, ys);
    var w = Math.max.apply(null, xs) - x, h = Math.max.apply(null, ys) - y;
    if (w < 0.014) { x -= (0.014 - w) / 2; w = 0.014; }
    if (h < 0.014) { y -= (0.014 - h) / 2; h = 0.014; }

    var e = ChalkEls.blank("freeform", { stroke: o.stroke || p.ink });
    /* Built as a polygon and then overwritten: `custom` has no seed shape to
     * generate from, and asking for one would be asking for nothing. */
    e.preset = "custom";
    e.edited = true;
    e.pts = [];
    for (i = 0; i < coords.length; i += 2) {
      e.pts.push(rr((coords[i] - x) / w * 100), rr((coords[i + 1] - y) / h * 100));
    }
    e.closed = !!o.closed;
    e.fillOn = !!o.fill;
    if (o.fill) e.fill = o.fill;
    e.stroke = o.stroke || p.ink;
    e.strokeW = o.strokeW == null ? 2 : o.strokeW;
    e.dash = o.dash || 0;
    e.edge = o.edge || "sharp";
    if (o.radius != null) e.radius = o.radius;
    return put(e, x, y, w, h);
  }

  function seg(p, x1, y1, x2, y2, o) {
    return poly(p, [x1, y1, x2, y2], o);
  }

  function box(p, x, y, w, h, o) {
    return poly(p, [x, y, x + w, y, x + w, y + h, x, y + h],
      Object.assign({ closed: true }, o || {}));
  }

  function circle(p, cx, cy, rx, ry, o) {
    return shp(p, "ellipse", cx - rx, cy - ry, rx * 2, ry * 2, o);
  }

  /* Arrows are the one place a built-in shape earns its keep: it carries a
   * head that stays in proportion when the shaft is stretched. */
  function arrow(p, x1, y1, x2, y2, o) {
    o = o || {};
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 0.05;
    var deg = Math.atan2(dy, dx) * 180 / Math.PI;
    var th = o.thick || 0.05;
    var e = shp(p, "arrow", x1, (y1 + y2) / 2 - th / 2, len, th, {
      stroke: o.stroke || p.ink,
      fill: o.fill || (o.stroke || p.ink),
      strokeW: o.strokeW == null ? 1.5 : o.strokeW,
      head: o.head || 30,
      thickness: o.thickness || 26
    });
    /* Rotation is about the box centre, so the box is placed on the line's
     * midpoint first and then turned. */
    e.x = r(x1 + dx / 2 - len / 2);
    e.y = r(y1 + dy / 2 - th / 2);
    e.rot = r(deg);
    return e;
  }

  function label(p, x, y, w, str, o) {
    return text(p, x, y, w, str, Object.assign({ size: 0.035, color: p.faint }, o || {}));
  }

  function title(p, str, o) {
    return text(p, 0.05, 0.035, 0.9, str,
      Object.assign({ size: 0.062, bold: true }, o || {}));
  }

  /* ---- drawing helpers ------------------------------------------------
   *
   * Pictures are easier to think about in board units than in fractions: the
   * board is 16 wide and 9 tall, and a circle is a circle. Everything below
   * takes those units and converts, so a flower stays a flower and does not
   * come out as an oval because the numbers were in fractions of two
   * different lengths.
   */

  function ubox(X, Y, W, H) {
    return { x: (X - W / 2) / 16, y: (Y - H / 2) / 9, w: W / 16, h: H / 9 };
  }

  function ushp(p, name, X, Y, W, H, o) {
    var b = ubox(X, Y, W, H);
    return shp(p, name, b.x, b.y, b.w, b.h, o);
  }

  function udisc(p, X, Y, D, o) { return ushp(p, "ellipse", X, Y, D, D, o); }

  function upoly(p, coords, o) {
    var mapped = [];
    for (var i = 0; i < coords.length; i += 2) {
      mapped.push(coords[i] / 16, coords[i + 1] / 9);
    }
    return poly(p, mapped, o);
  }

  function useg(p, X1, Y1, X2, Y2, o) {
    return upoly(p, [X1, Y1, X2, Y2], o);
  }

  function utext(p, X, Y, W, str, o) {
    return text(p, (X - W / 2) / 16, Y / 9, W / 16, str, o);
  }

  /* A petal, leaf or wing: an oval pushed out from a centre and turned to
   * face outward. */
  function petal(p, cx, cy, angle, dist, len, wide, o) {
    var a = angle * Math.PI / 180;
    var e = ushp(p, "ellipse",
      cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, len, wide, o);
    e.rot = Math.round(angle * 10) / 10;
    return e;
  }

  /* A crescent whose two tips meet. Sweeping an inner circle from a shifted
   * centre leaves the ends open, so the inner edge is the outer edge pulled
   * in by an amount that goes to nothing at both tips. */
  function crescent(cx, cy, rad, thick, from, to, steps) {
    var out = [], back = [], i;
    for (i = 0; i <= steps; i++) {
      var t = i / steps;
      var a = (from + (to - from) * t) * Math.PI / 180;
      var pull = Math.sin(t * Math.PI) * thick;
      out.push(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      back.unshift(cx + Math.cos(a) * (rad - pull), cy + Math.sin(a) * (rad - pull));
    }
    return out.concat(back);
  }

  function ring(cx, cy, rad, from, to, steps, squash) {
    var out = [], i;
    for (i = 0; i <= steps; i++) {
      var a = (from + (to - from) * i / steps) * Math.PI / 180;
      out.push(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * (squash || 1));
    }
    return out;
  }

  /* ---- the library --------------------------------------------------- */

  var SUBJECTS = [
    { id: "maths", name: "Maths" },
    { id: "science", name: "Science" },
    { id: "english", name: "English" },
    { id: "class", name: "Class" },
    { id: "draw", name: "Drawing" }
  ];

  var LIST = [];
  function T(subject, id, name, hint, build) {
    LIST.push({ id: id, subject: subject, name: name, hint: hint, build: build });
  }

  /* ================================ MATHS ============================= */

  T("maths", "number-line", "Number line", "0 to 10, with ticks", function (p) {
    var out = [title(p, "Number line")], i, x;
    out.push(seg(p, 0.07, 0.55, 0.93, 0.55, { strokeW: 3 }));
    for (i = 0; i <= 10; i++) {
      x = 0.07 + (0.86 * i / 10);
      out.push(seg(p, x, 0.5, x, 0.6, { strokeW: 2 }));
      out.push(text(p, x - 0.035, 0.63, 0.07, String(i), { size: 0.042, align: "center" }));
    }
    return out;
  });

  T("maths", "grid", "Coordinate grid", "Axes, gridlines and numbers", function (p) {
    var out = [], i, x, y;
    var L = 0.12, R = 0.92, TP = 0.08, B = 0.88;
    for (i = 0; i <= 10; i++) {
      x = L + (R - L) * i / 10;
      y = B - (B - TP) * i / 10;
      out.push(seg(p, x, TP, x, B, { stroke: p.faint, strokeW: 1, dash: 3 }));
      out.push(seg(p, L, y, R, y, { stroke: p.faint, strokeW: 1, dash: 3 }));
    }
    out.push(seg(p, L, B, R, B, { strokeW: 3 }));
    out.push(seg(p, L, TP, L, B, { strokeW: 3 }));
    for (i = 0; i <= 10; i += 2) {
      x = L + (R - L) * i / 10;
      y = B - (B - TP) * i / 10;
      out.push(text(p, x - 0.03, B + 0.02, 0.06, String(i), { size: 0.033, align: "center" }));
      out.push(text(p, L - 0.065, y - 0.02, 0.055, String(i), { size: 0.033, align: "right" }));
    }
    out.push(text(p, R - 0.05, B + 0.02, 0.06, "x", { size: 0.04, italic: true }));
    out.push(text(p, L - 0.02, TP - 0.05, 0.06, "y", { size: 0.04, italic: true }));
    return out;
  });

  T("maths", "place-value", "Place value chart", "Th · H · T · U", function (p) {
    var out = [title(p, "Place value")];
    var cols = ["Thousands", "Hundreds", "Tens", "Units"];
    var L = 0.08, W = 0.84, TP = 0.2, H = 0.62;
    out.push(box(p, L, TP, W, H, { strokeW: 3 }));
    out.push(seg(p, L, TP + 0.12, L + W, TP + 0.12, { strokeW: 2 }));
    cols.forEach(function (c, i) {
      var x = L + W * i / 4;
      if (i) out.push(seg(p, x, TP, x, TP + H, { strokeW: 2 }));
      out.push(text(p, x, TP + 0.035, W / 4, c,
        { size: 0.04, align: "center", bold: true, color: p.amber }));
    });
    return out;
  });

  T("maths", "fraction-wall", "Fraction wall", "Whole down to sixths", function (p) {
    var out = [title(p, "Fraction wall")];
    var tints = [p.amber, p.blue, p.green, p.violet, p.red, p.faint];
    var L = 0.08, W = 0.84, TP = 0.2, RH = 0.11;
    for (var n = 1; n <= 6; n++) {
      var y = TP + (n - 1) * (RH + 0.012);
      for (var i = 0; i < n; i++) {
        var x = L + W * i / n;
        out.push(box(p, x, y, W / n, RH, { stroke: tints[n - 1], strokeW: 2 }));
      }
      out.push(text(p, L - 0.065, y + RH / 2 - 0.022, 0.06,
        n === 1 ? "1" : "1/" + n, { size: 0.033, align: "right", color: tints[n - 1] }));
    }
    return out;
  });

  T("maths", "times-table", "Times table grid", "10 by 10, empty", function (p) {
    var out = [], i;
    var L = 0.16, TP = 0.14, W = 0.78, H = 0.8, C = W / 11, R = H / 11;
    for (i = 0; i <= 11; i++) {
      out.push(seg(p, L + C * i, TP, L + C * i, TP + H, { stroke: p.faint, strokeW: i === 1 ? 2.5 : 1 }));
      out.push(seg(p, L, TP + R * i, L + W, TP + R * i, { stroke: p.faint, strokeW: i === 1 ? 2.5 : 1 }));
    }
    out.push(text(p, L, TP + R * 0.2, C, "×", { size: 0.04, align: "center", bold: true, color: p.amber }));
    for (i = 1; i <= 10; i++) {
      out.push(text(p, L + C * i, TP + R * 0.2, C, String(i),
        { size: 0.034, align: "center", color: p.amber }));
      out.push(text(p, L, TP + R * i + R * 0.2, C, String(i),
        { size: 0.034, align: "center", color: p.amber }));
    }
    return out;
  });

  T("maths", "column-sum", "Column addition", "H T U with a rule", function (p) {
    var out = [title(p, "Column addition")];
    var L = 0.34, W = 0.32, TP = 0.22;
    ["H", "T", "U"].forEach(function (c, i) {
      out.push(text(p, L + W * i / 3, TP, W / 3, c,
        { size: 0.04, align: "center", color: p.amber }));
      out.push(seg(p, L + W * (i + 1) / 3, TP + 0.07, L + W * (i + 1) / 3, TP + 0.42,
        { stroke: p.faint, strokeW: 1, dash: 4 }));
    });
    out.push(seg(p, L - 0.06, TP + 0.42, L + W, TP + 0.42, { strokeW: 3 }));
    out.push(text(p, L - 0.12, TP + 0.3, 0.06, "+", { size: 0.055, align: "center" }));
    out.push(seg(p, L - 0.06, TP + 0.58, L + W, TP + 0.58, { strokeW: 3 }));
    out.push(seg(p, L - 0.06, TP + 0.605, L + W, TP + 0.605, { strokeW: 3 }));
    return out;
  });

  T("maths", "clock", "Clock face", "Hours, minutes and hands", function (p) {
    var out = [title(p, "What is the time?")];
    var cx = 0.5, cy = 0.56, rad = 0.3;
    out.push(circle(p, cx, cy, rad * 9 / 16, rad, { strokeW: 3 }));
    for (var i = 1; i <= 12; i++) {
      var a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      var lx = cx + Math.cos(a) * rad * 0.46, ly = cy + Math.sin(a) * rad * 0.82;
      out.push(text(p, lx - 0.03, ly - 0.025, 0.06, String(i),
        { size: 0.04, align: "center", color: p.amber }));
    }
    out.push(seg(p, cx, cy, cx + 0.06, cy - 0.14, { strokeW: 5 }));
    out.push(seg(p, cx, cy, cx - 0.02, cy + 0.2, { strokeW: 3, stroke: p.red }));
    return out;
  });

  T("maths", "bar-chart", "Bar chart frame", "Axes and five labels", function (p) {
    var out = [title(p, "Bar chart")];
    var L = 0.14, B = 0.86, TP = 0.2, R = 0.92, i;
    for (i = 1; i <= 5; i++) {
      var y = B - (B - TP) * i / 5;
      out.push(seg(p, L, y, R, y, { stroke: p.faint, strokeW: 1, dash: 3 }));
      out.push(text(p, L - 0.075, y - 0.02, 0.065, String(i * 2),
        { size: 0.032, align: "right", color: p.faint }));
    }
    out.push(seg(p, L, TP, L, B, { strokeW: 3 }));
    out.push(seg(p, L, B, R, B, { strokeW: 3 }));
    for (i = 0; i < 5; i++) {
      out.push(text(p, L + (R - L) * (i + 0.1) / 5, B + 0.02, (R - L) / 5 * 0.8,
        "…", { size: 0.036, align: "center", color: p.faint }));
    }
    return out;
  });

  T("maths", "triangle", "Right-angled triangle", "Labelled a, b, c", function (p) {
    var out = [title(p, "Pythagoras")];
    var x1 = 0.28, y1 = 0.78, x2 = 0.72, y2 = 0.78, x3 = 0.28, y3 = 0.3;
    out.push(poly(p, [x1, y1, x2, y2, x3, y3], { closed: true, strokeW: 3 }));
    out.push(box(p, x1, y1 - 0.06, 0.035, 0.06, { stroke: p.amber, strokeW: 2 }));
    out.push(text(p, x1 - 0.07, (y1 + y3) / 2 - 0.03, 0.06, "a",
      { size: 0.05, align: "right", italic: true, color: p.blue }));
    out.push(text(p, (x1 + x2) / 2 - 0.03, y1 + 0.02, 0.06, "b",
      { size: 0.05, align: "center", italic: true, color: p.blue }));
    out.push(text(p, (x2 + x3) / 2 + 0.03, (y1 + y3) / 2 - 0.07, 0.06, "c",
      { size: 0.05, italic: true, color: p.amber }));
    out.push(text(p, 0.62, 0.24, 0.32, "a² + b² = c²", { size: 0.05, color: p.amber }));
    return out;
  });

  T("maths", "circle-parts", "Parts of a circle", "Radius, diameter, centre", function (p) {
    var out = [title(p, "Parts of a circle")];
    var cx = 0.44, cy = 0.56, rad = 0.28;
    out.push(circle(p, cx, cy, rad * 9 / 16, rad, { strokeW: 3 }));
    out.push(seg(p, cx, cy, cx + rad * 9 / 16, cy, { stroke: p.amber, strokeW: 2.5 }));
    out.push(seg(p, cx - rad * 9 / 16, cy + 0.001, cx + rad * 9 / 16, cy + 0.001,
      { stroke: p.blue, strokeW: 2.5, dash: 5 }));
    out.push(circle(p, cx, cy, 0.008, 0.014, { fill: p.ink, strokeW: 0 }));
    out.push(text(p, cx + 0.02, cy - 0.06, 0.16, "radius", { size: 0.036, color: p.amber }));
    out.push(text(p, cx - 0.14, cy + 0.02, 0.18, "diameter", { size: 0.036, color: p.blue }));
    out.push(text(p, 0.72, 0.4, 0.26, "circumference", { size: 0.036, color: p.faint }));
    return out;
  });

  T("maths", "venn2", "Venn diagram", "Two sets", function (p) {
    var out = [title(p, "Venn diagram")];
    out.push(circle(p, 0.4, 0.56, 0.17, 0.3, { stroke: p.blue, strokeW: 3 }));
    out.push(circle(p, 0.6, 0.56, 0.17, 0.3, { stroke: p.amber, strokeW: 3 }));
    out.push(text(p, 0.14, 0.2, 0.22, "Set A", { size: 0.045, color: p.blue, bold: true }));
    out.push(text(p, 0.64, 0.2, 0.22, "Set B", { size: 0.045, color: p.amber, bold: true }));
    out.push(label(p, 0.44, 0.86, 0.12, "both", { align: "center" }));
    return out;
  });

  T("maths", "shapes-2d", "2D shapes", "Six named shapes", function (p) {
    var out = [title(p, "2D shapes")];
    var names = [
      ["rect", "Rectangle"], ["triangle", "Triangle"], ["ellipse", "Circle"],
      ["diamond", "Rhombus"], ["trapezoid", "Trapezium"], ["polygon", "Hexagon"]
    ];
    names.forEach(function (n, i) {
      var col = i % 3, row = (i / 3) | 0;
      var x = 0.11 + col * 0.29, y = 0.2 + row * 0.36;
      out.push(shp(p, n[0], x, y, 0.19, 0.22, { strokeW: 3, stroke: p.ink }));
      out.push(text(p, x - 0.02, y + 0.24, 0.23, n[1],
        { size: 0.036, align: "center", color: p.faint }));
    });
    return out;
  });

  T("maths", "division", "Long division", "Bracket and working space", function (p) {
    var out = [title(p, "Long division")];
    out.push(poly(p, [0.44, 0.24, 0.3, 0.34, 0.3, 0.62], { strokeW: 3 }));
    out.push(seg(p, 0.3, 0.34, 0.78, 0.34, { strokeW: 3 }));
    out.push(text(p, 0.16, 0.42, 0.12, "?", { size: 0.06, align: "right", color: p.faint }));
    out.push(label(p, 0.3, 0.66, 0.5, "working out"));
    return out;
  });

  /* =============================== SCIENCE ============================ */

  T("science", "water-cycle", "Water cycle", "Sea, sun, cloud and rain", function (p) {
    var out = [title(p, "The water cycle")];
    out.push(circle(p, 0.85, 0.2, 0.045, 0.08, { stroke: p.amber, strokeW: 3 }));
    out.push(text(p, 0.76, 0.3, 0.2, "Sun", { size: 0.036, align: "center", color: p.amber }));
    out.push(circle(p, 0.44, 0.26, 0.1, 0.09, { stroke: p.blue, strokeW: 3 }));
    out.push(circle(p, 0.55, 0.28, 0.07, 0.06, { stroke: p.blue, strokeW: 3 }));
    out.push(text(p, 0.4, 0.22, 0.18, "Cloud", { size: 0.036, align: "center", color: p.blue }));
    out.push(poly(p, [0.06, 0.78, 0.2, 0.74, 0.35, 0.79, 0.5, 0.75, 0.66, 0.79, 0.8, 0.75, 0.94, 0.79],
      { stroke: p.blue, strokeW: 3 }));
    out.push(text(p, 0.06, 0.86, 0.2, "Sea", { size: 0.04, color: p.blue }));
    out.push(arrow(p, 0.2, 0.7, 0.3, 0.34, { stroke: p.green }));
    out.push(text(p, 0.06, 0.48, 0.16, "evaporation", { size: 0.032, color: p.green }));
    out.push(arrow(p, 0.6, 0.4, 0.72, 0.7, { stroke: p.blue }));
    out.push(text(p, 0.68, 0.5, 0.16, "rain", { size: 0.032, color: p.blue }));
    return out;
  });

  T("science", "plant-cell", "Plant cell", "Wall, nucleus, chloroplasts", function (p) {
    var out = [title(p, "Plant cell")];
    out.push(box(p, 0.16, 0.2, 0.5, 0.62, { strokeW: 4, stroke: p.green }));
    out.push(box(p, 0.185, 0.23, 0.45, 0.56, { strokeW: 2, stroke: p.ink }));
    out.push(circle(p, 0.34, 0.46, 0.05, 0.09, { strokeW: 2.5, stroke: p.violet }));
    out.push(circle(p, 0.34, 0.46, 0.018, 0.032, { fill: p.violet, strokeW: 0 }));
    [[0.48, 0.32], [0.53, 0.55], [0.44, 0.68], [0.26, 0.66]].forEach(function (c) {
      out.push(circle(p, c[0], c[1], 0.022, 0.038, { stroke: p.green, strokeW: 2 }));
    });
    out.push(box(p, 0.24, 0.3, 0.14, 0.1, { stroke: p.blue, strokeW: 2, dash: 4 }));
    out.push(text(p, 0.7, 0.24, 0.26, "cell wall", { size: 0.036, color: p.green }));
    out.push(text(p, 0.7, 0.36, 0.26, "nucleus", { size: 0.036, color: p.violet }));
    out.push(text(p, 0.7, 0.48, 0.26, "chloroplast", { size: 0.036, color: p.green }));
    out.push(text(p, 0.7, 0.6, 0.26, "vacuole", { size: 0.036, color: p.blue }));
    return out;
  });

  T("science", "circuit", "Simple circuit", "Cell, bulb and switch", function (p) {
    var out = [title(p, "Simple circuit")];
    var L = 0.2, R = 0.8, TP = 0.28, B = 0.76;
    out.push(seg(p, L, TP, R, TP, { strokeW: 3 }));
    out.push(seg(p, L, B, R, B, { strokeW: 3 }));
    out.push(seg(p, L, TP, L, B, { strokeW: 3 }));
    out.push(seg(p, R, TP, R, B, { strokeW: 3 }));
    /* cell */
    out.push(seg(p, 0.46, B - 0.05, 0.46, B + 0.05, { strokeW: 4, stroke: p.amber }));
    out.push(seg(p, 0.51, B - 0.09, 0.51, B + 0.09, { strokeW: 2.5, stroke: p.amber }));
    out.push(text(p, 0.42, B + 0.11, 0.16, "cell", { size: 0.034, align: "center", color: p.amber }));
    /* bulb */
    out.push(circle(p, 0.5, TP, 0.035, 0.062, { strokeW: 3, stroke: p.blue }));
    out.push(seg(p, 0.475, TP - 0.04, 0.525, TP + 0.04, { strokeW: 2, stroke: p.blue }));
    out.push(seg(p, 0.525, TP - 0.04, 0.475, TP + 0.04, { strokeW: 2, stroke: p.blue }));
    out.push(text(p, 0.42, TP - 0.13, 0.16, "bulb", { size: 0.034, align: "center", color: p.blue }));
    /* switch */
    out.push(seg(p, R, 0.46, R + 0.07, 0.38, { strokeW: 3, stroke: p.green }));
    out.push(text(p, R + 0.02, 0.5, 0.16, "switch", { size: 0.034, color: p.green }));
    return out;
  });

  T("science", "food-chain", "Food chain", "Four links with arrows", function (p) {
    var out = [title(p, "Food chain")];
    var names = ["Sun", "Grass", "Goat", "Lion"];
    names.forEach(function (n, i) {
      var x = 0.07 + i * 0.235;
      out.push(box(p, x, 0.42, 0.17, 0.18, { strokeW: 2.5, stroke: p.green }));
      out.push(text(p, x, 0.48, 0.17, n, { size: 0.042, align: "center" }));
      if (i < 3) out.push(arrow(p, x + 0.18, 0.51, x + 0.228, 0.51, { stroke: p.amber }));
    });
    out.push(label(p, 0.07, 0.68, 0.86, "The arrow means \u201cis eaten by\u201d."));
    return out;
  });

  T("science", "states", "States of matter", "Solid, liquid, gas", function (p) {
    var out = [title(p, "States of matter")];
    var names = ["Solid", "Liquid", "Gas"];
    names.forEach(function (n, i) {
      var x = 0.09 + i * 0.3, y = 0.24, w = 0.24, h = 0.42;
      out.push(box(p, x, y, w, h, { strokeW: 3 }));
      out.push(text(p, x, y + h + 0.03, w, n,
        { size: 0.045, align: "center", bold: true, color: p.amber }));
      var cols = 4, rows = 4, gap = i;
      for (var a = 0; a < cols; a++) {
        for (var b = 0; b < rows; b++) {
          if (i === 2 && (a + b) % 2) continue;
          var jitter = i === 0 ? 0 : (i === 1 ? 0.012 : 0.03);
          var px = x + w * (a + 0.5) / cols + (a % 2 ? jitter : -jitter);
          var py = y + h * (b + 0.5) / rows + (b % 2 ? jitter : -jitter) + gap * 0;
          out.push(circle(p, px, py, 0.008, 0.014, { fill: p.blue, strokeW: 0 }));
        }
      }
    });
    return out;
  });

  T("science", "plant-parts", "Parts of a plant", "Roots to flower", function (p) {
    var out = [title(p, "Parts of a plant")];
    out.push(seg(p, 0.4, 0.36, 0.4, 0.76, { strokeW: 4, stroke: p.green }));
    out.push(circle(p, 0.4, 0.3, 0.045, 0.08, { stroke: p.red, strokeW: 3 }));
    out.push(poly(p, [0.4, 0.5, 0.28, 0.44, 0.4, 0.56], { closed: true, strokeW: 2.5, stroke: p.green }));
    out.push(poly(p, [0.4, 0.58, 0.52, 0.52, 0.4, 0.64], { closed: true, strokeW: 2.5, stroke: p.green }));
    out.push(poly(p, [0.4, 0.76, 0.3, 0.88], { strokeW: 2.5, stroke: p.amber }));
    out.push(poly(p, [0.4, 0.76, 0.5, 0.88], { strokeW: 2.5, stroke: p.amber }));
    out.push(poly(p, [0.4, 0.76, 0.4, 0.9], { strokeW: 2.5, stroke: p.amber }));
    out.push(text(p, 0.58, 0.26, 0.3, "flower", { size: 0.038, color: p.red }));
    out.push(text(p, 0.58, 0.42, 0.3, "leaf", { size: 0.038, color: p.green }));
    out.push(text(p, 0.58, 0.58, 0.3, "stem", { size: 0.038, color: p.green }));
    out.push(text(p, 0.58, 0.8, 0.3, "roots", { size: 0.038, color: p.amber }));
    return out;
  });

  T("science", "solar", "Solar system", "Sun and four orbits", function (p) {
    var out = [title(p, "Orbits")];
    var cx = 0.5, cy = 0.56;
    out.push(circle(p, cx, cy, 0.035, 0.062, { fill: p.amber, stroke: p.amber, strokeW: 2 }));
    [0.11, 0.17, 0.24, 0.32].forEach(function (rad, i) {
      out.push(circle(p, cx, cy, rad, rad * 16 / 9 * 0.55,
        { stroke: p.faint, strokeW: 1.5, dash: 4 }));
      out.push(circle(p, cx + rad, cy, 0.014, 0.025,
        { fill: [p.blue, p.green, p.red, p.violet][i], strokeW: 0 }));
    });
    out.push(text(p, 0.06, 0.86, 0.4, "Sun · Mercury · Venus · Earth · Mars",
      { size: 0.032, color: p.faint }));
    return out;
  });

  T("science", "forces", "Forces on an object", "Four labelled arrows", function (p) {
    var out = [title(p, "Forces")];
    out.push(box(p, 0.42, 0.46, 0.16, 0.18, { strokeW: 3, stroke: p.ink }));
    out.push(arrow(p, 0.5, 0.44, 0.5, 0.24, { stroke: p.blue }));
    out.push(arrow(p, 0.5, 0.66, 0.5, 0.86, { stroke: p.red }));
    out.push(arrow(p, 0.4, 0.55, 0.2, 0.55, { stroke: p.amber }));
    out.push(arrow(p, 0.6, 0.55, 0.8, 0.55, { stroke: p.green }));
    out.push(text(p, 0.52, 0.2, 0.24, "lift", { size: 0.036, color: p.blue }));
    out.push(text(p, 0.52, 0.86, 0.24, "weight", { size: 0.036, color: p.red }));
    out.push(text(p, 0.08, 0.48, 0.2, "drag", { size: 0.036, color: p.amber }));
    out.push(text(p, 0.72, 0.48, 0.24, "push", { size: 0.036, color: p.green }));
    return out;
  });

  T("science", "beaker", "Beaker", "Scale marks and a liquid line", function (p) {
    var out = [title(p, "Measuring")];
    out.push(poly(p, [0.36, 0.24, 0.36, 0.82, 0.64, 0.82, 0.64, 0.24], { strokeW: 4 }));
    for (var i = 1; i <= 5; i++) {
      var y = 0.82 - 0.1 * i;
      out.push(seg(p, 0.36, y, 0.42, y, { strokeW: 2, stroke: p.faint }));
      out.push(text(p, 0.26, y - 0.022, 0.08, (i * 100) + "", { size: 0.03, align: "right", color: p.faint }));
    }
    out.push(seg(p, 0.36, 0.62, 0.64, 0.62, { strokeW: 3, stroke: p.blue }));
    out.push(text(p, 0.68, 0.58, 0.28, "ml", { size: 0.036, color: p.blue }));
    return out;
  });

  /* =============================== ENGLISH ============================ */

  T("english", "handwriting", "Handwriting lines", "Four-line ruling", function (p) {
    var out = [], row;
    for (row = 0; row < 4; row++) {
      var top = 0.12 + row * 0.21;
      out.push(seg(p, 0.06, top, 0.94, top, { stroke: p.faint, strokeW: 1, dash: 4 }));
      out.push(seg(p, 0.06, top + 0.05, 0.94, top + 0.05, { stroke: p.faint, strokeW: 1.5 }));
      out.push(seg(p, 0.06, top + 0.11, 0.94, top + 0.11, { strokeW: 2.5 }));
      out.push(seg(p, 0.06, top + 0.16, 0.94, top + 0.16, { stroke: p.faint, strokeW: 1, dash: 4 }));
    }
    return out;
  });

  T("english", "story-mountain", "Story mountain", "Five stages of a story", function (p) {
    var out = [title(p, "Story mountain")];
    out.push(poly(p, [0.08, 0.84, 0.28, 0.6, 0.5, 0.28, 0.72, 0.6, 0.92, 0.84],
      { strokeW: 3, edge: "smooth", radius: 20 }));
    var stops = [
      [0.06, 0.86, "Opening"], [0.22, 0.54, "Build-up"], [0.42, 0.2, "Problem"],
      [0.66, 0.54, "Resolution"], [0.8, 0.86, "Ending"]
    ];
    stops.forEach(function (s) {
      out.push(text(p, s[0], s[1], 0.2, s[2], { size: 0.036, align: "center", color: p.amber }));
    });
    return out;
  });

  T("english", "word-web", "Word web", "Centre and six branches", function (p) {
    var out = [];
    var cx = 0.5, cy = 0.52;
    out.push(circle(p, cx, cy, 0.09, 0.15, { strokeW: 3, stroke: p.amber }));
    out.push(text(p, cx - 0.09, cy - 0.028, 0.18, "topic",
      { size: 0.042, align: "center", bold: true, color: p.amber }));
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      var bx = cx + Math.cos(a) * 0.28, by = cy + Math.sin(a) * 0.36;
      out.push(seg(p, cx + Math.cos(a) * 0.1, cy + Math.sin(a) * 0.16, bx, by,
        { stroke: p.faint, strokeW: 2 }));
      out.push(circle(p, bx, by, 0.07, 0.1, { strokeW: 2, stroke: p.blue }));
      out.push(text(p, bx - 0.07, by - 0.022, 0.14, "…",
        { size: 0.036, align: "center", color: p.faint }));
    }
    return out;
  });

  T("english", "kwl", "K-W-L chart", "Know · Wonder · Learned", function (p) {
    var out = [];
    var heads = ["What I know", "What I wonder", "What I learned"];
    var L = 0.05, W = 0.9, TP = 0.12, H = 0.78;
    out.push(box(p, L, TP, W, H, { strokeW: 3 }));
    out.push(seg(p, L, TP + 0.13, L + W, TP + 0.13, { strokeW: 2.5 }));
    heads.forEach(function (h, i) {
      var x = L + W * i / 3;
      if (i) out.push(seg(p, x, TP, x, TP + H, { strokeW: 2.5 }));
      out.push(text(p, x, TP + 0.04, W / 3, h,
        { size: 0.042, align: "center", bold: true, color: p.amber }));
    });
    return out;
  });

  T("english", "spelling", "Spelling test", "Numbered 1 to 10", function (p) {
    var out = [title(p, "Spelling test")];
    for (var i = 0; i < 10; i++) {
      var col = i < 5 ? 0 : 1, row = i % 5;
      var x = 0.07 + col * 0.47, y = 0.24 + row * 0.14;
      out.push(text(p, x, y, 0.06, (i + 1) + ".", { size: 0.04, color: p.amber }));
      out.push(seg(p, x + 0.06, y + 0.06, x + 0.42, y + 0.06, { stroke: p.faint, strokeW: 1.5 }));
    }
    return out;
  });

  T("english", "parts-of-speech", "Parts of speech", "Five sorting columns", function (p) {
    var out = [];
    var heads = ["Noun", "Verb", "Adjective", "Adverb", "Pronoun"];
    var L = 0.04, W = 0.92, TP = 0.12, H = 0.78;
    out.push(box(p, L, TP, W, H, { strokeW: 3 }));
    out.push(seg(p, L, TP + 0.12, L + W, TP + 0.12, { strokeW: 2.5 }));
    heads.forEach(function (h, i) {
      var x = L + W * i / 5;
      if (i) out.push(seg(p, x, TP, x, TP + H, { strokeW: 2 }));
      out.push(text(p, x, TP + 0.035, W / 5, h,
        { size: 0.038, align: "center", bold: true, color: p.amber }));
    });
    return out;
  });

  T("english", "five-w", "The five W's", "Who, what, when, where, why", function (p) {
    var out = [title(p, "Five W\u2019s")];
    var qs = ["Who?", "What?", "When?", "Where?", "Why?"];
    qs.forEach(function (q, i) {
      var col = i % 3, row = (i / 3) | 0;
      var x = 0.06 + col * 0.31, y = 0.2 + row * 0.34;
      out.push(box(p, x, y, 0.27, 0.28, { strokeW: 2.5, stroke: p.blue }));
      out.push(text(p, x + 0.015, y + 0.02, 0.24, q,
        { size: 0.042, bold: true, color: p.amber }));
    });
    return out;
  });

  T("english", "compare", "Compare and contrast", "Two circles, one middle", function (p) {
    var out = [];
    out.push(text(p, 0.06, 0.06, 0.4, "Text A", { size: 0.05, bold: true, color: p.blue }));
    out.push(text(p, 0.56, 0.06, 0.38, "Text B",
      { size: 0.05, bold: true, align: "right", color: p.amber }));
    out.push(circle(p, 0.4, 0.58, 0.19, 0.32, { stroke: p.blue, strokeW: 3 }));
    out.push(circle(p, 0.6, 0.58, 0.19, 0.32, { stroke: p.amber, strokeW: 3 }));
    out.push(label(p, 0.43, 0.92, 0.14, "same", { align: "center" }));
    return out;
  });

  /* ================================ CLASS ============================= */

  T("class", "lesson-header", "Lesson header", "Title, date and objective", function (p) {
    var out = [];
    out.push(text(p, 0.05, 0.06, 0.62, "Lesson title", { size: 0.07, bold: true }));
    out.push(text(p, 0.68, 0.075, 0.27, "Date:", { size: 0.042, align: "right", color: p.faint }));
    out.push(seg(p, 0.05, 0.17, 0.95, 0.17, { strokeW: 3, stroke: p.amber }));
    out.push(text(p, 0.05, 0.21, 0.9, "We are learning to…", { size: 0.045, color: p.amber }));
    out.push(box(p, 0.05, 0.28, 0.9, 0.18, { strokeW: 2, dash: 5, stroke: p.faint }));
    out.push(text(p, 0.05, 0.5, 0.9, "Success looks like…", { size: 0.045, color: p.green }));
    out.push(box(p, 0.05, 0.57, 0.9, 0.18, { strokeW: 2, dash: 5, stroke: p.faint }));
    return out;
  });

  T("class", "table", "Blank table", "Four columns, five rows", function (p) {
    var out = [], i;
    var L = 0.05, W = 0.9, TP = 0.1, H = 0.82;
    out.push(box(p, L, TP, W, H, { strokeW: 3 }));
    for (i = 1; i < 4; i++) out.push(seg(p, L + W * i / 4, TP, L + W * i / 4, TP + H, { strokeW: 2 }));
    for (i = 1; i < 5; i++) {
      out.push(seg(p, L, TP + H * i / 5, L + W, TP + H * i / 5,
        { strokeW: i === 1 ? 2.5 : 1.5, stroke: i === 1 ? p.ink : p.faint }));
    }
    return out;
  });

  T("class", "t-chart", "T-chart", "Two sides to compare", function (p) {
    var out = [];
    out.push(seg(p, 0.05, 0.22, 0.95, 0.22, { strokeW: 3 }));
    out.push(seg(p, 0.5, 0.22, 0.5, 0.94, { strokeW: 3 }));
    out.push(text(p, 0.06, 0.12, 0.42, "For", { size: 0.055, bold: true, color: p.green }));
    out.push(text(p, 0.52, 0.12, 0.42, "Against", { size: 0.055, bold: true, color: p.red }));
    return out;
  });

  T("class", "timetable", "Timetable", "Five days, six periods", function (p) {
    var out = [], i;
    var days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    var L = 0.12, W = 0.84, TP = 0.1, H = 0.82, C = W / 6, R = H / 7;
    out.push(box(p, L, TP, W, H, { strokeW: 3 }));
    for (i = 1; i < 6; i++) out.push(seg(p, L + C * i, TP, L + C * i, TP + H, { strokeW: 1.5, stroke: p.faint }));
    for (i = 1; i < 7; i++) out.push(seg(p, L, TP + R * i, L + W, TP + R * i,
      { strokeW: i === 1 ? 2.5 : 1.5, stroke: i === 1 ? p.ink : p.faint }));
    days.forEach(function (d, n) {
      out.push(text(p, L + C * (n + 1), TP + R * 0.25, C, d,
        { size: 0.034, align: "center", color: p.amber }));
    });
    for (i = 1; i <= 6; i++) {
      out.push(text(p, L, TP + R * i + R * 0.25, C, "P" + i,
        { size: 0.032, align: "center", color: p.amber }));
    }
    return out;
  });

  T("class", "traffic", "How did it go?", "Red, amber, green check", function (p) {
    var out = [title(p, "How did you find it?")];
    var rows = [[p.green, "I could do it on my own"],
                [p.amber, "I could do it with help"],
                [p.red, "I need to go over it again"]];
    rows.forEach(function (row, i) {
      var y = 0.28 + i * 0.2;
      out.push(circle(p, 0.16, y + 0.04, 0.035, 0.062, { stroke: row[0], strokeW: 3 }));
      out.push(text(p, 0.24, y, 0.68, row[1], { size: 0.045, color: row[0] }));
    });
    return out;
  });

  T("class", "flowchart", "Flowchart", "Start, step, decision, end", function (p) {
    var out = [];
    out.push(shp(p, "rrect", 0.38, 0.06, 0.24, 0.12, { strokeW: 2.5, stroke: p.green }));
    out.push(text(p, 0.38, 0.09, 0.24, "Start", { size: 0.04, align: "center", color: p.green }));
    out.push(arrow(p, 0.5, 0.19, 0.5, 0.27, { stroke: p.faint }));
    out.push(box(p, 0.38, 0.28, 0.24, 0.13, { strokeW: 2.5 }));
    out.push(text(p, 0.38, 0.31, 0.24, "Step", { size: 0.04, align: "center" }));
    out.push(arrow(p, 0.5, 0.42, 0.5, 0.5, { stroke: p.faint }));
    out.push(shp(p, "diamond", 0.36, 0.51, 0.28, 0.2, { strokeW: 2.5, stroke: p.amber }));
    out.push(text(p, 0.36, 0.58, 0.28, "Yes or no?", { size: 0.034, align: "center", color: p.amber }));
    out.push(arrow(p, 0.5, 0.72, 0.5, 0.8, { stroke: p.faint }));
    out.push(shp(p, "rrect", 0.38, 0.81, 0.24, 0.12, { strokeW: 2.5, stroke: p.red }));
    out.push(text(p, 0.38, 0.84, 0.24, "End", { size: 0.04, align: "center", color: p.red }));
    return out;
  });

  T("class", "music-staff", "Music staff", "Two five-line staves", function (p) {
    var out = [], s, i;
    for (s = 0; s < 2; s++) {
      var top = 0.2 + s * 0.36;
      for (i = 0; i < 5; i++) {
        out.push(seg(p, 0.08, top + i * 0.035, 0.92, top + i * 0.035,
          { strokeW: 1.8, stroke: p.ink }));
      }
    }
    return out;
  });

  T("class", "pitch", "Football pitch", "For planning a match", function (p) {
    var out = [];
    out.push(box(p, 0.06, 0.1, 0.88, 0.82, { strokeW: 3, stroke: p.green }));
    out.push(seg(p, 0.5, 0.1, 0.5, 0.92, { strokeW: 2.5, stroke: p.green }));
    out.push(circle(p, 0.5, 0.51, 0.06, 0.11, { strokeW: 2.5, stroke: p.green }));
    out.push(box(p, 0.06, 0.31, 0.1, 0.4, { strokeW: 2.5, stroke: p.green }));
    out.push(box(p, 0.84, 0.31, 0.1, 0.4, { strokeW: 2.5, stroke: p.green }));
    return out;
  });

  T("class", "seating", "Seating plan", "Six by four desks", function (p) {
    var out = [text(p, 0.05, 0.04, 0.9, "Front of class",
      { size: 0.038, align: "center", color: p.amber })];
    for (var row = 0; row < 4; row++) {
      for (var col = 0; col < 6; col++) {
        out.push(box(p, 0.07 + col * 0.15, 0.16 + row * 0.2, 0.12, 0.13,
          { strokeW: 2, stroke: p.faint }));
      }
    }
    return out;
  });

  /* =============================== DRAWING ============================
   *
   * Outlines to draw over and colour in. Every piece is a closed shape of
   * its own — each petal, each leaf, each wing — because the Colour in tool
   * fills one shape per tap, and a flower that is a single outline is a
   * flower you can only colour one colour.
   *
   * Nothing here is traced from anyone's artwork. They are put together out
   * of ovals, arcs and point lists, which is also why they can be pulled
   * apart and rebuilt on the board.
   */

  T("draw", "flower", "Flower", "Petals, centre, stem and leaves", function (p) {
    var out = [], i;
    var cx = 8, cy = 3.7;
    /* Ten petals rather than twelve: enough to read as a flower, few enough
     * that each one is a shape a child can aim a finger at and colour. */
    for (i = 0; i < 10; i++) {
      out.push(petal(p, cx, cy, i * 36, 1.7, 2.6, 1.15, { strokeW: 2.5 }));
    }
    out.push(udisc(p, cx, cy, 1.7, { strokeW: 2.5, stroke: p.amber }));
    out.push(upoly(p, [cx, cy + 0.85, 7.75, 5.9, 8.1, 7.2, 7.95, 8.6],
      { strokeW: 4, edge: "smooth", radius: 22, stroke: p.green }));
    /* Distance from the stem is half the leaf's length, so the inner end
     * meets the stem instead of floating beside it. */
    out.push(petal(p, 7.8, 6.2, 200, 1.2, 2.4, 1.05, { strokeW: 2.5, stroke: p.green }));
    out.push(petal(p, 8.05, 7.1, 340, 1.2, 2.4, 1.05, { strokeW: 2.5, stroke: p.green }));
    return out;
  });

  T("draw", "flower-trace", "Flower to trace", "Dotted outline to draw over", function (p) {
    var out = [], i;
    var faint = { strokeW: 2, dash: 4, stroke: p.faint };
    for (i = 0; i < 8; i++) {
      out.push(petal(p, 8, 4.1, i * 45, 1.5, 2.4, 1.2, faint));
    }
    out.push(udisc(p, 8, 4.1, 1.8, faint));
    out.push(upoly(p, [8, 5.1, 7.8, 6.6, 8.05, 8.4],
      { strokeW: 2.5, dash: 4, stroke: p.faint, edge: "smooth", radius: 20 }));
    out.push(petal(p, 7.85, 6.5, 200, 1.1, 2.2, 1.0, faint));
    out.push(petal(p, 8, 7.3, 340, 1.1, 2.2, 1.0, faint));
    out.push(utext(p, 8, 0.4, 10, "Draw over the dots, then colour it in",
      { size: 0.04, align: "center", color: p.faint }));
    return out;
  });

  T("draw", "leaf", "Leaf", "Outline, midrib and veins", function (p) {
    var out = [];
    out.push(upoly(p, [4.6, 6.9, 6.2, 4.4, 9, 3.0, 12, 2.4, 10.2, 4.9, 7.4, 6.4],
      { closed: true, edge: "smooth", radius: 26, strokeW: 3, stroke: p.green }));
    out.push(useg(p, 4.6, 6.9, 12, 2.4, { strokeW: 2.5, stroke: p.green }));
    out.push(useg(p, 3.2, 7.8, 4.6, 6.9, { strokeW: 3, stroke: p.green }));
    /* Veins run across the midrib, not at a guessed angle, and get shorter
     * towards the tip where the leaf itself is narrower. Guessed offsets
     * poked out through the outline. */
    var dx = 12 - 4.6, dy = 2.4 - 6.9;
    var len = Math.sqrt(dx * dx + dy * dy);
    var px = -dy / len, py = dx / len;
    for (var i = 1; i <= 5; i++) {
      var t = i / 6;
      var mx = 4.6 + dx * t, my = 6.9 + dy * t;
      var reach = 1.45 * (1 - t * 0.55);
      out.push(useg(p, mx, my,
        mx + px * reach + dx / len * 0.5, my + py * reach + dy / len * 0.5,
        { strokeW: 1.6, stroke: p.green }));
      out.push(useg(p, mx, my,
        mx - px * reach + dx / len * 0.5, my - py * reach + dy / len * 0.5,
        { strokeW: 1.6, stroke: p.green }));
    }
    return out;
  });

  T("draw", "sprout", "Seedling", "A shoot coming up out of the soil", function (p) {
    var out = [];
    out.push(upoly(p, [4.9, 8.1, 5.8, 6.9, 8, 6.4, 10.2, 6.9, 11.1, 8.1],
      { closed: true, edge: "smooth", radius: 22, strokeW: 2.5, stroke: p.amber }));
    out.push(upoly(p, [8, 6.6, 7.9, 5.2, 8.05, 3.2],
      { strokeW: 4, edge: "smooth", radius: 24, stroke: p.green }));
    /* Each leaf sits half its own length away from the stem, which is what
     * makes it join the stem rather than hover beside it. */
    out.push(petal(p, 7.95, 4.4, 202, 1.45, 2.9, 1.35, { strokeW: 2.5, stroke: p.green }));
    out.push(petal(p, 8.05, 4.8, 340, 1.45, 2.9, 1.35, { strokeW: 2.5, stroke: p.green }));
    out.push(petal(p, 8.05, 3.3, 260, 0.95, 1.9, 0.9, { strokeW: 2.5, stroke: p.green }));
    return out;
  });

  T("draw", "butterfly", "Butterfly", "Four wings, ready for colours", function (p) {
    var out = [];
    out.push(petal(p, 8, 4.2, 215, 2.6, 3.4, 2.5, { strokeW: 2.5, stroke: p.violet }));
    out.push(petal(p, 8, 4.2, 325, 2.6, 3.4, 2.5, { strokeW: 2.5, stroke: p.violet }));
    out.push(petal(p, 8, 4.6, 150, 2.4, 2.7, 2.0, { strokeW: 2.5, stroke: p.blue }));
    out.push(petal(p, 8, 4.6, 30, 2.4, 2.7, 2.0, { strokeW: 2.5, stroke: p.blue }));
    out.push(udisc(p, 5.6, 3.0, 0.9, { strokeW: 2, stroke: p.amber }));
    out.push(udisc(p, 10.4, 3.0, 0.9, { strokeW: 2, stroke: p.amber }));
    out.push(ushp(p, "ellipse", 8, 4.4, 0.7, 4.4, { strokeW: 2.5 }));
    out.push(udisc(p, 8, 2.0, 0.9, { strokeW: 2.5 }));
    out.push(useg(p, 7.8, 1.6, 6.9, 0.5, { strokeW: 2 }));
    out.push(useg(p, 8.2, 1.6, 9.1, 0.5, { strokeW: 2 }));
    return out;
  });

  T("draw", "fish", "Fish", "Body, fins, tail and bubbles", function (p) {
    var out = [];
    out.push(upoly(p, [4.4, 4.6, 6.4, 2.8, 9.4, 2.9, 11.2, 4.6, 9.4, 6.3, 6.4, 6.2],
      { closed: true, edge: "smooth", radius: 30, strokeW: 3, stroke: p.blue }));
    out.push(upoly(p, [11.2, 4.6, 13.4, 2.9, 13.4, 6.3],
      { closed: true, strokeW: 3, stroke: p.blue }));
    out.push(upoly(p, [7.6, 2.85, 8.6, 1.5, 9.7, 3.0],
      { closed: true, edge: "smooth", radius: 16, strokeW: 2.5, stroke: p.blue }));
    out.push(upoly(p, [7.4, 6.2, 8.2, 7.4, 9.2, 6.15],
      { closed: true, edge: "smooth", radius: 16, strokeW: 2.5, stroke: p.blue }));
    out.push(udisc(p, 6.0, 4.1, 0.8, { strokeW: 2.5 }));
    out.push(udisc(p, 6.0, 4.1, 0.3, { fill: p.ink, strokeW: 0 }));
    /* A gill behind the head, not a dashed line down the middle: that read
     * as a rendering fault rather than as part of the fish. */
    out.push(upoly(p, [6.9, 3.1, 6.4, 4.6, 6.9, 6.0],
      { strokeW: 2, edge: "smooth", radius: 20, stroke: p.blue }));
    [[4.6, 1.9, 0.7], [3.6, 1.1, 0.5], [5.4, 0.8, 0.4]].forEach(function (b) {
      out.push(udisc(p, b[0], b[1], b[2], { strokeW: 1.8, stroke: p.faint }));
    });
    return out;
  });

  T("draw", "tree", "Tree", "Trunk, branches and canopy", function (p) {
    var out = [];
    out.push(upoly(p, [7.2, 8.4, 7.6, 5.6, 8.4, 5.6, 8.8, 8.4],
      { closed: true, strokeW: 3, stroke: p.amber }));
    out.push(useg(p, 7.7, 6.4, 6.6, 5.4, { strokeW: 2.2, stroke: p.amber }));
    out.push(useg(p, 8.3, 6.1, 9.4, 5.2, { strokeW: 2.2, stroke: p.amber }));
    out.push(udisc(p, 8, 3.2, 4.4, { strokeW: 3, stroke: p.green }));
    out.push(udisc(p, 5.9, 4.3, 3.2, { strokeW: 3, stroke: p.green }));
    out.push(udisc(p, 10.1, 4.3, 3.2, { strokeW: 3, stroke: p.green }));
    out.push(useg(p, 2.5, 8.4, 13.5, 8.4, { strokeW: 2.5, stroke: p.faint }));
    return out;
  });

  T("draw", "house", "House", "Walls, roof, door and windows", function (p) {
    var out = [];
    out.push(upoly(p, [5.4, 4.4, 10.6, 4.4, 10.6, 8.2, 5.4, 8.2],
      { closed: true, strokeW: 3 }));
    out.push(upoly(p, [4.7, 4.4, 8, 1.9, 11.3, 4.4],
      { closed: true, strokeW: 3, stroke: p.red }));
    out.push(upoly(p, [7.3, 8.2, 7.3, 6.1, 8.7, 6.1, 8.7, 8.2],
      { closed: true, strokeW: 2.5, stroke: p.amber }));
    out.push(udisc(p, 8.45, 7.2, 0.25, { fill: p.ink, strokeW: 0 }));
    [[6.2, 5.5], [9.8, 5.5]].forEach(function (w) {
      out.push(upoly(p, [w[0] - 0.7, w[1] - 0.7, w[0] + 0.7, w[1] - 0.7,
        w[0] + 0.7, w[1] + 0.7, w[0] - 0.7, w[1] + 0.7],
        { closed: true, strokeW: 2.5, stroke: p.blue }));
      out.push(useg(p, w[0], w[1] - 0.7, w[0], w[1] + 0.7, { strokeW: 1.6, stroke: p.blue }));
      out.push(useg(p, w[0] - 0.7, w[1], w[0] + 0.7, w[1], { strokeW: 1.6, stroke: p.blue }));
    });
    out.push(upoly(p, [9.4, 2.9, 9.4, 1.0, 10.3, 1.0, 10.3, 3.6],
      { closed: true, strokeW: 2.5, stroke: p.red }));
    out.push(useg(p, 2.5, 8.2, 13.5, 8.2, { strokeW: 2.5, stroke: p.faint }));
    return out;
  });

  T("draw", "bird", "Bird", "On a branch", function (p) {
    var out = [];
    out.push(ushp(p, "ellipse", 7.4, 4.4, 4.6, 3.0, { strokeW: 3, stroke: p.blue }));
    out.push(udisc(p, 10.2, 3.0, 2.0, { strokeW: 3, stroke: p.blue }));
    out.push(upoly(p, [11.2, 2.9, 12.9, 3.4, 11.2, 3.8],
      { closed: true, strokeW: 2.5, stroke: p.amber }));
    out.push(udisc(p, 10.5, 2.6, 0.35, { fill: p.ink, strokeW: 0 }));
    out.push(upoly(p, [6.1, 4.2, 8.2, 3.6, 8.9, 4.6, 7.0, 5.3],
      { closed: true, edge: "smooth", radius: 30, strokeW: 2.5, stroke: p.violet }));
    out.push(upoly(p, [5.2, 4.4, 2.9, 3.4, 3.3, 5.6],
      { closed: true, strokeW: 2.5, stroke: p.violet }));
    out.push(useg(p, 7.2, 5.8, 7.0, 6.9, { strokeW: 2, stroke: p.amber }));
    out.push(useg(p, 8.2, 5.8, 8.4, 6.9, { strokeW: 2, stroke: p.amber }));
    out.push(useg(p, 3.0, 6.9, 13.0, 6.9, { strokeW: 3.5, stroke: p.green }));
    return out;
  });

  T("draw", "apple", "Apple", "With a stalk and a leaf", function (p) {
    var out = [];
    out.push(ushp(p, "ellipse", 8, 5.1, 5.2, 5.4, { strokeW: 3, stroke: p.red }));
    out.push(upoly(p, [8, 2.5, 8.3, 1.2, 8.9, 0.6],
      { strokeW: 3, edge: "smooth", radius: 20, stroke: p.amber }));
    out.push(petal(p, 8.85, 0.75, 355, 1.1, 2.2, 1.0, { strokeW: 2.5, stroke: p.green }));
    return out;
  });

  T("draw", "pot-plant", "Plant in a pot", "Three flowers to colour", function (p) {
    var out = [];
    out.push(upoly(p, [5.6, 6.2, 10.4, 6.2, 9.6, 8.5, 6.4, 8.5],
      { closed: true, strokeW: 3, stroke: p.amber }));
    out.push(upoly(p, [5.2, 5.5, 10.8, 5.5, 10.8, 6.3, 5.2, 6.3],
      { closed: true, strokeW: 3, stroke: p.amber }));
    [[5.6, 2.4, 210], [8, 1.6, 270], [10.4, 2.4, 330]].forEach(function (f, n) {
      out.push(upoly(p, [8, 5.5, (8 + f[0]) / 2, (5.5 + f[1]) / 2 + 0.5, f[0], f[1] + 0.95],
        { strokeW: 3, edge: "smooth", radius: 22, stroke: p.green }));
      for (var i = 0; i < 5; i++) {
        out.push(petal(p, f[0], f[1], i * 72 + n * 15, 0.85, 1.5, 0.8,
          { strokeW: 2.2, stroke: [p.red, p.violet, p.blue][n] }));
      }
      out.push(udisc(p, f[0], f[1], 0.8, { strokeW: 2, stroke: p.amber }));
    });
    return out;
  });

  T("draw", "boat", "Boat", "Hull, sails and water", function (p) {
    var out = [];
    out.push(upoly(p, [3.4, 6.2, 12.6, 6.2, 11.2, 7.9, 4.8, 7.9],
      { closed: true, strokeW: 3, stroke: p.amber }));
    out.push(useg(p, 8, 6.2, 8, 1.2, { strokeW: 3 }));
    out.push(upoly(p, [8.3, 1.6, 11.9, 5.9, 8.3, 5.9],
      { closed: true, strokeW: 2.5, stroke: p.red }));
    out.push(upoly(p, [7.7, 2.4, 7.7, 5.9, 4.9, 5.9],
      { closed: true, strokeW: 2.5, stroke: p.blue }));
    out.push(upoly(p, [1.5, 8.3, 3.5, 7.9, 5.5, 8.3, 7.5, 7.9, 9.5, 8.3, 11.5, 7.9, 14.5, 8.3],
      { strokeW: 2.5, edge: "smooth", radius: 20, stroke: p.blue }));
    out.push(upoly(p, [1.5, 8.8, 4, 8.5, 6.5, 8.8, 9, 8.5, 11.5, 8.8, 14.5, 8.5],
      { strokeW: 2, edge: "smooth", radius: 20, stroke: p.blue }));
    return out;
  });

  T("draw", "sun-cloud", "Sun and cloud", "Good for weather charts", function (p) {
    var out = [], i;
    out.push(udisc(p, 5.2, 3.0, 3.0, { strokeW: 3, stroke: p.amber }));
    for (i = 0; i < 12; i++) {
      var a = i * 30 * Math.PI / 180;
      out.push(useg(p,
        5.2 + Math.cos(a) * 1.85, 3.0 + Math.sin(a) * 1.85,
        5.2 + Math.cos(a) * 2.7, 3.0 + Math.sin(a) * 2.7,
        { strokeW: 2.5, stroke: p.amber }));
    }
    out.push(udisc(p, 9.6, 5.6, 2.6, { strokeW: 3, stroke: p.blue }));
    out.push(udisc(p, 11.6, 5.9, 2.2, { strokeW: 3, stroke: p.blue }));
    out.push(udisc(p, 10.6, 4.7, 2.4, { strokeW: 3, stroke: p.blue }));
    out.push(useg(p, 9.4, 7.2, 8.9, 8.4, { strokeW: 2, stroke: p.blue }));
    out.push(useg(p, 10.8, 7.3, 10.3, 8.5, { strokeW: 2, stroke: p.blue }));
    out.push(useg(p, 12.2, 7.2, 11.7, 8.4, { strokeW: 2, stroke: p.blue }));
    return out;
  });

  T("draw", "moon-stars", "Moon and stars", "A night sky to fill in", function (p) {
    var out = [];
    out.push(upoly(p, crescent(6.2, 4.4, 3.1, 2.2, 55, 305, 14),
      { closed: true, edge: "smooth", radius: 10, strokeW: 3, stroke: p.amber }));
    [[11.5, 2.2, 1.8], [13.3, 4.6, 1.3], [10.6, 6.2, 1.1], [12.8, 7.4, 0.9]].forEach(
      function (st) {
        out.push(ushp(p, "star", st[0] - st[2] / 2, st[1] - st[2] / 2, st[2], st[2],
          { strokeW: 2.2, stroke: p.amber, sides: 5, inset: 45 }));
      });
    return out;
  });

  T("draw", "colour-me", "Shapes to colour", "Six blanks for the colour tool", function (p) {
    var out = [utext(p, 8, 0.3, 12, "Tap a shape with Colour in",
      { size: 0.04, align: "center", color: p.faint })];
    var kinds = ["ellipse", "rect", "triangle", "star", "diamond", "polygon"];
    kinds.forEach(function (k, i) {
      var col = i % 3, row = (i / 3) | 0;
      out.push(ushp(p, k, 4 + col * 4, 3.2 + row * 3.0, 2.8, 2.2,
        { strokeW: 3, stroke: [p.red, p.blue, p.green, p.amber, p.violet, p.ink][i] }));
    });
    return out;
  });

  global.ChalkTemplates = {
    subjects: SUBJECTS,
    list: LIST,
    palette: palette
  };
})(window);
