/* ═══════════════════════════════════════════════════════════════════
   HANNS · BIG SCREEN — 🚪 Door screen (host controls)
   ───────────────────────────────────────────────────────────────────
   A section in the projector's pull-down panel for the TVs outside the
   room: switch on a read-only link (copy · open · QR · replace), choose
   what it shows (agenda · clock · caption) and set up the welcome host —
   woman / man, official / casual Gambian dress, animated / robot, skin
   tone, side, how often it gestures, the sign-language welcome and the
   greetings it says. A live mini preview shows the real door page.
   The door page polls its own state, so changes appear there in seconds.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const CFG = JSON.parse(($("#scr-cfg") || {}).textContent || "{}");
  if (!CFG.backdropBase) return;
  const URL_ = CFG.backdropBase + "door/";
  const CSRF = window.__SCR_CSRF__ || "";
  let door = null, sec = null, saveT = null, previewT = null;

  function toast(msg, bad) {
    const box = $("#scr-toasts"); if (!box) return;
    const t = document.createElement("div"); t.className = "scr-toast" + (bad ? " bad" : ""); t.textContent = msg;
    box.appendChild(t); setTimeout(() => t.remove(), 3200);
  }
  async function call(body) {
    const r = await fetch(URL_, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": CSRF }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.error || "Could not save the door screen.");
    door = d.door; render(); return door;
  }
  function set(patch, now) {
    Object.assign(door, patch.greeter ? { greeter: Object.assign({}, door.greeter, patch.greeter) } : patch);
    render(true);
    clearTimeout(saveT);
    saveT = setTimeout(() => call(Object.assign({ op: "set" }, patch)).then(refreshPreview).catch(e => toast(e.message, true)), now ? 0 : 450);
  }

  const css = document.createElement("style");
  css.textContent = `
  .dr-panel{margin-top:1.1rem}
  .dr-link{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;margin:.55rem 0}
  .dr-link input{flex:1 1 220px;min-width:0;border-radius:10px;padding:.5rem .65rem;border:1px solid var(--scr-line,rgba(255,255,255,.18));background:rgba(255,255,255,.05);color:var(--scr-text,#f6f4ff);font:500 .78rem ui-monospace,monospace}
  .dr-row{display:flex;flex-wrap:wrap;gap:.45rem .9rem;align-items:center;margin:.45rem 0}
  .dr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:.55rem .9rem;margin-top:.6rem}
  .dr-skin{display:flex;gap:.35rem}.dr-skin button{width:26px;height:26px;border-radius:50%;border:2px solid transparent;cursor:pointer}
  .dr-skin button.on{border-color:#fff;box-shadow:0 0 0 2px #a78bfa}
  .dr-lines{width:100%;min-height:62px;border-radius:10px;padding:.45rem .6rem;border:1px solid var(--scr-line,rgba(255,255,255,.18));background:rgba(255,255,255,.05);color:var(--scr-text,#f6f4ff);font:inherit;font-size:.8rem;resize:vertical}
  .dr-prev{position:relative;margin-top:.7rem;border-radius:12px;overflow:hidden;border:1px solid var(--scr-line,rgba(255,255,255,.18));aspect-ratio:16/9;background:#07101f}
  .dr-prev iframe{position:absolute;left:0;top:0;width:1600px;height:900px;border:0;transform-origin:0 0;pointer-events:none}
  .dr-prev span{position:absolute;left:.5rem;top:.45rem;z-index:1;font:700 .62rem/1 ui-monospace,monospace;letter-spacing:.14em;background:rgba(0,0,0,.55);color:#fff;border-radius:6px;padding:.25rem .45rem}
  .dr-qr{display:none;margin:.5rem 0;background:#fff;border-radius:10px;padding:10px;width:max-content}.dr-qr.on{display:block}
  .dr-note{font-size:.72rem;color:var(--scr-dim,#a9a6c2);margin:.3rem 0 0}
  .dr-off{opacity:.45;pointer-events:none}`;
  document.head.appendChild(css);

  function seg(key, label, options, greeter) {
    return `<div class="sbd-seg" data-k="${key}" data-g="${greeter ? 1 : ""}"><span>${label}</span>${options.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join("")}</div>`;
  }
  function build() {
    const pb = $("#scr-panel .scr-pb");
    if (!pb || sec) return;
    sec = document.createElement("section");
    sec.className = "dr-panel";
    sec.innerHTML = `
      <div class="scr-sec"><h3>🚪 Door screen</h3><span class="count dr-state"></span></div>
      <p class="dr-note">For the TVs outside the room: the event background, caption, time and agenda — nothing else — with a welcome host.</p>
      <label class="sbd-switch"><input type="checkbox" class="dr-on"> Door screen link</label>
      <div class="dr-body">
        <div class="dr-link"><input class="dr-url" readonly>
          <button type="button" class="scr-btn dr-copy" title="Copy the link"><i class="bi bi-clipboard"></i></button>
          <a class="scr-btn dr-open" target="_blank" rel="noopener" title="Open it (put this on the door TV)"><i class="bi bi-box-arrow-up-right"></i></a>
          <button type="button" class="scr-btn dr-qrbtn" title="QR code — open it on a TV or tablet by scanning"><i class="bi bi-qr-code"></i></button>
          <button type="button" class="scr-btn dr-rotate" title="Replace the link (the old one stops working)"><i class="bi bi-arrow-repeat"></i></button></div>
        <div class="dr-qr"></div>
        <div class="dr-row">
          <label class="sbd-switch"><input type="checkbox" data-show="agenda"> Agenda <small class="dr-ev"></small></label>
          <label class="sbd-switch"><input type="checkbox" data-show="clock"> Time</label>
          <label class="sbd-switch"><input type="checkbox" data-show="caption"> Caption & countdown</label>
        </div>
        <label class="sbd-field sbd-wide"><span>Title</span><input type="text" maxlength="80" class="dr-title" placeholder="The event's name (or this screen's name)"></label>
        <div class="scr-sec" style="margin-top:.9rem"><h3>Welcome host</h3></div>
        <label class="sbd-switch"><input type="checkbox" class="dr-gon"> Show the welcome host</label>
        <div class="dr-host">
          <div class="dr-grid">
            ${seg("figure", "Host", [["woman", "👩🏾 Woman"], ["man", "👨🏾 Man"]], true)}
            ${seg("outfit", "Dress", [["official", "Official"], ["casual", "Casual"]], true)}
            ${seg("style", "Style", [["animated", "Animated"], ["robot", "🤖 Robot"]], true)}
            ${seg("side", "Stands", [["left", "Left"], ["right", "Right"]], true)}
            <div class="sbd-seg"><span>Skin</span><div class="dr-skin">${[["1", "#8a5a3b"], ["2", "#5e3a22"], ["3", "#3b2416"]].map(([v, c]) => `<button type="button" data-skin="${v}" style="background:${c}" title="Tone ${v}"></button>`).join("")}</div></div>
            <label class="sbd-field"><span>Gestures</span><select class="dr-every">${[4, 6, 8, 10, 15, 20].map(s => `<option value="${s}">every ${s} s</option>`).join("")}</select></label>
          </div>
          <label class="sbd-switch" style="margin-top:.55rem"><input type="checkbox" class="dr-sign"> 🤟 Welcome in sign language</label>
          <label class="sbd-field sbd-wide" style="margin-top:.45rem;align-items:flex-start"><span>Says</span><textarea class="dr-lines" placeholder="One greeting per line"></textarea></label>
          <label class="sbd-field sbd-wide"><span>Points</span><input type="text" maxlength="40" class="dr-way" placeholder="Come in — this way"></label>
        </div>
        <div class="dr-prev"><span>LIVE PREVIEW</span><iframe title="Door screen preview" loading="lazy"></iframe></div>
      </div>`;
    pb.appendChild(sec);
    sec.querySelector(".dr-on").addEventListener("change", e => call({ op: "set", on: e.target.checked }).then(() => {
      toast(e.target.checked ? "🚪 Door screen link is on — open it on the TV outside" : "Door screen link switched off"); refreshPreview(true);
    }).catch(er => toast(er.message, true)));
    sec.querySelector(".dr-copy").addEventListener("click", () => {
      const v = door && door.url; if (!v) return;
      (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => toast("Door screen link copied"), () => { sec.querySelector(".dr-url").select(); document.execCommand("copy"); toast("Door screen link copied"); });
    });
    sec.querySelector(".dr-qrbtn").addEventListener("click", () => {
      const box = sec.querySelector(".dr-qr"); box.classList.toggle("on");
      if (box.classList.contains("on")) { box.innerHTML = ""; if (window.QRCode && door.url) new QRCode(box, { text: door.url, width: 150, height: 150 }); }
    });
    sec.querySelector(".dr-rotate").addEventListener("click", () => {
      if (!confirm("Replace the door screen link? TVs showing the old link will stop until you open the new one.")) return;
      call({ op: "rotate" }).then(() => { toast("New door screen link made"); refreshPreview(true); }).catch(e => toast(e.message, true));
    });
    sec.querySelectorAll("[data-show]").forEach(n => n.addEventListener("change", e => set({ [n.dataset.show]: e.target.checked }, true)));
    sec.querySelector(".dr-title").addEventListener("input", e => set({ title: e.target.value }));
    sec.querySelector(".dr-gon").addEventListener("change", e => set({ greeter: { on: e.target.checked } }, true));
    sec.querySelectorAll(".sbd-seg[data-k]").forEach(s => s.addEventListener("click", e => {
      const b = e.target.closest("button[data-v]"); if (b) set({ greeter: { [s.dataset.k]: b.dataset.v } }, true);
    }));
    sec.querySelector(".dr-skin").addEventListener("click", e => { const b = e.target.closest("button[data-skin]"); if (b) set({ greeter: { skin: +b.dataset.skin } }, true); });
    sec.querySelector(".dr-every").addEventListener("change", e => set({ greeter: { every: +e.target.value } }, true));
    sec.querySelector(".dr-sign").addEventListener("change", e => set({ greeter: { sign: e.target.checked } }, true));
    sec.querySelector(".dr-lines").addEventListener("input", e => set({ greeter: { lines: e.target.value.split("\n") } }));
    sec.querySelector(".dr-way").addEventListener("input", e => set({ greeter: { way: e.target.value } }));
    new ResizeObserver(fitPreview).observe(sec.querySelector(".dr-prev"));
  }
  function fitPreview() {
    const box = sec && sec.querySelector(".dr-prev"); if (!box) return;
    box.querySelector("iframe").style.transform = `scale(${box.clientWidth / 1600})`;
  }
  function refreshPreview(force) {
    if (!sec || !door) return;
    const f = sec.querySelector(".dr-prev iframe");
    const want = door.on && door.url ? door.url + "?preview=1" : "about:blank";
    clearTimeout(previewT);
    // the door page picks up settings on its own within seconds; reload only when the link itself changed
    if (force || f.dataset.src !== want) previewT = setTimeout(() => { f.dataset.src = want; f.src = want; }, 150);
  }
  function render(local) {
    if (!sec || !door) return;
    const on = !!door.on, g = door.greeter || {};
    sec.querySelector(".dr-on").checked = on;
    sec.querySelector(".dr-state").textContent = on ? "ON" : "";
    sec.querySelector(".dr-body").classList.toggle("dr-off", !on);
    sec.querySelector(".dr-url").value = door.url || "";
    const open = sec.querySelector(".dr-open"); if (door.url) open.href = door.url; else open.removeAttribute("href");
    sec.querySelectorAll("[data-show]").forEach(n => { n.checked = !!door[n.dataset.show]; });
    const title = sec.querySelector(".dr-title"); if (document.activeElement !== title) title.value = door.title || "";
    sec.querySelector(".dr-gon").checked = !!g.on;
    sec.querySelector(".dr-host").classList.toggle("dr-off", !g.on);
    sec.querySelectorAll(".sbd-seg[data-k]").forEach(s => s.querySelectorAll("button").forEach(b => b.classList.toggle("on", g[s.dataset.k] === b.dataset.v)));
    sec.querySelectorAll(".dr-skin button").forEach(b => b.classList.toggle("on", +b.dataset.skin === +g.skin));
    sec.querySelector(".dr-every").value = String(g.every || 6);
    sec.querySelector(".dr-sign").checked = !!g.sign;
    const lines = sec.querySelector(".dr-lines"); if (document.activeElement !== lines) lines.value = (g.lines || []).join("\n");
    const way = sec.querySelector(".dr-way"); if (document.activeElement !== way) way.value = g.way || "";
    let st = null; try { st = JSON.parse(($("#scr-state") || {}).textContent || "null"); } catch (e) {}
    sec.querySelector(".dr-ev").textContent = st && st.event && st.event.id ? "" : "(link an event in 📋 Event)";
    if (!local) refreshPreview();
    fitPreview();
  }

  build();
  call({ op: "get" }).catch(() => {});
})();
