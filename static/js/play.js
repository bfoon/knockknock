/* Participant client. Handles BOTH poll & game participant flows.
 * - First screen: nickname (+ avatar for games).
 * - Connects WS with role=participant, sends `hello` with nickname + avatar.
 * - Receives `state` and renders accordingly.
 * - In Orchestra mode, you can only see the question the presenter selected.
 * - In Open mode (polls), participants can self-advance.
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
  const qBody     = document.getElementById("q-body");       // polls
  const tiles     = document.getElementById("tiles");        // games
  const qResult   = document.getElementById("q-result");
  const scoreChip = document.getElementById("score-chip");
  const timerChip = document.getElementById("timer-chip");
  const selfNext  = document.getElementById("self-next");
  const waitNick  = document.getElementById("wait-nick");
  const waitAvatar = document.getElementById("wait-avatar");
  const roomTag   = document.getElementById("room-tag");
  const finalScore = document.getElementById("final-score");

  let ws = null;
  let uid = localStorage.getItem("kk-uid") || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
  localStorage.setItem("kk-uid", uid);
  let nickname = "";
  let avatarId = "dragon";
  let myScore = 0;
  let myIndex = -1;   // for open mode poll
  let answeredQuestionId = null;
  let questionReceivedAt = 0;
  let timerInterval = null;

  function show(el) {
    [stepNick, stepWait, stepQuestion, stepEnded].forEach(s => s && (s.style.display = "none"));
    el.style.display = "block";
  }

  // ─────────────────────── Avatar picker (games) ───────────────────────
  const avatarGrid = document.getElementById("avatar-grid");
  if (avatarGrid) {
    avatarGrid.addEventListener("click", (e) => {
      const tile = e.target.closest(".kk-avatar-tile");
      if (!tile) return;
      avatarGrid.querySelectorAll(".kk-avatar-tile").forEach(t => t.classList.remove("selected"));
      tile.classList.add("selected");
      avatarId = tile.dataset.avatarId;
    });
  }

  // ─────────────────────── Join flow ───────────────────────
  document.getElementById("nick-go").addEventListener("click", () => {
    const v = document.getElementById("nick-input").value.trim();
    if (!v) { document.getElementById("nick-input").focus(); return; }
    nickname = v.slice(0, 40);
    connect();
  });
  document.getElementById("nick-input").addEventListener("keydown", e => {
    if (e.key === "Enter") document.getElementById("nick-go").click();
  });

  function connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws/session/${code}/`);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "hello", role: "participant", uid, nickname, avatar_id: avatarId }));
      waitNick.textContent = nickname;
      if (waitAvatar && kind === "game") waitAvatar.textContent = avatarEmoji(avatarId);
      show(stepWait);
    });
    ws.addEventListener("message", (e) => handle(JSON.parse(e.data)));
    ws.addEventListener("close", () => { /* reconnect attempt could go here */ });
  }

  function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  function handle(msg) {
    switch (msg.type) {
      case "state":      onState(msg); break;
      case "answer_ack": onAnswerAck(msg); break;
      case "ended":      onEnded(); break;
    }
  }

  // ─────────────────────── State / question rendering ───────────────────────
  function onState(s) {
    if (s.state === "lobby") { show(stepWait); return; }
    if (s.state === "ended") { onEnded(); return; }

    // Orchestra: always follow the presenter. Open polls: locally tracked.
    let q = s.question;
    if (kind === "poll" && mode === "open") {
      // first-time sync to presenter index
      if (myIndex < 0) myIndex = s.index;
      // we render based on local index, but use server's question payload for current index only
      if (myIndex !== s.index) {
        // we don't have other questions on the client; in this minimal cut we just sync to server
        myIndex = s.index;
      }
    }

    if (!q) { show(stepWait); return; }

    if (answeredQuestionId !== q.id) {
      // new question — reset
      qResult.style.display = "none";
      if (selfNext) selfNext.style.display = "none";
      questionReceivedAt = Date.now();
    }

    qText.textContent = q.text;
    qProgress.textContent = `Question ${s.index + 1} / ${s.total}`;
    show(stepQuestion);

    if (kind === "poll") renderPollQuestion(q);
    else                 renderGameQuestion(q);
  }

  // ── Poll: render input based on question type
  function renderPollQuestion(q) {
    qBody.innerHTML = "";
    if (q.type === "mcq" || q.type === "ranking") {
      q.choices.forEach(c => {
        const btn = document.createElement("button");
        btn.className = "kk-choice";
        btn.type = "button";
        btn.textContent = c.text;
        btn.addEventListener("click", () => answerPollChoice(q, c, btn));
        qBody.appendChild(btn);
      });
    } else if (q.type === "scale") {
      const wrap = document.createElement("div");
      wrap.className = "d-flex gap-2 flex-wrap";
      for (let i = 1; i <= 10; i++) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "kk-choice";
        b.style.flex = "1 1 18%";
        b.textContent = String(i);
        b.addEventListener("click", () => answerPollScale(q, i, b));
        wrap.appendChild(b);
      }
      qBody.appendChild(wrap);
    } else if (q.type === "word" || q.type === "open") {
      const input = document.createElement(q.type === "word" ? "input" : "textarea");
      input.className = "form-control form-control-lg mb-2";
      input.placeholder = q.type === "word" ? "Type one word…" : "Type your answer…";
      if (q.type === "word") input.maxLength = 30;
      if (q.type === "open") input.rows = 4;
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
    }
  }

  function answerPollChoice(q, c, btn) {
    if (answeredQuestionId === q.id) return;
    answeredQuestionId = q.id;
    btn.classList.add("picked");
    qBody.querySelectorAll("button").forEach(b => { if (b !== btn) b.disabled = true; });
    send({ type: "answer", question_id: q.id, choice_id: c.id });
    showResult("Submitted ✓");
    if (mode === "open" && selfNext) selfNext.style.display = "block";
  }

  function answerPollScale(q, val, btn) {
    if (answeredQuestionId === q.id) return;
    answeredQuestionId = q.id;
    btn.classList.add("picked");
    qBody.querySelectorAll("button").forEach(b => { if (b !== btn) b.disabled = true; });
    send({ type: "answer", question_id: q.id, value: val });
    showResult("Submitted ✓");
    if (mode === "open" && selfNext) selfNext.style.display = "block";
  }

  // ── Game: kahoot-style tiles + timer
  function renderGameQuestion(q) {
    tiles.innerHTML = "";
    const shapes = ["▲","◆","●","■","★","♥"];
    q.choices.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `kk-tile-answer t${i % 4}`;
      btn.innerHTML = `<span class="shape">${shapes[i % shapes.length]}</span><span>${escapeHtml(c.text)}</span>`;
      btn.addEventListener("click", () => answerGame(q, c, btn));
      tiles.appendChild(btn);
    });

    // Timer
    clearInterval(timerInterval);
    let remaining = q.time_limit || 20;
    timerChip.textContent = `${remaining}s`;
    const startedAt = Date.now();
    timerInterval = setInterval(() => {
      remaining = Math.max(0, (q.time_limit || 20) - Math.floor((Date.now() - startedAt) / 1000));
      timerChip.textContent = `${remaining}s`;
      if (remaining <= 0) {
        clearInterval(timerInterval);
        tiles.querySelectorAll("button").forEach(b => b.disabled = true);
        showResult("⏱ Time's up");
      }
    }, 200);
  }

  function answerGame(q, c, btn) {
    if (answeredQuestionId === q.id) return;
    answeredQuestionId = q.id;
    btn.style.outline = "3px solid #fff";
    tiles.querySelectorAll("button").forEach(b => b.disabled = true);
    send({ type: "answer", question_id: q.id, choice_id: c.id, question_received_at: questionReceivedAt });
    showResult("⏳ Locked in — waiting…");
  }

  function onAnswerAck(msg) {
    myScore = msg.score || myScore;
    scoreChip.style.display = "inline-block";
    scoreChip.textContent = `${myScore} pts`;
    const text = msg.is_correct
      ? `✅ Correct! +${msg.points} pts`
      : `❌ Not quite — score: ${myScore}`;
    qResult.innerHTML = `<div class="kk-q-pill" style="background:${msg.is_correct ? '#16a34a' : '#dc2626'}; color:#fff; font-size:1rem; padding:.4rem .9rem;">${text}</div>`;
    qResult.style.display = "block";
    // visual feedback on chosen tile
    const chosen = Array.from(tiles.querySelectorAll("button")).find(b => b.style.outline);
    if (chosen) chosen.classList.add(msg.is_correct ? "correct" : "incorrect");
  }

  function onEnded() {
    clearInterval(timerInterval);
    if (finalScore) finalScore.textContent = myScore;
    show(stepEnded);
  }

  function showResult(text) {
    qResult.textContent = text;
    qResult.style.display = "block";
  }

  if (selfNext) {
    selfNext.addEventListener("click", () => send({ type: "self_advance" }));
  }

  // ─────────────────────── helpers ───────────────────────
  function avatarEmoji(id) {
    const map = {dragon:"🐉",sword:"⚔️",car:"🏎️",butterfly:"🦋",spacecraft:"🚀",
      trex:"🦖",stego:"🦕",joker:"🃏",unicorn:"🦄",wizard:"🧙",ninja:"🥷",alien:"👽",
      ghost:"👻",robot:"🤖",fox:"🦊",octopus:"🐙",shark:"🦈",tiger:"🐯",panda:"🐼",wolf:"🐺"};
    return map[id] || "👤";
  }
  function escapeHtml(s){ return (s||"").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }
})();
