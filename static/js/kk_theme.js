/* KnockKnock live poll themes.
 *
 * Before this, a poll's theme was baked into the page once at render time:
 * changing it meant reloading every screen, and a slide's own theme
 * (Question.template_id_override) was never used at all.
 *
 * Now, on the presenter screen (present.html, polls) and every phone
 * (play_poll.html):
 *   • A slide with its own theme restyles the stage when it comes up, with a
 *     soft crossfade, and goes back to the deck theme on the next slide.
 *   • Changing the deck theme (editor Theme Studio, or the 🎨 switcher on
 *     the presenter screen) restyles all open screens instantly — the server
 *     broadcasts {type:"theme"} / {type:"slide_theme"}.
 *   • Presenter: 🎨 button (or press T) opens a theme switcher with live
 *     search, light/dark/photo filters and "Surprise me".
 *
 * Purely additive: wraps window.WebSocket (like the other shims) and
 * repaints the same CSS variables / background the templates already use,
 * so charts and text pick the theme up through --stage-fg / --stage-accent.
 *
 * Needs, before present.js / play.js:
 *   {{ themes|json_script:"kk-themes-json" }} and data-theme on #stage / #play.
 */
(function () {
  "use strict";

  var stage = document.getElementById("stage");
  var play = document.getElementById("play");
  var IS_HOST = !!(stage && stage.dataset.kind === "poll");
  var IS_PHONE = !IS_HOST && !!(play && play.dataset.kind === "poll");
  if (!IS_HOST && !IS_PHONE) return;

  var dataEl = document.getElementById("kk-themes-json");
  if (!dataEl) return;
  var THEMES = [];
  try { THEMES = JSON.parse(dataEl.textContent || "[]"); } catch (e) { return; }
  var BY_ID = {};
  THEMES.forEach(function (t) { BY_ID[t.id] = t; });

  var root = IS_HOST ? stage : play;
  var target = IS_HOST ? stage : document.body;   // element that carries the background
  var baseId = BY_ID[root.dataset.theme] ? root.dataset.theme : (THEMES[0] && THEMES[0].id);
  var slideId = "";
  var shownId = baseId;
  var currentQ = null;

  function $(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // ───────────────────────── styles ─────────────────────────
  var css = document.createElement("style");
  css.textContent = [
    // Hide the static overlay baked in at render once we take over.
    ".kkt-on::before{opacity:0!important}",
    // Two-class selectors so present.html's `.kk-stage > *` rule can't win.
    ".kk-stage > .kkt-layer, body > .kkt-layer{position:absolute;inset:0;z-index:0;pointer-events:none}",
    "body > .kkt-layer{position:fixed}",
    ".kkt-layer > i{position:absolute;inset:0;display:block}",
    ".kkt-ov{background-repeat:repeat}",
    ".kkt-fade{transition:opacity .9s ease}",
    // Phones: app.css paints .kk-play solid near-black (--kk-bg), which hid
    // every poll theme on phones — even before live themes existed. Let the
    // themed body show through, and frost the cards so text stays readable
    // on light and dark themes alike.
    "body.kkt-on .kk-play{--p-bg:transparent;--p-fg:var(--stage-fg);background:transparent;color:var(--stage-fg)}",
    "body.kkt-on .kk-play-card{background:color-mix(in srgb,var(--stage-bg) 62%,transparent);border-color:color-mix(in srgb,var(--stage-fg) 16%,transparent);",
    "backdrop-filter:blur(12px) saturate(1.2);-webkit-backdrop-filter:blur(12px) saturate(1.2);color:var(--stage-fg)}",
    "body.kkt-on .kk-play .text-secondary{color:color-mix(in srgb,var(--stage-fg) 70%,transparent)!important}",
    // presenter switcher
    ".kk-stage > .kkt-panel{position:fixed;z-index:3000}",
    ".kkt-panel{top:64px;right:16px;width:min(420px,calc(100vw - 32px));max-height:calc(100vh - 90px);display:flex;flex-direction:column;",
    "background:rgba(12,10,30,.92);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1px solid rgba(255,255,255,.14);",
    "border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.5);color:#f8fafc;font:500 14px system-ui,sans-serif;",
    "opacity:0;transform:translateY(-8px) scale(.98);pointer-events:none;transition:opacity .18s,transform .18s}",
    ".kkt-panel.is-open{opacity:1;transform:none;pointer-events:auto}",
    ".kkt-head{display:flex;align-items:center;gap:8px;padding:14px 14px 8px}",
    ".kkt-head b{font:700 15px 'Clash Display',system-ui,sans-serif;flex:1}",
    ".kkt-x,.kkt-dice{all:unset;cursor:pointer;width:32px;height:32px;border-radius:10px;display:grid;place-items:center;background:rgba(255,255,255,.08)}",
    ".kkt-x:hover,.kkt-dice:hover{background:rgba(255,255,255,.18)}",
    ".kkt-tools{display:flex;gap:6px;flex-wrap:wrap;padding:0 14px 10px}",
    ".kkt-search{flex:1 1 100%;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#fff;padding:8px 10px;font:inherit;outline:none}",
    ".kkt-search:focus{border-color:#a78bfa}",
    ".kkt-chip{all:unset;cursor:pointer;padding:5px 11px;border-radius:999px;background:rgba(255,255,255,.07);font-size:12px;font-weight:700}",
    ".kkt-chip.is-on{background:#7c3aed}",
    ".kkt-note{margin:0 14px 10px;padding:8px 10px;border-radius:10px;background:rgba(251,191,36,.14);color:#fde68a;font-size:12.5px;line-height:1.35}",
    ".kkt-note button{all:unset;cursor:pointer;text-decoration:underline;font-weight:700;margin-left:4px}",
    ".kkt-grid{flex:1 1 auto;min-height:0;overflow:auto;padding:2px 14px 14px;display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:78px;gap:8px}",
    ".kkt-tile{all:unset;box-sizing:border-box;display:block;width:100%;cursor:pointer;position:relative;border-radius:12px;overflow:hidden;height:78px;box-shadow:0 0 0 2px transparent;transition:transform .12s,box-shadow .15s}",
    ".kkt-tile:hover{transform:translateY(-2px)}",
    ".kkt-tile.is-on{box-shadow:0 0 0 3px #a78bfa}",
    ".kkt-tile:focus-visible{box-shadow:0 0 0 3px #22d3ee}",
    ".kkt-tile .bg,.kkt-tile .ov{position:absolute;inset:0}",
    ".kkt-tile .ov{background-repeat:repeat}",
    ".kkt-tile .bars{position:absolute;left:10%;right:10%;bottom:28%;height:30%;display:flex;align-items:flex-end;gap:8%}",
    ".kkt-tile .bars span{flex:1;border-radius:3px 3px 0 0}",
    ".kkt-tile .nm{position:absolute;left:0;right:0;bottom:0;padding:4px 6px;font:700 11px system-ui,sans-serif;background:linear-gradient(transparent,rgba(0,0,0,.7));color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".kkt-tile.is-on::after{content:'✓';position:absolute;top:5px;right:6px;width:20px;height:20px;border-radius:50%;background:#7c3aed;color:#fff;display:grid;place-items:center;font:800 12px system-ui}",
    ".kk-stage > .kkt-toast, body > .kkt-toast{position:fixed;z-index:3001}",
    ".kkt-toast{left:50%;bottom:28px;transform:translate(-50%,20px);opacity:0;padding:10px 18px;border-radius:999px;",
    "background:rgba(12,10,30,.88);color:#fff;font:700 15px 'Clash Display',system-ui,sans-serif;border:1px solid rgba(255,255,255,.16);",
    "transition:opacity .25s,transform .25s;pointer-events:none;white-space:nowrap}",
    ".kkt-toast.is-on{opacity:1;transform:translate(-50%,0)}",
    "@media (prefers-reduced-motion: reduce){.kkt-fade{transition:none}}",
  ].join("");
  document.head.appendChild(css);

  // ───────────────────────── painting ─────────────────────────
  var ovLayer = document.createElement("div");
  ovLayer.className = "kkt-layer kkt-ov";
  target.insertBefore(ovLayer, target.firstChild);

  function bgOf(t) { return t.bg_css || t.bg || "#111"; }

  function paint(t) {
    target.style.setProperty("--stage-bg", t.bg);
    target.style.setProperty("--stage-fg", t.fg);
    target.style.setProperty("--stage-accent", t.accent);
    target.style.setProperty("--stage-accent-2", t.accent2);
    target.style.background = bgOf(t);
    if (IS_PHONE) {
      target.style.backgroundAttachment = "fixed";
      target.style.color = t.fg;
    }
    ovLayer.style.backgroundImage = t.overlay || "none";
    target.classList.add("kkt-on");
  }

  function apply(id, animate) {
    var t = BY_ID[id];
    if (!t || id === shownId) return;
    var old = BY_ID[shownId];
    if (animate && old && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Crossfade: freeze the old look on a layer above the background,
      // repaint underneath, then fade the old layer away.
      var fade = document.createElement("div");
      fade.className = "kkt-layer kkt-fade";
      fade.innerHTML = '<i></i><i class="kkt-ov"></i>';
      // Style API, not an inline attribute: the data-URI overlays contain quotes.
      fade.children[0].style.background = bgOf(old);
      fade.children[1].style.backgroundImage = old.overlay || "none";
      ovLayer.insertAdjacentElement("afterend", fade);
      paint(t);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { fade.style.opacity = "0"; });
      });
      setTimeout(function () { fade.remove(); }, 1000);
    } else {
      paint(t);
    }
    shownId = id;
    window.dispatchEvent(new CustomEvent("kk:theme-applied", { detail: t }));
    if (panel) markPanel();
  }

  function effectiveId() {
    return (slideId && BY_ID[slideId]) ? slideId : baseId;
  }
  function refresh(animate) { apply(effectiveId(), animate !== false); }

  // First paint: take over from the server-rendered theme without a fade.
  paint(BY_ID[shownId] || THEMES[0]);

  // ───────────────────────── socket tap ─────────────────────────
  function onMessage(m) {
    if (!m || typeof m !== "object") return;
    if (m.type === "state") {
      if (m.template_id && BY_ID[m.template_id]) baseId = m.template_id;
      currentQ = m.question || null;
      slideId = currentQ && currentQ.template_id ? currentQ.template_id : "";
      refresh(true);
    } else if (m.type === "theme") {
      if (BY_ID[m.template_id]) { baseId = m.template_id; refresh(true); }
    } else if (m.type === "slide_theme") {
      if (currentQ && String(currentQ.id) === String(m.question_id)) {
        currentQ.template_id = m.template_id || "";
        slideId = currentQ.template_id;
        refresh(true);
      }
    }
  }
  (function wrap() {
    var Real = window.WebSocket;
    function W(url, protocols) {
      var ws = protocols ? new Real(url, protocols) : new Real(url);
      if (typeof url === "string" && url.indexOf("/ws/session/") !== -1) {
        ws.addEventListener("message", function (ev) {
          try { onMessage(JSON.parse(ev.data)); } catch (e) { /* not ours */ }
        });
      }
      return ws;
    }
    W.prototype = Real.prototype;
    W.CONNECTING = Real.CONNECTING; W.OPEN = Real.OPEN; W.CLOSING = Real.CLOSING; W.CLOSED = Real.CLOSED;
    window.WebSocket = W;
  })();

  // ───────────────────────── toast ─────────────────────────
  var toastEl = null, toastT = null;
  function toast(text) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "kkt-toast";
      toastEl.setAttribute("role", "status");
      (IS_HOST ? stage : document.body).appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.classList.add("is-on");
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove("is-on"); }, 1900);
  }
  if (IS_PHONE) {
    window.addEventListener("kk:theme-applied", function (e) {
      // Only announce real changes after the first slide, not every refresh.
      if (onMessage._seen) toast("🎨 " + e.detail.name);
    });
    setTimeout(function () { onMessage._seen = true; }, 2500);
  }

  // ───────────────────────── presenter switcher ─────────────────────────
  var panel = null, filter = "all", query = "";
  var saveUrl = root.dataset.themeUrl || "";
  var slideUrlTpl = root.dataset.slideThemeUrl || "";
  var csrfEl = $("kkt-csrf");

  function post(url, body) {
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrfEl ? csrfEl.value : "" },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) throw new Error("save failed");
      return r.json();
    });
  }

  function tileHtml(t) {
    return '<button type="button" class="kkt-tile" data-id="' + esc(t.id) + '" title="' + esc(t.name) + '" aria-label="' + esc(t.name) + ' theme">' +
      '<span class="bg"></span><span class="ov"></span>' +
      '<span class="bars"><span style="height:45%;background:' + esc(t.accent) + '"></span><span style="height:90%;background:' + esc(t.accent2) + '"></span><span style="height:65%;background:' + esc(t.accent) + '"></span></span>' +
      '<span class="nm">' + esc(t.name) + "</span></button>";
  }

  function buildPanel() {
    panel = document.createElement("div");
    panel.className = "kkt-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Presentation theme");
    panel.innerHTML =
      '<div class="kkt-head"><b>🎨 Theme</b><button type="button" class="kkt-dice" title="Surprise me" aria-label="Surprise me">🎲</button>' +
      '<button type="button" class="kkt-x" aria-label="Close">✕</button></div>' +
      '<div class="kkt-tools"><input class="kkt-search" type="search" placeholder="Search themes…" aria-label="Search themes">' +
      ["all:All", "dark:Dark", "light:Light", "photo:Photo", "pattern:Pattern"].map(function (c) {
        var p = c.split(":");
        return '<button type="button" class="kkt-chip' + (p[0] === "all" ? " is-on" : "") + '" data-f="' + p[0] + '">' + p[1] + "</button>";
      }).join("") + "</div>" +
      '<div class="kkt-note" hidden></div>' +
      '<div class="kkt-grid">' + THEMES.map(tileHtml).join("") + "</div>";
    stage.appendChild(panel);

    // Backgrounds set through the style API: the data-URI overlays contain
    // quotes that would break an inline style attribute.
    panel.querySelectorAll(".kkt-tile").forEach(function (b) {
      var t = BY_ID[b.dataset.id];
      b.querySelector(".bg").style.background = bgOf(t);
      b.querySelector(".ov").style.backgroundImage = t.overlay || "none";
    });

    panel.querySelector(".kkt-x").addEventListener("click", closePanel);
    panel.querySelector(".kkt-dice").addEventListener("click", function () {
      var pool = THEMES.filter(function (t) { return t.id !== baseId; });
      choose(pool[Math.floor(Math.random() * pool.length)].id);
    });
    panel.querySelector(".kkt-search").addEventListener("input", function (e) { query = e.target.value.trim().toLowerCase(); filterTiles(); });
    panel.querySelectorAll(".kkt-chip").forEach(function (c) {
      c.addEventListener("click", function () {
        filter = c.dataset.f;
        panel.querySelectorAll(".kkt-chip").forEach(function (x) { x.classList.toggle("is-on", x === c); });
        filterTiles();
      });
    });
    panel.querySelector(".kkt-grid").addEventListener("click", function (e) {
      var b = e.target.closest(".kkt-tile");
      if (b) choose(b.dataset.id);
    });
    panel.querySelector(".kkt-note").addEventListener("click", function (e) {
      if (!e.target.closest("button") || !currentQ) return;
      var url = slideUrlTpl.replace("/0/theme/", "/" + currentQ.id + "/theme/");
      post(url, { template_id: "" }).then(function () {
        currentQ.template_id = ""; slideId = ""; refresh(true); markPanel();
        toast("Slide now uses the deck theme");
      }).catch(function () { toast("Couldn't clear the slide theme"); });
    });
    markPanel();
  }

  function filterTiles() {
    panel.querySelectorAll(".kkt-tile").forEach(function (b) {
      var t = BY_ID[b.dataset.id];
      var okF = filter === "all" || t.tone === filter || t.kind === filter;
      var okQ = !query || t.name.toLowerCase().indexOf(query) >= 0;
      b.style.display = okF && okQ ? "" : "none";
    });
  }

  function markPanel() {
    if (!panel) return;
    panel.querySelectorAll(".kkt-tile").forEach(function (b) {
      var on = b.dataset.id === baseId;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var note = panel.querySelector(".kkt-note");
    var own = slideId && BY_ID[slideId];
    note.hidden = !own;
    if (own) {
      note.innerHTML = "This slide has its own theme (<b>" + esc(own.name) + "</b>). The deck theme changes every other slide." +
        (slideUrlTpl ? '<button type="button">Use deck theme here</button>' : "");
    }
  }

  function choose(id) {
    if (!BY_ID[id]) return;
    var prev = baseId;
    baseId = id;
    refresh(true);
    markPanel();
    toast("🎨 " + BY_ID[id].name);
    if (!saveUrl) return;
    post(saveUrl, { template_id: id }).catch(function () {
      baseId = prev; refresh(true); markPanel();
      toast("Theme not saved — check your connection");
    });
  }

  function openPanel() {
    if (!panel) buildPanel();
    markPanel();
    panel.classList.add("is-open");
    var s = panel.querySelector(".kkt-search");
    setTimeout(function () { s.focus({ preventScroll: true }); }, 50);
  }
  function closePanel() { if (panel) panel.classList.remove("is-open"); }
  function togglePanel() { panel && panel.classList.contains("is-open") ? closePanel() : openPanel(); }

  function hostBoot() {
    if (!saveUrl) return;
    var fs = $("btn-fs");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kk-btn kk-btn-ghost btn-sm";
    btn.id = "kkt-btn";
    btn.title = "Theme (T)";
    btn.setAttribute("aria-label", "Change theme");
    btn.innerHTML = '<i class="bi bi-palette2"></i>';
    if (fs && fs.parentNode) fs.parentNode.insertBefore(btn, fs);
    btn.addEventListener("click", function (e) { e.stopPropagation(); togglePanel(); });

    document.addEventListener("keydown", function (e) {
      var tag = document.activeElement ? document.activeElement.tagName : "";
      if (["INPUT", "TEXTAREA", "SELECT"].indexOf(tag) >= 0) {
        if (e.key === "Escape") closePanel();
        return;
      }
      if (e.key === "t" || e.key === "T") togglePanel();
      if (e.key === "Escape") closePanel();
    });
    document.addEventListener("pointerdown", function (e) {
      if (panel && panel.classList.contains("is-open") && !panel.contains(e.target) && !e.target.closest("#kkt-btn")) closePanel();
    });
  }

  if (IS_HOST) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hostBoot);
    else hostBoot();
  }

  window.KKTheme = { apply: function (id) { baseId = id; refresh(true); }, current: function () { return shownId; }, themes: THEMES };
})();
