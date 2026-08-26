/* Chalk — Timeout: the quiet end of the box.
 *
 * Slide · Scramble · Four in a row · Chess
 *
 * These are the games you can leave on the board while a class thinks. Two
 * more controller shapes come with them: "grid", a board small enough to tap
 * on a phone, and "word", which is a box to type into. Both are sent by the
 * projector and rebuilt on every phone whenever the position changes.
 */
(function (global) {
  "use strict";

  var G = global.ChalkGames;
  if (!G) return;

  var DUST = "#e8eef4";
  var FAINT = "rgba(232,238,244,.30)";
  var GOLD = "#d9a441";
  var MINT = "#4bbf7a";

  function frame(pen, g) { pen.box(14, 14, g.W - 28, g.H - 28, FAINT, 2); }

  function seats(g, n) {
    var out = [], i;
    for (i = 0; i < g.players.length && out.length < n; i++) out.push(g.players[i]);
    for (i = 0; i < g.players.length; i++) {
      if (out.indexOf(g.players[i]) < 0) g.players[i].note = "next up";
    }
    return out;
  }

  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ==================================================================
     Slide — one puzzle, every thumb in the room
     ================================================================== */

  G.add({
    id: "slide",
    name: "Slide",
    tag: "Together",
    blurb: "The old fifteen puzzle, on the wall, with the whole class allowed to touch it.",
    how: "Tap a tile next to the gap and it slides. Points go to whoever puts a tile home.",
    pad: "grid",
    min: 1, max: 40, secs: 0,

    setup: function (g) {
      var t = [], i;
      for (i = 1; i < 16; i++) t.push(i);
      t.push(0);
      g.s.t = t;
      g.s.moves = 0;
      g.s.flash = -1;
    },

    start: function (g) {
      /* Shuffle by playing it backwards, which is the only way to be sure
       * the thing can be solved at all. */
      var i, k;
      for (i = 0; i < 260; i++) {
        var gap = g.s.t.indexOf(0);
        var opts = this.near(gap);
        k = opts[Math.floor(Math.random() * opts.length)];
        g.s.t[gap] = g.s.t[k];
        g.s.t[k] = 0;
      }
      g.s.moves = 0;
      this.pad(g);
    },

    near: function (i) {
      var r = i >> 2, c = i & 3, out = [];
      if (r > 0) out.push(i - 4);
      if (r < 3) out.push(i + 4);
      if (c > 0) out.push(i - 1);
      if (c < 3) out.push(i + 1);
      return out;
    },

    pad: function (g) {
      g.setPad({
        kind: "grid", cols: 4, rows: 4,
        cells: g.s.t.map(function (v) { return v ? String(v) : ""; })
      });
    },

    input: function (g, p, k, v) {
      if (k !== "cell") return;
      var i = v | 0, gap = g.s.t.indexOf(0);
      if (this.near(i).indexOf(gap) < 0) return;
      var val = g.s.t[i];
      var wasHome = val === i + 1;
      g.s.t[gap] = val;
      g.s.t[i] = 0;
      g.s.moves++;
      g.s.flash = gap;
      var isHome = val === gap + 1;
      if (isHome && !wasHome) { p.score += 3; g.cue(p, "point"); g.beep.play(900, 0.06); }
      else if (wasHome && !isHome) { p.score = Math.max(0, p.score - 1); g.beep.play(300, 0.05); }
      else g.beep.play(520, 0.04);
      p.note = "moved " + val;
      this.pad(g);

      var done = g.s.t.every(function (x, j) { return x === (j + 1) % 16; });
      if (done) {
        var board = g.players.slice().sort(function (a, b) { return b.score - a.score; });
        g.finish("Solved in " + g.s.moves + " moves",
                 board.length ? board[0].name + " placed the most" : "");
      }
    },

    draw: function (g) {
      var pen = g.pen, s = g.s;
      frame(pen, g);
      var cell = Math.min((g.W - 460) / 4, (g.H - 120) / 4);
      var ox = (g.W - cell * 4) / 2, oy = (g.H - cell * 4) / 2 + 10;
      for (var i = 0; i < 16; i++) {
        var x = ox + (i & 3) * cell, y = oy + (i >> 2) * cell;
        var v = s.t[i];
        if (!v) continue;
        var home = v === i + 1;
        pen.slab(x + 4, y + 4, cell - 8, cell - 8, home ? MINT : DUST, home ? 0.20 : 0.07);
        pen.box(x + 4, y + 4, cell - 8, cell - 8, home ? MINT : DUST, 3);
        pen.text(String(v), x + cell / 2, y + cell / 2, cell * 0.42, home ? MINT : DUST);
      }
      pen.text(s.moves + " moves", g.W / 2, oy - 26, 22, FAINT);
    }
  });

  /* ==================================================================
     Scramble — the letters are all there
     ================================================================== */

  var WORDS = ("pencil teacher orange garden island market silver school monkey " +
    "window planet friend candle rocket basket dragon jungle yellow mirror puzzle " +
    "guitar lizard camera bridge forest peanut kitchen lantern dolphin village " +
    "morning picture rainbow library blanket journey compass harvest kingdom " +
    "diamond thunder holiday").split(" ");

  G.add({
    id: "scramble",
    name: "Scramble",
    tag: "Whole class",
    blurb: "One word, letters shaken up. Type it before anybody else does.",
    how: "Type your answer and send it. Wrong guesses cost nothing but time.",
    pad: "word",
    min: 1, max: 40, secs: 0,

    setup: function (g) {
      g.s.words = shuffle(WORDS).slice(0, 8);
      g.s.i = -1;
      g.s.limit = 28;
      g.s.left = 0;
      g.s.reveal = 0;
      g.s.got = [];
      g.s.mixed = "";
    },

    start: function (g) { this.next(g); },

    next: function (g) {
      var s = g.s;
      s.i++;
      if (s.i >= s.words.length) {
        var board = g.players.slice().sort(function (a, b) { return b.score - a.score; });
        return g.finish(board.length ? board[0].name + " unscrambles fastest" : "That is the lot",
                        board.length ? board[0].score + " points" : "");
      }
      var w = s.words[s.i], mixed = w;
      var tries = 0;
      while (mixed === w && tries++ < 20) mixed = shuffle(w.split("")).join("");
      s.mixed = mixed.toUpperCase();
      s.left = s.limit;
      s.reveal = 0;
      s.got = [];
      g.players.forEach(function (p) { p.note = ""; });
      g.setPad({ kind: "word", label: s.mixed, hint: w.length + " letters" });
      g.beep.play(520, 0.08);
    },

    input: function (g, p, k, v) {
      var s = g.s;
      if (k !== "word" || s.reveal > 0) return;
      var guess = String(v || "").trim().toLowerCase();
      if (!guess) return;
      if (guess !== s.words[s.i]) {
        p.note = "not " + guess;
        g.beep.play(220, 0.06);
        g.cue(p, "hit");
        return;
      }
      if (s.got.indexOf(p.pid) >= 0) return;
      s.got.push(p.pid);
      var place = s.got.length;
      p.score += place === 1 ? 100 : Math.max(30, 90 - place * 15);
      p.note = place === 1 ? "first!" : "#" + place;
      g.cue(p, "point");
      g.beep.play(place === 1 ? 1050 : 780, 0.1);
      if (place === 1) g.say(p.name + " got it");
      if (s.got.length >= g.players.length) s.left = Math.min(s.left, 2);
    },

    step: function (g, dt) {
      var s = g.s;
      if (s.reveal > 0) {
        s.reveal -= dt;
        if (s.reveal <= 0) this.next(g);
        return;
      }
      s.left -= dt;
      if (s.left <= 0) {
        s.reveal = 3.4;
        g.players.forEach(function (p) {
          if (s.got.indexOf(p.pid) < 0) p.note = "missed it";
        });
      }
    },

    draw: function (g) {
      var pen = g.pen, s = g.s;
      frame(pen, g);
      pen.text("word " + (s.i + 1) + " of " + s.words.length, g.W / 2, 50, 20, FAINT);

      var word = s.reveal > 0 ? s.words[s.i].toUpperCase() : s.mixed;
      var size = Math.min(120, (g.W - 200) / Math.max(6, word.length) * 1.5);
      var step = size * 0.86;
      var x0 = g.W / 2 - (word.length - 1) * step / 2;
      for (var i = 0; i < word.length; i++) {
        var x = x0 + i * step;
        var lift = s.reveal > 0 ? 0 : Math.sin(g.t * 2 + i) * 6;
        pen.box(x - step * 0.42, g.H / 2 - size * 0.6 + lift,
                step * 0.84, size * 1.2, s.reveal > 0 ? MINT : FAINT, 2);
        pen.text(word[i], x, g.H / 2 + lift, size, s.reveal > 0 ? MINT : DUST);
      }

      if (s.reveal > 0) {
        pen.text(s.got.length + " of " + g.players.length + " got it",
                 g.W / 2, g.H - 60, 24, FAINT);
      } else {
        var w = (g.W - 160) * Math.max(0, s.left / s.limit);
        pen.slab(80, g.H - 46, w, 10, s.left < 6 ? "#d9614a" : GOLD, 0.6);
        pen.text(s.got.length ? s.got.length + " in" : "nobody yet",
                 g.W / 2, g.H - 66, 20, FAINT);
      }
    }
  });

  /* ==================================================================
     Four in a row — two sides, and the side votes
     ================================================================== */

  var COLS = 7, ROWS = 6;

  G.add({
    id: "four",
    name: "Four in a row",
    tag: "Two teams",
    blurb: "Left against right, and each side votes for the column it wants. Loudest column wins the turn.",
    how: "Tap any square in the column you want. The most-voted column drops.",
    pad: "grid",
    min: 2, max: 40, secs: 0,

    setup: function (g) {
      g.s.b = [];
      for (var i = 0; i < COLS * ROWS; i++) g.s.b.push(0);
      g.s.turn = 1;
      g.s.votes = {};
      g.s.clock = 7;
      g.s.win = null;
      g.s.drop = null;
    },

    start: function (g) {
      g.players.forEach(function (p, i) {
        p.team = i % 2;
        p.note = p.team ? "right" : "left";
      });
      this.pad(g);
    },

    join: function (g, p) {
      p.team = g.players.length % 2;
      p.note = p.team ? "right" : "left";
    },

    pad: function (g) {
      g.setPad({
        kind: "grid", cols: COLS, rows: ROWS,
        cells: g.s.b.map(function (v) {
          return v === 1 ? "\u25CF" : v === 2 ? "\u25CB" : "";
        }),
        label: (g.s.turn === 1 ? "Left" : "Right") + " to play"
      });
    },

    input: function (g, p, k, v) {
      if (k !== "cell" || g.s.win) return;
      var team = g.s.turn === 1 ? 0 : 1;
      if (p.team !== team) { p.note = "not your turn"; return; }
      var col = (v | 0) % COLS;
      if (g.s.b[col] !== 0) return;                 /* column already full */
      g.s.votes[p.pid] = col;
      p.note = "voted " + (col + 1);
      g.beep.play(500 + col * 40, 0.04);
      var side = g.players.filter(function (q) { return q.team === team; });
      var voted = side.filter(function (q) { return g.s.votes[q.pid] != null; });
      if (side.length && voted.length >= side.length) g.s.clock = Math.min(g.s.clock, 1.2);
    },

    step: function (g, dt) {
      var s = g.s;
      if (s.win) return;
      if (s.drop) {
        s.drop.y += dt * 22;
        if (s.drop.y >= s.drop.to) { this.land(g); }
        return;
      }
      s.clock -= dt;
      if (s.clock > 0) return;

      /* count the votes */
      var tally = [], i;
      for (i = 0; i < COLS; i++) tally.push(0);
      Object.keys(s.votes).forEach(function (pid) { tally[s.votes[pid]]++; });
      var best = -1, bestN = 0;
      for (i = 0; i < COLS; i++) {
        if (s.b[i] !== 0) continue;
        if (tally[i] > bestN || (tally[i] === bestN && Math.random() < 0.4)) {
          best = i; bestN = tally[i];
        }
      }
      if (best < 0) return g.finish("Full board", "Nobody got four.");
      if (!bestN) g.say("No votes — the chalk chose column " + (best + 1));

      var row = -1;
      for (i = ROWS - 1; i >= 0; i--) { if (s.b[i * COLS + best] === 0) { row = i; break; } }
      if (row < 0) { s.clock = 5; return; }
      s.drop = { col: best, to: row, y: -1, who: s.turn };
      g.beep.slide(600, 300, 0.25);
    },

    land: function (g) {
      var s = g.s, d = s.drop;
      s.b[d.to * COLS + d.col] = d.who;
      s.drop = null;
      s.votes = {};
      s.clock = 7;
      g.beep.play(360, 0.08);

      var line = this.four(s.b, d.to, d.col, d.who);
      if (line) {
        s.win = { who: d.who, line: line };
        var team = d.who === 1 ? 0 : 1;
        g.players.forEach(function (p) { if (p.team === team) p.score += 10; });
        this.pad(g);
        return g.finish((d.who === 1 ? "Left" : "Right") + " side gets four",
                        "Voted for by committee.");
      }
      if (s.b.every(function (v) { return v !== 0; })) {
        return g.finish("Full board", "A draw, and a lot of arguing.");
      }
      s.turn = s.turn === 1 ? 2 : 1;
      this.pad(g);
    },

    four: function (b, r, c, who) {
      var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
      for (var d = 0; d < dirs.length; d++) {
        var line = [r * COLS + c], i, rr, cc;
        for (var s = -1; s <= 1; s += 2) {
          for (i = 1; i < 4; i++) {
            rr = r + dirs[d][0] * i * s; cc = c + dirs[d][1] * i * s;
            if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) break;
            if (b[rr * COLS + cc] !== who) break;
            line.push(rr * COLS + cc);
          }
        }
        if (line.length >= 4) return line;
      }
      return null;
    },

    draw: function (g) {
      var pen = g.pen, s = g.s;
      frame(pen, g);
      var cell = Math.min((g.W - 420) / COLS, (g.H - 130) / ROWS);
      var ox = (g.W - cell * COLS) / 2, oy = (g.H - cell * ROWS) / 2 + 16;

      pen.box(ox - 8, oy - 8, cell * COLS + 16, cell * ROWS + 16, FAINT, 3);
      for (var i = 0; i < COLS * ROWS; i++) {
        var x = ox + (i % COLS) * cell + cell / 2, y = oy + Math.floor(i / COLS) * cell + cell / 2;
        var v = s.b[i];
        var lit = s.win && s.win.line.indexOf(i) >= 0;
        if (!v) { pen.ring(x, y, cell * 0.34, FAINT, 2); continue; }
        var col = v === 1 ? "#56b7e6" : GOLD;
        pen.disc(x, y, cell * 0.34, col, lit ? 0.95 : 0.45);
        pen.ring(x, y, cell * 0.34, col, lit ? 5 : 2);
      }

      if (s.drop) {
        var dx = ox + s.drop.col * cell + cell / 2;
        var dy = oy + Math.max(-0.6, s.drop.y) * cell + cell / 2;
        pen.disc(dx, dy, cell * 0.34, s.drop.who === 1 ? "#56b7e6" : GOLD, 0.8);
      }

      /* the vote, as a little chalk tally under each column */
      if (!s.win && !s.drop) {
        var tally = [], k;
        for (k = 0; k < COLS; k++) tally.push(0);
        Object.keys(s.votes).forEach(function (pid) { tally[s.votes[pid]]++; });
        for (k = 0; k < COLS; k++) {
          var tx = ox + k * cell + cell / 2;
          pen.text(String(k + 1), tx, oy + ROWS * cell + 26, 18, FAINT);
          if (tally[k]) {
            pen.text("|".repeat(Math.min(9, tally[k])), tx, oy + ROWS * cell + 50, 20,
                     s.turn === 1 ? "#56b7e6" : GOLD);
          }
        }
        pen.text((s.turn === 1 ? "Left" : "Right") + " side votes — " +
                 Math.ceil(s.clock) + "s", g.W / 2, oy - 30, 24,
                 s.turn === 1 ? "#56b7e6" : GOLD);
      }
    }
  });

  /* ==================================================================
     Chess — a real one, rules and all
     ================================================================== */

  var GLYPH = {
    K: "\u2654", Q: "\u2655", R: "\u2656", B: "\u2657", N: "\u2658", P: "\u2659",
    k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F"
  };

  function white(p) { return !!p && p === p.toUpperCase(); }
  function mine(p, w) { return !!p && white(p) === w; }

  function attacked(bd, sq, byW) {
    var r = sq >> 3, c = sq & 7;
    function at(rr, cc) {
      if (rr < 0 || rr > 7 || cc < 0 || cc > 7) return null;
      return bd[rr * 8 + cc] || "";
    }
    /* pawns sit one rank towards their own side */
    var pd = byW ? 1 : -1, pawn = byW ? "P" : "p";
    if (at(r + pd, c - 1) === pawn || at(r + pd, c + 1) === pawn) return true;

    var n = byW ? "N" : "n", k = byW ? "K" : "k";
    var jumps = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
    for (var i = 0; i < jumps.length; i++) {
      if (at(r + jumps[i][0], c + jumps[i][1]) === n) return true;
    }
    var around = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    for (i = 0; i < around.length; i++) {
      if (at(r + around[i][0], c + around[i][1]) === k) return true;
    }
    var lines = [
      [[1, 0], [-1, 0], [0, 1], [0, -1]], byW ? "RQ" : "rq",
      [[1, 1], [1, -1], [-1, 1], [-1, -1]], byW ? "BQ" : "bq"
    ];
    for (var set = 0; set < 2; set++) {
      var dirs = lines[set * 2], who = lines[set * 2 + 1];
      for (i = 0; i < dirs.length; i++) {
        var rr = r + dirs[i][0], cc = c + dirs[i][1];
        while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
          var q = bd[rr * 8 + cc];
          if (q) { if (who.indexOf(q) >= 0) return true; break; }
          rr += dirs[i][0]; cc += dirs[i][1];
        }
      }
    }
    return false;
  }

  function pseudo(bd, i, st) {
    var p = bd[i];
    if (!p) return [];
    var w = white(p), r = i >> 3, c = i & 7, t = p.toLowerCase(), out = [];
    function step(rr, cc) {
      if (rr < 0 || rr > 7 || cc < 0 || cc > 7) return false;
      var j = rr * 8 + cc, q = bd[j];
      if (!q) { out.push(j); return true; }
      if (white(q) !== w) out.push(j);
      return false;
    }
    if (t === "p") {
      var d = w ? -1 : 1, home = w ? 6 : 1;
      if (!bd[(r + d) * 8 + c]) {
        out.push((r + d) * 8 + c);
        if (r === home && !bd[(r + 2 * d) * 8 + c]) out.push((r + 2 * d) * 8 + c);
      }
      [-1, 1].forEach(function (dc) {
        var cc = c + dc, rr = r + d;
        if (cc < 0 || cc > 7 || rr < 0 || rr > 7) return;
        var j = rr * 8 + cc, q = bd[j];
        if ((q && white(q) !== w) || j === st.ep) out.push(j);
      });
    } else if (t === "n") {
      [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]
        .forEach(function (d2) { step(r + d2[0], c + d2[1]); });
    } else if (t === "k") {
      [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]
        .forEach(function (d2) { step(r + d2[0], c + d2[1]); });
      /* castling: rights, empty in between, and not through an attack */
      var back = w ? 7 : 0;
      if (r === back && c === 4 && !attacked(bd, i, !w)) {
        if (st.castle.indexOf(w ? "K" : "k") >= 0 &&
            !bd[back * 8 + 5] && !bd[back * 8 + 6] &&
            !attacked(bd, back * 8 + 5, !w) && !attacked(bd, back * 8 + 6, !w)) {
          out.push(back * 8 + 6);
        }
        if (st.castle.indexOf(w ? "Q" : "q") >= 0 &&
            !bd[back * 8 + 3] && !bd[back * 8 + 2] && !bd[back * 8 + 1] &&
            !attacked(bd, back * 8 + 3, !w) && !attacked(bd, back * 8 + 2, !w)) {
          out.push(back * 8 + 2);
        }
      }
    } else {
      var dirs = t === "r" ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
               : t === "b" ? [[1, 1], [1, -1], [-1, 1], [-1, -1]]
               : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
      dirs.forEach(function (d2) {
        var rr = r + d2[0], cc = c + d2[1];
        while (step(rr, cc)) { rr += d2[0]; cc += d2[1]; }
      });
    }
    return out;
  }

  /* Play the move on a copy and see whether the king is left standing in
   * front of a bus. This is the only legality test there is. */
  function safe(bd, from, to, st) {
    var copy = bd.slice(), p = copy[from], w = white(p);
    copy[to] = p;
    copy[from] = "";
    if (p.toLowerCase() === "p" && to === st.ep && ((from & 7) !== (to & 7))) {
      copy[(from >> 3) * 8 + (to & 7)] = "";
    }
    if (p.toLowerCase() === "k" && Math.abs((from & 7) - (to & 7)) === 2) {
      var back = from >> 3;
      if ((to & 7) === 6) { copy[back * 8 + 5] = copy[back * 8 + 7]; copy[back * 8 + 7] = ""; }
      else { copy[back * 8 + 3] = copy[back * 8 + 0]; copy[back * 8 + 0] = ""; }
    }
    var king = copy.indexOf(w ? "K" : "k");
    return king < 0 || !attacked(copy, king, !w);
  }

  function legal(bd, i, st) {
    return pseudo(bd, i, st).filter(function (to) { return safe(bd, i, to, st); });
  }

  function anyMove(bd, st, w) {
    for (var i = 0; i < 64; i++) {
      if (mine(bd[i], w) && legal(bd, i, st).length) return true;
    }
    return false;
  }

  /* Making a move, as a pure function: hand it a position, get a new one
   * back. The game uses it, and so does the test that counts every legal
   * move in the first four ply and checks the total against the numbers
   * chess programmers have agreed on since the 1990s. */
  function applyMove(bd, st, from, to) {
    var b = bd.slice(), piece = b[from], w = white(piece), grab = b[to];
    var t = piece.toLowerCase();

    if (t === "p" && to === st.ep && (from & 7) !== (to & 7)) {
      var gone = (from >> 3) * 8 + (to & 7);
      grab = b[gone];
      b[gone] = "";
    }
    if (t === "k" && Math.abs((from & 7) - (to & 7)) === 2) {
      var back = from >> 3;
      if ((to & 7) === 6) { b[back * 8 + 5] = b[back * 8 + 7]; b[back * 8 + 7] = ""; }
      else { b[back * 8 + 3] = b[back * 8 + 0]; b[back * 8 + 0] = ""; }
    }
    b[to] = piece;
    b[from] = "";
    /* Promotion is always a queen. A phone is no place to hold a menu of
     * four pieces open while thirty people watch. */
    if (t === "p" && (to < 8 || to > 55)) b[to] = w ? "Q" : "q";

    var castle = st.castle;
    if (piece === "K") castle = castle.replace(/[KQ]/g, "");
    if (piece === "k") castle = castle.replace(/[kq]/g, "");
    [[63, "K"], [56, "Q"], [7, "k"], [0, "q"]].forEach(function (rk) {
      if (from === rk[0] || to === rk[0]) castle = castle.replace(rk[1], "");
    });

    return {
      bd: b,
      st: {
        castle: castle,
        ep: (t === "p" && Math.abs((from >> 3) - (to >> 3)) === 2)
          ? (from + to) / 2 : -1
      },
      grab: grab
    };
  }

  G.add({
    id: "chess",
    rules: { legal: legal, apply: applyMove, anyMove: anyMove, attacked: attacked },
    name: "Chess",
    tag: "Two players",
    blurb: "A full game on the wall, played from two phones. Castling, en passant, the lot.",
    how: "Tap your piece, then tap where it goes. Only legal moves will land. Pawns become queens.",
    pad: "grid",
    min: 1, max: 8, secs: 0,

    setup: function (g) {
      var back = "rnbqkbnr".split("");
      var bd = [], i;
      for (i = 0; i < 64; i++) bd.push("");
      for (i = 0; i < 8; i++) {
        bd[i] = back[i];
        bd[8 + i] = "p";
        bd[48 + i] = "P";
        bd[56 + i] = back[i].toUpperCase();
      }
      g.s.bd = bd;
      g.s.st = { ep: -1, castle: "KQkq" };
      g.s.turn = true;                    /* true = white */
      g.s.sel = -1;
      g.s.moves = [];
      g.s.last = null;
      g.s.check = false;
      g.s.taken = [];
    },

    start: function (g) {
      seats(g, 2).forEach(function (p, i) {
        p.note = i === 0 ? "white" : "black";
      });
      this.pad(g);
    },

    pad: function (g) {
      var s = g.s;
      g.setPad({
        kind: "grid", cols: 8, rows: 8,
        cells: s.bd.map(function (p) { return p ? GLYPH[p] : ""; }),
        hi: s.moves.concat(s.sel >= 0 ? [s.sel] : []),
        label: (s.turn ? "White" : "Black") + " to play" + (s.check ? " — check" : "")
      });
    },

    input: function (g, p, k, v) {
      var s = g.s, two = seats(g, 2);
      if (k !== "cell") return;
      var seat = two.indexOf(p);
      if (seat < 0) { p.note = "watching"; return; }
      var isWhite = seat === 0;
      if (isWhite !== s.turn) { p.note = "not your turn"; return; }

      var i = v | 0;
      if (s.sel >= 0 && s.moves.indexOf(i) >= 0) return this.move(g, p, s.sel, i);
      if (mine(s.bd[i], isWhite)) {
        s.sel = i;
        s.moves = legal(s.bd, i, s.st);
        p.note = s.moves.length ? s.moves.length + " squares" : "that one is stuck";
        g.beep.play(600, 0.04);
      } else {
        s.sel = -1;
        s.moves = [];
      }
      this.pad(g);
    },

    move: function (g, p, from, to) {
      var s = g.s;
      var done = applyMove(s.bd, s.st, from, to);
      s.bd = done.bd;
      s.st = done.st;

      if (done.grab) {
        s.taken.push(done.grab);
        p.score += { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }[done.grab.toLowerCase()] || 0;
        g.beep.slide(500, 260, 0.14);
      } else {
        g.beep.play(420, 0.05);
      }

      s.last = { from: from, to: to };
      s.sel = -1;
      s.moves = [];
      s.turn = !s.turn;

      var king = s.bd.indexOf(s.turn ? "K" : "k");
      s.check = king >= 0 && attacked(s.bd, king, !s.turn);
      var can = anyMove(s.bd, s.st, s.turn);
      this.pad(g);

      if (!can) {
        var two = seats(g, 2);
        if (s.check) {
          var winner = s.turn ? two[1] : two[0];
          if (winner) winner.score += 20;
          g.beep.play(880, 0.25);
          return g.finish("Checkmate",
            (winner ? winner.name : (s.turn ? "Black" : "White")) + " wins.");
        }
        return g.finish("Stalemate", "No legal move and no check. A draw.");
      }
      if (s.check) { g.say("Check"); g.beep.play(760, 0.12); }
      else g.say("");
    },

    draw: function (g) {
      var pen = g.pen, s = g.s, two = seats(g, 2);
      frame(pen, g);
      var cell = Math.min((g.H - 90) / 8, (g.W - 460) / 8);
      var ox = (g.W - cell * 8) / 2, oy = (g.H - cell * 8) / 2 + 8;

      for (var i = 0; i < 64; i++) {
        var r = i >> 3, c = i & 7;
        var x = ox + c * cell, y = oy + r * cell;
        if ((r + c) % 2 === 1) pen.slab(x, y, cell, cell, DUST, 0.09);
        if (s.last && (s.last.from === i || s.last.to === i)) {
          pen.slab(x, y, cell, cell, GOLD, 0.16);
        }
        if (s.sel === i) pen.box(x + 2, y + 2, cell - 4, cell - 4, MINT, 3);
        if (s.moves.indexOf(i) >= 0) pen.ring(x + cell / 2, y + cell / 2, cell * 0.16, MINT, 3);
        var p = s.bd[i];
        if (!p) continue;
        pen.text(GLYPH[p], x + cell / 2, y + cell / 2 + cell * 0.04,
                 cell * 0.78, white(p) ? DUST : GOLD, "center", false);
      }
      pen.box(ox, oy, cell * 8, cell * 8, FAINT, 3);
      for (i = 0; i < 8; i++) {
        pen.text("abcdefgh"[i], ox + i * cell + cell / 2, oy + cell * 8 + 20, 16, FAINT);
        pen.text(String(8 - i), ox - 18, oy + i * cell + cell / 2, 16, FAINT);
      }

      var label = (s.turn ? "White" : "Black") + " to play" + (s.check ? " — check" : "");
      pen.text(label, g.W / 2, oy - 26, 26, s.check ? "#d9614a" : FAINT);
      if (two[0]) pen.text(two[0].name + " · white", ox - 30, oy + cell * 8 + 48, 18, DUST, "left");
      if (two[1]) pen.text(two[1].name + " · black", ox + cell * 8 + 30, oy + cell * 8 + 48, 18, GOLD, "right");
      if (two.length < 2) {
        pen.text("waiting for a second phone", g.W / 2, g.H - 26, 20, FAINT);
      }
    }
  });

})(window);
