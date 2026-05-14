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

/** Build an original stylised game character from primitives. */
export function makeGameCharacter(opts = {}) {
  const primary = opts.primary || "#22d3ee";
  const secondary = opts.secondary || "#7c3aed";
  const skin = opts.skin || "#f4d2b8";
  const group = new THREE.Group();
  group.scale.setScalar(opts.scale ?? 1);

  const matSkin = new THREE.MeshStandardMaterial({ color: new THREE.Color(skin), roughness: 0.52, metalness: 0.02 });
  const matSuit = new THREE.MeshStandardMaterial({ color: new THREE.Color(primary), roughness: 0.38, metalness: 0.16, emissive: new THREE.Color(primary), emissiveIntensity: 0.04 });
  const matTrim = new THREE.MeshStandardMaterial({ color: new THREE.Color(secondary), roughness: 0.32, metalness: 0.22, emissive: new THREE.Color(secondary), emissiveIntensity: 0.18 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.5, metalness: 0.18 });
  const matEye = new THREE.MeshStandardMaterial({ color: 0xbff7ff, emissive: 0x22d3ee, emissiveIntensity: 0.9, roughness: 0.2 });

  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.82, 24), matSuit);
  torso.position.y = 0.05; torso.castShadow = true; group.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.18, 0.08), matTrim);
  chest.position.set(0, 0.25, 0.31); chest.castShadow = true; group.add(chest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.31, 28, 28), matSkin);
  head.position.y = 0.74; head.castShadow = true; group.add(head);
  const hair = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.26, 7), matDark);
  hair.position.y = 1.0; hair.rotation.y = Math.PI / 7; hair.castShadow = true; group.add(hair);

  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), matEye);
    eye.position.set(side * 0.105, 0.77, 0.285); group.add(eye);
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), matTrim);
    shoulder.position.set(side * 0.48, 0.34, 0); shoulder.scale.set(1.25, .75, .95); shoulder.castShadow = true; group.add(shoulder);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.52, 12), matSuit);
    arm.position.set(side * 0.58, -0.02, 0); arm.rotation.z = side * -0.2; arm.castShadow = true; group.add(arm);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 14), matDark);
    glove.position.set(side * 0.65, -0.32, 0.04); glove.castShadow = true; group.add(glove);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.10, 0.55, 12), matDark);
    leg.position.set(side * 0.15, -0.62, 0); leg.castShadow = true; group.add(leg);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.34), matTrim);
    boot.position.set(side * 0.16, -0.92, 0.07); boot.castShadow = true; group.add(boot);
  });

  const aura = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.012, 8, 64),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(secondary), transparent: true, opacity: 0.5 })
  );
  aura.rotation.x = Math.PI / 2; aura.position.y = -1.02; group.add(aura);

  group.userData.tick = (t, i = 0) => {
    group.position.y += Math.sin(t * 2.2 + i) * 0.0008;
    head.rotation.y = Math.sin(t * 1.3 + i) * 0.12;
    aura.rotation.z = t * 0.9;
    aura.material.opacity = 0.35 + Math.sin(t * 2 + i) * 0.12;
  };
  return group;
}
