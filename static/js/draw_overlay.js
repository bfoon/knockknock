/* Drawing overlay for presenter — v4.
 *
 * KEY CHANGE FROM v3:
 *   - Laser now follows the MOUSE (no click required), like a real laser pointer.
 *   - Pen/highlighter still need click-and-drag.
 *   - This is what was wrong before: laser required mousedown, so a single
 *     click left a frozen dot. Now it tracks pointermove constantly while
 *     the laser tool is active.
 *
 * Architecture:
 *   - inkCanvas   (z=5)  : persistent pen + highlighter strokes
 *   - laserCanvas (z=6)  : transient laser glow, RAF-animated, auto-fades
 *
 * If you see "[knock-knock] kkDrawOverlay v4 loaded" in devtools, the new
 * code is running. If you see v3 or nothing, your browser cached the old
 * file — hard refresh + run `python manage.py collectstatic --noinput`.
 */
console.log("[knock-knock] kkDrawOverlay v4 loaded");

(function () {
  window.kkDrawOverlay = function (inkCanvas, laserCanvas, opts) {
    if (!inkCanvas || !laserCanvas) {
      console.error("[knock-knock] kkDrawOverlay needs both ink & laser canvases");
      return { setTool(){}, setColor(){}, clear(){}, resize(){}, drawRemote(){} };
    }
    const inkCtx   = inkCanvas.getContext("2d");
    const laserCtx = laserCanvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    let tool = "off";
    let color = "#fb7185";
    let drawing = false;    // mousedown active (for pen/highlight only)
    let last = null;
    let laserPos = null;    // current laser position (canvas-normalized)
    let laserAlpha = 0;
    let laserActive = false; // cursor currently over canvas while laser tool selected
    let rafId = null;

    // ── sizing ──────────────────────────────────────────────────────
    function fitOne(canvas, ctx) {
      const rect = canvas.getBoundingClientRect();
      canvas.width  = Math.max(1, Math.floor(rect.width  * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
    function fit() { fitOne(inkCanvas, inkCtx); fitOne(laserCanvas, laserCtx); }
    fit();

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const tmp = document.createElement("canvas");
        tmp.width = inkCanvas.width; tmp.height = inkCanvas.height;
        tmp.getContext("2d").drawImage(inkCanvas, 0, 0);
        fit();
        const rect = inkCanvas.getBoundingClientRect();
        inkCtx.drawImage(tmp, 0, 0, rect.width, rect.height);
      }, 80);
    });

    // ── geometry helpers ────────────────────────────────────────────
    function pointFrom(e) {
      const rect = laserCanvas.getBoundingClientRect();
      const p = e.touches && e.touches[0] ? e.touches[0]
              : e.changedTouches && e.changedTouches[0] ? e.changedTouches[0]
              : e;
      return {
        x: (p.clientX - rect.left) / rect.width,
        y: (p.clientY - rect.top)  / rect.height,
      };
    }
    function localXY(canvas, p) {
      const rect = canvas.getBoundingClientRect();
      return { x: p.x * rect.width, y: p.y * rect.height };
    }
    function hexA(hex, a) {
      const m = (hex || "#fb7185").replace("#", "");
      const r = parseInt(m.substring(0, 2), 16);
      const g = parseInt(m.substring(2, 4), 16);
      const b = parseInt(m.substring(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    }

    // ── ink (pen / highlight) ───────────────────────────────────────
    function strokeFromTo(a, b, c, size, blend) {
      const A = localXY(inkCanvas, a), B = localXY(inkCanvas, b);
      inkCtx.save();
      inkCtx.globalCompositeOperation = blend || "source-over";
      inkCtx.lineCap = "round"; inkCtx.lineJoin = "round";
      inkCtx.strokeStyle = c; inkCtx.lineWidth = size;
      inkCtx.beginPath();
      inkCtx.moveTo(A.x, A.y); inkCtx.lineTo(B.x, B.y);
      inkCtx.stroke();
      inkCtx.restore();
    }
    function dotInk(p, c, size) {
      const P = localXY(inkCanvas, p);
      inkCtx.save();
      inkCtx.fillStyle = c;
      inkCtx.beginPath();
      inkCtx.arc(P.x, P.y, size / 2, 0, Math.PI * 2);
      inkCtx.fill();
      inkCtx.restore();
    }

    // ── laser RAF loop ──────────────────────────────────────────────
    function ensureLoop() {
      if (rafId != null) return;
      const tick = () => {
        const rect = laserCanvas.getBoundingClientRect();
        laserCtx.clearRect(0, 0, rect.width, rect.height);
        if (laserPos && laserAlpha > 0.01) {
          const P = localXY(laserCanvas, laserPos);
          laserCtx.save();
          laserCtx.globalCompositeOperation = "lighter";
          const grad = laserCtx.createRadialGradient(P.x, P.y, 0, P.x, P.y, 42);
          grad.addColorStop(0,   hexA(color, 0.95 * laserAlpha));
          grad.addColorStop(0.4, hexA(color, 0.45 * laserAlpha));
          grad.addColorStop(1,   hexA(color, 0));
          laserCtx.fillStyle = grad;
          laserCtx.beginPath();
          laserCtx.arc(P.x, P.y, 42, 0, Math.PI * 2);
          laserCtx.fill();
          // bright white core
          laserCtx.fillStyle = `rgba(255,255,255,${0.95 * laserAlpha})`;
          laserCtx.beginPath();
          laserCtx.arc(P.x, P.y, 6, 0, Math.PI * 2);
          laserCtx.fill();
          laserCtx.restore();
          // If cursor is over canvas with laser tool active, keep alpha at 1.
          // Otherwise fade out smoothly.
          if (!laserActive) laserAlpha *= 0.88;
          rafId = requestAnimationFrame(tick);
        } else {
          laserPos = null;
          rafId = null;
        }
      };
      rafId = requestAnimationFrame(tick);
    }

    function laserAt(p) {
      laserPos = p;
      laserAlpha = 1;
      ensureLoop();
    }

    function emit(ev, p) {
      if (!opts || !opts.onEvent) return;
      opts.onEvent({ ev, x: p ? p.x : null, y: p ? p.y : null, color, tool });
    }

    // ── handlers ────────────────────────────────────────────────────
    function onPointerEnter(e) {
      if (tool === "laser") {
        laserActive = true;
        const p = pointFrom(e);
        laserAt(p);
        emit("laser", p);
      }
    }
    function onPointerLeave() {
      laserActive = false;   // RAF will fade out from here
    }

    function onPointerMove(e) {
      const p = pointFrom(e);
      if (tool === "laser") {
        laserActive = true;
        laserAt(p);
        emit("laser", p);
        return;
      }
      if (!drawing) return;
      e.preventDefault();
      if (tool === "pen") {
        strokeFromTo(last, p, color, 3);
      } else if (tool === "highlight") {
        strokeFromTo(last, p, hexA(color, 0.30), 22, "lighter");
      }
      emit("move", p);
      last = p;
    }

    function onPointerDown(e) {
      if (tool === "off" || tool === "laser") return;  // laser needs no clicks
      e.preventDefault();
      drawing = true;
      const p = pointFrom(e);
      last = p;
      if (tool === "pen") {
        dotInk(p, color, 3);
        emit("start", p);
      } else if (tool === "highlight") {
        emit("start", p);
      }
    }

    function onPointerUp() {
      if (!drawing) return;
      drawing = false;
      last = null;
      emit("end");
    }

    // mouse
    laserCanvas.addEventListener("mouseenter", onPointerEnter);
    laserCanvas.addEventListener("mouseleave", onPointerLeave);
    laserCanvas.addEventListener("mousedown",  onPointerDown);
    laserCanvas.addEventListener("mousemove",  onPointerMove);
    window.addEventListener("mouseup", onPointerUp);

    // touch (laser tracks finger drag; pen needs touch-and-hold drag)
    laserCanvas.addEventListener("touchstart", (e) => {
      if (tool === "laser") {
        laserActive = true;
        const p = pointFrom(e);
        laserAt(p); emit("laser", p);
        e.preventDefault();
      } else {
        onPointerDown(e);
      }
    }, { passive: false });
    laserCanvas.addEventListener("touchmove", onPointerMove, { passive: false });
    laserCanvas.addEventListener("touchend", (e) => {
      if (tool === "laser") {
        laserActive = false;  // start fade
      } else {
        onPointerUp();
      }
    });

    return {
      setTool(t) {
        tool = t;
        laserCanvas.classList.toggle("active", t !== "off");
        // Belt-and-braces inline styles in case CSS didn't load
        laserCanvas.style.pointerEvents = (t !== "off") ? "auto" : "none";
        if (t === "laser")        laserCanvas.style.cursor = "none";
        else if (t !== "off")     laserCanvas.style.cursor = "crosshair";
        else                      laserCanvas.style.cursor = "default";
        if (t !== "laser") {
          laserActive = false;  // let any active dot fade
        }
        console.log("[knock-knock] tool →", t);
      },
      setColor(c) { color = c; },
      clear() {
        const r1 = inkCanvas.getBoundingClientRect();
        inkCtx.clearRect(0, 0, r1.width, r1.height);
        const r2 = laserCanvas.getBoundingClientRect();
        laserCtx.clearRect(0, 0, r2.width, r2.height);
        laserPos = null; laserAlpha = 0;
      },
      resize() {
          const rect = inkCanvas.getBoundingClientRect();

          if (!rect.width || !rect.height) {
            return;
          }

          const tmp = document.createElement("canvas");
          tmp.width = inkCanvas.width;
          tmp.height = inkCanvas.height;

          try {
            tmp.getContext("2d").drawImage(inkCanvas, 0, 0);
          } catch (e) {}

          fit();

          try {
            inkCtx.drawImage(tmp, 0, 0, rect.width, rect.height);
          } catch (e) {}
        },
      drawRemote(evt) {
        if (evt.ev === "laser") {
          const saved = color;
          color = evt.color || color;
          laserAt({ x: evt.x, y: evt.y });
          color = saved;
        } else if (evt.ev === "start") {
          dotInk({ x: evt.x, y: evt.y }, evt.color || color,
                 evt.tool === "highlight" ? 12 : 3);
        }
      },
    };
  };
})();