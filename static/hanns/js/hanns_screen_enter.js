/* ═══════════════════════════════════════════════════════════════════
   HANNS · BIG SCREEN — how things come onto the screen
   ───────────────────────────────────────────────────────────────────
   Projector: every time something comes in — a deck, the lobby coming
   back, the event background, an event view, a live poll, the video
   player — it enters with the screen's chosen transition. Default:
   ROLL DOWN, like a projector screen unrolling (with its roller bar and
   a little settle at the bottom). Others: roll up, curtain, iris, slide,
   zoom, flip down, fade (exactly the old behaviour), none (instant).

   It doesn't touch how any layer works: it watches for a layer becoming
   visible (its on/off class) and plays the entrance on it with the Web
   Animations API, holding that layer's own CSS fade back meanwhile.

   Control board: a "Screen transitions" row in Sources to choose one
   (each choice previews itself on hover) and replay it on the big screen.
   Server: screenart/program.py look_for/set_look, POST …/look/.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const CHOICES = [
    ["rolldown", "Roll down"], ["rollup", "Roll up"], ["curtain", "Curtain"], ["iris", "Iris"],
    ["slide", "Slide"], ["zoom", "Zoom"], ["flip", "Flip down"], ["fade", "Fade"], ["none", "None"],
  ];
  /* Every entrance moves with transform/opacity only, so the GPU just moves
     pictures it already has. (The first version revealed with clip-path,
     which re-painted the whole incoming screen on every frame — measured at
     1–6 fps on a modest projector laptop.) Curtain and iris animate a cover
     over the new picture instead of the picture itself, for the same reason. */
  const DUR = { rolldown: 700, rollup: 700, curtain: 700, iris: 650, slide: 550, zoom: 450, flip: 650 };
  const EASE = "cubic-bezier(.22,.8,.24,1)";
  // a roll is a screen coming down: an even descent that eases into its stop
  const ROLL_EASE = "cubic-bezier(.45,.05,.3,1)";
  const easeOf = k => (k === "rolldown" || k === "rollup" ? ROLL_EASE : EASE);
  // keyframes per style; [frames, options] — the roll-downs settle with a tiny bounce
  const KF = {
    // the screen comes down (or up) into place and settles
    rolldown: [{ transform: "translateY(-100%)" }, { transform: "translateY(0)", offset: 0.82 },
               { transform: "translateY(-1.6%)", offset: 0.91 }, { transform: "translateY(0)" }],
    rollup: [{ transform: "translateY(100%)" }, { transform: "translateY(0)", offset: 0.82 },
             { transform: "translateY(1.6%)", offset: 0.91 }, { transform: "translateY(0)" }],
    slide: [{ transform: "translateX(100%)" }, { transform: "translateX(0)" }],
    zoom: [{ transform: "scale(.84)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }],
    flip: [{ transform: "perspective(1800px) rotateX(-78deg)", transformOrigin: "50% 0", opacity: 0.25 },
           { transform: "perspective(1800px) rotateX(0deg)", transformOrigin: "50% 0", opacity: 1 }],
  };

  /* ───────────── projector ───────────── */
  const stage = document.getElementById("scr-stage");
  if (document.getElementById("scr-cfg") && stage) {
    let entrance = "rolldown";
    try {
      const st = JSON.parse((document.getElementById("scr-state") || {}).textContent || "{}");
      entrance = (st.look && st.look.entrance) || entrance;
    } catch (_) { /* default */ }
    document.addEventListener("scr:state", e => { const l = e.detail && e.detail.look; if (l && l.entrance) entrance = l.entrance; });
    const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lobby = document.querySelector(".scr-lobby");

    const css = document.createElement("style");
    css.textContent = `
    .scr-roller{position:fixed;left:-1%;right:-1%;height:18px;margin-top:-9px;z-index:60;pointer-events:none;border-radius:9px;
      background:linear-gradient(180deg,#f4f4f7 0%,#b6b6bf 38%,#5b5b66 62%,#9d9da7 100%);
      box-shadow:0 10px 26px rgba(0,0,0,.55),0 2px 0 rgba(255,255,255,.35) inset}
    .scr-roller::before,.scr-roller::after{content:"";position:absolute;top:2px;width:26px;height:14px;border-radius:7px;background:#2a2a31}
    .scr-roller::before{left:1.4%}.scr-roller::after{right:1.4%}
    .scr-roller{top:0;will-change:transform}
    /* stage curtains for "curtain": two velvet panels that part */
    .scr-curtain{position:fixed;inset:0;z-index:60;pointer-events:none;display:flex;overflow:hidden}
    .scr-curtain i{flex:1;will-change:transform;
      background:repeating-linear-gradient(90deg,rgba(0,0,0,.28) 0 2.2vw,rgba(255,255,255,.05) 3.4vw,rgba(0,0,0,.28) 4.6vw),
                 linear-gradient(180deg,#5b0f1e,#3a0913 70%,#24050c)}
    .scr-curtain i:first-child{box-shadow:inset -10px 0 18px rgba(0,0,0,.55)}
    .scr-curtain i:last-child{box-shadow:inset 10px 0 18px rgba(0,0,0,.55)}
    /* "iris": a black cover whose round opening grows (only the cover repaints) */
    @property --scr-iris{syntax:"<percentage>";inherits:false;initial-value:0%}
    .scr-iris{position:fixed;inset:0;z-index:60;pointer-events:none;
      background:radial-gradient(circle at 50% 50%,transparent var(--scr-iris),#000 calc(var(--scr-iris) + .6%))}`;
    document.head.appendChild(css);

    function roller(kind, dur) {                  // the bar riding the leading edge of a roll
      const bar = document.createElement("div");
      bar.className = "scr-roller"; bar.setAttribute("aria-hidden", "true");
      document.body.appendChild(bar);
      const down = kind === "rolldown";
      // rides the edge with a transform (no layout per frame)
      const ys = down ? [0, 100, 98.4, 100] : [100, 0, 1.6, 0];
      const k = ys.map(v => ({ transform: `translateY(${v}vh)` }));
      k[1].offset = 0.82; k[2].offset = 0.91;
      const a = bar.animate(k, { duration: dur, easing: ROLL_EASE, fill: "forwards" });
      a.finished.then(() => bar.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: "forwards" }).finished)
               .catch(() => {}).then(() => bar.remove());
    }

    function cover(kind, dur) {           // curtain / iris: animate a cover, not the content
      const c = document.createElement("div");
      c.setAttribute("aria-hidden", "true");
      let a;
      if (kind === "curtain") {
        c.className = "scr-curtain"; c.innerHTML = "<i></i><i></i>";
        document.body.appendChild(c);
        const [l, r] = c.children, o = { duration: dur, easing: "cubic-bezier(.6,.02,.25,1)", fill: "forwards" };
        l.animate([{ transform: "translateX(0)" }, { transform: "translateX(-101%)" }], o);
        a = r.animate([{ transform: "translateX(0)" }, { transform: "translateX(101%)" }], o);
      } else {
        c.className = "scr-iris";
        document.body.appendChild(c);
        a = c.animate([{ "--scr-iris": "0%" }, { "--scr-iris": "78%" }], { duration: dur, easing: EASE, fill: "forwards" });
      }
      a.finished.catch(() => {}).then(() => c.remove());
      return a;
    }

    /* The lobby grid: 64 px lines faded out by a radial CSS mask, which costs a
       mask pass on every redraw. Draw it once, faded, into an image instead —
       same picture, a plain background from then on. */
    function bakeGrid() {
      const g = document.querySelector(".scr-grid");
      if (!g) return;
      try {
        const w = Math.round(g.clientWidth), h = Math.round(g.clientHeight);
        if (!w || !h) return;
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const x = c.getContext("2d");
        x.fillStyle = "rgba(255,255,255,.035)";
        for (let px = 0; px < w; px += 64) x.fillRect(px, 0, 1, h);
        for (let py = 0; py < h; py += 64) x.fillRect(0, py, w, 1);
        // the mask: radial-gradient(ellipse at center, #000 30%, transparent 75%)
        x.globalCompositeOperation = "destination-in";
        x.setTransform(w / 2, 0, 0, h / 2, w / 2, h / 2);                 // ellipse = scaled circle
        const r = Math.hypot(1, 1);                                        // "farthest-corner" of the ellipse
        const m = x.createRadialGradient(0, 0, 0, 0, 0, r);
        m.addColorStop(0.30, "#000"); m.addColorStop(0.75, "rgba(0,0,0,0)");
        x.fillStyle = m; x.fillRect(-1, -1, 2, 2);
        const url = c.toDataURL("image/png");
        g.style.backgroundImage = `url("${url}")`;
        g.classList.add("baked");
      } catch (_) { /* the CSS mask stays */ }
    }
    bakeGrid();
    let bakeT = null;
    window.addEventListener("resize", () => { clearTimeout(bakeT); bakeT = setTimeout(bakeGrid, 300); });

    let running = new WeakMap();
    function enter(el, opts = {}) {
      const kind = opts.kind || entrance;
      if (kind === "fade" || !el || reduced()) return;   // fade = the screen's own fades, as always
      const before = el.style.transition;
      el.style.transition = "none";                     // the entrance does the work, not the fade
      // Lifting the stage over the lobby: the stage's own black background goes
      // see-through meanwhile, or it would cover the lobby with black.
      const raise = opts.raise, z = raise ? raise.style.zIndex : "", rbg = raise ? raise.style.background : "";
      if (raise) { raise.style.zIndex = String(opts.raiseZ || 6); raise.style.background = "transparent"; }
      // What's underneath (the lobby, when a deck comes in over it): for a roll it
      // stays fully up until the roll lands — that's what makes it look like the new
      // picture unrolls over the old one; for "none" it goes at once.
      const under = opts.under, keep = under && kind !== "none";
      const ub = under ? { t: under.style.transition, o: under.style.opacity, v: under.style.visibility } : null;
      if (under) under.style.transition = "none";
      if (keep) { under.style.opacity = "1"; under.style.visibility = "visible"; }
      const done = () => {
        el.style.transition = before;
        if (raise) { raise.style.zIndex = z; raise.style.background = rbg; }
        if (under) {
          under.style.opacity = ub.o; under.style.visibility = ub.v;         // now it can be hidden — instantly
          requestAnimationFrame(() => { under.style.transition = ub.t; });
        }
        running.delete(el);
      };
      const prev = running.get(el); if (prev) prev.cancel();
      if (kind === "none" || !el.animate || !(KF[kind] || kind === "curtain" || kind === "iris")) { requestAnimationFrame(() => requestAnimationFrame(done)); return; }
      const dur = DUR[kind] || 700;
      let a;
      if (kind === "curtain" || kind === "iris") a = cover(kind, dur);   // the new picture is already in place underneath
      else {
        a = el.animate(KF[kind], { duration: dur, easing: easeOf(kind) });
        if (kind === "rolldown" || kind === "rollup") roller(kind, dur);
      }
      running.set(el, a);
      a.finished.then(done, done);
    }

    // which layers count, and when each one is "showing"
    const LAYERS = [
      { sel: ".scr-lobby", on: n => !n.classList.contains("off") },
      { sel: ".scr-frame", on: n => n.classList.contains("on"), deck: true },
      { sel: ".sbd-show", on: n => n.classList.contains("on") },
      { sel: ".pe-layer", on: n => n.classList.contains("on") },
      { sel: ".lv-layer", on: n => n.classList.contains("on") },
      { sel: ".tm-layer", on: n => n.classList.contains("on") },        // a Teams meeting
      { sel: ".pm-video.pm-deck-a", on: n => n.classList.contains("on") && !n.classList.contains("tiny") && !n.classList.contains("audio") },
    ];
    const seen = new WeakMap();                      // element → was it showing
    function layerOf(n) { return LAYERS.find(L => n.matches && n.matches(L.sel)); }
    function check(n) {
      const L = layerOf(n); if (!L) return;
      const now = L.on(n), was = seen.get(n);
      seen.set(n, now);
      if (!now || was !== false) return;              // only a real hidden → showing change
      if (L.deck) {
        // A deck comes in over the lobby: lift the stage above it for the entrance.
        // The projector hides the lobby in the same instant, so ask what the lobby
        // was a moment ago (its record in this batch hasn't been read yet).
        const overLobby = lobby && seen.get(lobby) !== false;
        enter(n, overLobby ? { raise: stage, raiseZ: 6, under: lobby } : {});
      } else enter(n);
    }
    function scan(root) {
      LAYERS.forEach(L => root.querySelectorAll && root.querySelectorAll(L.sel).forEach(n => { if (!seen.has(n)) seen.set(n, L.on(n)); }));
    }
    scan(document);
    new MutationObserver(list => {
      for (const m of list) {
        if (m.type === "attributes") check(m.target);
        else m.addedNodes.forEach(n => { if (n.nodeType === 1) { const L = layerOf(n); if (L && !seen.has(n)) seen.set(n, false); check(n); scan(n); } });
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });

    // "Preview on the big screen": replay the entrance on whatever is on top now
    document.addEventListener("scr:lookpreview", e => {
      const kind = (e.detail && e.detail.entrance) || entrance;
      const top = LAYERS.slice().reverse().map(L => [...document.querySelectorAll(L.sel)].find(n => L.on(n))).find(Boolean)
        || stage.querySelector(".scr-frame.on");
      if (top) enter(top, { kind: kind === "fade" ? "zoom" : kind });   // fade has nothing to show: a soft zoom instead
    });
    window.__hannsEnter = { enter, get entrance() { return entrance; } };
  }

  /* ───────────── control board ───────────── */
  const cssB = document.createElement("style");
  cssB.textContent = `
  .tx-row{padding:.75rem 1.2rem;display:flex;flex-direction:column;gap:.65rem}
  .tx-head{display:flex;align-items:center;gap:.9rem;flex-wrap:wrap}
  .tx-ico{flex:none;width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-size:1.1rem;color:#fcd34d;background:rgba(252,211,77,.1)}
  .tx-tx{flex:1 1 220px;min-width:0;display:flex;flex-direction:column;gap:.15rem}
  .tx-tx b{font-size:.95rem}.tx-tx small{font-size:.8rem;color:#a9a6c2}
  .tx-prev{min-height:40px;border-radius:11px;padding:0 .9rem;font:600 .82rem/1 inherit;cursor:pointer;border:1px solid rgba(255,255,255,.14);
    background:rgba(255,255,255,.05);color:#f1f5f9;display:inline-flex;align-items:center;gap:.4rem}
  .tx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:.45rem}
  .tx-c{display:flex;flex-direction:column;align-items:center;gap:.4rem;padding:.55rem .4rem;border-radius:12px;cursor:pointer;color:#e5e7eb;
    border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);font:600 .74rem/1 inherit}
  .tx-c[aria-pressed="true"]{border-color:#fcd34d;background:rgba(252,211,77,.1);color:#fde68a}
  .tx-c:focus-visible{outline:2px solid #fff;outline-offset:2px}
  .tx-mini{position:relative;width:54px;height:32px;border-radius:5px;background:#1f2937;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
  .tx-mini i{position:absolute;inset:0;background:linear-gradient(135deg,#7c3aed,#22d3ee)}
  .tx-c:hover .tx-mini i,.tx-c:focus-visible .tx-mini i,.tx-c[aria-pressed="true"] .tx-mini i{animation:var(--tx) 1.6s cubic-bezier(.22,.8,.24,1) infinite}
  @keyframes tx-rolldown{0%{clip-path:inset(0 0 100% 0)}55%,100%{clip-path:inset(0 0 0 0)}}
  @keyframes tx-rollup{0%{clip-path:inset(100% 0 0 0)}55%,100%{clip-path:inset(0 0 0 0)}}
  @keyframes tx-curtain{0%{clip-path:inset(0 50% 0 50%)}55%,100%{clip-path:inset(0 0 0 0)}}
  @keyframes tx-iris{0%{clip-path:circle(0% at 50% 50%)}55%,100%{clip-path:circle(75% at 50% 50%)}}
  @keyframes tx-slide{0%{transform:translateX(100%)}55%,100%{transform:none}}
  @keyframes tx-zoom{0%{transform:scale(.6);opacity:0}55%,100%{transform:none;opacity:1}}
  @keyframes tx-flip{0%{transform:perspective(120px) rotateX(-80deg);transform-origin:50% 0;opacity:.2}55%,100%{transform:none;opacity:1}}
  @keyframes tx-fade{0%{opacity:0}55%,100%{opacity:1}}
  @keyframes tx-none{0%,100%{opacity:1}}
  .tx-saved{font-size:.76rem;color:#86efac;min-height:1em}
  @media (prefers-reduced-motion:reduce){.tx-c .tx-mini i{animation:none!important}}`;
  document.head.appendChild(cssB);
  function csrf() {
    const i = document.querySelector("[name=csrfmiddlewaretoken]");
    if (i && i.value) return i.value;
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  document.querySelectorAll("[data-screen]").forEach(root => {
    if (root.hasAttribute("data-dj-page")) return;
    const token = root.dataset.token;
    let state = {};
    try { state = JSON.parse(root.querySelector("[data-state]").textContent || "{}"); } catch (_) { /* ignore */ }
    const host = document.createElement("div");
    host.className = "tx-row";
    host.innerHTML = `<div class="tx-head"><span class="tx-ico" aria-hidden="true"><i class="bi bi-film"></i></span>
        <span class="tx-tx"><b>Screen transitions</b><small>How a deck, the lobby, views and video come onto the big screen</small></span>
        <button type="button" class="tx-prev" data-tx-preview title="Play it on the big screen now"><i class="bi bi-play-fill"></i> Preview on the big screen</button></div>
      <div class="tx-grid" role="radiogroup" aria-label="Screen transition">${CHOICES.map(([id, label]) =>
        `<button type="button" class="tx-c" role="radio" data-tx="${id}" style="--tx:tx-${id}"><span class="tx-mini" aria-hidden="true"><i></i></span>${esc(label)}</button>`).join("")}</div>
      <div class="tx-saved" data-tx-saved aria-live="polite"></div>`;
    const slot = root.querySelector("[data-addons]");
    if (slot) slot.appendChild(host); else root.appendChild(host);
    const saved = host.querySelector("[data-tx-saved]");
    let note = null;
    const say = t => { saved.textContent = t; clearTimeout(note); note = setTimeout(() => { saved.textContent = ""; }, 2600); };
    function render() {
      const cur = (state.look && state.look.entrance) || "rolldown";
      host.querySelectorAll("[data-tx]").forEach(b => {
        const on = b.dataset.tx === cur;
        b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-checked", String(on));
      });
    }
    async function post(body) {
      try {
        const r = await fetch(`/screenart/s/${token}/look/`, { method: "POST", credentials: "same-origin",
          headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) { say(j.error || "Couldn't save that."); return null; }
        state.look = j.look; render(); return j;
      } catch (_) { say("No connection to the screen."); return null; }
    }
    host.addEventListener("click", async e => {
      const b = e.target.closest("[data-tx],[data-tx-preview]"); if (!b) return;
      if (b.dataset.tx) {
        const label = (CHOICES.find(c => c[0] === b.dataset.tx) || [0, ""])[1];
        if (await post({ entrance: b.dataset.tx })) say(b.dataset.tx === "none" ? "Saved — things now appear instantly, no animation." : `Saved — things now come in with “${label}”.`);
      } else if (await post({ preview: true })) say("Playing it on the big screen…");
    });
    root.addEventListener("bs:state", ev => { state = ev.detail || state; render(); });
    render();
  });
})();
