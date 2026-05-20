/* boardly_stage.js — presenter projector controller.
 *
 * Renders the live whiteboard, draws the join QR, and gives the presenter
 * the master controls participants are waiting on:
 *     • #btn-power     open / close the board   → {type:"set_state"}
 *     • layout buttons grid / masonry / scatter
 *     • #btn-moderate  moderation mode (hide / remove / pin)
 *     • #btn-fullscreen
 *
 * Speaks the BoardConsumer JSON protocol and identifies itself with
 * {type:"presenter_hello"} so the server treats it as the moderator.
 */
(function () {
  "use strict";

  const stage = document.getElementById("stage");
  if (!stage) return;

  const CODE = stage.dataset.code;
  const JOIN_URL = stage.dataset.joinUrl || "";

  // ── element refs ───────────────────────────────────────────────────
  const statNotes = document.getElementById("stat-notes");
  const statPeople = document.getElementById("stat-people");

  const notesArea = document.getElementById("notes-area");
  const columnsWrap = document.getElementById("board-columns");
  const boardEmpty = document.getElementById("board-empty");
  const promptDisplay = document.getElementById("board-prompt-display");
  const fx = document.getElementById("board-fx");

  const powerBtn = document.getElementById("btn-power");
  const powerLabel = document.getElementById("btn-power-label");

  const layoutBtns = Array.from(document.querySelectorAll(".kk-board-layout"));
  const btnModerate = document.getElementById("btn-moderate");
  const btnFullscreen = document.getElementById("btn-fullscreen");

  const modTray = document.getElementById("mod-tray");
  const modClose = document.getElementById("mod-close");
  const modHiddenList = document.getElementById("mod-hidden-list");
  const modPopTpl = document.getElementById("tpl-mod-popover");

  const qrBox = document.getElementById("qr-box");
  const joinPanel = document.getElementById("join-panel");
  const joinCollapse = document.getElementById("join-collapse");

  const ICON_GLYPH = {
    lightbulb: "bi-lightbulb", star: "bi-star", heart: "bi-heart",
    chat: "bi-chat-dots", people: "bi-people", target: "bi-bullseye",
    rocket: "bi-rocket-takeoff", check: "bi-check-circle", none: "",
  };
  const NOTE_FILLS = ["#fbcfe8", "#fde68a", "#bbf7d0", "#bfdbfe", "#ddd6fe", "#fed7aa"];
  const NOTE_DEEPS = ["#f5a8d0", "#f6cf4d", "#86e3a6", "#8fbef5", "#bcaff7", "#f9b878"];

  // ── state ──────────────────────────────────────────────────────────
  let boardState = stage.dataset.mode ? "lobby" : "lobby";
  let layout = "grid";
  let moderating = false;
  let groups = [];                 // [{id, name}]
  const notes = new Map();         // id → note dict
  let openPopover = null;

  // ── tool state (added: drag / draw / limit / export) ───────────────
  let freeArrange = false;         // notes absolutely positioned & draggable
  let noteLimit = 0;               // per-participant cap; 0 = unlimited
  let drawTool = null;             // null | "highlighter" | "pen"
  // The freehand/highlighter strokes are presenter-local — never sent.

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
      send({ type: "presenter_hello" });
    });
    sock.addEventListener("close", () => {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 1500);
    });
    sock.addEventListener("error", () => { try { sock.close(); } catch (e) {} });
    sock.addEventListener("message", (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handle(msg);
    });
  }

  function send(obj) {
    if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(obj));
  }

  // ── inbound ────────────────────────────────────────────────────────
  function handle(msg) {
    switch (msg.type) {
      case "state":
        boardState = msg.state || "lobby";
        groups = msg.groups || [];
        if (promptDisplay && msg.prompt) promptDisplay.textContent = msg.prompt;
        notes.clear();
        (msg.notes || []).forEach((n) => notes.set(n.id, n));
        if (typeof msg.participants === "number") setPeople(msg.participants);
        if (typeof msg.limit === "number") { noteLimit = msg.limit; reflectLimit(); }
        // If any note arrived with a saved position, the presenter had
        // previously arranged the board — restore free-arrange mode.
        if ([...notes.values()].some((n) => n.pos_x != null && n.pos_y != null)) {
          freeArrange = true;
        }
        reflectPower();
        renderAll();
        break;

      case "board_state":
        boardState = msg.state || boardState;
        reflectPower();
        break;

      case "note_added":
        notes.set(msg.note.id, msg.note);
        renderAll(msg.note.id);
        break;

      case "note_likes": {
        const n = notes.get(msg.id);
        if (n) { n.likes = msg.likes; updateLikeBadge(msg.id, msg.likes); burstHeart(msg.id); }
        break;
      }

      case "note_moderated": {
        const n = notes.get(msg.id);
        if (!n) break;
        if (msg.action === "delete") { notes.delete(msg.id); animateRemove(msg.id); }
        else {
          if (msg.action === "hide") n.hidden = true;
          else if (msg.action === "show") n.hidden = false;
          else if (msg.action === "pin") n.pinned = true;
          else if (msg.action === "unpin") n.pinned = false;
          renderAll();
        }
        renderHiddenTray();
        break;
      }

      case "note_burned": {
        // Play the burn animation, then drop the note. The server has
        // already deleted it server-side; we just animate locally.
        animateBurn(msg.id);
        break;
      }

      case "note_moved": {
        // Someone (this presenter or another connected presenter screen)
        // dragged a note. Store the fractional position and apply it.
        const n = notes.get(msg.id);
        if (n) {
          n.pos_x = msg.x;
          n.pos_y = msg.y;
          // A move implies free arrangement — switch if we haven't.
          if (!freeArrange) enterFreeArrange();
          applyNotePosition(msg.id);
        }
        break;
      }

      case "limit_changed": {
        noteLimit = Number(msg.limit) || 0;
        reflectLimit();
        break;
      }

      case "participants":
        setPeople(msg.count);
        break;

      case "board_ended":
        boardState = "ended";
        reflectPower();
        break;
    }
  }

  // ── stats ──────────────────────────────────────────────────────────
  function setPeople(c) { if (statPeople) statPeople.textContent = String(c); }
  function setNotesCount() {
    if (statNotes) {
      const visible = [...notes.values()].filter((n) => !n.hidden).length;
      statNotes.textContent = String(visible);
    }
  }

  // ── power button (open / close) ────────────────────────────────────
  function reflectPower() {
    if (!powerBtn) return;
    powerBtn.dataset.state = boardState;
    stage.classList.toggle("is-ended", boardState === "ended");

    const icon = powerBtn.querySelector("i");
    if (boardState === "open" || boardState === "running") {
      if (powerLabel) powerLabel.textContent = "Close board";
      if (icon) icon.className = "bi bi-stop-fill";
    } else if (boardState === "ended") {
      if (powerLabel) powerLabel.textContent = "Board closed";
      if (icon) icon.className = "bi bi-check-circle";
    } else {
      if (powerLabel) powerLabel.textContent = "Open board";
      if (icon) icon.className = "bi bi-play-fill";
    }
    renderEndedBadge();
  }

  function renderEndedBadge() {
    let badge = document.getElementById("board-ended-badge");
    if (boardState === "ended") {
      if (!badge) {
        badge = document.createElement("div");
        badge.id = "board-ended-badge";
        badge.className = "kk-board-ended-badge";
        badge.textContent = "Board closed 🎉";
        const canvas = document.getElementById("board-canvas");
        if (canvas) canvas.appendChild(badge);
      }
    } else if (badge) {
      badge.remove();
    }
  }

  function togglePower() {
    if (boardState === "ended") return;            // closed is terminal
    const next = (boardState === "open" || boardState === "running") ? "ended" : "open";
    if (next === "ended" &&
        !confirm("Close the board? Participants can no longer post notes.")) {
      return;
    }
    send({ type: "set_state", state: next });
    // Optimistic; the broadcast confirms.
    boardState = next;
    reflectPower();
  }

  // ── note rendering ─────────────────────────────────────────────────
  // Deterministic tilt per note id so re-renders don't jiggle.
  function tiltFor(id) {
    const t = ((Number(id) * 47) % 9) - 4;   // -4..+4 deg
    return `${t}deg`;
  }

  function buildNote(n) {
    const el = document.createElement("div");
    el.className = "kk-note";
    el.dataset.id = n.id;
    if (n.pinned) el.classList.add("pinned");
    el.style.setProperty("--note", NOTE_FILLS[n.color] || NOTE_FILLS[0]);
    el.style.setProperty("--note-deep", NOTE_DEEPS[n.color] || NOTE_DEEPS[0]);
    el.style.setProperty("--tilt", tiltFor(n.id));

    if (n.pinned) {
      const pin = document.createElement("span");
      pin.className = "kk-note-pin";
      pin.innerHTML = '<i class="bi bi-pin-angle-fill"></i>';
      el.appendChild(pin);
    }

    const glyph = ICON_GLYPH[n.icon] || "";
    if (glyph) {
      const ic = document.createElement("span");
      ic.className = "kk-note-icon";
      ic.innerHTML = `<i class="bi ${glyph}"></i>`;
      el.appendChild(ic);
    }

    const text = document.createElement("p");
    text.className = "kk-note-text";
    text.textContent = n.text;
    el.appendChild(text);

    const foot = document.createElement("div");
    foot.className = "kk-note-foot";

    const author = document.createElement("span");
    author.className = "kk-note-author";
    author.textContent = n.author || "Anonymous";
    foot.appendChild(author);

    const like = document.createElement("button");
    like.type = "button";
    like.className = "kk-note-like";
    like.dataset.like = n.id;
    like.innerHTML = `<i class="bi bi-heart-fill"></i> <span class="like-n">${n.likes || 0}</span>`;
    foot.appendChild(like);

    // Always-visible presenter controls: burn (animated delete) and
    // remove (plain delete). No moderation mode needed.
    const burn = document.createElement("button");
    burn.type = "button";
    burn.className = "kk-note-act kk-note-burn";
    burn.dataset.burn = n.id;
    burn.title = "Burn this note";
    burn.innerHTML = '<i class="bi bi-fire"></i>';
    foot.appendChild(burn);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "kk-note-act kk-note-remove";
    remove.dataset.remove = n.id;
    remove.title = "Remove this note";
    remove.innerHTML = '<i class="bi bi-trash"></i>';
    foot.appendChild(remove);

    el.appendChild(foot);
    return el;
  }

  function renderAll(newId) {
    // Empty state.
    const visible = [...notes.values()].filter((n) => !n.hidden);
    setNotesCount();

    const hasGroups = groups.length > 0;
    if (columnsWrap) columnsWrap.style.display = hasGroups ? "" : "none";
    if (notesArea) notesArea.style.display = hasGroups ? "none" : "";

    if (!visible.length) {
      if (boardEmpty) boardEmpty.style.display = "";
    } else if (boardEmpty) {
      boardEmpty.style.display = "none";
    }

    // Pinned first, then chronological by id.
    const ordered = visible.sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
      return a.id - b.id;
    });

    if (hasGroups) {
      renderColumns(ordered, newId);
    } else {
      renderFlat(ordered, newId);
    }
  }

  function renderFlat(ordered, newId) {
    if (!notesArea) return;
    // Free-arrange overrides the grid/masonry/scatter layouts: notes are
    // absolutely positioned from their saved fractional coordinates.
    notesArea.className = `kk-notes-area layout-${freeArrange ? "free" : layout}`;
    // Keep the empty-state node, clear notes.
    notesArea.querySelectorAll(".kk-note").forEach((el) => el.remove());
    ordered.forEach((n) => {
      const el = buildNote(n);
      if (n.id === newId) el.classList.add("is-new");
      notesArea.appendChild(el);
    });
    if (freeArrange) layoutFreeNotes();
  }

  function renderColumns(ordered, newId) {
    if (!columnsWrap) return;
    columnsWrap.innerHTML = "";
    const byGroup = new Map();
    groups.forEach((g) => byGroup.set(g.id, []));
    const loose = [];
    ordered.forEach((n) => {
      if (n.group_id != null && byGroup.has(n.group_id)) byGroup.get(n.group_id).push(n);
      else loose.push(n);
    });

    groups.forEach((g) => {
      const col = document.createElement("div");
      col.className = "kk-board-column";
      const head = document.createElement("div");
      head.className = "kk-board-column-head";
      const list = byGroup.get(g.id) || [];
      head.innerHTML = `${escapeHtml(g.name)} <span class="count">${list.length}</span>`;
      const body = document.createElement("div");
      body.className = "kk-board-column-body";
      list.forEach((n) => {
        const el = buildNote(n);
        if (n.id === newId) el.classList.add("is-new");
        body.appendChild(el);
      });
      col.append(head, body);
      columnsWrap.appendChild(col);
    });

    // Notes that didn't match a column get an extra "Other" column.
    if (loose.length) {
      const col = document.createElement("div");
      col.className = "kk-board-column";
      col.innerHTML = `<div class="kk-board-column-head">Other <span class="count">${loose.length}</span></div>`;
      const body = document.createElement("div");
      body.className = "kk-board-column-body";
      loose.forEach((n) => {
        const el = buildNote(n);
        if (n.id === newId) el.classList.add("is-new");
        body.appendChild(el);
      });
      col.appendChild(body);
      columnsWrap.appendChild(col);
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function findNoteEl(id) {
    return stage.querySelector(`.kk-note[data-id="${id}"]`);
  }

  function updateLikeBadge(id, likes) {
    const el = findNoteEl(id);
    if (!el) return;
    const span = el.querySelector(".like-n");
    if (span) span.textContent = String(likes);
  }

  function animateRemove(id) {
    const el = findNoteEl(id);
    if (!el) { renderAll(); return; }
    el.classList.add("is-leaving");
    setTimeout(() => renderAll(), 360);
  }

  // ── reaction burst ─────────────────────────────────────────────────
  function burstHeart(id) {
    if (!fx) return;
    const el = findNoteEl(id);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const host = fx.getBoundingClientRect();
    const heart = document.createElement("span");
    heart.className = "kk-fx-heart";
    heart.textContent = "❤️";
    heart.style.left = `${r.left - host.left + r.width / 2}px`;
    heart.style.top = `${r.top - host.top}px`;
    fx.appendChild(heart);
    setTimeout(() => heart.remove(), 1200);
  }

  // ── moderation ─────────────────────────────────────────────────────
  function setModerating(on) {
    moderating = on;
    stage.classList.toggle("moderating", on);
    if (modTray) modTray.setAttribute("aria-hidden", on ? "false" : "true");
    if (btnModerate) btnModerate.classList.toggle("is-active", on);
    if (!on) closePopover();
    renderHiddenTray();
  }

  function openPopoverFor(id, anchor) {
    closePopover();
    if (!modPopTpl) return;
    const n = notes.get(id);
    if (!n) return;
    const frag = modPopTpl.content.cloneNode(true);
    const pop = frag.querySelector(".kk-mod-pop");

    // Reflect current state on the buttons.
    const hideBtn = pop.querySelector('[data-act="hide"]');
    if (hideBtn && n.hidden) hideBtn.innerHTML = '<i class="bi bi-eye"></i> Show';
    const pinBtn = pop.querySelector('[data-act="pin"]');
    if (pinBtn && n.pinned) pinBtn.innerHTML = '<i class="bi bi-pin-angle-fill"></i> Unpin';

    // Inject a "Burn" button if the template doesn't already have one.
    if (!pop.querySelector('[data-act="burn"]')) {
      const burnBtn = document.createElement("button");
      burnBtn.dataset.act = "burn";
      burnBtn.className = "is-danger";
      burnBtn.innerHTML = '<i class="bi bi-fire"></i> Burn';
      pop.appendChild(burnBtn);
    }

    pop.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const raw = b.dataset.act;
      if (raw === "burn") {
        // Burn is an animated delete — its own message type.
        send({ type: "burn", id });
        closePopover();
        return;
      }
      let action = raw;
      if (raw === "hide") action = n.hidden ? "show" : "hide";
      if (raw === "pin") action = n.pinned ? "unpin" : "pin";
      send({ type: "mod", action, id });
      closePopover();
    });

    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.position = "fixed";
    pop.style.top = `${Math.max(8, r.top - 8)}px`;
    pop.style.left = `${Math.min(window.innerWidth - 200, r.left)}px`;
    openPopover = pop;
  }

  function closePopover() {
    if (openPopover) { openPopover.remove(); openPopover = null; }
  }

  function renderHiddenTray() {
    if (!modHiddenList) return;
    const hidden = [...notes.values()].filter((n) => n.hidden);
    if (!hidden.length) {
      modHiddenList.innerHTML =
        '<span class="text-secondary small">Hidden notes appear here — tap to restore.</span>';
      return;
    }
    modHiddenList.innerHTML = "";
    hidden.forEach((n) => {
      const chip = document.createElement("button");
      chip.className = "kk-mod-chip";
      chip.textContent = n.text.slice(0, 40);
      chip.title = "Tap to restore";
      chip.addEventListener("click", () => send({ type: "mod", action: "show", id: n.id }));
      modHiddenList.appendChild(chip);
    });
  }

  // ── QR ─────────────────────────────────────────────────────────────
  function drawQR() {
    if (!qrBox || !JOIN_URL || typeof QRCode === "undefined") return;
    qrBox.innerHTML = "";
    new QRCode(qrBox, {
      text: JOIN_URL, width: 116, height: 116,
      colorDark: "#111", colorLight: "#fff",
      correctLevel: QRCode.CorrectLevel.M,
    });
  }

  // ════════════════════════════════════════════════════════════════════
  //  PRESENTER TOOLS — drag-to-move, burn, draw, limit, export.
  //  Added as a self-contained block so the rest of the file is intact.
  //  The toolbar buttons, styles, and export libraries are injected from
  //  here so the stage_board.html template needs no edits.
  // ════════════════════════════════════════════════════════════════════

  const boardSheet = document.getElementById("board-sheet");
  const boardCanvas = document.getElementById("board-canvas");

  // ── injected styles ─────────────────────────────────────────────────
  function injectToolStyles() {
    if (document.getElementById("boardly-tools-css")) return;
    const css = document.createElement("style");
    css.id = "boardly-tools-css";
    css.textContent = `
      .kk-notes-area.layout-free { position: relative; min-height: 60vh; }
      .kk-notes-area.layout-free .kk-note { position: absolute; margin: 0;
        transform: translate(-50%, -50%) rotate(var(--tilt, 0deg)); }
      .kk-notes-area.layout-free .kk-note.dragging {
        cursor: grabbing; z-index: 50; transform: translate(-50%,-50%)
        rotate(0deg) scale(1.04); box-shadow: 0 14px 30px rgba(0,0,0,.4); }
      .layout-free .kk-note { cursor: grab; }
      @keyframes kk-burn {
        0%   { filter: brightness(1); }
        35%  { filter: brightness(1.4) sepia(.5) saturate(2); }
        70%  { filter: brightness(.6) sepia(1) saturate(3) hue-rotate(-12deg); }
        100% { filter: brightness(0) saturate(4); opacity: 0; }
      }
      .kk-note.is-burning { animation: kk-burn .9s ease-in forwards;
        pointer-events: none; }
      .kk-note.is-burning .kk-ember {
        position: absolute; inset: 0; border-radius: inherit;
        background: radial-gradient(circle at 50% 100%,
          rgba(255,170,40,.95), rgba(255,60,0,.6) 40%, transparent 70%);
        mix-blend-mode: screen; animation: kk-ember .9s ease-in forwards; }
      @keyframes kk-ember {
        0% { opacity: 0; } 30% { opacity: 1; } 100% { opacity: 0; } }
      .kk-burn-spark { position: absolute; width: 6px; height: 6px;
        border-radius: 50%; background: #ffb028;
        box-shadow: 0 0 8px 2px rgba(255,140,0,.9); pointer-events: none; }
      #board-draw-layer { position: absolute; inset: 0; z-index: 40;
        touch-action: none; }
      #board-draw-layer.inactive { pointer-events: none; }
      .kk-tool.is-active { background: rgba(124,58,237,.35);
        border-color: rgba(124,58,237,.7); }
      .kk-limit-box { display: inline-flex; align-items: center; gap: .25rem;
        padding: .15rem .35rem; border: 1px solid var(--kk-border, #333);
        border-radius: 8px; }
      .kk-limit-box input { width: 3ch; background: transparent;
        border: 0; color: inherit; text-align: center;
        font: inherit; -moz-appearance: textfield; }
      .kk-limit-box input::-webkit-outer-spin-button,
      .kk-limit-box input::-webkit-inner-spin-button { -webkit-appearance: none; }
      .kk-limit-box button { background: none; border: 0; color: inherit;
        cursor: pointer; line-height: 1; padding: 0 .15rem; opacity: .8; }
      .kk-limit-box button:hover { opacity: 1; }
      .kk-tool.is-busy { opacity: .5; pointer-events: none; }
      /* Always-visible per-note presenter buttons (burn / remove). */
      .kk-note-act {
        background: rgba(0,0,0,.06); border: 1px solid rgba(0,0,0,.12);
        border-radius: 7px; cursor: pointer; padding: 2px 7px;
        font-size: .82rem; line-height: 1; color: #6b7280;
        opacity: .35; transition: opacity .12s ease, color .12s ease,
        background .12s ease; margin-left: 4px; }
      .kk-note:hover .kk-note-act { opacity: 1; }
      .kk-note-burn:hover { color: #ea580c;
        background: rgba(234,88,12,.14); border-color: rgba(234,88,12,.4); }
      .kk-note-remove:hover { color: #dc2626;
        background: rgba(220,38,38,.14); border-color: rgba(220,38,38,.4); }
      /* On touch screens there's no hover — keep them always visible. */
      @media (hover: none) {
        .kk-note-act { opacity: .8; }
      }
    `;
    document.head.appendChild(css);
  }

  // ── injected toolbar ────────────────────────────────────────────────
  let btnHi, btnPen, btnEraseDraw, limitInput, btnExportPng, btnExportPdf;

  function injectToolbar() {
    const header = document.querySelector(".kk-board-header");
    if (!header || document.getElementById("btn-draw-hi")) return;
    const anchor = powerBtn || null;

    const mk = (id, title, icon) => {
      const b = document.createElement("button");
      b.className = "kk-tool";
      b.id = id;
      b.title = title;
      b.innerHTML = `<i class="bi ${icon}"></i>`;
      header.insertBefore(b, anchor);
      return b;
    };

    btnHi = mk("btn-draw-hi", "Highlighter", "bi-highlighter");
    btnPen = mk("btn-draw-pen", "Freehand pen", "bi-pencil");
    btnEraseDraw = mk("btn-draw-clear", "Clear drawing", "bi-eraser");

    const limitBox = document.createElement("span");
    limitBox.className = "kk-limit-box";
    limitBox.title = "Notes allowed per participant (0 = unlimited)";
    limitBox.innerHTML =
      '<i class="bi bi-person-lock"></i>' +
      '<button type="button" data-step="-1">&minus;</button>' +
      '<input type="text" inputmode="numeric" id="limit-input" value="0">' +
      '<button type="button" data-step="1">+</button>';
    header.insertBefore(limitBox, anchor);
    limitInput = limitBox.querySelector("#limit-input");

    limitBox.addEventListener("click", (e) => {
      const step = e.target.closest("button");
      if (!step) return;
      changeLimit((parseInt(limitInput.value, 10) || 0) +
                  Number(step.dataset.step));
    });
    limitInput.addEventListener("change", () => {
      changeLimit(parseInt(limitInput.value, 10) || 0);
    });

    btnExportPng = mk("btn-export-png", "Save board as image", "bi-image");
    btnExportPdf = mk("btn-export-pdf", "Save board as PDF", "bi-file-pdf");
  }

  // ── per-participant limit ───────────────────────────────────────────
  function reflectLimit() {
    if (limitInput) limitInput.value = String(noteLimit);
  }
  function changeLimit(v) {
    const next = Math.max(0, Math.min(Math.floor(v) || 0, 999));
    noteLimit = next;
    reflectLimit();
    send({ type: "set_limit", limit: next });
  }

  // ── free arrange + drag-to-move ─────────────────────────────────────
  function enterFreeArrange() {
    freeArrange = true;
    layoutBtns.forEach((b) => b.classList.remove("is-active"));
    renderAll();
  }

  function applyNotePosition(id) {
    const n = notes.get(id);
    const el = findNoteEl(id);
    if (!n || !el) return;
    if (n.pos_x == null || n.pos_y == null) return;
    el.style.left = (n.pos_x * 100) + "%";
    el.style.top = (n.pos_y * 100) + "%";
  }

  // Give un-positioned notes a deterministic starting spot.
  function ensurePosition(n) {
    if (n.pos_x != null && n.pos_y != null) return;
    const seed = Number(n.id) || 1;
    n.pos_x = 0.12 + ((seed * 0.137) % 0.76);
    n.pos_y = 0.14 + ((seed * 0.231) % 0.66);
  }

  function layoutFreeNotes() {
    if (!notesArea) return;
    notesArea.querySelectorAll(".kk-note").forEach((el) => {
      const n = notes.get(Number(el.dataset.id));
      if (!n) return;
      ensurePosition(n);
      applyNotePosition(n.id);
    });
  }

  let dragEl = null, dragId = null, dragMoved = false;

  function onPointerMove(e) {
    if (!dragEl) return;
    const rect = notesArea.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    let x = (e.clientX - rect.left) / rect.width;
    let y = (e.clientY - rect.top) / rect.height;
    x = Math.max(0, Math.min(x, 1));
    y = Math.max(0, Math.min(y, 1));
    dragMoved = true;
    dragEl.style.left = (x * 100) + "%";
    dragEl.style.top = (y * 100) + "%";
    const n = notes.get(dragId);
    if (n) { n.pos_x = x; n.pos_y = y; }
  }

  function onPointerUp() {
    if (!dragEl) return;
    dragEl.classList.remove("dragging");
    const n = notes.get(dragId);
    if (dragMoved && n && n.pos_x != null) {
      send({ type: "move", id: dragId, x: n.pos_x, y: n.pos_y });
    }
    dragEl = null;
    dragId = null;
  }

  function startDragFrom(el) {
    dragEl = el;
    dragId = Number(el.dataset.id);
    dragMoved = false;
    el.classList.add("dragging");
  }

  // ── burn animation ──────────────────────────────────────────────────
  function animateBurn(id) {
    const el = findNoteEl(id);
    notes.delete(id);
    if (!el) { renderAll(); return; }

    const ember = document.createElement("span");
    ember.className = "kk-ember";
    el.appendChild(ember);
    el.classList.add("is-burning");

    const r = el.getBoundingClientRect();
    const host = fx ? fx.getBoundingClientRect() : null;
    if (fx && host) {
      for (let i = 0; i < 10; i++) {
        const s = document.createElement("span");
        s.className = "kk-burn-spark";
        s.style.left = (r.left - host.left + Math.random() * r.width) + "px";
        s.style.top = (r.top - host.top + r.height *
                       (0.5 + Math.random() * 0.5)) + "px";
        fx.appendChild(s);
        const dx = (Math.random() - 0.5) * 80;
        const dy = -60 - Math.random() * 90;
        s.animate(
          [{ transform: "translate(0,0)", opacity: 1 },
           { transform: `translate(${dx}px,${dy}px)`, opacity: 0 }],
          { duration: 700 + Math.random() * 500, easing: "ease-out" }
        );
        setTimeout(() => s.remove(), 1300);
      }
    }
    setTimeout(() => { renderAll(); renderHiddenTray(); }, 950);
  }

  // ── drawing overlay (presenter-local highlighter + pen) ─────────────
  let drawLayer = null, drawCtx = null, drawing = false;
  const drawStrokes = [];

  function ensureDrawLayer() {
    if (drawLayer || !boardCanvas) return;
    drawLayer = document.createElement("canvas");
    drawLayer.id = "board-draw-layer";
    drawLayer.className = "inactive";
    boardCanvas.appendChild(drawLayer);
    drawCtx = drawLayer.getContext("2d");
    sizeDrawLayer();
    window.addEventListener("resize", sizeDrawLayer);

    drawLayer.addEventListener("pointerdown", drawDown);
    drawLayer.addEventListener("pointermove", drawMove);
    window.addEventListener("pointerup", drawUp);
  }

  function sizeDrawLayer() {
    if (!drawLayer || !boardCanvas) return;
    const r = boardCanvas.getBoundingClientRect();
    drawLayer.width = r.width;
    drawLayer.height = r.height;
    repaintStrokes();
  }

  function strokeStyleFor(tool) {
    return tool === "highlighter"
      ? { color: "rgba(250,204,21,.38)", width: 22, cap: "round" }
      : { color: "#ef4444", width: 3.5, cap: "round" };
  }

  function repaintStrokes() {
    if (!drawCtx || !drawLayer) return;
    drawCtx.clearRect(0, 0, drawLayer.width, drawLayer.height);
    drawStrokes.forEach((st) => {
      const s = strokeStyleFor(st.tool);
      drawCtx.strokeStyle = s.color;
      drawCtx.lineWidth = s.width;
      drawCtx.lineCap = s.cap;
      drawCtx.lineJoin = "round";
      drawCtx.beginPath();
      st.pts.forEach((p, i) => {
        if (i === 0) drawCtx.moveTo(p.x, p.y);
        else drawCtx.lineTo(p.x, p.y);
      });
      drawCtx.stroke();
    });
  }

  let activeStroke = null;
  function drawDown(e) {
    if (!drawTool) return;
    drawing = true;
    activeStroke = { tool: drawTool, pts: [pointIn(e)] };
    drawStrokes.push(activeStroke);
    e.preventDefault();
  }
  function drawMove(e) {
    if (!drawing || !activeStroke) return;
    activeStroke.pts.push(pointIn(e));
    repaintStrokes();
  }
  function drawUp() { drawing = false; activeStroke = null; }
  function pointIn(e) {
    const r = drawLayer.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function setDrawTool(tool) {
    drawTool = (drawTool === tool) ? null : tool;
    ensureDrawLayer();
    if (drawLayer) drawLayer.classList.toggle("inactive", !drawTool);
    if (btnHi) btnHi.classList.toggle("is-active", drawTool === "highlighter");
    if (btnPen) btnPen.classList.toggle("is-active", drawTool === "pen");
  }
  function clearDrawing() {
    drawStrokes.length = 0;
    repaintStrokes();
  }

  // ── export (PNG / PDF) ──────────────────────────────────────────────
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find((s) => s.src === src);
      if (existing) {
        if (existing.dataset.loaded) resolve();
        else {
          existing.addEventListener("load", () => resolve());
          existing.addEventListener("error", () => reject(new Error(src)));
        }
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.addEventListener("load", () => { s.dataset.loaded = "1"; resolve(); });
      s.addEventListener("error", () => reject(new Error("load failed: " + src)));
      document.head.appendChild(s);
    });
  }

  const H2C_SRC = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
  const JSPDF_SRC = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";

  async function captureBoard() {
    await loadScript(H2C_SRC);
    if (typeof html2canvas === "undefined") {
      throw new Error("html2canvas unavailable");
    }
    // If the presenter has drawn on the board, capture the whole canvas
    // (which includes the draw overlay); otherwise just the sheet.
    const target = drawStrokes.length ? boardCanvas : boardSheet;
    if (!target) throw new Error("nothing to export");
    return html2canvas(target, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
      logging: false,
    });
  }

  function exportFilename(ext) {
    const t = ((promptDisplay && promptDisplay.textContent) || "board")
      .trim().replace(/[^\w-]+/g, "_").slice(0, 40) || "board";
    const d = new Date().toISOString().slice(0, 10);
    return `boardly_${t}_${d}.${ext}`;
  }

  function flashBusy(btn, on) {
    if (btn) btn.classList.toggle("is-busy", on);
  }

  async function exportPNG() {
    flashBusy(btnExportPng, true);
    try {
      const canvas = await captureBoard();
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = exportFilename("png");
      a.click();
    } catch (err) {
      alert("Couldn't export the image. Check your connection and retry.");
      console.error(err);
    } finally {
      flashBusy(btnExportPng, false);
    }
  }

  async function exportPDF() {
    flashBusy(btnExportPdf, true);
    try {
      const canvas = await captureBoard();
      await loadScript(JSPDF_SRC);
      const JsPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      if (!JsPDF) throw new Error("jsPDF unavailable");

      const img = canvas.toDataURL("image/png");
      const orientation = canvas.width >= canvas.height ? "l" : "p";
      const pdf = new JsPDF({ orientation, unit: "pt", format: "a4" });
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const ratio = Math.min(pw / canvas.width, ph / canvas.height);
      const w = canvas.width * ratio;
      const h = canvas.height * ratio;
      pdf.addImage(img, "PNG", (pw - w) / 2, (ph - h) / 2, w, h);
      pdf.save(exportFilename("pdf"));
    } catch (err) {
      alert("Couldn't export the PDF. Check your connection and retry.");
      console.error(err);
    } finally {
      flashBusy(btnExportPdf, false);
    }
  }

  // ── wiring for the tools (called from init) ─────────────────────────
  function initTools() {
    injectToolStyles();
    injectToolbar();
    reflectLimit();

    if (btnHi) btnHi.addEventListener("click", () => setDrawTool("highlighter"));
    if (btnPen) btnPen.addEventListener("click", () => setDrawTool("pen"));
    if (btnEraseDraw) btnEraseDraw.addEventListener("click", clearDrawing);
    if (btnExportPng) btnExportPng.addEventListener("click", exportPNG);
    if (btnExportPdf) btnExportPdf.addEventListener("click", exportPDF);

    // Drag-to-move: delegated pointer events on the notes area. The first
    // drag flips the board into free-arrange mode.
    if (notesArea) {
      notesArea.addEventListener("pointerdown", (e) => {
        if (drawTool || moderating) return;
        const el = e.target.closest(".kk-note");
        if (!el) return;
        // Don't begin a drag from any of the in-note buttons.
        if (e.target.closest(".kk-note-like") ||
            e.target.closest(".kk-note-act")) return;
        if (!freeArrange) {
          enterFreeArrange();   // re-renders the notes area
          requestAnimationFrame(() => {
            const fresh = findNoteEl(Number(el.dataset.id));
            if (fresh) startDragFrom(fresh);
          });
        } else {
          startDragFrom(el);
        }
      });
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    }
  }

  // ── wiring ─────────────────────────────────────────────────────────
  function init() {
    layout = "grid";
    const active = layoutBtns.find((b) => b.classList.contains("is-active"));
    if (active) layout = active.dataset.layout;

    if (powerBtn) powerBtn.addEventListener("click", togglePower);

    layoutBtns.forEach((b) => {
      b.addEventListener("click", () => {
        layout = b.dataset.layout || "grid";
        // Picking a layout leaves free-arrange mode. Saved note
        // positions are kept server-side and reappear next time the
        // presenter drags a note.
        freeArrange = false;
        layoutBtns.forEach((x) => x.classList.toggle("is-active", x === b));
        renderAll();
      });
    });

    if (btnModerate) btnModerate.addEventListener("click", () => setModerating(!moderating));
    if (modClose) modClose.addEventListener("click", () => setModerating(false));

    if (btnFullscreen) {
      btnFullscreen.addEventListener("click", () => {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
        else document.exitFullscreen?.();
      });
    }

    // Note interactions: like / burn / remove (always) and moderate
    // (when moderating).
    stage.addEventListener("click", (e) => {
      const burnBtn = e.target.closest(".kk-note-burn");
      if (burnBtn) {
        const id = Number(burnBtn.dataset.burn);
        if (confirm("Burn this note? It will be permanently removed.")) {
          send({ type: "burn", id });
        }
        return;
      }
      const removeBtn = e.target.closest(".kk-note-remove");
      if (removeBtn) {
        const id = Number(removeBtn.dataset.remove);
        if (confirm("Remove this note? It will be permanently deleted.")) {
          send({ type: "mod", action: "delete", id });
        }
        return;
      }
      const likeBtn = e.target.closest(".kk-note-like");
      if (likeBtn && !moderating) {
        send({ type: "like", id: Number(likeBtn.dataset.like) });
        return;
      }
      const noteEl = e.target.closest(".kk-note");
      if (noteEl && moderating) {
        openPopoverFor(Number(noteEl.dataset.id), noteEl);
      }
    });

    // Dismiss popover on outside click / escape.
    document.addEventListener("click", (e) => {
      if (openPopover && !e.target.closest(".kk-mod-pop") && !e.target.closest(".kk-note")) {
        closePopover();
      }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePopover(); });

    // Join panel collapse.
    if (joinCollapse && joinPanel) {
      joinCollapse.addEventListener("click", () => joinPanel.classList.toggle("collapsed"));
    }

    drawQR();
    reflectPower();
    initTools();
    connect();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();