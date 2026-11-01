/* ═══════════════════════════════════════════════════════════════════
   DOOR SCREEN · PICTURE CHARACTER   (window.DoorCharacter)
   ───────────────────────────────────────────────────────────────────
   The welcome host as YOUR picture — exactly the image, not a drawing
   of it. PixiJS (static/screenart/vendor/pixi.min.js, MIT) lays the
   cut-out picture on a soft mesh and gently bends it every frame:

     idle      breathing, a slow weight-shift sway, curls that bounce
               with a lag, natural blinks (painted eyelids that follow
               the head), tiny head movements
     gestures  hello (bob + tilt) · groove (side-to-side, twice) ·
               hop (little jump with squash on landing) · nod ·
               wink · lean toward the room ("this way")

   The arms in the picture are part of the image, so there is no wave or
   sign language for a picture host — the sign-language tag never shows.

   Characters are described by CHARACTERS below: the image plus a few
   landmarks as fractions of the image (eyes, neck, where the head ends,
   the torso band). To use a sharper version of the same picture, replace
   the image file with the same framing — the fractions still fit.

   If WebGL or PixiJS is unavailable (very old TV browsers), the picture
   is shown with a gentle CSS breathing animation instead — never blank.

   Usage: DoorCharacter.mount(hostEl, {character, side, every, lines,
          wayText}) → {update, play, destroy, options}
   Assets come from window.DOOR_GREETER_ASSETS = {pixi, characters:{key:url}}
   (set by templates/screenart/door.html so the URLs go through {% static %}).
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Landmarks are fractions of the image (u = x / width, v = y / height).
  const CHARACTERS = {
    street: {
      label: "Your character",
      eyes: [
        // lid tones sampled from the picture around each eye: crease (top), lid, lower lid
        { u: 0.4005, v: 0.1670, ru: 0.0600, rv: 0.0182, top: 0x8d4e2b, mid: 0xac6844, low: 0xcd825e },
        { u: 0.6150, v: 0.1665, ru: 0.0600, rv: 0.0186, top: 0x7b3d1f, mid: 0x965434, low: 0xb26647 },
      ],
      lash: 0x1a0d08,
      neck: [0.508, 0.258],       // the head turns about this point
      headEnd: 0.235,             // fully head above this line…
      neckEnd: 0.292,             // …fading to body by this one
      faceU: 0.508, faceHalf: 0.19,
      torso: [0.29, 0.47],        // the band that breathes
    },
  };

  /* ───────────── loading PixiJS once ───────────── */
  let pixiPromise = null;
  function loadPixi() {
    if (window.PIXI) return Promise.resolve(window.PIXI);
    if (pixiPromise) return pixiPromise;
    const src = (window.DOOR_GREETER_ASSETS || {}).pixi;
    if (!src) return Promise.reject(new Error("no pixi url"));
    pixiPromise = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = () => (window.PIXI ? res(window.PIXI) : rej(new Error("pixi missing")));
      s.onerror = () => rej(new Error("pixi failed to load"));
      document.head.appendChild(s);
    });
    return pixiPromise;
  }
  function webglOK() {
    try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); }
    catch (e) { return false; }
  }

  /* ───────────── maths helpers ───────────── */
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const bump = (v, a, b) => (v <= a || v >= b) ? 0 : Math.sin(Math.PI * (v - a) / (b - a));
  function ease(t) { return t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* ───────────── gestures: keyframes on a handful of parameters ─────────────
     sway (rad, whole-body bend from the feet) · tilt (rad, head) · nod (fraction of height, head dip)
     lean (rad, extra bend toward the room) · hop (fraction of height, lift) · squash (+ = squashed)
     bob (fraction of height, quick dip) · wink (0..1, closes one eye)                                   */
  const Z = { sway: 0, tilt: 0, nod: 0, lean: 0, hop: 0, squash: 0, bob: 0, wink: 0 };
  const K = o => Object.assign({}, Z, o);
  const CLIPS = {
    hello:  [[0, K()], [260, K({ bob: .006, squash: .012 })], [520, K({ tilt: -.10, hop: .008, squash: -.01 })],
             [1100, K({ tilt: -.12 })], [1500, K({ tilt: -.04, bob: .004 })], [1900, K()]],
    groove: [[0, K()], [380, K({ sway: .045, tilt: -.06, bob: .006 })], [760, K({ sway: -.045, tilt: .06 })],
             [1140, K({ sway: .045, tilt: -.06, bob: .006 })], [1520, K({ sway: -.045, tilt: .06 })], [1900, K()]],
    hop:    [[0, K()], [220, K({ squash: .05 })], [420, K({ hop: .045, squash: -.035, tilt: -.04 })],
             [600, K({ hop: .02, squash: -.01 })], [740, K({ squash: .045 })], [920, K({ squash: -.01 })], [1200, K()]],
    nod:    [[0, K()], [260, K({ nod: .012, tilt: -.02 })], [520, K({ nod: -.002 })], [780, K({ nod: .011 })], [1150, K()]],
    wink:   [[0, K()], [300, K({ tilt: .09, wink: 1 })], [700, K({ tilt: .09, wink: 1 })], [900, K({ tilt: .06, wink: 0 })], [1300, K()]],
    lean:   [[0, K()], [600, K({ lean: .06, tilt: .10 })], [1600, K({ lean: .07, tilt: .12 })], [2200, K()]],
  };
  const BUBBLE = { hello: 0, groove: 1, hop: 2, nod: null, wink: 3, lean: "way" };
  const ORDER = ["hello", "groove", "wink", "lean", "hop", "nod"];

  function sample(clip, ms) {
    if (ms >= clip[clip.length - 1][0]) return clip[clip.length - 1][1];
    let i = 0; while (i < clip.length - 1 && clip[i + 1][0] <= ms) i++;
    const [t0, a] = clip[i], [t1, b] = clip[i + 1];
    const k = ease((ms - t0) / Math.max(1, t1 - t0));
    const out = {};
    for (const key in a) out[key] = a[key] + (b[key] - a[key]) * k;
    return out;
  }

  /* ───────────── the mesh deformation ───────────── */
  function makeDeform(C, W, H) {
    const nx = C.neck[0] * W, ny = C.neck[1] * H, cx = C.faceU * W;
    // returns [x, y, headAngle] for a point of the picture, given the current parameters
    return function (x, y, p, t) {
      const u = x / W, v = y / H;
      // 1) head: turn about the neck, plus a dip for nods
      const wh = 1 - smooth(C.headEnd, C.neckEnd, v);
      const a = p.tilt * wh;
      if (a) { const dx = x - nx, dy = y - ny, c = Math.cos(a), s = Math.sin(a); x = nx + dx * c - dy * s; y = ny + dx * s + dy * c; }
      y += p.nod * H * wh;
      // 2) curls: the outer hair swings with a lag, the top bobs a little
      const dist = Math.abs(u - C.faceU);
      const wf = smooth(C.faceHalf - .02, C.faceHalf + .14, dist) * (1 - smooth(C.neckEnd - .07, C.neckEnd + .02, v));
      const wt = (1 - smooth(0, .07, v)) * .7;
      if (wf + wt > 0) {
        const side = u < C.faceU ? -1 : 1;
        x += (Math.sin(t / 620 + v * 9 + side) * .0045 + p.sway * .06 + p.tilt * .02 * side) * W * wf;
        y += (Math.sin(t / 540 + u * 7) * .0018 - p.hop * .25 + p.squash * .02) * H * (wf * .6 + wt);
      }
      // 3) breathing: the torso widens slightly and lifts
      const wb = bump(v, C.torso[0], C.torso[1]);
      if (wb) { x = cx + (x - cx) * (1 + .013 * p.breath * wb); y -= .0035 * H * p.breath * wb; }
      // 4) whole-body bend from the feet (sway + lean), feet stay planted
      const bend = (p.sway + p.lean + p.idle) * (1 - v) * (1 - v * .3);
      if (bend) { const dx = x - cx, dy = y - H, c = Math.cos(bend), s = Math.sin(bend); x = cx + dx * c - dy * s; y = H + dx * s + dy * c; }
      // 5) squash & stretch from the feet, then the hop and bob
      if (p.squash) { y = H - (H - y) * (1 - p.squash); x = cx + (x - cx) * (1 + p.squash * .55); }
      y -= p.hop * H;
      y += p.bob * H * (1 - v);
      return [x, y, a + (p.sway + p.lean + p.idle) * (1 - v)];
    };
  }

  /* ───────────── mount ───────────── */
  function mount(host, options) {
    let opts = Object.assign({ character: "street", side: "left", every: 6, lines: ["Welcome!"] }, options || {});
    const C = CHARACTERS[opts.character] || CHARACTERS.street;
    const assets = (window.DOOR_GREETER_ASSETS || {}).characters || {};
    const src = assets[opts.character] || assets.street;
    let destroyed = false, raf = 0, app = null, lineIdx = 0, ro = null;
    let clip = null, clipName = "", clipStart = 0, nextAt = performance.now() + 1200, idx = 0;
    let blinkAt = performance.now() + 1800, blinkStart = -1e9;

    host.innerHTML = "";
    host.dataset.side = opts.side === "right" ? "right" : "left";
    host.classList.remove("dg-robot");
    const stageEl = document.createElement("div");
    stageEl.className = "dc-stage";
    stageEl.style.cssText = "position:absolute;inset:0";
    const bubble = document.createElement("div");
    bubble.className = "dg-bubble"; bubble.setAttribute("aria-live", "polite");
    host.appendChild(stageEl); host.appendChild(bubble);

    function say(name) {
      const b = BUBBLE[name];
      if (b === null || b === undefined) { bubble.classList.remove("on"); return; }
      let text;
      if (b === "way") text = opts.wayText || "Come in — this way";
      else { const lines = (opts.lines || []).filter(Boolean); text = lines.length ? lines[lineIdx++ % lines.length] : "Welcome!"; }
      bubble.textContent = text;
      bubble.classList.remove("on"); void bubble.offsetWidth; bubble.classList.add("on");
    }
    function schedule(now) {
      if (!clip && now >= nextAt) {
        clipName = ORDER[idx++ % ORDER.length]; clip = CLIPS[clipName]; clipStart = now; say(clipName);
      }
      let p = Z;
      if (clip) {
        const ms = now - clipStart;
        p = sample(clip, ms);
        if (ms >= clip[clip.length - 1][0]) {
          clip = null; nextAt = now + Math.max(2, +opts.every || 6) * 1000;
          setTimeout(() => { if (!clip) bubble.classList.remove("on"); }, 900);
        }
      }
      const m = REDUCED ? 0.15 : 1;
      return Object.assign({}, p, {
        tilt: p.tilt * m + (REDUCED ? 0 : Math.sin(now / 2700) * .018 + Math.sin(now / 1300) * .006),
        sway: p.sway * m, lean: p.lean * m, hop: p.hop * m, squash: p.squash * m, bob: p.bob * m, nod: p.nod * m,
        idle: REDUCED ? 0 : Math.sin(now / 3100) * .008,
        breath: REDUCED ? 0 : Math.sin(now / 950),
      });
    }
    function blinkAmount(now) {
      if (now >= blinkAt) { blinkStart = now; blinkAt = now + 2600 + Math.random() * 3200 + (Math.random() < .18 ? -2200 : 0); }
      const t = (now - blinkStart) / 170;                       // ~170 ms close, same to open
      return t < 0 || t > 2 ? 0 : (t < 1 ? t : 2 - t);
    }

    /* The plain picture shows at once (slow TVs never sit blank); it stays — gently breathing via CSS —
       if WebGL or PixiJS isn't available, and is removed once the animated version is drawing. */
    const still = document.createElement("img");
    still.src = src; still.alt = "Welcome host";
    still.style.cssText = "position:absolute;bottom:1%;left:50%;height:98%;max-width:100%;object-fit:contain;transform-origin:50% 100%;" +
                          "transform:translateX(-50%);filter:drop-shadow(0 18px 30px rgba(0,0,0,.35))";
    stageEl.appendChild(still);
    function fallback() {
      if (destroyed) return;
      if (!REDUCED) still.style.animation = "dcBreath 3.4s ease-in-out infinite";
      const tick = now => { if (destroyed) return; raf = requestAnimationFrame(tick); schedule(now); };
      raf = requestAnimationFrame(tick);
    }

    async function start() {
      if (!src) return;
      let PIXI;
      try {
        if (!webglOK()) throw new Error("no webgl");
        PIXI = await loadPixi();
      } catch (e) { fallback(); return; }
      if (destroyed) return;
      let texture;
      try { texture = await PIXI.Assets.load(src); }
      catch (e) { fallback(); return; }
      if (destroyed) return;

      try {
        app = new PIXI.Application({ backgroundAlpha: 0, antialias: true, autoDensity: true,
                                     resolution: Math.min(2, window.devicePixelRatio || 1), resizeTo: stageEl });
      } catch (e) { fallback(); return; }
      stageEl.appendChild(app.view);
      // PixiJS's resizeTo only listens to WINDOW resizes; the door page's grid settles the host box after
      // start-up, so watch the box itself. The canvas keeps its own (autoDensity) size — never stretched.
      app.view.style.position = "absolute"; app.view.style.left = "0"; app.view.style.top = "0";
      app.resize();
      if (window.ResizeObserver) { ro = new ResizeObserver(() => { if (app) app.resize(); }); ro.observe(stageEl); }
      const W = texture.width, H = texture.height;
      const deform = makeDeform(C, W, H);

      const root = new PIXI.Container();
      app.stage.addChild(root);

      // soft contact shadow under the feet
      const shadow = new PIXI.Graphics();
      shadow.beginFill(0x000000, .34).drawEllipse(0, 0, W * .30, H * .012).endFill();
      shadow.filters = [new PIXI.BlurFilter(8)];
      shadow.position.set(W * C.faceU, H * .995);
      root.addChild(shadow);

      // the picture on a mesh
      const COLS = 18, ROWS = 44;
      const plane = new PIXI.SimplePlane(texture, COLS, ROWS);
      root.addChild(plane);
      const buf = plane.geometry.getBuffer("aVertexPosition");
      const base = Float32Array.from(buf.data);

      // eyelids: painted over each eye through a FEATHERED mask (so the paint melts into the picture's
      // skin instead of showing an edge), slightly blurred, and moved with the head every frame
      const feather = (() => {
        const cv = document.createElement("canvas"); cv.width = cv.height = 128;
        const x = cv.getContext("2d"), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(.74, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
        x.fillStyle = g; x.fillRect(0, 0, 128, 128);
        return PIXI.Texture.from(cv);
      })();
      const lids = C.eyes.map(e => {
        const holder = new PIXI.Container();
        const rx = e.ru * W, ry = e.rv * H;
        const mask = new PIXI.Sprite(feather);
        mask.anchor.set(.5); mask.width = rx * 3.0; mask.height = ry * 3.3;
        const lid = new PIXI.Graphics();                       // skin: softened a touch
        lid.filters = [new PIXI.BlurFilter(Math.max(.6, ry * .025), 2)];
        const lash = new PIXI.Graphics();                      // lash line: crisp
        holder.addChild(mask); holder.addChild(lid); holder.addChild(lash); holder.mask = mask;
        root.addChild(holder);
        return { e, holder, lid, lash, rx, ry };
      });
      // A closing eye: the upper lid sweeps down, the lower lid rises a little, and they meet on a curved
      // lash line just below the middle — the soft "closed eye" shape of a 3D cartoon.
      function drawLid(L, k) {
        const g = L.lid, e = L.e, rx = L.rx, ry = L.ry; g.clear(); L.lash.clear();
        if (k <= .02) return;
        const top = -ry * 1.65, bottom = ry * 1.65, meet = ry * .28;
        const edge = top + (meet - top) * k;                             // upper lid edge
        const low = bottom - (bottom - meet) * Math.pow(k, 1.6);         // lower lid edge (rises later)
        const curve = ry * .42 * k;                                      // the lid's edge bows downward
        // lower lid
        g.beginFill(e.low).moveTo(-rx * 1.55, bottom).lineTo(-rx * 1.55, low).quadraticCurveTo(0, low + curve * .6, rx * 1.55, low)
         .lineTo(rx * 1.55, bottom).closePath().endFill();
        // upper lid, with a darker crease at the top and a soft sheen near the edge
        g.beginFill(e.mid).moveTo(-rx * 1.55, top).lineTo(rx * 1.55, top).lineTo(rx * 1.55, edge)
         .quadraticCurveTo(0, edge + curve, -rx * 1.55, edge).closePath().endFill();
        g.beginFill(e.top, .5).drawRect(-rx * 1.55, top, rx * 3.1, Math.min(ry * 1.0, edge - top)).endFill();
        if (k > .45) g.beginFill(0xffffff, .10 * k).drawEllipse(-rx * .15, edge - ry * .25 + curve * .5, rx * .55, ry * .2).endFill();
        // lash line along the lid edge, with two little flicks at the outer corner when closed
        const lg = L.lash;
        lg.lineStyle(Math.max(2, ry * .2), C.lash, 1);
        lg.moveTo(-rx * 1.0, edge - ry * .06).quadraticCurveTo(0, edge + curve * 1.02, rx * 1.0, edge - ry * .06);
        if (k > .8) {
          const out = e.u < C.faceU ? -1 : 1, x0 = out * rx * .92, y0 = edge - ry * .02;
          lg.lineStyle(Math.max(1.5, ry * .13), C.lash, 1);
          lg.moveTo(x0, y0).lineTo(x0 + out * rx * .2, y0 - ry * .3);
          lg.moveTo(x0 - out * rx * .14, y0 + ry * .08).lineTo(x0 + out * rx * .04, y0 - ry * .26);
        }
      }

      let lastW = -1, lastH = -1;
      function layout() {
        const sw = app.screen.width, sh = app.screen.height;
        if (sw === lastW && sh === lastH) return;
        lastW = sw; lastH = sh;
        // same footprint as the still picture: 98 % of the height, feet 1 % above the bottom
        const s = Math.min(sw / (W * 1.06), (sh * .98) / H);
        root.scale.set(s);
        root.position.set((sw - W * s) / 2, sh * .99 - H * s);
      }

      let shown = false;
      app.ticker.add(() => {
        if (destroyed) return;
        layout();
        if (!shown) { shown = true; requestAnimationFrame(() => { if (!destroyed) still.remove(); }); }
        const now = performance.now();
        const p = schedule(now);
        const d = buf.data;
        for (let i = 0; i < d.length; i += 2) {
          const r = deform(base[i], base[i + 1], p, now);
          d[i] = r[0]; d[i + 1] = r[1];
        }
        buf.update();
        // lids follow the deformed eye centres
        const blink = blinkAmount(now);
        lids.forEach((L, i) => {
          const r = deform(L.e.u * W, L.e.v * H, p, now);
          L.holder.position.set(r[0], r[1]);
          L.holder.rotation = r[2];
          const k = Math.max(blink, i === 0 ? p.wink : 0);
          drawLid(L, k);
        });
        // shadow shrinks while she's in the air
        const air = clamp(p.hop * 18, 0, .6);
        shadow.scale.set(1 - air * .45, 1 - air * .3);
        shadow.alpha = 1 - air * .6;
      });
    }
    start();

    return {
      update(next) {
        const before = JSON.stringify([opts.character, opts.side]);
        opts = Object.assign(opts, next || {});
        host.dataset.side = opts.side === "right" ? "right" : "left";
        if (JSON.stringify([opts.character, opts.side]) !== before && opts.character !== (options || {}).character) {
          // a different picture: rebuild
          this.destroy(); Object.assign(this, mount(host, opts));
        }
      },
      play(name) { if (CLIPS[name]) { clip = CLIPS[name]; clipName = name; clipStart = performance.now(); say(name); } },
      destroy() {
        destroyed = true; cancelAnimationFrame(raf);
        if (ro) { ro.disconnect(); ro = null; }
        if (app) { try { app.destroy(true, { children: true, texture: false, baseTexture: false }); } catch (e) {} app = null; }
        host.innerHTML = "";
      },
      get options() { return Object.assign({}, opts); },
    };
  }

  const css = document.createElement("style");
  css.textContent = "@keyframes dcBreath{0%,100%{transform:translateX(-50%) scale(1,1)}50%{transform:translateX(-50%) scale(1.012,1.008)}}";
  document.head.appendChild(css);

  window.DoorCharacter = { mount, CHARACTERS, CLIPS, ORDER };
})();
