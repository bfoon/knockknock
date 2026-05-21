// ──────────────────────────────────────────────────────────────
// ASSOCIATION CHAIN
//
// Presenter (or phone-mode participants) submit one word at a
// time. Each new word connects to the previous word with a glowing
// curve. The chain wraps in a spiral so it never runs off-screen.
//
// Visually: each word is a sprite; the connection is a TubeGeometry
// segment. Colours cycle so the chain reads as a flowing ribbon of
// nodes.
// ──────────────────────────────────────────────────────────────

import { el, makeButton, makeCanvasPassive, addGameArena, makeGameCharacter } from "../_helpers.js";

export default function init(ctx) {
  const { stage, bottom, getColors } = ctx;
  const colors = getColors();

  stage.innerHTML = "";

  // ── Three.js scene ──────────────────────────────────────────
  const canvasHost = el("div", { class: "kk-game-canvas", parent: stage });
  canvasHost.style.position = "absolute";
  canvasHost.style.inset = "0";

  const scene = new THREE.Scene();

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
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

  // Arena floor + a guide character at the base of the chain.
  // (Both were referenced in the render loop but never created — fixed.)
  const arena = addGameArena(scene, colors);
  arena.position.y = -5.5;
  const guide = makeGameCharacter({ primary: colors.a, secondary: colors.b, scale: 0.55, skin: "#f1c27d" });
  guide.position.set(0, -5.4, 1.5);
  scene.add(guide);

  // ── Soft ambient particles in the background ───────────────
  const pgeom = new THREE.BufferGeometry();
  const pcount = 200;
  const ppos = new Float32Array(pcount * 3);
  for (let i = 0; i < pcount; i++) {
    ppos[i * 3]     = (Math.random() - 0.5) * 50;
    ppos[i * 3 + 1] = (Math.random() - 0.5) * 30;
    ppos[i * 3 + 2] = (Math.random() - 0.5) * 30 - 10;
  }
  pgeom.setAttribute("position", new THREE.BufferAttribute(ppos, 3));
  scene.add(new THREE.Points(
    pgeom,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.3, depthWrite: false }),
  ));

  // ── Chain group ────────────────────────────────────────────
  const chainGroup = new THREE.Group();
  scene.add(chainGroup);

  const nodes = []; // [{ word, pos: Vec3, sprite, tube?, color }]

  const palette = [colors.a, colors.b, "#fb7185", "#fbbf24", "#a3e635", "#06b6d4"];

  function makeWordSprite(word, color, isHead) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const g = canvas.getContext("2d");

    const fontSize = isHead ? 110 : 80;
    g.font = `800 ${fontSize}px 'Clash Display', system-ui, sans-serif`;
    g.shadowColor = color;
    g.shadowBlur = isHead ? 40 : 20;
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(word, canvas.width / 2, canvas.height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    const scale = isHead ? 5 : 4;
    spr.scale.set(scale, scale / 4, 1);
    return spr;
  }

  /**
   * Compute the position for the nth word along a wide horizontal
   * scroll. Older words drift left and fade — the head sits centre-right.
   * This is a much cleaner read than a spiral when projecting on a wide
   * meeting room screen.
   */
  function positionFor(n, total) {
    const idxFromEnd = total - 1 - n;
    return new THREE.Vector3(
      4 - idxFromEnd * 2.0,           // newest on the right, scroll left
      Math.sin(n * 0.6) * 1.5,        // gentle wave
      -idxFromEnd * 0.6,              // older words push back in z
    );
  }

  function rebuild() {
    // Position every existing sprite based on its index.
    nodes.forEach((node, i) => {
      const isHead = i === nodes.length - 1;
      node.targetPos = positionFor(i, nodes.length);
      // Bigger sprite for the head; refresh texture if its head state changed.
      const wantHead = isHead;
      if (node.isHead !== wantHead) {
        chainGroup.remove(node.sprite);
        node.sprite = makeWordSprite(node.word, node.color, wantHead);
        node.isHead = wantHead;
        node.sprite.position.copy(node.targetPos);
        chainGroup.add(node.sprite);
      }
      // Fade older nodes.
      const age = nodes.length - 1 - i;
      node.targetOpacity = Math.max(0.18, 1 - age * 0.13);
    });

    // Rebuild connections (simple cylinders between consecutive nodes).
    for (const n of nodes) {
      if (n.tube) {
        chainGroup.remove(n.tube);
        n.tube.geometry.dispose();
        n.tube.material.dispose();
        n.tube = null;
      }
    }
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1].targetPos;
      const b = nodes[i].targetPos;
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, len, 8),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(nodes[i].color),
          transparent: true, opacity: 0.5,
        }),
      );
      tube.position.copy(a).add(dir.clone().multiplyScalar(0.5));
      tube.lookAt(b);
      tube.rotateX(Math.PI / 2);
      chainGroup.add(tube);
      nodes[i].tube = tube;
    }
  }

  function addWord(rawWord) {
    const word = String(rawWord).trim().slice(0, 24);
    if (!word) return;
    const color = palette[nodes.length % palette.length];
    const isHead = true; // current addition becomes head
    const sprite = makeWordSprite(word, color, true);

    // Spawn just below the chain so it animates up into place.
    sprite.position.set(4, -8, 0);
    sprite.material.opacity = 0;
    chainGroup.add(sprite);

    nodes.push({ word, color, sprite, targetPos: positionFor(nodes.length, nodes.length + 1), isHead, targetOpacity: 1 });

    // Cap chain length so the screen doesn't get crowded; remove oldest.
    if (nodes.length > 9) {
      const old = nodes.shift();
      chainGroup.remove(old.sprite);
      old.sprite.material.map?.dispose();
      old.sprite.material.dispose();
      if (old.tube) {
        chainGroup.remove(old.tube);
        old.tube.geometry.dispose();
        old.tube.material.dispose();
      }
    }

    rebuild();
    updateBottom();
  }

  function clearChain() {
    for (const n of nodes) {
      chainGroup.remove(n.sprite);
      n.sprite.material.map?.dispose();
      n.sprite.material.dispose();
      if (n.tube) {
        chainGroup.remove(n.tube);
        n.tube.geometry.dispose();
        n.tube.material.dispose();
      }
    }
    nodes.length = 0;
    updateBottom();
  }

  function popLast() {
    if (!nodes.length) return;
    const last = nodes.pop();
    chainGroup.remove(last.sprite);
    last.sprite.material.map?.dispose();
    last.sprite.material.dispose();
    if (last.tube) {
      chainGroup.remove(last.tube);
      last.tube.geometry.dispose();
      last.tube.material.dispose();
    }
    rebuild();
    updateBottom();
  }

  // ── HUD ────────────────────────────────────────────────────
  const overlay = el("div", { class: "kk-game-overlay", parent: stage });
  overlay.style.justifyContent = "flex-start";
  overlay.style.paddingTop = "3rem";

  const eyebrow = el("p", {
    parent: overlay,
    style: {
      fontSize: ".75rem",
      letterSpacing: ".2em",
      textTransform: "uppercase",
      color: "rgba(248,250,252,.6)",
      fontWeight: "700",
      margin: 0,
    },
  });
  eyebrow.textContent = "What word does that bring to mind?";
  const helper = el("p", {
    parent: overlay,
    class: "kk-game-sub",
    style: { margin: "0.4rem 0 0 0", maxWidth: "50ch" },
  });
  helper.textContent = "The next person says the first word that pops into their head. No editing. No second-guessing.";

  // ── Bottom controls ────────────────────────────────────────
  function updateBottom() {
    bottom.innerHTML = "";
    const form = el("form", {
      parent: bottom,
      style: { display: "flex", gap: ".5rem", alignItems: "center", flexWrap: "wrap", justifyContent: "center" },
    });
    form.innerHTML = `
      <input type="text" id="wc-word" placeholder="${nodes.length === 0 ? 'Start with any word…' : 'Next association…'}"
        maxlength="24" autocomplete="off"
        style="padding:.85rem 1.2rem; border-radius:12px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.12); color:#f8fafc; font-size:1.05rem; width:280px;" />
    `;
    const add = makeButton('<i class="bi bi-arrow-right-circle-fill"></i> Add to chain', {});
    add.type = "submit";
    form.appendChild(add);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = form.querySelector("#wc-word").value;
      if (!v.trim()) return;
      addWord(v);
      form.reset();
      form.querySelector("#wc-word").focus();
    });

    if (nodes.length > 0) {
      bottom.appendChild(makeButton('<i class="bi bi-arrow-counterclockwise"></i> Undo', { ghost: true, onClick: popLast }));
      bottom.appendChild(makeButton('<i class="bi bi-x-circle"></i> Reset', { ghost: true, onClick: clearChain }));
    }

    setTimeout(() => form.querySelector("#wc-word")?.focus(), 50);
  }

  updateBottom();

  // ── Render loop ────────────────────────────────────────────
  let running = true;
  const start = performance.now();

  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    const t = (performance.now() - start) / 1000;

    // Drift each node toward its target position + bobbing.
    for (const n of nodes) {
      const tgt = n.targetPos.clone();
      tgt.y += Math.sin(t * 0.6 + tgt.x) * 0.15;
      n.sprite.position.lerp(tgt, 0.07);
      n.sprite.material.opacity = n.sprite.material.opacity + (n.targetOpacity - n.sprite.material.opacity) * 0.08;
      if (n.tube) {
        n.tube.material.opacity = (n.targetOpacity ?? 1) * 0.5;
      }
    }

    // Subtle camera sway.
    camera.position.x = Math.sin(t * 0.1) * 0.5;
    camera.position.y = Math.sin(t * 0.13) * 0.3;
    camera.lookAt(0, 0, 0);

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
    clearChain();
  };
}
