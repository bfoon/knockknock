/* Chalk Circuit Lab — the part designer.
 *
 * Make any part you can solder, and use it everywhere:
 *
 *   footprint  from a package family and a few numbers (DIP, SOIC, QFN,
 *              QFP, SOT, TO-220, 0805, headers, JST, screw terminals, USB-C,
 *              HDMI, RJ45, barrel jacks…), from a few words ("qfn 32 5x5"),
 *              from the library, or from a KiCad .kicad_mod. Then drag pads
 *              about, add pads and holes, change any number.
 *   pins       a name and a kind for every pin
 *   behaviour  how it acts in a circuit, in a few lines (lab_behave.js),
 *              from a template, by hand, or written by the AI
 *   bench      its name, value, look and colour, and the drawer category it
 *              goes in — Chips, Sensors, Power, or one of your own
 *   try it     a little test bench: power it, drive its inputs, read every pin
 *
 * Saved parts go in your library (on the server when there is one, in the
 * browser otherwise) and a copy rides along inside every circuit that uses
 * one, so a shared circuit still opens.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  if (!L || !L.FP) return;
  var FP = L.FP, G = FP.gen, X = L.PCBX, B = L.Behave, esc = L.esc;
  function r3(v) { return Math.round(v * 1000) / 1000; }

  /* Package families and the numbers each one takes. */
  var N = function (k, label, v, min, max, step, unit) { return { k: k, label: label, v: v, min: min, max: max, step: step || 1, unit: unit || "" }; };
  var S = function (k, label, v, opts) { return { k: k, label: label, v: v, opts: opts }; };
  var FAM = [
    { id: "dip", name: "DIP — through-hole chip", p: [N("n", "Pins", 8, 4, 64, 2), S("span", "Rows apart", 7.62, [[7.62, "0.3\" (7.62 mm)"], [15.24, "0.6\" (15.24 mm)"]])], make: function (o) { return G.dip({ n: o.n, span: +o.span }); } },
    { id: "soic", name: "SOIC — 1.27 mm SMD chip", p: [N("n", "Pins", 8, 4, 64, 2), S("w", "Body", "n", [["n", "Narrow (3.9 mm)"], ["w", "Wide (7.5 mm)"]])], make: function (o) { return o.w === "w" ? G.so({ n: o.n, name: "SOIC-W", span: 9.3, bodyW: 7.5, padL: 1.95 }) : G.so({ n: o.n }); } },
    { id: "tssop", name: "TSSOP / SSOP / MSOP — fine pitch", p: [N("n", "Pins", 16, 6, 64, 2), S("t", "Kind", "tssop", [["tssop", "TSSOP 0.65 mm"], ["ssop", "SSOP 0.65 mm"], ["msop", "MSOP 0.5 mm"]])], make: function (o) {
      if (o.t === "ssop") return G.so({ n: o.n, name: "SSOP", pitch: 0.65, span: 7.2, padL: 1.75, padW: 0.45, bodyW: 5.3, z: 1.75 });
      if (o.t === "msop") return G.so({ n: o.n, name: "MSOP", pitch: 0.5, span: 4.4, padL: 1.45, padW: 0.3, bodyW: 3.0, bodyL: 3.0, z: 1.1 });
      return G.so({ n: o.n, name: "TSSOP", pitch: 0.65, span: 5.8, padL: 1.5, padW: 0.4, bodyW: 4.4, z: 1.1 });
    } },
    { id: "qfn", name: "QFN — pads underneath", p: [N("n", "Pins", 32, 8, 100, 4), N("size", "Body", 5, 2, 12, 0.5, "mm"), S("pitch", "Pitch", 0.5, [[0.4, "0.4 mm"], [0.5, "0.5 mm"], [0.65, "0.65 mm"]]), N("ep", "Centre pad", 3.45, 0, 10, 0.05, "mm")], make: function (o) { return G.quad({ n: o.n, size: o.size, pitch: +o.pitch, ep: o.ep || 0 }); } },
    { id: "qfp", name: "QFP — legs on four sides", p: [N("n", "Pins", 44, 16, 144, 4), N("size", "Body", 10, 5, 24, 1, "mm"), S("pitch", "Pitch", 0.8, [[0.5, "0.5 mm"], [0.65, "0.65 mm"], [0.8, "0.8 mm"]])], make: function (o) { return G.quad({ n: o.n, size: o.size, pitch: +o.pitch, leads: true, span: o.size + 2, name: "LQFP" }); } },
    { id: "sot", name: "SOT-23 / SOT-223 / DPAK", p: [S("t", "Package", "sot23", [["sot23", "SOT-23 (3)"], ["sot235", "SOT-23-5"], ["sot236", "SOT-23-6"], ["sot223", "SOT-223"], ["dpak", "TO-252 (DPAK)"]])], make: function (o) { return o.t === "sot223" ? G.sot223({}) : o.t === "dpak" ? G.dpak({}) : G.sot23({ n: o.t === "sot235" ? 5 : o.t === "sot236" ? 6 : 3 }); } },
    { id: "to", name: "TO-92 / TO-220 — transistors, regulators", p: [S("t", "Package", "to92", [["to92", "TO-92"], ["to92w", "TO-92, 0.1\" legs"], ["to220", "TO-220 standing"], ["to220h", "TO-220 lying flat"]])], make: function (o) { return o.t === "to92" ? G.to92({}) : o.t === "to92w" ? G.to92({ pitch: 2.54 }) : G.to220({ flat: o.t === "to220h" }); } },
    { id: "chip", name: "Chip resistor / capacitor / LED", p: [S("kind", "Kind", "R", [["R", "Resistor"], ["C", "Capacitor"], ["L", "Inductor"], ["D", "LED"]]), S("size", "Size", "0805", FP.CHIPS.map(function (c) { return [c, c]; }))], make: function (o) { var f = G.chip({ size: o.size, kind: o.kind }); if (o.kind === "D") { f.pads[0].name = "K"; f.pads[1].name = "A"; } return f; } },
    { id: "axial", name: "Axial — resistors and diodes", p: [S("kind", "Kind", "R", [["R", "Resistor"], ["D", "Diode"]]), S("pitch", "Holes apart", 10.16, [[7.62, "7.62 mm (0.3\")"], [10.16, "10.16 mm (0.4\")"], [12.7, "12.7 mm (0.5\")"], [15.24, "15.24 mm (0.6\")"]])], make: function (o) { return G.axial({ pitch: +o.pitch, kind: o.kind, drill: o.kind === "D" && o.pitch > 9 ? 1.0 : 0.8 }); } },
    { id: "radial", name: "Electrolytic capacitor", p: [S("d", "Diameter", 6.3, [[4, "4 mm"], [5, "5 mm"], [6.3, "6.3 mm"], [8, "8 mm"], [10, "10 mm"], [12.5, "12.5 mm"], [16, "16 mm"]])], make: function (o) { return G.radial({ d: +o.d }); } },
    { id: "led", name: "LED 3 or 5 mm, or RGB pixel", p: [S("t", "Kind", "5", [["3", "3 mm"], ["5", "5 mm"], ["rgb", "WS2812B pixel"]])], make: function (o) { return o.t === "rgb" ? G.ledRgb({}) : G.led({ d: +o.t }); } },
    { id: "header", name: "Pin header or socket", p: [N("n", "Pins per row", 4, 1, 40), S("rows", "Rows", 1, [[1, "1"], [2, "2"]]), S("pitch", "Pitch", 2.54, [[2.54, "2.54 mm"], [2.0, "2.0 mm"], [1.27, "1.27 mm"]]), S("female", "Kind", "m", [["m", "Pins"], ["f", "Socket"]])], make: function (o) { return G.header({ rows: +o.rows, n: o.n * +o.rows, pitch: +o.pitch, female: o.female === "f" }); } },
    { id: "jst", name: "JST connector", p: [S("type", "Series", "XH", [["XH", "XH 2.5 mm"], ["PH", "PH 2.0 mm"], ["SH", "SH 1.0 mm (Qwiic)"]]), N("n", "Pins", 2, 2, 12)], make: function (o) { return G.jst({ type: o.type, n: o.n }); } },
    { id: "screw", name: "Screw terminal", p: [N("n", "Ways", 2, 2, 16), S("pitch", "Pitch", 5.08, [[5.08, "5.08 mm"], [3.5, "3.5 mm"]])], make: function (o) { return G.screw({ n: o.n, pitch: +o.pitch }); } },
    { id: "idc", name: "IDC box header", p: [S("n", "Pins", 10, [[10, "2×5"], [14, "2×7"], [16, "2×8"], [20, "2×10"], [26, "2×13"], [40, "2×20"]])], make: function (o) { return G.idc({ n: +o.n }); } },
    { id: "port", name: "Ports — USB, HDMI, Ethernet, power, audio, RF, SD", p: [S("t", "Port", "usbc", [["usbc", "USB-C"], ["usbmicro", "Micro-USB"], ["usbmini", "Mini-USB"], ["usba", "USB-A"], ["usbb", "USB-B"], ["hdmi", "HDMI"], ["rj45", "RJ45 Ethernet"], ["barrel", "DC barrel jack"], ["audio", "3.5 mm audio"], ["sma", "SMA (through-hole)"], ["smae", "SMA (board edge)"], ["microsd", "microSD socket"]])], make: function (o) {
      return ({ usbc: G.usbc, usbmicro: G.usbMicro, usbmini: G.usbMini, usba: G.usbA, usbb: G.usbB, hdmi: G.hdmi, rj45: G.rj45, barrel: G.barrel, audio: G.audio, microsd: G.microsd, sma: function () { return G.sma({}); }, smae: function () { return G.sma({ edge: true }); } })[o.t]();
    } },
    { id: "switch", name: "Switches, relays, buzzers, knobs", p: [S("t", "Part", "tact", [["tact", "Push button 6×6"], ["slide", "Slide switch"], ["relay", "Relay 5 V"], ["buzzer", "Buzzer 12 mm"], ["pot", "Potentiometer"], ["trim", "Trimmer"], ["seg7", "7-segment digit"], ["coin", "CR2032 holder"], ["xtal", "Crystal HC-49"], ["xtals", "Crystal 3225"]])], make: function (o) {
      return ({ tact: function () { return G.tactile({}); }, slide: G.slideSw, relay: G.relay, buzzer: function () { return G.buzzer({}); }, pot: function () { return G.pot({}); }, trim: function () { return G.pot({ trim: true }); }, seg7: G.seg7, coin: G.coin, xtal: function () { return G.crystal({}); }, xtals: function () { return G.crystal({ smd: true }); } })[o.t]();
    } },
    { id: "module", name: "Modules — ESP32, Pico, Nano", p: [S("t", "Module", "esp32", [["esp32", "ESP32-WROOM-32"], ["pico", "Raspberry Pi Pico"], ["nano", "Arduino Nano socket"]])], make: function (o) { return o.t === "pico" ? G.pico() : o.t === "nano" ? G.nanoSocket() : G.esp32(); } },
    { id: "row", name: "A row of pads (start from scratch)", p: [N("n", "Pads", 4, 1, 64), N("pitch", "Pitch", 2.54, 0.5, 10, 0.01, "mm"), S("t", "Kind", "tht", [["tht", "Through-hole"], ["smd", "Surface mount"]])], make: function (o) {
      var f = { id: "", name: o.n + " pads", pads: [], holes: [], silk: [] };
      for (var i = 0; i < o.n; i++) f.pads.push(o.t === "smd" ? { n: String(i + 1), x: r3((i - (o.n - 1) / 2) * o.pitch), y: 0, shape: "roundrect", w: r3(o.pitch * 0.55), h: 1.6 } : { n: String(i + 1), x: r3((i - (o.n - 1) / 2) * o.pitch), y: 0, shape: i ? "circle" : "rect", w: 1.7, h: 1.7, drill: 0.9 });
      var hw = (o.n * o.pitch) / 2;
      f.silk.push({ l: [-hw, -1.4, hw, -1.4] }, { l: [hw, -1.4, hw, 1.4] }, { l: [hw, 1.4, -hw, 1.4] }, { l: [-hw, 1.4, -hw, -1.4] });
      f.body = { x: 0, y: 0, w: r3(hw * 2), h: 2.6, z: 2.5, shape: "box", color: "#2b3a4a", look: "generic" };
      return FP.finish(f, "row");
    } }
  ];
  var KINDS = [["", "—"], ["power", "Power in"], ["ground", "Ground"], ["input", "Input"], ["output", "Output"], ["bidir", "In/out"], ["passive", "Passive"], ["nc", "Not connected"]];
  var CATS = ["My parts", "Chips", "Sensors", "Power", "Passive", "Semiconductors", "Switches", "Lights & sound", "Motion", "Wireless", "Advanced", "Boards"];

  var PM = L.PartMaker = {};

  /* ------------------------------------------------------- the library */

  function localParts() { try { return JSON.parse(root.localStorage.getItem("chalklab.parts") || "[]") || []; } catch (e) { return []; } }
  function saveLocal(list) { try { root.localStorage.setItem("chalklab.parts", JSON.stringify(list)); return true; } catch (e) { return false; } }
  PM.typeFor = function (name) {
    var base = "cp_" + String(name || "part").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20) || "cp_part";
    if (base === "cp_") base = "cp_part";
    var t = base, n = 2;
    while (L.PARTS[t] && !(L.CUSTOM[t])) t = base + "_" + n++;
    return t;
  };
  /* Save to the server (if it has a parts library) or this browser. */
  PM.save = function (app, type, data, cb) {
    FP.register(type, data);
    var cfg = app.cfg || {};
    var done = function (ok, msg) { if (app.drawer) app.drawer(); if (cb) cb(ok, msg); };
    if (cfg.partsUrl) {
      fetch(cfg.partsUrl, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": cfg.csrf }, body: JSON.stringify({ type: type, data: data }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (r) { done(!!(r.ok && r.j.ok), r.j && r.j.error); })
        .catch(function () { done(false, "The server couldn't be reached; the part is kept in this circuit."); });
      return;
    }
    var list = localParts().filter(function (p) { return p.type !== type; });
    list.push({ type: type, data: data });
    done(saveLocal(list), "Saved in this browser.");
  };
  PM.remove = function (app, type, cb) {
    var cfg = app.cfg || {};
    var used = app.doc.parts.some(function (p) { return p.type === type; });
    if (!used) FP.unregister(type);
    if (cfg.partsUrl) fetch(cfg.partsUrl + "?type=" + encodeURIComponent(type), { method: "DELETE", credentials: "same-origin", headers: { "X-CSRFToken": cfg.csrf } }).then(function () { if (cb) cb(); }).catch(function () { if (cb) cb(); });
    else { saveLocal(localParts().filter(function (p) { return p.type !== type; })); if (cb) cb(); }
    if (app.drawer) app.drawer();
  };
  /* The parts a circuit uses, carried inside it. */
  FP.libFor = function (doc) {
    var lib = {};
    (doc.parts || []).forEach(function (p) { if (L.CUSTOM[p.type]) lib[p.type] = L.CUSTOM[p.type].data; });
    return Object.keys(lib).length ? lib : undefined;
  };
  /* At load: the browser's own library when there is no server. */
  (function () {
    try {
      var cfgEl = root.document && document.getElementById("lab-config"), cfg = cfgEl ? JSON.parse(cfgEl.textContent) : {};
      FP.boot(cfg);
      if (!cfg.partsUrl) localParts().forEach(function (p) { if (p && p.type && !L.CUSTOM[p.type]) FP.register(p.type, p.data); });
      if (!cfg.saveUrl && !cfg.data) { var saved = JSON.parse(root.localStorage.getItem("chalklab.doc") || "null"); if (saved && saved.data && saved.data.lib) FP.boot({ data: saved.data }); }
    } catch (e) {}
  })();

  /* ============================================================ THE DIALOG */

  PM.open = function (app, seed) {
    var d = document.createElement("dialog");
    d.className = "dlg pm";
    document.body.appendChild(d);
    var st = { fam: "dip", par: {}, fp: null, pins: {}, name: "My part", value: "", ref: "U", cat: "My parts", look: "ic", color: "", desc: "", behave: "", type: null, tab: "pins", pick: null, zoom: 1 };
    FAM.forEach(function (f) { st.par[f.id] = {}; f.p.forEach(function (p) { st.par[f.id][p.k] = p.v; }); });
    if (seed && seed.type && L.CUSTOM[seed.type]) {
      var c = L.CUSTOM[seed.type].data;
      st.type = seed.type; st.fp = FP.clone(c.fp); st.name = c.name; st.value = c.value || ""; st.ref = c.ref || c.fp.ref || "U"; st.cat = c.cat || "My parts"; st.look = c.look || "ic"; st.color = c.color || ""; st.desc = c.desc || ""; st.behave = c.behave || ""; st.pins = JSON.parse(JSON.stringify(c.pins || {}));
      st.fam = null;
    } else if (seed && seed.fp) { st.fp = FP.clone(seed.fp); st.name = seed.name || st.fp.name; st.value = seed.value || ""; st.fam = null; }
    else st.fp = FAM[0].make(st.par.dip);

    var self = { d: d, st: st, app: app };
    var mine = Object.keys(L.CUSTOM).map(function (t) { return [t, L.CUSTOM[t].data.name]; });
    d.innerHTML =
      '<form method="dialog" class="pm-wrap">' +
      '<header class="pm-head"><h2>Design a part</h2>' +
        '<div class="pm-ask"><input type="text" class="pm-desc" maxlength="300" placeholder="Describe it — “MCP23017 I/O expander, SOIC-28”, “TP4056 charger with micro-USB”…" aria-label="Describe the part"><button type="button" data-a="describe" class="accent">✦ Make it</button></div>' +
        (mine.length ? '<label class="pm-open">Open <select data-a="openmine"><option value="">one of yours…</option>' + mine.map(function (m) { return '<option value="' + esc(m[0]) + '">' + esc(m[1]) + '</option>'; }).join("") + '</select></label>' : "") +
        '<button type="button" class="pm-x" value="cancel" data-a="close" aria-label="Close">×</button></header>' +
      '<div class="pm-body">' +
        '<section class="pm-left" aria-label="Footprint"><h3>Footprint</h3>' +
          '<label class="px-f"><span>Start from</span><select data-a="fam"><option value="">— keep what\'s there —</option>' + FAM.map(function (f) { return '<option value="' + f.id + '">' + esc(f.name) + '</option>'; }).join("") + '</select></label>' +
          '<div class="pm-par"></div>' +
          '<label class="px-f"><span>Or in words</span><input type="text" data-a="words" placeholder="tssop 20, 2x8 socket, usb c…"></label>' +
          '<label class="px-f"><span>Or from the library</span><select data-a="lib"><option value="">…</option>' + FP.CATS.map(function (c) { return '<optgroup label="' + esc(c) + '">' + FP.LIB.filter(function (f) { return f.cat === c; }).map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.id) + '</option>'; }).join("") + '</optgroup>'; }).join("") + '</select></label>' +
          '<div class="pm-btns"><button type="button" data-a="kicad">Import .kicad_mod</button><button type="button" data-a="partfile">Open a part file</button></div>' +
          '<h4>Pad</h4><div class="pm-pad"></div>' +
          '<div class="pm-btns"><button type="button" data-a="addpad">＋ Pad</button><button type="button" data-a="addhole">＋ Hole</button><button type="button" data-a="delpad">Delete pad</button><button type="button" data-a="renum">Renumber</button></div>' +
        '</section>' +
        '<section class="pm-mid" aria-label="Footprint drawing"><div class="pm-canvas"></div><p class="pm-info"></p>' +
          '<div class="pm-zoom"><button type="button" data-a="zout" aria-label="Zoom out">−</button><button type="button" data-a="zin" aria-label="Zoom in">+</button><label class="st-chk"><input type="checkbox" data-a="names" checked> Pin names</label></div></section>' +
        '<section class="pm-right"><div class="px-tabs" role="tablist"><button type="button" data-t="pins">Pins</button><button type="button" data-t="behave">Behaviour</button><button type="button" data-t="bench">Bench</button><button type="button" data-t="try">Try it</button></div><div class="pm-tab"></div></section>' +
      '</div>' +
      '<footer class="pm-foot"><span class="pm-msg" role="status" aria-live="polite"></span>' +
        '<button type="button" data-a="export">Export ▾</button>' +
        (st.type ? '<button type="button" data-a="delete" class="danger">Delete part</button>' : "") +
        '<button type="button" data-a="save">Save to my parts</button><button type="button" data-a="saveplace" class="primary">Save and put on the bench</button></footer>' +
      '</form>';
    d.addEventListener("close", function () { d.remove(); });
    d.addEventListener("cancel", function () { d.remove(); });
    self.$ = function (s) { return d.querySelector(s); };
    if (st.fam) self.$('[data-a="fam"]').value = st.fam;
    bind(self);
    params(self); canvas(self); padForm(self); tab(self, "pins");
    d.showModal();
    return self;
  };

  function msg(self, s, bad) { var m = self.$(".pm-msg"); m.textContent = s || ""; m.className = "pm-msg" + (bad ? " bad" : ""); }
  function setFp(self, fp, keepNames) {
    var old = self.st.fp;
    self.st.fp = fp;
    if (keepNames && old) fp.pads.forEach(function (p) { var o = old.pads.filter(function (q) { return q.n === p.n; })[0]; if (o && o.name) p.name = o.name; });
    if (fp.ref && self.st.ref === "U") self.st.ref = fp.ref;
    self.st.pick = null;
    if (/^(USB|HDMI|RJ45|DC-|Audio|SMA|micro|HDR|SKT|JST|TERM|IDC)/.test(fp.id || "")) self.st.look = "conn";
    canvas(self); padForm(self); tab(self, self.st.tab);
  }
  function params(self) {
    var st = self.st, f = FAM.filter(function (x) { return x.id === st.fam; })[0], box = self.$(".pm-par");
    if (!f) { box.innerHTML = ""; return; }
    box.innerHTML = f.p.map(function (p) {
      var v = st.par[f.id][p.k];
      if (p.opts) return '<label class="px-f"><span>' + esc(p.label) + '</span><select data-p="' + p.k + '">' + p.opts.map(function (o) { return '<option value="' + esc(String(o[0])) + '"' + (String(o[0]) === String(v) ? " selected" : "") + '>' + esc(o[1]) + '</option>'; }).join("") + '</select></label>';
      return '<label class="px-f"><span>' + esc(p.label) + '</span><input type="number" data-p="' + p.k + '" value="' + v + '" min="' + p.min + '" max="' + p.max + '" step="' + p.step + '">' + (p.unit ? "<i>" + p.unit + "</i>" : "") + '</label>';
    }).join("");
    box.querySelectorAll("[data-p]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var p = f.p.filter(function (x) { return x.k === inp.getAttribute("data-p"); })[0], v = inp.value;
        if (!p.opts) { v = L.clamp(parseFloat(v) || p.v, p.min, p.max); if (p.step >= 1) v = Math.round(v / p.step) * p.step; inp.value = v; }
        st.par[f.id][p.k] = v;
        try { setFp(self, f.make(norm(st.par[f.id])), true); msg(self, ""); } catch (e) { msg(self, "Those numbers don't make a package: " + e.message, true); }
      });
    });
  }
  function norm(o) { var r = {}; Object.keys(o).forEach(function (k) { var v = o[k]; r[k] = typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? +v : v; }); return r; }

  /* the footprint, big, with pads you can pick and drag */
  function canvas(self) {
    var st = self.st, fp = st.fp, box = self.$(".pm-canvas"), names = self.$('[data-a="names"]').checked;
    FP.finish(fp, fp.id || "custom");
    var html = X.fpSvg(fp, null, { pins: true, pick: st.pick, labels: names ? "name" : "num" });
    box.innerHTML = html;
    var svg = box.querySelector("svg"), vb = svg.getAttribute("viewBox").split(" ").map(Number);
    if (st.zoom !== 1) { var cx = vb[0] + vb[2] / 2, cy = vb[1] + vb[3] / 2, w = vb[2] / st.zoom, h = vb[3] / st.zoom; svg.setAttribute("viewBox", [cx - w / 2, cy - h / 2, w, h].join(" ")); }
    var c = fp.court, uniq = {};
    fp.pads.forEach(function (p) { uniq[p.n] = 1; });
    self.$(".pm-info").textContent = (fp.name || "Custom") + " · " + Object.keys(uniq).length + " pins, " + fp.pads.length + " pads" + (fp.holes.length ? ", " + fp.holes.length + " holes" : "") + " · " + (c.x1 - c.x0).toFixed(2) + " × " + (c.y1 - c.y0).toFixed(2) + " mm · " + (fp.kind === "smd" ? "surface mount" : fp.kind === "tht" ? "through-hole" : "mixed");
    var drag = null;
    svg.addEventListener("pointerdown", function (e) {
      var t = e.target.closest("[data-pad]");
      if (!t) return;
      var i = indexAt(fp, svg, e);
      if (i < 0) return;
      st.pick = i; padForm(self);
      var pt = toSvg(svg, e);
      drag = { i: i, x: pt.x, y: pt.y, ox: fp.pads[i].x, oy: fp.pads[i].y };
      svg.setPointerCapture(e.pointerId);
      canvas(self);
    });
    svg.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var pt = toSvg(svg, e), p = fp.pads[drag.i], g = e.altKey ? 0.01 : 0.05;
      p.x = r3(Math.round((drag.ox + pt.x - drag.x) / g) * g); p.y = r3(Math.round((drag.oy + pt.y - drag.y) / g) * g);
      FP.finish(fp, fp.id); var sv = X.fpSvg(fp, null, { pins: true, pick: st.pick, labels: names ? "name" : "num" });
      svg.innerHTML = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(sv)[1];
    });
    svg.addEventListener("pointerup", function () { if (drag) { drag = null; canvas(self); padForm(self); } });
  }
  function toSvg(svg, e) { var p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; var m = svg.getScreenCTM().inverse(); var q = p.matrixTransform(m); return { x: q.x, y: q.y }; }
  function indexAt(fp, svg, e) {
    var pt = toSvg(svg, e), best = -1, bd = 1e9;
    fp.pads.forEach(function (p, i) { var t = (p.deg || 0) % 180 === 90, w = t ? p.h : p.w, h = t ? p.w : p.h; if (Math.abs(pt.x - p.x) <= w / 2 + 0.1 && Math.abs(pt.y - p.y) <= h / 2 + 0.1) { var dd = Math.hypot(pt.x - p.x, pt.y - p.y); if (dd < bd) { bd = dd; best = i; } } });
    return best;
  }
  function padForm(self) {
    var st = self.st, box = self.$(".pm-pad"), p = st.pick != null ? st.fp.pads[st.pick] : null;
    if (!p) { box.innerHTML = '<p class="hint">Click a pad to change it; drag to move it (Alt for fine steps).</p>'; return; }
    var f = function (k, label, v, step) { return '<label class="px-f"><span>' + label + '</span><input type="number" data-q="' + k + '" value="' + v + '" step="' + (step || 0.05) + '"><i>mm</i></label>'; };
    box.innerHTML = '<div class="px-row"><label class="px-f"><span>Number</span><input type="text" data-q="n" value="' + esc(p.n) + '" maxlength="6"></label><label class="px-f"><span>Name</span><input type="text" data-q="name" value="' + esc(p.name || "") + '" maxlength="16"></label></div>' +
      '<div class="px-row">' + f("x", "X", p.x) + f("y", "Y", p.y) + '</div><div class="px-row">' + f("w", "Width", p.w) + f("h", "Height", p.h) + '</div>' +
      '<div class="px-row"><label class="px-f"><span>Shape</span><select data-q="shape">' + [["rect", "Square"], ["roundrect", "Rounded"], ["circle", "Round"], ["oval", "Oval"]].map(function (o) { return '<option value="' + o[0] + '"' + (p.shape === o[0] ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") + '</select></label>' + f("drill", "Hole", p.drill || 0) + '</div>';
    box.querySelectorAll("[data-q]").forEach(function (inp) {
      inp.addEventListener("change", function () {
        var k = inp.getAttribute("data-q"), v = inp.value;
        if (k === "n") v = String(v).replace(/[^A-Za-z0-9+\-_]/g, "").slice(0, 6) || p.n;
        else if (k === "name") v = String(v).slice(0, 16);
        else if (k !== "shape") v = r3(Math.max(k === "x" || k === "y" ? -200 : 0, Math.min(200, parseFloat(v) || 0)));
        if (k === "drill") { if (v > 0) { p.drill = v; delete p.side; p.w = Math.max(p.w, v + 0.3); p.h = Math.max(p.h, v + 0.3); } else { delete p.drill; p.side = "top"; } }
        else p[k] = v;
        canvas(self); padForm(self); if (st.tab === "pins") tab(self, "pins");
      });
    });
  }

  /* ------------------------------------------------------------- tabs */

  function benchPinsOf(st) { return FP.benchPins({ fp: st.fp, pins: st.pins }).pins; }
  function tab(self, t) {
    var st = self.st, box = self.$(".pm-tab");
    st.tab = t;
    self.d.querySelectorAll("[data-t]").forEach(function (b) { b.setAttribute("aria-selected", b.getAttribute("data-t") === t ? "true" : "false"); });
    if (t === "pins") {
      var seen = {}, rows = [];
      st.fp.pads.forEach(function (p) { if (seen[p.n]) return; seen[p.n] = 1; rows.push(p); });
      rows.sort(function (a, b) { return String(a.n).localeCompare(String(b.n), undefined, { numeric: true }); });
      box.innerHTML = '<p class="hint">Name every pin the way its datasheet does. Pads with the same number are one pin.</p><table class="px-pins pm-pins"><tr><th>Pin</th><th>Name</th><th>Kind</th></tr>' + rows.slice(0, 200).map(function (p) {
        var k = (st.pins[p.n] && st.pins[p.n].type) || "";
        return '<tr><td>' + esc(p.n) + '</td><td><input type="text" data-pn="' + esc(p.n) + '" value="' + esc(p.name || "") + '" maxlength="16" placeholder="' + esc(p.n) + '"></td><td><select data-pk="' + esc(p.n) + '">' + KINDS.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === k ? " selected" : "") + '>' + o[1] + '</option>'; }).join("") + '</select></td></tr>';
      }).join("") + '</table><div class="pm-btns"><button type="button" data-a="guessnames">Guess kinds from names</button></div>';
      box.querySelectorAll("[data-pn]").forEach(function (inp) { inp.addEventListener("change", function () { var n = inp.getAttribute("data-pn"), v = inp.value.trim().slice(0, 16); st.fp.pads.forEach(function (p) { if (p.n === n) p.name = v || undefined; }); canvas(self); }); });
      box.querySelectorAll("[data-pk]").forEach(function (sel) { sel.addEventListener("change", function () { var n = sel.getAttribute("data-pk"); st.pins[n] = st.pins[n] || {}; st.pins[n].type = sel.value; }); });
      box.querySelector('[data-a="guessnames"]').addEventListener("click", function () { st.fp.pads.forEach(function (p) { st.pins[p.n] = st.pins[p.n] || {}; st.pins[p.n].type = guessKind(p.name || ""); }); tab(self, "pins"); });
    }
    if (t === "behave") {
      var names = benchPinsOf(st).map(function (p) { return p.label; });
      box.innerHTML = '<p class="hint">How the part acts in a circuit — resistors, sources, switches, LEDs and transistors between its pins, with values that can follow voltages, time and its settings. Pins by name: ' + esc(names.slice(0, 16).join(", ")) + (names.length > 16 ? "…" : "") + '.</p>' +
        '<div class="pm-btns"><label class="px-f"><span>Start from</span><select data-a="tpl"><option value="">a template…</option>' + B.TEMPLATES.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + '</option>'; }).join("") + '</select></label><button type="button" data-a="aibehave" class="accent">✦ Write it for me</button></div>' +
        '<textarea class="pm-code" spellcheck="false" rows="14" placeholder="# for example\nparam ref = 2.5 V 0..5 &quot;Trips at&quot;\nout: V OUT GND = V(IN, GND) > ref ? 5 : 0  r 50\nglow = V(OUT, GND) > 1">' + esc(st.behave) + '</textarea>' +
        '<div class="pm-btns"><button type="button" data-a="check">Check it</button><details class="pm-help"><summary>The language</summary><pre>' + esc(HELP) + '</pre></details></div><div class="pm-result"></div>';
      var ta = box.querySelector("textarea");
      ta.addEventListener("input", function () { st.behave = ta.value; });
      box.querySelector('[data-a="tpl"]').addEventListener("change", function () { if (!this.value) return; st.behave = B.template(this.value, names); ta.value = st.behave; check(self); });
      box.querySelector('[data-a="check"]').addEventListener("click", function () { check(self); });
      box.querySelector('[data-a="aibehave"]').addEventListener("click", function () { aiBehave(self); });
      if (st.behave) check(self);
    }
    if (t === "bench") {
      box.innerHTML = '<div class="px-row"><label class="px-f"><span>Name</span><input type="text" data-b="name" value="' + esc(st.name) + '" maxlength="40"></label><label class="px-f"><span>Value</span><input type="text" data-b="value" value="' + esc(st.value) + '" maxlength="24" placeholder="MCP23017"></label></div>' +
        '<div class="px-row"><label class="px-f"><span>Drawer</span><input type="text" data-b="cat" value="' + esc(st.cat) + '" list="pm-cats" maxlength="24"></label><label class="px-f"><span>Reference</span><input type="text" data-b="ref" value="' + esc(st.ref) + '" maxlength="3"></label></div>' +
        '<datalist id="pm-cats">' + CATS.map(function (c) { return '<option value="' + esc(c) + '">'; }).join("") + '</datalist>' +
        '<div class="px-row"><label class="px-f"><span>Looks like</span><select data-b="look">' + FP.LOOKS.map(function (k) { return '<option value="' + k + '"' + (k === st.look ? " selected" : "") + '>' + ({ ic: "a chip", conn: "a connector", res: "a resistor", cap: "a capacitor", led: "a light", diode: "a diode", xtal: "a crystal", switch: "a switch", module: "a module", sensor: "a sensor", generic: "a little board" })[k] + '</option>'; }).join("") + '</select></label><label class="px-f"><span>Colour</span><input type="color" data-b="color" value="' + (st.color || "#1d1f22") + '"></label></div>' +
        '<label class="px-f wide"><span>About it</span><input type="text" data-b="desc" value="' + esc(st.desc) + '" maxlength="200" placeholder="What it is and what it does"></label>' +
        '<h4>On the bench</h4><div class="pm-bench"></div><p class="hint">Footprints whose holes sit on the 0.1" grid go on the bench as they are; anything else sits on a little breakout board with its pins in a row.</p>';
      box.querySelectorAll("[data-b]").forEach(function (inp) { inp.addEventListener("change", function () { st[inp.getAttribute("data-b")] = inp.value; if (inp.getAttribute("data-b") === "ref") st.ref = inp.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "U"; benchPreview(self); }); });
      benchPreview(self);
    }
    if (t === "try") tryIt(self, box);
  }
  function guessKind(n) {
    var s = n.toUpperCase();
    if (/^(GND|VSS|AGND|DGND|PGND|EP|0V)/.test(s)) return "ground";
    if (/^(VCC|VDD|VIN|VBAT|VBUS|V\+|3V3|5V|AVCC|VS|VREF|\+)/.test(s)) return "power";
    if (/^(NC|DNC)/.test(s)) return "nc";
    if (/OUT|^TX|^DO|MISO|^Q\d|^Y/.test(s)) return "output";
    if (/^IN|^RX|^DI|MOSI|SCK|CLK|^CS|^EN|^RST|RESET|^A\d$|^D\d$|^B\d$/.test(s)) return "input";
    if (/SDA|SCL|GPIO|^IO|^P[A-Z]?\d/.test(s)) return "bidir";
    return "passive";
  }
  var HELP = "param NAME = VALUE [unit] [min..max] [\"Label\"]\nstate NAME = VALUE        node NAME        let NAME = EXPR\n[name:] R a b OHMS  ·  C a b FARADS  ·  L a b HENRIES\n[name:] D a k  ·  LED a k [colour]\n[name:] V plus minus = VOLTS [r OHMS]\n[name:] I from to = AMPS\n[name:] SW a b when CONDITION [r OHMS]\n[name:] NPN c b e [beta N]  ·  PNP c b e  ·  NMOS d g s [vth V]\non rise COND: x = …   on fall COND: …   every SECONDS: …   when COND: …\nglow = EXPR [color #hex]   show = EXPR [unit]   sound = HERTZ\nwarn \"message\" when COND [danger]\n\nNumbers: 10k 4k7 100n 2ms 1kHz.  V(pin) V(a, b) I(element) t\nmin max abs clamp sqrt exp log sin cos round step lerp map\nsquare(f) sine(f) saw(f) tri(f) pulse(start, width) ramp(t0, t1) noise(a)";
  function check(self) {
    var st = self.st, out = self.$(".pm-result");
    if (!out) return null;
    if (!st.behave.trim()) { out.innerHTML = '<p class="hint">No behaviour: the part will only join its pins to the circuit.</p>'; return null; }
    var r = B.compile(st.behave, FP.pinAliases(benchPinsOf(st)));
    out.innerHTML = r.ok ? '<p class="good">✓ It compiles: ' + esc(r.summary) + '.</p>' + (r.params.length ? '<p class="hint">Settings in the inspector: ' + r.params.map(function (p) { return esc(p.spec.label) + " (" + p.value + (p.spec.unit ? " " + esc(p.spec.unit) : "") + ")"; }).join(", ") + '</p>' : "")
      : '<ul class="bad">' + r.errors.map(function (e) { return '<li>' + (e.line ? "Line " + e.line + ": " : "") + esc(e.msg) + '</li>'; }).join("") + '</ul>';
    return r;
  }
  function benchPreview(self) {
    var st = self.st, box = self.$(".pm-bench");
    if (!box) return;
    var def = FP.register("cp__preview", data(self));
    if (!def) { box.innerHTML = ""; return; }
    var probe = { id: "t", type: "cp__preview", x: 0, y: 0, rot: 0, props: {} }, b = def.box, pad = 8;
    box.innerHTML = '<svg viewBox="' + (b.x - pad) + " " + (b.y - pad) + " " + (b.w + pad * 2) + " " + (b.h + pad * 2) + '">' + def.art(probe, L.propsOf(probe)) + '</svg>';
    FP.unregister("cp__preview");
  }
  function data(self) {
    var st = self.st, pins = {};
    st.fp.pads.forEach(function (p) { if (p.name || (st.pins[p.n] && st.pins[p.n].type)) pins[p.n] = { name: p.name || p.n, type: (st.pins[p.n] && st.pins[p.n].type) || "" }; });
    var fp = FP.clone(st.fp); fp.name = fp.name || st.name; fp.ref = st.ref || "U";
    return { name: String(st.name || "My part").slice(0, 40), value: String(st.value || "").slice(0, 24), ref: st.ref || "U", cat: String(st.cat || "My parts").slice(0, 24), look: st.look, color: st.color || "", desc: String(st.desc || "").slice(0, 200), fp: fp, pins: pins, behave: String(st.behave || "").slice(0, 8000) };
  }

  /* A tiny test bench: power across the supply pins, a knob on any input,
   * a 10 kΩ load on the rest, and a reading on every pin. */
  function tryIt(self, box) {
    var st = self.st, pins = benchPinsOf(st), r = st.behave.trim() ? B.compile(st.behave, FP.pinAliases(pins)) : null;
    if (r && !r.ok) { box.innerHTML = '<p class="bad">Fix the behaviour first (Behaviour tab).</p>'; return; }
    if (!r) { box.innerHTML = '<p class="hint">Give the part a behaviour first; without one it only joins its pins to the circuit, and there is nothing to try.</p>'; return; }
    var t = st.try = st.try || {};
    var gnd = pins.filter(function (p) { return /^(GND|VSS|AGND|DGND|-|0V)$/i.test(p.label); })[0] || pins[pins.length - 1];
    var vcc = pins.filter(function (p) { return /^(VCC|VDD|VIN|V\+|\+|3V3|5V|VBUS|VS)$/i.test(p.label) && p !== gnd; })[0];
    if (t.vcc == null) t.vcc = vcc ? vcc.n : ""; if (t.gnd == null) t.gnd = gnd ? gnd.n : ""; if (t.volts == null) t.volts = 5; t.ins = t.ins || {};
    var opt = function (v) { return '<option value="">—</option>' + pins.map(function (p) { return '<option value="' + esc(p.n) + '"' + (p.n === v ? " selected" : "") + '>' + esc(p.label) + '</option>'; }).join(""); };
    box.innerHTML = '<div class="px-row"><label class="px-f"><span>Supply +</span><select data-y="vcc">' + opt(t.vcc) + '</select></label><label class="px-f"><span>Ground</span><select data-y="gnd">' + opt(t.gnd) + '</select></label><label class="px-f"><span>Volts</span><input type="number" data-y="volts" value="' + t.volts + '" min="0" max="24" step="0.1"></label></div>' +
      '<p class="hint">Drive any other pin with the sliders (left at “—” it gets a 10 kΩ load to ground instead). Settings come from the part\'s params.</p><table class="px-pins pm-try"><tr><th>Pin</th><th>Drive</th><th>Reads</th></tr>' +
      pins.filter(function (p) { return p.n !== t.vcc && p.n !== t.gnd; }).slice(0, 40).map(function (p) { var v = t.ins[p.n]; return '<tr><td>' + esc(p.label) + '</td><td><input type="range" min="-0.1" max="' + t.volts + '" step="0.05" value="' + (v == null ? -0.1 : v) + '" data-in="' + esc(p.n) + '"> <span class="dim" data-iv="' + esc(p.n) + '">' + (v == null ? "—" : v.toFixed(2) + " V") + '</span></td><td data-out="' + esc(p.n) + '">…</td></tr>'; }).join("") + '</table>' +
      (r.params.length ? '<h4>Settings</h4>' + r.params.map(function (pm) { var v = t.p && t.p[pm.name] != null ? t.p[pm.name] : pm.value; return '<label class="px-f wide"><span>' + esc(pm.spec.label) + '</span><input type="range" data-pp="' + esc(pm.name) + '" min="' + pm.spec.min + '" max="' + pm.spec.max + '" step="' + pm.spec.step + '" value="' + v + '"> <i data-ppv="' + esc(pm.name) + '">' + r3(v) + " " + esc(pm.spec.unit) + '</i></label>'; }).join("") : "") +
      '<div class="pm-tryout"></div>';
    var run = function () {
      var def = FP.register("cp__try", data(self));
      if (!def) return;
      /* every test part far from the others: legs that land on the same spot are joined */
      var doc = L.blankDoc("pro"), P = L.P, part = { id: "u", type: "cp__try", x: 0, y: 0, rot: 0, props: t.p || {} }, slot = 0;
      var away = function () { slot++; return { x: 400 * P + slot * 60 * P, y: 400 * P }; };
      doc.parts.push(part);
      var wire = function (a, b) { doc.wires.push({ id: L.uid("w"), a: { ref: a }, b: { ref: b }, pts: [] }); };
      if (t.vcc && t.gnd) { var a0 = away(); doc.parts.push({ id: "ps", type: "psu", x: a0.x, y: a0.y, rot: 0, props: { volts: +t.volts, limit: 3 } }); wire("ps:+", "u:" + t.vcc); wire("ps:-", "u:" + t.gnd); }
      pins.forEach(function (p, i) {
        if (p.n === t.vcc || p.n === t.gnd || !t.gnd) return;
        var v = t.ins[p.n];
        if (v != null && v >= 0) { var id = "in" + i; var a1 = away(); doc.parts.push({ id: id, type: "psu", x: a1.x, y: a1.y, rot: 0, props: { volts: v, limit: 1 } }); wire(id + ":+", "u:" + p.n); wire(id + ":-", "u:" + t.gnd); }
        else { var rid = "rl" + i; var a2 = away(); doc.parts.push({ id: rid, type: "resistor", x: a2.x, y: a2.y, rot: 0, props: { ohms: 10000 } }); wire(rid + ":1", "u:" + p.n); wire(rid + ":2", "u:" + t.gnd); }
      });
      var sim = new L.Sim(); sim.load(doc);
      for (var k = 0; k < 40; k++) sim.step(1 / 60);
      pins.forEach(function (p) {
        var cell = box.querySelector('[data-out="' + cssq(p.n) + '"]'); if (!cell) return;
        var v = (sim.pinVolts("u:" + p.n) || 0) - (t.gnd ? sim.pinVolts("u:" + t.gnd) || 0 : 0), i = sim.pinCurrent("u:" + p.n) || 0;
        if (Math.abs(v) < 0.005) v = 0;
        cell.textContent = v.toFixed(2) + " V" + (Math.abs(i) > 1e-6 ? " · " + L.si(Math.abs(i), "A") + (i > 0 ? " in" : " out") : "");
      });
      var s = sim.state.u || {}, bits = [];
      if (s.glow > 0.02) bits.push('<span class="pm-glow" style="background:' + esc(s.glowColor || "#ffd36b") + ';opacity:' + Math.min(1, 0.3 + s.glow) + '"></span> glowing ' + Math.round(Math.min(1, s.glow) * 100) + "%");
      if (s.show) bits.push("shows <b>" + esc(s.show) + "</b>");
      if (s.sound) bits.push("sounds " + Math.round(s.sound) + " Hz");
      var warns = (sim.warnings || []).filter(function (w) { return w.part === "u"; }).map(function (w) { return '<li class="lv-' + w.level + '">' + esc(w.msg) + '</li>'; });
      if (t.vcc && t.gnd) { var ps = sim.state.ps || {}; bits.push("draws " + L.si(Math.abs(ps.i || 0), "A") + " from the supply"); }
      box.querySelector(".pm-tryout").innerHTML = '<p>' + (bits.join(" · ") || "No light, sound or display.") + '</p>' + (warns.length ? '<ul class="px-issues">' + warns.join("") + '</ul>' : "");
      FP.unregister("cp__try");
    };
    box.querySelectorAll("[data-y]").forEach(function (inp) { inp.addEventListener("change", function () { var k = inp.getAttribute("data-y"); t[k] = k === "volts" ? L.clamp(+inp.value || 0, 0, 24) : inp.value; tryIt(self, box); }); });
    box.querySelectorAll("[data-in]").forEach(function (inp) { inp.addEventListener("input", function () { var n = inp.getAttribute("data-in"), v = +inp.value; if (v < 0) delete t.ins[n]; else t.ins[n] = v; box.querySelector('[data-iv="' + cssq(n) + '"]').textContent = v < 0 ? "—" : v.toFixed(2) + " V"; run(); }); });
    box.querySelectorAll("[data-pp]").forEach(function (inp) { inp.addEventListener("input", function () { t.p = t.p || {}; t.p[inp.getAttribute("data-pp")] = +inp.value; box.querySelector('[data-ppv="' + cssq(inp.getAttribute("data-pp")) + '"]').textContent = r3(+inp.value); run(); }); });
    run();
  }
  function cssq(s) { return String(s).replace(/["\\]/g, "\\$&"); }

  /* ------------------------------------------------------------- the AI */

  function ai(self, payload) {
    var cfg = self.app.cfg || {};
    if (!cfg.aiEnabled || !cfg.aiUrl) return Promise.reject({ offline: true });
    return fetch(cfg.aiUrl, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": cfg.csrf }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); }).then(function (j) { if (!j || j.ok === false) throw j; return j; });
  }
  /* "Make it": the whole part from a description. */
  function describe(self, text) {
    var st = self.st;
    msg(self, "Designing " + text + "…");
    var local = function (note) {
      /* a chip it knows by number comes with its real pinout */
      var known = FP.findPart(text);
      if (known) {
        var kf = FP.ofPart(known), words = FP.fromText(text);
        if (words && known.pins && words.pads.length === kf.pads.length && words.kind !== kf.kind) { kf = words; known.pins.forEach(function (n, i) { if (kf.pads[i]) kf.pads[i].name = n; }); }
        st.name = known.name; st.value = known.value; st.ref = known.ref || "U"; st.cat = known.cat === "Chips" || known.cat === "Power" ? known.cat : "My parts"; st.look = known.cat === "Connectors" ? "conn" : "ic";
        st.pins = {}; kf.pads.forEach(function (p) { st.pins[p.n] = { type: guessKind(p.name || "") }; });
        var gk = B.guess(text + " " + known.name, FP.benchPins({ fp: kf }).pins.map(function (p) { return p.label; }));
        st.behave = known.bench ? "" : gk.src; st.fam = null; self.$('[data-a="fam"]').value = ""; params(self);
        setFp(self, kf);
        msg(self, (note || "") + "That's the " + known.name + " — " + kf.name + ", with its datasheet pinout." + (known.bench ? " The lab already simulates it: you'll find it in the drawer." : " Check the behaviour fits."));
        tab(self, "pins");
        return;
      }
      var fp = FP.fromText(text) || (function () { var n = parseInt((/(\d+)\s*(?:pin|way|pad)/i.exec(text) || [])[1], 10) || 4; return FAM.filter(function (f) { return f.id === "header"; })[0].make({ n: n, rows: 1, pitch: 2.54, female: "m" }); })();
      st.name = text.replace(/\s+(in|with|on)\s+.*$/i, "").slice(0, 40) || st.name;
      st.value = (/\b([A-Z]{1,5}\d{2,6}[A-Z0-9\-]*)\b/.exec(text) || [])[1] || st.value;
      var g = B.guess(text, FP.benchPins({ fp: fp }).pins.map(function (p) { return p.label; }));
      st.behave = g.src; st.fam = null; self.$('[data-a="fam"]').value = ""; params(self);
      setFp(self, fp);
      msg(self, (note || "") + "Made from the words: " + fp.name + ". Name the pins, and check the behaviour fits.");
      tab(self, "pins");
    };
    ai(self, { kind: "part", question: text, mode: "pro", circuit: { parts: [], nets: [] }, code: "", library: FP.LIB.map(function (f) { return f.id; }).join(" ") })
      .then(function (j) {
        var p = j.part || j;
        var fp = (p.package && (FP.get(p.package) ? FP.clone(FP.get(p.package)) : FP.fromText(p.package))) || FP.fromText(text);
        if (!fp) { local("The AI's package wasn't one I can draw, so: "); return; }
        (p.pins || []).forEach(function (q) { fp.pads.forEach(function (pad) { if (pad.n === String(q.n)) pad.name = String(q.name || "").slice(0, 16) || undefined; }); st.pins[String(q.n)] = { type: q.type || "" }; });
        st.name = String(p.name || text).slice(0, 40); st.value = String(p.value || "").slice(0, 24); st.ref = String(p.ref || fp.ref || "U").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "U";
        st.cat = String(p.cat || "My parts").slice(0, 24); st.look = FP.LOOKS.indexOf(p.look) >= 0 ? p.look : st.look; st.desc = String(p.desc || "").slice(0, 200);
        st.behave = String(p.behave || "").slice(0, 8000); st.fam = null; self.$('[data-a="fam"]').value = ""; params(self);
        setFp(self, fp);
        var r = st.behave ? B.compile(st.behave, FP.pinAliases(benchPinsOf(st))) : null;
        msg(self, "Designed by the AI: " + fp.name + (r ? r.ok ? " with a working behaviour." : " — its behaviour has " + r.errors.length + " problem(s); see Behaviour." : "."), r && !r.ok);
        tab(self, r && !r.ok ? "behave" : "pins");
      })
      .catch(function (e) { local(e && e.offline ? "" : "The AI didn't answer. "); });
  }
  function aiBehave(self) {
    var st = self.st, pins = benchPinsOf(st), r = st.behave.trim() ? B.compile(st.behave, FP.pinAliases(pins)) : null;
    msg(self, "Writing a behaviour…");
    var fallback = function (note) { var g = B.guess(st.name + " " + st.value + " " + st.desc, pins.map(function (p) { return p.label; })); st.behave = g.src; tab(self, "behave"); msg(self, (note || "") + "A starting point from the built-in templates — edit it to fit."); };
    ai(self, { kind: "behave", question: (st.name + " " + st.value + ". " + st.desc).trim(), mode: "pro", circuit: { parts: [], nets: [] }, code: st.behave.slice(0, 4000),
      pins: pins.map(function (p) { return { n: p.n, name: p.label, type: (st.pins[p.n] && st.pins[p.n].type) || "" }; }), errors: r && !r.ok ? r.errors.slice(0, 10) : [] })
      .then(function (j) { if (!j.behave) throw j; st.behave = String(j.behave).slice(0, 8000); tab(self, "behave"); var rr = check(self); msg(self, rr && rr.ok ? "Written by the AI, and it compiles." : "Written by the AI, but it needs a fix — see below.", !(rr && rr.ok)); })
      .catch(function (e) { fallback(e && e.offline ? "" : "The AI didn't answer. "); });
  }

  /* ----------------------------------------------------------- binding */

  function bind(self) {
    var d = self.d, st = self.st, app = self.app;
    d.querySelector('[data-a="close"]').addEventListener("click", function () { d.close(); });
    var fam = self.$('[data-a="fam"]');
    fam.addEventListener("change", function () { if (!fam.value) return; st.fam = fam.value; params(self); var f = FAM.filter(function (x) { return x.id === st.fam; })[0]; setFp(self, f.make(norm(st.par[f.id]))); });
    self.$('[data-a="words"]').addEventListener("change", function () { var f = FP.fromText(this.value); if (f) { st.fam = null; fam.value = ""; params(self); setFp(self, f); msg(self, "Made: " + f.name); } else msg(self, "I don't know that package. Try “SOIC-14”, “qfn 24 4x4”, “2x10 header”, “jst ph 3”, “usb c”…", true); });
    self.$('[data-a="lib"]').addEventListener("change", function () { if (!this.value) return; st.fam = null; fam.value = ""; params(self); setFp(self, FP.clone(FP.get(this.value))); });
    var open = self.$('[data-a="openmine"]'); if (open) open.addEventListener("change", function () { if (!this.value) return; d.close(); PM.open(app, { type: this.value }); });
    self.$('[data-a="describe"]').addEventListener("click", function () { var t = self.$(".pm-desc").value.trim(); if (t) describe(self, t); else self.$(".pm-desc").focus(); });
    self.$(".pm-desc").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); var t = this.value.trim(); if (t) describe(self, t); } });
    self.$('[data-a="names"]').addEventListener("change", function () { canvas(self); });
    self.$('[data-a="zin"]').addEventListener("click", function () { st.zoom = Math.min(12, st.zoom * 1.4); canvas(self); });
    self.$('[data-a="zout"]').addEventListener("click", function () { st.zoom = Math.max(0.5, st.zoom / 1.4); canvas(self); });
    d.querySelectorAll("[data-t]").forEach(function (b) { b.addEventListener("click", function () { tab(self, b.getAttribute("data-t")); }); });
    self.$('[data-a="addpad"]').addEventListener("click", function () {
      var fp = st.fp, last = fp.pads[fp.pads.length - 1], nums = fp.pads.map(function (p) { return parseInt(p.n, 10); }).filter(isFinite), n = nums.length ? Math.max.apply(null, nums) + 1 : 1;
      var p = last ? JSON.parse(JSON.stringify(last)) : { shape: "circle", w: 1.7, h: 1.7, drill: 0.9 };
      p.n = String(n); delete p.name; p.x = r3((last ? last.x : 0) + 2.54); p.y = last ? last.y : 0;
      fp.pads.push(p); st.pick = fp.pads.length - 1; canvas(self); padForm(self); tab(self, st.tab);
    });
    self.$('[data-a="addhole"]').addEventListener("click", function () { st.fp.holes.push({ x: r3((st.fp.court.x1) + 2), y: 0, d: 3.2 }); canvas(self); });
    self.$('[data-a="delpad"]').addEventListener("click", function () { if (st.pick == null || st.fp.pads.length < 2) return; st.fp.pads.splice(st.pick, 1); st.pick = null; canvas(self); padForm(self); tab(self, st.tab); });
    self.$('[data-a="renum"]').addEventListener("click", function () {
      /* round the outline, starting top left, the way chips count */
      var c = st.fp.pads.reduce(function (a, p) { return [a[0] + p.x / st.fp.pads.length, a[1] + p.y / st.fp.pads.length]; }, [0, 0]);
      var list = st.fp.pads.slice().sort(function (a, b) { var aa = Math.atan2(a.x - c[0], -(a.y - c[1])), bb = Math.atan2(b.x - c[0], -(b.y - c[1])); return bb - aa; });
      var start = list.reduce(function (best, p, i) { return p.x + p.y < list[best].x + list[best].y ? i : best; }, 0);
      list = list.slice(start).concat(list.slice(0, start));
      list.forEach(function (p, i) { p.n = String(i + 1); });
      canvas(self); tab(self, st.tab);
    });
    self.$('[data-a="kicad"]').addEventListener("click", function () {
      pick(".kicad_mod", function (text) { try { var f = FP.fromKicad(text); st.fam = null; fam.value = ""; params(self); setFp(self, f); st.name = f.name; msg(self, "Imported " + f.name + ": " + f.pads.length + " pads."); } catch (e) { msg(self, e.message, true); } });
    });
    self.$('[data-a="partfile"]').addEventListener("click", function () {
      pick(".json", function (text) {
        try { var j = JSON.parse(text), c = j.data || j; if (!c.fp || !c.fp.pads) throw new Error("That isn't a Chalk part file."); st.fp = c.fp; st.name = c.name || st.name; st.value = c.value || ""; st.ref = c.ref || "U"; st.cat = c.cat || "My parts"; st.look = c.look || "ic"; st.color = c.color || ""; st.desc = c.desc || ""; st.behave = c.behave || ""; st.pins = c.pins || {}; setFp(self, st.fp); msg(self, "Opened " + st.name + "."); }
        catch (e) { msg(self, e.message, true); }
      });
    });
    self.$('[data-a="export"]').addEventListener("click", function () {
      var dd = data(self), safe = dd.name.replace(/[^A-Za-z0-9_-]+/g, "_");
      L.Solid.download(dd.name + ".zip", L.Solid.zip([
        { name: safe + ".kicad_mod", data: FP.kicad(dd.fp, safe) },
        { name: safe + ".chalkpart.json", data: JSON.stringify({ format: "chalk-part", version: 1, data: dd }, null, 1) },
        { name: safe + ".svg", data: X.fpSvg(dd.fp, null, { labels: "name" }).replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" ') }
      ]), "application/zip");
      msg(self, "Exported: the KiCad footprint, a Chalk part file and a picture.");
    });
    var save = function (place) {
      var r = st.behave.trim() ? B.compile(st.behave, FP.pinAliases(benchPinsOf(st))) : null;
      if (r && !r.ok) { tab(self, "behave"); check(self); msg(self, "The behaviour has a problem — fix it, or clear it, before saving.", true); return; }
      if (!st.fp.pads.length) { msg(self, "A part needs at least one pad.", true); return; }
      var type = st.type || PM.typeFor(st.value || st.name), dd = data(self);
      PM.save(app, type, dd, function (ok, m) {
        app.toast((ok ? "Saved " : "Kept ") + dd.name + (ok ? " in your parts — it's in the drawer under " + dd.cat + "." : ". " + (m || "")));
        if (app.doc.parts.some(function (p) { return p.type === type; })) app.refresh();
        if (place) {
          var bc = app.bench.cam || { x: 0, y: 0 }, b = L.boxOf({ type: type, x: 0, y: 0, rot: 0, props: {} });
          if (app.studio && app.studio.space !== "bench") app.studio.setSpace("bench");
          app.addPart(type, bc.x - b.x - b.w / 2, bc.y - b.y - b.h / 2);
        }
        if (app.studio && app.studio.pcb && app.studio.pcb.sync) app.studio.pcb.sync();
      });
      d.close();
    };
    self.$('[data-a="save"]').addEventListener("click", function () { save(false); });
    self.$('[data-a="saveplace"]').addEventListener("click", function () { save(true); });
    var del = self.$('[data-a="delete"]');
    if (del) del.addEventListener("click", function () {
      if (!root.confirm("Delete " + st.name + " from your parts? Circuits that use it keep their own copy.")) return;
      PM.remove(app, st.type, function () { app.toast(st.name + " is no longer in your parts."); });
      d.close();
    });
  }
  function pick(accept, cb) {
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = accept;
    inp.addEventListener("change", function () { var f = inp.files && inp.files[0]; if (!f) return; var rd = new FileReader(); rd.onload = function () { cb(String(rd.result)); }; rd.readAsText(f); });
    inp.click();
  }
})(typeof window !== "undefined" ? window : globalThis);
