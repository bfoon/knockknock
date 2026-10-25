/* ════════════════════════════════════════════════════════════════════
   HANNS AI AREA — highlight part of a slide and tell the AI what goes there
   ════════════════════════════════════════════════════════════════════
   ✦ AI area (toolbar) or Ctrl/⌘ + Shift + J:
     1. drag a box on the slide          → a glowing marquee with its size
     2. say what should go there         → chips suggest ideas that suit the
                                            box's shape; Auto / Design / Illustration
     3. the AI designs INTO that box     → a live ghost preview plays its
                                            entrance right where it will sit
     4. Keep it · Another version · Edit prompt · Discard
   Illustrations are original vector art painted by the AI and safety-checked
   on the server (the same pipeline as AI backgrounds). Everything the model
   returns goes through HannsAI.normEl, so only known element types, fonts,
   colours and animations get in, and the result is fitted inside the box.
   Keeping it is one undo step (Ctrl+Z).
   Depends on window.Hanns, window.HannsEditorAPI and window.HannsAI.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const Hx = window.Hanns, SRV = window.__HANNS__ || {}, AI = () => window.HannsAI;
  if (!Hx || !SRV.aiUrl) return;
  const { Deck, W, H, paintSlide, makeImage } = Hx;
  const API = () => window.HannsEditorAPI || {};
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = m => (API().toast || console.log)(m);

  let layer = null, box = null, bubble = null, ghost = null, hint = null;
  let region = null, drag = null, ctrl = null, active = false, last = null, raf = 0, seed = null;

  /* ───────────── geometry: slide px <-> screen px ───────────── */
  function canvasRect() {
    const c = document.getElementById("canvas");
    return c ? c.getBoundingClientRect() : null;
  }
  function zoom(r) { return r.width / W; }
  function toSlide(e) {
    const r = canvasRect(), z = zoom(r);
    return { x: Math.max(0, Math.min(W, (e.clientX - r.left) / z)), y: Math.max(0, Math.min(H, (e.clientY - r.top) / z)) };
  }
  function place() {                      // keep the layer glued to the canvas while scrolling / zooming
    if (!active) return;
    const r = canvasRect();
    if (r) {
      Object.assign(layer.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
      const z = zoom(r);
      if (region) {
        Object.assign(box.style, { left: region.x * z + "px", top: region.y * z + "px", width: region.w * z + "px", height: region.h * z + "px" });
        box.querySelector(".kaa-size").textContent = Math.round(region.w) + " × " + Math.round(region.h);
        if (ghost) ghost.style.transform = `scale(${z})`;
        placeBubble(r, z);
      }
    }
    raf = requestAnimationFrame(place);
  }
  function placeBubble(r, z) {
    if (!bubble || bubble.hidden) return;
    const bw = bubble.offsetWidth || 340, bh = bubble.offsetHeight || 260, gap = 14;
    const rx = r.left + region.x * z, ry = r.top + region.y * z, rw = region.w * z, rh = region.h * z;
    let left = rx + rw + gap, top = ry;
    if (left + bw > innerWidth - 8) left = rx - bw - gap;                       // left of the box
    if (left < 8) { left = Math.min(innerWidth - bw - 8, Math.max(8, rx)); top = ry + rh + gap; }   // below
    if (top + bh > innerHeight - 8) top = Math.max(8, innerHeight - bh - 8);
    bubble.style.left = left + "px"; bubble.style.top = Math.max(8, top) + "px";
  }

  /* ───────────── enter / leave the tool ───────────── */
  function start() {
    if (active) return;
    if (!canvasRect()) return;
    active = true;
    document.body.classList.add("kaa-on");
    layer = document.createElement("div");
    layer.className = "kaa-layer";
    layer.innerHTML = `<div class="kaa-box" hidden><span class="kaa-size"></span><i class="kaa-scan"></i></div>`;
    document.body.appendChild(layer);
    box = layer.querySelector(".kaa-box");
    hint = document.createElement("div");
    hint.className = "kaa-hint";
    hint.innerHTML = `✦ <b>Drag a box</b> where you want the AI to create something <kbd>Esc</kbd> to cancel`;
    document.body.appendChild(hint);
    layer.addEventListener("pointerdown", down);
    raf = requestAnimationFrame(place);
  }
  function stop() {
    if (!active) return;
    if (ctrl) ctrl.abort();
    active = false; region = null; drag = null; last = null;
    cancelAnimationFrame(raf);
    [layer, bubble, hint].forEach(n => n && n.remove());
    layer = box = bubble = ghost = hint = null;
    document.body.classList.remove("kaa-on");
  }

  /* ───────────── drawing the box ───────────── */
  function down(e) {
    if (bubble && !bubble.hidden && e.target === layer) { clearGhost(); }     // start over
    if (e.target !== layer && !e.target.classList.contains("kaa-box")) return;
    e.preventDefault();
    const p = toSlide(e);
    drag = { x0: p.x, y0: p.y };
    region = { x: p.x, y: p.y, w: 1, h: 1 };
    box.hidden = false; box.classList.remove("is-busy", "is-done");
    if (bubble) bubble.hidden = true;
    if (hint) hint.classList.add("is-small");
    layer.setPointerCapture(e.pointerId);
    layer.addEventListener("pointermove", move);
    layer.addEventListener("pointerup", up, { once: true });
  }
  function move(e) {
    if (!drag) return;
    const p = toSlide(e);
    region = { x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) };
    if (e.shiftKey) { const s = Math.max(region.w, region.h); region.w = region.h = s; }     // Shift: square
  }
  function up() {
    layer.removeEventListener("pointermove", move);
    drag = null;
    if (!region || region.w < 24 || region.h < 16) {
      box.hidden = true; region = null;
      toast("Drag a bigger box — at least a small square");
      return;
    }
    region = { x: Math.round(region.x), y: Math.round(region.y), w: Math.round(region.w), h: Math.round(region.h) };
    askBubble();
  }

  /* ───────────── the prompt bubble ───────────── */
  function insideEls() {
    const s = Deck.slides[Deck.cur];
    return (s.els || []).filter(e => {
      const cx = (e.x || 0) + (e.w || 0) / 2, cy = (e.y || 0) + (e.h || 0) / 2;
      return cx >= region.x && cx <= region.x + region.w && cy >= region.y && cy <= region.y + region.h &&
        (e.w || 0) <= region.w * 1.15 && (e.h || 0) <= region.h * 1.15;
    });
  }
  function chipsFor() {
    const ar = region.w / region.h;
    if (ar > 2.6) return ["A 4-step timeline of our project", "3 key stats in a row", "A row of 4 icon-style highlights", "A banner with a bold one-line message"];
    if (ar < 0.75) return ["A vertical list of 4 benefits", "A tall illustration of a growing plant", "A big number with a short caption", "A quote from a happy customer"];
    if (region.w < 260 && region.h < 200) return ["An icon-style illustration of a lightbulb", "A badge that says NEW", "A big number: 87%", "A small donut chart"];
    return ["A bar chart of sales by quarter", "An illustration of a farmer with solar panels", "3 bullet points on why it matters", "A before / after comparison"];
  }
  function askBubble(prev) {
    if (!prev && seed) { prev = seed; seed = null; }      // "Remix with AI" from the library
    if (!bubble) {
      bubble = document.createElement("div");
      bubble.className = "kaa-bubble";
      document.body.appendChild(bubble);
    }
    const n = insideEls().length;
    bubble.hidden = false;
    bubble.innerHTML = `
      <div class="kaa-b-head"><span class="kaa-spark">✦</span><b>What should go here?</b><button type="button" class="kaa-x" aria-label="Cancel">✕</button></div>
      <textarea class="kaa-prompt" rows="3" placeholder="Describe it — e.g. “a pie chart of how we spend each dalasi” or “a friendly illustration of a classroom”">${esc(prev && prev.prompt || "")}</textarea>
      <div class="kaa-modes" role="group" aria-label="Kind of result">
        ${[["auto", "✦ Auto"], ["design", "▦ Design"], ["illustration", "🖌 Illustration"]].map(([k, l]) =>
          `<button type="button" data-m="${k}" class="${(prev && prev.mode || "auto") === k ? "on" : ""}">${l}</button>`).join("")}
      </div>
      <div class="kaa-chips">${chipsFor().map(c => `<button type="button" class="kaa-chip">${esc(c)}</button>`).join("")}</div>
      ${n ? `<label class="kaa-check"><input type="checkbox" class="kaa-replace"${prev && prev.replace ? " checked" : ""}> Replace the ${n} item${n > 1 ? "s" : ""} inside the box</label>` : ""}
      <div class="kaa-row"><button type="button" class="kaa-go">✦ Create <kbd>Ctrl ↵</kbd></button><button type="button" class="kaa-ghost kaa-cancel">Cancel</button></div>`;
    const ta = bubble.querySelector(".kaa-prompt");
    bubble.querySelectorAll(".kaa-modes button").forEach(b => b.addEventListener("click", () =>
      bubble.querySelectorAll(".kaa-modes button").forEach(x => x.classList.toggle("on", x === b))));
    bubble.querySelectorAll(".kaa-chip").forEach(c => c.addEventListener("click", () => { ta.value = c.textContent; ta.focus(); }));
    bubble.querySelector(".kaa-go").addEventListener("click", create);
    bubble.querySelector(".kaa-cancel").addEventListener("click", stop);
    bubble.querySelector(".kaa-x").addEventListener("click", stop);
    ta.addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); create(); } });
    setTimeout(() => ta.focus({ preventScroll: true }), 30);
  }
  function readBubble() {
    return {
      prompt: (bubble.querySelector(".kaa-prompt") || {}).value?.trim() || "",
      mode: (bubble.querySelector(".kaa-modes .on") || {}).dataset?.m || "auto",
      replace: !!(bubble.querySelector(".kaa-replace") || {}).checked,
    };
  }

  /* ───────────── asking the server ───────────── */
  async function create(again) {
    const ask = again === true && last ? last.ask : readBubble();
    if (ask.prompt.length < 2) { const t = bubble.querySelector(".kaa-prompt"); t && t.focus(); toast("Say what should go in the box"); return; }
    clearGhost();
    box.classList.add("is-busy");
    bubble.innerHTML = `<div class="kaa-b-head"><span class="kaa-spark spin">✦</span><b>Designing…</b></div>
      <p class="kaa-wait">${esc(ask.mode === "illustration" ? "Painting your illustration…" : "Fitting it to your box and your slide's style…")}</p>
      <div class="kaa-row"><button type="button" class="kaa-ghost kaa-stop">Stop</button></div>`;
    bubble.querySelector(".kaa-stop").addEventListener("click", () => ctrl && ctrl.abort());
    ctrl = new AbortController();
    const giveUp = setTimeout(() => ctrl && ctrl.abort(), 170000);
    let data = null;
    try {
      const r = await fetch(SRV.aiUrl, {
        method: "POST", credentials: "same-origin", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "X-CSRFToken": SRV.csrftoken || "" },
        body: JSON.stringify({ action: "region", prompt: ask.prompt, mode: ask.mode, region,
          slide: AI().lite(Deck.slides[Deck.cur]), outline: AI().outline() }),
      });
      try { data = await r.json(); } catch (_) { /* html error page */ }
      if (!r.ok || !data || !data.ok) throw new Error((data && data.error) || "The AI request failed (" + r.status + ")");
    } catch (e) {
      box.classList.remove("is-busy");
      if (!active) return;
      if (e.name === "AbortError") { askBubble(ask); toast("Stopped"); return; }
      askBubble(ask);
      bubble.insertAdjacentHTML("afterbegin", `<div class="kaa-err">⚠️ ${esc(e.message || "Something went wrong")}</div>`);
      return;
    } finally { clearTimeout(giveUp); ctrl = null; }
    if (!active) return;
    box.classList.remove("is-busy");
    const els = build(data.result || {});
    if (!els.length) { askBubble(ask); bubble.insertAdjacentHTML("afterbegin", `<div class="kaa-err">The AI didn't make anything usable. Try rewording it.</div>`); return; }
    last = { ask, els, caption: (data.result || {}).caption, notice: data.notice, model: data.model };
    showGhost(els);
    resultBubble();
  }

  // Turn the server's answer into real Hanns elements, fitted inside the box.
  function build(res) {
    const els = (res.els || []).map(r => AI().normEl(r)).filter(Boolean);
    if (res.image && res.image.url && /^\/media\//.test(res.image.url)) {
      const img = makeImage(res.image.url, { x: region.x, y: region.y, w: region.w, h: region.h, fit: "contain", radius: 0, anim: "zoom" });
      img.alt = String(res.image.alt || "").slice(0, 160);
      img.aiArt = true;
      els.unshift(img);                       // the picture sits behind any caption
    }
    fitInto(els, region);
    return els;
  }
  function fitInto(els, r) {
    if (!els.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    els.forEach(e => { x0 = Math.min(x0, e.x); y0 = Math.min(y0, e.y); x1 = Math.max(x1, e.x + e.w); y1 = Math.max(y1, e.y + e.h); });
    const bw = x1 - x0, bh = y1 - y0;
    if (x0 >= r.x - 4 && y0 >= r.y - 4 && x1 <= r.x + r.w + 4 && y1 <= r.y + r.h + 4) return;     // already inside
    const k = Math.min(1, r.w / Math.max(1, bw), r.h / Math.max(1, bh));
    const ox = r.x + (r.w - bw * k) / 2, oy = r.y + (r.h - bh * k) / 2;
    els.forEach(e => {
      e.x = Math.round(ox + (e.x - x0) * k); e.y = Math.round(oy + (e.y - y0) * k);
      e.w = Math.max(8, Math.round(e.w * k)); e.h = Math.max(4, Math.round(e.h * k));
      if (e.type === "text" && e.size) e.size = Math.max(8, Math.round(e.size * k));
    });
  }

  /* ───────────── live ghost preview ───────────── */
  function showGhost(els) {
    clearGhost();
    ghost = document.createElement("div");
    ghost.className = "kaa-ghost-stage";
    ghost.style.width = W + "px"; ghost.style.height = H + "px";
    try {
      paintSlide(ghost, { bg: "transparent", bgFx: "none", els: els.map(e => Object.assign({}, e)) }, { live: true });
    } catch (e) {
      try { paintSlide(ghost, { bg: "transparent", bgFx: "none", els }, { live: false, revealAll: true }); } catch (_) { /* preview only */ }
    }
    layer.appendChild(ghost);
    box.classList.add("is-done");
  }
  function clearGhost() { if (ghost) { ghost.remove(); ghost = null; } if (box) box.classList.remove("is-done"); }

  function resultBubble() {
    const repl = last.ask.replace ? insideEls().length : 0;
    bubble.innerHTML = `
      <div class="kaa-b-head"><span class="kaa-spark">✦</span><b>${esc(last.caption || "Here's an idea")}</b><button type="button" class="kaa-x" aria-label="Discard">✕</button></div>
      ${last.notice ? `<div class="kaa-note">🛟 ${esc(last.notice)}</div>` : ""}
      <p class="kaa-sub">${last.els.length} item${last.els.length > 1 ? "s" : ""}${repl ? ` · replaces ${repl} inside the box` : ""} · ${esc(last.model === "hanns-builtin" ? "built-in designer" : "AI")}</p>
      <div class="kaa-row">
        <button type="button" class="kaa-go kaa-keep">✓ Keep it <kbd>↵</kbd></button>
        <button type="button" class="kaa-ghost kaa-again">↻ Another version</button>
      </div>
      <div class="kaa-row">
        <button type="button" class="kaa-ghost kaa-edit">✎ Change the prompt</button>
        <button type="button" class="kaa-ghost kaa-discard">Discard</button>
      </div>
      ${window.HannsLibrary ? `<button type="button" class="kaa-save" title="Keep a copy in your design library to reuse on any slide">☆ Save to my library</button>` : ""}`;
    bubble.querySelector(".kaa-keep").addEventListener("click", keep);
    bubble.querySelector(".kaa-again").addEventListener("click", () => create(true));
    bubble.querySelector(".kaa-edit").addEventListener("click", () => { clearGhost(); askBubble(last.ask); });
    bubble.querySelector(".kaa-discard").addEventListener("click", stop);
    bubble.querySelector(".kaa-x").addEventListener("click", stop);
    const save = bubble.querySelector(".kaa-save");
    if (save) save.addEventListener("click", () => {
      window.HannsLibrary.saveDesign({ els: last.els, name: last.caption || last.ask.prompt, kind: "ai", prompt: last.ask.prompt,
        from: save }).then(ok => { if (ok) { save.textContent = "★ Saved to your library"; save.disabled = true; } });
    });
    setTimeout(() => bubble.querySelector(".kaa-keep").focus({ preventScroll: true }), 30);
  }
  function keep() {
    const s = Deck.slides[Deck.cur];
    if (last.ask.replace) { const gone = new Set(insideEls()); s.els = (s.els || []).filter(e => !gone.has(e)); }
    s.els = (s.els || []).concat(last.els);
    API().commit();
    toast("✦ Added to your slide — Ctrl+Z to undo");
    stop();
  }

  /* ───────────── wiring ───────────── */
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "j") { e.preventDefault(); active ? stop() : start(); return; }
    if (!active) return;
    if (e.key === "Escape") { e.preventDefault(); stop(); }
    if (e.key === "Enter" && last && ghost && !e.target.matches("textarea,input")) { e.preventDefault(); keep(); }
  });
  function addButton() {
    const ai = document.getElementById("btn-ai-design");
    const have = document.getElementById("btn-ai-area");
    if (have) { have.addEventListener("click", () => (active ? stop() : start())); return; }   // editor.html ships it
    if (!ai) return;
    const b = document.createElement("button");
    b.type = "button"; b.id = "btn-ai-area"; b.className = ai.className + " kaa-btn";
    b.title = "AI area — drag a box on the slide and tell the AI what to put there (Ctrl+Shift+J)";
    b.innerHTML = `<span aria-hidden="true">⬚</span> AI area`;
    b.addEventListener("click", () => (active ? stop() : start()));
    ai.insertAdjacentElement("afterend", b);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addButton); else addButton();
  // Start the tool with a prompt already filled in (used by the library's "Remix with AI").
  function startWith(prompt, mode) { seed = { prompt: String(prompt || ""), mode: mode || "auto" }; stop(); start(); }
  window.HannsAIArea = { start, stop, startWith };
})();
