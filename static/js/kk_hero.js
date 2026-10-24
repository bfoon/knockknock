/* ============================================================================
   kk_hero.js — Hero Forge: 3D game-style characters for Knock-Knock
   ----------------------------------------------------------------------------
   The body parts, outfits, hair, hats and props are modelled in Blender
   (tools/blender/build_tabletop_assets.py -> static/tabletop/models/kk_hero.glb).
   This file assembles them into an animated character, recolours them, and
   wires the result into the rest of the site.

   Load order:
     three.js r128  ->  GLTFLoader (examples/js)  ->  [kk_avatars.js]  ->
     <script src="kk_hero.js" data-glb="{% static 'tabletop/models/kk_hero.glb' %}">

   A hero is fully described by its id, one base-36 digit per slot:
     kh-<body><skin><hair><hairColor><eyes><outfit><outfitColor><hat><prop><aura>
   (mirrored by HERO_SLOTS in games/avatars.py — keep them in step).

   Public API (window.KKHero):
     ready()                         Promise, resolves when the GLB is loaded
     isHero(id) / parse(id) / encode(parts) / random() / labelFor(id) / emojiFor(id)
     build(id)                       -> hero  (THREE.Group with .update(dt),
                                        .play(move, secs), .setLook(x), .dispose())
                                        moves: idle cheer attack hurt dance sad wave think
     snapshot(id, cb)                portrait PNG data-URL (cached), for 2D lists
     html(id, size)                  <span> that fills itself with the snapshot
     mount(el, id, opts)             live spinning 3D preview in an element
     forge(el, {value, onChange})    the full character builder UI
     SLOTS, OPTIONS
   ========================================================================== */
window.KKHero = (function () {
  "use strict";

  var script = document.currentScript;
  var GLB_URL = (script && script.dataset.glb) || "/static/tabletop/models/kk_hero.glb";
  var T = window.THREE;
  var HAS_WEBGL = (function () {
    try {
      var c = document.createElement("canvas");
      return !!(T && window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  })();
  var REDUCED = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* ───────────────────────────── catalogue ───────────────────────────── */
  var SLOTS = [
    { key: "body", label: "Body", n: 4 },
    { key: "skin", label: "Skin", n: 14 },
    { key: "hair", label: "Hair", n: 10 },
    { key: "hairColor", label: "Hair colour", n: 12 },
    { key: "eyes", label: "Eyes", n: 6 },
    { key: "outfit", label: "Outfit", n: 10 },
    { key: "outfitColor", label: "Colour", n: 12 },
    { key: "hat", label: "Headwear", n: 12 },
    { key: "prop", label: "Item", n: 10 },
    { key: "aura", label: "Aura", n: 6 },
  ];
  var SKIN = ["#ffe0c7", "#f9cba7", "#eab38a", "#d39a6a", "#b97c4f", "#9a613a",
              "#7a4a2b", "#5c3620", "#43271a", "#2f1b12",
              "#7ed957", "#6ec6ff", "#c4a7ff", "#cfd8dc"];
  var HAIRC = ["#1b1b1b", "#3b2414", "#6b3e1f", "#a0662c", "#e2b04a", "#f4e3b5",
               "#b8452a", "#d9d9d9", "#ff5fa2", "#4f7cff", "#29c47a", "#8a4dff"];
  var COLORS = ["#ef4444", "#f97316", "#facc15", "#22c55e", "#14b8a6", "#06b6d4",
                "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#f1f5f9", "#1f2937"];
  var OPTIONS = {
    body: ["Chibi", "Tall", "Round", "Tiny"],
    skin: SKIN, hairColor: HAIRC, outfitColor: COLORS,
    hair: ["Bald", "Spiky", "Bob", "Long", "Afro", "Bun", "Mohawk", "Braids", "Ponytail", "Curly"],
    eyes: ["Dots", "Sparkle", "Happy", "Shades", "Sleepy", "Stars"],
    outfit: ["Hoodie", "Armour", "Wizard", "Suit", "Kaftan", "Jersey", "Space", "Ninja", "Pirate", "Overalls"],
    hat: ["None", "Crown", "Cap", "Wizard", "Helmet", "Kufi", "Headwrap", "Headset", "Viking", "Halo", "Beanie", "Top hat"],
    prop: ["None", "Sword", "Staff", "Shield", "Hammer", "Guitar", "Gamepad", "Wand", "Kora", "Trophy"],
    aura: ["None", "Sparkles", "Fire", "Hearts", "Bubbles", "Lightning"],
  };
  var ICONS = {
    body: ["🧸", "🦒", "🍩", "🐣"],
    hair: ["🥚", "⚡", "💇", "👩‍🦰", "🌳", "🍙", "🦔", "🪢", "🎀", "🌀"],
    eyes: ["••", "✨", "^^", "😎", "😪", "⭐"],
    outfit: ["🧥", "🛡️", "🧙", "🕴️", "👘", "⚽", "🧑‍🚀", "🥷", "🏴‍☠️", "👖"],
    hat: ["∅", "👑", "🧢", "🎩", "⛑️", "🕌", "🧕", "🎧", "🪖", "😇", "🧶", "🎩"],
    prop: ["∅", "🗡️", "🪄", "🛡️", "🔨", "🎸", "🎮", "✨", "🪕", "🏆"],
    aura: ["∅", "✨", "🔥", "💖", "🫧", "⚡"],
  };
  var HAIR_PART = [null, "hair_spiky", "hair_bob", "hair_long", "hair_afro", "hair_bun",
                   "hair_mohawk", "hair_braids", "hair_ponytail", "hair_curly"];
  var FIT_PART = ["fit_hoodie", "fit_armor", "fit_robe", "fit_suit", "fit_kaftan",
                  "fit_jersey", "fit_space", "fit_ninja", "fit_pirate", "fit_overalls"];
  var HAT_PART = [null, "hat_crown", "hat_cap", "hat_wizard", "hat_helmet", "hat_kufi",
                  "hat_wrap", "hat_phones", "hat_viking", "hat_halo", "hat_beanie", "hat_top"];
  var PROP_PART = [null, "prop_sword", "prop_staff", "prop_shield", "prop_hammer",
                   "prop_guitar", "prop_pad", "prop_wand", "prop_kora", "prop_trophy"];
  // hair that would poke through a hat gets hidden under these
  var HAT_HIDES_HAIR = { 4: true, 8: true, 10: true };
  // per-outfit secondary colours
  var FIT_STYLE = [
    { trim: "#f1f5f9", pants: "#1e3a8a", boots: "#3a2416" },               // hoodie
    { trim: "#facc15", pants: "#64748b", boots: "#94a3b8" },               // armour
    { trim: "#facc15", pants: "dark", boots: "#3a2416" },                  // robe
    { trim: "#dc2626", pants: "dark", boots: "#111827" },                  // suit
    { trim: "#facc15", pants: "same", boots: "#7c4a1e" },                  // kaftan
    { trim: "#f8fafc", pants: "#f8fafc", boots: "#111827" },               // jersey
    { trim: "#f97316", pants: "same", boots: "#e5e7eb" },                  // space
    { trim: "#dc2626", pants: "same", boots: "#111827" },                  // ninja
    { trim: "#d4a017", pants: "#3f2d20", boots: "#1f140c" },               // pirate
    { trim: "#facc15", pants: "#2563eb", boots: "#5b3a1e" },               // overalls
  ];
  var AURA_COL = [null, "#fde68a", "#fb923c", "#f472b6", "#67e8f9", "#fde047"];

  function isHero(id) { return /^kh-[0-9a-z]{10}$/.test(String(id || "")) && !!parse(id); }
  function parse(id) {
    var s = String(id || "");
    if (!/^kh-[0-9a-z]{10}$/.test(s)) return null;
    var out = {};
    for (var i = 0; i < SLOTS.length; i++) {
      var v = parseInt(s.charAt(3 + i), 36);
      if (!(v < SLOTS[i].n)) return null;
      out[SLOTS[i].key] = v;
    }
    return out;
  }
  function encode(p) {
    return "kh-" + SLOTS.map(function (s) {
      var v = Math.max(0, Math.min(s.n - 1, p[s.key] | 0));
      return v.toString(36);
    }).join("");
  }
  function random() {
    var p = {};
    SLOTS.forEach(function (s) { p[s.key] = Math.floor(Math.random() * s.n); });
    if (Math.random() < 0.4) p.hat = 0;
    if (Math.random() < 0.5) p.aura = 0;
    return p;
  }
  function labelFor(id) {
    var p = parse(id);
    return p ? OPTIONS.outfit[p.outfit] + " hero" : "Hero";
  }
  function emojiFor(id) {
    var p = parse(id);
    return p ? ICONS.outfit[p.outfit] : "🦸";
  }

  /* ───────────────────────────── asset loading ───────────────────────────── */
  var parts = null, loading = null;
  function ready() {
    if (parts) return Promise.resolve(parts);
    if (loading) return loading;
    if (!HAS_WEBGL || !T.GLTFLoader) return Promise.reject(new Error("no webgl/gltf"));
    loading = new Promise(function (res, rej) {
      new T.GLTFLoader().load(GLB_URL, function (g) {
        parts = {};
        g.scene.children.slice().forEach(function (o) { parts[o.name] = o; });
        res(parts);
      }, undefined, rej);
    });
    return loading;
  }

  var matCache = {};
  function mat(col, o) {
    o = o || {};
    var key = col + "|" + (o.metal || 0) + "|" + (o.emissive || "") + "|" + (o.rough || "");
    if (matCache[key]) return matCache[key];
    var m = new T.MeshStandardMaterial({
      color: new T.Color(col), roughness: o.rough != null ? o.rough : 0.62,
      metalness: o.metal || 0,
    });
    if (o.emissive) { m.emissive = new T.Color(o.emissive); m.emissiveIntensity = o.ei || 0.8; }
    return (matCache[key] = m);
  }
  function shade(hex, k) {
    var c = new T.Color(hex);
    c.multiplyScalar(k);
    return "#" + c.getHexString();
  }

  function palette(p) {
    var cloth = COLORS[p.outfitColor];
    var st = FIT_STYLE[p.outfit];
    var trim = st.trim;
    if (trim.toLowerCase() === cloth.toLowerCase()) trim = "#1f2937";
    var pants = st.pants === "same" ? cloth : st.pants === "dark" ? shade(cloth, 0.55) : st.pants;
    var aura = AURA_COL[p.aura] || "#67e8f9";
    return {
      skin: mat(SKIN[p.skin], { rough: 0.7 }),
      cloth: mat(cloth), trim: mat(trim, { rough: 0.45 }), pants: mat(pants),
      boots: mat(st.boots, { rough: 0.5 }), hair: mat(HAIRC[p.hairColor], { rough: 0.8 }),
      metal: mat("#cbd5e1", { metal: 0.85, rough: 0.28 }),
      gold: mat("#f5c542", { metal: 0.9, rough: 0.3 }),
      wood: mat("#8b5a2b", { rough: 0.75 }), dark: mat("#1f2430"),
      white: mat("#f8fafc"), string: mat("#e7e5e4"),
      glow: mat(aura, { emissive: aura, ei: 1.1 }),
      body: mat(cloth), accent: mat(trim),
    };
  }

  function part(name, pal) {
    var src = parts && parts[name];
    if (!src) return new T.Group();
    var c = src.clone(true);
    c.position.set(0, 0, 0);
    c.traverse(function (o) {
      if (o.isMesh) {
        var n = (o.material && o.material.name || "cloth").replace(/\.\d+$/, "");
        o.material = pal[n] || pal.cloth;
        o.castShadow = true;
      }
    });
    return c;
  }

  /* ───────────────────────────── face ───────────────────────────── */
  function face(p, pal) {
    var g = new T.Group();
    var dark = mat("#111318", { rough: 0.3 }), white = mat("#ffffff", { rough: 0.2 });
    var eyes = [];
    [-1, 1].forEach(function (sx) {
      var e = new T.Group();
      e.position.set(sx * 0.15, 0.4, 0.36);
      var style = p.eyes;
      if (style === 0) {
        e.add(new T.Mesh(new T.SphereGeometry(0.055, 14, 10), dark));
        var gl = new T.Mesh(new T.SphereGeometry(0.018, 8, 6), white); gl.position.set(0.018, 0.02, 0.045); e.add(gl);
      } else if (style === 1) {
        var w = new T.Mesh(new T.SphereGeometry(0.09, 16, 12), white); w.scale.set(0.85, 1.1, 0.5); e.add(w);
        var iris = new T.Mesh(new T.SphereGeometry(0.06, 14, 10), mat(COLORS[(p.outfitColor + 6) % 12])); iris.scale.set(1, 1.1, 0.5); iris.position.z = 0.03; e.add(iris);
        var pu = new T.Mesh(new T.SphereGeometry(0.032, 10, 8), dark); pu.position.z = 0.055; e.add(pu);
        var g1 = new T.Mesh(new T.SphereGeometry(0.02, 8, 6), white); g1.position.set(0.025, 0.035, 0.07); e.add(g1);
      } else if (style === 2) {
        var arc = new T.Mesh(new T.TorusGeometry(0.05, 0.014, 6, 16, Math.PI), dark); arc.position.y = -0.02; e.add(arc);
      } else if (style === 3) {
        var lens = new T.Mesh(new T.BoxGeometry(0.16, 0.09, 0.03), mat("#0b0f19", { metal: 0.6, rough: 0.15 })); e.add(lens);
        if (sx < 0) { var br = new T.Mesh(new T.BoxGeometry(0.14, 0.02, 0.02), dark); br.position.x = 0.15; e.add(br); }
      } else if (style === 4) {
        var ball = new T.Mesh(new T.SphereGeometry(0.05, 12, 10), dark); e.add(ball);
        var lid = new T.Mesh(new T.SphereGeometry(0.062, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), pal.skin); lid.position.z = 0.0; e.add(lid);
      } else {
        var sh = new T.Shape();
        for (var i = 0; i < 10; i++) {
          var a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.03 : 0.07;
          if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        var star = new T.Mesh(new T.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false }), mat("#facc15", { emissive: "#f59e0b", ei: 0.4 }));
        e.add(star);
      }
      g.add(e);
      eyes.push(e);
    });
    var mouth = new T.Mesh(new T.TorusGeometry(0.06, 0.014, 6, 16, Math.PI), dark);
    mouth.rotation.z = Math.PI;
    mouth.position.set(0, 0.25, 0.39);
    g.add(mouth);
    var blush = mat("#ff8fa3", { rough: 0.9 });
    [-1, 1].forEach(function (sx) {
      var b = new T.Mesh(new T.CircleGeometry(0.045, 14), blush);
      b.material.transparent = true; b.material.opacity = 0.55;
      b.position.set(sx * 0.25, 0.29, 0.35); b.rotation.y = sx * 0.55;
      g.add(b);
    });
    g.userData = { eyes: eyes, mouth: mouth, blinkable: p.eyes !== 2 && p.eyes !== 3 };
    return g;
  }

  /* ───────────────────────────── aura particles ───────────────────────────── */
  var spriteTex = {};
  function sprite(kind) {
    if (spriteTex[kind]) return spriteTex[kind];
    var c = document.createElement("canvas"); c.width = c.height = 64;
    var x = c.getContext("2d");
    x.translate(32, 32);
    if (kind === 3) { // heart
      x.fillStyle = "#fff"; x.beginPath();
      x.moveTo(0, 18); x.bezierCurveTo(-30, -4, -14, -26, 0, -10); x.bezierCurveTo(14, -26, 30, -4, 0, 18); x.fill();
    } else if (kind === 1 || kind === 5) { // star / spark
      x.fillStyle = "#fff"; x.beginPath();
      for (var i = 0; i < 8; i++) { var a = i * Math.PI / 4, r = i % 2 ? 6 : 28; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      x.fill();
    } else if (kind === 4) { // bubble
      x.strokeStyle = "#fff"; x.lineWidth = 4; x.beginPath(); x.arc(0, 0, 22, 0, 7); x.stroke();
      x.fillStyle = "rgba(255,255,255,.8)"; x.beginPath(); x.arc(-8, -8, 5, 0, 7); x.fill();
    } else { // soft flame blob
      var gr = x.createRadialGradient(0, 0, 0, 0, 0, 30);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = gr; x.fillRect(-32, -32, 64, 64);
    }
    return (spriteTex[kind] = new T.CanvasTexture(c));
  }
  function aura(kind) {
    var N = kind === 2 ? 40 : 22;
    var pos = new Float32Array(N * 3), seeds = [];
    for (var i = 0; i < N; i++) seeds.push({ a: Math.random() * 6.28, r: 0.45 + Math.random() * 0.4, y: Math.random() * 2, s: 0.3 + Math.random() * 0.7 });
    var geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.BufferAttribute(pos, 3));
    var m = new T.PointsMaterial({ size: kind === 2 ? 0.16 : 0.12, map: sprite(kind), color: AURA_COL[kind],
      transparent: true, depthWrite: false, blending: kind === 3 || kind === 4 ? T.NormalBlending : T.AdditiveBlending });
    var pts = new T.Points(geo, m);
    pts.userData.tick = function (t, dt) {
      for (var i = 0; i < N; i++) {
        var s = seeds[i];
        s.y += dt * s.s * (kind === 2 ? 1.4 : 0.5);
        if (s.y > 2.1) { s.y = 0; s.a = Math.random() * 6.28; }
        var a = s.a + t * (kind === 4 ? 0.3 : 0.8) * s.s;
        var r = kind === 2 ? s.r * (1 - s.y / 2.4) * 0.8 : s.r;
        pos[i * 3] = Math.cos(a) * r;
        pos[i * 3 + 1] = s.y;
        pos[i * 3 + 2] = Math.sin(a) * r;
      }
      if (kind === 5) m.opacity = Math.random() < 0.15 ? 1 : 0.35;
      geo.attributes.position.needsUpdate = true;
    };
    return pts;
  }

  /* ───────────────────────────── build ───────────────────────────── */
  var BODY = [
    { s: 1, leg: 1, torso: 1, head: 1, wide: 1 },
    { s: 1, leg: 1.3, torso: 1.15, head: 0.9, wide: 0.92 },
    { s: 1, leg: 0.9, torso: 1, head: 1, wide: 1.32 },
    { s: 0.82, leg: 0.85, torso: 0.9, head: 1.12, wide: 1 },
  ];

  function build(id) {
    var p = parse(id) || parse("kh-0350241520");
    var pal = palette(p);
    var b = BODY[p.body];
    var root = new T.Group();
    var rig = new T.Group(); root.add(rig);
    rig.scale.setScalar(b.s);

    var hipY = 0.55 * b.leg;
    var pelvis = new T.Group(); pelvis.position.y = hipY; rig.add(pelvis);

    var legs = [-1, 1].map(function (sx) {
      var g = new T.Group();
      g.position.set(sx * 0.16 * Math.min(b.wide, 1.15), 0, 0);
      var leg = part("hero_leg", pal);
      leg.scale.set(sx, b.leg, 1);
      g.add(leg);
      pelvis.add(g);
      return g;
    });
    // feet stay on the ground: legs are scaled from the hip, so lift the pelvis
    var torso = new T.Group(); pelvis.add(torso);
    var tmesh = part("hero_torso", pal);
    tmesh.scale.set(b.wide, b.torso, b.wide);
    torso.add(tmesh);
    var fit = part(FIT_PART[p.outfit], pal);
    fit.scale.set(b.wide, b.torso, b.wide);
    torso.add(fit);
    if (p.outfit === 2 || p.outfit === 4) legs.forEach(function (l) { l.children[0].traverse(function (o) { if (o.isMesh && o.material === pal.pants) o.visible = false; }); });

    var neckY = (1.08 - 0.55) * b.torso;
    var head = new T.Group(); head.position.y = neckY; torso.add(head);
    var hmesh = new T.Group(); hmesh.scale.setScalar(b.head); head.add(hmesh);
    hmesh.add(part("hero_head", pal));
    var fc = face(p, pal); hmesh.add(fc);
    if (p.hair && !(HAT_HIDES_HAIR[p.hat])) hmesh.add(part(HAIR_PART[p.hair], pal));
    if (p.hat) hmesh.add(part(HAT_PART[p.hat], pal));

    var shY = (0.98 - 0.55) * b.torso;
    var arms = [-1, 1].map(function (sx) {
      var g = new T.Group();
      g.position.set(sx * 0.33 * b.wide, shY, 0);
      g.rotation.z = sx * 0.12;
      var a = part("hero_arm", pal);
      a.scale.set(sx, 1, 1);
      g.add(a);
      torso.add(g);
      return g;
    });
    var hand = new T.Group(); hand.position.set(0, -0.43, 0.02); arms[1].add(hand);
    if (p.prop) {
      var pr = part(PROP_PART[p.prop], pal);
      if (p.prop === 3) { pr.rotation.y = -Math.PI / 2; pr.position.x = 0.1; }      // shield faces out
      else if (p.prop === 6 || p.prop === 9) { pr.position.set(-0.1, 0.05, 0.12); }  // held in front
      else { pr.rotation.x = Math.PI / 2 - 0.3; }                                    // pointed forward
      hand.add(pr);
    }
    var fx = null;
    if (p.aura) { fx = aura(p.aura); root.add(fx); }

    // ---------------- animation ----------------
    var move = "idle", moveT = 0, moveDur = 0, blinkAt = 1 + Math.random() * 3, t0 = Math.random() * 10;
    var look = 0;
    root.userData.hero = true;
    root.play = function (m, secs) { move = m || "idle"; moveT = 0; moveDur = secs || ({ attack: 0.9, hurt: 0.8, cheer: 1.6, dance: 2.6, wave: 1.4, sad: 2, think: 2 }[move] || 1); };
    root.setLook = function (x) { look = Math.max(-1, Math.min(1, x || 0)); };
    root.update = function (dt, t) {
      t = (t || 0) + t0;
      if (fx) fx.userData.tick(t, dt);
      moveT += dt;
      if (move !== "idle" && moveT > moveDur) move = "idle";
      var k = moveDur ? Math.min(1, moveT / moveDur) : 0;
      // reset
      var breathe = Math.sin(t * 2.2) * 0.02;
      pelvis.position.y = hipY + breathe * 0.5;
      pelvis.rotation.set(0, 0, 0);
      torso.rotation.set(0, 0, 0);
      head.rotation.set(0, look * 0.5, Math.sin(t * 1.3) * 0.04);
      arms[0].rotation.set(Math.sin(t * 1.6) * 0.06, 0, -0.12 - breathe);
      arms[1].rotation.set(-Math.sin(t * 1.6) * 0.06, 0, 0.12 + breathe);
      legs[0].rotation.set(0, 0, 0); legs[1].rotation.set(0, 0, 0);
      rig.position.y = 0; rig.rotation.y = 0;
      if (REDUCED && move !== "idle") k = 1;
      var s = Math.sin(k * Math.PI);
      if (move === "cheer") {
        var hop = Math.abs(Math.sin(moveT * 9));
        rig.position.y = hop * 0.18 * (1 - k * 0.5);
        arms[0].rotation.z = -2.6; arms[1].rotation.z = 2.6;
        arms[0].rotation.x = arms[1].rotation.x = Math.sin(moveT * 18) * 0.2;
      } else if (move === "attack") {
        // wind-up then big diagonal chop with the right arm
        var wind = k < 0.35 ? k / 0.35 : 1 - (k - 0.35) / 0.65;
        var chop = k < 0.35 ? 0 : Math.min(1, (k - 0.35) / 0.2);
        arms[1].rotation.x = -2.8 * wind + 1.2 * chop * (1 - k);
        arms[1].rotation.z = 0.4 + chop * 0.4;
        torso.rotation.y = -0.5 * wind + 0.6 * chop * (1 - k);
        pelvis.position.z = chop * 0.15 * (1 - k);
        legs[1].rotation.x = -0.4 * s;
      } else if (move === "hurt") {
        torso.rotation.x = -0.35 * s;
        head.rotation.x = -0.3 * s;
        rig.position.x = Math.sin(moveT * 40) * 0.04 * (1 - k);
        arms[0].rotation.z = -0.9 * s; arms[1].rotation.z = 0.9 * s;
      } else if (move === "dance") {
        rig.rotation.y = k * Math.PI * 2;
        rig.position.y = Math.abs(Math.sin(moveT * 8)) * 0.15;
        arms[0].rotation.z = -1.4 - Math.sin(moveT * 8) * 0.8;
        arms[1].rotation.z = 1.4 - Math.sin(moveT * 8) * 0.8;
        legs[0].rotation.x = Math.sin(moveT * 8) * 0.5; legs[1].rotation.x = -Math.sin(moveT * 8) * 0.5;
      } else if (move === "wave") {
        arms[1].rotation.z = 2.5; arms[1].rotation.x = 0;
        arms[1].rotation.y = Math.sin(moveT * 12) * 0.5;
        head.rotation.z = 0.12;
      } else if (move === "sad") {
        head.rotation.x = 0.45 * Math.min(1, k * 4);
        torso.rotation.x = 0.2 * Math.min(1, k * 4);
        arms[0].rotation.z = -0.02; arms[1].rotation.z = 0.02;
        pelvis.position.y = hipY - 0.04;
      } else if (move === "think") {
        arms[1].rotation.x = -1.9; arms[1].rotation.z = -0.5;
        head.rotation.z = 0.2; head.rotation.x = -0.1;
      }
      // blink
      if (fc.userData.blinkable) {
        blinkAt -= dt;
        var sy = 1;
        if (blinkAt < 0) { sy = 0.12; if (blinkAt < -0.12) blinkAt = 2 + Math.random() * 3; }
        fc.userData.eyes.forEach(function (e) { e.scale.y = sy; });
      }
      fc.userData.mouth.scale.set(1, move === "sad" || move === "hurt" ? -1 : 1, 1);
      fc.userData.mouth.position.y = move === "sad" || move === "hurt" ? 0.22 : 0.25;
    };
    root.dispose = function () { if (root.parent) root.parent.remove(root); };
    root.update(0, 0);
    return root;
  }

  /* ───────────────────────────── snapshots (2D portraits) ───────────────────────────── */
  var snapCache = {}, snapQueue = [], snapR = null, snapScene, snapCam, snapBusy = false;
  function snapshot(id, cb) {
    if (snapCache[id]) { cb && cb(snapCache[id]); return; }
    snapQueue.push([id, cb]);
    pump();
  }
  function pump() {
    if (snapBusy || !snapQueue.length) return;
    snapBusy = true;
    ready().then(function () {
      if (!snapR) {
        snapR = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
        snapR.setSize(192, 192); snapR.setPixelRatio(1);
        snapScene = new T.Scene();
        snapScene.add(new T.HemisphereLight(0xffffff, 0x445566, 1.0));
        var d = new T.DirectionalLight(0xffffff, 0.9); d.position.set(1.5, 2.5, 3); snapScene.add(d);
        snapCam = new T.PerspectiveCamera(30, 1, 0.1, 20);
      }
      while (snapQueue.length) {
        var job = snapQueue.shift();
        if (!snapCache[job[0]]) {
          var h = build(job[0]);
          h.rotation.y = -0.35;
          snapScene.add(h);
          // frame the head and shoulders
          var box = new T.Box3().setFromObject(h);
          var top = box.max.y;
          snapCam.position.set(0.4, top - 0.45, 3.0);
          snapCam.lookAt(0, top - 0.6, 0);
          snapR.render(snapScene, snapCam);
          snapCache[job[0]] = snapR.domElement.toDataURL("image/png");
          snapScene.remove(h);
        }
        if (job[1]) job[1](snapCache[job[0]]);
      }
      snapBusy = false;
      fillPending();
    }).catch(function () { snapBusy = false; snapQueue = []; });
  }

  function orb(id, size) {
    var p = parse(id) || {};
    var col = COLORS[p.outfitColor || 6];
    return '<span class="kkh-orb" style="background:radial-gradient(circle at 35% 30%,#fff8,' + col + ' 60%);font-size:' + Math.round(size * 0.55) + 'px">' + emojiFor(id) + "</span>";
  }
  function html(id, size) {
    size = size || 56;
    var src = snapCache[id];
    return '<span class="kkh-av" data-kh="' + id + '" style="width:' + size + "px;height:" + size + 'px">' +
      (src ? '<img alt="" src="' + src + '">' : orb(id, size)) + "</span>";
  }
  var pendingTimer = null;
  function fillPending() {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () {
      var els = document.querySelectorAll(".kkh-av[data-kh]:not(.kkh-done)");
      [].forEach.call(els, function (el) {
        var id = el.getAttribute("data-kh");
        if (snapCache[id]) {
          el.innerHTML = '<img alt="" src="' + snapCache[id] + '">';
          el.classList.add("kkh-done");
        } else if (HAS_WEBGL) {
          snapshot(id);
        }
      });
    }, 30);
  }
  if (window.MutationObserver) {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) if (muts[i].addedNodes.length) { fillPending(); return; }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  /* ───────────────────────────── live preview ───────────────────────────── */
  function mount(el, id, opts) {
    opts = opts || {};
    if (!HAS_WEBGL) { el.innerHTML = html(id, opts.size || 160); return null; }
    var renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);
    var scene = new T.Scene();
    scene.add(new T.HemisphereLight(0xffffff, 0x334155, 0.9));
    var sun = new T.DirectionalLight(0xffffff, 0.9); sun.position.set(2, 4, 3); sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512); scene.add(sun);
    var rim = new T.DirectionalLight(0x7dd3fc, 0.5); rim.position.set(-3, 2, -2); scene.add(rim);
    var ground = new T.Mesh(new T.CircleGeometry(0.9, 40), new T.ShadowMaterial({ opacity: 0.25 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
    var cam = new T.PerspectiveCamera(32, 1, 0.1, 30);
    cam.position.set(0, 1.25, 4.6); cam.lookAt(0, 0.95, 0);
    var hero = null, spin = 0.5, drag = null, alive = true, last = performance.now();

    function set(nid, playMove) {
      ready().then(function () {
        if (hero) scene.remove(hero);
        hero = build(nid);
        hero.rotation.y = spin;
        scene.add(hero);
        if (playMove) hero.play(playMove);
      }).catch(function () { el.innerHTML = html(nid, opts.size || 160); });
    }
    function resize() {
      var w = el.clientWidth || 200, h = el.clientHeight || 200;
      renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
    }
    resize();
    var ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(el);
    el.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, s: spin, moved: false }; });
    window.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      if (Math.abs(dx) > 4) drag.moved = true;
      spin = drag.s + dx * 0.012;
    });
    window.addEventListener("pointerup", function () {
      if (drag && !drag.moved && hero) hero.play(["cheer", "dance", "wave", "attack"][Math.floor(Math.random() * 4)]);
      drag = null;
    });
    function loop(now) {
      if (!alive) return;
      var dt = Math.min(0.25, (now - last) / 1000); last = now;
      if (!drag && opts.autospin !== false) spin += dt * 0.35;
      if (hero) { hero.rotation.y = spin; hero.update(dt, now / 1000); }
      renderer.render(scene, cam);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    set(id, opts.move || "wave");
    return {
      set: set,
      play: function (m) { if (hero) hero.play(m); },
      dispose: function () { alive = false; if (ro) ro.disconnect(); renderer.dispose(); el.innerHTML = ""; },
    };
  }

  /* ───────────────────────────── the builder UI ───────────────────────────── */
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function forge(el, opts) {
    opts = opts || {};
    var p = parse(opts.value) || (function () { try { return parse(localStorage.getItem("kkh-last")); } catch (e) { return null; } })() || random();
    var tab = "outfit";
    el.classList.add("kkh-forge");
    el.innerHTML =
      '<div class="kkh-stage"><button type="button" class="kkh-dice" title="Surprise me" aria-label="Surprise me">🎲</button>' +
      '<span class="kkh-name"></span><span class="kkh-hint">drag to spin · tap for a move</span></div>' +
      '<div class="kkh-tabs" role="tablist"></div><div class="kkh-opts"></div>';
    var stage = el.querySelector(".kkh-stage"), tabs = el.querySelector(".kkh-tabs"),
        optsEl = el.querySelector(".kkh-opts"), nameEl = el.querySelector(".kkh-name");
    var view = mount(stage, encode(p), { move: "wave" });
    if (!view) stage.classList.add("kkh-flat");

    tabs.innerHTML = SLOTS.map(function (s) {
      return '<button type="button" role="tab" class="kkh-tab" data-k="' + s.key + '">' + esc(s.label) + "</button>";
    }).join("");

    function swatchSlot(k) { return k === "skin" || k === "hairColor" || k === "outfitColor"; }
    function renderOpts() {
      var list = OPTIONS[tab];
      optsEl.innerHTML = list.map(function (v, i) {
        var on = p[tab] === i ? " is-on" : "";
        if (swatchSlot(tab)) {
          return '<button type="button" class="kkh-opt kkh-sw' + on + '" data-i="' + i + '" aria-label="Colour ' + (i + 1) + '" style="--sw:' + v + '"></button>';
        }
        var ic = (ICONS[tab] || [])[i] || "";
        return '<button type="button" class="kkh-opt' + on + '" data-i="' + i + '"><span class="kkh-ic">' + ic + "</span>" + esc(v) + "</button>";
      }).join("");
      [].forEach.call(tabs.children, function (b) {
        var on = b.dataset.k === tab;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
    }
    function commit(move) {
      var id = encode(p);
      nameEl.textContent = labelFor(id);
      try { localStorage.setItem("kkh-last", id); } catch (e) { /* private mode */ }
      if (view) view.set(id, move);
      else stage.innerHTML = html(id, 150);
      renderOpts();
      if (opts.onChange) opts.onChange(id);
    }
    tabs.addEventListener("click", function (e) {
      var b = e.target.closest(".kkh-tab"); if (!b) return;
      tab = b.dataset.k; renderOpts();
    });
    optsEl.addEventListener("click", function (e) {
      var b = e.target.closest(".kkh-opt"); if (!b) return;
      p[tab] = parseInt(b.dataset.i, 10);
      commit(tab === "prop" ? "attack" : tab === "outfit" || tab === "hat" ? "cheer" : "wave");
    });
    el.querySelector(".kkh-dice").addEventListener("click", function () { p = random(); commit("dance"); });
    commit(null);
    return {
      get: function () { return encode(p); },
      set: function (id) { var q = parse(id); if (q) { p = q; commit("wave"); } },
      dispose: function () { if (view) view.dispose(); },
    };
  }

  /* ───────────────────────────── plug into KKAvatar ───────────────────────────── */
  function patchKKAvatar() {
    var A = window.KKAvatar;
    if (!A || A.__kkh) return;
    A.__kkh = true;
    var oHtml = A.html, oMount = A.mount, oEmoji = A.emojiFor, oLabel = A.labelFor, oSet = A.setMood;
    A.html = function (id, o) {
      if (isHero(id)) {
        var size = (o && o.size) || 64;
        var mood = (o && o.mood) || "idle";
        return '<span class="kka-av kkh-wrap kkh-mood-' + esc(mood) + (o && o.cls ? " " + esc(o.cls) : "") + '">' + html(id, size) + "</span>";
      }
      return oHtml.apply(this, arguments);
    };
    A.mount = function (el, id, o) {
      if (isHero(id)) { el.innerHTML = A.html(id, o); return el.firstChild; }
      return oMount.apply(this, arguments);
    };
    A.setMood = function (el, mood) {
      if (el && el.classList && el.classList.contains("kkh-wrap")) {
        el.className = el.className.replace(/kkh-mood-\S+/g, "") + " kkh-mood-" + mood;
        return el;
      }
      return oSet.apply(this, arguments);
    };
    if (oEmoji) A.emojiFor = function (id) { return isHero(id) ? emojiFor(id) : oEmoji.apply(this, arguments); };
    if (oLabel) A.labelFor = function (id) { return isHero(id) ? labelFor(id) : oLabel.apply(this, arguments); };
    var oIsBuilt = A.isBuilt;
    if (oIsBuilt) A.isHero = isHero;
  }
  patchKKAvatar();

  // Legacy lookups (present.js, play.js, rooms) read window.kkAvatarsById[id]
  // for {emoji, label, color, anim}. Give hero ids a sensible answer there too.
  (function patchCatalog() {
    var base = window.kkAvatarsById;
    if (!base || !window.Proxy || base.__kkhProxy) return;
    window.kkAvatarsById = new Proxy(base, {
      get: function (t, k) {
        if (k === "__kkhProxy") return true;
        if (typeof k === "string" && isHero(k)) {
          var p = parse(k);
          return { id: k, label: labelFor(k), emoji: emojiFor(k), color: COLORS[p.outfitColor], category: "hero", anim: "kk-bounce" };
        }
        return t[k];
      },
    });
  })();

  // base styles (kept here so every page that loads the script gets them)
  var css = document.createElement("style");
  css.textContent =
    ".kkh-av{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;overflow:hidden;" +
    "background:radial-gradient(circle at 50% 35%,rgba(255,255,255,.18),rgba(255,255,255,.04));vertical-align:middle}" +
    ".kkh-av img{width:118%;height:118%;object-fit:cover;object-position:50% 20%}" +
    ".kkh-orb{display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%}" +
    ".kkh-wrap{display:inline-block}.kkh-mood-cheer .kkh-av,.kkh-mood-win .kkh-av{animation:kkhHop .5s ease-in-out infinite}" +
    ".kkh-mood-dance .kkh-av{animation:kkhSpin 1.2s linear infinite}.kkh-mood-sad .kkh-av{filter:saturate(.4);transform:translateY(4px)}" +
    ".kkh-mood-wave .kkh-av{animation:kkhTilt .6s ease-in-out 2}" +
    "@keyframes kkhHop{50%{transform:translateY(-14%)}}@keyframes kkhSpin{to{transform:rotate(360deg)}}" +
    "@keyframes kkhTilt{25%{transform:rotate(-10deg)}75%{transform:rotate(10deg)}}" +
    ".kkh-forge{display:flex;flex-direction:column;gap:.6rem}" +
    ".kkh-stage{position:relative;height:clamp(220px,38vh,320px);border-radius:20px;overflow:hidden;touch-action:pan-y;" +
    "background:radial-gradient(110% 80% at 50% 105%,rgba(250,204,21,.22),transparent 60%),radial-gradient(90% 70% at 15% 0%,rgba(99,102,241,.3),transparent 55%),#0f172a;" +
    "border:1px solid rgba(255,255,255,.1)}.kkh-stage canvas{position:absolute;inset:0;width:100%!important;height:100%!important}" +
    ".kkh-flat{display:flex;align-items:center;justify-content:center}" +
    ".kkh-name{position:absolute;left:12px;top:10px;z-index:2;font-weight:800;color:#f8fafc;text-shadow:0 2px 8px #000a}" +
    ".kkh-hint{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);z-index:2;font-size:.68rem;color:#cbd5e1aa;pointer-events:none;white-space:nowrap}" +
    ".kkh-dice{position:absolute;right:10px;top:8px;z-index:2;font-size:1.4rem;border:0;border-radius:12px;padding:.15rem .45rem;background:rgba(255,255,255,.12);cursor:pointer}" +
    ".kkh-tabs{display:flex;gap:.35rem;overflow-x:auto;padding-bottom:.2rem;scrollbar-width:none}" +
    ".kkh-tab{flex:0 0 auto;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#cbd5e1;border-radius:999px;padding:.32rem .75rem;font-size:.8rem;cursor:pointer}" +
    ".kkh-tab.is-on{background:#facc15;color:#1f2937;border-color:#facc15;font-weight:700}" +
    ".kkh-opts{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:.4rem}" +
    ".kkh-opt{display:flex;flex-direction:column;align-items:center;gap:.15rem;padding:.45rem .25rem;border-radius:14px;cursor:pointer;" +
    "border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#e2e8f0;font-size:.74rem}" +
    ".kkh-opt .kkh-ic{font-size:1.35rem;line-height:1}.kkh-opt.is-on{border-color:#facc15;box-shadow:0 0 0 2px #facc1555;background:rgba(250,204,21,.12)}" +
    ".kkh-sw{height:46px;background:var(--sw)}.kkh-sw.is-on{box-shadow:0 0 0 3px #facc15}";
  document.head.appendChild(css);

  return {
    ready: ready, isHero: isHero, parse: parse, encode: encode, random: random,
    labelFor: labelFor, emojiFor: emojiFor, build: build, snapshot: snapshot,
    html: html, mount: mount, forge: forge, patch: patchKKAvatar,
    SLOTS: SLOTS, OPTIONS: OPTIONS, hasWebGL: HAS_WEBGL,
  };
})();
