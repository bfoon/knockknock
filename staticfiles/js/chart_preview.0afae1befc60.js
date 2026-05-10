/* Chart rendering — shared by the editor preview and the live presenter.
 * Exposes:
 *   window.kkRenderPreview(chartId, questionType, labels)  — sample data
 *   window.kkRenderLive(canvas, chartId, questionType, labels, tally)
 *
 * tally for poll: { counts: { choiceIdStr: n }, texts: [str, ...] }
 * tally for game: { counts: { choiceIdStr: n } }
 */
(function () {
  let _previewChart = null;
  const PALETTE = [
    "#7c3aed", "#22d3ee", "#fb7185", "#fbbf24", "#34d399",
    "#f97316", "#ec4899", "#a3e635", "#60a5fa", "#facc15"
  ];

  function destroy(canvasOrNull, chartHandleKey) {
    // For preview only — one global chart
    if (_previewChart) { _previewChart.destroy(); _previewChart = null; }
  }

  function sampleCounts(labels) {
    // generate stable-ish sample numbers
    return labels.map((_, i) => Math.round(15 + Math.sin(i * 1.7) * 9 + (i % 3) * 4));
  }

  function buildDataset(values, kind) {
    return {
      label: "Responses",
      data: values,
      backgroundColor: kind === "line" ? "rgba(124,58,237,.3)" :
                       kind === "area" ? "rgba(124,58,237,.3)" :
                       PALETTE.slice(0, values.length),
      borderColor: kind === "line" || kind === "area" ? "#7c3aed" :
                   PALETTE.slice(0, values.length),
      borderWidth: 2,
      fill: kind === "area",
      tension: kind === "line" || kind === "area" ? 0.4 : 0,
      borderRadius: 8,
    };
  }

  const COMMON_OPTS = (mods = {}) => ({
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 600, easing: "easeOutCubic" },
    plugins: {
      legend: { display: false, labels: { color: "#cbd5e1" } },
      tooltip: { enabled: true },
    },
    scales: mods.scales !== undefined ? mods.scales : {
      x: { ticks: { color: "rgba(255,255,255,.7)" }, grid: { color: "rgba(255,255,255,.05)" } },
      y: { ticks: { color: "rgba(255,255,255,.7)" }, grid: { color: "rgba(255,255,255,.05)" } },
    },
    ...mods.extra,
  });

  function chartConfig(chartId, labels, values) {
    switch (chartId) {
      case "bar":
        return { type: "bar", data: { labels, datasets: [buildDataset(values, "bar")] }, options: COMMON_OPTS() };
      case "horizontal_bar":
        return { type: "bar", data: { labels, datasets: [buildDataset(values, "bar")] },
                 options: COMMON_OPTS({ extra: { indexAxis: "y" } }) };
      case "stacked_bar":
        return { type: "bar", data: { labels, datasets: [buildDataset(values, "bar")] },
                 options: COMMON_OPTS({ scales: { x: { stacked: true, ticks: {color:"#cbd5e1"}, grid:{color:"rgba(255,255,255,.05)"} },
                                                  y: { stacked: true, ticks: {color:"#cbd5e1"}, grid:{color:"rgba(255,255,255,.05)"} } } }) };
      case "donut":
        return { type: "doughnut", data: { labels, datasets: [buildDataset(values, "donut")] },
                 options: COMMON_OPTS({ scales: {}, extra: { plugins: { legend: { display: true, position: "bottom", labels: { color: "#cbd5e1" } } }, cutout: "60%" } }) };
      case "pie":
        return { type: "pie", data: { labels, datasets: [buildDataset(values, "pie")] },
                 options: COMMON_OPTS({ scales: {}, extra: { plugins: { legend: { display: true, position: "bottom", labels: { color: "#cbd5e1" } } } } }) };
      case "line":
        return { type: "line", data: { labels, datasets: [buildDataset(values, "line")] }, options: COMMON_OPTS() };
      case "area":
        return { type: "line", data: { labels, datasets: [buildDataset(values, "area")] }, options: COMMON_OPTS() };
      case "radar":
        return { type: "radar", data: { labels, datasets: [{ label: "Responses", data: values, backgroundColor: "rgba(124,58,237,.25)", borderColor: "#7c3aed", borderWidth: 2 }] },
                 options: COMMON_OPTS({ scales: { r: { ticks: { color: "#cbd5e1", backdropColor: "transparent" }, grid: { color: "rgba(255,255,255,.1)" }, pointLabels: { color: "#cbd5e1" } } } }) };
      case "gauge":
        // Faked with a half-donut; show the average value.
        const avg = Math.round(values.reduce((a, b) => a + b, 0) / Math.max(1, values.length));
        return { type: "doughnut",
                 data: { labels: ["Avg", "Rest"], datasets: [{ data: [avg, Math.max(0, 100 - avg)],
                          backgroundColor: ["#7c3aed", "rgba(255,255,255,.07)"], borderWidth: 0 }] },
                 options: COMMON_OPTS({ scales: {}, extra: { rotation: -90, circumference: 180, cutout: "75%", plugins: { legend: { display: false } } } }) };
      case "leaderboard":
        return { type: "bar", data: { labels, datasets: [buildDataset(values, "bar")] },
                 options: COMMON_OPTS({ extra: { indexAxis: "y" } }) };
      default:
        return { type: "bar", data: { labels, datasets: [buildDataset(values, "bar")] }, options: COMMON_OPTS() };
    }
  }

  // Special displays (non-Chart.js): wordcloud, open list, map
  function renderSpecial(chartId, labels, texts, container) {
    container.innerHTML = "";
    container.style.display = "flex";
    container.style.flexDirection = chartId === "open_list" ? "column" : "row";
    container.style.justifyContent = "center";
    container.style.alignItems = "center";
    container.style.flexWrap = "wrap";
    container.style.gap = ".5rem";
    container.style.padding = "1rem";
    container.style.overflow = "auto";

    if (chartId === "wordcloud") {
      const items = (texts && texts.length) ? texts : labels;
      const counts = {};
      items.forEach(t => { const k = (t || "").toString().trim().toLowerCase(); if (k) counts[k] = (counts[k] || 0) + 1; });
      const max = Math.max(1, ...Object.values(counts));
      Object.entries(counts).sort((a, b) => b[1] - a[1]).forEach(([word, n], i) => {
        const size = 14 + Math.round((n / max) * 56);
        const span = document.createElement("span");
        span.textContent = word;
        span.style.fontSize = size + "px";
        span.style.fontWeight = "700";
        span.style.color = PALETTE[i % PALETTE.length];
        span.style.padding = "0 .3rem";
        span.style.fontFamily = '"Clash Display", sans-serif';
        container.appendChild(span);
      });
      if (!Object.keys(counts).length) {
        container.innerHTML = '<div style="color:#94a3b8">Waiting for responses…</div>';
      }
      return;
    }

    if (chartId === "open_list") {
      const items = (texts && texts.length) ? texts : labels;
      if (!items.length) {
        container.innerHTML = '<div style="color:#94a3b8">Waiting for responses…</div>';
        return;
      }
      items.forEach((t, i) => {
        const card = document.createElement("div");
        card.textContent = t;
        card.style.padding = ".6rem 1rem";
        card.style.background = "rgba(255,255,255,.05)";
        card.style.borderRadius = "12px";
        card.style.maxWidth = "85%";
        card.style.borderLeft = `4px solid ${PALETTE[i % PALETTE.length]}`;
        card.style.animation = "kk-pop .35s ease-out";
        container.appendChild(card);
      });
      return;
    }

    if (chartId === "map") {
      // Lightweight stub: show pins as floating chips. Real geo map = future work.
      container.innerHTML = `
        <div style="text-align:center; color:#cbd5e1;">
          <div style="font-size:3.5rem;">🌍</div>
          <div style="font-weight:600; margin-top:.4rem;">Geo distribution</div>
          <div style="display:flex; gap:.4rem; flex-wrap:wrap; justify-content:center; margin-top:1rem;">
            ${labels.map((l, i) => `<span class="kk-q-pill" style="background:${PALETTE[i%PALETTE.length]}; color:#fff;">${l}</span>`).join("")}
          </div>
          <div class="small mt-3" style="color:#94a3b8;">(Geo map renderer — placeholder)</div>
        </div>`;
    }
  }

  function isSpecial(chartId) {
    return chartId === "wordcloud" || chartId === "open_list" || chartId === "map";
  }

  window.kkRenderPreview = function (chartId, questionType, labels) {
    const canvas = document.getElementById("preview-canvas");
    const special = document.getElementById("preview-special");
    if (isSpecial(chartId)) {
      canvas.style.display = "none";
      special.style.display = "flex";
      const fake = chartId === "wordcloud"
        ? ["amazing","fun","loud","colorful","fast","wow","sparkly","yes","hello","again","again","fun"]
        : labels;
      renderSpecial(chartId, labels, fake, special);
      destroy();
      return;
    }
    canvas.style.display = "block";
    special.style.display = "none";
    destroy();
    const values = sampleCounts(labels);
    const cfg = chartConfig(chartId, labels, values);
    _previewChart = new Chart(canvas, cfg);
  };

  window.kkRenderLive = function (canvas, specialEl, chartId, questionType, labels, tally, _chartHolder) {
    if (isSpecial(chartId)) {
      canvas.style.display = "none";
      renderSpecial(chartId, labels, tally && tally.texts || [], specialEl);
      if (_chartHolder.chart) { _chartHolder.chart.destroy(); _chartHolder.chart = null; }
      return;
    }
    canvas.style.display = "block";
    specialEl.style.display = "none";
    const counts = (tally && tally.counts) || {};
    // labels is array of {id, text}
    const values = labels.map(l => counts[String(l.id)] || 0);
    const textLabels = labels.map(l => l.text);
    const cfg = chartConfig(chartId, textLabels, values);
    if (_chartHolder.chart) {
      _chartHolder.chart.data.labels = textLabels;
      _chartHolder.chart.data.datasets = cfg.data.datasets;
      _chartHolder.chart.update();
    } else {
      _chartHolder.chart = new Chart(canvas, cfg);
    }
  };
})();
