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
  const btnLockColumns = document.getElementById("btn-lock-columns");
  const btnFullscreen = document.getElementById("btn-fullscreen");

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
      const head = document.createElement("div");
      head.className = "kk-board-column-head";

      const nameEl = document.createElement("span");
      nameEl.className = "kk-col-name";
      nameEl.textContent = name;

      const count = document.createElement("span");
      count.className = "count";
      count.textContent = String(list.length);

      if (gid != null) {
        // Real column: clicking the name turns it into an input; the
        // button beside it deletes the whole column.
        nameEl.classList.add("is-editable");
        nameEl.title = "Click to rename this column";
        nameEl.dataset.gid = String(gid);
        nameEl.tabIndex = 0;

        const del = document.createElement("button");
        del.type = "button";
        del.className = "kk-col-delete";
        del.dataset.gid = String(gid);
        del.title = "Delete this column";
        del.innerHTML = '<i class="bi bi-trash"></i>';

        head.append(nameEl, count, del);
      } else {
        head.append(nameEl, count);
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
      if (lockColumns) { e.preventDefault(); return; }
      const noteEl = e.target.closest(".kk-note");
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
      dragNoteId = null;
    });

    columnsWrap.addEventListener("dragover", (e) => {
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
    // If the presenter has drawn on the board, capture the whole canvas
    // (which includes the draw overlay); otherwise just the sheet.
    const target = drawStrokes.length ? boardCanvas : boardSheet;
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
      return await html2canvas(target, {
        backgroundColor: "#ffffff",
        scale,
        useCORS: true,
        logging: false,
        width: fullW,
        height: fullH,
        windowWidth: fullW,
        windowHeight: fullH,
        scrollX: 0,
        scrollY: 0,
      });
    } finally {
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