// ──────────────────────────────────────────────────────────────
// THE CONDUCTOR
//
// A 3D baton sweeps left-right in tempo. On each beat, the screen
// shows the motion to do: clap, snap, foot-tap, two-finger drum.
// Tempo starts slow, builds, settles. ~90 seconds total.
//
// Every motion has a big icon + label so people copy the screen,
// not each other — no awkwardness.
// ──────────────────────────────────────────────────────────────

import { el, makeButton, countdown, fmtTime, makeCanvasPassive, addGameArena, makeGameCharacter } from "../_helpers.js";

const SEQUENCE = [
  { motion: "clap",    label: "CLAP",          icon: "👏", bpm: 60, beats: 8 },
  { motion: "clap",    label: "CLAP",          icon: "👏", bpm: 75, beats: 8 },
  { motion: "snap",    label: "SNAP",          icon: "🫰", bpm: 90, beats: 8 },
  { motion: "foot",    label: "FOOT TAP",      icon: "🦶", bpm: 100, beats: 8 },
  { motion: "double",  label: "DOUBLE CLAP",   icon: "👏👏", bpm: 90, beats: 8 },
  { motion: "drum",    label: "DESK DRUM",     icon: "🥁", bpm: 110, beats: 12 },
  { motion: "clap",    label: "CLAP",          icon: "👏", bpm: 80, beats: 8 },
  { motion: "slow",    label: "BREATHE",       icon: "🌬️", bpm: 50, beats: 4 },
];

export default function init(ctx) {
  const { stage, bottom, getColors } = ctx;
  const colors = getColors();

  stage.innerHTML = "";

  // ── Three.js scene — baton + arc ────────────────────────────
  const canvasHost = el("div", { class: "kk-game-canvas", parent: stage });
  canvasHost.style.position = "absolute";
  canvasHost.style.inset = "0";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 7);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  canvasHost.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  makeCanvasPassive(canvasHost, renderer);

  scene.add(new THREE.AmbientLight(0x303a55, 0.7));
  const key = new THREE.DirectionalLight(new THREE.Color(colors.a), 0.9);
  key.position.set(3, 4, 5);
  scene.add(key);
  const arena = addGameArena(scene, colors);
  const conductor = makeGameCharacter({ primary: colors.a, secondary: colors.b, scale: 0.72, skin: "#f1c27d" });
  conductor.position.set(-1.65, -0.05, -0.45);
  conductor.rotation.y = 0.45;
  scene.add(conductor);

  // Baton — a tapered handle + a glowing tip.
  const baton = new THREE.Group();
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.05, 2.2, 12),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.6, roughness: 0.25 }),
  );
  handle.rotation.z = Math.PI / 2;
  baton.add(handle);

  // Glowing tip — colour shifts with each motion change.
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 16, 16),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(colors.a),
      emissive: new THREE.Color(colors.a),
      emissiveIntensity: 1,
    }),
  );
  tip.position.x = 1.2;
  baton.add(tip);

  baton.position.x = 0.75;
  scene.add(baton);

  // Glow halo around the tip.
  const halo = new THREE.Mesh(
    new THREE.CircleGeometry(0.5, 32),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(colors.a),
      transparent: true,
      opacity: 0.25,
    }),
  );
  halo.position.copy(tip.position);
  halo.position.z = -0.1;
  baton.add(halo);

  // Trail dots that mark the last several beat positions.
  const trail = [];
  for (let i = 0; i < 12; i++) {
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 8, 8),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(colors.a),
        transparent: true,
        opacity: 0,
      }),
    );
    scene.add(dot);
    trail.push(dot);
  }

  // ── HUD ─────────────────────────────────────────────────────
  // Nudge the overlay up a touch so the oversized motion icon never
  // reaches down into the footer control bar.
  const overlay = el("div", { class: "kk-game-overlay", parent: stage });
  overlay.style.justifyContent = "center";
  overlay.style.paddingBottom = "7rem";
  const motionIcon = el("div", {
    parent: overlay,
    style: {
      fontSize: "clamp(4.5rem, 12vw, 10rem)",
      lineHeight: "1",
      transition: "transform .1s ease",
      filter: "drop-shadow(0 8px 30px rgba(0,0,0,.4))",
    },
  });
  const motionLabel = el("h2", {
    parent: overlay, class: "kk-game-headline",
    style: { fontSize: "clamp(2rem, 5vw, 4rem)", letterSpacing: ".05em" },
  });
  const tempoLabel = el("p", {
    parent: overlay,
    style: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: ".95rem",
      color: "rgba(248,250,252,.55)",
      letterSpacing: ".15em",
      textTransform: "uppercase",
    },
  });

  const timer = el("div", { class: "kk-game-timer", parent: stage, text: "—" });

  // Footer: raise its stacking context and give it a solid backing so
  // nothing in the scene/overlay can render over the controls.
  function dressBottom() {
    bottom.style.position = "relative";
    bottom.style.zIndex = "60";
    bottom.style.background = "linear-gradient(0deg, rgba(10,14,26,.96), rgba(10,14,26,.78))";
    bottom.style.backdropFilter = "blur(8px)";
  }
  dressBottom();

  // ── State ──────────────────────────────────────────────────
  let running = true;
  let seqIdx = 0;
  let beatCount = 0;
  let beatInterval = null;
  let phase = 0;            // 0..1 sweep phase
  let bpm = 60;
  let totalCD = null;

  function setMotion(item) {
    motionIcon.textContent = item.icon;
    motionLabel.textContent = item.label;
    tempoLabel.textContent = `${item.bpm} BPM`;
    bpm = item.bpm;
    // Colour shift on tip.
    const colour = item.motion === "slow" ? "#a3e635"
      : item.motion === "drum" ? "#fb7185"
      : item.motion === "snap" ? "#fbbf24"
      : item.motion === "foot" ? "#06b6d4"
      : colors.a;
    tip.material.color.set(colour);
    tip.material.emissive.set(colour);
    halo.material.color.set(colour);
  }

  function startSequence() {
    if (totalCD) totalCD.stop();
    seqIdx = 0;
    beatCount = 0;
    bottom.innerHTML = "";
    dressBottom();
    bottom.appendChild(makeButton('<i class="bi bi-stop-fill"></i> Stop', { ghost: true, onClick: stopSequence }));

    const totalSec = SEQUENCE.reduce((a, s) => a + (s.beats * 60) / s.bpm, 0);
    totalCD = countdown(totalSec, (r) => { timer.textContent = fmtTime(r); });
    totalCD.start();

    setMotion(SEQUENCE[0]);
    tickBeat(); // immediate first beat
    scheduleNextBeat();
  }

  function scheduleNextBeat() {
    if (!running) return;
    const intervalMs = (60 / bpm) * 1000;
    beatInterval = setTimeout(() => {
      tickBeat();
      scheduleNextBeat();
    }, intervalMs);
  }

  function tickBeat() {
    beatCount += 1;

    // Animate the icon "thump".
    motionIcon.style.transform = "scale(1.18)";
    setTimeout(() => { motionIcon.style.transform = "scale(1)"; }, 100);

    // After this motion's beats, advance.
    const current = SEQUENCE[seqIdx];
    if (beatCount >= current.beats) {
      beatCount = 0;
      seqIdx += 1;
      if (seqIdx >= SEQUENCE.length) {
        finish();
        return;
      }
      setMotion(SEQUENCE[seqIdx]);
    }
  }

  function stopSequence() {
    clearTimeout(beatInterval);
    if (totalCD) totalCD.stop();
    motionIcon.textContent = "✋";
    motionLabel.textContent = "Stopped";
    tempoLabel.textContent = "Tap Start to resume";
    bottom.innerHTML = "";
    dressBottom();
    bottom.appendChild(makeButton('<i class="bi bi-play-fill"></i> Restart', { onClick: startSequence }));
  }

  function finish() {
    clearTimeout(beatInterval);
    if (totalCD) totalCD.stop();
    motionIcon.textContent = "🎉";
    motionLabel.textContent = "Nicely done";
    tempoLabel.textContent = "Welcome back to the meeting";
    bottom.innerHTML = "";
    dressBottom();
    bottom.appendChild(makeButton('<i class="bi bi-arrow-clockwise"></i> Play again', { onClick: startSequence }));
  }

  // ── Initial state ──────────────────────────────────────────
  motionIcon.textContent = "🎼";
  motionLabel.textContent = "The Conductor";
  tempoLabel.textContent = "Follow the baton";
  timer.textContent = "—";
  bottom.appendChild(makeButton('<i class="bi bi-play-fill"></i> Start', { onClick: startSequence }));

  // ── Render loop ────────────────────────────────────────────
  let trailIdx = 0;

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);

    const t = performance.now() / 1000;
    arena.userData.tick?.(t); conductor.userData.tick?.(t, 0);

    // Sweep phase locked to bpm.
    phase += (bpm / 60) * (1 / 60); // approx frames at 60fps
    const sweep = Math.sin(phase * Math.PI * 2);
    baton.rotation.z = sweep * 0.55;

    // Position trail along the baton tip's path.
    const tipWorld = new THREE.Vector3();
    tip.getWorldPosition(tipWorld);
    trailIdx = (trailIdx + 1) % trail.length;
    trail[trailIdx].position.copy(tipWorld);
    trail.forEach((d, i) => {
      // Fade out older trail dots.
      const age = (trail.length + trailIdx - i) % trail.length;
      d.material.opacity = Math.max(0, 0.5 - age / trail.length * 0.5);
    });

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

  loop();

  return () => {
    running = false;
    clearTimeout(beatInterval);
    if (totalCD) totalCD.stop();
    ro.disconnect();
    renderer.dispose();
  };
}