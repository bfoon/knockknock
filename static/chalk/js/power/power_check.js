/* Chalk Power Lab — the inspector's checklist.
 *
 * What a careful electrician would say on looking over the plan: the
 * things that are dangerous, the things that will fail, and the things
 * that merely waste money. Each finding names the parts it is about, so
 * the page can point at them.
 *
 *   Check.run(doc, sim, on)  -> [{level: "danger"|"warn"|"info", msg, parts, wires}]
 *   Check.trace(doc, key, opts) -> {parts, wires, ends}   follow a conductor
 *   Check.bom(doc)           -> rows for the bill of materials
 *
 * No DOM: tested under Node.
 */
(function (root) {
  "use strict";

  var W = root.ChalkPower;
  var Check = W.Check = {};
  var BARS = { bar: ["1", "2", "3", "4", "5", "6", "7", "8"], combiner: ["S1-", "S2-", "S3-", "S4-", "OUT-"] };

  /* Follow one conductor from a terminal: along cables, across bars, and
   * through anything in `pass` (switches, breakers…) as if it were closed.
   * Stops at everything else and reports where it stopped. */
  Check.trace = function (doc, start, opts) {
    opts = opts || {};
    var adj = {}, byId = {}, seen = {}, queue = [start], out = { parts: {}, wires: {}, ends: [] };
    doc.parts.forEach(function (p) { byId[p.id] = p; });
    doc.wires.forEach(function (w) { (adj[w.a] = adj[w.a] || []).push([w.b, w]); (adj[w.b] = adj[w.b] || []).push([w.a, w]); });
    seen[start] = 1;
    var first = start.split(":")[0];
    while (queue.length) {
      var key = queue.shift(), id = key.split(":")[0], term = key.slice(id.length + 1), p = byId[id];
      if (!p) continue;
      var next = [];
      if (BARS[p.type] && BARS[p.type].indexOf(term) >= 0) BARS[p.type].forEach(function (t) { next.push(id + ":" + t); });
      var pass = opts.pass ? opts.pass(p) : !!W.PATHS[p.type];
      if (W.PATHS[p.type] && (pass || (id === first && key === start && opts.through))) {
        W.PATHS[p.type].forEach(function (l) { if (l[0] === term) next.push(id + ":" + l[1]); else if (l[1] === term) next.push(id + ":" + l[0]); });
        out.parts[id] = p;
      } else if (!BARS[p.type] && key !== start) { out.ends.push({ part: p, term: term }); continue; }
      else if (BARS[p.type]) out.parts[id] = p;
      (adj[key] || []).forEach(function (e) { out.wires[e[1].id] = e[1]; next.push(e[0]); });
      next.forEach(function (k) { if (!seen[k]) { seen[k] = 1; queue.push(k); } });
    }
    return out;
  };

  function wired(doc) { var s = {}; doc.wires.forEach(function (w) { s[w.a] = 1; s[w.b] = 1; }); return s; }

  Check.run = function (doc, sim, on) {
    var out = [], has = wired(doc), refs = W.refs(doc), by = {}, k;
    var add = function (level, msg, parts, wires) { out.push({ level: level, msg: msg, parts: (parts || []).map(function (p) { return p.id || p; }), wires: wires || [] }); };
    var name = function (p) { return W.label(doc, p, refs); };
    doc.parts.forEach(function (p) { (by[p.type] = by[p.type] || []).push(p); });
    var n = function (t) { return (by[t] || []).length; };
    if (!doc.parts.length) return out;

    /* ---- live: what the simulator is shouting about */
    if (on && sim) {
      (sim.alarms || []).forEach(function (a) { add("danger", a.msg, a.parts); });
      doc.parts.forEach(function (p) {
        var st = sim.state[p.id] || {}, pr = W.propsOf(p);
        if (st.trip) add("warn", name(p) + " has tripped (" + (st.trip === "leak" ? "earth leakage" : st.trip === "short" ? "short circuit" : "overload") + "). Find the cause before you reset it.", [p]);
        if (st.blown === true) add("warn", name(p) + " has blown.", [p]);
        if (st.pvdead || st.mode === "dead") add("danger", name(p) + " was destroyed by too high a panel voltage.", [p]);
        if (st.err && /^(inverter|hybrid|genset)$/.test(p.type) && pr.on !== false) add(st.err === "backfeed" ? "danger" : "warn", name(p) + ": " + st.err + ".", [p]);
        if (st.touch > 50) add("danger", name(p) + ": the metal case is live at " + st.touch.toFixed(0) + " V and nothing has tripped. Whoever touches it completes the circuit.", [p]);
        if (/^(lamp|socket|load)$/.test(p.type) && st.g > 0 && st.v > 60 && st.v < 230 * 0.94) add("warn", name(p) + " only gets " + st.v.toFixed(0) + " V — a drop of " + ((1 - st.v / 230) * 100).toFixed(1) + "%. The cable to it is too thin or too long (aim for under 5%).", [p]);
        if (p.type === "battery" && st.soc != null && pr.chem !== "lfp" && st.soc < 0.45) add("warn", name(p) + " is down to " + Math.round(st.soc * 100) + "%. Lead-acid taken below half, night after night, lasts a year instead of five.", [p]);
        if (p.type === "pv" && st.bypass) add("info", name(p) + " is being bypassed: it is shaded or weaker than its neighbours, so the string's current is going round it.", [p]);
        if (/^(inverter|hybrid)$/.test(p.type) && st.s > 0.9 * pr.va) add("warn", name(p) + " is running at " + Math.round(100 * st.s / pr.va) + "% of its rating.", [p]);
      });
      var hot = [], burnt = [];
      doc.wires.forEach(function (w) { var ws = sim.wstate[w.id]; if (!ws) return; if (ws.burnt) burnt.push(w.id); else if (ws.ratio > 1.02) hot.push(w); });
      if (burnt.length) add("danger", burnt.length + " cable" + (burnt.length > 1 ? "s have" : " has") + " burnt through. Replace with a thicker one and find out why no breaker stopped it.", [], burnt);
      hot.slice(0, 6).forEach(function (w) { var ws = sim.wstate[w.id]; add("danger", "A " + w.mm2 + " mm² cable is carrying " + ws.mag.toFixed(1) + " A; it is only good for " + W.ampacity(w.mm2).toFixed(0) + " A. It will overheat.", [], [w.id]); });
      var dcl = [];
      doc.wires.forEach(function (w) { var ws = sim.wstate[w.id]; if (ws && !ws.burnt && ws.loss > 25 && ws.ratio <= 1.02) dcl.push([w, ws]); });
      dcl.sort(function (a, b) { return b[1].loss - a[1].loss; }).slice(0, 3).forEach(function (q) { add("info", "A " + q[0].mm2 + " mm² cable, " + q[0].len + " m long, is wasting " + q[1].loss.toFixed(0) + " W as heat (" + q[1].drop.toFixed(1) + " V lost along it). A thicker or shorter cable would save it.", [], [q[0].id]); });
    }

    /* ---- earthing */
    var needPE = doc.parts.filter(function (p) { return /^(socket|load)$/.test(p.type); });
    if (needPE.length || n("inverter") || n("hybrid")) {
      if (!n("earth")) add("danger", "There is no earth rod. Without one a fault has nowhere to go, an RCD cannot see it, and a surge protector cannot work.", []);
      else (by.earth || []).forEach(function (p) { if (W.propsOf(p).ohms > 100) add("warn", name(p) + " measures " + W.propsOf(p).ohms + " Ω: too high to be relied on. Drive it deeper, add a second rod, or water the ground.", [p]); if (!has[p.id + ":PE"]) add("warn", name(p) + " is not connected to anything.", [p]); });
    }
    var noPE = needPE.filter(function (p) { var s = W.loadSpec(W.propsOf(p)); return !has[p.id + ":PE"] && has[p.id + ":L"] && W.propsOf(p).app !== "none" && (s.earth || p.type === "load"); });
    if (noPE.length) add("danger", noPE.length + " appliance" + (noPE.length > 1 ? "s with metal cases have" : " with a metal case has") + " no earth wire: " + noPE.slice(0, 4).map(name).join(", ") + ".", noPE);

    /* ---- half-wired things */
    var loose = doc.parts.filter(function (p) {
      var t = W.termsOf(p).filter(function (q) { return q.k !== "PE"; });
      if (!t.length || /^(bar|combiner|spd|changeover|switch2|photocell)$/.test(p.type)) return false;
      var c = t.filter(function (q) { return has[p.id + ":" + q.n]; }).length;
      return c > 0 && c < t.length && !(p.type === "hybrid" || p.type === "grid3" || p.type === "genset");
    });
    if (loose.length) add("warn", "Not fully wired: " + loose.slice(0, 5).map(name).join(", ") + (loose.length > 5 ? " and " + (loose.length - 5) + " more" : "") + ".", loose);
    var alone = doc.parts.filter(function (p) { var t = W.termsOf(p); return t.length && !t.some(function (q) { return has[p.id + ":" + q.n]; }); });
    if (alone.length && alone.length < doc.parts.length) add("info", alone.length + " part" + (alone.length > 1 ? "s are" : " is") + " not wired in yet: " + alone.slice(0, 4).map(name).join(", ") + ".", alone);

    /* ---- sockets need an RCD */
    var bare = [];
    (by.socket || []).forEach(function (p) {
      if (!has[p.id + ":L"]) return;
      var t = Check.trace(doc, p.id + ":L", {}), rcd = false, src = false;
      for (k in t.parts) if (t.parts[k].type === "rcd") rcd = true;
      t.ends.forEach(function (e) { if (/^(grid1|grid3|genset|inverter|hybrid|gridtie)$/.test(e.part.type)) src = true; });
      if (src && !rcd) bare.push(p);
    });
    if (bare.length) add("warn", bare.length + " socket" + (bare.length > 1 ? "s are" : " is") + " not behind an RCD. A 30 mA RCD is what saves a life when a hand finds a live wire.", bare);

    /* ---- every cable must be protected by something smaller than itself */
    (by.mcb || []).concat(by.fuse || []).forEach(function (p) {
      var rate = +W.propsOf(p).amps, t = Check.trace(doc, p.id + ":out", { pass: function (q) { return !!W.PATHS[q.type] && !/^(mcb|fuse)$/.test(q.type); } }), thin = [];
      for (k in t.wires) if (W.ampacity(t.wires[k].mm2) < rate) thin.push(t.wires[k]);
      if (thin.length) add("danger", name(p) + " is rated " + rate + " A but protects " + thin[0].mm2 + " mm² cable that is only good for " + W.ampacity(thin[0].mm2).toFixed(0) + " A. The cable would burn before the breaker noticed.", [p], thin.map(function (w) { return w.id; }));
    });

    /* ---- batteries */
    (by.battery || []).forEach(function (p) {
      if (!has[p.id + ":+"]) return;
      var t = Check.trace(doc, p.id + ":+", { pass: function (q) { return !!W.PATHS[q.type] && !/^(mcb|fuse)$/.test(q.type); } });
      var raw = t.ends.filter(function (e) { return !/^(battery|fuse|mcb)$/.test(e.part.type); });
      if (raw.length) add("danger", name(p) + " feeds " + name(raw[0].part) + " with no fuse between them. A shorted battery cable carries thousands of amps: it glows, then it burns.", [p, raw[0].part]);
    });
    var kinds = {};
    (by.battery || []).forEach(function (p) { var pr = W.propsOf(p); kinds[pr.chem + "/" + pr.volts + "/" + pr.ah] = 1; });
    if (Object.keys(kinds).length > 1) add("warn", "The batteries are not all the same type and size. In one bank the weakest drags the others down; never mix them.", by.battery);

    /* ---- the array against what it feeds */
    var chargers = (by.mppt || []).concat(by.pwm || [], by.hybrid || [], by.gridtie || []);
    if (chargers.length && n("pv") && W.Sim) {
      var ts = new W.Sim(doc); ts.env = { G: 0, tamb: -6 }; ts.step(0); ts.step(0);
      var bankV = function (p) { var m = ts.pn[p.id], v = ts.vr(m["B+"]) - ts.vr(m["B-"]); return v > 36 ? 48 : v > 18 ? 24 : 12; };
      ts.env = { G: 1000, tamb: -6 };
      chargers.forEach(function (p) {
        if (!has[p.id + ":PV+"] || !has[p.id + ":PV-"]) return;
        var a = Check.trace(doc, p.id + ":PV+", {}), b = Check.trace(doc, p.id + ":PV-", {});
        var ea = a.ends.filter(function (e) { return e.part.type === "pv"; })[0], eb = b.ends.filter(function (e) { return e.part.type === "pv"; })[0];
        if (!ea || !eb) return;
        var curve = ts.trace(ea.part.id + ":" + ea.term, eb.part.id + ":" + eb.term, 30);
        if (curve.length < 3) { add("warn", "The panels on " + name(p) + " are connected the wrong way round, or not in a complete string.", [p]); return; }
        var voc = curve[curve.length - 1].v * 1.06, isc = curve[0].i, pm = 0, pr = W.propsOf(p);
        curve.forEach(function (q) { pm = Math.max(pm, q.v * q.i); });
        if (voc > +pr.maxpv) add("danger", "On a cold bright morning the panels reach " + voc.toFixed(0) + " V, above the " + pr.maxpv + " V that " + name(p) + " can stand. Put fewer panels in each string.", [p]);
        else if (voc > 0.92 * pr.maxpv) add("info", "The panels reach " + voc.toFixed(0) + " V cold, close to the " + pr.maxpv + " V limit of " + name(p) + ". It works, with no room to spare.", [p]);
        var vb = p.type === "hybrid" ? +pr.vdc : p.type === "gridtie" ? 0 : bankV(p);
        if (p.type === "pwm" && isc * 1.25 > pr.amps) add("danger", "The array can deliver " + isc.toFixed(1) + " A, too much for the " + pr.amps + " A " + name(p) + ".", [p]);
        if (p.type === "pwm" && voc / 1.06 > vb * 2.1) add("warn", name(p) + " drags the panels down to battery voltage. With " + (voc / 1.06).toFixed(0) + " V panels on a " + vb + " V battery, about " + Math.round((1 - vb * 1.15 / (voc / 1.06 * 0.8)) * 100) + "% of the power is thrown away. Use an MPPT controller.", [p]);
        if (p.type === "mppt" && pm / (vb * 1.15) > pr.amps * 1.3) add("info", "The array can make " + Math.round(pm) + " W but " + name(p) + " can only pass " + Math.round(pr.amps * vb * 1.15) + " W at " + vb + " V. The rest is clipped at midday.", [p]);
        if (p.type === "mppt" && voc / 1.06 * 0.8 < vb * 1.2 + 1) add("warn", "The string's working voltage is too close to the " + vb + " V battery for " + name(p) + " to charge it fully. Put more panels in series.", [p]);
      });
    }
    if (n("pv") && !chargers.length && n("battery")) add("danger", "Panels are wired with no charge controller. They will boil the battery on a sunny day.", by.pv);
    var models = {};
    (by.pv || []).forEach(function (p) { models[W.propsOf(p).model] = 1; });
    if (Object.keys(models).length > 1) add("info", "The array mixes different panels. In a series string the smallest sets the current for all of them.", by.pv);

    /* ---- the site */
    if (n("pv")) {
      var s = doc.site || {}, best = W.Sun.bestTilt(+s.lat || 0), az = W.Sun.bestAz(+s.lat || 0);
      if (Math.abs((+s.tilt || 0) - best) > 14) add("info", "The panels are tilted " + (+s.tilt || 0) + "°. Around " + best + "° suits this latitude best" + ((+s.tilt || 0) < 10 ? ", and under 10° the rain cannot wash the dust off." : "."), []);
      var off = Math.abs((((+s.az || 0) - az) + 540) % 360 - 180);
      if (off > 50 && (+s.tilt || 0) > 5) add("warn", "The panels face " + (+s.az || 0) + "°. They should face " + (az === 180 ? "south" : "north") + " here; this way they lose a good part of the day.", []);
      if (!n("spd")) add("info", "No surge protector. Panels on a roof are the tallest metal around in a thunderstorm.", []);
    }
    if (n("grid1") + n("grid3") + n("genset") > 1 && !n("changeover")) add("warn", "There is more than one supply and no changeover switch to keep them apart.", (by.genset || []).concat(by.grid1 || []));
    var order = { danger: 0, warn: 1, info: 2 };
    return out.sort(function (a, b) { return order[a.level] - order[b.level]; });
  };

  /* ------------------------------------------------- bill of materials */

  Check.bom = function (doc) {
    var rows = {}, cable = {}, total = 0;
    doc.parts.forEach(function (p) {
      var d = W.def(p), pr = W.propsOf(p);
      if (!d || d.cat === "Notes" || /^(grid1|grid3)$/.test(p.type)) return;
      var desc = d.name;
      if (p.type === "pv") desc = "Solar panel " + (W.PV[pr.model] || W.PV.p330).name;
      else if (p.type === "battery") desc = "Battery " + pr.volts + " V " + pr.ah + " Ah " + (pr.chem === "lfp" ? "LiFePO₄" : pr.chem === "tubular" ? "tubular" : "AGM");
      else if (/^(mppt|pwm)$/.test(p.type)) desc = d.name + " " + pr.amps + " A" + (p.type === "mppt" ? " / " + pr.maxpv + " V" : "");
      else if (/^(inverter|hybrid|gridtie)$/.test(p.type)) desc = d.name + " " + (pr.va / 1000) + " kVA" + (pr.vdc ? " " + pr.vdc + " V" : "");
      else if (p.type === "mcb") desc = "MCB " + pr.curve + pr.amps;
      else if (p.type === "fuse") desc = "Fuse and holder " + pr.amps + " A";
      else if (p.type === "rcd") desc = "RCD " + pr.amps + " A / " + pr.ma + " mA";
      else if (p.type === "genset") desc = "Generator " + pr.kva + " kVA";
      else if (p.type === "lamp") desc = "Lamp " + pr.watts + " W with holder";
      else if (p.type === "bar") desc = "Terminal bar";
      else if (/^(socket|load|dcload|meter)$/.test(p.type)) desc = p.type === "socket" ? "Socket outlet 13 A" : p.type === "meter" ? "Meter (supplied by the utility)" : null;
      if (!desc) return;
      var qty = p.type === "lamp" ? +pr.qty || 1 : 1, key = p.type + "|" + desc, unit = W.priceOf(doc, p);
      if (doc.prices && doc.prices[key] != null) unit = +doc.prices[key];
      var r = rows[key] = rows[key] || { key: key, item: desc, qty: 0, unit: unit, kind: "part" };
      r.qty += qty;
    });
    doc.wires.forEach(function (w) { cable[w.mm2] = (cable[w.mm2] || 0) + (+w.len || 1); });
    var list = Object.keys(rows).map(function (k2) { return rows[k2]; });
    Object.keys(cable).sort(function (a, b) { return a - b; }).forEach(function (mm) {
      var key = "cable|" + mm, unit = doc.prices && doc.prices[key] != null ? +doc.prices[key] : Math.round(18 + mm * 21);
      list.push({ key: key, item: "Copper cable " + mm + " mm² (per metre, 10% spare)", qty: Math.ceil(cable[mm] * 1.1), unit: unit, kind: "cable" });
    });
    list.forEach(function (r) { r.total = r.qty * r.unit; total += r.total; });
    return { rows: list, total: total };
  };
})(typeof window !== "undefined" ? window : globalThis);
