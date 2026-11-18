/* Chalk Circuit Lab — behaviours and scenarios.
 *
 * Two small languages, one expression engine.
 *
 * BEHAVIOUR — how a part you designed acts in a circuit. A few lines of
 * real electronics: resistors, capacitors, diodes, LEDs, transistors,
 * switches and sources between the part's pins, with values that can
 * follow voltages, time and the part's own settings. It compiles to the
 * same kind of model the built-in parts use, so it is solved with the rest
 * of the circuit, not faked beside it.
 *
 *     # a comparator with a push-pull output
 *     param ref = 2.5 V 0..5 "Trips at"
 *     out: V OUT GND = V(IN) > ref ? V(VCC) : 0  r 50
 *     R VCC GND 20k                       # it draws a little current
 *     glow = V(OUT) > 1 color #4cff8a
 *     show = V(IN) V
 *
 *   param NAME = VALUE [unit] [min..max] ["Label"]   a setting in the inspector
 *   state NAME = VALUE                    remembered between steps
 *   node NAME …                           inside the part, not a pin
 *   let NAME = EXPR                       worked out every step
 *   [name:] R a b OHMS | C a b FARADS | L a b HENRIES
 *   [name:] D a k | LED a k [colour]
 *   [name:] V p n = VOLTS [r OHMS]        a voltage that can follow anything
 *   [name:] I a b = AMPS                  a current pushed from a to b
 *   [name:] SW a b when COND [r OHMS]
 *   [name:] NPN c b e [beta N] | PNP c b e [beta N] | NMOS d g s [vth V]
 *   on rise COND: x = …; y = …           when COND turns true
 *   on fall COND: …   every SECONDS: …    when COND: … (every step)
 *   glow = EXPR [color #hex]   show = EXPR [unit]   sound = HERTZ
 *   warn "message" when COND [danger]
 *
 * Expressions: 10k 4k7 100n 2ms 1kHz · + - * / % ^ · < > <= >= == != · and
 * or not · c ? a : b · V(pin) V(a, b) I(element) · t dt pi · min max abs
 * clamp sqrt exp log sin cos round floor ceil sign step lerp map · square(f
 * [, duty]) sine(f) saw(f) tri(f) pulse(start, width) ramp(t0, t1) noise(a).
 *
 * SCENARIO — a test you can run on a whole circuit, with a stopwatch:
 *
 *     run 3s
 *     probe V(U1.3) "555 output"
 *     at 0.5s press SW1
 *     at 1s set R2.ohms = 4.7k
 *     at 2s expect V(D1.A) > 1.7 "the LED is lit"
 *     always V(U1.8) < 5.5 "never over-volted"
 *
 * Parts are named by their reference (R1, U2, SW1 — what the item list
 * shows) or by the name you gave them, then a pin: U1.OUT, Q1.C, C3.+.
 * A scenario runs headless in a fraction of a second and comes back as
 * traces and ticks, or plays out live on the bench.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab = root.ChalkLab || {};
  var B = L.Behave = {};

  /* ========================================================= EXPRESSIONS */

  var PRE = { p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9, meg: 1e6 };
  function err(msg, pos) { var e = new Error(msg); e.pos = pos; e.chalk = true; return e; }

  /* Read a number the way it is written on a part: 10k, 4k7, 100nF, 2ms, 1.5e3. */
  function readNumber(s, i) {
    var m = /^(\d+)([pnuµmkKMGR])(\d+)(?![A-Za-z0-9_])/.exec(s.slice(i));
    if (m) return { v: parseFloat(m[1] + "." + m[3]) * (m[2] === "R" ? 1 : PRE[m[2]]), end: i + m[0].length };
    m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (!m) return null;
    var v = parseFloat(m[0]), j = i + m[0].length;
    var u = /^(meg|[pnuµmkKMG])?(Hz|ohms?|Ω|[VAFHsW])?(?![A-Za-z0-9_])/.exec(s.slice(j));
    if (u && u[0]) { if (u[1]) v *= PRE[u[1]]; j += u[0].length; }
    return { v: v, end: j };
  }
  B.num = function (s) { var r = readNumber(String(s).trim(), 0); return r && r.end === String(s).trim().length ? r.v : NaN; };

  var RAW = { V: 1, I: 1, S: 1 };
  /* Parse one expression from s at i. Stops where the expression ends and
   * says where, so a line can carry more after it (a unit, "r 50", ":"). */
  function Parser(s, i) { this.s = s; this.i = i || 0; }
  Parser.prototype.ws = function () { while (this.i < this.s.length && /\s/.test(this.s.charAt(this.i))) this.i++; };
  Parser.prototype.peek = function (str) { this.ws(); return this.s.substr(this.i, str.length) === str; };
  Parser.prototype.word = function (w) {
    this.ws();
    if (this.s.substr(this.i, w.length) === w && !/[A-Za-z0-9_]/.test(this.s.charAt(this.i + w.length))) { this.i += w.length; return true; }
    return false;
  };
  Parser.prototype.eat = function (str) { if (this.peek(str)) { this.i += str.length; return true; } return false; };
  Parser.prototype.expr = function () {
    var c = this.or();
    if (this.eat("?")) {
      var a = this.expr();
      if (!this.eat(":")) throw err("A ‘?’ needs a ‘:’ after it — cond ? this : that.", this.i);
      var b = this.expr();
      return { k: "?", c: c, a: a, b: b };
    }
    return c;
  };
  Parser.prototype.or = function () { var a = this.and(); while (this.eat("||") || this.word("or")) a = { k: "or", a: a, b: this.and() }; return a; };
  Parser.prototype.and = function () { var a = this.cmp(); while (this.eat("&&") || this.word("and")) a = { k: "and", a: a, b: this.cmp() }; return a; };
  Parser.prototype.cmp = function () {
    var a = this.add();
    this.ws();
    var m = /^(<=|>=|==|!=|<|>)/.exec(this.s.slice(this.i));
    if (m) { this.i += m[0].length; return { k: "cmp", op: m[0], a: a, b: this.add() }; }
    return a;
  };
  Parser.prototype.add = function () {
    var a = this.mul();
    for (;;) {
      this.ws();
      var c = this.s.charAt(this.i);
      if ((c === "+" || c === "-") && this.s.charAt(this.i + 1) !== "=") { this.i++; a = { k: c, a: a, b: this.mul() }; } else return a;
    }
  };
  Parser.prototype.mul = function () {
    var a = this.unary();
    for (;;) {
      this.ws();
      var c = this.s.charAt(this.i);
      if ((c === "*" || c === "/" || c === "%") && this.s.charAt(this.i + 1) !== "=") { this.i++; a = { k: c, a: a, b: this.unary() }; } else return a;
    }
  };
  Parser.prototype.unary = function () {
    if (this.eat("-")) return { k: "neg", a: this.unary() };
    if (this.eat("+")) return this.unary();
    if (this.peek("!") && !this.peek("!=")) { this.i++; return { k: "not", a: this.unary() }; }
    if (this.word("not")) return { k: "not", a: this.unary() };
    var a = this.primary();
    if (this.eat("^")) return { k: "^", a: a, b: this.unary() };
    return a;
  };
  Parser.prototype.primary = function () {
    this.ws();
    var s = this.s, c = s.charAt(this.i), at = this.i;
    if (c === "(") { this.i++; var e = this.expr(); if (!this.eat(")")) throw err("A bracket was opened and never closed.", this.i); return e; }
    if (c === '"' || c === "'") {
      var q = c, j = this.i + 1, out = "";
      while (j < s.length && s.charAt(j) !== q) out += s.charAt(j++);
      if (j >= s.length) throw err("A quote was opened and never closed.", at);
      this.i = j + 1;
      return { k: "str", v: out };
    }
    if (/[0-9.]/.test(c)) {
      var n = readNumber(s, this.i);
      if (!n) throw err("I can't read a number here.", at);
      this.i = n.end;
      return { k: "num", v: n.v };
    }
    var m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(this.i));
    if (!m) throw err(c ? "I didn't expect ‘" + c + "’ here." : "Something is missing at the end.", at);
    this.i += m[0].length;
    var name = m[0];
    if (name === "true") return { k: "num", v: 1 };
    if (name === "false") return { k: "num", v: 0 };
    if (this.s.charAt(this.i) === "(" || (this.ws(), this.s.charAt(this.i) === "(")) {
      this.i++;
      if (RAW[name]) {
        /* V(…), I(…), S(…): the arguments are names of pins, which can be
         * anything a datasheet calls them: +, −, Q7', D0/RX, U1.OUT */
        var depth = 0, j2 = this.i, args = [], cur = "";
        for (; j2 < s.length; j2++) {
          var ch = s.charAt(j2);
          if (ch === "(") depth++;
          if (ch === ")") { if (!depth) break; depth--; }
          if (ch === "," && !depth) { args.push(cur.trim()); cur = ""; continue; }
          cur += ch;
        }
        if (j2 >= s.length) throw err(name + "( was never closed.", at);
        args.push(cur.trim());
        this.i = j2 + 1;
        args = args.map(function (a) { return a.replace(/^["']|["']$/g, ""); });
        if (!args[0]) throw err(name + "() needs " + (name === "V" ? "a pin" : name === "I" ? "an element" : "a part and a key") + " inside it.", at);
        return { k: "raw", f: name, args: args, pos: at };
      }
      var list = [];
      if (!this.eat(")")) {
        do { list.push(this.expr()); } while (this.eat(","));
        if (!this.eat(")")) throw err(name + "( was never closed.", this.i);
      }
      return { k: "call", f: name, args: list, pos: at };
    }
    return { k: "id", v: name, pos: at };
  };
  function parseExpr(s, i) { var p = new Parser(s, i || 0), e = p.expr(); p.ws(); return { e: e, end: p.i }; }
  function parseAll(s) {
    var r = parseExpr(s, 0);
    if (r.end < s.length) throw err("I didn't expect ‘" + s.slice(r.end, r.end + 12) + "’ here.", r.end);
    return r.e;
  }
  B.parse = parseAll;

  /* the clock functions read E.t, so a part using them is always alive */
  var TAU = Math.PI * 2;
  var FN = {
    min: [1, 9, function (E, a) { return Math.min.apply(null, a); }], max: [1, 9, function (E, a) { return Math.max.apply(null, a); }],
    abs: [1, 1, function (E, a) { return Math.abs(a[0]); }], sqrt: [1, 1, function (E, a) { return Math.sqrt(Math.max(0, a[0])); }],
    exp: [1, 1, function (E, a) { return Math.exp(Math.min(80, a[0])); }], log: [1, 1, function (E, a) { return Math.log(Math.max(1e-300, a[0])); }],
    log10: [1, 1, function (E, a) { return Math.log(Math.max(1e-300, a[0])) / Math.LN10; }], pow: [2, 2, function (E, a) { return Math.pow(a[0], a[1]); }],
    sin: [1, 1, function (E, a) { return Math.sin(a[0]); }], cos: [1, 1, function (E, a) { return Math.cos(a[0]); }], tan: [1, 1, function (E, a) { return Math.tan(a[0]); }],
    atan2: [2, 2, function (E, a) { return Math.atan2(a[0], a[1]); }],
    round: [1, 2, function (E, a) { var m = Math.pow(10, a[1] || 0); return Math.round(a[0] * m) / m; }], floor: [1, 1, function (E, a) { return Math.floor(a[0]); }], ceil: [1, 1, function (E, a) { return Math.ceil(a[0]); }],
    sign: [1, 1, function (E, a) { return a[0] > 0 ? 1 : a[0] < 0 ? -1 : 0; }], step: [1, 1, function (E, a) { return a[0] > 0 ? 1 : 0; }],
    clamp: [3, 3, function (E, a) { return Math.max(a[1], Math.min(a[2], a[0])); }], lerp: [3, 3, function (E, a) { return a[0] + (a[1] - a[0]) * a[2]; }],
    map: [5, 5, function (E, a) { return a[3] + (a[0] - a[1]) * (a[4] - a[3]) / ((a[2] - a[1]) || 1e-12); }],
    "if": [3, 3, function (E, a) { return a[0] ? a[1] : a[2]; }],
    square: [1, 2, function (E, a) { var ph = (E.t * a[0]) % 1; return ph < (a[1] == null ? 0.5 : a[1]) ? 1 : 0; }, 1],
    sine: [1, 2, function (E, a) { return Math.sin(TAU * a[0] * E.t + (a[1] || 0)); }, 1],
    saw: [1, 1, function (E, a) { return (E.t * a[0]) % 1; }, 1],
    tri: [1, 1, function (E, a) { var ph = (E.t * a[0]) % 1; return ph < 0.5 ? ph * 2 : 2 - ph * 2; }, 1],
    pulse: [2, 2, function (E, a) { return E.t >= a[0] && E.t < a[0] + a[1] ? 1 : 0; }, 1],
    ramp: [2, 2, function (E, a) { return Math.max(0, Math.min(1, (E.t - a[0]) / ((a[1] - a[0]) || 1e-9))); }, 1],
    noise: [0, 1, function (E, a) { return (Math.random() * 2 - 1) * (a[0] == null ? 1 : a[0]); }, 1],
    random: [0, 2, function (E, a) { var lo = a.length > 1 ? a[0] : 0, hi = a.length > 1 ? a[1] : a.length ? a[0] : 1; return lo + Math.random() * (hi - lo); }, 1]
  };
  B.FUNCTIONS = Object.keys(FN);
  var CONST = { pi: Math.PI, e: Math.E };

  /* Turn a parsed expression into a function of the environment E, checking
   * every name now so a typo is reported against its line, not mid-run.
   * scope(name) says whether a bare name is known; raw(node) builds V/I/S. */
  function build(node, scope, raw, flags) {
    switch (node.k) {
      case "num": var v = node.v; return function () { return v; };
      case "str": var sv = node.v; return function () { return sv; };
      case "id":
        if (node.v === "t") { flags.time = 1; return function (E) { return E.t; }; }
        if (node.v === "dt") return function (E) { return E.dt; };
        if (CONST[node.v] != null) { var cv = CONST[node.v]; return function () { return cv; }; }
        var kind = scope(node.v);
        if (!kind) throw err("I don't know what ‘" + node.v + "’ is. Declare it with param, state or let first.", node.pos);
        if (kind !== "param") flags.live = 1;
        var nm = node.v;
        return function (E) { return E.vars[nm]; };
      case "raw": flags.live = 1; return raw(node);
      case "call":
        var f = FN[node.f];
        if (!f) throw err("There is no function called " + node.f + "(). Try one of: " + B.FUNCTIONS.slice(0, 12).join(", ") + "…", node.pos);
        if (node.args.length < f[0] || node.args.length > f[1]) throw err(node.f + "() takes " + (f[0] === f[1] ? f[0] : f[0] + " to " + f[1]) + " value" + (f[1] === 1 ? "" : "s") + ".", node.pos);
        if (f[3]) flags.time = 1;
        var args = node.args.map(function (a) { return build(a, scope, raw, flags); }), fn = f[2];
        return function (E) { var vals = new Array(args.length); for (var i = 0; i < args.length; i++) vals[i] = args[i](E); return fn(E, vals); };
      case "?": var c = build(node.c, scope, raw, flags), a = build(node.a, scope, raw, flags), b = build(node.b, scope, raw, flags); return function (E) { return c(E) ? a(E) : b(E); };
      case "neg": var n1 = build(node.a, scope, raw, flags); return function (E) { return -n1(E); };
      case "not": var n2 = build(node.a, scope, raw, flags); return function (E) { return n2(E) ? 0 : 1; };
      case "and": var a1 = build(node.a, scope, raw, flags), b1 = build(node.b, scope, raw, flags); return function (E) { return a1(E) && b1(E) ? 1 : 0; };
      case "or": var a2 = build(node.a, scope, raw, flags), b2 = build(node.b, scope, raw, flags); return function (E) { return a2(E) || b2(E) ? 1 : 0; };
      case "cmp":
        var x = build(node.a, scope, raw, flags), y = build(node.b, scope, raw, flags), op = node.op;
        return function (E) {
          var p = x(E), q = y(E);
          switch (op) { case "<": return p < q ? 1 : 0; case ">": return p > q ? 1 : 0; case "<=": return p <= q ? 1 : 0; case ">=": return p >= q ? 1 : 0; case "==": return p === q || Math.abs(p - q) < 1e-9 ? 1 : 0; default: return p !== q && Math.abs(p - q) >= 1e-9 ? 1 : 0; }
        };
      default:
        var l = build(node.a, scope, raw, flags), r = build(node.b, scope, raw, flags), k = node.k;
        if (k === "+") return function (E) { var p = l(E), q = r(E); return typeof p === "string" || typeof q === "string" ? String(p) + String(q) : p + q; };
        if (k === "-") return function (E) { return l(E) - r(E); };
        if (k === "*") return function (E) { return l(E) * r(E); };
        if (k === "/") return function (E) { var q = r(E); return q === 0 ? (l(E) >= 0 ? 1e12 : -1e12) : l(E) / q; };
        if (k === "%") return function (E) { var q = r(E); return q ? l(E) % q : 0; };
        return function (E) { return Math.pow(l(E), r(E)); };
    }
  }
  function num(v) { v = +v; return isFinite(v) ? v : 0; }

  /* ===================================================== LINES AND WORDS */

  /* Comments start with # or // when a space follows (so #ff8800 is a colour). */
  function stripComment(line) {
    var q = null;
    for (var i = 0; i < line.length; i++) {
      var c = line.charAt(i);
      if (q) { if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if ((c === "#" && (i + 1 >= line.length || /\s/.test(line.charAt(i + 1))) && (i === 0 || /\s/.test(line.charAt(i - 1)))) || (c === "/" && line.charAt(i + 1) === "/" && (i === 0 || /\s/.test(line.charAt(i - 1))))) return line.slice(0, i);
    }
    return line;
  }
  B.lines = function (src) {
    return String(src || "").split(/\r?\n/).map(function (raw, i) { return { n: i + 1, text: stripComment(raw).trim(), raw: raw }; }).filter(function (l) { return l.text; });
  };
  function words(s) { var m = s.match(/"[^"]*"|'[^']*'|\S+/g); return m || []; }

  /* ========================================================== BEHAVIOUR */

  var ELEMENTS = { R: 2, C: 2, L: 2, D: 2, LED: 2, V: 2, I: 2, SW: 2, NPN: 3, PNP: 3, NMOS: 3 };
  B.ELEMENTS = Object.keys(ELEMENTS);
  var MAX_LINES = 240, MAX_ELEMENTS = 80;

  /* pins: a list of names, or {alias: pin} — pad numbers and names both work */
  function pinTable(pins) {
    var map = {}, low = {};
    if (Array.isArray(pins)) pins.forEach(function (p) { map[p] = p; });
    else if (pins) Object.keys(pins).forEach(function (k) { map[k] = pins[k]; });
    Object.keys(map).forEach(function (k) { if (low[k.toLowerCase()] == null) low[k.toLowerCase()] = map[k]; });
    return function (name) { return map[name] != null ? map[name] : low[String(name).toLowerCase()]; };
  }

  B.compile = function (src, pins) {
    var lines = B.lines(src), errors = [], pin = pinTable(pins);
    var params = [], states = [], lets = [], nodes = {}, elements = [], events = [], outputs = [], warns = [], names = {}, flags = { live: 0, time: 0 };
    var scope = function (n) { return names[n] || null; };
    var fail = function (ln, e) { errors.push({ line: ln.n, msg: e.chalk ? e.message : String(e.message || e) }); };
    if (lines.length > MAX_LINES) errors.push({ line: MAX_LINES, msg: "A behaviour can be at most " + MAX_LINES + " lines." });

    /* a terminal: a pin of the part or a node inside it */
    function term(ln, t) {
      var p = pin(t);
      if (p != null) return { pin: p };
      if (nodes[t]) return { node: t };
      throw err("‘" + t + "’ isn't one of this part's pins" + (Object.keys(nodes).length ? " or nodes" : "") + ". (Inside-the-part points need ‘node " + t + "’ first.)");
    }
    function raw(node) {
      var a = node.args;
      if (node.f === "V") {
        var p1 = termOf(a[0], node.pos), p2 = a[1] ? termOf(a[1], node.pos) : null;
        return function (E) { return E.V(p1) - (p2 ? E.V(p2) : 0); };
      }
      if (node.f === "I") {
        var who = a[0];
        if (!elements.some(function (e) { return e.name === who; })) throw err("I(" + who + "): there is no element called " + who + " above this line. Name one like ‘" + who + ": R A B 1k’.", node.pos);
        return function (E) { return E.I(who); };
      }
      throw err("S() is for scenarios, not part behaviours.", node.pos);
    }
    function termOf(t, pos) {
      var p = pin(t);
      if (p != null) return { pin: p };
      if (nodes[t]) return { node: t };
      throw err("V(" + t + "): ‘" + t + "’ isn't a pin of this part.", pos);
    }
    function expr(ln, s) {
      var f = { live: 0, time: 0 }, fn = build(parseAll(s), scope, raw, f);
      if (f.live) flags.live = 1; if (f.time) flags.time = 1;
      fn.live = !!(f.live || f.time);
      return fn;
    }
    function constant(ln, s) {
      var f = { live: 0, time: 0 }, fn = build(parseAll(s), function (n) { return names[n] === "param" ? "param" : null; }, function () { throw err("A starting value can't depend on voltages."); }, f);
      return fn;
    }
    function declare(ln, name, kind) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw err("‘" + name + "’ can't be a name: use letters, digits and _.");
      if (names[name] || FN[name] || CONST[name] || name === "t" || name === "dt") throw err("The name ‘" + name + "’ is already taken.");
      names[name] = kind;
    }
    /* "x = …; y += …" */
    function assigns(ln, s) {
      var out = [], parts = s.split(";");
      parts.forEach(function (one) {
        one = one.trim();
        if (!one) return;
        var m = /^([A-Za-z_]\w*)\s*([+\-*/]?=)\s*(.+)$/.exec(one);
        if (!m) throw err("After the colon, write what changes: name = value (or +=, -=).");
        if (names[m[1]] !== "state") throw err("‘" + m[1] + "’ isn't a state. Only a ‘state’ can be changed by an event.");
        out.push({ name: m[1], op: m[2], f: expr(ln, m[3]) });
      });
      if (!out.length) throw err("Nothing happens after the colon.");
      return out;
    }

    lines.forEach(function (ln) {
      try {
        var s = ln.text, w = words(s), kw = w[0], m;
        if (kw === "param") {
          m = /^param\s+([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(s);
          if (!m) throw err("Write it as: param name = value [unit] [min..max] [\"Label\"]");
          var pr = parseExpr(m[2], 0), rest = m[2].slice(pr.end).trim();
          var unit = "", min = null, max = null, label = "";
          var lm = /"([^"]*)"\s*$/.exec(rest); if (lm) { label = lm[1]; rest = rest.slice(0, lm.index).trim(); }
          var rm = /(-?[\d.]+[A-Za-zµ]*)\s*\.\.\s*(-?[\d.]+[A-Za-zµ]*)/.exec(rest);
          if (rm) { min = /^-/.test(rm[1]) ? -B.num(rm[1].slice(1)) : B.num(rm[1]); max = /^-/.test(rm[2]) ? -B.num(rm[2].slice(1)) : B.num(rm[2]); rest = (rest.slice(0, rm.index) + rest.slice(rm.index + rm[0].length)).trim(); }
          unit = rest.replace(/^["']|["']$/g, "").slice(0, 8);
          var val = build(pr.e, function (n) { return names[n] === "param" ? "param" : null; }, function () { throw err("A setting can't depend on voltages."); }, {})({ vars: paramDefaults(params), t: 0 });
          declare(ln, m[1], "param");
          if (typeof val !== "number" || !isFinite(val)) throw err("A setting needs a number.");
          if (min == null || !isFinite(min)) min = val > 0 ? 0 : val < 0 ? val * 2 : 0;
          if (max == null || !isFinite(max)) max = val > 0 ? val * 4 : val < 0 ? 0 : 1;
          if (max < min) { var tmp = min; min = max; max = tmp; }
          var stepv = Math.pow(10, Math.floor(Math.log10(Math.max(1e-12, (max - min) / 100))));
          params.push({ name: m[1], value: val, spec: { k: m[1], label: label || m[1], type: "range", min: min, max: max, step: stepv, unit: unit, live: true } });
          return;
        }
        if (kw === "state") {
          m = /^state\s+([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(s);
          if (!m) throw err("Write it as: state name = starting value");
          var init = constant(ln, m[2]);
          declare(ln, m[1], "state");
          states.push({ name: m[1], init: init });
          return;
        }
        if (kw === "node") {
          if (w.length < 2) throw err("Name the node: node mid");
          w.slice(1).forEach(function (nm) {
            if (!/^[A-Za-z_]\w*$/.test(nm)) throw err("‘" + nm + "’ can't be a node name.");
            if (pin(nm) != null) throw err("‘" + nm + "’ is already a pin.");
            nodes[nm] = 1;
          });
          return;
        }
        if (kw === "let") {
          m = /^let\s+([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(s);
          if (!m) throw err("Write it as: let name = expression");
          var lf = expr(ln, m[2]);
          declare(ln, m[1], "let");
          lets.push({ name: m[1], f: lf });
          return;
        }
        if (kw === "on" || kw === "every" || kw === "when") {
          var p0, kind;
          if (kw === "on") {
            if (w[1] !== "rise" && w[1] !== "fall") throw err("Write ‘on rise COND: …’ or ‘on fall COND: …’.");
            kind = w[1]; p0 = s.indexOf(w[1]) + w[1].length;
          } else { kind = kw; p0 = kw.length; }
          var cp = parseExpr(s, p0);
          if (s.charAt(cp.end) !== ":") throw err("Put a colon after the " + (kw === "every" ? "time" : "condition") + ", then what happens.");
          var cf = expr(ln, s.slice(p0, cp.end));
          events.push({ kind: kind, cond: cf, acts: assigns(ln, s.slice(cp.end + 1)), line: ln.n });
          flags.live = 1;
          if (kw === "every") flags.time = 1;
          return;
        }
        if (kw === "warn") {
          m = /^warn\s+("[^"]*"|'[^']*')\s+when\s+(.+?)(\s+(danger|info))?$/.exec(s);
          if (!m) throw err("Write it as: warn \"what's wrong\" when CONDITION [danger]");
          warns.push({ msg: m[1].slice(1, -1).slice(0, 200), cond: expr(ln, m[2]), level: m[4] === "danger" ? "danger" : m[4] === "info" ? "info" : "warn", code: "b" + ln.n });
          return;
        }
        if (/^(glow|show|sound)\s*=/.test(s)) {
          var which = /^(\w+)/.exec(s)[1], body = s.slice(s.indexOf("=") + 1), op = parseExpr(body, 0), extra = body.slice(op.end).trim(), o = { k: which, f: build(op.e, scope, raw, flags) };
          if (which === "glow") { var cm = /^colou?r\s+(#[0-9a-fA-F]{3,8}|[a-z]+)$/.exec(extra); if (extra && !cm) throw err("After glow, only ‘color #hex’ can follow."); if (cm) o.color = cm[1]; }
          else if (which === "show") o.unit = extra.replace(/^["']|["']$/g, "").slice(0, 8);
          else if (extra) throw err("I didn't expect ‘" + extra + "’ after the sound.");
          outputs.push(o);
          return;
        }
        /* an element, maybe with a name in front */
        var name = null;
        m = /^([A-Za-z_]\w*)\s*:\s*(\S+)/.exec(s);
        if (m && ELEMENTS[m[2]] != null) { name = m[1]; s = s.slice(s.indexOf(":") + 1).trim(); w = words(s); kw = w[0]; }
        if (ELEMENTS[kw] == null) throw err("I don't understand ‘" + ln.text.slice(0, 40) + "’. Lines start with param, state, node, let, on, every, when, warn, glow, show, sound or an element (" + B.ELEMENTS.join(" ") + ").");
        if (elements.length >= MAX_ELEMENTS) throw err("That's too many elements for one part.");
        var nT = ELEMENTS[kw];
        if (w.length < 1 + nT) throw err(kw + " needs " + nT + " pins: " + ({ R: "R a b ohms", C: "C a b farads", L: "L a b henries", D: "D anode cathode", LED: "LED anode cathode [colour]", V: "V plus minus = volts", I: "I from to = amps", SW: "SW a b when CONDITION", NPN: "NPN c b e", PNP: "PNP c b e", NMOS: "NMOS d g s" })[kw]);
        var terms = w.slice(1, 1 + nT).map(function (t) { return term(ln, t); });
        var tail = s.slice(s.indexOf(w[nT]) + w[nT].length).trim();
        /* find the tail properly even when two pins have the same text */
        var cut = 0, sw = s;
        for (var q = 0; q <= nT; q++) { var at = sw.indexOf(w[q], cut); cut = at + w[q].length; }
        tail = s.slice(cut).trim();
        if (!name) { var k = 1; while (elements.some(function (e) { return e.name === kw + k; }) || names[kw + k]) k++; name = kw + k; }
        else if (elements.some(function (e) { return e.name === name; })) throw err("There's already an element called " + name + ".");
        var el = { kind: kw, name: name, terms: terms, line: ln.n };
        if (kw === "R" || kw === "C" || kw === "L") {
          if (!tail) throw err(kw + " needs a value: " + kw + " a b " + (kw === "R" ? "10k" : kw === "C" ? "100n" : "10m"));
          el.val = expr(ln, tail);
        } else if (kw === "D") { if (tail) throw err("A diode is just D anode cathode."); }
        else if (kw === "LED") {
          var col = tail || "red";
          if (!L.LED_COLORS || !L.LED_COLORS[col]) throw err("LED colours: " + (L.LED_COLORS ? Object.keys(L.LED_COLORS).join(", ") : "red, green, blue…") + ".");
          el.color = col;
        } else if (kw === "V" || kw === "I") {
          if (tail.charAt(0) !== "=") throw err(kw + " needs ‘= value’: " + (kw === "V" ? "V OUT GND = 5" : "I A B = 1m"));
          var vp = parseExpr(tail, 1), vrest = tail.slice(vp.end).trim();
          el.val = expr(ln, tail.slice(1, vp.end));
          if (kw === "V") { var rm2 = /^r\s+(.+)$/.exec(vrest); if (vrest && !rm2) throw err("After the value, only ‘r OHMS’ (its inner resistance) can follow."); el.r = rm2 ? expr(ln, rm2[1]) : null; }
          else if (vrest) throw err("I didn't expect ‘" + vrest + "’ after the current.");
        } else if (kw === "SW") {
          var sm = /^when\s+(.+?)(\s+r\s+(\S+))?$/.exec(tail);
          if (!sm) throw err("Write it as: SW a b when CONDITION [r ohms]");
          el.cond = expr(ln, sm[1]); el.r = sm[3] ? expr(ln, sm[3]) : null;
        } else {
          var om = /^(beta|vth|kp)\s+(.+)$/.exec(tail);
          if (tail && !om) throw err("After the pins, only " + (kw === "NMOS" ? "‘vth VOLTS’" : "‘beta N’") + " can follow.");
          el.opt = om ? { k: om[1], f: constant(ln, om[2]) } : null;
        }
        elements.push(el);
        names[name] = names[name] || null;
      } catch (e) { fail(ln, e); }
    });
    if (!elements.length && !errors.length) errors.push({ line: 0, msg: "There's nothing between the pins yet. Add at least one element — R VCC GND 10k, say — so the part does something." });
    var result = { ok: !errors.length, errors: errors, params: params, elements: elements.map(function (e) { return { kind: e.kind, name: e.name, line: e.line }; }) };
    if (!result.ok) return result;
    result.model = makeModel({ params: params, states: states, lets: lets, nodes: nodes, elements: elements, events: events, outputs: outputs, warns: warns, flags: flags });
    result.summary = summarise(elements, params, events, outputs);
    return result;
  };
  function paramDefaults(params) { var o = {}; params.forEach(function (p) { o[p.name] = p.value; }); return o; }
  function summarise(els, params, events, outputs) {
    var c = {};
    els.forEach(function (e) { c[e.kind] = (c[e.kind] || 0) + 1; });
    var NAMES = { R: "resistor", C: "capacitor", L: "inductor", D: "diode", LED: "LED", V: "source", I: "current source", SW: "switch", NPN: "NPN transistor", PNP: "PNP transistor", NMOS: "MOSFET" };
    var bits = Object.keys(c).map(function (k) { return c[k] + " " + NAMES[k] + (c[k] > 1 ? (/s$/.test(NAMES[k]) ? "es" : "s") : ""); });
    if (params.length) bits.push(params.length + " setting" + (params.length > 1 ? "s" : ""));
    if (events.length) bits.push(events.length + " event" + (events.length > 1 ? "s" : ""));
    return bits.join(", ") + (outputs.length ? "; shows " + outputs.map(function (o) { return o.k; }).join(", ") : "");
  }

  /* The compiled behaviour, as a simulator model. Values that follow the
   * circuit are read from the last solution in pre() — a millisecond
   * behind, which is what makes them stable — and events and what the eye
   * sees are worked out after the solve, in post(). */
  function makeModel(c) {
    var K = L.SimKit;
    var hasStore = c.elements.some(function (e) { return e.kind === "C" || e.kind === "L"; });
    var leds = c.elements.filter(function (e) { return e.kind === "LED"; });
    var glowOut = c.outputs.filter(function (o) { return o.k === "glow"; })[0];
    var model = {
      dynamic: !!(hasStore || c.flags.live || c.flags.time || c.states.length || c.events.length),
      behave: true,
      build: function (b, pr) {
        var m = { el: {}, list: [], nodes: {}, vars: {}, last: {}, next: {}, store: [] };
        var tname = function (t) { return t.pin != null ? t.pin : b.node(t.node); };
        c.elements.forEach(function (e) {
          var dev;
          switch (e.kind) {
            case "R": case "V": case "I": case "SW": dev = new K.Norton(1e-6, 0); break;
            case "C": dev = new K.Cap(1e-6); m.store.push(dev); break;
            case "L": dev = new K.Ind(1e-3); m.store.push(dev); break;
            case "D": dev = new K.Diode(7e-9, 1.7 * K.VT); break;
            case "LED": dev = K.ledDiode(e.color); break;
            case "NPN": dev = new K.BJT(1, 150); break;
            case "PNP": dev = new K.BJT(-1, 150); break;
            default: dev = new K.MOS(1.8, 20);
          }
          b.add(dev, e.terms.map(tname));
          e.terms.forEach(function (t, k) { if (t.node) m.nodes[t.node] = dev.n[k]; });
          m.el[e.name] = dev;
          m.list.push({ e: e, d: dev });
        });
        /* a part with a node only reached through its own MOSFET gate or
         * capacitor would float: tie every inner node down very lightly */
        Object.keys(c.nodes).forEach(function (nm) { if (m.nodes[nm] == null) return; var d = new K.Norton(1e-9, 0); b.add(d, [b.node(nm), c.elements[0].terms[0].pin != null ? c.elements[0].terms[0].pin : b.node(c.elements[0].terms[0].node)]); });
        reset(m, pr);
        return m;
      },
      pre: function (m, ctx) {
        var E = env(m, ctx);
        lets(E);
        for (var i = 0; i < m.list.length; i++) {
          var it = m.list[i], e = it.e, d = it.d, v;
          switch (e.kind) {
            case "R": K.setR(d, Math.max(1e-3, Math.abs(num(e.val(E))))); break;
            case "C": d.c = Math.max(1e-15, Math.abs(num(e.val(E)))); break;
            case "L": d.l = Math.max(1e-12, Math.abs(num(e.val(E)))); break;
            case "V": v = num(e.val(E)); K.setV(d, v, e.r ? Math.max(1e-3, num(e.r(E))) : 1); break;
            case "I": d.gv = 1e-10; d.is = num(e.val(E)); break;
            case "SW": if (e.cond(E)) K.setR(d, e.r ? Math.max(1e-3, num(e.r(E))) : 0.02); else { d.gv = K.G_OFF; d.is = 0; } break;
            case "NPN": case "PNP": if (e.opt) d.bf = Math.max(1, num(e.opt.f(E))); break;
            case "NMOS": if (e.opt) { if (e.opt.k === "vth") d.vth = num(e.opt.f(E)); else d.kp = Math.max(1e-3, num(e.opt.f(E))); } break;
          }
        }
      },
      post: function (m, ctx) {
        var E = env(m, ctx), st = ctx.st, i;
        lets(E);
        for (i = 0; i < c.events.length; i++) {
          var ev = c.events[i], fire = false;
          if (ev.kind === "every") {
            var per = Math.max(0.001, num(ev.cond(E)));
            if (m.next[i] == null) m.next[i] = E.t + per;
            if (E.t >= m.next[i]) { fire = true; m.next[i] += per; if (m.next[i] < E.t) m.next[i] = E.t + per; }
          } else {
            var now = !!ev.cond(E), was = m.last[i];
            m.last[i] = now;
            fire = ev.kind === "when" ? now : ev.kind === "rise" ? now && was === false : !now && was === true;
          }
          if (fire) ev.acts.forEach(function (a) {
            var x = a.f(E), cur = m.vars[a.name];
            m.vars[a.name] = a.op === "=" ? x : a.op === "+=" ? num(cur) + num(x) : a.op === "-=" ? num(cur) - num(x) : a.op === "*=" ? num(cur) * num(x) : num(cur) / (num(x) || 1);
          });
        }
        if (c.events.length) lets(E);
        /* LEDs light themselves, as on the bench */
        var lit = 0, litCol = null;
        leds.forEach(function (e) {
          var ia = K.iThrough(m.el[e.name]);
          var bri = K.ledLook(ia, ctx, "ia_" + e.name);
          if (bri > lit) { lit = bri; litCol = L.LED_COLORS[e.color] ? L.LED_COLORS[e.color].light : "#ff4a3a"; }
          if (ia > 0.04) K.warn(ctx, "danger", "led_" + e.name, "Too much current through " + e.name + ": " + L.si(ia, "A") + ". An LED wants about 20 mA.");
        });
        if (glowOut) { st.glow = Math.max(0, Math.min(1.4, num(glowOut.f(E)))); st.glowColor = glowOut.color || litCol || "#ffd36b"; }
        else if (leds.length) { st.glow = lit; st.glowColor = litCol; }
        st.b = st.glow;
        for (i = 0; i < c.outputs.length; i++) {
          var o = c.outputs[i];
          if (o.k === "show") {
            var sv = o.f(E);
            var sm = typeof sv === "string" ? 0 : K.smooth(st, "show_", +sv, ctx);
            if (Math.abs(sm) < 1e-6) sm = 0;
            st.show = typeof sv === "string" ? sv.slice(0, 24) : isFinite(sv) ? (o.unit ? L.si(sm, o.unit) : fmt(sm)) : "";
          } else if (o.k === "sound") { var hz = num(o.f(E)); st.sound = hz > 20 ? Math.min(12000, hz) : 0; }
        }
        for (i = 0; i < c.warns.length; i++) { var w = c.warns[i]; if (w.cond(E)) K.warn(ctx, w.level, w.code, w.msg); }
        st.i = m.list.length ? K.iThrough(m.list[0].d) : 0;
        st.vars = m.vars;
      },
      commit: function (m) { for (var i = 0; i < m.store.length; i++) m.store[i].commit(); },
      reset: function (m) { reset(m, m.pr); }
    };
    function reset(m, pr) {
      m.pr = pr;
      m.vars = {}; m.last = {}; m.next = {};
      c.params.forEach(function (p) { m.vars[p.name] = pr && pr[p.name] != null ? +pr[p.name] : p.value; });
      c.states.forEach(function (s) { m.vars[s.name] = s.init({ vars: m.vars, t: 0 }); });
    }
    function env(m, ctx) {
      var pr = ctx.props;
      c.params.forEach(function (p) { if (pr[p.name] != null) m.vars[p.name] = +pr[p.name]; });
      return {
        vars: m.vars, t: ctx.sim.t, dt: isFinite(ctx.dt) ? ctx.dt : 0,
        V: function (t) { return t.pin != null ? ctx.pinV(t.pin) : ctx.v(m.nodes[t.node] || 0); },
        I: function (n) { var d = m.el[n]; return d ? K.iThrough(d) : 0; }
      };
    }
    function lets(E) { for (var i = 0; i < c.lets.length; i++) { var v = c.lets[i].f(E); E.vars[c.lets[i].name] = typeof v === "string" ? v : num(v); } }
    return model;
  }
  function fmt(v) { var a = Math.abs(v); return a >= 1000 || (a < 0.01 && a > 0) ? L.si ? L.si(v, "") : v.toExponential(2) : String(Math.round(v * 100) / 100); }

  /* ------------------------------------------------- starting points */

  B.TEMPLATES = [
    { id: "resistive", name: "Just a load", blurb: "Draws current between two pins, like a heater or a sensor's own consumption.", src: "# a fixed load between the first two pins\nparam ohms = 1k Ω 10..100k \"Resistance\"\nR {1} {2} ohms\nshow = V({1}, {2}) V" },
    { id: "led", name: "Light with a resistor", blurb: "An LED with its own series resistor, as on a module.", src: "node mid\nR {1} mid 330\nLED mid {2} green\n# it lights when about 2 V or more is across it" },
    { id: "logic", name: "Logic output", blurb: "Drives an output high or low from a condition on an input.", src: "param vcc = 5 V 1.8..5.5 \"Supply\"\nparam thresh = 2.5 V 0..5 \"Switches at\"\nout: V {2} {3} = V({1}, {3}) > thresh ? vcc : 0  r 50\nR {1} {3} 1M          # the input barely loads the source\nglow = V({2}, {3}) > vcc / 2 color #4cff8a" },
    { id: "sensor", name: "Sensor with a dial", blurb: "Puts out a voltage you set in the inspector — a temperature, a light level.", src: "param level = 50 % 0..100 \"Reading\"\nparam vcc = 3.3 V 1.8..5 \"Supply\"\nout: V {2} {3} = vcc * level / 100  r 1k\nR {1} {3} 10k\nshow = level \"%\"" },
    { id: "blinker", name: "Blinks by itself", blurb: "A clock: toggles an output every half second while powered.", src: "param period = 0.5 s 0.01..5 \"Half period\"\nstate on = 0\nevery period: on = 1 - on\nout: V {2} {3} = V({1}, {3}) > 2 and on ? V({1}, {3}) : 0  r 100\nR {1} {3} 5k\nglow = on and V({1}, {3}) > 2 color #ffd36b" },
    { id: "counter", name: "Counts pulses", blurb: "Counts rising edges on an input and shows the count.", src: "state count = 0\non rise V({1}, {3}) > 2.5: count += 1\nR {1} {3} 100k\nshow = count\nwarn \"Counted past 99 — it rolls over\" when count > 99 info" },
    { id: "regulator", name: "Regulator", blurb: "Holds an output steady below its input, with a dropout.", src: "param vout = 3.3 V 0.8..12 \"Output\"\nparam drop = 1.1 V 0.1..3 \"Dropout\"\nout: V {3} {2} = clamp(V({1}, {2}) - drop, 0, vout)  r 0.2\nR {1} {2} 20k\nwarn \"Input is too low to regulate\" when V({1}, {2}) < vout + drop and V({1}, {2}) > 0.5" },
    { id: "buzzer", name: "Makes a sound", blurb: "Beeps at a pitch you choose when powered.", src: "param hz = 2k Hz 100..8k \"Pitch\"\nR {1} {2} 220\nsound = V({1}, {2}) > 2 ? hz : 0\nglow = V({1}, {2}) > 2 color #ff9a3a" }
  ];
  /* A template written for these pins: {1} {2} {3} are the first three. */
  B.template = function (id, pinNames) {
    var tp = B.TEMPLATES.filter(function (x) { return x.id === id; })[0] || B.TEMPLATES[0];
    var names = (pinNames || []).map(function (n) { return /^[A-Za-z_][A-Za-z0-9_]*$|^\d+$/.test(n) ? n : n; });
    var gnd = names.filter(function (n) { return /^(gnd|vss|0v|-|−|ground|agnd|dgnd)$/i.test(n); })[0];
    var vcc = names.filter(function (n) { return /^(vcc|vdd|vin|v\+|\+|5v|3v3|vbus|vs)$/i.test(n); })[0];
    var rest = names.filter(function (n) { return n !== gnd && n !== vcc; });
    var pick = [vcc || rest.shift() || names[0] || "1", rest.shift() || names[1] || "2", gnd || rest.shift() || names[2] || names[1] || "3"];
    if (tp.id === "resistive" || tp.id === "led" || tp.id === "buzzer") pick = [vcc || names[0] || "1", gnd || names[1] || "2", ""];
    if (tp.id === "regulator") pick = [vcc || names[0] || "1", gnd || names[1] || "2", rest[0] || names[2] || "3"];
    return tp.src.replace(/\{(\d)\}/g, function (_, k) { return pick[k - 1]; });
  };

  /* Without the AI: a reasonable behaviour from what the part is called. */
  B.guess = function (desc, pinNames) {
    var t = String(desc || "").toLowerCase();
    var id = /led|light|lamp|indicator/.test(t) ? "led" : /buzz|beep|piezo|speaker|sound/.test(t) ? "buzzer" : /regulat|ldo|buck|converter|7805|1117/.test(t) ? "regulator" :
      /count|tally|pulse count/.test(t) ? "counter" : /blink|oscillat|clock|timer|flash/.test(t) ? "blinker" : /sensor|temp|light level|humid|pressure|gas|adc|potentio/.test(t) ? "sensor" :
      /gate|logic|comparat|schmitt|buffer|driver|switch/.test(t) ? "logic" : "resistive";
    return { id: id, src: B.template(id, pinNames) };
  };

  /* ============================================================ SCENARIOS */

  var S = L.Scenario = {};
  var MAX_RUN = 30;

  S.parse = function (src) {
    var lines = B.lines(src), out = { duration: 2, probes: [], steps: [], checks: [], title: "", errors: [] };
    var noRaw = function () { return function () { return 0; }; };
    var checkExpr = function (s) { build(parseAll(s), function () { return "param"; }, noRaw, {}); return s; };
    var time = function (s) { var v = B.num(s); if (!isFinite(v) || v < 0) throw err("‘" + s + "’ isn't a time. Write 0.5s, 200ms or 2."); return v; };
    lines.forEach(function (ln) {
      try {
        var s = ln.text, m;
        if ((m = /^title\s+"([^"]*)"$/.exec(s))) { out.title = m[1].slice(0, 80); return; }
        if ((m = /^run\s+(\S+)$/.exec(s))) { out.duration = Math.min(MAX_RUN, Math.max(0.05, time(m[1]))); return; }
        if ((m = /^probe\s+(.+?)(\s+"([^"]*)")?$/.exec(s))) { out.probes.push({ expr: checkExpr(m[1]), label: m[3] || m[1], line: ln.n }); return; }
        if ((m = /^always\s+(.+?)(\s+"([^"]*)")?$/.exec(s))) { out.checks.push({ always: true, expr: checkExpr(m[1]), msg: m[3] || m[1], line: ln.n }); return; }
        if ((m = /^(at|every)\s+(\S+)\s+(.+)$/.exec(s))) {
          var when = time(m[2]), what = m[3], step = { at: m[1] === "at" ? when : 0, every: m[1] === "every" ? Math.max(0.01, when) : 0, line: ln.n }, a;
          if (m[1] === "every" && !(when > 0)) throw err("every needs a time above zero.");
          if ((a = /^(press|release|toggle|click)\s+(\S+)$/.exec(what))) { step.act = a[1]; step.ref = a[2]; }
          else if ((a = /^set\s+([^\s.]+)\.(\w+)\s*=\s*(.+)$/.exec(what))) { step.act = "set"; step.ref = a[1]; step.key = a[2]; step.expr = checkExpr(a[3]); }
          else if ((a = /^expect\s+(.+?)(\s+"([^"]*)")?$/.exec(what))) { step.act = "expect"; step.expr = checkExpr(a[1]); step.msg = a[3] || a[1]; }
          else if ((a = /^(mark|note)\s+"([^"]*)"$/.exec(what))) { step.act = "mark"; step.msg = a[2]; }
          else throw err("After the time: press, release, toggle, set PART.setting = value, expect CONDITION or mark \"text\".");
          if (step.act === "expect" && step.every) out.checks.push({ every: step.every, expr: step.expr, msg: step.msg, line: ln.n }); else out.steps.push(step);
          return;
        }
        if ((m = /^expect\s+(.+?)(\s+"([^"]*)")?$/.exec(s))) { out.steps.push({ at: -1, act: "expect", expr: checkExpr(m[1]), msg: m[3] || m[1], line: ln.n }); return; }
        throw err("Lines start with title, run, probe, at, every, always or expect.");
      } catch (e) { out.errors.push({ line: ln.n, msg: e.message }); }
    });
    out.steps.forEach(function (st) { if (st.at === -1) st.at = out.duration; });
    out.steps.sort(function (a, b) { return a.at - b.at || a.line - b.line; });
    if (!out.probes.length && !out.steps.length && !out.checks.length && !out.errors.length) out.errors.push({ line: 0, msg: "Nothing to do yet: add a probe, an action or an expect." });
    return out;
  };

  /* Names in a scenario: R1 (the item list's reference), or the part's own name. */
  S.resolver = function (doc) {
    var ref = L.refdes ? L.refdes(doc) : {}, by = {};
    (doc.parts || []).forEach(function (p) {
      if (ref[p.id]) by[ref[p.id].toLowerCase()] = p;
      if (p.name) by[String(p.name).toLowerCase().replace(/\s+/g, "_")] = by[String(p.name).toLowerCase().replace(/\s+/g, "_")] || p;
      by[String(p.id).toLowerCase()] = by[String(p.id).toLowerCase()] || p;
    });
    return {
      part: function (name) { return by[String(name).toLowerCase()] || null; },
      ref: ref,
      pin: function (spec) {
        var dot = spec.indexOf(".");
        if (dot < 1) throw err("Name a pin as PART.PIN — U1.OUT, D1.A, C2.+");
        var p = by[spec.slice(0, dot).toLowerCase()];
        if (!p) throw err("There's no part called " + spec.slice(0, dot) + " on the bench.");
        var want = spec.slice(dot + 1), list = L.pinsOf(p).filter(function (q) { return !q.hole; });
        var hit = list.filter(function (q) { return q.name === want; })[0] || list.filter(function (q) { return String(q.name).toLowerCase() === want.toLowerCase(); })[0];
        if (!hit) {
          var d = L.def(p), lab = d && d.pins.filter(function (q) { return q.label && (q.label === want || q.label.split(" ")[0] === want); })[0];
          if (lab) hit = list.filter(function (q) { return q.name === lab.n; })[0];
        }
        if (!hit) throw err(spec.slice(0, dot) + " has no pin " + want + ". Its pins: " + list.map(function (q) { return q.name; }).slice(0, 20).join(", "));
        return p.id + ":" + hit.name;
      }
    };
  };

  /* Compile a scenario's expressions against a bench. */
  function scenarioFn(sc, R, sim) {
    var raw = function (node) {
      var a = node.args;
      if (node.f === "V") {
        var k1 = R.pin(a[0]), k2 = a[1] ? R.pin(a[1]) : null;
        return function () { return (sim.pinVolts(k1) || 0) - (k2 ? sim.pinVolts(k2) || 0 : 0); };
      }
      if (node.f === "I") { var k = R.pin(a[0]); return function () { return -(sim.pinCurrent(k) || 0); }; }
      var p = R.part(a[0]);
      if (!p) throw err("There's no part called " + a[0] + ".");
      var key = a[1] || "b";
      /* what the part is doing; failing that, one of its settings (a swept dial) */
      return function () { var st = sim.state[p.id] || {}, v = st[key]; if (v == null) v = L.propsOf(p)[key]; return typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "number" ? v : v == null ? 0 : parseFloat(v) || 0; };
    };
    return function (s) { return build(parseAll(s), function () { return null; }, raw, {}); };
  }

  /* Run a scenario. host is what it acts on:
   *   { doc, sim, press(part, down), set(part, key, value), toggle(part) }
   * Headless: S.run(doc, src) makes its own simulator and returns at once. */
  S.prepare = function (doc, src, host) {
    var sc = typeof src === "string" ? S.parse(src) : src;
    if (sc.errors.length) return { ok: false, errors: sc.errors, scenario: sc };
    var R = S.resolver(doc), mk = scenarioFn(sc, R, host.sim), errors = [];
    var tryLine = function (line, f) { try { return f(); } catch (e) { errors.push({ line: line, msg: e.message }); return null; } };
    var probes = sc.probes.map(function (p) { return { label: p.label, f: tryLine(p.line, function () { return mk(p.expr); }), pts: [] }; });
    var checks = sc.checks.map(function (c) { return { c: c, f: tryLine(c.line, function () { return mk(c.expr); }), fails: 0, first: null, worst: null, next: c.every || 0, n: 0 }; });
    var steps = sc.steps.map(function (st) {
      var o = { st: st, done: false, next: st.at };
      if (st.ref) o.part = tryLine(st.line, function () { var p = R.part(st.ref); if (!p) throw err("There's no part called " + st.ref + " on the bench."); return p; });
      if (st.act === "set") tryLine(st.line, function () {
        var d = L.def(o.part), sp = d && (d.spec || []).filter(function (x) { return x.k === st.key; })[0];
        if (!sp && !(d && d.props && st.key in d.props)) throw err(st.ref + " has no setting called ‘" + st.key + "’." + (d && d.spec && d.spec.length ? " It has: " + d.spec.map(function (x) { return x.k; }).join(", ") : ""));
        o.f = build(parseAll(st.expr), function () { return null; }, function () { throw err("A setting is a number, not a measurement."); }, {});
        o.spec = sp;
      });
      if (st.act === "expect") o.f = tryLine(st.line, function () { return mk(st.expr); });
      if ((st.act === "press" || st.act === "release" || st.act === "click") && o.part && !(L.def(o.part) || {}).press) errors.push({ line: st.line, msg: st.ref + " isn't something you can press." });
      if (st.act === "toggle" && o.part && !(L.def(o.part) || {}).toggle) errors.push({ line: st.line, msg: st.ref + " has nothing to toggle." });
      return o;
    });
    if (errors.length) return { ok: false, errors: errors, scenario: sc };
    var t0 = null, results = [], marks = [], clicks = [];
    var runner = {
      ok: true, scenario: sc, probes: probes, results: results, marks: marks, done: false,
      tick: function (tAbs) {
        if (t0 == null) t0 = tAbs;
        var t = tAbs - t0, i;
        for (i = 0; i < clicks.length; i++) if (clicks[i] && t >= clicks[i].t) { host.press(clicks[i].part, false); clicks[i] = null; }
        steps.forEach(function (o) {
          if (o.done && !o.st.every) return;
          if (t + 1e-9 < o.next) return;
          var st = o.st;
          if (st.act === "press") host.press(o.part, true);
          else if (st.act === "release") host.press(o.part, false);
          else if (st.act === "click") { host.press(o.part, true); clicks.push({ part: o.part, t: t + 0.1 }); }
          else if (st.act === "toggle") host.toggle(o.part);
          else if (st.act === "set") { var v = o.f({ t: t, vars: {} }); if (o.spec && o.spec.type === "range") v = Math.max(o.spec.min, Math.min(o.spec.max, v)); host.set(o.part, st.key, v); }
          else if (st.act === "expect") { var got = o.f({ t: t, vars: {} }); results.push({ line: st.line, t: t, msg: st.msg, pass: !!got }); }
          else if (st.act === "mark") marks.push({ t: t, msg: st.msg });
          if (st.every) o.next += st.every; else o.done = true;
        });
        var E = { t: t, vars: {} };
        if (t > 0.02) checks.forEach(function (ck) {
          if (ck.c.every) { if (t + 1e-9 < ck.next) return; ck.next += ck.c.every; }
          var good = !!ck.f(E);
          ck.n++;
          if (!good) { ck.fails++; if (ck.first == null) ck.first = t; }
        });
        probes.forEach(function (p) { var v = +p.f(E); p.pts.push([t, isFinite(v) ? v : 0]); });
        if (t >= sc.duration - 1e-9 && !this.done) this.finish();
        return t;
      },
      finish: function () {
        this.done = true;
        clicks.forEach(function (c) { if (c) host.press(c.part, false); });
        checks.forEach(function (ck) { results.push({ line: ck.c.line, t: ck.first, msg: ck.c.msg, pass: ck.fails === 0 && ck.n > 0, always: true, fails: ck.fails, of: ck.n }); });
        results.sort(function (a, b) { return a.line - b.line; });
        probes.forEach(function (p) { p.pts = thin(p.pts, 600); var ys = p.pts.map(function (q) { return q[1]; }); p.min = Math.min.apply(null, ys); p.max = Math.max.apply(null, ys); p.end = ys[ys.length - 1]; });
        this.passed = results.filter(function (r) { return r.pass; }).length;
        this.failed = results.length - this.passed;
        return this;
      }
    };
    return runner;
  };
  function thin(pts, max) {
    if (pts.length <= max) return pts;
    var out = [], k = pts.length / max;
    for (var i = 0; i < max; i++) {
      var a = Math.floor(i * k), b = Math.min(pts.length, Math.floor((i + 1) * k)), lo = pts[a], hi = pts[a];
      for (var j = a; j < b; j++) { if (pts[j][1] < lo[1]) lo = pts[j]; if (pts[j][1] > hi[1]) hi = pts[j]; }
      if (lo[0] <= hi[0]) { out.push(lo); if (hi !== lo) out.push(hi); } else { out.push(hi); out.push(lo); }
    }
    return out;
  }

  /* Headless: a copy of the circuit, its own simulator, as fast as it goes. */
  S.run = function (doc, src, opt) {
    opt = opt || {};
    var copy = JSON.parse(JSON.stringify(doc)), sim = new L.Sim();
    sim.load(copy);
    var byId = {};
    copy.parts.forEach(function (p) { byId[p.id] = p; });
    var host = {
      doc: copy, sim: sim,
      press: function (p, down) { if (down) sim.pressed[p.id] = true; else delete sim.pressed[p.id]; },
      set: function (p, k, v) { p.props = p.props || {}; p.props[k] = v; var d = L.def(p), sp = d && (d.spec || []).filter(function (x) { return x.k === k; })[0]; if (sp && sp.rebuild) sim.invalidate(); },
      toggle: function (p) { var d = L.def(p); p.props = p.props || {}; p.props[d.toggle] = !L.propsOf(p)[d.toggle]; }
    };
    var r = S.prepare(copy, src, host);
    if (!r.ok) return r;
    var frame = opt.frame || 1 / 60, budget = opt.budgetMs || 4000, start = Date.now(), guard = 0;
    sim.reset();
    r.tick(0);
    while (!r.done) {
      var before = sim.t;
      sim.step(frame);
      if (sim.t <= before) sim.t = before + frame;
      r.tick(sim.t);
      if (++guard > 200000 || Date.now() - start > budget) { r.finish(); r.cut = sim.t; break; }
    }
    r.mcu = L.mcus ? L.mcus(copy).length > 0 : false;
    r.warnings = (sim.warnings || []).slice(0, 12);
    return r;
  };

  /* A scenario to start from, written for what is on the bench. */
  S.starter = function (doc) {
    var ref = L.refdes ? L.refdes(doc) : {}, lines = ["title \"My test\"", "run 2s"], acts = [], probes = 0;
    (doc.parts || []).forEach(function (p) {
      var d = L.def(p), r = ref[p.id];
      if (!d || !r || /^(breadboard|perfboard|stripboard)/.test(p.type)) return;
      if (/^(led|k_led)$/.test(p.type) && probes < 4) { lines.push("probe S(" + r + ", b) \"" + r + " brightness\""); probes++; }
      else if (/^(battery|psu|coin_cell)$/.test(p.type) && probes < 4) { lines.push("probe V(" + r + ".+, " + r + ".-) \"" + r + " volts\""); probes++; }
      if (d.press && acts.length < 4) { acts.push("at " + (0.5 + acts.length * 0.4) + "s press " + r, "at " + (0.8 + acts.length * 0.4) + "s release " + r); }
      if (d.toggle && acts.length < 4) acts.push("at 1s toggle " + r);
    });
    var led = (doc.parts || []).filter(function (p) { return p.type === "led"; })[0];
    lines = lines.concat(acts);
    if (led) lines.push("at 2s expect S(" + ref[led.id] + ", b) > 0.1 \"" + ref[led.id] + " is lit at the end\"");
    if (lines.length === 2) lines.push("# probe V(U1.OUT) \"output\"", "# at 0.5s press SW1", "# at 1s expect V(D1.A) > 1.8 \"LED on\"");
    return lines.join("\n");
  };
})(typeof window !== "undefined" ? window : globalThis);
