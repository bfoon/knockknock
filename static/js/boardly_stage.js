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
    notesArea.className = `kk-notes-area layout-${layout}`;
    // Keep the empty-state node, clear notes.
    notesArea.querySelectorAll(".kk-note").forEach((el) => el.remove());
    ordered.forEach((n) => {
      const el = buildNote(n);
      if (n.id === newId) el.classList.add("is-new");
      notesArea.appendChild(el);
    });
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

    pop.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const raw = b.dataset.act;
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

  // ── wiring ─────────────────────────────────────────────────────────
  function init() {
    layout = "grid";
    const active = layoutBtns.find((b) => b.classList.contains("is-active"));
    if (active) layout = active.dataset.layout;

    if (powerBtn) powerBtn.addEventListener("click", togglePower);

    layoutBtns.forEach((b) => {
      b.addEventListener("click", () => {
        layout = b.dataset.layout || "grid";
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

    // Note interactions: like (always) / moderate (when moderating).
    stage.addEventListener("click", (e) => {
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
    connect();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
