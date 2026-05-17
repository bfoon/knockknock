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

  // ─────────────────────── Chart background scenery ───────────────────────
  // The chart_backgrounds.css rules in app.css (kk-bg-space/forest/room/binary/normal)
  // only fire when `.kk-chart-wrap` carries the matching `kk-bg-<name>` class.
  // Apply it now from the dataset, and re-apply on `state` when the server
  // ships a fresh value in case the quiz was edited mid-session.
  function applyChartBackground(name) {
    const wrap = document.getElementById("chart-wrap");
    if (!wrap) return;
    const next = (name || "normal").toLowerCase();
    [...wrap.classList].forEach(c => { if (c.startsWith("kk-bg-")) wrap.classList.remove(c); });
    wrap.classList.add("kk-bg-" + next);
    window.kkChartBackground = next;
  }
  applyChartBackground(window.kkChartBackground);

  const views = {
    lobby: document.getElementById("view-lobby"),
    question: document.getElementById("view-question"),
    title: document.getElementById("view-title"),
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
  const presenterTimerChip = document.getElementById("presenter-timer-chip");
  const presenterTimerDetail = document.getElementById("presenter-timer-detail");
  const stageTimeBar = document.getElementById("kk-stage-time-bar");
  const stageTimeBarFill = document.getElementById("kk-stage-time-bar-fill");
  const btnExtend5 = document.getElementById("btn-extend-5");
  const btnExtend10 = document.getElementById("btn-extend-10");

  const btnStart = document.getElementById("btn-start");
  const btnNext = document.getElementById("btn-next");
  const btnPrev = document.getElementById("btn-prev");
  const btnEnd = document.getElementById("btn-end");
  const btnFs = document.getElementById("btn-fs");
  const btnFsPrev = document.getElementById("btn-fs-prev");
  const btnFsNext = document.getElementById("btn-fs-next");
  const btnGroup = document.getElementById("btn-group");
  const clearDrawBtn = document.getElementById("clear-draw");
  const axisFontX = document.getElementById("axis-font-x");
  const axisFontY = document.getElementById("axis-font-y");
  const axisFontXValue = document.getElementById("axis-font-x-value");
  const axisFontYValue = document.getElementById("axis-font-y-value");
  const endParticipantCount = document.getElementById("end-participant-count");
  const endEmojiLayer = document.getElementById("end-emoji-layer");

  const AVATARS_BY_ID = window.kkAvatarsById || {};
  const chartHolder = { chart: null };

  window.kkChartAxisFonts = {
    x: Number(localStorage.getItem("kk-chart-axis-x") || 12),
    y: Number(localStorage.getItem("kk-chart-axis-y") || 12),
  };

  let currentState = null;
    let latestTally = null;
    let latestTallyByQuestion = {};
    let ws = null;
    let draw = null;
    let presenterClockSkewMs = 0;
    let presenterTimerInterval = null;
    let revealRequestQuestionId = null;
    let revealRetryTimer = null;
    const correctRevealByQuestion = {};

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
      } else if (key === "title") {
        el.style.display = "flex";
        el.style.flexDirection = "column";
        el.style.minHeight = "0";
        el.style.height = "100%";
      } else if (key === "ended") {
        // The end view is a centered grid. Using block here pushes the card left.
        el.style.display = "grid";
        el.style.placeItems = "center";
        el.style.alignContent = "center";
        el.style.justifyContent = "center";
        el.style.width = "100%";
        el.style.minHeight = "100%";
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

  function extendTime(seconds) {
    send({ type: "extend_time", seconds: Number(seconds) || 0 });
  }

  function requestCorrectAnswerReveal(questionId, delayMs) {
    if (kind !== "game" || !questionId) return;

    const doSend = () => {
      revealRequestQuestionId = String(questionId);
      send({ type: "reveal_answer", question_id: questionId });
    };

    if (delayMs && delayMs > 0) {
      clearTimeout(revealRetryTimer);
      revealRetryTimer = setTimeout(doSend, delayMs);
    } else if (revealRequestQuestionId !== String(questionId)) {
      doSend();
      clearTimeout(revealRetryTimer);
      revealRetryTimer = setTimeout(doSend, 850);
    }
  }

  if (btnExtend5) btnExtend5.addEventListener("click", () => extendTime(5));
  if (btnExtend10) btnExtend10.addEventListener("click", () => extendTime(10));

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

        case "reaction_burst":
          onReactionBurst(msg);
          break;

        case "celebration_emoji":
          onCelebrationEmoji(msg);
          break;

        case "leaderboard":
          onLeaderboard(msg);
          break;

        case "correct_answer":
          onCorrectAnswerReveal(msg);
          break;

        case "ended":
          showEnded();
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
      qText.style.fontSize = `clamp(1.6rem, ${Math.max(3.5, size / 10)}vw, ${Math.min(112, size * 1.25)}px)`;
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
    // Keep ALL incoming counts (not just choice-keyed ones) so non-choice
    // question types — word clouds, NPS, scale, numeric, dates — still have
    // their data available to custom chart renderers.
    const fixedCounts = { ...sourceCounts };

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



  // ─────────────────────── Chart axis font controls ───────────────────────

  function clampAxisFont(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 12;
    return Math.max(8, Math.min(48, Math.round(n)));
  }

  function syncAxisFontControls() {
    window.kkChartAxisFonts.x = clampAxisFont(window.kkChartAxisFonts.x);
    window.kkChartAxisFonts.y = clampAxisFont(window.kkChartAxisFonts.y);

    if (axisFontX) axisFontX.value = String(window.kkChartAxisFonts.x);
    if (axisFontY) axisFontY.value = String(window.kkChartAxisFonts.y);
    if (axisFontXValue) axisFontXValue.textContent = String(window.kkChartAxisFonts.x);
    if (axisFontYValue) axisFontYValue.textContent = String(window.kkChartAxisFonts.y);
  }

  function updateAxisFont(axis, value) {
    const safe = clampAxisFont(value);
    window.kkChartAxisFonts[axis] = safe;
    localStorage.setItem(`kk-chart-axis-${axis}`, String(safe));
    syncAxisFontControls();

    if (currentState && currentState.question) {
      renderCurrentQuestion(currentState);
    }
  }

  syncAxisFontControls();

  if (axisFontX) axisFontX.addEventListener("input", () => updateAxisFont("x", axisFontX.value));
  if (axisFontY) axisFontY.addEventListener("input", () => updateAxisFont("y", axisFontY.value));

  // ─────────────────────── Presenter synchronized timer ───────────────────────

  function presenterQuestionSeconds(s) {
    const limit = Number(s && s.question && s.question.time_limit ? s.question.time_limit : 0);
    const ext = Number(s && s.time_extension_seconds ? s.time_extension_seconds : 0);
    return Math.max(0, limit + Math.max(0, ext));
  }

  function presenterSecondsLeft(s) {
    if (!s || !s.question) return null;
    const started = (typeof s.question_started_at_ms === "number") ? s.question_started_at_ms : null;
    const total = presenterQuestionSeconds(s);
    if (!started) return total;
    const serverNow = Date.now() + presenterClockSkewMs;
    return Math.max(0, Math.ceil(((started + total * 1000) - serverNow) / 1000));
  }

  function setPresenterTimerEnabled(enabled) {
    [btnExtend5, btnExtend10].forEach(btn => {
      if (btn) btn.disabled = !enabled;
    });
  }

  function renderPresenterTimer(s) {
    clearInterval(presenterTimerInterval);
    stopStageTimeBar();

    const active = !!(s && s.state === "running" && s.question && s.question_started_at_ms);
    setPresenterTimerEnabled(active);

    if (!active) {
      if (presenterTimerChip) presenterTimerChip.textContent = "—";
      if (presenterTimerDetail) presenterTimerDetail.textContent = "Timer starts when the question opens.";
      return;
    }

    const limit = Number(s.question.time_limit || 0);
    const ext = Number(s.time_extension_seconds || 0);
    const allowLate = !!s.allow_late_answers;

    function tick() {
      const left = presenterSecondsLeft(s);
      if (presenterTimerChip) {
        presenterTimerChip.textContent = `${left}s`;
        presenterTimerChip.classList.toggle("is-ended", Number(left) <= 0);
      }
      if (presenterTimerDetail) {
        const extText = ext > 0 ? ` + ${ext}s extension` : "";
        const lateText = allowLate ? "Late answers allowed by creator." : "Late answers blocked unless you extend.";
        presenterTimerDetail.textContent = `${limit}s${extText}. ${lateText}`;
      }

      if (Number(left) <= 0 && s.question && s.question.id) {
        requestCorrectAnswerReveal(s.question.id, 0);
      }
    }

    tick();
    presenterTimerInterval = setInterval(tick, 250);
    startStageTimeBar(s);
  }

  // ─────────────────────── Stage-spanning progress bar ───────────────────────
  // Pinned across the bottom of the stage (markup in present.html). We
  // animate it on requestAnimationFrame instead of the 250ms chip tick so
  // the bar glides instead of stepping. data-state on the wrapper handles
  // visibility, data-urgency drives the colour ramp via CSS.
  let stageTimeBarRaf = null;

  function startStageTimeBar(s) {
    if (!stageTimeBar || !stageTimeBarFill) return;
    const total = presenterQuestionSeconds(s);
    const started = (typeof s.question_started_at_ms === "number") ? s.question_started_at_ms : null;
    if (!total || !started) {
      stopStageTimeBar();
      return;
    }
    const totalMs = total * 1000;
    stageTimeBar.dataset.state = "running";

    function frame() {
      const serverNow = Date.now() + presenterClockSkewMs;
      const remainingMs = Math.max(0, totalMs - (serverNow - started));
      const pct = totalMs > 0 ? (remainingMs / totalMs) * 100 : 0;

      stageTimeBarFill.style.width = `${pct.toFixed(2)}%`;
      stageTimeBar.setAttribute("aria-valuenow", String(Math.round(pct)));

      // Urgency steps — warn at 50%, urgent at 25%.
      let urgency = "calm";
      if (pct <= 25) urgency = "urgent";
      else if (pct <= 50) urgency = "warn";
      if (stageTimeBar.dataset.urgency !== urgency) {
        stageTimeBar.dataset.urgency = urgency;
      }

      if (remainingMs <= 0) {
        // Hold the bar visible empty for a moment so the reveal feels
        // like "timer just ran out". Next state push from the server
        // will switch this back to idle naturally.
        stageTimeBar.dataset.state = "ended";
        stageTimeBarRaf = null;
        return;
      }
      stageTimeBarRaf = requestAnimationFrame(frame);
    }
    frame();
  }

  function stopStageTimeBar() {
    if (stageTimeBarRaf) {
      cancelAnimationFrame(stageTimeBarRaf);
      stageTimeBarRaf = null;
    }
    if (stageTimeBar) {
      stageTimeBar.dataset.state = "idle";
      stageTimeBar.dataset.urgency = "calm";
      stageTimeBar.setAttribute("aria-valuenow", "0");
    }
    if (stageTimeBarFill) {
      stageTimeBarFill.style.width = "100%";
    }
  }

  // ─────────────────────── State handling ───────────────────────

  function onState(s) {
    const previousQuestionId = currentState && currentState.question ? String(currentState.question.id) : null;
    currentState = s;
    const nextQuestionId = s && s.question ? String(s.question.id) : null;
    if (nextQuestionId && previousQuestionId !== nextQuestionId) {
      revealRequestQuestionId = null;
      clearTimeout(revealRetryTimer);
    }
    if (typeof s.server_time_ms === "number") {
      presenterClockSkewMs = s.server_time_ms - Date.now();
    }
    renderPresenterTimer(s);
    syncFullscreenNavState();

    // Re-apply chart background if the server's value differs (handles a quiz
    // setting being changed while a session is live).
    if (s.chart_background && s.chart_background.toLowerCase() !== window.kkChartBackground) {
      applyChartBackground(s.chart_background);
    }

    if (participantCount) {
      participantCount.textContent = Number(s.participants || 0);
    }

    renderLobbyParticipants(Number(s.participants || 0));

    if (s.state === "lobby") {
      show("lobby");
      return;
    }

    if (s.state === "ended") {
      showEnded();
      return;
    }

    if (!s.question) {
      show("lobby");
      return;
    }

    // Title slides have their own view (no chart, no answer flow).
    if ((s.question.type || "") === "title") {
      show("title");
      renderTitleSlide(s);
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
    const questionType = q.type || q.question_type || "mcq";
    const tallyData = getStateTallyForCurrentQuestion(s);

    renderQuestionResults(q, chartId, questionType, labels, tallyData);
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

    renderQuestionResults(q, q.chart_type || "bar", q.type || q.question_type || "mcq", q.choices || [], tallyData);
  }


  function renderQuestionResults(q, chartId, questionType, labels, tallyData) {
    // For GAME sessions we deliberately hide the live chart until the
    // timer ends. The server stops broadcasting tallies during the
    // round (see consumers.py _on_answer) and bundles the final tally
    // into the correct_answer reveal. While we wait, render a clean
    // "locked" panel so the presenter screen isn't empty.
    //
    // The lock lifts as soon as either:
    //   - a tally arrives (which only happens at reveal time for games), or
    //   - a correct_answer reveal arrives for this question.
    const revealForThis = q && q.id ? correctRevealByQuestion[normalizeChoiceId(q.id)] : null;
    const tallyEmpty = !tallyData || (
      (!tallyData.counts || Object.keys(tallyData.counts).length === 0)
      && (!tallyData.texts || tallyData.texts.length === 0)
      && (!tallyData.values || tallyData.values.length === 0)
      && (!tallyData.points || tallyData.points.length === 0)
    );
    if (kind === "game" && tallyEmpty && !revealForThis) {
      // picture_prompt swaps the generic 🔒 panel for the prompt
      // image — players are answering "look at this and pick" so the
      // audience needs to see what "this" is for the round to make sense.
      if (questionType === "picture_prompt") {
        renderPicturePromptPresenter(q);
      } else {
        renderGameChartLocked(q);
      }
      return;
    }

    if (questionType === "picture_choice") {
      renderPictureChoicePresenter(q, tallyData);
    } else if (questionType === "puzzle") {
      renderPuzzleWinnerPresenter(q, tallyData);
    } else {
      renderLiveChart(chartId, questionType, labels, tallyData);
    }

    const reveal = q && q.id ? correctRevealByQuestion[normalizeChoiceId(q.id)] : null;
    if (reveal) renderCorrectAnswerPresenter(q, questionType, reveal);
  }

  function renderPicturePromptPresenter(q) {
    // Layout: large prompt image on the left, lettered answer chips
    // on the right. Mirrors the screenshot reference the user shared.
    // Tally is hidden during the round; the chart replaces this on
    // reveal via the normal flow.
    if (!specialEl) return;
    destroyChartForSpecialDisplay();
    if (liveCanvas) liveCanvas.style.display = "none";
    specialEl.style.display = "block";
    ensurePicturePromptStyles();

    const imageUrl = q && (q.image_url || q.image) ? (q.image_url || q.image) : "";
    const choices = Array.isArray(q && q.choices) ? q.choices : [];
    const letters = ["A", "B", "C", "D", "E", "F"];

    const imageHtml = imageUrl
      ? `<div class="kk-pp-image-wrap">
           <img src="${escapeHtml(imageUrl)}" alt="" class="kk-pp-image">
         </div>`
      : `<div class="kk-pp-image-wrap kk-pp-image-missing">
           <i class="bi bi-image"></i>
           <p>No prompt image set for this question.</p>
         </div>`;

    const choicesHtml = choices.map((c, i) => `
      <div class="kk-pp-answer">
        <span class="kk-pp-letter">${letters[i] || (i + 1)}</span>
        <span class="kk-pp-text">${escapeHtml(c.text || "")}</span>
      </div>
    `).join("");

    specialEl.innerHTML = `
      <div class="kk-pp-stage">
        ${imageHtml}
        <div class="kk-pp-answers">${choicesHtml}</div>
      </div>
    `;
  }

  function ensurePicturePromptStyles() {
    if (document.getElementById("kk-picture-prompt-styles")) return;
    const style = document.createElement("style");
    style.id = "kk-picture-prompt-styles";
    style.textContent = `
      .kk-pp-stage {
        width: 100%; height: 100%;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
        gap: clamp(1rem, 2.5vw, 3rem);
        align-items: center;
        padding: clamp(1rem, 3vw, 3rem);
      }
      .kk-pp-image-wrap {
        width: 100%;
        aspect-ratio: 4 / 3;
        border-radius: 24px;
        overflow: hidden;
        background: rgba(15, 23, 42, 0.55);
        border: 4px solid #fff;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
        display: grid; place-items: center;
      }
      .kk-pp-image {
        width: 100%; height: 100%;
        object-fit: cover; display: block;
      }
      .kk-pp-image-missing {
        color: rgba(226, 232, 240, 0.7);
        text-align: center; padding: 1rem;
        flex-direction: column;
      }
      .kk-pp-image-missing > i {
        font-size: clamp(3rem, 6vw, 5rem);
        opacity: 0.5;
      }
      .kk-pp-image-missing > p { margin: 0.5rem 0 0; }

      .kk-pp-answers {
        display: flex; flex-direction: column;
        gap: clamp(0.5rem, 1.2vw, 1.1rem);
      }
      .kk-pp-answer {
        display: flex; align-items: center;
        gap: clamp(0.75rem, 1.5vw, 1.5rem);
        background: #fff;
        color: #0f172a;
        border-radius: 999px;
        padding: clamp(0.65rem, 1.4vw, 1.1rem) clamp(1rem, 2vw, 1.6rem);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
        font-family: 'Clash Display', system-ui, sans-serif;
        font-weight: 700;
      }
      .kk-pp-letter {
        flex: 0 0 auto;
        width: clamp(2.4rem, 4vw, 3.2rem);
        height: clamp(2.4rem, 4vw, 3.2rem);
        border-radius: 999px;
        display: grid; place-items: center;
        background: linear-gradient(135deg, #a855f7, #7c3aed);
        color: #fff;
        font-size: clamp(1.1rem, 2vw, 1.6rem);
        font-weight: 800;
        box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.25);
      }
      .kk-pp-text {
        font-size: clamp(1.05rem, 1.8vw, 1.7rem);
        line-height: 1.2;
        overflow-wrap: anywhere;
      }

      @media (max-width: 900px) {
        .kk-pp-stage {
          grid-template-columns: 1fr;
          padding: 0.75rem;
          gap: 0.85rem;
        }
        .kk-pp-image-wrap { aspect-ratio: 16 / 9; }
      }
    `;
    document.head.appendChild(style);
  }

  function renderGameChartLocked(q) {
    if (!specialEl) return;
    destroyChartForSpecialDisplay();
    if (liveCanvas) liveCanvas.style.display = "none";
    specialEl.style.display = "block";
    ensureGameLockedStyles();
    specialEl.innerHTML = `
      <div class="kk-game-locked">
        <div class="kk-game-locked-icon">🔒</div>
        <h2>Answers locked</h2>
        <p>The chart and correct answer reveal when the timer ends.</p>
        <div class="kk-game-locked-sub">Keep them honest — no peeking.</div>
      </div>
    `;
  }

  function ensureGameLockedStyles() {
    if (document.getElementById("kk-game-locked-styles")) return;
    const style = document.createElement("style");
    style.id = "kk-game-locked-styles";
    style.textContent = `
      .kk-game-locked {
        width: 100%; height: 100%;
        display: grid; place-items: center; align-content: center;
        text-align: center; padding: clamp(1.5rem, 4vw, 4rem);
        border-radius: 32px;
        background:
          radial-gradient(circle at top, rgba(124, 58, 237, 0.20), transparent 40%),
          linear-gradient(135deg, rgba(15, 23, 42, 0.55), rgba(30, 41, 59, 0.45));
        color: #e2e8f0;
      }
      .kk-game-locked-icon {
        font-size: clamp(3.5rem, 9vw, 8rem);
        line-height: 1; margin-bottom: .5rem;
        filter: drop-shadow(0 6px 24px rgba(124, 58, 237, 0.4));
        animation: kk-game-locked-pulse 2.4s ease-in-out infinite;
      }
      .kk-game-locked h2 {
        font-family: 'Clash Display', system-ui, sans-serif;
        font-size: clamp(1.6rem, 3.5vw, 3.5rem);
        font-weight: 900; margin: .25rem 0;
      }
      .kk-game-locked p {
        font-size: clamp(.95rem, 1.5vw, 1.4rem);
        color: rgba(226, 232, 240, 0.78);
        max-width: 700px; margin: 0;
      }
      .kk-game-locked-sub {
        margin-top: 1rem; font-size: .85rem;
        letter-spacing: .12em; text-transform: uppercase;
        color: rgba(124, 58, 237, 0.85); font-weight: 700;
      }
      @keyframes kk-game-locked-pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50%      { transform: scale(1.08); opacity: .85; }
      }
    `;
    document.head.appendChild(style);
  }

  function onCorrectAnswerReveal(msg) {
    if (!msg || !msg.question_id) return;
    correctRevealByQuestion[normalizeChoiceId(msg.question_id)] = msg;

    // Games hold the tally back until the timer ends, then ship it
    // bundled into this reveal message. Adopt it as the latest tally
    // so renderQuestionResults can draw the chart at the same moment
    // the correct-answer overlay appears. For polls this is a no-op
    // (reveals don't carry a tally there).
    if (msg.tally) {
      const qid = normalizeChoiceId(msg.question_id);
      const q = currentState && currentState.question ? currentState.question : null;
      const normalized = q
        ? normalizeTallyForQuestion(q, msg.tally)
        : msg.tally;
      latestTally = normalized;
      latestTallyByQuestion[qid] = normalized;
      if (currentState && currentState.question
          && normalizeChoiceId(currentState.question.id) === qid) {
        currentState.tally = normalized;
      }
    }

    if (currentState && currentState.question && normalizeChoiceId(currentState.question.id) === normalizeChoiceId(msg.question_id)) {
      renderCurrentQuestion(currentState);
    }
  }

  function ensureCorrectAnswerRevealStyles() {
    if (document.getElementById("kk-correct-answer-reveal-styles")) return;
    const style = document.createElement("style");
    style.id = "kk-correct-answer-reveal-styles";
    style.textContent = `
      .kk-correct-answer-reveal {
        position: absolute;
        left: clamp(12px, 2vw, 24px);
        top: clamp(12px, 2vw, 24px);
        z-index: 60;
        max-width: min(520px, calc(100% - 32px));
        padding: .8rem 1rem;
        border-radius: 18px;
        background: linear-gradient(135deg, rgba(22,163,74,.94), rgba(20,83,45,.92));
        color: #fff;
        border: 1px solid rgba(255,255,255,.24);
        box-shadow: 0 20px 55px rgba(0,0,0,.38), 0 0 28px rgba(34,197,94,.25);
        backdrop-filter: blur(12px);
        font-weight: 900;
        line-height: 1.25;
        pointer-events: none;
      }
      .kk-correct-answer-reveal .label { display:block; font-size:.78rem; letter-spacing:.08em; text-transform:uppercase; opacity:.82; margin-bottom:.25rem; }
      .kk-correct-answer-reveal .answer { display:flex; align-items:center; gap:.65rem; font-size:clamp(1rem,1.7vw,1.35rem); }
      .kk-correct-answer-reveal img { width:54px; height:54px; object-fit:cover; border-radius:12px; background:#fff; border:2px solid rgba(255,255,255,.85); }
      .kk-correct-answer-card {
        width:100%; height:100%; display:grid; place-items:center; align-content:center; text-align:center;
        padding:clamp(1.5rem,4vw,4rem); border-radius:32px;
        background:radial-gradient(circle at top, rgba(34,197,94,.28), transparent 38%), linear-gradient(135deg, rgba(22,163,74,.24), rgba(34,211,238,.13));
      }
      .kk-correct-answer-card h2 { font-family:'Clash Display',system-ui,sans-serif; font-size:clamp(2rem,5vw,5rem); margin:.5rem 0; font-weight:950; }
      .kk-correct-answer-card p { font-size:clamp(1.05rem,2vw,1.7rem); color:rgba(255,255,255,.82); max-width:900px; }
    `;
    document.head.appendChild(style);
  }

  function renderCorrectAnswerPresenter(q, questionType, reveal) {
    if (!specialEl || !q || !reveal) return;
    ensureCorrectAnswerRevealStyles();

    const correctChoices = Array.isArray(reveal.correct_choices) ? reveal.correct_choices : [];
    const answerText = correctChoices.map((c, i) => {
      const label = c.text || `Answer ${i + 1}`;
      return questionType === "puzzle" ? `${i + 1}. ${label}` : label;
    }).join(questionType === "puzzle" ? " • " : ", ");

    if (questionType === "puzzle") {
      destroyChartForSpecialDisplay();
      specialEl.innerHTML = `<div class="kk-correct-answer-card"><div style="font-size:clamp(4rem,11vw,10rem);">🧩✅</div><h2>Correct order</h2><p>${escapeHtml(answerText || "The correct puzzle order is highlighted for participants.")}</p></div>`;
      return;
    }

    // Append a non-destructive overlay so the existing picture-choice chart,
    // photo X-axis labels, and winner/avatar logic remain untouched.
    specialEl.querySelectorAll(".kk-correct-answer-reveal").forEach(el => el.remove());
    const first = correctChoices[0] || {};
    const img = first.image_url ? `<img src="${escapeHtml(first.image_url)}" alt="">` : "";
    const label = questionType === "picture_choice" ? "Correct picture" : "Correct answer";
    const text = answerText || "See the highlighted correct answer.";
    const badge = document.createElement("div");
    badge.className = "kk-correct-answer-reveal";
    badge.innerHTML = `<span class="label">Time ended — ${escapeHtml(label)}</span><span class="answer">${img}<span>${escapeHtml(text)}</span></span>`;
    specialEl.appendChild(badge);
  }

  // ─────────────────────── Title-slide presenter ───────────────────────

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderTitleSlide(s) {
    const canvas = document.getElementById("title-canvas");
    const progressEl = document.getElementById("title-progress");
    if (!canvas) return;

    // Destroy any leftover chart from a previous (non-title) question, since
    // Chart.js can keep running animations on a hidden canvas.
    if (chartHolder.chart) {
      try { chartHolder.chart.destroy(); } catch (e) {}
      chartHolder.chart = null;
    }

    const q = s.question || {};
    const layout = (q.title_layout || "clean").toLowerCase();
    const headline = q.text || "";
    const subtitle = q.subtitle || "";
    const author = q.title_author || "";
    const imageUrl = q.title_image_url || "";

    if (progressEl) {
      progressEl.textContent = `Slide ${(Number(s.index) || 0) + 1} / ${Number(s.total) || 1}`;
    }

    // Reset class list so re-renders pick up the active layout.
    canvas.className = "kk-title-canvas layout-" + (
      layout === "quote" ? "quote" :
      layout === "divider" ? "divider" : "clean"
    );

    // Apply per-question typography to the headline (same font_family options
    // as a normal question — the editor reuses these controls).
    const fam = (q.font_family && FONT_STACK[q.font_family]) || FONT_STACK.default;
    const headlineStyle = fam ? ` style="font-family: ${fam}"` : "";

    let html = "";

    if (layout === "quote") {
      // Headline (if any) acts as a kicker above the quote body; subtitle is
      // the actual quoted text. If subtitle is empty, fall back to headline.
      const body = subtitle || headline;
      html = "";
      if (headline && subtitle) {
        html += `<p class="kk-title-headline"${headlineStyle}>${escapeHtml(headline)}</p>`;
      }
      html += `<blockquote class="kk-title-quote-body">${escapeHtml(body)}</blockquote>`;
      if (author) {
        html += `<div class="kk-title-quote-author">${escapeHtml(author)}</div>`;
      }
    } else if (layout === "divider") {
      const num = String((Number(s.index) || 0) + 1).padStart(2, "0");
      html = "";
      html += `<div class="kk-title-divider-num">${num}</div>`;
      html += `<div class="kk-title-divider-rule"></div>`;
      html += `<h1 class="kk-title-headline"${headlineStyle}>${escapeHtml(headline)}</h1>`;
      if (subtitle) {
        html += `<p class="kk-title-sub">${escapeHtml(subtitle)}</p>`;
      }
    } else {
      // Clean
      html = "";
      if (imageUrl) {
        html += `<img class="kk-title-logo" src="${escapeHtml(imageUrl)}" alt="">`;
      }
      html += `<h1 class="kk-title-headline"${headlineStyle}>${escapeHtml(headline)}</h1>`;
      if (subtitle) {
        html += `<p class="kk-title-sub">${escapeHtml(subtitle)}</p>`;
      }
      html += `<div class="kk-title-accent"></div>`;
    }

    canvas.innerHTML = html;

    // Re-trigger the entrance animation on each render by forcing a reflow.
    // (Removing then re-adding the class restarts the CSS animation.)
    void canvas.offsetWidth;
    canvas.style.animation = "none";
    void canvas.offsetWidth;
    canvas.style.animation = "";
  }

  function destroyChartForSpecialDisplay() {
    if (chartHolder.chart) {
      try { chartHolder.chart.destroy(); } catch (e) {}
      chartHolder.chart = null;
    }
    if (liveCanvas) liveCanvas.style.display = "none";
    if (specialEl) {
      specialEl.style.display = "block";
      specialEl.innerHTML = "";
    }
  }

  function renderPictureChoicePresenter(q, tallyData) {
    if (!liveCanvas || !specialEl || !window.Chart) return;

    // The user requested picture questions to behave like a chart, with the
    // answer photos shown as small labels on the X axis. We draw a normal bar
    // chart and use a small custom plugin to paint thumbnails under each bar.
    liveCanvas.style.display = "block";
    specialEl.style.display = "block";
    specialEl.innerHTML = "";

    const counts = (tallyData && tallyData.counts) || {};
    const choices = Array.isArray(q.choices) ? q.choices : [];
    const labels = choices.map((choice, i) => choice.text || `Picture ${i + 1}`);
    const values = choices.map(choice => Number(counts[String(choice.id)] ?? counts[choice.id] ?? 0));

    const imageCache = choices.map(choice => {
      if (!choice.image_url) return null;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (chartHolder.chart) chartHolder.chart.update("none");
      };
      img.src = choice.image_url;
      return img;
    });

    const pictureAxisPlugin = {
      id: "kkPictureAxisLabels",
      afterDraw(chart) {
        const x = chart.scales && chart.scales.x;
        if (!x) return;
        const ctx = chart.ctx;
        const area = chart.chartArea;
        const size = Math.max(34, Math.min(54, Math.floor((area.right - area.left) / Math.max(choices.length * 2.4, 1))));
        const y = area.bottom + 12;

        ctx.save();
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.font = "700 11px Inter, system-ui, sans-serif";
        choices.forEach((choice, index) => {
          const cx = x.getPixelForValue(index);
          const left = cx - size / 2;
          const img = imageCache[index];

          ctx.save();
          ctx.beginPath();
          const r = 10;
          ctx.moveTo(left + r, y);
          ctx.lineTo(left + size - r, y);
          ctx.quadraticCurveTo(left + size, y, left + size, y + r);
          ctx.lineTo(left + size, y + size - r);
          ctx.quadraticCurveTo(left + size, y + size, left + size - r, y + size);
          ctx.lineTo(left + r, y + size);
          ctx.quadraticCurveTo(left, y + size, left, y + size - r);
          ctx.lineTo(left, y + r);
          ctx.quadraticCurveTo(left, y, left + r, y);
          ctx.closePath();
          ctx.clip();

          if (img && img.complete && img.naturalWidth) {
            const ratio = Math.max(size / img.naturalWidth, size / img.naturalHeight);
            const w = img.naturalWidth * ratio;
            const h = img.naturalHeight * ratio;
            ctx.drawImage(img, cx - w / 2, y + size / 2 - h / 2, w, h);
          } else {
            ctx.fillStyle = "rgba(255,255,255,.14)";
            ctx.fillRect(left, y, size, size);
            ctx.fillStyle = "rgba(255,255,255,.86)";
            ctx.font = `${Math.round(size * 0.48)}px system-ui`;
            ctx.fillText("🖼️", cx, y + size * 0.24);
          }
          ctx.restore();

          ctx.strokeStyle = "rgba(255,255,255,.78)";
          ctx.lineWidth = 2;
          ctx.strokeRect(left + 1, y + 1, size - 2, size - 2);

          const txt = String(choice.text || `Picture ${index + 1}`).slice(0, 18);
          ctx.fillStyle = "rgba(255,255,255,.92)";
          ctx.font = "700 11px Inter, system-ui, sans-serif";
          ctx.fillText(txt, cx, y + size + 6);
        });
        ctx.restore();
      },
    };

    if (chartHolder.chart) {
      try { chartHolder.chart.destroy(); } catch (e) {}
      chartHolder.chart = null;
    }

    chartHolder.chart = new Chart(liveCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data: values,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,.35)",
          backgroundColor: labels.map((_, i) => [
            "rgba(124,58,237,.82)",
            "rgba(34,211,238,.82)",
            "rgba(251,113,133,.82)",
            "rgba(251,191,36,.82)",
            "rgba(52,211,153,.82)",
          ][i % 5]),
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { bottom: 92, left: 10, right: 10, top: 12 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { title: items => labels[items[0].dataIndex] || "" } },
        },
        scales: {
          x: {
            ticks: { display: false },
            grid: { display: false },
            border: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: {
              precision: 0,
              color: "rgba(255,255,255,.78)",
              font: { size: window.kkChartAxisFonts?.y || 14, weight: "700" },
            },
            grid: { color: "rgba(255,255,255,.10)" },
            border: { display: false },
          },
        },
        animation: { duration: 350 },
      },
      plugins: [pictureAxisPlugin],
    });

    resizeChartSoon();
  }

  function renderPuzzleWinnerPresenter(q, tallyData) {
    destroyChartForSpecialDisplay();
    if (!specialEl) return;
    const winner = tallyData && tallyData.winner;
    if (!winner) {
      specialEl.innerHTML = `<div class="kk-puzzle-presenter-wait"><div class="kk-puzzle-big">🧩</div><h2>Puzzle challenge</h2><p>Waiting for the first correct puzzle...</p></div>`;
      return;
    }
    const meta = AVATARS_BY_ID[winner.avatar_id] || {};
    const avatar = meta.emoji || avatarEmoji(winner.avatar_id) || "🏆";
    specialEl.innerHTML = `<div class="kk-puzzle-winner-card"><div class="kk-puzzle-winner-crown">🏆</div><div class="kk-puzzle-winner-avatar">${avatar}</div><h2>${escapeHtml(winner.nickname || winner.name || "Winner")}</h2><p>solved the puzzle first!</p></div>`;
  }

  function renderLiveChart(chartId, questionType, labels, tallyData) {
    if (!liveCanvas || !specialEl) return;

    // Try the rich/custom chart renderers first (word cloud, ranked bar,
    // heatmap, gauge, NPS segments, etc.). If one handles the requested
    // chart, we're done. Otherwise fall through to the original Chart.js
    // pipeline in kkRenderLive (bar/column/pie/donut/horizontal_bar/etc.).
    if (typeof window.kkRenderExtraChart === "function") {
      const handled = window.kkRenderExtraChart({
        chartId,
        questionType,
        question: (currentState && currentState.question) || { choices: labels },
        labels,
        tallyData: tallyData || { counts: {}, texts: [] },
        liveCanvas,
        specialEl,
        chartHolder,
        destroyChartForSpecialDisplay,
      });
      if (handled) {
        resizeChartSoon();
        return;
      }
    }

    liveCanvas.style.display = "block";
    specialEl.style.display = "block";
    specialEl.innerHTML = "";

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



  // ─────────────────────── Emoji reaction / final celebration ───────────────────────

  function ensureFloatingEmojiStyles() {
    if (document.getElementById("kk-floating-emoji-styles")) return;

    const style = document.createElement("style");
    style.id = "kk-floating-emoji-styles";
    style.textContent = `
      .kk-reaction-layer {
        position: absolute;
        inset: 0;
        z-index: 80;
        pointer-events: none;
        overflow: hidden;
      }
      .kk-reaction-fly {
        position: absolute;
        left: var(--kk-reaction-left, 50%);
        bottom: -2rem;
        transform: translate(-50%, 0) scale(.75) rotate(var(--kk-reaction-rotate, 0deg));
        font-size: var(--kk-reaction-size, 4rem);
        line-height: 1;
        filter: drop-shadow(0 14px 22px rgba(0,0,0,.35));
        animation: kkReactionFly var(--kk-reaction-duration, 2.4s) cubic-bezier(.16,.92,.26,1) forwards;
        will-change: transform, opacity;
      }
      @keyframes kkReactionFly {
        0% { opacity: 0; transform: translate(-50%, 24px) scale(.55) rotate(var(--kk-reaction-rotate, 0deg)); }
        10% { opacity: 1; }
        55% { opacity: 1; transform: translate(calc(-50% + var(--kk-reaction-drift, 0px)), -42vh) scale(1.12) rotate(calc(var(--kk-reaction-rotate, 0deg) * -1)); }
        100% { opacity: 0; transform: translate(calc(-50% + var(--kk-reaction-drift, 0px) * 1.65), -74vh) scale(1.55) rotate(calc(var(--kk-reaction-rotate, 0deg) * 1.4)); }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureReactionLayer() {
    const wrap = document.getElementById("chart-wrap");
    if (!wrap) return null;

    let layer = wrap.querySelector(".kk-reaction-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "kk-reaction-layer";
      layer.setAttribute("aria-hidden", "true");
      wrap.appendChild(layer);
    }

    return layer;
  }

  function isCurrentReactionQuestion(questionId) {
    if (!currentState || !currentState.question) return false;
    return (
      normalizeChoiceId(currentState.question.id) === normalizeChoiceId(questionId) &&
      String(currentState.question.type || "").toLowerCase() === "reaction"
    );
  }

  function onReactionBurst(msg) {
    if (!isCurrentReactionQuestion(msg.question_id)) return;
    spawnReactionEmoji(String(msg.emoji || msg.text || "✨").trim() || "✨", { primary: true });
    if (Math.random() > 0.55) setTimeout(() => spawnReactionEmoji(msg.emoji || "✨", { primary: false }), 80);
  }

  function spawnReactionEmoji(emoji, options) {
    ensureFloatingEmojiStyles();
    const layer = ensureReactionLayer();
    if (!layer) return;

    const el = document.createElement("span");
    el.className = "kk-reaction-fly";
    el.textContent = emoji;

    const primary = options && options.primary;
    const left = 12 + Math.random() * 76;
    const drift = (Math.random() * 240) - 120;
    const rotate = (Math.random() * 34) - 17;
    const size = primary ? (3.4 + Math.random() * 2.2) : (2.1 + Math.random() * 1.5);
    const duration = primary ? (2.15 + Math.random() * .55) : (1.55 + Math.random() * .5);

    el.style.setProperty("--kk-reaction-left", `${left}%`);
    el.style.setProperty("--kk-reaction-drift", `${drift}px`);
    el.style.setProperty("--kk-reaction-rotate", `${rotate}deg`);
    el.style.setProperty("--kk-reaction-size", `${size}rem`);
    el.style.setProperty("--kk-reaction-duration", `${duration}s`);

    layer.appendChild(el);
    window.setTimeout(() => el.remove(), Math.ceil(duration * 1000) + 200);
  }

  function showEnded() {
    if (endParticipantCount) {
      const count = currentState ? Number(currentState.participants || 0) : Number(participantCount?.textContent || 0);
      endParticipantCount.textContent = String(count);
    }
    show("ended");
    pulseEndCelebration();
  }

  function pulseEndCelebration() {
    const emojis = ["🎉", "✨", "🔥", "👏", "🚀", "💫", "🏆"];
    // Stagger more bubbles so the rise feels like a continuous flow,
    // not a one-shot pop.
    for (let i = 0; i < 8; i++) {
      setTimeout(
        () => spawnEndEmoji(emojis[Math.floor(Math.random() * emojis.length)], ""),
        i * 260
      );
    }
  }

  function onCelebrationEmoji(msg) {
    const emoji = String(msg.emoji || "🎉").trim() || "🎉";
    const name = String(msg.participant_name || "").trim();
    spawnEndEmoji(emoji, name);
  }

  function spawnEndEmoji(emoji, name) {
    if (!endEmojiLayer) return;
    const el = document.createElement("span");
    el.className = "kk-end-pop-emoji";
    el.innerHTML = `${escapeHtml(emoji)}${name ? `<span class="name">${escapeHtml(name)}</span>` : ""}`;

    // Bubbles rise straight up from the bottom, growing as they go.
    // Some stop around mid-page, others travel higher, then pop.
    const left = 12 + Math.random() * 76;          // spread across width
    const top = 82 + Math.random() * 12;           // start near the bottom
    const size = 1.4 + Math.random() * 1.0;        // 1.4rem – 2.4rem
    // Final vertical travel distance, in vh (viewport height).
    // Bubbles start near the bottom (~88vh from top) and rise this much.
    // -55vh ≈ reaches mid-page, -80vh ≈ reaches near top of page.
    const riseEnd = -(55 + Math.random() * 25);    // -55vh to -80vh
    const dur = 3.4 + Math.random() * 1.4;         // 3.4s – 4.8s rise (slow)

    el.style.setProperty("--left", `${left}%`);
    el.style.setProperty("--top", `${top}%`);
    el.style.setProperty("--size", `${size}rem`);
    el.style.setProperty("--rise-end", `${riseEnd}vh`);
    el.style.setProperty("--dur", `${dur}s`);

    endEmojiLayer.appendChild(el);
    // Remove once the pop animation has fully finished.
    window.setTimeout(() => el.remove(), dur * 1000 + 150);
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



  function syncFullscreenNavState() {
    if (!stage || !currentState) return;

    const state = currentState.state || "lobby";
    const index = Number(currentState.index ?? -1);
    const total = Number(currentState.total ?? 0);

    stage.classList.toggle("is-lobby", state === "lobby");
    stage.classList.toggle("is-running", state === "running");
    stage.classList.toggle("is-ended", state === "ended");

    // Back is disabled in lobby and on the first question; on The End it returns to the last question.
    if (btnFsPrev) {
      btnFsPrev.disabled = state === "lobby" || (state === "running" && index <= 0);
    }

    // Next can start from lobby, move forward, and on the last question opens The End.
    if (btnFsNext) {
      btnFsNext.disabled = state === "ended";
    }

    if (btnNext) {
      const isLast = state === "running" && total > 0 && index >= total - 1;
      btnNext.innerHTML = isLast ? 'Finish <i class="bi bi-stars"></i>' : 'Next <i class="bi bi-chevron-right"></i>';
    }
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

  if (btnFsPrev) {
    btnFsPrev.addEventListener("click", () => {
      if (!btnFsPrev.disabled) send({ type: "back" });
    });
  }

  if (btnFsNext) {
    btnFsNext.addEventListener("click", () => {
      if (!btnFsNext.disabled) send({ type: "advance" });
    });
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

    syncFullscreenNavState();
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
  // ─────────────────────────────────────────────────────────────
  // Presentation font colors (question text + chart axes/legend)
  // Wires #question-font-color and #chart-font-color color inputs +
  // their "Auto" reset buttons. Values persist in localStorage.
  //
  // Implementation note: chart_preview.js builds the Chart instance with
  // its own colors (and may use scriptable color functions). Mutating
  // options + update() isn't reliable because (a) fresh charts overwrite
  // the options, and (b) scriptable color callbacks ignore static values.
  // So we register a global Chart.js plugin that runs `beforeUpdate` on
  // EVERY chart and forces all text-color options to the saved value.
  // Chart.defaults.color is also bumped so scriptable functions that
  // read it pick up the new color too.
  // ─────────────────────────────────────────────────────────────
  (function setupFontColors() {
    const qInput     = document.getElementById("question-font-color");
    const cInput     = document.getElementById("chart-font-color");
    const qReset     = document.getElementById("reset-question-font-color");
    const cReset     = document.getElementById("reset-chart-font-color");
    const qTextEl    = document.getElementById("q-text");
    const wrap       = document.getElementById("chart-wrap");
    const stageEl    = document.querySelector(".kk-stage");

    const Q_KEY = "kk-question-font-color";
    const C_KEY = "kk-chart-font-color";

    // Convert any CSS color string (rgb/rgba/hex/named) → "#rrggbb".
    // Falls back to the supplied fallback when parsing fails.
    function toHex(input, fallback) {
      if (!input) return fallback;
      const s = String(input).trim();
      // Already hex?
      const m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      if (m) {
        const h = m[1];
        return "#" + (h.length === 3 ? h.split("").map((x) => x + x).join("") : h).toLowerCase();
      }
      // rgb()/rgba()
      const rgb = s.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
      if (rgb) {
        const r = Math.max(0, Math.min(255, Math.round(parseFloat(rgb[1]))));
        const g = Math.max(0, Math.min(255, Math.round(parseFloat(rgb[2]))));
        const b = Math.max(0, Math.min(255, Math.round(parseFloat(rgb[3]))));
        return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
      }
      // Last resort: let the browser resolve it via a temp element.
      try {
        const tmp = document.createElement("span");
        tmp.style.color = s;
        document.body.appendChild(tmp);
        const computed = getComputedStyle(tmp).color;
        document.body.removeChild(tmp);
        return toHex(computed, fallback);
      } catch (e) {
        return fallback;
      }
    }

    // Template-driven defaults: read --stage-fg from the live .kk-stage.
    function getTemplateFg() {
      if (!stageEl) return "#ffffff";
      const cs = getComputedStyle(stageEl);
      // Prefer the explicit --stage-fg var; fall back to the resolved
      // `color` property of the stage.
      const raw = (cs.getPropertyValue("--stage-fg") || "").trim() || cs.color;
      return toHex(raw, "#ffffff");
    }

    // Re-evaluated each time Auto is hit, so it tracks the active template.
    function autoColors() {
      const fg = getTemplateFg();
      return { question: fg, chart: fg };
    }

    // Single source of truth for the chart label color.
    window.__kkChartFontColor = localStorage.getItem(C_KEY) || autoColors().chart;

    // Bump Chart.defaults so anything reading defaults picks up the color.
    if (window.Chart && Chart.defaults) {
      Chart.defaults.color = window.__kkChartFontColor;
    }

    function applyQuestionColor(color) {
      if (qTextEl) qTextEl.style.color = color || "";
    }

    function forceChartColors(chart) {
      if (!chart || !chart.options) return;
      const c = window.__kkChartFontColor || autoColors().chart;

      // Scales: only touch existing scale objects, never create new ones.
      const scales = chart.options.scales;
      if (scales && typeof scales === "object") {
        Object.keys(scales).forEach((key) => {
          const s = scales[key];
          if (!s || typeof s !== "object") return;
          if (s.ticks && typeof s.ticks === "object") s.ticks.color = c;
          if (s.title && typeof s.title === "object") s.title.color = c;
          if (s.pointLabels && typeof s.pointLabels === "object") s.pointLabels.color = c;
        });
      }

      // Plugins: only touch existing plugin config; don't create legend/title/subtitle
      // objects, since their mere presence can change Chart.js rendering.
      const p = chart.options.plugins;
      if (p && typeof p === "object") {
        if (p.legend && p.legend.labels && typeof p.legend.labels === "object") {
          p.legend.labels.color = c;
        }
        if (p.title && typeof p.title === "object") p.title.color = c;
        if (p.subtitle && typeof p.subtitle === "object") p.subtitle.color = c;
      }

      chart.$kkChartFontColor = c;
    }

    function applyChartColor(color) {
      const c = color || autoColors().chart;
      window.__kkChartFontColor = c;
      if (wrap) wrap.style.setProperty("--kk-chart-font-color", c);
      if (window.Chart && Chart.defaults) Chart.defaults.color = c;

      // Force the live chart to pick up the change immediately.
      try {
        const ch = chartHolder && chartHolder.chart;
        if (ch) {
          forceChartColors(ch);
          ch.update("none");
        }
      } catch (e) { /* ignore */ }
    }

    // Register the global plugin that re-applies colors on every chart.
    if (window.Chart && Chart.register) {
      const already =
        Chart.registry &&
        Chart.registry.plugins &&
        typeof Chart.registry.plugins.get === "function" &&
        Chart.registry.plugins.get("kkFontColors");
      if (!already) {
        Chart.register({
          id: "kkFontColors",
          beforeUpdate(chart) {
            try { forceChartColors(chart); } catch (e) {}
          },
        });
      }
    }

    // Restore from storage.
    const qSaved = localStorage.getItem(Q_KEY);
    const cSaved = localStorage.getItem(C_KEY);

    if (qSaved) {
      if (qInput) qInput.value = qSaved;
      applyQuestionColor(qSaved);
    } else {
      // Sync the picker to the live template default for nicer UX.
      if (qInput) qInput.value = autoColors().question;
      applyQuestionColor("");
    }
    if (cSaved) {
      if (cInput) cInput.value = cSaved;
      applyChartColor(cSaved);
    } else {
      const auto = autoColors().chart;
      if (cInput) cInput.value = auto;
      applyChartColor(auto);
    }

    if (qInput) {
      qInput.addEventListener("input", () => {
        localStorage.setItem(Q_KEY, qInput.value);
        applyQuestionColor(qInput.value);
      });
    }
    if (cInput) {
      cInput.addEventListener("input", () => {
        localStorage.setItem(C_KEY, cInput.value);
        applyChartColor(cInput.value);
      });
    }
    if (qReset) {
      qReset.addEventListener("click", () => {
        localStorage.removeItem(Q_KEY);
        const auto = autoColors().question;
        if (qInput) qInput.value = auto;
        // Clear inline color so the template's CSS cascade wins.
        applyQuestionColor("");
      });
    }
    if (cReset) {
      cReset.addEventListener("click", () => {
        localStorage.removeItem(C_KEY);
        const auto = autoColors().chart;
        if (cInput) cInput.value = auto;
        applyChartColor(auto);
      });
    }
  })();

  // ─────────────────────────────────────────────────────────────
  // Chart.js plugin: draw participant counts on top of each value.
  // Works for bar (vertical + horizontal), pie, and doughnut charts.
  // Color follows the chart-font-color setting.
  // ─────────────────────────────────────────────────────────────
  (function registerCountPlugin() {
    if (typeof window.Chart === "undefined" || !Chart.register) return;
    if (Chart.registry && Chart.registry.plugins && Chart.registry.plugins.get && Chart.registry.plugins.get("kkCountLabels")) return;

    const plugin = {
      id: "kkCountLabels",
      afterDatasetsDraw(chart) {
        const { ctx, data } = chart;
        if (!ctx || !data || !Array.isArray(data.datasets)) return;

        const fontColor = chart.$kkChartFontColor
          || (document.getElementById("chart-wrap") && document.getElementById("chart-wrap").style.getPropertyValue("--kk-chart-font-color"))
          || "#ffffff";

        ctx.save();
        ctx.font = "700 14px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        data.datasets.forEach((ds, di) => {
          const meta = chart.getDatasetMeta(di);
          if (!meta || meta.hidden) return;

          const type = (meta.type || chart.config.type || "").toLowerCase();
          // Only annotate types where counts make sense.
          if (type !== "bar" && type !== "pie" && type !== "doughnut" && type !== "polarArea" && type !== "polararea") return;

          const arr = Array.isArray(ds.data) ? ds.data : [];

          arr.forEach((rawVal, i) => {
            const val = Number(rawVal) || 0;
            if (val <= 0) return;                  // skip zero counts
            const el = meta.data[i];
            if (!el) return;
            const pos = el.tooltipPosition ? el.tooltipPosition() : { x: el.x, y: el.y };
            if (!pos || typeof pos.x !== "number") return;

            const text = String(Math.round(val));

            let x = pos.x;
            let y = pos.y;

            if (type === "bar") {
              // Detect orientation: horizontal bar has indexAxis=y.
              const idxAxis = (chart.options && chart.options.indexAxis) || "x";
              if (idxAxis === "y") {
                // Horizontal: put count to the right of the bar end.
                x = (el.x || pos.x) + 10;
                y = pos.y;
                ctx.textAlign = "left";
              } else {
                // Vertical: put count above the top of the bar.
                x = pos.x;
                y = (el.y || pos.y) - 10;
                ctx.textAlign = "center";
              }
            } else if (type === "pie" || type === "doughnut") {
              // tooltipPosition gives the slice center — perfect.
              ctx.textAlign = "center";
            } else {
              ctx.textAlign = "center";
            }

            // Pill background for legibility on busy scenery.
            const padX = 6, padY = 3;
            const w = ctx.measureText(text).width;
            const h = 14;
            const rx = ctx.textAlign === "left" ? x - padX : x - w / 2 - padX;
            const ry = y - h / 2 - padY;
            const rw = w + padX * 2;
            const rh = h + padY * 2;

            ctx.fillStyle = "rgba(0,0,0,.55)";
            const r = 8;
            ctx.beginPath();
            ctx.moveTo(rx + r, ry);
            ctx.lineTo(rx + rw - r, ry);
            ctx.quadraticCurveTo(rx + rw, ry, rx + rw, ry + r);
            ctx.lineTo(rx + rw, ry + rh - r);
            ctx.quadraticCurveTo(rx + rw, ry + rh, rx + rw - r, ry + rh);
            ctx.lineTo(rx + r, ry + rh);
            ctx.quadraticCurveTo(rx, ry + rh, rx, ry + rh - r);
            ctx.lineTo(rx, ry + r);
            ctx.quadraticCurveTo(rx, ry, rx + r, ry);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle = fontColor || "#fff";
            ctx.fillText(text, x, y);
          });
        });

        ctx.restore();
      },
    };

    Chart.register(plugin);
  })();

  // ─────────────────────────────────────────────────────────────
  // Chart background opacity slider
  // The veil element matches the page background color. Its opacity
  // is (1 - bgOpacity), so the slider effectively fades the scenery.
  // ─────────────────────────────────────────────────────────────
  (function setupChartBgOpacity() {
    const slider = document.getElementById("chart-bg-opacity");
    const label  = document.getElementById("chart-bg-opacity-value");
    const wrap   = document.getElementById("chart-wrap");
    if (!slider || !wrap) return;

    const KEY = "kk-chart-bg-opacity";
    const stored = Number(localStorage.getItem(KEY));
    const initial = Number.isFinite(stored) && stored >= 0 && stored <= 100 ? stored : 100;

    function apply(percent) {
      const p = Math.max(0, Math.min(100, Number(percent) || 0));
      const veilOpacity = (100 - p) / 100;   // 100% → veil 0 (full scene); 0% → veil 1 (hidden scene)
      wrap.style.setProperty("--kk-chart-bg-veil-opacity", String(veilOpacity));
      if (label) label.textContent = p + "%";
      slider.value = String(p);
      localStorage.setItem(KEY, String(p));
    }

    apply(initial);
    slider.addEventListener("input", () => apply(slider.value));
  })();

  // ─────────────────────────────────────────────────────────────
  // Magnifying lens
  // Toggle with #btn-lens. When active, follow the cursor over the
  // chart wrapper and draw a magnified copy of the live chart canvas
  // into the lens canvas.
  // ─────────────────────────────────────────────────────────────
  (function setupLens() {
    const wrap       = document.getElementById("chart-wrap");
    const lensEl     = document.getElementById("kk-lens");
    const lensCanvas = document.getElementById("kk-lens-canvas");
    const lensBadge  = document.getElementById("kk-lens-badge");
    const btn        = document.getElementById("btn-lens");
    const zoomInput  = document.getElementById("lens-zoom");
    const zoomLabel  = document.getElementById("lens-zoom-value");
    const sizeInput  = document.getElementById("lens-size");
    const sizeLabel  = document.getElementById("lens-size-value");
    const liveChart  = document.getElementById("live-chart");

    if (!wrap || !lensEl || !lensCanvas || !btn || !liveChart) return;

    const ZOOM_KEY = "kk-lens-zoom";
    const SIZE_KEY = "kk-lens-size";

    const state = {
      active: false,
      zoom: Number(localStorage.getItem(ZOOM_KEY)) || 2,
      size: Number(localStorage.getItem(SIZE_KEY)) || 220,
      // Position in wrapper-local coordinates
      x: 0,
      y: 0,
      raf: 0,
    };

    const ctx = lensCanvas.getContext("2d");

    function applySize() {
      lensEl.style.width  = state.size + "px";
      lensEl.style.height = state.size + "px";
      // Backing-store size matches CSS size × DPR for crispness.
      const dpr = window.devicePixelRatio || 1;
      lensCanvas.width  = Math.round(state.size * dpr);
      lensCanvas.height = Math.round(state.size * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (sizeLabel) sizeLabel.textContent = String(state.size);
      if (sizeInput) sizeInput.value = String(state.size);
    }

    function applyZoom() {
      if (lensBadge) lensBadge.textContent = state.zoom + "x";
      if (zoomLabel) zoomLabel.textContent = state.zoom + "x";
      if (zoomInput) zoomInput.value = String(state.zoom);
    }

    function render() {
      state.raf = 0;
      if (!state.active) return;

      // Source: the live-chart canvas. Map wrapper coords → chart coords.
      const wrapRect  = wrap.getBoundingClientRect();
      const chartRect = liveChart.getBoundingClientRect();

      // Cursor position in chart-canvas CSS pixels.
      const cssX = (state.x + wrapRect.left) - chartRect.left;
      const cssY = (state.y + wrapRect.top)  - chartRect.top;

      // Convert CSS → backing-store pixels of the source canvas.
      const sxScale = liveChart.width  / chartRect.width;
      const syScale = liveChart.height / chartRect.height;

      const srcW = state.size / state.zoom;
      const srcH = state.size / state.zoom;
      const sx = (cssX - srcW / 2) * sxScale;
      const sy = (cssY - srcH / 2) * syScale;
      const sw = srcW * sxScale;
      const sh = srcH * syScale;

      // Clear and draw.
      ctx.clearRect(0, 0, state.size, state.size);

      // Soft backdrop so empty/transparent regions are visible.
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(0, 0, state.size, state.size);

      try {
        ctx.drawImage(liveChart, sx, sy, sw, sh, 0, 0, state.size, state.size);
      } catch (err) {
        // drawImage can throw if the canvas is 0-sized; ignore.
      }

      // Position the lens (centered on cursor, clamped to wrapper).
      const half = state.size / 2;
      const maxX = wrapRect.width  - half;
      const maxY = wrapRect.height - half;
      const px = Math.max(half, Math.min(maxX, state.x));
      const py = Math.max(half, Math.min(maxY, state.y));
      lensEl.style.left = px + "px";
      lensEl.style.top  = py + "px";
    }

    function schedule() {
      if (state.raf) return;
      state.raf = requestAnimationFrame(render);
    }

    function onMove(e) {
      const r = wrap.getBoundingClientRect();
      state.x = e.clientX - r.left;
      state.y = e.clientY - r.top;
      schedule();
    }

    function onLeave() {
      if (!state.active) return;
      // Park it in the center but keep it visible while active.
      const r = wrap.getBoundingClientRect();
      state.x = r.width / 2;
      state.y = r.height / 2;
      schedule();
    }

    function activate() {
      state.active = true;
      lensEl.style.display = "block";
      wrap.classList.add("is-lens");
      btn.classList.add("is-active-lens");
      wrap.addEventListener("mousemove", onMove);
      wrap.addEventListener("mouseleave", onLeave);
      // Initial render in the middle of the wrapper.
      const r = wrap.getBoundingClientRect();
      state.x = r.width / 2;
      state.y = r.height / 2;
      schedule();
    }

    function deactivate() {
      state.active = false;
      lensEl.style.display = "none";
      wrap.classList.remove("is-lens");
      btn.classList.remove("is-active-lens");
      wrap.removeEventListener("mousemove", onMove);
      wrap.removeEventListener("mouseleave", onLeave);
      if (state.raf) {
        cancelAnimationFrame(state.raf);
        state.raf = 0;
      }
    }

    btn.addEventListener("click", () => {
      if (state.active) deactivate(); else activate();
    });

    if (zoomInput) {
      zoomInput.addEventListener("input", () => {
        state.zoom = Number(zoomInput.value) || 2;
        localStorage.setItem(ZOOM_KEY, String(state.zoom));
        applyZoom();
        if (state.active) schedule();
      });
    }

    if (sizeInput) {
      sizeInput.addEventListener("input", () => {
        state.size = Number(sizeInput.value) || 220;
        localStorage.setItem(SIZE_KEY, String(state.size));
        applySize();
        if (state.active) schedule();
      });
    }

    // Keep lens fresh when the chart redraws or window resizes.
    window.addEventListener("resize", () => { if (state.active) schedule(); });

    applySize();
    applyZoom();
  })();

})();