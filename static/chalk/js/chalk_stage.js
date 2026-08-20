/* Chalk — the projector. Renders only; it never originates ink. */
(function () {
  "use strict";

  var CFG = JSON.parse(document.getElementById("chalk-config").textContent);
  var boardEl = document.getElementById("board");
  var inkEl = document.getElementById("ink");
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
  setSurface(CFG.surface);
  setPageTag(CFG.pageIndex, CFG.pageCount);

  /* ---------------------------------------------------------------- */

  var net = ChalkNet(CFG.code, {
    onOpen: function () {
      net.send({ t: "hello", role: "stage", token: CFG.token });
    },
    onState: function (s) {
      dot.dataset.state = s;
      dot.title = s === "live" ? "Connected" : s === "offline" ? "Reconnecting" : s;
    },
    onMessage: handle
  });

  function handle(m) {
    switch (m.t) {
      case "ready":
      case "snapshot":
        surface.setStrokes(m.strokes || []);
        setSurface(m.surface);
        setPageTag(m.pageIndex, m.pageCount);
        break;
      case "stroke_start": surface.begin(m.stroke); break;
      case "stroke_pts":   surface.extend(m.id, m.pts); break;
      case "stroke_end":   surface.commit(m.stroke); break;
      case "erase":        surface.remove(m.ids); break;
      case "surface":      setSurface(m.surface); break;
      case "pointer":      moveLaser(m); break;
      case "peer":         setPhone(m); break;
      case "denied":       showLobby("This board could not start: " + m.reason); break;
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

  var laserOff;
  function moveLaser(m) {
    if (!m.on) { laser.hidden = true; return; }
    var r = inkEl.getBoundingClientRect();
    laser.style.transform =
      "translate(" + (r.left + m.x * r.width) + "px," + (r.top + m.y * r.height) + "px)";
    laser.hidden = false;
    clearTimeout(laserOff);
    laserOff = setTimeout(function () { laser.hidden = true; }, 1400);
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
    var el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    keepAwake();
  });

  document.getElementById("show-lobby").addEventListener("click", function () {
    showLobby();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") showLobby();
    if (e.key === "f" || e.key === "F") {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(function () {});
    }
  });

  /* Regenerate the pairing number. */
  document.getElementById("rotate-code").addEventListener("click", function (ev) {
    var btn = ev.currentTarget;
    btn.disabled = true;
    btn.textContent = "Generating…";
    fetch(CFG.rotateUrl, {
      method: "POST",
      headers: { "X-CSRFToken": CFG.csrf, "X-Requested-With": "XMLHttpRequest" }
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error();
        codeEl.textContent = d.prettyCode;
        qrImg.src = d.qr;
        linkEl.textContent = d.joinUrl;
        linkEl.href = d.joinUrl;
        /* The old code is dead — reload so the socket moves to the new room. */
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
  var idle;
  document.addEventListener("mousemove", function () {
    document.body.classList.remove("hide-cursor");
    clearTimeout(idle);
    idle = setTimeout(function () {
      if (document.body.classList.contains("projecting")) {
        document.body.classList.add("hide-cursor");
      }
    }, 2500);
  });
})();
