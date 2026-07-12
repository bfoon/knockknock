/* ============================================================================
   kk3d.js — Knock-Knock 3D avatars & environments
   ----------------------------------------------------------------------------
   Requires three.js (r128 or newer) loaded globally BEFORE this file:
     <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
     <script src="{% static 'js/kk3d.js' %}"></script>

   Public API (window.KK3D):
     KK3D.mountAvatar(container, avatarId, opts) -> handle | null
        handle.setAvatar(id)   swap the character in place
        handle.playMove()      trigger the character's signature move
        handle.dispose()       tear down (removes canvas, stops RAF)
     KK3D.mountEnvironment(container, sceneId, opts) -> handle | null
        sceneId: one of the Quiz.chart_background values
        handle.dispose()
     KK3D.hasWebGL            boolean feature flag

   Everything is procedural — no model files, no image assets, no copyrighted
   IP. Characters are keyed by the same avatar ids as games/avatars.py and
   fall back to a friendly default blob for unknown ids.
   ========================================================================== */
window.KK3D = (function () {
  "use strict";

  if (!window.THREE) {
    console.warn("[kk3d] three.js not found — 3D features disabled.");
    return null;
  }
  var T = THREE;

  /* ---------- feature / preference detection ---------- */
  function detectWebGL() {
    try {
      var c = document.createElement("canvas");
      return !!(window.WebGLRenderingContext &&
        (c.getContext("webgl") || c.getContext("experimental-webgl")));
    } catch (e) { return false; }
  }
  var HAS_WEBGL = detectWebGL();
  var REDUCED = !!(window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* ============================ small helpers ============================ */

  function mat(color, o) {
    var m = new T.MeshStandardMaterial({ color: color, roughness: 0.55, metalness: 0.08 });
    if (o) for (var k in o) m[k] = o[k];
    return m;
  }
  function basic(color, o) {
    var m = new T.MeshBasicMaterial({ color: color });
    if (o) for (var k in o) m[k] = o[k];
    return m;
  }
  function sph(r, color, sx, sy, sz) {
    var m = new T.Mesh(new T.SphereGeometry(r, 24, 18), mat(color));
    m.scale.set(sx || 1, sy || 1, sz || 1);
    return m;
  }
  function box(w, h, d, color) { return new T.Mesh(new T.BoxGeometry(w, h, d), mat(color)); }
  function cyl(rt, rb, h, color, seg) { return new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg || 20), mat(color)); }
  function cone(r, h, color, seg) { return new T.Mesh(new T.ConeGeometry(r, h, seg || 20), mat(color)); }
  function torus(r, tube, color, arc) {
    return new T.Mesh(new T.TorusGeometry(r, tube, 10, 24, arc || Math.PI * 2), mat(color));
  }
  function extrude(shape, depth, color, bevel) {
    var g = new T.ExtrudeGeometry(shape, {
      depth: depth, bevelEnabled: !!bevel,
      bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, steps: 1
    });
    g.center();
    return new T.Mesh(g, mat(color));
  }
  /* capsule that works on r128 (no CapsuleGeometry there) */
  function capsule(r, h, color) {
    var g = new T.Group();
    var body = cyl(r, r, h, color); g.add(body);
    var top = sph(r, color); top.position.y = h / 2; g.add(top);
    var bot = sph(r, color); bot.position.y = -h / 2; g.add(bot);
    return g;
  }
  function canvasTexture(size, draw) {
    var c = document.createElement("canvas");
    c.width = c.height = size;
    draw(c.getContext("2d"), size);
    var tx = new T.CanvasTexture(c);
    return tx;
  }
  function softShadowTexture() {
    return canvasTexture(128, function (ctx, s) {
      var g = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(0,0,0,0.35)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
  }
  function disposeDeep(root) {
    root.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (mm) {
          if (mm.map) mm.map.dispose();
          mm.dispose();
        });
      }
    });
  }
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };

  /* ============================ face builder ============================= */
  /* Adds classic chibi eyes + smile to a head mesh/group.
     Returns { eyes: [...] } so the animator can blink them. */
  function addFace(head, opt) {
    opt = opt || {};
    var y = opt.y || 0.05, z = opt.z || 0.9, gap = opt.gap || 0.32, s = opt.scale || 1;
    var eyeColor = opt.eyeColor || 0x111827;
    var eyes = [];
    [-1, 1].forEach(function (side) {
      var e = new T.Group();
      var white = sph(0.11 * s, 0xffffff); e.add(white);
      var pupil = sph(0.055 * s, eyeColor); pupil.position.z = 0.07 * s; e.add(pupil);
      var glint = sph(0.02 * s, 0xffffff); glint.position.set(0.03 * s, 0.03 * s, 0.11 * s); e.add(glint);
      e.position.set(side * gap * s, y, z * s);
      head.add(e); eyes.push(e);
    });
    if (opt.smile !== false) {
      var smile = torus(0.13 * s, 0.028 * s, opt.mouthColor || 0x7f1d1d, Math.PI);
      smile.rotation.z = Math.PI;                 /* arc opens upward = smile */
      smile.position.set(0, y - 0.28 * s, z * s * 0.96);
      head.add(smile);
    }
    return { eyes: eyes };
  }

  /* ====================================================================== */
  /*                         CHARACTER RECIPES                              */
  /*  Each builder returns a THREE.Group roughly 2 units tall centred at    */
  /*  origin, with group.userData.face = {eyes:[..]} when it has a face.    */
  /* ====================================================================== */

  function chibi(bodyColor, bellyColor, decorate) {
    var g = new T.Group();
    var body = sph(0.62, bodyColor, 1, 1.12, 0.92); body.position.y = -0.35; g.add(body);
    if (bellyColor != null) {
      var belly = sph(0.45, bellyColor, 1, 1.05, 0.55);
      belly.position.set(0, -0.38, 0.28); g.add(belly);
    }
    var head = new T.Group(); head.position.y = 0.55; g.add(head);
    var skull = sph(0.55, bodyColor); head.add(skull);
    g.userData.face = addFace(head, { z: 0.48, gap: 0.42, scale: 1.05 });
    g.userData.head = head;
    /* stubby arms + feet */
    [-1, 1].forEach(function (side) {
      var arm = sph(0.16, bodyColor, 1, 1.6, 1);
      arm.position.set(side * 0.62, -0.32, 0.05);
      arm.rotation.z = side * -0.5;
      g.add(arm);
      var foot = sph(0.18, bodyColor, 1.2, 0.7, 1.4);
      foot.position.set(side * 0.28, -1.0, 0.12);
      g.add(foot);
    });
    if (decorate) decorate(g, head);
    return g;
  }

  function earsPointy(head, color, opts) {
    opts = opts || {};
    [-1, 1].forEach(function (side) {
      var ear = cone(opts.r || 0.18, opts.h || 0.35, color, 12);
      ear.position.set(side * (opts.x || 0.34), opts.y || 0.5, 0);
      ear.rotation.z = side * -(opts.tilt || 0.35);
      head.add(ear);
      if (opts.inner) {
        var inner = cone((opts.r || 0.18) * 0.55, (opts.h || 0.35) * 0.6, opts.inner, 10);
        inner.position.set(side * (opts.x || 0.34), (opts.y || 0.5) - 0.02, 0.06);
        inner.rotation.z = side * -(opts.tilt || 0.35);
        head.add(inner);
      }
    });
  }
  function earsRound(head, color, inner) {
    [-1, 1].forEach(function (side) {
      var ear = sph(0.2, color); ear.position.set(side * 0.42, 0.48, 0); head.add(ear);
      if (inner) { var i2 = sph(0.11, inner); i2.position.set(side * 0.42, 0.48, 0.12); head.add(i2); }
    });
  }

  var RECIPES = {
    /* ── creatures ─────────────────────────────────────────────── */
    dragon: function () {
      return chibi(0xdc2626, 0xfbbf24, function (g, head) {
        earsPointy(head, 0xfbbf24, { r: 0.12, h: 0.3, x: 0.3, y: 0.5 });
        [-1, 1].forEach(function (side) {              /* wings */
          var wing = extrude(triShape(0.55, 0.75), 0.05, 0xf87171);
          wing.position.set(side * 0.68, -0.05, -0.35);
          wing.rotation.y = side * 0.9; wing.rotation.z = side * -0.25;
          wing.userData.flap = side;
          g.add(wing);
        });
        for (var i = 0; i < 4; i++) {                  /* back spikes */
          var sp = cone(0.09, 0.2, 0xfbbf24, 8);
          sp.position.set(0, 0.35 - i * 0.32, -0.48 - i * 0.04);
          sp.rotation.x = -0.5; g.add(sp);
        }
        var snout = sph(0.22, 0xef4444, 1.1, 0.8, 1); snout.position.set(0, -0.12, 0.5); head.add(snout);
        [-1, 1].forEach(function (side) {
          var n = sph(0.03, 0x7f1d1d); n.position.set(side * 0.08, -0.08, 0.72); head.add(n);
        });
      });
    },
    trex: function () {
      return chibi(0x16a34a, 0x86efac, function (g, head) {
        var snout = sph(0.26, 0x16a34a, 1.15, 0.75, 1.1); snout.position.set(0, -0.15, 0.48); head.add(snout);
        for (var i = 0; i < 4; i++) {
          var tooth = cone(0.035, 0.09, 0xffffff, 6);
          tooth.rotation.x = Math.PI;
          tooth.position.set(-0.15 + i * 0.1, -0.3, 0.68); head.add(tooth);
        }
        var tail = cone(0.22, 0.7, 0x16a34a, 12);
        tail.rotation.x = 1.9; tail.position.set(0, -0.75, -0.6); g.add(tail);
      });
    },
    stego: function () {
      return chibi(0x0d9488, 0x99f6e4, function (g, head) {
        for (var i = 0; i < 5; i++) {
          var plate = extrude(triShape(0.22, 0.26), 0.05, 0xf59e0b);
          plate.position.set(0, 0.75 - i * 0.4, -0.42 - i * 0.05);
          g.add(plate);
        }
        var tail = cone(0.2, 0.65, 0x0d9488, 12);
        tail.rotation.x = 1.9; tail.position.set(0, -0.75, -0.58); g.add(tail);
      });
    },
    unicorn: function () {
      return chibi(0xfdf2f8, 0xfbcfe8, function (g, head) {
        var horn = cone(0.09, 0.42, 0xfbbf24, 12); horn.position.set(0, 0.62, 0.1); head.add(horn);
        earsPointy(head, 0xfdf2f8, { r: 0.11, h: 0.24, x: 0.3, y: 0.48, inner: 0xfbcfe8 });
        var mane = sph(0.2, 0xec4899, 0.9, 1.4, 0.9); mane.position.set(0, 0.35, -0.35); head.add(mane);
        var mane2 = sph(0.16, 0xa855f7, 0.9, 1.3, 0.9); mane2.position.set(0, 0.05, -0.5); head.add(mane2);
      });
    },
    fox: function (c1, c2) {
      return chibi(c1 || 0xea580c, 0xfff7ed, function (g, head) {
        earsPointy(head, c1 || 0xea580c, { r: 0.17, h: 0.4, x: 0.34, y: 0.5, inner: 0xfff7ed });
        var muzzle = sph(0.2, 0xfff7ed, 1, 0.8, 1); muzzle.position.set(0, -0.16, 0.46); head.add(muzzle);
        var nose = sph(0.05, 0x1f2937); nose.position.set(0, -0.08, 0.66); head.add(nose);
        var tail = sph(0.24, c1 || 0xea580c, 1, 1.7, 1);
        tail.position.set(0.45, -0.7, -0.5); tail.rotation.z = -0.7;
        var tip = sph(0.13, c2 || 0xfff7ed); tip.position.set(0.72, -0.35, -0.5);
        g.add(tail); g.add(tip);
      });
    },
    wolf: function () { return RECIPES.fox(0x475569, 0xe2e8f0); },
    tiger: function () {
      return chibi(0xf59e0b, 0xfef3c7, function (g, head) {
        earsRound(head, 0xf59e0b, 0xfef3c7);
        [-0.28, 0, 0.28].forEach(function (x, i) {
          var stripe = box(0.09, 0.2, 0.06, 0x1f2937);
          stripe.position.set(x, 0.42, 0.34); stripe.rotation.x = -0.5;
          head.add(stripe);
        });
        var muzzle = sph(0.19, 0xfef3c7, 1.05, 0.8, 1); muzzle.position.set(0, -0.16, 0.46); head.add(muzzle);
        var nose = sph(0.05, 0x7c2d12); nose.position.set(0, -0.08, 0.66); head.add(nose);
      });
    },
    panda: function () {
      return chibi(0xf8fafc, 0x1f2937, function (g, head) {
        earsRound(head, 0x27272a);
        [-1, 1].forEach(function (side) {
          var patch = sph(0.15, 0x27272a, 1, 1.25, 0.6);
          patch.position.set(side * 0.24, 0.06, 0.42); patch.rotation.z = side * 0.4;
          head.add(patch);
        });
        var nose = sph(0.06, 0x27272a); nose.position.set(0, -0.14, 0.55); head.add(nose);
      });
    },
    octopus: function () {
      var g = new T.Group();
      var head = new T.Group(); head.position.y = 0.15; g.add(head);
      var dome = sph(0.62, 0xdb2777, 1, 1.15, 1); head.add(dome);
      g.userData.face = addFace(head, { z: 0.54, gap: 0.34, y: -0.05 });
      g.userData.head = head;
      for (var i = 0; i < 8; i++) {
        var a = (i / 8) * Math.PI * 2;
        var leg = capsule(0.09, 0.5, 0xec4899);
        leg.position.set(Math.cos(a) * 0.42, -0.62, Math.sin(a) * 0.42);
        leg.rotation.z = Math.cos(a) * 0.5;
        leg.rotation.x = -Math.sin(a) * 0.5;
        leg.userData.tent = i;
        g.add(leg);
      }
      return g;
    },
    shark: function () {
      var g = new T.Group();
      var body = sph(0.6, 0x0891b2, 1.5, 0.85, 0.85); g.add(body);
      var belly = sph(0.5, 0xe0f2fe, 1.45, 0.7, 0.7); belly.position.set(0.05, -0.15, 0); g.add(belly);
      var fin = extrude(triShape(0.32, 0.42), 0.06, 0x0e7490); fin.position.set(-0.1, 0.6, 0); g.add(fin);
      var tail = extrude(triShape(0.3, 0.5), 0.06, 0x0e7490);
      tail.position.set(-0.95, 0.1, 0); tail.rotation.z = 0.5; g.add(tail);
      [-1, 1].forEach(function (side) {
        var sf = extrude(triShape(0.22, 0.3), 0.05, 0x0e7490);
        sf.position.set(0.1, -0.28, side * 0.42); sf.rotation.x = side * 1.2; sf.rotation.z = -1.2;
        g.add(sf);
      });
      var head = new T.Group(); head.position.set(0.55, 0.08, 0); g.add(head);
      g.userData.face = addFace(head, { z: 0.28, gap: 0.9, y: 0.05, scale: 0.9 });
      g.userData.face.eyes.forEach(function (e, i) { e.position.set(0.25, 0.08, (i ? 1 : -1) * 0.34); });
      g.userData.head = head;
      var mouth = torus(0.16, 0.03, 0x164e63, Math.PI); mouth.rotation.z = Math.PI; mouth.rotation.y = 1.2;
      mouth.position.set(0.52, -0.12, 0); g.add(mouth);
      g.rotation.y = -0.7;
      return g;
    },
    butterfly: function () {
      var g = new T.Group();
      var body = capsule(0.14, 0.7, 0x1e293b); g.add(body);
      var head = new T.Group(); head.position.y = 0.55; g.add(head);
      var skull = sph(0.22, 0x1e293b); head.add(skull);
      g.userData.face = addFace(head, { z: 0.75, gap: 0.45, scale: 0.55 });
      g.userData.head = head;
      [-1, 1].forEach(function (side) {
        var ant = cyl(0.015, 0.015, 0.3, 0x1e293b, 6);
        ant.position.set(side * 0.1, 0.32, 0); ant.rotation.z = side * -0.5; head.add(ant);
        var tip = sph(0.04, 0xfbbf24); tip.position.set(side * 0.18, 0.46, 0); head.add(tip);
        var wingTop = sph(0.42, 0x3b82f6, 1, 1.2, 0.12);
        wingTop.position.set(side * 0.5, 0.25, -0.12); wingTop.userData.flap = side; g.add(wingTop);
        var wingBot = sph(0.3, 0x60a5fa, 1, 1, 0.12);
        wingBot.position.set(side * 0.38, -0.32, -0.12); wingBot.userData.flap = side; g.add(wingBot);
        var dot = sph(0.09, 0xfde047, 1, 1, 0.3);
        dot.position.set(side * 0.55, 0.3, -0.04); dot.userData.flap = side; g.add(dot);
      });
      return g;
    },

    /* ── people-ish ────────────────────────────────────────────── */
    wizard: function () {
      return chibi(0x6366f1, 0x818cf8, function (g, head) {
        var brim = cyl(0.62, 0.62, 0.06, 0x4338ca); brim.position.y = 0.4; head.add(brim);
        var hat = cone(0.42, 0.75, 0x4f46e5, 16); hat.position.y = 0.78; hat.rotation.z = 0.12; head.add(hat);
        var star = extrude(starShape(0.1, 0.05, 5), 0.03, 0xfde047); star.position.set(0.12, 0.75, 0.3); head.add(star);
        var beard = sph(0.3, 0xe2e8f0, 1, 1.1, 0.6); beard.position.set(0, -0.3, 0.34); head.add(beard);
        var staff = cyl(0.035, 0.035, 1.3, 0x92400e, 8);
        staff.position.set(0.72, -0.35, 0.1);
        var orb = sph(0.11, 0x22d3ee); orb.position.set(0.72, 0.35, 0.1);
        g.add(staff); g.add(orb);
      });
    },
    ninja: function () {
      return chibi(0x1f2937, 0x374151, function (g, head) {
        /* mask: only an eye slit shows */
        var band = cyl(0.57, 0.57, 0.24, 0x111827); band.position.y = 0.06; band.scale.z = 0.98; head.add(band);
        var knot = sph(0.1, 0xdc2626); knot.position.set(0, 0.1, -0.55); head.add(knot);
        [-1, 1].forEach(function (side) {
          var tail = box(0.08, 0.3, 0.02, 0xdc2626);
          tail.position.set(side * 0.1, -0.1, -0.6); tail.rotation.z = side * 0.4; head.add(tail);
        });
        var blade = box(0.05, 0.7, 0.02, 0xcbd5e1);
        blade.position.set(-0.15, 0.55, -0.42); blade.rotation.z = 0.5; g.add(blade);
        var hilt = box(0.08, 0.16, 0.05, 0x111827);
        hilt.position.set(0.08, 0.28, -0.42); hilt.rotation.z = 0.5; g.add(hilt);
      });
    },
    hero: function (cape, suit) {
      return chibi(suit || 0x3b82f6, 0xfde047, function (g, head) {
        var capeM = extrude(triShape(0.75, 1.05), 0.04, cape || 0xdc2626);
        capeM.position.set(0, -0.35, -0.5); capeM.rotation.x = 0.12; capeM.rotation.z = Math.PI;
        capeM.userData.cape = true; g.add(capeM);
        var maskBand = cyl(0.565, 0.565, 0.16, 0x1e3a8a); maskBand.position.y = 0.1; maskBand.scale.z = 0.99; head.add(maskBand);
        var emblem = extrude(starShape(0.14, 0.07, 5), 0.03, 0xfde047);
        emblem.position.set(0, -0.32, 0.58); g.add(emblem);
      });
    },
    alien: function () {
      return chibi(0x22c55e, 0x86efac, function (g, head) {
        head.scale.set(1.1, 1.2, 1);
        var ant = cyl(0.02, 0.02, 0.35, 0x16a34a, 6); ant.position.y = 0.65; head.add(ant);
        var tip = sph(0.06, 0xfde047); tip.position.y = 0.85; head.add(tip);
        /* big black almond eyes replace the chibi ones */
        g.userData.face.eyes.forEach(function (e) { e.visible = false; });
        var eyes = [];
        [-1, 1].forEach(function (side) {
          var e = new T.Group();
          var black = sph(0.17, 0x052e16, 1, 1.5, 0.6); e.add(black);
          var glint = sph(0.04, 0x86efac); glint.position.set(0.04, 0.1, 0.09); e.add(glint);
          e.position.set(side * 0.26, 0.08, 0.45); e.rotation.z = side * -0.3;
          head.add(e); eyes.push(e);
        });
        g.userData.face.eyes = eyes;
      });
    },
    ghost: function (color) {
      var g = new T.Group();
      var body = sph(0.6, color || 0xf3f4f6, 1, 1.25, 1); body.position.y = 0.1; g.add(body);
      for (var i = 0; i < 5; i++) {
        var a = (i / 5 - 0.5) * 1.9;
        var blob = sph(0.16, color || 0xf3f4f6);
        blob.position.set(Math.sin(a) * 0.44, -0.62, Math.cos(a) * 0.3 - 0.05);
        g.add(blob);
      }
      var head = new T.Group(); head.position.y = 0.3; g.add(head);
      g.userData.face = addFace(head, { z: 0.5, gap: 0.5, scale: 1.1, eyeColor: 0x0f172a });
      g.userData.head = head;
      g.userData.ghost = true;
      return g;
    },
    robot: function (main, accent) {
      var g = new T.Group();
      var body = box(0.85, 0.7, 0.6, main || 0x0ea5e9); body.position.y = -0.4; g.add(body);
      var panel = box(0.5, 0.34, 0.05, 0x0f172a); panel.position.set(0, -0.36, 0.31); g.add(panel);
      var light = sph(0.06, accent || 0x22d3ee); light.position.set(-0.12, -0.3, 0.35); light.userData.pulse = true; g.add(light);
      var light2 = sph(0.06, 0xf472b6); light2.position.set(0.12, -0.3, 0.35); light2.userData.pulse = true; g.add(light2);
      var head = new T.Group(); head.position.y = 0.35; g.add(head);
      var skull = box(0.7, 0.55, 0.55, main || 0x0ea5e9); head.add(skull);
      var visor = box(0.55, 0.22, 0.06, 0x0f172a); visor.position.set(0, 0.03, 0.28); head.add(visor);
      var eyes = [];
      [-1, 1].forEach(function (side) {
        var e = sph(0.06, accent || 0x22d3ee);
        e.position.set(side * 0.15, 0.03, 0.32); head.add(e); eyes.push(e);
      });
      g.userData.face = { eyes: eyes };
      g.userData.head = head;
      var ant = cyl(0.02, 0.02, 0.25, 0x64748b, 6); ant.position.y = 0.4; head.add(ant);
      var tip = sph(0.05, 0xf43f5e); tip.position.y = 0.55; tip.userData.pulse = true; head.add(tip);
      [-1, 1].forEach(function (side) {
        var arm = capsule(0.09, 0.35, 0x64748b);
        arm.position.set(side * 0.56, -0.38, 0); g.add(arm);
        var claw = sph(0.11, main || 0x0ea5e9); claw.position.set(side * 0.56, -0.68, 0); g.add(claw);
        var wheelOrFoot = box(0.22, 0.14, 0.32, 0x334155);
        wheelOrFoot.position.set(side * 0.24, -0.85, 0.05); g.add(wheelOrFoot);
      });
      return g;
    },
    oni: function (skin) {
      return chibi(skin || 0xdc2626, 0xef4444, function (g, head) {
        [-1, 1].forEach(function (side) {
          var horn = cone(0.09, 0.3, 0xfef3c7, 10);
          horn.position.set(side * 0.28, 0.5, 0.05); horn.rotation.z = side * -0.3; head.add(horn);
        });
        var hair = sph(0.3, 0x111827, 1.6, 0.6, 1.2); hair.position.set(0, 0.45, -0.1); head.add(hair);
        for (var i = 0; i < 3; i++) {
          var tooth = cone(0.04, 0.09, 0xffffff, 6);
          tooth.position.set(-0.1 + i * 0.1, -0.34, 0.5); head.add(tooth);
        }
      });
    },
    joker: function () {
      return chibi(0xa855f7, 0xf3e8ff, function (g, head) {
        [-1, 0, 1].forEach(function (side, i) {
          var prong = cone(0.13, 0.42, [0x22d3ee, 0xf472b6, 0xfde047][i], 10);
          prong.position.set(side * 0.3, 0.6, 0);
          prong.rotation.z = side * -0.55;
          head.add(prong);
          var bell = sph(0.06, 0xfde047);
          bell.position.set(side * 0.46, 0.72 - Math.abs(side) * 0.06, 0); head.add(bell);
        });
        var collar = cyl(0.66, 0.4, 0.18, 0xf472b6, 8); collar.position.y = 0.02; g.add(collar);
      });
    },

    /* ── objects & symbols ─────────────────────────────────────── */
    sword: function () {
      var g = new T.Group();
      var blade = extrude(bladeShape(0.16, 1.25), 0.05, 0xcbd5e1, true);
      blade.position.y = 0.35; g.add(blade);
      var guard = box(0.55, 0.09, 0.12, 0xf59e0b); guard.position.y = -0.32; g.add(guard);
      var grip = cyl(0.07, 0.07, 0.45, 0x7c2d12, 10); grip.position.y = -0.58; g.add(grip);
      var pommel = sph(0.1, 0xf59e0b); pommel.position.y = -0.84; g.add(pommel);
      var gem = sph(0.05, 0x22d3ee); gem.position.set(0, -0.32, 0.08); g.add(gem);
      g.userData.shiny = blade;
      return g;
    },
    car: function () {
      var g = new T.Group();
      var body = box(1.5, 0.32, 0.7, 0xef4444); body.position.y = -0.3; g.add(body);
      var nose = box(0.4, 0.2, 0.5, 0xef4444); nose.position.set(0.85, -0.36, 0); g.add(nose);
      var cockpit = sph(0.26, 0x0f172a, 1.2, 0.8, 1); cockpit.position.set(0.05, -0.05, 0); g.add(cockpit);
      var wing = box(0.16, 0.06, 0.85, 0x991b1b); wing.position.set(-0.78, -0.02, 0); g.add(wing);
      [-0.5, 0.55].forEach(function (x) {
        [-1, 1].forEach(function (side) {
          var wheel = cyl(0.2, 0.2, 0.14, 0x111827, 16);
          wheel.rotation.x = Math.PI / 2;
          wheel.position.set(x, -0.5, side * 0.42);
          wheel.userData.wheel = true;
          g.add(wheel);
          var hub = cyl(0.07, 0.07, 0.16, 0xe2e8f0, 10);
          hub.rotation.x = Math.PI / 2;
          hub.position.set(x, -0.5, side * 0.42);
          hub.userData.wheel = true;
          g.add(hub);
        });
      });
      var stripe = box(1.52, 0.05, 0.16, 0xfde047); stripe.position.set(0, -0.13, 0); g.add(stripe);
      g.rotation.y = -0.6;
      return g;
    },
    spacecraft: function () {
      var g = new T.Group();
      var bodyM = cyl(0.32, 0.42, 1.1, 0xe2e8f0, 20); bodyM.position.y = -0.1; g.add(bodyM);
      var noseM = cone(0.32, 0.55, 0x7c3aed, 20); noseM.position.y = 0.72; g.add(noseM);
      var window1 = torus(0.14, 0.045, 0x7c3aed); window1.position.set(0, 0.05, 0.36); g.add(window1);
      var glass = sph(0.13, 0x22d3ee, 1, 1, 0.4); glass.position.set(0, 0.05, 0.37); g.add(glass);
      [0, 1, 2].forEach(function (i) {
        var fin = extrude(triShape(0.24, 0.42), 0.05, 0x7c3aed);
        fin.position.set(Math.cos(i * 2.094) * 0.4, -0.62, Math.sin(i * 2.094) * 0.4);
        fin.rotation.y = -i * 2.094 + Math.PI / 2;
        g.add(fin);
      });
      var flame = cone(0.22, 0.5, 0xfb923c, 14);
      flame.rotation.x = Math.PI; flame.position.y = -0.92; flame.userData.flame = true; g.add(flame);
      var flame2 = cone(0.12, 0.32, 0xfde047, 12);
      flame2.rotation.x = Math.PI; flame2.position.y = -0.86; flame2.userData.flame = true; g.add(flame2);
      return g;
    },
    star: function (r) {
      var g = new T.Group();
      var s = extrude(starShape(r || 0.8, (r || 0.8) * 0.45, 5), 0.22, 0xfbbf24, true);
      g.add(s);
      var head = new T.Group(); g.add(head);
      g.userData.face = addFace(head, { z: 0.12, gap: 0.9, y: 0.12, scale: 0.9 });
      g.userData.face.eyes.forEach(function (e, i) { e.position.set((i ? 1 : -1) * 0.24, 0.1, 0.16); });
      g.userData.head = head;
      var smile = torus(0.12, 0.026, 0x92400e, Math.PI);
      smile.rotation.z = Math.PI; smile.position.set(0, -0.14, 0.15); head.add(smile);
      g.userData.shiny = s;
      return g;
    },
    heart: function () {
      var g = new T.Group();
      var h = extrude(heartShape(0.85), 0.28, 0xec4899, true);
      g.add(h);
      var head = new T.Group(); g.add(head);
      g.userData.face = addFace(head, { z: 0.16, gap: 0.28, y: 0.12, scale: 0.85 });
      g.userData.head = head;
      var glint = sph(0.09, 0xfbcfe8, 1, 1, 0.4); glint.position.set(-0.3, 0.35, 0.15); g.add(glint);
      return g;
    },
    bolt: function () {
      var g = new T.Group();
      var b = extrude(boltShape(), 0.2, 0xfde047, true);
      g.add(b);
      g.userData.shiny = b;
      var head = new T.Group(); g.add(head);
      g.userData.face = addFace(head, { z: 0.14, gap: 0.2, y: 0.35, scale: 0.7 });
      g.userData.head = head;
      return g;
    },
    flame: function () {
      var g = new T.Group();
      var outer = cone(0.55, 1.3, 0xf97316, 18); outer.scale.z = 0.8; g.add(outer);
      var inner = cone(0.34, 0.85, 0xfde047, 16); inner.position.y = -0.15; inner.scale.z = 0.8; g.add(inner);
      var core = cone(0.18, 0.5, 0xfff7ed, 12); core.position.y = -0.3; core.scale.z = 0.8; g.add(core);
      outer.userData.flame = true; inner.userData.flame = true;
      var head = new T.Group(); head.position.y = -0.25; g.add(head);
      g.userData.face = addFace(head, { z: 0.35, gap: 0.55, scale: 0.8, eyeColor: 0x7c2d12 });
      g.userData.head = head;
      return g;
    },
    drop: function () {
      var g = new T.Group();
      var body = sph(0.55, 0x0ea5e9); body.position.y = -0.15; g.add(body);
      var tip = cone(0.44, 0.8, 0x0ea5e9, 20); tip.position.y = 0.45; g.add(tip);
      var glint = sph(0.12, 0xbae6fd, 1, 1.6, 0.4); glint.position.set(-0.22, 0.05, 0.42); g.add(glint);
      var head = new T.Group(); head.position.y = -0.15; g.add(head);
      g.userData.face = addFace(head, { z: 0.48, gap: 0.42, scale: 0.9 });
      g.userData.head = head;
      return g;
    },
    skull: function () {
      var g = new T.Group();
      var cranium = sph(0.58, 0xf1f5f9, 1, 1.05, 0.95); cranium.position.y = 0.12; g.add(cranium);
      var jaw = box(0.5, 0.28, 0.4, 0xe2e8f0); jaw.position.set(0, -0.45, 0.12); g.add(jaw);
      [-1, 1].forEach(function (side) {
        var socket = sph(0.15, 0x0f172a, 1, 1.15, 0.5);
        socket.position.set(side * 0.22, 0.08, 0.48); g.add(socket);
        var glow = sph(0.05, 0x22d3ee); glow.position.set(side * 0.22, 0.06, 0.55); glow.userData.pulse = true; g.add(glow);
      });
      var noseHole = cone(0.07, 0.12, 0x0f172a, 8); noseHole.rotation.x = Math.PI; noseHole.position.set(0, -0.15, 0.55); g.add(noseHole);
      [-0.15, -0.05, 0.05, 0.15].forEach(function (x) {
        var tooth = box(0.07, 0.12, 0.06, 0xffffff); tooth.position.set(x, -0.33, 0.32); g.add(tooth);
      });
      return g;
    },
    crown: function () {
      var g = new T.Group();
      var band = cyl(0.6, 0.66, 0.35, 0xfbbf24, 24); band.position.y = -0.35; g.add(band);
      for (var i = 0; i < 5; i++) {
        var a = (i / 5) * Math.PI * 2;
        var spike = cone(0.14, 0.5, 0xfbbf24, 10);
        spike.position.set(Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.55);
        g.add(spike);
        var jewelTip = sph(0.06, 0xef4444); jewelTip.position.set(Math.cos(a) * 0.55, 0.32, Math.sin(a) * 0.55); g.add(jewelTip);
      }
      var gem = sph(0.13, 0x22d3ee); gem.position.set(0, -0.32, 0.63); g.add(gem);
      g.userData.shiny = band;
      return g;
    },
    eye: function () {
      var g = new T.Group();
      var ball = sph(0.75, 0xf8fafc); g.add(ball);
      var iris = sph(0.34, 0xdc2626, 1, 1, 0.5); iris.position.z = 0.62; g.add(iris);
      var iris2 = torus(0.22, 0.04, 0x7f1d1d); iris2.position.z = 0.78; g.add(iris2);
      var pupil = sph(0.13, 0x0f172a, 1, 1, 0.5); pupil.position.z = 0.72; g.add(pupil);
      [0, 1, 2].forEach(function (i) {
        var a = i * 2.094 + 0.5;
        var tomoe = sph(0.05, 0x0f172a);
        tomoe.position.set(Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.72);
        g.add(tomoe);
      });
      var glint = sph(0.08, 0xffffff, 1, 1, 0.4); glint.position.set(-0.2, 0.22, 0.68); g.add(glint);
      g.userData.iris = iris;
      return g;
    },
    ramen: function () {
      var g = new T.Group();
      var bowl = cyl(0.75, 0.45, 0.6, 0xdc2626, 24); bowl.position.y = -0.35; g.add(bowl);
      var rim = torus(0.75, 0.05, 0xfef3c7); rim.rotation.x = Math.PI / 2; rim.position.y = -0.05; g.add(rim);
      var broth = cyl(0.7, 0.7, 0.05, 0xfbbf24, 24); broth.position.y = -0.05; g.add(broth);
      for (var i = 0; i < 3; i++) {
        var noodle = torus(0.12 + i * 0.12, 0.035, 0xfef3c7);
        noodle.rotation.x = Math.PI / 2; noodle.position.y = 0.0;
        g.add(noodle);
      }
      var egg = sph(0.14, 0xffffff, 1, 0.6, 1); egg.position.set(0.3, 0.03, 0.2); g.add(egg);
      var yolk = sph(0.07, 0xf59e0b, 1, 0.5, 1); yolk.position.set(0.3, 0.07, 0.2); g.add(yolk);
      var nori = box(0.22, 0.3, 0.02, 0x14532d); nori.position.set(-0.35, 0.16, -0.15); nori.rotation.x = -0.3; g.add(nori);
      var chop1 = cyl(0.02, 0.03, 1.1, 0x92400e, 8); chop1.position.set(0.35, 0.45, -0.1); chop1.rotation.z = -0.7; g.add(chop1);
      var chop2 = cyl(0.02, 0.03, 1.1, 0x92400e, 8); chop2.position.set(0.45, 0.42, -0.05); chop2.rotation.z = -0.75; g.add(chop2);
      var steamHolder = new T.Group(); g.add(steamHolder); g.userData.steam = [];
      for (var s = 0; s < 3; s++) {
        var puff = sph(0.08, 0xf8fafc); puff.material.transparent = true; puff.material.opacity = 0.6;
        puff.position.set(-0.25 + s * 0.25, 0.3, 0); puff.userData.steamI = s;
        steamHolder.add(puff); g.userData.steam.push(puff);
      }
      return g;
    },
    dango: function () {
      var g = new T.Group();
      var stick = cyl(0.03, 0.03, 1.7, 0xd6b28a, 8); stick.position.y = -0.2; g.add(stick);
      var colors = [0xfda4af, 0xf8fafc, 0x86efac];
      colors.forEach(function (c, i) {
        var ball = sph(0.3, c); ball.position.y = 0.55 - i * 0.58; g.add(ball);
        if (i === 0) {
          var head = new T.Group(); head.position.y = 0.55; g.add(head);
          g.userData.face = addFace(head, { z: 0.26, gap: 0.38, scale: 0.55 });
          g.userData.head = head;
        }
      });
      return g;
    },
    lantern: function () {
      var g = new T.Group();
      var body = sph(0.6, 0xdc2626, 1, 1.15, 1); g.add(body);
      for (var i = 1; i < 4; i++) {
        var ring = torus(Math.sin((i / 4) * Math.PI) * 0.6, 0.02, 0x991b1b);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = Math.cos((i / 4) * Math.PI) * 0.68;
        g.add(ring);
      }
      var capT = cyl(0.22, 0.3, 0.14, 0xfbbf24, 12); capT.position.y = 0.72; g.add(capT);
      var capB = cyl(0.3, 0.22, 0.14, 0xfbbf24, 12); capB.position.y = -0.72; g.add(capB);
      var tassel = cyl(0.05, 0.09, 0.35, 0xf59e0b, 8); tassel.position.y = -0.98; g.add(tassel);
      var glow = sph(0.4, 0xfde047); glow.material.transparent = true; glow.material.opacity = 0.35;
      glow.userData.pulse = true; g.add(glow);
      var head = new T.Group(); g.add(head);
      g.userData.face = addFace(head, { z: 0.5, gap: 0.4, scale: 0.9, eyeColor: 0x431407 });
      g.userData.head = head;
      return g;
    },
    sakura: function () {
      var g = new T.Group();
      for (var i = 0; i < 5; i++) {
        var a = (i / 5) * Math.PI * 2 + Math.PI / 2;
        var petal = sph(0.34, 0xfbcfe8, 1, 1.45, 0.25);
        petal.position.set(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0);
        petal.rotation.z = a - Math.PI / 2;
        g.add(petal);
      }
      var centre = sph(0.22, 0xf472b6); centre.position.z = 0.08; g.add(centre);
      for (var s2 = 0; s2 < 6; s2++) {
        var a2 = (s2 / 6) * Math.PI * 2;
        var stamen = sph(0.04, 0xfde047);
        stamen.position.set(Math.cos(a2) * 0.14, Math.sin(a2) * 0.14, 0.2);
        g.add(stamen);
      }
      var head = new T.Group(); head.position.z = 0.1; g.add(head);
      g.userData.face = addFace(head, { z: 0.12, gap: 0.55, y: 0.05, scale: 0.7, eyeColor: 0x831843 });
      g.userData.head = head;
      return g;
    },
    yokai: function () {
      var g = RECIPES.ghost(0xc4b5fd);
      var flame1 = cone(0.1, 0.28, 0x7c3aed, 10); flame1.position.set(-0.7, 0.5, 0); flame1.userData.flame = true; g.add(flame1);
      var flame2 = cone(0.08, 0.22, 0x22d3ee, 10); flame2.position.set(0.7, 0.35, 0); flame2.userData.flame = true; g.add(flame2);
      return g;
    },
    sparkle: function () {
      var g = new T.Group();
      var main = extrude(sparkleShape(0.75), 0.16, 0xfde047, true); g.add(main);
      var mini = extrude(sparkleShape(0.28), 0.1, 0xfef9c3); mini.position.set(0.6, 0.55, 0.1); g.add(mini);
      var mini2 = extrude(sparkleShape(0.2), 0.1, 0xfef9c3); mini2.position.set(-0.62, -0.5, 0.1); g.add(mini2);
      g.userData.shiny = main;
      return g;
    },
    kawaii: function () {
      return chibi(0xfda4af, 0xfff1f2, function (g, head) {
        [-1, 1].forEach(function (side) {
          var blush = sph(0.09, 0xfb7185, 1, 0.6, 0.4);
          blush.position.set(side * 0.36, -0.12, 0.44); head.add(blush);
        });
        var bow = new T.Group(); bow.position.set(0.3, 0.5, 0.1); head.add(bow);
        var k = sph(0.07, 0xf43f5e); bow.add(k);
        [-1, 1].forEach(function (side) {
          var loop = sph(0.11, 0xfb7185, 1.4, 0.8, 0.5);
          loop.position.x = side * 0.14; loop.rotation.z = side * 0.5; bow.add(loop);
        });
      });
    },
    magical: function () {
      var g = RECIPES.hero(0xf9a8d4, 0xec4899);
      var wand = cyl(0.03, 0.03, 0.9, 0xfdf2f8, 8); wand.position.set(0.68, -0.2, 0.15); wand.rotation.z = -0.3; g.add(wand);
      var wandStar = extrude(starShape(0.14, 0.07, 5), 0.04, 0xfde047); wandStar.position.set(0.82, 0.25, 0.15); g.add(wandStar);
      return g;
    },
  };

  /* ------- 2D shapes used by extrude() ------- */
  function triShape(w, h) {
    var s = new T.Shape();
    s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2); s.lineTo(0, h / 2); s.closePath();
    return s;
  }
  function starShape(outer, inner, points) {
    var s = new T.Shape();
    for (var i = 0; i < points * 2; i++) {
      var r = i % 2 === 0 ? outer : inner;
      var a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      var x = Math.cos(a) * r, y = -Math.sin(a) * r;
      if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
    }
    s.closePath();
    return s;
  }
  function sparkleShape(r) {
    var s = new T.Shape(), k = r * 0.18;
    s.moveTo(0, r); s.quadraticCurveTo(k, k, r, 0); s.quadraticCurveTo(k, -k, 0, -r);
    s.quadraticCurveTo(-k, -k, -r, 0); s.quadraticCurveTo(-k, k, 0, r);
    return s;
  }
  function heartShape(r) {
    var s = new T.Shape();
    s.moveTo(0, r * 0.6);
    s.bezierCurveTo(0, r * 0.95, -r * 0.55, r * 1.1, -r * 0.55, r * 0.6);
    s.bezierCurveTo(-r * 0.55, r * 0.25, -r * 0.2, r * 0.05, 0, -r * 0.4);
    s.bezierCurveTo(r * 0.2, r * 0.05, r * 0.55, r * 0.25, r * 0.55, r * 0.6);
    s.bezierCurveTo(r * 0.55, r * 1.1, 0, r * 0.95, 0, r * 0.6);
    return s;
  }
  function boltShape() {
    var s = new T.Shape();
    s.moveTo(0.12, 0.9); s.lineTo(-0.38, 0.05); s.lineTo(-0.05, 0.05);
    s.lineTo(-0.2, -0.9); s.lineTo(0.38, 0.12); s.lineTo(0.04, 0.12);
    s.closePath();
    return s;
  }
  function bladeShape(w, h) {
    var s = new T.Shape();
    s.moveTo(-w / 2, -h / 2); s.lineTo(w / 2, -h / 2);
    s.lineTo(w / 2, h / 2 - 0.25); s.lineTo(0, h / 2); s.lineTo(-w / 2, h / 2 - 0.25);
    s.closePath();
    return s;
  }

  /* avatar id → recipe (anime ids reuse classic builders with variants) */
  var RECIPE_FOR = {
    dragon: "dragon", sword: "sword", car: "car", butterfly: "butterfly",
    spacecraft: "spacecraft", trex: "trex", stego: "stego", joker: "joker",
    unicorn: "unicorn", wizard: "wizard", ninja: "ninja", alien: "alien",
    ghost: "ghost", robot: "robot", fox: "fox", octopus: "octopus",
    shark: "shark", tiger: "tiger", panda: "panda", wolf: "wolf",
    anime_hero: "hero", anime_star: "star", anime_sparkle: "sparkle",
    anime_kawaii: "kawaii", anime_neko: "tiger", anime_kitsune: "fox",
    anime_oni: "oni", anime_tengu: "oni", anime_samurai: "sword",
    anime_magicalgirl: "magical", anime_ramen: "ramen", anime_mecha: "robot",
    anime_dango: "dango", anime_lantern: "lantern", anime_cherry: "sakura",
    anime_thunder: "bolt", anime_fire: "flame", anime_water: "drop",
    anime_heart: "heart", anime_skull: "skull", anime_crown: "crown",
    anime_eye: "eye", anime_yokai: "yokai", anime_panda: "panda",
  };

  function buildCharacter(avatarId) {
    var key = RECIPE_FOR[avatarId] || "kawaii";
    var g;
    try { g = RECIPES[key](); }
    catch (e) { console.warn("[kk3d] recipe failed for", avatarId, e); g = chibi(0x64748b, 0x94a3b8); }
    g.userData.avatarId = avatarId;
    return g;
  }

  /* ============================ animation ================================ */
  /* Signature idle motion per avatar_anim.css keyframe name. */
  var ANIMS = {
    "kk-float":    function (g, t) { g.position.y = Math.sin(t * 1.8) * 0.09; },
    "kk-bounce":   function (g, t) { g.position.y = Math.abs(Math.sin(t * 3.2)) * 0.14; g.scale.y = 1 - Math.abs(Math.sin(t * 3.2)) * 0.04; },
    "kk-swing":    function (g, t) { g.rotation.z = Math.sin(t * 2.1) * 0.24; },
    "kk-spin":     function (g, t) { g.rotation.y = t * 0.9; },
    "kk-flutter":  function (g, t) { g.position.y = Math.sin(t * 2.4) * 0.1; g.rotation.z = Math.sin(t * 5) * 0.06; },
    "kk-zoom":     function (g, t) { g.position.x = Math.sin(t * 1.4) * 0.3; g.rotation.z = -Math.cos(t * 1.4) * 0.14; },
    "kk-blastoff": function (g, t) { g.position.y = Math.abs(Math.sin(t * 1.1)) * 0.24; g.position.x = Math.sin(t * 9) * 0.012; },
    "kk-stomp":    function (g, t) { var p = Math.abs(Math.sin(t * 2.6)); g.position.y = p * 0.07; g.rotation.z = Math.sin(t * 2.6) * 0.07; },
    "kk-dash":     function (g, t) { g.position.x = Math.sin(t * 1.7) * 0.3; g.rotation.z = -0.1 - Math.cos(t * 1.7) * 0.08; },
    "kk-wobble":   function (g, t) { g.rotation.z = Math.sin(t * 3) * 0.15; g.position.y = Math.sin(t * 6) * 0.02; },
    "kk-tilt":     function (g, t) { g.rotation.z = Math.sin(t * 1.2) * 0.12; },
  };
  var ANIM_FOR = { /* same table as avatars.py */
    dragon: "kk-float", sword: "kk-swing", car: "kk-dash", butterfly: "kk-flutter",
    spacecraft: "kk-blastoff", trex: "kk-stomp", stego: "kk-stomp", joker: "kk-wobble",
    unicorn: "kk-bounce", wizard: "kk-tilt", ninja: "kk-dash", alien: "kk-float",
    ghost: "kk-float", robot: "kk-stomp", fox: "kk-bounce", octopus: "kk-wobble",
    shark: "kk-zoom", tiger: "kk-bounce", panda: "kk-tilt", wolf: "kk-tilt",
    anime_hero: "kk-blastoff", anime_star: "kk-spin", anime_sparkle: "kk-flutter",
    anime_kawaii: "kk-bounce", anime_neko: "kk-bounce", anime_kitsune: "kk-dash",
    anime_oni: "kk-stomp", anime_tengu: "kk-wobble", anime_samurai: "kk-swing",
    anime_magicalgirl: "kk-spin", anime_ramen: "kk-float", anime_mecha: "kk-stomp",
    anime_dango: "kk-float", anime_lantern: "kk-swing", anime_cherry: "kk-flutter",
    anime_thunder: "kk-zoom", anime_fire: "kk-bounce", anime_water: "kk-float",
    anime_heart: "kk-bounce", anime_skull: "kk-tilt", anime_crown: "kk-float",
    anime_eye: "kk-spin", anime_yokai: "kk-flutter", anime_panda: "kk-tilt",
  };

  /* per-part detail animation: wings, flames, tentacles, blinking, pulses */
  function animateParts(char, t, blinkState) {
    char.traverse(function (o) {
      var u = o.userData;
      if (u.flap !== undefined) o.rotation.y = u.flap * (0.9 + Math.sin(t * 8) * 0.35);
      if (u.flame) { var f = 0.85 + Math.sin(t * 14 + o.position.y) * 0.18; o.scale.set(f, 0.9 + Math.sin(t * 11) * 0.22, f); }
      if (u.pulse && o.material) o.material.opacity !== undefined && o.material.transparent
        ? (o.material.opacity = 0.25 + (Math.sin(t * 3) * 0.5 + 0.5) * 0.3)
        : o.scale.setScalar(0.85 + (Math.sin(t * 4 + o.id) * 0.5 + 0.5) * 0.4);
      if (u.tent !== undefined) o.rotation.x = -Math.sin((u.tent / 8) * Math.PI * 2) * 0.5 + Math.sin(t * 2.4 + u.tent) * 0.18;
      if (u.cape) o.rotation.x = 0.12 + Math.sin(t * 2.2) * 0.1;
      if (u.wheel) o.rotation.z -= 0.15;
      if (u.steamI !== undefined) {
        var p = ((t * 0.5 + u.steamI * 0.33) % 1);
        o.position.y = 0.15 + p * 0.7;
        o.material.opacity = 0.6 * (1 - p);
        o.material.transparent = true;
      }
    });
    /* blink */
    var face = char.userData.face;
    if (face && face.eyes) {
      var squeeze = blinkState < 0.12 ? Math.max(0.08, Math.sin((blinkState / 0.12) * Math.PI)) : 1;
      face.eyes.forEach(function (e) { e.scale.y = blinkState < 0.12 ? 1 - squeeze * 0.9 : 1; });
    }
    if (char.userData.ghost) {
      char.traverse(function (o) {
        if (o.material && o.material.color) { o.material.transparent = true; o.material.opacity = 0.88; }
      });
    }
  }

  /* ======================================================================
     AVATAR STAGE  —  KK3D.mountAvatar(container, avatarId, opts)
     Interactive controls:
       • drag / touch-drag  → orbit the character
       • wheel / pinch      → zoom (clamped)
       • click / tap        → play the signature move
       • opts.autoRotate    → gentle turntable while idle (default true)
     ====================================================================== */
  function mountAvatar(container, avatarId, opts) {
    if (!HAS_WEBGL || !container) return null;
    opts = opts || {};

    var renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(clamp(window.devicePixelRatio || 1, 1, 2));
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.style.cursor = "grab";
    container.appendChild(renderer.domElement);

    var scene = new T.Scene();
    var camera = new T.PerspectiveCamera(38, 1, 0.1, 50);
    var camDist = opts.distance || 4.2;
    camera.position.set(0, 0.4, camDist);
    camera.lookAt(0, 0, 0);

    scene.add(new T.HemisphereLight(0xbfdcff, 0x2b2140, 0.95));
    var key = new T.DirectionalLight(0xffffff, 0.85); key.position.set(2.5, 4, 3); scene.add(key);
    var rim = new T.DirectionalLight(0x8b5cf6, 0.5); rim.position.set(-3, 1.5, -2.5); scene.add(rim);

    /* soft blob shadow */
    var shadow = new T.Mesh(
      new T.PlaneGeometry(2.6, 2.6),
      new T.MeshBasicMaterial({ map: softShadowTexture(), transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -1.15;
    scene.add(shadow);

    var rig = new T.Group(); scene.add(rig);          /* user orbit */
    var animG = new T.Group(); rig.add(animG);        /* idle / move transforms */
    var char = null;

    function setAvatar(id) {
      if (char) { animG.remove(char); disposeDeep(char); }
      char = buildCharacter(id);
      animG.add(char);
      state.avatarId = id;
      state.anim = ANIM_FOR[id] || "kk-float";
      state.moveT = -1;
    }

    var state = {
      avatarId: avatarId, anim: "kk-float",
      yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0,
      zoom: camDist, targetZoom: camDist,
      moveT: -1, blinkAt: 2 + Math.random() * 2,
      dragging: false, moved: false, lastX: 0, lastY: 0, pinch: 0,
      raf: 0, disposed: false, t: 0,
    };
    setAvatar(avatarId);

    /* ---------- controls ---------- */
    var el = renderer.domElement;
    function onDown(e) {
      state.dragging = true; state.moved = false;
      state.lastX = e.clientX; state.lastY = e.clientY;
      el.style.cursor = "grabbing";
      el.setPointerCapture && e.pointerId !== undefined && el.setPointerCapture(e.pointerId);
    }
    function onMove(e) {
      if (!state.dragging) return;
      var dx = e.clientX - state.lastX, dy = e.clientY - state.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) state.moved = true;
      state.targetYaw += dx * 0.011;
      state.targetPitch = clamp(state.targetPitch + dy * 0.007, -0.5, 0.5);
      state.lastX = e.clientX; state.lastY = e.clientY;
    }
    function onUp() {
      if (state.dragging && !state.moved) playMove();   /* tap = trick */
      state.dragging = false;
      el.style.cursor = "grab";
    }
    function onWheel(e) {
      e.preventDefault();
      state.targetZoom = clamp(state.targetZoom + e.deltaY * 0.0035, 2.6, 7);
    }
    function onTouchStart(e) { if (e.touches.length === 2) state.pinch = pinchDist(e); }
    function onTouchMove(e) {
      if (e.touches.length === 2) {
        e.preventDefault();
        var d = pinchDist(e);
        state.targetZoom = clamp(state.targetZoom + (state.pinch - d) * 0.01, 2.6, 7);
        state.pinch = d;
      }
    }
    function pinchDist(e) {
      var a = e.touches[0], b = e.touches[1];
      return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    }
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });

    function playMove() {
      if (state.moveT < 0) state.moveT = 0;
      if (opts.onMove) opts.onMove(state.avatarId);
    }

    /* ---------- sizing ---------- */
    function resize() {
      var w = container.clientWidth || 300, h = container.clientHeight || 300;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    resize();
    var ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(container); else window.addEventListener("resize", resize);

    /* ---------- loop ---------- */
    var last = performance.now();
    var autoRotate = opts.autoRotate !== false && !REDUCED;
    function frame(now) {
      if (state.disposed) return;
      state.raf = requestAnimationFrame(frame);
      var dt = Math.min((now - last) / 1000, 0.05); last = now;
      state.t += dt;
      var t = state.t;

      /* orbit easing */
      if (autoRotate && !state.dragging) state.targetYaw += dt * 0.25;
      state.yaw += (state.targetYaw - state.yaw) * 0.12;
      state.pitch += (state.targetPitch - state.pitch) * 0.12;
      state.zoom += (state.targetZoom - state.zoom) * 0.1;
      rig.rotation.y = state.yaw;
      rig.rotation.x = state.pitch;
      camera.position.z = state.zoom;

      /* idle pose */
      animG.position.set(0, 0, 0); animG.rotation.set(0, 0, 0); animG.scale.set(1, 1, 1);
      if (!REDUCED) ANIMS[state.anim](animG, t);

      /* signature move: jump + full spin, 1s */
      if (state.moveT >= 0) {
        state.moveT += dt;
        var p = state.moveT / 1.0;
        if (p >= 1) { state.moveT = -1; }
        else {
          animG.position.y += Math.sin(p * Math.PI) * 0.6;
          animG.rotation.y += p * Math.PI * 2;
          var squash = 1 + Math.sin(p * Math.PI) * 0.08;
          animG.scale.set(1 / squash, squash, 1 / squash);
        }
      }

      /* blink clock */
      state.blinkAt -= dt;
      if (state.blinkAt < -0.12) state.blinkAt = 2 + Math.random() * 2.5;
      if (char && !REDUCED) animateParts(char, t, state.blinkAt < 0 ? -state.blinkAt : 1);

      shadow.material.opacity = 0.9 - animG.position.y * 0.5;
      shadow.scale.setScalar(1 - animG.position.y * 0.18);

      renderer.render(scene, camera);
    }
    state.raf = requestAnimationFrame(frame);

    /* pause when off-screen / hidden tab */
    function vis() {
      if (document.hidden) { cancelAnimationFrame(state.raf); }
      else { last = performance.now(); state.raf = requestAnimationFrame(frame); }
    }
    document.addEventListener("visibilitychange", vis);

    return {
      setAvatar: setAvatar,
      playMove: playMove,
      dispose: function () {
        state.disposed = true;
        cancelAnimationFrame(state.raf);
        document.removeEventListener("visibilitychange", vis);
        el.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        el.removeEventListener("wheel", onWheel);
        el.removeEventListener("touchstart", onTouchStart);
        el.removeEventListener("touchmove", onTouchMove);
        if (ro) ro.disconnect(); else window.removeEventListener("resize", resize);
        disposeDeep(scene);
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      },
    };
  }

  /* ======================================================================
     ENVIRONMENTS — KK3D.mountEnvironment(container, sceneId)
     Animated 3D scenery for Quiz.chart_background, rendered behind the
     live chart. Low draw-call budget; pauses on hidden tab; respects
     prefers-reduced-motion (renders one static frame).
     ====================================================================== */

  function starField(n, spread, size, color) {
    var pos = new Float32Array(n * 3);
    for (var i = 0; i < n * 3; i++) pos[i] = (Math.random() - 0.5) * spread;
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(pos, 3));
    var m = new T.PointsMaterial({ color: color || 0xffffff, size: size || 0.06, transparent: true, opacity: 0.9 });
    return new T.Points(g, m);
  }
  function fallingField(n, w, h, depth, size, color) {
    /* returns {points, update(dt, speed)} — particles wrap from top to bottom */
    var pos = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * w;
      pos[i * 3 + 1] = (Math.random() - 0.5) * h;
      pos[i * 3 + 2] = (Math.random() - 0.5) * depth;
    }
    var g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(pos, 3));
    var points = new T.Points(g, new T.PointsMaterial({ color: color, size: size, transparent: true, opacity: 0.8 }));
    return {
      points: points,
      update: function (dt, speed, drift) {
        var arr = g.attributes.position.array;
        for (var i = 0; i < n; i++) {
          arr[i * 3 + 1] -= speed * dt;
          if (drift) arr[i * 3] += Math.sin(arr[i * 3 + 1] * 2 + i) * drift * dt;
          if (arr[i * 3 + 1] < -h / 2) { arr[i * 3 + 1] = h / 2; arr[i * 3] = (Math.random() - 0.5) * w; }
        }
        g.attributes.position.needsUpdate = true;
      },
    };
  }
  function risingField(n, w, h, depth, size, color) {
    var f = fallingField(n, w, h, depth, size, color);
    var base = f.update;
    f.update = function (dt, speed, drift) { base(-dt, speed, drift); };
    return f;
  }
  function simpleTree(x, z, scale, leaf) {
    var g = new T.Group();
    var trunk = cyl(0.08, 0.12, 0.5, 0x854d0e, 8); trunk.position.y = 0.25; g.add(trunk);
    [0.55, 0.95, 1.3].forEach(function (y, i) {
      var c = cone(0.55 - i * 0.13, 0.55, leaf || 0x15803d, 10);
      c.position.y = y; g.add(c);
    });
    g.position.set(x, 0, z); g.scale.setScalar(scale);
    return g;
  }
  function ball(colorTop, dots) {
    var b = sph(0.35, colorTop);
    if (dots) {
      for (var i = 0; i < 8; i++) {
        var d = sph(0.09, 0x111827, 1, 1, 0.35);
        var a = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI;
        d.position.set(Math.sin(ph) * Math.cos(a) * 0.34, Math.cos(ph) * 0.34, Math.sin(ph) * Math.sin(a) * 0.34);
        d.lookAt(0, 0, 0);
        b.add(d);
      }
    }
    return b;
  }

  var SCENES = {
    normal: function (scene) {
      var orbs = [];
      for (var i = 0; i < 12; i++) {
        var o = sph(0.15 + Math.random() * 0.3, [0x6366f1, 0x22d3ee, 0xec4899][i % 3]);
        o.material.transparent = true; o.material.opacity = 0.22;
        o.position.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 6, -2 - Math.random() * 4);
        o.userData.seed = Math.random() * 10;
        scene.add(o); orbs.push(o);
      }
      return { update: function (t) { orbs.forEach(function (o) { o.position.y += Math.sin(t * 0.6 + o.userData.seed) * 0.002; }); } };
    },
    space: function (scene) {
      scene.add(starField(500, 26, 0.05));
      var planet = sph(1.1, 0x7c3aed); planet.position.set(4.2, 2.2, -6); scene.add(planet);
      var ring = torus(1.7, 0.09, 0xc4b5fd); ring.position.copy(planet.position); ring.rotation.x = 1.2; scene.add(ring);
      var moon = sph(0.35, 0xe2e8f0); scene.add(moon);
      return { update: function (t) {
        moon.position.set(planet.position.x + Math.cos(t * 0.4) * 2.6, planet.position.y + Math.sin(t * 0.4) * 0.7, planet.position.z + Math.sin(t * 0.4) * 1.4);
        ring.rotation.z = t * 0.05;
      } };
    },
    astronaut: function (scene) {
      scene.add(starField(400, 24, 0.05));
      var astro = RECIPES.robot(0xf8fafc, 0x38bdf8);   /* white suit "astronaut" build */
      astro.scale.setScalar(0.8); astro.position.set(-3.4, 1.2, -3.5); scene.add(astro);
      var earth = sph(1.4, 0x1d4ed8); earth.position.set(4.6, -1.8, -7); scene.add(earth);
      var land = sph(0.55, 0x16a34a, 1.3, 0.8, 0.4); land.position.set(4.2, -1.4, -5.75); scene.add(land);
      return { update: function (t) {
        astro.position.y = 1.2 + Math.sin(t * 0.7) * 0.35;
        astro.rotation.z = Math.sin(t * 0.5) * 0.25;
        astro.rotation.y = t * 0.2;
        earth.rotation.y = t * 0.06;
      } };
    },
    forest: function (scene) {
      var ground = new T.Mesh(new T.PlaneGeometry(30, 20), mat(0x14532d));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -2.4; scene.add(ground);
      for (var i = 0; i < 9; i++) {
        scene.add(simpleTree(-8 + i * 2 + Math.random(), -3 - Math.random() * 4, 0.9 + Math.random() * 0.9,
          [0x15803d, 0x166534, 0x22c55e][i % 3]));
      }
      var flies = risingField(50, 20, 8, 6, 0.07, 0xfde047);
      flies.points.position.y = -1; scene.add(flies.points);
      return { update: function (t, dt) { flies.update(dt, 0.25, 0.15); } };
    },
    room: function (scene) {
      /* neon game-room: glowing grid floor + drifting shapes */
      var grid = new T.GridHelper(30, 30, 0x22d3ee, 0x312e81);
      grid.position.y = -2.4; scene.add(grid);
      var shapes = [];
      var geos = [new T.TorusGeometry(0.4, 0.12, 10, 20), new T.BoxGeometry(0.5, 0.5, 0.5), new T.ConeGeometry(0.35, 0.6, 4)];
      for (var i = 0; i < 8; i++) {
        var s = new T.Mesh(geos[i % 3], mat([0xec4899, 0x22d3ee, 0xa78bfa][i % 3], { emissive: new T.Color([0xec4899, 0x22d3ee, 0xa78bfa][i % 3]), emissiveIntensity: 0.35 }));
        s.position.set((Math.random() - 0.5) * 12, Math.random() * 4 - 1, -2 - Math.random() * 5);
        s.userData.seed = Math.random() * 9;
        scene.add(s); shapes.push(s);
      }
      return { update: function (t) {
        shapes.forEach(function (s) { s.rotation.x = t * 0.4 + s.userData.seed; s.rotation.y = t * 0.3; s.position.y += Math.sin(t + s.userData.seed) * 0.002; });
        grid.position.z = (t * 0.8) % 1;
      } };
    },
    binary: function (scene) {
      /* Matrix-style falling glyph sprites */
      var tex = canvasTexture(64, function (ctx, s) {
        ctx.fillStyle = "#22c55e"; ctx.font = "bold 44px monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(Math.random() < 0.5 ? "0" : "1", s / 2, s / 2);
      });
      var cols = [];
      for (var i = 0; i < 60; i++) {
        var sp = new T.Sprite(new T.SpriteMaterial({ map: tex, color: i % 4 === 0 ? 0xbbf7d0 : 0x22c55e, transparent: true, opacity: 0.85 }));
        sp.scale.setScalar(0.3 + Math.random() * 0.25);
        sp.position.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 9, -1 - Math.random() * 5);
        sp.userData.v = 1 + Math.random() * 2;
        scene.add(sp); cols.push(sp);
      }
      return { update: function (t, dt) {
        cols.forEach(function (sp) {
          sp.position.y -= sp.userData.v * dt;
          if (sp.position.y < -4.8) { sp.position.y = 4.8; sp.position.x = (Math.random() - 0.5) * 14; }
        });
      } };
    },
    whale_sea: function (scene) {
      scene.fog = new T.Fog(0x0c4a6e, 6, 18);
      var whale = new T.Group();
      var bodyW = sph(1, 0x0369a1, 1.9, 0.9, 0.9); whale.add(bodyW);
      var bellyW = sph(0.85, 0xbae6fd, 1.8, 0.7, 0.75); bellyW.position.y = -0.3; whale.add(bellyW);
      var tailW = extrude(triShape(1.1, 0.7), 0.1, 0x075985); tailW.position.set(-2.05, 0.25, 0); tailW.rotation.x = Math.PI / 2; whale.add(tailW);
      var eyeW = sph(0.08, 0x082f49); eyeW.position.set(1.35, 0.1, 0.62); whale.add(eyeW);
      whale.position.set(0, 0.5, -5); whale.scale.setScalar(0.9);
      scene.add(whale);
      var bubbles = risingField(80, 18, 10, 8, 0.09, 0xbae6fd);
      scene.add(bubbles.points);
      return { update: function (t, dt) {
        whale.position.x = Math.sin(t * 0.25) * 4;
        whale.position.y = 0.5 + Math.sin(t * 0.5) * 0.5;
        whale.rotation.y = Math.cos(t * 0.25) > 0 ? 0 : Math.PI;
        whale.rotation.z = Math.sin(t * 0.5) * 0.08;
        bubbles.update(dt, 0.6, 0.2);
      } };
    },
    aquatic: function (scene) {
      scene.fog = new T.Fog(0x155e75, 5, 16);
      var fish = [];
      for (var i = 0; i < 7; i++) {
        var f = new T.Group();
        var col = [0xf97316, 0xfacc15, 0x22d3ee][i % 3];
        var bodyF = sph(0.22, col, 1.5, 1, 0.7); f.add(bodyF);
        var tailF = extrude(triShape(0.2, 0.26), 0.04, col); tailF.position.x = -0.36; tailF.rotation.z = -Math.PI / 2; f.add(tailF);
        f.position.set((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 5, -2 - Math.random() * 4);
        f.userData.seed = Math.random() * 8; f.userData.speed = 0.5 + Math.random();
        scene.add(f); fish.push(f);
      }
      var bubbles = risingField(60, 16, 9, 6, 0.08, 0xa5f3fc);
      scene.add(bubbles.points);
      return { update: function (t, dt) {
        fish.forEach(function (f) {
          f.position.x += f.userData.speed * dt;
          f.position.y += Math.sin(t * 2 + f.userData.seed) * 0.004;
          if (f.position.x > 8) f.position.x = -8;
        });
        bubbles.update(dt, 0.5, 0.15);
      } };
    },
    waterfall: function (scene) {
      var cliff = box(3.2, 8, 1.4, 0x334155); cliff.position.set(-4.5, 0.5, -5); scene.add(cliff);
      var cliff2 = box(2.4, 6, 1.4, 0x475569); cliff2.position.set(4.8, -0.6, -5.2); scene.add(cliff2);
      var fall = fallingField(160, 1.6, 9, 0.8, 0.09, 0xe0f2fe);
      fall.points.position.set(-4.5, 0.5, -4.2); scene.add(fall.points);
      var mist = risingField(40, 4, 3, 1.5, 0.14, 0xf0f9ff);
      mist.points.position.set(-4.5, -3.4, -4); mist.points.material.opacity = 0.4; scene.add(mist.points);
      return { update: function (t, dt) { fall.update(dt, 4.5, 0); mist.update(dt, 0.4, 0.3); } };
    },
    rainfall: function (scene) {
      scene.fog = new T.Fog(0x1e293b, 4, 16);
      var rain = fallingField(300, 20, 12, 8, 0.05, 0x93c5fd);
      scene.add(rain.points);
      var cloud1 = sph(1, 0x475569, 2.2, 0.8, 1); cloud1.position.set(-3, 4.4, -5); scene.add(cloud1);
      var cloud2 = sph(0.9, 0x64748b, 2, 0.75, 1); cloud2.position.set(3.6, 4.8, -6); scene.add(cloud2);
      return { update: function (t, dt) {
        rain.update(dt, 7, 0);
        cloud1.position.x = -3 + Math.sin(t * 0.2) * 0.6;
        cloud2.position.x = 3.6 + Math.cos(t * 0.17) * 0.6;
      } };
    },
    zombie: function (scene) {
      scene.fog = new T.Fog(0x1a2e05, 3, 15);
      var moon = sph(0.9, 0xfef9c3); moon.position.set(4.4, 3.8, -8); scene.add(moon);
      var ground = new T.Mesh(new T.PlaneGeometry(30, 20), mat(0x1a2e05));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -2.5; scene.add(ground);
      var zombies = [];
      for (var i = 0; i < 3; i++) {
        var z = chibi(0x65a30d, 0x84cc16);
        z.scale.setScalar(0.65);
        z.position.set(-6 + i * 2.5, -1.7, -3.5 - i);
        z.rotation.z = 0.06; z.userData.seed = i * 2.1;
        scene.add(z); zombies.push(z);
        var arm = box(0.1, 0.1, 0.5, 0x65a30d); arm.position.set(0.4, -0.2, 0.45); z.add(arm);
        var arm2 = box(0.1, 0.1, 0.5, 0x65a30d); arm2.position.set(-0.4, -0.25, 0.45); z.add(arm2);
      }
      [-2.2, 0.4, 2.8].forEach(function (x, i) {
        var stone = box(0.6, 0.8, 0.15, 0x94a3b8); stone.position.set(x, -2.1, -4.5 - i * 0.4); scene.add(stone);
        var stoneTop = cyl(0.3, 0.3, 0.15, 0x94a3b8, 12); stoneTop.rotation.x = Math.PI / 2; stoneTop.position.set(x, -1.7, -4.5 - i * 0.4); scene.add(stoneTop);
      });
      return { update: function (t, dt) {
        zombies.forEach(function (z) {
          z.position.x += dt * 0.22;
          z.position.y = -1.7 + Math.abs(Math.sin(t * 2 + z.userData.seed)) * 0.05;
          z.rotation.z = 0.06 + Math.sin(t * 1.5 + z.userData.seed) * 0.05;
          if (z.position.x > 8) z.position.x = -8;
        });
      } };
    },
    football: function (scene) {
      var field = new T.Mesh(new T.PlaneGeometry(30, 20), mat(0x166534));
      field.rotation.x = -Math.PI / 2; field.position.y = -2.5; scene.add(field);
      for (var i = 0; i < 6; i++) {
        var line = box(24, 0.02, 0.18, 0xf8fafc);
        line.position.set(0, -2.48, -8 + i * 2.4); scene.add(line);
      }
      var goal = new T.Group();
      var post1 = cyl(0.06, 0.06, 2.6, 0xfacc15, 8); post1.position.set(-1, -0.3, 0); goal.add(post1);
      var post2 = cyl(0.06, 0.06, 2.6, 0xfacc15, 8); post2.position.set(1, -0.3, 0); goal.add(post2);
      var bar = cyl(0.06, 0.06, 2.1, 0xfacc15, 8); bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.2, 0); goal.add(bar);
      var stem = cyl(0.07, 0.07, 1.6, 0xfacc15, 8); stem.position.set(0, -1.8, 0); goal.add(stem);
      goal.position.set(4.5, 0.6, -6); scene.add(goal);
      var b = sph(0.32, 0x92400e, 1.5, 1, 1);
      var lace = box(0.3, 0.03, 0.03, 0xf8fafc); lace.position.y = 0.3; b.add(lace);
      scene.add(b);
      return { update: function (t) {
        var p = (t * 0.35) % 1;
        b.position.set(-6 + p * 12, -1.6 + Math.sin(p * Math.PI) * 3.4, -4);
        b.rotation.z = -t * 3;
      } };
    },
    soccer: function (scene) {
      var field = new T.Mesh(new T.PlaneGeometry(30, 20), mat(0x15803d));
      field.rotation.x = -Math.PI / 2; field.position.y = -2.5; scene.add(field);
      for (var i = 0; i < 5; i++) {
        var stripe = new T.Mesh(new T.PlaneGeometry(30, 2), mat(0x166534));
        stripe.rotation.x = -Math.PI / 2; stripe.position.set(0, -2.49, -8 + i * 4); scene.add(stripe);
      }
      var circle = torus(1.6, 0.03, 0xf8fafc); circle.rotation.x = -Math.PI / 2; circle.position.y = -2.47; scene.add(circle);
      var balls = [];
      for (var j = 0; j < 3; j++) {
        var b = ball(0xf8fafc, true);
        b.userData.seed = j * 1.4;
        scene.add(b); balls.push(b);
      }
      return { update: function (t) {
        balls.forEach(function (b, i) {
          var p = ((t * 0.3 + b.userData.seed) % 1.4) / 1.4;
          b.position.set(-7 + p * 14, -2.15 + Math.abs(Math.sin(p * Math.PI * 3)) * (1.6 - p), -3 - i * 1.2);
          b.rotation.z = -t * 2 - i;
        });
      } };
    },
  };

  function mountEnvironment(container, sceneId, opts) {
    if (!HAS_WEBGL || !container) return null;
    opts = opts || {};
    if (!SCENES[sceneId]) sceneId = "normal";

    var renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(clamp(window.devicePixelRatio || 1, 1, 1.5));
    var st = renderer.domElement.style;
    st.position = "absolute"; st.inset = "0"; st.width = "100%"; st.height = "100%";
    st.pointerEvents = "none"; st.display = "block";
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.insertBefore(renderer.domElement, container.firstChild);

    var scene = new T.Scene();
    var camera = new T.PerspectiveCamera(50, 1, 0.1, 60);
    camera.position.set(0, 0.4, 8);
    scene.add(new T.HemisphereLight(0xcfe8ff, 0x1e1b4b, 0.9));
    var sun = new T.DirectionalLight(0xffffff, 0.7); sun.position.set(3, 6, 4); scene.add(sun);

    var impl = SCENES[sceneId] ? SCENES[sceneId](scene) : SCENES.normal(scene);

    function resize() {
      var w = container.clientWidth || 600, h = container.clientHeight || 340;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    resize();
    var ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(container); else window.addEventListener("resize", resize);

    var disposed = false, raf = 0, last = performance.now(), t = 0;
    function frame(now) {
      if (disposed) return;
      raf = requestAnimationFrame(frame);
      var dt = Math.min((now - last) / 1000, 0.05); last = now;
      t += dt;
      impl.update(t, dt);
      renderer.render(scene, camera);
    }
    if (REDUCED) { impl.update(0.01, 0.01); renderer.render(scene, camera); }
    else raf = requestAnimationFrame(frame);

    function vis() {
      if (REDUCED) return;
      if (document.hidden) cancelAnimationFrame(raf);
      else { last = performance.now(); raf = requestAnimationFrame(frame); }
    }
    document.addEventListener("visibilitychange", vis);

    return {
      dispose: function () {
        disposed = true;
        cancelAnimationFrame(raf);
        document.removeEventListener("visibilitychange", vis);
        if (ro) ro.disconnect(); else window.removeEventListener("resize", resize);
        disposeDeep(scene);
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      },
    };
  }

  /* ============================ export ================================== */
  return {
    hasWebGL: HAS_WEBGL,
    reducedMotion: REDUCED,
    mountAvatar: mountAvatar,
    mountEnvironment: mountEnvironment,
    environments: Object.keys(SCENES),
    /* internals, exposed for tests / advanced embedding */
    _buildCharacter: buildCharacter,
    _scenes: SCENES,
  };
})();
