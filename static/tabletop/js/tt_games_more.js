/* ============================================================================
   tt_games_more.js — Oware, Four in a Row, Snakes & Ladders, Dragon's Hoard
   ----------------------------------------------------------------------------
   Each game plugs into three registries:
     window.TTBoardPlugins[game]  phone SVG board   {draw, tap, animate, flip}
     window.TTStagePlugins[game]  projector 3D scene {build, sync, play, spots, color, camera}
     TT.phoneUI[game]             phone controls / labels {seat, banner, controls, head}

   3D models come from static/tabletop/models/kk_world.glb (built in Blender by
   tools/blender/build_tabletop_assets.py) and recoloured here by material name.
   ========================================================================== */
(function () {
  "use strict";
  var BOARD = window.TTBoardPlugins = window.TTBoardPlugins || {};
  var STAGE = window.TTStagePlugins = window.TTStagePlugins || {};
  var UI = TT.phoneUI = TT.phoneUI || {};
  var esc = TT.esc;
  var SEAT_COLORS = ["#ef4444", "#facc15", "#22c55e", "#3b82f6"];

  function rollButton(x, seat, canAct, h, label) {
    if (!canAct) return "";
    var mine = x.state.turn === seat;
    return '<button type="button" class="tt-roll' + (mine ? " is-ready" : "") + '"' + (mine ? "" : " disabled") +
      " data-act='{\"type\":\"roll\"}'>" + h.dieFace(x.state.last && x.state.last.roll) +
      "<span>" + (mine ? (label || "Roll") : "Wait") + "</span></button>";
  }

  /* ═══════════════════════════════ OWARE ═══════════════════════════════ */
  // Phone layout: 1400 x 1000 units. Unflipped: seat 0's pits 0-5 along the
  // bottom row left->right, seat 1's 6-11 along the top row right->left.
  function owarePit(i, flip) {
    var x = i < 6 ? 200 + i * 200 : 200 + (11 - i) * 200, y = i < 6 ? 640 : 360;
    return flip ? [1400 - x, 1000 - y] : [x, y];
  }
  function owareStore(seat, flip) {
    var x = seat === 0 ? 1320 : 80;
    return flip ? [1400 - x, 500] : [x, 500];
  }
  function seedXY(k, n) {           // deterministic little heap inside a pit
    var a = k * 2.399, r = Math.min(62, 10 + 9 * Math.sqrt(k));
    return [Math.cos(a) * r, Math.sin(a) * r * 0.8];
  }
  function drawSeeds(api, g, cx, cy, n, big) {
    var shown = Math.min(n, big ? 48 : 22);
    for (var k = 0; k < shown; k++) {
      var p = seedXY(k, n);
      api.svg("ellipse", { cx: cx + p[0] * (big ? 0.9 : 1), cy: cy + p[1] * (big ? 2.2 : 1), rx: 13, ry: 10,
        fill: ["#f4d58d", "#e8b04b", "#d79a3a", "#fbe7b0"][k % 4], stroke: "#7a4a1a", "stroke-width": 2,
        transform: "rotate(" + (k * 47 % 180) + " " + (cx + p[0]) + " " + (cy + p[1]) + ")" }, g);
    }
    var t = api.svg("text", { x: cx, y: cy + (big ? 190 : 108), "text-anchor": "middle", "font-size": 44, "font-weight": 900,
      fill: "#fde68a", stroke: "#3b2410", "stroke-width": 3, "paint-order": "stroke" }, g);
    t.textContent = n;
  }
  BOARD.oware = {
    flip: function (seat) { return seat === 1; },
    draw: function (api, st, disp) {
      var flip = api.flip(), seat = api.seat();
      api.root.setAttribute("viewBox", "0 160 1400 680");
      api.gBoard.innerHTML = ""; api.gPieces.innerHTML = ""; api.gMarks.innerHTML = "";
      api.svg("rect", { x: 20, y: 180, width: 1360, height: 640, rx: 120, fill: "#7c4a21", stroke: "#3b2410", "stroke-width": 10 }, api.gBoard);
      api.svg("rect", { x: 40, y: 200, width: 1320, height: 600, rx: 100, fill: "none", stroke: "#a86b33", "stroke-width": 6, "stroke-dasharray": "4 18" }, api.gBoard);
      var pits = disp || st.pits;
      for (var i = 0; i < 12; i++) {
        var p = owarePit(i, flip);
        api.svg("ellipse", { cx: p[0], cy: p[1], rx: 86, ry: 78, fill: "#4a2a10", stroke: "#2b1708", "stroke-width": 5 }, api.gBoard);
        var g = api.svg("g", { "data-pit": i }, api.gPieces);
        drawSeeds(api, g, p[0], p[1], pits[i]);
        if (seat >= 0 && st.turn === seat && (st.legal || []).indexOf(i) >= 0) {
          api.svg("ellipse", { cx: p[0], cy: p[1], rx: 92, ry: 84, fill: "none", stroke: "#22d3ee", "stroke-width": 7, class: "tt-ping" }, api.gMarks);
        }
      }
      [0, 1].forEach(function (s) {
        var q = owareStore(s, flip);
        api.svg("ellipse", { cx: q[0], cy: q[1], rx: 60, ry: 200, fill: "#4a2a10", stroke: "#2b1708", "stroke-width": 5 }, api.gBoard);
        drawSeeds(api, api.gPieces, q[0], q[1] - 40, st.store[s], true);
      });
      if (st.last) (st.last.taken || []).forEach(function (i) {
        var p = owarePit(i, flip);
        api.svg("ellipse", { cx: p[0], cy: p[1], rx: 90, ry: 82, fill: "rgba(250,204,21,.18)" }, api.gMarks);
      });
    },
    tap: function (api, loc) {
      var st = api.cur().state, seat = api.seat();
      if (st.turn !== seat) return;
      var best = -1, bd = 1e9;
      (st.legal || []).forEach(function (i) {
        var p = owarePit(i, api.flip()), d = Math.pow(p[0] - loc.x, 2) + Math.pow(p[1] - loc.y, 2);
        if (d < bd) { bd = d; best = i; }
      });
      if (best >= 0 && bd < 130 * 130) api.act({ type: "move", pit: best });
    },
    animate: function (api, events, st, prev) {
      var disp = prev.pits.slice(), flip = api.flip(), self = this;
      var chain = Promise.resolve();
      events.forEach(function (e) {
        if (e.type === "sow") chain = chain.then(function () {
          var origin = owarePit(e.from, flip);
          disp[e.from] = 0;
          self.draw(api, prev, disp);
          var c2 = Promise.resolve(), last = origin;
          e.path.forEach(function (pit) {
            c2 = c2.then(function () {
              var to = owarePit(pit, flip), from = last;
              last = to;
              var seed = api.svg("ellipse", { rx: 15, ry: 11, fill: "#fde68a", stroke: "#7a4a1a", "stroke-width": 2 }, api.gFx);
              TT.sfx("tile");
              return api.tween(150, function (k) {
                seed.setAttribute("cx", from[0] + (to[0] - from[0]) * k);
                seed.setAttribute("cy", from[1] + (to[1] - from[1]) * k - Math.sin(k * Math.PI) * 90);
              }).then(function () { seed.remove(); disp[pit]++; self.draw(api, prev, disp); });
            });
          });
          return c2;
        });
        if (e.type === "capture") chain = chain.then(function () {
          var store = owareStore(e.seat, flip);
          TT.sfx("score");
          return Promise.all(e.pits.map(function (pit) {
            var p = owarePit(pit, flip);
            var g = api.svg("g", {}, api.gFx);
            drawSeeds(api, g, 0, 0, disp[pit]);
            disp[pit] = 0;
            return api.tween(600, function (k) {
              var ek = api.ease(k);
              g.setAttribute("transform", "translate(" + (p[0] + (store[0] - p[0]) * ek) + "," + (p[1] + (store[1] - p[1]) * ek - Math.sin(k * Math.PI) * 160) + ") scale(" + (1 - k * 0.4) + ")");
            }).then(function () { g.remove(); });
          })).then(function () { return api.burst(api.gFx, store[0] - 50, store[1] - 50, "#facc15", "+" + e.count); });
        });
        if (e.type === "grandslam") chain = chain.then(function () { return api.burst(api.gFx, 650, 450, "#94a3b8", "GRAND SLAM — no capture"); });
      });
      return chain;
    },
  };
  UI.oware = {
    seat: function (x, i) { return "🌰 <b>" + x.state.store[i] + "</b> captured"; },
    head: function (x, i) { return " <b>" + x.state.store[i] + "</b>"; },
    banner: function (x) { return "Your turn — tap one of your glowing pits"; },
  };

  /* ═══════════════════════════ FOUR IN A ROW ═══════════════════════════ */
  var FC = 7, FR = 6;
  function fourXY(r, c) { return [70 + c * 123, 70 + (FR - 1 - r) * 123 + 140]; }
  BOARD.four = {
    draw: function (api, st) {
      api.root.setAttribute("viewBox", "0 0 1000 1000");
      api.gBoard.innerHTML = ""; api.gPieces.innerHTML = ""; api.gMarks.innerHTML = "";
      var seat = api.seat(), mine = seat >= 0 && st.turn === seat && !st.over;
      for (var c = 0; c < FC; c++) {
        if (mine && st.grid[FR - 1][c] === -1) {
          var top = fourXY(FR - 1, c);
          api.svg("path", { d: "M" + (top[0] + 30) + " 40 l32 50 l32 -50 z", fill: SEAT_COLORS[seat === 0 ? 0 : 1], class: "tt-hint" }, api.gMarks);
        }
      }
      for (var r = 0; r < FR; r++) for (var c2 = 0; c2 < FC; c2++) {
        var v = st.grid[r][c2], p = fourXY(r, c2);
        if (v >= 0) coin(api, api.gPieces, p[0], p[1], v).setAttribute("data-rc", r + ":" + c2);
      }
      // frame drawn over the coins with holes punched by a mask
      var id = "fm" + Math.random().toString(36).slice(2, 7);
      var mask = api.svg("mask", { id: id }, api.defs);
      api.svg("rect", { x: 30, y: 170, width: 940, height: 790, fill: "#fff" }, mask);
      for (r = 0; r < FR; r++) for (c2 = 0; c2 < FC; c2++) {
        var q = fourXY(r, c2);
        api.svg("circle", { cx: q[0] + 61, cy: q[1] + 61, r: 50, fill: "#000" }, mask);
      }
      api.svg("rect", { x: 30, y: 170, width: 940, height: 790, rx: 40, fill: "#1d4ed8", stroke: "#1e3a8a", "stroke-width": 10, mask: "url(#" + id + ")" }, api.gMarks);
      if (st.line) st.line.forEach(function (rc) {
        var q = fourXY(rc[0], rc[1]);
        api.svg("circle", { cx: q[0] + 61, cy: q[1] + 61, r: 54, fill: "none", stroke: "#fff", "stroke-width": 8, class: "tt-ping" }, api.gMarks);
      });
    },
    tap: function (api, loc) {
      var st = api.cur().state;
      if (st.turn !== api.seat()) return;
      var c = Math.floor((loc.x - 70) / 123);
      if (c >= 0 && c < FC) api.act({ type: "move", col: c });
    },
    animate: function (api, events) {
      var chain = Promise.resolve();
      events.forEach(function (e) {
        if (e.type !== "drop") return;
        chain = chain.then(function () {
          var p = fourXY(e.row, e.col);
          var g = coin(api, api.gPieces, p[0], 0, e.seat);
          TT.sfx("move");
          return api.tween(420, function (k) {
            var y = k < 0.75 ? (k / 0.75) * (k / 0.75) * p[1] : p[1] - Math.sin((k - 0.75) / 0.25 * Math.PI) * 40;
            g.setAttribute("transform", "translate(" + p[0] + "," + y + ")");
          }).then(function () { TT.sfx("land"); });
        });
      });
      return chain;
    },
  };
  function coin(api, layer, x, y, seat) {
    var g = api.svg("g", { transform: "translate(" + x + "," + y + ")" }, layer);
    var col = seat === 0 ? "#ef4444" : "#facc15";
    api.svg("circle", { cx: 61, cy: 61, r: 52, fill: col, stroke: "rgba(0,0,0,.35)", "stroke-width": 6 }, g);
    api.svg("circle", { cx: 61, cy: 61, r: 34, fill: "none", stroke: "rgba(255,255,255,.45)", "stroke-width": 6 }, g);
    api.eyes(g, 58, 61, false);
    return g;
  }
  UI.four = {
    seat: function (x, i) { return '<i class="tt-dot" style="background:' + (i === 0 ? "#ef4444" : "#facc15") + '"></i>' + (i === 0 ? "Red" : "Yellow"); },
    banner: function () { return "Your turn — tap a column to drop a disc"; },
  };

  /* ═══════════════════════════════ 3D: OWARE ═══════════════════════════════ */
  if (!window.THREE) return finishPhoneOnly();
  var T = window.THREE;
  var OS = 2.6;   // board scale
  function owarePos3(i) {
    var c = i < 6 ? i : 11 - i, z = i < 6 ? 0.28 : -0.28;
    return new T.Vector3((-1.1 + 0.44 * c) * OS, 0.17 * OS, z * OS);
  }
  function owareStore3(seat) { return new T.Vector3((seat === 0 ? 1.5 : -1.5) * OS, 0.17 * OS, 0); }
  function seedOffset(k) { var a = k * 2.399, r = Math.min(0.45, 0.05 + 0.07 * Math.sqrt(k)); return [Math.cos(a) * r, Math.floor(k / 9) * 0.07, Math.sin(a) * r]; }

  STAGE.oware = {
    camera: function () { return [0, 11.5, 12, 0, 0, 0.4]; },
    spots: function () { return [[-5.9, 2.4], [5.9, -1.6]]; },
    color: function (s) { return s === 0 ? "#fde68a" : "#fb923c"; },
    build: function (ctx, match) {
      var b = ctx.cloneNamed("oware_board", { wood: ctx.smat("owood", "#8a5a2b", { r: 0.55 }) });
      if (b) { b.scale.setScalar(OS); ctx.boardG.add(b); }
      var cloth = new T.Mesh(new T.CircleGeometry(7, 48), ctx.smat("kente", "#14532d", { r: 0.9 }));
      cloth.rotation.x = -Math.PI / 2; cloth.position.y = -0.02; cloth.receiveShadow = true; ctx.boardG.add(cloth);
      this.seedMats = ["#f4d58d", "#e8b04b", "#d79a3a", "#fbe7b0"].map(function (c, i) { return ctx.smat("seed" + i, c, { r: 0.35 }); });
    },
    seed: function (ctx, k) {
      var s = ctx.cloneNamed("oware_seed", { belly: this.seedMats[k % 4] }) || new T.Mesh(new T.SphereGeometry(0.1, 8, 6), this.seedMats[k % 4]);
      s.scale.setScalar(OS * 0.85); s.rotation.set(0, k * 1.7, (k % 3) * 0.3);
      return s;
    },
    fill: function (ctx, holder, n, wide) {
      for (var k = 0; k < Math.min(n, 40); k++) {
        var o = seedOffset(k), s = this.seed(ctx, k);
        s.position.set(o[0] * (wide ? 0.7 : 1), o[1], o[2] * (wide ? 2.2 : 1));
        holder.add(s);
      }
    },
    sync: function (ctx, match) {
      var st = match.state, self = this;
      st.pits.forEach(function (n, i) {
        var g = new T.Group(); g.position.copy(owarePos3(i)); self.fill(ctx, g, n);
        g.userData = { kind: "tile", body: g, phase: i };
        ctx.piecesG.add(g); ctx.setPiece("pit" + i, g);
      });
      [0, 1].forEach(function (s) {
        var g = new T.Group(); g.position.copy(owareStore3(s)); self.fill(ctx, g, st.store[s], true);
        g.userData = { kind: "tile", body: g };
        ctx.piecesG.add(g); ctx.setPiece("store" + s, g);
      });
    },
    play: function (ctx, events, match, prev) {
      var chain = Promise.resolve(), self = this;
      var counts = prev.state.pits.slice();
      events.forEach(function (e) {
        if (e.type === "sow") chain = chain.then(function () {
          ctx.heroPlay(e.seat, "think");
          var src = ctx.pieces()["pit" + e.from];
          var n = counts[e.from];
          // the handful lifts out of the pit
          if (src) ctx.clearGroup(src);
          counts[e.from] = 0;
          var orb = new T.Mesh(new T.SphereGeometry(0.22, 16, 12), ctx.smat("sowglow", "#fde68a", { e: "#f59e0b", ei: 1.4 }));
          orb.position.copy(owarePos3(e.from)).setY(1.4); ctx.fxG.add(orb);
          var c2 = Promise.resolve();
          e.path.forEach(function (pit, idx) {
            c2 = c2.then(function () {
              var from = orb.position.clone(), to = owarePos3(pit).setY(1.3);
              return ctx.anim(170, function (k) {
                orb.position.lerpVectors(from, to, ctx.ease(k)); orb.position.y += Math.sin(k * Math.PI) * 0.6;
              }).then(function () {
                var g = ctx.pieces()["pit" + pit];
                var s = self.seed(ctx, counts[pit]);
                var o = seedOffset(counts[pit]);
                counts[pit]++;
                if (!g) return;
                g.add(s);
                s.position.set(o[0], o[1] + 1.2, o[2]);
                TT.sfx("tile");
                return ctx.anim(160, function (k) { s.position.y = o[1] + 1.2 * (1 - k * k); });
              });
            });
          });
          return c2.then(function () { ctx.fxG.remove(orb); });
        });
        else if (e.type === "capture") chain = chain.then(function () {
          ctx.heroPlay(e.seat, "cheer"); ctx.heroPlay(1 - e.seat, "hurt");
          var store = owareStore3(e.seat);
          TT.sfx("score");
          return Promise.all(e.pits.map(function (pit, i) {
            var g = ctx.pieces()["pit" + pit]; if (!g) return null;
            var from = g.position.clone();
            return ctx.delay(i * 120).then(function () {
              ctx.sparks(new T.Vector3(from.x, 1, from.z), "#fde68a", 30);
              return ctx.anim(650, function (k) {
                g.position.lerpVectors(from, store, ctx.ease(k)); g.position.y = from.y + Math.sin(k * Math.PI) * 2.5;
                g.rotation.y = k * 6;
              });
            });
          })).then(function () { return ctx.floatText("+" + e.count + " SEEDS", store.clone().setY(2.2), "#facc15"); });
        });
        else if (e.type === "grandslam") chain = chain.then(function () { return ctx.floatText("GRAND SLAM — NO CAPTURE", new T.Vector3(0, 2.6, 0), "#94a3b8"); });
      });
      return chain;
    },
  };

  /* ═══════════════════════════ 3D: FOUR IN A ROW ═══════════════════════════ */
  var FS = 1.45;
  function fourPos3(r, c) { return new T.Vector3((-1.5 + 0.5 * c) * FS, (0.35 + 0.5 * r) * FS, 0); }
  STAGE.four = {
    camera: function () { return [0, 5.6, 13.5, 0, 2.2, 0]; },
    spots: function () { return [[-4.9, 1.9], [4.9, 1.9]]; },
    color: function (s) { return s === 0 ? "#ef4444" : "#facc15"; },
    build: function (ctx) {
      var f = ctx.cloneNamed("four_frame", { body: ctx.smat("fourblue", "#1d4ed8", { r: 0.3, m: 0.1 }) });
      if (f) { f.scale.setScalar(FS); ctx.boardG.add(f); }
      var stand = new T.Mesh(new T.CylinderGeometry(4, 4.4, 0.3, 48), ctx.smat("fourstand", "#0f172a", { r: 0.5 }));
      stand.position.y = -0.45; stand.receiveShadow = true; ctx.boardG.add(stand);
      this.mats = [ctx.smat("fred", "#ef4444", { r: 0.3 }), ctx.smat("fyel", "#facc15", { r: 0.3 })];
    },
    coin: function (ctx, seat) {
      var c = ctx.cloneNamed("four_coin", { body: this.mats[seat], accent: ctx.smat("fcr", "#ffffff", { r: 0.3 }) }) ||
        new T.Mesh(new T.CylinderGeometry(0.19, 0.19, 0.12, 24), this.mats[seat]);
      c.scale.setScalar(FS);
      var g = new T.Group(); g.add(c);
      ctx.addEyes(g, 0.02 * FS, 0.12, 0.08, false);
      g.userData.eyesHolder = true;
      return g;
    },
    sync: function (ctx, match) {
      var st = match.state, self = this;
      for (var r = 0; r < FR; r++) for (var c = 0; c < FC; c++) {
        var v = st.grid[r][c]; if (v < 0) continue;
        var g = self.coin(ctx, v); g.position.copy(fourPos3(r, c));
        g.userData = { kind: "coin", body: g.children[0], phase: r * 7 + c, eyes: g.userData.eyes };
        ctx.piecesG.add(g); ctx.setPiece(r + ":" + c, g);
      }
      if (st.line) self.glowLine(ctx, st.line);
    },
    glowLine: function (ctx, cells) {
      cells.forEach(function (rc, i) {
        var p = fourPos3(rc[0], rc[1]);
        var halo = new T.Mesh(new T.RingGeometry(0.3, 0.42, 32), new T.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, side: T.DoubleSide }));
        halo.position.set(p.x, p.y, 0.3); ctx.boardG.add(halo);
        ctx.onTick(function (dt, t) { halo.material.opacity = 0.5 + 0.5 * Math.sin(t * 6 + i); halo.scale.setScalar(1 + 0.1 * Math.sin(t * 6 + i)); });
      });
    },
    play: function (ctx, events, match) {
      var chain = Promise.resolve(), self = this;
      events.forEach(function (e) {
        if (e.type === "drop") chain = chain.then(function () {
          ctx.heroPlay(e.seat, "attack");
          var g = self.coin(ctx, e.seat);
          var to = fourPos3(e.row, e.col), from = to.clone().setY(FS * 3.7);
          g.position.copy(from); ctx.piecesG.add(g);
          TT.sfx("move");
          return ctx.anim(560, function (k) {
            var y = k < 0.72 ? from.y + (to.y - from.y) * Math.pow(k / 0.72, 2) : to.y + Math.sin((k - 0.72) / 0.28 * Math.PI) * 0.35;
            g.position.y = y; g.rotation.z = (1 - k) * 4;
          }).then(function () { TT.sfx("land"); ctx.shake(0.12); });
        });
        else if (e.type === "line") chain = chain.then(function () {
          self.glowLine(ctx, e.cells);
          var mid = fourPos3(e.cells[1][0], e.cells[1][1]);
          ctx.sparks(mid.clone().setZ(0.5), "#ffffff", 120);
          return ctx.floatText("FOUR IN A ROW!", new T.Vector3(0, 5.6, 0.5), e.seat === 0 ? "#ef4444" : "#facc15", true);
        });
      });
      return chain;
    },
  };

  /* Snakes & Ladders and Dragon's Hoard live in tt_games_quest.js */
  function finishPhoneOnly() { /* phones without three.js still get boards + controls */ }
  window.__ttMoreReady = true;
})();
