/* ════════════════════════════════════════════════════════════════════
   boardly_stage.js — presenter / projector board client
   Renders the live whiteboard, QR code, layout switching, auto-fit
   sizing, reaction bursts, and moderation. Owns its own WebSocket.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var stage = document.getElementById("stage");
  if (!stage) return;

  var CODE     = stage.dataset.code;
  var JOIN_URL = stage.dataset.joinUrl || "";

  /* ── DOM refs ─────────────────────────────────────────────────────── */
  var notesArea   = document.getElementById("notes-area");
  var boardEmpty  = document.getElementById("board-empty");
  var boardCols   = document.getElementById("board-columns");
  var boardFx     = document.getElementById("board-fx");
  var promptDisp  = document.getElementById("board-prompt-display");

  var statNotes   = document.getElementById("stat-notes");
  var statPeople  = document.getElementById("stat-people");

  var qrBox       = document.getElementById("qr-box");
  var joinPanel   = document.getElementById("join-panel");
  var joinCollapse= document.getElementById("join-collapse");

  var btnFs       = document.getElementById("btn-fullscreen");
  var btnMod      = document.getElementById("btn-moderate");
  var modTray     = document.getElementById("mod-tray");
  var modClose    = document.getElementById("mod-close");
  var modHidden   = document.getElementById("mod-hidden-list");
  var layoutBtns  = stage.querySelectorAll(".kk-board-layout");
  var modPopTpl   = document.getElementById("tpl-mod-popover");

  /* ── Constants ────────────────────────────────────────────────────── */
  var ICONS = {
    lightbulb: "bi-lightbulb", star: "bi-star", heart: "bi-heart",
    chat: "bi-chat-dots", people: "bi-people", target: "bi-bullseye",
    rocket: "bi-rocket-takeoff", check: "bi-check-circle", none: ""
  };
  var FILL = {
    0: ["#fbcfe8", "#f5a8d0"], 1: ["#fde68a", "#f6cf4d"],
    2: ["#bbf7d0", "#86e3a6"], 3: ["#bfdbfe", "#8fbef5"],
    4: ["#ddd6fe", "#bcaff7"], 5: ["#fed7aa", "#f9b878"]
  };

  /* ── Local state ──────────────────────────────────────────────────── */
  var layout    = "grid";
  var moderating= false;
  var notes     = {};   // id -> note record
  var order     = [];   // note ids in arrival order
  var groups    = [];   // [{id,name}]
  var ws        = null;
  var openPop   = null;

  /* ── QR code ──────────────────────────────────────────────────────── */
  function renderQR() {
    if (!window.QRCode || !qrBox || !JOIN_URL) return;
    qrBox.innerHTML = "";
    new window.QRCode(qrBox, {
      text: JOIN_URL,
      width: 220, height: 220,
      colorDark: "#1a0b2e", colorLight: "#ffffff",
      correctLevel: window.QRCode.CorrectLevel.M
    });
  }

  /* ── Auto-fit: shrink notes as the board fills ────────────────────── */
  function autoFit() {
    var n = order.length;
    var w = 230;
    if (n > 8)  w = 210;
    if (n > 18) w = 188;
    if (n > 30) w = 168;
    if (n > 46) w = 150;
    if (n > 64) w = 134;
    notesArea.style.setProperty("--note-w", w + "px");
  }

  /* ── Build one sticky-note element ────────────────────────────────── */
  function buildNote(note, isNew) {
    var el = document.createElement("div");
    el.className = "kk-note";
    if (isNew) el.classList.add("is-new");
    if (note.pinned) el.classList.add("pinned");
    if (note.hidden) el.classList.add("hidden-note");
    el.dataset.id = note.id;

    // Colour.
    var fill = FILL[note.color] || FILL[0];
    el.style.setProperty("--note", fill[0]);
    el.style.setProperty("--note-deep", fill[1]);

    // Gentle deterministic tilt so the scatter layout looks organic
    // but a note never jumps around between re-renders.
    var seed = hashId(note.id);
    var tilt = ((seed % 9) - 4) * 0.9;          // -3.6° … +3.6°
    el.style.setProperty("--tilt", tilt.toFixed(2) + "deg");
    el.style.setProperty("--drift", ((seed % 5) - 2) * 6 + "px");

    // Pin marker.
    if (note.pinned) {
      var pin = document.createElement("span");
      pin.className = "kk-note-pin";
      pin.innerHTML = '<i class="bi bi-pin-angle-fill"></i>';
      el.appendChild(pin);
    }

    // Icon.
    var iconClass = ICONS[note.icon];
    if (iconClass) {
      var ic = document.createElement("span");
      ic.className = "kk-note-icon";
      ic.innerHTML = '<i class="bi ' + iconClass + '"></i>';
      el.appendChild(ic);
    }

    // Text.
    var tx = document.createElement("p");
    tx.className = "kk-note-text";
    tx.textContent = note.text;
    el.appendChild(tx);

    // Footer: author + like button.
    var foot = document.createElement("div");
    foot.className = "kk-note-foot";

    var auth = document.createElement("span");
    auth.className = "kk-note-author";
    auth.textContent = note.author || "Anonymous";

    var like = document.createElement("button");
    like.className = "kk-note-like";
    like.type = "button";
    like.innerHTML = '<i class="bi bi-heart-fill"></i><span>' + (note.likes || 0) + '</span>';
    like.addEventListener("click", function (e) {
      e.stopPropagation();
      send({ type: "like", id: note.id });
      like.classList.add("liked");
    });

    foot.appendChild(auth);
    foot.appendChild(like);
    el.appendChild(foot);

    // Moderation click.
    el.addEventListener("click", function () {
      if (moderating) openModPopover(el, note);
    });

    return el;
  }

  function hashId(id) {
    var h = 0, s = String(id);
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  /* ── Render the whole board ───────────────────────────────────────── */
  function render(newId) {
    var visible = order.filter(function (id) {
      var n = notes[id];
      return n && !n.hidden;
    });

    statNotes.textContent = String(visible.length);

    if (groups.length) {
      notesArea.style.display = "none";
      renderColumns(newId);
    } else {
      boardCols.style.display = "none";
      notesArea.style.display = "";
      renderFlat(visible, newId);
    }
    autoFit();
    renderModHidden();
  }

  function renderFlat(visible, newId) {
    notesArea.className = "kk-notes-area layout-" + layout;

    if (!visible.length) {
      notesArea.innerHTML = "";
      notesArea.appendChild(boardEmpty);
      boardEmpty.style.display = "";
      return;
    }
    boardEmpty.style.display = "none";

    // Reconcile: keep existing nodes, append new ones, drop removed.
    var present = {};
    Array.prototype.forEach.call(
      notesArea.querySelectorAll(".kk-note"),
      function (el) { present[el.dataset.id] = el; }
    );

    visible.forEach(function (id) {
      if (!present[id]) {
        notesArea.appendChild(buildNote(notes[id], id === newId));
      } else {
        delete present[id];
      }
    });
    // Anything still in `present` was removed/hidden — peel it away.
    Object.keys(present).forEach(function (id) { peel(present[id]); });
  }

  function renderColumns(newId) {
    boardCols.style.display = "";
    boardCols.innerHTML = "";

    groups.forEach(function (g) {
      var col = document.createElement("div");
      col.className = "kk-board-column";

      var head = document.createElement("div");
      head.className = "kk-board-column-head";

      var body = document.createElement("div");
      body.className = "kk-board-column-body";

      var inThis = order.filter(function (id) {
        var n = notes[id];
        return n && !n.hidden && n.groupId === g.id;
      });
      head.innerHTML = g.name + ' <span class="count">' + inThis.length + "</span>";

      inThis.forEach(function (id) {
        body.appendChild(buildNote(notes[id], id === newId));
      });

      col.appendChild(head);
      col.appendChild(body);
      boardCols.appendChild(col);
    });
  }

  function peel(el) {
    el.classList.add("is-leaving");
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 360);
  }

  /* ── Reaction burst FX ────────────────────────────────────────────── */
  function burst(emoji) {
    for (var i = 0; i < 3; i++) {
      (function (k) {
        setTimeout(function () {
          var h = document.createElement("span");
          h.className = "kk-fx-heart";
          h.textContent = emoji || "❤️";
          h.style.left = (20 + Math.random() * 60) + "%";
          h.style.bottom = (8 + Math.random() * 12) + "%";
          boardFx.appendChild(h);
          setTimeout(function () {
            if (h.parentNode) h.parentNode.removeChild(h);
          }, 1200);
        }, k * 110);
      })(i);
    }
  }

  /* ── Moderation ───────────────────────────────────────────────────── */
  function setModerating(on) {
    moderating = on;
    stage.classList.toggle("moderating", on);
    modTray.setAttribute("aria-hidden", on ? "false" : "true");
    btnMod.classList.toggle("active", on);
    if (!on) closeModPopover();
  }

  function openModPopover(noteEl, note) {
    closeModPopover();
    var pop = modPopTpl.content.firstElementChild.cloneNode(true);
    var r = noteEl.getBoundingClientRect();
    pop.style.left = Math.max(8, r.left) + "px";
    pop.style.top  = (r.top - 46 + window.scrollY) + "px";

    pop.querySelector('[data-act="hide"]').addEventListener("click", function () {
      send({ type: "mod", action: "hide", id: note.id });
      closeModPopover();
    });
    pop.querySelector('[data-act="delete"]').addEventListener("click", function () {
      send({ type: "mod", action: "delete", id: note.id });
      closeModPopover();
    });
    pop.querySelector('[data-act="pin"]').addEventListener("click", function () {
      send({ type: "mod", action: note.pinned ? "unpin" : "pin", id: note.id });
      closeModPopover();
    });

    document.body.appendChild(pop);
    openPop = pop;
  }
  function closeModPopover() {
    if (openPop && openPop.parentNode) openPop.parentNode.removeChild(openPop);
    openPop = null;
  }

  function renderModHidden() {
    var hidden = order.filter(function (id) {
      return notes[id] && notes[id].hidden;
    });
    if (!hidden.length) {
      modHidden.innerHTML = '<span class="text-secondary small">' +
        "Hidden notes appear here — tap to restore.</span>";
      return;
    }
    modHidden.innerHTML = "";
    hidden.forEach(function (id) {
      var n = notes[id];
      var chip = document.createElement("button");
      chip.className = "kk-mod-chip";
      chip.innerHTML = '<i class="bi bi-eye"></i> ' +
        (n.text.length > 28 ? n.text.slice(0, 28) + "…" : n.text);
      chip.addEventListener("click", function () {
        send({ type: "mod", action: "show", id: id });
      });
      modHidden.appendChild(chip);
    });
  }

  /* ── WebSocket ────────────────────────────────────────────────────── */
  function wsURL() {
    var proto = location.protocol === "https:" ? "wss" : "ws";
    return proto + "://" + location.host + "/ws/board/" + CODE + "/";
  }

  function connect() {
    ws = new WebSocket(wsURL());
    ws.addEventListener("open", function () {
      send({ type: "presenter_hello" });
    });
    ws.addEventListener("close", function () {
      setTimeout(connect, 1500);
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
      // Full snapshot — used on (re)connect.
      if (msg.prompt && promptDisp) promptDisp.textContent = msg.prompt;
      groups = msg.groups || [];
      notes = {};
      order = [];
      (msg.notes || []).forEach(function (n) {
        notes[n.id] = normalize(n);
        order.push(n.id);
      });
      if (typeof msg.participants === "number") {
        statPeople.textContent = String(msg.participants);
      }
      render(null);

    } else if (msg.type === "note_added") {
      var n = normalize(msg.note);
      if (!notes[n.id]) order.push(n.id);
      notes[n.id] = n;
      render(n.id);

    } else if (msg.type === "note_likes") {
      if (notes[msg.id]) {
        notes[msg.id].likes = msg.likes;
        updateLikeBadge(msg.id, msg.likes);
        burst("❤️");
      }

    } else if (msg.type === "note_moderated") {
      var note = notes[msg.id];
      if (!note) return;
      if (msg.action === "hide")   note.hidden = true;
      if (msg.action === "show")   note.hidden = false;
      if (msg.action === "delete") { delete notes[msg.id]; order = order.filter(function (i) { return i !== msg.id; }); }
      if (msg.action === "pin")    note.pinned = true;
      if (msg.action === "unpin")  note.pinned = false;
      render(null);

    } else if (msg.type === "participants") {
      statPeople.textContent = String(msg.count);

    } else if (msg.type === "board_ended") {
      promptDisp.textContent = "Board closed — thanks everyone!";
    }
  }

  function normalize(n) {
    return {
      id: n.id, text: n.text || "",
      color: typeof n.color === "number" ? n.color : 0,
      icon: n.icon || "none",
      author: n.author || "Anonymous",
      likes: n.likes || 0,
      groupId: n.group_id != null ? n.group_id : null,
      hidden: !!n.hidden,
      pinned: !!n.pinned
    };
  }

  function updateLikeBadge(id, likes) {
    var el = stage.querySelector('.kk-note[data-id="' + cssEsc(id) + '"] .kk-note-like span');
    if (el) el.textContent = String(likes);
  }
  function cssEsc(s) {
    return String(s).replace(/["\\]/g, "\\$&");
  }

  /* ── Controls ─────────────────────────────────────────────────────── */
  Array.prototype.forEach.call(layoutBtns, function (btn) {
    btn.addEventListener("click", function () {
      layout = btn.dataset.layout;
      Array.prototype.forEach.call(layoutBtns, function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      render(null);
    });
  });

  btnMod.addEventListener("click", function () { setModerating(!moderating); });
  modClose.addEventListener("click", function () { setModerating(false); });

  btnFs.addEventListener("click", function () {
    if (!document.fullscreenElement) {
      (document.documentElement.requestFullscreen || function () {}).call(document.documentElement);
      stage.classList.add("fullscreen");
    } else {
      (document.exitFullscreen || function () {}).call(document);
      stage.classList.remove("fullscreen");
    }
  });

  joinCollapse.addEventListener("click", function () {
    joinPanel.classList.toggle("collapsed");
  });

  document.addEventListener("click", function (e) {
    if (openPop && !openPop.contains(e.target) && !e.target.closest(".kk-note")) {
      closeModPopover();
    }
  });
  window.addEventListener("resize", closeModPopover);

  /* ── Boot ─────────────────────────────────────────────────────────── */
  renderQR();
  connect();
})();
