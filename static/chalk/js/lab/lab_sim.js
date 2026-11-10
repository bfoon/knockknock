/* Chalk Circuit Lab — the physics.
 *
 * A real circuit solver, small enough to read. Every frame the bench asks:
 * given these parts, these wires and this much time, what are the voltages
 * and currents? The answer drives every glowing LED, spinning fan and moving
 * electron on screen, so nothing on the bench is faked — if a light is on,
 * it is because current is flowing through it.
 *
 * How it works:
 *   1. Topology. Pins that touch (a leg in a hole, a wire on a pin, a strip
 *      under the holes) are merged into nodes with union-find.
 *   2. Devices. Each part becomes a few primitives: resistors, sources,
 *      diodes, transistors, capacitors, switches.
 *   3. Nodal analysis. One matrix row per node; non-linear parts are
 *      linearised and the system re-solved until it settles (Newton-Raphson,
 *      with SPICE-style junction limiting so a bare LED on 9 V converges).
 *   4. Time. Capacitors, coils and motors are stepped with backward Euler.
 *      Chips, relays and the Arduino's pins are updated between steps.
 *   5. Flow. The current at every pin is pushed back through the wires that
 *      make up each node, so each wire knows how much current it carries and
 *      which way — that is what the moving dots show.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var P = L.P;

  var VT = 0.025852;        /* thermal voltage at room temperature */
  var GMIN = 1e-12;
  var MAX_NR = 60;
  var DT = 1e-3;            /* one simulated millisecond per step */
  var MAX_STEPS = 48;       /* per frame; past this the sim slows down rather than stutters */
  var SMOOTH = 0.03;        /* seconds — what a meter and an eye average over */

  /* ------------------------------------------------------------ helpers */

  function sexp(x) {
    /* exp() that cannot overflow into Infinity: past e^80 it goes linear. */
    if (x > 80) return 5.540622384e34 * (1 + x - 80);
    return Math.exp(x);
  }

  function pnjlim(vnew, vold, vt, vcrit) {
    if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
      if (vold > 0) {
        var arg = 1 + (vnew - vold) / vt;
        vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit;
      } else {
        vnew = vt * Math.log(vnew / vt);
      }
    }
    return vnew;
  }

  /* Dense LU with partial pivoting. Circuits on a bench rarely pass sixty
   * nodes, and at that size a dense solve is faster than being clever. */
  function solve(A, b, n) {
    var i, j, k, max, row, t;
    for (k = 0; k < n; k++) {
      max = Math.abs(A[k * n + k]); row = k;
      for (i = k + 1; i < n; i++) {
        t = Math.abs(A[i * n + k]);
        if (t > max) { max = t; row = i; }
      }
      if (max < 1e-30) { A[k * n + k] = 1e-30; }
      else if (row !== k) {
        for (j = 0; j < n; j++) { t = A[k * n + j]; A[k * n + j] = A[row * n + j]; A[row * n + j] = t; }
        t = b[k]; b[k] = b[row]; b[row] = t;
      }
      var piv = A[k * n + k];
      for (i = k + 1; i < n; i++) {
        var f = A[i * n + k] / piv;
        if (f === 0) continue;
        A[i * n + k] = 0;
        for (j = k + 1; j < n; j++) A[i * n + j] -= f * A[k * n + j];
        b[i] -= f * b[k];
      }
    }
    for (i = n - 1; i >= 0; i--) {
      var s = b[i];
      for (j = i + 1; j < n; j++) s -= A[i * n + j] * b[j];
      b[i] = s / A[i * n + i];
    }
    return b;
  }

  /* ============================================================ PRIMITIVES
   *
   * Every primitive has terminal pin keys `p`, node indices `n` (0 is the
   * reference) and, after a solve, the current flowing INTO it at each
   * terminal in `cur`. stamp() adds its linearised self to the matrix. */

  function Mat(n) {
    this.n = n;
    this.A = new Float64Array(n * n);
    this.b = new Float64Array(n);
  }
  Mat.prototype.clear = function () { this.A.fill(0); this.b.fill(0); };
  Mat.prototype.g = function (a, b, g) {
    var n = this.n, A = this.A;
    if (a) A[(a - 1) * n + a - 1] += g;
    if (b) A[(b - 1) * n + b - 1] += g;
    if (a && b) { A[(a - 1) * n + b - 1] -= g; A[(b - 1) * n + a - 1] -= g; }
  };
  /* Constant current INTO the device at node a (so: leaving the node). */
  Mat.prototype.i = function (a, i) { if (a) this.b[a - 1] -= i; };
  /* Generic linearised stamp: I(V) ≈ I0 + J (V - V0). */
  Mat.prototype.nl = function (nodes, I0, J, V0) {
    var n = this.n, A = this.A, k = nodes.length, r, c;
    for (r = 0; r < k; r++) {
      var nr = nodes[r];
      if (!nr) continue;
      var konst = I0[r];
      for (c = 0; c < k; c++) {
        var jc = J[r * k + c];
        if (jc === 0) continue;
        konst -= jc * V0[c];
        var nc = nodes[c];
        if (nc) A[(nr - 1) * n + nc - 1] += jc;
      }
      this.b[nr - 1] -= konst;
    }
  };

  function V(x, node) { return node ? x[node - 1] : 0; }

  /* Norton source: conductance g between a and b, plus current `is` pushed
   * out of a (into the node) and back in at b. A voltage source is g=1/r,
   * is=v/r. A plain resistor is is=0. An input pin is a tiny g. */
  function Norton(g, is) { this.k = "N"; this.gv = g; this.is = is || 0; }
  Norton.prototype.stamp = function (M) { M.g(this.n[0], this.n[1], this.gv); M.i(this.n[0], -this.is); M.i(this.n[1], this.is); };
  Norton.prototype.current = function (x) {
    var i = this.gv * (V(x, this.n[0]) - V(x, this.n[1])) - this.is;
    this.cur[0] = i; this.cur[1] = -i;
  };

  function Diode(is, nvt) { this.k = "D"; this.Is = is; this.nVt = nvt; this.vd = 0; this.open = false; this.vcrit = nvt * Math.log(nvt / (Math.SQRT2 * is)); }
  Diode.prototype.stamp = function (M, x) {
    if (this.open) { M.g(this.n[0], this.n[1], 1e-9); return; }
    var va = V(x, this.n[0]), vd = va - V(x, this.n[1]);
    vd = pnjlim(vd, this.vd, this.nVt, this.vcrit);
    this.vdNext = vd;
    var e = sexp(vd / this.nVt), id = this.Is * (e - 1), gd = this.Is * e / this.nVt + GMIN;
    M.nl(this.n, [id, -id], [gd, -gd, -gd, gd], [va, va - vd]);
  };
  Diode.prototype.accept = function () { var d = Math.abs(this.vdNext - this.vd); this.vd = this.vdNext; return d; };
  Diode.prototype.current = function (x) {
    if (this.open) { var io = 1e-9 * (V(x, this.n[0]) - V(x, this.n[1])); this.cur[0] = io; this.cur[1] = -io; return; }
    var vd = V(x, this.n[0]) - V(x, this.n[1]);
    var i = this.Is * (sexp(vd / this.nVt) - 1);
    this.cur[0] = i; this.cur[1] = -i;
  };

  /* Bipolar transistor, Ebers-Moll transport model. Terminals: C, B, E. */
  function BJT(pol, beta) {
    this.k = "Q"; this.pol = pol; this.Is = 1e-14; this.bf = beta || 150; this.br = 2;
    this.vbe = 0; this.vbc = 0; this.vcrit = VT * Math.log(VT / (Math.SQRT2 * this.Is)); this.open = false;
  }
  BJT.prototype.eval = function (vbe, vbc) {
    var Is = this.Is, ef = sexp(vbe / VT), er = sexp(vbc / VT);
    var If = Is * (ef - 1), Ir = Is * (er - 1), gF = Is * ef / VT, gR = Is * er / VT;
    var ic = If - Ir - Ir / this.br, ib = If / this.bf + Ir / this.br;
    /* derivatives w.r.t. (Vc, Vb, Ve) */
    var dIc = [gR * (1 + 1 / this.br), gF - gR * (1 + 1 / this.br), -gF];
    var dIb = [-gR / this.br, gF / this.bf + gR / this.br, -gF / this.bf];
    return { ic: ic, ib: ib, dIc: dIc, dIb: dIb };
  };
  BJT.prototype.stamp = function (M, x) {
    if (this.open) { M.g(this.n[0], this.n[2], 1e-9); M.g(this.n[1], this.n[2], 1e-9); return; }
    var p = this.pol, vc = V(x, this.n[0]), vb = V(x, this.n[1]), ve = V(x, this.n[2]);
    var vbe = pnjlim(p * (vb - ve), this.vbe, VT, this.vcrit);
    var vbc = pnjlim(p * (vb - vc), this.vbc, VT, this.vcrit);
    this.next = [vbe, vbc];
    var r = this.eval(vbe, vbc);
    var ic = p * r.ic, ib = p * r.ib, ie = -(ic + ib);
    var J = [], i;
    for (i = 0; i < 3; i++) J[i] = r.dIc[i];
    for (i = 0; i < 3; i++) J[3 + i] = r.dIb[i];
    for (i = 0; i < 3; i++) J[6 + i] = -(r.dIc[i] + r.dIb[i]);
    for (i = 0; i < 9; i++) J[i] += (i % 4 === 0 ? GMIN : 0);
    /* linearisation point consistent with the limited junction voltages */
    var V0 = [vb - p * vbc, vb, vb - p * vbe];
    M.nl(this.n, [ic, ib, ie], J, V0);
  };
  BJT.prototype.accept = function () {
    var d = Math.max(Math.abs(this.next[0] - this.vbe), Math.abs(this.next[1] - this.vbc));
    this.vbe = this.next[0]; this.vbc = this.next[1];
    return d;
  };
  BJT.prototype.current = function (x) {
    if (this.open) { this.cur[0] = this.cur[1] = this.cur[2] = 0; return; }
    var p = this.pol, vc = V(x, this.n[0]), vb = V(x, this.n[1]), ve = V(x, this.n[2]);
    var r = this.eval(p * (vb - ve), p * (vb - vc));
    this.cur[0] = p * r.ic; this.cur[1] = p * r.ib; this.cur[2] = -(this.cur[0] + this.cur[1]);
  };

  /* N-channel MOSFET, square law with a soft turn-on. Terminals: D, G, S. */
  function MOS(vth, kp) { this.k = "M"; this.vth = vth; this.kp = kp; this.lam = 0.01; this.vgs = 0; this.vds = 0; this.open = false; }
  MOS.prototype.eval = function (vgs, vds) {
    var s = 1;
    if (vds < 0) { s = -1; vgs = vgs - vds; vds = -vds; }   /* swap source and drain */
    var u = (vgs - this.vth) / 0.05;
    var vov = u > 30 ? vgs - this.vth : 0.05 * Math.log(1 + Math.exp(u));
    var dvov = u > 30 ? 1 : 1 / (1 + Math.exp(-u));
    var id, gm, gds, k = this.kp, lam = this.lam;
    if (vds < vov) {
      id = k * (vov * vds - vds * vds / 2) * (1 + lam * vds);
      gm = k * vds * (1 + lam * vds) * dvov;
      gds = k * (vov - vds) * (1 + lam * vds) + k * (vov * vds - vds * vds / 2) * lam;
    } else {
      id = k / 2 * vov * vov * (1 + lam * vds);
      gm = k * vov * (1 + lam * vds) * dvov;
      gds = k / 2 * vov * vov * lam;
    }
    return { id: s * id, gm: gm, gds: gds, s: s };
  };
  MOS.prototype.stamp = function (M, x) {
    if (this.open) { M.g(this.n[0], this.n[2], 1e-9); return; }
    var vd = V(x, this.n[0]), vg = V(x, this.n[1]), vs = V(x, this.n[2]);
    var vgs = vg - vs, vds = vd - vs;
    /* keep each Newton step on the gate gentle */
    if (Math.abs(vgs - this.vgs) > 0.6) vgs = this.vgs + (vgs > this.vgs ? 0.6 : -0.6);
    this.next = [vgs, vds];
    var r = this.eval(vgs, vds), gm = r.gm, gds = r.gds + GMIN;
    var J;
    if (r.s > 0) J = [gds, gm, -(gm + gds), 0, 0, 0, -gds, -gm, gm + gds];
    else J = [gds + gm, -gm, -gds, 0, 0, 0, -(gds + gm), gm, gds];   /* roles swapped */
    M.nl(this.n, [r.id, 0, -r.id], J, [vs + vds, vs + vgs, vs]);
  };
  MOS.prototype.accept = function () {
    var d = Math.max(Math.abs(this.next[0] - this.vgs), Math.abs(this.next[1] - this.vds));
    this.vgs = this.next[0]; this.vds = this.next[1];
    return d;
  };
  MOS.prototype.current = function (x) {
    if (this.open) { this.cur[0] = this.cur[1] = this.cur[2] = 0; return; }
    var vd = V(x, this.n[0]), vg = V(x, this.n[1]), vs = V(x, this.n[2]);
    var r = this.eval(vg - vs, vd - vs);
    this.cur[0] = r.id; this.cur[1] = 0; this.cur[2] = -r.id;
  };

  /* Capacitor (backward Euler). Open circuit at DC. */
  function Cap(c) { this.k = "C"; this.c = c; this.v = 0; this.dt = 0; }
  Cap.prototype.stamp = function (M) {
    if (!(this.dt > 0) || !isFinite(this.dt)) { M.g(this.n[0], this.n[1], 1e-9); return; }
    var g = this.c / this.dt;
    M.g(this.n[0], this.n[1], g);
    M.i(this.n[0], -g * this.v); M.i(this.n[1], g * this.v);
  };
  Cap.prototype.current = function (x) {
    var v = V(x, this.n[0]) - V(x, this.n[1]);
    var i = (this.dt > 0 && isFinite(this.dt)) ? this.c / this.dt * (v - this.v) : 0;
    this.cur[0] = i; this.cur[1] = -i;
    this.vNew = v;
  };
  Cap.prototype.commit = function () { if (this.vNew != null) this.v = this.vNew; };

  /* Inductor (backward Euler). A short at DC. */
  function Ind(l) { this.k = "L"; this.l = l; this.iL = 0; this.dt = 0; }
  Ind.prototype.stamp = function (M) {
    if (!(this.dt > 0) || !isFinite(this.dt)) { M.g(this.n[0], this.n[1], 1e3); return; }
    var g = this.dt / this.l;
    M.g(this.n[0], this.n[1], g);
    M.i(this.n[0], this.iL); M.i(this.n[1], -this.iL);
  };
  Ind.prototype.current = function (x) {
    var v = V(x, this.n[0]) - V(x, this.n[1]);
    var i = (this.dt > 0 && isFinite(this.dt)) ? this.iL + this.dt / this.l * v : 1e3 * v;
    this.cur[0] = i; this.cur[1] = -i; this.iNew = i;
  };
  Ind.prototype.commit = function () { if (this.iNew != null) this.iL = this.iNew; };

  /* Op-amp output stage: pulls OUT towards a soft-clipped A·(V+ − V−),
   * through Rout. Terminals: OUT, +, −, VCC, GND. Return current comes from
   * whichever rail the output is pushing against, so supply current is real. */
  function OpAmp() { this.k = "O"; this.A = 2e4; this.g = 1 / 20; this.sourcing = false; }
  OpAmp.prototype.target = function (x) {
    var vcc = V(x, this.n[3]), gnd = V(x, this.n[4]);
    var hi = vcc - 1.5, lo = gnd + 0.02;
    if (hi < lo) hi = lo;
    var mid = (hi + lo) / 2, half = Math.max(0.05, (hi - lo) / 2);
    var u = this.A * (V(x, this.n[1]) - V(x, this.n[2])) / half;
    var th = Math.tanh(u);
    return { vt: mid + half * th, d: this.A * (1 - th * th) };
  };
  OpAmp.prototype.stamp = function (M, x) {
    var t = this.target(x), g = this.g, vo = V(x, this.n[0]);
    var io = g * (vo - t.vt);
    this.sourcing = io < 0;
    var J = new Array(25).fill(0);
    J[0] = g; J[1] = -g * t.d; J[2] = g * t.d;
    var rr = this.sourcing ? 3 : 4;
    J[rr * 5 + 0] = -g; J[rr * 5 + 1] = g * t.d; J[rr * 5 + 2] = -g * t.d;
    var I0 = [io, 0, 0, 0, 0]; I0[rr] = -io;
    var V0 = [vo, V(x, this.n[1]), V(x, this.n[2]), V(x, this.n[3]), V(x, this.n[4])];
    M.nl(this.n, I0, J, V0);
  };
  OpAmp.prototype.current = function (x) {
    var t = this.target(x), io = this.g * (V(x, this.n[0]) - t.vt);
    this.cur[0] = io; this.cur[1] = 0; this.cur[2] = 0;
    this.cur[3] = io < 0 ? -io : 0; this.cur[4] = io > 0 ? -io : 0;
  };

  /* An ohmic switch is just a Norton with nothing pushed. */
  var G_ON = 1 / 0.02, G_OFF = 1e-10;

  /* ================================================================ MODELS
   *
   * One builder per part type. build() makes primitives and returns an
   * object the per-step hooks can poke at; pre() runs before each solve
   * (read props, set switches, drive pins), post() after it (work out what
   * the eye should see and whether anything is cooking). */

  var MODELS = L.MODELS = {};

  function R(b, a, c, ohms) { return b.add(new Norton(1 / Math.max(1e-4, ohms), 0), [a, c]); }
  function Vs(b, pos, neg, volts, r) { return b.add(new Norton(1 / r, volts / r), [pos, neg]); }
  function setV(dev, volts, r) { dev.gv = 1 / r; dev.is = volts / r; }
  function setR(dev, ohms) { dev.gv = 1 / Math.max(1e-4, ohms); dev.is = 0; }
  function setSw(dev, on) { dev.gv = on ? G_ON : G_OFF; dev.is = 0; }
  function vAcross(ctx, dev) { return ctx.v(dev.n[0]) - ctx.v(dev.n[1]); }
  function iThrough(dev) { return dev.cur[0]; }

  /* smoothed value: what a meter or an eye actually sees */
  function smooth(st, key, val, ctx) {
    var a = ctx.alpha;
    st[key] = st[key] == null ? val : st[key] + (val - st[key]) * a;
    return st[key];
  }

  function warn(ctx, level, code, msg) { ctx.sim.warn(ctx.part.id, level, code, msg); }

  /* -------- power */

  function battery(volts, rint) {
    return {
      build: function (b, pr) { return { src: Vs(b, "+", "-", pr.volts || volts(pr), rint(pr)) }; },
      pre: function (m, ctx) { setV(m.src, ctx.props.volts || volts(ctx.props), rint(ctx.props)); },
      post: function (m, ctx) {
        var i = -iThrough(m.src);   /* current delivered out of + */
        var iA = smooth(ctx.st, "i", i, ctx);
        var vmax = ctx.props.volts || volts(ctx.props);
        var limit = Math.min(3, vmax / rint(ctx.props) * 0.25);
        var hot = L.clamp((Math.abs(iA) - limit) / limit, 0, 1);
        ctx.st.hot = smooth(ctx.st, "hot_", hot, ctx);
        if (hot > 0.15) warn(ctx, "danger", "short", "Short circuit! " + L.si(Math.abs(iA), "A") + " is pouring straight out of the battery and it is heating up.");
        if (i < -0.02) warn(ctx, "warn", "backfed", "Current is being pushed backwards into this battery.");
      }
    };
  }
  MODELS.battery_9v = battery(function () { return 9; }, function () { return 1.7; });
  MODELS.battery_aa = battery(function (pr) { return 1.5 * (pr.cells || 2); }, function (pr) { return 0.15 * (pr.cells || 2); });
  MODELS.coin_cell = battery(function () { return 3; }, function () { return 15; });
  MODELS.k_battery = battery(function (pr) { return pr.volts || 3; }, function (pr) { return 0.12 * Math.max(1, (pr.volts || 3) / 1.5); });

  MODELS.psu = {
    build: function (b, pr) { return { src: Vs(b, "+", "-", pr.volts, 0.01), scale: 1 }; },
    pre: function (m, ctx) {
      var pr = ctx.props, set = Math.max(0, pr.volts);
      setV(m.src, set * m.scale, 0.01);
    },
    post: function (m, ctx) {
      var i = -iThrough(m.src), limit = ctx.props.limit || 1;
      /* constant-current mode: back the voltage off until the load draws
       * exactly the limit, like a real bench supply */
      if (Math.abs(i) > limit * 1.001) m.scale = Math.max(0, m.scale * limit / Math.abs(i));
      else if (m.scale < 1) m.scale = Math.min(1, m.scale * 1.05 + 0.002);
      ctx.st.cc = m.scale < 0.999;
      smooth(ctx.st, "i", i, ctx);
      smooth(ctx.st, "v", vAcross(ctx, m.src), ctx);
    }
  };

  /* -------- passives */

  MODELS.resistor = {
    build: function (b, pr) { return { r: R(b, "1", "2", pr.ohms) }; },
    pre: function (m, ctx) { setR(m.r, ctx.st.burnt ? 1e10 : ctx.props.ohms); },
    post: function (m, ctx) {
      var i = iThrough(m.r), v = vAcross(ctx, m.r), p = Math.abs(v * i);
      var pa = smooth(ctx.st, "p", p, ctx), rating = ctx.props.watts || 0.25;
      ctx.st.i = i; ctx.st.v = v;
      ctx.st.heat = L.clamp(pa / rating - 0.35, 0, 2);
      if (pa > rating * 2.5) {
        ctx.st.cook = (ctx.st.cook || 0) + ctx.dt;
        if (ctx.st.cook > 0.4 && !ctx.st.burnt) { ctx.st.burnt = true; ctx.sim.event(ctx.part.id, "burn"); }
      }
      if (ctx.st.burnt) warn(ctx, "danger", "burnt", "This resistor burnt out — it was turning " + L.si(pa, "W") + " into heat and is only rated for " + L.si(rating, "W") + ".");
      else if (pa > rating) warn(ctx, "warn", "hot", "Running hot: " + L.si(pa, "W") + " in a " + L.si(rating, "W") + " resistor. Use a bigger value or a bigger resistor.");
    }
  };
  MODELS.k_resistor = {
    build: function (b, pr) { return { r: R(b, "a", "b", pr.ohms) }; },
    pre: function (m, ctx) { setR(m.r, ctx.props.ohms); },
    post: function (m, ctx) { ctx.st.i = iThrough(m.r); }
  };

  MODELS.potentiometer = {
    build: function (b, pr) { return { a: R(b, "1", "W", pr.ohms / 2), c: R(b, "W", "2", pr.ohms / 2) }; },
    pre: function (m, ctx) {
      var pos = L.clamp(ctx.props.pos == null ? 0.5 : ctx.props.pos, 0, 1), t = ctx.props.ohms;
      setR(m.a, Math.max(0.5, t * pos)); setR(m.c, Math.max(0.5, t * (1 - pos)));
    },
    post: function () {}
  };

  function capModel(pa, pb, polar) {
    return {
      dynamic: true,
      build: function (b, pr) { return { c: b.add(new Cap(pr.farads), [pa, pb]), leak: R(b, pa, pb, 1e9) }; },
      pre: function (m, ctx) { m.c.c = ctx.props.farads; m.c.dt = ctx.dt; if (ctx.st.burnt) setR(m.leak, 5); },
      post: function (m, ctx) {
        var v = vAcross(ctx, m.c);
        ctx.st.v = v;
        var vmax = ctx.props.vmax || 50;
        ctx.st.fill = Math.abs(v) / Math.max(1, Math.min(vmax, 12));
        if (polar && v < -0.8) {
          ctx.st.rev = (ctx.st.rev || 0) + ctx.dt;
          warn(ctx, "danger", "reversed", "This capacitor is in backwards: its stripe (−) side is at the higher voltage.");
          if (ctx.st.rev > 1.2 && !ctx.st.burnt) { ctx.st.burnt = true; ctx.sim.event(ctx.part.id, "pop"); }
        }
        if (polar && v > vmax * 1.05 && !ctx.st.burnt) {
          ctx.st.over = (ctx.st.over || 0) + ctx.dt;
          warn(ctx, "danger", "overvolt", "Over its " + vmax + " V rating.");
          if (ctx.st.over > 0.8) { ctx.st.burnt = true; ctx.sim.event(ctx.part.id, "pop"); }
        }
      },
      commit: function (m) { m.c.commit(); },
      reset: function (m) { m.c.v = 0; }
    };
  }
  MODELS.capacitor = capModel("1", "2", false);
  MODELS.capacitor_e = capModel("+", "-", true);

  MODELS.ldr = {
    build: function (b) { return { r: R(b, "1", "2", 1e4) }; },
    pre: function (m, ctx) { setR(m.r, 1e3 * Math.pow(1000, 1 - L.clamp(ctx.props.light, 0, 100) / 100)); },
    post: function () {}
  };
  MODELS.k_ldr = {
    build: function (b) { return { r: R(b, "a", "b", 1e4) }; },
    pre: function (m, ctx) { setR(m.r, 100 * Math.pow(500, 1 - L.clamp(ctx.props.light, 0, 100) / 100)); },
    post: function () {}
  };
  MODELS.thermistor = {
    build: function (b) { return { r: R(b, "1", "2", 1e4) }; },
    pre: function (m, ctx) { var T = ctx.props.temp + 273.15; setR(m.r, 1e4 * Math.exp(3950 * (1 / T - 1 / 298.15))); },
    post: function () {}
  };

  /* -------- semiconductors */

  MODELS.diode = {
    build: function (b) { return { d: b.add(new Diode(7e-9, 1.7 * VT), ["A", "K"]) }; },
    pre: function () {}, post: function (m, ctx) { ctx.st.i = iThrough(m.d); }
  };

  function ledDiode(color) {
    var c = L.LED_COLORS[color] || L.LED_COLORS.red, nvt = 2 * VT;
    return new Diode(0.02 / Math.exp(c.vf / nvt), nvt);
  }
  function ledLook(i, ctx, key) {
    var a = smooth(ctx.st, key || "ia", i, ctx);
    return L.clamp(Math.pow(Math.max(0, a) / 0.018, 0.6), 0, 1.4);
  }
  MODELS.led = {
    build: function (b, pr) { return { d: b.add(ledDiode(pr.color), ["A", "K"]) }; },
    pre: function (m, ctx) { m.d.open = !!ctx.st.burnt; },
    post: function (m, ctx) {
      var i = iThrough(m.d);
      ctx.st.i = i;
      ctx.st.b = ctx.st.burnt ? 0 : ledLook(i, ctx);
      var ia = ctx.st.ia;
      if (ia > 0.035 && !ctx.st.burnt) {
        ctx.st.cook = (ctx.st.cook || 0) + ctx.dt * (ia / 0.035);
        warn(ctx, "danger", "overcurrent", "Too much current: " + L.si(ia, "A") + " (an LED wants about 20 mA). Add a resistor in series — 220 Ω is a good start.");
        if (ctx.st.cook > 0.25) { ctx.st.burnt = true; ctx.sim.event(ctx.part.id, "pop"); }
      } else if (ctx.st.cook > 0) ctx.st.cook = Math.max(0, ctx.st.cook - ctx.dt);
      if (ctx.st.burnt) warn(ctx, "danger", "burnt", "This LED is burnt out. Add a resistor, then replace it.");
      var vr = -(ctx.v(m.d.n[0]) - ctx.v(m.d.n[1]));
      if (vr > 1.5 && !ctx.st.burnt) warn(ctx, "info", "reverse", "This LED is the wrong way round: the long leg (anode) needs to be on the + side.");
    }
  };
  MODELS.k_led = {
    build: function (b, pr) { var mid = b.node("m"); return { d: b.add(ledDiode(pr.color), ["+", mid]), r: R(b, mid, "-", 100) }; },
    pre: function () {},
    post: function (m, ctx) {
      var i = iThrough(m.d);
      ctx.st.i = i; ctx.st.b = ledLook(i * 1.6, ctx);
      if (ctx.v(m.d.n[1]) - ctx.v(m.d.n[0]) > 1.2) warn(ctx, "info", "reverse", "This light is the wrong way round. Swap its wires: red post to +.");
    }
  };
  MODELS.rgb_led = {
    build: function (b) {
      return { r: b.add(ledDiode("red"), ["R", "K"]), g: b.add(ledDiode("green"), ["G", "K"]), bl: b.add(ledDiode("blue"), ["B", "K"]) };
    },
    pre: function () {},
    post: function (m, ctx) {
      ctx.st.r = ledLook(iThrough(m.r), ctx, "ir");
      ctx.st.g = ledLook(iThrough(m.g), ctx, "ig");
      ctx.st.bl = ledLook(iThrough(m.bl), ctx, "ib");
      if (Math.max(ctx.st.ir || 0, ctx.st.ig || 0, ctx.st.ib || 0) > 0.035) warn(ctx, "danger", "overcurrent", "One of the colours is getting too much current. Each leg needs its own resistor.");
    }
  };

  function transistorPost(m, ctx, key, max, what) {
    var dev = m[key];
    var ic = Math.abs(dev.cur[0]);
    var vce = Math.abs(ctx.v(dev.n[0]) - ctx.v(dev.n[2]));
    var p = smooth(ctx.st, "p", ic * vce, ctx);
    ctx.st.i = dev.cur[0];
    ctx.st.hot = L.clamp(p / max - 0.5, 0, 1);
    if (p > max) {
      ctx.st.cook = (ctx.st.cook || 0) + ctx.dt;
      warn(ctx, "danger", "hot", "This " + what + " is overheating (" + L.si(p, "W") + "). Something is drawing too much current through it.");
      if (ctx.st.cook > 0.8 && !ctx.st.burnt) { ctx.st.burnt = true; ctx.sim.event(ctx.part.id, "burn"); }
    }
    var kv = ctx.sim.kicks[dev.n[0]] || 0;
    if (kv > vce) vce = kv;
    if (vce > 60 && !ctx.st.burnt) {
      ctx.st.burnt = true; ctx.sim.event(ctx.part.id, "spark");
      ctx.sim.warn(ctx.part.id, "danger", "kickback", "Killed by a voltage spike of " + L.si(vce, "V") + ". A coil (relay or motor) kicked back when it switched off — put a diode across the coil.");
    }
    dev.open = !!ctx.st.burnt;
  }
  MODELS.npn = {
    build: function (b, pr) { return { q: b.add(new BJT(1, pr.beta), ["C", "B", "E"]) }; },
    pre: function (m, ctx) { m.q.bf = ctx.props.beta || 150; m.q.open = !!ctx.st.burnt; },
    post: function (m, ctx) {
      transistorPost(m, ctx, "q", 0.6, "transistor");
      var ib = m.q.cur[1];
      if (ib > 0.03) warn(ctx, "warn", "base", "The base is taking " + L.si(ib, "A") + ". Put a resistor (1 kΩ is typical) in front of the base.");
    }
  };
  MODELS.pnp = {
    build: function (b, pr) { return { q: b.add(new BJT(-1, pr.beta), ["C", "B", "E"]) }; },
    pre: function (m, ctx) { m.q.bf = ctx.props.beta || 150; m.q.open = !!ctx.st.burnt; },
    post: function (m, ctx) { transistorPost(m, ctx, "q", 0.6, "transistor"); }
  };
  MODELS.nmos = {
    build: function (b) { return { q: b.add(new MOS(1.8, 20), ["D", "G", "S"]), gs: R(b, "G", "S", 1e9) }; },
    pre: function (m, ctx) { m.q.open = !!ctx.st.burnt; },
    post: function (m, ctx) { transistorPost(m, ctx, "q", 8, "MOSFET"); }
  };

  /* -------- switches */

  MODELS.button = {
    build: function (b) { return { s: R(b, "1a", "2a", 1e10) }; },
    pre: function (m, ctx) { setSw(m.s, ctx.sim.pressed[ctx.part.id]); ctx.st.on = !!ctx.sim.pressed[ctx.part.id]; },
    post: function () {}
  };
  MODELS.k_button = {
    build: function (b) { return { s: R(b, "a", "b", 1e10) }; },
    pre: function (m, ctx) { setSw(m.s, ctx.sim.pressed[ctx.part.id]); ctx.st.on = !!ctx.sim.pressed[ctx.part.id]; },
    post: function () {}
  };
  MODELS.slide_switch = {
    build: function (b) { return { l: R(b, "C", "L", 1), r: R(b, "C", "R", 1e10) }; },
    pre: function (m, ctx) { setSw(m.l, !ctx.props.on); setSw(m.r, !!ctx.props.on); },
    post: function () {}
  };
  MODELS.k_switch = {
    build: function (b) { return { s: R(b, "a", "b", 1e10) }; },
    pre: function (m, ctx) { setSw(m.s, !!ctx.props.on); },
    post: function () {}
  };
  MODELS.tilt_switch = {
    build: function (b) { return { s: R(b, "1", "2", 1e10) }; },
    pre: function (m, ctx) { setSw(m.s, !ctx.props.tilted); },
    post: function () {}
  };

  /* -------- lights and sound */

  function bulbModel(pa, pb) {
    return {
      dynamic: true,
      build: function (b) { return { r: R(b, pa, pb, 5), h: 0 }; },
      pre: function (m, ctx) {
        var pr = ctx.props, rhot = pr.volts * pr.volts / (pr.watts || 1);
        setR(m.r, ctx.st.burnt ? 1e10 : rhot / 8 + (rhot - rhot / 8) * m.h);
      },
      post: function (m, ctx) {
        var pr = ctx.props, i = iThrough(m.r), p = Math.abs(i * vAcross(ctx, m.r)), rated = pr.watts || 1;
        var k = ctx.dt > 0 && isFinite(ctx.dt) ? 1 - Math.exp(-ctx.dt / 0.06) : 1;
        m.h += (L.clamp(Math.sqrt(p / rated), 0, 1.6) - m.h) * k;
        ctx.st.i = i;
        ctx.st.b = ctx.st.burnt ? 0 : L.clamp(Math.pow(m.h, 1.6), 0, 1.5);
        if (p > rated * 2.2 && !ctx.st.burnt) {
          ctx.st.cook = (ctx.st.cook || 0) + ctx.dt;
          warn(ctx, "warn", "over", "This bulb is being overdriven: " + L.si(p, "W") + " into a " + L.si(rated, "W") + " bulb.");
          if (ctx.st.cook > 0.35) { ctx.st.burnt = true; ctx.sim.event(ctx.part.id, "pop"); }
        }
        if (ctx.st.burnt) warn(ctx, "danger", "burnt", "The filament snapped — too much voltage for this bulb.");
      },
      reset: function (m) { m.h = 0; }
    };
  }
  MODELS.bulb = bulbModel("1", "2");
  MODELS.k_bulb = bulbModel("a", "b");

  MODELS.buzzer = {
    build: function (b) { return { r: R(b, "+", "-", 160) }; },
    pre: function () {},
    post: function (m, ctx) { var v = smooth(ctx.st, "v", vAcross(ctx, m.r), ctx); ctx.st.sound = v > 1.6 ? 2300 : 0; ctx.st.i = iThrough(m.r); }
  };
  MODELS.k_buzzer = {
    build: function (b) { return { r: R(b, "+", "-", 120) }; },
    pre: function () {},
    post: function (m, ctx) {
      var v = smooth(ctx.st, "v", vAcross(ctx, m.r), ctx);
      ctx.st.sound = v > 1.0 ? 1800 : 0;
      if (v < -1) warn(ctx, "info", "reverse", "The buzzer is the wrong way round. Red post to +.");
    }
  };
  MODELS.piezo = {
    build: function (b) { return { r: R(b, "+", "-", 2000) }; },
    pre: function () {},
    post: function (m, ctx) {
      var f = ctx.sim.toneOn(m.r.n[0]) || ctx.sim.toneOn(m.r.n[1]);
      /* judged on the average, as an ear would: the square wave itself is
       * high half the time and low the other half */
      var v = smooth(ctx.st, "v", Math.abs(ctx.v(m.r.n[0]) - ctx.v(m.r.n[1])), ctx);
      ctx.st.sound = f && v > 0.3 ? f : 0;
    }
  };

  /* -------- motion */

  function motorModel(pa, pb, r) {
    var k = 0.0053, J = 1.2e-6, b = 6e-7;
    return {
      dynamic: true,
      build: function (bb) { return { src: bb.add(new Norton(1 / r, 0), [pa, pb]), w: 0, ang: 0 }; },
      pre: function (m) { m.src.gv = 1 / r; m.src.is = k * m.w / r; },
      post: function (m, ctx) {
        var i = iThrough(m.src);
        var dt = ctx.dt > 0 && isFinite(ctx.dt) ? ctx.dt : 0.016;
        var torque = k * i - b * m.w - (Math.abs(m.w) > 1 ? 2e-5 * Math.sign(m.w) : 0);
        if (Math.abs(m.w) <= 1 && Math.abs(k * i) < 2e-5) { m.w = 0; torque = 0; }
        m.w += torque / J * dt;
        m.ang += m.w * dt * 57.3 * 0.05;
        ctx.st.w = m.w; ctx.st.ang = m.ang; ctx.st.i = i;
        ctx.st.spin = Math.abs(m.w) / 900;
      },
      reset: function (m) { m.w = 0; }
    };
  }
  MODELS.motor = motorModel("1", "2", 4);
  MODELS.k_motor = motorModel("a", "b", 6);

  MODELS.servo = {
    dynamic: true,
    build: function (b) { return { pwr: R(b, "V+", "GND", 1000), sig: R(b, "SIG", "GND", 1e5), ang: 90 }; },
    pre: function (m, ctx) { setR(m.pwr, m.moving ? 60 : 800); },
    post: function (m, ctx) {
      var vcc = vAcross(ctx, m.pwr), target = ctx.sim.servoOn(m.sig.n[0]);
      var dt = ctx.dt > 0 && isFinite(ctx.dt) ? ctx.dt : 0.016;
      m.moving = false;
      if (vcc > 4 && target != null) {
        var d = target - m.ang, step = 600 * dt;
        if (Math.abs(d) > 0.5) { m.ang += L.clamp(d, -step, step); m.moving = true; }
      } else if (vcc > 4 && target == null && ctx.sim.mcuRunning) {
        warn(ctx, "info", "nosignal", "The servo has power but no signal. Wire SIG to an Arduino pin and use servo.attach().");
      }
      if (vcc > 0.5 && vcc < 4) warn(ctx, "warn", "lowpower", "A servo needs about 5 V on its red wire.");
      ctx.st.ang = m.ang;
    },
    reset: function (m) { m.ang = 90; }
  };

  MODELS.relay_module = {
    build: function (b) {
      return { coil: R(b, "VCC", "GND", 1e9), inp: R(b, "IN", "GND", 1e4), no: R(b, "COM", "NO", 1e10), nc: R(b, "COM", "NC", 0.02), on: false };
    },
    pre: function (m, ctx) { setR(m.coil, m.on ? 70 : 1e7); setSw(m.no, m.on); setSw(m.nc, !m.on); },
    post: function (m, ctx) {
      var vin = ctx.v(m.inp.n[0]) - ctx.v(m.inp.n[1]), vcc = ctx.v(m.coil.n[0]) - ctx.v(m.coil.n[1]);
      var want = vcc > 3.5 && vin > (m.on ? 1.2 : 2.0);
      if (want !== m.on) { m.on = want; ctx.sim.event(ctx.part.id, "click"); }
      ctx.st.on = m.on;
      if (vin > 2 && vcc < 3.5) warn(ctx, "warn", "nopower", "IN is high but the module has no power. Wire VCC to 5 V and GND to ground.");
    },
    reset: function (m) { m.on = false; }
  };

  MODELS.relay = {
    dynamic: true,
    build: function (b) {
      var mid = b.node("c");
      return {
        r: R(b, "C1", mid, 70), l: b.add(new Ind(0.12), [mid, "C2"]), par: R(b, "C1", "C2", 8000),
        no: R(b, "COM", "NO", 1e10), nc: R(b, "COM", "NC", 0.02), on: false
      };
    },
    pre: function (m, ctx) { m.l.dt = ctx.dt; setSw(m.no, m.on); setSw(m.nc, !m.on); },
    post: function (m, ctx) {
      var i = Math.abs(m.l.cur[0]);
      var want = m.on ? i > 0.018 : i > 0.045;
      if (want !== m.on) { m.on = want; ctx.sim.event(ctx.part.id, "click"); }
      ctx.st.on = m.on;
      /* A millisecond step is far too coarse to see a coil's spike — it is
       * over in microseconds. So spot it the way an engineer would: if the
       * coil's current collapsed in one step, something broke the circuit
       * on it, and all that current had nowhere to go but through the
       * coil's own leakage. That is the voltage the switch saw. */
      var before = Math.abs(m.l.iL);
      if (before > 0.01 && i < before * 0.3) {
        var spike = before * 8000;
        ctx.sim.kick(m.par.n[0], spike); ctx.sim.kick(m.par.n[1], spike);
        ctx.sim.event(ctx.part.id, "spark");
        m.kickT = 1.5;
      }
      if (m.kickT > 0) {
        m.kickT -= ctx.dt > 0 && isFinite(ctx.dt) ? ctx.dt : 0.016;
        warn(ctx, "danger", "kickback", "The coil kicked back about " + L.si(before * 8000 || 500, "V", 2) + " when it switched off. Put a diode across the coil (stripe towards +) to soak that up.");
      }
    },
    commit: function (m) { m.l.commit(); },
    reset: function (m) { m.l.iL = 0; m.on = false; }
  };

  /* -------- displays */

  MODELS.seg7 = {
    build: function (b, pr) {
      var segs = {}, anode = pr.common === "anode";
      ["A", "B", "C", "D", "E", "F", "G", "DP"].forEach(function (k) {
        segs[k] = b.add(ledDiode("red"), anode ? ["COM1", k] : [k, "COM1"]);
      });
      return { segs: segs };
    },
    pre: function () {},
    post: function (m, ctx) {
      var seg = ctx.st.seg || (ctx.st.seg = {}), worst = 0;
      for (var k in m.segs) {
        var i = iThrough(m.segs[k]);
        seg[k] = ledLook(i, ctx, "i" + k);
        worst = Math.max(worst, ctx.st["i" + k]);
      }
      if (worst > 0.035) warn(ctx, "danger", "overcurrent", "A segment is taking " + L.si(worst, "A") + ". Every segment pin needs its own resistor (220 Ω).");
    }
  };

  MODELS.lcd_i2c = {
    build: function (b) { return { pwr: R(b, "VCC", "GND", 200), sda: R(b, "SDA", "GND", 1e6), scl: R(b, "SCL", "GND", 1e6) }; },
    pre: function () {},
    post: function (m, ctx) {
      var on = vAcross(ctx, m.pwr) > 4;
      ctx.st.on = on;
      var lcd = on ? ctx.sim.lcdOn(m.sda.n[0], m.scl.n[0]) : null;
      ctx.st.rows = lcd ? lcd.rows : ["", ""];
      if (on && !lcd && ctx.sim.mcuRunning) warn(ctx, "info", "nobus", "The screen has power but no data. Wire SDA to A4 and SCL to A5.");
    }
  };

  /* -------- sensors */

  MODELS.tmp36 = {
    build: function (b) { return { pwr: R(b, "+V", "GND", 1e5), out: Vs(b, "OUT", "GND", 0, 100) }; },
    pre: function (m, ctx) {
      var on = (ctx.v(m.pwr.n[0]) - ctx.v(m.pwr.n[1])) > 2.6;
      if (on) setV(m.out, 0.5 + 0.01 * ctx.props.temp, 100); else setR(m.out, 1e8);
    },
    post: function () {}
  };

  MODELS.hcsr04 = {
    build: function (b) { return { pwr: R(b, "VCC", "GND", 330), trig: R(b, "TRIG", "GND", 1e6), echo: Vs(b, "ECHO", "GND", 0, 50) }; },
    pre: function () {},
    post: function (m, ctx) {
      ctx.st.on = vAcross(ctx, m.pwr) > 4;
      ctx.st.ping = ctx.st.pingT > 0;
      if (ctx.st.pingT > 0) ctx.st.pingT -= ctx.dt > 0 && isFinite(ctx.dt) ? ctx.dt : 0.016;
    }
  };

  MODELS.pir = {
    build: function (b) { return { pwr: R(b, "VCC", "GND", 7e4), out: Vs(b, "OUT", "GND", 0, 100) }; },
    pre: function (m, ctx) {
      var on = (ctx.v(m.pwr.n[0]) - ctx.v(m.pwr.n[1])) > 4;
      setV(m.out, on && ctx.props.motion ? 3.3 : 0, 100);
    },
    post: function () {}
  };

  var MOD_CURVE = {
    soil:  function (f) { return 1 - 0.72 * f; },
    gas:   function (f) { return 0.08 + 0.85 * f; },
    sound: function (f) { return 0.1 + 0.8 * f * (0.85 + 0.15 * Math.random()); },
    flame: function (f) { return 1 - 0.9 * f; },
    ir:    function (f) { return 1 - 0.9 * f; }
  };
  ["soil", "gas", "sound", "flame", "ir"].forEach(function (k) {
    MODELS["mod_" + k] = {
      build: function (b) { return { pwr: R(b, "VCC", "GND", 1000), ao: Vs(b, "AO", "GND", 0, 1000), dout: Vs(b, "DO", "GND", 0, 1000) }; },
      pre: function (m, ctx) {
        var vcc = ctx.v(m.pwr.n[0]) - ctx.v(m.pwr.n[1]);
        if (vcc < 2.5) { setR(m.ao, 1e8); setR(m.dout, 1e8); ctx.st.d = false; return; }
        var f = L.clamp(ctx.props.level, 0, 100) / 100;
        var trip = ctx.props.level >= ctx.props.threshold;
        setV(m.ao, vcc * MOD_CURVE[k](f), 1000);
        setV(m.dout, trip ? 0 : vcc, 1000);
        ctx.st.d = trip;
      },
      post: function () {}
    };
  });

  /* -------- chips */

  MODELS.ic555 = {
    build: function (b) {
      var x = b.node("x");
      return {
        r1: R(b, "8", "5", 5000), r2: R(b, "5", x, 5000), r3: R(b, x, "1", 5000),
        out: Vs(b, "3", "1", 0, 10), dis: R(b, "7", "1", 1e10), iq: R(b, "8", "1", 3000), q: false
      };
    },
    dynamic: true,
    pre: function (m, ctx) {
      var g = ctx.v(m.r3.n[1]);
      var vcc = ctx.v(m.r1.n[0]) - g;
      var hi = ctx.v(m.r1.n[1]) - g, lo = ctx.v(m.r2.n[1]) - g;
      var trig = ctx.pinV("2") - g, thr = ctx.pinV("6") - g, rst = ctx.pinV("4") - g;
      var on = vcc > 3;
      if (!on || rst < 0.7) m.q = false;
      else if (trig < lo) m.q = true;
      else if (thr > hi) m.q = false;
      if (on && !ctx.pinWired("4")) ctx.sim.warn(ctx.part.id, "info", "reset", "Pin 4 (RESET) is floating. Tie it to VCC so the timer can run.");
      setV(m.out, on ? (m.q ? vcc - 1.7 : 0.1) : 0, on ? 10 : 1e7);
      setSw(m.dis, on && !m.q);
      ctx.st.q = m.q;
    },
    post: function () {},
    reset: function (m) { m.q = false; }
  };

  function gateChip(map, fn) {
    /* map: [[inA, inB, out], ...] by pin number; inB null for inverters */
    return {
      dynamic: true,
      build: function (b) {
        var outs = map.map(function (g) { return Vs(b, String(g[2]), "7", 0, 1e7); });
        return { outs: outs, iq: R(b, "14", "7", 5000), q: map.map(function () { return false; }) };
      },
      pre: function (m, ctx) {
        var gnd = ctx.pinV("7"), vcc = ctx.pinV("14") - gnd, on = vcc > 2;
        map.forEach(function (g, i) {
          var a = ctx.pinV(String(g[0])) - gnd, bb = g[1] ? ctx.pinV(String(g[1])) - gnd : 0;
          var th = vcc / 2;
          var A = a > th, B = bb > th;
          m.q[i] = on && fn(ctx, A, B);
          setV(m.outs[i], m.q[i] ? vcc : 0, on ? 25 : 1e7);
        });
      },
      post: function () {}
    };
  }
  var QUAD = [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]];
  MODELS.logic_ic = gateChip(QUAD, function (ctx, a, b) { return !!(L.GATES[ctx.props.chip] || L.GATES["7408"]).fn(a, b); });
  MODELS.ic7404 = gateChip([[1, null, 2], [3, null, 4], [5, null, 6], [9, null, 8], [11, null, 10], [13, null, 12]], function (ctx, a) { return !a; });

  MODELS.lm358 = {
    build: function (b) {
      return {
        a: b.add(new OpAmp(), ["1", "3", "2", "8", "4"]),
        b2: b.add(new OpAmp(), ["7", "5", "6", "8", "4"]),
        iq: R(b, "8", "4", 7000)
      };
    },
    pre: function () {}, post: function () {}
  };

  /* -------- instruments */

  MODELS.multimeter = {
    build: function (b, pr) {
      if (pr.mode === "A") return { r: R(b, "V", "COM", 0.1), mode: "A" };
      if (pr.mode === "R") return { r: Vs(b, "V", "COM", 2, 10000), mode: "R" };
      return { r: R(b, "V", "COM", 1e7), mode: "V" };
    },
    pre: function () {},
    post: function (m, ctx) {
      var st = ctx.st;
      if (m.mode === "A") {
        var i = smooth(st, "val", iThrough(m.r), ctx), a = Math.abs(i);
        st.unit = a >= 1 ? "A" : "mA";
        st.text = a >= 1 ? i.toFixed(2) : (i * 1000).toFixed(a < 0.01 ? 2 : 1);
        if (a > 10) warn(ctx, "danger", "fuse", "That is a lot of current through the meter. In amps mode it must go in line with a part, never straight across a battery.");
      } else if (m.mode === "R") {
        var v = smooth(st, "val", vAcross(ctx, m.r), ctx);
        if (v > 1.995 || v < -0.01) { st.text = "OL"; st.unit = "Ω"; }
        else {
          var ohm = 10000 * v / (2 - v);
          st.unit = ohm >= 1e6 ? "MΩ" : ohm >= 1e3 ? "kΩ" : "Ω";
          var shown = ohm >= 1e6 ? ohm / 1e6 : ohm >= 1e3 ? ohm / 1e3 : ohm;
          st.text = shown.toFixed(shown >= 100 ? 0 : shown >= 10 ? 1 : 2);
        }
        if (ctx.sim.powered) warn(ctx, "info", "live", "Ohms mode only reads true with the power disconnected.");
      } else {
        var vv = smooth(st, "val", vAcross(ctx, m.r), ctx);
        st.unit = "V";
        st.text = Math.abs(vv) >= 100 ? vv.toFixed(0) : vv.toFixed(2);
      }
    }
  };

  MODELS.scope = {
    dynamic: true,
    build: function (b) { return { c1: R(b, "CH1", "GND", 1e6), c2: R(b, "CH2", "GND", 1e6), buf: [[], []], acc: 0 }; },
    pre: function () {},
    post: function (m, ctx) {
      var span = ctx.sim.scopeSpan || 2, n = 160, every = span / n;
      m.acc += ctx.dt > 0 && isFinite(ctx.dt) ? ctx.dt : 0.016;
      if (m.acc < every) return;
      m.acc = 0;
      var connected1 = ctx.pinWired("CH1"), connected2 = ctx.pinWired("CH2");
      m.buf[0].push(connected1 ? vAcross(ctx, m.c1) : null);
      m.buf[1].push(connected2 ? vAcross(ctx, m.c2) : null);
      if (m.buf[0].length > n) { m.buf[0].shift(); m.buf[1].shift(); }
      ctx.st.trace = [m.buf[0].filter(function (v) { return v != null; }), m.buf[1].filter(function (v) { return v != null; })];
      var top = 1;
      ctx.st.trace.forEach(function (arr) { arr.forEach(function (v) { if (v > top) top = v; }); });
      ctx.st.vmax = top <= 3.3 ? 3.5 : top <= 5.2 ? 5.5 : Math.ceil(top / 5) * 5;
      ctx.st.raw = m.buf;
    },
    reset: function (m) { m.buf = [[], []]; }
  };

  /* -------- microcontrollers */

  /* Arduino pin numbering. D0-13 are 0-13, A0-A5 are 14-19, A6/A7 (Nano
   * only, analogue-only) are 20/21. */
  var PINNUM = {};
  for (var d = 0; d <= 13; d++) PINNUM["D" + d] = d;
  for (var a = 0; a <= 7; a++) PINNUM["A" + a] = 14 + a;
  L.PINNUM = PINNUM;
  L.pinName = function (num) { return num >= 14 ? "A" + (num - 14) : "D" + num; };

  function mcuModel(gndPin, names, kid) {
    return {
      dynamic: true,
      mcu: true,
      build: function (b) {
        var m = { v5: Vs(b, "5V", gndPin, 5, 0.05), pins: {}, nameOf: {} };
        if (!kid) m.v33 = Vs(b, "3V3", gndPin, 3.3, 0.5);
        names.forEach(function (nm) {
          var real = kid ? L.BRAIN_MAP[nm] : nm;
          var num = PINNUM[real];
          m.pins[num] = b.add(new Norton(1e-8, 0), [nm, gndPin]);
          m.nameOf[num] = nm;
          if (kid && /^IN|EYE/.test(nm)) m.pins[num].pull = R(b, nm, gndPin, 10000);
        });
        return m;
      },
      pre: function (m, ctx) {
        var rt = ctx.sim.runtimeFor(ctx.part.id), t = ctx.sim.t;
        for (var num in m.pins) {
          var dev = m.pins[num], ps = rt && rt.pins[num];
          if (!ps || ps.mode === "IN") { dev.gv = 1e-8; dev.is = 0; continue; }
          if (ps.mode === "PU") { dev.gv = 1 / 35000; dev.is = 5 / 35000; continue; }
          var hi = ps.out;
          if (ps.tone > 0) hi = ((t * 125) % 1) < 0.5;
          else if (ps.pwm != null && ps.pwm >= 0) {
            var duty = ps.pwm / 255;
            hi = duty >= 1 ? true : duty <= 0 ? false : ((t * 125) % 1) < duty;
          }
          var r = kid ? 4 : 25;
          dev.gv = 1 / r; dev.is = hi ? 5 / r : 0;
        }
      },
      post: function (m, ctx) {
        var rt = ctx.sim.runtimeFor(ctx.part.id), st = ctx.st;
        st.on = true;
        st.busy = !!(rt && rt.running && !rt.paused);
        var p13 = rt && rt.pins[13];
        st.l = !!(p13 && p13.mode === "OUT" && (p13.out || p13.pwm > 0));
        st.tx = rt && rt.txUntil > ctx.sim.wall;
        if (kid && rt) {
          ["OUT1", "OUT2", "OUT3", "OUT4"].forEach(function (nm, i) {
            var ps = rt.pins[PINNUM[L.BRAIN_MAP[nm]]];
            st["o" + (i + 1)] = !!(ps && ps.mode === "OUT" && (ps.out || ps.pwm > 0 || ps.tone > 0));
          });
        }
        for (var num in m.pins) {
          var i = Math.abs(m.pins[num].cur[0]);
          if (!kid && i > 0.04) {
            warn(ctx, "danger", "pin" + num, "Pin " + m.nameOf[num] + " is supplying " + L.si(i, "A") + " — an Arduino pin can safely give about 20 mA (40 mA absolute max). Use a resistor, or a transistor for big loads.");
          }
        }
        var i5 = -iThrough(m.v5);
        if (i5 > 0.5) warn(ctx, "danger", "5v", "The 5V pin is supplying " + L.si(i5, "A") + ". USB power tops out around 500 mA — is something shorted?");
      }
    };
  }
  var UNO_IO = []; for (d = 0; d <= 13; d++) UNO_IO.push("D" + d); for (a = 0; a <= 5; a++) UNO_IO.push("A" + a);
  var NANO_IO = UNO_IO.concat(["A6", "A7"]);
  MODELS.arduino_uno = mcuModel("GND1", UNO_IO);
  MODELS.arduino_nano = mcuModel("GND1", NANO_IO);
  MODELS.k_brain = mcuModel("GND1", ["OUT1", "OUT2", "OUT3", "OUT4", "IN1", "IN2", "EYE"], true);

  /* =============================================================== THE SIM */

  function Sim() {
    this.t = 0; this.wall = 0;
    this.timeScale = 1;
    this.pressed = {};
    this.state = {};          /* per part: what it looks like right now */
    this.wireI = {};          /* per wire: current a->b, amps */
    this.events = [];         /* pops, clicks and sparks for the effects layer */
    this.runtimes = {};       /* MCU id -> runtime (set by the program panel) */
    this.warnings = [];
    this.topo = null;
    this.scopeSpan = 2;
    this.kicks = {};
  }
  L.Sim = Sim;

  Sim.prototype.reset = function () {
    this.t = 0;
    this.state = {};
    this.events = [];
    this.wireI = {};
    if (this.topo) this.topo.inst.forEach(function (it) {
      var md = MODELS[it.part.type];
      if (md && md.reset) md.reset(it.m);
      it.devs.forEach(function (dv) {
        if (dv.k === "C") dv.v = 0;
        if (dv.k === "L") dv.iL = 0;
        if (dv.vd != null) dv.vd = 0;
        if (dv.vbe != null) { dv.vbe = 0; dv.vbc = 0; }
        if (dv.vgs != null) { dv.vgs = 0; dv.vds = 0; }
      });
    });
    if (this.topo) this.topo.x.fill(0);
  };

  /* Ask for the topology to be rebuilt on the next step. Cheap to call: the
   * bench calls it on every edit. */
  Sim.prototype.invalidate = function () { this.topoDirty = true; };

  Sim.prototype.load = function (doc) { this.doc = doc; this.topoDirty = true; };

  /* ------------------------------------------------------------ topology */

  Sim.prototype.build = function () {
    var doc = this.doc, self = this;
    var pins = {}, grid = {}, parent = {}, edges = [], wireEnds = {};
    function find(k) { while (parent[k] !== k) { parent[k] = parent[parent[k]]; k = parent[k]; } return k; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }
    function vertex(k) { if (parent[k] == null) parent[k] = k; }

    var partById = {};
    doc.parts.forEach(function (part) {
      partById[part.id] = part;
      L.pinsOf(part).forEach(function (p) {
        pins[p.key] = p; vertex(p.key);
        var g = L.gridKey(p.x, p.y);
        (grid[g] = grid[g] || []).push(p.key);
      });
    });

    /* legs that land on the same spot are connected: a leg in a hole, an
     * LED pushed straight into an Arduino header */
    var active = {};
    Object.keys(grid).forEach(function (g) {
      var list = grid[g];
      if (list.length < 2) return;
      for (var i = 1; i < list.length; i++) { union(list[0], list[i]); edges.push({ a: list[0], b: list[i], kind: "plug" }); }
      list.forEach(function (k) { active[k] = 1; });
    });

    /* wires */
    var wires = [];
    doc.wires.forEach(function (w) {
      var ends = ["a", "b"].map(function (side) {
        var e = w[side] || {}, key = null;
        if (e.ref && pins[e.ref]) key = e.ref;
        else if (e.x != null) {
          var g = grid[L.gridKey(e.x, e.y)];
          if (g && g.length) {
            key = g[0];
            for (var i = 0; i < g.length; i++) if (!pins[g[i]].hole) { key = g[i]; break; }
          }
        }
        if (!key) { key = "w:" + w.id + ":" + side; vertex(key); }
        active[key] = 1;
        return key;
      });
      wireEnds[w.id] = ends;
      union(ends[0], ends[1]);
      var e = { a: ends[0], b: ends[1], kind: "wire", wire: w.id };
      edges.push(e); wires.push(e);
    });

    /* buses inside parts, chained through their active members only */
    doc.parts.forEach(function (part) {
      var d = L.def(part);
      (d && d.buses || []).forEach(function (bus) {
        var keys = bus.map(function (nm) { return part.id + ":" + nm; }).filter(function (k) { return pins[k]; });
        for (var i = 1; i < keys.length; i++) union(keys[0], keys[i]);
        var on = keys.filter(function (k) { return active[k] || !pins[k].hole; });
        for (i = 1; i < on.length; i++) edges.push({ a: on[i - 1], b: on[i], kind: "bus" });
      });
    });

    /* devices */
    var nodeOf = {}, nodeCount = 0, inst = [], devices = [];
    function node(key) {
      var r = find(key);
      if (nodeOf[r] == null) nodeOf[r] = ++nodeCount;
      return nodeOf[r];
    }
    doc.parts.forEach(function (part) {
      var md = MODELS[part.type];
      if (!md) return;
      var pr = L.propsOf(part), devs = [];
      var b = {
        add: function (dev, terms) {
          dev.p = terms.map(function (t) { return t.charAt(0) === "#" ? part.id + ":" + t : part.id + ":" + t; });
          dev.p.forEach(function (k) { if (parent[k] == null) { vertex(k); } });
          dev.n = dev.p.map(node);
          dev.cur = new Float64Array(dev.p.length);
          devs.push(dev); devices.push(dev);
          return dev;
        },
        node: function (name) { return "#" + name; }
      };
      var m = md.build(b, pr, part);
      inst.push({ part: part, m: m, devs: devs, model: md });
    });

    /* one reference per connected island, preferring a pin called ground */
    var adj = {};
    devices.forEach(function (dv) {
      for (var i = 1; i < dv.n.length; i++) {
        var x = dv.n[0], y = dv.n[i];
        (adj[x] = adj[x] || []).push(y); (adj[y] = adj[y] || []).push(x);
      }
    });
    var gndPref = {};
    Object.keys(pins).forEach(function (k) {
      var nm = pins[k].name;
      if (/^(GND\d?|-)$/.test(nm)) { var r = find(k); if (nodeOf[r]) gndPref[nodeOf[r]] = 1; }
    });
    var seen = {}, refs = [];
    for (var nn = 1; nn <= nodeCount; nn++) {
      if (seen[nn]) continue;
      var stack = [nn], island = [];
      seen[nn] = 1;
      while (stack.length) {
        var cur = stack.pop(); island.push(cur);
        (adj[cur] || []).forEach(function (y) { if (!seen[y]) { seen[y] = 1; stack.push(y); } });
      }
      var ref = island[0];
      for (var q = 0; q < island.length; q++) if (gndPref[island[q]]) { ref = island[q]; break; }
      refs.push(ref);
    }

    /* the flow graph: one per node, made of everything conductive in it */
    var groups = {};
    Object.keys(parent).forEach(function (k) {
      if (!active[k] && !(pins[k] && !pins[k].hole) && k.indexOf("w:") !== 0) return;
      var r = find(k);
      (groups[r] = groups[r] || { verts: [], edges: [] }).verts.push(k);
    });
    edges.forEach(function (e) { var g = groups[find(e.a)]; if (g) g.edges.push(e); });

    var pinNode = {}, terminals = {};
    Object.keys(pins).forEach(function (k) {
      var r = find(k); pinNode[k] = nodeOf[r] || 0;
      if (!pins[k].hole) terminals[r] = (terminals[r] || 0) + 1;
    });

    this.topo = {
      pins: pins, find: find, nodeOf: nodeOf, pinNode: pinNode, n: nodeCount,
      inst: inst, devices: devices, refs: refs, groups: groups, wires: wires, wireEnds: wireEnds, terminals: terminals,
      partById: partById,
      M: new Mat(Math.max(1, nodeCount)),
      x: new Float64Array(Math.max(1, nodeCount)),
      avgV: new Float64Array(nodeCount + 1),
      pinI: {}, hasDynamic: inst.some(function (it) { return it.model.dynamic; }),
      mcus: inst.filter(function (it) { return it.model.mcu; }).map(function (it) { return it.part.id; })
    };
    this.topoDirty = false;
    this.state = this.state || {};
    inst.forEach(function (it) { self.state[it.part.id] = self.state[it.part.id] || {}; });
    return this.topo;
  };

  /* --------------------------------------------------------------- solve */

  Sim.prototype.solveOnce = function (dt) {
    var T = this.topo, M = T.M, x = T.x, n = T.n, devs = T.devices, i, k;
    if (!n) return true;
    var xs = new Float64Array(n), converged = false;
    for (var iter = 0; iter < MAX_NR; iter++) {
      M.clear();
      for (i = 0; i < devs.length; i++) devs[i].stamp(M, x);
      for (i = 0; i < n; i++) M.A[i * n + i] += GMIN;
      for (i = 0; i < T.refs.length; i++) { var r = T.refs[i]; M.A[(r - 1) * n + r - 1] += 1e3; }
      xs.set(M.b);
      var A2 = M.A;   /* solve() works in place; the matrix is rebuilt next iteration anyway */
      solve(A2, xs, n);
      var ok = true;
      for (i = 0; i < n; i++) {
        if (!isFinite(xs[i])) { xs[i] = x[i]; continue; }
        if (Math.abs(xs[i] - x[i]) > 1e-6 + 1e-4 * Math.abs(xs[i])) ok = false;
      }
      var jmax = 0;
      for (i = 0; i < devs.length; i++) if (devs[i].accept) { var dj = devs[i].accept(); if (dj > jmax) jmax = dj; }
      /* damp very large swings: keeps a short across a battery from
       * oscillating between two wrong answers */
      if (iter > 25) for (i = 0; i < n; i++) xs[i] = x[i] + (xs[i] - x[i]) * 0.5;
      x.set(xs);
      if (ok && jmax < 1e-5 && iter > 0) { converged = true; break; }
    }
    for (i = 0; i < devs.length; i++) devs[i].current(x);
    return converged;
  };

  /* ---------------------------------------------------------------- step */

  Sim.prototype.warn = function (partId, level, code, msg) {
    var key = partId + ":" + code;
    if (this._warnSeen[key]) return;
    this._warnSeen[key] = 1;
    this.warnings.push({ part: partId, level: level, code: code, msg: msg });
  };
  Sim.prototype.kick = function (node, volts) { if (node) this.kicks[node] = Math.max(this.kicks[node] || 0, volts); };
  Sim.prototype.event = function (partId, kind) { this.events.push({ part: partId, kind: kind, t: this.wall }); };
  Sim.prototype.runtimeFor = function (id) { return this.runtimes[id] || null; };

  /* Which MCU pin, if any, sits on this node — used by servos, piezos and
   * the screen to find out what the program is telling them. */
  Sim.prototype.mcuPinsOnNode = function (node) {
    var T = this.topo, out = [];
    if (!node) return out;
    for (var i = 0; i < T.inst.length; i++) {
      var it = T.inst[i];
      if (!it.model.mcu) continue;
      for (var num in it.m.pins) if (it.m.pins[num].n[0] === node) out.push({ id: it.part.id, num: +num });
    }
    return out;
  };
  Sim.prototype.toneOn = function (node) {
    var list = this.mcuPinsOnNode(node);
    for (var i = 0; i < list.length; i++) {
      var rt = this.runtimes[list[i].id], ps = rt && rt.pins[list[i].num];
      if (ps && ps.tone > 0) return ps.tone;
    }
    return 0;
  };
  Sim.prototype.servoOn = function (node) {
    var list = this.mcuPinsOnNode(node);
    for (var i = 0; i < list.length; i++) {
      var rt = this.runtimes[list[i].id];
      if (rt && rt.servos[list[i].num] != null) return rt.servos[list[i].num];
    }
    return null;
  };
  Sim.prototype.lcdOn = function (sdaNode, sclNode) {
    var a = this.mcuPinsOnNode(sdaNode), b = this.mcuPinsOnNode(sclNode);
    for (var i = 0; i < a.length; i++) {
      if (a[i].num !== 18) continue;
      for (var j = 0; j < b.length; j++) {
        if (b[j].num === 19 && b[j].id === a[i].id) {
          var rt = this.runtimes[a[i].id];
          if (rt && rt.lcd) return rt.lcd;
        }
      }
    }
    return null;
  };

  /* Volts at an MCU pin, relative to that board's ground. */
  Sim.prototype.mcuVolts = function (id, num) {
    var T = this.topo;
    if (!T) return 0;
    for (var i = 0; i < T.inst.length; i++) {
      var it = T.inst[i];
      if (it.part.id !== id) continue;
      var dev = it.m.pins[num];
      if (!dev) return 0;
      return (dev.n[0] ? T.x[dev.n[0] - 1] : 0) - (dev.n[1] ? T.x[dev.n[1] - 1] : 0);
    }
    return 0;
  };
  /* HC-SR04 sitting on this MCU pin's node: how far away is the object? */
  Sim.prototype.echoDistance = function (id, num) {
    var T = this.topo, self = this;
    var node = null;
    T.inst.forEach(function (it) { if (it.part.id === id && it.m.pins[num]) node = it.m.pins[num].n[0]; });
    var found = null;
    T.inst.forEach(function (it) {
      if (it.part.type !== "hcsr04" || found) return;
      if (it.m.echo.n[0] === node) {
        var st = self.state[it.part.id] || {};
        if (st.on) { found = L.propsOf(it.part).cm; st.pingT = 0.12; }
      }
    });
    return found;
  };

  Sim.prototype.step = function (wallDt) {
    if (!this.doc) return;
    if (this.topoDirty || !this.topo) this.build();
    var T = this.topo, self = this;
    this.warnings = []; this._warnSeen = {};
    this.wall += wallDt;
    var target = Math.min(0.1, wallDt) * this.timeScale;
    this.mcuRunning = T.mcus.some(function (id) { var rt = self.runtimes[id]; return rt && rt.running; });
    var dynamic = T.hasDynamic || this.mcuRunning;
    var steps, dt;
    if (dynamic) {
      steps = Math.max(1, Math.min(MAX_STEPS, Math.round(target / DT)));
      dt = DT;
    } else { steps = 1; dt = Infinity; }
    var alpha = dt === Infinity ? 1 : 1 - Math.exp(-dt / SMOOTH);
    var ctxBase = { sim: this, dt: dt, alpha: alpha };

    var pinNodeFn = function (it) {
      return function (nm) { return T.pinNode[it.part.id + ":" + nm] || 0; };
    };
    var vfn = function (node) { return node ? T.x[node - 1] : 0; };
    var ctxs = T.inst.map(function (it) {
      var c = Object.create(ctxBase);
      c.part = it.part; c.props = L.propsOf(it.part); c.st = self.state[it.part.id] || (self.state[it.part.id] = {});
      c.v = vfn;
      var pn = pinNodeFn(it);
      c.pinV = function (nm) { return vfn(pn(nm)); };
      c.pinWired = function (nm) { var k = it.part.id + ":" + nm; return T.pins[k] ? (T.terminals[T.find(k)] || 0) > 1 : false; };
      return c;
    });

    for (var s = 0; s < steps; s++) {
      this.t += dt === Infinity ? wallDt : dt;
      if (this.onTick) this.onTick(this.t, dt === Infinity ? wallDt : dt);
      var i;
      for (i = 0; i < T.inst.length; i++) {
        var it = T.inst[i];
        it.devs.forEach(function (dv) { if (dv.k === "C" || dv.k === "L") dv.dt = dt; });
        it.model.pre(it.m, ctxs[i]);
      }
      this.solveOnce(dt);
      this.kicks = {};
      for (i = 0; i < T.inst.length; i++) T.inst[i].model.post(T.inst[i].m, ctxs[i]);
      /* a spike found by a coil reaches the switch on the same node */
      if (Object.keys(this.kicks).length) for (i = 0; i < T.inst.length; i++) if (/npn|pnp|nmos/.test(T.inst[i].part.type)) T.inst[i].model.post(T.inst[i].m, ctxs[i]);
      for (i = 0; i < T.inst.length; i++) if (T.inst[i].model.commit) T.inst[i].model.commit(T.inst[i].m);
      /* average node voltages and pin currents for the eye */
      for (i = 1; i <= T.n; i++) T.avgV[i] += (T.x[i - 1] - T.avgV[i]) * alpha;
      for (i = 0; i < T.devices.length; i++) {
        var dv2 = T.devices[i];
        if (!dv2._acc) dv2._acc = new Float64Array(dv2.p.length);
        for (var k = 0; k < dv2.p.length; k++) dv2._acc[k] += (dv2.cur[k] - dv2._acc[k]) * alpha;
      }
    }
    /* per-pin current: sum of smoothed device terminal currents */
    var pinI = {};
    T.devices.forEach(function (dv) {
      for (var k = 0; k < dv.p.length; k++) pinI[dv.p[k]] = (pinI[dv.p[k]] || 0) + (dv._acc ? dv._acc[k] : dv.cur[k]);
    });
    T.pinI = pinI;
    this.powered = T.inst.some(function (it) {
      return /battery|coin_cell|psu|k_battery/.test(it.part.type) || it.model.mcu;
    });
    this.flow();
  };

  /* ----------------------------------------------------------------- flow
   * Push each pin's current back through the wires of its node. Most nodes
   * are trees (a pin, a wire, a hole), where the answer is exact. A node
   * with a loop in it — two ground wires, say — is solved as a little
   * resistor network so the current splits the way it would. */
  Sim.prototype.flow = function () {
    var T = this.topo, self = this, wireI = {}, busFlows = [];
    Object.keys(T.groups).forEach(function (r) {
      var g = T.groups[r];
      if (!g.edges.length) return;
      var idx = {}, nv = g.verts.length;
      g.verts.forEach(function (k, i) { idx[k] = i; });
      var inj = new Float64Array(nv);
      g.verts.forEach(function (k, i) { inj[i] = -(T.pinI[k] || 0); });
      var flows;
      if (g.edges.length <= nv - 1) flows = treeFlow(g, idx, inj, nv);
      else flows = meshFlow(g, idx, inj, nv);
      g.edges.forEach(function (e, ei) {
        if (e.wire) wireI[e.wire] = flows[ei];
        else if (e.kind === "bus" && Math.abs(flows[ei]) > 2e-5) busFlows.push({ a: e.a, b: e.b, i: flows[ei] });
      });
    });
    this.wireI = wireI;
    this.busFlows = busFlows;
  };

  function treeFlow(g, idx, inj, nv) {
    var adj = [], i;
    for (i = 0; i < nv; i++) adj.push([]);
    g.edges.forEach(function (e, ei) {
      var a = idx[e.a], b = idx[e.b];
      if (a == null || b == null || a === b) return;
      adj[a].push(ei); adj[b].push(ei);
    });
    var flows = new Float64Array(g.edges.length), seen = new Uint8Array(nv);
    var upEdge = new Int32Array(nv).fill(-1), upVert = new Int32Array(nv).fill(-1);
    for (var s = 0; s < nv; s++) {
      if (seen[s]) continue;
      var order = [], queue = [s];
      seen[s] = 1;
      while (queue.length) {
        var v = queue.shift(); order.push(v);
        adj[v].forEach(function (ei) {
          var e = g.edges[ei], w = idx[e.a] === v ? idx[e.b] : idx[e.a];
          if (seen[w]) return;
          seen[w] = 1; upEdge[w] = ei; upVert[w] = v; queue.push(w);
        });
      }
      var sub = new Float64Array(nv);
      for (i = order.length - 1; i >= 0; i--) {
        var u = order[i];
        sub[u] += inj[u];
        if (upEdge[u] < 0) continue;
        /* everything injected under u leaves through the edge to its parent */
        var e2 = g.edges[upEdge[u]];
        flows[upEdge[u]] = idx[e2.a] === u ? sub[u] : -sub[u];
        sub[upVert[u]] += sub[u];
      }
    }
    return flows;
  }

  function meshFlow(g, idx, inj, nv) {
    var n = nv, A = new Float64Array(n * n), b = new Float64Array(n), cond = [];
    g.edges.forEach(function (e, ei) {
      var a = idx[e.a], c = idx[e.b];
      var gg = e.kind === "wire" ? 1 : 50;
      cond[ei] = gg;
      if (a == null || c == null || a === c) return;
      A[a * n + a] += gg; A[c * n + c] += gg; A[a * n + c] -= gg; A[c * n + a] -= gg;
    });
    for (var i = 0; i < n; i++) { b[i] = inj[i]; A[i * n + i] += 1e-9; }
    A[0] += 1;
    solve(A, b, n);
    var flows = new Float64Array(g.edges.length);
    g.edges.forEach(function (e, ei) {
      var a = idx[e.a], c = idx[e.b];
      if (a == null || c == null) return;
      flows[ei] = cond[ei] * (b[a] - b[c]);
    });
    return flows;
  }

  /* --------------------------------------------------------------- probes */

  Sim.prototype.pinVolts = function (key) {
    var T = this.topo;
    if (!T) return null;
    var n = T.pinNode[key];
    if (n == null) return null;
    return n ? T.avgV[n] : 0;
  };
  Sim.prototype.pinCurrent = function (key) { return this.topo ? (this.topo.pinI[key] || 0) : 0; };
  Sim.prototype.sameNode = function (k1, k2) {
    var T = this.topo;
    return !!(T && T.pins[k1] && T.pins[k2] && T.find(k1) === T.find(k2));
  };
  /* Everything wired to this pin, for "what is pin 13 connected to?" */
  Sim.prototype.neighbours = function (key) {
    var T = this.topo, out = [];
    if (!T || !T.pins[key]) return out;
    var r = T.find(key);
    Object.keys(T.pins).forEach(function (k) {
      if (k === key || T.pins[k].hole) return;
      if (T.find(k) === r) out.push(k);
    });
    return out;
  };

  L.solveDense = solve;
})(typeof window !== "undefined" ? window : globalThis);
