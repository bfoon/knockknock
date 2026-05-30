/* Participant client (Knock-Knock).
 *
 * Handles BOTH poll & game participant flows.
 *
 * REFRESH RESILIENCE
 * ──────────────────
 * Per-session, we persist {uid, nickname, avatar_id} in localStorage. On page
 * load, if both nickname + avatar are present, we auto-connect immediately and
 * skip the nickname picker. The server then sends a personalised `state` with
 * `my_answer`, `my_score`, `my_avatar`, `my_nickname`, and `tally` — which we
 * use to restore the locked-in tile, score chip, and live chart.
 *
 * ANIMATED AVATARS
 * ────────────────
 * Every avatar carries a CSS keyframe name in `window.kkAvatarsById[id].anim`.
 * We apply `.kk-anim-<name>` to:
 *   - the self-avatar bubble in the header (#self-avatar-emoji)
 *   - the big waiting-room avatar (#wait-avatar)
 *   - the avatar shown inside each avatar-picker tile
 *
 * SYNCHRONIZED TIMER (NEW)
 * ────────────────────────
 * The server stamps every question's `question_started_at` and broadcasts it in
 * `state`. Each client computes its clock skew once (server_time_ms − local_now)
 * and uses it to figure out the EXACT seconds left on every tick. This means:
 *   - Every participant + presenter see the same number ticking down.
 *   - A refresh resumes the timer where it is right now (not from full).
 *   - Presenter "+5s / +10s" updates `time_extension_seconds`; clients pick it
 *     up via the next `state` and the timer extends in real time.
 *   - On expiry, an extra answer attempt is gracefully rejected by the server
 *     via {type: "answer_rejected", reason: "deadline"} unless the quiz allows
 *     late answers.
 */
(function () {
  const root = document.getElementById("play");
  const code = root.dataset.code;
  const kind = root.dataset.kind;    // "poll" | "game"
  const mode = root.dataset.mode;    // "orchestra" | "open"

  const stepNick     = document.getElementById("step-nick");
  const stepWait     = document.getElementById("step-wait");
  const stepQuestion = document.getElementById("step-question");
  const stepEnded    = document.getElementById("step-ended");

  const qText     = document.getElementById("q-text");
  const qProgress = document.getElementById("q-progress");
  const qBody     = document.getElementById("q-body");           // polls
  const qActions  = document.getElementById("q-actions");        // pinned submit slot
  const tiles     = document.getElementById("tiles");            // games
  const qResult   = document.getElementById("q-result");
  const scoreChip = document.getElementById("score-chip");
  const timerChip = document.getElementById("timer-chip");
  const selfNext  = document.getElementById("self-next");
  const selfBack  = document.getElementById("self-back");
  const selfNav   = document.getElementById("self-nav");
  const waitNick  = document.getElementById("wait-nick");
  const waitAvatar = document.getElementById("wait-avatar");
  const roomTag   = document.getElementById("room-tag");
  const finalScore = document.getElementById("final-score");
  const myChartCanvas = document.getElementById("my-chart");
  const finalEmojiButtons = document.getElementById("final-emoji-buttons");
  const playerEndEmojiLayer = document.getElementById("player-end-emoji-layer");

  // Self-avatar header bits
  const selfAvatarEmoji = document.getElementById("self-avatar-emoji");
  const selfAvatarName  = document.getElementById("self-avatar-name");
  const selfAvatarScore = document.getElementById("self-avatar-score");

  // ── Persisted identity (per-session in localStorage) ─────────────
  const KEY_UID    = "kk-uid";
  const KEY_NICK   = `kk-nick:${code}`;
  const KEY_AVATAR = `kk-avatar:${code}`;

  let ws = null;
  let uid = localStorage.getItem(KEY_UID)
        || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
  localStorage.setItem(KEY_UID, uid);

  let nickname = localStorage.getItem(KEY_NICK) || "";
  let avatarId = localStorage.getItem(KEY_AVATAR) || "dragon";

  let myScore = 0;
  let myIndex = -1;
  let answeredQuestionId = null;
  let myChoiceId = null;          // chosen choice for current question (for re-highlight)
  let questionReceivedAt = 0;
  let timerInterval = null;
  let myChart = null;
  let lastTally = null;
  let currentQuestion = null;

  // ── Server-synchronized timer state ──────────────────────────────
  // Filled from every `state` payload. clockSkewMs is positive when the
  // server clock is ahead of ours; we add it to Date.now() to convert
  // local time to "server time".
  let clockSkewMs           = 0;
  let qStartedAtMs          = null; // server epoch ms when current question started
  let qTimeLimit            = 0;    // seconds
  let qExtension            = 0;    // seconds (presenter additions)
  let allowLateAnswers      = false;
  let lateAnswerPointsPct   = 0;
  let deadlinePassedLocally = false;

  // Correct-answer reveal state. The answer key is requested only after the
  // server-synchronised countdown reaches 0. The server still validates the
  // real deadline before broadcasting the answer key.
  let revealRequestQuestionId = null;
  let revealRetryTimer = null;
  let revealedQuestionId = null;
  let latestCorrectAnswer = null;

  function totalQuestionSeconds() {
    return Math.max(0, Number(qTimeLimit || 0) + Math.max(0, Number(qExtension || 0)));
  }

  function currentSecondsLeft() {
    if (!qStartedAtMs) return totalQuestionSeconds();
    const serverNow = Date.now() + clockSkewMs;
    const deadline = qStartedAtMs + totalQuestionSeconds() * 1000;
    return Math.max(0, Math.ceil((deadline - serverNow) / 1000));
  }

  function canAnswerCurrentGameQuestion() {
    return allowLateAnswers || currentSecondsLeft() > 0;
  }

  function markSpecialGameAnswered(questionId, choiceId) {
    answeredQuestionId = questionId;
    if (choiceId != null) myChoiceId = choiceId;
  }

  function syncSpecialGameInputs() {
    if (kind !== "game" || !tiles || !currentQuestion) return;
    if (answeredQuestionId === currentQuestion.id) return;
    const canAnswer = canAnswerCurrentGameQuestion();
    tiles.querySelectorAll("button").forEach(b => { b.disabled = !canAnswer; });
    if (canAnswer && qResult && /Time|late|Too late/i.test(qResult.textContent || "")) {
      qResult.style.display = "none";
    }
  }

  window.kkGameQuestionCanAnswer = canAnswerCurrentGameQuestion;
  window.kkMarkSpecialGameAnswered = markSpecialGameAnswered;
  window.kkSyncSpecialGameInputs = syncSpecialGameInputs;

  function show(el) {
    [stepNick, stepWait, stepQuestion, stepEnded].forEach(s => s && (s.style.display = "none"));
    el.style.display = "block";
  }

  // ─────────────────────── Avatar lookup ───────────────────────
  function avatarObj(id) {
    if (window.kkAvatarsById && window.kkAvatarsById[id]) return window.kkAvatarsById[id];
    return { id, emoji: avatarEmojiFallback(id), label: id, anim: "kk-float" };
  }
  function avatarEmoji(id) { return avatarObj(id).emoji || "👤"; }
  function avatarAnim(id)  { return avatarObj(id).anim  || "kk-float"; }

  function applyAnimClass(el, animName) {
    if (!el) return;
    [...el.classList].forEach(c => { if (c.startsWith("kk-anim-")) el.classList.remove(c); });
    if (animName) el.classList.add("kk-anim-" + animName);
  }

  function updateHeaderAvatar() {
    if (selfAvatarEmoji) {
      selfAvatarEmoji.textContent = avatarEmoji(avatarId);
      applyAnimClass(selfAvatarEmoji, avatarAnim(avatarId));
    }
    if (selfAvatarName) selfAvatarName.textContent = nickname || "—";
    if (selfAvatarScore) {
      selfAvatarScore.textContent = `${myScore} pts`;
      selfAvatarScore.style.display = kind === "game" ? "" : "none";
    }
    const header = document.getElementById("self-avatar");
    if (header) header.style.display = (nickname ? "" : "none");
  }

  // ─────────────────────── Avatar picker (games) ───────────────────────
  const avatarGrid = document.getElementById("avatar-grid");
  if (avatarGrid) {
    avatarGrid.querySelectorAll(".kk-avatar-tile").forEach(tile => {
      const id = tile.dataset.avatarId;
      applyAnimClass(tile, avatarAnim(id));
      if (id === avatarId) tile.classList.add("selected");
    });
    avatarGrid.addEventListener("click", (e) => {
      const tile = e.target.closest(".kk-avatar-tile");
      if (!tile) return;
      avatarGrid.querySelectorAll(".kk-avatar-tile").forEach(t => t.classList.remove("selected"));
      tile.classList.add("selected");
      avatarId = tile.dataset.avatarId;
    });
  }

  // ─────────────────────── Join flow ───────────────────────
  const nickGo = document.getElementById("nick-go");
  const nickInput = document.getElementById("nick-input");
  if (nickInput) nickInput.value = nickname;

  if (nickGo) {
    nickGo.addEventListener("click", () => {
      const v = nickInput.value.trim();
      if (!v) { nickInput.focus(); return; }
      nickname = v.slice(0, 40);
      localStorage.setItem(KEY_NICK, nickname);
      localStorage.setItem(KEY_AVATAR, avatarId);
      connect();
    });
  }
  if (nickInput) {
    nickInput.addEventListener("keydown", e => {
      if (e.key === "Enter") nickGo && nickGo.click();
    });
  }

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws/session/${code}/`);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        type: "hello", role: "participant",
        uid, nickname, avatar_id: avatarId,
      }));
      if (waitNick) waitNick.textContent = nickname;
      if (waitAvatar && kind === "game") {
        waitAvatar.textContent = avatarEmoji(avatarId);
        applyAnimClass(waitAvatar, avatarAnim(avatarId));
      }
      updateHeaderAvatar();
      show(stepWait);
    });
    ws.addEventListener("message", (e) => handle(JSON.parse(e.data)));
    ws.addEventListener("close", () => {
      setTimeout(() => { if (!ws || ws.readyState === 3) connect(); }, 2500);
    });
  }

  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  // ── Self-pace (open mode) navigation ──
  // Driven entirely by the server's per-participant flags on each state:
  //   can_self_advance → show the Back/Next row
  //   index            → disable Back on the first slide
  // This replaces the old "reveal Next only after answering" logic so a
  // participant can also skip ahead without answering (open mode is self-paced).
  function setSelfNav(s) {
    const canPace = !!(s && s.can_self_advance);
    if (selfNav) {
      selfNav.style.setProperty("display", canPace ? "flex" : "none", "important");
    } else if (selfNext) {
      // Fallback for older markup without the nav wrapper.
      selfNext.style.display = canPace ? "block" : "none";
    }
    if (selfBack) selfBack.disabled = (Number(s && s.index) || 0) <= 0;
  }

  function requestCorrectAnswerReveal(delayMs) {
    if (kind !== "game" || !currentQuestion || !currentQuestion.id) return;

    const questionId = currentQuestion.id;
    const doSend = () => {
      // Do not spam the socket, but allow one immediate request and one retry
      // in case the local clock hits 0 a fraction before the server deadline.
      revealRequestQuestionId = questionId;
      send({ type: "reveal_answer", question_id: questionId });
    };

    if (delayMs && delayMs > 0) {
      clearTimeout(revealRetryTimer);
      revealRetryTimer = setTimeout(doSend, delayMs);
    } else if (revealRequestQuestionId !== questionId) {
      doSend();
      clearTimeout(revealRetryTimer);
      revealRetryTimer = setTimeout(doSend, 850);
    }
  }

  function handle(msg) {
    switch (msg.type) {
      case "state":            onState(msg); break;
      case "tally":            onTally(msg); break;
      case "answer_ack":       onAnswerAck(msg); break;
      case "answer_rejected":  onAnswerRejected(msg); break;
      case "correct_answer":   onCorrectAnswerReveal(msg); break;
      case "ended":            onEnded(); break;
      case "self_finished":    onSelfFinished(msg); break;
      case "replay":           location.reload(); break;
    }
  }

  function onSelfFinished(msg) {
    // Open mode: this participant walked past the last slide. Show the end
    // card (the same one used when the session ends) and hide the nav.
    if (selfNav) selfNav.style.setProperty("display", "none", "important");
    else if (selfNext) selfNext.style.display = "none";
    onEnded();
  }

  // ─────────────────────── State / question rendering ───────────────────────
  function onState(s) {
    // ── Sync clock skew from server (do this BEFORE anything that uses it) ──
    if (typeof s.server_time_ms === "number") {
      clockSkewMs = s.server_time_ms - Date.now();
    }
    // ── Stash timer + policy fields from server ──
    qStartedAtMs        = (typeof s.question_started_at_ms === "number") ? s.question_started_at_ms : null;
    qExtension          = Number(s.time_extension_seconds || 0);
    allowLateAnswers    = !!s.allow_late_answers;
    lateAnswerPointsPct = Number(s.late_answer_points_pct || 0);

    // Adopt server-side identity if richer than ours (refresh case)
    if (s.my_nickname) { nickname = s.my_nickname; localStorage.setItem(KEY_NICK, nickname); }
    if (s.my_avatar)   { avatarId = s.my_avatar;   localStorage.setItem(KEY_AVATAR, avatarId); }
    if (typeof s.my_score === "number") myScore = s.my_score;
    updateHeaderAvatar();

    if (scoreChip && kind === "game") {
      scoreChip.style.display = "inline-block";
      scoreChip.textContent = `${myScore} pts`;
    }

    if (s.state === "lobby") { show(stepWait); return; }
    if (s.state === "ended") { onEnded(); return; }

    let q = s.question;
    if (!q) { show(stepWait); return; }

    qTimeLimit = Number(q.time_limit || 0);

    const sameQuestion = currentQuestion?.id === q.id;
    if (sameQuestion && deadlinePassedLocally && currentSecondsLeft() > 0) {
      // Presenter extended the time after the local clock had reached 0.
      deadlinePassedLocally = false;
      if (!s.my_answer && answeredQuestionId === q.id) answeredQuestionId = null;
    }

    // New question? Reset transient UI bits.
    if (currentQuestion?.id !== q.id) {
      qResult.style.display = "none";
      if (selfNav) selfNav.style.setProperty("display", "none", "important");
      else if (selfNext) selfNext.style.display = "none";
      questionReceivedAt = Date.now();
      myChoiceId = null;
      answeredQuestionId = null;
      deadlinePassedLocally = false;
      revealRequestQuestionId = null;
      revealedQuestionId = null;
      latestCorrectAnswer = null;
      clearTimeout(revealRetryTimer);
    }
    currentQuestion = q;

    qText.textContent = q.text;
    applyQuestionTypography(q);
    qProgress.textContent = `Question ${s.index + 1} / ${s.total}`;
    show(stepQuestion);

    // Self-pace nav visibility is decided by the server's per-participant
    // flags, evaluated on every state (covers open mode whether or not the
    // participant has answered yet).
    setSelfNav(s);

    if (kind === "poll") renderPollQuestion(q, s);
    else                 renderGameQuestion(q, s);

    // Restore previous answer if the server tells us we already answered.
    // For polls the per-type renderer above has already handled restoration
    // from `s.my_answer`, so we only need the legacy restore for games.
    if (s.my_answer && kind === "game") {
      restoreMyAnswer(q, s.my_answer);
    } else if (kind === "game") {
      syncSpecialGameInputs();
    } else if (kind === "poll" && s.my_answer) {
      // Renderers also lock+toast, but make absolutely sure the chip shows.
      answeredQuestionId = q.id;
      if (mode === "open") { if (selfNav) selfNav.style.setProperty("display","flex","important"); else if (selfNext) selfNext.style.display = "block"; }
    }

    // Cache + draw tally chart (if applicable).
    lastTally = s.tally || null;
    drawMyChart(q, lastTally);
  }

  // Apply per-question typography (font family/size/bold).
  const FONT_STACK = {
    default: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    clash:   '"Clash Display", system-ui, sans-serif',
    space:   '"Space Grotesk", system-ui, sans-serif',
    serif:   '"Playfair Display", Georgia, serif',
    mono:    '"JetBrains Mono", ui-monospace, monospace',
    comic:   '"Comic Neue", "Comic Sans MS", cursive',
    press:   '"Press Start 2P", system-ui, monospace',
  };
  function applyQuestionTypography(q) {
    if (!qText) return;
    const fam  = FONT_STACK[q.font_family] || FONT_STACK.default;
    const size = Math.max(14, Math.min(72, Number(q.font_size) || 28));
    const bold = q.font_bold === false ? "500" : "800";
    qText.style.fontFamily = fam;
    qText.style.fontSize   = size + "px";
    qText.style.fontWeight = bold;
    if (q.font_family === "press") qText.style.lineHeight = "1.4";
    else qText.style.lineHeight = "";
  }

  function getScaleChoices(q) {
    if (Array.isArray(q && q.choices) && q.choices.length) {
      return q.choices.map(c => ({
        id: c.id,
        text: c.text ?? String(c.value ?? c.id),
        value: Number(c.value ?? c.id),
      })).filter(c => Number.isFinite(c.value));
    }

    const cfg = (q && q.config) || {};
    let min = Number(q?.scale_min ?? cfg.scale_min ?? cfg.min ?? 1);
    let max = Number(q?.scale_max ?? cfg.scale_max ?? cfg.max ?? 10);
    if (!Number.isFinite(min)) min = 1;
    if (!Number.isFinite(max)) max = 10;
    min = Math.max(1, Math.min(10, Math.trunc(min)));
    max = Math.max(2, Math.min(10, Math.trunc(max)));
    if (min >= max) { min = 1; max = 10; }

    const rows = [];
    for (let i = min; i <= max; i++) rows.push({ id: i, text: String(i), value: i });
    return rows;
  }

  function isChoicePollType(q) {
    return [
      "mcq", "ranking", "yes_no", "likert", "image_choice", "reaction"
    ].includes(q && q.type);
  }

  // ─────────────────────────────────────────────────────────────────────
  // Poll rendering — per-type renderer registry
  // ─────────────────────────────────────────────────────────────────────
  //
  // Every poll question type has its own renderer that knows how to:
  //   • paint the input UI into #q-body
  //   • collect + send an answer over the WebSocket
  //   • restore the prior answer when the server says we already answered
  //
  // The registry is consulted by renderPollQuestion(q, s). Each renderer
  // function receives (q, restore) where `restore` is either null or the
  // server-supplied my_answer object.
  //
  // After a successful submit we set `answeredQuestionId = q.id` and lock
  // the UI so the participant can't double-submit. The "Submitted ✓"
  // toast (from showResult) is used everywhere so the experience is
  // consistent across types.

  function lockSubmitted() {
    qBody.querySelectorAll("button, input, textarea, select").forEach(el => {
      el.disabled = true;
    });
    qBody.querySelectorAll("[data-kk-input]").forEach(el => {
      el.setAttribute("aria-disabled", "true");
      el.style.pointerEvents = "none";
      el.style.opacity = "0.85";
    });
    // Hide the pinned submit button(s); the "Submitted ✓" toast in #q-result
    // is enough confirmation and we free up the screen.
    if (qActions) {
      qActions.querySelectorAll("button, input, textarea, select").forEach(el => {
        el.disabled = true;
      });
      qActions.style.display = "none";
    }
  }

  function markAnswered(q) {
    answeredQuestionId = q.id;
    showResult("Submitted ✓");
    if (mode === "open") { if (selfNav) selfNav.style.setProperty("display","flex","important"); else if (selfNext) selfNext.style.display = "block"; }
  }

  function renderPollQuestion(q, s) {
    qBody.innerHTML = "";
    if (qActions) {
      qActions.innerHTML = "";
      qActions.style.display = "";
    }
    const restore = (s && s.my_answer) || null;
    const renderer = POLL_RENDERERS[q.type] || POLL_RENDERERS.__fallback__;
    try {
      renderer(q, restore);
    } catch (err) {
      console.error("Renderer failed for type", q.type, err);
      POLL_RENDERERS.__fallback__(q, restore);
    }
  }

  // ── Shared helpers ──────────────────────────────────────────────────
  function makePrimaryButton(label) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kk-btn kk-btn-primary kk-btn-lg w-100 mt-3";
    btn.textContent = label || "Submit";
    return btn;
  }

  function makeHint(text) {
    const p = document.createElement("p");
    p.className = "text-secondary small text-center mt-3 mb-0";
    p.textContent = text;
    return p;
  }

  function makeError(text) {
    const p = document.createElement("p");
    p.className = "small text-center mt-2 mb-0";
    p.style.color = "#fb7185";
    p.textContent = text;
    return p;
  }

  // ── Renderer registry ───────────────────────────────────────────────
  const POLL_RENDERERS = {};

  // ── Fallback ────────────────────────────────────────────────────────
  POLL_RENDERERS.__fallback__ = function (q) {
    qBody.innerHTML = `<div class="text-secondary text-center py-3">
      This question type (<code>${escapeHtml(q.type || "?")}</code>) isn't supported on the participant screen yet.
    </div>`;
  };

  // ── MCQ + Yes/No + Likert + Image-choice ────────────────────────────
  // Single or multi-select depending on max_selections.
  function renderChoiceQuestion(q, restore, opts) {
    opts = opts || {};
    const cfg = q.config || {};
    const maxSel = Number(q.max_selections || cfg.max_selections || 1) || 1;
    const minSel = Number(q.min_selections || cfg.min_selections || 1) || 1;
    const isMulti = maxSel > 1 || (q.type === "mcq" && minSel > 1);
    const useImageTiles = q.type === "image_choice" || opts.imageTiles;

    const wrap = document.createElement("div");
    wrap.className = useImageTiles ? "kk-image-grid" : "kk-choice-list";
    qBody.appendChild(wrap);

    const picked = new Set();
    const restoreIds = new Set();
    if (restore) {
      if (Array.isArray(restore.choice_ids)) {
        restore.choice_ids.forEach(id => restoreIds.add(String(id)));
      } else if (restore.choice_id != null) {
        restoreIds.add(String(restore.choice_id));
      }
    }

    (q.choices || []).forEach(c => {
      const btn = document.createElement("button");
      btn.className = useImageTiles ? "kk-image-tile" : "kk-choice";
      btn.type = "button";
      btn.dataset.choiceId = c.id;

      const imgUrl = c.image_url || c.image;
      if (useImageTiles) {
        btn.innerHTML = `
          <div class="kk-image-tile-img">
            ${imgUrl
              ? `<img src="${escapeAttr(imgUrl)}" alt="">`
              : `<div class="kk-image-tile-placeholder">🖼️</div>`}
          </div>
          <div class="kk-image-tile-text">${escapeHtml(c.text)}</div>`;
      } else if (imgUrl) {
        btn.innerHTML = `<img src="${escapeAttr(imgUrl)}" alt="" style="width:42px;height:42px;object-fit:cover;border-radius:10px;margin-right:.5rem;"><span>${escapeHtml(c.text)}</span>`;
      } else {
        btn.textContent = c.text;
      }

      if (restoreIds.has(String(c.id))) {
        btn.classList.add("picked");
        picked.add(String(c.id));
      }

      btn.addEventListener("click", () => {
        if (answeredQuestionId === q.id) return;
        const id = String(c.id);
        if (!isMulti) {
          // Single-select — submit immediately.
          myChoiceId = c.id;
          wrap.querySelectorAll(".picked").forEach(el => el.classList.remove("picked"));
          btn.classList.add("picked");
          send({ type: "answer", question_id: q.id, choice_id: c.id });
          lockSubmitted();
          markAnswered(q);
          return;
        }
        // Multi-select — toggle and require submit click.
        if (picked.has(id)) {
          picked.delete(id);
          btn.classList.remove("picked");
        } else {
          if (picked.size >= maxSel) {
            errLine.textContent = `You can pick at most ${maxSel}.`;
            return;
          }
          picked.add(id);
          btn.classList.add("picked");
        }
        errLine.textContent = "";
      });

      wrap.appendChild(btn);
    });

    const errLine = makeError("");
    qBody.appendChild(errLine);

    if (isMulti) {
      const submit = makePrimaryButton(`Submit ${maxSel > 1 ? "selections" : "answer"}`);
      submit.addEventListener("click", () => {
        if (answeredQuestionId === q.id) return;
        if (picked.size < minSel) {
          errLine.textContent = `Please pick at least ${minSel}.`;
          return;
        }
        const ids = Array.from(picked).map(s => Number(s) || s);
        send({ type: "answer", question_id: q.id, choice_ids: ids });
        myChoiceId = ids[0];
        lockSubmitted();
        submit.style.display = "none";
        markAnswered(q);
      });
      qActions.appendChild(submit);
      qBody.appendChild(makeHint(
        minSel === maxSel
          ? `Pick exactly ${minSel}.`
          : `Pick ${minSel}–${maxSel}.`
      ));
    }

    if (restore) {
      lockSubmitted();
      answeredQuestionId = q.id;
    }
  }

  POLL_RENDERERS.mcq          = (q, r) => renderChoiceQuestion(q, r);
  POLL_RENDERERS.yes_no       = (q, r) => renderChoiceQuestion(q, r);
  POLL_RENDERERS.likert       = (q, r) => renderChoiceQuestion(q, r);
  POLL_RENDERERS.image_choice = (q, r) => renderChoiceQuestion(q, r, { imageTiles: true });

  // ── Word cloud + Open text ──────────────────────────────────────────
  function renderTextQuestion(q, restore, opts) {
    opts = opts || {};
    const isWord = opts.word === true;
    const input = document.createElement(isWord ? "input" : "textarea");
    input.className = "form-control form-control-lg";
    input.placeholder = isWord ? "Type one or two words…" : "Type your answer…";
    input.setAttribute("data-kk-input", "1");
    if (isWord) input.maxLength = 30;
    else        input.rows = 5;

    if (restore && restore.text) input.value = restore.text;

    qBody.appendChild(input);

    const btn = makePrimaryButton("Submit");
    btn.addEventListener("click", () => {
      if (answeredQuestionId === q.id) return;
      const text = (input.value || "").trim();
      if (!text) { input.focus(); return; }
      send({ type: "answer", question_id: q.id, text });
      lockSubmitted();
      markAnswered(q);
    });
    qActions.appendChild(btn);
    if (!restore) input.focus();
    else { lockSubmitted(); answeredQuestionId = q.id; }
  }
  POLL_RENDERERS.word = (q, r) => renderTextQuestion(q, r, { word: true });
  POLL_RENDERERS.open = (q, r) => renderTextQuestion(q, r, { word: false });

  // ── Scale (1–10 buttons) ────────────────────────────────────────────
  POLL_RENDERERS.scale = function (q, restore) {
    const wrap = document.createElement("div");
    wrap.className = "kk-scale-row";
    qBody.appendChild(wrap);

    const restoreVal = restore && restore.value != null ? Number(restore.value) : null;

    getScaleChoices(q).forEach(choice => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "kk-choice kk-scale-btn";
      b.textContent = String(choice.text);
      b.dataset.value = choice.value;
      b.dataset.choiceId = choice.id;

      if (restoreVal != null && Number(choice.value) === restoreVal) {
        b.classList.add("picked");
      }

      b.addEventListener("click", () => {
        if (answeredQuestionId === q.id) return;
        myChoiceId = choice.value;
        wrap.querySelectorAll(".picked").forEach(el => el.classList.remove("picked"));
        b.classList.add("picked");
        send({ type: "answer", question_id: q.id, value: choice.value });
        lockSubmitted();
        markAnswered(q);
      });
      wrap.appendChild(b);
    });

    if (restore) { lockSubmitted(); answeredQuestionId = q.id; }
  };

  // ── Star rating ─────────────────────────────────────────────────────
  POLL_RENDERERS.rating = function (q, restore) {
    const cfg = q.config || {};
    const max = Math.max(1, Math.min(10, Number(cfg.max_stars || q.scale_max || 5)));
    const wrap = document.createElement("div");
    wrap.className = "kk-stars";
    wrap.setAttribute("data-kk-input", "1");
    qBody.appendChild(wrap);

    const label = document.createElement("div");
    label.className = "kk-stars-label";
    label.textContent = "Tap a star to rate";
    qBody.appendChild(label);

    let currentVal = restore && restore.value != null ? Number(restore.value) : 0;

    function paint(val) {
      wrap.querySelectorAll(".kk-star").forEach((s, i) => {
        s.classList.toggle("filled", i < val);
      });
      label.textContent = val > 0 ? `Your rating: ${val} / ${max}` : "Tap a star to rate";
    }

    for (let i = 1; i <= max; i++) {
      const s = document.createElement("button");
      s.type = "button";
      s.className = "kk-star";
      s.dataset.value = i;
      s.innerHTML = "★";
      s.addEventListener("click", () => {
        if (answeredQuestionId === q.id) return;
        currentVal = i;
        paint(i);
      });
      wrap.appendChild(s);
    }
    paint(currentVal);

    const btn = makePrimaryButton("Submit rating");
    btn.addEventListener("click", () => {
      if (answeredQuestionId === q.id) return;
      if (!currentVal) { label.textContent = "Please pick a rating first."; return; }
      send({ type: "answer", question_id: q.id, value: currentVal });
      lockSubmitted();
      markAnswered(q);
    });
    qActions.appendChild(btn);
    if (restore) { lockSubmitted(); answeredQuestionId = q.id; }
  };

  // ── NPS (0–10) ──────────────────────────────────────────────────────
  POLL_RENDERERS.nps = function (q, restore) {
    const wrap = document.createElement("div");
    wrap.className = "kk-nps-row";
    qBody.appendChild(wrap);

    const restoreVal = restore && restore.value != null ? Number(restore.value) : null;
    let selected = restoreVal;

    for (let i = 0; i <= 10; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "kk-nps-btn";
      if (i <= 6)      b.classList.add("detractor");
      else if (i <= 8) b.classList.add("passive");
      else             b.classList.add("promoter");
      b.textContent = String(i);
      b.dataset.value = i;
      if (restoreVal === i) b.classList.add("picked");
      b.addEventListener("click", () => {
        if (answeredQuestionId === q.id) return;
        selected = i;
        wrap.querySelectorAll(".picked").forEach(el => el.classList.remove("picked"));
        b.classList.add("picked");
      });
      wrap.appendChild(b);
    }

    const legend = document.createElement("div");
    legend.className = "kk-nps-legend";
    legend.innerHTML = `<span>Not at all likely</span><span>Extremely likely</span>`;
    qBody.appendChild(legend);

    const btn = makePrimaryButton("Submit");
    btn.addEventListener("click", () => {
      if (answeredQuestionId === q.id) return;
      if (selected == null) return;
      send({ type: "answer", question_id: q.id, value: selected });
      lockSubmitted();
      markAnswered(q);
    });
    qActions.appendChild(btn);
    if (restore) { lockSubmitted(); answeredQuestionId = q.id; }
  };

  // ── Slider ──────────────────────────────────────────────────────────
  POLL_RENDERERS.slider = function (q, restore) {
    const cfg = q.config || {};
    const min  = Number(cfg.min  ?? q.scale_min ?? 0);
    const max  = Number(cfg.max  ?? q.scale_max ?? 100);
    const step = Number(cfg.step ?? 1);
    const unit = String(cfg.unit ?? "");

    const start = restore && restore.value != null
      ? Number(restore.value)
      : Math.round((min + max) / 2);

    const display = document.createElement("div");
    display.className = "kk-slider-display";
    display.textContent = `${start}${unit}`;
    qBody.appendChild(display);

    const input = document.createElement("input");
    input.type = "range";
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = start;
    input.className = "kk-slider";
    qBody.appendChild(input);

    const limits = document.createElement("div");
    limits.className = "kk-slider-limits";
    limits.innerHTML = `<span>${min}${unit}</span><span>${max}${unit}</span>`;
    qBody.appendChild(limits);

    input.addEventListener("input", () => {
      display.textContent = `${input.value}${unit}`;
    });

    const btn = makePrimaryButton("Submit");
    btn.addEventListener("click", () => {
      if (answeredQuestionId === q.id) return;
      send({ type: "answer", question_id: q.id, value: Number(input.value) });
      lockSubmitted();
      markAnswered(q);
    });
    qActions.appendChild(btn);
    if (restore) { lockSubmitted(); answeredQuestionId = q.id; }
  };

  // ── Numeric input ───────────────────────────────────────────────────
  POLL_RENDERERS.numeric = function (q, restore) {
    const cfg = q.config || {};
    const decimals = Math.max(0, Math.min(6, Number(cfg.decimals || 0)));

    const input = document.createElement("input");
    input.type = "number";
    input.className = "form-control form-control-lg";
    input.setAttribute("data-kk-input", "1");
    if (cfg.min != null) input.min = cfg.min;
    if (cfg.max != null) input.max = cfg.max;
    input.step = decimals > 0 ? Math.pow(10, -decimals) : 1;
    input.placeholder = "Enter a number…";
    if (restore && restore.value != null) input.value = restore.value;
    qBody.appendChild(input);

    const err = makeError("");
    qBody.appendChild(err);

    const btn = makePrimaryButton("Submit");
    btn.addEventListener("click", () => {
      if (answeredQuestionId === q.id) return;
      const v = input.value;
      if (v === "" || isNaN(Number(v))) {
        err.textContent = "Please enter a number.";
        return;
      }
      const num = Number(v);
      if (cfg.min != null && num < Number(cfg.min)) { err.textContent = `Min ${cfg.min}.`; return; }
      if (cfg.max != null && num > Number(cfg.max)) { err.textContent = `Max ${cfg.max}.`; return; }
      send({ type: "answer", question_id: q.id, value: num });
      lockSubmitted();
      markAnswered(q);
    });
    qActions.appendChild(btn);
    if (!restore) input.focus();
    else { lockSubmitted(); answeredQuestionId = q.id; }
  };

  // ── Date / Time / Datetime ──────────────────────────────────────────
  function renderDateLikeQuestion(q, restore, htmlType) {
    const input = document.createElement("input");
    input.type = htmlType;
    input.className = "form-control form-control-lg";
    input.setAttribute("data-kk-input", "1");
    const cfg = q.config || {};
    if (cfg.min) input.min = cfg.min;
    if (cfg.max) input.max = cfg.max;

    if (restore && restore.text) input.value = restore.text;
    qBody.appendChild(input);

    const err = makeError("");
    qBody.appendChild(err);

    const btn = makePrimaryButton("Submit");
    btn.addEventListener("click", () => {
      if (answeredQuestionId === q.id) return;
      const v = input.value;
      if (!v) { err.textContent = "Please pick a value."; return; }
      send({ type: "answer", question_id: q.id, text: v, datetime_kind: htmlType });
      lockSubmitted();
      markAnswered(q);
    });
    qActions.appendChild(btn);
    if (restore) { lockSubmitted(); answeredQuestionId = q.id; }
  }
  POLL_RENDERERS.date     = (q, r) => renderDateLikeQuestion(q, r, "date");
  POLL_RENDERERS.datetime = (q, r) => renderDateLikeQuestion(q, r, "datetime-local");
  POLL_RENDERERS.time     = (q, r) => renderDateLikeQuestion(q, r, "time");

  // ── File upload (image/file) ────────────────────────────────────────
  // We upload as a base64 data URL through the websocket. Server-side
  // saves it to Response.file_value. We cap size by config.max_size_mb.
  POLL_RENDERERS.file_upload = function (q, restore) {
    const cfg = q.config || {};
    const maxMb = Number(cfg.max_size_mb || 10);
    const accept = String(cfg.accept || "image/*");

    const input = document.createElement("input");
    input.type = "file";
    input.className = "form-control form-control-lg";
    input.accept = accept;
    qBody.appendChild(input);

    const preview = document.createElement("div");
    preview.className = "kk-file-preview";
    qBody.appendChild(preview);

    const err = makeError("");
    qBody.appendChild(err);

    let dataUrl = null;
    let filename = "";
    let mime = "";

    input.addEventListener("change", () => {
      err.textContent = "";
      preview.innerHTML = "";
      const file = input.files && input.files[0];
      if (!file) return;
      if (file.size > maxMb * 1024 * 1024) {
        err.textContent = `File is too large (max ${maxMb} MB).`;
        input.value = "";
        return;
      }
      filename = file.name;
      mime = file.type || "application/octet-stream";
      const reader = new FileReader();
      reader.onload = () => {
        dataUrl = reader.result;
        if (mime.startsWith("image/")) {
          preview.innerHTML = `<img src="${escapeAttr(dataUrl)}" alt="">`;
        } else {
          preview.innerHTML = `<div class="kk-file-chip">📎 ${escapeHtml(filename)}</div>`;
        }
      };
      reader.readAsDataURL(file);
    });

    const btn = makePrimaryButton("Submit");
    btn.addEventListener("click", () => {
      if (answeredQuestionId === q.id) return;
      if (!dataUrl) { err.textContent = "Please pick a file first."; return; }
      send({
        type: "answer",
        question_id: q.id,
        file: { data_url: dataUrl, filename, mime },
      });
      lockSubmitted();
      markAnswered(q);
    });
    qActions.appendChild(btn);
    if (restore && restore.file_url) {
      preview.innerHTML = `<img src="${escapeAttr(restore.file_url)}" alt="">`;
      lockSubmitted();
      answeredQuestionId = q.id;
    }
  };

  // ── Pin on image ────────────────────────────────────────────────────
  // Stored as (x, y) percentages of image dimensions.
  POLL_RENDERERS.pin_image = function (q, restore) {
    const imageUrl = q.image_url || (q.config && q.config.image_url) || "";
    if (!imageUrl) {
      qBody.innerHTML = `<div class="text-secondary text-center py-3">
        This pin-on-image question has no background image set.</div>`;
      return;
    }

    const stage = document.createElement("div");
    stage.className = "kk-pin-stage";
    stage.setAttribute("data-kk-input", "1");
    stage.innerHTML = `<img src="${escapeAttr(imageUrl)}" alt="" draggable="false">`;
    qBody.appendChild(stage);

    let pin = null;
    let xPct = restore && restore.x != null ? Number(restore.x) : null;
    let yPct = restore && restore.y != null ? Number(restore.y) : null;

    function placePin(x, y) {
      if (!pin) {
        pin = document.createElement("div");
        pin.className = "kk-pin";
        stage.appendChild(pin);
      }
      pin.style.left = x + "%";
      pin.style.top  = y + "%";
    }

    if (xPct != null && yPct != null) placePin(xPct, yPct);

    stage.addEventListener("click", (e) => {
      if (answeredQuestionId === q.id) return;
      const rect = stage.getBoundingClientRect();
      xPct = ((e.clientX - rect.left) / rect.width) * 100;
      yPct = ((e.clientY - rect.top)  / rect.height) * 100;
      xPct = Math.max(0, Math.min(100, xPct));
      yPct = Math.max(0, Math.min(100, yPct));
      placePin(xPct, yPct);
    });

    qBody.appendChild(makeHint("Tap the image to drop a pin, then submit."));

    const btn = makePrimaryButton("Submit pin");
    btn.addEventListener("click", () => {
      if (answeredQuestionId === q.id) return;
      if (xPct == null || yPct == null) return;
      send({ type: "answer", question_id: q.id, x: xPct, y: yPct });
      lockSubmitted();
      markAnswered(q);
    });
    qActions.appendChild(btn);
    if (restore) { lockSubmitted(); answeredQuestionId = q.id; }
  };

  // ── Pin on map (lat/lng input fallback) ─────────────────────────────
  // We avoid a heavy maps library on participants; instead, an interactive
  // grid lets users drop a pin onto a placeholder world. lat/lng are linearly
  // mapped from a 360×180 rectangle. If you wire in Leaflet later, swap this
  // renderer out and keep the `x`/`y` payload shape.
  POLL_RENDERERS.pin_map = function (q, restore) {
    const stage = document.createElement("div");
    stage.className = "kk-pin-stage kk-pin-map";
    stage.setAttribute("data-kk-input", "1");
    stage.innerHTML = `
      <div class="kk-pin-map-grid"></div>
      <div class="kk-pin-map-labels">
        <span class="kk-pin-map-eq">Equator</span>
        <span class="kk-pin-map-pm">Prime meridian</span>
      </div>`;
    qBody.appendChild(stage);

    let pin = null;
    let lat = restore && restore.y != null ? Number(restore.y) : null;
    let lng = restore && restore.x != null ? Number(restore.x) : null;

    const readout = document.createElement("div");
    readout.className = "kk-pin-map-readout";
    readout.textContent = (lat != null && lng != null)
      ? `Lat ${lat.toFixed(2)}, Lng ${lng.toFixed(2)}`
      : "Tap the map to drop a pin";
    qBody.appendChild(readout);

    function placePin(xPct, yPct) {
      if (!pin) {
        pin = document.createElement("div");
        pin.className = "kk-pin";
        stage.appendChild(pin);
      }
      pin.style.left = xPct + "%";
      pin.style.top  = yPct + "%";
    }

    if (lat != null && lng != null) {
      const xPct = ((lng + 180) / 360) * 100;
      const yPct = ((90 - lat)  / 180) * 100;
      placePin(xPct, yPct);
    }

    stage.addEventListener("click", (e) => {
      if (answeredQuestionId === q.id) return;
      const rect = stage.getBoundingClientRect();
      const xPct = ((e.clientX - rect.left) / rect.width)  * 100;
      const yPct = ((e.clientY - rect.top)  / rect.height) * 100;
      lng = (xPct / 100) * 360 - 180;
      lat = 90 - (yPct / 100) * 180;
      placePin(xPct, yPct);
      readout.textContent = `Lat ${lat.toFixed(2)}, Lng ${lng.toFixed(2)}`;
    });

    const btn = makePrimaryButton("Submit pin");
    btn.addEventListener("click", () => {
      if (answeredQuestionId === q.id) return;
      if (lat == null || lng == null) return;
      send({ type: "answer", question_id: q.id, x: lng, y: lat });
      lockSubmitted();
      markAnswered(q);
    });
    qActions.appendChild(btn);
    if (restore) { lockSubmitted(); answeredQuestionId = q.id; }
  };

  // ── Two-by-two matrix (place on X/Y grid) ───────────────────────────
  // Coordinates normalized to -1..1 on both axes.
  POLL_RENDERERS.two_by_two = function (q, restore) {
    const cfg = q.config || {};
    const xL = cfg.x_left   || "Low";
    const xR = cfg.x_right  || "High";
    const yT = cfg.y_top    || "High";
    const yB = cfg.y_bottom || "Low";

    const stage = document.createElement("div");
    stage.className = "kk-2x2-stage";
    stage.setAttribute("data-kk-input", "1");
    stage.innerHTML = `
      <div class="kk-2x2-axis-x"></div>
      <div class="kk-2x2-axis-y"></div>
      <div class="kk-2x2-label kk-2x2-label-top">${escapeHtml(yT)}</div>
      <div class="kk-2x2-label kk-2x2-label-bottom">${escapeHtml(yB)}</div>
      <div class="kk-2x2-label kk-2x2-label-left">${escapeHtml(xL)}</div>
      <div class="kk-2x2-label kk-2x2-label-right">${escapeHtml(xR)}</div>`;
    qBody.appendChild(stage);

    let dot = null;
    let xVal = restore && restore.x != null ? Number(restore.x) : null;
    let yVal = restore && restore.y != null ? Number(restore.y) : null;

    function placeDot(xPct, yPct) {
      if (!dot) {
        dot = document.createElement("div");
        dot.className = "kk-2x2-dot";
        stage.appendChild(dot);
      }
      dot.style.left = xPct + "%";
      dot.style.top  = yPct + "%";
    }

    if (xVal != null && yVal != null) {
      const xPct = ((xVal + 1) / 2) * 100;
      const yPct = ((1 - yVal) / 2) * 100;
      placeDot(xPct, yPct);
    }

    stage.addEventListener("click", (e) => {
      if (answeredQuestionId === q.id) return;
      const rect = stage.getBoundingClientRect();
      const xPct = ((e.clientX - rect.left) / rect.width)  * 100;
      const yPct = ((e.clientY - rect.top)  / rect.height) * 100;
      xVal = (xPct / 100) * 2 - 1;
      yVal = 1 - (yPct / 100) * 2;
      placeDot(xPct, yPct);
    });

    qBody.appendChild(makeHint("Tap to place your point on the grid, then submit."));

    const btn = makePrimaryButton("Submit");
    btn.addEventListener("click", () => {
      if (answeredQuestionId === q.id) return;
      if (xVal == null || yVal == null) return;
      send({ type: "answer", question_id: q.id, x: xVal, y: yVal });
      lockSubmitted();
      markAnswered(q);
    });
    qActions.appendChild(btn);
    if (restore) { lockSubmitted(); answeredQuestionId = q.id; }
  };

  // ── Ranking ─────────────────────────────────────────────────────────
  // Tap-to-rank: each tap moves the next item into the next rank slot.
  // Up/down arrows let participants fine-tune the order before submit.
  //
  // Live auto-save: every reorder (arrow tap or drag) broadcasts the
  // current order to the server, debounced ~280ms. The server's ranking
  // handler deletes prior rows and rewrites them, so re-submitting is safe.
  // This means the presenter chart updates as participants sort, without
  // them having to tap "Submit". The explicit "Submit ranking" button
  // remains as a final confirmation (locks the UI).
  POLL_RENDERERS.ranking = function (q, restore) {
    if (!Array.isArray(q.choices) || !q.choices.length) {
      qBody.innerHTML = `<div class="text-secondary text-center py-3">No items to rank.</div>`;
      return;
    }

    // Build the working order. If we have a restore, honour it.
    let items = q.choices.slice();
    if (restore && Array.isArray(restore.choice_ids) && restore.choice_ids.length) {
      const byId = new Map(items.map(c => [String(c.id), c]));
      const rest = restore.choice_ids
        .map(id => byId.get(String(id)))
        .filter(Boolean);
      const left = items.filter(c => !restore.choice_ids.some(id => String(id) === String(c.id)));
      items = rest.concat(left);
    }

    const intro = document.createElement("p");
    intro.className = "text-secondary small mb-2";
    intro.textContent = "Drag the ☰ handle, or tap ▲ / ▼ to rearrange. #1 is your favourite — your order saves automatically.";
    qBody.appendChild(intro);

    // Live-save indicator. Sits just above the list and fades between
    // "Saving…" and "Saved ✓" so participants know their drag is being
    // recorded without them needing to press Submit.
    const liveStatus = document.createElement("div");
    liveStatus.className = "kk-rank-status";
    liveStatus.setAttribute("aria-live", "polite");
    liveStatus.innerHTML = `<span class="kk-rank-status-dot"></span><span class="kk-rank-status-text">Saved ✓</span>`;
    liveStatus.dataset.state = "idle";
    qBody.appendChild(liveStatus);

    const list = document.createElement("ol");
    list.className = "kk-rank-list";
    qBody.appendChild(list);

    // ── Auto-save plumbing ─────────────────────────────────────────────
    // Debounce: collapse a flurry of drag reorders into a single send.
    // 280ms feels instant on a fast network and saves bandwidth on slow ones.
    let autoSaveTimer = null;
    let autoSaveGen = 0; // increments per call so we can ignore stale "Saved" states

    function setStatus(state) {
      // States: idle | dirty | saving | saved
      liveStatus.dataset.state = state;
      const textEl = liveStatus.querySelector(".kk-rank-status-text");
      if (!textEl) return;
      if (state === "saving") textEl.textContent = "Saving…";
      else if (state === "saved") textEl.textContent = "Saved ✓";
      else if (state === "dirty") textEl.textContent = "Saving…";
      else textEl.textContent = "Saved ✓";
    }

    function scheduleAutoSave() {
      // Already locked (user hit Submit)? Don't auto-save anymore.
      if (answeredQuestionId === q.id) return;
      setStatus("dirty");
      const myGen = ++autoSaveGen;
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => {
        // If another reorder happened during the wait, an earlier scheduled
        // save will already have been superseded by a fresh one; guard so we
        // don't flash "Saved" then "Saving" out of order.
        if (myGen !== autoSaveGen) return;
        setStatus("saving");
        const ordered_ids = items.map(c => c.id);
        send({ type: "answer", question_id: q.id, ordered_ids });
        // We don't get a per-message ack today, so optimistic-assume
        // success after a short delay — matches the rest of the app's UX.
        setTimeout(() => {
          if (myGen === autoSaveGen) setStatus("saved");
        }, 220);
      }, 280);
    }

    function buildItem(c, idx) {
      const li = document.createElement("li");
      li.className = "kk-rank-item";
      li.dataset.choiceId = c.id;
      li.innerHTML = `
        <span class="kk-rank-handle" aria-label="Drag to reorder">☰</span>
        <span class="kk-rank-num">${idx + 1}</span>
        <span class="kk-rank-text">${escapeHtml(c.text)}</span>
        <span class="kk-rank-ctrls">
          <button type="button" class="kk-rank-up"   aria-label="Move up"   ${idx === 0 ? "disabled" : ""}>▲</button>
          <button type="button" class="kk-rank-down" aria-label="Move down" ${idx === items.length - 1 ? "disabled" : ""}>▼</button>
        </span>`;
      return li;
    }

    // Render the list from `items` and animate any item that changed
    // position. We compute each li's previous bounding box, mutate the DOM,
    // then translate each li from its old position to its new one with
    // CSS transitions — this gives the satisfying "snap" feel on every
    // arrow tap and reorder.
    function render(animate) {
      const before = new Map();
      Array.from(list.children).forEach(li => {
        before.set(li.dataset.choiceId, li.getBoundingClientRect());
      });

      list.innerHTML = "";
      items.forEach((c, idx) => list.appendChild(buildItem(c, idx)));

      if (animate !== false) {
        // FLIP animation: position newly-rendered items from their old spot.
        Array.from(list.children).forEach(li => {
          const oldRect = before.get(li.dataset.choiceId);
          if (!oldRect) return;
          const newRect = li.getBoundingClientRect();
          const dy = oldRect.top - newRect.top;
          if (dy === 0) return;
          li.style.transition = "none";
          li.style.transform = `translateY(${dy}px)`;
          // Force reflow, then animate back.
          // eslint-disable-next-line no-unused-expressions
          li.offsetHeight;
          li.style.transition = "transform .22s cubic-bezier(.4,.0,.2,1)";
          li.style.transform = "";
        });
      }
    }

    function move(from, to) {
      if (to < 0 || to >= items.length || from === to) return;
      const [m] = items.splice(from, 1);
      items.splice(to, 0, m);
      render(true);
      scheduleAutoSave();
    }

    // ── Arrow-button taps (event delegation; render() recreates DOM each
    //    reorder so a captured `li` reference would be stale). ─────────
    list.addEventListener("click", (e) => {
      if (answeredQuestionId === q.id) return;
      const li = e.target.closest("li.kk-rank-item");
      if (!li) return;
      const idx = Array.from(list.children).indexOf(li);
      if (e.target.closest(".kk-rank-up"))   move(idx, idx - 1);
      if (e.target.closest(".kk-rank-down")) move(idx, idx + 1);
    });

    // ── Pointer-event drag (works on touch, mouse, and stylus). ───────
    // Only drags started on the .kk-rank-handle element are accepted, so
    // taps elsewhere on the row (text, arrows) don't start a drag.
    let drag = null;

    function clearDragStyles() {
      if (!drag) return;
      const { ghost, didReorder } = drag;
      if (ghost) ghost.remove();
      Array.from(list.children).forEach(li => {
        li.classList.remove("is-shifted", "is-source");
        li.style.transform = "";
        li.style.transition = "";
      });
      document.body.style.userSelect = "";
      document.body.style.overflow = "";
      list.style.touchAction = "";
      drag = null;
      // Only auto-save once at end of drag if order actually changed during
      // the drag. We already auto-save live inside pointermove, but we add
      // a final flush here so even a fast drag with a single repositioning
      // gets a guaranteed save when the finger lifts.
      if (didReorder) scheduleAutoSave();
    }

    list.addEventListener("pointerdown", (e) => {
      if (answeredQuestionId === q.id) return;
      const handle = e.target.closest(".kk-rank-handle");
      if (!handle) return;
      const li = handle.closest("li.kk-rank-item");
      if (!li) return;

      e.preventDefault();
      const rect = li.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();

      // Build a floating ghost that follows the pointer.
      const ghost = li.cloneNode(true);
      ghost.classList.add("kk-rank-ghost");
      ghost.style.width = rect.width + "px";
      ghost.style.height = rect.height + "px";
      ghost.style.left = (rect.left - listRect.left) + "px";
      ghost.style.top  = (rect.top  - listRect.top)  + "px";
      list.appendChild(ghost);

      li.classList.add("is-source");

      // Prevent the page from scrolling while dragging on touch devices.
      document.body.style.userSelect = "none";
      document.body.style.overflow = "hidden";
      list.style.touchAction = "none";

      drag = {
        pointerId: e.pointerId,
        ghost,
        sourceLi: li,
        startY: e.clientY,
        offsetY: e.clientY - rect.top,
        listOriginY: listRect.top,
        rowHeight: rect.height,
        fromIdx: Array.from(list.children).indexOf(li),
        didReorder: false,
      };
      try { list.setPointerCapture(e.pointerId); } catch (_) {}
    });

    list.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      e.preventDefault();
      const listRect = list.getBoundingClientRect();
      // Position the ghost.
      const gy = e.clientY - listRect.top - drag.offsetY;
      drag.ghost.style.top = gy + "px";

      // Decide which slot the ghost is currently hovering over.
      const lis = Array.from(list.children).filter(el => !el.classList.contains("kk-rank-ghost"));
      let hoverIdx = lis.length - 1;
      for (let i = 0; i < lis.length; i++) {
        const r = lis[i].getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { hoverIdx = i; break; }
      }
      // Reorder live so the user sees snapping during the drag.
      const fromIdx = items.findIndex(c => String(c.id) === drag.sourceLi.dataset.choiceId);
      if (fromIdx !== -1 && hoverIdx !== fromIdx) {
        const [m] = items.splice(fromIdx, 1);
        items.splice(hoverIdx, 0, m);
        drag.didReorder = true;
        // Re-render but DON'T animate the source row (it's hidden under the ghost).
        const ghostHtmlSnapshot = drag.ghost.outerHTML;
        render(true);
        // Re-mark the new source row + re-insert the ghost element (since
        // innerHTML was wiped).
        const newSource = list.querySelector(`li[data-choice-id="${drag.sourceLi.dataset.choiceId}"]`);
        if (newSource) {
          newSource.classList.add("is-source");
          drag.sourceLi = newSource;
        }
        // Restore the floating ghost.
        const tmp = document.createElement("div");
        tmp.innerHTML = ghostHtmlSnapshot;
        const newGhost = tmp.firstElementChild;
        list.appendChild(newGhost);
        drag.ghost = newGhost;
        // Keep the ghost positioned where the pointer is.
        const lr2 = list.getBoundingClientRect();
        drag.ghost.style.top = (e.clientY - lr2.top - drag.offsetY) + "px";
        // Schedule a debounced save right now so the presenter chart starts
        // updating mid-drag (not just when the finger lifts). Debounce
        // coalesces fast cross-row drags into one network call.
        scheduleAutoSave();
      }
    });

    function endDrag(e) {
      if (!drag) return;
      if (e && e.pointerId !== drag.pointerId) return;
      try { list.releasePointerCapture(drag.pointerId); } catch (_) {}
      clearDragStyles();
    }
    list.addEventListener("pointerup",     endDrag);
    list.addEventListener("pointercancel", endDrag);
    // Note: we deliberately don't end on pointerleave — with setPointerCapture
    // events keep flowing even when the finger moves outside the list bounds.

    render(false);

    // Auto-save the initial order *immediately* (no debounce) — this gives
    // the presenter a baseline tally as soon as the participant lands on
    // the question, even if they don't reorder anything. If we don't, the
    // tally for this question stays at 0 until someone touches the list.
    if (!restore) {
      // Tiny defer so the WebSocket has settled and we don't race the
      // question-start ack.
      setTimeout(() => {
        if (answeredQuestionId === q.id) return; // already locked? skip
        send({ type: "answer", question_id: q.id, ordered_ids: items.map(c => c.id) });
        setStatus("saved");
      }, 120);
    }

    const btn = makePrimaryButton("Submit ranking");
    btn.addEventListener("click", () => {
      if (answeredQuestionId === q.id) return;
      // Cancel any pending debounced save and send the final order now.
      clearTimeout(autoSaveTimer);
      autoSaveGen++;
      setStatus("saving");
      const ordered_ids = items.map(c => c.id);
      send({ type: "answer", question_id: q.id, ordered_ids });
      lockSubmitted();
      markAnswered(q);
    });
    qActions.appendChild(btn);
    if (restore) { lockSubmitted(); answeredQuestionId = q.id; }
  };

  // ── Matrix (rate each row on the same scale) ────────────────────────
  POLL_RENDERERS.matrix = function (q, restore) {
    const cfg = q.config || {};
    const sMin = Number(cfg.scale_min || 1);
    const sMax = Number(cfg.scale_max || 5);
    const labels = Array.isArray(cfg.scale_labels) ? cfg.scale_labels : null;
    const rows = Array.isArray(q.matrix_rows) ? q.matrix_rows : [];

    if (!rows.length) {
      qBody.innerHTML = `<div class="text-secondary text-center py-3">This matrix question has no rows.</div>`;
      return;
    }

    // restore: { matrix: { row_id: numeric_value, ... } }
    const selections = {};
    if (restore && restore.matrix && typeof restore.matrix === "object") {
      Object.entries(restore.matrix).forEach(([k, v]) => {
        selections[String(k)] = Number(v);
      });
    }

    const table = document.createElement("div");
    table.className = "kk-matrix";
    table.style.setProperty("--matrix-cols", String(sMax - sMin + 1));

    // Header row of numeric labels.
    const head = document.createElement("div");
    head.className = "kk-matrix-head";
    head.innerHTML = `<div class="kk-matrix-rowlabel"></div>`;
    for (let v = sMin; v <= sMax; v++) {
      const cell = document.createElement("div");
      cell.className = "kk-matrix-headcell";
      cell.textContent = (labels && labels[v - sMin]) ? labels[v - sMin] : String(v);
      head.appendChild(cell);
    }
    table.appendChild(head);

    rows.forEach(row => {
      const rowEl = document.createElement("div");
      rowEl.className = "kk-matrix-row";
      rowEl.dataset.rowId = row.id;

      const lab = document.createElement("div");
      lab.className = "kk-matrix-rowlabel";
      lab.textContent = row.text;
      rowEl.appendChild(lab);

      for (let v = sMin; v <= sMax; v++) {
        const cell = document.createElement("button");
        cell.type = "button";
        cell.className = "kk-matrix-cell";
        cell.dataset.value = v;
        cell.textContent = String(v);
        if (selections[String(row.id)] === v) cell.classList.add("picked");
        cell.addEventListener("click", () => {
          if (answeredQuestionId === q.id) return;
          selections[String(row.id)] = v;
          rowEl.querySelectorAll(".kk-matrix-cell").forEach(c => c.classList.remove("picked"));
          cell.classList.add("picked");
        });
        rowEl.appendChild(cell);
      }

      table.appendChild(rowEl);
    });

    qBody.appendChild(table);

    const err = makeError("");
    qBody.appendChild(err);

    const btn = makePrimaryButton("Submit");
    btn.addEventListener("click", () => {
      if (answeredQuestionId === q.id) return;
      const missing = rows.find(r => !(String(r.id) in selections));
      if (missing) { err.textContent = `Please rate every row.`; return; }
      send({ type: "answer", question_id: q.id, matrix: selections });
      lockSubmitted();
      markAnswered(q);
    });
    qActions.appendChild(btn);
    if (restore && Object.keys(selections).length === rows.length) {
      lockSubmitted(); answeredQuestionId = q.id;
    }
  };

  // ── Points allocation (distribute N points across choices) ──────────
  POLL_RENDERERS.points_allocation = function (q, restore) {
    const cfg = q.config || {};
    const total = Number(cfg.total || cfg.points_total || 100);
    if (!Array.isArray(q.choices) || !q.choices.length) {
      qBody.innerHTML = `<div class="text-secondary text-center py-3">No choices to allocate.</div>`;
      return;
    }

    const values = {};
    if (restore && restore.points && typeof restore.points === "object") {
      Object.entries(restore.points).forEach(([k, v]) => { values[String(k)] = Number(v) || 0; });
    } else {
      q.choices.forEach(c => { values[String(c.id)] = 0; });
    }

    const summary = document.createElement("div");
    summary.className = "kk-points-summary";
    qBody.appendChild(summary);

    function paintSummary() {
      const spent = Object.values(values).reduce((a, b) => a + Number(b || 0), 0);
      const left = total - spent;
      summary.innerHTML = `
        <span>Used: <strong>${spent}</strong></span>
        <span>Remaining: <strong>${left}</strong> / ${total}</span>`;
      summary.classList.toggle("over", spent > total);
    }

    const list = document.createElement("div");
    list.className = "kk-points-list";
    qBody.appendChild(list);

    q.choices.forEach(c => {
      const row = document.createElement("div");
      row.className = "kk-points-row";
      row.innerHTML = `
        <div class="kk-points-label">${escapeHtml(c.text)}</div>
        <div class="kk-points-ctrls">
          <button type="button" class="kk-points-dec" aria-label="Decrease">−</button>
          <input type="number" inputmode="numeric" min="0" max="${total}" value="${values[String(c.id)]}" class="kk-points-input">
          <button type="button" class="kk-points-inc" aria-label="Increase">+</button>
        </div>`;
      const input = row.querySelector("input");

      function clampInto(v) {
        let n = parseInt(v, 10);
        if (isNaN(n) || n < 0) n = 0;
        if (n > total) n = total;
        values[String(c.id)] = n;
        input.value = n;
        paintSummary();
      }

      row.querySelector(".kk-points-dec").addEventListener("click", () => {
        if (answeredQuestionId === q.id) return;
        clampInto(Number(input.value || 0) - 1);
      });
      row.querySelector(".kk-points-inc").addEventListener("click", () => {
        if (answeredQuestionId === q.id) return;
        clampInto(Number(input.value || 0) + 1);
      });
      input.addEventListener("input", () => {
        if (answeredQuestionId === q.id) return;
        clampInto(input.value);
      });

      list.appendChild(row);
    });

    paintSummary();

    const err = makeError("");
    qBody.appendChild(err);

    const btn = makePrimaryButton(`Submit (${total} pts)`);
    btn.addEventListener("click", () => {
      if (answeredQuestionId === q.id) return;
      const spent = Object.values(values).reduce((a, b) => a + Number(b || 0), 0);
      if (spent !== total) {
        err.textContent = `You must use exactly ${total} points (currently ${spent}).`;
        return;
      }
      send({ type: "answer", question_id: q.id, points: values });
      lockSubmitted();
      markAnswered(q);
    });
    qActions.appendChild(btn);
    if (restore) { lockSubmitted(); answeredQuestionId = q.id; }
  };

  // ── Live reactions (ephemeral, multi-send allowed) ──────────────────
  POLL_RENDERERS.reaction = function (q) {
    const wrap = document.createElement("div");
    wrap.className = "kk-reaction-wrap";

    const choices = Array.isArray(q.choices) && q.choices.length
      ? q.choices
      : ["🔥", "❤️", "😂", "👏", "😮"].map((emoji, i) => ({ id: `fallback-${i}`, text: emoji }));

    choices.forEach(c => {
      const btn = document.createElement("button");
      btn.className = "kk-choice kk-reaction-choice";
      btn.type = "button";
      btn.dataset.choiceId = c.id;
      btn.textContent = c.text;
      btn.addEventListener("click", () => {
        myChoiceId = c.id;
        btn.classList.add("picked");
        setTimeout(() => btn.classList.remove("picked"), 220);
        send({ type: "answer", question_id: q.id, choice_id: c.id, text: c.text });
        showResult(`${c.text} Reaction sent`);
      });
      wrap.appendChild(btn);
    });

    qBody.appendChild(wrap);
    qBody.appendChild(makeHint("Tap an emoji as often as you like."));
  };

  // ── Title slide (handled by template shim, but provide stub) ────────
  POLL_RENDERERS.title = function () {
    qBody.innerHTML = `<div class="text-secondary text-center py-3">
      <i class="bi bi-info-circle"></i> Intro slide — sit tight for the next question.
    </div>`;
  };

  // ── Game rendering: kahoot-style tiles + timer ───────────────────
  // Note: picture_choice and puzzle questions are rendered by the special
  // renderer in play_game.html (it runs BEFORE play.js, intercepts the
  // question, and paints tiles itself). For those types, this function
  // just sets up the timer and skips drawing the basic MCQ tiles.
  function renderGameQuestion(q, s) {
    const qtype = q.question_type || q.type || "mcq";
    const isSpecial = (qtype === "picture_choice" || qtype === "puzzle");

    if (!isSpecial) {
      tiles.innerHTML = "";

      // If this question has a prompt image (picture_prompt type, or any
      // MCQ where the author attached an image), render it above the tiles.
      // We insert it as a sibling BEFORE #tiles so it doesn't pollute the
      // tile grid CSS but still flows with the question card.
      const imageUrl = q.image_url || q.image || "";
      // Always clear any previous prompt image first — questions advance
      // through this function and a stale image from question N-1 would
      // otherwise stick around if N has no image.
      const existing = document.getElementById("kk-game-prompt-image");
      if (existing) existing.remove();
      if (imageUrl && tiles.parentNode) {
        const wrap = document.createElement("div");
        wrap.id = "kk-game-prompt-image";
        wrap.className = "kk-game-prompt-image";
        const img = document.createElement("img");
        img.src = imageUrl;
        img.alt = "";
        wrap.appendChild(img);
        tiles.parentNode.insertBefore(wrap, tiles);
      }

      // For picture_prompt we want lettered chips (A/B/C/D) like the
      // screenshot reference, not the colourful Kahoot-style shape tiles.
      // For everything else (classic MCQ) keep the existing look.
      if (qtype === "picture_prompt") {
        const letters = ["A", "B", "C", "D", "E", "F"];
        q.choices.forEach((c, i) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "kk-pp-answer-btn";
          btn.dataset.choiceId = c.id;
          btn.innerHTML = `
            <span class="kk-pp-letter">${letters[i] || (i + 1)}</span>
            <span class="kk-pp-text">${escapeHtml(c.text || "")}</span>
          `;
          btn.addEventListener("click", () => answerGame(q, c, btn));
          tiles.appendChild(btn);
        });
      } else {
        const shapes = ["▲","◆","●","■","★","♥"];
        q.choices.forEach((c, i) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = `kk-tile-answer t${i % 4}`;
          btn.dataset.choiceId = c.id;
          btn.innerHTML = `<span class="shape">${shapes[i % shapes.length]}</span><span>${escapeHtml(c.text)}</span>`;
          btn.addEventListener("click", () => answerGame(q, c, btn));
          tiles.appendChild(btn);
        });
      }
    }

    // ── Server-synced timer ──
    // We compute remaining = (start + (limit + extension)) - serverNow,
    // where serverNow = Date.now() + clockSkewMs.
    clearInterval(timerInterval);

    function tick() {
      const remaining = currentSecondsLeft();
      if (timerChip) timerChip.textContent = `${remaining}s`;

      if (remaining <= 0) {
        // Don't run the deadline branch twice — once is enough.
        if (!deadlinePassedLocally) {
          deadlinePassedLocally = true;
          handleDeadlineExpired();
        }
        // If late answers are allowed, keep the chip alive so the player
        // can still see "0s" and still tap. Otherwise stop the timer.
        if (!allowLateAnswers) {
          clearInterval(timerInterval);
        }
      } else if (deadlinePassedLocally) {
        // Time was extended while this browser had already reached 0s.
        deadlinePassedLocally = false;
        syncSpecialGameInputs();
      }
    }

    tick();
    timerInterval = setInterval(tick, 200);
  }

  function handleDeadlineExpired() {
    if (!tiles) return;

    // Ask the server to reveal the correct answer. The server validates the
    // real deadline before broadcasting, so this is safe even if a browser
    // reaches 0 slightly early.
    requestCorrectAnswerReveal(0);

    if (!allowLateAnswers) {
      tiles.querySelectorAll("button").forEach(b => b.disabled = true);
      tiles.querySelectorAll(".kk-puzzle-tile").forEach(t => {
        t.setAttribute("aria-disabled", "true");
        t.style.pointerEvents = "none";
      });
      const submit = document.getElementById("kk-submit-puzzle");
      if (submit) submit.disabled = true;
      if (!answeredQuestionId) showResult("⏱ Time's up — revealing answer…");
    } else if (!answeredQuestionId) {
      const pct = Number(lateAnswerPointsPct || 0);
      const tail = pct > 0 ? ` (late answers worth ${pct}% of points)` : ` (no points awarded)`;
      showResult("⏱ Time's up — revealing answer" + tail);
    }
  }

  function answerGame(q, c, btn) {
    if (answeredQuestionId === q.id) return;
    answeredQuestionId = q.id;
    myChoiceId = c.id;
    btn.classList.add("picked");
    btn.style.outline = "3px solid #fff";
    tiles.querySelectorAll("button").forEach(b => b.disabled = true);
    send({ type: "answer", question_id: q.id, choice_id: c.id, question_received_at: questionReceivedAt });
    showResult("⏳ Locked in — waiting…");
  }

  function onAnswerRejected(msg) {
    // Server is the source of truth: it said our answer arrived late and
    // late answers aren't allowed. Roll the local "answered" flag back so
    // a presenter time-extension can still let us answer.
    if (msg.reason === "deadline") {
      answeredQuestionId = null;
      myChoiceId = null;
      if (tiles) tiles.querySelectorAll("button").forEach(b => {
        b.disabled = true;
        b.classList.remove("picked");
        b.style.outline = "";
      });
      qResult.innerHTML = `<div class="kk-q-pill" style="background:#dc2626;color:#fff;font-size:1rem;padding:.4rem .9rem;">⏱ Too late — answer not counted</div>`;
      qResult.style.display = "block";
    }
  }

  // ── Restore a previously made answer (after refresh) ─────────────
  function restoreMyAnswer(q, my) {
    answeredQuestionId = q.id;
    myChoiceId = my.choice_id || my.value || null;

    if (kind === "game") {
      if (tiles) tiles.querySelectorAll("button").forEach(b => {
        b.disabled = true;
        if (Number(b.dataset.choiceId) === Number(my.choice_id)) {
          b.classList.add("picked");
          b.classList.add(my.is_correct ? "correct" : "incorrect");
          b.style.outline = "3px solid #fff";
        }
      });
      const late = my.was_late ? " (late)" : "";
      const text = my.is_correct
        ? `✅ Correct! +${my.points || 0} pts${late}`
        : `❌ Not quite — score: ${myScore}${late}`;
      qResult.innerHTML = `<div class="kk-q-pill" style="background:${my.is_correct ? "#16a34a" : "#dc2626"}; color:#fff; font-size:1rem; padding:.4rem .9rem;">${text}</div>`;
      qResult.style.display = "block";
    } else {
      qBody.querySelectorAll("button").forEach(b => {
        b.disabled = true;
        if (Number(b.dataset.choiceId) === Number(my.choice_id)) b.classList.add("picked");
        if (Number(b.dataset.value)     === Number(my.value))     b.classList.add("picked");
      });
      showResult("Submitted ✓");
      if (mode === "open") { if (selfNav) selfNav.style.setProperty("display","flex","important"); else if (selfNext) selfNext.style.display = "block"; }
    }
  }

  function onAnswerAck(msg) {
    if (currentQuestion && Number(msg.question_id) === Number(currentQuestion.id)) {
      answeredQuestionId = currentQuestion.id;
    }
    myScore = msg.score || myScore;
    if (scoreChip) {
      scoreChip.style.display = "inline-block";
      scoreChip.textContent = `${myScore} pts`;
    }
    updateHeaderAvatar();
    const late = msg.was_late ? " (late)" : "";
    const text = msg.is_correct
      ? `✅ Correct! +${msg.points} pts${late}`
      : `❌ Not quite — score: ${myScore}${late}`;
    qResult.innerHTML = `<div class="kk-q-pill" style="background:${msg.is_correct ? "#16a34a" : "#dc2626"}; color:#fff; font-size:1rem; padding:.4rem .9rem;">${text}</div>`;
    qResult.style.display = "block";
    const chosen = tiles && Array.from(tiles.querySelectorAll("button")).find(b =>
      Number(b.dataset.choiceId) === Number(msg.choice_id) || b.classList.contains("picked"));
    if (chosen) chosen.classList.add(msg.is_correct ? "correct" : "incorrect");

    // Sparkle when correct (works for any answer tile type the page renders).
    if (msg.is_correct) sparkleOn(chosen);
  }

  // Lightweight sparkle burst on a correct tile.
  function sparkleOn(el) {
    if (!el) return;
    const host = document.createElement("span");
    host.className = "kk-spark-layer";
    host.setAttribute("aria-hidden", "true");
    el.appendChild(host);
    for (let i = 0; i < 10; i++) {
      const s = document.createElement("span");
      s.className = "kk-spark";
      s.style.setProperty("--dx", (Math.random() * 120 - 60).toFixed(0) + "px");
      s.style.setProperty("--dy", (-40 - Math.random() * 80).toFixed(0) + "px");
      s.style.setProperty("--delay", (Math.random() * 120).toFixed(0) + "ms");
      s.textContent = ["✨", "⭐", "💫"][i % 3];
      host.appendChild(s);
    }
    setTimeout(() => { host.remove(); }, 1400);
  }

  // ─────────────────────── Live tally chart on player ───────────────────────
  function onTally(msg) {
    if (!currentQuestion || msg.question_id !== currentQuestion.id) return;
    lastTally = msg.data || { counts: {} };
    drawMyChart(currentQuestion, lastTally);
  }

  function drawMyChart(q, tally) {
    if (!myChartCanvas || !q || !window.Chart) return;
    const counts = (tally && tally.counts) || {};
    const total = Object.values(counts).reduce((a, b) => a + Number(b || 0), 0);
    const wrap = myChartCanvas.parentElement;
    if (wrap) wrap.style.display = total > 0 ? "block" : "none";
    if (total === 0) { if (myChart) { myChart.destroy(); myChart = null; } return; }

    const answerChoices = q.type === "scale" ? getScaleChoices(q) : (Array.isArray(q.choices) ? q.choices : []);
    const labels = answerChoices.map(c => c.text);
    const values = answerChoices.map(c => Number(counts[String(c.id)] ?? counts[String(c.value)] ?? 0));
    const myIdx  = answerChoices.findIndex(c => Number(c.id) === Number(myChoiceId) || Number(c.value) === Number(myChoiceId));
    const palette = ["#7c3aed","#22d3ee","#fb7185","#fbbf24","#a3e635","#f97316"];
    const colors  = labels.map((_, i) => palette[i % palette.length]);
    const borders = labels.map((_, i) => i === myIdx ? "#fff" : "transparent");
    const widths  = labels.map((_, i) => i === myIdx ? 3 : 0);

    if (myChart) {
      myChart.data.labels = labels;
      myChart.data.datasets[0].data = values;
      myChart.data.datasets[0].backgroundColor = colors;
      myChart.data.datasets[0].borderColor = borders;
      myChart.data.datasets[0].borderWidth = widths;
      myChart.update("none");
      return;
    }
    myChart = new Chart(myChartCanvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderColor: borders,
          borderWidth: widths,
          borderRadius: 8,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#cbd5e1", font: { size: 11 } }, grid: { display: false } },
          y: { ticks: { color: "#cbd5e1", precision: 0 }, grid: { color: "rgba(255,255,255,.05)" } },
        },
        animation: { duration: 350 },
      },
    });
  }

  function onCorrectAnswerReveal(msg) {
    if (!msg || !currentQuestion) return;
    if (String(msg.question_id) !== String(currentQuestion.id)) return;

    latestCorrectAnswer = msg;
    revealedQuestionId = msg.question_id;

    const correctIds = new Set((msg.correct_choice_ids || []).map(v => String(v)));
    const correctOrder = Array.isArray(msg.correct_order) ? msg.correct_order.map(v => String(v)) : [];
    const correctChoices = Array.isArray(msg.correct_choices) ? msg.correct_choices : [];

    if (tiles) {
      // Disable further input after reveal.
      tiles.querySelectorAll("button").forEach(b => { b.disabled = true; });
      tiles.querySelectorAll(".kk-puzzle-tile").forEach(t => {
        t.setAttribute("aria-disabled", "true");
        t.style.pointerEvents = "none";
      });

      // Classic MCQ and picture-choice cards.
      tiles.querySelectorAll("[data-choice-id]").forEach(el => {
        const id = String(el.dataset.choiceId || "");
        if (!id) return;
        const picked = el.classList.contains("picked") || el.classList.contains("is-picked");
        if (correctIds.has(id)) {
          el.classList.add("correct", "is-correct");
          el.style.outline = "4px solid #22c55e";
          el.style.boxShadow = "0 0 0 4px rgba(34,197,94,.85), 0 18px 38px rgba(0,0,0,.32)";
          if (window.kkSparkleOn) window.kkSparkleOn(el);
        } else if (picked) {
          el.classList.add("incorrect", "is-incorrect");
          el.style.outline = "4px solid #ef4444";
        }
      });

      // Four-slot puzzle: highlight each slot depending on whether the tile
      // in that slot matches the server's correct order.
      const board = document.getElementById("kk-puzzle-slots");
      if (board && correctOrder.length) {
        const slots = Array.from(board.querySelectorAll(".kk-puzzle-slot"))
          .sort((a, b) => Number(a.dataset.slotPosition || 0) - Number(b.dataset.slotPosition || 0));
        slots.forEach((slot, index) => {
          const expectedId = correctOrder[index];
          const tile = slot.querySelector(".kk-puzzle-tile");
          const actualId = tile ? String(tile.dataset.choiceId || "") : "";
          if (tile && actualId === expectedId) {
            tile.classList.add("is-correct");
            slot.style.borderColor = "#22c55e";
            slot.style.boxShadow = "0 0 0 3px rgba(34,197,94,.65), inset 0 0 0 1px rgba(255,255,255,.12)";
          } else {
            slot.style.borderColor = "#ef4444";
            slot.style.boxShadow = "0 0 0 3px rgba(239,68,68,.55), inset 0 0 0 1px rgba(255,255,255,.12)";
          }
        });
      }
    }

    const qType = String(msg.question_type || currentQuestion.question_type || currentQuestion.type || "mcq");
    const correctText = correctChoices.map((c, i) => {
      const label = c.text || `Answer ${i + 1}`;
      return qType === "puzzle" ? `${i + 1}. ${escapeHtml(label)}` : escapeHtml(label);
    }).join(qType === "puzzle" ? " &nbsp; • &nbsp; " : ", ");

    const title = qType === "puzzle" ? "Correct order" : "Correct answer";
    const fallback = qType === "puzzle" ? "Check the highlighted slots." : "See the green highlight.";
    qResult.innerHTML = `<div class="kk-q-pill" style="background:#16a34a;color:#fff;font-size:1rem;padding:.55rem 1rem;line-height:1.35;white-space:normal;">✅ ${title}: ${correctText || fallback}</div>`;
    qResult.style.display = "block";
  }

  function onEnded() {
    clearInterval(timerInterval);
    if (finalScore) finalScore.textContent = myScore;
    show(stepEnded);
    spawnPlayerEndEmoji("🎉");
  }

  function spawnPlayerEndEmoji(emoji) {
    if (!playerEndEmojiLayer) return;
    const el = document.createElement("span");
    el.className = "kk-player-pop-emoji";
    el.textContent = emoji || "🎉";
    el.style.setProperty("--left", `${18 + Math.random() * 64}%`);
    el.style.setProperty("--size", `${2.4 + Math.random() * 1.4}rem`);
    playerEndEmojiLayer.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  if (finalEmojiButtons) {
    finalEmojiButtons.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-emoji]");
      if (!btn) return;
      const emoji = btn.dataset.emoji || "🎉";
      spawnPlayerEndEmoji(emoji);
      send({ type: "celebration_emoji", emoji });
    });
  }

  function showResult(text) {
    qResult.textContent = text;
    qResult.style.display = "block";
  }

  if (selfNext) {
    selfNext.addEventListener("click", () => send({ type: "self_advance", direction: "next" }));
  }
  if (selfBack) {
    selfBack.addEventListener("click", () => send({ type: "self_advance", direction: "back" }));
  }

  // ─────────────────────── helpers ───────────────────────
  function avatarEmojiFallback(id) {
    const map = {dragon:"🐉",sword:"⚔️",car:"🏎️",butterfly:"🦋",spacecraft:"🚀",
      trex:"🦖",stego:"🦕",joker:"🃏",unicorn:"🦄",wizard:"🧙",ninja:"🥷",alien:"👽",
      ghost:"👻",robot:"🤖",fox:"🦊",octopus:"🐙",shark:"🦈",tiger:"🐯",panda:"🐼",wolf:"🐺"};
    return map[id] || "👤";
  }
  function escapeHtml(s){ return (s||"").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
  function escapeAttr(s){ return escapeHtml(String(s || "")).replace(/'/g, "&#39;"); }

  // Expose sparkleOn for the special renderer (puzzle / picture choice) too.
  window.kkSparkleOn = sparkleOn;

  // ─────────────────────── Auto-reconnect on refresh ───────────────────────
  if (nickname && kind === "game") {
    if (avatarGrid) {
      avatarGrid.querySelectorAll(".kk-avatar-tile").forEach(t => {
        t.classList.toggle("selected", t.dataset.avatarId === avatarId);
      });
    }
    connect();
  } else if (nickname && kind === "poll") {
    connect();
  } else {
    updateHeaderAvatar();
  }
})();