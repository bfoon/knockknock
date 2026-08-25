/* Chalk — Timeout: the arcade that sits on top of the board.
 *
 * Five minutes at the end of a lesson, a wet break, the last day of term.
 * The projector already has a big screen and every child in the room is
 * holding a controller — this module is the ten minutes of fun that hardware
 * was always going to be asked for.
 *
 * Shape of things:
 *   chalk_games.js       this file. Canvas, chalk pen, players, phases.
 *   chalk_games_pack.js  the games themselves, registered into here.
 *   chalk_arcade.js      glue: stage runs it, phones drive it.
 *
 * The projector is the only place a game is simulated. Phones send button
 * frames and receive a scoreboard; nothing about a game is ever stored, so
 * a round of Snake cannot appear in a lesson's undo history or its saved
 * pages. Close the arcade and the board is exactly where it was left.
 *
 *   ChalkGames.add(def)          register a game
 *   ChalkGames.list()            [{id, name, blurb, tag, players}]
 *   ChalkGames.arcade(host, io)  -> controller for the projector
 *
 * A game definition:
 *   { id, name, blurb, tag, pad, min, max, secs,
 *     start(g), step(g, dt), draw(g), input(g, player, k, v, x, y),
 *     join(g, player), leave(g, player) }
 */
(function (global) {
  "use strict";

  var GAMES = {}, ORDER = [];

  /* Player colours are chalk colours, in the order a box of chalk comes in. */
  var INK = ["#ffffff", "#56b7e6", "#d9a441", "#4bbf7a", "#d9614a", "#b98cf0",
             "#7ee0d0", "#f09ac0"];

  var HAND = '"Chalkboard SE", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
  var PLAIN = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  /* ==================================================================
     Pen — everything is drawn as if a hand did it in chalk.
     Jitter is derived from the point index rather than Math.random, so a
     shape sits still between frames instead of vibrating.
     ================================================================== */

  function wob(i, k) {
    var s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return (s - Math.floor(s)) - 0.5;
  }

  function Pen() { this.c = null; this.k = 1; }

  Pen.prototype.use = function (ctx, scale) { this.c = ctx; this.k = scale || 1; };

  Pen.prototype._trace = function (pts, close, j) {
    var c = this.c, i;
    c.beginPath();
    for (i = 0; i < pts.length; i += 2) {
      var x = pts[i] + (j ? wob(i, 1) * j : 0);
      var y = pts[i + 1] + (j ? wob(i, 2) * j : 0);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    if (close) c.closePath();
  };

  /* One dusty halo pass, one confident pass. That is the whole trick. */
  Pen.prototype.stroke = function (pts, color, w, close) {
    var c = this.c;
    c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = color;
    c.globalAlpha = 0.16; c.lineWidth = (w || 3) * 2.6;
    this._trace(pts, close, 0); c.stroke();
    c.globalAlpha = 0.92; c.lineWidth = (w || 3);
    this._trace(pts, close, (w || 3) * 0.22); c.stroke();
    c.globalAlpha = 1;
  };

  Pen.prototype.fill = function (pts, color, alpha, close) {
    var c = this.c;
    c.globalAlpha = alpha == null ? 0.22 : alpha;
    c.fillStyle = color;
    this._trace(pts, close !== false, 0);
    c.fill();
    c.globalAlpha = 1;
  };

  Pen.prototype.line = function (x1, y1, x2, y2, color, w) {
    this.stroke([x1, y1, x2, y2], color, w, false);
  };

  Pen.prototype.box = function (x, y, w, h, color, lw) {
    this.stroke([x, y, x + w, y, x + w, y + h, x, y + h], color, lw || 3, true);
  };

  Pen.prototype.slab = function (x, y, w, h, color, alpha) {
    this.fill([x, y, x + w, y, x + w, y + h, x, y + h], color, alpha, true);
  };

  Pen.prototype.ring = function (x, y, r, color, lw, from, to) {
    var pts = [], n = Math.max(10, Math.round(r * 0.9)), i;
    var a0 = from == null ? 0 : from, a1 = to == null ? Math.PI * 2 : to;
    for (i = 0; i <= n; i++) {
      var a = a0 + (a1 - a0) * (i / n);
      pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    this.stroke(pts, color, lw || 3, false);
  };

  Pen.prototype.disc = function (x, y, r, color, alpha) {
    var c = this.c;
    c.globalAlpha = alpha == null ? 0.9 : alpha;
    c.fillStyle = color;
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1;
  };

  Pen.prototype.text = function (str, x, y, size, color, align, hand) {
    var c = this.c;
    c.font = (hand === false ? "600 " : "") + size + "px " +
             (hand === false ? PLAIN : HAND);
    c.textAlign = align || "center";
    c.textBaseline = "middle";
    c.globalAlpha = 0.18; c.fillStyle = color;
    c.fillText(str, x + size * 0.03, y + size * 0.03);
    c.globalAlpha = 0.96;
    c.fillText(str, x, y);
    c.globalAlpha = 1;
  };

  /* Chalk dust — the punctuation of this whole app. */
  Pen.prototype.dust = function (x, y, n, color, spread, size) {
    var c = this.c, i;
    c.fillStyle = color;
    for (i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, d = Math.random() * (spread || 20);
      c.globalAlpha = 0.1 + Math.random() * 0.5;
      c.beginPath();
      c.arc(x + Math.cos(a) * d, y + Math.sin(a) * d,
            (size || 2) * (0.4 + Math.random()), 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;
  };

  /* ==================================================================
     Beeper — one oscillator, no files, no autoplay fight.
     ================================================================== */

  function Beeper() { this.ctx = null; this.on = true; }

  Beeper.prototype.wake = function () {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    var A = global.AudioContext || global.webkitAudioContext;
    if (A) { try { this.ctx = new A(); } catch (e) { this.ctx = null; } }
  };

  Beeper.prototype.play = function (freq, secs, kind, vol) {
    if (!this.on || !this.ctx) return;
    try {
      var t = this.ctx.currentTime;
      var o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = kind || "triangle";
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol || 0.14, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (secs || 0.12));
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + (secs || 0.12) + 0.02);
    } catch (e) { /* a silent projector is not a broken game */ }
  };

  Beeper.prototype.slide = function (f1, f2, secs) {
    if (!this.on || !this.ctx) return;
    try {
      var t = this.ctx.currentTime;
      var o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(f1, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + secs);
      g.gain.setValueAtTime(0.10, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + secs + 0.02);
    } catch (e) {}
  };

  /* ==================================================================
     Arcade
     ================================================================== */

  function Arcade(host, io) {
    var self = this;
    this.io = io || {};
    this.pen = new Pen();
    this.beep = new Beeper();

    this.root = document.createElement("div");
    this.root.className = "chalk-arcade";
    this.root.hidden = true;
    this.root.innerHTML =
      '<canvas class="arc-canvas"></canvas>' +
      '<div class="arc-top">' +
        '<span class="arc-name"></span>' +
        '<span class="arc-msg" role="status" aria-live="polite"></span>' +
        '<span class="arc-clock"></span>' +
      '</div>' +
      '<ol class="arc-scores"></ol>' +
      '<div class="arc-card"><div>' +
        '<p class="arc-kicker">Timeout</p>' +
        '<h2 class="arc-title"></h2>' +
        '<p class="arc-blurb"></p>' +
        '<p class="arc-how"></p>' +
        '<p class="arc-cue"></p>' +
      '</div></div>' +
      '<div class="arc-count" hidden></div>';
    (host || document.body).appendChild(this.root);

    this.canvas = this.root.querySelector(".arc-canvas");
    this.ctx = this.canvas.getContext("2d");
    this.elName = this.root.querySelector(".arc-name");
    this.elMsg = this.root.querySelector(".arc-msg");
    this.elClock = this.root.querySelector(".arc-clock");
    this.elScores = this.root.querySelector(".arc-scores");
    this.card = this.root.querySelector(".arc-card");
    this.elTitle = this.root.querySelector(".arc-title");
    this.elBlurb = this.root.querySelector(".arc-blurb");
    this.elHow = this.root.querySelector(".arc-how");
    this.elCue = this.root.querySelector(".arc-cue");
    this.elCount = this.root.querySelector(".arc-count");

    this.game = null;
    this.phase = "off";
    this.players = [];
    this.byId = {};
    this.seat = 0;
    this.W = 1000; this.H = 562;
    this.dpr = 1;
    this.raf = null;
    this.lastAt = 0;
    this.sentAt = 0;
    this.padSpec = null;
    this.padRev = 0;
    this.msg = "";
    this.countTo = 0;

    this.g = null;

    this._resize = function () { self.resize(); };
    global.addEventListener("resize", this._resize);
    global.addEventListener("orientationchange", this._resize);
  }

  /* --- canvas ------------------------------------------------------- */

  Arcade.prototype.resize = function () {
    var r = this.root.getBoundingClientRect();
    var w = Math.max(320, r.width), h = Math.max(240, r.height);
    this.dpr = Math.min(2, global.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.scale = (w / 1000) * this.dpr;
    this.W = 1000;
    this.H = Math.round(h / (w / 1000));
    if (this.g) { this.g.W = this.W; this.g.H = this.H; }
  };

  /* --- players ------------------------------------------------------ */

  Arcade.prototype.player = function (pid, name) {
    if (!pid) return null;
    var p = this.byId[pid];
    if (p) {
      if (name && p.name !== name) p.name = name;
      p.seen = Date.now();
      return p;
    }
    p = {
      pid: pid,
      name: name || "Player " + (this.players.length + 1),
      color: INK[this.seat % INK.length],
      seat: this.seat++,
      score: 0,
      note: "",
      out: false,
      team: this.players.length % 2,
      hold: {},
      seen: Date.now()
    };
    this.players.push(p);
    this.byId[pid] = p;
    if (this.game && this.game.join) this.game.join(this.g, p);
    this.beep.play(660, 0.07);
    this.push(true);
    return p;
  };

  Arcade.prototype.drop = function (pid) {
    var p = this.byId[pid];
    if (!p) return;
    if (this.game && this.game.leave) this.game.leave(this.g, p);
    delete this.byId[pid];
    this.players.splice(this.players.indexOf(p), 1);
    this.push(true);
  };

  Arcade.prototype.playing = function () {
    var out = [], i;
    for (i = 0; i < this.players.length; i++) {
      if (!this.players[i].out) out.push(this.players[i]);
    }
    return out;
  };

  /* --- lifecycle ---------------------------------------------------- */

  Arcade.prototype.open = function (id, opts) {
    var def = GAMES[id];
    if (!def) return false;
    this.game = def;
    this.opts = opts || {};
    this.root.hidden = false;
    this.beep.wake();
    this.resize();
    this.reset();
    this.phase = "ready";
    this.card.hidden = false;
    this.elKicker();
    this.paint();
    this.loop();
    this.push(true);
    return true;
  };

  Arcade.prototype.elKicker = function () {
    var d = this.game;
    this.elName.textContent = d.name;
    this.elTitle.textContent = d.name;
    this.elBlurb.textContent = d.blurb || "";
    this.elHow.textContent = d.how || "";
    this.elCue.textContent = this.players.length
      ? "Tap Start on the phone when everyone is in."
      : "Everybody: open the board number on a phone and tap Play.";
  };

  Arcade.prototype.reset = function () {
    var i;
    for (i = 0; i < this.players.length; i++) {
      this.players[i].score = 0;
      this.players[i].out = false;
      this.players[i].note = "";
      this.players[i].hold = {};
    }
    this.msg = "";
    this.setPad(this.game ? { kind: this.game.pad } : null);
    this.g = {
      W: this.W, H: this.H, pen: this.pen, ctx: this.ctx,
      t: 0, phase: "ready", secs: this.game ? (this.game.secs || 0) : 0,
      left: this.game ? (this.game.secs || 0) : 0,
      players: this.players, s: {}, arcade: this,
      opts: this.opts || {},
      byId: this.byId,
      playing: this.playing.bind(this),
      say: this.say.bind(this),
      setPad: this.setPad.bind(this),
      cue: this.cue.bind(this),
      finish: this.finish.bind(this),
      beep: this.beep,
      rand: function (a, b) { return a + Math.random() * (b - a); },
      pick: function (arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    };
    if (this.game && this.game.setup) this.game.setup(this.g);
  };

  Arcade.prototype.begin = function () {
    if (!this.game) return;
    if (this.phase === "over") { this.reset(); }
    this.phase = "count";
    this.countTo = 3.2;
    this.card.hidden = true;
    this.elCount.hidden = false;
    this.push(true);
  };

  Arcade.prototype.live = function () {
    this.phase = "play";
    this.elCount.hidden = true;
    this.g.phase = "play";
    this.g.t = 0;
    this.g.left = this.game.secs || 0;
    if (this.game.start) this.game.start(this.g);
    this.beep.play(880, 0.12);
    this.push(true);
  };

  Arcade.prototype.finish = function (text, sub) {
    if (this.phase === "over") return;
    this.phase = "over";
    this.g.phase = "over";
    this.card.hidden = false;
    this.elCount.hidden = true;
    var board = this.players.slice().sort(function (a, b) { return b.score - a.score; });
    this.elTitle.textContent = text || "Time";
    this.elBlurb.textContent = sub || "";
    this.elHow.textContent = board.length
      ? board.map(function (p, i) {
          return (i + 1) + ". " + p.name + " — " + p.score;
        }).join("   ")
      : "";
    this.elCue.textContent = "Play again, pick another game, or go back to the board.";
    this.beep.play(523, 0.14); 
    var b = this.beep;
    setTimeout(function () { b.play(784, 0.22); }, 150);
    this.push(true);
  };

  Arcade.prototype.close = function () {
    this.phase = "off";
    this.game = null;
    this.root.hidden = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.push(true);
  };

  Arcade.prototype.say = function (msg) {
    this.msg = msg || "";
    this.elMsg.textContent = this.msg;
    this.push(true);
  };

  Arcade.prototype.setPad = function (spec) {
    this.padSpec = spec || null;
    this.padRev++;
  };

  /* A nudge aimed at one phone: buzz in your hand when you score or die. */
  Arcade.prototype.cue = function (p, kind) {
    if (!p || !this.io.send) return;
    this.io.send({ t: "game", act: "cue", to: p.pid, k: kind || "hit" }, true);
  };

  /* --- wire --------------------------------------------------------- */

  Arcade.prototype.snapshot = function () {
    var scores = this.players.slice().sort(function (a, b) {
      return b.score - a.score;
    }).map(function (p) {
      return { pid: p.pid, name: p.name, score: p.score, color: p.color,
               note: p.note || "", out: !!p.out, team: p.team };
    });
    return {
      t: "game", act: "state",
      game: this.game ? this.game.id : "",
      name: this.game ? this.game.name : "",
      phase: this.phase,
      msg: this.msg,
      left: Math.max(0, Math.round(this.g ? this.g.left : 0)),
      pad: this.padSpec ? JSON.parse(JSON.stringify(this.padSpec)) : null,
      rev: this.padRev,
      scores: scores
    };
  };

  Arcade.prototype.push = function (now) {
    if (!this.io.send) return;
    var t = Date.now();
    if (!now && t - this.sentAt < 400) return;
    this.sentAt = t;
    this.io.send(this.snapshot(), true);
  };

  /* Frames arriving from a phone. */
  Arcade.prototype.input = function (m) {
    if (!m || !m.pid) return;
    if (m.act === "join") { this.player(m.pid, m.who); return; }
    if (m.act === "leave") { this.drop(m.pid); return; }
    var p = this.player(m.pid, m.who);
    if (!p || !this.game) return;
    if (m.k === "start") { if (this.phase === "ready" || this.phase === "over") this.begin(); return; }
    if (m.v === 1 || m.v === true) p.hold[m.k] = 1;
    if (m.v === 0 || m.v === false) p.hold[m.k] = 0;
    if (this.phase !== "play") {
      /* A press during the results screen means "again". */
      if ((this.phase === "over") && m.v === 1) { this.begin(); }
      return;
    }
    if (this.game.input) this.game.input(this.g, p, m.k, m.v, m.x, m.y);
  };

  /* --- loop --------------------------------------------------------- */

  Arcade.prototype.loop = function () {
    var self = this;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.lastAt = 0;
    function frame(now) {
      self.raf = requestAnimationFrame(frame);
      var dt = self.lastAt ? Math.min(0.05, (now - self.lastAt) / 1000) : 0.016;
      self.lastAt = now;
      self.tick(dt);
      self.paint();
    }
    this.raf = requestAnimationFrame(frame);
  };

  Arcade.prototype.tick = function (dt) {
    if (!this.game) return;
    var g = this.g;
    if (this.phase === "count") {
      var was = Math.ceil(this.countTo);
      this.countTo -= dt;
      var now = Math.ceil(this.countTo);
      if (now !== was && now > 0) this.beep.play(440 + (3 - now) * 110, 0.09);
      this.elCount.textContent = now > 0 ? String(now) : "Go";
      if (this.countTo <= 0) this.live();
      return;
    }
    if (this.phase !== "play") return;
    g.t += dt;
    if (g.secs) {
      g.left = Math.max(0, g.secs - g.t);
      if (g.left <= 0) { this.timeUp(); return; }
      var whole = Math.ceil(g.left);
      if (whole <= 5 && whole !== this._lastTick) {
        this._lastTick = whole;
        this.beep.play(whole > 1 ? 520 : 700, 0.08);
      }
    }
    if (this.game.step) this.game.step(g, dt);
    this.push(false);
  };

  Arcade.prototype.timeUp = function () {
    var board = this.players.slice().sort(function (a, b) { return b.score - a.score; });
    if (!board.length) return this.finish("Time");
    if (board.length > 1 && board[0].score === board[1].score) {
      return this.finish("A draw", board[0].score + " each. Nobody is doing the washing up.");
    }
    this.finish(board[0].name + " wins", "with " + board[0].score);
  };

  /* --- paint -------------------------------------------------------- */

  Arcade.prototype.paint = function () {
    if (!this.game) return;
    var c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    this.pen.use(c, this.scale);

    var g = this.g;
    g.W = this.W; g.H = this.H;

    if (this.game.draw) this.game.draw(g);

    this.elClock.textContent = g.secs && this.phase === "play"
      ? Math.ceil(g.left) + "s" : "";
    this.drawScores();
  };

  Arcade.prototype.drawScores = function () {
    var list = this.players.slice().sort(function (a, b) { return b.score - a.score; });
    var host = this.elScores;
    while (host.children.length > list.length) host.lastChild.remove();
    while (host.children.length < list.length) {
      var li = document.createElement("li");
      li.innerHTML = '<i></i><b></b><s></s><u></u>';
      host.appendChild(li);
    }
    for (var i = 0; i < list.length; i++) {
      var p = list[i], node = host.children[i];
      node.querySelector("i").style.background = p.color;
      node.querySelector("b").textContent = p.name;
      node.querySelector("s").textContent = p.note || "";
      node.querySelector("u").textContent = p.score;
      node.dataset.out = p.out ? "1" : "0";
    }
    host.hidden = !list.length;
  };

  /* ==================================================================
     public
     ================================================================== */

  global.ChalkGames = {
    add: function (def) {
      if (!def || !def.id) return;
      if (!GAMES[def.id]) ORDER.push(def.id);
      GAMES[def.id] = def;
    },
    get: function (id) { return GAMES[id]; },
    list: function () {
      return ORDER.map(function (id) {
        var d = GAMES[id];
        return { id: d.id, name: d.name, blurb: d.blurb, tag: d.tag || "",
                 how: d.how || "", min: d.min || 1, max: d.max || 8 };
      });
    },
    ink: INK,
    Pen: Pen,
    arcade: function (host, io) { return new Arcade(host, io); }
  };
})(window);
