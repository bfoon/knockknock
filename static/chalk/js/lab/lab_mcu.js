/* Chalk Circuit Lab — the Arduino.
 *
 * Runs real Arduino sketches, one line at a time, against the simulated
 * circuit. It is an interpreter for the part of C++ that sketches actually
 * use — variables, arrays, functions, if/for/while/switch, #define, Serial,
 * Servo and the I2C LCD — and it is honest about the chip: an `int` is
 * sixteen bits, as on an Uno, so 300 * 200 really does come out negative,
 * and an integer divided by an integer really does lose the remainder.
 *
 *   var c = ChalkLab.MCU.compile(source)   -> {ok, prog} or {ok:false, errors}
 *   var rt = new ChalkLab.MCU.Runtime(c.prog, host)
 *   rt.start(t); rt.advance(t) every sim tick; rt.step("line" | "over" | "loop")
 *
 * Execution is a generator that yields before every statement, so the
 * program can stop on any line, or crawl along at two lines a second while
 * the board shows what each line just did. delay() yields too, and the
 * circuit keeps running underneath it, the way the real one does.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab = root.ChalkLab || {};

  function CErr(msg, line) { this.message = msg; this.line = line; }
  function RtErr(msg, line) { this.message = msg; this.line = line; this.runtime = true; }

  /* ============================================================ TOKENS */

  var OPS = ["<<=", ">>=", "...", "->", "++", "--", "<<", ">>", "<=", ">=", "==", "!=", "&&", "||",
             "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "::",
             "+", "-", "*", "/", "%", "=", "<", ">", "!", "~", "&", "|", "^", "?", ":", ";", ",", ".",
             "(", ")", "[", "]", "{", "}"];

  function tokenize(src) {
    var out = [], i = 0, line = 1, n = src.length, defines = {}, libs = {};
    function err(msg) { throw new CErr(msg, line); }
    var lineStart = true;
    while (i < n) {
      var c = src.charAt(i);
      if (c === "\n") { line++; i++; lineStart = true; continue; }
      if (c === " " || c === "\t" || c === "\r") { i++; continue; }
      if (c === "/" && src.charAt(i + 1) === "/") { while (i < n && src.charAt(i) !== "\n") i++; continue; }
      if (c === "/" && src.charAt(i + 1) === "*") {
        i += 2;
        while (i < n && !(src.charAt(i) === "*" && src.charAt(i + 1) === "/")) { if (src.charAt(i) === "\n") line++; i++; }
        if (i >= n) err("This /* comment is never closed with */.");
        i += 2; continue;
      }
      if (c === "#" && lineStart) {
        var end = src.indexOf("\n", i); if (end < 0) end = n;
        var dir = src.slice(i + 1, end).replace(/\/\/.*$/, "").trim();
        var m;
        if ((m = /^include\s*[<"]([^>"]+)[>"]/.exec(dir))) libs[m[1]] = line;
        else if ((m = /^define\s+([A-Za-z_]\w*)(\(([^)]*)\))?\s*(.*)$/.exec(dir))) {
          if (m[2]) throw new CErr("#define with brackets (a macro that takes values) isn't supported here. Write a small function instead.", line);
          var body = tokenize(m[4] || "").tokens;
          body.pop();
          body.forEach(function (t) { t.line = line; });
          defines[m[1]] = body;
        } else if (/^(ifndef|ifdef|endif|if|else|pragma|undef)/.test(dir)) { /* harmless */ }
        else err("I don't understand the directive #" + dir.split(/\s/)[0] + ".");
        i = end; continue;
      }
      lineStart = false;
      if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src.charAt(i + 1)))) {
        var s = i, isF = false, v;
        if (c === "0" && /[xX]/.test(src.charAt(i + 1))) { i += 2; while (/[0-9a-fA-F]/.test(src.charAt(i))) i++; v = parseInt(src.slice(s + 2, i), 16); }
        else if (c === "0" && /[bB]/.test(src.charAt(i + 1))) { i += 2; while (/[01]/.test(src.charAt(i))) i++; v = parseInt(src.slice(s + 2, i), 2); }
        else {
          while (/[0-9]/.test(src.charAt(i))) i++;
          if (src.charAt(i) === "." && /[0-9]/.test(src.charAt(i + 1) || "x")) { isF = true; i++; while (/[0-9]/.test(src.charAt(i))) i++; }
          else if (src.charAt(i) === ".") { isF = true; i++; }
          if (/[eE]/.test(src.charAt(i)) && /[-+0-9]/.test(src.charAt(i + 1))) { isF = true; i += 2; while (/[0-9]/.test(src.charAt(i))) i++; }
          v = parseFloat(src.slice(s, i));
          if (!isF && /^0[0-7]+$/.test(src.slice(s, i))) v = parseInt(src.slice(s, i), 8);
        }
        var suf = "";
        while (/[uUlLfF]/.test(src.charAt(i))) suf += src.charAt(i++).toLowerCase();
        if (suf.indexOf("f") >= 0) isF = true;
        out.push({ t: "num", v: v, f: isF, suf: suf, line: line });
        continue;
      }
      if (/[A-Za-z_]/.test(c)) {
        var s2 = i;
        while (i < n && /\w/.test(src.charAt(i))) i++;
        var word = src.slice(s2, i);
        if (defines[word]) {
          defines[word].forEach(function (t) { out.push(Object.assign({}, t, { line: line })); });
          continue;
        }
        if (/^B[01]{1,8}$/.test(word)) { out.push({ t: "num", v: parseInt(word.slice(1), 2), f: false, suf: "", line: line }); continue; }
        out.push({ t: "id", v: word, line: line });
        continue;
      }
      if (c === '"') {
        var str = ""; i++;
        while (i < n && src.charAt(i) !== '"') {
          if (src.charAt(i) === "\n") err("This text in \"quotes\" runs off the end of the line. Close it with \".");
          if (src.charAt(i) === "\\") { str += unesc(src.charAt(i + 1)); i += 2; continue; }
          str += src.charAt(i++);
        }
        i++;
        var prev = out[out.length - 1];
        if (prev && prev.t === "str") prev.v += str;   /* "a" "b" is "ab" in C */
        else out.push({ t: "str", v: str, line: line });
        continue;
      }
      if (c === "'") {
        i++;
        var ch = src.charAt(i);
        if (ch === "\\") { ch = unesc(src.charAt(i + 1)); i += 2; } else i++;
        if (src.charAt(i) !== "'") err("A character in 'single quotes' holds exactly one letter. For words, use \"double quotes\".");
        i++;
        out.push({ t: "chr", v: ch.charCodeAt(0), line: line });
        continue;
      }
      var op = null;
      for (var k = 0; k < OPS.length; k++) if (src.substr(i, OPS[k].length) === OPS[k]) { op = OPS[k]; break; }
      if (!op) err("Unexpected character '" + c + "'.");
      out.push({ t: "op", v: op, line: line });
      i += op.length;
    }
    out.push({ t: "eof", v: "", line: line });
    return { tokens: out, libs: libs, defines: defines };
  }
  function unesc(c) { return { n: "\n", t: "\t", r: "\r", "0": "\0", "\\": "\\", '"': '"', "'": "'" }[c] || c; }

  /* ============================================================= TYPES */

  var BASE = {
    void: "v", bool: "b", boolean: "b", char: "c", byte: "u8", int: "i16", short: "i16", long: "i32",
    float: "f", double: "f", word: "u16", String: "s", size_t: "u16",
    int8_t: "i8", uint8_t: "u8", int16_t: "i16", uint16_t: "u16", int32_t: "i32", uint32_t: "u32",
    int64_t: "i32", uint64_t: "u32"
  };
  var CLASSES = { Servo: "Servo", LiquidCrystal_I2C: "LCD", LiquidCrystal: "LCD", SoftwareSerial: "SoftSerial" };
  var QUALS = { const: 1, static: 1, volatile: 1, extern: 1, inline: 1, signed: 1, unsigned: 1, register: 1 };
  var BYTES = { b: 1, c: 1, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4, f: 4, s: 6 };
  var TYPE_NAME = { v: "void", b: "bool", c: "char", i8: "int8_t", u8: "byte", i16: "int", u16: "unsigned int", i32: "long", u32: "unsigned long", f: "float", s: "String" };

  function isInt(t) { return t === "b" || t === "c" || t === "i8" || t === "u8" || t === "i16" || t === "u16" || t === "i32" || t === "u32"; }
  function promote(t) { return (t === "b" || t === "c" || t === "i8" || t === "u8" || t === "i16") ? "i16" : t; }
  function arith(a, b) {
    if (a === "s" || b === "s") return "s";
    if (a === "f" || b === "f") return "f";
    a = promote(a); b = promote(b);
    if (a === "u32" || b === "u32") return "u32";
    if (a === "i32" || b === "i32") return "i32";
    if (a === "u16" || b === "u16") return "u16";
    return "i16";
  }

  function wrap(ty, v) {
    switch (ty) {
      case "f": return typeof v === "number" ? v : +v || 0;
      case "s": return typeof v === "string" ? v : String(v);
      case "b": return v ? 1 : 0;
      case "i16": v = Math.trunc(v); return (v << 16) >> 16;
      case "u16": return Math.trunc(v) & 0xFFFF;
      case "i32": return Math.trunc(v) | 0;
      case "u32": return Math.trunc(v) >>> 0;
      case "i8": case "c": v = Math.trunc(v); return (v << 24) >> 24;
      case "u8": return Math.trunc(v) & 0xFF;
      default: return v;
    }
  }

  function fmtNum(v, ty, arg) {
    if (ty === "s") return String(v);
    if (ty === "c") return String.fromCharCode(v & 255);
    if (ty === "f") {
      if (isNaN(v)) return "nan";
      if (!isFinite(v)) return v > 0 ? "inf" : "-inf";
      return v.toFixed(arg == null ? 2 : Math.max(0, Math.min(10, arg)));
    }
    if (arg === 16 || arg === 2 || arg === 8) {
      var u = v < 0 ? (v >>> 0) : v;
      return u.toString(arg).toUpperCase();
    }
    return String(v);
  }

  /* ============================================================ PARSER */

  function Parser(tk) { this.t = tk.tokens; this.i = 0; this.libs = tk.libs; }
  var Pp = Parser.prototype;
  Pp.peek = function (o) { return this.t[this.i + (o || 0)]; };
  Pp.next = function () { return this.t[this.i++]; };
  Pp.is = function (v, o) { var t = this.peek(o); return (t.t === "op" || t.t === "id") && t.v === v; };
  Pp.eat = function (v) { if (this.is(v)) { this.i++; return true; } return false; };
  Pp.err = function (msg, tok) { throw new CErr(msg, (tok || this.peek()).line); };
  Pp.expect = function (v, what) {
    if (this.eat(v)) return;
    var t = this.peek(), prev = this.t[this.i - 1];
    if (v === ";" && prev && t.line > prev.line) this.err("Missing ; at the end of this line.", prev);
    this.err(what || ("Expected '" + v + "' here but found " + describe(t) + "."), t);
  };
  Pp.id = function (what) {
    var t = this.peek();
    if (t.t !== "id") this.err("Expected " + (what || "a name") + " here but found " + describe(t) + ".");
    this.i++; return t.v;
  };
  function describe(t) {
    if (t.t === "eof") return "the end of the program";
    if (t.t === "str") return "\"" + t.v + "\"";
    return "'" + t.v + "'";
  }

  Pp.isTypeStart = function () {
    var t = this.peek();
    if (t.t !== "id") return false;
    return !!(BASE[t.v] || CLASSES[t.v] || QUALS[t.v]);
  };
  Pp.type = function () {
    var q = {}, base = null, cls = null, unsigned = false, longs = 0, start = this.peek();
    for (;;) {
      var t = this.peek();
      if (t.t !== "id") break;
      if (QUALS[t.v]) { q[t.v] = 1; if (t.v === "unsigned") unsigned = true; this.i++; continue; }
      if (t.v === "long") { longs++; this.i++; base = "long"; continue; }
      if (t.v === "int" && base === "long") { this.i++; continue; }
      if (t.v === "short") { base = "short"; this.i++; if (this.is("int")) this.i++; continue; }
      if (!base && (BASE[t.v] || CLASSES[t.v])) { base = t.v; this.i++; if (CLASSES[base]) cls = CLASSES[base]; continue; }
      break;
    }
    if (!base && !unsigned) { this.i = this.t.indexOf(start); return null; }
    var ty = base ? (cls ? "o" : BASE[base]) : "i16";
    if (base === "long") ty = "i32";
    if (unsigned) ty = ty === "i32" ? "u32" : ty === "c" ? "u8" : ty === "i8" ? "u8" : "u16";
    if (this.eat("*")) { if (ty === "c" || ty === "u8") ty = "s"; else this.err("Pointers (*) aren't supported here. Use an array or a plain variable."); }
    this.eat("&");
    return { ty: ty, cls: cls, isConst: !!q.const, isStatic: !!q.static, line: start.line };
  };

  Pp.program = function () {
    var globals = [], funcs = {}, protos = {};
    while (this.peek().t !== "eof") {
      if (this.eat(";")) continue;
      var t0 = this.peek();
      if (t0.t === "id" && /^(struct|class|enum|typedef|union|template|namespace|using)$/.test(t0.v))
        this.err("'" + t0.v + "' isn't supported in the lab yet. Plain variables, arrays and functions all work.");
      var ty = this.type();
      if (!ty) {
        if (t0.t === "id" && this.is("(", 1)) this.err("Function '" + t0.v + "' needs a return type in front of it, like: void " + t0.v + "() { … }");
        if (t0.t === "id" && !BASE[t0.v]) this.err("I don't recognise '" + t0.v + "' as a type. Did you mean int, float, bool or String?");
        this.err("Expected a variable or a function here, but found " + describe(t0) + ".");
      }
      var nameTok = this.peek(), name = this.id("a name");
      if (this.is("(") && !ty.cls) {
        this.next();
        var params = this.params();
        this.expect(")");
        if (this.eat(";")) { protos[name] = { ret: ty.ty, params: params }; continue; }
        if (!this.is("{")) this.err("Expected { to start the body of " + name + "().");
        if (funcs[name]) this.err("There are two functions called " + name + "().", nameTok);
        var body = this.block();
        funcs[name] = { name: name, ret: ty.ty, params: params, body: body, line: nameTok.line, endLine: this.t[this.i - 1].line };
        continue;
      }
      globals.push(this.declRest(ty, name, nameTok.line));
      this.expect(";");
    }
    return { globals: globals, funcs: funcs, protos: protos, libs: this.libs };
  };

  Pp.params = function () {
    var out = [];
    if (this.is(")")) return out;
    if (this.is("void") && this.is(")", 1)) { this.next(); return out; }
    do {
      var ty = this.type();
      if (!ty) this.err("Expected a type for this function's input, like int or float.");
      var name = this.peek().t === "id" ? this.id() : "_" + out.length, arr = false;
      while (this.eat("[")) { while (!this.is("]")) this.next(); this.expect("]"); arr = true; }
      out.push({ name: name, ty: ty.ty, cls: ty.cls, arr: arr });
    } while (this.eat(","));
    return out;
  };

  Pp.declRest = function (ty, firstName, line) {
    var items = [], name = firstName;
    for (;;) {
      var it = { name: name, ty: ty.ty, cls: ty.cls, isConst: ty.isConst, isStatic: ty.isStatic, dims: null, init: null, ctor: null, line: this.peek().line };
      while (this.eat("[")) {
        it.dims = it.dims || [];
        it.dims.push(this.is("]") ? null : this.cond());
        this.expect("]");
      }
      if (ty.cls && this.eat("(")) {
        it.ctor = [];
        if (!this.is(")")) do { it.ctor.push(this.asg()); } while (this.eat(","));
        this.expect(")");
      }
      if (this.eat("=")) it.init = this.is("{") ? this.braceInit() : this.asg();
      if (ty.ty === "v") this.err("A variable can't be void. Use int, float, bool…");
      items.push(it);
      if (!this.eat(",")) break;
      name = this.id("a variable name");
    }
    return { k: "decl", items: items, line: line };
  };

  Pp.braceInit = function () {
    var line = this.peek().line;
    this.expect("{");
    var items = [];
    while (!this.is("}")) {
      items.push(this.is("{") ? this.braceInit() : this.asg());
      if (!this.eat(",")) break;
    }
    this.expect("}");
    return { k: "init", items: items, line: line };
  };

  Pp.block = function () {
    var line = this.peek().line;
    this.expect("{");
    var body = [];
    while (!this.is("}")) {
      if (this.peek().t === "eof") this.err("A { was opened here but never closed with }.", { line: line });
      body.push(this.stmt());
    }
    var end = this.next().line;
    return { k: "block", body: body, line: line, endLine: end };
  };

  Pp.stmt = function () {
    var t = this.peek(), line = t.line;
    if (this.is("{")) return this.block();
    if (this.eat(";")) return { k: "empty", line: line };
    if (t.t === "id") {
      switch (t.v) {
        case "if": {
          this.next(); this.expect("(", "if needs its condition in brackets: if (x > 5) { … }");
          var c = this.expr(); this.expect(")");
          var a = this.stmt(), b = null;
          if (this.eat("else")) b = this.stmt();
          return { k: "if", c: c, a: a, b: b, line: line };
        }
        case "while": {
          this.next(); this.expect("(", "while needs its condition in brackets: while (x < 10) { … }");
          var wc = this.expr(); this.expect(")");
          return { k: "while", c: wc, body: this.stmt(), line: line };
        }
        case "do": {
          this.next();
          var db = this.stmt();
          if (!this.eat("while")) this.err("do { … } needs a while (…); after it.");
          var dl = this.t[this.i - 1].line;
          this.expect("("); var dc = this.expr(); this.expect(")"); this.expect(";");
          return { k: "do", body: db, c: dc, line: line, cline: dl };
        }
        case "for": {
          this.next(); this.expect("(", "for needs brackets: for (int i = 0; i < 10; i++) { … }");
          var init = null, fc = null, step = null;
          if (!this.is(";")) {
            if (this.isTypeStart()) { var ty = this.type(), nm = this.id(); init = this.declRest(ty, nm, line); }
            else init = { k: "expr", e: this.expr(), line: line };
          }
          this.expect(";", "A for loop has three parts separated by ; — for (start; keep going while; step)");
          if (!this.is(";")) fc = this.expr();
          this.expect(";", "A for loop has three parts separated by ; — for (start; keep going while; step)");
          if (!this.is(")")) step = this.expr();
          this.expect(")");
          return { k: "for", init: init, c: fc, step: step, body: this.stmt(), line: line };
        }
        case "switch": {
          this.next(); this.expect("("); var se = this.expr(); this.expect(")");
          this.expect("{");
          var cases = [], cur = null;
          while (!this.is("}")) {
            if (this.eat("case")) { var cv = this.cond(); this.expect(":"); cur = { v: cv, body: [], line: this.t[this.i - 1].line }; cases.push(cur); continue; }
            if (this.eat("default")) { this.expect(":"); cur = { v: null, body: [], line: this.t[this.i - 1].line }; cases.push(cur); continue; }
            if (!cur) this.err("Code inside a switch has to come after a case …: label.");
            cur.body.push(this.stmt());
          }
          this.next();
          return { k: "switch", e: se, cases: cases, line: line };
        }
        case "break": this.next(); this.expect(";"); return { k: "break", line: line };
        case "continue": this.next(); this.expect(";"); return { k: "continue", line: line };
        case "return": {
          this.next();
          var re = this.is(";") ? null : this.expr();
          this.expect(";");
          return { k: "return", e: re, line: line };
        }
        case "else": this.err("This else has no if in front of it. Check the { } brackets above.");
        case "goto": this.err("goto isn't supported. Use a loop or a function instead.");
      }
      if (this.isTypeStart()) {
        var dty = this.type(), dn = this.id("a variable name");
        var d = this.declRest(dty, dn, line);
        this.expect(";");
        return d;
      }
    }
    var e = this.expr();
    this.expect(";");
    return { k: "expr", e: e, line: line };
  };

  var PREC = { "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6, "<": 7, ">": 7, "<=": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9, "*": 10, "/": 10, "%": 10 };
  var ASSIGN = { "=": 1, "+=": 1, "-=": 1, "*=": 1, "/=": 1, "%=": 1, "&=": 1, "|=": 1, "^=": 1, "<<=": 1, ">>=": 1 };

  Pp.expr = function () {
    var e = this.asg();
    while (this.is(",")) { var line = this.next().line; e = { k: "comma", a: e, b: this.asg(), line: line }; }
    return e;
  };
  Pp.asg = function () {
    var a = this.cond(), t = this.peek();
    if (t.t === "op" && ASSIGN[t.v]) {
      this.next();
      if (a.k !== "id" && a.k !== "idx") this.err("The left side of " + t.v + " has to be a variable.", t);
      return { k: "asg", op: t.v, a: a, b: this.asg(), line: t.line };
    }
    if (t.t === "op" && t.v === "=" ) this.err("Can't assign here.");
    return a;
  };
  Pp.cond = function () {
    var c = this.bin(1);
    if (this.is("?")) {
      var line = this.next().line, a = this.expr();
      this.expect(":");
      return { k: "cond", c: c, a: a, b: this.cond(), line: line };
    }
    return c;
  };
  Pp.bin = function (min) {
    var a = this.unary();
    for (;;) {
      var t = this.peek();
      if (t.t !== "op" || !PREC[t.v] || PREC[t.v] < min) return a;
      this.next();
      var b = this.bin(PREC[t.v] + 1);
      a = { k: (t.v === "&&" || t.v === "||") ? "log" : "bin", op: t.v, a: a, b: b, line: t.line };
    }
  };
  Pp.unary = function () {
    var t = this.peek();
    if (t.t === "op") {
      if (t.v === "!" || t.v === "~" || t.v === "-" || t.v === "+") { this.next(); return { k: "un", op: t.v, a: this.unary(), line: t.line }; }
      if (t.v === "++" || t.v === "--") { this.next(); return { k: "pre", op: t.v, a: this.unary(), line: t.line }; }
      if (t.v === "&" || t.v === "*") this.err("Pointers (& and *) aren't supported here.");
      if (t.v === "(") {
        var save = this.i; this.next();
        if (this.isTypeStart()) {
          var ty = this.type();
          if (ty && this.eat(")")) return { k: "cast", ty: ty.ty, a: this.unary(), line: t.line };
        }
        this.i = save;
      }
    }
    if (t.t === "id" && t.v === "sizeof") {
      this.next(); this.expect("(");
      var node;
      if (this.isTypeStart()) { var st = this.type(); node = { k: "num", v: BYTES[st.ty] || 2, line: t.line, lit: true }; }
      else node = { k: "sizeof", a: this.expr(), line: t.line };
      this.expect(")");
      return node;
    }
    return this.postfix();
  };
  Pp.postfix = function () {
    var e = this.primary();
    for (;;) {
      var t = this.peek();
      if (t.t !== "op") return e;
      if (t.v === "(") {
        if (e.k !== "id") this.err("Only a function name can be followed by ( … ).");
        this.next();
        var args = [];
        if (!this.is(")")) do { args.push(this.asg()); } while (this.eat(","));
        this.expect(")", "Expected ) to close the call to " + e.name + "(.");
        e = { k: "call", name: e.name, args: args, line: e.line };
      } else if (t.v === "[") {
        this.next(); var ix = this.expr(); this.expect("]");
        e = { k: "idx", a: e, i: ix, line: t.line };
      } else if (t.v === "." || t.v === "->") {
        this.next();
        var mname = this.id("a method name");
        if (!this.is("(")) this.err("'" + mname + "' has to be called with brackets: ." + mname + "()");
        this.next();
        var margs = [];
        if (!this.is(")")) do { margs.push(this.asg()); } while (this.eat(","));
        this.expect(")");
        e = { k: "mcall", obj: e, name: mname, args: margs, line: t.line };
      } else if (t.v === "++" || t.v === "--") {
        this.next(); e = { k: "post", op: t.v, a: e, line: t.line };
      } else return e;
    }
  };
  Pp.primary = function () {
    var t = this.next();
    if (t.t === "num") {
      var ty;
      if (t.f) ty = "f";
      else if (t.suf.indexOf("u") >= 0 && t.suf.indexOf("l") >= 0) ty = "u32";
      else if (t.suf.indexOf("l") >= 0) ty = t.v > 2147483647 ? "u32" : "i32";
      else if (t.suf.indexOf("u") >= 0) ty = t.v > 65535 ? "u32" : "u16";
      else ty = t.v <= 32767 ? "i16" : t.v <= 2147483647 ? "i32" : "u32";
      return { k: "num", v: t.v, ty: ty, line: t.line, lit: true };
    }
    if (t.t === "str") return { k: "str", v: t.v, line: t.line };
    if (t.t === "chr") return { k: "num", v: t.v, ty: "c", line: t.line, lit: true };
    if (t.t === "op" && t.v === "(") { var e = this.expr(); this.expect(")"); return e; }
    if (t.t === "id") {
      if (BASE[t.v] && this.is("(")) {
        /* int(x), float(x), String(x) */
        this.next();
        var args = [];
        if (!this.is(")")) do { args.push(this.asg()); } while (this.eat(","));
        this.expect(")");
        if (t.v === "String") return { k: "call", name: "String", args: args, line: t.line };
        return { k: "cast", ty: BASE[t.v], a: args[0] || { k: "num", v: 0, ty: "i16", line: t.line }, line: t.line };
      }
      return { k: "id", name: t.v, line: t.line };
    }
    this.i--;
    this.err("Expected a value here but found " + describe(t) + ".");
  };

  /* ========================================================= BUILT-INS */

  /* name: [minArgs, maxArgs, returnType, usage, isGenerator] */
  var BUILTINS = {
    pinMode: [2, 2, "v", "pinMode(pin, OUTPUT)"],
    digitalWrite: [2, 2, "v", "digitalWrite(pin, HIGH)"],
    digitalRead: [1, 1, "i16", "digitalRead(pin)"],
    analogRead: [1, 1, "i16", "analogRead(A0)"],
    analogWrite: [2, 2, "v", "analogWrite(pin, 0…255)"],
    analogReference: [1, 1, "v", "analogReference(DEFAULT)"],
    delay: [1, 1, "v", "delay(milliseconds)", true],
    delayMicroseconds: [1, 1, "v", "delayMicroseconds(microseconds)", true],
    millis: [0, 0, "u32", "millis()"], micros: [0, 0, "u32", "micros()"],
    tone: [2, 3, "v", "tone(pin, frequency) or tone(pin, frequency, milliseconds)"],
    noTone: [1, 1, "v", "noTone(pin)"],
    pulseIn: [2, 3, "u32", "pulseIn(pin, HIGH)", true],
    map: [5, 5, "i32", "map(value, fromLow, fromHigh, toLow, toHigh)"],
    constrain: [3, 3, "=", "constrain(value, low, high)"],
    min: [2, 2, "=", "min(a, b)"], max: [2, 2, "=", "max(a, b)"], abs: [1, 1, "=", "abs(x)"],
    sq: [1, 1, "=", "sq(x)"], sqrt: [1, 1, "f", "sqrt(x)"], pow: [2, 2, "f", "pow(base, exponent)"],
    sin: [1, 1, "f", "sin(radians)"], cos: [1, 1, "f", "cos(radians)"], tan: [1, 1, "f", "tan(radians)"],
    atan2: [2, 2, "f", "atan2(y, x)"], log: [1, 1, "f", "log(x)"], log10: [1, 1, "f", "log10(x)"], exp: [1, 1, "f", "exp(x)"],
    floor: [1, 1, "f", "floor(x)"], ceil: [1, 1, "f", "ceil(x)"], round: [1, 1, "i32", "round(x)"], fabs: [1, 1, "f", "fabs(x)"],
    random: [1, 2, "i32", "random(max) or random(min, max)"], randomSeed: [1, 1, "v", "randomSeed(seed)"],
    bitRead: [2, 2, "i16", "bitRead(value, bit)"], lowByte: [1, 1, "u8", "lowByte(x)"], highByte: [1, 1, "u8", "highByte(x)"],
    bit: [1, 1, "u32", "bit(n)"],
    String: [0, 2, "s", "String(value)"],
    attachInterrupt: [2, 3, "v", "attachInterrupt(…)"], detachInterrupt: [1, 1, "v", "detachInterrupt(…)"],
    digitalPinToInterrupt: [1, 1, "i16", "digitalPinToInterrupt(pin)"],
    interrupts: [0, 0, "v", "interrupts()"], noInterrupts: [0, 0, "v", "noInterrupts()"],
    isDigit: [1, 1, "b", "isDigit(c)"], isAlpha: [1, 1, "b", "isAlpha(c)"]
  };
  var CONSTS = {
    HIGH: 1, LOW: 0, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, LED_BUILTIN: 13, true: 1, false: 0,
    A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, A6: 20, A7: 21,
    DEC: 10, HEX: 16, BIN: 2, OCT: 8, CHANGE: 1, FALLING: 2, RISING: 3, DEFAULT: 1, EXTERNAL: 0, INTERNAL: 3,
    NULL: 0, LSBFIRST: 0, MSBFIRST: 1
  };
  var FCONSTS = { PI: Math.PI, HALF_PI: Math.PI / 2, TWO_PI: Math.PI * 2, DEG_TO_RAD: Math.PI / 180, RAD_TO_DEG: 180 / Math.PI };
  var METHODS = {
    Serial: {
      begin: [1, 2, "v"], end: [0, 0, "v"], print: [1, 2, "v"], println: [0, 2, "v"], write: [1, 1, "v"],
      available: [0, 0, "i16"], read: [0, 0, "i16"], peek: [0, 0, "i16"], parseInt: [0, 0, "i32"],
      parseFloat: [0, 0, "f"], readString: [0, 0, "s"], readStringUntil: [1, 1, "s"], flush: [0, 0, "v"],
      setTimeout: [1, 1, "v"]
    },
    SoftSerial: null,
    Servo: { attach: [1, 3, "u8"], write: [1, 1, "v"], writeMicroseconds: [1, 1, "v"], read: [0, 0, "i16"], attached: [0, 0, "b"], detach: [0, 0, "v"] },
    LCD: {
      init: [0, 0, "v"], begin: [0, 3, "v"], backlight: [0, 0, "v"], noBacklight: [0, 0, "v"], clear: [0, 0, "v"],
      home: [0, 0, "v"], setCursor: [2, 2, "v"], print: [1, 2, "v"], write: [1, 1, "v"],
      display: [0, 0, "v"], noDisplay: [0, 0, "v"], cursor: [0, 0, "v"], noCursor: [0, 0, "v"], blink: [0, 0, "v"], noBlink: [0, 0, "v"]
    },
    String: {
      length: [0, 0, "u16"], toInt: [0, 0, "i32"], toFloat: [0, 0, "f"], indexOf: [1, 2, "i16"], substring: [1, 2, "s"],
      charAt: [1, 1, "c"], equals: [1, 1, "b"], toUpperCase: [0, 0, "v"], toLowerCase: [0, 0, "v"], trim: [0, 0, "v"],
      startsWith: [1, 1, "b"], endsWith: [1, 1, "b"], concat: [1, 1, "b"], c_str: [0, 0, "s"], replace: [2, 2, "v"]
    }
  };
  /* SoftwareSerial speaks exactly like Serial, on two pins of your choice. */
  METHODS.SoftSerial = Object.assign({}, METHODS.Serial, { listen: [0, 0, "b"], isListening: [0, 0, "b"], overflow: [0, 0, "b"] });
  L.MCU_BUILTINS = BUILTINS;

  /* Did you mean …? */
  function lev(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) { d[i] = [i]; }
    for (j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    return d[m][n];
  }
  function suggest(name, pool) {
    var best = null, bd = 99, low = name.toLowerCase();
    pool.forEach(function (p) {
      var dd = p.toLowerCase() === low ? 0 : lev(name, p);
      if (dd < bd) { bd = dd; best = p; }
    });
    return bd <= Math.max(1, Math.floor(name.length / 3)) ? best : null;
  }

  /* ========================================================== RESOLVER
   * Works out every expression's type (so 5 / 2 is 2 and 5.0 / 2 is 2.5,
   * as in C), checks names exist, and marks the expressions that might
   * pause (they call delay(), or one of your own functions). */

  function resolve(ast) {
    var errors = [];
    var funcs = ast.funcs, globals = {};
    var scopes = [globals];
    function E(msg, line) { errors.push({ line: line, msg: msg }); }
    function lookup(name) { for (var i = scopes.length - 1; i >= 0; i--) if (scopes[i][name]) return scopes[i][name]; return null; }
    function names() {
      var out = Object.keys(funcs).concat(Object.keys(BUILTINS)).concat(Object.keys(CONSTS)).concat(Object.keys(FCONSTS));
      scopes.forEach(function (s) { out = out.concat(Object.keys(s)); });
      return out;
    }
    function declare(it) {
      var scope = scopes[scopes.length - 1];
      if (scope[it.name] && scope === globals && scopes.length === 1) E("'" + it.name + "' is declared twice.", it.line);
      scope[it.name] = { ty: it.ty, cls: it.cls, arr: !!it.dims, dims: it.dims ? it.dims.length : 0, isConst: it.isConst };
      (it.dims || []).forEach(function (d) { if (d) expr(d); });
      if (it.init) {
        if (it.init.k === "init") initList(it.init);
        else expr(it.init);
      }
      (it.ctor || []).forEach(expr);
    }
    function initList(n) { n.items.forEach(function (x) { if (x.k === "init") initList(x); else expr(x); }); }

    function expr(n) {
      switch (n.k) {
        case "num": n.y = false; if (!n.ty) n.ty = Number.isInteger(n.v) ? "i16" : "f"; return n;
        case "str": n.ty = "s"; n.y = false; return n;
        case "id": {
          var v = lookup(n.name);
          if (v) { n.ty = v.ty; n.cls = v.cls; n.arr = v.arr; n.dims = v.dims; n.isConst = v.isConst; n.y = false; return n; }
          if (CONSTS[n.name] != null) { n.k = "num"; n.v = CONSTS[n.name]; n.ty = (n.name === "true" || n.name === "false") ? "b" : "i16"; n.y = false; return n; }
          if (FCONSTS[n.name] != null) { n.k = "num"; n.v = FCONSTS[n.name]; n.ty = "f"; n.y = false; return n; }
          if (n.name === "Serial") { n.ty = "o"; n.cls = "Serial"; n.y = false; return n; }
          var s = suggest(n.name, names());
          E("'" + n.name + "' hasn't been declared." + (s ? " Did you mean " + s + "?" : " Declare it first, for example: int " + n.name + " = 0;"), n.line);
          n.ty = "i16"; n.y = false; return n;
        }
        case "bin": {
          expr(n.a); expr(n.b);
          n.y = n.a.y || n.b.y;
          var t = arith(n.a.ty, n.b.ty);
          if (n.a.arr || n.b.arr) E("You can't do maths on a whole array. Pick one item with [ ], like leds[0].", n.line);
          if ((n.op === "%" || n.op === "<<" || n.op === ">>" || n.op === "&" || n.op === "|" || n.op === "^") && t === "f")
            E("'" + n.op + "' only works on whole numbers, not float.", n.line);
          if (t === "s" && "+==!=<>".indexOf(n.op) < 0) E("Text (String) can only be joined with + or compared with ==.", n.line);
          if (n.op === "<<" || n.op === ">>") t = promote(n.a.ty);
          n.opTy = t;
          n.ty = t;
          if (n.op === "==" || n.op === "!=" || n.op === "<" || n.op === ">" || n.op === "<=" || n.op === ">=") n.ty = "b";
          return n;
        }
        case "log": expr(n.a); expr(n.b); n.y = n.a.y || n.b.y; n.ty = "b"; return n;
        case "un": expr(n.a); n.y = n.a.y; n.ty = n.op === "!" ? "b" : (n.a.ty === "f" ? "f" : promote(n.a.ty)); return n;
        case "pre": case "post":
          expr(n.a); n.y = n.a.y; n.ty = n.a.ty;
          if (n.a.k !== "id" && n.a.k !== "idx") E(n.op + " only works on a variable.", n.line);
          if (n.a.isConst) E("'" + n.a.name + "' is const, so it can't be changed.", n.line);
          return n;
        case "asg":
          expr(n.a); expr(n.b);
          n.y = n.a.y || n.b.y; n.ty = n.a.ty;
          if (n.a.isConst) E("'" + n.a.name + "' is const, so it can't be changed.", n.line);
          if (n.a.arr && n.a.k === "id") E("You can't assign to a whole array at once. Set one item: " + n.a.name + "[0] = …", n.line);
          if (n.op !== "=") n.opTy = arith(n.a.ty, n.b.ty);
          if (n.op === "=" && n.a.ty !== "s" && n.b.ty === "s" && n.b.k === "str") E("You can't put text into a number variable. Use a String variable for text.", n.line);
          return n;
        case "cond": expr(n.c); expr(n.a); expr(n.b); n.y = n.c.y || n.a.y || n.b.y; n.ty = arith(n.a.ty, n.b.ty); return n;
        case "comma": expr(n.a); expr(n.b); n.y = n.a.y || n.b.y; n.ty = n.b.ty; return n;
        case "cast": expr(n.a); n.y = n.a.y; return n;
        case "sizeof": expr(n.a); n.y = false; n.ty = "u16"; return n;
        case "idx": {
          expr(n.a); expr(n.i);
          n.y = n.a.y || n.i.y;
          if (n.a.ty === "s" && !n.a.arr) { n.ty = "c"; n.strIdx = true; return n; }
          if (!n.a.arr) E("'" + (n.a.name || "this") + "' isn't an array, so it can't be used with [ ].", n.line);
          n.ty = n.a.ty; n.cls = n.a.cls; n.arr = (n.a.dims || 1) > 1; n.dims = (n.a.dims || 1) - 1; n.isConst = n.a.isConst;
          return n;
        }
        case "call": {
          n.args.forEach(expr);
          var any = n.args.some(function (a) { return a.y; });
          var f = funcs[n.name] || ast.protos[n.name];
          if (f) {
            n.user = true; n.y = true; n.ty = f.ret;
            if (n.args.length !== f.params.length) E(n.name + "() takes " + f.params.length + " value" + (f.params.length === 1 ? "" : "s") + " but was given " + n.args.length + ".", n.line);
            return n;
          }
          var b = BUILTINS[n.name];
          if (b) {
            if (n.args.length < b[0] || n.args.length > b[1]) E(n.name + "() needs " + (b[0] === b[1] ? b[0] : b[0] + "–" + b[1]) + " value" + (b[1] === 1 ? "" : "s") + ": " + b[3], n.line);
            if (n.name === "attachInterrupt") E("Interrupts aren't simulated yet. Check the pin with digitalRead() inside loop() instead.", n.line);
            n.ty = b[2] === "=" ? (n.args.length ? n.args.reduce(function (t, a) { return arith(t, a.ty); }, n.args[0].ty) : "i16") : b[2];
            n.y = !!b[4] || any;
            return n;
          }
          var sg = suggest(n.name, Object.keys(BUILTINS).concat(Object.keys(funcs)));
          E("There's no function called " + n.name + "()." + (sg ? " Did you mean " + sg + "()?" : ""), n.line);
          n.ty = "i16"; n.y = any; return n;
        }
        case "mcall": {
          expr(n.obj); n.args.forEach(expr);
          var cls = n.obj.ty === "s" ? "String" : n.obj.cls;
          var table = METHODS[cls];
          if (!table) { E("'" + (n.obj.name || "this") + "' has no methods. Did you mean Serial?", n.line); n.ty = "i16"; n.y = false; return n; }
          var mm = table[n.name];
          if (!mm) {
            var sm = suggest(n.name, Object.keys(table));
            E(cls + " has no ." + n.name + "()." + (sm ? " Did you mean ." + sm + "()?" : ""), n.line);
            n.ty = "i16"; n.y = false; return n;
          }
          if (n.args.length < mm[0] || n.args.length > mm[1]) E("." + n.name + "() was given the wrong number of values.", n.line);
          n.cls = cls; n.ty = mm[2]; n.y = n.args.some(function (a) { return a.y; });
          /* like the real Stream class, these wait (up to setTimeout, 1 s by
           * default) for the data they need, so they can pause the program */
          if ((cls === "Serial" || cls === "SoftSerial") && /^(parseInt|parseFloat|readString|readStringUntil)$/.test(n.name)) { n.wait = true; n.y = true; }
          return n;
        }
        case "init": initList(n); n.y = false; return n;
      }
      return n;
    }

    function stmt(s, fn) {
      switch (s.k) {
        case "block": scopes.push({}); s.body.forEach(function (x) { stmt(x, fn); }); scopes.pop(); return;
        case "decl": s.items.forEach(declare); return;
        case "expr": expr(s.e); return;
        case "if": expr(s.c); stmt(s.a, fn); if (s.b) stmt(s.b, fn); return;
        case "while": expr(s.c); stmt(s.body, fn); return;
        case "do": stmt(s.body, fn); expr(s.c); return;
        case "for":
          scopes.push({});
          if (s.init) { if (s.init.k === "decl") s.init.items.forEach(declare); else expr(s.init.e); }
          if (s.c) expr(s.c); if (s.step) expr(s.step);
          stmt(s.body, fn);
          scopes.pop(); return;
        case "switch":
          expr(s.e);
          scopes.push({});
          s.cases.forEach(function (c) { if (c.v) expr(c.v); c.body.forEach(function (x) { stmt(x, fn); }); });
          scopes.pop(); return;
        case "return":
          if (s.e) expr(s.e);
          if (fn && fn.ret === "v" && s.e) E(fn.name + "() is void, so it can't return a value.", s.line);
          return;
      }
    }

    ast.globals.forEach(function (d) { stmt(d, null); });
    Object.keys(funcs).forEach(function (name) {
      var f = funcs[name], ps = {};
      f.params.forEach(function (p) { ps[p.name] = { ty: p.ty, cls: p.cls, arr: p.arr, dims: p.arr ? 1 : 0 }; });
      scopes = [globals, ps];
      stmt(f.body, f);
      scopes = [globals];
    });
    if (!funcs.setup) errors.push({ line: 1, msg: "Every sketch needs a setup() function: void setup() { … }" });
    if (!funcs.loop) errors.push({ line: 1, msg: "Every sketch needs a loop() function: void loop() { … }" });
    return errors;
  }

  /* =========================================================== COMPILE */

  function compile(src) {
    try {
      var tk = tokenize(String(src || ""));
      var ast = new Parser(tk).program();
      var errors = resolve(ast);
      if (errors.length) {
        errors.sort(function (a, b) { return a.line - b.line; });
        return { ok: false, errors: errors.slice(0, 8) };
      }
      return { ok: true, prog: ast };
    } catch (e) {
      if (e instanceof CErr) return { ok: false, errors: [{ line: e.line, msg: e.message }] };
      throw e;
    }
  }

  /* =========================================================== RUNTIME */

  var BRK = { brk: 1 }, CNT = { cnt: 1 };
  var STMT_COST = 4e-6;          /* seconds a statement takes on a 16 MHz AVR, roughly */
  var PWM_OK = { 3: 1, 5: 1, 6: 1, 9: 1, 10: 1, 11: 1 };

  function Runtime(prog, host) {
    this.prog = prog;
    this.host = host || {};
    this.reset();
  }
  L.MCU = { compile: compile, Runtime: Runtime, tokenize: tokenize, wrap: wrap, fmtNum: fmtNum };

  var R = Runtime.prototype;

  R.reset = function () {
    this.pins = {};
    this.servos = {};
    this.lcd = null;
    this.serialIn = "";
    this.serialOn = false;
    this.running = false;
    this.paused = false;
    this.error = null;
    this.clock = 0; this.t0 = 0; this.waitUntil = 0;
    this.line = 0; this.depth = 0;
    this.loops = 0;
    this.stepTarget = null;
    this.breakpoints = this.breakpoints || {};
    this.traceRate = 0;
    this.gate = 0;
    this.pending = null;
    this.release = false;
    this.seed = 12345;
    this.txUntil = 0;
    this.hints = {};
    this.globals = {};
    this.softs = [];
    this.statics = new Map();
    this.gen = null;
  };

  R.start = function (t) {
    this.reset();
    this.t0 = t || 0; this.clock = this.t0; this.waitUntil = this.t0;
    this.running = true;
    this.gen = this.main();
    this.emit("state");
  };
  R.stop = function () { this.running = false; this.paused = false; this.pins = {}; this.servos = {}; this.emit("state"); };
  R.pause = function () { if (this.running) { this.paused = true; this.stepTarget = null; this.emit("state"); } };
  R.resume = function () {
    if (!this.running || this.error) return;
    if (this.pending) this.release = true;
    this.paused = false; this.stepTarget = null; this.emit("state");
  };
  /* "line": stop at the very next statement. "over": the next one at this
   * depth or shallower, so a call to your own function runs as one step.
   * "loop": run until loop() starts again. */
  R.step = function (kind) {
    if (!this.running || this.error) return;
    this.stepTarget = { kind: kind || "line", depth: this.depth };
    if (this.pending) this.release = true;
    this.paused = false;
    this.emit("state");
  };
  R.setTrace = function (linesPerSecond) { this.traceRate = linesPerSecond || 0; };
  R.send = function (text) { this.serialIn += text; };

  R.emit = function (kind, data) { if (this.host.on) this.host.on(kind, data || {}, this); };
  R.hint = function (key, msg, line) {
    if (this.hints[key]) return;
    this.hints[key] = 1;
    this.emit("hint", { msg: msg, line: line || this.line });
  };
  R.effect = function (e) { e.line = this.line; e.t = this.clock - this.t0; this.emit("effect", e); };
  R.millis = function () { return Math.floor((this.clock - this.t0) * 1000); };

  /* Run the program until its own clock reaches t (simulated seconds). */
  R.advance = function (t, wallNow) {
    if (!this.running || this.error || !this.gen) return;
    if (this.paused) { var lag = t - this.clock; this.clock = t; this.waitUntil += lag; return; }
    var budget = this.host.budget || 6000;
    var now = wallNow != null ? wallNow : Date.now() / 1000;
    while (this.clock < t && budget-- > 0) {
      if (this.waitUntil > this.clock) { this.clock = Math.min(this.waitUntil, t); continue; }
      var ev = this.pending;
      this.pending = null;
      if (!ev) {
        var r;
        try { r = this.gen.next(); }
        catch (e) {
          if (e && e.runtime) { this.fail(e.message, e.line); return; }
          if (e instanceof RangeError) { this.fail("The program ran out of memory — usually a function that calls itself forever.", this.line); return; }
          throw e;
        }
        if (r.done) { this.running = false; this.emit("state"); return; }
        ev = r.value;
      }
      if (ev.k === "line") {
        /* `released`: this is the line we were paused on, and Run or Step
         * was just pressed — so run it, don't stop on it again. */
        var released = this.release;
        this.release = false;
        /* crawling along for a class to follow: hold the line until it is due */
        if (this.traceRate > 0 && now < this.gate) { this.pending = ev; this.release = released; this.clock = t; return; }
        if (!released) {
          var st = this.stepTarget;
          var stop = this.breakpoints[ev.line] ? "breakpoint" :
            (st && (st.kind === "line" || (st.kind === "over" && ev.depth <= st.depth) || (st.kind === "loop" && st.looped))) ? "step" : null;
          if (stop) {
            this.pending = ev; this.paused = true; this.stepTarget = null;
            this.line = ev.line; this.depth = ev.depth;
            this.emit("line", { line: ev.line }); this.emit("state", { why: stop });
            return;
          }
        }
        this.line = ev.line; this.depth = ev.depth;
        this.clock += STMT_COST;
        this.emit("line", { line: ev.line });
        if (this.traceRate > 0) this.gate = now + 1 / this.traceRate;
      } else if (ev.k === "delay") {
        this.waitUntil = this.clock + ev.s;
        if (ev.s >= 0.01) this.emit("wait", { s: ev.s, line: this.line });
      } else if (ev.k === "loop") {
        this.loops++;
        if (this.stepTarget && this.stepTarget.kind === "loop") this.stepTarget.looped = true;
        this.emit("loop", { n: this.loops });
      }
    }
    if (this.clock < t) this.clock = t;   /* out of budget: let the clock catch up rather than fall behind forever */
    this.tone();
  };

  R.fail = function (msg, line) {
    this.error = { msg: msg, line: line || this.line };
    this.paused = true;
    this.emit("error", this.error);
    this.emit("state");
  };

  R.tone = function () {
    for (var k in this.pins) {
      var p = this.pins[k];
      if (p.tone > 0 && p.toneUntil && this.clock >= p.toneUntil) { p.tone = 0; p.toneUntil = 0; }
    }
  };

  /* ---------------------------------------------------------- execution */

  function line(n, depth) { return { k: "line", line: n, depth: depth }; }

  R.main = function* () {
    var g = this.globals, self = this;
    this.depth = 0;
    for (var i = 0; i < this.prog.globals.length; i++) this.declare(this.prog.globals[i], g, true);
    yield* this.call(this.prog.funcs.setup, []);
    for (;;) {
      yield { k: "loop" };
      yield* this.call(this.prog.funcs.loop, []);
      if (self.depth !== 0) self.depth = 0;
    }
  };

  R.call = function* (fn, args) {
    if (this.depth > 120) throw new RtErr(fn.name + "() keeps calling itself and never stops.", fn.line);
    var sc = Object.create(this.globals);
    fn.params.forEach(function (p, i) {
      var a = args[i];
      if (p.arr) sc[p.name] = a && a.arr ? a : { v: [], ty: p.ty, arr: true };
      else sc[p.name] = { v: a && a.arr ? 0 : wrap(p.ty, a == null ? 0 : a), ty: p.ty };
    });
    this.depth++;
    var r;
    try { r = yield* this.exec(fn.body, sc); }
    finally { this.depth--; }
    if (r && r.r !== undefined) return fn.ret === "v" ? 0 : wrap(fn.ret, r.r);
    return 0;
  };

  R.declare = function (d, sc, global) {
    for (var i = 0; i < d.items.length; i++) {
      var it = d.items[i];
      if (it.isStatic && !global) {
        if (!this.statics.has(it)) { var tmp = {}; this.declOne(it, tmp); this.statics.set(it, tmp[it.name]); }
        sc[it.name] = this.statics.get(it);
        continue;
      }
      this.declOne(it, sc);
    }
  };

  R.declOne = function (it, sc) {
    var self = this;
    if (it.cls) {
      var args = (it.ctor || []).map(function (a) { return self.ev(a, sc); });
      var obj;
      if (it.cls === "Servo") obj = { cls: "Servo", pin: -1, angle: 90 };
      else if (it.cls === "SoftSerial") {
        if (args.length < 2) throw new RtErr("SoftwareSerial needs its two pins: SoftwareSerial " + it.name + "(rxPin, txPin);", it.line);
        obj = { cls: "SoftSerial", name: it.name, rx: Math.trunc(args[0]), tx: Math.trunc(args[1]), buf: "", on: false };
        this.softs.push(obj);
      } else {
        obj = { cls: "LCD", addr: args[0] || 0x27, cols: args[1] || 16, rows: args[2] || 2, cx: 0, cy: 0, on: false, light: false, buf: null };
        obj.buf = blankLcd(obj.cols, obj.rows);
      }
      sc[it.name] = { v: obj, ty: "o", cls: it.cls };
      return;
    }
    if (it.dims) {
      var init = it.init;
      var build = function (level, initNode) {
        var size = it.dims[level] ? self.ev(it.dims[level], sc) : null;
        var items = initNode && initNode.k === "init" ? initNode.items : null;
        if (initNode && initNode.k === "str" && level === it.dims.length - 1) {
          var s = initNode.v, arr = [];
          for (var q = 0; q < s.length; q++) arr.push(s.charCodeAt(q));
          arr.push(0);
          while (size != null && arr.length < size) arr.push(0);
          return arr;
        }
        if (size == null) size = items ? items.length : 0;
        if (size > 2048) throw new RtErr("That array is too big for an Arduino Uno (it has only 2 KB of memory).", it.line);
        if (items && items.length > size) throw new RtErr("Too many starting values for '" + it.name + "': it has room for " + size + ".", it.line);
        var out = [];
        for (var k = 0; k < size; k++) {
          if (level < it.dims.length - 1) out.push(build(level + 1, items && items[k]));
          else out.push(items && items[k] ? wrap(it.ty, self.ev(items[k], sc)) : (it.ty === "s" ? "" : 0));
        }
        return out;
      };
      sc[it.name] = { v: build(0, init), ty: it.ty, arr: true, dims: it.dims.length };
      return;
    }
    var v = it.init ? this.ev(it.init, sc) : (it.ty === "s" ? "" : 0);
    sc[it.name] = { v: it.ty === "s" ? this.str(v, it.init ? it.init.ty : "s") : wrap(it.ty, v), ty: it.ty };
  };

  function blankLcd(cols, rows) { var b = []; for (var r = 0; r < rows; r++) b.push(new Array(cols + 1).join(" ")); return b; }

  /* Statements. Each yields its line first, so the editor can light it up
   * before it runs. Returns BRK, CNT, {r: value} or nothing. */
  R.exec = function* (s, sc) {
    var r, i;
    switch (s.k) {
      case "block": {
        var inner = Object.create(sc);
        for (i = 0; i < s.body.length; i++) {
          r = yield* this.exec(s.body[i], inner);
          if (r) return r;
        }
        return null;
      }
      case "decl":
        yield line(s.line, this.depth);
        if (s.items.some(function (it) { return it.init && it.init.y; })) {
          for (i = 0; i < s.items.length; i++) {
            var it = s.items[i];
            if (it.init && it.init.y) {
              var val = yield* this.evg(it.init, sc);
              var copy = Object.assign({}, it, { init: { k: "num", v: val, ty: it.init.ty } });
              this.declOne(copy, sc);
            } else this.declOne(it, sc);
          }
        } else this.declare(s, sc, false);
        return null;
      case "expr":
        yield line(s.line, this.depth);
        if (s.e.y) yield* this.evg(s.e, sc); else this.ev(s.e, sc);
        return null;
      case "if": {
        yield line(s.line, this.depth);
        var c = s.c.y ? yield* this.evg(s.c, sc) : this.ev(s.c, sc);
        if (truthy(c)) return yield* this.exec(s.a, sc);
        if (s.b) return yield* this.exec(s.b, sc);
        return null;
      }
      case "while":
        for (;;) {
          yield line(s.line, this.depth);
          var wc = s.c.y ? yield* this.evg(s.c, sc) : this.ev(s.c, sc);
          if (!truthy(wc)) return null;
          r = yield* this.exec(s.body, sc);
          if (r === BRK) return null;
          if (r === CNT) continue;
          if (r) return r;
        }
      case "do":
        for (;;) {
          r = yield* this.exec(s.body, sc);
          if (r === BRK) return null;
          if (r && r !== CNT) return r;
          yield line(s.cline || s.line, this.depth);
          var dc = s.c.y ? yield* this.evg(s.c, sc) : this.ev(s.c, sc);
          if (!truthy(dc)) return null;
        }
      case "for": {
        var fs = Object.create(sc);
        yield line(s.line, this.depth);
        if (s.init) {
          if (s.init.k === "decl") this.declare(s.init, fs, false);
          else if (s.init.e.y) yield* this.evg(s.init.e, fs); else this.ev(s.init.e, fs);
        }
        var first = true;
        for (;;) {
          if (!first) {
            yield line(s.line, this.depth);
            if (s.step) { if (s.step.y) yield* this.evg(s.step, fs); else this.ev(s.step, fs); }
          }
          first = false;
          if (s.c) { var fc = s.c.y ? yield* this.evg(s.c, fs) : this.ev(s.c, fs); if (!truthy(fc)) return null; }
          r = yield* this.exec(s.body, fs);
          if (r === BRK) return null;
          if (r === CNT) continue;
          if (r) return r;
        }
      }
      case "switch": {
        yield line(s.line, this.depth);
        var v = s.e.y ? yield* this.evg(s.e, sc) : this.ev(s.e, sc);
        var start = -1, dflt = -1;
        for (i = 0; i < s.cases.length; i++) {
          if (s.cases[i].v == null) { dflt = i; continue; }
          if (this.ev(s.cases[i].v, sc) === v) { start = i; break; }
        }
        if (start < 0) start = dflt;
        if (start < 0) return null;
        var ss = Object.create(sc);
        for (i = start; i < s.cases.length; i++) {
          for (var j = 0; j < s.cases[i].body.length; j++) {
            r = yield* this.exec(s.cases[i].body[j], ss);
            if (r === BRK) return null;
            if (r) return r;
          }
        }
        return null;
      }
      case "break": yield line(s.line, this.depth); return BRK;
      case "continue": yield line(s.line, this.depth); return CNT;
      case "return": {
        yield line(s.line, this.depth);
        var rv = s.e ? (s.e.y ? yield* this.evg(s.e, sc) : this.ev(s.e, sc)) : 0;
        return { r: rv };
      }
      default: return null;
    }
  };

  function truthy(v) { return typeof v === "string" ? v.length > 0 : !!v; }

  R.str = function (v, ty, arg) {
    if (v && v.arr) {
      if (v.ty === "c" || v.ty === "u8") { var s = ""; for (var i = 0; i < v.v.length && v.v[i]; i++) s += String.fromCharCode(v.v[i]); return s; }
      throw new RtErr("A whole array can't be printed. Print one item at a time, like " + "arr[0].", this.line);
    }
    return fmtNum(v, ty, arg);
  };

  /* An assignable place: a variable, or one slot of an array. */
  R.ref = function (n, sc) {
    if (n.k === "id") {
      var cell = sc[n.name];
      if (!cell) throw new RtErr("'" + n.name + "' doesn't exist here.", n.line);
      return { o: cell, k: "v", ty: cell.ty };
    }
    if (n.k === "idx") {
      var base = this.arrOf(n.a, sc), ix = this.ev(n.i, sc);
      if (n.strIdx) throw new RtErr("Changing one letter of a String isn't supported. Build a new String instead.", n.line);
      this.bounds(base, ix, n);
      return { o: base, k: ix, ty: n.ty };
    }
    throw new RtErr("Can't assign to that.", n.line);
  };
  R.arrOf = function (n, sc) {
    if (n.k === "id") {
      var c = sc[n.name];
      if (!c || !c.arr) throw new RtErr("'" + n.name + "' isn't an array.", n.line);
      return c.v;
    }
    if (n.k === "idx") {
      var b = this.arrOf(n.a, sc), i = this.ev(n.i, sc);
      this.bounds(b, i, n);
      return b[i];
    }
    throw new RtErr("That isn't an array.", n.line);
  };
  R.bounds = function (arr, i, n) {
    if (!(i >= 0 && i < arr.length) || i !== Math.floor(i)) {
      var name = n.a && n.a.name ? "'" + n.a.name + "'" : "this array";
      throw new RtErr("Array index " + i + " is outside " + name + ", which has " + arr.length + " slots (0 to " + (arr.length - 1) +
        "). On a real Arduino this silently scribbles over other memory — here it stops so you can see it.", n.line);
    }
  };

  R.binop = function (n, a, b) {
    var t = n.opTy, op = n.op;
    if (t === "s") {
      var sa = typeof a === "string" ? a : this.str(a, n.a.ty), sb = typeof b === "string" ? b : this.str(b, n.b.ty);
      switch (op) {
        case "+": return sa + sb;
        case "==": return sa === sb ? 1 : 0; case "!=": return sa !== sb ? 1 : 0;
        case "<": return sa < sb ? 1 : 0; case ">": return sa > sb ? 1 : 0;
        case "<=": return sa <= sb ? 1 : 0; case ">=": return sa >= sb ? 1 : 0;
      }
      return 0;
    }
    if (t === "f") {
      switch (op) {
        case "+": return a + b; case "-": return a - b; case "*": return a * b;
        case "/": return a / b; case "%": return a % b;
        case "==": return a === b ? 1 : 0; case "!=": return a !== b ? 1 : 0;
        case "<": return a < b ? 1 : 0; case ">": return a > b ? 1 : 0;
        case "<=": return a <= b ? 1 : 0; case ">=": return a >= b ? 1 : 0;
      }
    }
    a = wrap(t, a); b = wrap(t, b);
    var uns = t === "u16" || t === "u32";
    switch (op) {
      case "+": return wrap(t, a + b);
      case "-": return wrap(t, a - b);
      case "*": return wrap(t, (t === "i32" || t === "u32") ? Math.imul(a, b) : a * b);
      case "/":
        if (b === 0) throw new RtErr("Division by zero. The thing after / is 0 here — check it before you divide.", n.line);
        return wrap(t, Math.trunc(a / b));
      case "%":
        if (b === 0) throw new RtErr("Remainder (%) by zero. The thing after % is 0 here.", n.line);
        return wrap(t, a % b);
      case "<<": return wrap(t, a << (b & 31));
      case ">>": return wrap(t, uns ? a >>> (b & 31) : a >> (b & 31));
      case "&": return wrap(t, a & b); case "|": return wrap(t, a | b); case "^": return wrap(t, a ^ b);
      case "==": return a === b ? 1 : 0; case "!=": return a !== b ? 1 : 0;
      case "<": return a < b ? 1 : 0; case ">": return a > b ? 1 : 0;
      case "<=": return a <= b ? 1 : 0; case ">=": return a >= b ? 1 : 0;
    }
    return 0;
  };

  R.unop = function (n, a) {
    switch (n.op) {
      case "!": return truthy(a) ? 0 : 1;
      case "-": return n.ty === "f" ? -a : wrap(n.ty, -a);
      case "+": return a;
      case "~": return wrap(n.ty, ~a);
    }
  };

  R.assign = function (n, sc, rhs) {
    var ref = this.ref(n.a, sc), v;
    if (n.op === "=") v = rhs;
    else {
      var fake = { op: n.op.slice(0, -1), opTy: n.opTy, a: n.a, b: n.b, line: n.line };
      v = this.binop(fake, ref.o[ref.k], rhs);
    }
    if (ref.ty === "s") v = typeof v === "string" ? v : this.str(v, n.b.ty);
    else v = wrap(ref.ty, v);
    ref.o[ref.k] = v;
    this.watch(n.a, v);
    return v;
  };
  R.incdec = function (n, sc) {
    var ref = this.ref(n.a, sc), old = ref.o[ref.k];
    var nv = ref.ty === "f" ? old + (n.op === "++" ? 1 : -1) : wrap(ref.ty, old + (n.op === "++" ? 1 : -1));
    ref.o[ref.k] = nv;
    this.watch(n.a, nv);
    return n.k === "pre" ? nv : old;
  };
  R.watch = function (target, v) { if (target.k === "id" && this.host.watch) this.emit("set", { name: target.name, v: v }); };

  /* Synchronous evaluation: anything that cannot pause. */
  R.ev = function (n, sc) {
    switch (n.k) {
      case "num": return n.v;
      case "str": return n.v;
      case "id": {
        var cell = sc[n.name];
        if (!cell) {
          if (n.cls === "Serial") return { cls: "Serial" };
          throw new RtErr("'" + n.name + "' doesn't exist here.", n.line);
        }
        return cell.arr ? cell : cell.v;
      }
      case "bin": return this.binop(n, this.ev(n.a, sc), this.ev(n.b, sc));
      case "log":
        if (n.op === "&&") return truthy(this.ev(n.a, sc)) && truthy(this.ev(n.b, sc)) ? 1 : 0;
        return truthy(this.ev(n.a, sc)) || truthy(this.ev(n.b, sc)) ? 1 : 0;
      case "un": return this.unop(n, this.ev(n.a, sc));
      case "pre": case "post": return this.incdec(n, sc);
      case "asg": return this.assign(n, sc, this.ev(n.b, sc));
      case "cond": return truthy(this.ev(n.c, sc)) ? this.ev(n.a, sc) : this.ev(n.b, sc);
      case "comma": this.ev(n.a, sc); return this.ev(n.b, sc);
      case "cast": { var cv = this.ev(n.a, sc); return n.ty === "s" ? this.str(cv, n.a.ty) : wrap(n.ty, typeof cv === "string" ? parseFloat(cv) || 0 : cv); }
      case "sizeof": {
        if (n.a.k === "id" && sc[n.a.name] && sc[n.a.name].arr) {
          var c2 = sc[n.a.name], count = 1, x = c2.v;
          while (Array.isArray(x)) { count *= x.length; x = x[0]; }
          return count * (BYTES[c2.ty] || 2);
        }
        if (n.a.k === "idx" && n.a.arr) { var sub = this.arrOf(n.a, sc); return sub.length * (BYTES[n.a.ty] || 2); }
        return BYTES[n.a.ty] || 2;
      }
      case "idx": {
        if (n.strIdx) { var s = this.ev(n.a, sc), si = this.ev(n.i, sc); return si >= 0 && si < s.length ? s.charCodeAt(si) : 0; }
        var arr = this.arrOf(n.a, sc), i = this.ev(n.i, sc);
        this.bounds(arr, i, n);
        return Array.isArray(arr[i]) ? { v: arr[i], ty: n.ty, arr: true } : arr[i];
      }
      case "call": {
        var args = [];
        for (var k = 0; k < n.args.length; k++) args.push(this.ev(n.args[k], sc));
        return this.builtin(n, args);
      }
      case "mcall": {
        var obj = this.ev(n.obj, sc), margs = [];
        for (var m = 0; m < n.args.length; m++) margs.push(this.ev(n.args[m], sc));
        return this.method(n, obj, margs, sc);
      }
    }
    throw new RtErr("Can't work that out.", n.line);
  };

  /* Generator evaluation: for expressions that might pause. Mirrors ev()
   * but lets delay() and your own functions yield. */
  R.evg = function* (n, sc) {
    if (!n.y) return this.ev(n, sc);
    switch (n.k) {
      case "bin": { var a = yield* this.evg(n.a, sc), b = yield* this.evg(n.b, sc); return this.binop(n, a, b); }
      case "log": {
        var la = truthy(yield* this.evg(n.a, sc));
        if (n.op === "&&") return la && truthy(yield* this.evg(n.b, sc)) ? 1 : 0;
        return la || truthy(yield* this.evg(n.b, sc)) ? 1 : 0;
      }
      case "un": return this.unop(n, yield* this.evg(n.a, sc));
      case "asg": return this.assign(n, sc, yield* this.evg(n.b, sc));
      case "cond": return truthy(yield* this.evg(n.c, sc)) ? yield* this.evg(n.a, sc) : yield* this.evg(n.b, sc);
      case "comma": yield* this.evg(n.a, sc); return yield* this.evg(n.b, sc);
      case "cast": { var cv = yield* this.evg(n.a, sc); return n.ty === "s" ? this.str(cv, n.a.ty) : wrap(n.ty, cv); }
      case "pre": case "post": return this.incdec(n, sc);
      case "idx": return this.ev(n, sc);
      case "call": {
        var args = [];
        for (var i = 0; i < n.args.length; i++) args.push(yield* this.evg(n.args[i], sc));
        if (n.user) {
          var fn = this.prog.funcs[n.name];
          if (!fn) throw new RtErr(n.name + "() is declared but never written.", n.line);
          var callArgs = n.args.map(function (an, ix) { return an.arr ? sc[an.name] : args[ix]; });
          return yield* this.call(fn, callArgs);
        }
        if (n.name === "delay") { var ms = Math.max(0, +args[0] || 0); this.effect({ kind: "delay", ms: ms }); yield { k: "delay", s: ms / 1000 }; return 0; }
        if (n.name === "delayMicroseconds") { yield { k: "delay", s: Math.max(0, +args[0] || 0) / 1e6 }; return 0; }
        if (n.name === "pulseIn") return yield* this.pulseIn(n, args);
        return this.builtin(n, args);
      }
      case "mcall": {
        var obj = this.ev(n.obj, sc), margs = [];
        for (var m = 0; m < n.args.length; m++) margs.push(yield* this.evg(n.args[m], sc));
        if (n.wait) yield* this.streamWait(n, obj, margs);
        return this.method(n, obj, margs, sc);
      }
    }
    return this.ev(n, sc);
  };

  /* --------------------------------------------------------- the board */

  R.pin = function (num, n, what) {
    num = Math.trunc(num);
    if (num >= 0 && num <= 7 && what === "analog") num += 14;
    if (!(num >= 0 && num <= 21)) throw new RtErr("There's no pin " + num + ". An Uno has pins 0–13 and A0–A5.", n.line);
    if (num >= 20 && what !== "analog") throw new RtErr("A6 and A7 can only be read with analogRead().", n.line);
    var p = this.pins[num];
    if (!p) p = this.pins[num] = { mode: "IN", out: 0, pwm: null, tone: 0, last: 0 };
    return { num: num, p: p };
  };

  R.builtin = function (n, a) {
    var self = this, x;
    switch (n.name) {
      case "pinMode": {
        var pm = this.pin(a[0], n);
        pm.p.mode = a[1] === 1 ? "OUT" : a[1] === 2 ? "PU" : "IN";
        if (pm.p.mode !== "OUT") { pm.p.pwm = null; pm.p.tone = 0; }
        if (pm.num <= 1 && this.serialOn) this.hint("serialpins", "Pins 0 and 1 are the Serial (USB) lines. Using them while Serial is on causes strange behaviour.", n.line);
        this.effect({ kind: "mode", pin: pm.num, mode: pm.p.mode });
        return 0;
      }
      case "digitalWrite": {
        var dw = this.pin(a[0], n), val = a[1] ? 1 : 0;
        if (dw.p.mode !== "OUT") {
          /* what the real chip does: writing HIGH to an input turns on its pull-up */
          dw.p.mode = val ? "PU" : "IN";
          this.hint("mode" + dw.num, "Pin " + L.pinName(dw.num) + " isn't an OUTPUT, so digitalWrite only switches its weak pull-up on and off. Add pinMode(" + dw.num + ", OUTPUT); to setup().", n.line);
        }
        dw.p.out = val; dw.p.pwm = null;
        this.effect({ kind: "write", pin: dw.num, value: val });
        return 0;
      }
      case "digitalRead": {
        var dr = this.pin(a[0], n);
        var v = this.host.volts ? this.host.volts(dr.num) : 0;
        var hi = dr.p.last ? v > 2.3 : v > 2.7;   /* the input's real hysteresis */
        dr.p.last = hi ? 1 : 0;
        if (dr.p.mode === "OUT") return dr.p.out;
        if (dr.p.mode === "IN" && this.host.floating && this.host.floating(dr.num)) {
          this.hint("float" + dr.num, "Pin " + L.pinName(dr.num) + " is floating: nothing pulls it up or down, so a real board would read random values. Use INPUT_PULLUP, or add a 10 kΩ resistor to GND.", n.line);
        }
        this.effect({ kind: "read", pin: dr.num, value: dr.p.last, volts: v });
        return dr.p.last;
      }
      case "analogRead": {
        var ar = this.pin(a[0], n, "analog");
        if (ar.num < 14) throw new RtErr("analogRead() works on the analog pins A0–A5. Pin " + ar.num + " is digital — try analogRead(A0).", n.line);
        var av = this.host.volts ? this.host.volts(ar.num) : 0;
        var raw = Math.round(L.clamp(av / 5, 0, 1) * 1023);
        this.effect({ kind: "aread", pin: ar.num, value: raw, volts: av });
        return raw;
      }
      case "analogWrite": {
        var aw = this.pin(a[0], n), duty = Math.round(L.clamp(a[1], 0, 255));
        aw.p.mode = "OUT";
        if (!PWM_OK[aw.num]) {
          this.hint("pwm" + aw.num, "Pin " + L.pinName(aw.num) + " can't dim. Only the pins marked ~ (3, 5, 6, 9, 10, 11) can; here it just switches fully on or off.", n.line);
          aw.p.out = duty >= 128 ? 1 : 0; aw.p.pwm = null;
        } else aw.p.pwm = duty;
        this.effect({ kind: "pwm", pin: aw.num, value: duty });
        return 0;
      }
      case "analogReference": return 0;
      case "millis": return wrap("u32", this.millis());
      case "micros": return wrap("u32", Math.floor((this.clock - this.t0) * 1e6 / 4) * 4);
      case "tone": {
        var tp = this.pin(a[0], n);
        tp.p.mode = "OUT"; tp.p.tone = Math.max(31, a[1]); tp.p.toneUntil = a[2] ? this.clock + a[2] / 1000 : 0;
        this.effect({ kind: "tone", pin: tp.num, value: a[1] });
        return 0;
      }
      case "noTone": { var np = this.pin(a[0], n); np.p.tone = 0; np.p.out = 0; this.effect({ kind: "tone", pin: np.num, value: 0 }); return 0; }
      case "map": {
        if (a[2] === a[1]) throw new RtErr("map() can't map from a range where both ends are the same.", n.line);
        return wrap("i32", Math.trunc((a[0] - a[1]) * (a[4] - a[3]) / (a[2] - a[1])) + a[3]);
      }
      case "constrain": x = a[0] < a[1] ? a[1] : a[0] > a[2] ? a[2] : a[0]; return n.ty === "f" ? x : wrap(n.ty, x);
      case "min": return Math.min(a[0], a[1]);
      case "max": return Math.max(a[0], a[1]);
      case "abs": return n.ty === "f" ? Math.abs(a[0]) : wrap(n.ty, Math.abs(a[0]));
      case "sq": return n.ty === "f" ? a[0] * a[0] : wrap(n.ty, a[0] * a[0]);
      case "sqrt": return Math.sqrt(a[0]);
      case "pow": return Math.pow(a[0], a[1]);
      case "sin": return Math.sin(a[0]); case "cos": return Math.cos(a[0]); case "tan": return Math.tan(a[0]);
      case "atan2": return Math.atan2(a[0], a[1]); case "log": return Math.log(a[0]); case "log10": return Math.log10(a[0]);
      case "exp": return Math.exp(a[0]); case "floor": return Math.floor(a[0]); case "ceil": return Math.ceil(a[0]);
      case "round": return Math.round(a[0]); case "fabs": return Math.abs(a[0]);
      case "random": {
        this.seed = (this.seed * 1103515245 + 12345) >>> 0;
        var r = this.seed / 4294967296;
        var lo = a.length === 2 ? a[0] : 0, hi = a.length === 2 ? a[1] : a[0];
        return hi <= lo ? lo : Math.floor(lo + r * (hi - lo));
      }
      case "randomSeed": this.seed = (a[0] >>> 0) || 1; return 0;
      case "bitRead": return (a[0] >> a[1]) & 1;
      case "bit": return wrap("u32", 1 << a[0]);
      case "lowByte": return a[0] & 0xFF;
      case "highByte": return (a[0] >> 8) & 0xFF;
      case "isDigit": return a[0] >= 48 && a[0] <= 57 ? 1 : 0;
      case "isAlpha": return (a[0] >= 65 && a[0] <= 90) || (a[0] >= 97 && a[0] <= 122) ? 1 : 0;
      case "String": {
        if (!n.args.length) return "";
        var at = n.args[0].ty;
        if (a.length === 2) return fmtNum(a[0], at, a[1]);
        return typeof a[0] === "string" ? a[0] : this.str(a[0], at);
      }
      case "digitalPinToInterrupt": return a[0] === 2 ? 0 : a[0] === 3 ? 1 : -1;
      case "interrupts": case "noInterrupts": case "detachInterrupt": case "attachInterrupt": return 0;
    }
    throw new RtErr(n.name + "() isn't available.", n.line);
  };

  R.pulseIn = function* (n, a) {
    var pp = this.pin(a[0], n);
    var cm = this.host.echo ? this.host.echo(pp.num) : null;
    var timeout = a[2] != null ? a[2] / 1e6 : 1;
    if (cm == null) {
      this.hint("pulse" + pp.num, "pulseIn() on pin " + L.pinName(pp.num) + " never saw a pulse, so it waited the full timeout and returned 0. Is a powered HC-SR04's ECHO wired to this pin?", n.line);
      yield { k: "delay", s: timeout };
      return 0;
    }
    var us = Math.round(cm * 58.3);
    if (us / 1e6 > timeout) { yield { k: "delay", s: timeout }; return 0; }
    this.effect({ kind: "echo", pin: pp.num, value: us });
    yield { k: "delay", s: us / 1e6 + 0.0002 };
    return us;
  };

  R.method = function (n, obj, a, sc) {
    var self = this;
    if (n.cls === "Serial" || n.cls === "SoftSerial") return this.serialCall(n, a, n.cls === "Serial" ? null : obj);
    if (n.cls === "Servo") {
      switch (n.name) {
        case "attach": obj.pin = this.pin(a[0], n).num; this.pins[obj.pin].mode = "OUT"; this.servos[obj.pin] = obj.angle; this.effect({ kind: "servo", pin: obj.pin, value: obj.angle }); return 1;
        case "write": case "writeMicroseconds": {
          var ang = n.name === "write" ? a[0] : (a[0] - 544) * 180 / (2400 - 544);
          if (n.name === "write" && a[0] > 180) ang = (a[0] - 544) * 180 / (2400 - 544);
          obj.angle = Math.round(L.clamp(ang, 0, 180));
          if (obj.pin < 0) { this.hint("servo", "servo.write() before servo.attach(pin). Attach it in setup().", n.line); return 0; }
          this.servos[obj.pin] = obj.angle;
          this.effect({ kind: "servo", pin: obj.pin, value: obj.angle });
          return 0;
        }
        case "read": return obj.angle;
        case "attached": return obj.pin >= 0 ? 1 : 0;
        case "detach": if (obj.pin >= 0) delete this.servos[obj.pin]; obj.pin = -1; return 0;
      }
    }
    if (n.cls === "LCD") {
      switch (n.name) {
        case "init": case "begin": obj.on = true; obj.light = true; obj.buf = blankLcd(obj.cols, obj.rows); obj.cx = obj.cy = 0; break;
        case "backlight": obj.light = true; break;
        case "noBacklight": obj.light = false; break;
        case "clear": obj.buf = blankLcd(obj.cols, obj.rows); obj.cx = obj.cy = 0; break;
        case "home": obj.cx = obj.cy = 0; break;
        case "setCursor": obj.cx = L.clamp(Math.trunc(a[0]), 0, obj.cols - 1); obj.cy = L.clamp(Math.trunc(a[1]), 0, obj.rows - 1); break;
        case "print": case "write": {
          var txt = n.name === "write" && typeof a[0] === "number" ? String.fromCharCode(a[0]) :
                    typeof a[0] === "string" ? a[0] : this.str(a[0], n.args[0].ty, a[1]);
          if (!obj.on) this.hint("lcd", "Call lcd.init(); (or lcd.begin();) in setup() before printing.", n.line);
          var row = obj.buf[obj.cy];
          for (var q = 0; q < txt.length && obj.cx < obj.cols; q++) {
            row = row.slice(0, obj.cx) + txt.charAt(q) + row.slice(obj.cx + 1);
            obj.cx++;
          }
          obj.buf[obj.cy] = row;
          this.effect({ kind: "lcd", text: txt });
          break;
        }
      }
      this.lcd = { rows: obj.on ? obj.buf.slice() : ["", ""], light: obj.light };
      return 0;
    }
    if (n.cls === "String") {
      var str = String(obj);
      switch (n.name) {
        case "length": return str.length;
        case "toInt": return parseInt(str, 10) || 0;
        case "toFloat": return parseFloat(str) || 0;
        case "indexOf": return str.indexOf(typeof a[0] === "number" ? String.fromCharCode(a[0]) : a[0], a[1] || 0);
        case "substring": return str.substring(a[0], a[1] == null ? str.length : a[1]);
        case "charAt": return str.charCodeAt(a[0]) || 0;
        case "equals": return str === a[0] ? 1 : 0;
        case "startsWith": return str.indexOf(a[0]) === 0 ? 1 : 0;
        case "endsWith": return str.slice(-String(a[0]).length) === a[0] ? 1 : 0;
        case "c_str": return str;
        case "toUpperCase": case "toLowerCase": case "trim": case "replace": case "concat": {
          var nv = n.name === "toUpperCase" ? str.toUpperCase() : n.name === "toLowerCase" ? str.toLowerCase() :
                   n.name === "trim" ? str.trim() : n.name === "concat" ? str + (typeof a[0] === "string" ? a[0] : this.str(a[0], n.args[0].ty)) :
                   str.split(a[0]).join(a[1]);
          if (n.obj.k === "id" && sc[n.obj.name]) sc[n.obj.name].v = nv;
          return n.name === "concat" ? 1 : 0;
        }
      }
    }
    return 0;
  };

  /* Serial and SoftwareSerial: one implementation. `soft` is the
   * SoftwareSerial object, or null for the hardware port, whose TX is D1
   * (and the USB cable) and whose RX is D0. */
  R.serialCall = function (n, a, soft) {
    var self = this;
    var getIn = function () { return soft ? soft.buf : self.serialIn; };
    var setIn = function (v) { if (soft) soft.buf = v; else self.serialIn = v; };
    switch (n.name) {
      case "begin":
        if (soft) { soft.on = true; this.softs.forEach(function (o) { o.listening = o === soft; }); }
        else { this.serialOn = true; this.baud = a[0]; }
        return 0;
      case "end": if (soft) soft.on = false; else this.serialOn = false; return 0;
      case "listen": this.softs.forEach(function (o) { o.listening = o === soft; }); return 1;
      case "setTimeout": if (soft) soft.timeout = Math.max(0, a[0]); else this.streamTimeout = Math.max(0, a[0]); return 0;
      case "isListening": return soft && soft.listening ? 1 : 0;
      case "overflow": return 0;
      case "print": case "println": case "write": {
        if (soft && !soft.on) this.hint("soft" + soft.name, soft.name + ".print() before " + soft.name + ".begin(9600). Start it in setup().", n.line);
        if (!soft && !this.serialOn) this.hint("serial", "Serial.print() before Serial.begin(9600). Add Serial.begin(9600); to setup() or nothing reaches the computer.", n.line);
        var s = "";
        if (a.length) {
          var arg = n.args[0];
          if (n.name === "write" && typeof a[0] === "number") s = String.fromCharCode(a[0] & 255);
          else s = typeof a[0] === "string" ? a[0] : this.str(a[0], arg.ty, a[1]);
        }
        if (n.name === "println") s += "\n";
        if (soft) {
          if (this.host.uart) this.host.uart(soft.tx, s);
          this.effect({ kind: "uart", pin: soft.tx, text: s, name: soft.name });
        } else {
          this.txUntil = (this.host.wall ? this.host.wall() : 0) + 0.05;
          this.emit("serial", { text: s });
          if (this.host.uart) this.host.uart(1, s);
          this.effect({ kind: "serial", text: s });
        }
        return s.length;
      }
      case "available": return getIn().length;
      case "read": case "peek": {
        var buf = getIn();
        if (!buf.length) return -1;
        var c = buf.charCodeAt(0);
        if (n.name === "read") setIn(buf.slice(1));
        return c;
      }
      case "parseInt": case "parseFloat": {
        var m = /^[^-\d.]*(-?\d+(\.\d+)?)/.exec(getIn());
        if (!m) { setIn(""); return 0; }
        setIn(getIn().slice(m.index + m[0].length));
        return n.name === "parseInt" ? parseInt(m[1], 10) : parseFloat(m[1]);
      }
      case "readString": { var all = getIn(); setIn(""); return all; }
      case "readStringUntil": {
        var stop = String.fromCharCode(a[0]), b2 = getIn(), ix = b2.indexOf(stop);
        var out = ix < 0 ? b2 : b2.slice(0, ix);
        setIn(ix < 0 ? "" : b2.slice(ix + 1));
        return out;
      }
      default: return 0;
    }
  };

  /* What Stream does on a real board: wait for enough data, or give up
   * after the timeout. readStringUntil waits for its terminator; parseInt
   * for a number followed by something that isn't a digit; readString for
   * the line to go quiet. */
  R.streamWait = function* (n, obj, a) {
    var self = this, soft = n.cls === "SoftSerial" ? obj : null;
    var buf = function () { return soft ? soft.buf : self.serialIn; };
    var timeout = ((soft ? soft.timeout : this.streamTimeout) || 1000) / 1000;
    var start = this.clock, lastLen = buf().length, lastChange = this.clock;
    for (;;) {
      var b = buf();
      if (b.length !== lastLen) { lastLen = b.length; lastChange = this.clock; }
      if (n.name === "readStringUntil") { if (b.indexOf(String.fromCharCode(a[0])) >= 0) return; }
      else if (n.name === "parseInt" || n.name === "parseFloat") { if (/-?\d+(\.\d+)?[^\d.]/.test(b)) return; }
      if (this.clock - lastChange >= timeout) return;
      if (n.name !== "readString" && this.clock - start >= timeout && this.clock - lastChange >= timeout) return;
      yield { k: "delay", s: 0.001 };
    }
  };

  /* Bytes arriving on a pin from outside — a Bluetooth module, a radio,
   * another board. D0 feeds Serial; any SoftwareSerial listening on that
   * pin gets it too. */
  R.uartIn = function (pin, text) {
    var got = false;
    if (pin === 0) { this.serialIn += text; got = true; }
    this.softs.forEach(function (o) { if (o.rx === pin && o.on && o.listening !== false) { o.buf += text; got = true; } });
    if (got) this.rxUntil = (this.host.wall ? this.host.wall() : 0) + 0.05;
    return got;
  };

  /* What is in each variable right now, for the watch panel. */
  R.snapshot = function () {
    var out = [], g = this.globals;
    Object.keys(g).forEach(function (k) {
      var c = g[k];
      if (!c || c.ty === "o") return;
      out.push({ name: k, ty: TYPE_NAME[c.ty] || c.ty, v: c.arr ? "[" + flat(c.v).slice(0, 12).join(", ") + (flat(c.v).length > 12 ? ", …" : "") + "]" : fmtNum(c.v, c.ty, c.ty === "f" ? 3 : null) });
    });
    return out;
  };
  function flat(a) { return Array.isArray(a) ? a.reduce(function (o, x) { return o.concat(Array.isArray(x) ? flat(x) : [x]); }, []) : [a]; }
})(typeof window !== "undefined" ? window : globalThis);
