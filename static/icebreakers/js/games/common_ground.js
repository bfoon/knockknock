// ──────────────────────────────────────────────────────────────
// COMMON GROUND BINGO
//
// A 3D cube floats on screen, slowly tumbling. Each "face" shows a
// trait ("Has lived in more than two countries"). Presenter clicks
// Next; the cube tumbles to reveal another. Standing room shows
// you who shares each trait.
//
// 24 carefully-chosen prompts — workplace-appropriate, slightly
// curious, never invasive.
// ──────────────────────────────────────────────────────────────

import { el, makeButton, shuffle, makeCanvasPassive, addGameArena, makeGameCharacter } from "../_helpers.js";

const PROMPTS = [
  "Has lived in three or more countries",
  "Speaks more than two languages",
  "Has a sibling working in a totally different field",
  "Has visited every continent except one",
  "Plays a musical instrument",
  "Used to do a job nothing like their current one",
  "Has run, walked, or cycled a long-distance event",
  "Wakes up before 6am most days",
  "Reads physical books, not e-books",
  "Has cooked a meal from another culture in the last week",
  "Once spent a full week without internet on purpose",
  "Has appeared in a published photograph or video",
  "Owns more than ten plants",
  "Can name every country in their region from memory",
  "Knows how to drive a manual transmission",
  "Has volunteered for a cause this year",
  "Has changed jobs in the past two years",
  "Has presented to more than 100 people at once",
  "Prefers writing by hand to typing for ideas",
  "Has met someone famous (even briefly)",
  "Has a hobby their colleagues don't know about",
  "Has been awake for sunrise this month",
  "Has lived somewhere without four seasons",
  "Has taught themselves a new skill in the past year",
];

export default function init(ctx) {
  const { stage, bottom, getColors } = ctx;
  const colors = getColors();

  stage.innerHTML = "";

  // ── Three.js scene ──────────────────────────────────────────
  const canvasHost = el("div", { class: "kk-game-canvas", parent: stage });
  canvasHost.style.position = "absolute";
  canvasHost.style.inset = "0";

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0e1a, 5, 15);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 5);

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
  const fill = new THREE.DirectionalLight(new THREE.Color(colors.b), 0.5);
  fill.position.set(-3, -2, 4);
  scene.add(fill);

  // The cube — six rounded gradient faces. The trait text actually
  // lives on a DOM overlay (much sharper than canvas textures).
  // The cube is purely the aesthetic backdrop that rotates.
  const cubeGroup = new THREE.Group();
  scene.add(cubeGroup);

  // Build a cube of six face meshes — one for each side, each with
  // a different gradient colour so the rotating reveal feels alive.
  const faceColors = [
    [colors.a, "#0e7490"], [colors.b, "#5b21b6"], ["#fb7185", "#9f1239"],
    ["#fbbf24", "#b45309"], ["#a3e635", "#3f6212"], ["#06b6d4", "#155e75"],
  ];

  function makeFaceTexture(c1, c2) {
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 512;
    const g = canvas.getContext("2d");
    const grad = g.createRadialGradient(256, 256, 50, 256, 256, 400);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
    // Add a subtle grid pattern.
    g.strokeStyle = "rgba(255,255,255,0.08)";
    g.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
      g.beginPath();
      g.moveTo((512 / 8) * i, 0);
      g.lineTo((512 / 8) * i, 512);
      g.moveTo(0, (512 / 8) * i);
      g.lineTo(512, (512 / 8) * i);
      g.stroke();
    }
    return new THREE.CanvasTexture(canvas);
  }

  const materials = faceColors.map(([c1, c2]) =>
    new THREE.MeshStandardMaterial({
      map: makeFaceTexture(c1, c2),
      roughness: 0.4,
      metalness: 0.15,
      emissive: new THREE.Color(c1),
      emissiveIntensity: 0.15,
    }),
  );

  const cube = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), materials);
  cubeGroup.add(cube);

  // Soft outer wireframe shell for depth.
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2.4, 2.4, 2.4)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.15 }),
  );
  cubeGroup.add(wire);

  // ── HUD overlay ─────────────────────────────────────────────
  const overlay = el("div", { class: "kk-game-overlay", parent: stage });
  const eyebrow = el("p", {
    parent: overlay,
    style: {
      fontSize: ".85rem",
      letterSpacing: ".18em",
      textTransform: "uppercase",
      color: "rgba(248,250,252,.55)",
      fontWeight: "700",
      marginBottom: "0",
    },
  });
  eyebrow.textContent = "Stand if it's true for you";

  const card = el("div", {
    parent: overlay,
    style: {
      position: "relative",
      maxWidth: "780px",
      padding: "2rem 2.5rem",
      borderRadius: "24px",
      background: "linear-gradient(135deg, rgba(15,23,42,.85), rgba(15,23,42,.55))",
      backdropFilter: "blur(14px)",
      border: "1px solid rgba(255,255,255,.12)",
      boxShadow: "0 30px 80px rgba(0,0,0,.4)",
    },
  });

  const promptText = el("h2", {
    parent: card,
    class: "kk-game-headline",
    style: {
      fontSize: "clamp(1.8rem, 4vw, 3rem)",
      margin: "0",
      transition: "opacity .35s ease, transform .35s ease",
    },
  });

  const counter = el("p", {
    parent: overlay,
    style: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: ".85rem",
      color: "rgba(248,250,252,.55)",
    },
  });

  // ── State ──────────────────────────────────────────────────
  const queue = shuffle(PROMPTS.slice());
  let idx = -1;

  function nextPrompt() {
    idx = (idx + 1) % queue.length;
    promptText.style.opacity = "0";
    promptText.style.transform = "translateY(8px)";
    setTimeout(() => {
      promptText.textContent = queue[idx];
      promptText.style.opacity = "1";
      promptText.style.transform = "translateY(0)";
    }, 200);
    counter.textContent = `Prompt ${idx + 1} of ${queue.length}`;

    // Tumble the cube to a new face.
    cubeTarget.x += (Math.random() - 0.5) * Math.PI;
    cubeTarget.y += (Math.random() - 0.5) * Math.PI * 1.2;
  }

  // ── Bottom controls ────────────────────────────────────────
  bottom.innerHTML = "";
  bottom.appendChild(makeButton('<i class="bi bi-arrow-right-circle-fill"></i> Next prompt', { onClick: nextPrompt }));
  bottom.appendChild(makeButton('<i class="bi bi-shuffle"></i> Shuffle', {
    ghost: true,
    onClick: () => { shuffle(queue); idx = -1; nextPrompt(); },
  }));

  // ── Render loop ────────────────────────────────────────────
  const cubeTarget = { x: 0.3, y: 0.4 };
  let running = true;

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);

    const t = performance.now() / 1000;
    arena.userData.tick?.(t);
    hostA.userData.tick?.(t, 0); hostB.userData.tick?.(t, 1.5);

    // Drift toward target rotation + a continuous slow spin.
    cube.rotation.x += (cubeTarget.x - cube.rotation.x) * 0.04 + 0.0008;
    cube.rotation.y += (cubeTarget.y - cube.rotation.y) * 0.04 + 0.0015;
    wire.rotation.copy(cube.rotation);

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

  nextPrompt();
  loop();

  return () => {
    running = false;
    ro.disconnect();
    renderer.dispose();
    materials.forEach((m) => { m.map?.dispose(); m.dispose(); });
  };
}
