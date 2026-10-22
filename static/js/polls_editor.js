/* Poll editor (templates/polls/edit.html).
 *
 * 1. DRAG & DROP REORDER — native, no library.
 *    The old version loaded SortableJS with `defer` but initialised it from
 *    an inline script that runs BEFORE deferred scripts execute, so
 *    window.Sortable was always undefined and dragging never worked.
 *    This one uses Pointer Events (mouse, pen and touch), lifts the row,
 *    opens a drop slot that the other rows slide around (FLIP animation),
 *    auto-scrolls near the window edges, Esc cancels, and every move gets an
 *    Undo toast. Alt+↑/↓ on a handle still reorders from the keyboard.
 *
 * 2. THEME STUDIO — the deck theme now actually saves.
 *    Click a theme: it saves instantly (no "Save settings" needed), the big
 *    live preview restyles with your first question, and any running
 *    session restyles on the projector and phones. Hover to try a theme
 *    without saving. Search, Dark/Light/Photo/Pattern filters, 🎲 Surprise me.
 *
 * 3. SLIDE THEMES — the swatch on each question row gives that one slide its
 *    own theme (or back to the deck theme). Applied live during the show.
 */
(function () {
  "use strict";

  var themesEl = document.getElementById("kk-themes-json");
  var THEMES = [];
  try { THEMES = JSON.parse((themesEl && themesEl.textContent) || "[]"); } catch (e) { THEMES = []; }
  var BY_ID = {};
  THEMES.forEach(function (t) { BY_ID[t.id] = t; });

  var tokenEl = document.querySelector("input[name=csrfmiddlewaretoken]");
  var CSRF = tokenEl ? tokenEl.value : "";

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRFToken": CSRF },
      body: JSON.stringify(body),
    });
  }
  function reduced() { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; }

  // ───────────────────────── toast ─────────────────────────
  var toastEl = document.createElement("div");
  toastEl.className = "p-toast";
  toastEl.setAttribute("role", "status");
  toastEl.setAttribute("aria-live", "polite");
  document.body.appendChild(toastEl);
  var toastTimer = null;
  function toast(html, opts) {
    opts = opts || {};
    toastEl.innerHTML = '<span class="p-toast-msg">' + html + "</span>" +
      (opts.action ? '<button type="button" class="p-toast-act">' + esc(opts.action) + "</button>" : "");
    toastEl.className = "p-toast is-on" + (opts.kind ? " is-" + opts.kind : "");
    var act = toastEl.querySelector(".p-toast-act");
    if (act && opts.onAction) act.addEventListener("click", function () { hideToast(); opts.onAction(); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, opts.ms || 3200);
  }
  function hideToast() { toastEl.classList.remove("is-on"); }

  // ═════════════════════════ 1. REORDER ═════════════════════════
  var list = document.getElementById("q-list");
  var statusEl = document.getElementById("reorder-status");
  var statusTimer = null;
  var saveSeq = 0;

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.add("is-on");
    statusEl.classList.toggle("is-ok", kind === "ok");
    statusEl.classList.toggle("is-bad", kind === "bad");
    clearTimeout(statusTimer);
    if (kind === "ok") statusTimer = setTimeout(function () { statusEl.classList.remove("is-on"); }, 1800);
  }

  function rows() { return list ? Array.prototype.slice.call(list.querySelectorAll(":scope > .p-q")) : []; }
  function order() { return rows().map(function (r) { return parseInt(r.dataset.qpk, 10); }).filter(function (n) { return !isNaN(n); }); }

  function reindex() {
    rows().forEach(function (row, i) {
      var n = row.querySelector(".p-q-num");
      if (n) n.textContent = i + 1;
      var del = row.querySelector(".p-q-tools [aria-label^='Delete question']");
      if (del) del.setAttribute("aria-label", "Delete question " + (i + 1));
    });
  }

  function persist() {
    if (!list) return;
    var seq = ++saveSeq;
    setStatus("Saving…");
    return postJSON(list.dataset.reorderUrl, { order: order() }).then(function (r) {
      if (r.status === 409) throw new Error("This list is out of date — reload the page.");
      if (!r.ok) throw new Error("Order not saved. Try again.");
      return r.json();
    }).then(function () {
      if (seq === saveSeq) setStatus("Order saved", "ok");
    }).catch(function (e) {
      if (seq === saveSeq) setStatus(e.message, "bad");
    });
  }

  function applyOrder(ids) {
    var byId = {};
    rows().forEach(function (r) { byId[r.dataset.qpk] = r; });
    flip(function () { ids.forEach(function (id) { if (byId[id]) list.appendChild(byId[id]); }); });
    reindex();
  }

  // FLIP: animate rows from where they were to where a DOM change put them.
  function flip(mutate, skip) {
    var before = new Map();
    rows().forEach(function (r) { if (r !== skip) before.set(r, r.getBoundingClientRect().top); });
    var ph = list.querySelector(".p-q-slot");
    mutate();
    if (reduced()) return;
    before.forEach(function (top, r) {
      var dy = top - r.getBoundingClientRect().top;
      if (!dy) return;
      r.style.transition = "none";
      r.style.transform = "translateY(" + dy + "px)";
      requestAnimationFrame(function () {
        r.style.transition = "transform .2s cubic-bezier(.2,.8,.3,1)";
        r.style.transform = "";
      });
    });
    void ph;
  }

  function moved(row, from, to) {
    if (from === to) return;
    var name = (row.querySelector(".p-q-text") || {}).textContent || "Question";
    var prev = from.slice();
    row.classList.remove("p-moved"); void row.offsetWidth; row.classList.add("p-moved");
    reindex();
    persist();
    var pos = order().indexOf(parseInt(row.dataset.qpk, 10)) + 1;
    toast("Moved “" + esc(name.trim().slice(0, 38)) + (name.trim().length > 38 ? "…" : "") + "” to #" + pos, {
      action: "Undo",
      onAction: function () { applyOrder(prev); persist(); toast("Order restored"); },
    });
  }

  if (list) {
    var drag = null;

    list.addEventListener("pointerdown", function (e) {
      var grip = e.target.closest(".p-q-grip");
      if (!grip || (e.pointerType === "mouse" && e.button !== 0)) return;
      var row = grip.closest(".p-q");
      if (!row) return;
      e.preventDefault();
      var rect = row.getBoundingClientRect();
      drag = {
        row: row, grip: grip, id: e.pointerId,
        startY: e.clientY, offsetY: e.clientY - rect.top,
        rect: rect, lifted: false, from: order(), lastY: e.clientY, raf: null,
      };
      try { grip.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
    });

    function lift() {
      var d = drag, r = d.rect;
      d.lifted = true;
      d.slot = document.createElement("div");
      d.slot.className = "p-q-slot";
      d.slot.style.height = r.height + "px";
      list.insertBefore(d.slot, d.row);
      d.row.classList.add("p-lifted");
      d.row.style.width = r.width + "px";
      d.row.style.left = r.left + "px";
      d.row.style.top = r.top + "px";
      document.body.classList.add("p-dragging-on");
      autoScroll();
    }

    function place(y) {
      var d = drag;
      d.row.style.top = (y - d.offsetY) + "px";
      var others = rows().filter(function (r) { return r !== d.row; });
      var before = null;
      for (var i = 0; i < others.length; i++) {
        var b = others[i].getBoundingClientRect();
        if (y < b.top + b.height / 2) { before = others[i]; break; }
      }
      var cur = d.slot.nextElementSibling;
      while (cur === d.row) cur = cur.nextElementSibling;
      if (cur === before) return;
      flip(function () {
        if (before) list.insertBefore(d.slot, before); else list.appendChild(d.slot);
      }, d.row);
    }

    function autoScroll() {
      if (!drag || !drag.lifted) return;
      var y = drag.lastY, edge = 90, speed = 0;
      if (y < edge) speed = -Math.ceil((edge - y) / 6);
      else if (y > innerHeight - edge) speed = Math.ceil((y - (innerHeight - edge)) / 6);
      if (speed) { window.scrollBy(0, speed); place(y); }
      drag.raf = requestAnimationFrame(autoScroll);
    }

    function finish(cancel) {
      var d = drag;
      drag = null;
      if (!d) return;
      cancelAnimationFrame(d.raf);
      try { d.grip.releasePointerCapture(d.id); } catch (err) { /* ignore */ }
      if (!d.lifted) return;
      document.body.classList.remove("p-dragging-on");
      if (cancel) {
        // Put the slot back where the row started.
        var idx = d.from.indexOf(parseInt(d.row.dataset.qpk, 10));
        var others = rows().filter(function (r) { return r !== d.row; });
        flip(function () {
          if (others[idx]) list.insertBefore(d.slot, others[idx]); else list.appendChild(d.slot);
        }, d.row);
      }
      var target = d.slot.getBoundingClientRect();
      var done = function () {
        d.row.classList.remove("p-lifted", "p-landing");
        d.row.style.cssText = "";
        list.insertBefore(d.row, d.slot);
        d.slot.remove();
        if (!cancel) moved(d.row, d.from, order());
        d.grip.focus({ preventScroll: true });
      };
      if (reduced()) { done(); return; }
      d.row.classList.add("p-landing");
      d.row.style.top = target.top + "px";
      setTimeout(done, 190);
    }

    list.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag.lastY = e.clientY;
      if (!drag.lifted) {
        if (Math.abs(e.clientY - drag.startY) < 4) return;
        lift();
      }
      place(e.clientY);
    });
    list.addEventListener("pointerup", function (e) { if (drag && e.pointerId === drag.id) finish(false); });
    list.addEventListener("pointercancel", function (e) { if (drag && e.pointerId === drag.id) finish(true); });
    document.addEventListener("keydown", function (e) { if (drag && e.key === "Escape") finish(true); });

    // Keyboard reordering — a drag handle is unusable without a pointer.
    list.addEventListener("keydown", function (e) {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      var grip = e.target.closest(".p-q-grip");
      if (!grip) return;
      e.preventDefault();
      var row = grip.closest(".p-q");
      var sib = e.key === "ArrowUp" ? row.previousElementSibling : row.nextElementSibling;
      if (!sib || !sib.classList.contains("p-q")) return;
      var from = order();
      flip(function () { if (e.key === "ArrowUp") list.insertBefore(row, sib); else list.insertBefore(sib, row); });
      grip.focus();
      moved(row, from, order());
    });
  }

  // ═════════════════════════ 2. THEME STUDIO ═════════════════════════
  var studio = document.getElementById("theme-studio");
  var hiddenInput = document.getElementById("template-id-input");
  var deckId = hiddenInput && BY_ID[hiddenInput.value] ? hiddenInput.value : (THEMES[0] && THEMES[0].id);

  function paintSwatch(el, t) {
    el.style.background = t ? (t.bg_css || t.bg) : "";
    var ov = el.querySelector(".ov");
    if (ov) ov.style.backgroundImage = t && t.overlay ? t.overlay : "none";
  }

  if (studio && THEMES.length) {
    var saveUrl = studio.dataset.saveUrl;
    var themeStatus = document.getElementById("theme-status");
    var prev = studio.querySelector(".p-sp");
    var grid = studio.querySelector(".p-st-grid");
    var filter = "all", query = "";

    grid.innerHTML = THEMES.map(function (t) {
      return '<button type="button" class="p-st-tile" data-id="' + esc(t.id) + '" aria-label="' + esc(t.name) + ' theme" title="' + esc(t.name) + '">' +
        '<span class="p-st-sw"><span class="ov"></span>' +
        '<span class="p-st-bars"><i style="height:40%;background:' + esc(t.accent) + '"></i><i style="height:85%;background:' + esc(t.accent2) + '"></i><i style="height:60%;background:' + esc(t.accent) + '"></i></span></span>' +
        '<span class="p-st-name">' + esc(t.name) + '<small>' + esc(t.tone) + (t.kind === "photo" ? " · photo" : "") + "</small></span></button>";
    }).join("");
    grid.querySelectorAll(".p-st-tile").forEach(function (b) { paintSwatch(b.querySelector(".p-st-sw"), BY_ID[b.dataset.id]); });

    function preview(id) {
      var t = BY_ID[id];
      if (!t) return;
      var bg = prev.querySelector(".p-sp-bg"), ov = prev.querySelector(".p-sp-ov");
      bg.style.background = t.bg_css || t.bg;
      ov.style.backgroundImage = t.overlay || "none";
      prev.style.color = t.fg;
      prev.style.setProperty("--sp-a", t.accent);
      prev.style.setProperty("--sp-b", t.accent2);
      prev.style.fontFamily = "'" + (t.font || "Clash Display") + "', 'Clash Display', system-ui, sans-serif";
      prev.querySelector(".p-sp-name").textContent = t.name + (id === deckId ? "" : " · preview");
      prev.classList.toggle("is-trying", id !== deckId);
      var bars = prev.querySelector(".p-sp-bars");
      bars.classList.remove("is-grow"); void bars.offsetWidth; bars.classList.add("is-grow");
    }

    function mark() {
      grid.querySelectorAll(".p-st-tile").forEach(function (b) {
        var on = b.dataset.id === deckId;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }

    function setThemeStatus(text, kind) {
      if (!themeStatus) return;
      themeStatus.textContent = text;
      themeStatus.className = "p-save-state is-on" + (kind ? " is-" + kind : "");
      if (kind === "ok") setTimeout(function () { themeStatus.classList.remove("is-on"); }, 2000);
    }

    function choose(id) {
      if (!BY_ID[id] || id === deckId) return;
      var before = deckId;
      deckId = id;
      if (hiddenInput) hiddenInput.value = id;
      mark();
      preview(id);
      paintInheritSwatches();
      setThemeStatus("Saving…");
      postJSON(saveUrl, { template_id: id }).then(function (r) {
        if (!r.ok) throw new Error();
        setThemeStatus("Saved", "ok");
        toast("🎨 Theme set to <b>" + esc(BY_ID[id].name) + "</b> — live screens update instantly");
      }).catch(function () {
        deckId = before;
        if (hiddenInput) hiddenInput.value = before;
        mark(); preview(before); paintInheritSwatches();
        setThemeStatus("Not saved — try again", "bad");
      });
    }

    grid.addEventListener("click", function (e) {
      var b = e.target.closest(".p-st-tile");
      if (b) choose(b.dataset.id);
    });
    // Hover to try a theme on the preview; leaving the grid snaps back.
    var fine = window.matchMedia && matchMedia("(hover: hover)").matches;
    if (fine) {
      grid.addEventListener("pointerover", function (e) {
        var b = e.target.closest(".p-st-tile");
        if (b) preview(b.dataset.id);
      });
      grid.addEventListener("pointerleave", function () { preview(deckId); });
    }
    studio.querySelector(".p-st-search").addEventListener("input", function (e) { query = e.target.value.trim().toLowerCase(); applyFilter(); });
    studio.querySelectorAll(".p-st-chip").forEach(function (c) {
      c.addEventListener("click", function () {
        filter = c.dataset.f;
        studio.querySelectorAll(".p-st-chip").forEach(function (x) { x.classList.toggle("is-on", x === c); x.setAttribute("aria-pressed", x === c ? "true" : "false"); });
        applyFilter();
      });
    });
    studio.querySelector(".p-st-dice").addEventListener("click", function () {
      var pool = THEMES.filter(function (t) { return t.id !== deckId; });
      var pickT = pool[Math.floor(Math.random() * pool.length)];
      choose(pickT.id);
      var tile = grid.querySelector('[data-id="' + pickT.id + '"]');
      if (tile) tile.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    });

    function applyFilter() {
      var shown = 0;
      grid.querySelectorAll(".p-st-tile").forEach(function (b) {
        var t = BY_ID[b.dataset.id];
        var ok = (filter === "all" || t.tone === filter || t.kind === filter) && (!query || t.name.toLowerCase().indexOf(query) >= 0);
        b.hidden = !ok;
        if (ok) shown++;
      });
      studio.querySelector(".p-st-empty").hidden = shown > 0;
    }

    mark();
    preview(deckId);
    var sel = grid.querySelector(".p-st-tile.is-on");
    if (sel) grid.scrollTop = Math.max(0, sel.offsetTop - grid.clientHeight / 2 + sel.offsetHeight / 2);
  }

  // ═════════════════════════ 3. SLIDE THEMES ═════════════════════════
  function paintInheritSwatches() {
    document.querySelectorAll(".p-q-theme").forEach(function (b) {
      var own = BY_ID[b.dataset.theme];
      var sw = b.querySelector(".p-swatch");
      b.classList.toggle("is-own", !!own);
      paintSwatch(sw, own || null);
      var label = own ? "Slide theme: " + own.name + " (click to change)" : "Uses the deck theme" + (BY_ID[deckId] ? " (" + BY_ID[deckId].name + ")" : "") + " — click to give this slide its own";
      b.title = label;
      b.setAttribute("aria-label", label);
    });
  }

  var pop = null, popBtn = null;
  function openPop(btn) {
    if (!pop) {
      pop = document.createElement("div");
      pop.className = "p-pop";
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-label", "Slide theme");
      pop.innerHTML = '<div class="p-pop-head">Slide theme</div>' +
        '<button type="button" class="p-pop-inherit" data-id="">↺ Use the deck theme</button>' +
        '<div class="p-pop-grid">' + THEMES.map(function (t) {
          return '<button type="button" class="p-pop-tile" data-id="' + esc(t.id) + '" title="' + esc(t.name) + '" aria-label="' + esc(t.name) + '"><span class="p-pop-sw"><span class="ov"></span></span><span>' + esc(t.name) + "</span></button>";
        }).join("") + "</div>";
      document.body.appendChild(pop);
      pop.querySelectorAll(".p-pop-tile").forEach(function (b) { paintSwatch(b.querySelector(".p-pop-sw"), BY_ID[b.dataset.id]); });
      pop.addEventListener("click", function (e) {
        var b = e.target.closest("[data-id]");
        if (!b || !popBtn) return;
        setSlideTheme(popBtn, b.dataset.id);
        closePop();
      });
    }
    popBtn = btn;
    pop.querySelectorAll("[data-id]").forEach(function (b) { b.classList.toggle("is-on", b.dataset.id === (btn.dataset.theme || "")); });
    pop.classList.add("is-open");
    placePop();
    var on = pop.querySelector(".is-on");
    if (on) on.focus({ preventScroll: true });
  }
  function placePop() {
    if (!pop || !popBtn) return;
    var r = popBtn.getBoundingClientRect();
    // Button scrolled out of view: nothing to anchor to any more.
    if (r.bottom < 0 || r.top > innerHeight) { closePop(); return; }
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var left = Math.min(innerWidth - w - 10, Math.max(10, r.right - w));
    var top = r.bottom + 8 + h > innerHeight ? r.top - h - 8 : r.bottom + 8;
    pop.style.left = left + "px";
    pop.style.top = Math.max(10, Math.min(innerHeight - h - 10, top)) + "px";
  }
  function closePop() { if (pop) pop.classList.remove("is-open"); popBtn = null; }

  function setSlideTheme(btn, id) {
    var before = btn.dataset.theme || "";
    btn.dataset.theme = id;
    paintInheritSwatches();
    postJSON(btn.dataset.url, { template_id: id }).then(function (r) {
      if (!r.ok) throw new Error();
      toast(id ? "This slide now uses <b>" + esc(BY_ID[id].name) + "</b>" : "This slide follows the deck theme again");
    }).catch(function () {
      btn.dataset.theme = before;
      paintInheritSwatches();
      toast("Slide theme not saved — try again", { kind: "bad" });
    });
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest(".p-q-theme");
    if (b) { e.preventDefault(); popBtn === b ? closePop() : openPop(b); return; }
    if (pop && pop.classList.contains("is-open") && !pop.contains(e.target)) closePop();
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePop(); });
  // Follow the swatch while the page scrolls instead of vanishing.
  window.addEventListener("scroll", placePop, { passive: true });
  window.addEventListener("resize", placePop);
  paintInheritSwatches();

  // ═════════════════════════ misc (kept from the old inline script) ═════════════════════════
  document.querySelectorAll("[data-logo-probe]").forEach(function (img) {
    function flag() {
      var box = img.closest(".p-logo");
      if (box) box.style.display = "none";
      document.querySelectorAll("[data-logo-error]").forEach(function (el) { el.hidden = false; });
    }
    if (img.complete && img.naturalWidth === 0) flag();
    img.addEventListener("error", flag);
  });
})();
