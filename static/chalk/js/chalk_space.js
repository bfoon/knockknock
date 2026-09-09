/* Chalk — turning things in space.
 *
 * The board already stores an object's tilt: fx.tiltX, fx.tiltY and
 * fx.perspective, and chalk_els.js already renders them. What it did not have
 * was a way to set them that felt like turning something. Two sliders labelled
 * "Tilt up / down" and "Tilt left / right" are not a way to turn an object;
 * they are a way to find out, one nudge at a time, that you wanted the other
 * one.
 *
 * This is the pad instead. Drag it and the object turns with your finger, live
 * on the wall. A wireframe box inside the pad shows which way is now facing
 * you, because tilt on its own is invisible on a flat drawing until it is too
 * far and then it is a smear.
 *
 * It writes nothing the server does not already accept: fx.tiltX, fx.tiltY,
 * fx.perspective. No new fields, no migration, no change to consumers.py.
 *
 * window.ChalkSpace = { pad, presets }
 *
 *   pad(ctx) -> DOM node
 *     ctx.el              the element being turned
 *     ctx.read(el, key)   current value, "fx.tiltX" style keys
 *     ctx.live(patch)     while the finger is down — never stored
 *     ctx.commit(patch)   on release — one undo entry for the whole drag
 */
(function (global) {
  "use strict";

  var NS = "http://www.w3.org/2000/svg";
  var LIMIT = 60;        // matches FX_NUM in consumers.py; going past is refused
  var TURN_PER_PX = 0.55;

  /* The eight corners of a unit box, and the twelve edges between them. */
  var CORNERS = [
    [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
    [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]
  ];
  var EDGES = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7]
  ];
  var FRONT = [4, 5, 6, 7];

  function clamp(v) { return Math.max(-LIMIT, Math.min(LIMIT, v)); }
  function round1(v) { return Math.round(v * 10) / 10; }

  /* Same order CSS applies them in: `rotateX(a) rotateY(b)` multiplies as
     Rx·Ry, so a point goes through the Y turn first. Get this backwards and
     the preview disagrees with the wall at every angle except zero. */
  function project(p, ax, ay, d) {
    var a = ax * Math.PI / 180, b = ay * Math.PI / 180;
    var x = p[0] * Math.cos(b) + p[2] * Math.sin(b);
    var z = -p[0] * Math.sin(b) + p[2] * Math.cos(b);
    var y = p[1] * Math.cos(a) - z * Math.sin(a);
    z = p[1] * Math.sin(a) + z * Math.cos(a);
    var k = d / Math.max(d - z * 26, d * 0.35);
    return [x * 26 * k, y * 26 * k];
  }

  function drawBox(svg, ax, ay, persp) {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var d = Math.max(120, persp || 800) / 12;
    var pts = CORNERS.map(function (c) { return project(c, ax, ay, d); });

    /* The face that is pointing at you, filled faintly, so which way it is
       turned is readable at a glance and not a puzzle. */
    var face = document.createElementNS(NS, "polygon");
    face.setAttribute("points", FRONT.map(function (i) {
      return pts[i][0].toFixed(1) + "," + pts[i][1].toFixed(1);
    }).join(" "));
    face.setAttribute("class", "space-face");
    svg.appendChild(face);

    EDGES.forEach(function (e) {
      var line = document.createElementNS(NS, "line");
      line.setAttribute("x1", pts[e[0]][0].toFixed(1));
      line.setAttribute("y1", pts[e[0]][1].toFixed(1));
      line.setAttribute("x2", pts[e[1]][0].toFixed(1));
      line.setAttribute("y2", pts[e[1]][1].toFixed(1));
      line.setAttribute("class", "space-edge");
      svg.appendChild(line);
    });
  }

  /* ------------------------------------------------------------------ */

  function pad(ctx) {
    var wrap = document.createElement("div");
    wrap.className = "space-pad";

    var surface = document.createElement("div");
    surface.className = "space-surface";
    surface.setAttribute("role", "application");
    surface.setAttribute("aria-label",
      "Turn this object. Drag across to swing it left and right, " +
      "up and down to tip it. Arrow keys move it five degrees at a time.");
    surface.tabIndex = 0;
    wrap.appendChild(surface);

    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "-60 -60 120 120");
    svg.setAttribute("class", "space-box");
    svg.setAttribute("aria-hidden", "true");
    surface.appendChild(svg);

    var read = document.createElement("p");
    read.className = "space-read";
    wrap.appendChild(read);

    function now() {
      return {
        x: Number(ctx.read(ctx.el, "fx.tiltX")) || 0,
        y: Number(ctx.read(ctx.el, "fx.tiltY")) || 0,
        p: Number(ctx.read(ctx.el, "fx.perspective")) || 800
      };
    }

    function paint(v) {
      drawBox(svg, v.x, v.y, v.p);
      read.textContent = (v.y === 0 && v.x === 0)
        ? "Facing you"
        : Math.round(Math.abs(v.y)) + "° " + (v.y > 0 ? "right" : "left") +
          " · " + Math.round(Math.abs(v.x)) + "° " + (v.x > 0 ? "back" : "forward");
    }

    function apply(x, y, done) {
      var v = { tiltX: round1(clamp(x)), tiltY: round1(clamp(y)) };
      paint({ x: v.tiltX, y: v.tiltY, p: now().p });
      if (done) ctx.commit(v); else ctx.live(v);
    }

    /* --- dragging --------------------------------------------------- */

    var drag = null;

    surface.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      surface.setPointerCapture(e.pointerId);
      var v = now();
      drag = { px: e.clientX, py: e.clientY, x: v.x, y: v.y };
    });

    surface.addEventListener("pointermove", function (e) {
      if (!drag) return;
      e.preventDefault();
      /* Across turns it about the upright axis, down tips the top towards
         you. That is which way a real object goes when you push it, and it
         is the only mapping people do not have to think about. */
      apply(drag.x - (e.clientY - drag.py) * TURN_PER_PX,
            drag.y + (e.clientX - drag.px) * TURN_PER_PX, false);
    });

    function stop(e) {
      if (!drag) return;
      var v = now();
      apply(v.x, v.y, true);
      drag = null;
      try { surface.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    surface.addEventListener("pointerup", stop);
    surface.addEventListener("pointercancel", stop);

    /* Two taps puts it back. A pad you can get lost on needs a way home that
       is not "drag until it looks right again". */
    surface.addEventListener("dblclick", function () { apply(0, 0, true); });

    surface.addEventListener("keydown", function (e) {
      var v = now(), step = e.shiftKey ? 15 : 5, hit = true;
      if (e.key === "ArrowLeft") v.y -= step;
      else if (e.key === "ArrowRight") v.y += step;
      else if (e.key === "ArrowUp") v.x -= step;
      else if (e.key === "ArrowDown") v.x += step;
      else if (e.key === "Home" || e.key === "0") { v.x = 0; v.y = 0; }
      else hit = false;
      if (!hit) return;
      e.preventDefault();
      apply(v.x, v.y, true);
    });

    /* --- the four views people actually ask for ---------------------- */

    var row = document.createElement("div");
    row.className = "space-views";
    presets().forEach(function (p) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "icon-btn";
      b.textContent = p.name;
      b.addEventListener("click", function () { apply(p.x, p.y, true); });
      row.appendChild(b);
    });
    wrap.appendChild(row);

    paint(now());
    return wrap;
  }

  function presets() {
    return [
      { name: "Face on", x: 0, y: 0 },
      { name: "Lying down", x: 55, y: 0 },
      { name: "From the left", x: 10, y: -38 },
      { name: "From the right", x: 10, y: 38 }
    ];
  }

  global.ChalkSpace = { pad: pad, presets: presets, LIMIT: LIMIT };
})(window);
