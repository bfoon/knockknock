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

  // ───────── flow (vote ribbons) ─────────
  // Left-side "all votes" pill feeds proportional ribbons into right-side
  // outputs. The previous implementation tried a single SVG path per choice
  // with stroke-width = segment height, but that produced overlapping
  // straight lines on most container shapes. The version below draws true
  // cubic-bezier ribbons whose vertical positions are computed in viewBox
  // coordinates, so it scales properly.
  RENDERERS.flow = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total) return emptyState(specialEl, "Waiting for votes…");
    rows.sort((a, b) => b.n - a.n);

    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316", "#06b6d4", "#8b5cf6"];

    // viewBox: 1000 wide × 600 tall. Source occupies y ∈ [80, 520] on the
    // left; each ribbon's right end is positioned by its cumulative share.
    const VBW = 1000, VBH = 600;
    const srcX = 60, sinkX = 720, sinkLabelX = 760;
    const srcTop = 80, srcBot = 520;
    const srcMid = (srcTop + srcBot) / 2;
    const srcSpan = srcBot - srcTop;

    // Each ribbon spans the same height as its share of the source on both
    // sides — visually communicates "weight".
    let cumul = 0;
    const ribbons = rows.map((r, i) => {
      const share = r.n / total;
      const segH = share * srcSpan;
      const sourceY = srcTop + cumul + segH / 2;
      const sinkY = srcTop + cumul + segH / 2; // same vertical for clean lanes
      cumul += segH;
      const color = palette[i % palette.length];

      // Cubic bezier between source point and sink point.
      const c1x = srcX + (sinkX - srcX) * 0.45;
      const c2x = srcX + (sinkX - srcX) * 0.55;

      return {
        path: `M ${srcX} ${sourceY.toFixed(2)} C ${c1x.toFixed(2)} ${sourceY.toFixed(2)}, ${c2x.toFixed(2)} ${sinkY.toFixed(2)}, ${sinkX} ${sinkY.toFixed(2)}`,
        strokeW: Math.max(2, segH),
        color, r, sinkY, share,
      };
    });

    const ribbonSvg = ribbons.map((rb, i) => `
      <path d="${rb.path}" stroke="${rb.color}" stroke-width="${rb.strokeW.toFixed(1)}"
            fill="none" stroke-linecap="round" opacity="0.78"
            style="animation: kkFlowIn .8s cubic-bezier(.4,0,.2,1) both; animation-delay:${i * 90}ms;
                   stroke-dasharray:${(rb.strokeW * 30).toFixed(0)};
                   stroke-dashoffset:${(rb.strokeW * 30).toFixed(0)};"/>`).join("");

    const sinkLabels = ribbons.map((rb, i) => `
      <g transform="translate(${sinkLabelX}, ${rb.sinkY.toFixed(2)})">
        <rect x="0" y="-18" rx="9" ry="9" width="220" height="36"
              fill="rgba(255,255,255,.06)" stroke="${rb.color}" stroke-width="1"/>
        <circle cx="14" cy="0" r="6" fill="${rb.color}"/>
        <text x="28" y="0" dominant-baseline="middle"
              font-family="'Clash Display',system-ui,sans-serif" font-weight="700"
              font-size="14" fill="#f8fafc">${escapeHtml(rb.r.text.slice(0, 18))}</text>
        <text x="210" y="0" dominant-baseline="middle" text-anchor="end"
              font-family="'Clash Display',system-ui,sans-serif" font-weight="900"
              font-size="14" fill="#f8fafc">${rb.r.n}</text>
      </g>`).join("");

    specialEl.innerHTML = `
      <div class="kk-extra kk-flow">
        <svg viewBox="0 0 ${VBW} ${VBH}" preserveAspectRatio="xMidYMid meet" class="kk-flow-svg">
          <defs>
            <linearGradient id="kkFlowSrc" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stop-color="#7c3aed"/>
              <stop offset="1" stop-color="#22d3ee"/>
            </linearGradient>
          </defs>
          <rect x="${srcX - 36}" y="${srcTop}" width="36" height="${srcSpan}"
                rx="14" fill="url(#kkFlowSrc)" opacity="0.85"/>
          <text x="${srcX - 18}" y="${(srcTop - 22)}" text-anchor="middle"
                font-family="'Clash Display',system-ui,sans-serif" font-weight="900"
                font-size="22" fill="#f8fafc">${total}</text>
          <text x="${srcX - 18}" y="${(srcBot + 30)}" text-anchor="middle"
                font-family="'Clash Display',system-ui,sans-serif"
                font-size="12" fill="rgba(248,250,252,.65)"
                letter-spacing="2">VOTES</text>
          ${ribbonSvg}
          ${sinkLabels}
        </svg>
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
  // Same data as word cloud, but rendered as floating circles.
  //
  // Why this is SVG, not CSS: the old version absolutely-positioned <div>s
  // with `width: r%` + `aspect-ratio: 1/1`. That produces circles whose
  // diameter is `r% of container width`, but the *vertical* layout was being
  // packed in a 60-unit space. On a tall presenter screen the bubbles
  // overlapped; on a short one they overflowed; on every screen the "circles"
  // were actually ellipses because the aspect ratio of the field ≠ 1:1.
  //
  // The SVG below uses a single viewBox so the packing math holds at any
  // container size, and we run the packer against the *actual* aspect ratio
  // of specialEl so bubbles fill the area properly.
  RENDERERS.bubble = function (ctx) {
    const { tallyData, specialEl } = ctx;
    const words = collectWords(tallyData);
    if (!words.length) return emptyState(specialEl, "Waiting for responses…");

    // Measure the host so we can pack into the real aspect ratio.
    // Fall back to a reasonable default if the element isn't laid out yet.
    const hostW = specialEl.clientWidth || 1200;
    const hostH = specialEl.clientHeight || 600;
    const aspect = hostW / hostH;

    // viewBox: 1000 units wide, height derived from aspect so 1 unit ≈
    // 1 unit on screen (so we can reason about pixel spacing).
    const VBW = 1000;
    const VBH = Math.round(VBW / aspect);

    const top = words[0].n;
    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316", "#06b6d4", "#8b5cf6"];

    // Radius scale: largest bubble takes ~22% of the shortest side; smallest
    // ~4%. Square-root scaling keeps small values readable.
    const shortSide = Math.min(VBW, VBH);
    const rMax = shortSide * 0.22;
    const rMin = shortSide * 0.04;
    const radiusFor = (n) => rMin + (rMax - rMin) * Math.sqrt(n / top);

    // Greedy packing — try the centre first (largest bubble pinned there),
    // then for each subsequent word try ~300 random positions and pick the
    // first one that doesn't overlap an already-placed bubble.
    const placed = [];
    const items = words.slice(0, 50);

    items.forEach((w, i) => {
      const r = radiusFor(w.n);
      let cx, cy, ok = false;

      // First bubble goes near centre.
      if (i === 0) {
        cx = VBW / 2;
        cy = VBH / 2;
        ok = true;
      } else {
        // Try expanding rings around the centre — gives a tighter, more
        // "bubbly" cluster than pure-random placement, which scatters.
        for (let attempt = 0; attempt < 400 && !ok; attempt++) {
          // Spiral outward: each attempt nudges the search radius up.
          const searchR = (attempt / 400) * Math.min(VBW, VBH) * 0.55;
          const angle = Math.random() * Math.PI * 2;
          cx = VBW / 2 + Math.cos(angle) * searchR;
          cy = VBH / 2 + Math.sin(angle) * searchR;

          // Keep inside the box (with a small padding).
          if (cx - r < 4 || cx + r > VBW - 4) continue;
          if (cy - r < 4 || cy + r > VBH - 4) continue;

          ok = placed.every(p => {
            const dx = p.cx - cx, dy = p.cy - cy;
            return Math.sqrt(dx * dx + dy * dy) > p.r + r + 3;
          });
        }
      }

      if (ok) placed.push({ cx, cy, r, w, color: palette[i % palette.length] });
    });

    // Build the SVG. Each bubble = circle + word label + count.
    // Font size scales with the bubble radius so big bubbles get readable
    // labels and tiny ones don't overflow.
    const circles = placed.map((p, i) => {
      const labelSize = Math.max(11, Math.min(p.r * 0.42, p.r * 0.5));
      const countSize = Math.max(9, labelSize * 0.55);
      // Truncate very long words to fit inside the circle. Roughly:
      // a glyph at fontSize Y is ~0.55Y wide, so chars-that-fit = 1.6r / (0.55*Y).
      const maxChars = Math.max(3, Math.floor((p.r * 1.6) / (labelSize * 0.55)));
      const label = p.w.word.length > maxChars
        ? p.w.word.slice(0, maxChars - 1) + "…"
        : p.w.word;

      return `
        <g class="kk-bubble-g" style="animation-delay:${i * 50}ms; transform-origin:${p.cx}px ${p.cy}px;">
          <circle cx="${p.cx}" cy="${p.cy}" r="${p.r}"
                  fill="${p.color}"
                  filter="url(#kkBubbleShadow)"
                  opacity="0.92"/>
          <circle cx="${p.cx}" cy="${p.cy - p.r * 0.35}" r="${p.r * 0.78}"
                  fill="url(#kkBubbleSheen)" opacity="0.55"
                  pointer-events="none"/>
          <text x="${p.cx}" y="${p.cy}" text-anchor="middle"
                dominant-baseline="middle"
                font-family="'Clash Display', system-ui, sans-serif"
                font-weight="800"
                font-size="${labelSize}"
                fill="rgba(15,23,42,.92)">${escapeHtml(label)}</text>
          <text x="${p.cx}" y="${p.cy + labelSize * 0.85}" text-anchor="middle"
                dominant-baseline="middle"
                font-family="'Clash Display', system-ui, sans-serif"
                font-weight="700"
                font-size="${countSize}"
                fill="rgba(15,23,42,.65)">${p.w.n}</text>
        </g>`;
    }).join("");

    specialEl.innerHTML = `
      <div class="kk-extra kk-bubble-field">
        <svg viewBox="0 0 ${VBW} ${VBH}" preserveAspectRatio="xMidYMid meet" class="kk-bubble-svg">
          <defs>
            <radialGradient id="kkBubbleSheen" cx="50%" cy="35%" r="55%">
              <stop offset="0%"  stop-color="#ffffff" stop-opacity="0.85"/>
              <stop offset="60%" stop-color="#ffffff" stop-opacity="0.10"/>
              <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
            </radialGradient>
            <filter id="kkBubbleShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="6"/>
              <feOffset dx="0" dy="6" result="off"/>
              <feComponentTransfer><feFuncA type="linear" slope="0.35"/></feComponentTransfer>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          ${circles}
        </svg>
      </div>`;
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
  // tally counts, so we draw a density grid driven by tallyData.points
  // if the server sends it. With no image background and no points yet,
  // we render a faded grid + "Waiting for pins…" message rather than an
  // empty box.
  RENDERERS.heatmap = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const qtype = (question && question.type) || "";

    if (qtype === "matrix") {
      return renderMatrixHeatmap(ctx);
    }

    const points = (tallyData && Array.isArray(tallyData.points)) ? tallyData.points : [];
    const imgUrl = (question && question.image_url) || "";

    if (!points.length) {
      // Show a faded grid so the chart area isn't just a blank rectangle.
      // This communicates "this *is* a heatmap, just no data yet".
      const placeholderCells = Array.from({ length: 14 * 9 }, (_, i) => {
        const r = Math.floor(i / 14);
        const c = i % 14;
        return `<div class="kk-heat-empty-cell" style="
          left:${(c / 14) * 100}%; top:${(r / 9) * 100}%;
          width:${100 / 14}%; height:${100 / 9}%;
        "></div>`;
      }).join("");
      const bg = imgUrl
        ? `background:#000 center/contain no-repeat url('${imgUrl.replace(/'/g, "%27")}');`
        : `background: linear-gradient(135deg, #0f172a, #1e293b);`;
      specialEl.innerHTML = `
        <div class="kk-extra kk-heat kk-heat-waiting" style="${bg}">
          ${placeholderCells}
          <div class="kk-heat-waiting-msg">
            <div class="kk-heat-waiting-emoji">📍</div>
            <div>Waiting for pins…</div>
          </div>
        </div>`;
      return;
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

  // ───────── rounded_bar / gradient_bar ─────────
  // These are stylistic variants of `column` — same vertical bars but with
  // different fills. Falling back to Chart.js loses the visual identity the
  // picker promised, so we render them here with the column scaffold and
  // a slightly different look.
  RENDERERS.rounded_bar = function (ctx) {
    return renderColumnVariant(ctx, "rounded");
  };
  RENDERERS.gradient_bar = function (ctx) {
    return renderColumnVariant(ctx, "gradient");
  };

  function renderColumnVariant(ctx, variant) {
    const { question, tallyData, specialEl } = ctx;
    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total) return emptyState(specialEl, "Waiting for responses…");

    const top = Math.max(1, ...rows.map(r => r.n));
    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316", "#06b6d4"];

    const cols = rows.map((r, i) => {
      const c = palette[i % palette.length];
      return `
      <div class="kk-col-col kk-col-${variant}" style="--c:${c}; --d:${i * 50}ms; --h:${(r.n / top) * 100}%">
        <div class="kk-col-fill">
          <span class="kk-col-n">${r.n}</span>
        </div>
        <div class="kk-col-lbl" title="${escapeHtml(r.text)}">${escapeHtml(r.text)}</div>
        <div class="kk-col-pct">${Math.round((r.n / total) * 100)}%</div>
      </div>`;
    }).join("");

    specialEl.innerHTML = `<div class="kk-extra kk-col-chart"><div class="kk-col-grid">${cols}</div></div>`;
  }

  // ───────── column ─────────
  // Like grouped_bar but with the count inside the bar instead of above,
  // and a flat baseline. Closer in feel to a classic "column chart".
  RENDERERS.column = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total) return emptyState(specialEl, "Waiting for responses…");

    const top = Math.max(1, ...rows.map(r => r.n));
    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316", "#06b6d4"];

    const cols = rows.map((r, i) => `
      <div class="kk-col-col" style="--c:${palette[i % palette.length]}; --d:${i * 50}ms; --h:${(r.n / top) * 100}%">
        <div class="kk-col-fill">
          <span class="kk-col-n">${r.n}</span>
        </div>
        <div class="kk-col-lbl" title="${escapeHtml(r.text)}">${escapeHtml(r.text)}</div>
        <div class="kk-col-pct">${Math.round((r.n / total) * 100)}%</div>
      </div>`).join("");

    specialEl.innerHTML = `<div class="kk-extra kk-col-chart"><div class="kk-col-grid">${cols}</div></div>`;
  };

  // ───────── lollipop ─────────
  // Skinny vertical stick with a fat dot on top. Reads cleanly even with
  // many categories because the dot anchors the eye to the value.
  RENDERERS.lollipop = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total) return emptyState(specialEl, "Waiting for responses…");

    const top = Math.max(1, ...rows.map(r => r.n));
    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316", "#06b6d4"];

    const pops = rows.map((r, i) => `
      <div class="kk-pop-col" style="--c:${palette[i % palette.length]}; --d:${i * 60}ms; --h:${(r.n / top) * 100}%">
        <span class="kk-pop-n">${r.n}</span>
        <span class="kk-pop-dot"></span>
        <span class="kk-pop-stick"></span>
        <span class="kk-pop-lbl">${escapeHtml(r.text)}</span>
      </div>`).join("");

    specialEl.innerHTML = `<div class="kk-extra kk-pop"><div class="kk-pop-grid">${pops}</div></div>`;
  };

  // ───────── bubble_count ─────────
  // One bubble per choice, sized by count. Different from `bubble` (word
  // cloud) — uses the question's actual choices, not free-text responses.
  RENDERERS.bubble_count = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total) return emptyState(specialEl, "Waiting for responses…");

    const hostW = specialEl.clientWidth || 1200;
    const hostH = specialEl.clientHeight || 600;
    const aspect = hostW / hostH;
    const VBW = 1000;
    const VBH = Math.round(VBW / aspect);

    const top = Math.max(1, ...rows.map(r => r.n));
    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316", "#06b6d4", "#8b5cf6"];

    const shortSide = Math.min(VBW, VBH);
    const rMax = shortSide * 0.24;
    const rMin = shortSide * 0.08;

    // Arrange bubbles in a single horizontal row if there are few, else
    // wrap into a centred cluster. Force-directed would be nicer but is
    // overkill for ≤10 choices.
    const placed = [];
    const radii = rows.map(r => rMin + (rMax - rMin) * Math.sqrt(r.n / top));
    const totalW = radii.reduce((a, r) => a + 2 * r + 16, 0);

    if (totalW < VBW * 0.95) {
      // Single row, centred.
      let x = (VBW - totalW) / 2;
      radii.forEach((r, i) => {
        placed.push({ cx: x + r, cy: VBH / 2, r, row: rows[i], color: palette[i % palette.length] });
        x += 2 * r + 16;
      });
    } else {
      // Spiral packing for many choices.
      radii.forEach((r, i) => {
        let cx, cy, ok = false;
        if (i === 0) { cx = VBW / 2; cy = VBH / 2; ok = true; }
        else {
          for (let attempt = 0; attempt < 400 && !ok; attempt++) {
            const searchR = (attempt / 400) * Math.min(VBW, VBH) * 0.55;
            const angle = Math.random() * Math.PI * 2;
            cx = VBW / 2 + Math.cos(angle) * searchR;
            cy = VBH / 2 + Math.sin(angle) * searchR;
            if (cx - r < 4 || cx + r > VBW - 4 || cy - r < 4 || cy + r > VBH - 4) continue;
            ok = placed.every(p => Math.hypot(p.cx - cx, p.cy - cy) > p.r + r + 4);
          }
        }
        if (ok) placed.push({ cx, cy, r, row: rows[i], color: palette[i % palette.length] });
      });
    }

    const circles = placed.map((p, i) => {
      const labelSize = Math.max(11, Math.min(p.r * 0.32, p.r * 0.4));
      const countSize = Math.max(14, p.r * 0.55);
      const maxChars = Math.max(3, Math.floor((p.r * 1.7) / (labelSize * 0.55)));
      const label = p.row.text.length > maxChars
        ? p.row.text.slice(0, maxChars - 1) + "…"
        : p.row.text;
      return `
        <g class="kk-bubble-g" style="animation-delay:${i * 70}ms; transform-origin:${p.cx}px ${p.cy}px;">
          <circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="${p.color}" filter="url(#kkBubbleShadow)" opacity="0.92"/>
          <circle cx="${p.cx}" cy="${p.cy - p.r * 0.35}" r="${p.r * 0.78}" fill="url(#kkBubbleSheen)" opacity="0.55"/>
          <text x="${p.cx}" y="${p.cy - countSize * 0.3}" text-anchor="middle" dominant-baseline="middle"
                font-family="'Clash Display', system-ui, sans-serif" font-weight="900"
                font-size="${countSize}" fill="rgba(15,23,42,.95)">${p.row.n}</text>
          <text x="${p.cx}" y="${p.cy + countSize * 0.55}" text-anchor="middle" dominant-baseline="middle"
                font-family="'Clash Display', system-ui, sans-serif" font-weight="700"
                font-size="${labelSize}" fill="rgba(15,23,42,.75)">${escapeHtml(label)}</text>
        </g>`;
    }).join("");

    specialEl.innerHTML = `
      <div class="kk-extra kk-bubble-field">
        <svg viewBox="0 0 ${VBW} ${VBH}" preserveAspectRatio="xMidYMid meet" class="kk-bubble-svg">
          <defs>
            <radialGradient id="kkBubbleSheen" cx="50%" cy="35%" r="55%">
              <stop offset="0%"  stop-color="#ffffff" stop-opacity="0.85"/>
              <stop offset="60%" stop-color="#ffffff" stop-opacity="0.10"/>
              <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
            </radialGradient>
            <filter id="kkBubbleShadow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur in="SourceAlpha" stdDeviation="6"/>
              <feOffset dx="0" dy="6" result="off"/>
              <feComponentTransfer><feFuncA type="linear" slope="0.35"/></feComponentTransfer>
              <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          ${circles}
        </svg>
      </div>`;
  };

  // ───────── treemap ─────────
  // Squarified treemap. Bigger choices get bigger rectangles. We use a
  // simple recursive split that alternates horizontal/vertical based on
  // which dimension is currently longer (a decent approximation of the
  // proper squarified algorithm without the complexity).
  RENDERERS.treemap = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total) return emptyState(specialEl, "Waiting for responses…");

    rows.sort((a, b) => b.n - a.n);
    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316", "#06b6d4", "#8b5cf6"];

    // Recursive split. `box` = {x, y, w, h}, `items` = sorted desc.
    function layout(items, box, acc) {
      if (!items.length) return;
      if (items.length === 1) {
        acc.push({ ...box, item: items[0] });
        return;
      }
      const sumN = items.reduce((a, r) => a + r.n, 0);
      // Place items into the first group until they cover ~half the total,
      // recurse on each half with the matching slice of the box.
      let cumul = 0, splitAt = 0;
      for (let i = 0; i < items.length - 1; i++) {
        cumul += items[i].n;
        if (cumul >= sumN / 2) { splitAt = i + 1; break; }
      }
      if (splitAt === 0) splitAt = 1;

      const firstSum = items.slice(0, splitAt).reduce((a, r) => a + r.n, 0);
      const ratio = firstSum / sumN;

      if (box.w >= box.h) {
        const w1 = box.w * ratio;
        layout(items.slice(0, splitAt), { x: box.x, y: box.y, w: w1, h: box.h }, acc);
        layout(items.slice(splitAt),    { x: box.x + w1, y: box.y, w: box.w - w1, h: box.h }, acc);
      } else {
        const h1 = box.h * ratio;
        layout(items.slice(0, splitAt), { x: box.x, y: box.y, w: box.w, h: h1 }, acc);
        layout(items.slice(splitAt),    { x: box.x, y: box.y + h1, w: box.w, h: box.h - h1 }, acc);
      }
    }

    const tiles = [];
    layout(rows, { x: 0, y: 0, w: 100, h: 100 }, tiles);

    const cells = tiles.map((t, i) => {
      const color = palette[rows.indexOf(t.item) % palette.length];
      const pct = Math.round((t.item.n / total) * 100);
      // Hide label text when the tile is too small to read it.
      const small = t.w < 12 || t.h < 9;
      return `
        <div class="kk-tree-tile" style="
          left:${t.x}%; top:${t.y}%; width:${t.w}%; height:${t.h}%;
          --c:${color}; --d:${i * 50}ms;
        " title="${escapeHtml(t.item.text)} — ${t.item.n} (${pct}%)">
          ${small ? "" : `
            <div class="kk-tree-label">${escapeHtml(t.item.text)}</div>
            <div class="kk-tree-n">${t.item.n}<small>${pct}%</small></div>`}
        </div>`;
    }).join("");

    specialEl.innerHTML = `<div class="kk-extra kk-tree">${cells}</div>`;
  };

  // ───────── progress_bars ─────────
  // Vertical stack of full-width horizontal bars, sorted descending.
  // Reads great on a tall screen with many choices.
  RENDERERS.progress_bars = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total) return emptyState(specialEl, "Waiting for responses…");

    rows.sort((a, b) => b.n - a.n);
    const top = rows[0].n || 1;
    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316", "#06b6d4"];

    const bars = rows.map((r, i) => `
      <div class="kk-prog-row" style="--c:${palette[i % palette.length]}; --d:${i * 70}ms">
        <div class="kk-prog-head">
          <span class="kk-prog-lbl">${escapeHtml(r.text)}</span>
          <span class="kk-prog-n">${r.n}<small>${Math.round((r.n / total) * 100)}%</small></span>
        </div>
        <div class="kk-prog-track">
          <div class="kk-prog-fill" style="--w:${(r.n / top) * 100}%"></div>
        </div>
      </div>`).join("");

    specialEl.innerHTML = `<div class="kk-extra kk-prog">${bars}</div>`;
  };

  // ───────── leaderboard ─────────
  // Like ranked_bar but with podium emphasis on the top three and an arrow
  // for movement. We don't track previous positions client-side, so the
  // "trend" badge just shows position.
  RENDERERS.leaderboard = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total) return emptyState(specialEl, "Waiting for the first vote…");

    rows.sort((a, b) => b.n - a.n);
    const top = rows[0].n || 1;
    const trophies = ["🥇", "🥈", "🥉"];

    const items = rows.map((r, i) => `
      <li class="kk-lbd-row ${i < 3 ? "is-top" : ""}" style="--w:${(r.n / top) * 100}%; --d:${i * 80}ms">
        <span class="kk-lbd-pos">
          ${i < 3 ? `<span class="kk-lbd-trophy">${trophies[i]}</span>` : `<span class="kk-lbd-num">${i + 1}</span>`}
        </span>
        <div class="kk-lbd-body">
          <div class="kk-lbd-name">${escapeHtml(r.text)}</div>
          <div class="kk-lbd-bar"><span></span></div>
        </div>
        <div class="kk-lbd-score">${r.n}</div>
      </li>`).join("");

    specialEl.innerHTML = `<div class="kk-extra kk-lbd"><ol class="kk-lbd-list">${items}</ol></div>`;
  };

  // ───────── tags ─────────
  // Like a word cloud but rendered as flat pill-shaped tags. Best for
  // many small text answers where rotated giant words would overflow.
  RENDERERS.tags = function (ctx) {
    const { tallyData, specialEl } = ctx;
    const words = collectWords(tallyData);
    if (!words.length) return emptyState(specialEl, "Waiting for responses…");

    const top = words[0].n;
    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316", "#06b6d4"];
    const pills = words.slice(0, 80).map((w, i) => {
      const scale = 0.85 + (w.n / top) * 0.9; // 0.85 → 1.75
      const color = palette[i % palette.length];
      return `<span class="kk-tag" style="--c:${color}; font-size:${scale}rem; animation-delay:${i * 25}ms">
        ${escapeHtml(w.word)}<span class="kk-tag-n">${w.n}</span>
      </span>`;
    }).join("");

    specialEl.innerHTML = `<div class="kk-extra kk-tags">${pills}</div>`;
  };

  // ───────── open_list ─────────
  // Alias for responses_list — sometimes used for `open` questions in the
  // picker. Renders identically but exposed under both IDs.
  RENDERERS.open_list = RENDERERS.responses_list;

  // ───────── area / smooth_area ─────────
  // Filled area chart for numeric distributions. Same data shape as
  // `distribution` but rendered as a filled band rather than a bell curve.
  RENDERERS.area = function (ctx) {
    return renderAreaChart(ctx, false);
  };
  RENDERERS.smooth_area = function (ctx) {
    return renderAreaChart(ctx, true);
  };

  function renderAreaChart(ctx, smooth) {
    const { question, tallyData, specialEl } = ctx;
    const { vals, min, max } = collectNumeric(question, tallyData);
    if (!vals.length) return emptyState(specialEl, "Waiting for responses…");

    const bins = 16;
    const buckets = new Array(bins).fill(0);
    const range = Math.max(1e-9, max - min);
    vals.forEach(v => {
      let i = Math.floor(((v - min) / range) * bins);
      if (i >= bins) i = bins - 1;
      if (i < 0) i = 0;
      buckets[i]++;
    });

    let data = buckets.slice();
    if (smooth) {
      // 3-point moving average.
      data = buckets.map((_, i) => {
        const a = buckets[i - 1] || 0;
        const b = buckets[i];
        const c = buckets[i + 1] || 0;
        return (a + 2 * b + c) / 4;
      });
    }
    const top = Math.max(1, ...data);
    const W = 100, H = 60;
    const pts = data.map((b, i) => {
      const x = (i / (bins - 1)) * W;
      const y = H - (b / top) * (H * 0.85);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const path = smooth
      ? `M 0,${H} L ${pts.join(" L ")} L ${W},${H} Z`
      : `M 0,${H} L ${pts.join(" L ")} L ${W},${H} Z`;
    // Note: native SVG quadratic smoothing would need explicit control
    // points; the moving-average approximation above is visually fine.

    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;

    specialEl.innerHTML = `
      <div class="kk-extra kk-dist">
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" class="kk-dist-svg">
          <defs>
            <linearGradient id="kkAreaGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stop-color="#22d3ee" stop-opacity=".75"/>
              <stop offset="1" stop-color="#7c3aed" stop-opacity=".15"/>
            </linearGradient>
          </defs>
          <path d="${path}" fill="url(#kkAreaGrad)" stroke="#22d3ee" stroke-width=".7"/>
        </svg>
        <div class="kk-dist-stats">
          <div><span>avg</span><strong>${avg.toFixed(avg % 1 === 0 ? 0 : 1)}</strong></div>
          <div><span>min</span><strong>${Math.min(...vals)}</strong></div>
          <div><span>max</span><strong>${Math.max(...vals)}</strong></div>
          <div><span>n</span><strong>${vals.length}</strong></div>
        </div>
      </div>`;
  }

  // ───────── polar ─────────
  // Pie-like but each slice has a different radius based on count. Best for
  // small numbers of choices (≤8).
  RENDERERS.polar = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total) return emptyState(specialEl, "Waiting for responses…");

    const top = Math.max(1, ...rows.map(r => r.n));
    const palette = ["#22d3ee", "#7c3aed", "#fb7185", "#fbbf24", "#a3e635", "#f97316", "#06b6d4", "#8b5cf6"];

    const cx = 100, cy = 100, rMax = 88;
    const n = rows.length || 1;
    const sweep = (Math.PI * 2) / n;

    const slices = rows.map((r, i) => {
      const radius = rMax * Math.sqrt(r.n / top);
      const a0 = -Math.PI / 2 + i * sweep;
      const a1 = a0 + sweep;
      const x0 = cx + Math.cos(a0) * radius;
      const y0 = cy + Math.sin(a0) * radius;
      const x1 = cx + Math.cos(a1) * radius;
      const y1 = cy + Math.sin(a1) * radius;
      const large = sweep > Math.PI ? 1 : 0;
      const path = `M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(2)} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`;
      // Label position halfway along arc, slightly outside radius.
      const aMid = a0 + sweep / 2;
      const lx = cx + Math.cos(aMid) * (radius + 18);
      const ly = cy + Math.sin(aMid) * (radius + 18);
      const color = palette[i % palette.length];
      return {
        path, color, label: r.text, count: r.n, lx, ly, delay: i * 80,
      };
    });

    const paths = slices.map(s => `
      <path d="${s.path}" fill="${s.color}" fill-opacity="0.78"
            stroke="rgba(255,255,255,.18)" stroke-width="0.8"
            style="animation: kkPolarIn .5s cubic-bezier(.4,0,.2,1) both; animation-delay:${s.delay}ms;
                   transform-origin:${cx}px ${cy}px;"/>`).join("");

    const labels = slices.map(s => `
      <text x="${s.lx.toFixed(1)}" y="${s.ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
            font-family="'Clash Display', system-ui, sans-serif" font-weight="700"
            font-size="9" fill="#f8fafc">${escapeHtml(s.label.slice(0, 16))}
        <tspan x="${s.lx.toFixed(1)}" dy="11" font-size="8" fill="rgba(248,250,252,.65)">${s.count}</tspan>
      </text>`).join("");

    // Background guide rings.
    const rings = [0.25, 0.5, 0.75, 1].map(r =>
      `<circle cx="${cx}" cy="${cy}" r="${rMax * r}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="0.5"/>`
    ).join("");

    specialEl.innerHTML = `
      <div class="kk-extra kk-polar">
        <svg viewBox="-10 -10 220 220" class="kk-polar-svg" preserveAspectRatio="xMidYMid meet">
          ${rings}
          ${paths}
          ${labels}
        </svg>
      </div>`;
  };

  // ───────── radar ─────────
  // Polygon connecting one vertex per choice. Best for ≤8 choices on a
  // shared scale.
  RENDERERS.radar = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const { rows, total } = aggregateChoices(question, tallyData);
    if (!total) return emptyState(specialEl, "Waiting for responses…");

    const top = Math.max(1, ...rows.map(r => r.n));
    const n = rows.length;
    const cx = 100, cy = 100, rMax = 80;

    const points = rows.map((r, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const radius = rMax * (r.n / top);
      return { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, label: r.text, n: r.n, a };
    });

    const guides = [0.25, 0.5, 0.75, 1].map(r => {
      const pts = Array.from({ length: n }, (_, i) => {
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        return `${(cx + Math.cos(a) * rMax * r).toFixed(2)},${(cy + Math.sin(a) * rMax * r).toFixed(2)}`;
      }).join(" ");
      return `<polygon points="${pts}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="0.5"/>`;
    }).join("");

    const spokes = Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return `<line x1="${cx}" y1="${cy}" x2="${cx + Math.cos(a) * rMax}" y2="${cy + Math.sin(a) * rMax}"
                    stroke="rgba(255,255,255,.05)" stroke-width="0.4"/>`;
    }).join("");

    const polygon = points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
    const labels = points.map(p => {
      const lx = cx + Math.cos(p.a) * (rMax + 14);
      const ly = cy + Math.sin(p.a) * (rMax + 14);
      return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle"
                font-family="'Clash Display', system-ui, sans-serif" font-weight="700"
                font-size="9" fill="#f8fafc">${escapeHtml(p.label.slice(0, 14))}
                <tspan x="${lx.toFixed(1)}" dy="10" font-size="8" fill="rgba(248,250,252,.6)">${p.n}</tspan>
              </text>`;
    }).join("");

    const dots = points.map(p =>
      `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="2.6" fill="#22d3ee"/>`
    ).join("");

    specialEl.innerHTML = `
      <div class="kk-extra kk-polar">
        <svg viewBox="-20 -20 240 240" class="kk-polar-svg" preserveAspectRatio="xMidYMid meet">
          ${guides}${spokes}
          <polygon points="${polygon}"
                   fill="rgba(124,58,237,.32)"
                   stroke="#22d3ee"
                   stroke-width="1.2"
                   style="animation: kkPolarIn .5s cubic-bezier(.4,0,.2,1) both; transform-origin:${cx}px ${cy}px;"/>
          ${dots}
          ${labels}
        </svg>
      </div>`;
  };

  // ───────── map ─────────
  // We don't have a vector world atlas embedded, so the "map" chart falls
  // back to a heatmap-style display when there are points (lat/lng pins).
  // For pure choice-based "map" questions there's nothing to draw — show
  // the choices as a leaderboard with a hint.
  RENDERERS.map = function (ctx) {
    const { question, tallyData, specialEl } = ctx;
    const qtype = (question && question.type) || "";
    if (qtype === "pin_map" || qtype === "pin_image") {
      return RENDERERS.heatmap(ctx);
    }
    return RENDERERS.leaderboard(ctx);
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

    /* ── flow (vote ribbons) ── */
    .kk-flow {
      display: flex;
      align-items: stretch;
      justify-content: center;
      width: 100%;
      height: 100%;
    }
    .kk-flow-svg {
      width: 100%;
      height: 100%;
      max-height: 100%;
      display: block;
    }
    @keyframes kkFlowIn {
      to { stroke-dashoffset: 0; }
    }

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

    /* ── bubble (SVG-based packing) ── */
    .kk-bubble-field {
      position: relative;
      width: 100%;
      height: 100%;
      min-height: 380px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .kk-bubble-svg {
      width: 100%;
      height: 100%;
      max-height: 100%;
      display: block;
      overflow: visible;
    }
    .kk-bubble-g {
      animation: kkBubblePop .55s cubic-bezier(.34, 1.56, .64, 1) both,
                 kkBubbleDrift 6s ease-in-out infinite alternate;
      transform-box: fill-box;
    }
    @keyframes kkBubblePop {
      from { opacity: 0; transform: scale(.2); }
      to   { opacity: 1; transform: scale(1); }
    }
    @keyframes kkBubbleDrift {
      0%   { transform: scale(1) translateY(0); }
      100% { transform: scale(1.02) translateY(-6px); }
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
    .kk-hist-grid { display: flex; align-items: flex-end; gap: 6px; height: 100%; padding-bottom: 2.6rem; padding-top: 1.5rem; }
    .kk-hist-bar { flex: 1; position: relative; display: flex; flex-direction: column; justify-content: flex-end; min-width: 0; min-height: 6px; }
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

    /* ── column (vertical column chart) ── */
    .kk-col-chart { height: 100%; }
    .kk-col-grid { display: flex; align-items: flex-end; justify-content: space-around; gap: .75rem; height: 100%; padding: 1.5rem 1rem 3rem; }
    .kk-col-col { flex: 1; max-width: 140px; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: .35rem; height: 100%; }
    .kk-col-fill {
      flex: 1 1 auto;
      width: 100%;
      display: flex; align-items: flex-start; justify-content: center;
      padding-top: .4rem;
      background: linear-gradient(180deg, var(--c, #22d3ee), color-mix(in srgb, var(--c, #22d3ee) 35%, #0f172a));
      border-radius: 12px 12px 0 0;
      box-shadow: 0 -6px 22px color-mix(in srgb, var(--c, #22d3ee) 35%, transparent);
      max-height: var(--h, 50%);
      min-height: 18px;
      transition: max-height .5s cubic-bezier(.4,0,.2,1);
      animation: kkColRise .55s cubic-bezier(.4,0,.2,1) both;
      animation-delay: var(--d, 0ms);
    }
    @keyframes kkColRise { from { max-height: 0; } to { max-height: var(--h, 50%); } }
    .kk-col-n {
      font-family: 'Clash Display', system-ui, sans-serif;
      font-weight: 900; font-size: 1.4rem; color: #fff;
      text-shadow: 0 2px 8px rgba(0,0,0,.5);
    }
    .kk-col-lbl {
      font-size: .85rem;
      max-width: 100%;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      opacity: .85;
    }
    .kk-col-pct {
      font-size: .75rem; opacity: .55;
      font-family: 'Clash Display', system-ui, sans-serif; font-weight: 800;
    }
    /* Rounded variant: pill-style bars */
    .kk-col-rounded .kk-col-fill { border-radius: 999px 999px 18px 18px; }
    /* Gradient variant: layered multi-stop gradient */
    .kk-col-gradient .kk-col-fill {
      background: linear-gradient(180deg,
        color-mix(in srgb, var(--c, #22d3ee) 95%, #fff 5%) 0%,
        var(--c, #22d3ee) 35%,
        color-mix(in srgb, var(--c, #22d3ee) 55%, #7c3aed 45%) 75%,
        color-mix(in srgb, var(--c, #22d3ee) 25%, #0f172a 75%) 100%);
    }

    /* ── lollipop ── */
    .kk-pop { height: 100%; }
    .kk-pop-grid { display: flex; align-items: flex-end; justify-content: space-around; gap: 1rem; height: 100%; padding: 2rem 1rem 3rem; }
    .kk-pop-col {
      flex: 1; max-width: 100px; min-width: 0;
      display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
      position: relative;
      animation: kkColRise .55s cubic-bezier(.4,0,.2,1) both;
      animation-delay: var(--d, 0ms);
    }
    .kk-pop-n {
      font-family: 'Clash Display', system-ui, sans-serif;
      font-weight: 900; font-size: 1.1rem; color: #f8fafc;
      margin-bottom: .25rem;
    }
    .kk-pop-dot {
      width: 28px; height: 28px; border-radius: 50%;
      background: radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--c, #22d3ee) 80%, #fff), var(--c, #22d3ee));
      box-shadow: 0 0 18px color-mix(in srgb, var(--c, #22d3ee) 55%, transparent);
      z-index: 2;
    }
    .kk-pop-stick {
      width: 3px;
      height: var(--h, 50%);
      background: linear-gradient(180deg, var(--c, #22d3ee), color-mix(in srgb, var(--c, #22d3ee) 30%, #0f172a));
      border-radius: 999px;
      margin-top: -2px;
      transition: height .5s cubic-bezier(.4,0,.2,1);
      min-height: 6px;
    }
    .kk-pop-lbl {
      position: absolute; bottom: -2rem; left: 50%; transform: translateX(-50%);
      font-size: .85rem; opacity: .8;
      white-space: nowrap; max-width: 110%;
      overflow: hidden; text-overflow: ellipsis;
    }

    /* ── treemap ── */
    .kk-tree { position: relative; width: 100%; height: 100%; min-height: 380px; border-radius: 16px; overflow: hidden; }
    .kk-tree-tile {
      position: absolute;
      background: linear-gradient(135deg, var(--c, #22d3ee), color-mix(in srgb, var(--c, #22d3ee) 60%, #0f172a));
      box-shadow: inset 0 0 0 2px rgba(255,255,255,.06), inset 0 -16px 30px rgba(0,0,0,.18);
      display: flex; flex-direction: column; justify-content: flex-end;
      padding: .5rem .65rem;
      animation: kkTreeIn .55s cubic-bezier(.4,0,.2,1) both;
      animation-delay: var(--d, 0ms);
      overflow: hidden;
      transition: opacity .25s;
    }
    .kk-tree-tile:hover { filter: brightness(1.08); }
    @keyframes kkTreeIn { from { opacity: 0; transform: scale(.94); } }
    .kk-tree-label {
      font-weight: 800; font-size: .9rem;
      color: rgba(15, 23, 42, .9);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      margin-bottom: .15rem;
    }
    .kk-tree-n {
      font-family: 'Clash Display', system-ui, sans-serif;
      font-weight: 900; font-size: 1.4rem;
      color: rgba(15, 23, 42, .95);
      line-height: 1;
    }
    .kk-tree-n small { display: inline-block; margin-left: .35rem; font-size: .65rem; opacity: .65; font-weight: 700; }

    /* ── progress_bars ── */
    .kk-prog { display: flex; flex-direction: column; gap: .85rem; padding: .5rem 0; height: 100%; overflow-y: auto; }
    .kk-prog-row {
      animation: kkRankIn .45s cubic-bezier(.4,0,.2,1) both;
      animation-delay: var(--d, 0ms);
    }
    .kk-prog-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: .35rem; }
    .kk-prog-lbl { font-weight: 700; font-size: 1rem; }
    .kk-prog-n {
      font-family: 'Clash Display', system-ui, sans-serif; font-weight: 900; font-size: 1.05rem;
    }
    .kk-prog-n small { display: inline-block; margin-left: .4rem; font-size: .75rem; opacity: .65; font-weight: 700; }
    .kk-prog-track {
      height: 18px;
      background: rgba(255,255,255,.06);
      border-radius: 999px;
      overflow: hidden;
      position: relative;
    }
    .kk-prog-fill {
      height: 100%;
      width: var(--w, 0%);
      background: linear-gradient(90deg, var(--c, #22d3ee), color-mix(in srgb, var(--c, #22d3ee) 55%, #7c3aed));
      border-radius: inherit;
      transition: width .6s cubic-bezier(.4,0,.2,1);
      box-shadow: 0 0 18px color-mix(in srgb, var(--c, #22d3ee) 35%, transparent);
      animation: kkRankFill .8s cubic-bezier(.4,0,.2,1) both;
      animation-delay: calc(var(--d, 0ms) + 120ms);
    }

    /* ── leaderboard ── */
    .kk-lbd { height: 100%; overflow-y: auto; }
    .kk-lbd-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .5rem; }
    .kk-lbd-row {
      display: grid;
      grid-template-columns: 64px 1fr auto;
      gap: 1rem; align-items: center;
      padding: .75rem .9rem;
      border-radius: 14px;
      background: rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.06);
      animation: kkRankIn .45s cubic-bezier(.4,0,.2,1) both;
      animation-delay: var(--d, 0ms);
    }
    .kk-lbd-row.is-top {
      background: linear-gradient(135deg, rgba(251, 191, 36, .15), rgba(124, 58, 237, .08));
      border-color: rgba(251, 191, 36, .35);
    }
    .kk-lbd-pos { display: grid; place-items: center; }
    .kk-lbd-trophy { font-size: 2rem; line-height: 1; }
    .kk-lbd-num {
      width: 40px; height: 40px; border-radius: 50%;
      display: grid; place-items: center;
      background: rgba(255,255,255,.08);
      font-family: 'Clash Display', system-ui, sans-serif;
      font-weight: 900; font-size: 1.1rem;
    }
    .kk-lbd-body { min-width: 0; }
    .kk-lbd-name {
      font-weight: 700; font-size: 1.05rem; margin-bottom: .25rem;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .kk-lbd-bar {
      height: 6px; background: rgba(255,255,255,.06); border-radius: 999px; overflow: hidden;
    }
    .kk-lbd-bar span {
      display: block; height: 100%;
      width: var(--w, 0%);
      background: linear-gradient(90deg, #22d3ee, #7c3aed);
      border-radius: inherit;
      transition: width .6s cubic-bezier(.4,0,.2,1);
    }
    .kk-lbd-score {
      font-family: 'Clash Display', system-ui, sans-serif;
      font-weight: 900; font-size: 1.6rem;
      background: linear-gradient(135deg, #22d3ee, #7c3aed);
      -webkit-background-clip: text; background-clip: text; color: transparent;
      min-width: 60px; text-align: right;
    }

    /* ── tags ── */
    .kk-tags {
      display: flex; flex-wrap: wrap; gap: .5rem;
      align-content: flex-start; justify-content: center;
      padding: clamp(1rem, 3vw, 2rem);
      max-height: 100%; overflow-y: auto;
    }
    .kk-tag {
      display: inline-flex; align-items: baseline; gap: .35rem;
      padding: .3em .8em;
      border-radius: 999px;
      background: color-mix(in srgb, var(--c, #22d3ee) 18%, transparent);
      border: 1px solid color-mix(in srgb, var(--c, #22d3ee) 50%, transparent);
      color: #f8fafc;
      font-weight: 700;
      animation: kkRankIn .4s cubic-bezier(.4,0,.2,1) both;
    }
    .kk-tag-n { opacity: .55; font-size: .75em; font-weight: 600; }

    /* ── polar / radar ── */
    .kk-polar { display: grid; place-items: center; height: 100%; }
    .kk-polar-svg { width: min(96%, 720px); height: auto; max-height: 100%; }
    @keyframes kkPolarIn { from { transform: scale(0); opacity: 0; } to { transform: scale(1); opacity: 1; } }

    /* ── heatmap empty/waiting state ── */
    .kk-heat-empty-cell {
      position: absolute;
      border: 1px dashed rgba(255,255,255,.08);
      pointer-events: none;
    }
    .kk-heat-waiting-msg {
      position: absolute; inset: 0;
      display: grid; place-items: center; align-content: center;
      gap: .65rem;
      text-align: center;
      pointer-events: none;
      color: rgba(248,250,252,.7);
    }
    .kk-heat-waiting-emoji { font-size: 3rem; opacity: .55; }
  `;
})();