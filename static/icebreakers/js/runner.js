// ──────────────────────────────────────────────────────────────
// Icebreaker runner — orchestrates the shell (back button,
// full-screen, optional phone panel) and lazy-loads the chosen
// game module.
//
// Each game module is an ES module under
// /static/icebreakers/js/games/<id>.js that exports a default
// `init(ctx)` function. `ctx` gives the module everything it
// needs without it touching globals:
//
//   ctx = {
//     stage:        HTMLElement  // <main> the game owns
//     bottom:       HTMLElement  // footer for controls
//     phonesOn:     () => bool   // are phones enabled right now?
//     onPhonesChange(cb)         // subscribe to toggle changes
//     setPhoneCount(n)           // update the connected counter
//     getColors()                // { a: '#22d3ee', b: '#7c3aed' }
//     duration:     number|null  // duration in seconds, or null
//   }
//
// Modules can return a cleanup function for when the page unloads.
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

// ── Full-screen toggle ──────────────────────────────────────
fullscreenBtn?.addEventListener("click", async () => {
  try {
    if (!document.fullscreenElement) {
      await shell.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (err) {
    // Some browsers / contexts disallow fullscreen — fail quietly.
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
// We synthesise a fake 6-digit code on the client just so the panel
// displays something realistic during the prototype. Wiring this to a
// real LiveSession is a TODO documented in PROJECT_NOTES at the bottom.
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
// Static URLs are resolved at build time, but dynamic import with a
// template variable inside is brittle when collectstatic kicks in.
// Trick: emit the import path via data attribute so Django's static
// resolution stays out of the JS source.
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
      showError(`This game module didn't load correctly.`);
    }
  } catch (err) {
    console.error(`Failed to load game "${gameId}":`, err);
    showError(`We couldn't load this icebreaker. Try refreshing.`);
  }
})();

function showError(msg) {
  stage.innerHTML = `
    <div class="kk-game-overlay">
      <div style="font-size: 4rem;">🙁</div>
      <h2 class="kk-game-headline">Oops</h2>
      <p class="kk-game-sub">${msg}</p>
    </div>`;
}

// Clean up when the user leaves the page.
window.addEventListener("beforeunload", () => {
  if (typeof cleanup === "function") {
    try { cleanup(); } catch (_) {}
  }
});
