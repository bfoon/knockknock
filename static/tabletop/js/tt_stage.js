/* tt_stage.js — the projector page for a Live Tables game night.
 *
 * Shows the lobby (QR + who's joined), then the live picture: the featured
 * table in 3D next to the leaderboard. Host controls live in a dock along
 * the bottom that hides itself when the mouse is still.
 *
 * Auto-camera: when something dramatic happens at another table (a capture,
 * a big word, a win) the 3D view cuts to it, but never more often than
 * every few seconds so the room can follow.
 */
(function () {
  "use strict";
  var $ = TT.$, esc = TT.esc;
  var root = $("tt-stage");
  if (!root) return;
  var CODE = root.dataset.code;

  var night = null, players = [], matches = {}, featured = null, autoCam = true, lastCut = 0;
  var prevRanks = {}, prevPoints = {};
  var stage3d = null, minis = {};

  /* ───────────────────────── socket ───────────────────────── */
  var net = TT.connect(CODE, { t: "hello", role: "stage" }, onMsg, function (s) {
    $("tt-net").dataset.state = s;
  });
  function host(act, extra) { var m = { t: "host", act: act }; for (var k in extra || {}) m[k] = extra[k]; net.send(m); }

  function onMsg(m) {
    if (m.t === "snapshot") {
      night = m.night; players = m.players;
      matches = {};
      m.matches.forEach(function (x) { matches[x.id] = x; });
      if (!featured || !matches[featured]) featured = night.featured || pickFeatured();
      renderAll();
      showFeatured(false);
    } else if (m.t === "players") {
      players = m.players; renderPlayers(); renderBoard();
    } else if (m.t === "night") {
      night = m.night; renderAll();
    } else if (m.t === "match") {
      var x = m.match, isNew = !matches[x.id];
      matches[x.id] = x;
      if (m.awarded) announceResult(x, m.awarded);
      maybeCut(x, m.events || []);
      if (x.id === featured && stage3d) stage3d.play(x, m.events);
      updateMini(x, m.events);
      renderTables();
      if (x.id === featured) renderFeaturedHead();
      if (isNew) renderAll();
    } else if (m.t === "react") {
      floatReact(m.player, m.emoji);
    } else if (m.t === "toast") {
      toast(m.msg);
    } else if (m.t === "error") {
      toast(m.msg, true);
    } else if (m.t === "denied") {
      toast("This screen isn't signed in as the host.", true);
    }
  }

  /* ───────────────────────── featured / auto camera ───────────────────────── */
  function activeMatches() { return Object.values(matches).filter(function (x) { return x.status === "active"; }); }
  function pickFeatured() {
    var act = activeMatches();
    if (act.length) return act.sort(function (a, b) { return b.version - a.version; })[0].id;
    var all = Object.values(matches);
    return all.length ? all[all.length - 1].id : null;
  }
  function drama(events) {
    var s = 0;
    events.forEach(function (e) {
      if (e.type === "capture" || e.type === "jump") s += 3 + (e.victims ? e.victims.length : 0);
      if (e.type === "over") s += 10;
      if (e.type === "promote" || e.type === "home") s += 4;
      if (e.type === "place") s += Math.min(8, e.score / 6);
      if (e.type === "check") s += 2;
    });
    return s;
  }
  function maybeCut(x, events) {
    if (!autoCam || x.id === featured) return;
    var cur = matches[featured];
    var now = Date.now();
    var curDone = !cur || cur.status !== "active";
    if (curDone || (drama(events) >= 3 && now - lastCut > 9000)) {
      featured = x.id; lastCut = now;
      showFeatured(true);
    }
  }
  function showFeatured(withBanner) {
    var x = matches[featured];
    renderFeaturedHead();
    if (!x) return;
    if (stage3d) stage3d.show(x).then(renderFeaturedHead);   // header follows the 3D view
    if (withBanner) banner("Table " + x.table + " · " + TT.GAME_LABEL[x.game]);
  }

  /* ───────────────────────── rendering ───────────────────────── */
  function renderAll() {
    if (!night) return;
    document.title = night.title + " · Live Tables";
    root.dataset.view = night.view;
    var hasTables = Object.keys(matches).length > 0;
    root.classList.toggle("is-lobby", !hasTables);
    $("tt-round").textContent = night.round ? "Round " + night.round : "Lobby";
    [].forEach.call(document.querySelectorAll("[data-view-btn]"), function (b) {
      b.classList.toggle("is-on", b.dataset.viewBtn === night.view);
    });
    [].forEach.call(document.querySelectorAll("[data-game]"), function (b) {
      b.classList.toggle("is-on", b.dataset.game === night.game);
    });
    var pr = $("tt-pairing"); if (pr) pr.value = night.pairing;
    var wc = $("tt-wordcheck"); if (wc) wc.checked = night.check_words;
    var ds = $("tt-damsize"); if (ds) ds.value = String(night.dam_size);
    renderPlayers(); renderBoard(); renderTables(); renderFeaturedHead();
    if (hasTables && !stage3d && window.TTStage3D) {
      stage3d = TTStage3D.create($("tt-3d"), { pieces: root.dataset.pieces, world: root.dataset.world });
      showFeatured(false);
    }
  }

  function renderPlayers() {
    var box = $("tt-lobby-players");
    if (!box) return;
    var seen = {};
    [].forEach.call(box.children, function (c) { seen[c.dataset.pid] = c; });
    players.forEach(function (p) {
      var el = seen[p.id];
      if (!el) {
        el = TT.el("div", "tt-lobby-p tt-pop");
        el.dataset.pid = p.id;
        box.appendChild(el);
        (function (n) { setTimeout(function () { n.classList.remove("tt-pop"); }, 650); })(el);
        TT.sfx("tap");
      }
      delete seen[p.id];
      var html = TT.avatar(p.avatar, 74) + '<span class="tt-lobby-name">' + esc(p.name) + "</span>";
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
      el.classList.toggle("is-off", !p.online);
    });
    Object.keys(seen).forEach(function (k) { seen[k].remove(); });
    var n = players.filter(function (p) { return p.online; }).length;
    $("tt-count").textContent = n + (n === 1 ? " player" : " players") + " here";
  }

  function renderBoard() {
    var list = $("tt-leaders");
    if (!list) return;
    // FLIP: remember old positions
    var oldTop = {};
    [].forEach.call(list.children, function (c) { oldTop[c.dataset.pid] = c.getBoundingClientRect().top; });
    var rows = players.slice(0, 30);
    var byId = {};
    [].forEach.call(list.children, function (c) { byId[c.dataset.pid] = c; });
    var ordered = [], fresh = {};
    rows.forEach(function (p) {
      var el = byId[p.id];
      if (!el) { el = TT.el("li", "tt-lb-row"); fresh[p.id] = true; }
      el.dataset.pid = p.id;
      var medal = p.rank === 1 ? "🥇" : p.rank === 2 ? "🥈" : p.rank === 3 ? "🥉" : p.rank;
      var html =
        '<span class="tt-lb-rank">' + medal + "</span>" + TT.avatar(p.avatar, 46) +
        '<span class="tt-lb-name">' + esc(p.name) + (p.online ? "" : ' <i class="tt-off">away</i>') + "</span>" +
        '<span class="tt-lb-wdl" title="won / drawn / lost">' + p.wins + "·" + p.draws + "·" + p.losses + "</span>" +
        '<span class="tt-lb-kills" title="pieces cut down">⚔️ ' + p.kills + "</span>" +
        '<span class="tt-lb-pts">' + p.points + "</span>";
      if (el._html !== html) { el.innerHTML = html; el._html = html; }
      el.classList.toggle("is-top", p.rank <= 3);
      if (prevPoints[p.id] != null && p.points > prevPoints[p.id]) {
        var d = TT.el("span", "tt-lb-delta", "+" + (p.points - prevPoints[p.id]));
        el.appendChild(d);
        setTimeout(function () { d.remove(); }, 2200);
        el.classList.remove("tt-flash"); void el.offsetWidth; el.classList.add("tt-flash");
      }
      prevPoints[p.id] = p.points;
      ordered.push(el);
    });
    // Reorder IN PLACE, moving only rows that changed position. Emptying the
    // list and re-inserting every row restarted each row's CSS entrance
    // animation (which starts at opacity 0), so on a busy machine rows blinked
    // out — or stayed invisible — on every update.
    var keep = {};
    ordered.forEach(function (el, i) {
      keep[el.dataset.pid] = true;
      if (list.children[i] !== el) list.insertBefore(el, list.children[i] || null);
    });
    [].slice.call(list.children).forEach(function (c) { if (!keep[c.dataset.pid]) c.remove(); });
    ordered.forEach(function (c) {
      var o = oldTop[c.dataset.pid];
      if (fresh[c.dataset.pid] || o == null) {
        c.classList.add("tt-pop");
        setTimeout(function () { c.classList.remove("tt-pop"); }, 650);   // never left to replay
        return;
      }
      var dy = o - c.getBoundingClientRect().top;
      if (Math.abs(dy) > 2) {
        c.animate([{ transform: "translateY(" + dy + "px)" }, { transform: "none" }], { duration: 650, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    });
    renderPodium();
  }

  function renderPodium() {
    var pod = $("tt-podium");
    if (!pod) return;
    var top = players.slice(0, 3);
    var order = [top[1], top[0], top[2]];
    pod.innerHTML = order.map(function (p, i) {
      if (!p) return '<div class="tt-pod tt-pod-' + i + ' is-empty"></div>';
      return '<div class="tt-pod tt-pod-' + i + '">' + TT.avatar(p.avatar, i === 1 ? 150 : 112) +
        '<b>' + esc(p.name) + "</b><span>" + p.points + " pts</span><div class=\"tt-pod-step\">" + [2, 1, 3][i] + "</div></div>";
    }).join("");
  }

  function tableLine(x) {
    var st = x.state, names = x.seats.map(function (s) { return esc(s.name); });
    var status;
    if (x.status !== "active") {
      var res = st.result || {};
      var w = (res.ranking || [[]])[0] || [];
      status = w.length === x.seats.length ? "Draw" : "🏆 " + w.map(function (s) { return names[s]; }).join(" & ");
    } else {
      status = (st.turn != null && x.seats[st.turn] ? names[st.turn] + " to play" : "") + (st.moves ? " · move " + st.moves : "");
    }
    return { names: names, status: status };
  }

  function renderTables() {
    var list = $("tt-tables");
    if (!list) return;
    var xs = Object.values(matches).sort(function (a, b) { return a.table - b.table; });
    list.innerHTML = xs.map(function (x) {
      var l = tableLine(x);
      return '<button type="button" class="tt-tbl' + (x.id === featured ? " is-on" : "") + (x.status !== "active" ? " is-done" : "") + '" data-match="' + x.id + '">' +
        '<span class="tt-tbl-n">' + TT.GAME_EMOJI[x.game] + " " + x.table + "</span>" +
        '<span class="tt-tbl-who">' + l.names.join(" <i>vs</i> ") + "</span>" +
        '<span class="tt-tbl-st">' + l.status + "</span></button>";
    }).join("");
    // mini boards for the "tables" view
    var grid = $("tt-grid");
    if (!grid) return;
    xs.forEach(function (x) {
      if (!minis[x.id]) {
        var card = TT.el("div", "tt-mini");
        card.dataset.match = x.id;
        card.innerHTML = '<div class="tt-mini-h"></div><div class="tt-mini-b"></div>';
        grid.appendChild(card);
        minis[x.id] = { card: card, board: TTBoard2D.create(card.querySelector(".tt-mini-b"), {}) };
        minis[x.id].board.render(x, { seat: -1 });
      }
      var l = tableLine(x);
      minis[x.id].card.querySelector(".tt-mini-h").innerHTML = "<b>" + TT.GAME_EMOJI[x.game] + " Table " + x.table + "</b> " + l.names.join(" vs ") + "<span>" + l.status + "</span>";
      minis[x.id].card.classList.toggle("is-on", x.id === featured);
    });
    Object.keys(minis).forEach(function (id) {
      if (!matches[id]) { minis[id].card.remove(); delete minis[id]; }
    });
  }
  function updateMini(x, events) {
    if (minis[x.id]) minis[x.id].board.render(x, { seat: -1, animate: night && night.view === "tables" ? events : null });
  }

  function renderFeaturedHead() {
    var h = $("tt-feat-head");
    var shown = stage3d && stage3d.current();
    var x = matches[shown ? shown.id : featured];
    if (!h) return;
    if (!x) { h.innerHTML = ""; return; }
    var st = x.state;
    h.innerHTML = '<span class="tt-feat-game">' + TT.GAME_EMOJI[x.game] + " " + TT.GAME_LABEL[x.game] + " · Table " + x.table + "</span>" +
      x.seats.map(function (s, i) {
        var turn = st.turn === i && x.status === "active";
        var extra = "";
        if (x.game === "words") extra = " <b>" + st.scores[i] + "</b>";
        if (TT.phoneUI && TT.phoneUI[x.game] && TT.phoneUI[x.game].head) extra = TT.phoneUI[x.game].head(x, i);
        if (x.game === "ludo") extra = ' <i style="background:' + TT.LUDO_COLORS[st.colours[i]] + '"></i>';
        return '<span class="tt-feat-p' + (turn ? " is-turn" : "") + '">' + TT.avatar(s.avatar, 34) + esc(s.name) + extra + "</span>";
      }).join('<span class="tt-vs">vs</span>');
  }

  /* ───────────────────────── announcements ───────────────────────── */
  function announceResult(x, awarded) {
    var res = x.state.result || {};
    var w = (res.ranking || [[]])[0] || [];
    var draw = w.length === x.seats.length;
    var names = w.map(function (s) { return x.seats[s].name; }).join(" & ");
    banner(draw ? "Table " + x.table + ": a draw!" : "🏆 " + names + " wins table " + x.table + " (" + res.reason + ")", true);
  }
  function banner(text, big) {
    var b = TT.el("div", "tt-banner" + (big ? " is-big" : ""), esc(text));
    root.appendChild(b);
    setTimeout(function () { b.classList.add("is-out"); }, big ? 3800 : 2200);
    setTimeout(function () { b.remove(); }, big ? 4400 : 2800);
  }
  function toast(text, bad) {
    var t = TT.el("div", "tt-toast" + (bad ? " is-bad" : ""), esc(text));
    $("tt-toasts").appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }
  /* Reactions: a big card in the middle of the screen — who sent it (avatar +
   * name) and the emoji popping, wiggling and spraying mini copies — that
   * drifts up and fades. Cards take separate lanes so a room full of 🔥 stays
   * readable, and repeats from the same player within ~2 s grow a ×N combo on
   * their card instead of stacking new ones. */
  var RX_LANES = [50, 30, 70, 18, 82, 40, 60];   // % across the screen, centre first
  var rxLive = [];                                // {lane, key, el, t, count, timer}
  function floatReact(pid, emoji) {
    var p = players.filter(function (x) { return x.id === pid; })[0];
    // the sender's 3D hero waves on the featured table too
    if (stage3d && matches[featured] && matches[featured].seats.some(function (s) { return s.id === pid; })) {
      stage3d.react(pid, emoji);
    }
    var now = Date.now(), key = pid + "|" + emoji;
    var same = rxLive.filter(function (r) { return r.key === key && now - r.t < 2200 && !r.out; })[0];
    if (same) {                                  // combo!
      same.count++; same.t = now;
      var c = same.el.querySelector(".tt-rx-combo");
      c.textContent = "×" + same.count; c.hidden = false;
      same.el.classList.remove("is-bump"); void same.el.offsetWidth; same.el.classList.add("is-bump");
      spray(same.el.querySelector(".tt-rx-emoji"), emoji, 4);
      schedule(same);
      return;
    }
    var used = {};
    rxLive.forEach(function (r) { if (!r.out) used[r.lane] = true; });
    var lane = RX_LANES.filter(function (l) { return !used[l]; })[0];
    if (lane == null) {                          // all busy: retire the oldest
      var oldest = rxLive.filter(function (r) { return !r.out; }).sort(function (x, y) { return x.t - y.t; })[0];
      if (oldest) { retire(oldest); lane = oldest.lane; } else lane = 50;
    }
    var meta = p ? ((window.kkAvatarsById || {})[p.avatar] || {}) : {};
    var el = TT.el("div", "tt-rx");
    el.style.left = (lane + (Math.random() * 4 - 2)) + "%";
    el.style.setProperty("--rx-col", meta.color || "#facc15");
    el.innerHTML =
      '<div class="tt-rx-emoji"><span class="tt-rx-e">' + esc(emoji) + '</span><b class="tt-rx-combo" hidden>×1</b></div>' +
      '<div class="tt-rx-who">' + (p ? TT.avatar(p.avatar, 52) : "") + "<span>" + esc(p ? p.name : "Someone") + "</span></div>";
    root.appendChild(el);
    var rec = { lane: lane, key: key, el: el, t: now, count: 1, timer: null, out: false };
    rxLive.push(rec);
    spray(el.querySelector(".tt-rx-emoji"), emoji, 7);
    TT.sfx("tap");
    schedule(rec);
  }
  function schedule(r) {
    clearTimeout(r.timer);
    r.timer = setTimeout(function () { retire(r); }, 3600);
  }
  function retire(r) {
    if (r.out) return;
    r.out = true;
    clearTimeout(r.timer);
    r.el.classList.add("is-out");
    setTimeout(function () {
      r.el.remove();
      rxLive = rxLive.filter(function (x) { return x !== r; });
    }, 900);
  }
  function spray(anchor, emoji, n) {
    for (var i = 0; i < n; i++) {
      var m = TT.el("span", "tt-rx-mini", esc(emoji));
      var a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
      var d = 70 + Math.random() * 90;
      m.style.setProperty("--dx", Math.round(Math.cos(a) * d) + "px");
      m.style.setProperty("--dy", Math.round(Math.sin(a) * d) + "px");
      m.style.setProperty("--rot", Math.round((Math.random() - 0.5) * 120) + "deg");
      m.style.animationDelay = (i * 40) + "ms";
      anchor.appendChild(m);
      (function (x) { setTimeout(function () { x.remove(); }, 1400); })(m);
    }
  }

  /* ───────────────────────── host dock ───────────────────────── */
  root.addEventListener("click", function (e) {
    var b;
    if ((b = e.target.closest("[data-view-btn]"))) host("view", { view: b.dataset.viewBtn });
    else if ((b = e.target.closest("[data-game]"))) host("game", { game: b.dataset.game });
    else if ((b = e.target.closest("#tt-deal, .tt-deal"))) {
      if (activeMatches().length && !confirm("Tables are still playing. Deal a new round for everyone who's free?")) return;
      host("deal", { game: night.game });
    }
    else if ((b = e.target.closest("#tt-end"))) { if (confirm("Stop every table now? No points are given for unfinished games.")) host("end_round"); }
    else if ((b = e.target.closest("[data-match]"))) { featured = +b.dataset.match; lastCut = Date.now(); showFeatured(true); renderTables(); }
    else if ((b = e.target.closest("#tt-prev, #tt-next"))) {
      var ids = Object.values(matches).sort(function (a, c) { return a.table - c.table; }).map(function (x) { return x.id; });
      if (!ids.length) return;
      var i = ids.indexOf(featured);
      featured = ids[(i + (b.id === "tt-next" ? 1 : ids.length - 1)) % ids.length];
      lastCut = Date.now(); showFeatured(true); renderTables();
    }
    else if ((b = e.target.closest("#tt-auto"))) { autoCam = !autoCam; b.classList.toggle("is-on", autoCam); }
    else if ((b = e.target.closest("#tt-mute"))) { TT.setMuted(!TT.isMuted()); b.textContent = TT.isMuted() ? "🔇" : "🔊"; }
    else if ((b = e.target.closest("[data-fs]"))) toggleFullscreen();
    else if ((b = e.target.closest("#tt-people-btn"))) { $("tt-people").hidden = !$("tt-people").hidden; renderPeople(); }
    else if ((b = e.target.closest("[data-kick]"))) { if (confirm("Remove this player from the night?")) host("kick", { player: +b.dataset.kick }); }
    else if ((b = e.target.closest("[data-bench]"))) host("bench", { player: +b.dataset.bench });
    else if ((b = e.target.closest("[data-resign]"))) {
      var parts = b.dataset.resign.split(":");
      if (confirm("End this player's game as a loss (e.g. they left)?")) host("resign_for", { match: +parts[0], seat: +parts[1] });
    }
    else if ((b = e.target.closest("#tt-reset"))) { if (confirm("Reset every score to zero?")) host("reset_scores"); }
  });
  ["tt-pairing", "tt-wordcheck", "tt-damsize"].forEach(function (id) {
    var el = $(id); if (!el) return;
    el.addEventListener("change", function () {
      if (id === "tt-pairing") host("pairing", { pairing: el.value });
      if (id === "tt-wordcheck") host("words_check", { on: el.checked });
      if (id === "tt-damsize") host("dam_size", { size: parseInt(el.value, 10) });
    });
  });
  function renderPeople() {
    var box = $("tt-people-list");
    if (!box || $("tt-people").hidden) return;
    box.innerHTML = players.map(function (p) {
      var seat = Object.values(matches).filter(function (x) {
        return x.status === "active" && x.seats.some(function (s) { return s.id === p.id; });
      })[0];
      var resign = seat ? '<button type="button" data-resign="' + seat.id + ":" + seat.seats.findIndex(function (s) { return s.id === p.id; }) + '">End their game</button>' : "";
      return '<li>' + TT.avatar(p.avatar, 32) + "<span>" + esc(p.name) + (p.online ? "" : " · away") + "</span>" +
        '<button type="button" data-bench="' + p.id + '">' + (p.benched ? "Unbench" : "Sit out") + "</button>" + resign +
        '<button type="button" class="is-bad" data-kick="' + p.id + '">Remove</button></li>';
    }).join("") || "<li>No players yet.</li>";
  }

  // hide the dock when the mouse is idle
  var idleT = null;
  function wake() {
    root.classList.remove("is-idle");
    clearTimeout(idleT);
    idleT = setTimeout(function () { if (!root.querySelector(".tt-dock:hover")) root.classList.add("is-idle"); }, 4000);
  }
  ["mousemove", "keydown", "touchstart"].forEach(function (ev) { window.addEventListener(ev, wake, { passive: true }); });
  wake();
  /* ───────────────────────── full screen + keep awake ───────────────────────── */
  function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
  function toggleFullscreen() {
    var d = document.documentElement;
    if (fsElement()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      try { localStorage.setItem("tt-fs", "0"); } catch (e) { /* ignore */ }
      return;
    }
    var req = d.requestFullscreen || d.webkitRequestFullscreen;
    if (!req) { toast("This browser can't go full screen — try Chrome or Edge, or press F11.", true); return; }
    var pr = req.call(d, { navigationUI: "hide" });
    if (pr && pr.catch) pr.catch(function () { toast("Full screen was blocked — press F11 instead.", true); });
    try { localStorage.setItem("tt-fs", "1"); } catch (e) { /* ignore */ }
    TT.keepAwake().request();     // the click is a user gesture: a good moment to (re)lock
  }
  function onFsChange() {
    var on = !!fsElement();
    root.classList.toggle("is-fullscreen", on);
    [].forEach.call(document.querySelectorAll(".tt-fs-label"), function (l) { l.textContent = on ? "Exit full screen" : "Full screen"; });
    if (on) $("tt-fs-resume").hidden = true;
  }
  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("webkitfullscreenchange", onFsChange);
  // double-click the board to toggle
  var feat = document.querySelector(".tt-featured");
  if (feat) feat.addEventListener("dblclick", toggleFullscreen);
  // after a reload mid-event the browser won't re-enter full screen by itself
  // (it needs a click), so offer a one-tap way back
  try { if (localStorage.getItem("tt-fs") === "1" && !fsElement()) $("tt-fs-resume").hidden = false; } catch (e) { /* ignore */ }
  TT.awakeBadge($("tt-awake"));

  window.addEventListener("keydown", function (e) {
    if (e.target.matches("input, select, textarea")) return;
    if (e.key === "f" || e.key === "F") { toggleFullscreen(); return; }
    if (e.key === "ArrowRight") $("tt-next").click();
    if (e.key === "ArrowLeft") $("tt-prev").click();
    if (e.key === "1") host("view", { view: "split" });
    if (e.key === "2") host("view", { view: "board" });
    if (e.key === "3") host("view", { view: "leaderboard" });
    if (e.key === "4") host("view", { view: "tables" });
  });
  setInterval(function () { renderPeople(); }, 5000);
})();
