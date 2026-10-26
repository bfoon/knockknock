/* Theme Studio · Chart style — Match theme / On a card (glass, dark, light) / Classic.
 * Saves instantly to livestyle:poll_charts, which also restyles any live session. */
(function () {
  "use strict";
  var studio = document.getElementById("theme-studio");
  if (!studio || !studio.dataset.chartUrl) return;
  var box = studio.querySelector(".p-cs"), prev = studio.querySelector(".p-sp");
  var status = document.getElementById("theme-status");
  var cur = { style: studio.dataset.chartStyle || "theme", panel: studio.dataset.chartPanel || "glass" };

  function csrf() {
    var i = document.querySelector("[name=csrfmiddlewaretoken]");
    if (i && i.value) return i.value;
    var m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  function say(text, kind) {
    if (!status) return;
    status.textContent = text;
    status.className = "p-save-state is-on" + (kind ? " is-" + kind : "");
    if (kind === "ok") setTimeout(function () { status.classList.remove("is-on"); }, 2000);
  }
  function paint() {
    box.querySelectorAll("[data-cs]").forEach(function (b) {
      var on = b.dataset.cs === cur.style;
      b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var panels = box.querySelector(".p-cs-panels");
    panels.hidden = cur.style !== "panel";
    panels.querySelectorAll("[data-cp]").forEach(function (b) { b.classList.toggle("is-on", b.dataset.cp === cur.panel); });
    if (prev) {
      prev.classList.remove("cs-theme", "cs-panel", "cs-classic", "cp-glass", "cp-dark", "cp-light");
      prev.classList.add("cs-" + cur.style);
      if (cur.style === "panel") prev.classList.add("cp-" + cur.panel);
      var bars = prev.querySelector(".p-sp-bars");
      if (bars) { bars.classList.remove("is-grow"); void bars.offsetWidth; bars.classList.add("is-grow"); }
    }
  }
  function save(patch) {
    var before = { style: cur.style, panel: cur.panel };
    Object.assign(cur, patch);
    paint();
    say("Saving…");
    fetch(studio.dataset.chartUrl, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRFToken": csrf() },
      body: JSON.stringify(patch),
    }).then(function (r) { return r.json().then(function (d) { return [r.ok, d]; }); }).then(function (res) {
      if (!res[0] || !res[1].ok) throw new Error(res[1].error || "Couldn't save");
      say("Chart style saved", "ok");
    }).catch(function (e) { cur = before; paint(); say(e.message || "Couldn't save", "err"); });
  }
  box.addEventListener("click", function (e) {
    var b = e.target.closest("[data-cs]");
    if (b && b.dataset.cs !== cur.style) { save({ style: b.dataset.cs }); return; }
    var p = e.target.closest("[data-cp]");
    if (p && p.dataset.cp !== cur.panel) save({ panel: p.dataset.cp });
  });
  paint();
})();
