/* Chalk Circuit Lab — the Pi's calculators: bc and calc.
 *
 * Two of the calculators a real Raspberry Pi can apt install, sharing one
 * small language engine:
 *
 *   bc    GNU bc 1.07.1. Fixed-point decimals: every number carries a scale
 *         (digits after the point) and division stops at the global `scale`,
 *         so `7/2` is 3 until you say `scale=2`. `bc -l` loads the maths
 *         library: scale=20 and s() c() a() l() e(). ibase/obase, `last`,
 *         if/while/for, define with auto, print, quit — the parts lessons use.
 *   calc  apcalc 2.14. Exact fractions: `1/3*3` is 1, answers that do not end
 *         within 20 decimals print rounded with a ~ in front, results are
 *         indented by a tab, and sqrt() sin() ln() pi() … give 20 decimals.
 *
 * Numbers are BigInt, so 2^200 and 100 digits of pi come out right. Nothing
 * here uses eval: input is tokenised, parsed to a tree and walked.
 *
 *   var s = new PiCalc.Session("bc", { lib: true, out: fn, err: fn });
 *   r = yield* s.feed("scale=5; 22/7")   // generator: yields seconds of work
 *   r === "quit" when the input said quit / halt / exit
 *   s.pending()  a half-typed if/define/… is waiting for its next line
 *   s.reset()    forget it (Ctrl+C)
 *   s.errors     how many errors it has reported
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab = root.ChalkLab || {};
  var B = BigInt, Z = B(0), ONE = B(1), TWO = B(2), FIVE = B(5), TEN = B(10);
  var P10 = [];
  function p10(n) { if (n < 400) return P10[n] || (P10[n] = TEN ** B(n)); return TEN ** B(n); }
  function abs(n) { return n < Z ? -n : n; }
  function gcd(a, b) { a = abs(a); b = abs(b); while (b) { var t = a % b; a = b; b = t; } return a; }
  function bits(n) { return n === Z ? 0 : abs(n).toString(2).length; }
  function isqrt(n) {
    if (n < TWO) return n;
    var x = ONE << B(Math.ceil(bits(n) / 2) + 1), y;
    for (;;) { y = (x + n / x) >> ONE; if (y >= x) return x; x = y; }
  }

  /* A calculator error: shown, and the session carries on with the next line. */
  function Err(msg, kind) { this.msg = msg; this.kind = kind || "run"; }
  var MORE = { more: true };                    /* the input stops part-way through something */
  var BREAK = { brk: 1 }, CONTINUE = { cont: 1 };
  function Ret(v) { this.v = v; }
  function Quit() {}

  /* ------------------------------------------------- fixed-point maths
   * A value v stands for v / F, F = 10^P. Used for the functions that have
   * no exact answer; callers keep ~12 guard digits beyond what they show. */
  var FX = {
    exp: function (x, F) {
      var neg = x < Z, k = 0, sum = F, term = F, i = 1;
      if (neg) x = -x;
      while (x > F / B(8)) { x /= TWO; k++; }
      for (;;) { term = term * x / F / B(i++); if (term === Z) break; sum += term; }
      for (; k > 0; k--) sum = sum * sum / F;
      return neg ? F * F / sum : sum;
    },
    ln: function (x, F) {
      if (x <= Z) throw new Err("logarithm of a number that is not above 0");
      var k = 0, lim = F / B(8);
      while (abs(x - F) > lim) { x = isqrt(x * F); k++; }
      var y = (x - F) * F / (x + F), y2 = y * y / F, term = y, sum = Z, n = ONE;
      while (term !== Z) { sum += term / n; term = term * y2 / F; n += TWO; }
      return (sum * TWO) << B(k);
    },
    pi: function (F) {                          /* Machin: 16·atan(1/5) − 4·atan(1/239) */
      function atanInv(m) { m = B(m); var m2 = m * m, term = F / m, sum = Z, n = ONE, sg = ONE; while (term !== Z) { sum += sg * term / n; term /= m2; n += TWO; sg = -sg; } return sum; }
      return B(16) * atanInv(5) - B(4) * atanInv(239);
    },
    atan: function (x, F) {
      var neg = x < Z, inv = false, k = 0;
      if (neg) x = -x;
      if (x > F) { x = F * F / x; inv = true; }
      while (x > F / B(8)) { x = x * F / (F + isqrt((F + x * x / F) * F)); k++; }
      var x2 = x * x / F, term = x, sum = Z, n = ONE, sg = ONE;
      while (term !== Z) { sum += sg * term / n; term = term * x2 / F; n += TWO; sg = -sg; }
      sum = sum << B(k);
      if (inv) sum = FX.pi(F) / TWO - sum;
      return neg ? -sum : sum;
    },
    sin: function (x, F) {
      var pi = FX.pi(F), tp = TWO * pi;
      x = x % tp; if (x > pi) x -= tp; if (x < -pi) x += tp;
      var x2 = x * x / F, term = x, sum = Z, i = ONE;
      while (term !== Z) { sum += term; term = -term * x2 / F / ((i + ONE) * (i + TWO)); i += TWO; }
      return sum;
    },
    cos: function (x, F) { return FX.sin(x + FX.pi(F) / TWO, F); }
  };

  /* --------------------------------------------------------- bc numbers
   * {n, s}: the value n / 10^s. s is bc's "scale" of that number. */
  function D(n, s) { return { n: n, s: s }; }
  function up(a, s) { return a.n * p10(s - a.s); }                 /* s >= a.s */
  function cut(a, s) { return s >= a.s ? D(up(a, s), s) : D(a.n / p10(a.s - s), s); }
  var Dec = {
    zero: D(Z, 0), one: D(ONE, 0),
    of: function (b) { return D(b ? ONE : Z, 0); },
    lit: function (raw, st) {
      var base = st.ibase, dot = raw.indexOf("."), ip = dot < 0 ? raw : raw.slice(0, dot), fp = dot < 0 ? "" : raw.slice(dot + 1);
      var dig = function (ch) { var v = parseInt(ch, 16); return v >= base ? base - 1 : v; };   /* bc clamps a digit to ibase-1 */
      if (base === 10 && /^[0-9]*$/.test(ip + fp)) return D(B((ip + fp) || "0"), fp.length);
      if (ip.length === 1 && !fp) return D(B(parseInt(ip, 16)), 0);  /* a lone digit is its own value, whatever ibase is */
      var n = Z, i, bb = B(base);
      for (i = 0; i < ip.length; i++) n = n * bb + B(dig(ip[i]));
      if (!fp) return D(n, 0);
      var num = Z, den = ONE;
      for (i = 0; i < fp.length; i++) { num = num * bb + B(dig(fp[i])); den *= bb; }
      return D(n * p10(fp.length) + num * p10(fp.length) / den, fp.length);
    },
    isZero: function (a) { return a.n === Z; },
    neg: function (a) { return D(-a.n, a.s); },
    cmp: function (a, b) { var s = Math.max(a.s, b.s), x = up(a, s), y = up(b, s); return x < y ? -1 : x > y ? 1 : 0; },
    add: function (a, b) { var s = Math.max(a.s, b.s); return D(up(a, s) + up(b, s), s); },
    sub: function (a, b) { var s = Math.max(a.s, b.s); return D(up(a, s) - up(b, s), s); },
    mul: function (a, b, st) { return cut(D(a.n * b.n, a.s + b.s), Math.min(a.s + b.s, Math.max(st.scale, a.s, b.s))); },
    div: function (a, b, st) {
      if (b.n === Z) throw new Err("Divide by zero");
      var S = st.scale;
      return D(a.n * p10(S + b.s) / (b.n * p10(a.s)), S);
    },
    mod: function (a, b, st) {
      var q = Dec.div(a, b, st), r = Dec.sub(a, D(q.n * b.n, q.s + b.s));
      return cut(r, Math.max(st.scale + b.s, a.s));
    },
    pow: function (a, b, st) {
      if (b.s && b.n % p10(b.s) !== Z) st.warn("non-zero scale in exponent");
      var e = b.n / p10(b.s), neg = e < Z;
      if (neg) e = -e;
      if (a.n === Z) { if (neg) throw new Err("divide by zero"); return e === Z ? Dec.one : Dec.zero; }
      if (B(bits(a.n)) * e > B(200000)) throw new Err("exponent too large");
      var en = Number(e), r = D(a.n ** e, a.s * en);
      if (neg) return Dec.div(Dec.one, r, st);
      return cut(r, Math.min(a.s * en, Math.max(st.scale, a.s)));
    },
    sqrt: function (a, st) {
      if (a.n < Z) throw new Err("Square root of a negative number");
      var S = Math.max(st.scale, a.s);
      return D(isqrt(a.n * p10(2 * S - a.s)), S);
    },
    fx: function (a, P) { return a.s <= P ? a.n * p10(P - a.s) : a.n / p10(a.s - P); },
    unfx: function (v, P, S) { return D(v / p10(P - S), S); },
    int: function (a) { return a.n / p10(a.s); },
    fmt: function (a, st) {
      var ob = st.obase;
      if (a.n === Z) return "0";
      var neg = a.n < Z, n = neg ? -a.n : a.n, ip = n / p10(a.s), fr = n % p10(a.s), s;
      if (ob === 10) {
        s = a.s ? (ip === Z ? "" : ip.toString()) + "." + fr.toString().padStart(a.s, "0") : ip.toString();
      } else {
        var big = ob > 16, w = String(ob - 1).length, D16 = "0123456789ABCDEF", bo = B(ob);
        var dg = function (v) { return big ? " " + String(v).padStart(w, "0") : D16[v]; };
        var digs = [], x = ip;
        do { digs.unshift(dg(Number(x % bo))); x /= bo; } while (x > Z);
        s = (ip === Z && a.s ? "" : digs.join(""));
        if (a.s) {
          var den = p10(a.s), f = fr, out = "", got = ONE;
          while (got < den) { f *= bo; out += dg(Number(f / den)); f %= den; got *= bo; }
          s += (big ? " ." : ".") + out;
        }
      }
      s = (neg ? "-" : "") + s;
      if (s.length <= 69) return s;
      var rows = [];
      while (s.length > 69) { rows.push(s.slice(0, 69) + "\\"); s = s.slice(69); }
      rows.push(s);
      return rows.join("\n");
    }
  };

  /* ------------------------------------------------------- calc numbers
   * {p, q}: the exact fraction p / q, q > 0, in lowest terms. */
  function R(p, q) {
    if (q === Z) throw new Err("Division by zero");
    if (q < Z) { p = -p; q = -q; }
    var g = gcd(p, q);
    return g > ONE ? { p: p / g, q: q / g } : { p: p, q: q };
  }
  function floorDiv(a, b) { var q = a / b; if ((a % b !== Z) && ((a < Z) !== (b < Z))) q -= ONE; return q; }
  var DIG = 20, DEN = p10(DIG);
  var Rat = {
    zero: R(Z, ONE), one: R(ONE, ONE),
    of: function (b) { return R(b ? ONE : Z, ONE); },
    lit: function (raw) {
      if (/^0x/i.test(raw)) return R(B(raw), ONE);
      var m = /^(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw), fp = m[2] || "", ex = m[3] ? parseInt(m[3], 10) : 0;
      if (Math.abs(ex) > 10000) throw new Err("exponent too large");
      var p = B((m[1] + fp) || "0"), q = p10(fp.length);
      return ex >= 0 ? R(p * p10(ex), q) : R(p, q * p10(-ex));
    },
    isZero: function (a) { return a.p === Z; },
    neg: function (a) { return { p: -a.p, q: a.q }; },
    cmp: function (a, b) { var x = a.p * b.q, y = b.p * a.q; return x < y ? -1 : x > y ? 1 : 0; },
    add: function (a, b) { return R(a.p * b.q + b.p * a.q, a.q * b.q); },
    sub: function (a, b) { return R(a.p * b.q - b.p * a.q, a.q * b.q); },
    mul: function (a, b) { return R(a.p * b.p, a.q * b.q); },
    div: function (a, b) { if (b.p === Z) throw new Err("Division by zero"); return R(a.p * b.q, a.q * b.p); },
    idiv: function (a, b) { if (b.p === Z) throw new Err("Division by zero"); return R(floorDiv(a.p * b.q, a.q * b.p), ONE); },
    mod: function (a, b) { if (b.p === Z) throw new Err("Division by zero"); return Rat.sub(a, Rat.mul(b, Rat.idiv(a, b))); },
    pow: function (a, b) {
      if (b.q !== ONE) {                                             /* a fractional power: e^(b·ln a), 20 decimals */
        if (a.p < Z) throw new Err("Negative base with a fractional power");
        if (a.p === Z) return Rat.zero;
        var F32 = p10(32), t = Rat.fx(b, 32) * FX.ln(Rat.fx(a, 32), F32) / F32;
        if (abs(t) > B(10000) * F32) throw new Err("Power too large");
        return Rat.unfx(FX.exp(t, F32), 32);
      }
      var e = b.p, neg = e < Z;
      if (neg) e = -e;
      if (a.p === Z) { if (neg) throw new Err("Division by zero"); return e === Z ? Rat.one : Rat.zero; }
      if (B(bits(a.p) + bits(a.q)) * e > B(200000)) throw new Err("Power too large");
      var r = R(a.p ** e, a.q ** e);
      return neg ? Rat.div(Rat.one, r) : r;
    },
    fx: function (a, P) { return a.p * p10(P) / a.q; },
    /* back from fixed point, rounded to 20 decimals — calc's default epsilon */
    unfx: function (v, P) { var h = p10(P - DIG), r = (abs(v) * TWO + h) / (TWO * h); return R(v < Z ? -r : r, DEN); },
    int: function (a) { return a.p / a.q; },
    fmt: function (a) {
      if (a.q === ONE) return a.p.toString();
      var q = a.q, k2 = 0, k5 = 0;
      while (q % TWO === Z) { q /= TWO; k2++; }
      while (q % FIVE === Z) { q /= FIVE; k5++; }
      var neg = a.p < Z, p = abs(a.p), k = Math.max(k2, k5), exact = q === ONE && k <= DIG, n;
      if (exact) n = p * p10(k) / a.q;
      else { k = DIG; n = (p * p10(k) * TWO + a.q) / (TWO * a.q); }
      var s = n.toString().padStart(k + 1, "0"), ip = s.slice(0, s.length - k), fp = s.slice(s.length - k).replace(/0+$/, "");
      return (exact ? "" : "~") + (neg ? "-" : "") + ip + (fp ? "." + fp : "");
    }
  };

  /* ---------------------------------------------------------- the lexer */
  var OPS = ["**=", "//=", "^=", "+=", "-=", "*=", "/=", "%=", "==", "!=", "<=", ">=", "&&", "||", "++", "--", "**", "//",
             "+", "-", "*", "/", "%", "^", "(", ")", "{", "}", "[", "]", ",", ";", "=", "<", ">", "!"];
  var KW = { "if": 1, "else": 1, "while": 1, "for": 1, "break": 1, "continue": 1, "return": 1, "define": 1, "auto": 1, "print": 1, "quit": 1, "halt": 1 };
  function lex(src, mode) {
    var t = [], i = 0, n = src.length, line = 1, m, calc = mode === "calc";
    while (i < n) {
      var ch = src[i], rest = src.slice(i);
      if (ch === "\n") { t.push({ k: "nl", line: line }); line++; i++; continue; }
      if (ch === " " || ch === "\t" || ch === "\r") { i++; continue; }
      if (ch === "\\" && src[i + 1] === "\n") { i += 2; line++; continue; }
      if (ch === "/" && src[i + 1] === "*") {
        var e = src.indexOf("*/", i + 2);
        if (e < 0) throw MORE;
        line += src.slice(i, e).split("\n").length - 1; i = e + 2; continue;
      }
      if (ch === "#") { while (i < n && src[i] !== "\n") i++; continue; }
      if (ch === '"') {
        var j = src.indexOf('"', i + 1);
        if (calc) { j = i + 1; while (j < n && src[j] !== '"') j += src[j] === "\\" ? 2 : 1; if (j >= n) j = -1; }
        if (j < 0) throw MORE;
        var str = src.slice(i + 1, j);
        line += str.split("\n").length - 1;
        t.push({ k: "str", v: calc ? esc(str) : str, line: line }); i = j + 1; continue;
      }
      if (calc ? (m = /^(0x[0-9a-fA-F]+|(\d+\.?\d*|\.\d+)(e[+-]?\d+)?)/i.exec(rest)) : (m = /^([0-9A-F]+\.?[0-9A-F]*|\.[0-9A-F]+)/.exec(rest))) {
        t.push({ k: "num", v: m[0], line: line }); i += m[0].length; continue;
      }
      if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
        var w = m[0];
        if (!calc && /^[A-Z]/.test(w)) throw new Err("illegal character: " + w[0], "syntax");
        t.push({ k: "name", v: w, line: line }); i += w.length; continue;
      }
      if (!calc && ch === ".") { t.push({ k: "name", v: "last", line: line }); i++; continue; }
      var op = null;
      for (var o = 0; o < OPS.length; o++) if (rest.lastIndexOf(OPS[o], 0) === 0) { op = OPS[o]; break; }
      if (!op || (!calc && (op === "//" || op === "//="))) {
        if (op) op = "/";
        else throw new Err("illegal character: " + ch, "syntax");
      }
      t.push({ k: "op", v: op === "**" ? "^" : op === "**=" ? "^=" : op, line: line }); i += op.length;
    }
    t.push({ k: "eof", line: line });
    return t;
  }
  var ESC = { n: "\n", t: "\t", r: "\r", a: "\x07", b: "\b", f: "\f", q: '"', "\\": "\\", '"': '"' };
  function esc(s) { return s.replace(/\\(.)/g, function (_, c) { return ESC[c] != null ? ESC[c] : c; }); }

  /* --------------------------------------------------------- the parser */
  function Parser(toks, mode) { this.t = toks; this.i = 0; this.mode = mode; this.calc = mode === "calc"; }
  var Pp = Parser.prototype;
  Pp.peek = function (o) { return this.t[this.i + (o || 0)]; };
  Pp.is = function (k, v) { var x = this.t[this.i]; return x.k === k && (v == null || x.v === v); };
  Pp.op = function (v) { return this.is("op", v); };
  Pp.next = function () { var x = this.t[this.i]; if (x.k !== "eof") this.i++; return x; };
  Pp.fail = function () { if (this.is("eof")) throw MORE; throw new Err("syntax error", "syntax"); };
  Pp.want = function (v) { if (!this.op(v)) this.fail(); return this.next(); };
  Pp.nl = function () { while (this.is("nl")) this.next(); };
  Pp.sep = function () { return this.is("nl") || this.is("eof") || this.op(";") || this.op("}"); };
  Pp.program = function () {
    var list = [];
    for (;;) {
      while (this.is("nl") || this.op(";")) this.next();
      if (this.is("eof")) return list;
      list.push(this.stmt());
      if (!this.sep()) this.fail();
    }
  };
  Pp.block = function () {
    this.want("{");
    var list = [];
    for (;;) {
      while (this.is("nl") || this.op(";")) this.next();
      if (this.op("}")) { this.next(); return { t: "block", list: list }; }
      if (this.is("eof")) throw MORE;
      list.push(this.stmt());
      if (!this.sep()) this.fail();
    }
  };
  Pp.body = function () { this.nl(); if (this.is("eof")) throw MORE; if (this.op(";")) { this.next(); return { t: "block", list: [] }; } return this.stmt(); };
  Pp.stmt = function () {
    var x = this.peek();
    if (x.k === "op" && x.v === "{") return this.block();
    if (x.k === "str") { this.next(); return { t: "str", s: x.v }; }
    if (x.k === "name") switch (x.v) {
      case "if": {
        this.next(); this.want("("); var c = this.expr(); this.want(")");
        var a = this.body(), b = null, save = this.i;
        if (this.op(";") && this.peek(1).k === "name" && this.peek(1).v === "else") this.next();
        if (this.is("name", "else")) { this.next(); b = this.body(); } else this.i = save;
        return { t: "if", c: c, a: a, b: b };
      }
      case "while": { this.next(); this.want("("); var wc = this.expr(); this.want(")"); return { t: "while", c: wc, body: this.body() }; }
      case "for": {
        this.next(); this.want("(");
        var f1 = this.op(";") ? null : this.expr(); this.want(";");
        var f2 = this.op(";") ? null : this.expr(); this.want(";");
        var f3 = this.op(")") ? null : this.expr(); this.want(")");
        return { t: "for", i: f1, c: f2, s: f3, body: this.body() };
      }
      case "break": this.next(); return { t: "break" };
      case "continue": this.next(); return { t: "continue" };
      case "quit": case "halt": this.next(); return { t: "quit" };
      case "exit": if (this.calc) { this.next(); return { t: "quit" }; } break;
      case "return": {
        this.next();
        if (this.sep()) return { t: "return", e: null };
        return { t: "return", e: this.expr() };
      }
      case "auto": case "local": case "global": {
        if (x.v !== "auto" && !this.calc) break;
        this.next(); var names = [this.next().v];
        while (this.op(",")) { this.next(); names.push(this.next().v); }
        if (this.op("=") && this.calc) { this.next(); return { t: "auto", names: names, e: this.expr() }; }
        return { t: "auto", names: names };
      }
      case "print": {
        this.next(); var items = [];
        if (this.sep()) return { t: "print", items: items };
        do { if (items.length) this.next(); items.push(this.is("str") ? { s: this.next().v } : this.expr()); } while (this.op(","));
        return { t: "print", items: items };
      }
      case "define": {
        this.next(); var nm = this.next();
        if (nm.k !== "name") this.fail();
        this.want("("); var ps = [];
        while (!this.op(")")) { var pn = this.next(); if (pn.k !== "name") this.fail(); ps.push(pn.v); if (this.op(",")) this.next(); else if (!this.op(")")) this.fail(); }
        this.next();
        if (this.calc && this.op("=")) { this.next(); return { t: "define", name: nm.v, params: ps, body: { t: "return", e: this.expr() } }; }
        this.nl();
        return { t: "define", name: nm.v, params: ps, body: this.block() };
      }
    }
    var e = this.expr();
    return { t: "expr", e: e, show: e.t !== "asg" && e.t !== "inc" };
  };
  /* expressions, lowest to highest: = op=  ||  &&  relations  + -  * / % //  unary  ^ */
  Pp.expr = function () {
    var x = this.peek(), y = this.peek(1);
    if (x.k === "name" && !KW[x.v] && y.k === "op" && /^(=|\+=|-=|\*=|\/=|%=|\^=|\/\/=)$/.test(y.v)) {
      this.next(); this.next();
      return { t: "asg", n: x.v, op: y.v, e: this.expr() };
    }
    return this.or();
  };
  Pp.or = function () { var a = this.and(); while (this.op("||")) { this.next(); a = { t: "bin", op: "||", a: a, b: this.and() }; } return a; };
  Pp.and = function () { var a = this.rel(); while (this.op("&&")) { this.next(); a = { t: "bin", op: "&&", a: a, b: this.rel() }; } return a; };
  Pp.rel = function () {
    var a = this.add();
    while (this.is("op") && /^(==|!=|<|>|<=|>=)$/.test(this.peek().v)) { var o = this.next().v; a = { t: "bin", op: o, a: a, b: this.add() }; }
    return a;
  };
  Pp.add = function () {
    var a = this.mul();
    while (this.op("+") || this.op("-")) { var o = this.next().v; a = { t: "bin", op: o, a: a, b: this.mul() }; }
    return a;
  };
  Pp.mul = function () {
    var a = this.unary();
    while (this.op("*") || this.op("/") || this.op("%") || this.op("//")) { var o = this.next().v; a = { t: "bin", op: o, a: a, b: this.unary() }; }
    return a;
  };
  /* bc: unary minus binds tighter than ^ (-2^2 is 4). calc: the other way (-2^2 is -4). */
  Pp.unary = function () {
    if (!this.calc) {
      var a = this.signed();
      if (this.op("^")) { this.next(); return { t: "bin", op: "^", a: a, b: this.unary() }; }
      return a;
    }
    if (this.op("-")) { this.next(); return { t: "un", op: "-", a: this.unary() }; }
    if (this.op("+")) { this.next(); return this.unary(); }
    if (this.op("!")) { this.next(); return { t: "un", op: "!", a: this.unary() }; }
    return this.power();
  };
  Pp.signed = function () {
    if (this.op("-")) { this.next(); return { t: "un", op: "-", a: this.signed() }; }
    if (this.op("+")) { this.next(); return this.signed(); }
    if (this.op("!")) { this.next(); return { t: "un", op: "!", a: this.signed() }; }
    return this.postfix();
  };
  Pp.power = function () {
    var a = this.postfix();
    if (this.op("^")) { this.next(); return { t: "bin", op: "^", a: a, b: this.unary() }; }
    return a;
  };
  Pp.postfix = function () {
    if (this.op("++") || this.op("--")) {
      var o = this.next().v, nm = this.next();
      if (nm.k !== "name") this.fail();
      return { t: "inc", pre: true, d: o === "++" ? 1 : -1, n: nm.v };
    }
    var a = this.primary();
    if (a.t === "var" && (this.op("++") || this.op("--"))) return { t: "inc", pre: false, d: this.next().v === "++" ? 1 : -1, n: a.n };
    return a;
  };
  Pp.primary = function () {
    var x = this.next();
    if (x.k === "num") return { t: "num", v: x.v };
    if (x.k === "op" && x.v === "(") { var e = this.expr(); this.want(")"); return e; }
    if (x.k === "name" && !KW[x.v]) {
      if (this.op("(")) {
        this.next(); var args = [];
        while (!this.op(")")) { args.push(this.expr()); if (this.op(",")) this.next(); else if (!this.op(")")) this.fail(); }
        this.next();
        return { t: "call", f: x.v, args: args };
      }
      return { t: "var", n: x.v };
    }
    this.i--;
    return this.fail();
  };

  /* ------------------------------------------------------- the session */
  function Session(mode, opt) {
    opt = opt || {};
    this.mode = mode; this.calc = mode === "calc"; this.A = this.calc ? Rat : Dec;
    this.out = opt.out || function () {}; this.errOut = opt.err || this.out;
    this.buf = ""; this.line = 0; this.steps = 0; this.depth = 0; this.errors = 0;
    this.tab = this.calc && !opt.pipe ? "\t" : "";               /* calc indents answers; calc -p does not */
    this.vars = {}; this.funcs = {}; this.frames = [];
    var self = this;
    this.st = { scale: 0, ibase: 10, obase: 10, warn: function (m) { self.errOut("Runtime warning (func=" + self.fname() + ", adr=" + self.adr + "): " + m + "\n"); } };
    this.adr = 0;
    this.vars.last = this.A.zero;
    if (!this.calc && opt.lib) this.st.scale = 20;
    this.lib = !!opt.lib;
  }
  var S = Session.prototype;
  S.pending = function () { return this.buf !== ""; };
  S.reset = function () { this.buf = ""; this.frames = []; this.depth = 0; };
  S.fname = function () { return this.frames.length ? this.frames[this.frames.length - 1].name : "(main)"; };

  /* Feed one line. Runs every statement it completes; returns "quit" to stop. */
  S.feed = function* (line) {
    this.line++;
    var src = this.buf + line + "\n", list;
    try { list = new Parser(lex(src, this.mode), this.mode).program(); }
    catch (e) {
      if (e === MORE) { this.buf = src; return null; }
      this.buf = "";
      if (e instanceof Err) { this.report(e); return null; }
      throw e;
    }
    this.buf = "";
    for (var i = 0; i < list.length; i++) {
      this.adr = 0;
      try { yield* this.exec(list[i]); }
      catch (e) {
        if (e instanceof Quit) return "quit";
        this.frames = []; this.depth = 0;
        if (e instanceof Err) { this.report(e); continue; }
        if (e === BREAK || e === CONTINUE) { this.report(new Err(e === BREAK ? "break outside a for/while" : "continue outside a for", "syntax")); continue; }
        if (e instanceof Ret) { this.report(new Err("return outside a function", "syntax")); continue; }
        throw e;
      }
    }
    return null;
  };
  S.report = function (e) {
    this.errors++;
    if (this.calc) { this.errOut((e.kind === "syntax" ? "\"(stdin)\", line " + this.line + ": " : "") + e.msg + "\n"); return; }
    if (e.kind === "syntax") this.errOut("(standard_in) " + this.line + ": " + e.msg + "\n");
    else this.errOut("Runtime error (func=" + this.fname() + ", adr=" + this.adr + "): " + e.msg + "\n");
  };
  S.show = function (v) { return this.A.fmt(v, this.st); };
  S.exec = function* (st) {
    if (++this.steps % 3000 === 0) yield 0.002;                    /* let Ctrl+C and the rest of the Pi in */
    switch (st.t) {
      case "expr": {
        var v = yield* this.ev(st.e);
        if (st.show) { this.out(this.tab + this.show(v) + "\n"); this.vars.last = v; }
        return;
      }
      case "str": this.out(this.calc ? st.s + "\n" : st.s); return;
      case "print": {
        var parts = [];
        for (var i = 0; i < st.items.length; i++) {
          var it = st.items[i];
          parts.push(it.s != null ? (this.calc ? it.s : esc(it.s)) : this.show(yield* this.ev(it)));
        }
        this.out(this.calc ? parts.join(" ") + "\n" : parts.join(""));
        return;
      }
      case "block": for (var j = 0; j < st.list.length; j++) yield* this.exec(st.list[j]); return;
      case "if":
        if (!this.A.isZero(yield* this.ev(st.c))) yield* this.exec(st.a);
        else if (st.b) yield* this.exec(st.b);
        return;
      case "while":
        while (!this.A.isZero(yield* this.ev(st.c))) {
          try { yield* this.exec(st.body); } catch (e) { if (e === BREAK) break; if (e !== CONTINUE) throw e; }
          if (++this.steps % 3000 === 0) yield 0.002;
        }
        return;
      case "for":
        if (st.i) yield* this.ev(st.i);
        while (!st.c || !this.A.isZero(yield* this.ev(st.c))) {
          try { yield* this.exec(st.body); } catch (e) { if (e === BREAK) break; if (e !== CONTINUE) throw e; }
          if (st.s) yield* this.ev(st.s);
          if (++this.steps % 3000 === 0) yield 0.002;
        }
        return;
      case "break": throw BREAK;
      case "continue": throw CONTINUE;
      case "return": throw new Ret(st.e ? yield* this.ev(st.e) : this.A.zero);
      case "quit": throw new Quit();
      case "define": this.funcs[st.name] = st; return;
      case "auto": {
        var fr = this.frames[this.frames.length - 1], init = st.e ? yield* this.ev(st.e) : this.A.zero;
        st.names.forEach(function (n) { if (fr) fr.vars[n] = init; else this.vars[n] = init; }, this);
        return;
      }
    }
  };
  S.get = function (n) {
    var fr = this.frames[this.frames.length - 1];
    if (fr && n in fr.vars) return fr.vars[n];
    if (!this.calc && (n === "scale" || n === "ibase" || n === "obase")) return D(B(this.st[n]), 0);
    if (n in this.vars) return this.vars[n];
    if (this.calc) throw new Err("\"" + n + "\" is undefined");
    return this.A.zero;
  };
  S.set = function (n, v) {
    var fr = this.frames[this.frames.length - 1];
    if (fr && n in fr.vars) { fr.vars[n] = v; return v; }
    if (!this.calc && (n === "scale" || n === "ibase" || n === "obase")) {
      var k = Number(Dec.int(v));
      if (n === "scale") { if (k < 0) throw new Err("negative scale"); this.st.scale = Math.min(k, 2000); }
      else if (n === "ibase") this.st.ibase = Math.max(2, Math.min(16, k));
      else { if (k < 2) throw new Err("obase too small"); this.st.obase = Math.min(k, 999); }
      return v;
    }
    this.vars[n] = v;
    return v;
  };
  S.bin = function (op, a, b) {
    var A = this.A, st = this.st;
    switch (op) {
      case "+": return A.add(a, b);
      case "-": return A.sub(a, b);
      case "*": return A.mul(a, b, st);
      case "/": return A.div(a, b, st);
      case "%": return A.mod(a, b, st);
      case "//": return A.idiv(a, b, st);
      case "^": return A.pow(a, b, st);
      case "==": return A.of(A.cmp(a, b) === 0);
      case "!=": return A.of(A.cmp(a, b) !== 0);
      case "<": return A.of(A.cmp(a, b) < 0);
      case ">": return A.of(A.cmp(a, b) > 0);
      case "<=": return A.of(A.cmp(a, b) <= 0);
      case ">=": return A.of(A.cmp(a, b) >= 0);
    }
    throw new Err("syntax error", "syntax");
  };
  S.ev = function* (e) {
    var A = this.A;
    this.adr++;
    switch (e.t) {
      case "num": return A.lit(e.v, this.st);
      case "var": return this.get(e.n);
      case "un": { var u = yield* this.ev(e.a); return e.op === "-" ? A.neg(u) : A.of(A.isZero(u)); }
      case "bin":
        if (e.op === "&&") return A.of(!A.isZero(yield* this.ev(e.a)) && !A.isZero(yield* this.ev(e.b)));
        if (e.op === "||") return A.of(!A.isZero(yield* this.ev(e.a)) || !A.isZero(yield* this.ev(e.b)));
        var l = yield* this.ev(e.a), r = yield* this.ev(e.b);
        return this.bin(e.op, l, r);
      case "asg": {
        var v = yield* this.ev(e.e);
        if (e.op !== "=") v = this.bin(e.op.slice(0, -1), this.get(e.n), v);
        return this.set(e.n, v);
      }
      case "inc": {
        var old = this.get(e.n), nu = e.d > 0 ? A.add(old, A.one) : A.sub(old, A.one);
        this.set(e.n, nu);
        return e.pre ? nu : old;
      }
      case "call": {
        var args = [];
        for (var i = 0; i < e.args.length; i++) args.push(yield* this.ev(e.args[i]));
        var fn = this.funcs[e.f];
        if (fn) return yield* this.call(fn, args);
        return this.builtin(e.f, args);
      }
    }
    throw new Err("syntax error", "syntax");
  };
  S.call = function* (fn, args) {
    if (args.length !== fn.params.length) throw new Err(this.calc ? "Function \"" + fn.name + "\" called with " + args.length + " argument" + (args.length === 1 ? "" : "s") + ", it takes " + fn.params.length : "Parameter number mismatch");
    if (this.depth > 400) throw new Err(this.calc ? "Calls nested too deeply" : "Function call too deep");
    var fr = { name: fn.name, vars: {} };
    fn.params.forEach(function (p, i) { fr.vars[p] = args[i]; });
    if (fn.body.t === "block") fn.body.list.forEach(function (st) { if (st.t === "auto" && !st.e) st.names.forEach(function (n) { fr.vars[n] = this.A.zero; }, this); }, this);
    this.frames.push(fr); this.depth++;
    try { yield* this.exec(fn.body); }
    catch (e) { if (e instanceof Ret) return e.v; throw e; }
    finally { this.frames.pop(); this.depth--; }
    return this.A.zero;
  };

  /* The functions that come built in. bc's own: sqrt length scale, and with
   * -l the maths library s c a l e. calc's: the usual scientific set. */
  S.builtin = function (f, a) {
    var A = this.A, st = this.st, self = this;
    var need = function (n) { if (a.length !== n) throw new Err(self.calc ? "Function \"" + f + "\" takes " + n + " argument" + (n === 1 ? "" : "s") : "Parameter number mismatch"); };
    if (!this.calc) {
      var lib = function (fun, chk) {
        need(1);
        var S2 = st.scale, P = S2 + 12, F = p10(P), x = Dec.fx(a[0], P);
        if (chk) chk(x, F);
        return Dec.unfx(fun(x, F), P, S2);
      };
      switch (f) {
        case "sqrt": need(1); return Dec.sqrt(a[0], st);
        case "length": { need(1); var n = abs(a[0].n).toString().replace(/^0+/, ""); return D(B(Math.max(n.length, a[0].s, 1)), 0); }
        case "scale": need(1); return D(B(a[0].s), 0);
      }
      if (this.lib) switch (f) {
        case "s": return lib(FX.sin);
        case "c": return lib(FX.cos);
        case "a": return lib(FX.atan);
        case "e": if (a[0] && Dec.cmp(a[0], D(B(10000), 0)) > 0) throw new Err("e(): exponent too large"); return lib(FX.exp);
        case "l": return lib(FX.ln, function (x) { if (x <= Z) throw new Err("l(): needs a number above 0"); });
      }
      throw new Err("Function " + f + " not defined.");
    }
    var P = 32, F = p10(P);
    var fx = function (x) { return Rat.fx(x, P); }, unfx = function (v) { return Rat.unfx(v, P); };
    var whole = function (x, what) { if (x.q !== ONE) throw new Err("Non-integer argument for " + what); return x.p; };
    var cmp0 = function (x) { return Rat.cmp(x, Rat.zero); };
    switch (f) {
      case "sqrt": {
        need(1);
        if (cmp0(a[0]) < 0) throw new Err("Square root of a negative number");
        var sp = isqrt(a[0].p), sq = isqrt(a[0].q);
        if (sp * sp === a[0].p && sq * sq === a[0].q) return R(sp, sq);
        return unfx(isqrt(fx(a[0]) * F));
      }
      case "abs": need(1); return cmp0(a[0]) < 0 ? Rat.neg(a[0]) : a[0];
      case "int": need(1); return R(a[0].p / a[0].q, ONE);
      case "frac": need(1); return Rat.sub(a[0], R(a[0].p / a[0].q, ONE));
      case "floor": need(1); return R(floorDiv(a[0].p, a[0].q), ONE);
      case "ceil": need(1); return R(-floorDiv(-a[0].p, a[0].q), ONE);
      case "round": {
        var places = a.length > 1 ? Number(whole(a[1], "round")) : 0, sc = p10(Math.max(0, Math.min(places, 1000)));
        var v = Rat.mul(a[0], R(sc, ONE)), r = (abs(v.p) * TWO + v.q) / (TWO * v.q);
        return R(v.p < Z ? -r : r, sc);
      }
      case "num": need(1); return R(a[0].p, ONE);
      case "den": need(1); return R(a[0].q, ONE);
      case "pi": need(0); return unfx(FX.pi(F));
      case "exp": need(1); if (Rat.cmp(R(abs(a[0].p), a[0].q), R(B(10000), ONE)) > 0) throw new Err("Exponent too large"); return unfx(FX.exp(fx(a[0]), F));
      case "ln": case "log": case "log2": {
        need(1);
        if (cmp0(a[0]) <= 0) throw new Err(f + "() needs a number above 0");
        var lnx = FX.ln(fx(a[0]), F);
        if (f === "log") { var t = a[0]; if (t.q === ONE) { var k = t.p.toString(); if (/^10*$/.test(k)) return R(B(k.length - 1), ONE); } return unfx(lnx * F / FX.ln(TEN * F, F)); }
        if (f === "log2") { if (a[0].q === ONE && (a[0].p & (a[0].p - ONE)) === Z) return R(B(bits(a[0].p) - 1), ONE); return unfx(lnx * F / FX.ln(TWO * F, F)); }
        return unfx(lnx);
      }
      case "sin": need(1); return unfx(FX.sin(fx(a[0]), F));
      case "cos": need(1); return unfx(FX.cos(fx(a[0]), F));
      case "tan": { need(1); var c = FX.cos(fx(a[0]), F); if (abs(c) < p10(P - 28)) throw new Err("tan() is infinite there"); return unfx(FX.sin(fx(a[0]), F) * F / c); }
      case "atan": need(1); return unfx(FX.atan(fx(a[0]), F));
      case "asin": case "acos": {
        need(1);
        var x = fx(a[0]);
        if (abs(x) > F) throw new Err(f + "() needs a number from -1 to 1");
        var root = isqrt((F - x * x / F) * F), as = root === Z ? (x > Z ? FX.pi(F) / TWO : -FX.pi(F) / TWO) : FX.atan(x * F / root, F);
        return unfx(f === "asin" ? as : FX.pi(F) / TWO - as);
      }
      case "root": {
        need(2);
        var nn = whole(a[1], "root");
        if (nn <= Z) throw new Err("root() needs a positive whole number of roots");
        if (cmp0(a[0]) < 0 && nn % TWO === Z) throw new Err("Even root of a negative number");
        var neg = cmp0(a[0]) < 0, base = neg ? Rat.neg(a[0]) : a[0];
        if (base.p === Z) return Rat.zero;
        var rr = unfx(FX.exp(FX.ln(fx(base), F) / nn, F));
        return neg ? Rat.neg(rr) : rr;
      }
      case "power": need(2); return Rat.pow(a[0], a[1]);
      case "fact": {
        need(1);
        var fn = whole(a[0], "fact");
        if (fn < Z) throw new Err("Negative argument for factorial");
        if (fn > B(5000)) throw new Err("Very large factorial");
        var fv = ONE;
        for (var i = TWO; i <= fn; i++) fv *= i;
        return R(fv, ONE);
      }
      case "gcd": case "lcm": {
        if (!a.length) need(1);
        var g = whole(a[0], f);
        for (var j = 1; j < a.length; j++) { var b2 = whole(a[j], f); g = f === "gcd" ? gcd(g, b2) : (g === Z || b2 === Z ? Z : abs(g * b2) / gcd(g, b2)); }
        return R(abs(g), ONE);
      }
      case "isprime": {
        need(1);
        var q = abs(whole(a[0], "isprime"));
        if (q < TWO) return Rat.zero;
        if (q < B(4)) return Rat.one;
        if (q % TWO === Z) return Rat.zero;
        var pw = function (b, e, m) { var r = ONE; b %= m; while (e > Z) { if (e & ONE) r = r * b % m; b = b * b % m; e >>= ONE; } return r; };
        var d = q - ONE, s = 0;
        while (d % TWO === Z) { d /= TWO; s++; }
        var primes = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41];
        for (var w = 0; w < primes.length; w++) {
          var aa = B(primes[w]);
          if (aa % q === Z) return Rat.one;
          var y = pw(aa, d, q);
          if (y === ONE || y === q - ONE) continue;
          var comp = true;
          for (var r2 = 1; r2 < s; r2++) { y = y * y % q; if (y === q - ONE) { comp = false; break; } }
          if (comp) return Rat.zero;
        }
        return Rat.one;
      }
      case "max": case "min": {
        if (!a.length) need(1);
        var best = a[0];
        for (var m = 1; m < a.length; m++) if ((Rat.cmp(a[m], best) > 0) === (f === "max") && Rat.cmp(a[m], best) !== 0) best = a[m];
        return best;
      }
    }
    throw new Err("\"" + f + "\" is undefined");
  };

  L.PiCalc = { Session: Session, FX: FX, Dec: Dec, Rat: Rat };
})(typeof window !== "undefined" ? window : globalThis);
