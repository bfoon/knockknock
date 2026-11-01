/* ==========================================================================
   KnockKnock · Attendance badges · renderer  (window.KKBadge)
   --------------------------------------------------------------------------
   One function draws a badge from a layout JSON + one attendee. The designer,
   the template gallery and the print sheet all call it, so the preview is
   exactly what prints.

   Layout JSON
     { v:1, size:"a6", w:105, h:148,              // millimetres
       bg:{ color, grad, img, fit, px, py, op, blur, gray, ov, ovop },
       roles:{ field, fallback, colors:{ "Speaker":"#e11d48", … } },
       els:[ element, … ] }                        // painted in order

   Element (all positions are % of the badge; font sizes are cqmin, i.e. %
   of the badge's SHORTER side, so a design scales with the badge)
     common  id t x y w h r(otate) op(acity) hide lock sq(uare lock) name
     text    txt fs fw ff c al(l|c|r) va(t|m|b) up it ls lh fit nowrap
             bgc rad pad bw bc tsh sh keep(=show even when empty)
     qr      mode(ticket|vcard|event|checkin|custom) data fg bgc pad rad
             ec(L|M|Q|H) dots logo
     image   src(background|cover|logo|asset:<id>) fit rad round bw bc gray
     shape   fill grad rad round bw bc bs clip shadow

   Colours may be "role" (the attendee's role colour), "roleInk" (black or
   white, whichever reads on the role colour) and any CSS colour. Gradients
   may contain {role}.

   Text tokens: {name} {first} {last} {initials} {email} {phone} {org}
   {title} {dept} {country} {role} {no} {event} {date} {dates} {time}
   {venue} {code} and {f:<question id>} for any registration answer.
   ========================================================================== */
(function () {
  "use strict";

  const SIZES = {
    a6:     { label: "A6 lanyard · 105 × 148 mm",     w: 105,   h: 148 },
    in4x6:  { label: "4 × 6 in lanyard · 102 × 152 mm", w: 101.6, h: 152.4 },
    in3x4:  { label: "3 × 4 in · 76 × 102 mm",        w: 76.2,  h: 101.6 },
    a7:     { label: "A7 · 74 × 105 mm",              w: 74,    h: 105 },
    cr80_v: { label: "ID card portrait · 54 × 86 mm", w: 54,    h: 85.6 },
    cr80_h: { label: "ID card landscape · 86 × 54 mm", w: 85.6, h: 54 },
    in4x3:  { label: "4 × 3 in landscape · 102 × 76 mm", w: 101.6, h: 76.2 },
    a6_h:   { label: "A6 landscape · 148 × 105 mm",   w: 148,   h: 105 },
    custom: { label: "Custom size…",                  w: 90,    h: 120 },
  };

  const FONTS = {
    inter:      { label: "Inter",            css: "'Inter', system-ui, sans-serif",            g: "Inter:wght@400;500;600;700;800;900" },
    poppins:    { label: "Poppins",          css: "'Poppins', system-ui, sans-serif",          g: "Poppins:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400" },
    montserrat: { label: "Montserrat",       css: "'Montserrat', system-ui, sans-serif",       g: "Montserrat:wght@400;500;600;700;800;900" },
    raleway:    { label: "Raleway",          css: "'Raleway', system-ui, sans-serif",          g: "Raleway:wght@400;500;600;700;800;900" },
    space:      { label: "Space Grotesk",    css: "'Space Grotesk', system-ui, sans-serif",    g: "Space+Grotesk:wght@400;500;600;700" },
    nunito:     { label: "Nunito",           css: "'Nunito', system-ui, sans-serif",           g: "Nunito:wght@400;600;700;800;900" },
    oswald:     { label: "Oswald",           css: "'Oswald', 'Arial Narrow', sans-serif",      g: "Oswald:wght@400;500;600;700" },
    bebas:      { label: "Bebas Neue",       css: "'Bebas Neue', 'Arial Narrow', sans-serif",  g: "Bebas+Neue" },
    anton:      { label: "Anton",            css: "'Anton', 'Arial Narrow', sans-serif",       g: "Anton" },
    archivo:    { label: "Archivo Black",    css: "'Archivo Black', 'Arial Black', sans-serif", g: "Archivo+Black" },
    playfair:   { label: "Playfair Display", css: "'Playfair Display', Georgia, serif",        g: "Playfair+Display:ital,wght@0,400;0,600;0,700;0,900;1,400;1,700" },
    dmserif:    { label: "DM Serif Display", css: "'DM Serif Display', Georgia, serif",        g: "DM+Serif+Display:ital@0;1" },
    lora:       { label: "Lora",             css: "'Lora', Georgia, serif",                    g: "Lora:ital,wght@0,400;0,600;0,700;1,400;1,600" },
    mono:       { label: "JetBrains Mono",   css: "'JetBrains Mono', ui-monospace, monospace", g: "JetBrains+Mono:wght@400;500;700;800" },
    caveat:     { label: "Caveat (hand)",    css: "'Caveat', 'Comic Sans MS', cursive",        g: "Caveat:wght@400;600;700" },
  };

  const DEFAULT_ROLE_COLORS = {
    "Participant": "#7c3aed",
    "Speaker":     "#e11d48",
    "Organizer":   "#f97316",
    "Staff":       "#0ea5e9",
    "VIP":         "#b8860b",
    "Press":       "#16a34a",
    "Volunteer":   "#eab308",
    "Exhibitor":   "#0d9488",
  };

  const HASH_PALETTE = ["#7c3aed", "#e11d48", "#0ea5e9", "#16a34a", "#f97316",
                        "#0d9488", "#db2777", "#4f46e5", "#ca8a04", "#64748b"];

  function googleFontsHref() {
    return "https://fonts.googleapis.com/css2?family=" +
      Object.values(FONTS).map(f => f.g).join("&family=") + "&display=swap";
  }

  // ── helpers ────────────────────────────────────────────────────────────
  const clone = o => JSON.parse(JSON.stringify(o));
  let _uid = 0;
  const newId = () => "e" + Date.now().toString(36) + (++_uid).toString(36);

  function hexToRgb(c) {
    if (!c || typeof c !== "string") return null;
    let h = c.trim().replace("#", "");
    if (h.length === 3) h = h.split("").map(x => x + x).join("");
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function inkFor(color) {
    const rgb = hexToRgb(color);
    if (!rgb) return "#ffffff";
    const lum = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
    return L > 0.42 ? "#111111" : "#ffffff";
  }

  function hashColor(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return HASH_PALETTE[h % HASH_PALETTE.length];
  }

  // ── layout normalisation ───────────────────────────────────────────────
  function normalize(layout, fallback) {
    let L = layout && Array.isArray(layout.els) && layout.els.length ? clone(layout)
          : (fallback ? clone(fallback) : { els: [] });
    L.v = 1;
    if (!L.size || !SIZES[L.size]) L.size = "a6";
    if (L.size !== "custom" || !(L.w > 0 && L.h > 0)) {
      if (L.size !== "custom") { L.w = SIZES[L.size].w; L.h = SIZES[L.size].h; }
      else { L.w = L.w || 90; L.h = L.h || 120; }
    }
    L.bg = Object.assign({ color: "#ffffff", grad: "", img: "", fit: "cover",
                           px: 50, py: 50, op: 1, blur: 0, gray: false, ov: "", ovop: 0 }, L.bg || {});
    L.roles = Object.assign({ field: "", fallback: "Participant", colors: {} }, L.roles || {});
    L.roles.colors = Object.assign({}, DEFAULT_ROLE_COLORS, L.roles.colors || {});
    L.els = (L.els || []).map(e => (e.id ? e : Object.assign({ id: newId() }, e)));
    return L;
  }

  // ── attendee → token values ────────────────────────────────────────────
  function roleOf(person, L) {
    const f = L.roles.field || "";
    let v = "";
    if (f.startsWith("f:")) v = (person.f || {})[f.slice(2)] || "";
    else if (f) v = person[f] || "";
    v = String(v).split(",")[0].trim();
    if (person.blank && !v) return "";
    return v || L.roles.fallback || "";
  }

  function roleColorOf(role, L) {
    if (!role) return L.roles.colors[L.roles.fallback] || HASH_PALETTE[0];
    const colors = L.roles.colors || {};
    const key = Object.keys(colors).find(k => k.toLowerCase() === role.toLowerCase());
    return key ? colors[key] : hashColor(role.toLowerCase());
  }

  function tokens(person, ev, role) {
    const first = person.first || "", last = person.last || "";
    const lastWord = last.split(/[\s-]+/).filter(Boolean).pop() || "";
    return {
      name: person.name || "", first, last,
      initials: ((first[0] || "") + (lastWord[0] || "")).toUpperCase(),
      email: person.email || "", phone: person.phone || "",
      org: person.org || "", title: person.title || "", dept: person.dept || "",
      country: person.country || "", role: role || "", no: person.no || "",
      event: ev.title || "", date: ev.date || "", dates: ev.dates || "", time: ev.time || "",
      venue: ev.venue || "", code: ev.code || "",
    };
  }

  function tidy(s) {
    // Remove separators left dangling by empty tokens:
    //   "Officer · "  → "Officer"      " · Ministry" → "Ministry"
    //   "A ·  · B"    → "A · B"        "Speaker · #" → "Speaker"
    return String(s)
      .replace(/\s+([·|@–—\/])(\s*[·|@–—\/])+\s+/g, " $1 ")
      .replace(/^[\s·|@–—\/,#№]+/, "")
      .replace(/[\s·|@–—\/,#№]+$/, "")
      .trim();
  }

  function resolveText(raw, T, person) {
    let hadToken = false, filled = false;
    const out = String(raw || "").replace(/\{(f:\d+|[a-z_]+)\}/gi, (m, k) => {
      hadToken = true;
      let v;
      if (k.startsWith("f:")) v = (person.f || {})[k.slice(2)];
      else if (k.toLowerCase() in T) v = T[k.toLowerCase()];
      else return m;                                   // unknown token: leave visible
      v = v == null ? "" : String(v);
      if (v) filled = true;
      return v;
    });
    if (!hadToken) return { text: out, empty: !out.trim() };
    const t = filled ? tidy(out) : "";
    return { text: t, empty: !t };
  }

  // ── QR ─────────────────────────────────────────────────────────────────
  function vcard(p) {
    const esc = s => String(s || "").replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
    return ["BEGIN:VCARD", "VERSION:3.0",
      "N:" + esc(p.last) + ";" + esc(p.first) + ";;;",
      "FN:" + esc(p.name),
      p.org ? "ORG:" + esc(p.org) : "",
      p.title ? "TITLE:" + esc(p.title) : "",
      p.email ? "EMAIL:" + esc(p.email) : "",
      p.phone ? "TEL:" + esc(p.phone) : "",
      "END:VCARD"].filter(Boolean).join("\n");
  }

  function qrContent(el, person, ev, T) {
    switch (el.mode || "ticket") {
      case "vcard":   return person.blank ? "" : vcard(person);
      case "event":   return ev.register_url || "";
      case "checkin": return ev.checkin_url || "";
      case "custom":  return resolveText(el.data || "", T, person).text;
      default:        return person.ticket_url || ev.checkin_url || "";
    }
  }

  const _qrCache = new Map();
  function qrSvg(text, opt) {
    if (!text || typeof window.qrcode !== "function") return null;
    const key = text + "|" + opt.ec + "|" + opt.fg + "|" + opt.bg + "|" + opt.dots + "|" + opt.quiet;
    if (_qrCache.has(key)) return _qrCache.get(key).cloneNode(true);
    if (window.qrcode.stringToBytesFuncs && window.qrcode.stringToBytesFuncs["UTF-8"]) {
      window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs["UTF-8"];
    }
    let qr;
    try { qr = window.qrcode(0, opt.ec || "M"); qr.addData(text); qr.make(); }
    catch (e) { try { qr = window.qrcode(0, "L"); qr.addData(text); qr.make(); } catch (e2) { return null; } }
    const n = qr.getModuleCount(), q = opt.quiet, size = n + q * 2;
    const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    let d = "", circles = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (!qr.isDark(r, c)) continue;
        if (opt.dots && !inFinder(r, c)) {
          circles += `<circle cx="${c + q + 0.5}" cy="${r + q + 0.5}" r="0.46"/>`;
        } else {
          d += `M${c + q} ${r + q}h1v1h-1z`;
        }
      }
    }
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.setAttribute("shape-rendering", opt.dots ? "geometricPrecision" : "crispEdges");
    svg.style.width = "100%"; svg.style.height = "100%"; svg.style.display = "block";
    // Built from numbers only — safe to assign as markup.
    svg.innerHTML =
      (opt.bg && opt.bg !== "transparent" ? `<rect width="${size}" height="${size}" fill="${opt.bg.replace(/"/g, "")}"/>` : "") +
      `<g fill="${String(opt.fg || "#000").replace(/"/g, "")}"><path d="${d}"/>${circles}</g>`;
    _qrCache.set(key, svg);
    if (_qrCache.size > 4000) _qrCache.clear();
    return svg.cloneNode(true);
  }

  // ── main render ────────────────────────────────────────────────────────
  /**
   * render(layout, person, ctx, opts) → HTMLElement
   *   ctx  : { event, assets:{key:url}, fallback:layout }
   *   opts : { width, height (CSS lengths; default the badge's mm),
   *            editor:true (keep empty/hidden elements selectable),
   *            selected:id }
   */
  function render(layout, person, ctx, opts) {
    ctx = ctx || {}; opts = opts || {};
    const L = normalize(layout, ctx.fallback);
    const ev = ctx.event || {};
    const assets = ctx.assets || {};
    person = person || {};
    const role = roleOf(person, L);
    const roleCol = roleColorOf(role, L);
    const roleInk = inkFor(roleCol);
    const T = tokens(person, ev, role);

    const C = v => {
      if (v == null || v === "") return "";
      if (v === "role") return roleCol;
      if (v === "roleInk") return roleInk;
      return String(v).replace(/\{role\}/g, roleCol).replace(/\{roleInk\}/g, roleInk);
    };

    const root = document.createElement("div");
    root.className = "kb-badge";
    root.style.cssText =
      "position:relative;overflow:hidden;container-type:size;box-sizing:border-box;" +
      "-webkit-print-color-adjust:exact;print-color-adjust:exact;";
    root.style.width = opts.width || (L.w + "mm");
    root.style.height = opts.height || (L.h + "mm");
    if (L.bg.grad) root.style.background = C(L.bg.grad);
    root.style.backgroundColor = C(L.bg.color) || "#ffffff";

    // Background photo + overlay
    const bgUrl = L.bg.img ? assets[L.bg.img] : "";
    if (bgUrl) {
      const im = document.createElement("div");
      im.className = "kb-bgimg";
      const blur = +L.bg.blur || 0;
      im.style.cssText = "position:absolute;inset:0;pointer-events:none;";
      im.style.backgroundImage = `url("${String(bgUrl).replace(/"/g, "%22")}")`;
      im.style.backgroundSize = L.bg.fit === "contain" ? "contain" : (L.bg.fit === "stretch" ? "100% 100%" : "cover");
      im.style.backgroundRepeat = "no-repeat";
      im.style.backgroundPosition = `${+L.bg.px}% ${+L.bg.py}%`;
      im.style.opacity = L.bg.op == null ? 1 : L.bg.op;
      const filters = [];
      if (blur) filters.push(`blur(${blur * 0.25}cqmin)`);
      if (L.bg.gray) filters.push("grayscale(1)");
      if (filters.length) im.style.filter = filters.join(" ");
      if (blur) im.style.transform = "scale(1.08)";
      root.appendChild(im);
    }
    if (L.bg.ov && +L.bg.ovop > 0) {
      const ov = document.createElement("div");
      ov.className = "kb-overlay";
      ov.style.cssText = "position:absolute;inset:0;pointer-events:none;";
      ov.style.background = C(L.bg.ov);
      ov.style.opacity = L.bg.ovop;
      root.appendChild(ov);
    }

    const ratio = L.w / L.h; // for square lock

    L.els.forEach((el, i) => {
      if (el.hide && !opts.editor) return;
      const node = document.createElement("div");
      node.className = "kb-el kb-" + el.t;
      node.dataset.id = el.id;
      const h = el.sq || el.t === "qr" ? (+el.w * ratio) : +el.h;
      node.style.cssText = "position:absolute;box-sizing:border-box;";
      node.style.left = (+el.x) + "%";
      node.style.top = (+el.y) + "%";
      node.style.width = (+el.w) + "%";
      node.style.height = h + "%";
      node.style.zIndex = String(i + 1);
      if (el.r) node.style.transform = `rotate(${+el.r}deg)`;
      if (el.op != null && el.op !== 1) node.style.opacity = el.op;
      if (el.hide) node.style.opacity = "0.25";

      let ok = true;
      if (el.t === "text") ok = drawText(node, el, T, person, C, opts);
      else if (el.t === "shape") drawShape(node, el, C);
      else if (el.t === "image") ok = drawImage(node, el, C, assets, opts);
      else if (el.t === "qr") ok = drawQr(node, el, C, person, ev, T, assets, opts);
      if (!ok && !opts.editor) return;
      root.appendChild(node);
    });

    root.dataset.role = role;
    return root;
  }

  function boxDeco(node, el, C) {
    if (el.bgc) node.style.background = C(el.bgc);
    if (el.round) node.style.borderRadius = "50%";
    else if (el.rad) node.style.borderRadius = (+el.rad) + "cqmin";
    if (el.bw) node.style.border = `${+el.bw}cqmin ${el.bs || "solid"} ${C(el.bc) || "#000"}`;
    if (el.pad) node.style.padding = (+el.pad) + "cqmin";
    if (el.shadow) node.style.boxShadow = el.shadow === true ? "0 0.8cqmin 2.4cqmin rgba(0,0,0,.22)" : C(el.shadow);
  }

  function drawText(node, el, T, person, C, opts) {
    const res = resolveText(el.txt, T, person);
    let text = res.text;
    let ok = true;
    if (res.empty && !el.keep) {
      ok = false;
      if (opts.editor) { text = el.txt || "Text"; node.classList.add("kb-placeholder"); }
    }
    boxDeco(node, el, C);
    node.style.display = "flex";
    node.style.flexDirection = "column";
    node.style.justifyContent = el.va === "t" ? "flex-start" : el.va === "b" ? "flex-end" : "center";
    node.style.overflow = "hidden";
    const inner = document.createElement("div");
    inner.className = "kb-tx";
    inner.textContent = el.up ? String(text).toUpperCase() : text;
    const font = FONTS[el.ff] || FONTS.inter;
    const fs = +el.fs || 5;
    inner.style.cssText = "width:100%;overflow-wrap:break-word;";
    inner.style.fontFamily = font.css;
    inner.style.fontSize = fs + "cqmin";
    inner.style.fontWeight = el.fw || 600;
    inner.style.color = C(el.c) || "#111111";
    inner.style.textAlign = el.al === "l" ? "left" : el.al === "r" ? "right" : "center";
    inner.style.lineHeight = el.lh || 1.12;
    inner.style.whiteSpace = el.nowrap ? "nowrap" : "pre-wrap";
    if (el.ls) inner.style.letterSpacing = el.ls + "em";
    if (el.it) inner.style.fontStyle = "italic";
    if (el.tsh) inner.style.textShadow = C(el.tsh);
    else if (el.sh) inner.style.textShadow = "0 0.3cqmin 1.2cqmin rgba(0,0,0,.55)";
    if (el.fit) { node.dataset.fit = "1"; node.dataset.fs = String(fs); }
    node.appendChild(inner);
    return ok;
  }

  function drawShape(node, el, C) {
    if (el.grad) node.style.background = C(el.grad);
    else node.style.background = C(el.fill) || "transparent";
    if (el.round) node.style.borderRadius = "50%";
    else if (el.rad) node.style.borderRadius = (+el.rad) + "cqmin";
    if (el.bw) node.style.border = `${+el.bw}cqmin ${el.bs || "solid"} ${C(el.bc) || "#000"}`;
    if (el.clip) node.style.clipPath = el.clip;
    if (el.shadow) node.style.boxShadow = el.shadow === true ? "0 0.8cqmin 2.4cqmin rgba(0,0,0,.22)" : C(el.shadow);
  }

  function drawImage(node, el, C, assets, opts) {
    const url = assets[el.src];
    boxDeco(node, Object.assign({}, el, { pad: el.pad }), C);
    node.style.overflow = "hidden";
    if (!url) {
      if (opts.editor) {
        node.classList.add("kb-img-empty");
        const ph = document.createElement("div");
        ph.className = "kb-img-ph";
        ph.textContent = el.src === "logo" ? "Logo" : el.src === "background" ? "Photo" : "Image";
        node.appendChild(ph);
      }
      return false;
    }
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.decoding = "sync";
    img.style.cssText = "width:100%;height:100%;display:block;";
    img.style.objectFit = el.fit === "cover" ? "cover" : el.fit === "stretch" ? "fill" : "contain";
    if (el.gray) img.style.filter = "grayscale(1)";
    node.appendChild(img);
    return true;
  }

  function drawQr(node, el, C, person, ev, T, assets, opts) {
    const content = qrContent(el, person, ev, T);
    const logoUrl = el.logo ? assets[el.logo] : "";
    const svg = qrSvg(content || (opts.editor ? "https://nokknock.app" : ""), {
      ec: logoUrl ? "H" : (el.ec || "M"), fg: C(el.fg) || "#000",
      bg: C(el.bgc) || "#ffffff", dots: !!el.dots, quiet: el.quiet == null ? 0 : +el.quiet,
    });
    boxDeco(node, el, C);
    if (!el.bgc && el.bgc !== "") node.style.background = "#ffffff";
    if (!svg) return false;
    node.style.overflow = "hidden";
    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;width:100%;height:100%;";
    wrap.appendChild(svg);
    if (logoUrl) {
      const lg = document.createElement("img");
      lg.src = logoUrl; lg.alt = "";
      lg.style.cssText = "position:absolute;left:39%;top:39%;width:22%;height:22%;object-fit:contain;" +
                         "background:#fff;border-radius:12%;padding:2%;box-sizing:border-box;";
      wrap.appendChild(lg);
    }
    node.appendChild(wrap);
    return !!content || !!opts.editor;
  }

  // Shrink text marked fit:true until it fits its box. Must run after the
  // badge is in the DOM (it measures) and again after fonts load.
  function fitText(scope) {
    (scope || document).querySelectorAll(".kb-text[data-fit='1']").forEach(node => {
      const inner = node.firstChild;
      if (!inner) return;
      let fs = parseFloat(node.dataset.fs) || 5;
      const min = fs * 0.3;
      inner.style.fontSize = fs + "cqmin";
      // Compare the text block itself with the box's content height —
      // scrollHeight can't see text that overflows UPWARD from a bottom- or
      // middle-aligned box, which is exactly how long names get clipped.
      const cs = getComputedStyle(node);
      const avail = node.clientHeight - parseFloat(cs.paddingTop || 0) - parseFloat(cs.paddingBottom || 0);
      const over = () => inner.offsetHeight > avail + 0.5 || inner.scrollWidth > inner.clientWidth + 0.5;
      let guard = 0;
      while (guard++ < 40 && fs > min && over()) {
        fs *= 0.93;
        inner.style.fontSize = fs + "cqmin";
      }
    });
  }

  // ── print sheet geometry ───────────────────────────────────────────────
  const PAPERS = {
    a4:     { label: "A4 (210 × 297 mm)",      w: 210,   h: 297 },
    letter: { label: "US Letter (8.5 × 11 in)", w: 215.9, h: 279.4 },
    a3:     { label: "A3 (297 × 420 mm)",      w: 297,   h: 420 },
    single: { label: "One badge per page (badge / card printer)", w: 0, h: 0 },
  };

  /**
   * How badges of w×h mm tile onto a sheet.
   * Returns { pw, ph, cols, rows, per, ox, oy, single }
   * (ox/oy = top-left of the grid, so the grid is centred on the page).
   */
  function sheetGrid(paper, orient, margin, gap, w, h) {
    margin = +margin || 0; gap = +gap || 0;
    if (paper === "single" || !PAPERS[paper]) {
      return { pw: w, ph: h, cols: 1, rows: 1, per: 1, ox: 0, oy: 0, single: true };
    }
    const P = PAPERS[paper];
    const fit = (pw, ph) => {
      const cols = Math.max(0, Math.floor((pw - 2 * margin + gap) / (w + gap)));
      const rows = Math.max(0, Math.floor((ph - 2 * margin + gap) / (h + gap)));
      return { pw, ph, cols, rows, per: cols * rows };
    };
    const portrait = fit(P.w, P.h), landscape = fit(P.h, P.w);
    let g = orient === "portrait" ? portrait : orient === "landscape" ? landscape
          : (landscape.per > portrait.per ? landscape : portrait);
    if (g.per === 0) {
      // Badge is bigger than the printable area — fall back to one per page.
      return { pw: w, ph: h, cols: 1, rows: 1, per: 1, ox: 0, oy: 0, single: true, tooBig: true };
    }
    const gw = g.cols * w + (g.cols - 1) * gap, gh = g.rows * h + (g.rows - 1) * gap;
    g.ox = (g.pw - gw) / 2; g.oy = (g.ph - gh) / 2; g.single = false;
    return g;
  }

  window.KKBadge = {
    SIZES, FONTS, PAPERS, DEFAULT_ROLE_COLORS,
    googleFontsHref, normalize, render, fitText, newId, clone, sheetGrid,
    roleOf, roleColorOf, inkFor, resolveText, tokens,
  };
})();
