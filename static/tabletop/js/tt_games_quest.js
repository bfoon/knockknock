/* ============================================================================
   tt_games_quest.js — Snakes & Ladders and Dragon's Hoard
   ----------------------------------------------------------------------------
   Same plugin registries as tt_games_more.js. On the projector, every token is
   the player's own Hero Forge character: heroes climb ladders, get swallowed
   by slithering snakes (and pop out of the tail), walk the island path, open
   chests, step on spike traps, dive through portals and duel monsters — which
   are cut in half when slain. The dragon breathes fire.
   ========================================================================== */
(function () {
  "use strict";
  var BOARD = window.TTBoardPlugins = window.TTBoardPlugins || {};
  var STAGE = window.TTStagePlugins = window.TTStagePlugins || {};
  var UI = TT.phoneUI = TT.phoneUI || {};
  var esc = TT.esc;
  var SEAT = ["#ef4444", "#22c55e", "#facc15", "#3b82f6"];   // = TT.LUDO_COLORS order

  function rollButton(x, seat, canAct, h, label, act) {
    if (!canAct) return "";
    var mine = x.state.turn === seat;
    var a = JSON.stringify(act || { type: "roll" }).replace(/'/g, "&#39;");
    return '<button type="button" class="tt-roll' + (mine ? " is-ready" : "") + '"' + (mine ? "" : " disabled") +
      " data-act='" + a + "'>" + h.dieFace(x.state.last && x.state.last.roll) + "<span>" + (mine ? (label || "Roll") : "Wait") + "</span></button>";
  }

  /* ═══════════════════════════ SNAKES & LADDERS (phone) ═══════════════════════════ */
  function snCell(n, seat) {
    if (n <= 0) return [90 + (seat || 0) * 120, 1050];
    var r = Math.floor((n - 1) / 10), c = r % 2 === 0 ? (n - 1) % 10 : 9 - (n - 1) % 10;
    return [c * 100 + 50, 1000 - r * 100 - 50];
  }
  function snakePath(head, tail) {
    var a = snCell(head), b = snCell(tail);
    var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
    var nx = -dy / len, ny = dx / len, w = Math.min(90, len * 0.3);
    return "M" + a[0] + " " + a[1] + " C" + (a[0] + dx * 0.33 + nx * w) + " " + (a[1] + dy * 0.33 + ny * w) + " " +
      (a[0] + dx * 0.66 - nx * w) + " " + (a[1] + dy * 0.66 - ny * w) + " " + b[0] + " " + b[1];
  }
  var SNAKE_COLS = ["#16a34a", "#9333ea", "#ea580c", "#0891b2", "#be123c", "#65a30d", "#c026d3", "#0d9488"];

  BOARD.snakes = {
    draw: function (api, st) {
      var svg = api.svg;
      api.root.setAttribute("viewBox", "0 0 1000 1110");
      api.gBoard.innerHTML = ""; api.gPieces.innerHTML = ""; api.gMarks.innerHTML = "";
      var pal = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#ddd6fe"];
      for (var n = 1; n <= 100; n++) {
        var p = snCell(n);
        svg("rect", { x: p[0] - 50, y: p[1] - 50, width: 100, height: 100, fill: pal[(n * 7) % 5], stroke: "#fff", "stroke-width": 3 }, api.gBoard);
        var t = svg("text", { x: p[0] - 42, y: p[1] - 24, "font-size": 24, "font-weight": 800, fill: "#475569" }, api.gBoard);
        t.textContent = n;
      }
      var goal = snCell(100);
      svg("text", { x: goal[0], y: goal[1] + 22, "text-anchor": "middle", "font-size": 56 }, api.gBoard).textContent = "🏆";
      svg("rect", { x: 0, y: 1004, width: 1000, height: 100, rx: 20, fill: "#334155" }, api.gBoard);
      svg("text", { x: 980, y: 1065, "text-anchor": "end", "font-size": 30, fill: "#cbd5e1", "font-weight": 700 }, api.gBoard).textContent = "START";
      Object.keys(st.ladders).forEach(function (f) {
        var a = snCell(+f), b = snCell(st.ladders[f]);
        var dx = b[0] - a[0], dy = b[1] - a[1], len = Math.sqrt(dx * dx + dy * dy), nx = -dy / len * 20, ny = dx / len * 20;
        [-1, 1].forEach(function (s) {
          svg("line", { x1: a[0] + nx * s, y1: a[1] + ny * s, x2: b[0] + nx * s, y2: b[1] + ny * s, stroke: "#92400e", "stroke-width": 10, "stroke-linecap": "round" }, api.gBoard);
        });
        for (var k = 1; k < len / 40; k++) {
          var q = k * 40 / len;
          svg("line", { x1: a[0] + dx * q - nx, y1: a[1] + dy * q - ny, x2: a[0] + dx * q + nx, y2: a[1] + dy * q + ny, stroke: "#b45309", "stroke-width": 7 }, api.gBoard);
        }
      });
      Object.keys(st.snakes).forEach(function (h, i) {
        var d = snakePath(+h, st.snakes[h]), col = SNAKE_COLS[i % SNAKE_COLS.length];
        svg("path", { d: d, fill: "none", stroke: "#0008", "stroke-width": 34, "stroke-linecap": "round" }, api.gBoard);
        svg("path", { d: d, fill: "none", stroke: col, "stroke-width": 28, "stroke-linecap": "round", "data-snake": h }, api.gBoard);
        svg("path", { d: d, fill: "none", stroke: "#fff6", "stroke-width": 6, "stroke-dasharray": "14 22", "stroke-linecap": "round", class: "tt-slither" }, api.gBoard);
        var a = snCell(+h);
        svg("ellipse", { cx: a[0], cy: a[1], rx: 30, ry: 24, fill: col, stroke: "#0006", "stroke-width": 4 }, api.gBoard);
        [-10, 10].forEach(function (dx) {
          svg("circle", { cx: a[0] + dx, cy: a[1] - 6, r: 7, fill: "#fff" }, api.gBoard);
          svg("circle", { cx: a[0] + dx, cy: a[1] - 6, r: 3.5, fill: "#111" }, api.gBoard);
        });
        svg("path", { d: "M" + a[0] + " " + (a[1] + 20) + " l0 18 l-7 8 M" + a[0] + " " + (a[1] + 38) + " l7 8", stroke: "#dc2626", "stroke-width": 4, fill: "none", class: "tt-tongue" }, api.gBoard);
      });
      st.pos.forEach(function (n, s) {
        var p = snCell(n, s), off = n > 0 ? [[-18, -14], [18, -14], [-18, 14], [18, 14]][s] : [0, 0];
        var g = api.ludoPawn(api.gPieces, s, p[0] - 50 + off[0], p[1] - 58 + off[1], 0.62);
        g.setAttribute("data-seat", s);
        if (st.turn === s && !st.over) g.classList.add("tt-glow");
      });
    },
    tap: function () { /* rolling is done with the Roll button */ },
    animate: function (api, events, st, prev) {
      var chain = Promise.resolve();
      events.forEach(function (e) {
        var pawn = function () { return api.gPieces.querySelector('[data-seat="' + e.seat + '"]'); };
        if (e.type === "roll") chain = chain.then(function () { TT.sfx("dice"); return api.wait(200); });
        if (e.type === "move") chain = chain.then(function () {
          var g = pawn(); if (!g) return;
          var c2 = Promise.resolve();
          e.path.forEach(function (n) {
            c2 = c2.then(function () { var p = snCell(n); return api.slideTo(g, p[0] - 50, p[1] - 58, 140, 34); });
          });
          return c2;
        });
        if (e.type === "ladder") chain = chain.then(function () {
          var g = pawn(), b = snCell(e.to); if (!g) return;
          TT.sfx("crown");
          return api.slideTo(g, b[0] - 50, b[1] - 58, 700, 0).then(function () { return api.burst(api.gFx, b[0] - 50, b[1] - 50, "#22c55e", "CLIMB!"); });
        });
        if (e.type === "snake") chain = chain.then(function () {
          var g = pawn(), path = api.gBoard.querySelector('[data-snake="' + e.from + '"]'); if (!g || !path) return;
          var L = path.getTotalLength();
          TT.sfx("bad");
          return api.tween(1100, function (k) {
            var pt = path.getPointAtLength(L * api.ease(k));
            g.setAttribute("transform", "translate(" + (pt.x - 50) + "," + (pt.y - 58) + ") scale(" + (0.55 + 0.45 * Math.abs(Math.cos(k * Math.PI))) + ")");
          }).then(function () { var b = snCell(e.to); g.setAttribute("transform", "translate(" + (b[0] - 50) + "," + (b[1] - 58) + ")"); return api.burst(api.gFx, b[0] - 50, b[1] - 50, "#dc2626", "SSSS!"); });
        });
      });
      return chain;
    },
  };
  UI.snakes = {
    seat: function (x, i) {
      return '<i class="tt-dot" style="background:' + SEAT[i] + '"></i>square <b>' + x.state.pos[i] + "</b>";
    },
    head: function (x, i) { return ' <i style="background:' + SEAT[i] + '"></i> ' + x.state.pos[i]; },
    banner: function () { return "Your turn — roll!"; },
    controls: function (x, seat, canAct, h) { return rollButton(x, seat, canAct, h); },
  };

  /* ═══════════════════════════ DRAGON'S HOARD (phone) ═══════════════════════════ */
  var ICON = { camp: "🔥", chest: "🧰", potion: "🧪", trap: "🗡️", portal: "🌀", path: "",
               slime: "🟢", bat: "🦇", goblin: "👺", skeleton: "💀", troll: "👹", dragon: "🐉" };
  function qCell(i) {
    var row = Math.floor(i / 7), col = row % 2 === 0 ? i % 7 : 6 - i % 7;
    return [col * 140 + 80, 1000 - row * 150 - 110];
  }
  BOARD.quest = {
    draw: function (api, st) {
      var svg = api.svg;
      api.root.setAttribute("viewBox", "0 0 1000 1000");
      api.gBoard.innerHTML = ""; api.gPieces.innerHTML = ""; api.gMarks.innerHTML = "";
      svg("rect", { x: 0, y: 0, width: 1000, height: 1000, fill: "#1e3a8a" }, api.gBoard);
      svg("rect", { x: 20, y: 20, width: 960, height: 960, rx: 140, fill: "#3f7d3a", stroke: "#e9d8a6", "stroke-width": 16 }, api.gBoard);
      var d = "";
      st.layout.forEach(function (k, i) { var p = qCell(i); d += (i ? " L" : "M") + p[0] + " " + p[1]; });
      svg("path", { d: d, fill: "none", stroke: "#e9d8a6", "stroke-width": 44, "stroke-linejoin": "round", "stroke-linecap": "round" }, api.gBoard);
      st.layout.forEach(function (k, i) {
        var p = qCell(i), mon = st.monsters[String(i)];
        var special = k !== "path";
        svg("circle", { cx: p[0], cy: p[1], r: 40, fill: k === "camp" ? "#f97316" : k === "dragon" ? "#7f1d1d" : special ? "#fef3c7" : "#d6c08a",
          stroke: "#6b4f2a", "stroke-width": 4, "data-tile": i }, api.gBoard);
        var icon = mon ? ICON[mon.kind] : (ICON[k] && !(k in { slime: 1, bat: 1, goblin: 1, skeleton: 1, troll: 1, dragon: 1 }) ? ICON[k] : (k !== "path" ? "✖" : ""));
        if (icon) svg("text", { x: p[0], y: p[1] + 16, "text-anchor": "middle", "font-size": 44, opacity: (!mon && icon === "✖") ? 0.35 : 1 }, api.gBoard).textContent = icon;
        if (mon && mon.max <= 5) for (var h = 0; h < mon.max; h++) {
          svg("rect", { x: p[0] - mon.max * 7 + h * 14, y: p[1] - 62, width: 11, height: 10, rx: 3, fill: h < mon.hp ? "#ef4444" : "#0005" }, api.gMarks);
        } else if (mon) {                       // big monsters (the dragon) get a health bar
          svg("rect", { x: p[0] - 48, y: p[1] - 64, width: 96, height: 12, rx: 6, fill: "#0006" }, api.gMarks);
          svg("rect", { x: p[0] - 48, y: p[1] - 64, width: 96 * mon.hp / mon.max, height: 12, rx: 6, fill: "#ef4444" }, api.gMarks);
        }
      });
      st.heroes.forEach(function (hero, s) {
        var p = qCell(hero.pos), off = [[-24, -22], [24, -22], [-24, 18], [24, 18]][s];
        var g = api.ludoPawn(api.gPieces, s, p[0] - 50 + off[0], p[1] - 66 + off[1], 0.85);
        g.setAttribute("data-seat", s);
        if (st.turn === s && !st.over) g.classList.add("tt-glow");
      });
    },
    tap: function () {},
    animate: function (api, events) {
      var chain = Promise.resolve();
      events.forEach(function (e) {
        var pawn = function () { return api.gPieces.querySelector('[data-seat="' + e.seat + '"]'); };
        if (e.type === "walk") chain = chain.then(function () {
          var g = pawn(); if (!g) return;
          var c2 = Promise.resolve();
          e.path.forEach(function (t) { c2 = c2.then(function () { var p = qCell(t); return api.slideTo(g, p[0] - 50, p[1] - 66, 170, 30); }); });
          return c2;
        });
        if (e.type === "fight") chain = chain.then(function () {
          var p = qCell(e.at), tile = api.gBoard.querySelector('[data-tile="' + e.at + '"]');
          var c2 = Promise.resolve();
          e.rounds.slice(0, 4).forEach(function (r) {
            c2 = c2.then(function () { TT.sfx(r.hit ? "slash" : "tap"); return api.burst(api.gFx, p[0] - 50, p[1] - 50, r.hit ? "#fde047" : "#94a3b8", r.hit ? "-" + r.dmg : "miss"); });
          });
          return c2.then(function () {
            if (e.result === "win") return api.burst(api.gFx, p[0] - 50, p[1] - 50, "#facc15", "+" + e.gold + "🪙");
            if (e.result === "ko") return api.burst(api.gFx, p[0] - 50, p[1] - 50, "#ef4444", "K.O.");
          });
        });
        if (e.type === "chest") chain = chain.then(function () { var p = qCell(e.at); TT.sfx("score"); return api.burst(api.gFx, p[0] - 50, p[1] - 50, "#facc15", e.loot.gold ? "+" + e.loot.gold + "🪙" : e.loot.item.toUpperCase() + "!"); });
        if (e.type === "trap") chain = chain.then(function () { var p = qCell(e.at); TT.sfx("bad"); return api.burst(api.gFx, p[0] - 50, p[1] - 50, "#ef4444", "-" + e.dmg + "❤"); });
        if (e.type === "portal") chain = chain.then(function () {
          var g = pawn(), p = qCell(e.to); if (!g) return;
          TT.sfx("crown");
          return api.slideTo(g, p[0] - 50, p[1] - 66, 500, 160);
        });
      });
      return chain;
    },
  };
  function hearts(h, max) {
    var out = "";
    for (var i = 0; i < max; i++) out += '<i class="tt-heart' + (i < h ? "" : " is-empty") + '"></i>';
    return out;
  }
  UI.quest = {
    seat: function (x, i) { var h = x.state.heroes[i]; return "❤️" + h.hp + " · 🪙<b>" + h.gold + "</b>"; },
    head: function (x, i) { var h = x.state.heroes[i]; return " ❤️" + h.hp + " 🪙<b>" + h.gold + "</b>"; },
    banner: function (x, seat) {
      var h = x.state.heroes[seat];
      return h.pos === x.state.layout.length - 1 ? "You face the DRAGON — attack!" : "Your turn — roll, rest or drink";
    },
    controls: function (x, seat, canAct, util) {
      var st = x.state, out = "";
      if (seat >= 0) {
        var h = st.heroes[seat];
        out += '<div class="tt-quest-card"><div class="tt-quest-hp">' + hearts(h.hp, st.maxHp) + "</div>" +
          '<div class="tt-quest-stats"><span>🪙 <b>' + h.gold + "</b></span><span>⚔️ +" + h.atk + "</span><span>🛡️ " + h.armor +
          "</span><span>🧪 " + h.potions + "</span><span>📍 " + h.pos + "/" + (st.layout.length - 1) + "</span></div></div>";
        if (canAct && st.turn === seat) {
          var atLair = h.pos === st.layout.length - 1;
          out += rollButton(x, seat, true, util, atLair ? "⚔️ Attack the dragon" : "Roll");
          out += '<div class="tt-row">' +
            "<button type=\"button\" class=\"tt-btn\" data-act='{\"type\":\"rest\"}'" + (h.hp >= st.maxHp ? " disabled" : "") + ">⛺ Rest (+4❤)</button>" +
            "<button type=\"button\" class=\"tt-btn\" data-act='{\"type\":\"potion\"}'" + (!h.potions || h.hp >= st.maxHp ? " disabled" : "") + ">🧪 Drink (+5❤)</button></div>";
        } else if (canAct) out += rollButton(x, seat, true, util);
      }
      if (st.dragon) out += '<p class="tt-dim" style="text-align:center;margin:.2rem 0">🐉 Dragon ' + st.dragon.hp + "/" + st.dragon.max + " HP</p>";
      if (st.log && st.log.length) out += '<p class="tt-dim tt-lastword">' + esc(st.log[st.log.length - 1]) + "</p>";
      return out;
    },
  };

  /* ═══════════════════════════════ 3D shared ═══════════════════════════════ */
  if (!window.THREE) return;
  var T = window.THREE;

  // a player's token: their own Hero Forge character, or a coloured pawn
  function token(ctx, seatInfo, seat, scale) {
    var g = new T.Group(), body;
    if (window.KKHero && KKHero.isHero(seatInfo.avatar) && KKHero.isReady && KKHero.isReady()) {
      body = KKHero.build(seatInfo.avatar);
      body.scale.setScalar(scale || 0.42);
      body.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
      g.userData.hero = body;
    } else {
      body = ctx.makePiece("ludo", { body: ctx.smat("tok" + seat, SEAT[seat], { r: 0.35 }), accent: ctx.misc.white }, 1);
      body.scale.setScalar(0.8);
    }
    g.add(body);
    var ring = new T.Mesh(new T.RingGeometry(0.28, 0.36, 28), new T.MeshBasicMaterial({ color: SEAT[seat], transparent: true, opacity: 0.85, side: T.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; g.add(ring);
    g.userData.ring = ring;
    return g;
  }
  function tickTokens(list, dt, t) {
    list.forEach(function (tk) { if (tk && tk.userData.hero) tk.userData.hero.update(dt, t); });
  }
  function play(tk, move) { if (tk && tk.userData.hero) tk.userData.hero.play(move); }

  /* ═══════════════════════════ SNAKES & LADDERS (3D) ═══════════════════════════ */
  function sn3(n, seat) {
    if (n <= 0) return new T.Vector3(-3.6 + (seat || 0) * 1.1, 0, 5.9);
    var r = Math.floor((n - 1) / 10), c = r % 2 === 0 ? (n - 1) % 10 : 9 - (n - 1) % 10;
    return new T.Vector3(c - 4.5, 0, 4.5 - r);
  }
  function snOffset(seat) { return [[-0.22, -0.2], [0.22, -0.2], [-0.22, 0.2], [0.22, 0.2]][seat]; }

  STAGE.snakes = {
    camera: function () { return [0, 15.5, 13.5, 0, 0, 0.4]; },
    spots: function () { return [[-6.6, 3.0], [6.6, -3.0], [6.6, 3.0], [-6.6, -3.0]]; },
    color: function (s) { return SEAT[s]; },
    build: function (ctx, match) {
      var st = match.state, self = this;
      ctx.boardG.add(ctx.plinth(10, 10, "#7c2d12"));
      var pal = ["#fde68a", "#bbf7d0", "#bfdbfe", "#fbcfe8", "#ddd6fe"];
      var tex = ctx.canvasTex(1000, 1000, function (x) {
        for (var n = 1; n <= 100; n++) {
          var r = Math.floor((n - 1) / 10), c = r % 2 === 0 ? (n - 1) % 10 : 9 - (n - 1) % 10;
          x.fillStyle = pal[(n * 7) % 5]; x.fillRect(c * 100, (9 - r) * 100, 100, 100);
          x.strokeStyle = "#fff"; x.lineWidth = 4; x.strokeRect(c * 100, (9 - r) * 100, 100, 100);
          x.fillStyle = "#475569"; x.font = "bold 26px sans-serif"; x.fillText(String(n), c * 100 + 8, (9 - r) * 100 + 30);
        }
        x.font = "64px serif"; x.textAlign = "center"; x.fillText("🏆", 50, 70);
      });
      ctx.boardG.add(ctx.texturedBoard(10, tex));
      var start = new T.Mesh(new T.BoxGeometry(10, 0.1, 1.1), ctx.smat("snstart", "#334155"));
      start.position.set(0, -0.05, 5.95); ctx.boardG.add(start);
      // ladders
      var rail = ctx.smat("ladder", "#a16207", { r: 0.6 });
      Object.keys(st.ladders).forEach(function (f) {
        var a = sn3(+f).setY(0.15), b = sn3(st.ladders[f]).setY(0.15);
        var dir = b.clone().sub(a), len = dir.length(), side = new T.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(0.2);
        [-1, 1].forEach(function (s) {
          var m = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, len, 8), rail);
          m.position.copy(a.clone().add(b).multiplyScalar(0.5)).addScaledVector(side, s);
          m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), dir.clone().normalize());
          m.castShadow = true; ctx.boardG.add(m);
        });
        for (var k = 0.3; k < len; k += 0.42) {
          var rung = new T.Mesh(new T.CylinderGeometry(0.035, 0.035, 0.4, 6), rail);
          rung.position.copy(a).addScaledVector(dir, k / len);
          rung.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), side.clone().normalize());
          ctx.boardG.add(rung);
        }
      });
      // snakes: a chain of beads along a wavy curve, plus the Blender head & jaw
      this.snakes = {};
      var cols = ["#16a34a", "#9333ea", "#ea580c", "#0891b2", "#be123c", "#65a30d", "#c026d3", "#0d9488"];
      Object.keys(st.snakes).forEach(function (h, i) {
        var a = sn3(+h), b = sn3(st.snakes[h]);
        var dir = b.clone().sub(a), side = new T.Vector3(-dir.z, 0, dir.x).normalize();
        var w = Math.min(1.1, dir.length() * 0.28);
        var curve = new T.CatmullRomCurve3([a, a.clone().addScaledVector(dir, 0.3).addScaledVector(side, w),
          a.clone().addScaledVector(dir, 0.65).addScaledVector(side, -w), b]);
        var N = 28, beads = [];
        var mat = ctx.smat("snk" + i, cols[i % cols.length], { r: 0.35 }), mat2 = ctx.smat("snkb" + i, "#fde68a", { r: 0.4 });
        for (var k = 0; k < N; k++) {
          var bead = new T.Mesh(new T.SphereGeometry(1, 12, 8), k % 3 === 1 ? mat2 : mat);
          var rad = 0.2 - 0.14 * (k / N);
          bead.scale.setScalar(rad); bead.userData.rad = rad;
          bead.castShadow = true; ctx.boardG.add(bead); beads.push(bead);
        }
        var head = new T.Group();
        var hd = ctx.cloneNamed("snake_head", { body: mat, belly: ctx.smat("sneye", "#facc15", { e: "#a16207", ei: 0.4 }), dark: ctx.misc.dark });
        var jaw = ctx.cloneNamed("snake_jaw", { belly: mat2, membrane: ctx.smat("tongue", "#dc2626") });
        var jawPivot = new T.Group();
        if (hd) { hd.scale.setScalar(1.3); head.add(hd); }
        if (jaw) { jaw.scale.setScalar(1.3); jawPivot.add(jaw); head.add(jawPivot); }
        head.position.copy(a).setY(0.22);
        ctx.boardG.add(head);
        self.snakes[h] = { curve: curve, beads: beads, head: head, jaw: jawPivot, side: side, open: 0, bulge: -1, phase: i };
      });
      this.tokens = [];
      ctx.onTick(function (dt, t) {
        Object.keys(self.snakes).forEach(function (h) {
          var s = self.snakes[h];
          s.beads.forEach(function (bead, k) {
            var u = 0.06 + 0.94 * (k / (s.beads.length - 1));
            var p = s.curve.getPointAt(u);
            var wig = Math.sin(t * 3 + k * 0.55 + s.phase) * 0.09 * (0.3 + u);
            bead.position.set(p.x + s.side.x * wig, 0.16 + bead.userData.rad * 0.4, p.z + s.side.z * wig);
            var bul = s.bulge >= 0 ? Math.max(0, 1 - Math.abs(u - s.bulge) * 9) : 0;
            bead.scale.setScalar(bead.userData.rad * (1 + bul * 1.4));
          });
          var nxt = s.beads[1].position, hp = s.head.position;
          s.head.lookAt(hp.x + (hp.x - nxt.x), hp.y, hp.z + (hp.z - nxt.z));
          s.head.position.y = 0.24 + Math.sin(t * 2 + s.phase) * 0.05;
          var flick = (Math.sin(t * 1.3 + s.phase * 2) > 0.92) ? 0.35 : 0;
          s.jaw.rotation.x = Math.max(flick, s.open);
        });
        tickTokens(self.tokens, dt, t);
      });
    },
    sync: function (ctx, match) {
      var st = match.state, self = this;
      self.tokens = [];
      st.pos.forEach(function (n, s) {
        var tk = token(ctx, match.seats[s], s, 0.36);
        var p = sn3(n, s), o = n > 0 ? snOffset(s) : [0, 0];
        tk.position.set(p.x + o[0], 0, p.z + o[1]);
        if (st.turn === s && !st.over) tk.userData.ring.material.opacity = 1;
        ctx.piecesG.add(tk); ctx.setPiece("tok" + s, tk); self.tokens.push(tk);
      });
    },
    play: function (ctx, events, match) {
      var chain = Promise.resolve(), self = this;
      events.forEach(function (e) {
        var tk = function () { return ctx.pieces()["tok" + e.seat]; };
        if (e.type === "roll") chain = chain.then(function () { ctx.heroPlay(e.seat, "think"); return ctx.showDie(e.value, true); });
        else if (e.type === "move") chain = chain.then(function () {
          var t = tk(); if (!t) return;
          var c2 = Promise.resolve(), o = snOffset(e.seat);
          e.path.forEach(function (n) {
            c2 = c2.then(function () { var p = sn3(n); return ctx.hop(t, new T.Vector3(p.x + o[0], 0, p.z + o[1]), 210, 0.45); });
          });
          return c2.then(function () { if (e.bounce) return ctx.floatText("BOUNCE!", t.position.clone().setY(1.6), "#f97316"); });
        });
        else if (e.type === "ladder") chain = chain.then(function () {
          var t = tk(); if (!t) return;
          var a = t.position.clone(), b = sn3(e.to), o = snOffset(e.seat), end = new T.Vector3(b.x + o[0], 0, b.z + o[1]);
          play(t, "cheer"); ctx.heroPlay(e.seat, "cheer"); TT.sfx("crown");
          return ctx.anim(1300, function (k) {
            t.position.lerpVectors(a, end, ctx.ease(k));
            t.position.y = 0.3 + Math.abs(Math.sin(k * Math.PI * 7)) * 0.18;     // rung by rung
          }).then(function () {
            t.position.y = 0; ctx.sparks(end.clone().setY(0.6), "#86efac", 50);
            return ctx.floatText("LADDER! +" + (e.to - e.from), end.clone().setY(1.8), "#22c55e");
          });
        });
        else if (e.type === "snake") chain = chain.then(function () {
          var t = tk(), s = self.snakes[e.from]; if (!t || !s) return;
          ctx.heroPlay(e.seat, "hurt"); TT.sfx("bad");
          var mouth = s.head.position.clone().setY(0.2);
          return ctx.anim(450, function (k) { s.open = k * 0.9; }).then(function () {
            var from = t.position.clone();
            return ctx.anim(380, function (k) {                 // gulp: the hero shrinks into the jaws
              t.position.lerpVectors(from, mouth, k);
              t.scale.setScalar(1 - k * 0.98);
            });
          }).then(function () {
            ctx.shake(0.15);
            return ctx.anim(1300, function (k) { s.open = 0.9 * Math.max(0, 1 - k * 4); s.bulge = k; });   // a lump slides down
          }).then(function () {
            s.bulge = -1;
            var b = sn3(e.to), o = snOffset(e.seat), out = new T.Vector3(b.x + o[0], 0, b.z + o[1]);
            t.position.copy(out);
            ctx.sparks(out.clone().setY(0.4), "#a3e635", 40);
            return ctx.anim(350, function (k) { t.scale.setScalar(k * (1 + Math.sin(k * Math.PI) * 0.3)); });
          }).then(function () { t.scale.setScalar(1); return ctx.floatText("SSSWALLOWED! -" + (e.from - e.to), t.position.clone().setY(1.8), "#dc2626"); });
        });
        else if (e.type === "forfeit") chain = chain.then(function () { return ctx.floatText("THREE SIXES!", new T.Vector3(0, 2.4, 0), "#94a3b8"); });
        else if (e.type === "bonus") chain = chain.then(function () { return ctx.floatText("SIX — ROLL AGAIN!", new T.Vector3(0, 2.4, 0), "#facc15"); });
      });
      return chain;
    },
  };

  /* ═══════════════════════════ DRAGON'S HOARD (3D) ═══════════════════════════ */
  function q3(i) {
    var row = Math.floor(i / 7), col = row % 2 === 0 ? i % 7 : 6 - i % 7;
    return new T.Vector3((col - 3) * 1.55 + Math.sin(i * 0.9) * 0.18, 0, (2.6 - row) * 1.55 + Math.cos(i * 0.7) * 0.15);
  }
  function qOff(s) { return [[-0.3, 0.25], [0.3, 0.25], [-0.3, -0.25], [0.3, -0.25]][s]; }
  var MON = { // colours per monster and scale
    slime: { body: "#4ade80", glow: "#bbf7d0", s: 0.95 }, bat: { body: "#6d28d9", membrane: "#4c1d95", s: 0.8, fly: 1.0 },
    goblin: { body: "#65a30d", cloth: "#78350f", s: 0.8 }, skeleton: { s: 0.75 }, troll: { body: "#5f7f4a", belly: "#a3b18a", cloth: "#57534e", s: 0.65 },
    dragon: { body: "#b91c1c", belly: "#fbbf24", membrane: "#7f1d1d", s: 0.75 },
  };

  STAGE.quest = {
    camera: function () { return [0, 17, 14.5, 0, 0, 0.6]; },
    spots: function () { return [[-8.4, 2.8], [8.4, 2.8], [8.4, -3.6], [-8.4, -3.6]]; },
    color: function (s) { return SEAT[s]; },
    build: function (ctx, match) {
      var st = match.state, self = this, sm = ctx.smat;
      self.mats = {
        stone: sm("qstone", "#a8a29e", { r: 0.8 }), leaf: sm("qleaf", "#15803d", { r: 0.8 }), wood: sm("qwood", "#7c4a1e", { r: 0.7 }),
        flame: sm("qflame", "#fb923c", { e: "#f97316", ei: 2 }), glass: sm("qglass", "#bae6fd", { r: 0.1 }),
        glow: sm("qglow", "#c084fc", { e: "#a855f7", ei: 1.6 }), bone: sm("qbone", "#f5f0e1", { r: 0.6 }),
        horn: sm("qhorn", "#fef3c7", { r: 0.5 }),
        // brushed, not mirror-metal: without reflections a very metallic material renders black
        metal: sm("qmetal", "#b6c2d1", { r: 0.45, m: 0.35 }), gold: sm("qgold", "#f5c542", { r: 0.35, m: 0.45 }),
        dark: ctx.misc.dark, white: ctx.misc.white,
      };
      // sea and island
      var sea = new T.Mesh(new T.CircleGeometry(16, 64), new T.MeshStandardMaterial({ color: "#1d4ed8", roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.92 }));
      sea.rotation.x = -Math.PI / 2; sea.position.y = -0.5; ctx.boardG.add(sea);
      var island = new T.Mesh(new T.CylinderGeometry(7.6, 8.4, 0.6, 64), sm("qgrass", "#4d7c0f", { r: 0.95 }));
      island.scale.z = 0.92; island.position.y = -0.31; island.receiveShadow = true; ctx.boardG.add(island);
      var beach = new T.Mesh(new T.CylinderGeometry(8.5, 8.9, 0.3, 64), sm("qsand", "#e9d8a6", { r: 1 }));
      beach.scale.z = 0.92; beach.position.y = -0.48; ctx.boardG.add(beach);
      ctx.onTick(function (dt, t) { sea.material.opacity = 0.86 + Math.sin(t * 0.8) * 0.05; sea.rotation.z = t * 0.01; });
      // path slabs
      st.layout.forEach(function (k, i) {
        var p = q3(i);
        var slab = new T.Mesh(new T.CylinderGeometry(0.55, 0.62, 0.14, 18), k === "dragon" ? sm("qlair", "#450a0a") : k === "camp" ? sm("qcampst", "#d97706") : self.mats.stone);
        slab.position.set(p.x, 0.02, p.z); slab.receiveShadow = true; ctx.boardG.add(slab);
        if (i > 0) {     // stepping stones between tiles
          var a = q3(i - 1), mid = a.clone().add(p).multiplyScalar(0.5);
          var step = new T.Mesh(new T.CylinderGeometry(0.16, 0.18, 0.06, 10), sm("qsand2", "#d6c08a"));
          step.position.set(mid.x, 0.0, mid.z); ctx.boardG.add(step);
        }
        self.prop(ctx, k, i, p);
      });
      // scenery
      for (var n = 0; n < 26; n++) {
        var ang = n * 2.4, rad = 6.6 + (n % 3) * 0.45;
        var kind = n % 4 === 0 ? "prop_rock" : n % 2 ? "prop_palm" : "prop_tree";
        var o = ctx.cloneNamed(kind, self.mats);
        if (!o) continue;
        o.position.set(Math.cos(ang) * rad, 0, Math.sin(ang) * rad * 0.92);
        o.rotation.y = ang; o.scale.setScalar(kind === "prop_rock" ? 1.2 : 0.9 + (n % 5) * 0.1);
        ctx.boardG.add(o);
      }
      self.mons = {}; self.tokens = [];
      ctx.onTick(function (dt, t) { self.tick(ctx, dt, t); });
    },
    prop: function (ctx, k, i, p) {
      var self = this, o = null;
      if (k === "camp") {
        o = ctx.cloneNamed("prop_campfire", self.mats);
        var fl = ctx.cloneNamed("prop_flame", { flame: self.mats.flame, glow: ctx.smat("qflame2", "#fde047", { e: "#facc15", ei: 2.5 }) });
        var light = new T.PointLight(0xff8a3d, 1.2, 4);
        light.position.set(p.x, 0.8, p.z);
        ctx.boardG.add(light);
        if (fl) { fl.position.set(p.x, 0.08, p.z); ctx.boardG.add(fl);
          ctx.onTick(function (dt, t) { var f = 1 + Math.sin(t * 13 + i) * 0.12 + Math.sin(t * 7.3) * 0.08; fl.scale.set(1 / f, f, 1 / f); light.intensity = 1 + (f - 1) * 3; }); }
      } else if (k === "chest") {
        o = ctx.cloneNamed("prop_chest", self.mats);
        var lid = ctx.cloneNamed("prop_chest_lid", self.mats);
        if (lid && o) { var hinge = new T.Group(); hinge.position.set(0, 0.38, 0.24); lid.position.set(0, 0, 0); hinge.add(lid); o.add(hinge); o.userData.lid = hinge; }
        if (o) o.rotation.y = 0.3;
      } else if (k === "potion") {
        o = ctx.cloneNamed("prop_potion", { glass: self.mats.glass, glow: ctx.smat("qpot", "#f472b6", { e: "#db2777", ei: 1.2 }), wood: self.mats.wood });
        if (o) { o.scale.setScalar(1.6); var pb = o; ctx.onTick(function (dt, t) { pb.position.y = 0.12 + Math.sin(t * 2 + i) * 0.08; pb.rotation.y = t; }); }
      } else if (k === "trap") {
        o = new T.Group();
        var plate = ctx.cloneNamed("prop_trapplate", self.mats), spikes = ctx.cloneNamed("prop_spikes", self.mats);
        if (plate) o.add(plate);
        if (spikes) { spikes.position.y = -0.18; o.add(spikes); o.userData.spikes = spikes; }
      } else if (k === "portal") {
        o = ctx.cloneNamed("prop_portal", self.mats);
        var disc = new T.Mesh(new T.CircleGeometry(0.38, 40), new T.MeshBasicMaterial({ map: self.swirlTex(ctx), transparent: true, side: T.DoubleSide }));
        disc.position.set(0, 0.5, 0); if (o) o.add(disc);
        ctx.onTick(function (dt, t) { disc.rotation.z = -t * 2.2; });
        if (o) o.rotation.y = 0.5;
      }
      if (o) { o.position.set(p.x + (k === "chest" || k === "potion" ? 0.28 : 0), (o.position.y || 0) + 0.09, p.z - (k === "portal" ? 0.25 : 0)); ctx.boardG.add(o); }
      if (o) self.props = self.props || {}, self.props[i] = o;
    },
    swirlTex: function (ctx) {
      if (this._swirl) return this._swirl;
      this._swirl = ctx.canvasTex(128, 128, function (x) {
        var g = x.createRadialGradient(64, 64, 4, 64, 64, 64);
        g.addColorStop(0, "#fdf4ff"); g.addColorStop(0.4, "#c084fc"); g.addColorStop(1, "#1e1b4b");
        x.fillStyle = g; x.beginPath(); x.arc(64, 64, 64, 0, 7); x.fill();
        x.strokeStyle = "rgba(255,255,255,.6)"; x.lineWidth = 5;
        for (var a = 0; a < 3; a++) { x.beginPath(); for (var k = 0; k < 60; k++) { var r = k, th = a * 2.1 + k * 0.12; x.lineTo(64 + Math.cos(th) * r, 64 + Math.sin(th) * r); } x.stroke(); }
      });
      return this._swirl;
    },
    monster: function (ctx, kind) {
      var c = MON[kind] || {}, sm = ctx.smat, mats = Object.assign({}, this.mats);
      ["body", "belly", "membrane", "cloth", "glow"].forEach(function (k) { if (c[k]) mats[k] = sm("mon_" + kind + k, c[k], { r: 0.45, e: k === "glow" ? c[k] : null, ei: 1 }); });
      var g = new T.Group(), body = new T.Group();
      g.add(body);
      var m = ctx.cloneNamed("mon_" + kind, mats);
      if (m) body.add(m);
      var wings = [];
      if (kind === "bat" || kind === "dragon") {
        [-1, 1].forEach(function (sx) {
          var w = ctx.cloneNamed(kind === "bat" ? "mon_bat_wing" : "mon_dragon_wing", mats);
          if (!w) return;
          var piv = new T.Group();
          if (kind === "bat") piv.position.set(sx * 0.2, 0, 0); else piv.position.set(sx * 0.45, 1.25, 0.1);
          w.scale.x = sx; piv.add(w); body.add(piv); wings.push({ piv: piv, sx: sx });
        });
      }
      if (kind !== "skeleton" && kind !== "dragon") ctx.addEyes(body, kind === "slime" ? 0.42 : kind === "bat" ? 0.06 : kind === "troll" ? 1.3 : 0.95,
        kind === "slime" ? 0.36 : kind === "bat" ? 0.25 : kind === "troll" ? 0.45 : 0.27, kind === "troll" ? 0.09 : 0.1, false);
      g.scale.setScalar(c.s || 1);
      g.userData = { kind: kind, body: body, wings: wings, phase: Math.random() * 6, fly: c.fly || 0 };
      return g;
    },
    sync: function (ctx, match) {
      var st = match.state, self = this;
      self.mons = {}; self.tokens = [];
      Object.keys(st.monsters).forEach(function (t) {
        var m = st.monsters[t], o = self.monster(ctx, m.kind), p = q3(+t);
        o.position.set(p.x, 0.09 + (o.userData.fly || 0), p.z);
        if (m.kind === "dragon") { o.position.z -= 0.4; o.rotation.y = 0.5; }
        ctx.piecesG.add(o); self.mons[t] = o;
      });
      st.heroes.forEach(function (h, s) {
        var tk = token(ctx, match.seats[s], s, 0.44), p = q3(h.pos), off = qOff(s);
        tk.position.set(p.x + off[0], 0.09, p.z + off[1]);
        if (st.turn === s && !st.over) tk.userData.ring.material.opacity = 1;
        ctx.piecesG.add(tk); ctx.setPiece("tok" + s, tk); self.tokens.push(tk);
      });
    },
    tick: function (ctx, dt, t) {
      var self = this;
      Object.keys(self.mons || {}).forEach(function (k) {
        var o = self.mons[k], u = o.userData, b = u.body, ph = u.phase;
        if (u.busy) return;
        if (u.kind === "slime") { var sq = 1 + Math.sin(t * 4 + ph) * 0.12; b.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq)); }
        else if (u.kind === "bat") { b.position.y = Math.sin(t * 3 + ph) * 0.15; }
        else if (u.kind === "dragon") { b.scale.y = 1 + Math.sin(t * 1.6) * 0.03; b.rotation.y = Math.sin(t * 0.4) * 0.15; }
        else if (u.kind === "skeleton") { b.rotation.z = Math.sin(t * 9 + ph) * 0.03; b.position.y = Math.abs(Math.sin(t * 4.5 + ph)) * 0.04; }
        else { b.position.y = Math.abs(Math.sin(t * 2.5 + ph)) * 0.06; b.rotation.y = Math.sin(t + ph) * 0.2; }
        u.wings.forEach(function (w) { w.piv.rotation.z = w.sx * Math.sin(t * (u.kind === "bat" ? 16 : 2.6) + ph) * (u.kind === "bat" ? 0.7 : 0.35); });
      });
      tickTokens(self.tokens || [], dt, t);
    },
    fire: function (ctx, from, to) {        // dragon breath: a cone of embers
      var N = 140, geo = new T.BufferGeometry(), pos = new Float32Array(N * 3), seeds = [];
      for (var i = 0; i < N; i++) seeds.push([Math.random(), (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6]);
      geo.setAttribute("position", new T.BufferAttribute(pos, 3));
      var pts = new T.Points(geo, new T.PointsMaterial({ color: "#fb923c", size: 0.28, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
      ctx.fxG.add(pts);
      var dir = to.clone().sub(from);
      TT.sfx("split");
      return ctx.anim(1000, function (k) {
        for (var i = 0; i < N; i++) {
          var s = seeds[i], f = (s[0] + k * 1.6) % 1;
          pos[i * 3] = from.x + dir.x * f + s[1] * f; pos[i * 3 + 1] = from.y + dir.y * f + s[2] * f; pos[i * 3 + 2] = from.z + dir.z * f + s[1] * f;
        }
        geo.attributes.position.needsUpdate = true;
        pts.material.color.setHSL(0.07 - k * 0.04, 1, 0.55);
        pts.material.opacity = k < 0.8 ? 1 : (1 - k) * 5;
      }).then(function () { ctx.fxG.remove(pts); geo.dispose(); });
    },
    play: function (ctx, events, match, prev) {
      var chain = Promise.resolve(), self = this;
      var tk = function (s) { return ctx.pieces()["tok" + s]; };
      events.forEach(function (e) {
        if (e.type === "roll" && !e.dragon) chain = chain.then(function () { ctx.heroPlay(e.seat, "think"); return ctx.showDie(e.value, true); });
        else if (e.type === "walk") chain = chain.then(function () {
          var t = tk(e.seat); if (!t) return;
          var c2 = Promise.resolve(), off = qOff(e.seat);
          e.path.forEach(function (i) { c2 = c2.then(function () { var p = q3(i); return ctx.hop(t, new T.Vector3(p.x + off[0], 0.09, p.z + off[1]), 230, 0.5); }); });
          return c2.then(function () { if (e.blocked) return ctx.floatText("A " + e.blocked.toUpperCase() + " BLOCKS THE WAY!", t.position.clone().setY(2), "#fca5a5"); });
        });
        else if (e.type === "fight") chain = chain.then(function () { return self.fightAnim(ctx, e, tk(e.seat)); });
        else if (e.type === "chest") chain = chain.then(function () {
          var o = self.props && self.props[e.at], p = q3(e.at).setY(1);
          ctx.heroPlay(e.seat, "cheer"); play(tk(e.seat), "cheer");
          var lid = o && o.userData.lid;
          return ctx.anim(450, function (k) { if (lid) lid.rotation.x = -k * 1.9; }).then(function () {
            ctx.sparks(p, "#facc15", 90); TT.sfx("score");
            return ctx.floatText(e.loot.gold ? "+" + e.loot.gold + " GOLD" : e.loot.item.toUpperCase() + "!", p.clone().setY(2), "#facc15");
          }).then(function () { return ctx.anim(400, function (k) { if (lid) lid.rotation.x = -1.9 * (1 - k); }); });
        });
        else if (e.type === "trap") chain = chain.then(function () {
          var o = self.props && self.props[e.at], sp = o && o.userData.spikes, t = tk(e.seat);
          TT.sfx("slash"); ctx.shake(0.2); play(t, "hurt"); ctx.heroPlay(e.seat, "hurt");
          return ctx.anim(260, function (k) { if (sp) sp.position.y = -0.18 + 0.35 * k; }).then(function () {
            return ctx.floatText("SPIKES! -" + e.dmg + " HP", q3(e.at).setY(2), "#ef4444");
          }).then(function () { return ctx.anim(400, function (k) { if (sp) sp.position.y = 0.17 - 0.35 * k; }); });
        });
        else if (e.type === "portal") chain = chain.then(function () {
          var t = tk(e.seat); if (!t) return;
          var a = q3(e.from), b = q3(e.to), off = qOff(e.seat);
          TT.sfx("crown");
          return ctx.anim(500, function (k) { t.rotation.y = k * 12; t.scale.setScalar(1 - k); t.position.y = 0.09 + k * 0.6; }).then(function () {
            t.position.set(b.x + off[0], 0.09, b.z + off[1]); ctx.ring(b, "#c084fc", 1.4);
            return ctx.anim(500, function (k) { t.rotation.y = 12 + k * 6; t.scale.setScalar(k); });
          }).then(function () { t.rotation.y = 0; t.scale.setScalar(1); return ctx.floatText("PORTAL!", b.clone().setY(2), "#c084fc"); });
        });
        else if (e.type === "camp") chain = chain.then(function () {
          ctx.sparks(q3(e.at).setY(0.8), "#fb923c", 50);
          return ctx.floatText(e.heal ? "CAMPFIRE +" + e.heal + " HP" : "CHECKPOINT", q3(e.at).setY(2), "#fdba74");
        });
        else if (e.type === "potion") chain = chain.then(function () { return ctx.floatText("+1 POTION", q3(e.at).setY(2), "#f472b6"); });
        else if (e.type === "rest" || e.type === "drink") chain = chain.then(function () {
          var t = tk(e.seat); if (!t) return;
          ctx.sparks(t.position.clone().setY(0.8), e.type === "rest" ? "#93c5fd" : "#f472b6", 40);
          return ctx.floatText((e.type === "rest" ? "Zzz +" : "GLUG +") + e.heal + " HP", t.position.clone().setY(1.9), "#86efac");
        });
        else if (e.type === "ko") chain = chain.then(function () {
          var t = tk(e.seat); if (!t) return;
          ctx.heroPlay(e.seat, "sad");
          return ctx.anim(500, function (k) { t.rotation.x = -k * Math.PI / 2; }).then(function () {
            var b = q3(e.to), off = qOff(e.seat);
            t.rotation.x = 0; t.position.set(b.x + off[0], 0.09, b.z + off[1]);
            ctx.ring(b, "#fb923c", 1.2);
            return ctx.floatText("K.O.! -" + e.lost + " GOLD", b.clone().setY(2), "#ef4444");
          });
        });
        else if (e.type === "slay") chain = chain.then(function () {
          ctx.confetti(); TT.sfx("win");
          return ctx.floatText("DRAGON SLAIN!", new T.Vector3(0, 3.5, 0), "#facc15", true);
        });
      });
      return chain;
    },
    fightAnim: function (ctx, e, t) {
      var self = this, m = self.mons[String(e.at)];
      if (!m || !t) return Promise.resolve();
      var mp = m.position.clone(), home = t.position.clone();
      var front = mp.clone().add(new T.Vector3(0.15, 0, e.monster === "dragon" ? 1.6 : 0.85)).setY(0.09);
      t.lookAt(mp.x, t.position.y, mp.z);
      m.userData.busy = true;
      var chain = ctx.hop(t, front, 300, 0.4).then(function () { t.lookAt(mp.x, 0.09, mp.z); });
      var hpText = function (r) { return r.monHp + "/" + e.max; };
      e.rounds.forEach(function (r, idx) {
        chain = chain.then(function () {
          play(t, "attack"); ctx.heroPlay(e.seat, "attack");
          return ctx.delay(300);
        }).then(function () {
          if (r.hit) {
            TT.sfx("slash");
            ctx.sparks(mp.clone().setY(0.9), "#fde047", 30);
            m.userData.body.scale.multiplyScalar(0.85);
            setTimeout(function () { m.userData.body.scale.multiplyScalar(1 / 0.85); }, 160);
            return ctx.floatText((r.dmg > 1 ? "CRIT -" : "-") + r.dmg + "  (" + hpText(r) + ")", mp.clone().setY(2.2), r.dmg > 1 ? "#f97316" : "#fde047");
          }
          return ctx.floatText("MISS", mp.clone().setY(2.2), "#94a3b8");
        }).then(function () {
          if (r.mon === undefined) return;
          var lunge = t.position.clone().sub(mp).multiplyScalar(0.35);
          var start = m.position.clone();
          var attack = e.monster === "dragon"
            ? self.fire(ctx, mp.clone().add(new T.Vector3(0, 1.6, 0.9)), t.position.clone().setY(0.6))
            : ctx.anim(260, function (k) { m.position.copy(start).addScaledVector(lunge, Math.sin(k * Math.PI)); });
          return attack.then(function () {
            if (r.mhit) { play(t, "hurt"); ctx.shake(0.1); TT.sfx("bad"); return ctx.floatText("-" + r.mdmg + " HP", t.position.clone().setY(1.8), "#ef4444"); }
            return ctx.floatText("DODGED", t.position.clone().setY(1.8), "#93c5fd");
          });
        });
      });
      return chain.then(function () {
        m.userData.busy = false;
        if (e.result === "win") {
          play(t, "cheer"); ctx.heroPlay(e.seat, "cheer");
          return ctx.swordSlash(t, m).then(function () {
            ctx.sparks(mp.clone().setY(0.6), "#facc15", 80);
            return ctx.floatText((e.monster === "dragon" ? "DRAGON" : e.monster.toUpperCase()) + " SLAIN! +" + e.gold + " GOLD", mp.clone().setY(2.4), "#facc15", e.monster === "dragon");
          });
        }
        if (e.result === "retreat") return ctx.floatText("THE DRAGON RETREATS INTO SMOKE", mp.clone().setY(3), "#cbd5e1");
      }).then(function () {
        if (e.result !== "ko") return ctx.hop(t, front.clone().add(new T.Vector3(-0.3, 0, -0.1)), 200, 0.2);
      }).then(function () { t.rotation.set(0, 0, 0); });
    },
  };
})();
