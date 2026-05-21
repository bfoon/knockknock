// Shared helpers used by every icebreaker game module.

/** Create + append an element with optional class/text/HTML. */
export function el(tag, opts = {}) {
  const e = document.createElement(tag);
  if (opts.class) e.className = opts.class;
  if (opts.text) e.textContent = opts.text;
  if (opts.html) e.innerHTML = opts.html;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
  if (opts.style) Object.assign(e.style, opts.style);
  if (opts.parent) opts.parent.appendChild(e);
  return e;
}

/** Build a primary big-button. Returns the <button>. */
export function makeButton(label, opts = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = opts.ghost ? "kk-stage-btn kk-stage-btn-ghost" : "kk-stage-btn";
  b.innerHTML = label;
  if (opts.onClick) b.addEventListener("click", opts.onClick);
  return b;
}

/** Format seconds → "MM:SS" or "SS". */
export function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  if (s < 60) return String(s);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Lightweight countdown.
 *   const c = countdown(60, n => display.textContent = n);
 *   c.start();
 *   c.stop();
 *   c.onDone(() => { ... });
 */
export function countdown(seconds, onTick) {
  let remaining = seconds;
  let raf = null;
  let last = 0;
  let doneCb = null;
  let running = false;

  function tick(t) {
    if (!running) return;
    if (!last) last = t;
    const dt = (t - last) / 1000;
    last = t;
    remaining -= dt;
    if (remaining <= 0) {
      running = false;
      onTick?.(0);
      doneCb?.();
      return;
    }
    onTick?.(remaining);
    raf = requestAnimationFrame(tick);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
    },
    reset(newSec) {
      this.stop();
      remaining = newSec ?? seconds;
      onTick?.(remaining);
    },
    onDone(cb) { doneCb = cb; },
    getRemaining() { return remaining; },
  };
}

/** Pick a random element. */
export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Shuffle in-place (Fisher–Yates). */
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Web Speech API — say a short cue. Silently no-ops if unsupported. */
export function speak(text, opts = {}) {
  if (!("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.rate = opts.rate ?? 1;
    u.pitch = opts.pitch ?? 1;
    u.volume = opts.volume ?? 0.85;
    window.speechSynthesis.speak(u);
  } catch (_) { /* ignore */ }
}


/** Mark a Three.js canvas host as visual-only so browser clicks reach HTML controls. */
export function makeCanvasPassive(canvasHost, renderer) {
  if (!canvasHost) return;
  canvasHost.style.pointerEvents = "none";
  canvasHost.style.zIndex = "0";
  if (renderer?.domElement) {
    renderer.domElement.style.pointerEvents = "none";
    renderer.domElement.style.touchAction = "none";
  }
}

/** Add a polished sci-fi arena floor, light rings and stars. */
export function addGameArena(scene, colors = {}) {
  const a = colors.a || "#22d3ee";
  const b = colors.b || "#7c3aed";
  const group = new THREE.Group();

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(5.2, 96),
    new THREE.MeshStandardMaterial({ color: 0x0b1020, roughness: 0.72, metalness: 0.18 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.25;
  floor.receiveShadow = true;
  group.add(floor);

  const ring1 = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 2.28, 128),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(a), transparent: true, opacity: 0.38, side: THREE.DoubleSide })
  );
  ring1.rotation.x = -Math.PI / 2;
  ring1.position.y = -1.22;
  group.add(ring1);

  const ring2 = new THREE.Mesh(
    new THREE.RingGeometry(3.25, 3.32, 128),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(b), transparent: true, opacity: 0.26, side: THREE.DoubleSide })
  );
  ring2.rotation.x = -Math.PI / 2;
  ring2.position.y = -1.21;
  group.add(ring2);

  const dotGeom = new THREE.SphereGeometry(0.025, 6, 6);
  for (let i = 0; i < 90; i++) {
    const dot = new THREE.Mesh(dotGeom, new THREE.MeshBasicMaterial({ color: i % 2 ? new THREE.Color(a) : new THREE.Color(b), transparent: true, opacity: 0.28 + Math.random() * 0.42 }));
    const r = 2.5 + Math.random() * 3.4;
    const t = Math.random() * Math.PI * 2;
    dot.position.set(Math.cos(t) * r, -1.05 + Math.random() * 0.04, Math.sin(t) * r);
    group.add(dot);
  }

  group.userData.tick = (t) => {
    ring1.rotation.z = t * 0.18;
    ring2.rotation.z = -t * 0.12;
  };
  scene.add(group);
  return group;
}

/**
 * Build a modern, game-like stylised character from primitives.
 *
 * Design direction: a sleek "arena avatar" — rounded capsule torso,
 * a smooth helmet with a glowing visor band, segmented shoulder pads
 * with emissive trim, tapered limbs ending in chunky boots/gloves,
 * and a hovering energy ring at the feet. Reads as a contemporary
 * stylised hero rather than the older blocky figure.
 *
 * Compatible drop-in: still returns a THREE.Group whose
 * userData.tick(t, i) drives an idle hover + subtle look-around,
 * so every existing game keeps working unchanged.
 *
 * opts: { primary, secondary, skin, scale }
 */
export function makeGameCharacter(opts = {}) {
  const primary = opts.primary || "#22d3ee";
  const secondary = opts.secondary || "#7c3aed";
  const skin = opts.skin || "#f4d2b8";
  const group = new THREE.Group();
  group.scale.setScalar(opts.scale ?? 1);

  // ── Materials ──────────────────────────────────────────────
  const matSkin = new THREE.MeshStandardMaterial({ color: new THREE.Color(skin), roughness: 0.48, metalness: 0.04 });
  const matSuit = new THREE.MeshStandardMaterial({
    color: new THREE.Color(primary), roughness: 0.34, metalness: 0.42,
    emissive: new THREE.Color(primary), emissiveIntensity: 0.06,
  });
  const matSuitDark = new THREE.MeshStandardMaterial({
    color: new THREE.Color(secondary).multiplyScalar(0.55), roughness: 0.42, metalness: 0.5,
  });
  const matTrim = new THREE.MeshStandardMaterial({
    color: new THREE.Color(secondary), roughness: 0.26, metalness: 0.55,
    emissive: new THREE.Color(secondary), emissiveIntensity: 0.55,
  });
  const matHelmet = new THREE.MeshStandardMaterial({ color: 0xe8eef7, roughness: 0.22, metalness: 0.6 });
  const matVisor = new THREE.MeshStandardMaterial({
    color: 0x0b1220, roughness: 0.12, metalness: 0.3,
    emissive: new THREE.Color(primary), emissiveIntensity: 0.85,
  });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.45, metalness: 0.3 });

  // ── Torso: capsule-style (cylinder + sphere caps) ──────────
  const torsoCore = new THREE.Group();
  torsoCore.position.y = 0.18;
  group.add(torsoCore);

  const torsoMid = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.30, 0.62, 28), matSuit);
  torsoMid.castShadow = true; torsoCore.add(torsoMid);
  const torsoTop = new THREE.Mesh(new THREE.SphereGeometry(0.34, 28, 20, 0, Math.PI * 2, 0, Math.PI / 2), matSuit);
  torsoTop.position.y = 0.31; torsoTop.castShadow = true; torsoCore.add(torsoTop);
  const torsoBot = new THREE.Mesh(new THREE.SphereGeometry(0.30, 28, 20, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), matSuit);
  torsoBot.position.y = -0.31; torsoBot.castShadow = true; torsoCore.add(torsoBot);

  // Glowing chest core + collar trim.
  const core = new THREE.Mesh(new THREE.CircleGeometry(0.085, 24), matTrim);
  core.position.set(0, 0.16, 0.335); torsoCore.add(core);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 12, 32), matTrim);
  collar.position.y = 0.34; collar.rotation.x = Math.PI / 2; torsoCore.add(collar);
  const beltTrim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 12, 32), matTrim);
  beltTrim.position.y = -0.24; beltTrim.rotation.x = Math.PI / 2; torsoCore.add(beltTrim);

  // ── Neck + helmet ──────────────────────────────────────────
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.12, 16), matSkin);
  neck.position.y = 0.56; group.add(neck);

  const headPivot = new THREE.Group();
  headPivot.position.y = 0.62; group.add(headPivot);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 32, 32), matSkin);
  head.position.y = 0.16; head.scale.set(1, 1.05, 0.96); head.castShadow = true; headPivot.add(head);

  // Helmet shell — smooth dome that hugs the back/top of the head.
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.3, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.62), matHelmet);
  helmet.position.y = 0.18; helmet.castShadow = true; headPivot.add(helmet);
  // Visor band — the signature modern detail.
  const visor = new THREE.Mesh(new THREE.TorusGeometry(0.235, 0.05, 16, 40, Math.PI), matVisor);
  visor.position.set(0, 0.17, 0.06); visor.rotation.set(Math.PI / 2, 0, 0); headPivot.add(visor);
  // Two crisp glowing eyes inside the visor.
  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.038, 14, 14),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(primary), emissiveIntensity: 1.2, roughness: 0.2 }));
    eye.position.set(side * 0.1, 0.18, 0.255); headPivot.add(eye);
  });
  // Helmet fin / antenna for personality.
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.18), matTrim);
  fin.position.set(0, 0.36, -0.04); headPivot.add(fin);

  // ── Arms: tapered upper + forearm + chunky glove ───────────
  const armPivots = [];
  [-1, 1].forEach((side) => {
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 16), matSuitDark);
    shoulder.position.set(side * 0.42, 0.42, 0); shoulder.scale.set(1.1, 0.95, 1.05); shoulder.castShadow = true;
    group.add(shoulder);
    // Emissive shoulder pad ridge.
    const pad = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 10, 24), matTrim);
    pad.position.copy(shoulder.position); pad.rotation.y = side * Math.PI / 2; group.add(pad);

    const pivot = new THREE.Group();
    pivot.position.set(side * 0.46, 0.42, 0); group.add(pivot);
    armPivots.push({ pivot, side });

    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.075, 0.36, 14), matSuit);
    upper.position.y = -0.2; upper.castShadow = true; pivot.add(upper);
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 12), matSuitDark);
    elbow.position.y = -0.38; pivot.add(elbow);
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.34, 14), matSuit);
    fore.position.y = -0.56; fore.castShadow = true; pivot.add(fore);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 14), matDark);
    glove.position.y = -0.76; glove.scale.set(1, 1.05, 1.1); glove.castShadow = true; pivot.add(glove);
  });

  // ── Legs: tapered thigh + shin + boot ──────────────────────
  [-1, 1].forEach((side) => {
    const hip = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 14), matSuitDark);
    hip.position.set(side * 0.17, -0.32, 0); group.add(hip);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.1, 0.42, 14), matSuit);
    thigh.position.set(side * 0.17, -0.55, 0); thigh.castShadow = true; group.add(thigh);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.08, 0.4, 14), matSuitDark);
    shin.position.set(side * 0.17, -0.9, 0.02); shin.castShadow = true; group.add(shin);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.13, 0.34), matDark);
    boot.position.set(side * 0.17, -1.12, 0.07); boot.castShadow = true; group.add(boot);
    const bootTrim = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.03, 0.35), matTrim);
    bootTrim.position.set(side * 0.17, -1.05, 0.07); group.add(bootTrim);
  });

  // ── Hovering energy ring at the feet ───────────────────────
  const aura = new THREE.Mesh(
    new THREE.TorusGeometry(0.6, 0.014, 10, 80),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(secondary), transparent: true, opacity: 0.55 })
  );
  aura.rotation.x = Math.PI / 2; aura.position.y = -1.18; group.add(aura);
  const auraInner = new THREE.Mesh(
    new THREE.TorusGeometry(0.4, 0.01, 10, 64),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(primary), transparent: true, opacity: 0.4 })
  );
  auraInner.rotation.x = Math.PI / 2; auraInner.position.y = -1.16; group.add(auraInner);

  // ── Idle animation (same signature as before) ──────────────
  group.userData.tick = (t, i = 0) => {
    group.position.y += Math.sin(t * 2.2 + i) * 0.0009;
    headPivot.rotation.y = Math.sin(t * 1.3 + i) * 0.14;
    headPivot.rotation.z = Math.sin(t * 0.9 + i) * 0.04;
    armPivots.forEach(({ pivot, side }) => {
      pivot.rotation.z = side * 0.12 + Math.sin(t * 1.6 + i + (side > 0 ? Math.PI : 0)) * 0.06;
    });
    aura.rotation.z = t * 0.9;
    auraInner.rotation.z = -t * 1.3;
    aura.material.opacity = 0.4 + Math.sin(t * 2 + i) * 0.15;
    visor.material.emissiveIntensity = 0.7 + Math.sin(t * 3 + i) * 0.25;
  };
  return group;
}