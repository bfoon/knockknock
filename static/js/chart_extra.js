/* chart_extra.js — rich presenter chart renderers for Knock-Knock.
 *
 * Loaded BEFORE present.js. Exposes one entry point:
 *
 *   window.kkRenderExtraChart({chartId, questionType, question, labels,
 *                             tallyData, liveCanvas, specialEl,
 *                             chartHolder, destroyChartForSpecialDisplay})
 *
 * Returns true if it handled the chart, false otherwise. When it returns
 * false, present.js falls through to the original Chart.js-based renderer
 * in chart_preview.js (window.kkRenderLive), which already covers bar,
 * column, donut, pie, horizontal_bar, treemap, etc.
 *
 * The renderers below all paint into `specialEl` (and hide #live-chart),
 * which is the same scaffolding the picture-choice / puzzle renderers use.
 * Each is responsive: they read specialEl.clientWidth and re-render on
 * window resize (debounced to one rAF). They also degrade gracefully when
 * there is no data yet (empty-state copy).
 *
 * Design language matches play_poll.html: glass surfaces, #22d3ee / #7c3aed
 * accent gradients, rounded geometry. No external libraries — only Chart.js
 * (which is already loaded) for the gauge/distribution/histogram fallbacks.
 */
(function () {
  // ───────── Renderer registry ─────────
  const RENDERERS = {};

  // Inject styles once on first use.
  function ensureStyles() {
    if (document.getElementById("kk-chart-extra-styles")) return;
    const style = document.createElement("style");
    style.id = "kk-chart-extra-styles";
    style.textContent = STYLES;
    document.head.appendChild(style);
  }

  // ───────── Public entry point ─────────
  window.kkRenderExtraChart = function (ctx) {
    const id = String(ctx.chartId || "").toLowerCase();
    const fn = RENDERERS[id];
    if (typeof fn !== "function") return false;

    ensureStyles();

    // Always switch to specialEl mode (hide the Chart.js canvas).
    if (typeof ctx.destroyChartForSpecialDisplay === "function") {
      ctx.destroyChartForSpecialDisplay();
    } else {
      if (ctx.liveCanvas) ctx.liveCanvas.style.display = "none";
      if (ctx.specialEl) {
        ctx.specialEl.style.display = "block";
        ctx.specialEl.innerHTML = "";
      }
    }

    try {
      fn(ctx);
    } catch (err) {
      console.error("[chart_extra] renderer failed for", id, err);
      if (ctx.specialEl) {
        ctx.specialEl.innerHTML = `<div class="kk-extra-empty">Couldn't render this chart.</div>`;
      }
    }
    return true;
  };

  // ───────── Helpers ─────────
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function sum(values) { return values.reduce((a, b) => a + Number(b || 0), 0); }
  function maxValue(values) { return values.reduce((m, v) => Math.max(m, Number(v) || 0), 0); }

  function emptyState(specialEl, label) {
    specialEl.innerHTML = `<div class="kk-extra-empty">
      <div class="kk-extra-empty-emoji">📊</div>
      <div class="kk-extra-empty-text">${escapeHtml(label || "Waiting for the first response…")}</div>
    </div>`;
  }

  // Aggregate raw text values into {phrase: count} respecting case-insensitive
  // matching but preserving the original casing of the first occurrence.
  function tokenizeAndCount(texts) {
    const counts = new Map();
    const display = new Map();
    (texts || []).forEach(raw => {
      const t = String(raw || "").trim();
      if (!t) return;
      const key = t.toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
      if (!display.has(key)) display.set(key, t);
    });
    return Array.from(counts.entries())
      .map(([k, n]) => ({ word: display.get(k), n }))
      .sort((a, b) => b.n - a.n);
  }

  // Count Response choices keyed by choice id, given a list of {id,text} and a
  // counts dict. Returns array of {id, text, n, pct, image_url}.
  function aggregateChoices(question, tallyData) {
    const counts = (tallyData && tallyData.counts) || {};
    const choices = Array.isArray(question && question.choices) ? question.choices : [];
    const rows = choices.map(c => {
      const n = Number(counts[String(c.id)] ?? counts[c.id] ?? 0);
      return { id: c.id, text: c.text, n, image_url: c.image_url || "" };
    });
    const total = sum(rows.map(r => r.n));
    rows.forEach(r => { r.pct = total > 0 ? (r.n / total) * 100 : 0; });
    return { rows, total };
  }

  // ───────── ranked_bar ─────────
  // For ranking questions: each Response row has numeric_value = N - rank_idx,
  // so a higher numeric value means it was ranked higher by more people. The
  // server's `_sync_tally` counts each row once, so sum of counts per choice
  // gives total weighted score (proxy for "average rank goodness").
  RENDERERS.ranked_bar = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total) return emptyState(specialEl, "Waiting for the first ranking…");

    rows.sort((a, b) => b.n - a.n);
    const top = rows[0].n || 1;

    const html = `
      <div class="kk-extra kk-ranked-bar">
        <ol class="kk-ranked-list">
          ${rows.map((r, i) => `
            <li class="kk-ranked-row" style="--row-w:${(r.n / top) * 100}%; --row-delay:${i * 60}ms">
              <span class="kk-ranked-place ${i < 3 ? "podium-" + (i + 1) : ""}">${i + 1}</span>
              <span class="kk-ranked-text">${escapeHtml(r.text)}</span>
              <span class="kk-ranked-bar-track">
                <span class="kk-ranked-bar-fill"></span>
              </span>
              <span class="kk-ranked-n">${r.n}</span>
            </li>`).join("")}
        </ol>
      </div>`;
    specialEl.innerHTML = html;
  };

  // ───────── flow (simplified Sankey) ─────────
  // We render a left-to-right stacked column of choices weighted by votes.
  // True multi-stage Sankey isn't worth the complexity for this use case;
  // a "vote river" already communicates relative volume effectively.
  RENDERERS.flow = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total) return emptyState(specialEl, "Waiting for votes…");
    rows.sort((a, b) => b.n - a.n);

    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316", "#8b5cf6", "#06b6d4"];
    const segs = rows.map((r, i) => ({
      ...r,
      color: palette[i % palette.length],
      h: Math.max(2, (r.n / total) * 100),
    }));

    specialEl.innerHTML = `
      <div class="kk-extra kk-flow">
        <div class="kk-flow-stage" aria-label="Vote distribution flow">
          <div class="kk-flow-source">All votes <span>${total}</span></div>
          <svg class="kk-flow-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            ${(() => {
              let y = 0;
              return segs.map(s => {
                const path = `M0,50 C30,50 30,${y + s.h / 2} 70,${y + s.h / 2} L100,${y + s.h / 2}`;
                y += s.h;
                return `<path d="${path}" stroke="${s.color}" stroke-width="${Math.max(1, s.h)}" fill="none" opacity=".85"/>`;
              }).join("");
            })()}
          </svg>
          <ol class="kk-flow-sink">
            ${segs.map(s => `
              <li style="--h:${s.h}%; --c:${s.color}" title="${escapeHtml(s.text)}">
                <span class="kk-flow-bar"></span>
                <span class="kk-flow-lbl">${escapeHtml(s.text)} <strong>${s.n}</strong></span>
              </li>`).join("")}
          </ol>
        </div>
      </div>`;
  };

  // ───────── wordcloud ─────────
  // Pure-CSS sizing: tier each word by frequency into 5 size buckets, scatter
  // with slight rotation. Reads from tallyData.texts (or the count keys).
  RENDERERS.wordcloud = function (ctx) {
    const { tallyData, specialEl } = ctx;
    const words = collectWords(tallyData);
    if (!words.length) return emptyState(specialEl, "Waiting for words…");

    const top = words[0].n;
    const tier = (n) => {
      const pct = n / top;
      if (pct >= 0.85) return 5;
      if (pct >= 0.55) return 4;
      if (pct >= 0.30) return 3;
      if (pct >= 0.15) return 2;
      return 1;
    };

    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316"];
    const items = words.slice(0, 80).map((w, i) => {
      const t = tier(w.n);
      const rot = (Math.random() * 8) - 4;
      const col = palette[i % palette.length];
      return `<span class="kk-wc-word tier-${t}" style="color:${col}; transform: rotate(${rot.toFixed(1)}deg)">${escapeHtml(w.word)}</span>`;
    }).join("");

    specialEl.innerHTML = `<div class="kk-extra kk-wordcloud">${items}</div>`;
  };

  // ───────── bubble ─────────
  // Same data as word cloud, but rendered as floating circles. Layout is a
  // pseudo-physics packing: place largest first, then smaller ones around.
  RENDERERS.bubble = function (ctx) {
    const { tallyData, specialEl } = ctx;
    const words = collectWords(tallyData);
    if (!words.length) return emptyState(specialEl, "Waiting for responses…");

    // Layout: greedy circle packing on a 100×60 canvas (vw/vh fractions).
    const W = 100, H = 60;
    const top = words[0].n;
    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316"];
    const placed = [];

    words.slice(0, 40).forEach((w, i) => {
      const r = Math.max(2.2, Math.min(11, 2.5 + (w.n / top) * 8.5));
      // Try ~80 random positions; keep the first that doesn't overlap.
      for (let attempt = 0; attempt < 80; attempt++) {
        const cx = r + Math.random() * (W - 2 * r);
        const cy = r + Math.random() * (H - 2 * r);
        const ok = placed.every(p => {
          const dx = p.cx - cx, dy = p.cy - cy;
          return Math.sqrt(dx * dx + dy * dy) > p.r + r + 0.6;
        });
        if (ok) {
          placed.push({ cx, cy, r, w, color: palette[i % palette.length] });
          break;
        }
      }
    });

    const bubbles = placed.map((p, i) => `
      <div class="kk-bubble"
           style="left:${p.cx}%; top:${(p.cy / H) * 100}%; width:${p.r * 2}%;
                  aspect-ratio:1/1; background:${p.color}; animation-delay:${i * 40}ms;">
        <span class="kk-bubble-text">${escapeHtml(p.w.word)}</span>
        <span class="kk-bubble-n">${p.w.n}</span>
      </div>`).join("");

    specialEl.innerHTML = `<div class="kk-extra kk-bubble-field">${bubbles}</div>`;
  };

  // ───────── frequency_list ─────────
  // Ordered "top N" list with counts and percentage bars.
  RENDERERS.frequency_list = function (ctx) {
    const { tallyData, specialEl } = ctx;
    const words = collectWords(tallyData);
    if (!words.length) return emptyState(specialEl, "Waiting for responses…");

    const total = sum(words.map(w => w.n));
    const top = words[0].n || 1;
    const rows = words.slice(0, 30).map((w, i) => `
      <li class="kk-freq-row" style="--w:${(w.n / top) * 100}%; --d:${i * 40}ms">
        <span class="kk-freq-rank">${i + 1}</span>
        <span class="kk-freq-word">${escapeHtml(w.word)}</span>
        <span class="kk-freq-track"><span class="kk-freq-fill"></span></span>
        <span class="kk-freq-n">${w.n}<small>${total ? Math.round((w.n / total) * 100) : 0}%</small></span>
      </li>`).join("");
    specialEl.innerHTML = `<div class="kk-extra kk-freq"><ol class="kk-freq-list">${rows}</ol></div>`;
  };

  // ───────── responses_list ─────────
  // Show actual full-text responses as cards. Scrollable column.
  RENDERERS.responses_list = function (ctx) {
    const { tallyData, specialEl } = ctx;
    const texts = (tallyData && Array.isArray(tallyData.texts)) ? tallyData.texts : [];
    if (!texts.length) return emptyState(specialEl, "Waiting for responses…");

    // De-dupe consecutive duplicates but keep order.
    const cards = texts.slice(-200).map((t, i) => `
      <div class="kk-resp-card" style="--d:${i * 30}ms">
        <span class="kk-resp-quote">“</span>
        <p>${escapeHtml(t)}</p>
      </div>`).join("");
    specialEl.innerHTML = `<div class="kk-extra kk-resp-list-wrap"><div class="kk-resp-list">${cards}</div></div>`;
  };

  // ───────── quotes_carousel ─────────
  // Cycle through responses, one at a time, big and bold.
  RENDERERS.quotes_carousel = function (ctx) {
    const { tallyData, specialEl } = ctx;
    const texts = (tallyData && Array.isArray(tallyData.texts)) ? tallyData.texts : [];
    if (!texts.length) return emptyState(specialEl, "Waiting for quotes…");

    let idx = 0;
    function paint() {
      const t = texts[idx % texts.length] || "";
      specialEl.innerHTML = `
        <div class="kk-extra kk-quote-stage">
          <div class="kk-quote-card" key="${idx}">
            <span class="kk-quote-mark">“</span>
            <p>${escapeHtml(t)}</p>
            <div class="kk-quote-dots">
              ${texts.slice(0, Math.min(texts.length, 10)).map((_, i) =>
                `<span class="${i === (idx % texts.length) % 10 ? "on" : ""}"></span>`
              ).join("")}
            </div>
          </div>
        </div>`;
    }
    paint();
    // Rotate every 4 seconds. Clear any prior interval first.
    if (window.__kkQuoteTimer) clearInterval(window.__kkQuoteTimer);
    if (texts.length > 1) {
      window.__kkQuoteTimer = setInterval(() => { idx++; paint(); }, 4000);
    }
  };

  // ───────── nps_segments ─────────
  // Detractors (0–6) / Passives (7–8) / Promoters (9–10).
  // Counts keys are stringified numeric values.
  RENDERERS.nps_segments = function (ctx) {
    const { tallyData, specialEl } = ctx;
    const counts = (tallyData && tallyData.counts) || {};
    let det = 0, pas = 0, pro = 0;
    for (let v = 0; v <= 10; v++) {
      const n = Number(counts[String(v)] || 0);
      if (v <= 6) det += n;
      else if (v <= 8) pas += n;
      else pro += n;
    }
    const total = det + pas + pro;
    if (!total) return emptyState(specialEl, "Waiting for NPS responses…");

    const pctDet = (det / total) * 100;
    const pctPro = (pro / total) * 100;
    const score = Math.round(pctPro - pctDet);

    specialEl.innerHTML = `
      <div class="kk-extra kk-nps">
        <div class="kk-nps-score" data-score="${score}">
          <div class="kk-nps-score-num">${score >= 0 ? "+" : ""}${score}</div>
          <div class="kk-nps-score-lbl">Net Promoter Score</div>
        </div>
        <div class="kk-nps-segs">
          <div class="kk-nps-seg det"  style="--w:${(det / total) * 100}%">
            <div class="kk-nps-seg-label">Detractors</div>
            <div class="kk-nps-seg-n">${det}<small>${Math.round((det / total) * 100)}%</small></div>
          </div>
          <div class="kk-nps-seg pas" style="--w:${(pas / total) * 100}%">
            <div class="kk-nps-seg-label">Passives</div>
            <div class="kk-nps-seg-n">${pas}<small>${Math.round((pas / total) * 100)}%</small></div>
          </div>
          <div class="kk-nps-seg pro" style="--w:${(pro / total) * 100}%">
            <div class="kk-nps-seg-label">Promoters</div>
            <div class="kk-nps-seg-n">${pro}<small>${Math.round((pro / total) * 100)}%</small></div>
          </div>
        </div>
        <div class="kk-nps-scale">
          ${Array.from({length: 11}, (_, v) => {
            const n = Number(counts[String(v)] || 0);
            const cls = v <= 6 ? "det" : v <= 8 ? "pas" : "pro";
            return `<div class="kk-nps-bar ${cls}" style="--h:${total ? (n / Math.max(...Array.from({length:11},(_,k)=>Number(counts[String(k)]||0)),1)) * 100 : 0}%">
              <span class="kk-nps-bar-n">${n}</span>
              <span class="kk-nps-bar-v">${v}</span>
            </div>`;
          }).join("")}
        </div>
      </div>`;
  };

  // ───────── split_card (Yes/No) ─────────
  RENDERERS.split_card = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total || rows.length < 2) return emptyState(specialEl, "Waiting for first response…");

    // Identify Yes/No semantically — fallback to first/second.
    const yes = rows.find(r => /^yes$/i.test(String(r.text).trim())) || rows[0];
    const no  = rows.find(r => /^no$/i.test(String(r.text).trim()))  || rows.find(r => r !== yes) || rows[1];

    const yesPct = (yes.n / total) * 100;
    const noPct  = (no.n  / total) * 100;

    specialEl.innerHTML = `
      <div class="kk-extra kk-split">
        <div class="kk-split-pane yes" style="--w:${yesPct}%">
          <div class="kk-split-emoji">🟢</div>
          <div class="kk-split-label">${escapeHtml(yes.text)}</div>
          <div class="kk-split-pct">${Math.round(yesPct)}%</div>
          <div class="kk-split-n">${yes.n} ${yes.n === 1 ? "vote" : "votes"}</div>
        </div>
        <div class="kk-split-pane no" style="--w:${noPct}%">
          <div class="kk-split-emoji">🔴</div>
          <div class="kk-split-label">${escapeHtml(no.text)}</div>
          <div class="kk-split-pct">${Math.round(noPct)}%</div>
          <div class="kk-split-n">${no.n} ${no.n === 1 ? "vote" : "votes"}</div>
        </div>
      </div>`;
  };

  // ───────── gauge ─────────
  // Semicircular gauge showing the average numeric value within a range.
  RENDERERS.gauge = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { vals, min, max } = collectNumeric(question, tallyData);
    if (!vals.length) return emptyState(specialEl, "Waiting for responses…");
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const pct = Math.max(0, Math.min(1, (avg - min) / Math.max(1e-9, max - min)));
    const angle = -90 + pct * 180; // -90 (left) → 90 (right)

    specialEl.innerHTML = `
      <div class="kk-extra kk-gauge">
        <svg viewBox="0 0 200 120" class="kk-gauge-svg" aria-hidden="true">
          <defs>
            <linearGradient id="kkGaugeGrad" x1="0" x2="1">
              <stop offset="0" stop-color="#fb7185"/>
              <stop offset=".5" stop-color="#fbbf24"/>
              <stop offset="1" stop-color="#22c55e"/>
            </linearGradient>
          </defs>
          <path d="M 20 100 A 80 80 0 0 1 180 100" stroke="rgba(255,255,255,.10)" stroke-width="22" fill="none" stroke-linecap="round"/>
          <path d="M 20 100 A 80 80 0 0 1 180 100" stroke="url(#kkGaugeGrad)" stroke-width="22" fill="none"
                stroke-linecap="round" stroke-dasharray="251.3" stroke-dashoffset="${251.3 * (1 - pct)}"/>
          <g transform="translate(100,100) rotate(${angle})">
            <line x1="0" y1="0" x2="0" y2="-70" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
            <circle r="8" fill="#fff"/>
          </g>
        </svg>
        <div class="kk-gauge-readout">
          <div class="kk-gauge-num">${avg.toFixed(avg % 1 === 0 ? 0 : 1)}</div>
          <div class="kk-gauge-range">${min} – ${max}</div>
          <div class="kk-gauge-meta">${vals.length} ${vals.length === 1 ? "response" : "responses"}</div>
        </div>
      </div>`;
  };

  // ───────── avg_marker ─────────
  // Single-axis number-line with the average plotted as a marker.
  RENDERERS.avg_marker = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { vals, min, max } = collectNumeric(question, tallyData);
    if (!vals.length) return emptyState(specialEl, "Waiting for responses…");
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const pct = Math.max(0, Math.min(100, ((avg - min) / Math.max(1e-9, max - min)) * 100));
    // Distribution dots: jitter each value vertically for a nice strip.
    const dots = vals.slice(-160).map(v => {
      const x = ((v - min) / Math.max(1e-9, max - min)) * 100;
      const y = 35 + Math.random() * 30;
      return `<span class="kk-avgm-dot" style="left:${x}%; top:${y}%;"></span>`;
    }).join("");

    specialEl.innerHTML = `
      <div class="kk-extra kk-avgm">
        <div class="kk-avgm-num">${avg.toFixed(avg % 1 === 0 ? 0 : 1)}</div>
        <div class="kk-avgm-sub">${vals.length} ${vals.length === 1 ? "response" : "responses"} · range ${min}–${max}</div>
        <div class="kk-avgm-strip">
          <div class="kk-avgm-track"></div>
          ${dots}
          <div class="kk-avgm-marker" style="left:${pct}%;">
            <span class="kk-avgm-flag">${avg.toFixed(avg % 1 === 0 ? 0 : 1)}</span>
          </div>
          <span class="kk-avgm-label kk-avgm-label-l">${min}</span>
          <span class="kk-avgm-label kk-avgm-label-r">${max}</span>
        </div>
      </div>`;
  };

  // ───────── distribution (bell curve) ─────────
  RENDERERS.distribution = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { vals, min, max } = collectNumeric(question, tallyData);
    if (!vals.length) return emptyState(specialEl, "Waiting for responses…");

    // 24-bin density
    const bins = 24;
    const buckets = new Array(bins).fill(0);
    const range = Math.max(1e-9, max - min);
    vals.forEach(v => {
      let idx = Math.floor(((v - min) / range) * bins);
      if (idx === bins) idx = bins - 1;
      if (idx < 0) idx = 0;
      buckets[idx]++;
    });
    const topB = Math.max(1, ...buckets);

    // Build smoothed SVG path (small moving avg).
    const smoothed = buckets.map((_, i) => {
      const w = [buckets[i - 1] || 0, buckets[i], buckets[i + 1] || 0];
      return (w[0] + 2 * w[1] + w[2]) / 4;
    });
    const topS = Math.max(1, ...smoothed);

    const W = 100, H = 60;
    const pts = smoothed.map((b, i) => {
      const x = (i / (bins - 1)) * W;
      const y = H - (b / topS) * (H * 0.9);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const path = `M 0,${H} L ${pts.join(" L ")} L ${W},${H} Z`;

    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const avgX = ((avg - min) / range) * W;

    specialEl.innerHTML = `
      <div class="kk-extra kk-dist">
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" class="kk-dist-svg">
          <defs>
            <linearGradient id="kkDistGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="#22d3ee" stop-opacity=".75"/>
              <stop offset="1" stop-color="#7c3aed" stop-opacity=".15"/>
            </linearGradient>
          </defs>
          <path d="${path}" fill="url(#kkDistGrad)" stroke="#22d3ee" stroke-width=".7"/>
          <line x1="${avgX}" x2="${avgX}" y1="0" y2="${H}" stroke="#fff" stroke-width=".5" stroke-dasharray="2 2"/>
        </svg>
        <div class="kk-dist-stats">
          <div><span>avg</span><strong>${avg.toFixed(avg % 1 === 0 ? 0 : 1)}</strong></div>
          <div><span>min</span><strong>${Math.min(...vals)}</strong></div>
          <div><span>max</span><strong>${Math.max(...vals)}</strong></div>
          <div><span>n</span><strong>${vals.length}</strong></div>
        </div>
      </div>`;
  };

  // ───────── histogram ─────────
  // Like a column chart but auto-binned for numeric data.
  RENDERERS.histogram = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { vals, min, max } = collectNumeric(question, tallyData);
    if (!vals.length) return emptyState(specialEl, "Waiting for responses…");

    // If the range is small and integer-like, use one bin per integer; else 12 bins.
    const intRange = max - min;
    let bins, edges;
    if (intRange <= 10 && vals.every(v => Number.isInteger(v))) {
      bins = intRange + 1;
      edges = Array.from({ length: bins + 1 }, (_, i) => min + i);
    } else {
      bins = 12;
      edges = Array.from({ length: bins + 1 }, (_, i) => min + (intRange * i) / bins);
    }

    const counts = new Array(bins).fill(0);
    vals.forEach(v => {
      let idx = Math.floor(((v - min) / Math.max(1e-9, intRange)) * bins);
      if (idx >= bins) idx = bins - 1;
      if (idx < 0) idx = 0;
      counts[idx]++;
    });
    const top = Math.max(1, ...counts);

    const bars = counts.map((n, i) => `
      <div class="kk-hist-bar" style="--h:${(n / top) * 100}%; --d:${i * 25}ms">
        <span class="kk-hist-n">${n}</span>
        <span class="kk-hist-bar-fill"></span>
        <span class="kk-hist-lbl">${formatBinLabel(edges[i], edges[i + 1], intRange)}</span>
      </div>`).join("");

    specialEl.innerHTML = `<div class="kk-extra kk-hist"><div class="kk-hist-grid">${bars}</div></div>`;
  };

  function formatBinLabel(a, b, range) {
    const dp = range >= 10 ? 0 : 1;
    if (Math.abs(b - a - 1) < 1e-6 && Number.isInteger(a)) return String(a);
    return `${a.toFixed(dp)}–${b.toFixed(dp)}`;
  }

  // ───────── heatmap ─────────
  // For pin_image, pin_map, two_by_two — we don't have x/y in the regular
  // tally counts, so we draw a 12×8 density grid driven by tallyData.points
  // if the server sends it; otherwise show a "needs coordinates" notice.
  // Also covers matrix questions when chart=heatmap by using matrix tally.
  RENDERERS.heatmap = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const qtype = (question && question.type) || "";

    if (qtype === "matrix") {
      return renderMatrixHeatmap(ctx);
    }

    const points = (tallyData && Array.isArray(tallyData.points)) ? tallyData.points : [];
    if (!points.length) {
      return emptyState(specialEl, "Waiting for pins…");
    }

    const cols = 14, rows = 9;
    const grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    points.forEach(p => {
      // Expect {x, y} in 0..100 percent space (image+map already normalized).
      const cx = Math.max(0, Math.min(cols - 1, Math.floor((Number(p.x) || 0) / 100 * cols)));
      const cy = Math.max(0, Math.min(rows - 1, Math.floor((Number(p.y) || 0) / 100 * rows)));
      grid[cy][cx]++;
    });
    const top = Math.max(1, ...grid.flat());

    const imgUrl = (question && question.image_url) || "";
    const bg = imgUrl
      ? `background:#000 center/contain no-repeat url('${imgUrl.replace(/'/g, "%27")}');`
      : `background: linear-gradient(135deg, #0f172a, #1e293b);`;

    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const n = grid[r][c];
        if (!n) continue;
        cells.push(`<div class="kk-heat-cell" style="
          left:${(c / cols) * 100}%; top:${(r / rows) * 100}%;
          width:${100 / cols}%; height:${100 / rows}%;
          opacity:${0.25 + (n / top) * 0.7};"></div>`);
      }
    }

    specialEl.innerHTML = `
      <div class="kk-extra kk-heat" style="${bg}">
        ${cells.join("")}
        <div class="kk-heat-legend">${points.length} ${points.length === 1 ? "pin" : "pins"}</div>
      </div>`;
  };

  function renderMatrixHeatmap(ctx) {
    const { question, tallyData, specialEl } = ctx;
    // Server can ship `tallyData.matrix` as {row_id: {value: count, ...}} or
    // {row_id: avg}. We accept either; if no matrix data, fall back to a hint.
    const matrix = (tallyData && tallyData.matrix) || null;
    const rows = Array.isArray(question.matrix_rows) ? question.matrix_rows : [];
    const cfg = (question.config) || {};
    const sMin = Number(cfg.scale_min || 1);
    const sMax = Number(cfg.scale_max || 5);
    if (!rows.length || !matrix) {
      return emptyState(specialEl, "Waiting for ratings…");
    }

    const cols = sMax - sMin + 1;
    const cells = rows.map((row, ri) => {
      const dist = matrix[String(row.id)] || matrix[row.id] || {};
      const rowCounts = [];
      let rowMax = 0, rowTotal = 0, rowSum = 0;
      for (let v = sMin; v <= sMax; v++) {
        const n = Number(dist[String(v)] || 0);
        rowCounts.push(n);
        rowMax = Math.max(rowMax, n);
        rowTotal += n;
        rowSum += v * n;
      }
      const avg = rowTotal ? (rowSum / rowTotal) : 0;
      const cellsHtml = rowCounts.map((n, ci) => `
        <div class="kk-matheat-cell" style="opacity:${rowMax ? 0.15 + (n / rowMax) * 0.85 : 0.05}">
          <span>${n || ""}</span>
        </div>`).join("");
      return `
        <div class="kk-matheat-row">
          <div class="kk-matheat-label">${escapeHtml(row.text)}</div>
          <div class="kk-matheat-cells" style="grid-template-columns: repeat(${cols}, 1fr);">${cellsHtml}</div>
          <div class="kk-matheat-avg">${rowTotal ? avg.toFixed(1) : "—"}</div>
        </div>`;
    }).join("");

    const headcells = Array.from({ length: cols }, (_, i) =>
      `<div class="kk-matheat-headcell">${sMin + i}</div>`).join("");

    specialEl.innerHTML = `
      <div class="kk-extra kk-matheat">
        <div class="kk-matheat-row kk-matheat-head">
          <div class="kk-matheat-label"></div>
          <div class="kk-matheat-cells" style="grid-template-columns: repeat(${cols}, 1fr);">${headcells}</div>
          <div class="kk-matheat-avg">avg</div>
        </div>
        ${cells}
      </div>`;
  }

  // ───────── scatter ─────────
  // 2D plot of pins / 2x2 selections.
  RENDERERS.scatter = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const points = (tallyData && Array.isArray(tallyData.points)) ? tallyData.points : [];
    if (!points.length) return emptyState(specialEl, "Waiting for placements…");

    const qtype = (question && question.type) || "";
    const isTwoByTwo = qtype === "two_by_two";

    let xL = "Low", xR = "High", yT = "High", yB = "Low";
    if (isTwoByTwo) {
      const cfg = question.config || {};
      xL = cfg.x_left   || xL;
      xR = cfg.x_right  || xR;
      yT = cfg.y_top    || yT;
      yB = cfg.y_bottom || yB;
    }

    const dots = points.map((p, i) => {
      const xn = Number(p.x) || 0;
      const yn = Number(p.y) || 0;
      let left, top;
      if (isTwoByTwo) {
        left = ((xn + 1) / 2) * 100;
        top  = ((1 - yn) / 2) * 100;
      } else {
        left = xn;       // assume 0..100
        top  = yn;
      }
      return `<span class="kk-scatter-dot" style="left:${left}%; top:${top}%; animation-delay:${i * 30}ms"></span>`;
    }).join("");

    specialEl.innerHTML = `
      <div class="kk-extra kk-scatter">
        <div class="kk-scatter-axis-x"></div>
        <div class="kk-scatter-axis-y"></div>
        <div class="kk-scatter-label top">${escapeHtml(yT)}</div>
        <div class="kk-scatter-label bottom">${escapeHtml(yB)}</div>
        <div class="kk-scatter-label left">${escapeHtml(xL)}</div>
        <div class="kk-scatter-label right">${escapeHtml(xR)}</div>
        ${dots}
        <div class="kk-scatter-meta">${points.length} ${points.length === 1 ? "placement" : "placements"}</div>
      </div>`;
  };

  // ───────── timeline ─────────
  // Dots on a time-axis (for date/datetime questions).
  RENDERERS.timeline = function (ctx) {
    const { tallyData, specialEl } = ctx;
    // Build dates from texts (ISO strings) and from any counts keyed by date.
    const texts = (tallyData && Array.isArray(tallyData.texts)) ? tallyData.texts : [];
    const dates = texts.map(parseLooseDate).filter(d => d != null);
    if (!dates.length) return emptyState(specialEl, "Waiting for dates…");

    dates.sort((a, b) => a - b);
    const minT = dates[0];
    const maxT = dates[dates.length - 1];
    const range = Math.max(1, maxT - minT);
    const dots = dates.map((t, i) => {
      const pct = ((t - minT) / range) * 100;
      return `<span class="kk-tl-dot" style="left:${pct}%; --d:${i * 20}ms" title="${new Date(t).toISOString()}"></span>`;
    }).join("");

    specialEl.innerHTML = `
      <div class="kk-extra kk-tl">
        <div class="kk-tl-axis"></div>
        ${dots}
        <div class="kk-tl-label l">${formatDateShort(minT)}</div>
        <div class="kk-tl-label r">${formatDateShort(maxT)}</div>
        <div class="kk-tl-meta">${dates.length} ${dates.length === 1 ? "response" : "responses"}</div>
      </div>`;
  };

  // ───────── gallery ─────────
  // For file_upload — show submitted images in a grid.
  RENDERERS.gallery = function (ctx) {
    const { tallyData, specialEl } = ctx;
    const files = (tallyData && Array.isArray(tallyData.files)) ? tallyData.files : [];
    if (!files.length) return emptyState(specialEl, "Waiting for uploads…");

    const tiles = files.slice(-48).map((f, i) => {
      const url = f.url || f;
      const isImg = !f.mime || /^image\//.test(f.mime) || /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(url);
      return `<figure class="kk-gallery-tile" style="--d:${i * 35}ms">
        ${isImg
          ? `<img src="${escapeHtml(url)}" alt="">`
          : `<div class="kk-gallery-file">📎 ${escapeHtml(f.name || "file")}</div>`}
      </figure>`;
    }).join("");
    specialEl.innerHTML = `<div class="kk-extra kk-gallery">${tiles}</div>`;
  };

  // ───────── live_burst ─────────
  // Already handled by reaction code in present.js. Show a calm waiting card.
  RENDERERS.live_burst = function (ctx) {
    const { specialEl } = ctx;
    specialEl.innerHTML = `
      <div class="kk-extra kk-burst">
        <div class="kk-burst-emoji">🎆</div>
        <h2>Reactions flying live</h2>
        <p>Watch the emojis rise as the room reacts.</p>
      </div>`;
  };

  // ───────── stacked_bar / grouped_bar ─────────
  // For likert-style stacked bars. We render simple horizontal stacks
  // (rather than diverging) since data is single-choice.
  RENDERERS.stacked_bar = function (ctx) {
    const { question, tallyData, specialEl } = ctx;

    if ((question && question.type) === "matrix") {
      return renderMatrixStackedBar(ctx);
    }

    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total) return emptyState(specialEl, "Waiting for responses…");
    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316", "#06b6d4"];

    const segs = rows.map((r, i) => `
      <div class="kk-stack-seg" style="--w:${(r.n / total) * 100}%; --c:${palette[i % palette.length]}">
        <span class="kk-stack-seg-fill"></span>
        <span class="kk-stack-seg-lbl">${escapeHtml(r.text)} <strong>${r.n}</strong></span>
      </div>`).join("");

    const legend = rows.map((r, i) => `
      <div class="kk-stack-leg"><i style="background:${palette[i % palette.length]}"></i>${escapeHtml(r.text)} — ${r.n} (${Math.round((r.n / total) * 100)}%)</div>`).join("");

    specialEl.innerHTML = `<div class="kk-extra kk-stack">
      <div class="kk-stack-bar">${segs}</div>
      <div class="kk-stack-legend">${legend}</div>
    </div>`;
  };

  function renderMatrixStackedBar(ctx) {
    // Each matrix row gets its own stacked bar of value distribution.
    const { question, tallyData, specialEl } = ctx;
    const matrix = (tallyData && tallyData.matrix) || null;
    const rows = Array.isArray(question.matrix_rows) ? question.matrix_rows : [];
    const cfg = question.config || {};
    const sMin = Number(cfg.scale_min || 1);
    const sMax = Number(cfg.scale_max || 5);

    if (!rows.length || !matrix) return emptyState(specialEl, "Waiting for ratings…");

    const palette = ["#fb7185", "#f97316", "#fbbf24", "#a3e635", "#22c55e", "#22d3ee", "#7c3aed"];
    const html = rows.map(row => {
      const dist = matrix[String(row.id)] || matrix[row.id] || {};
      const counts = [];
      let total = 0;
      for (let v = sMin; v <= sMax; v++) {
        const n = Number(dist[String(v)] || 0);
        counts.push({ v, n });
        total += n;
      }
      const segs = counts.map((c, i) => total
        ? `<div class="kk-stack-seg" style="--w:${(c.n / total) * 100}%; --c:${palette[i % palette.length]}">
            <span class="kk-stack-seg-fill"></span>
          </div>`
        : "").join("");
      return `<div class="kk-mstack-row">
        <div class="kk-mstack-label">${escapeHtml(row.text)}</div>
        <div class="kk-stack-bar">${total ? segs : `<div class="kk-stack-empty">no responses yet</div>`}</div>
      </div>`;
    }).join("");

    const legendItems = [];
    for (let v = sMin, i = 0; v <= sMax; v++, i++) {
      legendItems.push(`<div class="kk-stack-leg"><i style="background:${palette[i % palette.length]}"></i>${v}</div>`);
    }

    specialEl.innerHTML = `<div class="kk-extra kk-mstack">
      ${html}
      <div class="kk-stack-legend">${legendItems.join("")}</div>
    </div>`;
  }

  RENDERERS.grouped_bar = function (ctx) {
    // Stripe each choice's count as a vertical column group.
    const { question, tallyData, specialEl } = ctx;
    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total) return emptyState(specialEl, "Waiting for responses…");

    const top = Math.max(1, ...rows.map(r => r.n));
    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316"];

    const cols = rows.map((r, i) => `
      <div class="kk-gbar-col" style="--c:${palette[i % palette.length]}; --d:${i * 50}ms">
        <span class="kk-gbar-n">${r.n}</span>
        <span class="kk-gbar-fill" style="--h:${(r.n / top) * 100}%"></span>
        <span class="kk-gbar-lbl">${escapeHtml(r.text)}</span>
      </div>`).join("");

    specialEl.innerHTML = `<div class="kk-extra kk-gbar"><div class="kk-gbar-grid">${cols}</div></div>`;
  };

  // ───────── Word/text data extractor ─────────
  // Pulls phrases from tallyData.texts; if empty, falls back to counts keyed
  // by phrase (covers some servers that aggregate text into counts).
  function collectWords(tallyData) {
    const texts = (tallyData && Array.isArray(tallyData.texts)) ? tallyData.texts : null;
    if (texts && texts.length) return tokenizeAndCount(texts);

    const counts = (tallyData && tallyData.counts) || {};
    const arr = Object.entries(counts)
      .filter(([k]) => isNaN(Number(k)) && k.trim() !== "")  // skip numeric/choice-id keys
      .map(([word, n]) => ({ word, n: Number(n) || 0 }))
      .filter(r => r.n > 0)
      .sort((a, b) => b.n - a.n);
    return arr;
  }

  // ───────── Numeric data extractor ─────────
  // Pulls a flat list of numeric values and a (min,max) range. Tries:
  //  1) tallyData.values (preferred: server sends raw list)
  //  2) tallyData.counts keyed by numeric strings (multiplies by count)
  //  3) tallyData.texts parsed as numbers
  function collectNumeric(question, tallyData) {
    const cfg = (question && question.config) || {};
    let vals = [];

    if (tallyData && Array.isArray(tallyData.values)) {
      vals = tallyData.values.map(Number).filter(Number.isFinite);
    }

    if (!vals.length && tallyData && tallyData.counts) {
      Object.entries(tallyData.counts).forEach(([k, n]) => {
        const num = Number(k);
        if (Number.isFinite(num)) {
          for (let i = 0; i < Number(n || 0); i++) vals.push(num);
        }
      });
    }

    if (!vals.length && tallyData && Array.isArray(tallyData.texts)) {
      tallyData.texts.forEach(t => {
        const num = Number(t);
        if (Number.isFinite(num)) vals.push(num);
      });
    }

    // Determine range — prefer question config, else data extents.
    const qmin = Number((question && question.scale_min) ?? cfg.min ?? cfg.scale_min);
    const qmax = Number((question && question.scale_max) ?? cfg.max ?? cfg.scale_max);
    const min = Number.isFinite(qmin) ? qmin : (vals.length ? Math.min(...vals) : 0);
    const max = Number.isFinite(qmax) ? qmax : (vals.length ? Math.max(...vals) : Math.max(min + 1, 10));

    return { vals, min, max };
  }

  function parseLooseDate(s) {
    if (s == null) return null;
    const t = String(s).trim();
    if (!t) return null;
    // YYYY-MM-DD, ISO datetime, or HH:MM (treat as today)
    const d = new Date(t);
    if (!isNaN(d.getTime())) return d.getTime();
    return null;
  }

  function formatDateShort(t) {
    try {
      const d = new Date(t);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    } catch (e) { return ""; }
  }

  // ───────── Styles ─────────
  const STYLES = `
    .kk-extra {
      width: 100%; height: 100%;
      box-sizing: border-box;
      padding: clamp(1rem, 2.5vw, 1.75rem);
      color: #f8fafc;
      font-family: 'Satoshi', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    }
    .kk-extra-empty {
      width: 100%; height: 100%; display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      text-align: center; gap: .75rem;
      opacity: .7;
    }
    .kk-extra-empty-emoji { font-size: 3.5rem; opacity: .55; }
    .kk-extra-empty-text { font-size: 1.2rem; }

    /* ── ranked_bar ── */
    .kk-ranked-bar { display: flex; flex-direction: column; }
    .kk-ranked-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .55rem; }
    .kk-ranked-row {
      display: grid;
      grid-template-columns: 40px minmax(0, 1fr) minmax(0, 2.5fr) auto;
      align-items: center; gap: .75rem;
      padding: .7rem .9rem;
      border-radius: 14px;
      background: rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.08);
      animation: kkRankIn .45s cubic-bezier(.4,0,.2,1) both;
      animation-delay: var(--row-delay, 0ms);
    }
    @keyframes kkRankIn { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: none; } }
    .kk-ranked-place {
      width: 36px; height: 36px; border-radius: 999px;
      display: inline-flex; align-items: center; justify-content: center;
      font-weight: 900; font-size: 1.1rem;
      background: rgba(255,255,255,.08);
    }
    .kk-ranked-place.podium-1 { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #1f2937; }
    .kk-ranked-place.podium-2 { background: linear-gradient(135deg, #cbd5e1, #94a3b8); color: #1f2937; }
    .kk-ranked-place.podium-3 { background: linear-gradient(135deg, #f97316, #c2410c); }
    .kk-ranked-text { font-weight: 700; font-size: 1.05rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kk-ranked-bar-track {
      position: relative;
      height: 14px; border-radius: 999px;
      background: rgba(255,255,255,.08);
      overflow: hidden;
    }
    .kk-ranked-bar-fill {
      position: absolute; left: 0; top: 0; bottom: 0;
      width: var(--row-w, 0%);
      background: linear-gradient(90deg, #22d3ee, #7c3aed);
      border-radius: inherit;
      animation: kkRankFill .8s cubic-bezier(.4,0,.2,1) both;
      animation-delay: calc(var(--row-delay, 0ms) + 150ms);
    }
    @keyframes kkRankFill { from { width: 0; } }
    .kk-ranked-n { font-weight: 800; font-size: 1.05rem; min-width: 2.5ch; text-align: right; }

    /* ── flow ── */
    .kk-flow { display: flex; flex-direction: column; height: 100%; }
    .kk-flow-stage { position: relative; flex: 1; display: grid; grid-template-columns: auto 1fr auto; gap: 1rem; align-items: center; min-height: 0; }
    .kk-flow-source {
      align-self: center;
      padding: 1rem 1.25rem; border-radius: 16px;
      background: rgba(255,255,255,.08); font-weight: 800;
    }
    .kk-flow-source span { display: block; font-size: 1.6rem; color: #22d3ee; }
    .kk-flow-svg { width: 100%; height: 100%; }
    .kk-flow-sink { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .35rem; min-width: 0; }
    .kk-flow-sink li { display: flex; align-items: center; gap: .55rem; min-width: 0; }
    .kk-flow-bar { display: inline-block; width: 8px; height: var(--h, 5%); background: var(--c, #22d3ee); border-radius: 4px; }
    .kk-flow-lbl { font-size: .95rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kk-flow-lbl strong { margin-left: .35rem; }

    /* ── wordcloud ── */
    .kk-wordcloud {
      display: flex; flex-wrap: wrap;
      align-items: center; justify-content: center;
      gap: .25rem .65rem;
      padding: clamp(1rem, 3vw, 2rem);
      line-height: 1;
    }
    .kk-wc-word {
      font-family: 'Clash Display', system-ui, sans-serif;
      font-weight: 800;
      animation: kkWcIn .5s cubic-bezier(.4,0,.2,1) both;
      animation-delay: calc(var(--d, 0) * 40ms);
      transform-origin: center;
    }
    .kk-wc-word.tier-1 { font-size: clamp(1rem, 1.8vw, 1.6rem); opacity: .7; }
    .kk-wc-word.tier-2 { font-size: clamp(1.4rem, 2.6vw, 2.2rem); opacity: .85; }
    .kk-wc-word.tier-3 { font-size: clamp(1.8rem, 3.5vw, 3rem); }
    .kk-wc-word.tier-4 { font-size: clamp(2.4rem, 4.5vw, 4rem); }
    .kk-wc-word.tier-5 { font-size: clamp(3rem, 6vw, 5.5rem); text-shadow: 0 0 35px currentColor; }
    @keyframes kkWcIn { from { opacity: 0; transform: scale(.3) rotate(0); } }

    /* ── bubble ── */
    .kk-bubble-field { position: relative; width: 100%; height: 100%; min-height: 380px; }
    .kk-bubble {
      position: absolute;
      transform: translate(-50%, -50%);
      border-radius: 50%;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: rgba(0,0,0,.85); font-weight: 800;
      text-align: center; padding: .25rem;
      box-shadow: 0 14px 30px rgba(0,0,0,.35), inset 0 -8px 18px rgba(0,0,0,.18), inset 0 8px 18px rgba(255,255,255,.45);
      animation: kkBubbleIn .55s cubic-bezier(.4,0,.2,1) both, kkBubbleFloat 6s ease-in-out infinite alternate;
      will-change: transform;
    }
    @keyframes kkBubbleIn { from { opacity: 0; transform: translate(-50%, -50%) scale(.2); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
    @keyframes kkBubbleFloat { to { transform: translate(-50%, calc(-50% - 8px)) scale(1.02); } }
    .kk-bubble-text {
      font-size: clamp(.7rem, 1.4vw, 1.25rem);
      line-height: 1.05;
      padding: 0 .4rem;
      max-width: 92%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .kk-bubble-n {
      font-size: clamp(.55rem, 1vw, .85rem);
      opacity: .55;
    }

    /* ── frequency_list ── */
    .kk-freq-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .4rem; }
    .kk-freq-row {
      display: grid;
      grid-template-columns: 32px minmax(0, 2fr) minmax(0, 3fr) auto;
      gap: .65rem; align-items: center;
      padding: .5rem .65rem;
      border-radius: 12px;
      background: rgba(255,255,255,.05);
      animation: kkRankIn .45s cubic-bezier(.4,0,.2,1) both;
      animation-delay: var(--d, 0ms);
    }
    .kk-freq-rank { font-weight: 800; opacity: .55; text-align: center; }
    .kk-freq-word { font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .kk-freq-track { position: relative; height: 10px; border-radius: 999px; background: rgba(255,255,255,.08); overflow: hidden; }
    .kk-freq-fill {
      position: absolute; left: 0; top: 0; bottom: 0;
      width: var(--w, 0%);
      background: linear-gradient(90deg, #22d3ee, #7c3aed);
      border-radius: inherit;
      animation: kkRankFill .7s both;
      animation-delay: calc(var(--d, 0ms) + 120ms);
    }
    .kk-freq-n { font-weight: 800; min-width: 4ch; text-align: right; }
    .kk-freq-n small { display: block; opacity: .6; font-size: .7rem; font-weight: 600; }

    /* ── responses_list ── */
    .kk-resp-list-wrap { height: 100%; overflow-y: auto; padding-right: .35rem; }
    .kk-resp-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: .65rem;
    }
    .kk-resp-card {
      position: relative;
      padding: 1rem 1.1rem .9rem;
      border-radius: 14px;
      background: linear-gradient(135deg, rgba(124, 58, 237, .14), rgba(34, 211, 238, .08));
      border: 1px solid rgba(255,255,255,.10);
      animation: kkRankIn .45s cubic-bezier(.4,0,.2,1) both;
      animation-delay: var(--d, 0ms);
    }
    .kk-resp-quote { font-family: Georgia, serif; font-size: 2.5rem; line-height: 0; opacity: .35; position: absolute; top: 1rem; left: .55rem; }
    .kk-resp-card p { margin: 0 0 0 1.1rem; font-size: 1rem; line-height: 1.35; }

    /* ── quotes_carousel ── */
    .kk-quote-stage { display: flex; align-items: center; justify-content: center; height: 100%; }
    .kk-quote-card {
      max-width: 900px;
      padding: clamp(1.5rem, 4vw, 3rem);
      text-align: center;
      animation: kkQuoteIn .6s cubic-bezier(.4,0,.2,1) both;
    }
    @keyframes kkQuoteIn { from { opacity: 0; transform: translateY(20px); } }
    .kk-quote-mark { font-family: Georgia, serif; font-size: clamp(4rem, 10vw, 8rem); color: #22d3ee; opacity: .55; line-height: 0; display: block; margin-bottom: -.5rem; }
    .kk-quote-card p { font-family: 'Cormorant Garamond', 'Lora', Georgia, serif; font-style: italic; font-size: clamp(1.5rem, 3.4vw, 3rem); line-height: 1.25; margin: 1rem 0; }
    .kk-quote-dots { display: flex; gap: .35rem; justify-content: center; margin-top: 1rem; }
    .kk-quote-dots span { width: 8px; height: 8px; border-radius: 50%; background: rgba(255,255,255,.25); }
    .kk-quote-dots span.on { background: #22d3ee; transform: scale(1.4); }

    /* ── NPS segments ── */
    .kk-nps { display: grid; gap: 1rem; height: 100%; align-content: center; }
    .kk-nps-score { text-align: center; }
    .kk-nps-score-num {
      font-family: 'Clash Display', system-ui, sans-serif;
      font-size: clamp(3rem, 7vw, 6rem); font-weight: 900;
      background: linear-gradient(135deg, #22d3ee, #7c3aed);
      -webkit-background-clip: text; background-clip: text; color: transparent;
      line-height: 1;
    }
    .kk-nps-score-lbl { opacity: .65; font-size: .9rem; letter-spacing: .15em; text-transform: uppercase; }
    .kk-nps-segs { display: flex; height: 56px; gap: 6px; border-radius: 14px; overflow: hidden; }
    .kk-nps-seg {
      flex: var(--w, 1) 0 0; display: grid; place-items: center; padding: 0 .5rem;
      min-width: 0; position: relative; transition: flex .5s cubic-bezier(.4,0,.2,1);
    }
    .kk-nps-seg.det { background: linear-gradient(135deg, #dc2626, #991b1b); }
    .kk-nps-seg.pas { background: linear-gradient(135deg, #fbbf24, #d97706); color: #1f2937; }
    .kk-nps-seg.pro { background: linear-gradient(135deg, #22c55e, #15803d); }
    .kk-nps-seg-label { font-size: .75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; }
    .kk-nps-seg-n { font-size: 1.2rem; font-weight: 900; }
    .kk-nps-seg-n small { font-weight: 600; opacity: .8; margin-left: .25rem; }
    .kk-nps-scale { display: grid; grid-template-columns: repeat(11, 1fr); gap: 6px; align-items: end; height: 110px; }
    .kk-nps-bar {
      position: relative; height: var(--h, 0%); min-height: 18px; border-radius: 6px;
      display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
      padding: .25rem 0;
      transition: height .5s cubic-bezier(.4,0,.2,1);
    }
    .kk-nps-bar.det { background: rgba(220, 38, 38, .55); }
    .kk-nps-bar.pas { background: rgba(251, 191, 36, .55); }
    .kk-nps-bar.pro { background: rgba(34, 197, 94, .55); }
    .kk-nps-bar-n { font-size: .75rem; font-weight: 800; color: #fff; }
    .kk-nps-bar-v { position: absolute; bottom: -1.4rem; font-size: .8rem; opacity: .7; }

    /* ── split_card ── */
    .kk-split { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; height: 100%; }
    .kk-split-pane {
      border-radius: 24px;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: .35rem; padding: 1.5rem;
      position: relative;
      transition: opacity .35s ease;
    }
    .kk-split-pane.yes { background: linear-gradient(160deg, rgba(34, 197, 94, .35), rgba(22, 163, 74, .18)); border: 1px solid rgba(34, 197, 94, .35); }
    .kk-split-pane.no  { background: linear-gradient(160deg, rgba(220, 38, 38, .35), rgba(127, 29, 29, .18)); border: 1px solid rgba(220, 38, 38, .35); }
    .kk-split-emoji { font-size: clamp(3rem, 6vw, 5rem); }
    .kk-split-label { font-size: clamp(1.5rem, 3vw, 2.5rem); font-weight: 900; }
    .kk-split-pct { font-family: 'Clash Display', system-ui, sans-serif; font-size: clamp(3rem, 9vw, 7rem); font-weight: 900; line-height: 1; }
    .kk-split-n { opacity: .8; font-size: 1rem; }
    .kk-split-pane[style*="--w:0"] { opacity: .35; }

    /* ── gauge ── */
    .kk-gauge { display: grid; place-items: center; gap: 1rem; height: 100%; }
    .kk-gauge-svg { width: min(80%, 520px); height: auto; }
    .kk-gauge-readout { text-align: center; }
    .kk-gauge-num { font-family: 'Clash Display', system-ui, sans-serif; font-size: clamp(3rem, 7vw, 5.5rem); font-weight: 900; line-height: 1; }
    .kk-gauge-range { opacity: .6; font-size: .9rem; letter-spacing: .1em; }
    .kk-gauge-meta { opacity: .55; font-size: .85rem; margin-top: .35rem; }

    /* ── avg_marker ── */
    .kk-avgm { display: grid; place-items: center; gap: 1rem; height: 100%; padding: 2rem; }
    .kk-avgm-num { font-family: 'Clash Display', system-ui, sans-serif; font-size: clamp(4rem, 12vw, 9rem); font-weight: 900; line-height: 1;
      background: linear-gradient(135deg, #22d3ee, #7c3aed);
      -webkit-background-clip: text; background-clip: text; color: transparent; }
    .kk-avgm-sub { opacity: .7; font-size: 1rem; }
    .kk-avgm-strip { position: relative; width: min(80%, 760px); height: 64px; }
    .kk-avgm-track { position: absolute; left: 0; right: 0; top: 50%; height: 4px; margin-top: -2px; background: rgba(255,255,255,.10); border-radius: 999px; }
    .kk-avgm-dot {
      position: absolute; width: 8px; height: 8px; border-radius: 50%; background: rgba(34, 211, 238, .55);
      transform: translate(-50%, -50%);
      animation: kkAvgmDot .4s both;
    }
    @keyframes kkAvgmDot { from { transform: translate(-50%, -50%) scale(0); } }
    .kk-avgm-marker {
      position: absolute; top: 50%; transform: translate(-50%, -50%);
      width: 24px; height: 24px; border-radius: 50%;
      background: linear-gradient(135deg, #22d3ee, #7c3aed);
      box-shadow: 0 0 0 4px rgba(255,255,255,.85), 0 0 30px rgba(34, 211, 238, .85);
      transition: left .6s cubic-bezier(.4,0,.2,1);
    }
    .kk-avgm-flag {
      position: absolute; left: 50%; bottom: 130%; transform: translateX(-50%);
      padding: .2rem .55rem; background: #fff; color: #0f172a; border-radius: 8px;
      font-weight: 900; font-size: .9rem; white-space: nowrap;
    }
    .kk-avgm-label { position: absolute; top: 130%; transform: translateX(-50%); font-size: .8rem; opacity: .65; }
    .kk-avgm-label-l { left: 0; }
    .kk-avgm-label-r { left: 100%; }

    /* ── distribution / histogram ── */
    .kk-dist { display: grid; gap: 1rem; height: 100%; grid-template-rows: 1fr auto; }
    .kk-dist-svg { width: 100%; height: 100%; }
    .kk-dist-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: .5rem; }
    .kk-dist-stats > div { text-align: center; padding: .5rem; background: rgba(255,255,255,.05); border-radius: 10px; }
    .kk-dist-stats span { display: block; opacity: .6; font-size: .75rem; letter-spacing: .12em; text-transform: uppercase; }
    .kk-dist-stats strong { font-family: 'Clash Display', system-ui, sans-serif; font-size: 1.5rem; font-weight: 900; }

    .kk-hist { height: 100%; }
    .kk-hist-grid { display: flex; align-items: flex-end; gap: 6px; height: 100%; padding-bottom: 2rem; padding-top: 1rem; }
    .kk-hist-bar { flex: 1; position: relative; display: flex; flex-direction: column; justify-content: flex-end; min-width: 0; }
    .kk-hist-bar-fill {
      width: 100%; height: var(--h, 0%);
      background: linear-gradient(180deg, #22d3ee, #7c3aed);
      border-radius: 6px 6px 0 0;
      animation: kkHistBar .5s cubic-bezier(.4,0,.2,1) both;
      animation-delay: var(--d, 0ms);
      transition: height .35s ease;
    }
    @keyframes kkHistBar { from { height: 0 !important; } }
    .kk-hist-n { position: absolute; top: -1.4rem; left: 50%; transform: translateX(-50%); font-weight: 800; font-size: .85rem; }
    .kk-hist-lbl { position: absolute; bottom: -1.65rem; left: 50%; transform: translateX(-50%); font-size: .75rem; opacity: .7; white-space: nowrap; }

    /* ── heatmap (pin / map) ── */
    .kk-heat { position: relative; width: 100%; height: 100%; border-radius: 18px; overflow: hidden; }
    .kk-heat-cell {
      position: absolute;
      background: radial-gradient(circle at 50% 50%, rgba(251, 113, 133, .85), rgba(124, 58, 237, .35) 60%, transparent 75%);
      mix-blend-mode: screen;
      pointer-events: none;
    }
    .kk-heat-legend {
      position: absolute; bottom: .85rem; right: .85rem;
      padding: .35rem .75rem; border-radius: 999px;
      background: rgba(0,0,0,.55); font-size: .85rem; font-weight: 600;
    }

    /* ── matrix heatmap ── */
    .kk-matheat { display: flex; flex-direction: column; gap: .5rem; }
    .kk-matheat-row {
      display: grid;
      grid-template-columns: minmax(180px, 1.4fr) minmax(0, 3fr) 60px;
      gap: .75rem; align-items: center;
    }
    .kk-matheat-row.kk-matheat-head { opacity: .55; font-size: .75rem; text-transform: uppercase; letter-spacing: .08em; padding-bottom: .35rem; border-bottom: 1px solid rgba(255,255,255,.08); }
    .kk-matheat-label { font-size: 1rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .kk-matheat-cells { display: grid; gap: 4px; }
    .kk-matheat-cell {
      aspect-ratio: 2 / 1;
      background: linear-gradient(135deg, #22d3ee, #7c3aed);
      border-radius: 6px;
      display: grid; place-items: center;
      font-weight: 800; color: #0f172a;
    }
    .kk-matheat-headcell {
      aspect-ratio: 2 / 1; display: grid; place-items: center;
      font-weight: 700;
    }
    .kk-matheat-avg { font-family: 'Clash Display', system-ui, sans-serif; font-size: 1.3rem; font-weight: 900; text-align: right; }

    /* ── scatter / 2x2 ── */
    .kk-scatter {
      position: relative;
      aspect-ratio: 1 / 1;
      max-width: 760px;
      margin: 0 auto;
      border-radius: 18px;
      background: rgba(255,255,255,.03);
      border: 1px solid rgba(255,255,255,.10);
    }
    .kk-scatter-axis-x, .kk-scatter-axis-y { position: absolute; background: rgba(255,255,255,.25); }
    .kk-scatter-axis-x { left: 5%; right: 5%; top: 50%; height: 1px; }
    .kk-scatter-axis-y { top: 5%; bottom: 5%; left: 50%; width: 1px; }
    .kk-scatter-label { position: absolute; font-size: .8rem; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; opacity: .8; }
    .kk-scatter-label.top    { top: .65rem; left: 50%; transform: translateX(-50%); }
    .kk-scatter-label.bottom { bottom: .65rem; left: 50%; transform: translateX(-50%); }
    .kk-scatter-label.left   { left: .65rem; top: 50%; transform: translateY(-50%) rotate(-90deg); transform-origin: left center; }
    .kk-scatter-label.right  { right: .65rem; top: 50%; transform: translateY(-50%) rotate(90deg); transform-origin: right center; }
    .kk-scatter-dot {
      position: absolute; width: 16px; height: 16px;
      margin-left: -8px; margin-top: -8px;
      border-radius: 50%;
      background: radial-gradient(circle at 30% 30%, #22d3ee, #7c3aed);
      box-shadow: 0 0 0 3px rgba(34, 211, 238, .25), 0 4px 10px rgba(0,0,0,.4);
      animation: kkScatterIn .4s both;
    }
    @keyframes kkScatterIn { from { transform: scale(0); } to { transform: scale(1); } }
    .kk-scatter-meta { position: absolute; bottom: .65rem; right: .65rem; font-size: .8rem; opacity: .7; }

    /* ── timeline ── */
    .kk-tl { position: relative; padding: 4rem 2rem 4rem; }
    .kk-tl-axis { height: 3px; background: linear-gradient(90deg, #22d3ee, #7c3aed); border-radius: 999px; position: relative; }
    .kk-tl-dot {
      position: absolute; top: 50%; transform: translate(-50%, -50%);
      width: 14px; height: 14px; border-radius: 50%;
      background: #fff;
      box-shadow: 0 0 0 4px rgba(34, 211, 238, .55), 0 0 18px rgba(34, 211, 238, .85);
      animation: kkScatterIn .35s both;
      animation-delay: var(--d, 0ms);
    }
    .kk-tl-label { position: absolute; font-size: .85rem; opacity: .75; }
    .kk-tl-label.l { left: 1rem; bottom: 1rem; }
    .kk-tl-label.r { right: 1rem; bottom: 1rem; }
    .kk-tl-meta { position: absolute; top: 1rem; right: 1rem; font-size: .85rem; opacity: .7; }

    /* ── gallery ── */
    .kk-gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: .55rem;
      align-content: start;
      overflow-y: auto;
      max-height: 100%;
    }
    .kk-gallery-tile {
      margin: 0; aspect-ratio: 1;
      border-radius: 12px; overflow: hidden;
      background: rgba(255,255,255,.05);
      animation: kkRankIn .4s both;
      animation-delay: var(--d, 0ms);
    }
    .kk-gallery-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .kk-gallery-file { width: 100%; height: 100%; display: grid; place-items: center; padding: .5rem; font-size: .9rem; text-align: center; }

    /* ── burst placeholder ── */
    .kk-burst { display: grid; place-items: center; text-align: center; height: 100%; gap: 1rem; }
    .kk-burst-emoji { font-size: clamp(5rem, 14vw, 12rem); animation: kkBurstWobble 3s ease-in-out infinite; }
    @keyframes kkBurstWobble { 50% { transform: scale(1.1) rotate(-3deg); } }
    .kk-burst h2 { font-family: 'Clash Display', system-ui, sans-serif; font-size: clamp(2rem, 5vw, 3.5rem); margin: 0; }
    .kk-burst p { opacity: .75; font-size: 1.15rem; }

    /* ── stacked_bar (and matrix variant) ── */
    .kk-stack { display: flex; flex-direction: column; gap: 1rem; }
    .kk-stack-bar { display: flex; height: 40px; border-radius: 10px; overflow: hidden; background: rgba(255,255,255,.05); }
    .kk-stack-seg { flex: var(--w, 1) 0 0; position: relative; display: flex; align-items: center; justify-content: center; min-width: 0;
      transition: flex .5s cubic-bezier(.4,0,.2,1); overflow: hidden; }
    .kk-stack-seg-fill { position: absolute; inset: 0; background: var(--c, #22d3ee); }
    .kk-stack-seg-lbl { position: relative; z-index: 1; font-weight: 700; font-size: .85rem; padding: 0 .5rem;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: rgba(0,0,0,.85); }
    .kk-stack-empty { width: 100%; padding: .5rem 1rem; opacity: .55; font-size: .85rem; align-self: center; }
    .kk-stack-legend { display: flex; flex-wrap: wrap; gap: .65rem 1rem; font-size: .85rem; }
    .kk-stack-leg { display: inline-flex; align-items: center; gap: .35rem; }
    .kk-stack-leg i { width: 14px; height: 14px; border-radius: 4px; display: inline-block; }
    .kk-mstack { display: flex; flex-direction: column; gap: .6rem; }
    .kk-mstack-row { display: grid; grid-template-columns: minmax(180px, 1.2fr) minmax(0, 3fr); gap: .75rem; align-items: center; }
    .kk-mstack-label { font-weight: 700; font-size: .95rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; }

    /* ── grouped_bar ── */
    .kk-gbar { height: 100%; }
    .kk-gbar-grid { display: flex; align-items: flex-end; justify-content: space-around; gap: 1rem; height: 100%; padding: 1.5rem 1rem 2.5rem; }
    .kk-gbar-col { flex: 1; position: relative; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; max-width: 120px; min-width: 0; }
    .kk-gbar-n { font-family: 'Clash Display', system-ui, sans-serif; font-weight: 900; font-size: 1.5rem; margin-bottom: .35rem; }
    .kk-gbar-fill {
      width: 100%; height: var(--h, 0%);
      background: linear-gradient(180deg, var(--c, #22d3ee), color-mix(in srgb, var(--c, #22d3ee) 50%, #0f172a));
      border-radius: 12px 12px 0 0;
      box-shadow: 0 -6px 22px color-mix(in srgb, var(--c, #22d3ee) 35%, transparent);
      animation: kkHistBar .5s cubic-bezier(.4,0,.2,1) both;
      animation-delay: var(--d, 0ms);
      transition: height .35s ease;
      min-height: 6px;
    }
    .kk-gbar-lbl { position: absolute; bottom: -2rem; left: 50%; transform: translateX(-50%); font-size: .85rem; opacity: .8; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  `;
})();
