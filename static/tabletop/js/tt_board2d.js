/* tt_board2d.js — the phone boards.
 *
 * Lightweight SVG so cheap phones keep up. Every piece idles (bobbing,
 * blinking eyes); captures play a slash across the victim, which splits
 * into two halves that slide apart and fall away.
 *
 *   var b = TTBoard2D.create(container, { onAction: fn(action) });
 *   b.render(match, { seat, priv, animate: events })   // seat = my seat or -1
 *
 * Animations are queued: a burst of updates plays in order, then the board
 * settles on the newest state.
 */
window.TTBoard2D = (function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var S = 100;           // one cell, in SVG units
  var uid = 0;

  function svg(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function tween(ms, fn) {
    return new Promise(function (res) {
      var t0 = performance.now();
      function step(now) {
        var k = Math.min(1, (now - t0) / ms);
        fn(k);
        if (k < 1) requestAnimationFrame(step); else res();
      }
      requestAnimationFrame(step);
    });
  }
  function ease(k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }

  /* ───────────────────────── piece art (original, simple) ───────────────────────── */
  var CHESS_ART = {
    p: '<ellipse cx="50" cy="84" rx="26" ry="8"/><path d="M34 82 L40 56 L60 56 L66 82 Z"/><rect x="36" y="52" width="28" height="7" rx="3"/><circle cx="50" cy="40" r="14"/>',
    r: '<ellipse cx="50" cy="85" rx="28" ry="8"/><path d="M32 82 L35 40 L65 40 L68 82 Z"/><path d="M30 42 L30 22 L39 22 L39 29 L46 29 L46 22 L54 22 L54 29 L61 29 L61 22 L70 22 L70 42 Z"/>',
    n: '<ellipse cx="50" cy="85" rx="28" ry="8"/><path d="M30 82 L34 64 C30 54 34 44 42 36 L40 24 L50 30 C62 30 72 40 74 54 L70 58 L60 50 L56 56 C62 62 66 72 68 82 Z"/>',
    b: '<ellipse cx="50" cy="85" rx="26" ry="8"/><path d="M36 82 L42 60 L58 60 L64 82 Z"/><path d="M50 18 C64 30 66 46 58 60 L42 60 C34 46 36 30 50 18 Z"/><circle cx="50" cy="14" r="5"/><path d="M52 32 L60 40" stroke-width="4"/>',
    q: '<ellipse cx="50" cy="85" rx="28" ry="8"/><path d="M34 82 L40 50 L60 50 L66 82 Z"/><path d="M30 26 L38 50 L62 50 L70 26 L60 40 L50 20 L40 40 Z"/><circle cx="30" cy="24" r="5"/><circle cx="50" cy="17" r="5"/><circle cx="70" cy="24" r="5"/>',
    k: '<ellipse cx="50" cy="85" rx="28" ry="8"/><path d="M33 82 L39 46 L61 46 L67 82 Z"/><path d="M36 48 C32 34 40 26 50 30 C60 26 68 34 64 48 Z"/><rect x="46" y="8" width="8" height="22" rx="2"/><rect x="40" y="14" width="20" height="7" rx="2"/>',
  };
  var EYES_Y = { p: 40, r: 58, n: 44, b: 44, q: 62, k: 60 };

  function eyes(parent, y, x0, dark) {
    var g = svg("g", { class: "tt-eyes" }, parent);
    [-6, 6].forEach(function (dx) {
      svg("ellipse", { cx: (x0 || 50) + dx, cy: y, rx: 3.2, ry: 4, fill: dark ? "#f8fafc" : "#111827", stroke: "none" }, g);
    });
    return g;
  }

  function chessPiece(layer, p, x, y) {
    var white = p === p.toUpperCase();
    var g = svg("g", { class: "tt-pc", transform: "translate(" + x + "," + y + ")" }, layer);
    var inner = svg("g", { class: "tt-bob", style: "animation-delay:" + (-Math.random() * 3).toFixed(2) + "s" }, g);
    inner.innerHTML = CHESS_ART[p.toLowerCase()];
    inner.setAttribute("fill", white ? "#fbf7ef" : "#262b36");
    inner.setAttribute("stroke", white ? "#5b6476" : "#9aa5b8");
    inner.setAttribute("stroke-width", "3");
    inner.setAttribute("stroke-linejoin", "round");
    eyes(inner, EYES_Y[p.toLowerCase()], p.toLowerCase() === "n" ? 58 : 50, !white);
    return g;
  }

  function damPiece(layer, p, x, y, colourMine) {
    var light = p.toLowerCase() === "w";
    var g = svg("g", { class: "tt-pc", transform: "translate(" + x + "," + y + ")" }, layer);
    var inner = svg("g", { class: "tt-bob", style: "animation-delay:" + (-Math.random() * 3).toFixed(2) + "s" }, g);
    svg("ellipse", { cx: 50, cy: 60, rx: 38, ry: 32, fill: light ? "#c9b48a" : "#3a2a20" }, inner);
    svg("ellipse", { cx: 50, cy: 52, rx: 38, ry: 32, fill: light ? "#f3e6c8" : "#6b4a34", stroke: light ? "#a08b62" : "#2a1c14", "stroke-width": 3 }, inner);
    svg("ellipse", { cx: 50, cy: 52, rx: 24, ry: 20, fill: "none", stroke: light ? "#c9b48a" : "#8a6448", "stroke-width": 3 }, inner);
    if (p === p.toUpperCase()) {
      svg("path", { d: "M30 46 L34 26 L42 38 L50 22 L58 38 L66 26 L70 46 Z", fill: "#facc15", stroke: "#a16207", "stroke-width": 2.5 }, inner);
    }
    eyes(inner, p === p.toUpperCase() ? 56 : 50, 50, !light);
    return g;
  }

  function ludoPawn(layer, colour, x, y, scale) {
    var g = svg("g", { class: "tt-pc", transform: "translate(" + x + "," + y + ")" }, layer);
    var inner = svg("g", { class: "tt-bob", style: "animation-delay:" + (-Math.random() * 3).toFixed(2) + "s", transform: "translate(50 50) scale(" + (scale || 1) + ") translate(-50 -50)" }, g);
    var col = TT.LUDO_COLORS[colour];
    svg("ellipse", { cx: 50, cy: 82, rx: 24, ry: 8, fill: "rgba(0,0,0,.3)" }, inner);
    svg("path", { d: "M30 80 C30 66 40 56 42 46 L58 46 C60 56 70 66 70 80 Z", fill: col, stroke: "#1f2937", "stroke-width": 3 }, inner);
    svg("circle", { cx: 50, cy: 36, r: 16, fill: col, stroke: "#1f2937", "stroke-width": 3 }, inner);
    svg("circle", { cx: 45, cy: 31, r: 5, fill: "rgba(255,255,255,.55)" }, inner);
    eyes(inner, 38, 50, false);
    return g;
  }

  /* ───────────────────────── capture FX ───────────────────────── */
  function sliceAway(svgRoot, layer, pieceG, angle) {
    // two clipped copies of the victim slide apart along the cut
    if (!pieceG) return Promise.resolve();
    var defs = svgRoot.querySelector("defs");
    var id = "cut" + (++uid);
    var a = angle != null ? angle : -0.6;
    var nx = Math.cos(a + Math.PI / 2), ny = Math.sin(a + Math.PI / 2);
    var c1 = svg("clipPath", { id: id + "a" }, defs), c2 = svg("clipPath", { id: id + "b" }, defs);
    // big half-planes through (50,50)
    var dx = Math.cos(a) * 200, dy = Math.sin(a) * 200;
    svg("polygon", { points: [50 - dx, 50 - dy, 50 + dx, 50 + dy, 50 + dx + nx * 300, 50 + dy + ny * 300, 50 - dx + nx * 300, 50 - dy + ny * 300].join(" ") }, c1);
    svg("polygon", { points: [50 - dx, 50 - dy, 50 + dx, 50 + dy, 50 + dx - nx * 300, 50 + dy - ny * 300, 50 - dx - nx * 300, 50 - dy - ny * 300].join(" ") }, c2);
    var base = pieceG.getAttribute("transform");
    var h1 = pieceG.cloneNode(true), h2 = pieceG.cloneNode(true);
    [h1, h2].forEach(function (h) {
      var b = h.querySelector(".tt-bob"); if (b) b.classList.remove("tt-bob");
      var e = h.querySelector(".tt-eyes"); if (e) e.innerHTML = '<path d="M38 36 l8 8 m0 -8 l-8 8 M54 36 l8 8 m0 -8 l-8 8" stroke="#ef4444" stroke-width="3"/>';
    });
    h1.setAttribute("clip-path", "url(#" + id + "a)");
    h2.setAttribute("clip-path", "url(#" + id + "b)");
    layer.appendChild(h1); layer.appendChild(h2);
    pieceG.remove();
    // slash streak
    var slash = svg("line", { x1: 50 - Math.cos(a) * 60, y1: 50 - Math.sin(a) * 60, x2: 50 + Math.cos(a) * 60, y2: 50 + Math.sin(a) * 60,
      stroke: "#fff", "stroke-width": 7, "stroke-linecap": "round", class: "tt-slash", transform: base }, layer);
    slash.style.filter = "drop-shadow(0 0 6px #67e8f9)";
    var sparks = [];
    for (var i = 0; i < 10; i++) {
      sparks.push({ el: svg("circle", { r: 3 + Math.random() * 3, fill: i % 2 ? "#fde047" : "#67e8f9", transform: base }, layer),
                    vx: (Math.random() - 0.5) * 160, vy: (Math.random() - 0.8) * 160 });
    }
    TT.sfx("slash");
    return tween(700, function (k) {
      var e = ease(k), d = e * 26;
      h1.setAttribute("transform", base + " translate(" + (nx * d) + "," + (ny * d + e * e * 40) + ") rotate(" + (e * 25) + " 50 50)");
      h2.setAttribute("transform", base + " translate(" + (-nx * d) + "," + (-ny * d + e * e * 40) + ") rotate(" + (-e * 25) + " 50 50)");
      h1.style.opacity = h2.style.opacity = String(1 - Math.max(0, k - 0.5) * 2);
      slash.style.opacity = String(Math.max(0, 1 - k * 2.5));
      sparks.forEach(function (s) {
        s.el.setAttribute("cx", 50 + s.vx * e); s.el.setAttribute("cy", 50 + s.vy * e + 90 * k * k);
        s.el.style.opacity = String(1 - k);
      });
      if (k > 0.15 && !h1._sp) { h1._sp = 1; TT.sfx("split"); }
    }).then(function () {
      [h1, h2, slash, c1, c2].forEach(function (x) { x.remove(); });
      sparks.forEach(function (s) { s.el.remove(); });
    });
  }

  function slideTo(g, x, y, ms, arc) {
    var m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(g.getAttribute("transform") || "") || [0, 0, 0];
    var x0 = +m[1], y0 = +m[2];
    TT.sfx("move");
    return tween(ms, function (k) {
      var e = ease(k);
      var h = Math.sin(k * Math.PI) * (arc || 0);
      g.setAttribute("transform", "translate(" + (x0 + (x - x0) * e) + "," + (y0 + (y - y0) * e - h) + ")" + (arc ? " translate(50 50) scale(" + (1 + Math.sin(k * Math.PI) * 0.15) + ") translate(-50 -50)" : ""));
    }).then(function () { g.setAttribute("transform", "translate(" + x + "," + y + ")"); TT.sfx("land"); });
  }

  function burst(layer, x, y, color, text) {
    var g = svg("g", { transform: "translate(" + x + "," + y + ")" }, layer);
    var ring = svg("circle", { cx: 50, cy: 50, r: 10, fill: "none", stroke: color, "stroke-width": 6 }, g);
    var t = text ? svg("text", { x: 50, y: 30, "text-anchor": "middle", "font-size": 34, "font-weight": 900, fill: color, stroke: "#0008", "stroke-width": 2 }, g) : null;
    if (t) t.textContent = text;
    return tween(900, function (k) {
      ring.setAttribute("r", 10 + k * 60);
      ring.style.opacity = String(1 - k);
      if (t) { t.setAttribute("y", 30 - k * 50); t.style.opacity = String(1 - Math.max(0, k - 0.6) * 2.5); }
    }).then(function () { g.remove(); });
  }

  /* ───────────────────────── the board object ───────────────────────── */
  function create(container, opts) {
    opts = opts || {};
    var root = svg("svg", { class: "tt-svg", preserveAspectRatio: "xMidYMid meet" });
    container.appendChild(root);
    var defs = svg("defs", {}, root);
    var gBoard = svg("g", {}, root), gMarks = svg("g", {}, root), gPieces = svg("g", {}, root), gFx = svg("g", {}, root);
    var cur = null, seat = -1, priv = null, sel = null, pending = [], queue = Promise.resolve();
    var damSel = null, wordsSel = null, words = { placed: [] };
    var busy = false, deferred = [];   // taps made mid-animation replay afterwards

    function flip() {
      if (cur && PLUGINS[cur.game]) return !!(PLUGINS[cur.game].flip && PLUGINS[cur.game].flip(seat));
      return cur && (cur.game === "chess" || cur.game === "dam") && seat === 1;
    }
    function plug() { return cur && PLUGINS[cur.game]; }

    function setViewBox(n) { root.setAttribute("viewBox", "0 0 " + n * S + " " + n * S); }

    /* ---------- chess ---------- */
    function chessXY(r, c) { return flip() ? [(7 - c) * S, r * S] : [c * S, (7 - r) * S]; }
    function drawChess(st) {
      setViewBox(8);
      gBoard.innerHTML = ""; gPieces.innerHTML = "";
      for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) {
        var xy = chessXY(r, c), dark = (r + c) % 2 === 0;
        svg("rect", { x: xy[0], y: xy[1], width: S, height: S, fill: dark ? "#7c5a3c" : "#e9d6b4", "data-sq": TTGeo.chessName(r, c) }, gBoard);
      }
      if (st.last) st.last.forEach(function (n) {
        var q = TTGeo.chessSq(n), xy = chessXY(q.r, q.c);
        svg("rect", { x: xy[0], y: xy[1], width: S, height: S, fill: "rgba(250,204,21,.35)" }, gBoard);
      });
      for (var i = 0; i < 64; i++) {
        var p = st.board.charAt(i);
        if (p === ".") continue;
        var xy2 = chessXY(Math.floor(i / 8), i % 8);
        var g = chessPiece(gPieces, p, xy2[0], xy2[1]);
        g.setAttribute("data-sq", TTGeo.chessName(Math.floor(i / 8), i % 8));
        if (st.check && p === (st.side === "w" ? "K" : "k")) g.classList.add("tt-incheck");
      }
      drawChessMarks(st);
    }
    function drawChessMarks(st) {
      gMarks.innerHTML = "";
      if (!sel) return;
      var q = TTGeo.chessSq(sel), xy = chessXY(q.r, q.c);
      svg("rect", { x: xy[0] + 3, y: xy[1] + 3, width: S - 6, height: S - 6, fill: "none", stroke: "#22d3ee", "stroke-width": 6, rx: 10 }, gMarks);
      st.legal.filter(function (m) { return m.slice(0, 2) === sel; }).forEach(function (m) {
        var t = TTGeo.chessSq(m.slice(2, 4)), xy2 = chessXY(t.r, t.c);
        var cap = st.board.charAt(t.r * 8 + t.c) !== ".";
        svg("circle", { cx: xy2[0] + 50, cy: xy2[1] + 50, r: cap ? 44 : 14, fill: cap ? "none" : "rgba(34,211,238,.75)", stroke: cap ? "rgba(239,68,68,.85)" : "none", "stroke-width": 7, class: "tt-hint" }, gMarks);
      });
    }
    function chessTap(name) {
      var st = cur.state;
      if (st.turn !== seat) return;
      var mine = function (n) {
        var q = TTGeo.chessSq(n), p = st.board.charAt(q.r * 8 + q.c);
        return p !== "." && (p === p.toUpperCase()) === (seat === 0);
      };
      if (sel) {
        var opts2 = st.legal.filter(function (m) { return m.slice(0, 4) === sel + name; });
        if (opts2.length === 1) { act({ type: "move", move: opts2[0] }); sel = null; drawChessMarks(st); return; }
        if (opts2.length > 1) { promoPicker(sel + name); return; }
      }
      sel = mine(name) && st.legal.some(function (m) { return m.slice(0, 2) === name; }) ? name : null;
      if (sel) TT.sfx("tap");
      drawChessMarks(st);
    }
    function promoPicker(uci) {
      var box = TT.el("div", "tt-promo");
      var white = seat === 0;
      box.innerHTML = '<p>Promote to</p><div>' + ["q", "r", "b", "n"].map(function (k) {
        return '<button type="button" data-k="' + k + '"><svg viewBox="0 0 100 100" width="54" height="54"><g fill="' + (white ? "#fbf7ef" : "#262b36") + '" stroke="' + (white ? "#5b6476" : "#9aa5b8") + '" stroke-width="3">' + CHESS_ART[k] + "</g></svg></button>";
      }).join("") + "</div>";
      container.appendChild(box);
      box.addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b) return;
        act({ type: "move", move: uci + b.dataset.k });
        sel = null; box.remove(); drawChessMarks(cur.state);
      });
    }

    /* ---------- dam ---------- */
    function damXY(i, n) {
      var r = Math.floor(i / n), c = i % n;
      return flip() ? [(n - 1 - c) * S, r * S] : [c * S, (n - 1 - r) * S];
    }
    function drawDam(st) {
      var n = st.size;
      setViewBox(n);
      gBoard.innerHTML = ""; gPieces.innerHTML = "";
      for (var i = 0; i < n * n; i++) {
        var xy = damXY(i, n), dark = (Math.floor(i / n) + i % n) % 2 === 0;
        svg("rect", { x: xy[0], y: xy[1], width: S, height: S, fill: dark ? "#2f5d3a" : "#f1e7cf", "data-i": i }, gBoard);
      }
      (st.last || []).forEach(function (i) {
        var xy = damXY(i, n);
        svg("rect", { x: xy[0], y: xy[1], width: S, height: S, fill: "rgba(250,204,21,.3)" }, gBoard);
      });
      for (var j = 0; j < n * n; j++) {
        var p = st.board.charAt(j);
        if (p === ".") continue;
        var xy2 = damXY(j, n);
        damPiece(gPieces, p, xy2[0], xy2[1]).setAttribute("data-i", j);
      }
      drawDamMarks(st);
    }
    function damOptions(st) {
      if (!damSel) return [];
      return st.legal.filter(function (o) {
        for (var k = 0; k < damSel.length; k++) if (o.path[k] !== damSel[k]) return false;
        return true;
      });
    }
    function drawDamMarks(st) {
      gMarks.innerHTML = "";
      var n = st.size;
      if (st.turn === seat && !damSel) {
        // glow pieces that may move (shows compulsory captures)
        var starts = {};
        st.legal.forEach(function (o) { starts[o.path[0]] = 1; });
        Object.keys(starts).forEach(function (i) {
          var xy = damXY(+i, n);
          svg("circle", { cx: xy[0] + 50, cy: xy[1] + 50, r: 46, fill: "none", stroke: st.legal[0].caps.length ? "#f87171" : "#22d3ee", "stroke-width": 4, "stroke-dasharray": "10 8", class: "tt-spin" }, gMarks);
        });
      }
      if (!damSel) return;
      damSel.forEach(function (i) {
        var xy = damXY(i, n);
        svg("rect", { x: xy[0] + 4, y: xy[1] + 4, width: S - 8, height: S - 8, rx: 10, fill: "none", stroke: "#22d3ee", "stroke-width": 6 }, gMarks);
      });
      var nexts = {};
      damOptions(st).forEach(function (o) { if (o.path.length > damSel.length) nexts[o.path[damSel.length]] = 1; });
      Object.keys(nexts).forEach(function (i) {
        var xy = damXY(+i, n);
        svg("circle", { cx: xy[0] + 50, cy: xy[1] + 50, r: 16, fill: "rgba(34,211,238,.8)", class: "tt-hint" }, gMarks);
      });
    }
    function damTap(i) {
      var st = cur.state;
      if (st.turn !== seat) return;
      if (damSel) {
        var opts2 = damOptions(st).filter(function (o) { return o.path[damSel.length] === i; });
        if (opts2.length) {
          damSel = damSel.concat([i]);
          var done = opts2.filter(function (o) { return o.path.length === damSel.length; });
          var longer = opts2.filter(function (o) { return o.path.length > damSel.length; });
          if (done.length && !longer.length) { act({ type: "move", path: done[0].path }); damSel = null; }
          TT.sfx("tap");
          drawDamMarks(st);
          return;
        }
      }
      damSel = st.legal.some(function (o) { return o.path[0] === i; }) ? [i] : null;
      if (damSel) TT.sfx("tap");
      drawDamMarks(st);
    }

    /* ---------- ludo ---------- */
    var LS = 15;
    function ludoXY(r, c) { return [c * S, r * S]; }
    function drawLudoBoard() {
      setViewBox(15);
      gBoard.innerHTML = "";
      svg("rect", { x: 0, y: 0, width: 1500, height: 1500, fill: "#fdf8ee", rx: 30 }, gBoard);
      var yards = [[0, 0], [0, 9], [9, 9], [9, 0]];
      yards.forEach(function (y, col) {
        svg("rect", { x: y[1] * S + 10, y: y[0] * S + 10, width: 6 * S - 20, height: 6 * S - 20, rx: 40, fill: TT.LUDO_COLORS[col] }, gBoard);
        svg("rect", { x: y[1] * S + 90, y: y[0] * S + 90, width: 4 * S - 80, height: 4 * S - 80, rx: 30, fill: "#fff" }, gBoard);
        [[-0.9, -0.9], [-0.9, 0.9], [0.9, -0.9], [0.9, 0.9]].forEach(function (o) {
          var yd = TTGeo.YARD[col];
          svg("circle", { cx: (yd[1] + o[1]) * S + 50, cy: (yd[0] + o[0]) * S + 50, r: 34, fill: TT.LUDO_COLORS[col], opacity: 0.25 }, gBoard);
        });
      });
      TTGeo.TRACK.forEach(function (rc, gi) {
        var fill = "#fff";
        [0, 13, 26, 39].forEach(function (s, col) { if (gi === s) fill = TT.LUDO_COLORS[col]; });
        svg("rect", { x: rc[1] * S + 3, y: rc[0] * S + 3, width: S - 6, height: S - 6, rx: 10, fill: fill, stroke: "#d6cdb8", "stroke-width": 3 }, gBoard);
        if (TTGeo.SAFE.indexOf(gi) >= 0 && fill === "#fff") {
          svg("path", { d: "M50 18 L58 40 L82 40 L62 54 L70 78 L50 64 L30 78 L38 54 L18 40 L42 40 Z", fill: "#facc15", transform: "translate(" + rc[1] * S + "," + rc[0] * S + ")" }, gBoard);
        }
      });
      for (var col = 0; col < 4; col++) for (var k = 0; k < 5; k++) {
        var rc2 = TTGeo.ludoCell(col, 51 + k);
        svg("rect", { x: rc2[1] * S + 3, y: rc2[0] * S + 3, width: S - 6, height: S - 6, rx: 10, fill: TT.LUDO_COLORS[col], opacity: 0.85 }, gBoard);
      }
      // centre triangles
      var cx = 7.5 * S, cy = 7.5 * S;
      [[6, 6, 6, 9], [6, 9, 9, 9], [9, 9, 9, 6], [9, 6, 6, 6]].forEach(function (e, i) {
        var col = [1, 2, 3, 0][i];
        svg("polygon", { points: [e[1] * S, e[0] * S, e[3] * S, e[2] * S, cx, cy].join(" "), fill: TT.LUDO_COLORS[col] }, gBoard);
      });
    }
    function drawLudo(st) {
      if (!gBoard.firstChild || gBoard.dataset.kind !== "ludo") { drawLudoBoard(); gBoard.dataset.kind = "ludo"; }
      gPieces.innerHTML = ""; gMarks.innerHTML = "";
      TTGeo.ludoLayout(st.tokens, st.colours).forEach(function (t) {
        var g = ludoPawn(gPieces, t.colour, t.c * S, t.r * S - 8, t.rel === 56 ? 0.6 : 0.95);
        g.setAttribute("data-t", t.seat + ":" + t.token);
        if (t.seat === seat && st.turn === seat && st.phase === "move" && st.movable.indexOf(t.token) >= 0) {
          g.classList.add("tt-glow");
          svg("circle", { cx: t.c * S + 50, cy: t.r * S + 50, r: 46, fill: "none", stroke: "#fff", "stroke-width": 6, class: "tt-ping" }, gMarks);
        }
      });
    }

    /* ---------- words ---------- */
    var PREM_COL = { TW: "#ef4444", DW: "#f9a8d4", TL: "#3b82f6", DL: "#93c5fd" };
    function drawWords(st) {
      setViewBox(15);
      gBoard.innerHTML = ""; gPieces.innerHTML = ""; gMarks.innerHTML = "";
      svg("rect", { x: 0, y: 0, width: 1500, height: 1500, fill: "#0f5132" }, gBoard);
      for (var i = 0; i < 225; i++) {
        var r = Math.floor(i / 15), c = i % 15, p = st.premium[i];
        svg("rect", { x: c * S + 3, y: r * S + 3, width: S - 6, height: S - 6, rx: 8, fill: p ? PREM_COL[p] : "#1f7a4d", "data-i": i }, gBoard);
        if (p) {
          var t = svg("text", { x: c * S + 50, y: r * S + 60, "text-anchor": "middle", "font-size": 30, "font-weight": 800, fill: "#fff", opacity: 0.9, "pointer-events": "none" }, gBoard);
          t.textContent = i === 112 ? "★" : p;
        }
      }
      var lastSet = {};
      ((st.last && st.last.tiles) || []).forEach(function (t) { lastSet[t.r * 15 + t.c] = 1; });
      st.board.forEach(function (l, i) { if (l) tile(gPieces, l, i, lastSet[i] ? "last" : "", st.values); });
      words.placed.forEach(function (pl) { tile(gPieces, pl.l, pl.r * 15 + pl.c, "pending", st.values, pl.blank); });
    }
    function tile(layer, l, i, cls, values, blank) {
      var r = Math.floor(i / 15), c = i % 15;
      var g = svg("g", { class: "tt-tile " + (cls || ""), transform: "translate(" + c * S + "," + r * S + ")", "data-i": i }, layer);
      svg("rect", { x: 4, y: 4, width: S - 8, height: S - 8, rx: 12, fill: cls === "pending" ? "#fde68a" : "#f5e6c4", stroke: cls === "last" ? "#facc15" : "#b08d57", "stroke-width": cls === "last" ? 6 : 3 }, g);
      var isBlank = blank || l === l.toLowerCase();
      var t = svg("text", { x: 46, y: 68, "text-anchor": "middle", "font-size": 56, "font-weight": 900, fill: isBlank ? "#7c3aed" : "#1f2937" }, g);
      t.textContent = l.toUpperCase();
      var v = svg("text", { x: 80, y: 88, "text-anchor": "middle", "font-size": 22, "font-weight": 700, fill: "#1f2937" }, g);
      v.textContent = isBlank ? "" : (values[l.toUpperCase()] || "");
      return g;
    }
    function wordsTap(i) {
      if (!cur || cur.state.turn !== seat) return;
      var r = Math.floor(i / 15), c = i % 15;
      var at = words.placed.findIndex(function (p) { return p.r === r && p.c === c; });
      if (at >= 0) { words.placed.splice(at, 1); TT.sfx("tap"); drawWords(cur.state); opts.onRack && opts.onRack(); return; }
      if (cur.state.board[i] || wordsSel == null) return;
      var letter = priv.rack[wordsSel];
      var place = function (l, blank) {
        words.placed.push({ r: r, c: c, l: l, blank: blank, rackIndex: wordsSel });
        wordsSel = null; TT.sfx("tile");
        drawWords(cur.state); opts.onRack && opts.onRack();
      };
      if (letter === "?") blankPicker(function (l) { place(l.toLowerCase(), true); });
      else place(letter, false);
    }
    function blankPicker(cb) {
      var box = TT.el("div", "tt-promo tt-blank");
      box.innerHTML = "<p>Blank tile — choose a letter</p><div>" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(function (l) {
        return '<button type="button" data-l="' + l + '">' + l + "</button>";
      }).join("") + "</div>";
      container.appendChild(box);
      box.addEventListener("click", function (e) {
        var b = e.target.closest("button"); if (!b) return;
        box.remove(); cb(b.dataset.l);
      });
    }

    /* ---------- input ---------- */
    root.addEventListener("click", function (e) {
      var pt = root.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
      var loc = pt.matrixTransform(root.getScreenCTM().inverse());
      if (busy) { if (deferred.length < 4) deferred.push(loc); return; }   // the board is still showing an older position
      handleTap(loc);
    });
    function handleTap(loc) {
      if (!cur || cur.status !== "active" || seat < 0) return;
      var c = Math.floor(loc.x / S), r = Math.floor(loc.y / S);
      if (cur.game === "chess") {
        if (c < 0 || c > 7 || r < 0 || r > 7) return;
        var rr = flip() ? r : 7 - r, cc = flip() ? 7 - c : c;
        chessTap(TTGeo.chessName(rr, cc));
      } else if (cur.game === "dam") {
        var n = cur.state.size;
        if (c < 0 || c >= n || r < 0 || r >= n) return;
        var r2 = flip() ? r : n - 1 - r, c2 = flip() ? n - 1 - c : c;
        damTap(r2 * n + c2);
      } else if (cur.game === "ludo") {
        var st = cur.state;
        if (st.turn !== seat || st.phase !== "move") return;
        var best = null, bd = 1e9;
        TTGeo.ludoLayout(st.tokens, st.colours).forEach(function (t) {
          if (t.seat !== seat || st.movable.indexOf(t.token) < 0) return;
          var d = Math.pow(t.c * S + 50 - loc.x, 2) + Math.pow(t.r * S + 50 - loc.y, 2);
          if (d < bd) { bd = d; best = t; }
        });
        if (best && bd < Math.pow(S * 1.2, 2)) act({ type: "move", token: best.token });
      } else if (plug()) {
        plug().tap(api, loc);
      } else if (cur.game === "words") {
        if (c < 0 || c > 14 || r < 0 || r > 14) return;
        wordsTap(r * 15 + c);
      }
    }

    function act(a) { if (opts.onAction) opts.onAction(a); }

    /* ---------- animations ---------- */
    function pieceAt(attr, v) { return gPieces.querySelector("[" + attr + '="' + v + '"]'); }

    function animateChess(events, st) {
      var chain = Promise.resolve();
      var cap = events.filter(function (e) { return e.type === "capture"; })[0];
      events.forEach(function (e) {
        if (e.type === "move") {
          chain = chain.then(function () {
            var g = pieceAt("data-sq", e.from); if (!g) return;
            gPieces.appendChild(g);
            var t = TTGeo.chessSq(e.to), xy = chessXY(t.r, t.c);
            if (cap) {
              var v = TTGeo.chessSq(cap.victim), vxy = chessXY(v.r, v.c);
              // stop just short, slash, then step in
              var ax = vxy[0] + (g.transform.baseVal.consolidate().matrix.e > vxy[0] ? 34 : -34);
              return slideTo(g, ax, vxy[1], 320, e.kind === "knight" ? 70 : 10)
                .then(function () { return sliceAway(root, gFx, pieceAt("data-sq", cap.victim), -0.7 + Math.random() * 0.4); })
                .then(function () { return slideTo(g, xy[0], xy[1], 200, 0); });
            }
            return slideTo(g, xy[0], xy[1], 380, e.kind === "knight" ? 80 : 18);
          });
        } else if (e.type === "castle") {
          chain = chain.then(function () {
            var g = pieceAt("data-sq", e.from); if (!g) return;
            var t = TTGeo.chessSq(e.to), xy = chessXY(t.r, t.c);
            return slideTo(g, xy[0], xy[1], 300, 40);
          });
        } else if (e.type === "promote") {
          chain = chain.then(function () {
            var t = TTGeo.chessSq(e.at), xy = chessXY(t.r, t.c);
            TT.sfx("crown");
            return burst(gFx, xy[0], xy[1], "#facc15", "★");
          });
        } else if (e.type === "check") {
          chain = chain.then(function () { TT.sfx("check"); });
        }
      });
      return chain;
    }
    function animateDam(events, st) {
      var chain = Promise.resolve();
      var n = st.size;
      events.forEach(function (e) {
        if (e.type === "move" || e.type === "jump") {
          chain = chain.then(function () {
            var g = pieceAt("data-i", e.path[0]); if (!g) return;
            gPieces.appendChild(g);
            var c2 = Promise.resolve();
            e.path.slice(1).forEach(function (sq, k) {
              c2 = c2.then(function () {
                var xy = damXY(sq, n);
                return slideTo(g, xy[0], xy[1], e.type === "jump" ? 300 : 360, e.type === "jump" ? 60 : 12);
              });
              if (e.type === "jump") {
                c2 = c2.then(function () { return sliceAway(root, gFx, pieceAt("data-i", e.victims[k]), k % 2 ? 0.7 : -0.7); });
              }
            });
            return c2;
          });
        } else if (e.type === "promote") {
          chain = chain.then(function () { TT.sfx("crown"); var xy = damXY(e.at, n); return burst(gFx, xy[0], xy[1], "#facc15", "DAM!"); });
        }
      });
      return chain;
    }
    function animateLudo(events, st, prev) {
      var chain = Promise.resolve();
      events.forEach(function (e) {
        if (e.type === "roll") chain = chain.then(function () { TT.sfx("dice"); return wait(250); });
        if (e.type === "move") {
          chain = chain.then(function () {
            var g = pieceAt("data-t", e.seat + ":" + e.token); if (!g) return;
            gPieces.appendChild(g);
            var c2 = Promise.resolve();
            e.path.forEach(function (rel) {
              c2 = c2.then(function () {
                var rc = TTGeo.ludoCell(e.colour, rel, e.token);
                return slideTo(g, rc[1] * S, rc[0] * S - 8, 150, 30);
              });
            });
            return c2;
          });
        }
        if (e.type === "capture") {
          chain = chain.then(function () {
            var all = Promise.resolve();
            e.victims.forEach(function (v) {
              all = all.then(function () { return sliceAway(root, gFx, pieceAt("data-t", v.seat + ":" + v.token), -0.6); });
            });
            return all;
          });
        }
        if (e.type === "home") {
          chain = chain.then(function () { TT.sfx("crown"); return burst(gFx, 650, 650, TT.LUDO_COLORS[e.colour], "HOME!"); });
        }
      });
      return chain;
    }
    function animateWords(events) {
      var chain = Promise.resolve();
      events.forEach(function (e) {
        if (e.type !== "place") return;
        chain = chain.then(function () {
          var gs = e.tiles.map(function (t, k) {
            var g = tile(gFx, t.l, t.r * 15 + t.c, "", cur.state.values);
            g.style.opacity = "0";
            return { g: g, t: t, k: k };
          });
          return Promise.all(gs.map(function (o) {
            return wait(o.k * 90).then(function () {
              TT.sfx("tile");
              return tween(380, function (k) {
                var y = o.t.r * S - (1 - ease(k)) * 300;
                o.g.style.opacity = String(Math.min(1, k * 3));
                o.g.setAttribute("transform", "translate(" + o.t.c * S + "," + y + ") rotate(" + (1 - k) * 30 + " 50 50)");
              });
            });
          })).then(function () {
            TT.sfx("score");
            var last = e.tiles[e.tiles.length - 1];
            return burst(gFx, last.c * S, last.r * S, "#facc15", "+" + e.score + (e.bingo ? " BINGO" : ""));
          }).then(function () { gs.forEach(function (o) { o.g.remove(); }); });
        });
      });
      return chain;
    }

    function draw() {
      if (!cur) return;
      var st = cur.state;
      if (cur.game === "chess") drawChess(st);
      else if (cur.game === "dam") drawDam(st);
      else if (cur.game === "ludo") drawLudo(st);
      else if (plug()) plug().draw(api, st);
      else drawWords(st);
    }

    function render(match, o) {
      o = o || {};
      busy = true;
      pendingRenders++;
      queue = queue.then(function () {
        var changedMatch = !cur || cur.id !== match.id;
        var events = (!changedMatch && o.animate) || [];
        var prev = cur;
        seat = o.seat != null ? o.seat : -1;
        if (o.priv) priv = o.priv;
        if (changedMatch) { sel = null; damSel = null; words.placed = []; wordsSel = null; gBoard.innerHTML = ""; delete gBoard.dataset.kind; }
        if (!cur || changedMatch) { cur = match; draw(); settle(); return; }
        var anim = Promise.resolve();
        if (events.length && !document.hidden) {
          if (match.game === "chess") anim = animateChess(events, match.state);
          else if (match.game === "dam") anim = animateDam(events, prev.state);
          else if (match.game === "ludo") anim = animateLudo(events, match.state, prev.state);
          else if (PLUGINS[match.game]) anim = PLUGINS[match.game].animate(api, events, match.state, prev.state) || Promise.resolve();
          else anim = animateWords(events);
        }
        return anim.catch(function () { /* never block the board */ }).then(function () {
          cur = match;
          if (match.version !== prev.version) {
            // keep a selection only if it is still a legal start in the new position
            if (sel && !(match.state.legal || []).some(function (m) { return m.slice(0, 2) === sel; })) sel = null;
            damSel = null;
            if (match.game === "words" && events.length) words.placed = [];
          }
          draw();
          settle();
        });
      });
      return queue;
    }
    var pendingRenders = 0;
    function settle() {
      pendingRenders = Math.max(0, pendingRenders - 1);
      if (pendingRenders > 0) return;
      busy = false;
      var taps = deferred; deferred = []; taps.forEach(handleTap);
    }

    // what game plugins (tt_games_more.js) get to work with
    var api = {
      S: S, svg: svg, root: root, defs: defs, gBoard: gBoard, gMarks: gMarks, gPieces: gPieces, gFx: gFx,
      setViewBox: setViewBox, act: act, seat: function () { return seat; }, cur: function () { return cur; },
      tween: tween, wait: wait, ease: ease, slideTo: slideTo, sliceAway: sliceAway, burst: burst,
      ludoPawn: ludoPawn, eyes: eyes, flip: flip, container: container,
    };

    return {
      render: render,
      words: {
        placed: function () { return words.placed; },
        select: function (i) { wordsSel = i; },
        selected: function () { return wordsSel; },
        clear: function () { words.placed = []; wordsSel = null; if (cur) draw(); },
      },
      setPriv: function (p) { priv = p; },
      redraw: draw,
    };
  }

  var PLUGINS = window.TTBoardPlugins = window.TTBoardPlugins || {};
  return { create: create, CHESS_ART: CHESS_ART, plugins: PLUGINS };
})();
