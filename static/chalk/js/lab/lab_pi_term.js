/* Chalk Circuit Lab — the Raspberry Pi's terminal.
 *
 * A Pi on the bench adds a Terminal tab to the dock: the screen and
 * keyboard plugged into it. It is a real terminal in the ways that matter
 * to a class — a prompt you type at, colour, history on the arrow keys,
 * Tab completion, Ctrl+C — and it dresses for the Linux on the card:
 * Raspberry Pi OS in dark green-on-black, Ubuntu in its aubergine, Debian
 * in slate.
 *
 * Around the screen:
 *   Files      the SD card's home folder, editable even with the power off
 *   nano       opens here as a proper editor (Ctrl+O, Ctrl+X and all), and
 *              checks a Python file's syntax as it saves
 *   key row    Tab, arrows, Ctrl+C … as buttons, for a touch screen or an
 *              interactive whiteboard with no keyboard
 *
 * The machine itself is lab_pi_os.js; this file only shows it and types
 * into it. It loads after lab_app.js and attaches to the running app.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab, OS = L.PiOS, Pi = L.Pi, esc = L.esc;
  if (typeof document === "undefined") return;

  var X256 = { 208: "#ff8f2e", 202: "#ff6a2a", 39: "#3fb6ff", 245: "#8f97a0" };

  function Term(app) {
    var self = this;
    this.app = app;
    this.cur = null;            /* id of the Pi whose screen is showing */
    this.hist = -1; this.draft = "";
    this.seen = {};             /* per Pi: what of its screen has been painted */
    this.fxAt = {};
    this.rig = app.pi = new Pi.Rig(app.sim, function () { return app.doc; }, {
      clock: function () { return performance.now(); },
      changed: function () { app.changed(); },
      flashed: function (id, os) { if (id === self.cur) self.painted = null; app.toast("Flashed " + OS.DISTROS[os].name + " onto the card. Your home folder is kept; the Pi is starting up again."); },
      fx: function (id, kind, n, v) { self.fx(id, kind, n, v); }
    });
    this.build();
    var tick = function () { try { self.frame(); } catch (e) { if (root.console) console.error(e); } requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    /* a click on the Pi brings its screen up */
    var click = app.clickPart;
    app.clickPart = function (part, wp) {
      click.call(app, part, wp);
      if (part && part.type === "raspberry_pi") { self.cur = part.id; self.painted = null; self.show(false); }
    };
  }
  Pi.Term = Term;

  Term.prototype.build = function () {
    var self = this, app = this.app, dock = app.panels.dock, tabs = dock.querySelector(".dock-bar .tabs"), body = dock.querySelector(".dock-body");
    var tab = this.tab = document.createElement("button");
    tab.setAttribute("role", "tab"); tab.setAttribute("data-dock", "pi"); tab.setAttribute("aria-selected", "false"); tab.hidden = true; tab.className = "pi-tab";
    tab.innerHTML = '<i aria-hidden="true">&gt;_</i> Terminal <span class="count" id="pi-new" hidden>•</span>';
    tabs.appendChild(tab);
    tab.addEventListener("click", function () { self.show(true); });
    var pane = this.pane = document.createElement("section");
    pane.className = "dpane pi-pane"; pane.setAttribute("data-dpane", "pi"); pane.hidden = true; pane.setAttribute("data-os", "");
    pane.innerHTML =
      '<div class="pi-bar">' +
        '<span class="pi-dots" aria-hidden="true"><i></i><i></i><i></i></span>' +
        '<span class="pi-title" id="pi-title"></span>' +
        '<label class="pi-pick" hidden><span class="sr">Which Raspberry Pi</span><select id="pi-pick"></select></label>' +
        '<span class="pi-chip" id="pi-chip"></span>' +
        '<span class="pi-led" id="pi-state" role="status"></span>' +
        '<span class="pi-grow"></span>' +
        '<button type="button" id="pi-files" title="The files on this Pi\'s SD card">Files</button>' +
        '<button type="button" id="pi-cycle" title="Pull the power lead out and push it back in">Restart Pi</button>' +
      '</div>' +
      '<div class="pi-screen" id="pi-screen">' +
        '<div class="pi-scroll" id="pi-scroll"><div class="pi-lines" id="pi-lines" aria-live="off"></div>' +
          '<div class="pi-entry" id="pi-entry"><span class="pi-last" id="pi-last"></span><input id="pi-in" class="pi-in" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Type a command for the Raspberry Pi"></div>' +
          '<div class="pi-hints" id="pi-hints" hidden></div>' +
        '</div>' +
        '<div class="pi-off" id="pi-off" hidden></div>' +
        '<div class="pi-nano" id="pi-nano" hidden></div>' +
      '</div>' +
      '<div class="pi-keys" role="toolbar" aria-label="Keys">' +
        '<button type="button" data-k="tab" title="Finish the word (Tab)">Tab</button><button type="button" data-k="up" title="Earlier command" aria-label="Earlier command">↑</button><button type="button" data-k="down" title="Later command" aria-label="Later command">↓</button>' +
        '<button type="button" data-k="c" title="Stop the running program">Ctrl+C</button><button type="button" data-k="d" title="End of input / leave Python">Ctrl+D</button><button type="button" data-k="l" title="Clear the screen">Ctrl+L</button>' +
        '<span class="pi-grow"></span><span class="pi-try" id="pi-try"></span>' +
      '</div>';
    body.appendChild(pane);
    var $ = function (id) { return pane.querySelector("#" + id); };
    this.el = { title: $("pi-title"), chip: $("pi-chip"), state: $("pi-state"), pick: $("pi-pick"), scroll: $("pi-scroll"), lines: $("pi-lines"), entry: $("pi-entry"), last: $("pi-last"), input: $("pi-in"), hints: $("pi-hints"), off: $("pi-off"), nano: $("pi-nano"), tryIt: $("pi-try"), screen: $("pi-screen") };
    var el = this.el, input = el.input;
    el.screen.addEventListener("mouseup", function (e) { if (!String(root.getSelection ? root.getSelection() : "") && !e.target.closest(".pi-nano, .pi-off, button, a")) input.focus(); });
    el.pick.addEventListener("change", function () { self.cur = el.pick.value; self.painted = null; });
    $("pi-files").addEventListener("click", function () { self.files(); });
    $("pi-cycle").addEventListener("click", function () {
      if (!app.running) { app.sound.wake(); app.power(true); return; }
      if (self.cur) { self.rig.cycle(self.cur); self.painted = null; input.focus(); }
    });
    pane.querySelectorAll("[data-k]").forEach(function (b) { b.addEventListener("click", function () { self.keyName(b.getAttribute("data-k")); input.focus(); }); });
    el.tryIt.addEventListener("click", function (e) { var b = e.target.closest("[data-cmd]"); if (b) { input.value = b.getAttribute("data-cmd"); input.focus(); } });
    input.addEventListener("keydown", function (e) { self.keydown(e); });
    input.addEventListener("paste", function (e) {
      var t = (e.clipboardData || root.clipboardData).getData("text");
      if (!/\n/.test(t)) return;
      e.preventDefault();
      var m = self.machine(), rows = t.replace(/\r/g, "").split("\n");
      if (!m) return;
      rows.forEach(function (row, i) { if (i < rows.length - 1) m.input((i ? "" : input.value) + row); else input.value = row; });
    });
  };

  Term.prototype.entryFor = function () { return this.cur ? this.rig.entry(this.cur) : null; };
  Term.prototype.machine = function () { var e = this.entryFor(); return e ? e.m : null; };
  Term.prototype.show = function (focus) {
    this.app.panels.showDock("pi");
    document.getElementById("pi-new").hidden = true;
    if (focus) this.el.input.focus();
  };

  /* ---------------------------------------------------------------- keys */

  Term.prototype.keyName = function (k) {
    var m = this.machine(), input = this.el.input;
    if (!m) return;
    if (k === "tab") return this.complete();
    if (k === "up" || k === "down") return this.history(k === "up" ? 1 : -1);
    if (k === "c") { if (m.raw) m.keypress("q"); input.value = ""; this.hist = -1; m.key("c"); this.hints(null); return; }
    if (k === "d") { if (input.value === "") m.key("d"); return; }
    if (k === "l") { m.key("l"); return; }
  };
  Term.prototype.history = function (dir) {
    var m = this.machine(), input = this.el.input;
    if (!m || !m.sh || m.fg) return;
    var h = m.sh.history;
    if (this.hist < 0) this.draft = input.value;
    this.hist = Math.max(-1, Math.min(h.length - 1, this.hist + dir));
    input.value = this.hist < 0 ? this.draft : h[h.length - 1 - this.hist];
    setTimeout(function () { input.setSelectionRange(input.value.length, input.value.length); }, 0);
  };
  Term.prototype.complete = function () {
    var m = this.machine(), input = this.el.input;
    if (!m) return;
    var r = m.complete(input.value);
    input.value = r.text;
    this.hints(r.list.length ? r.list : null);
  };
  Term.prototype.hints = function (list) {
    var h = this.el.hints;
    h.hidden = !list;
    if (list) { h.textContent = list.join("   "); this.el.scroll.scrollTop = this.el.scroll.scrollHeight; }
  };
  Term.prototype.keydown = function (e) {
    var m = this.machine(), input = this.el.input, k = e.key;
    if (!m) return;
    if (m.raw && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (k.length === 1) m.keypress(k); else if (k === "Escape") m.keypress("q"); return; }
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
      var c = k.toLowerCase();
      if (c === "c" && input.selectionStart !== input.selectionEnd) return;          /* let a real copy through */
      if (c === "c" || c === "d" || c === "l") { e.preventDefault(); this.keyName(c); return; }
      if (c === "u") { e.preventDefault(); input.value = ""; return; }
      return;
    }
    if (k === "Tab") { e.preventDefault(); this.complete(); return; }
    if (k === "ArrowUp") { e.preventDefault(); this.history(1); return; }
    if (k === "ArrowDown") { e.preventDefault(); this.history(-1); return; }
    if (k === "Escape") { e.stopPropagation(); this.hints(null); return; }
    if (k === "Enter") {
      e.preventDefault();
      var line = input.value;
      input.value = ""; this.hist = -1; this.hints(null);
      if (m.state !== "on") return;
      m.input(line);
      this.stick = true;
    }
  };

  /* --------------------------------------------------------------- paint */

  function lineHtml(cells) {
    var out = "", run = "", st = null;
    var flush = function () {
      if (!run) return;
      if (!st) out += esc(run);
      else {
        var x = /x(\d+)/.exec(st), cls = st.replace(/x\d+/, "").trim();
        out += "<span" + (cls ? ' class="' + cls + '"' : "") + (x ? ' style="color:' + (X256[x[1]] || "#d0d0d0") + '"' : "") + ">" + esc(run) + "</span>";
      }
      run = "";
    };
    for (var i = 0; i < cells.length; i++) { if (cells[i][1] !== st) { flush(); st = cells[i][1]; } run += cells[i][0]; }
    flush();
    return out;
  }

  Term.prototype.paint = function (m) {
    var el = this.el, sc = m.screen, buf = sc.buf, box = el.lines, alt = sc.alt();
    var key = this.cur + ":" + m.boots + ":" + (alt ? "a" : "m");
    var atBottom = this.stick || el.scroll.scrollTop + el.scroll.clientHeight >= el.scroll.scrollHeight - 30;
    if (this.painted !== key || sc.cleared || alt) { box.innerHTML = ""; sc.dirtyFrom = 0; sc.cut = 0; sc.cleared = false; this.painted = key; this.ver = -1; }
    if (this.ver === sc.version) return;
    this.ver = sc.version;
    for (var k = 0; k < sc.cut && box.firstChild; k++) box.removeChild(box.firstChild);
    sc.cut = 0;
    var lines = buf.lines, body = alt ? lines.length : lines.length - 1, from = Math.min(alt ? 0 : sc.dirtyFrom, box.childNodes.length);
    while (box.childNodes.length > body) box.removeChild(box.lastChild);
    for (var i = from; i < body; i++) {
      var html = lineHtml(lines[i]) || "​", node = box.childNodes[i];
      if (!node) { node = document.createElement("div"); box.appendChild(node); }
      if (node._h !== html) { node.innerHTML = html; node._h = html; }
    }
    sc.dirtyFrom = Math.max(0, lines.length - 1);
    var last = alt ? "" : lineHtml(lines[lines.length - 1]);
    if (el.last._h !== last) { el.last.innerHTML = last; el.last._h = last; }
    if (atBottom) { el.scroll.scrollTop = el.scroll.scrollHeight; this.stick = false; }
    if (sc.bell !== this.bell) { this.bell = sc.bell; if (this.app.sound) this.app.sound("tick"); }
    if (this.app.panels.dockTab !== "pi") document.getElementById("pi-new").hidden = false;
  };

  var TRY = {
    raspios: ["pinout", "ls", "python3 blink.py", "pinctrl set 17 op dh", "gpio readall", "neofetch", "help"],
    ubuntu: ["pinout", "ls", "python3 blink.py", "gpioset gpiochip0 17=1", "gpio readall", "neofetch", "help"],
    debian: ["pinout", "ls", "python3 blink.py", "gpioset gpiochip0 17=1", "gpio readall", "neofetch", "help"]
  };

  Term.prototype.frame = function () {
    var app = this.app, self = this, el = this.el, pis = this.rig.parts();
    this.rig.sync(app.running);
    var showing = app.panels.dockTab === "pi";
    if (showing !== this.showing) { this.showing = showing; app.panels.dock.classList.toggle("pi-showing", showing); if (app.bench && app.bench.resize) app.bench.resize(); }
    var had = !this.tab.hidden;
    this.tab.hidden = !pis.length;
    if (!pis.length) { if (app.panels.dockTab === "pi") app.panels.showDock(app.doc.mode === "kid" ? "blocks" : "code"); this.cur = null; return; }
    if (!this.cur || !pis.some(function (p) { return p.id === self.cur; })) { this.cur = pis[0].id; this.painted = null; }
    if (!had && this.booted) { this.show(false); app.toast("A Raspberry Pi has no upload button. Switch the power on and it boots: its screen is the Terminal tab below."); }
    this.booted = true;
    if (this.pane.hidden) { var e0 = this.entryFor(); if (e0 && e0.m.screen.version !== this.ver && app.panels.dockTab !== "pi" && e0.m.state === "on" && e0.m.fg) document.getElementById("pi-new").hidden = false; return; }
    /* which Pi */
    var sig = pis.map(function (p) { return p.id; }).join(",");
    if (sig !== this.pickSig) { this.pickSig = sig; el.pick.innerHTML = pis.map(function (p) { return '<option value="' + p.id + '">' + esc(self.rig.label(p)) + '</option>'; }).join(""); el.pick.parentNode.hidden = pis.length < 2; }
    if (el.pick.value !== this.cur) el.pick.value = this.cur;
    var e = this.entryFor();
    if (!e) return;
    var m = e.m, os = m.os, st = m.state;
    var tryKey = os.id + ":" + m.boots + ":" + st;
    if (this.pane.getAttribute("data-os") !== os.id) this.pane.setAttribute("data-os", os.id);
    if (tryKey !== this.tryKey) {
      this.tryKey = tryKey;
      /* suggest a program that is really on this card */
      var home = m.fs && m.fs.node(m.fs.home()), progs = home ? Object.keys(home.kids).filter(function (k) { return /\.py$/.test(k); }).sort() : [], prog = progs.indexOf("blink.py") >= 0 ? "blink.py" : progs[0];
      el.tryIt.innerHTML = '<span>Try</span>' + TRY[os.id].filter(function (c) { return prog || !/^python3 /.test(c); }).map(function (c) { return /^python3 /.test(c) ? "python3 " + prog : c; }).map(function (c) { return '<button type="button" data-cmd="' + esc(c) + '">' + esc(c) + '</button>'; }).join("");
    }
    var title = st === "on" && m.sh ? m.sh.user + "@" + m.hostName + ": " + m.sh.shown(m.sh.cwd) : m.hostName;
    if (el.title.textContent !== title) el.title.textContent = title;
    if (el.chip.textContent !== os.name) el.chip.textContent = os.name;
    var word = st === "off" ? "off" : st === "booting" ? "booting…" : st === "halting" ? "shutting down…" : st === "halted" ? "halted" : m.fg ? "running" : "ready";
    if (el.state.textContent !== word) { el.state.textContent = word; el.state.setAttribute("data-s", st === "on" ? (m.fg ? "run" : "ok") : st); }
    var cyc = this.pane.querySelector("#pi-cycle"), cycText = app.running ? "Restart Pi" : "Power on";
    if (cyc.textContent !== cycText) cyc.textContent = cycText;
    /* off and halted get a card over the glass */
    var offKey = st === "off" ? "off" : st === "halted" ? (m.crashed ? "crash" : "halt") : "";
    if (offKey !== this.offKey) {
      this.offKey = offKey;
      el.off.hidden = !offKey;
      if (offKey === "off") el.off.innerHTML = '<div class="pi-off-card"><b>The Pi is off.</b><p>It boots when the bench power comes on — there is no “upload” on a Raspberry Pi. You log in and run things.</p><button type="button" class="primary" data-go="power">Switch the power on</button><button type="button" data-go="files">Look at its SD card</button></div>';
      else if (offKey) el.off.innerHTML = '<div class="pi-off-card low"><button type="button" class="primary" data-go="cycle">' + (offKey === "crash" ? "Restore the card and start again" : "Start the Pi again") + '</button></div>';
      el.off.querySelectorAll("[data-go]").forEach(function (b) {
        b.addEventListener("click", function () {
          var go = b.getAttribute("data-go");
          if (go === "power") { app.sound.wake(); app.power(true); el.input.focus(); }
          else if (go === "files") self.files();
          else { m.crashed = false; self.rig.cycle(self.cur); self.painted = null; el.input.focus(); }
        });
      });
    }
    if (st === "off") { if (el.lines.childNodes.length) { el.lines.innerHTML = ""; el.last.innerHTML = ""; el.last._h = ""; this.painted = null; } el.entry.hidden = true; return; }
    this.paint(m);
    /* the input stays in the page so keys always have somewhere to land; it
     * turns invisible while the Pi boots or a full-screen program has the keys */
    var alt = m.screen.alt(), ghost = st !== "on" || !!m.raw || alt;
    el.last.hidden = alt;
    el.input.classList.toggle("ghost", ghost);
    if (ghost && el.input.value) el.input.value = "";
    this.pane.classList.toggle("raw", !!m.raw);
    if (el.entry.hidden) el.entry.hidden = false;
  };

  /* A pin changed: show it on the bench, the way an Arduino's pins are shown. */
  Term.prototype.fx = function (id, kind, n, v) {
    var app = this.app, key = id + ":GPIO" + n, now = performance.now();
    if (!app.running || !app.bench.pinAll || !app.bench.pinAll[key] || kind === "mode") return;
    if (now - (this.fxAt[key] || 0) < 140) return;
    this.fxAt[key] = now;
    var slow = app.sim.timeScale < 1;
    var bubble = kind === "write" ? "GPIO" + n + (v ? " HIGH" : " LOW") : kind === "pwm" ? "GPIO" + n + " " + Math.round(v / 2.55) + "%" : kind === "tone" ? (v ? "♪ " + Math.round(v) + " Hz" : "♪ off") : kind === "servo" ? "servo " + v + "°" : null;
    app.bench.ripple(key, slow || kind === "tone" || kind === "servo" ? bubble : null, kind === "write" && !v ? "#7fa7ff" : "#7dffb0");
  };

  /* -------------------------------------------------------------- SD card
   * One way to reach the home folder whether the Pi is running (through its
   * file system) or switched off (straight from the card in the document). */
  Term.prototype.store = function () {
    var app = this.app, id = this.cur, e = this.entryFor(), self = this;
    if (e && e.m.fs && (e.m.state === "on" || e.m.state === "booting")) {
      var m = e.m, fs = m.fs, home = fs.home();
      return {
        live: true, home: "~",
        list: function () { var out = []; (function walk(d, rel) { Object.keys(d.kids).sort().forEach(function (k) { var n = d.kids[k], p = rel ? rel + "/" + k : k; if (n instanceof OS.Dir) walk(n, p); else out.push({ name: p, size: n.text.length, x: !!n.x }); }); })(fs.node(home), ""); return out; },
        read: function (name) { var n = fs.node(home + "/" + name); return n && !(n instanceof OS.Dir) ? n.text : null; },
        write: function (name, text) { var abs = fs.norm(name, home), par = fs.parent(abs); if (!fs.inHome(abs)) return "Permission denied"; if (!(par.dir instanceof OS.Dir)) fs.mkdirp(par.path); var keep = fs.node(abs) && fs.node(abs).x, err = fs.write(abs, text, false, false); if (!err && keep) fs.node(abs).x = true; return err; },
        remove: function (name) { var abs = home + "/" + name, par = fs.parent(abs); if (par.dir) { delete par.dir.kids[par.name]; m.changed(); } },
        used: function () { return fs.used(); }
      };
    }
    var card = OS.unpackSD(Pi.sdOf(app.doc, id) || OS.starterSD());
    var commit = function () { Pi.setSD(app.doc, id, OS.packSD(card)); var en = self.rig.entry(id); if (en) en.m.sdText = Pi.sdOf(app.doc, id); app.changed(); };
    return {
      live: false, home: "~",
      list: function () { return Object.keys(card.files).filter(function (k) { return !card.files[k].dir; }).sort().map(function (k) { return { name: k, size: card.files[k].text.length, x: !!card.files[k].x }; }); },
      read: function (name) { return card.files[name] && !card.files[name].dir ? card.files[name].text : null; },
      write: function (name, text) { var total = Object.keys(card.files).reduce(function (t, k) { return t + (k === name || card.files[k].dir ? 0 : card.files[k].text.length); }, 0); if (total + text.length > OS.SD_LIMIT) return "No space left on device"; card.files[name] = { text: text, x: card.files[name] ? card.files[name].x : false }; commit(); return null; },
      remove: function (name) { delete card.files[name]; commit(); },
      used: function () { return Object.keys(card.files).reduce(function (t, k) { return t + (card.files[k].dir ? 0 : card.files[k].text.length); }, 0); }
    };
  };

  Term.prototype.files = function () {
    var self = this, app = this.app, st = this.store(), d = document.createElement("dialog");
    if (!this.cur) return;
    d.className = "dlg pi-files";
    var draw = function () {
      var list = st.list().filter(function (f) { return f.name !== ".bash_history"; }), used = st.used();
      d.innerHTML = '<form method="dialog" class="dlg-top"><h2>SD card · home folder</h2><button value="close" aria-label="Close">×</button></form>' +
        '<div class="pi-files-body"><p class="pi-files-lede">These files are saved with the circuit, so they are still here next lesson. ' + (st.live ? "The Pi is running: this is its live home folder." : "The Pi is off: you are editing the card directly.") + '</p>' +
        (list.length ? '<ul class="pi-file-list">' + list.map(function (f) {
          return '<li><button type="button" class="pi-file" data-open="' + esc(f.name) + '"><i class="ft ' + (/\.py$/.test(f.name) ? "py" : /\.sh$/.test(f.name) ? "sh" : /\.(txt|log|csv|md)$/i.test(f.name) ? "txt" : "") + '">' + esc((/\.(\w{1,4})$/.exec(f.name) || [0, "•"])[1]) + '</i><span>' + esc(f.name) + '</span><em>' + (f.x ? "runs · " : "") + (f.size < 1000 ? f.size + " B" : (f.size / 1024).toFixed(1) + " K") + '</em></button>' +
            (st.live && /\.(py|sh)$/.test(f.name) ? '<button type="button" data-run="' + esc(f.name) + '" title="Run it in the terminal">Run</button>' : '') +
            '<button type="button" class="danger" data-del="' + esc(f.name) + '" aria-label="Delete ' + esc(f.name) + '" title="Delete">×</button></li>';
        }).join("") + '</ul>' : '<p class="hint">The card is empty.</p>') +
        '<div class="pi-meter" title="How full the saved part of the card is"><i style="width:' + Math.min(100, Math.round(used / OS.SD_LIMIT * 100)) + '%"></i></div><p class="hint">' + (used / 1024).toFixed(1) + ' K of ' + (OS.SD_LIMIT / 1024).toFixed(0) + ' K used</p>' +
        '<div class="ask-actions"><button type="button" data-new="notes.txt">New text file</button><button type="button" class="primary" data-new="program.py">New Python program</button></div></div>';
      d.querySelectorAll("[data-open]").forEach(function (b) { b.addEventListener("click", function () { d.close(); self.edit({ name: b.getAttribute("data-open"), store: st }); }); });
      d.querySelectorAll("[data-run]").forEach(function (b) { b.addEventListener("click", function () { d.close(); self.runFile(b.getAttribute("data-run")); }); });
      d.querySelectorAll("[data-del]").forEach(function (b) {
        b.addEventListener("click", function () { var n = b.getAttribute("data-del"); L.confirmBox("Delete " + n + " from the card? There is no bin to get it back from.", "Delete", "Keep it").then(function (ok) { if (ok) { st.remove(n); draw(); } }); });
      });
      d.querySelectorAll("[data-new]").forEach(function (b) {
        b.addEventListener("click", function () {
          L.promptBox("Name the new file", b.getAttribute("data-new"), "Create").then(function (name) {
            name = (name || "").trim().replace(/^~?\/+/, "");
            if (!name) return;
            if (!/^[\w.\-\/]{1,60}$/.test(name) || /\.\./.test(name)) { app.toast("Use letters, numbers, dots and dashes in a file name."); return; }
            d.close();
            self.edit({ name: name, store: st, isNew: st.read(name) === null, text: st.read(name) !== null ? null : /\.py$/.test(name) ? "from gpiozero import LED\nfrom time import sleep\n\nled = LED(17)\n\nwhile True:\n    led.toggle()\n    sleep(0.5)\n" : "" });
          });
        });
      });
    };
    document.body.appendChild(d);
    d.addEventListener("close", function () { d.remove(); });
    draw();
    d.showModal();
  };

  Term.prototype.runFile = function (name) {
    var m = this.machine();
    this.show(true);
    if (!m || m.state !== "on") { this.app.toast("Switch the power on first: the Pi has to boot before it can run anything."); return; }
    if (m.fg) { this.app.toast("Something is already running. Press Ctrl+C to stop it first."); return; }
    m.runLine((/\.py$/.test(name) ? "python3 " : "bash ") + name);
    this.stick = true;
  };

  /* ----------------------------------------------------------------- nano
   * req comes from the nano command ({name, text, save, close}) or from the
   * Files panel ({name, store}). Either way: an editor over the terminal
   * with nano's two famous keys, and buttons for people without them. */
  Term.prototype.edit = function (req) {
    var self = this, app = this.app, box = this.el.nano, st = req.store || null;
    var text = req.text != null ? req.text : st ? (st.read(req.name) || "") : "", name = req.name || "", saved = text, asking = null;
    this.show(false);
    box.hidden = false;
    box.innerHTML =
      '<div class="nano-top"><span>GNU nano 7.2</span><b id="nano-name"></b><span id="nano-mod"></span></div>' +
      '<div class="nano-body"><pre class="nano-gutter" id="nano-gut" aria-hidden="true"></pre><textarea id="nano-ta" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" aria-label="File contents"></textarea></div>' +
      '<div class="nano-status" id="nano-status" role="status"></div>' +
      '<div class="nano-keys"><button type="button" data-n="save"><kbd>^O</kbd> Write Out</button><button type="button" data-n="exit"><kbd>^X</kbd> Exit</button>' +
        (/\.(py|sh)$/.test(name) || !name ? '<button type="button" data-n="run" class="primary"><kbd>F5</kbd> Save &amp; run</button>' : '') +
        '<span class="pi-grow"></span><span class="nano-pos" id="nano-pos"></span></div>';
    var q = function (id) { return box.querySelector("#" + id); }, ta = q("nano-ta"), status = q("nano-status"), gut = q("nano-gut");
    var say = function (msg, bad) { status.innerHTML = msg ? '<span class="' + (bad ? "bad" : "") + '">[ ' + esc(msg) + ' ]</span>' : ""; };
    var modified = function () { return ta.value !== saved; };
    var head = function () {
      q("nano-name").textContent = name || "New Buffer"; q("nano-mod").textContent = modified() ? "Modified" : "";
      var n = ta.value.split("\n").length, s = ""; for (var i = 1; i <= n; i++) s += i + "\n";
      if (gut._n !== n) { gut.textContent = s; gut._n = n; }
      gut.scrollTop = ta.scrollTop;
      var before = ta.value.slice(0, ta.selectionStart).split("\n");
      q("nano-pos").textContent = "line " + before.length + ", col " + (before[before.length - 1].length + 1);
    };
    ta.value = text; ta.readOnly = !!req.readOnly;
    say(req.readOnly ? "File '" + name + "' is unwritable" : req.isNew || (!st && req.isNew) ? "New File" : "Read " + text.split("\n").length + " lines");
    var close = function () { box.hidden = true; box.innerHTML = ""; if (req.close) req.close(); self.el.input.focus(); };
    var write = function () {
      if (req.readOnly) { say("Error writing " + name + ": Permission denied", true); return false; }
      if (!name) { say("File Name to Write: type it in the box that just appeared", false); L.promptBox("File name to write", "program.py", "Save").then(function (n) { if (n && n.trim()) { name = n.trim(); if (write()) head(); } ta.focus(); }); return false; }
      var body = ta.value && !/\n$/.test(ta.value) ? ta.value + "\n" : ta.value, err = req.save ? req.save(name, body) : st.write(name, body);
      if (err) { say("Error writing " + name + ": " + err, true); return false; }
      saved = ta.value;
      var lines = body ? body.split("\n").length - 1 : 0, bad = /\.py$/.test(name) ? L.PiPy.check(body) : null;
      if (bad) say("Wrote " + lines + " lines — but Python will stop at line " + bad.line + ": " + bad.msg, true);
      else say("Wrote " + lines + " line" + (lines === 1 ? "" : "s") + (/\.py$/.test(name) ? " — the syntax looks right" : ""));
      head();
      return !bad || true;
    };
    var leave = function () {
      if (!modified() || req.readOnly) return close();
      asking = "exit";
      status.innerHTML = '<span class="ask">Save modified buffer? &nbsp; <button type="button" data-a="y"><kbd>Y</kbd> Yes</button> <button type="button" data-a="n"><kbd>N</kbd> No</button> <button type="button" data-a="c"><kbd>^C</kbd> Cancel</button></span>';
      status.querySelectorAll("[data-a]").forEach(function (b) { b.addEventListener("click", function () { answer(b.getAttribute("data-a")); }); });
    };
    var answer = function (a) {
      asking = null;
      if (a === "y") { if (write()) close(); }
      else if (a === "n") close();
      else { say("Cancelled"); ta.focus(); }
    };
    var run = function () {
      if (!write()) return;
      var n = name;
      close();
      setTimeout(function () { self.runFile(n); }, 60);
    };
    box.querySelectorAll("[data-n]").forEach(function (b) { b.addEventListener("click", function () { var n = b.getAttribute("data-n"); if (n === "save") write(); else if (n === "exit") leave(); else run(); ta.focus(); }); });
    ta.addEventListener("input", head); ta.addEventListener("scroll", head); ta.addEventListener("keyup", head); ta.addEventListener("click", head);
    ta.addEventListener("keydown", function (e) {
      var k = e.key.toLowerCase();
      e.stopPropagation();
      if (asking) { e.preventDefault(); if (k === "y" || k === "n") answer(k); else if (k === "escape" || (e.ctrlKey && k === "c")) answer("c"); return; }
      if (e.ctrlKey || e.metaKey) {
        if (k === "o" || k === "s") { e.preventDefault(); write(); return; }
        if (k === "x") { if (ta.selectionStart === ta.selectionEnd) { e.preventDefault(); leave(); } return; }
        if (k === "g") { e.preventDefault(); say("^O saves · ^X leaves · F5 saves and runs · Tab indents four spaces"); return; }
        return;
      }
      if (e.key === "F5") { e.preventDefault(); run(); return; }
      if (e.key === "Tab") { e.preventDefault(); document.execCommand("insertText", false, "    "); return; }
      if (e.key === "Enter") {
        var v = ta.value, pos = ta.selectionStart, start = v.lastIndexOf("\n", pos - 1) + 1, lineText = v.slice(start, pos), indent = /^[ \t]*/.exec(lineText)[0];
        if (/:\s*(#.*)?$/.test(lineText) && /\.py$/.test(name)) indent += "    ";
        if (indent) { e.preventDefault(); document.execCommand("insertText", false, "\n" + indent); }
      }
      if (e.key === "Backspace" && ta.selectionStart === ta.selectionEnd) {
        var p2 = ta.selectionStart, s2 = ta.value.lastIndexOf("\n", p2 - 1) + 1, lead = ta.value.slice(s2, p2);
        if (lead.length >= 4 && /^ +$/.test(lead) && lead.length % 4 === 0) { e.preventDefault(); ta.setSelectionRange(p2 - 4, p2); document.execCommand("delete"); }
      }
    });
    head();
    setTimeout(function () { ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0; head(); }, 0);
  };

  /* nano, typed at the prompt, opens the same editor */
  Term.prototype.hookNano = function (m) {
    var self = this;
    if (m.onEdit) return;
    m.onEdit = function (req) { self.edit(req); };
  };

  document.addEventListener("DOMContentLoaded", function () {
    var app = root.chalkLab;
    if (!app || !app.panels) return;
    var term = app.piTerm = new Term(app), make = term.rig.make;
    term.rig.make = function (part) { var e = make.call(term.rig, part); term.hookNano(e.m); return e; };
  });
})(typeof window !== "undefined" ? window : globalThis);
