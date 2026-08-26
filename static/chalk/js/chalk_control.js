/* Chalk — the phone. Every mark and every object on the board starts here.
 *
 * Two input modes share one pad. In a drawing tool the pad captures ink; in
 * "Pick" it selects and drags elements. The selection overlay sits above the
 * pad and swallows its own gestures, so the two never fight over a finger.
 */
(function () {
  "use strict";

  var CFG = JSON.parse(document.getElementById("chalk-config").textContent);

  var pad = document.getElementById("pad");
  var padWrap = document.getElementById("pad-wrap");
  var elsHost = document.getElementById("els");
  var mini = document.getElementById("mini");
  var miniWin = document.getElementById("mini-win");
  var dot = document.getElementById("net-dot");
  var statusText = document.getElementById("net-text");
  var pageTag = document.getElementById("page-tag");
  var widthInput = document.getElementById("width");
  var widthDots = document.getElementById("width-preview");
  var customColor = document.getElementById("custom-color");
  var expired = document.getElementById("expired");
  var expiredWhy = document.getElementById("expired-why");
  var expiredRetry = document.getElementById("expired-retry");
  var inspector = document.getElementById("inspector");
  var inspToggle = document.getElementById("insp-toggle");
  var inspectorBody = document.getElementById("inspector-body");
  var inspectorName = document.getElementById("inspector-name");
  var sheet = document.getElementById("sheet");
  var sheetBody = document.getElementById("sheet-body");
  var sheetTitle = document.getElementById("sheet-title");
  var photoInput = document.getElementById("photo-input");
  var toast = document.getElementById("toast");
  var marquee = document.getElementById("marquee");
  var inkBar = document.getElementById("ink-bar");
  var inkCount = document.getElementById("ink-count");
  var goFs = document.getElementById("go-fs");
  var toolsToggle = document.getElementById("tools-toggle");

  var surface = new ChalkInk.Surface(pad);
  /* No chalk stick on the pad: a finger is already covering that spot, and a
   * sprite under it is one more thing in the way. It belongs on the wall. */
  surface.setWriter(false);
  surface.setStrokes(CFG.strokes || []);
  var layer = new ChalkEls.Layer(elsHost);
  layer.setEls(CFG.els || []);

  var state = {
    tool: "pen",
    color: "#ffffff",
    colorPinned: false,  // did the teacher choose this colour deliberately?
    width: 0.0038,       // normalised: fraction of board width
    zoom: 1,
    view: { x: 0, y: 0, s: 1 },
    pageIndex: CFG.pageIndex,
    pageCount: CFG.pageCount,
    surface: CFG.surface
  };

  var MIN_STEP = 0.0012;    // normalised distance before a point is worth sending
  /* Server-side cap is 12000 values. Break the stroke well before that so a
   * very long line is continued as a second stroke rather than silently
   * truncated on commit — which used to leave the projector and the database
   * disagreeing until the next reload. */
  var MAX_STROKE_VALS = 8000;

  var live = null;          // current stroke being drawn
  var pending = [];         // points captured since the last frame
  var erased = {};          // ids removed this gesture
  var activePointer = null; // the one pointer we are listening to

  /* ------------------------------------------------------------------ */
  /* socket                                                              */
  /* ------------------------------------------------------------------ */

  var net = ChalkNet(CFG.code, {
    onOpen: function () {
      /* "control" is the teacher's paired phone; "join" is a colleague or a
       * student signed in to Knock-Knock. The view decides which this page
       * is, because it is the only side that knows how the person got here. */
      net.send({ t: "hello", role: CFG.role === "join" ? "join" : "control",
                 token: CFG.token || "" });
    },
    onState: function (s) {
      dot.dataset.state = s;
      statusText.textContent =
        s === "live" ? "Board connected" :
        s === "offline" ? "Reconnecting…" :
        s === "denied" ? "Not paired" : "Connecting…";
      document.body.dataset.net = s;
      if (s === "live" && !expired.hidden) expired.hidden = true;
    },
    onDenied: function (m) {
      /* Show WHY. Every denial used to render the same "Pairing expired",
       * which made a lost token indistinguishable from a rotated code or a
       * handshake that never completed. */
      expiredWhy.textContent = m.reason || "This phone is not paired with the board.";
      expired.dataset.code = m.code || "denied";
      expired.hidden = false;
    },
    onMessage: handle
  });

  /* Timeout — see chalk_arcade.js. The controller becomes a gamepad when a
   * game is running and goes back to being a board when it is not. */
  window.ChalkBoard = { net: net, cfg: CFG, role: CFG.role === "join" ? "join" : "control" };

  if (expiredRetry) {
    expiredRetry.addEventListener("click", function () { location.reload(); });
  }

  function handle(m) {
    switch (m.t) {
      case "ready":
        if (m.role === "join") welcomeGuest(m.me);
        /* falls through */
      case "snapshot":
        surface.setStrokes(m.strokes || []);
        layer.setEls(m.els || []);
        clearInk();
        /* Keep the selection only if that element survived the page change. */
        editor.select(layer.get(editor.selected) ? editor.selected : null);
        setPage(m.pageIndex, m.pageCount);
        setSurfaceButtons(m.surface);
        setHistory(m.canUndo, m.canRedo);
        break;
      /* Another paired device is drawing. The phone used to ignore these
       * entirely, so a second controller's ink was invisible here until the
       * next page change. */
      case "stroke_start": surface.begin(m.stroke); break;
      case "stroke_pts":   surface.extend(m.id, m.pts); break;
      case "stroke_end":   surface.commit(m.stroke); break;
      case "erase":
        surface.remove(m.ids);
        setHistory(m.canUndo, m.canRedo);
        if (inkIds.length && m.ids.some(inSelection)) reboxInk();
        break;
      /* Another paired device is moving ink. Same treatment as stroke_pts:
       * follow it live, store nothing. */
      case "ink_band":
        surface.setBand(m.ids, m.front);
        break;
      /* Somebody else grouped or ungrouped. Only the label changes — nothing
       * moves, nothing redraws — but this phone has to agree about what one
       * thing is, or tapping the photo here would pick up half a diagram. */
      case "group":
        (m.ink || []).forEach(function (id) {
          var st = surface.byId(id);
          if (st) st.gid = m.gid;
        });
        (m.els || []).forEach(function (id) { layer.patch(id, { gid: m.gid }); });
        break;
      case "ink_live":
        surface.xform(m.sel, m.ids, m.m);
        break;
      case "ink":
        surface.applyOps(m.add, m.del, m.xform);
        setHistory(m.canUndo, m.canRedo);
        /* Re-read the box rather than dropping the selection. Strokes come
         * and go for reasons that have nothing to do with what is picked —
         * an undone wipe, and now the echo of your own paste, which used to
         * clear the very selection the paste had just made. reboxInk drops
         * ids that really did vanish and clears out if none are left. */
        reboxInk();
        break;
      case "els":
        layer.applyOps(m.add, m.del, m.edit);
        setHistory(m.canUndo, m.canRedo);
        afterElChange();
        break;
      case "el_add":
        layer.upsert(m.el);
        setHistory(m.canUndo, m.canRedo);
        break;
      case "el_live":
      case "el_update":
        layer.patch(m.id, m.patch);
        setHistory(m.canUndo, m.canRedo);
        if (editor.selected === m.id) afterElChange();
        break;
      case "el_delete":
        layer.remove(m.ids);
        setHistory(m.canUndo, m.canRedo);
        if (m.ids.indexOf(editor.selected) !== -1) editor.select(null);
        reboxInk();
        break;
      case "el_raise": layer.raise(m.id); editor.refresh(); break;
      case "surface": setSurfaceButtons(m.surface); break;
      case "game":    if (window.ChalkArcade) ChalkArcade.frame(m); break;
      case "denied":  break;  // handled in onDenied
    }
  }

  function inSelection(id) { return inkIds.indexOf(id) !== -1; }

  /* ------------------------------------------------------------------ */
  /* drawing                                                             */
  /* ------------------------------------------------------------------ */

  pad.style.touchAction = "none";

  pad.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    /* One pointer at a time. A palm or a second finger used to overwrite
     * `live`, orphaning the first stroke: it never got a stroke_end, so it
     * stuck on the live layer here AND on the projector until reload. */
    if (activePointer !== null) return;

    if (state.tool === "fill") {
      var cp = surface.toBoard(e.clientX, e.clientY);
      colourIn(layer.hit(cp.x, cp.y));
      return;
    }

    if (state.tool === "grab") {
      if (startGrab(e)) e.preventDefault();
      else say("Press on writing or an object to move it.");
      return;
    }

    if (state.tool === "duster") {
      activePointer = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      var dp = surface.toBoard(e.clientX, e.clientY);
      duster = { gid: newSel(), path: [r4(dp.x), r4(dp.y)], sentAt: 0 };
      showDuster(dp.x, dp.y);
      flushDuster(true);
      return;
    }

    if (state.tool === "select") {
      /* Objects first, then handwriting, then a lasso. No capture for the
       * first two: the selection overlay handles the drag from here, and
       * capturing would steal it back. */
      var sp = surface.toBoard(e.clientX, e.clientY);
      var elHit = layer.hit(sp.x, sp.y);
      if (elHit) {
        if (inkAdd) selectMany(inkIds, withId(elIds, elHit));
        else selectMany([], [elHit]);
        return;
      }
      var inkHit = surface.hit(sp.x, sp.y, 0.014 / state.view.s);
      if (inkHit) {
        if (inkAdd) selectMany(withId(inkIds, inkHit), elIds);
        else selectMany([inkHit], []);
        return;
      }
      /* Bare board: drag a box round whatever you want to pick up. */
      activePointer = e.pointerId;
      pad.setPointerCapture(e.pointerId);
      lasso = { from: sp, to: sp };
      placeMarquee(lassoRect());
      marquee.hidden = false;
      return;
    }

    activePointer = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    var p = surface.toBoard(e.clientX, e.clientY);

    if (state.tool === "laser") {
      net.send({ t: "pointer", x: p.x, y: p.y, on: true }, true);
      return;
    }
    if (state.tool === "eraser") {
      erased = {};
      eraseAt(p);
      return;
    }

    startStroke(p);
  });

  function startStroke(p) {
    live = {
      id: ChalkInk.newId(),
      tool: state.tool,
      color: state.color,
      w: state.width,
      pts: [round(p.x), round(p.y)]
    };
    pending = [];
    surface.begin(live);
    net.send({ t: "stroke_start", stroke: live }, true);
  }

  /* Commit the current stroke and immediately open a new one at the same
   * point, so a very long line stays under the server's per-stroke cap
   * without a visible break. */
  function splitStroke() {
    var n = live.pts.length;
    var tail = { x: live.pts[n - 2], y: live.pts[n - 1] };
    endStroke();
    startStroke(tail);
  }

  pad.addEventListener("pointermove", function (e) {
    if (state.tool === "grab") {
      if (grab && e.pointerId === activePointer) {
        e.preventDefault();
        moveGrab(e);
      }
      return;
    }
    if (state.tool === "duster") {
      if (!duster || e.pointerId !== activePointer) return;
      e.preventDefault();
      var dp = surface.toBoard(e.clientX, e.clientY);
      duster.path.push(r4(dp.x), r4(dp.y));
      if (duster.path.length > 240) duster.path = duster.path.slice(-240);
      showDuster(dp.x, dp.y);
      flushDuster(false);
      return;
    }
    if (state.tool === "fill") return;
    if (state.tool === "select") {
      if (lasso && e.pointerId === activePointer) {
        e.preventDefault();
        lasso.to = surface.toBoard(e.clientX, e.clientY);
        placeMarquee(lassoRect());
      }
      return;
    }
    if (activePointer !== null && e.pointerId !== activePointer) return;
    var events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];

    if (state.tool === "laser") {
      var lp = surface.toBoard(e.clientX, e.clientY);
      net.send({ t: "pointer", x: lp.x, y: lp.y, on: true }, true);
      return;
    }
    if (state.tool === "eraser") {
      if (e.buttons === 0 && e.pointerType === "mouse") return;
      if (activePointer === null) return;
      events.forEach(function (ev) { eraseAt(surface.toBoard(ev.clientX, ev.clientY)); });
      return;
    }
    if (!live) return;

    events.forEach(function (ev) {
      if (!live) return;
      var p = surface.toBoard(ev.clientX, ev.clientY);
      var n = live.pts.length;
      var dx = p.x - live.pts[n - 2], dy = p.y - live.pts[n - 1];
      if (Math.hypot(dx, dy) < MIN_STEP / state.view.s) return;
      var rx = round(p.x), ry = round(p.y);
      live.pts.push(rx, ry);
      pending.push(rx, ry);
      if (live.pts.length >= MAX_STROKE_VALS) splitStroke();
    });
    surface._liveDirty = true;
    schedule();
  });

  /* `pointerleave` is deliberately not in this list. With pointer capture in
   * use it fires spuriously mid-gesture, and when it did the stroke committed
   * early and the rest of the movement was dropped in silence. */
  ["pointerup", "pointercancel"].forEach(function (type) {
    pad.addEventListener(type, function (e) {
      if (state.tool === "grab") {
        if (grab && e.pointerId === activePointer) {
          endGrab(type === "pointercancel");
        }
        return;
      }
      if (state.tool === "duster") {
        if (duster) {
          if (type !== "pointercancel") flushDuster(true);
          duster = null;
          activePointer = null;
        }
        hideDuster();
        return;
      }
      if (state.tool === "fill") return;
      if (state.tool === "select") {
        if (lasso && e.pointerId === activePointer) {
          endLasso(type === "pointercancel");
          activePointer = null;
        }
        return;
      }
      if (activePointer !== null && e.pointerId !== activePointer) return;
      activePointer = null;

      if (state.tool === "laser") {
        net.send({ t: "pointer", x: 0, y: 0, on: false }, true);
        return;
      }
      if (state.tool === "eraser") {
        var ids = Object.keys(erased);
        erased = {};
        if (ids.length) net.send({ t: "erase", ids: ids });
        return;
      }
      if (!live) return;
      if (type === "pointercancel") {
        /* The gesture was taken away from us (system swipe, call). Drop the
         * stroke rather than committing a half one. */
        surface.abandon(live.id);
        net.send({ t: "erase", ids: [live.id] });
        live = null;
        pending = [];
        return;
      }
      endStroke();
    });
  });

  function endStroke() {
    if (!live) return;
    flush();
    var done = live;
    live = null;
    pending = [];
    surface.commit(done);
    net.send({ t: "stroke_end", stroke: done });
    setHistory(true, false);
    autoAdvance(done);
  }

  var frame = null;
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(function () { frame = null; flush(); });
  }
  function flush() {
    if (!live || !pending.length) return;
    /* The pad's own surface has to be told, exactly like the projector is.
     * `surface.begin` takes a COPY of the stroke, so pushing points onto
     * `live.pts` here does not reach the copy being painted — and the phone
     * showed nothing at all until the finger came up and the stroke was
     * committed, while the wall drew it live off these same frames. */
    surface.extend(live.id, pending);
    net.send({ t: "stroke_pts", id: live.id, pts: pending }, true);
    pending = [];
  }

  function eraseAt(p) {
    var id = surface.hit(p.x, p.y, 0.012 / state.view.s);
    if (id && !erased[id]) {
      erased[id] = 1;
      surface.remove([id]);
    }
  }

  function round(v) { return Math.round(v * 10000) / 10000; }

  /* When you write near the right edge of a zoomed pad, slide the window
   * along so you can keep writing without reaching for the map. */
  function autoAdvance(stroke) {
    if (state.view.s <= 1) return;
    var lastX = stroke.pts[stroke.pts.length - 2];
    var lastY = stroke.pts[stroke.pts.length - 1];
    var right = state.view.x + 1 / state.view.s;
    var bottom = state.view.y + 1 / state.view.s;
    if (lastX > right - 0.12 / state.view.s) {
      if (right >= 0.999) {
        /* Already at the right edge — wrap down to the next line instead of
         * refusing to move. */
        if (bottom < 0.999) panTo(0, state.view.y + 0.6 / state.view.s);
      } else {
        panTo(state.view.x + 0.55 / state.view.s, state.view.y);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* zoom window                                                         */
  /* ------------------------------------------------------------------ */

  function clampView(x, y, s) {
    var span = 1 / s;
    return {
      x: Math.min(Math.max(0, x), Math.max(0, 1 - span)),
      y: Math.min(Math.max(0, y), Math.max(0, 1 - span)),
      s: s
    };
  }

  function applyView() {
    surface.setView(state.view);
    layer.setView(state.view);
    inkAdapter.view = state.view;
    editor.refresh();
    inkEditor.refresh();
    if (lasso) placeMarquee(lassoRect());
    drawMini();
  }

  function panTo(x, y) {
    state.view = clampView(x, y, state.view.s);
    applyView();
  }

  function setZoom(s) {
    var cx = state.view.x + 0.5 / state.view.s;
    var cy = state.view.y + 0.5 / state.view.s;
    state.zoom = s;
    state.view = clampView(cx - 0.5 / s, cy - 0.5 / s, s);
    document.querySelectorAll("[data-zoom]").forEach(function (b) {
      var on = Number(b.dataset.zoom) === s;
      b.dataset.on = String(on);
      b.setAttribute("aria-pressed", String(on));
    });
    mini.hidden = s === 1;
    applyView();
  }

  function drawMini() {
    if (mini.hidden) return;
    var span = 100 / state.view.s;
    miniWin.style.left = (state.view.x * 100) + "%";
    miniWin.style.top = (state.view.y * 100) + "%";
    miniWin.style.width = span + "%";
    miniWin.style.height = span + "%";
  }

  document.querySelectorAll("[data-zoom]").forEach(function (b) {
    b.addEventListener("click", function () { setZoom(Number(b.dataset.zoom)); });
  });

  var miniDrag = false;
  function miniMove(e) {
    var r = mini.getBoundingClientRect();
    var half = 0.5 / state.view.s;
    panTo((e.clientX - r.left) / r.width - half, (e.clientY - r.top) / r.height - half);
  }
  mini.addEventListener("pointerdown", function (e) {
    miniDrag = true; mini.setPointerCapture(e.pointerId); miniMove(e);
  });
  mini.addEventListener("pointermove", function (e) { if (miniDrag) miniMove(e); });
  /* pointercancel and pointerleave were missing, so an interrupted drag left
   * the mini-map stuck to the finger. */
  ["pointerup", "pointercancel", "pointerleave"].forEach(function (type) {
    mini.addEventListener(type, function () { miniDrag = false; });
  });

  /* ------------------------------------------------------------------ */
  /* tools, colours, width                                               */
  /* ------------------------------------------------------------------ */

  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll("[data-tool]").forEach(function (b) {
      var on = b.dataset.tool === tool;
      b.dataset.on = String(on);
      b.setAttribute("aria-pressed", String(on));
    });
    padWrap.dataset.tool = tool;
    if (tool !== "duster" && duster) {
      duster = null;
      hideDuster();
    }
    if (tool !== "grab" && grab) endGrab(true);
    /* Grab keeps whatever is picked, because pressing a picked thing moves
     * the whole selection. Every other tool drops it. */
    if (tool !== "select" && tool !== "grab") {
      editor.select(null);
      clearInk();
    }
  }

  document.querySelectorAll("[data-tool]").forEach(function (b) {
    b.addEventListener("click", function () { setTool(b.dataset.tool); });
  });

  function setColor(hex, pinned) {
    state.color = hex;
    if (pinned) state.colorPinned = true;
    document.querySelectorAll("[data-color]").forEach(function (b) {
      var on = b.dataset.color.toLowerCase() === hex.toLowerCase();
      b.dataset.on = String(on);
      b.setAttribute("aria-pressed", String(on));
    });
    document.documentElement.style.setProperty("--pick", hex);
    if (state.tool === "eraser" || state.tool === "laser" || state.tool === "select") {
      setTool("pen");
    }
  }

  document.querySelectorAll("[data-color]").forEach(function (b) {
    b.addEventListener("click", function () { setColor(b.dataset.color, true); });
  });
  customColor.addEventListener("input", function () {
    setColor(customColor.value, true);
  });

  widthInput.addEventListener("input", function () {
    /* 1..100 slider -> 0.001..0.02 of board width, curved so the thin end
     * has room to be precise. */
    var t = Number(widthInput.value) / 100;
    state.width = 0.001 + Math.pow(t, 2) * 0.019;
    widthDots.style.setProperty("--w", (4 + t * t * 46) + "px");
  });
  widthInput.dispatchEvent(new Event("input"));


  /* ------------------------------------------------------------------ */
  /* objects: select, insert, inspect                                    */
  /* ------------------------------------------------------------------ */

  var editor = ChalkEdit(padWrap, layer, {
    /* Continuous during a drag: broadcast so the class sees it move, but
     * nothing is written until the finger lifts. */
    live: function (id, patch) { net.send({ t: "el_live", id: id, patch: patch }, true); },
    commit: function (id, patch) { net.send({ t: "el_update", id: id, patch: patch }); },
    select: function () { renderInspector(); }
  });

  /* Colouring in.
   *
   * Tap a shape and it takes the current colour. That is the whole tool.
   * Flood-filling a scribble is not on the table — ink is vector strokes,
   * not pixels, and there are no regions to flood — but every ready-made
   * drawing is built from closed shapes, so tapping inside a petal fills
   * that petal. Tapping a shape that already holds this colour clears it,
   * so a wrong colour is one tap to undo rather than a hunt for Undo. */
  function colourIn(id) {
    if (!id) return say("Tap a shape or a drawing to colour it in.");
    var el = layer.get(id);
    if (!el) return;
    var patch;
    if (el.type === "image") return say("A photo already has its own colours.");
    if (el.type === "text") {
      patch = { color: state.color };
    } else if (el.fillOn &&
               String(el.fill || "").toLowerCase() === state.color.toLowerCase()) {
      patch = { fillOn: false };
    } else {
      patch = { fillOn: true, fill: state.color };
    }
    layer.patch(id, patch);
    editor.refresh();
    net.send({ t: "el_update", id: id, patch: patch });
  }

  /* ------------------------------------------------------------------ */
  /* copy, paste, duplicate                                              */
  /*                                                                     */
  /* The clipboard holds deep copies taken at the moment of copying, so a  */
  /* paste is what was copied even if the original has since been moved,   */
  /* recoloured or deleted. It outlives page changes: copying a heading on  */
  /* page one and pasting it on page four is the whole point.              */
  /* ------------------------------------------------------------------ */

  var clip = null;          // { els: [...], strokes: [...] }
  var pasteRun = 0;         // how far to nudge the next paste across
  var pasteBtn = document.getElementById("paste");

  function deepCopy(v) { return JSON.parse(JSON.stringify(v)); }

  function copySelection(elList, inkList) {
    var els = (elList || []).map(function (id) {
      var el = layer.get(id);
      return el ? deepCopy(el) : null;
    }).filter(Boolean);
    var strokes = (inkList || []).map(function (id) {
      var st = surface.byId(id);
      return st ? deepCopy(st) : null;
    }).filter(Boolean);
    if (!els.length && !strokes.length) return false;
    clip = { els: els, strokes: strokes };
    pasteRun = 0;
    pasteBtn.disabled = false;
    return true;
  }

  /* Where a paste lands. Each successive paste of the same clipboard steps
   * further down and across, so pasting five times gives five visible
   * copies rather than one pile. */
  function pasteOffset(bounds) {
    var step = 0.022 * (pasteRun + 1);
    var dx = step, dy = step * 16 / 9;
    /* Do not walk it off the edge of the board — wrap back to the top left
     * once the cascade runs out of room. */
    if (bounds.x + bounds.w + dx > 1.05 || bounds.y + bounds.h + dy > 1.05) {
      pasteRun = 0;
      dx = 0.022;
      dy = 0.022 * 16 / 9;
    }
    return { dx: dx, dy: dy };
  }

  function clipBounds(c) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    c.els.forEach(function (el) {
      x0 = Math.min(x0, el.x); y0 = Math.min(y0, el.y);
      x1 = Math.max(x1, el.x + el.w); y1 = Math.max(y1, el.y + el.h);
    });
    c.strokes.forEach(function (st) {
      for (var i = 0; i < st.pts.length; i += 2) {
        x0 = Math.min(x0, st.pts[i]); x1 = Math.max(x1, st.pts[i]);
        y0 = Math.min(y0, st.pts[i + 1]); y1 = Math.max(y1, st.pts[i + 1]);
      }
    });
    if (x0 === Infinity) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function pasteClip() {
    if (!clip) return say("Copy something first.");
    var bounds = clipBounds(clip);
    if (!bounds) return;
    var off = pasteOffset(bounds);
    pasteRun++;

    /* A copied group becomes its own group rather than joining the original:
     * two diagrams that move as one whenever either is touched is not what
     * anybody means by "duplicate". */
    var gidMap = Object.create(null);

    var els = clip.els.map(function (src) {
      var el = deepCopy(src);
      el.id = ChalkEls.newId();
      el.x = r4(el.x + off.dx);
      el.y = r4(el.y + off.dy);
      if (el.gid) {
        if (!gidMap[el.gid]) gidMap[el.gid] = "g" + ChalkEls.newId();
        el.gid = gidMap[el.gid];
      }
      return el;
    });

    var strokes = clip.strokes.map(function (src) {
      var st = deepCopy(src);
      st.id = ChalkInk.newId();
      /* Through the same map as the objects, so a copied diagram stays one
       * diagram — a new one, not a second handle on the original. */
      if (st.gid) {
        if (!gidMap[st.gid]) gidMap[st.gid] = "g" + ChalkEls.newId();
        st.gid = gidMap[st.gid];
      }
      var pts = st.pts.slice();
      for (var i = 0; i < pts.length; i += 2) {
        pts[i] = r4(pts[i] + off.dx);
        pts[i + 1] = r4(pts[i + 1] + off.dy);
      }
      st.pts = pts;
      return st;
    });

    els.forEach(function (el) { layer.upsert(el); });
    strokes.forEach(function (st) { surface.commit(st); });
    net.send({ t: "paste", els: els, strokes: strokes });
    setHistory(true, false);

    setTool("select");
    selectMany(
      strokes.map(function (st) { return st.id; }),
      els.map(function (el) { return el.id; })
    );
    var n = els.length + strokes.length;
    say("Pasted " + n + (n === 1 ? " piece." : " pieces."));
  }

  function duplicateSelection(elList, inkList) {
    if (!copySelection(elList, inkList)) return;
    pasteClip();
  }

  document.getElementById("sel-copy").addEventListener("click", function () {
    if (copySelection(elIds, inkIds)) {
      say("Copied. Paste it here or on any other page.");
    }
  });
  document.getElementById("sel-dupe").addEventListener("click", function () {
    duplicateSelection(elIds, inkIds);
  });
  document.getElementById("el-copy").addEventListener("click", function () {
    if (editor.selected && copySelection([editor.selected], [])) {
      say("Copied. Paste it here or on any other page.");
    }
  });
  document.getElementById("el-dupe").addEventListener("click", function () {
    if (editor.selected) duplicateSelection([editor.selected], []);
  });
  pasteBtn.addEventListener("click", pasteClip);

  /* The controller is usually a phone, but it is a web page, so anyone
   * driving it from a laptop gets the shortcuts they already expect. */
  document.addEventListener("keydown", function (e) {
    if (!(e.metaKey || e.ctrlKey)) return;
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" ||
              t.isContentEditable)) return;
    var key = String(e.key || "").toLowerCase();
    if (key === "c") {
      var picked = editor.selected ? [editor.selected] : elIds;
      if (copySelection(picked, editor.selected ? [] : inkIds)) {
        e.preventDefault();
        say("Copied.");
      }
    } else if (key === "v") {
      if (!clip) return;
      e.preventDefault();
      pasteClip();
    } else if (key === "d") {
      var dup = editor.selected ? [editor.selected] : elIds;
      if (!dup.length && !inkIds.length) return;
      e.preventDefault();
      duplicateSelection(dup, editor.selected ? [] : inkIds);
    }
  });

  /* ------------------------------------------------------------------ */
  /* the grab tool                                                       */
  /*                                                                     */
  /* Press on a thing and drag it. No box, no handles, no selection left  */
  /* behind — the one gesture that does nothing but move. Pick is for     */
  /* choosing what to work on; this is for shoving a heading two inches   */
  /* left in the middle of a lesson without first choosing it.            */
  /*                                                                     */
  /* Three rules about what comes along:                                  */
  /*   - press something already picked and the whole selection moves;    */
  /*   - press one object of a group and the group moves;                 */
  /*   - otherwise just the one thing under the finger.                   */
  /* ------------------------------------------------------------------ */

  var grab = null;
  var grabSentAt = 0;

  function startGrab(e) {
    var p = surface.toBoard(e.clientX, e.clientY);
    var elHit = layer.hit(p.x, p.y);
    var inkHit = elHit ? null : surface.hit(p.x, p.y, 0.014 / state.view.s);
    if (!elHit && !inkHit) return false;

    var takeEls, takeInk;
    var inPicked = (elHit && elIds.indexOf(elHit) !== -1) ||
                   (inkHit && inkIds.indexOf(inkHit) !== -1);
    if (inPicked) {
      takeEls = elIds.slice();
      takeInk = inkIds.slice();
    } else if (elHit) {
      takeEls = withGroups([elHit]);
      takeInk = [];
    } else {
      takeEls = [];
      takeInk = [inkHit];
    }

    var base = Object.create(null);
    takeEls.forEach(function (id) {
      var el = layer.get(id);
      if (el) base[id] = { x: el.x, y: el.y };
    });
    grab = {
      start: p, elIds: takeEls, inkIds: takeInk, base: base,
      sel: newSel(), moved: false, dx: 0, dy: 0
    };
    surface.dropXformBase();
    padWrap.dataset.grabbing = "1";
    activePointer = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    return true;
  }

  function moveGrab(e) {
    var p = surface.toBoard(e.clientX, e.clientY);
    var dx = r4(p.x - grab.start.x), dy = r4(p.y - grab.start.y);
    if (!grab.moved && Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
    grab.moved = true;
    grab.dx = dx;
    grab.dy = dy;

    if (grab.inkIds.length) {
      surface.xform(grab.sel, grab.inkIds, [1, 0, 0, 1, dx, dy]);
    }
    grab.elIds.forEach(function (id) {
      var b = grab.base[id];
      if (b) layer.patch(id, { x: r4(b.x + dx), y: r4(b.y + dy) });
    });
    editor.refresh();

    /* Same throttle as a group drag, and for the same reason: one frame per
     * object per tick walks straight into the server's flood guard. */
    var now = Date.now();
    if (now - grabSentAt < 66) return;
    grabSentAt = now;
    if (grab.inkIds.length) {
      net.send({
        t: "ink_live", sel: grab.sel, ids: grab.inkIds,
        m: [1, 0, 0, 1, dx, dy]
      }, true);
    }
    if (grab.elIds.length) {
      var items = grab.elIds.map(function (id) {
        var b = grab.base[id];
        return b && { id: id, patch: { x: r4(b.x + dx), y: r4(b.y + dy) } };
      }).filter(Boolean);
      if (items.length) net.send({ t: "el_live_many", items: items }, true);
    }
  }

  function endGrab(cancelled) {
    var g = grab;
    grab = null;
    activePointer = null;
    delete padWrap.dataset.grabbing;
    if (!g || !g.moved) return;
    if (cancelled) {
      /* Put everything back where it was rather than committing half a
       * gesture that the phone lost hold of. */
      if (g.inkIds.length) surface.xform(g.sel, g.inkIds, [1, 0, 0, 1, 0, 0]);
      g.elIds.forEach(function (id) {
        var b = g.base[id];
        if (b) layer.patch(id, { x: b.x, y: b.y });
      });
      editor.refresh();
      return;
    }

    if (g.inkIds.length) {
      /* The same translation the surface is already showing — kept on the
       * gesture rather than measured back off the ink, which would mean
       * reading the surface's private base. */
      surface.markXformDone(g.sel);
      net.send({
        t: "ink_xform", sel: g.sel, ids: g.inkIds,
        m: [1, 0, 0, 1, g.dx, g.dy]
      });
    }
    if (g.elIds.length) {
      var items = g.elIds.map(function (id) {
        var el = layer.get(id);
        return el && { id: id, patch: { x: el.x, y: el.y } };
      }).filter(Boolean);
      if (items.length) net.send({ t: "el_multi", items: items });
    }
    setHistory(true, false);
    /* If what moved was the current selection, its box has moved with it. */
    if (inkBox) reboxInk();
  }

  function afterElChange() {
    editor.refresh();
    renderInspector();
  }

  /* ------------------------------------------------------------------ */
  /* handwriting: pick it up, move it, resize it, turn it                */
  /*                                                                     */
  /* Ink is not an element and has no box of its own, so one is invented: */
  /* the bounding box of whatever is picked. ChalkEdit only ever asks a   */
  /* layer for `view`, `get` and `patch`, so a three-method stand-in gets */
  /* the same handles, the same frame and the same drag behaviour as an   */
  /* object, and every stroke follows the box as an affine map.           */
  /* ------------------------------------------------------------------ */

  var INK_ID = "__ink__";
  var inkIds = [];          // strokes currently picked
  var elIds = [];           // objects picked alongside them
  var elBase = null;        // each picked object's geometry when the drag began
  var inkBox = null;        // the box being dragged
  var inkBase = null;       // the box as it was when this gesture began
  var inkSel = "";          // gesture id — see ChalkInk.Surface.xform
  var inkAdd = false;       // does the next lasso add to the selection?
  var lasso = null;         // in-progress lasso, in board coordinates
  var selSeed = 0;
  var liveSentAt = 0;

  function newSel() {
    selSeed = (selSeed + 1) % 100000;
    return "g" + Date.now().toString(36) + selSeed.toString(36);
  }

  function withId(ids, id) {
    return ids.indexOf(id) === -1 ? ids.concat([id]) : ids;
  }

  function r6(v) { return Math.round(v * 1000000) / 1000000; }

  /* The map from the box where the gesture started to the box as it is now.
   * Scale on each axis, then rotation about the new centre. Recomputed from
   * the base every frame rather than accumulated, so a long drag cannot
   * drift a word off the line it belongs on. */
  function inkMatrix() {
    var b = inkBase, n = inkBox;
    var sx = n.w / b.w, sy = n.h / b.h;
    var rad = (n.rot || 0) * Math.PI / 180;
    var cs = Math.cos(rad), sn = Math.sin(rad);
    var a = sx * cs, c = -sy * sn, bb = sx * sn, d = sy * cs;
    var bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    var cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    return [
      r6(a), r6(bb), r6(c), r6(d),
      r6(cx - (a * bcx + c * bcy)),
      r6(cy - (bb * bcx + d * bcy))
    ];
  }

  /* An object is a box, not a point list, so it cannot follow a general
   * matrix exactly: a rotated box that is then squashed on one axis is a
   * parallelogram, and there is nowhere to put that. Centre, size and angle
   * are carried instead, which is right for every drag that is not a
   * non-uniform scale of something already turned, and close enough there. */
  function applyMatrixToEls(m) {
    if (!elBase) return [];
    var sx = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
    var sy = Math.sqrt(m[2] * m[2] + m[3] * m[3]);
    var spin = Math.atan2(m[1], m[0]) * 180 / Math.PI;
    var patches = [];
    elIds.forEach(function (id) {
      var b = elBase[id];
      if (!b) return;
      var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
      var nx = m[0] * cx + m[2] * cy + m[4];
      var ny = m[1] * cx + m[3] * cy + m[5];
      var w = Math.max(0.01, b.w * sx), h = Math.max(0.01, b.h * sy);
      var patch = {
        x: r4(nx - w / 2), y: r4(ny - h / 2), w: r4(w), h: r4(h),
        rot: Math.round(((b.rot || 0) + spin) * 10) / 10
      };
      layer.patch(id, patch);
      patches.push({ id: id, patch: patch });
    });
    return patches;
  }

  function r4(v) { return Math.round(v * 10000) / 10000; }

  var inkAdapter = {
    view: state.view,
    get: function (id) { return id === INK_ID ? inkBox : null; },
    patch: function (id, patch) {
      if (id !== INK_ID || !inkBox || !inkBase) return null;
      Object.assign(inkBox, patch);
      var m = inkMatrix();
      if (inkIds.length) surface.xform(inkSel, inkIds, m);
      applyMatrixToEls(m);
      return inkBox;
    }
  };

  var inkEditor = ChalkEdit(padWrap, inkAdapter, {
    live: function () {
      var m = inkMatrix();
      if (inkIds.length) {
        net.send({ t: "ink_live", sel: inkSel, ids: inkIds, m: m }, true);
      }
      /* Objects go out at about 15 a second rather than every frame: one
       * frame per object per tick would put a group of ten straight through
       * the server's flood guard. */
      if (elIds.length) {
        var now = Date.now();
        if (now - liveSentAt < 66) return;
        liveSentAt = now;
        var items = elIds.map(function (id) {
          var el = layer.get(id);
          return el && {
            id: id,
            patch: { x: el.x, y: el.y, w: el.w, h: el.h, rot: el.rot || 0 }
          };
        }).filter(Boolean);
        if (items.length) net.send({ t: "el_live_many", items: items }, true);
      }
    },
    commit: function () { commitInk(); },
    select: function () {}
  });
  inkEditor.box.classList.add("chalk-sel-ink");

  /* The box round a mixed selection: whatever the strokes cover, plus
   * whatever the objects cover. */
  function selectionBox() {
    var box = inkIds.length ? surface.bboxOf(inkIds) : null;
    var x0 = box ? box.x : Infinity, y0 = box ? box.y : Infinity;
    var x1 = box ? box.x + box.w : -Infinity, y1 = box ? box.y + box.h : -Infinity;
    elIds.forEach(function (id) {
      var el = layer.get(id);
      if (!el) return;
      x0 = Math.min(x0, el.x); y0 = Math.min(y0, el.y);
      x1 = Math.max(x1, el.x + el.w); y1 = Math.max(y1, el.y + el.h);
    });
    if (x0 === Infinity) return null;
    return {
      x: x0, y: y0,
      w: Math.max(0.012, x1 - x0), h: Math.max(0.012, y1 - y0)
    };
  }

  /* Everything in the same group as the ids given — handwriting and objects
   * alike. Grouping is a shared label rather than a container, so "the group"
   * is a lookup and not a tree, and a group can hold a drawn arrow, a photo
   * and a caption without any of them stopping being what they are.
   *
   * Both directions matter: touch the photo and the arrow comes too. */
  function groupOf(strokeIds, objectIds) {
    var gids = Object.create(null);
    var ink = (strokeIds || []).slice(), els = (objectIds || []).slice();

    els.forEach(function (id) {
      var el = layer.get(id);
      if (el && el.gid) gids[el.gid] = 1;
    });
    ink.forEach(function (id) {
      var st = surface.byId(id);
      if (st && st.gid) gids[st.gid] = 1;
    });

    var any = false, k;
    for (k in gids) { any = true; break; }
    if (!any) return { ink: ink, els: els };

    layer.els.forEach(function (el) {
      if (el.gid && gids[el.gid] && els.indexOf(el.id) === -1) els.push(el.id);
    });
    surface.allIds().forEach(function (id) {
      var st = surface.byId(id);
      if (st && st.gid && gids[st.gid] && ink.indexOf(id) === -1) ink.push(id);
    });
    return { ink: ink, els: els };
  }

  /* Kept for anything still calling it with objects only. */
  function withGroups(ids) { return groupOf([], ids).els; }

  function selectMany(strokeIds, objectIds) {
    var whole = groupOf(
      (strokeIds || []).filter(function (id) { return !!surface.byId(id); }),
      (objectIds || []).filter(function (id) { return !!layer.get(id); })
    );
    inkIds = whole.ink;
    elIds = whole.els;
    if (!inkIds.length && !elIds.length) return clearInk();

    /* One object on its own gets the inspector and its corner handles — all
     * the per-type controls only make sense for a single thing. */
    if (!inkIds.length && elIds.length === 1) {
      var only = elIds[0];
      inkIds = [];
      elIds = [];
      inkBox = null;
      inkEditor.select(null);
      editor.select(only);
      renderInkBar();
      return;
    }

    var box = selectionBox();
    if (!box) return clearInk();
    inkBox = { id: INK_ID, type: "ink", x: box.x, y: box.y, w: box.w, h: box.h, rot: 0 };
    inkBase = { x: box.x, y: box.y, w: box.w, h: box.h };
    elBase = Object.create(null);
    elIds.forEach(function (id) {
      var el = layer.get(id);
      if (el) elBase[id] = { x: el.x, y: el.y, w: el.w, h: el.h, rot: el.rot || 0 };
    });
    inkSel = newSel();
    surface.dropXformBase();
    editor.select(null);
    inkEditor.select(INK_ID);
    renderInkBar();
  }

  function selectInk(ids) { selectMany(ids, []); }

  function clearInk() {
    if (!inkIds.length && !elIds.length && !inkBox) return;
    inkIds = [];
    elIds = [];
    elBase = null;
    inkBox = null;
    inkBase = null;
    inkEditor.select(null);
    renderInkBar();
  }

  /* Re-read the box off the ink itself. After a move the strokes are where
   * they are; after a turn their upright box is a different box entirely,
   * and the frame has to agree with what is on the board. */
  function reboxInk() {
    if (!inkIds.length && !elIds.length) return;
    inkIds = inkIds.filter(function (id) { return !!surface.byId(id); });
    elIds = elIds.filter(function (id) { return !!layer.get(id); });
    if (!inkIds.length && !elIds.length) return clearInk();
    var box = selectionBox();
    if (!box) return clearInk();
    inkBox = { id: INK_ID, type: "ink", x: box.x, y: box.y, w: box.w, h: box.h, rot: 0 };
    inkBase = { x: box.x, y: box.y, w: box.w, h: box.h };
    elBase = Object.create(null);
    elIds.forEach(function (id) {
      var el = layer.get(id);
      if (el) elBase[id] = { x: el.x, y: el.y, w: el.w, h: el.h, rot: el.rot || 0 };
    });
    inkSel = newSel();
    surface.dropXformBase();
    inkEditor.select(INK_ID);
    renderInkBar();
  }

  function commitInk() {
    if ((!inkIds.length && !elIds.length) || !inkBox || !inkBase) return;
    var m = inkMatrix();
    if (inkIds.length) {
      /* Claim this gesture before the server echoes it back, or the echo
       * applies the same move a second time. */
      surface.markXformDone(inkSel);
      net.send({ t: "ink_xform", sel: inkSel, ids: inkIds, m: m });
    }
    if (elIds.length) {
      var items = applyMatrixToEls(m);
      if (items.length) net.send({ t: "el_multi", items: items });
    }
    setHistory(true, false);
    reboxInk();
  }

  function sendMulti(patch) {
    if (!elIds.length) return;
    var items = elIds.map(function (id) {
      layer.patch(id, patch);
      return { id: id, patch: patch };
    });
    net.send({ t: "el_multi", items: items });
    setHistory(true, false);
  }

  function showExtra(on) {
    var more = document.getElementById("sel-more");
    var extra = document.getElementById("sel-extra");
    if (!more || !extra) return;
    extra.hidden = !on;
    more.setAttribute("aria-expanded", on ? "true" : "false");
    more.textContent = on ? "Less" : "More";
  }

  function renderInkBar() {
    var n = inkIds.length + elIds.length;
    inkBar.hidden = n === 0;
    document.body.classList.toggle("ink-picked", n > 0);
    /* A new selection starts folded up. The second row is for the things
     * people do occasionally; leaving it open makes the panel tall for the
     * rest of the lesson. */
    if (!n) { showExtra(false); return; }
    var bits = [];
    if (elIds.length) {
      bits.push(elIds.length + (elIds.length === 1 ? " object" : " objects"));
    }
    if (inkIds.length) {
      bits.push(inkIds.length + (inkIds.length === 1 ? " mark" : " marks"));
    }
    inkCount.textContent = bits.join(" + ") + " picked";
    var grouped = elIds.some(function (id) {
      var el = layer.get(id);
      return !!(el && el.gid);
    }) || inkIds.some(function (id) {
      var st = surface.byId(id);
      return !!(st && st.gid);
    });
    /* Two of anything can be a group — two marks, two objects, or one of
     * each. That is the whole point of it. */
    document.getElementById("sel-group").hidden = n < 2 || grouped;
    document.getElementById("sel-ungroup").hidden = !grouped;
  }

  /* ---- the duster ----------------------------------------------------
   *
   * The eraser takes whole strokes; the duster takes the part you rubbed
   * and leaves the rest, for cleaning an edge or opening a gap. The wipe
   * path goes to the server in chunks while the finger is still moving, so
   * the wall keeps up with the hand, and every chunk of one rub carries the
   * same id and merges into a single Undo.
   */

  var duster = null;
  var DUSTER_CHUNK_MS = 90;

  function dusterRadius() {
    /* Tied to the thickness slider, but never a pinprick: a duster you have
     * to aim precisely is a duster nobody uses. */
    return Math.min(0.16, Math.max(0.018, state.width * 3.2));
  }

  function showDuster(x, y) {
    var r = dusterRadius() * state.view.s;
    marquee.hidden = false;
    marquee.dataset.round = "1";
    marquee.style.left = ((x - state.view.x) * state.view.s - r) * 100 + "%";
    marquee.style.top = ((y - state.view.y) * state.view.s - r * 16 / 9) * 100 + "%";
    marquee.style.width = (r * 200) + "%";
    marquee.style.height = (r * 200 * 16 / 9) + "%";
  }

  function hideDuster() {
    marquee.hidden = true;
    delete marquee.dataset.round;
  }

  function flushDuster(force) {
    if (!duster || duster.path.length < 2) return;
    var now = Date.now();
    if (!force && now - duster.sentAt < DUSTER_CHUNK_MS) return;
    duster.sentAt = now;
    net.send({
      t: "ink_wipe", gid: duster.gid,
      path: duster.path, r: dusterRadius()
    });
    /* Keep the last point so the next chunk joins on to this one rather
     * than leaving an un-rubbed gap between them. */
    duster.path = duster.path.slice(-2);
  }

  /* ---- lasso -------------------------------------------------------- */

  function lassoRect() {
    var a = lasso.from, b = lasso.to;
    return {
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y)
    };
  }

  function placeMarquee(r) {
    var v = state.view;
    marquee.style.left = ((r.x - v.x) * v.s * 100) + "%";
    marquee.style.top = ((r.y - v.y) * v.s * 100) + "%";
    marquee.style.width = (r.w * v.s * 100) + "%";
    marquee.style.height = (r.h * v.s * 100) + "%";
  }

  function endLasso(cancelled) {
    var r = lassoRect();
    lasso = null;
    marquee.hidden = true;
    if (cancelled) return;
    /* A tap, not a drag: that is "nothing, thanks". */
    if (r.w < 0.012 && r.h < 0.012) {
      if (!inkAdd) { editor.select(null); clearInk(); }
      return;
    }
    var found = surface.idsIn(r);
    /* Objects whose middle is inside the box. Their whole box does not have
     * to be: lassoing a diagram would otherwise mean carefully enclosing
     * every label that hangs off the edge of it. */
    var objects = layer.els.filter(function (el) {
      var cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      return cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h;
    }).map(function (el) { return el.id; });

    if (!found.length && !objects.length) {
      if (!inkAdd) clearInk();
      else say("Nothing inside that box.");
      return;
    }
    if (inkAdd) {
      selectMany(
        inkIds.concat(found.filter(function (id) { return inkIds.indexOf(id) === -1; })),
        elIds.concat(objects.filter(function (id) { return elIds.indexOf(id) === -1; }))
      );
    } else {
      selectMany(found, objects);
    }
  }

  document.getElementById("ink-all").addEventListener("click", function () {
    setTool("select");
    selectMany(surface.allIds(), layer.els.map(function (el) { return el.id; }));
    if (!inkIds.length && !elIds.length) say("This page is empty.");
  });

  /* Writing the label onto whatever is picked, on this phone and on the
   * server, in one message. It covers both layers because a diagram is
   * usually a drawn arrow, a photo and a caption, and a grouping that only
   * held the photo and the caption would be a worse kind of nothing. */
  function tagGroup(gid) {
    inkIds.forEach(function (id) {
      var st = surface.byId(id);
      if (st) st.gid = gid;
    });
    elIds.forEach(function (id) { layer.patch(id, { gid: gid }); });
    net.send({ t: "group", ink: inkIds, els: elIds, gid: gid });
    renderInkBar();
  }

  (function () {
    var more = document.getElementById("sel-more");
    if (!more) return;
    more.addEventListener("click", function () {
      var extra = document.getElementById("sel-extra");
      showExtra(!!(extra && extra.hidden));
    });
  })();

  document.getElementById("sel-group").addEventListener("click", function () {
    var n = inkIds.length + elIds.length;
    if (n < 2) return say("Pick two or more things first.");
    tagGroup("g" + ChalkEls.newId());
    var bits = [];
    if (elIds.length) bits.push(elIds.length + (elIds.length === 1 ? " object" : " objects"));
    if (inkIds.length) bits.push(inkIds.length + (inkIds.length === 1 ? " mark" : " marks"));
    say(bits.join(" and ") + " are one thing now — tap any part to pick it all.");
  });

  document.getElementById("sel-ungroup").addEventListener("click", function () {
    if (!inkIds.length && !elIds.length) return;
    tagGroup("");
    say("Ungrouped. They are separate things again.");
  });

  document.getElementById("sel-front").addEventListener("click", function () {
    if (inkIds.length) {
      surface.setBand(inkIds, true);
      surface.reorder(inkIds, true);
      net.send({ t: "ink_band", ids: inkIds, front: true });
    }
    if (elIds.length) {
      sendMulti({ top: true });
      elIds.forEach(function (id) { net.send({ t: "el_raise", id: id }); });
      elIds.forEach(function (id) { layer.raise(id); });
    }
    inkEditor.refresh();
    say("Brought to the front.");
  });

  document.getElementById("sel-back").addEventListener("click", function () {
    if (inkIds.length) {
      surface.setBand(inkIds, false);
      net.send({ t: "ink_band", ids: inkIds, front: false });
    }
    if (elIds.length) sendMulti({ top: false });
    inkEditor.refresh();
    say("Sent behind.");
  });
  document.getElementById("ink-more").addEventListener("click", function () {
    inkAdd = !inkAdd;
    var b = document.getElementById("ink-more");
    b.dataset.on = String(inkAdd);
    b.setAttribute("aria-pressed", String(inkAdd));
    say(inkAdd ? "Lasso more writing to add it to the selection."
               : "Lasso now starts a fresh selection.");
  });
  document.getElementById("ink-delete").addEventListener("click", function () {
    if (inkIds.length) {
      var ids = inkIds.slice();
      surface.remove(ids);
      net.send({ t: "erase", ids: ids });
    }
    if (elIds.length) {
      var eids = elIds.slice();
      layer.remove(eids);
      net.send({ t: "el_delete", ids: eids });
    }
    clearInk();
  });
  document.getElementById("ink-done").addEventListener("click", clearInk);

  function pushEl(el) {
    layer.upsert(el);
    net.send({ t: "el_add", el: el });
    setTool("select");
    editor.select(el.id);
  }

  function patchEl(patch) {
    var el = editor.selected && layer.get(editor.selected);
    if (!el) return;
    layer.patch(el.id, patch);
    editor.refresh();
    net.send({ t: "el_update", id: el.id, patch: patch });
  }

  function inkColor() {
    return state.surface === "black" || state.surface === "green"
      ? "#ffffff" : "#111827";
  }

  /* Drop new objects into the middle of whatever part of the board the pad is
   * looking at, sized against the zoom so they arrive usable rather than
   * microscopic at 4x. */
  function placeCentre(el, w, h) {
    el.w = round(Math.min(1.5, w / state.view.s));
    el.h = round(Math.min(1.5, h / state.view.s));
    el.x = round(state.view.x + 0.5 / state.view.s - el.w / 2);
    el.y = round(state.view.y + 0.5 / state.view.s - el.h / 2);
    return el;
  }

  document.getElementById("add-text").addEventListener("click", function () {
    var el = ChalkEls.blank("text", { color: inkColor() });
    placeCentre(el, 0.36, 0.12);
    pushEl(el);
    /* A brand new text box has nothing in it, so the keyboard is the only
     * useful next step whatever the layout. */
    openTextSheet();
  });

  document.getElementById("add-photo").addEventListener("click", function () {
    photoInput.value = "";
    photoInput.click();
  });

  photoInput.addEventListener("change", function () {
    var file = photoInput.files && photoInput.files[0];
    if (!file) return;
    say("Sending the photo…");
    var fd = new FormData();
    fd.append("file", file);
    fd.append("t", CFG.token);
    fetch(CFG.uploadUrl, {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      headers: { "X-CSRFToken": CFG.csrf }
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (!d.ok) throw new Error(d.error || "That photo did not go through.");
        var el = ChalkEls.blank("image", { src: d.src });
        /* The board is 16:9, so a square photo needs a box 16/9 taller than
         * it is wide to come out square. */
        placeCentre(el, 0.32, 0.32 * (d.ratio || 0.75) * (16 / 9));
        pushEl(el);
        say("");
      })
      .catch(function (err) { say(err.message || "That photo did not go through."); });
  });

  /* ------------------------------------------------------------------ */
  /* ready-made boards                                                   */
  /*                                                                     */
  /* A template arrives as ordinary elements — no special kind of object, */
  /* nothing locked. Once it is down, every line of it can be dragged,    */
  /* recoloured, deleted or written over by hand, which is the point: the */
  /* number line is a starting position, not a worksheet.                 */
  /* ------------------------------------------------------------------ */

  /* A wireframe of the template itself, built from the elements it would
   * actually place. Cheaper to keep honest than a drawn icon, which goes
   * stale the moment somebody edits the template it claims to show. */
  function tplThumb(els) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 160 90");
    svg.setAttribute("class", "thumb thumb-wide");
    els.slice(0, 26).forEach(function (e) {
      var x = e.x * 160, y = e.y * 90, w = e.w * 160, h = e.h * 90;
      var node;
      if (e.type === "text") {
        node = document.createElementNS(svg.namespaceURI, "line");
        node.setAttribute("x1", x);
        node.setAttribute("y1", y + h * 0.6);
        node.setAttribute("x2", x + Math.min(w, 34));
        node.setAttribute("y2", y + h * 0.6);
        node.setAttribute("stroke-width", "2.4");
        node.setAttribute("opacity", ".62");
      } else if (e.type === "shape" && e.shape === "ellipse") {
        node = document.createElementNS(svg.namespaceURI, "ellipse");
        node.setAttribute("cx", x + w / 2);
        node.setAttribute("cy", y + h / 2);
        node.setAttribute("rx", Math.max(1, w / 2));
        node.setAttribute("ry", Math.max(1, h / 2));
        node.setAttribute("fill", "none");
      } else if (e.type === "freeform" && e.pts && e.pts.length >= 4) {
        node = document.createElementNS(svg.namespaceURI, "polyline");
        var pairs = [];
        for (var i = 0; i < e.pts.length; i += 2) {
          pairs.push((x + e.pts[i] / 100 * w) + "," + (y + e.pts[i + 1] / 100 * h));
        }
        if (e.closed) pairs.push(pairs[0]);
        node.setAttribute("points", pairs.join(" "));
        node.setAttribute("fill", "none");
      } else {
        node = document.createElementNS(svg.namespaceURI, "rect");
        node.setAttribute("x", x);
        node.setAttribute("y", y);
        node.setAttribute("width", Math.max(1, w));
        node.setAttribute("height", Math.max(1, h));
        node.setAttribute("fill", "none");
      }
      node.setAttribute("stroke", "currentColor");
      if (!node.getAttribute("stroke-width")) node.setAttribute("stroke-width", "1.6");
      svg.appendChild(node);
    });
    return svg;
  }

  function insertTemplate(tpl) {
    var els;
    try {
      els = tpl.build(ChalkTemplates.palette(state.surface));
    } catch (err) {
      say("That one could not be built.");
      return;
    }
    if (!els || !els.length) return;
    closeSheet();
    editor.select(null);
    clearInk();
    els.forEach(function (e) { layer.upsert(e); });
    /* One message, so it lands as one undo entry on the server. */
    net.send({ t: "el_tpl", els: els });
    setHistory(true, false);
    setTool("select");
    say(tpl.name + " is on the board — drag any part of it to change it.");
  }

  document.getElementById("add-tpl").addEventListener("click", function () {
    if (!window.ChalkTemplates) return say("The ready-made boards did not load.");
    openSheet("Ready-made boards", function (body) {
      var p = ChalkTemplates.palette(state.surface);
      ChalkTemplates.subjects.forEach(function (sub) {
        var mine = ChalkTemplates.list.filter(function (t) {
          return t.subject === sub.id;
        });
        if (!mine.length) return;
        body.appendChild(rowLabel(sub.name));
        var grid = document.createElement("div");
        grid.className = "pick-grid pick-grid-wide";
        mine.forEach(function (t) {
          var preview = [];
          try { preview = t.build(p); } catch (err) { preview = []; }
          var b = pickButton(tplThumb(preview), t.name, function () {
            insertTemplate(t);
          });
          if (t.hint) b.title = t.hint;
          grid.appendChild(b);
        });
        body.appendChild(grid);
      });
    });
  });

  document.getElementById("add-shape").addEventListener("click", function () {
    openSheet("Pick a shape", function (body) {
      var groups = { "2D": [], "3D": [] };
      ChalkShapes.list.forEach(function (sh) { groups[sh.group].push(sh); });
      [["2D", "Flat shapes"], ["3D", "Solids"]].forEach(function (g) {
        body.appendChild(rowLabel(g[1]));
        var grid = document.createElement("div");
        grid.className = "pick-grid";
        groups[g[0]].forEach(function (sh) {
          grid.appendChild(pickButton(shapeThumb(sh.id), sh.name, function () {
            var el = ChalkEls.blank("shape", { shape: sh.id, stroke: inkColor() });
            placeCentre(el, 0.22, 0.26);
            /* A line or an arrow with a fill is just a smear. */
            if (["line", "arrow", "darrow", "brace", "angle"].indexOf(sh.id) !== -1) {
              el.fillOn = false;
            }
            closeSheet();
            pushEl(el);
          }));
        });
        body.appendChild(grid);
      });

      /* The built-in list is fixed in chalk_shapes.js, so everything else
       * arrives as a free shape carrying its own points. The teacher does
       * not need to know the difference — except that these ones can have
       * their corners dragged afterwards, and the built-ins cannot. */
      if (!window.ChalkStickers) return;
      ChalkStickers.shapeCats.forEach(function (cat) {
        body.appendChild(rowLabel(cat));
        var grid = document.createElement("div");
        grid.className = "pick-grid";
        ChalkStickers.shapes.filter(function (sh) {
          return sh.cat === cat;
        }).forEach(function (sh) {
          grid.appendChild(pickButton(
            svgThumb(ChalkStickers.pathOf(sh), sh.closed), sh.name,
            function () {
              var el = ChalkEls.blank("freeform", { stroke: inkColor() });
              el.preset = "custom";
              el.edited = true;
              el.pts = sh.pts.slice();
              el.closed = sh.closed;
              el.edge = sh.edge;
              el.radius = sh.radius;
              el.fillOn = false;
              el.strokeW = 3;
              placeCentre(el, sh.wide ? 0.3 : 0.22, sh.wide ? 0.2 : 0.26);
              closeSheet();
              pushEl(el);
            }
          ));
        });
        body.appendChild(grid);
      });
    });
  });

  /* ---- emoji ---------------------------------------------------------
   *
   * An emoji is a character, so a sticker of one is a text element holding
   * that character: nothing to draw, nothing to store, nothing to load, and
   * it arrives in colour. Everything the board can do to text it can do to
   * these — resize, turn, shadow, send behind the writing.
   */
  document.getElementById("add-emoji").addEventListener("click", function () {
    if (!window.ChalkStickers) return say("The emoji did not load.");
    openSheet("Emoji", function (body) {
      ChalkStickers.emoji.forEach(function (group) {
        body.appendChild(rowLabel(group.name));
        var grid = document.createElement("div");
        grid.className = "emoji-grid";
        group.chars.forEach(function (ch) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "emoji-pick";
          b.textContent = ch;
          b.addEventListener("click", function () {
            var el = ChalkEls.blank("text", { text: ch, color: inkColor() });
            el.size = 0.22;
            el.align = "center";
            placeCentre(el, 0.16, 0.28);
            closeSheet();
            pushEl(el);
          });
          grid.appendChild(b);
        });
        body.appendChild(grid);
      });
    });
  });

  /* ---- icons ---------------------------------------------------------
   *
   * An icon is several strokes — an envelope is a box and two lines — so it
   * arrives as a handful of elements sharing one group label. It moves and
   * resizes as one thing, and it still comes apart: colour the ring of the
   * key differently from the shaft, or drag one corner of the roof.
   */
  function insertIcon(ic) {
    var w = Math.min(1.2, 0.2 / state.view.s);
    /* Square on screen, which on a 16:9 board is not square in the numbers. */
    var box = {
      x: state.view.x + 0.5 / state.view.s - w / 2,
      y: state.view.y + 0.5 / state.view.s - (w * 16 / 9) / 2,
      w: w, h: w * 16 / 9
    };
    var els;
    try {
      els = ChalkIcons.build(ic, box, ChalkTemplates.palette(state.surface));
    } catch (err) {
      return say("That icon could not be built.");
    }
    if (!els || !els.length) return;
    var gid = "g" + ChalkEls.newId();
    els.forEach(function (el) {
      el.gid = gid;
      layer.upsert(el);
    });
    closeSheet();
    net.send({ t: "el_tpl", els: els });
    setHistory(true, false);
    setTool("select");
    selectMany([], [els[0].id]);
    say(ic.name + " added — it moves as one, or ungroup it to take it apart.");
  }

  document.getElementById("add-icon").addEventListener("click", function () {
    if (!window.ChalkIcons) return say("The icons did not load.");
    openSheet("Icons", function (body) {
      ChalkIcons.cats.forEach(function (cat) {
        body.appendChild(rowLabel(cat));
        var grid = document.createElement("div");
        grid.className = "pick-grid";
        ChalkIcons.list.filter(function (ic) {
          return ic.cat === cat;
        }).forEach(function (ic) {
          grid.appendChild(pickButton(ChalkIcons.preview(ic), ic.name,
            function () { insertIcon(ic); }));
        });
        body.appendChild(grid);
      });
    });
  });

  document.getElementById("add-free").addEventListener("click", function () {
    openSheet("Start a free shape", function (body) {
      var note = document.createElement("p");
      note.className = "sheet-note";
      note.textContent = "Pick something to start from, then drag any corner to " +
        "reshape it. Tap a hollow dot to add a corner.";
      body.appendChild(note);
      var grid = document.createElement("div");
      grid.className = "pick-grid";
      ChalkShapes.presets.forEach(function (pr) {
        grid.appendChild(pickButton(freeThumb(pr.id), pr.name, function () {
          var el = ChalkEls.blank("freeform", { preset: pr.id, stroke: inkColor() });
          placeCentre(el, 0.24, 0.28);
          closeSheet();
          pushEl(el);
          editor.setVertexMode(true);
          renderInspector();
        }));
      });
      body.appendChild(grid);
    });
  });

  function rowLabel(text) {
    var h = document.createElement("div");
    h.className = "row-label";
    h.textContent = text;
    return h;
  }
  function pickButton(thumb, label, onPick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "pick";
    b.appendChild(thumb);
    var lab = document.createElement("span");
    lab.textContent = label;
    b.appendChild(lab);
    b.addEventListener("click", onPick);
    return b;
  }
  function svgThumb(d, closed) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "-8 -8 116 116");
    svg.setAttribute("class", "thumb");
    svg.setAttribute("aria-hidden", "true");
    var p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", closed ? "rgba(232,238,244,.16)" : "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", "5");
    p.setAttribute("stroke-linejoin", "round");
    p.setAttribute("stroke-linecap", "round");
    svg.appendChild(p);
    return svg;
  }
  function shapeThumb(id) {
    var built = ChalkShapes.build(id, {});
    return svgThumb(built.parts.map(function (p) { return p.d; }).join(" "), !built.open);
  }
  function freeThumb(id) {
    var closed = id !== "wave";
    return svgThumb(
      ChalkShapes.pathFromPoints(ChalkShapes.seedPoints(id, 6, 45), closed, "sharp"),
      closed
    );
  }

  /* ---- inspector --------------------------------------------------- */

  var SHAPE_OPTS = ChalkShapes.list.map(function (sh) { return [sh.id, sh.name]; });
  var PRESET_OPTS = ChalkShapes.presets.map(function (p) { return [p.id, p.name]; });

  /* Which shapes actually use which knob. Showing "Corners" on a sphere is
   * how an inspector becomes noise. */
  var PARAM_FOR = {
    sides: ["polygon", "star"], inset: ["star"],
    depth: ["cube", "cylinder", "cone", "pyramid", "prism"],
    radius: ["rrect"], thickness: ["cross", "chevron"],
    slant: ["parallelogram", "trapezoid"], head: ["arrow", "darrow"],
    degrees: ["angle"], hole: ["torus"]
  };
  var PARAM_SPEC = {
    sides: [3, 24, 1, "Corners"], inset: [10, 90, 1, "Point depth"],
    depth: [4, 45, 1, "Thickness"], radius: [0, 50, 1, "Rounded"],
    thickness: [10, 60, 1, "Bar width"], slant: [0, 45, 1, "Slant"],
    head: [8, 45, 1, "Head size"], degrees: [5, 175, 1, "Degrees"],
    hole: [10, 70, 1, "Hole"]
  };

  function paintFields() {
    return [
      { k: "fillOn", type: "toggle", label: "Fill it in" },
      { k: "fill", type: "color", label: "Fill colour" },
      { k: "stroke", type: "color", label: "Outline colour" },
      { k: "strokeW", type: "range", min: 0, max: 12, step: 0.5, label: "Outline width" },
      { k: "dash", type: "range", min: 0, max: 20, step: 1, label: "Dashes" }
    ];
  }

  var FIELDS = {
    text: function () {
      return [
        { k: "text", type: "button", label: "Words", action: openTextSheet, cta: "Type" },
        { k: "size", type: "range", min: 0.02, max: 0.3, step: 0.005, label: "Size" },
        { k: "color", type: "color", label: "Colour" },
        { k: "font", type: "font", label: "Written with" },
        { k: "align", type: "select", label: "Line up",
          opts: [["left", "Left"], ["center", "Centre"], ["right", "Right"]] },
        { k: "bold", type: "toggle", label: "Bold" },
        { k: "italic", type: "toggle", label: "Italic" }
      ];
    },
    image: function () {
      return [
        { k: "fit", type: "select", label: "Fit",
          opts: [["contain", "Show all of it"], ["cover", "Fill the box"]] },
        { k: "radius", type: "range", min: 0, max: 50, step: 1, label: "Rounded corners" }
      ];
    },
    shape: function (el) {
      var f = [{ k: "shape", type: "select", label: "Shape", opts: SHAPE_OPTS }];
      Object.keys(PARAM_SPEC).forEach(function (k) {
        if ((PARAM_FOR[k] || []).indexOf(el.shape) === -1) return;
        var sp = PARAM_SPEC[k];
        f.push({ k: k, type: "range", min: sp[0], max: sp[1], step: sp[2], label: sp[3] });
      });
      return f.concat(paintFields());
    },
    freeform: function (el) {
      var f = [{
        k: "__verts", type: "toggle", label: "Edit corners",
        get: function () { return editor.vertexMode; },
        set: function (on) { editor.setVertexMode(on); renderInspector(); }
      }];
      if (editor.vertexMode) {
        f.push({
          k: "__delv", type: "button", label: "Remove the corner you touched",
          cta: "Remove",
          action: function () {
            var patch = editor.removeVertex();
            if (patch) net.send({ t: "el_update", id: el.id, patch: patch });
            else say("Tap a corner first, and keep at least three.");
          }
        });
      }
      f.push({
        k: "preset", type: "select", label: "Start from", opts: PRESET_OPTS,
        confirm: el.edited
          ? "Go back to the preset shape? The corners you moved will be lost."
          : null
      });
      /* Corner-count sliders re-seed the points, so they disappear once the
       * shape has been edited by hand rather than silently discarding work. */
      if (!el.edited && ["polygon", "star", "burst"].indexOf(el.preset) !== -1) {
        f.push({ k: "sides", type: "range", min: 3, max: 24, step: 1, label: "Corners" });
        if (el.preset !== "polygon") {
          f.push({ k: "inset", type: "range", min: 10, max: 90, step: 1, label: "Point depth" });
        }
      }
      f.push({ k: "edge", type: "select", label: "Corner style",
        opts: [["sharp", "Sharp"], ["round", "Rounded"], ["smooth", "Smooth curve"]] });
      if (el.edge === "round") {
        f.push({ k: "radius", type: "range", min: 0, max: 50, step: 1, label: "How rounded" });
      }
      f.push({ k: "closed", type: "toggle", label: "Joined up" });
      return f.concat(paintFields());
    }
  };

  var FX_FIELDS = [
    { k: "fx.shadow", type: "toggle", label: "Shadow" },
    { k: "fx.blur", type: "range", min: 0, max: 40, step: 1, label: "Shadow softness" },
    { k: "fx.glow", type: "toggle", label: "Glow" },
    { k: "fx.glowColor", type: "color", label: "Glow colour" },
    { k: "fx.extrude", type: "range", min: 0, max: 24, step: 1, label: "3-D depth" },
    { k: "fx.tiltX", type: "range", min: -60, max: 60, step: 1, label: "Tilt up / down" },
    { k: "fx.tiltY", type: "range", min: -60, max: 60, step: 1, label: "Tilt left / right" },
    { k: "fx.opacity", type: "range", min: 0.1, max: 1, step: 0.05, label: "See-through" },
    { k: "fx.blend", type: "select", label: "Blend with the board",
      opts: [["normal", "Off"], ["multiply", "Multiply"], ["screen", "Screen"],
             ["overlay", "Overlay"], ["difference", "Difference"],
             ["luminosity", "Luminosity"]] },
    { k: "fx.flipH", type: "toggle", label: "Flip across" },
    { k: "fx.flipV", type: "toggle", label: "Flip over" }
  ];

  function readVal(el, key) {
    if (key.indexOf("fx.") === 0) return (el.fx || {})[key.slice(3)];
    return el[key];
  }

  /* Changing a free shape's preset or corner count re-seeds its points: a
   * preset is a starting shape, not a permanent identity. */
  function buildPatch(el, key, value) {
    if (key.indexOf("fx.") === 0) {
      var fx = {};
      Object.keys(el.fx || {}).forEach(function (k) { fx[k] = el.fx[k]; });
      fx[key.slice(3)] = value;
      return { fx: fx };
    }
    var patch = {};
    patch[key] = value;
    if (el.type === "freeform" && (key === "preset" || key === "sides" || key === "inset")) {
      var preset = key === "preset" ? value : el.preset;
      patch.pts = ChalkShapes.seedPoints(
        preset,
        key === "sides" ? value : el.sides,
        key === "inset" ? value : el.inset
      );
      patch.edited = false;
      if (key === "preset") patch.closed = preset !== "wave";
    }
    return patch;
  }

  function writeVal(key, value) {
    var el = layer.get(editor.selected);
    if (el) patchEl(buildPatch(el, key, value));
  }

  /* The details are a drawer, not a wall.
   *
   * Picking a shape used to open every knob it has, and on a phone that is
   * most of the screen. On the full-screen board it was the whole board: the
   * object you had just picked was underneath the panel describing it, and
   * there was no way to reach its handles. So the panel opens as a bar —
   * name, To front, Delete, Done — and the knobs come out only when asked
   * for. Full screen starts every selection that way; the ordinary layout,
   * where there is a pad above the panel and nothing is hidden, does not. */
  var inspCollapsed = false;
  var lastInspected = null;

  function setInspCollapsed(on) {
    inspCollapsed = !!on;
    inspector.classList.toggle("is-collapsed", inspCollapsed);
    document.body.classList.toggle("insp-collapsed", inspCollapsed);
    inspToggle.textContent = inspCollapsed ? "Details" : "Hide details";
    inspToggle.setAttribute("aria-expanded", String(!inspCollapsed));
  }

  inspToggle.addEventListener("click", function () {
    setInspCollapsed(!inspCollapsed);
  });

  function renderInspector() {
    var el = editor.selected && layer.get(editor.selected);
    if (!el) {
      inspector.hidden = true;
      document.body.classList.remove("inspecting");
      lastInspected = null;
      return;
    }
    if (el.id !== lastInspected) {
      lastInspected = el.id;
      setInspCollapsed(document.body.classList.contains("immersive"));
    }
    inspector.hidden = false;
    document.body.classList.add("inspecting");
    inspectorName.textContent = {
      text: "Text", image: "Photo", shape: "Shape", freeform: "Free shape"
    }[el.type] || "Object";
    var band = document.getElementById("el-band");
    band.dataset.on = String(!!el.top);
    band.setAttribute("aria-pressed", String(!!el.top));
    band.textContent = el.top ? "Behind writing" : "Over writing";

    inspectorBody.textContent = "";
    (FIELDS[el.type] || FIELDS.shape)(el)
      .concat([{ type: "heading", label: "Effects" }], FX_FIELDS)
      .forEach(function (f) { inspectorBody.appendChild(buildField(el, f)); });
  }

  function buildField(el, f) {
    if (f.type === "heading") return rowLabel(f.label);

    var row = document.createElement("label");
    row.className = "field";
    var name = document.createElement("span");
    name.className = "field-label";
    name.textContent = f.label;
    row.appendChild(name);

    var input;
    if (f.type === "toggle") {
      input = document.createElement("button");
      input.type = "button";
      input.className = "icon-btn";
      var on = f.get ? f.get() : !!readVal(el, f.k);
      input.dataset.on = String(on);
      input.setAttribute("aria-pressed", String(on));
      input.textContent = on ? "On" : "Off";
      input.addEventListener("click", function () {
        var next = !(f.get ? f.get() : !!readVal(el, f.k));
        if (f.set) f.set(next);
        else { writeVal(f.k, next); renderInspector(); }
      });
    } else if (f.type === "button") {
      input = document.createElement("button");
      input.type = "button";
      input.className = "icon-btn";
      input.textContent = f.cta || "Open";
      input.addEventListener("click", f.action);
    } else if (f.type === "color") {
      input = document.createElement("input");
      input.type = "color";
      input.className = "field-color";
      input.value = normHex(readVal(el, f.k)) || "#ffffff";
      input.addEventListener("input", function () { writeVal(f.k, input.value); });
    } else if (f.type === "font") {
      /* A list of font names all set in the same font is not a choice, it is
       * a quiz. Every chip is written in the hand it offers. */
      input = document.createElement("div");
      input.className = "field-fonts";
      var groups = { hand: "Written by hand", print: "Printed", plain: "Plain" };
      var current = readVal(el, f.k);
      /* If chalk_els.js is still the old copy there is no list to read, so
       * fall back to the four keys that have always been there rather than
       * drawing an empty picker. */
      var fonts = ChalkEls.FONT_LIST || [
        ["sans", "Plain", "plain"], ["serif", "Book", "plain"],
        ["mono", "Code", "plain"], ["hand", "Handwriting", "plain"]
      ];
      Object.keys(groups).forEach(function (kind) {
        var inKind = fonts.filter(function (o) { return o[2] === kind; });
        if (!inKind.length) return;
        var head = document.createElement("p");
        head.className = "font-group";
        head.textContent = groups[kind];
        input.appendChild(head);
        inKind.forEach(function (o) {
          var chip = document.createElement("button");
          chip.type = "button";
          chip.className = "font-chip";
          chip.dataset.font = o[0];
          chip.textContent = o[1];
          chip.setAttribute("aria-pressed", current === o[0] ? "true" : "false");
          chip.addEventListener("click", function () {
            writeVal(f.k, o[0]);
            renderInspector();
          });
          input.appendChild(chip);
        });
      });
    } else if (f.type === "select") {
      input = document.createElement("select");
      input.className = "field-select";
      f.opts.forEach(function (o) {
        var opt = document.createElement("option");
        opt.value = o[0];
        opt.textContent = o[1];
        input.appendChild(opt);
      });
      input.value = readVal(el, f.k);
      input.addEventListener("change", function () {
        if (f.confirm && !confirm(f.confirm)) {
          input.value = readVal(el, f.k);
          return;
        }
        writeVal(f.k, input.value);
        renderInspector();
      });
    } else {
      input = document.createElement("input");
      input.type = "range";
      input.min = f.min; input.max = f.max; input.step = f.step;
      var cur = readVal(el, f.k);
      input.value = cur == null ? f.min : cur;
      /* Slide freely, store once. Writing on every `input` event would put a
       * hundred undo entries behind one adjustment of a slider. */
      input.addEventListener("input", function () {
        var target = layer.get(editor.selected);
        if (!target) return;
        var patch = buildPatch(target, f.k, Number(input.value));
        layer.patch(target.id, patch);
        net.send({ t: "el_live", id: target.id, patch: patch }, true);
        editor.refresh();
      });
      input.addEventListener("change", function () {
        writeVal(f.k, Number(input.value));
      });
    }
    row.appendChild(input);
    return row;
  }

  function normHex(v) {
    return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null;
  }

  document.getElementById("el-band").addEventListener("click", function () {
    var id = editor.selected, el = id && layer.get(id);
    if (!el) return;
    patchEl({ top: !el.top });
    renderInspector();
  });

  document.getElementById("el-front").addEventListener("click", function () {
    if (!editor.selected) return;
    layer.raise(editor.selected);
    editor.refresh();
    net.send({ t: "el_raise", id: editor.selected });
  });
  document.getElementById("el-delete").addEventListener("click", function () {
    if (!editor.selected) return;
    var id = editor.selected;
    layer.remove([id]);
    editor.select(null);
    net.send({ t: "el_delete", ids: [id] });
  });
  document.getElementById("el-close").addEventListener("click", function () {
    editor.select(null);
  });

  /* ---- sheets ------------------------------------------------------ */

  function openSheet(title, fill) {
    sheetTitle.textContent = title;
    sheetBody.textContent = "";
    fill(sheetBody);
    sheet.hidden = false;
  }
  function closeSheet() { sheet.hidden = true; }
  document.getElementById("sheet-close").addEventListener("click", closeSheet);
  sheet.addEventListener("click", function (e) { if (e.target === sheet) closeSheet(); });

  function openTextSheet() {
    var el = editor.selected && layer.get(editor.selected);
    if (!el || el.type !== "text") return;
    openSheet("Type for the board", function (body) {
      var ta = document.createElement("textarea");
      ta.className = "sheet-text";
      ta.value = el.text || "";
      ta.rows = 5;
      ta.placeholder = "Whatever you type appears on the board as you go";
      /* Type in the hand it will be written in, so the shape of the sentence
       * on the wall is not a surprise. */
      ta.dataset.font = el.font || "sans";
      ta.style.fontFamily = (ChalkEls.FONTS || {})[el.font] || "";
      body.appendChild(ta);
      /* Live while typing so the class watches the sentence form; one write
       * on Done, so the whole sentence is a single undo. */
      ta.addEventListener("input", function () {
        layer.patch(el.id, { text: ta.value });
        editor.refresh();
        net.send({ t: "el_live", id: el.id, patch: { text: ta.value } }, true);
      });
      var done = document.createElement("button");
      done.type = "button";
      done.className = "btn btn-primary sheet-done";
      done.textContent = "Done";
      done.addEventListener("click", function () {
        net.send({ t: "el_update", id: el.id, patch: { text: ta.value } });
        closeSheet();
      });
      body.appendChild(done);
      setTimeout(function () { ta.focus(); }, 60);
    });
  }

  var toastTimer;
  function say(msg) {
    toast.textContent = msg || "";
    toast.hidden = !msg;
    clearTimeout(toastTimer);
    if (msg) toastTimer = setTimeout(function () { toast.hidden = true; }, 3200);
  }

  /* ------------------------------------------------------------------ */
  /* board actions                                                       */
  /* ------------------------------------------------------------------ */

  function setHistory(canUndo, canRedo) {
    if (typeof canUndo === "boolean") {
      document.getElementById("undo").disabled = !canUndo;
    }
    if (typeof canRedo === "boolean") {
      document.getElementById("redo").disabled = !canRedo;
    }
  }

  document.getElementById("undo").addEventListener("click", function () {
    net.send({ t: "undo" });
  });
  document.getElementById("redo").addEventListener("click", function () {
    net.send({ t: "redo" });
  });
  document.getElementById("clear").addEventListener("click", function () {
    if (confirm("Wipe everything on this page?")) net.send({ t: "clear" });
  });

  document.querySelectorAll("[data-surface]").forEach(function (b) {
    b.addEventListener("click", function () {
      net.send({ t: "surface", surface: b.dataset.surface });
      setSurfaceButtons(b.dataset.surface);
    });
  });

  function setSurfaceButtons(name) {
    if (!name) return;
    state.surface = name;
    document.querySelectorAll("[data-surface]").forEach(function (b) {
      var on = b.dataset.surface === name;
      b.dataset.on = String(on);
      b.setAttribute("aria-pressed", String(on));
    });
    padWrap.dataset.surface = name;
    /* A white pen on a whiteboard is invisible — nudge the default across.
     * Only while the teacher has not picked a colour deliberately; this used
     * to run on every snapshot and overwrite a chosen colour. */
    if (state.colorPinned) return;
    if (name === "white" && state.color.toLowerCase() === "#ffffff") setColor("#111827");
    if (name !== "white" && state.color.toLowerCase() === "#111827") setColor("#ffffff");
  }

  function setPage(index, count) {
    if (typeof index !== "number" || typeof count !== "number") return;
    state.pageIndex = index;
    state.pageCount = count;
    pageTag.textContent = (index + 1) + " / " + count;
    /* Delete stays enabled on a single page — there it wipes rather than
     * deletes, which is what the server does too. */
    document.getElementById("page-prev").disabled = index <= 0;
  }

  document.getElementById("page-prev").addEventListener("click", function () {
    if (state.pageIndex > 0) net.send({ t: "page", index: state.pageIndex - 1 });
  });
  document.getElementById("page-next").addEventListener("click", function () {
    if (state.pageIndex + 1 < state.pageCount) {
      net.send({ t: "page", index: state.pageIndex + 1 });
    } else {
      net.send({ t: "page_add" });
    }
  });
  document.getElementById("page-delete").addEventListener("click", function () {
    if (confirm("Delete this page?")) net.send({ t: "page_delete" });
  });

  /* ------------------------------------------------------------------ */
  /* phone housekeeping                                                  */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* whole-screen board                                                  */
  /*                                                                     */
  /* Two separate things, deliberately: browser full screen, which iOS    */
  /* Safari does not offer at all, and the layout where the board fills   */
  /* the phone and the tools float over it. The layout is the one that    */
  /* matters, so it does not wait for the API.                            */
  /*                                                                     */
  /* The pad stays 16:9 whatever the phone is doing. It is a scale model  */
  /* of the projector — stretch it and a circle drawn here arrives on the */
  /* wall as an ellipse.                                                  */
  /* ------------------------------------------------------------------ */

  function relayout() {
    /* The cached rect is stale the moment the pad moves, and every finger
     * position is measured against it. */
    surface._rect = null;
    surface.resize();
    layer.resize();
    layer.setView(state.view);
    editor.refresh();
    inkEditor.refresh();
    drawMini();
  }

  function setImmersive(on) {
    document.body.classList.toggle("immersive", on);
    document.body.classList.toggle("fs-fallback", on && !document.fullscreenElement);
    goFs.dataset.on = String(on);
    goFs.setAttribute("aria-pressed", String(on));
    goFs.title = on ? "Back to the normal layout" : "Whole screen";
    if (on) setTools(true);
    /* Whatever is picked right now should not be buried by the change. */
    if (editor.selected) setInspCollapsed(on);
    /* After the class lands, not before: the pad has not moved yet. */
    requestAnimationFrame(function () { requestAnimationFrame(relayout); });
  }

  /* A guest gets the drawing half of the board and not the running-the-room
   * half: no wiping the page, no turning it, no changing the surface under
   * thirty other people. The server refuses those from a guest as well —
   * this is only the part that stops them being offered. */
  function welcomeGuest(person) {
    document.body.classList.add("as-guest");
    ["clear", "page-delete", "page-prev", "page-next"].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.hidden = true;
    });
    Array.prototype.forEach.call(
      document.querySelectorAll(".surface-chip"),
      function (chip) { chip.disabled = true; }
    );
    say(person
      ? "You are writing on this board as " + person.name + "."
      : "You have joined this board.");
  }

  function setTools(open) {
    document.body.classList.toggle("tools-away", !open);
    toolsToggle.setAttribute("aria-expanded", String(open));
    toolsToggle.textContent = open ? "Hide tools" : "Tools";
  }

  goFs.addEventListener("click", function () {
    var turningOn = !document.body.classList.contains("immersive");
    setImmersive(turningOn);
    var el = document.documentElement;
    if (turningOn) {
      if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
      /* Sideways is where a 16:9 board and a phone agree. Android honours
       * this inside full screen; iOS ignores it, which is why it is a hint
       * on screen as well and not the only cue. */
      if (screen.orientation && screen.orientation.lock) {
        try { screen.orientation.lock("landscape").catch(function () {}); }
        catch (err) {}
      }
    } else {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(function () {});
      }
      if (screen.orientation && screen.orientation.unlock) {
        try { screen.orientation.unlock(); } catch (err) {}
      }
    }
  });

  toolsToggle.addEventListener("click", function () {
    setTools(document.body.classList.contains("tools-away"));
  });

  /* Leaving full screen by swipe or Back should not leave the phone in a
   * layout the button says it is not in. */
  document.addEventListener("fullscreenchange", function () {
    if (document.fullscreenElement) {
      /* The real thing arrived, so the CSS stand-in is not needed. */
      document.body.classList.remove("fs-fallback");
      relayout();
      return;
    }
    if (document.body.classList.contains("immersive")) setImmersive(false);
  });

  ["resize", "orientationchange"].forEach(function (evt) {
    window.addEventListener(evt, function () { setTimeout(relayout, 120); });
  });

  var lock = null;
  function keepAwake() {
    if (!navigator.wakeLock || !navigator.wakeLock.request) return;
    navigator.wakeLock.request("screen").then(function (l) {
      lock = l;
      l.addEventListener("release", function () { lock = null; });
    }).catch(function () {});
  }
  keepAwake();
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !lock) keepAwake();
    /* Coming back from the lock screen, the pad may have moved. */
    if (!document.hidden) surface.resize();
  });

  /* Stop the page itself from scrolling or pinch-zooming under the pad. */
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  document.body.addEventListener("touchmove", function (e) {
    if (e.target.closest("#pad-wrap")) e.preventDefault();
  }, { passive: false });

  /* Landscape on a short screen is where the board is biggest, so say so
   * once, the first time somebody fills the screen while upright. */
  var toldAboutTurning = false;
  window.addEventListener("orientationchange", function () { toldAboutTurning = false; });
  goFs.addEventListener("click", function () {
    if (!document.body.classList.contains("immersive")) return;
    if (toldAboutTurning || window.innerWidth >= window.innerHeight) return;
    toldAboutTurning = true;
    say("Turn the phone sideways for a bigger board.");
  });

  setTools(true);
  setTool("pen");
  setColor(CFG.surface === "white" ? "#111827" : "#ffffff");
  renderInspector();
  setSurfaceButtons(CFG.surface);
  setPage(CFG.pageIndex, CFG.pageCount);
  setZoom(1);
})();
