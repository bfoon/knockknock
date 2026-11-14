/* Chalk Power Lab — the implementation plan.
 *
 * Everything a crew needs on site, written from this plan and no other:
 * what to buy, which cable goes where, the order to build it in, and a
 * commissioning sheet whose "expected" column comes from the simulator —
 * so "string 1 open-circuit voltage: about 88 V" is this string, today.
 *
 * Opens as a page of its own, ready to print or save as a PDF.
 */
(function (root) {
  "use strict";

  var W = root.ChalkPower, esc = W.esc, Sun = W.Sun;
  var Report = W.Report = {};

  function table(head, rows) {
    return '<table><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join("") + '</tr></thead><tbody>' +
      rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + (c == null ? "" : c) + '</td>'; }).join("") + '</tr>'; }).join("") + '</tbody></table>';
  }

  Report.build = function (app, dialogs, est, picture) {
    var doc = app.doc, refs = app.refs, by = {}, n = function (t) { return (by[t] || []).length; }, site = doc.site, noon = dialogs.noon(), ns = noon.sim;
    doc.parts.forEach(function (p) { (by[p.type] = by[p.type] || []).push(p); });
    var nm = function (p) { return esc((refs[p.id] || "") + (p.name ? " " + p.name : " " + W.def(p).name)); };
    var end = function (key) { var id = key.split(":")[0], p = W.partById(doc, id); return p ? esc((refs[id] || "?") + " " + (p.name || W.def(p).name) + " · " + key.slice(id.length + 1)) : "?"; };
    var wp = 0; (by.pv || []).forEach(function (p) { wp += (W.PV[W.propsOf(p).model] || W.PV.p330).wp; });
    var kwh = 0; (by.battery || []).forEach(function (p) { var pr = W.propsOf(p); kwh += pr.volts * pr.ah / 1000; });
    var solar = n("pv") > 0, batt = n("battery") > 0, bom = W.Check.bom(doc), finds = W.Check.run(doc, app.sim, false).filter(function (f) { return f.level !== "info"; });
    var kinds = app.view.kinds(), KN = { L: "Live", N: "Neutral", PE: "Earth", P: "DC +", M: "DC −", X: "—" };

    var h = '<h1>' + esc(app.title) + '</h1><p class="sub">Implementation plan · ' + esc(site.name) + ' (' + (+site.lat).toFixed(2) + '°) · ' + new Date().toISOString().slice(0, 10) + '</p>';
    h += '<div class="facts">' + [solar ? ["Array", (wp / 1000).toFixed(2) + " kWp · " + n("pv") + " panels"] : null, batt ? ["Battery", kwh.toFixed(1) + " kWh"] : null,
      (by.hybrid || by.inverter || by.gridtie) ? ["Inverter", W.propsOf((by.hybrid || by.inverter || by.gridtie)[0]).va / 1000 + " kVA"] : null,
      est ? ["Loads, per day", (est.tot.load / 1000).toFixed(2) + " kWh"] : null, est && solar ? ["Solar, per day", (est.tot.solar / 1000).toFixed(2) + " kWh"] : null, ["Budget", W.money(bom.total * 1.2)]]
      .filter(Boolean).map(function (f) { return '<div><small>' + f[0] + '</small><b>' + esc(f[1]) + '</b></div>'; }).join("") + '</div>';
    if (finds.length) h += '<div class="stop"><b>Put these right before building:</b><ul>' + finds.map(function (f) { return '<li>' + esc(f.msg) + '</li>'; }).join("") + '</ul></div>';
    if (picture) h += '<h2>1. The plan</h2><img src="' + picture + '" alt="The plan">';

    h += '<h2>2. Materials</h2>' + table(["Item", "Qty", "Each (D)", "Total (D)"], bom.rows.map(function (r) { return [esc(r.item), r.qty, Math.round(r.unit).toLocaleString(), Math.round(r.total).toLocaleString()]; })) +
      '<p>Equipment ' + W.money(bom.total) + '; with fixings, conduit, labour and transport allow <b>' + W.money(bom.total * 1.2) + '</b>. Prices are estimates: confirm them with your supplier.</p>';

    h += '<h2>3. Cable schedule</h2><p>Currents are with every load switched on at noon. Lengths are one conductor.</p>' + table(["#", "From", "To", "Type", "mm²", "m", "Amps", "Volts lost"],
      doc.wires.map(function (w, i) { var ws = ns.wstate[w.id] || {}; return [i + 1, end(w.a), end(w.b), KN[kinds[w.id] || "X"], w.mm2, w.len, (ws.mag || 0).toFixed(1), (ws.drop || 0).toFixed(2)]; }));

    var prot = (by.mcb || []).concat(by.fuse || [], by.rcd || [], by.isolator || []);
    if (prot.length) h += '<h2>4. Protection schedule</h2>' + table(["Device", "Rating", "Carries at full load"], prot.map(function (p) {
      var pr = W.propsOf(p), st = ns.state[p.id] || {};
      return [nm(p), p.type === "mcb" ? pr.curve + pr.amps + " A" : p.type === "rcd" ? pr.amps + " A / " + pr.ma + " mA" : pr.amps + " A", (st.imax || 0).toFixed(1) + " A"];
    }));

    /* the order of work */
    var steps = ["Walk the site with this plan. Mark where the " + (solar ? "array, " : "") + (batt ? "battery, " : "") + "inverter and consumer unit go. Keep the battery cables under two metres and everything electrical out of the sun and the rain."];
    if (n("earth")) steps.push("Drive the earth rod its full length into damp ground and run 6 mm² green-and-yellow to the earth bar. Measure it: aim for under 10 Ω. Sandy, dry soil may need a second rod two metres away.");
    if (solar) {
      steps.push("Fix the mounting frame facing <b>" + (site.az === 180 ? "true south" : site.az === 0 ? "true north" : site.az + "°") + "</b>, tilted <b>" + site.tilt + "°</b> from flat" + (Math.abs(site.tilt - Sun.bestTilt(site.lat)) <= 5 ? " (about the latitude: best all year)" : "") + ". Nothing may shade it between 9 and 4: check for trees, tanks and the neighbour's roof.");
      steps.push("Bolt the panels down and bond every frame to earth. Leave them <b>disconnected and face-covered</b> while you wire: a panel in daylight is live and cannot be switched off.");
      steps.push("Fit the " + (n("combiner") ? "combiner box and " : "") + "PV isolator within reach, and leave the isolator OFF.");
    }
    steps.push("Mount the " + [n("hybrid") ? "hybrid inverter" : null, n("mppt") || n("pwm") ? "charge controller" : null, n("inverter") ? "inverter" : null, "consumer unit"].filter(Boolean).join(", ") + " on a wall that does not burn, with a hand's width of air all round.");
    steps.push("Wire the AC side dead: main switch, RCD, busbars, then each circuit from its breaker, to the cable schedule. Brown live, blue neutral, green-and-yellow earth. Every switch breaks the live.");
    if (batt) {
      steps.push("Set the batteries on a level, ventilated stand. Link them as drawn" + ((by.battery || []).length > 1 ? ", checking each link twice: plus to minus for series" : "") + ". Fit the battery fuse holder on the positive, <b>fuse out</b>.");
      steps.push("Connect the " + (n("hybrid") ? "hybrid inverter" : "charge controller, then the inverter,") + " to the battery, negative first, positive last. Check the polarity with a meter, then fit the fuse. The controller must see the battery <b>before</b> it sees the panels.");
    }
    if (solar) steps.push("Connect the panel strings as drawn, uncover them, and measure each string at the isolator (see the sheet below) <b>before</b> closing it. Only then switch the PV isolator on.");
    steps.push("Run the commissioning tests below in order and write the readings down. Switch loads on one circuit at a time.");
    steps.push("Label every breaker, the isolators and the battery. Show the owner how to switch it all off, and leave this plan with them.");
    h += '<h2>5. The order of work</h2><ol class="steps">' + steps.map(function (s) { return '<li>' + s + '</li>'; }).join("") + '</ol>';

    /* commissioning, with what to expect */
    var tests = [["Earth rod resistance", n("earth") ? "under 10 Ω (design value " + W.propsOf(by.earth[0]).ohms + " Ω)" : "—"], ["Insulation, live+neutral to earth, 500 V, loads unplugged", "at least 1 MΩ"], ["Continuity of every earth wire back to the earth bar", "under 1 Ω"]];
    if (solar) {
      var chargers = (by.mppt || []).concat(by.pwm || [], by.hybrid || [], by.gridtie || []);
      chargers.forEach(function (p) {
        var cv = ns.trace(p.id + ":PV+", p.id + ":PV-", 40);
        if (cv.length > 2) { tests.push(["Array at " + nm(p) + ": open-circuit voltage, isolator off", "about " + cv[cv.length - 1].v.toFixed(0) + " V at noon (must stay under " + W.propsOf(p).maxpv + " V)"]); tests.push(["Array at " + nm(p) + ": short-circuit current (clamp meter)", "about " + cv[0].i.toFixed(1) + " A in full sun"]); }
      });
      tests.push(["Polarity of each string at the isolator", "plus on plus — a reversed string reads negative"]);
    }
    if (batt) { var bv = 0, seen = 0; by.battery.forEach(function (p) { var st = ns.state[p.id] || {}; if (st.v) { bv += st.v; seen++; } }); var pr0 = W.propsOf(by.battery[0]); tests.push(["Each " + pr0.volts + " V battery at rest", seen ? "about " + (bv / seen).toFixed(1) + " V; all within 0.2 V of each other" : "—"]); }
    if (n("inverter") || n("hybrid")) tests.push(["Inverter output, no load", "230 V ± 5%, 50 Hz"]);
    if (n("rcd")) tests.push(["RCD: press its test button", "trips at once; resets"]);
    if (n("socket")) tests.push(["Every socket with a socket tester", "correct: supply, earth, polarity"]);
    var worst = null; doc.parts.forEach(function (p) { var st = ns.state[p.id] || {}; if (/^(lamp|socket|load)$/.test(p.type) && st.v > 60 && (!worst || st.v < worst.v)) worst = { v: st.v, p: p }; });
    if (worst) tests.push(["Voltage at the farthest load, everything on (" + nm(worst.p) + ")", "about " + worst.v.toFixed(0) + " V — no less than 218 V"]);
    if (solar && batt) tests.push(["Charging in sun: the controller shows bulk, then absorb, then float", "battery rises to about " + (W.propsOf(by.battery[0]).chem === "lfp" ? "14.2" : "14.4") + " V for every 12 V of bank, then settles near 13.6 V"]);
    h += '<h2>6. Commissioning sheet</h2>' + table(["Test", "Expect", "Measured", "Pass"], tests.map(function (t) { return [t[0], t[1], '<span class="blank"></span>', '☐']; })) +
      '<p class="sign">Tested by ______________________ &nbsp; Date ____________ &nbsp; Signature ______________________</p>';

    h += '<h2>7. Looking after it</h2><ul>' + [solar ? "<b>Monthly, weekly in harmattan:</b> wash the panels with plain water early in the morning. Dust can cost a third of the output." : null,
      batt && (by.battery || []).some(function (p) { return W.propsOf(p).chem === "tubular"; }) ? "<b>Monthly:</b> top up flooded batteries with distilled water to the mark. Never acid." : null,
      batt ? "<b>Monthly:</b> look at the battery terminals. Clean off any white crust and tighten gently." : null, n("rcd") ? "<b>Every three months:</b> press the RCD test button." : null,
      "<b>Yearly:</b> tighten every terminal (with the power off), measure the earth rod at the end of the dry season, and check for cables rubbing on metal edges.",
      batt ? "<b>Daily habit:</b> heavy things — ironing, pumping, washing — in the middle of the day, when the sun pays for them." : null].filter(Boolean).map(function (s) { return '<li>' + s + '</li>'; }).join("") + '</ul>';
    h += '<p class="safe"><b>Safety.</b> This plan was drawn and tested in a simulator for teaching and first design. Mains voltage, and a battery bank at any voltage, can kill and can start fires. The installation must be built, tested and signed off by a qualified electrician to the wiring rules in force where it stands. Isolate, lock off and prove dead before touching any conductor.</p>';
    return h;
  };

  var CSS = "body{font:13px/1.5 system-ui,Segoe UI,Roboto,sans-serif;color:#1b242c;max-width:900px;margin:24px auto;padding:0 20px}h1{font-size:26px;margin:0}h2{font-size:16px;margin:26px 0 8px;border-bottom:2px solid #d4893a;padding-bottom:3px;break-after:avoid}" +
    ".sub{color:#5d6b76;margin:2px 0 14px}.facts{display:flex;flex-wrap:wrap;gap:8px}.facts div{border:1px solid #cfd6db;border-radius:8px;padding:6px 12px}.facts small{display:block;color:#5d6b76;font-size:11px}.facts b{font-size:15px}" +
    "table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #cfd6db;padding:4px 7px;text-align:left;vertical-align:top}th{background:#eef1f3}tr{break-inside:avoid}img{max-width:100%;border:1px solid #cfd6db;border-radius:8px}" +
    ".steps li{margin:6px 0}.stop{border:2px solid #c0392b;border-radius:8px;padding:8px 14px;margin:14px 0;background:#fdf1ef}.blank{display:inline-block;min-width:90px}.sign{margin-top:22px}.safe{margin-top:26px;padding:10px 14px;background:#fff7e0;border:1px solid #e0c060;border-radius:8px}" +
    ".bar{position:sticky;top:0;background:#fff;padding:8px 0;text-align:right}.bar button{font:inherit;padding:6px 14px;border-radius:8px;border:1px solid #8d99a3;background:#d4893a;color:#fff;cursor:pointer}@media print{.bar{display:none}body{margin:0}}";

  Report.open = function (app, dialogs, est) {
    var win = root.open("", "_blank");
    if (!win) { app.toast("The browser blocked the new window. Allow pop-ups for this page and try again.", "warn"); return; }
    win.document.write("<!doctype html><title>Preparing…</title><p style='font:14px system-ui;padding:30px'>Writing the plan…</p>");
    app.view.png(function (blob, cv) {
      var pic = null; try { pic = cv.toDataURL("image/png"); } catch (e) { /* drawn without it */ }
      var html = "<!doctype html><html lang='en'><head><meta charset='utf-8'><title>" + esc(app.title) + " — implementation plan</title><style>" + CSS + "</style></head><body><div class='bar'><button onclick='window.print()'>Print or save as PDF</button></div>" + Report.build(app, dialogs, est, pic) + "</body></html>";
      win.document.open(); win.document.write(html); win.document.close();
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
