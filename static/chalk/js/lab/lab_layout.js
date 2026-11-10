/* Chalk Circuit Lab — layout.
 *
 * Three ways to look at the lab, and four places for the program panel:
 *
 *   Design   the bench, with the program panel tucked away
 *   Split    bench and program together (the default)
 *   Code     the program panel fills the screen; pressing Run brings the
 *            bench back, because that is when you want to see it
 *
 *   bottom | left | right | float — the program panel's home. Floating
 *   detaches it into a window you can drag and resize over the bench.
 *
 * And full screen: the bench alone, edge to edge, for a projector, with a
 * small bar for power and run and a caption showing the line that's
 * running. Every choice is remembered in this browser.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var KEY = "chalklab.layout";

  function $(id) { return document.getElementById(id); }

  function Layout(app) {
    this.app = app;
    this.body = document.body;
    this.dock = $("lab-dock");
    this.main = document.querySelector(".lab-main");
    this.wrap = document.querySelector(".bench-wrap");
    this.st = { view: "split", place: "bottom", h: 0.34, w: 460, fx: null, fy: null, fw: 640, fh: 380, side: true };
    try { Object.assign(this.st, JSON.parse(root.localStorage.getItem(KEY) || "{}")); } catch (e) {}
    this.build();
    this.apply();
  }
  L.Layout = Layout;

  Layout.prototype.save = function () { try { root.localStorage.setItem(KEY, JSON.stringify(this.st)); } catch (e) {} };

  Layout.prototype.build = function () {
    var self = this;
    /* view switch in the top bar */
    var views = $("lab-view");
    if (views) views.querySelectorAll("button").forEach(function (b) {
      b.addEventListener("click", function () { self.setView(b.getAttribute("data-view")); });
    });
    /* placement buttons in the program panel's bar */
    var bar = this.dock.querySelector(".dock-bar");
    var place = document.createElement("div");
    place.className = "dock-place";
    place.setAttribute("role", "group");
    place.setAttribute("aria-label", "Where the program panel goes");
    place.innerHTML =
      '<button type="button" data-place="left" title="Program panel on the left" aria-label="Program panel on the left">' + icon("left") + '</button>' +
      '<button type="button" data-place="bottom" title="Program panel at the bottom" aria-label="Program panel at the bottom">' + icon("bottom") + '</button>' +
      '<button type="button" data-place="right" title="Program panel on the right" aria-label="Program panel on the right">' + icon("right") + '</button>' +
      '<button type="button" data-place="float" title="Detach into a floating window" aria-label="Detach into a floating window">' + icon("float") + '</button>';
    bar.insertBefore(place, bar.querySelector(".dock-toggle"));
    place.querySelectorAll("[data-place]").forEach(function (b) {
      b.addEventListener("click", function () { self.setPlace(b.getAttribute("data-place")); });
    });
    /* the edge you drag to resize it */
    var grip = document.createElement("div");
    grip.className = "dock-grip";
    grip.setAttribute("aria-hidden", "true");
    this.dock.appendChild(grip);
    grip.addEventListener("pointerdown", function (e) { self.resizeStart(e); });
    /* in a floating window, the bar is the handle */
    bar.addEventListener("pointerdown", function (e) {
      if (self.st.place !== "float" || e.target.closest("button,select,input,[role=tab]")) return;
      self.dragStart(e);
    });
    /* the side panel can be folded away for room */
    var fold = document.createElement("button");
    fold.type = "button"; fold.className = "side-fold"; fold.id = "lab-side-fold";
    fold.setAttribute("aria-label", "Hide the side panel"); fold.title = "Hide or show the side panel";
    fold.textContent = "»";
    var tabs = $("lab-side").querySelector(".tabs");
    tabs.appendChild(fold);
    fold.addEventListener("click", function () { self.st.side = !self.st.side; self.apply(); self.save(); });
    var unfold = document.createElement("button");
    unfold.type = "button"; unfold.className = "side-unfold"; unfold.textContent = "«";
    unfold.setAttribute("aria-label", "Show the side panel"); unfold.title = "Show the side panel";
    this.wrap.appendChild(unfold);
    unfold.addEventListener("click", function () { self.st.side = true; self.apply(); self.save(); });
    /* full screen */
    var fs = $("lab-fs");
    if (fs) fs.addEventListener("click", function () { self.fullscreen(); });
    document.addEventListener("fullscreenchange", function () { self.fsChanged(); });
    document.addEventListener("webkitfullscreenchange", function () { self.fsChanged(); });
    var fsBar = document.createElement("div");
    fsBar.className = "fs-bar";
    fsBar.innerHTML = '<button type="button" data-fs="power" class="fs-power"><i aria-hidden="true"></i><span>Power</span></button>' +
      '<button type="button" data-fs="run">Run program</button>' +
      '<button type="button" data-fs="exit" title="Leave full screen (Esc)">Exit full screen</button>';
    this.wrap.appendChild(fsBar);
    fsBar.querySelector('[data-fs="power"]').addEventListener("click", function () { self.app.power(!self.app.running); });
    fsBar.querySelector('[data-fs="run"]').addEventListener("click", function () { self.app.runProgram(); });
    fsBar.querySelector('[data-fs="exit"]').addEventListener("click", function () { self.fullscreen(false); });
    this.caption = document.createElement("p");
    this.caption.className = "fs-caption";
    this.caption.setAttribute("aria-live", "polite");
    this.wrap.appendChild(this.caption);
    root.addEventListener("resize", function () { if (self.st.place === "float") self.clampFloat(); });
  };

  function icon(kind) {
    var r = { left: '<rect x="1" y="1" width="6" height="14" rx="1.5"/>', right: '<rect x="11" y="1" width="6" height="14" rx="1.5"/>',
              bottom: '<rect x="1" y="9" width="16" height="6" rx="1.5"/>', float: '<rect x="6" y="5" width="10" height="8" rx="1.5"/>' }[kind];
    return '<svg viewBox="0 0 18 16" width="18" height="16" aria-hidden="true"><rect x=".75" y=".75" width="16.5" height="14.5" rx="2" fill="none" stroke="currentColor" stroke-opacity=".5" stroke-width="1.2"/><g fill="currentColor">' + r + '</g></svg>';
  }

  Layout.prototype.setView = function (v) {
    if (v === this.st.view) return;
    this.st.view = v;
    this.apply(); this.save();
  };
  Layout.prototype.setPlace = function (p) {
    this.st.place = p;
    if (this.st.view === "design") this.st.view = "split";
    this.apply(); this.save();
  };

  /* Put the program panel where it belongs and size everything around it. */
  Layout.prototype.apply = function () {
    var st = this.st, b = this.body, dock = this.dock;
    var view = st.view, place = st.place;
    if (root.matchMedia && root.matchMedia("(max-width: 860px)").matches && (place === "left" || place === "right")) place = "bottom";
    ["view-design", "view-split", "view-code", "dock-left", "dock-right", "dock-bottom", "dock-float", "side-folded"].forEach(function (c) { b.classList.remove(c); });
    b.classList.add("view-" + view);
    var effective = view === "code" ? "bottom" : place;
    b.classList.add("dock-" + effective);
    if (!st.side) b.classList.add("side-folded");
    /* left and right live inside the main grid; bottom and float outside */
    if (effective === "left") this.main.insertBefore(dock, this.main.firstChild);
    else if (effective === "right") this.main.appendChild(dock);
    else if (dock.parentNode !== b) b.insertBefore(dock, this.main.nextSibling);
    dock.classList.toggle("closed", view === "design");
    var tog = $("dock-toggle");
    if (tog) { tog.setAttribute("aria-expanded", view === "design" ? "false" : "true"); tog.textContent = view === "design" ? "▴" : "▾"; }
    b.style.setProperty("--dock-h", Math.round(L.clamp(st.h, 0.18, 0.75) * 100) + "vh");
    b.style.setProperty("--dock-w", Math.round(L.clamp(st.w, 300, Math.max(320, root.innerWidth * 0.6))) + "px");
    if (effective === "float") this.clampFloat(); else { dock.style.left = dock.style.top = dock.style.width = dock.style.height = ""; }
    var views = $("lab-view");
    if (views) views.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x.getAttribute("data-view") === view ? "true" : "false"); });
    dock.querySelectorAll("[data-place]").forEach(function (x) { x.setAttribute("aria-pressed", x.getAttribute("data-place") === place ? "true" : "false"); });
    var fold = $("lab-side-fold");
    if (fold) fold.setAttribute("aria-label", st.side ? "Hide the side panel" : "Show the side panel");
    var app = this.app;
    requestAnimationFrame(function () {
      if (app.bench) app.bench.resize();
      if (app.panels && app.panels.code) app.panels.code.paint();
    });
  };

  /* Code view is for writing; the moment you run, you want the bench. */
  Layout.prototype.revealBench = function () {
    if (this.st.view === "code") {
      this.st.view = "split";
      this.apply(); this.save();
      this.app.toast("Here's your design — the program is running on it.");
    }
  };
  Layout.prototype.toggleDock = function () {
    this.st.view = this.st.view === "design" ? "split" : "design";
    this.apply(); this.save();
  };

  /* ------------------------------------------------------- resizing */

  Layout.prototype.resizeStart = function (e) {
    var self = this, st = this.st, place = this.body.classList.contains("dock-left") ? "left" : this.body.classList.contains("dock-right") ? "right" : this.body.classList.contains("dock-float") ? "float" : "bottom";
    if (place === "float") return;
    e.preventDefault();
    var move = function (ev) {
      if (place === "bottom") st.h = L.clamp(1 - ev.clientY / root.innerHeight, 0.18, 0.75);
      else if (place === "left") st.w = L.clamp(ev.clientX, 300, root.innerWidth * 0.6);
      else st.w = L.clamp(root.innerWidth - ev.clientX, 300, root.innerWidth * 0.6);
      self.body.style.setProperty("--dock-h", Math.round(st.h * 100) + "vh");
      self.body.style.setProperty("--dock-w", Math.round(st.w) + "px");
      if (self.app.bench) self.app.bench.resize();
    };
    var up = function () {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
      self.body.classList.remove("resizing");
      self.save();
      if (self.app.panels.code) self.app.panels.code.paint();
    };
    this.body.classList.add("resizing");
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
  };

  Layout.prototype.clampFloat = function () {
    var st = this.st, d = this.dock;
    var W = root.innerWidth, H = root.innerHeight;
    st.fw = L.clamp(st.fw || 640, 340, W - 20); st.fh = L.clamp(st.fh || 380, 200, H - 70);
    if (st.fx == null) { st.fx = W - st.fw - 24; st.fy = H - st.fh - 24; }
    st.fx = L.clamp(st.fx, 0, W - 120); st.fy = L.clamp(st.fy, 50, H - 60);
    d.style.left = st.fx + "px"; d.style.top = st.fy + "px";
    d.style.width = st.fw + "px"; d.style.height = st.fh + "px";
    var self = this;
    if (!this.ro && root.ResizeObserver) {
      /* the floating window's own resize corner */
      this.ro = new ResizeObserver(function () {
        if (!self.body.classList.contains("dock-float")) return;
        var r = d.getBoundingClientRect();
        st.fw = Math.round(r.width); st.fh = Math.round(r.height);
        clearTimeout(self.roT); self.roT = setTimeout(function () { self.save(); if (self.app.panels.code) self.app.panels.code.paint(); }, 200);
      });
      this.ro.observe(d);
    }
  };
  Layout.prototype.dragStart = function (e) {
    var self = this, st = this.st, x0 = e.clientX - st.fx, y0 = e.clientY - st.fy;
    e.preventDefault();
    var move = function (ev) { st.fx = ev.clientX - x0; st.fy = ev.clientY - y0; self.clampFloat(); };
    var up = function () { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); self.save(); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
  };

  /* ---------------------------------------------------- full screen */

  Layout.prototype.fullscreen = function (on) {
    var el = this.wrap, isOn = this.isFull();
    if (on === undefined) on = !isOn;
    if (on === isOn) return;
    if (on) {
      var req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req) {
        var p = req.call(el);
        var self = this;
        if (p && p.catch) p.catch(function () { self.maximise(true); });
      } else this.maximise(true);
    } else {
      if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      this.maximise(false);
    }
  };
  /* Where the browser won't do real full screen (some frames, some
   * phones), fill the window instead. */
  Layout.prototype.maximise = function (on) { this.body.classList.toggle("bench-max", !!on); this.fsChanged(); };
  Layout.prototype.isFull = function () {
    return !!(document.fullscreenElement || document.webkitFullscreenElement || this.body.classList.contains("bench-max"));
  };
  Layout.prototype.fsChanged = function () {
    var on = this.isFull();
    this.body.classList.toggle("bench-full", on);
    var b = $("lab-fs");
    if (b) { b.setAttribute("aria-pressed", on ? "true" : "false"); b.title = on ? "Leave full screen (Esc)" : "Full screen"; }
    var app = this.app;
    /* a bigger bench deserves the whole circuit; leaving puts the view back */
    if (on && !this.wasFull) this.camBefore = { x: app.bench.cam.x, y: app.bench.cam.y, z: app.bench.cam.z };
    var back = !on && this.wasFull ? this.camBefore : null;
    this.wasFull = on;
    requestAnimationFrame(function () {
      app.bench.resize();
      if (on) app.bench.fit();
      else if (back) { app.bench.cam = back; app.bench.applyCam(); }
    });
  };
  /* Mirror the narration into the full-screen caption. */
  Layout.prototype.tick = function () {
    if (!this.body.classList.contains("bench-full")) return;
    var n = $("narrate"), html = n ? n.innerHTML : "", wait = n ? n.getAttribute("data-wait") : "";
    var full = html + (wait ? ' <span class="w">⏳ ' + L.esc(wait) + '</span>' : "");
    if (this.caption.innerHTML !== full) this.caption.innerHTML = full;
    this.caption.hidden = !html;
    var pw = this.wrap.querySelector(".fs-power");
    pw.setAttribute("aria-pressed", this.app.running ? "true" : "false");
    pw.querySelector("span").textContent = this.app.running ? "Power on" : "Power off";
  };
})(typeof window !== "undefined" ? window : globalThis);
