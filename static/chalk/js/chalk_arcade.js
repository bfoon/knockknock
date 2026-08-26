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
 *
 * If any of that is missing this file says so, out loud, in the console and
 * on the screen. The first version returned quietly and a missing script tag
 * looked exactly like a broken button.
 */
(function (global) {
  "use strict";

  var VERSION = "timeout 1.2";
  var B = null, IS_STAGE = false, IS_TEACHER = false;
  var heard = false, watch = null;

  function send(frame) { if (B && B.net) B.net.send(frame, true); }

  /* Every game frame that arrives is also proof that the round trip works.
   * See link() at the bottom: this flag is what stops the fallback. */
  function heardOne() {
    heard = true;
    if (watch) { clearTimeout(watch); watch = null; }
  }

  /* --- saying what went wrong --------------------------------------- */

  function complain(what, fix) {
    if (global.console) {
      console.error("[Chalk Timeout] " + what + "\n" + fix);
    }
    var box = document.createElement("div");
    box.className = "timeout-broken";
    box.setAttribute("role", "alert");
    box.innerHTML = '<strong></strong><span></span>' +
      '<button type="button">Close</button>';
    box.querySelector("strong").textContent = "Timeout is not wired up";
    box.querySelector("span").textContent = what + " " + fix;
    box.querySelector("button").addEventListener("click", function () {
      box.remove();
    });
    (document.body || document.documentElement).appendChild(box);
  }

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
        if (!m) return;
        heardOne();
        if (m.act === "state" || m.act === "cue" || m.act === "you") return;
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
        heardOne();
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

      /* The button in the tool rows, when the template has it. When it does
       * not — an older control.html, a cached page — put one on the screen
       * anyway rather than leaving the whole feature unreachable. */
      var opener = document.getElementById("open-games");
      if (!opener && IS_TEACHER) {
        opener = document.createElement("button");
        opener.id = "open-games";
        opener.type = "button";
        opener.className = "pad-float is-opener";
        opener.textContent = "Timeout";
        document.body.appendChild(opener);
      }
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
      if (kind === "padplus") return padPlus(spec);
      if (kind === "grid") return padGrid(spec);
      if (kind === "word") return padWord(spec);
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

    /* A direction pad that holds, with action buttons beside it. Anything
     * that has to move and do something at the same time uses this. */
    function padPlus(spec) {
      var box = document.createElement("div");
      box.className = "pad-plus";
      var cross = document.createElement("div");
      cross.className = "pad-dpad";
      cross.dataset.axis = spec.axis || "";
      var dirs = spec.axis === "x" ? [["left", "\u25C0", "l"], ["right", "\u25B6", "r"]]
        : [["up", "\u25B2", "u"], ["left", "\u25C0", "l"],
           ["right", "\u25B6", "r"], ["down", "\u25BC", "d"]];
      dirs.forEach(function (d) {
        var b = bigButton(d[1],
          function () { press(d[0], 1); },
          function () { press(d[0], 0); }, "is-dir");
        b.dataset.dir = d[2];
        b.setAttribute("aria-label", d[0]);
        cross.appendChild(b);
      });
      box.appendChild(cross);

      var acts = document.createElement("div");
      acts.className = "pad-acts";
      (spec.keys || []).forEach(function (k) {
        acts.appendChild(bigButton(k.label,
          function () { press(k.k, 1); },
          function () { press(k.k, 0); }, "is-act"));
      });
      box.appendChild(acts);
      controls.appendChild(box);
    }

    /* The board, small enough to tap. The projector sends the position with
     * every change, so this is a mirror and never a second opinion. */
    function padGrid(spec) {
      var cols = Math.max(1, Math.min(12, spec.cols || 4));
      var rows = Math.max(1, Math.min(12, spec.rows || 4));
      var wrapper = document.createElement("div");
      wrapper.className = "pad-grid-wrap";
      if (spec.label) {
        var lab = document.createElement("p");
        lab.className = "pad-note";
        lab.textContent = spec.label;
        wrapper.appendChild(lab);
      }
      var grid = document.createElement("div");
      grid.className = "pad-grid";
      grid.style.setProperty("--cols", cols);
      grid.style.setProperty("--rows", rows);
      var cells = spec.cells || [], hi = spec.hi || [];
      for (var i = 0; i < cols * rows; i++) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "pad-cell";
        b.dataset.i = i;
        b.dataset.dark = ((i / cols | 0) + (i % cols)) % 2 ? "1" : "0";
        if (hi.indexOf(i) >= 0) b.dataset.hi = "1";
        b.textContent = cells[i] || "";
        b.addEventListener("pointerdown", function (e) {
          e.preventDefault();
          press("cell", Number(e.currentTarget.dataset.i));
        });
        grid.appendChild(b);
      }
      wrapper.appendChild(grid);
      controls.appendChild(wrapper);
    }

    /* A box to type in. The keyboard covers half the phone, so the answer
     * being typed is the only thing on screen that matters. */
    function padWord(spec) {
      var box = document.createElement("div");
      box.className = "pad-word";
      box.innerHTML =
        '<p class="word-clue"></p><p class="word-hint"></p>' +
        '<input type="text" inputmode="text" autocomplete="off" ' +
        'autocorrect="off" autocapitalize="characters" spellcheck="false" ' +
        'maxlength="16" aria-label="Your answer">' +
        '<button class="pad-btn is-send" type="button">Send</button>';
      box.querySelector(".word-clue").textContent = spec.label || "";
      box.querySelector(".word-hint").textContent = spec.hint || "";
      var field = box.querySelector("input");
      var go = box.querySelector("button");
      function submit() {
        var val = field.value.trim();
        if (!val) return;
        press("word", val.slice(0, 16));
        field.value = "";
        field.focus();
      }
      go.addEventListener("click", submit);
      field.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); submit(); }
      });
      controls.appendChild(box);
      setTimeout(function () { field.focus(); }, 120);
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

  /* --- boot ---------------------------------------------------------- */

  /* Script order is the usual culprit, so wait a moment for the board to
   * finish setting itself up before deciding anything is missing. */
  /* The board's own socket, opened by us, used when the page will not lend
   * us its one. A second connection to the same room is a few bytes and one
   * extra `peer` announcement; a feature that does not work at all is worse.
   * Everything else about it is identical — same room, same board number,
   * same server rules about who may start a game. */
  function ownSocket() {
    var node = document.getElementById("chalk-config");
    if (!node || !global.ChalkNet) return null;
    var CFG;
    try { CFG = JSON.parse(node.textContent); } catch (e) { return null; }
    if (!CFG || !CFG.code) return null;
    var role = CFG.role === "stage" ? "stage"
             : CFG.role === "join" ? "join" : "control";
    var net = global.ChalkNet(CFG.code, {
      onOpen: function () {
        net.send({ t: "hello", role: role, token: CFG.token || "" });
        setTimeout(function () {
          send({ t: "game", act: "join", who: (CFG.me && CFG.me.name) || "" });
        }, 250);
      },
      onDenied: function (m) {
        complain("The board refused the game connection: " +
                 ((m && m.reason) || "not paired."),
                 "Rescan the board number and try again.");
      },
      onMessage: function (m) {
        if (m && m.t === "game" && global.ChalkArcade) global.ChalkArcade.frame(m);
      }
    });
    return { net: net, cfg: CFG, role: role, own: true };
  }

  function boot(tries) {
    B = global.ChalkBoard;
    if (!B || !B.net) {
      /* Script order first: the board may simply not have got there yet. */
      if (tries < 15) return setTimeout(function () { boot(tries + 1); }, 100);
      B = ownSocket();
      if (!B) {
        return complain(
          "There is no socket to play over: window.ChalkBoard was never set " +
          "and chalk_net.js is not on the page either.",
          "Check the script tags in the template, then hard-reload."
        );
      }
      if (global.console && console.info) {
        console.info("[Chalk Timeout] window.ChalkBoard is not set — opened " +
                     "a socket of our own instead.");
      }
    }
    if (!global.ChalkGames) {
      return complain(
        "chalk_games.js did not load.",
        "Check the <script> tags in the template and that the file is in " +
        "static/chalk/js/ — then run collectstatic and hard-reload."
      );
    }
    if (!global.ChalkGames.list().length) {
      return complain(
        "The engine loaded but no games registered themselves.",
        "chalk_games_pack.js and chalk_games_class.js are missing or 404ing. " +
        "Both must load after chalk_games.js and before chalk_arcade.js."
      );
    }

    IS_STAGE = B.role === "stage";
    IS_TEACHER = B.role === "stage" || B.role === "control";
    if (IS_STAGE) mountStage(); else mountPad();
    if (global.console && console.info) {
      console.info("[Chalk Timeout] " + VERSION + " ready as " + B.role +
                   " — " + global.ChalkGames.list().length + " games" +
                   (B.own ? ", on its own socket." : "."));
    }
    link();
  }

  /* Borrowing the page's socket only works if the page hands game frames
   * back — that is the `case "game"` line. Rather than trust it, ask: the
   * server answers every join directly with {"act":"you"}. Silence means the
   * frames go out and nothing comes back, so open a socket that does. */
  function link() {
    send({ t: "game", act: "join", who: (B.cfg && B.cfg.me && B.cfg.me.name) || "" });
    watch = setTimeout(function () {
      watch = null;
      if (heard) return;
      if (!B.own) {
        var own = ownSocket();
        if (own) {
          B = own;
          if (global.console && console.info) {
            console.info("[Chalk Timeout] the page's socket does not pass game " +
                         "frames on (the case \"game\" line is missing) — " +
                         "opened a second socket instead.");
          }
          watch = setTimeout(serverSilent, 8000);
          return;
        }
      }
      serverSilent();
    }, 4000);
  }

  function serverSilent() {
    if (heard) return;
    complain(
      "Game frames are going out and nothing is coming back, so the server " +
      "is dropping them.",
      "consumers.py needs the `elif t == \"game\":` branch — and the ASGI " +
      "server needs restarting afterwards, which the autoreloader does not " +
      "always do for Channels consumers."
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { boot(0); });
  } else {
    boot(0);
  }
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
