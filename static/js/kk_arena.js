/* KnockKnock Arena — the show director for live game sessions.
 *
 * A purely additive layer: it never edits play.js / present.js. Like the
 * rooms and stats shims already in these templates, it wraps
 * window.WebSocket BEFORE those scripts open their socket and listens to
 * the same messages (state · leaderboard · answer_ack · answer_rejected ·
 * correct_answer · ended). Everything it draws is its own overlay.
 *
 * BIG SCREEN (present.html, #stage[data-kind=game])
 *   • Lobby "arena floor": every player's character drops in, wanders,
 *     dances, with a join pop sound and lobby music.
 *   • Question intro: "Question 3 of 10" + 3-2-1 ring (skipped when you
 *     reload mid-question).
 *   • Live answer meter: "⚡ 7 / 12 answered", chime when everyone is in.
 *   • Tension music that speeds up for the last 5 seconds, ticking clock,
 *     red pulse on the screen edge.
 *   • Reveal sting, then an animated scoreboard race (rank changes slide,
 *     scores count up, 🔥 answer streaks, ▲ movers). Auto-opens 4s after the
 *     reveal (toggle 🏆 in the dock), or press L / the Scoreboard button.
 *   • Grand finale podium: drumroll, 3rd → 2nd → 1st rise, characters drop
 *     onto the blocks, confetti, fanfare, victory music.
 *   • Sidebar leaderboard rows get their real characters.
 *
 * PHONE (play_game.html, #play[data-kind=game])
 *   • Character builder on the join screen (12 species × 12 colours ×
 *     12 gear × 6 faces), remembered on the device for next time.
 *   • Waiting room: big dancing character (tap it), crowd of other players.
 *   • Full-screen answer result: Correct / Not quite / Too late / Time's up,
 *     points, 🔥 streak, live rank ("2nd — 120 behind Awa"), haptics.
 *   • Last-5-seconds pulse, tiles spring in on each question.
 *   • Personal finale: your place, your score, confetti for the top 3.
 *   • Sound is OFF by default on phones (toggle bottom-left).
 *
 * Load order in the template:
 *   avatar_data.html → kk_avatars.js → kk_sound.js → kk_arena.js → play.js/present.js
 */
(function () {
  "use strict";

  var stageEl = document.getElementById("stage");
  var playEl = document.getElementById("play");
  var IS_HOST = !!(stageEl && stageEl.dataset.kind === "game");
  var IS_PHONE = !IS_HOST && !!(playEl && playEl.dataset.kind === "game");
  if (!IS_HOST && !IS_PHONE) return;

  var A = window.KKAvatar;
  var S = window.KKSound;
  if (!A || !S) { console.warn("[arena] kk_avatars.js / kk_sound.js must load first"); return; }
  S.init({ role: IS_HOST ? "presenter" : "phone" });

  var CODE = (IS_HOST ? stageEl : playEl).dataset.code;
  var host = IS_HOST ? stageEl : document.body;   // fullscreen-safe mount point

  // ═══════════════════════ utilities ═══════════════════════
  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function el(tag, cls, htmlStr) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (htmlStr != null) n.innerHTML = htmlStr;
    return n;
  }
  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* ignore */ } }
  function countUp(node, from, to, ms) {
    var t0 = performance.now();
    from = Number(from) || 0; to = Number(to) || 0;
    (function step(now) {
      var p = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - p, 3);
      node.textContent = Math.round(from + (to - from) * e).toLocaleString();
      if (p < 1) requestAnimationFrame(step);
    })(t0);
  }
  function rowKey(r) { return r.slug ? "room:" + r.slug : (r.name || "") + "|" + (r.avatar_id || ""); }

  // ═══════════════════════ confetti ═══════════════════════
  function confetti(opts) {
    opts = opts || {};
    var cv = el("canvas", "kka-confetti");
    host.appendChild(cv);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = cv.width = innerWidth * dpr, H = cv.height = innerHeight * dpr;
    cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px";
    var g = cv.getContext("2d");
    var colors = ["#ffd32a", "#ff6b6b", "#48dbfb", "#1dd1a1", "#f368e0", "#a29bfe", "#ff9f43", "#fff"];
    var N = opts.count || 160, parts = [];
    for (var i = 0; i < N; i++) {
      var fromSides = opts.sides && i % 2;
      parts.push({
        x: fromSides ? (i % 4 < 2 ? 0 : W) : W * rand(0.1, 0.9),
        y: fromSides ? H * rand(0.5, 0.8) : -rand(10, H * 0.4),
        vx: fromSides ? (i % 4 < 2 ? 1 : -1) * rand(4, 13) * dpr : rand(-2, 2) * dpr,
        vy: fromSides ? -rand(8, 18) * dpr : rand(1, 4) * dpr,
        w: rand(6, 12) * dpr, h: rand(8, 16) * dpr,
        r: rand(0, 6.28), vr: rand(-0.25, 0.25),
        c: pick(colors), circle: Math.random() < 0.25, wob: rand(0, 6.28),
      });
    }
    var t0 = performance.now(), dur = opts.duration || 4200;
    (function frame(now) {
      var el2 = now - t0;
      g.clearRect(0, 0, W, H);
      parts.forEach(function (p) {
        p.vy += 0.16 * dpr; p.vx *= 0.99; p.wob += 0.1;
        p.x += p.vx + Math.sin(p.wob) * dpr; p.y += p.vy; p.r += p.vr;
        g.save(); g.translate(p.x, p.y); g.rotate(p.r);
        g.globalAlpha = Math.max(0, 1 - Math.max(0, el2 - dur + 900) / 900);
        g.fillStyle = p.c;
        if (p.circle) { g.beginPath(); g.arc(0, 0, p.w / 2, 0, 6.28); g.fill(); }
        else g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.wob)));
        g.restore();
      });
      if (el2 < dur) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }

  // ═══════════════════════ socket tap ═══════════════════════
  var handlers = [];
  (function wrapSocket() {
    var Real = window.WebSocket;
    function Wrapped(url, protocols) {
      var ws = protocols ? new Real(url, protocols) : new Real(url);
      if (typeof url === "string" && url.indexOf("/ws/session/") !== -1) {
        ws.addEventListener("open", function () { G.openedAt = Date.now(); });
        ws.addEventListener("message", function (ev) {
          var m;
          try { m = JSON.parse(ev.data); } catch (e) { return; }
          handlers.forEach(function (h) { try { h(m); } catch (e) { console.warn("[arena]", e); } });
        });
      }
      return ws;
    }
    Wrapped.prototype = Real.prototype;
    Wrapped.CONNECTING = Real.CONNECTING; Wrapped.OPEN = Real.OPEN;
    Wrapped.CLOSING = Real.CLOSING; Wrapped.CLOSED = Real.CLOSED;
    window.WebSocket = Wrapped;
  })();

  // ═══════════════════════ shared game clock ═══════════════════════
  var G = {
    st: null, qid: null, index: -1, total: 0, participants: 0,
    lb: { mode: "individuals", rows: [] },
    skew: 0, startedMs: null, limit: 0, ext: 0,
    revealedQ: null, tickSecond: null, timeupFiredQ: null, openedAt: 0,
  };

  function secondsLeft() {
    if (!G.startedMs) return null;
    var now = Date.now() + G.skew;
    return Math.max(0, Math.ceil((G.startedMs + (G.limit + G.ext) * 1000 - now) / 1000));
  }

  function absorbState(s) {
    G.st = s;
    if (typeof s.server_time_ms === "number") G.skew = s.server_time_ms - Date.now();
    G.startedMs = typeof s.question_started_at_ms === "number" ? s.question_started_at_ms : null;
    G.ext = Number(s.time_extension_seconds || 0);
    G.limit = s.question ? Number(s.question.time_limit || 0) : 0;
    G.index = Number(s.index != null ? s.index : -1);
    G.total = Number(s.total || 0);
    G.participants = Number(s.participants || 0);
  }

  // ═══════════════════════ sound dock ═══════════════════════
  var dock = null;
  function buildDock() {
    dock = el("div", "kka-dock" + (IS_PHONE ? " kka-dock--phone" : ""));
    dock.setAttribute("role", "group");
    dock.setAttribute("aria-label", "Game sound");
    var sBtn = el("button", "", "🔊"), mBtn = el("button", "", "🎵");
    sBtn.type = mBtn.type = "button";
    dock.appendChild(sBtn);
    dock.appendChild(mBtn);

    var vol = null, bBtn = null;
    if (IS_HOST) {
      dock.appendChild(el("span", "kka-dock-sep"));
      vol = el("input");
      vol.type = "range"; vol.min = "0"; vol.max = "1"; vol.step = "0.05";
      vol.setAttribute("aria-label", "Volume");
      vol.addEventListener("input", function () { S.setVolume(vol.value); });
      dock.appendChild(vol);
      dock.appendChild(el("span", "kka-dock-sep"));
      bBtn = el("button", "", "🏆");
      bBtn.type = "button";
      bBtn.addEventListener("click", function () {
        HOST.autoBoard = !HOST.autoBoard;
        try { localStorage.setItem("kka-autoboard", HOST.autoBoard ? "1" : "0"); } catch (e) { /* ignore */ }
        paint();
      });
      dock.appendChild(bBtn);
    }
    var hint = el("div", "kka-dock-hint", IS_HOST ? "🔊 Click anywhere to switch the game sound on" : "");
    if (IS_HOST) dock.appendChild(hint);

    sBtn.addEventListener("click", function () { S.setEnabled(!S.enabled()); if (S.enabled()) S.sfx("join"); paint(); });
    mBtn.addEventListener("click", function () {
      var next = !S.musicOn();
      if (next && !S.enabled()) S.setEnabled(true);
      S.setMusic(next); paint();
    });

    function setLabel(b, t) { b.title = t; b.setAttribute("aria-label", t); }
    function paint() {
      sBtn.textContent = S.enabled() ? "🔊" : "🔇";
      sBtn.classList.toggle("is-off", !S.enabled());
      setLabel(sBtn, S.enabled() ? "Sound on — click to mute" : "Sound off — click to turn on");
      mBtn.classList.toggle("is-off", !S.musicOn() || !S.enabled());
      setLabel(mBtn, S.musicOn() ? "Music on — click to stop" : "Music off — click to play");
      if (IS_PHONE) mBtn.style.display = S.enabled() ? "" : "none";
      if (vol) vol.value = String(S.volume());
      if (bBtn) {
        bBtn.classList.toggle("is-off", !HOST.autoBoard);
        setLabel(bBtn, HOST.autoBoard ? "Scoreboard opens automatically after each answer" : "Scoreboard opens only when you press L");
      }
      hint.style.display = (IS_HOST && S.enabled() && !S.unlocked()) ? "" : "none";
    }
    S.onChange(paint);
    paint();
    host.appendChild(dock);
    // Fade the dock while a question is up so it never competes with content.
    return { paint: paint };
  }

  // ═════════════════════════════════════════════════════════════
  //                         BIG SCREEN
  // ═════════════════════════════════════════════════════════════
  var HOST = {
    autoBoard: (function () { try { return localStorage.getItem("kka-autoboard") !== "0"; } catch (e) { return true; } })(),
    floor: null, floorMap: {}, floorTimer: null,
    live: null, liveCount: 0, liveSeen: {}, lastJoinAt: 0, allInFired: false,
    fab: null, boardTimer: null, board: null,
    prevSnap: {}, snap: null, streaks: {},
    podiumShown: false, introQ: null,
  };

  function hostInit() {
    buildDock();

    // Lobby floor
    HOST.floor = el("div", "kka-floor", '<div class="kka-floor-count"><b>0</b>players</div><div class="kka-floor-more"></div>');
    host.appendChild(HOST.floor);

    // Live answer meter
    HOST.live = el("div", "kka-live",
      '<span class="kka-live-bolt">⚡</span><span class="kka-live-num">0 / 0</span>' +
      '<span class="kka-live-bar"><i></i></span><span class="kka-live-label">answered</span>');
    host.appendChild(HOST.live);

    // Scoreboard button
    HOST.fab = el("button", "kka-fab", "🏆 <span>Scoreboard</span> <kbd style=\"opacity:.6;font:600 11px system-ui\">L</kbd>");
    HOST.fab.type = "button";
    HOST.fab.addEventListener("click", function () { showBoard(); });
    host.appendChild(HOST.fab);

    document.addEventListener("keydown", function (e) {
      var tag = document.activeElement ? document.activeElement.tagName : "";
      if (["INPUT", "TEXTAREA", "SELECT"].indexOf(tag) >= 0) return;
      if ((e.key === "l" || e.key === "L") && HOST.snap) { HOST.board ? closeOverlay(HOST.board) : showBoard(); }
      if (e.key === "Escape") { closeAllOverlays(); }
    });

    // Real characters in the sidebar leaderboard.
    var lbEl = $("leaderboard");
    if (lbEl) {
      new MutationObserver(function () { upgradeSidebar(lbEl); }).observe(lbEl, { childList: true });
    }

    setInterval(hostTick, 250);
    // Random lobby emotes keep the floor alive.
    HOST.floorTimer = setInterval(function () {
      if (!G.st || G.st.state !== "lobby") return;
      var keys = Object.keys(HOST.floorMap);
      if (!keys.length) return;
      var node = HOST.floorMap[pick(keys)];
      var av = node && node.querySelector(".kka-av");
      if (av) A.flash(av, pick(["dance", "wave", "cheer", "dance"]), 2200);
    }, 1800);
  }

  function upgradeSidebar(lbEl) {
    if (G.lb.mode !== "individuals") return;
    var rows = window.kkLeaderboardRows || G.lb.rows || [];
    lbEl.querySelectorAll(".kk-lb-row").forEach(function (row, i) {
      var r = rows[i], bub = row.querySelector(".kk-avatar-bubble");
      if (!r || !bub || bub.dataset.kka === r.avatar_id) return;
      bub.dataset.kka = r.avatar_id;
      bub.textContent = "";
      bub.style.background = "transparent";
      bub.style.boxShadow = "none";
      bub.style.overflow = "visible";
      bub.innerHTML = A.html(r.avatar_id, { size: 34 });
    });
  }

  // ─────────────── lobby floor ───────────────
  var joinSoundAt = 0;
  function syncFloor() {
    var rows = G.lb.rows || [];
    var on = G.st && G.st.state === "lobby";
    HOST.floor.classList.toggle("is-on", !!on && (rows.length > 0 || G.participants > 0));
    document.body.classList.toggle("kka-has-floor", !!on);
    HOST.floor.querySelector(".kka-floor-count b").textContent = String(G.participants || rows.length);
    if (!on) return;

    // Keep the floor under the main stage so it never covers the sidebar.
    var main = $("stage-main");
    var right = main ? Math.max(0, innerWidth - main.getBoundingClientRect().right) : 0;
    HOST.floor.style.right = right + "px";

    var MAX = innerWidth < 900 ? 14 : 30;
    var seen = {};
    var slot = Object.keys(HOST.floorMap).length;
    rows.slice(0, MAX).forEach(function (r) {
      var k = rowKey(r);
      seen[k] = true;
      if (HOST.floorMap[k]) return;
      var n = el("div", "kka-floor-p is-new",
        A.html(r.avatar_id, { size: innerWidth < 900 ? 64 : 84, mood: "wave" }) +
        '<span class="kka-floor-name">' + esc(r.name) + (r.members ? " · " + r.members : "") + "</span>");
      // Golden-ratio spread: evenly scattered, never clumped, no overlap with
      // the sound dock on the left or the player counter on the right.
      n.style.setProperty("--x", (18 + ((slot++ * 0.618034) % 1) * 66 + rand(-2, 2)).toFixed(1) + "%");
      n.style.setProperty("--wx", rand(16, 70).toFixed(0) + "px");
      n.style.setProperty("--wd", rand(9, 20).toFixed(1) + "s");
      n.style.zIndex = String(Math.floor(rand(1, 40)));
      HOST.floor.appendChild(n);
      HOST.floorMap[k] = n;
      var av = n.querySelector(".kka-av");
      setTimeout(function () { A.setMood(av, "idle"); n.classList.remove("is-new"); }, 2400);
      var now = Date.now();
      if (now - joinSoundAt > 140) { S.sfx("join"); joinSoundAt = now; }
    });
    Object.keys(HOST.floorMap).forEach(function (k) {
      if (!seen[k]) { HOST.floorMap[k].remove(); delete HOST.floorMap[k]; }
    });
    var extra = Math.max(0, (G.participants || rows.length) - Math.min(rows.length, MAX));
    HOST.floor.querySelector(".kka-floor-more").textContent = extra ? "+" + extra + " more" : "";
  }

  // ─────────────── live meter ───────────────
  function paintLive() {
    var total = Math.max(G.participants, 1);
    var n = Math.min(HOST.liveCount, G.participants);
    HOST.live.querySelector(".kka-live-num").textContent = n + " / " + G.participants;
    HOST.live.querySelector(".kka-live-bar i").style.width = Math.round((n / total) * 100) + "%";
    var full = G.participants > 0 && n >= G.participants;
    HOST.live.classList.toggle("is-full", full);
    HOST.live.querySelector(".kka-live-label").textContent = full ? "everyone's in!" : "answered";
    if (full && !HOST.allInFired) { HOST.allInFired = true; S.sfx("allin"); }
  }

  // ─────────────── clock ───────────────
  function hostTick() {
    var s = G.st;
    var running = s && s.state === "running" && s.question && G.revealedQ !== G.qid;
    var left = running ? secondsLeft() : null;
    var urgent = running && left !== null && left > 0 && left <= 5;
    host.classList.toggle("kka-urgent", !!urgent);
    S.urgency(!!urgent);
    if (urgent && G.tickSecond !== left) { G.tickSecond = left; S.sfx(left <= 3 ? "tickUrgent" : "tick"); }
    if (running && left === 0 && G.timeupFiredQ !== G.qid) {
      G.timeupFiredQ = G.qid;
      S.sfx("timeup");
      S.music(null);
    }
  }

  // ─────────────── state ───────────────
  function hostOnState(s) {
    var prevParticipants = G.participants;
    var prevQ = G.qid;
    absorbState(s);
    if (G.participants !== prevParticipants) HOST.lastJoinAt = Date.now();

    if (s.state === "lobby") {
      G.qid = null;
      closeAllOverlays();
      HOST.live.classList.remove("is-on");
      HOST.fab.classList.remove("is-on", "is-pulse");
      HOST.podiumShown = false;
      S.music("lobby");
      syncFloor();
      return;
    }

    HOST.floor.classList.remove("is-on");
    document.body.classList.remove("kka-has-floor");

    if (s.state === "ended") {
      HOST.live.classList.remove("is-on");
      HOST.fab.classList.remove("is-on", "is-pulse");
      host.classList.remove("kka-urgent");
      showPodium();
      return;
    }

    if (s.state === "running" && s.question) {
      var q = s.question;
      G.qid = q.id;
      if (prevQ !== q.id) {
        closeAllOverlays();
        clearTimeout(HOST.boardTimer);
        HOST.fab.classList.remove("is-on", "is-pulse");
        HOST.liveCount = 0; HOST.liveSeen = {}; HOST.allInFired = false;
        G.tickSecond = null;

        var left = secondsLeft();
        var alreadyRevealed = left === 0 && !!s.tally;
        if (alreadyRevealed) {
          G.revealedQ = q.id;
          S.music(null);
          HOST.fab.classList.add("is-on");
        } else {
          G.revealedQ = null;
          HOST.live.classList.add("is-on");
          S.music("think");
          var elapsed = G.startedMs ? (Date.now() + G.skew - G.startedMs) / 1000 : 0;
          if (elapsed < 2.5 && HOST.introQ !== q.id) showIntro(s);
        }
        HOST.introQ = q.id;
        paintLive();
      }
    }
  }

  function hostOnLeaderboard(m) {
    var prevRows = G.lb.rows || [];
    G.lb = m.data || { mode: "individuals", rows: [] };
    if (!G.st) return;
    if (G.st.state === "lobby") { syncFloor(); return; }
    if (G.st.state === "running" && G.qid && G.revealedQ !== G.qid) {
      // Leaderboards are broadcast after each recorded answer (and after a
      // join). Joins bump the participant count first, so skip those.
      if (Date.now() - HOST.lastJoinAt < 1500 && (G.lb.rows || []).length !== prevRows.length) return;
      // The server also sends standings right after this screen (re)connects.
      if (Date.now() - (G.openedAt || 0) < 1500) return;
      HOST.liveCount += 1;
      paintLive();
    }
  }

  function hostOnReveal(m) {
    if (!G.qid || String(m.question_id) !== String(G.qid) || G.revealedQ === G.qid) return;
    G.revealedQ = G.qid;
    host.classList.remove("kka-urgent");
    S.urgency(false);
    S.music(null);
    S.sfx("reveal");
    setTimeout(function () { HOST.live.classList.remove("is-on"); }, 1800);
    // Give the final leaderboard broadcast a moment to land, then snapshot.
    setTimeout(takeSnapshot, 450);
    HOST.fab.classList.add("is-on", "is-pulse");
    clearTimeout(HOST.boardTimer);
    if (HOST.autoBoard) {
      HOST.boardTimer = setTimeout(function () {
        if (G.revealedQ === G.qid && G.st && G.st.state === "running") showBoard();
      }, 4200);
    }
  }

  function takeSnapshot() {
    var rows = (G.lb.rows || []).slice();
    var rooms = G.lb.mode === "rooms";
    var prev = HOST.prevSnap;
    var snap = rows.map(function (r, i) {
      var k = rowKey(r), p = prev[k];
      var gained = Math.max(0, Number(r.score || 0) - (p ? Number(p.score || 0) : 0));
      if (!rooms) HOST.streaks[k] = gained > 0 ? (HOST.streaks[k] || 0) + 1 : 0;
      return {
        key: k, name: r.name, avatar_id: r.avatar_id, score: Number(r.score || 0), members: r.members,
        rank: i + 1, prevRank: p ? p.rank : null, prevScore: p ? p.score : 0, gained: gained,
        streak: rooms ? 0 : HOST.streaks[k],
      };
    });
    HOST.snap = { rows: snap, index: G.index, total: G.total, rooms: rooms };
    var next = {};
    snap.forEach(function (r) { next[r.key] = { rank: r.rank, score: r.score }; });
    HOST.prevSnap = next;
  }

  // ─────────────── overlays ───────────────
  var overlays = [];
  function openOverlay(cls, inner, interactive) {
    var ov = el("div", "kka-ov " + (cls || "") + (interactive ? " is-interactive" : ""), '<div class="kka-ov-dim"></div>' + inner);
    host.appendChild(ov);
    overlays.push(ov);
    return ov;
  }
  function closeOverlay(ov) {
    if (!ov || ov._closing) return;
    ov._closing = true;
    ov.classList.add("is-out");
    overlays = overlays.filter(function (o) { return o !== ov; });
    if (ov === HOST.board) HOST.board = null;
    setTimeout(function () { ov.remove(); }, 360);
  }
  function closeAllOverlays() { overlays.slice().forEach(closeOverlay); }

  function showIntro(s) {
    var q = s.question || {};
    var ov = openOverlay("kka-intro-ov",
      '<div class="kka-intro-burst">' + Array.apply(null, Array(12)).map(function (_, i) { return '<i style="rotate:' + (i * 30) + 'deg"></i>'; }).join("") + "</div>" +
      '<div class="kka-intro">' +
        '<div class="kka-intro-kicker">Question ' + (G.index + 1) + " of " + G.total + "</div>" +
        '<div class="kka-intro-q">' + esc(q.text || "") + "</div>" +
        '<div class="kka-intro-ring" style="--dur:1.8s"><svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="46"/><circle class="fg" cx="50" cy="50" r="46"/></svg><span>3</span></div>' +
      "</div>");
    var num = ov.querySelector(".kka-intro-ring span");
    S.sfx("whoosh");
    setTimeout(function () { num.textContent = "2"; S.sfx("beep"); }, 600);
    setTimeout(function () { num.textContent = "1"; S.sfx("beep"); }, 1200);
    setTimeout(function () { num.textContent = "GO"; S.sfx("go"); }, 1800);
    setTimeout(function () { closeOverlay(ov); }, 2150);
  }

  function nextLabel() {
    return G.index >= G.total - 1 ? "Final podium 🏆" : "Next question ▶";
  }

  function showBoard() {
    if (!HOST.snap) takeSnapshot();
    var snap = HOST.snap;
    if (!snap || !snap.rows.length) return;
    if (HOST.board) closeOverlay(HOST.board);
    HOST.fab.classList.remove("is-pulse");

    var N = Math.min(5, snap.rows.length);
    var RH = Math.max(64, Math.min(92, Math.round(innerHeight * 0.085)));
    var GAP = 12;
    var top = snap.rows.slice(0, N);
    var ov = openOverlay("kka-board-ov",
      '<button type="button" class="kka-close" aria-label="Close scoreboard">✕</button>' +
      '<div class="kka-board">' +
        "<h2>" + (snap.rooms ? "Room standings" : "Leaderboard") + "</h2>" +
        '<div class="kka-board-sub">After question ' + (snap.index + 1) + " of " + snap.total + "</div>" +
        '<div class="kka-board-list" style="height:' + (N * (RH + GAP)) + "px;--rh:" + RH + 'px"></div>' +
        '<div style="text-align:center;margin-top:22px"><button type="button" class="kka-fab is-on kka-board-next" style="position:static;display:inline-flex">' + nextLabel() + "</button></div>" +
      "</div>", true);
    HOST.board = ov;
    S.sfx("swoosh");

    var list = ov.querySelector(".kka-board-list");
    var anyStreak = false;
    top.forEach(function (r, i) {
      var startRank = r.prevRank && r.prevRank <= N + 1 ? r.prevRank : N + 1;
      var move = r.prevRank ? r.prevRank - r.rank : null;
      var moveHtml = move === null ? (snap.index > 0 ? '<span class="kka-row-move new">NEW</span>' : "")
        : move > 0 ? '<span class="kka-row-move up">▲ ' + move + "</span>"
        : move < 0 ? '<span class="kka-row-move down">▼ ' + (-move) + "</span>" : "";
      if (r.streak >= 2) anyStreak = true;
      var row = el("div", "kka-row r" + r.rank,
        '<span class="kka-row-rank">' + r.rank + "</span>" +
        A.html(r.avatar_id, { size: RH * 0.78, mood: r.gained > 0 ? "cheer" : "idle" }) +
        '<span class="kka-row-name">' + esc(r.name) + (r.members ? ' <small style="opacity:.6">· ' + r.members + " players</small>" : "") + "</span>" +
        moveHtml +
        (r.streak >= 2 ? '<span class="kka-streak">🔥 ' + r.streak + "</span>" : "") +
        '<span class="kka-row-score"><span class="n">' + r.prevScore + "</span>" + (r.gained ? '<span class="kka-row-gain">+' + Math.round(r.gained) + "</span>" : "") + "</span>");
      row.style.transform = "translateY(" + ((startRank - 1) * (RH + GAP)) + "px)";
      row.style.opacity = startRank > N ? "0" : "1";
      list.appendChild(row);
      setTimeout(function () {
        row.style.transition = "transform 1.1s cubic-bezier(.3,1.2,.4,1), opacity .5s, background .4s";
        row.style.transform = "translateY(" + (i * (RH + GAP)) + "px)";
        row.style.opacity = "1";
        countUp(row.querySelector(".n"), r.prevScore, r.score, 1200);
      }, 280 + i * 70);
      var av = row.querySelector(".kka-av");
      if (r.gained > 0) setTimeout(function () { A.setMood(av, "idle"); }, 2600);
    });
    if (anyStreak) setTimeout(function () { S.sfx("streak"); }, 900);

    ov.querySelector(".kka-close").addEventListener("click", function () { closeOverlay(ov); });
    ov.querySelector(".kka-ov-dim").addEventListener("click", function () { closeOverlay(ov); });
    ov.querySelector(".kka-board-next").addEventListener("click", function () {
      var btn = $("btn-next") || $("btn-fs-next");
      closeOverlay(ov);
      if (btn && !btn.disabled) btn.click();
    });
  }

  function showPodium() {
    if (HOST.podiumShown) return;
    var rows = (G.lb.rows || []).slice(0, 10);
    if (!rows.length) return;
    HOST.podiumShown = true;
    closeAllOverlays();
    S.music(null);

    var order = [1, 0, 2]; // 2nd · 1st · 3rd left-to-right
    var steps = order.map(function (i) {
      var r = rows[i];
      if (!r) return '<div class="kka-step" style="visibility:hidden"></div>';
      var p = i + 1;
      return '<div class="kka-step p' + p + '" data-p="' + p + '">' +
        '<div class="kka-step-who">' + A.html(r.avatar_id, { size: p === 1 ? "clamp(110px,13vw,170px)" : "clamp(90px,10vw,140px)", mood: "idle" }) +
          '<div class="kka-step-name">' + esc(r.name) + "</div>" +
          '<div class="kka-step-score"><span class="n">0</span> pts</div></div>' +
        '<div class="kka-block">' + p + "</div></div>";
    }).join("");
    var runners = rows.slice(3).map(function (r, i) {
      return '<span class="kka-runner">' + A.html(r.avatar_id, { size: 30 }) + "<b>" + (i + 4) + "</b>" + esc(r.name) + " · " + Number(r.score || 0) + "</span>";
    }).join("");

    var ov = openOverlay("kka-podium-ov",
      '<div class="kka-spot"></div>' +
      '<button type="button" class="kka-close" aria-label="Close podium">✕</button>' +
      '<div class="kka-podium-wrap">' +
        '<h1 class="kka-podium-title">🏆 The podium</h1>' +
        '<p class="kka-podium-sub">And the winner is…</p>' +
        '<div class="kka-podium">' + steps + "</div>" +
        '<div class="kka-runners">' + runners + "</div>" +
      "</div>", true);
    ov.querySelector(".kka-close").addEventListener("click", function () { closeOverlay(ov); S.music(null); });

    var sub = ov.querySelector(".kka-podium-sub");
    function reveal(p, delay, big) {
      setTimeout(function () {
        var st = ov.querySelector('.kka-step[data-p="' + p + '"]');
        if (!st) return;
        var r = rows[p - 1];
        st.classList.add("is-up");
        setTimeout(function () {
          st.classList.add("is-in");
          S.sfx(big ? "podium" : "swoosh");
          countUp(st.querySelector(".n"), 0, r.score, 1100);
          A.setMood(st.querySelector(".kka-av"), big ? "win" : "cheer");
          if (big) {
            sub.textContent = (r.name || "Our champion") + " takes the crown!";
            confetti({ count: 220, duration: 5200 });
            setTimeout(function () { confetti({ count: 120, duration: 3800, sides: true }); }, 700);
            setTimeout(function () { S.sfx("fanfare"); }, 300);
            setTimeout(function () { S.music("victory"); }, 2200);
            setTimeout(function () { ov.querySelector(".kka-runners").classList.add("is-in"); }, 1200);
          } else {
            setTimeout(function () { A.setMood(st.querySelector(".kka-av"), "idle"); }, 2400);
          }
        }, 650);
      }, delay);
    }
    S.sfx("drumroll");
    reveal(3, 500);
    reveal(2, 1400);
    reveal(1, 2600, true);
  }

  // ═════════════════════════════════════════════════════════════
  //                            PHONE
  // ═════════════════════════════════════════════════════════════
  var PH = {
    answeredQ: null, score: 0, splash: null, splashTimer: null, endShown: false,
    streak: 0, lastStreakQ: null, rankWanted: null,
  };
  var STREAK_KEY = "kka-streak:" + CODE;
  try {
    var savedStreak = JSON.parse(sessionStorage.getItem(STREAK_KEY) || "null");
    if (savedStreak) { PH.streak = savedStreak.n || 0; PH.lastStreakQ = savedStreak.q || null; }
  } catch (e) { /* ignore */ }

  function myAvatar() {
    return (G.st && G.st.my_avatar) || localStorage.getItem("kk-avatar:" + CODE) || "dragon";
  }
  function myNick() {
    return (G.st && G.st.my_nickname) || localStorage.getItem("kk-nick:" + CODE) || "";
  }
  function myRank() {
    var rows = G.lb.rows || [];
    if (G.lb.mode === "rooms") {
      var room = G.st && G.st.my_room;
      for (var j = 0; j < rows.length; j++) if (rows[j].slug === room) return { rank: j + 1, of: rows.length, rows: rows, rooms: true };
      return null;
    }
    var nick = myNick(), av = myAvatar(), idx = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].name === nick && rows[i].avatar_id === av) { idx = i; break; }
    }
    if (idx < 0) for (var k = 0; k < rows.length; k++) if (rows[k].name === nick) { idx = k; break; }
    if (idx < 0) return null;
    return { rank: idx + 1, of: Math.max(rows.length, G.participants), rows: rows, rooms: false };
  }
  function rankLine() {
    var r = myRank();
    if (!r) return "";
    if (r.rooms) return "Your room is " + ordinal(r.rank) + " of " + r.of;
    if (r.rank === 1) {
      var lead = r.rows[1] ? Number(r.rows[0].score) - Number(r.rows[1].score) : 0;
      return "👑 You're in 1st" + (lead > 0 ? " — " + lead + " pts ahead" : "!");
    }
    var above = r.rows[r.rank - 2];
    var gap = above ? Number(above.score) - Number(r.rows[r.rank - 1].score) : 0;
    return "You're " + ordinal(r.rank) + (above && gap > 0 ? " — " + gap + " behind " + esc(above.name) : "") + "";
  }

  function phoneInit() {
    buildDock();
    initBuilder();
    initWaitRoom();
    setInterval(phoneTick, 250);
  }

  // ─────────────── character builder ───────────────
  function initBuilder() {
    var nickCard = $("step-nick"), grid = $("avatar-grid");
    if (!nickCard || !grid) return;

    var label = grid.previousElementSibling;
    var stored = localStorage.getItem("kk-avatar:" + CODE);
    var parts;
    if (stored && A.isBuilt(stored)) parts = A.parse(stored);
    else {
      try { parts = JSON.parse(localStorage.getItem("kka-build") || "null"); } catch (e) { parts = null; }
      if (!parts || !A.isBuilt(A.encode(parts))) parts = A.random();
    }
    var mode = stored && !A.isBuilt(stored) && window.kkAvatarsById[stored] ? "classic" : "build";

    var wrap = el("div", "kka-builder");
    wrap.innerHTML =
      '<div class="kka-tabs" role="tablist">' +
        '<button type="button" class="kka-tab" data-tab="build" role="tab">✨ Create character</button>' +
        '<button type="button" class="kka-tab" data-tab="classic" role="tab">😀 Classic</button>' +
      "</div>" +
      '<div class="kka-panel" data-panel="build">' +
        '<div class="kka-stagebox"><span class="kka-charname"></span><button type="button" class="kka-dice" aria-label="Surprise me">🎲</button><div class="kka-prev"></div></div>' +
        '<div class="kka-sect">Character</div><div class="kka-strip" data-k="species"></div>' +
        '<div class="kka-sect">Colour</div><div class="kka-strip" data-k="color"></div>' +
        '<div class="kka-sect">Gear</div><div class="kka-strip" data-k="acc"></div>' +
        '<div class="kka-sect">Face</div><div class="kka-strip" data-k="face"></div>' +
      "</div>" +
      '<div class="kka-classic-note" data-panel="classic">Pick a classic emoji fighter instead:</div>';
    nickCard.insertBefore(wrap, label || grid);

    var prev = wrap.querySelector(".kka-prev");
    var nameEl = wrap.querySelector(".kka-charname");
    var strips = {};
    wrap.querySelectorAll(".kka-strip").forEach(function (s) { strips[s.dataset.k] = s; });

    function opt(cls, key, val, inner, title) {
      return '<button type="button" class="kka-opt ' + cls + '" data-k="' + key + '" data-v="' + val + '" title="' + esc(title) + '" aria-label="' + esc(title) + '">' + inner + "</button>";
    }
    function renderStrips() {
      strips.species.innerHTML = A.SPECIES.map(function (s) {
        return opt("kka-opt--sp", "species", s.key, A.html(A.encode({ species: s.key, color: parts.color, acc: "none", face: "happy" }), { size: 56 }), s.label);
      }).join("");
      strips.color.innerHTML = A.COLORS.map(function (c, i) {
        return opt("kka-opt--col", "color", i, '<span style="background:' + c + '"></span>', "Colour " + (i + 1));
      }).join("");
      strips.acc.innerHTML = A.ACCESSORIES.map(function (a) { return opt("kka-opt--emo", "acc", a.key, a.emoji, a.label); }).join("");
      strips.face.innerHTML = A.FACES.map(function (f) { return opt("kka-opt--emo", "face", f.key, f.emoji, f.label); }).join("");
      markOn();
    }
    function markOn() {
      wrap.querySelectorAll(".kka-opt").forEach(function (b) {
        var on = String(parts[b.dataset.k]) === b.dataset.v;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }
    function paintPreview(mood) {
      var id = A.encode(parts);
      A.mount(prev, id, { size: 150, mood: mood || "idle" });
      nameEl.textContent = A.labelFor(id);
      if (mood && mood !== "idle") {
        clearTimeout(prev._t);
        prev._t = setTimeout(function () { A.setMood(prev.querySelector(".kka-av"), "idle"); }, 1300);
      }
    }
    function select(id) {
      var tile = grid.querySelector(".kka-built-tile");
      if (!tile) {
        tile = el("button", "kk-avatar-tile kka-built-tile");
        tile.type = "button";
        tile.style.display = "none";
        tile.setAttribute("aria-hidden", "true");
        tile.tabIndex = -1;
        grid.appendChild(tile);
      }
      tile.dataset.avatarId = id;
      tile.click();               // play.js's grid handler adopts the id
    }
    function apply(mood) {
      var id = A.encode(parts);
      try { localStorage.setItem("kka-build", JSON.stringify(parts)); } catch (e) { /* ignore */ }
      markOn();
      paintPreview(mood);
      if (mode === "build") select(id);
    }
    function setMode(m) {
      mode = m;
      wrap.querySelectorAll(".kka-tab").forEach(function (t) {
        var on = t.dataset.tab === m;
        t.classList.toggle("is-on", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      });
      wrap.querySelector('[data-panel="build"]').style.display = m === "build" ? "" : "none";
      wrap.querySelector('[data-panel="classic"]').style.display = m === "classic" ? "" : "none";
      if (label) label.style.display = "none";
      grid.style.display = m === "classic" ? "" : "none";
      if (m === "build") select(A.encode(parts));
    }

    wrap.addEventListener("click", function (e) {
      var t = e.target.closest(".kka-tab");
      if (t) { setMode(t.dataset.tab); return; }
      var o = e.target.closest(".kka-opt");
      if (o) {
        var k = o.dataset.k;
        parts[k] = k === "color" ? parseInt(o.dataset.v, 10) : o.dataset.v;
        if (k === "color") renderStrips();
        apply(k === "species" || k === "acc" ? "cheer" : "wave");
        S.sfx("lock");
        return;
      }
      if (e.target.closest(".kka-dice")) {
        parts = A.random();
        renderStrips();
        apply("dance");
        S.sfx("boing");
        return;
      }
      if (e.target.closest(".kka-prev")) { A.flash(prev.querySelector(".kka-av"), "cheer", 1200); S.sfx("boing"); vibrate(20); }
    });
    // Tapping a classic tile while in builder mode can't happen (grid hidden),
    // but if another script shows it, follow the user's choice.
    grid.addEventListener("click", function (e) {
      var tile = e.target.closest(".kk-avatar-tile");
      if (tile && !tile.classList.contains("kka-built-tile") && mode === "build") setMode("classic");
    });

    renderStrips();
    paintPreview("wave");
    setMode(mode);
    if (mode === "build") apply();
  }

  // ─────────────── waiting room ───────────────
  var crowdEl = null;
  function initWaitRoom() {
    var wait = $("wait-avatar");
    if (wait) {
      wait.classList.add("kka-wait-av");
      var guard = false;
      var render = function () {
        if (guard) return;
        var id = myAvatar();
        if (wait.dataset.kkaFor === id && wait.querySelector(".kka-av")) return;
        guard = true;
        wait.dataset.kkaFor = id;
        [].slice.call(wait.classList).forEach(function (c) { if (c.indexOf("kk-anim-") === 0) wait.classList.remove(c); });
        A.mount(wait, id, { size: 150, mood: "dance" });
        setTimeout(function () { A.setMood(wait.querySelector(".kka-av"), "idle"); }, 2400);
        guard = false;
      };
      new MutationObserver(function () { setTimeout(render, 0); }).observe(wait, { childList: true, characterData: true, subtree: false });
      wait.addEventListener("click", function () {
        A.flash(wait.querySelector(".kka-av"), pick(["cheer", "dance", "wave"]), 1600);
        S.sfx("boing"); vibrate(25);
      });
      var hint = el("div", "kka-wait-hint", "tap your character");
      wait.insertAdjacentElement("afterend", hint);
      render();
    }
    var waitCard = $("step-wait");
    if (waitCard) {
      crowdEl = el("div", "kka-crowd", '<div class="kka-crowd-label"></div><div class="kka-crowd-row"></div>');
      (waitCard.querySelector(".text-center") || waitCard).appendChild(crowdEl);
    }
  }

  function paintCrowd() {
    if (!crowdEl) return;
    var rows = G.lb.rows || [];
    var mine = rowKey({ name: myNick(), avatar_id: myAvatar() });
    var others = rows.filter(function (r) { return rowKey(r) !== mine; });
    var total = Math.max(G.participants, rows.length);
    crowdEl.querySelector(".kka-crowd-label").textContent = total > 1
      ? (G.lb.mode === "rooms" ? rows.length + " rooms · " : "") + total + " players in the arena"
      : "You're the first one here — others will pop in";
    var row = crowdEl.querySelector(".kka-crowd-row");
    var want = others.slice(0, 14);
    var key = want.map(rowKey).join(",");
    if (row.dataset.k === key) return;
    row.dataset.k = key;
    row.innerHTML = want.map(function (r) {
      return '<span title="' + esc(r.name) + '">' + A.html(r.avatar_id, { size: 46, mood: Math.random() < 0.3 ? "dance" : "idle" }) + "</span>";
    }).join("");
  }

  // ─────────────── splash ───────────────
  function closeSplash() {
    var s = PH.splash;
    if (!s) return;
    PH.splash = null;
    clearTimeout(PH.splashTimer);
    s.classList.add("is-out");
    setTimeout(function () { s.remove(); }, 360);
  }

  function splash(kind, opts) {
    closeSplash();
    var s = el("div", "kka-splash is-" + kind);
    s.setAttribute("role", "status");
    s.setAttribute("aria-live", "assertive");
    s.innerHTML =
      (kind === "bad" ? '<div class="kka-splash-rain">' + Array.apply(null, Array(24)).map(function () {
        return '<i style="left:' + rand(0, 100).toFixed(1) + "%;animation-delay:" + rand(0, 1).toFixed(2) + "s;animation-duration:" + rand(0.7, 1.2).toFixed(2) + 's"></i>';
      }).join("") + "</div>" : "") +
      A.html(myAvatar(), { size: opts.size || 170, mood: opts.mood || "idle" }) +
      '<div class="kka-splash-title">' + opts.title + "</div>" +
      (opts.pts != null ? '<div class="kka-splash-pts">' + opts.pts + "</div>" : "") +
      (opts.streak ? '<div class="kka-splash-streak">🔥 ' + opts.streak + " in a row</div>" : "") +
      (opts.line ? '<div class="kka-splash-line">' + opts.line + "</div>" : "") +
      '<div class="kka-splash-rank">' + (opts.rank || "") + "</div>" +
      '<div class="kka-splash-tap">tap to continue</div>';
    s.addEventListener("click", closeSplash);
    document.body.appendChild(s);
    PH.splash = s;
    if (opts.ms) PH.splashTimer = setTimeout(closeSplash, opts.ms);
    return s;
  }

  var GOOD = ["Big brain energy 🧠", "Nailed it!", "You're on fire!", "Too easy for you 😎", "Absolute legend", "Sharp as a tack"];
  var BAD = ["Shake it off — next one's yours", "So close!", "Plot twist… bounce back!", "Every champion misses one", "Regroup and go again 💪"];

  function phoneOnAck(m) {
    if (!G.qid || String(m.question_id) !== String(G.qid)) return;
    var firstForQ = PH.answeredQ !== G.qid;
    PH.answeredQ = G.qid;
    if (typeof m.score === "number") PH.score = m.score;
    phoneMusic();
    if (!firstForQ) return;
    if (PH.lastStreakQ !== G.qid) {
      PH.streak = m.is_correct ? PH.streak + 1 : 0;
      PH.lastStreakQ = G.qid;
      try { sessionStorage.setItem(STREAK_KEY, JSON.stringify({ n: PH.streak, q: G.qid })); } catch (e) { /* ignore */ }
    }
    host.classList.remove("kka-urgent");
    var good = !!m.is_correct;
    var s = splash(good ? "good" : "bad", {
      mood: good ? "cheer" : "sad",
      title: good ? "Correct!" : "Not quite",
      pts: good ? "+" + Number(m.points || 0).toLocaleString() + (m.was_late ? " · late" : "") : Number(m.score || 0).toLocaleString() + " pts",
      streak: good && PH.streak >= 2 ? PH.streak : 0,
      line: good ? pick(GOOD) : pick(BAD),
      rank: rankLine(),
      ms: 3000,
    });
    PH.rankWanted = s;
    if (good) {
      S.sfx("correct");
      if (PH.streak >= 3) setTimeout(function () { S.sfx("streak"); }, 380);
      vibrate([35, 40, 35]);
      setTimeout(function () { confetti({ count: 90, duration: 2400 }); }, 120);
    } else {
      S.sfx("wrong");
      vibrate(180);
    }
  }

  function phoneOnRejected(m) {
    if (!G.qid || String(m.question_id) !== String(G.qid)) return;
    PH.answeredQ = G.qid;
    splash("late", { mood: "sleep", title: "Too late!", line: "The clock beat you to it — be quicker next round ⚡", rank: rankLine(), ms: 2600 });
    S.sfx("timeup"); vibrate(120);
  }

  function phoneOnReveal(m) {
    if (!G.qid || String(m.question_id) !== String(G.qid)) return;
    if (G.revealedQ === G.qid) return;
    G.revealedQ = G.qid;
    host.classList.remove("kka-urgent");
    if (PH.answeredQ !== G.qid) {
      if (PH.lastStreakQ !== G.qid) {
        PH.streak = 0; PH.lastStreakQ = G.qid;
        try { sessionStorage.setItem(STREAK_KEY, JSON.stringify({ n: 0, q: G.qid })); } catch (e) { /* ignore */ }
      }
      phoneMusic();
      splash("late", { mood: "sleep", title: "Time's up!", line: "No answer this round — get the next one!", rank: rankLine(), ms: 2600 });
      S.sfx("timeup"); vibrate(100);
    }
  }

  function phoneEnd() {
    if (PH.endShown) return;
    PH.endShown = true;
    host.classList.remove("kka-urgent");
    var show = function () {
      var r = myRank();
      var score = Math.max(PH.score, (G.st && G.st.my_score) || 0);
      var top3 = r && r.rank <= 3 && !r.rooms;
      var title = !r ? "Game over!" : r.rooms ? "Your room: " + ordinal(r.rank) + "!"
        : r.rank === 1 ? "You won! 🥇" : r.rank === 2 ? "2nd place! 🥈" : r.rank === 3 ? "3rd place! 🥉" : "You finished " + ordinal(r.rank);
      var s = splash("end", {
        mood: top3 ? "win" : "cheer", size: 190, title: title,
        pts: '<span class="n">0</span> pts',
        line: top3 ? "Take a bow — you made the podium!" : "Great game! Thanks for playing 🙌",
        rank: r && !r.rooms ? "out of " + r.of + " players" : "",
      });
      countUp(s.querySelector(".n"), 0, score, 1400);
      S.music("victory");
      if (top3) { confetti({ count: 200, duration: 4800 }); S.sfx("fanfare"); vibrate([60, 50, 60, 50, 120]); }
      else S.sfx("allin");
    };
    // Give the final leaderboard a beat to arrive.
    setTimeout(show, 600);
  }

  // Phones only play music when the player switched it on (off by default).
  // Lobby groove while waiting, tension loop while the question is open,
  // silence once you've answered so the result sting lands.
  function phoneMusic() {
    var s = G.st;
    if (!s) return;
    if (s.state === "lobby") S.music("lobby");
    else if (s.state === "running" && s.question && PH.answeredQ !== G.qid && G.revealedQ !== G.qid) S.music("think");
    else if (s.state !== "ended") S.music(null);
  }

  function phoneTick() {
    var s = G.st;
    var live = s && s.state === "running" && s.question && PH.answeredQ !== G.qid && G.revealedQ !== G.qid;
    var left = live ? secondsLeft() : null;
    var urgent = live && left !== null && left > 0 && left <= 5;
    document.body.classList.toggle("kka-urgent", !!urgent);
    if (urgent && G.tickSecond !== left) { G.tickSecond = left; S.sfx("tick"); if (left <= 3) vibrate(15); }
  }

  function phoneOnState(s) {
    var prevQ = G.qid;
    absorbState(s);
    if (typeof s.my_score === "number") PH.score = Math.max(PH.score, s.my_score);
    if (s.state === "ended") { phoneEnd(); return; }
    if (s.state === "lobby") { G.qid = null; PH.endShown = false; paintCrowd(); phoneMusic(); return; }
    if (s.state === "running" && s.question) {
      G.qid = s.question.id;
      if (prevQ !== G.qid) {
        closeSplash();
        G.tickSecond = null;
        // A fresh state for a question already answered (refresh) carries
        // my_answer — don't treat it as unanswered.
        if (s.my_answer) PH.answeredQ = G.qid;
        if (secondsLeft() === 0 && s.tally) G.revealedQ = G.qid;
        phoneMusic();
        var card = $("step-question");
        if (card) {
          card.classList.remove("kka-qin");
          void card.offsetWidth;
          card.classList.add("kka-qin");
          setTimeout(function () { card.classList.remove("kka-qin"); }, 1200);
        }
      }
    }
  }

  function phoneOnLeaderboard(m) {
    G.lb = m.data || { mode: "individuals", rows: [] };
    if (G.st && G.st.state === "lobby") paintCrowd();
    if (PH.splash && PH.splash === PH.rankWanted) {
      var rk = PH.splash.querySelector(".kka-splash-rank");
      if (rk) rk.innerHTML = rankLine();
    }
  }

  // ═══════════════════════ dispatch ═══════════════════════
  handlers.push(function (m) {
    switch (m.type) {
      case "state":
        if (IS_HOST) hostOnState(m); else phoneOnState(m);
        break;
      case "leaderboard":
        if (IS_HOST) hostOnLeaderboard(m); else phoneOnLeaderboard(m);
        break;
      case "correct_answer":
        if (IS_HOST) hostOnReveal(m); else phoneOnReveal(m);
        break;
      case "answer_ack":
        if (IS_PHONE) phoneOnAck(m);
        break;
      case "answer_rejected":
        if (IS_PHONE) phoneOnRejected(m);
        break;
      case "self_finished":
      case "ended":
        if (IS_HOST) {
          if (G.st) G.st.state = "ended";
          HOST.fab.classList.remove("is-on", "is-pulse");
          HOST.live.classList.remove("is-on");
          showPodium();
        }
        else phoneEnd();
        break;
    }
  });

  function boot() { if (IS_HOST) hostInit(); else phoneInit(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else setTimeout(boot, 0);
})();
