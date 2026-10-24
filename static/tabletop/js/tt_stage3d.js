/* ============================================================================
   tt_stage3d.js — the featured table on the projector, in 3D.
   ----------------------------------------------------------------------------
   Requires three.js r128 + GLTFLoader, tt_common.js, tt_geo.js and (optional)
   kk_hero.js for the players' characters standing around the board.

     var s = TTStage3D.create(container, { pieces: "<url of kk_pieces.glb>" });
     s.show(match)                 jump straight to a match's position
     s.play(match, events)         animate the events, then settle on `match`
     s.react(playerId, emoji)      a player's emoji floats over their hero
     s.celebrate(match)            confetti + winner dance

   Every piece is alive: it breathes, blinks, and its eyes follow the action.
   A capture is a little duel: the attacker leaps in, a glowing sword swings
   with a light trail, and the victim is split along the blade's plane
   (real clipping planes), the halves toppling apart in a burst of sparks.
   ========================================================================== */
window.TTStage3D = (function () {
  "use strict";
  var T = window.THREE;

  function create(container, opts) {
    opts = opts || {};
    if (!T || !(function () { try { return !!document.createElement("canvas").getContext("webgl"); } catch (e) { return false; } })()) {
      container.innerHTML = '<div class="tt3d-nogl">3D needs WebGL — showing the flat board instead.</div>';
      return null;
    }

    /* ───────────────────────── renderer & scene ───────────────────────── */
    var renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    // r128 has no colour management: keep linear output so the hand-picked
    // palette shows as authored (sRGB output washed every colour out).
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);

    var scene = new T.Scene();
    scene.background = new T.Color("#0b1020");
    scene.fog = new T.Fog("#0b1020", 18, 42);
    var camera = new T.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    var camBase = new T.Vector3(0, 10.5, 10.5), camLook = new T.Vector3(0, 0, 0.6);

    scene.add(new T.HemisphereLight(0xcfe3ff, 0x1a1530, 0.5));
    var key = new T.DirectionalLight(0xfff1dc, 0.8);
    key.position.set(6, 12, 7); key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    var sc = key.shadow.camera; sc.left = -11; sc.right = 11; sc.top = 11; sc.bottom = -11; sc.near = 1; sc.far = 40;
    key.shadow.bias = -0.0005;
    scene.add(key);
    var rimL = new T.PointLight(0x7c3aed, 0.9, 30); rimL.position.set(-9, 5, -6); scene.add(rimL);
    var rimR = new T.PointLight(0x06b6d4, 0.8, 30); rimR.position.set(9, 4, -4); scene.add(rimR);
    var flash = new T.PointLight(0xffffff, 0, 8); scene.add(flash);

    // arena floor: glowing rings
    var floor = new T.Mesh(new T.CircleGeometry(30, 64), new T.MeshStandardMaterial({ color: "#0d1226", roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.62; floor.receiveShadow = true; scene.add(floor);
    for (var ri = 0; ri < 3; ri++) {
      var halo = new T.Mesh(new T.RingGeometry(8 + ri * 2.4, 8.06 + ri * 2.4, 96),
        new T.MeshBasicMaterial({ color: ri % 2 ? "#22d3ee" : "#a855f7", transparent: true, opacity: 0.25 }));
      halo.rotation.x = -Math.PI / 2; halo.position.y = -0.6; scene.add(halo);
    }
    // floating dust
    var dustGeo = new T.BufferGeometry(), dustN = 260, dustPos = new Float32Array(dustN * 3);
    for (var di = 0; di < dustN; di++) {
      dustPos[di * 3] = (Math.random() - 0.5) * 40; dustPos[di * 3 + 1] = Math.random() * 12; dustPos[di * 3 + 2] = (Math.random() - 0.5) * 30;
    }
    dustGeo.setAttribute("position", new T.BufferAttribute(dustPos, 3));
    var dust = new T.Points(dustGeo, new T.PointsMaterial({ color: "#93c5fd", size: 0.06, transparent: true, opacity: 0.55 }));
    scene.add(dust);

    var world = new T.Group(); scene.add(world);      // board + pieces + heroes
    var boardG = new T.Group(), piecesG = new T.Group(), heroesG = new T.Group(), fxG = new T.Group();
    world.add(boardG); world.add(piecesG); world.add(heroesG); scene.add(fxG);

    /* ───────────────────────── tiny tween engine ───────────────────────── */
    var tweens = [], clock = new T.Clock(), elapsed = 0, shake = 0;
    function anim(ms, fn) {
      return new Promise(function (res) { tweens.push({ t: 0, d: Math.max(1, ms) / 1000, fn: fn, res: res }); });
    }
    function delay(ms) { return anim(ms, function () {}); }
    function ease(k) { return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; }
    function easeOut(k) { return 1 - Math.pow(1 - k, 3); }

    /* ───────────────────────── assets ───────────────────────── */
    var lib = null;
    function loadGlb(url) {
      return new Promise(function (res) {
        if (!T.GLTFLoader || !url) { res({}); return; }
        new T.GLTFLoader().load(url, function (g) {
          var out = {}; g.scene.children.slice().forEach(function (o) { out[o.name] = o; }); res(out);
        }, undefined, function () { res({}); });
      });
    }
    var libReady = Promise.all([loadGlb(opts.pieces), loadGlb(opts.world)]).then(function (all) {
      lib = {};
      all.forEach(function (part) { for (var k in part) lib[k] = part[k]; });
      return lib;
    });

    var M = {};
    function smat(name, col, o) {
      if (M[name]) return M[name];
      o = o || {};
      var m = new T.MeshStandardMaterial({ color: col, roughness: o.r != null ? o.r : 0.4, metalness: o.m || 0.05 });
      if (o.e) { m.emissive = new T.Color(o.e); m.emissiveIntensity = o.ei || 0.6; }
      return (M[name] = m);
    }
    function teamMats(game, side) {
      if (game === "chess") return side === 0
        ? { body: smat("cw", "#f2e8d5", { r: 0.32 }), accent: smat("cwa", "#d9a82e", { r: 0.25, m: 0.8 }) }
        : { body: smat("cb", "#262b38", { r: 0.25, m: 0.25 }), accent: smat("cba", "#5eead4", { r: 0.3, m: 0.4, e: "#0e7490", ei: 0.6 }) };
      if (game === "dam") return side === 0
        ? { body: smat("dw", "#f1e1bd", { r: 0.45 }), accent: smat("dwa", "#b8893b", { m: 0.5 }) }
        : { body: smat("db", "#5b3a27", { r: 0.4 }), accent: smat("dba", "#e2b25a", { m: 0.6 }) };
      var col = TT.LUDO_COLORS[side];
      return { body: smat("l" + side, col, { r: 0.35 }), accent: smat("la", "#ffffff", { r: 0.3 }) };
    }
    var misc = {
      metal: smat("metal", "#d7dee8", { r: 0.2, m: 0.9 }), gold: smat("gold", "#f5c542", { r: 0.25, m: 0.9 }),
      wood: smat("wood", "#7a4b25", { r: 0.7 }), white: smat("white", "#fafafa", { r: 0.3 }),
      pip: smat("pip", "#111827", { r: 0.4 }), glow: smat("glow", "#67e8f9", { e: "#22d3ee", ei: 1.6 }),
      dark: smat("dark", "#111318"),
    };
    function cloneNamed(name, mats) {
      var src = lib && lib[name];
      if (!src) return null;
      var c = src.clone(true);
      c.position.set(0, 0, 0);
      c.traverse(function (o) {
        if (o.isMesh) {
          var n = (o.material && o.material.name || "").replace(/\.\d+$/, "");
          o.material = (mats && mats[n]) || misc[n] || (mats && mats.body) || misc.white;
          o.castShadow = true; o.receiveShadow = true;
        }
      });
      return c;
    }

    /* ───────────────────────── eyes (every piece has them) ───────────────────────── */
    var eyeWhite = new T.MeshStandardMaterial({ color: "#ffffff", roughness: 0.15 });
    var eyeDark = new T.MeshBasicMaterial({ color: "#0b0b10" });
    var eyeGeo = new T.SphereGeometry(0.05, 14, 10), pupGeo = new T.SphereGeometry(0.028, 10, 8);
    function addEyes(piece, y, z, spread, sideways) {
      var g = new T.Group();
      var eyes = [];
      [-1, 1].forEach(function (sx) {
        var e = new T.Group();
        e.name = "tt-eye";
        var w = new T.Mesh(eyeGeo, eyeWhite);
        var p = new T.Mesh(pupGeo, eyeDark);
        p.position.z = 0.032;
        e.add(w); e.add(p);
        if (sideways) { e.position.set(sx * spread, y, z); e.rotation.y = sx * Math.PI / 2; }
        else e.position.set(sx * spread, y, z);
        e.userData.pupil = p;
        g.add(e); eyes.push(e);
      });
      piece.add(g);
      piece.userData.eyes = eyes;
      piece.userData.blink = 1 + Math.random() * 4;
    }
    var EYE = { pawn: [0.6, 0.15, 0.07], rook: [0.66, 0.24, 0.09], bishop: [0.68, 0.15, 0.065],
                queen: [0.8, 0.15, 0.07], king: [0.86, 0.17, 0.075], dam: [0.16, 0.26, 0.11], ludo: [0.58, 0.14, 0.065] };
    var CHESS_KIND = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

    function fallbackPiece(kind, mats) {
      var g = new T.Group();
      var h = { pawn: 0.6, rook: 0.75, knight: 0.85, bishop: 0.9, queen: 1, king: 1.1, dam: 0.14, ludo: 0.6 }[kind] || 0.6;
      var r = kind === "dam" ? 0.4 : 0.3;
      var body = new T.Mesh(new T.CylinderGeometry(r * 0.6, r, h, 24), mats.body);
      body.position.y = h / 2; body.castShadow = true; g.add(body);
      if (kind !== "dam") {
        var top = new T.Mesh(new T.SphereGeometry(r * 0.6, 18, 12), mats.accent);
        top.position.y = h; top.castShadow = true; g.add(top);
      }
      return g;
    }

    function makePiece(kind, mats, facing) {
      var name = { pawn: "chess_pawn", knight: "chess_knight", bishop: "chess_bishop", rook: "chess_rook",
                   queen: "chess_queen", king: "chess_king", dam: "dam_man", ludo: "ludo_pawn" }[kind];
      var holder = new T.Group();
      var body = new T.Group();           // bob / squash happens here
      holder.add(body);
      var m = cloneNamed(name, mats) || fallbackPiece(kind, mats);
      body.add(m);
      if (kind === "knight") {
        m.rotation.y = facing < 0 ? Math.PI : 0;
        addEyes(body, 0.74, facing < 0 ? -0.06 : 0.06, 0.12, true);
      } else {
        var e = EYE[kind];
        addEyes(body, e[0], e[1], e[2], false);
      }
      holder.userData = { kind: kind, body: body, phase: Math.random() * 6.28, eyes: body.userData.eyes, blink: body.userData.blink };
      return holder;
    }
    function crownFor(holder) {
      var c = cloneNamed("dam_crown", {});
      if (!c) { c = new T.Mesh(new T.TorusGeometry(0.22, 0.05, 8, 20), misc.gold); c.rotation.x = Math.PI / 2; }
      c.position.y = 0.14;
      holder.userData.body.add(c);
      holder.userData.crown = c;
      return c;
    }

    /* ───────────────────────── board builders ───────────────────────── */
    function clearGroup(g) {
      while (g.children.length) {
        var c = g.children.pop();
        c.traverse(function (o) { if (o.geometry && !o.geometry.__shared) o.geometry.dispose(); });
      }
    }
    function plinth(w, d, col) {
      var g = new T.Group();
      var base = new T.Mesh(new T.BoxGeometry(w + 0.9, 0.5, d + 0.9), new T.MeshStandardMaterial({ color: col || "#3b2416", roughness: 0.55 }));
      base.position.y = -0.3; base.receiveShadow = true; base.castShadow = true; g.add(base);
      var trim = new T.Mesh(new T.BoxGeometry(w + 1.0, 0.08, d + 1.0), misc.gold);
      trim.position.y = -0.52; g.add(trim);
      return g;
    }
    function checker(n, light, dark) {
      var g = new T.Group();
      var geo = new T.BoxGeometry(1, 0.1, 1);
      var ml = new T.MeshStandardMaterial({ color: light, roughness: 0.5 }), md = new T.MeshStandardMaterial({ color: dark, roughness: 0.45 });
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
        var tile = new T.Mesh(geo, (r + c) % 2 === 0 ? md : ml);
        tile.position.set(c - (n - 1) / 2, -0.05, (n - 1) / 2 - r);
        tile.receiveShadow = true;
        g.add(tile);
      }
      return g;
    }
    function canvasTex(w, h, draw) {
      var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      draw(cv.getContext("2d"), w, h);
      var t = new T.CanvasTexture(cv); t.anisotropy = 8;
      return t;
    }
    function texturedBoard(size, tex) {
      var g = new T.Group();
      var top = new T.Mesh(new T.BoxGeometry(size, 0.1, size), [
        misc.wood, misc.wood, new T.MeshStandardMaterial({ map: tex, roughness: 0.6 }), misc.wood, misc.wood, misc.wood]);
      top.position.y = -0.05; top.receiveShadow = true; g.add(top);
      return g;
    }
    function ludoTexture() {
      return canvasTex(1500, 1500, function (x) {
        var S = 100;
        x.fillStyle = "#fdf8ee"; x.fillRect(0, 0, 1500, 1500);
        [[0, 0], [0, 9], [9, 9], [9, 0]].forEach(function (y, col) {
          x.fillStyle = TT.LUDO_COLORS[col]; x.fillRect(y[1] * S + 8, y[0] * S + 8, 6 * S - 16, 6 * S - 16);
          x.fillStyle = "#fff"; x.fillRect(y[1] * S + 90, y[0] * S + 90, 4 * S - 80, 4 * S - 80);
        });
        TTGeo.TRACK.forEach(function (rc, gi) {
          var fill = "#ffffff";
          [0, 13, 26, 39].forEach(function (s, col) { if (gi === s) fill = TT.LUDO_COLORS[col]; });
          x.fillStyle = fill; x.strokeStyle = "#cbbf9f"; x.lineWidth = 4;
          x.fillRect(rc[1] * S + 4, rc[0] * S + 4, S - 8, S - 8); x.strokeRect(rc[1] * S + 4, rc[0] * S + 4, S - 8, S - 8);
          if (TTGeo.SAFE.indexOf(gi) >= 0 && fill === "#ffffff") {
            x.fillStyle = "#f5b301"; x.font = "70px serif"; x.textAlign = "center"; x.fillText("★", rc[1] * S + 50, rc[0] * S + 75);
          }
        });
        for (var col = 0; col < 4; col++) for (var k = 0; k < 5; k++) {
          var rc2 = TTGeo.ludoCell(col, 51 + k);
          x.fillStyle = TT.LUDO_COLORS[col]; x.fillRect(rc2[1] * S + 4, rc2[0] * S + 4, S - 8, S - 8);
        }
        [[6, 6, 6, 9, 1], [6, 9, 9, 9, 2], [9, 9, 9, 6, 3], [9, 6, 6, 6, 0]].forEach(function (e) {
          x.fillStyle = TT.LUDO_COLORS[e[4]]; x.beginPath();
          x.moveTo(e[1] * S, e[0] * S); x.lineTo(e[3] * S, e[2] * S); x.lineTo(750, 750); x.fill();
        });
      });
    }
    var PREM = { TW: ["#dc2626", "TRIPLE\nWORD"], DW: ["#f472b6", "DOUBLE\nWORD"], TL: ["#2563eb", "TRIPLE\nLETTER"], DL: ["#7dd3fc", "DOUBLE\nLETTER"] };
    function wordsTexture(prem) {
      return canvasTex(1500, 1500, function (x) {
        x.fillStyle = "#0c3b28"; x.fillRect(0, 0, 1500, 1500);
        for (var i = 0; i < 225; i++) {
          var r = Math.floor(i / 15), c = i % 15, p = prem[i];
          x.fillStyle = p ? PREM[p][0] : "#17734a";
          x.fillRect(c * 100 + 4, r * 100 + 4, 92, 92);
          if (p) {
            x.fillStyle = "#fff"; x.textAlign = "center"; x.font = "bold 17px sans-serif";
            if (i === 112) { x.font = "60px serif"; x.fillText("★", c * 100 + 50, r * 100 + 70); continue; }
            PREM[p][1].split("\n").forEach(function (ln, k) { x.fillText(ln, c * 100 + 50, r * 100 + 44 + k * 20); });
          }
        }
      });
    }

    /* ───────────────────────── coordinates ───────────────────────── */
    var cur = null, pieces = {};
    var SCALE15 = 0.6;
    function cellPos(game, keyv, st) {
      if (game === "chess") { var q = TTGeo.chessSq(keyv); return new T.Vector3(q.c - 3.5, 0, 3.5 - q.r); }
      if (game === "dam") { var n = st.size, r = Math.floor(keyv / n), c = keyv % n; return new T.Vector3(c - (n - 1) / 2, 0, (n - 1) / 2 - r); }
      if (game === "ludo") { return new T.Vector3((keyv[1] - 7) * SCALE15, 0, (keyv[0] - 7) * SCALE15); }
      var rr = Math.floor(keyv / 15), cc = keyv % 15; return new T.Vector3((cc - 7) * SCALE15, 0, (rr - 7) * SCALE15);
    }

    /* ───────────────────────── heroes around the table ───────────────────────── */
    var heroes = [];   // [{seat, pid, obj, label}]
    function label(text, color) {
      var tex = canvasTex(512, 128, function (x) {
        x.fillStyle = "rgba(2,6,23,.72)";
        var r = 40; x.beginPath(); x.moveTo(r, 10); x.arcTo(502, 10, 502, 118, r); x.arcTo(502, 118, 10, 118, r);
        x.arcTo(10, 118, 10, 10, r); x.arcTo(10, 10, 502, 10, r); x.fill();
        x.strokeStyle = color || "#facc15"; x.lineWidth = 6; x.stroke();
        x.fillStyle = "#fff"; x.font = "bold 54px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
        x.fillText(text.length > 14 ? text.slice(0, 13) + "…" : text, 256, 66);
      });
      var s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
      s.scale.set(2.4, 0.6, 1);
      return s;
    }
    function seatSpots(game, n) {
      if (PLUGINS[game] && PLUGINS[game].spots) return PLUGINS[game].spots(n);
      if (game === "ludo") return [[-6.3, -3.8], [6.3, -3.8], [6.1, 2.6], [-6.1, 2.6]];   // by colour corner
      if (game === "words") {
        return [[-6.1, 2.3], [6.1, -3.0], [6.1, 2.3], [-6.1, -3.0]].slice(0, n);
      }
      var half = game === "dam" ? 6.3 : 5.3;
      return [[-half, 2.4], [half, -2.4]];
    }
    function seatColor(game, seat, st) {
      if (PLUGINS[game] && PLUGINS[game].color) return PLUGINS[game].color(seat, st);
      if (game === "ludo") return TT.LUDO_COLORS[st.colours[seat]];
      if (game === "chess") return seat === 0 ? "#f5e9cf" : "#5eead4";
      if (game === "dam") return seat === 0 ? "#f1e1bd" : "#e2b25a";
      return ["#facc15", "#22d3ee", "#f472b6", "#a3e635"][seat];
    }
    function buildHeroes(match) {
      clearGroup(heroesG); heroes = [];
      var spots = seatSpots(match.game, match.seats.length);
      match.seats.forEach(function (s, seat) {
        var spot = (match.game === "ludo" ? spots[match.state.colours[seat]] : spots[seat]) || [0, 6];
        var holder = new T.Group();
        holder.position.set(spot[0], -0.6, spot[1]);
        // face the audience, turned a little toward the board
        holder.lookAt(spot[0] * 0.35, -0.6, 10);
        var hero = null;
        var col = seatColor(match.game, seat, match.state);
        var pad = new T.Mesh(new T.CylinderGeometry(1.0, 1.1, 0.12, 40), new T.MeshStandardMaterial({ color: "#111827", roughness: 0.4, metalness: 0.4 }));
        pad.position.y = 0.04; pad.receiveShadow = true; holder.add(pad);
        var glow = new T.Mesh(new T.RingGeometry(1.0, 1.18, 48), new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, side: T.DoubleSide }));
        glow.rotation.x = -Math.PI / 2; glow.position.y = 0.11; holder.add(glow);
        var heroHolder = new T.Group(); heroHolder.position.y = 0.1; heroHolder.scale.setScalar(1.25);
        holder.add(heroHolder);
        var lab = label(s.name, col); lab.position.set(0, 3.6, 0); holder.add(lab);
        heroesG.add(holder);
        var rec = { seat: seat, pid: s.id, holder: holder, hero: null, glow: glow, label: lab, avatar: s.avatar };
        heroes.push(rec);
        attachHero(rec, s.avatar);
      });
    }
    function attachHero(rec, avatarId) {
      var heroHolder = rec.holder.children[2];
      clearGroup(heroHolder);
      var id = window.KKHero && KKHero.isHero(avatarId) ? avatarId : null;
      if (id) {
        KKHero.ready().then(function () {
          var h = KKHero.build(id);
          h.traverse(function (o) { if (o.isMesh) o.castShadow = true; });
          heroHolder.add(h); rec.hero = h;
        }).catch(function () { emojiStand(rec, avatarId); });
      } else emojiStand(rec, avatarId);
    }
    function emojiStand(rec, avatarId) {
      var a = (window.kkAvatarsById || {})[avatarId] || {};
      var em = a.emoji || (window.KKAvatar && KKAvatar.emojiFor ? KKAvatar.emojiFor(avatarId) : "🙂");
      var tex = canvasTex(256, 256, function (x) {
        x.font = "200px serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(em, 128, 140);
      });
      var s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true }));
      s.scale.set(1.5, 1.5, 1); s.position.y = 1.0;
      rec.holder.children[2].add(s);
      rec.hero = { isSprite: true, obj: s, play: function (m) { rec.spriteMove = m; rec.spriteT = 0; }, update: function () {} };
    }
    function heroFor(seat) { return heroes.filter(function (h) { return h.seat === seat; })[0]; }
    function heroPlay(seat, move) { var h = heroFor(seat); if (h && h.hero && h.hero.play) h.hero.play(move); }

    /* ───────────────────────── build a whole table ───────────────────────── */
    function buildBoard(match) {
      clearGroup(boardG);
      ticks = [];
      var st = match.state;
      if (PLUGINS[match.game]) {
        PLUGINS[match.game].build(ctx, match);
      } else if (match.game === "chess") {
        boardG.add(plinth(8, 8)); boardG.add(checker(8, "#d8c093", "#6e4a2e"));
        addCoords(8);
      } else if (match.game === "dam") {
        boardG.add(plinth(st.size, st.size, "#2a1a10")); boardG.add(checker(st.size, "#d6c49a", "#2f5d3a"));
      } else if (match.game === "ludo") {
        boardG.add(plinth(9, 9, "#c8a46a")); boardG.add(texturedBoard(9, ludoTexture()));
      } else {
        boardG.add(plinth(9, 9, "#3b2416")); boardG.add(texturedBoard(9, wordsTexture(st.premium)));
      }
    }
    function addCoords(n) {
      for (var i = 0; i < n; i++) {
        [["abcdefgh"[i], i - 3.5, 4.35], [String(i + 1), -4.35, 3.5 - i]].forEach(function (d) {
          var tex = canvasTex(64, 64, function (x) { x.fillStyle = "#e2c48f"; x.font = "bold 40px sans-serif"; x.textAlign = "center"; x.textBaseline = "middle"; x.fillText(d[0], 32, 34); });
          var m = new T.Mesh(new T.PlaneGeometry(0.32, 0.32), new T.MeshBasicMaterial({ map: tex, transparent: true }));
          m.rotation.x = -Math.PI / 2; m.position.set(d[1], -0.04, d[2]);
          boardG.add(m);
        });
      }
    }

    function syncPieces(match) {
      clearGroup(piecesG); pieces = {};
      var st = match.state;
      if (PLUGINS[match.game]) {
        PLUGINS[match.game].sync(ctx, match);
        heroes.forEach(function (h) {
          var on = st.turn === h.seat && !st.over;
          h.glow.material.opacity = on ? 0.95 : 0.25;
          h.glow.scale.setScalar(on ? 1.08 : 1);
        });
        return;
      }
      if (match.game === "chess") {
        for (var i = 0; i < 64; i++) {
          var p = st.board.charAt(i);
          if (p === ".") continue;
          var white = p === p.toUpperCase();
          var pc = makePiece(CHESS_KIND[p.toLowerCase()], teamMats("chess", white ? 0 : 1), white ? 1 : -1);
          var nm = TTGeo.chessName(Math.floor(i / 8), i % 8);
          pc.position.copy(cellPos("chess", nm, st));
          piecesG.add(pc); pieces[nm] = pc;
        }
      } else if (match.game === "dam") {
        for (var j = 0; j < st.board.length; j++) {
          var d = st.board.charAt(j);
          if (d === ".") continue;
          var pc2 = makePiece("dam", teamMats("dam", d.toLowerCase() === "w" ? 0 : 1), 1);
          pc2.scale.setScalar(st.size === 10 ? 0.95 : 1.1);
          if (d === d.toUpperCase()) crownFor(pc2);
          pc2.position.copy(cellPos("dam", j, st));
          piecesG.add(pc2); pieces[j] = pc2;
        }
      } else if (match.game === "ludo") {
        TTGeo.ludoLayout(st.tokens, st.colours).forEach(function (t) {
          var pc3 = makePiece("ludo", teamMats("ludo", t.colour), 1);
          pc3.scale.setScalar(t.rel === 56 ? 0.5 : 0.85);
          pc3.position.copy(cellPos("ludo", [t.r, t.c], st));
          if (st.phase === "move" && st.turn === t.seat && st.movable.indexOf(t.token) >= 0) pc3.userData.ready = true;
          piecesG.add(pc3); pieces[t.seat + ":" + t.token] = pc3;
        });
        if (st.dice) showDie(st.dice, false);
      } else {
        st.board.forEach(function (l, i) {
          if (!l) return;
          var tl = makeTile(l, st.values);
          tl.position.copy(cellPos("words", i, st));
          piecesG.add(tl); pieces[i] = tl;
        });
      }
      heroes.forEach(function (h) {
        var on = st.turn === h.seat && !st.over;
        h.glow.material.opacity = on ? 0.95 : 0.25;
        h.glow.scale.setScalar(on ? 1.08 : 1);
      });
    }

    /* ───────────────────────── scramble tiles ───────────────────────── */
    var tileGeo = new T.BoxGeometry(0.54, 0.14, 0.54); tileGeo.__shared = true;
    var tileSide = new T.MeshStandardMaterial({ color: "#e6cf9f", roughness: 0.5 });
    var tileTexCache = {};
    function makeTile(l, values) {
      var key = l;
      if (!tileTexCache[key]) {
        var blank = l === l.toLowerCase();
        tileTexCache[key] = new T.MeshStandardMaterial({ roughness: 0.45, map: canvasTex(128, 128, function (x) {
          x.fillStyle = "#f6e7c3"; x.fillRect(0, 0, 128, 128);
          x.fillStyle = blank ? "#7c3aed" : "#1f2937"; x.font = "bold 84px Georgia, serif"; x.textAlign = "center"; x.textBaseline = "middle";
          x.fillText(l.toUpperCase(), 58, 66);
          if (!blank) { x.font = "bold 26px sans-serif"; x.fillText(String(values[l.toUpperCase()] || ""), 104, 106); }
        }) });
      }
      var m = new T.Mesh(tileGeo, [tileSide, tileSide, tileTexCache[key], tileSide, tileSide, tileSide]);
      m.castShadow = true; m.position.y = 0.07;
      var g = new T.Group(); g.add(m);
      g.userData = { kind: "tile", body: m, phase: Math.random() * 6.28 };
      return g;
    }

    /* ───────────────────────── dice ───────────────────────── */
    var die = null;
    var FACE_Q = {
      1: new T.Euler(0, 0, 0), 6: new T.Euler(Math.PI, 0, 0), 3: new T.Euler(0, 0, Math.PI / 2),
      4: new T.Euler(0, 0, -Math.PI / 2), 2: new T.Euler(Math.PI / 2, 0, 0), 5: new T.Euler(-Math.PI / 2, 0, 0),
    };
    function ensureDie() {
      if (die) return die;
      die = cloneNamed("die", { white: misc.white, pip: misc.pip });
      if (!die) die = new T.Mesh(new T.BoxGeometry(0.5, 0.5, 0.5), misc.white);
      die.scale.setScalar(1.6);
      scene.add(die);
      return die;
    }
    function dieQuat(v, yaw) {
      var q = new T.Quaternion().setFromEuler(FACE_Q[v]);
      return new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw).multiply(q);
    }
    function showDie(v, animateRoll) {
      var d = ensureDie();
      d.visible = true;
      var end = new T.Vector3(0, 0.4, 0), yaw = Math.random() * 6.28;
      var qEnd = dieQuat(v, yaw);
      if (!animateRoll) { d.position.copy(end); d.quaternion.copy(qEnd); return Promise.resolve(); }
      TT.sfx("dice");
      var start = new T.Vector3(-3 + Math.random() * 6, 4.5, 3.5);
      var axis = new T.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
      return anim(1100, function (k) {
        var e = easeOut(k);
        d.position.lerpVectors(start, end, e);
        d.position.y = end.y + Math.abs(Math.sin(k * Math.PI * 2.5)) * (1 - k) * 3.2;
        var spin = new T.Quaternion().setFromAxisAngle(axis, (1 - e) * 14);
        d.quaternion.copy(spin.multiply(qEnd));
      }).then(function () { TT.sfx("land"); ring(end, "#ffffff"); });
    }

    /* ───────────────────────── FX: moves ───────────────────────── */
    function hop(obj, to, ms, height) {
      var from = obj.position.clone();
      TT.sfx("move");
      return anim(ms, function (k) {
        var e = ease(k);
        obj.position.lerpVectors(from, to, e);
        obj.position.y = from.y + Math.sin(k * Math.PI) * height;
        var b = obj.userData.body;
        if (b) {
          var st = k < 0.15 ? 1 - k * 2 : k > 0.85 ? 1 - (1 - k) * 2 : 1.12;   // squash & stretch
          b.scale.set(1 / Math.sqrt(st), st, 1 / Math.sqrt(st));
        }
      }).then(function () {
        if (obj.userData.body) obj.userData.body.scale.set(1, 1, 1);
        TT.sfx("land");
        ring(to, "#e2e8f0", 0.5);
      });
    }
    function ring(at, color, size) {
      var m = new T.Mesh(new T.RingGeometry(0.15, 0.24, 40), new T.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.9, side: T.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(at.x, 0.03, at.z);
      world.localToWorld(m.position);
      fxG.add(m);
      var s = size || 1;
      anim(500, function (k) { m.scale.setScalar(1 + k * 4 * s); m.material.opacity = 0.9 * (1 - k); })
        .then(function () { fxG.remove(m); m.geometry.dispose(); });
    }

    /* ───────────────────────── FX: the sword cut ───────────────────────── */
    function sparks(at, color, n) {
      var geo = new T.BufferGeometry(), N = n || 70, pos = new Float32Array(N * 3), vel = [];
      for (var i = 0; i < N; i++) {
        pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
        vel.push(new T.Vector3((Math.random() - 0.5) * 7, Math.random() * 6 + 1, (Math.random() - 0.5) * 7));
      }
      geo.setAttribute("position", new T.BufferAttribute(pos, 3));
      var pts = new T.Points(geo, new T.PointsMaterial({ color: color || "#fde68a", size: 0.12, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
      fxG.add(pts);
      var last = 0;
      return anim(900, function (k) {
        var dt = (k - last) * 0.9; last = k;
        for (var i = 0; i < N; i++) {
          vel[i].y -= 14 * dt;
          pos[i * 3] += vel[i].x * dt; pos[i * 3 + 1] += vel[i].y * dt; pos[i * 3 + 2] += vel[i].z * dt;
        }
        geo.attributes.position.needsUpdate = true;
        pts.material.opacity = 1 - k;
      }).then(function () { fxG.remove(pts); geo.dispose(); });
    }

    function swordSlash(attacker, victim) {
      // world positions
      var a = new T.Vector3(), v = new T.Vector3();
      attacker.getWorldPosition(a); victim.getWorldPosition(v);
      var dir = v.clone().sub(a); dir.y = 0; dir.normalize();
      var side = new T.Vector3(-dir.z, 0, dir.x);
      var sword = cloneNamed("fx_sword", { metal: misc.metal, glow: misc.glow, gold: misc.gold, wood: misc.wood });
      if (!sword) {
        sword = new T.Mesh(new T.BoxGeometry(0.08, 0.9, 0.02), misc.glow);
        sword.geometry.translate(0, 0.45, 0);
      }
      var pivot = new T.Group();
      pivot.position.copy(v).addScaledVector(dir, -0.75).setY(v.y + 0.9);
      fxG.add(pivot);
      pivot.add(sword);
      sword.scale.setScalar(1.6);
      // pivot's local Z = attack direction; the blade (local +Y) chops around
      // local X, so it sweeps the vertical plane through the victim, tilted a bit
      var tilt = (Math.random() - 0.5) * 0.9;
      pivot.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), dir);
      pivot.rotateZ(tilt);
      // trail ribbon
      var TR = 24, trailPos = new Float32Array(TR * 2 * 3), trailCol = new Float32Array(TR * 2 * 3);
      var tGeo = new T.BufferGeometry();
      tGeo.setAttribute("position", new T.BufferAttribute(trailPos, 3));
      tGeo.setAttribute("color", new T.BufferAttribute(trailCol, 3));
      var idx = [];
      for (var i = 0; i < TR - 1; i++) { var o = i * 2; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
      tGeo.setIndex(idx);
      var trail = new T.Mesh(tGeo, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85,
        blending: T.AdditiveBlending, side: T.DoubleSide, depthWrite: false }));
      trail.frustumCulled = false;
      fxG.add(trail);
      var hist = [];
      var tip = new T.Vector3(), mid = new T.Vector3();
      sword.rotation.x = -0.4;  // raised, leaning back
      sword.visible = true;
      victim.userData.scared = true;
      TT.sfx("slash");
      return anim(260, function (k) {   // wind-up glint
        sword.rotation.x = -0.4 - k * 0.55;
        sword.scale.setScalar(1.6 * Math.min(1, k * 3));
      }).then(function () {
        return anim(230, function (k) {
          var e = ease(k);
          sword.rotation.x = -0.95 + e * 3.3;  // overhead chop forward, through the victim
          sword.localToWorld(tip.set(0, 0.88, 0));
          sword.localToWorld(mid.set(0, 0.25, 0));
          hist.unshift([tip.clone(), mid.clone()]);
          if (hist.length > TR) hist.pop();
          for (var i2 = 0; i2 < TR; i2++) {
            var h = hist[Math.min(i2, hist.length - 1)];
            trailPos.set([h[0].x, h[0].y, h[0].z], i2 * 6);
            trailPos.set([h[1].x, h[1].y, h[1].z], i2 * 6 + 3);
            var f = 1 - i2 / TR;
            trailCol.set([0.5 * f, 0.95 * f, 1.0 * f], i2 * 6);
            trailCol.set([0.1 * f, 0.4 * f, 0.9 * f], i2 * 6 + 3);
          }
          tGeo.attributes.position.needsUpdate = true; tGeo.attributes.color.needsUpdate = true;
        });
      }).then(function () {
        // the cutting plane: contains the attack direction rotated by the tilt, and "up"
        var n = side.clone().applyAxisAngle(dir, tilt).normalize();
        var hit = v.clone().setY(v.y + 0.4);
        flash.position.copy(hit); flash.intensity = 6;
        shake = 0.35;
        sparks(hit, "#fde68a", 80); sparks(hit, "#67e8f9", 40);
        TT.sfx("split");
        var fade = anim(350, function (k) { trail.material.opacity = 0.85 * (1 - k); sword.scale.setScalar(1.6 * (1 - k)); flash.intensity = 6 * (1 - k); })
          .then(function () { fxG.remove(trail); fxG.remove(pivot); tGeo.dispose(); });
        return Promise.all([fade, splitPiece(victim, n)]);
      });
    }

    function cloneBare(obj) {
      var saved = [];
      obj.traverse(function (o) { saved.push([o, o.userData]); o.userData = {}; });
      var c = obj.clone(true);
      saved.forEach(function (p) { p[0].userData = p[1]; });
      return c;
    }

    function splitPiece(victim, n) {
      var center = new T.Vector3(); victim.getWorldPosition(center);
      victim.updateMatrixWorld(true);
      var halves = [1, -1].map(function (sgn) {
        var plane = new T.Plane(n.clone().multiplyScalar(sgn), 0);
        // clone() would JSON-copy userData (which holds Object3D refs): skip it
        var h = cloneBare(victim);
        h.traverse(function (o) {
          if (o.isMesh) {
            o.material = o.material.clone();
            o.material.clippingPlanes = [plane];
            o.material.clipShadows = true;
            o.material.side = T.DoubleSide;
            o.material.transparent = true;
          }
        });
        // X-eyes for the fallen
        h.traverse(function (o) { if (o.name === "tt-eye") o.scale.set(1.3, 0.25, 1); });
        h.position.copy(center);
        h.quaternion.copy(victim.getWorldQuaternion(new T.Quaternion()));
        h.scale.copy(victim.getWorldScale(new T.Vector3()));
        fxG.add(h);
        return { obj: h, plane: plane, sgn: sgn };
      });
      victim.visible = false;
      return anim(1300, function (k) {
        var e = easeOut(k);
        halves.forEach(function (H) {
          var off = n.clone().multiplyScalar(H.sgn * (0.05 + e * 0.55));
          H.obj.position.copy(center).add(off);
          H.obj.position.y = center.y - Math.max(0, k - 0.45) * Math.max(0, k - 0.45) * 2.2;
          var axis = new T.Vector3(0, 1, 0).cross(n).normalize();
          H.obj.quaternion.setFromAxisAngle(axis, H.sgn * e * 1.25);
          // keep each clipping plane glued to its half
          var p = center.clone().add(off);
          H.plane.constant = -H.plane.normal.dot(p);
          H.obj.traverse(function (o) { if (o.isMesh) o.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3; });
        });
      }).then(function () {
        halves.forEach(function (H) {
          H.obj.traverse(function (o) { if (o.isMesh) o.material.dispose(); });
          fxG.remove(H.obj);
        });
      });
    }

    /* ───────────────────────── FX: text, confetti ───────────────────────── */
    function floatText(text, at, color, big) {
      var px = big ? 110 : 84, font = "900 " + px + "px system-ui, sans-serif";
      var meas = document.createElement("canvas").getContext("2d");
      meas.font = font;
      var W = Math.ceil(meas.measureText(text).width + 60), H = 160;   // canvas fits the text
      var tex = canvasTex(W, H, function (x) {
        x.font = font; x.textAlign = "center"; x.textBaseline = "middle";
        x.lineWidth = 12; x.strokeStyle = "rgba(0,0,0,.65)"; x.strokeText(text, W / 2, 84);
        x.fillStyle = color || "#facc15"; x.fillText(text, W / 2, 84);
      });
      var s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      s.renderOrder = 10;
      var hgt = big ? 1.9 : 1.1, aspect = W / H;
      s.scale.set(hgt * aspect, hgt, 1);
      s.position.copy(at);
      fxG.add(s);
      var y0 = at.y;
      return anim(1600, function (k) {
        s.position.y = y0 + easeOut(k) * 1.6;
        s.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        var sc2 = hgt * (k < 0.15 ? 0.6 + k * 2.7 : 1);
        s.scale.set(sc2 * aspect, sc2, 1);
      }).then(function () { fxG.remove(s); tex.dispose(); });
    }
    function confetti() {
      var N = 400, geo = new T.BufferGeometry(), pos = new Float32Array(N * 3), col = new Float32Array(N * 3), vel = [];
      var palette = ["#facc15", "#f472b6", "#22d3ee", "#a3e635", "#f97316", "#a855f7"].map(function (c) { return new T.Color(c); });
      for (var i = 0; i < N; i++) {
        pos.set([(Math.random() - 0.5) * 16, 9 + Math.random() * 6, (Math.random() - 0.5) * 10], i * 3);
        var c = palette[i % palette.length]; col.set([c.r, c.g, c.b], i * 3);
        vel.push([(Math.random() - 0.5) * 1.5, -1.5 - Math.random() * 2.5, Math.random() * 6.28]);
      }
      geo.setAttribute("position", new T.BufferAttribute(pos, 3));
      geo.setAttribute("color", new T.BufferAttribute(col, 3));
      var pts = new T.Points(geo, new T.PointsMaterial({ size: 0.2, vertexColors: true, transparent: true }));
      fxG.add(pts);
      var last = 0;
      anim(5000, function (k) {
        var dt = (k - last) * 5; last = k;
        for (var i = 0; i < N; i++) {
          pos[i * 3] += (vel[i][0] + Math.sin(elapsed * 3 + vel[i][2]) * 0.8) * dt;
          pos[i * 3 + 1] += vel[i][1] * dt;
        }
        geo.attributes.position.needsUpdate = true;
        pts.material.opacity = k < 0.8 ? 1 : 1 - (k - 0.8) / 0.2;
      }).then(function () { fxG.remove(pts); geo.dispose(); });
    }

    /* ───────────────────────── event players per game ───────────────────────── */
    function seatOfChessPiece(p) { return p === p.toUpperCase() ? 0 : 1; }
    function topOf(obj) { var v = new T.Vector3(); obj.getWorldPosition(v); v.y += 1.4; return v; }

    function playChess(events, st) {
      var chain = Promise.resolve();
      var cap = events.filter(function (e) { return e.type === "capture"; })[0];
      events.forEach(function (e) {
        if (e.type === "move") chain = chain.then(function () {
          var pc = pieces[e.from]; if (!pc) return;
          lookAll(pc);
          var to = cellPos("chess", e.to, st);
          var jump = e.kind === "knight" ? 1.6 : e.kind === "pawn" ? 0.35 : 0.55;
          if (cap) {
            var victim = pieces[cap.victim];
            var vpos = cellPos("chess", cap.victim, st);
            var dir = vpos.clone().sub(pc.position).setY(0).normalize();
            var near = vpos.clone().addScaledVector(dir, -0.72);
            var attackerSeat = seatOfChessPiece(e.piece);
            return hop(pc, near, 420, jump).then(function () {
              heroPlay(attackerSeat, "attack"); heroPlay(1 - attackerSeat, "hurt");
              return victim ? swordSlash(pc, victim) : null;
            }).then(function () {
              floatText(cap.kind.toUpperCase() + " DOWN!", topOf(pc), "#f87171");
              return hop(pc, to, 260, 0.3);
            });
          }
          return hop(pc, to, 480, jump);
        });
        else if (e.type === "castle") chain = chain.then(function () {
          var r = pieces[e.from]; return r ? hop(r, cellPos("chess", e.to, st), 380, 0.9) : null;
        });
        else if (e.type === "promote") chain = chain.then(function () {
          TT.sfx("crown");
          var at = cellPos("chess", e.at, st); world.localToWorld(at); at.y += 1.2;
          sparks(at, "#facc15", 60);
          return floatText("PROMOTED!", at, "#facc15");
        });
        else if (e.type === "check") chain = chain.then(function () {
          TT.sfx("check");
          var at = cellPos("chess", e.at, st); world.localToWorld(at); at.y += 1.6;
          return floatText("CHECK!", at, "#ef4444");
        });
      });
      return chain;
    }
    function playDam(events, prevSt) {
      var chain = Promise.resolve();
      events.forEach(function (e) {
        if (e.type === "move" || e.type === "jump") chain = chain.then(function () {
          var pc = pieces[e.path[0]]; if (!pc) return;
          lookAll(pc);
          var seat = e.piece.toLowerCase() === "w" ? 0 : 1;
          var c2 = Promise.resolve();
          e.path.slice(1).forEach(function (sq, k) {
            if (e.type === "jump") {
              c2 = c2.then(function () {
                var victim = pieces[e.victims[k]];
                var vpos = cellPos("dam", e.victims[k], prevSt);
                var dir = vpos.clone().sub(pc.position).setY(0).normalize();
                return hop(pc, vpos.clone().addScaledVector(dir, -0.7), 300, 0.5).then(function () {
                  heroPlay(seat, "attack"); heroPlay(1 - seat, "hurt");
                  return victim ? swordSlash(pc, victim) : null;
                }).then(function () {
                  if (k > 0) floatText("x" + (k + 1) + " COMBO!", topOf(pc), "#fb923c");
                  return hop(pc, cellPos("dam", sq, prevSt), 300, 0.9);
                });
              });
            } else {
              c2 = c2.then(function () { return hop(pc, cellPos("dam", sq, prevSt), 420, 0.45); });
            }
          });
          return c2;
        });
        else if (e.type === "promote") chain = chain.then(function () {
          var pc = pieces[e.path ? e.path[0] : e.at];
          TT.sfx("crown");
          var at = cellPos("dam", e.at, prevSt); world.localToWorld(at); at.y += 1;
          sparks(at, "#facc15", 70);
          return floatText("DAM!", at, "#facc15", true);
        });
      });
      return chain;
    }
    function playLudo(events, st) {
      var chain = Promise.resolve();
      events.forEach(function (e) {
        if (e.type === "roll") chain = chain.then(function () {
          heroPlay(e.seat, "think");
          return showDie(e.value, true).then(function () {
            if (e.value === 6) { floatText("SIX!", new T.Vector3(0, 2.4, 0), "#facc15"); heroPlay(e.seat, "cheer"); }
          });
        });
        else if (e.type === "move") chain = chain.then(function () {
          var pc = pieces[e.seat + ":" + e.token]; if (!pc) return;
          lookAll(pc);
          var c2 = Promise.resolve();
          e.path.forEach(function (rel) {
            c2 = c2.then(function () {
              var rc = TTGeo.ludoCell(e.colour, rel, e.token);
              return hop(pc, cellPos("ludo", rc, st), 190, 0.4);
            });
          });
          return c2;
        });
        else if (e.type === "capture") chain = chain.then(function () {
          var pc = pieces[e.seat + ":" + e.token];
          heroPlay(e.seat, "attack");
          var c2 = Promise.resolve();
          e.victims.forEach(function (v) {
            heroPlay(v.seat, "hurt");
            var victim = pieces[v.seat + ":" + v.token];
            if (victim && pc) {
              // victim was sharing the square: step it aside first so the swing reads
              c2 = c2.then(function () {
                var aside = victim.position.clone().add(new T.Vector3(0.45, 0, 0.25));
                return hop(victim, aside, 180, 0.25);
              }).then(function () { return swordSlash(pc, victim); });
            }
          });
          return c2.then(function () { floatText("BACK TO BASE!", topOf(pc || piecesG), "#f87171"); });
        });
        else if (e.type === "home") chain = chain.then(function () {
          TT.sfx("crown"); heroPlay(e.seat, "cheer");
          sparks(new T.Vector3(0, 0.6, 0), TT.LUDO_COLORS[e.colour], 90);
          return floatText("HOME!", new T.Vector3(0, 2.2, 0), TT.LUDO_COLORS[e.colour], true);
        });
        else if (e.type === "no_move" || e.type === "forfeit") chain = chain.then(function () {
          heroPlay(e.seat, "sad");
          return floatText(e.type === "forfeit" ? "THREE SIXES!" : "NO MOVE", new T.Vector3(0, 2.4, 0), "#94a3b8");
        });
      });
      return chain;
    }
    function playWords(events, st) {
      var chain = Promise.resolve();
      events.forEach(function (e) {
        if (e.type === "place") chain = chain.then(function () {
          heroPlay(e.seat, "think");
          return Promise.all(e.tiles.map(function (t, k) {
            var tl = makeTile(t.l, st.values);
            var to = cellPos("words", t.r * 15 + t.c, st);
            tl.position.set(to.x, 6, to.z + 2);
            tl.rotation.set(Math.random() * 3, Math.random() * 3, 0);
            piecesG.add(tl);
            return delay(k * 120).then(function () {
              TT.sfx("tile");
              var from = tl.position.clone(), r0 = tl.rotation.clone();
              return anim(520, function (k2) {
                var e2 = easeOut(k2);
                tl.position.lerpVectors(from, to, e2);
                tl.position.y = to.y + (1 - e2) * 6 + Math.abs(Math.sin(k2 * Math.PI * 2)) * (1 - k2) * 0.4;
                tl.rotation.set(r0.x * (1 - e2), r0.y * (1 - e2), 0);
              });
            });
          })).then(function () {
            TT.sfx("score");
            heroPlay(e.seat, e.score >= 30 ? "dance" : "cheer");
            var last = e.tiles[e.tiles.length - 1];
            var at = cellPos("words", last.r * 15 + last.c, st); world.localToWorld(at); at.y += 1;
            sparks(at, "#facc15", 40 + Math.min(120, e.score * 2));
            floatText(e.words[0] + " +" + e.score, at, "#facc15", e.bingo || e.score >= 40);
            if (e.bingo) floatText("BINGO!", new T.Vector3(0, 3.4, 0), "#f472b6", true);
            return delay(500);
          });
        });
        else if (e.type === "pass" || e.type === "swap") chain = chain.then(function () {
          return floatText(e.type === "pass" ? "PASS" : "SWAP " + e.count, new T.Vector3(0, 2.2, 0), "#94a3b8");
        });
      });
      return chain;
    }

    function lookAll(target) {
      var tp = target.position;
      Object.keys(pieces).forEach(function (k) {
        var p = pieces[k];
        if (p === target || !p.userData) return;
        p.userData.lookAt = tp.clone();
        p.userData.lookT = 2.5;
      });
    }

    /* ───────────────────────── public: show / play ───────────────────────── */
    var queue = Promise.resolve(), camIntro = 0, backlog = 0;
    function framing(game, st) {
      if (PLUGINS[game] && PLUGINS[game].camera) {
        var cam = PLUGINS[game].camera(st);
        camBase.set(cam[0], cam[1], cam[2]); camLook.set(cam[3] || 0, cam[4] || 0, cam[5] || 0);
        return;
      }
      if (game === "chess") { camBase.set(0, 11.2, 11.6); camLook.set(0, 0, 0.5); }
      else if (game === "dam") { var k = st.size === 10 ? 1.22 : 1; camBase.set(0, 11 * k, 11 * k); camLook.set(0, 0, 0.8); }
      else { camBase.set(0, 12.4, 11.8); camLook.set(0, 0, 0.6); }
    }
    function show(match) {
      queue = queue.then(function () {
        return libReady.then(function () {
          var fresh = !cur || cur.id !== match.id;
          cur = match;
          if (fresh) {
            if (die) die.visible = false;
            buildBoard(match); buildHeroes(match); framing(match.game, match.state);
            camIntro = 1;
          } else {
            heroes.forEach(function (h) {
              var s = match.seats[h.seat];
              if (s && s.avatar !== h.avatar) { h.avatar = s.avatar; attachHero(h, s.avatar); }
            });
          }
          syncPieces(match);
        });
      });
      return queue;
    }
    function play(match, events) {
      if (!cur || cur.id !== match.id || !events || !events.length || document.hidden) return show(match);
      var prev = cur;
      backlog++;
      queue = queue.then(function () {
        return libReady.then(function () {
          // Fallen behind (fast players, slow projector)? Skip ahead instead
          // of replaying a long queue of animations.
          if (backlog > 2) return null;
          var p;
          if (match.game === "chess") p = playChess(events, match.state);
          else if (match.game === "dam") p = playDam(events, prev.state);
          else if (match.game === "ludo") p = playLudo(events, match.state);
          else if (PLUGINS[match.game]) p = PLUGINS[match.game].play(ctx, events, match, prev) || Promise.resolve();
          else p = playWords(events, match.state);
          return p.catch(function (err) { console.warn("[tt3d]", err); });
        }).then(function () {
          backlog = Math.max(0, backlog - 1);
          cur = match;
          syncPieces(match);
          if (events.some(function (e) { return e.type === "over"; })) celebrate(match);
        });
      });
      return queue;
    }
    function celebrate(match) {
      var res = match.state.result; if (!res) return;
      var winners = res.ranking[0] || [];
      var draw = winners.length === match.seats.length;
      TT.sfx(draw ? "turn" : "win");
      if (draw) { floatText("DRAW", new T.Vector3(0, 3, 0), "#e2e8f0", true); return; }
      confetti();
      winners.forEach(function (s) { heroPlay(s, "dance"); });
      match.seats.forEach(function (_, s) { if (winners.indexOf(s) < 0) heroPlay(s, "sad"); });
      var name = (match.seats[winners[0]] || {}).name || "Winner";
      floatText(name + " WINS!", new T.Vector3(0, 3.2, 0), "#facc15", true);
    }
    function react(pid, emoji) {
      var h = heroes.filter(function (x) { return x.pid === pid; })[0];
      var at = h ? h.holder.position.clone().setY(4.9) : new T.Vector3((Math.random() - 0.5) * 8, 3, 2);
      if (h) world.localToWorld(at);
      if (h && h.hero && h.hero.play) h.hero.play("wave");
      floatText(emoji, at, "#ffffff");
    }

    /* ───────────────────────── loop ───────────────────────── */
    var alive = true;
    function resize() {
      var w = container.clientWidth || 800, h = container.clientHeight || 450;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // keep the table filling the frame on tall screens
      world.scale.setScalar(Math.min(1, (w / h) / 1.45) * 0.25 + 0.75);
    }
    resize();
    var ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(container); else window.addEventListener("resize", resize);

    var tmpV = new T.Vector3();
    function loop() {
      if (!alive) return;
      // real elapsed time (capped), so slow projector laptops drop frames
      // instead of playing every animation in slow motion
      var dt = Math.min(0.25, clock.getDelta());
      elapsed += dt;
      // tweens
      for (var i = tweens.length - 1; i >= 0; i--) {
        var tw = tweens[i];
        tw.t += dt;
        var k = Math.min(1, tw.t / tw.d);
        try { tw.fn(k); } catch (e) { console.warn(e); }
        if (k >= 1) { tweens.splice(i, 1); tw.res(); }
      }
      // idle life
      Object.keys(pieces).forEach(function (kk) {
        var p = pieces[kk], u = p.userData;
        if (!u || !u.body) return;
        if (u.kind === "tile") { return; }
        var bob = Math.sin(elapsed * 2.2 + u.phase);
        if (!u.moving) {
          u.body.position.y = (u.ready ? 0.12 + Math.abs(Math.sin(elapsed * 6 + u.phase)) * 0.18 : 0.02 + bob * 0.02);
          u.body.rotation.y = u.kind === "knight" ? Math.sin(elapsed * 0.7 + u.phase) * 0.25 : Math.sin(elapsed * 0.9 + u.phase) * 0.06;
        }
        if (u.eyes) {
          u.blink -= dt;
          var sy = 1;
          if (u.blink < 0) { sy = 0.12; if (u.blink < -0.12) u.blink = 2 + Math.random() * 4; }
          var px = Math.sin(elapsed * 0.6 + u.phase) * 0.01, py = 0;
          if (u.lookT > 0 && u.lookAt) {
            u.lookT -= dt;
            tmpV.copy(u.lookAt).sub(p.position);
            px = Math.max(-0.018, Math.min(0.018, tmpV.x * 0.01));
            py = Math.max(-0.012, Math.min(0.012, -tmpV.z * 0.005));
          }
          u.eyes.forEach(function (e) {
            e.scale.y = sy;
            e.userData.pupil.position.x = px; e.userData.pupil.position.y = py;
          });
        }
        if (u.crown) u.crown.rotation.y += dt * 0.8;
      });
      for (var ti = 0; ti < ticks.length; ti++) { try { ticks[ti](dt, elapsed); } catch (e) { /* keep rendering */ } }
      heroes.forEach(function (h) {
        if (h.hero && h.hero.update) h.hero.update(dt, elapsed);
        if (h.hero && h.hero.isSprite) h.hero.obj.position.y = 1.0 + Math.abs(Math.sin(elapsed * 2.5)) * 0.15;
      });
      // dust drift
      var dp = dustGeo.attributes.position.array;
      for (var j = 0; j < dustN; j++) { dp[j * 3 + 1] += dt * 0.15; if (dp[j * 3 + 1] > 12) dp[j * 3 + 1] = 0; }
      dustGeo.attributes.position.needsUpdate = true;
      // camera: intro sweep, gentle orbit, impact shake
      camIntro = Math.max(0, camIntro - dt * 0.55);
      var sweep = ease(camIntro);
      var orbit = Math.sin(elapsed * 0.12) * 0.9;
      camera.position.set(camBase.x + orbit + sweep * 9, camBase.y + sweep * 6, camBase.z - sweep * 4);
      if (shake > 0) {
        shake = Math.max(0, shake - dt * 1.4);
        camera.position.x += (Math.random() - 0.5) * shake;
        camera.position.y += (Math.random() - 0.5) * shake;
      }
      camera.lookAt(camLook);
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    /* ───────────────────────── plugin context ───────────────────────── */
    var ticks = [];
    var ctx = {
      T: T, scene: scene, world: world, boardG: boardG, piecesG: piecesG, fxG: fxG,
      pieces: function () { return pieces; }, setPiece: function (k, o) { pieces[k] = o; },
      heroes: function () { return heroes; }, heroPlay: heroPlay, heroFor: heroFor,
      anim: anim, delay: delay, ease: ease, easeOut: easeOut, hop: hop, ring: ring, sparks: sparks,
      swordSlash: swordSlash, splitPiece: splitPiece, floatText: floatText, confetti: confetti,
      cloneNamed: cloneNamed, makePiece: makePiece, addEyes: addEyes, smat: smat, misc: misc,
      canvasTex: canvasTex, plinth: plinth, texturedBoard: texturedBoard, showDie: showDie,
      lookAll: lookAll, clearGroup: clearGroup, onTick: function (f) { ticks.push(f); },
      shake: function (v) { shake = Math.max(shake, v); }, flash: flash, elapsed: function () { return elapsed; },
    };

    return {
      show: show, play: play, react: react, celebrate: celebrate,
      current: function () { return cur; },
      dispose: function () { alive = false; if (ro) ro.disconnect(); renderer.dispose(); container.innerHTML = ""; },
    };
  }

  var PLUGINS = window.TTStagePlugins = window.TTStagePlugins || {};
  return { create: create, plugins: PLUGINS };
})();
