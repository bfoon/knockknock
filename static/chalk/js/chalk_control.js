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
      net.send({ t: "hello", role: "control", token: CFG.token });
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

  if (expiredRetry) {
    expiredRetry.addEventListener("click", function () { location.reload(); });
  }

  function handle(m) {
    switch (m.t) {
      case "ready":
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
      case "ink_live":
        surface.xform(m.sel, m.ids, m.m);
        break;
      case "ink":
        surface.applyOps(m.add, m.del, m.xform);
        setHistory(m.canUndo, m.canRedo);
        /* Strokes appearing or vanishing (an undone wipe, a redone erase)
         * invalidates the picked set; a move only shifts it. */
        if ((m.add && m.add.length) || (m.del && m.del.length)) clearInk();
        else if (m.xform && m.xform.length) reboxInk();
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
        break;
      case "el_raise": layer.raise(m.id); editor.refresh(); break;
      case "surface": setSurfaceButtons(m.surface); break;
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

    if (state.tool === "select") {
      /* Objects first, then handwriting, then a lasso. No capture for the
       * first two: the selection overlay handles the drag from here, and
       * capturing would steal it back. */
      var sp = surface.toBoard(e.clientX, e.clientY);
      var elHit = layer.hit(sp.x, sp.y);
      if (elHit) {
        clearInk();
        editor.select(elHit);
        return;
      }
      var inkHit = surface.hit(sp.x, sp.y, 0.014 / state.view.s);
      if (inkHit) {
        editor.select(null);
        selectInk(inkAdd ? withId(inkIds, inkHit) : [inkHit]);
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
    if (tool !== "select") {
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
  var inkBox = null;        // the box being dragged
  var inkBase = null;       // the box as it was when this gesture began
  var inkSel = "";          // gesture id — see ChalkInk.Surface.xform
  var inkAdd = false;       // does the next lasso add to the selection?
  var lasso = null;         // in-progress lasso, in board coordinates
  var selSeed = 0;

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

  var inkAdapter = {
    view: state.view,
    get: function (id) { return id === INK_ID ? inkBox : null; },
    patch: function (id, patch) {
      if (id !== INK_ID || !inkBox || !inkBase) return null;
      Object.assign(inkBox, patch);
      surface.xform(inkSel, inkIds, inkMatrix());
      return inkBox;
    }
  };

  var inkEditor = ChalkEdit(padWrap, inkAdapter, {
    live: function () {
      if (inkIds.length) {
        net.send({ t: "ink_live", sel: inkSel, ids: inkIds, m: inkMatrix() }, true);
      }
    },
    commit: function () { commitInk(); },
    select: function () {}
  });
  inkEditor.box.classList.add("chalk-sel-ink");

  function selectInk(ids) {
    ids = (ids || []).filter(function (id) { return !!surface.byId(id); });
    if (!ids.length) return clearInk();
    var box = surface.bboxOf(ids);
    if (!box) return clearInk();
    inkIds = ids;
    inkBox = { id: INK_ID, type: "ink", x: box.x, y: box.y, w: box.w, h: box.h, rot: 0 };
    inkBase = { x: box.x, y: box.y, w: box.w, h: box.h };
    inkSel = newSel();
    surface.dropXformBase();
    editor.select(null);
    inkEditor.select(INK_ID);
    renderInkBar();
  }

  function clearInk() {
    if (!inkIds.length && !inkBox) return;
    inkIds = [];
    inkBox = null;
    inkBase = null;
    inkEditor.select(null);
    renderInkBar();
  }

  /* Re-read the box off the ink itself. After a move the strokes are where
   * they are; after a turn their upright box is a different box entirely,
   * and the frame has to agree with what is on the board. */
  function reboxInk() {
    if (!inkIds.length) return;
    var live = inkIds.filter(function (id) { return !!surface.byId(id); });
    if (!live.length) return clearInk();
    var box = surface.bboxOf(live);
    if (!box) return clearInk();
    inkIds = live;
    inkBox = { id: INK_ID, type: "ink", x: box.x, y: box.y, w: box.w, h: box.h, rot: 0 };
    inkBase = { x: box.x, y: box.y, w: box.w, h: box.h };
    inkSel = newSel();
    surface.dropXformBase();
    inkEditor.select(INK_ID);
    renderInkBar();
  }

  function commitInk() {
    if (!inkIds.length || !inkBox || !inkBase) return;
    var m = inkMatrix();
    /* Claim this gesture before the server echoes it back, or the echo
     * applies the same move a second time. */
    surface.markXformDone(inkSel);
    net.send({ t: "ink_xform", sel: inkSel, ids: inkIds, m: m });
    setHistory(true, false);
    reboxInk();
  }

  function renderInkBar() {
    var n = inkIds.length;
    inkBar.hidden = n === 0;
    document.body.classList.toggle("ink-picked", n > 0);
    if (n) inkCount.textContent = n + (n === 1 ? " mark picked" : " marks picked");
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
    if (!found.length) {
      if (!inkAdd) clearInk();
      else say("Nothing written inside that box.");
      return;
    }
    selectInk(inkAdd ? inkIds.concat(found.filter(function (id) {
      return inkIds.indexOf(id) === -1;
    })) : found);
  }

  document.getElementById("ink-all").addEventListener("click", function () {
    setTool("select");
    selectInk(surface.allIds());
    if (!inkIds.length) say("There is no handwriting on this page yet.");
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
    if (!inkIds.length) return;
    var ids = inkIds.slice();
    surface.remove(ids);
    net.send({ t: "erase", ids: ids });
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
        { k: "font", type: "select", label: "Font",
          opts: [["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"], ["hand", "Handwriting"]] },
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
