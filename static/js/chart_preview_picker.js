/* Knock-Knock — chart picker preview (TRUE WYSIWYG, v4)
 *
 * REPLACES the old mock-based preview. Instead of redrawing a simplified
 * Chart.js approximation, this version reuses the EXACT same renderers the
 * live presenter stage uses:
 *
 *   1. window.kkRenderExtraChart  (chart_extra.js — ranked_bar, flow, treemap,
 *                                  wordcloud, heatmap, plotly_*, folium_map, …)
 *   2. window.kkRenderLive        (chart_preview.js — bar/column/pie/donut/…)
 *
 * It builds the same `ctx` object present.js passes, but with synthetic
 * sample data shaped to match each question type's real tally wire format
 * ({counts}, {texts}, {points}). What you see in the picker is pixel-identical
 * to what the audience will see on stage.
 *
 * Markup expected in question_edit.html (see template patch):
 *   <div class="kk-chart-preview-stage" id="chart-preview-stage">
 *     <div class="kk-chart-wrap" id="chart-preview-wrap">
 *       <canvas id="chart-preview-canvas"></canvas>
 *       <div id="chart-preview-special" class="kk-chart-special"></div>
 *     </div>
 *   </div>
 *   <div id="chart-preview-label">Bar</div>
 *
 * The old tiny <canvas id="chart-preview"> still works as a fallback target
 * if the new stage markup isn't present.
 */
(function () {
  "use strict";

  // ─────────────────────────────────────────────────────────────
  // Synthetic sample data per QUESTION type, in real wire format.
  // Each builder returns { question, tally, questionType }.
  // `question.choices` mirrors the server JSON: [{id, text, image_url}].
  // `tally` mirrors _sync_tally output: {counts:{id:n}, texts:[], points:[]}.
  // ─────────────────────────────────────────────────────────────

  // A small stable demo palette of choice labels per type.
  const CHOICE_SETS = {
    mcq:          ["Red", "Blue", "Green", "Yellow"],
    image_choice: ["Mountains", "Beach", "City", "Forest"],
    yes_no:       ["Yes", "No"],
    likert:       ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"],
    ranking:      ["Speed", "Quality", "Price", "Support"],
    matrix:       ["Onboarding", "Dashboard", "Search", "Reports"],
    points_allocation: ["Feature A", "Feature B", "Feature C", "Feature D"],
    reaction:     ["🔥", "❤️", "😂", "👏", "😮"],
  };

  // Demo counts to make the charts look lively and ranked.
  const COUNT_SETS = {
    mcq:          [12, 19, 7, 14],
    image_choice: [22, 30, 8, 17],
    yes_no:       [42, 18],
    likert:       [3, 8, 12, 22, 15],
    ranking:      [40, 28, 18, 14],
    matrix:       [18, 24, 11, 27],
    points_allocation: [35, 25, 22, 18],
    reaction:     [44, 32, 18, 11, 6],
  };

  // Sample free-text answers for word/open charts.
  const SAMPLE_TEXTS = [
    "clarity", "focus", "clarity", "speed", "trust", "focus", "clarity",
    "fun", "ease", "speed", "power", "trust", "focus", "clarity", "speed",
    "innovative", "simple", "fast", "reliable", "simple", "fast", "delightful",
  ];

  // Numeric distributions for scale/rating/nps/slider/numeric.
  const NUMERIC_SETS = {
    scale:   spread(1, 10, [1, 2, 3, 5, 8, 11, 12, 9, 5, 3]),
    rating:  spread(1, 5,  [2, 4, 12, 22, 30]),
    nps:     spread(0, 10, [1, 1, 2, 3, 5, 8, 9, 12, 15, 18, 16]),
    slider:  spread(0, 100, null, 60),   // 60 random-ish values 0..100
    numeric: spread(0, 120, null, 50),
  };

  // Build a counts dict {valueString: n} from a min..max histogram array,
  // OR generate `count` pseudo-random values in [min,max] when hist is null.
  function spread(min, max, hist, count) {
    const counts = {};
    if (Array.isArray(hist)) {
      hist.forEach((n, i) => { counts[String(min + i)] = n; });
      return counts;
    }
    // pseudo-random but deterministic-ish bell-ish distribution
    const N = count || 40;
    let seed = 1337;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < N; i++) {
      const v = Math.round(min + (max - min) * (rnd() * 0.5 + rnd() * 0.5)); // triangular-ish
      counts[String(v)] = (counts[String(v)] || 0) + 1;
    }
    return counts;
  }

  // Demo coordinate points for pin_image / pin_map / two_by_two heatmaps.
  function samplePoints() {
    const pts = [];
    const clusters = [[28, 34], [62, 40], [48, 68], [72, 22]];
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    clusters.forEach((c, ci) => {
      const n = 6 + ci * 3;
      for (let i = 0; i < n; i++) {
        pts.push({
          x: Math.max(2, Math.min(98, c[0] + (rnd() - 0.5) * 18)),
          y: Math.max(2, Math.min(98, c[1] + (rnd() - 0.5) * 18)),
          value: 1,
          label: `Pin ${pts.length + 1}`,
        });
      }
    });
    return pts;
  }

  function choiceObjects(type) {
    const labels = CHOICE_SETS[type] || CHOICE_SETS.mcq;
    return labels.map((text, i) => ({
      id: i + 1,
      text,
      // image_choice / gallery want an image_url; use a tiny inline SVG swatch
      image_url: type === "image_choice"
        ? swatchDataUri(i)
        : "",
    }));
  }

  // A cheap inline SVG gradient swatch so image_choice/gallery previews show
  // "images" without any network request.
  function swatchDataUri(i) {
    const pals = [
      ["#22d3ee", "#0ea5e9"], ["#7c3aed", "#a855f7"],
      ["#fb7185", "#f43f5e"], ["#fbbf24", "#f59e0b"],
      ["#34d399", "#10b981"], ["#60a5fa", "#3b82f6"],
    ];
    const [a, b] = pals[i % pals.length];
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='120'>` +
      `<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>` +
      `<stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/>` +
      `</linearGradient></defs><rect width='160' height='120' rx='12' fill='url(%23g)'/>` +
      `</svg>`;
    return "data:image/svg+xml;utf8," + svg.replace(/#/g, "%23");
  }

  // Build the {question, tally} pair for a given question type.
  function buildSample(type) {
    const t = String(type || "mcq").toLowerCase();

    // Choice-shaped types: counts keyed by choice id.
    if (CHOICE_SETS[t]) {
      const choices = choiceObjects(t);
      const nums = COUNT_SETS[t] || choices.map((_, i) => 10 + i * 3);
      const counts = {};
      choices.forEach((c, i) => { counts[String(c.id)] = nums[i] || 0; });

      // points_allocation: counts ARE the point totals (already summing ~100).
      const tally = { counts, texts: [] };
      return {
        questionType: t,
        question: { type: t, text: previewQuestionText(t), choices },
        tally,
      };
    }

    // Word / open text types.
    if (t === "word" || t === "open" || t === "open_text") {
      return {
        questionType: t,
        question: { type: t, text: previewQuestionText(t), choices: [] },
        tally: { counts: {}, texts: SAMPLE_TEXTS.slice() },
      };
    }

    // Numeric types: counts keyed by stringified numeric value.
    if (NUMERIC_SETS[t]) {
      return {
        questionType: t,
        question: { type: t, text: previewQuestionText(t), choices: [] },
        tally: { counts: NUMERIC_SETS[t], texts: [] },
      };
    }

    // Date / time types — counts keyed by bucket label.
    if (t === "date" || t === "datetime" || t === "time") {
      const labels = t === "time"
        ? ["6am", "9am", "12pm", "3pm", "6pm", "9pm"]
        : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const data = t === "time" ? [2, 8, 14, 11, 18, 12] : [3, 5, 8, 12, 18, 14, 9];
      const choices = labels.map((text, i) => ({ id: i + 1, text, image_url: "" }));
      const counts = {};
      choices.forEach((c, i) => { counts[String(c.id)] = data[i]; });
      return {
        questionType: t,
        question: { type: t, text: previewQuestionText(t), choices },
        tally: { counts, texts: [] },
      };
    }

    // Spatial types — coordinate point clouds.
    if (t === "pin_image" || t === "pin_map" || t === "two_by_two") {
      return {
        questionType: t,
        question: { type: t, text: previewQuestionText(t), choices: [] },
        tally: { counts: {}, texts: [], points: samplePoints() },
      };
    }

    if (t === "file_upload") {
      const choices = [
        { id: 1, text: "Photos", image_url: swatchDataUri(0) },
        { id: 2, text: "PDFs", image_url: swatchDataUri(1) },
      ];
      return {
        questionType: t,
        question: { type: t, text: previewQuestionText(t), choices },
        tally: { counts: { 1: 14, 2: 6 }, texts: [] },
      };
    }

    // Fallback → mcq.
    return buildSample("mcq");
  }

  function previewQuestionText(type) {
    const map = {
      mcq: "What's your favourite colour?",
      image_choice: "Pick a holiday vibe",
      yes_no: "Did you enjoy the session?",
      likert: "I found this useful",
      ranking: "Rank what matters most",
      matrix: "Rate each feature",
      points_allocation: "Spend 100 points",
      reaction: "React live!",
      word: "Describe today in one word",
      open: "Any feedback?",
      scale: "Rate 1–10",
      rating: "How many stars?",
      nps: "How likely to recommend?",
      slider: "Pick a value",
      numeric: "Enter a number",
      date: "Pick a day",
      datetime: "Pick date & time",
      time: "Pick a time",
      pin_image: "Tap where it matters",
      pin_map: "Drop a pin",
      two_by_two: "Plot impact vs effort",
      file_upload: "Upload a file",
    };
    return map[type] || "Sample question";
  }

  // ─────────────────────────────────────────────────────────────
  // DOM targets
  // ─────────────────────────────────────────────────────────────
  function el(id) { return document.getElementById(id); }

  function getCurrentType() {
    const sel = el("id_question_type");
    return (sel && sel.value) || "mcq";
  }
  function getCurrentChartId() {
    const sel = el("id_chart_type");
    return (sel && sel.value) || "bar";
  }

  // Holder object survives across renders so Chart.js can destroy/rebuild.
  const previewHolder = { chart: null };

  // Build (or reuse) the live-style preview stage. If the new markup isn't
  // in the template yet, synthesize it inside the legacy wrapper so the
  // upgrade is backwards compatible.
  function ensureStage() {
    let wrap = el("chart-preview-wrap");
    let canvas = el("chart-preview-canvas");
    let special = el("chart-preview-special");

    if (wrap && canvas && special) {
      return { wrap, canvas, special };
    }

    // Legacy path: there's only the old tiny <canvas id="chart-preview">.
    const legacy = el("chart-preview");
    const host = legacy ? legacy.parentElement : el("chart-preview-stage");
    if (!host) return null;

    host.innerHTML = "";
    wrap = document.createElement("div");
    wrap.id = "chart-preview-wrap";
    wrap.className = "kk-chart-wrap kk-chart-preview-wrap-live";

    canvas = document.createElement("canvas");
    canvas.id = "chart-preview-canvas";

    special = document.createElement("div");
    special.id = "chart-preview-special";
    special.className = "kk-chart-special";
    special.style.display = "none";

    wrap.appendChild(canvas);
    wrap.appendChild(special);
    host.appendChild(wrap);
    return { wrap, canvas, special };
  }

  // Mirror present.js's destroyChartForSpecialDisplay so chart_extra.js can
  // hide the canvas and paint into specialEl exactly as it does on stage.
  function makeDestroyFn(canvas, special) {
    return function destroyChartForSpecialDisplay() {
      if (previewHolder.chart) {
        try { previewHolder.chart.destroy(); } catch (e) {}
        previewHolder.chart = null;
      }
      if (canvas) canvas.style.display = "none";
      if (special) {
        special.style.display = "block";
        special.innerHTML = "";
      }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Render: the WYSIWYG core.
  // ─────────────────────────────────────────────────────────────
  let renderToken = 0;

  function render() {
    const stage = ensureStage();
    if (!stage) return;
    const { wrap, canvas, special } = stage;

    const type = getCurrentType();
    const chartId = getCurrentChartId();
    const { question, tally, questionType } = buildSample(type);

    // Reset the stage to a clean state before each render.
    const destroyForSpecial = makeDestroyFn(canvas, special);
    if (previewHolder.chart) {
      try { previewHolder.chart.destroy(); } catch (e) {}
      previewHolder.chart = null;
    }
    canvas.style.display = "block";
    special.style.display = "none";
    special.innerHTML = "";

    // chart_preview.js (kkRenderLive) reads its holder off the wrapper for
    // bar/line/pie via `holder.chart`; we pass previewHolder so it lines up.
    const labels = question.choices;

    const myToken = ++renderToken;

    // 1) Try the rich/custom renderers (identical call shape to present.js).
    if (typeof window.kkRenderExtraChart === "function") {
      const handled = window.kkRenderExtraChart({
        chartId,
        questionType,
        question,
        labels,
        tallyData: tally,
        liveCanvas: canvas,
        specialEl: special,
        chartHolder: previewHolder,
        destroyChartForSpecialDisplay: destroyForSpecial,
      });
      if (handled) {
        finishLabel(chartId);
        return;
      }
    }

    // 2) Fall through to the Chart.js pipeline (bar/column/pie/donut/…).
    if (typeof window.kkRenderLive === "function") {
      canvas.style.display = "block";
      special.style.display = "block";
      special.innerHTML = "";
      window.kkRenderLive(
        canvas,
        special,
        chartId,
        questionType,
        labels,
        tally,
        previewHolder
      );
    } else {
      special.style.display = "block";
      special.innerHTML =
        '<div class="kk-extra-empty">Chart renderers not loaded. ' +
        'Ensure chart_preview.js and chart_extra.js load before this script.</div>';
    }

    finishLabel(chartId);

    // Some renderers (Plotly/Leaflet) load async; nudge a resize so they
    // size correctly inside the small preview box.
    if (myToken === renderToken) {
      requestAnimationFrame(() => {
        try {
          if (previewHolder.chart && previewHolder.chart.resize) {
            previewHolder.chart.resize();
          }
          if (window.Plotly) {
            const p = special.querySelector(".kk-rich-mount > div");
            if (p) window.Plotly.Plots.resize(p);
          }
        } catch (e) {}
      });
    }
  }

  function finishLabel(chartId) {
    const labelEl = el("chart-preview-label");
    if (!labelEl) return;
    const tile = document.querySelector(`.kk-chart-tile[data-chart-id="${chartId}"]`);
    const txt = tile && tile.querySelector(".kk-chart-label");
    labelEl.textContent = (txt && txt.textContent.trim()) || chartId;
  }

  // ─────────────────────────────────────────────────────────────
  // Wiring
  // ─────────────────────────────────────────────────────────────
  function init() {
    const picker = el("chart-picker");

    if (picker) {
      picker.addEventListener("click", (e) => {
        const tile = e.target.closest(".kk-chart-tile");
        if (tile) setTimeout(render, 0);  // let the picker update the select first
      });
    }

    const chartSel = el("id_chart_type");
    if (chartSel) chartSel.addEventListener("change", render);

    const typeSel = el("id_question_type");
    if (typeSel) typeSel.addEventListener("change", () => setTimeout(render, 0));

    // Re-render on resize (debounced) so async rich charts stay crisp.
    let rAF = null;
    window.addEventListener("resize", () => {
      if (rAF) cancelAnimationFrame(rAF);
      rAF = requestAnimationFrame(render);
    });

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();