/* Visual background picker.
   Builds pattern swatches from window.KKBackgrounds, renders thumbnails for
   florals/plain/custom, wires clicks to the hidden form inputs
   (#id_background_mode, #id_background_pattern), and reflects the current
   selection. Depends on backgrounds.js and floral.js being loaded first. */
(function () {
  function init() {
    var root = document.querySelector(".kk-bgpick");
    if (!root || !window.KKBackgrounds) return;

    var modeInput = document.getElementById("id_background_mode");
    var patInput = document.getElementById("id_background_pattern");
    var slots = document.getElementById("kkBgPatternSlots");
    var grid = document.getElementById("kkBgGrid");
    var THUMB_W = 120, THUMB_H = 84;

    // 1) Build the pattern swatches from the catalogue, grouped by family.
    var pats = window.KKBackgrounds.patterns;
    var html = "";
    Object.keys(pats).forEach(function (id) {
      var p = pats[id];
      html +=
        '<button type="button" class="kk-bg-swatch" data-mode="pattern" ' +
        'data-pattern="' + id + '" title="' + p.name + '">' +
        '<span class="kk-bg-thumb">' +
        window.KKBackgrounds.render(id, THUMB_W, THUMB_H) +
        "</span>" +
        '<span class="kk-bg-name">' + p.name + "</span></button>";
    });
    if (slots) slots.insertAdjacentHTML("beforeend", html);

    // 2) Paint the floral thumbnail using the active template palette.
    function paintFloralThumb() {
      var sw = grid.querySelector('[data-mode="floral"] [data-thumb="floral"]');
      var btn = grid.querySelector('[data-mode="floral"]');
      if (!sw || !btn) return;
      var pal = btn.getAttribute("data-palette");
      sw.innerHTML = "";
      var holder = document.createElement("div");
      holder.style.cssText = "position:absolute;inset:0";
      holder.setAttribute("data-kk-floral", "");
      holder.setAttribute("data-palette", pal);
      sw.appendChild(holder);
      if (window.kkPaintFloral) window.kkPaintFloral();
    }

    // 3) Plain-paper thumbnail = template paper colour.
    function paintSolidThumb() {
      var sw = grid.querySelector('[data-thumb="solid"]');
      var btn = grid.querySelector('[data-mode="floral"]');
      if (!sw || !btn) return;
      try {
        var pal = JSON.parse(btn.getAttribute("data-palette"));
        sw.style.background = pal.paper || "#f5f1ea";
      } catch (e) { sw.style.background = "#f5f1ea"; }
    }

    function reflect() {
      var mode = modeInput.value || "floral";
      var pat = patInput.value || "";
      var btns = grid.querySelectorAll(".kk-bg-swatch");
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        var on = b.getAttribute("data-mode") === mode &&
          (mode !== "pattern" || b.getAttribute("data-pattern") === pat);
        b.classList.toggle("is-selected", on);
      }
    }

    function select(mode, pattern) {
      modeInput.value = mode;
      patInput.value = mode === "pattern" ? (pattern || "") : "";
      reflect();
      // Let the page preview (create.js) update the big preview if present.
      if (window.kkBgChanged) window.kkBgChanged(mode, pattern);
    }

    grid.addEventListener("click", function (e) {
      var btn = e.target.closest(".kk-bg-swatch");
      if (!btn) return;
      var mode = btn.getAttribute("data-mode");
      // For the custom <label>, let the file dialog open; selection happens
      // on file change below. Still mark it selected immediately.
      if (mode === "custom") { select("custom", ""); return; }
      e.preventDefault();
      select(mode, btn.getAttribute("data-pattern"));
    });

    // When a custom file is chosen, preview it in the swatch.
    var fileInput = root.querySelector('input[type="file"]');
    if (fileInput) {
      fileInput.addEventListener("change", function () {
        select("custom", "");
        var f = fileInput.files && fileInput.files[0];
        if (!f) return;
        var thumb = grid.querySelector('[data-thumb="custom"]');
        var url = URL.createObjectURL(f);
        if (thumb) thumb.innerHTML = '<img src="' + url + '" alt="">';
        if (window.kkBgChanged) window.kkBgChanged("custom", "", url);
      });
    }

    // Initial paint + reflect current selection (manage page preselects).
    paintFloralThumb();
    paintSolidThumb();
    // Default the hidden inputs from data-current-* if empty.
    if (!modeInput.value) modeInput.value = root.getAttribute("data-current-mode") || "floral";
    if (!patInput.value) patInput.value = root.getAttribute("data-current-pattern") || "";
    reflect();

    // Re-theme floral + plain swatches when the template select changes.
    var tplSel = document.getElementById("id_template");
    if (tplSel && typeof TEMPLATES !== "undefined") {
      tplSel.addEventListener("change", function () {
        var t = TEMPLATES[tplSel.value];
        var btn = grid.querySelector('[data-mode="floral"]');
        if (t && t.floral && btn) {
          btn.setAttribute("data-palette", JSON.stringify(t.floral));
          // wipe the painted flag so floral.js repaints
          var holder = btn.querySelector("[data-kk-floral]");
          if (holder) { holder.removeAttribute("data-kk-floral-painted"); holder.innerHTML = ""; holder.remove(); }
          paintFloralThumb();
          paintSolidThumb();
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
