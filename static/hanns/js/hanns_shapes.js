/* ============================================================
   hanns_shapes.js — plain 2D shapes, no animation.

   The deck already had `rect` and `ellipse`, rendered as styled <div>s
   with border-radius. That covers two of the shapes people expect and
   nothing else: no triangle, no arrow, no callout, no star.

   This is the rest of the set you get in PowerPoint's Insert > Shapes,
   drawn as inline SVG so they stay crisp at any projector resolution and
   export cleanly to the HTML exporter.

   DESIGN
   ------
   * Deliberately static. You asked for shapes that behave like Word or
     PowerPoint, so nothing here animates, pulses or breathes — a shape
     drawn on a slide stays exactly where it was put. The `anim` field is
     forced to "none" by `defaults()`.
   * Reuses the element properties the inspector already edits — `fill`,
     `stroke`, `strokeW`, `dashed`, `radius`, `opacity` — so existing
     editor controls work on a shape the moment it is inserted, with no
     new inspector panel.
   * `viewBox="0 0 100 100"` with `preserveAspectRatio="none"` on every
     shape, so a shape stretches to whatever box you drag, exactly like
     PowerPoint. The few shapes where that looks wrong (star, arrows at
     extreme ratios) use geometry that survives stretching.
   * Optional label text centred inside, matching PowerPoint's behaviour
     of typing straight into a shape.

   WIRING
   ------
   1. Load after hanns_core.js:
        <script src="{% static 'hanns/js/hanns_shapes.js' %}"></script>
   2. hanns_core.js renderElement() already has the branch:
        } else if(el.type==="shape"){
          if(window.HannsShapes) inner.appendChild(window.HannsShapes.render(el));
   3. In the editor toolbar, insert with:
        addElement(HannsShapes.defaults("arrow_right", {x:120, y:120}));
      `HannsShapes.CATALOG` gives you {key, label, group} for building the
      picker; grouping matches PowerPoint's own menu order.
   ============================================================ */

(function () {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";

  /* Each entry returns SVG geometry inside a 0..100 box. Keeping every
     shape in the same coordinate space is what lets one styling path
     (fill / stroke / dash) apply to all of them. */
  var SHAPES = {
    // ── Rectangles ──
    rectangle:      { label: "Rectangle",        group: "Rectangles", d: "M0,0 H100 V100 H0 Z" },
    round_rect:     { label: "Rounded rectangle", group: "Rectangles", rounded: true },
    snip_rect:      { label: "Snipped corner",   group: "Rectangles", d: "M14,0 H100 V100 H0 V14 Z" },
    parallelogram:  { label: "Parallelogram",    group: "Rectangles", d: "M18,0 H100 L82,100 H0 Z" },
    trapezoid:      { label: "Trapezoid",        group: "Rectangles", d: "M20,0 H80 L100,100 H0 Z" },

    // ── Basic ──
    ellipse:        { label: "Oval",             group: "Basic", ellipse: true },
    triangle:       { label: "Triangle",         group: "Basic", d: "M50,0 L100,100 H0 Z" },
    right_triangle: { label: "Right triangle",   group: "Basic", d: "M0,0 V100 H100 Z" },
    diamond:        { label: "Diamond",          group: "Basic", d: "M50,0 L100,50 L50,100 L0,50 Z" },
    pentagon:       { label: "Pentagon",         group: "Basic", d: "M50,0 L100,38 L81,100 H19 L0,38 Z" },
    hexagon:        { label: "Hexagon",          group: "Basic", d: "M25,0 H75 L100,50 L75,100 H25 L0,50 Z" },
    octagon:        { label: "Octagon",          group: "Basic", d: "M30,0 H70 L100,30 V70 L70,100 H30 L0,70 V30 Z" },
    cross:          { label: "Cross",            group: "Basic", d: "M35,0 H65 V35 H100 V65 H65 V100 H35 V65 H0 V35 H35 Z" },
    can:            { label: "Cylinder",         group: "Basic",
                      d: "M0,12 C0,5 22,0 50,0 C78,0 100,5 100,12 V88 C100,95 78,100 50,100 C22,100 0,95 0,88 Z" },

    // ── Arrows ──
    arrow_right:    { label: "Right arrow",      group: "Arrows", d: "M0,30 H62 V8 L100,50 L62,92 V70 H0 Z" },
    arrow_left:     { label: "Left arrow",       group: "Arrows", d: "M100,30 H38 V8 L0,50 L38,92 V70 H100 Z" },
    arrow_up:       { label: "Up arrow",         group: "Arrows", d: "M30,100 V38 H8 L50,0 L92,38 H70 V100 Z" },
    arrow_down:     { label: "Down arrow",       group: "Arrows", d: "M30,0 V62 H8 L50,100 L92,62 H70 V0 Z" },
    arrow_lr:       { label: "Left-right arrow", group: "Arrows",
                      d: "M0,50 L26,10 V32 H74 V10 L100,50 L74,90 V68 H26 V90 Z" },
    chevron:        { label: "Chevron",          group: "Arrows", d: "M0,0 H70 L100,50 L70,100 H0 L30,50 Z" },
    pentagon_arrow: { label: "Block arrow",      group: "Arrows", d: "M0,0 H70 L100,50 L70,100 H0 Z" },

    // ── Stars & banners ──
    star4:          { label: "4-point star",     group: "Stars",
                      d: "M50,0 L62,38 L100,50 L62,62 L50,100 L38,62 L0,50 L38,38 Z" },
    star5:          { label: "5-point star",     group: "Stars",
                      d: "M50,0 L61,35 H98 L68,57 L79,92 L50,70 L21,92 L32,57 L2,35 H39 Z" },
    star6:          { label: "6-point star",     group: "Stars",
                      d: "M50,0 L67,25 H96 L79,50 L96,75 H67 L50,100 L33,75 H4 L21,50 L4,25 H33 Z" },
    burst:          { label: "Starburst",        group: "Stars",
                      d: "M50,0 L59,22 L79,10 L76,33 L98,32 L84,50 L98,68 L76,67 L79,90 L59,78 L50,100 L41,78 L21,90 L24,67 L2,68 L16,50 L2,32 L24,33 L21,10 L41,22 Z" },

    // ── Callouts ──
    callout:        { label: "Speech bubble",    group: "Callouts",
                      d: "M6,0 H94 A6,6 0 0 1 100,6 V64 A6,6 0 0 1 94,70 H36 L18,100 L22,70 H6 A6,6 0 0 1 0,64 V6 A6,6 0 0 1 6,0 Z" },
    cloud_callout:  { label: "Thought bubble",   group: "Callouts",
                      d: "M22,18 A18,18 0 0 1 54,10 A16,16 0 0 1 82,20 A15,15 0 0 1 84,50 H20 A16,16 0 0 1 22,18 Z M22,60 a7,7 0 1 0 0.1,0 M12,78 a5,5 0 1 0 0.1,0" },

    // ── Lines ──
    line:           { label: "Line",             group: "Lines", d: "M0,50 H100", open: true },
    line_diagonal:  { label: "Diagonal line",    group: "Lines", d: "M0,100 L100,0", open: true },
    bracket_left:   { label: "Left bracket",     group: "Lines", d: "M30,0 H8 V100 H30", open: true },
    bracket_right:  { label: "Right bracket",    group: "Lines", d: "M70,0 H92 V100 H70", open: true }
  };

  var GROUP_ORDER = ["Rectangles", "Basic", "Arrows", "Stars", "Callouts", "Lines"];

  /** [{key, label, group}] in PowerPoint's own menu order, for the picker. */
  function catalog() {
    var out = [];
    GROUP_ORDER.forEach(function (g) {
      Object.keys(SHAPES).forEach(function (k) {
        if (SHAPES[k].group === g) out.push({ key: k, label: SHAPES[k].label, group: g });
      });
    });
    return out;
  }

  /** A new shape element, ready for the deck's `els` array. */
  function defaults(shapeKey, over) {
    var meta = SHAPES[shapeKey] ? shapeKey : "rectangle";
    var open = !!SHAPES[meta].open;
    var el = {
      id: "sh" + Math.random().toString(36).slice(2, 9),
      type: "shape",
      shape: meta,
      x: 160, y: 160, w: 240, h: 160, rot: 0,
      fill: open ? "none" : "#2563eb",
      stroke: open ? "#1e293b" : "none",
      strokeW: open ? 4 : 0,
      dashed: false,
      radius: 14,          // used by round_rect only
      opacity: 1,
      text: "",
      textColor: "#ffffff",
      textSize: 20,
      // Static by design. Shapes behave like Word and PowerPoint shapes:
      // they sit where you put them.
      anim: "none",
      animDelay: 0
    };
    return Object.assign(el, over || {});
  }

  function svgEl(name, attrs) {
    var n = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  /** Build the DOM node for a shape element. */
  function render(el) {
    var meta = SHAPES[el && el.shape] || SHAPES.rectangle;
    var wrap = document.createElement("div");
    wrap.className = "shape-2d";
    if (el && el.opacity != null && el.opacity !== 1) wrap.style.opacity = String(el.opacity);

    var svg = svgEl("svg", {
      viewBox: "0 0 100 100",
      // Stretch to the drawn box, exactly like PowerPoint.
      preserveAspectRatio: "none",
      focusable: "false",
      "aria-hidden": "true"
    });

    var fill = (el && el.fill) || "none";
    var stroke = (el && el.stroke) || "none";
    var strokeW = Number(el && el.strokeW) || 0;
    var open = !!meta.open;

    var attrs = {
      fill: open ? "none" : fill,
      stroke: stroke,
      "stroke-width": strokeW,
      // Geometry is in a 0..100 box that gets stretched, so an unscaled
      // stroke keeps its drawn thickness instead of smearing on wide boxes.
      "vector-effect": "non-scaling-stroke",
      "stroke-linejoin": "round",
      "stroke-linecap": "round"
    };
    if (el && el.dashed && strokeW) attrs["stroke-dasharray"] = (strokeW * 2.5) + "," + (strokeW * 2);

    var node;
    if (meta.ellipse) {
      node = svgEl("ellipse", Object.assign({ cx: 50, cy: 50, rx: 50, ry: 50 }, attrs));
    } else if (meta.rounded) {
      var r = Math.max(0, Math.min(50, Number(el && el.radius) || 12));
      node = svgEl("rect", Object.assign({ x: 0, y: 0, width: 100, height: 100, rx: r, ry: r }, attrs));
    } else {
      node = svgEl("path", Object.assign({ d: meta.d }, attrs));
    }
    svg.appendChild(node);
    wrap.appendChild(svg);

    // PowerPoint lets you type straight into a shape; so does this.
    if (el && el.text) {
      var label = document.createElement("div");
      label.className = "shape-2d-label";
      label.textContent = el.text;
      label.style.color = el.textColor || "#ffffff";
      label.style.fontSize = (Number(el.textSize) || 20) + "px";
      wrap.appendChild(label);
    }
    return wrap;
  }

  window.HannsShapes = {
    SHAPES: SHAPES,
    GROUP_ORDER: GROUP_ORDER,
    CATALOG: catalog(),
    catalog: catalog,
    defaults: defaults,
    render: render
  };
})();
