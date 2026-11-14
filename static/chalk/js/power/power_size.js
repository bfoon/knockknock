/* Chalk Power Lab — sizing a system, and building it.
 *
 *   Design.size(spec)     the arithmetic an installer does on paper:
 *                         energy per day -> panels, battery, controller,
 *                         inverter, cables and fuses, with the working shown
 *   Design.build(design)  that system as a wired plan, ready to switch on
 *   Design.parse(text)    "a clinic with a vaccine fridge and 8 lights" -> spec
 *
 * A spec is {type, loads:[{app, name, watts, qty, hours}], site, autonomy,
 * chem, panel}. type is one of
 *   offgrid   panels + battery + inverter, no grid
 *   hybrid    all-in-one inverter with the grid as a back-up
 *   gridtie   panels feeding the house wiring, no battery
 *   grid      no solar: just the wiring of a building
 *   shs       a small 12 V solar home system, DC only
 *
 * Pure functions: tested under Node.
 */
(function (root) {
  "use strict";

  var W = root.ChalkPower, Sun = W.Sun;
  var Design = W.Design = {};
  var INV = [300, 600, 1000, 1500, 2000, 3000, 5000, 8000, 10000];
  var CTRL = [10, 20, 30, 40, 60, 80, 100], MAXPV = [75, 100, 150, 250, 450];
  var FUSES = [5, 10, 15, 20, 30, 40, 60, 80, 100, 125, 160, 200, 250, 400];
  var MCBS = [6, 10, 16, 20, 25, 32, 40, 63, 100, 125];
  function up(list, v) { for (var i = 0; i < list.length; i++) if (list[i] >= v) return list[i]; return list[list.length - 1]; }

  Design.PRESETS = {
    home_small: { name: "Small home", type: "offgrid", loads: [["lamp", 6, 5], ["phone", 3], ["led_tv", 1], ["decoder", 1], ["fan", 2]] },
    home:       { name: "Family home", type: "hybrid", loads: [["lamp", 10, 5], ["led_tv", 1], ["decoder", 1], ["fridge", 1], ["ceiling_fan", 3], ["laptop", 2], ["phone", 4], ["router", 1], ["iron", 1]] },
    clinic:     { name: "Health post", type: "offgrid", autonomy: 2, loads: [["lamp", 8, 8], ["vaccine", 1], ["laptop", 1], ["phone", 4], ["ceiling_fan", 2], ["router", 1]] },
    school:     { name: "School block", type: "offgrid", loads: [["lamp", 12, 4], ["laptop", 6, 5], ["printer", 1], ["router", 1], ["ceiling_fan", 6, 6], ["speaker", 1, 1]] },
    shop:       { name: "Shop with a freezer", type: "hybrid", loads: [["lamp", 4, 8], ["freezer", 1], ["fridge", 1], ["led_tv", 1], ["phone", 6], ["fan", 1]] },
    office:     { name: "Small office", type: "hybrid", loads: [["lamp", 8, 9], ["desktop", 4], ["laptop", 3], ["printer", 1], ["router", 1], ["cctv", 1], ["aircon", 1]] },
    borehole:   { name: "Village borehole", type: "offgrid", autonomy: 0.5, loads: [["borehole", 1, 5], ["lamp", 2, 10]] },
    kiosk:      { name: "Phone-charging kiosk", type: "shs", loads: [["usb", 3, 8], ["lamp", 2, 5], ["radio", 1, 8]] },
    tailor:     { name: "Tailor's workshop", type: "offgrid", loads: [["sewing", 3], ["lamp", 4, 6], ["iron", 1], ["fan", 1], ["phone", 3]] },
    house_grid: { name: "House wiring (grid only)", type: "grid", loads: [["lamp", 8, 5], ["led_tv", 1], ["fridge", 1], ["kettle", 1], ["iron", 1], ["ceiling_fan", 2], ["heater", 1], ["washer", 1]] }
  };
  Design.fromPreset = function (key) {
    var p = Design.PRESETS[key];
    if (!p) return null;
    return { type: p.type, title: p.name, autonomy: p.autonomy || 1, loads: p.loads.map(function (l) { return { app: l[0], qty: l[1] || 1, hours: l[2] == null ? -1 : l[2] }; }) };
  };

  /* Fill a load row in from the catalogue. */
  function norm(l, dc) {
    var qty = Math.max(1, Math.round(+l.qty || 1));
    if (dc) {
      var d = W.DC_LOADS[l.app] || W.DC_LOADS.custom, wd = l.app in W.DC_LOADS && l.app !== "custom" ? d.watts : +l.watts || d.watts;
      return { app: W.DC_LOADS[l.app] ? l.app : "custom", name: l.name || d.name, watts: wd, qty: qty, hours: l.hours >= 0 ? +l.hours : 5, pf: 1, surge: 1, duty: 1, dc: true };
    }
    if (l.app === "lamp") return { app: "lamp", name: l.name || "LED lamp", watts: +l.watts || 9, qty: qty, hours: l.hours >= 0 ? +l.hours : 5, pf: 0.95, surge: 1, duty: 1 };
    var a = W.APPLIANCES[l.app] && l.app !== "none" ? W.APPLIANCES[l.app] : null;
    if (!a || l.app === "custom") return { app: "custom", name: l.name || "Appliance", watts: W.clamp(+l.watts || 100, 1, 20000), qty: qty, hours: l.hours >= 0 ? +l.hours : 4, pf: 0.9, surge: +l.surge || 1, duty: 1 };
    return { app: l.app, name: a.name, watts: a.watts, qty: qty, hours: l.hours >= 0 ? +l.hours : a.hours, pf: a.pf, surge: a.surge, duty: a.duty, earth: !!a.earth };
  }
  Design.normLoad = norm;

  Design.size = function (spec) {
    spec = spec || {};
    var type = /^(offgrid|hybrid|gridtie|grid|shs)$/.test(spec.type) ? spec.type : "offgrid", dc = type === "shs";
    var site = {}, k, base = W.blankDoc().site;
    for (k in base) site[k] = base[k];
    for (k in (spec.site || {})) site[k] = spec.site[k];
    var loads = (spec.loads || []).slice(0, 40).map(function (l) { return norm(l, dc); }).filter(function (l) { return l.watts > 0; });
    var eDay = 0, peak = 0, kick = 0, notes = [], warn = [];
    loads.forEach(function (l) { l.wh = l.watts * l.qty * l.hours * l.duty; eDay += l.wh; peak += l.watts * l.qty; kick = Math.max(kick, l.watts * (l.surge - 1)); });
    var d = { type: type, title: spec.title || "", site: site, loads: loads, eDay: eDay, peak: peak, surge: peak + kick, notes: notes, warn: warn, autonomy: W.clamp(+spec.autonomy || 1, 0.25, 5) };
    notes.push(["Energy a day", loads.length + " kinds of load add up to " + Math.round(eDay) + " Wh a day (watts × how many × hours" + (loads.some(function (l) { return l.duty < 1; }) ? ", and a fridge only runs part of each hour" : "") + "). All on at once they draw " + Math.round(peak) + " W."]);
    if (type === "grid") {
      d.mainA = up(MCBS, peak / 230 * 1.25);
      notes.push(["Main switch", Math.round(peak) + " W ÷ 230 V = " + (peak / 230).toFixed(1) + " A, so a " + d.mainA + " A main switch with a 30 mA RCD after it."]);
      return d;
    }
    /* the sun: size for the worst month, so it works all year */
    site.tilt = spec.site && spec.site.tilt != null ? site.tilt : Sun.bestTilt(site.lat);
    site.az = spec.site && spec.site.az != null ? site.az : Sun.bestAz(site.lat);
    var worst = Sun.worstMonth(site);
    d.psh = worst.psh; d.month = worst.month;
    notes.push(["The sun", "At " + site.name + " the panels, tilted " + site.tilt + "° and facing " + (site.az === 180 ? "south" : site.az === 0 ? "north" : site.az + "°") + ", get " + worst.psh.toFixed(1) + " peak sun hours in " + Sun.MONTHS[worst.month - 1] + ", the poorest month. Size for that and every other month has power to spare."]);

    /* inverter */
    if (!dc) {
      d.inverterVA = up(INV, Math.max(peak * 1.25, d.surge / 2, type === "hybrid" ? 1000 : 300));
      d.vsys = d.inverterVA <= 1000 ? 12 : d.inverterVA <= 3000 ? 24 : 48;
      if (type === "hybrid" && d.vsys < 24) d.vsys = 24;
      if (peak * 1.25 > 10000) warn.push("These loads need more than a 10 kVA inverter. Split them over two systems, or move the heaviest onto the grid or a generator.");
    } else { d.vsys = 12; d.inverterVA = 0; }

    /* battery */
    var chem = spec.chem === "lfp" || spec.chem === "tubular" ? spec.chem : "agm", dod = chem === "lfp" ? 0.8 : 0.5;
    var night = type === "hybrid" ? 0.65 : 1;      /* a hybrid leans on the grid when the battery is low */
    var pr = type === "gridtie" ? 0.8 : 0.68, wpNeed = eDay / (d.psh * pr);
    var bankWh = eDay * d.autonomy * night / (dod * (dc ? 1 : 0.9));
    /* a bigger system wants a higher battery voltage: thinner cable, smaller controller */
    while (!dc && d.vsys < 48 && (bankWh / d.vsys > 800 || wpNeed / d.vsys > 85)) d.vsys *= 2;
    if (!dc) notes.push(["Inverter", Math.round(peak) + " W running, plus " + Math.round(kick) + " W extra for a moment when the biggest motor starts. Allowing a quarter spare: a " + (d.inverterVA >= 1000 ? d.inverterVA / 1000 + " kVA" : d.inverterVA + " VA") + " inverter on a " + d.vsys + " V battery."]);
    if (type !== "gridtie") {
      var bankAh = bankWh / d.vsys;
      d.chem = chem; d.dod = dod;
      if (chem === "lfp") { d.battV = d.vsys; d.bs = 1; }
      else { d.battV = 12; d.bs = d.vsys / 12; }
      var sizes = [50, 100, 150, 200, 250, 300], pick = null;
      for (var bp = 1; bp <= 4 && !pick; bp++) for (var i = 0; i < sizes.length; i++) if (sizes[i] * bp >= bankAh) { pick = [sizes[i], bp]; break; }
      if (!pick) { pick = [300, 4]; warn.push("The battery this needs (" + Math.round(bankAh) + " Ah at " + d.vsys + " V) is bigger than four parallel strings. Trim the night-time loads or the days of autonomy."); }
      if (dc && bankAh <= 18) pick = [bankAh <= 7 ? 7 : 18, 1];
      d.battAh = pick[0]; d.bp = pick[1]; d.bankAh = d.battAh * d.bp; d.bankWh = d.bankAh * d.vsys; d.usableWh = d.bankWh * dod;
      notes.push(["Battery", Math.round(eDay) + " Wh × " + d.autonomy + " day" + (d.autonomy === 1 ? "" : "s") + (night < 1 ? " × " + night + " (the grid covers the rest)" : "") + " ÷ " + dod + " (only " + Math.round(dod * 100) + "% of a " + (chem === "lfp" ? "lithium" : "lead-acid") + " battery should be used)" + (dc ? "" : " ÷ 0.9 inverter efficiency") +
        " = " + Math.round(bankWh) + " Wh, which is " + Math.round(bankAh) + " Ah at " + d.vsys + " V. Use " + (d.bs * d.bp) + " × " + d.battV + " V " + d.battAh + " Ah" + (d.bs > 1 ? ", " + d.bs + " in series" : "") + (d.bp > 1 ? ", " + d.bp + " strings in parallel" : "") + "."]);
    }

    /* panels */
    var model = W.PV[spec.panel] ? spec.panel : wpNeed <= 60 ? "p50" : wpNeed <= 260 ? "p100" : wpNeed <= 1400 ? "p330" : "p550", m = W.PV[model];
    var n = Math.max(1, Math.ceil(wpNeed / m.wp)), vchg = 14.6 * d.vsys / 12;
    var topV = type === "hybrid" ? 450 : type === "gridtie" ? 500 : dc ? 50 : 250;
    var nsMin = type === "gridtie" ? Math.ceil(90 / (m.vmp * 0.85)) : Math.max(1, Math.ceil(vchg * 1.02 / (m.vmp * 0.85))), nsMax = Math.max(nsMin, Math.floor(topV / (m.voc * 1.15)));
    var ns = nsMin, np = Math.ceil(n / ns);
    while (np > 4 && ns < nsMax) { ns++; np = Math.ceil(n / ns); }
    if (np > 4) { warn.push("The array wants more than four strings; it has been held at four. Use bigger panels or a second controller for the rest."); np = 4; }
    d.panel = model; d.ns = ns; d.np = np; d.nPanels = ns * np; d.wp = d.nPanels * m.wp;
    d.stringVoc = ns * m.voc * 1.12; d.stringVmp = ns * m.vmp; d.arrayIsc = np * m.isc;
    notes.push(["Panels", Math.round(eDay) + " Wh ÷ " + d.psh.toFixed(1) + " sun hours ÷ " + pr + " (losses: heat, dust, wiring, charging) = " + Math.round(wpNeed) + " Wp. That is " + n + " × " + m.wp + " W, rounded up to " + d.nPanels + " so every string is the same: " +
      np + " string" + (np > 1 ? "s" : "") + " of " + ns + " in series. A string gives about " + Math.round(d.stringVmp) + " V working and up to " + Math.round(d.stringVoc) + " V on a cold bright morning."]);

    /* controller */
    if (type === "offgrid" || dc) {
      d.maxpv = dc ? 50 : up(MAXPV, d.stringVoc);
      var amps = d.wp / d.vsys * 1.1;
      d.ctrlA = up(dc ? [10, 20, 30, 60] : CTRL, amps);
      d.ctrl = dc && d.wp <= 400 ? "pwm" : "mppt";
      if (d.ctrl === "pwm" && d.stringVoc > 26 * d.vsys / 12 * 1.2) d.ctrl = "mppt";
      if (d.ctrl === "mppt" && d.maxpv < 75) d.maxpv = 75;
      if (amps > 100) warn.push("The array can push " + Math.round(amps) + " A into the battery: more than one 100 A controller. Split the array over two controllers.");
      notes.push(["Charge controller", d.wp + " Wp ÷ " + d.vsys + " V = " + Math.round(d.wp / d.vsys) + " A at full sun, so a " + d.ctrlA + " A " + d.ctrl.toUpperCase() + " controller" + (d.ctrl === "mppt" ? " that accepts at least " + d.maxpv + " V from the panels." : ". (A PWM controller is fine this small, with 36-cell panels on a 12 V battery.)")]);
    } else if (type === "hybrid") {
      d.maxpv = 450; d.ctrlA = up([40, 60, 80, 100, 120], d.wp / d.vsys * 1.05);
    } else if (type === "gridtie") { d.inverterVA = up(INV.slice(2, 8), d.wp * 0.9); d.maxpv = up([150, 500, 600], d.stringVoc); }

    /* cables and fuses */
    d.pvMm2 = W.sizeFor(m.isc * 1.25, 12, d.stringVmp * 0.015); if (d.pvMm2 < 4) d.pvMm2 = 4;
    d.pvOutMm2 = W.sizeFor(d.arrayIsc * 1.25, 5, d.stringVmp * 0.01); if (d.pvOutMm2 < d.pvMm2) d.pvOutMm2 = d.pvMm2;
    if (type !== "gridtie") {
      var ibat = dc ? Math.max(peak / d.vsys, (d.ctrlA || 10)) : d.inverterVA / (d.vsys * 0.9);
      /* the fuse is chosen for the current, then the cable for the fuse:
       * a cable must always outlast the thing that protects it */
      d.battA = ibat; d.battFuse = up(FUSES, ibat * 1.25); d.battMm2 = W.sizeFor(d.battFuse / 1.25, 1.5, d.vsys * 0.01);
      d.ctrlFuse = up(FUSES, (d.ctrlA || 20) * 1.25); d.ctrlMm2 = W.sizeFor(d.ctrlFuse / 1.25, 2, d.vsys * 0.01);
      d.bankMm2 = Math.max(d.battMm2, type === "hybrid" ? 0 : d.ctrlMm2);
      notes.push(["Battery cable and fuse", "Flat out, the " + (dc ? "loads draw " : "inverter draws ") + Math.round(ibat) + " A from the battery" + (dc ? "" : " (" + d.inverterVA + " VA ÷ " + d.vsys + " V ÷ 0.9)") + ". Use " + d.battMm2 + " mm² cable kept under two metres, and a " + d.battFuse + " A fuse right at the battery positive."]);
    }
    notes.push(["Panel cable", "Each string carries up to " + (m.isc * 1.25).toFixed(1) + " A: " + d.pvMm2 + " mm² solar cable loses under 1.5% on a 12 m run." + (np > 1 ? " The " + np + " strings meet in a combiner box, each on its own fuse." : "")]);
    return d;
  };

  /* ------------------------------------------------------------ building */

  function Plan(site) {
    this.doc = W.blankDoc(); this.n = 0;
    if (site) for (var k in site) this.doc.site[k] = site[k];
  }
  Plan.prototype.add = function (type, x, y, props, name) {
    var p = { id: "p" + (++this.n) + "_" + type, type: type, x: Math.round(x / 10) * 10, y: Math.round(y / 10) * 10, props: props || {} };
    if (name) p.name = name;
    this.doc.parts.push(p);
    return p.id;
  };
  Plan.prototype.wire = function (a, b, mm2, len) { this.doc.wires.push({ id: "w" + (++this.n), a: a, b: b, mm2: mm2 || 2.5, len: len || 2 }); };
  Design.Plan = Plan;

  /* The array: np strings of ns panels. Returns [[plus, minus], …]. */
  function array(P, d, x0, y0) {
    var out = [];
    for (var s = 0; s < d.np; s++) {
      var ids = [];
      for (var m = 0; m < d.ns; m++) ids.push(P.add("pv", x0 + m * 100, y0 + s * 140, { model: d.panel }));
      for (m = 0; m + 1 < ids.length; m++) P.wire(ids[m] + ":-", ids[m + 1] + ":+", d.pvMm2, 1);
      out.push([ids[0] + ":+", ids[ids.length - 1] + ":-"]);
    }
    return out;
  }
  /* Strings -> (combiner) -> isolator. Returns [plus, minus] after it. */
  function collect(P, d, strings, x, y) {
    var plus = strings[0][0], minus = strings[0][1];
    if (strings.length > 1) {
      var cb = P.add("combiner", x, y, { amps: up([10, 15, 20, 25], W.PV[d.panel].isc * 1.5) });
      strings.forEach(function (s, i) { P.wire(s[0], cb + ":S" + (i + 1) + "+", d.pvMm2, 12); P.wire(s[1], cb + ":S" + (i + 1) + "-", d.pvMm2, 12); });
      plus = cb + ":OUT+"; minus = cb + ":OUT-"; x += 210;
    }
    var iso = P.add("isolator", x, y, { on: true, amps: 63 }, "PV isolator");
    P.wire(plus, iso + ":1", strings.length > 1 ? d.pvOutMm2 : d.pvMm2, strings.length > 1 ? 1 : 12);
    P.wire(minus, iso + ":3", strings.length > 1 ? d.pvOutMm2 : d.pvMm2, strings.length > 1 ? 1 : 12);
    return [iso + ":2", iso + ":4"];
  }
  /* The bank, on a + bar and a − bar. Returns {pos, neg} bar ids. */
  function bank(P, d, x, y) {
    var pos = P.add("bar", x, y, { role: "P" }, "Battery +"), neg = P.add("bar", x + 200, y, { role: "M" }, "Battery −"), t = 0;
    for (var s = 0; s < d.bp; s++) {
      var ids = [];
      for (var b = 0; b < d.bs; b++) ids.push(P.add("battery", x + (s * d.bs + b) * 130, y + 90, { chem: d.chem, volts: d.battV, ah: d.battAh, soc: 85 }));
      for (b = 0; b + 1 < ids.length; b++) P.wire(ids[b] + ":-", ids[b + 1] + ":+", d.bankMm2, 0.4);
      t++;
      P.wire(ids[0] + ":+", pos + ":" + (4 + t), d.bankMm2, 0.8); P.wire(ids[ids.length - 1] + ":-", neg + ":" + (4 + t), d.bankMm2, 0.8);
    }
    return { pos: pos, neg: neg };
  }
  /* A consumer unit and its circuits. src = {L, N, PE?}. */
  function board(P, d, src, x, y) {
    var iso = P.add("isolator", x, y, { on: true, amps: 63 }, "Main switch"), rcd = P.add("rcd", x + 90, y, { ma: 30, amps: 63 });
    var lb = P.add("bar", x, y + 120, { role: "L" }, "Live busbar"), nb = P.add("bar", x + 190, y + 120, { role: "N" }, "Neutral bar"), pe = P.add("bar", x + 380, y + 120, { role: "PE" }, "Earth bar");
    var rod = P.add("earth", x + 560, y + 100, { ohms: 8 }), feed = W.sizeFor(Math.max(16, d.peak / 230), 8, 2.3);
    if (feed < 4) feed = 4;
    P.wire(src.L, iso + ":1", feed, 6); P.wire(src.N, iso + ":3", feed, 6);
    P.wire(iso + ":2", rcd + ":Lin", feed, 0.3); P.wire(iso + ":4", rcd + ":Nin", feed, 0.3);
    P.wire(rcd + ":Lout", lb + ":1", feed, 0.3); P.wire(rcd + ":Nout", nb + ":1", feed, 0.3);
    P.wire(pe + ":4", rod + ":PE", 6, 5);
    if (src.PE) P.wire(src.PE, pe + ":1", 6, 6);
    /* circuits: lights together, small appliances four to a breaker, anything heavy on its own */
    var lamps = [], small = [], heavy = [];
    d.loads.forEach(function (l) {
      if (l.app === "lamp") { for (var q = l.qty; q > 0; q -= 4) lamps.push({ l: l, qty: Math.min(4, q) }); return; }
      for (var i = 0; i < Math.min(l.qty, 6); i++) (l.watts >= 1000 ? heavy : small).push({ l: l, qty: 1 });
    });
    var circuits = [];
    for (var i = 0; i < lamps.length; i += 5) circuits.push({ kind: "lights", items: lamps.slice(i, i + 5), amps: 10, curve: "B", mm2: 1.5 });
    for (i = 0; i < small.length; i += 4) circuits.push({ kind: "sockets", items: small.slice(i, i + 4), amps: 16, curve: "C", mm2: 2.5 });
    heavy.forEach(function (h) { var a = up(MCBS, h.l.watts / 230 * 1.25); circuits.push({ kind: "fixed", items: [h], amps: Math.max(16, a), curve: "C", mm2: a > 20 ? 4 : 2.5 }); });
    circuits = circuits.slice(0, 6);
    var cx = x;
    circuits.forEach(function (c, ci) {
      var q = P.add("mcb", cx + 20, y + 180, { amps: c.amps, curve: c.curve, on: true }, c.kind === "lights" ? "Lights" : c.kind === "sockets" ? "Sockets" : c.items[0].l.name);
      P.wire(lb + ":" + (ci < 4 ? 5 + ci : ci - 2), q + ":in", c.mm2, 0.3);
      var lastL = q + ":out", lastN = nb + ":" + (ci < 4 ? 5 + ci : ci - 2), lastPE = pe + ":" + (ci < 3 ? 5 + ci : ci < 4 ? 8 : ci - 2);
      c.items.forEach(function (it, k) {
        var ly = y + 300 + k * 150, len = k ? 4 : 10, id;
        if (c.kind === "lights") {
          var sw = P.add("switch1", cx + 4, ly, { on: true });
          id = P.add("lamp", cx + 60, ly - 6, { watts: it.l.watts, qty: it.qty, hours: it.l.hours });
          P.wire(lastL, sw + ":in", 1.5, len); P.wire(sw + ":out", id + ":L", 1.5, 3); P.wire(lastN, id + ":N", 1.5, len + 3);
          lastL = sw + ":in"; lastN = id + ":N";
        } else {
          var props = { app: it.l.app, on: true, hours: it.l.hours };
          if (it.l.app === "custom") { props.watts = it.l.watts; props.label = it.l.name; }
          id = P.add(c.kind === "fixed" ? "load" : "socket", cx + 4, ly, props);
          P.wire(lastL, id + ":L", c.mm2, len); P.wire(lastN, id + ":N", c.mm2, len); P.wire(lastPE, id + ":PE", c.mm2, len);
          lastL = id + ":L"; lastN = id + ":N"; lastPE = id + ":PE";
        }
      });
      cx += c.kind === "lights" ? 140 : 110;
    });
    return { pe: pe, lb: lb, nb: nb, right: cx };
  }

  Design.build = function (d) {
    var P = new Plan(d.site), x0 = 60, y0 = 60, t = d.type;
    if (t === "grid") {
      var g = P.add("grid1", x0, y0, {}), mt = P.add("meter", x0 + 140, y0, { prepaid: true, credit: 50 });
      P.wire(g + ":L", mt + ":Lin", 10, 15); P.wire(g + ":N", mt + ":Nin", 10, 15);
      board(P, d, { L: mt + ":Lout", N: mt + ":Nout" }, x0 + 300, y0);
      return P.doc;
    }
    if (t === "hybrid") x0 = 330;
    var strings = array(P, d, x0, y0), yA = y0 + d.np * 140 + 30, pv = collect(P, d, strings, x0, yA), yC = yA + 130, xDB = x0 + Math.max(d.ns * 100, 560) + 120;
    if (t === "shs") {
      var bk = bank(P, d, x0, yC + 140), cc = P.add(d.ctrl, x0, yC, { amps: d.ctrlA, maxpv: d.ctrl === "pwm" ? 50 : d.maxpv });
      P.wire(pv[0], cc + ":PV+", d.pvOutMm2, 4); P.wire(pv[1], cc + ":PV-", d.pvOutMm2, 4);
      var f0 = P.add("fuse", x0 + 180, yC + 20, { amps: d.ctrlFuse });
      P.wire(cc + ":B+", f0 + ":in", d.ctrlMm2, 1); P.wire(f0 + ":out", bk.pos + ":1", d.bankMm2, 1); P.wire(cc + ":B-", bk.neg + ":1", d.bankMm2, 2);
      var lfa = up(FUSES, Math.max(10, d.peak / 12 * 1.25)), lf = P.add("fuse", xDB - 60, yC + 20, { amps: lfa }, "Load fuse"), lp = P.add("bar", xDB, yC, { role: "P" }, "Loads +"), lm = P.add("bar", xDB, yC + 60, { role: "M" }, "Loads −");
      var lmm = W.sizeFor(lfa / 1.25, 4, 0.3);
      P.wire(bk.pos + ":2", lf + ":in", d.bankMm2, 1.5); P.wire(lf + ":out", lp + ":1", lmm, 1); P.wire(bk.neg + ":2", lm + ":1", lmm, 2.5);
      d.loads.slice(0, 4).forEach(function (l, i) {
        var id = P.add("dcload", xDB - 20 + i * 100, yC + 150, { app: l.app, watts: l.watts, qty: l.qty, volts: 12, on: true, hours: l.hours });
        P.wire(lp + ":" + (5 + i), id + ":+", lmm, 5); P.wire(lm + ":" + (5 + i), id + ":-", lmm, 5);
      });
      return P.doc;
    }
    if (t === "gridtie") {
      var gt = P.add("gridtie", x0, yC, { va: d.inverterVA, maxpv: d.maxpv });
      P.wire(pv[0], gt + ":PV+", d.pvOutMm2, 5); P.wire(pv[1], gt + ":PV-", d.pvOutMm2, 5);
      var g2 = P.add("grid1", xDB, y0, {}), m2 = P.add("meter", xDB + 140, y0, { prepaid: false });
      P.wire(g2 + ":L", m2 + ":Lin", 10, 15); P.wire(g2 + ":N", m2 + ":Nin", 10, 15);
      var bd = board(P, d, { L: m2 + ":Lout", N: m2 + ":Nout" }, xDB + 300, y0);
      var q2 = P.add("mcb", x0 + 190, yC + 10, { amps: up(MCBS, d.inverterVA / 230 * 1.25), curve: "C", on: true }, "Solar");
      P.wire(gt + ":L", q2 + ":out", 4, 2); P.wire(q2 + ":in", bd.lb + ":4", 4, 12); P.wire(gt + ":N", bd.nb + ":4", 4, 14); P.wire(gt + ":PE", bd.pe + ":3", 4, 14);
      return P.doc;
    }
    var bk2 = bank(P, d, x0, yC + 190), src;
    if (t === "hybrid") {
      var hy = P.add("hybrid", x0, yC, { va: Math.max(1000, d.inverterVA), vdc: d.vsys, maxpv: d.maxpv, amps: d.ctrlA, mode: "SBU" });
      P.wire(pv[0], hy + ":PV+", d.pvOutMm2, 5); P.wire(pv[1], hy + ":PV-", d.pvOutMm2, 5);
      var fb = P.add("fuse", x0 + 240, yC + 150, { amps: d.battFuse }, "Battery fuse");
      P.wire(hy + ":B+", fb + ":in", d.battMm2, 0.8); P.wire(fb + ":out", bk2.pos + ":1", d.bankMm2, 0.7); P.wire(hy + ":B-", bk2.neg + ":1", d.bankMm2, 1.5);
      var g3 = P.add("grid1", 30, yC - 130, {}), m3 = P.add("meter", 40, yC, { prepaid: true, credit: 30 }), q3 = P.add("mcb", 200, yC + 10, { amps: up(MCBS, d.inverterVA / 230 * 1.25), curve: "C", on: true }, "Grid in");
      P.wire(g3 + ":L", m3 + ":Lin", 10, 15); P.wire(g3 + ":N", m3 + ":Nin", 10, 15);
      P.wire(m3 + ":Lout", q3 + ":in", 6, 4); P.wire(q3 + ":out", hy + ":GL", 6, 1); P.wire(m3 + ":Nout", hy + ":GN", 6, 5);
      src = { L: hy + ":L", N: hy + ":N", PE: hy + ":PE" };
    } else {
      var c2 = P.add("mppt", x0, yC, { amps: d.ctrlA, maxpv: d.maxpv });
      P.wire(pv[0], c2 + ":PV+", d.pvOutMm2, 5); P.wire(pv[1], c2 + ":PV-", d.pvOutMm2, 5);
      var f1 = P.add("fuse", x0 + 180, yC + 110, { amps: d.ctrlFuse }, "Controller fuse");
      P.wire(c2 + ":B+", f1 + ":in", d.ctrlMm2, 1); P.wire(f1 + ":out", bk2.pos + ":1", d.bankMm2, 1); P.wire(c2 + ":B-", bk2.neg + ":1", d.bankMm2, 2);
      var f2 = P.add("fuse", x0 + 260, yC + 110, { amps: d.battFuse }, "Battery fuse"), inv = P.add("inverter", x0 + 370, yC, { va: d.inverterVA, vdc: d.vsys, on: true });
      P.wire(bk2.pos + ":2", f2 + ":out", d.bankMm2, 0.7); P.wire(f2 + ":in", inv + ":DC+", d.battMm2, 0.8); P.wire(bk2.neg + ":2", inv + ":DC-", d.bankMm2, 1.5);
      src = { L: inv + ":L", N: inv + ":N", PE: inv + ":PE" };
    }
    board(P, d, src, xDB, y0);
    return P.doc;
  };

  /* ---------------------------------------------------- words -> a spec */

  var WORDS = [
    [/\b(vaccine|cold[- ]chain)\b/, "vaccine"], [/\b(deep|chest)?\s*freezers?\b/, "freezer"], [/\b(fridges?|refrigerators?)\b/, "fridge"],
    [/\bceiling fans?\b/, "ceiling_fan"], [/\bfans?\b/, "fan"], [/\b(tv|tvs|televisions?)\b/, "led_tv"], [/\b(decoder|dstv|satellite)\b/, "decoder"],
    [/\blaptops?\b/, "laptop"], [/\b(desktops?|computers?|pcs?)\b/, "desktop"], [/\bprinters?\b/, "printer"], [/\b(routers?|wi-?fi|internet)\b/, "router"],
    [/\b(phones?|charging|chargers?)\b/, "phone"], [/\bkettles?\b/, "kettle"], [/\b(irons?|ironing)\b/, "iron"], [/\bmicrowaves?\b/, "microwave"],
    [/\bblenders?\b/, "blender"], [/\bwash(ing)? machines?\b/, "washer"], [/\b(air ?con(ditioners?)?|a\/?c|acs)\b/, "aircon"],
    [/\bboreholes?\b/, "borehole"], [/\b(water )?pumps?\b/, "pump"], [/\b(water )?heaters?\b/, "heater"], [/\bsewing\b/, "sewing"], [/\bweld(er|ing)\b/, "welder"],
    [/\b(cctv|cameras?)\b/, "cctv"], [/\b(speakers?|pa system|sound system)\b/, "speaker"]
  ];
  var NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, twenty: 20 };
  Design.parse = function (text) {
    var t = " " + String(text || "").toLowerCase().replace(/[,.;]/g, " ") + " ", spec = { loads: [], autonomy: 1 }, got = {};
    var count = function (m) {
      var before = t.slice(Math.max(0, m.index - 14), m.index), q = /(\d+|\ba|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty)\s*(x|×)?\s*(led |small |big |standing |electric )?$/.exec(before);
      return q ? (isFinite(+q[1]) ? +q[1] : NUM[q[1]] || 1) : 1;
    };
    var lm = /\b(lights?|lamps?|bulbs?|lighting)\b/.exec(t);
    if (lm) spec.loads.push({ app: "lamp", qty: Math.max(count(lm), /lighting/.test(lm[0]) ? 6 : 1) });
    WORDS.forEach(function (w) {
      var m = w[0].exec(t);
      if (m && !got[w[1]]) {
        if (w[1] === "fan" && got.ceiling_fan) return;
        if (w[1] === "pump" && got.borehole) return;
        if (w[1] === "fridge" && got.vaccine && !/\bfridges?\b.*\bfridges?\b/.test(t)) return;
        got[w[1]] = 1; spec.loads.push({ app: w[1], qty: Math.min(40, count(m)) });
      }
    });
    var base = /\bclinic|health|hospital\b/.test(t) ? "clinic" : /\bschool|classroom\b/.test(t) ? "school" : /\bshop|store|bitik|kiosk\b/.test(t) ? "shop" : /\boffice\b/.test(t) ? "office" :
               /\btailor\b/.test(t) ? "tailor" : /\bborehole|irrigation|garden\b/.test(t) ? "borehole" : /\b(house|home|compound|family)\b/.test(t) ? "home" : null;
    if (spec.loads.length < 2 && base) { var pre = Design.fromPreset(base); spec.loads = pre.loads; spec.autonomy = pre.autonomy; spec.type = pre.type; }
    if (!spec.loads.length) { pre = Design.fromPreset("home_small"); spec.loads = pre.loads; }
    spec.type = /\b(no solar|grid only|house wiring|electrical (design|installation|wiring)|wire (a|the|my) (house|room|shop))\b/.test(t) && !/solar|panel|battery/.test(t) ? "grid"
      : /\b(grid[- ]?tie|net meter|no batter)/.test(t) ? "gridtie" : /\b(hybrid|backup|back-up|nawec|with (the )?grid|power cuts?|outages?)\b/.test(t) ? "hybrid"
      : /\b(12 ?v|dc only|solar home system|shs)\b/.test(t) ? "shs" : /\boff[- ]?grid|stand[- ]?alone|no grid|village\b/.test(t) ? "offgrid" : spec.type || "offgrid";
    if (spec.type === "shs") spec.loads = spec.loads.map(function (l) { return { app: { lamp: "lamp", phone: "usb", fan: "fan", led_tv: "tv", fridge: "fridge", router: "router" }[l.app] || "custom", qty: l.qty, watts: (W.APPLIANCES[l.app] || {}).watts }; }).filter(function (l) { return l.app !== "custom" || l.watts <= 60; });
    var days = /(\d(?:\.\d)?)\s*days?/.exec(t); if (days) spec.autonomy = W.clamp(+days[1], 0.5, 5);
    if (/\b(lithium|lifepo|lfp)\b/.test(t)) spec.chem = "lfp"; else if (/\btubular\b/.test(t)) spec.chem = "tubular";
    for (var k in Sun.SITES) if (t.indexOf(Sun.SITES[k].name.toLowerCase()) >= 0) spec.site = { name: Sun.SITES[k].name, lat: Sun.SITES[k].lat };
    spec.title = String(text || "").replace(/\s+/g, " ").trim().slice(0, 60);
    return spec;
  };
})(typeof window !== "undefined" ? window : globalThis);
