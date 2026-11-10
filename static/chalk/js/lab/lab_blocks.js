/* Chalk Circuit Lab — programming with blocks.
 *
 * Blocks are a way of writing the same Arduino sketch without the typing.
 * Every block becomes one or more real lines of C, and the generator keeps
 * a map from each line back to the block that made it — so when the
 * program runs, the block lights up as its line does, and switching to the
 * Code tab shows exactly what the blocks meant.
 *
 *   ChalkLab.Blocks.generate(prog, mode) -> {code, map: {line: blockId}}
 *   new ChalkLab.Blocks.Editor(el, {mode, prog, onChange})
 *
 * A program is {setup: [block], loop: [block], vars: [{name, init}]}.
 * A block is {id, t, f: {fields}, c: [children], e: [else children]}.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab = root.ChalkLab || {};

  var NOTES = [["262", "C"], ["294", "D"], ["330", "E"], ["349", "F"], ["392", "G"], ["440", "A"], ["494", "B"], ["523", "high C"]];
  var KID_OUT = [["3", "OUT 1"], ["5", "OUT 2"], ["6", "OUT 3"], ["9", "OUT 4"]];
  var PRO_PINS = [];
  for (var i = 0; i <= 13; i++) PRO_PINS.push([String(i), String(i) + (L.PWM_PINS && L.PWM_PINS["D" + i] ? " ~" : "")]);
  var PRO_APINS = [["A0", "A0"], ["A1", "A1"], ["A2", "A2"], ["A3", "A3"], ["A4", "A4"], ["A5", "A5"]];
  var OPS = [["==", "="], ["!=", "≠"], [">", ">"], ["<", "<"], [">=", "≥"], ["<=", "≤"]];

  /* Field kinds:
   *   pin    a digital pin (OUT ports in kid mode)    hl     HIGH / LOW
   *   apin   an analog pin                            num    a number
   *   expr   any C expression (pro) / a number (kid)  text   words in quotes
   *   var    one of the program's variables           note   a musical note
   *   cond   a condition, built from parts
   */
  var BLOCKS = {
    write:  { cat: "do", pro: "digital write pin {pin} {hl}", kid: "turn {pin} {hl}", f: { pin: ["pin", "13"], hl: ["hl", "1"] } },
    pwm:    { cat: "do", pro: "analog write pin {pin} value {v}", kid: "set {pin} brightness {v} %", f: { pin: ["pin", "9"], v: ["expr", "128"] }, kidF: { v: "50" } },
    tone:   { cat: "do", pro: "tone pin {pin} {hz} Hz for {ms} ms", kid: "beep {pin} note {hz}", f: { pin: ["pin", "8"], hz: ["note", "440"], ms: ["num", "300"] } },
    notone: { cat: "do", pro: "stop tone on pin {pin}", kid: "stop beeping {pin}", f: { pin: ["pin", "8"] } },
    servo:  { cat: "do", pro: "servo on pin {pin} to {a}°", kid: "turn servo on {pin} to {a}°", f: { pin: ["pin", "9"], a: ["expr", "90"] } },
    print:  { cat: "do", pro: "print {v}", kid: "say {v}", f: { v: ["expr", "\"Hello\""] }, kidF: { v: "Hello" } },
    lcd:    { cat: "do", pro: "show {v} on screen line {row}", kid: "show {v} on the screen", f: { v: ["expr", "\"Hi!\""], row: ["num", "0"] }, kidF: { v: "Hi!" } },
    wait:   { cat: "flow", pro: "wait {ms} ms", kid: "wait {ms} seconds", f: { ms: ["expr", "500"] }, kidF: { ms: "1" } },
    repeat: { cat: "flow", pro: "repeat {n} times", kid: "repeat {n} times", f: { n: ["expr", "3"] }, body: true },
    "if":   { cat: "flow", pro: "if {c}", kid: "if {c}", f: { c: ["cond", null] }, body: true, alt: true },
    until:  { cat: "flow", pro: "wait until {c}", kid: "wait until {c}", f: { c: ["cond", null] } },
    "while": { cat: "flow", pro: "while {c}", kid: "keep doing while {c}", f: { c: ["cond", null] }, body: true },
    set:    { cat: "data", pro: "set {var} to {v}", kid: "set {var} to {v}", f: { "var": ["var", "count"], v: ["expr", "0"] } },
    change: { cat: "data", pro: "change {var} by {v}", kid: "change {var} by {v}", f: { "var": ["var", "count"], v: ["expr", "1"] } }
  };
  var CATS = { "do": { name: "Do", kid: "Do", color: "#e0913a" }, flow: { name: "Control", kid: "When & how often", color: "#3d7fe0" }, data: { name: "Variables", kid: "Remember", color: "#2fa35a" } };

  /* Conditions are a little sentence: [what] [compared how] [to what]. */
  var COND_SRC_PRO = [["dread", "digital read pin"], ["aread", "analog read pin"], ["var", "variable"], ["millis", "millis()"], ["expr", "expression"]];
  var COND_SRC_KID = [["in1", "IN 1 is pressed"], ["in2", "IN 2 is pressed"], ["dark", "EYE sees dark"], ["bright", "EYE sees light"], ["var", "a variable"]];

  function defaultCond(mode) {
    return mode === "kid" ? { src: "in1" } : { src: "dread", pin: "2", op: "==", val: "LOW" };
  }

  function condCode(c, mode) {
    c = c || defaultCond(mode);
    if (mode === "kid") {
      switch (c.src) {
        case "in1": return "digitalRead(2) == HIGH";
        case "in2": return "digitalRead(4) == HIGH";
        case "dark": return "analogRead(A0) < 300";
        case "bright": return "analogRead(A0) >= 300";
        case "var": return safeName(c.name || "count") + " " + (c.op || "==") + " " + num(c.val, "0");
      }
    }
    var left;
    switch (c.src) {
      case "dread": left = "digitalRead(" + num(c.pin, "2") + ")"; break;
      case "aread": left = "analogRead(" + (c.pin || "A0") + ")"; break;
      case "var": left = safeName(c.name || "count"); break;
      case "millis": left = "millis()"; break;
      default: return (c.expr || "true").trim() || "true";
    }
    return left + " " + (c.op || "==") + " " + ((c.val == null || c.val === "") ? "0" : String(c.val).trim());
  }
  function condReads(c, mode) {
    if (!c) return [];
    if (mode === "kid") return c.src === "in1" ? [2] : c.src === "in2" ? [4] : [];
    return c.src === "dread" ? [+c.pin] : [];
  }

  function num(v, d) { v = String(v == null ? "" : v).trim(); return /^-?\d+(\.\d+)?$/.test(v) ? v : (d == null ? "0" : d); }
  function safeName(n) { n = String(n || "").replace(/[^A-Za-z0-9_]/g, ""); if (!/^[A-Za-z_]/.test(n)) n = "v" + n; return n || "v"; }
  function quote(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
  /* kid "say" and "show" take words; pro takes any expression */
  function textOrExpr(v, mode) {
    v = String(v == null ? "" : v);
    if (mode === "kid") return /^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : quote(v);
    return v.trim() || '""';
  }

  L.Blocks = { BLOCKS: BLOCKS, CATS: CATS, condCode: condCode };

  /* ========================================================== GENERATOR */

  L.Blocks.generate = function (prog, mode) {
    prog = prog || { setup: [], loop: [], vars: [] };
    var lines = [], map = {};
    var outs = {}, ins = {}, servos = {}, usesSerial = false, usesLcd = false;
    function scan(list) {
      (list || []).forEach(function (b) {
        var f = b.f || {};
        if (b.t === "write" || b.t === "pwm" || b.t === "tone" || b.t === "notone") outs[f.pin] = 1;
        if (b.t === "servo") servos[f.pin] = 1;
        if (b.t === "print") usesSerial = true;
        if (b.t === "lcd") usesLcd = true;
        if (f.c) condReads(f.c, mode).forEach(function (p) { ins[p] = 1; });
        scan(b.c); scan(b.e);
      });
    }
    scan(prog.setup); scan(prog.loop);

    function emit(text, id) { lines.push(text); if (id) map[lines.length] = id; }
    function body(list, ind) {
      (list || []).forEach(function (b) { block(b, ind); });
    }
    function block(b, ind) {
      var f = b.f || {}, pad = new Array(ind + 1).join("  "), id = b.id;
      switch (b.t) {
        case "write": emit(pad + "digitalWrite(" + num(f.pin, "13") + ", " + (+f.hl ? "HIGH" : "LOW") + ");", id); break;
        case "pwm": {
          var v = mode === "kid" ? "map(" + num(f.v, "50") + ", 0, 100, 0, 255)" : (String(f.v || "0").trim() || "0");
          emit(pad + "analogWrite(" + num(f.pin, "9") + ", " + v + ");", id); break;
        }
        case "tone":
          if (mode === "kid") emit(pad + "tone(" + num(f.pin, "8") + ", " + num(f.hz, "440") + ", 300);", id);
          else emit(pad + "tone(" + num(f.pin, "8") + ", " + num(f.hz, "440") + (num(f.ms, "0") !== "0" ? ", " + num(f.ms, "300") : "") + ");", id);
          break;
        case "notone": emit(pad + "noTone(" + num(f.pin, "8") + ");", id); break;
        case "servo": emit(pad + "servo" + num(f.pin, "9") + ".write(" + (String(f.a || "90").trim() || "90") + ");", id); break;
        case "print": emit(pad + "Serial.println(" + textOrExpr(f.v, mode) + ");", id); break;
        case "lcd":
          emit(pad + "lcd.setCursor(0, " + (mode === "kid" ? "0" : num(f.row, "0")) + ");", id);
          emit(pad + "lcd.print(" + textOrExpr(f.v, mode) + ");", id);
          break;
        case "wait": {
          var ms = mode === "kid" ? String(Math.round(parseFloat(num(f.ms, "1")) * 1000)) : (String(f.ms || "500").trim() || "500");
          emit(pad + "delay(" + ms + ");", id); break;
        }
        case "repeat": {
          var n = mode === "kid" ? num(f.n, "3") : (String(f.n || "3").trim() || "3");
          var iv = "i" + ind;
          emit(pad + "for (int " + iv + " = 0; " + iv + " < " + n + "; " + iv + "++) {", id);
          body(b.c, ind + 1);
          emit(pad + "}");
          break;
        }
        case "if":
          emit(pad + "if (" + condCode(f.c, mode) + ") {", id);
          body(b.c, ind + 1);
          if (b.e && b.e.length) { emit(pad + "} else {", id); body(b.e, ind + 1); }
          emit(pad + "}");
          break;
        case "until":
          emit(pad + "while (!(" + condCode(f.c, mode) + ")) {", id);
          emit(pad + "  delay(1);", id);
          emit(pad + "}");
          break;
        case "while":
          emit(pad + "while (" + condCode(f.c, mode) + ") {", id);
          body(b.c, ind + 1);
          emit(pad + "}");
          break;
        case "set": emit(pad + safeName(f["var"]) + " = " + (String(f.v == null ? "0" : f.v).trim() || "0") + ";", id); break;
        case "change": emit(pad + safeName(f["var"]) + " += " + (String(f.v == null ? "1" : f.v).trim() || "1") + ";", id); break;
      }
    }

    emit("// Made with blocks in Chalk Circuit Lab.");
    emit("// Switch to Code to see exactly what each block does.");
    if (Object.keys(servos).length) emit("#include <Servo.h>");
    if (usesLcd) emit("#include <LiquidCrystal_I2C.h>");
    emit("");
    Object.keys(servos).forEach(function (p) { emit("Servo servo" + num(p, "9") + ";"); });
    if (usesLcd) emit("LiquidCrystal_I2C lcd(0x27, 16, 2);");
    (prog.vars || []).forEach(function (v) { emit("int " + safeName(v.name) + " = " + num(v.init, "0") + ";"); });
    if (Object.keys(servos).length || usesLcd || (prog.vars || []).length) emit("");
    emit("void setup() {");
    if (usesSerial) emit("  Serial.begin(9600);");
    Object.keys(outs).sort(function (a, b) { return a - b; }).forEach(function (p) { if (!servos[p]) emit("  pinMode(" + num(p) + ", OUTPUT);"); });
    Object.keys(ins).sort(function (a, b) { return a - b; }).forEach(function (p) { emit("  pinMode(" + num(p) + ", " + (mode === "kid" ? "INPUT" : "INPUT_PULLUP") + ");"); });
    Object.keys(servos).forEach(function (p) { emit("  servo" + num(p, "9") + ".attach(" + num(p, "9") + ");"); });
    if (usesLcd) { emit("  lcd.init();"); emit("  lcd.backlight();"); }
    body(prog.setup, 1);
    emit("}");
    emit("");
    emit("void loop() {");
    body(prog.loop, 1);
    emit("}");
    return { code: lines.join("\n") + "\n", map: map };
  };

  L.Blocks.blank = function (mode) {
    if (mode === "kid") {
      return { setup: [], loop: [
        mk("write", { pin: "3", hl: "1" }), mk("wait", { ms: "1" }), mk("write", { pin: "3", hl: "0" }), mk("wait", { ms: "1" })
      ], vars: [] };
    }
    return { setup: [], loop: [
      mk("write", { pin: "13", hl: "1" }), mk("wait", { ms: "500" }), mk("write", { pin: "13", hl: "0" }), mk("wait", { ms: "500" })
    ], vars: [] };
  };

  function mk(t, f) {
    var d = BLOCKS[t], fields = {};
    Object.keys(d.f).forEach(function (k) { fields[k] = d.f[k][1]; });
    var b = { id: L.uid("b"), t: t, f: Object.assign(fields, f || {}) };
    if (d.body) b.c = [];
    if (d.alt) b.e = [];
    return b;
  }
  L.Blocks.make = mk;

  /* ============================================================= EDITOR */

  function Editor(el, opts) {
    this.el = el;
    this.mode = opts.mode || "pro";
    this.prog = opts.prog || L.Blocks.blank(this.mode);
    this.onChange = opts.onChange || function () {};
    this.lit = null;
    this.render();
  }
  L.Blocks.Editor = Editor;

  Editor.prototype.setMode = function (mode) { this.mode = mode; this.render(); };
  Editor.prototype.setProgram = function (prog) { this.prog = prog; this.render(); };
  Editor.prototype.changed = function () { this.onChange(this.prog); };

  Editor.prototype.highlight = function (id) {
    if (this.lit === id) return;
    var old = this.el.querySelector(".blk.lit");
    if (old) old.classList.remove("lit");
    this.lit = id;
    if (!id) return;
    var b = this.el.querySelector('.blk[data-id="' + id + '"]');
    if (b) {
      b.classList.add("lit");
      var area = this.el.querySelector(".blk-prog");
      if (area) {
        var r = b.getBoundingClientRect(), ar = area.getBoundingClientRect();
        if (r.top < ar.top || r.bottom > ar.bottom) b.scrollIntoView({ block: "nearest" });
      }
    }
  };

  Editor.prototype.label = function (d) { return this.mode === "kid" ? d.kid : d.pro; };

  Editor.prototype.render = function () {
    var self = this, kid = this.mode === "kid";
    var pal = '<div class="blk-pal" role="list" aria-label="Blocks to add">';
    Object.keys(CATS).forEach(function (c) {
      pal += '<p class="blk-cat" style="--cat:' + CATS[c].color + '">' + L.esc(kid ? CATS[c].kid : CATS[c].name) + '</p>';
      Object.keys(BLOCKS).forEach(function (t) {
        var d = BLOCKS[t];
        if (d.cat !== c) return;
        if (kid && (t === "while" || t === "notone")) return;
        pal += '<button class="blk-chip" type="button" data-new="' + t + '" style="--cat:' + CATS[c].color + '">' +
               L.esc(chipLabel(t, self.mode)) + '</button>';
      });
    });
    if (!kid || true) pal += '<button class="blk-chip blk-addvar" type="button" data-addvar="1">+ New variable</button>';
    pal += '</div>';
    var vars = (this.prog.vars || []).map(function (v, i) {
      return '<span class="blk-var">' + L.esc(v.name) + ' starts at <input data-varinit="' + i + '" value="' + L.esc(v.init) + '" size="3" inputmode="numeric" aria-label="Starting value of ' + L.esc(v.name) + '"><button type="button" data-delvar="' + i + '" aria-label="Remove ' + L.esc(v.name) + '">×</button></span>';
    }).join("");
    var prog = '<div class="blk-prog">' +
      (vars ? '<div class="blk-vars">' + vars + '</div>' : '') +
      '<section class="blk-hat"><h4>' + (kid ? "When the power comes on" : "When the board starts — setup()") + '</h4>' + this.list(this.prog.setup, "setup") + '</section>' +
      '<section class="blk-hat blk-hat-loop"><h4>' + (kid ? "Then, over and over forever" : "Then forever — loop()") + '</h4>' + this.list(this.prog.loop, "loop") + '</section>' +
      '</div>';
    this.el.innerHTML = '<div class="blk-wrap' + (kid ? " kid" : "") + '">' + pal + prog + '</div>';
    this.bind();
    if (this.lit) { var id = this.lit; this.lit = null; this.highlight(id); }
  };

  Editor.prototype.list = function (list, path) {
    var s = '<div class="blk-list" data-path="' + path + '">';
    for (var i = 0; i <= list.length; i++) {
      s += '<div class="blk-gap" data-path="' + path + '" data-i="' + i + '"></div>';
      if (i < list.length) s += this.block(list[i], path + "." + i);
    }
    if (!list.length) s += '<p class="blk-empty">Drag a block here</p>';
    return s + '</div>';
  };

  Editor.prototype.block = function (b, path) {
    var d = BLOCKS[b.t], self = this;
    if (!d) return "";
    var color = CATS[d.cat].color;
    var head = L.esc(this.label(d)).replace(/\{(\w+)\}/g, function (m, k) { return self.field(b, k, d.f[k]); });
    var s = '<div class="blk" data-id="' + b.id + '" data-path="' + path + '" style="--cat:' + color + '">' +
            '<div class="blk-head"><span class="blk-grip" aria-hidden="true">⋮⋮</span><span class="blk-text">' + head + '</span>' +
            '<button class="blk-del" type="button" data-del="' + path + '" aria-label="Delete this block">×</button></div>';
    if (d.body) {
      s += '<div class="blk-body">' + this.list(b.c || [], path + ".c") + '</div>';
      if (d.alt) {
        if (b.e && b.e.length) s += '<div class="blk-else">' + (this.mode === "kid" ? "otherwise" : "else") + '</div><div class="blk-body">' + this.list(b.e, path + ".e") + '</div>';
        else s += '<button class="blk-addelse" type="button" data-else="' + path + '">+ ' + (this.mode === "kid" ? "otherwise" : "else") + '</button>';
      }
    }
    return s + '</div>';
  };

  /* What a palette chip says: the block's sentence with its default values
   * filled in, so "turn … …" reads as "turn OUT 1 ON". */
  function chipLabel(t, mode) {
    var d = BLOCKS[t], kid = mode === "kid";
    var text = kid ? d.kid : d.pro;
    return text.replace(/\{(\w+)\}/g, function (m, k) {
      var spec = d.f[k]; if (!spec) return "";
      var v = (kid && d.kidF && d.kidF[k] != null) ? d.kidF[k] : spec[1];
      switch (spec[0]) {
        case "pin": return kid ? "OUT 1" : v;
        case "hl": return kid ? "ON" : "HIGH";
        case "note": return kid ? "A" : v;
        case "cond": return kid ? "IN 1 is pressed" : "pin 2 is LOW";
        case "var": return "count";
        default: return String(v).replace(/^"|"$/g, kid ? "" : '"');
      }
    });
  }

  function opts(list, sel) {
    return list.map(function (o) { return '<option value="' + L.esc(o[0]) + '"' + (String(o[0]) === String(sel) ? " selected" : "") + '>' + L.esc(o[1]) + '</option>'; }).join("");
  }

  Editor.prototype.field = function (b, k, spec) {
    var kid = this.mode === "kid", v = b.f[k], attr = ' data-b="' + b.id + '" data-k="' + k + '"';
    if (!spec) return "";
    switch (spec[0]) {
      case "pin": return '<select' + attr + ' aria-label="Pin">' + opts(kid ? KID_OUT : PRO_PINS, v) + '</select>';
      case "hl": return '<select' + attr + ' aria-label="On or off">' + opts(kid ? [["1", "ON"], ["0", "OFF"]] : [["1", "HIGH"], ["0", "LOW"]], v) + '</select>';
      case "note": return kid ? '<select' + attr + ' aria-label="Note">' + opts(NOTES, v) + '</select>'
                              : '<input' + attr + ' value="' + L.esc(v) + '" size="4" inputmode="numeric" aria-label="Frequency">';
      case "num": return '<input' + attr + ' value="' + L.esc(v) + '" size="3" inputmode="numeric" aria-label="' + k + '">';
      case "expr": return '<input' + attr + ' value="' + L.esc(v) + '" size="' + Math.max(3, Math.min(18, String(v).length + 1)) + '"' + (kid && k !== "v" ? ' inputmode="decimal"' : '') + ' aria-label="' + k + '">';
      case "var": {
        var vars = (this.prog.vars || []).map(function (x) { return [x.name, x.name]; });
        if (!vars.length) vars = [["count", "count"]];
        return '<select' + attr + ' aria-label="Variable">' + opts(vars, v) + '</select>';
      }
      case "cond": return this.cond(b, v || defaultCond(this.mode));
    }
    return "";
  };

  Editor.prototype.cond = function (b, c) {
    var kid = this.mode === "kid", a = ' data-b="' + b.id + '" data-c="';
    var s = '<span class="blk-cond"><select' + a + 'src" aria-label="Check">' + opts(kid ? COND_SRC_KID : COND_SRC_PRO, c.src) + '</select>';
    var vars = (this.prog.vars || []).map(function (x) { return [x.name, x.name]; });
    if (!vars.length) vars = [["count", "count"]];
    if (c.src === "dread") s += '<select' + a + 'pin">' + opts(PRO_PINS, c.pin) + '</select>';
    if (c.src === "aread") s += '<select' + a + 'pin">' + opts(PRO_APINS, c.pin || "A0") + '</select>';
    if (c.src === "var") s += '<select' + a + 'name">' + opts(vars, c.name) + '</select>';
    if (c.src === "expr") return s + '<input' + a + 'expr" value="' + L.esc(c.expr || "") + '" size="14" placeholder="x > 3 && y < 9"></span>';
    if (!kid || c.src === "var") {
      s += '<select' + a + 'op" aria-label="Compare">' + opts(OPS, c.op || "==") + '</select>';
      if (c.src === "dread") s += '<select' + a + 'val">' + opts([["LOW", "LOW"], ["HIGH", "HIGH"]], c.val || "LOW") + '</select>';
      else s += '<input' + a + 'val" value="' + L.esc(c.val == null ? "0" : c.val) + '" size="4" aria-label="Value">';
    }
    return s + '</span>';
  };

  /* -------------------------------------------------------- structure */

  Editor.prototype.listAt = function (path) {
    var parts = path.split("."), list = this.prog[parts[0]];
    for (var i = 1; i < parts.length; i += 2) {
      var b = list[+parts[i]];
      list = parts[i + 1] === "e" ? (b.e = b.e || []) : (b.c = b.c || []);
    }
    return list;
  };
  Editor.prototype.findBlock = function (id, list) {
    list = list || this.prog.setup.concat(this.prog.loop);
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
      var f = (list[i].c && this.findBlock(id, list[i].c)) || (list[i].e && this.findBlock(id, list[i].e));
      if (f) return f;
    }
    return null;
  };
  Editor.prototype.remove = function (path) {
    var p = path.split("."), idx = +p.pop(), list = this.listAt(p.join("."));
    return list.splice(idx, 1)[0];
  };

  Editor.prototype.bind = function () {
    var self = this, root = this.el;
    root.querySelectorAll("[data-b]").forEach(function (inp) {
      var ev = inp.tagName === "SELECT" ? "change" : "input";
      inp.addEventListener(ev, function () {
        var b = self.findBlock(inp.getAttribute("data-b"));
        if (!b) return;
        if (inp.hasAttribute("data-c")) {
          var c = b.f.c = Object.assign({}, b.f.c || defaultCond(self.mode));
          c[inp.getAttribute("data-c")] = inp.value;
          if (inp.getAttribute("data-c") === "src") { if (c.src === "aread") c.pin = "A0"; if (c.src === "dread") c.pin = "2"; self.render(); }
        } else b.f[inp.getAttribute("data-k")] = inp.value;
        self.changed();
      });
      inp.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    });
    root.querySelectorAll("[data-del]").forEach(function (btn) {
      btn.addEventListener("click", function () { self.remove(btn.getAttribute("data-del")); self.render(); self.changed(); });
    });
    root.querySelectorAll("[data-else]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var p = btn.getAttribute("data-else").split("."), i = +p.pop();
        var b = self.listAt(p.join("."))[i];
        b.e = [L.Blocks.make("wait", self.mode === "kid" ? { ms: "1" } : {})];
        self.render(); self.changed();
      });
    });
    root.querySelectorAll("[data-varinit]").forEach(function (inp) {
      inp.addEventListener("input", function () { self.prog.vars[+inp.getAttribute("data-varinit")].init = inp.value; self.changed(); });
    });
    root.querySelectorAll("[data-delvar]").forEach(function (btn) {
      btn.addEventListener("click", function () { self.prog.vars.splice(+btn.getAttribute("data-delvar"), 1); self.render(); self.changed(); });
    });
    var addv = root.querySelector("[data-addvar]");
    if (addv) addv.addEventListener("click", function () {
      var ask = L.promptBox ? L.promptBox("Name for the new variable — letters and numbers, no spaces:", "count", "Add variable")
                            : Promise.resolve(root.prompt ? root.prompt("Name for the new variable:", "count") : null);
      ask.then(function (raw) {
        if (raw == null || !String(raw).trim()) return;
        var name = safeName(String(raw).trim());
        self.prog.vars = self.prog.vars || [];
        if (!self.prog.vars.some(function (v) { return v.name === name; })) self.prog.vars.push({ name: name, init: "0" });
        self.render(); self.changed();
      });
    });

    /* palette: click appends to loop, drag drops anywhere */
    root.querySelectorAll("[data-new]").forEach(function (chip) {
      chip.addEventListener("pointerdown", function (e) { self.startDrag(e, { fresh: chip.getAttribute("data-new") }, chip); });
    });
    root.querySelectorAll(".blk-head").forEach(function (h) {
      h.addEventListener("pointerdown", function (e) {
        if (e.target.closest("button,select,input")) return;
        var blk = h.parentNode;
        self.startDrag(e, { path: blk.getAttribute("data-path"), id: blk.getAttribute("data-id") }, blk);
      });
    });
  };

  Editor.prototype.startDrag = function (e, what, srcEl) {
    var self = this, root = this.el, doc = root.ownerDocument;
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    var x0 = e.clientX, y0 = e.clientY, ghost = null, gap = null, moved = false;
    var gaps = [];
    function collect() {
      gaps = Array.prototype.map.call(root.querySelectorAll(".blk-gap"), function (g) {
        /* a block cannot be dropped inside itself */
        if (what.path && (g.getAttribute("data-path") + ".").indexOf(what.path + ".") === 0) return null;
        return { el: g, r: g.getBoundingClientRect() };
      }).filter(Boolean);
    }
    function move(ev) {
      var dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      if (!moved) {
        moved = true;
        collect();
        ghost = srcEl.cloneNode(true);
        ghost.classList.add("blk-ghost");
        ghost.style.width = Math.min(320, srcEl.getBoundingClientRect().width) + "px";
        doc.body.appendChild(ghost);
        if (what.path) srcEl.classList.add("blk-moving");
      }
      ghost.style.transform = "translate(" + (ev.clientX + 8) + "px," + (ev.clientY + 6) + "px)";
      var best = null, bd = 1e9;
      gaps.forEach(function (g) {
        var cy = g.r.top + g.r.height / 2, cx = Math.max(g.r.left, Math.min(ev.clientX, g.r.right));
        var d = Math.abs(ev.clientY - cy) + Math.abs(ev.clientX - cx) * 0.4;
        if (d < bd) { bd = d; best = g; }
      });
      if (gap) gap.el.classList.remove("on");
      gap = bd < 90 ? best : null;
      if (gap) gap.el.classList.add("on");
    }
    function up() {
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", up);
      if (ghost) ghost.remove();
      srcEl.classList.remove("blk-moving");
      if (!moved) {
        if (what.fresh) {   /* a tap on a palette block adds it to the end of loop() */
          self.prog.loop.push(L.Blocks.make(what.fresh, kidDefaults(what.fresh, self.mode)));
          self.render(); self.changed();
        }
        return;
      }
      if (!gap) {
        if (what.path) { self.remove(what.path); self.render(); self.changed(); }   /* dragged away: deleted */
        return;
      }
      var target = gap.el.getAttribute("data-path"), at = +gap.el.getAttribute("data-i");
      var block;
      if (what.fresh) block = L.Blocks.make(what.fresh, kidDefaults(what.fresh, self.mode));
      else {
        var p = what.path.split("."), idx = +p.pop(), from = p.join(".");
        block = self.remove(what.path);
        if (from === target && idx < at) at--;
      }
      self.listAt(target).splice(at, 0, block);
      self.render(); self.changed();
    }
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", up);
  };

  function kidDefaults(t, mode) {
    if (mode !== "kid") return {};
    var d = BLOCKS[t], out = {};
    if (d.kidF) Object.keys(d.kidF).forEach(function (k) { out[k] = d.kidF[k]; });
    if (d.f.pin) out.pin = "3";
    if (d.f.c) out.c = defaultCond("kid");
    return out;
  }
})(typeof window !== "undefined" ? window : globalThis);
