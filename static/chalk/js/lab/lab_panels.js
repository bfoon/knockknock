/* Chalk Circuit Lab — the panels around the bench.
 *
 *   Inspect   what the selected part is, its settings, and live readings
 *   Check     everything the simulator is worried about, plus wiring checks
 *   Ask AI    explain, diagnose, write the program, or build a circuit
 *   Dock      the program: Code, Blocks, Serial, Pins, Scope
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var esc = L.esc;

  /* Confirm and prompt, in the page. The browser's own confirm() and
   * prompt() are blocked inside sandboxed frames, where they silently
   * answer "no" — and a button that silently does nothing is worse than
   * none. Both resolve a promise. */
  function dialog(message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var d = document.createElement("dialog");
      d.className = "dlg ask";
      d.innerHTML = '<form method="dialog"><p>' + esc(message) + '</p>' +
        (opts.input != null ? '<input name="v" value="' + esc(opts.input) + '" autocomplete="off" aria-label="' + esc(opts.label || message) + '">' : '') +
        '<div class="ask-actions"><button value="no" type="submit">' + esc(opts.no || "Cancel") + '</button>' +
        '<button value="yes" type="submit" class="primary">' + esc(opts.yes || "OK") + '</button></div></form>';
      document.body.appendChild(d);
      var input = d.querySelector("input");
      d.addEventListener("close", function () {
        var ok = d.returnValue === "yes";
        resolve(opts.input != null ? (ok ? input.value : null) : ok);
        d.remove();
      });
      d.showModal();
      if (input) { input.focus(); input.select(); }
    });
  }
  L.confirmBox = function (message, yes, no) { return dialog(message, { yes: yes, no: no }); };
  L.promptBox = function (message, value, yes) { return dialog(message, { input: value || "", yes: yes || "OK" }); };

  function Panels(app) {
    this.app = app;
    this.side = document.getElementById("lab-side");
    this.dock = document.getElementById("lab-dock");
    this.serialLines = [];
    this.plot = [];
    this.buildSide();
    this.buildDock();
  }
  L.Panels = Panels;

  /* =============================================================== SIDE */

  Panels.prototype.buildSide = function () {
    var self = this;
    this.side.innerHTML =
      '<div class="tabs" role="tablist">' +
        '<button role="tab" data-side="inspect" aria-selected="true">Inspect</button>' +
        '<button role="tab" data-side="check" aria-selected="false">Check <span class="count" id="check-count" hidden></span></button>' +
        '<button role="tab" data-side="ai" aria-selected="false">Ask AI</button>' +
        '<button role="tab" data-side="mission" aria-selected="false" class="kid-only">Missions</button>' +
      '</div>' +
      '<section class="pane" data-pane="inspect" id="pane-inspect"></section>' +
      '<section class="pane" data-pane="check" id="pane-check" hidden></section>' +
      '<section class="pane" data-pane="ai" id="pane-ai" hidden></section>' +
      '<section class="pane" data-pane="mission" id="pane-mission" hidden></section>';
    this.side.querySelectorAll("[data-side]").forEach(function (b) {
      b.addEventListener("click", function () { self.showSide(b.getAttribute("data-side")); });
    });
    this.inspect(null);
    this.buildAi();
  };
  Panels.prototype.showSide = function (name) {
    this.side.querySelectorAll("[data-side]").forEach(function (b) { b.setAttribute("aria-selected", b.getAttribute("data-side") === name ? "true" : "false"); });
    this.side.querySelectorAll("[data-pane]").forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== name; });
    this.sideTab = name;
    if (name === "check") this.check();
  };

  /* ------------------------------------------------------------ inspect */

  Panels.prototype.inspect = function (sel) {
    var pane = document.getElementById("pane-inspect"), app = this.app, kid = app.doc && app.doc.mode === "kid";
    this.sel = sel;
    if (!sel) {
      pane.innerHTML = '<div class="empty">' +
        (kid ? '<p class="big">Pick something from the toy box and drop it on the table.</p><p>Join the posts with wires to make a loop. Electricity needs a full circle to flow!</p>'
             : '<p class="big">Select a part to see what it does and change it.</p>' +
               '<p>Drag parts in from the drawer. Drag from a leg or a hole to another to wire them — hover a breadboard hole to see which holes are joined underneath.</p>' +
               '<p class="keys"><kbd>R</kbd> rotate · <kbd>Del</kbd> delete · <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo · <kbd>Space</kbd> power · <kbd>F</kbd> fit</p>') + '</div>';
      return;
    }
    if (sel.kind === "wire") return this.inspectWire(sel.id, pane);
    var part = app.partById(sel.id);
    if (!part) { pane.innerHTML = ""; return; }
    var d = L.def(part), pr = L.propsOf(part), self = this;
    var h = '<header class="insp-head"><h3>' + esc(d.name) + '</h3>' + (d.label ? '<span class="insp-val">' + esc(d.label(pr)) + '</span>' : '') +
            '<p>' + esc(d.blurb || "") + '</p></header>';
    h += '<div class="insp-props">';
    (d.spec || []).forEach(function (sp) { h += self.field(part, sp, pr); });
    if (d.toggle) h += '<label class="row"><span>' + (d.toggle === "on" ? "Switched on" : d.toggle === "tilted" ? "Tipped over" : "On") + '</span><input type="checkbox" data-prop="' + d.toggle + '"' + (pr[d.toggle] ? " checked" : "") + '></label>';
    if (d.press) h += '<p class="hint">Hold it down with the mouse or a finger to press it.</p>';
    h += '</div>';
    h += '<div class="insp-live" id="insp-live"></div>';
    /* change it for something else, or have it wired in */
    var wirable = !d.mcu && !(d.layer === "board") && !/^(multimeter|scope|rf_remote)$/.test(part.type), swaps = L.Coach.swaps(app.doc, part);
    if (swaps.length) {
      var near = swaps.filter(function (s) { return s.close; }), far = swaps.filter(function (s) { return !s.close; });
      var opts = function (list) { return list.map(function (s) { return '<option value="' + s.type + '">' + esc(s.name) + '</option>'; }).join(""); };
      h += '<label class="row insp-swap" for="insp-swap"><span>Change it for</span><select id="insp-swap"><option value="">' + esc(d.name.replace(/ \(.+\)$/, "")) + ' (now)</option>' +
        (near.length ? '<optgroup label="Similar parts">' + opts(near) + '</optgroup>' : '') + (far.length ? '<optgroup label="Other parts that fit its wires">' + opts(far) + '</optgroup>' : '') + '</select></label>';
    }
    if (wirable) h += '<div class="insp-wire"><button type="button" data-act="wire" class="primary" title="Find free pins, add what it needs, and join it up">Wire it for me</button>' +
      '<span class="hint">or drag from a leg yourself — the coach will tell you what each leg wants.</span></div>';
    h += '<div class="insp-actions">' +
      '<button type="button" data-act="rotate">Rotate</button>' +
      (d.layer !== "board" ? '<button type="button" data-act="flip">Flip</button>' : '') +
      '<button type="button" data-act="dupe">Duplicate</button>' +
      '<button type="button" data-act="repair" id="insp-repair" hidden>Replace it</button>' +
      '<button type="button" data-act="delete" class="danger">Delete</button></div>';
    pane.innerHTML = h;
    this.bindFields(pane, part);
    pane.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () { app.partAction(part, b.getAttribute("data-act")); });
    });
    var swapSel = pane.querySelector("#insp-swap");
    if (swapSel) swapSel.addEventListener("change", function () { if (swapSel.value) app.coach.swap(part.id, swapSel.value); });
    this.tickInspect();
  };

  Panels.prototype.field = function (part, sp, pr) {
    var v = pr[sp.k], id = "f-" + sp.k;
    if (sp.type === "select") {
      return '<label class="row" for="' + id + '"><span>' + esc(sp.label) + '</span><select id="' + id + '" data-prop="' + sp.k + '">' +
        sp.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(v) ? " selected" : "") + '>' + esc(o[1]) + '</option>'; }).join("") + '</select></label>';
    }
    if (sp.type === "range") {
      var show = sp.pct ? Math.round(v * 100) + " %" : v + (sp.unit ? " " + sp.unit : "");
      return '<label class="row range" for="' + id + '"><span>' + esc(sp.label) + ' <output>' + esc(show) + '</output></span>' +
        '<input id="' + id + '" type="range" min="' + sp.min + '" max="' + sp.max + '" step="' + sp.step + '" value="' + v + '" data-prop="' + sp.k + '" data-unit="' + esc(sp.pct ? "%" : sp.unit || "") + '"' + (sp.pct ? ' data-pct="1"' : '') + '></label>';
    }
    if (sp.type === "bool") return '<label class="row"><span>' + esc(sp.label) + '</span><input type="checkbox" data-prop="' + sp.k + '"' + (v ? " checked" : "") + '></label>';
    if (sp.type === "ohms") return this.ohmsField(part, pr);
    return "";
  };

  /* Resistance three ways: pick a standard value, type one, or set the
   * colour stripes and read the value off them. */
  Panels.prototype.ohmsField = function (part, pr) {
    var five = pr.style === "metal", bands = L.resistorBands(pr.ohms, five);
    var opts = L.E12.map(function (v) { return '<option value="' + v + '"' + (Math.abs(v - pr.ohms) < 1e-9 ? " selected" : "") + '>' + esc(L.si(v, "Ω")) + '</option>'; }).join("");
    var digitOpts = function (sel) { return L.BANDS.map(function (b, i) { return '<option value="' + b[0] + '"' + (b[0] === sel ? " selected" : "") + '>' + b[0] + '</option>'; }).join(""); };
    var multOpts = function (sel) { return L.BANDS.concat([L.GOLD, L.SILVER]).map(function (b) { return '<option value="' + b[0] + '"' + (b[0] === sel ? " selected" : "") + '>' + b[0] + '</option>'; }).join(""); };
    var digits = five ? 3 : 2, s = '<div class="ohms">' +
      '<label class="row"><span>Resistance</span><select data-ohms="pick">' + opts + '</select></label>' +
      '<label class="row"><span>Or type it</span><input data-ohms="type" value="' + esc(L.si(pr.ohms, "").trim()) + '" placeholder="4.7k" size="8"></label>' +
      '<div class="bands" aria-label="Colour stripes">';
    for (var i = 0; i < digits; i++) s += '<label class="band"><i style="background:' + bands[i][1] + '"></i><select data-band="' + i + '" aria-label="Stripe ' + (i + 1) + '">' + digitOpts(bands[i][0]) + '</select></label>';
    s += '<label class="band"><i style="background:' + bands[digits][1] + '"></i><select data-band="' + digits + '" aria-label="Multiplier stripe">' + multOpts(bands[digits][0]) + '</select></label>';
    s += '<span class="band tol"><i style="background:' + bands[digits + 1][1] + '"></i>' + (five ? "±1%" : "±5%") + '</span></div></div>';
    return s;
  };

  function parseOhms(s) {
    var m = /^\s*([\d.]+)\s*([kKmMrRΩ]?)\s*(\d*)\s*Ω?\s*$/.exec(String(s));
    if (!m) return null;
    var mult = { k: 1e3, K: 1e3, m: 1e6, M: 1e6, r: 1, R: 1, "Ω": 1, "": 1 }[m[2]];
    var v = parseFloat(m[1] + (m[3] ? "." + m[3] : "")) * mult;
    return v > 0 && v < 1e9 ? v : null;
  }

  Panels.prototype.bindFields = function (pane, part) {
    var app = this.app, self = this;
    pane.querySelectorAll("[data-prop]").forEach(function (inp) {
      var k = inp.getAttribute("data-prop");
      var ev = inp.type === "range" ? "input" : "change";
      inp.addEventListener(ev, function () {
        var d = L.def(part), sp = (d.spec || []).filter(function (s) { return s.k === k; })[0] || {};
        var v = inp.type === "checkbox" ? inp.checked : inp.type === "range" ? parseFloat(inp.value) : inp.value;
        if (inp.tagName === "SELECT" && sp.options && typeof sp.options[0][0] === "number") v = parseFloat(v);
        if (inp.type === "range") {
          var out = inp.parentNode.querySelector("output");
          if (out) out.textContent = inp.getAttribute("data-pct") ? Math.round(v * 100) + " %" : v + (inp.getAttribute("data-unit") ? " " + inp.getAttribute("data-unit") : "");
        }
        app.setProp(part, k, v, inp.type === "range");
        if (inp.tagName === "SELECT" && k !== "chip") self.inspect(self.sel);
      });
    });
    var pick = pane.querySelector('[data-ohms="pick"]'), typed = pane.querySelector('[data-ohms="type"]');
    if (pick) pick.addEventListener("change", function () { app.setProp(part, "ohms", parseFloat(pick.value)); self.inspect(self.sel); });
    if (typed) typed.addEventListener("change", function () {
      var v = parseOhms(typed.value);
      if (v == null) { typed.setCustomValidity("Try 220, 4.7k or 1M"); typed.reportValidity(); return; }
      typed.setCustomValidity("");
      app.setProp(part, "ohms", v); self.inspect(self.sel);
    });
    pane.querySelectorAll("[data-band]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        var names = [];
        pane.querySelectorAll("[data-band]").forEach(function (s) { names.push(s.value); });
        names.push("tol");
        app.setProp(part, "ohms", Math.round(L.bandsToOhms(names) * 1000) / 1000);
        self.inspect(self.sel);
      });
    });
  };

  Panels.prototype.inspectWire = function (id, pane) {
    var app = this.app, w = app.wireById(id);
    if (!w) { pane.innerHTML = ""; return; }
    var h = '<header class="insp-head"><h3>Wire</h3><p>Wires join things with almost no resistance — everything on a wire is at the same voltage.</p></header>';
    h += '<div class="swatches" role="radiogroup" aria-label="Wire colour">';
    Object.keys(L.WIRE_COLORS).forEach(function (k) {
      var c = L.WIRE_COLORS[k];
      h += '<button type="button" role="radio" aria-checked="' + (w.color === c) + '" data-color="' + c + '" style="background:' + c + '" aria-label="' + k + '"></button>';
    });
    h += '</div><p class="hint">Red for +, black for ground is the habit that saves you later. Double-click a wire to bend it; drag a bend to move it.</p>';
    h += '<div class="insp-live" id="insp-live"></div>';
    h += '<div class="insp-actions"><button type="button" data-act="straight">Straighten</button><button type="button" data-act="delete" class="danger">Delete</button></div>';
    pane.innerHTML = h;
    pane.querySelectorAll("[data-color]").forEach(function (b) {
      b.addEventListener("click", function () { app.edit(function () { w.color = b.getAttribute("data-color"); }); app.panels.inspect(app.bench.sel); });
    });
    pane.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (b.getAttribute("data-act") === "delete") app.deleteSel();
        else app.edit(function () { w.pts = []; });
      });
    });
    this.tickInspect();
  };

  /* Live readings, refreshed a few times a second. */
  Panels.prototype.tickInspect = function () {
    var box = document.getElementById("insp-live");
    if (!box || !this.sel) return;
    var app = this.app, sim = app.sim;
    if (!app.running) { box.innerHTML = '<p class="hint">Switch the power on to see voltages and currents here.</p>'; return; }
    if (this.sel.kind === "wire") {
      var i = sim.wireI[this.sel.id] || 0, w = app.wireById(this.sel.id), key = w && (w.a.ref || w.b.ref), v = key ? sim.pinVolts(key) : null;
      box.innerHTML = '<dl>' + (v != null ? '<dt>Voltage</dt><dd>' + v.toFixed(2) + ' V</dd>' : '') + '<dt>Current</dt><dd>' + L.si(Math.abs(i), "A") + '</dd></dl>';
      return;
    }
    var part = app.partById(this.sel.id); if (!part) return;
    var d = L.def(part), st = sim.state[part.id] || {}, rows = "";
    if (st.b != null && /led|bulb/.test(part.type)) rows += '<dt>Brightness</dt><dd><meter min="0" max="1" value="' + Math.min(1, st.b) + '"></meter> ' + Math.round(Math.min(1.5, st.b) * 100) + '%</dd>';
    if (st.w != null) rows += '<dt>Speed</dt><dd>' + Math.round(Math.abs(st.w) * 60 / (2 * Math.PI)) + ' rpm ' + (st.w < -1 ? "(backwards)" : "") + '</dd>';
    if (st.ang != null && part.type === "servo") rows += '<dt>Arm</dt><dd>' + Math.round(st.ang) + '°</dd>';
    if (st.p != null) rows += '<dt>Heat</dt><dd>' + L.si(st.p, "W") + '</dd>';
    if (st.burnt) rows += '<dt>State</dt><dd class="bad">Burnt out</dd>';
    var pins = L.pinsOf(part);
    if (!d.layer || d.layer !== "board" || d.mcu) {
      var list = pins.filter(function (q) { return !q.hole; });
      if (list.length <= 10) {
        rows += '<dt class="span">Each leg</dt><dd class="span"><table><tbody>' + list.map(function (q) {
          var v = sim.pinVolts(q.key), cur = sim.pinCurrent(q.key);
          return '<tr><th>' + esc(q.label) + '</th><td>' + (v == null ? "—" : v.toFixed(2) + " V") + '</td><td>' + (Math.abs(cur) > 1e-7 ? L.si(Math.abs(cur), "A") + (cur > 0 ? " in" : " out") : "") + '</td></tr>';
        }).join("") + '</tbody></table></dd>';
      }
    }
    if (pins.length === 2 && !pins[0].hole) {
      var va = sim.pinVolts(pins[0].key), vb = sim.pinVolts(pins[1].key);
      if (va != null && vb != null) rows = '<dt>Across it</dt><dd>' + (va - vb).toFixed(2) + ' V</dd><dt>Through it</dt><dd>' + L.si(Math.abs(sim.pinCurrent(pins[0].key)), "A") + '</dd>' + rows;
    }
    box.innerHTML = '<dl>' + rows + '</dl>';
    var rep = document.getElementById("insp-repair");
    if (rep) rep.hidden = !st.burnt;
  };

  /* --------------------------------------------------------------- check */

  Panels.prototype.check = function () {
    var pane = document.getElementById("pane-check"), app = this.app;
    var list = app.problems();
    var count = document.getElementById("check-count");
    var serious = list.filter(function (x) { return x.level !== "info"; }).length;
    count.hidden = !serious; count.textContent = serious;
    if (this.sideTab !== "check") return;
    var key = JSON.stringify(list.map(function (x) { return x.part + x.code; }));
    if (key === this.lastCheck) return;
    this.lastCheck = key;
    if (!list.length) {
      pane.innerHTML = '<div class="empty"><p class="big">' + (app.running ? "Nothing worrying. The circuit is behaving." : "No wiring problems spotted.") + '</p>' +
        (app.running ? "" : '<p>Some problems only show up with the power on — too much current, a burnt LED, a short. Switch on to check those too.</p>') + '</div>';
      return;
    }
    pane.innerHTML = '<ul class="probs">' + list.map(function (x, i) {
      var p = app.partById(x.part), name = p ? L.def(p).name : "";
      return '<li class="' + x.level + '"><strong>' + esc(name) + '</strong><p>' + esc(x.msg) + '</p>' + (p ? '<button type="button" data-show="' + x.part + '">Show me</button>' : '') +
        (x.fix ? ' <button type="button" class="primary" data-fix="' + i + '">' + esc(x.fix.label) + '</button>' : '') + '</li>';
    }).join("") + '</ul>';
    pane.querySelectorAll("[data-fix]").forEach(function (b) {
      b.addEventListener("click", function () { app.coach.fix(list[+b.getAttribute("data-fix")]); });
    });
    pane.querySelectorAll("[data-show]").forEach(function (b) {
      b.addEventListener("click", function () { app.focusPart(b.getAttribute("data-show")); });
    });
  };

  /* ================================================================== AI */

  var QUICK = {
    pro: [["project", "Design a whole project…"], ["explain", "Explain my circuit"], ["fix", "What's wrong?"], ["code", "Write the program"], ["wire", "Wire the selected part"], ["build", "Build a circuit for me…"], ["body", "Design a body for it…"], ["lesson", "Turn this into a lesson"]],
    kid: [["explain", "What does my circuit do?"], ["fix", "Why doesn't it work?"], ["code", "Make the Robo Brain do something"], ["build", "Build something for me…"], ["body", "Make a body for it…"]]
  };

  Panels.prototype.buildAi = function () {
    var pane = document.getElementById("pane-ai"), self = this;
    pane.innerHTML =
      '<div class="ai-quick" id="ai-quick"></div>' +
      '<div class="ai-log" id="ai-log" aria-live="polite"></div>' +
      '<form class="ai-form" id="ai-form"><textarea id="ai-q" rows="2" placeholder="Ask anything about your circuit or program"></textarea>' +
      '<button type="submit" class="primary">Ask</button></form>' +
      '<p class="fine" id="ai-fine"></p>';
    document.getElementById("ai-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var q = document.getElementById("ai-q").value.trim();
      if (!q) return;
      document.getElementById("ai-q").value = "";
      self.ask(self.pendingKind || "ask", q);
      self.pendingKind = null;
    });
    document.getElementById("ai-q").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); document.getElementById("ai-form").requestSubmit(); }
    });
    this.aiQuick();
  };
  Panels.prototype.aiQuick = function () {
    var self = this, kid = this.app.doc && this.app.doc.mode === "kid", box = document.getElementById("ai-quick");
    box.innerHTML = QUICK[kid ? "kid" : "pro"].map(function (q) { return '<button type="button" data-q="' + q[0] + '">' + esc(q[1]) + '</button>'; }).join("");
    box.querySelectorAll("[data-q]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-q");
        if (k === "project") { self.app.studio.wizard(); return; }
        if (k === "wire") {
          var sel = self.app.bench.sel, app2 = self.app;
          if (!sel || sel.kind !== "part") { app2.toast("Select the part you want wired first — click it on the bench or in Layers."); return; }
          if (app2.cfg.aiEnabled) app2.coach.askAI(sel.id); else app2.coach.offer(sel.id);
          return;
        }
        if (k === "build" || k === "body") {
          self.pendingKind = k;
          var q = document.getElementById("ai-q");
          q.placeholder = k === "body" ? "What should it look like? e.g. a red racing car with a spoiler — or a deep-sea submarine"
            : kid ? "What should it build? e.g. a light that comes on when you press a button" : "Describe it: e.g. a 555 that beeps a buzzer twice a second";
          q.focus();
          return;
        }
        self.ask(k, b.textContent);
      });
    });
    var fine = document.getElementById("ai-fine"), cfg = this.app.cfg;
    fine.textContent = cfg.aiNote ? cfg.aiNote : cfg.aiEnabled ? "Answers come from Gemini through this server. Check anything important — and never test real mains wiring because an AI said so."
                                     : "The AI isn't switched on for this server, so answers come from the lab's built-in checker. Add GEMINI_API_KEY to .env for full answers.";
  };

  Panels.prototype.say = function (who, html, extra) {
    var log = document.getElementById("ai-log"), div = document.createElement("div");
    div.className = "msg " + who;
    div.innerHTML = html;
    if (extra) div.appendChild(extra);
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
    return div;
  };

  Panels.prototype.ask = function (kind, question) {
    var self = this, app = this.app;
    this.showSide("ai");
    this.say("me", esc(question));
    var wait = this.say("bot pending", '<span class="dots" aria-label="Thinking"><i></i><i></i><i></i></span>');
    var payload = { kind: kind, question: question, mode: app.doc.mode, circuit: app.digest(), code: (app.doc.code || "").slice(0, 8000), serial: this.serialLines.slice(-12).join("\n") };
    var done = function (res) {
      wait.remove();
      self.answer(res, kind);
    };
    if (app.cfg.aiEnabled && L.aiTransport) {
      /* Another way to reach an AI (the standalone demo asks Claude
       * directly). Same request, same answer shape, same fallback. */
      L.aiTransport(payload).then(function (j) { done(j && typeof j === "object" ? j : { reply: String(j || "") }); }, function (e) {
        var local = L.localHelper(kind, question, app);
        local.reply = "_" + ((e && e.friendly) || "The AI didn't answer.") + " Here is what the built-in checker can tell you instead._\n\n" + local.reply;
        done(local);
      });
      return;
    }
    /* a body can always be built from the lab's own patterns */
    var fallback = function () { return kind === "body" ? L.localBody(question) : L.localHelper(kind, question, app); };
    if (!app.cfg.aiUrl || !app.cfg.aiEnabled) { setTimeout(function () { done(fallback()); }, 350); return; }
    fetch(app.cfg.aiUrl, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRFToken": app.cfg.csrf },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (r) {
        if (r.status !== 200 || !r.body.ok) {
          var local = fallback();
          local.reply = "_" + (r.body && r.body.error ? r.body.error : "The AI didn't answer.") + " Here is what the built-in checker can tell you instead._\n\n" + local.reply;
          done(local);
        } else done(r.body);
      })
      .catch(function () { var local = fallback(); local.reply = "_Couldn't reach the AI. Here is the built-in checker's view._\n\n" + local.reply; done(local); });
  };

  Panels.prototype.answer = function (res, kind) {
    var app = this.app, self = this, extra = document.createElement("div");
    extra.className = "msg-actions";
    if (res.code) {
      var pre = document.createElement("pre");
      pre.className = "msg-code";
      pre.innerHTML = L.highlightC(res.code);
      extra.appendChild(pre);
      var use = document.createElement("button");
      use.type = "button"; use.className = "primary"; use.textContent = "Use this program";
      use.addEventListener("click", function () { app.useCode(res.code); use.textContent = "Loaded into the editor"; use.disabled = true; });
      extra.appendChild(use);
    }
    if (res.circuit && res.circuit.parts && res.circuit.parts.length) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "primary"; b.textContent = "Build it on the bench";
      b.addEventListener("click", function () {
        var n = app.buildFrom(res.circuit);
        b.textContent = n ? "Built — " + n + " parts added" : "Couldn't build that"; b.disabled = true;
      });
      extra.appendChild(b);
    }
    if (res.body && typeof res.body === "object" && app.studio) {
      var bb = document.createElement("button");
      bb.type = "button"; bb.className = "primary"; bb.textContent = "Build this body";
      bb.addEventListener("click", function () {
        app.studio.setSpace("body");
        var n = app.studio.applyBody(res.body);
        bb.textContent = n ? "Built — " + n + " shapes" : "Couldn't build that"; bb.disabled = true;
      });
      extra.appendChild(bb);
    }
    if (res.example) {
      var ex = (L.EXAMPLES.filter(function (e) { return e.id === res.example; })[0] || {});
      var eb = document.createElement("button");
      eb.type = "button"; eb.className = "primary"; eb.textContent = "Open “" + (ex.name || res.example) + "”";
      eb.addEventListener("click", function () { app.openExample(res.example); });
      extra.appendChild(eb);
    }
    (res.highlights || []).forEach(function (id) { if (app.partById(id)) app.bench.ripple(L.pinsOf(app.partById(id))[0].key, null, "#ff8a5a"); });
    if (res.highlights && res.highlights.length) {
      var s = document.createElement("button");
      s.type = "button"; s.textContent = "Show the parts it means";
      s.addEventListener("click", function () { app.focusPart(res.highlights[0]); app.bench.flag(res.highlights.map(function (id) { return { part: id, level: "warn" }; })); });
      extra.appendChild(s);
    }
    this.say("bot", md(res.reply || ""), extra.childNodes.length ? extra : null);
  };

  /* Just enough markdown for chat: paragraphs, lists, **bold**, _em_, `code`. */
  function md(s) {
    var out = "", list = null;
    String(s).split(/\n/).forEach(function (line) {
      var inl = esc(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/(^|\W)_(.+?)_(\W|$)/g, "$1<em>$2</em>$3");
      var m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
      if (m) {
        var tag = /^\s*\d/.test(line) ? "ol" : "ul";
        if (list !== tag) { if (list) out += "</" + list + ">"; out += "<" + tag + ">"; list = tag; }
        out += "<li>" + inl.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "") + "</li>";
        return;
      }
      if (list) { out += "</" + list + ">"; list = null; }
      if (/^#{1,3}\s/.test(line)) out += "<h4>" + inl.replace(/^#+\s/, "") + "</h4>";
      else if (line.trim()) out += "<p>" + inl + "</p>";
    });
    if (list) out += "</" + list + ">";
    return out;
  }
  L.md = md;

  /* ================================================================ DOCK */

  Panels.prototype.buildDock = function () {
    var self = this, app = this.app;
    this.dock.innerHTML =
      '<div class="dock-bar">' +
        '<div class="tabs" role="tablist">' +
          '<button role="tab" data-dock="code" aria-selected="true" class="pro-only">Code</button>' +
          '<button role="tab" data-dock="blocks" aria-selected="false">Blocks</button>' +
          '<button role="tab" data-dock="serial" aria-selected="false">Serial <span class="count" id="serial-new" hidden></span></button>' +
          '<button role="tab" data-dock="pins" aria-selected="false">Pins &amp; variables</button>' +
          '<button role="tab" data-dock="scope" aria-selected="false" class="pro-only">Scope</button>' +
        '</div>' +
        '<div class="prog-ctl" role="group" aria-label="Program">' +
          '<button type="button" id="p-run" class="primary">Upload &amp; run</button>' +
          '<button type="button" id="p-pause" disabled>Pause</button>' +
          '<button type="button" id="p-step" title="Run one line">Step</button>' +
          '<button type="button" id="p-over" class="pro-only" title="Run one line, treating your own functions as one step">Step over</button>' +
          '<button type="button" id="p-loop" title="Run until loop() starts again">Next loop</button>' +
          '<label class="trace"><span>Pace</span><select id="p-trace">' +
            '<option value="0">Full speed</option><option value="6">Walk — 6 lines/s</option><option value="2">Slow — 2 lines/s</option><option value="0.7">Crawl — 1 line every 1.5 s</option>' +
          '</select></label>' +
        '</div>' +
        '<button type="button" class="dock-toggle" id="dock-toggle" aria-expanded="true" aria-label="Hide the program panel">▾</button>' +
      '</div>' +
      '<p class="narrate" id="narrate" aria-live="polite"></p>' +
      '<div class="dock-body">' +
        '<section data-dpane="code" class="dpane"><div id="code-ed"></div><div class="code-errors" id="code-errors" hidden></div></section>' +
        '<section data-dpane="blocks" class="dpane" hidden><div id="blocks-ed"></div></section>' +
        '<section data-dpane="serial" class="dpane" hidden>' +
          '<div class="serial-wrap"><pre id="serial-out" class="serial-out" tabindex="0" aria-label="Serial monitor"></pre><canvas id="serial-plot" class="serial-plot" hidden></canvas></div>' +
          '<form class="serial-in" id="serial-form"><input id="serial-text" placeholder="Send to the board, e.g. 42" autocomplete="off"><button type="submit">Send</button>' +
          '<label><input type="checkbox" id="serial-plotter"> Plot numbers</label><button type="button" id="serial-clear">Clear</button></form>' +
        '</section>' +
        '<section data-dpane="pins" class="dpane" hidden><div class="pins-grid" id="pins-grid"></div><div class="vars" id="vars"></div></section>' +
        '<section data-dpane="scope" class="dpane" hidden><div class="scope-ctl"><label>Time across the screen <select id="scope-span"><option value="0.05">50 ms</option><option value="0.2">200 ms</option><option value="1">1 s</option><option value="2" selected>2 s</option><option value="5">5 s</option></select></label></div><canvas id="scope-big" class="scope-big"></canvas><p class="hint" id="scope-hint"></p></section>' +
      '</div>';
    this.dock.querySelectorAll("[data-dock]").forEach(function (b) {
      b.addEventListener("click", function () { self.showDock(b.getAttribute("data-dock")); });
    });
    document.getElementById("dock-toggle").addEventListener("click", function () {
      if (app.layout) { app.layout.toggleDock(); return; }
      var open = !self.dock.classList.toggle("closed");
      this.setAttribute("aria-expanded", open ? "true" : "false");
      this.textContent = open ? "▾" : "▴";
      app.bench.resize();
    });
    this.code = new L.CodeEditor(document.getElementById("code-ed"), {
      onChange: function (v) { app.codeChanged(v); },
      onBreaks: function (b) { if (app.rt) app.rt.breakpoints = b; }
    });
    this.blocks = new L.Blocks.Editor(document.getElementById("blocks-ed"), {
      mode: app.doc.mode, prog: app.doc.blocks || L.Blocks.blank(app.doc.mode),
      onChange: function (prog) { app.blocksChanged(prog); }
    });
    document.getElementById("p-run").addEventListener("click", function () { app.runProgram(); });
    document.getElementById("p-pause").addEventListener("click", function () { app.togglePause(); });
    document.getElementById("p-step").addEventListener("click", function () { app.step("line"); });
    document.getElementById("p-over").addEventListener("click", function () { app.step("over"); });
    document.getElementById("p-loop").addEventListener("click", function () { app.step("loop"); });
    document.getElementById("p-trace").addEventListener("change", function () { app.setTrace(parseFloat(this.value)); });
    document.getElementById("serial-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var t = document.getElementById("serial-text");
      if (app.rt) app.rt.send(t.value + "\n");
      self.serial("> " + t.value + "\n", true);
      t.value = "";
    });
    document.getElementById("serial-clear").addEventListener("click", function () { self.serialLines = []; self.plot = []; document.getElementById("serial-out").textContent = ""; });
    document.getElementById("serial-plotter").addEventListener("change", function () {
      document.getElementById("serial-plot").hidden = !this.checked;
      document.getElementById("serial-out").hidden = this.checked;
    });
    document.getElementById("scope-span").addEventListener("change", function () { app.sim.scopeSpan = parseFloat(this.value); });
  };

  Panels.prototype.showDock = function (name) {
    this.dock.querySelectorAll("[data-dock]").forEach(function (b) { b.setAttribute("aria-selected", b.getAttribute("data-dock") === name ? "true" : "false"); });
    this.dock.querySelectorAll("[data-dpane]").forEach(function (p) { p.hidden = p.getAttribute("data-dpane") !== name; });
    this.dockTab = name;
    if (name === "blocks" && !this.app.doc.blocks) { this.app.doc.blocks = L.Blocks.blank(this.app.doc.mode); this.blocks.setProgram(this.app.doc.blocks); }
    if (name === "serial") document.getElementById("serial-new").hidden = true;
    if (this.dock.classList.contains("closed")) document.getElementById("dock-toggle").click();
    if (name === "code") this.code.paint();
  };

  Panels.prototype.progState = function (rt, running) {
    var on = !!(rt && rt.running);
    var run = document.getElementById("p-run"), pause = document.getElementById("p-pause");
    run.textContent = on ? "Restart" : (this.app.doc.mode === "kid" ? "Go!" : "Upload & run");
    pause.disabled = !on;
    pause.textContent = on && rt.paused ? "Continue" : "Pause";
    this.dock.classList.toggle("prog-on", on);
    this.dock.classList.toggle("prog-paused", on && rt.paused);
  };

  Panels.prototype.narrate = function (html) { document.getElementById("narrate").innerHTML = html || ""; };

  Panels.prototype.serial = function (text, mine, board) {
    var out = document.getElementById("serial-out");
    var atBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 8;
    var span = document.createElement("span");
    if (mine) span.className = "mine";
    if (board) {
      /* with several boards, each line says which one spoke */
      var lines = text.split(/(\n)/), outText = "", self = this;
      lines.forEach(function (piece) {
        if (piece !== "\n" && piece && self.lastBoardLineStart !== false) outText += "[" + board + "] ";
        outText += piece;
        self.lastBoardLineStart = piece === "\n" ? true : piece ? false : self.lastBoardLineStart;
      });
      text = outText;
    }
    span.textContent = text;
    out.appendChild(span);
    while (out.childNodes.length > 600) out.removeChild(out.firstChild);
    if (atBottom) out.scrollTop = out.scrollHeight;
    if (!mine) {
      this.lineBuf = (this.lineBuf || "") + text;
      var parts = this.lineBuf.split("\n");
      this.lineBuf = parts.pop();
      var self = this;
      parts.forEach(function (ln) {
        self.serialLines.push(ln);
        if (self.serialLines.length > 200) self.serialLines.shift();
        var nums = (ln.match(/-?\d+(\.\d+)?/g) || []).map(parseFloat);
        if (nums.length) { self.plot.push(nums.slice(0, 4)); if (self.plot.length > 240) self.plot.shift(); }
      });
      if (this.dockTab !== "serial") { var c = document.getElementById("serial-new"); c.hidden = false; c.textContent = "•"; }
    }
  };

  /* A few times a second: the pin table, variables, scope and plotter. */
  Panels.prototype.tick = function () {
    var app = this.app, rt = app.rt;
    if (this.sideTab === "inspect" || !this.sideTab) this.tickInspect();
    this.check();
    if (this.dockTab === "pins") this.pins(rt);
    if (this.dockTab === "scope") this.scope();
    if (this.dockTab === "serial" && document.getElementById("serial-plotter").checked) this.plotter();
  };

  Panels.prototype.pins = function (rt) {
    var app = this.app, grid = document.getElementById("pins-grid"), vars = document.getElementById("vars");
    var mcu = app.currentMcu ? app.currentMcu() : L.firstMcu(app.doc);
    if (!mcu) { grid.innerHTML = '<p class="hint">Add an Arduino (or the Robo Brain) to see its pins here.</p>'; vars.innerHTML = ""; return; }
    var kid = mcu.type === "k_brain", h = "";
    var list = kid ? Object.keys(L.BRAIN_MAP).map(function (k) { return [k, L.PINNUM[L.BRAIN_MAP[k]]]; })
                   : Object.keys(L.PINNUM).filter(function (k) { return mcu.type === "arduino_nano" || !/A[67]/.test(k); }).map(function (k) { return [k, L.PINNUM[k]]; });
    list.forEach(function (pp) {
      var ps = rt && rt.pins[pp[1]], v = app.running ? app.sim.mcuVolts(mcu.id, pp[1]) : 0;
      var mode = !ps ? "—" : ps.mode === "OUT" ? (ps.tone ? "tone " + ps.tone + " Hz" : ps.pwm != null ? "PWM " + Math.round(ps.pwm / 2.55) + "%" : "OUTPUT") : ps.mode === "PU" ? "PULLUP" : "INPUT";
      var level = v > 2.5 ? "hi" : "lo";
      var analog = pp[1] >= 14 ? '<small>' + Math.round(L.clamp(v / 5, 0, 1) * 1023) + '</small>' : '';
      h += '<div class="pin ' + (ps ? level : "idle") + '"><b>' + esc(kid ? pp[0].replace(/(\d)/, " $1") : pp[0]) + '</b><i></i><span>' + mode + '</span><em>' + v.toFixed(2) + ' V</em>' + analog + '</div>';
    });
    grid.innerHTML = h;
    var snap = rt ? rt.snapshot() : [];
    vars.innerHTML = snap.length ? '<table><thead><tr><th>Variable</th><th>Type</th><th>Value</th></tr></thead><tbody>' +
      snap.map(function (v) { return '<tr><td>' + esc(v.name) + '</td><td>' + esc(v.ty) + '</td><td>' + esc(v.v) + '</td></tr>'; }).join("") + '</tbody></table>'
      : '<p class="hint">Global variables appear here while the program runs.</p>';
  };

  function plotLines(cv, series, colors, top, bottom, labels) {
    var r = cv.getBoundingClientRect(), dpr = root.devicePixelRatio || 1;
    cv.width = Math.max(10, r.width * dpr); cv.height = Math.max(10, r.height * dpr);
    var c = cv.getContext("2d"), W = cv.width, H = cv.height;
    c.fillStyle = "#06110c"; c.fillRect(0, 0, W, H);
    c.strokeStyle = "rgba(90,160,120,.18)"; c.lineWidth = 1;
    for (var i = 1; i < 10; i++) { c.beginPath(); c.moveTo(W * i / 10, 0); c.lineTo(W * i / 10, H); c.stroke(); }
    for (i = 1; i < 6; i++) { c.beginPath(); c.moveTo(0, H * i / 6); c.lineTo(W, H * i / 6); c.stroke(); }
    c.font = (11 * dpr) + "px system-ui, sans-serif"; c.fillStyle = "rgba(200,230,210,.7)";
    if (labels) { c.fillText(labels[0], 6 * dpr, 14 * dpr); c.fillText(labels[1], 6 * dpr, H - 6 * dpr); }
    series.forEach(function (arr, k) {
      if (!arr || arr.length < 2) return;
      c.strokeStyle = colors[k]; c.lineWidth = 2 * dpr; c.beginPath();
      arr.forEach(function (v, j) {
        var x = W * j / (arr.length - 1), y = H - (v - bottom) / (top - bottom || 1) * H * 0.9 - H * 0.05;
        if (j) c.lineTo(x, y); else c.moveTo(x, y);
      });
      c.stroke();
    });
  }

  Panels.prototype.scope = function () {
    var app = this.app, sc = app.doc.parts.filter(function (p) { return p.type === "scope"; })[0];
    var hint = document.getElementById("scope-hint"), cv = document.getElementById("scope-big");
    if (!sc) { hint.textContent = "Add an oscilloscope from the Measure drawer and clip its CH1 and GND to your circuit."; plotLines(cv, [], [], 1, 0); return; }
    var st = app.sim.state[sc.id] || {}, tr = st.trace || [[], []], top = st.vmax || 5;
    hint.textContent = "Yellow is CH1, cyan is CH2. Full height is " + top + " V.";
    plotLines(cv, tr, ["#ffe14a", "#4adfff"], top, 0, [top + " V", "0 V"]);
  };

  Panels.prototype.plotter = function () {
    var data = this.plot, n = data.reduce(function (m, r) { return Math.max(m, r.length); }, 0), series = [];
    var lo = Infinity, hi = -Infinity;
    for (var k = 0; k < n; k++) series.push(data.map(function (r) { var v = r[k] == null ? 0 : r[k]; lo = Math.min(lo, v); hi = Math.max(hi, v); return v; }));
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (hi === lo) hi = lo + 1;
    plotLines(document.getElementById("serial-plot"), series, ["#ffe14a", "#4adfff", "#ff7aa8", "#9dff7a"], hi, lo, [String(hi), String(lo)]);
  };
})(typeof window !== "undefined" ? window : globalThis);
