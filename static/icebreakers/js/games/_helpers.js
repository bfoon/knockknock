// Shared helpers used by every icebreaker game module.
//
// v3 — "Neon Arena" visual upgrade:
//   • makeGameCharacter(): fully articulated hero avatar — lathe-sculpted
//     torso, smooth helmet + glowing visor, segmented arms/legs with elbow
//     and knee joints, jet backpack with flickering thrusters, orbiting
//     energy sparks, blinking eyes, weight-shift idle, breathing, and a
//     personal accent light. Same drop-in API: returns a THREE.Group whose
//     userData.tick(t, i) drives everything — no game changes needed.
//   • addGameArena(): cinematic environment — tech-grid floor texture,
//     triple rotating light rings, an expanding pulse ring, six floating
//     holo-pylons with emissive strips, rising light beams, drifting
//     ember particles and a soft hemisphere fill. Same API:
//     group.userData.tick(t).
//
// Compatible with the global THREE r128 loaded in play.html.

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

/* ────────────────────────────────────────────────────────────────
   Internal: procedural textures (shared/cached so multiple games
   or multiple characters don't rebuild identical canvases).
   ──────────────────────────────────────────────────────────────── */

let _floorTexCache = null;
function makeFloorTexture(a, b) {
  // The grid is neutral enough to be shared across colour themes;
  // tint comes from the ring lights layered above it.
  if (_floorTexCache) return _floorTexCache;
  const c = document.createElement("canvas");
  c.width = c.height = 1024;
  const g = c.getContext("2d");

  // Deep radial base.
  const base = g.createRadialGradient(512, 512, 60, 512, 512, 512);
  base.addColorStop(0, "#131a30");
  base.addColorStop(0.55, "#0b1020");
  base.addColorStop(1, "#060912");
  g.fillStyle = base;
  g.fillRect(0, 0, 1024, 1024);

  // Concentric tech rings.
  g.strokeStyle = "rgba(148,163,184,0.10)";
  g.lineWidth = 2;
  for (let r = 90; r <= 500; r += 82) {
    g.beginPath();
    g.arc(512, 512, r, 0, Math.PI * 2);
    g.stroke();
  }
  // Radial spokes.
  g.strokeStyle = "rgba(148,163,184,0.06)";
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(512 + Math.cos(t) * 90, 512 + Math.sin(t) * 90);
    g.lineTo(512 + Math.cos(t) * 505, 512 + Math.sin(t) * 505);
    g.stroke();
  }
  // Fine hex-ish node dots where rings meet spokes.
  g.fillStyle = "rgba(226,232,240,0.14)";
  for (let r = 172; r <= 500; r += 82) {
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * Math.PI * 2;
      g.beginPath();
      g.arc(512 + Math.cos(t) * r, 512 + Math.sin(t) * r, 2.2, 0, Math.PI * 2);
      g.fill();
    }
  }
  // Centre emblem ring.
  g.strokeStyle = "rgba(226,232,240,0.20)";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(512, 512, 64, 0, Math.PI * 2);
  g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  _floorTexCache = tex;
  return tex;
}

let _glowTexCache = null;
function makeGlowTexture() {
  if (_glowTexCache) return _glowTexCache;
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.28)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  _glowTexCache = new THREE.CanvasTexture(c);
  return _glowTexCache;
}

/* ────────────────────────────────────────────────────────────────
   ARENA — cinematic environment.
   Same API as before: addGameArena(scene, {a, b}) → group with
   userData.tick(t).
   ──────────────────────────────────────────────────────────────── */
export function addGameArena(scene, colors = {}) {
  const a = colors.a || "#22d3ee";
  const b = colors.b || "#7c3aed";
  const colA = new THREE.Color(a);
  const colB = new THREE.Color(b);
  const group = new THREE.Group();

  // Soft hemisphere fill so environments never read flat-black.
  const hemi = new THREE.HemisphereLight(0x27314f, 0x05070d, 0.45);
  group.add(hemi);

  // ── Floor: tech-grid disc + faint reflective sheen disc ─────
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(6.2, 96),
    new THREE.MeshStandardMaterial({
      map: makeFloorTexture(a, b),
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.3,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.25;
  floor.receiveShadow = true;
  group.add(floor);

  // Additive colour wash on the floor centre.
  const wash = new THREE.Mesh(
    new THREE.CircleGeometry(3.4, 64),
    new THREE.MeshBasicMaterial({
      map: makeGlowTexture(),
      color: colA.clone().lerp(colB, 0.5),
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  wash.rotation.x = -Math.PI / 2;
  wash.position.y = -1.24;
  group.add(wash);

  // ── Triple rotating light rings ──────────────────────────────
  function ring(inner, outer, color, opacity, y) {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(inner, outer, 128),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    group.add(m);
    return m;
  }
  const ring1 = ring(2.2, 2.3, colA, 0.5, -1.22);
  const ring2 = ring(3.25, 3.33, colB, 0.34, -1.21);
  const ring3 = ring(4.35, 4.4, colA.clone().lerp(colB, 0.5), 0.22, -1.2);

  // Dashed inner ring segments (arcs) that spin faster.
  const dashGroup = new THREE.Group();
  dashGroup.position.y = -1.19;
  dashGroup.rotation.x = -Math.PI / 2;
  for (let i = 0; i < 8; i++) {
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(1.55, 1.63, 32, 1, (i / 8) * Math.PI * 2, Math.PI / 10),
      new THREE.MeshBasicMaterial({
        color: colA, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    dashGroup.add(arc);
  }
  group.add(dashGroup);

  // ── Expanding pulse ring ─────────────────────────────────────
  const pulse = new THREE.Mesh(
    new THREE.RingGeometry(0.96, 1.0, 96),
    new THREE.MeshBasicMaterial({
      color: colA, transparent: true, opacity: 0,
      side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  pulse.rotation.x = -Math.PI / 2;
  pulse.position.y = -1.23;
  group.add(pulse);

  // ── Floating holo-pylons around the edge ─────────────────────
  const pylons = [];
  const pylonBodyMat = new THREE.MeshStandardMaterial({
    color: 0x121a2e, roughness: 0.35, metalness: 0.75,
  });
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 + 0.35;
    const px = Math.cos(t) * 5.1;
    const pz = Math.sin(t) * 5.1;
    const p = new THREE.Group();
    p.position.set(px, -0.35, pz);

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 1.5, 6), pylonBodyMat);
    body.castShadow = true;
    p.add(body);

    const strip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 1.2, 6),
      new THREE.MeshBasicMaterial({
        color: i % 2 ? colB : colA, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    strip.position.z = 0.11;
    p.add(strip);

    const cap = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      new THREE.MeshStandardMaterial({
        color: i % 2 ? colB : colA,
        emissive: i % 2 ? colB : colA,
        emissiveIntensity: 0.9,
        roughness: 0.25, metalness: 0.4,
      })
    );
    cap.position.y = 1.0;
    p.add(cap);

    p.userData = { baseY: -0.35, phase: i * 1.1, cap, strip };
    group.add(p);
    pylons.push(p);
  }

  // ── Rising light beams ───────────────────────────────────────
  const beams = [];
  for (let i = 0; i < 5; i++) {
    const t = (i / 5) * Math.PI * 2 + 1.1;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.09, 4.5, 6, 1, true),
      new THREE.MeshBasicMaterial({
        color: i % 2 ? colA : colB,
        transparent: true, opacity: 0.10,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      })
    );
    beam.position.set(Math.cos(t) * 4.0, 1.0, Math.sin(t) * 4.0);
    beam.userData = { phase: i * 1.9 };
    group.add(beam);
    beams.push(beam);
  }

  // ── Ember particles drifting above the floor ─────────────────
  const embers = [];
  const emberGeom = new THREE.SphereGeometry(0.028, 6, 6);
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(
      emberGeom,
      new THREE.MeshBasicMaterial({
        color: i % 2 ? colA : colB,
        transparent: true, opacity: 0.25 + Math.random() * 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    const r = 2.2 + Math.random() * 3.8;
    const t = Math.random() * Math.PI * 2;
    m.position.set(Math.cos(t) * r, -1.1 + Math.random() * 2.4, Math.sin(t) * r);
    m.userData = {
      baseY: m.position.y,
      speed: 0.25 + Math.random() * 0.5,
      phase: Math.random() * Math.PI * 2,
      drift: 0.05 + Math.random() * 0.2,
    };
    group.add(m);
    embers.push(m);
  }

  // Static ground dots (cheap, no per-frame work).
  const dotGeom = new THREE.SphereGeometry(0.022, 5, 5);
  for (let i = 0; i < 60; i++) {
    const dot = new THREE.Mesh(
      dotGeom,
      new THREE.MeshBasicMaterial({
        color: i % 2 ? colA : colB,
        transparent: true, opacity: 0.22 + Math.random() * 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    const r = 2.6 + Math.random() * 3.3;
    const t = Math.random() * Math.PI * 2;
    dot.position.set(Math.cos(t) * r, -1.22, Math.sin(t) * r);
    group.add(dot);
  }

  // ── Animation ───────────────────────────────────────────────
  group.userData.tick = (t) => {
    ring1.rotation.z = t * 0.18;
    ring2.rotation.z = -t * 0.12;
    ring3.rotation.z = t * 0.07;
    dashGroup.rotation.z = -t * 0.45;

    // Pulse: expands 1 → 4.4 over a 3.2s cycle, fading out.
    const pt = (t % 3.2) / 3.2;
    const ps = 1 + pt * 3.4;
    pulse.scale.set(ps, ps, 1);
    pulse.material.opacity = 0.4 * (1 - pt) * (1 - pt);

    for (const p of pylons) {
      p.position.y = p.userData.baseY + Math.sin(t * 0.8 + p.userData.phase) * 0.12;
      p.userData.cap.rotation.y = t * 1.4 + p.userData.phase;
      p.userData.cap.position.y = 1.0 + Math.sin(t * 1.6 + p.userData.phase) * 0.06;
      p.userData.strip.material.opacity = 0.65 + Math.sin(t * 3 + p.userData.phase) * 0.3;
    }
    for (const bm of beams) {
      bm.material.opacity = 0.05 + Math.max(0, Math.sin(t * 0.5 + bm.userData.phase)) * 0.10;
      bm.rotation.y = t * 0.2;
    }
    for (const em of embers) {
      const u = em.userData;
      em.position.y = u.baseY + Math.sin(t * u.speed + u.phase) * 0.5;
      em.position.x += Math.sin(t * 0.3 + u.phase) * 0.001;
      em.material.opacity = 0.2 + (Math.sin(t * 1.4 + u.phase) * 0.5 + 0.5) * 0.4;
    }
  };

  scene.add(group);
  return group;
}

/* ────────────────────────────────────────────────────────────────
   CHARACTER — high-end articulated hero avatar.

   Sculpt notes:
   • Torso is a LatheGeometry silhouette (waist → chest flare) so it
     reads as a designed suit rather than a stacked cylinder.
   • Smooth helmet dome, wraparound emissive visor, twin bright eyes,
     ear pods and a trim fin give the head its identity.
   • Arms and legs are two-segment with real joint pivots, so the idle
     animation can bend elbows/knees naturally.
   • Jet backpack with two flickering thruster cones, orbiting energy
     sparks, layered aura rings and a soft ground glow sell the
     "arena hero" fantasy.
   • A small tinted PointLight is parented to the chest so the
     character lights its surroundings (cheap: 1 light per character).

   API is unchanged: makeGameCharacter({primary, secondary, skin,
   scale}) → THREE.Group with userData.tick(t, i). All internal bob /
   sway happens on an inner "body" group, so games remain free to set
   group.position/rotation without fighting the idle animation.
   ──────────────────────────────────────────────────────────────── */
export function makeGameCharacter(opts = {}) {
  const primary = opts.primary || "#22d3ee";
  const secondary = opts.secondary || "#7c3aed";
  const skin = opts.skin || "#f4d2b8";
  const colP = new THREE.Color(primary);
  const colS = new THREE.Color(secondary);

  const group = new THREE.Group();
  group.scale.setScalar(opts.scale ?? 1);

  // Inner body: all idle motion happens here so games can freely
  // position/rotate the outer group.
  const body = new THREE.Group();
  group.add(body);

  // ── Materials ───────────────────────────────────────────────
  const matSkin = new THREE.MeshStandardMaterial({
    color: new THREE.Color(skin), roughness: 0.45, metalness: 0.03,
  });
  const matSuit = new THREE.MeshStandardMaterial({
    color: colP, roughness: 0.3, metalness: 0.5,
    emissive: colP, emissiveIntensity: 0.05,
  });
  const matSuitDark = new THREE.MeshStandardMaterial({
    color: colS.clone().multiplyScalar(0.5), roughness: 0.4, metalness: 0.55,
  });
  const matTrim = new THREE.MeshStandardMaterial({
    color: colS, roughness: 0.22, metalness: 0.6,
    emissive: colS, emissiveIntensity: 0.65,
  });
  const matHelmet = new THREE.MeshStandardMaterial({
    color: 0xeaf0f8, roughness: 0.18, metalness: 0.65,
  });
  const matVisor = new THREE.MeshStandardMaterial({
    color: 0x0a101f, roughness: 0.1, metalness: 0.35,
    emissive: colP, emissiveIntensity: 0.9,
  });
  const matDark = new THREE.MeshStandardMaterial({
    color: 0x0f172a, roughness: 0.42, metalness: 0.35,
  });
  const matGlowP = new THREE.MeshBasicMaterial({
    color: colP, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });

  // ── Torso: lathe-sculpted suit silhouette ───────────────────
  const torsoCore = new THREE.Group();
  torsoCore.position.y = 0.18;
  body.add(torsoCore);

  const lathePts = [
    new THREE.Vector2(0.14, -0.46),
    new THREE.Vector2(0.27, -0.40),
    new THREE.Vector2(0.31, -0.24),
    new THREE.Vector2(0.27, -0.04),  // waist
    new THREE.Vector2(0.30, 0.14),
    new THREE.Vector2(0.35, 0.30),   // chest flare
    new THREE.Vector2(0.30, 0.42),
    new THREE.Vector2(0.15, 0.48),
  ];
  const torso = new THREE.Mesh(new THREE.LatheGeometry(lathePts, 32), matSuit);
  torso.castShadow = true;
  torsoCore.add(torso);

  // Chest plate + glowing arc reactor core.
  const plate = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 16, 0, Math.PI), matSuitDark);
  plate.position.set(0, 0.24, 0.1);
  plate.scale.set(1, 0.65, 0.75);
  plate.castShadow = true;
  torsoCore.add(plate);

  const core = new THREE.Mesh(
    new THREE.CircleGeometry(0.08, 24),
    new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: colP, emissiveIntensity: 1.4, roughness: 0.15,
    })
  );
  core.position.set(0, 0.22, 0.325);
  torsoCore.add(core);
  const coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.018, 10, 28), matTrim);
  coreRing.position.copy(core.position);
  torsoCore.add(coreRing);

  // Collar + belt trims.
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.035, 12, 32), matTrim);
  collar.position.y = 0.48; collar.rotation.x = Math.PI / 2;
  torsoCore.add(collar);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.285, 0.032, 12, 32), matTrim);
  belt.position.y = -0.06; belt.rotation.x = Math.PI / 2;
  torsoCore.add(belt);
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.05), matDark);
  buckle.position.set(0, -0.06, 0.3);
  torsoCore.add(buckle);

  // ── Jet backpack + thrusters ────────────────────────────────
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.16), matSuitDark);
  pack.position.set(0, 0.22, -0.3);
  pack.castShadow = true;
  torsoCore.add(pack);
  const packTrim = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.17), matTrim);
  packTrim.position.set(0, 0.22, -0.305);
  torsoCore.add(packTrim);

  const thrusters = [];
  [-1, 1].forEach((side) => {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.075, 0.14, 12), matDark);
    nozzle.position.set(side * 0.1, -0.03, -0.3);
    torsoCore.add(nozzle);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.22, 10), matGlowP.clone());
    flame.rotation.x = Math.PI;
    flame.position.set(side * 0.1, -0.2, -0.3);
    torsoCore.add(flame);
    thrusters.push(flame);
  });

  // ── Neck + head ─────────────────────────────────────────────
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.12, 14), matSkin);
  neck.position.y = 0.7;
  body.add(neck);

  const headPivot = new THREE.Group();
  headPivot.position.y = 0.76;
  body.add(headPivot);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 32, 32), matSkin);
  head.position.y = 0.16;
  head.scale.set(1, 1.06, 0.95);
  head.castShadow = true;
  headPivot.add(head);

  // Helmet dome hugging the skull, with a rear plate.
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.29, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.6),
    matHelmet
  );
  helmet.position.y = 0.18;
  helmet.castShadow = true;
  headPivot.add(helmet);
  const helmetBack = new THREE.Mesh(
    new THREE.SphereGeometry(0.285, 24, 18, Math.PI * 0.75, Math.PI * 0.5, Math.PI * 0.35, Math.PI * 0.55),
    matHelmet
  );
  helmetBack.position.y = 0.17;
  headPivot.add(helmetBack);

  // Wraparound visor band + twin eyes.
  const visor = new THREE.Mesh(new THREE.TorusGeometry(0.225, 0.05, 16, 44, Math.PI * 1.15), matVisor);
  visor.position.set(0, 0.17, 0.045);
  visor.rotation.set(Math.PI / 2, 0, -Math.PI * 0.075);
  headPivot.add(visor);

  const eyes = [];
  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.036, 14, 14),
      new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: colP, emissiveIntensity: 1.3, roughness: 0.15,
      })
    );
    eye.position.set(side * 0.095, 0.175, 0.245);
    headPivot.add(eye);
    eyes.push(eye);
  });

  // Ear pods + fin.
  [-1, 1].forEach((side) => {
    const pod = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 12), matTrim);
    pod.position.set(side * 0.265, 0.16, 0.02);
    pod.scale.set(0.6, 1, 1);
    headPivot.add(pod);
  });
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.17, 0.2), matTrim);
  fin.position.set(0, 0.37, -0.05);
  fin.rotation.x = -0.2;
  headPivot.add(fin);

  // ── Arms: shoulder pivot → upper → elbow pivot → forearm → glove
  const arms = [];
  [-1, 1].forEach((side) => {
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.15, 20, 16), matSuitDark);
    shoulder.position.set(side * 0.4, 0.56, 0);
    shoulder.scale.set(1.15, 0.9, 1.05);
    shoulder.castShadow = true;
    body.add(shoulder);
    const pad = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.02, 10, 26), matTrim);
    pad.position.copy(shoulder.position);
    pad.rotation.y = Math.PI / 2;
    body.add(pad);

    const armPivot = new THREE.Group();
    armPivot.position.set(side * 0.44, 0.54, 0);
    body.add(armPivot);

    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.34, 14), matSuit);
    upper.position.y = -0.19;
    upper.castShadow = true;
    armPivot.add(upper);

    const elbowPivot = new THREE.Group();
    elbowPivot.position.y = -0.37;
    armPivot.add(elbowPivot);

    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 12), matSuitDark);
    elbowPivot.add(elbow);
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.06, 0.32, 14), matSuit);
    fore.position.y = -0.18;
    fore.castShadow = true;
    elbowPivot.add(fore);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.072, 0.016, 10, 22), matTrim);
    cuff.position.y = -0.3;
    cuff.rotation.x = Math.PI / 2;
    elbowPivot.add(cuff);
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 14), matDark);
    glove.position.y = -0.4;
    glove.scale.set(1, 1.08, 1.12);
    glove.castShadow = true;
    elbowPivot.add(glove);

    arms.push({ armPivot, elbowPivot, side });
  });

  // ── Legs: hip pivot → thigh → knee pivot → shin → boot ──────
  const legs = [];
  [-1, 1].forEach((side) => {
    const hipPivot = new THREE.Group();
    hipPivot.position.set(side * 0.16, -0.28, 0);
    body.add(hipPivot);

    const hip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 14), matSuitDark);
    hipPivot.add(hip);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.09, 0.38, 14), matSuit);
    thigh.position.y = -0.22;
    thigh.castShadow = true;
    hipPivot.add(thigh);

    const kneePivot = new THREE.Group();
    kneePivot.position.y = -0.44;
    hipPivot.add(kneePivot);

    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 12), matSuitDark);
    kneePivot.add(knee);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.068, 0.36, 14), matSuit);
    shin.position.y = -0.2;
    shin.castShadow = true;
    kneePivot.add(shin);
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.12, 0.32), matDark);
    boot.position.set(0, -0.42, 0.06);
    boot.castShadow = true;
    kneePivot.add(boot);
    const bootTrim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.028, 0.33), matTrim);
    bootTrim.position.set(0, -0.35, 0.06);
    kneePivot.add(bootTrim);

    legs.push({ hipPivot, kneePivot, side });
  });

  // ── Energy: layered aura rings + ground glow + orbit sparks ──
  const aura = new THREE.Mesh(
    new THREE.TorusGeometry(0.58, 0.014, 10, 80),
    new THREE.MeshBasicMaterial({
      color: colS, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  aura.rotation.x = Math.PI / 2;
  aura.position.y = -1.18;
  group.add(aura);

  const auraInner = new THREE.Mesh(
    new THREE.TorusGeometry(0.38, 0.01, 10, 64),
    new THREE.MeshBasicMaterial({
      color: colP, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  auraInner.rotation.x = Math.PI / 2;
  auraInner.position.y = -1.16;
  group.add(auraInner);

  const groundGlow = new THREE.Mesh(
    new THREE.CircleGeometry(0.75, 32),
    new THREE.MeshBasicMaterial({
      map: makeGlowTexture(), color: colP, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  groundGlow.rotation.x = -Math.PI / 2;
  groundGlow.position.y = -1.19;
  group.add(groundGlow);

  const sparks = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 8, 8),
      new THREE.MeshBasicMaterial({
        color: i === 1 ? colS : colP, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    s.userData = {
      radius: 0.55 + i * 0.12,
      speed: 1.2 + i * 0.5,
      phase: i * 2.1,
      tilt: 0.3 + i * 0.35,
      height: 0.15 + i * 0.18,
    };
    group.add(s);
    sparks.push(s);
  }

  // Personal accent light — makes the character pop out of fog.
  const charLight = new THREE.PointLight(colP, 0.4, 3.2, 2);
  charLight.position.set(0, 0.3, 0.5);
  group.add(charLight);

  // ── Idle animation (same signature as before) ───────────────
  group.userData.tick = (t, i = 0) => {
    // Hover bob + gentle weight shift on the inner body only.
    body.position.y = Math.sin(t * 1.6 + i) * 0.035;
    body.rotation.z = Math.sin(t * 0.8 + i) * 0.02;

    // Breathing — chest scales subtly.
    const br = 1 + Math.sin(t * 1.1 + i) * 0.018;
    torsoCore.scale.set(br, 1, br);

    // Head look-around.
    headPivot.rotation.y = Math.sin(t * 1.3 + i) * 0.16;
    headPivot.rotation.z = Math.sin(t * 0.9 + i) * 0.045;
    headPivot.rotation.x = Math.sin(t * 0.6 + i + 1) * 0.03;

    // Blink: eyes squash briefly every ~4s (offset per character).
    const bt = (t + i * 1.7) % 4.2;
    const blink = bt < 0.12 ? 0.12 : 1;
    eyes[0].scale.y = blink;
    eyes[1].scale.y = blink;

    // Arm sway with elbow follow-through.
    arms.forEach(({ armPivot, elbowPivot, side }) => {
      const ph = side > 0 ? Math.PI : 0;
      armPivot.rotation.z = side * 0.14 + Math.sin(t * 1.6 + i + ph) * 0.07;
      armPivot.rotation.x = Math.sin(t * 1.2 + i + ph) * 0.06;
      elbowPivot.rotation.x = -0.18 + Math.sin(t * 1.6 + i + ph + 0.7) * 0.1;
    });

    // Legs: relaxed micro-bend that alternates.
    legs.forEach(({ hipPivot, kneePivot, side }) => {
      const ph = side > 0 ? Math.PI : 0;
      hipPivot.rotation.x = Math.sin(t * 0.9 + i + ph) * 0.04;
      kneePivot.rotation.x = 0.06 + Math.sin(t * 0.9 + i + ph + 0.5) * 0.05;
    });

    // Energy layer.
    aura.rotation.z = t * 0.9;
    auraInner.rotation.z = -t * 1.3;
    aura.material.opacity = 0.4 + Math.sin(t * 2 + i) * 0.15;
    groundGlow.material.opacity = 0.16 + Math.sin(t * 2 + i) * 0.06;

    for (const s of sparks) {
      const u = s.userData;
      const a2 = t * u.speed + u.phase + i;
      s.position.set(
        Math.cos(a2) * u.radius,
        u.height + Math.sin(a2 * 1.3) * 0.22,
        Math.sin(a2) * u.radius * Math.cos(u.tilt)
      );
      s.material.opacity = 0.55 + Math.sin(a2 * 2) * 0.3;
    }

    // Thruster flicker + visor / core pulse.
    thrusters.forEach((f, k) => {
      const fl = 0.8 + Math.sin(t * 17 + k * 2.3 + i) * 0.14 + Math.sin(t * 7.3 + k) * 0.06;
      f.scale.set(1, fl, 1);
      f.material.opacity = 0.35 + fl * 0.25;
    });
    matVisor.emissiveIntensity = 0.75 + Math.sin(t * 3 + i) * 0.25;
    core.material.emissiveIntensity = 1.1 + Math.sin(t * 2.4 + i) * 0.4;
    charLight.intensity = 0.35 + Math.sin(t * 2.4 + i) * 0.08;
  };

  return group;
}