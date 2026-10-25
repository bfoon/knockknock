/* ═══════════════════════════════════════════════════════════════════
   HANNS · BIG SCREEN — event backgrounds
   ───────────────────────────────────────────────────────────────────
   The host's pull-down panel gets an "Event background" section:
     • upload event artwork (button or drag images onto the panel)
     • click a thumbnail to make it the background
     • 📺 Show on screen  (or press B)  → fills the projector, even over a
       deck that's playing — breaks, welcomes, sponsors. B again: back.
     • Behind the lobby  → the waiting screen uses the event image
     • Fill / Fit · Dim · Slow zoom · Slideshow (8–60 s, crossfades)
     • Caption + "Back at HH:MM" live countdown · share code chip
   Everything renders from the same state snapshot as the rest of the big
   screen (state.backdrop, pushed over the socket), so every open copy of
   this screen — projector and host laptop — stays in step.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const CFG = JSON.parse(($("#scr-cfg") || {}).textContent || "{}");
  const BASE = CFG.backdropBase;
  if (!BASE) return;
  const CSRF = window.__SCR_CSRF__ || "";
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let state = JSON.parse(($("#scr-state") || {}).textContent || "{}");
  let bd = state.backdrop || null;

  /* ───────────── projector layers ───────────── */
  // full-screen layer (over the deck and the lobby, under the host's controls)
  const show = document.createElement("div");
  show.className = "sbd-layer sbd-show"; show.setAttribute("aria-hidden", "true");
  document.body.appendChild(show);
  // behind the lobby card
  const lobby = $("#scr-lobby");
  const behind = document.createElement("div");
  behind.className = "sbd-layer sbd-behind"; behind.setAttribute("aria-hidden", "true");
  if (lobby) lobby.insertBefore(behind, lobby.firstChild);

  function makeView(host) {
    host.innerHTML = `<div class="sbd-img a"></div><div class="sbd-img b"></div><div class="sbd-dim"></div>
      <div class="sbd-text"><div class="sbd-caption"></div><div class="sbd-count"></div></div><div class="sbd-code"></div>`;
    return { host, a: host.querySelector(".a"), b: host.querySelector(".b"), front: "a", url: null };
  }
  const views = [makeView(show), makeView(behind)];

  let slideIdx = 0, slideTimer = null;
  function order() {
    const imgs = (bd && bd.images) || [];
    const i = Math.max(0, imgs.findIndex(x => x.id === bd.active));
    return imgs.slice(i).concat(imgs.slice(0, i));       // the active image first
  }
  function currentImage() {
    const o = order();
    return o.length ? o[slideIdx % o.length] : null;
  }
  function paintView(v, img) {
    const url = img ? img.url : null;
    v.host.classList.toggle("contain", bd && bd.fit === "contain");
    v.host.classList.toggle("drift", bd && bd.motion === "drift");
    v.host.querySelector(".sbd-dim").style.opacity = bd ? String((bd.dim || 0) / 100) : "0";
    if (url === v.url) return;
    v.url = url;
    const next = v.front === "a" ? v.b : v.a, prev = v.front === "a" ? v.a : v.b;
    next.style.backgroundImage = url ? `url("${url.replace(/"/g, "%22")}")` : "none";
    next.style.setProperty("--sbd-origin", ["20% 30%", "80% 25%", "50% 70%", "30% 80%"][slideIdx % 4]);
    next.classList.remove("in"); void next.offsetWidth; next.classList.add("in");
    prev.classList.remove("in");
    v.front = v.front === "a" ? "b" : "a";
  }
  function paintText(v) {
    const cap = v.host.querySelector(".sbd-caption");
    cap.textContent = (bd && bd.caption) || "";
    cap.hidden = !cap.textContent;
    const code = v.host.querySelector(".sbd-code");
    const sc = String(state.share_code || "");
    code.hidden = !(bd && bd.code && sc && v.host === show);
    code.innerHTML = code.hidden ? "" : `Share your deck · <b>${esc(sc.slice(0, 3) + " " + sc.slice(3))}</b>`;
  }
  function tickCountdown() {
    const target = bd && bd.countdown;
    views.forEach(v => {
      const el = v.host.querySelector(".sbd-count");
      if (!target) { el.hidden = true; return; }
      const [hh, mm] = target.split(":").map(Number);
      const now = new Date(), t = new Date(now); t.setHours(hh, mm, 0, 0);
      let left = Math.round((t - now) / 1000);
      if (left < -12 * 3600) left += 24 * 3600;           // it's for tomorrow
      el.hidden = false;
      if (left <= 0) { el.innerHTML = `<span class="sbd-now">Starting now</span>`; return; }
      const h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
      const clock = (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
      el.innerHTML = `<small>Back at ${esc(target)}</small><b>${clock}</b>`;
    });
  }
  setInterval(tickCountdown, 1000);

  function render() {
    const has = !!(bd && bd.images && bd.images.length);
    const img = has ? currentImage() : null;
    document.body.classList.toggle("sbd-on", !!(has && bd.show));
    show.classList.toggle("on", !!(has && bd.show));
    const useLobby = !!(has && bd.lobby);
    behind.classList.toggle("on", useLobby);
    if (lobby) lobby.classList.toggle("sbd-lobby", useLobby);
    views.forEach(v => { paintView(v, img); paintText(v); });
    tickCountdown();
    // slideshow
    clearInterval(slideTimer);
    if (has && bd.slideshow && bd.images.length > 1) {
      slideTimer = setInterval(() => { slideIdx++; views.forEach(v => paintView(v, currentImage())); }, bd.slideshow * 1000);
    }
    renderPanel();
  }

  document.addEventListener("scr:state", e => {
    const prevActive = bd && bd.active;
    state = e.detail || state;
    bd = state.backdrop || null;
    if (!bd || bd.active !== prevActive) slideIdx = 0;
    render();
  });

  /* ───────────── server ───────────── */
  async function post(path, body, isForm) {
    const r = await fetch(BASE + path, {
      method: "POST", credentials: "same-origin",
      headers: Object.assign({ "X-CSRFToken": CSRF }, isForm ? {} : { "Content-Type": "application/json" }),
      body: isForm ? body : JSON.stringify(body || {}),
    });
    let d = null; try { d = await r.json(); } catch (_) { /* html error */ }
    if (!r.ok || !d || !d.ok) throw new Error((d && d.error) || "Something went wrong (" + r.status + ")");
    return d;
  }
  function adopt(d) { if (d && d.state) document.dispatchEvent(new CustomEvent("scr:state", { detail: d.state })); }
  function toast(msg, bad) {
    const box = $("#scr-toasts"); if (!box) return;
    const t = document.createElement("div");
    t.className = "scr-toast sbd-toast" + (bad ? " bad" : "");
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => t.remove(), 4200);
  }
  let pendingPatch = {}, patchTimer = null;
  function set(patch, now) {                    // optimistic, debounced settings
    bd = Object.assign({}, bd || {}, patch);
    Object.assign(pendingPatch, patch);
    render();
    clearTimeout(patchTimer);
    patchTimer = setTimeout(flush, now ? 0 : 350);
  }
  async function flush() {
    const p = pendingPatch; pendingPatch = {};
    try { adopt(await post("settings/", p)); } catch (e) { toast(e.message, true); }
  }
  function upload(files) {
    const list = [...files].filter(f => /^image\//.test(f.type));
    if (!list.length) { toast("Drop image files (JPG, PNG, WebP or GIF)", true); return; }
    const fd = new FormData();
    list.slice(0, 12).forEach(f => fd.append("file", f));
    const bar = panel && panel.querySelector(".sbd-progress");
    if (bar) { bar.hidden = false; bar.firstElementChild.style.width = "0%"; }
    const x = new XMLHttpRequest();
    x.open("POST", BASE + "upload/");
    x.setRequestHeader("X-CSRFToken", CSRF);
    x.withCredentials = true;
    x.upload.onprogress = e => { if (bar && e.lengthComputable) bar.firstElementChild.style.width = Math.round(100 * e.loaded / e.total) + "%"; };
    x.onload = () => {
      if (bar) bar.hidden = true;
      let d = null; try { d = JSON.parse(x.responseText); } catch (_) { /* ignore */ }
      if (x.status >= 200 && x.status < 300 && d && d.ok) {
        adopt(d);
        toast(`🖼 ${d.added.length} background${d.added.length > 1 ? "s" : ""} added` + (d.errors.length ? ` · ${d.errors.length} skipped` : ""));
        (d.errors || []).forEach(m => toast(m, true));
      } else toast((d && d.error) || "Upload failed", true);
    };
    x.onerror = () => { if (bar) bar.hidden = true; toast("Upload failed — check the connection", true); };
    x.send(fd);
  }

  /* ───────────── host panel section ───────────── */
  let panel = null;
  function buildPanel() {
    const pb = $("#scr-panel .scr-pb");
    if (!pb || panel) return;
    panel = document.createElement("section");
    panel.className = "sbd-panel";
    panel.innerHTML = `
      <div class="scr-sec"><h3>Event background</h3><span class="count sbd-n"></span></div>
      <div class="sbd-strip"></div>
      <div class="sbd-progress" hidden><i></i></div>
      <div class="sbd-main">
        <button type="button" class="scr-btn sbd-showbtn" title="Fill the big screen with the event background (B)"><i class="bi bi-display"></i> <span>Show on screen</span> <kbd>B</kbd></button>
        <label class="sbd-switch" title="Use the event background behind the lobby (share code screen)"><input type="checkbox" class="sbd-lobbysw"> Behind the lobby</label>
        <label class="sbd-switch" title="Show the share code on the background while it's on screen"><input type="checkbox" class="sbd-codesw"> Share code</label>
      </div>
      <div class="sbd-grid">
        <div class="sbd-seg" data-k="fit"><span>Picture</span><button type="button" data-v="cover">Fill</button><button type="button" data-v="contain">Fit</button></div>
        <div class="sbd-seg" data-k="motion"><span>Motion</span><button type="button" data-v="still">Still</button><button type="button" data-v="drift">Slow zoom</button></div>
        <label class="sbd-field"><span>Slideshow</span><select class="sbd-slides"><option value="0">Off</option><option value="8">Every 8 s</option><option value="15">Every 15 s</option><option value="30">Every 30 s</option><option value="60">Every minute</option></select></label>
        <label class="sbd-field"><span>Dim <b class="sbd-dimv"></b></span><input type="range" min="0" max="80" step="5" class="sbd-dim-in"></label>
        <label class="sbd-field sbd-wide"><span>Caption</span><input type="text" maxlength="140" class="sbd-cap" placeholder="e.g. Welcome to the Gambia Youth Summit · Lunch break"></label>
        <label class="sbd-field"><span>Countdown to</span><input type="time" class="sbd-cd"><button type="button" class="sbd-cd-x" title="No countdown">✕</button></label>
      </div>`;
    pb.appendChild(panel);
    panel.querySelector(".sbd-showbtn").addEventListener("click", toggleShow);
    panel.querySelector(".sbd-lobbysw").addEventListener("change", e => set({ lobby: e.target.checked }, true));
    panel.querySelector(".sbd-codesw").addEventListener("change", e => set({ code: e.target.checked }, true));
    panel.querySelectorAll(".sbd-seg").forEach(seg => seg.addEventListener("click", e => {
      const b = e.target.closest("button[data-v]"); if (b) set({ [seg.dataset.k]: b.dataset.v }, true);
    }));
    panel.querySelector(".sbd-slides").addEventListener("change", e => set({ slideshow: +e.target.value }, true));
    panel.querySelector(".sbd-dim-in").addEventListener("input", e => set({ dim: +e.target.value }));
    panel.querySelector(".sbd-cap").addEventListener("input", e => set({ caption: e.target.value }));
    panel.querySelector(".sbd-cd").addEventListener("change", e => set({ countdown: e.target.value || "" }, true));
    panel.querySelector(".sbd-cd-x").addEventListener("click", () => { panel.querySelector(".sbd-cd").value = ""; set({ countdown: "" }, true); });
    panel.querySelector(".sbd-strip").addEventListener("click", async e => {
      const del = e.target.closest(".sbd-del");
      if (del) {
        e.stopPropagation();
        try { adopt(await post(del.dataset.id + "/delete/", {})); } catch (er) { toast(er.message, true); }
        return;
      }
      const t = e.target.closest(".sbd-thumb[data-id]");
      if (t) { slideIdx = 0; set({ active: t.dataset.id }, true); }
    });
    // drag images anywhere onto the open panel
    const aside = $("#scr-panel");
    aside.addEventListener("dragover", e => { if ([...(e.dataTransfer.types || [])].includes("Files")) { e.preventDefault(); panel.classList.add("drop"); } });
    aside.addEventListener("dragleave", e => { if (!aside.contains(e.relatedTarget)) panel.classList.remove("drop"); });
    aside.addEventListener("drop", e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); panel.classList.remove("drop"); upload(e.dataTransfer.files); });
  }
  function renderPanel() {
    if (!panel) return;
    const imgs = (bd && bd.images) || [];
    panel.querySelector(".sbd-n").textContent = imgs.length ? `${imgs.length} image${imgs.length > 1 ? "s" : ""}` : "";
    panel.querySelector(".sbd-strip").innerHTML = imgs.map(i => `
      <div class="sbd-thumb${i.id === (bd && bd.active) ? " on" : ""}" data-id="${esc(i.id)}" title="${esc(i.name || "Background")}" style="background-image:url('${esc(i.url)}')">
        <button type="button" class="sbd-del" data-id="${esc(i.id)}" title="Remove">✕</button></div>`).join("") +
      `<label class="sbd-thumb sbd-add" title="Upload event backgrounds (or drag images here)"><i class="bi bi-cloud-arrow-up"></i><span>${imgs.length ? "Add" : "Upload event background"}</span>
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden></label>`;
    panel.querySelector(".sbd-add input").addEventListener("change", e => { upload(e.target.files); e.target.value = ""; });
    const on = !!(bd && bd.show && imgs.length);
    const btn = panel.querySelector(".sbd-showbtn");
    btn.classList.toggle("on", on); btn.disabled = !imgs.length;
    btn.querySelector("span").textContent = on ? "Showing — click to hide" : "Show on screen";
    panel.querySelector(".sbd-lobbysw").checked = !!(bd && bd.lobby);
    panel.querySelector(".sbd-codesw").checked = !!(bd && bd.code);
    panel.querySelectorAll(".sbd-seg").forEach(seg => seg.querySelectorAll("button").forEach(b => b.classList.toggle("on", !!bd && bd[seg.dataset.k] === b.dataset.v)));
    panel.querySelector(".sbd-slides").value = String((bd && bd.slideshow) || 0);
    const dim = panel.querySelector(".sbd-dim-in");
    if (document.activeElement !== dim) dim.value = (bd && bd.dim) || 0;
    panel.querySelector(".sbd-dimv").textContent = ((bd && bd.dim) || 0) + "%";
    const cap = panel.querySelector(".sbd-cap");
    if (document.activeElement !== cap) cap.value = (bd && bd.caption) || "";
    const cd = panel.querySelector(".sbd-cd");
    if (document.activeElement !== cd) cd.value = (bd && bd.countdown) || "";
    panel.querySelectorAll(".sbd-grid input, .sbd-grid select, .sbd-grid button").forEach(n => { n.disabled = !imgs.length; });
  }
  function toggleShow() {
    if (!bd || !(bd.images || []).length) { toast("Upload an event background first — open the panel (Q)", true); return; }
    set({ show: !bd.show }, true);
    toast(bd.show ? "📺 Event background on screen — press B to go back" : "Back to the show");
  }
  document.addEventListener("keydown", e => {
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key.toLowerCase() === "b" && !e.ctrlKey && !e.metaKey && !e.altKey && !$("#scr-dialogs").firstElementChild) { e.preventDefault(); toggleShow(); }
  });

  buildPanel();
  render();
})();
