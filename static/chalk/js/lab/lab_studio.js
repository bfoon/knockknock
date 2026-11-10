/* Chalk Circuit Lab — the studio.
 *
 * One project, three places to work on it:
 *
 *   Bench     build the circuit and try it (everything the lab already did)
 *   Board     the same circuit as a printed circuit board (lab_pcb.js)
 *   Body      the shell it lives in, in 3-D, test-driven and 3-D printed
 *             (lab_body.js, lab_body_view.js)
 *
 * They are views of one document, so a part deleted on the bench leaves
 * the board and the body too, and Undo works across all three.
 *
 * And the project designer: say what you want to make — "a toy car that
 * turns away from walls" — and it designs the circuit, writes the program,
 * lays out the board and builds a body round it. With an AI key on the
 * server the design comes from the AI; without one — or whenever you would
 * rather browse — from the shelf of worked projects in lab_projects.js,
 * so a class is never left with a button that does nothing.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var esc = L.esc;

  function $(id) { return document.getElementById(id); }

  function Studio(app) {
    var self = this;
    this.app = app;
    this.space = "bench";
    var wrap = document.querySelector(".bench-wrap");
    this.pcbHost = document.createElement("div");
    this.pcbHost.className = "st-host pcb-host"; this.pcbHost.hidden = true;
    this.bodyHost = document.createElement("div");
    this.bodyHost.className = "st-host body-host"; this.bodyHost.hidden = true;
    wrap.insertBefore(this.bodyHost, wrap.firstChild.nextSibling);
    wrap.insertBefore(this.pcbHost, this.bodyHost);
    this.pcb = new L.PcbView(app, this.pcbHost);
    this.body = new L.BodyView(app, this.bodyHost);
    var sw = $("lab-space");
    if (sw) sw.querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { self.setSpace(b.getAttribute("data-space")); }); });
    var pj = $("lab-project");
    if (pj) pj.addEventListener("click", function () { self.wizard(); });
  }
  L.Studio = Studio;

  Studio.prototype.active = function () { return this.space === "pcb" ? this.pcb : this.space === "body" ? this.body : null; };

  Studio.prototype.setSpace = function (space) {
    var app = this.app, b = document.body;
    if (space !== "pcb" && space !== "body") space = "bench";
    if (this.space === "body" && space !== "body" && this.body.driving) this.body.setDrive(false);
    this.space = space;
    ["space-bench", "space-pcb", "space-body"].forEach(function (c) { b.classList.remove(c); });
    b.classList.add("space-" + space);
    this.pcbHost.hidden = space !== "pcb";
    this.bodyHost.hidden = space !== "body";
    var sw = $("lab-space");
    if (sw) sw.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x.getAttribute("data-space") === space ? "true" : "false"); });
    app.bench.hoverMark(null);
    if (space === "pcb") { this.pcb.sync(); this.pcb.fit(); app.panels.inspect(app.bench.sel); }
    else if (space === "body") { this.body.sync(); if (!this.body.framed) { this.body.framed = true; this.body.frameAll(); } this.body.inspect(); app.panels.showSide("inspect"); }
    else { app.panels.inspect(app.bench.sel); app.bench.resize(); }
    app.drawer();
    if (app.layout && app.layout.st.view === "code") app.layout.setView("split");
  };

  /* The document changed (an edit, an undo, a new circuit). */
  Studio.prototype.refresh = function () {
    if (this.space === "pcb") this.pcb.sync();
    else if (this.space === "body") { this.body.sync(); this.body.inspect(); }
  };
  Studio.prototype.onSelect = function () { if (this.space === "pcb") this.pcb.render(); };
  Studio.prototype.frame = function (dt) { if (this.space === "body") this.body.frame(dt); };

  /* A row of the component list was clicked. True means "handled here". */
  Studio.prototype.pick = function (kind, id, fly) {
    var app = this.app;
    if (this.space === "pcb") {
      if (kind !== "part") return true;
      app.bench.select({ kind: "part", id: id });
      if (!app.doc.pcb || !app.doc.pcb.place[id]) app.toast("That one isn't on the board — it's part of the bench, not the circuit.");
      return true;
    }
    return false;
  };
  Studio.prototype.hover = function (kind, id) { if (this.space === "pcb") this.pcb.hoverMark(kind === "part" ? id : null); };

  /* Keys that would otherwise move things on a bench nobody can see. */
  Studio.prototype.key = function (e) {
    var app = this.app, sel = app.bench.sel, mod = e.ctrlKey || e.metaKey;
    if (this.space === "bench") return false;
    if (document.querySelector("dialog[open]")) return false;      /* Esc belongs to the dialog */
    if (mod && /^[zys]$/i.test(e.key)) return false;
    if (e.key === " ") return false;
    if (this.space === "pcb") {
      var id = sel && sel.kind === "part" ? sel.id : null, pl = id && app.doc.pcb && app.doc.pcb.place[id];
      if ((e.key === "r" || e.key === "R") && pl) { this.pcb.rotate(id); return true; }
      if (/^Arrow/.test(e.key) && pl) {
        var G = L.PCB.G, dx = e.key === "ArrowLeft" ? -G : e.key === "ArrowRight" ? G : 0, dy = e.key === "ArrowUp" ? -G : e.key === "ArrowDown" ? G : 0, pcbv = this.pcb;
        pcbv.edit(function () { pl.x = Math.round((pl.x + dx) * 1000) / 1000; pl.y = Math.round((pl.y + dy) * 1000) / 1000; L.PCB.grow(app.doc, pcbv.model); }, true);
        return true;
      }
      if (e.key === "f" || e.key === "F") { if (e.shiftKey) return false; this.pcb.fit(); return true; }
      if (e.key === "Escape") { app.bench.select(null); return true; }
      return /^(Delete|Backspace|r|R|d|D)$/.test(e.key) || /^Arrow/.test(e.key);
    }
    if (this.body.key(e)) return true;
    if (e.key === "f" || e.key === "F") { if (e.shiftKey) return false; this.body.frameAll(); return true; }
    return /^(Delete|Backspace|r|R|d|D|Escape)$/.test(e.key) || /^Arrow/.test(e.key);
  };

  /* The left drawer in the Body space. */
  Studio.prototype.drawer = function (box, tab) {
    if (this.space !== "body") return false;
    if (tab === "layers") this.body.layersDrawer(box); else this.body.shapesDrawer(box);
    return true;
  };
  Studio.prototype.drawerSync = function () {
    var self = this;
    if (this.space !== "body" || this.dsT) return;
    this.dsT = requestAnimationFrame(function () { self.dsT = 0; if (self.app.drawerTab === "layers") self.app.drawer(); });
  };

  /* ------------------------------------------------------- a body from AI */

  /* Build what the AI (or the shelf) described. Everything is checked:
   * unknown shapes are dropped and every number is clamped. */
  Studio.prototype.applyBody = function (spec) {
    var app = this.app, doc = app.doc, Body = L.Body, S = L.Solid;
    if (!spec || typeof spec !== "object") return 0;
    var kind = Body.TEMPLATES[spec.kind] ? spec.kind : "custom", wall = L.clamp(+spec.wall || 2, 1.2, 4);
    var num = function (v, lo, hi, d) { v = +v; return isFinite(v) ? L.clamp(Math.round(v * 10) / 10, lo, hi) : d; };
    var extra = [];
    (Array.isArray(spec.solids) ? spec.solids : []).slice(0, 80).forEach(function (q) {
      if (!q || !S.SHAPES[q.shape]) return;
      var is = /^(hull|attach|part|cut)$/.test(q.is) ? q.is : "attach";
      if (kind !== "custom" && is === "hull") is = "attach";       /* the pattern owns the shell */
      var s = Body.solid(String(q.name || S.SHAPES[q.shape]).slice(0, 40), q.shape, [num(q.x, -800, 800, 0), num(q.y, -800, 800, 0), num(q.z, -200, 1200, 20)],
        [num(q.sx, 0.5, 600, 30), num(q.sy, 0.5, 600, 30), num(q.sz, 0.5, 600, 30)],
        { rot: [num(q.rx, -360, 360, 0), num(q.ry, -360, 360, 0), num(q.rz, -360, 360, 0)], color: /^#[0-9a-fA-F]{6}$/.test(q.color || "") ? q.color : "#d4893a",
          op: is === "cut" ? "cut" : "add", group: is === "cut" ? "attach" : is, role: /^(wheelL|wheelR|prop|led)$/.test(q.role) ? q.role : "" });
      extra.push(s);
    });
    if (kind === "custom" && !extra.length) return 0;
    var self = this;
    this.body.edit(function () {
      var b = kind === "custom" ? Body.blank() : Body.make(kind, doc, wall);
      b.wall = wall;
      if (kind === "custom") {
        var drive = /^(wheels|prop|boat|rocket|none)$/.test(spec.drive) ? spec.drive : extra.some(function (s) { return /^wheel/.test(s.role || ""); }) ? "wheels" : extra.some(function (s) { return s.role === "prop"; }) ? "prop" : "none";
        b.drive = drive;
        var hull = extra.filter(function (s) { return s.group === "hull" && s.op !== "cut"; });
        if (hull.length) {
          var lo = 1e9, hi = -1e9, big = hull[0];
          hull.forEach(function (s) { lo = Math.min(lo, s.z - s.sz / 2); hi = Math.max(hi, s.z + s.sz / 2); if (s.sx * s.sy * s.sz > big.sx * big.sy * big.sz) big = s; });
          b.split = "z"; b.splitZ = Math.round((lo + hi) / 2);
          b.bay = { x: big.x, y: big.y, z: big.z - big.sz / 2 + wall, w: big.sx * 0.7, d: big.sy * 0.7, h: big.sz * 0.6 };
        }
        var wheels = extra.filter(function (s) { return /^wheel/.test(s.role || ""); });
        if (wheels.length) { b.wheel = wheels[0].sx; b.track = Math.max(40, 2 * Math.max.apply(null, wheels.map(function (s) { return Math.abs(s.y); }))); }
      }
      extra.forEach(function (s) { b.solids.push(s); });
      if (/^#[0-9a-fA-F]{6}$/.test(spec.color || "")) b.solids.forEach(function (s) { if (s.group === "hull" && s.op !== "cut") s.color = spec.color; });
      b.mounts = Body.automount(doc, b);
      doc.body = b;
      self.body.sel = null;
    });
    this.body.veh = { x: 0, y: 0, z: 0, yaw: 0, vz: 0, spinL: 0, spinR: 0, spinP: 0, dist: 0, top: 0 };
    this.body.frameAll();
    return doc.body.solids.length;
  };

  /* ------------------------------------------------------------ the wizard */

  var IDEAS = ["A car I can drive from my phone by Bluetooth", "A radio-controlled boat with a handset", "A submarine that dives and surfaces", "A rocket with a countdown", "A burglar alarm for a model house", "A desk pet that waves at me"];

  Studio.prototype.wizard = function (preset) {
    var self = this, app = this.app, d = document.createElement("dialog");
    d.className = "dlg st-wizard";
    d.innerHTML = '<form method="dialog" class="dlg-top"><h2>Design a project</h2><button value="close" aria-label="Close">×</button></form>' +
      '<div class="wz-body">' +
      '<p class="wz-lede">Say what you want to make. You get the circuit, the program, the circuit board and a body to 3-D print — all in one go, all yours to change.</p>' +
      '<label class="sr" for="wz-q">What do you want to make?</label>' +
      '<textarea id="wz-q" rows="3" placeholder="e.g. a toy car with headlights that stops before it hits a wall">' + esc(preset || "") + '</textarea>' +
      '<div class="wz-ideas">' + IDEAS.map(function (t) { return '<button type="button" data-idea="' + esc(t) + '">' + esc(t) + '</button>'; }).join("") + '</div>' +
      '<details class="wz-shelf"' + (app.cfg.aiEnabled ? '' : ' open') + '><summary>Or pick one of ' + L.PROJECTS.length + ' worked projects</summary>' +
        '<div class="wz-cats" role="group" aria-label="Kind of project"><button type="button" data-cat="" aria-pressed="true">All</button>' +
          L.PROJECT_CATS.map(function (c) { return '<button type="button" data-cat="' + esc(c) + '" aria-pressed="false">' + esc(c) + '</button>'; }).join("") + '</div>' +
        '<div class="wz-grid" id="wz-grid"></div></details>' +
      '<ol class="wz-steps" hidden><li data-step="design">Designing the circuit and the program</li><li data-step="bench">Building it on the bench</li><li data-step="pcb">Laying out and routing the circuit board</li><li data-step="body">Building the body round it</li></ol>' +
      '<p class="wz-note" hidden></p>' +
      '<div class="ask-actions"><span class="fine">' + (app.cfg.aiEnabled ? "Designed by the AI on this server. Check its work before you build it for real." : "The AI isn't switched on for this server, so designs come from the lab's shelf of worked projects.") + '</span>' +
      '<button type="button" class="primary" id="wz-go">Design it</button></div></div>';
    document.body.appendChild(d);
    d.addEventListener("close", function () { d.remove(); });
    var q = d.querySelector("#wz-q"), go = d.querySelector("#wz-go"), steps = d.querySelector(".wz-steps"), note = d.querySelector(".wz-note");
    d.querySelectorAll("[data-idea]").forEach(function (b) { b.addEventListener("click", function () { q.value = b.getAttribute("data-idea"); q.focus(); shelf(); }); });
    /* the shelf: filtered by its category buttons and by whatever is typed */
    var cat = "", grid = d.querySelector("#wz-grid");
    var shelf = function () {
      var text = q.value.trim(), list = text ? L.matchProjects(text) : L.PROJECTS;
      if (text && !list.length) list = L.PROJECTS;
      list = list.filter(function (p) { return !cat || p.cat === cat; });
      grid.innerHTML = list.length ? list.map(function (p) {
        return '<button type="button" class="wz-card" data-project="' + p.id + '"><b>' + esc(p.name) + '</b><span>' + esc(p.blurb) + '</span><i>' + esc(p.cat) + ' · ' + esc(L.Body.TEMPLATES[p.body].name) + '</i></button>';
      }).join("") : '<p class="hint">Nothing on the shelf under that heading matches. Try another heading, or fewer words.</p>';
      grid.querySelectorAll("[data-project]").forEach(function (b) {
        b.addEventListener("click", function () { var r = L.shelfProject(b.getAttribute("data-project")); q.value = r.title; run(r); });
      });
    };
    d.querySelectorAll("[data-cat]").forEach(function (b) {
      b.addEventListener("click", function () {
        cat = b.getAttribute("data-cat");
        d.querySelectorAll("[data-cat]").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        shelf();
      });
    });
    q.addEventListener("input", function () { clearTimeout(q.t); q.t = setTimeout(shelf, 180); });
    var mark = function (name, state) { var li = steps.querySelector('[data-step="' + name + '"]'); if (li) li.setAttribute("data-state", state); };
    var run = function (picked) {
      var text = q.value.trim();
      if (!text) { q.focus(); return; }
      go.disabled = true; q.disabled = true; steps.hidden = false; note.hidden = true;
      d.querySelector(".wz-ideas").hidden = true; d.querySelector(".wz-shelf").hidden = true;
      mark("design", "doing");
      /* a project picked off the shelf is already designed */
      (picked && picked.circuit ? Promise.resolve(picked) : self.design(text)).then(function (res) {
        mark("design", "done");
        return self.construct(res, text, mark).then(function (sum) {
          note.hidden = false;
          note.innerHTML = L.md(res.reply || "") + '<p class="wz-sum">' + esc(sum) + '</p>';
          go.hidden = true;
          var act = d.querySelector(".ask-actions");
          act.innerHTML = '<button type="button" data-open="bench">Open the bench</button><button type="button" data-open="pcb">Open the board</button><button type="button" class="primary" data-open="body">See it in 3-D</button>';
          act.querySelectorAll("[data-open]").forEach(function (b) { b.addEventListener("click", function () { d.close(); self.setSpace(b.getAttribute("data-open")); }); });
          app.sound("win");
        });
      }).catch(function (e) {
        if (root.console) console.error(e);
        note.hidden = false; note.innerHTML = '<span class="bad">' + esc((e && e.message) || "That didn't work. Try describing it another way.") + '</span>';
        go.disabled = false; q.disabled = false; d.querySelector(".wz-shelf").hidden = false;
      });
    };
    go.addEventListener("click", function () { run(); });
    shelf();
    q.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(); });
    d.showModal();
    q.focus();
  };

  /* Ask for a design. Always resolves with something buildable. */
  Studio.prototype.design = function (text) {
    var app = this.app, local = function (why) { var r = L.localProject(text); if (why) r.reply = "_" + why + " Here is the nearest project from the lab's own shelf._\n\n" + r.reply; return r; };
    var usable = function (j) { return j && j.circuit && j.circuit.parts && j.circuit.parts.length >= 2; };
    var payload = { kind: "project", question: text, mode: "pro", circuit: { parts: [], nets: [] }, code: "" };
    if (!app.cfg.aiEnabled) return new Promise(function (res) { setTimeout(function () { res(local("")); }, 400); });
    var ask = L.aiTransport ? L.aiTransport(payload) : fetch(app.cfg.aiUrl, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": app.cfg.csrf }, body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { if (r.status !== 200 || !j.ok) throw { friendly: j && j.error }; return j; }); });
    return ask.then(function (j) { return usable(j) ? j : local("The AI answered, but not with a circuit that could be built."); },
                    function (e) { return local((e && e.friendly) || "The AI didn't answer."); });
  };

  /* Lay a designed circuit out on the bench when it came without places:
   * the board on the left, everything else flowing in rows beside it,
   * each part given the room its own picture needs. */
  L.layoutCircuit = function (c) {
    var P = L.P, list = (c.parts || []).filter(function (p) { return p && L.PARTS[p.type]; });
    if (!list.length || list.every(function (p) { return isFinite(p.x) && isFinite(p.y); })) return c;
    var box = function (p) { return L.boxOf({ type: p.type, x: 0, y: 0, rot: 0, props: p.props || {} }); };
    var boards = list.filter(function (p) { return L.PARTS[p.type].mcu; }), rest = list.filter(function (p) { return !L.PARTS[p.type].mcu; });
    var y = 0, left = 0;
    boards.forEach(function (p) { var b = box(p); p.x = L.snap(-b.x); p.y = L.snap(y - b.y); y += b.h + 4 * P; left = Math.max(left, b.w); });
    var x0 = left ? left + 6 * P : 0, cx = x0, cy = 0, rowH = 0, wide = Math.max(44 * P, Math.sqrt(rest.length) * 13 * P);
    rest.forEach(function (p) {
      var b = box(p);
      if (cx > x0 && cx + b.w > x0 + wide) { cx = x0; cy += rowH + 4 * P; rowH = 0; }
      p.x = L.snap(cx - b.x); p.y = L.snap(cy - b.y);
      cx += b.w + 4 * P; rowH = Math.max(rowH, b.h);
    });
    return c;
  };

  /* Turn a design into a project: bench, board, body. */
  Studio.prototype.construct = function (res, text, mark) {
    var self = this, app = this.app, PCB = L.PCB;
    mark = mark || function () {};
    var pause = function () { return new Promise(function (r) { setTimeout(r, 260); }); };
    var title = (res.title || text).replace(/\s+/g, " ").trim().slice(0, 60);
    title = title.charAt(0).toUpperCase() + title.slice(1);
    mark("bench", "doing");
    return pause().then(function () {
      if (app.doc.parts.length) { if (app.dirty) app.save(); app.replaceDoc(L.blankDoc("pro"), title, true); }
      else { app.title = title; $("lab-title").value = title; }
      if (self.space !== "bench") self.setSpace("bench");
      var n = app.buildFrom(L.layoutCircuit(res.circuit));
      if (!n) throw new Error("The design used parts this lab doesn't have. Try describing it another way.");
      if (res.code && String(res.code).trim()) app.useCode(String(res.code));
      /* several boards, each with its own program (a car and its handset) */
      var progs = res.programs && typeof res.programs === "object" ? res.programs : {}, made = app.built || {}, boards = 0;
      Object.keys(progs).forEach(function (old) {
        var part = made[old];
        if (!part || !L.def(part).mcu || typeof progs[old] !== "string") return;
        app.doc.programs = app.doc.programs || {};
        app.doc.programs[part.id] = { code: progs[old], blocks: null, prog: "code" };
        boards++;
      });
      if (boards > 1 && app.mcuId && app.doc.programs[app.mcuId]) {
        app.doc.code = app.doc.programs[app.mcuId].code; app.doc.prog = "code";
        app.loadProgram(); app.boardPicker();
      }
      mark("bench", "done"); mark("pcb", "doing");
      return pause().then(function () {
        var model = PCB.model(app.doc, app.sim);
        PCB.ensure(app.doc, model);
        var routed = PCB.route(app.doc, model);
        mark("pcb", routed.open.length ? "warn" : "done"); mark("body", "doing");
        return pause().then(function () {
          var shapes = self.applyBody(res.body && typeof res.body === "object" ? res.body : { kind: "box" });
          if (!shapes) shapes = self.applyBody({ kind: "box" });
          mark("body", "done");
          app.changed();
          self.setSpace("body");
          self.body.frameAll();
          var rep = PCB.report(app.doc, model), misfit = L.Body.fit(app.doc, app.doc.body);
          return n + " parts on the bench · a " + rep.w.toFixed(0) + " × " + rep.h.toFixed(0) + " mm board, " + (rep.open ? rep.open + " connection" + (rep.open > 1 ? "s" : "") + " still to route by hand" : "fully routed") +
            " · a body of " + shapes + " shapes" + (misfit.length ? " (some electronics stick out — press Resize to fit)" : " that everything fits inside") + "." +
            (boards > 1 ? " It has " + boards + " boards, each with its own program: pick one under “Program for” to read it." : "") +
            (app.doc.parts.some(function (p) { return p.type === "hc05"; }) ? " To use the phone: switch the power on, open the Phone tab on the right and tap Connect." : "") +
            (app.doc.parts.some(function (p) { return p.type === "rf_remote"; }) ? " The key fob is on the Bench: press its buttons there." : "") +
            " Press ▶ Test drive to try it.";
        });
      });
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
