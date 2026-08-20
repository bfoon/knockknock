/* Chalk — the phone. Every mark on the board starts here. */
(function () {
  "use strict";

  var CFG = JSON.parse(document.getElementById("chalk-config").textContent);

  var pad = document.getElementById("pad");
  var padWrap = document.getElementById("pad-wrap");
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

  var surface = new ChalkInk.Surface(pad);
  surface.setStrokes(CFG.strokes || []);

  var state = {
    tool: "pen",
    color: "#ffffff",
    colorPinned: false,  // did the teacher choose this colour deliberately?
    width: 0.0038,       // normalised: fraction of board width
    zoom: 1,
    view: { x: 0, y: 0, s: 1 },
    pageIndex: CFG.pageIndex,
    pageCount: CFG.pageCount
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
        break;
      case "ink":
        surface.applyOps(m.add, m.del);
        setHistory(m.canUndo, m.canRedo);
        break;
      case "surface": setSurfaceButtons(m.surface); break;
      case "denied":  break;  // handled in onDenied
    }
  }

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

  function panTo(x, y) {
    state.view = clampView(x, y, state.view.s);
    surface.setView(state.view);
    drawMini();
  }

  function setZoom(s) {
    var cx = state.view.x + 0.5 / state.view.s;
    var cy = state.view.y + 0.5 / state.view.s;
    state.zoom = s;
    state.view = clampView(cx - 0.5 / s, cy - 0.5 / s, s);
    surface.setView(state.view);
    document.querySelectorAll("[data-zoom]").forEach(function (b) {
      var on = Number(b.dataset.zoom) === s;
      b.dataset.on = String(on);
      b.setAttribute("aria-pressed", String(on));
    });
    mini.hidden = s === 1;
    drawMini();
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
    if (state.tool === "eraser" || state.tool === "laser") setTool("pen");
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

  document.getElementById("go-fs").addEventListener("click", function () {
    var el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    else document.body.classList.toggle("fs-fallback");
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

  setTool("pen");
  setColor(CFG.surface === "white" ? "#111827" : "#ffffff");
  setSurfaceButtons(CFG.surface);
  setPage(CFG.pageIndex, CFG.pageCount);
  setZoom(1);
})();
