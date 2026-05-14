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

/**
 * Add a neon floor, orbit rings, and tiny background particles.
 * Returns an object with animate(t) so each game can keep it alive.
 */
export function createNeonArena(THREE, scene, opts = {}) {
  const colorA = opts.colorA || "#22d3ee";
  const colorB = opts.colorB || "#7c3aed";
  const radius = opts.radius ?? 3.2;
  const y = opts.y ?? -1.15;

  const group = new THREE.Group();
  scene.add(group);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 96),
    new THREE.MeshStandardMaterial({
      color: 0x07111f,
      roughness: 0.85,
      metalness: 0.12,
      transparent: true,
      opacity: 0.72,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = y;
  floor.receiveShadow = true;
  group.add(floor);

  const ringMatA = new THREE.MeshBasicMaterial({ color: new THREE.Color(colorA), transparent: true, opacity: 0.45 });
  const ringMatB = new THREE.MeshBasicMaterial({ color: new THREE.Color(colorB), transparent: true, opacity: 0.28 });
  const outerRing = new THREE.Mesh(new THREE.RingGeometry(radius * 0.98, radius * 1.02, 128), ringMatA);
  outerRing.rotation.x = -Math.PI / 2;
  outerRing.position.y = y + 0.01;
  group.add(outerRing);

  const innerRing = new THREE.Mesh(new THREE.RingGeometry(radius * 0.48, radius * 0.50, 128), ringMatB);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = y + 0.015;
  group.add(innerRing);

  const dashGroup = new THREE.Group();
  group.add(dashGroup);
  const dashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(colorA), transparent: true, opacity: 0.36 });
  for (let i = 0; i < 32; i++) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.008, 0.035), dashMat);
    const a = (i / 32) * Math.PI * 2;
    dash.position.set(Math.cos(a) * radius * 0.78, y + 0.03, Math.sin(a) * radius * 0.78);
    dash.rotation.y = -a;
    dashGroup.add(dash);
  }

  const pGeom = new THREE.SphereGeometry(0.025, 6, 6);
  const particles = [];
  for (let i = 0; i < (opts.particles ?? 48); i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(i % 2 ? colorA : colorB),
      transparent: true,
      opacity: 0.35 + Math.random() * 0.35,
    });
    const p = new THREE.Mesh(pGeom, mat);
    const a = Math.random() * Math.PI * 2;
    const r = radius * (0.4 + Math.random() * 0.95);
    p.position.set(Math.cos(a) * r, y + 0.25 + Math.random() * 2.6, Math.sin(a) * r);
    p.userData = { a, r, s: 0.16 + Math.random() * 0.24, h: p.position.y, phase: Math.random() * Math.PI * 2 };
    group.add(p);
    particles.push(p);
  }

  return {
    group,
    animate(t) {
      outerRing.rotation.z = t * 0.12;
      innerRing.rotation.z = -t * 0.18;
      dashGroup.rotation.y = t * 0.18;
      particles.forEach((p, i) => {
        const d = p.userData;
        const a = d.a + t * d.s;
        p.position.x = Math.cos(a) * d.r;
        p.position.z = Math.sin(a) * d.r;
        p.position.y = d.h + Math.sin(t * 0.8 + d.phase + i) * 0.16;
      });
    },
  };
}

/**
 * Build a friendly low-poly game character from primitive meshes.
 * No external GLB is needed, so it works offline after collectstatic.
 */
export function createArcadeCharacter(THREE, opts = {}) {
  const color = opts.color || "#22d3ee";
  const accent = opts.accent || "#7c3aed";
  const scale = opts.scale ?? 1;
  const group = new THREE.Group();
  group.scale.setScalar(scale);

  const skin = new THREE.MeshStandardMaterial({ color: 0xffd7b5, roughness: 0.55, metalness: 0.02 });
  const suit = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: 0.38,
    metalness: 0.12,
    emissive: new THREE.Color(color),
    emissiveIntensity: 0.08,
  });
  const suitDark = new THREE.MeshStandardMaterial({
    color: new THREE.Color(accent),
    roughness: 0.42,
    metalness: 0.18,
    emissive: new THREE.Color(accent),
    emissiveIntensity: 0.12,
  });
  const black = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, emissive: 0x101827, emissiveIntensity: 0.15 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.95, 18), suit);
  body.position.y = 0.65;
  body.castShadow = true;
  group.add(body);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 12), suitDark);
  chest.scale.set(1.05, 0.45, 0.35);
  chest.position.set(0, 0.88, 0.25);
  chest.castShadow = true;
  group.add(chest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 24, 24), skin);
  head.position.y = 1.32;
  head.castShadow = true;
  group.add(head);

  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.295, 16, 12), black);
  hair.scale.set(1.05, 0.55, 1.0);
  hair.position.set(0, 1.47, -0.02);
  group.add(hair);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.075, 0.035), white);
  visor.position.set(0, 1.34, 0.255);
  group.add(visor);
  [-0.1, 0.1].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), black);
    eye.position.set(x, 1.345, 0.285);
    group.add(eye);
  });

  const armPivots = [];
  [-1, 1].forEach((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.43, 1.0, 0);
    group.add(pivot);
    armPivots.push({ pivot, side });

    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.48, 12), suitDark);
    upper.position.y = -0.24;
    upper.rotation.z = side * 0.12;
    upper.castShadow = true;
    pivot.add(upper);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 14), skin);
    hand.position.set(side * 0.03, -0.52, 0.02);
    hand.castShadow = true;
    pivot.add(hand);
  });

  const legPivots = [];
  [-1, 1].forEach((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.18, 0.18, 0);
    group.add(pivot);
    legPivots.push({ pivot, side });

    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.45, 12), suitDark);
    leg.position.y = -0.22;
    leg.castShadow = true;
    pivot.add(leg);

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.28), black);
    boot.position.set(side * 0.025, -0.48, 0.06);
    boot.castShadow = true;
    pivot.add(boot);
  });

  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.012, 8, 64),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.45 }),
  );
  glow.rotation.x = Math.PI / 2;
  glow.position.y = -0.34;
  group.add(glow);

  group.userData.animate = (t, mood = "idle") => {
    const speed = mood === "race" ? 7 : 2.2;
    const bounce = Math.sin(t * speed) * (mood === "race" ? 0.07 : 0.035);
    group.position.y += (bounce - (group.userData._lastBounce || 0));
    group.userData._lastBounce = bounce;
    armPivots.forEach(({ pivot, side }) => {
      pivot.rotation.z = side * (0.2 + Math.sin(t * speed + (side > 0 ? Math.PI : 0)) * 0.35);
      pivot.rotation.x = Math.sin(t * speed + (side > 0 ? Math.PI : 0)) * 0.28;
    });
    legPivots.forEach(({ pivot, side }) => {
      pivot.rotation.x = Math.sin(t * speed + (side > 0 ? 0 : Math.PI)) * (mood === "race" ? 0.55 : 0.12);
    });
    glow.rotation.z = t * 0.7;
    glow.material.opacity = 0.28 + Math.sin(t * 2.2) * 0.12;
  };

  return group;
}
