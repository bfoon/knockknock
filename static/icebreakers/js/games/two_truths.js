// ──────────────────────────────────────────────────────────────
// TWO TRUTHS & A BLUFF
//
// Presenter-driven flow (the prototype runs entirely on the
// presenter screen — when wired to the live backend, phones will
// submit statements & cast votes through the existing WebSocket
// channel; see NOTES.md at the end of this app).
//
// Flow:
//   1. Setup: enter a player name and three statements (mark which
//      is the bluff).
//   2. Reveal: statements appear one at a time, dramatically.
//   3. Vote: each statement gets a vote tally. (In phones-on mode,
//      participants tap a number on their phone; in screen-only
//      mode the presenter clicks a "show of hands" picker so the
//      room votes verbally and the host records.)
//   4. Reveal the bluff with a 3D card flip.
//
// Visual style: floating glass cards on a soft starfield, rotating
// on hover. Heavy use of cubic-bezier easings.
// ──────────────────────────────────────────────────────────────

import { el, makeButton, shuffle } from "../_helpers.js";

export default function init(ctx) {
  const { stage, bottom, getColors, phonesOn, onPhonesChange } = ctx;
  const colors = getColors();

  stage.innerHTML = "";
  stage.style.flexDirection = "column";
  stage.style.padding = "2rem";

  // ── State ──────────────────────────────────────────────────
  const state = {
    phase: "intro",         // intro | setup | reveal | vote | result
    player: "",
    statements: [],         // [{ text, isLie }]
    votes: [0, 0, 0],
  };

  // ── Background starfield (lightweight canvas) ──────────────
  const bg = el("canvas", { parent: stage });
  bg.style.position = "absolute";
  bg.style.inset = "0";
  bg.style.zIndex = "0";
  bg.style.pointerEvents = "none";

  const bctx = bg.getContext("2d");
  let stars = [];
  function resizeBg() {
    bg.width = stage.clientWidth;
    bg.height = stage.clientHeight;
    stars = Array.from({ length: 60 }, () => ({
      x: Math.random() * bg.width,
      y: Math.random() * bg.height,
      r: Math.random() * 1.4 + 0.3,
      tw: Math.random() * Math.PI * 2,
      speed: 0.005 + Math.random() * 0.015,
    }));
  }
  const ro = new ResizeObserver(resizeBg);
  ro.observe(stage);
  resizeBg();

  let rafBg = null;
  function drawBg() {
    bctx.clearRect(0, 0, bg.width, bg.height);
    for (const s of stars) {
      s.tw += s.speed;
      const a = 0.3 + Math.sin(s.tw) * 0.3;
      bctx.fillStyle = `rgba(255, 255, 255, ${a})`;
      bctx.beginPath();
      bctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      bctx.fill();
    }
    rafBg = requestAnimationFrame(drawBg);
  }
  rafBg = requestAnimationFrame(drawBg);

  // ── Main content holder (above starfield) ──────────────────
  const main = el("div", { parent: stage });
  main.style.position = "relative";
  main.style.zIndex = "1";
  main.style.width = "100%";
  main.style.maxWidth = "1100px";
  main.style.display = "flex";
  main.style.flexDirection = "column";
  main.style.alignItems = "center";
  main.style.gap = "1.5rem";

  // ── Intro screen ───────────────────────────────────────────
  function renderIntro() {
    state.phase = "intro";
    bottom.innerHTML = "";
    main.innerHTML = `
      <h2 class="kk-game-headline">Two Truths<br><span style="opacity:.5; font-size:.6em;">&amp; one</span> Bluff</h2>
      <p class="kk-game-sub">
        One person at a time. Three statements. Two are true — one is a lie.
        The room votes which one is the bluff.
      </p>
      <p style="opacity:.5; font-size:.95rem; margin-top:.5rem;">
        ${phonesOn() ? "📱 Participants will vote on their phones." : "🖋 Screen-only mode — the host records the room's votes."}
      </p>`;
    const startBtn = makeButton('<i class="bi bi-arrow-right-circle-fill"></i> Start round', { onClick: renderSetup });
    bottom.appendChild(startBtn);
  }

  // ── Setup screen: enter the player's three statements ──────
  function renderSetup() {
    state.phase = "setup";
    state.player = "";
    state.statements = [];
    state.votes = [0, 0, 0];
    bottom.innerHTML = "";

    main.innerHTML = `
      <h2 class="kk-game-headline" style="font-size: clamp(1.8rem, 4vw, 3rem);">Whose turn is it?</h2>
      <input id="tt-name" placeholder="Player name" class="kk-tt-input" autocomplete="off" />
      <p class="kk-game-sub">Write three statements. Mark the <strong>one</strong> that's a lie.</p>
      <div class="kk-tt-rows">
        ${[0, 1, 2].map((i) => `
          <label class="kk-tt-row">
            <input type="text" placeholder="Statement ${i + 1}" data-stmt="${i}" maxlength="120" />
            <button type="button" class="kk-tt-bluff" data-bluff="${i}" aria-label="Mark as the bluff">Truth</button>
          </label>`).join("")}
      </div>`;

    // Inject scoped styles once.
    if (!document.getElementById("kk-tt-styles")) {
      const s = el("style", { parent: document.head, attrs: { id: "kk-tt-styles" } });
      s.textContent = `
        .kk-tt-input, .kk-tt-row input {
          width: 100%; max-width: 600px;
          padding: .9rem 1.1rem;
          font-size: 1.05rem;
          background: rgba(255,255,255,.04);
          border: 1px solid rgba(255,255,255,.12);
          border-radius: 12px;
          color: #f8fafc;
          transition: border-color .2s ease;
        }
        .kk-tt-input:focus, .kk-tt-row input:focus {
          outline: none;
          border-color: color-mix(in srgb, var(--a, #22d3ee) 70%, transparent);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--a, #22d3ee) 20%, transparent);
        }
        .kk-tt-rows { display: flex; flex-direction: column; gap: .75rem; width: 100%; max-width: 700px; }
        .kk-tt-row { display: grid; grid-template-columns: 1fr auto; gap: .5rem; align-items: stretch; }
        .kk-tt-bluff {
          padding: 0 1.25rem;
          border-radius: 12px;
          background: rgba(34, 197, 94, .12);
          border: 1px solid rgba(34, 197, 94, .35);
          color: #4ade80;
          font-weight: 700;
          cursor: pointer;
          transition: all .2s ease;
          min-width: 110px;
        }
        .kk-tt-bluff.is-bluff {
          background: rgba(251, 113, 133, .15);
          border-color: rgba(251, 113, 133, .55);
          color: #fda4af;
        }
        .kk-tt-bluff.is-bluff::before { content: "🤥 "; }
        /* Reveal cards */
        .kk-tt-cards {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1.5rem;
          width: 100%;
          perspective: 1400px;
        }
        @media (max-width: 760px) { .kk-tt-cards { grid-template-columns: 1fr; } }
        .kk-tt-card {
          position: relative;
          padding: 2rem 1.5rem;
          min-height: 220px;
          border-radius: 20px;
          background: linear-gradient(145deg, rgba(255,255,255,.06), rgba(255,255,255,.02));
          border: 1px solid rgba(255,255,255,.1);
          backdrop-filter: blur(10px);
          transform-style: preserve-3d;
          transition: transform .5s cubic-bezier(.34,1.56,.64,1), border-color .3s ease, box-shadow .3s ease;
          cursor: pointer;
        }
        .kk-tt-card:hover {
          transform: translateY(-6px) rotateX(2deg);
          border-color: color-mix(in srgb, var(--a, #22d3ee) 50%, transparent);
          box-shadow: 0 20px 50px color-mix(in srgb, var(--a, #22d3ee) 25%, transparent);
        }
        .kk-tt-card.is-revealing { transform: rotateY(180deg) translateY(-8px); }
        .kk-tt-card-num {
          position: absolute; top: 1rem; right: 1.25rem;
          font-family: 'Clash Display', system-ui, sans-serif;
          font-size: 2.5rem; font-weight: 800;
          color: color-mix(in srgb, var(--a, #22d3ee) 90%, transparent);
          opacity: .35;
          line-height: 1;
        }
        .kk-tt-card-text {
          font-size: 1.15rem; line-height: 1.5; font-weight: 600;
          margin-bottom: 1.25rem;
          min-height: 4rem;
        }
        .kk-tt-card-tally {
          display: flex; align-items: baseline; justify-content: space-between;
          padding-top: 1rem;
          border-top: 1px solid rgba(255,255,255,.08);
        }
        .kk-tt-card-tally strong {
          font-family: 'Clash Display', system-ui, sans-serif;
          font-size: 1.75rem; font-weight: 800;
        }
        .kk-tt-card.is-bluff-revealed {
          border-color: rgba(251, 113, 133, .7);
          background: linear-gradient(145deg, rgba(251, 113, 133, .15), rgba(251, 113, 133, .05));
          box-shadow: 0 20px 50px rgba(251, 113, 133, .35);
        }
        .kk-tt-card.is-truth-revealed {
          border-color: rgba(34, 197, 94, .5);
          background: linear-gradient(145deg, rgba(34, 197, 94, .1), rgba(34, 197, 94, .02));
        }
        .kk-tt-vote-btn {
          margin-top: 1rem;
          width: 100%;
          padding: .65rem;
          border-radius: 10px;
          background: color-mix(in srgb, var(--a, #22d3ee) 18%, transparent);
          border: 1px solid color-mix(in srgb, var(--a, #22d3ee) 50%, transparent);
          color: #f8fafc; font-weight: 700;
          cursor: pointer;
          transition: all .2s ease;
        }
        .kk-tt-vote-btn:hover {
          background: color-mix(in srgb, var(--a, #22d3ee) 30%, transparent);
        }
      `;
    }

    // Bluff-mark toggle: only one statement can be flagged the bluff.
    main.querySelectorAll(".kk-tt-bluff").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.bluff);
        main.querySelectorAll(".kk-tt-bluff").forEach((b, i) => {
          const flagged = i === idx;
          b.classList.toggle("is-bluff", flagged);
          b.textContent = flagged ? "Bluff" : "Truth";
        });
      });
    });

    const continueBtn = makeButton('<i class="bi bi-arrow-right"></i> Reveal to the room', {
      onClick: () => {
        const name = main.querySelector("#tt-name").value.trim();
        const stmts = Array.from(main.querySelectorAll("[data-stmt]")).map((i) => i.value.trim());
        const bluffBtn = main.querySelector(".kk-tt-bluff.is-bluff");

        if (!name) { alert("Enter the player's name."); return; }
        if (stmts.some((s) => !s)) { alert("Fill in all three statements."); return; }
        if (!bluffBtn) { alert("Mark which statement is the bluff (tap a 'Truth' button)."); return; }

        const lieIdx = Number(bluffBtn.dataset.bluff);
        state.player = name;
        state.statements = stmts.map((text, i) => ({ text, isLie: i === lieIdx }));
        // Shuffle so the bluff isn't always in the same slot when revealed.
        shuffle(state.statements);
        renderVote();
      },
    });
    bottom.appendChild(continueBtn);

    const backBtn = makeButton('<i class="bi bi-x"></i> Cancel', { ghost: true, onClick: renderIntro });
    bottom.appendChild(backBtn);
  }

  // ── Voting / reveal screen ─────────────────────────────────
  function renderVote() {
    state.phase = "vote";
    state.votes = [0, 0, 0];
    bottom.innerHTML = "";

    main.innerHTML = `
      <h2 class="kk-game-headline" style="font-size: clamp(1.8rem, 4vw, 3rem);">${escapeHtml(state.player)}</h2>
      <p class="kk-game-sub">Which one is the bluff? ${phonesOn() ? "Vote on your phone." : "Tap to add a vote."}</p>
      <div class="kk-tt-cards" id="kk-tt-cards"></div>`;

    const cardsHost = main.querySelector("#kk-tt-cards");
    state.statements.forEach((s, i) => {
      const card = el("div", { class: "kk-tt-card", parent: cardsHost });
      card.innerHTML = `
        <div class="kk-tt-card-num">${i + 1}</div>
        <div class="kk-tt-card-text">${escapeHtml(s.text)}</div>
        <div class="kk-tt-card-tally"><span style="opacity:.5;">Votes</span><strong data-v="${i}">0</strong></div>
        <button class="kk-tt-vote-btn" data-vote="${i}">+1 vote</button>`;

      card.querySelector("[data-vote]").addEventListener("click", () => {
        state.votes[i] += 1;
        card.querySelector(`[data-v="${i}"]`).textContent = state.votes[i];
      });
    });

    const revealBtn = makeButton('<i class="bi bi-emoji-sunglasses"></i> Reveal the bluff', { onClick: renderReveal });
    bottom.appendChild(revealBtn);
  }

  // ── Reveal animation ───────────────────────────────────────
  function renderReveal() {
    state.phase = "result";
    bottom.innerHTML = "";

    const cards = main.querySelectorAll(".kk-tt-card");
    cards.forEach((c, i) => {
      // Stagger the reveal so it feels suspenseful.
      setTimeout(() => {
        if (state.statements[i].isLie) {
          c.classList.add("is-bluff-revealed");
          // Add a "BLUFF" overlay tag.
          el("div", {
            parent: c, html: "🤥 BLUFF",
            style: {
              position: "absolute", top: "1rem", left: "1.25rem",
              padding: ".3rem .8rem", borderRadius: "999px",
              background: "rgba(251, 113, 133, .25)",
              border: "1px solid rgba(251, 113, 133, .7)",
              fontSize: ".75rem", fontWeight: "700", letterSpacing: ".1em",
            },
          });
        } else {
          c.classList.add("is-truth-revealed");
        }
      }, i * 350);
    });

    setTimeout(() => {
      const nextBtn = makeButton('<i class="bi bi-arrow-right"></i> Next player', { onClick: renderSetup });
      bottom.appendChild(nextBtn);
      const doneBtn = makeButton('<i class="bi bi-check"></i> End game', { ghost: true, onClick: renderIntro });
      bottom.appendChild(doneBtn);
    }, 1500);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Kick off.
  renderIntro();

  // React to phones toggle so the intro copy updates.
  onPhonesChange(() => { if (state.phase === "intro") renderIntro(); });

  return () => {
    cancelAnimationFrame(rafBg);
    ro.disconnect();
  };
}
