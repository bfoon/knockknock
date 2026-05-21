// ──────────────────────────────────────────────────────────────
// Icebreaker runner — orchestrates the shell (back button,
// full-screen, optional phone panel) and lazy-loads the chosen
// game module.
//
// Each game module exports default init(ctx). See ctx shape below.
// ──────────────────────────────────────────────────────────────

const shell = document.getElementById("kkRunner");
const stage = document.getElementById("kkStage");
const bottom = document.getElementById("kkBottom");
const fullscreenBtn = document.getElementById("kkFullscreen");
const phonesBtn = document.getElementById("kkPhonesToggle");
const phonePanel = document.getElementById("kkPhonePanel");
const sessionCodeEl = document.getElementById("kkSessionCode");
const phoneCountEl = document.getElementById("kkPhoneCount");

if (!shell || !stage || !bottom) { throw new Error("Icebreaker runner shell not found"); }
const gameId = shell.dataset.game;
const supportsPhones = shell.dataset.supportsPhones === "1";
const durationRaw = shell.dataset.duration;
const duration = durationRaw && durationRaw !== "" ? parseInt(durationRaw, 10) : null;

// ── Guard: THREE must be loaded before any game module runs ──
// All 3D games use the global THREE from the <script> tag in play.html.
// If that tag failed to load (offline, CDN blocked), fail loudly here
// rather than letting every game throw a cryptic "THREE is not defined".
if (typeof THREE === "undefined") {
  showError(
    "The 3D engine (three.js) didn't load. Check the network/CDN, then refresh.",
    "THREE is undefined"
  );
  throw new Error("THREE not loaded");
}

// ── Full-screen toggle ──────────────────────────────────────
fullscreenBtn?.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await shell.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (err) {
    console.warn("Fullscreen toggle failed:", err);
  }
});

document.addEventListener("fullscreenchange", () => {
  const inFull = !!document.fullscreenElement;
  fullscreenBtn?.classList.toggle("is-active", inFull);
  if (fullscreenBtn) fullscreenBtn.innerHTML = inFull
    ? '<i class="bi bi-fullscreen-exit"></i> Exit full screen'
    : '<i class="bi bi-arrows-fullscreen"></i> Full screen';
});

// ── Phones toggle ───────────────────────────────────────────
let phonesEnabled = false;
const phoneCallbacks = new Set();

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

if (supportsPhones && phonesBtn) {
  phonesBtn.addEventListener("click", () => {
    phonesEnabled = !phonesEnabled;
    phonesBtn.classList.toggle("is-active", phonesEnabled);
    phonesBtn.innerHTML = phonesEnabled
      ? '<i class="bi bi-phone-fill"></i> Phones on'
      : '<i class="bi bi-phone"></i> Enable phones';

    if (phonesEnabled) {
      sessionCodeEl.textContent = generateCode().split("").join(" ");
      phonePanel.hidden = false;
    } else {
      phonePanel.hidden = true;
    }

    phoneCallbacks.forEach((cb) => cb(phonesEnabled));
  });
}

// ── Build the context handed to game modules ────────────────
const ctx = {
  stage,
  bottom,
  duration,
  phonesOn: () => phonesEnabled,
  onPhonesChange: (cb) => phoneCallbacks.add(cb),
  setPhoneCount: (n) => {
    if (phoneCountEl) phoneCountEl.textContent = String(n);
  },
  getColors: () => {
    const styles = getComputedStyle(shell);
    return {
      a: styles.getPropertyValue("--a").trim() || "#22d3ee",
      b: styles.getPropertyValue("--b").trim() || "#7c3aed",
    };
  },
};

// ── Lazy-load and mount the chosen module ───────────────────
const moduleUrl = new URL(
  `games/${gameId}.js`,
  import.meta.url,
).href;

let cleanup = null;

(async () => {
  try {
    const mod = await import(moduleUrl);
    if (typeof mod.default === "function") {
      cleanup = await mod.default(ctx);
    } else {
      console.error(`Game module "${gameId}" has no default export.`);
      showError(`This game module didn't load correctly.`, `no default export in ${gameId}.js`);
    }
  } catch (err) {
    // Surface the REAL reason on screen + console, instead of a generic message.
    console.error(`Failed to load game "${gameId}":`, err);
    showError(
      `We couldn't load this icebreaker.`,
      `${err.name || "Error"}: ${err.message}`
    );
  }
})();

function showError(msg, detail) {
  stage.innerHTML = `
    <div class="kk-game-overlay">
      <div style="font-size: 4rem;">🙁</div>
      <h2 class="kk-game-headline">Oops</h2>
      <p class="kk-game-sub">${msg}</p>
      ${detail ? `<pre style="margin-top:1rem;max-width:80ch;white-space:pre-wrap;
        font-family:'JetBrains Mono',monospace;font-size:.8rem;color:#fda4af;
        background:rgba(251,113,133,.1);border:1px solid rgba(251,113,133,.35);
        padding:.75rem 1rem;border-radius:10px;">${String(detail)
          .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}</pre>` : ""}
    </div>`;
}

window.addEventListener("beforeunload", () => {
  if (typeof cleanup === "function") {
    try { cleanup(); } catch (_) {}
  }
});