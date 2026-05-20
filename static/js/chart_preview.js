/* static/js/chart_preview.js
 *
 * Knock-Knock live chart renderer.
 *
 * Fixes:
 * - Bottom labels not showing.
 * - Top of chart / winner label being cut off.
 * - Chart disappearing after refresh with empty tally.
 * - Selected chart type always falling back to bar.
 * - Light templates hiding text.
 *
 * Required global:
 *   Chart.js 4.x
 *
 * Public function:
 *   window.kkRenderLive(canvas, specialEl, chartId, questionType, choices, tally, holder)
 */

(function () {
  "use strict";

  const DEFAULT_COLORS = [
    "#22d3ee",
    "#7c3aed",
    "#fbbf24",
    "#34d399",
    "#fb7185",
    "#a3e635",
    "#f97316",
    "#38bdf8",
  ];

  function cssVar(name, fallback) {
    const root = document.documentElement;
    const stage = document.getElementById("stage");

    let value = "";

    if (stage) {
      value = getComputedStyle(stage).getPropertyValue(name).trim();
    }

    if (!value) {
      value = getComputedStyle(root).getPropertyValue(name).trim();
    }

    return value || fallback;
  }

  function getTextColor() {
    return cssVar("--stage-fg", cssVar("--kk-text", "#f5f6ff"));
  }

  function getDimTextColor() {
    return cssVar("--kk-text-dim", "rgba(245,246,255,.72)");
  }

  function getGridColor() {
    return "rgba(255,255,255,.08)";
  }

  function getChartWrap(canvas) {
    return canvas ? canvas.closest(".kk-chart-wrap") : null;
  }

  function normalizeChartType(chartId) {
    const raw = String(chartId || "bar").toLowerCase().trim();

    if (["pie"].includes(raw)) return { type: "pie", indexAxis: "x" };
    if (["donut", "doughnut"].includes(raw)) return { type: "doughnut", indexAxis: "x" };
    if (["line", "area", "smooth_area", "distribution"].includes(raw)) return { type: "line", indexAxis: "x" };
    if (["horizontal", "horizontal_bar", "hbar", "bar_horizontal"].includes(raw)) {
      return { type: "bar", indexAxis: "y" };
    }
    // Vertical-bar aliases: column, rounded_bar, gradient_bar, lollipop,
    // bubble_count, progress_bars all render reasonably as vertical bars
    // when chart_extra.js doesn't handle them (e.g. on initial load before
    // the script has fully executed). We don't need a special case here —
    // they fall through to bar, indexAxis: "x" — but listing them as a
    // comment makes the intent obvious.

    return { type: "bar", indexAxis: "x" };
  }

  function choiceText(choice, index) {
    if (!choice) return `Option ${index + 1}`;

    return (
      choice.text ||
      choice.label ||
      choice.name ||
      choice.title ||
      choice.value ||
      `Option ${index + 1}`
    );
  }

  function choiceId(choice, index) {
    if (!choice) return String(index);

    if (choice.id !== undefined && choice.id !== null) return String(choice.id);
    if (choice.pk !== undefined && choice.pk !== null) return String(choice.pk);

    return String(index);
  }

  function normalizeChoices(choices) {
    if (!Array.isArray(choices)) return [];

    return choices.map((choice, index) => ({
      id: choiceId(choice, index),
      text: choiceText(choice, index),
      raw: choice,
      index,
    }));
  }

  function scaleChoicesFromTally(tally) {
    const counts = (tally && tally.counts) || {};
    const numericKeys = Object.keys(counts)
      .map((key) => Number(key))
      .filter((value) => Number.isFinite(value));

    if (!numericKeys.length) return [];

    const min = Math.min(...numericKeys);
    const max = Math.max(...numericKeys);
    const rows = [];
    for (let i = min; i <= max; i++) {
      rows.push({ id: String(i), text: String(i), raw: { id: i, text: String(i) }, index: rows.length });
    }
    return rows;
  }

  function normalizeTally(choices, tally) {
    const safeTally = tally || {};
    const counts = safeTally.counts || {};
    const texts = Array.isArray(safeTally.texts) ? safeTally.texts : [];

    const values = choices.map((choice) => {
      const byString = counts[String(choice.id)];
      const byRawId = choice.raw && choice.raw.id !== undefined ? counts[choice.raw.id] : undefined;
      const byIndex = counts[String(choice.index)];

      return Number(byString ?? byRawId ?? byIndex ?? 0);
    });

    return {
      counts,
      texts,
      values,
      total: values.reduce((sum, value) => sum + Number(value || 0), 0),
    };
  }

  function safeYAxisMax(values) {
    const maxValue = Math.max(0, ...values.map((value) => Number(value || 0)));

    /*
     * Important:
     * If max vote is 1, y-axis max becomes 2.
     * This prevents the tallest bar from touching/cutting the top.
     */
    if (maxValue <= 1) return 2;
    if (maxValue <= 5) return Math.ceil(maxValue + 1);

    return Math.ceil(maxValue * 1.25);
  }

  function destroyOldChart(holder) {
    if (!holder) return;

    if (holder.chart) {
      try {
        holder.chart.destroy();
      } catch (e) {
        // Ignore Chart.js destroy errors.
      }
      holder.chart = null;
    }
  }

  function clearSpecial(specialEl) {
    if (!specialEl) return;

    specialEl.style.display = "none";
    specialEl.innerHTML = "";
  }

  function removeWinnerOverlay(canvas) {
    const wrap = getChartWrap(canvas);
    if (!wrap) return;

    const old = wrap.querySelector(".kk-winner-float");
    if (old) old.remove();
  }

  function ensureBackgroundClass(canvas) {
    const wrap = getChartWrap(canvas);
    if (!wrap) return;

    // Resolve the desired theme in priority order:
    //   1. data-bg on the wrapper itself
    //   2. data-chart-bg on the wrapper itself
    //   3. window.kkChartBackground (set by present.js from stage[data-chart-bg])
    //   4. fallback to "normal"
    const fromAttr =
      wrap.dataset.bg ||
      wrap.dataset.chartBg ||
      window.kkChartBackground ||
      "normal";

    const bg = String(fromAttr).toLowerCase().trim();
    const allowed = new Set(["normal", "space", "forest", "room", "binary"]);
    const safe = allowed.has(bg) ? bg : "normal";

    wrap.classList.remove(
      "kk-bg-normal",
      "kk-bg-space",
      "kk-bg-forest",
      "kk-bg-room",
      "kk-bg-binary"
    );

    wrap.classList.add(`kk-bg-${safe}`);
  }

  function getWinnerIndex(values) {
    if (!values || !values.length) return -1;

    const maxValue = Math.max(...values.map((value) => Number(value || 0)));

    if (maxValue <= 0) return -1;

    return values.findIndex((value) => Number(value || 0) === maxValue);
  }

  function getLeaderAvatarMeta() {
    const rows = Array.isArray(window.kkLeaderboardRows) ? window.kkLeaderboardRows : [];

    if (!rows.length) {
      return null;
    }

    const leader = rows[0] || {};
    const avatars = window.kkAvatarsById || {};
    const avatar = avatars[leader.avatar_id] || {};

    return {
      name: leader.name || "Winner",
      emoji: avatar.emoji || avatarEmojiFallback(leader.avatar_id),
      anim: avatar.anim || "kk-float",
    };
  }

  function avatarEmojiFallback(id) {
    const map = {
      dragon: "🐉",
      sword: "⚔️",
      car: "🏎️",
      butterfly: "🦋",
      spacecraft: "🚀",
      trex: "🦖",
      stego: "🦕",
      joker: "🃏",
      unicorn: "🦄",
      wizard: "🧙",
      ninja: "🥷",
      alien: "👽",
      ghost: "👻",
      robot: "🤖",
      fox: "🦊",
      octopus: "🐙",
      shark: "🦈",
      tiger: "🐯",
      panda: "🐼",
      wolf: "🐺",
    };

    return map[id] || "👑";
  }

  function renderWinnerOverlay(canvas, chart, values) {
    const wrap = getChartWrap(canvas);
    if (!wrap || !chart) return;

    removeWinnerOverlay(canvas);

    const winnerIndex = getWinnerIndex(values);
    if (winnerIndex < 0) return;

    const meta = getLeaderAvatarMeta();

    /*
     * Only show animated player avatar when leaderboard data exists.
     * For normal poll charts, no floating crown is needed.
     */
    if (!meta) return;

    const datasetMeta = chart.getDatasetMeta(0);
    const element = datasetMeta && datasetMeta.data ? datasetMeta.data[winnerIndex] : null;

    if (!element) return;

    const props = element.getProps(["x", "y"], true);

    /*
     * These two values are the important fix:
     * - safeTop keeps the crown/name from going outside the chart.
     * - safeLeft keeps the bubble inside the chart edges.
     */
    const safeTop = Math.max(86, props.y + 8);
    const safeLeft = Math.min(
      Math.max(70, props.x),
      Math.max(70, wrap.clientWidth - 70)
    );

    const overlay = document.createElement("div");
    overlay.className = "kk-winner-float";
    overlay.style.left = `${safeLeft}px`;
    overlay.style.top = `${safeTop}px`;

    const animClass = `kk-anim-${meta.anim || "kk-float"}`;

    overlay.innerHTML = `
      <div class="kk-winner-crown">👑</div>
      <span class="kk-avatar-bubble ${animClass}" aria-hidden="true">${meta.emoji}</span>
      <span class="kk-winner-label">${escapeHtml(meta.name)}</span>
    `;

    wrap.appendChild(overlay);
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    }[char]));
  }


  function getAxisFontSizes() {
    const cfg = window.kkChartAxisFonts || {};
    const x = Number(cfg.x ?? localStorage.getItem("kk-chart-axis-x") ?? 12);
    const y = Number(cfg.y ?? localStorage.getItem("kk-chart-axis-y") ?? 12);
    return {
      x: Number.isFinite(x) ? Math.max(8, Math.min(48, Math.round(x))) : 12,
      y: Number.isFinite(y) ? Math.max(8, Math.min(48, Math.round(y))) : 12,
    };
  }

  /*
   * Wrap a long x-axis label into multiple lines so adjacent labels
   * don't overlap. Chart.js renders an ARRAY returned from a tick
   * callback as one line per element, so we split on words to fit a
   * pixel budget and cap the number of lines (truncating with an
   * ellipsis past the cap so a very long label can't push the chart
   * area up indefinitely).
   */
  function wrapAxisLabel(text, maxWidthPx, fontPx) {
    const label = String(text == null ? "" : text);
    if (!label) return label;

    // Rough average character width for the bold axis font (~0.6em).
    // Good enough for layout without measuring every glyph on a canvas.
    const charPx = Math.max(4, fontPx * 0.6);
    const maxChars = Math.max(4, Math.floor(maxWidthPx / charPx));

    // Short enough already — leave it on one line.
    if (label.length <= maxChars) return label;

    const MAX_LINES = 3;
    const words = label.split(/\s+/);
    const lines = [];
    let current = "";

    words.forEach((word) => {
      // A single word longer than the budget: hard-split it.
      if (word.length > maxChars) {
        if (current) { lines.push(current); current = ""; }
        let rest = word;
        while (rest.length > maxChars) {
          lines.push(rest.slice(0, maxChars - 1) + "-");
          rest = rest.slice(maxChars - 1);
        }
        current = rest;
        return;
      }
      const candidate = current ? current + " " + word : word;
      if (candidate.length > maxChars) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    });
    if (current) lines.push(current);

    if (lines.length > MAX_LINES) {
      const kept = lines.slice(0, MAX_LINES);
      let last = kept[MAX_LINES - 1];
      last = last.slice(0, Math.max(1, maxChars - 1)).replace(/\s+$/, "") + "…";
      kept[MAX_LINES - 1] = last;
      return kept;
    }
    return lines;
  }


  function baseOptions(values, chartKind, indexAxis) {
    const textColor = getTextColor();
    const dimColor = getDimTextColor();
    const gridColor = getGridColor();

    const isHorizontal = indexAxis === "y";
    const maxValue = safeYAxisMax(values);
    const axisFontSizes = getAxisFontSizes();

    // Wrapped x-axis labels can occupy 2–3 lines. Reserve extra bottom
    // padding so those lines aren't clipped. Only relevant for vertical
    // bar/column charts (categories on x). The exact line count is
    // decided per-label at render time; here we just give generous room.
    const baseBottom = 58;
    const lineHeight = Math.round(axisFontSizes.x * 1.25);
    const bottomPad = isHorizontal
      ? baseBottom
      : baseBottom + lineHeight * 2;   // room for up to ~3 wrapped lines

    const options = {
      responsive: true,
      maintainAspectRatio: false,
      resizeDelay: 0,

      /*
       * This padding fixes both problems:
       * - top label/crown has space
       * - bottom x-axis labels have space (incl. wrapped multi-line ones)
       */
      layout: {
        padding: {
          top: 62,
          right: 28,
          bottom: bottomPad,
          left: 16,
        },
      },

      animation: {
        duration: 350,
      },

      plugins: {
        legend: {
          display: chartKind === "pie" || chartKind === "doughnut",
          position: "bottom",
          labels: {
            color: textColor,
            padding: 18,
            boxWidth: 14,
            boxHeight: 14,
            font: {
              size: 13,
              weight: "600",
            },
          },
        },
        tooltip: {
          enabled: true,
          backgroundColor: "rgba(10,10,20,.94)",
          titleColor: "#ffffff",
          bodyColor: "#ffffff",
          borderColor: "rgba(255,255,255,.15)",
          borderWidth: 1,
          padding: 12,
          displayColors: true,
        },
      },
    };

    if (chartKind === "pie" || chartKind === "doughnut") {
      options.cutout = chartKind === "doughnut" ? "56%" : 0;
      return options;
    }

    options.indexAxis = indexAxis;

    options.scales = {
      x: {
        display: true,
        offset: true,
        beginAtZero: true,
        suggestedMax: isHorizontal ? maxValue : undefined,
        max: isHorizontal ? maxValue : undefined,
        ticks: {
          display: true,
          color: textColor,
          padding: 12,
          autoSkip: false,
          maxRotation: 0,
          minRotation: 0,
          precision: 0,
          font: {
            size: axisFontSizes.x,
            weight: "600",
          },
          /*
           * Wrap long category labels onto multiple lines so they don't
           * overlap their neighbours. Only applies when the x-axis holds
           * the CATEGORY labels — i.e. vertical bar/column charts. On a
           * horizontal bar chart the x-axis is the numeric value axis
           * (categories sit on y), so we leave those ticks untouched.
           */
          callback: function (value, index) {
            const raw = this.getLabelForValue(value);
            if (isHorizontal) return raw;          // numeric axis — no wrap
            const scale = this;
            const count = (scale.ticks && scale.ticks.length) ||
                          (scale.chart.data.labels || []).length || 1;
            // Per-label width budget: the x-axis width split across all
            // categories, minus a small gutter so lines don't touch.
            const axisWidth = (scale.width || scale.chart.width || 0);
            const budget = Math.max(28, (axisWidth / count) - 10);
            return wrapAxisLabel(raw, budget, axisFontSizes.x);
          },
        },
        grid: {
          color: isHorizontal ? gridColor : "rgba(255,255,255,.055)",
          drawBorder: false,
        },
        border: {
          display: false,
        },
      },
      y: {
        display: true,
        beginAtZero: true,
        suggestedMax: !isHorizontal ? maxValue : undefined,
        max: !isHorizontal ? maxValue : undefined,
        ticks: {
          display: true,
          color: dimColor,
          padding: 8,
          precision: 0,
          stepSize: Math.max(...values) <= 5 ? 1 : undefined,
          font: {
            size: axisFontSizes.y,
            weight: "500",
          },
        },
        grid: {
          color: !isHorizontal ? gridColor : "rgba(255,255,255,.055)",
          drawBorder: false,
        },
        border: {
          display: false,
        },
      },
    };

    if (chartKind === "line") {
      options.elements = {
        line: {
          tension: 0.35,
          borderWidth: 4,
        },
        point: {
          radius: 5,
          hoverRadius: 7,
        },
      };
    }

    return options;
  }

  function buildDataset(chartKind, values, colors) {
    if (chartKind === "line") {
      return {
        label: "Votes",
        data: values,
        borderColor: cssVar("--stage-accent-2", "#22d3ee"),
        backgroundColor: "rgba(34,211,238,.16)",
        fill: true,
        pointBackgroundColor: colors,
        pointBorderColor: "#ffffff",
        pointBorderWidth: 2,
      };
    }

    return {
      label: "Votes",
      data: values,
      backgroundColor: colors,
      borderColor: "rgba(255,255,255,.15)",
      borderWidth: 1,
      borderRadius: chartKind === "bar" ? 8 : 0,
      borderSkipped: false,
      hoverOffset: chartKind === "pie" || chartKind === "doughnut" ? 12 : 0,
    };
  }

  function renderTextAnswers(specialEl, tally) {
    if (!specialEl) return;

    const texts = Array.isArray(tally && tally.texts) ? tally.texts : [];

    specialEl.style.display = "grid";
    specialEl.style.placeItems = "center";
    specialEl.style.padding = "2rem";
    specialEl.style.overflow = "auto";

    if (!texts.length) {
      specialEl.innerHTML = `
        <div class="kk-empty">
          <div class="em">💬</div>
          <h3>No responses yet</h3>
          <p>Responses will appear here live.</p>
        </div>
      `;
      return;
    }

    specialEl.innerHTML = `
      <div style="
        width:100%;
        display:grid;
        grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
        gap:1rem;
        align-content:start;
      ">
        ${texts.map((text) => `
          <div style="
            padding:1rem 1.15rem;
            border-radius:16px;
            background:rgba(255,255,255,.08);
            border:1px solid rgba(255,255,255,.12);
            color:${getTextColor()};
            font-size:clamp(1rem,1.8vw,1.35rem);
            line-height:1.25;
          ">
            ${escapeHtml(text)}
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderEmptyChoiceChart(canvas, specialEl, holder, choices, chartInfo) {
    clearSpecial(specialEl);
    removeWinnerOverlay(canvas);
    destroyOldChart(holder);

    const labels = choices.length ? choices.map((choice) => choice.text) : ["No choices"];
    const values = choices.length ? choices.map(() => 0) : [0];
    const colors = labels.map((_, index) => DEFAULT_COLORS[index % DEFAULT_COLORS.length]);

    holder.chart = new Chart(canvas, {
      type: chartInfo.type,
      data: {
        labels,
        datasets: [buildDataset(chartInfo.type, values, colors)],
      },
      options: baseOptions(values, chartInfo.type, chartInfo.indexAxis),
    });
  }

  function renderChoiceChart(canvas, specialEl, chartId, questionType, choicesRaw, tally, holder) {
    if (!canvas || !window.Chart) return;

    let choices = normalizeChoices(choicesRaw);
    if (!choices.length && String(questionType || "").toLowerCase() === "scale") {
      choices = scaleChoicesFromTally(tally);
    }
    const chartInfo = normalizeChartType(chartId);
    const tallyData = normalizeTally(choices, tally);

    ensureBackgroundClass(canvas);
    clearSpecial(specialEl);
    removeWinnerOverlay(canvas);
    destroyOldChart(holder);

    if (!choices.length) {
      renderEmptyChoiceChart(canvas, specialEl, holder, choices, chartInfo);
      return;
    }

    const labels = choices.map((choice) => choice.text);
    const values = tallyData.values;
    const colors = labels.map((_, index) => DEFAULT_COLORS[index % DEFAULT_COLORS.length]);

    const options = baseOptions(values, chartInfo.type, chartInfo.indexAxis);

    /*
     * Keep winner overlay safely inside the chart.
     * This avoids top clipping when a bar touches the max value.
     */
    options.animation = {
      duration: 350,
      onComplete: function () {
        if (chartInfo.type === "bar") {
          renderWinnerOverlay(canvas, holder.chart, values);
        }
      },
    };

    holder.chart = new Chart(canvas, {
      type: chartInfo.type,
      data: {
        labels,
        datasets: [buildDataset(chartInfo.type, values, colors)],
      },
      options,
    });

    requestAnimationFrame(() => {
      try {
        holder.chart.resize();
        holder.chart.update("none");
      } catch (e) {
        // Ignore.
      }

      if (chartInfo.type === "bar") {
        renderWinnerOverlay(canvas, holder.chart, values);
      }
    });
  }

  function shouldShowTextAnswers(questionType, chartId) {
    const qType = String(questionType || "").toLowerCase();
    const cType = String(chartId || "").toLowerCase();

    return (
      qType === "text" ||
      qType === "open" ||
      qType === "open_text" ||
      qType === "word" ||
      qType === "wordcloud" ||
      cType === "text" ||
      cType === "wordcloud"
    );
  }

  window.kkRenderLive = function kkRenderLive(
    canvas,
    specialEl,
    chartId,
    questionType,
    choices,
    tally,
    holder
  ) {
    const safeHolder = holder || { chart: null };

    if (!canvas) return;

    if (shouldShowTextAnswers(questionType, chartId)) {
      destroyOldChart(safeHolder);
      removeWinnerOverlay(canvas);
      renderTextAnswers(specialEl, tally || {});
      return;
    }

    renderChoiceChart(
      canvas,
      specialEl,
      chartId || "bar",
      questionType,
      Array.isArray(choices) ? choices : [],
      tally || { counts: {}, texts: [] },
      safeHolder
    );
  };
})();