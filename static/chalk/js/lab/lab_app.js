/* Chalk Circuit Lab — the app.
 *
 * Holds the document, the simulator and the program, and keeps the bench
 * and the panels in step with them. Every edit goes through edit() so it
 * can be undone, re-simulated and saved; every frame steps the physics,
 * runs the program and paints the bench.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var P = L.P;

  function $(id) { return document.getElementById(id); }

  function App(cfg) {
    var self = this;
    this.cfg = cfg || {};
    this.doc = normalise(cfg.data) || L.blankDoc(cfg.mode || (function () { try { return root.localStorage.getItem("chalklab.mode"); } catch (e) { return null; } })() || "pro");
    this.circuitId = cfg.circuitId || null;
    this.title = cfg.title || this.doc.name || "Untitled circuit";
    this.history = new L.History(80);
    this.sim = new L.Sim();
    this.sim.load(this.doc);
    this.sim.wallClock = function () { return performance.now() / 1000; };
    this.running = false;
    this.rt = null;
    this.lineMap = null;
    this.problemsExtra = [];
    /* read the saved camera before the bench exists: building it applies a
     * default view, which would otherwise overwrite "fit on open" */
    var view = this.doc.view && this.doc.view.z > 0 ? { x: this.doc.view.x, y: this.doc.view.y, z: this.doc.view.z } : null;

    this.mcuId = null;
    this.syncBoards(true);

    this.bench = new L.Bench($("bench"), this);
    this.panels = new L.Panels(this);
    this.kid = new L.Kid(this);
    this.layout = new L.Layout(this);
    this.copilot = new L.Copilot(this);
    this.phone = new L.Phone(this);
    this.workshop = new L.Workshop(this);
    this.sound = makeSound(this);
    this.layers = new L.Layers(this);
    this.studio = new L.Studio(this);
    this.drawerTab = "add";
    this.bindTop();
    this.drawer();
    this.setMode(this.doc.mode, true);
    this.bench.render();
    this.loadProgram();
    this.boardPicker();
    if (view) { this.bench.cam = view; this.bench.applyCam(); }
    else { this.needFit = true; this.bench.resize(); }
    this.keys();
    this.saveState(this.circuitId ? "saved" : "unsaved", this.circuitId ? null : "Not saved yet");
    var last = performance.now(), tickT = 0, kidT = 0;
    var loop = function (now) {
      var dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      try { self.frame(dt); } catch (e) { if (root.console) console.error(e); }
      tickT += dt; kidT += dt;
      if (tickT > 0.15) { tickT = 0; self.panels.tick(); self.layout.tick(); }
      if (kidT > 0.2) { kidT = 0; if (self.doc.mode === "kid") self.kid.tick(); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    root.addEventListener("beforeunload", function (e) { if (self.dirty) { self.save(true); e.preventDefault(); e.returnValue = ""; } });
  }
  L.App = App;

  function normalise(d) {
    if (!d || typeof d !== "object" || !Array.isArray(d.parts)) return null;
    d.wires = Array.isArray(d.wires) ? d.wires : [];
    d.parts = d.parts.filter(function (p) { return p && L.PARTS[p.type]; });
    d.mode = d.mode === "kid" ? "kid" : "pro";
    d.code = typeof d.code === "string" ? d.code : "";
    d.prog = d.prog === "blocks" ? "blocks" : "code";
    if (!d.pcb || typeof d.pcb !== "object" || !d.pcb.place) delete d.pcb;
    if (!d.body || typeof d.body !== "object" || !Array.isArray(d.body.solids)) delete d.body;
    return d;
  }

  /* --------------------------------------------------------- lookups */

  App.prototype.partById = function (id) { for (var i = 0; i < this.doc.parts.length; i++) if (this.doc.parts[i].id === id) return this.doc.parts[i]; return null; };
  App.prototype.wireById = function (id) { for (var i = 0; i < this.doc.wires.length; i++) if (this.doc.wires[i].id === id) return this.doc.wires[i]; return null; };

  /* ----------------------------------------------------------- edits */

  App.prototype.beginEdit = function () { this.history.push(this.doc); };
  App.prototype.commitEdit = function () {
    this.sim.invalidate();
    this.bench.indexPins();
    this.bench.renderSel();
    this.changed();
    if (this.studio) this.studio.refresh();
  };
  App.prototype.edit = function (fn) {
    this.history.push(this.doc);
    fn();
    this.refresh();
  };
  App.prototype.refresh = function () {
    this.syncBoards();
    if (this.phone) this.phone.refresh();
    this.bench.render();
    this.sim.invalidate();
    this.panels.inspect(this.bench.sel);
    this.changed();
    if (this.studio) this.studio.refresh();
    if (this.layers) this.layers.sync();
  };
  App.prototype.changed = function () {
    this.dirty = true;
    this.saveState("unsaved");
    clearTimeout(this.saveT);
    var self = this;
    this.saveT = setTimeout(function () { self.save(); }, 1400);
  };
  App.prototype.undo = function () { this.restore(this.history.undo(this.doc)); };
  App.prototype.redo = function () { this.restore(this.history.redo(this.doc)); };
  App.prototype.restore = function (snap) {
    if (!snap) { this.toast("Nothing to undo."); return; }
    var d = this.doc;
    d.parts = snap.parts; d.wires = snap.wires; d.code = snap.code; d.blocks = snap.blocks; d.prog = snap.prog;
    if (snap.pcb) d.pcb = snap.pcb; else delete d.pcb;
    if (snap.body) d.body = snap.body; else delete d.body;
    this.bench.sel = null;
    this.refresh();
    this.panels.code.set(d.code || "");
    if (d.blocks) this.panels.blocks.setProgram(d.blocks);
  };

  App.prototype.addPart = function (type, x, y) {
    var d = L.PARTS[type];
    if (!d) return null;
    var p = { id: L.uid("p"), type: type, x: L.snap(x), y: L.snap(y), rot: 0, props: {} };
    var self = this;
    this.edit(function () {
      if (d.layer === "board") self.doc.parts.unshift(p); else self.doc.parts.push(p);
    });
    this.bench.select({ kind: "part", id: p.id });
    this.sound("snap");
    if (this.doc.mode === "kid" && d.mcu && !this.doc.blocks) this.useBlocks();
    return p;
  };

  App.prototype.setProp = function (part, k, v, live) {
    var key = part.id + ":" + k;
    if (!live || this.lastProp !== key || Date.now() - this.lastPropT > 1500) this.history.push(this.doc);
    this.lastProp = key; this.lastPropT = Date.now();
    part.props = part.props || {};
    part.props[k] = v;
    this.bench.renderPart(part);
    var sp = (L.def(part).spec || []).filter(function (s) { return s.k === k; })[0];
    if (sp && sp.rebuild) { this.sim.invalidate(); this.bench.indexPins(); this.bench.refreshWiresOf([part.id]); }
    this.bench.renderSel();
    this.changed();
    if (this.layers && !live) this.layers.sync();
  };

  App.prototype.partAction = function (part, act) {
    var self = this;
    switch (act) {
      case "rotate": this.edit(function () { part.rot = ((part.rot || 0) + 1) % 4; }); break;
      case "flip": this.edit(function () { part.flip = !part.flip; }); break;
      case "dupe": {
        var c = JSON.parse(JSON.stringify(part));
        c.id = L.uid("p"); c.x += 3 * P; c.y += 3 * P;
        this.edit(function () { self.doc.parts.push(c); });
        this.bench.select({ kind: "part", id: c.id });
        break;
      }
      case "repair": delete this.sim.state[part.id]; this.sim.invalidate(); this.toast("Replaced with a fresh one."); this.panels.inspect(this.bench.sel); break;
      case "delete": this.deleteSel(); break;
    }
  };

  App.prototype.deleteSel = function () {
    var s = this.bench.sel, self = this;
    if (!s) return;
    this.edit(function () {
      if (s.kind === "wire") self.doc.wires = self.doc.wires.filter(function (w) { return w.id !== s.id; });
      else {
        var part = self.partById(s.id);
        self.doc.parts = self.doc.parts.filter(function (p) { return p.id !== s.id; });
        /* wires that were clipped to this part go with it */
        self.doc.wires = self.doc.wires.filter(function (w) {
          return !((w.a.ref || "").split(":")[0] === s.id || (w.b.ref || "").split(":")[0] === s.id);
        });
        if (part && L.def(part).mcu && part.id === self.mcuId) self.stopProgram();
      }
    });
    this.bench.select(null);
  };

  /* Wire colour by what it joins: red to +, black to ground, otherwise the
   * next colour along, so neighbouring wires are easy to tell apart. */
  App.prototype.wireColor = function (a, b) {
    var C = L.WIRE_COLORS, isGnd = function (q) { return /^(GND\d?|-|K|COM\d?)$/.test(q.name) || /^(tn|bn)\d/.test(q.name); };
    var isPos = function (q) { return /^(\+|5V|3V3|VCC|V\+|VIN|\+V)$/.test(q.name) || /^(tp|bp)\d/.test(q.name); };
    if (isGnd(a) || isGnd(b)) return C.black;
    if (isPos(a) || isPos(b)) return C.red;
    var cycle = [C.yellow, C.green, C.blue, C.orange, C.purple, C.white];
    this.wireN = (this.wireN || 0) + 1;
    return cycle[this.wireN % cycle.length];
  };

  App.prototype.press = function (part) { this.sim.pressed[part.id] = true; this.sound("tick"); };
  App.prototype.release = function (part) { delete this.sim.pressed[part.id]; };
  App.prototype.pressKey = function (key) { this.sim.pressed[key] = true; this.sound("tick"); };
  App.prototype.releaseKey = function (key) { delete this.sim.pressed[key]; };
  App.prototype.clickPart = function (part) {
    var d = L.def(part), self = this;
    if (d.toggle) { this.setProp(part, d.toggle, !L.propsOf(part)[d.toggle]); this.sound("click"); this.panels.inspect(this.bench.sel); }
    else if (d.cycle) {
      var list = d.cycle.values, cur = L.propsOf(part)[d.cycle.k];
      this.setProp(part, d.cycle.k, list[(list.indexOf(cur) + 1) % list.length]);
      this.sim.invalidate();
      this.panels.inspect(this.bench.sel);
    }
  };
  App.prototype.focusPart = function (id) {
    var p = this.partById(id);
    if (!p) return;
    var b = L.boxOf(p);
    this.bench.cam.x = b.x + b.w / 2; this.bench.cam.y = b.y + b.h / 2;
    this.bench.cam.z = Math.max(this.bench.cam.z, 1.2);
    this.bench.applyCam();
    this.bench.select({ kind: "part", id: id });
    this.bench.ripple(L.pinsOf(p)[0].key, null, "#ff8a5a");
  };
  App.prototype.onSelect = function (sel) {
    if (sel && sel.kind === "part" && sel.id !== this.mcuId) {
      var p = this.partById(sel.id);
      if (p && L.def(p).mcu && L.mcus(this.doc).length > 1) this.switchBoard(sel.id);
    }
    if (this.studio && this.studio.space === "body") { if (this.layers) this.layers.sync(); return; }
    this.panels.inspect(sel);
    if (this.layers) this.layers.sync();
    if (this.studio) this.studio.onSelect(sel);
    if (sel && this.panels.sideTab && this.panels.sideTab !== "inspect" && this.panels.sideTab !== "mission") this.panels.showSide("inspect");
  };

  /* ----------------------------------------------------------- boards
   * Every microcontroller has its own program in doc.programs. The one
   * being edited also lives in doc.code / doc.blocks / doc.prog, which is
   * what the editors read and what older saved circuits contain. */

  App.prototype.currentMcu = function () { return this.mcuId ? this.partById(this.mcuId) : null; };
  App.prototype.boardLabel = function (part) {
    var list = L.mcus(this.doc), d = L.def(part), same = list.filter(function (p) { return p.type === part.type; });
    return d.name + (same.length > 1 ? " " + (same.indexOf(part) + 1) : "");
  };
  App.prototype.storeProgram = function () {
    var d = this.doc;
    if (!this.mcuId) return;
    d.programs = d.programs || {};
    d.programs[this.mcuId] = { code: d.code || "", blocks: d.blocks || null, prog: d.prog || "code" };
  };
  /* Make sure the board being edited exists, and every board has a slot. */
  App.prototype.syncBoards = function (first) {
    var d = this.doc, list = L.mcus(d), self = this;
    d.programs = d.programs && typeof d.programs === "object" ? d.programs : {};
    Object.keys(d.programs).forEach(function (id) { if (!list.some(function (p) { return p.id === id; })) delete d.programs[id]; });
    if (this.mcuId && !list.some(function (p) { return p.id === self.mcuId; })) {
      this.mcuId = null;
      if (list.length) { this.switchBoard(list[0].id, true); return; }
    }
    if (!this.mcuId && list.length) {
      this.mcuId = d.current && list.some(function (p) { return p.id === d.current; }) ? d.current : list[0].id;
      /* the first board adopts whatever program was on the bench */
      if (d.programs[this.mcuId]) { var p = d.programs[this.mcuId]; d.code = p.code; d.blocks = p.blocks; d.prog = p.prog; }
      else this.storeProgram();
    }
    if (!first) this.boardPicker();
  };
  App.prototype.switchBoard = function (id, quiet) {
    if (id === this.mcuId) return;
    var d = this.doc;
    this.storeProgram();
    this.mcuId = id;
    var p = (d.programs || {})[id] || { code: "", blocks: null, prog: d.mode === "kid" ? "blocks" : "code" };
    d.code = p.code; d.blocks = p.blocks; d.prog = p.prog;
    this.lineMap = null;
    this.loadProgram();
    this.rt = (this.sim.runtimes || {})[id] || null;
    this.panels.progState(this.rt);
    this.panels.code.running(0);
    this.boardPicker();
    if (!quiet) this.toast("Now editing the program for " + this.boardLabel(this.partById(id)) + ".");
  };
  App.prototype.boardPicker = function () {
    var self = this, list = L.mcus(this.doc), ctl = document.querySelector(".prog-ctl");
    if (!ctl) return;
    var sel = $("p-board");
    if (list.length < 2) { if (sel) sel.parentNode.remove(); return; }
    if (!sel) {
      var wrap = document.createElement("label");
      wrap.className = "board-pick";
      wrap.innerHTML = '<span>Program for</span><select id="p-board"></select>';
      ctl.insertBefore(wrap, ctl.firstChild);
      sel = $("p-board");
      sel.addEventListener("change", function () { self.switchBoard(sel.value); });
    }
    sel.innerHTML = list.map(function (p) { return '<option value="' + p.id + '"' + (p.id === self.mcuId ? " selected" : "") + '>' + L.esc(self.boardLabel(p)) + '</option>'; }).join("");
  };

  /* ------------------------------------------------------------ power */

  App.prototype.power = function (on) {
    if (on === this.running) return;
    this.running = on;
    document.body.classList.toggle("powered", on);
    var b = $("lab-power");
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.querySelector("span").textContent = on ? "Power on" : "Power off";
    if (on) {
      this.layout.revealBench();
      this.sim.reset();
      this.sound("on");
      this.storeProgram();
      var progs = this.doc.programs || {};
      if (L.mcus(this.doc).some(function (b) { return progs[b.id] && (progs[b.id].code || "").trim(); })) this.runProgram(true);
    } else {
      this.stopProgram();
      this.sim.reset();
      if (this.phone) this.phone.drop();
      this.bench.flag([]);
      this.panels.narrate("");
    }
  };

  /* ---------------------------------------------------------- program */

  App.prototype.loadProgram = function () {
    var d = this.doc;
    if (d.prog === "blocks" && d.blocks) {
      var g = L.Blocks.generate(d.blocks, d.mode);
      d.code = g.code; this.lineMap = g.map;
    }
    this.panels.code.set(d.code || "");
    this.panels.code.readOnly(d.prog === "blocks");
    this.panels.blocks.setMode(d.mode);
    if (d.blocks) this.panels.blocks.setProgram(d.blocks);
    this.panels.showDock(d.prog === "blocks" || d.mode === "kid" ? "blocks" : "code");
    this.compileCheck();
  };

  App.prototype.useBlocks = function () {
    var d = this.doc;
    if (!d.blocks) d.blocks = L.Blocks.blank(d.mode);
    if ((d.code || "").trim() && d.prog !== "blocks") { this.panels.blocks.setProgram(d.blocks); this.panels.showDock("blocks"); return; }
    d.prog = "blocks";
    this.loadProgram();
  };

  App.prototype.codeChanged = function (v) {
    if (this.doc.prog === "blocks") return;
    this.doc.code = v;
    this.lineMap = null;
    this.changed();
    clearTimeout(this.ccT);
    var self = this;
    this.ccT = setTimeout(function () { self.compileCheck(); }, 500);
    if (this.rt && this.rt.running) this.panels.narrate('<span class="note">You changed the program. Press <b>Restart</b> to load the new version onto the board.</span>');
  };
  App.prototype.blocksChanged = function (prog) {
    var d = this.doc;
    if (d.prog !== "blocks" && (d.code || "").trim() && !this.blocksOk) {
      /* Typed code can't be turned back into blocks, so ask before the
       * blocks take over. Saying no keeps the blocks as a draft. */
      d.blocks = prog;
      if (this.asking || Date.now() - (this.declinedAt || 0) < 30000) return;
      var self = this;
      this.asking = true;
      L.confirmBox("Your program is typed code. Run the blocks instead? Your typed code is replaced by the blocks’ version — Undo brings it back.", "Use the blocks", "Keep my code")
        .then(function (ok) {
          self.asking = false;
          if (!ok) { self.declinedAt = Date.now(); self.toast("Your typed code stays in charge. The blocks are kept as a draft."); return; }
          self.blocksOk = true;
          self.history.push(d);
          self.blocksChanged(prog);
        });
      return;
    }
    d.blocks = prog; d.prog = "blocks";
    var g = L.Blocks.generate(prog, d.mode);
    d.code = g.code; this.lineMap = g.map;
    this.panels.code.set(d.code);
    this.panels.code.readOnly(true);
    this.changed();
    this.compileCheck();
    if (this.rt && this.rt.running) this.runProgram();   /* blocks restart straight away: that is what makes them feel live */
  };

  App.prototype.compileCheck = function () {
    var c = L.MCU.compile(this.doc.code || "");
    var box = $("code-errors");
    if (!(this.doc.code || "").trim()) { this.panels.code.setErrors([]); box.hidden = true; return c; }
    this.panels.code.setErrors(c.ok ? [] : c.errors);
    box.hidden = c.ok;
    if (!c.ok) box.innerHTML = c.errors.map(function (e) { return '<button type="button" data-line="' + e.line + '"><b>Line ' + e.line + '</b> ' + L.esc(e.msg) + '</button>'; }).join("");
    var self = this;
    box.querySelectorAll("[data-line]").forEach(function (b) { b.addEventListener("click", function () { self.panels.code.running(+b.getAttribute("data-line"), "err"); }); });
    if (!c.ok && this.copilot) this.copilot.decorateErrors(c.errors);
    return c;
  };

  App.prototype.runProgram = function (quiet) {
    var self = this, boards = L.mcus(this.doc);
    if (!boards.length) { this.toast(this.doc.mode === "kid" ? "Add the Robo Brain to the table first — it's the part that runs your blocks." : "Add an Arduino first: the program needs a board to run on."); return; }
    this.storeProgram();
    var c = this.compileCheck();
    var any = boards.some(function (b) { var p = self.doc.programs[b.id]; return p && (p.code || "").trim(); });
    if (!any) { if (!quiet) this.toast("Write a program first, or use Blocks."); return; }
    if ((this.doc.code || "").trim() && !c.ok) {
      this.panels.showDock(this.doc.prog === "blocks" ? "blocks" : "code");
      this.panels.narrate('<span class="bad">The program has ' + c.errors.length + ' problem' + (c.errors.length > 1 ? "s" : "") + ' — fix ' + (c.errors.length > 1 ? "them" : "it") + ' and press run again.</span>');
      this.sound("err");
      return;
    }
    this.layout.revealBench();
    if (!this.running) { this.power(true); return; }
    this.sim.detach();
    this.problemsExtra = [];
    var started = 0, broken = [];
    boards.forEach(function (b) {
      var p = self.doc.programs[b.id];
      if (!p || !(p.code || "").trim()) return;
      var cc = b.id === self.mcuId ? c : L.MCU.compile(p.code);
      if (!cc.ok) { broken.push(self.boardLabel(b)); return; }
      var rt = self.sim.attach(b.id, cc.prog, function (k, d) { self.onRuntime(k, d, b.id); });
      rt.setTrace(b.id === self.mcuId ? (parseFloat($("p-trace").value) || 0) : 0);
      if (b.id === self.mcuId) rt.breakpoints = self.panels.code.breaks;
      started++;
    });
    this.rt = this.sim.runtimes[this.mcuId] || null;
    this.panels.serial("\n— program" + (started > 1 ? "s" : "") + " started —\n", true);
    this.panels.progState(this.rt);
    if (broken.length) this.toast(broken.join(", ") + (broken.length > 1 ? " have" : " has") + " errors in " + (broken.length > 1 ? "their programs" : "its program") + " and didn't start. Pick it in “Program for” to see why.");
    this.panels.narrate(this.doc.mode === "kid" ? "The Robo Brain is following your blocks!" : started > 1 ? "Uploaded to " + started + " boards. Each runs its own program." : "Uploaded. The program is running from the top of setup().");
  };
  App.prototype.stopProgram = function () {
    this.sim.detach();
    this.rt = null;
    this.panels.progState(null);
    this.panels.code.running(0);
    this.panels.blocks.highlight(null);
  };
  App.prototype.togglePause = function () {
    if (!this.rt) return;
    if (this.rt.paused) this.rt.resume(); else this.rt.pause();
    this.panels.progState(this.rt);
  };
  App.prototype.step = function (kind) {
    if (!this.rt || !this.rt.running) {
      this.runProgram();
      if (this.rt) { this.rt.pause(); this.rt.step("line"); }
      return;
    }
    if (!this.rt.paused) { this.rt.pause(); return; }
    this.rt.step(kind);
  };
  App.prototype.setTrace = function (v) { if (this.rt) this.rt.setTrace(v); this.traceRate = v; };

  App.prototype.useCode = function (code) {
    var d = this.doc;
    this.history.push(d);
    d.code = code; d.prog = "code"; this.lineMap = null;
    this.panels.code.set(code);
    this.panels.code.readOnly(false);
    this.panels.showDock("code");
    this.compileCheck();
    this.changed();
    this.toast("Loaded into the editor. Press " + (d.mode === "kid" ? "Go!" : "Upload & run") + ".");
  };

  /* What the program is doing, translated onto the bench. */
  App.prototype.onRuntime = function (kind, d, boardId) {
    var rt = this.rt;
    if (boardId && boardId !== this.mcuId) {
      /* another board: its serial output and its pin activity, no narration */
      var label = this.boardLabel(this.partById(boardId) || { type: "arduino_uno" });
      if (kind === "serial") this.panels.serial(d.text, false, label);
      else if (kind === "effect") this.effect(d, boardId, true);
      else if (kind === "error") this.toast(label + " stopped on line " + d.line + ": " + d.msg);
      return;
    }
    switch (kind) {
      case "line": this.curLine = d.line; break;
      case "state": this.panels.progState(rt); if (rt && rt.paused && rt.pending) this.curLine = rt.line; break;
      case "serial": this.panels.serial(d.text, false, L.mcus(this.doc).length > 1 ? this.boardLabel(this.currentMcu()) : null); break;
      case "error":
        this.panels.code.running(d.line, "err");
        this.panels.narrate('<span class="bad"><b>Stopped on line ' + d.line + ':</b> ' + L.esc(d.msg) + '</span>');
        this.sound("err");
        if (this.doc.mode === "kid") this.kid.say("Oops, the Robo Brain got stuck: " + d.msg, "ouch", true);
        break;
      case "hint":
        if (!this.problemsExtra.some(function (p) { return p.msg === d.msg; })) this.problemsExtra.push({ part: this.mcuId, level: "warn", code: "hint", msg: "Line " + d.line + ": " + d.msg });
        this.toast(d.msg);
        break;
      case "effect": this.effect(d, this.mcuId); break;
      case "wait": if (rt && (rt.traceRate || d.s >= 0.25)) this.waitInfo = { until: performance.now() + d.s * 1000 / this.sim.timeScale, s: d.s, line: d.line }; break;
    }
  };

  App.prototype.effect = function (e, boardId, quiet) {
    var mcu = this.partById(boardId || this.mcuId);
    if (!mcu) return;
    var kid = mcu.type === "k_brain", name = e.pin != null ? L.pinName(e.pin) : null;
    if (kid && name) { for (var k in L.BRAIN_MAP) if (L.BRAIN_MAP[k] === name) name = k; }
    if (!kid && name && !this.pinAllHas(mcu.id + ":" + name)) name = null;
    var key = name ? mcu.id + ":" + name : null, label = kid && name ? name.replace(/(\d)$/, " $1") : name;
    var on = key ? L.describeNode(this, key) : "", text = null, bubble = null, col = "#ffd36b";
    switch (e.kind) {
      case "write": bubble = label + (e.value ? (kid ? " ON" : " HIGH") : (kid ? " OFF" : " LOW")); col = e.value ? "#ffd36b" : "#7fa7ff";
        text = "<b>" + label + "</b> → " + (e.value ? "HIGH: it now pushes out 5 V" : "LOW: it drops to 0 V") + (on ? ". Joined to " + on + "." : ". Nothing is wired to it."); break;
      case "pwm": bubble = label + " " + Math.round(e.value / 2.55) + "%";
        text = "<b>" + label + "</b> → PWM " + e.value + "/255: on " + Math.round(e.value / 2.55) + "% of the time" + (on ? ", driving " + on : "") + "."; break;
      case "read": bubble = label + " reads " + (e.value ? "HIGH" : "LOW"); col = "#7dffb0";
        text = "<b>" + label + "</b> is at " + e.volts.toFixed(2) + " V, so it reads " + (e.value ? "HIGH" : "LOW") + "."; break;
      case "aread": bubble = label + " = " + e.value; col = "#7dffb0";
        text = "<b>" + label + "</b> is at " + e.volts.toFixed(2) + " V → " + e.value + " out of 1023."; break;
      case "tone": bubble = e.value ? "♪ " + e.value + " Hz" : "♪ off"; text = "<b>" + label + "</b> → " + (e.value ? "tone " + e.value + " Hz" : "tone off") + "."; break;
      case "servo": bubble = "servo " + e.value + "°"; text = "Servo on <b>" + label + "</b> told to go to " + e.value + "°."; break;
      case "serial": text = "Sent to the Serial monitor: <code>" + L.esc(e.text.replace(/\n$/, "")) + "</code>"; break;
      case "lcd": text = "Screen shows <code>" + L.esc(e.text) + "</code>."; break;
      case "echo": bubble = "echo " + e.value + " µs"; text = "The echo took " + e.value + " µs — about " + Math.round(e.value / 58) + " cm."; break;
      case "mode": text = "<b>" + label + "</b> set to " + (e.mode === "OUT" ? "OUTPUT" : e.mode === "PU" ? "INPUT_PULLUP" : "INPUT") + "."; break;
    }
    /* At full speed hundreds of these happen a second; show them all only
     * when the program is crawling, or when something actually changed. */
    var slow = this.rt && (this.rt.traceRate > 0 || this.rt.paused);
    var changed = key && this.lastFx[key] !== bubble;
    if (key) this.lastFx[key] = bubble;
    if (key && bubble && (slow || changed)) this.bench.ripple(key, (slow || this.sim.timeScale < 1) ? bubble : (changed ? bubble : null), col);
    if (e.kind === "uart" && key) this.bench.ripple(key, (slow || this.sim.timeScale < 1) ? "TX " + e.text.replace(/\n$/, "").slice(0, 14) : null, "#7fd4ff");
    if (e.kind === "uart" && !quiet) text = "Sent <code>" + L.esc(e.text.replace(/\n$/, "")) + "</code> out of <b>" + label + "</b>" + (on ? " to " + on : "") + ".";
    if (quiet) return;
    if (text && (slow || changed || e.kind === "serial" || e.kind === "lcd" || e.kind === "uart")) this.panels.narrate('<span class="ln">Line ' + e.line + '</span> ' + text);
  };
  App.prototype.lastFx = {};
  App.prototype.pinAllHas = function (key) { return !!(this.bench.pinAll && this.bench.pinAll[key]); };

  /* "the 220 Ω resistor and the red LED" — what this pin's node touches. */
  L.describeNode = function (app, key) {
    var list = app.sim.neighbours(key), seen = {}, names = [];
    list.forEach(function (k) {
      var id = k.split(":")[0], p = app.partById(id);
      if (!p || seen[id] || L.def(p).mcu) return;
      seen[id] = 1;
      var d = L.def(p), pr = L.propsOf(p);
      names.push(p.type === "resistor" ? "the " + L.si(pr.ohms, "Ω") + " resistor" : p.type === "led" || p.type === "k_led" ? "the " + (L.LED_COLORS[pr.color] || {}).name.toLowerCase() + " LED" : "the " + d.name.toLowerCase().replace(/ \(.+\)$/, ""));
    });
    if (!names.length) return "";
    return names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
  };

  /* ------------------------------------------------------------ frame */

  App.prototype.frame = function (dt) {
    if (this.running) {
      this.sim.step(dt);
      this.bench.flag(this.sim.warnings);
    }
    if (!this.studio || this.studio.space === "bench") this.bench.frame(this.sim, dt, this.running);
    else this.studio.frame(dt);
    /* the running line */
    var rt = this.rt;
    if (rt && rt.running && !rt.error) {
      var kind = rt.paused ? "paused" : (this.waitInfo && performance.now() < this.waitInfo.until ? "wait" : "");
      var line = rt.paused && rt.pending ? rt.pending.line : this.curLine;
      if (rt.traceRate > 0 || rt.paused || this.sim.timeScale < 1 || kind === "wait") this.panels.code.running(line, kind);
      else this.panels.code.running(line, "fast");
      if (this.lineMap) this.panels.blocks.highlight(this.lineMap[line] || null);
      if (kind === "wait" && this.waitInfo) {
        var left = Math.max(0, (this.waitInfo.until - performance.now()) / 1000 * this.sim.timeScale);
        $("narrate").setAttribute("data-wait", left > 0.05 ? "waiting " + (left >= 1 ? left.toFixed(1) + " s" : Math.round(left * 1000) + " ms") : "");
      } else $("narrate").setAttribute("data-wait", "");
    }
    this.sound.update(this.running ? this.sim : null);
  };

  /* --------------------------------------------------------- problems */

  App.prototype.problems = function () {
    var self = this, out = [], doc = this.doc, sim = this.sim;
    if (this.running) out = out.concat(sim.warnings);
    if (sim.topoDirty || !sim.topo) sim.build();
    var T = sim.topo;
    doc.parts.forEach(function (p) {
      var d = L.def(p);
      if (!d || (d.layer === "board" && !d.mcu)) return;
      var pins = L.pinsOf(p);
      var joined = pins.filter(function (q) { return (T.terminals[T.find(q.key)] || 0) > 1; }).length;
      if (!joined) out.push({ part: p.id, level: "info", code: "loose", msg: (doc.mode === "kid" ? "This isn't joined to anything yet." : "Not connected to anything yet.") });
      else if (pins.length === 2 && joined === 1 && !/battery|coin|psu/.test(p.type)) out.push({ part: p.id, level: "info", code: "half", msg: "Only one leg is connected, so no current can flow through it. Current needs a way in and a way out." });
    });
    doc.wires.forEach(function (w) {
      var ends = T.wireEnds[w.id] || [];
      if (ends.some(function (k) { return k.indexOf("w:") === 0; })) out.push({ part: null, level: "info", code: "wire", msg: "A wire has an end that isn't in a hole or on a leg." });
    });
    if (doc.parts.length && !doc.parts.some(function (p) { return /battery|coin_cell|psu|arduino|k_brain/.test(p.type); }))
      out.push({ part: doc.parts[0].id, level: "warn", code: "nopower", msg: doc.mode === "kid" ? "There's no battery! Electricity needs something to push it." : "There's no power source on the bench." });
    return out.concat(this.problemsExtra);
  };

  /* What the AI gets: the parts, which legs share a node, and what the
   * simulator measured. Small, so it fits easily in a prompt. */
  App.prototype.digest = function () {
    var doc = this.doc, sim = this.sim, self = this;
    var parts = doc.parts.filter(function (p) { return !/^breadboard/.test(p.type); }).map(function (p) {
      var d = L.def(p), own = {};
      Object.keys(p.props || {}).forEach(function (k) { own[k] = p.props[k]; });
      return { id: p.id, type: p.type, name: d.name, props: own, pins: L.pinList(p).map(function (q) { return q.n; }) };
    });
    var nets = L.nets(doc, sim).map(function (n) { return n.map(function (k) { return k.replace(":", "."); }); }).filter(function (n) { return n.length > 1; });
    var readings = {};
    if (this.running) doc.parts.forEach(function (p) {
      var st = sim.state[p.id]; if (!st) return;
      var r = {};
      ["i", "v", "b", "w", "ang", "burnt", "hot", "text", "unit", "on"].forEach(function (k) { if (st[k] != null && typeof st[k] !== "object") r[k] = typeof st[k] === "number" ? Math.round(st[k] * 1e5) / 1e5 : st[k]; });
      if (Object.keys(r).length) readings[p.id] = r;
    });
    var probs = this.problems().map(function (x) { return { part: x.part, level: x.level, msg: x.msg }; });
    var out = { mode: doc.mode, parts: parts.slice(0, 120), nets: nets.slice(0, 200), powered: this.running, readings: readings, problems: probs.slice(0, 20),
                program: this.rt ? { running: this.rt.running, line: this.rt.line, error: this.rt.error } : null };
    if (doc.pcb && doc.pcb.w) out.board = { w: doc.pcb.w, h: doc.pcb.h, routed: (doc.pcb.tracks || []).length > 0, open: (doc.pcb.open || []).length };
    if (doc.body && doc.body.solids) {
      var need = L.Body.need(doc);
      out.body = { kind: doc.body.kind, drive: doc.body.drive, wall: doc.body.wall, electronics: { w: Math.round(need.w), d: Math.round(need.d), h: Math.round(need.h) },
                   solids: doc.body.solids.slice(0, 40).map(function (s) { return { name: s.name, shape: s.shape, is: s.op === "cut" ? "cut" : s.group, x: s.x, y: s.y, z: s.z, sx: s.sx, sy: s.sy, sz: s.sz }; }) };
    } else if (doc.parts.length) { var nd = L.Body.need(doc); out.electronics = { w: Math.round(nd.w), d: Math.round(nd.d), h: Math.round(nd.h) }; }
    return out;
  };

  /* Build what the AI designed. Everything it sends is checked: unknown
   * parts and pins are dropped, not trusted. */
  App.prototype.buildFrom = function (c) {
    var self = this, map = {}, added = 0;
    var b = L.boundsOf(this.doc), x0 = b.w ? b.x + b.w + 4 * P : 0, y0 = b.w ? b.y : 0, col = 0, row = 0;
    var parts = [], wires = [];
    (c.parts || []).slice(0, 60).forEach(function (p) {
      if (!p || !L.PARTS[p.type]) return;
      var d = L.PARTS[p.type], np = { id: L.uid("p"), type: p.type, rot: 0, props: {} };
      Object.keys(p.props || {}).forEach(function (k) { if (d.props && k in d.props) np.props[k] = p.props[k]; });
      if (isFinite(p.x) && isFinite(p.y)) { np.x = L.snap(x0 + p.x); np.y = L.snap(y0 + p.y); }
      else {
        var bb = L.boxOf({ type: p.type, x: 0, y: 0, rot: 0, props: np.props });
        np.x = L.snap(x0 + col * 14 * P - bb.x); np.y = L.snap(y0 + row * 14 * P - bb.y);
        col++; if (col > 3) { col = 0; row++; }
      }
      map[p.id] = np; parts.push(np); added++;
    });
    var pinOk = function (np, pin) { return np && L.pinList(np).some(function (q) { return q.n === pin; }); };
    (c.wires || []).slice(0, 160).forEach(function (w) {
      var a = String(w.a || "").split("."), z = String(w.b || "").split(".");
      var pa = map[a[0]], pb = map[z[0]];
      if (!pinOk(pa, a[1]) || !pinOk(pb, z[1])) return;
      var C = L.WIRE_COLORS, color = /^#[0-9a-fA-F]{6}$/.test(w.color || "") ? w.color : (C[w.color] || null);
      wires.push({ id: L.uid("w"), a: { ref: pa.id + ":" + a[1] }, b: { ref: pb.id + ":" + z[1] }, color: color || self.wireColor({ name: a[1] }, { name: z[1] }), pts: [] });
    });
    if (!added) return 0;
    this.edit(function () {
      parts.forEach(function (p) { if (L.PARTS[p.type].layer === "board") self.doc.parts.unshift(p); else self.doc.parts.push(p); });
      wires.forEach(function (w) { self.doc.wires.push(w); });
    });
    if (c.code) this.useCode(c.code);
    this.bench.fit();
    return added;
  };

  /* --------------------------------------------------------------- mode */

  App.prototype.setMode = function (mode, quiet) {
    var d = this.doc;
    d.mode = mode === "kid" ? "kid" : "pro";
    document.body.setAttribute("data-mode", d.mode);
    try { root.localStorage.setItem("chalklab.mode", d.mode); } catch (e) {}
    $("lab-mode").querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-mode") === d.mode ? "true" : "false"); });
    this.drawer();
    this.panels.aiQuick();
    if (this.copilot) this.copilot.blocksPlaceholder();
    this.panels.blocks.setMode(d.mode);
    if (d.mode === "kid") { if (this.panels.dockTab === "code" || this.panels.dockTab === "scope") this.panels.showDock("blocks"); }
    if (!quiet) {
      this.bench.render();
      this.changed();
      if (d.mode === "kid") this.kid.say("Hi! I'm Sparky. Drag a battery and a bulb onto the table and join them up in a loop!", "happy", true);
    }
    this.panels.progState(this.rt);
  };

  /* ------------------------------------------------------------- drawer */

  var CAT_ORDER = ["Toy box", "Boards", "Power", "Passive", "Lights & sound", "Switches", "Semiconductors", "Chips", "Sensors", "Motion", "Wireless", "Workshop", "Measure"];
  App.prototype.drawer = function () {
    var self = this, kid = this.doc.mode === "kid", box = $("lab-drawer"), q = (this.drawerQ || "").toLowerCase();
    var showAll = kid && this.kidAll;
    /* Two tabs: what you can add, and what is already there. The second
     * is the component list — or, in the Body space, the list of shapes. */
    var inBody = this.studio && this.studio.space === "body", tab = this.drawerTab === "layers" ? "layers" : "add";
    var count = inBody ? ((this.doc.body && this.doc.body.solids.length) || 0) : this.doc.parts.length + this.doc.wires.length;
    var tabs = '<div class="drawer-tabs" role="tablist"><button type="button" role="tab" data-dtab="add" aria-selected="' + (tab === "add") + '">' + (inBody ? "Shapes" : kid ? "Toy box" : "Parts") + '</button>' +
      '<button type="button" role="tab" data-dtab="layers" aria-selected="' + (tab === "layers") + '" title="Everything in the design, as a list you can pick from">Layers' + (count ? ' <span class="n">' + count + '</span>' : '') + '</button></div>';
    var bindTabs = function () {
      box.querySelectorAll("[data-dtab]").forEach(function (b) { b.addEventListener("click", function () { self.drawerTab = b.getAttribute("data-dtab"); self.drawer(); }); });
    };
    if (inBody || tab === "layers") {
      box.innerHTML = tabs + '<div class="drawer-body" id="drawer-body"></div>';
      bindTabs();
      if (inBody) this.studio.drawer($("drawer-body"), tab); else this.layers.render($("drawer-body"));
      return;
    }
    this.layers.box = null;
    var cats = {};
    L.PART_ORDER.forEach(function (t) {
      var d = L.PARTS[t];
      if (kid && !d.kid && !showAll) return;
      if (!kid && d.kid) return;
      if (q && (d.name + " " + d.blurb + " " + d.cat).toLowerCase().indexOf(q) < 0) return;
      (cats[d.cat] = cats[d.cat] || []).push(t);
    });
    var h = '<label class="drawer-search"><span class="sr">Find a part</span><input type="search" id="drawer-q" placeholder="' + (kid ? "Find a toy" : "Find a part — LED, relay, 555…") + '" value="' + L.esc(this.drawerQ || "") + '"></label>';
    CAT_ORDER.forEach(function (c) {
      if (!cats[c]) return;
      h += '<h3>' + L.esc(c) + '</h3><div class="drawer-grid">';
      cats[c].forEach(function (t) {
        var d = L.PARTS[t];
        h += '<button type="button" class="drawer-item" data-type="' + t + '" title="' + L.esc(d.blurb || "") + '">' + thumb(t) + '<span>' + L.esc(d.name) + '</span></button>';
      });
      h += '</div>';
    });
    if (kid) h += '<button type="button" class="drawer-more" id="drawer-more">' + (showAll ? "Just the toy box" : "Show grown-up parts too") + '</button>';
    if (!Object.keys(cats).length) h += '<p class="hint">Nothing matches “' + L.esc(q) + '”.</p>';
    box.innerHTML = tabs + h;
    bindTabs();
    var input = $("drawer-q");
    input.addEventListener("input", function () { self.drawerQ = input.value; self.drawer(); var i2 = $("drawer-q"); i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length); });
    var more = $("drawer-more");
    if (more) more.addEventListener("click", function () { self.kidAll = !self.kidAll; self.drawer(); });
    box.querySelectorAll(".drawer-item").forEach(function (it) {
      it.addEventListener("pointerdown", function (e) { self.dragNew(e, it.getAttribute("data-type"), it); });
    });
  };

  /* A little picture of each part for the drawer, from its own art. */
  var THUMBS = {};
  function thumb(type) {
    if (THUMBS[type]) return THUMBS[type];
    var d = L.PARTS[type], probe = { id: "t", type: type, x: 0, y: 0, rot: 0, props: {} };
    var b = L.boxOf(probe), pad = 6;
    var svg = '<svg viewBox="' + (b.x - pad) + " " + (b.y - pad) + " " + (b.w + pad * 2) + " " + (b.h + pad * 2) + '" aria-hidden="true">' + d.art(probe, L.propsOf(probe)) + '</svg>';
    THUMBS[type] = svg;
    return svg;
  }
  L.thumb = thumb;

  App.prototype.dragNew = function (e, type, src) {
    var self = this, x0 = e.clientX, y0 = e.clientY, ghost = null;
    e.preventDefault();
    var move = function (ev) {
      if (!ghost && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) {
        ghost = document.createElement("div");
        ghost.className = "drag-ghost";
        ghost.innerHTML = thumb(type);
        document.body.appendChild(ghost);
      }
      if (ghost) ghost.style.transform = "translate(" + (ev.clientX - 40) + "px," + (ev.clientY - 40) + "px)";
    };
    var up = function (ev) {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      var benchEl = $("bench"), r = benchEl.getBoundingClientRect();
      if (ghost) {
        ghost.remove();
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
          var wp = self.bench.toWorld(ev.clientX, ev.clientY), b = L.boxOf({ type: type, x: 0, y: 0, rot: 0, props: {} });
          self.addPart(type, wp.x - b.x - b.w / 2, wp.y - b.y - b.h / 2);
        }
      } else {
        /* a tap drops it in the middle of the view, nudged so repeated taps don't stack */
        var c = self.bench.cam, bb = L.boxOf({ type: type, x: 0, y: 0, rot: 0, props: {} });
        self.dropN = ((self.dropN || 0) + 1) % 6;
        self.addPart(type, c.x - bb.x - bb.w / 2 + self.dropN * 2 * P, c.y - bb.y - bb.h / 2 + self.dropN * 2 * P);
      }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };

  /* -------------------------------------------------------------- top bar */

  App.prototype.bindTop = function () {
    var self = this;
    /* A page may leave a control out (the standalone demo has no board to
     * pin to), so bind only what is there. */
    var on = function (id, ev, fn) { var el2 = $(id); if (el2) el2.addEventListener(ev, fn); };
    on("lab-power", "click", function () { self.sound.wake(); self.power(!self.running); });
    ($("lab-mode") ? $("lab-mode").querySelectorAll("button") : []).forEach(function (b) {
      b.addEventListener("click", function () { self.setMode(b.getAttribute("data-mode")); });
    });
    on("lab-speed", "change", function () { self.sim.timeScale = parseFloat(this.value); });
    on("lab-flow", "change", function () { self.bench.showFlow = this.value; });
    on("lab-volts", "change", function () { self.bench.showVolts = this.checked; });
    on("lab-room", "change", function () { self.setRoom(parseFloat(this.value)); });
    on("lab-mute", "click", function () { var m = self.sound.toggle(); this.setAttribute("aria-pressed", m ? "true" : "false"); this.textContent = m ? "Sound off" : "Sound on"; });
    on("lab-undo", "click", function () { self.undo(); });
    on("lab-redo", "click", function () { self.redo(); });
    /* the same three buttons serve whichever workspace is showing */
    var zoom = function (f) {
      var v = self.studio && self.studio.active();
      if (v) { v.zoomBy(f); return; }
      var r = $("bench").getBoundingClientRect(); self.bench.zoomAt(f, r.left + r.width / 2, r.top + r.height / 2);
    };
    on("lab-fit", "click", function () { var v = self.studio && self.studio.active(); if (v) v.fit(); else self.bench.fit(); });
    on("lab-zin", "click", function () { zoom(1.25); });
    on("lab-zout", "click", function () { zoom(0.8); });
    on("lab-examples", "click", function () { self.examples(); });
    on("lab-new", "click", function () { self.newCircuit(); });
    on("lab-pin", "click", function () { self.pinToBoard(); });
    on("lab-ai", "click", function () { self.panels.showSide("ai"); $("ai-q").focus(); });
    var panelsBtn = $("lab-panels");
    if (panelsBtn) panelsBtn.addEventListener("click", function () {
      var open = document.body.classList.toggle("panels-open");
      panelsBtn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    var title = $("lab-title");
    title.value = this.title;
    title.addEventListener("change", function () { self.title = title.value.trim() || "Untitled circuit"; self.changed(); });
    var proj = $("lab-projects");
    if (proj) proj.addEventListener("change", function () {
      if (proj.value && proj.value !== self.circuitId) { if (self.dirty) self.save(true); location.href = self.cfg.openUrl.replace("00000000-0000-0000-0000-000000000000", proj.value); }
    });
  };

  App.prototype.setRoom = function (v) {
    var self = this;
    this.bench.room = v;
    document.body.classList.toggle("dark-room", v < 0.6);
    /* the light sensors are in the same room */
    var level = Math.round(v >= 1 ? 80 : v >= 0.4 ? 35 : 4), n = 0;
    this.doc.parts.forEach(function (p) {
      if (p.type === "ldr" || p.type === "k_ldr") { p.props = p.props || {}; p.props.light = level; self.bench.renderPart(p); n++; }
    });
    if (n) { this.toast("The light sensor" + (n > 1 ? "s" : "") + " now see " + level + "% light."); this.panels.inspect(this.bench.sel); }
  };

  App.prototype.newCircuit = function () {
    var self = this;
    var go = function () {
      if (self.cfg.newUrl) { if (self.dirty) self.save(true); location.href = self.cfg.newUrl + "&mode=" + self.doc.mode; return; }
      if (self.dirty) self.save();
      self.replaceDoc(L.blankDoc(self.doc.mode), "Untitled circuit", true);
    };
    if (!this.doc.parts.length) return go();
    L.confirmBox(this.cfg.saveUrl ? "Start a new, empty circuit? This one is saved and stays in the list above." : "Start a new, empty circuit? This one will be cleared from the bench.", "Start new", "Cancel")
      .then(function (ok) { if (ok) go(); });
  };
  App.prototype.replaceDoc = function (doc, title, fresh) {
    this.power(false);
    if (fresh) {
      this.circuitId = null;
      this.history = new L.History(80);
      if (this.cfg.newUrl && root.history.replaceState) root.history.replaceState(null, "", this.cfg.newUrl.split("?")[0]);
    } else this.history.push(this.doc);
    this.doc = normalise(doc);
    this.sim.load(this.doc);
    this.stopProgram();
    this.mcuId = null;
    this.syncBoards();
    if (this.phone) this.phone.refresh();
    if (this.studio) { this.studio.body.sel = null; this.studio.body.framed = false; this.studio.pcb.cam = null; }
    this.title = title || this.title;
    $("lab-title").value = this.title;
    this.bench.sel = null;
    this.setMode(this.doc.mode, true);
    this.bench.render();
    this.loadProgram();
    this.panels.inspect(null);
    this.needFit = true;
    this.bench.resize();
    this.changed();
    if (this.studio) this.studio.refresh();
    if (this.layers) this.layers.sync();
  };

  App.prototype.examples = function () {
    var self = this, dlg = $("lab-examples-dlg"), kid = this.doc.mode === "kid";
    var groups = {};
    L.EXAMPLES.forEach(function (e) { if ((e.mode === "kid") === kid) (groups[e.level] = groups[e.level] || []).push(e); });
    var h = '<form method="dialog" class="dlg-top"><h2>' + (kid ? "Ready-made toys" : "Example circuits") + '</h2><button value="close" aria-label="Close">×</button></form><div class="ex-list">';
    Object.keys(groups).forEach(function (g) {
      h += '<h3>' + L.esc(g) + '</h3><div class="ex-grid">';
      groups[g].forEach(function (e) { h += '<button type="button" class="ex" data-ex="' + e.id + '"><b>' + L.esc(e.name) + '</b><span>' + L.esc(e.blurb) + '</span></button>'; });
      h += '</div>';
    });
    h += '<p class="hint">' + (kid ? "Want the grown-up examples? Switch to Pro mode at the top." : "Teaching younger pupils? Kid mode has its own toy-box examples.") + '</p></div>';
    dlg.innerHTML = h;
    dlg.querySelectorAll("[data-ex]").forEach(function (b) {
      b.addEventListener("click", function () { dlg.close(); self.openExample(b.getAttribute("data-ex")); });
    });
    dlg.showModal();
  };
  /* An example always opens as a new circuit, so whatever was on the bench
   * stays saved under its own name. */
  App.prototype.openExample = function (id) {
    var d = L.loadExample(id);
    if (!d) return;
    if (this.dirty) this.save();
    this.replaceDoc(d, d.name, true);
    this.toast("Opened “" + d.name + "” as a new circuit. Switch the power on to try it.");
  };

  /* -------------------------------------------------------------- saving */

  App.prototype.saveState = function (s, msg) {
    var el2 = $("lab-saved");
    el2.setAttribute("data-state", s);
    el2.textContent = msg || { saved: "Saved", unsaved: "Saving soon…", saving: "Saving…", error: "Not saved" }[s];
  };
  App.prototype.payload = function () {
    var d = this.doc;
    this.storeProgram();
    return { id: this.circuitId, title: this.title, mode: d.mode,
      data: { v: 1, mode: d.mode, parts: d.parts, wires: d.wires, code: d.code, blocks: d.blocks, prog: d.prog, view: d.view, name: this.title,
              programs: d.programs || {}, current: this.mcuId, joints: d.joints || {}, cuts: d.cuts || {}, bridges: d.bridges || [],
              pcb: d.pcb || null, body: d.body || null } };
  };
  App.prototype.save = function (beacon) {
    var self = this, body = this.payload();
    if (!this.cfg.saveUrl) {
      try { root.localStorage.setItem("chalklab.doc", JSON.stringify(body)); this.dirty = false; this.saveState("saved", "Saved in this browser"); }
      catch (e) { this.saveState("error"); }
      return;
    }
    if (beacon && navigator.sendBeacon) {
      var fd = new FormData();
      fd.append("payload", JSON.stringify(body)); fd.append("csrfmiddlewaretoken", this.cfg.csrf);
      navigator.sendBeacon(this.cfg.saveUrl, fd);
      this.dirty = false;
      return;
    }
    this.saveState("saving");
    fetch(this.cfg.saveUrl, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": this.cfg.csrf }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        if (!r.ok || !r.j.ok) { self.saveState("error", r.j && r.j.error ? "Not saved — " + r.j.error : "Not saved"); return; }
        if (!self.circuitId && r.j.id) {
          self.circuitId = r.j.id;
          if (r.j.url && root.history.replaceState) root.history.replaceState(null, "", r.j.url);
        }
        self.syncProjects();
        self.dirty = false;
        self.saveState("saved");
      })
      .catch(function () { self.saveState("error", "Offline — will retry"); setTimeout(function () { if (self.dirty) self.save(); }, 8000); });
  };

  /* The "other circuits on this board" menu: this one, under its current name. */
  App.prototype.syncProjects = function () {
    var sel = $("lab-projects"), id = this.circuitId;
    if (!sel || !id) return;
    var opt = sel.querySelector('option[value="' + id + '"]');
    if (!opt) { opt = document.createElement("option"); opt.value = id; sel.insertBefore(opt, sel.firstChild); }
    opt.textContent = this.title;
    sel.value = id;
  };

  /* Put a picture of the bench on the lesson page, glowing LEDs and all. */
  App.prototype.pinToBoard = function () {
    var self = this, btn = $("lab-pin");
    if (!this.doc.parts.length) { this.toast("Build something first — there's nothing to pin."); return; }
    btn.disabled = true; btn.textContent = "Pinning…";
    this.bench.snapshot(1.4).then(function (shot) {
      if (!self.cfg.pinUrl) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(shot.blob); a.download = (self.title || "circuit") + ".png"; a.click();
        throw { quiet: true, msg: "Downloaded the picture." };
      }
      var fd = new FormData();
      fd.append("file", shot.blob, "circuit.png");
      fd.append("title", self.title);
      return fetch(self.cfg.pinUrl, { method: "POST", credentials: "same-origin", headers: { "X-CSRFToken": self.cfg.csrf }, body: fd }).then(function (r) { return r.json(); });
    }).then(function (j) {
      if (!j || !j.ok) throw { msg: (j && j.error) || "Couldn't pin it." };
      self.toast("Pinned to page " + (j.page + 1) + " of the board. It's on the projector now.");
      self.sound("win");
    }).catch(function (e) { self.toast(e && e.msg ? e.msg : "Couldn't make a picture of the bench."); })
      .then(function () { btn.disabled = false; btn.textContent = "Pin to board"; });
  };

  /* ---------------------------------------------------------------- keys */

  App.prototype.keys = function () {
    var self = this;
    document.addEventListener("keydown", function (e) {
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) {
        if (e.key === "Escape") e.target.blur();
        return;
      }
      var mod = e.ctrlKey || e.metaKey, sel = self.bench.sel;
      /* on the Board and in the Body, the same keys act on what is showing */
      if (self.studio && self.studio.key(e)) { e.preventDefault(); return; }
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? self.redo() : self.undo(); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); self.redo(); return; }
      if (mod && e.key.toLowerCase() === "d" && sel && sel.kind === "part") { e.preventDefault(); self.partAction(self.partById(sel.id), "dupe"); return; }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); self.save(); return; }
      if (mod) return;
      switch (e.key) {
        case "Delete": case "Backspace": if (sel) { e.preventDefault(); self.deleteSel(); } break;
        case "r": case "R": if (sel && sel.kind === "part") self.partAction(self.partById(sel.id), "rotate"); break;
        case "f": case "F": if (e.shiftKey) self.layout.fullscreen(); else self.bench.fit(); break;
        case " ": e.preventDefault(); self.sound.wake(); self.power(!self.running); break;
        case "Escape": self.bench.cancelGesture(); self.bench.select(null); break;
        case "ArrowLeft": case "ArrowRight": case "ArrowUp": case "ArrowDown":
          if (sel && sel.kind === "part") {
            e.preventDefault();
            var p = self.partById(sel.id), dx = e.key === "ArrowLeft" ? -P : e.key === "ArrowRight" ? P : 0, dy = e.key === "ArrowUp" ? -P : e.key === "ArrowDown" ? P : 0;
            self.edit(function () { p.x += dx; p.y += dy; });
          }
          break;
      }
    });
  };

  App.prototype.toast = function (msg) {
    var t = $("lab-toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(this.toastT);
    this.toastT = setTimeout(function () { t.hidden = true; }, Math.max(2600, msg.length * 55));
  };

  /* --------------------------------------------------------------- sound
   * Buzzers buzz, piezos play their notes, motors hum, relays click. All
   * quiet, all synthesised — no audio files to load on a school network. */
  function makeSound(app) {
    var ac = null, master = null, voices = {}, muted = false;
    try { muted = root.localStorage.getItem("chalklab.mute") === "1"; } catch (e) {}
    function wake() {
      if (ac || !(root.AudioContext || root.webkitAudioContext)) return;
      ac = new (root.AudioContext || root.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.6;
      var lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3500;
      master.connect(lp); lp.connect(ac.destination);
    }
    function voice(id, type) {
      var v = voices[id];
      if (v) return v;
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type; g.gain.value = 0;
      o.connect(g); g.connect(master); o.start();
      return (voices[id] = { o: o, g: g });
    }
    var noiseBuf = null;
    function noise(kind) {
      if (!noiseBuf) {
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        var ch = noiseBuf.getChannelData(0);
        for (var i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      }
      var spec = { sizzle: [3500, 2, 0.5, 0.12], snip: [5000, 4, 0.04, 0.35], thwip: [900, 1, 0.22, 0.3], drill: [1400, 3, 0.35, 0.18], pumpcock: [2500, 3, 0.05, 0.2] }[kind];
      var t = ac.currentTime, src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
      src.buffer = noiseBuf; f.type = "bandpass"; f.frequency.value = spec[0]; f.Q.value = spec[1];
      if (kind === "thwip") f.frequency.exponentialRampToValueAtTime(200, t + spec[2]);
      g.gain.setValueAtTime(spec[3], t); g.gain.exponentialRampToValueAtTime(0.0001, t + spec[2]);
      src.connect(f); f.connect(g); g.connect(master);
      src.start(t, Math.random() * 0.5); src.stop(t + spec[2] + 0.02);
    }
    function one(kind) {
      if (!ac || muted) return;
      if (/^(sizzle|snip|thwip|drill|pumpcock)$/.test(kind)) return noise(kind);
      var t = ac.currentTime, o = ac.createOscillator(), g = ac.createGain();
      o.connect(g); g.connect(master);
      var spec = { click: ["square", 1800, 0.02, 0.18], tick: ["square", 2400, 0.012, 0.08], snap: ["triangle", 900, 0.05, 0.12], pop: ["sawtooth", 140, 0.18, 0.4],
                   spark: ["sawtooth", 3000, 0.12, 0.2], on: ["sine", 520, 0.12, 0.12], err: ["square", 220, 0.18, 0.12], win: ["triangle", 660, 0.5, 0.18] }[kind] || ["sine", 440, 0.1, 0.1];
      o.type = spec[0]; o.frequency.setValueAtTime(spec[1], t);
      if (kind === "win") { o.frequency.setValueAtTime(660, t); o.frequency.setValueAtTime(880, t + 0.12); o.frequency.setValueAtTime(1320, t + 0.24); }
      if (kind === "pop" || kind === "spark") o.frequency.exponentialRampToValueAtTime(40, t + spec[2]);
      g.gain.setValueAtTime(spec[3], t); g.gain.exponentialRampToValueAtTime(0.0001, t + spec[2]);
      o.start(t); o.stop(t + spec[2] + 0.02);
    }
    var api = function (kind) { wake(); one(kind); };
    api.wake = wake;
    api.toggle = function () {
      muted = !muted;
      try { root.localStorage.setItem("chalklab.mute", muted ? "1" : "0"); } catch (e) {}
      if (master) master.gain.value = muted ? 0 : 0.6;
      return muted;
    };
    api.update = function (sim) {
      if (!ac) return;
      var live = {};
      if (sim && !muted) app.doc.parts.forEach(function (p) {
        var st = sim.state[p.id]; if (!st) return;
        if (st.sound) {
          var v = voice(p.id, "square");
          v.o.frequency.setTargetAtTime(st.sound, ac.currentTime, 0.005);
          v.g.gain.setTargetAtTime(p.type === "piezo" ? 0.05 : 0.025, ac.currentTime, 0.01);
          live[p.id] = 1;
        } else if (st.w && Math.abs(st.w) > 20) {
          var m = voice(p.id + "m", "sawtooth");
          m.o.frequency.setTargetAtTime(30 + Math.abs(st.w) / 6, ac.currentTime, 0.05);
          m.g.gain.setTargetAtTime(Math.min(0.02, Math.abs(st.w) / 40000), ac.currentTime, 0.05);
          live[p.id + "m"] = 1;
        }
      });
      Object.keys(voices).forEach(function (id) { if (!live[id]) voices[id].g.gain.setTargetAtTime(0, ac.currentTime, 0.01); });
    };
    return api;
  }

  /* ----------------------------------------------------------------- boot */

  document.addEventListener("DOMContentLoaded", function () {
    var cfgEl = document.getElementById("lab-config");
    var cfg = cfgEl ? JSON.parse(cfgEl.textContent) : {};
    if (!cfg.saveUrl) { try { var saved = JSON.parse(root.localStorage.getItem("chalklab.doc") || "null"); if (saved && !cfg.data) { cfg.data = saved.data; cfg.title = saved.title; } } catch (e) {} }
    if (!cfg.data && cfg.example) cfg.data = L.loadExample(cfg.example);
    root.chalkLab = new App(cfg);
  });
})(typeof window !== "undefined" ? window : globalThis);
