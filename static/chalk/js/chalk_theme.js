/* Chalk labs — scenes: choose the room you work in.
 *
 * Shared by the Circuit Lab and the Power Lab. A scene is a set of colours
 * for the panels and for the work surface (chalk_theme.css holds them);
 * this file remembers which one you picked — in this browser, for both
 * labs — puts a "Scene" button in the top bar, and lets you choose any
 * colour at all for the surface, working out grid lines and label ink that
 * will show up on it.
 *
 * It runs in <head>, before the page is drawn, so a light scene never
 * flashes dark first.
 *
 *   ChalkTheme.set(id)      ChalkTheme.surface("#aabbcc" | null)
 *   ChalkTheme.colors()     {paper, grid, ink} for code that paints a canvas
 *   window "chalk-theme"    fired whenever any of it changes
 */
(function (root) {
  "use strict";

  var doc = root.document, html = doc.documentElement, KEY = "chalk.scene";
  var SCENES = [
    ["workshop", "Workshop", "#121a21", "#1f3238"], ["daylight", "Daylight", "#f3f1ec", "#e8eef0"], ["graph", "Graph paper", "#121a21", "#fbfcfa"], ["blueprint", "Blueprint", "#0c1730", "#1a4b96"],
    ["chalkboard", "Chalkboard", "#131c17", "#24493b"], ["kraft", "Kraft", "#1f1913", "#c2a273"], ["plum", "Plum", "#1a1222", "#37223f"], ["night", "Night", "#05070a", "#0b1015"]
  ];
  var state = { scene: "workshop", surface: null };
  try { var kept = JSON.parse(root.localStorage.getItem(KEY) || "{}"); if (kept.scene) state.scene = kept.scene; if (/^#[0-9a-f]{6}$/i.test(kept.surface || "")) state.surface = kept.surface; } catch (e) {}
  if (!SCENES.some(function (s) { return s[0] === state.scene; })) state.scene = "workshop";

  function rgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
  function lum(c) { return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
  function mix(c, to, f) { return "rgb(" + c.map(function (v, i) { return Math.round(v + (to[i] - v) * f); }).join(",") + ")"; }

  function apply() {
    if (state.scene === "workshop") html.removeAttribute("data-theme"); else html.setAttribute("data-theme", state.scene);
    if (state.surface) {
      /* grid lines lean towards whichever of black and white the colour is furthest from */
      var c = rgb(state.surface), light = lum(c) > 0.55, to = light ? [0, 0, 0] : [255, 255, 255];
      html.setAttribute("data-mat", "custom");
      html.style.setProperty("--mat-custom", state.surface);
      html.style.setProperty("--mat-custom-line", mix(c, to, light ? 0.09 : 0.08));
      html.style.setProperty("--mat-custom-strong", mix(c, to, light ? 0.2 : 0.17));
      html.style.setProperty("--mat-custom-grid", light ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.09)");
      html.style.setProperty("--mat-custom-ink", light ? "rgba(20,28,36,.82)" : "rgba(232,238,244,.78)");
    } else {
      html.removeAttribute("data-mat");
      ["--mat-custom", "--mat-custom-line", "--mat-custom-strong", "--mat-custom-grid", "--mat-custom-ink"].forEach(function (k) { html.style.removeProperty(k); });
    }
    cache = null;
    try { root.dispatchEvent(new root.CustomEvent("chalk-theme", { detail: state })); } catch (e) {}
  }
  function save() { try { root.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  var cache = null;
  var T = root.ChalkTheme = {
    scenes: SCENES,
    get: function () { return { scene: state.scene, surface: state.surface }; },
    set: function (id) { if (SCENES.some(function (s) { return s[0] === id; })) { state.scene = id; state.surface = null; apply(); save(); paint(); } },
    surface: function (hex) { state.surface = hex && /^#[0-9a-f]{6}$/i.test(hex) ? hex : null; apply(); save(); paint(); },
    /* For canvases: the surface, its grid, and ink that reads on it. */
    colors: function () {
      if (cache) return cache;
      var cs = root.getComputedStyle(html), v = function (k, d) { return cs.getPropertyValue(k).trim() || d; };
      return (cache = { paper: v("--pw-paper", "#15242b"), grid: v("--pw-grid", "rgba(120,170,190,.08)"), ink: v("--pw-ink", "rgba(232,238,244,.75)") });
    }
  };
  apply();
  root.addEventListener("storage", function (e) { if (e.key !== KEY) return; try { var k = JSON.parse(e.newValue || "{}"); state.scene = k.scene || "workshop"; state.surface = k.surface || null; apply(); paint(); } catch (err) {} });

  /* ---------------------------------------------------------------- picker */

  var pop = null, btn = null;
  function paint() {
    if (!pop) return;
    Array.prototype.forEach.call(pop.querySelectorAll(".th-scene"), function (b) { b.setAttribute("aria-pressed", String(!state.surface && b.getAttribute("data-scene") === state.scene)); });
    var c = pop.querySelector("#th-color"), cur = state.surface || (SCENES.filter(function (s) { return s[0] === state.scene; })[0] || SCENES[0])[3];
    if (c && c.value !== cur) c.value = cur;
    pop.querySelector("#th-reset").hidden = !state.surface;
  }
  function close() { if (pop) { pop.remove(); pop = null; doc.removeEventListener("pointerdown", outside, true); doc.removeEventListener("keydown", esc, true); if (btn) btn.setAttribute("aria-expanded", "false"); } }
  function outside(e) { if (pop && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close(); }
  function esc(e) { if (e.key === "Escape") { close(); btn.focus(); } }
  function open() {
    if (pop) return close();
    pop = doc.createElement("div");
    pop.className = "th-pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Scene");
    pop.innerHTML = '<h3>Scene</h3><p>The room you work in. It is remembered on this computer, for both labs.</p><div class="th-grid">' +
      SCENES.map(function (s) { return '<button type="button" class="th-scene" data-scene="' + s[0] + '"><span class="pic" style="background:' + s[3] + ';--room:' + s[2] + '"></span>' + s[1] + '</button>'; }).join("") + '</div>' +
      '<div class="th-custom"><label for="th-color">Or any colour for the work surface</label><input type="color" id="th-color"><button type="button" id="th-reset" hidden>Undo</button></div>';
    doc.body.appendChild(pop);
    Array.prototype.forEach.call(pop.querySelectorAll(".pic"), function (p) { var st = doc.createElement("style"); p.id = "th-" + Math.random().toString(36).slice(2, 8); st.textContent = "#" + p.id + "::before{background:" + p.style.getPropertyValue("--room") + "}"; pop.appendChild(st); });
    var r = btn.getBoundingClientRect(), w = pop.offsetWidth;
    pop.style.top = Math.round(r.bottom + 8) + "px";
    pop.style.left = Math.round(Math.max(8, Math.min(root.innerWidth - w - 8, r.right - w))) + "px";
    Array.prototype.forEach.call(pop.querySelectorAll(".th-scene"), function (b) { b.addEventListener("click", function () { T.set(b.getAttribute("data-scene")); }); });
    pop.querySelector("#th-color").addEventListener("input", function () { T.surface(this.value); });
    pop.querySelector("#th-reset").addEventListener("click", function () { T.surface(null); });
    btn.setAttribute("aria-expanded", "true");
    doc.addEventListener("pointerdown", outside, true); doc.addEventListener("keydown", esc, true);
    paint();
  }
  doc.addEventListener("DOMContentLoaded", function () {
    var host = doc.querySelector(".lab-top .top-right") || doc.querySelector(".pw-top-r");
    if (!host) return;
    btn = doc.createElement("button");
    btn.type = "button"; btn.id = "th-btn"; btn.className = "th-btn"; btn.title = "Change the colours of the lab: light, dark, blueprint, or a colour of your own";
    btn.setAttribute("aria-haspopup", "dialog"); btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = '<i aria-hidden="true"></i><span>Scene</span>';
    host.insertBefore(btn, host.firstChild);
    btn.addEventListener("click", open);
  });
})(window);
