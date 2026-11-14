/* Chalk Power Lab — the test instruments.
 *
 * The tools an installer carries, each used the way the real one is:
 * a multimeter has two probes, a clamp goes round one cable, an insulation
 * tester is only for dead circuits and says so if you forget.
 *
 * Pick a tool from the Testers list, then click what you want to test.
 * Readings follow the simulator live.
 */
(function (root) {
  "use strict";

  var W = root.ChalkPower, esc = W.esc;

  var TOOLS = W.TOOLS = [
    { id: "volt", name: "Multimeter — volts", icon: "V", need: "term2", blurb: "Red probe, then black probe. AC or DC, it works it out." },
    { id: "clamp", name: "Clamp meter — amps", icon: "A", need: "wire", blurb: "Click a cable to clamp round it." },
    { id: "pen", name: "Voltage pen", icon: "⚡", need: "term1", blurb: "Touch a terminal: is it live?" },
    { id: "ohm", name: "Continuity / ohms", icon: "Ω", need: "term2", blurb: "Two probes on a DEAD circuit. Is there a path?" },
    { id: "megger", name: "Insulation tester (500 V)", icon: "MΩ", need: "term2", blurb: "Dead circuit only. Live to earth should be megohms." },
    { id: "socket", name: "Socket tester", icon: "⏚", need: "part", types: /^(socket|load)$/, blurb: "Click a socket: correct, no earth, or live and neutral swapped?" },
    { id: "earth", name: "Earth tester", icon: "E", need: "term1", blurb: "Click an earth terminal: resistance to the ground itself." },
    { id: "power", name: "Power analyser", icon: "W", need: "part", blurb: "Click any part: volts, amps, watts, power factor." },
    { id: "batt", name: "Battery tester", icon: "▮", need: "part", types: /^battery$/, blurb: "Click a battery: charge, voltage, health." },
    { id: "iv", name: "I-V curve tracer", icon: "⌒", need: "term2", blurb: "Plus then minus of a panel or string: its whole curve." },
    { id: "sun", name: "Irradiance meter", icon: "☀", need: "none", blurb: "How much sun is landing on the panels right now." },
    { id: "thermal", name: "Thermal camera", icon: "🌡", need: "none", blurb: "See what is running hot: thin cables, loose terminals, shaded cells." }
  ];

  function Testers(app, hud) {
    this.app = app; this.hud = hud; this.tool = null; this.probes = []; this.target = null; this.curve = null;
    var self = this;
    hud.addEventListener("click", function (e) {
      var b = e.target.closest("[data-m]"); if (!b) return;
      var k = b.getAttribute("data-m");
      if (k === "close") self.pick(null); else if (k === "clear") { self.probes = []; self.target = null; self.curve = null; self.render(true); } else if (k === "retrace") { self.curve = null; self.render(true); }
    });
  }
  W.Testers = Testers;

  Testers.prototype.pick = function (id) {
    var t = TOOLS.filter(function (q) { return q.id === id; })[0] || null;
    if (this.tool && t && this.tool.id === t.id) t = null;
    this.tool = t; this.probes = []; this.target = null; this.curve = null;
    this.app.view.thermal = !!t && t.id === "thermal";
    this.hud.hidden = !t;
    this.app.drawer();
    this.render(true);
  };

  Testers.prototype.hover = function () {};

  Testers.prototype.click = function (hit) {
    var t = this.tool, app = this.app;
    if (!t) return;
    if (t.need === "term2") {
      if (!hit || !hit.term) { app.toast("Put the probe on a terminal — one of the small round dots."); return; }
      if (this.probes.length >= 2) this.probes = [];
      this.probes.push(hit.term); this.curve = null;
    } else if (t.need === "term1") {
      if (!hit || !hit.term) { app.toast("Touch a terminal — one of the small round dots."); return; }
      this.probes = [hit.term];
    } else if (t.need === "wire") {
      if (!hit || !hit.wire) { app.toast("Click on a cable to clamp round it."); return; }
      this.target = hit.wire;
    } else if (t.need === "part") {
      var p = hit && hit.part ? W.partById(app.doc, hit.part) : null;
      if (!p || (t.types && !t.types.test(p.type))) { app.toast(t.blurb); return; }
      this.target = p.id;
    }
    this.render(true);
  };

  Testers.prototype.draw = function (c, view) {
    var t = this.tool, app = this.app; if (!t) return;
    this.probes.forEach(function (key, i) {
      var q = view.termXY(key); if (!q) return;
      var col = i ? "#111" : "#e23b2e";
      c.strokeStyle = col; c.lineWidth = 3; c.beginPath(); c.moveTo(q.x, q.y); c.lineTo(q.x + (i ? 16 : -16), q.y - 30); c.stroke();
      c.beginPath(); c.arc(q.x, q.y, 6, 0, Math.PI * 2); c.fillStyle = col; c.fill(); c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.stroke();
      c.fillStyle = "#fff"; c.font = "700 9px system-ui"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(i ? "−" : "+", q.x, q.y);
    });
    if (t.need === "wire" && this.target && view.routes[this.target]) {
      var pts = view.routes[this.target], m = pts[Math.floor(pts.length / 2)], k = pts[Math.floor(pts.length / 2) - 1], x = (m[0] + k[0]) / 2, y = (m[1] + k[1]) / 2;
      c.strokeStyle = "#f2b13a"; c.lineWidth = 5; c.beginPath(); c.arc(x, y, 13, 0.4, Math.PI * 2 - 0.4); c.stroke();
    }
    if (t.need === "part" && this.target) {
      var p = W.partById(app.doc, this.target);
      if (p) { var s = W.sizeOf(p); c.strokeStyle = "#f2b13a"; c.lineWidth = 2.5; W.draw.rr(c, p.x - 8, p.y - 8, s.w + 16, s.h + 16, 12); c.stroke(); }
    }
  };

  function live(app, keys) {
    if (!app.on) return false;
    return keys.some(function (k) { var v = app.sim.toEarth(k); return v != null && v > 5; }) || (keys.length === 2 && ((app.sim.volt(keys[0], keys[1]) || {}).mag || 0) > 1.5);
  }
  function big(v, unit, cls) { return '<div class="pw-read ' + (cls || "") + '">' + esc(v) + ' <small>' + esc(unit || "") + '</small></div>'; }
  function line(s, cls) { return '<p class="' + (cls || "") + '">' + s + '</p>'; }
  function num(v, d) { return !isFinite(v) ? "—" : Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 100 ? v.toFixed(d == null ? 1 : Math.min(d, 1)) : v.toFixed(d == null ? 2 : d); }

  Testers.prototype.read = function () {
    var t = this.tool, app = this.app, sim = app.sim, doc = app.doc, pr = this.probes, refs = app.refs, out = "";
    var tname = function (key) { var id = key.split(":")[0], p = W.partById(doc, id); return p ? esc((refs[id] || "") + " " + key.slice(id.length + 1)) : "?"; };
    var needOn = function () { return app.on ? "" : line("Switch the power on to take a live reading.", "hint"); };
    switch (t.id) {
      case "volt":
        if (pr.length < 2) return line(pr.length ? "Now the black probe." : "Red probe first: click a terminal.", "hint");
        if (!app.on) return big("0.00", "V") + needOn();
        var v = sim.volt(pr[0], pr[1]); if (!v) return line("Those terminals are gone.", "hint");
        out = v.ac ? big(num(v.mag, 1), "V ~ AC") : big((v.re < -0.005 ? "−" : "") + num(Math.abs(v.re), 2), "V ⎓ DC");
        out += line(tname(pr[0]) + " → " + tname(pr[1]));
        if (!v.ac && v.re < -0.5) out += line("Negative: the probes are the other way round to the polarity.", "warn");
        if (v.ac && v.mag > 300) out += line("That is two different phases: 400 V between them.", "warn");
        return out;
      case "clamp":
        if (!this.target) return line("Click a cable.", "hint");
        var w = doc.wires.filter(function (q) { return q.id === this.target; }, this)[0], ws = sim.wstate[this.target];
        if (!w) return line("That cable is gone.", "hint");
        if (!app.on || !ws) return big("0.00", "A") + needOn();
        var iz = W.ampacity(w.mm2);
        out = big(num(ws.mag, 2), "A") + line(w.mm2 + " mm² · " + w.len + " m · good for " + iz.toFixed(0) + " A (" + Math.round(100 * ws.mag / iz) + "% used)", ws.mag > iz ? "bad" : "");
        out += line("Loses " + num(ws.drop, 2) + " V and " + num(ws.loss, 1) + " W along its length.");
        if (ws.burnt) out += line("This cable has burnt through.", "bad");
        return out;
      case "pen":
        if (!pr.length) return line("Touch a terminal.", "hint");
        var ve = app.on ? sim.toEarth(pr[0]) : 0, isl = app.on && sim.isl ? sim.isl(sim.node(pr[0])) : null, ac = isl && isl.ac.length;
        return (ve > 50 && ac ? big("LIVE", num(ve, 0) + " V to earth", "bad") + line("Do not touch. Isolate and lock off before working.", "bad")
          : ve > 50 ? big("DC", num(ve, 0) + " V to earth", "warn") + line("A voltage pen only sings for AC; a meter shows this DC.", "hint")
          : big("dead", "", "ok") + line(app.on ? "Nothing here now — prove it with a meter before you trust it." : "The power is off.", "hint")) + line(tname(pr[0]));
      case "ohm": case "megger":
        if (pr.length < 2) return line(pr.length ? "Now the second probe." : "First probe: click a terminal.", "hint");
        if (live(app, pr)) return big("LIVE!", "", "bad") + line("There is voltage here. " + (t.id === "megger" ? "An insulation tester puts 500 V into a dead circuit — on a live one it is destroyed, or you are." : "An ohmmeter only works on a dead circuit.") + " Switch off and isolate first.", "bad");
        var r = sim.deadR(pr[0], pr[1]);
        if (r == null) return line("Those terminals are gone.", "hint");
        if (t.id === "ohm") {
          out = r > 2e6 ? big("OL", "open circuit") : big(r < 1000 ? num(r, 2) : num(r / 1000, 2), r < 1000 ? "Ω" : "kΩ", r < 2 ? "ok" : "");
          out += line(r < 2 ? "♪ Continuity: these two points are joined." : r > 2e6 ? "No path between them." : "A path through a load or a poor joint.");
        } else {
          var mo = r / 1e6;
          out = mo > 200 ? big("> 200", "MΩ", "ok") : big(mo < 0.01 ? num(r / 1000, 1) + " k" : num(mo, 2), mo < 0.01 ? "Ω" : "MΩ", mo >= 1 ? "ok" : "bad");
          out += line(mo >= 1 ? "Pass: at least 1 MΩ is required." : "FAIL: under 1 MΩ. Either the insulation has broken down, or there is still a load connected between these two points (unplug things and test again).", mo >= 1 ? "ok" : "bad");
        }
        return out + line(tname(pr[0]) + " ↔ " + tname(pr[1]));
      case "earth":
        if (!pr.length) return line("Click an earth terminal.", "hint");
        var re = sim.dirty ? null : sim.deadR(pr[0], "earth");
        if (re == null) { sim.index(); re = sim.deadR(pr[0], "earth"); }
        return (re > 1e6 ? big("OL", "not earthed", "bad") : big(num(re, 1), "Ω", re <= 10 ? "ok" : re <= 100 ? "warn" : "bad")) +
          line(re > 1e6 ? "This point has no connection to the ground at all." : re <= 10 ? "Good: under 10 Ω." : re <= 100 ? "Usable with an RCD, but poor. A fault of 30 mA would lift everything earthed to " + (0.03 * re).toFixed(1) + " V." : "Too high to rely on.") + line(tname(pr[0]));
      case "socket":
        if (!this.target) return line("Click a socket.", "hint");
        if (!app.on) return lamps(0, 0, 0) + needOn();
        var id = this.target, ln = (sim.volt(id + ":L", id + ":N") || {}).mag || 0, le = sim.toEarth(id + ":L") || 0, ne = sim.toEarth(id + ":N") || 0, rpe = sim.deadR(id + ":PE", "earth");
        var pe = rpe != null && rpe < 1667, verdict, cls = "bad";
        if (ln < 50) { verdict = le > 150 ? "Live present, NEUTRAL MISSING. Dangerous: everything on this circuit sits at mains voltage." : "Dead: no supply here."; return lamps(le > 150, 0, 0) + line(verdict, "bad"); }
        if (ne > 150 && le < 80) verdict = "LIVE AND NEUTRAL REVERSED. It works, but the switch now breaks the neutral and the lampholder stays live.";
        else if (!pe) verdict = "NO EARTH. The socket works, and gives no protection at all if a metal case becomes live.";
        else { verdict = "Correct: live, neutral and earth all where they should be."; cls = "ok"; }
        return lamps(1, pe, !(ne > 150 && le < 80)) + line(verdict, cls) + line(num(ln, 0) + " V · earth path " + (pe ? num(rpe, 1) + " Ω" : "open"));
      case "power":
        if (!this.target) return line("Click a part.", "hint");
        var p = W.partById(doc, this.target), st = sim.state[this.target] || {};
        if (!p) return line("That part is gone.", "hint");
        if (!app.on) return big("0", "W") + needOn();
        var P = st.p != null ? st.p : st.pac != null ? st.pac : st.pin, rows = [];
        out = big(P == null ? "—" : Math.abs(P) >= 1000 ? num(P / 1000, 2) : num(P, 0), P != null && Math.abs(P) >= 1000 ? "kW" : "W");
        if (st.v != null) rows.push("Voltage " + num(st.v, 1) + " V");
        if (st.i != null) rows.push("Current " + num(Math.abs(st.i), 2) + " A"); else if (st.v > 1 && st.va) rows.push("Current " + num(st.va / st.v, 2) + " A");
        if (st.va > 0 && st.p != null) rows.push("Apparent " + num(st.va, 0) + " VA · power factor " + num(st.p / st.va, 2));
        if (st.s != null && st.pac != null) rows.push("Load " + num(st.s, 0) + " VA of " + W.propsOf(p).va);
        if (st.kwh != null) rows.push("Energy " + st.kwh.toFixed(3) + " kWh");
        if (st.imax != null) rows.push("Through it " + num(st.imax, 2) + " A" + (W.propsOf(p).amps ? " of " + W.propsOf(p).amps + " A" : ""));
        if (st.res != null) rows.push("Leakage " + num(st.res * 1000, 1) + " mA");
        if (st.ph) rows.push("L1 " + num(st.ph[0] || 0, 1) + " A · L2 " + num(st.ph[1] || 0, 1) + " A · L3 " + num(st.ph[2] || 0, 1) + " A · neutral " + num(st.inn || 0, 1) + " A");
        return out + rows.map(function (s) { return line(esc(s)); }).join("") + line(esc(W.label(doc, p, refs)), "hint");
      case "batt":
        if (!this.target) return line("Click a battery.", "hint");
        var b = W.partById(doc, this.target), bs = sim.state[this.target] || {}, bp = b ? W.propsOf(b) : null;
        if (!b) return line("That battery is gone.", "hint");
        var soc = bs.soc == null ? bp.soc / 100 : bs.soc;
        out = big(Math.round(soc * 100), "% charged", soc > 0.5 ? "ok" : soc > 0.25 ? "warn" : "bad");
        out += line((bs.v == null ? "—" : num(bs.v, 2)) + " V · " + (bs.i > 0.05 ? "giving " : bs.i < -0.05 ? "taking " : "") + num(Math.abs(bs.i || 0), 1) + " A");
        out += line("Holds " + num(bp.volts * bp.ah * soc / 1000, 2) + " kWh of " + num(bp.volts * bp.ah / 1000, 2) + " kWh");
        if (bs.low != null) out += line("Lowest it has been: " + Math.round(bs.low * 100) + "%" + (bp.chem !== "lfp" && bs.low < 0.5 ? " — too deep for lead-acid." : ""), bp.chem !== "lfp" && bs.low < 0.5 ? "warn" : "");
        return out;
      case "sun":
        var e = sim.env, sp = W.Sun.at(doc.site, app.clock);
        return big(num(e.G, 0), "W/m²", e.G > 600 ? "ok" : "") + line("Sun " + (sp.el > 0 ? num(sp.el, 0) + "° above the horizon, bearing " + num(sp.az, 0) + "°" : "below the horizon")) +
          line("Air " + num(e.tamb, 0) + " °C · cells about " + num(e.tamb + e.G / 800 * 25, 0) + " °C") + line("A panel's rating assumes 1000 W/m² and 25 °C cells: a cool, clear noon.", "hint");
      case "thermal":
        return line("Blue is cool, red is hot. Look for a cable that glows where its neighbours do not, a terminal brighter than the breaker beside it, and one panel hotter than the rest.") + needOn();
      case "iv":
        if (pr.length < 2) return line(pr.length ? "Now the minus end." : "Click the PLUS end of a panel or string.", "hint");
        if (!this.curve) { if (sim.dirty) sim.index(); this.curve = sim.trace(pr[0], pr[1], 70); }
        var cv = this.curve;
        if (cv.length < 3) return line((app.sim.env.G < 5 ? "No curve: it is dark. Move the clock to daytime and trace again." : "No curve: there are no panels between those two points, or they are the wrong way round."), "bad") + '<button type="button" data-m="clear">Start again</button>';
        var isc = cv[0].i, voc = cv[cv.length - 1].v, mp = cv[0];
        cv.forEach(function (q) { if (q.v * q.i > mp.v * mp.i) mp = q; });
        var ff = mp.v * mp.i / (isc * voc || 1), now = app.on ? sim.volt(pr[0], pr[1]) : null;
        out = '<canvas class="pw-iv" width="300" height="150"></canvas>' + big(num(mp.v * mp.i, 0), "W at the best point");
        out += line("Isc " + num(isc, 2) + " A · Voc " + num(voc, 1) + " V · Vmp " + num(mp.v, 1) + " V · Imp " + num(mp.i, 2) + " A");
        out += line("Fill factor " + num(ff, 2) + (ff < 0.62 ? " — low. A stepped curve means some panels are shaded or mismatched and their bypass diodes are working." : ""), ff < 0.62 ? "warn" : "");
        if (now) out += line("Working now at " + num(now.re, 1) + " V" + (Math.abs(now.re - mp.v) < 0.06 * voc ? " — right on the best point." : now.re < mp.v ? " — below the best point (a PWM controller holds it down here)." : " — above the best point (the controller is holding back)."));
        this.plot = { cv: cv, mp: mp, now: now ? now.re : null, isc: isc, voc: voc };
        return out + '<button type="button" data-m="retrace">Trace again</button>';
    }
    return "";
  };

  function lamps(a, b, c2) {
    var l = function (on, col) { return '<i class="pw-lamp" style="background:' + (on ? col : "#2b3640") + ';box-shadow:' + (on ? "0 0 10px " + col : "none") + '"></i>'; };
    return '<div class="pw-lamps">' + l(a, "#ff5a4a") + l(b, "#ffb53a") + l(c2, "#5bd88a") + '<span>supply · earth · polarity</span></div>';
  }

  Testers.prototype.render = function (force) {
    var t = this.tool;
    if (!t) { this.hud.hidden = true; return; }
    var now = Date.now();
    if (!force && now - (this.last || 0) < 220) return;
    this.last = now;
    if (t.id === "iv" && !force && this.curve) { this.paintIV(); return; }
    this.plot = null;
    var body = this.read();
    this.hud.innerHTML = '<header><b>' + esc(t.icon) + '</b><span>' + esc(t.name) + '</span>' + (this.probes.length || this.target ? '<button type="button" data-m="clear" title="Take the probes off">Clear</button>' : '') +
      '<button type="button" data-m="close" aria-label="Put the tool away">×</button></header><div class="pw-meter-body">' + body + '</div>';
    this.paintIV();
  };

  Testers.prototype.paintIV = function () {
    var cv = this.hud.querySelector(".pw-iv"), pl = this.plot;
    if (!cv || !pl) return;
    var c = cv.getContext("2d"), Wd = cv.width, H = cv.height, L = 30, B = 20, x = function (v) { return L + (Wd - L - 8) * v / (pl.voc * 1.03); }, y = function (i) { return H - B - (H - B - 8) * i / (pl.isc * 1.1); };
    c.clearRect(0, 0, Wd, H); c.fillStyle = "#0f1820"; c.fillRect(0, 0, Wd, H);
    c.strokeStyle = "rgba(255,255,255,.12)"; c.lineWidth = 1; c.beginPath(); c.moveTo(L, 6); c.lineTo(L, H - B); c.lineTo(Wd - 6, H - B); c.stroke();
    var pm = pl.mp.v * pl.mp.i;
    c.strokeStyle = "rgba(125,255,176,.55)"; c.lineWidth = 1.5; c.beginPath();
    pl.cv.forEach(function (q, k) { var yy = H - B - (H - B - 8) * (q.v * q.i) / (pm * 1.1); if (k) c.lineTo(x(q.v), yy); else c.moveTo(x(q.v), yy); }); c.stroke();
    c.strokeStyle = "#ffd36b"; c.lineWidth = 2; c.beginPath();
    pl.cv.forEach(function (q, k) { if (k) c.lineTo(x(q.v), y(q.i)); else c.moveTo(x(q.v), y(q.i)); }); c.stroke();
    c.fillStyle = "#ff8a5a"; c.beginPath(); c.arc(x(pl.mp.v), y(pl.mp.i), 4, 0, Math.PI * 2); c.fill();
    if (pl.now != null && pl.now > 0) { c.strokeStyle = "#7fc8ff"; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x(pl.now), 6); c.lineTo(x(pl.now), H - B); c.stroke(); c.setLineDash([]); }
    c.fillStyle = "rgba(232,238,244,.7)"; c.font = "9px system-ui"; c.textAlign = "left"; c.fillText("A", 4, 12); c.textAlign = "right"; c.fillText("V", Wd - 6, H - 6);
    c.textAlign = "left"; c.fillStyle = "#ffd36b"; c.fillText("current", L + 6, 16); c.fillStyle = "rgba(125,255,176,.9)"; c.fillText("power", L + 56, 16);
  };

  Testers.prototype.tick = function () { if (this.tool) this.render(false); };
})(typeof window !== "undefined" ? window : globalThis);
