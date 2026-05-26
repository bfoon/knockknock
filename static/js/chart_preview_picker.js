/* Knock-Knock — chart picker preview
 *
 * Renders a tiny sample chart into a canvas next to the editor's chart picker
 * so users can see what each chart looks like before saving.
 *
 * Usage in question_edit.html:
 *   <canvas id="chart-preview" width="220" height="140"></canvas>
 *   <script src="{% static 'js/chart_preview_picker.js' %}"></script>
 *
 * The script listens for clicks on `.kk-chart-tile` (set up by the editor)
 * and redraws using the current question type's sample data.
 *
 * It does NOT replace the live presentation renderer — that's a separate concern.
 */
(function () {
  "use strict";
  if (typeof Chart === "undefined") {
    console.warn("[chart-preview] Chart.js not loaded; preview disabled.");
    return;
  }

  // Default plugin off — preview is small, no legend or axis text
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.maintainAspectRatio = false;

  // ── Sample data by question type ──────────────────────────────
  // Each entry yields { labels, data, accentMap } for the preview.
  const SAMPLES = {
    mcq:               { labels: ["Red", "Blue", "Green", "Yellow"], data: [12, 19, 7, 14] },
    image_choice:      { labels: ["Cat", "Dog", "Bird", "Fish"],     data: [22, 30, 8, 11] },
    yes_no:            { labels: ["Yes", "No"],                       data: [42, 18] },
    likert:            { labels: ["S.Disagree","Disagree","Neutral","Agree","S.Agree"], data: [3, 8, 12, 22, 15] },
    ranking:           { labels: ["Speed", "Quality", "Price", "Support"], data: [40, 28, 18, 14] },

    scale:             { labels: ["1","2","3","4","5","6","7","8","9","10"], data: [1,2,3,5,8,11,12,9,5,3] },
    rating:            { labels: ["★","★★","★★★","★★★★","★★★★★"], data: [2, 4, 12, 22, 30] },
    nps:               { labels: ["0","1","2","3","4","5","6","7","8","9","10"], data: [1,1,2,3,5,8,9,12,15,18,16] },
    slider:            { labels: ["0–20","20–40","40–60","60–80","80–100"], data: [3, 8, 14, 22, 11] },
    numeric:           { labels: ["<10","10–25","25–50","50–100",">100"], data: [4, 9, 16, 11, 5] },

    word:              { labels: ["clarity","focus","speed","trust","fun","ease","power"], data: [22,18,15,12,9,8,5] },
    open:              { labels: ["Response A","Response B","Response C"],                data: [1, 1, 1] },

    date:              { labels: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], data: [3, 5, 8, 12, 18, 14, 9] },
    datetime:          { labels: ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"], data: [3, 5, 8, 12, 18, 14, 9] },
    time:              { labels: ["6am","9am","12pm","3pm","6pm","9pm"],       data: [2, 8, 14, 11, 18, 12] },

    file_upload:       { labels: ["Photos","PDFs"], data: [14, 6] },

    pin_image:         { labels: ["Q1","Q2","Q3","Q4"], data: [12, 22, 8, 18] },
    pin_map:           { labels: ["North","South","East","West"], data: [14, 9, 22, 11] },
    two_by_two:        { labels: ["Q1","Q2","Q3","Q4"], data: [14, 22, 9, 18] },

    matrix:            { labels: ["Row 1","Row 2","Row 3","Row 4"], data: [3.4, 4.1, 2.8, 4.6] },
    points_allocation: { labels: ["Feature A","Feature B","Feature C","Feature D"], data: [35, 25, 22, 18] },
    reaction:          { labels: ["🔥","❤️","😂","👏","😮"], data: [44, 32, 18, 11, 6] },
  };

  function sampleFor(qtype) {
    return SAMPLES[qtype] || SAMPLES.mcq;
  }

  // ── Chart-id → Chart.js config builder ─────────────────────────
  // Returns a Chart.js config object. Designed to render readably at ~220×140.
  function makeConfig(chartId, sample, accent, accent2) {
    const labels = sample.labels;
    const data = sample.data;
    const bg = labels.map((_, i) => i % 2 === 0 ? accent : accent2);

    const noScales = { x: { display: false }, y: { display: false } };
    const tinyTicks = {
      x: { display: false, grid: { display: false } },
      y: { display: false, grid: { display: false } },
    };

    switch (chartId) {
      // ── Bars ────────────────────────────────────────────────
      case "bar":
      case "column":
      case "rounded_bar":
      case "gradient_bar":
        return {
          type: "bar",
          data: { labels, datasets: [{ data, backgroundColor: bg,
                                       borderRadius: chartId === "rounded_bar" ? 8 : 2 }] },
          options: { scales: tinyTicks },
        };

      case "horizontal_bar":
        return {
          type: "bar",
          data: { labels, datasets: [{ data, backgroundColor: bg, borderRadius: 4 }] },
          options: { indexAxis: "y", scales: tinyTicks },
        };

      case "stacked_bar": {
        const half = Math.ceil(labels.length / 2);
        const a = data.slice(0, half);
        const b = data.slice(half).concat(Array(half - data.slice(half).length).fill(0));
        return {
          type: "bar",
          data: { labels: labels.slice(0, half),
            datasets: [
              { data: a, backgroundColor: accent  },
              { data: b, backgroundColor: accent2 },
            ]},
          options: {
            scales: {
              x: { stacked: true, display: false },
              y: { stacked: true, display: false },
            },
          },
        };
      }

      case "grouped_bar":
        return {
          type: "bar",
          data: { labels: labels.slice(0, 4),
            datasets: [
              { data: data.slice(0, 4), backgroundColor: accent  },
              { data: data.slice(0, 4).map(v => v * 0.6), backgroundColor: accent2 },
            ]},
          options: { scales: tinyTicks },
        };

      case "ranked_bar": {
        // Sort desc for visual ranking
        const pairs = labels.map((l, i) => [l, data[i]]).sort((a, b) => b[1] - a[1]);
        return {
          type: "bar",
          data: { labels: pairs.map(p => p[0]),
                  datasets: [{ data: pairs.map(p => p[1]), backgroundColor: bg }] },
          options: { indexAxis: "y", scales: tinyTicks },
        };
      }

      case "lollipop": {
        // Bar + scatter overlay to mimic a lollipop
        return {
          type: "bar",
          data: { labels,
            datasets: [
              { type: "bar", data, backgroundColor: bg, barThickness: 3, borderRadius: 0 },
              { type: "scatter",
                data: data.map((v, i) => ({ x: labels[i], y: v })),
                pointBackgroundColor: bg, pointRadius: 5 },
            ]},
          options: { scales: tinyTicks },
        };
      }

      case "bubble_count":
        return {
          type: "bubble",
          data: { datasets: [{
            data: labels.map((l, i) => ({ x: i, y: 1, r: Math.max(4, data[i] / 2) })),
            backgroundColor: bg,
          }]},
          options: { scales: noScales },
        };

      // ── Circular ───────────────────────────────────────────
      case "donut":
        return {
          type: "doughnut",
          data: { labels, datasets: [{ data, backgroundColor: bg, borderWidth: 0 }] },
          options: { cutout: "60%" },
        };
      case "pie":
        return {
          type: "pie",
          data: { labels, datasets: [{ data, backgroundColor: bg, borderWidth: 0 }] },
        };
      case "polar":
        return {
          type: "polarArea",
          data: { labels, datasets: [{ data, backgroundColor: bg, borderWidth: 0 }] },
          options: { scales: { r: { display: false } } },
        };
      case "radar":
        return {
          type: "radar",
          data: { labels, datasets: [{
            data, borderColor: accent, backgroundColor: accent + "55",
            pointRadius: 0, borderWidth: 2,
          }]},
          options: { scales: { r: { display: false } } },
        };

      case "split_card":
        // Yes/No styled donut
        return {
          type: "doughnut",
          data: {
            labels: labels.slice(0, 2),
            datasets: [{ data: data.slice(0, 2), backgroundColor: [accent, accent2], borderWidth: 0 }],
          },
          options: { cutout: "72%", rotation: -90, circumference: 180 },
        };

      // ── Lines & distribution ───────────────────────────────
      case "line":
      case "smooth_area":
      case "area":
      case "distribution":
        return {
          type: "line",
          data: { labels, datasets: [{
            data,
            borderColor: accent,
            backgroundColor: accent + "33",
            fill: chartId !== "line",
            tension: chartId === "smooth_area" || chartId === "distribution" ? 0.5 : 0.2,
            pointRadius: 0, borderWidth: 2,
          }]},
          options: { scales: tinyTicks },
        };

      case "histogram":
        return {
          type: "bar",
          data: { labels, datasets: [{ data, backgroundColor: accent, barPercentage: 1, categoryPercentage: 1 }] },
          options: { scales: tinyTicks },
        };

      case "gauge": {
        // Half-doughnut gauge: value vs (max - value)
        const max = Math.max(...data) * 1.6;
        const val = data.reduce((a, b) => a + b, 0) / data.length;
        return {
          type: "doughnut",
          data: { datasets: [{ data: [val, max - val],
                               backgroundColor: [accent, "rgba(255,255,255,.12)"],
                               borderWidth: 0 }] },
          options: { rotation: -90, circumference: 180, cutout: "72%" },
        };
      }

      case "avg_marker":
        return {
          type: "bar",
          data: { labels, datasets: [{ data, backgroundColor: bg, borderRadius: 3 }] },
          options: { scales: tinyTicks },
        };

      case "nps_segments": {
        // Three coloured bars: detractors / passives / promoters
        return {
          type: "bar",
          data: {
            labels: ["Detractors","Passives","Promoters"],
            datasets: [{
              data: [
                data.slice(0, 7).reduce((a, b) => a + b, 0),
                data.slice(7, 9).reduce((a, b) => a + b, 0),
                data.slice(9).reduce((a, b) => a + b, 0),
              ],
              backgroundColor: ["#ef4444","#fbbf24","#22c55e"],
              borderRadius: 4,
            }],
          },
          options: { scales: tinyTicks },
        };
      }

      // ── Text/special ───────────────────────────────────────
      case "wordcloud":
      case "bubble":
      case "tags":
        // Use bubbles as a stand-in
        return {
          type: "bubble",
          data: { datasets: [{
            data: labels.map((l, i) => ({
              x: (i % 4) + 0.4, y: Math.floor(i / 4) + 0.4,
              r: Math.max(8, data[i] || 4),
            })),
            backgroundColor: labels.map((_, i) => i % 2 === 0 ? accent : accent2),
          }]},
          options: { scales: noScales },
        };

      case "frequency_list":
      case "responses_list":
      case "open_list":
      case "quotes_carousel":
        // Render as horizontal bar (closest visual stand-in for "list")
        return {
          type: "bar",
          data: { labels, datasets: [{ data, backgroundColor: bg, borderRadius: 2 }] },
          options: { indexAxis: "y", scales: tinyTicks },
        };

      // ── Spatial ────────────────────────────────────────────
      case "heatmap": {
        // Coloured grid using bubbles in a 4×4 layout
        const points = [];
        for (let i = 0; i < 16; i++) {
          const v = (data[i % data.length] || 5) * (0.4 + Math.random() * 0.6);
          points.push({ x: i % 4, y: Math.floor(i / 4), r: 8 + v / 3 });
        }
        return {
          type: "bubble",
          data: { datasets: [{ data: points, backgroundColor: accent + "aa" }] },
          options: { scales: noScales },
        };
      }

      case "scatter":
        return {
          type: "scatter",
          data: { datasets: [{
            data: labels.map((_, i) => ({
              x: Math.random(), y: Math.random(),
            })),
            backgroundColor: accent,
            pointRadius: 6,
          }]},
          options: { scales: noScales },
        };

      // ── Time ───────────────────────────────────────────────
      case "timeline":
        return {
          type: "line",
          data: { labels, datasets: [{
            data, borderColor: accent, backgroundColor: accent + "44",
            fill: true, tension: 0.3, pointRadius: 3, borderWidth: 2,
          }]},
          options: { scales: tinyTicks },
        };

      // ── Progress / leaderboard ─────────────────────────────
      case "progress_bars":
      case "leaderboard":
        return {
          type: "bar",
          data: { labels, datasets: [{ data, backgroundColor: bg, borderRadius: 6 }] },
          options: { indexAxis: "y", scales: tinyTicks },
        };

      // ── Media / live ───────────────────────────────────────
      case "gallery":
      case "live_burst":
      case "map":
      case "treemap":
      case "flow":
      default:
        // Generic fallback — a colourful bar so the preview still draws
        return {
          type: "bar",
          data: { labels, datasets: [{ data, backgroundColor: bg, borderRadius: 4 }] },
          options: { scales: tinyTicks },
        };
    }
  }

  // ── Picker integration ─────────────────────────────────────────
  let currentChart = null;

  function getAccents() {
    const style = getComputedStyle(document.documentElement);
    const a1 = style.getPropertyValue("--kk-accent")?.trim()   || "#7c3aed";
    const a2 = style.getPropertyValue("--kk-accent-2")?.trim() || "#22d3ee";
    return [a1, a2];
  }

  function getCurrentType() {
    const sel = document.getElementById("id_question_type");
    return sel?.value || "mcq";
  }

  function getCurrentChartId() {
    const sel = document.getElementById("id_chart_type");
    return sel?.value || "bar";
  }


  function isRichChart(chartId) {
    return String(chartId || "").startsWith("plotly_") || chartId === "folium_map";
  }

  function drawRichPreview(canvas, chartId, sample, accent, accent2) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "rgba(34,211,238,.30)");
    g.addColorStop(1, "rgba(124,58,237,.30)");
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,.18)";
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    const labels = sample.labels || [];
    const data = sample.data || [];
    const max = Math.max(1, ...data);

    if (chartId === "folium_map" || chartId === "plotly_geo") {
      ctx.fillStyle = "rgba(14,165,233,.18)";
      ctx.fillRect(20, 30, w - 40, h - 52);
      ctx.strokeStyle = "rgba(255,255,255,.34)";
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(28 + i * 45, 35);
        ctx.bezierCurveTo(60 + i * 22, 55, 55 + i * 32, 86, 90 + i * 28, 108);
        ctx.stroke();
      }
      [[.32,.42],[.55,.58],[.72,.37],[.42,.72]].forEach((pt,i)=>{
        ctx.beginPath(); ctx.arc(20 + pt[0]*(w-40), 30 + pt[1]*(h-52), 7 + i*2, 0, Math.PI*2);
        ctx.fillStyle = i % 2 ? accent : accent2; ctx.fill();
        ctx.strokeStyle = "white"; ctx.stroke();
      });
    } else if (["plotly_pie","plotly_donut","plotly_sunburst","plotly_gauge"].includes(chartId)) {
      let start = -Math.PI / 2;
      const total = data.reduce((a,b)=>a+b,0) || 1;
      data.slice(0,6).forEach((v,i)=>{
        const end = start + (v/total)*Math.PI*2;
        ctx.beginPath(); ctx.moveTo(w/2,h/2); ctx.arc(w/2,h/2,44,start,end); ctx.closePath();
        ctx.fillStyle = i % 2 ? accent : accent2; ctx.globalAlpha = .92 - i*.06; ctx.fill(); ctx.globalAlpha = 1;
        start=end;
      });
      if (["plotly_donut","plotly_sunburst","plotly_gauge"].includes(chartId)) { ctx.beginPath(); ctx.arc(w/2,h/2,23,0,Math.PI*2); ctx.fillStyle="#0b1020"; ctx.fill(); }
    } else if (["plotly_line","plotly_area","plotly_scatter","plotly_bubble","plotly_radar"].includes(chartId)) {
      ctx.strokeStyle = accent2; ctx.lineWidth = 3; ctx.beginPath();
      data.forEach((v,i)=>{ const x=25+i*((w-50)/Math.max(1,data.length-1)); const y=h-25-(v/max)*(h-55); if(i) ctx.lineTo(x,y); else ctx.moveTo(x,y); });
      ctx.stroke();
      data.forEach((v,i)=>{ const x=25+i*((w-50)/Math.max(1,data.length-1)); const y=h-25-(v/max)*(h-55); ctx.beginPath(); ctx.arc(x,y,chartId==='plotly_bubble'?7+v/max*11:5,0,Math.PI*2); ctx.fillStyle=i%2?accent:accent2; ctx.fill(); });
    } else {
      const bw = (w - 45) / Math.max(1, data.length);
      data.forEach((v,i)=>{ const bh=(v/max)*(h-46); ctx.fillStyle=i%2?accent:accent2; ctx.fillRect(24+i*bw, h-22-bh, Math.max(7,bw*.62), bh); });
    }

    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(chartId === "folium_map" ? "Folium / Leaflet" : "Plotly rich", 14, 22);
  }

  function render() {
    const canvas = document.getElementById("chart-preview");
    if (!canvas) return;
    const qtype = getCurrentType();
    const chartId = getCurrentChartId();
    const sample = sampleFor(qtype);
    const [a1, a2] = getAccents();
    const cfg = makeConfig(chartId, sample, a1, a2);

    if (currentChart) {
      try { currentChart.destroy(); } catch (e) {}
      currentChart = null;
    }

    if (isRichChart(chartId)) {
      drawRichPreview(canvas, chartId, sample, a1, a2);
    } else {
      currentChart = new Chart(canvas.getContext("2d"), cfg);
    }

    // Update the small label below the canvas, if present.
    const labelEl = document.getElementById("chart-preview-label");
    if (labelEl) {
      const tile = document.querySelector(`.kk-chart-tile[data-chart-id="${chartId}"]`);
      labelEl.textContent = tile?.querySelector(".kk-chart-label")?.textContent || chartId;
    }
  }

  // Wire up: clicks on tiles, changes on the hidden select, and question-type changes.
  function init() {
    const picker = document.getElementById("chart-picker");
    if (!picker) return;
    picker.addEventListener("click", (e) => {
      const tile = e.target.closest(".kk-chart-tile");
      if (tile) {
        // The picker's own click handler updates the hidden select before us
        // because addEventListener ordering matches DOM order. Defer one tick.
        setTimeout(render, 0);
      }
    });

    document.getElementById("id_chart_type")?.addEventListener("change", render);
    document.getElementById("id_question_type")?.addEventListener("change", () => {
      // Type change is followed by a server-side redirect, but render the
      // preview anyway in case the user toggles type without reloading.
      setTimeout(render, 0);
    });

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
