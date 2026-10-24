/* tt_play.js — the phone.
 *
 * Seated players see their own table with the board turned their way and
 * the controls for that game (dice, tile rack, resign). Everyone else —
 * and seated players who tap "Watch" — can follow any table live and see
 * every move animate as it happens.
 */
(function () {
  "use strict";
  var $ = TT.$, esc = TT.esc;
  var root = $("tt-play");
  if (!root) return;
  var CODE = root.dataset.code, ROLE = root.dataset.role, TOKEN = root.dataset.token;

  var UI = TT.phoneUI = TT.phoneUI || {};   // per-game controls from tt_games_more.js
  var me = null, night = null, players = [], matches = {}, priv = {};
  var watching = null;          // match id on screen
  var pinnedWatch = false;      // user chose to watch another table
  var board = null, lobbyHero = null, rackOrder = null, swapMode = false, swapSel = {};

  // the phone must not dim or lock mid-game (players wait between turns)
  TT.awakeBadge($("tt-awake"));
  var awakeWarned = false;
  setTimeout(function () {
    if (!awakeWarned && TT.keepAwake().state() === "off") {
      awakeWarned = true;
      toast("Tap the screen once so it stays on during the game ☀️");
    }
  }, 2500);

  var net = TT.connect(CODE, { t: "hello", role: ROLE, token: TOKEN }, onMsg, function (s) {
    $("tt-net").dataset.state = s;
  });

  function onMsg(m) {
    if (m.t === "snapshot") {
      night = m.night; players = m.players; me = m.you || null;
      matches = {}; m.matches.forEach(function (x) { matches[x.id] = x; });
      priv = m.private || {};
      rackOrder = null;
      pickView(true);
      render();
    } else if (m.t === "players") {
      players = m.players;
      if (me) me = players.filter(function (p) { return p.id === me.id; })[0] || me;
      renderHeader(); renderLobby();
    } else if (m.t === "night") {
      night = m.night; render();
    } else if (m.t === "match") {
      var x = m.match, prev = matches[x.id];
      matches[x.id] = x;
      var before = watching;
      if (!prev) pickView(false);
      if (m.awarded && mySeat(x) >= 0) myResult(x, m.awarded);
      if (watching !== before || (x.id === watching && !board)) {
        render();                      // switching screens: build the board first
      } else if (x.id === watching) {
        board.render(x, { seat: mySeat(x), priv: priv[x.id], animate: m.events });
        renderGameUI(x, m.events);
        if (mySeat(x) >= 0 && x.state.turn === mySeat(x) && x.status === "active" && m.by !== (me && me.id)) {
          TT.sfx("turn"); TT.vibrate([60, 40, 60]);
        }
      }
      renderTablesList();
    } else if (m.t === "private") {
      priv[m.match] = m.data;
      rackOrder = null;
      if (matches[m.match] && m.match === watching) renderGameUI(matches[m.match], []);
    } else if (m.t === "error") {
      toast(m.msg, true); TT.sfx("bad"); TT.vibrate(120);
      if (board) board.redraw();
    } else if (m.t === "toast") {
      toast(m.msg);
    } else if (m.t === "react") {
      var p = players.filter(function (q) { return q.id === m.player; })[0];
      flyEmoji(m.emoji, p && (me && p.id === me.id ? "You" : p.name), p && p.avatar);
    } else if (m.t === "kicked") {
      root.innerHTML = '<div class="tt-card tt-center"><h2>You were removed from this game night.</h2></div>';
    } else if (m.t === "denied") {
      location.href = "/tabletop/join/" + CODE + "/";
    }
  }

  function mySeat(x) {
    if (!me || !x) return -1;
    for (var i = 0; i < x.seats.length; i++) if (x.seats[i].id === me.id) return i;
    return -1;
  }
  function myActive() {
    return Object.values(matches).filter(function (x) { return x.status === "active" && mySeat(x) >= 0; })[0];
  }
  function pickView(force) {
    var mine = myActive();
    if (mine && (!pinnedWatch || force)) { watching = mine.id; pinnedWatch = false; return; }
    if (watching && matches[watching]) return;
    var any = Object.values(matches).filter(function (x) { return x.status === "active"; })[0];
    watching = mine ? mine.id : null;
    if (ROLE === "watch" && any) watching = any.id;
  }

  /* ───────────────────────── render ───────────────────────── */
  function render() {
    renderHeader();
    var x = matches[watching];
    root.dataset.mode = x ? "table" : "lobby";
    renderLobby();
    renderTablesList();
    if (x) {
      if (!board) board = TTBoard2D.create($("tt-board"), { onAction: send, onRack: function () { renderGameUI(matches[watching], []); } });
      board.render(x, { seat: mySeat(x), priv: priv[x.id] });
      renderGameUI(x, []);
    }
  }

  function renderHeader() {
    var h = $("tt-me");
    if (!h) return;
    if (!me) { h.innerHTML = '<span class="tt-me-name">Spectator</span>'; return; }
    h.innerHTML = '<button type="button" class="tt-me-av" id="tt-edit-av" aria-label="Change character">' + TT.avatar(me.avatar, 40) + "</button>" +
      '<span class="tt-me-name">' + esc(me.name) + '</span><span class="tt-chip">' + me.points + " pts</span>" +
      (me.rank ? '<span class="tt-chip tt-chip-dim">#' + me.rank + "</span>" : "");
  }

  function renderLobby() {
    var box = $("tt-lobby-board");
    if (!box) return;
    box.innerHTML = players.slice(0, 12).map(function (p) {
      return '<li class="' + (me && p.id === me.id ? "is-me" : "") + '"><span class="tt-lb-rank">' + p.rank + "</span>" + TT.avatar(p.avatar, 34) +
        '<span class="tt-lb-name">' + esc(p.name) + '</span><span class="tt-lb-kills">⚔️ ' + p.kills + '</span><span class="tt-lb-pts">' + p.points + "</span></li>";
    }).join("");
    var msg = $("tt-wait-msg");
    if (msg && night) {
      var game = TT.GAME_LABEL[night.game];
      msg.innerHTML = Object.values(matches).some(function (x) { return x.status === "active"; })
        ? "Tables are playing — you'll be dealt in next round. Watch a table below 👇"
        : "Waiting for the host to deal <b>" + game + "</b>…";
    }
    if (me && !lobbyHero && $("tt-lobby-hero") && root.dataset.mode === "lobby") {
      if (window.KKHero && KKHero.isHero(me.avatar) && KKHero.hasWebGL) {
        lobbyHero = KKHero.mount($("tt-lobby-hero"), me.avatar, { move: "wave" });
      } else $("tt-lobby-hero").innerHTML = TT.avatar(me.avatar, 150);
    }
  }

  function renderTablesList() {
    var box = $("tt-watch-list");
    if (!box) return;
    var xs = Object.values(matches).sort(function (a, b) { return a.table - b.table; });
    box.innerHTML = xs.map(function (x) {
      var names = x.seats.map(function (s) { return esc(s.name); }).join(" vs ");
      return '<button type="button" class="tt-watch' + (x.id === watching ? " is-on" : "") + (x.status !== "active" ? " is-done" : "") + '" data-watch="' + x.id + '">' +
        TT.GAME_EMOJI[x.game] + " <b>" + x.table + "</b> " + names + "</button>";
    }).join("") || '<p class="tt-dim">No tables yet.</p>';
    var back = $("tt-back-mine");
    if (back) back.hidden = !(myActive() && watching !== myActive().id);
  }

  /* ───────────────────────── per-game controls ───────────────────────── */
  function seatName(x, i) { return x.seats[i] ? x.seats[i].name : "?"; }

  function renderGameUI(x, events) {
    if (!x) return;
    var st = x.state, seat = mySeat(x);
    var seatsEl = $("tt-seats");
    seatsEl.innerHTML = x.seats.map(function (s, i) {
      var turn = st.turn === i && x.status === "active";
      var extra = "";
      if (x.game === "chess") extra = i === 0 ? "♔ White" : "♚ Black";
      if (x.game === "dam") extra = i === 0 ? "Light" : "Dark";
      if (x.game === "ludo") extra = '<i class="tt-dot" style="background:' + TT.LUDO_COLORS[st.colours[i]] + '"></i>' + TT.LUDO_NAMES[st.colours[i]];
      if (x.game === "words") extra = "<b>" + st.scores[i] + "</b> pts";
      if (UI[x.game] && UI[x.game].seat) extra = UI[x.game].seat(x, i);
      return '<div class="tt-seat' + (turn ? " is-turn" : "") + (i === seat ? " is-me" : "") + '">' + TT.avatar(s.avatar, 34) +
        '<span><b>' + esc(s.name) + "</b><small>" + extra + "</small></span></div>";
    }).join("");

    var banner = $("tt-turn");
    if (x.status !== "active") {
      var res = st.result || {}, w = (res.ranking || [[]])[0] || [];
      banner.className = "tt-turn is-over";
      banner.innerHTML = w.length === x.seats.length ? "Draw — " + esc(res.reason || "") :
        "🏆 " + w.map(function (s) { return esc(seatName(x, s)); }).join(" & ") + " won · " + esc(res.reason || "");
    } else if (seat >= 0 && st.turn === seat) {
      banner.className = "tt-turn is-mine";
      banner.textContent = UI[x.game] && UI[x.game].banner ? UI[x.game].banner(x, seat) : x.game === "ludo" ? (st.phase === "roll" ? "Your turn — roll!" : "Tap a glowing token") :
        x.game === "words" ? "Your turn — place tiles" : x.game === "dam" && st.legal.length && st.legal[0].caps.length ? "Your turn — you must capture!" :
        st.check ? "Check! Your move" : "Your move";
    } else {
      banner.className = "tt-turn";
      banner.textContent = (seat < 0 ? "Watching · " : "") + seatName(x, st.turn) + " is thinking…";
    }

    var ctl = $("tt-controls");
    var canAct = seat >= 0 && x.status === "active";
    var html = "";
    if (x.game === "ludo" && canAct) {
      var mineTurn = st.turn === seat;
      html += '<button type="button" class="tt-roll' + (mineTurn && st.phase === "roll" ? " is-ready" : "") + '" id="tt-roll"' +
        (mineTurn && st.phase === "roll" ? "" : " disabled") + ">" + dieFace(st.dice) + "<span>" + (mineTurn && st.phase === "roll" ? "Roll" : st.dice ? "Rolled " + st.dice : "Wait") + "</span></button>";
    }
    if (x.game === "words" && canAct) html += wordsControls(x, seat);
    if (UI[x.game] && UI[x.game].controls) html += UI[x.game].controls(x, seat, canAct, { dieFace: dieFace, esc: esc });
    if (canAct && x.game !== "words") html += '<button type="button" class="tt-btn tt-btn-ghost" id="tt-resign">🏳️ Resign</button>';
    if (x.game === "words" && x.state.last && x.state.last.words && x.state.last.words.length) {
      html += '<p class="tt-dim tt-lastword">Last: <b>' + esc(x.state.last.words.join(", ")) + "</b> +" + x.state.last.score + " · bag " + st.bag + "</p>";
    }
    ctl.innerHTML = html;
    if (events && events.some(function (e) { return e.type === "roll"; })) {
      var r = $("tt-roll"); if (r) { r.classList.add("tt-shake"); }
    }
  }

  function dieFace(v) {
    var pips = { 1: [[50, 50]], 2: [[28, 28], [72, 72]], 3: [[28, 28], [50, 50], [72, 72]], 4: [[28, 28], [72, 28], [28, 72], [72, 72]],
                 5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]], 6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]] }[v || 6];
    return '<svg viewBox="0 0 100 100" width="64" height="64"><rect x="6" y="6" width="88" height="88" rx="20" fill="#fff" stroke="#cbd5e1" stroke-width="4"/>' +
      pips.map(function (p) { return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="9" fill="' + (v ? "#111827" : "#cbd5e1") + '"/>'; }).join("") + "</svg>";
  }

  function wordsControls(x, seat) {
    var p = priv[x.id] || { rack: [] };
    if (!rackOrder || rackOrder.length !== p.rack.length) rackOrder = p.rack.map(function (_, i) { return i; });
    var placed = board.words.placed(), used = {};
    placed.forEach(function (t) { used[t.rackIndex] = 1; });
    var sel = board.words.selected();
    var myTurn = x.state.turn === seat;
    var rack = rackOrder.map(function (i) {
      var l = p.rack[i];
      var cls = "tt-rtile" + (used[i] ? " is-used" : "") + (sel === i ? " is-sel" : "") + (swapMode && swapSel[i] ? " is-swap" : "");
      return '<button type="button" class="' + cls + '" data-rack="' + i + '"' + (used[i] ? " disabled" : "") + ">" +
        (l === "?" ? "&nbsp;" : l) + "<small>" + (l === "?" ? "" : (x.state.values[l] || "")) + "</small></button>";
    }).join("");
    var btns = swapMode
      ? '<button type="button" class="tt-btn" id="tt-swap-go">Swap selected</button><button type="button" class="tt-btn tt-btn-ghost" id="tt-swap-cancel">Cancel</button>'
      : '<button type="button" class="tt-btn tt-btn-primary" id="tt-play-go"' + (myTurn && placed.length ? "" : " disabled") + ">Play word</button>" +
        '<button type="button" class="tt-btn tt-btn-ghost" id="tt-recall"' + (placed.length ? "" : " disabled") + ">↩︎ Recall</button>" +
        '<button type="button" class="tt-btn tt-btn-ghost" id="tt-shuffle">🔀</button>' +
        '<button type="button" class="tt-btn tt-btn-ghost" id="tt-swap"' + (myTurn ? "" : " disabled") + ">Swap</button>" +
        '<button type="button" class="tt-btn tt-btn-ghost" id="tt-pass"' + (myTurn ? "" : " disabled") + ">Pass</button>" +
        '<button type="button" class="tt-btn tt-btn-ghost" id="tt-resign">🏳️</button>';
    return '<div class="tt-rack">' + rack + '</div><div class="tt-row">' + btns + "</div>";
  }

  /* ───────────────────────── actions ───────────────────────── */
  function send(action) {
    var x = matches[watching];
    if (!x) return;
    net.send({ t: "move", match: x.id, action: action });
  }

  root.addEventListener("click", function (e) {
    var b, x = matches[watching];
    if ((b = e.target.closest("#tt-roll"))) { send({ type: "roll" }); TT.sfx("dice"); TT.vibrate(30); }
    else if ((b = e.target.closest("[data-act]"))) {
      var a; try { a = JSON.parse(b.dataset.act); } catch (er) { a = null; }
      if (a) { send(a); TT.sfx(a.type === "roll" ? "dice" : "tap"); TT.vibrate(25); }
    }
    else if ((b = e.target.closest("#tt-resign"))) { if (confirm("Resign this game?")) send({ type: "resign" }); }
    else if ((b = e.target.closest("[data-rack]"))) {
      var i = +b.dataset.rack;
      if (swapMode) { swapSel[i] = !swapSel[i]; renderGameUI(x, []); return; }
      board.words.select(board.words.selected() === i ? null : i);
      TT.sfx("tap");
      renderGameUI(x, []);
    }
    else if ((b = e.target.closest("#tt-play-go"))) {
      var tiles = board.words.placed().map(function (t) { return { r: t.r, c: t.c, l: t.l, blank: !!t.blank }; });
      send({ type: "play", tiles: tiles });
    }
    else if ((b = e.target.closest("#tt-recall"))) { board.words.clear(); renderGameUI(x, []); }
    else if ((b = e.target.closest("#tt-shuffle"))) {
      for (var k = rackOrder.length - 1; k > 0; k--) { var j = Math.floor(Math.random() * (k + 1)); var t = rackOrder[k]; rackOrder[k] = rackOrder[j]; rackOrder[j] = t; }
      renderGameUI(x, []);
    }
    else if ((b = e.target.closest("#tt-swap"))) { board.words.clear(); swapMode = true; swapSel = {}; renderGameUI(x, []); }
    else if ((b = e.target.closest("#tt-swap-cancel"))) { swapMode = false; renderGameUI(x, []); }
    else if ((b = e.target.closest("#tt-swap-go"))) {
      var p = priv[x.id];
      var letters = Object.keys(swapSel).filter(function (k2) { return swapSel[k2]; }).map(function (k2) { return p.rack[k2]; });
      swapMode = false;
      send({ type: "swap", letters: letters });
    }
    else if ((b = e.target.closest("#tt-pass"))) { if (confirm("Pass your turn?")) send({ type: "pass" }); }
    else if ((b = e.target.closest("[data-watch]"))) {
      watching = +b.dataset.watch;
      pinnedWatch = !myActive() || watching !== myActive().id;
      render();
    }
    else if ((b = e.target.closest("#tt-back-mine"))) { pinnedWatch = false; pickView(true); render(); }
    else if ((b = e.target.closest("#tt-to-lobby"))) { watching = null; pinnedWatch = true; render(); }
    else if ((b = e.target.closest("[data-react]"))) { net.send({ t: "react", emoji: b.dataset.react }); TT.vibrate(15); b.classList.remove("tt-pop"); void b.offsetWidth; b.classList.add("tt-pop"); }
    else if ((b = e.target.closest("#tt-edit-av"))) openForge();
    else if ((b = e.target.closest("#tt-mute"))) { TT.setMuted(!TT.isMuted()); b.textContent = TT.isMuted() ? "🔇" : "🔊"; }
  });

  /* ───────────────────────── result + avatar sheet ───────────────────────── */
  function myResult(x, awarded) {
    var seat = mySeat(x);
    var res = x.state.result || {}, w = (res.ranking || [[]])[0] || [];
    var draw = w.length === x.seats.length, won = w.indexOf(seat) >= 0 && !draw;
    var pts = awarded[String(me.id)] || 0;
    var card = TT.el("div", "tt-result " + (won ? "is-win" : draw ? "is-draw" : "is-loss"));
    card.innerHTML = '<div class="tt-result-in">' + TT.avatar(me.avatar, 120) +
      "<h2>" + (won ? "Victory!" : draw ? "Draw" : "Good game") + "</h2><p>" + esc(res.reason || "") + "</p>" +
      '<p class="tt-result-pts">+' + pts + " points</p>" +
      '<button type="button" class="tt-btn tt-btn-primary">Back to the lobby</button></div>';
    document.body.appendChild(card);
    TT.sfx(won ? "win" : draw ? "turn" : "bad");
    TT.vibrate(won ? [80, 60, 80, 60, 200] : 200);
    card.addEventListener("click", function (e) {
      if (e.target.closest("button") || e.target === card) { card.remove(); pinnedWatch = false; watching = null; pickView(false); render(); }
    });
  }

  function openForge() {
    if (!me) return;
    var sheet = TT.el("div", "tt-sheet");
    sheet.innerHTML = '<div class="tt-sheet-in"><div class="tt-sheet-h"><b>Your character</b><button type="button" class="tt-x" aria-label="Close">✕</button></div>' +
      '<div id="tt-forge"></div><button type="button" class="tt-btn tt-btn-primary tt-save">Save character</button></div>';
    document.body.appendChild(sheet);
    var chosen = me.avatar;
    var f = window.KKHero ? KKHero.forge(sheet.querySelector("#tt-forge"), { value: KKHero.isHero(me.avatar) ? me.avatar : null, onChange: function (id) { chosen = id; } }) : null;
    if (f) chosen = f.get();
    sheet.addEventListener("click", function (e) {
      if (e.target.closest(".tt-x") || e.target === sheet) { if (f) f.dispose(); sheet.remove(); }
      if (e.target.closest(".tt-save")) {
        net.send({ t: "avatar", avatar: chosen });
        me.avatar = chosen;
        if (lobbyHero) lobbyHero.set(chosen, "cheer");
        if (f) f.dispose(); sheet.remove();
        renderHeader();
        toast("Looking good! 🔥");
      }
    });
  }

  function toast(text, bad) {
    var t = TT.el("div", "tt-toast" + (bad ? " is-bad" : ""), esc(text));
    $("tt-toasts").appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }
  function flyEmoji(emoji, name, avatar) {
    var f = TT.el("div", "tt-react", '<span class="tt-react-e">' + esc(emoji) + "</span>" +
      (name ? '<span class="tt-react-who">' + (avatar ? TT.avatar(avatar, 22) : "") + esc(name) + "</span>" : ""));
    f.style.left = (10 + Math.random() * 75) + "%";
    document.body.appendChild(f);
    setTimeout(function () { f.remove(); }, 3000);
  }
})();
