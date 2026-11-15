/* Chalk Circuit Lab — Python for the Raspberry Pi.
 *
 * The Pi on the bench runs real Python scripts: the part of the language a
 * first GPIO program uses — variables, lists, dicts, functions, if / for /
 * while, try / except / finally, f-strings, with — and the two libraries
 * every Pi tutorial is written in, gpiozero and RPi.GPIO. Like the Arduino
 * next door it is honest about the machine: 10 / 2 is 5.0, an int plus a
 * str is a TypeError with Python's own words, and a typo gets the same
 * traceback (and the same "Did you mean") the real interpreter prints.
 *
 *   var p = new ChalkLab.PiPy.Process(env)
 *   var g = p.runFile(source, "/home/pi/blink.py")     or p.runRepl()
 *
 * A process is a generator. It yields the number of seconds it wants to
 * sleep and returns its exit status, so the Pi's kernel (lab_pi_os.js) can
 * run it alongside the shell and the circuit, and Ctrl+C is the kernel
 * throwing PiPy.SIGINT into it. sleep() yields, and so does every wait —
 * button.wait_for_press(), pause(), input() — while the circuit carries on
 * underneath. Background work (led.blink(), when_pressed callbacks) runs as
 * little threads inside the same process.
 *
 * env is everything the program can touch:
 *   gpio      the pins (lab_pi.js): setup write read pwm servo tone echo …
 *   out(s)    the terminal          readLine()  a typed line, null, or false at EOF
 *   now()     seconds since boot    wall()      seconds since 1970
 *   fs        read(path) write(path, text, append) list(path)
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab = root.ChalkLab || {};
  var Py = L.PiPy = {};

  Py.SIGINT = { sig: "INT" };
  Py.BOARD = { 3: 2, 5: 3, 7: 4, 8: 14, 10: 15, 11: 17, 12: 18, 13: 27, 15: 22, 16: 23, 18: 24, 19: 10, 21: 9, 22: 25, 23: 11, 24: 8, 26: 7, 29: 5, 31: 6, 32: 12, 33: 13, 35: 19, 36: 16, 37: 26, 38: 20, 40: 21 };
  Py.MODULES = "gpiozero, RPi.GPIO, time, random, math, datetime, signal, sys, os";

  /* ============================================================ VALUES */

  function Fl(v) { this.v = v; }                         /* a float: 5.0 is not 5 */
  function Tuple(v) { this.v = v; }
  function Range(a, b, s) { this.a = a; this.b = b; this.s = s; }
  Range.prototype.len = function () { return Math.max(0, Math.ceil((this.b - this.a) / this.s)); };
  function Dict() { this.m = new Map(); }
  function dk(k) { return k instanceof Fl ? k.v : typeof k === "boolean" ? +k : k instanceof Tuple ? "\u0001" + repr(k) : k; }
  Dict.prototype.set = function (k, v) { this.m.set(dk(k), [k, v]); };
  Dict.prototype.get = function (k) { var e = this.m.get(dk(k)); return e ? e[1] : undefined; };
  Dict.prototype.has = function (k) { return this.m.has(dk(k)); };
  Dict.prototype.del = function (k) { return this.m.delete(dk(k)); };
  Dict.prototype.keys = function () { var o = []; this.m.forEach(function (e) { o.push(e[0]); }); return o; };
  Dict.prototype.vals = function () { var o = []; this.m.forEach(function (e) { o.push(e[1]); }); return o; };
  function Obj(cls) { this.cls = cls; this.d = {}; }
  function Module(name, attrs) { this.name = name; this.attrs = attrs; }
  function Fn(node, closure, defaults) { this.node = node; this.closure = closure; this.defaults = defaults; this.name = node.name; }
  function PyErr(type, msg, line) { this.type = type; this.msg = msg == null ? "" : String(msg); this.line = line || 0; this.tb = null; }
  Py.PyErr = PyErr; Py.Fl = Fl; Py.Tuple = Tuple;

  var BASES = {
    Exception: "BaseException", KeyboardInterrupt: "BaseException", SystemExit: "BaseException",
    ArithmeticError: "Exception", ZeroDivisionError: "ArithmeticError", LookupError: "Exception", IndexError: "LookupError", KeyError: "LookupError",
    NameError: "Exception", UnboundLocalError: "NameError", TypeError: "Exception", ValueError: "Exception", AttributeError: "Exception",
    RuntimeError: "Exception", RecursionError: "RuntimeError", NotImplementedError: "RuntimeError", AssertionError: "Exception",
    OSError: "Exception", FileNotFoundError: "OSError", IsADirectoryError: "OSError", PermissionError: "OSError",
    ImportError: "Exception", ModuleNotFoundError: "ImportError", EOFError: "Exception", StopIteration: "Exception", SyntaxError: "Exception", IndentationError: "SyntaxError",
    MemoryError: "Exception", OverflowError: "ArithmeticError", UnsupportedOperation: "OSError", GPIOPinMissing: "GPIOZeroError", BadEventHandler: "GPIOZeroError",
    GPIOZeroError: "Exception", GPIOPinInUse: "GPIOZeroError", PinInvalidPin: "GPIOZeroError", BadPinFactory: "GPIOZeroError", DeviceClosed: "GPIOZeroError", OutputDeviceBadValue: "GPIOZeroError"
  };
  function isA(type, base) { while (type) { if (type === base) return true; type = BASES[type]; } return false; }

  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function isNum(x) { return typeof x === "number" || typeof x === "boolean" || x instanceof Fl; }
  function nv(x) { return x instanceof Fl ? x.v : +x; }
  function fl(v) { return new Fl(v); }
  function isInt(x) { return typeof x === "number" || typeof x === "boolean"; }

  function tn(x) {
    if (x === null || x === undefined) return "NoneType";
    if (typeof x === "boolean") return "bool";
    if (typeof x === "number") return "int";
    if (x instanceof Fl) return "float";
    if (typeof x === "string") return "str";
    if (Array.isArray(x)) return "list";
    if (x instanceof Tuple) return "tuple";
    if (x instanceof Dict) return "dict";
    if (x instanceof Range) return "range";
    if (x instanceof Fn) return "function";
    if (x instanceof Module) return "module";
    if (x instanceof Obj) return x.cls.name;
    if (x instanceof PyErr) return x.type;
    if (typeof x === "function") return x.cls || x.exc || x.tyname ? "type" : "builtin_function_or_method";
    return "object";
  }

  function fstr(v) {
    if (v !== v) return "nan";
    if (v === Infinity) return "inf";
    if (v === -Infinity) return "-inf";
    var a = Math.abs(v);
    if (a !== 0 && (a >= 1e16 || a < 1e-4)) return v.toExponential().replace(/e([+-])(\d)$/, "e$10$2");
    return Number.isInteger(v) ? v.toFixed(1) : String(v);
  }
  function repr(x) {
    if (typeof x === "string") {
      var q = x.indexOf("'") >= 0 && x.indexOf('"') < 0 ? '"' : "'";
      return q + x.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\r/g, "\\r").replace(new RegExp(q, "g"), "\\" + q) + q;
    }
    if (x instanceof PyErr) return x.type + "(" + (x.msg ? repr(x.msg) : "") + ")";
    return str(x);
  }
  function str(x) {
    if (x === null || x === undefined) return "None";
    if (x === true) return "True";
    if (x === false) return "False";
    if (typeof x === "number") return String(x);
    if (x instanceof Fl) return fstr(x.v);
    if (typeof x === "string") return x;
    if (Array.isArray(x)) return "[" + x.map(repr).join(", ") + "]";
    if (x instanceof Tuple) return "(" + x.v.map(repr).join(", ") + (x.v.length === 1 ? "," : "") + ")";
    if (x instanceof Dict) { var o = []; x.m.forEach(function (e) { o.push(repr(e[0]) + ": " + repr(e[1])); }); return "{" + o.join(", ") + "}"; }
    if (x instanceof Range) return "range(" + x.a + ", " + x.b + (x.s !== 1 ? ", " + x.s : "") + ")";
    if (x instanceof Fn) return "<function " + x.name + " at 0x7f8a3c" + ("0000" + (x.node.line * 2671 % 65536).toString(16)).slice(-4) + "e0>";
    if (x instanceof Module) return "<module '" + x.name + "'" + (/^(time|math|sys)$/.test(x.name) ? " (built-in)>" : " from '/usr/lib/python3/dist-packages/" + x.name.replace(/\./g, "/") + "/__init__.py'>");
    if (x instanceof Obj) return x.cls.repr ? x.cls.repr(x) : "<" + x.cls.name + " object>";
    if (x instanceof PyErr) return x.msg;
    if (typeof x === "function") return x.cls || x.exc || x.tyname ? "<class '" + (x.cls ? (x.cls.mod || "gpiozero") + "." + x.cls.name : x.exc || x.tyname) + "'>" : "<built-in function " + (x.pyname || "?") + ">";
    return String(x);
  }
  Py.str = str; Py.repr = repr;

  function truthy(x) {
    if (x === null || x === undefined || x === false) return false;
    if (x === true) return true;
    if (typeof x === "number") return x !== 0;
    if (x instanceof Fl) return x.v !== 0;
    if (typeof x === "string" || Array.isArray(x)) return x.length > 0;
    if (x instanceof Tuple) return x.v.length > 0;
    if (x instanceof Dict) return x.m.size > 0;
    if (x instanceof Range) return x.len() > 0;
    if (x instanceof Obj && x.cls.items) return x.cls.items(x).length > 0;
    return true;
  }
  function eq(a, b) {
    if (isNum(a) && isNum(b)) return nv(a) === nv(b);
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every(function (x, i) { return eq(x, b[i]); });
    if (a instanceof Tuple && b instanceof Tuple) return eq(a.v, b.v);
    if (a instanceof Dict && b instanceof Dict) return a.m.size === b.m.size && a.keys().every(function (k) { return b.has(k) && eq(a.get(k), b.get(k)); });
    if (a === undefined) a = null;
    if (b === undefined) b = null;
    return a === b;
  }
  function less(a, b, op, line) {
    if (isNum(a) && isNum(b)) return nv(a) < nv(b);
    if (typeof a === "string" && typeof b === "string") return a < b;
    var x = a instanceof Tuple ? a.v : a, y = b instanceof Tuple ? b.v : b;
    if (Array.isArray(x) && Array.isArray(y) && (a instanceof Tuple) === (b instanceof Tuple)) {
      for (var i = 0; i < Math.min(x.length, y.length); i++) if (!eq(x[i], y[i])) return less(x[i], y[i], op, line);
      return x.length < y.length;
    }
    throw new PyErr("TypeError", "'" + op + "' not supported between instances of '" + tn(a) + "' and '" + tn(b) + "'", line);
  }

  function lev(a, b) {
    var m = [], i, j;
    for (i = 0; i <= a.length; i++) m[i] = [i];
    for (j = 0; j <= b.length; j++) m[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
    return m[a.length][b.length];
  }
  function suggest(name, pool) {
    var best = null, bd = 99;
    pool.forEach(function (p) {
      if (p === name || p.charAt(0) === "_") return;
      var d = lev(name.toLowerCase(), p.toLowerCase());
      if (d < bd && d <= Math.max(1, Math.floor(Math.max(name.length, p.length) / 3))) { bd = d; best = p; }
    });
    return best ? ". Did you mean: '" + best + "'?" : "";
  }

  /* ============================================================ TOKENS */

  var KW = /^(and|as|assert|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|True|False|None)$/;
  var OPS = ["**=", "//=", ">>=", "<<=", "...", "**", "//", "==", "!=", "<=", ">=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "->", "<<", ">>",
             "+", "-", "*", "/", "%", "<", ">", "=", "(", ")", "[", "]", "{", "}", ",", ":", ".", ";", "@", "&", "|", "^", "~"];
  var ESC = { n: "\n", t: "\t", r: "\r", "0": "\0", "\\": "\\", "'": "'", '"': '"', a: "\x07", b: "\b" };

  function tokenize(src) {
    src = String(src).replace(/\r\n?/g, "\n");
    var toks = [], i = 0, n = src.length, line = 1, depth = 0, indents = [0], atStart = true, opened = [];
    function err(m, ln, type) { throw new PyErr(type || "SyntaxError", m, ln || line); }
    while (i < n) {
      var c, j;
      if (atStart && depth === 0) {
        var col = 0; j = i;
        while (j < n && (src.charAt(j) === " " || src.charAt(j) === "\t")) { col = src.charAt(j) === "\t" ? (Math.floor(col / 8) + 1) * 8 : col + 1; j++; }
        if (j >= n) { i = j; break; }
        if (src.charAt(j) === "\n") { i = j + 1; line++; continue; }
        if (src.charAt(j) === "#") { while (j < n && src.charAt(j) !== "\n") j++; i = j; continue; }
        i = j;
        if (col > indents[indents.length - 1]) { indents.push(col); toks.push({ t: "indent", line: line }); }
        else while (col < indents[indents.length - 1]) {
          indents.pop(); toks.push({ t: "dedent", line: line });
          if (col > indents[indents.length - 1]) err("unindent does not match any outer indentation level", line, "IndentationError");
        }
        atStart = false;
      }
      c = src.charAt(i);
      if (c === "\n") {
        line++; i++;
        if (depth === 0) { if (toks.length && toks[toks.length - 1].t !== "nl") toks.push({ t: "nl", line: line - 1 }); atStart = true; }
        continue;
      }
      if (c === " " || c === "\t") { i++; continue; }
      if (c === "\\" && src.charAt(i + 1) === "\n") { i += 2; line++; continue; }
      if (c === "#") { while (i < n && src.charAt(i) !== "\n") i++; continue; }
      var sm = /^([rRbBfFuU]{0,2})('''|"""|'|")/.exec(src.substr(i, 5));
      if (sm) {
        var pre = sm[1].toLowerCase(), q = sm[2], raw = pre.indexOf("r") >= 0, start = line, out = "";
        j = i + sm[0].length;
        for (;;) {
          if (j >= n) err(q.length === 3 ? "unterminated triple-quoted string literal (detected at line " + line + ")" : "unterminated string literal (detected at line " + start + ")", start);
          var ch = src.charAt(j);
          if (src.substr(j, q.length) === q) { j += q.length; break; }
          if (ch === "\n") { if (q.length === 1) err("unterminated string literal (detected at line " + start + ")", start); line++; out += ch; j++; continue; }
          if (ch === "\\") {
            var nx = src.charAt(j + 1);
            if (raw) { out += ch + nx; j += 2; continue; }
            if (nx === "\n") { line++; j += 2; continue; }
            if (nx === "x") { out += String.fromCharCode(parseInt(src.substr(j + 2, 2), 16) || 0); j += 4; continue; }
            if (nx === "u") { out += String.fromCharCode(parseInt(src.substr(j + 2, 4), 16) || 0); j += 6; continue; }
            out += ESC[nx] != null ? ESC[nx] : "\\" + nx; j += 2; continue;
          }
          out += ch; j++;
        }
        toks.push({ t: pre.indexOf("f") >= 0 ? "fstr" : "str", v: out, line: start });
        i = j; continue;
      }
      var nm = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*)?\.\d[\d_]*(?:[eE][-+]?\d+)?|\d[\d_]*\.?(?:[eE][-+]?\d+)?)/.exec(src.substr(i, 40));
      if (nm && !(c === "." && !/\d/.test(src.charAt(i + 1)))) {
        var t = nm[1].replace(/_/g, ""), isf = !/^0[xXbBoO]/.test(t) && /[.eE]/.test(t);
        /* "1.real" is rare; "x[1].y" never reaches here because "1" stops at "]" */
        var v = /^0[bB]/.test(t) ? parseInt(t.slice(2), 2) : /^0[oO]/.test(t) ? parseInt(t.slice(2), 8) : Number(t);
        toks.push({ t: "num", v: isf ? fl(v) : v, line: line });
        i += nm[1].length; continue;
      }
      var im = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.substr(i, 80));
      if (im) { toks.push({ t: KW.test(im[0]) ? "kw" : "name", v: im[0], line: line }); i += im[0].length; continue; }
      var op = null;
      for (j = 0; j < OPS.length; j++) if (src.substr(i, OPS[j].length) === OPS[j]) { op = OPS[j]; break; }
      if (!op) err(c === "!" ? "invalid syntax" : "invalid character '" + c + "' (U+" + ("0000" + c.charCodeAt(0).toString(16).toUpperCase()).slice(-4) + ")");
      if (op === "(" || op === "[" || op === "{") { depth++; opened.push([op, line]); }
      if (op === ")" || op === "]" || op === "}") {
        if (!depth) err("unmatched '" + op + "'");
        depth--; opened.pop();
      }
      toks.push({ t: "op", v: op, line: line });
      i += op.length;
    }
    if (depth) err("'" + opened[opened.length - 1][0] + "' was never closed", opened[opened.length - 1][1]);
    if (toks.length && toks[toks.length - 1].t !== "nl") toks.push({ t: "nl", line: line });
    while (indents.length > 1) { indents.pop(); toks.push({ t: "dedent", line: line }); }
    toks.push({ t: "eof", line: line });
    return toks;
  }

  /* ============================================================ PARSER */

  function Parser(toks) { this.t = toks; this.i = 0; }
  var Pp = Parser.prototype;
  Pp.peek = function (o) { return this.t[Math.min(this.i + (o || 0), this.t.length - 1)]; };
  Pp.next = function () { return this.t[this.i++]; };
  Pp.is = function (v, o) { var t = this.peek(o); return (t.t === "op" || t.t === "kw") && t.v === v; };
  Pp.eat = function (v) { if (this.is(v)) { this.i++; return true; } return false; };
  Pp.err = function (msg, tok, type) { throw new PyErr(type || "SyntaxError", msg, (tok || this.peek()).line); };
  Pp.expect = function (v) {
    if (this.eat(v)) return;
    var t = this.peek();
    this.err(v === ":" ? "expected ':'" : "invalid syntax", t);
  };
  Pp.name = function () { var t = this.next(); if (t.t !== "name") this.err("invalid syntax", t); return t.v; };

  Pp.module = function () {
    var body = [];
    while (this.peek().t !== "eof") {
      if (this.peek().t === "nl") { this.i++; continue; }
      if (this.peek().t === "indent") this.err("unexpected indent", null, "IndentationError");
      this.stmt(body);
    }
    return body;
  };
  Pp.block = function (after, line) {
    this.expect(":");
    var body = [];
    if (this.peek().t !== "nl") { this.simpleLine(body); return body; }
    this.i++;
    if (this.peek().t !== "indent") this.err("expected an indented block after " + after + " on line " + line, null, "IndentationError");
    this.i++;
    while (this.peek().t !== "dedent" && this.peek().t !== "eof") {
      if (this.peek().t === "nl") { this.i++; continue; }
      if (this.peek().t === "indent") this.err("unexpected indent", null, "IndentationError");
      this.stmt(body);
    }
    this.eat0("dedent");
    return body;
  };
  Pp.eat0 = function (t) { if (this.peek().t === t) this.i++; };
  Pp.simpleLine = function (out) {
    for (;;) {
      out.push(this.simple());
      if (!this.eat(";")) break;
      if (this.peek().t === "nl" || this.peek().t === "eof") break;
    }
    if (this.peek().t === "nl") this.i++;
    else if (this.peek().t !== "eof" && this.peek().t !== "dedent") this.err("invalid syntax");
  };

  Pp.stmt = function (out) {
    var t = this.peek(), line = t.line, s;
    if (t.t === "kw") switch (t.v) {
      case "if": {
        this.i++; s = { k: "if", line: line, tests: [], orelse: null };
        var c = this.expr(); s.tests.push([c, this.block("'if' statement", line)]);
        while (this.is("elif")) { var l2 = this.next().line; c = this.expr(); s.tests.push([c, this.block("'elif' statement", l2)]); }
        if (this.is("else")) { var l3 = this.next().line; s.orelse = this.block("'else' statement", l3); }
        out.push(s); return;
      }
      case "while": {
        this.i++; s = { k: "while", line: line, cond: this.expr() }; s.body = this.block("'while' statement", line);
        if (this.is("else")) { this.i++; s.orelse = this.block("'else' statement", line); }
        out.push(s); return;
      }
      case "for": {
        this.i++; s = { k: "for", line: line, target: this.targets() };
        if (!this.eat("in")) this.err("invalid syntax");
        s.iter = this.exprList(); s.body = this.block("'for' statement", line);
        if (this.is("else")) { this.i++; s.orelse = this.block("'else' statement", line); }
        out.push(s); return;
      }
      case "def": {
        this.i++; s = { k: "def", line: line, name: this.name(), params: [] };
        this.expect("("); s.params = this.params(")"); this.expect(")");
        if (this.eat("->")) this.expr();
        s.body = this.block("function definition", line);
        scan(s);
        out.push(s); return;
      }
      case "try": {
        this.i++; s = { k: "try", line: line, body: this.block("'try' statement", line), handlers: [], orelse: null, final: null };
        while (this.is("except")) {
          var hl = this.next().line, h = { type: null, name: null, line: hl };
          if (!this.is(":")) { h.type = this.expr(); if (this.eat("as")) h.name = this.name(); }
          h.body = this.block("'except' statement", hl); s.handlers.push(h);
        }
        if (this.is("else")) { this.i++; s.orelse = this.block("'else' statement", line); }
        if (this.is("finally")) { var fl2 = this.next().line; s.final = this.block("'finally' statement", fl2); }
        if (!s.handlers.length && !s.final) this.err("expected 'except' or 'finally' block");
        out.push(s); return;
      }
      case "with": {
        this.i++; s = { k: "with", line: line, items: [] };
        do { var e = this.expr(), tg = null; if (this.eat("as")) tg = this.target1(); s.items.push([e, tg]); } while (this.eat(","));
        s.body = this.block("'with' statement", line);
        out.push(s); return;
      }
      case "class": this.err("this lab's Python doesn't have classes yet — use functions and the gpiozero objects");
      case "elif": case "else": case "except": case "finally": this.err("invalid syntax");
    }
    if (t.t === "op" && t.v === "@") this.err("decorators aren't supported in this lab's Python");
    this.simpleLine(out);
  };

  Pp.params = function (close) {
    var ps = [], seenDef = false;
    while (!this.is(close)) {
      if (this.is("*") || this.is("**")) this.err("*args and **kwargs aren't supported in this lab's Python");
      var p = { name: this.name(), def: null };
      if (close === ")" && this.eat(":")) this.expr();
      if (this.eat("=")) { p.def = this.expr(); seenDef = true; }
      else if (seenDef) this.err("non-default argument follows default argument");
      ps.push(p);
      if (!this.eat(",")) break;
    }
    return ps;
  };

  Pp.simple = function () {
    var t = this.peek(), line = t.line;
    if (t.t === "kw") switch (t.v) {
      case "pass": this.i++; return { k: "pass", line: line };
      case "break": this.i++; return { k: "break", line: line };
      case "continue": this.i++; return { k: "continue", line: line };
      case "return": this.i++; return { k: "return", line: line, e: this.endOfSimple() ? null : this.exprList() };
      case "global": case "nonlocal": {
        this.i++; var names = [this.name()];
        while (this.eat(",")) names.push(this.name());
        return { k: t.v, line: line, names: names };
      }
      case "import": {
        this.i++; var list = [];
        do { var m = this.dotted(), as = null; if (this.eat("as")) as = this.name(); list.push([m, as]); } while (this.eat(","));
        return { k: "import", line: line, names: list };
      }
      case "from": {
        this.i++; var mod = this.dotted();
        if (!this.eat("import")) this.err("invalid syntax");
        if (this.eat("*")) return { k: "from", line: line, mod: mod, names: "*" };
        var par = this.eat("("), ns = [];
        do { if (par && this.is(")")) break; var nmm = this.name(), a2 = null; if (this.eat("as")) a2 = this.name(); ns.push([nmm, a2]); } while (this.eat(","));
        if (par) this.expect(")");
        return { k: "from", line: line, mod: mod, names: ns };
      }
      case "raise": { this.i++; var ex = this.endOfSimple() ? null : this.expr(); if (this.eat("from")) this.expr(); return { k: "raise", line: line, e: ex }; }
      case "del": { this.i++; var ts = [this.postfixOnly()]; while (this.eat(",")) ts.push(this.postfixOnly()); return { k: "del", line: line, targets: ts }; }
      case "assert": { this.i++; var ae = this.expr(), am = this.eat(",") ? this.expr() : null; return { k: "assert", line: line, e: ae, msg: am }; }
    }
    var e = this.exprList();
    if (this.is("=")) {
      var targets = [e], value;
      while (this.eat("=")) { value = this.exprList(); targets.push(value); }
      value = targets.pop();
      targets.forEach(function (x) { checkTarget(x, this); }, this);
      return { k: "assign", line: line, targets: targets, value: value };
    }
    if (this.is(":") && e.k === "name") {          /* x: int = 3 */
      this.i++; this.expr();
      if (this.eat("=")) return { k: "assign", line: line, targets: [e], value: this.exprList() };
      return { k: "pass", line: line };
    }
    var p = this.peek();
    if (p.t === "op" && /^(\+|-|\*|\/|\/\/|%|\*\*|&|\||\^|<<|>>)=$/.test(p.v)) {
      this.i++;
      if (e.k !== "name" && e.k !== "attr" && e.k !== "sub") this.err("'" + (e.k === "call" ? "function call" : "expression") + "' is an illegal expression for augmented assignment", p);
      return { k: "aug", line: line, target: e, op: p.v.slice(0, -1), value: this.exprList() };
    }
    if (e.k === "name" && e.id === "print" && (p.t === "str" || p.t === "name" || p.t === "num" || p.t === "fstr")) this.err("Missing parentheses in call to 'print'. Did you mean print(...)?", p);
    return { k: "expr", line: line, e: e };
  };
  Pp.endOfSimple = function () { var t = this.peek(); return t.t === "nl" || t.t === "eof" || t.t === "dedent" || (t.t === "op" && t.v === ";"); };
  Pp.dotted = function () { var s = this.name(); while (this.eat(".")) s += "." + this.name(); return s; };
  function checkTarget(x, p) {
    if (x.k === "name" || x.k === "attr" || x.k === "sub") return;
    if (x.k === "tuple" || x.k === "list") { x.items.forEach(function (y) { checkTarget(y, p); }); return; }
    p.err(x.k === "call" ? "cannot assign to function call here. Maybe you meant '==' instead of '='?" : x.k === "num" || x.k === "str" || x.k === "const" ? "cannot assign to literal here. Maybe you meant '==' instead of '='?" : "cannot assign to expression here. Maybe you meant '==' instead of '='?");
  }
  /* for-loop and with targets: a name, or names with commas */
  Pp.target1 = function () { var e = this.postfixOnly(); checkTarget(e, this); return e; };
  Pp.targets = function () {
    var line = this.peek().line, par = this.eat("("), items = [this.target1()], tup = false;
    while (this.eat(",")) { tup = true; if (this.is("in") || this.is(")")) break; items.push(this.eat("(") ? (function (p) { var x = p.targets(); p.expect(")"); return x; })(this) : this.target1()); }
    if (par) this.expect(")");
    return tup ? { k: "tuple", line: line, items: items } : items[0];
  };
  Pp.postfixOnly = function () { return this.postfix(); };

  /* a, b, c — a bare tuple, as on the right of "=" or after "return" */
  Pp.exprList = function () {
    var line = this.peek().line, e = this.expr();
    if (!this.is(",")) return e;
    var items = [e];
    while (this.eat(",")) {
      var t = this.peek();
      if (t.t === "nl" || t.t === "eof" || (t.t === "op" && /^(=|\)|\]|\}|;|:)$/.test(t.v))) break;
      items.push(this.expr());
    }
    return { k: "tuple", line: line, items: items };
  };
  Pp.expr = function () {
    var line = this.peek().line;
    if (this.is("lambda")) {
      this.i++; var ps = this.params(":"); this.expect(":");
      var body = this.expr(), node = { k: "lambda", line: line, name: "<lambda>", params: ps, body: [{ k: "return", line: line, e: body }] };
      scan(node);
      return node;
    }
    var a = this.or();
    if (this.is("if")) {
      this.i++; var c = this.or();
      if (!this.eat("else")) this.err("expected 'else' after 'if' expression");
      return { k: "tern", line: line, c: c, a: a, b: this.expr() };
    }
    return a;
  };
  Pp.or = function () { var a = this.and(); while (this.is("or")) { var l = this.next().line; a = { k: "bool", op: "or", line: l, a: a, b: this.and() }; } return a; };
  Pp.and = function () { var a = this.not(); while (this.is("and")) { var l = this.next().line; a = { k: "bool", op: "and", line: l, a: a, b: this.not() }; } return a; };
  Pp.not = function () { if (this.is("not")) { var l = this.next().line; return { k: "un", op: "not", line: l, a: this.not() }; } return this.cmp(); };
  Pp.cmp = function () {
    var a = this.bin(0), rest = [], line = this.peek().line;
    for (;;) {
      var t = this.peek(), op = null;
      if (t.t === "op" && /^(==|!=|<|>|<=|>=)$/.test(t.v)) { op = t.v; this.i++; }
      else if (this.is("in")) { op = "in"; this.i++; }
      else if (this.is("not") && this.is("in", 1)) { op = "not in"; this.i += 2; }
      else if (this.is("is")) { this.i++; op = this.eat("not") ? "is not" : "is"; }
      else break;
      rest.push([op, this.bin(0)]);
    }
    return rest.length ? { k: "cmp", line: line, first: a, rest: rest } : a;
  };
  var BINP = [["|"], ["^"], ["&"], ["<<", ">>"], ["+", "-"], ["*", "/", "//", "%", "@"]];
  Pp.bin = function (lv) {
    if (lv >= BINP.length) return this.unary();
    var a = this.bin(lv + 1);
    for (;;) {
      var t = this.peek();
      if (t.t !== "op" || BINP[lv].indexOf(t.v) < 0) return a;
      this.i++;
      a = { k: "bin", op: t.v, line: t.line, a: a, b: this.bin(lv + 1) };
    }
  };
  Pp.unary = function () {
    var t = this.peek();
    if (t.t === "op" && (t.v === "-" || t.v === "+" || t.v === "~")) { this.i++; return { k: "un", op: t.v, line: t.line, a: this.unary() }; }
    return this.power();
  };
  Pp.power = function () {
    var a = this.postfix();
    if (this.is("**")) { var l = this.next().line; return { k: "bin", op: "**", line: l, a: a, b: this.unary() }; }
    return a;
  };
  Pp.postfix = function () {
    var e = this.atom();
    for (;;) {
      var t = this.peek();
      if (t.t !== "op") return e;
      if (t.v === "(") {
        this.i++; var args = [], kw = [];
        while (!this.is(")")) {
          if (this.is("*") || this.is("**")) this.err("unpacking with * isn't supported in this lab's Python");
          if (this.peek().t === "name" && this.is("=", 1)) { var k = this.next().v; this.i++; kw.push([k, this.expr()]); }
          else {
            if (kw.length) this.err("positional argument follows keyword argument");
            var a = this.expr();
            if (this.is("for")) a = this.comp(a, null, t.line);
            args.push(a);
          }
          if (!this.eat(",")) break;
        }
        if (!this.eat(")")) this.err(this.peek().t === "nl" || this.peek().t === "eof" ? "'(' was never closed" : "invalid syntax. Perhaps you forgot a comma?", this.peek());
        e = { k: "call", line: t.line, f: e, args: args, kw: kw };
      } else if (t.v === ".") { this.i++; e = { k: "attr", line: t.line, o: e, name: this.attrName() }; }
      else if (t.v === "[") {
        this.i++; var idx = this.subscript(); this.expect("]");
        e = { k: "sub", line: t.line, o: e, i: idx };
      } else return e;
    }
  };
  Pp.attrName = function () { var t = this.next(); if (t.t !== "name" && t.t !== "kw") this.err("invalid syntax", t); return t.v; };
  Pp.subscript = function () {
    var line = this.peek().line, lo = null, hi = null, step = null;
    if (!this.is(":")) { lo = this.exprList(); if (!this.is(":")) return lo; }
    this.expect(":");
    if (!this.is("]") && !this.is(":")) hi = this.expr();
    if (this.eat(":") && !this.is("]")) step = this.expr();
    return { k: "slice", line: line, lo: lo, hi: hi, step: step };
  };
  Pp.comp = function (elt, key, line) {
    var fors = [];
    while (this.is("for")) {
      this.i++; var f = { target: this.targets(), conds: [] };
      if (!this.eat("in")) this.err("invalid syntax");
      f.iter = this.or();
      while (this.is("if")) { this.i++; f.conds.push(this.or()); }
      fors.push(f);
    }
    return { k: "comp", line: line, elt: elt, key: key, fors: fors };
  };
  Pp.atom = function () {
    var t = this.next(), line = t.line, e, items;
    switch (t.t) {
      case "num": return { k: "num", line: line, v: t.v };
      case "str": case "fstr": {
        var parts = [], any = false;
        this.i--;
        while (this.peek().t === "str" || this.peek().t === "fstr") {
          var s = this.next();
          if (s.t === "fstr") { any = true; parts = parts.concat(fparts(s.v, s.line)); } else parts.push(s.v);
        }
        if (!any) return { k: "str", line: line, v: parts.join("") };
        return { k: "fstr", line: line, parts: parts };
      }
      case "name": return { k: "name", line: line, id: t.v };
      case "kw":
        if (t.v === "True") return { k: "const", line: line, v: true };
        if (t.v === "False") return { k: "const", line: line, v: false };
        if (t.v === "None") return { k: "const", line: line, v: null };
        if (t.v === "yield") this.err("generators (yield) aren't supported in this lab's Python", t);
        this.err("invalid syntax", t); break;
      case "op":
        if (t.v === "(") {
          if (this.eat(")")) return { k: "tuple", line: line, items: [] };
          e = this.expr();
          if (this.is("for")) { e = this.comp(e, null, line); this.expect(")"); return e; }
          if (this.is(",")) {
            items = [e];
            while (this.eat(",")) { if (this.is(")")) break; items.push(this.expr()); }
            e = { k: "tuple", line: line, items: items };
          }
          if (!this.eat(")")) this.err(this.peek().t === "nl" || this.peek().t === "eof" ? "'(' was never closed" : "invalid syntax. Perhaps you forgot a comma?", this.peek());
          return e;
        }
        if (t.v === "[") {
          items = [];
          if (this.eat("]")) return { k: "list", line: line, items: items };
          e = this.expr();
          if (this.is("for")) { e = this.comp(e, null, line); this.expect("]"); return e; }
          items.push(e);
          while (this.eat(",")) { if (this.is("]")) break; items.push(this.expr()); }
          if (!this.eat("]")) this.err("invalid syntax. Perhaps you forgot a comma?", this.peek());
          return { k: "list", line: line, items: items };
        }
        if (t.v === "{") {
          items = [];
          if (this.eat("}")) return { k: "dict", line: line, items: items };
          do {
            if (this.is("}")) break;
            var kx = this.expr();
            if (!this.eat(":")) this.err("sets aren't supported in this lab's Python — use a list or a dict");
            var vx = this.expr();
            if (this.is("for")) { e = this.comp(vx, kx, line); this.expect("}"); return e; }
            items.push([kx, vx]);
          } while (this.eat(","));
          this.expect("}");
          return { k: "dict", line: line, items: items };
        }
        if (t.v === "...") return { k: "const", line: line, v: null };
    }
    this.err(t.t === "nl" || t.t === "eof" ? "invalid syntax" : t.t === "indent" ? "unexpected indent" : "invalid syntax", t);
  };

  /* An f-string, cut into text and {expression!r:spec} pieces. */
  function fparts(s, line) {
    var out = [], buf = "", i = 0;
    while (i < s.length) {
      var c = s.charAt(i);
      if (c === "{" && s.charAt(i + 1) === "{") { buf += "{"; i += 2; continue; }
      if (c === "}" && s.charAt(i + 1) === "}") { buf += "}"; i += 2; continue; }
      if (c === "}") throw new PyErr("SyntaxError", "f-string: single '}' is not allowed", line);
      if (c !== "{") { buf += c; i++; continue; }
      if (buf) { out.push(buf); buf = ""; }
      var depth = 0, j = i + 1, q = null, exprEnd = -1, conv = null, spec = null;
      for (; j < s.length; j++) {
        var ch = s.charAt(j);
        if (q) { if (ch === q) q = null; continue; }
        if (ch === "'" || ch === '"') { q = ch; continue; }
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]") depth--;
        else if (ch === "}") { if (!depth) break; depth--; }
        else if (!depth && ch === "!" && s.charAt(j + 1) !== "=" && exprEnd < 0) { exprEnd = j; conv = s.charAt(j + 1); }
        else if (!depth && ch === ":" && spec === null) { if (exprEnd < 0) exprEnd = j; spec = j + 1; }
      }
      if (j >= s.length) throw new PyErr("SyntaxError", "f-string: expecting '}'", line);
      var src = s.slice(i + 1, exprEnd < 0 ? j : exprEnd), eq2 = /=\s*$/.test(src) && !/[=!<>]=\s*$/.test(src);
      if (eq2) { out.push(src); src = src.replace(/=\s*$/, ""); if (!conv && spec === null) conv = "r"; }
      if (!src.trim()) throw new PyErr("SyntaxError", "f-string: valid expression required before '}'", line);
      var toks = tokenize(src.trim());
      toks.forEach(function (t) { t.line = line; });
      var p = new Parser(toks), e = p.exprList();
      if (p.peek().t !== "nl" && p.peek().t !== "eof") throw new PyErr("SyntaxError", "f-string: invalid syntax", line);
      out.push({ e: e, conv: conv, spec: spec === null ? null : s.slice(spec, j) });
      i = j + 1;
    }
    if (buf) out.push(buf);
    return out;
  }

  /* Which names a function assigns: Python decides what is local before
   * the function ever runs, which is why "count += 1" without "global
   * count" is an UnboundLocalError and not a quiet new variable. */
  function scan(fn) {
    var locals = Object.create(null), decl = Object.create(null);
    fn.params.forEach(function (p) { locals[p.name] = 1; });
    function tgt(t) { if (!t) return; if (t.k === "name") locals[t.id] = 1; else if (t.k === "tuple" || t.k === "list") t.items.forEach(tgt); }
    function walk(list) {
      (list || []).forEach(function (s) {
        switch (s.k) {
          case "assign": s.targets.forEach(tgt); break;
          case "aug": tgt(s.target); break;
          case "for": tgt(s.target); walk(s.body); walk(s.orelse); break;
          case "while": walk(s.body); walk(s.orelse); break;
          case "if": s.tests.forEach(function (t) { walk(t[1]); }); walk(s.orelse); break;
          case "try": walk(s.body); s.handlers.forEach(function (h) { if (h.name) locals[h.name] = 1; walk(h.body); }); walk(s.orelse); walk(s.final); break;
          case "with": s.items.forEach(function (it) { tgt(it[1]); }); walk(s.body); break;
          case "def": locals[s.name] = 1; break;
          case "import": s.names.forEach(function (n) { locals[n[1] || n[0].split(".")[0]] = 1; }); break;
          case "from": if (s.names !== "*") s.names.forEach(function (n) { locals[n[1] || n[0]] = 1; }); break;
          case "global": s.names.forEach(function (n) { decl[n] = "g"; }); break;
          case "nonlocal": s.names.forEach(function (n) { decl[n] = "n"; }); break;
        }
      });
    }
    walk(fn.body);
    Object.keys(decl).forEach(function (n) { delete locals[n]; });
    fn.locals = locals; fn.decl = decl;
  }

  function parse(src) { return new Parser(tokenize(src)).module(); }
  Py.parse = parse;
  /* For the editor and the shell: null if it parses, else {line, msg}. */
  Py.check = function (src) { try { parse(src); return null; } catch (e) { if (e instanceof PyErr) return { line: e.line, msg: e.type + ": " + e.msg }; throw e; } };

  /* ============================================================ FORMAT */

  /* Python rounds an exact tie to the even digit (2.25 -> "2.2"); JavaScript's toFixed rounds it up. */
  function fixed(a, prec) {
    var m = Math.pow(10, prec), y = a * m;
    if (prec <= 15 && Math.abs(y % 1) === 0.5 && y / m === a) { var r = Math.floor(y); if (r % 2) r += 1; return (r / m).toFixed(prec); }
    return a.toFixed(prec);
  }
  function group(s, sep) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, sep); }
  function format(v, spec, line) {
    if (spec == null || spec === "") return str(v);
    var m = /^(?:(.)?([<>=^]))?([-+ ])?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/.exec(spec);
    if (!m) throw new PyErr("ValueError", "Invalid format specifier '" + spec + "' for object of type '" + tn(v) + "'", line);
    var fill = m[1] || (m[5] ? "0" : " "), align = m[2] || (m[5] ? "=" : null), sign = m[3] || "-", width = +(m[6] || 0), comma = m[7], prec = m[8] != null ? +m[8] : null, ty = m[9], body, neg = false;
    if (typeof v === "string" || (!isNum(v) && !ty)) {
      if (ty && ty !== "s") throw new PyErr("ValueError", "Unknown format code '" + ty + "' for object of type '" + tn(v) + "'", line);
      body = str(v); if (prec != null) body = body.slice(0, prec);
      align = align || "<";
    } else {
      if (!isNum(v)) throw new PyErr("TypeError", "unsupported format string passed to " + tn(v) + ".__format__", line);
      var x = nv(v); neg = x < 0 || (x === 0 && 1 / x < 0); var a = Math.abs(x);
      if (!ty) ty = v instanceof Fl ? (prec != null ? "g" : "r") : "d";
      if (/[dbxXoc]/.test(ty) && v instanceof Fl) throw new PyErr("ValueError", "Unknown format code '" + ty + "' for object of type 'float'", line);
      switch (ty) {
        case "d": case "n": body = String(Math.round(a)); break;
        case "b": body = (m[4] ? "0b" : "") + Math.round(a).toString(2); break;
        case "o": body = (m[4] ? "0o" : "") + Math.round(a).toString(8); break;
        case "x": body = (m[4] ? "0x" : "") + Math.round(a).toString(16); break;
        case "X": body = (m[4] ? "0X" : "") + Math.round(a).toString(16).toUpperCase(); break;
        case "c": body = String.fromCharCode(a); break;
        case "f": case "F": body = fixed(a, prec == null ? 6 : prec); break;
        case "e": case "E": body = a.toExponential(prec == null ? 6 : prec).replace(/e([+-])(\d)$/, "e$10$2"); if (ty === "E") body = body.toUpperCase(); break;
        case "%": body = (a * 100).toFixed(prec == null ? 6 : prec) + "%"; break;
        case "r": body = fstr(a); break;
        default: {
          var p = prec == null ? 6 : Math.max(1, prec), ex = a === 0 ? 0 : Math.floor(Math.log10(a));
          if (ex < -4 || ex >= p) body = a.toExponential(p - 1).replace(/\.?0+e/, "e").replace(/e([+-])(\d)$/, "e$10$2");
          else { body = a.toFixed(Math.max(0, p - 1 - ex)); if (body.indexOf(".") >= 0) body = body.replace(/\.?0+$/, ""); }
        }
      }
      if (comma) { var pt = body.split("."); pt[0] = group(pt[0], comma); body = pt.join("."); }
      align = align || ">";
    }
    var sg = neg ? "-" : sign === "+" ? "+" : sign === " " ? " " : "";
    var pad = Math.max(0, width - body.length - sg.length), fillS = new Array(pad + 1).join(fill);
    if (align === "<") return sg + body + fillS;
    if (align === "^") { var l = Math.floor(pad / 2); return new Array(l + 1).join(fill) + sg + body + new Array(pad - l + 1).join(fill); }
    if (align === "=") return sg + fillS + body;
    return fillS + sg + body;
  }
  /* "%d items" % n — the old way, still in every other tutorial */
  function pct(fmt, arg, line) {
    var args = arg instanceof Tuple ? arg.v : [arg], i = 0;
    var out = fmt.replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?([sdifxXeEgGrc%])/g, function (all, flags, w, p, ty) {
      if (ty === "%") return "%";
      if (i >= args.length) throw new PyErr("TypeError", "not enough arguments for format string", line);
      var v = args[i++], s;
      if (ty === "s") s = str(v); else if (ty === "r") s = repr(v);
      else {
        if (!isNum(v)) throw new PyErr("TypeError", "%" + ty + " format: a real number is required, not " + tn(v), line);
        s = format(/[di]/.test(ty) ? Math.trunc(nv(v)) : /[xX]/.test(ty) ? Math.trunc(nv(v)) : fl(nv(v)), (flags.indexOf("+") >= 0 ? "+" : "") + (p != null ? "." + p : "") + (ty === "i" ? "d" : ty), line);
      }
      if (ty === "s" && p != null) s = s.slice(0, +p);
      var width = +(w || 0);
      while (s.length < width) s = flags.indexOf("-") >= 0 ? s + " " : (flags.indexOf("0") >= 0 && ty !== "s" ? s.replace(/^([-+]?)/, "$10") : " " + s);
      return s;
    });
    if (i < args.length && !(arg instanceof Dict)) throw new PyErr("TypeError", "not all arguments converted during string formatting", line);
    return out;
  }

  /* ========================================================= OPERATORS */

  function binop(op, a, b, line) {
    if (isNum(a) && isNum(b)) {
      var x = nv(a), y = nv(b), f = a instanceof Fl || b instanceof Fl, r;
      switch (op) {
        case "+": return f ? fl(x + y) : x + y;
        case "-": return f ? fl(x - y) : x - y;
        case "*": return f ? fl(x * y) : x * y;
        case "/": if (y === 0) throw new PyErr("ZeroDivisionError", f ? "float division by zero" : "division by zero", line); return fl(x / y);
        case "//": if (y === 0) throw new PyErr("ZeroDivisionError", f ? "float floor division by zero" : "integer division or modulo by zero", line); r = Math.floor(x / y); return f ? fl(r) : r;
        case "%": if (y === 0) throw new PyErr("ZeroDivisionError", f ? "float modulo" : "integer modulo by zero", line); r = x - Math.floor(x / y) * y; return f ? fl(r) : r;
        case "**": r = Math.pow(x, y); return f || y < 0 ? fl(r) : r;
      }
      if (!f) switch (op) {
        case "&": return x & y; case "|": return x | y; case "^": return x ^ y;
        case "<<": return x * Math.pow(2, y); case ">>": return Math.floor(x / Math.pow(2, y));
      }
    }
    var as = typeof a === "string", bs = typeof b === "string";
    if (op === "+") {
      if (as && bs) return a + b;
      if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
      if (a instanceof Tuple && b instanceof Tuple) return new Tuple(a.v.concat(b.v));
      if (as) throw new PyErr("TypeError", 'can only concatenate str (not "' + tn(b) + '") to str', line);
      if (Array.isArray(a)) throw new PyErr("TypeError", 'can only concatenate list (not "' + tn(b) + '") to list', line);
    }
    if (op === "*") {
      var s = isInt(b) ? a : isInt(a) ? b : null, n = isInt(b) ? +b : +a;
      if (s !== null && (typeof s === "string" || Array.isArray(s) || s instanceof Tuple)) {
        if (n * (typeof s === "string" ? s.length : s instanceof Tuple ? s.v.length : s.length) > 200000) throw new PyErr("MemoryError", "", line);
        if (typeof s === "string") return n > 0 ? new Array(n + 1).join(s) : "";
        var src = s instanceof Tuple ? s.v : s, out = [];
        for (var i = 0; i < n; i++) out = out.concat(src);
        return s instanceof Tuple ? new Tuple(out) : out;
      }
    }
    if (op === "%" && as) return pct(a, b, line);
    throw new PyErr("TypeError", "unsupported operand type(s) for " + op + ": '" + tn(a) + "' and '" + tn(b) + "'", line);
  }
  function contains(c, x, line) {
    if (typeof c === "string") { if (typeof x !== "string") throw new PyErr("TypeError", "'in <string>' requires string as left operand, not " + tn(x), line); return c.indexOf(x) >= 0; }
    if (Array.isArray(c)) return c.some(function (y) { return eq(x, y); });
    if (c instanceof Tuple) return c.v.some(function (y) { return eq(x, y); });
    if (c instanceof Dict) return c.has(x);
    if (c instanceof Range) { if (!isNum(x)) return false; var v = nv(x); return (c.s > 0 ? v >= c.a && v < c.b : v <= c.a && v > c.b) && (v - c.a) % c.s === 0; }
    throw new PyErr("TypeError", "argument of type '" + tn(c) + "' is not iterable", line);
  }
  function index(seq, i, line) {
    if (seq instanceof Dict) { if (!seq.has(i)) throw new PyErr("KeyError", repr(i), line); return seq.get(i); }
    var isS = typeof seq === "string", arr = seq instanceof Tuple ? seq.v : seq instanceof Obj && seq.cls.items ? seq.cls.items(seq) : seq;
    if (seq instanceof Range) { var n0 = seq.len(), k = toIdx(i, "range", line); if (k < 0) k += n0; if (k < 0 || k >= n0) throw new PyErr("IndexError", "range object index out of range", line); return seq.a + k * seq.s; }
    if (!isS && !Array.isArray(arr)) throw new PyErr("TypeError", "'" + tn(seq) + "' object is not subscriptable", line);
    var what = isS ? "string" : seq instanceof Tuple ? "tuple" : "list", j = toIdx(i, what, line);
    if (j < 0) j += arr.length;
    if (j < 0 || j >= arr.length) throw new PyErr("IndexError", what + " index out of range", line);
    return isS ? arr.charAt(j) : arr[j];
  }
  function toIdx(i, what, line) {
    if (!isInt(i)) throw new PyErr("TypeError", what + " indices must be integers" + (what === "range" ? "" : " or slices") + ", not " + tn(i), line);
    return +i;
  }
  function slice(seq, lo, hi, step, line) {
    var isS = typeof seq === "string", arr = isS ? seq.split("") : seq instanceof Tuple ? seq.v : seq;
    if (!Array.isArray(arr)) throw new PyErr("TypeError", "'" + tn(seq) + "' object is not subscriptable", line);
    var n = arr.length, st = step == null ? 1 : toIdx(step, "slice", line);
    if (st === 0) throw new PyErr("ValueError", "slice step cannot be zero", line);
    var fix = function (v, d) { if (v == null) return d; v = toIdx(v, "slice", line); if (v < 0) v += n; return st > 0 ? Math.max(0, Math.min(n, v)) : Math.max(-1, Math.min(n - 1, v)); };
    var a = fix(lo, st > 0 ? 0 : n - 1), b = fix(hi, st > 0 ? n : -1), out = [];
    for (var i = a; st > 0 ? i < b : i > b; i += st) out.push(arr[i]);
    return isS ? out.join("") : seq instanceof Tuple ? new Tuple(out) : out;
  }

  /* ============================================== METHODS OF BUILT-INS */

  function need(args, lo, hi, name, line) {
    if (args.length < lo || args.length > hi) throw new PyErr("TypeError", name + "() takes " + (lo === hi ? (lo === 0 ? "no arguments" : "exactly " + lo + " argument" + (lo > 1 ? "s" : "")) : "from " + lo + " to " + hi + " arguments") + " (" + args.length + " given)", line);
  }
  function wantStr(v, what, line) { if (typeof v !== "string") throw new PyErr("TypeError", what + " must be str, not " + tn(v), line); return v; }
  function listOf(x, line) {
    if (Array.isArray(x)) return x.slice();
    if (x instanceof Tuple) return x.v.slice();
    if (typeof x === "string") return x.split("");
    if (x instanceof Dict) return x.keys();
    if (x instanceof Range) { var o = []; if (x.len() > 2000000) throw new PyErr("MemoryError", "", line); for (var i = x.a; x.s > 0 ? i < x.b : i > x.b; i += x.s) o.push(i); return o; }
    if (x instanceof Obj && x.cls.items) return x.cls.items(x).slice();
    throw new PyErr("TypeError", "'" + tn(x) + "' object is not iterable", line);
  }

  var STR_M = {
    upper: function (s) { return s.toUpperCase(); }, lower: function (s) { return s.toLowerCase(); },
    title: function (s) { return s.toLowerCase().replace(/(^|[^A-Za-z])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); }); },
    capitalize: function (s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); },
    strip: function (s, a) { return a.length ? stripSet(s, a[0], 3) : s.trim(); },
    lstrip: function (s, a) { return a.length ? stripSet(s, a[0], 1) : s.replace(/^\s+/, ""); },
    rstrip: function (s, a) { return a.length ? stripSet(s, a[0], 2) : s.replace(/\s+$/, ""); },
    split: function (s, a) {
      if (!a.length || a[0] === null) { var t = s.trim(); return t ? t.split(/\s+/) : []; }
      return s.split(a[0]);
    },
    splitlines: function (s) { var o = s.split("\n"); if (o[o.length - 1] === "") o.pop(); return o; },
    join: function (s, a, kw, it, line) { return listOf(a[0], line).map(function (x, i) { if (typeof x !== "string") throw new PyErr("TypeError", "sequence item " + i + ": expected str instance, " + tn(x) + " found", line); return x; }).join(s); },
    replace: function (s, a) { return s.split(a[0]).join(a[1]); },
    startswith: function (s, a) { return s.indexOf(a[0]) === 0; },
    endswith: function (s, a) { return a[0].length <= s.length && s.lastIndexOf(a[0]) === s.length - a[0].length; },
    find: function (s, a) { return s.indexOf(a[0]); },
    index: function (s, a, kw, it, line) { var i = s.indexOf(a[0]); if (i < 0) throw new PyErr("ValueError", "substring not found", line); return i; },
    count: function (s, a) { return a[0] ? s.split(a[0]).length - 1 : s.length + 1; },
    isdigit: function (s) { return /^\d+$/.test(s); }, isalpha: function (s) { return /^[A-Za-z]+$/.test(s); }, isalnum: function (s) { return /^[A-Za-z0-9]+$/.test(s); },
    isupper: function (s) { return /[A-Z]/.test(s) && s === s.toUpperCase(); }, islower: function (s) { return /[a-z]/.test(s) && s === s.toLowerCase(); }, isspace: function (s) { return /^\s+$/.test(s); },
    zfill: function (s, a) { var neg = /^[-+]/.test(s) ? s.charAt(0) : "", b = neg ? s.slice(1) : s; while (b.length + neg.length < a[0]) b = "0" + b; return neg + b; },
    ljust: function (s, a) { while (s.length < a[0]) s += a[1] || " "; return s; },
    rjust: function (s, a) { while (s.length < a[0]) s = (a[1] || " ") + s; return s; },
    center: function (s, a) { var f = a[1] || " "; while (s.length < a[0]) { s = s + f; if (s.length < a[0]) s = f + s; } return s; },
    format: function (s, a, kw, it, line) {
      var auto = 0;
      return s.replace(/\{\{|\}\}|\{([^{}:!]*)(?:!([rs]))?(?::([^{}]*))?\}/g, function (all, key, conv, spec) {
        if (all === "{{") return "{"; if (all === "}}") return "}";
        var v;
        if (key === "" || key == null) { if (auto >= a.length) throw new PyErr("IndexError", "Replacement index " + auto + " out of range for positional args tuple", line); v = a[auto++]; }
        else if (/^\d+$/.test(key)) { if (+key >= a.length) throw new PyErr("IndexError", "Replacement index " + key + " out of range for positional args tuple", line); v = a[+key]; }
        else { if (!(key in kw)) throw new PyErr("KeyError", repr(key), line); v = kw[key]; }
        if (conv === "r") v = repr(v);
        return format(v, spec || "", line);
      });
    }
  };
  function stripSet(s, set, mode) {
    var a = 0, b = s.length;
    if (mode & 1) while (a < b && set.indexOf(s.charAt(a)) >= 0) a++;
    if (mode & 2) while (b > a && set.indexOf(s.charAt(b - 1)) >= 0) b--;
    return s.slice(a, b);
  }
  var LIST_M = {
    append: function (l, a) { l.push(a[0]); return null; },
    extend: function (l, a, kw, it, line) { listOf(a[0], line).forEach(function (x) { l.push(x); }); return null; },
    insert: function (l, a) { var i = +a[0]; if (i < 0) i = Math.max(0, l.length + i); l.splice(i, 0, a[1]); return null; },
    pop: function (l, a, kw, it, line) {
      if (!l.length) throw new PyErr("IndexError", "pop from empty list", line);
      var i = a.length ? +a[0] : l.length - 1; if (i < 0) i += l.length;
      if (i < 0 || i >= l.length) throw new PyErr("IndexError", "pop index out of range", line);
      return l.splice(i, 1)[0];
    },
    remove: function (l, a, kw, it, line) { for (var i = 0; i < l.length; i++) if (eq(l[i], a[0])) { l.splice(i, 1); return null; } throw new PyErr("ValueError", "list.remove(x): x not in list", line); },
    index: function (l, a, kw, it, line) { for (var i = 0; i < l.length; i++) if (eq(l[i], a[0])) return i; throw new PyErr("ValueError", repr(a[0]) + " is not in list", line); },
    count: function (l, a) { return l.filter(function (x) { return eq(x, a[0]); }).length; },
    reverse: function (l) { l.reverse(); return null; },
    clear: function (l) { l.length = 0; return null; },
    copy: function (l) { return l.slice(); },
    sort: function (l, a, kw, it, line) { return sortGen(l, kw, it, line, true); }
  };
  function* sortGen(l, kw, it, line, inPlace) {
    var keys = [], i;
    for (i = 0; i < l.length; i++) keys.push(kw.key != null ? yield* it.call(kw.key, [l[i]], {}, line) : l[i]);
    var idx = l.map(function (x, j) { return j; });
    idx.sort(function (p, q) { return eq(keys[p], keys[q]) ? p - q : less(keys[p], keys[q], "<", line) ? -1 : 1; });
    if (truthy(kw.reverse)) idx.reverse();
    var out = idx.map(function (j) { return l[j]; });
    if (!inPlace) return out;
    for (i = 0; i < out.length; i++) l[i] = out[i];
    return null;
  }
  var DICT_M = {
    get: function (d, a) { return d.has(a[0]) ? d.get(a[0]) : (a.length > 1 ? a[1] : null); },
    keys: function (d) { return d.keys(); }, values: function (d) { return d.vals(); },
    items: function (d) { var o = []; d.m.forEach(function (e) { o.push(new Tuple([e[0], e[1]])); }); return o; },
    pop: function (d, a, kw, it, line) { if (d.has(a[0])) { var v = d.get(a[0]); d.del(a[0]); return v; } if (a.length > 1) return a[1]; throw new PyErr("KeyError", repr(a[0]), line); },
    setdefault: function (d, a) { if (!d.has(a[0])) d.set(a[0], a.length > 1 ? a[1] : null); return d.get(a[0]); },
    update: function (d, a, kw) { if (a[0] instanceof Dict) a[0].m.forEach(function (e) { d.set(e[0], e[1]); }); Object.keys(kw).forEach(function (k) { d.set(k, kw[k]); }); return null; },
    clear: function (d) { d.m.clear(); return null; },
    copy: function (d) { var n = new Dict(); d.m.forEach(function (e) { n.set(e[0], e[1]); }); return n; }
  };
  var TUPLE_M = { index: function (t, a, kw, it, line) { return LIST_M.index(t.v, a, kw, it, line); }, count: function (t, a) { return LIST_M.count(t.v, a); } };

  /* ======================================================= INTERPRETER */

  var BRK = { s: "break" }, CNT = { s: "continue" };
  function Ret(v) { this.v = v; }
  function Scope(parent, fn) { this.vars = Object.create(null); this.parent = parent; this.fn = fn || null; this.globals = parent ? parent.globals : this; }

  function Process(env) {
    this.env = env; this.gpio = env.gpio;
    this.globals = new Scope(null, null);
    this.globals.vars.__name__ = "__main__";
    this.frames = []; this.ops = 0; this.threads = []; this.devices = []; this.owner = {};
    this.modules = {}; this.file = "<stdin>"; this.lines = [];
    this.rpi = { mode: null, chans: {}, warn: true, pwm: {}, events: [] };
    this.exit = null;
    this.builtins = makeBuiltins(this);
  }
  Py.Process = Process;
  var P = Process.prototype;

  P.out = function (s) { this.env.out(s); };
  P.now = function () { return this.env.now(); };

  /* ---------------------------------------------------------- names */

  P.lookup = function (name, sc, line) {
    var f = sc.fn;
    if (f) {
      if (f.decl[name] === "g") { if (name in sc.globals.vars) return sc.globals.vars[name]; }
      else if (f.locals[name] && !(name in sc.vars)) throw new PyErr("UnboundLocalError", "cannot access local variable '" + name + "' where it is not associated with a value", line);
    }
    for (var s = f && f.decl[name] === "g" ? null : sc; s; s = s.parent) if (name in s.vars) return s.vars[name];
    if (name in this.builtins) return this.builtins[name];
    var pool = Object.keys(this.builtins);
    for (s = sc; s; s = s.parent) pool = pool.concat(Object.keys(s.vars));
    var known = { sleep: "time", pause: "signal", LED: "gpiozero", Button: "gpiozero", GPIO: "RPi", randint: "random", sqrt: "math", pi: "math" }[name];
    throw new PyErr("NameError", "name '" + name + "' is not defined" + (known && !suggest(name, pool) ? ". Did you forget to import '" + known + "'?" : suggest(name, pool)), line);
  };
  P.store = function (name, v, sc) {
    var f = sc.fn;
    if (f && f.decl[name] === "g") { sc.globals.vars[name] = v; return; }
    if (f && f.decl[name] === "n") { for (var s = sc.parent; s && s.fn; s = s.parent) if (name in s.vars) { s.vars[name] = v; return; } }
    sc.vars[name] = v;
  };

  /* ----------------------------------------------------- attributes */

  P.getattr = function (o, name, line) {
    var self = this, table = null, bind = function (fn) { var b = function (args, kw, it, ln) { return fn(o, args, kw || {}, self, ln || line); }; b.pyname = name; b.self = o; return b; };
    if (o instanceof Module) {
      if (own(o.attrs, name)) return o.attrs[name];
      throw new PyErr("AttributeError", "module '" + o.name + "' has no attribute '" + name + "'" + suggest(name, Object.keys(o.attrs)), line);
    }
    if (o instanceof Obj) {
      var c = o.cls;
      if (own(c.props, name)) { if (o.d.closed && name !== "closed") throw closedErr(o, line); return c.props[name].get(o, this, line); }
      if (own(c.methods, name)) return bind(c.methods[name]);
      throw new PyErr("AttributeError", "'" + c.name + "' object has no attribute '" + name + "'" + suggest(name, Object.keys(c.props).concat(Object.keys(c.methods))), line);
    }
    if (typeof o === "string") table = STR_M;
    else if (Array.isArray(o)) table = LIST_M;
    else if (o instanceof Dict) table = DICT_M;
    else if (o instanceof Tuple) table = TUPLE_M;
    else if (o instanceof PyErr) { if (name === "args") return new Tuple(o.msg ? [o.msg] : []); }
    else if (typeof o === "function" && o.statics && own(o.statics, name)) return o.statics[name];
    else if (o instanceof Fn && name === "__name__") return o.name;
    if (table && own(table, name)) return bind(table[name]);
    throw new PyErr("AttributeError", "'" + tn(o) + "' object has no attribute '" + name + "'" + (table ? suggest(name, Object.keys(table)) : ""), line);
  };
  P.setattr = function (o, name, v, line) {
    if (o instanceof Obj) {
      var p = own(o.cls.props, name) ? o.cls.props[name] : null;
      if (p && p.set) { if (o.d.closed) throw closedErr(o, line); p.set(o, v, this, line); return; }
      if (p || own(o.cls.methods, name)) throw new PyErr("AttributeError", "can't set attribute '" + name + "'", line);
      throw new PyErr("AttributeError", "'" + o.cls.name + "' object has no attribute '" + name + "'" + suggest(name, Object.keys(o.cls.props).filter(function (k) { return o.cls.props[k].set; })), line);
    }
    if (o instanceof Module) { o.attrs[name] = v; return; }
    throw new PyErr("AttributeError", "'" + tn(o) + "' object has no attribute '" + name + "'", line);
  };
  function closedErr(o, line) { return new PyErr("DeviceClosed", "<" + o.cls.name + " object closed> is closed or uninitialized", line); }

  /* --------------------------------------------------------- calling */

  P.call = function* (f, args, kw, line) {
    kw = kw || {};
    if (typeof f === "function") {
      var r = f(args, kw, this, line);
      if (r && typeof r.next === "function" && typeof r[Symbol.iterator] === "function") r = yield* r;
      return r === undefined ? null : r;
    }
    if (f instanceof Fn) {
      var node = f.node, ps = node.params, sc = new Scope(f.closure, node), i;
      if (args.length > ps.length) throw new PyErr("TypeError", f.name + "() takes " + ps.length + " positional argument" + (ps.length === 1 ? "" : "s") + " but " + args.length + (args.length === 1 ? " was" : " were") + " given", line);
      for (i = 0; i < args.length; i++) sc.vars[ps[i].name] = args[i];
      for (var k in kw) {
        if (!ps.some(function (p) { return p.name === k; })) throw new PyErr("TypeError", f.name + "() got an unexpected keyword argument '" + k + "'", line);
        if (k in sc.vars) throw new PyErr("TypeError", f.name + "() got multiple values for argument '" + k + "'", line);
        sc.vars[k] = kw[k];
      }
      var missing = [];
      for (i = 0; i < ps.length; i++) if (!(ps[i].name in sc.vars)) { if (ps[i].def) sc.vars[ps[i].name] = f.defaults[i]; else missing.push("'" + ps[i].name + "'"); }
      if (missing.length) throw new PyErr("TypeError", f.name + "() missing " + missing.length + " required positional argument" + (missing.length > 1 ? "s" : "") + ": " + (missing.length > 1 ? missing.slice(0, -1).join(", ") + " and " + missing[missing.length - 1] : missing[0]), line);
      if (this.frames.length > 180) throw new PyErr("RecursionError", "maximum recursion depth exceeded", line);
      this.frames.push({ name: f.name, line: node.line });
      var res = yield* this.block(node.body, sc);
      this.frames.pop();
      return res instanceof Ret ? res.v : null;
    }
    throw new PyErr("TypeError", "'" + tn(f) + "' object is not callable", line);
  };

  /* ------------------------------------------------------ statements */

  P.block = function* (body, sc) {
    for (var i = 0; i < body.length; i++) {
      var r = yield* this.exec(body[i], sc);
      if (r) return r;
    }
    return null;
  };

  P.exec = function* (s, sc) {
    var top = this.frames[this.frames.length - 1], v, i, r;
    if (top) top.line = s.line;
    if (++this.ops % 300 === 0) yield 0;
    try {
      switch (s.k) {
        case "expr": yield* this.ev(s.e, sc); return null;
        case "assign":
          v = yield* this.ev(s.value, sc);
          for (i = 0; i < s.targets.length; i++) yield* this.assign(s.targets[i], v, sc);
          return null;
        case "aug": {
          var t = s.target, cur, o, ix;
          if (t.k === "name") { cur = this.lookup(t.id, sc, s.line); v = yield* this.ev(s.value, sc); this.store(t.id, inplace(s.op, cur, v, s.line), sc); }
          else if (t.k === "attr") { o = yield* this.ev(t.o, sc); cur = this.getattr(o, t.name, s.line); v = yield* this.ev(s.value, sc); this.setattr(o, t.name, binop(s.op, cur, v, s.line), s.line); }
          else { o = yield* this.ev(t.o, sc); ix = yield* this.ev(t.i, sc); cur = index(o, ix, s.line); v = yield* this.ev(s.value, sc); this.setitem(o, ix, inplace(s.op, cur, v, s.line), s.line); }
          return null;
        }
        case "if":
          for (i = 0; i < s.tests.length; i++) if (truthy(yield* this.ev(s.tests[i][0], sc))) return yield* this.block(s.tests[i][1], sc);
          return s.orelse ? yield* this.block(s.orelse, sc) : null;
        case "while":
          for (;;) {
            if (top) top.line = s.line;
            if (!truthy(yield* this.ev(s.cond, sc))) { if (s.orelse) return yield* this.block(s.orelse, sc); return null; }
            r = yield* this.block(s.body, sc);
            if (r === BRK) return null;
            if (r instanceof Ret) return r;
            if (++this.ops % 300 === 0) yield 0;
          }
        case "for": {
          var seq = yield* this.ev(s.iter, sc);
          var rng = seq instanceof Range ? seq : null, arr = rng ? null : Array.isArray(seq) ? seq : listOf(seq, s.line);
          for (i = 0; rng ? (rng.s > 0 ? rng.a + i * rng.s < rng.b : rng.a + i * rng.s > rng.b) : i < arr.length; i++) {
            yield* this.assign(s.target, rng ? rng.a + i * rng.s : arr[i], sc);
            r = yield* this.block(s.body, sc);
            if (r === BRK) return null;
            if (r instanceof Ret) return r;
            if (++this.ops % 300 === 0) yield 0;
          }
          return s.orelse ? yield* this.block(s.orelse, sc) : null;
        }
        case "def": {
          var defs = [];
          for (i = 0; i < s.params.length; i++) defs.push(s.params[i].def ? yield* this.ev(s.params[i].def, sc) : undefined);
          this.store(s.name, new Fn(s, sc, defs), sc);
          return null;
        }
        case "return": return new Ret(s.e ? yield* this.ev(s.e, sc) : null);
        case "break": return BRK;
        case "continue": return CNT;
        case "pass": case "global": case "nonlocal": return null;
        case "import":
          for (i = 0; i < s.names.length; i++) {
            var full = s.names[i][0], m = this.importModule(full, s.line);
            if (s.names[i][1]) this.store(s.names[i][1], m, sc);
            else this.store(full.split(".")[0], this.importModule(full.split(".")[0], s.line), sc);
          }
          return null;
        case "from": {
          var mod = this.importModule(s.mod, s.line);
          if (s.names === "*") { for (var key in mod.attrs) if (key.charAt(0) !== "_") this.store(key, mod.attrs[key], sc); return null; }
          for (i = 0; i < s.names.length; i++) {
            var nm = s.names[i][0];
            if (!own(mod.attrs, nm)) {
              var sub = this.tryModule(s.mod + "." + nm);
              if (sub) { this.store(s.names[i][1] || nm, sub, sc); continue; }
              throw new PyErr("ImportError", "cannot import name '" + nm + "' from '" + s.mod + "'" + suggest(nm, Object.keys(mod.attrs)), s.line);
            }
            this.store(s.names[i][1] || nm, mod.attrs[nm], sc);
          }
          return null;
        }
        case "try": return yield* this.tryStmt(s, sc);
        case "raise": {
          if (!s.e) { if (this.handling) throw this.handling; throw new PyErr("RuntimeError", "No active exception to reraise", s.line); }
          v = yield* this.ev(s.e, sc);
          if (typeof v === "function" && v.exc) v = v([], {}, this, s.line);
          if (!(v instanceof PyErr)) throw new PyErr("TypeError", "exceptions must derive from BaseException", s.line);
          v.line = s.line; v.tb = null;
          throw v;
        }
        case "with": {
          var opened = [];
          try {
            for (i = 0; i < s.items.length; i++) {
              v = yield* this.ev(s.items[i][0], sc);
              if (!(v instanceof Obj) || !v.cls.methods.close) throw new PyErr("TypeError", "'" + tn(v) + "' object does not support the context manager protocol", s.line);
              opened.push(v);
              if (s.items[i][1]) yield* this.assign(s.items[i][1], v, sc);
            }
            return yield* this.block(s.body, sc);
          } finally {
            for (i = opened.length - 1; i >= 0; i--) opened[i].cls.methods.close(opened[i], [], {}, this, s.line);
          }
        }
        case "del":
          for (i = 0; i < s.targets.length; i++) {
            var d = s.targets[i];
            if (d.k === "name") { this.lookup(d.id, sc, s.line); var holder = sc; while (holder && !(d.id in holder.vars)) holder = holder.parent; if (holder) delete holder.vars[d.id]; }
            else if (d.k === "sub") {
              var c = yield* this.ev(d.o, sc), ki = yield* this.ev(d.i, sc);
              if (c instanceof Dict) { if (!c.del(ki)) throw new PyErr("KeyError", repr(ki), s.line); }
              else if (Array.isArray(c)) { index(c, ki, s.line); c.splice(ki < 0 ? c.length + ki : ki, 1); }
              else throw new PyErr("TypeError", "'" + tn(c) + "' object doesn't support item deletion", s.line);
            } else throw new PyErr("SyntaxError", "cannot delete that", s.line);
          }
          return null;
        case "assert":
          if (!truthy(yield* this.ev(s.e, sc))) throw new PyErr("AssertionError", s.msg ? str(yield* this.ev(s.msg, sc)) : "", s.line);
          return null;
      }
    } catch (e) {
      throw this.trace(e, s.line);
    }
    return null;
  };
  function inplace(op, cur, v, line) {
    if (op === "+" && Array.isArray(cur)) { listOf(v, line).forEach(function (x) { cur.push(x); }); return cur; }
    return binop(op, cur, v, line);
  }
  /* Remember where an error happened, the first time it passes by. */
  P.trace = function (e, line) {
    if (e === Py.SIGINT) e = new PyErr("KeyboardInterrupt", "", line);
    if (!(e instanceof PyErr)) {
      if (e instanceof RangeError) e = new PyErr("RecursionError", "maximum recursion depth exceeded", line);
      else { if (root.console) console.error(e); e = new PyErr("RuntimeError", "the simulator tripped over this line (" + (e && e.message || e) + ")", line); }
    }
    if (!e.tb) { if (!e.line) e.line = line; e.tb = this.frames.map(function (f) { return { name: f.name, line: f.line }; }); if (e.tb.length) e.tb[e.tb.length - 1].line = e.line || line; }
    return e;
  };

  P.tryStmt = function* (s, sc) {
    var r = null, depth = this.frames.length;
    try {
      try {
        r = yield* this.block(s.body, sc);
        if (!r && s.orelse) r = yield* this.block(s.orelse, sc);
      } catch (e0) {
        var e = this.trace(e0, s.line), h = null;
        for (var i = 0; i < s.handlers.length && !h; i++) {
          var hd = s.handlers[i];
          if (!hd.type) { h = hd; break; }
          var ty = yield* this.ev(hd.type, sc), list = ty instanceof Tuple ? ty.v : [ty];
          for (var j = 0; j < list.length; j++) {
            if (typeof list[j] !== "function" || !list[j].exc) throw new PyErr("TypeError", "catching classes that do not inherit from BaseException is not allowed", hd.line);
            if (isA(e.type, list[j].exc)) h = hd;
          }
        }
        if (!h) throw e;
        this.frames.length = depth;
        if (h.name) this.store(h.name, e, sc);
        var was = this.handling; this.handling = e;
        try { r = yield* this.block(h.body, sc); } finally { this.handling = was; }
      }
    } finally {
      if (s.final) {
        this.frames.length = Math.min(this.frames.length, depth);
        var fr = yield* this.block(s.final, sc);
        if (fr) r = fr;      /* a return in finally wins */
      }
    }
    return r;
  };

  P.assign = function* (t, v, sc) {
    switch (t.k) {
      case "name": this.store(t.id, v, sc); return;
      case "attr": this.setattr(yield* this.ev(t.o, sc), t.name, v, t.line); return;
      case "sub": { var o = yield* this.ev(t.o, sc), i = yield* this.ev(t.i, sc); this.setitem(o, i, v, t.line); return; }
      case "tuple": case "list": {
        var arr;
        try { arr = listOf(v, t.line); } catch (e) { throw new PyErr("TypeError", "cannot unpack non-iterable " + tn(v) + " object", t.line); }
        if (arr.length < t.items.length) throw new PyErr("ValueError", "not enough values to unpack (expected " + t.items.length + ", got " + arr.length + ")", t.line);
        if (arr.length > t.items.length) throw new PyErr("ValueError", "too many values to unpack (expected " + t.items.length + ")", t.line);
        for (var k = 0; k < arr.length; k++) yield* this.assign(t.items[k], arr[k], sc);
      }
    }
  };
  P.setitem = function (o, i, v, line) {
    if (o instanceof Dict) { o.set(i, v); return; }
    if (Array.isArray(o)) {
      var j = toIdx(i, "list", line); if (j < 0) j += o.length;
      if (j < 0 || j >= o.length) throw new PyErr("IndexError", "list assignment index out of range", line);
      o[j] = v; return;
    }
    throw new PyErr("TypeError", "'" + tn(o) + "' object does not support item assignment", line);
  };

  /* ----------------------------------------------------- expressions */

  P.ev = function* (e, sc) {
    var a, b, i, o;
    switch (e.k) {
      case "num": case "str": case "const": return e.v;
      case "name": return this.lookup(e.id, sc, e.line);
      case "fstr": {
        var s = "";
        for (i = 0; i < e.parts.length; i++) {
          var p = e.parts[i];
          if (typeof p === "string") { s += p; continue; }
          a = yield* this.ev(p.e, sc);
          if (p.conv === "r") a = repr(a); else if (p.conv === "s") a = str(a);
          s += format(a, p.spec, e.line);
        }
        return s;
      }
      case "list": { o = []; for (i = 0; i < e.items.length; i++) o.push(yield* this.ev(e.items[i], sc)); return o; }
      case "tuple": { o = []; for (i = 0; i < e.items.length; i++) o.push(yield* this.ev(e.items[i], sc)); return new Tuple(o); }
      case "dict": { o = new Dict(); for (i = 0; i < e.items.length; i++) { a = yield* this.ev(e.items[i][0], sc); if (Array.isArray(a) || a instanceof Dict) throw new PyErr("TypeError", "unhashable type: '" + tn(a) + "'", e.line); o.set(a, yield* this.ev(e.items[i][1], sc)); } return o; }
      case "bin": a = yield* this.ev(e.a, sc); b = yield* this.ev(e.b, sc); return binop(e.op, a, b, e.line);
      case "un":
        a = yield* this.ev(e.a, sc);
        if (e.op === "not") return !truthy(a);
        if (!isNum(a)) throw new PyErr("TypeError", "bad operand type for unary " + e.op + ": '" + tn(a) + "'", e.line);
        if (e.op === "~") return ~nv(a);
        return a instanceof Fl ? fl(e.op === "-" ? -a.v : a.v) : (e.op === "-" ? -a : +a);
      case "bool":
        a = yield* this.ev(e.a, sc);
        if (e.op === "and" ? !truthy(a) : truthy(a)) return a;
        return yield* this.ev(e.b, sc);
      case "cmp": {
        a = yield* this.ev(e.first, sc);
        for (i = 0; i < e.rest.length; i++) {
          b = yield* this.ev(e.rest[i][1], sc);
          var op = e.rest[i][0], r;
          switch (op) {
            case "==": r = eq(a, b); break;
            case "!=": r = !eq(a, b); break;
            case "<": r = less(a, b, op, e.line); break;
            case ">": r = less(b, a, op, e.line); break;
            case "<=": r = eq(a, b) || less(a, b, op, e.line); break;
            case ">=": r = eq(a, b) || less(b, a, op, e.line); break;
            case "in": r = contains(b, a, e.line); break;
            case "not in": r = !contains(b, a, e.line); break;
            case "is": r = a === b || (a == null && b == null); break;
            default: r = !(a === b || (a == null && b == null));
          }
          if (!r) return false;
          a = b;
        }
        return true;
      }
      case "tern": return truthy(yield* this.ev(e.c, sc)) ? yield* this.ev(e.a, sc) : yield* this.ev(e.b, sc);
      case "attr": return this.getattr(yield* this.ev(e.o, sc), e.name, e.line);
      case "sub":
        o = yield* this.ev(e.o, sc);
        if (e.i.k === "slice") return slice(o, e.i.lo ? yield* this.ev(e.i.lo, sc) : null, e.i.hi ? yield* this.ev(e.i.hi, sc) : null, e.i.step ? yield* this.ev(e.i.step, sc) : null, e.line);
        return index(o, yield* this.ev(e.i, sc), e.line);
      case "call": {
        var f = yield* this.ev(e.f, sc), args = [], kw = {};
        for (i = 0; i < e.args.length; i++) args.push(yield* this.ev(e.args[i], sc));
        for (i = 0; i < e.kw.length; i++) kw[e.kw[i][0]] = yield* this.ev(e.kw[i][1], sc);
        var top = this.frames[this.frames.length - 1], at = top ? top.line : 0;
        if (top) top.line = e.line;
        var res = yield* this.call(f, args, kw, e.line);
        if (top) top.line = at;
        return res;
      }
      case "lambda": {
        var defs = [];
        for (i = 0; i < e.params.length; i++) defs.push(e.params[i].def ? yield* this.ev(e.params[i].def, sc) : undefined);
        return new Fn(e, sc, defs);
      }
      case "comp": {
        var inner = new Scope(sc, sc.fn), out = e.key ? new Dict() : [], self = this;
        inner.fn = null;      /* its loop variables are its own */
        var loop = function* (d) {
          if (d === e.fors.length) {
            if (e.key) out.set(yield* self.ev(e.key, inner), yield* self.ev(e.elt, inner));
            else out.push(yield* self.ev(e.elt, inner));
            return;
          }
          var fr = e.fors[d], arr = listOf(yield* self.ev(fr.iter, d ? inner : sc), e.line);
          for (var j = 0; j < arr.length; j++) {
            yield* self.assign(fr.target, arr[j], inner);
            var ok = true;
            for (var c = 0; c < fr.conds.length && ok; c++) ok = truthy(yield* self.ev(fr.conds[c], inner));
            if (ok) yield* loop(d + 1);
            if (++self.ops % 300 === 0) yield 0;
          }
        };
        yield* loop(0);
        return out;
      }
    }
    throw new PyErr("SyntaxError", "invalid syntax", e.line);
  };

  /* ----------------------------------------------------------- modules */

  P.tryModule = function (name) {
    if (this.modules[name]) return this.modules[name];
    var make = MODULES[name];
    if (!make) return null;
    return (this.modules[name] = new Module(name, make(this)));
  };
  P.importModule = function (name, line) {
    var m = this.tryModule(name);
    if (m) return m;
    var real = /^(threading|subprocess|json|re|csv|socket|requests|numpy|cv2|pygame|tkinter|smbus|smbus2|spidev|picamera|picamera2|sense_hat|Adafruit_DHT|board|busio|pigpio|serial|asyncio|collections|itertools|functools|statistics|string|pathlib|turtle)(\.|$)/.test(name);
    throw new PyErr("ModuleNotFoundError", "No module named '" + name + "'" + (real ? " on this simulated Pi (it has: " + Py.MODULES + ")" : ""), line);
  };

  /* ----------------------------------------------------------- running */

  P.spawn = function (gen, main) { var th = { gen: gen, wake: -1, main: !!main, done: false, frames: [{ name: main ? "<module>" : "<callback>", line: 1 }] }; this.threads.push(th); return th; };

  P.report = function (e) {
    if (e.type === "SystemExit") return;
    var s = "", self = this;
    if (isA(e.type, "SyntaxError")) {
      s = '  File "' + this.file + '", line ' + e.line + "\n" + (this.lines[e.line - 1] != null ? "    " + this.lines[e.line - 1].trim() + "\n" : "");
    } else {
      s = "Traceback (most recent call last):\n";
      (e.tb && e.tb.length ? e.tb : [{ name: "<module>", line: e.line }]).forEach(function (f) {
        if (f.name === "<callback>") return;
        s += '  File "' + self.file + '", line ' + f.line + ", in " + f.name + "\n" + (self.lines[f.line - 1] != null && self.file !== "<stdin>" ? "    " + self.lines[f.line - 1].trim() + "\n" : "");
      });
    }
    this.env.out(s + e.type + (e.msg ? ": " + e.msg : "") + "\n", "err");
  };

  /* gpiozero tidies up when the program ends: every device it made goes
   * back to being an input. RPi.GPIO does not — which is why forgetting
   * GPIO.cleanup() leaves an LED lit and earns a warning next time. */
  P.cleanup = function () {
    var self = this;
    this.devices.slice().forEach(function (d) { if (!d.d.closed && d.cls.methods.close) try { d.cls.methods.close(d, [], {}, self, 0); } catch (e) {} });
    Object.keys(this.rpi.pwm).forEach(function (k) { self.gpio.pwm(+k, null); });
    this.env.wantInput && this.env.wantInput(false);
  };

  /* The scheduler: steps every thread that is due, lets devices that blink
   * or watch for edges do their work, and tells the kernel how long this
   * process can sleep. */
  P.loop = function* () {
    var intr = false, code = 0;
    for (;;) {
      var now = this.now(), next = Infinity, mainDone = false, i;
      this.poll(now);
      var list = this.threads.slice();
      for (i = 0; i < list.length; i++) {
        var th = list[i], r;
        if (th.done) continue;
        var kick = th.main && intr;
        if (!kick && th.wake > now + 1e-9) { next = Math.min(next, th.wake); continue; }
        this.frames = th.frames;
        try {
          if (kick) { intr = false; r = th.gen.throw(Py.SIGINT); }
          else r = th.gen.next();
        } catch (e0) {
          var e = this.trace(e0, 0);
          th.done = true;
          if (e.type === "SystemExit") { code = /^\d+$/.test(e.msg) ? +e.msg : e.msg ? 1 : 0; if (e.msg && !/^\d+$/.test(e.msg)) this.env.out(e.msg + "\n", "err"); mainDone = true; }
          else {
            if (!th.main) this.env.out("Exception in thread Thread-" + (i + 1) + ":\n", "err");
            this.report(e);
            if (th.main) { code = e.type === "KeyboardInterrupt" ? 130 : 1; mainDone = true; }
          }
          continue;
        }
        if (r.done) { th.done = true; if (th.main) { mainDone = true; if (typeof r.value === "number") code = r.value; } }
        else { th.wake = (th.wake > now - 0.05 && r.value > 0 ? th.wake : now) + Math.max(0, r.value || 0); if (th.wake < now) th.wake = now; next = Math.min(next, th.wake); }
      }
      this.threads = this.threads.filter(function (t) { return !t.done; });
      if (mainDone) { this.cleanup(); return code; }
      try { yield Math.max(0, Math.min(next - now, 0.01)); }
      catch (sig) { if (sig === Py.SIGINT) intr = true; else throw sig; }
    }
  };

  P.runFile = function (src, path, argv) {
    var self = this;
    this.file = path; this.lines = String(src).split("\n"); this.argv = argv || [path];
    this.spawn((function* () {
      var body;
      try { body = parse(src); } catch (e) { if (e instanceof PyErr) { self.report(e); return 1; } throw e; }
      yield* self.block(body, self.globals);
      return 0;
    })(), true);
    return this.loop();
  };

  /* The >>> prompt. A line ending in ":" opens a block that a blank line
   * closes, exactly as at a real Python prompt. */
  P.runRepl = function (banner) {
    var self = this, env = this.env;
    this.file = "<stdin>"; this.argv = [""];
    this.spawn((function* () {
      env.out(banner || "Python 3.11.2 (main, Nov 30 2024, 21:22:50) [GCC 12.2.0] on linux\nType \"help\", \"copyright\", \"credits\" or \"license\" for more information.\n");
      var buf = [];
      for (;;) {
        env.out(buf.length ? "... " : ">>> ", "prompt");
        env.wantInput(true);
        var line;
        try {
          for (;;) { line = env.readLine(); if (line !== null && line !== undefined) break; yield 0.02; }
        } catch (sig) {
          if (sig !== Py.SIGINT) throw sig;
          env.out("\nKeyboardInterrupt\n"); buf = []; continue;
        }
        if (line === false) { env.out("\n"); return 0; }
        if (buf.length) { if (line.trim() !== "") { buf.push(line); continue; } }
        else {
          if (!line.trim()) continue;
          buf.push(line);
          var open = false;
          try { parse(line); } catch (e) { open = e instanceof PyErr && (/never closed|expected an indented block|unterminated triple/.test(e.msg) || /:\s*(#.*)?$/.test(line)); }
          if (open || /^\s*(if|for|while|def|try|with)\b.*:\s*(#.*)?$/.test(line)) continue;
        }
        var src = buf.join("\n"); buf = [];
        self.lines = src.split("\n");
        try {
          var body = parse(src);
          self.frames.length = 1;
          if (body.length === 1 && body[0].k === "expr") {
            var v = yield* self.ev(body[0].e, self.globals);
            if (v !== null && v !== undefined) { env.out(repr(v) + "\n"); self.globals.vars._ = v; }
          } else yield* self.block(body, self.globals);
        } catch (e0) {
          var e = self.trace(e0, 1);
          if (e.type === "SystemExit") return /^\d+$/.test(e.msg) ? +e.msg : 0;
          self.report(e);
        }
      }
    })(), true);
    return this.loop();
  };

  /* -------------------------------------------- devices in the background */

  P.poll = function (now) {
    var self = this;
    for (var i = 0; i < this.devices.length; i++) {
      var o = this.devices[i], d = o.d;
      if (d.closed) continue;
      var t = d.task;
      if (t) {
        if (t.kind === "blink") {
          var guard = 0;
          while (d.task === t && now >= t.next && guard++ < 50) {
            t.state = !t.state;
            t.set(t.state);
            t.next += Math.max(0.002, t.state ? t.on : t.off);
            if (!t.state && t.n != null && --t.n <= 0) { d.task = null; }
          }
        } else if (t.kind === "pulse") {
          var cyc = t.in + t.out, x = now - t.t0;
          if (t.n != null && x >= cyc * t.n) { t.set(0); d.task = null; }
          else { x = x % cyc; t.set(x < t.in ? (t.in ? x / t.in : 1) : 1 - (t.out ? (x - t.in) / t.out : 1)); }
        }
      }
      if (d.watch) {
        var cur = d.watch(o);
        if (d.last == null) { if (now - d.born >= 0.03) d.last = cur; }
        else if (cur !== d.last) {
          d.last = cur; d.since = now; d.held = false;
          var cb = cur ? d.whenOn : d.whenOff;
          if (cb) this.fire(cb, o);
        } else if (cur && d.whenHeld && !d.held && d.since != null && now - d.since >= d.holdTime) { d.held = true; this.fire(d.whenHeld, o); }
      }
    }
    /* RPi.GPIO.add_event_detect */
    this.rpi.events.forEach(function (ev) {
      var v = self.gpio.read(ev.pin);
      if (ev.last == null) { if (now - ev.born >= 0.03) ev.last = v; return; }
      if (v === ev.last) return;
      ev.last = v;
      if ((ev.edge === "RISING" && !v) || (ev.edge === "FALLING" && v) || now - ev.at < ev.bounce) return;
      ev.at = now; ev.hit = true;
      if (ev.cb) self.spawn(self.call(ev.cb, [ev.chan], {}, 0));
    });
  };
  /* gpiozero hands the device to a callback that asks for one argument */
  P.fire = function (cb, dev) {
    var wants = cb instanceof Fn && cb.node.params.length > 0 && !cb.node.params[0].def;
    this.spawn(this.call(cb, wants ? [dev] : [], {}, 0));
  };

  /* ============================================================ BUILTINS */

  function arg(args, kw, i, name, dflt) { return i < args.length ? args[i] : (kw && own(kw, name) ? kw[name] : dflt); }
  function numArg(v, what, line) { if (!isNum(v)) throw new PyErr("TypeError", what + " must be a number, not '" + tn(v) + "'", line); return nv(v); }
  function named(fn, name) { fn.pyname = name; return fn; }
  function excClass(name) { var f = function (args) { return new PyErr(name, args.length ? (args.length === 1 ? str(args[0]) : str(new Tuple(args))) : ""); }; f.exc = name; f.pyname = name; return f; }
  function tyClass(name, fn) { fn.tyname = name; fn.pyname = name; return fn; }
  function roundHalfEven(x) { var r = Math.round(x); return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r; }

  function makeBuiltins(it) {
    var B = Object.create(null);
    Object.keys(BASES).concat(["BaseException"]).forEach(function (n) { B[n] = excClass(n); });
    B.IOError = B.OSError;

    B.print = function (args, kw) {
      var sep = kw.sep == null ? " " : str(kw.sep), end = kw.end == null ? "\n" : str(kw.end);
      it.out(args.map(str).join(sep) + end);
      return null;
    };
    B.input = function* (args) {
      if (args.length) it.out(str(args[0]), "prompt");
      it.env.wantInput(true);
      var line;
      try { for (;;) { line = it.env.readLine(); if (line !== null && line !== undefined) break; yield 0.02; } }
      finally { it.env.wantInput(false); }
      if (line === false) throw new PyErr("EOFError", "EOF when reading a line");
      return line;
    };
    B.len = function (a, kw, i2, line) {
      need(a, 1, 1, "len", line);
      var x = a[0];
      if (typeof x === "string" || Array.isArray(x)) return x.length;
      if (x instanceof Tuple) return x.v.length;
      if (x instanceof Dict) return x.m.size;
      if (x instanceof Range) return x.len();
      if (x instanceof Obj && x.cls.items) return x.cls.items(x).length;
      throw new PyErr("TypeError", "object of type '" + tn(x) + "' has no len()", line);
    };
    B.range = tyClass("range", function (a, kw, i2, line) {
      need(a, 1, 3, "range", line);
      a.forEach(function (x) { if (!isInt(x)) throw new PyErr("TypeError", "'" + tn(x) + "' object cannot be interpreted as an integer", line); });
      if (a.length === 3 && +a[2] === 0) throw new PyErr("ValueError", "range() arg 3 must not be zero", line);
      return a.length === 1 ? new Range(0, +a[0], 1) : new Range(+a[0], +a[1], a.length === 3 ? +a[2] : 1);
    });
    B.int = tyClass("int", function (a, kw, i2, line) {
      if (!a.length) return 0;
      var x = a[0], base = a.length > 1 ? +a[1] : 10;
      if (isNum(x)) { var v = nv(x); if (!isFinite(v)) throw new PyErr(v !== v ? "ValueError" : "OverflowError", "cannot convert float " + fstr(v) + " to integer", line); return Math.trunc(v); }
      if (typeof x === "string") {
        var s = x.trim().replace(/_/g, "").toLowerCase();
        if (base === 16) s = s.replace(/^([-+]?)0x/, "$1"); if (base === 2) s = s.replace(/^([-+]?)0b/, "$1");
        var ok = base === 10 ? /^[-+]?\d+$/.test(s) : new RegExp("^[-+]?[" + "0123456789abcdefghijklmnopqrstuvwxyz".slice(0, base) + "]+$").test(s);
        if (!ok) throw new PyErr("ValueError", "invalid literal for int() with base " + base + ": " + repr(x), line);
        return parseInt(s, base);
      }
      throw new PyErr("TypeError", "int() argument must be a string, a bytes-like object or a real number, not '" + tn(x) + "'", line);
    });
    B.float = tyClass("float", function (a, kw, i2, line) {
      if (!a.length) return fl(0);
      var x = a[0];
      if (isNum(x)) return fl(nv(x));
      if (typeof x === "string") {
        var s = x.trim().toLowerCase();
        if (/^[-+]?(inf|infinity)$/.test(s)) return fl(s.charAt(0) === "-" ? -Infinity : Infinity);
        if (s === "nan") return fl(NaN);
        if (!/^[-+]?(\d+\.?\d*([e][-+]?\d+)?|\.\d+([e][-+]?\d+)?)$/.test(s)) throw new PyErr("ValueError", "could not convert string to float: " + repr(x), line);
        return fl(Number(s));
      }
      throw new PyErr("TypeError", "float() argument must be a string or a real number, not '" + tn(x) + "'", line);
    });
    B.str = tyClass("str", function (a) { return a.length ? str(a[0]) : ""; });
    B.repr = function (a) { return repr(a[0]); };
    B.bool = tyClass("bool", function (a) { return a.length ? truthy(a[0]) : false; });
    B.list = tyClass("list", function (a, kw, i2, line) { return a.length ? listOf(a[0], line) : []; });
    B.tuple = tyClass("tuple", function (a, kw, i2, line) { return new Tuple(a.length ? listOf(a[0], line) : []); });
    B.dict = tyClass("dict", function (a, kw, i2, line) {
      var d = new Dict();
      if (a[0] instanceof Dict) a[0].m.forEach(function (e) { d.set(e[0], e[1]); });
      else if (a.length) listOf(a[0], line).forEach(function (p) { var q = listOf(p, line); d.set(q[0], q[1]); });
      Object.keys(kw).forEach(function (k) { d.set(k, kw[k]); });
      return d;
    });
    B.abs = function (a, kw, i2, line) { var x = a[0]; if (!isNum(x)) throw new PyErr("TypeError", "bad operand type for abs(): '" + tn(x) + "'", line); return x instanceof Fl ? fl(Math.abs(x.v)) : Math.abs(+x); };
    var minmax = function (name, pick) {
      return function* (a, kw, i2, line) {
        var l = a.length === 1 ? listOf(a[0], line) : a.slice();
        if (!l.length) { if ("default" in kw) return kw.default; throw new PyErr("ValueError", name + "() arg is an empty sequence", line); }
        var best = l[0], bk = kw.key != null ? yield* it.call(kw.key, [best], {}, line) : best;
        for (var i = 1; i < l.length; i++) { var k = kw.key != null ? yield* it.call(kw.key, [l[i]], {}, line) : l[i]; if (pick(k, bk, line)) { best = l[i]; bk = k; } }
        return best;
      };
    };
    B.min = minmax("min", function (a, b, line) { return less(a, b, "<", line); });
    B.max = minmax("max", function (a, b, line) { return less(b, a, ">", line); });
    B.sum = function (a, kw, i2, line) { var t = a.length > 1 ? a[1] : 0; listOf(a[0], line).forEach(function (x) { t = binop("+", t, x, line); }); return t; };
    B.round = function (a, kw, i2, line) {
      var x = a[0], nd = a.length > 1 ? a[1] : null;
      if (!isNum(x)) throw new PyErr("TypeError", "type " + tn(x) + " doesn't define __round__ method", line);
      if (nd == null) return roundHalfEven(nv(x));
      if (!(x instanceof Fl)) return +x;
      var m = Math.pow(10, +nd), y = nv(x) * m, r = Math.abs(y % 1 - 0.5) < 1e-9 || Math.abs(y % 1 + 0.5) < 1e-9 ? Math.round(y + (y > 0 ? 1e-9 : -1e-9)) : Math.round(y);
      return fl(r / m);
    };
    B.sorted = function (a, kw, i2, line) { return sortGen(listOf(a[0], line), kw, it, line, false); };
    B.reversed = function (a, kw, i2, line) { return listOf(a[0], line).reverse(); };
    B.enumerate = function (a, kw, i2, line) { var s = +arg(a, kw, 1, "start", 0); return listOf(a[0], line).map(function (x, i) { return new Tuple([i + s, x]); }); };
    B.zip = function (a, kw, i2, line) {
      var ls = a.map(function (x) { return listOf(x, line); }), n = ls.length ? Math.min.apply(null, ls.map(function (l) { return l.length; })) : 0, o = [];
      for (var i = 0; i < n; i++) o.push(new Tuple(ls.map(function (l) { return l[i]; })));
      return o;
    };
    B.map = function* (a, kw, i2, line) { var o = [], l = listOf(a[1], line); for (var i = 0; i < l.length; i++) o.push(yield* it.call(a[0], [l[i]], {}, line)); return o; };
    B.filter = function* (a, kw, i2, line) { var o = [], l = listOf(a[1], line); for (var i = 0; i < l.length; i++) if (truthy(a[0] === null ? l[i] : yield* it.call(a[0], [l[i]], {}, line))) o.push(l[i]); return o; };
    B.any = function (a, kw, i2, line) { return listOf(a[0], line).some(truthy); };
    B.all = function (a, kw, i2, line) { return listOf(a[0], line).every(truthy); };
    B.chr = function (a) { return String.fromCharCode(+a[0]); };
    B.ord = function (a, kw, i2, line) { if (typeof a[0] !== "string" || a[0].length !== 1) throw new PyErr("TypeError", "ord() expected a character", line); return a[0].charCodeAt(0); };
    B.hex = function (a) { return (a[0] < 0 ? "-" : "") + "0x" + Math.abs(+a[0]).toString(16); };
    B.bin = function (a) { return (a[0] < 0 ? "-" : "") + "0b" + Math.abs(+a[0]).toString(2); };
    B.pow = function (a, kw, i2, line) { return binop("**", a[0], a[1], line); };
    B.divmod = function (a, kw, i2, line) { return new Tuple([binop("//", a[0], a[1], line), binop("%", a[0], a[1], line)]); };
    B.format = function (a, kw, i2, line) { return format(a[0], a.length > 1 ? a[1] : "", line); };
    B.type = function (a) {
      var x = a[0], name = tn(x), t = B[name];
      if (t && (t.tyname || t.exc)) return t;
      if (x instanceof Obj && x.cls.ctor) return x.cls.ctor;
      var f = function () { return null; }; f.tyname = name; return f;
    };
    B.isinstance = function (a, kw, i2, line) {
      var x = a[0], ts = a[1] instanceof Tuple ? a[1].v : [a[1]];
      return ts.some(function (t) {
        if (typeof t !== "function") throw new PyErr("TypeError", "isinstance() arg 2 must be a type, a tuple of types, or a union", line);
        if (t.exc) return x instanceof PyErr && isA(x.type, t.exc);
        if (t.cls) { if (!(x instanceof Obj)) return false; for (var c = x.cls; c; c = c.base) if (c === t.cls) return true; return false; }
        var n = tn(x);
        return t.tyname === n || (t.tyname === "int" && n === "bool");
      });
    };
    B.callable = function (a) { return typeof a[0] === "function" || a[0] instanceof Fn; };
    B.hasattr = function (a) { try { it.getattr(a[0], a[1], 0); return true; } catch (e) { if (e instanceof PyErr) return false; throw e; } };
    B.getattr = function (a, kw, i2, line) { try { return it.getattr(a[0], a[1], line); } catch (e) { if (e instanceof PyErr && a.length > 2) return a[2]; throw e; } };
    B.setattr = function (a, kw, i2, line) { it.setattr(a[0], a[1], a[2], line); return null; };
    B.dir = function (a) {
      var x = a[0];
      if (!a.length) return Object.keys(it.globals.vars).sort();
      if (x instanceof Module) return Object.keys(x.attrs).sort();
      if (x instanceof Obj) return Object.keys(x.cls.props).concat(Object.keys(x.cls.methods)).sort();
      return Object.keys(typeof x === "string" ? STR_M : Array.isArray(x) ? LIST_M : x instanceof Dict ? DICT_M : {}).sort();
    };
    B.id = function (a) { return 140230000000000 + (str(a[0]).length * 7919) % 100000 * 16; };
    B.exit = B.quit = function (a) { throw new PyErr("SystemExit", a.length && a[0] !== null ? str(a[0]) : ""); };
    B.help = function (a) {
      it.out(a.length ? "Help on " + tn(a[0]) + (a[0] && (a[0].pyname || a[0].name) ? " " + (a[0].pyname || a[0].name) : "") + ": this Pi keeps its manuals short. Try dir(" + (a[0] instanceof Module ? a[0].name : "thing") + ") to see what it can do.\n"
        : "This is a small Python that runs inside the Circuit Lab.\nModules: " + Py.MODULES + ".\nTry:  from gpiozero import LED   then   led = LED(17)   then   led.on()\n");
      return null;
    };
    B.open = function (a, kw, i2, line) { return openFile(it, str(a[0]), str(arg(a, kw, 1, "mode", "r")), line); };
    Object.keys(B).forEach(function (k) { if (!B[k].pyname) B[k].pyname = k; });
    return B;
  }

  /* -------------------------------------------------------------- files */

  var FILE = {
    name: "TextIOWrapper", mod: "_io", props: { name: { get: function (o) { return o.d.path; } }, closed: { get: function (o) { return !!o.d.closed; } }, mode: { get: function (o) { return o.d.mode; } } },
    repr: function (o) { return "<_io.TextIOWrapper name=" + repr(o.d.path) + " mode=" + repr(o.d.mode) + " encoding='UTF-8'>"; },
    items: function (o) { return fileLines(o.d.text.slice(o.d.pos)); },
    methods: {
      write: function (o, a, kw, it, line) {
        if (o.d.closed) throw new PyErr("ValueError", "I/O operation on closed file.", line);
        if (o.d.mode.charAt(0) === "r") throw new PyErr("UnsupportedOperation", "not writable", line);
        var s = wantStr(a[0], "write() argument", line), err = it.env.fs.write(o.d.path, s, true);
        if (err) throw new PyErr("OSError", err, line);
        return s.length;
      },
      read: function (o) { var s = o.d.text.slice(o.d.pos); o.d.pos = o.d.text.length; return s; },
      readline: function (o) { var rest = o.d.text.slice(o.d.pos), i = rest.indexOf("\n"), s = i < 0 ? rest : rest.slice(0, i + 1); o.d.pos += s.length; return s; },
      readlines: function (o) { var l = fileLines(o.d.text.slice(o.d.pos)); o.d.pos = o.d.text.length; return l; },
      flush: function () { return null; },
      close: function (o) { o.d.closed = true; return null; }
    }
  };
  function fileLines(s) { var o = s.split("\n").map(function (l) { return l + "\n"; }); if (/\n$/.test(s) || s === "") o.pop(); else o[o.length - 1] = o[o.length - 1].slice(0, -1); return o; }
  function openFile(it, path, mode, line) {
    var fs = it.env.fs, o = new Obj(FILE), cur = fs.read(path);
    if (!/^[rwa][+bt]*$/.test(mode)) throw new PyErr("ValueError", "invalid mode: '" + mode + "'", line);
    if (cur === false) throw new PyErr("IsADirectoryError", "[Errno 21] Is a directory: " + repr(path), line);
    if (mode.charAt(0) === "r" && cur === null) throw new PyErr("FileNotFoundError", "[Errno 2] No such file or directory: " + repr(path), line);
    o.d = { path: path, mode: mode, text: cur || "", pos: 0 };
    if (mode.charAt(0) === "w") { var err = fs.write(path, "", false); if (err) throw new PyErr(/Permission/.test(err) ? "PermissionError" : "OSError", err, line); o.d.text = ""; }
    else if (mode.charAt(0) === "a" && cur === null) { var e2 = fs.write(path, "", false); if (e2) throw new PyErr(/Permission/.test(e2) ? "PermissionError" : "OSError", e2, line); }
    return o;
  }

  /* ============================================================ MODULES */

  var MODULES = {};

  MODULES.time = function (it) {
    var pad = function (n, w) { n = String(n); while (n.length < (w || 2)) n = "0" + n; return n; };
    var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    var strftime = Py.strftime = function (fmt, d) {
      return fmt.replace(/%([a-zA-Z%])/g, function (all, c) {
        switch (c) {
          case "H": return pad(d.getHours()); case "M": return pad(d.getMinutes()); case "S": return pad(d.getSeconds());
          case "I": return pad((d.getHours() + 11) % 12 + 1); case "p": return d.getHours() < 12 ? "AM" : "PM";
          case "Y": return String(d.getFullYear()); case "y": return pad(d.getFullYear() % 100); case "m": return pad(d.getMonth() + 1); case "d": return pad(d.getDate());
          case "a": return DAYS[d.getDay()].slice(0, 3); case "A": return DAYS[d.getDay()]; case "b": return MONTHS[d.getMonth()].slice(0, 3); case "B": return MONTHS[d.getMonth()];
          case "f": return pad(d.getMilliseconds() * 1000, 6); case "j": return pad(Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5), 3);
          case "c": return strftime("%a %b %d %H:%M:%S %Y", d); case "x": return strftime("%m/%d/%y", d); case "X": return strftime("%H:%M:%S", d);
          case "%": return "%";
        }
        return all;
      });
    };
    return {
      sleep: named(function* (a, kw, i2, line) {
        need(a, 1, 1, "sleep", line);
        if (!isNum(a[0])) throw new PyErr("TypeError", "'" + tn(a[0]) + "' object cannot be interpreted as an integer", line);
        var s = nv(a[0]);
        if (s < 0) throw new PyErr("ValueError", "sleep length must be non-negative", line);
        yield s;
        return null;
      }, "sleep"),
      time: named(function () { return fl(it.env.wall()); }, "time"),
      monotonic: named(function () { return fl(it.now()); }, "monotonic"),
      perf_counter: named(function () { return fl(it.now()); }, "perf_counter"),
      strftime: named(function (a) { return strftime(str(a[0]), new Date(it.env.wall() * 1000)); }, "strftime"),
      ctime: named(function () { return strftime("%a %b %d %H:%M:%S %Y", new Date(it.env.wall() * 1000)); }, "ctime")
    };
  };

  MODULES.datetime = function (it) {
    it.tryModule("time");
    var DT = { name: "datetime", mod: "datetime", props: {}, methods: {}, repr: function (o) { var d = o.d.t; return Py.strftime("%Y-%m-%d %H:%M:%S.%f", d); } };
    ["year", "month", "day", "hour", "minute", "second"].forEach(function (k, i) {
      DT.props[k] = { get: function (o) { var d = o.d.t; return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()][i]; } };
    });
    DT.methods.strftime = function (o, a) { return Py.strftime(str(a[0]), o.d.t); };
    DT.methods.isoformat = function (o) { return Py.strftime("%Y-%m-%dT%H:%M:%S.%f", o.d.t); };
    DT.methods.timestamp = function (o) { return fl(o.d.t.getTime() / 1000); };
    DT.methods.weekday = function (o) { return (o.d.t.getDay() + 6) % 7; };
    var mk = function (date) { var o = new Obj(DT); o.d = { t: date }; return o; };
    var ctor = function (a) { return mk(new Date(+a[0], +a[1] - 1, +a[2], +(a[3] || 0), +(a[4] || 0), +(a[5] || 0))); };
    ctor.cls = DT; DT.ctor = ctor; ctor.pyname = "datetime";
    ctor.statics = { now: named(function () { return mk(new Date(it.env.wall() * 1000)); }, "now"), today: named(function () { return mk(new Date(it.env.wall() * 1000)); }, "today") };
    return { datetime: ctor };
  };

  MODULES.random = function () {
    var r = Math.random;
    return {
      random: named(function () { return fl(r()); }, "random"),
      uniform: named(function (a) { return fl(nv(a[0]) + r() * (nv(a[1]) - nv(a[0]))); }, "uniform"),
      randint: named(function (a, kw, it, line) { need(a, 2, 2, "randint", line); var lo = Math.ceil(nv(a[0])), hi = Math.floor(nv(a[1])); if (hi < lo) throw new PyErr("ValueError", "empty range for randrange() (" + lo + ", " + (hi + 1) + ", " + (hi + 1 - lo) + ")", line); return lo + Math.floor(r() * (hi - lo + 1)); }, "randint"),
      randrange: named(function (a) { var lo = a.length > 1 ? +a[0] : 0, hi = a.length > 1 ? +a[1] : +a[0], st = a.length > 2 ? +a[2] : 1; return lo + st * Math.floor(r() * Math.ceil((hi - lo) / st)); }, "randrange"),
      choice: named(function (a, kw, it, line) { var l = listOf(a[0], line); if (!l.length) throw new PyErr("IndexError", "Cannot choose from an empty sequence", line); return l[Math.floor(r() * l.length)]; }, "choice"),
      shuffle: named(function (a) { var l = a[0]; for (var i = l.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), t = l[i]; l[i] = l[j]; l[j] = t; } return null; }, "shuffle"),
      seed: named(function () { return null; }, "seed")
    };
  };

  MODULES.math = function () {
    var m = { pi: fl(Math.PI), e: fl(Math.E), tau: fl(2 * Math.PI), inf: fl(Infinity), nan: fl(NaN) };
    var f1 = function (name, fn, intOut) { m[name] = named(function (a, kw, it, line) { var x = numArg(a[0], "argument", line), r = fn(x, a.length > 1 ? nv(a[1]) : undefined); if (r !== r && x === x) throw new PyErr("ValueError", "math domain error", line); return intOut ? r : fl(r); }, name); };
    f1("sqrt", Math.sqrt); f1("sin", Math.sin); f1("cos", Math.cos); f1("tan", Math.tan); f1("asin", Math.asin); f1("acos", Math.acos); f1("atan", Math.atan);
    f1("atan2", Math.atan2); f1("exp", Math.exp); f1("log10", Math.log10); f1("log2", Math.log2); f1("fabs", Math.abs); f1("pow", Math.pow); f1("hypot", Math.hypot);
    f1("log", function (x, b) { return b ? Math.log(x) / Math.log(b) : Math.log(x); });
    f1("radians", function (x) { return x * Math.PI / 180; }); f1("degrees", function (x) { return x * 180 / Math.PI; });
    f1("floor", Math.floor, true); f1("ceil", Math.ceil, true); f1("trunc", Math.trunc, true);
    m.isnan = named(function (a) { var x = nv(a[0]); return x !== x; }, "isnan");
    return m;
  };

  MODULES.signal = function (it) { return { pause: pauseFn(it) }; };
  function pauseFn() { return named(function* () { for (;;) yield 0.05; }, "pause"); }

  MODULES.sys = function (it) {
    return {
      argv: (it.argv || [""]).slice(), version: "3.11.2 (main, Nov 30 2024, 21:22:50) [GCC 12.2.0]", platform: "linux", path: ["", "/usr/lib/python3.11", "/usr/lib/python3/dist-packages"],
      exit: named(function (a) { throw new PyErr("SystemExit", a.length && a[0] !== null ? str(a[0]) : ""); }, "exit"),
      stdout: new Module("sys.stdout", { write: named(function (a) { it.out(str(a[0])); return str(a[0]).length; }, "write"), flush: named(function () { return null; }, "flush") })
    };
  };

  MODULES.os = function (it) {
    var env = it.env;
    return {
      getcwd: named(function () { return env.fs.cwd(); }, "getcwd"),
      listdir: named(function (a, kw, i2, line) { var p = a.length ? str(a[0]) : ".", l = env.fs.list(p); if (!l) throw new PyErr("FileNotFoundError", "[Errno 2] No such file or directory: " + repr(p), line); return l; }, "listdir"),
      getlogin: named(function () { return env.user || "pi"; }, "getlogin"),
      system: named(function* (a) { if (!env.system) return 127; return yield* env.system(str(a[0])); }, "system"),
      name: "posix", sep: "/", linesep: "\n",
      path: new Module("os.path", {
        exists: named(function (a) { return env.fs.read(str(a[0])) !== null; }, "exists"),
        isfile: named(function (a) { var r = env.fs.read(str(a[0])); return r !== null && r !== false; }, "isfile"),
        isdir: named(function (a) { return env.fs.read(str(a[0])) === false; }, "isdir"),
        join: named(function (a) { return a.map(str).reduce(function (p, c) { return c.charAt(0) === "/" ? c : p ? p.replace(/\/$/, "") + "/" + c : c; }, ""); }, "join"),
        basename: named(function (a) { return str(a[0]).split("/").pop(); }, "basename")
      })
    };
  };

  /* ------------------------------------------------------------ gpiozero */

  function parsePin(it, spec, line) {
    var n = null;
    if (isInt(spec)) n = +spec;
    else if (typeof spec === "string") {
      var m = /^(?:GPIO|BCM)(\d+)$/i.exec(spec) || /^(\d+)$/.exec(spec);
      if (m) n = +m[1];
      else if ((m = /^(?:BOARD|J8:)(\d+)$/i.exec(spec))) { n = Py.BOARD[+m[1]]; if (n == null) throw new PyErr("PinInvalidPin", spec + " is not a valid pin spec", line); }
    }
    if (n == null || !it.gpio.valid(n)) throw new PyErr("PinInvalidPin", (typeof spec === "string" ? spec : str(spec)) + " is not a valid pin spec", line);
    return n;
  }
  function claim(it, o, spec, line) {
    if (spec == null) throw new PyErr("GPIOPinMissing", "No pin given", line);
    var n = parsePin(it, spec, line), by = it.owner[n];
    if (by && !by.d.closed) throw new PyErr("GPIOPinInUse", "pin GPIO" + n + " is already in use by " + str(by), line);
    it.owner[n] = o;
    (o.d.pins = o.d.pins || []).push(n);
    return n;
  }
  function closeDev(o, a, kw, it) {
    if (o.d.closed) return null;
    o.d.task = null; o.d.watch = null;
    (o.d.kids || []).forEach(function (k) { closeDev(k, [], {}, it); });
    (o.d.pins || []).forEach(function (n) { if (it.owner[n] === o) { delete it.owner[n]; it.gpio.release(n); } });
    o.d.closed = true;
    return null;
  }
  function devRepr(o) {
    var d = o.d;
    if (d.closed) return "<gpiozero." + o.cls.name + " object closed>";
    return "<gpiozero." + o.cls.name + " object on pin GPIO" + d.pin + (d.pullUp != null ? ", pull_up=" + str(d.pullUp) : d.activeHigh != null ? ", active_high=" + str(d.activeHigh) : "") + ", is_active=" + str(!!(d.watch ? d.watch(o) : d.on)) + ">";
  }
  function frac(v, line, lo) {
    if (!isNum(v)) throw new PyErr("TypeError", "a number is required, not " + tn(v), line);
    var x = nv(v);
    if (x < (lo || 0) || x > 1) throw new PyErr("OutputDeviceBadValue", lo ? "Servo value must be between -1 and 1, or None" : "PWM value must be between 0 and 1", line);
    return x;
  }

  MODULES.gpiozero = function (it) {
    var G = {}, gpio = it.gpio;
    function cls(name, spec, base) {
      var c = { name: name, mod: "gpiozero", props: {}, methods: {}, base: base ? base.cls : null, repr: devRepr };
      if (base) { for (var k in base.cls.props) c.props[k] = base.cls.props[k]; for (k in base.cls.methods) c.methods[k] = base.cls.methods[k]; if (base.cls.items) c.items = base.cls.items; c.repr = base.cls.repr; }
      for (var p in spec.props || {}) c.props[p] = spec.props[p];
      for (var m in spec.methods || {}) c.methods[m] = spec.methods[m];
      if (spec.repr) c.repr = spec.repr;
      if (spec.items) c.items = spec.items;
      var init = spec.init || (base && base.init);
      var ctor = function (args, kw, i2, line) {
        var o = new Obj(c);
        o.d = { born: it.now() };
        init(o, args, kw || {}, line);
        it.devices.push(o);
        return o;
      };
      ctor.cls = c; ctor.init = init; ctor.pyname = name; c.ctor = ctor;
      G[name] = ctor;
      return ctor;
    }
    var stop = function (o) { o.d.task = null; };
    var ro = function (fn) { return { get: fn }; };

    /* --- things a pin switches --- */
    var setOut = function (o, on) { o.d.on = !!on; gpio.write(o.d.pin, o.d.activeHigh ? (on ? 1 : 0) : (on ? 0 : 1)); };
    var blink = function (set) {
      return function (o, a, kw, i2, line) {
        var on = numArg(arg(a, kw, 0, "on_time", 1), "on_time", line), off = numArg(arg(a, kw, 1, "off_time", 1), "off_time", line), n = arg(a, kw, 2, "n", null), bg = arg(a, kw, 3, "background", true);
        var apply = function (s) { set(o, s); };
        if (truthy(bg)) { o.d.task = { kind: "blink", on: on, off: off, n: n == null ? null : +n, state: false, next: it.now(), set: apply }; return null; }
        o.d.task = null;
        return (function* () { for (var i = 0; n == null || i < +n; i++) { apply(true); yield on; apply(false); yield off; } return null; })();
      };
    };
    var OUT = cls("OutputDevice", {
      init: function (o, a, kw, line) {
        var d = o.d;
        d.pin = claim(it, o, arg(a, kw, 0, "pin", null), line);
        d.activeHigh = truthy(arg(a, kw, 1, "active_high", true));
        gpio.setup(d.pin, "out");
        setOut(o, truthy(arg(a, kw, 2, "initial_value", false)));
      },
      props: {
        value: { get: function (o) { return o.d.on ? 1 : 0; }, set: function (o, v) { stop(o); setOut(o, truthy(v)); } },
        is_active: ro(function (o) { return !!o.d.on; }),
        active_high: ro(function (o) { return o.d.activeHigh; }),
        pin: ro(function (o) { return "GPIO" + o.d.pin; }),
        closed: ro(function (o) { return !!o.d.closed; })
      },
      methods: {
        on: function (o) { stop(o); setOut(o, true); return null; },
        off: function (o) { stop(o); setOut(o, false); return null; },
        toggle: function (o) { stop(o); setOut(o, !o.d.on); return null; },
        blink: blink(setOut),
        close: closeDev
      }
    });
    cls("DigitalOutputDevice", {}, OUT);
    var LED = cls("LED", { props: { is_lit: ro(function (o) { return !!o.d.on; }) } }, OUT);
    cls("Buzzer", { methods: { beep: blink(setOut) } }, OUT);

    var setPwm = function (o, v) { o.d.v = v; o.d.on = v > 0; gpio.pwm(o.d.pin, o.d.activeHigh ? v : 1 - v, o.d.freq); };
    var PWM = cls("PWMOutputDevice", {
      init: function (o, a, kw, line) {
        var d = o.d;
        d.pin = claim(it, o, arg(a, kw, 0, "pin", null), line);
        d.activeHigh = truthy(arg(a, kw, 1, "active_high", true));
        d.freq = numArg(arg(a, kw, 3, "frequency", 100), "frequency", line);
        gpio.setup(d.pin, "out");
        setPwm(o, frac(arg(a, kw, 2, "initial_value", 0), line));
      },
      props: {
        value: { get: function (o) { return fl(o.d.v); }, set: function (o, v, i2, line) { stop(o); setPwm(o, frac(v, line)); } },
        is_active: ro(function (o) { return o.d.v > 0; }),
        frequency: { get: function (o) { return o.d.freq; }, set: function (o, v, i2, line) { o.d.freq = numArg(v, "frequency", line); setPwm(o, o.d.v); } },
        pin: ro(function (o) { return "GPIO" + o.d.pin; }), closed: ro(function (o) { return !!o.d.closed; })
      },
      methods: {
        on: function (o) { stop(o); setPwm(o, 1); return null; },
        off: function (o) { stop(o); setPwm(o, 0); return null; },
        toggle: function (o) { stop(o); setPwm(o, 1 - o.d.v); return null; },
        blink: blink(function (o, s) { setPwm(o, s ? 1 : 0); }),
        pulse: function (o, a, kw, i2, line) {
          var fi = numArg(arg(a, kw, 0, "fade_in_time", 1), "fade_in_time", line), fo = numArg(arg(a, kw, 1, "fade_out_time", 1), "fade_out_time", line), n = arg(a, kw, 2, "n", null), bg = arg(a, kw, 3, "background", true);
          var task = { kind: "pulse", in: fi, out: fo, n: n == null ? null : +n, t0: it.now(), set: function (v) { setPwm(o, Math.max(0, Math.min(1, v))); } };
          o.d.task = task;
          if (truthy(bg)) return null;
          return (function* () { while (o.d.task === task) yield 0.01; return null; })();
        },
        close: closeDev
      }
    });
    cls("PWMLED", { props: { is_lit: ro(function (o) { return o.d.v > 0; }) } }, PWM);

    /* --- things a pin listens to --- */
    var active = function (o) { var v = gpio.read(o.d.pin); return o.d.pullUp ? !v : !!v; };
    var cbProp = function (key) { return { get: function (o) { return o.d[key] || null; }, set: function (o, v, i2, line) { if (v !== null && typeof v !== "function" && !(v instanceof Fn)) throw new PyErr("BadEventHandler", "value must be None or a callable", line); o.d[key] = v; } }; };
    var waitFor = function (want) {
      return function* (o, a, kw, i2, line) {
        var to = arg(a, kw, 0, "timeout", null), t0 = it.now();
        while (active(o) !== want) {
          if (o.d.closed) throw closedErr(o, line);
          if (to != null && it.now() - t0 >= nv(to)) return false;
          yield 0.01;
        }
        return true;
      };
    };
    function input(name, o2) {
      var props = {
        value: ro(function (o) { return active(o) ? 1 : 0; }), is_active: ro(active),
        pull_up: ro(function (o) { return o.d.pullUp; }), pin: ro(function (o) { return "GPIO" + o.d.pin; }), closed: ro(function (o) { return !!o.d.closed; }),
        when_activated: cbProp("whenOn"), when_deactivated: cbProp("whenOff")
      };
      var methods = { wait_for_active: waitFor(true), wait_for_inactive: waitFor(false), close: closeDev };
      props[o2.is] = ro(active);
      props[o2.onCb] = cbProp("whenOn"); props[o2.offCb] = cbProp("whenOff");
      methods[o2.waitOn] = waitFor(true); methods[o2.waitOff] = waitFor(false);
      if (o2.held) {
        props.when_held = cbProp("whenHeld");
        props.hold_time = { get: function (o) { return fl(o.d.holdTime); }, set: function (o, v, i2, line) { o.d.holdTime = numArg(v, "hold_time", line); } };
        props.is_held = ro(function (o) { return !!o.d.held; });
      }
      return cls(name, {
        init: function (o, a, kw, line) {
          var d = o.d;
          d.pin = claim(it, o, arg(a, kw, 0, "pin", null), line);
          d.pullUp = truthy(arg(a, kw, 1, "pull_up", o2.pullUp));
          d.holdTime = numArg(arg(a, kw, 99, "hold_time", 1), "hold_time", line);
          gpio.setup(d.pin, d.pullUp ? "pu" : "pd");
          d.watch = active; d.last = null;
        },
        props: props, methods: methods
      });
    }
    input("DigitalInputDevice", { pullUp: false, is: "is_active", onCb: "when_activated", offCb: "when_deactivated", waitOn: "wait_for_active", waitOff: "wait_for_inactive" });
    input("Button", { pullUp: true, held: true, is: "is_pressed", onCb: "when_pressed", offCb: "when_released", waitOn: "wait_for_press", waitOff: "wait_for_release" });
    input("MotionSensor", { pullUp: false, is: "motion_detected", onCb: "when_motion", offCb: "when_no_motion", waitOn: "wait_for_motion", waitOff: "wait_for_no_motion" });
    input("LineSensor", { pullUp: false, is: "line_detected", onCb: "when_line", offCb: "when_no_line", waitOn: "wait_for_line", waitOff: "wait_for_no_line" });

    var dist = function (o) { var cm = gpio.echo(o.d.echo); return cm == null ? o.d.max : Math.min(o.d.max, cm / 100); };
    var inRange = function (o) { return dist(o) <= o.d.thr; };
    var waitRange = function (want) { return function* (o, a, kw) { var to = arg(a, kw, 0, "timeout", null), t0 = it.now(); while (inRange(o) !== want) { if (to != null && it.now() - t0 >= nv(to)) return false; yield 0.02; } return true; }; };
    cls("DistanceSensor", {
      init: function (o, a, kw, line) {
        var d = o.d;
        d.echo = claim(it, o, arg(a, kw, 0, "echo", null), line);
        d.trig = claim(it, o, arg(a, kw, 1, "trigger", null), line);
        d.pin = d.echo;
        d.max = numArg(arg(a, kw, 99, "max_distance", 1), "max_distance", line);
        d.thr = numArg(arg(a, kw, 99, "threshold_distance", 0.3), "threshold_distance", line);
        gpio.setup(d.trig, "out"); gpio.write(d.trig, 0); gpio.setup(d.echo, "in");
        d.watch = inRange; d.last = null;
      },
      repr: function (o) { return o.d.closed ? "<gpiozero.DistanceSensor object closed>" : "<gpiozero.DistanceSensor object on pin GPIO" + o.d.echo + ", pull_up=False, is_active=" + str(inRange(o)) + ">"; },
      props: {
        distance: ro(function (o) { return fl(Math.round(dist(o) * 10000) / 10000); }),
        value: ro(function (o) { return fl(dist(o) / o.d.max); }),
        max_distance: ro(function (o) { return fl(o.d.max); }),
        threshold_distance: { get: function (o) { return fl(o.d.thr); }, set: function (o, v, i2, line) { o.d.thr = numArg(v, "threshold_distance", line); } },
        in_range: ro(inRange), when_in_range: cbProp("whenOn"), when_out_of_range: cbProp("whenOff"),
        closed: ro(function (o) { return !!o.d.closed; })
      },
      methods: { wait_for_in_range: waitRange(true), wait_for_out_of_range: waitRange(false), close: closeDev }
    });

    /* --- servos and sounders --- */
    var servoSet = function (o, v) { o.d.v = v; gpio.servo(o.d.pin, v == null ? null : (v + 1) * 90); };
    var SERVO = cls("Servo", {
      init: function (o, a, kw, line) {
        o.d.pin = claim(it, o, arg(a, kw, 0, "pin", null), line);
        gpio.setup(o.d.pin, "out");
        var iv = arg(a, kw, 1, "initial_value", 0);
        servoSet(o, iv == null ? null : frac(iv, line, -1));
      },
      repr: function (o) { return o.d.closed ? "<gpiozero." + o.cls.name + " object closed>" : "<gpiozero." + o.cls.name + " object on pin GPIO" + o.d.pin + ">"; },
      props: {
        value: { get: function (o) { return o.d.v == null ? null : fl(o.d.v); }, set: function (o, v, i2, line) { servoSet(o, v == null ? null : frac(v, line, -1)); } },
        is_active: ro(function (o) { return o.d.v != null; }), pin: ro(function (o) { return "GPIO" + o.d.pin; }), closed: ro(function (o) { return !!o.d.closed; })
      },
      methods: {
        min: function (o) { servoSet(o, -1); return null; }, mid: function (o) { servoSet(o, 0); return null; }, max: function (o) { servoSet(o, 1); return null; },
        detach: function (o) { servoSet(o, null); return null; },
        close: function (o, a, kw, i2) { gpio.servo(o.d.pin, null); return closeDev(o, a, kw, i2); }
      }
    });
    cls("AngularServo", {
      init: function (o, a, kw, line) {
        var d = o.d;
        d.pin = claim(it, o, arg(a, kw, 0, "pin", null), line);
        d.lo = numArg(arg(a, kw, 2, "min_angle", -90), "min_angle", line); d.hi = numArg(arg(a, kw, 3, "max_angle", 90), "max_angle", line);
        gpio.setup(d.pin, "out");
        var ia = arg(a, kw, 1, "initial_angle", 0);
        servoSet(o, ia == null ? null : angleToV(o, ia, line));
      },
      props: {
        angle: { get: function (o) { return o.d.v == null ? null : fl(Math.round((o.d.lo + (o.d.v + 1) / 2 * (o.d.hi - o.d.lo)) * 1000) / 1000); }, set: function (o, v, i2, line) { servoSet(o, v == null ? null : angleToV(o, v, line)); } },
        min_angle: ro(function (o) { return o.d.lo; }), max_angle: ro(function (o) { return o.d.hi; })
      }
    }, SERVO);
    function angleToV(o, a, line) {
      var x = numArg(a, "angle", line);
      if (x < Math.min(o.d.lo, o.d.hi) || x > Math.max(o.d.lo, o.d.hi)) throw new PyErr("OutputDeviceBadValue", "AngularServo angle must be between " + o.d.lo + " and " + o.d.hi + ", or None", line);
      return (x - o.d.lo) / (o.d.hi - o.d.lo) * 2 - 1;
    }
    cls("TonalBuzzer", {
      init: function (o, a, kw, line) { o.d.pin = claim(it, o, arg(a, kw, 0, "pin", null), line); o.d.hz = 0; gpio.setup(o.d.pin, "out"); gpio.write(o.d.pin, 0); },
      repr: function (o) { return o.d.closed ? "<gpiozero.TonalBuzzer object closed>" : "<gpiozero.TonalBuzzer object on pin GPIO" + o.d.pin + ">"; },
      props: { is_active: ro(function (o) { return o.d.hz > 0; }), tone: ro(function (o) { return o.d.hz ? fl(o.d.hz) : null; }), pin: ro(function (o) { return "GPIO" + o.d.pin; }), closed: ro(function (o) { return !!o.d.closed; }) },
      methods: {
        play: function (o, a, kw, i2, line) { var t = a[0]; o.d.hz = t == null ? 0 : toneHz(t, line); gpio.tone(o.d.pin, o.d.hz); return null; },
        stop: function (o) { o.d.hz = 0; gpio.tone(o.d.pin, 0); return null; },
        close: function (o, a, kw, i2) { gpio.tone(o.d.pin, 0); return closeDev(o, a, kw, i2); }
      }
    });

    /* --- several pins acting as one thing --- */
    var kid = function (o, ctor, pin, kw, line) { var k = ctor([pin], kw || {}, it, line); (o.d.kids = o.d.kids || []).push(k); return k; };
    var all = function (fn) { return function (o) { o.d.task = null; o.d.kids.forEach(function (k) { k.d.task = null; fn(k); }); return null; }; };
    var boardRepr = function (o) { return o.d.closed ? "<gpiozero." + o.cls.name + " object closed>" : "<gpiozero." + o.cls.name + " object containing " + o.d.kids.length + " devices: " + (o.d.names || o.d.kids.map(function (k, i) { return "_" + i; })).join(", ") + ">"; };
    var BOARD = cls("LEDBoard", {
      init: function (o, a, kw, line) {
        var pwm = truthy(kw.pwm);
        if (!a.length) throw new PyErr("GPIOPinMissing", "No pins given", line);
        a.forEach(function (p) { kid(o, pwm ? G.PWMLED : LED, p, {}, line); });
      },
      repr: boardRepr,
      items: function (o) { return o.d.kids; },
      props: {
        value: { get: function (o) { return new Tuple(o.d.kids.map(function (k) { return k.cls.props.value.get(k); })); },
                 set: function (o, v, i2, line) { var l = listOf(v, line); if (l.length !== o.d.kids.length) throw new PyErr("ValueError", "value must be a tuple of " + o.d.kids.length + " values", line); o.d.task = null; o.d.kids.forEach(function (k, i) { k.cls.props.value.set(k, l[i], it, line); }); } },
        leds: ro(function (o) { return new Tuple(o.d.kids); }), is_active: ro(function (o) { return o.d.kids.some(function (k) { return k.d.on; }); }), is_lit: ro(function (o) { return o.d.kids.some(function (k) { return k.d.on; }); }),
        closed: ro(function (o) { return !!o.d.closed; })
      },
      methods: {
        on: all(function (k) { k.cls.methods.on(k); }), off: all(function (k) { k.cls.methods.off(k); }), toggle: all(function (k) { k.cls.methods.toggle(k); }),
        blink: blink(function (o, s) { o.d.kids.forEach(function (k) { k.cls.methods[s ? "on" : "off"](k); }); }),
        close: closeDev
      }
    });
    cls("TrafficLights", {
      init: function (o, a, kw, line) {
        var r = arg(a, kw, 0, "red", null), am = arg(a, kw, 1, "amber", "yellow" in kw ? kw.yellow : null), g = arg(a, kw, 2, "green", null);
        if (r == null || am == null || g == null) throw new PyErr("GPIOPinMissing", "red, amber and green pins must be provided", line);
        [r, am, g].forEach(function (p) { kid(o, LED, p, {}, line); });
        o.d.names = ["red", "amber", "green"];
      },
      props: { red: ro(function (o) { return o.d.kids[0]; }), amber: ro(function (o) { return o.d.kids[1]; }), yellow: ro(function (o) { return o.d.kids[1]; }), green: ro(function (o) { return o.d.kids[2]; }) }
    }, BOARD);
    cls("RGBLED", {
      init: function (o, a, kw, line) {
        var pins = [arg(a, kw, 0, "red", null), arg(a, kw, 1, "green", null), arg(a, kw, 2, "blue", null)], ah = { active_high: arg(a, kw, 3, "active_high", true) };
        if (pins.some(function (p) { return p == null; })) throw new PyErr("GPIOPinMissing", "red, green, and blue pins must be provided", line);
        pins.forEach(function (p) { kid(o, G.PWMLED, p, ah, line); });
        o.d.names = ["red", "green", "blue"];
      },
      repr: boardRepr,
      props: (function () {
        var col = { get: function (o) { return new Tuple(o.d.kids.map(function (k) { return fl(k.d.v); })); },
                    set: function (o, v, i2, line) { var l = listOf(v, line); if (l.length !== 3) throw new PyErr("OutputDeviceBadValue", "RGBLED value must have 3 components", line); o.d.task = null; l.forEach(function (x, i) { setPwm(o.d.kids[i], frac(x, line)); }); } };
        var one = function (i) { return { get: function (o) { return fl(o.d.kids[i].d.v); }, set: function (o, v, i2, line) { setPwm(o.d.kids[i], frac(v, line)); } }; };
        return { color: col, value: col, red: one(0), green: one(1), blue: one(2), is_lit: ro(function (o) { return o.d.kids.some(function (k) { return k.d.v > 0; }); }), is_active: ro(function (o) { return o.d.kids.some(function (k) { return k.d.v > 0; }); }), closed: ro(function (o) { return !!o.d.closed; }) };
      })(),
      methods: {
        on: function (o) { o.d.task = null; o.d.kids.forEach(function (k) { setPwm(k, 1); }); return null; },
        off: function (o) { o.d.task = null; o.d.kids.forEach(function (k) { setPwm(k, 0); }); return null; },
        toggle: function (o) { o.d.kids.forEach(function (k) { setPwm(k, 1 - k.d.v); }); return null; },
        blink: blink(function (o, s) { o.d.kids.forEach(function (k) { setPwm(k, s ? 1 : 0); }); }),
        close: closeDev
      }
    });

    cls("CPUTemperature", {
      init: function () {},
      repr: function (o) { return "<gpiozero.CPUTemperature temperature=" + (it.env.temp ? it.env.temp() : 45).toFixed(2) + ">"; },
      props: { temperature: ro(function () { return fl(Math.round((it.env.temp ? it.env.temp() : 45) * 1000) / 1000); }), value: ro(function () { return fl((it.env.temp ? it.env.temp() : 45) / 100); }) },
      methods: { close: function (o) { o.d.closed = true; return null; } }
    });

    G.pause = pauseFn(it);
    ["GPIOZeroError", "GPIOPinInUse", "PinInvalidPin", "BadPinFactory", "DeviceClosed", "OutputDeviceBadValue"].forEach(function (n) { G[n] = it.builtins[n]; });
    return G;
  };

  var NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function toneHz(t, line) {
    if (isNum(t)) return nv(t);
    var m = typeof t === "string" && /^([A-G])([#b]?)(\d)$/.exec(t);
    if (!m) throw new PyErr("ValueError", "invalid tone specification " + repr(t), line);
    var midi = 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
    return Math.round(440 * Math.pow(2, (midi - 69) / 12) * 100) / 100;
  }
  MODULES["gpiozero.tones"] = function () {
    var Tone = named(function (a, kw, it, line) { var v = arg(a, kw, 0, "value", "midi" in kw ? null : "frequency" in kw ? kw.frequency : "note" in kw ? kw.note : null); if ("midi" in kw) return fl(440 * Math.pow(2, (nv(kw.midi) - 69) / 12)); return fl(toneHz(v, line)); }, "Tone");
    return { Tone: Tone };
  };

  /* ------------------------------------------------------------ RPi.GPIO */

  MODULES.RPi = function (it) { return { GPIO: it.importModule("RPi.GPIO", 0) }; };
  MODULES["RPi.GPIO"] = function (it) {
    var gpio = it.gpio, R = it.rpi;
    var chan = function (c, line) {
      if (R.mode == null) throw new PyErr("RuntimeError", "Please set pin numbering mode using GPIO.setmode(GPIO.BOARD) or GPIO.setmode(GPIO.BCM)", line);
      if (!isInt(c)) throw new PyErr("ValueError", "Channel must be an integer or list/tuple of integers", line);
      var n = R.mode === "BOARD" ? Py.BOARD[+c] : +c;
      if (n == null || !gpio.valid(n)) throw new PyErr("ValueError", "The channel sent is invalid on a Raspberry Pi", line);
      return n;
    };
    var each = function (c, line) { return (Array.isArray(c) ? c : c instanceof Tuple ? c.v : [c]).map(function (x) { return [x, chan(x, line)]; }); };
    var warn = function (line, msg) { if (R.warn) it.env.out(it.file + ":" + line + ": RuntimeWarning: " + msg + "\n" + (it.lines[line - 1] ? "  " + it.lines[line - 1].trim() + "\n" : ""), "err"); };
    var PWMC = { name: "PWM", mod: "RPi.GPIO", props: {}, repr: function () { return "<RPi.GPIO.PWM object at 0x7f9c2a41b0>"; }, methods: {
      start: function (o, a, kw, i2, line) { o.d.dc = dc(a[0], line); o.d.run = true; gpio.pwm(o.d.pin, o.d.dc / 100, o.d.freq); return null; },
      ChangeDutyCycle: function (o, a, kw, i2, line) { o.d.dc = dc(a[0], line); if (o.d.run) gpio.pwm(o.d.pin, o.d.dc / 100, o.d.freq); return null; },
      ChangeFrequency: function (o, a, kw, i2, line) { o.d.freq = numArg(a[0], "frequency", line); if (o.d.freq <= 0) throw new PyErr("ValueError", "frequency must be greater than 0.0", line); if (o.d.run) gpio.pwm(o.d.pin, o.d.dc / 100, o.d.freq); return null; },
      stop: function (o) { o.d.run = false; gpio.pwm(o.d.pin, null); gpio.write(o.d.pin, 0); return null; }
    } };
    function dc(v, line) { var x = numArg(v, "dutycycle", line); if (x < 0 || x > 100) throw new PyErr("ValueError", "dutycycle must have a value from 0.0 to 100.0", line); return x; }
    var G = {
      BCM: 11, BOARD: 10, OUT: 0, IN: 1, HIGH: 1, LOW: 0, PUD_OFF: 20, PUD_DOWN: 21, PUD_UP: 22, RISING: 31, FALLING: 32, BOTH: 33, VERSION: "0.7.1", RPI_INFO: null,
      setmode: named(function (a, kw, i2, line) { if (a[0] !== 11 && a[0] !== 10) throw new PyErr("ValueError", "An invalid mode was passed to setmode()", line); R.mode = a[0] === 11 ? "BCM" : "BOARD"; return null; }, "setmode"),
      getmode: named(function () { return R.mode === "BCM" ? 11 : R.mode === "BOARD" ? 10 : null; }, "getmode"),
      setwarnings: named(function (a) { R.warn = truthy(a[0]); return null; }, "setwarnings"),
      setup: named(function (a, kw, i2, line) {
        var dir = arg(a, kw, 1, "direction", null), pud = arg(a, kw, 2, "pull_up_down", 20), init = arg(a, kw, 3, "initial", null);
        if (dir !== 0 && dir !== 1) throw new PyErr("ValueError", "An invalid direction was passed to setup()", line);
        each(a[0], line).forEach(function (c) {
          var n = c[1];
          if (gpio.busy(n) && !(n in R.chans)) warn(line, "This channel is already in use, continuing anyway.  Use GPIO.setwarnings(False) to disable warnings.");
          R.chans[n] = dir === 0 ? "out" : "in";
          gpio.setup(n, dir === 0 ? "out" : pud === 22 ? "pu" : pud === 21 ? "pd" : "in");
          if (dir === 0 && init != null) gpio.write(n, truthy(init) ? 1 : 0);
        });
        return null;
      }, "setup"),
      output: named(function (a, kw, i2, line) {
        var vals = Array.isArray(a[1]) ? a[1] : a[1] instanceof Tuple ? a[1].v : null;
        each(a[0], line).forEach(function (c, i) {
          if (R.chans[c[1]] !== "out") throw new PyErr("RuntimeError", "The GPIO channel has not been set up as an OUTPUT", line);
          gpio.write(c[1], truthy(vals ? vals[i % vals.length] : a[1]) ? 1 : 0);
        });
        return null;
      }, "output"),
      input: named(function (a, kw, i2, line) {
        var n = chan(a[0], line);
        if (!R.chans[n]) throw new PyErr("RuntimeError", "You must setup() the GPIO channel first", line);
        return gpio.read(n);
      }, "input"),
      cleanup: named(function (a, kw, i2, line) {
        var list = a.length ? each(a[0], line).map(function (c) { return c[1]; }) : Object.keys(R.chans).map(Number);
        if (!list.length && !a.length) warn(line, "No channels have been set up yet - nothing to clean up!  Try cleaning up at the end of your program instead!");
        list.forEach(function (n) { delete R.chans[n]; delete R.pwm[n]; gpio.release(n); });
        R.events = R.events.filter(function (e) { return list.indexOf(e.pin) < 0; });
        if (!a.length) R.mode = null;
        return null;
      }, "cleanup"),
      PWM: named(function (a, kw, i2, line) {
        var n = chan(a[0], line);
        if (R.chans[n] !== "out") throw new PyErr("RuntimeError", "You must setup() the GPIO channel as an output first", line);
        if (R.pwm[n]) throw new PyErr("RuntimeError", "A PWM object already exists for this GPIO channel", line);
        var f = numArg(a[1], "frequency", line);
        if (f <= 0) throw new PyErr("ValueError", "frequency must be greater than 0.0", line);
        var o = new Obj(PWMC); o.d = { pin: n, freq: f, dc: 0, run: false }; R.pwm[n] = o;
        return o;
      }, "PWM"),
      add_event_detect: named(function (a, kw, i2, line) {
        var n = chan(a[0], line);
        if (R.chans[n] !== "in") throw new PyErr("RuntimeError", "You must setup() the GPIO channel as an input first", line);
        if (a[1] !== 31 && a[1] !== 32 && a[1] !== 33) throw new PyErr("ValueError", "The edge must be set to RISING, FALLING or BOTH", line);
        R.events.push({ pin: n, chan: a[0], edge: a[1] === 31 ? "RISING" : a[1] === 32 ? "FALLING" : "BOTH", cb: arg(a, kw, 2, "callback", null), bounce: nv(arg(a, kw, 3, "bouncetime", 0)) / 1000, last: null, born: it.now(), at: -1, hit: false });
        return null;
      }, "add_event_detect"),
      event_detected: named(function (a, kw, i2, line) { var n = chan(a[0], line), hit = false; R.events.forEach(function (e) { if (e.pin === n && e.hit) { hit = true; e.hit = false; } }); return hit; }, "event_detected"),
      remove_event_detect: named(function (a, kw, i2, line) { var n = chan(a[0], line); R.events = R.events.filter(function (e) { return e.pin !== n; }); return null; }, "remove_event_detect"),
      wait_for_edge: named(function* (a, kw, i2, line) {
        var n = chan(a[0], line), to = "timeout" in kw ? nv(kw.timeout) / 1000 : null, t0 = it.now(), last = gpio.read(n);
        for (;;) {
          yield 0.01;
          var v = gpio.read(n);
          if (v !== last) { if (a[1] === 33 || (a[1] === 31 && v) || (a[1] === 32 && !v)) return a[0]; last = v; }
          if (to != null && it.now() - t0 >= to) return null;
        }
      }, "wait_for_edge")
    };
    return G;
  };
})(typeof window !== "undefined" ? window : globalThis);
