/* Chalk Power Lab — designing, costing and handing over.
 *
 *   Dialogs.wizard()     say what must be powered -> a sized, wired system,
 *                        with the working shown line by line
 *   Dialogs.site()       where it is, which month, how the panels are set
 *   Dialogs.costs()      bill of materials, what a day of it is worth,
 *                        and the implementation plan to print
 *   Dialogs.fault()      hide a fault for a class to find with the testers
 *   Dialogs.lightning()  a strike: does the surge protection hold?
 *   AI                   the Ask panel, with a built-in helper behind it
 */
(function (root) {
  "use strict";

  var W = root.ChalkPower, esc = W.esc, Sun = W.Sun, Design = W.Design;
  function $(id) { return document.getElementById(id); }

  function dialog(cls, title, body, foot) {
    var d = document.createElement("dialog");
    d.className = "pw-dlg " + (cls || "");
    d.innerHTML = '<form method="dialog" class="pw-dlg-top"><h2>' + esc(title) + '</h2><button value="close" aria-label="Close">×</button></form><div class="pw-dlg-body">' + body + '</div>' + (foot ? '<div class="pw-dlg-foot">' + foot + '</div>' : '');
    document.body.appendChild(d);
    d.addEventListener("close", function () { d.remove(); });
    d.showModal();
    return d;
  }
  W.dialog = dialog;

  function Dialogs(app) { this.app = app; }
  W.Dialogs = Dialogs;

  /* ============================================================ the wizard */

  var TYPES = [["offgrid", "Off-grid solar", "Panels, battery and inverter. No grid at all."], ["hybrid", "Solar with grid back-up", "An all-in-one inverter: solar first, the grid when the battery is low."],
    ["gridtie", "Grid-tie solar", "Panels feed the house wiring. No battery; stops in a power cut."], ["shs", "Small 12 V solar kit", "Lights and phone charging straight from a battery. No inverter."], ["grid", "Wiring only", "No solar: the consumer unit and circuits of a building."]];

  Dialogs.prototype.wizard = function (given) {
    var app = this.app, self = this, spec = given || Design.fromPreset("home_small");
    spec.site = spec.site || { name: app.doc.site.name, lat: app.doc.site.lat };
    spec.type = spec.type || "offgrid"; spec.autonomy = spec.autonomy || 1;
    var d = dialog("wide", "Design a system",
      '<div class="wz-say"><label for="wz-text">Describe what it has to power</label><div class="wz-row"><textarea id="wz-text" rows="2" placeholder="e.g. a health post in Basse with a vaccine fridge, 8 lights, 2 fans and a laptop — 2 days without sun">' + esc(given && given.title ? given.title : "") + '</textarea><button type="button" id="wz-read">' + (app.cfg.aiEnabled ? "Ask the AI" : "Read it") + '</button></div>' +
      '<div class="wz-chips">' + Object.keys(Design.PRESETS).map(function (k) { return '<button type="button" data-pre="' + k + '">' + esc(Design.PRESETS[k].name) + '</button>'; }).join("") + '</div></div>' +
      '<div class="wz-cols"><section><h3>What it powers</h3><table class="wz-loads"><thead><tr><th>Appliance</th><th>How many</th><th>Hours a day</th><th></th></tr></thead><tbody id="wz-rows"></tbody></table>' +
      '<button type="button" id="wz-add">+ Add another</button><p class="wz-total" id="wz-total"></p></section>' +
      '<section><h3>What kind of system</h3><div class="wz-types" id="wz-types"></div>' +
      '<div class="wz-opts"><label>Place<select id="wz-site">' + Object.keys(Sun.SITES).map(function (k) { return '<option value="' + k + '">' + esc(Sun.SITES[k].name) + '</option>'; }).join("") + '</select></label>' +
      '<label>Days it must last without sun<select id="wz-days"><option value="0.5">Half a day</option><option value="1">1 day</option><option value="2">2 days</option><option value="3">3 days</option></select></label>' +
      '<label>Battery<select id="wz-chem"><option value="agm">Lead-acid (cheaper, use half)</option><option value="tubular">Tubular lead-acid</option><option value="lfp">Lithium (dearer, use 80%)</option></select></label>' +
      '<label>Panels<select id="wz-panel"><option value="">Choose for me</option>' + Object.keys(W.PV).map(function (k) { return '<option value="' + k + '">' + esc(W.PV[k].name) + '</option>'; }).join("") + '</select></label></div></section></div>' +
      '<section class="wz-work"><h3>The working</h3><div id="wz-work"></div></section>',
      '<span class="fine">This replaces what is on the drawing. Undo brings it back.</span><button type="button" class="primary" id="wz-build">Build it on the drawing</button>');
    var rows = $("wz-rows");
    var options = function () {
      var dc = spec.type === "shs", src = dc ? W.DC_LOADS : W.APPLIANCES;
      return (dc ? "" : '<option value="lamp">LED lamp · 9 W</option>') + Object.keys(src).filter(function (k) { return k !== "none"; }).map(function (k) { return '<option value="' + k + '">' + esc(src[k].name) + ' · ' + src[k].watts + ' W</option>'; }).join("");
    };
    var draw = function () {
      rows.innerHTML = spec.loads.map(function (l, i) {
        return '<tr data-i="' + i + '"><td><select data-f="app">' + options() + '</select>' + (l.app === "custom" ? '<input type="number" data-f="watts" min="1" max="20000" value="' + (+l.watts || 100) + '" title="Watts" aria-label="Watts">' : '') + '</td>' +
          '<td><input type="number" data-f="qty" min="1" max="40" value="' + (l.qty || 1) + '"></td><td><input type="number" data-f="hours" min="0" max="24" step="0.5" placeholder="usual" value="' + (l.hours >= 0 ? l.hours : "") + '"></td><td><button type="button" data-f="del" aria-label="Remove">×</button></td></tr>';
      }).join("");
      rows.querySelectorAll("tr").forEach(function (tr) {
        var l = spec.loads[+tr.getAttribute("data-i")], sel = tr.querySelector('[data-f="app"]');
        sel.value = sel.querySelector('option[value="' + l.app + '"]') ? l.app : "custom";
        tr.querySelectorAll("[data-f]").forEach(function (el) {
          var f = el.getAttribute("data-f");
          if (f === "del") { el.addEventListener("click", function () { spec.loads.splice(+tr.getAttribute("data-i"), 1); draw(); }); return; }
          el.addEventListener("change", function () { if (f === "app") { l.app = el.value; l.hours = -1; draw(); return; } l[f] = el.value === "" ? -1 : +el.value; work(); });
        });
      });
      $("wz-types").innerHTML = TYPES.map(function (t) { return '<button type="button" data-type="' + t[0] + '" aria-pressed="' + (spec.type === t[0]) + '"><b>' + esc(t[1]) + '</b><span>' + esc(t[2]) + '</span></button>'; }).join("");
      $("wz-types").querySelectorAll("[data-type]").forEach(function (b) { b.addEventListener("click", function () {
        var was = spec.type === "shs"; spec.type = b.getAttribute("data-type");
        if ((spec.type === "shs") !== was) spec.loads = spec.type === "shs" ? [{ app: "lamp", qty: 4 }, { app: "usb", qty: 1 }, { app: "radio", qty: 1 }] : Design.fromPreset("home_small").loads;
        draw();
      }); });
      var sk = Object.keys(Sun.SITES).filter(function (k) { return Sun.SITES[k].name === spec.site.name; })[0] || "banjul";
      $("wz-site").value = sk; $("wz-days").value = String(spec.autonomy); $("wz-chem").value = spec.chem || "agm"; $("wz-panel").value = spec.panel || "";
      work();
    };
    var design = null;
    var work = function () {
      design = Design.size(spec);
      $("wz-total").textContent = Math.round(design.eDay) + " Wh a day · " + Math.round(design.peak) + " W all at once";
      var facts = [];
      if (design.wp) facts.push(["Panels", design.nPanels + " × " + W.PV[design.panel].wp + " W = " + (design.wp / 1000).toFixed(2) + " kWp"]);
      if (design.bankWh) facts.push(["Battery", (design.bs * design.bp) + " × " + design.battV + " V " + design.battAh + " Ah = " + (design.bankWh / 1000).toFixed(1) + " kWh"]);
      if (design.inverterVA) facts.push(["Inverter", (design.inverterVA / 1000) + " kVA at " + (design.vsys || 230) + " V"]);
      if (design.ctrlA) facts.push(["Charging", design.ctrlA + " A " + (design.ctrl || "MPPT").toUpperCase()]);
      $("wz-work").innerHTML = (facts.length ? '<div class="wz-facts">' + facts.map(function (f) { return '<div><small>' + esc(f[0]) + '</small><b>' + esc(f[1]) + '</b></div>'; }).join("") + '</div>' : '') +
        design.warn.map(function (w) { return '<p class="pw-warnp">' + esc(w) + '</p>'; }).join("") +
        '<ol class="wz-notes">' + design.notes.map(function (n) { return '<li><b>' + esc(n[0]) + '.</b> ' + esc(n[1]) + '</li>'; }).join("") + '</ol>';
    };
    d.querySelectorAll("[data-pre]").forEach(function (b) { b.addEventListener("click", function () { var s = Design.fromPreset(b.getAttribute("data-pre")); s.site = spec.site; s.chem = spec.chem; spec = s; draw(); }); });
    $("wz-add").addEventListener("click", function () { spec.loads.push({ app: spec.type === "shs" ? "lamp" : "fan", qty: 1, hours: -1 }); draw(); });
    $("wz-site").addEventListener("change", function () { var s = Sun.SITES[$("wz-site").value]; spec.site = { name: s.name, lat: s.lat }; work(); });
    $("wz-days").addEventListener("change", function () { spec.autonomy = +$("wz-days").value; work(); });
    $("wz-chem").addEventListener("change", function () { spec.chem = $("wz-chem").value; work(); });
    $("wz-panel").addEventListener("change", function () { spec.panel = $("wz-panel").value || null; work(); });
    $("wz-read").addEventListener("click", function () {
      var text = $("wz-text").value.trim(), btn = $("wz-read");
      if (!text) { $("wz-text").focus(); return; }
      var use = function (s, note) { var known = s.site && Object.keys(Sun.SITES).filter(function (k) { return Sun.SITES[k].name === s.site.name; })[0]; s.site = known ? { name: Sun.SITES[known].name, lat: Sun.SITES[known].lat } : spec.site; if (!s.loads || !s.loads.length) s.loads = spec.loads; spec = s; spec.title = text.slice(0, 60); draw(); if (note) app.toast(note); };
      if (!app.cfg.aiEnabled) { use(Design.parse(text)); return; }
      btn.disabled = true; btn.textContent = "Thinking…";
      W.AI.post(app, { kind: "design", question: text, plan: { site: app.doc.site } }).then(function (j) { use(j.spec && j.spec.loads && j.spec.loads.length ? j.spec : Design.parse(text), j.spec ? "" : "The AI didn't give a usable list, so the words were read directly."); },
        function (e) { use(Design.parse(text), (e && e.friendly) || "The AI didn't answer, so the words were read directly."); }).then(function () { btn.disabled = false; btn.textContent = "Ask the AI"; });
    });
    $("wz-build").addEventListener("click", function () {
      if (!design || !design.loads.length) { app.toast("Add at least one thing to power."); return; }
      var doc = Design.build(design), keep = app.doc;
      doc.site = design.site; doc.site.month = keep.site.month; doc.site.cloud = -1; doc.site.dust = keep.site.dust || 0; doc.site.tamb = -1; doc.prices = keep.prices; doc.tariff = keep.tariff; doc.clock = 12;
      var title = (spec.title || (TYPES.filter(function (t) { return t[0] === spec.type; })[0] || [0, "Plan"])[1]).replace(/^./, function (c) { return c.toUpperCase(); });
      if (app.on) app.power(false);
      app.replaceDoc(doc, app.doc.parts.length ? null : title, true);
      d.close();
      app.toast("Built: " + doc.parts.length + " parts and " + doc.wires.length + " cables. Switch the power on, or press Run a day.");
    });
    draw();
  };

  /* ================================================================ site */

  Dialogs.prototype.site = function () {
    var app = this.app, s = app.doc.site;
    var d = dialog("", "Place and sun",
      '<div class="wz-opts two"><label>Place<select id="st-site"><option value="">Somewhere else</option>' + Object.keys(Sun.SITES).map(function (k) { return '<option value="' + k + '">' + esc(Sun.SITES[k].name) + '</option>'; }).join("") + '</select></label>' +
      '<label>Latitude <small>(° north; south is negative)</small><input type="number" id="st-lat" min="-60" max="65" step="0.01"></label>' +
      '<label>Month<select id="st-month">' + Sun.MONTHS.map(function (m, i) { return '<option value="' + (i + 1) + '">' + m + '</option>'; }).join("") + '</select></label>' +
      '<label>Sky<select id="st-cloud"><option value="-1">Typical for the month</option><option value="0">Clear</option><option value="0.3">Some cloud</option><option value="0.6">Cloudy</option><option value="0.9">Heavy overcast</option></select></label>' +
      '<label>Panel tilt <small>(° from flat)</small><input type="number" id="st-tilt" min="0" max="90" step="1"></label>' +
      '<label>Panels face<select id="st-az"><option value="180">South</option><option value="0">North</option><option value="90">East</option><option value="270">West</option><option value="135">South-east</option><option value="225">South-west</option></select></label>' +
      '<label>Dust on the panels <small>(%, harmattan)</small><input type="number" id="st-dust" min="0" max="60" step="5"></label>' +
      '<label>Electricity price <small>(dalasi per kWh)</small><input type="number" id="st-tariff" min="0" max="200" step="0.5"></label></div>' +
      '<canvas id="st-chart" width="640" height="170"></canvas><p id="st-note" class="hint"></p>', '<button type="button" class="primary" id="st-ok">Done</button>');
    var fill = function () {
      var k = Object.keys(Sun.SITES).filter(function (q) { return Sun.SITES[q].name === s.name; })[0] || "";
      $("st-site").value = k; $("st-lat").value = s.lat; $("st-month").value = s.month; $("st-cloud").value = String(s.cloud >= 0 ? [0, 0.3, 0.6, 0.9].reduce(function (a, b) { return Math.abs(b - s.cloud) < Math.abs(a - s.cloud) ? b : a; }) : -1);
      $("st-tilt").value = s.tilt; $("st-az").value = String(s.az); $("st-dust").value = s.dust || 0; $("st-tariff").value = app.doc.tariff;
      var cv = $("st-chart"), c = cv.getContext("2d"), vals = [], max = 0, m;
      for (m = 1; m <= 12; m++) { var keep = s.cloud; if (s.cloud >= 0) s.cloud = -1; var v = Sun.psh(s, m); s.cloud = keep; vals.push(v); max = Math.max(max, v); }
      c.fillStyle = "#0f1820"; c.fillRect(0, 0, cv.width, cv.height);
      vals.forEach(function (v2, i) {
        var x = 16 + i * 52, h = 120 * v2 / (max || 1);
        c.fillStyle = i + 1 === +s.month ? "#ffd36b" : "#4f7f9a"; c.fillRect(x, 140 - h, 38, h);
        c.fillStyle = "rgba(232,238,244,.75)"; c.font = "11px system-ui"; c.textAlign = "center"; c.fillText(v2.toFixed(1), x + 19, 134 - h); c.fillText(Sun.MONTHS[i].slice(0, 3), x + 19, 158);
      });
      var worst = Sun.worstMonth(s), best = Sun.bestTilt(s.lat);
      $("st-note").textContent = "Peak sun hours on the panels, month by month (typical skies). The poorest is " + Sun.MONTHS[worst.month - 1] + ": size a system for that. Best all-year tilt here is about " + best + "°, facing " + (Sun.bestAz(s.lat) === 180 ? "south" : "north") + ".";
    };
    var set = function (fn) { app.edit(function () { fn(); }); app.setEnv(); fill(); };
    $("st-site").addEventListener("change", function () { var q = Sun.SITES[$("st-site").value]; set(function () { if (q) { s.name = q.name; s.lat = q.lat; } else s.name = "Custom"; }); });
    $("st-lat").addEventListener("change", function () { set(function () { s.lat = W.clamp(+$("st-lat").value || 0, -60, 65); if (!Object.keys(Sun.SITES).some(function (k) { return Sun.SITES[k].name === s.name && Math.abs(Sun.SITES[k].lat - s.lat) < 0.01; })) s.name = "Custom"; }); });
    [["st-month", "month"], ["st-cloud", "cloud"], ["st-tilt", "tilt"], ["st-az", "az"], ["st-dust", "dust"]].forEach(function (q) { $(q[0]).addEventListener("change", function () { set(function () { s[q[1]] = +$(q[0]).value; }); }); });
    $("st-tariff").addEventListener("change", function () { set(function () { app.doc.tariff = W.clamp(+$("st-tariff").value || 0, 0, 200); }); });
    $("st-ok").addEventListener("click", function () { d.close(); });
    fill();
  };

  /* ================================================== costs and hand-over */

  /* Run a whole day somewhere out of sight and say how it went. */
  Dialogs.prototype.estimateDay = function () {
    var doc = JSON.parse(JSON.stringify(this.app.doc)), sim = new W.Sim(doc), low = 1, has = false;
    sim.fast = true; sim.routine = true;
    for (var h = 0; h < 24; h += 0.1) { var hr = (h + 6) % 24, e = Sun.at(doc.site, hr); sim.env = { G: e.G, tamb: e.tamb }; sim.hour = hr; sim.stride(360); }
    doc.parts.forEach(function (p) { var st = sim.state[p.id]; if (p.type === "battery" && st && st.low != null) { low = Math.min(low, st.low); has = true; } });
    return { tot: sim.tot, low: has ? low : null, sim: sim, doc: doc };
  };
  /* Everything on, at noon: the currents a cable schedule should quote. */
  Dialogs.prototype.noon = function () {
    var doc = JSON.parse(JSON.stringify(this.app.doc)), sim = new W.Sim(doc), e = Sun.at(doc.site, 12);
    doc.parts.forEach(function (p) { if (/^(mcb|isolator|rcd|switch1|socket|load|dcload|inverter|hybrid|grid1|grid3)$/.test(p.type) && p.props) { p.props.on = true; p.props.fault = "none"; } });
    sim.env = { G: e.G, tamb: e.tamb }; sim.fast = true; sim.settle(70);
    return { sim: sim, doc: doc, env: e };
  };

  Dialogs.prototype.costs = function () {
    var app = this.app, self = this, doc = app.doc;
    if (!doc.parts.length) { app.toast("There is nothing to cost yet."); return; }
    var d = dialog("wide", "Costs and hand-over", '<div id="cs-body"></div>',
      '<button type="button" id="cs-csv">Download the list (CSV)</button><button type="button" id="cs-day">Work out what a day is worth</button><button type="button" class="primary" id="cs-plan">Implementation plan to print</button>');
    var est = null;
    var draw = function () {
      var bom = W.Check.bom(doc), html = '<p class="hint">Prices are rough starting points in dalasi. Type your supplier\'s price into any row and it is remembered for this plan.</p><table class="pw-bom"><thead><tr><th>Item</th><th>Qty</th><th>Each (D)</th><th>Total</th></tr></thead><tbody>' +
        bom.rows.map(function (r) { return '<tr><td>' + esc(r.item) + '</td><td>' + r.qty + '</td><td><input type="number" min="0" step="10" data-key="' + esc(r.key) + '" value="' + Math.round(r.unit) + '" aria-label="Price each"></td><td>' + W.money(r.total) + '</td></tr>'; }).join("") +
        '</tbody><tfoot><tr><th colspan="3">Equipment</th><th>' + W.money(bom.total) + '</th></tr><tr><td colspan="3">Fixings, conduit, labour and transport (allow 20%)</td><td>' + W.money(bom.total * 0.2) + '</td></tr><tr><th colspan="3">Budget</th><th>' + W.money(bom.total * 1.2) + '</th></tr></tfoot></table>';
      if (est) {
        var t = est.tot, used = Math.min(t.solar, t.load) / 1000, worth = used * doc.tariff, years = worth > 0 ? bom.total * 1.2 / (worth * 365) : null;
        html += '<div class="wz-facts"><div><small>Solar made in a day</small><b>' + (t.solar / 1000).toFixed(2) + ' kWh</b></div><div><small>Loads used</small><b>' + (t.load / 1000).toFixed(2) + ' kWh</b></div>' +
          (t.grid > 1 ? '<div><small>Still bought from the grid</small><b>' + (t.grid / 1000).toFixed(2) + ' kWh</b></div>' : '') + (est.low != null ? '<div><small>Battery at its lowest</small><b>' + Math.round(est.low * 100) + '%</b></div>' : '') +
          '<div><small>Solar worth a day</small><b>' + W.money(worth) + '</b></div>' + (years ? '<div><small>Pays for itself in</small><b>' + (years > 40 ? "never, at this price" : years.toFixed(1) + " years") + '</b></div>' : '') + '</div>' +
          '<p class="hint">A day in ' + Sun.MONTHS[doc.site.month - 1] + ' at ' + esc(doc.site.name) + ', with everything used at its usual hours, at D ' + doc.tariff + ' a kWh. A generator making the same ' + used.toFixed(1) + ' kWh would burn about ' + (used * 0.45).toFixed(1) + ' litres.' +
          (t.unmet > 0.3 ? ' <b class="pw-bad">Some loads went without power for part of the day.</b>' : '') + '</p>';
      }
      $("cs-body").innerHTML = html;
      $("cs-body").querySelectorAll("[data-key]").forEach(function (el) { el.addEventListener("change", function () { app.edit(function () { doc.prices[el.getAttribute("data-key")] = Math.max(0, +el.value || 0); }); draw(); }); });
    };
    $("cs-csv").addEventListener("click", function () {
      var bom = W.Check.bom(doc), csv = "Item,Quantity,Each (GMD),Total (GMD)\r\n" + bom.rows.map(function (r) { return '"' + r.item.replace(/"/g, '""') + '",' + r.qty + "," + Math.round(r.unit) + "," + Math.round(r.total); }).join("\r\n") + '\r\n"Equipment total",,,' + Math.round(bom.total) + "\r\n";
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })); a.download = (app.title || "plan").replace(/[^\w -]+/g, "_") + " — materials.csv"; document.body.appendChild(a); a.click(); a.remove();
    });
    $("cs-day").addEventListener("click", function () { var b = $("cs-day"); b.disabled = true; b.textContent = "Running a day…"; setTimeout(function () { est = self.estimateDay(); b.disabled = false; b.textContent = "Run the day again"; draw(); }, 40); });
    $("cs-plan").addEventListener("click", function () { var b = $("cs-plan"); b.disabled = true; b.textContent = "Writing it…"; setTimeout(function () { est = est || self.estimateDay(); draw(); W.Report.open(app, self, est); b.disabled = false; b.textContent = "Implementation plan to print"; }, 40); });
    draw();
  };

  /* ====================================================== teaching tricks */

  var FAULTS = [
    { t: /^pv$/, k: "fault", v: "open", say: "a panel with a broken connection inside: its whole string made nothing" },
    { t: /^pv$/, k: "fault", v: "hot", say: "a panel with a cracked, hot cell dragging its string down" },
    { t: /^pv$/, k: "shade", v: 85, say: "a panel in deep shade" },
    { t: /^pv$/, k: "dirt", v: 55, say: "a panel thick with dust" },
    { t: /^(mcb|fuse|isolator)$/, k: "fault", v: "loose", say: "a loose, burnt terminal: it was running hot and dropping volts" },
    { t: /^(socket|load)$/, k: "fault", v: "leak", say: "an appliance with its live wire touching the metal case" },
    { t: /^(lamp|socket|load)$/, k: "fault", v: "open", say: "an appliance that had burnt out" },
    { t: /^earth$/, k: "ohms", v: 800, say: "an earth rod that had worked loose: 800 Ω to ground" }
  ];
  Dialogs.prototype.fault = function () {
    var app = this.app, doc = app.doc;
    if (doc.secret) {
      var p = W.partById(doc, doc.secret.id), s = doc.secret;
      app.edit(function () { if (p) p.props[s.k] = s.was; delete doc.secret; });
      if (p) { app.view.focus([p.id]); app.toast("It was " + W.label(doc, p, app.refs) + ": " + s.say + ". It has been put right."); }
      app.check(); return;
    }
    var pool = [];
    doc.parts.forEach(function (q) { FAULTS.forEach(function (f) { if (f.t.test(q.type) && !(q.type === "socket" && W.propsOf(q).app === "none")) pool.push([q, f]); }); });
    if (!pool.length) { app.toast("Build something first: there is nothing here to break."); return; }
    var pick = pool[Math.floor(Math.random() * pool.length)];
    app.edit(function () { doc.secret = { id: pick[0].id, k: pick[1].k, v: pick[1].v, was: W.propsOf(pick[0])[pick[1].k], say: pick[1].say }; pick[0].props[pick[1].k] = pick[1].v; });
    app.view.select([]); app.history.past = []; app.history.future = [];
    if (!app.on) app.power(true);
    app.toast("A fault is hidden somewhere in this plan. Hand it to the class: the Testers tab has the tools.", "warn");
    app.check();
  };

  Dialogs.prototype.lightning = function () {
    var app = this.app, doc = app.doc, sim = app.sim;
    if (!doc.parts.length) return;
    document.body.classList.add("pw-flash"); setTimeout(function () { document.body.classList.remove("pw-flash"); }, 900);
    var wired = {}; doc.wires.forEach(function (w) { wired[w.a] = 1; wired[w.b] = 1; });
    var spd = doc.parts.filter(function (p) { return p.type === "spd" && wired[p.id + ":PE"] && (wired[p.id + ":L"] || wired[p.id + ":N"]); });
    var rods = doc.parts.filter(function (p) { return p.type === "earth" && wired[p.id + ":PE"]; }), ohms = rods.length ? Math.min.apply(null, rods.map(function (p) { return +W.propsOf(p).ohms; })) : Infinity;
    if (spd.length && ohms <= 10) { app.toast("⚡ A strike nearby. The surge protector dumped it into a " + ohms + " Ω earth. Everything survived."); return; }
    var soft = doc.parts.filter(function (p) { return /^(hybrid|inverter|mppt|pwm|gridtie)$/.test(p.type) || (/^socket$/.test(p.type) && /^(led_tv|decoder|router|laptop|desktop|cctv|printer)$/.test(W.propsOf(p).app)); });
    soft.sort(function () { return Math.random() - 0.5; });
    var hit = soft.slice(0, 2), why = !spd.length ? "There is no surge protector" : ohms === Infinity ? "The surge protector has no earth rod to dump into" : "The surge protector could not dump the surge into a " + ohms + " Ω earth";
    if (!hit.length) { app.toast("⚡ A strike nearby. " + why + ", but there was nothing delicate connected."); return; }
    app.edit(function () { hit.forEach(function (p) { if (p.type === "socket") p.props.fault = "open"; }); });
    hit.forEach(function (p) { var st = sim.state[p.id]; if (st && p.type !== "socket") { if (/^(mppt|pwm|gridtie)$/.test(p.type)) { st.pvdead = true; st.mode = "dead"; st.tracking = false; } else { st.err = "overload"; st.run = false; } } });
    app.view.focus(hit.map(function (p) { return p.id; }));
    app.toast("⚡ A strike nearby. " + why + ". Destroyed: " + hit.map(function (p) { return W.label(doc, p, app.refs); }).join(" and ") + ".", "danger");
  };

  /* ================================================================== AI */

  var AI = W.AI = {};
  var QUICK = [["design", "Design a system for…"], ["explain", "Explain this system"], ["fix", "What is wrong with it?"], ["size", "Is it big enough?"], ["plan", "How do I install it?"], ["lesson", "Make it a lesson"]];

  AI.post = function (app, payload) {
    return fetch(app.cfg.aiUrl, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": app.cfg.csrf }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { if (r.status !== 200 || !j.ok) throw { friendly: j && j.error }; return j; }); });
  };

  AI.bind = function (app) {
    var pane = $("pw-pane-ai");
    pane.innerHTML = '<div class="pa-quick">' + QUICK.map(function (q) { return '<button type="button" data-q="' + q[0] + '">' + esc(q[1]) + '</button>'; }).join("") + '</div><div class="pa-log" id="pa-log" aria-live="polite"></div>' +
      '<form id="pa-form"><textarea id="pa-q" rows="2" placeholder="Ask anything about this plan"></textarea><button type="submit" class="primary">Ask</button></form>' +
      '<p class="fine">' + (app.cfg.aiEnabled ? "Answers come from the AI on this server, which is shown your plan and its readings. It can be wrong: have a qualified electrician check anything before it is built." : "The AI isn't switched on for this server (add GEMINI_API_KEY to .env), so answers come from the lab's own checker.") + '</p>';
    var pending = null, q = $("pa-q");
    pane.querySelectorAll("[data-q]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-q");
        if (k === "design") { pending = "design"; q.placeholder = "e.g. a tailor's shop with 3 sewing machines, an iron, 4 lights and a fan, where the grid is off most evenings"; q.focus(); return; }
        AI.ask(app, k, b.textContent);
      });
    });
    $("pa-form").addEventListener("submit", function (e) { e.preventDefault(); var t = q.value.trim(); if (!t) return; q.value = ""; AI.ask(app, pending || "ask", t); pending = null; q.placeholder = "Ask anything about this plan"; });
    q.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("pa-form").requestSubmit(); } });
  };

  AI.say = function (who, html, extra) {
    var log = $("pa-log"), div = document.createElement("div");
    div.className = "pa-msg " + who; div.innerHTML = html;
    if (extra) div.appendChild(extra);
    log.appendChild(div); log.scrollTop = log.scrollHeight;
    return div;
  };

  AI.ask = function (app, kind, question) {
    app.showSide("ai");
    AI.say("me", esc(question));
    var wait = AI.say("bot", '<span class="pa-dots"><i></i><i></i><i></i></span>');
    var done = function (res) {
      wait.remove();
      var extra = document.createElement("div"); extra.className = "pa-actions";
      if (res.spec && res.spec.loads && res.spec.loads.length) {
        var b = document.createElement("button"); b.type = "button"; b.className = "primary"; b.textContent = "Open it in the designer";
        b.addEventListener("click", function () { res.spec.title = res.spec.title || question; app.dialogs.wizard(res.spec); }); extra.appendChild(b);
      }
      var ids = (res.highlights || []).map(function (ref) { for (var id in app.refs) if (app.refs[id] === ref) return id; return null; }).filter(Boolean);
      if (ids.length) { var s = document.createElement("button"); s.type = "button"; s.textContent = "Show the parts it means"; s.addEventListener("click", function () { app.view.focus(ids); }); extra.appendChild(s); }
      AI.say("bot", W.md(res.reply || ""), extra.childNodes.length ? extra : null);
    };
    var local = function (why) { var r = AI.local(app, kind, question); if (why) r.reply = "_" + why + " Here is what the lab's own checker can say._\n\n" + r.reply; return r; };
    if (!app.cfg.aiEnabled) { setTimeout(function () { done(local("")); }, 300); return; }
    AI.post(app, { kind: kind, question: question, plan: app.digest() }).then(done, function (e) { done(local((e && e.friendly) || "The AI didn't answer.")); });
  };

  /* The helper that is always there: no key, no network. */
  AI.local = function (app, kind, question) {
    var doc = app.doc, by = {}, n = function (t) { return (by[t] || []).length; };
    doc.parts.forEach(function (p) { (by[p.type] = by[p.type] || []).push(p); });
    if (kind === "design") {
      var spec = Design.parse(question), d = Design.size(spec);
      return { reply: "Here is a first design for that. " + d.notes.map(function (x) { return "**" + x[0] + ".** " + x[1]; }).join("\n\n") + (d.warn.length ? "\n\n" + d.warn.join(" ") : ""), spec: spec };
    }
    if (!doc.parts.length) return { reply: "The drawing is empty. Press **Design a system**, or ask me to design one: say what it has to power." };
    var wp = 0; (by.pv || []).forEach(function (p) { wp += (W.PV[W.propsOf(p).model] || W.PV.p330).wp; });
    var kwh = 0; (by.battery || []).forEach(function (p) { var pr = W.propsOf(p); kwh += pr.volts * pr.ah / 1000; });
    var watts = 0, wh = 0; doc.parts.forEach(function (p) { var pr = W.propsOf(p); if (p.type === "lamp") { watts += pr.watts * pr.qty; wh += pr.watts * pr.qty * pr.hours; } else if (/^(socket|load)$/.test(p.type) && pr.app !== "none") { var s = W.loadSpec(pr); watts += s.watts; wh += s.watts * s.hours * s.duty; } else if (p.type === "dcload") { watts += W.dcWatts(pr); wh += W.dcWatts(pr) * (pr.hours || 5); } });
    var finds = W.Check.run(doc, app.sim, app.on), bad = finds.filter(function (f) { return f.level !== "info"; });
    if (kind === "fix") return { reply: finds.length ? (bad.length ? "Most important first:\n\n" : "Nothing dangerous. Worth knowing:\n\n") + finds.slice(0, 8).map(function (f) { return "- " + (f.level === "danger" ? "**Danger.** " : f.level === "warn" ? "**Fix.** " : "") + f.msg; }).join("\n") : "I can find nothing wrong on paper." + (app.on ? "" : " Switch the power on and press **Run a day** to test it properly.") };
    if (kind === "size") {
      var psh = wp ? Sun.worstMonth(doc.site) : null, make = psh ? wp * psh.psh * 0.68 : 0;
      return { reply: "The loads use about **" + Math.round(wh) + " Wh a day** and draw **" + Math.round(watts) + " W** all at once.\n\n" + (wp ? "- The " + (wp / 1000).toFixed(2) + " kWp of panels make about " + Math.round(make) + " Wh a day in " + Sun.MONTHS[psh.month - 1] + ", the poorest month: " + (make >= wh ? "enough." : "**not enough** — about " + Math.ceil((wh - make) / (psh.psh * 0.68 * 330)) + " more 330 W panels.") + "\n" : "- There are no panels.\n") +
        (kwh ? "- The battery holds " + kwh.toFixed(1) + " kWh, of which about half is usable for lead-acid: " + (kwh * 500 >= wh * 0.6 ? "enough for a night." : "**small** for these loads.") + "\n" : "") +
        ((by.inverter || by.hybrid) ? "- The inverter is " + W.propsOf((by.inverter || by.hybrid)[0]).va + " VA against " + Math.round(watts) + " W of load: " + (W.propsOf((by.inverter || by.hybrid)[0]).va >= watts * 1.2 ? "fine." : "**too small** with everything on.") : "") + "\n\nPress **Run a day** to see it hour by hour." };
    }
    if (kind === "plan") return { reply: "Press **Costs** and then **Implementation plan to print**: it writes the materials list, the cable schedule, the installation steps in order and a commissioning sheet with the readings to expect from this exact design.\n\nThe order never changes: mount and earth first, DC wiring with the isolators open, battery last but one, panels last, then test before any load is switched on." };
    if (kind === "lesson") return { reply: "**Lesson: will it last the night?**\n\n- **Predict.** Before running anything, ask the class: at what time will the battery be fullest? Emptiest? Write the guesses on the board.\n- **Observe.** Press **Run a day** and watch the blue battery line.\n- **Explain.** Why does the solar line fall before the loads line rises? Where does the evening's energy come from?\n- **Change one thing.** Shade one panel to 80%, or switch the month to August. Run it again.\n- **Find the fault.** Under Check, press **Hide a fault**, then give the class the Testers.\n\nTwo questions: *Why is a fuse put next to the battery and not next to the inverter?* *Why does the breaker protect the cable, not the appliance?*" };
    var parts = [];
    if (n("grid1") || n("grid3")) parts.push("a grid supply");
    if (wp) parts.push(n("pv") + " panels (" + (wp / 1000).toFixed(2) + " kWp)");
    if (kwh) parts.push(n("battery") + " batteries holding " + kwh.toFixed(1) + " kWh");
    if (n("hybrid")) parts.push("a hybrid inverter that runs the loads from solar, then battery, then the grid"); else if (n("inverter")) parts.push("an inverter making 230 V AC from the battery");
    if (n("mppt") || n("pwm")) parts.push("a charge controller between panels and battery");
    if (n("gridtie")) parts.push("a grid-tie inverter feeding solar into the house wiring");
    return { reply: "This plan has " + (parts.join(", ") || doc.parts.length + " parts") + ", feeding loads of about " + Math.round(watts) + " W that use roughly " + Math.round(wh) + " Wh a day.\n\n" +
      (wp ? "Energy flows from the panels, through " + (n("hybrid") ? "the hybrid inverter" : "the charge controller") + ", into the battery, and from the battery through the inverter to the consumer unit, where each breaker feeds one circuit.\n\n" : "Energy flows from the supply through the main switch and RCD to the busbar, and each breaker feeds one circuit.\n\n") +
      (bad.length ? "The checklist has **" + bad.length + "** thing" + (bad.length > 1 ? "s" : "") + " to put right: ask *What is wrong with it?*" : "The checklist is clean.") + " Switch the power on and click a cable with the clamp meter to see the current in it." };
  };
})(typeof window !== "undefined" ? window : globalThis);
