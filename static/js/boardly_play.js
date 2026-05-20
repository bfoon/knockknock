/* boardly_play.js — participant sticky-pad controller.
 *
 * Speaks the BoardConsumer JSON protocol. Drives the four steps in
 * play_board.html:
 *     #step-nick     enter a nickname
 *     #step-wait     waiting for the presenter to open the board
 *     #step-compose  the sticky pad (post notes)
 *     #step-ended    board closed
 *
 * The whole point of this file: when a {type:"state"} snapshot or a live
 * {type:"board_state"} arrives, we move the participant to the right step.
 * Without it, the page is hardcoded on #step-wait forever.
 */
(function () {
  "use strict";

  const root = document.getElementById("play");
  if (!root) return;

  const CODE = root.dataset.code;
  const MODE = root.dataset.mode || "open";

  // ── element refs ───────────────────────────────────────────────────
  const steps = {
    nick: document.getElementById("step-nick"),
    wait: document.getElementById("step-wait"),
    compose: document.getElementById("step-compose"),
    ended: document.getElementById("step-ended"),
  };
  const statusDot = document.getElementById("status-dot");

  const nickInput = document.getElementById("nick-input");
  const nickGo = document.getElementById("nick-go");

  const promptEl = document.getElementById("board-prompt");
  const myCountEl = document.getElementById("my-note-count");

  const preview = document.getElementById("sticky-preview");
  const previewIcon = document.getElementById("preview-icon");
  const previewText = document.getElementById("preview-text");

  const groupField = document.getElementById("group-field");
  const groupPills = document.getElementById("group-pills");

  const noteInput = document.getElementById("note-input");
  const charNow = document.getElementById("char-now");
  const colorRow = document.getElementById("color-row");
  const iconRow = document.getElementById("icon-row");

  const mineField = document.getElementById("mine-field");
  const mineList = document.getElementById("mine-list");

  const postBtn = document.getElementById("post-note");
  const postHint = document.getElementById("post-hint");
  const toast = document.getElementById("toast");

  const ICON_GLYPH = {
    lightbulb: "bi-lightbulb", star: "bi-star", heart: "bi-heart",
    chat: "bi-chat-dots", people: "bi-people", target: "bi-bullseye",
    rocket: "bi-rocket-takeoff", check: "bi-check-circle", none: "",
  };

  // ── local UI state ─────────────────────────────────────────────────
  let nick = "";
  let joined = false;          // have we sent {type:"join"} yet?
  let boardState = "lobby";    // last known board state
  let selectedColor = 0;
  let selectedIcon = "lightbulb";
  let selectedGroup = null;    // group id, or null
  const myNotes = [];          // {id, text, color, likes, removed}

  // ── step switching ─────────────────────────────────────────────────
  function showStep(name) {
    Object.entries(steps).forEach(([key, el]) => {
      if (el) el.style.display = key === name ? "" : "none";
    });
  }

  // Decide which step a participant should see, given board state and
  // whether they've entered a name yet.
  function syncStep() {
    if (boardState === "ended") { showStep("ended"); return; }
    if (!nick) { showStep("nick"); return; }
    if (boardState === "open" || boardState === "running") {
      if (!joined) sendJoin();
      showStep("compose");
    } else {
      // lobby / unknown → still waiting for the presenter.
      if (!joined) sendJoin();   // count us as present in the lobby too
      showStep("wait");
    }
  }

  // ── toast ──────────────────────────────────────────────────────────
  let toastTimer = null;
  function showToast(msg, isError) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.toggle("is-error", !!isError);
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  // ── live preview ───────────────────────────────────────────────────
  function refreshPreview() {
    if (preview) preview.dataset.color = String(selectedColor);
    if (previewText) {
      const t = (noteInput && noteInput.value.trim()) || "";
      previewText.textContent = t || "Your note appears here…";
    }
    if (previewIcon) {
      const glyph = ICON_GLYPH[selectedIcon] || "";
      previewIcon.innerHTML = glyph ? `<i class="bi ${glyph}"></i>` : "";
      previewIcon.style.display = glyph ? "" : "none";
    }
  }

  // ── group pills ────────────────────────────────────────────────────
  function renderGroups(groups) {
    if (!groupField || !groupPills) return;
    if (!groups || !groups.length) {
      groupField.style.display = "none";
      selectedGroup = null;
      return;
    }
    groupField.style.display = "";
    groupPills.innerHTML = "";
    // Default to the first column if nothing chosen yet.
    if (selectedGroup === null) selectedGroup = groups[0].id;
    groups.forEach((g) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "kk-group-pill" + (g.id === selectedGroup ? " is-active" : "");
      b.textContent = g.name;
      b.dataset.gid = g.id;
      b.addEventListener("click", () => {
        selectedGroup = g.id;
        groupPills.querySelectorAll(".kk-group-pill").forEach((p) =>
          p.classList.toggle("is-active", p.dataset.gid === String(g.id)));
      });
      groupPills.appendChild(b);
    });
  }

  // ── "my notes" list ────────────────────────────────────────────────
  function renderMine() {
    if (!mineField || !mineList) return;
    const visible = myNotes.filter((n) => n.id != null);
    if (myCountEl) myCountEl.textContent = String(visible.length);
    if (!visible.length) { mineField.style.display = "none"; return; }
    mineField.style.display = "";
    mineList.innerHTML = "";
    visible.forEach((n) => {
      const item = document.createElement("div");
      item.className = "kk-mine-item" + (n.removed ? " removed" : "");
      item.dataset.id = n.id;

      const sw = document.createElement("span");
      sw.className = "kk-mine-swatch";
      sw.style.setProperty("--c", noteColorVar(n.color));

      const txt = document.createElement("span");
      txt.className = "kk-mine-text";
      txt.textContent = n.text;

      const likes = document.createElement("span");
      likes.className = "kk-mine-likes";
      likes.innerHTML = `<i class="bi bi-heart-fill"></i> ${n.likes || 0}`;

      item.append(sw, txt, likes);
      mineList.appendChild(item);
    });
  }

  const NOTE_FILLS = ["#fbcfe8", "#fde68a", "#bbf7d0", "#bfdbfe", "#ddd6fe", "#fed7aa"];
  function noteColorVar(c) {
    return NOTE_FILLS[Math.max(0, Math.min(Number(c) || 0, 5))];
  }

  // ── WebSocket ──────────────────────────────────────────────────────
  let sock = null;
  let reconnectTimer = null;

  function wsURL() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}/ws/board/${CODE}/`;
  }

  function connect() {
    sock = new WebSocket(wsURL());

    sock.addEventListener("open", () => {
      if (statusDot) statusDot.style.color = "#5fd38a";
      // If we already had a name (e.g. reconnect), re-announce.
      if (nick) sendJoin(true);
    });

    sock.addEventListener("close", () => {
      if (statusDot) statusDot.style.color = "#e0466b";
      joined = false;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 1500);
    });

    sock.addEventListener("error", () => { try { sock.close(); } catch (e) {} });

    sock.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handle(msg);
    });
  }

  function send(obj) {
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify(obj));
    }
  }

  function sendJoin(force) {
    if (joined && !force) return;
    send({ type: "join", nick: nick || "Anonymous" });
    joined = true;
  }

  // ── inbound message handling ───────────────────────────────────────
  function handle(msg) {
    switch (msg.type) {
      case "state": {
        boardState = msg.state || "lobby";
        if (promptEl && msg.prompt) promptEl.textContent = msg.prompt;
        renderGroups(msg.groups || []);
        // Reconcile likes for any of *our* notes already on the board.
        if (Array.isArray(msg.notes)) {
          msg.notes.forEach((n) => {
            const mine = myNotes.find((m) => m.id === n.id);
            if (mine) { mine.likes = n.likes; mine.removed = !!n.hidden; }
          });
          renderMine();
        }
        syncStep();
        break;
      }

      case "board_state": {
        boardState = msg.state || boardState;
        // Friendly nudge when the presenter opens the board.
        if ((boardState === "open" || boardState === "running") && nick) {
          showToast("The board is open — post away! ✏️");
        }
        syncStep();
        break;
      }

      case "note_ack": {
        // The note we just posted now has a real DB id — attach it to the
        // most recent pending entry so likes/removals can find it.
        const pending = myNotes.find((m) => m.id == null && m.text === msg.text);
        if (pending) pending.id = msg.id;
        renderMine();
        showToast("Posted to the board! 🎉");
        break;
      }

      case "note_rejected": {
        showToast(msg.reason || "Couldn't post that note.", true);
        unlockPost();
        break;
      }

      case "note_likes": {
        const mine = myNotes.find((m) => m.id === msg.id);
        if (mine) { mine.likes = msg.likes; renderMine(); }
        break;
      }

      case "note_removed": {
        const mine = myNotes.find((m) => m.id === msg.id);
        if (mine) { mine.removed = true; renderMine(); }
        break;
      }

      case "note_restored": {
        const mine = myNotes.find((m) => m.id === msg.id);
        if (mine) { mine.removed = false; renderMine(); }
        break;
      }

      case "board_ended": {
        boardState = "ended";
        syncStep();
        break;
      }
    }
  }

  // ── posting ────────────────────────────────────────────────────────
  let posting = false;
  function lockPost() {
    posting = true;
    if (postBtn) { postBtn.disabled = true; postBtn.classList.add("is-busy"); }
  }
  function unlockPost() {
    posting = false;
    if (postBtn) { postBtn.disabled = false; postBtn.classList.remove("is-busy"); }
  }

  function postNote() {
    if (posting) return;
    const text = (noteInput && noteInput.value.trim()) || "";
    if (!text) { showToast("Type something first ✏️", true); return; }
    if (boardState !== "open" && boardState !== "running") {
      showToast("The board isn't open yet.", true);
      return;
    }
    lockPost();
    send({
      type: "note",
      text,
      color: selectedColor,
      icon: selectedIcon,
      group_id: selectedGroup,
    });
    // Track optimistically; note_ack fills in the real id.
    myNotes.push({ id: null, text, color: selectedColor, likes: 0, removed: false });

    // Reset the pad for the next note.
    if (noteInput) noteInput.value = "";
    if (charNow) charNow.textContent = "0";
    refreshPreview();
    setTimeout(unlockPost, 400);
  }

  // ── wiring ─────────────────────────────────────────────────────────
  function init() {
    // Nickname step.
    if (nickGo) {
      nickGo.addEventListener("click", () => {
        const v = (nickInput && nickInput.value.trim()) || "";
        if (!v) { if (nickInput) nickInput.focus(); showToast("Enter a name to join.", true); return; }
        nick = v.slice(0, 40);
        sendJoin(true);
        syncStep();
      });
    }
    if (nickInput) {
      nickInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); nickGo && nickGo.click(); }
      });
    }

    // Note text + char count + preview.
    if (noteInput) {
      noteInput.addEventListener("input", () => {
        if (charNow) charNow.textContent = String(noteInput.value.length);
        refreshPreview();
      });
    }

    // Colour picker.
    if (colorRow) {
      colorRow.addEventListener("click", (e) => {
        const dot = e.target.closest(".kk-color-dot");
        if (!dot) return;
        selectedColor = Number(dot.dataset.color) || 0;
        colorRow.querySelectorAll(".kk-color-dot").forEach((d) => {
          const on = d === dot;
          d.classList.toggle("is-active", on);
          d.setAttribute("aria-checked", on ? "true" : "false");
        });
        refreshPreview();
      });
    }

    // Icon picker.
    if (iconRow) {
      iconRow.addEventListener("click", (e) => {
        const pick = e.target.closest(".kk-icon-pick");
        if (!pick) return;
        selectedIcon = pick.dataset.icon || "none";
        iconRow.querySelectorAll(".kk-icon-pick").forEach((p) => {
          const on = p === pick;
          p.classList.toggle("is-active", on);
          p.setAttribute("aria-checked", on ? "true" : "false");
        });
        refreshPreview();
      });
    }

    // Post.
    if (postBtn) postBtn.addEventListener("click", postNote);

    refreshPreview();
    showStep("nick");
    connect();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
