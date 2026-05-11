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
  const tiles     = document.getElementById("tiles");            // games
  const qResult   = document.getElementById("q-result");
  const scoreChip = document.getElementById("score-chip");
  const timerChip = document.getElementById("timer-chip");
  const selfNext  = document.getElementById("self-next");
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
  let lastTally = null;           // {counts: {...}} for current question
  let currentQuestion = null;

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

  /** Apply the animation class for the given avatar to an element.
   *  Strips any previous `kk-anim-*` first. */
  function applyAnimClass(el, animName) {
    if (!el) return;
    [...el.classList].forEach(c => { if (c.startsWith("kk-anim-")) el.classList.remove(c); });
    if (animName) el.classList.add("kk-anim-" + animName);
  }

  // Set the header capsule for the current participant.
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
    // Decorate every tile with the right idle animation
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
      // Try a single reconnect after a moment.
      setTimeout(() => { if (!ws || ws.readyState === 3) connect(); }, 2500);
    });
  }

  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  function handle(msg) {
    switch (msg.type) {
      case "state":       onState(msg); break;
      case "tally":       onTally(msg); break;
      case "answer_ack":  onAnswerAck(msg); break;
      case "ended":       onEnded(); break;
    }
  }

  // ─────────────────────── State / question rendering ───────────────────────
  function onState(s) {
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

    // New question? Reset transient UI bits.
    if (currentQuestion?.id !== q.id) {
      qResult.style.display = "none";
      if (selfNext) selfNext.style.display = "none";
      questionReceivedAt = Date.now();
      myChoiceId = null;
      answeredQuestionId = null;
    }
    currentQuestion = q;

    qText.textContent = q.text;
    applyQuestionTypography(q);
    qProgress.textContent = `Question ${s.index + 1} / ${s.total}`;
    show(stepQuestion);

    if (kind === "poll") renderPollQuestion(q, s);
    else                 renderGameQuestion(q, s);

    // Restore previous answer if the server tells us we already answered.
    if (s.my_answer) {
      restoreMyAnswer(q, s.my_answer);
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

  // ── Poll rendering ───────────────────────────────────────────────
  function renderPollQuestion(q, s) {
    qBody.innerHTML = "";

    if (q.type === "reaction") {
      renderReactionQuestion(q);
      return;
    }

    // IMPORTANT: text-based question types must be handled before choices.
    // Some questions may still have old/stale A/B choice rows from when they
    // were previously MCQ. Open-ended questions must always render as free text.
    if (q.type === "word" || q.type === "open") {
      const input = document.createElement(q.type === "word" ? "input" : "textarea");
      input.className = "form-control form-control-lg mb-2";
      input.placeholder = q.type === "word" ? "Type one word…" : "Type your answer…";
      if (q.type === "word") input.maxLength = 30;
      if (q.type === "open") input.rows = 5;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "kk-btn kk-btn-primary w-100";
      btn.textContent = "Submit";
      btn.addEventListener("click", () => {
        const text = input.value.trim();
        if (!text) return;
        send({ type: "answer", question_id: q.id, text });
        answeredQuestionId = q.id;
        qBody.innerHTML = "";
        showResult("Submitted ✓");
        if (mode === "open" && selfNext) selfNext.style.display = "block";
      });

      qBody.appendChild(input);
      qBody.appendChild(btn);
      input.focus();
      return;
    }

    if (isChoicePollType(q) || (Array.isArray(q.choices) && q.choices.length && q.type !== "scale")) {
      q.choices.forEach(c => {
        const btn = document.createElement("button");
        btn.className = "kk-choice";
        btn.type = "button";
        btn.dataset.choiceId = c.id;

        if (c.image_url || c.image) {
          const imgUrl = c.image_url || c.image;
          btn.innerHTML = `<img src="${escapeAttr(imgUrl)}" alt="" style="width:42px;height:42px;object-fit:cover;border-radius:10px;margin-right:.5rem;"><span>${escapeHtml(c.text)}</span>`;
        } else {
          btn.textContent = c.text;
        }

        btn.addEventListener("click", () => answerPollChoice(q, c, btn));
        qBody.appendChild(btn);
      });
    } else if (q.type === "scale") {
      const wrap = document.createElement("div");
      wrap.className = "d-flex gap-2 flex-wrap";
      getScaleChoices(q).forEach(choice => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "kk-choice";
        b.style.flex = "1 1 18%";
        b.textContent = String(choice.text);
        b.dataset.value = choice.value;
        b.dataset.choiceId = choice.id;
        b.addEventListener("click", () => answerPollScale(q, choice.value, b));
        wrap.appendChild(b);
      });
      qBody.appendChild(wrap);
    } else {
      qBody.innerHTML = `<div class="text-secondary text-center py-3">This question type is not available on the participant screen yet.</div>`;
    }
  }

  function renderReactionQuestion(q) {
    const wrap = document.createElement("div");
    wrap.className = "d-flex gap-3 flex-wrap justify-content-center";

    const choices = Array.isArray(q.choices) && q.choices.length
      ? q.choices
      : ["🔥", "❤️", "😂", "👏", "😮"].map((emoji, i) => ({ id: `fallback-${i}`, text: emoji }));

    choices.forEach(c => {
      const btn = document.createElement("button");
      btn.className = "kk-choice kk-reaction-choice";
      btn.type = "button";
      btn.dataset.choiceId = c.id;
      btn.textContent = c.text;
      btn.style.flex = "0 0 84px";
      btn.style.height = "84px";
      btn.style.fontSize = "2.25rem";
      btn.style.display = "inline-flex";
      btn.style.alignItems = "center";
      btn.style.justifyContent = "center";
      btn.style.borderRadius = "24px";
      btn.addEventListener("click", () => answerPollReaction(q, c, btn));
      wrap.appendChild(btn);
    });

    const hint = document.createElement("p");
    hint.className = "text-secondary text-center small mt-3 mb-0";
    hint.textContent = "Tap an emoji to send your reaction.";

    qBody.appendChild(wrap);
    qBody.appendChild(hint);
  }

  function answerPollChoice(q, c, btn) {
    if (answeredQuestionId === q.id) return;
    answeredQuestionId = q.id;
    myChoiceId = c.id;
    btn.classList.add("picked");
    qBody.querySelectorAll("button").forEach(b => { if (b !== btn) b.disabled = true; });
    send({ type: "answer", question_id: q.id, choice_id: c.id });
    showResult("Submitted ✓");
    if (mode === "open" && selfNext) selfNext.style.display = "block";
  }

  function answerPollReaction(q, c, btn) {
    myChoiceId = c.id;
    btn.classList.add("picked");
    setTimeout(() => btn.classList.remove("picked"), 220);
    send({ type: "answer", question_id: q.id, choice_id: c.id, text: c.text });
    showResult(`${c.text} Reaction sent`);
  }

  function answerPollScale(q, val, btn) {
    if (answeredQuestionId === q.id) return;
    answeredQuestionId = q.id;
    myChoiceId = val;
    btn.classList.add("picked");
    qBody.querySelectorAll("button").forEach(b => { if (b !== btn) b.disabled = true; });
    send({ type: "answer", question_id: q.id, value: val });
    showResult("Submitted ✓");
    if (mode === "open" && selfNext) selfNext.style.display = "block";
  }

  // ── Game rendering: kahoot-style tiles + timer ───────────────────
  function renderGameQuestion(q, s) {
    tiles.innerHTML = "";
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

    // Timer
    clearInterval(timerInterval);
    const limit = q.time_limit || 20;
    let remaining = limit;
    timerChip.textContent = `${remaining}s`;
    const startedAt = Date.now();
    timerInterval = setInterval(() => {
      remaining = Math.max(0, limit - Math.floor((Date.now() - startedAt) / 1000));
      timerChip.textContent = `${remaining}s`;
      if (remaining <= 0) {
        clearInterval(timerInterval);
        tiles.querySelectorAll("button").forEach(b => b.disabled = true);
        if (!answeredQuestionId) showResult("⏱ Time's up");
      }
    }, 200);
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

  // ── Restore a previously made answer (after refresh) ─────────────
  function restoreMyAnswer(q, my) {
    answeredQuestionId = q.id;
    myChoiceId = my.choice_id || my.value || null;

    if (kind === "game") {
      tiles.querySelectorAll("button").forEach(b => {
        b.disabled = true;
        if (Number(b.dataset.choiceId) === Number(my.choice_id)) {
          b.classList.add("picked");
          b.classList.add(my.is_correct ? "correct" : "incorrect");
          b.style.outline = "3px solid #fff";
        }
      });
      // Result chip — same look as fresh ack.
      const text = my.is_correct
        ? `✅ Correct! +${my.points || 0} pts`
        : `❌ Not quite — score: ${myScore}`;
      qResult.innerHTML = `<div class="kk-q-pill" style="background:${my.is_correct ? "#16a34a" : "#dc2626"}; color:#fff; font-size:1rem; padding:.4rem .9rem;">${text}</div>`;
      qResult.style.display = "block";
    } else {
      // poll: highlight chosen choice button
      qBody.querySelectorAll("button").forEach(b => {
        b.disabled = true;
        if (Number(b.dataset.choiceId) === Number(my.choice_id)) b.classList.add("picked");
        if (Number(b.dataset.value)     === Number(my.value))     b.classList.add("picked");
      });
      showResult("Submitted ✓");
      if (mode === "open" && selfNext) selfNext.style.display = "block";
    }
  }

  function onAnswerAck(msg) {
    myScore = msg.score || myScore;
    if (scoreChip) {
      scoreChip.style.display = "inline-block";
      scoreChip.textContent = `${myScore} pts`;
    }
    updateHeaderAvatar();
    const text = msg.is_correct
      ? `✅ Correct! +${msg.points} pts`
      : `❌ Not quite — score: ${myScore}`;
    qResult.innerHTML = `<div class="kk-q-pill" style="background:${msg.is_correct ? "#16a34a" : "#dc2626"}; color:#fff; font-size:1rem; padding:.4rem .9rem;">${text}</div>`;
    qResult.style.display = "block";
    const chosen = tiles && Array.from(tiles.querySelectorAll("button")).find(b =>
      Number(b.dataset.choiceId) === Number(msg.choice_id) || b.classList.contains("picked"));
    if (chosen) chosen.classList.add(msg.is_correct ? "correct" : "incorrect");
  }

  // ─────────────────────── Live tally chart on player ───────────────────────
  function onTally(msg) {
    if (!currentQuestion || msg.question_id !== currentQuestion.id) return;
    lastTally = msg.data || { counts: {} };
    drawMyChart(currentQuestion, lastTally);
  }

  function drawMyChart(q, tally) {
    if (!myChartCanvas || !q || !window.Chart) return;
    // Hide until someone has answered to avoid an empty-looking widget.
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
    selfNext.addEventListener("click", () => send({ type: "self_advance" }));
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

  // ─────────────────────── Auto-reconnect on refresh ───────────────────────
  // If we already have a nickname & avatar for THIS session, skip the picker
  // and connect straight away. The server will reconcile state via my_answer.
  if (nickname && kind === "game") {
    // Reflect saved choice visually in the picker (in case auto-connect fails)
    if (avatarGrid) {
      avatarGrid.querySelectorAll(".kk-avatar-tile").forEach(t => {
        t.classList.toggle("selected", t.dataset.avatarId === avatarId);
      });
    }
    connect();
  } else if (nickname && kind === "poll") {
    connect();
  } else {
    // First-time: keep the picker visible
    updateHeaderAvatar(); // hides header bubble (no nickname yet)
  }
})();