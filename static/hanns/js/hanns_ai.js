/* ════════════════════════════════════════════════════════════════════
   HANNS AI STUDIO — Gemini-powered design assistant for the Hanns editor
   ════════════════════════════════════════════════════════════════════
   Talks ONLY to the Django endpoint (SRV.aiUrl); the Gemini key never
   reaches the browser. Everything the model returns is treated as
   untrusted: element types, fonts, animations, transitions and background
   effects are validated against Hanns' live catalogues, geometry is
   clamped to the canvas, and CSS backgrounds may not load remote URLs.

   Tabs
   ✨ Create       whole story-driven deck from a topic, or one slide
   🎨 Backgrounds  AI-painted SVG art (3 matched variants: title/content/closing)
   🪄 Magic        Polish (clean layout + type) · Decorate · Animate — slide or deck,
                   with a before/after comparison slider
   💡 Ideas        creative-director review: slide ideas you can build in one click
   🗣 Notes        teleprompter-ready speaker notes
   ✍️ Rewrite      rewrite / translate the selected text box

   Every apply is ONE undo step (Ctrl+Z) via HannsEditorAPI.commit().
   Depends on: window.Hanns (hanns_core.js), window.HannsEditorAPI and
   window.__HANNS__ (hanns_editor.js / editor.html).
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const Hx = window.Hanns;
  const SRV = window.__HANNS__ || {};
  if (!Hx || !SRV.aiUrl) return;
  const API = () => window.HannsEditorAPI || {};
  const { Deck, BG_FX, ANIMS, TRANSITIONS, FONTS, newSlide, curSlide, selEl, paintSlide,
          makeText, makeShape, makeLine, makeChart, makeFreeform, W, H, uid } = Hx;

  const BGFX_KEYS = new Set((BG_FX || []).map(f => f.key));
  const ANIM_KEYS = new Set(Object.keys(ANIMS || {}));
  const TRANS_KEYS = new Set(Object.keys(TRANSITIONS || {}));
  const FREEFORM_KEYS = new Set(["polygon", "star", "burst", "blob", "arrow", "chevron", "cross", "bubble", "wave", "heart", "drop"]);
  const CHART_KEYS = new Set(["bar", "lollipop", "combo", "pareto", "line", "spline", "area", "pie", "donut", "scatter", "bubble",
    "radar", "pyramid", "gauge", "progress", "funnel", "waterfall", "heatmap", "treemap", "kpi"]);

  // ───────────────────────── small utils ─────────────────────────
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const clone = o => JSON.parse(JSON.stringify(o));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|transparent|none|[a-z]{3,20})$/i;
  const color = (v, d) => (typeof v === "string" && COLOR_RE.test(v.trim()) ? v.trim() : d);
  function toast(m) { (API().toast || (x => console.log(x)))(m); }

  // CSS backgrounds from the model may not reference any URL — only our
  // own server-saved SVG art (built server-side) is allowed through.
  function safeBg(v, d) {
    if (typeof v !== "string" || !v.trim() || v.length > 1500) return d;
    if (/url\s*\(/i.test(v) && !/^url\("\/media\//.test(v.trim())) return d;
    if (/expression|javascript:|@import|[<>{};]/i.test(v)) return d;
    return v.trim();
  }

  const FONT_MAP = (() => {
    const m = {};
    (FONTS || []).forEach(f => {
      m[f.label.toLowerCase()] = f.css;
      const fam = (f.css.match(/"([^"]+)"/) || [])[1];
      if (fam) m[fam.toLowerCase()] = f.css;
      m[f.label.split(" ")[0].toLowerCase()] = m[f.label.split(" ")[0].toLowerCase()] || f.css;
    });
    return m;
  })();
  function font(v, d) {
    if (typeof v !== "string") return d;
    const k = v.toLowerCase().replace(/["']/g, "").split(",")[0].trim();
    return FONT_MAP[k] || FONT_MAP[k.split(" ")[0]] || d;
  }

  function lum(hex) {
    const m = String(hex || "").match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
    if (!m) return null;
    let h = m[1]; if (h.length === 3) h = h.split("").map(c => c + c).join("");
    const c = [0, 2, 4].map(i => { const v = parseInt(h.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { const x = lum(a), y = lum(b); if (x == null || y == null) return 21; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }

  // ───────────────────────── validation ─────────────────────────
  function fxOf(f) {
    if (!f || typeof f !== "object") return undefined;
    const o = {};
    if (f.shadow) { o.shadow = true; o.sblur = num(f.sblur, 0, 60, 14); o.scolor = color(f.scolor, "rgba(0,0,0,.35)"); o.sy = num(f.sy, -40, 40, 6); }
    if (f.glow) { o.glow = true; o.gsize = num(f.gsize, 2, 40, 12); o.gcolor = color(f.gcolor, "#7dd3fc"); }
    if (f.d3) { o.d3 = true; o.rx = num(f.rx, -40, 40, 0); o.ry = num(f.ry, -40, 40, 0); }
    if (f.depth) o.depth = num(f.depth, 0, 16, 0);
    if (["multiply", "screen", "overlay", "soft-light"].includes(f.blend)) o.blend = f.blend;
    return Object.keys(o).length ? o : undefined;
  }

  function geom(r, el) {
    el.w = num(r.w, 8, W * 1.2, el.w);
    el.h = num(r.h, 2, H * 1.2, el.h);
    el.x = num(r.x, -el.w * 0.5, W - 8, el.x);
    el.y = num(r.y, -el.h * 0.5, H - 8, el.y);
    el.rot = num(r.rot, -360, 360, 0);
    el.anim = ANIM_KEYS.has(r.anim) ? r.anim : el.anim;
    if (el.anim === "typewriter" && el.type !== "text") el.anim = "fade";
    el.animDelay = num(r.animDelay, 0, 6, 0);
    const fx = fxOf(r.fx); if (fx) el.fx = fx;
    return el;
  }

  function normEl(r) {
    if (!r || typeof r !== "object") return null;
    const t = String(r.type || "").toLowerCase();
    let el;
    if (t === "text") {
      const text = String(r.text == null ? "" : r.text).slice(0, 1200);
      if (!text.trim()) return null;
      el = makeText({
        text, font: font(r.font, '"Archivo",sans-serif'), size: num(r.size, 8, 260, 32),
        weight: num(r.weight, 100, 900, 600), italic: !!r.italic, color: color(r.color, "#16140f"),
        align: ["left", "center", "right"].includes(r.align) ? r.align : "left",
        lh: num(r.lh, 0.8, 2.2, 1.15), ls: num(r.ls, -4, 20, 0), fill: color(r.fill, "none"),
      });
      geom(r, el);
      // Make sure the box is tall enough for the text it holds.
      const lines = Math.max(text.split("\n").length, Math.ceil(text.length * el.size * 0.52 / Math.max(80, el.w)));
      el.h = Math.max(el.h, Math.min(H, Math.round(lines * el.size * el.lh * 1.12)));
    } else if (t === "rect" || t === "ellipse") {
      el = makeShape(t, { fill: color(r.fill, "#e8482b"), stroke: color(r.stroke, "none"), strokeW: num(r.strokeW, 0, 20, 0),
        radius: num(r.radius, 0, 400, 14), motion: "none" });
      geom(r, el);
    } else if (t === "line") {
      el = makeLine({ fill: color(r.fill || r.color, "#16140f") });
      geom(r, el);
    } else if (t === "freeform" && makeFreeform) {
      const kind = FREEFORM_KEYS.has(r.shapeKind) ? r.shapeKind : "blob";
      el = makeFreeform(kind, {
        sides: num(r.sides, 3, 14, 6), inset: num(r.inset, 0.15, 0.9, 0.45), smooth: !!r.smooth,
        fillMode: ["solid", "linear", "radial", "none"].includes(r.fillMode) ? r.fillMode : "solid",
        fill: color(r.fill, "#e8482b"), fill2: color(r.fill2, "#f2c14e"), gradAngle: num(r.gradAngle, 0, 360, 135),
        stroke: color(r.stroke, "none"), strokeW: num(r.strokeW, 0, 12, 0),
      });
      geom(r, el);
    } else if (t === "chart") {
      const kind = CHART_KEYS.has(r.chartKind) ? r.chartKind : "bar";
      const data = Array.isArray(r.chartData) ? r.chartData.slice(0, 10)
        .map(d => ({ label: String((d && d.label) || "").slice(0, 30), value: num(d && d.value, -1e9, 1e9, 0) }))
        .filter(d => d.label) : null;
      const over = { title: String(r.title || "").slice(0, 80), accent: color(r.accent, "#e8482b"),
        valueSuffix: String(r.valueSuffix || "").slice(0, 4), chartThemeMode: r.chartThemeMode === "dark" ? "dark" : "light" };
      if (data && data.length >= 2) {
        over.chartData = data;
        over.max = Math.max(100, ...data.map(d => d.value));
      }
      if (Array.isArray(r.palette)) { const p = r.palette.map(c => color(c, null)).filter(Boolean); if (p.length) over.palette = p.slice(0, 8); }
      el = makeChart(kind, over);
      geom(r, el);
    } else {
      return null; // images, maps, tables… are never created by the AI
    }
    el.id = uid();
    return el;
  }

  function normSlide(r, base) {
    r = r || {};
    const s = Object.assign(newSlide(), base || {});
    s.id = uid();
    s.bg = safeBg(r.bg, s.bg || "#0f172a");
    s.bgSize = null;
    s.bgFx = BGFX_KEYS.has(r.bgFx) ? r.bgFx : "none";
    s.transition = TRANS_KEYS.has(r.transition) ? r.transition : "fade";
    s.notes = typeof r.notes === "string" ? r.notes.slice(0, 3000) : "";
    s.els = (Array.isArray(r.els) ? r.els : []).slice(0, 40).map(normEl).filter(Boolean);
    return s;
  }

  // A copy of slides that's light enough to send (no data: images).
  function lite(slide) {
    return JSON.parse(JSON.stringify(slide, (k, v) => (typeof v === "string" && v.length > 2000 && v.startsWith("data:")) ? "" : v));
  }
  function outline() {
    return Deck.slides.map((s, i) => {
      const t = (s.els || []).filter(e => e.type === "text" && e.text).map(e => String(e.text).replace(/\n/g, " ").slice(0, 90));
      return (i + 1) + ". " + (t.slice(0, 3).join(" | ") || "(visual slide)");
    }).join("\n");
  }

  // ───────────────────────── server calls ─────────────────────────
  let busy = null;
  let lastNotice = null;   // set when a fallback produced the result
  async function call(action, payload, label, opts) {
    opts = opts || {};
    if (busy) { toast("The AI is still working on the last request"); return null; }
    const ctrl = new AbortController();
    busy = ctrl;
    lastNotice = null;
    // The server gives up after ~150 s and answers with a clear message;
    // this is only a backstop so the panel can never spin forever.
    const giveUp = setTimeout(() => { ctrl.timedOut = true; ctrl.abort(); }, 175000);
    if (opts.wave) waveLabel(label); else showLoading(action, label);
    try {
      const r = await fetch(SRV.aiUrl, {
        method: "POST", credentials: "same-origin", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "X-CSRFToken": SRV.csrftoken || "" },
        body: JSON.stringify(Object.assign({ action }, payload || {})),
      });
      let data = null; try { data = await r.json(); } catch (_) { /* html error page */ }
      if (data && typeof data.quotaLeft === "number") setQuota(data.quotaLeft);
      if (!r.ok || !data || !data.ok) throw new Error((data && data.error) || ("The AI request failed (" + r.status + ")"));
      if (data.model) {
        $("#kai-model").textContent = data.model === "hanns-builtin" ? "built-in designer (AI unavailable)"
          : data.model.indexOf("fallback:") === 0 ? "via backup AI · " + data.model.slice(9) : "via " + data.model;
      }
      lastNotice = data.notice || null;
      if (lastNotice) {
        // After the caller has painted its result, make sure the notice
        // sits at the top of the active tab's output (once).
        const note = lastNotice;
        setTimeout(() => {
          const pane = root.querySelector(".kai-pane.on .kai-out");
          if (pane && pane.children.length && !pane.querySelector(".kai-notice")) {
            pane.insertAdjacentHTML("afterbegin", `<div class="kai-notice">🛟 ${esc(note)}</div>`);
          }
        }, 0);
      }
      return data.result;
    } catch (e) {
      if (e.name === "AbortError" && !ctrl.timedOut) { toast("AI request cancelled"); return null; }
      // fetch() rejects with TypeError ("NetworkError when attempting to fetch
      // resource" / "Failed to fetch") when the connection drops before any
      // answer — usually a proxy timeout on a long request, or the server
      // restarting. Say that in plain words instead of the raw browser text.
      const dropped = ctrl.timedOut || e instanceof TypeError || /networkerror|failed to fetch|load failed/i.test(e.message || "");
      showError(dropped
        ? "The connection to the server dropped before the AI finished. If the server was just restarted, try again in a moment; otherwise try a smaller request (fewer slides, or one slide)."
        : (e.message || "Something went wrong"));
      return null;
    } finally {
      clearTimeout(giveUp);
      busy = null;
      if (!opts.wave) hideLoading();
    }
  }

  // ───────────────────────── mini slide previews ─────────────────────────
  function mini(slide, cls) {
    const box = document.createElement("div");
    box.className = "kai-mini" + (cls ? " " + cls : "");
    const stage = document.createElement("div");
    stage.className = "kai-mini-stage";
    stage.style.width = W + "px"; stage.style.height = H + "px";
    try { paintSlide(stage, slide, { live: false, revealAll: true }); } catch (e) { stage.textContent = "Preview unavailable"; }
    box.appendChild(stage);
    const fit = () => { const sc = box.clientWidth / W; if (sc > 0) stage.style.transform = `scale(${sc})`; };
    requestAnimationFrame(fit);
    new ResizeObserver(fit).observe(box);
    return box;
  }

  // Before/after comparison with a draggable divider.
  function compare(before, after) {
    const wrap = document.createElement("div");
    wrap.className = "kai-compare";
    const a = mini(before, "kai-cmp-before"), b = mini(after, "kai-cmp-after");
    const knob = document.createElement("div");
    knob.className = "kai-cmp-knob";
    knob.innerHTML = '<span>◂ ▸</span>';
    wrap.append(a, b, knob);
    wrap.insertAdjacentHTML("beforeend", '<span class="kai-cmp-tag l">Before</span><span class="kai-cmp-tag r">After ✦</span>');
    const set = p => { p = Math.max(0, Math.min(100, p)); b.style.clipPath = `inset(0 0 0 ${p}%)`; knob.style.left = p + "%"; };
    let drag = false;
    const move = e => { if (!drag) return; const r = wrap.getBoundingClientRect(); set(((e.clientX - r.left) / r.width) * 100); };
    wrap.addEventListener("pointerdown", e => { drag = true; wrap.setPointerCapture(e.pointerId); move(e); });
    wrap.addEventListener("pointermove", move);
    wrap.addEventListener("pointerup", () => { drag = false; });
    // A little sweep so people discover it's draggable.
    set(100);
    setTimeout(() => { b.style.transition = "clip-path .9s cubic-bezier(.2,.8,.3,1)"; knob.style.transition = "left .9s cubic-bezier(.2,.8,.3,1)"; set(45); }, 120);
    setTimeout(() => { b.style.transition = ""; knob.style.transition = ""; }, 1100);
    return wrap;
  }

  // ───────────────────────── drawer UI ─────────────────────────
  let root = null;
  const $ = s => root.querySelector(s);
  const $$ = s => Array.from(root.querySelectorAll(s));

  const TONE_PILLS = [["bold", "🔥 Bold"], ["elegant", "🕊 Elegant"], ["playful", "🎈 Playful"], ["corporate", "🏛 Corporate"], ["minimal", "◽ Minimal"], ["dark", "🌌 Cinematic"]];
  const BG_STYLES = [["auto", "✦ Surprise me"], ["aurora mesh gradient with soft glowing orbs", "🌈 Aurora mesh"], ["flowing layered liquid waves", "🌊 Liquid waves"],
    ["bold geometric tessellation, Bauhaus inspired", "🔷 Geometric"], ["topographic contour lines", "🗺 Topographic"], ["dark night with bokeh light orbs", "✨ Bokeh night"],
    ["West African kente / mud-cloth inspired pattern, rich warm colours", "🧵 Kente-inspired"], ["cosmic nebula with stars and planets glow", "🪐 Cosmic"],
    ["organic paper-cut layers, nature, leaves", "🍃 Paper-cut nature"], ["minimal soft gradient with subtle grain", "◽ Minimal grain"], ["futuristic neon tech grid, circuits", "⚡ Neon tech"]];
  const LOADING = {
    deck: ["Outlining the story arc…", "Choosing a palette…", "Designing layouts…", "Writing headlines…", "Choreographing animations…"],
    slide: ["Sketching the layout…", "Picking type…", "Adding the finishing touches…"],
    background: ["Mixing colours…", "Painting gradients…", "Adding light and depth…", "Varnishing the canvas…"],
    polish: ["Aligning to the grid…", "Fixing the type scale…", "Balancing whitespace…"],
    decorate: ["Choosing ornaments…", "Framing the content…"],
    animate: ["Blocking the scene…", "Timing the entrances…", "Picking transitions…"],
    ideas: ["Reading your deck…", "Thinking like a creative director…"],
    notes: ["Finding the story…", "Writing what you'll say…"],
    rewrite: ["Finding better words…"],
  };

  function build() {
    root = document.createElement("aside");
    root.id = "kai";
    root.className = "kai";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Hanns AI Studio");
    root.innerHTML = `
      <div class="kai-glow" aria-hidden="true"></div>
      <header class="kai-head">
        <div class="kai-logo" aria-hidden="true">✦</div>
        <div class="kai-title"><b>Hanns AI Studio</b><small id="kai-model">powered by Gemini</small></div>
        <span class="kai-quota" id="kai-quota" title="AI requests left this hour">—</span>
        <button type="button" class="kai-x" id="kai-close" aria-label="Close AI Studio">✕</button>
      </header>
      <nav class="kai-tabs" role="tablist">
        ${[["create", "✨", "Create"], ["bg", "🎨", "Backdrops"], ["magic", "🪄", "Magic"], ["ideas", "💡", "Ideas"], ["notes", "🗣", "Notes"], ["rewrite", "✍️", "Rewrite"]]
          .map(([k, i, l], n) => `<button type="button" role="tab" class="kai-tab${n ? "" : " on"}" data-tab="${k}"><span>${i}</span>${l}</button>`).join("")}
      </nav>
      <div class="kai-body">
        <div class="kai-setup" id="kai-setup" hidden></div>

        <!-- CREATE -->
        <section class="kai-pane on" data-pane="create">
          <div class="kai-seg" role="group">
            <button type="button" class="on" data-mode="deck">Whole deck</button>
            <button type="button" data-mode="slide">One slide</button>
          </div>
          <label class="kai-label" for="kai-c-prompt" id="kai-c-label">What's your presentation about?</label>
          <textarea id="kai-c-prompt" rows="4" placeholder="e.g. Launching a solar-powered irrigation programme for women farmers in the Upper River Region"></textarea>
          <div class="kai-chips" id="kai-c-chips"></div>
          <div class="kai-row kai-deck-only">
            <label class="kai-label grow">Audience<input id="kai-c-aud" type="text" placeholder="e.g. donors, ministry staff, students"></label>
            <label class="kai-label">Slides <b id="kai-c-nv">6</b><input id="kai-c-n" type="range" min="3" max="12" value="6"></label>
          </div>
          <div class="kai-label">Style</div>
          <div class="kai-pills" id="kai-c-tone">${TONE_PILLS.map(([k, l], i) => `<button type="button" class="kai-pill${i ? "" : " on"}" data-v="${k}">${l}</button>`).join("")}</div>
          <button type="button" class="kai-go" id="kai-c-go">✦ <span>Create my deck</span></button>
          <div class="kai-out" id="kai-c-out"></div>
        </section>

        <!-- BACKGROUNDS -->
        <section class="kai-pane" data-pane="bg">
          <p class="kai-lead">Gemini paints original <b>vector art</b> backdrops — three that match: title, content and closing.</p>
          <label class="kai-label" for="kai-b-prompt">Mood or subject</label>
          <textarea id="kai-b-prompt" rows="2" placeholder="e.g. sunrise over the Gambia river, hopeful, gold and teal"></textarea>
          <div class="kai-label">Art style</div>
          <div class="kai-pills" id="kai-b-style">${BG_STYLES.map(([k, l], i) => `<button type="button" class="kai-pill${i ? "" : " on"}" data-v="${esc(k)}">${l}</button>`).join("")}</div>
          <label class="kai-check"><input type="checkbox" id="kai-b-match" checked> Inspired by this deck's content</label>
          <label class="kai-check"><input type="checkbox" id="kai-b-contrast" checked> Fix text colours for readability when applying</label>
          <button type="button" class="kai-go" id="kai-b-go">🎨 <span>Paint backgrounds</span></button>
          <div class="kai-out" id="kai-b-out"></div>
        </section>

        <!-- MAGIC -->
        <section class="kai-pane" data-pane="magic">
          <div class="kai-seg" role="group" id="kai-m-scope">
            <button type="button" class="on" data-scope="slide">This slide</button>
            <button type="button" data-scope="range">Slides…</button>
            <button type="button" data-scope="deck">Whole deck</button>
          </div>
          <div class="kai-range" id="kai-m-scope-range" hidden>
            Slides <input type="number" min="1" value="1" data-r="from" aria-label="From slide"> to
            <input type="number" min="1" value="1" data-r="to" aria-label="To slide">
            <small class="kai-range-n"></small>
          </div>
          <div class="kai-cards">
            <div class="kai-card kai-card-wide" data-magic="edit">
              <div class="kai-card-ic">💬</div><div><b>Tell the AI what to change</b>
              <p>Any instruction, applied to every slide in scope — in waves, so long decks are fully covered.</p>
              <textarea id="kai-m-edit" rows="2" placeholder="e.g. Make every title gold and 64px, and add a small footer with 'Knock-Knock · 2026' on each slide"></textarea>
              <div class="kai-chips sm" id="kai-m-edit-chips"></div>
              <button type="button" class="kai-run">💬 Apply to slides</button></div>
            </div>
            <div class="kai-card" data-magic="polish">
              <div class="kai-card-ic">🧹</div><div><b>Polish</b><p>Clean alignment, spacing, type scale, colour and contrast.</p>
              <label class="kai-check sm"><input type="checkbox" id="kai-m-fix"> Also fix wording &amp; typos</label>
              <button type="button" class="kai-run">🧹 Polish it</button></div>
            </div>
            <div class="kai-card" data-magic="decorate">
              <div class="kai-card-ic">🎀</div><div><b>Decorate</b><p>Tasteful shapes and accents that frame your content.</p>
              <div class="kai-pills sm" id="kai-m-deco">${["Minimal lines", "Bold geometric", "Organic blobs", "Tech HUD", "Festive", "Kente-inspired"].map((l, i) => `<button type="button" class="kai-pill${i ? "" : " on"}" data-v="${l}">${l}</button>`).join("")}</div>
              <button type="button" class="kai-run">🎀 Decorate it</button></div>
            </div>
            <div class="kai-card" data-magic="animate">
              <div class="kai-card-ic">🎬</div><div><b>Animate</b><p>Story-driven entrances, timing and transitions.</p>
              <div class="kai-pills sm" id="kai-m-energy">${[["subtle", "Subtle"], ["cinematic", "Cinematic"], ["energetic", "Energetic"]].map(([k, l], i) => `<button type="button" class="kai-pill${i === 1 ? " on" : ""}" data-v="${k}">${l}</button>`).join("")}</div>
              <button type="button" class="kai-run">🎬 Animate it</button></div>
            </div>
          </div>
          <button type="button" class="kai-ghost" id="kai-m-strip" title="Remove every shape the AI added with Decorate">Remove AI decorations</button>
          <div class="kai-out" id="kai-m-out"></div>
        </section>

        <!-- IDEAS -->
        <section class="kai-pane" data-pane="ideas">
          <p class="kai-lead">Your AI creative director reads the deck and suggests what would make it unforgettable.</p>
          <label class="kai-label" for="kai-i-prompt">Anything specific? <small>(optional)</small></label>
          <input id="kai-i-prompt" type="text" placeholder="e.g. make it more persuasive for funders">
          <button type="button" class="kai-go" id="kai-i-go">💡 <span>Give me ideas</span></button>
          <div class="kai-out" id="kai-i-out"></div>
        </section>

        <!-- NOTES -->
        <section class="kai-pane" data-pane="notes">
          <p class="kai-lead">Speaker notes you can read from the Hanns teleprompter on your phone.</p>
          <div class="kai-seg" role="group" id="kai-n-scope">
            <button type="button" class="on" data-scope="slide">This slide</button>
            <button type="button" data-scope="range">Slides…</button>
            <button type="button" data-scope="deck">Whole deck</button>
          </div>
          <div class="kai-range" id="kai-n-scope-range" hidden>
            Slides <input type="number" min="1" value="1" data-r="from" aria-label="From slide"> to
            <input type="number" min="1" value="1" data-r="to" aria-label="To slide">
            <small class="kai-range-n"></small>
          </div>
          <div class="kai-pills" id="kai-n-tone">${[["conversational", "😊 Conversational"], ["inspiring", "🚀 Inspiring"], ["formal", "🎓 Formal"], ["concise", "⚡ Concise"]].map(([k, l], i) => `<button type="button" class="kai-pill${i ? "" : " on"}" data-v="${k}">${l}</button>`).join("")}</div>
          <button type="button" class="kai-go" id="kai-n-go">🗣 <span>Write my notes</span></button>
          <div class="kai-out" id="kai-n-out"></div>
        </section>

        <!-- REWRITE -->
        <section class="kai-pane" data-pane="rewrite">
          <div class="kai-sel" id="kai-r-sel"></div>
          <div class="kai-pills" id="kai-r-style">${["Punchier", "Simpler", "Shorter", "More formal", "Storytelling", "Translate to French", "Translate to English"].map((l, i) => `<button type="button" class="kai-pill${i ? "" : " on"}" data-v="${l}">${l}</button>`).join("")}</div>
          <input id="kai-r-custom" type="text" placeholder="…or say how (e.g. 'as a question to the audience')">
          <button type="button" class="kai-go" id="kai-r-go">✍️ <span>Rewrite it</span></button>
          <div class="kai-out" id="kai-r-out"></div>
        </section>
      </div>
      <div class="kai-loading" id="kai-loading" hidden>
        <div class="kai-orb"><i></i><i></i><i></i></div>
        <p id="kai-load-msg">Thinking…</p>
        <div class="kai-waves" id="kai-waves" hidden></div>
        <button type="button" class="kai-ghost" id="kai-cancel">Cancel</button>
      </div>
      <footer class="kai-foot">Free Gemini tier: Google may use prompts to improve its models — don't paste confidential data.</footer>`;
    document.body.appendChild(root);
    wire();
  }

  function pills(sel) {
    $$(sel + " .kai-pill").forEach(p => p.addEventListener("click", () => {
      $$(sel + " .kai-pill").forEach(x => x.classList.toggle("on", x === p));
    }));
  }
  const pillVal = sel => ($(sel + " .kai-pill.on") || {}).dataset?.v || "";
  function seg(sel, attr, cb) {
    $$(sel + " button").forEach(b => b.addEventListener("click", () => {
      $$(sel + " button").forEach(x => x.classList.toggle("on", x === b));
      cb && cb(b.dataset[attr]);
    }));
  }
  const segVal = (sel, attr) => ($(sel + " button.on") || {}).dataset?.[attr];

  const EDIT_CHIPS = ["Make every title bigger and bolder", "Add a slim footer with the slide topic on every slide",
    "Translate all text to French", "Use our brand colours: navy #1e3a8a and gold #f5b301", "Shorten all body text to 2 lines",
    "Add an icon-like accent shape next to each heading"];
  const CREATE_CHIPS = {
    deck: ["Annual report to donors: 3 big wins and what's next", "Workshop on cybersecurity basics for office staff", "Pitch for a mobile app that helps farmers sell produce", "Climate change impacts on West African coastlines", "Onboarding new staff: who we are and how we work"],
    slide: ["A bold title slide: 'Building Tomorrow, Today'", "Our impact in 3 big numbers", "Before vs after comparison", "A 4-step timeline of the project", "A powerful closing call to action"],
  };
  function setCreateMode(m) {
    root.dataset.cmode = m;
    $("#kai-c-label").textContent = m === "deck" ? "What's your presentation about?" : "Describe the slide";
    $("#kai-c-go span").textContent = m === "deck" ? "Create my deck" : "Design this slide";
    $("#kai-c-chips").innerHTML = CREATE_CHIPS[m].map(c => `<button type="button" class="kai-chip">${esc(c)}</button>`).join("");
    $$("#kai-c-chips .kai-chip").forEach(c => c.addEventListener("click", () => { $("#kai-c-prompt").value = c.textContent; $("#kai-c-prompt").focus(); }));
  }

  function wire() {
    $("#kai-close").addEventListener("click", close);
    $("#kai-cancel").addEventListener("click", () => busy && busy.abort());
    $$(".kai-tab").forEach(t => t.addEventListener("click", () => tab(t.dataset.tab)));
    ["#kai-c-tone", "#kai-b-style", "#kai-m-deco", "#kai-m-energy", "#kai-n-tone", "#kai-r-style"].forEach(pills);
    seg(".kai-pane[data-pane=create] .kai-seg", "mode", setCreateMode);
    seg("#kai-m-scope", "scope", v => rangeToggle("#kai-m-scope", v)); seg("#kai-n-scope", "scope", v => rangeToggle("#kai-n-scope", v));
    $("#kai-m-edit-chips").innerHTML = EDIT_CHIPS.map(c => `<button type="button" class="kai-chip">${esc(c)}</button>`).join("");
    $$("#kai-m-edit-chips .kai-chip").forEach(c => c.addEventListener("click", e => { e.stopPropagation(); $("#kai-m-edit").value = c.textContent; $("#kai-m-edit").focus(); }));
    $("#kai-c-n").addEventListener("input", e => { $("#kai-c-nv").textContent = e.target.value; });
    $("#kai-c-go").addEventListener("click", runCreate);
    $("#kai-b-go").addEventListener("click", runBackground);
    $$(".kai-card").forEach(c => c.addEventListener("click", e => {
      // The explicit button always runs; elsewhere on the card, only clicks
      // that aren't on an option (pill / checkbox) do.
      if (!e.target.closest(".kai-run") && e.target.closest(".kai-pill,.kai-chip,label,input,textarea")) return;
      runMagic(c.dataset.magic);
    }));
    $("#kai-m-strip").addEventListener("click", stripDecor);
    $("#kai-i-go").addEventListener("click", runIdeas);
    $("#kai-n-go").addEventListener("click", runNotes);
    $("#kai-r-go").addEventListener("click", runRewrite);
    $("#kai-c-prompt").addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) runCreate(); });
    setCreateMode("deck");
  }

  function tab(k) {
    $$(".kai-tab").forEach(t => t.classList.toggle("on", t.dataset.tab === k));
    $$(".kai-pane").forEach(p => p.classList.toggle("on", p.dataset.pane === k));
    if (k === "rewrite") paintSelection();
  }

  function setQuota(n) { const q = $("#kai-quota"); if (q) { q.textContent = "⚡ " + n; q.classList.toggle("low", n <= 5); } }

  function showLoading(action, label) {
    const box = $("#kai-loading"), msg = $("#kai-load-msg");
    const lines = LOADING[action] || ["Thinking…"];
    let i = 0;
    msg.textContent = label || lines[0];
    box.hidden = false;
    clearInterval(showLoading.t);
    showLoading.t = setInterval(() => { i = (i + 1) % lines.length; msg.textContent = lines[i]; }, 2200);
  }
  function hideLoading() { clearInterval(showLoading.t); const b = $("#kai-loading"); if (b) b.hidden = true; }
  function out(id) {
    const o = $(id);
    o.innerHTML = lastNotice ? `<div class="kai-notice">🛟 ${esc(lastNotice)}</div>` : "";
    return o;
  }
  function showError(m) {
    const pane = $(".kai-pane.on .kai-out");
    if (pane) pane.innerHTML = `<div class="kai-err">⚠️ ${esc(m)}</div>`;
    else toast(m);
  }
  function actions(btns) {
    const row = document.createElement("div");
    row.className = "kai-actions";
    btns.forEach(([label, fn, primary]) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = primary ? "kai-apply" : "kai-ghost"; b.innerHTML = label;
      b.addEventListener("click", fn);
      row.appendChild(b);
    });
    return row;
  }

  // ═════════════════════ ✨ CREATE ═════════════════════
  async function runCreate() {
    const prompt = $("#kai-c-prompt").value.trim();
    if (prompt.length < 3) { $("#kai-c-prompt").focus(); toast("Describe what you want first"); return; }
    const mode = root.dataset.cmode || "deck";
    const tone = pillVal("#kai-c-tone");
    const o = out("#kai-c-out");
    if (mode === "deck") {
      const n = Number($("#kai-c-n").value);
      const res = await call("deck", { prompt, tone, count: n, audience: $("#kai-c-aud").value.trim() },
        `Designing ${n} slides…`);
      if (!res) return;
      const slides = (res.slides || []).map(s => normSlide(s)).filter(s => s.els.length);
      if (!slides.length) { showError("The AI's slides came back empty. Try again."); return; }
      const th = res.theme || {};
      o.insertAdjacentHTML("beforeend", `<div class="kai-res-head"><b>${esc(th.name || "Your new deck")}</b>
        <span class="kai-swatches">${(th.palette || []).slice(0, 6).map(c => `<i style="background:${esc(color(c, "#888"))}"></i>`).join("")}</span></div>`);
      const grid = document.createElement("div"); grid.className = "kai-grid";
      slides.forEach((s, i) => { const m = mini(s); m.style.animationDelay = (i * 0.07) + "s"; m.dataset.n = i + 1; grid.appendChild(m); });
      o.appendChild(grid);
      o.appendChild(actions([
        [`✦ Add ${slides.length} slides after this one`, () => insertSlides(slides, false), true],
        ["Replace whole deck", () => { if (confirm("Replace every slide in this deck with the AI deck? You can undo with Ctrl+Z.")) insertSlides(slides, true); }],
        ["↻ Try again", runCreate],
      ]));
    } else {
      const res = await call("slide", { prompt, tone, outline: outline(), slide: curSlide() ? lite(curSlide()) : null });
      if (!res) return;
      const s = normSlide(res.slide);
      if (!s.els.length) { showError("The AI's slide came back empty. Try again."); return; }
      o.appendChild(mini(s, "big"));
      o.appendChild(actions([
        ["✦ Add as new slide", () => insertSlides([s], false), true],
        ["Replace current slide", () => replaceCurrent(s)],
        ["↻ Try again", runCreate],
      ]));
    }
  }

  function insertSlides(slides, replaceAll) {
    const copies = slides.map(s => Object.assign(clone(s), { id: uid() }));
    if (replaceAll) { Deck.slides.splice(0, Deck.slides.length, ...copies); Deck.cur = 0; }
    else { Deck.slides.splice(Deck.cur + 1, 0, ...copies); Deck.cur = Deck.cur + 1; }
    Deck.sel = null;
    API().commit();
    celebrate(`✦ ${copies.length} slide${copies.length > 1 ? "s" : ""} added — Ctrl+Z to undo`);
  }
  function replaceCurrent(s) {
    const cur = curSlide();
    Object.assign(cur, clone(s), { id: cur.id });
    Deck.sel = null;
    API().commit();
    celebrate("✦ Slide replaced — Ctrl+Z to undo");
  }

  // ═════════════════════ 🎨 BACKGROUNDS ═════════════════════
  async function runBackground() {
    const res = await call("background", {
      prompt: $("#kai-b-prompt").value.trim(),
      style: pillVal("#kai-b-style"),
      outline: $("#kai-b-match").checked ? outline() : "",
    });
    if (!res) return;
    const o = out("#kai-b-out");
    const vars = res.variants || [];
    const roles = ["Title", "Content", "Closing"];
    vars.forEach((v, i) => {
      const card = document.createElement("div");
      card.className = "kai-bgcard";
      const demo = previewWithBg(curSlide(), v);
      card.appendChild(mini(demo));
      card.insertAdjacentHTML("beforeend", `<div class="kai-bgmeta"><b>${esc(v.name)}</b><small>${roles[i] || ""}${v.bgFx && v.bgFx !== "none" ? " · ✨ " + esc(v.bgFx) : ""}</small>
        <span class="kai-swatches">${(v.palette || []).map(c => `<i style="background:${esc(c)}"></i>`).join("")}</span></div>`);
      card.appendChild(actions([
        ["This slide", () => applyBg([v], "slide"), true],
        ["All slides", () => applyBg(vars, "deck", i)],
      ]));
      o.appendChild(card);
    });
    if (vars.length > 1) o.appendChild(actions([["✦ Apply the matched set to the whole deck", () => applyBg(vars, "set"), true], ["↻ Paint new ones", runBackground]]));
  }

  function previewWithBg(slide, v) {
    const s = clone(slide || newSlide());
    s.bg = v.bg; s.bgSize = null; s.bgFx = v.bgFx || s.bgFx;
    if ($("#kai-b-contrast").checked) fixContrast(s, v);
    return s;
  }
  function fixContrast(slide, v) {
    const pal = v.palette || [];
    const avg = pal[Math.min(1, pal.length - 1)] || pal[0];
    const good = v.text || ((lum(avg) || 0) > 0.4 ? "#141210" : "#ffffff");
    (slide.els || []).forEach(e => {
      if (e.type === "text" && (!e.fill || e.fill === "none") && contrast(e.color, avg) < 3.2) e.color = good;
    });
  }
  function applyBg(vars, scope, idx) {
    const fix = $("#kai-b-contrast").checked;
    const paint = (s, v) => { s.bg = v.bg; s.bgSize = null; s.bgMode = "preset"; if (v.bgFx && v.bgFx !== "none") s.bgFx = v.bgFx; if (fix) fixContrast(s, v); };
    if (scope === "slide") paint(curSlide(), vars[0]);
    else if (scope === "deck") Deck.slides.forEach(s => paint(s, vars[idx]));
    else {
      const last = Deck.slides.length - 1;
      Deck.slides.forEach((s, i) => paint(s, i === 0 ? vars[0] : (i === last && vars[2]) ? vars[2] : (vars[1] || vars[0])));
    }
    API().commit();
    celebrate("🎨 Background applied — Ctrl+Z to undo");
  }

  // ═════════════════════ 🪄 MAGIC ═════════════════════
  function scopeIndexes(sel) {
    const sc = segVal(sel, "scope");
    if (sc === "deck") return Deck.slides.map((_, i) => i);
    if (sc === "range") {
      const box = $(sel + "-range"), n = Deck.slides.length;
      let a = num(box.querySelector("[data-r=from]").value, 1, n, 1), b = num(box.querySelector("[data-r=to]").value, 1, n, n);
      if (a > b) { const t = a; a = b; b = t; }
      const out = []; for (let i = a - 1; i <= b - 1; i++) out.push(i);
      return out;
    }
    return [Deck.cur];
  }
  function rangeToggle(sel, v) {
    const box = $(sel + "-range"); if (!box) return;
    box.hidden = v !== "range";
    const n = Deck.slides.length, f = box.querySelector("[data-r=from]"), t = box.querySelector("[data-r=to]");
    f.max = t.max = n;
    if (v === "range") { f.value = Deck.cur + 1; t.value = n; }
    const upd = () => { box.querySelector(".kai-range-n").textContent = "· " + scopeIndexes(sel).length + " slides"; };
    f.oninput = t.oninput = upd; upd();
  }

  /* ─────────────── waves: whole decks, any length ───────────────
     The server takes a few slides per request (it hands back the rest as
     `pending`). We keep sending waves until every slide in scope is done,
     retry a slide the model skipped (once, on its own), carry the style
     guide from the first wave into the next ones so the deck stays
     consistent, and tag every wave with one job id so the whole run costs
     a single AI credit. */
  const WAVE = 5;
  function waveUI(indexes) {
    const box = $("#kai-waves");
    box.hidden = false;
    box.innerHTML = `<div class="kai-wave-bar"><i></i></div><div class="kai-wave-chips">${indexes.map(i => `<span data-w="${i}">${i + 1}</span>`).join("")}</div>`;
    $("#kai-loading").hidden = false;
  }
  function waveMark(i, state) { const c = $(`#kai-waves [data-w="${i}"]`); if (c) c.className = "is-" + state; }
  function waveProgress(done, total) { const b = $("#kai-waves .kai-wave-bar i"); if (b) b.style.width = Math.round(100 * done / Math.max(1, total)) + "%"; }
  function waveLabel(label) { clearInterval(showLoading.t); $("#kai-load-msg").textContent = label || "Working…"; $("#kai-loading").hidden = false; }
  function waveEnd() { const b = $("#kai-waves"); if (b) { b.hidden = true; b.innerHTML = ""; } hideLoading(); }

  async function runWaves(kind, indexes, extra, verb) {
    const job = "j" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    let queue = indexes.slice(), guide = "", wave = 0, stopped = false;
    const results = new Map(), tries = {}, skipped = [];
    if (indexes.length > 1) waveUI(indexes);
    const waves = Math.ceil(indexes.length / WAVE);
    while (queue.length) {
      const batch = queue.splice(0, WAVE);
      wave++;
      batch.forEach(i => waveMark(i, "work"));
      const where = batch.length > 1 ? `slides ${batch[0] + 1}–${batch[batch.length - 1] + 1}` : `slide ${batch[0] + 1}`;
      const label = indexes.length > 1 ? `${verb} · wave ${wave}${wave <= waves ? " of " + waves : ""} · ${where}` : verb + "…";
      const payload = Object.assign({ job, guide, outline: outline(),
        slides: batch.map(i => ({ index: i, slide: lite(Deck.slides[i]) })) }, extra);
      const res = await call(kind, payload, label, { wave: indexes.length > 1 });
      if (!res) {                              // cancelled / failed: keep what we have
        stopped = true;
        batch.concat(queue).forEach(i => { waveMark(i, "skip"); skipped.push(i); });
        break;
      }
      if (res.guide && !guide) guide = res.guide;
      if (res.fixText !== undefined) extra.fixText = res.fixText;
      const same = new Set();
      (res.slides || []).forEach(r => {
        const i = Number(r && r.index);
        if (!batch.includes(i) || results.has(i)) return;
        if (r.unchanged) same.add(i);          // the model looked and decided nothing applies
        else results.set(i, r);
      });
      const pending = (res.pending || []).map(Number).filter(i => batch.includes(i) && !results.has(i));
      queue = pending.concat(queue);
      batch.forEach(i => {
        if (results.has(i)) waveMark(i, "done");
        else if (pending.includes(i)) waveMark(i, "wait");
        else if (same.has(i)) waveMark(i, "same");
        else if ((tries[i] = (tries[i] || 0) + 1) < 2) { queue.push(i); waveMark(i, "wait"); }
        else { skipped.push(i); waveMark(i, "skip"); }
      });
      waveProgress(indexes.length - queue.length, indexes.length);
    }
    if (indexes.length > 1) setTimeout(waveEnd, results.size ? 450 : 0); else hideLoading();
    if (!results.size) return null;
    return { slides: [...results.values()], skipped, stopped, guide, fixText: !!extra.fixText, total: indexes.length };
  }

  const STYLE_KEYS = ["x", "y", "w", "h", "rot", "size", "weight", "font", "color", "align", "lh", "ls", "fill", "stroke", "strokeW", "radius", "italic"];
  function patchEl(el, p, allowText) {
    STYLE_KEYS.forEach(k => {
      if (!(k in p)) return;
      if (["x", "y", "w", "h", "rot", "size", "weight", "lh", "ls", "strokeW", "radius"].includes(k)) {
        const lim = { x: [-W, W], y: [-H, H], w: [4, W * 1.2], h: [2, H * 1.2], rot: [-360, 360], size: [8, 260], weight: [100, 900], lh: [0.8, 2.2], ls: [-4, 20], strokeW: [0, 20], radius: [0, 400] }[k];
        el[k] = num(p[k], lim[0], lim[1], el[k]);
      } else if (k === "font") el.font = font(p.font, el.font);
      else if (k === "align") { if (["left", "center", "right"].includes(p.align)) el.align = p.align; }
      else if (k === "italic") el.italic = !!p.italic;
      else el[k] = color(p[k], el[k]);
    });
    if (allowText && el.type === "text" && typeof p.text === "string" && p.text.trim()) el.text = p.text.slice(0, 1200);
    if ("anim" in p && ANIM_KEYS.has(p.anim)) el.anim = p.anim;
    if (el.anim === "typewriter" && el.type !== "text") el.anim = "fade";   // typing only makes sense for words
    if ("animDelay" in p) el.animDelay = num(p.animDelay, 0, 6, el.animDelay || 0);
    if (p.fx) { const fx = fxOf(p.fx); if (fx) el.fx = Object.assign({}, el.fx || {}, fx); }
  }

  // Build the proposed new slides WITHOUT touching the deck yet.
  function propose(kind, res, opts) {
    const changes = new Map();
    (res.slides || []).forEach(r => {
      const i = Number(r.index);
      if (!Number.isInteger(i) || !Deck.slides[i]) return;
      const s = clone(Deck.slides[i]);
      if (kind === "polish" || kind === "animate") {
        const byId = new Map((s.els || []).map(e => [e.id, e]));
        (r.els || []).forEach(p => { const el = p && byId.get(p.id); if (el) patchEl(el, p, kind === "polish" && opts.fixText); });
        if (kind === "animate" && TRANS_KEYS.has(r.transition)) s.transition = r.transition;
      }
      if (kind === "edit") {
        const byId = new Map((s.els || []).map(e => [e.id, e]));
        (r.els || []).forEach(p => { const el = p && byId.get(p.id); if (el) patchEl(el, p, true); });
        const gone = new Set((Array.isArray(r.remove) ? r.remove : []).map(String));
        if (gone.size) s.els = (s.els || []).filter(e => !gone.has(String(e.id)));
        const add = (Array.isArray(r.add) ? r.add : []).map(normEl).filter(Boolean).slice(0, 12);
        s.els = (s.els || []).concat(add);
        if (TRANS_KEYS.has(r.transition)) s.transition = r.transition;
        if (typeof r.notes === "string" && r.notes.trim()) s.notes = r.notes.slice(0, 3000);
      }
      if (kind === "decorate") {
        const add = (r.add || []).map(normEl).filter(e => e && e.type !== "text" && e.type !== "chart").slice(0, 8);
        add.forEach(e => { e.aiDecor = true; });
        s.els = add.concat(s.els || []);
      }
      if (r.bgFx && BGFX_KEYS.has(r.bgFx)) s.bgFx = r.bgFx;
      if (kind !== "animate" && r.bg) s.bg = safeBg(r.bg, s.bg);
      changes.set(i, s);
    });
    return changes;
  }

  async function runMagic(kind) {
    const indexes = scopeIndexes("#kai-m-scope");
    const extra = {};
    if (kind === "polish") extra.fixText = $("#kai-m-fix").checked;
    if (kind === "decorate") extra.style = pillVal("#kai-m-deco");
    if (kind === "animate") extra.style = pillVal("#kai-m-energy");
    if (kind === "edit") {
      extra.prompt = $("#kai-m-edit").value.trim();
      if (extra.prompt.length < 3) { showError("Type what you'd like the AI to change first."); $("#kai-m-edit").focus(); return; }
    }
    const verb = { polish: "🧹 Polishing", decorate: "🎀 Decorating", animate: "🎬 Choreographing", edit: "💬 Applying your instruction" }[kind];
    const res = await runWaves(kind, indexes, extra, verb);
    if (!res) return;
    const changes = propose(kind, res, { fixText: !!res.fixText });
    const o = out("#kai-m-out");
    if (!changes.size) { showError("The AI didn't suggest any changes this time. Try again."); return; }
    const first = changes.has(Deck.cur) ? Deck.cur : changes.keys().next().value;
    const label = { polish: "🧹 Polished", decorate: "🎀 Decorated", animate: "🎬 Choreographed", edit: "💬 Changed" }[kind];
    o.insertAdjacentHTML("beforeend", `<div class="kai-res-head"><b>${label}</b><small>${changes.size} of ${res.total} slide${res.total > 1 ? "s" : ""} — drag the divider to compare</small></div>`);
    if (res.skipped.length) o.insertAdjacentHTML("beforeend", `<div class="kai-notice">${res.stopped ? "⏸ Stopped early" : "⚠️ The AI couldn't finish"} — slide${res.skipped.length > 1 ? "s" : ""} ${res.skipped.map(i => i + 1).join(", ")} ${res.skipped.length > 1 ? "were" : "was"} left as they were. Apply the rest, then run again on just those with “Slides…”.</div>`);
    o.appendChild(compare(Deck.slides[first], changes.get(first)));
    if (kind === "animate") {
      const s = changes.get(first);
      o.insertAdjacentHTML("beforeend", `<div class="kai-anim-list">${(s.els || []).slice().sort((a, b) => (a.animDelay || 0) - (b.animDelay || 0)).slice(0, 8)
        .map(e => `<span><i>${(e.animDelay || 0).toFixed(2)}s</i> ${esc((ANIMS[e.anim] || {}).label || e.anim)} · ${esc(e.type === "text" ? String(e.text).slice(0, 26) : e.type)}</span>`).join("")}
        <span><i>⇢</i> transition: ${esc(TRANSITIONS[s.transition] || s.transition)}</span></div>`);
    }
    if (changes.size > 1) {
      const strip = document.createElement("div"); strip.className = "kai-grid sm";
      [...changes.entries()].sort((a, b) => a[0] - b[0]).forEach(([i, s], n) => {
        const m = mini(s); m.style.animationDelay = Math.min(1.2, n * 0.04) + "s"; m.title = "Slide " + (i + 1);
        m.insertAdjacentHTML("beforeend", `<em class="kai-mini-n">${i + 1}</em>`);
        m.addEventListener("click", () => { const c = o.querySelector(".kai-compare"); if (c) c.replaceWith(compare(Deck.slides[i], s)); });
        strip.appendChild(m);
      });
      o.appendChild(strip);
    }
    o.appendChild(actions([
      ["✦ Apply", () => {
        changes.forEach((s, i) => { Deck.slides[i] = s; });
        API().commit();
        celebrate(`${label} — Ctrl+Z to undo`);
        if (kind === "animate" && changes.has(Deck.cur)) setTimeout(() => toast("Tip: press Preview to watch the new animation"), 1600);
      }, true],
      ["↻ Try again", () => runMagic(kind)],
    ]));
  }

  function stripDecor() {
    let n = 0;
    Deck.slides.forEach(s => { const before = (s.els || []).length; s.els = (s.els || []).filter(e => !e.aiDecor); n += before - s.els.length; });
    if (!n) { toast("No AI decorations to remove"); return; }
    API().commit();
    toast(`Removed ${n} AI decoration${n > 1 ? "s" : ""}`);
  }

  // ═════════════════════ 💡 IDEAS ═════════════════════
  async function runIdeas() {
    const res = await call("ideas", { outline: outline(), prompt: $("#kai-i-prompt").value.trim() });
    if (!res) return;
    const o = out("#kai-i-out");
    if (res.verdict) o.insertAdjacentHTML("beforeend", `<div class="kai-verdict">${esc(res.verdict)}</div>`);
    (res.ideas || []).slice(0, 6).forEach((idea, n) => {
      const c = document.createElement("div");
      c.className = "kai-idea";
      c.style.animationDelay = (n * 0.06) + "s";
      c.innerHTML = `<b>${esc(idea.title)}</b><p>${esc(idea.why)}</p><small>${esc(idea.position || "")}</small>`;
      c.appendChild(actions([["✦ Create this slide", () => buildIdea(idea), true]]));
      o.appendChild(c);
    });
    if ((res.headlines || []).length) o.insertAdjacentHTML("beforeend", `<div class="kai-sub">Sharper titles <small>(click to copy)</small></div>` +
      res.headlines.slice(0, 3).map(h => `<button type="button" class="kai-chip kai-copy">${esc(h)}</button>`).join(""));
    if ((res.tips || []).length) o.insertAdjacentHTML("beforeend", `<div class="kai-sub">Quick wins</div><ul class="kai-tips">${res.tips.slice(0, 4).map(t => `<li>${esc(t)}</li>`).join("")}</ul>`);
    o.querySelectorAll(".kai-copy").forEach(b => b.addEventListener("click", () => { navigator.clipboard && navigator.clipboard.writeText(b.textContent); toast("Copied"); }));
  }
  async function buildIdea(idea) {
    const res = await call("slide", { prompt: idea.prompt || idea.title, outline: outline(), tone: "bold" }, "Designing “" + String(idea.title).slice(0, 40) + "”…");
    if (!res) return;
    const s = normSlide(res.slide);
    if (!s.els.length) { showError("That slide came back empty. Try again."); return; }
    const m = String(idea.position || "").match(/(\d+)/);
    const at = m ? Math.min(Deck.slides.length, Number(m[1])) : Deck.slides.length;
    Deck.slides.splice(at, 0, s);
    Deck.cur = at; Deck.sel = null;
    API().commit();
    celebrate("💡 Idea added as slide " + (at + 1));
  }

  // ═════════════════════ 🗣 NOTES ═════════════════════
  async function runNotes() {
    const res = await runWaves("notes", scopeIndexes("#kai-n-scope"), { style: pillVal("#kai-n-tone") }, "🗣 Writing notes");
    if (!res) return;
    const o = out("#kai-n-out");
    const rows = (res.slides || []).filter(r => Deck.slides[r.index] && typeof r.notes === "string");
    if (!rows.length) { showError("No notes came back. Try again."); return; }
    rows.forEach(r => o.insertAdjacentHTML("beforeend", `<div class="kai-note"><b>Slide ${r.index + 1}</b><p>${esc(r.notes)}</p></div>`));
    o.appendChild(actions([["✦ Save to speaker notes", () => {
      rows.forEach(r => { Deck.slides[r.index].notes = r.notes.slice(0, 3000); });
      API().commit();
      celebrate("🗣 Notes saved — open the teleprompter on your phone");
    }, true]]));
  }

  // ═════════════════════ ✍️ REWRITE ═════════════════════
  function paintSelection() {
    const el = selEl && selEl();
    const box = $("#kai-r-sel");
    if (el && el.type === "text") { box.className = "kai-sel"; box.innerHTML = `<small>Selected text</small><p>${esc(String(el.text).slice(0, 220))}</p>`; }
    else { box.className = "kai-sel empty"; box.innerHTML = "👆 Click a text box on the slide, then come back here."; }
  }
  async function runRewrite() {
    const el = selEl && selEl();
    if (!el || el.type !== "text") { paintSelection(); toast("Select a text box first"); return; }
    const style = $("#kai-r-custom").value.trim() || pillVal("#kai-r-style");
    const res = await call("rewrite", { text: el.text, style });
    if (!res) return;
    const o = out("#kai-r-out");
    (res.options || []).forEach((t, n) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "kai-option"; b.style.animationDelay = (n * 0.06) + "s";
      b.innerHTML = `<span>${esc(t).replace(/\n/g, "<br>")}</span><i>Use this ✦</i>`;
      b.addEventListener("click", () => {
        const cur = selEl && selEl();
        const target = cur && cur.id === el.id ? cur : (curSlide().els || []).find(e => e.id === el.id);
        if (!target) { toast("That text box is gone"); return; }
        target.text = t;
        API().commit();
        celebrate("✍️ Text updated — Ctrl+Z to undo");
        paintSelection();
      });
      o.appendChild(b);
    });
  }

  // ───────────────────────── delight ─────────────────────────
  function celebrate(msg) {
    toast(msg);
    const burst = document.createElement("div");
    burst.className = "kai-burst";
    for (let i = 0; i < 18; i++) {
      const s = document.createElement("i");
      s.style.setProperty("--a", (i * 20) + "deg");
      s.style.setProperty("--d", (60 + Math.random() * 70) + "px");
      s.style.background = pick(["#f2c14e", "#e8482b", "#a78bfa", "#22d3ee", "#34d399"]);
      burst.appendChild(s);
    }
    document.body.appendChild(burst);
    setTimeout(() => burst.remove(), 900);
  }

  // ───────────────────────── open / close ─────────────────────────
  async function checkStatus() {
    if (!SRV.aiStatusUrl) return;
    try {
      const r = await fetch(SRV.aiStatusUrl, { credentials: "same-origin" });
      const d = await r.json();
      setQuota(d.quotaLeft);
      const setup = $("#kai-setup");
      if (!d.enabled) {
        setup.hidden = false;
        setup.innerHTML = `<b>🔑 One-time setup</b>
          <p>Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>,
          then add this line to <code>/srv/knockknock/.env</code> and run <code>./deploy.sh</code>:</p>
          <pre>GEMINI_API_KEY=your-key-here</pre>`;
      } else setup.hidden = true;
    } catch (_) { /* offline — calls will report it */ }
  }
  function open(tabKey) {
    if (!root) build();
    root.classList.add("on");
    document.body.classList.add("kai-open");
    if (tabKey) tab(tabKey);
    checkStatus();
    const ta = root.querySelector(".kai-pane.on textarea, .kai-pane.on input[type=text]");
    setTimeout(() => ta && ta.focus({ preventScroll: true }), 250);
  }
  function close() { if (root) root.classList.remove("on"); document.body.classList.remove("kai-open"); }

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && root && root.classList.contains("on") && !busy) close();
    // Ctrl/⌘ + J toggles the Studio.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "j") {
      e.preventDefault();
      root && root.classList.contains("on") ? close() : open();
    }
  });
  // Keep the Rewrite tab in step with the canvas selection.
  document.addEventListener("click", () => { if (root && root.classList.contains("on") && $(".kai-tab.on").dataset.tab === "rewrite") setTimeout(paintSelection, 30); }, true);

  window.HannsAI = { open, close, normSlide, normEl, lite, outline };
})();
