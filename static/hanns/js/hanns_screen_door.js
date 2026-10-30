/* ═══════════════════════════════════════════════════════════════════
   HANNS · BIG SCREEN — 🚪 Door screen (host controls)
   ───────────────────────────────────────────────────────────────────
   One panel, mounted in two places:
     • the projector's pull-down panel (Q)
     • the control board (Big screens): a "Door screen" row in each screen
       card's Sources, right under Event background, that opens the same panel

   For the TVs outside the room: switch on a read-only link (copy · open ·
   QR · replace), choose what it shows (agenda · time · caption) and set up
   the welcome host — woman / man, official / casual Gambian dress, animated
   / robot, skin tone, side, how often it gestures, the sign-language welcome
   and the greetings. A live mini preview shows the real door page, which
   polls its own state, so changes reach the TVs within seconds.
   Server: screenart/door.py  (POST /screenart/s/<token>/door/)
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  function csrf() {
    if (window.__SCR_CSRF__) return window.__SCR_CSRF__;
    const i = document.querySelector("[name=csrfmiddlewaretoken]");
    if (i && i.value) return i.value;
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  /* ───────────── styles: self-contained, so it looks right on either page ───────────── */
  const css = document.createElement("style");
  css.textContent = `
  .dr-panel{color:#f4f1ff;font-size:.86rem}
  .dr-h{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:.6rem}
  .dr-h b{display:block;font-size:.95rem}.dr-h span{font-size:.8rem;color:#a9a6c2}
  .dr-sw{display:inline-flex;align-items:center;gap:.5rem;cursor:pointer;font-weight:600;font-size:.84rem;user-select:none}
  .dr-sw input{appearance:none;-webkit-appearance:none;width:38px;height:22px;border-radius:99px;background:rgba(255,255,255,.16);position:relative;cursor:pointer;flex:none;transition:background .15s;margin:0}
  .dr-sw input::after{content:"";position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
  .dr-sw input:checked{background:#22c55e}.dr-sw input:checked::after{transform:translateX(16px)}
  .dr-link{display:flex;gap:.4rem;align-items:center;flex-wrap:wrap;margin:.7rem 0 .4rem}
  .dr-link input{flex:1 1 240px;min-width:0;border-radius:10px;padding:.55rem .7rem;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#f6f4ff;font:500 .78rem ui-monospace,monospace}
  .dr-b{min-height:38px;border-radius:10px;padding:0 .8rem;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);color:#f1f5f9;cursor:pointer;
    display:inline-flex;align-items:center;gap:.4rem;font:600 .8rem/1 inherit;text-decoration:none}
  .dr-b:hover{border-color:#a78bfa}.dr-b.go{border:0;color:#04121a;background:linear-gradient(135deg,#22d3ee,#a78bfa)}
  .dr-row{display:flex;flex-wrap:wrap;gap:.5rem 1.1rem;align-items:center;margin:.55rem 0}
  .dr-sub{margin:1rem 0 .4rem;font:600 .68rem/1 ui-monospace,monospace;letter-spacing:.18em;text-transform:uppercase;color:#a9a6c2}
  .dr-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:.55rem 1rem;margin-top:.55rem}
  .dr-seg,.dr-f{display:flex;align-items:center;gap:.4rem;font-size:.8rem;color:#a9a6c2}
  .dr-seg>span,.dr-f>span{min-width:4.8em}
  .dr-seg button{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#f4f1ff;border-radius:9px;padding:.38rem .62rem;cursor:pointer;font:500 .78rem/1 inherit}
  .dr-seg button.on{background:rgba(34,211,238,.16);border-color:rgba(34,211,238,.55)}
  .dr-f input,.dr-f select,.dr-f textarea{flex:1;min-width:0;border-radius:9px;padding:.42rem .55rem;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#f4f1ff;font:inherit;font-size:.82rem}
  .dr-f select option{color:#111}.dr-f textarea{min-height:64px;resize:vertical}.dr-f.wide{grid-column:1/-1;align-items:flex-start}
  .dr-skin{display:flex;gap:.35rem}.dr-skin button{width:26px;height:26px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
  .dr-skin button.on{border-color:#fff;box-shadow:0 0 0 2px #a78bfa}
  .dr-prev{position:relative;margin-top:.8rem;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.14);aspect-ratio:16/9;background:#07101f;max-width:760px}
  .dr-prev iframe{position:absolute;left:0;top:0;width:1600px;height:900px;border:0;transform-origin:0 0;pointer-events:none}
  .dr-prev span{position:absolute;left:.5rem;top:.45rem;z-index:1;font:700 .62rem/1 ui-monospace,monospace;letter-spacing:.14em;background:rgba(0,0,0,.6);color:#fff;border-radius:6px;padding:.25rem .45rem}
  .dr-prev em{position:absolute;inset:0;display:grid;place-items:center;font-style:normal;color:#a9a6c2;font-size:.85rem;text-align:center;padding:1rem}
  .dr-qr{display:none;margin:.5rem 0;background:#fff;border-radius:10px;padding:10px;width:max-content}.dr-qr.on{display:block}
  .dr-note{font-size:.78rem;color:#a9a6c2;margin:.2rem 0 0;font-weight:400}.dr-msg{font-size:.8rem;margin:.4rem 0 0;color:#86efac;min-height:1em}.dr-msg.bad{color:#fda4af}
  .dr-off{opacity:.42;pointer-events:none}
  /* control-board row (matches Event background's) */
  .dr-boardbtn .bs-bg-sw{color:#5eead4}
  .dr-boardbtn.on .bs-bg-txt small{color:#86efac;font-weight:600}
  .dr-boardpanel{padding:1rem 1.2rem;border-bottom:1px solid var(--kk-border,rgba(255,255,255,.1));background:radial-gradient(120% 120% at 0% 0%,rgba(45,212,191,.07),transparent 60%)}
  .scr-pb .dr-panel{margin-top:1.1rem}`;
  document.head.appendChild(css);

  const seg = (k, label, opts) => `<div class="dr-seg" data-k="${k}"><span>${label}</span>${opts.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join("")}</div>`;
  const TEMPLATE = `
    <div class="dr-h"><div><b>🚪 Door screen</b><span>For the TVs outside the room: the event background, caption, time and agenda — nothing else — with a welcome host.</span></div></div>
    <label class="dr-sw"><input type="checkbox" class="dr-on"> <span class="dr-on-l">Door screen link</span></label>
    <div class="dr-body">
      <div class="dr-link"><input class="dr-url" readonly aria-label="Door screen link">
        <button type="button" class="dr-b dr-copy" title="Copy the link"><i class="bi bi-clipboard"></i> Copy</button>
        <a class="dr-b go dr-open" target="_blank" rel="noopener" title="Open it — put this on the door TV"><i class="bi bi-box-arrow-up-right"></i> Open</a>
        <button type="button" class="dr-b dr-qrbtn" title="QR code — open it on a TV or tablet by scanning"><i class="bi bi-qr-code"></i> QR</button>
        <button type="button" class="dr-b dr-rotate" title="Replace the link (the old one stops working)"><i class="bi bi-arrow-repeat"></i> New link</button></div>
      <div class="dr-qr"></div>
      <div class="dr-row">
        <label class="dr-sw"><input type="checkbox" data-show="agenda"> Agenda <small class="dr-ev dr-note"></small></label>
        <label class="dr-sw"><input type="checkbox" data-show="clock"> Time</label>
        <label class="dr-sw"><input type="checkbox" data-show="caption"> Caption & countdown</label>
      </div>
      <label class="dr-f wide"><span>Title</span><input type="text" maxlength="80" class="dr-title" placeholder="The event's name (or this screen's name)"></label>
      <div class="dr-sub">Welcome host</div>
      <label class="dr-sw"><input type="checkbox" class="dr-gon"> Show the welcome host</label>
      <div class="dr-host">
        <div class="dr-grid">
          ${seg("figure", "Host", [["woman", "👩🏾 Woman"], ["man", "👨🏾 Man"]])}
          ${seg("outfit", "Dress", [["official", "Office wear"], ["traditional", "Traditional"], ["casual", "Casual"]])}
          ${seg("style", "Style", [["animated", "Animated"], ["robot", "🤖 Robot"]])}
          ${seg("side", "Stands", [["left", "Left"], ["right", "Right"]])}
          <div class="dr-seg"><span>Skin</span><div class="dr-skin">${[["1", "#8a5a3b"], ["2", "#5e3a22"], ["3", "#3b2416"]].map(([v, c]) => `<button type="button" data-skin="${v}" style="background:${c}" title="Tone ${v}"></button>`).join("")}</div></div>
          <label class="dr-f"><span>Gestures</span><select class="dr-every">${[4, 6, 8, 10, 15, 20].map(s => `<option value="${s}">every ${s} s</option>`).join("")}</select></label>
        </div>
        <div class="dr-row"><label class="dr-sw"><input type="checkbox" class="dr-sign"> 🤟 Welcome in sign language</label></div>
        <div class="dr-grid">
          <label class="dr-f wide"><span>Says</span><textarea class="dr-lines" placeholder="One greeting per line"></textarea></label>
          <label class="dr-f wide"><span>Points</span><input type="text" maxlength="40" class="dr-way" placeholder="Come in — this way"></label>
        </div>
      </div>
      <div class="dr-prev"><span>LIVE PREVIEW</span><em class="dr-prev-off">Switch the link on to see the door screen here.</em><iframe title="Door screen preview" loading="lazy"></iframe></div>
    </div>
    <div class="dr-msg" aria-live="polite"></div>`;

  /* ───────────── one panel bound to one screen ───────────── */
  function mount(host, opts) {
    const url = `/screenart/s/${opts.token}/door/`;
    let door = null, saveT = null, previewT = null, hasEvent = !!opts.hasEvent;
    host.classList.add("dr-panel");
    host.innerHTML = TEMPLATE;
    const q = s => host.querySelector(s);
    const msg = (text, bad) => {
      if (opts.toast) return opts.toast(text, bad);
      const m = q(".dr-msg"); m.textContent = text; m.classList.toggle("bad", !!bad);
      clearTimeout(m._t); m._t = setTimeout(() => { m.textContent = ""; }, 3500);
    };
    async function call(body) {
      const r = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || (r.status === 410 ? "This big screen has been stopped." : "Could not save the door screen."));
      door = d.door; render(); if (opts.onChange) opts.onChange(door); return door;
    }
    function set(patch, now) {
      Object.assign(door, patch.greeter ? { greeter: Object.assign({}, door.greeter, patch.greeter) } : patch);
      render(true);
      if (opts.onChange) opts.onChange(door);
      clearTimeout(saveT);
      saveT = setTimeout(() => call(Object.assign({ op: "set" }, patch)).catch(e => msg(e.message, true)), now ? 0 : 450);
    }
    function fitPreview() {
      const box = q(".dr-prev"); if (!box || !box.clientWidth) return;
      box.querySelector("iframe").style.transform = `scale(${box.clientWidth / 1600})`;
    }
    function refreshPreview(force) {
      const f = q(".dr-prev iframe");
      const want = door && door.on && door.url ? door.url + "?preview=1" : "about:blank";
      q(".dr-prev-off").hidden = want !== "about:blank";
      clearTimeout(previewT);
      // the door page picks up settings by itself within seconds; reload only when the link changes
      if (force || f.dataset.src !== want) previewT = setTimeout(() => { f.dataset.src = want; f.src = want; }, 150);
    }
    function render(local) {
      if (!door) return;
      const on = !!door.on, g = door.greeter || {};
      q(".dr-on").checked = on;
      q(".dr-on-l").textContent = on ? "Door screen link is on" : "Door screen link";
      q(".dr-body").classList.toggle("dr-off", !on);
      q(".dr-url").value = door.url || "";
      const open = q(".dr-open"); if (door.url) open.href = door.url; else open.removeAttribute("href");
      host.querySelectorAll("[data-show]").forEach(n => { n.checked = !!door[n.dataset.show]; });
      const title = q(".dr-title"); if (document.activeElement !== title) title.value = door.title || "";
      q(".dr-gon").checked = !!g.on;
      q(".dr-host").classList.toggle("dr-off", !g.on);
      host.querySelectorAll(".dr-seg[data-k]").forEach(s => s.querySelectorAll("button").forEach(b => b.classList.toggle("on", g[s.dataset.k] === b.dataset.v)));
      host.querySelectorAll(".dr-skin button").forEach(b => b.classList.toggle("on", +b.dataset.skin === +g.skin));
      q(".dr-every").value = String(g.every || 6);
      q(".dr-sign").checked = !!g.sign;
      const lines = q(".dr-lines"); if (document.activeElement !== lines) lines.value = (g.lines || []).join("\n");
      const way = q(".dr-way"); if (document.activeElement !== way) way.value = g.way || "";
      q(".dr-ev").textContent = hasEvent ? "" : "(link an event in 📋 Event)";
      if (!local) refreshPreview();
      fitPreview();
    }

    q(".dr-on").addEventListener("change", e => call({ op: "set", on: e.target.checked }).then(() => {
      msg(e.target.checked ? "🚪 Door screen link is on — open it on the TV outside" : "Door screen link switched off"); refreshPreview(true);
    }).catch(er => { e.target.checked = !e.target.checked; msg(er.message, true); }));
    q(".dr-copy").addEventListener("click", () => {
      const v = door && door.url; if (!v) return;
      (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => msg("Door screen link copied"), () => { q(".dr-url").select(); document.execCommand("copy"); msg("Door screen link copied"); });
    });
    q(".dr-qrbtn").addEventListener("click", () => {
      const box = q(".dr-qr"); box.classList.toggle("on");
      if (box.classList.contains("on")) { box.innerHTML = ""; if (window.QRCode && door && door.url) new QRCode(box, { text: door.url, width: 150, height: 150 }); }
    });
    q(".dr-rotate").addEventListener("click", () => {
      if (!confirm("Replace the door screen link? TVs showing the old link will stop until you open the new one.")) return;
      call({ op: "rotate" }).then(() => { msg("New door screen link made"); refreshPreview(true); }).catch(e => msg(e.message, true));
    });
    host.querySelectorAll("[data-show]").forEach(n => n.addEventListener("change", e => set({ [n.dataset.show]: e.target.checked }, true)));
    q(".dr-title").addEventListener("input", e => set({ title: e.target.value }));
    q(".dr-gon").addEventListener("change", e => set({ greeter: { on: e.target.checked } }, true));
    host.querySelectorAll(".dr-seg[data-k]").forEach(s => s.addEventListener("click", e => {
      const b = e.target.closest("button[data-v]"); if (b) set({ greeter: { [s.dataset.k]: b.dataset.v } }, true);
    }));
    q(".dr-skin").addEventListener("click", e => { const b = e.target.closest("button[data-skin]"); if (b) set({ greeter: { skin: +b.dataset.skin } }, true); });
    q(".dr-every").addEventListener("change", e => set({ greeter: { every: +e.target.value } }, true));
    q(".dr-sign").addEventListener("change", e => set({ greeter: { sign: e.target.checked } }, true));
    q(".dr-lines").addEventListener("input", e => set({ greeter: { lines: e.target.value.split("\n") } }));
    q(".dr-way").addEventListener("input", e => set({ greeter: { way: e.target.value } }));
    if (window.ResizeObserver) new ResizeObserver(fitPreview).observe(q(".dr-prev"));

    const api = {
      load: () => call({ op: "get" }).catch(e => msg(e.message, true)),
      setHasEvent(v) { hasEvent = !!v; render(true); },
      get door() { return door; },
    };
    api.load();
    return api;
  }

  /* ───────────── words for a collapsed row ───────────── */
  function summary(d) {
    if (!d || !d.on) return "Off · a welcome screen for the TV by the door";
    const g = d.greeter || {};
    const dress = { casual: "Casual", traditional: "Traditional" }[g.outfit] || "Office wear";
    const host = g.on ? [g.figure === "man" ? "Man" : "Woman", dress, g.style === "robot" ? "Robot" : "Animated"].join(" · ") : "No host";
    return `● Link on · ${host}`;
  }

  /* ───────────── projector page: in the pull-down panel ───────────── */
  (function projector() {
    const cfgNode = $("#scr-cfg"); if (!cfgNode) return;
    const pb = $("#scr-panel .scr-pb"); if (!pb) return;
    let token = "";
    try { token = (JSON.parse(cfgNode.textContent || "{}").backdropBase || "").split("/").filter(Boolean).pop() || ""; } catch (e) {}
    if (!token) return;
    let st = null; try { st = JSON.parse(($("#scr-state") || {}).textContent || "null"); } catch (e) {}
    const box = document.createElement("section");
    pb.appendChild(box);
    const toast = (text, bad) => {
      const t = $("#scr-toasts"); if (!t) return;
      const n = document.createElement("div"); n.className = "scr-toast" + (bad ? " bad" : ""); n.textContent = text;
      t.appendChild(n); setTimeout(() => n.remove(), 3200);
    };
    const panel = mount(box, { token, toast, hasEvent: !!(st && st.event && st.event.id) });
    document.addEventListener("scr:state", e => { const s = e.detail || {}; panel.setHasEvent(!!(s.event && s.event.id)); });
  })();

  /* ───────────── control board: a "Door screen" row in each card's Sources ───────────── */
  document.querySelectorAll("[data-screen][data-token]").forEach(root => {
    const slot = root.querySelector("[data-addons]");
    if (!slot) return;
    const token = root.dataset.token;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bs-bg-btn dr-boardbtn";
    btn.setAttribute("aria-expanded", "false");
    btn.title = "A read-only welcome & event-information screen for the TVs outside the room";
    btn.innerHTML = `<span class="bs-bg-sw"><i class="bi bi-door-open"></i></span>
      <span class="bs-bg-txt"><b>Door screen</b><small data-dr-sub>Welcome screen for the TV by the door</small></span>
      <i class="bi bi-chevron-down bs-bg-chev"></i>`;
    const panelBox = document.createElement("div");
    panelBox.className = "dr-boardpanel"; panelBox.hidden = true;
    slot.prepend(panelBox); slot.prepend(btn);                      // right under Event background
    let panel = null, lastState = null;
    const paintRow = d => {
      btn.classList.toggle("on", !!(d && d.on));
      btn.querySelector("[data-dr-sub]").textContent = summary(d);
    };
    btn.addEventListener("click", () => {
      const open = panelBox.hidden;
      panelBox.hidden = !open; btn.classList.toggle("open", open); btn.setAttribute("aria-expanded", String(open));
      if (open && !panel) {
        panel = mount(panelBox, { token, onChange: paintRow, hasEvent: !!(lastState && lastState.event && lastState.event.id) });
      } else if (open && panel) panel.load();                   // fresh settings each time it opens
    });
    root.addEventListener("bs:state", ev => {
      lastState = ev.detail || lastState;
      if (panel) panel.setHasEvent(!!(lastState && lastState.event && lastState.event.id));
    });
    // fill the collapsed row's status straight away
    fetch(`/screenart/s/${token}/door/`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() }, body: '{"op":"get"}' })
      .then(r => r.json()).then(d => { if (d && d.ok) paintRow(d.door); }).catch(() => {});
  });

  window.HannsDoorPanel = { mount, summary };
})();
