/* Chalk — reading what was drawn.
 *
 * A teacher draws a wobbly circle and wants a circle. This takes the strokes
 * that are currently picked and works out what they were meant to be, then
 * hands back a short list of things it could become — best guess first.
 *
 * It never decides on its own. Recognition is a guess, and a board that
 * silently replaces a drawing with the wrong shape in front of a class is
 * worse than one that does nothing. The caller shows the list; the teacher
 * taps one.
 *
 * Coordinates. A stroke is stored in board space, 0..1 on both axes, but the
 * board is wider than it is tall — so a square drawn on the board is NOT a
 * square in those numbers. Everything in here works in physical space, where
 * y is multiplied by the board's height/width ratio, and converts back at the
 * end. Getting this wrong is why naive shape recognisers call every circle an
 * ellipse.
 *
 * window.ChalkRecognise = { read, ASPECT }
 *
 *   read(strokes, opts) -> {
 *     writing: bool,           // it looks like handwriting, not a drawing
 *     ink:     { color, w },   // what it was drawn with, to keep the look
 *     box:     { x, y, w, h }, // board-space bounds of the original
 *     picks:   [ { id, name, note, type, props, box } ]
 *   }
 *
 * A pick is a recipe, not an element: `type` goes to ChalkEls.blank, `props`
 * are its fields, `box` is where to put it. The caller owns element ids.
 */
(function (global) {
  "use strict";

  /* Board proportion, height over width. Every call should pass the real one
     from the pad's rect; this is only the fallback. */
  var ASPECT = 9 / 16;

  /* ------------------------------------------------------------------ */
  /* geometry                                                            */
  /* ------------------------------------------------------------------ */

  function dist(a, b) {
    var dx = a[0] - b[0], dy = a[1] - b[1];
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pathLen(p) {
    var t = 0, i;
    for (i = 1; i < p.length; i++) t += dist(p[i - 1], p[i]);
    return t;
  }

  function bboxOf(p) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, i;
    for (i = 0; i < p.length; i++) {
      if (p[i][0] < x0) x0 = p[i][0];
      if (p[i][0] > x1) x1 = p[i][0];
      if (p[i][1] < y0) y0 = p[i][1];
      if (p[i][1] > y1) y1 = p[i][1];
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function centroidOf(p) {
    var sx = 0, sy = 0, i;
    for (i = 0; i < p.length; i++) { sx += p[i][0]; sy += p[i][1]; }
    return [sx / p.length, sy / p.length];
  }

  /* Even spacing along the path. Every measurement below assumes points are
     evenly spread — a finger that slowed down in one corner would otherwise
     weight that corner. */
  function resample(p, n) {
    var total = pathLen(p);
    if (total <= 0 || p.length < 2) return p.slice();
    var step = total / (n - 1);
    var out = [p[0].slice()], acc = 0, i = 1, cur = p[0];
    while (i < p.length) {
      var d = dist(cur, p[i]);
      if (acc + d >= step) {
        var t = (step - acc) / (d || 1);
        var np = [cur[0] + t * (p[i][0] - cur[0]), cur[1] + t * (p[i][1] - cur[1])];
        out.push(np);
        cur = np;
        acc = 0;
      } else {
        acc += d;
        cur = p[i];
        i++;
      }
      if (out.length >= n) break;
    }
    while (out.length < n) out.push(p[p.length - 1].slice());
    return out;
  }

  /* Ramer–Douglas–Peucker. What survives is a corner. */
  function simplify(p, tol) {
    if (p.length < 3) return p.slice();
    var keep = new Array(p.length);
    keep[0] = keep[p.length - 1] = true;
    (function walk(a, b) {
      if (b <= a + 1) return;
      var far = -1, best = tol;
      var ax = p[a][0], ay = p[a][1], bx = p[b][0], by = p[b][1];
      var dx = bx - ax, dy = by - ay, len = Math.sqrt(dx * dx + dy * dy);
      for (var i = a + 1; i < b; i++) {
        var d = len < 1e-9
          ? dist(p[i], p[a])
          : Math.abs(dy * p[i][0] - dx * p[i][1] + bx * ay - by * ax) / len;
        if (d > best) { best = d; far = i; }
      }
      if (far < 0) return;
      keep[far] = true;
      walk(a, far);
      walk(far, b);
    })(0, p.length - 1);
    return p.filter(function (_, i) { return keep[i]; });
  }

  function rot2(p, c, a) {
    var cs = Math.cos(a), sn = Math.sin(a);
    var dx = p[0] - c[0], dy = p[1] - c[1];
    return [c[0] + dx * cs - dy * sn, c[1] + dx * sn + dy * cs];
  }

  /* The smallest box that holds the drawing at ANY angle. This is what turns
     a rectangle drawn on the diagonal into a rectangle with a rotation,
     rather than a much larger upright box with a diagonal thing inside it. */
  function minAreaRect(p) {
    var c = centroidOf(p);
    var best = null, step, a, from = 0, to = Math.PI / 2;
    for (step = 0; step < 2; step++) {
      var inc = step === 0 ? Math.PI / 180 : Math.PI / 1800;
      for (a = from; a <= to + 1e-9; a += inc) {
        var q = p.map(function (pt) { return rot2(pt, c, -a); });
        var b = bboxOf(q);
        var area = Math.max(b.w, 1e-6) * Math.max(b.h, 1e-6);
        if (!best || area < best.area) {
          best = { area: area, a: a, b: b };
        }
      }
      from = Math.max(0, best.a - Math.PI / 180);
      to = best.a + Math.PI / 180;
    }
    var cx = best.b.x + best.b.w / 2, cy = best.b.y + best.b.h / 2;
    var back = rot2([cx, cy], c, best.a);
    /* Keep the angle small and readable: a box turned 91 degrees is the same
       box turned 1 degree with its sides swapped. */
    var angle = best.a, w = best.b.w, h = best.b.h;
    if (angle * 180 / Math.PI > 45) {
      /* Swapping the sides is a quarter turn, and the angle has to take it
         too — otherwise everything downstream divides the width by the
         height and a perfectly good oval comes back unrecognisable. */
      angle -= Math.PI / 2;
      var t = w; w = h; h = t;
    }
    return {
      cx: back[0], cy: back[1], w: w, h: h,
      deg: angle * 180 / Math.PI, angle: angle
    };
  }

  /* ------------------------------------------------------------------ */
  /* strokes in, chains out                                              */
  /* ------------------------------------------------------------------ */

  function toPoly(stroke, aspect) {
    var p = stroke.pts || [], out = [], i, last = null;
    for (i = 0; i + 1 < p.length; i += 2) {
      var pt = [p[i], p[i + 1] * aspect];
      if (last && Math.abs(pt[0] - last[0]) < 1e-7 && Math.abs(pt[1] - last[1]) < 1e-7) continue;
      out.push(pt);
      last = pt;
    }
    return out;
  }

  /* Four strokes that make a square are one square. Join any two whose ends
     nearly touch, repeatedly, until nothing else will join. */
  function chain(polys, tol) {
    var pool = polys.filter(function (p) { return p.length > 1; });
    var out = [];
    while (pool.length) {
      var cur = pool.shift(), joined = true;
      while (joined) {
        joined = false;
        for (var i = 0; i < pool.length; i++) {
          var o = pool[i];
          var a = cur[0], b = cur[cur.length - 1];
          var c = o[0], d = o[o.length - 1];
          if (dist(b, c) < tol) cur = cur.concat(o.slice(1));
          else if (dist(b, d) < tol) cur = cur.concat(o.slice(0, -1).reverse());
          else if (dist(a, c) < tol) cur = cur.slice().reverse().concat(o.slice(1));
          else if (dist(a, d) < tol) cur = o.slice(0, -1).concat(cur);
          else continue;
          pool.splice(i, 1);
          joined = true;
          break;
        }
      }
      out.push(cur);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* is this a drawing or is it writing?                                 */
  /* ------------------------------------------------------------------ */
  /*
   * Writing has a signature that drawing does not: a lot of ink inside a
   * short, wide band, laid down in many small pieces that sit on a common
   * baseline, with the pen changing direction constantly. One test is not
   * enough — a scribbled cloud fools any of them alone — so this scores
   * several and asks for a majority.
   */
  function looksLikeWriting(polys, box, ink) {
    if (!polys.length) return false;
    var diag = Math.sqrt(box.w * box.w + box.h * box.h) || 1e-6;
    var total = polys.reduce(function (t, p) { return t + pathLen(p); }, 0);
    var score = 0;

    /* Wide and short. Words are letters in a row. */
    if (box.h > 1e-6 && box.w / box.h > 1.8) score++;
    /* Far more ink than the outline of the area it covers. */
    if (total > diag * 2.6) score++;
    /* Many separate pieces, none of them big. */
    if (polys.length >= 3) {
      var small = polys.filter(function (p) {
        return bboxOf(p).w < box.w * 0.4;
      }).length;
      if (small >= polys.length - 1) score++;
    }
    /* The pen keeps turning back on itself. Counted with a deadband, because
       a hand-drawn vertical edge wanders left and right by a hair the whole
       way down and every one of those wanders is not a change of direction. */
    var turns = 0, dead = diag * 0.035;
    polys.forEach(function (p) {
      var q = resample(p, 24), lastSign = 0, run = 0;
      for (var i = 1; i < q.length; i++) {
        var dx = q[i][0] - q[i - 1][0];
        run += dx;
        if (Math.abs(run) < dead) continue;
        var s = run > 0 ? 1 : -1;
        if (lastSign && s !== lastSign) turns++;
        lastSign = s;
        run = 0;
      }
    });
    if (turns >= 5) score++;

    return score >= 3;
  }

  /* ------------------------------------------------------------------ */
  /* what shape is it?                                                   */
  /* ------------------------------------------------------------------ */

  function corners(loop, closed, tol) {
    var c = simplify(loop, tol);
    if (closed && c.length > 2) {
      /* On a closed loop the pen's start point is usually mid-edge, and RDP
         always keeps the ends. Drop the pair if they are on the same line. */
      c = c.slice(0, -1);
      if (c.length > 3) {
        var a = c[c.length - 1], b = c[0], d = c[1];
        var v1 = [b[0] - a[0], b[1] - a[1]], v2 = [d[0] - b[0], d[1] - b[1]];
        var l1 = Math.hypot(v1[0], v1[1]) || 1, l2 = Math.hypot(v2[0], v2[1]) || 1;
        var cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
        if (cos > 0.94) c.shift();
      }
    }
    return c;
  }

  /* The drawing squashed into a unit square, upright. Roundness has to be
     measured in here: an oval twice as wide as it is tall is exactly as
     round as a circle, and measuring raw distances from the centre says
     otherwise and calls it a nine-sided shape. */
  function normalise(loop, rect) {
    var c = [rect.cx, rect.cy];
    return loop.map(function (p) {
      var q = rot2(p, c, -rect.angle);
      return [(q[0] - rect.cx) / (rect.w || 1e-6) + 0.5,
              (q[1] - rect.cy) / (rect.h || 1e-6) + 0.5];
    });
  }

  function radiiStats(pts, c) {
    var r = pts.map(function (p) { return dist(p, c); });
    var mean = r.reduce(function (a, b) { return a + b; }, 0) / r.length;
    var sd = Math.sqrt(r.reduce(function (a, b) {
      return a + (b - mean) * (b - mean);
    }, 0) / r.length);
    return { mean: mean, cv: mean > 1e-9 ? sd / mean : 1, all: r };
  }

  function interiorAngles(c) {
    var out = [], k = c.length, i;
    for (i = 0; i < k; i++) {
      var a = c[(i - 1 + k) % k], b = c[i], d = c[(i + 1) % k];
      var v1 = [a[0] - b[0], a[1] - b[1]], v2 = [d[0] - b[0], d[1] - b[1]];
      var l1 = Math.hypot(v1[0], v1[1]) || 1, l2 = Math.hypot(v2[0], v2[1]) || 1;
      var cos = Math.min(1, Math.max(-1, (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)));
      out.push(Math.acos(cos) * 180 / Math.PI);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* building the answer                                                 */
  /* ------------------------------------------------------------------ */

  function r4(v) { return Math.round(v * 10000) / 10000; }

  /* Physical -> board. A rect measured in physical space becomes a board box
     by dividing the vertical numbers back out; the rotation is unchanged,
     because CSS turns the box on screen, where the aspect has already been
     applied. */
  function toBoardBox(rect, aspect) {
    var w = rect.w, h = rect.h / aspect;
    return {
      x: r4(rect.cx - w / 2),
      y: r4(rect.cy / aspect - h / 2),
      w: r4(Math.max(0.012, w)),
      h: r4(Math.max(0.012, h)),
      rot: Math.round((rect.deg || 0) * 10) / 10
    };
  }

  /* Freeform points live in the shape's own upright 0..100 box, so they have
     to be un-turned before they are mapped. */
  function ptsInRect(loop, rect) {
    var c = [rect.cx, rect.cy], out = [], i;
    for (i = 0; i < loop.length; i++) {
      var q = rot2(loop[i], c, -rect.angle);
      var x = ((q[0] - (rect.cx - rect.w / 2)) / (rect.w || 1e-6)) * 100;
      var y = ((q[1] - (rect.cy - rect.h / 2)) / (rect.h || 1e-6)) * 100;
      out.push(Math.round(Math.min(200, Math.max(-100, x)) * 100) / 100,
               Math.round(Math.min(200, Math.max(-100, y)) * 100) / 100);
    }
    return out;
  }

  function paint(ink) {
    return {
      stroke: ink.color || "#ffffff",
      strokeW: Math.max(1.5, Math.min(8, Math.round((ink.w || 0.0035) * 900))),
      fillOn: false
    };
  }

  function shapePick(id, name, note, extra, box, ink) {
    var props = paint(ink);
    props.shape = id;
    if (extra) Object.keys(extra).forEach(function (k) { props[k] = extra[k]; });
    return { id: id, name: name, note: note, type: "shape", props: props, box: box };
  }

  function freePick(loop, closed, rect, ink, name, note) {
    var props = paint(ink);
    props.preset = "custom";
    props.edited = true;
    props.closed = !!closed;
    props.edge = "smooth";
    props.pts = ptsInRect(loop, rect);
    return {
      id: "freeform", name: name || "Tidy the lines",
      note: note || "Keeps the shape you drew, smoothed, with every corner still draggable.",
      type: "freeform", props: props, box: toBoardBox(rect, RUN_ASPECT)
    };
  }

  /* The aspect the current call is running under. Passed down rather than
     threaded through nine signatures. */
  var RUN_ASPECT = ASPECT;

  /* ------------------------------------------------------------------ */

  function read(strokes, opts) {
    opts = opts || {};
    var aspect = opts.aspect > 0 ? opts.aspect : ASPECT;
    RUN_ASPECT = aspect;

    var list = (strokes || []).filter(function (s) {
      return s && s.pts && s.pts.length >= 4;
    });
    if (!list.length) return null;

    var polys = list.map(function (s) { return toPoly(s, aspect); })
                    .filter(function (p) { return p.length > 1; });
    if (!polys.length) return null;

    var all = [];
    polys.forEach(function (p) { all = all.concat(p); });
    var box = bboxOf(all);
    var diag = Math.sqrt(box.w * box.w + box.h * box.h);
    /* Two per cent of the board across. Below that it is a full stop, a tick
       or a slip of the finger, and offering to turn it into a rectangle is
       not help. */
    if (diag < 0.02) return null;

    /* What it was drawn with, so the new object looks like it belongs. The
       commonest colour wins, not the first — a shape traced twice in white
       with one stray blue mark is a white shape. */
    var tally = {}, ink = { color: "#ffffff", w: 0.0035 };
    list.forEach(function (s) {
      var c = s.color || "#ffffff";
      tally[c] = (tally[c] || 0) + (s.pts.length);
    });
    var bestN = -1;
    Object.keys(tally).forEach(function (c) {
      if (tally[c] > bestN) { bestN = tally[c]; ink.color = c; }
    });
    ink.w = list.reduce(function (t, s) { return t + (s.w || 0.0035); }, 0) / list.length;

    var boardBox = {
      x: r4(box.x), y: r4(box.y / aspect),
      w: r4(box.w), h: r4(box.h / aspect)
    };

    var out = { writing: false, ink: ink, box: boardBox, picks: [] };
    var mightBeWriting = looksLikeWriting(polys, box, ink);

    /* --- arrow: a long straight run with a small V stuck on one end --- */
    var arrow = readArrow(polys, diag, ink);
    if (arrow) out.picks.push(arrow);

    /* --- everything else works on the joined-up outline --------------- */
    var chains = chain(polys, diag * 0.09);
    chains.sort(function (a, b) { return pathLen(b) - pathLen(a); });
    var loop = resample(chains[0], 64);
    var len = pathLen(loop);
    var gap = dist(loop[0], loop[loop.length - 1]);
    var closed = gap < Math.max(diag * 0.18, len * 0.13);
    var straight = len > 1e-9 ? gap / len : 0;

    var work = closed ? loop.concat([loop[0]]) : loop;
    var cs = corners(work, closed, diag * 0.045);
    var c0 = centroidOf(loop);
    var rect = minAreaRect(loop);
    var upright = axisRect(loop);
    /* Roundness, judged in the unit square. */
    var rad = radiiStats(normalise(loop, rect), [0.5, 0.5]);

    if (!closed && straight > 0.92 && !arrow) {
      /* A line. The box is the line: give it a little height so the handles
         are grabbable, and no fill, because a filled line is a smear. */
      var lb = toBoardBox(rect, aspect);
      lb.h = Math.max(lb.h, 0.03);
      out.picks.push(shapePick("line", "Straight line",
        "Snapped to a true straight line at the angle you drew it.", null, lb, ink));
      out.picks.push(shapePick("arrow", "Arrow",
        "Same line, with a head on the end.", null, lb, ink));
    } else if (closed) {
      /* Only three shapes carry a meaningful angle: a box, a line and an
         arrow. A triangle, a pentagon or a star drawn upright has a smallest
         turned box that is not upright at all — the minimum for a triangle
         sits flush against one of its sides — and putting that angle on the
         element would tip a shape the teacher drew level. Those get the
         upright box. */
      var square = Math.abs(upright.w - upright.h) / Math.max(upright.w, upright.h) < 0.18;
      var elong = Math.max(rect.w, rect.h) / Math.max(1e-9, Math.min(rect.w, rect.h));

      if (rad.cv < 0.06 && cs.length >= 6) {
        /* A tilted oval is worth the turned box; a circle is not, because
           its angle is whatever rounding happened to pick. */
        var eb = (elong > 1.3 && Math.abs(rect.deg) > 6)
          ? toBoardBox(rect, aspect)
          : toBoardBox(square ? evenUp(upright) : upright, aspect);
        out.picks.push(shapePick("ellipse", square ? "Circle" : "Oval",
          "A true " + (square ? "circle" : "oval") + " over the same ground.",
          null, eb, ink));

      } else if (cs.length === 3) {
        out.picks.push(shapePick("triangle", "Triangle",
          "An even triangle in the same box.", null,
          toBoardBox(upright, aspect), ink));

      } else if (cs.length === 4) {
        var ang = interiorAngles(cs);
        var boxy = ang.every(function (a) { return Math.abs(a - 90) < 22; });
        var boxSq = Math.abs(rect.w - rect.h) / Math.max(rect.w, rect.h) < 0.18;
        if (boxy) {
          out.picks.push(shapePick("rect", boxSq ? "Square" : "Rectangle",
            "Square corners, turned to match the way you drew it.", null,
            toBoardBox(boxSq ? evenUp(rect) : rect, aspect), ink));
          out.picks.push(shapePick("rrect", "Rounded box",
            "The same box with its corners taken off.",
            { radius: 14 }, toBoardBox(rect, aspect), ink));
        }
        /* A diamond, and not a turned square, means the four corners sit on
           the middles of the upright box's sides. */
        if (onEdgeMidpoints(cs, upright)) {
          out.picks.push(shapePick("diamond", "Diamond",
            "Four points, upright.", null, toBoardBox(upright, aspect), ink));
        }

      } else if (cs.length >= 8 && cs.length <= 24 && cs.length % 2 === 0 &&
                 starRatio(cs, c0) < 0.78) {
        var ratio = starRatio(cs, c0);
        out.picks.push(shapePick("star", "Star",
          cs.length / 2 + " points, evened up.",
          { sides: cs.length / 2, inset: Math.round(Math.max(10, Math.min(90, ratio * 100))) },
          toBoardBox(evenUp(upright), aspect), ink));

      } else if (cs.length >= 5 && cs.length <= 24 && rad.cv < 0.13) {
        out.picks.push(shapePick("polygon", cs.length + "-sided shape",
          "An even " + cs.length + "-sided shape.",
          { sides: cs.length },
          toBoardBox(evenUp(upright), aspect), ink));
      }
    }

    /* Always available, always last resort, and often the right answer: the
       thing you drew, smoothed, with every corner still yours to move. */
    /* A drawing that came out as a clean circle, box, triangle or arrow is a
       drawing, whatever the ink-density arithmetic thought. Nobody writes a
       word that is also a pentagon. */
    out.writing = mightBeWriting && !out.picks.some(function (p) {
      return p.type === "shape";
    });

    var keep = closed ? cs : simplify(loop, diag * 0.02);
    if (keep.length >= 2 && !out.writing) {
      out.picks.push(freePick(keep, closed, rect, ink));
    }

    return out;
  }

  /* Make a box square about its own centre, for a circle or a star. */
  function evenUp(rect) {
    var s = (rect.w + rect.h) / 2;
    return { cx: rect.cx, cy: rect.cy, w: s, h: s, deg: rect.deg, angle: rect.angle };
  }

  /* Upright box, for the shapes whose whole identity is being upright. */
  function axisRect(loop) {
    var b = bboxOf(loop);
    return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, deg: 0, angle: 0 };
  }

  function onEdgeMidpoints(cs, box) {
    if (cs.length !== 4) return false;
    var cx = box.cx, cy = box.cy;
    var tx = box.w * 0.18, ty = box.h * 0.18;
    return cs.every(function (p) {
      return Math.abs(p[0] - cx) < tx || Math.abs(p[1] - cy) < ty;
    });
  }

  function starRatio(cs, c) {
    var r = cs.map(function (p) { return dist(p, c); });
    var even = 0, odd = 0, i;
    for (i = 0; i < r.length; i++) {
      if (i % 2) odd += r[i]; else even += r[i];
    }
    even /= Math.ceil(r.length / 2);
    odd /= Math.floor(r.length / 2);
    var lo = Math.min(even, odd), hi = Math.max(even, odd);
    return hi > 1e-9 ? lo / hi : 1;
  }

  /* An arrow is almost always drawn as a shaft and then a head, in two or
     three separate strokes. Look for exactly that rather than trying to see
     it in one merged outline, where the head is just noise at one end. */
  function readArrow(polys, diag, ink) {
    if (polys.length < 2 || polys.length > 4) return null;
    var ranked = polys.slice().sort(function (a, b) { return pathLen(b) - pathLen(a); });
    var shaft = ranked[0], rest = ranked.slice(1);
    var sl = pathLen(shaft);
    if (sl < diag * 0.5) return null;
    if (dist(shaft[0], shaft[shaft.length - 1]) / sl < 0.9) return null;

    var restLen = rest.reduce(function (t, p) { return t + pathLen(p); }, 0);
    if (restLen > sl * 0.85) return null;

    var head = null, tail = null;
    var a = shaft[0], b = shaft[shaft.length - 1];
    var nearA = 0, nearB = 0;
    rest.forEach(function (p) {
      var da = Math.min(dist(p[0], a), dist(p[p.length - 1], a));
      var db = Math.min(dist(p[0], b), dist(p[p.length - 1], b));
      if (Math.min(da, db) > sl * 0.3) return;
      if (da < db) nearA++; else nearB++;
    });
    if (nearA + nearB === 0) return null;
    /* The head is at the end the extra strokes cluster around; the arrow
       points that way. */
    if (nearB >= nearA) { tail = a; head = b; } else { tail = b; head = a; }

    var ang = Math.atan2(head[1] - tail[1], head[0] - tail[0]);
    var cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2;
    var rect = { cx: cx, cy: cy, w: sl, h: Math.max(sl * 0.26, diag * 0.12),
                 deg: ang * 180 / Math.PI, angle: ang };
    var props = paint(ink);
    props.shape = "arrow";
    return {
      id: "arrow", name: "Arrow",
      note: "A straight arrow pointing the way yours does.",
      type: "shape", props: props, box: toBoardBox(rect, RUN_ASPECT)
    };
  }

  global.ChalkRecognise = {
    read: read,
    ASPECT: ASPECT,
    /* Exposed for the tests and for anything else that wants the plumbing. */
    _internals: {
      simplify: simplify, resample: resample, minAreaRect: minAreaRect,
      chain: chain, looksLikeWriting: looksLikeWriting
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
