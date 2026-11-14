/* Chalk Power Lab — the parts.
 *
 * Each part says what it is (name, terminals, the things you can set) and
 * how to draw itself. How it behaves electrically lives in power_sim.js,
 * keyed by the same type, so a drawing never decides physics.
 *
 * A terminal is {n: name, k: kind, x, y, side}. Kinds colour the wire that
 * leaves it and feed the design checks:
 *   L live · N neutral · PE earth · P DC positive · M DC negative · X either
 *
 * draw(c, part, props, st, o): c is a 2-D context already moved to the
 * part's top-left corner; st is the simulator's state for it (may be {});
 * o = {on: power is on, t: seconds, w, h}.
 */
(function (root) {
  "use strict";

  var W = root.ChalkPower;
  var PARTS = W.PARTS = {};
  var TAU = Math.PI * 2;

  function def(type, o) {
    o.type = type;
    if (Array.isArray(o.terms)) o.terms = place(o.terms, o.w, o.h);
    PARTS[type] = o;
  }
  /* [name, kind, side, fraction along that side] -> a terminal */
  function place(list, w, h) {
    return list.map(function (t) {
      var s = t[2], f = t[3];
      return { n: t[0], k: t[1], side: s, x: s === "l" ? 0 : s === "r" ? w : Math.round(w * f), y: s === "t" ? 0 : s === "b" ? h : Math.round(h * f) };
    });
  }
  W.placeTerms = place;

  /* ------------------------------------------------------------ drawing */

  function rr(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function plate(c, w, h, fill, stroke, r) {
    rr(c, 0, 0, w, h, r == null ? 7 : r);
    c.fillStyle = fill; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = stroke || "rgba(0,0,0,.45)"; c.stroke();
  }
  function tx(c, s, x, y, size, color, align, weight) {
    c.font = (weight || 600) + " " + (size || 10) + "px system-ui, sans-serif";
    c.fillStyle = color || "#1b242c"; c.textAlign = align || "center"; c.textBaseline = "middle";
    c.fillText(s, x, y);
  }
  function lcd(c, x, y, w, h, lines, glow) {
    rr(c, x, y, w, h, 3); c.fillStyle = glow ? "#0d2a1c" : "#1a2228"; c.fill();
    c.font = "600 " + Math.min(11, Math.floor((h - 4) / lines.length)) + "px ui-monospace, Menlo, monospace";
    c.fillStyle = glow ? "#7dffb0" : "#4a5862"; c.textAlign = "center"; c.textBaseline = "middle";
    lines.forEach(function (s, i) { c.fillText(s, x + w / 2, y + h * (i + 0.5) / lines.length + 0.5); });
  }
  function led(c, x, y, color, on) {
    c.beginPath(); c.arc(x, y, 3.2, 0, TAU);
    c.fillStyle = on ? color : "#3a444c"; c.fill();
    if (on) { c.beginPath(); c.arc(x, y, 6.5, 0, TAU); c.fillStyle = color.replace(")", ",.25)").replace("rgb", "rgba"); c.fill(); }
  }
  var GREEN = "rgb(91,216,138)", RED = "rgb(255,106,90)", AMBER = "rgb(242,177,58)";
  function f1(v) { return isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) : "—"; }
  function watts(v) { return !isFinite(v) ? "—" : Math.abs(v) >= 1000 ? (v / 1000).toFixed(2) + "kW" : v.toFixed(0) + "W"; }
  W.draw = { rr: rr, plate: plate, tx: tx, lcd: lcd, led: led };

  /* a DIN-rail device: white case, a toggle, a rating */
  function din(c, w, h, label, on, trip, color) {
    plate(c, w, h, "#e9edf0", "#8d99a3", 4);
    c.fillStyle = "#cfd6db"; c.fillRect(3, h * 0.3, w - 6, h * 0.4);
    var ty = on ? h * 0.36 : h * 0.52;
    rr(c, w / 2 - 7, ty, 14, h * 0.14, 2); c.fillStyle = trip ? "#e0a020" : on ? (color || "#2f7d4f") : "#b23b30"; c.fill();
    tx(c, label, w / 2, h * 0.19, 9, "#1b242c");
    tx(c, trip ? "TRIP" : on ? "ON" : "OFF", w / 2, h * 0.82, 8, trip ? "#b06a00" : on ? "#2f7d4f" : "#b23b30");
  }

  /* ============================================================== supply */

  def("grid1", {
    name: "Utility supply", ref: "G", cat: "Supply", w: 100, h: 96, price: 0,
    blurb: "The national grid: 230 V, single phase. Flip it off to rehearse a power cut.",
    terms: [["L", "L", "b", 0.3], ["N", "N", "b", 0.7]],
    props: { volts: 230, on: true, zs: 0.35 },
    spec: [{ k: "on", label: "Supply is on", type: "bool", live: true }, { k: "volts", label: "Voltage", type: "num", min: 100, max: 260, unit: "V" },
           { k: "zs", label: "Supply impedance", type: "num", min: 0.05, max: 3, step: 0.05, unit: "Ω", hint: "Higher = a weak line that sags under load" }],
    draw: function (c, p, pr, st, o) {
      plate(c, 100, 96, "#2a3a46", "#51697a");
      c.strokeStyle = "#9fb3c2"; c.lineWidth = 2; c.beginPath();
      c.moveTo(50, 12); c.lineTo(50, 60); c.moveTo(30, 22); c.lineTo(70, 22); c.moveTo(36, 34); c.lineTo(64, 34);
      c.moveTo(38, 60); c.lineTo(50, 40); c.lineTo(62, 60); c.stroke();
      led(c, 86, 12, st.live && o.on ? GREEN : RED, o.on);
      tx(c, st.live === false || !pr.on ? "POWER CUT" : pr.volts + " V ~ 50 Hz", 50, 72, 9, "#dfe8ee");
      if (o.on && st.live) tx(c, watts(st.p || 0), 50, 84, 9, "#ffd36b");
    }
  });

  def("grid3", {
    name: "Three-phase supply", ref: "G", cat: "Supply", w: 130, h: 96, price: 0,
    blurb: "400 V between phases, 230 V from each phase to neutral. Share the loads between L1, L2 and L3.",
    terms: [["L1", "L", "b", 0.2], ["L2", "L", "b", 0.4], ["L3", "L", "b", 0.6], ["N", "N", "b", 0.8]],
    props: { volts: 230, on: true, zs: 0.25 },
    spec: [{ k: "on", label: "Supply is on", type: "bool", live: true }, { k: "volts", label: "Phase voltage", type: "num", min: 100, max: 260, unit: "V" }],
    draw: function (c, p, pr, st, o) {
      plate(c, 130, 96, "#2a3a46", "#51697a");
      ["#a2542a", "#222", "#8a8f94"].forEach(function (col, i) {
        c.strokeStyle = ["#d98b5a", "#e8eef4", "#9aa6b0"][i]; c.lineWidth = 1.6; c.beginPath();
        for (var x = 0; x <= 90; x += 3) { var y = 34 + 16 * Math.sin((x / 90) * TAU - i * TAU / 3 + (o.on ? o.t * 3 : 0)); if (x) c.lineTo(20 + x, y); else c.moveTo(20 + x, y); }
        c.stroke();
      });
      led(c, 116, 12, st.live && o.on ? GREEN : RED, o.on);
      tx(c, !pr.on ? "POWER CUT" : "3 × " + pr.volts + " V", 65, 70, 9, "#dfe8ee");
      if (o.on && st.live) tx(c, watts(st.p || 0) + "  N " + f1(st.inn || 0) + "A", 65, 83, 9, "#ffd36b");
    }
  });

  def("genset", {
    name: "Generator", ref: "GEN", cat: "Supply", w: 130, h: 90, price: function (p) { return 9000 + p.kva * 11000; },
    blurb: "A petrol or diesel set. It burns fuel whether you use the power or not.",
    terms: [["L", "L", "b", 0.25], ["N", "N", "b", 0.5], ["PE", "PE", "b", 0.75]],
    props: { kva: 3, run: false },
    spec: [{ k: "run", label: "Engine running", type: "bool", live: true }, { k: "kva", label: "Size", type: "select", options: [[1, "1 kVA"], [2.5, "2.5 kVA"], [3, "3 kVA"], [5, "5 kVA"], [8, "8 kVA"], [15, "15 kVA"], [30, "30 kVA"]] }],
    draw: function (c, p, pr, st, o) {
      var run = pr.run && o.on && !st.err, j = run ? Math.sin(o.t * 40) * 0.7 : 0;
      c.save(); c.translate(j, 0);
      plate(c, 130, 90, "#c9a227", "#6e5a12");
      rr(c, 10, 14, 60, 44, 5); c.fillStyle = "#2b2f36"; c.fill();
      c.beginPath(); c.arc(98, 36, 18, 0, TAU); c.fillStyle = "#3b4149"; c.fill();
      c.strokeStyle = "#8d99a3"; c.lineWidth = 3; c.beginPath();
      for (var i = 0; i < 3; i++) { var a = i * TAU / 3 + (run ? o.t * 14 : 0); c.moveTo(98, 36); c.lineTo(98 + 15 * Math.cos(a), 36 + 15 * Math.sin(a)); }
      c.stroke();
      tx(c, pr.kva + " kVA", 40, 28, 10, "#ffd36b");
      tx(c, st.err ? "TRIPPED" : run ? watts(st.p || 0) : "stopped", 40, 44, 9, st.err ? "#ff8a7a" : "#dfe8ee");
      tx(c, run ? (st.lph || 0).toFixed(2) + " L/h" : "", 65, 72, 9, "#3a2f06");
      c.restore();
    }
  });

  /* =============================================================== solar */

  def("pv", {
    name: "Solar panel", ref: "PV", cat: "Solar", w: 84, h: 116, price: function (p) { return (W.PV[p.model] || W.PV.p330).price; },
    blurb: "Makes direct current from sunlight. Volts add in series, amps add in parallel.",
    terms: [["+", "P", "b", 0.25], ["-", "M", "b", 0.75]],
    props: { model: "p330", shade: 0, dirt: 0, fault: "none" },
    spec: [{ k: "model", label: "Panel", type: "select", options: Object.keys(W.PV).map(function (k) { return [k, W.PV[k].name]; }) },
           { k: "shade", label: "Shade", type: "range", min: 0, max: 100, step: 5, unit: "%", live: true },
           { k: "dirt", label: "Dust on the glass", type: "range", min: 0, max: 60, step: 5, unit: "%", live: true },
           { k: "fault", label: "Fault", type: "select", options: [["none", "Healthy"], ["open", "Broken connection inside"], ["bypass", "Shorted bypass diode"], ["hot", "Hot spot (cracked cell)"]], teacher: true }],
    draw: function (c, p, pr, st, o) {
      var m = W.PV[pr.model] || W.PV.p330, sun = o.on ? W.clamp((o.G || 0) / 1000, 0, 1.1) * (1 - pr.shade / 100) : 0.25;
      plate(c, 84, 116, "#c8d0d6", "#8d99a3", 3);
      c.fillStyle = "rgb(" + Math.round(14 + 30 * sun) + "," + Math.round(30 + 60 * sun) + "," + Math.round(74 + 110 * sun) + ")";
      c.fillRect(4, 4, 76, 92);
      c.strokeStyle = "rgba(255,255,255,.22)"; c.lineWidth = 0.7; c.beginPath();
      for (var i = 1; i < 4; i++) { c.moveTo(4 + 19 * i, 4); c.lineTo(4 + 19 * i, 96); }
      for (i = 1; i < 6; i++) { c.moveTo(4, 4 + 15.33 * i); c.lineTo(80, 4 + 15.33 * i); }
      c.stroke();
      if (pr.shade > 0) { c.fillStyle = "rgba(8,12,16," + (0.75 * pr.shade / 100) + ")"; c.fillRect(4, 4, 76, 92); }
      if (pr.dirt > 0) { c.fillStyle = "rgba(190,150,100," + (0.7 * pr.dirt / 100) + ")"; c.fillRect(4, 4, 76, 92); }
      if (st.bypass && o.on) { c.strokeStyle = AMBER; c.lineWidth = 2; c.strokeRect(5, 5, 74, 90); }
      tx(c, m.wp + " Wp", 42, 14, 9, "rgba(255,255,255,.85)");
      if (o.on) tx(c, f1(st.v || 0) + "V " + f1(st.i || 0) + "A", 42, 86, 9, "#ffd36b");
      tx(c, o.on ? watts(st.p || 0) : m.name.replace(/ \(.*/, ""), 42, 106, 9, "#1b242c");
    }
  });

  def("combiner", {
    name: "PV combiner box", ref: "CB", cat: "Solar", w: 180, h: 96, price: 6500,
    blurb: "Joins up to four strings in parallel, each through its own 15 A fuse.",
    terms: [["S1+", "P", "t", 0.07], ["S2+", "P", "t", 0.19], ["S3+", "P", "t", 0.31], ["S4+", "P", "t", 0.43],
            ["S1-", "M", "t", 0.57], ["S2-", "M", "t", 0.69], ["S3-", "M", "t", 0.81], ["S4-", "M", "t", 0.93], ["OUT+", "P", "b", 0.3], ["OUT-", "M", "b", 0.7]],
    props: { amps: 15 },
    spec: [{ k: "amps", label: "String fuses", type: "select", options: [[10, "10 A"], [15, "15 A"], [20, "20 A"], [25, "25 A"]] }],
    draw: function (c, p, pr, st) {
      plate(c, 180, 96, "#dfe5e9", "#8d99a3");
      for (var i = 0; i < 4; i++) {
        var x = 13 + i * 21.6, blown = st.blown && st.blown[i];
        rr(c, x - 6, 22, 12, 34, 2); c.fillStyle = blown ? "#5b2a25" : "#f4f6f7"; c.fill(); c.strokeStyle = "#8d99a3"; c.stroke();
        tx(c, blown ? "✕" : pr.amps, x, 39, 8, blown ? "#ff8a7a" : "#1b242c");
      }
      c.fillStyle = "#b8442f"; c.fillRect(8, 62, 84, 5); c.fillStyle = "#22282d"; c.fillRect(96, 62, 76, 5);
      tx(c, "PV COMBINER", 134, 36, 9, "#51606b");
    }
  });

  /* ================================================ storage and conversion */

  def("battery", {
    name: "Battery", ref: "BAT", cat: "Storage & conversion", w: 110, h: 84,
    price: function (p) { return p.ah * (p.volts / 12) * (p.chem === "lfp" ? 260 : p.chem === "tubular" ? 150 : 110); },
    blurb: "Stores energy for the night. Lead-acid likes to stay above half full; lithium can go deeper.",
    terms: [["+", "P", "t", 0.2], ["-", "M", "t", 0.8]],
    props: { chem: "agm", volts: 12, ah: 200, soc: 80 },
    spec: [{ k: "chem", label: "Chemistry", type: "select", options: [["agm", "Lead-acid AGM / gel"], ["tubular", "Tubular flooded"], ["lfp", "Lithium (LiFePO₄)"]] },
           { k: "volts", label: "Nominal voltage", type: "select", options: [[12, "12 V"], [24, "24 V"], [48, "48 V"]] },
           { k: "ah", label: "Capacity", type: "select", options: [[7, "7 Ah"], [18, "18 Ah"], [50, "50 Ah"], [100, "100 Ah"], [150, "150 Ah"], [200, "200 Ah"], [250, "250 Ah"], [300, "300 Ah"]] },
           { k: "soc", label: "Charge to start with", type: "range", min: 0, max: 100, step: 5, unit: "%" }],
    draw: function (c, p, pr, st, o) {
      var soc = st.soc == null ? pr.soc / 100 : st.soc, lfp = pr.chem === "lfp";
      plate(c, 110, 84, lfp ? "#27405a" : "#2b2f36", "#11151a");
      c.fillStyle = lfp ? "#3d7fd0" : "#b8442f"; c.fillRect(0, 8, 110, 10);
      rr(c, 12, 30, 86, 20, 3); c.fillStyle = "#0f1419"; c.fill();
      c.fillStyle = soc > 0.5 ? "#5bd88a" : soc > 0.25 ? "#f2b13a" : "#ff6a5a"; c.fillRect(14, 32, 82 * W.clamp(soc, 0, 1), 16);
      tx(c, Math.round(soc * 100) + "%", 55, 41, 10, "#fff");
      tx(c, pr.volts + " V · " + pr.ah + " Ah", 55, 61, 9, "#dfe8ee");
      if (o.on) tx(c, f1(st.v || 0) + " V  " + (st.i > 0.05 ? "▼ " : st.i < -0.05 ? "▲ " : "") + f1(Math.abs(st.i || 0)) + " A", 55, 74, 9, st.i < -0.05 ? "#7dffb0" : "#ffd36b");
      else tx(c, lfp ? "LiFePO₄" : pr.chem === "tubular" ? "Tubular" : "AGM", 55, 74, 9, "#8b9aa8");
    }
  });

  var CTRL_STATE = { off: "sleeping", track: "MPPT bulk", limit: "limiting", abs: "absorb", float: "float", nobat: "no battery", dead: "DESTROYED", pwm: "charging", full: "full" };
  def("mppt", {
    name: "MPPT charge controller", ref: "CC", cat: "Storage & conversion", w: 150, h: 104, price: function (p) { return 3500 + p.amps * 190; },
    blurb: "Hunts for the panel voltage that gives the most power, then converts it down to charge the battery.",
    terms: [["PV+", "P", "t", 0.2], ["PV-", "M", "t", 0.42], ["B+", "P", "b", 0.2], ["B-", "M", "b", 0.42]],
    props: { amps: 40, maxpv: 150 },
    spec: [{ k: "amps", label: "Charge current", type: "select", options: [[10, "10 A"], [20, "20 A"], [30, "30 A"], [40, "40 A"], [60, "60 A"], [80, "80 A"], [100, "100 A"]] },
           { k: "maxpv", label: "Max PV voltage", type: "select", options: [[75, "75 V"], [100, "100 V"], [150, "150 V"], [250, "250 V"], [450, "450 V"]] }],
    draw: function (c, p, pr, st, o) {
      plate(c, 150, 104, "#1f5f8b", "#0f3550");
      tx(c, "MPPT " + pr.maxpv + "/" + pr.amps, 104, 14, 9, "#cfe6f5");
      lcd(c, 60, 24, 80, 46, o.on ? [f1(st.vpv || 0) + "V " + watts(st.pin || 0), "bat " + f1(st.vb || 0) + "V " + f1(st.iout || 0) + "A", CTRL_STATE[st.mode || "off"]] : ["", "MPPT", ""], o.on && st.mode && st.mode !== "off");
      led(c, 68, 84, st.mode === "dead" || st.mode === "nobat" ? RED : st.mode === "float" ? GREEN : AMBER, o.on && st.mode && st.mode !== "off");
      tx(c, "PV", 46, 12, 8, "#cfe6f5"); tx(c, "BATTERY", 50, 92, 8, "#cfe6f5");
    }
  });
  def("pwm", {
    name: "PWM charge controller", ref: "CC", cat: "Storage & conversion", w: 130, h: 90, price: function (p) { return 700 + p.amps * 45; },
    blurb: "A switch between panel and battery. Cheap, but it drags the panel down to battery voltage and wastes the rest.",
    terms: [["PV+", "P", "t", 0.2], ["PV-", "M", "t", 0.42], ["B+", "P", "b", 0.2], ["B-", "M", "b", 0.42]],
    props: { amps: 20, maxpv: 50 },
    spec: [{ k: "amps", label: "Charge current", type: "select", options: [[10, "10 A"], [20, "20 A"], [30, "30 A"], [60, "60 A"]] }],
    draw: function (c, p, pr, st, o) {
      plate(c, 130, 90, "#3a4a3f", "#1d2a22");
      tx(c, "PWM " + pr.amps + " A", 90, 13, 9, "#d5e8da");
      lcd(c, 56, 22, 66, 38, o.on ? [f1(st.vb || 0) + "V " + f1(st.iout || 0) + "A", CTRL_STATE[st.mode || "off"]] : ["", "PWM"], o.on && st.mode && st.mode !== "off");
      led(c, 64, 74, st.mode === "dead" || st.mode === "nobat" ? RED : GREEN, o.on && st.mode && st.mode !== "off");
    }
  });

  var INV_VA = [[300, "300 VA"], [600, "600 VA"], [1000, "1 kVA"], [1500, "1.5 kVA"], [2000, "2 kVA"], [3000, "3 kVA"], [5000, "5 kVA"], [8000, "8 kVA"], [10000, "10 kVA"]];
  var VDC = [[12, "12 V"], [24, "24 V"], [48, "48 V"]];
  def("inverter", {
    name: "Inverter", ref: "INV", cat: "Storage & conversion", w: 150, h: 110, price: function (p) { return 4000 + p.va * 9; },
    blurb: "Turns battery DC into 230 V AC. Sized for the biggest load plus the kick of a motor starting.",
    terms: [["DC+", "P", "l", 0.3], ["DC-", "M", "l", 0.7], ["L", "L", "r", 0.25], ["N", "N", "r", 0.5], ["PE", "PE", "r", 0.75]],
    props: { va: 1000, vdc: 12, on: true, bond: true },
    spec: [{ k: "on", label: "Switched on", type: "bool", live: true }, { k: "va", label: "Size", type: "select", options: INV_VA }, { k: "vdc", label: "Battery voltage", type: "select", options: VDC },
           { k: "bond", label: "Neutral bonded to earth inside", type: "bool", hint: "Needed for an RCD after it to work" }],
    draw: function (c, p, pr, st, o) {
      plate(c, 150, 110, "#d98b1f", "#7a4a08");
      tx(c, "INVERTER " + (pr.va >= 1000 ? pr.va / 1000 + " kVA" : pr.va + " VA"), 75, 14, 9, "#2a1a04");
      lcd(c, 24, 26, 102, 46, o.on ? [st.run ? "230 V ~  " + watts(st.pac || 0) : (st.err || "off").toUpperCase(), "load " + Math.round(100 * (st.s || 0) / pr.va) + "%", "dc " + f1(st.vdc || 0) + "V " + f1(st.idc || 0) + "A"] : ["", "INVERTER", ""], o.on && st.run);
      led(c, 32, 90, st.run ? GREEN : st.err ? RED : AMBER, o.on && pr.on);
      tx(c, st.err && o.on ? "tap to reset" : pr.vdc + " V DC in", 90, 90, 8, "#2a1a04");
    }
  });
  def("hybrid", {
    name: "Hybrid inverter (all-in-one)", ref: "HYB", cat: "Storage & conversion", w: 200, h: 150, price: function (p) { return 14000 + p.va * 9.5; },
    blurb: "Solar charger, inverter and grid changeover in one box. Solar first, then battery, then the grid.",
    terms: [["PV+", "P", "t", 0.2], ["PV-", "M", "t", 0.36], ["B+", "P", "b", 0.2], ["B-", "M", "b", 0.36],
            ["GL", "L", "l", 0.35], ["GN", "N", "l", 0.65], ["L", "L", "r", 0.3], ["N", "N", "r", 0.5], ["PE", "PE", "r", 0.7]],
    props: { va: 3000, vdc: 24, on: true, mode: "SBU", maxpv: 450, amps: 80, gridcharge: 0 },
    spec: [{ k: "on", label: "Switched on", type: "bool", live: true }, { k: "va", label: "Size", type: "select", options: INV_VA.slice(2) }, { k: "vdc", label: "Battery voltage", type: "select", options: VDC },
           { k: "mode", label: "Priority", type: "select", options: [["SBU", "Solar → battery → grid"], ["UTI", "Grid first, solar charges"]], live: true },
           { k: "maxpv", label: "Max PV voltage", type: "select", options: [[150, "150 V"], [250, "250 V"], [450, "450 V"], [500, "500 V"]] },
           { k: "amps", label: "Solar charge current", type: "select", options: [[40, "40 A"], [60, "60 A"], [80, "80 A"], [100, "100 A"], [120, "120 A"]] },
           { k: "gridcharge", label: "Charge from the grid", type: "select", options: [[0, "Never"], [10, "10 A"], [30, "30 A"], [60, "60 A"]], live: true }],
    draw: function (c, p, pr, st, o) {
      plate(c, 200, 150, "#eef1f3", "#8d99a3", 10);
      c.fillStyle = "#18222b"; rr(c, 30, 30, 140, 76, 5); c.fill();
      var run = o.on && st.mode && st.mode !== "off";
      tx(c, "HYBRID " + pr.va / 1000 + " kVA · " + pr.vdc + " V", 100, 15, 9.5, "#1b242c");
      if (run) {
        tx(c, "☀ " + watts(st.pin || 0), 66, 46, 10, "#ffd36b"); tx(c, "⌂ " + watts(st.pac || 0), 136, 46, 10, "#7dffb0");
        tx(c, "▮ " + f1(st.vb || 0) + "V " + (st.ib > 0 ? "+" : "") + f1(st.ib || 0) + "A", 100, 68, 10, "#9fd0ff");
        tx(c, st.mode === "byp" ? "GRID BYPASS" : "INVERTER · " + (CTRL_STATE[st.cmode || "off"] || ""), 100, 90, 9, "#e8eef4");
      } else tx(c, o.on ? (st.err || "OFF").toUpperCase() : "all-in-one", 100, 68, 10, o.on ? "#ff8a7a" : "#5d6b76");
      led(c, 60, 124, GREEN, run && st.mode === "inv"); led(c, 100, 124, AMBER, run && st.mode === "byp"); led(c, 140, 124, RED, o.on && !!st.err);
      tx(c, "INV", 60, 136, 7, "#51606b"); tx(c, "GRID", 100, 136, 7, "#51606b"); tx(c, "FAULT", 140, 136, 7, "#51606b");
    }
  });
  def("gridtie", {
    name: "Grid-tie inverter", ref: "GTI", cat: "Storage & conversion", w: 150, h: 100, price: function (p) { return 9000 + p.va * 7; },
    blurb: "No battery: it pushes solar power straight into the house wiring, and shuts off the instant the grid goes.",
    terms: [["PV+", "P", "t", 0.3], ["PV-", "M", "t", 0.6], ["L", "L", "b", 0.25], ["N", "N", "b", 0.5], ["PE", "PE", "b", 0.75]],
    props: { va: 3000, maxpv: 500, minpv: 60 },
    spec: [{ k: "va", label: "Size", type: "select", options: INV_VA.slice(2, 8) }, { k: "maxpv", label: "Max PV voltage", type: "select", options: [[150, "150 V"], [500, "500 V"], [600, "600 V"]] }],
    draw: function (c, p, pr, st, o) {
      plate(c, 150, 100, "#b8262e", "#5f0f14");
      tx(c, "GRID-TIE " + pr.va / 1000 + " kW", 75, 14, 9, "#ffe3e0");
      lcd(c, 22, 26, 106, 40, o.on ? [st.mode === "track" || st.mode === "limit" ? "feeding " + watts(st.pac || 0) : st.mode === "dead" ? "DESTROYED" : st.island ? "NO GRID — waiting" : "sleeping", "pv " + f1(st.vpv || 0) + " V"] : ["", "GRID-TIE"], o.on && (st.mode === "track" || st.mode === "limit"));
      led(c, 30, 80, st.mode === "track" || st.mode === "limit" ? GREEN : AMBER, o.on);
    }
  });

  /* ========================================================== protection */

  var MCB_A = [[6, "6 A"], [10, "10 A"], [16, "16 A"], [20, "20 A"], [25, "25 A"], [32, "32 A"], [40, "40 A"], [63, "63 A"], [100, "100 A"], [125, "125 A"]];
  var FAULT_LOOSE = { k: "fault", label: "Fault", type: "select", options: [["none", "Healthy"], ["loose", "Loose, burnt terminal"]], teacher: true };
  def("mcb", {
    name: "Circuit breaker (MCB)", ref: "Q", cat: "Protection", w: 40, h: 84, price: function (p) { return 220 + p.amps * 6; },
    blurb: "Protects the cable after it. Trips slowly on overload and instantly on a short circuit.",
    terms: [["in", "X", "t", 0.5], ["out", "X", "b", 0.5]],
    props: { amps: 16, curve: "C", on: true, fault: "none" },
    spec: [{ k: "on", label: "Switched on", type: "bool", live: true }, { k: "amps", label: "Rating", type: "select", options: MCB_A },
           { k: "curve", label: "Trip curve", type: "select", options: [["B", "B — lights, sockets"], ["C", "C — motors, general"], ["D", "D — heavy starting"]] }, FAULT_LOOSE],
    draw: function (c, p, pr, st) { din(c, 40, 84, pr.curve + pr.amps, pr.on && !st.trip, !!st.trip); }
  });
  def("fuse", {
    name: "Fuse", ref: "F", cat: "Protection", w: 40, h: 70, price: function (p) { return 150 + p.amps * 4; },
    blurb: "A wire made to melt first. Every battery needs one close to its positive post.",
    terms: [["in", "X", "t", 0.5], ["out", "X", "b", 0.5]],
    props: { amps: 60, fault: "none" },
    spec: [{ k: "amps", label: "Rating", type: "select", options: [[5, "5 A"], [10, "10 A"], [15, "15 A"], [20, "20 A"], [30, "30 A"], [40, "40 A"], [60, "60 A"], [80, "80 A"], [100, "100 A"], [125, "125 A"], [160, "160 A"], [200, "200 A"], [250, "250 A"], [400, "400 A"]] }, FAULT_LOOSE],
    draw: function (c, p, pr, st) {
      plate(c, 40, 70, "#dfe5e9", "#8d99a3", 4);
      rr(c, 11, 12, 18, 46, 4); c.fillStyle = st.blown ? "#4a2622" : "#f7f3e4"; c.fill(); c.strokeStyle = "#a08f5a"; c.stroke();
      if (!st.blown) { c.strokeStyle = "#8a7a3a"; c.beginPath(); c.moveTo(20, 16); c.lineTo(20, 54); c.stroke(); }
      tx(c, st.blown ? "BLOWN" : pr.amps + "A", 20, 35, 8, st.blown ? "#ff8a7a" : "#1b242c");
    }
  });
  def("isolator", {
    name: "Isolator (2-pole)", ref: "S", cat: "Protection", w: 70, h: 84, price: 650,
    blurb: "A switch you can lock off. Breaks both conductors so the far side is truly dead to work on.",
    terms: [["1", "X", "t", 0.28], ["3", "X", "t", 0.72], ["2", "X", "b", 0.28], ["4", "X", "b", 0.72]],
    props: { on: true, amps: 63, fault: "none" },
    spec: [{ k: "on", label: "Switched on", type: "bool", live: true }, { k: "amps", label: "Rating", type: "select", options: MCB_A.slice(4) }, FAULT_LOOSE],
    draw: function (c, p, pr) {
      plate(c, 70, 84, "#e9edf0", "#8d99a3", 4);
      c.save(); c.translate(35, 44); c.rotate(pr.on ? 0 : -Math.PI / 2);
      rr(c, -8, -22, 16, 44, 4); c.fillStyle = pr.on ? "#c0392b" : "#58636c"; c.fill(); c.restore();
      c.beginPath(); c.arc(35, 44, 5, 0, TAU); c.fillStyle = "#f2c94c"; c.fill();
      tx(c, pr.on ? "I  ON" : "0  OFF", 35, 76, 8, pr.on ? "#2f7d4f" : "#b23b30");
      tx(c, "ISOLATOR", 35, 10, 7.5, "#51606b");
    }
  });
  def("rcd", {
    name: "RCD (earth-leakage)", ref: "RCD", cat: "Protection", w: 76, h: 84, price: 1500,
    blurb: "Compares live with neutral. If some current is escaping to earth — perhaps through a person — it cuts the power in a blink.",
    terms: [["Lin", "L", "t", 0.28], ["Nin", "N", "t", 0.72], ["Lout", "L", "b", 0.28], ["Nout", "N", "b", 0.72]],
    props: { ma: 30, amps: 40, on: true },
    spec: [{ k: "on", label: "Switched on", type: "bool", live: true }, { k: "ma", label: "Trips at", type: "select", options: [[10, "10 mA"], [30, "30 mA — people"], [100, "100 mA"], [300, "300 mA — fire"]] },
           { k: "amps", label: "Rating", type: "select", options: MCB_A.slice(4, 9) }],
    draw: function (c, p, pr, st) {
      din(c, 76, 84, "RCD " + pr.ma + "mA", pr.on && !st.trip, !!st.trip, "#2a6fb0");
      rr(c, 56, 30, 14, 12, 2); c.fillStyle = "#f2c94c"; c.fill(); tx(c, "T", 63, 36, 8, "#1b242c");
    }
  });
  def("spd", {
    name: "Surge protector (SPD)", ref: "SPD", cat: "Protection", w: 50, h: 84, price: 1800,
    blurb: "Dumps a lightning surge to earth before it reaches the electronics. Useless without a good earth.",
    terms: [["L", "X", "t", 0.3], ["N", "X", "t", 0.7], ["PE", "PE", "b", 0.5]],
    props: {}, spec: [],
    draw: function (c, p, pr, st) {
      plate(c, 50, 84, "#e9edf0", "#8d99a3", 4);
      c.fillStyle = st.spent ? "#b23b30" : "#2f7d4f"; c.fillRect(17, 24, 16, 10);
      c.strokeStyle = "#e0a020"; c.lineWidth = 2.2; c.beginPath(); c.moveTo(28, 40); c.lineTo(20, 54); c.lineTo(28, 54); c.lineTo(21, 68); c.stroke();
      tx(c, "SPD", 25, 12, 8, "#51606b");
    }
  });
  def("earth", {
    name: "Earth rod", ref: "E", cat: "Protection", w: 50, h: 64, price: 900,
    blurb: "A copper rod driven into the ground. The drier the soil, the worse it works.",
    terms: [["PE", "PE", "t", 0.5]],
    props: { ohms: 8 },
    spec: [{ k: "ohms", label: "Resistance to earth", type: "select", options: [[2, "2 Ω — wet clay"], [8, "8 Ω — good"], [30, "30 Ω — sandy soil"], [120, "120 Ω — dry sand"], [800, "800 Ω — rod barely in"]] }],
    draw: function (c, p, pr) {
      c.strokeStyle = "#7fbf5f"; c.lineWidth = 3; c.beginPath(); c.moveTo(25, 0); c.lineTo(25, 30); c.stroke();
      c.lineWidth = 2.5; c.beginPath(); c.moveTo(7, 30); c.lineTo(43, 30); c.moveTo(13, 38); c.lineTo(37, 38); c.moveTo(19, 46); c.lineTo(31, 46); c.stroke();
      tx(c, pr.ohms + " Ω", 25, 57, 9, "#a8d890");
    }
  });

  /* ============================================ switching and distribution */

  def("meter", {
    name: "Prepaid meter", ref: "M", cat: "Switching & distribution", w: 96, h: 104, price: 0,
    blurb: "Counts the energy that passes. When the credit runs out, so does the power.",
    terms: [["Lin", "L", "t", 0.28], ["Nin", "N", "t", 0.72], ["Lout", "L", "b", 0.28], ["Nout", "N", "b", 0.72]],
    props: { prepaid: true, credit: 50 },
    spec: [{ k: "prepaid", label: "Prepaid (cuts off at zero)", type: "bool" }, { k: "credit", label: "Credit loaded", type: "num", min: 0, max: 5000, unit: "kWh" }],
    draw: function (c, p, pr, st, o) {
      plate(c, 96, 104, "#f3f1ea", "#8d99a3");
      var left = st.credit == null ? pr.credit : st.credit;
      lcd(c, 10, 16, 76, 40, [(st.kwh || 0).toFixed(3) + " kWh", pr.prepaid ? "credit " + left.toFixed(2) : watts(st.p || 0)], o.on && !st.cut);
      for (var i = 0; i < 12; i++) { rr(c, 18 + (i % 4) * 16, 62 + Math.floor(i / 4) * 10, 12, 7, 1.5); c.fillStyle = "#c9cfd4"; c.fill(); }
      led(c, 84, 96, st.cut ? RED : GREEN, o.on);
    }
  });
  def("changeover", {
    name: "Changeover switch", ref: "CO", cat: "Switching & distribution", w: 120, h: 96, price: function (p) { return p.auto ? 9500 : 2200; },
    blurb: "Picks ONE source — grid or generator — and makes it impossible to join the two.",
    terms: [["AL", "L", "t", 0.14], ["AN", "N", "t", 0.34], ["BL", "L", "t", 0.66], ["BN", "N", "t", 0.86], ["L", "L", "b", 0.35], ["N", "N", "b", 0.65]],
    props: { pos: 1, auto: false },
    spec: [{ k: "auto", label: "Automatic (ATS)", type: "bool", live: true }, { k: "pos", label: "Position", type: "select", options: [[1, "I — source A"], [0, "0 — off"], [2, "II — source B"]], live: true }],
    draw: function (c, p, pr, st) {
      var pos = pr.auto && st.pos != null ? st.pos : pr.pos;
      plate(c, 120, 96, "#e9edf0", "#8d99a3");
      tx(c, "A", 29, 14, 9, "#51606b"); tx(c, "B", 91, 14, 9, "#51606b");
      c.save(); c.translate(60, 50); c.rotate(pos === 1 ? -0.7 : pos === 2 ? 0.7 : 0);
      rr(c, -7, -24, 14, 34, 4); c.fillStyle = pos ? "#c0392b" : "#58636c"; c.fill(); c.restore();
      tx(c, pr.auto ? "AUTO" : "MANUAL", 60, 72, 8, "#51606b");
      tx(c, pos === 1 ? "I" : pos === 2 ? "II" : "0", 60, 85, 10, "#1b242c");
    }
  });
  def("bar", {
    name: "Terminal bar", ref: "B", cat: "Switching & distribution", w: 168, h: 24, price: 350,
    blurb: "One piece of brass with eight screws: everything on it is joined.",
    terms: function (pr) {
      var k = pr.role || "X", out = [];
      for (var i = 0; i < 4; i++) { out.push({ n: String(i + 1), k: k, side: "t", x: 24 + i * 40, y: 0 }); out.push({ n: String(i + 5), k: k, side: "b", x: 24 + i * 40, y: 24 }); }
      return out;
    },
    props: { role: "N" },
    spec: [{ k: "role", label: "Used for", type: "select", options: [["L", "Live busbar"], ["N", "Neutral bar"], ["PE", "Earth bar"], ["P", "DC positive"], ["M", "DC negative"]] }],
    draw: function (c, p, pr) {
      var col = { L: "#9a5a2e", N: "#2f6fb5", PE: "#4f9a3a", P: "#b8442f", M: "#2b2f36" }[pr.role] || "#8d99a3";
      rr(c, 0, 4, 168, 16, 3); c.fillStyle = "#c9a85a"; c.fill(); c.strokeStyle = col; c.lineWidth = 2.5; c.stroke();
      for (var i = 0; i < 4; i++) { c.beginPath(); c.arc(24 + i * 40, 12, 3.4, 0, TAU); c.fillStyle = "#6e5a2a"; c.fill(); }
      tx(c, { L: "L", N: "N", PE: "PE", P: "+", M: "−" }[pr.role] || "", 6, 12, 8, col);
    }
  });
  def("switch1", {
    name: "Light switch", ref: "SW", cat: "Switching & distribution", w: 44, h: 52, price: 90,
    blurb: "Breaks the live wire to a lamp. Never the neutral.",
    terms: [["in", "X", "t", 0.5], ["out", "X", "b", 0.5]],
    props: { on: false }, spec: [{ k: "on", label: "Switched on", type: "bool", live: true }],
    draw: function (c, p, pr) {
      plate(c, 44, 52, "#f4f6f7", "#8d99a3", 5);
      rr(c, 13, 12, 18, 28, 3); c.fillStyle = "#dfe5e9"; c.fill(); c.strokeStyle = "#a8b3bc"; c.stroke();
      c.fillStyle = pr.on ? "#2f7d4f" : "#a8b3bc"; c.fillRect(15, pr.on ? 14 : 26, 14, 12);
    }
  });
  def("switch2", {
    name: "Two-way switch", ref: "SW", cat: "Switching & distribution", w: 56, h: 56, price: 130,
    blurb: "Two of these, one at each end of a corridor, switch one lamp from either end.",
    terms: [["C", "X", "t", 0.5], ["L1", "X", "b", 0.25], ["L2", "X", "b", 0.75]],
    props: { pos: 0 }, spec: [{ k: "pos", label: "Position", type: "select", options: [[0, "Common to L1"], [1, "Common to L2"]], live: true }],
    draw: function (c, p, pr) {
      plate(c, 56, 56, "#f4f6f7", "#8d99a3", 5);
      c.strokeStyle = "#1b242c"; c.lineWidth = 2.5; c.beginPath(); c.moveTo(28, 10); c.lineTo(pr.pos ? 42 : 14, 44); c.stroke();
      [[28, 10], [14, 46], [42, 46]].forEach(function (q) { c.beginPath(); c.arc(q[0], q[1], 3, 0, TAU); c.fillStyle = "#8a6d2a"; c.fill(); });
    }
  });
  def("photocell", {
    name: "Dusk-to-dawn sensor", ref: "PC", cat: "Switching & distribution", w: 60, h: 60, price: 450,
    blurb: "Switches a light on by itself when the sun goes down.",
    terms: [["L", "L", "t", 0.3], ["N", "N", "t", 0.7], ["OUT", "L", "b", 0.5]],
    props: {}, spec: [],
    draw: function (c, p, pr, st, o) {
      plate(c, 60, 60, "#3b4149", "#1b2026", 30);
      c.beginPath(); c.arc(30, 30, 13, 0, TAU); c.fillStyle = st.closed && o.on ? "#ffd36b" : "#7a8791"; c.fill();
      tx(c, st.closed ? "night" : "day", 30, 30, 8, "#1b242c");
    }
  });

  /* =============================================================== loads */

  var LOAD_FAULTS = { k: "fault", label: "Fault", type: "select", options: [["none", "Healthy"], ["leak", "Live touching the metal case"], ["short", "Short circuit inside"], ["open", "Burnt out (open circuit)"]], teacher: true };
  def("lamp", {
    name: "Lamp", ref: "H", cat: "Loads", w: 56, h: 70, price: function (p) { return 60 + p.watts * 4; },
    blurb: "A mains light. Nine watts of LED gives the light of an old sixty-watt bulb.",
    terms: [["L", "L", "t", 0.3], ["N", "N", "t", 0.7]],
    props: { watts: 9, qty: 1, hours: 5, fault: "none" },
    spec: [{ k: "watts", label: "Each lamp", type: "select", options: [[5, "5 W LED"], [9, "9 W LED"], [15, "15 W LED"], [20, "20 W tube"], [40, "40 W floodlight"], [60, "60 W filament"], [100, "100 W floodlight"]] },
           { k: "qty", label: "How many on this point", type: "num", min: 1, max: 40 }, { k: "hours", label: "Hours a day", type: "num", min: 0, max: 24, step: 0.5 }, LOAD_FAULTS],
    draw: function (c, p, pr, st, o) {
      var b = o.on ? W.clamp(st.b || 0, 0, 1.3) : 0;
      if (b > 0.05) { var g = c.createRadialGradient(28, 40, 4, 28, 40, 44); g.addColorStop(0, "rgba(255,225,140," + 0.55 * b + ")"); g.addColorStop(1, "rgba(255,225,140,0)"); c.fillStyle = g; c.fillRect(-20, -8, 96, 96); }
      c.beginPath(); c.arc(28, 42, 17, 0, TAU); c.fillStyle = b > 0.05 ? "rgb(255," + Math.round(215 + 30 * Math.min(1, b)) + "," + Math.round(120 + 100 * Math.min(1, b)) + ")" : "#59636b"; c.fill();
      c.strokeStyle = "#2b3238"; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = "#9aa6b0"; c.fillRect(20, 14, 16, 12);
      tx(c, (pr.qty > 1 ? pr.qty + "×" : "") + pr.watts + "W", 28, 43, 8.5, b > 0.05 ? "#5a3b00" : "#dfe8ee");
    }
  });
  function applianceOf(pr) { return W.APPLIANCES[pr.app] || W.APPLIANCES.custom; }
  W.loadSpec = function (pr) {
    var a = applianceOf(pr), custom = pr.app === "custom";
    return { name: custom && pr.label ? pr.label : a.name, watts: custom ? +pr.watts || 0 : a.watts, pf: a.pf, surge: a.surge, duty: a.duty, earth: !!a.earth,
             hours: pr.hours == null || pr.hours < 0 ? a.hours : +pr.hours };
  };
  var APP_OPTS = Object.keys(W.APPLIANCES).map(function (k) { return [k, W.APPLIANCES[k].name + (W.APPLIANCES[k].watts ? " · " + W.APPLIANCES[k].watts + " W" : "")]; });
  var LOAD_SPEC = [{ k: "on", label: "Switched on", type: "bool", live: true }, { k: "app", label: "What is plugged in", type: "select", options: APP_OPTS },
    { k: "watts", label: "Watts (for “something else”)", type: "num", min: 0, max: 20000, unit: "W", when: function (pr) { return pr.app === "custom"; } },
    { k: "label", label: "Its name", type: "text", when: function (pr) { return pr.app === "custom"; } },
    { k: "hours", label: "Hours a day (−1 = typical)", type: "num", min: -1, max: 24, step: 0.5 }, LOAD_FAULTS];
  function drawLoad(sock) {
    return function (c, p, pr, st, o) {
      var w = sock ? 72 : 90, h = sock ? 80 : 84, s = W.loadSpec(pr), run = o.on && st.run;
      plate(c, w, h, sock ? "#f4f6f7" : "#dfe5e9", "#8d99a3", 6);
      if (sock) {
        c.fillStyle = "#3b4149"; rr(c, 22, 20, 8, 5, 1); c.fill(); rr(c, 42, 20, 8, 5, 1); c.fill(); rr(c, 33, 10, 6, 9, 1); c.fill();
      }
      var y = sock ? 44 : 34;
      if (pr.app === "none") tx(c, "empty", w / 2, y, 9, "#8d99a3");
      else {
        if (/fan/.test(pr.app)) {
          c.save(); c.translate(w / 2, y); c.rotate(run ? o.t * 9 : 0.4); c.fillStyle = run ? "#2a6fb0" : "#7a8791";
          for (var i = 0; i < 3; i++) { c.rotate(TAU / 3); c.beginPath(); c.ellipse(0, -8, 4, 9, 0, 0, TAU); c.fill(); }
          c.restore();
        } else { rr(c, w / 2 - 14, y - 11, 28, 22, 4); c.fillStyle = run ? "#2a6fb0" : pr.on ? "#8d99a3" : "#b9c2c9"; c.fill(); tx(c, s.watts >= 1000 ? (s.watts / 1000) + "k" : String(s.watts), w / 2, y, 9, "#fff"); }
        tx(c, s.name.length > 15 ? s.name.slice(0, 14) + "…" : s.name, w / 2, h - 22, 8, "#1b242c");
        tx(c, !o.on ? s.watts + " W" : run ? watts(st.p || 0) : st.idle ? "resting" : pr.on ? "no power" : "off", w / 2, h - 10, 8, run ? "#1f6a3f" : "#7a8791");
      }
      if (st.touch > 50 && o.on) { c.strokeStyle = RED; c.lineWidth = 3; c.setLineDash([5, 4]); rr(c, -3, -3, w + 6, h + 6, 8); c.stroke(); c.setLineDash([]); tx(c, "⚠ CASE LIVE", w / 2, -10, 9, "#ff8a7a"); }
    };
  }
  def("socket", {
    name: "Socket outlet", ref: "X", cat: "Loads", w: 72, h: 80, price: 180,
    blurb: "A 13 A socket with something plugged into it. Pick what from the list.",
    terms: [["L", "L", "t", 0.2], ["N", "N", "t", 0.5], ["PE", "PE", "t", 0.8]],
    props: { app: "led_tv", on: true, watts: 100, label: "", hours: -1, fault: "none" }, spec: LOAD_SPEC, draw: drawLoad(true)
  });
  def("load", {
    name: "Fixed appliance", ref: "A", cat: "Loads", w: 90, h: 84, price: 0,
    blurb: "Something wired in for good: a pump, a water heater, an air conditioner.",
    terms: [["L", "L", "t", 0.2], ["N", "N", "t", 0.5], ["PE", "PE", "t", 0.8]],
    props: { app: "pump", on: true, watts: 100, label: "", hours: -1, fault: "none" }, spec: LOAD_SPEC, draw: drawLoad(false)
  });
  def("dcload", {
    name: "DC appliance", ref: "D", cat: "Loads", w: 84, h: 74, price: 0,
    blurb: "Runs straight from the battery: no inverter, nothing wasted converting.",
    terms: [["+", "P", "t", 0.3], ["-", "M", "t", 0.7]],
    props: { app: "lamp", volts: 12, watts: 20, qty: 1, on: true, hours: 5 },
    spec: [{ k: "on", label: "Switched on", type: "bool", live: true }, { k: "app", label: "What it is", type: "select", options: Object.keys(W.DC_LOADS).map(function (k) { return [k, W.DC_LOADS[k].name + " · " + W.DC_LOADS[k].watts + " W"]; }) },
           { k: "watts", label: "Watts (for “something else”)", type: "num", min: 0, max: 2000, when: function (pr) { return pr.app === "custom"; } },
           { k: "qty", label: "How many", type: "num", min: 1, max: 40 }, { k: "volts", label: "Made for", type: "select", options: VDC }, { k: "hours", label: "Hours a day", type: "num", min: 0, max: 24, step: 0.5 }],
    draw: function (c, p, pr, st, o) {
      var d = W.DC_LOADS[pr.app] || W.DC_LOADS.custom, w = (pr.app === "custom" ? +pr.watts || 0 : d.watts) * (pr.qty || 1), run = o.on && st.run;
      plate(c, 84, 74, "#26323b", "#51697a", 6);
      c.beginPath(); c.arc(42, 30, 13, 0, TAU); c.fillStyle = run ? "#ffd36b" : "#59636b"; c.fill();
      tx(c, String(w), 42, 30, 9, run ? "#5a3b00" : "#dfe8ee");
      tx(c, (pr.qty > 1 ? pr.qty + "× " : "") + d.name, 42, 52, 8, "#dfe8ee");
      tx(c, o.on ? (run ? watts(st.p || 0) : st.over ? "OVER-VOLTAGE!" : "off") : pr.volts + " V DC", 42, 64, 8, st.over ? "#ff8a7a" : "#8b9aa8");
    }
  });
  W.dcWatts = function (pr) { var d = W.DC_LOADS[pr.app] || W.DC_LOADS.custom; return (pr.app === "custom" ? +pr.watts || 0 : d.watts) * (+pr.qty || 1); };

  /* =============================================================== notes */

  def("room", {
    name: "Room outline", ref: "RM", cat: "Notes", price: 0,
    blurb: "A dashed outline with a name, to lay a plan out like the building it is for.",
    size: function (pr) { return { w: +pr.w || 300, h: +pr.h || 220 }; },
    terms: [], props: { w: 300, h: 220, label: "Room" }, back: true,
    spec: [{ k: "label", label: "Name", type: "text" }, { k: "w", label: "Width", type: "num", min: 80, max: 2400, step: 20 }, { k: "h", label: "Height", type: "num", min: 60, max: 1800, step: 20 }],
    draw: function (c, p, pr, st, o) {
      c.setLineDash([9, 7]); c.strokeStyle = "rgba(232,238,244,.34)"; c.lineWidth = 1.5; rr(c, 0, 0, o.w, o.h, 10); c.stroke(); c.setLineDash([]);
      c.fillStyle = "rgba(232,238,244,.035)"; c.fill();
      tx(c, pr.label || "", 12, 14, 11, "rgba(232,238,244,.6)", "left");
    }
  });
  def("label", {
    name: "Note", ref: "T", cat: "Notes", price: 0,
    blurb: "Words on the plan.",
    size: function (pr) { return { w: Math.max(60, String(pr.text || "").length * 7.2 + 20), h: 28 }; },
    terms: [], props: { text: "Note" }, spec: [{ k: "text", label: "Text", type: "text" }],
    draw: function (c, p, pr, st, o) { rr(c, 0, 0, o.w, o.h, 6); c.fillStyle = "rgba(255,211,107,.12)"; c.fill(); c.strokeStyle = "rgba(255,211,107,.5)"; c.lineWidth = 1; c.stroke(); tx(c, pr.text || "", 10, 14, 11, "#ffd36b", "left"); }
  });

  W.CATS = ["Supply", "Solar", "Storage & conversion", "Protection", "Switching & distribution", "Loads", "Notes"];
  W.KIND_COLOR = { L: "#a9683a", N: "#3f86d6", PE: "#7fbf5f", P: "#e0553f", M: "#20262c", X: "#9aa6b0" };
  W.priceOf = function (doc, part) {
    var d = W.def(part), own = doc.prices && doc.prices[part.type];
    if (own != null && isFinite(own)) return +own;
    return d ? (typeof d.price === "function" ? d.price(W.propsOf(part)) : d.price || 0) : 0;
  };
})(typeof window !== "undefined" ? window : globalThis);
