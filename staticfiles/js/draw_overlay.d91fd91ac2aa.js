/* Drawing overlay for presenter. Tools: pen, highlighter, laser pointer.
 * Strokes are broadcast through the WebSocket so any "mirror" view could replay them.
 * Exposes:
 *   window.kkDrawOverlay(canvas, { onEvent: fn })
 *     -> { setTool(tool), setColor(c), clear(), drawRemote(evt) }
 */
(function () {
  window.kkDrawOverlay = function (canvas, opts) {
    const ctx = canvas.getContext("2d");
    let tool = "off";     // off | pen | highlight | laser
    let color = "#fb7185";
    let drawing = false;
    let last = null;
    let laserTimer = null;
    const dpr = window.devicePixelRatio || 1;

    function fit() {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }
    fit();
    window.addEventListener("resize", () => { const data = ctx.getImageData?.(0,0,canvas.width,canvas.height); fit(); });

    function pointFrom(e) {
      const rect = canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return {
        x: (p.clientX - rect.left) / rect.width,    // 0-1 normalized
        y: (p.clientY - rect.top) / rect.height,
      };
    }
    function localXY(p) {
      return { x: p.x * canvas.getBoundingClientRect().width, y: p.y * canvas.getBoundingClientRect().height };
    }

    function strokeFromTo(a, b, c, size, blend) {
      const A = localXY(a), B = localXY(b);
      ctx.save();
      ctx.globalCompositeOperation = blend || "source-over";
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = c; ctx.lineWidth = size;
      ctx.beginPath();
      ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y);
      ctx.stroke();
      ctx.restore();
    }

    function dot(p, c, size) {
      const P = localXY(p);
      ctx.save();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(P.x, P.y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function laserPing(p) {
      const P = localXY(p);
      ctx.save();
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.arc(P.x, P.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      clearTimeout(laserTimer);
      laserTimer = setTimeout(() => clear(), 250);
    }

    function emit(ev, p) {
      opts.onEvent && opts.onEvent({
        ev,
        x: p ? p.x : null,
        y: p ? p.y : null,
        color, tool,
      });
    }

    function clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    function start(e) {
      if (tool === "off") return;
      e.preventDefault();
      drawing = true;
      const p = pointFrom(e);
      last = p;
      if (tool === "laser") {
        laserPing(p);
        emit("laser", p);
      } else {
        dot(p, color, tool === "highlight" ? 12 : 3);
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
        strokeFromTo(last, p, hexA(color, .35), 22, "lighter");
      } else if (tool === "laser") {
        laserPing(p); emit("laser", p);
        last = p; return;
      }
      emit("move", p);
      last = p;
    }

    function end() {
      if (!drawing) return;
      drawing = false; last = null;
      emit("end");
    }

    function hexA(hex, a) {
      const m = hex.replace("#","");
      const r = parseInt(m.substring(0,2),16);
      const g = parseInt(m.substring(2,4),16);
      const b = parseInt(m.substring(4,6),16);
      return `rgba(${r},${g},${b},${a})`;
    }

    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);

    return {
      setTool(t) {
        tool = t;
        canvas.classList.toggle("active", t !== "off");
      },
      setColor(c) { color = c; },
      clear() { clear(); },
      // (Optional) remote draw events — for future presenter→viewer mirroring.
      drawRemote(evt) {
        const p = { x: evt.x, y: evt.y };
        if (evt.ev === "start") dot(p, evt.color, evt.tool === "highlight" ? 12 : 3);
        // simple — could keep a "last" per remote stroke for line continuation.
      },
      resize() { fit(); },
    };
  };
})();
