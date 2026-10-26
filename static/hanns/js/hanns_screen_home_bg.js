/* ═══════════════════════════════════════════════════════════════════
   HANNS · BIG SCREENS (host dashboard) — event background per screen
   ───────────────────────────────────────────────────────────────────
   Each screen card gets an "Event background" button next to its name.
     • first click with nothing uploaded → opens the file chooser
     • otherwise it expands a panel: thumbnails (click = use it, ✕ = remove,
       drag images in to upload), Show on screen, Behind the lobby, Fill/Fit,
       Slow zoom, Slideshow, Dim, Caption, Countdown, Share code
     • the card's live monitor shows the background while it's on screen
   Same endpoints and state as the projector's own panel (screenart app),
   so the projector, this dashboard and any other open copy stay in step.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function csrf() {
    const i = document.querySelector("[name=csrfmiddlewaretoken]");
    if (i && i.value) return i.value;
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  document.querySelectorAll("[data-screen]").forEach(root => {
    const token = root.dataset.token;
    const base = `/screenart/s/${token}/`;
    const btn = root.querySelector("[data-bg-toggle]");
    const panel = root.querySelector("[data-bg-panel]");
    if (!btn || !panel) return;
    let state = {};
    try { state = JSON.parse(root.querySelector("[data-state]").textContent || "{}"); } catch (_) { /* ignore */ }
    let bd = state.backdrop || null;
    let open = false;
    try { open = localStorage.getItem("hanns-bg-open-" + token) === "1"; } catch (_) { /* ignore */ }

    /* ── server ── */
    async function post(path, body) {
      const r = await fetch(base + path, { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() }, body: JSON.stringify(body || {}) });
      let d = null; try { d = await r.json(); } catch (_) { /* html */ }
      if (r.status === 410) { location.reload(); return null; }
      if (!r.ok || !d || !d.ok) throw new Error((d && d.error) || "Something went wrong (" + r.status + ")");
      return d;
    }
    function adopt(d) { if (d && d.state) { state = d.state; bd = state.backdrop || null; render(); } }
    function note(msg, bad) {
      const n = panel.querySelector(".bs-bg-note");
      if (!n) return;
      n.textContent = msg; n.classList.toggle("bad", !!bad); n.hidden = false;
      clearTimeout(note.t); note.t = setTimeout(() => { n.hidden = true; }, 4500);
    }
    let pending = {}, timer = null;
    function set(patch, now) {
      bd = Object.assign({}, bd || {}, patch);
      Object.assign(pending, patch);
      render();
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const p = pending; pending = {};
        try { adopt(await post("settings/", p)); } catch (e) { note(e.message, true); }
      }, now ? 0 : 400);
    }
    function upload(files) {
      const list = [...files].filter(f => /^image\//.test(f.type));
      if (!list.length) { note("Choose image files (JPG, PNG, WebP or GIF).", true); return; }
      setOpen(true);
      const fd = new FormData();
      list.slice(0, 12).forEach(f => fd.append("file", f));
      const bar = panel.querySelector(".bs-bg-progress");
      bar.hidden = false; bar.firstElementChild.style.width = "0%";
      const x = new XMLHttpRequest();
      x.open("POST", base + "upload/");
      x.setRequestHeader("X-CSRFToken", csrf());
      x.withCredentials = true;
      x.upload.onprogress = e => { if (e.lengthComputable) bar.firstElementChild.style.width = Math.round(100 * e.loaded / e.total) + "%"; };
      x.onload = () => {
        bar.hidden = true;
        let d = null; try { d = JSON.parse(x.responseText); } catch (_) { /* ignore */ }
        if (x.status === 410) { location.reload(); return; }
        if (x.status >= 200 && x.status < 300 && d && d.ok) {
          adopt(d);
          note(`${d.added.length} background${d.added.length > 1 ? "s" : ""} uploaded` + (d.errors.length ? " · " + d.errors.join(" · ") : "") + ". Press “Show on screen” when you're ready.", !!d.errors.length);
        } else note((d && d.error) || "Upload failed.", true);
      };
      x.onerror = () => { bar.hidden = true; note("Upload failed — check the connection.", true); };
      x.send(fd);
    }

    /* ── panel ── */
    const picker = document.createElement("input");
    picker.type = "file"; picker.accept = "image/jpeg,image/png,image/webp,image/gif"; picker.multiple = true; picker.hidden = true;
    picker.addEventListener("change", () => { if (picker.files.length) upload(picker.files); picker.value = ""; });
    root.appendChild(picker);

    panel.innerHTML = `
      <div class="bs-bg-head">
        <div><b>Event background</b><span>Upload your event artwork and put it on the big screen — over the lobby or even over a deck.</span></div>
        <button type="button" class="kk-btn kk-btn-ghost bs-bg-close" title="Close"><i class="bi bi-chevron-up"></i></button>
      </div>
      <div class="bs-bg-strip" data-bg-strip></div>
      <div class="bs-bg-progress" hidden><i></i></div>
      <div class="bs-bg-note" hidden></div>
      <div class="bs-bg-main">
        <button type="button" class="bs-bg-show" data-bg-show><i class="bi bi-display"></i> <span>Show on screen</span></button>
        <label class="bs-bg-sw2"><input type="checkbox" data-bg-k="lobby"> Behind the lobby</label>
        <label class="bs-bg-sw2"><input type="checkbox" data-bg-k="code"> Share code on it</label>
      </div>
      <div class="bs-bg-grid">
        <div class="bs-bg-seg" data-bg-seg="fit"><span>Picture</span><button type="button" data-v="cover">Fill</button><button type="button" data-v="contain">Fit</button></div>
        <div class="bs-bg-seg" data-bg-seg="motion"><span>Motion</span><button type="button" data-v="still">Still</button><button type="button" data-v="drift">Slow zoom</button></div>
        <label class="bs-bg-f"><span>Slideshow</span><select data-bg-slides><option value="0">Off</option><option value="8">Every 8 s</option><option value="15">Every 15 s</option><option value="30">Every 30 s</option><option value="60">Every minute</option></select></label>
        <label class="bs-bg-f"><span>Dim <b data-bg-dimv></b></span><input type="range" min="0" max="80" step="5" data-bg-dim></label>
        <label class="bs-bg-f wide"><span>Caption</span><input type="text" maxlength="140" data-bg-cap placeholder="e.g. Welcome to the summit · Lunch break"></label>
        <label class="bs-bg-f"><span>Countdown to</span><input type="time" data-bg-cd><button type="button" class="bs-bg-cdx" title="No countdown">✕</button></label>
      </div>`;
    panel.querySelector(".bs-bg-close").addEventListener("click", () => setOpen(false));
    panel.querySelector("[data-bg-show]").addEventListener("click", () => {
      if (!bd || !(bd.images || []).length) { picker.click(); return; }
      set({ show: !bd.show }, true);
      note(bd.show ? "📺 The event background is on the big screen." : "Back to the show.");
    });
    panel.querySelectorAll("[data-bg-k]").forEach(i => i.addEventListener("change", () => set({ [i.dataset.bgK]: i.checked }, true)));
    panel.querySelectorAll("[data-bg-seg]").forEach(seg => seg.addEventListener("click", e => {
      const b = e.target.closest("button[data-v]"); if (b) set({ [seg.dataset.bgSeg]: b.dataset.v }, true);
    }));
    panel.querySelector("[data-bg-slides]").addEventListener("change", e => set({ slideshow: +e.target.value }, true));
    panel.querySelector("[data-bg-dim]").addEventListener("input", e => set({ dim: +e.target.value }));
    panel.querySelector("[data-bg-cap]").addEventListener("input", e => set({ caption: e.target.value }));
    panel.querySelector("[data-bg-cd]").addEventListener("change", e => set({ countdown: e.target.value || "" }, true));
    panel.querySelector(".bs-bg-cdx").addEventListener("click", () => { panel.querySelector("[data-bg-cd]").value = ""; set({ countdown: "" }, true); });
    panel.querySelector("[data-bg-strip]").addEventListener("click", async e => {
      const del = e.target.closest("[data-bg-del]");
      if (del) {
        e.stopPropagation();
        try { adopt(await post(del.dataset.bgDel + "/delete/", {})); } catch (er) { note(er.message, true); }
        return;
      }
      if (e.target.closest("[data-bg-add]")) { picker.click(); return; }
      const t = e.target.closest("[data-bg-id]");
      if (t) set({ active: t.dataset.bgId }, true);
    });
    // drag images onto the button or the open panel
    [btn, panel].forEach(zone => {
      zone.addEventListener("dragover", e => { if ([...(e.dataTransfer.types || [])].includes("Files")) { e.preventDefault(); zone.classList.add("drop"); } });
      zone.addEventListener("dragleave", () => zone.classList.remove("drop"));
      zone.addEventListener("drop", e => { zone.classList.remove("drop"); if (!e.dataTransfer.files.length) return; e.preventDefault(); upload(e.dataTransfer.files); });
    });

    function setOpen(v) {
      open = !!v;
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.classList.toggle("open", open);
      try { localStorage.setItem("hanns-bg-open-" + token, open ? "1" : "0"); } catch (_) { /* ignore */ }
    }
    btn.addEventListener("click", () => {
      const has = bd && (bd.images || []).length;
      if (!has && !open) { setOpen(true); picker.click(); return; }   // nothing yet: straight to the file chooser
      setOpen(!open);
    });

    /* ── render ── */
    function activeImage() {
      const imgs = (bd && bd.images) || [];
      return imgs.find(i => i.id === bd.active) || imgs[0] || null;
    }
    function renderButton() {
      const imgs = (bd && bd.images) || [], img = activeImage();
      const sw = btn.querySelector("[data-bg-swatch]");
      sw.style.backgroundImage = img ? `url("${img.url.replace(/"/g, "%22")}")` : "";
      sw.classList.toggle("has", !!img);
      btn.classList.toggle("live", !!(bd && bd.show && img));
      btn.querySelector("[data-bg-sub]").textContent = !imgs.length ? "Upload an image for the screen"
        : bd.show ? "● Showing on the big screen"
        : bd.lobby ? `Behind the lobby · ${imgs.length} image${imgs.length > 1 ? "s" : ""}`
        : `${imgs.length} image${imgs.length > 1 ? "s" : ""} ready`;
    }
    function renderPanel() {
      const imgs = (bd && bd.images) || [];
      panel.querySelector("[data-bg-strip]").innerHTML = imgs.map(i => `
        <div class="bs-bg-th${i.id === (bd && bd.active) ? " on" : ""}" data-bg-id="${esc(i.id)}" title="${esc(i.name || "Background")} — click to use it"
             style="background-image:url('${esc(i.url)}')"><button type="button" data-bg-del="${esc(i.id)}" title="Remove">✕</button></div>`).join("") +
        `<button type="button" class="bs-bg-th bs-bg-add" data-bg-add title="Upload images (or drag them here)"><i class="bi bi-cloud-arrow-up"></i><span>${imgs.length ? "Add more" : "Upload event background"}</span></button>`;
      const on = !!(bd && bd.show && imgs.length);
      const sb = panel.querySelector("[data-bg-show]");
      sb.classList.toggle("on", on);
      sb.querySelector("span").textContent = !imgs.length ? "Upload an image first" : on ? "Showing — click to hide" : "Show on screen";
      panel.querySelectorAll("[data-bg-k]").forEach(i => { i.checked = !!(bd && bd[i.dataset.bgK]); i.disabled = !imgs.length; });
      panel.querySelectorAll("[data-bg-seg]").forEach(seg => seg.querySelectorAll("button").forEach(b => {
        b.classList.toggle("on", !!bd && bd[seg.dataset.bgSeg] === b.dataset.v); b.disabled = !imgs.length; }));
      const sel = panel.querySelector("[data-bg-slides]"); sel.value = String((bd && bd.slideshow) || 0); sel.disabled = !imgs.length;
      const dim = panel.querySelector("[data-bg-dim]");
      if (document.activeElement !== dim) dim.value = (bd && bd.dim) || 0;
      dim.disabled = !imgs.length;
      panel.querySelector("[data-bg-dimv]").textContent = ((bd && bd.dim) || 0) + "%";
      const cap = panel.querySelector("[data-bg-cap]");
      if (document.activeElement !== cap) cap.value = (bd && bd.caption) || "";
      cap.disabled = !imgs.length;
      const cd = panel.querySelector("[data-bg-cd]");
      if (document.activeElement !== cd) cd.value = (bd && bd.countdown) || "";
      cd.disabled = !imgs.length;
    }
    // the card's live monitor shows what the room sees
    function renderMonitor() {
      const host = root.querySelector("[data-monitor-screen]");
      if (!host) return;
      let layer = host.querySelector(".bs-mon-bg");
      const img = activeImage();
      const showing = !!(bd && bd.show && img);
      const behind = !!(bd && bd.lobby && img && !state.current && !showing);
      if (!showing && !behind) { if (layer) layer.remove(); root.querySelector("[data-monitor]").classList.remove("bg-live"); return; }
      if (!layer) { layer = document.createElement("div"); layer.className = "bs-mon-bg"; host.appendChild(layer); }
      layer.style.backgroundImage = `url("${img.url.replace(/"/g, "%22")}")`;
      layer.style.backgroundSize = bd.fit === "contain" ? "contain" : "cover";
      layer.classList.toggle("behind", behind);
      layer.innerHTML = showing && bd.caption ? `<span>${esc(bd.caption)}</span>` : "";
      root.querySelector("[data-monitor]").classList.toggle("bg-live", showing);
      if (showing) {
        const k = root.querySelector("[data-monitor-k]");
        if (k) k.textContent = "Event background · on screen";
      }
    }
    function render() { renderButton(); renderPanel(); renderMonitor(); }

    root.addEventListener("bs:state", e => { state = e.detail || state; bd = state.backdrop || null; render(); });
    setOpen(open);
    render();
  });
})();
