/* kk_chart_style.js — how a Menti poll draws its live charts.
 *
 * Chosen per poll in the editor's Theme Studio (livestyle app):
 *   theme   bars painted with the theme's two accents — the same alternating
 *           gradients and rounded tops as the Theme Studio preview — straight
 *           on the theme background (the dark chart vignette is removed)
 *   panel   the chart sits on its own separate card: glass | dark | light
 *   classic the original rainbow bars on the dark vignette
 *
 * Exposes window.kkChartPaint = { colors(n, kind), dataset(ds, kind) } for
 * chart_preview.js / present.js. Returns null for classic and for games, so
 * those keep their own colours. Restyles live when the editor changes the
 * style ({type:"chart_style"}) or the theme ({type:"theme"/"slide_theme"}).
 */
(function () {
  "use strict";
  var stage = document.getElementById("stage");
  if (!stage || stage.dataset.kind !== "poll") return;

  var lastArgs = null;

  function style() { return stage.dataset.chartStyle || "theme"; }
  function panel() { return stage.dataset.chartPanel || "glass"; }
  function cssVar(name, fallback) {
    var v = getComputedStyle(stage).getPropertyValue(name).trim();
    return v || fallback;
  }
  function accents() { return [cssVar("--stage-accent", "#7c3aed"), cssVar("--stage-accent-2", "#22d3ee")]; }

  // ── colour helpers ──
  function hexRgb(h) {
    var m = String(h).trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i);
    if (!m) {
      var r = String(h).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
      return r ? [+r[1], +r[2], +r[3]] : [124, 58, 237];
    }
    var x = m[1].length === 3 ? m[1].split("").map(function (c) { return c + c; }).join("") : m[1];
    return [0, 2, 4].map(function (i) { return parseInt(x.substr(i, 2), 16); });
  }
  function mix(a, b, t) { return a.map(function (v, i) { return Math.round(v + (b[i] - v) * t); }); }
  function rgb(c, alpha) { return "rgba(" + c.join(",") + "," + (alpha == null ? 1 : alpha) + ")"; }
  // A palette from the two accents: blends between them, plus lighter / deeper shades.
  function palette(n) {
    var A = hexRgb(accents()[0]), B = hexRgb(accents()[1]), out = [];
    for (var i = 0; i < n; i++) {
      var t = n === 1 ? 0 : (i % 4 === 1 ? 1 : i % 4 === 2 ? 0.5 : i % 4 === 3 ? 0.25 : 0);
      var c = mix(A, B, t);
      var round = Math.floor(i / 4);
      if (round % 2 === 1) c = mix(c, [255, 255, 255], 0.35);
      else if (round > 0) c = mix(c, [0, 0, 0], 0.25);
      out.push(rgb(c, 0.92));
    }
    return out;
  }
  // The preview's bars: odd bars accent-2 → accent (top → bottom), even bars the other way.
  function barGradient(ctx) {
    var chart = ctx.chart, area = chart.chartArea, ac = accents();
    if (!area) return ac[0];
    var horizontal = chart.options && chart.options.indexAxis === "y";
    var g = horizontal ? chart.ctx.createLinearGradient(area.left, 0, area.right, 0)
                       : chart.ctx.createLinearGradient(0, area.bottom, 0, area.top);
    var even = ctx.dataIndex % 2 === 1;
    g.addColorStop(0, even ? ac[1] : ac[0]);      // bottom / left
    g.addColorStop(1, even ? ac[0] : ac[1]);      // top / right
    return g;
  }
  var BAR_KINDS = { bar: 1, horizontalBar: 1 };

  window.kkChartPaint = {
    colors: function (n, kind) {
      if (style() === "classic") return null;
      // one scriptable function (Chart.js evaluates a function, not functions inside an array)
      if (BAR_KINDS[kind] || !kind) return barGradient;
      return palette(n);
    },
    dataset: function (ds, kind) {
      if (style() === "classic" || !ds) return ds;
      if (BAR_KINDS[kind] || !kind) {
        ds.borderWidth = 0;
        ds.borderRadius = { topLeft: 10, topRight: 10, bottomLeft: 2, bottomRight: 2 };
        ds.borderSkipped = false;
      } else if (kind === "pie" || kind === "doughnut" || kind === "polarArea") {
        ds.borderColor = cssVar("--stage-bg", "rgba(0,0,0,.35)");
        ds.borderWidth = 3;
      } else if (kind === "line" || kind === "radar") {
        var ac = accents();
        ds.borderColor = ac[0];
        ds.backgroundColor = rgb(hexRgb(ac[1]), 0.18);
      }
      return ds;
    },
  };

  // ── the chart's surroundings ──
  function applyWrap() {
    var wrap = document.getElementById("chart-wrap");
    if (!wrap) return;
    wrap.classList.remove("kkcs-theme", "kkcs-panel", "kkcs-glass", "kkcs-dark", "kkcs-light");
    if (style() === "theme") wrap.classList.add("kkcs-theme");
    if (style() === "panel") wrap.classList.add("kkcs-panel", "kkcs-" + panel());
  }
  var css = document.createElement("style");
  css.textContent = [
    // theme: no dark vignette — the chart sits on the theme itself, like the preview
    "#stage .kk-chart-wrap.kkcs-theme{background:transparent!important;box-shadow:none!important;border-color:transparent!important}",
    "#stage .kk-chart-wrap.kkcs-theme #live-chart{filter:drop-shadow(0 10px 22px color-mix(in srgb,var(--stage-accent,#7c3aed) 35%,transparent))}",
    // panel: its own separate card
    "#stage .kk-chart-wrap.kkcs-panel{border-radius:24px!important;padding:clamp(10px,1.6vw,22px)!important;transition:background .4s,box-shadow .4s}",
    "#stage .kk-chart-wrap.kkcs-glass{background:color-mix(in srgb,var(--stage-bg,#0a0a14) 38%,rgba(255,255,255,.10))!important;",
    "  border:1px solid rgba(255,255,255,.22)!important;backdrop-filter:blur(18px) saturate(1.2);-webkit-backdrop-filter:blur(18px) saturate(1.2);",
    "  box-shadow:0 24px 60px -20px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.18)!important}",
    "#stage .kk-chart-wrap.kkcs-dark{background:linear-gradient(180deg,rgba(13,15,28,.92),rgba(8,9,18,.95))!important;border:1px solid rgba(255,255,255,.10)!important;",
    "  box-shadow:0 24px 60px -20px rgba(0,0,0,.7)!important;--stage-fg:#f5f6ff;color:#f5f6ff}",
    "#stage .kk-chart-wrap.kkcs-light{background:linear-gradient(180deg,#ffffff,#f4f6fb)!important;border:1px solid rgba(15,23,42,.08)!important;",
    "  box-shadow:0 24px 60px -24px rgba(15,23,42,.45)!important;--stage-fg:#1f2937;color:#1f2937}",
    // the scenery-fading veil is for game scenery; these styles bring their own background
    "#stage .kk-chart-wrap.kkcs-theme>.kk-chart-bg-veil,#stage .kk-chart-wrap.kkcs-panel>.kk-chart-bg-veil{display:none!important}",
    "#stage .kk-chart-wrap.kkcs-panel::before,#stage .kk-chart-wrap.kkcs-panel::after,",
    "#stage .kk-chart-wrap.kkcs-theme::before,#stage .kk-chart-wrap.kkcs-theme::after{display:none!important}",
  ].join("\n");
  document.head.appendChild(css);

  // ── re-draw the current chart when the style or theme changes ──
  function rerender() {
    applyWrap();
    if (lastArgs && typeof window.kkRenderLive === "function") {
      try { window.kkRenderLive.apply(null, lastArgs); } catch (e) { /* keep the old chart */ }
    }
  }
  function wrapRenderer() {
    var orig = window.kkRenderLive;
    if (typeof orig !== "function" || orig.__kkcs) return;
    var wrapped = function () { lastArgs = Array.prototype.slice.call(arguments); return orig.apply(this, arguments); };
    wrapped.__kkcs = true;
    window.kkRenderLive = wrapped;
  }
  // chart_preview.js defines kkRenderLive right after this file loads
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { wrapRenderer(); applyWrap(); });
  else setTimeout(function () { wrapRenderer(); applyWrap(); }, 0);

  // listen on the session socket (same additive approach as kk_theme.js)
  var NativeWS = window.WebSocket;
  if (NativeWS && !NativeWS.__kkcs) {
    var Patched = function (url, protocols) {
      var ws = protocols !== undefined ? new NativeWS(url, protocols) : new NativeWS(url);
      ws.addEventListener("message", function (ev) {
        var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        var p = m && (m.payload || m);
        if (!p || !p.type) return;
        if (p.type === "chart_style") {
          if (p.style) stage.dataset.chartStyle = p.style;
          if (p.panel) stage.dataset.chartPanel = p.panel;
          rerender();
        } else if (p.type === "theme" || p.type === "slide_theme") {
          setTimeout(rerender, 950);       // after kk_theme.js has crossfaded the colours
        }
      });
      return ws;
    };
    Patched.prototype = NativeWS.prototype;
    ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach(function (k) { Patched[k] = NativeWS[k]; });
    Patched.__kkcs = true;
    window.WebSocket = Patched;
  }
  window.kkChartStyle = { rerender: rerender, applyWrap: applyWrap };
})();
