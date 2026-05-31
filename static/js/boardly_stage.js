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
  const COLUMN_REORDER_URL = stage.dataset.columnReorderUrl || "";

  // ── element refs ───────────────────────────────────────────────────
  const statNotes = document.getElementById("stat-notes");
  const statPeople = document.getElementById("stat-people");

  const notesArea = document.getElementById("notes-area");
  const columnsWrap = document.getElementById("board-columns");
  const boardEmpty = document.getElementById("board-empty");
  const promptDisplay = document.getElementById("board-prompt-display");
  const fx = document.getElementById("board-fx");

  const titleDisplay = document.getElementById("board-title-display");
  const titleEditBtn = document.getElementById("board-title-edit");
  const headingTitleText = document.getElementById("board-heading-title-text");
  const qrCardTitle = document.getElementById("qr-card-title");
  const CAN_EDIT = stage.dataset.canEdit === "1";
  // "wall" style → free anonymous message board. Notes render as dated
  // message cards (no author, no sticky-note colour/icon).
  const WALL = stage.dataset.style === "wall";

  // Short date for wall message cards, e.g. "31 May 2026, 14:05".
  function wallDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString([], {
      day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  const powerBtn = document.getElementById("btn-power");
  const powerLabel = document.getElementById("btn-power-label");
  const stopBtn = document.getElementById("btn-stop");

  const layoutBtns = Array.from(document.querySelectorAll(".kk-board-layout"));
  const btnModerate = document.getElementById("btn-moderate");
  const btnLockColumns = document.getElementById("btn-lock-columns");
  const btnFullscreen = document.getElementById("btn-fullscreen");
  const btnBackground = document.getElementById("btn-background");
  const bgModal = document.getElementById("bg-modal");
  const bgModalClose = document.getElementById("bg-modal-close");

  const modTray = document.getElementById("mod-tray");
  const modClose = document.getElementById("mod-close");
  const modHiddenList = document.getElementById("mod-hidden-list");
  const modPopTpl = document.getElementById("tpl-mod-popover");

  const qrBox = document.getElementById("qr-box");
  const joinPanel = document.getElementById("join-panel");
  const joinCollapse = document.getElementById("join-collapse");

  // Enlarged-QR modal refs.
  const qrModal = document.getElementById("qr-modal");
  const qrModalClose = document.getElementById("qr-modal-close");
  const qrCardQr = document.getElementById("qr-card-qr");
  const qrCard = document.getElementById("qr-card");
  const qrDownloadBtn = document.getElementById("qr-download");

  const ICON_GLYPH = {
    lightbulb: "bi-lightbulb", star: "bi-star", heart: "bi-heart",
    chat: "bi-chat-dots", people: "bi-people", target: "bi-bullseye",
    rocket: "bi-rocket-takeoff", check: "bi-check-circle", none: "",
  };
  const NOTE_FILLS = ["#fbcfe8", "#fde68a", "#bbf7d0", "#bfdbfe", "#ddd6fe", "#fed7aa"];
  const NOTE_DEEPS = ["#f5a8d0", "#f6cf4d", "#86e3a6", "#8fbef5", "#bcaff7", "#f9b878"];

  // Column header styling — colour token → hex accent, and the icon set the
  // restyle picker offers. Must mirror BoardGroup.COLOR_CHOICES /
  // COLUMN_ICONS server-side.
  const COLUMN_COLORS = {
    slate: "#64748b", rose: "#f43f5e", amber: "#f59e0b", green: "#10b981",
    sky: "#0ea5e9", violet: "#8b5cf6", orange: "#f97316", teal: "#14b8a6",
    indigo: "#6366f1", pink: "#ec4899",
  };
  const COLUMN_ICON_LIST = [
    "none", "exclamation-triangle", "people", "lightbulb", "shield-check",
    "flag", "star", "rocket-takeoff", "graph-up-arrow", "clipboard-check",
    "gem", "truck", "diagram-3", "cash-coin", "bullseye", "chat-dots",
    "heart", "gear",
  ];

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
  let lockColumns = false;         // when true, notes can't be dragged
                                   // between columns (within-column OK)
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

  function getCookie(name) {
    const parts = (document.cookie || "").split(";").map((x) => x.trim());
    for (const part of parts) {
      if (part.startsWith(name + "=")) {
        return decodeURIComponent(part.slice(name.length + 1));
      }
    }
    const input = document.querySelector('input[name="csrfmiddlewaretoken"]');
    return input ? input.value : "";
  }

  // ── inbound ────────────────────────────────────────────────────────
  function handle(msg) {
    switch (msg.type) {
      case "state":
        boardState = msg.state || "lobby";
        groups = (msg.groups || []).map((g) => ({
          id: g.id, name: g.name,
          icon: g.icon || "none", color: g.color || "slate",
        }));
        if (promptDisplay && msg.prompt) promptDisplay.textContent = msg.prompt;
        if (msg.title) applyTitle(msg.title);
        notes.clear();
        (msg.notes || []).forEach((n) => notes.set(n.id, n));
        if (typeof msg.participants === "number") setPeople(msg.participants);
        if (typeof msg.limit === "number") { noteLimit = msg.limit; reflectLimit(); }
        if (typeof msg.lock_columns === "boolean") {
          lockColumns = msg.lock_columns;
        }
        // If any note arrived with a saved position, the presenter had
        // previously arranged the board — restore free-arrange mode.
        if ([...notes.values()].some((n) => n.pos_x != null && n.pos_y != null)) {
          freeArrange = true;
        }
        reflectPower();
        renderAll();
        reflectLock();
        break;

      case "board_state":
        boardState = msg.state || boardState;
        reflectPower();
        break;

      case "title_changed":
        if (msg.title) applyTitle(msg.title);
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

      case "note_edited": {
        // A note's content (text / colour / icon / column) changed.
        // Replace our cached copy and re-render.
        if (msg.note) {
          notes.set(msg.note.id, msg.note);
          renderAll();
        }
        break;
      }

      case "edit_rejected": {
        // Surface the reason — reuse the alert path the exports use.
        alert(msg.reason || "That edit was rejected.");
        break;
      }

      case "note_drawn": {
        // A stroke was committed on a note. Append the authoritative copy
        // (with its real id) and drop any matching provisional stroke this
        // screen drew optimistically, so we don't end up with a duplicate.
        const n = notes.get(msg.note_id);
        if (n && msg.drawing) {
          if (!n.drawings) n.drawings = [];
          // Remove the first pending stroke that matches tool + length —
          // it's the optimistic one we just drew; the server copy replaces
          // it. (Other presenters' strokes have no local pending twin.)
          const di = n.drawings.findIndex(
            (d) => d._pending && d.tool === msg.drawing.tool &&
                   (d.points || []).length === (msg.drawing.points || []).length
          );
          if (di !== -1) n.drawings.splice(di, 1);
          n.drawings.push(msg.drawing);
          const el = findNoteEl(msg.note_id);
          if (el) paintNoteDrawing(el, n);
        }
        break;
      }

      case "note_erased": {
        // Specific strokes were removed from a note (everywhere). Drop the
        // listed ids; leave any other strokes (incl. still-pending ones)
        // untouched. The local screen that erased has already removed them
        // optimistically — this is a harmless no-op there.
        const n = notes.get(msg.note_id);
        if (n && n.drawings && Array.isArray(msg.drawing_ids)) {
          const gone = new Set(msg.drawing_ids);
          n.drawings = n.drawings.filter((d) => !gone.has(d.id));
          const el = findNoteEl(msg.note_id);
          if (el) paintNoteDrawing(el, n);
        }
        break;
      }

      case "group_added": {
        // A new topic column. Avoid duplicating if it's already known.
        if (msg.group && !groups.some((g) => g.id === msg.group.id)) {
          groups.push(msg.group);
          renderAll();
          renderAddColumn();
        }
        break;
      }

      case "group_renamed": {
        const g = groups.find((x) => x.id === msg.id);
        if (g) { g.name = msg.name; renderAll(); }
        break;
      }

      case "group_removed": {
        // Drop the column and every note that was inside it.
        groups = groups.filter((g) => g.id !== msg.id);
        (msg.note_ids || []).forEach((nid) => notes.delete(nid));
        renderAll();
        renderHiddenTray();
        break;
      }

      case "group_reordered": {
        if (Array.isArray(msg.groups)) {
          groups = msg.groups.map((g) => ({
            id: g.id, name: g.name,
            icon: g.icon || "none", color: g.color || "slate",
          }));
          renderAll();
        }
        break;
      }

      case "group_restyled": {
        // A column's icon and/or colour changed. Patch our cached group
        // and re-render so the header chip + accent update everywhere.
        if (msg.group) {
          const g = groups.find((x) => x.id === msg.group.id);
          if (g) {
            g.icon = msg.group.icon || "none";
            g.color = msg.group.color || "slate";
            if (msg.group.name) g.name = msg.group.name;
            renderAll();
          }
        }
        break;
      }

      case "chat_history": {
        // Sent to a collaborator on connect — seed the chat panel.
        chatSeed(msg.messages || []);
        break;
      }

      case "chat_message": {
        chatAppend(msg.message, /*live=*/true);
        break;
      }

      case "chat_rejected": {
        chatNotice(msg.reason || "Message not sent.");
        break;
      }

      case "collab_presence": {
        if (msg.collaborator) {
          setCollaboratorOnline(msg.collaborator, !!msg.online);
        }
        break;
      }

      case "column_lock_changed": {
        lockColumns = !!msg.locked;
        reflectLock();
        renderAll();   // re-render so draggable attributes update
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
  function setPeople(c) {
    if (statPeople) statPeople.textContent = String(c);
    const pill = document.getElementById("stat-people-pill");
    if (pill) pill.textContent = String(c);
  }
  function setNotesCount() {
    if (statNotes) {
      const visible = [...notes.values()].filter((n) => !n.hidden).length;
      statNotes.textContent = String(visible);
    }
  }

  // ── power button (open / close) ────────────────────────────────────
  // ── board title (rename on the stage) ───────────────────────────────
  // Updates the title everywhere it appears: the header chip, the big
  // hand-drawn heading, the QR card, and the document title.
  function applyTitle(title) {
    const t = (title || "").trim();
    if (!t) return;
    if (titleDisplay) {
      titleDisplay.textContent = t.length > 30 ? t.slice(0, 30) + "…" : t;
      titleDisplay.dataset.fullTitle = t;
      if (!CAN_EDIT) titleDisplay.title = t;
    }
    if (headingTitleText) headingTitleText.textContent = t;
    if (qrCardTitle) qrCardTitle.textContent = t;
    document.title = t + " · Boardly · Presenter";
  }

  // Inline rename: clicking the title (or the pencil) turns it into an
  // input; Enter / blur commits, Escape cancels. Owner only.
  function startTitleEdit() {
    if (!CAN_EDIT || !titleDisplay) return;
    if (titleDisplay.querySelector("input")) return;   // already editing
    const current = titleDisplay.dataset.fullTitle || titleDisplay.textContent || "";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "kk-board-title-input";
    input.maxLength = 140;
    input.value = current;
    titleDisplay.textContent = "";
    titleDisplay.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const commit = (save) => {
      if (done) return;
      done = true;
      const next = input.value.trim().slice(0, 140);
      if (save && next && next !== current) {
        send({ type: "set_title", title: next });
        applyTitle(next);   // optimistic; broadcast confirms
      } else {
        applyTitle(current);
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      else if (e.key === "Escape") { e.preventDefault(); commit(false); }
    });
    input.addEventListener("blur", () => commit(true));
  }

  function initTitleEdit() {
    if (!CAN_EDIT) return;
    if (titleDisplay) titleDisplay.addEventListener("click", startTitleEdit);
    if (titleEditBtn) titleEditBtn.addEventListener("click", startTitleEdit);
  }

  function reflectPower() {
    if (!powerBtn) return;
    powerBtn.dataset.state = boardState;
    stage.classList.toggle("is-ended", boardState === "ended");

    const live = boardState === "open" || boardState === "running";

    const icon = powerBtn.querySelector("i");
    if (live) {
      // Board is live: the power button pauses it back to the lobby; the
      // separate Stop button ends the session entirely.
      if (powerLabel) powerLabel.textContent = "Pause board";
      if (icon) icon.className = "bi bi-pause-fill";
    } else if (boardState === "ended") {
      // Ended is no longer a dead end — let the presenter reopen.
      if (powerLabel) powerLabel.textContent = "Reopen board";
      if (icon) icon.className = "bi bi-arrow-clockwise";
    } else {
      if (powerLabel) powerLabel.textContent = "Open board";
      if (icon) icon.className = "bi bi-play-fill";
    }

    // The explicit Stop / End-session button is only shown while the
    // board is actually live.
    if (stopBtn) stopBtn.style.display = live ? "" : "none";

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
    // The power button: open the board, pause a live board back to the
    // lobby, or reopen an ended/paused one. Ending is handled separately
    // by the explicit Stop button so it's always a deliberate action.
    const live = boardState === "open" || boardState === "running";
    const next = live ? "lobby" : "open";
    setBoardState(next);
  }

  function endSession() {
    if (boardState === "ended") return;
    if (!confirm("End this board session? Participants can no longer post notes.")) {
      return;
    }
    setBoardState("ended");
  }

  function setBoardState(next) {
    send({ type: "set_state", state: next });
    // Optimistic; the broadcast confirms for every screen.
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
    if (WALL) el.classList.add("kk-note--msg");
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
    if (WALL) {
      // Anonymous wall: the footer shows the post date, never a name.
      author.classList.add("kk-note-date");
      author.innerHTML = '<i class="bi bi-clock"></i>';
      author.appendChild(document.createTextNode(wallDate(n.ts)));
    } else {
      author.textContent = n.author || "Anonymous";
    }
    if (n.edited) {
      const ed = document.createElement("span");
      ed.className = "kk-note-edited";
      ed.textContent = "(edited)";
      author.appendChild(ed);
    }
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

  // ── fit-to-pad text sizing ─────────────────────────────────────────
  // The pad grows taller with its text up to a cap (--note-max-h in
  // boardly.css). While the pad has room to grow, the text stays at full
  // size and the quick-out below keeps it there. Only once the pad is
  // capped and the text still overflows do we shrink the font until it
  // fits. The footer (author + like + burn + remove) is a non-shrinking
  // row pinned to the bottom, so it is always fully visible.
  const FIT_MAX_PX = 17;   // comfortable maximum (~1.05rem)
  const FIT_MIN_PX = 9;    // never shrink past this; tiny text stays legible

  function fitNoteText(noteEl) {
    const textEl = noteEl.querySelector(".kk-note-text");
    if (!textEl) return;

    // Set the maximum font first. This reflows the pad, which grows up to
    // its max-height cap. We then read the text region's clientHeight —
    // the room left between the icon and the footer at the pad's current
    // (possibly grown) height. If the text fits, we're done; the pad simply
    // grew to hold full-size text.
    let lo = FIT_MIN_PX, hi = FIT_MAX_PX, best = FIT_MIN_PX;
    textEl.style.fontSize = hi + "px";

    // Quick out: pad grew enough (or text is short) — keep full size.
    if (textEl.scrollHeight <= textEl.clientHeight) {
      textEl.style.removeProperty("font-size");
      noteEl.style.setProperty("--note-fs", hi + "px");
      return;
    }

    // Pad is capped and text still overflows — binary search for the
    // largest size that fits the capped pad.
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      textEl.style.fontSize = mid + "px";
      if (textEl.scrollHeight <= textEl.clientHeight) {
        best = mid; lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    textEl.style.removeProperty("font-size");
    noteEl.style.setProperty("--note-fs", best + "px");
  }

  function fitAllNotes() {
    // Measure in a single frame so layout is settled before we read sizes.
    requestAnimationFrame(() => {
      stage.querySelectorAll(".kk-note").forEach(fitNoteText);
      // Pad heights may have changed while fitting text; repaint each
      // pad's drawing on the next frame so its canvas matches the final
      // size and the strokes land in the right place.
      requestAnimationFrame(repaintAllDrawings);
    });
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

    // After the notes are in the DOM, shrink any long text so it fits the
    // fixed sticky pads without pushing the action buttons off the note.
    fitAllNotes();
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
    // Flag the wipe so a rename input's blur handler (fired when the
    // input is detached) knows not to commit — restoreActiveRename will
    // re-open it instead.
    columnsReRendering = true;
    columnsWrap.innerHTML = "";
    columnsReRendering = false;
    columnsWrap.classList.toggle("columns-locked", lockColumns);
    const byGroup = new Map();
    groups.forEach((g) => byGroup.set(g.id, []));
    const loose = [];
    ordered.forEach((n) => {
      if (n.group_id != null && byGroup.has(n.group_id)) byGroup.get(n.group_id).push(n);
      else loose.push(n);
    });

    // Build one column. `gid` is the group id, or null for the "Other"
    // catch-all column (notes with no/!matching group). Real columns get
    // an editable name and a delete button; "Other" is auto-generated so
    // it gets neither.
    function buildColumn(gid, name, list) {
      const col = document.createElement("div");
      col.className = "kk-board-column";
      // Look up this column's style (icon + colour token). The "Other"
      // catch-all (gid null) stays neutral.
      const meta = gid == null ? null : groups.find((g) => g.id === gid);
      const colorKey = (meta && meta.color) || "slate";
      const iconKey = (meta && meta.icon) || "none";
      col.dataset.color = colorKey;
      col.style.setProperty("--col-accent", COLUMN_COLORS[colorKey] || COLUMN_COLORS.slate);
      if (gid != null) {
        col.dataset.gid = String(gid);
        if (COLUMN_REORDER_URL) {
          col.setAttribute("draggable", "true");
          col.classList.add("kk-board-column-draggable");
        }
      }
      const head = document.createElement("div");
      head.className = "kk-board-column-head";

      // Coloured icon chip in front of the name (hidden when icon = none).
      const chip = document.createElement("span");
      chip.className = "kk-col-chip";
      if (iconKey && iconKey !== "none") {
        chip.innerHTML = '<i class="bi bi-' + iconKey + '"></i>';
      } else {
        chip.classList.add("is-empty");
      }

      const nameEl = document.createElement("span");
      nameEl.className = "kk-col-name";
      nameEl.textContent = name;

      const count = document.createElement("span");
      count.className = "count";
      count.textContent = String(list.length);

      if (gid != null) {
        // Real column: clicking the name turns it into an input; the
        // style button opens the icon/colour picker; the button beside it
        // deletes the whole column.
        nameEl.classList.add("is-editable");
        nameEl.title = "Click to rename this column";
        nameEl.dataset.gid = String(gid);
        nameEl.tabIndex = 0;
        // The chip doubles as the "restyle" trigger so presenters can
        // recolour / re-icon a column in place.
        chip.classList.add("kk-col-chip-btn");
        chip.dataset.gid = String(gid);
        chip.title = "Change this column's icon & colour";
        chip.tabIndex = 0;

        const style = document.createElement("button");
        style.type = "button";
        style.className = "kk-col-style";
        style.dataset.gid = String(gid);
        style.title = "Change icon & colour";
        style.innerHTML = '<i class="bi bi-palette"></i>';

        const del = document.createElement("button");
        del.type = "button";
        del.className = "kk-col-delete";
        del.dataset.gid = String(gid);
        del.title = "Delete this column";
        del.innerHTML = '<i class="bi bi-trash"></i>';

        head.append(chip, nameEl, count, style, del);
      } else {
        head.append(chip, nameEl, count);
      }

      const body = document.createElement("div");
      body.className = "kk-board-column-body";
      // The drop target carries its group id so a drop knows where to
      // move the note. "" marks the ungrouped "Other" column.
      body.dataset.groupId = gid == null ? "" : String(gid);
      list.forEach((n) => {
        const el = buildNote(n);
        if (n.id === newId) el.classList.add("is-new");
        // Notes are draggable between columns unless the board is
        // locked. The drag itself is wired by enableColumnDnD().
        if (!lockColumns) {
          el.setAttribute("draggable", "true");
          el.classList.add("kk-note-draggable");
        }
        body.appendChild(el);
      });
      col.append(head, body);
      return col;
    }

    groups.forEach((g) => {
      columnsWrap.appendChild(buildColumn(g.id, g.name, byGroup.get(g.id) || []));
    });

    // Notes that didn't match a column get an extra "Other" column.
    // It's a valid drop target too, so a note can be moved out of any
    // column back to ungrouped.
    if (loose.length || (!lockColumns && groups.length)) {
      columnsWrap.appendChild(buildColumn(null, "Other", loose));
    }

    enableColumnDnD();
    // If a column rename was in progress, a re-render just destroyed its
    // input — re-open it from the saved snapshot so the edit survives.
    restoreActiveRename();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ── column drag-and-drop ────────────────────────────────────────────
  // Notes are dragged between columns with native HTML5 drag events. The
  // listeners are delegated and attached to columnsWrap exactly once; the
  // per-render work in renderColumns is just setting draggable + group id.
  let dndWired = false;
  let dragNoteId = null;
  let dragColumnId = null;

  // While the presenter is renaming a column, this holds the live edit so
  // a background re-render (a note arriving, a like, a participant
  // joining — all call renderAll) doesn't wipe the input mid-edit. After
  // renderColumns rebuilds, it re-opens the rename from this snapshot.
  // Shape: { gid, value, selStart, selEnd } or null.
  let activeRename = null;
  // True only during columnsWrap.innerHTML wipe — lets a rename input's
  // blur handler tell a re-render apart from the presenter clicking away.
  let columnsReRendering = false;
  // Set by wireColumnControls; renderColumns calls it after rebuilding to
  // re-open an in-progress rename. No-op until column controls are wired.
  let restoreActiveRename = function () {};

  function enableColumnDnD() {
    if (!columnsWrap || dndWired) return;
    dndWired = true;

    columnsWrap.addEventListener("dragstart", (e) => {
      const noteEl = e.target.closest(".kk-note");

      // Drag a whole column by grabbing its card/header. This reorders the
      // BoardGroup.position values through a normal HTTP endpoint so the
      // order survives refreshes and reopens.
      const colEl = e.target.closest(".kk-board-column[data-gid]");
      if (COLUMN_REORDER_URL && colEl && !noteEl && !e.target.closest("button,input,textarea,select,a")) {
        dragColumnId = Number(colEl.dataset.gid);
        colEl.classList.add("kk-board-column-dragging");
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          try { e.dataTransfer.setData("text/plain", "column:" + dragColumnId); } catch (_) {}
        }
        return;
      }

      if (lockColumns) { e.preventDefault(); return; }
      if (!noteEl) return;
      dragNoteId = Number(noteEl.dataset.id);
      noteEl.classList.add("kk-note-dragging");
      // Some browsers need data set for the drag to start.
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", String(dragNoteId)); } catch (_) {}
      }
    });

    columnsWrap.addEventListener("dragend", (e) => {
      const noteEl = e.target.closest(".kk-note");
      if (noteEl) noteEl.classList.remove("kk-note-dragging");
      columnsWrap.querySelectorAll(".kk-board-column-body.drop-over")
        .forEach((b) => b.classList.remove("drop-over"));
      columnsWrap.querySelectorAll(".kk-board-column-dragging,.col-drop-before,.col-drop-after")
        .forEach((el) => el.classList.remove("kk-board-column-dragging", "col-drop-before", "col-drop-after"));
      dragNoteId = null;
      dragColumnId = null;
    });

    columnsWrap.addEventListener("dragover", (e) => {
      if (dragColumnId != null) {
        const col = e.target.closest(".kk-board-column[data-gid]");
        if (!col || Number(col.dataset.gid) === dragColumnId) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
        const rect = col.getBoundingClientRect();
        const before = e.clientX < rect.left + rect.width / 2;
        columnsWrap.querySelectorAll(".col-drop-before,.col-drop-after")
          .forEach((el) => el.classList.remove("col-drop-before", "col-drop-after"));
        col.classList.add(before ? "col-drop-before" : "col-drop-after");
        return;
      }

      if (lockColumns || dragNoteId == null) return;
      const body = e.target.closest(".kk-board-column-body");
      if (!body) return;
      e.preventDefault();   // allow the drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      if (!body.classList.contains("drop-over")) {
        columnsWrap.querySelectorAll(".kk-board-column-body.drop-over")
          .forEach((b) => b.classList.remove("drop-over"));
        body.classList.add("drop-over");
      }
    });

    columnsWrap.addEventListener("dragleave", (e) => {
      const body = e.target.closest(".kk-board-column-body");
      // Only clear when the pointer actually left the body, not when it
      // crossed onto a child note inside the same body.
      if (body && !body.contains(e.relatedTarget)) {
        body.classList.remove("drop-over");
      }
    });

    columnsWrap.addEventListener("drop", (e) => {
      if (dragColumnId != null) {
        const target = e.target.closest(".kk-board-column[data-gid]");
        if (!target) return;
        e.preventDefault();
        const targetId = Number(target.dataset.gid);
        const rect = target.getBoundingClientRect();
        const before = e.clientX < rect.left + rect.width / 2;
        reorderColumnsLocal(dragColumnId, targetId, before);
        columnsWrap.querySelectorAll(".col-drop-before,.col-drop-after")
          .forEach((el) => el.classList.remove("col-drop-before", "col-drop-after"));
        dragColumnId = null;
        return;
      }

      if (lockColumns || dragNoteId == null) return;
      const body = e.target.closest(".kk-board-column-body");
      if (!body) return;
      e.preventDefault();
      body.classList.remove("drop-over");

      const raw = body.dataset.groupId;
      const targetGroup = raw === "" ? null : Number(raw);
      const n = notes.get(dragNoteId);
      // No-op if the note is already in that column.
      const current = n && n.group_id != null ? n.group_id : null;
      if (n && current !== targetGroup) {
        send({ type: "move_group", id: dragNoteId, group_id: targetGroup });
        // Optimistic: move locally so the board updates instantly; the
        // server's note_edited broadcast confirms (or a lock rejection
        // will leave the authoritative state unchanged on next render).
        n.group_id = targetGroup;
        renderAll();
      }
      dragNoteId = null;
    });

    wireColumnControls();
  }


  function reorderColumnsLocal(sourceId, targetId, before) {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const current = groups.slice();
    const from = current.findIndex((g) => g.id === sourceId);
    const to0 = current.findIndex((g) => g.id === targetId);
    if (from < 0 || to0 < 0) return;

    const [moved] = current.splice(from, 1);
    let to = current.findIndex((g) => g.id === targetId);
    if (to < 0) to = current.length;
    if (!before) to += 1;
    current.splice(to, 0, moved);
    groups = current;
    renderAll();
    persistColumnOrder();
  }

  function persistColumnOrder() {
    if (!COLUMN_REORDER_URL) return;
    fetch(COLUMN_REORDER_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": getCookie("csrftoken"),
      },
      body: JSON.stringify({ order: groups.map((g) => g.id) }),
    })
      .then((r) => r.ok ? r.json() : Promise.reject(r))
      .then((data) => {
        if (data && Array.isArray(data.groups)) {
          groups = data.groups.map((g) => ({ id: g.id, name: g.name }));
          renderAll();
        }
      })
      .catch(() => {
        // Keep the optimistic order in the UI; the next full state refresh
        // will restore the database order if the save failed.
      });
  }

  // ── column rename + delete (presenter) ──────────────────────────────
  // Delegated handlers on columnsWrap, attached once alongside the DnD
  // wiring. Renaming swaps the name span for an input in place; deleting
  // confirms (warning how many notes go with the column) then sends.
  function wireColumnControls() {
    if (!columnsWrap) return;

    // Delete a column.
    columnsWrap.addEventListener("click", (e) => {
      const del = e.target.closest(".kk-col-delete");
      if (!del) return;
      const gid = Number(del.dataset.gid);
      const g = groups.find((x) => x.id === gid);
      const inCol = [...notes.values()]
        .filter((n) => n.group_id === gid).length;
      const label = g ? `“${g.name}”` : "this column";
      const warn = inCol
        ? `Delete ${label} and its ${inCol} note${inCol === 1 ? "" : "s"}? `
          + "The notes will be permanently removed."
        : `Delete ${label}? It has no notes.`;
      if (confirm(warn)) {
        send({ type: "delete_group", id: gid });
      }
    });

    // Start renaming: click (or Enter/Space) on an editable name.
    // `preset` (optional) restores an in-progress rename after a
    // re-render — it carries the typed-so-far value and caret position.
    function beginRename(nameEl, preset) {
      if (!nameEl || nameEl.querySelector("input")) return;
      const gid = Number(nameEl.dataset.gid);
      // The committed name is what's on the group, not the (possibly
      // half-typed) value being restored.
      const g0 = groups.find((x) => x.id === gid);
      const current = preset ? (g0 ? g0.name : nameEl.textContent)
                             : nameEl.textContent;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "kk-col-name-input";
      input.maxLength = 60;
      input.value = preset ? preset.value : current;
      nameEl.textContent = "";
      nameEl.appendChild(input);
      input.focus();
      if (preset && preset.selStart != null) {
        try { input.setSelectionRange(preset.selStart, preset.selEnd); }
        catch (_) { /* non-text input edge case */ }
      } else {
        input.select();
      }

      // Mark this rename as live so background re-renders preserve it.
      const snapshot = () => {
        activeRename = {
          gid,
          value: input.value,
          selStart: input.selectionStart,
          selEnd: input.selectionEnd,
        };
      };
      snapshot();
      input.addEventListener("input", snapshot);
      input.addEventListener("keyup", snapshot);
      input.addEventListener("select", snapshot);

      let done = false;
      const commit = (save) => {
        if (done) return;
        done = true;
        activeRename = null;   // rename is over — stop preserving it
        const next = (input.value || "").trim();
        if (save && next && next !== current) {
          send({ type: "rename_group", id: gid, name: next });
          // Optimistic; the broadcast confirms for every screen.
          const g = groups.find((x) => x.id === gid);
          if (g) g.name = next;
          renderAll();
        } else {
          // Cancelled or unchanged — restore the plain name.
          nameEl.textContent = current;
        }
      };
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); commit(true); }
        else if (ev.key === "Escape") { ev.preventDefault(); commit(false); }
      });
      // Blur usually means the presenter clicked away — commit the
      // rename. But a background re-render also blurs the input by
      // detaching it from the DOM. columnsReRendering is true only
      // during that wipe, so we skip the commit and let renderColumns
      // re-open the rename from the snapshot.
      input.addEventListener("blur", () => {
        if (columnsReRendering &&
            activeRename && activeRename.gid === gid) {
          return;
        }
        commit(true);
      });
      // Don't let a click inside the input bubble to the rename handler.
      input.addEventListener("click", (ev) => ev.stopPropagation());
    }

    // Expose so renderColumns can re-open a rename after rebuilding.
    restoreActiveRename = function () {
      if (!activeRename || !columnsWrap) return;
      const nameEl = columnsWrap.querySelector(
        '.kk-col-name.is-editable[data-gid="' + activeRename.gid + '"]'
      );
      if (nameEl && !nameEl.querySelector("input")) {
        beginRename(nameEl, activeRename);
      }
    };

    columnsWrap.addEventListener("click", (e) => {
      const nameEl = e.target.closest(".kk-col-name.is-editable");
      if (nameEl && !e.target.closest("input")) beginRename(nameEl);
    });
    columnsWrap.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const nameEl = e.target.closest(".kk-col-name.is-editable");
      if (nameEl && !nameEl.querySelector("input")) {
        e.preventDefault();
        beginRename(nameEl);
      }
    });
  }

  // ── column lock (presenter toggle) ──────────────────────────────────
  function reflectLock() {
    if (btnLockColumns) {
      btnLockColumns.classList.toggle("is-active", lockColumns);
      const icon = btnLockColumns.querySelector("i");
      if (icon) icon.className = lockColumns ? "bi bi-lock-fill" : "bi bi-unlock";
      btnLockColumns.title = lockColumns
        ? "Columns locked — notes can't be moved between columns. Click to unlock."
        : "Lock columns — prevent moving notes between columns.";
    }
    if (columnsWrap) columnsWrap.classList.toggle("columns-locked", lockColumns);
  }

  function toggleLock() {
    // Optimistic flip; the broadcast confirms for every screen.
    lockColumns = !lockColumns;
    reflectLock();
    renderAll();
    send({ type: "set_column_lock", locked: lockColumns });
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
      if (raw === "edit") {
        // Open the note editor dialog for this note.
        closePopover();
        openNoteEditor(id);
        return;
      }
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

  // ════════════════════════════════════════════════════════════════════
  //  NOTE EDITING + COLUMN MANAGEMENT (presenter)
  //  • Edit any note's text / colour / icon / column — the original is
  //    preserved server-side in the note's edit history.
  //  • Add new topic columns to a live board.
  //  Notes can also be moved between columns straight from the editor's
  //  column picker (the server treats that as an edit too).
  // ════════════════════════════════════════════════════════════════════

  const editDialog   = document.getElementById("note-edit-dialog");
  const editForm     = document.getElementById("note-edit-form");
  const editId       = document.getElementById("edit-note-id");
  const editText     = document.getElementById("edit-note-text");
  const editColorRow = document.getElementById("edit-color-row");
  const editIconRow  = document.getElementById("edit-icon-row");
  const editGroupBox = document.getElementById("edit-group-field");
  const editGroupSel = document.getElementById("edit-note-group");

  // Radiogroup behaviour inside the editor (colour + icon pickers).
  function wireEditPicker(row, attr) {
    if (!row) return;
    row.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-" + attr + "]");
      if (!btn) return;
      row.querySelectorAll("[data-" + attr + "]").forEach((b) => {
        const on = b === btn;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
    });
  }
  wireEditPicker(editColorRow, "color");
  wireEditPicker(editIconRow, "icon");

  function editPicked(row, attr, fallback) {
    const on = row && row.querySelector("[data-" + attr + "].is-active");
    return on ? on.getAttribute("data-" + attr) : fallback;
  }
  function editSetPicked(row, attr, value) {
    if (!row) return;
    row.querySelectorAll("[data-" + attr + "]").forEach((b) => {
      const on = String(b.getAttribute("data-" + attr)) === String(value);
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  // Rebuild the editor's column <select> from the current groups.
  function refreshEditGroupOptions(selectedId) {
    if (!editGroupSel) return;
    editGroupSel.innerHTML = '<option value="">— No column —</option>';
    groups.forEach((g) => {
      const o = document.createElement("option");
      o.value = String(g.id);
      o.textContent = g.name;
      if (String(g.id) === String(selectedId)) o.selected = true;
      editGroupSel.appendChild(o);
    });
    if (editGroupBox) editGroupBox.style.display = groups.length ? "" : "none";
  }

  function openNoteEditor(id) {
    const n = notes.get(id);
    if (!n || !editDialog) return;
    editId.value = n.id;
    editText.value = n.text || "";
    editSetPicked(editColorRow, "color", n.color != null ? n.color : 0);
    editSetPicked(editIconRow, "icon", n.icon || "none");
    refreshEditGroupOptions(n.group_id);
    if (typeof editDialog.showModal === "function") editDialog.showModal();
    else editDialog.setAttribute("open", "");
    editText.focus();
  }
  function closeNoteEditor() {
    if (!editDialog) return;
    if (typeof editDialog.close === "function") editDialog.close();
    else editDialog.removeAttribute("open");
  }

  ["note-edit-cancel", "note-edit-cancel2"].forEach((cid) => {
    const b = document.getElementById(cid);
    if (b) b.addEventListener("click", closeNoteEditor);
  });

  if (editForm) {
    editForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = Number(editId.value);
      const text = (editText.value || "").trim();
      if (!text) { editText.focus(); return; }
      const groupRaw = editGroupSel ? editGroupSel.value : "";
      send({
        type: "edit",
        id,
        text,
        color: Number(editPicked(editColorRow, "color", 0)) || 0,
        icon: editPicked(editIconRow, "icon", "none") || "none",
        group_id: groupRaw === "" ? null : Number(groupRaw),
      });
      closeNoteEditor();
    });
  }

  // ── add-column control ──────────────────────────────────────────────
  const addColBox    = document.getElementById("board-addcol");
  const addColBtn    = document.getElementById("addcol-btn");
  const addColForm   = document.getElementById("addcol-form");
  const addColInput  = document.getElementById("addcol-input");
  const addColSave   = document.getElementById("addcol-save");
  const addColCancel = document.getElementById("addcol-cancel");

  // The presenter can always add a column — the control sits just below
  // the columns wrapper and is visible whether or not the board already
  // has groups. (Adding the first column flips the board into columns.)
  function renderAddColumn() {
    // A message wall has no columns by design — never offer to add one.
    if (WALL) { if (addColBox) addColBox.style.display = "none"; return; }
    if (addColBox) addColBox.style.display = "";
  }
  function showAddColForm(on) {
    if (addColForm) addColForm.style.display = on ? "" : "none";
    if (addColBtn)  addColBtn.style.display  = on ? "none" : "";
    if (on && addColInput) { addColInput.value = ""; addColInput.focus(); }
  }
  if (addColBtn)    addColBtn.addEventListener("click", () => showAddColForm(true));
  if (addColCancel) addColCancel.addEventListener("click", () => showAddColForm(false));
  if (addColSave)   addColSave.addEventListener("click", () => {
    const name = (addColInput.value || "").trim();
    if (!name) { addColInput.focus(); return; }
    send({ type: "add_group", name });
    showAddColForm(false);
  });
  if (addColInput)  addColInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addColSave && addColSave.click(); }
  });

  // ── board background modal ─────────────────────────────────────────
  if (btnBackground && bgModal) {
    btnBackground.addEventListener("click", () => {
      if (typeof bgModal.showModal === "function") bgModal.showModal();
      else bgModal.setAttribute("open", "open");
    });
  }
  if (bgModalClose && bgModal) {
    bgModalClose.addEventListener("click", () => {
      if (typeof bgModal.close === "function") bgModal.close();
      else bgModal.removeAttribute("open");
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

  // ── Enlarged QR modal ──────────────────────────────────────────────
  // The small join QR is a button; clicking it opens a modal with a big,
  // framed "join card" (board title + large QR + code + URL) that can be
  // downloaded as a PNG. The big QR is drawn lazily the first time the
  // modal opens so the page-load cost stays on the small one only.
  let bigQRDrawn = false;

  function drawBigQR() {
    if (bigQRDrawn || !qrCardQr || !JOIN_URL || typeof QRCode === "undefined") return;
    qrCardQr.innerHTML = "";
    // Render at high resolution (512px) so the downloaded image stays
    // crisp when printed or projected, then CSS scales it to the card box.
    new QRCode(qrCardQr, {
      text: JOIN_URL, width: 512, height: 512,
      colorDark: "#111", colorLight: "#fff",
      correctLevel: QRCode.CorrectLevel.H,   // highest error correction
    });
    bigQRDrawn = true;
  }

  function openQRModal() {
    if (!qrModal) return;
    drawBigQR();
    if (typeof qrModal.showModal === "function") {
      if (!qrModal.open) qrModal.showModal();
    } else {
      qrModal.setAttribute("open", "");   // very old browser fallback
    }
  }

  function closeQRModal() {
    if (!qrModal) return;
    if (typeof qrModal.close === "function" && qrModal.open) qrModal.close();
    else qrModal.removeAttribute("open");
  }

  // A filesystem-safe slug of the board title for the download filename.
  function qrFilename() {
    const title = (qrCard && qrCard.querySelector(".kk-qr-card-title"));
    const t = (title ? title.textContent : "board")
      .trim().replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50) || "board";
    return `boardly_${t}_${CODE}_qr.png`;
  }

  async function downloadQRCard() {
    if (!qrCard) return;
    // Prefer html2canvas (captures the full designed card). If it isn't
    // available, fall back to downloading just the raw QR image so the
    // button never silently does nothing.
    if (typeof html2canvas === "function") {
      qrDownloadBtn && qrDownloadBtn.classList.add("is-busy");
      try {
        const canvas = await html2canvas(qrCard, {
          backgroundColor: "#ffffff",
          scale: 2,                       // sharp on hi-dpi / for printing
          useCORS: true,
          logging: false,
        });
        const a = document.createElement("a");
        a.href = canvas.toDataURL("image/png");
        a.download = qrFilename();
        a.click();
      } catch (err) {
        console.error(err);
        downloadRawQR();
      } finally {
        qrDownloadBtn && qrDownloadBtn.classList.remove("is-busy");
      }
    } else {
      downloadRawQR();
    }
  }

  // Fallback: grab whatever the QR library rendered (canvas or img) and
  // download that alone.
  function downloadRawQR() {
    if (!qrCardQr) return;
    const c = qrCardQr.querySelector("canvas");
    const img = qrCardQr.querySelector("img");
    let href = null;
    if (c) href = c.toDataURL("image/png");
    else if (img) href = img.src;
    if (!href) { alert("Couldn't generate the QR image. Please try again."); return; }
    const a = document.createElement("a");
    a.href = href;
    a.download = qrFilename();
    a.click();
  }

  function initQRModal() {
    if (qrBox) {
      qrBox.addEventListener("click", (e) => {
        e.preventDefault();
        openQRModal();
      });
    }
    if (qrModalClose) qrModalClose.addEventListener("click", closeQRModal);
    if (qrDownloadBtn) qrDownloadBtn.addEventListener("click", downloadQRCard);
    if (qrModal) {
      // Click on the dim backdrop (outside the inner card) closes it.
      qrModal.addEventListener("click", (e) => {
        if (e.target === qrModal) closeQRModal();
      });
      // <dialog> fires "cancel" on Escape — let it close normally.
      qrModal.addEventListener("cancel", () => closeQRModal());
    }
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
      /* Per-note drawing canvas — overlays the pad, sits above the text
         but below the footer controls so likes / burn / remove stay
         clickable. Pointer events pass through to the pad. */
      .kk-note { position: relative; }
      .kk-note-draw {
        position: absolute; inset: 0;
        z-index: 2;
        pointer-events: none;
        border-radius: inherit;
      }
      .kk-note-text, .kk-note-icon, .kk-note-pin { position: relative; z-index: 1; }
      .kk-note-foot { position: relative; z-index: 3; }
      /* Tool cursors over the board while a draw / erase tool is active. */
      .kk-board-stage.kk-drawing-on .kk-note { cursor: crosshair; }
      .kk-board-stage.kk-drawing-on .kk-note * { cursor: crosshair; }
      .kk-board-stage.kk-erasing-on .kk-note { cursor: cell; }
      /* While drawing OR erasing, stop touch gestures on pads from
         scrolling the board so a finger draws / scrubs instead. */
      .kk-board-stage.kk-drawing-on .kk-note,
      .kk-board-stage.kk-erasing-on .kk-note { touch-action: none; }
      /* Keep the footer buttons usable even with a tool active. */
      .kk-board-stage.kk-drawing-on .kk-note-foot,
      .kk-board-stage.kk-drawing-on .kk-note-foot *,
      .kk-board-stage.kk-erasing-on .kk-note-foot,
      .kk-board-stage.kk-erasing-on .kk-note-foot * { cursor: pointer; }
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

    // The draw tools and export buttons now live inside the Tools /
    // Options dropdown menus in stage_board.html. Reuse those existing
    // elements by id rather than injecting duplicates into the flat bar.
    btnExportPng = document.getElementById("btn-export-png") || btnExportPng;
    btnExportPdf = document.getElementById("btn-export-pdf") || btnExportPdf;
    btnHi = document.getElementById("btn-draw-hi") || btnHi;
    btnPen = document.getElementById("btn-draw-pen") || btnPen;
    btnEraseDraw = document.getElementById("btn-draw-clear") || btnEraseDraw;

    if (!header) return;

    // The per-participant limit control. Prefer dropping it into the
    // Options menu (under the export items); fall back to the flat header
    // only if that panel isn't present.
    if (document.getElementById("limit-input")) {
      limitInput = document.getElementById("limit-input");
      return;
    }
    const optionsPanel = document.getElementById("menu-options-panel");
    const anchor = powerBtn || null;

    const limitBox = document.createElement("span");
    limitBox.className = optionsPanel ? "kk-limit-box kk-limit-box--menu" : "kk-limit-box";
    limitBox.title = "Notes allowed per participant (0 = unlimited)";
    limitBox.innerHTML =
      '<i class="bi bi-person-lock"></i>' +
      '<span class="kk-limit-cap">Notes / person</span>' +
      '<button type="button" data-step="-1">&minus;</button>' +
      '<input type="text" inputmode="numeric" id="limit-input" value="0">' +
      '<button type="button" data-step="1">+</button>';
    if (optionsPanel) {
      const sep = document.createElement("div");
      sep.className = "kk-menu-sep";
      sep.setAttribute("role", "separator");
      optionsPanel.append(sep, limitBox);
    } else {
      header.insertBefore(limitBox, anchor);
    }
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

  // ── per-note drawing (highlighter + pen, bound to each pad) ─────────
  //
  // Strokes belong to a sticky note, not the board. Each pad carries its
  // own <canvas class="kk-note-draw"> sized to the pad, and a stroke is
  // stored in NOTE-LOCAL fractions (0..1 of the pad's width/height). That
  // makes the marks ride with the pad when it's dragged or the layout
  // changes, and — because the consumer persists them — survive a refresh
  // or rejoining the board. They only vanish when erased or when the note
  // is removed.
  //
  // drawTool: null | "highlighter" | "pen" | "erase"
  //   pen / highlighter  → draw on a pad
  //   erase              → tap a pad to clear that pad's drawing
  let drawing = false;            // a stroke is in progress
  let drawNoteEl = null;          // the pad being drawn on
  let drawNoteId = null;
  let activePts = null;           // points captured this stroke (fractions)
  let activeCanvas = null;        // the pad canvas we're painting into

  function strokeStyleFor(tool) {
    return tool === "highlighter"
      ? { color: "rgba(250,204,21,.45)", widthFrac: 0.085, cap: "round" }
      : { color: "#ef4444", widthFrac: 0.018, cap: "round" };
  }

  // Lazily attach (and size) a drawing canvas inside a pad. Returns the
  // canvas, or null if the pad has no usable size yet.
  function ensureNoteCanvas(noteEl) {
    let cv = noteEl.querySelector(".kk-note-draw");
    if (!cv) {
      cv = document.createElement("canvas");
      cv.className = "kk-note-draw";
      // The canvas sits above the pad's text but below its footer buttons
      // so likes / burn / remove stay clickable.
      noteEl.insertBefore(cv, noteEl.firstChild);
    }
    sizeNoteCanvas(noteEl, cv);
    return cv;
  }

  // Match the canvas backing store to the pad's current pixel size (with
  // devicePixelRatio for crispness), then repaint from stored fractions.
  function sizeNoteCanvas(noteEl, cv) {
    cv = cv || noteEl.querySelector(".kk-note-draw");
    if (!cv) return;
    const w = noteEl.clientWidth, h = noteEl.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + "px";
    cv.style.height = h + "px";
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Paint a single note's stored strokes onto its canvas. `note` is the
  // cached note dict (its .drawings array drives the paint).
  function paintNoteDrawing(noteEl, note) {
    if (!noteEl || !note) return;
    const list = note.drawings || [];
    let cv = noteEl.querySelector(".kk-note-draw");
    // No strokes and no canvas → nothing to do (don't create one).
    if (!list.length && !cv) return;
    if (!cv) cv = ensureNoteCanvas(noteEl);
    else sizeNoteCanvas(noteEl, cv);
    if (!cv) return;
    const ctx = cv.getContext("2d");
    const w = noteEl.clientWidth, h = noteEl.clientHeight;
    ctx.clearRect(0, 0, w, h);
    list.forEach((st) => strokePathOnto(ctx, st, w, h));
  }

  // Draw one stored stroke (fractional points) onto a pad-sized context.
  function strokePathOnto(ctx, st, w, h) {
    const pts = st.points || [];
    if (pts.length < 2) return;
    const s = strokeStyleFor(st.tool);
    ctx.strokeStyle = s.color;
    // Line width scales with the pad so a mark keeps its visual weight at
    // any pad size. Tie it to the smaller dimension.
    ctx.lineWidth = Math.max(1.5, s.widthFrac * Math.min(w, h));
    ctx.lineCap = s.cap;
    ctx.lineJoin = "round";
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = p[0] * w, y = p[1] * h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // Repaint every visible pad's drawing — called after any (re)render or
  // resize, since layout changes move/resize the pads.
  function repaintAllDrawings() {
    stage.querySelectorAll(".kk-note").forEach((el) => {
      const n = notes.get(Number(el.dataset.id));
      if (n) paintNoteDrawing(el, n);
    });
  }

  // Convert a pointer event to the pad's local fractions, clamped 0..1.
  function noteFracFromEvent(noteEl, e) {
    const r = noteEl.getBoundingClientRect();
    const x = (e.clientX - r.left) / (r.width || 1);
    const y = (e.clientY - r.top) / (r.height || 1);
    return [
      Math.max(0, Math.min(x, 1)),
      Math.max(0, Math.min(y, 1)),
    ];
  }

  // ── draw / erase gesture, delegated from the notes area / columns ───
  // The pen and highlighter build a stroke; the eraser scrubs over the
  // pad and removes any individual stroke its path passes near.
  let erasing = false;            // an erase scrub is in progress
  let eraseNoteEl = null;
  let eraseNoteId = null;
  let erasedThisScrub = null;     // Set of stroke ids removed this scrub

  // Smallest distance (in fraction-of-pad units) from the eraser tip to a
  // stroke for it to count as "touched". ~3.5% of the pad's size.
  const ERASE_RADIUS = 0.05;

  // Point-to-segment distance in the pad's normalised box. Used to decide
  // whether the eraser tip passed close enough to a stroke segment.
  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  // True if the eraser point [ex,ey] touches stroke `st` (fractional pts).
  function eraserHitsStroke(ex, ey, st) {
    const pts = st.points || [];
    if (!pts.length) return false;
    if (pts.length === 1) {
      return Math.hypot(ex - pts[0][0], ey - pts[0][1]) <= ERASE_RADIUS;
    }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (distToSegment(ex, ey, a[0], a[1], b[0], b[1]) <= ERASE_RADIUS) {
        return true;
      }
    }
    return false;
  }

  // Erase any strokes on the current pad that the eraser point touches.
  // Removes them locally (optimistic) and collects ids to tell the server.
  function eraseStrokesAt(frac) {
    const n = notes.get(eraseNoteId);
    if (!n || !n.drawings || !n.drawings.length) return;
    const [ex, ey] = frac;
    const survivors = [];
    let changed = false;
    for (const st of n.drawings) {
      if (eraserHitsStroke(ex, ey, st)) {
        changed = true;
        // A pending stroke has no server id yet — drop it locally only.
        if (st.id != null) erasedThisScrub.add(st.id);
      } else {
        survivors.push(st);
      }
    }
    if (changed) {
      n.drawings = survivors;
      if (eraseNoteEl) paintNoteDrawing(eraseNoteEl, n);
    }
  }

  function drawDown(e) {
    const noteEl = e.target.closest(".kk-note");
    if (!noteEl) return;
    // Never start from an in-note control (likes / burn / remove).
    if (e.target.closest(".kk-note-like") ||
        e.target.closest(".kk-note-act")) return;

    if (drawTool === "erase") {
      e.preventDefault();
      e.stopPropagation();
      erasing = true;
      eraseNoteEl = noteEl;
      eraseNoteId = Number(noteEl.dataset.id);
      erasedThisScrub = new Set();
      try { noteEl.setPointerCapture(e.pointerId); } catch (err) {}
      eraseStrokesAt(noteFracFromEvent(noteEl, e));
      return;
    }

    if (drawTool !== "pen" && drawTool !== "highlighter") return;
    e.preventDefault();
    e.stopPropagation();
    drawing = true;
    drawNoteEl = noteEl;
    drawNoteId = Number(noteEl.dataset.id);
    activeCanvas = ensureNoteCanvas(noteEl);
    activePts = [noteFracFromEvent(noteEl, e)];
    try { noteEl.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function drawMove(e) {
    if (erasing && eraseNoteEl) {
      e.preventDefault();
      eraseStrokesAt(noteFracFromEvent(eraseNoteEl, e));
      return;
    }
    if (!drawing || !drawNoteEl) return;
    e.preventDefault();
    activePts.push(noteFracFromEvent(drawNoteEl, e));
    // Live preview: clear + repaint the committed strokes, then the
    // in-progress one on top.
    const n = notes.get(drawNoteId);
    paintNoteDrawing(drawNoteEl, n || { drawings: [] });
    if (activeCanvas) {
      const ctx = activeCanvas.getContext("2d");
      const w = drawNoteEl.clientWidth, h = drawNoteEl.clientHeight;
      strokePathOnto(ctx, { tool: drawTool, points: activePts }, w, h);
    }
  }

  function drawEnd(e) {
    // Finish an erase scrub: tell the server which real strokes went.
    if (erasing) {
      erasing = false;
      const noteId = eraseNoteId;
      const ids = erasedThisScrub ? [...erasedThisScrub] : [];
      eraseNoteEl = null; eraseNoteId = null; erasedThisScrub = null;
      if (noteId != null && ids.length) {
        send({ type: "erase_strokes", note_id: noteId, drawing_ids: ids });
      }
      return;
    }

    if (!drawing) return;
    drawing = false;
    const pts = activePts || [];
    const noteId = drawNoteId;
    const tool = drawTool;
    drawNoteEl = null; drawNoteId = null; activePts = null; activeCanvas = null;

    // A dot / accidental tap (one point) isn't a stroke — ignore it.
    if (pts.length < 2 || noteId == null) return;

    // Optimistic local commit so the mark doesn't flicker away before the
    // server echoes it back. The broadcast appends the authoritative copy
    // (with its real id); we tag this provisional one so the echo can
    // replace it rather than duplicate.
    const n = notes.get(noteId);
    if (n) {
      if (!n.drawings) n.drawings = [];
      const provisional = { id: null, tool, points: pts, _pending: true };
      n.drawings.push(provisional);
      const el = findNoteEl(noteId);
      if (el) paintNoteDrawing(el, n);
    }
    send({ type: "draw", note_id: noteId, tool, points: pts });
  }

  function setDrawTool(tool) {
    drawTool = (drawTool === tool) ? null : tool;
    // Reflect active state across the three draw tools.
    if (btnHi)  btnHi.classList.toggle("is-active", drawTool === "highlighter");
    if (btnPen) btnPen.classList.toggle("is-active", drawTool === "pen");
    if (btnEraseDraw) btnEraseDraw.classList.toggle("is-active", drawTool === "erase");
    // While a draw/erase tool is on, the board shows a tool cursor and the
    // pads aren't draggable (the drag handler checks drawTool too).
    stage.classList.toggle("kk-drawing-on", !!drawTool && drawTool !== "erase");
    stage.classList.toggle("kk-erasing-on", drawTool === "erase");
  }

  // ── export (PNG / PDF) ──────────────────────────────────────────────
  function exportLibraryReady(src) {
    if (/html2canvas/i.test(src)) return typeof window.html2canvas === "function";
    if (/jspdf/i.test(src)) {
      return !!((window.jspdf && window.jspdf.jsPDF) || window.jsPDF);
    }
    return false;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (exportLibraryReady(src)) { resolve(); return; }

      // Browser normalises script.src to an absolute URL. Compare both the
      // normalised absolute URL and the original string so a preloaded CDN
      // script in the template does not make exports wait forever.
      const wanted = new URL(src, window.location.href).href;
      const existing = [...document.scripts].find((s) => s.src === wanted || s.src === src);

      const done = () => {
        if (exportLibraryReady(src) || !/html2canvas|jspdf/i.test(src)) resolve();
        else reject(new Error("loaded but library missing: " + src));
      };

      if (existing) {
        if (existing.dataset.loaded || exportLibraryReady(src)) { resolve(); return; }
        existing.addEventListener("load", () => { existing.dataset.loaded = "1"; done(); }, { once: true });
        existing.addEventListener("error", () => reject(new Error("load failed: " + src)), { once: true });

        // Important fix: html2canvas is already included by stage_board.html.
        // When this function runs after the page load, the old code attached
        // a new load listener to a script that had already finished loading,
        // so image/PDF export silently hung. This micro-check resolves that.
        setTimeout(() => { if (exportLibraryReady(src)) resolve(); }, 0);
        return;
      }

      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.addEventListener("load", () => { s.dataset.loaded = "1"; done(); }, { once: true });
      s.addEventListener("error", () => reject(new Error("load failed: " + src)), { once: true });
      document.head.appendChild(s);
    });
  }

  const H2C_SRC = "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js";
  const JSPDF_SRC = "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js";

  // The board normally lives inside fixed-height, scrolling containers, so
  // a plain html2canvas() snapshot only captures the pads visible on screen.
  // For export we temporarily lift those height/overflow constraints so the
  // whole board — every sticky pad, including the ones scrolled out of view —
  // lays out at its full natural height, capture it, then restore everything
  // exactly as it was.
  //
  // Each entry remembers an element and the inline styles we overrode so the
  // restore is lossless (we put back the *inline* value, which may be "").
  function expandForCapture() {
    const saved = [];
    const override = (el, props) => {
      if (!el) return;
      const prev = {};
      for (const k of Object.keys(props)) prev[k] = el.style[k];
      saved.push({ el, prev });
      Object.assign(el.style, props);
    };

    // The scroll/clip chain from the stage down to the notes.
    override(stage, { height: "auto", overflow: "visible" });
    override(boardCanvas, { overflow: "visible", height: "auto" });
    override(boardSheet, { height: "auto", overflow: "visible" });

    // Both the flat notes area and the grouped-columns wrapper can scroll.
    override(notesArea, { overflow: "visible", maxHeight: "none", height: "auto" });
    override(columnsWrap, { overflow: "visible", maxHeight: "none", height: "auto" });
    // Individual grouped-column bodies scroll independently too.
    if (columnsWrap) {
      columnsWrap.querySelectorAll(".kk-board-column-body").forEach((b) =>
        override(b, { overflow: "visible", maxHeight: "none", height: "auto" }));
    }

    return () => {
      // Restore in reverse so nested overrides unwind cleanly.
      for (let i = saved.length - 1; i >= 0; i--) {
        const { el, prev } = saved[i];
        for (const k of Object.keys(prev)) {
          if (prev[k]) el.style[k] = prev[k];
          else el.style.removeProperty(
            k.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()));
        }
      }
    };
  }

  async function captureBoard() {
    await loadScript(H2C_SRC);
    if (typeof html2canvas === "undefined") {
      throw new Error("html2canvas unavailable");
    }
    // Drawings now live inside each pad (per-note canvases), so capturing
    // the board sheet already includes every stroke. The sheet is the
    // export target whether or not anything has been drawn.
    const target = boardSheet;
    if (!target) throw new Error("nothing to export");

    const restore = expandForCapture();
    try {
      // Let the browser apply the expanded layout before measuring/painting.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // Measure the now-unclipped full size so html2canvas paints all of it
      // rather than just the original viewport-height window.
      const fullW = Math.ceil(target.scrollWidth);
      const fullH = Math.ceil(target.scrollHeight);
      // Browsers cap canvas dimensions (~32767px). On an enormous board the
      // 2× scale could blow past that and silently produce a blank canvas, so
      // step the scale down just enough to stay under the limit.
      const MAX_DIM = 32000;
      let scale = 2;
      const longest = Math.max(fullW, fullH);
      if (longest * scale > MAX_DIM) scale = Math.max(1, MAX_DIM / longest);
      target.classList.add("kk-exporting");
      return await html2canvas(target, {
        backgroundColor: "#ffffff",
        scale,
        useCORS: true,
        allowTaint: false,
        logging: false,
        width: fullW,
        height: fullH,
        windowWidth: fullW,
        windowHeight: fullH,
        scrollX: 0,
        scrollY: 0,
      });
    } finally {
      target.classList.remove("kk-exporting");
      restore();
    }
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
      alert("Couldn't export the image. If this board uses a photo background, make sure the image is served from your own site/media folder, then retry.");
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

      // Portrait A4. The captured board is one tall image; we slice it into
      // page-height bands and lay each band on its own page so every sticky
      // pad makes it into the PDF, however many there are.
      const pdf = new JsPDF({ orientation: "p", unit: "pt", format: "a4" });
      const margin = 24;                                  // pt, all sides
      const pw = pdf.internal.pageSize.getWidth();
      const ph = pdf.internal.pageSize.getHeight();
      const availW = pw - margin * 2;
      const availH = ph - margin * 2;

      // The board is scaled so its full width fits the printable width.
      const scale = availW / canvas.width;
      // How many source pixels fit on one page at that scale.
      const pageSrcH = Math.floor(availH / scale);
      const pages = Math.max(1, Math.ceil(canvas.height / pageSrcH));

      // A reusable slice canvas — one page-band of the source at a time.
      const slice = document.createElement("canvas");
      const sctx = slice.getContext("2d");

      for (let p = 0; p < pages; p++) {
        const srcY = p * pageSrcH;
        const srcH = Math.min(pageSrcH, canvas.height - srcY);
        slice.width = canvas.width;
        slice.height = srcH;
        sctx.clearRect(0, 0, slice.width, slice.height);
        // White background so any sub-pixel gaps aren't transparent.
        sctx.fillStyle = "#ffffff";
        sctx.fillRect(0, 0, slice.width, slice.height);
        sctx.drawImage(canvas, 0, srcY, canvas.width, srcH,
                                0, 0,    canvas.width, srcH);

        const img = slice.toDataURL("image/png");
        const drawW = availW;
        const drawH = srcH * scale;
        if (p > 0) pdf.addPage();
        pdf.addImage(img, "PNG", margin, margin, drawW, drawH);
      }

      pdf.save(exportFilename("pdf"));
    } catch (err) {
      alert("Couldn't export the PDF. If this board uses a photo background, make sure the image is served from your own site/media folder, then retry.");
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
    // The eraser is a tool mode: turn it on, then scrub across a pad to
    // rub out the individual strokes your path passes over.
    if (btnEraseDraw) {
      btnEraseDraw.title = "Eraser — scrub over a stroke to remove it";
      btnEraseDraw.addEventListener("click", () => setDrawTool("erase"));
    }
    if (btnExportPng) btnExportPng.addEventListener("click", exportPNG);
    if (btnExportPdf) btnExportPdf.addEventListener("click", exportPDF);

    // ── Draw / erase gestures (delegated at the stage so they work in
    // both the flat notes area AND grouped columns). drawDown handles all
    // three tools: pen / highlighter build a stroke, the eraser scrubs.
    stage.addEventListener("pointerdown", (e) => {
      if (drawTool === "pen" || drawTool === "highlighter" ||
          drawTool === "erase") {
        drawDown(e);
      }
    }, true);   // capture phase: claim the gesture before drag/click handlers
    window.addEventListener("pointermove", drawMove);
    window.addEventListener("pointerup", drawEnd);
    window.addEventListener("pointercancel", drawEnd);

    // Keep the per-note canvases sized to their pads on resize.
    let drawResizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(drawResizeTimer);
      drawResizeTimer = setTimeout(repaintAllDrawings, 160);
    });

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
  // ════════════════════════════════════════════════════════════════════
  //  Column style picker — presenter restyles a column's icon + colour.
  //  Opened from the palette button or the icon chip in a column header.
  // ════════════════════════════════════════════════════════════════════
  const colStyleModal = document.getElementById("col-style-modal");
  const colStyleIcons = document.getElementById("col-style-icons");
  const colStyleColors = document.getElementById("col-style-colors");
  const colStyleClose = document.getElementById("col-style-close");
  let stylingGid = null;
  let stylePickIcon = "none";
  let stylePickColor = "slate";

  function buildStylePicker() {
    if (colStyleIcons && !colStyleIcons.dataset.built) {
      COLUMN_ICON_LIST.forEach((ic) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "kk-style-icon";
        b.dataset.icon = ic;
        b.title = ic === "none" ? "No icon" : ic;
        b.innerHTML = ic === "none"
          ? '<i class="bi bi-slash-circle"></i>'
          : '<i class="bi bi-' + ic + '"></i>';
        colStyleIcons.appendChild(b);
      });
      colStyleIcons.dataset.built = "1";
    }
    if (colStyleColors && !colStyleColors.dataset.built) {
      Object.keys(COLUMN_COLORS).forEach((key) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "kk-style-color";
        b.dataset.color = key;
        b.title = key;
        b.style.setProperty("--c", COLUMN_COLORS[key]);
        colStyleColors.appendChild(b);
      });
      colStyleColors.dataset.built = "1";
    }
  }

  function openStylePicker(gid) {
    if (!colStyleModal) return;
    const g = groups.find((x) => x.id === gid);
    if (!g) return;
    buildStylePicker();
    stylingGid = gid;
    stylePickIcon = g.icon || "none";
    stylePickColor = g.color || "slate";
    reflectStylePicks();
    if (typeof colStyleModal.showModal === "function") colStyleModal.showModal();
    else colStyleModal.setAttribute("open", "");
  }

  function closeStylePicker() {
    stylingGid = null;
    if (!colStyleModal) return;
    if (typeof colStyleModal.close === "function" && colStyleModal.open) colStyleModal.close();
    else colStyleModal.removeAttribute("open");
  }

  function reflectStylePicks() {
    if (colStyleIcons) {
      colStyleIcons.querySelectorAll(".kk-style-icon").forEach((b) =>
        b.classList.toggle("is-active", b.dataset.icon === stylePickIcon));
    }
    if (colStyleColors) {
      colStyleColors.querySelectorAll(".kk-style-color").forEach((b) =>
        b.classList.toggle("is-active", b.dataset.color === stylePickColor));
    }
  }

  function commitStyle() {
    if (stylingGid == null) return;
    send({ type: "set_group_style", id: stylingGid,
           icon: stylePickIcon, color: stylePickColor });
    // Optimistic local update so it feels instant.
    const g = groups.find((x) => x.id === stylingGid);
    if (g) { g.icon = stylePickIcon; g.color = stylePickColor; renderAll(); }
  }

  function initStylePicker() {
    if (colStyleIcons) {
      colStyleIcons.addEventListener("click", (e) => {
        const b = e.target.closest(".kk-style-icon");
        if (!b) return;
        stylePickIcon = b.dataset.icon;
        reflectStylePicks();
        commitStyle();
      });
    }
    if (colStyleColors) {
      colStyleColors.addEventListener("click", (e) => {
        const b = e.target.closest(".kk-style-color");
        if (!b) return;
        stylePickColor = b.dataset.color;
        reflectStylePicks();
        commitStyle();
      });
    }
    if (colStyleClose) colStyleClose.addEventListener("click", closeStylePicker);
    if (colStyleModal) {
      colStyleModal.addEventListener("click", (e) => {
        if (e.target === colStyleModal) closeStylePicker();
      });
      colStyleModal.addEventListener("cancel", (e) => { e.preventDefault(); closeStylePicker(); });
    }
    // Delegate: palette button OR icon chip in a column header opens it.
    if (columnsWrap) {
      columnsWrap.addEventListener("click", (e) => {
        const trigger = e.target.closest(".kk-col-style, .kk-col-chip-btn");
        if (trigger && trigger.dataset.gid) {
          e.preventDefault();
          e.stopPropagation();
          openStylePicker(Number(trigger.dataset.gid));
        }
      });
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  Collaborators rail + instant messaging back-channel.
  // ════════════════════════════════════════════════════════════════════
  const collabRail = document.getElementById("collab-rail");
  const chatPanel = document.getElementById("collab-chat");
  const chatToggle = document.getElementById("btn-collab-chat");
  const chatClose = document.getElementById("chat-close");
  const chatLog = document.getElementById("chat-log");
  const chatInput = document.getElementById("chat-input");
  const chatSend = document.getElementById("chat-send");
  const chatBadge = document.getElementById("chat-badge");
  const ME_ID = Number(stage.dataset.meId || 0);
  const CAN_CHAT = stage.dataset.canChat === "1";

  let chatUnread = 0;
  let chatOpen = false;
  const seenMsgIds = new Set();

  function avatarMarkup(av) {
    if (!av) return "";
    if (av.photo) {
      return '<img src="' + escapeHtml(av.photo) + '" alt="' +
             escapeHtml(av.name) + '">';
    }
    return '<span class="kk-avatar-ini">' + escapeHtml(av.initials || "?") + "</span>";
  }

  function setCollaboratorOnline(av, online) {
    if (!collabRail || !av) return;
    let el = collabRail.querySelector('[data-uid="' + av.id + '"]');
    if (!el) {
      // A collaborator we didn't render server-side (rare) — add them now.
      el = document.createElement("span");
      el.className = "kk-collab" + (av.is_owner ? " is-owner" : "");
      el.dataset.uid = String(av.id);
      el.style.setProperty("--av", av.color || "#6366f1");
      el.title = av.name + (av.is_owner ? " · Owner" : "");
      el.innerHTML = avatarMarkup(av) +
        '<span class="kk-collab-dot" aria-hidden="true"></span>';
      // Owners stay first.
      if (av.is_owner) collabRail.prepend(el);
      else collabRail.appendChild(el);
    }
    el.classList.toggle("is-online", online);
  }

  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function renderMessage(m) {
    if (!chatLog) return;
    if (m.id && seenMsgIds.has(m.id)) return;
    if (m.id) seenMsgIds.add(m.id);
    const mine = m.user_id && ME_ID && Number(m.user_id) === ME_ID;
    const row = document.createElement("div");
    row.className = "kk-chat-msg" + (mine ? " is-mine" : "");
    const av = m.avatar;
    const avEl = document.createElement("span");
    avEl.className = "kk-chat-av";
    avEl.style.setProperty("--av", (av && av.color) || "#6366f1");
    avEl.innerHTML = avatarMarkup(av || { initials: (m.author || "?")[0] });
    const bubble = document.createElement("div");
    bubble.className = "kk-chat-bubble";
    bubble.innerHTML =
      '<span class="kk-chat-who">' + escapeHtml(m.author || "Someone") +
      (av && av.is_owner ? ' <i class="bi bi-star-fill" title="Owner"></i>' : "") +
      '</span>' +
      '<span class="kk-chat-text">' + escapeHtml(m.body || "") + "</span>" +
      '<span class="kk-chat-time">' + fmtTime(m.ts) + "</span>";
    if (mine) row.append(bubble, avEl);
    else row.append(avEl, bubble);
    chatLog.appendChild(row);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function chatSeed(list) {
    if (!chatLog) return;
    chatLog.innerHTML = "";
    seenMsgIds.clear();
    (list || []).forEach((m) => renderMessage(m));
    if (!list || !list.length) {
      chatLog.innerHTML =
        '<p class="kk-chat-empty">No messages yet. Say hello to your team \u{1F44B}</p>';
    }
  }

  function chatAppend(m, live) {
    const empty = chatLog && chatLog.querySelector(".kk-chat-empty");
    if (empty) empty.remove();
    renderMessage(m);
    if (live && !chatOpen && !(m.user_id && ME_ID && Number(m.user_id) === ME_ID)) {
      chatUnread += 1;
      reflectChatBadge();
    }
  }

  function chatNotice(text) {
    if (!chatLog) return;
    const p = document.createElement("p");
    p.className = "kk-chat-notice";
    p.textContent = text;
    chatLog.appendChild(p);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function reflectChatBadge() {
    if (!chatBadge) return;
    chatBadge.textContent = chatUnread > 9 ? "9+" : String(chatUnread);
    chatBadge.style.display = chatUnread > 0 ? "" : "none";
  }

  function openChat() {
    if (!chatPanel) return;
    chatOpen = true;
    chatPanel.classList.add("is-open");
    chatUnread = 0;
    reflectChatBadge();
    if (chatInput) chatInput.focus();
  }
  function closeChat() {
    chatOpen = false;
    if (chatPanel) chatPanel.classList.remove("is-open");
  }

  function sendChat() {
    if (!chatInput) return;
    const body = chatInput.value.trim();
    if (!body) return;
    send({ type: "chat", body });
    chatInput.value = "";
    chatInput.focus();
  }

  function initCollab() {
    // Mark already-rendered collaborators (from the server) so presence
    // can toggle their dot; the current user shows as online immediately.
    if (collabRail && ME_ID) {
      const meEl = collabRail.querySelector('[data-uid="' + ME_ID + '"]');
      if (meEl) meEl.classList.add("is-online");
    }
    if (chatToggle) chatToggle.addEventListener("click", () => {
      chatOpen ? closeChat() : openChat();
    });
    if (chatClose) chatClose.addEventListener("click", closeChat);
    if (chatSend) chatSend.addEventListener("click", sendChat);
    if (chatInput) {
      chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
      });
    }
    // Guests (non-collaborators) can't post — soften the composer.
    if (!CAN_CHAT && chatPanel) {
      chatPanel.classList.add("is-readonly");
      if (chatInput) {
        chatInput.disabled = true;
        chatInput.placeholder = "Only board collaborators can chat";
      }
      if (chatSend) chatSend.disabled = true;
    }
    reflectChatBadge();
  }

  // ════════════════════════════════════════════════════════════════════
  //  Header dropdown menus — Tools (drawing) and Options (board controls).
  //  Keeps the header compact: each menu is a trigger + a popover panel.
  // ════════════════════════════════════════════════════════════════════
  function initMenus() {
    const menus = Array.from(document.querySelectorAll(".kk-menu"));
    if (!menus.length) return;

    function closeAll(except) {
      menus.forEach((m) => {
        if (m === except) return;
        m.classList.remove("is-open");
        const t = m.querySelector(".kk-menu-trigger");
        if (t) t.setAttribute("aria-expanded", "false");
      });
    }

    menus.forEach((menu) => {
      const trigger = menu.querySelector(".kk-menu-trigger");
      const panel = menu.querySelector(".kk-menu-panel");
      if (!trigger || !panel) return;

      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        const willOpen = !menu.classList.contains("is-open");
        closeAll(menu);
        menu.classList.toggle("is-open", willOpen);
        trigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
      });

      // A click on a menu item runs its own handler (wired elsewhere); we
      // just close the menu afterwards. The limit box steppers are an
      // exception — they keep the menu open so the presenter can tap +/−
      // repeatedly.
      panel.addEventListener("click", (e) => {
        if (e.target.closest(".kk-limit-box")) return;
        if (e.target.closest(".kk-menu-item")) {
          // Defer the close so the item's own click handler fires first.
          setTimeout(() => {
            menu.classList.remove("is-open");
            trigger.setAttribute("aria-expanded", "false");
          }, 0);
        }
      });
    });

    // Outside click / Escape closes any open menu.
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".kk-menu")) closeAll(null);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAll(null);
    });
  }

  function init() {
    layout = "grid";
    const active = layoutBtns.find((b) => b.classList.contains("is-active"));
    if (active) layout = active.dataset.layout;

    if (powerBtn) powerBtn.addEventListener("click", togglePower);
    if (stopBtn) stopBtn.addEventListener("click", endSession);

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

    if (btnLockColumns) btnLockColumns.addEventListener("click", toggleLock);

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
    initQRModal();
    reflectPower();
    renderAddColumn();
    initTools();
    initStylePicker();
    initCollab();
    initMenus();
    initTitleEdit();
    connect();

    // Re-fit note text when the viewport changes — column widths and the
    // pad height shift on resize, so the largest font that fits changes too.
    let fitResizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(fitResizeTimer);
      fitResizeTimer = setTimeout(fitAllNotes, 150);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();