/* Chalk Circuit Lab — coding with the AI.
 *
 * The AI never types into your program behind your back. Whatever it
 * writes comes back as a set of changes you review one by one, like a
 * pull request: keep this, not that, then apply. Undo still works after.
 *
 *   Write it for me   describe the program, get a whole sketch
 *   Change my code    "make it fade instead", "add a second button" —
 *                     on the selection if there is one, else the file
 *   Fix it            uses the real compile errors and simulator problems
 *   Continue          carries on from where the cursor is
 *   Explain           what the selected lines (or the program) do
 *
 * Without an AI, the strip still helps: compile errors get one-click
 * fixes, Fix applies them all, Explain works from a built-in glossary,
 * and Write produces a starter sketch from the wiring.
 *
 * In the Blocks tab the same strip asks for blocks — in kid mode that is
 * "tell Sparky what the Robo Brain should do".
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var esc = L.esc;

  /* ----------------------------------------------------------- diffing */

  /* Line diff by longest common subsequence. Sketches are small, so the
   * simple quadratic table is quick enough and easy to trust. */
  function diff(a, b) {
    var n = a.length, m = b.length, i, j;
    var t = [];
    for (i = 0; i <= n; i++) { t.push(new Uint16Array(m + 1)); }
    for (i = n - 1; i >= 0; i--) for (j = m - 1; j >= 0; j--)
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    var ops = [];
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push({ k: "=", a: a[i], ia: i }); i++; j++; }
      else if (t[i + 1][j] >= t[i][j + 1]) { ops.push({ k: "-", a: a[i], ia: i }); i++; }
      else { ops.push({ k: "+", b: b[j] }); j++; }
    }
    while (i < n) { ops.push({ k: "-", a: a[i], ia: i }); i++; }
    while (j < m) { ops.push({ k: "+", b: b[j] }); j++; }
    return ops;
  }
  /* Group the changes into hunks with a little context either side. */
  function hunks(ops) {
    var out = [], cur = null;
    ops.forEach(function (op, idx) {
      if (op.k === "=") { cur = null; return; }
      if (!cur) { cur = { start: idx, ops: [], keep: true }; out.push(cur); }
      cur.ops.push(idx);
    });
    return out;
  }
  function merge(ops, hs) {
    var take = {};
    hs.forEach(function (h) { h.ops.forEach(function (i) { take[i] = h.keep; }); });
    var lines = [];
    ops.forEach(function (op, i) {
      if (op.k === "=") lines.push(op.a);
      else if (op.k === "-") { if (!take[i]) lines.push(op.a); }
      else if (take[i]) lines.push(op.b);
    });
    return lines.join("\n");
  }
  L.diffLines = diff;

  /* ------------------------------------------------------- quick fixes */

  /* A fix for a compile error the lab can be sure about, or null. */
  L.quickFix = function (code, err) {
    var lines = code.split("\n"), i = err.line - 1, m;
    if (i < 0 || i >= lines.length) i = 0;
    if (/^Missing ; /.test(err.msg)) {
      var ln = lines[i], cut = ln.indexOf("//"), body = cut >= 0 ? ln.slice(0, cut) : ln, tail = cut >= 0 ? ln.slice(cut) : "";
      var trimmed = body.replace(/\s+$/, "");
      lines[i] = trimmed + ";" + body.slice(trimmed.length) + tail;
      return { label: "Add the ;", code: lines.join("\n") };
    }
    if ((m = /'(\w+)' hasn't been declared\. Did you mean (\w+)\?/.exec(err.msg)) || (m = /There's no function called (\w+)\(\)\. Did you mean (\w+)\(\)\?/.exec(err.msg))) {
      var re = new RegExp("\\b" + m[1] + "\\b", "g");
      lines[i] = lines[i].replace(re, m[2]);
      return { label: "Use " + m[2], code: lines.join("\n") };
    }
    if ((m = /'(\w+)' hasn't been declared\. Declare it first/.exec(err.msg))) {
      var at = 0;
      for (var k = 0; k < lines.length; k++) if (/^\s*#/.test(lines[k])) at = k + 1;
      lines.splice(at, 0, "int " + m[1] + " = 0;");
      return { label: "Declare " + m[1], code: lines.join("\n") };
    }
    if (/needs a setup\(\)/.test(err.msg)) return { label: "Add setup()", code: code.replace(/\s*$/, "\n\nvoid setup() {\n}\n") };
    if (/needs a loop\(\)/.test(err.msg)) return { label: "Add loop()", code: code.replace(/\s*$/, "\n\nvoid loop() {\n}\n") };
    return null;
  };
  /* Keep applying sure fixes until the sketch compiles or none are left. */
  L.fixAll = function (code) {
    var n = 0;
    for (var round = 0; round < 12; round++) {
      var c = L.MCU.compile(code);
      if (c.ok) break;
      var fixed = null;
      for (var e = 0; e < c.errors.length && !fixed; e++) fixed = L.quickFix(code, c.errors[e]);
      if (!fixed || fixed.code === code) break;
      code = fixed.code; n++;
    }
    return { code: code, count: n, ok: L.MCU.compile(code).ok };
  };

  /* ---------------------------------------------- built-in explanations */

  var GLOSS = [
    [/\bpinMode\s*\(\s*([^,]+),\s*OUTPUT/, "sets pin $1 as an **output**, so the program can switch it between 0 V and 5 V."],
    [/\bpinMode\s*\(\s*([^,]+),\s*INPUT_PULLUP/, "makes pin $1 an **input with a pull-up**: it reads HIGH until something joins it to ground."],
    [/\bpinMode\s*\(\s*([^,]+),\s*INPUT/, "makes pin $1 an **input**, ready to read whether it is HIGH or LOW."],
    [/\bdigitalWrite\s*\(\s*([^,]+),\s*HIGH/, "turns pin $1 **on**: it pushes out 5 V."],
    [/\bdigitalWrite\s*\(\s*([^,]+),\s*LOW/, "turns pin $1 **off**: it drops to 0 V."],
    [/\bdigitalRead\s*\(\s*([^)]+)\)/, "reads pin $1: HIGH (1) if it is above about 2.5 V, LOW (0) if below."],
    [/\banalogRead\s*\(\s*([^)]+)\)/, "measures the voltage on $1 and turns it into a number from 0 (0 V) to 1023 (5 V)."],
    [/\banalogWrite\s*\(\s*([^,]+),\s*([^)]+)\)/, "sets PWM on pin $1 to $2 out of 255 — the pin flicks on and off so fast it behaves like a lower voltage."],
    [/\bdelay\s*\(\s*([^)]+)\)/, "waits $1 milliseconds. Nothing else in the program happens meanwhile."],
    [/\bdelayMicroseconds\s*\(\s*([^)]+)\)/, "waits $1 millionths of a second."],
    [/\bmillis\s*\(\s*\)/, "is the number of milliseconds since the board started — a clock to check without stopping."],
    [/\btone\s*\(\s*([^,]+),\s*([^,)]+)/, "plays a $2 Hz note on pin $1 (through a piezo speaker)."],
    [/\bnoTone\s*\(/, "stops the note."],
    [/\bmap\s*\(/, "re-scales a number from one range to another, like 0–1023 into 0–180."],
    [/\bconstrain\s*\(/, "keeps a number between a low and a high limit."],
    [/\bSerial\.begin\s*\(\s*([^)]+)\)/, "starts talking to the computer at $1 bits per second."],
    [/\bSerial\.print(ln)?\s*\(/, "sends text to the Serial monitor."],
    [/\.attach\s*\(\s*([^)]+)\)/, "connects a servo to pin $1."],
    [/\.write\s*\(\s*([^)]+)\)/, "tells the servo (or screen) to go to / show $1."],
    [/\bpulseIn\s*\(/, "times how long a pin stays HIGH — that's how the ultrasonic sensor measures an echo."],
    [/\bfor\s*\(/, "repeats the code inside its { } a set number of times."],
    [/\bwhile\s*\(/, "keeps repeating while its condition is true."],
    [/\bif\s*\(/, "only runs the code inside its { } when the condition is true."],
    [/\bvoid\s+setup\s*\(/, "**setup()** runs once, when the board powers up."],
    [/\bvoid\s+loop\s*\(/, "**loop()** runs over and over, forever, after setup()."],
    [/^\s*(const\s+)?(int|long|float|bool|byte|unsigned long|String)\s+(\w+)/, "makes a variable called **$3** that holds a $2."]
  ];
  L.explainCode = function (text) {
    var out = [];
    String(text).split("\n").forEach(function (ln) {
      var code = ln.replace(/\/\/.*$/, "").trim();
      if (!code) return;
      for (var i = 0; i < GLOSS.length; i++) {
        var m = GLOSS[i][0].exec(code);
        if (m) {
          var say = GLOSS[i][1].replace(/\$(\d)/g, function (x, n) { return (m[+n] || "").trim(); });
          out.push("- `" + code.slice(0, 60) + "` " + say);
          return;
        }
      }
    });
    if (!out.length) return "I can't explain that one without the AI — try selecting lines that call Arduino functions like digitalWrite or analogRead.";
    return out.slice(0, 14).join("\n");
  };

  /* ---------------------------------------------------------- the strip */

  var MODES = {
    write:   { label: "Write it for me", ph: "Describe the program, e.g. blink the LED on pin 13 faster when the button on pin 2 is held", needsText: true },
    edit:    { label: "Change my code", ph: "What should change? e.g. fade the LED instead of blinking, or add a second button", needsText: true },
    fixcode: { label: "Fix it", ph: "Optional: what's going wrong?", needsText: false },
    "continue": { label: "Continue from cursor", ph: "Optional: what should come next?", needsText: false },
    explaincode: { label: "Explain", ph: "Optional: a question about the code", needsText: false }
  };

  function Copilot(app) {
    this.app = app;
    this.mode = "write";
    this.buildCode();
    this.buildBlocks();
  }
  L.Copilot = Copilot;

  Copilot.prototype.buildCode = function () {
    var self = this, pane = document.querySelector('[data-dpane="code"]');
    var strip = document.createElement("div");
    strip.className = "cp";
    strip.innerHTML =
      '<button type="button" class="cp-open" aria-expanded="false">✨ Code with AI</button>' +
      '<div class="cp-body" hidden>' +
        '<div class="cp-modes" role="tablist" aria-label="What should the AI do?">' +
          Object.keys(MODES).map(function (k) { return '<button type="button" role="tab" data-cp="' + k + '" aria-selected="' + (k === "write") + '">' + esc(MODES[k].label) + '</button>'; }).join("") +
        '</div>' +
        '<form class="cp-form"><textarea rows="2" aria-label="Instructions for the AI"></textarea>' +
          '<div class="cp-go"><span class="cp-scope" aria-live="polite"></span><button type="submit" class="primary">Ask</button><button type="button" class="cp-close" aria-label="Close">×</button></div></form>' +
        '<div class="cp-out" aria-live="polite"></div>' +
      '</div>';
    pane.insertBefore(strip, pane.firstChild);
    this.strip = strip;
    this.ta = strip.querySelector("textarea");
    strip.querySelector(".cp-open").addEventListener("click", function () { self.toggle(true); });
    strip.querySelector(".cp-close").addEventListener("click", function () { self.toggle(false); });
    strip.querySelectorAll("[data-cp]").forEach(function (b) { b.addEventListener("click", function () { self.setMode(b.getAttribute("data-cp")); }); });
    strip.querySelector("form").addEventListener("submit", function (e) { e.preventDefault(); self.send(); });
    this.ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); self.send(); } });
    var ed = this.app.panels.code.ta;
    ["select", "keyup", "mouseup"].forEach(function (ev) { ed.addEventListener(ev, function () { self.scope(); }); });
    this.setMode("write");
  };

  Copilot.prototype.toggle = function (open) {
    this.strip.querySelector(".cp-body").hidden = !open;
    this.strip.querySelector(".cp-open").hidden = open;
    this.strip.querySelector(".cp-open").setAttribute("aria-expanded", open ? "true" : "false");
    if (open) { this.scope(); this.ta.focus(); }
    var self = this;
    requestAnimationFrame(function () { self.app.panels.code.paint(); });
  };
  Copilot.prototype.setMode = function (k) {
    this.mode = k;
    this.strip.querySelectorAll("[data-cp]").forEach(function (b) { b.setAttribute("aria-selected", b.getAttribute("data-cp") === k ? "true" : "false"); });
    this.ta.placeholder = MODES[k].ph;
    this.scope();
  };

  /* Which lines are we talking about? */
  Copilot.prototype.selection = function () {
    var ta = this.app.panels.code.ta, v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
    var lineOf = function (pos) { return v.slice(0, pos).split("\n").length; };
    if (e > s) return { from: lineOf(s), to: lineOf(e - 1), text: v.slice(s, e) };
    return { from: 0, to: 0, text: "", cursor: lineOf(s) };
  };
  Copilot.prototype.scope = function () {
    var el = this.strip.querySelector(".cp-scope"), sel = this.selection(), k = this.mode;
    if (k === "write") el.textContent = (this.app.doc.code || "").trim() ? "Replaces the whole program (you review it first)" : "Writes a new program";
    else if (k === "continue") el.textContent = "From line " + (sel.cursor || sel.to || 1);
    else el.textContent = sel.text ? "Lines " + sel.from + "–" + sel.to : "The whole program";
  };

  Copilot.prototype.payload = function (kind, instruction, sel) {
    var app = this.app, c = L.MCU.compile(app.doc.code || "");
    return {
      kind: kind, question: instruction, mode: app.doc.mode,
      code: (app.doc.code || "").slice(0, 20000),
      selection: sel && sel.text ? { from: sel.from, to: sel.to } : null,
      cursor: sel ? (sel.cursor || sel.to || 0) : 0,
      errors: c.ok ? [] : c.errors.slice(0, 6),
      runtime: app.rt && app.rt.error ? app.rt.error : null,
      circuit: app.digest(),
      serial: app.panels.serialLines.slice(-12).join("\n")
    };
  };

  /* One way to reach the AI, whichever is configured. Rejects {offline}. */
  Copilot.prototype.request = function (payload) {
    var cfg = this.app.cfg;
    if (cfg.aiEnabled && L.aiTransport) return L.aiTransport(payload);
    if (!cfg.aiEnabled || !cfg.aiUrl) return Promise.reject({ offline: true });
    return fetch(cfg.aiUrl, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRFToken": cfg.csrf },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (r) {
        if (r.status !== 200 || !r.j.ok) throw { friendly: (r.j && r.j.error) || "The AI didn't answer." };
        return r.j;
      });
  };

  Copilot.prototype.say = function (html, kind) {
    var out = this.strip.querySelector(".cp-out");
    out.className = "cp-out" + (kind ? " " + kind : "");
    out.innerHTML = html;
  };

  Copilot.prototype.send = function () {
    var self = this, app = this.app, k = this.mode, text = this.ta.value.trim(), sel = this.selection();
    if (MODES[k].needsText && !text) { this.ta.focus(); this.say("Tell it what you'd like first.", "warn"); return; }
    var before = app.doc.code || "";
    this.say('<span class="dots" aria-label="Thinking"><i></i><i></i><i></i></span> ' + (k === "write" ? "Writing your program…" : k === "fixcode" ? "Looking for problems…" : "Thinking…"));
    this.busy = true;
    this.request(this.payload(k, text, sel)).then(function (res) {
      self.busy = false;
      if (k === "explaincode") { self.say(L.md(res.reply || "")); return; }
      if (!res.code) { self.say(L.md(res.reply || "The AI didn't suggest a change.")); return; }
      self.review(before, res.code, res.reply);
    }, function (err) {
      self.busy = false;
      if (err && err.offline) return self.offline(k, text, sel, before);
      self.say(esc((err && err.friendly) || "The AI couldn't do that just now.") + " " + self.offlineHint(k), "warn");
    });
  };

  Copilot.prototype.offlineHint = function (k) {
    return k === "fixcode" ? "The built-in fixer can still try — switch the AI off, or use the Fix buttons on the errors." : "";
  };

  /* What the lab can do with no AI at all. */
  Copilot.prototype.offline = function (k, text, sel, before) {
    var app = this.app;
    if (k === "fixcode") {
      var f = L.fixAll(before);
      if (!f.count) { this.say(L.MCU.compile(before).ok ? "The program compiles. If it runs but does the wrong thing, the AI can help — it isn't switched on here." : "I can't fix these errors automatically. Each one in the list says what's wrong — click it to jump to the line.", "warn"); return; }
      this.review(before, f.code, "Fixed " + f.count + " problem" + (f.count > 1 ? "s" : "") + (f.ok ? ". It compiles now." : ". Some errors are left for you."));
      return;
    }
    if (k === "explaincode") { this.say(L.md(L.explainCode(sel.text || before))); return; }
    if (k === "write") {
      var s = L.starterCode(app.doc, app.sim, app.currentMcu());
      if (s && (s.outs.length || s.ins.length || s.analogs.length || s.servos.length)) {
        this.review(before, s.code, "The AI isn't switched on, so this is a starter written by looking at your wiring. Shape it into what you described.");
        return;
      }
    }
    this.say("That needs the AI, which isn't switched on here. " + (app.cfg.aiUrl ? "Add GEMINI_API_KEY to the server's .env." : "") + " Fix and Explain still work without it.", "warn");
  };

  /* ------------------------------------------------------------ review */

  Copilot.prototype.review = function (before, after, reply) {
    var self = this, app = this.app;
    var a = before.replace(/\s+$/, "").split("\n"), b = String(after).replace(/\s+$/, "").split("\n");
    var ops = diff(a, b), hs = hunks(ops);
    if (!hs.length) { this.say(L.md((reply || "") + "\n\nNo changes to your code."), ""); return; }
    var box = document.createElement("div");
    box.className = "cp-review";
    var h = '<div class="cp-review-head"><div>' + L.md(reply || "") + '<p class="cp-count">' + hs.length + ' change' + (hs.length > 1 ? "s" : "") + '. Untick any you don\'t want.</p></div>' +
            '<div class="cp-review-act"><button type="button" class="primary" data-r="apply">Apply</button><button type="button" data-r="all">Apply all</button><button type="button" data-r="none">Discard</button></div></div><div class="cp-diff">';
    var inHunk = {};
    hs.forEach(function (hk, n) { hk.ops.forEach(function (i) { inHunk[i] = n; }); });
    var lastH = -1, ctxAfter = 0;
    ops.forEach(function (op, i) {
      var hn = inHunk[i];
      if (hn == null) {
        /* two lines of context around each change; the rest folds */
        var near = false;
        for (var d = 1; d <= 2; d++) { if (inHunk[i - d] != null || inHunk[i + d] != null) near = true; }
        if (near) h += '<div class="dl ctx"><i>' + (op.ia + 1) + '</i><code>' + esc(op.a) + '</code></div>';
        else if (!h.endsWith('<div class="dl fold">⋯</div>')) h += '<div class="dl fold">⋯</div>';
        return;
      }
      if (hn !== lastH) {
        if (lastH >= 0) h += '</div>';
        h += '<div class="hunk" data-h="' + hn + '"><label class="hunk-keep"><input type="checkbox" checked data-keep="' + hn + '"> Keep change ' + (hn + 1) + '</label>';
        lastH = hn;
      }
      h += op.k === "-" ? '<div class="dl del"><i>' + (op.ia + 1) + '</i><code>' + esc(op.a) + '</code></div>'
                        : '<div class="dl add"><i>+</i><code>' + esc(op.b) + '</code></div>';
      if (inHunk[i + 1] !== hn) { h += '</div>'; lastH = -2; }
    });
    h += '</div>';
    box.innerHTML = h;
    var pane = document.querySelector('[data-dpane="code"]');
    var old = pane.querySelector(".cp-review");
    if (old) old.remove();
    pane.appendChild(box);
    this.say("Review the changes below, then apply.", "");
    box.querySelectorAll("[data-keep]").forEach(function (c) {
      c.addEventListener("change", function () {
        hs[+c.getAttribute("data-keep")].keep = c.checked;
        c.closest(".hunk").classList.toggle("off", !c.checked);
      });
    });
    var finish = function (mode) {
      box.remove();
      if (mode === "none") { self.say("Discarded. Your code is unchanged.", ""); return; }
      if ((app.doc.code || "") !== before) { self.say("Your code changed while the AI was working, so nothing was applied. Ask again.", "warn"); return; }
      if (mode === "all") hs.forEach(function (x) { x.keep = true; });
      var merged = merge(ops, hs) + "\n";
      var kept = hs.filter(function (x) { return x.keep; }).length;
      app.useCode(merged);
      self.say("Applied " + kept + " of " + hs.length + " change" + (hs.length > 1 ? "s" : "") + ". Undo (Ctrl+Z) puts your old code back.", "ok");
    };
    box.querySelectorAll("[data-r]").forEach(function (btn) { btn.addEventListener("click", function () { finish(btn.getAttribute("data-r")); }); });
  };

  /* ------------------------------------------------- blocks, by talking */

  Copilot.prototype.buildBlocks = function () {
    var self = this, pane = document.querySelector('[data-dpane="blocks"]');
    var strip = document.createElement("form");
    strip.className = "cp cp-blocks";
    strip.innerHTML = '<label class="cp-say"><span class="sr">What should the program do?</span><input autocomplete="off"></label>' +
                      '<button type="submit" class="primary">Build blocks</button><span class="cp-out" aria-live="polite"></span>';
    pane.insertBefore(strip, pane.firstChild);
    this.bstrip = strip;
    strip.addEventListener("submit", function (e) { e.preventDefault(); self.blocks(strip.querySelector("input").value.trim()); });
    this.blocksPlaceholder();
  };
  Copilot.prototype.blocksPlaceholder = function () {
    var kid = this.app.doc.mode === "kid", inp = this.bstrip.querySelector("input");
    inp.placeholder = kid ? "Tell Sparky what the Robo Brain should do — e.g. blink OUT 1 three times, then beep" : "Describe it and get blocks — e.g. when the button on pin 2 is pressed, turn on pin 13";
    this.bstrip.querySelector("button").textContent = kid ? "Ask Sparky" : "Build blocks";
  };

  Copilot.prototype.blocks = function (text) {
    var self = this, app = this.app, out = this.bstrip.querySelector(".cp-out");
    if (!text) { this.bstrip.querySelector("input").focus(); return; }
    out.innerHTML = '<span class="dots" aria-label="Thinking"><i></i><i></i><i></i></span>';
    var payload = this.payload("blocks", text, null);
    this.request(payload).then(function (res) {
      var prog = L.Blocks.sanitize(res.blocks, app.doc.mode);
      if (!prog) { out.textContent = res.reply ? String(res.reply).slice(0, 200) : "No blocks came back. Try saying it another way."; return; }
      self.applyBlocks(prog, res.reply);
    }, function (err) {
      if (err && err.offline) {
        var guess = L.Blocks.guess(text, app.doc.mode);
        if (guess) { self.applyBlocks(guess, "The AI isn't switched on, so I matched your words to a ready-made program."); return; }
        out.textContent = "That needs the AI, which isn't switched on here. Try “blink”, “traffic light”, “doorbell” or “night light”.";
        return;
      }
      out.textContent = (err && err.friendly) || "That didn't work just now.";
    });
  };
  Copilot.prototype.applyBlocks = function (prog, reply) {
    var app = this.app, out = this.bstrip.querySelector(".cp-out");
    app.history.push(app.doc);
    app.doc.blocks = prog;
    app.panels.blocks.setProgram(prog);
    app.blocksOk = true;
    app.blocksChanged(prog);
    out.textContent = (reply ? String(reply).replace(/[*_`]/g, "").slice(0, 160) + " " : "") + "Undo puts the old blocks back.";
    if (app.doc.mode === "kid") app.kid.say("Here are your blocks! Press Go! to try them.", "happy", true);
  };

  /* --------------------------------------------------------- integration */

  /* Fix buttons on the compile errors. Called after every compile check. */
  Copilot.prototype.decorateErrors = function (errors) {
    var app = this.app, box = document.getElementById("code-errors");
    if (!errors || !errors.length || app.doc.prog === "blocks") return;
    box.querySelectorAll("[data-line]").forEach(function (b, i) {
      var fix = L.quickFix(app.doc.code || "", errors[i]);
      if (!fix) return;
      var f = document.createElement("span");
      f.className = "fix"; f.setAttribute("role", "button"); f.tabIndex = 0;
      f.textContent = "Fix: " + fix.label;
      var go = function (e) { e.stopPropagation(); app.useCode(fix.code); };
      f.addEventListener("click", go);
      f.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") go(e); });
      b.appendChild(f);
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
