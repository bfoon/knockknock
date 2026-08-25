/* Chalk — Timeout: the games with hands and feet.
 *
 * Snake · Dash · Cliff · Tennis · Hoops · Bricks · Chalk fight
 *
 * Everything here is drawn as chalk on the board by chalk_games.js's pen, and
 * everything is simulated on the projector. A game never touches the lesson:
 * no strokes, no elements, no undo entries, nothing saved.
 *
 * Conventions inside a game:
 *   g.W / g.H   the board in game units — 1000 wide, height follows the screen
 *   g.s         the game's own scratch bag, wiped between rounds
 *   g.players   everyone holding a phone, in the order they joined
 *   p.hold[k]   1 while a phone button is held down
 */
(function (global) {
  "use strict";

  var G = global.ChalkGames;
  if (!G) return;

  var DUST = "#e8eef4";
  var FAINT = "rgba(232,238,244,.30)";

  /* A chalk person. Every game that needs a body draws this one. */
  function figure(pen, x, y, h, color, pose) {
    var head = h * 0.20, hip = y - h * 0.45, sh = y - h * 0.68;
    pen.ring(x, y - h + head, head, color, 3);
    pen.line(x, y - h + head * 2, x, hip, color, 3);
    if (pose === "run") {
      var sw = Math.sin(pose_t * 14) * h * 0.16;
      pen.line(x, hip, x - h * 0.22 + sw, y, color, 3);
      pen.line(x, hip, x + h * 0.24 - sw, y - h * 0.06, color, 3);
      pen.line(x, sh, x + h * 0.26 - sw, sh - h * 0.10, color, 3);
      pen.line(x, sh, x - h * 0.24 + sw, sh + h * 0.10, color, 3);
    } else if (pose === "duck") {
      pen.line(x, hip, x - h * 0.24, y, color, 3);
      pen.line(x, hip, x + h * 0.24, y, color, 3);
      pen.line(x, sh, x + h * 0.30, sh, color, 3);
    } else if (pose === "jump") {
      pen.line(x, hip, x - h * 0.26, y - h * 0.12, color, 3);
      pen.line(x, hip, x + h * 0.26, y - h * 0.12, color, 3);
      pen.line(x, sh, x - h * 0.24, sh - h * 0.24, color, 3);
      pen.line(x, sh, x + h * 0.24, sh - h * 0.24, color, 3);
    } else {
      pen.line(x, hip, x - h * 0.20, y, color, 3);
      pen.line(x, hip, x + h * 0.20, y, color, 3);
      pen.line(x - h * 0.24, sh + h * 0.14, x + h * 0.24, sh + h * 0.14, color, 3);
    }
  }
  var pose_t = 0;

  function shade(pen, g) {
    /* A faint frame so the game reads as a thing pinned to the board. */
    pen.box(14, 14, g.W - 28, g.H - 28, FAINT, 2);
  }

  function banner(g, text, color) {
    g.pen.text(text, g.W / 2, g.H / 2, Math.min(84, g.W / 12), color || DUST);
  }

  /* ==================================================================
     1. Snake — chalk snake
     ================================================================== */

  var CELL = 22;

  G.add({
    id: "snake",
    name: "Chalk snake",
    tag: "Everyone at once",
    blurb: "Eat the dust, grow long, do not run into anybody — including yourself.",
    how: "Swipe or use the arrows. You cannot turn back on yourself.",
    pad: "dpad",
    min: 1, max: 6, secs: 90,

    setup: function (g) {
      g.s.cols = Math.floor((g.W - 60) / CELL);
      g.s.rows = Math.floor((g.H - 60) / CELL);
      g.s.ox = (g.W - g.s.cols * CELL) / 2;
      g.s.oy = (g.H - g.s.rows * CELL) / 2 + 6;
      g.s.snakes = {};
      g.s.food = [];
      g.s.acc = 0;
      g.s.step = 0.16;
      g.s.puffs = [];
    },

    start: function (g) {
      var self = this;
      g.players.forEach(function (p) { self.join(g, p); });
      g.s.food = [];
      for (var i = 0; i < 4 + g.players.length; i++) this.feed(g);
    },

    join: function (g, p) {
      if (!g.s.cols) return;
      var row = 2 + (p.seat % Math.max(1, g.s.rows - 4));
      g.s.snakes[p.pid] = {
        body: [{ x: 3, y: row }, { x: 2, y: row }, { x: 1, y: row }],
        dir: { x: 1, y: 0 }, want: { x: 1, y: 0 }, wait: 0, len: 4
      };
    },

    leave: function (g, p) { delete g.s.snakes[p.pid]; },

    feed: function (g) {
      for (var tries = 0; tries < 40; tries++) {
        var f = { x: Math.floor(Math.random() * g.s.cols),
                  y: Math.floor(Math.random() * g.s.rows) };
        if (!this.solid(g, f.x, f.y)) { g.s.food.push(f); return; }
      }
    },

    solid: function (g, x, y) {
      var pid, b, i;
      for (pid in g.s.snakes) {
        b = g.s.snakes[pid].body;
        for (i = 0; i < b.length; i++) if (b[i].x === x && b[i].y === y) return true;
      }
      return false;
    },

    input: function (g, p, k, v) {
      if (k !== "dir") return;
      var s = g.s.snakes[p.pid];
      if (!s) return;
      var d = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 },
                left: { x: -1, y: 0 }, right: { x: 1, y: 0 } }[v];
      if (!d) return;
      if (d.x === -s.dir.x && d.y === -s.dir.y) return;   /* no U-turns */
      s.want = d;
    },

    step: function (g, dt) {
      var self = this;
      g.s.acc += dt;
      g.s.step = Math.max(0.09, 0.17 - g.t * 0.0006);
      g.s.puffs = g.s.puffs.filter(function (p) { p.life -= dt; return p.life > 0; });
      while (g.s.acc >= g.s.step) {
        g.s.acc -= g.s.step;
        g.players.forEach(function (p) { self.advance(g, p); });
      }
    },

    advance: function (g, p) {
      var s = g.s.snakes[p.pid];
      if (!s) return;
      if (s.wait > 0) { s.wait--; return; }
      s.dir = s.want;
      var head = { x: s.body[0].x + s.dir.x, y: s.body[0].y + s.dir.y };

      var hitWall = head.x < 0 || head.y < 0 || head.x >= g.s.cols || head.y >= g.s.rows;
      if (hitWall || this.solid(g, head.x, head.y)) {
        this.crash(g, p, s, head);
        return;
      }
      s.body.unshift(head);

      var ate = -1;
      for (var i = 0; i < g.s.food.length; i++) {
        if (g.s.food[i].x === head.x && g.s.food[i].y === head.y) { ate = i; break; }
      }
      if (ate >= 0) {
        g.s.food.splice(ate, 1);
        this.feed(g);
        s.len += 1;
        p.score += 1;
        p.note = s.body.length + " long";
        g.beep.play(700 + Math.min(8, s.len) * 40, 0.06);
        g.cue(p, "point");
      }
      while (s.body.length > s.len) s.body.pop();
    },

    crash: function (g, p, s, at) {
      g.s.puffs.push({ x: at.x, y: at.y, life: 0.7, color: p.color });
      g.beep.slide(300, 90, 0.25);
      g.cue(p, "hit");
      p.note = "crashed";
      s.body = s.body.slice(0, 3);
      s.len = Math.max(4, Math.floor(s.len * 0.5));
      s.wait = 8;                       /* eight steps sitting still */
      s.want = s.dir = { x: 1, y: 0 };
    },

    draw: function (g) {
      var pen = g.pen, s = g.s, x, y;
      shade(pen, g);
      /* the grid, very faint — chalk squares on a rolled-down board */
      g.ctx.globalAlpha = 0.10;
      g.ctx.strokeStyle = DUST; g.ctx.lineWidth = 1;
      g.ctx.beginPath();
      for (x = 0; x <= s.cols; x++) {
        g.ctx.moveTo(s.ox + x * CELL, s.oy);
        g.ctx.lineTo(s.ox + x * CELL, s.oy + s.rows * CELL);
      }
      for (y = 0; y <= s.rows; y++) {
        g.ctx.moveTo(s.ox, s.oy + y * CELL);
        g.ctx.lineTo(s.ox + s.cols * CELL, s.oy + y * CELL);
      }
      g.ctx.stroke(); g.ctx.globalAlpha = 1;

      s.food.forEach(function (f) {
        var cx = s.ox + f.x * CELL + CELL / 2, cy = s.oy + f.y * CELL + CELL / 2;
        pen.line(cx - 6, cy - 6, cx + 6, cy + 6, DUST, 3);
        pen.line(cx + 6, cy - 6, cx - 6, cy + 6, DUST, 3);
      });

      g.players.forEach(function (p) {
        var sn = s.snakes[p.pid];
        if (!sn) return;
        var pts = [], i;
        for (i = 0; i < sn.body.length; i++) {
          pts.push(s.ox + sn.body[i].x * CELL + CELL / 2,
                   s.oy + sn.body[i].y * CELL + CELL / 2);
        }
        if (pts.length >= 4) pen.stroke(pts, p.color, CELL * 0.55, false);
        var hx = pts[0], hy = pts[1];
        if (sn.wait > 0) {
          pen.ring(hx, hy, CELL * 0.6, p.color, 2);
        } else {
          pen.disc(hx, hy, CELL * 0.34, p.color, 0.95);
          pen.text(p.name.slice(0, 8), hx, hy - CELL * 1.1, 16, p.color);
        }
      });

      s.puffs.forEach(function (pf) {
        pen.dust(s.ox + pf.x * CELL, s.oy + pf.y * CELL, 12, pf.color, 30, 3);
      });

      if (!g.players.length) banner(g, "Nobody is holding a phone", FAINT);
    }
  });

  /* ==================================================================
     2. Dash — run and jump
     ================================================================== */

  G.add({
    id: "runner",
    name: "Dash",
    tag: "Last one running",
    blurb: "Jump the logs, duck the bars. Three knocks and you are out.",
    how: "Two buttons: Jump and Duck. Hold Duck to stay down.",
    pad: "buttons",
    min: 1, max: 6, secs: 120,

    setup: function (g) {
      g.s.things = [];
      g.s.speed = 300;
      g.s.next = 0.9;
      g.s.run = {};
      g.s.scroll = 0;
    },

    start: function (g) {
      var self = this;
      g.setPad({ kind: "buttons", keys: [
        { k: "jump", label: "Jump" }, { k: "duck", label: "Duck" }
      ] });
      g.s.things = [];
      g.players.forEach(function (p) { self.join(g, p); });
    },

    join: function (g, p) {
      g.s.run[p.pid] = { y: 0, vy: 0, duck: 0, lives: 3, hurt: 0, dist: 0,
                         x: 130 + (p.seat % 5) * 52 };
      p.note = "\u2665\u2665\u2665";
    },
    leave: function (g, p) { delete g.s.run[p.pid]; },

    ground: function (g) { return g.H - 96; },

    input: function (g, p, k, v) {
      var r = g.s.run[p.pid];
      if (!r) return;
      if (k === "jump" && v === 1 && r.y === 0 && r.hurt <= 0) {
        r.vy = -640; g.beep.play(520, 0.07);
      }
      if (k === "duck") r.duck = v === 1 ? 1 : 0;
    },

    step: function (g, dt) {
      var s = g.s, self = this;
      s.speed = 300 + g.t * 9;
      s.scroll += s.speed * dt;

      s.next -= dt;
      if (s.next <= 0) {
        s.next = Math.max(0.55, 1.5 - g.t * 0.012) * (0.7 + Math.random() * 0.8);
        var kind = Math.random();
        s.things.push({
          x: g.W + 60,
          kind: kind < 0.45 ? "log" : (kind < 0.8 ? "bar" : "wall"),
          hit: {}
        });
      }

      s.things.forEach(function (t) { t.x -= s.speed * dt; });
      s.things = s.things.filter(function (t) { return t.x > -120; });

      var alive = 0;
      g.players.forEach(function (p) {
        var r = s.run[p.pid];
        if (!r || p.out) return;
        alive++;
        r.vy += 1800 * dt;
        r.y = Math.min(0, r.y + r.vy * dt);
        if (r.y === 0) r.vy = 0;
        if (r.hurt > 0) r.hurt -= dt;
        r.dist += s.speed * dt;
        p.score = Math.floor(r.dist / 10);

        s.things.forEach(function (t) {
          if (t.hit[p.pid] || r.hurt > 0) return;
          if (Math.abs(t.x - r.x) > 34) return;
          var safe =
            t.kind === "bar" ? (r.duck === 1 || r.y < -70)
            : t.kind === "log" ? (r.y < -46)
            : (r.y < -74);
          if (safe) return;
          t.hit[p.pid] = 1;
          r.lives--;
          r.hurt = 1.1;
          r.vy = -260;
          p.note = "\u2665".repeat(Math.max(0, r.lives)) || "out";
          g.beep.slide(260, 80, 0.22);
          g.cue(p, "hit");
          if (r.lives <= 0) {
            p.out = true;
            p.note = "out — " + p.score + "m";
          }
        });
      });

      if (g.players.length && !g.playing().length) {
        g.finish("Everybody fell over", "Longest run wins.");
      } else if (g.players.length > 1 && g.playing().length === 1) {
        var last = g.playing()[0];
        g.finish(last.name + " is still running", last.score + " metres");
      }
    },

    draw: function (g) {
      var pen = g.pen, s = g.s, gy = this.ground(g);
      shade(pen, g);

      /* ground line, drawn as one long dashed chalk run that scrolls */
      var off = -(s.scroll % 60);
      for (var x = off; x < g.W; x += 60) pen.line(x, gy, x + 34, gy, FAINT, 3);
      pen.line(0, gy + 1, g.W, gy + 1, "rgba(232,238,244,.18)", 2);

      s.things.forEach(function (t) {
        if (t.kind === "log") {
          pen.box(t.x - 22, gy - 42, 44, 42, "#d9a441", 3);
          pen.line(t.x - 22, gy - 42, t.x + 22, gy, "#d9a441", 2);
        } else if (t.kind === "bar") {
          pen.box(t.x - 30, gy - 150, 60, 22, "#56b7e6", 3);
          pen.line(t.x, gy - 128, t.x, gy - 96, FAINT, 2);
        } else {
          pen.box(t.x - 18, gy - 72, 36, 72, "#d9614a", 3);
          pen.line(t.x - 18, gy - 72, t.x + 18, gy - 30, "#d9614a", 2);
        }
      });

      pose_t = g.t;
      g.players.forEach(function (p) {
        var r = s.run[p.pid];
        if (!r) return;
        var h = 78, y = gy + r.y;
        if (p.out) {
          g.ctx.globalAlpha = 0.35;
          figure(pen, r.x, gy, h * 0.7, p.color, "duck");
          g.ctx.globalAlpha = 1;
          return;
        }
        var pose = r.y < 0 ? "jump" : (r.duck ? "duck" : "run");
        if (r.hurt > 0 && Math.floor(g.t * 14) % 2 === 0) g.ctx.globalAlpha = 0.35;
        figure(pen, r.x, y, r.duck && r.y === 0 ? h * 0.62 : h, p.color, pose);
        g.ctx.globalAlpha = 1;
        pen.text(p.name.slice(0, 9), r.x, y - h - 26, 16, p.color);
        if (r.y === 0 && !r.duck) pen.dust(r.x - 16, gy, 3, p.color, 12, 1.6);
      });
    }
  });

  /* ==================================================================
     3. Cliff — climbing, and it is meant to be hard
     ================================================================== */

  G.add({
    id: "climb",
    name: "Cliff",
    tag: "Race to the top",
    blurb: "Swap hands up the wall. Cracked holds break — grab again fast or slip.",
    how: "Alternate hands where there are two holds. Where there is one, that is the hand. A cracked hold needs the same hand again, quickly.",
    pad: "hands",
    min: 1, max: 5, secs: 0,

    setup: function (g) {
      g.s.wall = {};
      g.s.rows = [];
      g.s.floor = 0;
      g.s.target = 60;
      for (var i = 0; i < 400; i++) g.s.rows.push(this.row(i));
    },

    row: function (i) {
      if (i < 4) return { l: 1, r: 1, crack: 0 };
      var hard = Math.min(0.55, 0.08 + i * 0.006);
      var only = Math.random();
      return {
        l: only < 0.75 ? 1 : 0,
        r: only > 0.25 ? 1 : 0,
        crack: Math.random() < hard ? 1 : 0
      };
    },

    start: function (g) {
      var self = this;
      g.setPad({ kind: "hands", keys: [
        { k: "left", label: "Left hand" }, { k: "right", label: "Right hand" }
      ] });
      g.s.floor = -6;
      g.players.forEach(function (p) { self.join(g, p); });
    },

    join: function (g, p) {
      g.s.wall[p.pid] = { row: 0, hand: "", slip: 0, catchBy: 0, catchHand: "", shake: 0 };
      p.note = "0 m";
    },
    leave: function (g, p) { delete g.s.wall[p.pid]; },

    input: function (g, p, k, v) {
      if (v !== 1) return;
      if (k !== "left" && k !== "right") return;
      var w = g.s.wall[p.pid];
      if (!w || p.out || w.slip > 0) return;

      /* Catching a hold that just broke: same hand, quickly. */
      if (w.catchBy > g.t) {
        if (k === w.catchHand) {
          w.catchBy = 0;
          g.beep.play(880, 0.05);
          return;
        }
        return this.slip(g, p, w, "wrong hand");
      }

      var next = g.s.rows[w.row + 1];
      if (!next) return;
      var has = k === "left" ? next.l : next.r;
      if (!has) return this.slip(g, p, w, "no hold there");
      /* Alternating is the rule only where there is a choice. A wall that
       * demands the other hand and then offers nothing for it is not hard,
       * it is broken, and it took one playtest to find that out. */
      if (next.l && next.r && w.hand === k) return this.slip(g, p, w, "same hand twice");

      w.row++;
      w.hand = k;
      p.score = w.row;
      p.note = w.row + " m";
      g.beep.play(300 + (w.row % 12) * 30, 0.05);

      if (g.s.rows[w.row].crack) {
        w.catchBy = g.t + 0.5;
        w.catchHand = k;
        w.shake = 0.4;
        g.cue(p, "warn");
      }
      if (w.row >= g.s.target) {
        g.finish(p.name + " tops out", w.row + " metres, first to the top.");
      }
    },

    slip: function (g, p, w, why) {
      w.slip = 0.7;
      /* The floor is a float — it creeps. A row index is not, and a
       * fractional row index reads straight off the end of the wall. */
      w.row = Math.max(0, Math.ceil(g.s.floor), w.row - 3);
      w.hand = "";
      w.catchBy = 0;
      p.score = w.row;
      p.note = why;
      g.beep.slide(220, 70, 0.3);
      g.cue(p, "hit");
    },

    step: function (g, dt) {
      var s = g.s;
      s.floor += (0.7 + g.t * 0.02) * dt;
      g.players.forEach(function (p) {
        var w = s.wall[p.pid];
        if (!w || p.out) return;
        if (w.slip > 0) w.slip -= dt;
        if (w.shake > 0) w.shake -= dt;
        if (w.catchBy && g.t > w.catchBy) {
          w.catchBy = 0;
          w.slip = 0.7;
          w.row = Math.max(0, Math.ceil(s.floor), w.row - 4);
          w.hand = "";
          p.score = w.row;
          p.note = "the hold went";
          g.cue(p, "hit");
        }
        if (w.row < s.floor) {
          p.out = true;
          p.note = "caught by the dust — " + p.score + " m";
          g.cue(p, "hit");
        }
      });
      if (g.players.length && !g.playing().length) {
        g.finish("The dust won", "Nobody stayed above it.");
      }
    },

    draw: function (g) {
      var pen = g.pen, s = g.s;
      shade(pen, g);
      var list = g.players;
      var n = Math.max(1, list.length);
      var lw = (g.W - 60) / n;
      var rowH = Math.max(46, (g.H - 120) / 9);

      list.forEach(function (p, i) {
        var w = s.wall[p.pid];
        if (!w) return;
        var x0 = 30 + i * lw, cx = x0 + lw / 2;
        var base = g.H - 90;

        pen.line(x0 + 4, 40, x0 + 4, g.H - 30, FAINT, 2);

        for (var r = -1; r < 8; r++) {
          var idx = w.row + r;
          if (idx < 0 || idx >= s.rows.length) continue;
          var row = s.rows[idx];
          var y = base - r * rowH;
          if (y < 30 || y > g.H) continue;
          var c = row.crack ? "#d9614a" : FAINT;
          if (row.l) { pen.line(cx - lw * 0.30, y, cx - lw * 0.14, y, c, row.crack ? 3 : 4); }
          if (row.r) { pen.line(cx + lw * 0.14, y, cx + lw * 0.30, y, c, row.crack ? 3 : 4); }
          if (row.crack) {
            pen.line(cx - lw * 0.06, y - 6, cx + lw * 0.06, y + 6, "#d9614a", 1.5);
          }
          if (idx % 10 === 0) pen.text(idx + "m", cx, y - 16, 15, FAINT);
        }

        /* the climber */
        var cy = base - (w.slip > 0 ? 10 : 0);
        var pose = w.slip > 0 ? "duck" : "jump";
        var jitter = w.shake > 0 ? Math.sin(g.t * 60) * 4 : 0;
        figure(pen, cx + jitter, cy, 70, p.color, pose);
        pen.text(p.name.slice(0, 9), cx, 44, 17, p.color);
        pen.text(w.row + " m", cx, 66, 15, FAINT);

        if (w.catchBy) {
          pen.text("catch it!", cx, cy - 96, 22, "#d9614a");
        }
        if (p.out) {
          g.ctx.globalAlpha = 0.5;
          pen.text("out", cx, g.H / 2, 40, "#d9614a");
          g.ctx.globalAlpha = 1;
        }

        /* the rising dust, in this lane's own coordinates */
        var dy = base - (s.floor - w.row) * rowH;
        if (dy < g.H + 40 && dy > -40) {
          pen.slab(x0, dy, lw, g.H - dy + 20, "#d9614a", 0.16);
          for (var d = 0; d < 5; d++) {
            pen.dust(x0 + Math.random() * lw, dy + Math.random() * 20, 3, "#d9614a", 16, 3);
          }
        }
      });

      pen.text("first to " + s.target + " m", g.W / 2, 22, 18, FAINT);
    }
  });

  /* ==================================================================
     4. Tennis — two bats and a rally
     ================================================================== */

  function seats(g, n) {
    var out = [], i;
    for (i = 0; i < g.players.length && out.length < n; i++) {
      if (!g.players[i].out) out.push(g.players[i]);
    }
    for (i = 0; i < g.players.length; i++) {
      g.players[i].note = out.indexOf(g.players[i]) >= 0 ? "" : "next up";
    }
    return out;
  }

  G.add({
    id: "tennis",
    name: "Tennis",
    tag: "Two players",
    blurb: "A long rally on a dusty court. First to seven.",
    how: "Slide your thumb up and down to move your bat.",
    pad: "slider",
    min: 1, max: 8, secs: 0,

    setup: function (g) {
      g.s.bat = {};
      g.s.ball = null;
      g.s.spark = 0;
    },

    start: function (g) {
      g.setPad({ kind: "slider", axis: "y", label: "Slide to move your bat" });
      g.players.forEach(function (p) { p.score = 0; });
      g.s.bat = {};
      this.serve(g, Math.random() < 0.5 ? -1 : 1);
    },

    serve: function (g, dir) {
      g.s.ball = {
        x: g.W / 2, y: g.H / 2,
        vx: 360 * dir, vy: (Math.random() * 2 - 1) * 180, r: 11, hits: 0
      };
      g.beep.play(600, 0.08);
    },

    input: function (g, p, k, v) {
      if (k === "pos") g.s.bat[p.pid] = Math.max(0, Math.min(1, v));
    },

    step: function (g, dt) {
      var s = g.s, two = seats(g, 2), b = s.ball;
      if (!b) return;
      var batH = g.H * 0.22, speedLimit = 900;

      two.forEach(function (p, i) {
        var want = (s.bat[p.pid] == null ? 0.5 : s.bat[p.pid]);
        var target = 40 + want * (g.H - 80 - batH) + batH / 2;
        var cur = p._y == null ? g.H / 2 : p._y;
        var d = target - cur;
        p._y = cur + Math.max(-speedLimit * dt, Math.min(speedLimit * dt, d));
        p._x = i === 0 ? 54 : g.W - 54;
      });

      /* One player? The board takes the other end, and it is beatable. */
      if (two.length === 1) {
        var ai = g.s.ai || (g.s.ai = { y: g.H / 2 });
        var aim = b.vx > 0 ? b.y : g.H / 2;
        ai.y += Math.max(-330 * dt, Math.min(330 * dt, aim - ai.y));
        s.aiY = ai.y;
      }

      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.y < 30) { b.y = 30; b.vy = Math.abs(b.vy); g.beep.play(420, 0.04); }
      if (b.y > g.H - 30) { b.y = g.H - 30; b.vy = -Math.abs(b.vy); g.beep.play(420, 0.04); }

      var self = this;
      function bounce(px, py, owner) {
        if (Math.abs(b.x - px) > 18) return false;
        if (Math.abs(b.y - py) > batH / 2 + b.r) return false;
        var off = (b.y - py) / (batH / 2);
        b.vx = -b.vx * 1.045;
        b.vy = off * 340 + b.vy * 0.35;
        b.x = px + (b.vx > 0 ? 20 : -20);
        b.hits++;
        s.spark = 0.16;
        g.beep.play(520 + b.hits * 14, 0.05);
        if (owner) owner.note = b.hits + " shot rally";
        return true;
      }

      if (b.vx < 0) {
        if (two[0]) bounce(two[0]._x, two[0]._y, two[0]);
        else if (s.aiY != null) bounce(54, s.aiY, null);
      } else {
        if (two[1]) bounce(two[1]._x, two[1]._y, two[1]);
        else if (s.aiY != null) bounce(g.W - 54, s.aiY, null);
      }

      if (b.x < -20 || b.x > g.W + 20) {
        var scorer = b.x < 0 ? two[1] : two[0];
        if (scorer) {
          scorer.score++;
          g.cue(scorer, "point");
          if (scorer.score >= 7) {
            return g.finish(scorer.name + " takes it", scorer.score + " — game.");
          }
        }
        g.beep.slide(300, 120, 0.2);
        this.serve(g, b.x < 0 ? -1 : 1);
      }
      if (s.spark > 0) s.spark -= dt;
    },

    draw: function (g) {
      var pen = g.pen, s = g.s, two = seats(g, 2);
      shade(pen, g);
      for (var y = 30; y < g.H - 20; y += 42) {
        pen.line(g.W / 2, y, g.W / 2, y + 22, FAINT, 2);
      }
      pen.ring(g.W / 2, g.H / 2, 70, FAINT, 2);

      var batH = g.H * 0.22;
      two.forEach(function (p) {
        if (p._y == null) return;
        pen.line(p._x, p._y - batH / 2, p._x, p._y + batH / 2, p.color, 13);
        pen.text(p.name.slice(0, 10), p._x, 26, 18, p.color);
        pen.text(String(p.score), p._x < g.W / 2 ? g.W / 2 - 60 : g.W / 2 + 60, 60, 44, p.color);
      });
      if (two.length === 1 && s.aiY != null) {
        var x = two[0]._x < g.W / 2 ? g.W - 54 : 54;
        pen.line(x, s.aiY - batH / 2, x, s.aiY + batH / 2, FAINT, 13);
        pen.text("the board", x, 26, 18, FAINT);
      }
      if (s.ball) {
        pen.disc(s.ball.x, s.ball.y, s.ball.r, DUST, 0.95);
        if (s.spark > 0) pen.dust(s.ball.x, s.ball.y, 8, DUST, 22, 2);
      }
      if (!g.players.length) banner(g, "Nobody is holding a phone", FAINT);
    }
  });

  /* ==================================================================
     5. Hoops — basketball shot
     ================================================================== */

  G.add({
    id: "hoops",
    name: "Hoops",
    tag: "Everyone at once",
    blurb: "One moving hoop, everybody shooting. Three points from behind the line.",
    how: "Drag back on your phone to aim and set the power, let go to shoot.",
    pad: "aim",
    min: 1, max: 8, secs: 60,

    setup: function (g) {
      g.s.balls = [];
      g.s.hoop = { x: g.W / 2, dir: 1, y: 150 };
      g.s.aim = {};
      g.s.flash = 0;
    },

    start: function (g) {
      g.setPad({ kind: "aim", label: "Pull back, let go" });
      g.s.balls = [];
      g.s.aim = {};
      g.players.forEach(function (p) { p.note = "0"; });
    },

    spot: function (g, p) {
      var n = Math.max(1, g.players.length);
      return 90 + (g.W - 180) * ((p.seat % n) + 0.5) / n;
    },

    input: function (g, p, k, v, x, y) {
      if (k === "aim") { g.s.aim[p.pid] = { x: x || 0, y: y || 0 }; return; }
      if (k !== "shoot") return;
      if (g.s.balls.some(function (b) { return b.pid === p.pid; })) return;
      var a = g.s.aim[p.pid] || { x: 0, y: -1 };
      var px = -(a.x || 0), py = -(a.y || 0);
      var mag = Math.min(1.15, Math.sqrt(px * px + py * py));
      if (mag < 0.12) return;
      var power = 700 + mag * 800;
      var len = Math.max(0.001, Math.sqrt(px * px + py * py));
      g.s.balls.push({
        pid: p.pid, color: p.color,
        x: this.spot(g, p), y: g.H - 70,
        vx: (px / len) * power, vy: (py / len) * power,
        r: 13, life: 6, scored: false, from: this.spot(g, p)
      });
      g.beep.play(300, 0.06);
      delete g.s.aim[p.pid];
    },

    step: function (g, dt) {
      var s = g.s;
      /* the hoop drifts, and drifts faster as the round runs down */
      var sp = (120 + g.t * 3) * dt * s.hoop.dir;
      s.hoop.x += sp;
      if (s.hoop.x < 200) { s.hoop.x = 200; s.hoop.dir = 1; }
      if (s.hoop.x > g.W - 200) { s.hoop.x = g.W - 200; s.hoop.dir = -1; }

      if (s.flash > 0) s.flash -= dt;

      s.balls.forEach(function (b) {
        var wasAbove = b.y < s.hoop.y;
        b.vy += 1300 * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        if (b.x < 14 || b.x > g.W - 14) { b.vx = -b.vx * 0.7; b.x = Math.max(14, Math.min(g.W - 14, b.x)); }
        if (!b.scored && wasAbove && b.y >= s.hoop.y && b.vy > 0 &&
            Math.abs(b.x - s.hoop.x) < 44) {
          b.scored = true;
          var p = g.byId[b.pid];
          if (p) {
            var three = Math.abs(b.from - s.hoop.x) > 300;
            p.score += three ? 3 : 2;
            p.note = three ? "three!" : "two";
            g.cue(p, "point");
          }
          s.flash = 0.5;
          g.beep.play(900, 0.09);
          setTimeout(function () { g.beep.play(1200, 0.1); }, 90);
        }
      });
      s.balls = s.balls.filter(function (b) { return b.life > 0 && b.y < g.H + 60; });
    },

    draw: function (g) {
      var pen = g.pen, s = g.s, floor = g.H - 46;
      shade(pen, g);
      pen.line(40, floor, g.W - 40, floor, FAINT, 3);

      /* three point line */
      pen.ring(s.hoop.x, floor, 300, FAINT, 2, Math.PI * 1.08, Math.PI * 1.92);

      /* backboard and hoop */
      pen.box(s.hoop.x - 70, s.hoop.y - 86, 140, 74, FAINT, 3);
      pen.line(s.hoop.x - 44, s.hoop.y, s.hoop.x + 44, s.hoop.y, "#d9a441", 5);
      for (var i = 0; i < 5; i++) {
        var x = s.hoop.x - 40 + i * 20;
        pen.line(x, s.hoop.y, s.hoop.x - 24 + i * 12, s.hoop.y + 34, "#d9a441", 2);
      }
      if (s.flash > 0) pen.dust(s.hoop.x, s.hoop.y + 20, 18, "#d9a441", 50, 3);

      var self = this;
      g.players.forEach(function (p) {
        var x = self.spot(g, p);
        figure(pen, x, floor, 66, p.color, "jump");
        pen.text(p.name.slice(0, 9), x, floor + 26, 16, p.color);
        var a = s.aim[p.pid];
        if (a) {
          var len = Math.min(1.1, Math.sqrt(a.x * a.x + a.y * a.y)) * 190;
          var ang = Math.atan2(-a.y, -a.x);
          pen.line(x, floor - 70,
                   x + Math.cos(ang) * len, floor - 70 + Math.sin(ang) * len, p.color, 3);
          pen.ring(x + Math.cos(ang) * len, floor - 70 + Math.sin(ang) * len, 7, p.color, 2);
        }
      });

      s.balls.forEach(function (b) {
        pen.ring(b.x, b.y, b.r, b.color, 3);
        pen.line(b.x - b.r, b.y, b.x + b.r, b.y, b.color, 1.5);
      });
    }
  });

  /* ==================================================================
     6. Bricks — one bat, everybody steering
     ================================================================== */

  G.add({
    id: "bricks",
    name: "Bricks",
    tag: "Together",
    blurb: "One bat, shared by the whole room. Whoever touched it last takes the point.",
    how: "Slide left and right. Yes, all of you, at the same time. Good luck.",
    pad: "slider",
    min: 1, max: 8, secs: 0,

    setup: function (g) {
      g.s.bricks = [];
      g.s.bat = g.W / 2;
      g.s.want = {};
      g.s.ball = null;
      g.s.lives = 3;
      g.s.level = 1;
      g.s.last = null;
    },

    build: function (g) {
      var rows = 3 + Math.min(3, g.s.level), cols = 12;
      var bw = (g.W - 120) / cols, bh = 26;
      g.s.bricks = [];
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          g.s.bricks.push({
            x: 60 + c * bw, y: 70 + r * (bh + 8), w: bw - 8, h: bh,
            color: G.ink[(r + 1) % G.ink.length], hp: r === 0 ? 2 : 1
          });
        }
      }
    },

    start: function (g) {
      g.setPad({ kind: "slider", axis: "x", label: "Slide to move the bat" });
      g.s.level = 1; g.s.lives = 3;
      this.build(g);
      this.launch(g);
    },

    launch: function (g) {
      g.s.ball = { x: g.W / 2, y: g.H - 140, vx: 240 * (Math.random() < 0.5 ? -1 : 1),
                   vy: -420, r: 10 };
      g.beep.play(600, 0.08);
    },

    input: function (g, p, k, v) {
      if (k !== "pos") return;
      g.s.want[p.pid] = Math.max(0, Math.min(1, v));
      g.s.last = p;
      p.note = "steering";
    },

    step: function (g, dt) {
      var s = g.s, batW = Math.max(90, 170 - s.level * 12), floor = g.H - 46;

      /* the bat goes where the room's thumbs average out */
      var sum = 0, n = 0;
      g.players.forEach(function (p) {
        if (s.want[p.pid] != null) { sum += s.want[p.pid]; n++; }
      });
      if (n) {
        var target = 60 + (sum / n) * (g.W - 120);
        s.bat += Math.max(-900 * dt, Math.min(900 * dt, target - s.bat));
      }

      var b = s.ball;
      if (!b) return;
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < 20) { b.x = 20; b.vx = Math.abs(b.vx); }
      if (b.x > g.W - 20) { b.x = g.W - 20; b.vx = -Math.abs(b.vx); }
      if (b.y < 40) { b.y = 40; b.vy = Math.abs(b.vy); }

      if (b.vy > 0 && b.y > floor - 26 && b.y < floor - 4 &&
          Math.abs(b.x - s.bat) < batW / 2 + b.r) {
        var off = (b.x - s.bat) / (batW / 2);
        b.vy = -Math.abs(b.vy) * 1.02;
        b.vx = off * 380 + b.vx * 0.3;
        g.beep.play(480, 0.05);
      }

      for (var i = 0; i < s.bricks.length; i++) {
        var k = s.bricks[i];
        if (b.x < k.x - b.r || b.x > k.x + k.w + b.r) continue;
        if (b.y < k.y - b.r || b.y > k.y + k.h + b.r) continue;
        var fromSide = b.x < k.x || b.x > k.x + k.w;
        if (fromSide) b.vx = -b.vx; else b.vy = -b.vy;
        k.hp--;
        g.beep.play(700 + k.hp * 120, 0.05);
        if (k.hp <= 0) {
          s.bricks.splice(i, 1);
          var who = s.last;
          if (who) { who.score += 1; g.cue(who, "point"); }
        }
        break;
      }

      if (!s.bricks.length) {
        s.level++;
        this.build(g);
        this.launch(g);
        g.say("Level " + s.level);
        return;
      }

      if (b.y > g.H + 30) {
        s.lives--;
        g.beep.slide(300, 90, 0.3);
        if (s.lives <= 0) {
          var board = g.players.slice().sort(function (a, c) { return c.score - a.score; });
          return g.finish("The ball got past you",
            board.length ? board[0].name + " broke the most" : "Level " + s.level);
        }
        g.say(s.lives + " ball" + (s.lives === 1 ? "" : "s") + " left");
        this.launch(g);
      }
    },

    draw: function (g) {
      var pen = g.pen, s = g.s, floor = g.H - 46;
      var batW = Math.max(90, 170 - s.level * 12);
      shade(pen, g);
      s.bricks.forEach(function (k) {
        pen.slab(k.x, k.y, k.w, k.h, k.color, k.hp > 1 ? 0.30 : 0.16);
        pen.box(k.x, k.y, k.w, k.h, k.color, 2);
      });
      pen.line(s.bat - batW / 2, floor - 12, s.bat + batW / 2, floor - 12, DUST, 12);
      if (s.ball) pen.disc(s.ball.x, s.ball.y, s.ball.r, DUST, 0.95);
      pen.text("level " + s.level, 60, 32, 18, FAINT, "left");
      pen.text("\u25CF ".repeat(Math.max(0, s.lives)), g.W - 60, 32, 18, DUST, "right");
    }
  });

  /* ==================================================================
     7. Chalk fight — two sabres, three heights
     ================================================================== */

  var ZONE_NAME = ["high", "middle", "low"];

  G.add({
    id: "duel",
    name: "Chalk fight",
    tag: "Two players",
    blurb: "Two sticks of chalk, drawn as light. Strike where they are not guarding.",
    how: "Tap a height to strike it. Hold a height to guard it. You cannot do both.",
    pad: "zones",
    min: 1, max: 8, secs: 0,

    setup: function (g) {
      g.s.f = {};
      g.s.spark = [];
      g.s.round = 1;
    },

    start: function (g) {
      g.setPad({ kind: "zones", keys: [
        { k: "z0", label: "High" }, { k: "z1", label: "Middle" }, { k: "z2", label: "Low" }
      ] });
      g.s.spark = [];
      g.s.round = 1;
      this.fresh(g);
    },

    fresh: function (g) {
      var two = seats(g, 2);
      g.s.f = {};
      two.forEach(function (p, i) {
        g.s.f[p.pid] = { hp: 100, guard: -1, energy: 100, swing: 0, zone: 1,
                         side: i === 0 ? -1 : 1, hurt: 0, parry: 0 };
      });
    },

    input: function (g, p, k, v) {
      var f = g.s.f[p.pid];
      if (!f) return;
      if (k === "grd") { f.guard = v >= 0 && v <= 2 ? v : -1; return; }
      if (k !== "atk") return;
      var zone = Math.max(0, Math.min(2, v | 0));
      if (f.swing > 0 || f.energy < 22) return;
      f.swing = 0.26;
      f.zone = zone;
      f.energy -= 22;
      g.beep.slide(700, 380, 0.18);

      var two = seats(g, 2);
      var other = two[0] === p ? two[1] : two[0];
      if (!other) return;
      var of = g.s.f[other.pid];
      if (!of) return;

      if (of.guard === zone) {
        of.parry = 0.3;
        f.swing = 0.45;
        f.energy = Math.max(0, f.energy - 10);
        g.s.spark.push({ x: g.W / 2, y: this.zoneY(g, zone), life: 0.4, color: "#d9a441" });
        g.beep.play(1400, 0.07);
        other.note = "parried " + ZONE_NAME[zone];
        return;
      }
      var dmg = of.guard >= 0 ? 9 : 16;      /* guarding the wrong height still helps */
      of.hp -= dmg;
      of.hurt = 0.3;
      g.cue(other, "hit");
      g.s.spark.push({ x: g.W / 2, y: this.zoneY(g, zone), life: 0.35, color: p.color });
      p.note = "hit " + ZONE_NAME[zone];
      if (of.hp <= 0) this.round(g, p, other);
    },

    round: function (g, winner, loser) {
      winner.score++;
      g.beep.play(880, 0.2);
      if (winner.score >= 3) {
        return g.finish(winner.name + " wins the duel", "Best of five, " +
          winner.score + " to " + loser.score + ".");
      }
      g.s.round++;
      g.say("Round " + g.s.round);
      this.fresh(g);
    },

    zoneY: function (g, z) {
      var base = g.H - 120;
      return base - [130, 80, 30][z];
    },

    step: function (g, dt) {
      var s = g.s;
      seats(g, 2);
      g.players.forEach(function (p) {
        var f = s.f[p.pid];
        if (!f) return;
        f.energy = Math.min(100, f.energy + 34 * dt);
        if (f.swing > 0) f.swing -= dt;
        if (f.hurt > 0) f.hurt -= dt;
        if (f.parry > 0) f.parry -= dt;
        /* Holding a guard costs a trickle, so nobody just stands there. */
        if (f.guard >= 0) f.energy = Math.max(0, f.energy - 8 * dt);
      });
      s.spark = s.spark.filter(function (k) { k.life -= dt; return k.life > 0; });
    },

    draw: function (g) {
      var pen = g.pen, s = g.s, two = seats(g, 2), self = this;
      shade(pen, g);
      var floor = g.H - 60;
      pen.line(60, floor, g.W - 60, floor, FAINT, 3);

      two.forEach(function (p, i) {
        var f = s.f[p.pid];
        if (!f) return;
        var x = i === 0 ? g.W * 0.30 : g.W * 0.70;
        var face = i === 0 ? 1 : -1;

        if (f.hurt > 0 && Math.floor(g.t * 20) % 2 === 0) g.ctx.globalAlpha = 0.4;
        figure(pen, x, floor, 150, p.color, "stand");
        g.ctx.globalAlpha = 1;

        /* the blade */
        var reach = f.swing > 0 ? 190 : 120;
        var zy = f.swing > 0 ? self.zoneY(g, f.zone)
               : f.guard >= 0 ? self.zoneY(g, f.guard) : floor - 150;
        var hx = x + face * 40, hy = floor - 80;
        pen.line(hx, hy, hx + face * reach, zy, p.color, 9);
        pen.line(hx, hy, hx + face * reach, zy, "#ffffff", 3);

        if (f.guard >= 0) {
          pen.text("guarding " + ZONE_NAME[f.guard], x, floor + 26, 17, p.color);
        }

        /* health and energy, drawn as chalk bars */
        var bx = i === 0 ? 60 : g.W - 360;
        pen.box(bx, 30, 300, 20, FAINT, 2);
        pen.slab(bx + 2, 32, Math.max(0, 296 * f.hp / 100), 16, p.color, 0.55);
        pen.slab(bx + 2, 56, Math.max(0, 296 * f.energy / 100), 7, "#d9a441", 0.5);
        pen.text(p.name.slice(0, 12), bx + 150, 78, 18, p.color);
      });

      /* the three heights, so nobody has to guess what the buttons mean */
      [0, 1, 2].forEach(function (z) {
        var y = self.zoneY(g, z);
        pen.line(g.W / 2 - 60, y, g.W / 2 + 60, y, FAINT, 1.5);
        pen.text(ZONE_NAME[z], g.W / 2, y - 12, 14, FAINT);
      });

      s.spark.forEach(function (k) {
        pen.dust(k.x, k.y, 14, k.color, 40, 3);
      });

      if (two.length < 2) {
        banner(g, two.length ? "Waiting for a second phone" : "Two phones needed", FAINT);
      }
      pen.text("round " + s.round, g.W / 2, g.H - 24, 18, FAINT);
    }
  });

})(window);
