/* ==========================================================================
   KnockKnock · Attendance badges · built-in templates  (window.KKBadgeTemplates)
   --------------------------------------------------------------------------
   Each template is a complete layout JSON (see badge_render.js for the
   schema). Picking one in the designer COPIES it into the event, so editing
   never changes the original here.

   Adding a template: append an object to LIST with a unique key. No
   migration, no Python change.

   Coordinates: x / y / w / h are % of the badge; fs is cqmin (% of the
   badge's shorter side). Square-locked items (sq:true, and every QR) take
   their height from their width, so circles stay round on any size.
   ========================================================================== */
(function () {
  "use strict";

  let n = 0;
  const id = () => "t" + (++n);

  // Element factories — keep the template definitions readable.
  const txt = (x, y, w, h, text, o) => Object.assign(
    { id: id(), t: "text", x, y, w, h, txt: text, fs: 4, fw: 600, ff: "inter",
      c: "#111111", al: "c", va: "m" }, o || {});
  const box = (x, y, w, h, o) => Object.assign(
    { id: id(), t: "shape", x, y, w, h, fill: "#000000" }, o || {});
  const qr = (x, y, w, o) => Object.assign(
    { id: id(), t: "qr", x, y, w, h: w, mode: "ticket", fg: "#111111", bgc: "#ffffff",
      pad: 1.2, rad: 1.2, sq: true }, o || {});
  const img = (x, y, w, h, src, o) => Object.assign(
    { id: id(), t: "image", x, y, w, h, src, fit: "contain" }, o || {});

  const NAME = { fit: true };
  const ONE = { fit: true, nowrap: true };

  // Polygon helpers for organic edges (values are % of the element box).
  function waveClip(base, amp, waves, phase) {
    const pts = ["0% 0%", "100% 0%"];
    for (let i = 0; i <= 40; i++) {
      const x = 100 - i * 2.5;
      const y = base + amp * Math.sin((x / 100) * Math.PI * 2 * waves + (phase || 0));
      pts.push(`${x.toFixed(1)}% ${y.toFixed(1)}%`);
    }
    return `polygon(${pts.join(",")})`;
  }
  function tornClip(base, jag) {
    const pts = ["0% 0%", "100% 0%"];
    let flip = false;
    for (let x = 100; x >= 0; x -= 3.2) {
      pts.push(`${x.toFixed(1)}% ${(flip ? base : base + jag * (0.4 + ((x * 7) % 10) / 16)).toFixed(1)}%`);
      flip = !flip;
    }
    pts.push(`0% ${base}%`);
    return `polygon(${pts.join(",")})`;
  }
  const HEX = "polygon(25% 5%,75% 5%,100% 50%,75% 95%,25% 95%,0 50%)";
  const KENTE = "repeating-linear-gradient(90deg,#0b7a3b 0 6%,#f5b301 6% 9%,#c8102e 9% 15%,#111 15% 17%,#f5b301 17% 23%,#0b7a3b 23% 25%)";

  // Short event / date / venue lines should never wrap into the line
  // below — keep them on one line and shrink instead.
  const ONE_LINE_TOKENS = /\{(event|dates|date|venue|time|code)\}/;
  const PERSON_TOKENS = /\{(name|first|last|org|title|role)\}/;
  function oneLineMeta(els) {
    els.forEach(e => {
      if (e.t === "text" && !("nowrap" in e) && e.h <= 9 &&
          ONE_LINE_TOKENS.test(e.txt) && !PERSON_TOKENS.test(e.txt)) {
        e.nowrap = true; e.fit = true;
      }
    });
    return els;
  }

  function T(key, name, cat, tags, size, bg, els, roles) {
    oneLineMeta(els);
    return {
      key, name, cat, tags: tags || [],
      layout: { v: 1, size, bg: Object.assign({ color: "#ffffff" }, bg || {}),
                roles: Object.assign({ field: "", fallback: "Participant" }, roles || {}), els },
    };
  }

  const LIST = [

    // ───────────────────────── PORTRAIT (A6 lanyard) ─────────────────────────
    T("aurora", "Aurora", "portrait", ["dark", "gradient"], "a6",
      { color: "#0b0820", grad: "radial-gradient(120% 80% at 0% 0%, #7c3aed 0%, transparent 55%), radial-gradient(100% 70% at 100% 100%, #22d3ee 0%, transparent 50%), linear-gradient(160deg,#120a2e,#0b0820)" },
      [
        txt(8, 5, 84, 6, "{event}", { ff: "space", fs: 3.6, c: "rgba(255,255,255,.88)", al: "l", up: true, ls: 0.12, fit: true }),
        txt(8, 11, 84, 4, "{dates} · {venue}", { fs: 2.7, fw: 400, c: "rgba(255,255,255,.6)", al: "l" }),
        box(8, 18, 14, 0.7, { fill: "role", rad: 0.4 }),
        txt(8, 22, 84, 17, "{first}", Object.assign({ ff: "space", fs: 13, fw: 700, c: "#ffffff", al: "l", va: "b" }, ONE)),
        txt(8, 39, 84, 8, "{last}", Object.assign({ ff: "space", fs: 6.6, fw: 500, c: "#e9e5ff", al: "l", va: "t" }, ONE)),
        txt(8, 49, 84, 5, "{title}", { fs: 3.3, fw: 500, c: "rgba(255,255,255,.82)", al: "l", va: "t" }),
        txt(8, 54.5, 84, 5, "{org}", { fs: 3.4, fw: 700, c: "#c4b5fd", al: "l", va: "t" }),
        qr(8, 63, 32, { fg: "#0b0820", pad: 2, rad: 2.5 }),
        txt(45, 66, 47, 5, "#{no}", { ff: "mono", fs: 3, fw: 500, c: "rgba(255,255,255,.7)", al: "l" }),
        txt(45, 71, 47, 8, "Scan at the door to check in", { fs: 2.5, fw: 400, c: "rgba(255,255,255,.5)", al: "l", va: "t" }),
        box(0, 89, 100, 11, { fill: "role" }),
        txt(0, 89, 100, 11, "{role}", { ff: "space", fs: 4.8, fw: 700, c: "roleInk", up: true, ls: 0.2 }),
      ]),

    T("corporate", "Corporate Navy", "portrait", ["light", "logo"], "a6",
      { color: "#ffffff" },
      [
        box(0, 0, 100, 18, { fill: "#0b1f3a" }),
        img(6, 3.5, 24, 11, "logo"),
        txt(32, 3, 62, 8, "{event}", { fs: 3.5, fw: 700, c: "#ffffff", al: "r", fit: true }),
        txt(32, 10.5, 62, 5, "{dates}", { fs: 2.6, fw: 400, c: "#94a3b8", al: "r" }),
        box(0, 18, 100, 1.2, { fill: "role" }),
        txt(8, 25, 84, 15, "{name}", Object.assign({ ff: "montserrat", fs: 9, fw: 800, c: "#0b1f3a" }, NAME)),
        txt(8, 41, 84, 5, "{title}", { fs: 3.5, fw: 500, c: "#475569" }),
        txt(8, 46.5, 84, 5, "{org}", { fs: 3.7, fw: 700, c: "#0b1f3a" }),
        qr(35, 55, 30, { fg: "#0b1f3a", pad: 0.6 }),
        txt(8, 78, 84, 4, "No. {no}", { ff: "mono", fs: 2.5, fw: 500, c: "#94a3b8" }),
        box(0, 86, 100, 14, { fill: "role" }),
        txt(0, 86, 100, 14, "{role}", { ff: "montserrat", fs: 5.2, fw: 800, c: "roleInk", up: true, ls: 0.25 }),
      ]),

    T("un_blue", "UN Blue", "portrait", ["light", "logo", "official"], "a6",
      { color: "#ffffff" },
      [
        box(0, 0, 100, 25, { fill: "#009edb" }),
        img(34, 3, 32, 11.5, "logo"),
        txt(5, 15.5, 90, 7.5, "{event}", { fs: 3.3, fw: 700, c: "#ffffff", up: true, ls: 0.05, fit: true }),
        txt(6, 30, 88, 13.5, "{name}", Object.assign({ fs: 8.4, fw: 800, c: "#1a2b48" }, NAME)),
        txt(6, 44, 88, 5, "{title}", { fs: 3.4, fw: 500, c: "#4a5568" }),
        txt(6, 49.5, 88, 5, "{org}", { fs: 3.6, fw: 700, c: "#009edb" }),
        qr(34, 58, 32, { fg: "#1a2b48", pad: 0.4 }),
        box(0, 84, 100, 16, { fill: "role" }),
        txt(0, 84, 100, 10, "{role}", { fs: 5, fw: 800, c: "roleInk", up: true, ls: 0.2 }),
        txt(4, 93, 92, 6, "{venue} · {dates}", { fs: 2.2, fw: 500, c: "roleInk", op: 0.85 }),
      ]),

    T("diagonal", "Diagonal Split", "portrait", ["light", "bold"], "a6",
      { color: "#f8fafc" },
      [
        box(0, 0, 100, 38, { fill: "role", clip: "polygon(0 0,100% 0,100% 62%,0 100%)" }),
        box(0, 0, 100, 38, { grad: "linear-gradient(135deg, rgba(255,255,255,.2), rgba(0,0,0,.18))", clip: "polygon(0 0,100% 0,100% 62%,0 100%)" }),
        txt(7, 5, 86, 5, "{event}", { fs: 3.1, fw: 700, c: "roleInk", al: "l", up: true, ls: 0.1, fit: true }),
        txt(7, 10.5, 60, 4, "{dates}", { fs: 2.6, fw: 500, c: "roleInk", al: "l", op: 0.85 }),
        txt(7, 16, 60, 9, "{role}", { ff: "bebas", fs: 7.6, fw: 400, c: "roleInk", al: "l", ls: 0.06 }),
        txt(7, 40, 86, 12, "{first}", Object.assign({ ff: "poppins", fs: 11, fw: 800, c: "#0f172a", al: "l" }, ONE)),
        txt(7, 52, 86, 6.5, "{last}", Object.assign({ ff: "poppins", fs: 5.6, fw: 600, c: "#334155", al: "l" }, ONE)),
        box(7, 60, 10, 0.8, { fill: "role" }),
        txt(7, 62, 86, 5, "{title}", { fs: 3.2, fw: 500, c: "#475569", al: "l" }),
        txt(7, 66.5, 86, 5, "{org}", { fs: 3.4, fw: 700, c: "#0f172a", al: "l" }),
        qr(62, 74, 31, { fg: "#0f172a", pad: 0.4 }),
        txt(7, 85, 50, 4.5, "#{no}", { ff: "mono", fs: 2.8, fw: 500, c: "#64748b", al: "l" }),
        txt(7, 90, 50, 4.5, "{venue}", { fs: 2.5, fw: 500, c: "#64748b", al: "l" }),
      ]),

    T("photo_hero", "Full-bleed Photo", "portrait", ["photo", "dark"], "a6",
      { color: "#1f2937", grad: "linear-gradient(160deg,#475569,#0f172a)", img: "background",
        ov: "linear-gradient(180deg, rgba(0,0,0,.25) 0%, rgba(0,0,0,.05) 32%, rgba(0,0,0,.72) 66%, rgba(0,0,0,.92) 100%)", ovop: 1 },
      [
        txt(6, 5, 88, 5.5, "{event}", { fs: 3.4, fw: 700, c: "#ffffff", al: "l", up: true, ls: 0.12, sh: true, fit: true }),
        txt(6, 10.5, 88, 4, "{dates}", { fs: 2.6, fw: 500, c: "rgba(255,255,255,.88)", al: "l", sh: true }),
        box(6, 52, 16, 1.4, { fill: "role", rad: 0.7 }),
        txt(6, 55, 88, 13, "{name}", Object.assign({ ff: "montserrat", fs: 9, fw: 800, c: "#ffffff", al: "l", va: "b", sh: true }, NAME)),
        txt(6, 68.5, 88, 5, "{title} · {org}", { fs: 3.1, fw: 500, c: "rgba(255,255,255,.88)", al: "l" }),
        qr(6, 76, 22, { fg: "#111111", pad: 1.5, rad: 2 }),
        box(32, 78, 42, 7, { fill: "role", rad: 3.5 }),
        txt(32, 78, 42, 7, "{role}", { ff: "montserrat", fs: 3.6, fw: 800, c: "roleInk", up: true, ls: 0.14, fit: true }),
        txt(32, 87, 62, 4.5, "#{no}", { ff: "mono", fs: 2.6, fw: 500, c: "rgba(255,255,255,.7)", al: "l" }),
      ]),

    T("kente", "Kente Band", "portrait", ["light", "african", "pattern"], "a6",
      { color: "#fffdf7" },
      [
        box(0, 0, 100, 13, { grad: KENTE }),
        box(0, 13, 100, 2, { grad: "repeating-linear-gradient(45deg,#111 0 2%,#f5b301 2% 4%)" }),
        txt(6, 19, 88, 6, "{event}", { ff: "dmserif", fs: 4, fw: 400, c: "#3b2a1f", fit: true }),
        txt(6, 25, 88, 4, "{dates} · {venue}", { fs: 2.6, fw: 500, c: "#7a6a55" }),
        txt(6, 32, 88, 14, "{name}", Object.assign({ ff: "poppins", fs: 8.6, fw: 800, c: "#1c1917" }, NAME)),
        txt(6, 46.5, 88, 5, "{title}", { fs: 3.4, fw: 500, c: "#57534e" }),
        txt(6, 51.5, 88, 5, "{org}", { fs: 3.6, fw: 700, c: "#0b7a3b" }),
        qr(35, 59, 30, { fg: "#1c1917", pad: 0.4 }),
        box(0, 84, 100, 16, { fill: "role" }),
        box(0, 84, 100, 1.6, { grad: KENTE }),
        txt(0, 85.6, 100, 14.4, "{role}", { ff: "poppins", fs: 5, fw: 800, c: "roleInk", up: true, ls: 0.22 }),
      ]),

    T("smiling_coast", "Smiling Coast", "portrait", ["light", "gambia", "flag"], "a6",
      { color: "#ffffff" },
      [
        box(0, 0, 100, 5.5, { fill: "#ce1126" }),
        box(0, 6.4, 100, 4.2, { fill: "#0c1c8c" }),
        box(0, 11.5, 100, 5.5, { fill: "#3a7728" }),
        txt(6, 21, 88, 6, "{event}", { ff: "montserrat", fs: 3.8, fw: 800, c: "#0c1c8c", up: true, ls: 0.04, fit: true }),
        txt(6, 27.5, 88, 4, "{dates} · {venue}", { fs: 2.6, fw: 500, c: "#64748b" }),
        txt(6, 34, 88, 14, "{name}", Object.assign({ ff: "montserrat", fs: 8.8, fw: 800, c: "#111827" }, NAME)),
        txt(6, 48.5, 88, 5, "{title}", { fs: 3.4, fw: 500, c: "#4b5563" }),
        txt(6, 53.5, 88, 5, "{org}", { fs: 3.6, fw: 700, c: "#3a7728" }),
        qr(35, 61, 30, { fg: "#0c1c8c", pad: 0.4 }),
        box(12, 86, 76, 8.5, { fill: "role", rad: 4.2 }),
        txt(12, 86, 76, 8.5, "{role}", { fs: 4.3, fw: 800, c: "roleInk", up: true, ls: 0.2, fit: true }),
        box(0, 97, 100, 3, { grad: "linear-gradient(90deg,#ce1126 0 33.3%,#0c1c8c 33.3% 66.6%,#3a7728 66.6%)" }),
      ]),

    T("mono_minimal", "Minimal Mono", "portrait", ["light", "minimal"], "a6",
      { color: "#ffffff" },
      [
        txt(8, 6, 84, 4.5, "{event}", { fs: 2.8, fw: 600, c: "#111111", al: "l", up: true, ls: 0.2, fit: true }),
        txt(8, 10.5, 84, 4, "{dates}", { fs: 2.6, fw: 400, c: "#737373", al: "l" }),
        txt(8, 26, 84, 18, "{first}", Object.assign({ fs: 14, fw: 900, c: "#0a0a0a", al: "l", va: "b", ls: -0.03 }, ONE)),
        txt(8, 44, 84, 8, "{last}", Object.assign({ fs: 6, fw: 400, c: "#0a0a0a", al: "l", va: "t" }, ONE)),
        box(8, 55, 84, 0.35, { fill: "#0a0a0a" }),
        txt(8, 57.5, 84, 5, "{title}", { fs: 3.2, fw: 400, c: "#525252", al: "l" }),
        txt(8, 62.5, 84, 5, "{org}", { fs: 3.2, fw: 700, c: "#0a0a0a", al: "l" }),
        qr(8, 73, 22, { fg: "#0a0a0a", pad: 0, rad: 0 }),
        txt(36, 84, 56, 5, "{role}", { fs: 3.2, fw: 700, c: "role", al: "r", up: true, ls: 0.2 }),
        txt(36, 89, 56, 4, "№ {no}", { ff: "mono", fs: 2.6, fw: 500, c: "#737373", al: "r" }),
      ]),

    T("hello", "Hello, my name is", "portrait", ["fun", "networking"], "a6",
      { color: "#ffffff" },
      [
        box(0, 0, 100, 30, { fill: "role" }),
        txt(0, 4, 100, 13, "HELLO", { ff: "archivo", fs: 11, fw: 400, c: "roleInk", ls: 0.05 }),
        txt(0, 17, 100, 9, "my name is", { ff: "caveat", fs: 7, fw: 700, c: "roleInk" }),
        txt(6, 34, 88, 22, "{first}", Object.assign({ ff: "caveat", fs: 17, fw: 700, c: "#111111" }, ONE)),
        txt(6, 56, 88, 5.5, "{name}", { fs: 3.3, fw: 600, c: "#444444" }),
        txt(6, 61.5, 88, 5, "{org}", { fs: 3.1, fw: 500, c: "#666666" }),
        qr(37, 69, 26, { fg: "#111111", pad: 0.4 }),
        box(0, 92, 100, 8, { fill: "role" }),
        txt(4, 92, 92, 8, "{event}", { fs: 2.7, fw: 700, c: "roleInk", up: true, ls: 0.12, fit: true }),
      ]),

    T("neon", "Neon Night", "portrait", ["dark", "tech", "glow"], "a6",
      { color: "#05060f", grad: "radial-gradient(80% 50% at 50% 0%, rgba(34,211,238,.2), transparent 70%), radial-gradient(80% 50% at 50% 100%, rgba(236,72,153,.22), transparent 70%)" },
      [
        box(4, 3, 92, 94, { fill: "transparent", bw: 0.5, bc: "#22d3ee", rad: 3, shadow: "0 0 2.2cqmin #22d3ee, inset 0 0 2.2cqmin rgba(34,211,238,.35)" }),
        txt(9, 7, 82, 5, "{event}", { ff: "mono", fs: 2.9, fw: 700, c: "#22d3ee", al: "l", up: true, ls: 0.12, fit: true }),
        txt(9, 12, 82, 4, "> {dates}", { ff: "mono", fs: 2.5, fw: 500, c: "#a5b4fc", al: "l" }),
        txt(9, 24, 82, 16, "{first}", Object.assign({ ff: "space", fs: 12, fw: 700, c: "#ffffff", al: "l", va: "b", tsh: "0 0 1.6cqmin #ec4899" }, ONE)),
        txt(9, 40, 82, 7, "{last}", Object.assign({ ff: "space", fs: 6, fw: 500, c: "#f0abfc", al: "l", va: "t" }, ONE)),
        txt(9, 49, 82, 9, "{title} @ {org}", { ff: "mono", fs: 2.8, fw: 500, c: "#cbd5e1", al: "l", va: "t" }),
        qr(9, 62, 32, { fg: "#05060f", bgc: "#22d3ee", pad: 2, rad: 2 }),
        txt(46, 63, 45, 7, "{role}", { ff: "mono", fs: 3.6, fw: 800, c: "#f0abfc", al: "l", up: true, fit: true }),
        txt(46, 71, 45, 5, "ID:{no}", { ff: "mono", fs: 2.8, fw: 500, c: "#64748b", al: "l" }),
        box(9, 89, 82, 0.4, { grad: "linear-gradient(90deg,#22d3ee,#ec4899)" }),
        txt(9, 90.5, 82, 4.5, "{venue}", { ff: "mono", fs: 2.4, fw: 500, c: "#64748b", al: "l" }),
      ]),

    T("tech_grid", "Tech Grid", "portrait", ["dark", "tech"], "a6",
      { color: "#0b1220", grad: "linear-gradient(rgba(56,189,248,.09) 1px, transparent 1px) 0 0/6cqmin 6cqmin, linear-gradient(90deg, rgba(56,189,248,.09) 1px, transparent 1px) 0 0/6cqmin 6cqmin, linear-gradient(180deg,#0b1220,#111a2e)" },
      [
        box(6, 5, 26, 6, { fill: "role", rad: 1 }),
        txt(6, 5, 26, 6, "{role}", { ff: "mono", fs: 2.6, fw: 800, c: "roleInk", up: true, fit: true }),
        txt(34, 5, 60, 6, "{event}", { ff: "mono", fs: 2.8, fw: 500, c: "#7dd3fc", al: "r", fit: true }),
        txt(6, 21, 88, 5, "// attendee", { ff: "mono", fs: 2.8, fw: 500, c: "#475569", al: "l" }),
        txt(6, 26, 88, 14, "{name}", Object.assign({ ff: "space", fs: 8.4, fw: 700, c: "#e2e8f0", al: "l" }, NAME)),
        txt(6, 41, 88, 5, "{title}", { ff: "mono", fs: 3, fw: 500, c: "#94a3b8", al: "l" }),
        txt(6, 46, 88, 5, "{org}", { ff: "mono", fs: 3, fw: 700, c: "#38bdf8", al: "l" }),
        qr(6, 56, 40, { fg: "#0b1220", bgc: "#e2e8f0", pad: 2, rad: 1.5 }),
        txt(52, 58, 42, 5, "ticket", { ff: "mono", fs: 2.4, fw: 500, c: "#475569", al: "l" }),
        txt(52, 62, 42, 8, "#{no}", { ff: "mono", fs: 5, fw: 800, c: "#e2e8f0", al: "l" }),
        txt(52, 72, 42, 9, "{dates}", { ff: "mono", fs: 2.4, fw: 500, c: "#64748b", al: "l", va: "t" }),
        box(0, 92, 100, 8, { fill: "#0f172a" }),
        txt(6, 92, 88, 8, "{venue}", { ff: "mono", fs: 2.4, fw: 500, c: "#64748b", al: "l" }),
      ]),

    T("sunset", "Sunset Card", "portrait", ["gradient", "warm"], "a6",
      { color: "#ff7a59", grad: "linear-gradient(160deg,#ffb347 0%,#ff6a88 55%,#8e44ad 100%)" },
      [
        txt(6, 4.5, 88, 6.5, "{event}", { ff: "poppins", fs: 3.8, fw: 800, c: "#ffffff", up: true, ls: 0.06, fit: true }),
        txt(6, 11, 88, 4, "{dates}", { fs: 2.6, fw: 500, c: "rgba(255,255,255,.92)" }),
        box(7, 18, 86, 57, { fill: "#ffffff", rad: 4, shadow: "0 1.5cqmin 4cqmin rgba(0,0,0,.18)" }),
        txt(11, 23, 78, 14, "{name}", Object.assign({ ff: "poppins", fs: 8, fw: 800, c: "#2d1b4e" }, NAME)),
        txt(11, 37.5, 78, 5, "{title}", { fs: 3.2, fw: 500, c: "#6b5b7a" }),
        txt(11, 42.5, 78, 5, "{org}", { fs: 3.4, fw: 700, c: "#ff6a88" }),
        qr(36.5, 50, 27, { fg: "#2d1b4e", pad: 0 }),
        box(20, 80, 60, 9, { fill: "rgba(255,255,255,.95)", rad: 4.5 }),
        txt(20, 80, 60, 9, "{role}", { ff: "poppins", fs: 4.2, fw: 800, c: "role", up: true, ls: 0.16, fit: true }),
        txt(6, 91, 88, 5, "{venue}", { fs: 2.6, fw: 500, c: "rgba(255,255,255,.92)" }),
      ]),

    T("ocean_wave", "Ocean Wave", "portrait", ["light", "initials"], "a6",
      { color: "#f0f9ff" },
      [
        box(0, 0, 100, 44, { fill: "rgba(14,165,233,.28)", clip: waveClip(86, 6, 1.4, 1.2) }),
        box(0, 0, 100, 40, { grad: "linear-gradient(135deg,#0ea5e9,#0e7490)", clip: waveClip(84, 7, 1.2, 0) }),
        txt(6, 5.5, 88, 6.5, "{event}", { ff: "raleway", fs: 4, fw: 800, c: "#ffffff", fit: true }),
        txt(6, 12.5, 88, 4, "{dates} · {venue}", { fs: 2.6, fw: 500, c: "rgba(255,255,255,.92)" }),
        box(36, 21, 28, 0, { round: true, fill: "#ffffff", sq: true, shadow: "0 0.8cqmin 2.4cqmin rgba(12,74,110,.25)" }),
        txt(36, 21, 28, 19.86, "{initials}", { ff: "raleway", fs: 9, fw: 800, c: "#0e7490", sq: true }),
        txt(6, 45, 88, 12, "{name}", Object.assign({ ff: "raleway", fs: 7.8, fw: 800, c: "#0c4a6e" }, NAME)),
        txt(6, 57, 88, 5, "{title}", { fs: 3.2, fw: 500, c: "#475569" }),
        txt(6, 62, 88, 5, "{org}", { fs: 3.4, fw: 700, c: "#0e7490" }),
        qr(37, 69, 26, { fg: "#0c4a6e", pad: 0 }),
        box(0, 90, 100, 10, { fill: "role" }),
        txt(0, 90, 100, 10, "{role}", { fs: 4.4, fw: 800, c: "roleInk", up: true, ls: 0.2 }),
      ]),

    T("gold_vip", "Gold VIP", "portrait", ["dark", "elegant", "serif"], "a6",
      { color: "#0c0a09", grad: "radial-gradient(90% 60% at 50% 0%, #292524, #0c0a09 70%)" },
      [
        box(4, 3, 92, 94, { fill: "transparent", bw: 0.5, bc: "#d4af37" }),
        box(5.6, 4.2, 88.8, 91.6, { fill: "transparent", bw: 0.2, bc: "rgba(212,175,55,.6)" }),
        txt(10, 8, 80, 6, "{event}", { ff: "playfair", fs: 3.4, fw: 400, it: true, c: "#e7c873", fit: true }),
        box(42, 15, 16, 0.3, { fill: "#d4af37" }),
        txt(10, 23, 80, 8, "{role}", { ff: "playfair", fs: 4.6, fw: 700, c: "#d4af37", up: true, ls: 0.35, fit: true }),
        txt(10, 33, 80, 17, "{name}", Object.assign({ ff: "playfair", fs: 9, fw: 700, c: "#fafaf9" }, NAME)),
        txt(10, 51, 80, 5, "{title}", { ff: "lora", fs: 3.2, fw: 400, it: true, c: "#d6d3d1" }),
        txt(10, 56, 80, 5, "{org}", { fs: 3.1, fw: 600, c: "#e7c873", up: true, ls: 0.12 }),
        qr(36, 65, 28, { fg: "#0c0a09", bgc: "#e7c873", pad: 1.6, rad: 0 }),
        txt(10, 88, 80, 4.5, "№ {no} · {dates}", { ff: "lora", fs: 2.4, fw: 400, c: "#a8a29e" }),
      ]),

    T("academic", "Academic Crest", "portrait", ["light", "serif", "logo"], "a6",
      { color: "#fdfaf3" },
      [
        box(0, 0, 100, 22, { fill: "#7f1d1d" }),
        box(0, 22, 100, 1.2, { fill: "#fbbf24" }),
        txt(6, 2.5, 88, 6.5, "{event}", { ff: "dmserif", fs: 4, fw: 400, c: "#fdf2d0", fit: true }),
        txt(6, 9, 88, 4, "{dates}", { ff: "lora", fs: 2.6, fw: 400, it: true, c: "rgba(253,242,208,.82)" }),
        box(39, 13.5, 22, 0, { round: true, fill: "#fdfaf3", bw: 0.8, bc: "#fbbf24", sq: true }),
        img(42, 15.6, 16, 0, "logo", { sq: true }),
        txt(6, 33, 88, 14, "{name}", Object.assign({ ff: "dmserif", fs: 8.6, fw: 400, c: "#3b0d0d" }, NAME)),
        txt(6, 47.5, 88, 5, "{title}", { ff: "lora", fs: 3.3, fw: 400, it: true, c: "#57534e" }),
        txt(6, 52.5, 88, 5, "{org}", { ff: "lora", fs: 3.5, fw: 700, c: "#7f1d1d" }),
        qr(36, 60, 28, { fg: "#3b0d0d", bgc: "#fdfaf3", pad: 0 }),
        box(15, 85, 70, 8, { fill: "role", clip: "polygon(0 0,100% 0,96% 50%,100% 100%,0 100%,4% 50%)" }),
        txt(15, 85, 70, 8, "{role}", { ff: "dmserif", fs: 4.2, fw: 400, c: "roleInk", up: true, ls: 0.1, fit: true }),
      ]),

    T("health", "Health Summit", "portrait", ["light", "green"], "a6",
      { color: "#f0fdf4", grad: "radial-gradient(60% 40% at 100% 0%, rgba(22,163,74,.18), transparent 70%)" },
      [
        box(6, 5, 10, 0, { fill: "#16a34a", rad: 1.6, sq: true }),
        txt(6, 5, 10, 7.09, "+", { fs: 7, fw: 900, c: "#ffffff", sq: true, lh: 1 }),
        txt(19, 5, 75, 7.1, "{event}", { ff: "nunito", fs: 3.6, fw: 800, c: "#14532d", al: "l", fit: true }),
        txt(6, 14, 88, 4, "{dates} · {venue}", { ff: "nunito", fs: 2.6, fw: 600, c: "#4d7c0f", al: "l" }),
        txt(6, 25, 88, 15, "{name}", Object.assign({ ff: "nunito", fs: 8.6, fw: 900, c: "#052e16", al: "l" }, NAME)),
        txt(6, 40.5, 88, 5, "{title}", { ff: "nunito", fs: 3.4, fw: 600, c: "#3f6212", al: "l" }),
        txt(6, 45.5, 88, 5, "{org}", { ff: "nunito", fs: 3.6, fw: 800, c: "#16a34a", al: "l" }),
        box(6, 55, 88, 30, { fill: "#ffffff", rad: 3, bw: 0.3, bc: "#bbf7d0" }),
        qr(10, 58, 33, { fg: "#052e16", pad: 0 }),
        txt(47, 59, 44, 7, "{role}", { ff: "nunito", fs: 4.2, fw: 900, c: "role", al: "l", up: true, fit: true }),
        txt(47, 66, 44, 5, "Badge #{no}", { ff: "nunito", fs: 2.8, fw: 700, c: "#4d7c0f", al: "l" }),
        txt(47, 71, 44, 10, "Scan at the door to check in", { ff: "nunito", fs: 2.6, fw: 600, c: "#65a30d", al: "l", va: "t" }),
        box(0, 91, 100, 9, { fill: "#16a34a" }),
        txt(0, 91, 100, 9, "Event code {code}", { ff: "nunito", fs: 3, fw: 800, c: "#ffffff", ls: 0.08 }),
      ]),

    T("festival", "Festival Confetti", "portrait", ["fun", "colourful"], "a6",
      { color: "#fde047", grad: "radial-gradient(circle at 12% 18%, #f43f5e 0 2.2cqmin, transparent 2.4cqmin), radial-gradient(circle at 88% 9%, #22d3ee 0 3cqmin, transparent 3.2cqmin), radial-gradient(circle at 93% 64%, #8b5cf6 0 2.5cqmin, transparent 2.7cqmin), radial-gradient(circle at 7% 72%, #10b981 0 3cqmin, transparent 3.2cqmin), radial-gradient(circle at 80% 86%, #f97316 0 1.8cqmin, transparent 2cqmin), radial-gradient(circle at 22% 88%, #ec4899 0 1.4cqmin, transparent 1.6cqmin)" },
      [
        txt(6, 5, 88, 11, "{event}", { ff: "archivo", fs: 5.6, fw: 400, c: "#111111", up: true, lh: 1, fit: true }),
        txt(6, 16.5, 88, 4.5, "{dates}", { ff: "poppins", fs: 2.8, fw: 700, c: "#111111" }),
        box(8, 25, 84, 40, { fill: "#111111", rad: 4, r: -3 }),
        txt(12, 28, 76, 16, "{first}", Object.assign({ ff: "archivo", fs: 11, fw: 400, c: "#fde047", r: -3 }, ONE)),
        txt(12, 44, 76, 7, "{last}", Object.assign({ ff: "poppins", fs: 4.6, fw: 800, c: "#ffffff", r: -3 }, ONE)),
        txt(12, 52, 76, 10, "{org}", { ff: "poppins", fs: 3.2, fw: 600, c: "#fde68a", r: -3 }),
        qr(36, 69, 28, { fg: "#111111", pad: 1.5, rad: 2 }),
        box(0, 92, 100, 8, { fill: "#111111" }),
        txt(0, 92, 100, 8, "{role}", { ff: "archivo", fs: 4, fw: 400, c: "#fde047", up: true, ls: 0.2 }),
      ]),

    T("glass", "Frosted Glass", "portrait", ["photo", "gradient"], "a6",
      { color: "#334155", grad: "linear-gradient(160deg,#6366f1,#ec4899)", img: "background", blur: 6, ov: "#000000", ovop: 0.22 },
      [
        txt(6, 5, 88, 6.5, "{event}", { ff: "poppins", fs: 3.6, fw: 800, c: "#ffffff", up: true, ls: 0.08, sh: true, fit: true }),
        box(7, 15, 86, 72, { fill: "rgba(255,255,255,.8)", rad: 4, bw: 0.3, bc: "rgba(255,255,255,.95)" }),
        txt(11, 19.5, 78, 14, "{name}", Object.assign({ ff: "poppins", fs: 8, fw: 800, c: "#111827" }, NAME)),
        txt(11, 34, 78, 5, "{title}", { fs: 3.2, fw: 500, c: "#374151" }),
        txt(11, 39, 78, 5, "{org}", { fs: 3.4, fw: 700, c: "#4f46e5" }),
        qr(35, 47, 30, { fg: "#111827", pad: 1.5, rad: 2 }),
        box(25, 74, 50, 8, { fill: "role", rad: 4 }),
        txt(25, 74, 50, 8, "{role}", { fs: 3.8, fw: 800, c: "roleInk", up: true, ls: 0.15, fit: true }),
        txt(6, 90, 88, 5, "{dates} · {venue}", { fs: 2.6, fw: 600, c: "#ffffff", sh: true }),
      ]),

    T("initials", "Initials Circle", "portrait", ["light", "initials"], "a6",
      { color: "#ffffff" },
      [
        box(0, 0, 100, 40, { fill: "role" }),
        box(0, 0, 100, 40, { grad: "linear-gradient(160deg, rgba(255,255,255,.22), rgba(0,0,0,.2))" }),
        txt(6, 5, 88, 5.5, "{event}", { fs: 3.2, fw: 700, c: "roleInk", up: true, ls: 0.1, fit: true }),
        txt(6, 10.5, 88, 4, "{dates}", { fs: 2.5, fw: 500, c: "roleInk", op: 0.85 }),
        box(30, 22, 40, 0, { round: true, fill: "#ffffff", sq: true, shadow: "0 1cqmin 3cqmin rgba(0,0,0,.22)" }),
        txt(30, 22, 40, 28.38, "{initials}", { ff: "montserrat", fs: 13, fw: 800, c: "role", sq: true }),
        txt(6, 54, 88, 12, "{name}", Object.assign({ ff: "montserrat", fs: 7.6, fw: 800, c: "#111827" }, NAME)),
        txt(6, 66, 88, 5, "{title}", { fs: 3.2, fw: 500, c: "#6b7280" }),
        txt(6, 71, 88, 5, "{org}", { fs: 3.4, fw: 700, c: "#111827" }),
        qr(39, 78, 22, { fg: "#111827", pad: 0 }),
        txt(6, 95, 88, 4.5, "{role} · #{no}", { fs: 2.4, fw: 700, c: "role", up: true, ls: 0.15 }),
      ]),

    T("sidebar", "Side Ribbon", "portrait", ["light", "bold"], "a6",
      { color: "#ffffff" },
      [
        box(0, 0, 22, 100, { fill: "role" }),
        txt(-59.5, 42.2, 141, 15.6, "{role}", { ff: "bebas", fs: 9, fw: 400, c: "roleInk", ls: 0.2, r: -90, fit: true, nowrap: true }),
        txt(28, 6, 66, 5, "{event}", { fs: 3, fw: 700, c: "#6b7280", al: "l", up: true, ls: 0.12, fit: true }),
        txt(28, 11, 66, 4, "{dates}", { fs: 2.6, fw: 500, c: "#9ca3af", al: "l" }),
        txt(28, 24, 66, 16, "{first}", Object.assign({ ff: "oswald", fs: 11, fw: 700, c: "#111827", al: "l", va: "b", up: true }, ONE)),
        txt(28, 40, 66, 7, "{last}", Object.assign({ ff: "oswald", fs: 5.6, fw: 500, c: "#374151", al: "l", va: "t", up: true }, ONE)),
        box(28, 49, 12, 0.8, { fill: "role" }),
        txt(28, 51.5, 66, 5, "{title}", { fs: 3.2, fw: 500, c: "#4b5563", al: "l" }),
        txt(28, 56.5, 66, 5, "{org}", { fs: 3.4, fw: 700, c: "#111827", al: "l" }),
        qr(28, 67, 32, { fg: "#111827", pad: 0 }),
        txt(64, 84, 30, 5, "#{no}", { ff: "mono", fs: 2.8, fw: 500, c: "#9ca3af", al: "r" }),
      ]),

    T("ticket_stub", "Ticket Stub", "portrait", ["warm", "retro"], "a6",
      { color: "#fff7ed", grad: "repeating-linear-gradient(0deg, transparent 0 3.2cqmin, rgba(234,88,12,.05) 3.2cqmin 3.4cqmin)" },
      [
        box(0, 0, 100, 9, { fill: "#ea580c" }),
        txt(6, 0, 88, 9, "{event}", { ff: "oswald", fs: 3.8, fw: 600, c: "#ffffff", al: "l", up: true, ls: 0.1, fit: true }),
        txt(6, 12, 40, 4.5, "ADMIT ONE", { ff: "oswald", fs: 3, fw: 600, c: "#ea580c", al: "l", ls: 0.3 }),
        txt(48, 12, 46, 4.5, "{dates}", { ff: "oswald", fs: 2.8, fw: 500, c: "#9a3412", al: "r" }),
        txt(6, 21, 88, 15, "{name}", Object.assign({ ff: "oswald", fs: 9, fw: 700, c: "#431407", al: "l", up: true }, NAME)),
        txt(6, 36.5, 88, 5, "{title}", { fs: 3.2, fw: 500, c: "#7c2d12", al: "l" }),
        txt(6, 41.5, 88, 5, "{org}", { fs: 3.4, fw: 700, c: "#ea580c", al: "l" }),
        txt(6, 49, 40, 4, "SEAT / NO.", { ff: "oswald", fs: 2.4, fw: 500, c: "#9a3412", al: "l", ls: 0.2, keep: true }),
        txt(6, 53, 40, 7, "{no}", { ff: "mono", fs: 5, fw: 800, c: "#431407", al: "l" }),
        txt(50, 49, 44, 4, "PASS", { ff: "oswald", fs: 2.4, fw: 500, c: "#9a3412", al: "r", ls: 0.2 }),
        txt(50, 53, 44, 7, "{role}", { ff: "oswald", fs: 4.6, fw: 700, c: "role", al: "r", up: true, fit: true }),
        box(4, 64, 92, 0.4, { grad: "repeating-linear-gradient(90deg,#ea580c 0 2%,transparent 2% 4%)" }),
        box(-3, 62.1, 6, 0, { round: true, fill: "#ffffff", sq: true }),
        box(97, 62.1, 6, 0, { round: true, fill: "#ffffff", sq: true }),
        qr(33, 68, 34, { fg: "#431407", bgc: "#fff7ed", pad: 0 }),
        txt(6, 94, 88, 4.5, "{venue}", { fs: 2.4, fw: 500, c: "#9a3412" }),
      ]),

    T("lanyard_tall", "Tall Lanyard", "portrait", ["light", "gradient"], "in4x6",
      { color: "#ffffff" },
      [
        box(40, 2.5, 20, 2.2, { fill: "#e5e7eb", rad: 1.1 }),
        box(0, 8, 100, 24, { grad: "linear-gradient(135deg,#7c3aed,#db2777)" }),
        txt(6, 10, 88, 14, "{event}", { ff: "poppins", fs: 5, fw: 800, c: "#ffffff", fit: true }),
        txt(6, 24, 88, 6, "{dates} · {venue}", { fs: 2.8, fw: 500, c: "rgba(255,255,255,.92)" }),
        txt(6, 36, 88, 15, "{first}", Object.assign({ ff: "poppins", fs: 13, fw: 800, c: "#111827" }, ONE)),
        txt(6, 51, 88, 6.5, "{last}", Object.assign({ ff: "poppins", fs: 6, fw: 600, c: "#374151" }, ONE)),
        txt(6, 58.5, 88, 4.5, "{title}", { fs: 3.4, fw: 500, c: "#6b7280" }),
        txt(6, 63, 88, 4.5, "{org}", { fs: 3.6, fw: 700, c: "#7c3aed" }),
        qr(35, 69, 30, { fg: "#111827", pad: 0 }),
        box(0, 90, 100, 10, { fill: "role" }),
        txt(0, 90, 100, 10, "{role}", { ff: "poppins", fs: 5, fw: 800, c: "roleInk", up: true, ls: 0.25 }),
      ]),

    T("hexagon", "Hexagon", "portrait", ["dark", "geometric"], "a6",
      { color: "#111827" },
      [
        box(-8, -3, 30, 0, { fill: "role", clip: HEX, op: 0.9, sq: true }),
        box(18, 8, 18, 0, { fill: "#374151", clip: HEX, sq: true }),
        box(78, -4, 28, 0, { fill: "#1f2937", clip: HEX, sq: true }),
        box(70, 12, 16, 0, { fill: "role", clip: HEX, op: 0.5, sq: true }),
        txt(6, 26, 88, 6, "{event}", { ff: "montserrat", fs: 3.4, fw: 700, c: "#9ca3af", al: "l", up: true, ls: 0.12, fit: true }),
        txt(6, 33, 88, 14, "{name}", Object.assign({ ff: "montserrat", fs: 8.6, fw: 800, c: "#f9fafb", al: "l" }, NAME)),
        txt(6, 48, 88, 5, "{title}", { fs: 3.2, fw: 500, c: "#d1d5db", al: "l" }),
        txt(6, 53, 88, 5, "{org}", { fs: 3.4, fw: 700, c: "role", al: "l" }),
        box(26, 59, 48, 0, { fill: "#f9fafb", clip: HEX, sq: true }),
        qr(37.5, 67.2, 25, { fg: "#111827", bgc: "#f9fafb", pad: 0, rad: 0 }),
        txt(6, 94, 88, 5, "{role} · #{no}", { fs: 2.8, fw: 700, c: "#9ca3af", up: true, ls: 0.15 }),
      ]),

    T("paper_craft", "Paper Craft", "portrait", ["warm", "serif", "handmade"], "a6",
      { color: "#f5efe0", grad: "radial-gradient(#e2d5b9 0.15cqmin, transparent 0.22cqmin) 0 0/2.4cqmin 2.4cqmin" },
      [
        box(0, 0, 100, 26, { fill: "#2f4858", clip: tornClip(86, 10) }),
        txt(6, 4, 88, 8, "{event}", { ff: "dmserif", fs: 4.6, fw: 400, c: "#f5efe0", fit: true }),
        txt(6, 12, 88, 5, "{dates}", { ff: "lora", fs: 2.8, fw: 400, it: true, c: "#d6cfbf" }),
        txt(6, 31, 88, 15, "{name}", Object.assign({ ff: "dmserif", fs: 9, fw: 400, c: "#2f4858" }, NAME)),
        txt(6, 46.5, 88, 5, "{title}", { ff: "lora", fs: 3.3, fw: 400, it: true, c: "#6b5e4b" }),
        txt(6, 51.5, 88, 5, "{org}", { ff: "lora", fs: 3.4, fw: 700, c: "#8a5a44" }),
        box(30, 60, 40, 0, { fill: "#fffdf8", sq: true, r: 2, shadow: "0 0.6cqmin 1.6cqmin rgba(0,0,0,.16)" }),
        qr(35, 62.4, 30, { fg: "#2f4858", bgc: "#fffdf8", pad: 0, rad: 0, r: 2 }),
        box(36, 57.5, 28, 5, { fill: "rgba(255,255,255,.6)", r: -5 }),
        txt(6, 90, 88, 8, "{role}", { ff: "caveat", fs: 6, fw: 700, c: "role" }),
      ]),

    T("bauhaus", "Bauhaus", "portrait", ["geometric", "colourful"], "a6",
      { color: "#f4f1ea" },
      [
        box(60, -8, 52, 0, { round: true, fill: "#e63946", sq: true }),
        box(-10, 62, 40, 0, { fill: "#1d3557", sq: true, clip: "polygon(50% 0,100% 100%,0 100%)" }),
        box(72, 72, 22, 0, { fill: "#f4a261", sq: true }),
        box(6, 6, 6, 0, { round: true, fill: "#1d3557", sq: true }),
        txt(6, 13, 56, 9, "{event}", { ff: "archivo", fs: 4, fw: 400, c: "#1d3557", al: "l", up: true, lh: 1, fit: true }),
        txt(6, 23, 56, 4.5, "{dates}", { fs: 2.8, fw: 700, c: "#e63946", al: "l" }),
        txt(6, 33, 88, 15, "{first}", Object.assign({ ff: "archivo", fs: 11, fw: 400, c: "#111111", al: "l", up: true }, ONE)),
        txt(6, 48, 88, 7, "{last}", Object.assign({ ff: "archivo", fs: 5, fw: 400, c: "#111111", al: "l", up: true }, ONE)),
        txt(6, 56, 60, 5, "{org}", { fs: 3.4, fw: 700, c: "#1d3557", al: "l" }),
        qr(38, 64, 26, { fg: "#111111", pad: 1.2, rad: 0 }),
        txt(30, 90, 66, 6, "{role}", { ff: "archivo", fs: 4.4, fw: 400, c: "#e63946", al: "r", up: true, fit: true }),
      ]),

    T("pastel", "Pastel Blobs", "portrait", ["fun", "soft"], "a6",
      { color: "#fdf4ff" },
      [
        box(-15, -8, 60, 0, { round: true, fill: "#fbcfe8", sq: true }),
        box(60, -5, 50, 0, { round: true, fill: "#c7d2fe", sq: true }),
        box(55, 80, 60, 0, { round: true, fill: "#bbf7d0", sq: true }),
        box(-20, 85, 45, 0, { round: true, fill: "#fde68a", sq: true }),
        txt(6, 7.5, 88, 6.5, "{event}", { ff: "nunito", fs: 4, fw: 900, c: "#6d28d9", fit: true }),
        txt(6, 14, 88, 4.5, "{dates}", { ff: "nunito", fs: 2.8, fw: 700, c: "#9d174d" }),
        box(8, 22, 84, 50, { fill: "rgba(255,255,255,.88)", rad: 5 }),
        txt(12, 26, 76, 14, "{name}", Object.assign({ ff: "nunito", fs: 8.4, fw: 900, c: "#3b0764" }, NAME)),
        txt(12, 40.5, 76, 5, "{title}", { ff: "nunito", fs: 3.2, fw: 600, c: "#6b21a8" }),
        txt(12, 45.5, 76, 5, "{org}", { ff: "nunito", fs: 3.4, fw: 800, c: "#db2777" }),
        qr(37, 52, 26, { fg: "#3b0764", pad: 0 }),
        box(25, 77, 50, 8, { fill: "role", rad: 4 }),
        txt(25, 77, 50, 8, "{role}", { ff: "nunito", fs: 3.8, fw: 900, c: "roleInk", up: true, ls: 0.12, fit: true }),
      ]),

    T("mono_photo", "Duotone Photo", "portrait", ["photo", "bold"], "a6",
      { color: "#111111", grad: "linear-gradient(160deg,#374151,#111827)", img: "background", gray: true, ov: "role", ovop: 0.55 },
      [
        box(0, 58, 100, 42, { grad: "linear-gradient(180deg, transparent, rgba(0,0,0,.78) 45%)" }),
        txt(6, 5.5, 88, 6.5, "{event}", { ff: "oswald", fs: 4, fw: 600, c: "#ffffff", al: "l", up: true, ls: 0.1, sh: true, fit: true }),
        txt(6, 12, 88, 4.5, "{dates}", { ff: "oswald", fs: 2.8, fw: 500, c: "rgba(255,255,255,.88)", al: "l" }),
        txt(4, 24, 92, 28, "{role}", { ff: "bebas", fs: 22, fw: 400, c: "rgba(255,255,255,.2)", al: "l", up: true, fit: true, nowrap: true }),
        txt(6, 59, 88, 14, "{name}", Object.assign({ ff: "oswald", fs: 9, fw: 700, c: "#ffffff", al: "l", up: true }, NAME)),
        txt(6, 73.5, 88, 5, "{title} · {org}", { fs: 3.1, fw: 500, c: "rgba(255,255,255,.88)", al: "l" }),
        qr(68, 78, 26, { fg: "#111111", pad: 1.2, rad: 1 }),
        txt(6, 85, 58, 6, "{role}", { ff: "oswald", fs: 4.6, fw: 700, c: "#ffffff", al: "l", up: true, ls: 0.15, fit: true }),
        txt(6, 91, 58, 4.5, "#{no}", { ff: "mono", fs: 2.6, fw: 500, c: "rgba(255,255,255,.72)", al: "l" }),
      ]),

    T("spotlight", "Speaker Spotlight", "portrait", ["dark", "elegant"], "a6",
      { color: "#09090b", grad: "radial-gradient(70% 45% at 50% 32%, rgba(255,255,255,.16), transparent 70%), conic-gradient(from 200deg at 50% -10%, transparent 0 40%, rgba(250,204,21,.13) 46%, transparent 54%)" },
      [
        txt(6, 6, 88, 5, "{event}", { ff: "raleway", fs: 3, fw: 700, c: "#a1a1aa", up: true, ls: 0.3, fit: true }),
        txt(6, 19, 88, 7, "{role}", { ff: "raleway", fs: 4.4, fw: 800, c: "#facc15", up: true, ls: 0.4, fit: true }),
        txt(6, 27, 88, 17, "{name}", Object.assign({ ff: "playfair", fs: 9.6, fw: 700, c: "#fafafa" }, NAME)),
        box(42, 46, 16, 0.3, { fill: "#facc15" }),
        txt(6, 49, 88, 5, "{title}", { ff: "raleway", fs: 3.2, fw: 500, c: "#d4d4d8" }),
        txt(6, 54, 88, 5, "{org}", { ff: "raleway", fs: 3.4, fw: 700, c: "#fafafa" }),
        qr(36, 63, 28, { fg: "#09090b", bgc: "#fafafa", pad: 1.5, rad: 1.5 }),
        txt(6, 88, 88, 5, "{dates} · {venue}", { ff: "raleway", fs: 2.6, fw: 500, c: "#71717a" }),
      ]),

    T("volunteer", "Big Role (Crew)", "portrait", ["bold", "crew"], "a6",
      { color: "#facc15" },
      [
        txt(4, 3, 92, 25, "{role}", { ff: "anton", fs: 16, fw: 400, c: "#111111", up: true, lh: 0.95, fit: true, nowrap: true }),
        box(0, 29, 100, 1, { fill: "#111111" }),
        txt(6, 33, 88, 15, "{first}", Object.assign({ ff: "anton", fs: 12, fw: 400, c: "#111111", up: true }, ONE)),
        txt(6, 48, 88, 6.5, "{last}", Object.assign({ ff: "poppins", fs: 4.6, fw: 700, c: "#111111" }, ONE)),
        txt(6, 55, 88, 5, "{event}", { ff: "poppins", fs: 3, fw: 600, c: "#422006", fit: true }),
        qr(34, 62, 32, { fg: "#111111", bgc: "#facc15", pad: 0, rad: 0 }),
        box(0, 88, 100, 12, { fill: "#111111" }),
        txt(6, 88, 88, 12, "Ask me anything · #{no}", { ff: "poppins", fs: 3.4, fw: 700, c: "#facc15", keep: true }),
      ]),

    // ───────────────────────── LANDSCAPE ─────────────────────────
    T("boarding_pass", "Boarding Pass", "landscape", ["fun", "travel"], "in4x3",
      { color: "#ffffff" },
      [
        box(0, 0, 100, 18, { fill: "#1e3a8a" }),
        txt(4, 0, 62, 18, "✈  {event}", { ff: "space", fs: 4.6, fw: 700, c: "#ffffff", al: "l", fit: true }),
        txt(64, 0, 32, 18, "BOARDING PASS", { ff: "mono", fs: 3, fw: 800, c: "#93c5fd", al: "r", ls: 0.08 }),
        txt(4, 22, 30, 5, "PASSENGER", { ff: "mono", fs: 2.6, fw: 500, c: "#64748b", al: "l", ls: 0.15 }),
        txt(4, 27, 64, 14, "{name}", Object.assign({ ff: "space", fs: 7.4, fw: 700, c: "#0f172a", al: "l", up: true }, NAME)),
        txt(4, 44, 30, 5, "FROM", { ff: "mono", fs: 2.6, fw: 500, c: "#64748b", al: "l", ls: 0.15 }),
        txt(4, 49, 30, 10, "{org}", { ff: "space", fs: 3.6, fw: 700, c: "#0f172a", al: "l", va: "t", fit: true }),
        txt(36, 44, 30, 5, "CLASS", { ff: "mono", fs: 2.6, fw: 500, c: "#64748b", al: "l", ls: 0.15 }),
        txt(36, 49, 32, 10, "{role}", { ff: "space", fs: 4.2, fw: 700, c: "role", al: "l", va: "t", up: true, fit: true }),
        txt(4, 62, 30, 5, "DATE", { ff: "mono", fs: 2.6, fw: 500, c: "#64748b", al: "l", ls: 0.15 }),
        txt(4, 67, 30, 8, "{date}", { ff: "space", fs: 3.4, fw: 700, c: "#0f172a", al: "l", va: "t", fit: true }),
        txt(36, 62, 30, 5, "SEAT", { ff: "mono", fs: 2.6, fw: 500, c: "#64748b", al: "l", ls: 0.15 }),
        txt(36, 67, 32, 8, "{no}", { ff: "mono", fs: 4, fw: 800, c: "#0f172a", al: "l", va: "t" }),
        box(71, 18, 0.4, 77, { grad: "repeating-linear-gradient(180deg,#94a3b8 0 3%,transparent 3% 6%)" }),
        qr(75, 24, 21, { fg: "#0f172a", pad: 0 }),
        txt(72, 60, 26, 5, "GATE", { ff: "mono", fs: 2.6, fw: 500, c: "#64748b", ls: 0.15 }),
        txt(72, 65, 26, 9, "{code}", { ff: "mono", fs: 4.6, fw: 800, c: "#1e3a8a" }),
        box(0, 95, 100, 5, { fill: "role" }),
      ]),

    T("landscape_classic", "Landscape Classic", "landscape", ["light"], "in4x3",
      { color: "#ffffff" },
      [
        box(0, 0, 6, 100, { fill: "role" }),
        txt(12, 7, 56, 7, "{event}", { ff: "montserrat", fs: 3.8, fw: 800, c: "#111827", al: "l", up: true, fit: true }),
        txt(12, 15, 56, 5, "{dates} · {venue}", { fs: 2.8, fw: 500, c: "#6b7280", al: "l" }),
        txt(12, 30, 56, 20, "{name}", Object.assign({ ff: "montserrat", fs: 8, fw: 800, c: "#111827", al: "l" }, NAME)),
        txt(12, 52, 56, 6, "{title}", { fs: 3.6, fw: 500, c: "#4b5563", al: "l" }),
        txt(12, 59, 56, 6, "{org}", { fs: 3.8, fw: 700, c: "role", al: "l" }),
        box(12, 78, 32, 10, { fill: "role", rad: 5 }),
        txt(12, 78, 32, 10, "{role}", { fs: 3.8, fw: 800, c: "roleInk", up: true, ls: 0.12, fit: true }),
        qr(70, 18, 26, { fg: "#111827", pad: 0 }),
        txt(70, 58, 26, 5, "#{no}", { ff: "mono", fs: 2.8, fw: 500, c: "#9ca3af" }),
      ]),

    T("landscape_photo", "Landscape Photo", "landscape", ["photo", "dark"], "in4x3",
      { color: "#0f172a" },
      [
        box(0, 0, 45, 100, { grad: "linear-gradient(160deg,#6366f1,#0ea5e9)" }),
        img(0, 0, 45, 100, "background", { fit: "cover" }),
        box(0, 0, 45, 100, { grad: "linear-gradient(90deg, transparent 55%, #0f172a)" }),
        txt(50, 8, 46, 7, "{event}", { ff: "space", fs: 3.4, fw: 700, c: "#93c5fd", al: "l", up: true, ls: 0.08, fit: true }),
        txt(50, 22, 46, 22, "{name}", Object.assign({ ff: "space", fs: 7.4, fw: 700, c: "#ffffff", al: "l" }, NAME)),
        txt(50, 45, 46, 6, "{title}", { fs: 3.2, fw: 500, c: "#cbd5e1", al: "l" }),
        txt(50, 51, 46, 6, "{org}", { fs: 3.4, fw: 700, c: "#a5b4fc", al: "l" }),
        qr(50, 63, 18, { fg: "#0f172a", pad: 1.2, rad: 1.5 }),
        txt(71, 65, 26, 9, "{role}", { fs: 3.6, fw: 800, c: "#ffffff", al: "l", up: true, fit: true }),
        txt(71, 75, 26, 5, "#{no}", { ff: "mono", fs: 2.6, fw: 500, c: "#94a3b8", al: "l" }),
      ]),

    T("a6_landscape_conf", "Conference Wide", "landscape", ["light", "teal"], "a6_h",
      { color: "#ffffff" },
      [
        box(0, 0, 36, 100, { grad: "linear-gradient(180deg,#0f766e,#134e4a)" }),
        txt(4, 6, 28, 13, "{event}", { ff: "montserrat", fs: 4.2, fw: 800, c: "#ffffff", al: "l", fit: true }),
        txt(4, 20, 28, 6, "{dates}", { fs: 2.8, fw: 500, c: "#99f6e4", al: "l" }),
        qr(6, 36, 24, { fg: "#134e4a", pad: 1.5, rad: 2 }),
        txt(4, 76, 28, 6, "#{no}", { ff: "mono", fs: 3, fw: 500, c: "#99f6e4" }),
        txt(4, 84, 28, 9, "{venue}", { fs: 2.6, fw: 500, c: "#ccfbf1", fit: true }),
        txt(42, 12, 54, 26, "{name}", Object.assign({ ff: "montserrat", fs: 10, fw: 800, c: "#111827", al: "l" }, NAME)),
        txt(42, 41, 54, 7, "{title}", { fs: 4, fw: 500, c: "#4b5563", al: "l" }),
        txt(42, 49, 54, 7, "{org}", { fs: 4.2, fw: 700, c: "#0f766e", al: "l" }),
        box(42, 70, 40, 12, { fill: "role", rad: 6 }),
        txt(42, 70, 40, 12, "{role}", { fs: 4.6, fw: 800, c: "roleInk", up: true, ls: 0.15, fit: true }),
      ]),

    // ───────────────────────── ID CARD (CR80) ─────────────────────────
    T("id_card", "Staff ID Card", "card", ["card", "initials", "logo"], "cr80_v",
      { color: "#ffffff" },
      [
        box(0, 0, 100, 22, { fill: "#111827" }),
        box(0, 22, 100, 1.5, { fill: "role" }),
        img(6, 4, 40, 14, "logo"),
        txt(48, 4, 46, 14, "{event}", { fs: 3.6, fw: 700, c: "#ffffff", al: "r", fit: true }),
        box(30, 27, 40, 0, { round: true, fill: "role", sq: true }),
        txt(30, 27, 40, 25.23, "{initials}", { ff: "montserrat", fs: 13, fw: 800, c: "roleInk", sq: true }),
        txt(5, 55, 90, 11, "{name}", Object.assign({ fs: 8, fw: 800, c: "#111827" }, NAME)),
        txt(5, 66, 90, 5, "{title}", { fs: 4, fw: 500, c: "#6b7280" }),
        txt(5, 71, 90, 5, "{org}", { fs: 4, fw: 700, c: "#111827" }),
        qr(6, 78, 17, { fg: "#111827", pad: 0 }),
        txt(28, 78.5, 66, 5.5, "{role}", { fs: 4.4, fw: 800, c: "role", al: "l", up: true, fit: true }),
        txt(28, 84.5, 66, 4.5, "ID {no}", { ff: "mono", fs: 3.4, fw: 500, c: "#9ca3af", al: "l" }),
        box(0, 96, 100, 4, { fill: "#111827" }),
      ]),

    T("access_card", "Access Card", "card", ["card", "dark"], "cr80_h",
      { color: "#0f172a", grad: "linear-gradient(135deg,#1e293b,#0f172a 60%,#312e81)" },
      [
        txt(6, 6, 62, 11, "{event}", { ff: "space", fs: 4.6, fw: 700, c: "#ffffff", al: "l", fit: true }),
        box(6, 24, 13, 15, { grad: "linear-gradient(135deg,#fde68a,#d4a017 50%,#a16207)", rad: 2 }),
        box(6, 24, 13, 15, { grad: "linear-gradient(90deg, transparent 32%, rgba(0,0,0,.25) 32% 34%, transparent 34% 66%, rgba(0,0,0,.25) 66% 68%, transparent 68%), linear-gradient(0deg, transparent 45%, rgba(0,0,0,.25) 45% 50%, transparent 50%)", rad: 2 }),
        txt(6, 45, 64, 15, "{name}", Object.assign({ ff: "space", fs: 9, fw: 700, c: "#ffffff", al: "l", up: true, ls: 0.03 }, NAME)),
        txt(6, 61, 64, 8, "{org}", { fs: 4.6, fw: 500, c: "#c7d2fe", al: "l" }),
        box(0, 80, 100, 20, { fill: "role" }),
        txt(6, 80, 60, 20, "{role}", { ff: "space", fs: 7, fw: 700, c: "roleInk", al: "l", up: true, ls: 0.15, fit: true }),
        qr(74, 8, 20, { fg: "#0f172a", pad: 1.5, rad: 2 }),
        txt(66, 80, 30, 20, "#{no}", { ff: "mono", fs: 5, fw: 500, c: "roleInk", al: "r" }),
      ]),

    T("compact_3x4", "Compact Pocket", "portrait", ["light", "small"], "in3x4",
      { color: "#ffffff" },
      [
        box(0, 0, 100, 14, { fill: "role" }),
        txt(5, 0, 90, 14, "{event}", { fs: 3.6, fw: 800, c: "roleInk", up: true, ls: 0.06, fit: true }),
        txt(5, 19, 90, 17, "{first}", Object.assign({ ff: "poppins", fs: 12, fw: 800, c: "#111827" }, ONE)),
        txt(5, 36, 90, 8, "{last}", Object.assign({ ff: "poppins", fs: 5.6, fw: 600, c: "#374151" }, ONE)),
        txt(5, 45, 90, 6, "{org}", { fs: 3.8, fw: 700, c: "role" }),
        qr(33, 54, 34, { fg: "#111827", pad: 0 }),
        txt(5, 83, 90, 6, "{role}", { fs: 4, fw: 800, c: "#111827", up: true, ls: 0.15 }),
        txt(5, 90, 90, 5, "{dates}", { fs: 3, fw: 500, c: "#6b7280" }),
      ]),
  ];

  const byKey = Object.fromEntries(LIST.map(t => [t.key, t]));

  window.KKBadgeTemplates = {
    LIST,
    CATEGORIES: [
      { key: "all", label: "All" },
      { key: "portrait", label: "Lanyard" },
      { key: "landscape", label: "Landscape" },
      { key: "card", label: "ID card" },
      { key: "photo", label: "With photo", tag: true },
    ],
    byKey: k => byKey[k] || null,
    first: () => LIST[0],
  };
})();
