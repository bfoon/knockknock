/* Chalk Power Lab — the simulator.
 *
 * One solver for the whole installation, AC and DC together. Every
 * terminal is a node; every cable is a resistor (so voltage drop and hot
 * cables come out of the arithmetic, not out of a rule); every device is
 * a handful of admittances and current sources between its terminals.
 *
 * The numbers are complex, so alternating current is a phasor: 230∠0° on
 * one phase, 230∠−120° on the next. That is what makes the neutral of a
 * balanced three-phase board carry nothing, and an RCD see the difference
 * between live and neutral. A DC quantity is just a phasor with no angle.
 *
 * Things that are not linear — a solar panel's curve, an inverter that
 * draws whatever its load needs — are linearised and the solve repeated
 * until it stops moving (a handful of passes, warm-started from the last
 * tick). Things with a mind of their own — an MPPT hunting for the best
 * voltage, a breaker heating up, a battery filling — move one step per tick.
 *
 *   var sim = new ChalkPower.Sim(doc);
 *   sim.env = {G: 850, tamb: 31};       // W/m² on the panels, °C
 *   sim.step(dt);                       // dt in simulated seconds (0 = just settle)
 *   sim.state[partId]                   // what each part is doing
 *   sim.wstate[wireId]                  // {mag, heat, burnt, dir}
 *   sim.volt(keyA, keyB)                // {mag, re, im, ac}
 *   sim.deadR(keyA, keyB)               // resistance with everything off
 *   sim.trace(keyPlus, keyMinus)        // I-V curve of the panels between two points
 *
 * No DOM here: it runs under Node, which is how it is tested.
 */
(function (root) {
  "use strict";

  var W = root.ChalkPower;
  var GMIN = 1e-8, TAU = Math.PI * 2;
  function hyp(a, b) { return Math.sqrt(a * a + b * b); }

  function Sim(doc) {
    this.doc = doc; this.state = {}; this.wstate = {}; this.t = 0; this.tick = 0;
    this.env = { G: 800, tamb: 30 }; this.events = []; this.alarms = []; this.dirty = true; this.fast = false;
    this.tot = { solar: 0, load: 0, grid: 0, gen: 0, litres: 0, unmet: 0, exported: 0 };
  }
  W.Sim = Sim;

  Sim.prototype.reset = function () {
    this.state = {}; this.wstate = {}; this.t = 0; this.tick = 0; this.events = []; this.alarms = []; this.dirty = true;
    this.tot = { solar: 0, load: 0, grid: 0, gen: 0, litres: 0, unmet: 0, exported: 0 };
  };
  Sim.prototype.say = function (level, part, msg) {
    this.events.push({ t: this.t, tick: this.tick, level: level, part: part && part.id, msg: msg });
    if (this.events.length > 60) this.events.shift();
    if (this.onEvent) this.onEvent(this.events[this.events.length - 1]);
  };

  /* ------------------------------------------------------------ indexing */

  /* Terminals that are one piece of metal inside a part share a node. */
  var ALIAS = {
    bar: function () { return [["1", "2", "3", "4", "5", "6", "7", "8"]]; },
    combiner: function () { return [["S1-", "S2-", "S3-", "S4-", "OUT-"]]; },
    pwm: function () { return [["PV-", "B-"]]; }
  };

  Sim.prototype.index = function () {
    var doc = this.doc, self = this, idx = {}, n = 0, old = this.idx, oxr = this.xr, oxi = this.xi;
    this.pn = {};
    doc.parts.forEach(function (p) {
      var terms = W.termsOf(p), map = {}, al = ALIAS[p.type] ? ALIAS[p.type](W.propsOf(p)) : [];
      terms.forEach(function (t) {
        var joined = null;
        al.forEach(function (g) { if (g.indexOf(t.n) >= 0) joined = g[0]; });
        if (joined != null && map[joined] != null) map[t.n] = map[joined];
        else map[t.n] = n++;
        idx[p.id + ":" + t.n] = map[t.n];
      });
      self.pn[p.id] = map;
      if (!self.state[p.id]) self.state[p.id] = {};
    });
    Object.keys(this.state).forEach(function (id) { if (!self.pn[id]) delete self.state[id]; });
    this.wires = [];
    var seen = {};
    doc.wires.forEach(function (w) {
      var a = idx[w.a], b = idx[w.b];
      seen[w.id] = 1;
      if (a == null || b == null || a === b) return;
      self.wires.push({ w: w, a: a, b: b });
      if (!self.wstate[w.id]) self.wstate[w.id] = { mag: 0, heat: 0, burnt: false, dir: 0 };
    });
    Object.keys(this.wstate).forEach(function (id) { if (!seen[id]) delete self.wstate[id]; });
    this.idx = idx; this.N = n;
    this.Ar = new Float64Array(n * n); this.Ai = new Float64Array(n * n);
    this.br = new Float64Array(n); this.bi = new Float64Array(n);
    this.xr = new Float64Array(n); this.xi = new Float64Array(n);
    /* an edit must not look like a power cut: carry the voltages over */
    if (old && oxr) Object.keys(idx).forEach(function (k) { var o = old[k]; if (o != null && o < oxr.length) { self.xr[idx[k]] = oxr[o]; self.xi[idx[k]] = oxi[o]; } });
    this.dirty = false;
  };

  /* ------------------------------------------------------------ stamping */

  Sim.prototype.Y = function (a, b, gr, gi) {
    var n = this.N; gi = gi || 0;
    if (a >= 0) { this.Ar[a * n + a] += gr; this.Ai[a * n + a] += gi; }
    if (b >= 0) { this.Ar[b * n + b] += gr; this.Ai[b * n + b] += gi; }
    if (a >= 0 && b >= 0) { this.Ar[a * n + b] -= gr; this.Ai[a * n + b] -= gi; this.Ar[b * n + a] -= gr; this.Ai[b * n + a] -= gi; }
  };
  /* A current source pushing j from node a, through itself, into node b. */
  Sim.prototype.J = function (a, b, jr, ji) {
    ji = ji || 0;
    if (a >= 0) { this.br[a] -= jr; this.bi[a] -= ji; }
    if (b >= 0) { this.br[b] += jr; this.bi[b] += ji; }
  };
  /* A voltage source: V(a) − V(b) = e, behind a series resistance r. */
  Sim.prototype.E = function (a, b, er, ei, r) { this.Y(a, b, 1 / r, 0); this.J(b, a, er / r, (ei || 0) / r); };
  Sim.prototype.vr = function (n) { return n >= 0 && n != null ? this.xr[n] : 0; };
  Sim.prototype.vi = function (n) { return n >= 0 && n != null ? this.xi[n] : 0; };
  Sim.prototype.dv = function (a, b) { return [this.vr(a) - this.vr(b), this.vi(a) - this.vi(b)]; };
  Sim.prototype.dmag = function (a, b) { var d = this.dv(a, b); return hyp(d[0], d[1]); };

  /* Dense complex Gaussian elimination with partial pivoting. A plan is at
   * most a few hundred nodes, so this is a millisecond or two. */
  Sim.prototype.solve = function () {
    var n = this.N, Ar = this.Ar, Ai = this.Ai, br = this.br, bi = this.bi, i, j, k;
    for (k = 0; k < n; k++) {
      var best = k, bm = Ar[k * n + k] * Ar[k * n + k] + Ai[k * n + k] * Ai[k * n + k];
      for (i = k + 1; i < n; i++) { var m = Ar[i * n + k] * Ar[i * n + k] + Ai[i * n + k] * Ai[i * n + k]; if (m > bm) { bm = m; best = i; } }
      if (bm < 1e-30) continue;
      if (best !== k) {
        for (j = k; j < n; j++) { var t = Ar[k * n + j]; Ar[k * n + j] = Ar[best * n + j]; Ar[best * n + j] = t; t = Ai[k * n + j]; Ai[k * n + j] = Ai[best * n + j]; Ai[best * n + j] = t; }
        t = br[k]; br[k] = br[best]; br[best] = t; t = bi[k]; bi[k] = bi[best]; bi[best] = t;
      }
      var pr = Ar[k * n + k], pi = Ai[k * n + k], pd = pr * pr + pi * pi;
      for (i = k + 1; i < n; i++) {
        var ar = Ar[i * n + k], ai = Ai[i * n + k];
        if (ar === 0 && ai === 0) continue;
        var fr = (ar * pr + ai * pi) / pd, fi = (ai * pr - ar * pi) / pd;
        for (j = k + 1; j < n; j++) {
          var ur = Ar[k * n + j], ui = Ai[k * n + j];
          if (ur === 0 && ui === 0) continue;
          Ar[i * n + j] -= fr * ur - fi * ui; Ai[i * n + j] -= fr * ui + fi * ur;
        }
        br[i] -= fr * br[k] - fi * bi[k]; bi[i] -= fr * bi[k] + fi * br[k];
      }
    }
    for (i = n - 1; i >= 0; i--) {
      var sr = br[i], si = bi[i];
      for (j = i + 1; j < n; j++) { sr -= Ar[i * n + j] * this.xr[j] - Ai[i * n + j] * this.xi[j]; si -= Ar[i * n + j] * this.xi[j] + Ai[i * n + j] * this.xr[j]; }
      pr = Ar[i * n + i]; pi = Ai[i * n + i]; pd = pr * pr + pi * pi;
      if (pd < 1e-30) { this.xr[i] = 0; this.xi[i] = 0; }
      else { this.xr[i] = (sr * pr + si * pi) / pd; this.xi[i] = (si * pr - sr * pi) / pd; }
    }
  };

  /* -------------------------------------------- things that are switches */

  /* Closed paths through a part right now: [termA, termB, ohms]. */
  var LINKS = {
    mcb: function (pr, st) { return pr.on !== false && !st.trip ? [["in", "out", 0.004]] : []; },
    fuse: function (pr, st) { return st.blown ? [] : [["in", "out", 0.003]]; },
    isolator: function (pr) { return pr.on !== false ? [["1", "2", 0.004], ["3", "4", 0.004]] : []; },
    rcd: function (pr, st) { return pr.on !== false && !st.trip ? [["Lin", "Lout", 0.004], ["Nin", "Nout", 0.004]] : []; },
    meter: function (pr, st) { return st.cut ? [] : [["Lin", "Lout", 0.005], ["Nin", "Nout", 0.005]]; },
    switch1: function (pr) { return pr.on ? [["in", "out", 0.01]] : []; },
    switch2: function (pr) { return [["C", +pr.pos ? "L2" : "L1", 0.01]]; },
    photocell: function (pr, st) { return st.closed ? [["L", "OUT", 0.02]] : []; },
    changeover: function (pr, st) {
      var pos = pr.auto ? (st.pos || 0) : +pr.pos;
      return pos === 1 ? [["AL", "L", 0.005], ["AN", "N", 0.005]] : pos === 2 ? [["BL", "L", 0.005], ["BN", "N", 0.005]] : [];
    },
    combiner: function (pr, st) {
      var out = [];
      for (var i = 0; i < 4; i++) if (!(st.blown && st.blown[i])) out.push(["S" + (i + 1) + "+", "OUT+", 0.004, i]);
      return out;
    },
    hybrid: function (pr, st) { return st.mode === "byp" ? [["GL", "L", 0.01], ["GN", "N", 0.01]] : []; }
  };
  /* Every path a part could ever close — for tracing a circuit on paper. */
  W.PATHS = {
    mcb: [["in", "out"]], fuse: [["in", "out"]], isolator: [["1", "2"], ["3", "4"]], rcd: [["Lin", "Lout"], ["Nin", "Nout"]],
    meter: [["Lin", "Lout"], ["Nin", "Nout"]], switch1: [["in", "out"]], switch2: [["C", "L1"], ["C", "L2"]], photocell: [["L", "OUT"]],
    changeover: [["AL", "L"], ["AN", "N"], ["BL", "L"], ["BN", "N"]],
    combiner: [["S1+", "OUT+"], ["S2+", "OUT+"], ["S3+", "OUT+"], ["S4+", "OUT+"]]
  };
  W.LINKS = LINKS;

  /* Terminals that belong to one galvanic circuit inside a part, and which
   * of them are sources: used to notice AC joined to DC, and two supplies
   * joined together. */
  var GROUPS = {
    grid1: [["L", "N"]], grid3: [["L1", "L2", "L3", "N"]], genset: [["L", "N"]], pv: [["+", "-"]], battery: [["+", "-"]],
    mppt: [["PV+", "PV-"], ["B+", "B-"]], pwm: [["PV+", "PV-", "B+", "B-"]], inverter: [["DC+", "DC-"], ["L", "N"]],
    hybrid: [["PV+", "PV-"], ["B+", "B-"], ["GL", "GN"], ["L", "N"]], gridtie: [["PV+", "PV-"], ["L", "N"]],
    lamp: [["L", "N"]], socket: [["L", "N"]], load: [["L", "N"]], dcload: [["+", "-"]]
  };
  var SOURCES = {
    grid1: function (pr, st) { return [["L", "ac", !!st.live]]; }, grid3: function (pr, st) { return [["L1", "ac", !!st.live]]; },
    genset: function (pr, st) { return [["L", "ac", !!st.live]]; }, inverter: function (pr, st) { return [["L", "ac", !!st.run]]; },
    hybrid: function (pr, st) { return [["L", "ac", st.mode === "inv"]]; },
    battery: function () { return [["+", "dc", true]]; }, pv: function () { return [["+", "dc", true]]; }
  };

  Sim.prototype.islands = function () {
    var self = this, n = this.N, par = new Int32Array(n), i;
    for (i = 0; i < n; i++) par[i] = i;
    function find(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
    function join(a, b) { if (a == null || b == null || a < 0 || b < 0) return; a = find(a); b = find(b); if (a !== b) par[a] = b; }
    this.wires.forEach(function (q) { if (!self.wstate[q.w.id].burnt) join(q.a, q.b); });
    this.doc.parts.forEach(function (p) {
      var map = self.pn[p.id], st = self.state[p.id], pr = W.propsOf(p);
      (LINKS[p.type] ? LINKS[p.type](pr, st) : []).forEach(function (l) { join(map[l[0]], map[l[1]]); });
      (GROUPS[p.type] || []).forEach(function (g) { for (var k = 1; k < g.length; k++) join(map[g[0]], map[g[k]]); });
    });
    var info = {};
    this.doc.parts.forEach(function (p) {
      if (!SOURCES[p.type]) return;
      var map = self.pn[p.id];
      SOURCES[p.type](W.propsOf(p), self.state[p.id]).forEach(function (s) {
        var r = find(map[s[0]]), rec = info[r] = info[r] || { ac: [], dc: [], acAll: [] };
        if (s[1] === "ac") { rec.acAll.push(p.id); if (s[2]) rec.ac.push(p.id); } else rec.dc.push(p.id);
      });
    });
    this.isl = function (node) { return node == null || node < 0 ? null : info[find(node)] || null; };
    var alarms = [];
    Object.keys(info).forEach(function (r) {
      var rec = info[r];
      if (rec.ac.length && rec.dc.length) alarms.push({ code: "mixed", level: "danger", parts: rec.ac.concat(rec.dc), msg: "Mains AC is wired straight onto the DC side. In real life: destroyed equipment, and fire." });
      if (rec.ac.length > 1) alarms.push({ code: "backfeed", level: "danger", parts: rec.ac.slice(), msg: "Two supplies are joined together with nothing to keep them apart (back-feed). Use a changeover switch." });
    });
    this.alarms = alarms;
    return info;
  };

  /* ------------------------------------------------------ device physics */

  function nominal(vb) { return vb < 18 ? 1 : vb < 36 ? 2 : 4; }

  /* A solar panel's curve: current out for a voltage across it. Returns
   * [I, −dI/dV]. Below zero volts the bypass diodes take over. */
  function pvCurve(m, env, pr, v) {
    var G = Math.max(0, env.G) * (1 - (+pr.shade || 0) / 100) * (1 - (+pr.dirt || 0) / 100) * (pr.fault === "hot" ? 0.55 : 1);
    var tc = env.tamb + G / 800 * 25, isc = m.isc * G / 1000 * (1 + 0.0005 * (tc - 25));
    var voc = Math.max(0.5, m.voc * (1 - 0.0029 * (tc - 25)) * (1 + 0.06 * Math.log(Math.max(G, 1) / 1000)));
    var c2 = (m.vmp / m.voc - 1) / Math.log(1 - m.imp / m.isc), c1 = (1 - m.imp / m.isc) * Math.exp(-m.vmp / (c2 * m.voc));
    var a = v / (c2 * voc), e = a > 30 ? Math.exp(30) * (1 + a - 30) : Math.exp(a), de = a > 30 ? Math.exp(30) : e;
    var I = isc * (1 - c1 * (e - 1)), g = isc * c1 * de / (c2 * voc);
    if (v < -0.5) { I += (-v - 0.5) / 0.02; g += 1 / 0.02; }
    return [I, Math.max(g, 1e-6), voc, isc];
  }
  W.pvCurve = pvCurve;

  function battE(pr, soc) {
    var n = (+pr.volts || 12) / 12, e;
    if (pr.chem === "lfp") e = soc < 0.1 ? 11.5 + 14 * soc : soc < 0.9 ? 12.9 + 0.5 * (soc - 0.1) : 13.3 + 3 * (soc - 0.9);
    else e = soc < 0.1 ? 10.0 + 17.2 * soc : 11.6 + 1.2 * soc;
    return e * n;
  }
  /* Internal resistance. A nearly full battery pushes back against charge:
   * that rising voltage is what tells a controller to ease off. */
  function battR(pr, soc, charging) {
    var n = (+pr.volts || 12) / 12, ah = +pr.ah || 100, r = (pr.chem === "lfp" ? 0.008 : 0.02) * n * 100 / ah * (soc <= 0 ? 25 : 1);
    if (charging) { var f = W.clamp((soc - (pr.chem === "lfp" ? 0.95 : 0.85)) / (pr.chem === "lfp" ? 0.05 : 0.15), 0, 1); r += f * f * 1.6 * n / (0.01 * ah); }
    return r;
  }

  /* Perturb and observe: nudge the panel voltage; if the power went up,
   * keep going, if it went down, turn round. `need` caps what is wanted. */
  function track(st, pin, lo, hi, need) {
    if (need != null && (st.lim || pin > need * 1.04)) {
      /* more sun than is wanted: slide up the far side of the curve, where
       * power falls away steeply, and hold just what is needed */
      if (!st.lim) { st.lim = true; st.vbest = st.vset; }
      var err = pin / Math.max(need, 1) - 1;
      if (err > 0.03) st.vset += st.pstep * Math.min(8, 1 + err * 12);
      else if (err < -0.08) { st.vset -= st.pstep * Math.min(3, 0.5 - err * 6); if (st.vset <= st.vbest) { st.vset = st.vbest; st.lim = false; } }
    } else {
      if (pin < st.pprev) st.dir = -st.dir;
      st.vset += st.dir * st.pstep;
    }
    st.vset = W.clamp(st.vset, lo, Math.max(lo, hi)); st.pprev = pin;
  }
  /* Shared by the MPPT controller, the hybrid and the grid-tie inverter:
   * start, stop and survive on the PV input. Returns true while tracking. */
  function pvInput(sim, p, pr, st, a, b, lo, need, label) {
    var d = sim.dv(a, b), vpv = d[0];
    st.vpv = vpv;
    if (st.pvdead) return false;
    if (!st.tracking) {
      st.wait = (st.wait || 0) + 1;
      if (vpv > +pr.maxpv) { st.pvdead = true; st.tracking = false; sim.say("danger", p, label + ": the panels reached " + vpv.toFixed(0) + " V, above its " + pr.maxpv + " V limit. It is destroyed. Fewer panels in series."); return false; }
      if (st.wait > 2 && vpv > lo + 2) { st.tracking = true; st.vset = Math.max(lo, 0.8 * vpv); st.voc = vpv; st.pstep = Math.max(0.15, 0.012 * vpv); st.dir = -1; st.pprev = 0; st.low = 0; st.lim = false; }
      st.pin = 0;
      return st.tracking;
    }
    var iin = (vpv - st.vset) / 0.05, pin = vpv * iin;
    st.low = iin < 0.02 && !st.lim ? (st.low || 0) + 1 : 0;
    if (st.low > 3 || lo > +pr.maxpv) { st.tracking = false; st.wait = 0; st.pin = 0; return false; }
    track(st, pin, lo, +pr.maxpv, need);
    return true;
  }
  /* The charge side. Constant current while the battery will take it, then
   * hold the absorb voltage (the current tails off by itself), then float.
   * Called every solver pass with the current that is available; returns
   * how far it moved. */
  function target(st, pr, vb, n, lfp) {
    if (st.fl && vb < 12.7 * n) st.fl = false;
    st.vt = (st.fl ? 13.55 : lfp ? 14.2 : 14.4) * n;
    return st.vt;
  }
  function ccv(sim, st, a, b, avail) {
    var vb = sim.vr(a) - sim.vr(b);
    if (st.cv) {
      var i = (st.vt - vb) / 0.02;
      if (i > avail + 0.05) { st.cv = false; st.ib = avail; return 1; }
      if (i < -0.05) { st.cv = false; st.hold = true; st.ib = Math.min(avail, 0); return 1; }
      st.ib = i; st.tail = i;
      return 0;
    }
    if (st.hold) { if (vb < st.vt - 0.08) st.hold = false; avail = Math.min(avail, 0); }
    else if (vb > st.vt + 0.03 && avail > 0) { st.cv = true; return 1; }
    var d = avail - (st.ib || 0);
    st.ib = (st.ib || 0) + 0.7 * d;
    return Math.abs(d) * 0.3;
  }
  function stampCharge(sim, st, a, b) { if (st.cv) sim.E(a, b, st.vt, 0, 0.02); else sim.J(b, a, st.ib || 0, 0); }
  function floatLatch(st, amps) { if (st.cv && !st.fl && st.tail < 0.03 * amps + 0.2) { st.flc = (st.flc || 0) + 1; if (st.flc > 4) { st.fl = true; st.flc = 0; } } else if (!st.cv) st.flc = 0; }

  /* When each thing is used, for a day run that follows the household's
   * routine: the hour it starts. Lamps in the evening, the pump by day. */
  var START = { lamp: 19, led_tv: 18.5, decoder: 18.5, tv: 18.5, laptop: 9, desktop: 8.5, printer: 10, fan: 13, ceiling_fan: 12, kettle: 7, iron: 8,
    microwave: 13, blender: 12, washer: 10, aircon: 12.5, pump: 10, borehole: 9.5, heater: 6, sewing: 9, welder: 10, speaker: 16, phone: 19, usb: 10, radio: 8 };
  W.inRoutine = function (sim, app, hours) {
    if (!sim.routine || !(hours < 24)) return true;
    if (!(hours > 0)) return false;
    var at = START[app] == null ? 10 : START[app], h = ((sim.hour == null ? 12 : sim.hour) - at + 48) % 24;
    return h < hours;
  };

  /* An AC appliance as an admittance: watts and power factor at 230 V. */
  function acLoad(sim, st, n, watts, pf, surge, duty, pr, id) {
    st.g = 0; st.b2 = 0; st.idle = false;
    if (pr.on === false || pr.fault === "open" || !(watts > 0)) return;
    if (duty < 1) {
      var h = 0; for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 97;
      if (((sim.t / 1800 + h / 970) % 1) > duty) { st.idle = true; return; }
    }
    var kick = !sim.fast && st.inr > 0 ? 1 + (surge - 1) * (st.inr / 4) * (st.inr / 4) : 1;
    st.g = watts * kick / (230 * 230); st.b2 = -st.g * Math.tan(Math.acos(W.clamp(pf, 0.2, 1)));
  }

  var B = {};

  B.grid1 = {
    pre: function (sim, p, pr, st) { st.live = pr.on !== false && !st.err; },
    stamp: function (sim, p, pr, st, n) { if (st.live) sim.E(n.L, n.N, +pr.volts || 230, 0, +pr.zs || 0.35); sim.Y(n.N, -1, 1, 0); },
    dead: function (sim, p, pr, st, n) { sim.Y(n.N, -1, 1, 0); },
    post: function (sim, p, pr, st, n, dt) {
      if (!st.live) { st.p = 0; st.i = 0; return; }
      var d = sim.dv(n.L, n.N), zs = +pr.zs || 0.35, ir = ((+pr.volts || 230) - d[0]) / zs, ii = -d[1] / zs;
      st.p = d[0] * ir + d[1] * ii; st.i = hyp(ir, ii);
      if (st.p > 0) sim.tot.grid += st.p * dt / 3600; else sim.tot.exported += -st.p * dt / 3600;
    }
  };
  B.grid3 = {
    pre: function (sim, p, pr, st) { st.live = pr.on !== false; },
    stamp: function (sim, p, pr, st, n) {
      var v = +pr.volts || 230, zs = +pr.zs || 0.25;
      if (st.live) ["L1", "L2", "L3"].forEach(function (t, i) { sim.E(n[t], n.N, v * Math.cos(-i * TAU / 3), v * Math.sin(-i * TAU / 3), zs); });
      sim.Y(n.N, -1, 1, 0);
    },
    dead: function (sim, p, pr, st, n) { sim.Y(n.N, -1, 1, 0); },
    post: function (sim, p, pr, st, n, dt) {
      var v = +pr.volts || 230, zs = +pr.zs || 0.25, P = 0, nr = 0, ni = 0;
      st.ph = [];
      if (st.live) ["L1", "L2", "L3"].forEach(function (t, i) {
        var d = sim.dv(n[t], n.N), ir = (v * Math.cos(-i * TAU / 3) - d[0]) / zs, ii = (v * Math.sin(-i * TAU / 3) - d[1]) / zs;
        P += d[0] * ir + d[1] * ii; nr += ir; ni += ii; st.ph.push(hyp(ir, ii));
      });
      st.p = P; st.inn = hyp(nr, ni);
      if (P > 0) sim.tot.grid += P * dt / 3600;
    }
  };
  B.genset = {
    pre: function (sim, p, pr, st) { if (!pr.run) st.err = null; st.live = !!pr.run && !st.err; },
    zs: function (pr) { return 230 * 230 / ((+pr.kva || 3) * 1000) * 0.12; },
    stamp: function (sim, p, pr, st, n) { if (st.live) sim.E(n.L, n.N, 230, 0, this.zs(pr)); sim.Y(n.N, n.PE, 100, 0); },
    dead: function (sim, p, pr, st, n) { sim.Y(n.N, n.PE, 100, 0); },
    post: function (sim, p, pr, st, n, dt) {
      if (!st.live) { st.p = 0; st.lph = 0; return; }
      var d = sim.dv(n.L, n.N), zs = this.zs(pr), ir = (230 - d[0]) / zs, ii = -d[1] / zs, kva = +pr.kva || 3;
      st.p = d[0] * ir + d[1] * ii; st.s = hyp(d[0], d[1]) * hyp(ir, ii);
      st.lph = 0.09 * kva + 0.3 * Math.max(0, st.p) / 1000;
      sim.tot.gen += Math.max(0, st.p) * dt / 3600; sim.tot.litres += st.lph * dt / 3600;
      st.ovl = st.s > kva * 1000 * 1.1 ? (st.ovl || 0) + 1 : 0;
      if (st.ovl > 25 || st.s > kva * 2500) { st.err = "overload"; st.ovl = 0; sim.say("warn", p, "The generator stalled: it was asked for " + (st.s / 1000).toFixed(1) + " kVA and it is a " + kva + " kVA set."); }
    }
  };

  B.pv = {
    stamp: function (sim, p, pr, st, n) {
      if (pr.fault === "open") return;
      if (pr.fault === "bypass") { sim.Y(n["+"], n["-"], 20, 0); return; }
      if (st.vl == null) st.vl = 0;
      var q = pvCurve(W.PV[pr.model] || W.PV.p330, sim.env, pr, st.vl);
      sim.Y(n["+"], n["-"], q[1], 0); sim.J(n["-"], n["+"], q[0] + q[1] * st.vl, 0);
    },
    iter: function (sim, p, pr, st, n) {
      if (pr.fault === "open" || pr.fault === "bypass") return 0;
      var m = W.PV[pr.model] || W.PV.p330, v = sim.vr(n["+"]) - sim.vr(n["-"]), lim = Math.max(1.5, 0.12 * m.voc);
      var dv = W.clamp(v - st.vl, -lim, lim);
      /* a step that keeps changing its mind gets shorter */
      st.damp = dv * (st.ldv || 0) < 0 ? Math.max(0.08, (st.damp || 1) * 0.5) : Math.min(1, (st.damp || 1) * 1.6);
      dv *= st.damp; st.ldv = dv;
      st.vl += dv;
      return Math.abs(v - st.vl) + Math.abs(dv);
    },
    post: function (sim, p, pr, st, n, dt) {
      var v = sim.vr(n["+"]) - sim.vr(n["-"]), m = W.PV[pr.model] || W.PV.p330;
      st.v = v;
      if (pr.fault === "open") { st.i = 0; st.p = 0; st.bypass = false; return; }
      if (pr.fault === "bypass") { st.i = -v * 20; st.p = 0; st.bypass = true; return; }
      var q = pvCurve(m, sim.env, pr, v);
      st.i = q[0]; st.p = v * q[0]; st.bypass = v < -0.3; st.voc = q[2]; st.isc = q[3];
      st.heat = st.bypass ? 0.9 : pr.fault === "hot" ? 0.8 : W.clamp(sim.env.G / 1600, 0, 0.6);
    }
  };

  B.battery = {
    stamp: function (sim, p, pr, st, n) {
      if (st.soc == null) { st.soc = W.clamp((pr.soc == null ? 80 : +pr.soc) / 100, 0, 1); st.low = st.soc; }
      if (st.bms) return;
      st.e = battE(pr, st.soc); st.r = battR(pr, st.soc, st.chg);
      sim.E(n["+"], n["-"], st.e, 0, st.r);
    },
    iter: function (sim, p, pr, st, n) {
      if (st.bms) return 0;
      var chg = sim.vr(n["+"]) - sim.vr(n["-"]) > st.e + 1e-4;
      if (chg === !!st.chg) return 0;
      st.chg = chg;
      return st.soc > (pr.chem === "lfp" ? 0.95 : 0.85) ? 0.5 : 0;
    },
    post: function (sim, p, pr, st, n, dt) {
      var v = sim.vr(n["+"]) - sim.vr(n["-"]), ah = +pr.ah || 100, lfp = pr.chem === "lfp";
      st.v = v; st.i = st.bms ? 0 : (st.e - v) / st.r;       /* + is discharging */
      st.p = v * st.i;
      if (dt > 0 && !st.bms) {
        var d = st.i * dt / 3600 / ah;
        st.soc = W.clamp(st.soc - (d < 0 ? d * (lfp ? 0.98 : 0.88) : d), 0, 1);
        st.low = Math.min(st.low, st.soc);
      }
      if (lfp && st.soc <= 0.001 && st.i > 0 && !st.bms) { st.bms = "empty"; sim.say("warn", p, "The lithium battery's BMS has disconnected it: empty. It reconnects when something charges it."); }
      if (st.bms && v > battE(pr, 0) + 0.3) st.bms = null;
      st.heat = W.clamp(Math.abs(st.i) / ah, 0, 1);
    }
  };

  B.mppt = {
    pre: function (sim, p, pr, st, n) {
      var vb = sim.vr(n["B+"]) - sim.vr(n["B-"]);
      st.vb = vb;
      if (vb < 9) { st.tracking = false; st.wait = 0; st.cv = false; st.mode = st.pvdead ? "dead" : "nobat"; st.ib = 0; st.iout = 0; st.pin = 0; st.vpv = sim.vr(n["PV+"]) - sim.vr(n["PV-"]); return; }
      target(st, pr, vb, nominal(vb));
      floatLatch(st, +pr.amps);
      st.need = (st.cv ? Math.max(0, st.ib) * 1.15 + 0.5 : +pr.amps) * vb / 0.97;
      var on = pvInput(sim, p, pr, st, n["PV+"], n["PV-"], vb + 1, st.need, "Charge controller");
      st.mode = st.pvdead ? "dead" : !on ? "off" : st.fl ? "float" : st.cv ? "abs" : st.lim ? "limit" : "track";
      if (!on) { st.ib = 0; st.cv = false; }
    },
    stamp: function (sim, p, pr, st, n) {
      if (!st.tracking) return;
      sim.E(n["PV+"], n["PV-"], st.vset, 0, 0.05);
      stampCharge(sim, st, n["B+"], n["B-"]);
    },
    iter: function (sim, p, pr, st, n) {
      if (!st.tracking) return 0;
      var vpv = sim.vr(n["PV+"]) - sim.vr(n["PV-"]), vb = Math.max(6, sim.vr(n["B+"]) - sim.vr(n["B-"]));
      st.pin = Math.max(0, vpv * (vpv - st.vset) / 0.05);
      return ccv(sim, st, n["B+"], n["B-"], Math.min(st.pin * 0.97 / vb, +pr.amps));
    },
    post: function (sim, p, pr, st, n, dt) {
      st.iout = st.tracking ? Math.max(0, st.ib || 0) : 0; st.pout = st.iout * Math.max(0, st.vb || 0); st.heat = W.clamp(st.iout / +pr.amps, 0, 1) * 0.5;
      sim.tot.solar += Math.min(st.pin || 0, st.pout / 0.97) * dt / 3600;
    }
  };

  B.pwm = {
    pre: function (sim, p, pr, st, n) {
      var vb = sim.vr(n["B+"]) - sim.vr(n["B-"]), vpv = sim.vr(n["PV+"]) - sim.vr(n["PV-"]);
      st.vb = vb; st.vpv = vpv;
      if (st.mode === "dead") return;
      if (vb < 9) { st.closed = false; st.cv = false; st.mode = "nobat"; st.iout = 0; return; }
      if (!st.closed && !st.cv && vpv > +pr.maxpv) { st.mode = "dead"; sim.say("danger", p, "PWM controller: " + vpv.toFixed(0) + " V from the panels is above its " + pr.maxpv + " V limit. It is destroyed."); return; }
      target(st, pr, vb, nominal(vb));
      floatLatch(st, +pr.amps);
      if (st.cv) { if (st.tail > (st.avail || 0) || vpv < vb) { st.cv = false; st.closed = vpv > vb + 0.6; } }
      else if (st.closed) { if ((st.iout || 0) < -0.01) st.closed = false; else if (vb > st.vt + 0.03) { st.cv = true; st.closed = false; st.avail = st.iout; st.tail = 0; } }
      else if (vpv > vb + 0.6) st.closed = true;
      st.mode = st.cv ? (st.fl ? "float" : "abs") : st.closed ? "pwm" : "off";
    },
    stamp: function (sim, p, pr, st, n) {
      if (st.mode === "dead") return;
      if (st.cv) sim.E(n["B+"], n["B-"], st.vt, 0, 0.02);
      else if (st.closed) sim.Y(n["PV+"], n["B+"], 1 / 0.03, 0);
    },
    post: function (sim, p, pr, st, n, dt) {
      var vb = sim.vr(n["B+"]) - sim.vr(n["B-"]);
      if (st.cv) { st.tail = (st.vt - vb) / 0.02; st.iout = Math.max(0, st.tail); st.pin = st.iout * vb; }
      else { st.iout = st.closed ? (sim.vr(n["PV+"]) - sim.vr(n["B+"])) / 0.03 : 0; st.pin = Math.max(0, st.iout * (sim.vr(n["PV+"]) - sim.vr(n["PV-"]))); }
      sim.tot.solar += st.pin * dt / 3600;
      if (st.iout > +pr.amps * 1.25 && st.mode !== "dead") { st.mode = "dead"; st.closed = false; st.cv = false; sim.say("danger", p, "PWM controller: " + st.iout.toFixed(0) + " A through a " + pr.amps + " A controller. It has burnt out."); }
    }
  };

  function inverterOut(sim, st, pr, L, N, PE) {
    var zo = 0.025 * 230 * 230 / (+pr.va || 1000);
    sim.E(L, N, 230, 0, zo);
    if (pr.bond !== false) sim.Y(N, PE, 100, 0);
  }
  function inverterLoad(sim, st, pr, L, N) {
    var zo = 0.025 * 230 * 230 / (+pr.va || 1000), d = sim.dv(L, N), ir = (230 - d[0]) / zo, ii = -d[1] / zo;
    st.pac = d[0] * ir + d[1] * ii; st.s = hyp(d[0], d[1]) * hyp(ir, ii);
  }
  function overload(sim, p, pr, st, what) {
    var va = +pr.va || 1000;
    st.ovl = st.s > va * 1.08 ? (st.ovl || 0) + (st.s > va * 2 ? 5 : 1) : Math.max(0, (st.ovl || 0) - 1);
    if (st.s > va * 3 || st.ovl > 28) {
      st.err = "overload"; st.ovl = 0;
      sim.say("warn", p, what + " shut down on overload: the loads asked for " + Math.round(st.s) + " VA and it is rated " + va + " VA.");
      return true;
    }
    return false;
  }

  B.inverter = {
    pre: function (sim, p, pr, st, n) {
      var vdc = sim.vr(n["DC+"]) - sim.vr(n["DC-"]), nb = (+pr.vdc || 12) / 12;
      st.vdc = vdc;
      if (pr.on === false) { st.run = false; st.err = null; st.lowc = 0; return; }
      if (st.err === "overload" || st.err === "backfeed" || st.err === "wrong battery") { st.run = false; return; }
      if (vdc > 16.5 * nb) { st.run = false; st.err = "wrong battery"; sim.say("danger", p, "Inverter: " + vdc.toFixed(0) + " V on a " + pr.vdc + " V inverter. The battery bank is the wrong voltage for it."); return; }
      if (st.run) { st.lowc = vdc < 10.5 * nb ? (st.lowc || 0) + 1 : 0; if (st.lowc > 3) { st.run = false; st.err = "low battery"; sim.say("warn", p, "Inverter cut out: the battery is down to " + vdc.toFixed(1) + " V."); } }
      else if (vdc > (st.err === "low battery" ? 12.5 : 11) * nb) { st.run = true; st.err = null; st.lowc = 0; st.idc = st.idc || 0; }
      else if (!st.err) st.err = vdc < 2 ? "no battery" : "low battery";
    },
    stamp: function (sim, p, pr, st, n) {
      if (!st.run) return;
      inverterOut(sim, st, pr, n.L, n.N, n.PE);
      sim.J(n["DC+"], n["DC-"], st.idc || 0, 0);
    },
    dead: function (sim, p, pr, st, n) { if (pr.bond !== false) sim.Y(n.N, n.PE, 100, 0); },
    iter: function (sim, p, pr, st, n) {
      if (!st.run) return 0;
      inverterLoad(sim, st, pr, n.L, n.N);
      var nb = (+pr.vdc || 12) / 12, vdc = Math.max(9 * nb, sim.vr(n["DC+"]) - sim.vr(n["DC-"]));
      var want = Math.min((Math.max(0, st.pac) / 0.92 + 0.012 * pr.va) / vdc, 2.2 * pr.va / (10.5 * nb)), d = want - (st.idc || 0);
      st.idc = (st.idc || 0) + 0.6 * d;
      return Math.abs(d) * 0.2;
    },
    post: function (sim, p, pr, st, n) {
      if (!st.run) { st.pac = 0; st.s = 0; st.idc = 0; return; }
      inverterLoad(sim, st, pr, n.L, n.N);
      if (sim.vr(n["DC+"]) - sim.vr(n["DC-"]) < 9.6 * (+pr.vdc || 12) / 12) { st.run = false; st.err = "low battery"; sim.say("warn", p, "Inverter cut out: the battery voltage collapsed under the load."); return; }
      st.heat = W.clamp(st.s / pr.va, 0, 1.2) * 0.7;
      if (overload(sim, p, pr, st, "Inverter")) st.run = false;
    }
  };

  B.hybrid = {
    pre: function (sim, p, pr, st, n) {
      var vb = sim.vr(n["B+"]) - sim.vr(n["B-"]), nb = (+pr.vdc || 24) / 12, vg = sim.dmag(n.GL, n.GN), gridOK = vg > 185 && vg < 258;
      st.vb = vb;
      if (pr.on === false) { st.mode = "off"; st.err = null; st.tracking = false; st.chg = false; st.ib = 0; st.wait = 0; return; }
      if (vb >= 16.5 * nb) { st.mode = "off"; st.chg = false; st.tracking = false; st.ib = 0; if (st.err !== "wrong battery") sim.say("danger", p, "Hybrid inverter: " + vb.toFixed(0) + " V on its " + pr.vdc + " V battery input. Wrong battery bank."); st.err = "wrong battery"; return; }
      var bat = vb > 9 * nb, was = st.mode, mode;
      /* a flat battery is left alone until it has recovered */
      if (st.lowbat) { if (vb > 12.9 * nb) st.lowbat = false; }
      else { st.lowc = bat && vb < 11.3 * nb ? (st.lowc || 0) + 1 : 0; if (st.lowc > 3) { st.lowbat = true; st.lowc = 0; } }
      if (st.err === "overload" || st.err === "backfeed") mode = "off";
      else if (!bat) mode = gridOK ? "byp" : "off";
      else if (gridOK && (pr.mode === "UTI" || st.lowbat)) mode = "byp";
      else mode = st.lowbat ? "off" : "inv";
      if (mode !== was && was && sim.tick > 3) sim.say("info", p, mode === "byp" ? "Hybrid inverter switched the loads to the grid." : mode === "inv" ? "Hybrid inverter is running the loads from solar and battery." : "Hybrid inverter shut the loads down" + (st.err ? " (" + st.err + ")." : ": battery empty and no grid."));
      st.mode = mode;
      if (st.err !== "overload" && st.err !== "backfeed") st.err = st.pvdead ? "pv over-voltage" : mode === "off" ? (bat ? "low battery" : "no battery") : null;
      st.chg = bat;
      if (!bat) { st.tracking = false; st.wait = 0; st.cmode = "nobat"; st.ib = 0; st.pin = 0; return; }
      var loadW = mode === "inv" ? Math.max(0, st.pac || 0) / 0.93 + 0.01 * pr.va : 0;
      target(st, pr, vb, nb);
      floatLatch(st, +pr.amps);
      st.gridA = mode === "byp" && !st.fl ? +pr.gridcharge || 0 : 0;
      st.need = ((st.cv ? Math.max(0, st.ib) * 1.15 + 0.5 : +pr.amps) * vb + loadW) / 0.97;
      var on = pvInput(sim, p, pr, st, n["PV+"], n["PV-"], vb + 1, st.need, "Hybrid inverter");
      st.cmode = st.pvdead ? "dead" : !on ? "off" : st.fl ? "float" : st.cv ? "abs" : st.lim ? "limit" : "track";
    },
    stamp: function (sim, p, pr, st, n) {
      if (st.chg) {
        if (st.tracking) sim.E(n["PV+"], n["PV-"], st.vset, 0, 0.05);
        stampCharge(sim, st, n["B+"], n["B-"]);
      }
      if (st.mode === "inv") inverterOut(sim, st, { va: pr.va, bond: true }, n.L, n.N, n.PE);
      else if (st.mode === "byp" && st.gridA) sim.Y(n.GL, n.GN, Math.max(0, Math.min(st.gridA, st.ib || 0)) * Math.max(10, st.vb) / 0.9 / (230 * 230), 0);
    },
    dead: function (sim, p, pr, st, n) { sim.Y(n.N, n.PE, 100, 0); },
    iter: function (sim, p, pr, st, n) {
      if (st.mode === "inv") inverterLoad(sim, st, pr, n.L, n.N);
      else if (st.mode === "byp") { var d0 = sim.dv(n.L, n.N), i0 = sim.dv(n.GL, n.L); st.pac = (d0[0] * i0[0] + d0[1] * i0[1]) / 0.01; st.s = Math.abs(st.pac); }
      else { st.pac = 0; st.s = 0; }
      if (!st.chg) return 0;
      var vb = Math.max(9 * (+pr.vdc || 24) / 12, sim.vr(n["B+"]) - sim.vr(n["B-"])), pin = 0;
      if (st.tracking) { var vpv = sim.vr(n["PV+"]) - sim.vr(n["PV-"]); pin = Math.max(0, vpv * (vpv - st.vset) / 0.05); }
      st.pin = pin;
      var solarA = Math.min(pin * 0.97 / vb, +pr.amps), loadA = st.mode === "inv" ? (Math.max(0, st.pac) / 0.93 + 0.01 * pr.va) / vb : 0;
      st.loadA = loadA;
      return ccv(sim, st, n["B+"], n["B-"], Math.max(solarA - loadA, -2.2 * pr.va / (10.5 * (+pr.vdc || 24) / 12)) + (st.gridA || 0));
    },
    post: function (sim, p, pr, st, n, dt) {
      st.heat = W.clamp((st.s || 0) / pr.va, 0, 1.2) * 0.7;
      if (!st.chg) st.ib = 0;
      sim.tot.solar += Math.max(0, Math.min(st.pin || 0, (((st.ib || 0) - (st.gridA && st.ib > 0 ? Math.min(st.gridA, st.ib) : 0) + (st.loadA || 0)) * Math.max(0, st.vb)) / 0.97)) * dt / 3600;
      if (st.mode === "inv" && overload(sim, p, pr, st, "Hybrid inverter")) st.mode = "off";
      if (st.mode === "inv" && st.vb < 9.6 * (+pr.vdc || 24) / 12 && sim.tick > 2) { st.lowbat = true; st.mode = "off"; }
    }
  };

  B.gridtie = {
    pre: function (sim, p, pr, st, n) {
      var vg = sim.dmag(n.L, n.N), isl = sim.isl(n.L), grid = !!(isl && isl.ac.length) && vg > 185 && vg < 262;
      st.island = !grid;
      if (!grid) { st.tracking = false; st.wait = 0; st.pac = 0; st.mode = st.pvdead ? "dead" : "off"; st.vpv = sim.vr(n["PV+"]) - sim.vr(n["PV-"]); return; }
      st.need = +pr.va / 0.96;
      var on = pvInput(sim, p, pr, st, n["PV+"], n["PV-"], +pr.minpv || 60, st.need, "Grid-tie inverter");
      st.mode = st.pvdead ? "dead" : on ? (st.lim ? "limit" : "track") : "off";
      if (!on) st.pac = 0;
    },
    stamp: function (sim, p, pr, st, n) {
      if (!st.tracking) return;
      sim.E(n["PV+"], n["PV-"], st.vset, 0, 0.05);
      var d = sim.dv(n.L, n.N), m2 = d[0] * d[0] + d[1] * d[1];
      if (m2 > 100) sim.J(n.N, n.L, (st.pac || 0) * d[0] / m2, (st.pac || 0) * d[1] / m2);
    },
    iter: function (sim, p, pr, st, n) {
      if (!st.tracking) return 0;
      var vpv = sim.vr(n["PV+"]) - sim.vr(n["PV-"]), want = Math.min(+pr.va, Math.max(0, vpv * (vpv - st.vset) / 0.05) * 0.96), d = want - (st.pac || 0);
      st.pin = want / 0.96; st.pac = (st.pac || 0) + 0.6 * d;
      return Math.abs(d) * 0.01;
    },
    post: function (sim, p, pr, st, n, dt) { if (st.tracking) sim.tot.solar += (st.pac || 0) / 0.96 * dt / 3600; }
  };

  B.earth = { stamp: function (sim, p, pr, st, n) { sim.Y(n.PE, -1, 1 / Math.max(0.2, +pr.ohms || 8), 0); }, dead: function (sim, p, pr, st, n) { sim.Y(n.PE, -1, 1 / Math.max(0.2, +pr.ohms || 8), 0); } };

  B.mcb = {
    post: function (sim, p, pr, st, n, dt) {
      var I = st.imax || 0, In = +pr.amps || 16, k = { B: 4, C: 7.5, D: 14 }[pr.curve] || 7.5, r = I / In;
      st.heat = W.clamp(Math.max(st.h || 0, r > 1 ? (r - 1) * 2 : 0), 0, 1) + (pr.fault === "loose" ? W.clamp(I * I * 0.6 / 60, 0, 1) : 0);
      if (r > k) { st.trip = "short"; sim.say("warn", p, "Breaker tripped instantly: " + I.toFixed(0) + " A through a " + In + " A breaker. That is a short circuit."); return; }
      if (r > 1.13) { st.h = (st.h || 0) + (r * r - 1) * (dt || 0.02) / 40; if (st.h >= 1) { st.trip = "overload"; st.h = 0; sim.say("warn", p, "Breaker tripped on overload: " + I.toFixed(1) + " A through a " + In + " A breaker."); } }
      else st.h = Math.max(0, (st.h || 0) - (dt || 0.02) / 60);
    }
  };
  B.fuse = {
    post: function (sim, p, pr, st, n, dt) {
      var I = st.imax || 0, In = +pr.amps || 60, r = I / In;
      st.heat = W.clamp(r > 0.8 ? r - 0.5 : 0, 0, 1) + (pr.fault === "loose" ? W.clamp(I * I * 0.6 / 60, 0, 1) : 0);
      if (r > 6 || (r > 1.6 && (st.h = (st.h || 0) + (r * r - 1) * (dt || 0.02) / 12) >= 1)) { st.blown = true; st.h = 0; sim.say("warn", p, "Fuse blown: " + I.toFixed(0) + " A through a " + In + " A fuse."); }
      else if (r <= 1.6) st.h = Math.max(0, (st.h || 0) - (dt || 0.02) / 30);
    }
  };
  B.combiner = {
    post: function (sim, p, pr, st) {
      var In = +pr.amps || 15;
      (st.li || []).forEach(function (q, i) {
        if (q && hyp(q[0], q[1]) > In * 1.6) { st.blown = st.blown || []; st.blown[q[2]] = true; sim.say("warn", p, "String fuse " + (q[2] + 1) + " in the combiner has blown."); }
      });
    }
  };
  B.rcd = {
    post: function (sim, p, pr, st) {
      var li = st.li || [];
      if (li.length < 2) { st.res = 0; return; }
      st.res = hyp(li[0][0] + li[1][0], li[0][1] + li[1][1]);
      if (st.res > (+pr.ma || 30) / 1000) { st.trip = "leak"; sim.say("warn", p, "RCD tripped: " + (st.res * 1000).toFixed(0) + " mA is leaking to earth somewhere after it."); }
    }
  };
  B.meter = {
    pre: function (sim, p, pr, st) { if (st.credit == null) { st.credit = +pr.credit || 0; st.kwh = 0; } st.cut = !!pr.prepaid && st.credit <= 0; },
    post: function (sim, p, pr, st, n, dt) {
      var li = st.li || [];
      if (!li.length) { st.p = 0; return; }
      var d = sim.dv(n.Lout, n.Nout);
      st.p = d[0] * li[0][0] + d[1] * li[0][1];
      var k = Math.max(0, st.p) * dt / 3.6e6;
      st.kwh += k;
      if (pr.prepaid) { st.credit = Math.max(0, st.credit - k); if (st.credit <= 0 && !st.cut) sim.say("warn", p, "The prepaid meter has run out of credit and cut the supply."); }
    }
  };
  B.photocell = { pre: function (sim, p, pr, st) { st.closed = sim.env.G < 25; } };
  B.changeover = {
    pre: function (sim, p, pr, st, n) {
      if (!pr.auto) { st.pos = +pr.pos; return; }
      var a = sim.dmag(n.AL, n.AN) > 180, b = sim.dmag(n.BL, n.BN) > 180, want = a ? 1 : b ? 2 : 0;
      if (want !== st.want) { st.want = want; st.hold = 0; }
      if (++st.hold > 3 && st.pos !== want) { st.pos = want; if (sim.tick > 4) sim.say("info", p, want === 1 ? "ATS: back on source A." : want === 2 ? "ATS: source A lost — changed over to source B." : "ATS: no source available."); }
    }
  };

  function acPart(spec) {
    return {
      pre: function (sim, p, pr, st, n) {
        var s = spec(pr), v = sim.dmag(n.L, n.N);
        if (v > 60 && !(st.vprev > 60)) st.inr = 4; else if (st.inr > 0) st.inr--;
        st.vprev = v; st.spec = s;
        acLoad(sim, st, n, s.watts, s.pf, s.surge, s.duty, pr, p.id);
        if (st.g && !W.inRoutine(sim, s.app, s.hours)) { st.g = 0; st.b2 = 0; st.idle = true; }
      },
      stamp: function (sim, p, pr, st, n) {
        if (st.g) sim.Y(n.L, n.N, st.g, st.b2);
        if (pr.fault === "leak" && n.PE != null) sim.Y(n.L, n.PE, 1 / 4000, 0);
        if (pr.fault === "short") sim.Y(n.L, n.N, 1 / 0.05, 0);
      },
      dead: function (sim, p, pr, st, n) {
        var s = spec(pr);
        if (pr.on !== false && pr.fault !== "open" && s.watts > 0) sim.Y(n.L, n.N, s.watts / (230 * 230), 0);
        if (pr.fault === "leak" && n.PE != null) sim.Y(n.L, n.PE, 1 / 4000, 0);
        if (pr.fault === "short") sim.Y(n.L, n.N, 1 / 0.05, 0);
      },
      post: function (sim, p, pr, st, n, dt) {
        var v = sim.dmag(n.L, n.N);
        st.v = v; st.p = v * v * (st.g || 0); st.b = v * v / (230 * 230); st.run = st.g > 0 && v > 170;
        st.va = v * v * hyp(st.g || 0, st.b2 || 0);
        st.touch = n.PE != null && pr.fault === "leak" ? hyp(sim.vr(n.PE), sim.vi(n.PE)) : 0;
        sim.tot.load += st.p * dt / 3600;
        if (st.g > 0 && !st.run) sim.tot.unmet += dt / 3600;
        st.heat = pr.fault === "short" ? 1 : 0;
      }
    };
  }
  B.lamp = acPart(function (pr) { return { app: "lamp", hours: pr.hours == null ? 5 : +pr.hours, watts: (+pr.watts || 9) * (+pr.qty || 1), pf: 0.95, surge: 1, duty: 1 }; });
  B.socket = acPart(function (pr) { if (pr.app === "none") return { watts: 0, pf: 1, surge: 1, duty: 1 }; var s = W.loadSpec(pr); s.app = pr.app; return s; });
  B.load = B.socket;
  B.dcload = {
    stamp: function (sim, p, pr, st, n) {
      /* DC electronics regulate: the same watts whether the battery is at 12 V or 14 V */
      var vn = +pr.volts || 12, vref = W.clamp(st.v || vn, 0.9 * vn, 1.3 * vn);
      st.g = pr.on === false || st.over || !W.inRoutine(sim, pr.app, pr.hours == null ? 5 : +pr.hours) ? 0 : W.dcWatts(pr) / (vref * vref);
      if (st.g) sim.Y(n["+"], n["-"], st.g, 0);
    },
    post: function (sim, p, pr, st, n, dt) {
      var v = sim.vr(n["+"]) - sim.vr(n["-"]), vn = +pr.volts || 12;
      st.v = v; st.p = v * v * (st.g || 0); st.run = st.g > 0 && v > vn * 0.8;
      if (v > vn * 1.45 && !st.over) { st.over = true; sim.say("danger", p, "A " + vn + " V appliance was given " + v.toFixed(0) + " V. It is burnt out."); }
      sim.tot.load += st.p * dt / 3600;
      if (st.g > 0 && !st.run) sim.tot.unmet += dt / 3600;
    }
  };
  W.BEHAVE = B;

  /* ------------------------------------------------------------ the tick */

  Sim.prototype.build = function (mode) {
    var self = this, n = this.N, i;
    this.Ar.fill(0); this.Ai.fill(0); this.br.fill(0); this.bi.fill(0);
    for (i = 0; i < n; i++) this.Ar[i * n + i] = GMIN;
    this.wires.forEach(function (q) { if (!self.wstate[q.w.id].burnt) self.Y(q.a, q.b, 1 / W.wireR(q.w), 0); });
    this.doc.parts.forEach(function (p) {
      var st = self.state[p.id], map = self.pn[p.id], pr = W.propsOf(p), b = B[p.type];
      if (LINKS[p.type]) LINKS[p.type](pr, st).forEach(function (l) { self.Y(map[l[0]], map[l[1]], 1 / (l[2] + (pr.fault === "loose" ? 0.6 : 0)), 0); });
      if (!b) return;
      if (mode === "dead") { if (b.dead) b.dead(self, p, pr, st, map); }
      else if (mode === "trace") { if (p.type === "pv") b.stamp(self, p, pr, st, map); }
      else if (b.stamp) b.stamp(self, p, pr, st, map);
    });
  };

  /* A long stride of simulated time: let the trackers and controllers find
   * their feet first, as they would have over those minutes. */
  Sim.prototype.stride = function (dt) { for (var i = 0; i < 4; i++) this.step(0); this.step(dt); };

  Sim.prototype.step = function (dt) {
    var self = this, doc = this.doc, parts = doc.parts, it, resid;
    dt = dt || 0;
    if (this.dirty) this.index();
    if (!this.N) { this.tick++; this.t += dt; return; }
    this.islands();
    parts.forEach(function (p) { var b = B[p.type]; if (b && b.pre) b.pre(self, p, W.propsOf(p), self.state[p.id], self.pn[p.id], dt); });
    /* two supplies joined: whichever can protect itself does */
    this.islands();
    this.alarms.forEach(function (a) {
      if (a.code !== "backfeed") return;
      a.parts.forEach(function (id) {
        var p = W.partById(doc, id), st = self.state[id];
        if (p && /^(inverter|hybrid|genset)$/.test(p.type) && !st.err) {
          st.err = "backfeed"; st.run = false; st.live = false; if (p.type === "hybrid") st.mode = "off";
          self.say("danger", p, W.def(p).name + " was back-fed from another supply and shut down. In real life it would be destroyed — and a lineman working on the 'dead' grid could be killed.");
        }
      });
    });
    for (it = 0; it < 24; it++) {
      this.build();
      this.solve();
      resid = 0;
      for (var i = 0; i < parts.length; i++) {
        var b = B[parts[i].type];
        if (b && b.iter) { var r1 = b.iter(self, parts[i], W.propsOf(parts[i]), self.state[parts[i].id], self.pn[parts[i].id]); if (r1 > resid) { resid = r1; self.slow = parts[i].id; } }
      }
      if (resid < 0.02 && it > 0) break;
    }
    this.iters = it + 1;
    parts.forEach(function (p) {
      var st = self.state[p.id], map = self.pn[p.id], pr = W.propsOf(p), b = B[p.type];
      if (LINKS[p.type]) {
        st.li = []; st.imax = 0;
        LINKS[p.type](pr, st).forEach(function (l) {
          var r = l[2] + (pr.fault === "loose" ? 0.6 : 0), d = self.dv(map[l[0]], map[l[1]]);
          st.li.push([d[0] / r, d[1] / r, l[3]]); st.imax = Math.max(st.imax, hyp(d[0], d[1]) / r);
        });
      }
      if (b && b.post) b.post(self, p, pr, st, map, dt);
    });
    this.wires.forEach(function (q) {
      var ws = self.wstate[q.w.id];
      if (ws.burnt) { ws.mag = 0; ws.loss = 0; return; }
      var r = W.wireR(q.w), d = self.dv(q.a, q.b), ir = d[0] / r, ii = d[1] / r, mag = hyp(ir, ii), iz = W.ampacity(q.w.mm2), ratio = mag / iz;
      ws.mag = mag; ws.loss = mag * mag * r; ws.drop = mag * r; ws.ratio = ratio;
      /* which way the energy is going: real power into the wire at end a */
      var pa = self.vr(q.a) * ir + self.vi(q.a) * ii, pb = self.vr(q.b) * ir + self.vi(q.b) * ii, flow = Math.abs(pa) > Math.abs(pb) ? pa : pb;
      ws.dir = mag < 0.005 ? 0 : flow >= 0 ? 1 : -1;
      if (ratio > 1.05) { ws.heat += (ratio * ratio - 1) * (dt || 0.02) / 60; if (ws.heat >= 1) { ws.burnt = true; var pa2 = W.partById(doc, q.w.a.split(":")[0]); self.say("danger", pa2, "A " + q.w.mm2 + " mm² cable carrying " + mag.toFixed(0) + " A (it is good for " + iz.toFixed(0) + " A) has burnt through. This is how house fires start."); } }
      else ws.heat = Math.max(0, ws.heat - (dt || 0.02) / 120);
    });
    this.t += dt; this.tick++;
  };

  /* What tapping a tripped device does: reset it. */
  Sim.prototype.resetPart = function (id) {
    var st = this.state[id]; if (!st) return;
    st.trip = null; st.blown = Array.isArray(st.blown) ? [] : false; st.h = 0; st.ovl = 0; st.over = false;
    if (st.err === 'overload' || st.err === 'backfeed' || st.err === 'wrong battery') st.err = null;
  };

  /* Run until the hunting and the trips have settled (no time passes). */
  Sim.prototype.settle = function (n) { for (var i = 0; i < (n || 80); i++) this.step(0); return this; };

  /* --------------------------------------------------------- measurement */

  Sim.prototype.node = function (key) { return this.idx ? this.idx[key] : null; };
  Sim.prototype.volt = function (a, b) {
    var na = this.node(a), nb = this.node(b);
    if (na == null || nb == null) return null;
    var d = this.dv(na, nb), ia = this.isl ? this.isl(na) : null, ib = this.isl ? this.isl(nb) : null;
    var ac = !!((ia && ia.ac.length) || (ib && ib.ac.length));
    return { mag: hyp(d[0], d[1]), re: d[0], im: d[1], ac: ac };
  };
  Sim.prototype.toEarth = function (a) { var n = this.node(a); return n == null ? null : hyp(this.vr(n), this.vi(n)); };

  /* Resistance between two terminals with every source dead: what an
   * ohmmeter or an insulation tester sees on an isolated installation. */
  Sim.prototype.deadR = function (a, b) {
    var na = this.node(a), nb = b === "earth" ? -1 : this.node(b);
    if (na == null || nb == null || na === nb) return na === nb && na != null ? 0 : null;
    var keepR = this.xr.slice(), keepI = this.xi.slice();
    this.build("dead"); this.J(nb, na, 1, 0); this.solve();
    var r = this.vr(na) - this.vr(nb);
    this.xr.set(keepR); this.xi.set(keepI);
    return r;
  };

  /* The I-V curve of whatever panels lie between two terminals, traced the
   * way an I-V tracer does it: everything else disconnected, the voltage
   * swept from short circuit to open circuit. */
  Sim.prototype.trace = function (plus, minus, points) {
    var na = this.node(plus), nb = this.node(minus), self = this, out = [];
    if (na == null || nb == null || na === nb) return out;
    var keepR = this.xr.slice(), keepI = this.xi.slice(), pvs = this.doc.parts.filter(function (p) { return p.type === "pv"; });
    var keep = pvs.map(function (p) { return self.state[p.id].vl; }), vmax = 0;
    pvs.forEach(function (p) { vmax += (W.PV[W.propsOf(p).model] || W.PV.p330).voc; });
    var solveAt = function (v) {
      for (var it = 0; it < 40; it++) {
        self.build("trace"); self.E(na, nb, v, 0, 0.001); self.solve();
        var res = 0;
        pvs.forEach(function (p) { res = Math.max(res, B.pv.iter(self, p, W.propsOf(p), self.state[p.id], self.pn[p.id])); });
        if (res < 0.01 && it > 1) break;
      }
      return ((self.vr(na) - self.vr(nb)) - v) / 0.001;
    };
    pvs.forEach(function (p) { self.state[p.id].vl = 0; });
    var n = points || 60, voc = null;
    for (var k = 0; k <= n; k++) {
      var v = vmax * 1.02 * k / n, i = solveAt(v);
      if (i < 0) { if (voc == null) { var last = out[out.length - 1]; voc = last ? last.v + (v - last.v) * last.i / (last.i - i) : 0; out.push({ v: voc, i: 0 }); } break; }
      out.push({ v: v, i: i });
    }
    pvs.forEach(function (p, j) { self.state[p.id].vl = keep[j]; });
    this.xr.set(keepR); this.xi.set(keepI);
    return out;
  };

  Sim.prototype.totals = function () {
    var soc = 0, n = 0, self = this;
    this.doc.parts.forEach(function (p) { if (p.type === "battery" && self.state[p.id] && self.state[p.id].soc != null) { soc += self.state[p.id].soc; n++; } });
    var pv = 0, load = 0, grid = 0;
    this.doc.parts.forEach(function (p) {
      var st = self.state[p.id] || {};
      if (p.type === "pv") pv += Math.max(0, st.p || 0);
      else if (/^(lamp|socket|load|dcload)$/.test(p.type)) load += st.p || 0;
      else if (/^(grid1|grid3|genset)$/.test(p.type)) grid += st.p || 0;
    });
    return { soc: n ? soc / n : null, pv: pv, load: load, grid: grid, wh: this.tot };
  };
})(typeof window !== "undefined" ? window : globalThis);
