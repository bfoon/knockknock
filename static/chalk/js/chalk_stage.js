/* Chalk — the projector. Renders only; it never originates ink. */
(function () {
  "use strict";

  var CFG = JSON.parse(document.getElementById("chalk-config").textContent);
  var boardEl = document.getElementById("board");
  var inkEl = document.getElementById("ink");
  var elsEl = document.getElementById("els");
  var laser = document.getElementById("laser");
  var lobby = document.getElementById("lobby");
  var dot = document.getElementById("net-dot");
  var phoneBadge = document.getElementById("phone-badge");
  var pageTag = document.getElementById("page-tag");
  var codeEl = document.getElementById("code-value");
  var qrImg = document.getElementById("qr-img");
  var linkEl = document.getElementById("join-link");

  var surface = new ChalkInk.Surface(inkEl);
  surface.setStrokes(CFG.strokes || []);
  var layer = new ChalkEls.Layer(elsEl);
  layer.setEls(CFG.els || []);
  setSurface(CFG.surface);
  setPageTag(CFG.pageIndex, CFG.pageCount);

  /* ---------------------------------------------------------------- */

  var net = ChalkNet(CFG.code, {
    onOpen: function () {
      net.send({ t: "hello", role: "stage", token: CFG.token });
    },
    onState: function (s) {
      dot.dataset.state = s;
      dot.title = s === "live" ? "Connected"
        : s === "offline" ? "Reconnecting"
        : s === "denied" ? "Not paired" : "Connecting";
    },
    onDenied: function (m) {
      showLobby(m.reason || "This board could not start.");
    },
    onMessage: handle
  });

  /* Timeout — the arcade needs the socket and the config, and nothing else
   * on this page needs to know it exists. */
  window.ChalkBoard = { net: net, cfg: CFG, role: "stage" };

  function handle(m) {
    switch (m.t) {
      case "ready":
      case "snapshot":
        surface.setStrokes(m.strokes || []);
        layer.setEls(m.els || []);
        setSurface(m.surface);
        setPageTag(m.pageIndex, m.pageCount);
        break;
      case "stroke_start": surface.begin(m.stroke); break;
      case "stroke_pts":   surface.extend(m.id, m.pts); break;
      case "stroke_end":   surface.commit(m.stroke); break;
      case "erase":        surface.remove(m.ids); break;
      /* undo / redo / clear arrive as an op instead of a full page. A busy
       * board used to rebroadcast every stroke on every undo tap. */
      case "ink":          surface.applyOps(m.add, m.del); break;
      /* Objects arrive as ops too, for the same reason: a page carrying
       * twenty photos should not be resent because somebody tapped Undo. */
      case "els":          layer.applyOps(m.add, m.del, m.edit); break;
      case "el_add":       layer.upsert(m.el); break;
      case "el_live":
      case "el_update":    layer.patch(m.id, m.patch); break;
      case "el_delete":    layer.remove(m.ids); break;
      case "el_raise":     layer.raise(m.id); break;
      case "surface":      setSurface(m.surface); break;
      case "pointer":      queueLaser(m); break;
      case "peer":         setPhone(m); break;
      /* Timeout frames are never stored and never touch the page. */
      case "game":         if (window.ChalkArcade) ChalkArcade.frame(m); break;
      case "denied":       break;  // handled in onDenied
    }
  }

  /* ---------------------------------------------------------------- */

  function setSurface(name) {
    if (!name) return;
    boardEl.dataset.surface = name;
  }

  function setPageTag(index, count) {
    if (typeof index !== "number") return;
    pageTag.textContent = count > 1 ? (index + 1) + " / " + count : "";
    pageTag.hidden = !(count > 1);
  }

  function setPhone(m) {
    if (m.role !== "control") return;
    var on = m.state === "joined";
    phoneBadge.dataset.on = on ? "1" : "0";
    phoneBadge.textContent = on ? "Phone connected" : "Phone disconnected";
    phoneBadge.hidden = false;
    clearTimeout(setPhone._t);
    if (on) setPhone._t = setTimeout(function () { phoneBadge.hidden = true; }, 2600);
  }

  /* ------------------------------ laser ---------------------------- */
  /* Pointer frames arrive up to 50x a second. Reading the rect and writing
   * the transform inline meant a forced layout per frame; coalesce into one
   * rAF and reuse the Surface's cached rect. */

  var laserFrame = null, laserMsg = null, laserOff;

  function queueLaser(m) {
    laserMsg = m;
    if (laserFrame) return;
    laserFrame = requestAnimationFrame(function () {
      laserFrame = null;
      var msg = laserMsg;
      laserMsg = null;
      if (!msg) return;
      if (!msg.on) { laser.hidden = true; return; }
      var r = surface.rect();
      laser.style.transform =
        "translate3d(" + (r.left + msg.x * r.width) + "px," +
        (r.top + msg.y * r.height) + "px,0)";
      laser.hidden = false;
      clearTimeout(laserOff);
      laserOff = setTimeout(function () { laser.hidden = true; }, 1400);
    });
  }

  /* ------------------------- lobby & fullscreen -------------------- */

  function showLobby(msg) {
    lobby.hidden = false;
    document.body.classList.remove("projecting");
    if (msg) {
      var e = document.getElementById("lobby-error");
      e.textContent = msg;
      e.hidden = false;
    }
  }

  function hideLobby() {
    lobby.hidden = true;
    document.body.classList.add("projecting");
  }

  document.getElementById("start-board").addEventListener("click", function () {
    hideLobby();
    wakeHud();
    var el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    keepAwake();
  });

  document.getElementById("show-lobby").addEventListener("click", function () {
    showLobby();
  });

  var boardsLink = document.getElementById("hud-boards");

  document.addEventListener("keydown", function (e) {
    /* Never steal a keystroke from a field — the lobby has one. */
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    wakeHud();
    if (e.key === "Escape") showLobby();
    if (e.key === "f" || e.key === "F") {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(function () {});
    }
    if ((e.key === "b" || e.key === "B") && boardsLink) {
      /* The page is saved continuously, so leaving is safe and needs no
       * confirmation. */
      location.href = boardsLink.href;
    }
  });

  /* Regenerate the pairing number.
   * CFG.rotateUrl and CFG.csrf are supplied by BoardStageView. They used to
   * be absent, so this fetched the string "undefined" with a null CSRF
   * header and the button could never succeed. */
  document.getElementById("rotate-code").addEventListener("click", function (ev) {
    var btn = ev.currentTarget;
    if (!CFG.rotateUrl || !CFG.csrf) {
      btn.textContent = "Unavailable";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Generating…";
    fetch(CFG.rotateUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRFToken": CFG.csrf, "X-Requested-With": "XMLHttpRequest" }
    })
      .then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      })
      .then(function (d) {
        if (!d.ok) throw new Error("refused");
        codeEl.textContent = d.prettyCode;
        qrImg.src = d.qr;
        linkEl.textContent = d.joinUrl;
        linkEl.href = d.joinUrl;
        /* The old code is dead — reload so the socket moves to the new room.
         * The server has already evicted anyone still in the old one. */
        setTimeout(function () { location.reload(); }, 900);
      })
      .catch(function () {
        btn.disabled = false;
        btn.textContent = "Try again";
      });
  });

  /* Keep the projector awake and hide the mouse pointer while presenting. */
  function keepAwake() {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      navigator.wakeLock.request("screen").catch(function () {});
    }
  }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && document.body.classList.contains("projecting")) {
      keepAwake();
    }
  });

  /* The corner bar fades to almost nothing while projecting so it does not
   * sit over the lesson. It used to come back only on :hover, which is no
   * help at all on a projector nobody has a mouse pointed at — the way out
   * of a full-screen board was effectively hidden. Any activity now wakes
   * it, and it stays awake long enough to actually click something. */
  var idle, hudSleep;
  var HUD_AWAKE_MS = 4000;
  var CURSOR_IDLE_MS = 2500;

  function wakeHud() {
    document.body.classList.add("hud-awake");
    clearTimeout(hudSleep);
    hudSleep = setTimeout(function () {
      document.body.classList.remove("hud-awake");
    }, HUD_AWAKE_MS);
  }

  function activity() {
    document.body.classList.remove("hide-cursor");
    wakeHud();
    clearTimeout(idle);
    idle = setTimeout(function () {
      if (document.body.classList.contains("projecting")) {
        document.body.classList.add("hide-cursor");
      }
    }, CURSOR_IDLE_MS);
  }

  ["mousemove", "pointerdown", "touchstart", "wheel"].forEach(function (type) {
    document.addEventListener(type, activity, { passive: true });
  });
})();
