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

  var surface = new ChalkInk.Surface(pad);
  surface.setStrokes(CFG.strokes || []);

  var state = {
    tool: "pen",
    color: "#ffffff",
    width: 0.0038,      // normalised: fraction of board width
    zoom: 1,
    view: { x: 0, y: 0, s: 1 },
    pageIndex: CFG.pageIndex,
    pageCount: CFG.pageCount
  };

  var MIN_STEP = 0.0012;   // normalised distance before a point is worth sending
  var live = null;         // current stroke being drawn
  var pending = [];        // points captured since the last frame
  var erased = {};         // ids removed this gesture

  /* ------------------------------------------------------------------ */
  /* socket                                                              */
  /* ------------------------------------------------------------------ */

  var net = ChalkNet(CFG.code, {
    onOpen: function () { net.send({ t: "hello", role: "control", token: CFG.token }); },
    onState: function (s) {
      dot.dataset.state = s;
      statusText.textContent =
        s === "live" ? "Board connected" :
        s === "offline" ? "Reconnecting…" :
        s === "denied" ? "Pairing expired" : "Connecting…";
      document.body.dataset.net = s;
    },
    onMessage: handle
  });

  function handle(m) {
    switch (m.t) {
      case "ready":
      case "snapshot":
        surface.setStrokes(m.strokes || []);
        setPage(m.pageIndex, m.pageCount);
        setSurfaceButtons(m.surface);
        setHistory(m.canUndo, m.canRedo);
        break;
      case "erase":   surface.remove(m.ids); break;
      case "surface": setSurfaceButtons(m.surface); break;
      case "denied":
        document.getElementById("expired").hidden = false;
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* drawing                                                             */
  /* ------------------------------------------------------------------ */

  pad.style.touchAction = "none";

  pad.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
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

    live = {
      id: ChalkInk.newId(),
      tool: state.tool,
      color: state.color,
      w: state.width,
      pts: [round(p.x), round(p.y)]
    };
    surface.begin(live);
    net.send({ t: "stroke_start", stroke: live }, true);
  });

  pad.addEventListener("pointermove", function (e) {
    var events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];

    if (state.tool === "laser") {
      var lp = surface.toBoard(e.clientX, e.clientY);
      net.send({ t: "pointer", x: lp.x, y: lp.y, on: true }, true);
      return;
    }
    if (state.tool === "eraser") {
      if (e.buttons === 0 && e.pointerType === "mouse") return;
      if (!pad.hasPointerCapture(e.pointerId)) return;
      events.forEach(function (ev) { eraseAt(surface.toBoard(ev.clientX, ev.clientY)); });
      return;
    }
    if (!live) return;

    events.forEach(function (ev) {
      var p = surface.toBoard(ev.clientX, ev.clientY);
      var n = live.pts.length;
      var dx = p.x - live.pts[n - 2], dy = p.y - live.pts[n - 1];
      if (Math.hypot(dx, dy) < MIN_STEP / state.view.s) return;
      var rx = round(p.x), ry = round(p.y);
      live.pts.push(rx, ry);
      pending.push(rx, ry);
    });
    surface._liveDirty = true;
    schedule();
  });

  ["pointerup", "pointercancel", "pointerleave"].forEach(function (type) {
    pad.addEventListener(type, function (e) {
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
      flush();
      var done = live;
      live = null;
      surface.commit(done);
      net.send({ t: "stroke_end", stroke: done });
      setHistory(true, false);
      autoAdvance(done);
    });
  });

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
    var right = state.view.x + 1 / state.view.s;
    if (lastX > right - 0.12 / state.view.s) {
      panTo(state.view.x + 0.55 / state.view.s, state.view.y);
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
      b.dataset.on = String(Number(b.dataset.zoom) === s);
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
  mini.addEventListener("pointerup", function () { miniDrag = false; });

  /* ------------------------------------------------------------------ */
  /* tools, colours, width                                               */
  /* ------------------------------------------------------------------ */

  function setTool(tool) {
    state.tool = tool;
    document.querySelectorAll("[data-tool]").forEach(function (b) {
      b.dataset.on = String(b.dataset.tool === tool);
    });
    padWrap.dataset.tool = tool;
  }

  document.querySelectorAll("[data-tool]").forEach(function (b) {
    b.addEventListener("click", function () { setTool(b.dataset.tool); });
  });

  function setColor(hex) {
    state.color = hex;
    document.querySelectorAll("[data-color]").forEach(function (b) {
      b.dataset.on = String(b.dataset.color.toLowerCase() === hex.toLowerCase());
    });
    document.documentElement.style.setProperty("--pick", hex);
    if (state.tool === "eraser" || state.tool === "laser") setTool("pen");
  }

  document.querySelectorAll("[data-color]").forEach(function (b) {
    b.addEventListener("click", function () { setColor(b.dataset.color); });
  });
  customColor.addEventListener("input", function () { setColor(customColor.value); });

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
    document.getElementById("undo").disabled = !canUndo;
    document.getElementById("redo").disabled = !canRedo;
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
    document.querySelectorAll("[data-surface]").forEach(function (b) {
      b.dataset.on = String(b.dataset.surface === name);
    });
    padWrap.dataset.surface = name;
    /* A white pen on a whiteboard is invisible — nudge the default across. */
    if (name === "white" && state.color.toLowerCase() === "#ffffff") setColor("#111827");
    if (name !== "white" && state.color.toLowerCase() === "#111827") setColor("#ffffff");
  }

  function setPage(index, count) {
    state.pageIndex = index;
    state.pageCount = count;
    pageTag.textContent = (index + 1) + " / " + count;
    document.getElementById("page-prev").disabled = index <= 0;
  }

  document.getElementById("page-prev").addEventListener("click", function () {
    net.send({ t: "page", index: Math.max(0, state.pageIndex - 1) });
  });
  document.getElementById("page-next").addEventListener("click", function () {
    if (state.pageIndex + 1 < state.pageCount) net.send({ t: "page", index: state.pageIndex + 1 });
    else net.send({ t: "page_add" });
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
    navigator.wakeLock.request("screen").then(function (l) { lock = l; }).catch(function () {});
  }
  keepAwake();
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !lock) keepAwake();
  });

  /* Stop the page itself from scrolling or pinch-zooming under the pad. */
  document.addEventListener("gesturestart", function (e) { e.preventDefault(); });
  document.body.addEventListener("touchmove", function (e) {
    if (e.target.closest("#pad-wrap")) e.preventDefault();
  }, { passive: false });

  setTool("pen");
  setColor("#ffffff");
  setSurfaceButtons(CFG.surface);
  setPage(CFG.pageIndex, CFG.pageCount);
  setZoom(1);
})();
