/* chart_labels.js — readable axis labels for Knock-Knock charts.
 *
 * Long option text on a category axis either overlaps its neighbour, gets
 * rotated to 45 degrees, or is silently dropped by autoSkip. None of those
 * are good on a projector. This registers one global Chart.js plugin that:
 *
 *   - wraps a tick label onto up to 3 lines (x axis) or 2 lines (y axis)
 *   - ellipsises whatever still does not fit, including single long words
 *   - keeps labels horizontal (maxRotation 0) and stops autoSkip hiding them
 *   - caps how much width a vertical category axis may steal from the chart
 *
 * It wraps any callback a chart already defines rather than replacing it, so
 * a renderer that formats its own labels keeps that formatting and gets the
 * wrapping on top. Only category scales are touched — numeric axes are left
 * exactly as they are.
 *
 * Load after chart.js and before chart_preview.js / chart_extra.js.
 *
 * Opt out for one chart:  options.scales.x.ticks.kkNoWrap = true
 * Tune globally:          window.KK_LABEL_CONFIG = { maxLinesX: 2 }
 */

(function () {
  "use strict";

  if (typeof Chart === "undefined") {
    console.warn("[chart_labels] Chart.js not found — load this after chart.umd.min.js");
    return;
  }

  var CFG = window.KK_LABEL_CONFIG || {};
  var MAX_LINES_X = CFG.maxLinesX || 3;
  var MAX_LINES_Y = CFG.maxLinesY || 2;
  var Y_AXIS_MAX_SHARE = CFG.yAxisMaxShare || 0.28;   // of total chart width
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
    var weight = opts.weight || Chart.defaults.font.weight || "";
    return (weight ? weight + " " : "") + size + "px " + family;
  }

  function measure(ctx, text) { return ctx.measureText(text).width; }

  /* Longest prefix of `text` that fits in `max` once an ellipsis is added. */
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

      if (measure(ctx, candidate) <= max) {
        line = candidate;
        continue;
      }

      if (line) {
        lines.push(line);
        line = "";
        if (lines.length === maxLines) break;
      }

      // A single word wider than the column can't be wrapped — cut it.
      if (measure(ctx, word) > max) {
        if (lines.length === maxLines - 1) {
          lines.push(ellipsise(ctx, words.slice(i).join(" "), max));
          line = "";
          break;
        }
        lines.push(ellipsise(ctx, word, max));
        if (lines.length === maxLines) break;
        continue;
      }
      line = word;
    }

    if (line && lines.length < maxLines) lines.push(line);

    // Anything left over gets folded into the last line as an ellipsis.
    var used = lines.join(" ").replace(/…$/, "");
    var full = words.join(" ");
    if (lines.length === maxLines && used.length < full.length && !/…$/.test(lines[maxLines - 1])) {
      lines[maxLines - 1] = ellipsise(ctx, lines[maxLines - 1] + " …", max);
    }

    return lines.length ? lines : [""];
  }

  /* ── how much room a tick actually has ─────────────────────── */

  function availableWidth(scale) {
    var chart = scale.chart;
    if (scale.isHorizontal()) {
      var count = (scale.ticks && scale.ticks.length) || 1;
      var area = (chart.chartArea && chart.chartArea.width) || scale.width || chart.width || 600;
      return Math.max(30, (area / count) - 8);
    }
    return Math.max(56, Math.min((chart.width || 600) * Y_AXIS_MAX_SHARE, Y_AXIS_MAX_PX) - 12);
  }

  function wrapTick(scale, label, index) {
    if (label == null) return label;
    if (Array.isArray(label)) return label;               // already multiline
    var text = String(label);
    if (!text) return text;

    var ctx = scale.ctx || (scale.chart && scale.chart.ctx);
    if (!ctx) return label;

    var max = availableWidth(scale);
    var maxLines = scale.isHorizontal() ? MAX_LINES_X : MAX_LINES_Y;

    ctx.save();
    ctx.font = tickFontString(scale, index);
    var fits = measure(ctx, text) <= max;
    var lines = fits ? [text] : wrapText(ctx, text, max, maxLines);
    ctx.restore();

    return lines.length === 1 ? lines[0] : lines;
  }

  /* ── the plugin ────────────────────────────────────────────── */

  function clampAxisWidth(scale) {
    if (scale.isHorizontal()) return;
    var cap = Math.min((scale.chart.width || 600) * Y_AXIS_MAX_SHARE, Y_AXIS_MAX_PX);
    if (scale.width > cap) scale.width = cap;
  }

  var plugin = {
    id: "kkAxisLabels",

    beforeUpdate: function (chart) {
      var scales = (chart.options && chart.options.scales) || {};

      Object.keys(scales).forEach(function (id) {
        var scaleOpts = scales[id];
        if (!scaleOpts) return;

        var ticks = scaleOpts.ticks = scaleOpts.ticks || {};
        if (ticks.kkNoWrap) return;

        if (!ticks.kkWrapped) {
          var inner = ticks.callback;
          ticks.callback = function (value, index, values) {
            // `this` is the scale instance at draw time.
            var label = inner
              ? inner.call(this, value, index, values)
              : (typeof this.getLabelForValue === "function" ? this.getLabelForValue(value) : value);

            // Numbers and time stamps keep their own formatting.
            if (this.type !== "category") return label;
            return wrapTick(this, label, index);
          };
          ticks.kkWrapped = true;
        }

        // Rotated labels are the other half of the overlap problem.
        if (ticks.maxRotation == null) ticks.maxRotation = 0;
        if (ticks.minRotation == null) ticks.minRotation = 0;
        if (ticks.autoSkip == null) ticks.autoSkip = false;
        if (ticks.padding == null) ticks.padding = 6;

        if (!scaleOpts.kkFitted) {
          var priorFit = scaleOpts.afterFit;
          scaleOpts.afterFit = function (scale) {
            if (typeof priorFit === "function") priorFit.call(this, scale);
            clampAxisWidth(scale);
          };
          scaleOpts.kkFitted = true;
        }
      });
    },
  };

  Chart.register(plugin);
  window.kkAxisLabels = { plugin: plugin, wrapTick: wrapTick, version: 1 };
})();
