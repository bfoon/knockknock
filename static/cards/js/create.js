/* Create-form preview. Shows a big preview that reflects the chosen template
   (floral palette, handwriting font, name) and the chosen background. The
   background picker (picker.js) calls window.kkBgChanged when the selection
   changes; the template <select> retunes the floral/plain options. */
(function () {
  var tplSel = document.getElementById("id_template");
  var prev = document.getElementById("tplPreview");
  if (!prev) return;

  var state = { mode: "floral", pattern: "", customUrl: "" };

  function baseStyle(t) {
    prev.style.borderRadius = "16px";
    prev.style.overflow = "hidden";
    prev.style.position = "relative";
    prev.style.minHeight = "170px";
    prev.style.display = "flex";
    prev.style.flexDirection = "column";
    prev.style.alignItems = "center";
    prev.style.justifyContent = "center";
    prev.style.fontFamily = t ? t.font : "cursive";
    prev.style.color = t ? t.ink : "#333";
  }

  function label(t, sub) {
    return '<div style="position:relative;z-index:2;text-align:center;' +
      'text-shadow:0 1px 8px rgba(255,255,255,.7)">' +
      '<div style="font-size:32px">' + (t ? t.motif : "🎉") + "</div>" +
      '<div style="font-size:28px;margin-top:2px">' + (t ? t.name : "") + "</div>" +
      '<div style="font-size:12px;opacity:.7;font-family:sans-serif;margin-top:4px">' +
      sub + "</div></div>";
  }

  function render() {
    var t = (tplSel && typeof TEMPLATES !== "undefined") ? TEMPLATES[tplSel.value] : null;
    var pal = t ? t.floral : null;
    baseStyle(t);

    if (state.mode === "pattern" && window.KKBackgrounds && state.pattern) {
      var p = window.KKBackgrounds.patterns[state.pattern];
      prev.style.background = p ? p.bg : "#fff";
      prev.innerHTML =
        '<div style="position:absolute;inset:0;z-index:0">' +
        window.KKBackgrounds.render(state.pattern, 560, 200) + "</div>" +
        label(t, p ? p.name : "Pattern");
    } else if (state.mode === "custom" && state.customUrl) {
      prev.style.background = "#222";
      prev.innerHTML =
        '<div style="position:absolute;inset:0;z-index:0;background:url(\'' +
        state.customUrl + "') center/cover\"></div>" + label(t, "Your image");
    } else if (state.mode === "solid") {
      prev.style.background = pal ? pal.paper : "#f5f1ea";
      prev.innerHTML = label(t, "Plain paper");
    } else {
      // floral
      prev.style.background = pal ? pal.paper : "#f5f1ea";
      prev.innerHTML =
        '<div data-kk-floral data-palette=\'' + JSON.stringify(pal || {}) +
        '\' style="position:absolute;inset:0;z-index:0"></div>' + label(t, "Watercolour florals");
      if (window.kkPaintFloral) window.kkPaintFloral();
    }
  }

  // Called by picker.js whenever the background selection changes.
  window.kkBgChanged = function (mode, pattern, customUrl) {
    state.mode = mode || "floral";
    state.pattern = pattern || "";
    if (customUrl) state.customUrl = customUrl;
    render();
  };

  if (tplSel) tplSel.addEventListener("change", render);
  render();
})();
