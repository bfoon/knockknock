/* chart_labels.js — readable axis labels for Knock-Knock charts.  v2
 *
 * Long option text on a category axis either overlaps its neighbour, gets
 * rotated 45 degrees, or is silently dropped by autoSkip. None of those read
 * well on a projector. This wraps each category tick label onto up to 3 lines
 * (horizontal axis) or 2 lines (vertical axis) and ellipsises the remainder,
 * including single words too long to wrap.
 *
 * v2 note — v1 did this from a `beforeUpdate` plugin that wrote the callback
 * into `chart.options.scales.*.ticks`. Chart.js 4 resolves `chart.options`
 * through nested proxies whose `set` traps call each other, so that write
 * recursed until the stack blew and no chart rendered at all. Nothing here
 * writes to chart options. It patches CategoryScale.prototype once and reads
 * options only.
 *
 * Because the wrap happens during label generation — before the scale is
 * fitted — Chart.js measures the wrapped lines and sizes the axis around
 * them, so rotation and axis width sort themselves out.
 *
 * Load after chart.js and before chart_preview.js / chart_extra.js.
 *
 * Opt out for one chart:  options.scales.x.ticks.kkNoWrap = true
 * Tune globally:          window.KK_LABEL_CONFIG = { maxLinesX: 2 }
 */

(function () {
  "use strict";

  if (typeof Chart === "undefined" || !Chart.registry) {
    console.warn("[chart_labels] Chart.js not found — load this after chart.umd.min.js");
    return;
  }
  if (window.kkAxisLabels) return;                       // double-include guard

  var CFG = window.KK_LABEL_CONFIG || {};
  var MAX_LINES_X = CFG.maxLinesX || 3;
  var MAX_LINES_Y = CFG.maxLinesY || 2;
  var Y_AXIS_MAX_SHARE = CFG.yAxisMaxShare || 0.28;      // of total chart width
  var Y_AXIS_MAX_PX = CFG.yAxisMaxPx || 300;

  /* ── measuring ─────────────────────────────────────────────── */

  function tickFontString(scale, index) {
    if (typeof scale._resolveTickFontOptions === "function") {
      try {
        var f = scale._resolveTickFontOptions(index || 0);
        if (f && f.string) return f.string;
      } catch (e) { /* private API moved — fall through */ }
    }
    var opts = (scale.options && scale.options.ticks && scale.options.ticks.font) || {};
    var size = opts.size || Chart.defaults.font.size || 12;
    var family = opts.family || Chart.defaults.font.family || "sans-serif";
    return size + "px " + family;
  }

  function measure(ctx, text) { return ctx.measureText(text).width; }

  /* Longest prefix that still fits once an ellipsis is appended. */
  function ellipsise(ctx, text, max) {
    if (measure(ctx, text) <= max) return text;
    var lo = 0, hi = text.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (measure(ctx, text.slice(0, mid) + "…") <= max) lo = mid; else hi = mid - 1;
    }
    return lo < 1 ? "…" : text.slice(0, lo).replace(/\s+$/, "") + "…";
  }

  function wrapText(ctx, text, max, maxLines) {
    var words = String(text).split(/\s+/).filter(Boolean);
    if (!words.length) return [""];

    var lines = [];
    var line = "";

    for (var i = 0; i < words.length; i++) {
      var word = words[i];
      var candidate = line ? line + " " + word : word;

      if (measure(ctx, candidate) <= max) { line = candidate; continue; }

      if (line) {
        lines.push(line);
        line = "";
        if (lines.length === maxLines) break;
      }

      // A single word wider than the column cannot be wrapped — cut it.
      if (measure(ctx, word) > max) {
        if (lines.length === maxLines - 1) {
          lines.push(ellipsise(ctx, words.slice(i).join(" "), max));
          break;
        }
        lines.push(ellipsise(ctx, word, max));
        if (lines.length === maxLines) break;
        continue;
      }
      line = word;
    }

    if (line && lines.length < maxLines) lines.push(line);

    // Anything that did not fit gets folded into the last line.
    var shown = lines.join(" ").replace(/…$/, "").length;
    if (lines.length === maxLines && shown < words.join(" ").length &&
        !/…$/.test(lines[maxLines - 1])) {
      lines[maxLines - 1] = ellipsise(ctx, lines[maxLines - 1] + " …", max);
    }

    return lines.length ? lines : [""];
  }

  /* ── how much room a tick actually has ─────────────────────── */

  function availableWidth(scale) {
    var chart = scale.chart || {};
    if (scale.isHorizontal()) {
      var count = (scale.ticks && scale.ticks.length) || 1;
      var area = scale.maxWidth || scale.width ||
        (chart.chartArea && chart.chartArea.width) || chart.width || 600;
      return Math.max(30, (area / count) - 8);
    }
    return Math.max(56, Math.min((chart.width || 600) * Y_AXIS_MAX_SHARE, Y_AXIS_MAX_PX) - 12);
  }

  function wrapLabel(scale, label, index) {
    if (label == null || Array.isArray(label)) return label;   // already multiline
    var text = String(label);
    if (!text) return label;

    var ctx = scale.ctx || (scale.chart && scale.chart.ctx);
    if (!ctx || typeof ctx.measureText !== "function") return label;

    var max = availableWidth(scale);
    var maxLines = scale.isHorizontal() ? MAX_LINES_X : MAX_LINES_Y;
    var lines;

    ctx.save();
    try {
      ctx.font = tickFontString(scale, index);
      lines = measure(ctx, text) <= max ? [text] : wrapText(ctx, text, max, maxLines);
    } finally {
      ctx.restore();
    }

    return lines.length === 1 ? lines[0] : lines;
  }

  /* ── the patch ─────────────────────────────────────────────── */

  var CategoryScale;
  try {
    CategoryScale = Chart.registry.getScale("category");
  } catch (e) {
    console.warn("[chart_labels] category scale not registered", e);
    return;
  }
  if (!CategoryScale || !CategoryScale.prototype) return;

  var original = CategoryScale.prototype.generateTickLabels;

  /* generateTickLabels runs after the tick callback and before fit(), so the
     wrapped lines are what Chart.js measures when it sizes the axis. Any
     callback a chart defines itself still runs first, inside `original`. */
  CategoryScale.prototype.generateTickLabels = function (ticks) {
    original.call(this, ticks);

    try {
      var tickOpts = (this.options && this.options.ticks) || {};
      if (tickOpts.kkNoWrap) return;
      for (var i = 0; i < ticks.length; i++) {
        ticks[i].label = wrapLabel(this, ticks[i].label, i);
      }
    } catch (e) {
      // A label that will not wrap is a cosmetic problem; a chart that will
      // not render is not. Leave the labels as they were.
      console.warn("[chart_labels] label wrap skipped", e);
    }
  };

  window.kkAxisLabels = {
    version: 2,
    wrapLabel: wrapLabel,
    restore: function () { CategoryScale.prototype.generateTickLabels = original; },
  };
})();
