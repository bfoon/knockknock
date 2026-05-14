// ──────────────────────────────────────────────────────────────
// POSTURE RESET — 60s gentle seated stretch sequence.
//
// A simple human figure (built from primitive geometries — head,
// torso, arms) demonstrates 5 stretches in sequence. Each stretch
// runs ~12 seconds, with a calm caption + breathing cue.
//
// We deliberately use procedurally-rigged primitives rather than a
// GLTF model because: (a) no external asset to host, (b) full control
// of the animation, (c) it stays totally stylised — closer to a
// wellness-app illustration than a creepy CGI human.
// ──────────────────────────────────────────────────────────────

import { el, makeButton, countdown, fmtTime, speak, makeCanvasPassive, addGameArena } from "../_helpers.js";

const STRETCHES = [
  {
    name: "Tall Spine",
    cue: "Sit tall. Crown of head reaching up. Shoulders soft.",
    breathing: "Breathe in… and out…",
    duration: 12,
  },
  {
    name: "Neck Tilt Left",
    cue: "Drop your right ear toward your right shoulder. Hold.",
    breathing: "Slow inhale through the nose…",
    duration: 12,
  },
  {
    name: "Neck Tilt Right",
    cue: "Now switch. Left ear toward left shoulder.",
    breathing: "Slow inhale…",
    duration: 12,
  },
  {
    name: "Shoulder Rolls",
    cue: "Roll both shoulders backward. Slow and full circles.",
    breathing: "Easy breath, no rush.",
    duration: 12,
  },
  {
    name: "Forward Fold",
    cue: "Fold forward over your lap. Let your head hang.",
    breathing: "Exhale completely…",
    duration: 12,
  },
];

export default function init(ctx) {
  const { stage, bottom, getColors } = ctx;
  const colors = getColors();

  // ── DOM scaffold ────────────────────────────────────────────
  stage.innerHTML = "";
  const canvasHost = el("div", { class: "kk-game-canvas", parent: stage });
  canvasHost.style.position = "absolute";
  canvasHost.style.inset = "0";

  const overlay = el("div", { class: "kk-game-overlay", parent: stage });
  const timer = el("div", { class: "kk-game-timer", parent: stage, text: "60" });

  const stretchTitle = el("h2", { class: "kk-game-headline", parent: overlay });
  const stretchCue = el("p", { class: "kk-game-sub", parent: overlay });
  const breath = el("p", {
    parent: overlay,
    style: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: "0.95rem",
      letterSpacing: "0.18em",
      textTransform: "uppercase",
      color: "rgba(248, 250, 252, 0.5)",
      marginTop: "0.5rem",
    },
  });

  // ── Three.js scene ──────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0e1a, 5, 18);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 1.2, 5.5);
  camera.lookAt(0, 1, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  canvasHost.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  makeCanvasPassive(canvasHost, renderer);

  // Lights — soft 3-point setup for a calm look.
  scene.add(new THREE.AmbientLight(0x404a66, 0.6));

  const key = new THREE.DirectionalLight(new THREE.Color(colors.a), 1.0);
  key.position.set(4, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);

  const rim = new THREE.DirectionalLight(new THREE.Color(colors.b), 0.7);
  rim.position.set(-4, 3, -3);
  scene.add(rim);
  const arena = addGameArena(scene, colors);

  // ── Build a stylised figure ─────────────────────────────────
  // We rig it loosely as: hip group → torso → neck → head, with
  // shoulder pivots for the arms. Animations rotate the pivots.
  const figure = new THREE.Group();

  // Stool the figure sits on.
  const stoolMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
  const stool = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.35, 16), stoolMat);
  stool.position.y = -0.8;
  stool.receiveShadow = true;
  figure.add(stool);

  // Floor disc — catches a soft shadow under the figure.
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0a0e1a, roughness: 1 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 32), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1;
  floor.receiveShadow = true;
  figure.add(floor);

  // The figure itself uses a consistent material so it reads as a
  // single sculpted form. White-ish, slightly emissive.
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.5,
    metalness: 0.05,
    emissive: 0x1a2138,
    emissiveIntensity: 0.3,
  });

  // ── Hip pivot (the base of every animation) ────────────────
  const hipPivot = new THREE.Group();
  hipPivot.position.y = -0.45;
  figure.add(hipPivot);

  // Torso pivot — rotates relative to hip (used for forward fold + tall spine).
  const torsoPivot = new THREE.Group();
  hipPivot.add(torsoPivot);

  // Torso geometry: tapered cylinder ≈ a sitting body.
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.42, 1.1, 16),
    bodyMat,
  );
  torso.position.y = 0.6;
  torso.castShadow = true;
  torsoPivot.add(torso);

  // Neck pivot — for left/right tilts.
  const neckPivot = new THREE.Group();
  neckPivot.position.y = 1.18;
  torsoPivot.add(neckPivot);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.2, 12), bodyMat);
  neck.position.y = 0.1;
  neck.castShadow = true;
  neckPivot.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 24), bodyMat);
  head.position.y = 0.42;
  head.castShadow = true;
  neckPivot.add(head);
  const hair = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.22, 7), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.5 }));
  hair.position.y = 0.66; hair.rotation.y = 0.25; hair.castShadow = true; neckPivot.add(hair);
  [-1, 1].forEach((side) => { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 10), new THREE.MeshStandardMaterial({ color: 0x67e8f9, emissive: 0x22d3ee, emissiveIntensity: 0.7 })); eye.position.set(side * 0.09, 0.44, 0.255); neckPivot.add(eye); });

  // Shoulder pivots — for arm rolls.
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.35, 1.05, 0);
    torsoPivot.add(pivot);

    // Upper arm — hangs straight down by default, sitting against the body.
    const upper = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.1, 0.5, 10),
      bodyMat,
    );
    upper.position.y = -0.25;
    upper.castShadow = true;
    pivot.add(upper);

    // Elbow + forearm.
    const elbowPivot = new THREE.Group();
    elbowPivot.position.y = -0.5;
    pivot.add(elbowPivot);

    const forearm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.09, 0.5, 10),
      bodyMat,
    );
    forearm.position.y = -0.25;
    forearm.castShadow = true;
    elbowPivot.add(forearm);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), bodyMat);
    hand.position.y = -0.55;
    hand.castShadow = true;
    elbowPivot.add(hand);

    return { pivot, elbowPivot };
  }
  const leftArm = makeArm(-1);
  const rightArm = makeArm(1);

  // Default seated thighs — short cylinders so the figure doesn't look like a
  // post sticking out of a stool.
  function makeLeg(side) {
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.15, 0.5, 10),
      bodyMat,
    );
    m.position.set(side * 0.18, 0.1, 0.25);
    m.rotation.x = -Math.PI / 2;
    m.castShadow = true;
    hipPivot.add(m);
  }
  makeLeg(-1);
  makeLeg(1);

  scene.add(figure);

  // A subtle pulsing aura ring on the ground behind the figure — keeps the
  // composition from feeling static.
  const auraGeom = new THREE.RingGeometry(1.4, 1.6, 64);
  const auraMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colors.a),
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
  });
  const aura = new THREE.Mesh(auraGeom, auraMat);
  aura.rotation.x = -Math.PI / 2;
  aura.position.y = -0.99;
  scene.add(aura);

  // ── Animation targets ──────────────────────────────────────
  // Each stretch sets target rotations on the various pivots, then we
  // lerp toward them every frame. Holds the pose for the duration.
  const target = {
    torsoX: 0,    // forward fold
    neckZ: 0,     // ear-to-shoulder tilts
    leftShoulderZ: 0,
    rightShoulderZ: 0,
    leftShoulderX: 0,
    rightShoulderX: 0,
  };

  function poseFor(idx) {
    // Reset.
    target.torsoX = 0;
    target.neckZ = 0;
    target.leftShoulderZ = 0;
    target.rightShoulderZ = 0;
    target.leftShoulderX = 0;
    target.rightShoulderX = 0;

    switch (idx) {
      case 0: // Tall spine — small upward stretch
        target.torsoX = -0.05;
        break;
      case 1: // Tilt left (right ear toward right shoulder)
        target.neckZ = -0.45;
        break;
      case 2: // Tilt right
        target.neckZ = 0.45;
        break;
      case 3: // Shoulder rolls — handled with continuous motion in render()
        break;
      case 4: // Forward fold
        target.torsoX = 0.85;
        break;
    }
  }

  // ── Render loop ────────────────────────────────────────────
  let running = true;
  const start = performance.now();

  function render(now) {
    if (!running) return;
    requestAnimationFrame(render);

    const t = (now - start) / 1000;

    arena.userData.tick?.(t);

    // Smoothly lerp pivots toward targets.
    function lerp(curr, tgt, alpha = 0.08) { return curr + (tgt - curr) * alpha; }
    torsoPivot.rotation.x = lerp(torsoPivot.rotation.x, target.torsoX);
    neckPivot.rotation.z = lerp(neckPivot.rotation.z, target.neckZ);
    leftArm.pivot.rotation.z = lerp(leftArm.pivot.rotation.z, target.leftShoulderZ);
    rightArm.pivot.rotation.z = lerp(rightArm.pivot.rotation.z, target.rightShoulderZ);

    // Shoulder roll — sinusoidal motion when in stretch 3.
    if (currentIdx === 3) {
      const phase = t * 1.4;
      leftArm.pivot.rotation.x = lerp(leftArm.pivot.rotation.x, Math.sin(phase) * 0.5);
      rightArm.pivot.rotation.x = lerp(rightArm.pivot.rotation.x, Math.sin(phase + Math.PI) * 0.5);
    } else {
      leftArm.pivot.rotation.x = lerp(leftArm.pivot.rotation.x, 0);
      rightArm.pivot.rotation.x = lerp(rightArm.pivot.rotation.x, 0);
    }

    // Idle breathing — torso scales subtly.
    const breathe = 1 + Math.sin(t * 0.7) * 0.02;
    torso.scale.set(breathe, breathe, breathe);

    // Slow scene rotation — adds 3D feel without making it disorienting.
    figure.rotation.y = Math.sin(t * 0.15) * 0.18;

    // Aura pulses.
    const pulse = 1 + Math.sin(t * 1.2) * 0.04;
    aura.scale.set(pulse, pulse, pulse);
    auraMat.opacity = 0.12 + Math.sin(t * 1.2) * 0.06;

    renderer.render(scene, camera);
  }

  // ── Resize handling ────────────────────────────────────────
  function resize() {
    const w = canvasHost.clientWidth;
    const h = canvasHost.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvasHost);

  // ── Sequence controller ────────────────────────────────────
  let currentIdx = -1;
  let stretchTimer = null;
  let totalTimer = null;
  let started = false;

  function showStretch(idx) {
    currentIdx = idx;
    const s = STRETCHES[idx];
    stretchTitle.textContent = s.name;
    stretchCue.textContent = s.cue;
    breath.textContent = s.breathing;
    poseFor(idx);
    speak(s.name + ". " + s.cue, { rate: 0.95 });
  }

  function startSequence() {
    if (started) return;
    started = true;
    startBtn.remove();
    overlay.style.opacity = "1";

    let idx = 0;
    showStretch(idx);

    stretchTimer = countdown(STRETCHES[idx].duration, () => {});
    stretchTimer.onDone(function nextStretch() {
      idx++;
      if (idx >= STRETCHES.length) {
        // Done — show closing.
        stretchTitle.textContent = "Nicely done";
        stretchCue.textContent = "You're back. Carry that calm into what's next.";
        breath.textContent = "";
        speak("Nicely done. Welcome back.", { rate: 0.95 });
        return;
      }
      showStretch(idx);
      stretchTimer.reset(STRETCHES[idx].duration);
      stretchTimer.onDone(nextStretch);
      stretchTimer.start();
    });
    stretchTimer.start();

    totalTimer = countdown(60, (r) => {
      timer.textContent = fmtTime(r);
    });
    totalTimer.start();
  }

  // ── Initial state: muted overlay + "Begin" button ──────────
  stretchTitle.textContent = "Posture Reset";
  stretchCue.textContent = "60 seconds. Five gentle stretches. Follow the figure on screen.";
  breath.textContent = "Sit comfortably. Soften your shoulders.";
  timer.textContent = "60";

  const startBtn = makeButton('<i class="bi bi-play-fill"></i> Begin', { onClick: startSequence });
  bottom.appendChild(startBtn);

  requestAnimationFrame(render);

  // ── Cleanup ────────────────────────────────────────────────
  return () => {
    running = false;
    stretchTimer?.stop();
    totalTimer?.stop();
    ro.disconnect();
    renderer.dispose();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  };
}
