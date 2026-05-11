/* Presenter client. Connects to the session WebSocket as role="presenter",
 * reacts to state / tally / leaderboard messages, and lets the presenter
 * advance, draw, toggle group/fullscreen, and end the session.
 *
 * Fixes:
 * - Chart does not disappear after browser refresh.
 * - Uses server tally from state when available.
 * - Creates zero-count bars for all choices when no tally exists yet.
 * - Keeps #view-question as flex so Chart.js has correct height.
 * - Forces Chart.js resize after the hidden view becomes visible.
 */

(function () {
  const stage = document.getElementById("stage");
  if (!stage) return;

  const code = stage.dataset.code;
  const kind = stage.dataset.kind;

  window.kkChartBackground = (stage.dataset.chartBg || "normal").toLowerCase();

  const views = {
    lobby: document.getElementById("view-lobby"),
    question: document.getElementById("view-question"),
    group: document.getElementById("view-group"),
    ended: document.getElementById("view-ended"),
  };

  const qText = document.getElementById("q-text");
  const qProgress = document.getElementById("q-progress");
  const liveCanvas = document.getElementById("live-chart");
  const specialEl = document.getElementById("special-display");
  const drawCanvas = document.getElementById("draw-canvas");
  const laserCanvas = document.getElementById("laser-canvas");
  const groupGrid = document.getElementById("group-grid");
  const lobbyChips = document.getElementById("participant-chips");
  const participantCount = document.getElementById("participant-count");
  const leaderboardEl = document.getElementById("leaderboard");

  const btnStart = document.getElementById("btn-start");
  const btnNext = document.getElementById("btn-next");
  const btnPrev = document.getElementById("btn-prev");
  const btnEnd = document.getElementById("btn-end");
  const btnFs = document.getElementById("btn-fs");
  const btnGroup = document.getElementById("btn-group");
  const clearDrawBtn = document.getElementById("clear-draw");

  const AVATARS_BY_ID = window.kkAvatarsById || {};
  const chartHolder = { chart: null };

  let currentState = null;
    let latestTally = null;
    let latestTallyByQuestion = {};
    let ws = null;
    let draw = null;

  function show(name) {
    Object.entries(views).forEach(([key, el]) => {
      if (!el) return;

      if (key !== name) {
        el.style.display = "none";
        return;
      }

      if (key === "question") {
        el.style.display = "flex";
        el.style.flexDirection = "column";
        el.style.minHeight = "0";
        el.style.height = "100%";
      } else {
        el.style.display = "block";
      }
    });

    resizeChartSoon();
  }

  function resizeChartSoon() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (chartHolder.chart) {
        try {
          chartHolder.chart.resize();
          chartHolder.chart.update("none");
        } catch (e) {
          // ignore resize errors
        }
      }

      /*
       * Important:
       * The draw/laser canvases are created while #view-question is hidden.
       * When the question becomes visible, we must resize them.
       */
      if (draw && typeof draw.resize === "function") {
        try {
          draw.resize();
        } catch (e) {
          // ignore overlay resize errors
        }
      }
    });
  });
}

  function safeJsonParse(raw) {
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error("[present] Invalid websocket JSON:", raw);
      return null;
    }
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  // ─────────────────────── WebSocket ───────────────────────

  function connectSocket() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws/session/${code}/`);

    ws.addEventListener("open", () => {
      send({
        type: "hello",
        role: "presenter",
        uid: "presenter-" + Math.random().toString(36).slice(2),
      });
    });

    ws.addEventListener("message", (event) => {
      const msg = safeJsonParse(event.data);
      if (!msg) return;

      switch (msg.type) {
        case "state":
          onState(msg);
          break;

        case "tally":
          onTally(msg);
          break;

        case "leaderboard":
          onLeaderboard(msg);
          break;

        case "ended":
          show("ended");
          break;

        case "draw":
          // handled by draw_overlay if your app broadcasts it elsewhere
          break;

        default:
          break;
      }
    });

    ws.addEventListener("close", () => {
      // Presenter reconnect: useful if network drops.
      setTimeout(() => {
        if (!ws || ws.readyState === WebSocket.CLOSED) {
          connectSocket();
        }
      }, 1500);
    });
  }

  connectSocket();

  // ─────────────────────── Typography helpers ───────────────────────

  const FONT_STACK = {
    default: "Inter, system-ui, sans-serif",
    clash: "'Clash Display', system-ui, sans-serif",
    space: "'Space Grotesk', system-ui, sans-serif",
    serif: "'Playfair Display', Georgia, serif",
    mono: "'JetBrains Mono', ui-monospace, monospace",
    comic: "'Comic Neue', 'Comic Sans MS', cursive",
    press: "'Press Start 2P', system-ui, monospace",
  };

  function applyQuestionTypography(q) {
    if (!qText || !q) return;

    const fam = (q.font_family && FONT_STACK[q.font_family]) || FONT_STACK.default;
    const size = q.font_size ? Math.min(96, Math.max(16, Number(q.font_size))) : null;
    const bold = q.font_bold !== false;

    qText.style.fontFamily = fam;

    if (size) {
      qText.style.fontSize = `${size * 1.4}px`;
    } else {
      qText.style.fontSize = "";
    }

    qText.style.fontWeight = bold ? "800" : "500";
    qText.style.lineHeight = q.font_family === "press" ? "1.35" : "1.05";
  }

  // ─────────────────────── Tally helpers ───────────────────────

  function normalizeChoiceId(value) {
    return String(value);
  }

  function normalizeTallyForQuestion(q, tally) {
    const source = tally || {};
    const sourceCounts = source.counts || {};
    const fixedCounts = {};

    const choices = Array.isArray(q && q.choices) ? q.choices : [];

    choices.forEach((choice) => {
      const id = normalizeChoiceId(choice.id);
      const direct = sourceCounts[id];
      const numeric = sourceCounts[choice.id];

      fixedCounts[id] = Number(direct ?? numeric ?? 0);
    });

    return {
      ...source,
      counts: fixedCounts,
      texts: Array.isArray(source.texts) ? source.texts : [],
    };
  }

  function getStateTallyForCurrentQuestion(s) {
    if (!s || !s.question) {
      return { counts: {}, texts: [] };
    }

    const qid = normalizeChoiceId(s.question.id);

    if (s.tally) {
      latestTallyByQuestion[qid] = s.tally;
      latestTally = s.tally;
      return normalizeTallyForQuestion(s.question, s.tally);
    }

    if (latestTallyByQuestion[qid]) {
      return normalizeTallyForQuestion(s.question, latestTallyByQuestion[qid]);
    }

    return normalizeTallyForQuestion(s.question, null);
  }

  // ─────────────────────── State handling ───────────────────────

  function onState(s) {
    currentState = s;

    if (participantCount) {
      participantCount.textContent = Number(s.participants || 0);
    }

    renderLobbyParticipants(Number(s.participants || 0));

    if (s.state === "lobby") {
      show("lobby");
      return;
    }

    if (s.state === "ended") {
      show("ended");
      return;
    }

    if (!s.question) {
      show("lobby");
      return;
    }

    show("question");
    renderCurrentQuestion(s);
  }

  function renderLobbyParticipants(count) {
    if (!lobbyChips) return;

    while (lobbyChips.children.length < count) {
      const chip = document.createElement("span");
      chip.className = "kk-lobby-chip";
      chip.textContent = "👤 guest";
      lobbyChips.appendChild(chip);
    }

    while (lobbyChips.children.length > count) {
      lobbyChips.removeChild(lobbyChips.lastChild);
    }
  }

  function renderCurrentQuestion(s) {
    if (!s || !s.question) return;

    const q = s.question;

    if (qText) {
      qText.textContent = q.text || "—";
    }

    if (qProgress) {
      qProgress.textContent = `Question ${(Number(s.index) || 0) + 1} / ${Number(s.total) || 1}`;
    }

    applyQuestionTypography(q);

    const labels = Array.isArray(q.choices) ? q.choices : [];
    const chartId = q.chart_type || "bar";
    const questionType = q.type || "mcq";
    const tallyData = getStateTallyForCurrentQuestion(s);

    renderLiveChart(chartId, questionType, labels, tallyData);
  }

  function onTally(msg) {
    if (!currentState || !currentState.question) return;

    const currentQuestionId = normalizeChoiceId(currentState.question.id);
    const incomingQuestionId = normalizeChoiceId(msg.question_id);

    if (incomingQuestionId !== currentQuestionId) return;

    const q = currentState.question;
    const tallyData = normalizeTallyForQuestion(q, msg.data);

    latestTally = tallyData;
    latestTallyByQuestion[currentQuestionId] = tallyData;
    currentState.tally = tallyData;

    renderLiveChart(q.chart_type || "bar", q.type || "mcq", q.choices || [], tallyData);
  }

  function renderLiveChart(chartId, questionType, labels, tallyData) {
    if (!liveCanvas || !specialEl) return;

    if (typeof window.kkRenderLive !== "function") {
      console.error("[present] window.kkRenderLive is missing. Check chart_preview.js is loaded before present.js.");
      return;
    }

    window.kkRenderLive(
      liveCanvas,
      specialEl,
      chartId,
      questionType,
      labels,
      tallyData || { counts: {}, texts: [] },
      chartHolder
    );

    resizeChartSoon();
  }

  // ─────────────────────── Leaderboard ───────────────────────

  function onLeaderboard(msg) {
    if (!leaderboardEl) return;

    leaderboardEl.innerHTML = "";

    const rows = (msg.data && Array.isArray(msg.data.rows)) ? msg.data.rows : [];
    window.kkLeaderboardRows = rows;

    rows.slice(0, 10).forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "kk-lb-row" + (i === 0 ? " is-leader" : "");

      const rankCls = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
      const meta = AVATARS_BY_ID[r.avatar_id] || {
        emoji: avatarEmoji(r.avatar_id),
        anim: "kk-float",
      };
      const animCls = "kk-anim-" + (meta.anim || "kk-float");

      row.innerHTML = `
        <span class="kk-lb-rank ${rankCls}">${i + 1}</span>
        <span class="kk-avatar-bubble kk-avatar-bubble--sm ${animCls}" aria-hidden="true">${meta.emoji}</span>
        <span class="kk-lb-name">${escapeHtml(r.name)}</span>
        <span class="kk-lb-score">${Number(r.score || 0)}</span>
      `;

      leaderboardEl.appendChild(row);
    });

    if (chartHolder.chart) {
      try {
        chartHolder.chart.update("none");
      } catch (e) {
        // ignore
      }
    }
  }

  function avatarEmoji(id) {
    const meta = AVATARS_BY_ID[id];

    if (meta && meta.emoji) {
      return meta.emoji;
    }

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

    return map[id] || "👤";
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"]/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
    }[char]));
  }

  // ─────────────────────── Controls ───────────────────────

  if (btnStart) {
    btnStart.addEventListener("click", () => send({ type: "advance" }));
  }

  if (btnNext) {
    btnNext.addEventListener("click", () => send({ type: "advance" }));
  }

  if (btnPrev) {
    btnPrev.addEventListener("click", () => send({ type: "back" }));
  }

  if (btnEnd) {
    btnEnd.addEventListener("click", () => {
      if (confirm("End this session?")) {
        send({ type: "end" });
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    const activeTag = document.activeElement ? document.activeElement.tagName : "";

    if (["INPUT", "TEXTAREA", "SELECT"].includes(activeTag)) return;

    if (event.key === "ArrowRight" || event.key === " " || event.key === "PageDown") {
      event.preventDefault();
      send({ type: "advance" });
    }

    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      send({ type: "back" });
    }

    if (event.key === "f" || event.key === "F") {
      btnFs && btnFs.click();
    }

    if (event.key === "g" || event.key === "G") {
      btnGroup && btnGroup.click();
    }
  });

  if (btnFs) {
    btnFs.addEventListener("click", () => {
      if (!document.fullscreenElement) {
        stage.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }

      stage.classList.toggle("fullscreen");
      resizeChartSoon();
    });
  }

  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) {
      stage.classList.remove("fullscreen");
    } else {
      stage.classList.add("fullscreen");
    }

    resizeChartSoon();
  });

  if (btnGroup) {
    btnGroup.addEventListener("click", () => {
      const groupVisible = views.group && views.group.style.display === "block";

      if (groupVisible) {
        if (currentState && currentState.state === "lobby") {
          show("lobby");
        } else if (currentState && currentState.state === "ended") {
          show("ended");
        } else {
          show("question");
          if (currentState) {
            renderCurrentQuestion(currentState);
          }
        }
      } else {
        renderGroup();
        show("group");
      }
    });
  }

  function renderGroup() {
    if (!currentState || !groupGrid) return;

    groupGrid.innerHTML = "";

    const total = Number(currentState.total || 0);

    for (let i = 0; i < total; i++) {
      const tile = document.createElement("div");
      tile.className = "kk-group-tile";
      tile.innerHTML = `
        <div class="kk-group-tile-title">Q${i + 1}</div>
        <canvas height="180"></canvas>
      `;

      groupGrid.appendChild(tile);

      const canvas = tile.querySelector("canvas");
      const labels = ["A", "B", "C", "D"];
      const values = labels.map(() => 0);

      new Chart(canvas, {
        type: "bar",
        data: {
          labels,
          datasets: [{
            data: values,
            backgroundColor: ["#7c3aed", "#22d3ee", "#fb7185", "#fbbf24"],
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: false,
            },
          },
          scales: {
            x: {
              ticks: {
                color: "#cbd5e1",
              },
              grid: {
                color: "rgba(255,255,255,.08)",
              },
            },
            y: {
              beginAtZero: true,
              ticks: {
                color: "#cbd5e1",
              },
              grid: {
                color: "rgba(255,255,255,.08)",
              },
            },
          },
        },
      });
    }
  }

  // ─────────────────────── Drawing tools ───────────────────────

  draw = typeof window.kkDrawOverlay === "function"
    ? window.kkDrawOverlay(drawCanvas, laserCanvas, {
        onEvent: (evt) => send({ type: "draw", ...evt }),
      })
    : null;

  function activateDrawTool(tool) {
    const chartWrap = document.getElementById("chart-wrap");

    if (!drawCanvas || !laserCanvas) return;

    tool = tool || "off";

    if (chartWrap) {
      chartWrap.classList.remove("is-drawing", "is-laser");
    }

    drawCanvas.classList.remove("active");
    laserCanvas.classList.remove("active");

    /*
     * Important:
     * draw_overlay.js listens on laserCanvas for ALL pointer events.
     * So laserCanvas must receive pointer events for pen, highlight,
     * and laser. drawCanvas is only the visible ink output layer.
     */
    drawCanvas.style.pointerEvents = "none";
    laserCanvas.style.pointerEvents = "none";

    if (tool === "pen" || tool === "highlight") {
      if (chartWrap) chartWrap.classList.add("is-drawing");

      drawCanvas.classList.add("active");
      laserCanvas.classList.add("active");

      laserCanvas.style.pointerEvents = "auto";
      laserCanvas.style.cursor = "crosshair";
    }

    if (tool === "laser") {
      if (chartWrap) chartWrap.classList.add("is-laser");

      laserCanvas.classList.add("active");

      laserCanvas.style.pointerEvents = "auto";
      laserCanvas.style.cursor = "none";
    }

    if (tool === "off") {
      laserCanvas.style.cursor = "default";
    }

    if (draw && typeof draw.setTool === "function") {
      draw.setTool(tool);
    }

    if (draw && typeof draw.resize === "function") {
      requestAnimationFrame(() => draw.resize());
    }
  }

  document.querySelectorAll("#draw-tools .kk-tool[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tool = btn.dataset.tool || "off";

      document.querySelectorAll("#draw-tools .kk-tool[data-tool]").forEach((item) => {
        item.classList.remove("active");
      });

      btn.classList.add("active");

      activateDrawTool(tool);
    });
  });

  const activeToolBtn = document.querySelector("#draw-tools .kk-tool.active[data-tool]");
  activateDrawTool(activeToolBtn ? activeToolBtn.dataset.tool : "off");

  if (clearDrawBtn) {
    clearDrawBtn.addEventListener("click", () => {
      if (draw && typeof draw.clear === "function") {
        draw.clear();
      }

      send({ type: "clear_draw" });
    });
  }

  document.querySelectorAll(".kk-color-swatch").forEach((swatch) => {
    swatch.addEventListener("click", () => {
      document.querySelectorAll(".kk-color-swatch").forEach((item) => {
        item.classList.remove("active");
      });

      swatch.classList.add("active");

      if (draw && typeof draw.setColor === "function") {
        draw.setColor(swatch.dataset.color);
      }
    });
  });

  window.addEventListener("resize", () => {
    if (draw && typeof draw.resize === "function") {
      draw.resize();
    }

    if (chartHolder.chart) {
      try {
        chartHolder.chart.resize();
      } catch (e) {}
    }
  });
})();