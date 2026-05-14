// ──────────────────────────────────────────────────────────────
// REACTION RACE — 3D pulsing orb. When it turns green, tap.
//
// Five rounds. Each round: 2–6s of waiting (random), then GREEN.
// The presenter (or each phone in phones-on mode) taps spacebar
// or anywhere on the screen. Reaction time displayed in ms.
//
// Tapping during the wait counts as a false-start and locks them
// out for that round.
// ──────────────────────────────────────────────────────────────

import { el, makeButton, makeCanvasPassive, addGameArena, makeGameCharacter } from "../_helpers.js";

const ROUNDS = 5;

export default function init(ctx) {
  const { stage, bottom, getColors } = ctx;
  const colors = getColors();

  stage.innerHTML = "";
  stage.style.flexDirection = "column";

  // ── Three.js scene ──────────────────────────────────────────
  const canvasHost = el("div", { class: "kk-game-canvas", parent: stage });
  canvasHost.style.position = "absolute";
  canvasHost.style.inset = "0";

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0e1a, 6, 20);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 5.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  canvasHost.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  makeCanvasPassive(canvasHost, renderer);

  scene.add(new THREE.AmbientLight(0x202840, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 0.6);
  key.position.set(3, 4, 5);
  scene.add(key);
  const arena = addGameArena(scene, colors);
  const racers = [-1.45, 1.45].map((x, i) => {
    const r = makeGameCharacter({ primary: i ? colors.b : colors.a, secondary: i ? colors.a : colors.b, scale: 0.62, skin: i ? "#f1c27d" : "#f7d6c2" });
    r.position.set(x, -0.1, -0.45);
    r.rotation.y = i ? -0.34 : 0.34;
    scene.add(r);
    return r;
  });

  // The orb: an icosahedron with subtle distortion. We swap its
  // material colour to signal phase.
  const orbGeom = new THREE.IcosahedronGeometry(1.4, 4);
  const orbMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colors.b),
    emissive: new THREE.Color(colors.b),
    emissiveIntensity: 0.35,
    metalness: 0.3,
    roughness: 0.25,
    flatShading: true,
  });
  const orb = new THREE.Mesh(orbGeom, orbMat);
  scene.add(orb);

  // A subtle glow plane behind the orb.
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 64),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(colors.b),
      transparent: true,
      opacity: 0.18,
    }),
  );
  glow.position.z = -1;
  scene.add(glow);

  // Floating particles around the orb.
  const particles = [];
  const partGeom = new THREE.SphereGeometry(0.04, 6, 6);
  const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
  for (let i = 0; i < 30; i++) {
    const p = new THREE.Mesh(partGeom, partMat.clone());
    const r = 2 + Math.random() * 1.5;
    const a = Math.random() * Math.PI * 2;
    const b = Math.random() * Math.PI - Math.PI / 2;
    p.position.set(Math.cos(a) * Math.cos(b) * r, Math.sin(b) * r, Math.sin(a) * Math.cos(b) * r);
    p.userData = { speed: 0.3 + Math.random() * 0.4, phase: Math.random() * Math.PI * 2 };
    scene.add(p);
    particles.push(p);
  }

  // ── Overlay HUD ─────────────────────────────────────────────
  const overlay = el("div", { class: "kk-game-overlay", parent: stage });
  const headline = el("h2", { class: "kk-game-headline", parent: overlay });
  const sub = el("p", { class: "kk-game-sub", parent: overlay });
  const scoreboard = el("div", {
    parent: overlay,
    style: {
      display: "flex", gap: "0.5rem", marginTop: "0.5rem",
    },
  });

  // ── Game state ──────────────────────────────────────────────
  const state = {
    phase: "idle",        // idle | wait | go | result | done
    round: 0,
    waitStart: 0,
    goAt: 0,
    times: [],            // ms per round, or "false_start"
  };
  let waitTimeout = null;
  let goTimer = null;

  function setColor(hex, emissiveMul = 0.4) {
    const c = new THREE.Color(hex);
    orbMat.color.copy(c);
    orbMat.emissive.copy(c);
    orbMat.emissiveIntensity = emissiveMul;
    glow.material.color.copy(c);
  }

  function renderScoreboard() {
    scoreboard.innerHTML = "";
    for (let i = 0; i < ROUNDS; i++) {
      const pill = el("div", {
        parent: scoreboard,
        style: {
          padding: ".4rem .7rem",
          borderRadius: "10px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: ".85rem",
          fontWeight: "700",
          background: i < state.times.length
            ? (state.times[i] === "false_start" ? "rgba(251,113,133,.2)" : "rgba(34,197,94,.18)")
            : "rgba(255,255,255,.05)",
          border: i < state.times.length
            ? (state.times[i] === "false_start" ? "1px solid rgba(251,113,133,.4)" : "1px solid rgba(34,197,94,.4)")
            : "1px solid rgba(255,255,255,.1)",
          color: i < state.times.length
            ? (state.times[i] === "false_start" ? "#fda4af" : "#86efac")
            : "rgba(248,250,252,.45)",
        },
      });
      if (i < state.times.length) {
        pill.textContent = state.times[i] === "false_start" ? "FALSE" : `${state.times[i]}ms`;
      } else {
        pill.textContent = `R${i + 1}`;
      }
    }
  }

  function renderIntro() {
    state.phase = "idle";
    state.round = 0;
    state.times = [];
    setColor(colors.b, 0.35);
    headline.textContent = "Reaction Race";
    sub.textContent = "Watch the orb. The moment it turns green — tap, or hit space. Five rounds.";
    renderScoreboard();
    bottom.innerHTML = "";
    bottom.appendChild(makeButton('<i class="bi bi-play-fill"></i> Start round 1', { onClick: nextRound }));
  }

  function nextRound() {
    if (state.round >= ROUNDS) return showFinal();
    state.round += 1;
    state.phase = "wait";
    setColor("#fbbf24", 0.4); // amber — waiting
    headline.textContent = `Round ${state.round}`;
    sub.textContent = "Wait for green…";
    bottom.innerHTML = "";
    renderScoreboard();

    // Random wait 2–6s.
    const waitMs = 2000 + Math.random() * 4000;
    state.waitStart = performance.now();
    waitTimeout = setTimeout(() => {
      state.phase = "go";
      state.goAt = performance.now();
      setColor("#22c55e", 0.8);
      headline.textContent = "GO!";
      sub.textContent = "Tap now.";
      // Auto-fail if no tap within 3s.
      goTimer = setTimeout(() => handleTap(true), 3000);
    }, waitMs);
  }

  function handleTap(timeout = false) {
    if (state.phase === "wait") {
      // False start.
      clearTimeout(waitTimeout);
      state.times.push("false_start");
      state.phase = "result";
      setColor("#fb7185", 0.5);
      headline.textContent = "Too soon!";
      sub.textContent = `False start — wait for green next time.`;
      finishRound();
      return;
    }
    if (state.phase === "go") {
      clearTimeout(goTimer);
      const dt = timeout ? 3000 : Math.round(performance.now() - state.goAt);
      state.times.push(dt);
      state.phase = "result";
      setColor("#22c55e", 0.6);
      headline.textContent = `${dt}ms`;
      sub.textContent = grade(dt);
      finishRound();
      return;
    }
  }

  function grade(ms) {
    if (ms < 220) return "Lightning. ⚡";
    if (ms < 320) return "Sharp.";
    if (ms < 450) return "Solid.";
    if (ms < 700) return "A bit slow — try again.";
    return "Wakey wakey.";
  }

  function finishRound() {
    renderScoreboard();
    bottom.innerHTML = "";
    if (state.round < ROUNDS) {
      bottom.appendChild(makeButton('<i class="bi bi-arrow-right"></i> Next round', { onClick: nextRound }));
    } else {
      bottom.appendChild(makeButton('<i class="bi bi-trophy"></i> See results', { onClick: showFinal }));
    }
  }

  function showFinal() {
    state.phase = "done";
    const valid = state.times.filter((t) => t !== "false_start");
    const avg = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
    const best = valid.length ? Math.min(...valid) : null;
    setColor(colors.a, 0.5);
    headline.textContent = avg !== null ? `Avg ${avg}ms` : "No valid rounds";
    sub.textContent = best !== null
      ? `Best: ${best}ms. ${grade(avg)}`
      : "Try again — wait for the green.";
    bottom.innerHTML = "";
    bottom.appendChild(makeButton('<i class="bi bi-arrow-clockwise"></i> Play again', { onClick: renderIntro }));
  }

  // ── Tap input — anywhere on stage, or spacebar ──────────────
  function onTap(e) {
    if (e.target.closest("button, a, input")) return; // don't double-fire
    e.preventDefault?.();
    handleTap();
  }
  stage.addEventListener("pointerdown", onTap);
  function onKey(e) { if (e.code === "Space") { e.preventDefault(); handleTap(); } }
  window.addEventListener("keydown", onKey);

  // ── Render loop ────────────────────────────────────────────
  let running = true;
  const start = performance.now();

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const t = (performance.now() - start) / 1000;

    orb.rotation.x = t * 0.3;
    orb.rotation.y = t * 0.5;

    // Pulse during wait/go phases.
    if (state.phase === "wait") {
      const p = 1 + Math.sin(t * 6) * 0.04;
      orb.scale.set(p, p, p);
    } else if (state.phase === "go") {
      const p = 1.2 + Math.sin(t * 18) * 0.1;
      orb.scale.set(p, p, p);
    } else {
      orb.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
    }

    arena.userData.tick?.(t);
    racers.forEach((r, i) => { r.userData.tick?.(t, i); r.rotation.z = Math.sin(t * 3 + i) * 0.035; });

    // Particle drift around the orb.
    for (const p of particles) {
      p.position.y += Math.sin(t * p.userData.speed + p.userData.phase) * 0.002;
      p.material.opacity = 0.3 + Math.sin(t * 1.5 + p.userData.phase) * 0.2;
    }

    // Glow pulses with the orb's emissive intensity.
    glow.material.opacity = 0.12 + orbMat.emissiveIntensity * 0.2;

    renderer.render(scene, camera);
  }

  function resize() {
    const w = canvasHost.clientWidth, h = canvasHost.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvasHost);

  renderIntro();
  loop();

  return () => {
    running = false;
    clearTimeout(waitTimeout);
    clearTimeout(goTimer);
    stage.removeEventListener("pointerdown", onTap);
    window.removeEventListener("keydown", onKey);
    ro.disconnect();
    renderer.dispose();
  };
}
