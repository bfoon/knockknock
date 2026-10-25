/* ════════════════════════════════════════════════════════════════════
   HANNS DESIGN LIBRARY — bookmark designs, reuse them on any slide
   ════════════════════════════════════════════════════════════════════
   Save:   ☆ Save to my library (on any AI-area result)
           select anything on a slide → Ctrl/⌘+Shift+B (or "Save selection")
   Reuse:  ★ Library (toolbar) or Ctrl/⌘+Shift+L opens your library — the
           same in every deck. Each card is a live mini render; hover plays it.
             Place        a ghost follows your cursor · scroll / + − to resize
                          · click to drop · Esc to cancel
             Fit in box   drag a box, the design scales into it
             drag a card  straight onto the slide
             🎨 Match this slide   restyles fonts & colours to the slide you
                          drop it on (instant, no AI)
             ✦ Remix with AI       AI-born designs remember their prompt:
                          draw a box and get a fresh variant
   Backgrounds & templates (same library, own tabs):
             🖼  save this slide's background · ☆ on any preset or AI backdrop
             🎨  save the AI's matched title / content / closing SET
             ▭   save this slide as a template · ☆ on any built-in template
             hover a background or set → it's TRIED ON your slide live
             Keep text readable → text that would vanish gets flipped light/dark
             Pour my content in → a template's look, your words and photos
             🎲  shuffle your saved backgrounds across the deck
   Bookmarks live on the server (designlib app), per person, across decks.
   Every drop is one undo step and selects what was placed.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const Hx = window.Hanns, SRV = window.__HANNS__ || {}, LIB = window.__HANNS_LIB__ || {};
  if (!Hx || !LIB.url) return;
  const { Deck, W, H, paintSlide, uid } = Hx;
  const API = () => window.HannsEditorAPI || {};
  const toast = m => (API().toast || console.log)(m);
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const TAGS = ["Chart", "Title", "Icon", "Illustration", "Layout", "Footer", "Brand", "Quote", "Stats"];

  let items = null, loading = null, panel = null, query = "", tagFilter = "", sort = "recent", kindTab = "all";
  let readable = (() => { try { return localStorage.getItem("hanns-lib-readable") !== "0"; } catch (_) { return true; } })();
  const DESIGN = new Set(["ai", "selection"]);
  const GROUP = k => (DESIGN.has(k) ? "designs" : k === "template" ? "templates" : "backgrounds");
  const BGF = ["bg", "bgSize", "bgFx", "bgFxColor", "bgMode", "bgC1", "bgC2", "bgC3", "bgAngle", "bgUse3"];
  let matchStyle = (() => { try { return localStorage.getItem("hanns-lib-match") === "1"; } catch (_) { return false; } })();

  /* ───────────── server ───────────── */
  async function req(url, method, body) {
    const r = await fetch(url, { method: method || "GET", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRFToken": SRV.csrftoken || "" },
      body: body ? JSON.stringify(body) : undefined });
    let data = null; try { data = await r.json(); } catch (_) { /* html error page */ }
    if (!r.ok || !data || !data.ok) throw new Error((data && data.error) || "The library request failed (" + r.status + ")");
    return data;
  }
  function itemUrl(id, suffix) { return LIB.url.replace(/\/?$/, "/") + id + "/" + (suffix ? suffix + "/" : ""); }
  function load(force) {
    if (items && !force) return Promise.resolve(items);
    if (loading) return loading;
    loading = req(LIB.url).then(d => (items = d.items)).finally(() => { loading = null; });
    return loading;
  }

  /* ───────────── geometry ───────────── */
  function bounds(els) {
    const x0 = Math.min(...els.map(e => +e.x || 0)), y0 = Math.min(...els.map(e => +e.y || 0));
    const x1 = Math.max(...els.map(e => (+e.x || 0) + (+e.w || 0))), y1 = Math.max(...els.map(e => (+e.y || 0) + (+e.h || 0)));
    return { x: x0, y: y0, w: Math.max(4, x1 - x0), h: Math.max(4, y1 - y0) };
  }
  function normalise(els) {                 // store relative to the design's own corner
    const b = bounds(els);
    return { els: els.map(e => Object.assign(clone(e), { x: Math.round((+e.x || 0) - b.x), y: Math.round((+e.y || 0) - b.y) })), w: Math.round(b.w), h: Math.round(b.h) };
  }
  function scaleEl(e, k) {
    ["x", "y", "w", "h"].forEach(p => { if (typeof e[p] === "number") e[p] = Math.round(e[p] * k * 10) / 10; });
    if (e.type === "text" && e.size) e.size = Math.max(6, Math.round(e.size * k));
    ["strokeW", "radius"].forEach(p => { if (typeof e[p] === "number") e[p] = Math.round(e[p] * k * 10) / 10; });
    if (Array.isArray(e.children)) e.children.forEach(c => scaleEl(c, k));
  }
  function reId(e) { e.id = uid(); if (Array.isArray(e.children)) e.children.forEach(reId); delete e.aiDecor; return e; }
  function mainColor(els) {
    for (const e of els) for (const k of ["fill", "accent", "color"]) {
      const v = e[k]; if (typeof v === "string" && /^#|^rgb/.test(v) && v !== "none") return v.slice(0, 32);
    }
    return "";
  }
  function guessName(els) {
    const t = els.find(e => e.type === "text" && e.text);
    if (t) return String(t.text).split("\n")[0].slice(0, 40);
    const types = [...new Set(els.map(e => e.type))];
    return types.length === 1 ? (els.length > 1 ? els.length + " " + types[0] + "s" : types[0][0].toUpperCase() + types[0].slice(1)) : els.length + " elements";
  }

  /* ───────────── restyle to the current slide (no AI) ───────────── */
  function slideStyle(slide) {
    const texts = (slide.els || []).filter(e => e.type === "text");
    if (!texts.length) return null;
    const head = texts.reduce((a, b) => ((b.size || 0) > (a.size || 0) ? b : a));
    const body = texts.reduce((a, b) => ((b.size || 99) < (a.size || 99) ? b : a));
    const shape = (slide.els || []).find(e => ["rect", "ellipse", "freeform"].includes(e.type) && typeof e.fill === "string" && /^#/.test(e.fill));
    return { headFont: head.font, headColor: head.color, bodyFont: body.font, bodyColor: body.color,
             accent: (shape && shape.fill) || head.color || "#e8482b" };
  }
  function hexRgb(h) {
    // 6-digit first, and exactly 3 or 6 digits: "#0b1020" must not be read as "#0b1"
    const m = String(h || "").trim().match(/^#?([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i); if (!m) return null;
    let x = m[1].slice(0, 6); if (x.length === 3) x = x.split("").map(c => c + c).join("");
    return [0, 2, 4].map(i => parseInt(x.substr(i, 2), 16));
  }
  function restyle(els, st) {
    if (!st) return els;
    const sizes = [];
    const walk = (list, fn) => list.forEach(e => { fn(e); if (Array.isArray(e.children)) walk(e.children, fn); });
    walk(els, e => { if (e.type === "text") sizes.push(e.size || 24); });
    const big = Math.max(0, ...sizes);
    const rgb = hexRgb(st.accent);
    walk(els, e => {
      if (e.type === "text") {
        const isHead = (e.size || 24) >= big * 0.6;
        e.font = (isHead ? st.headFont : st.bodyFont) || e.font;
        e.color = (isHead ? st.headColor : st.bodyColor) || e.color;
      } else if (["rect", "ellipse", "freeform", "line"].includes(e.type) && rgb && typeof e.fill === "string" && e.fill !== "none") {
        const a = (e.fill.match(/rgba\([^)]*,\s*([\d.]+)\s*\)/) || [])[1];
        e.fill = a ? `rgba(${rgb.join(",")},${a})` : st.accent;
        if (e.fill2) e.fill2 = st.headColor || e.fill2;
      } else if (e.type === "chart") {
        e.accent = st.accent;
      }
    });
    return els;
  }

  /* ───────────── saving ───────────── */
  function flyStar(fromEl) {
    const btn = document.getElementById("btn-design-lib");
    if (!btn) return;
    const a = (fromEl && fromEl.getBoundingClientRect && fromEl.getBoundingClientRect()) || { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0 };
    const b = btn.getBoundingClientRect();
    const star = document.createElement("div");
    star.className = "hlib-fly"; star.textContent = "★";
    document.body.appendChild(star);
    const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2, x1 = b.left + b.width / 2, y1 = b.top + b.height / 2;
    const mx = (x0 + x1) / 2, my = Math.min(y0, y1) - 120;
    star.animate([
      { transform: `translate(${x0}px,${y0}px) scale(.4) rotate(0)`, opacity: 0 },
      { transform: `translate(${mx}px,${my}px) scale(1.6) rotate(200deg)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${x1}px,${y1}px) scale(.6) rotate(360deg)`, opacity: 1 },
    ], { duration: 900, easing: "cubic-bezier(.3,.7,.4,1)" }).onfinish = () => {
      star.remove();
      btn.classList.remove("hlib-bump"); void btn.offsetWidth; btn.classList.add("hlib-bump");
    };
  }
  function saveDialog(def) {
    return new Promise(resolve => {
      const d = document.createElement("div");
      d.className = "hlib-modal";
      d.innerHTML = `<div class="hlib-card-dlg" role="dialog" aria-label="Save to library">
        <div class="hlib-dlg-head">★ <b>Save to my library</b></div>
        <div class="hlib-dlg-prev"></div>
        <label class="hlib-lbl">Name<input type="text" class="hlib-name" maxlength="80" value="${esc(def.name)}"></label>
        <div class="hlib-lbl">Tags</div>
        <div class="hlib-tagpick">${(def.tagList || TAGS).map(t => `<button type="button" data-t="${t}" class="${def.tags.includes(t) ? "on" : ""}">${t}</button>`).join("")}</div>
        <div class="hlib-row"><button type="button" class="hlib-go">★ Save</button><button type="button" class="hlib-ghost hlib-no">Cancel</button></div></div>`;
      document.body.appendChild(d);
      thumbFor(d.querySelector(".hlib-dlg-prev"), def.preview, 280, 140);
      const name = d.querySelector(".hlib-name");
      d.querySelectorAll(".hlib-tagpick button").forEach(b => b.addEventListener("click", () => b.classList.toggle("on")));
      const done = ok => { const out = ok ? { name: name.value.trim() || def.name, tags: [...d.querySelectorAll(".hlib-tagpick .on")].map(b => b.dataset.t) } : null; d.remove(); resolve(out); };
      d.querySelector(".hlib-go").addEventListener("click", () => done(true));
      d.querySelector(".hlib-no").addEventListener("click", () => done(false));
      d.addEventListener("click", e => { if (e.target === d) done(false); });
      d.addEventListener("keydown", e => { if (e.key === "Enter") done(true); if (e.key === "Escape") { e.stopPropagation(); done(false); } });
      setTimeout(() => { name.focus(); name.select(); }, 20);
    });
  }
  function autoTags(els, kind) {
    const t = new Set();
    if (els.some(e => e.type === "chart")) t.add("Chart");
    if (els.some(e => e.type === "image" && e.aiArt)) t.add("Illustration");
    if (els.some(e => e.type === "text" && (e.size || 0) >= 48)) t.add("Title");
    if (els.length >= 3 && !t.size) t.add("Layout");
    return [...t];
  }
  async function saveDesign(opts) {
    const raw = (opts.els || []).filter(e => e && e.type);
    if (!raw.length) { toast("Select something on the slide first"); return false; }
    const design = normalise(raw);
    return saveBookmark({ kind: opts.kind || "selection", name: opts.name || guessName(raw), tags: autoTags(raw, opts.kind),
      body: { els: design.els, w: design.w, h: design.h, prompt: opts.prompt || "", color: mainColor(raw) },
      preview: { kind: "selection", els: design.els, w: design.w, h: design.h }, from: opts.from });
  }
  async function saveBookmark(o) {
    const choice = await saveDialog({ name: String(o.name || "Untitled").slice(0, 80), tags: o.tags || [], preview: o.preview, tagList: o.tagList });
    if (!choice) return false;
    try {
      const d = await req(LIB.url, "POST", Object.assign({ name: choice.name, tags: choice.tags, kind: o.kind }, o.body));
      if (items) items.unshift(d.item);
      flyStar(o.from);
      const where = { designs: "any slide", backgrounds: "any slide", templates: "any deck" }[GROUP(o.kind)];
      toast(`★ Saved “${d.item.name}” — reuse it on ${where} from ★ Library`);
      if (panel && panel.classList.contains("on")) { kindTab = kindTab === "all" ? "all" : GROUP(o.kind); render(); }
      return true;
    } catch (e) { toast("⚠️ " + e.message); return false; }
  }

  /* ───────────── colour & readability ───────────── */
  function colorsIn(css) { return (String(css || "").match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b|rgba?\([^)]*\)/gi) || []).slice(0, 8); }
  function lumOf(c) {
    let rgb = hexRgb(c);
    if (!rgb) { const m = String(c).match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i); if (m) rgb = [+m[1], +m[2], +m[3]]; }
    if (!rgb) return null;
    const ch = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  }
  function toneOf(bg, palette) {
    const ls = (palette && palette.length ? palette : colorsIn(bg)).map(lumOf).filter(v => v != null);
    return ls.length ? ls.reduce((a, b) => a + b, 0) / ls.length : null;
  }
  function makeReadable(slide, tone, textColor) {
    if (tone == null) return 0;
    let fixed = 0;
    const good = textColor || (tone < 0.45 ? "#f8fafc" : "#141210");
    const walk = list => list.forEach(e => {
      if (e.type === "text" && (!e.fill || e.fill === "none")) {
        const l = lumOf(e.color || "#000000");
        if (l != null && (Math.max(l, tone) + 0.05) / (Math.min(l, tone) + 0.05) < 3) { e.color = good; fixed++; }
      }
      if (Array.isArray(e.children)) walk(e.children);
    });
    walk(slide.els || []);
    return fixed;
  }
  function bgOfSlide(s) {
    const b = pick(s, BGF);
    b.tone = toneOf(s.bg);
    return b;
  }
  function paintBg(s, v) {
    BGF.forEach(k => { s[k] = v[k] !== undefined ? clone(v[k]) : { bgSize: null, bgFx: "none", bgMode: "preset" }[k]; });
    if (!s.bgMode) s.bgMode = "preset";
    return readable ? makeReadable(s, v.tone != null ? v.tone : toneOf(v.bg, v.palette), v.text) : 0;
  }

  /* ───────────── saving backgrounds, sets and templates ───────────── */
  const BG_TAGS = ["Dark", "Light", "Warm", "Cool", "Animated", "AI art", "Brand", "Photo", "Minimal"];
  function bgTags(v) {
    const t = [], tone = v.tone != null ? v.tone : toneOf(v.bg, v.palette);
    if (tone != null) t.push(tone < 0.45 ? "Dark" : "Light");
    if (v.bgFx && v.bgFx !== "none") t.push("Animated");
    if (/url\(["']?\/media\/hanns\/decks\/[^)]*\/ai\//.test(v.bg || "")) t.push("AI art");
    else if (/url\(/.test(v.bg || "")) t.push("Photo");
    const rgb = colorsIn(v.bg).map(hexRgb).filter(Boolean);
    if (rgb.length) { const warm = rgb.filter(c => c[0] > c[2] + 20).length; t.push(warm * 2 >= rgb.length ? "Warm" : "Cool"); }
    return t;
  }
  function saveBackground(v, opts) {
    opts = opts || {};
    const payload = pick(v, BGF.concat(["palette", "text"]));
    payload.tone = v.tone != null ? v.tone : toneOf(v.bg, v.palette);
    return saveBookmark({ kind: "background", name: opts.name || "Background", tags: bgTags(payload), tagList: BG_TAGS,
      body: { payload, w: W, h: H, color: (v.palette && v.palette[0]) || colorsIn(v.bg)[0] || "" },
      preview: { kind: "background", payload }, from: opts.from });
  }
  function saveBgSet(variants, opts) {
    opts = opts || {};
    const roles = ["Title", "Content", "Closing"];
    const vs = variants.map((v, i) => Object.assign(pick(v, BGF.concat(["palette", "text"])), { role: v.role || roles[i] || "Content",
      tone: v.tone != null ? v.tone : toneOf(v.bg, v.palette) }));
    return saveBookmark({ kind: "bgset", name: opts.name || "Backdrop set", tags: bgTags(vs[0]), tagList: BG_TAGS,
      body: { payload: { variants: vs }, w: W, h: H, color: (vs[0].palette && vs[0].palette[0]) || "" },
      preview: { kind: "bgset", payload: { variants: vs } }, from: opts.from });
  }
  const TPL_TAGS = ["Title", "Agenda", "Split", "Stats", "Chart", "Quote", "Timeline", "Closing", "Built-in", "Brand"];
  function tplTags(slide, extra) {
    const t = new Set(extra || []), els = slide.els || [];
    if (els.some(e => e.type === "chart")) t.add("Chart");
    if (els.filter(e => e.type === "text").length <= 2 && els.some(e => e.type === "text" && (e.size || 0) >= 60)) t.add("Title");
    return [...t];
  }
  function saveTemplate(slide, opts) {
    opts = opts || {};
    const sl = pick(slide, BGF.concat(["transition"]));
    sl.els = clone(slide.els || []);
    return saveBookmark({ kind: "template", name: opts.name || guessName(sl.els.length ? sl.els : [{ type: "slide" }]),
      tags: tplTags(sl, opts.tags), tagList: TPL_TAGS,
      body: { payload: { slide: sl }, w: W, h: H, color: colorsIn(sl.bg)[0] || "" },
      preview: { kind: "template", payload: { slide: sl } }, from: opts.from });
  }
  function saveCurrentBackground(from) {
    const s = Deck.slides[Deck.cur];
    saveBackground(bgOfSlide(s), { name: "Background from slide " + (Deck.cur + 1), from });
  }
  function saveCurrentSlide(from) {
    const s = Deck.slides[Deck.cur];
    const t = (s.els || []).find(e => e.type === "text" && e.text);
    saveTemplate(s, { name: t ? String(t.text).split("\n")[0].slice(0, 40) + " layout" : "Slide " + (Deck.cur + 1) + " layout", from });
  }
  function saveSelection(fromEl) {
    const els = API().selected ? API().selected() : [];
    if (!els.length) { toast("Select one or more things on the slide, then save them"); return; }
    saveDesign({ els, kind: "selection", from: fromEl || document.querySelector("#canvas .el.selected") });
  }

  /* ───────────── thumbnails ───────────── */
  // A 960×540 slide scaled into tw×th. "contain" shows all of it (templates);
  // "cover" fills the frame and crops the edges (background swatches).
  function stageOf(slide, tw, th, live, cover) {
    const k = cover ? Math.max(tw / W, th / H) : Math.min(tw / W, th / H);
    const st = document.createElement("div");
    st.className = "hlib-slide";              // NOT .hlib-stage: that one forces a transparent background
    st.style.width = W + "px"; st.style.height = H + "px";
    st.style.transform = `translate(${(tw - W * k) / 2}px,${(th - H * k) / 2}px) scale(${k})`;
    try { paintSlide(st, Object.assign({ bgFx: "none", els: [] }, clone(slide)), live ? { live: true } : { live: false, revealAll: true }); }
    catch (_) { st.textContent = "Preview unavailable"; }
    return st;
  }
  function sampleText(tone) {
    const c = tone == null ? "#ffffff" : tone < 0.45 ? "#f8fafc" : "#141210";
    return [{ id: "s1", type: "text", text: "Aa", x: 70, y: 150, w: 400, h: 200, size: 170, weight: 800, color: c, font: '"Archivo",sans-serif' },
            { id: "s2", type: "text", text: "Your headline here", x: 76, y: 360, w: 700, h: 60, size: 40, weight: 500, color: c, font: '"Inter",sans-serif' }];
  }
  function thumbFor(host, b, tw, th, live) {
    host.innerHTML = "";
    if (host.clientWidth) tw = host.clientWidth;      // cards stretch with the panel
    else if (!host.isConnected && !host._remeasure) { // built before it's on screen: measure again once it is
      host._remeasure = true;
      requestAnimationFrame(() => { if (host.isConnected && host.clientWidth && host.clientWidth !== tw) thumbFor(host, b, host.clientWidth, th, live); });
    }
    const p = b.payload || {};
    if (b.kind === "background") host.appendChild(stageOf(Object.assign(pick(p, BGF), { els: sampleText(p.tone) }), tw, th, true, true));
    else if (b.kind === "template") host.appendChild(stageOf(p.slide || {}, tw, th, live));
    else if (b.kind === "bgset") {
      const vs = p.variants || [], w = Math.floor(tw / vs.length);
      vs.forEach((v, i) => {
        const cell = document.createElement("div"); cell.className = "hlib-setcell";
        cell.style.left = i * w + "px"; cell.style.width = w + "px";
        cell.appendChild(stageOf(Object.assign(pick(v, BGF), { els: [] }), w, th, true, true));
        cell.insertAdjacentHTML("beforeend", `<em>${esc((v.role || "")[0] || i + 1)}</em>`);
        host.appendChild(cell);
      });
    } else thumb(host, b, tw, th, live);
  }
  function pick(o, keys) { const r = {}; keys.forEach(k => { if (o && o[k] !== undefined) r[k] = o[k]; }); return r; }

  function thumb(host, design, tw, th, live) {
    host.innerHTML = "";
    const k = Math.min(tw / design.w, th / design.h, 2.5);
    const stage = document.createElement("div");
    stage.className = "hlib-stage";
    stage.style.width = design.w + "px"; stage.style.height = design.h + "px";
    stage.style.transform = `translate(${(tw - design.w * k) / 2}px,${(th - design.h * k) / 2}px) scale(${k})`;
    try { paintSlide(stage, { bg: "transparent", bgFx: "none", els: clone(design.els) }, live ? { live: true } : { live: false, revealAll: true }); }
    catch (_) { stage.textContent = "Preview unavailable"; }
    host.appendChild(stage);
  }

  /* ───────────── the panel ───────────── */
  function build() {
    panel = document.createElement("aside");
    panel.className = "hlib";
    panel.setAttribute("aria-label", "My design library");
    panel.innerHTML = `
      <header class="hlib-head"><span class="hlib-logo">★</span><div><b>My design library</b><small>Your saved designs — in every deck</small></div>
        <button type="button" class="hlib-x" aria-label="Close">✕</button></header>
      <nav class="hlib-tabs" role="tablist">
        ${[["all", "All"], ["designs", "✦ Designs"], ["backgrounds", "🖼 Backgrounds"], ["templates", "▭ Templates"]].map(([k, l]) =>
          `<button type="button" role="tab" data-k="${k}">${l} <i></i></button>`).join("")}
      </nav>
      <div class="hlib-tools">
        <div class="hlib-saves">
          <button type="button" class="hlib-save-sel" data-for="designs all">＋ Save selection <span></span></button>
          <button type="button" class="hlib-save-bg" data-for="backgrounds all" title="Bookmark this slide's background">🖼 This background</button>
          <button type="button" class="hlib-save-tpl" data-for="templates all" title="Bookmark this whole slide as a reusable template">▭ Slide as template</button>
          <button type="button" class="hlib-shuffle" data-for="backgrounds" title="Deal your saved backgrounds across the deck">🎲 Shuffle across deck</button>
        </div>
        <input type="search" class="hlib-search" placeholder="Search your designs…">
        <div class="hlib-filters"></div>
        <div class="hlib-row hlib-opts">
          <select class="hlib-sort" aria-label="Sort"><option value="recent">Recently used</option><option value="uses">Most used</option><option value="new">Newest</option><option value="az">A–Z</option></select>
          <label class="hlib-match" data-for="designs all" title="Give the design this slide's fonts and colours when you place it"><input type="checkbox"${matchStyle ? " checked" : ""}> 🎨 Match slide</label>
          <label class="hlib-match hlib-read" data-for="backgrounds templates" title="Flip text colours that would be hard to read on the new background"><input type="checkbox"${readable ? " checked" : ""}> 👁 Keep text readable</label>
        </div>
      </div>
      <div class="hlib-grid" aria-live="polite"></div>`;
    document.body.appendChild(panel);
    panel.querySelector(".hlib-x").addEventListener("click", close);
    panel.querySelector(".hlib-save-sel").addEventListener("click", e => saveSelection(e.currentTarget));
    panel.querySelector(".hlib-search").addEventListener("input", e => { query = e.target.value.trim().toLowerCase(); render(); });
    panel.querySelector(".hlib-sort").addEventListener("change", e => { sort = e.target.value; render(); });
    panel.querySelectorAll(".hlib-tabs button").forEach(b => b.addEventListener("click", () => { kindTab = b.dataset.k; tagFilter = ""; render(); }));
    panel.querySelector(".hlib-save-bg").addEventListener("click", e => saveCurrentBackground(e.currentTarget));
    panel.querySelector(".hlib-save-tpl").addEventListener("click", e => saveCurrentSlide(e.currentTarget));
    panel.querySelector(".hlib-shuffle").addEventListener("click", shuffleDeck);
    panel.querySelector(".hlib-read input").addEventListener("change", e => {
      readable = e.target.checked; try { localStorage.setItem("hanns-lib-readable", readable ? "1" : "0"); } catch (_) { /* ignore */ }
    });
    panel.querySelector(".hlib-match:not(.hlib-read) input").addEventListener("change", e => {
      matchStyle = e.target.checked; try { localStorage.setItem("hanns-lib-match", matchStyle ? "1" : "0"); } catch (_) { /* ignore */ }
    });
  }
  function open() {
    if (!panel) build();
    if (window.HannsAI && window.HannsAI.close) window.HannsAI.close();     // one side panel at a time
    panel.classList.add("on");
    document.body.classList.add("hlib-open");
    refreshSelCount();
    const grid = panel.querySelector(".hlib-grid");
    if (!items) grid.innerHTML = `<div class="hlib-empty"><span class="hlib-spin">★</span> Loading your designs…</div>`;
    load().then(render).catch(e => { grid.innerHTML = `<div class="hlib-empty">⚠️ ${esc(e.message)}</div>`; });
  }
  function close() { if (panel) panel.classList.remove("on"); document.body.classList.remove("hlib-open"); }
  function refreshSelCount() {
    if (!panel) return;
    const n = API().selected ? API().selected().length : 0;
    const b = panel.querySelector(".hlib-save-sel");
    b.disabled = !n; b.querySelector("span").textContent = n ? `(${n})` : "";
    b.title = n ? "Bookmark what's selected on the slide (Ctrl+Shift+B)" : "Select something on the slide first";
  }
  function visible() {
    let list = (items || []).filter(b => kindTab === "all" || GROUP(b.kind) === kindTab);
    if (tagFilter === "★") list = list.filter(b => b.pinned);
    else if (tagFilter === "AI") list = list.filter(b => b.kind === "ai");
    else if (tagFilter) list = list.filter(b => (b.tags || []).includes(tagFilter));
    if (query) list = list.filter(b => (b.name + " " + (b.tags || []).join(" ") + " " + (b.prompt || "")).toLowerCase().includes(query));
    const by = { recent: (a, b) => (b.lastUsed || b.created).localeCompare(a.lastUsed || a.created), uses: (a, b) => b.uses - a.uses,
                 new: (a, b) => b.created.localeCompare(a.created), az: (a, b) => a.name.localeCompare(b.name) }[sort];
    list.sort((a, b) => (b.pinned - a.pinned) || by(a, b));
    return list;
  }
  function render() {
    if (!panel) return;
    const everything = items || [];
    const counts = { all: everything.length, designs: 0, backgrounds: 0, templates: 0 };
    everything.forEach(b => counts[GROUP(b.kind)]++);
    panel.querySelectorAll(".hlib-tabs button").forEach(b => {
      b.classList.toggle("on", b.dataset.k === kindTab);
      b.querySelector("i").textContent = counts[b.dataset.k] || "";
    });
    panel.querySelectorAll("[data-for]").forEach(n => { n.hidden = !n.dataset.for.split(" ").includes(kindTab); });
    panel.querySelector(".hlib-shuffle").disabled = everything.filter(b => b.kind === "background").length < 2;
    const all = everything.filter(b => kindTab === "all" || GROUP(b.kind) === kindTab);
    const tags = ["★", ...(kindTab === "all" || kindTab === "designs" ? ["AI"] : []), ...new Set(all.flatMap(b => b.tags || []))];
    panel.querySelector(".hlib-filters").innerHTML = (all.length ? tags : []).map(t =>
      `<button type="button" class="${tagFilter === t ? "on" : ""}" data-f="${esc(t)}">${t === "★" ? "★ Pinned" : t === "AI" ? "✦ AI" : esc(t)}</button>`).join("");
    panel.querySelectorAll(".hlib-filters button").forEach(b => b.addEventListener("click", () => { tagFilter = tagFilter === b.dataset.f ? "" : b.dataset.f; render(); }));
    const grid = panel.querySelector(".hlib-grid");
    const list = visible();
    if (!all.length && kindTab === "backgrounds") {
      grid.innerHTML = `<div class="hlib-empty big"><div class="hlib-empty-art">🖼</div><b>No backgrounds yet</b>
        <p>Press <b>🖼 This background</b> to keep the current slide's look, tap <b>☆</b> on any background in the Backgrounds drawer, or save an AI Studio backdrop — even the whole matched set.</p></div>`;
      return;
    }
    if (!all.length && kindTab === "templates") {
      grid.innerHTML = `<div class="hlib-empty big"><div class="hlib-empty-art">▭</div><b>No templates yet</b>
        <p>Press <b>▭ Slide as template</b> to keep this slide's design, or tap <b>☆</b> on a built-in template. Later, <b>Pour my content in</b> gives any slide that look while keeping your words.</p></div>`;
      return;
    }
    if (!all.length) {
      grid.innerHTML = `<div class="hlib-empty big"><div class="hlib-empty-art">★</div><b>Nothing saved yet</b>
        <p>Select anything on a slide and press <b>＋ Save selection</b> (or Ctrl+Shift+B) — or tap <b>☆ Save to my library</b> on an AI-area result.</p>
        <p>Saved designs follow you to every deck.</p></div>`;
      return;
    }
    if (!list.length) { grid.innerHTML = `<div class="hlib-empty">No designs match.</div>`; return; }
    grid.innerHTML = "";
    list.forEach((b, n) => grid.appendChild(card(b, n)));
  }
  function card(b, n) {
    if (!DESIGN.has(b.kind)) return slideCard(b, n);
    const c = document.createElement("div");
    c.className = "hlib-item"; c.draggable = true; c.dataset.id = b.id;
    c.style.animationDelay = Math.min(0.5, n * 0.035) + "s";
    if (b.color) c.style.setProperty("--hl", b.color);
    c.innerHTML = `
      <div class="hlib-thumb"></div>
      <button type="button" class="hlib-pin${b.pinned ? " on" : ""}" title="${b.pinned ? "Unpin" : "Pin to the top"}">${b.pinned ? "★" : "☆"}</button>
      <div class="hlib-meta"><b title="${esc(b.name)}">${esc(b.name)}</b>
        <small>${b.kind === "ai" ? "✦ AI · " : ""}${b.w}×${b.h}${b.uses ? " · used " + b.uses + "×" : ""}</small></div>
      <div class="hlib-acts">
        <button type="button" class="hlib-place" title="Place it — click on the slide where it should go">⤓ Place</button>
        <button type="button" class="hlib-fit" title="Drag a box on the slide and fit the design into it">⬚ Fit</button>
        <button type="button" class="hlib-more" aria-label="More">⋯</button>
      </div>`;
    const th = c.querySelector(".hlib-thumb");
    thumbFor(th, b, 150, 92);
    c.addEventListener("mouseenter", () => thumb(th, b, 150, 92, true));     // hover plays its entrance
    c.querySelector(".hlib-place").addEventListener("click", () => startPlace(b));
    c.querySelector(".hlib-fit").addEventListener("click", () => startFit(b));
    c.querySelector(".hlib-pin").addEventListener("click", () => update(b, { pinned: !b.pinned }));
    c.querySelector(".hlib-more").addEventListener("click", e => menu(b, e.currentTarget));
    c.addEventListener("dblclick", () => startPlace(b));
    c.addEventListener("dragstart", e => { e.dataTransfer.setData("text/x-hanns-design", String(b.id)); e.dataTransfer.effectAllowed = "copy"; });
    return c;
  }
  function slideCard(b, n) {
    const c = document.createElement("div");
    c.className = "hlib-item hlib-k-" + b.kind; c.dataset.id = b.id;
    c.style.animationDelay = Math.min(0.5, n * 0.035) + "s";
    if (b.color) c.style.setProperty("--hl", b.color);
    const p = b.payload || {};
    const meta = b.kind === "bgset" ? `🎨 Set of ${(p.variants || []).length}` : b.kind === "template" ? `▭ Template · ${((p.slide || {}).els || []).length} items` :
      "🖼 Background" + (p.bgFx && p.bgFx !== "none" ? " · ✨" : "");
    const acts = b.kind === "template"
      ? `<button type="button" class="hlib-place" data-a="new" title="Insert as a new slide after this one">＋ New slide</button>
         <button type="button" data-a="pour" title="This slide gets the template's look — your words and photos stay">⇢ Pour in</button>`
      : b.kind === "bgset"
        ? `<button type="button" class="hlib-place" data-a="set" title="Title on the first slide, closing on the last, content in between">✦ Apply to deck</button>`
        : `<button type="button" class="hlib-place" data-a="slide">This slide</button><button type="button" data-a="all">All slides</button>`;
    c.innerHTML = `
      <div class="hlib-thumb"></div>
      <button type="button" class="hlib-pin${b.pinned ? " on" : ""}" title="${b.pinned ? "Unpin" : "Pin to the top"}">${b.pinned ? "★" : "☆"}</button>
      <div class="hlib-meta"><b title="${esc(b.name)}">${esc(b.name)}</b><small>${meta}${b.uses ? " · used " + b.uses + "×" : ""}</small></div>
      <div class="hlib-acts">${acts}<button type="button" class="hlib-more" aria-label="More">⋯</button></div>`;
    const th = c.querySelector(".hlib-thumb");
    thumbFor(th, b, 150, 92);
    if (b.kind !== "template") {                           // hover = try it on the real slide
      c.addEventListener("mouseenter", () => tryOn(b));
      c.addEventListener("mouseleave", tryOff);
    } else c.addEventListener("mouseenter", () => thumbFor(th, b, 150, 92, true));
    c.querySelectorAll(".hlib-acts [data-a]").forEach(btn => btn.addEventListener("click", () => {
      const a = btn.dataset.a;
      tryOff(true);
      if (a === "slide") applyBackground(b, [Deck.cur]);
      if (a === "all") applyBackground(b, Deck.slides.map((_, i) => i));
      if (a === "set") applySet(b);
      if (a === "new") templateNewSlide(b);
      if (a === "pour") pourIn(b);
    }));
    c.querySelector(".hlib-pin").addEventListener("click", () => update(b, { pinned: !b.pinned }));
    c.querySelector(".hlib-more").addEventListener("click", e => menu(b, e.currentTarget));
    return c;
  }

  /* ───────────── try-on preview (hover) ───────────── */
  let trial = null;
  function tryOn(b) {
    const s = Deck.slides[Deck.cur];
    if (!s) return;
    if (!trial) trial = { idx: Deck.cur, saved: clone(pick(s, BGF.concat(["els"]))) };
    let v = b.payload || {};
    if (b.kind === "bgset") v = roleFor(b, Deck.cur);
    const probe = Object.assign(clone(s), {});
    paintBg(probe, v);
    BGF.concat(["els"]).forEach(k => { s[k] = probe[k]; });
    API().renderAll();
    document.body.classList.add("hlib-trying");
  }
  function tryOff(keep) {
    if (!trial) return;
    const s = Deck.slides[trial.idx];
    if (s && keep !== true) { BGF.concat(["els"]).forEach(k => { s[k] = trial.saved[k]; }); API().renderAll(); }
    else if (s) { BGF.concat(["els"]).forEach(k => { s[k] = trial.saved[k]; }); }
    trial = null;
    document.body.classList.remove("hlib-trying");
  }
  function roleFor(b, i) {
    const vs = (b.payload || {}).variants || [];
    const find = r => vs.find(v => v.role === r);
    const last = Deck.slides.length - 1;
    return (i === 0 && find("Title")) || (i === last && last > 0 && find("Closing")) || find("Content") || vs[Math.min(1, vs.length - 1)] || vs[0] || {};
  }

  /* ───────────── applying ───────────── */
  function used(b) { req(itemUrl(b.id), "POST", { use: true }).then(d => Object.assign(b, d.item)).catch(() => {}); }
  function applyBackground(b, idxs) {
    let fixed = 0;
    idxs.forEach(i => { fixed += paintBg(Deck.slides[i], b.payload || {}); });
    API().commit(); used(b);
    toast(`🖼 “${b.name}” on ${idxs.length > 1 ? idxs.length + " slides" : "this slide"}${fixed ? ` · ${fixed} text colour${fixed > 1 ? "s" : ""} adjusted for readability` : ""} — Ctrl+Z to undo`);
  }
  function applySet(b) {
    let fixed = 0;
    Deck.slides.forEach((s, i) => { fixed += paintBg(s, roleFor(b, i)); });
    API().commit(); used(b);
    toast(`🎨 “${b.name}” across ${Deck.slides.length} slides — title, content and closing${fixed ? ` · ${fixed} text colours adjusted` : ""}`);
  }
  function shuffleDeck() {
    const pool = (items || []).filter(b => b.kind === "background" && (!tagFilter || tagFilter === "★" ? (!tagFilter || b.pinned) : (b.tags || []).includes(tagFilter)));
    if (pool.length < 2) { toast("Save at least two backgrounds to shuffle"); return; }
    let prev = null, fixed = 0;
    Deck.slides.forEach(s => {
      const choices = pool.filter(b => b !== prev);
      const b = choices[Math.floor(Math.random() * choices.length)];
      fixed += paintBg(s, b.payload || {}); prev = b;
    });
    API().commit();
    toast(`🎲 Dealt ${pool.length} backgrounds across ${Deck.slides.length} slides${fixed ? ` · ${fixed} text colours adjusted` : ""} — press again to reshuffle, Ctrl+Z to undo`);
  }
  function freshSlide(b) {
    const t = clone((b.payload || {}).slide || {});
    const s = Object.assign(Hx.newSlide ? Hx.newSlide() : { id: uid(), transition: "fade", notes: "", els: [] }, pick(t, BGF));
    s.id = uid();
    s.transition = t.transition || s.transition || "fade";
    s.els = (t.els || []).map(e => reId(e));
    return s;
  }
  function templateNewSlide(b) {
    const s = freshSlide(b);
    Deck.slides.splice(Deck.cur + 1, 0, s);
    Deck.cur += 1;
    API().commit(); used(b);
    if (API().gotoSlide) API().gotoSlide(Deck.cur);
    toast(`▭ New slide from “${b.name}” — Ctrl+Z to undo`);
  }
  // A template's look, this slide's words & pictures: biggest text → biggest text box, and so on.
  function pourIn(b) {
    const cur = Deck.slides[Deck.cur], fresh = freshSlide(b);
    const rank = list => list.filter(e => e.type === "text").sort((a, c) => (c.size || 0) - (a.size || 0) || (a.y || 0) - (c.y || 0));
    const mine = rank(cur.els || []).map(e => e.text).filter(t => String(t || "").trim());
    const boxes = rank(fresh.els);
    if (!mine.length) { toast("This slide has no text to pour in — use ＋ New slide instead"); return; }
    boxes.forEach((box, i) => { if (i < mine.length) box.text = mine[i]; });
    if (mine.length > boxes.length && boxes.length) boxes[boxes.length - 1].text += "\n" + mine.slice(boxes.length).join("\n");
    if (!boxes.length) fresh.els.push(...(cur.els || []).filter(e => e.type === "text").map(e => reId(clone(e))));
    const pics = (cur.els || []).filter(e => e.type === "image" && e.src).map(e => e.src);
    fresh.els.filter(e => e.type === "image").forEach((img, i) => { if (pics[i]) img.src = pics[i]; });
    BGF.forEach(k => { cur[k] = fresh[k]; });
    cur.transition = fresh.transition;
    cur.els = fresh.els;
    if (readable) makeReadable(cur, toneOf(cur.bg));
    API().commit(); used(b);
    toast(`⇢ Poured ${Math.min(mine.length, boxes.length || mine.length)} text block${mine.length > 1 ? "s" : ""}${pics.length ? " and your pictures" : ""} into “${b.name}” — Ctrl+Z to undo`);
  }
  function replaceWith(b) {
    const cur = Deck.slides[Deck.cur], fresh = freshSlide(b);
    BGF.forEach(k => { cur[k] = fresh[k]; });
    cur.transition = fresh.transition; cur.els = fresh.els;
    API().commit(); used(b);
    toast(`▭ This slide now uses “${b.name}” — Ctrl+Z to undo`);
  }

  function menu(b, anchor) {
    document.querySelectorAll(".hlib-menu").forEach(m => m.remove());
    const m = document.createElement("div");
    m.className = "hlib-menu";
    const design = DESIGN.has(b.kind);
    m.innerHTML = `<button type="button" data-a="rename">✎ Rename</button>
      ${design && b.prompt && window.HannsAIArea && window.HannsAIArea.startWith ? `<button type="button" data-a="remix">✦ Remix with AI</button>` : ""}
      ${design ? `<button type="button" data-a="copy">⧉ Place a copy on every slide…</button>` : ""}
      ${b.kind === "background" ? `<button type="button" data-a="range">▤ Apply to slides…</button>` : ""}
      ${b.kind === "template" ? `<button type="button" data-a="replace">⟲ Replace this slide with it</button>` : ""}
      <button type="button" data-a="delete" class="danger">🗑 Delete</button>`;
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.left = Math.min(innerWidth - 230, r.left - 150) + "px"; m.style.top = (r.bottom + 6) + "px";
    m.addEventListener("click", async e => {
      const a = (e.target.closest("button") || {}).dataset?.a; if (!a) return;
      m.remove();
      if (a === "rename") { const n = prompt("Rename this design", b.name); if (n && n.trim()) update(b, { name: n.trim() }); }
      if (a === "remix") { close(); window.HannsAIArea.startWith(b.prompt); toast("✦ Draw a box — the AI will make a fresh version of “" + b.name + "”"); }
      if (a === "copy") everySlide(b);
      if (a === "replace") replaceWith(b);
      if (a === "range") {
        const n = Deck.slides.length, ans = prompt(`Which slides? e.g. 2-6 or 1,3,5 (1–${n})`, `1-${n}`);
        if (!ans) return;
        const idx = new Set();
        ans.split(",").forEach(part => {
          const m2 = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/); if (!m2) return;
          let a1 = +m2[1], a2 = +(m2[2] || m2[1]); if (a1 > a2) [a1, a2] = [a2, a1];
          for (let i = a1; i <= a2; i++) if (i >= 1 && i <= n) idx.add(i - 1);
        });
        if (idx.size) applyBackground(b, [...idx].sort((x, y) => x - y)); else toast("No valid slide numbers");
      }
      if (a === "delete") {
        if (!confirm(`Delete “${b.name}” from your library? Slides that already use it keep their copy.`)) return;
        try { await req(itemUrl(b.id, "delete"), "POST", {}); items = items.filter(x => x.id !== b.id); render(); toast("Deleted"); }
        catch (er) { toast("⚠️ " + er.message); }
      }
    });
    setTimeout(() => document.addEventListener("click", function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("click", off); } }), 0);
  }
  async function update(b, patch) {
    try { const d = await req(itemUrl(b.id), "POST", patch); Object.assign(b, d.item); render(); }
    catch (e) { toast("⚠️ " + e.message); }
  }

  /* ───────────── putting a design on the slide ───────────── */
  function instantiate(b, x, y, k, slide) {
    const els = clone(b.els);
    els.forEach(e => { scaleEl(e, k); e.x = Math.round(e.x + x); e.y = Math.round(e.y + y); reId(e); });
    if (matchStyle) restyle(els, slideStyle(slide));
    return els;
  }
  function drop(b, x, y, k) {
    const slide = Deck.slides[Deck.cur];
    const els = instantiate(b, x, y, k, slide);
    slide.els = (slide.els || []).concat(els);
    API().commit();
    if (API().select) API().select(els.map(e => e.id));
    req(itemUrl(b.id), "POST", { use: true }).then(d => Object.assign(b, d.item)).catch(() => {});
    toast(`★ Placed “${b.name}”${matchStyle ? " in this slide's style" : ""} — Ctrl+Z to undo`);
  }
  function everySlide(b) {
    const n = Deck.slides.length;
    if (!confirm(`Place “${b.name}” on all ${n} slides, at the same spot and size it was saved?`)) return;
    const k = Math.min(1, (W * 0.9) / b.w, (H * 0.9) / b.h);
    Deck.slides.forEach(s => { s.els = (s.els || []).concat(instantiate(b, Math.round((W - b.w * k) / 2), Math.round((H - b.h * k) / 2), k, s)); });
    API().commit();
    req(itemUrl(b.id), "POST", { use: true }).catch(() => {});
    toast(`★ Added “${b.name}” to all ${n} slides — Ctrl+Z to undo`);
  }

  // placement overlay shared by Place and Fit
  let ov = null;
  function canvasRect() { const c = document.getElementById("canvas"); return c && c.getBoundingClientRect(); }
  function overlay(hintHtml) {
    endOverlay();
    const r = canvasRect(); if (!r) return null;
    ov = { layer: document.createElement("div"), hint: document.createElement("div"), raf: 0 };
    ov.layer.className = "hlib-layer"; ov.hint.className = "hlib-hint"; ov.hint.innerHTML = hintHtml;
    document.body.appendChild(ov.layer); document.body.appendChild(ov.hint);
    const glue = () => {
      const q = canvasRect(); if (!q || !ov) return;
      Object.assign(ov.layer.style, { left: q.left + "px", top: q.top + "px", width: q.width + "px", height: q.height + "px" });
      ov.z = q.width / W; ov.rect = q;
      if (ov.onFrame) ov.onFrame();
      ov.raf = requestAnimationFrame(glue);
    };
    glue();
    return ov;
  }
  function endOverlay() { if (!ov) return; cancelAnimationFrame(ov.raf); ov.layer.remove(); ov.hint.remove(); ov = null; }
  function toSlide(e) { return { x: (e.clientX - ov.rect.left) / ov.z, y: (e.clientY - ov.rect.top) / ov.z }; }

  function startPlace(b) {
    close();
    const o = overlay(`★ <b>${esc(b.name)}</b> — click to place · scroll or <kbd>+</kbd><kbd>−</kbd> to resize · <kbd>Esc</kbd> to cancel`);
    if (!o) return;
    let k = Math.min(1, (W * 0.8) / b.w, (H * 0.8) / b.h), at = { x: W / 2, y: H / 2 };
    const ghost = document.createElement("div");
    ghost.className = "hlib-phantom";
    const inner = document.createElement("div");
    inner.style.width = b.w + "px"; inner.style.height = b.h + "px"; inner.style.transformOrigin = "0 0";
    try { paintSlide(inner, { bg: "transparent", bgFx: "none", els: clone(b.els) }, { live: false, revealAll: true }); } catch (_) { /* ignore */ }
    ghost.appendChild(inner); o.layer.appendChild(ghost);
    const tag = document.createElement("span"); tag.className = "hlib-size"; ghost.appendChild(tag);
    const pos = () => {                      // top-left so the design is centred on the cursor, kept on the slide
      const w = b.w * k, h = b.h * k;
      return { x: Math.round(Math.max(-w * 0.5, Math.min(W - w * 0.5, at.x - w / 2))), y: Math.round(Math.max(-h * 0.5, Math.min(H - h * 0.5, at.y - h / 2))) };
    };
    o.onFrame = () => {
      const p = pos();
      Object.assign(ghost.style, { left: p.x * o.z + "px", top: p.y * o.z + "px", width: b.w * k * o.z + "px", height: b.h * k * o.z + "px" });
      inner.style.transform = `scale(${k * o.z})`;
      tag.textContent = Math.round(b.w * k) + " × " + Math.round(b.h * k);
    };
    o.layer.addEventListener("pointermove", e => { at = toSlide(e); });
    o.layer.addEventListener("wheel", e => { e.preventDefault(); k = Math.max(0.12, Math.min(4, k * (e.deltaY < 0 ? 1.08 : 1 / 1.08))); }, { passive: false });
    o.layer.addEventListener("click", e => { at = toSlide(e); const p = pos(); endOverlay(); drop(b, p.x, p.y, k); });
    o.key = e => {
      if (e.key === "+" || e.key === "=") k = Math.min(4, k * 1.1);
      if (e.key === "-" || e.key === "_") k = Math.max(0.12, k / 1.1);
    };
  }
  function startFit(b) {
    close();
    const o = overlay(`⬚ Drag a box for <b>${esc(b.name)}</b> — it will scale to fit · <kbd>Esc</kbd> to cancel`);
    if (!o) return;
    const box = document.createElement("div"); box.className = "hlib-fitbox"; box.hidden = true; o.layer.appendChild(box);
    let a = null, r = null;
    o.layer.addEventListener("pointerdown", e => { a = toSlide(e); r = { x: a.x, y: a.y, w: 1, h: 1 }; box.hidden = false; o.layer.setPointerCapture(e.pointerId); });
    o.layer.addEventListener("pointermove", e => { if (!a) return; const p = toSlide(e); r = { x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) }; });
    o.layer.addEventListener("pointerup", () => {
      if (!a) return;
      a = null;
      if (r.w < 16 || r.h < 12) { box.hidden = true; toast("Drag a bigger box"); return; }
      const k = Math.min(r.w / b.w, r.h / b.h);
      const x = r.x + (r.w - b.w * k) / 2, y = r.y + (r.h - b.h * k) / 2;
      endOverlay(); drop(b, x, y, k);
    });
    o.onFrame = () => { if (r && !box.hidden) Object.assign(box.style, { left: r.x * o.z + "px", top: r.y * o.z + "px", width: r.w * o.z + "px", height: r.h * o.z + "px" }); };
  }
  // drag a card straight onto the slide
  function wireDrop() {
    const wrap = document.getElementById("canvas-wrap") || document.getElementById("canvas");
    if (!wrap) return;
    wrap.addEventListener("dragover", e => { if ([...(e.dataTransfer.types || [])].includes("text/x-hanns-design")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; wrap.classList.add("hlib-dropping"); } });
    wrap.addEventListener("dragleave", () => wrap.classList.remove("hlib-dropping"));
    wrap.addEventListener("drop", e => {
      const id = e.dataTransfer.getData("text/x-hanns-design");
      wrap.classList.remove("hlib-dropping");
      if (!id) return;
      e.preventDefault(); e.stopPropagation();
      const b = (items || []).find(x => String(x.id) === id); if (!b) return;
      const q = canvasRect(), z = q.width / W;
      const k = Math.min(1, (W * 0.8) / b.w, (H * 0.8) / b.h);
      const cx = (e.clientX - q.left) / z, cy = (e.clientY - q.top) / z;
      drop(b, Math.round(cx - (b.w * k) / 2), Math.round(cy - (b.h * k) / 2), k);
    }, true);
  }

  /* ───────────── wiring ───────────── */
  document.addEventListener("keydown", e => {
    const mod = e.ctrlKey || e.metaKey;
    if (ov) {
      if (e.key === "Escape") { e.preventDefault(); endOverlay(); toast("Cancelled"); return; }
      if (ov.key) ov.key(e);
      return;
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === "b" && !e.target.matches("input,textarea,[contenteditable]")) { e.preventDefault(); saveSelection(); }
    if (mod && e.shiftKey && e.key.toLowerCase() === "l") { e.preventDefault(); panel && panel.classList.contains("on") ? close() : open(); }
    if (e.key === "Escape" && panel && panel.classList.contains("on") && !e.target.matches("input,textarea")) close();
  });
  document.addEventListener("click", () => { if (panel && panel.classList.contains("on")) setTimeout(refreshSelCount, 30); }, true);
  function addButton() {
    const have = document.getElementById("btn-design-lib");
    if (have) {                              // editor.html ships it
      have.addEventListener("click", () => (panel && panel.classList.contains("on") ? close() : open()));
      wireDrop();
      return;
    }
    const after = document.getElementById("btn-ai-area") || document.getElementById("btn-ai-design");
    if (!after) return;
    const b = document.createElement("button");
    b.type = "button"; b.id = "btn-design-lib";
    b.className = (document.getElementById("btn-ai-design") || after).className.replace(/\bai-btn\b/, "") + " hlib-btn";
    b.title = "My design library — saved designs to reuse on any slide (Ctrl+Shift+L). Save a selection with Ctrl+Shift+B";
    b.innerHTML = `<span aria-hidden="true">★</span> Library`;
    b.addEventListener("click", () => (panel && panel.classList.contains("on") ? close() : open()));
    after.insertAdjacentElement("afterend", b);
    wireDrop();
  }
  // the area tool adds its button on DOMContentLoaded too; go after it
  const boot = () => setTimeout(addButton, 0);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  /* ───────────── ☆ stars on the built-in galleries ───────────── */
  function starButton(title, onSave) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "hlib-star"; b.textContent = "☆"; b.title = title;
    b.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); onSave(b).then(ok => { if (ok) { b.textContent = "★"; b.classList.add("on"); } }); });
    b.addEventListener("pointerdown", e => e.stopPropagation());
    return b;
  }
  function starGalleries() {
    const tg = document.getElementById("tpl-grid");
    if (tg) [...tg.children].forEach((card, i) => {
      if (card.querySelector(".hlib-star") || !Hx.TEMPLATES) return;
      const name = (card.querySelector(".tname") || {}).textContent;
      const tpl = Hx.TEMPLATES.find(t => t.name === name) || Hx.TEMPLATES[i];
      if (!tpl) return;
      card.appendChild(starButton("Save “" + tpl.name + "” to my library", from => {
        const built = tpl.build();
        return saveTemplate({ bg: built.bg, bgSize: built.bgSize || null, bgFx: built.bgFx || "none", els: built.els, transition: built.transition || "fade" },
          { name: tpl.name, tags: ["Built-in"], from });
      }));
    });
    const bgr = document.getElementById("bg-grid");
    if (bgr) {
      [...bgr.querySelectorAll(".bg-cell")].forEach((cell, i) => {
        if (cell.querySelector(".hlib-star") || !Hx.BACKGROUNDS || !Hx.BACKGROUNDS[i]) return;
        const b = Hx.BACKGROUNDS[i];
        cell.appendChild(starButton("Save “" + b.name + "” to my library", from => saveBackground({ bg: b.css, bgSize: b.size || null, bgMode: "preset" }, { name: b.name, from })));
      });
      if (!document.getElementById("hlib-bg-save")) {
        const btn = document.createElement("button");
        btn.type = "button"; btn.id = "hlib-bg-save"; btn.className = "hlib-drawer-save";
        btn.innerHTML = "☆ Save this slide's background to my library";
        btn.addEventListener("click", () => saveCurrentBackground(btn));
        bgr.parentNode.insertBefore(btn, bgr);
      }
    }
  }
  function watchGalleries() {
    starGalleries();
    ["tpl-grid", "bg-grid"].forEach(id => {
      const g = document.getElementById(id);
      if (g && window.MutationObserver) new MutationObserver(() => starGalleries()).observe(g, { childList: true });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(watchGalleries, 50)); else setTimeout(watchGalleries, 50);

  window.HannsLibrary = { open, close, saveDesign, saveSelection, saveBackground, saveBgSet, saveTemplate, load };
})();
