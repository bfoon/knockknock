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

  /* ---- the library --------------------------------------------------- */

  var SUBJECTS = [
    { id: "maths", name: "Maths" },
    { id: "science", name: "Science" },
    { id: "english", name: "English" },
    { id: "class", name: "Class" }
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

  global.ChalkTemplates = {
    subjects: SUBJECTS,
    list: LIST,
    palette: palette
  };
})(window);
