// ──────────────────────────────────────────────────────────────
// MOOD CONSTELLATION
//
// Each participant submits one word + an energy score (1–10).
// Words appear as floating labels in a 3D starfield. The Y-axis
// is energy (low at the bottom, high at the top). Frequency scales
// the label size. Duplicates pulse together.
//
// Two input modes:
//   - phones-on: phones submit, the presenter screen reflects
//     submissions live.
//   - screen-only: presenter types/picks the words on-screen.
// ──────────────────────────────────────────────────────────────

import { el, makeButton, makeCanvasPassive, addGameArena, makeGameCharacter } from "../_helpers.js";

export default function init(ctx) {
  const { stage, bottom, getColors, phonesOn } = ctx;
  const colors = getColors();

  stage.innerHTML = "";

  // ── Three.js scene ──────────────────────────────────────────
  const canvasHost = el("div", { class: "kk-game-canvas", parent: stage });
  canvasHost.style.position = "absolute";
  canvasHost.style.inset = "0";

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  camera.position.set(0, 0, 14);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  canvasHost.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  makeCanvasPassive(canvasHost, renderer);

  scene.add(new THREE.AmbientLight(0x303a55, 0.7));
  const key = new THREE.DirectionalLight(new THREE.Color(colors.a), 0.6);
  key.position.set(3, 4, 6);
  scene.add(key);

  // Arena floor + a single guide character at the base of the field.
  // Pushed well below the active word range so it never sits behind
  // the footer controls.
  const arena = addGameArena(scene, colors);
  arena.position.y = -6.5;
  const guide = makeGameCharacter({ primary: colors.a, secondary: colors.b, scale: 0.5, skin: "#f7d6c2" });
  guide.position.set(0, -6.3, 2.0);
  scene.add(guide);

  // ── Starfield background ───────────────────────────────────
  const starGeom = new THREE.BufferGeometry();
  const starCount = 800;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    starPos[i * 3]     = (Math.random() - 0.5) * 60;
    starPos[i * 3 + 1] = (Math.random() - 0.5) * 30;
    starPos[i * 3 + 2] = (Math.random() - 0.5) * 50 - 10;
  }
  starGeom.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  const stars = new THREE.Points(
    starGeom,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.06,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  scene.add(stars);

  // Vertical bounds for the word field. Kept clear of the top HUD and
  // the bottom controls so nothing in the constellation overlaps the UI.
  const FIELD_TOP = 4.6;
  const FIELD_BOTTOM = -3.4;
  const FIELD_SPAN = FIELD_TOP - FIELD_BOTTOM;

  // ── Word sprites ───────────────────────────────────────────
  function makeWordSprite(word, color) {
    const canvas = document.createElement("canvas");
    const fontSize = 80;
    const padding = 16;
    canvas.width = 1024;
    canvas.height = 256;
    const g = canvas.getContext("2d");
    g.font = `800 ${fontSize}px 'Clash Display', system-ui, sans-serif`;
    const w = Math.min(g.measureText(word).width + padding * 2, canvas.width);

    g.clearRect(0, 0, canvas.width, canvas.height);
    g.shadowColor = color;
    g.shadowBlur = 24;
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `800 ${fontSize}px 'Clash Display', system-ui, sans-serif`;
    g.fillText(word, canvas.width / 2, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(4, 1, 1);
    spr.userData.textWidth = w;
    return spr;
  }

  const submissions = []; // [{ word, energy, count, sprite, baseY, baseX, pulse }]

  function addSubmission(word, energy) {
    word = String(word).trim().slice(0, 22);
    if (!word) return;
    energy = Math.max(1, Math.min(10, Number(energy) || 5));

    const norm = word.toLowerCase();
    let existing = submissions.find((s) => s.norm === norm);
    if (existing) {
      existing.count += 1;
      existing.energy = (existing.energy + energy) / 2;
      const scale = 4 + Math.log2(existing.count + 1) * 1.5;
      existing.sprite.scale.set(scale, scale / 4, 1);
      existing.pulse = 1;
      updateSubmissionPosition(existing);
      updateCount();
      return;
    }

    const palette = [colors.a, colors.b, "#fb7185", "#fbbf24", "#a3e635"];
    const color = palette[submissions.length % palette.length];
    const sprite = makeWordSprite(word, color);
    scene.add(sprite);

    const sub = {
      word, norm, energy, count: 1, sprite,
      baseY: 0, baseX: 0,
      pulse: 1,
      color,
    };
    submissions.push(sub);
    updateSubmissionPosition(sub);
    updateCount();
  }

  function updateSubmissionPosition(sub) {
    // Map energy 1..10 into the clear field range.
    sub.baseY = FIELD_BOTTOM + ((sub.energy - 1) / 9) * FIELD_SPAN;
    let h = 0;
    for (let i = 0; i < sub.word.length; i++) h = (h * 31 + sub.word.charCodeAt(i)) | 0;
    sub.baseX = ((h % 1000) / 1000 - 0.5) * 14;
    sub.sprite.position.set(sub.baseX, sub.baseY, -2 + Math.random() * 3);
  }

  function updateCount() {
    countEl.textContent = `${submissions.reduce((a, s) => a + s.count, 0)} submissions · ${submissions.length} unique`;
  }

  // ── Energy axis labels ─────────────────────────────────────
  const axisLabels = [
    { y: FIELD_TOP, text: "⚡ HIGH ENERGY" },
    { y: (FIELD_TOP + FIELD_BOTTOM) / 2, text: "○ STEADY" },
    { y: FIELD_BOTTOM, text: "💤 LOW ENERGY" },
  ];
  for (const a of axisLabels) {
    const c = document.createElement("canvas");
    c.width = 512; c.height = 64;
    const g = c.getContext("2d");
    g.font = "700 28px 'JetBrains Mono', monospace";
    g.fillStyle = "rgba(255,255,255,.35)";
    g.textAlign = "left";
    g.textBaseline = "middle";
    g.fillText(a.text, 8, 32);
    const tex = new THREE.CanvasTexture(c);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    spr.scale.set(4, 0.5, 1);
    spr.position.set(-7.5, a.y, -3);
    scene.add(spr);
  }

  // ── HUD ────────────────────────────────────────────────────
  const hud = el("div", {
    parent: stage,
    style: {
      position: "absolute",
      top: "1.5rem",
      left: "50%",
      transform: "translateX(-50%)",
      textAlign: "center",
      zIndex: "5",
      pointerEvents: "none",
    },
  });
  const eyebrow = el("p", {
    parent: hud,
    style: {
      fontSize: ".75rem",
      letterSpacing: ".2em",
      textTransform: "uppercase",
      color: "rgba(248,250,252,.6)",
      fontWeight: "700",
      margin: "0 0 .4rem 0",
    },
  });
  eyebrow.textContent = "How is the room feeling?";
  const countEl = el("p", {
    parent: hud,
    style: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: ".85rem",
      color: "rgba(248,250,252,.4)",
      margin: 0,
    },
  });
  countEl.textContent = "Waiting for the first submission…";

  // ── Manual-entry footer ────────────────────────────────────
  // The footer lives in the runner's <footer> bar, which already sits
  // above the canvas. We additionally raise its stacking context and
  // give it a solid backing so no sprite can ever bleed over the
  // controls.
  function buildBottom() {
    bottom.innerHTML = "";
    bottom.style.position = "relative";
    bottom.style.zIndex = "60";
    bottom.style.background = "linear-gradient(0deg, rgba(10,14,26,.96), rgba(10,14,26,.78))";
    bottom.style.backdropFilter = "blur(8px)";

    const form = el("form", {
      parent: bottom,
      style: { display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "center", justifyContent: "center" },
    });
    form.innerHTML = `
      <input type="text" id="mc-word" placeholder="One word" maxlength="22" autocomplete="off"
        style="padding:.7rem 1rem; border-radius:12px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.12); color:#f8fafc; width:200px;" />
      <input type="number" id="mc-energy" placeholder="Energy 1–10" min="1" max="10"
        style="padding:.7rem 1rem; border-radius:12px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.12); color:#f8fafc; width:140px;" />
    `;
    const submit = makeButton('<i class="bi bi-plus-lg"></i> Add', {});
    submit.type = "submit";
    form.appendChild(submit);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const w = form.querySelector("#mc-word").value;
      const en = form.querySelector("#mc-energy").value || 5;
      if (!w.trim()) return;
      addSubmission(w, en);
      form.reset();
      form.querySelector("#mc-word").focus();
    });

    const clear = makeButton('<i class="bi bi-trash"></i> Clear', {
      ghost: true,
      onClick: () => {
        for (const s of submissions) scene.remove(s.sprite);
        submissions.length = 0;
        countEl.textContent = "Waiting for the first submission…";
      },
    });
    bottom.appendChild(clear);
  }
  buildBottom();

  // Seed submissions so the empty state doesn't look broken.
  setTimeout(() => {
    if (submissions.length === 0) {
      ["focused", "tired", "curious", "energised", "ready"].forEach((w, i) => {
        addSubmission(w, [6, 3, 7, 9, 8][i]);
      });
    }
  }, 600);

  // ── Render loop ────────────────────────────────────────────
  let running = true;
  const start = performance.now();

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const t = (performance.now() - start) / 1000;

    camera.position.x = Math.sin(t * 0.1) * 0.5;
    camera.position.y = Math.sin(t * 0.13) * 0.3;
    camera.lookAt(0, 0.4, 0);

    stars.rotation.y = t * 0.005;

    for (const s of submissions) {
      s.sprite.position.x = s.baseX + Math.sin(t * 0.6 + s.baseY) * 0.4;
      s.sprite.position.y = s.baseY + Math.cos(t * 0.5 + s.baseX) * 0.25;
      if (s.pulse > 0) {
        s.pulse = Math.max(0, s.pulse - 0.02);
        const k = 1 + s.pulse * 0.3;
        s.sprite.material.opacity = 0.6 + s.pulse * 0.4;
        const baseScale = 4 + Math.log2(s.count + 1) * 1.5;
        s.sprite.scale.set(baseScale * k, baseScale * k / 4, 1);
      }
    }

    arena.userData.tick?.(t);
    guide.userData.tick?.(t, 0);
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
    ro.disconnect();
    renderer.dispose();
    for (const s of submissions) {
      s.sprite.material.map?.dispose();
      s.sprite.material.dispose();
    }
  };
}