/* Presenter client. Connects to the session WebSocket as role="presenter",
 * reacts to `state` / `tally` / `leaderboard` messages, and lets the
 * presenter advance, draw, toggle group/fullscreen, and end the session.
 */
(function () {
  const stage = document.getElementById("stage");
  const code = stage.dataset.code;
  const kind = stage.dataset.kind;

  const views = {
    lobby:    document.getElementById("view-lobby"),
    question: document.getElementById("view-question"),
    group:    document.getElementById("view-group"),
    ended:    document.getElementById("view-ended"),
  };
  function show(name) {
    Object.entries(views).forEach(([k, el]) => el.style.display = (k === name ? "block" : "none"));
  }

  const qText      = document.getElementById("q-text");
  const qProgress  = document.getElementById("q-progress");
  const liveCanvas = document.getElementById("live-chart");
  const specialEl  = document.getElementById("special-display");
  const drawCanvas  = document.getElementById("draw-canvas");
  const laserCanvas = document.getElementById("laser-canvas");
  const groupGrid  = document.getElementById("group-grid");
  const lobbyChips = document.getElementById("participant-chips");
  const participantCount = document.getElementById("participant-count");
  const leaderboardEl = document.getElementById("leaderboard");

  const chartHolder = { chart: null };
  let currentState = null;
  let groupCharts = []; // for group display

  // ─────────────────────── WebSocket ───────────────────────
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws/session/${code}/`);

  ws.addEventListener("open", () => {
    ws.send(JSON.stringify({ type: "hello", role: "presenter", uid: "presenter-" + Math.random().toString(36).slice(2) }));
  });
  ws.addEventListener("close", () => { /* show offline state if desired */ });

  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case "state":       onState(msg); break;
      case "tally":       onTally(msg); break;
      case "leaderboard": onLeaderboard(msg); break;
      case "ended":       show("ended"); break;
    }
  });

  function send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  // ─────────────────────── State handling ───────────────────────
  function onState(s) {
    currentState = s;
    participantCount.textContent = s.participants;
    // Update lobby chips (just counters)
    while (lobbyChips.children.length < s.participants) {
      const chip = document.createElement("span");
      chip.className = "kk-lobby-chip";
      chip.textContent = "👤 guest";
      lobbyChips.appendChild(chip);
    }
    while (lobbyChips.children.length > s.participants) {
      lobbyChips.removeChild(lobbyChips.lastChild);
    }

    if (s.state === "lobby") { show("lobby"); return; }
    if (s.state === "ended") { show("ended"); return; }
    show("question");
    renderCurrentQuestion(s);
  }

  function renderCurrentQuestion(s) {
    if (!s.question) return;
    qText.textContent = s.question.text;
    qProgress.textContent = `Question ${s.index + 1} / ${s.total}`;
    const labels = s.question.choices;
    if (s.kind === "poll") {
      window.kkRenderLive(liveCanvas, specialEl, s.question.chart_type, s.question.type,
                          labels, { counts: {}, texts: [] }, chartHolder);
    } else {
      // games: always a bar of choice counts on presenter side
      window.kkRenderLive(liveCanvas, specialEl, "bar", "mcq",
                          labels, { counts: {} }, chartHolder);
    }
  }

  function onTally(msg) {
    if (!currentState || !currentState.question) return;
    if (msg.question_id !== currentState.question.id) return;
    const q = currentState.question;
    const chartId = currentState.kind === "poll" ? q.chart_type : "bar";
    window.kkRenderLive(liveCanvas, specialEl, chartId, q.type || "mcq",
                        q.choices, msg.data, chartHolder);
  }

  function onLeaderboard(msg) {
    if (!leaderboardEl) return;
    leaderboardEl.innerHTML = "";
    const rows = msg.data.rows || [];
    rows.slice(0, 10).forEach((r, i) => {
      const row = document.createElement("div");
      row.className = "kk-lb-row";
      const rankCls = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
      row.innerHTML = `
        <span class="kk-lb-rank ${rankCls}">${i+1}</span>
        ${r.avatar_id ? `<span class="kk-lb-avatar">${avatarEmoji(r.avatar_id)}</span>` : ""}
        <span class="kk-lb-name">${escapeHtml(r.name)}</span>
        <span class="kk-lb-score">${r.score}</span>`;
      leaderboardEl.appendChild(row);
    });
  }

  function avatarEmoji(id) {
    const map = {dragon:"🐉",sword:"⚔️",car:"🏎️",butterfly:"🦋",spacecraft:"🚀",
      trex:"🦖",stego:"🦕",joker:"🃏",unicorn:"🦄",wizard:"🧙",ninja:"🥷",alien:"👽",
      ghost:"👻",robot:"🤖",fox:"🦊",octopus:"🐙",shark:"🦈",tiger:"🐯",panda:"🐼",wolf:"🐺"};
    return map[id] || "👤";
  }
  function escapeHtml(s){ return (s||"").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

  // ─────────────────────── Controls ───────────────────────
  document.getElementById("btn-start").addEventListener("click", () => send({ type: "advance" }));
  document.getElementById("btn-next").addEventListener("click", () => send({ type: "advance" }));
  document.getElementById("btn-prev").addEventListener("click", () => send({ type: "back" }));
  document.getElementById("btn-end").addEventListener("click", () => {
    if (confirm("End this session?")) send({ type: "end" });
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (["INPUT","TEXTAREA"].includes(document.activeElement.tagName)) return;
    if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); send({ type: "advance" }); }
    if (e.key === "ArrowLeft"  || e.key === "PageUp")   { e.preventDefault(); send({ type: "back" }); }
    if (e.key === "f" || e.key === "F") document.getElementById("btn-fs").click();
    if (e.key === "g" || e.key === "G") document.getElementById("btn-group").click();
  });

  // Fullscreen
  document.getElementById("btn-fs").addEventListener("click", () => {
    if (!document.fullscreenElement) stage.requestFullscreen?.();
    else document.exitFullscreen?.();
    stage.classList.toggle("fullscreen");
  });

  // Group display
  document.getElementById("btn-group").addEventListener("click", () => {
    const active = views.group.style.display === "block";
    if (active) {
      show(currentState && currentState.state === "lobby" ? "lobby" : "question");
    } else {
      renderGroup();
      show("group");
    }
  });

  function renderGroup() {
    // Render mini-charts for ALL questions with current state data is non-trivial;
    // for now show a tile per question with its meta and a placeholder chart.
    if (!currentState) return;
    groupGrid.innerHTML = "";
    const total = currentState.total;
    for (let i = 0; i < total; i++) {
      const tile = document.createElement("div");
      tile.className = "kk-group-tile";
      tile.innerHTML = `
        <div class="kk-group-tile-title">Q${i+1}</div>
        <canvas height="180"></canvas>`;
      groupGrid.appendChild(tile);
      const canvas = tile.querySelector("canvas");
      const labels = ["A","B","C","D"];
      const values = labels.map(() => 0);
      new Chart(canvas, {
        type: "bar",
        data: { labels, datasets: [{ data: values, backgroundColor: ["#7c3aed","#22d3ee","#fb7185","#fbbf24"], borderRadius: 6 }] },
        options: { responsive: true, plugins: { legend: { display: false } },
                   scales: { x: { ticks: { color: "#cbd5e1" } }, y: { ticks: { color: "#cbd5e1" } } } },
      });
    }
  }

  // ─────────────────────── Drawing tools ───────────────────────
  const draw = window.kkDrawOverlay(drawCanvas, laserCanvas, {
    onEvent: (evt) => send({ type: "draw", ...evt }),
  });
  document.querySelectorAll("#draw-tools .kk-tool[data-tool]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#draw-tools .kk-tool[data-tool]").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      draw.setTool(btn.dataset.tool);
    });
  });
  document.getElementById("clear-draw").addEventListener("click", () => {
    draw.clear();
    send({ type: "clear_draw" });
  });
  document.querySelectorAll(".kk-color-swatch").forEach(sw => {
    sw.addEventListener("click", () => {
      document.querySelectorAll(".kk-color-swatch").forEach(s => s.classList.remove("active"));
      sw.classList.add("active");
      draw.setColor(sw.dataset.color);
    });
  });
})();