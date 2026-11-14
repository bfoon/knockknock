/* Chalk Power Lab — the page.
 *
 * Holds the plan, runs the simulator ten times a second, moves the sun
 * across the sky, and looks after the panels round the drawing: parts on
 * the left; on the right what you picked, what an inspector would say,
 * how the day went, and the AI.
 */
(function (root) {
  "use strict";

  var W = root.ChalkPower, esc = W.esc;
  function $(id) { return document.getElementById(id); }
  function hhmm(h) { h = ((h % 24) + 24) % 24; var m = Math.round(h * 60); return ("0" + Math.floor(m / 60) % 24).slice(-2) + ":" + ("0" + m % 60).slice(-2); }
  W.hhmm = hhmm;

  function App(cfg) {
    var self = this;
    this.cfg = cfg; this.t0 = Date.now(); this.rev = 1; this.on = false; this.speed = 0; this.dirty = false; this.side = "inspect"; this.drawerTab = "parts";
    this.doc = cfg.data && cfg.data.parts ? cfg.data : W.blankDoc();
    this.fixDoc();
    this.id = cfg.planId || null; this.title = cfg.title || "Untitled plan";
    this.clock = +this.doc.clock || 12; this.log = []; this.happened = [];
    this.history = new W.History(60);
    this.sim = new W.Sim(this.doc);
    this.sim.onEvent = function (e) { self.happened.unshift(e); if (self.happened.length > 12) self.happened.pop(); if (!self.quiet) self.toast(e.msg, e.level); self.checkSoon(); };
    this.refs = W.refs(this.doc);
    this.view = new W.View(this, $("pw-board"));
    this.testers = new W.Testers(this, $("pw-meter"));
    this.dialogs = new W.Dialogs(this);
    this.bind();
    this.drawer(); this.showSide("inspect"); this.setEnv(); this.syncClock();
    $("pw-title").value = this.title;
    if (this.doc.parts.length) this.view.fit(); else this.welcome();
    this.status(this.id ? "Saved" : "");
    var last = 0, acc = 0;
    (function frame(ts) {
      var dt = Math.min(0.25, (ts - last) / 1000 || 0); last = ts; acc += dt;
      if (acc >= 0.1) { acc = 0; try { self.tick(); } catch (e) { if (root.console) console.error(e); } }
      try { self.view.draw(); } catch (e2) { if (root.console) console.error(e2); }
      requestAnimationFrame(frame);
    })(0);
  }
  W.App = App;

  App.prototype.fixDoc = function () {
    var d = this.doc, b = W.blankDoc(), k;
    d.parts = (d.parts || []).filter(function (p) { return p && W.PARTS[p.type]; });
    var ids = {}; d.parts.forEach(function (p) { ids[p.id] = 1; p.props = p.props || {}; });
    d.wires = (d.wires || []).filter(function (w) { return w && typeof w.a === "string" && typeof w.b === "string" && ids[w.a.split(":")[0]] && ids[w.b.split(":")[0]]; });
    d.site = d.site || {}; for (k in b.site) if (d.site[k] == null) d.site[k] = b.site[k];
    d.prices = d.prices || {}; if (d.tariff == null) d.tariff = b.tariff;
  };

  /* ------------------------------------------------------------- editing */

  App.prototype.changed = function (quiet) {
    this.rev++; this.sim.dirty = true; this.refs = W.refs(this.doc); this.dirty = true;
    this.status("Unsaved");
    clearTimeout(this.saveT); var self = this; this.saveT = setTimeout(function () { self.save(); }, 1600);
    if (!quiet) this.inspect();
    this.checkSoon();
  };
  App.prototype.edit = function (fn) { this.history.push(this.doc); fn(this.doc); this.changed(); };
  /* A change made by using the thing — throwing a switch — not by designing it. */
  App.prototype.live = function (fn) { fn(this.doc); this.changed(); };
  App.prototype.replaceDoc = function (doc, title, keepHistory) {
    if (keepHistory) this.history.push(this.doc);
    this.doc = doc; this.fixDoc(); this.sim = new W.Sim(doc); var self = this;
    this.sim.onEvent = function (e) { self.happened.unshift(e); if (self.happened.length > 12) self.happened.pop(); if (!self.quiet) self.toast(e.msg, e.level); self.checkSoon(); };
    if (title) { this.title = title; $("pw-title").value = title; }
    this.clock = +doc.clock || this.clock; this.log = []; this.happened = [];
    this.view.select([]); this.setEnv(); this.syncClock(); this.changed(); this.view.fit();
  };
  App.prototype.undo = function (redo) {
    var d = redo ? this.history.redo(this.doc) : this.history.undo(this.doc);
    if (!d) return;
    this.doc = d; this.fixDoc(); this.sim.doc = d; this.view.select([]); this.changed();
  };
  App.prototype.addPart = function (type) {
    var d = W.PARTS[type]; if (!d) return;
    if (this.doc.parts.length >= 400) { this.toast("That is as many parts as one plan holds."); return; }
    var c = this.view.centre(), n = this.doc.parts.length, p = { id: W.uid("p"), type: type, x: 0, y: 0, props: {} }, self = this;
    var s = W.sizeOf(p); p.x = Math.round((c.x - s.w / 2 + (n % 5) * 24 - 48) / 10) * 10; p.y = Math.round((c.y - s.h / 2 + (n % 4) * 24 - 36) / 10) * 10;
    this.edit(function (doc) { if (d.back) doc.parts.unshift(p); else doc.parts.push(p); });
    this.view.select([p.id]);
    if (!this.hinted && W.termsOf(p).length) { this.hinted = true; setTimeout(function () { self.toast("Click one of its round terminals, then a terminal on another part, to run a cable between them."); }, 500); }
  };
  App.prototype.addWire = function (a, b) {
    if (a === b) return;
    var doc = this.doc, dup = doc.wires.some(function (w) { return (w.a === a && w.b === b) || (w.a === b && w.b === a); });
    if (dup) { this.toast("There is already a cable between those two."); return; }
    if (doc.wires.length >= 1200) { this.toast("That is as many cables as one plan holds."); return; }
    var ka = this.view.termXY(a), kb = this.view.termXY(b), tk = this.view.termKind || {}, k = (ka && ka.k !== "X" ? ka.k : kb && kb.k !== "X" ? kb.k : tk[a] || tk[b]) || "X";
    var pa = W.partById(doc, a.split(":")[0]), pb = W.partById(doc, b.split(":")[0]), batt = /^(battery|inverter)$/.test(pa.type) || /^(battery|inverter)$/.test(pb.type);
    var dist = ka && kb ? Math.hypot(ka.x - kb.x, ka.y - kb.y) : 200, w = { id: W.uid("w"), a: a, b: b, mm2: (k === "P" || k === "M") ? (batt ? 25 : 4) : 2.5, len: Math.max(0.3, Math.round(dist / 60) / 2) };
    if ((ka && ka.k === "PE") !== (kb && kb.k === "PE") && ka && kb && ka.k !== "X" && kb.k !== "X") this.toast("That joins an earth terminal to a " + (ka.k === "PE" ? kb.k : ka.k) + " terminal. Is that what you meant?", "warn");
    else if (ka && kb && ((ka.k === "P" && kb.k === "M") || (ka.k === "M" && kb.k === "P")) && pa.id === pb.id) this.toast("That shorts the part's own plus to its minus.", "warn");
    this.edit(function () { doc.wires.push(w); });
    this.view.select([], w.id);
  };
  App.prototype.removeSelected = function () {
    var ids = this.view.selected(), wire = this.view.selWire, doc = this.doc;
    if (!ids.length && !wire) return;
    this.edit(function () {
      if (wire) doc.wires = doc.wires.filter(function (w) { return w.id !== wire; });
      if (ids.length) {
        var gone = {}; ids.forEach(function (id) { gone[id] = 1; });
        doc.parts = doc.parts.filter(function (p) { return !gone[p.id]; });
        doc.wires = doc.wires.filter(function (w) { return !gone[w.a.split(":")[0]] && !gone[w.b.split(":")[0]]; });
      }
    });
    this.view.select([]);
  };
  App.prototype.duplicate = function () {
    var ids = this.view.selected(), doc = this.doc, map = {}, made = [];
    if (!ids.length) return;
    this.edit(function () {
      ids.forEach(function (id) { var p = W.partById(doc, id); if (!p) return; var q = JSON.parse(JSON.stringify(p)); q.id = W.uid("p"); q.x += 30; q.y += 30; map[id] = q.id; doc.parts.push(q); made.push(q.id); });
      doc.wires.slice().forEach(function (w) { var a = w.a.split(":"), b = w.b.split(":"); if (map[a[0]] && map[b[0]]) doc.wires.push({ id: W.uid("w"), a: map[a[0]] + ":" + a.slice(1).join(":"), b: map[b[0]] + ":" + b.slice(1).join(":"), mm2: w.mm2, len: w.len }); });
    });
    this.view.select(made);
  };

  /* ------------------------------------------------------------- running */

  App.prototype.setEnv = function () {
    var e = W.Sun.at(this.doc.site, this.clock);
    this.sim.env = { G: e.G, tamb: e.tamb }; this.sim.hour = this.clock; this.sun = e;
  };
  App.prototype.power = function (on) {
    this.on = on;
    var b = $("pw-power"); b.setAttribute("aria-pressed", on ? "true" : "false"); b.querySelector("span").textContent = on ? "Power on" : "Power off";
    document.body.classList.toggle("is-on", on);
    if (on) { this.sim.reset(); this.happened = []; this.log = []; this.quiet = true; this.setEnv(); this.sim.settle(25); this.quiet = false; }
    else if (this.running) this.stopDay();
    this.inspect(); this.checkSoon();
  };
  App.prototype.tick = function () {
    var sim = this.sim;
    if (this.on) {
      var dt = this.speed ? this.speed / 10 : 0.1;
      if (this.speed) { this.clock = (this.clock + dt / 3600) % 24; this.doc.clock = Math.round(this.clock * 4) / 4; this.syncClock(); }
      this.setEnv();
      sim.fast = dt >= 30; sim.routine = sim.fast && $("pw-routine").checked;
      if (sim.fast) sim.stride(dt); else sim.step(dt);
      if (this.speed) {
        var t = sim.totals(); this.log.push({ h: sim.t / 3600, clock: this.clock, pv: t.pv, load: t.load, soc: t.soc, grid: t.grid });
        if (this.log.length > 600) this.log.shift();
        if (this.running && sim.t - this.runStart >= 86400) this.stopDay(true);
      }
    }
    this.testers.tick();
    this.frameN = (this.frameN || 0) + 1;
    if (this.frameN % 3 === 0) { this.sky(); if (this.on) this.liveSide(); }
  };
  App.prototype.runDay = function () {
    if (!this.doc.parts.length) { this.toast("There is nothing to run yet."); return; }
    if (!this.on) this.power(true);
    this.sim.tot = { solar: 0, load: 0, grid: 0, gen: 0, litres: 0, unmet: 0, exported: 0 };
    this.doc.parts.forEach(function (p) { var st = this.sim.state[p.id]; if (st && st.soc != null) st.low = st.soc; }, this);
    this.log = []; this.running = true; this.runStart = this.sim.t; this.clock = 6; this.setSpeed(3600);
    $("pw-day").textContent = "■ Stop"; this.showSide("day");
  };
  App.prototype.stopDay = function (done) {
    this.running = false; this.setSpeed(0); $("pw-day").textContent = "▶ Run a day";
    if (done) { this.dayDone = true; this.showSide("day"); this.toast("A whole day has run. The Day panel has the result."); }
  };
  App.prototype.setSpeed = function (s) { this.speed = s; $("pw-speed").value = String(s); };
  App.prototype.syncClock = function () { $("pw-clock").value = this.clock; $("pw-clock-out").textContent = hhmm(this.clock); };

  App.prototype.sky = function () {
    var cv = $("pw-sky-c"), c = cv.getContext("2d"), e = this.sun || { el: 0, G: 0, tamb: 0 }, Wd = cv.width, H = cv.height;
    c.clearRect(0, 0, Wd, H);
    var day = e.el > 0, g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, day ? "#2f6ea8" : "#0c1524"); g.addColorStop(1, day ? "#8fc2e8" : "#1b2740"); c.fillStyle = g; c.fillRect(0, 0, Wd, H);
    c.strokeStyle = "rgba(255,255,255,.3)"; c.setLineDash([2, 3]); c.beginPath(); c.arc(Wd / 2, H + 4, H - 6, Math.PI, 0); c.stroke(); c.setLineDash([]);
    var a = Math.PI * (1 - ((this.clock - 6) / 12)), x = Wd / 2 + (H - 6) * Math.cos(a), y = H + 4 - (H - 6) * Math.sin(a);
    if (this.clock >= 6 && this.clock <= 18) { c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fillStyle = "#ffd84a"; c.fill(); }
    else { c.beginPath(); c.arc(Wd / 2, 14, 5, 0, Math.PI * 2); c.fillStyle = "#dfe8ee"; c.fill(); }
    var cl = W.Sun.cloud(this.doc.site);
    if (cl > 0.2) { c.fillStyle = "rgba(240,244,248," + Math.min(0.85, cl) + ")"; for (var i = 0; i < 3; i++) { c.beginPath(); c.ellipse(18 + i * 26, 12 + (i % 2) * 6, 12, 5, 0, 0, Math.PI * 2); c.fill(); } }
    $("pw-sky-t").innerHTML = "<b>" + Math.round(e.G) + "</b> W/m² · " + Math.round(e.tamb) + " °C<br>" + esc(this.doc.site.name) + " · " + W.Sun.MONTHS[(this.doc.site.month || 1) - 1].slice(0, 3);
  };

  /* --------------------------------------------------------------- saving */

  App.prototype.status = function (s) { $("pw-saved").textContent = s; };
  App.prototype.save = function (beacon) {
    var self = this, cfg = this.cfg;
    if (!this.dirty || !cfg.saveUrl) return;
    this.doc.view = { x: Math.round(this.view.cam.x), y: Math.round(this.view.cam.y), z: Math.round(this.view.cam.z * 100) / 100 };
    var payload = { id: this.id, title: this.title, data: this.doc };
    if (beacon && navigator.sendBeacon) { var fd = new FormData(); fd.append("payload", JSON.stringify(payload)); fd.append("csrfmiddlewaretoken", cfg.csrf); navigator.sendBeacon(cfg.saveUrl, fd); return; }
    this.dirty = false; this.status("Saving…");
    fetch(cfg.saveUrl, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": cfg.csrf }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok && j.ok, j: j }; }); })
      .then(function (r) {
        if (!r.ok) { self.dirty = true; self.status("Not saved"); self.toast((r.j && r.j.error) || "Couldn't save.", "warn"); return; }
        if (!self.id && r.j.url && root.history.replaceState) root.history.replaceState(null, "", r.j.url);
        self.id = r.j.id; self.status(self.dirty ? "Unsaved" : "Saved");
      }).catch(function () { self.dirty = true; self.status("Offline — not saved"); });
  };

  App.prototype.toast = function (msg, level) {
    var box = $("pw-toasts"), d = document.createElement("p");
    d.className = "pw-toast " + (level || ""); d.textContent = msg; box.appendChild(d);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(function () { d.classList.add("out"); setTimeout(function () { d.remove(); }, 400); }, level === "danger" ? 9000 : 5500);
  };

  /* --------------------------------------------------------------- drawer */

  App.prototype.drawer = function () {
    var box = $("pw-drawer"), self = this, tab = this.drawerTab, html = '<div class="pw-tabs" role="tablist"><button type="button" data-dt="parts" aria-selected="' + (tab === "parts") + '">Parts</button><button type="button" data-dt="testers" aria-selected="' + (tab === "testers") + '">Testers</button></div>';
    if (tab === "testers") {
      html += '<p class="hint">Pick a tool, then click what you want to test.</p><div class="pw-tools">' + W.TOOLS.map(function (t) {
        return '<button type="button" data-tool="' + t.id + '" aria-pressed="' + (self.testers.tool && self.testers.tool.id === t.id) + '"><b>' + esc(t.icon) + '</b><span>' + esc(t.name) + '<small>' + esc(t.blurb) + '</small></span></button>';
      }).join("") + '</div>';
    } else {
      html += '<input type="search" id="pw-find" placeholder="Find a part" aria-label="Find a part" value="' + esc(this.find || "") + '">';
      var f = (this.find || "").toLowerCase();
      W.CATS.forEach(function (cat) {
        var items = Object.keys(W.PARTS).filter(function (k) { var d = W.PARTS[k]; return d.cat === cat && (!f || (d.name + " " + d.blurb).toLowerCase().indexOf(f) >= 0); });
        if (!items.length) return;
        html += '<h3>' + esc(cat) + '</h3><div class="pw-parts">' + items.map(function (k) { return '<button type="button" data-add="' + k + '" title="' + esc(W.PARTS[k].blurb) + '">' + esc(W.PARTS[k].name) + '</button>'; }).join("") + '</div>';
      });
    }
    box.innerHTML = html;
    box.querySelectorAll("[data-dt]").forEach(function (b) { b.addEventListener("click", function () { self.drawerTab = b.getAttribute("data-dt"); self.drawer(); }); });
    box.querySelectorAll("[data-add]").forEach(function (b) { b.addEventListener("click", function () { self.addPart(b.getAttribute("data-add")); }); });
    box.querySelectorAll("[data-tool]").forEach(function (b) { b.addEventListener("click", function () { self.testers.pick(b.getAttribute("data-tool")); }); });
    var fi = $("pw-find");
    if (fi) fi.addEventListener("input", function () { self.find = fi.value; var pos = fi.selectionStart; self.drawer(); var n = $("pw-find"); n.focus(); n.setSelectionRange(pos, pos); });
  };

  /* ---------------------------------------------------------- side panels */

  App.prototype.showSide = function (tab) {
    this.side = tab;
    document.querySelectorAll("#pw-side-tabs button").forEach(function (b) { b.setAttribute("aria-selected", b.getAttribute("data-side") === tab ? "true" : "false"); });
    ["inspect", "check", "day", "ai"].forEach(function (t) { $("pw-pane-" + t).hidden = t !== tab; });
    if (tab === "inspect") this.inspect(); else if (tab === "check") this.check(); else if (tab === "day") this.day();
    document.body.classList.add("side-open");
  };
  App.prototype.onSelect = function () { if (this.side !== "inspect" && (this.view.selected().length || this.view.selWire)) this.showSide("inspect"); else this.inspect(); };

  function field(f, v, pr) {
    if (f.when && !f.when(pr)) return "";
    var id = "pf-" + f.k, lab = '<label for="' + id + '">' + esc(f.label) + (f.unit && f.type !== "range" ? " <small>(" + esc(f.unit) + ")</small>" : "") + '</label>';
    if (f.type === "bool") return '<div class="pw-f check"><input type="checkbox" id="' + id + '" data-k="' + f.k + '"' + (v ? " checked" : "") + '>' + lab + (f.hint ? '<small>' + esc(f.hint) + '</small>' : '') + '</div>';
    if (f.type === "select") return '<div class="pw-f">' + lab + '<select id="' + id + '" data-k="' + f.k + '">' + f.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? " selected" : "") + '>' + esc(o[1]) + '</option>'; }).join("") + '</select></div>';
    if (f.type === "range") return '<div class="pw-f">' + lab + '<div class="pw-range"><input type="range" id="' + id + '" data-k="' + f.k + '" min="' + f.min + '" max="' + f.max + '" step="' + (f.step || 1) + '" value="' + esc(v) + '"><output>' + esc(v) + (f.unit || "") + '</output></div></div>';
    if (f.type === "text") return '<div class="pw-f">' + lab + '<input type="text" id="' + id + '" data-k="' + f.k + '" maxlength="40" value="' + esc(v) + '"></div>';
    return '<div class="pw-f">' + lab + '<input type="number" id="' + id + '" data-k="' + f.k + '" min="' + f.min + '" max="' + f.max + '" step="' + (f.step || 1) + '" value="' + esc(v) + '">' + (f.hint ? '<small>' + esc(f.hint) + '</small>' : '') + '</div>';
  }

  App.prototype.inspect = function () {
    if (this.side !== "inspect") return;
    var box = $("pw-pane-inspect"), self = this, doc = this.doc, ids = this.view.selected(), wid = this.view.selWire, html = "";
    if (document.activeElement && box.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName) && this.inspKey === ids.join() + "|" + wid) { this.liveSide(); return; }
    this.inspKey = ids.join() + "|" + wid;
    if (wid) {
      var w = doc.wires.filter(function (q) { return q.id === wid; })[0];
      if (!w) { this.view.selWire = null; return this.inspect(); }
      var kind = this.view.kinds()[w.id] || "X";
      html = '<h2><i class="pw-dot" style="background:' + W.KIND_COLOR[kind] + '"></i>Cable</h2><p class="hint">' + ({ L: "Live", N: "Neutral", PE: "Earth", P: "DC positive", M: "DC negative", X: "Not connected to anything that says what it is" }[kind]) + '. One conductor.</p>' +
        '<div class="pw-f"><label for="pf-mm2">Thickness</label><select id="pf-mm2">' + W.SIZES.map(function (s) { return '<option value="' + s + '"' + (s === +w.mm2 ? " selected" : "") + '>' + s + ' mm² — up to ' + W.AMPACITY[s] + ' A</option>'; }).join("") + '</select></div>' +
        '<div class="pw-f"><label for="pf-len">Length <small>(m)</small></label><input type="number" id="pf-len" min="0.1" max="500" step="0.5" value="' + w.len + '"></div>' +
        '<div class="pw-live" id="pw-live"></div><div class="pw-actions"><button type="button" id="pf-auto" title="The thinnest cable that carries what is flowing now, with a quarter to spare and under 3% lost">Size it for me</button><button type="button" id="pf-del" class="danger">Remove</button></div>';
      box.innerHTML = html;
      $("pf-mm2").addEventListener("change", function () { self.edit(function () { w.mm2 = +$("pf-mm2").value; }); });
      $("pf-len").addEventListener("change", function () { self.edit(function () { w.len = W.clamp(+$("pf-len").value || 1, 0.1, 500); }); });
      $("pf-del").addEventListener("click", function () { self.removeSelected(); });
      $("pf-auto").addEventListener("click", function () {
        var ws = self.sim.wstate[w.id];
        if (!self.on || !ws || ws.mag < 0.05) { self.toast("Switch the power on with the loads running, so there is a current to size it for."); return; }
        var best = W.sizeFor(ws.mag, +w.len, (kind === "P" || kind === "M" ? 24 : 230) * 0.015);
        self.edit(function () { w.mm2 = best; }); self.toast(ws.mag.toFixed(1) + " A over " + w.len + " m: " + best + " mm².");
      });
      this.liveSide(); return;
    }
    if (ids.length > 1) {
      box.innerHTML = '<h2>' + ids.length + ' parts</h2><p class="hint">Drag any of them to move them all. Shift-click adds to the selection; Shift-drag on the paper draws a box round several.</p><div class="pw-actions"><button type="button" id="pf-dup">Duplicate</button><button type="button" id="pf-del" class="danger">Remove</button></div>';
      $("pf-dup").addEventListener("click", function () { self.duplicate(); }); $("pf-del").addEventListener("click", function () { self.removeSelected(); });
      return;
    }
    var p = ids.length ? W.partById(doc, ids[0]) : null;
    if (!p) {
      var bom = doc.parts.length ? W.Check.bom(doc) : null;
      box.innerHTML = '<h2>' + (doc.parts.length ? "This plan" : "Start here") + '</h2>' + (doc.parts.length ?
        '<p>' + doc.parts.length + ' parts, ' + doc.wires.length + ' cables. About <b>' + W.money(bom.total) + '</b> of equipment.</p><p class="hint">Click a part or a cable to see and change it. Switch the power on and click a switch to throw it.</p>' :
        '<p>Add parts from the left and join their terminals, or press <b>Design a system</b> and have a complete, wired installation drawn for you.</p>') +
        '<div class="pw-actions col"><button type="button" class="primary" id="pf-wiz">Design a system…</button><button type="button" id="pf-site">Place and sun: ' + esc(doc.site.name) + '</button></div>';
      $("pf-wiz").addEventListener("click", function () { self.dialogs.wizard(); }); $("pf-site").addEventListener("click", function () { self.dialogs.site(); });
      return;
    }
    var d = W.def(p), pr = W.propsOf(p), secret = doc.secret && !this.teacher;
    html = '<h2>' + esc(d.name) + ' <small>' + esc(this.refs[p.id] || "") + '</small></h2><p class="hint">' + esc(d.blurb) + '</p>' +
      '<div class="pw-f"><label for="pf-name">Label</label><input type="text" id="pf-name" maxlength="40" placeholder="e.g. Kitchen sockets" value="' + esc(p.name || "") + '"></div>';
    var teach = "";
    d.spec.forEach(function (f) { var h = field(f, pr[f.k], pr); if (f.teacher) teach += h; else html += h; });
    if (teach && !secret) html += '<details class="pw-teach"' + (pr.fault && pr.fault !== "none" ? " open" : "") + '><summary>Give it a fault</summary>' + teach + '</details>';
    html += '<div class="pw-live" id="pw-live"></div><div class="pw-actions"><button type="button" id="pf-dup">Duplicate</button><button type="button" id="pf-del" class="danger">Remove</button></div>';
    box.innerHTML = html;
    $("pf-name").addEventListener("change", function () { self.edit(function () { var v = $("pf-name").value.trim(); if (v) p.name = v; else delete p.name; }); });
    box.querySelectorAll("[data-k]").forEach(function (el) {
      var k = el.getAttribute("data-k"), f = d.spec.filter(function (q) { return q.k === k; })[0];
      var read = function () { return f.type === "bool" ? el.checked : f.type === "num" || f.type === "range" ? W.clamp(+el.value || 0, f.min, f.max) : f.type === "select" && typeof d.props[k] === "number" ? +el.value : el.value; };
      el.addEventListener(f.type === "range" ? "input" : "change", function () {
        var v = read();
        if (f.type === "range") { el.nextElementSibling.textContent = v + (f.unit || ""); p.props[k] = v; self.changed(true); return; }
        self.inspKey = null;
        self.edit(function () { p.props[k] = v; });
      });
      if (f.type === "range") el.addEventListener("pointerdown", function () { self.history.push(self.doc); });
    });
    $("pf-dup").addEventListener("click", function () { self.duplicate(); }); $("pf-del").addEventListener("click", function () { self.removeSelected(); });
    this.liveSide();
  };

  /* The readings under the fields, refreshed while the power is on. */
  App.prototype.liveSide = function () {
    if (this.side === "day" && this.speed) { this.day(); return; }
    var box = $("pw-live"); if (!box || this.side !== "inspect") return;
    if (!this.on) { box.innerHTML = ""; return; }
    var sim = this.sim, wid = this.view.selWire, rows = [];
    if (wid) {
      var ws = sim.wstate[wid], w = this.doc.wires.filter(function (q) { return q.id === wid; })[0];
      if (ws && w) { rows.push(["Current", W.fmt(ws.mag, "A")], ["Using", Math.round(100 * ws.mag / W.ampacity(w.mm2)) + "% of what it can carry"], ["Lost along it", W.fmt(ws.drop, "V") + " · " + W.fmt(ws.loss, "W")]); if (ws.burnt) rows.push(["State", "BURNT THROUGH"]); }
    } else {
      var id = this.view.selected()[0], p = id && W.partById(this.doc, id), st = (id && sim.state[id]) || {}, pr = p ? W.propsOf(p) : {};
      if (!p) return;
      if (st.v != null) rows.push(["Voltage", W.fmt(st.v, "V")]);
      if (st.i != null) rows.push(["Current", W.fmt(Math.abs(st.i), "A") + (p.type === "battery" ? (st.i > 0.05 ? " out" : st.i < -0.05 ? " in" : "") : "")]);
      if (st.p != null) rows.push(["Power", W.fmt(st.p, "W")]);
      if (st.imax != null) rows.push(["Through it", W.fmt(st.imax, "A") + (pr.amps ? " of " + pr.amps + " A" : "")]);
      if (st.vpv != null) rows.push(["Panels", W.fmt(st.vpv, "V") + " · " + W.fmt(st.pin || 0, "W")]);
      if (st.vb != null) rows.push(["Battery side", W.fmt(st.vb, "V") + " · " + W.fmt(st.ib == null ? st.iout || 0 : st.ib, "A")]);
      if (st.pac != null) rows.push(["AC out", W.fmt(st.pac, "W") + (pr.va ? " (" + Math.round(100 * (st.s || 0) / pr.va) + "% of rating)" : "")]);
      if (st.soc != null) rows.push(["Charge", Math.round(st.soc * 100) + "%"]);
      if (st.res != null) rows.push(["Earth leakage", W.fmt(st.res, "A")]);
      if (st.voc != null && p.type === "pv") rows.push(["Could give", "Voc " + st.voc.toFixed(1) + " V · Isc " + st.isc.toFixed(2) + " A"]);
      if (st.trip) rows.push(["State", "TRIPPED — click it to reset"]); if (st.blown === true) rows.push(["State", "BLOWN — click it to fit a new one"]);
      if (st.err) rows.push(["State", st.err]);
      if (st.lph) rows.push(["Fuel", st.lph.toFixed(2) + " L/h"]);
    }
    box.innerHTML = rows.length ? '<h3>Now</h3><dl>' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join("") + '</dl>' : "";
  };

  App.prototype.checkSoon = function () { var self = this; clearTimeout(this.checkT); this.checkT = setTimeout(function () { self.check(true); }, 500); };
  App.prototype.check = function (quiet) {
    var list = W.Check.run(this.doc, this.sim, this.on), bad = list.filter(function (x) { return x.level !== "info"; }).length, tab = document.querySelector('#pw-side-tabs [data-side="check"]');
    tab.innerHTML = "Check" + (bad ? ' <b class="pw-badge">' + bad + '</b>' : "");
    this.findings = list;
    if (this.side !== "check") return;
    var box = $("pw-pane-check"), self = this, hid = this.doc.secret && !this.teacher;
    var html = '<h2>Inspector’s checklist</h2>';
    if (!this.doc.parts.length) html += '<p class="hint">Nothing to inspect yet.</p>';
    else if (!list.length) html += '<p class="pw-ok">✓ Nothing wrong that can be seen' + (this.on ? "." : " on paper. Switch the power on to test it for real.") + '</p>';
    html += '<ul class="pw-find">' + list.map(function (x, i) { return '<li class="' + x.level + '"><button type="button" data-find="' + i + '">' + esc(x.msg) + '</button></li>'; }).join("") + '</ul>';
    if (this.happened.length) html += '<h3>What just happened</h3><ul class="pw-log">' + this.happened.map(function (e) { return '<li class="' + e.level + '">' + esc(e.msg) + '</li>'; }).join("") + '</ul>';
    html += '<h3>Teach with it</h3><div class="pw-actions col"><button type="button" id="pc-fault">' + (this.doc.secret ? "Reveal the hidden fault" : "Hide a fault for the class to find") + '</button><button type="button" id="pc-bolt">⚡ Lightning strike</button><button type="button" id="pc-cut">' + "Power cut: grid off / on" + '</button></div>' +
      (hid ? '<p class="hint">A fault is hidden in this plan. Use the testers to find it.</p>' : '');
    box.innerHTML = html;
    box.querySelectorAll("[data-find]").forEach(function (b) { b.addEventListener("click", function () { var x = list[+b.getAttribute("data-find")]; self.view.focus(x.parts, x.wires); if (x.parts.length) self.view.sel = {}; }); });
    $("pc-fault").addEventListener("click", function () { self.dialogs.fault(); });
    $("pc-bolt").addEventListener("click", function () { self.dialogs.lightning(); });
    $("pc-cut").addEventListener("click", function () {
      var g = self.doc.parts.filter(function (p) { return /^grid/.test(p.type); });
      if (!g.length) { self.toast("There is no grid supply in this plan."); return; }
      self.live(function () { var on = W.propsOf(g[0]).on === false; g.forEach(function (p) { p.props.on = on; }); });
      self.toast(W.propsOf(g[0]).on === false ? "Power cut." : "The grid is back.");
    });
  };

  App.prototype.day = function () {
    var box = $("pw-pane-day"), sim = this.sim, t = sim.tot, doc = this.doc, self = this;
    if (!box.firstChild) {
      box.innerHTML = '<h2>A day in the life</h2><p class="hint">Runs 24 hours in about half a minute: the sun crosses the sky, lamps come on in the evening, the fridge cycles, the battery fills and empties.</p>' +
        '<canvas id="pw-chart" width="600" height="300"></canvas><div class="pw-key"><span style="--c:#ffd36b">Solar</span><span style="--c:#ff8a5a">Loads</span><span style="--c:#7fc8ff">Battery %</span><span style="--c:#c9a3ff">Grid / generator</span></div><div id="pw-day-sum"></div>' +
        '<div class="pw-actions col"><button type="button" class="primary" id="pd-run">▶ Run a day</button></div>';
      $("pd-run").addEventListener("click", function () { if (self.running) self.stopDay(); else self.runDay(); });
    }
    $("pd-run").textContent = this.running ? "■ Stop" : "▶ Run a day";
    var cv = $("pw-chart"), c = cv.getContext("2d"), Wd = cv.width, H = cv.height, L = 44, B = 26, log = this.log;
    c.fillStyle = "#0f1820"; c.fillRect(0, 0, Wd, H);
    var max = 100; log.forEach(function (q) { max = Math.max(max, q.pv, q.load, Math.abs(q.grid)); });
    var h0 = log.length ? log[0].h : 0, span = Math.max(24, log.length ? log[log.length - 1].h - h0 : 24), X = function (h) { return L + (Wd - L - 10) * (h - h0) / span; }, Y = function (v) { return H - B - (H - B - 12) * v / (max * 1.08); };
    c.strokeStyle = "rgba(255,255,255,.1)"; c.fillStyle = "rgba(232,238,244,.6)"; c.font = "11px system-ui"; c.textAlign = "right"; c.lineWidth = 1;
    for (var g = 0; g <= 4; g++) { var v = max * g / 4; c.beginPath(); c.moveTo(L, Y(v)); c.lineTo(Wd - 10, Y(v)); c.stroke(); c.fillText(v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v), L - 6, Y(v) + 4); }
    c.textAlign = "center";
    if (log.length) for (var hh = 0; hh <= span; hh += 6) c.fillText(hhmm(log[0].clock + hh), X(h0 + hh), H - 8);
    var series = function (key, col, scale, wd) { c.strokeStyle = col; c.lineWidth = wd || 2; c.beginPath(); log.forEach(function (q, i) { var y = scale ? H - B - (H - B - 12) * (q[key] == null ? 0 : q[key]) : Y(Math.max(0, q[key])); if (i) c.lineTo(X(q.h), y); else c.moveTo(X(q.h), y); }); c.stroke(); };
    if (log.length > 1) { series("grid", "#c9a3ff", false, 1.5); series("pv", "#ffd36b"); series("load", "#ff8a5a"); if (log[0].soc != null) series("soc", "#7fc8ff", true, 1.5); }
    var low = 1, hasB = false; doc.parts.forEach(function (p) { var st = sim.state[p.id]; if (p.type === "battery" && st && st.low != null) { low = Math.min(low, st.low); hasB = true; } });
    var kwh = function (x) { return (x / 1000).toFixed(2) + " kWh"; }, rows = [["From the sun", kwh(t.solar)], ["Used by the loads", kwh(t.load)]];
    if (t.grid > 1) rows.push(["Bought from the grid", kwh(t.grid) + " · " + W.money(t.grid / 1000 * doc.tariff)]);
    if (t.exported > 1) rows.push(["Sent back to the grid", kwh(t.exported)]);
    if (t.litres > 0.01) rows.push(["Generator fuel", t.litres.toFixed(1) + " L"]);
    if (hasB) rows.push(["Battery at its lowest", Math.round(low * 100) + "%"]);
    rows.push(["Loads left without power", t.unmet < 0.05 ? "none" : t.unmet.toFixed(1) + " appliance-hours"]);
    if (t.solar > 1) rows.push(["Solar worth", W.money(Math.min(t.solar, t.load) / 1000 * doc.tariff) + " a day at D " + doc.tariff + "/kWh"]);
    var verdict = "";
    if (this.dayDone && !this.running && log.length > 50) {
      verdict = t.unmet > 0.3 ? '<p class="pw-bad">The system could not keep everything running. More battery, more panels, or fewer evening loads.</p>'
        : hasB && low < 0.45 ? '<p class="pw-warnp">It got through the day, but the battery went down to ' + Math.round(low * 100) + '%. Fine for lithium; hard on lead-acid.</p>'
        : '<p class="pw-ok">✓ It got through the day with power to spare.</p>';
    }
    $("pw-day-sum").innerHTML = verdict + (sim.t > 0 ? '<dl>' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join("") + '</dl>' : "");
  };

  App.prototype.welcome = function () {
    var self = this; setTimeout(function () { if (!self.doc.parts.length) self.dialogs.wizard(); }, 350);
  };

  /* What the AI is told about the plan: enough to reason, small enough to send. */
  App.prototype.digest = function () {
    var doc = this.doc, sim = this.sim, refs = this.refs, on = this.on;
    return {
      site: doc.site, clock: hhmm(this.clock), sun: Math.round(sim.env.G), powerOn: on,
      parts: doc.parts.slice(0, 150).map(function (p) {
        var d = W.def(p), st = sim.state[p.id] || {}, o = { ref: refs[p.id], type: p.type, props: p.props };
        if (p.name) o.name = p.name;
        if (on) { var r = {}; ["v", "i", "p", "soc", "pin", "pac", "s", "imax", "mode", "err", "trip", "vpv", "vb", "res"].forEach(function (k) { if (st[k] != null && st[k] !== false) r[k] = typeof st[k] === "number" ? Math.round(st[k] * 100) / 100 : st[k]; }); if (st.blown === true) r.blown = true; o.now = r; }
        return o;
      }),
      cables: doc.wires.slice(0, 300).map(function (w) { var a = w.a.split(":"), b = w.b.split(":"), ws = sim.wstate[w.id]; return [refs[a[0]] + "." + a.slice(1).join(":"), refs[b[0]] + "." + b.slice(1).join(":"), w.mm2, w.len, on && ws ? Math.round(ws.mag * 10) / 10 : null]; }),
      findings: (this.findings || W.Check.run(doc, sim, on)).slice(0, 14).map(function (f) { return f.level + ": " + f.msg; }),
      day: sim.t > 3600 ? { hours: Math.round(sim.t / 360) / 10, solarWh: Math.round(sim.tot.solar), loadWh: Math.round(sim.tot.load), gridWh: Math.round(sim.tot.grid), unmetHours: Math.round(sim.tot.unmet * 10) / 10 } : null
    };
  };

  /* --------------------------------------------------------------- wiring */

  App.prototype.bind = function () {
    var self = this;
    $("pw-power").addEventListener("click", function () { self.power(!self.on); });
    $("pw-title").addEventListener("change", function () { self.title = $("pw-title").value.trim().slice(0, 200) || "Untitled plan"; self.dirty = true; self.save(); });
    $("pw-clock").addEventListener("input", function () { self.clock = +$("pw-clock").value; self.doc.clock = self.clock; $("pw-clock-out").textContent = hhmm(self.clock); self.setEnv(); });
    $("pw-speed").addEventListener("change", function () { self.speed = +$("pw-speed").value; if (self.speed && !self.on) self.power(true); });
    $("pw-day").addEventListener("click", function () { if (self.running) self.stopDay(); else self.runDay(); });
    $("pw-site").addEventListener("click", function () { self.dialogs.site(); });
    $("pw-wizard").addEventListener("click", function () { self.dialogs.wizard(); });
    $("pw-costs").addEventListener("click", function () { self.dialogs.costs(); });
    $("pw-print").addEventListener("click", function () { W.PrintShop.open(self); });
    $("pw-pin").addEventListener("click", function () { self.pin(); });
    $("pw-ai").addEventListener("click", function () { self.showSide("ai"); $("pa-q").focus(); });
    $("pw-undo").addEventListener("click", function () { self.undo(); }); $("pw-redo").addEventListener("click", function () { self.undo(true); });
    $("pw-zin").addEventListener("click", function () { self.view.zoomBy(1.25); }); $("pw-zout").addEventListener("click", function () { self.view.zoomBy(0.8); });
    $("pw-fit").addEventListener("click", function () { self.view.fit(); });
    $("pw-fs").addEventListener("click", function () { var el = document.documentElement; if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen(); document.body.classList.toggle("pw-full"); });
    $("pw-new").addEventListener("click", function () { if (self.dirty) self.save(); location.href = self.cfg.newUrl; });
    var sel = $("pw-plans"); if (sel) sel.addEventListener("change", function () { if (self.dirty) self.save(); location.href = self.cfg.openUrl.replace("00000000-0000-0000-0000-000000000000", sel.value); });
    document.querySelectorAll("#pw-side-tabs button").forEach(function (b) { b.addEventListener("click", function () { self.showSide(b.getAttribute("data-side")); }); });
    $("pw-panels").addEventListener("click", function () { document.body.classList.toggle("side-open"); });
    root.addEventListener("beforeunload", function () { if (self.dirty) self.save(true); });
    document.addEventListener("keydown", function (e) {
      var tag = (e.target.tagName || "").toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (tag === "input" || tag === "textarea" || tag === "select" || document.querySelector("dialog[open]")) return;
      if (mod && /^z$/i.test(e.key)) { e.preventDefault(); self.undo(e.shiftKey); }
      else if (mod && /^y$/i.test(e.key)) { e.preventDefault(); self.undo(true); }
      else if (mod && /^d$/i.test(e.key)) { e.preventDefault(); self.duplicate(); }
      else if (mod && /^s$/i.test(e.key)) { e.preventDefault(); self.dirty = true; self.save(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); self.removeSelected(); }
      else if (e.key === " ") { e.preventDefault(); self.power(!self.on); }
      else if (e.key === "f" || e.key === "F") self.view.fit();
      else if (e.key === "Escape") { self.view.wiring = null; if (self.testers.tool) self.testers.pick(null); else self.view.select([]); }
      else if (/^Arrow/.test(e.key) && self.view.selected().length) {
        e.preventDefault();
        var dx = e.key === "ArrowLeft" ? -10 : e.key === "ArrowRight" ? 10 : 0, dy = e.key === "ArrowUp" ? -10 : e.key === "ArrowDown" ? 10 : 0;
        self.edit(function (doc) { self.view.selected().forEach(function (id) { var p = W.partById(doc, id); if (p) { p.x += dx; p.y += dy; } }); });
      }
    });
    W.AI.bind(this);
  };

  App.prototype.pin = function () {
    var self = this, cfg = this.cfg;
    if (!this.doc.parts.length) { this.toast("There is nothing to pin yet."); return; }
    this.view.png(function (blob) {
      if (!blob) { self.toast("Couldn't make the picture."); return; }
      var fd = new FormData(); fd.append("file", blob, "plan.png");
      fetch(cfg.pinUrl, { method: "POST", credentials: "same-origin", headers: { "X-CSRFToken": cfg.csrf }, body: fd })
        .then(function (r) { return r.json(); }).then(function (j) { self.toast(j.ok ? "Pinned to page " + (j.page + 1) + " of the board." : j.error || "Couldn't pin it.", j.ok ? "" : "warn"); })
        .catch(function () { self.toast("Couldn't reach the board.", "warn"); });
    });
  };

  W.boot = function () {
    var el = document.getElementById("power-config");
    if (!el) return;
    W.app = new App(JSON.parse(el.textContent));
  };
  if (typeof document !== "undefined") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", W.boot); else W.boot(); }
})(typeof window !== "undefined" ? window : globalThis);
