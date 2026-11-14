/* Chalk Power Lab — core.
 *
 * The Circuit Lab next door works at the scale of a breadboard: milliamps,
 * five volts, an Arduino. This lab is the same idea one size up — the
 * wiring of a building and the solar system on its roof — where the
 * questions are different: will this cable overheat, will that breaker
 * trip, how many panels, how big a battery, will the fridge still be cold
 * at dawn.
 *
 *   ChalkPower.uid / clamp / esc / fmt     small helpers
 *   ChalkPower.SIZES, AMPACITY, wireR()    copper cable
 *   ChalkPower.PV, APPLIANCES              what can be bought and plugged in
 *   ChalkPower.blankDoc(), History, bus    the document and its plumbing
 *
 * The document is plain JSON, saved as-is:
 *   { v, parts:[{id,type,x,y,props,name}],
 *     wires:[{id,a:"partId:terminal",b,mm2,len}],
 *     site:{name,lat,tilt,az,month,cloud,dust}, clock, prices, view }
 * Nothing in this file touches the page, so it runs under Node for tests.
 */
(function (root) {
  "use strict";

  var W = root.ChalkPower = root.ChalkPower || {};

  W.uid = function (prefix) {
    var s = "", abc = "abcdefghijkmnpqrstuvwxyz23456789";
    for (var i = 0; i < 6; i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
    return (prefix || "x") + "_" + s;
  };
  W.clamp = function (v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; };
  W.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  };
  /* 1234.5 -> "1.23 k", 0.0042 -> "4.2 m": the way a meter writes a number. */
  W.fmt = function (v, unit, digits) {
    if (v == null || !isFinite(v)) return "—";
    var a = Math.abs(v), d = digits == null ? 3 : digits, pre = "", n = v;
    if (a >= 1e6) { n = v / 1e6; pre = "M"; }
    else if (a >= 1e3) { n = v / 1e3; pre = "k"; }
    else if (a > 0 && a < 1e-3) { n = v * 1e6; pre = "µ"; }
    else if (a > 0 && a < 1) { n = v * 1e3; pre = "m"; }
    var s = Math.abs(n) >= 100 ? n.toFixed(Math.max(0, d - 3)) : Math.abs(n) >= 10 ? n.toFixed(Math.max(0, d - 2)) : n.toFixed(Math.max(0, d - 1));
    return s + " " + pre + (unit || "");
  };
  W.money = function (v) { return "D " + Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); };

  /* ------------------------------------------------------------- cable */

  /* Copper, PVC insulated, clipped direct: the current a conductor of each
   * cross-section carries all day without its insulation ageing. */
  W.SIZES = [0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95];
  W.AMPACITY = { 0.75: 9, 1: 13, 1.5: 17.5, 2.5: 24, 4: 32, 6: 41, 10: 57, 16: 76, 25: 101, 35: 125, 50: 151, 70: 192, 95: 232 };
  W.RHO = 0.0175;                       /* ohm · mm² / m at 20 °C */
  W.wireR = function (w) { return Math.max(0.001, W.RHO * (+w.len || 1) / (+w.mm2 || 2.5)); };
  W.ampacity = function (mm2) { return W.AMPACITY[mm2] || 24 * Math.pow((+mm2 || 2.5) / 2.5, 0.62); };
  /* Smallest standard size that carries `amps` and loses no more than
   * `dropV` volts over `len` metres of single conductor. */
  W.sizeFor = function (amps, len, dropV) {
    for (var i = 0; i < W.SIZES.length; i++) {
      var s = W.SIZES[i];
      if (W.AMPACITY[s] >= amps * 1.25 && (!dropV || amps * W.RHO * len / s <= dropV)) return s;
    }
    return 95;
  };

  /* ----------------------------------------------------------- catalogue */

  /* Panels at standard test conditions (1000 W/m², 25 °C cell). */
  W.PV = {
    p20:  { name: "20 W (36-cell)",  wp: 20,  voc: 21.6, isc: 1.25, vmp: 17.8, imp: 1.13, price: 1400 },
    p50:  { name: "50 W (36-cell)",  wp: 50,  voc: 22.3, isc: 2.95, vmp: 18.2, imp: 2.75, price: 2800 },
    p100: { name: "100 W (36-cell)", wp: 100, voc: 22.8, isc: 5.75, vmp: 18.9, imp: 5.29, price: 4800 },
    p200: { name: "200 W (72-cell)", wp: 200, voc: 45.4, isc: 5.72, vmp: 37.6, imp: 5.32, price: 8500 },
    p330: { name: "330 W poly",      wp: 330, voc: 46.2, isc: 9.18, vmp: 37.8, imp: 8.73, price: 11500 },
    p450: { name: "450 W mono",      wp: 450, voc: 49.3, isc: 11.6, vmp: 41.5, imp: 10.85, price: 14500 },
    p550: { name: "550 W mono",      wp: 550, voc: 49.9, isc: 13.98, vmp: 41.96, imp: 13.11, price: 17500 }
  };

  /* watts running, power factor, start-up surge (× running), share of the
   * time a thermostat keeps it on, typical hours a day, earthed metal case. */
  W.APPLIANCES = {
    none:    { name: "Nothing plugged in", watts: 0, pf: 1, surge: 1, duty: 1, hours: 0 },
    phone:   { name: "Phone charger", watts: 10, pf: 0.6, surge: 1, duty: 1, hours: 3 },
    router:  { name: "Wi-Fi router", watts: 12, pf: 0.7, surge: 1, duty: 1, hours: 24 },
    led_tv:  { name: "LED TV 43\"", watts: 80, pf: 0.9, surge: 1.5, duty: 1, hours: 5 },
    decoder: { name: "Satellite decoder", watts: 20, pf: 0.7, surge: 1, duty: 1, hours: 5 },
    laptop:  { name: "Laptop", watts: 65, pf: 0.9, surge: 1, duty: 1, hours: 6 },
    desktop: { name: "Desktop computer", watts: 200, pf: 0.92, surge: 1.5, duty: 1, hours: 8 },
    printer: { name: "Laser printer", watts: 450, pf: 0.95, surge: 2, duty: 0.2, hours: 2, earth: true },
    fan:     { name: "Standing fan", watts: 60, pf: 0.85, surge: 2.5, duty: 1, hours: 8 },
    ceiling_fan: { name: "Ceiling fan", watts: 75, pf: 0.85, surge: 2.5, duty: 1, hours: 10 },
    fridge:  { name: "Fridge", watts: 150, pf: 0.75, surge: 5, duty: 0.4, hours: 24, earth: true },
    freezer: { name: "Chest freezer", watts: 200, pf: 0.75, surge: 5, duty: 0.45, hours: 24, earth: true },
    vaccine: { name: "Vaccine fridge", watts: 90, pf: 0.8, surge: 4, duty: 0.4, hours: 24, earth: true },
    kettle:  { name: "Electric kettle", watts: 2000, pf: 1, surge: 1, duty: 1, hours: 0.3, earth: true },
    iron:    { name: "Clothes iron", watts: 1200, pf: 1, surge: 1, duty: 0.6, hours: 0.5, earth: true },
    microwave: { name: "Microwave", watts: 1100, pf: 0.9, surge: 2, duty: 1, hours: 0.3, earth: true },
    blender: { name: "Blender", watts: 400, pf: 0.8, surge: 3, duty: 1, hours: 0.2 },
    washer:  { name: "Washing machine", watts: 500, pf: 0.7, surge: 4, duty: 1, hours: 1, earth: true },
    aircon:  { name: "Air conditioner 1 HP", watts: 900, pf: 0.85, surge: 4, duty: 0.6, hours: 6, earth: true },
    pump:    { name: "Water pump 0.5 HP", watts: 370, pf: 0.75, surge: 5, duty: 1, hours: 2, earth: true },
    borehole: { name: "Borehole pump 1 HP", watts: 750, pf: 0.78, surge: 5, duty: 1, hours: 4, earth: true },
    heater:  { name: "Water heater", watts: 1500, pf: 1, surge: 1, duty: 0.3, hours: 2, earth: true },
    sewing:  { name: "Sewing machine", watts: 100, pf: 0.8, surge: 3, duty: 0.6, hours: 6 },
    welder:  { name: "Small welder", watts: 3000, pf: 0.7, surge: 2, duty: 0.3, hours: 1, earth: true },
    cctv:    { name: "CCTV recorder + 4 cameras", watts: 40, pf: 0.8, surge: 1, duty: 1, hours: 24 },
    speaker: { name: "PA speaker", watts: 250, pf: 0.9, surge: 1.5, duty: 1, hours: 3 },
    custom:  { name: "Something else", watts: 100, pf: 0.9, surge: 1, duty: 1, hours: 4 }
  };
  W.DC_LOADS = {
    lamp: { name: "DC LED lamp", watts: 5 }, usb: { name: "USB charging hub", watts: 10 }, fan: { name: "DC fan", watts: 15 },
    tv: { name: "DC TV 24\"", watts: 30 }, fridge: { name: "DC fridge", watts: 50 }, router: { name: "Router (DC)", watts: 12 },
    radio: { name: "Radio", watts: 6 }, custom: { name: "Something else", watts: 20 }
  };

  /* ------------------------------------------------------------ document */

  W.blankDoc = function () {
    return {
      v: 1, parts: [], wires: [],
      site: { name: "Banjul", lat: 13.45, tilt: 15, az: 180, month: 3, cloud: -1, dust: 0, tamb: -1 },
      clock: 12, prices: {}, tariff: 13.5, view: { x: 0, y: 0, z: 1 }
    };
  };
  W.partById = function (doc, id) { for (var i = 0; i < doc.parts.length; i++) if (doc.parts[i].id === id) return doc.parts[i]; return null; };
  W.def = function (part) { return (W.PARTS && W.PARTS[part.type]) || null; };
  W.propsOf = function (part) {
    var d = W.def(part), out = {}, k, dflt = (d && d.props) || {}, own = part.props || {};
    for (k in dflt) out[k] = dflt[k];
    for (k in own) out[k] = own[k];
    return out;
  };
  W.termsOf = function (part) {
    var d = W.def(part);
    if (!d) return [];
    return typeof d.terms === "function" ? d.terms(W.propsOf(part)) : d.terms;
  };
  W.sizeOf = function (part) {
    var d = W.def(part);
    if (!d) return { w: 60, h: 60 };
    return typeof d.size === "function" ? d.size(W.propsOf(part)) : { w: d.w, h: d.h };
  };
  W.termPos = function (part, name) {
    var t = W.termsOf(part);
    for (var i = 0; i < t.length; i++) if (t[i].n === name) return { x: part.x + t[i].x, y: part.y + t[i].y, k: t[i].k, side: t[i].side };
    return null;
  };
  /* "R1", "Q3": a short name per part, numbered in the order they were added. */
  W.refs = function (doc) {
    var n = {}, out = {};
    doc.parts.forEach(function (p) { var d = W.def(p), pre = (d && d.ref) || "X"; n[pre] = (n[pre] || 0) + 1; out[p.id] = pre + n[pre]; });
    return out;
  };
  W.label = function (doc, part, refs) {
    var d = W.def(part);
    return (part.name || (d ? d.name : part.type)) + " (" + ((refs || W.refs(doc))[part.id] || "?") + ")";
  };

  var handlers = {};
  W.bus = {
    on: function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    emit: function (name, data) {
      (handlers[name] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) { if (root.console) console.error(e); } });
    }
  };

  /* Whole-document snapshots, as on the circuit bench: a plan is a few
   * kilobytes, and a stack of copies can never fall out of step. */
  function History(limit) { this.limit = limit || 60; this.past = []; this.future = []; }
  function strip(doc) { var c = {}; for (var k in doc) if (k !== "view") c[k] = doc[k]; return c; }
  History.prototype.push = function (doc) {
    var snap = JSON.stringify(strip(doc));
    if (this.past.length && this.past[this.past.length - 1] === snap) return;
    this.past.push(snap);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  };
  History.prototype.undo = function (doc) {
    if (!this.past.length) return null;
    this.future.push(JSON.stringify(strip(doc)));
    var d = JSON.parse(this.past.pop()); d.view = doc.view; return d;
  };
  History.prototype.redo = function (doc) {
    if (!this.future.length) return null;
    this.past.push(JSON.stringify(strip(doc)));
    var d = JSON.parse(this.future.pop()); d.view = doc.view; return d;
  };
  W.History = History;

  /* Just enough markdown for chat and reports. */
  W.md = function (s) {
    var esc = W.esc, out = "", list = null;
    String(s || "").split(/\n/).forEach(function (line) {
      var inl = esc(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/(^|\W)_(.+?)_(\W|$)/g, "$1<em>$2</em>$3");
      if (/^\s*(?:[-*•]|\d+[.)])\s+/.test(line)) {
        var tag = /^\s*\d/.test(line) ? "ol" : "ul";
        if (list !== tag) { if (list) out += "</" + list + ">"; out += "<" + tag + ">"; list = tag; }
        out += "<li>" + inl.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "") + "</li>";
        return;
      }
      if (list) { out += "</" + list + ">"; list = null; }
      if (/^#{1,3}\s/.test(line)) out += "<h4>" + inl.replace(/^#+\s/, "") + "</h4>";
      else if (line.trim()) out += "<p>" + inl + "</p>";
    });
    if (list) out += "</" + list + ">";
    return out;
  };
})(typeof window !== "undefined" ? window : globalThis);
