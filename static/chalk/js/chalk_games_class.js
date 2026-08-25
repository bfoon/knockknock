/* Chalk — Timeout: the games for the whole room at once.
 *
 * Pick the answer · Reflex · Tug of chalk · Copycat
 *
 * These four need nothing but a phone each and a wall to point at, which is
 * why they are the ones that end up being played most: thirty people can join
 * in the ten seconds it takes to read the board number out loud.
 */
(function (global) {
  "use strict";

  var G = global.ChalkGames;
  if (!G) return;

  var DUST = "#e8eef4";
  var FAINT = "rgba(232,238,244,.30)";
  var LETTER = ["A", "B", "C", "D"];

  function wrap(ctx, text, maxWidth) {
    var words = String(text).split(/\s+/), lines = [], line = "";
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + " " + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line); line = words[i];
      } else { line = test; }
    }
    if (line) lines.push(line);
    return lines;
  }

  function shuffle(arr) {
    var a = arr.slice(), i, j, t;
    for (i = a.length - 1; i > 0; i--) {
      j = Math.floor(Math.random() * (i + 1));
      t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ==================================================================
     Pick the answer
     ================================================================== */

  /* Packs are deliberately short and mostly primary-school safe. A teacher
     who wants their own questions types one in on the phone instead — see
     opts.custom. */
  var PACKS = {
    mixed: [
      ["What is the capital city of Japan?", ["Tokyo", "Kyoto", "Osaka", "Seoul"], 0],
      ["Which planet is closest to the Sun?", ["Mercury", "Venus", "Mars", "Earth"], 0],
      ["How many sides does a hexagon have?", ["6", "5", "7", "8"], 0],
      ["Which of these is a mammal?", ["Dolphin", "Shark", "Tuna", "Octopus"], 0],
      ["What do bees make?", ["Honey", "Silk", "Wax paper", "Syrup"], 0],
      ["Which is the largest ocean?", ["Pacific", "Atlantic", "Indian", "Arctic"], 0],
      ["How many players from one team are on a football pitch?",
        ["11", "9", "10", "12"], 0],
      ["Which instrument has 88 keys?", ["Piano", "Guitar", "Violin", "Flute"], 0],
      ["What is a baby frog called?", ["Tadpole", "Cub", "Fawn", "Calf"], 0],
      ["Roman numeral X stands for which number?", ["10", "5", "50", "100"], 0]
    ],
    maths: [
      ["7 × 8", ["56", "54", "48", "64"], 0],
      ["100 ÷ 4", ["25", "20", "30", "40"], 0],
      ["What is 15% of 200?", ["30", "15", "25", "35"], 0],
      ["9 squared", ["81", "18", "72", "99"], 0],
      ["Half of 250", ["125", "115", "150", "120"], 0],
      ["12 × 12", ["144", "124", "132", "154"], 0],
      ["What is the smallest prime number?", ["2", "1", "3", "0"], 0],
      ["How many minutes in a quarter of an hour?", ["15", "20", "25", "30"], 0],
      ["A cube has how many faces?", ["6", "4", "8", "12"], 0],
      ["Which shape has three sides?", ["Triangle", "Square", "Pentagon", "Circle"], 0]
    ],
    science: [
      ["Which gas do plants take in to make food?",
        ["Carbon dioxide", "Oxygen", "Nitrogen", "Hydrogen"], 0],
      ["Water freezes at what temperature?", ["0 °C", "10 °C", "32 °C", "100 °C"], 0],
      ["Which organ pumps blood around the body?",
        ["The heart", "The liver", "The lungs", "The brain"], 0],
      ["Chemical symbol for gold", ["Au", "Ag", "Gd", "Go"], 0],
      ["What is the largest mammal?",
        ["Blue whale", "Elephant", "Giraffe", "Hippopotamus"], 0],
      ["Which metal is liquid at room temperature?",
        ["Mercury", "Iron", "Lead", "Tin"], 0],
      ["What does a thermometer measure?",
        ["Temperature", "Weight", "Speed", "Sound"], 0],
      ["How many legs does a spider have?", ["8", "6", "10", "4"], 0],
      ["Which organ do you breathe with?",
        ["Lungs", "Kidneys", "Stomach", "Spleen"], 0],
      ["Water boils at what temperature at sea level?",
        ["100 °C", "80 °C", "90 °C", "120 °C"], 0]
    ],
    world: [
      ["What is the capital of The Gambia?", ["Banjul", "Serekunda", "Brikama", "Bakau"], 0],
      ["Which river runs the length of The Gambia?",
        ["The Gambia", "The Niger", "The Senegal", "The Volta"], 0],
      ["What is the capital of Senegal?", ["Dakar", "Thiès", "Saint-Louis", "Kaolack"], 0],
      ["Which is the longest river in Africa?",
        ["The Nile", "The Congo", "The Niger", "The Zambezi"], 0],
      ["Which country is the largest by area?",
        ["Russia", "Canada", "China", "Brazil"], 0],
      ["The Sahara is found in which part of Africa?",
        ["North", "South", "East coast", "Central highlands"], 0],
      ["How many continents are there?", ["7", "5", "6", "8"], 0],
      ["Who wrote Things Fall Apart?",
        ["Chinua Achebe", "Wole Soyinka", "Ngũgĩ wa Thiong'o", "Ben Okri"], 0],
      ["In which direction does the Sun rise?",
        ["East", "West", "North", "South"], 0],
      ["Which continent is Egypt mostly in?",
        ["Africa", "Asia", "Europe", "Oceania"], 0]
    ]
  };

  G.add({
    id: "quiz",
    name: "Pick the answer",
    tag: "Whole class",
    blurb: "Four answers on the board, four buttons in every hand. Quick and right beats slow and right.",
    how: "Tap A, B, C or D. Answer fast — the points run down while you think.",
    pad: "quiz",
    min: 1, max: 40, secs: 0,
    packs: Object.keys(PACKS),

    setup: function (g) {
      var pack = PACKS[(g.opts && g.opts.pack)] || PACKS.mixed;
      var list = (g.opts && g.opts.custom && g.opts.custom.length)
        ? g.opts.custom.slice() : shuffle(pack);
      g.s.qs = list.slice(0, Math.min(10, list.length)).map(function (q) {
        var opts = q[1].map(function (text, i) { return { text: text, right: i === q[2] }; });
        return { q: q[0], a: shuffle(opts) };
      });
      g.s.i = -1;
      g.s.limit = 20;
      g.s.left = 0;
      g.s.answers = {};
      g.s.reveal = 0;
      g.s.counts = [0, 0, 0, 0];
    },

    start: function (g) { this.next(g); },

    next: function (g) {
      var s = g.s;
      s.i++;
      if (s.i >= s.qs.length) {
        var board = g.players.slice().sort(function (a, b) { return b.score - a.score; });
        return g.finish(board.length ? board[0].name + " knows things" : "That is the round",
                        board.length ? "on " + board[0].score + " points" : "");
      }
      s.answers = {};
      s.counts = [0, 0, 0, 0];
      s.reveal = 0;
      s.left = s.limit;
      g.players.forEach(function (p) { p.note = ""; });
      g.setPad({
        kind: "quiz",
        keys: s.qs[s.i].a.map(function (o, i) { return { k: "p" + i, label: o.text }; })
      });
      g.beep.play(520, 0.08);
    },

    input: function (g, p, k, v) {
      var s = g.s;
      if (k !== "pick" || s.reveal > 0) return;
      if (s.answers[p.pid] != null) return;
      var i = Math.max(0, Math.min(3, v | 0));
      s.answers[p.pid] = i;
      s.counts[i]++;
      p.note = "in";
      g.beep.play(300 + i * 60, 0.05);
      var q = s.qs[s.i];
      if (q.a[i].right) {
        p.score += 100 + Math.round(50 * (s.left / s.limit));
        p._got = true;
      }
      if (Object.keys(s.answers).length >= g.players.length) s.left = Math.min(s.left, 1.2);
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
        s.reveal = 4.5;
        var q = s.qs[s.i];
        g.players.forEach(function (p) {
          var pick = s.answers[p.pid];
          if (pick == null) { p.note = "no answer"; return; }
          if (q.a[pick].right) { p.note = "right"; g.cue(p, "point"); }
          else { p.note = "not this time"; g.cue(p, "hit"); }
        });
        g.beep.play(760, 0.12);
      }
    },

    draw: function (g) {
      var pen = g.pen, s = g.s, ctx = g.ctx;
      if (s.i < 0 || !s.qs[s.i]) return;
      var q = s.qs[s.i];

      pen.box(14, 14, g.W - 28, g.H - 28, FAINT, 2);
      pen.text("question " + (s.i + 1) + " of " + s.qs.length, 40, 40, 18, FAINT, "left");
      pen.text(Object.keys(s.answers).length + " / " + g.players.length + " in",
               g.W - 40, 40, 18, FAINT, "right");

      /* the question, wrapped by hand */
      var size = q.q.length > 70 ? 34 : 44;
      ctx.font = size + 'px "Chalkboard SE", "Segoe Print", "Comic Sans MS", cursive';
      var lines = wrap(ctx, q.q, g.W - 200);
      lines.forEach(function (ln, i) {
        pen.text(ln, g.W / 2, 100 + i * (size + 8), size, DUST);
      });

      /* four cards */
      var top = 100 + lines.length * (size + 8) + 24;
      var cw = (g.W - 140) / 2, ch = Math.max(70, (g.H - top - 60) / 2 - 14);
      q.a.forEach(function (o, i) {
        var x = 60 + (i % 2) * (cw + 20);
        var y = top + Math.floor(i / 2) * (ch + 16);
        var col = s.reveal > 0 ? (o.right ? "#4bbf7a" : "#d9614a") : DUST;
        if (s.reveal > 0) pen.slab(x, y, cw, ch, col, o.right ? 0.22 : 0.08);
        pen.box(x, y, cw, ch, col, 3);
        pen.text(LETTER[i], x + 34, y + ch / 2, 34, col);
        ctx.font = '26px "Chalkboard SE", "Segoe Print", "Comic Sans MS", cursive';
        var ans = wrap(ctx, o.text, cw - 110);
        ans.slice(0, 2).forEach(function (ln, j) {
          pen.text(ln, x + 70 + (cw - 90) / 2, y + ch / 2 + (j - (ans.length - 1) / 2) * 30,
                   26, col, "center");
        });
        if (s.reveal > 0) {
          pen.text(String(s.counts[i]), x + cw - 26, y + 24, 22, col);
        }
      });

      /* the clock, as a chalk bar that runs out */
      if (s.reveal <= 0) {
        var w = (g.W - 120) * Math.max(0, s.left / s.limit);
        pen.slab(60, g.H - 34, w, 10, s.left < 5 ? "#d9614a" : "#d9a441", 0.6);
      } else {
        pen.text("next question in " + Math.ceil(s.reveal), g.W / 2, g.H - 28, 20, FAINT);
      }
    }
  });

  /* ==================================================================
     Reflex — do not tap early
     ================================================================== */

  G.add({
    id: "reflex",
    name: "Reflex",
    tag: "Whole class",
    blurb: "Wait for the board to say go. Tap on red and you owe everyone a point.",
    how: "One button. The hard part is not pressing it.",
    pad: "tap",
    min: 1, max: 40, secs: 0,

    setup: function (g) {
      g.s.round = 0;
      g.s.rounds = 5;
      g.s.mode = "wait";
      g.s.at = 0;
      g.s.trap = false;
      g.s.won = null;
      g.s.fouled = {};
      g.s.best = 0;
    },

    start: function (g) {
      g.setPad({ kind: "tap", label: "Tap the moment it says GO" });
      this.arm(g);
    },

    arm: function (g) {
      var s = g.s;
      s.round++;
      if (s.round > s.rounds) {
        var board = g.players.slice().sort(function (a, b) { return b.score - a.score; });
        return g.finish(board.length ? board[0].name + " is quickest" : "That is the lot",
                        board.length && s.best ? "best reaction " + s.best + " ms" : "");
      }
      s.mode = "wait";
      s.trap = Math.random() < 0.28;
      s.at = g.t + 1.4 + Math.random() * 3.6;
      s.won = null;
      s.fouled = {};
      g.players.forEach(function (p) { p.note = ""; });
    },

    input: function (g, p, k, v) {
      var s = g.s;
      if (k !== "tap" || v !== 1) return;
      if (s.mode === "wait") {
        s.fouled[p.pid] = 1;
        p.note = "too early";
        p.score = Math.max(0, p.score - 1);
        g.beep.slide(240, 90, 0.2);
        g.cue(p, "hit");
        return;
      }
      if (s.mode === "trap") {
        if (s.fouled[p.pid]) return;
        s.fouled[p.pid] = 1;
        p.note = "tapped on red";
        p.score = Math.max(0, p.score - 1);
        g.cue(p, "hit");
        return;
      }
      if (s.mode === "go" && !s.won && !s.fouled[p.pid]) {
        var ms = Math.round((g.t - s.at) * 1000);
        s.won = { p: p, ms: ms };
        s.best = s.best ? Math.min(s.best, ms) : ms;
        p.score += 2;
        p.note = ms + " ms";
        g.beep.play(1000, 0.12);
        g.cue(p, "point");
      }
    },

    step: function (g, dt) {
      var s = g.s;
      if (s.mode === "wait" && g.t >= s.at) {
        s.mode = s.trap ? "trap" : "go";
        s.at = g.t;
        g.beep.play(s.trap ? 200 : 1200, 0.1);
      } else if (s.mode === "trap" && g.t - s.at > 1.4) {
        this.arm(g);
      } else if (s.mode === "go" && (s.won ? g.t - s.at > 2.2 : g.t - s.at > 3.4)) {
        this.arm(g);
      }
    },

    draw: function (g) {
      var pen = g.pen, s = g.s;
      var col = s.mode === "go" ? "#4bbf7a" : s.mode === "trap" ? "#d9614a" : FAINT;
      if (s.mode !== "wait") pen.slab(0, 0, g.W, g.H, col, 0.14);
      pen.box(14, 14, g.W - 28, g.H - 28, col, 3);
      pen.text("round " + Math.min(s.round, s.rounds) + " of " + s.rounds,
               g.W / 2, 50, 20, FAINT);
      var word = s.mode === "go" ? "GO" : s.mode === "trap" ? "NO" : "wait\u2026";
      pen.text(word, g.W / 2, g.H / 2 - 10, s.mode === "wait" ? 70 : 150, col);
      if (s.won) {
        pen.text(s.won.p.name + " — " + s.won.ms + " ms", g.W / 2, g.H / 2 + 110, 34,
                 s.won.p.color);
      } else if (s.mode === "trap") {
        pen.text("hands off", g.W / 2, g.H / 2 + 110, 30, "#d9614a");
      }
    }
  });

  /* ==================================================================
     Tug of chalk
     ================================================================== */

  G.add({
    id: "tug",
    name: "Tug of chalk",
    tag: "Two teams",
    blurb: "Left against right. Tap fast. Small teams pull just as hard as big ones.",
    how: "One button, hit it as fast as you can. Best of three.",
    pad: "mash",
    min: 2, max: 40, secs: 0,

    setup: function (g) {
      g.s.pull = 0;
      g.s.wins = [0, 0];
      g.s.round = 1;
      g.s.rate = [0, 0];
      g.s.puff = 0;
    },

    start: function (g) {
      g.setPad({ kind: "mash", label: "Tap, tap, tap" });
      g.s.pull = 0;
      g.s.wins = [0, 0];
      g.s.round = 1;
      /* Teams are handed out by arrival so the room splits itself. */
      g.players.forEach(function (p, i) { p.team = i % 2; p.note = p.team ? "right" : "left"; });
    },

    join: function (g, p) { p.team = g.players.length % 2; p.note = p.team ? "right" : "left"; },

    size: function (g, team) {
      var n = 0;
      g.players.forEach(function (p) { if (p.team === team) n++; });
      return Math.max(1, n);
    },

    input: function (g, p, k, v) {
      if (k !== "pull" || v !== 1) return;
      var dir = p.team ? 1 : -1;
      g.s.pull += dir * 0.030 / Math.sqrt(this.size(g, p.team));
      g.s.rate[p.team] += 1;
      p.score += 1;
      g.beep.play(p.team ? 400 : 300, 0.03, "square", 0.05);
    },

    step: function (g, dt) {
      var s = g.s;
      s.pull *= (1 - 0.35 * dt);            /* the rope creeps back to the middle */
      s.rate[0] *= (1 - 2.2 * dt);
      s.rate[1] *= (1 - 2.2 * dt);
      if (s.puff > 0) s.puff -= dt;
      if (Math.abs(s.pull) >= 1) {
        var team = s.pull > 0 ? 1 : 0;
        s.wins[team]++;
        s.puff = 0.8;
        g.beep.play(900, 0.2);
        g.players.forEach(function (p) {
          if (p.team === team) { p.score += 25; g.cue(p, "point"); }
        });
        if (s.wins[team] >= 2) {
          return g.finish((team ? "Right" : "Left") + " side wins",
                          "Best of three: " + s.wins[0] + " — " + s.wins[1]);
        }
        s.round++;
        s.pull = 0;
        g.say("Round " + s.round + " — " + s.wins[0] + " to " + s.wins[1]);
      }
    },

    draw: function (g) {
      var pen = g.pen, s = g.s;
      var midY = g.H / 2;
      pen.box(14, 14, g.W - 28, g.H - 28, FAINT, 2);
      pen.line(g.W * 0.18, 60, g.W * 0.18, g.H - 60, "#56b7e6", 2);
      pen.line(g.W * 0.82, 60, g.W * 0.82, g.H - 60, "#d9a441", 2);

      var knot = g.W / 2 + s.pull * (g.W * 0.32);
      pen.line(60, midY, g.W - 60, midY, FAINT, 3);
      pen.line(knot - 90, midY, knot + 90, midY, DUST, 9);
      pen.disc(knot, midY, 16, DUST, 0.9);
      if (s.puff > 0) pen.dust(knot, midY, 20, DUST, 60, 4);

      /* the two teams, drawn as a crowd that grows with the room */
      [0, 1].forEach(function (team) {
        var list = g.players.filter(function (p) { return p.team === team; });
        var baseX = team ? g.W * 0.88 : g.W * 0.12;
        var col = team ? "#d9a441" : "#56b7e6";
        pen.text(team ? "right" : "left", baseX, 48, 26, col);
        pen.text(list.length + (list.length === 1 ? " puller" : " pullers"),
                 baseX, 76, 17, FAINT);
        list.slice(0, 8).forEach(function (p, i) {
          var x = baseX + (team ? -1 : 1) * (i % 4) * 26;
          var y = 150 + Math.floor(i / 4) * 120 + (Math.sin(g.t * 6 + i) * (s.rate[team] > 1 ? 4 : 0));
          pen.ring(x, y, 12, p.color, 3);
          pen.line(x, y + 12, x, y + 44, p.color, 3);
          pen.line(x, y + 20, x + (team ? -22 : 22), y + 12, p.color, 3);
          pen.line(x, y + 44, x - 14, y + 70, p.color, 3);
          pen.line(x, y + 44, x + 14, y + 70, p.color, 3);
        });
        pen.slab(team ? g.W - 120 : 60, g.H - 60,
                 Math.min(60, s.rate[team] * 3), 12, col, 0.5);
      });

      pen.text("round " + s.round + " · " + s.wins[0] + " — " + s.wins[1],
               g.W / 2, g.H - 34, 20, FAINT);
    }
  });

  /* ==================================================================
     Copycat — watch, then repeat
     ================================================================== */

  var CC = [
    { k: "c0", label: "White", color: "#ffffff" },
    { k: "c1", label: "Blue", color: "#56b7e6" },
    { k: "c2", label: "Amber", color: "#d9a441" },
    { k: "c3", label: "Green", color: "#4bbf7a" }
  ];

  G.add({
    id: "copycat",
    name: "Copycat",
    tag: "Whole class",
    blurb: "The board draws a run of colours. Everybody plays it back from memory.",
    how: "Watch. Then tap the same colours in the same order.",
    pad: "colours",
    min: 1, max: 40, secs: 0,

    setup: function (g) {
      g.s.round = 0;
      g.s.rounds = 6;
      g.s.seq = [];
      g.s.mode = "show";
      g.s.at = 0;
      g.s.step = -1;
      g.s.entry = {};
      g.s.done = {};
    },

    start: function (g) {
      g.setPad({ kind: "colours", keys: CC });
      g.s.seq = [];
      this.arm(g);
    },

    arm: function (g) {
      var s = g.s;
      s.round++;
      if (s.round > s.rounds) {
        var board = g.players.slice().sort(function (a, b) { return b.score - a.score; });
        return g.finish(board.length ? board[0].name + " remembers" : "That is the lot",
                        board.length ? board[0].score + " points" : "");
      }
      s.seq.push(Math.floor(Math.random() * 4));
      s.mode = "show";
      s.step = -1;
      s.at = g.t;
      s.entry = {};
      s.done = {};
      g.players.forEach(function (p) { p.note = ""; });
    },

    input: function (g, p, k, v) {
      var s = g.s;
      if (s.mode !== "play" || k !== "c" || s.done[p.pid]) return;
      var i = Math.max(0, Math.min(3, v | 0));
      var e = s.entry[p.pid] || (s.entry[p.pid] = []);
      e.push(i);
      g.beep.play(300 + i * 130, 0.07);
      if (s.seq[e.length - 1] !== i) {
        s.done[p.pid] = "wrong";
        p.note = "lost it at " + e.length;
        g.cue(p, "hit");
        return;
      }
      p.note = e.length + " / " + s.seq.length;
      if (e.length === s.seq.length) {
        s.done[p.pid] = "right";
        p.score += 10 * s.seq.length;
        p.note = "all " + s.seq.length;
        g.cue(p, "point");
        g.beep.play(1000, 0.1);
      }
    },

    step: function (g) {
      var s = g.s;
      if (s.mode === "show") {
        var i = Math.floor((g.t - s.at) / 0.62) - 1;
        if (i !== s.step) {
          s.step = i;
          if (i >= 0 && i < s.seq.length) g.beep.play(300 + s.seq[i] * 130, 0.18);
        }
        if (i >= s.seq.length) { s.mode = "play"; s.at = g.t; }
        return;
      }
      var everyone = g.players.length && Object.keys(s.done).length >= g.players.length;
      if (everyone || g.t - s.at > 4 + s.seq.length * 1.6) this.arm(g);
    },

    draw: function (g) {
      var pen = g.pen, s = g.s;
      pen.box(14, 14, g.W - 28, g.H - 28, FAINT, 2);
      pen.text("run of " + s.seq.length + " · round " + Math.min(s.round, s.rounds) +
               " of " + s.rounds, g.W / 2, 46, 20, FAINT);

      var size = Math.min(190, (g.W - 200) / 4), gap = 24;
      var totalW = size * 4 + gap * 3, x0 = (g.W - totalW) / 2, y0 = g.H / 2 - size / 2 + 10;
      CC.forEach(function (c, i) {
        var x = x0 + i * (size + gap);
        var lit = s.mode === "show" && s.step >= 0 && s.step < s.seq.length &&
                  s.seq[s.step] === i;
        pen.slab(x, y0, size, size, c.color, lit ? 0.55 : 0.08);
        pen.box(x, y0, size, size, c.color, lit ? 5 : 3);
        pen.text(c.label, x + size / 2, y0 + size + 26, 20, c.color);
        if (lit) pen.dust(x + size / 2, y0 + size / 2, 14, c.color, size / 2, 3);
      });

      pen.text(s.mode === "show" ? "watch" : "your turn",
               g.W / 2, y0 - 40, 34, s.mode === "show" ? "#d9a441" : "#4bbf7a");

      if (s.mode === "play") {
        var got = 0, list = g.players;
        list.forEach(function (p) { if (s.done[p.pid]) got++; });
        pen.text(got + " of " + list.length + " finished", g.W / 2, g.H - 34, 20, FAINT);
      }
    }
  });

})(window);
