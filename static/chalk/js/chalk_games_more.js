/* Chalk — Timeout: shooting, mazes and a world made of blocks.
 *
 * Invaders · Maze · Chalk world
 *
 * Two new controller shapes arrive with these. "padplus" is a direction pad
 * with action buttons beside it, for anything that has to move and do
 * something at the same time. Everything else is as before: the projector
 * simulates, the phones press buttons, nothing is written down.
 */
(function (global) {
  "use strict";

  var G = global.ChalkGames;
  if (!G) return;

  var DUST = "#e8eef4";
  var FAINT = "rgba(232,238,244,.30)";

  function frame(pen, g) { pen.box(14, 14, g.W - 28, g.H - 28, FAINT, 2); }

  /* Holds arrive as k:"left" v:1 / v:0, so a game can just read p.hold. */
  function held(p, k) { return p.hold && p.hold[k] === 1; }

  /* ==================================================================
     Invaders — everybody has a cannon
     ================================================================== */

  G.add({
    id: "invaders",
    name: "Invaders",
    tag: "Together",
    blurb: "Chalk things coming down the board and one cannon each. Shoot them before they land.",
    how: "Left and right to move, Fire to fire. They speed up as they thin out.",
    pad: "padplus",
    min: 1, max: 6, secs: 0,

    setup: function (g) {
      g.s.wave = 1;
      g.s.rows = [];
      g.s.shots = [];
      g.s.bombs = [];
      g.s.cannon = {};
      g.s.dir = 1;
      g.s.drop = 0;
      g.s.puff = [];
    },

    start: function (g) {
      var self = this;
      g.setPad({ kind: "padplus", axis: "x", keys: [{ k: "fire", label: "Fire" }] });
      g.s.wave = 1;
      this.wave(g);
      g.players.forEach(function (p) { self.join(g, p); });
    },

    wave: function (g) {
      var rows = [], r, c;
      for (r = 0; r < 4; r++) {
        for (c = 0; c < 9; c++) {
          rows.push({ x: 130 + c * 82, y: 90 + r * 62, r: r, alive: true });
        }
      }
      g.s.rows = rows;
      g.s.dir = 1;
      g.s.shots = [];
      g.s.bombs = [];
      g.say("Wave " + g.s.wave);
    },

    join: function (g, p) {
      g.s.cannon[p.pid] = { x: 120 + (p.seat % 6) * 130, cool: 0, lives: 3, hurt: 0 };
      p.note = "\u2665\u2665\u2665";
    },
    leave: function (g, p) { delete g.s.cannon[p.pid]; },

    input: function (g, p, k, v) {
      var c = g.s.cannon[p.pid];
      if (!c || p.out) return;
      if (k === "fire" && v === 1 && c.cool <= 0) {
        c.cool = 0.42;
        g.s.shots.push({ x: c.x, y: g.H - 96, pid: p.pid, color: p.color });
        g.beep.play(880, 0.05, "square", 0.07);
      }
    },

    step: function (g, dt) {
      var s = g.s, self = this, floor = g.H - 70;
      var alive = s.rows.filter(function (a) { return a.alive; });
      var speed = 26 + (36 - alive.length) * 2.2 + s.wave * 8;

      /* the shuffle: sideways until somebody touches the wall, then down */
      var edge = false;
      alive.forEach(function (a) {
        a.x += speed * dt * s.dir;
        if (a.x < 70 || a.x > g.W - 70) edge = true;
      });
      if (edge) {
        s.dir *= -1;
        alive.forEach(function (a) { a.y += 26; });
        g.beep.play(180, 0.06, "square", 0.05);
      }

      /* they shoot back, gently */
      if (alive.length && Math.random() < dt * (0.7 + s.wave * 0.25)) {
        var from = alive[Math.floor(Math.random() * alive.length)];
        s.bombs.push({ x: from.x, y: from.y + 20 });
      }

      s.shots.forEach(function (b) { b.y -= 620 * dt; });
      s.bombs.forEach(function (b) { b.y += (200 + s.wave * 20) * dt; });

      /* shots against invaders */
      s.shots.forEach(function (b) {
        if (b.dead) return;
        for (var i = 0; i < s.rows.length; i++) {
          var a = s.rows[i];
          if (!a.alive) continue;
          if (Math.abs(a.x - b.x) > 30 || Math.abs(a.y - b.y) > 22) continue;
          a.alive = false;
          b.dead = true;
          s.puff.push({ x: a.x, y: a.y, life: 0.5, color: b.color });
          var p = g.byId[b.pid];
          if (p) { p.score += (4 - a.r) * 5; g.cue(p, "point"); }
          g.beep.slide(700, 240, 0.12);
          break;
        }
      });
      s.shots = s.shots.filter(function (b) { return !b.dead && b.y > 40; });

      /* bombs against cannons */
      g.players.forEach(function (p) {
        var c = s.cannon[p.pid];
        if (!c || p.out) return;
        if (c.cool > 0) c.cool -= dt;
        if (c.hurt > 0) c.hurt -= dt;
        var move = (held(p, "right") ? 1 : 0) - (held(p, "left") ? 1 : 0);
        c.x = Math.max(60, Math.min(g.W - 60, c.x + move * 520 * dt));
        s.bombs.forEach(function (b) {
          if (b.dead || c.hurt > 0) return;
          if (Math.abs(b.x - c.x) > 26 || Math.abs(b.y - (floor - 20)) > 24) return;
          b.dead = true;
          c.lives--;
          c.hurt = 1.4;
          p.note = "\u2665".repeat(Math.max(0, c.lives)) || "out";
          g.cue(p, "hit");
          g.beep.slide(300, 90, 0.25);
          if (c.lives <= 0) { p.out = true; p.note = "cannon gone"; }
        });
      });
      s.bombs = s.bombs.filter(function (b) { return !b.dead && b.y < g.H - 40; });
      s.puff = s.puff.filter(function (k) { k.life -= dt; return k.life > 0; });

      if (!alive.length) { s.wave++; this.wave(g); return; }
      if (alive.some(function (a) { return a.y > floor - 60; })) {
        return g.finish("They landed", "Wave " + s.wave + ".");
      }
      if (g.players.length && !g.playing().length) {
        g.finish("All cannons gone", "Wave " + s.wave + ".");
      }
    },

    draw: function (g) {
      var pen = g.pen, s = g.s, floor = g.H - 70;
      frame(pen, g);
      pen.line(40, floor, g.W - 40, floor, FAINT, 3);

      s.rows.forEach(function (a) {
        if (!a.alive) return;
        var col = ["#b98cf0", "#56b7e6", "#4bbf7a", "#d9a441"][a.r];
        /* a squat chalk bug: body, two legs, two eyes */
        pen.box(a.x - 22, a.y - 14, 44, 28, col, 3);
        pen.line(a.x - 22, a.y + 14, a.x - 30, a.y + 24, col, 3);
        pen.line(a.x + 22, a.y + 14, a.x + 30, a.y + 24, col, 3);
        pen.disc(a.x - 8, a.y - 2, 3.5, col, 0.9);
        pen.disc(a.x + 8, a.y - 2, 3.5, col, 0.9);
      });

      s.shots.forEach(function (b) { pen.line(b.x, b.y, b.x, b.y + 16, b.color, 4); });
      s.bombs.forEach(function (b) { pen.line(b.x, b.y, b.x, b.y - 14, "#d9614a", 3); });
      s.puff.forEach(function (k) { pen.dust(k.x, k.y, 12, k.color, 34, 3); });

      g.players.forEach(function (p) {
        var c = s.cannon[p.pid];
        if (!c) return;
        if (p.out) { g.ctx.globalAlpha = 0.3; }
        else if (c.hurt > 0 && Math.floor(g.t * 16) % 2 === 0) { g.ctx.globalAlpha = 0.4; }
        pen.box(c.x - 26, floor - 22, 52, 22, p.color, 3);
        pen.line(c.x, floor - 22, c.x, floor - 40, p.color, 6);
        g.ctx.globalAlpha = 1;
        pen.text(p.name.slice(0, 9), c.x, floor + 22, 15, p.color);
      });
      pen.text("wave " + s.wave, g.W / 2, 40, 20, FAINT);
    }
  });

  /* ==================================================================
     Maze — set a direction and keep going
     ================================================================== */

  var MCOLS = 25, MROWS = 15;

  G.add({
    id: "maze",
    name: "Maze",
    tag: "Race",
    blurb: "A fresh maze every round. Pick up the dust on your way to the gap in the far wall.",
    how: "Tap a direction and you keep running until something stops you. Tap again to turn.",
    pad: "dpad",
    min: 1, max: 6, secs: 150,

    setup: function (g) {
      this.dig(g);
      g.s.who = {};
      g.s.dots = [];
      var i, c, r;
      for (i = 0; i < 24; i++) {
        c = 1 + Math.floor(Math.random() * (MCOLS - 2));
        r = 1 + Math.floor(Math.random() * (MROWS - 2));
        g.s.dots.push({ c: c, r: r });
      }
      g.s.exit = { c: MCOLS - 1, r: MROWS - 2 };
    },

    /* Recursive backtracker, on a grid where odd cells are corridors. */
    dig: function (g) {
      var w = MCOLS, h = MROWS, grid = [], x, y;
      for (y = 0; y < h; y++) {
        grid.push([]);
        for (x = 0; x < w; x++) grid[y].push(1);
      }
      var stack = [[1, 1]];
      grid[1][1] = 0;
      while (stack.length) {
        var cur = stack[stack.length - 1];
        var opts = [];
        [[2, 0], [-2, 0], [0, 2], [0, -2]].forEach(function (d) {
          var nx = cur[0] + d[0], ny = cur[1] + d[1];
          if (nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && grid[ny][nx] === 1) {
            opts.push([nx, ny, d]);
          }
        });
        if (!opts.length) { stack.pop(); continue; }
        var pick = opts[Math.floor(Math.random() * opts.length)];
        grid[cur[1] + pick[2][1] / 2][cur[0] + pick[2][0] / 2] = 0;
        grid[pick[1]][pick[0]] = 0;
        stack.push([pick[0], pick[1]]);
      }
      grid[MROWS - 2][MCOLS - 1] = 0;      /* the way out */
      g.s.grid = grid;
    },

    open: function (g, c, r) {
      if (r < 0 || r >= MROWS || c < 0 || c >= MCOLS) return false;
      return g.s.grid[r][c] === 0;
    },

    start: function (g) {
      var self = this;
      g.players.forEach(function (p) { self.join(g, p); });
    },

    join: function (g, p) {
      g.s.who[p.pid] = { c: 1, r: 1, x: 1, y: 1, dir: null, want: null, done: false };
      p.note = "";
    },
    leave: function (g, p) { delete g.s.who[p.pid]; },

    input: function (g, p, k, v) {
      if (k !== "dir") return;
      var w = g.s.who[p.pid];
      if (w && !w.done) w.want = v;
    },

    step: function (g, dt) {
      var s = g.s, self = this;
      var D = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
      g.players.forEach(function (p) {
        var w = s.who[p.pid];
        if (!w || w.done) return;
        var speed = 5.2;

        /* Turning is only allowed when lined up with a cell, which is what
         * makes tap-and-run feel fair rather than fiddly. */
        var atCell = Math.abs(w.x - w.c) < 0.08 && Math.abs(w.y - w.r) < 0.08;
        if (atCell) {
          w.x = w.c; w.y = w.r;
          if (w.want && D[w.want] &&
              self.open(g, w.c + D[w.want][0], w.r + D[w.want][1])) {
            w.dir = w.want;
            w.want = null;
          }
          if (w.dir && !self.open(g, w.c + D[w.dir][0], w.r + D[w.dir][1])) w.dir = null;
        }
        if (!w.dir) return;
        var d = D[w.dir];
        w.x += d[0] * speed * dt;
        w.y += d[1] * speed * dt;
        w.c = Math.round(w.x);
        w.r = Math.round(w.y);

        for (var i = s.dots.length - 1; i >= 0; i--) {
          if (Math.abs(s.dots[i].c - w.x) < 0.4 && Math.abs(s.dots[i].r - w.y) < 0.4) {
            s.dots.splice(i, 1);
            p.score += 1;
            g.beep.play(760, 0.04);
          }
        }
        if (w.c >= MCOLS - 1) {
          w.done = true;
          p.score += 20;
          p.note = "out!";
          g.cue(p, "point");
          g.beep.play(1000, 0.18);
          var left = g.players.filter(function (q) {
            return s.who[q.pid] && !s.who[q.pid].done;
          });
          if (!left.length) g.finish("Everybody found the way out");
          else if (g.players.length > 1 && left.length === g.players.length - 1) {
            g.say(p.name + " is out first");
          }
        }
      });
    },

    draw: function (g) {
      var pen = g.pen, s = g.s;
      var cell = Math.min((g.W - 80) / MCOLS, (g.H - 90) / MROWS);
      var ox = (g.W - cell * MCOLS) / 2, oy = (g.H - cell * MROWS) / 2 + 10;
      frame(pen, g);

      /* walls as short chalk dashes rather than a filled block: cheaper and
         it looks like it was drawn rather than printed */
      for (var r = 0; r < MROWS; r++) {
        for (var c = 0; c < MCOLS; c++) {
          if (s.grid[r][c] !== 1) continue;
          var x = ox + c * cell, y = oy + r * cell;
          pen.slab(x, y, cell, cell, DUST, 0.10);
          pen.line(x, y + cell, x + cell, y, FAINT, 1.5);
        }
      }
      pen.text("out", ox + MCOLS * cell + 4, oy + (MROWS - 2) * cell + cell / 2, 16, "#4bbf7a", "left");

      s.dots.forEach(function (d) {
        pen.disc(ox + d.c * cell + cell / 2, oy + d.r * cell + cell / 2, 3, DUST, 0.7);
      });

      g.players.forEach(function (p) {
        var w = s.who[p.pid];
        if (!w) return;
        var x = ox + w.x * cell + cell / 2, y = oy + w.y * cell + cell / 2;
        if (w.done) { g.ctx.globalAlpha = 0.4; }
        pen.disc(x, y, cell * 0.32, p.color, 0.9);
        pen.ring(x, y, cell * 0.42, p.color, 2);
        g.ctx.globalAlpha = 1;
      });
    }
  });

  /* ==================================================================
     Chalk world — dig, build, find the gold
     ================================================================== */

  var WCOLS = 60, WROWS = 26;
  var AIR = 0, DIRT = 1, STONE = 2, GOLD = 3, BUILT = 4;

  G.add({
    id: "world",
    name: "Chalk world",
    tag: "Together",
    blurb: "A world made of chalk blocks. Dig through it, build with what you dig, and find the gold seams.",
    how: "Move and jump with the pad. Dig the block you are facing, Build puts one back. Hold Down to dig your feet out.",
    pad: "padplus",
    min: 1, max: 6, secs: 210,

    setup: function (g) {
      var map = [], c, r;
      for (r = 0; r < WROWS; r++) { map.push([]); for (c = 0; c < WCOLS; c++) map[r].push(AIR); }
      /* a rolling surface, then dirt, then stone with gold seams in it */
      var h = [];
      for (c = 0; c < WCOLS; c++) {
        h.push(Math.round(9 + Math.sin(c * 0.22) * 2.2 + Math.sin(c * 0.07 + 1) * 2.6));
      }
      for (c = 0; c < WCOLS; c++) {
        for (r = 0; r < WROWS; r++) {
          if (r < h[c]) continue;
          map[r][c] = r < h[c] + 3 ? DIRT : STONE;
        }
      }
      for (var i = 0; i < 26; i++) {
        var gc = Math.floor(Math.random() * WCOLS);
        var gr = 14 + Math.floor(Math.random() * (WROWS - 15));
        for (var n = 0; n < 3 + Math.floor(Math.random() * 3); n++) {
          var x = Math.min(WCOLS - 1, Math.max(0, gc + Math.round(Math.random() * 2 - 1)));
          var y = Math.min(WROWS - 1, Math.max(12, gr + Math.round(Math.random() * 2 - 1)));
          if (map[y][x] === STONE) map[y][x] = GOLD;
        }
      }
      g.s.map = map;
      g.s.h = h;
      g.s.men = {};
      g.s.puff = [];
    },

    solid: function (g, c, r) {
      if (c < 0 || c >= WCOLS) return true;
      if (r < 0) return false;
      if (r >= WROWS) return true;
      return g.s.map[r][c] !== AIR;
    },

    start: function (g) {
      var self = this;
      g.setPad({ kind: "padplus", keys: [
        { k: "dig", label: "Dig" }, { k: "build", label: "Build" }
      ] });
      g.players.forEach(function (p) { self.join(g, p); });
    },

    join: function (g, p) {
      var c = 4 + (p.seat % 6) * 8;
      g.s.men[p.pid] = { x: c + 0.5, y: (g.s.h[c] || 9) - 2, vy: 0, face: 1,
                         bag: 6, gold: 0, cool: 0 };
      p.note = "6 blocks";
    },
    leave: function (g, p) { delete g.s.men[p.pid]; },

    input: function (g, p, k, v) {
      var m = g.s.men[p.pid];
      if (!m || v !== 1) return;
      var tc = Math.floor(m.x) + (held(p, "down") ? 0 : m.face);
      var tr = Math.floor(m.y) + (held(p, "down") ? 2 : (held(p, "up") ? 0 : 1));
      if (tc < 0 || tc >= WCOLS || tr < 0 || tr >= WROWS) return;

      if (k === "dig") {
        var block = g.s.map[tr][tc];
        if (block === AIR) return;
        g.s.map[tr][tc] = AIR;
        g.s.puff.push({ c: tc, r: tr, life: 0.4,
                        color: block === GOLD ? "#d9a441" : DUST });
        if (block === GOLD) {
          m.gold++;
          p.score += 5;
          g.cue(p, "point");
          g.beep.play(1050, 0.1);
        } else {
          m.bag = Math.min(40, m.bag + 1);
          g.beep.play(240 + block * 40, 0.05, "square", 0.05);
        }
        p.note = m.gold + " gold · " + m.bag + " blocks";
      } else if (k === "build") {
        if (m.bag <= 0 || g.s.map[tr][tc] !== AIR) return;
        /* Never brick yourself into the block you are standing in. */
        if (tc === Math.floor(m.x) && (tr === Math.floor(m.y) || tr === Math.floor(m.y) + 1)) return;
        g.s.map[tr][tc] = BUILT;
        m.bag--;
        p.score += 1;
        p.note = m.gold + " gold · " + m.bag + " blocks";
        g.beep.play(520, 0.05, "square", 0.05);
      }
    },

    step: function (g, dt) {
      var s = g.s, self = this;
      g.players.forEach(function (p) {
        var m = s.men[p.pid];
        if (!m) return;
        var move = (held(p, "right") ? 1 : 0) - (held(p, "left") ? 1 : 0);
        if (move) m.face = move;

        /* walk, with a step up over a single block */
        if (move) {
          var nx = m.x + move * 6.5 * dt;
          var col = Math.floor(nx + move * 0.3);
          var head = Math.floor(m.y), foot = Math.floor(m.y) + 1;
          if (!self.solid(g, col, head) && !self.solid(g, col, foot)) m.x = nx;
          else if (!self.solid(g, col, head - 1) && !self.solid(g, col, foot - 1) &&
                   Math.abs(m.vy) < 0.01) { m.y -= 1; m.x = nx; }
        }
        m.x = Math.max(0.5, Math.min(WCOLS - 0.5, m.x));

        var onGround = self.solid(g, Math.floor(m.x), Math.floor(m.y) + 2) &&
                       Math.abs(m.y - Math.round(m.y)) < 0.06;
        if (held(p, "up") && onGround) { m.vy = -9.6; }

        m.vy += 26 * dt;
        var ny = m.y + m.vy * dt;
        if (m.vy > 0) {
          if (self.solid(g, Math.floor(m.x), Math.floor(ny) + 2)) {
            ny = Math.floor(ny + 2) - 2;
            m.vy = 0;
          }
        } else if (m.vy < 0) {
          if (self.solid(g, Math.floor(m.x), Math.floor(ny))) {
            ny = Math.floor(ny) + 1;
            m.vy = 0;
          }
        }
        m.y = Math.max(0, Math.min(WROWS - 2, ny));
      });
      s.puff = s.puff.filter(function (k) { k.life -= dt; return k.life > 0; });
    },

    draw: function (g) {
      var pen = g.pen, s = g.s;
      var cell = Math.min((g.W - 40) / WCOLS, (g.H - 70) / WROWS);
      var ox = (g.W - cell * WCOLS) / 2, oy = (g.H - cell * WROWS) / 2 + 8;
      var ctx = g.ctx;

      /* the ground, in three flat washes plus a scratched top edge */
      for (var r = 0; r < WROWS; r++) {
        for (var c = 0; c < WCOLS; c++) {
          var b = s.map[r][c];
          if (b === AIR) continue;
          var x = ox + c * cell, y = oy + r * cell;
          if (b === DIRT) { ctx.globalAlpha = 0.18; ctx.fillStyle = "#d9a441"; }
          else if (b === STONE) { ctx.globalAlpha = 0.13; ctx.fillStyle = DUST; }
          else if (b === GOLD) { ctx.globalAlpha = 0.5; ctx.fillStyle = "#d9a441"; }
          else { ctx.globalAlpha = 0.3; ctx.fillStyle = "#56b7e6"; }
          ctx.fillRect(x, y, cell + 0.5, cell + 0.5);
          ctx.globalAlpha = 1;
          if (b === GOLD) {
            pen.line(x + 3, y + cell - 3, x + cell - 3, y + 3, "#d9a441", 2);
          }
          if (r > 0 && s.map[r - 1][c] === AIR) {
            pen.line(x, y, x + cell, y, b === GOLD ? "#d9a441" : DUST, 1.5);
          }
        }
      }

      s.puff.forEach(function (k) {
        pen.dust(ox + k.c * cell + cell / 2, oy + k.r * cell + cell / 2, 10, k.color, cell, 2.5);
      });

      g.players.forEach(function (p) {
        var m = s.men[p.pid];
        if (!m) return;
        var x = ox + m.x * cell, y = oy + m.y * cell;
        pen.slab(x - cell * 0.34, y, cell * 0.68, cell * 1.9, p.color, 0.5);
        pen.box(x - cell * 0.34, y, cell * 0.68, cell * 1.9, p.color, 2);
        /* which way they are facing, so Dig is not a guess */
        pen.line(x + m.face * cell * 0.34, y + cell * 0.9,
                 x + m.face * cell * 0.95, y + cell * 0.9, p.color, 2.5);
        pen.text(p.name.slice(0, 8), x, y - 10, 13, p.color);
      });

      pen.text("gold is worth five · dug blocks go in your bag",
               g.W / 2, g.H - 16, 16, FAINT);
    }
  });

})(window);
