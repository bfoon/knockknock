/* Drawing overlay for presenter.
 *
 * Uses TWO canvases:
 *   - inkCanvas   : persistent strokes (pen, highlighter)
 *   - laserCanvas : transient laser dot that fades every frame via RAF
 *
 * Tools: off | pen | highlight | laser
 * Public API:
 *   window.kkDrawOverlay(inkCanvas, laserCanvas, { onEvent })
 *     -> { setTool(t), setColor(c), clear(), resize(), drawRemote(evt) }
 */
(function () {
  window.kkDrawOverlay = function (inkCanvas, laserCanvas, opts) {
    const inkCtx   = inkCanvas.getContext("2d");
    const laserCtx = laserCanvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    let tool = "off";
    let color = "#fb7185";
    let drawing = false;
    let last = null;
    let laserPos = null;
    let laserAlpha = 0;
    let rafId = null;

    function fitOne(canvas, ctx) {
      const rect = canvas.getBoundingClientRect();
      canvas.width  = Math.max(1, Math.floor(rect.width  * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    }
    function fit() {
      fitOne(inkCanvas, inkCtx);
      fitOne(laserCanvas, laserCtx);
    }
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

    function pointFrom(e) {
      const rect = inkCanvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
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
      const m = hex.replace("#", "");
      const r = parseInt(m.substring(0, 2), 16);
      const g = parseInt(m.substring(2, 4), 16);
      const b = parseInt(m.substring(4, 6), 16);
      return `rgba(${r},${g},${b},${a})`;
    }

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

    function ensureLoop() {
      if (rafId != null) return;
      const tick = () => {
        const rect = laserCanvas.getBoundingClientRect();
        laserCtx.clearRect(0, 0, rect.width, rect.height);
        if (laserPos && laserAlpha > 0.01) {
          const P = localXY(laserCanvas, laserPos);
          laserCtx.save();
          laserCtx.globalCompositeOperation = "lighter";
          const grad = laserCtx.createRadialGradient(P.x, P.y, 0, P.x, P.y, 36);
          grad.addColorStop(0, hexA(color, 0.95 * laserAlpha));
          grad.addColorStop(0.4, hexA(color, 0.45 * laserAlpha));
          grad.addColorStop(1, hexA(color, 0));
          laserCtx.fillStyle = grad;
          laserCtx.beginPath();
          laserCtx.arc(P.x, P.y, 36, 0, Math.PI * 2);
          laserCtx.fill();
          laserCtx.fillStyle = `rgba(255,255,255,${0.9 * laserAlpha})`;
          laserCtx.beginPath();
          laserCtx.arc(P.x, P.y, 5, 0, Math.PI * 2);
          laserCtx.fill();
          laserCtx.restore();
          if (!(drawing && tool === "laser")) {
            laserAlpha *= 0.92;
          }
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
      opts.onEvent({
        ev,
        x: p ? p.x : null,
        y: p ? p.y : null,
        color, tool,
      });
    }

    function start(e) {
      if (tool === "off") return;
      e.preventDefault();
      drawing = true;
      const p = pointFrom(e);
      last = p;
      if (tool === "laser") {
        laserAt(p);
        emit("laser", p);
      } else if (tool === "pen") {
        dotInk(p, color, 3);
        emit("start", p);
      } else if (tool === "highlight") {
        emit("start", p);
      }
    }

    function move(e) {
      if (!drawing) return;
      e.preventDefault();
      const p = pointFrom(e);
      if (tool === "pen") {
        strokeFromTo(last, p, color, 3);
      } else if (tool === "highlight") {
        strokeFromTo(last, p, hexA(color, 0.30), 22, "lighter");
      } else if (tool === "laser") {
        laserAt(p);
        emit("laser", p);
        last = p;
        return;
      }
      emit("move", p);
      last = p;
    }

    function end() {
      if (!drawing) return;
      drawing = false;
      last = null;
      emit("end");
    }

    // The TOP canvas (laser) is the one that receives pointer events when any
    // tool is active. Both canvases sit over the chart with pointer-events: none
    // by default; .active toggles it on.
    laserCanvas.addEventListener("mousedown", start);
    laserCanvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    laserCanvas.addEventListener("touchstart", start, { passive: false });
    laserCanvas.addEventListener("touchmove",  move,  { passive: false });
    laserCanvas.addEventListener("touchend",   end);

    return {
      setTool(t) {
        tool = t;
        laserCanvas.classList.toggle("active", t !== "off");
      },
      setColor(c) { color = c; },
      clear() {
        const rect = inkCanvas.getBoundingClientRect();
        inkCtx.clearRect(0, 0, rect.width, rect.height);
        const rect2 = laserCanvas.getBoundingClientRect();
        laserCtx.clearRect(0, 0, rect2.width, rect2.height);
        laserPos = null; laserAlpha = 0;
      },
      resize() { fit(); },
      drawRemote(evt) {
        if (evt.ev === "laser") {
          const saved = color;
          color = evt.color || color;
          laserAt({ x: evt.x, y: evt.y });
          color = saved;
        } else if (evt.ev === "start") {
          dotInk({ x: evt.x, y: evt.y }, evt.color || color, evt.tool === "highlight" ? 12 : 3);
        }
      },
    };
  };
})();