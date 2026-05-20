/* ════════════════════════════════════════════════════════════════════
   boardly_play.js — participant sticky-pad client
   Mirrors the structure of play.js: owns the WebSocket, swaps steps,
   speaks the same {type:"state"} protocol the presenter consumer emits.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var play = document.getElementById("play");
  if (!play) return;

  var CODE = play.dataset.code;
  var MODE = play.dataset.mode || "open";

  /* ── DOM refs ─────────────────────────────────────────────────────── */
  var stepNick    = document.getElementById("step-nick");
  var stepWait    = document.getElementById("step-wait");
  var stepCompose = document.getElementById("step-compose");
  var stepEnded   = document.getElementById("step-ended");

  var nickInput = document.getElementById("nick-input");
  var nickGo    = document.getElementById("nick-go");

  var boardPrompt = document.getElementById("board-prompt");
  var noteInput   = document.getElementById("note-input");
  var charNow     = document.getElementById("char-now");
  var postBtn     = document.getElementById("post-note");
  var postHint    = document.getElementById("post-hint");

  var preview     = document.getElementById("sticky-preview");
  var previewIcon = document.getElementById("preview-icon");
  var previewText = document.getElementById("preview-text");

  var colorRow = document.getElementById("color-row");
  var iconRow  = document.getElementById("icon-row");

  var groupField = document.getElementById("group-field");
  var groupPills = document.getElementById("group-pills");

  var mineField   = document.getElementById("mine-field");
  var mineList    = document.getElementById("mine-list");
  var myNoteCount = document.getElementById("my-note-count");

  var statusDot = document.getElementById("status-dot");
  var toastEl   = document.getElementById("toast");

  /* ── Icon map: key → bootstrap-icons class ───────────────────────── */
  var ICONS = {
    lightbulb: "bi-lightbulb", star: "bi-star", heart: "bi-heart",
    chat: "bi-chat-dots", people: "bi-people", target: "bi-bullseye",
    rocket: "bi-rocket-takeoff", check: "bi-check-circle", none: ""
  };

  /* ── Local state ──────────────────────────────────────────────────── */
  var state = {
    nick: "",
    color: 0,
    icon: "lightbulb",
    groupId: null,
    myNotes: [],          // [{id,text,color,likes,removed}]
    likedIds: {},         // note ids this participant has liked
    boardOpen: false,
    posting: false
  };
  var ws = null;

  /* ── Helpers ──────────────────────────────────────────────────────── */
  function show(el) { if (el) el.style.display = ""; }
  function hide(el) { if (el) el.style.display = "none"; }

  function showStep(which) {
    hide(stepNick); hide(stepWait); hide(stepCompose); hide(stepEnded);
    show(which);
  }

  var toastTimer = null;
  function toast(msg, kind) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = "kk-toast show" + (kind ? " is-" + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.className = "kk-toast" + (kind ? " is-" + kind : "");
    }, 2600);
  }

  /* ── Live sticky-note preview ─────────────────────────────────────── */
  function renderPreview() {
    preview.setAttribute("data-color", String(state.color));

    var iconClass = ICONS[state.icon];
    if (iconClass) {
      previewIcon.style.display = "";
      previewIcon.innerHTML = '<i class="bi ' + iconClass + '"></i>';
    } else {
      previewIcon.style.display = "none";
    }

    var txt = noteInput.value.trim();
    if (txt) {
      previewText.textContent = txt;
      previewText.classList.remove("is-placeholder");
    } else {
      previewText.textContent = "Your note appears here…";
      previewText.classList.add("is-placeholder");
    }
  }

  /* ── My-notes list (with live like counts) ────────────────────────── */
  function renderMine() {
    var live = state.myNotes.filter(function (n) { return !n.removed; });
    myNoteCount.textContent = String(live.length);

    if (!state.myNotes.length) { hide(mineField); return; }
    show(mineField);

    mineList.innerHTML = "";
    state.myNotes.forEach(function (n) {
      var row = document.createElement("div");
      row.className = "kk-mine-item" + (n.removed ? " removed" : "");

      var sw = document.createElement("span");
      sw.className = "kk-mine-swatch";
      sw.style.background = noteFill(n.color);

      var tx = document.createElement("span");
      tx.className = "kk-mine-text";
      tx.textContent = n.text;

      var lk = document.createElement("span");
      lk.className = "kk-mine-likes";
      lk.innerHTML = '<i class="bi bi-heart-fill"></i> ' + (n.likes || 0);

      row.appendChild(sw); row.appendChild(tx); row.appendChild(lk);
      mineList.appendChild(row);
    });
  }

  var FILLS = ["#fbcfe8", "#fde68a", "#bbf7d0", "#bfdbfe", "#ddd6fe", "#fed7aa"];
  function noteFill(i) { return FILLS[i] || FILLS[0]; }

  /* ── Group pills ──────────────────────────────────────────────────── */
  function renderGroups(groups) {
    if (!groups || !groups.length) { hide(groupField); state.groupId = null; return; }
    show(groupField);
    groupPills.innerHTML = "";

    groups.forEach(function (g, idx) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "kk-group-pill";
      b.textContent = g.name;
      b.dataset.groupId = g.id;
      if ((state.groupId == null && idx === 0) || state.groupId === g.id) {
        b.classList.add("is-active");
        state.groupId = g.id;
      }
      b.addEventListener("click", function () {
        state.groupId = g.id;
        Array.prototype.forEach.call(groupPills.children, function (c) {
          c.classList.toggle("is-active", c === b);
        });
      });
      groupPills.appendChild(b);
    });
  }

  /* ── WebSocket — same endpoint pattern as the poll ────────────────── */
  function wsURL() {
    var proto = location.protocol === "https:" ? "wss" : "ws";
    return proto + "://" + location.host + "/ws/board/" + CODE + "/";
  }

  function connect() {
    ws = new WebSocket(wsURL());

    ws.addEventListener("open", function () {
      if (statusDot) statusDot.style.color = "var(--kk-success)";
    });
    ws.addEventListener("close", function () {
      if (statusDot) statusDot.style.color = "var(--kk-danger)";
      setTimeout(connect, 1500);   // auto-reconnect
    });
    ws.addEventListener("message", function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handle(msg);
    });
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }

  /* ── Incoming messages ────────────────────────────────────────────── */
  function handle(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === "state") {
      applyState(msg);

    } else if (msg.type === "note_ack") {
      // Server confirmed our note; add to my-notes with its real id.
      state.posting = false;
      postBtn.disabled = false;
      postBtn.innerHTML = '<i class="bi bi-send"></i> Post to board';
      state.myNotes.push({
        id: msg.id, text: msg.text, color: msg.color,
        likes: 0, removed: false
      });
      renderMine();
      noteInput.value = "";
      charNow.textContent = "0";
      renderPreview();
      toast("Posted to the board ✨", "success");

    } else if (msg.type === "note_rejected") {
      state.posting = false;
      postBtn.disabled = false;
      postBtn.innerHTML = '<i class="bi bi-send"></i> Post to board';
      toast(msg.reason || "Note could not be posted.", "error");

    } else if (msg.type === "note_likes") {
      // Live like-count update for any note; reflect mine.
      var mn = findMine(msg.id);
      if (mn) { mn.likes = msg.likes; renderMine(); }

    } else if (msg.type === "note_removed") {
      var rm = findMine(msg.id);
      if (rm) {
        rm.removed = true;
        renderMine();
        toast("A presenter removed one of your notes.", "warn");
      }

    } else if (msg.type === "note_restored") {
      var rs = findMine(msg.id);
      if (rs) { rs.removed = false; renderMine(); }
    }
  }

  function findMine(id) {
    for (var i = 0; i < state.myNotes.length; i++) {
      if (state.myNotes[i].id === id) return state.myNotes[i];
    }
    return null;
  }

  function applyState(s) {
    // Prompt / subtitle for the board.
    if (s.prompt) boardPrompt.textContent = s.prompt;

    // Groups (columns) — drives the picker visibility.
    renderGroups(s.groups);

    // Board lifecycle.
    if (s.state === "ended" || s.state === "closed") {
      showStep(stepEnded);
      state.boardOpen = false;
      return;
    }
    if (s.state === "open" || s.state === "running") {
      state.boardOpen = true;
      if (state.nick) {
        showStep(stepCompose);
        postBtn.disabled = false;
        postHint.textContent = "It appears on the screen instantly.";
      } else {
        showStep(stepNick);
      }
    } else {
      // lobby / waiting
      if (state.nick) showStep(stepWait);
      else showStep(stepNick);
    }
  }

  /* ── Join ─────────────────────────────────────────────────────────── */
  function join() {
    var name = (nickInput.value || "").trim();
    if (!name) { nickInput.focus(); return; }
    state.nick = name;
    send({ type: "join", nick: name });
    showStep(state.boardOpen ? stepCompose : stepWait);
  }

  nickGo.addEventListener("click", join);
  nickInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") join();
  });

  /* ── Compose interactions ─────────────────────────────────────────── */
  noteInput.addEventListener("input", function () {
    charNow.textContent = String(noteInput.value.length);
    renderPreview();
  });

  colorRow.addEventListener("click", function (e) {
    var dot = e.target.closest(".kk-color-dot");
    if (!dot) return;
    state.color = parseInt(dot.dataset.color, 10) || 0;
    Array.prototype.forEach.call(colorRow.children, function (c) {
      var on = c === dot;
      c.classList.toggle("is-active", on);
      c.setAttribute("aria-checked", on ? "true" : "false");
    });
    renderPreview();
  });

  iconRow.addEventListener("click", function (e) {
    var pick = e.target.closest(".kk-icon-pick");
    if (!pick) return;
    state.icon = pick.dataset.icon || "none";
    Array.prototype.forEach.call(iconRow.children, function (c) {
      var on = c === pick;
      c.classList.toggle("is-active", on);
      c.setAttribute("aria-checked", on ? "true" : "false");
    });
    renderPreview();
  });

  /* ── Post a note ──────────────────────────────────────────────────── */
  postBtn.addEventListener("click", function () {
    if (state.posting) return;
    var text = (noteInput.value || "").trim();
    if (!text) { noteInput.focus(); toast("Write something first ✏️", "warn"); return; }
    if (!state.boardOpen) { toast("The board isn't open yet.", "warn"); return; }

    state.posting = true;
    postBtn.disabled = true;
    postBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Posting…';

    send({
      type: "note",
      text: text,
      color: state.color,
      icon: state.icon,
      group_id: state.groupId
    });

    // Safety: re-enable if no ack arrives.
    setTimeout(function () {
      if (state.posting) {
        state.posting = false;
        postBtn.disabled = false;
        postBtn.innerHTML = '<i class="bi bi-send"></i> Post to board';
      }
    }, 6000);
  });

  /* ── Boot ─────────────────────────────────────────────────────────── */
  renderPreview();
  connect();
})();
