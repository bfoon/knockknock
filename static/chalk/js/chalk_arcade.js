/* Chalk — Timeout: the wiring.
 *
 * One file, two jobs, decided by which page loaded it:
 *
 *   projector   runs the game and draws it, and is the only thing that does
 *   phone       becomes whatever controller the current game asks for
 *
 * Both talk over the board's existing socket with a single frame type,
 * {"t":"game", ...}. Nothing here is stored: close the arcade and the lesson
 * is exactly where it was, undo history and all.
 *
 * Needs window.ChalkBoard = { net, cfg, role } — three lines added to
 * chalk_stage.js and chalk_control.js. See the notes at the end of this file.
 */
(function (global) {
  "use strict";

  var B = global.ChalkBoard;
  if (!B || !B.net || !global.ChalkGames) return;

  var IS_STAGE = B.role === "stage";
  var IS_TEACHER = B.role === "stage" || B.role === "control";

  function send(frame) { B.net.send(frame, true); }

  /* ==================================================================
     Projector
     ================================================================== */

  function mountStage() {
    var arcade = global.ChalkGames.arcade(document.body, { send: send });
    var lastSeen = {};

    /* A phone that walks out of the room stops being a player after a
     * minute. Otherwise a class of thirty leaves thirty ghosts on the
     * scoreboard for the rest of the afternoon. */
    setInterval(function () {
      var now = Date.now();
      arcade.players.slice().forEach(function (p) {
        if (now - p.seen > 60000) arcade.drop(p.pid);
      });
    }, 10000);

    global.ChalkArcade = {
      frame: function (m) {
        if (!m || m.act === "state" || m.act === "cue") return;
        if (m.act === "open") {
          if (arcade.open(m.game, m.opt)) {
            document.body.classList.add("in-timeout");
          }
          return;
        }
        if (m.act === "close") {
          arcade.close();
          document.body.classList.remove("in-timeout");
          return;
        }
        if (m.act === "again") { arcade.begin(); return; }
        if (m.pid) lastSeen[m.pid] = Date.now();
        arcade.input(m);
      },
      arcade: arcade
    };

    /* The projector has a keyboard often enough to be worth it. */
    document.addEventListener("keydown", function (e) {
      if (arcade.phase === "off") return;
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        arcade.close();
        document.body.classList.remove("in-timeout");
        send({ t: "game", act: "close" });
      }
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        arcade.begin();
      }
    });
  }

  /* ==================================================================
     Phone
     ================================================================== */

  function mountPad() {
    var me = (B.cfg && B.cfg.me) || null;
    var myName = (me && me.name) || (B.role === "control" ? "The board phone" : "Player");
    var state = { phase: "off", game: "", name: "", pad: null, rev: -1,
                  scores: [], msg: "", left: 0 };
    var wrap, controls, scoreRow, titleEl, msgEl, hintEl, goBtn, endBtn, menu;
    var padRev = -1;
    var myPidCache = null;
    var showFloat = function () {};

    build();

    global.ChalkArcade = {
      frame: function (m) {
        if (!m) return;
        if (m.act === "you") { myPidCache = m.pid; return; }
        if (m.act === "cue") {
          if (m.to === myPidCache) buzz(m.k);
          return;
        }
        if (m.act !== "state") return;
        state = m;
        paint();
      },
      open: openMenu
    };

    /* A phone does not know its own id: the server stamps that on the way
     * through. It answers the first join with {"act":"you"}, and that is the
     * only reason this end knows which row of the scoreboard is us. */
    function tell(frame) {
      frame.t = "game";
      send(frame);
    }

    function hello() { tell({ act: "join", who: myName }); }

    /* Heartbeat: also how the projector knows this phone is still here. */
    setInterval(function () {
      if (state.phase !== "off") tell({ act: "join", who: myName });
    }, 12000);
    hello();

    /* --- chrome ---------------------------------------------------- */

    function build() {
      wrap = document.createElement("div");
      wrap.className = "chalk-pad";
      wrap.hidden = true;
      wrap.innerHTML =
        '<header class="pad-top">' +
          '<strong class="pad-title"></strong>' +
          '<span class="pad-msg" role="status" aria-live="polite"></span>' +
          '<span class="spacer"></span>' +
          '<button class="icon-btn" data-act="hide" type="button">Board</button>' +
          '<button class="icon-btn danger" data-act="end" type="button" hidden>End</button>' +
        '</header>' +
        '<div class="pad-scores"></div>' +
        '<div class="pad-controls"></div>' +
        '<footer class="pad-foot">' +
          '<span class="pad-hint"></span>' +
          '<button class="icon-btn primary" data-act="go" type="button" hidden>Start</button>' +
        '</footer>';
      document.body.appendChild(wrap);

      controls = wrap.querySelector(".pad-controls");
      scoreRow = wrap.querySelector(".pad-scores");
      titleEl = wrap.querySelector(".pad-title");
      msgEl = wrap.querySelector(".pad-msg");
      hintEl = wrap.querySelector(".pad-hint");
      goBtn = wrap.querySelector('[data-act="go"]');
      endBtn = wrap.querySelector('[data-act="end"]');

      goBtn.addEventListener("click", function () { tell({ act: "input", k: "start", v: 1 }); });
      endBtn.addEventListener("click", function () {
        tell({ act: "close" });
        wrap.hidden = true;
      });
      wrap.querySelector('[data-act="hide"]').addEventListener("click", function () {
        wrap.hidden = true;
        showFloat(true);
      });

      /* The way back in once the pad is tucked away. */
      var fab = document.createElement("button");
      fab.className = "pad-float";
      fab.type = "button";
      fab.textContent = "Controller";
      fab.hidden = true;
      fab.addEventListener("click", function () {
        wrap.hidden = false;
        fab.hidden = true;
      });
      document.body.appendChild(fab);
      showFloat = function (on) { fab.hidden = !on || state.phase === "off"; };

      var opener = document.getElementById("open-games");
      if (opener) opener.addEventListener("click", openMenu);
    }

    function paint() {
      var on = state.phase && state.phase !== "off";
      if (!on) {
        wrap.hidden = true;
        showFloat(false);
        if (menu) menu.hidden = true;
        return;
      }
      if (wrap.hidden && !floatShown()) wrap.hidden = false;
      titleEl.textContent = state.name || "Timeout";
      msgEl.textContent = state.msg || "";
      endBtn.hidden = !IS_TEACHER;

      goBtn.hidden = !(IS_TEACHER && (state.phase === "ready" || state.phase === "over"));
      goBtn.textContent = state.phase === "over" ? "Play again" : "Start";

      hintEl.textContent =
        state.phase === "ready" ? "Waiting to start"
        : state.phase === "count" ? "Get ready"
        : state.phase === "over" ? "That is the round"
        : state.left ? state.left + " seconds left" : "";

      drawScores();
      if (state.rev !== padRev) {
        padRev = state.rev;
        buildControls(state.pad);
      }
      setDisabled(state.phase !== "play");
    }

    function floatShown() {
      var f = document.querySelector(".pad-float");
      return f && !f.hidden;
    }

    function drawScores() {
      var list = state.scores || [];
      scoreRow.textContent = "";
      list.slice(0, 8).forEach(function (s) {
        var chip = document.createElement("span");
        chip.className = "pad-chip";
        chip.dataset.out = s.out ? "1" : "0";
        chip.innerHTML = '<i></i><b></b><u></u>';
        chip.querySelector("i").style.background = s.color;
        chip.querySelector("b").textContent = s.name;
        chip.querySelector("u").textContent = s.score;
        if (s.pid === myPidCache) chip.dataset.me = "1";
        scoreRow.appendChild(chip);
      });
    }

    function setDisabled(off) {
      controls.dataset.off = off ? "1" : "0";
    }

    function buzz(kind) {
      if (!navigator.vibrate) return;
      navigator.vibrate(kind === "point" ? [18, 40, 18] : kind === "warn" ? [10, 30, 10] : 60);
    }

    /* --- the controls ---------------------------------------------- */

    function press(k, v, extra) {
      var frame = { act: "input", k: k, v: v };
      if (extra) { frame.x = extra.x; frame.y = extra.y; }
      tell(frame);
      if (v === 1 && navigator.vibrate) navigator.vibrate(8);
    }

    function bigButton(label, onDown, onUp, cls) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "pad-btn " + (cls || "");
      b.textContent = label;
      b.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        b.dataset.on = "1";
        try { b.setPointerCapture(e.pointerId); } catch (err) {}
        onDown && onDown();
      });
      function up() { if (b.dataset.on === "1") { b.dataset.on = "0"; onUp && onUp(); } }
      b.addEventListener("pointerup", up);
      b.addEventListener("pointercancel", up);
      b.addEventListener("pointerleave", up);
      b.addEventListener("contextmenu", function (e) { e.preventDefault(); });
      return b;
    }

    function buildControls(spec) {
      controls.textContent = "";
      controls.dataset.kind = (spec && spec.kind) || "none";
      if (!spec) return;
      var kind = spec.kind, keys = spec.keys || [];

      if (kind === "dpad") return padDirections();
      if (kind === "slider") return padSlider(spec);
      if (kind === "aim") return padAim(spec);
      if (kind === "zones") return padZones(keys);
      if (kind === "quiz") return padQuiz(keys);
      if (kind === "colours") return padColours(keys);
      if (kind === "tap" || kind === "mash") return padOne(spec, kind);
      /* buttons and hands share a shape: a row of big, obvious slabs. */
      keys.forEach(function (k) {
        controls.appendChild(bigButton(k.label,
          function () { press(k.k, 1); },
          function () { press(k.k, 0); },
          kind === "hands" ? "is-hand" : ""));
      });
    }

    function padDirections() {
      var grid = document.createElement("div");
      grid.className = "pad-dpad";
      [["up", "\u25B2", "u"], ["left", "\u25C0", "l"],
       ["right", "\u25B6", "r"], ["down", "\u25BC", "d"]].forEach(function (d) {
        var b = bigButton(d[1], function () { press("dir", d[0]); }, null, "is-dir");
        b.dataset.dir = d[2];
        b.setAttribute("aria-label", d[0]);
        grid.appendChild(b);
      });
      controls.appendChild(grid);

      /* Swiping anywhere works too, which is how most people will play. */
      var from = null;
      controls.addEventListener("pointerdown", function (e) {
        from = { x: e.clientX, y: e.clientY };
      });
      controls.addEventListener("pointerup", function (e) {
        if (!from) return;
        var dx = e.clientX - from.x, dy = e.clientY - from.y;
        from = null;
        if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
        press("dir", Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
      });
    }

    function padSlider(spec) {
      var track = document.createElement("div");
      track.className = "pad-slider";
      track.dataset.axis = spec.axis || "y";
      track.innerHTML = '<span class="pad-knob"></span><span class="pad-label"></span>';
      var knob = track.querySelector(".pad-knob");
      track.querySelector(".pad-label").textContent = spec.label || "";
      controls.appendChild(track);

      var sending = false, last = 0.5;
      function at(e) {
        var r = track.getBoundingClientRect();
        var v = spec.axis === "x"
          ? (e.clientX - r.left) / Math.max(1, r.width)
          : (e.clientY - r.top) / Math.max(1, r.height);
        last = Math.max(0, Math.min(1, v));
        if (spec.axis === "x") knob.style.left = (last * 100) + "%";
        else knob.style.top = (last * 100) + "%";
        if (!sending) {
          sending = true;
          requestAnimationFrame(function () {
            sending = false;
            press("pos", Math.round(last * 1000) / 1000);
          });
        }
      }
      track.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        try { track.setPointerCapture(e.pointerId); } catch (err) {}
        at(e);
      });
      track.addEventListener("pointermove", function (e) {
        if (e.buttons === 0 && e.pointerType === "mouse") return;
        at(e);
      });
    }

    function padAim(spec) {
      var area = document.createElement("div");
      area.className = "pad-aim";
      area.innerHTML =
        '<svg viewBox="0 0 200 200" aria-hidden="true">' +
        '<circle cx="100" cy="100" r="86" class="aim-ring"></circle>' +
        '<line x1="100" y1="100" x2="100" y2="100" class="aim-line"></line>' +
        '<circle cx="100" cy="100" r="9" class="aim-dot"></circle></svg>' +
        '<span class="pad-label">' + (spec.label || "Pull back, let go") + '</span>';
      controls.appendChild(area);
      var line = area.querySelector(".aim-line");
      var start = null, vec = { x: 0, y: 0 }, queued = false;

      function push() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(function () {
          queued = false;
          press("aim", 0, { x: r3(vec.x), y: r3(vec.y) });
        });
      }
      function r3(v) { return Math.round(v * 1000) / 1000; }

      area.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        try { area.setPointerCapture(e.pointerId); } catch (err) {}
        start = { x: e.clientX, y: e.clientY };
      });
      area.addEventListener("pointermove", function (e) {
        if (!start) return;
        var span = Math.min(190, area.getBoundingClientRect().height * 0.55);
        vec.x = Math.max(-1.2, Math.min(1.2, (e.clientX - start.x) / span));
        vec.y = Math.max(-1.2, Math.min(1.2, (e.clientY - start.y) / span));
        line.setAttribute("x2", String(100 + vec.x * 80));
        line.setAttribute("y2", String(100 + vec.y * 80));
        push();
      });
      function release() {
        if (!start) return;
        start = null;
        press("shoot", 1, { x: r3(vec.x), y: r3(vec.y) });
        line.setAttribute("x2", "100");
        line.setAttribute("y2", "100");
        vec = { x: 0, y: 0 };
      }
      area.addEventListener("pointerup", release);
      area.addEventListener("pointercancel", release);
    }

    function padZones(keys) {
      var note = document.createElement("p");
      note.className = "pad-note";
      note.textContent = "Tap to strike · hold to guard";
      controls.appendChild(note);
      keys.forEach(function (k, i) {
        var held = 0, timer = null;
        var b = bigButton(k.label, function () {
          held = 0;
          timer = setTimeout(function () { held = 1; press("grd", i); }, 200);
        }, function () {
          clearTimeout(timer);
          if (held) press("grd", -1);
          else press("atk", i);
        }, "is-zone");
        controls.appendChild(b);
      });
    }

    function padQuiz(keys) {
      var letters = ["A", "B", "C", "D"];
      keys.forEach(function (k, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "pad-btn is-answer";
        b.innerHTML = '<em></em><span></span>';
        b.querySelector("em").textContent = letters[i];
        b.querySelector("span").textContent = k.label;
        b.addEventListener("click", function () {
          press("pick", i);
          controls.querySelectorAll(".is-answer").forEach(function (o) {
            o.dataset.on = o === b ? "1" : "0";
          });
        });
        controls.appendChild(b);
      });
    }

    function padColours(keys) {
      keys.forEach(function (k, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "pad-btn is-colour";
        b.style.setProperty("--c", k.color || "#ffffff");
        b.textContent = k.label;
        b.addEventListener("pointerdown", function (e) { e.preventDefault(); press("c", i); });
        controls.appendChild(b);
      });
    }

    function padOne(spec, kind) {
      var b = bigButton(kind === "mash" ? "PULL" : "TAP",
        function () { press(kind === "mash" ? "pull" : "tap", 1); },
        function () { press(kind === "mash" ? "pull" : "tap", 0); },
        "is-huge");
      controls.appendChild(b);
      var note = document.createElement("p");
      note.className = "pad-note";
      note.textContent = spec.label || "";
      controls.appendChild(note);
    }

    /* --- the menu --------------------------------------------------- */

    function openMenu() {
      if (!IS_TEACHER) return;
      if (!menu) menu = buildMenu();
      menu.hidden = false;
    }

    function buildMenu() {
      var m = document.createElement("div");
      m.className = "pad-menu";
      m.innerHTML =
        '<div class="menu-card">' +
          '<header><strong>Timeout</strong>' +
          '<span class="menu-sub">Everybody with the board number can play. ' +
          'The lesson stays exactly as it is.</span>' +
          '<span class="spacer"></span>' +
          '<button class="icon-btn" data-act="shut" type="button">Close</button></header>' +
          '<div class="menu-list"></div>' +
        '</div>';
      document.body.appendChild(m);
      m.querySelector('[data-act="shut"]').addEventListener("click", function () {
        m.hidden = true;
      });
      m.addEventListener("click", function (e) { if (e.target === m) m.hidden = true; });

      var list = m.querySelector(".menu-list");
      global.ChalkGames.list().forEach(function (g) {
        var card = document.createElement("button");
        card.type = "button";
        card.className = "menu-item";
        card.innerHTML = '<strong></strong><em></em><span></span>';
        card.querySelector("strong").textContent = g.name;
        card.querySelector("em").textContent = g.tag;
        card.querySelector("span").textContent = g.blurb;
        card.addEventListener("click", function () {
          var def = global.ChalkGames.get(g.id);
          if (def && def.packs && def.packs.length) return askPack(m, g.id, def.packs);
          tell({ act: "open", game: g.id });
          m.hidden = true;
        });
        list.appendChild(card);
      });
      return m;
    }

    function askPack(m, id, packs) {
      var list = m.querySelector(".menu-list");
      list.textContent = "";
      var back = document.createElement("button");
      back.type = "button";
      back.className = "menu-item is-back";
      back.textContent = "\u2039 All games";
      back.addEventListener("click", function () {
        m.remove(); menu = null; openMenu();
      });
      list.appendChild(back);
      packs.forEach(function (pack) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "menu-item";
        b.innerHTML = '<strong></strong><span>Ten questions, shuffled.</span>';
        b.querySelector("strong").textContent =
          pack.charAt(0).toUpperCase() + pack.slice(1);
        b.addEventListener("click", function () {
          tell({ act: "open", game: id, opt: { pack: pack } });
          m.hidden = true;
          m.remove(); menu = null;
        });
        list.appendChild(b);
      });
    }
  }

  if (IS_STAGE) mountStage(); else mountPad();
})(window);

/* ---------------------------------------------------------------------
   Wiring, for whoever comes to this next.

   chalk_stage.js — after `var net = ChalkNet(...)`:
       window.ChalkBoard = { net: net, cfg: CFG, role: "stage" };
   and inside handle():
       case "game": if (window.ChalkArcade) ChalkArcade.frame(m); break;

   chalk_control.js — the same two, with role: CFG.role === "join" ? "join"
   : "control".

   Then load, after chalk_stage.js / chalk_control.js:
       chalk_games.js, chalk_games_pack.js, chalk_games_class.js,
       chalk_arcade.js
   --------------------------------------------------------------------- */
