// ──────────────────────────────────────────────────────────────
// DESK YOGA FLOW
//
// Four stations, 30s each (2 min total). Same rigged-figure
// approach as Posture Reset but with different poses and a more
// "studio class" cadence — station name, breath count, transition.
//
// Stations:
//   1. Neck rolls (alternating directions)
//   2. Shoulder shrugs (up-hold-release)
//   3. Seated spinal twist
//   4. Ankle circles
// ──────────────────────────────────────────────────────────────

import { el, makeButton, countdown, fmtTime, speak, makeCanvasPassive, addGameArena } from "../_helpers.js";

const STATIONS = [
  { name: "Neck Rolls",         cue: "Slow circles, alternating direction.",  breath: "4 rolls each way",  duration: 30, motion: "neck_roll" },
  { name: "Shoulder Shrugs",    cue: "Lift up to ears. Hold. Release slowly.", breath: "5 deep breaths",    duration: 30, motion: "shrug" },
  { name: "Seated Spinal Twist",cue: "Twist gently to the right, then left.",  breath: "3 breaths each side", duration: 30, motion: "twist" },
  { name: "Ankle Circles",      cue: "Lift one foot. Draw circles.",            breath: "10 each direction", duration: 30, motion: "ankle" },
];

export default function init(ctx) {
  const { stage, bottom, getColors } = ctx;
  const colors = getColors();

  stage.innerHTML = "";

  // ── DOM scaffold ───────────────────────────────────────────
  const canvasHost = el("div", { class: "kk-game-canvas", parent: stage });
  canvasHost.style.position = "absolute";
  canvasHost.style.inset = "0";

  const overlay = el("div", { class: "kk-game-overlay", parent: stage });
  overlay.style.alignItems = "flex-start";
  overlay.style.justifyContent = "flex-end";
  overlay.style.flexDirection = "column";
  overlay.style.padding = "2rem 3rem";

  const stationCount = el("div", {
    parent: overlay,
    style: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: ".9rem",
      letterSpacing: ".18em",
      textTransform: "uppercase",
      color: "rgba(248,250,252,.5)",
      fontWeight: "700",
    },
  });
  const stationName = el("h2", {
    parent: overlay, class: "kk-game-headline",
    style: { fontSize: "clamp(2.5rem, 6vw, 5rem)", textAlign: "left" },
  });
  const stationCue = el("p", {
    parent: overlay, class: "kk-game-sub",
    style: { textAlign: "left", maxWidth: "30ch" },
  });
  const stationBreath = el("p", {
    parent: overlay,
    style: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: ".95rem",
      color: "rgba(248,250,252,.55)",
      letterSpacing: ".1em",
      textAlign: "left",
    },
  });

  const timer = el("div", { class: "kk-game-timer", parent: stage, text: "30" });

  // ── Three.js — figure (simplified version of posture_reset) ─
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0e1a, 6, 22);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  // Push figure to the right side, leave space for left-aligned text.
  camera.position.set(-1.5, 1.2, 6);
  camera.lookAt(1.8, 0.8, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  canvasHost.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  makeCanvasPassive(canvasHost, renderer);

  scene.add(new THREE.AmbientLight(0x303a55, 0.7));
  const key = new THREE.DirectionalLight(new THREE.Color(colors.a), 1.0);
  key.position.set(5, 6, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(new THREE.Color(colors.b), 0.6);
  rim.position.set(-3, 2, -4);
  scene.add(rim);
  const arena = addGameArena(scene, colors);

  // Floor.
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.5, 32),
    new THREE.MeshStandardMaterial({ color: 0x0e1422, roughness: 1 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1;
  floor.receiveShadow = true;
  scene.add(floor);

  // Figure root sits offset right.
  const figure = new THREE.Group();
  figure.position.x = 1.8;
  scene.add(figure);

  const stool = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.55, 0.35, 16),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 }),
  );
  stool.position.y = -0.8;
  figure.add(stool);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0, roughness: 0.5, metalness: 0.05,
    emissive: new THREE.Color(colors.a), emissiveIntensity: 0.08,
  });

  const hip = new THREE.Group();
  hip.position.y = -0.45;
  figure.add(hip);

  const torsoPivot = new THREE.Group();
  hip.add(torsoPivot);

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 1.1, 16), bodyMat);
  torso.position.y = 0.6;
  torso.castShadow = true;
  torsoPivot.add(torso);

  const neckPivot = new THREE.Group();
  neckPivot.position.y = 1.18;
  torsoPivot.add(neckPivot);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 24), bodyMat);
  head.position.y = 0.4;
  head.castShadow = true;
  neckPivot.add(head);
  const hair = new THREE.Mesh(new THREE.ConeGeometry(0.30, 0.22, 7), new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.5 }));
  hair.position.y = 0.64; hair.rotation.y = 0.22; hair.castShadow = true; neckPivot.add(hair);
  [-1, 1].forEach((side) => { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 10), new THREE.MeshStandardMaterial({ color: 0xa7f3d0, emissive: 0x22d3ee, emissiveIntensity: 0.7 })); eye.position.set(side * 0.09, 0.43, 0.255); neckPivot.add(eye); });

  function makeArm(side) {
    const p = new THREE.Group();
    p.position.set(side * 0.35, 1.05, 0);
    torsoPivot.add(p);
    const u = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.5, 10), bodyMat);
    u.position.y = -0.25;
    u.castShadow = true;
    p.add(u);
    const e2 = new THREE.Group();
    e2.position.y = -0.5;
    p.add(e2);
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.5, 10), bodyMat);
    f.position.y = -0.25;
    f.castShadow = true;
    e2.add(f);
    return { pivot: p, elbow: e2 };
  }
  const la = makeArm(-1), ra = makeArm(1);

  function makeLeg(side) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.5, 10), bodyMat);
    m.position.set(side * 0.18, 0.1, 0.25);
    m.rotation.x = -Math.PI / 2;
    m.castShadow = true;
    hip.add(m);
    return m;
  }
  const leftLeg = makeLeg(-1), rightLeg = makeLeg(1);

  // ── Animation state ────────────────────────────────────────
  let running = true;
  let stationIdx = 0;
  let phaseTime = 0;
  let started = false;
  let stationCD = null;

  function showStation(idx) {
    stationIdx = idx;
    const s = STATIONS[idx];
    stationCount.textContent = `Station ${idx + 1} of ${STATIONS.length}`;
    stationName.textContent = s.name;
    stationCue.textContent = s.cue;
    stationBreath.textContent = s.breath;
    timer.textContent = String(s.duration);
    speak(s.name + ". " + s.cue, { rate: 0.95 });
  }

  function startFlow() {
    if (started) return;
    started = true;
    bottom.innerHTML = "";
    bottom.appendChild(makeButton('<i class="bi bi-stop"></i> Stop', { ghost: true, onClick: stopFlow }));

    let idx = 0;
    showStation(idx);
    stationCD = countdown(STATIONS[idx].duration, (r) => { timer.textContent = fmtTime(r); });
    stationCD.onDone(function next() {
      idx += 1;
      if (idx >= STATIONS.length) {
        stationName.textContent = "Flow complete";
        stationCue.textContent = "Take one more deep breath. You're done.";
        stationBreath.textContent = "";
        speak("Flow complete. Take one more deep breath.", { rate: 0.9 });
        bottom.innerHTML = "";
        bottom.appendChild(makeButton('<i class="bi bi-arrow-clockwise"></i> Play again', { onClick: () => { started = false; startFlow(); } }));
        return;
      }
      showStation(idx);
      stationCD.reset(STATIONS[idx].duration);
      stationCD.onDone(next);
      stationCD.start();
    });
    stationCD.start();
  }

  function stopFlow() {
    if (stationCD) stationCD.stop();
    started = false;
    stationName.textContent = "Desk Yoga Flow";
    stationCue.textContent = "4 stations · 30 seconds each.";
    stationBreath.textContent = "";
    stationCount.textContent = "Tap Start when ready";
    timer.textContent = "—";
    bottom.innerHTML = "";
    bottom.appendChild(makeButton('<i class="bi bi-play-fill"></i> Start', { onClick: startFlow }));
  }

  // Initial copy.
  stopFlow();

  // ── Render loop with per-station motion ────────────────────
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const t = performance.now() / 1000;
    arena.userData.tick?.(t);
    phaseTime += 1 / 60;
    const t = phaseTime;

    const lerp = (a, b, k = 0.08) => a + (b - a) * k;

    if (started && STATIONS[stationIdx]) {
      const m = STATIONS[stationIdx].motion;
      if (m === "neck_roll") {
        // Slow conical neck rotation.
        const a = t * 1.2;
        neckPivot.rotation.x = Math.cos(a) * 0.4;
        neckPivot.rotation.z = Math.sin(a) * 0.4;
        torsoPivot.rotation.x = lerp(torsoPivot.rotation.x, 0);
        torsoPivot.rotation.y = lerp(torsoPivot.rotation.y, 0);
        la.pivot.rotation.z = lerp(la.pivot.rotation.z, 0);
        ra.pivot.rotation.z = lerp(ra.pivot.rotation.z, 0);
      } else if (m === "shrug") {
        const s = Math.max(0, Math.sin(t * 1.0));
        la.pivot.rotation.z = lerp(la.pivot.rotation.z, s * 0.35);
        ra.pivot.rotation.z = lerp(ra.pivot.rotation.z, -s * 0.35);
        neckPivot.rotation.x = lerp(neckPivot.rotation.x, 0);
        neckPivot.rotation.z = lerp(neckPivot.rotation.z, 0);
        torsoPivot.rotation.x = lerp(torsoPivot.rotation.x, 0);
        torsoPivot.rotation.y = lerp(torsoPivot.rotation.y, 0);
      } else if (m === "twist") {
        torsoPivot.rotation.y = Math.sin(t * 0.7) * 0.55;
        neckPivot.rotation.y = -Math.sin(t * 0.7) * 0.25;
        la.pivot.rotation.z = lerp(la.pivot.rotation.z, 0);
        ra.pivot.rotation.z = lerp(ra.pivot.rotation.z, 0);
        torsoPivot.rotation.x = lerp(torsoPivot.rotation.x, 0);
      } else if (m === "ankle") {
        // Flex one foot's leg slightly up to suggest ankle action.
        leftLeg.position.y = lerp(leftLeg.position.y, 0.15 + Math.sin(t * 2) * 0.05);
        leftLeg.rotation.z = lerp(leftLeg.rotation.z, Math.sin(t * 3) * 0.15);
        torsoPivot.rotation.x = lerp(torsoPivot.rotation.x, 0);
        torsoPivot.rotation.y = lerp(torsoPivot.rotation.y, 0);
        neckPivot.rotation.x = lerp(neckPivot.rotation.x, 0);
        neckPivot.rotation.z = lerp(neckPivot.rotation.z, 0);
      }
    } else {
      // Idle — settle to neutral.
      torsoPivot.rotation.x = lerp(torsoPivot.rotation.x, 0);
      torsoPivot.rotation.y = lerp(torsoPivot.rotation.y, 0);
      neckPivot.rotation.x = lerp(neckPivot.rotation.x, 0);
      neckPivot.rotation.z = lerp(neckPivot.rotation.z, 0);
      neckPivot.rotation.y = lerp(neckPivot.rotation.y, 0);
      la.pivot.rotation.z = lerp(la.pivot.rotation.z, 0);
      ra.pivot.rotation.z = lerp(ra.pivot.rotation.z, 0);
      leftLeg.position.y = lerp(leftLeg.position.y, 0.1);
      leftLeg.rotation.z = lerp(leftLeg.rotation.z, 0);
    }

    // Subtle breathing.
    const b = 1 + Math.sin(t * 0.7) * 0.02;
    torso.scale.set(b, b, b);

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
    if (stationCD) stationCD.stop();
    ro.disconnect();
    renderer.dispose();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  };
}
