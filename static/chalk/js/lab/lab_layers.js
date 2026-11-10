/* Chalk Circuit Lab — the component list.
 *
 * Everything on the bench, as a list you can read. On a crowded design the
 * part you want is under a wire, or is three pixels of resistor between
 * two chips; here it has a name and a row of its own. Click a row to select
 * the part (its details open on the right), double-click to fly to it,
 * hover to see where it is. Each row can be renamed, hidden so you can see
 * what is underneath, or locked so a stray drag can't move it.
 *
 * Every part also gets a reference the way a schematic would give it one —
 * R1, D2, U1 — which the circuit board and the parts list both use, so
 * "R3" means the same resistor on the bench, on the PCB and in the BOM.
 *
 *   ChalkLab.refdes(doc)        {partId: "R1", …}
 *   ChalkLab.partValue(part)    "220 Ω", "red", …
 *   ChalkLab.bom(doc)           rows for the parts list
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var esc = L.esc;

  var PREFIX = [
    [/^(resistor|k_resistor)$/, "R"], [/^potentiometer$/, "RV"], [/^(ldr|k_ldr|thermistor)$/, "RT"],
    [/^capacitor/, "C"], [/^(led|k_led|rgb_led|diode)$/, "D"], [/^(npn|pnp|nmos)$/, "Q"],
    [/^(arduino|k_brain)/, "A"], [/^(ic|logic_ic|lm358)/, "U"], [/^(button|k_button|slide_switch|k_switch|tilt_switch)$/, "SW"],
    [/^(battery|k_battery|coin_cell|psu)/, "BT"], [/^(motor|k_motor|servo)$/, "M"], [/^(buzzer|k_buzzer|piezo)$/, "LS"],
    [/^(bulb|k_bulb)$/, "LA"], [/^relay/, "K"], [/^(seg7|lcd)/, "DS"], [/^(breadboard|perfboard|stripboard)/, "BB"],
    [/^(multimeter|scope)$/, "TP"]
  ];
  L.refPrefix = function (type) {
    for (var i = 0; i < PREFIX.length; i++) if (PREFIX[i][0].test(type)) return PREFIX[i][1];
    return "U";
  };

  /* References are numbered by a part's age, not its position in the list,
   * so adding a part never renumbers the ones already there. The order of
   * doc.parts is that age, except that boards are kept at the front. */
  L.refdes = function (doc) {
    var n = {}, out = {};
    (doc.parts || []).forEach(function (p) {
      var pre = L.refPrefix(p.type);
      n[pre] = (n[pre] || 0) + 1;
      out[p.id] = pre + n[pre];
    });
    return out;
  };

  L.partValue = function (part) {
    var d = L.def(part);
    if (!d) return "";
    var pr = L.propsOf(part);
    try { if (d.label) return String(d.label(pr) || ""); } catch (e) {}
    if (pr.ohms != null) return L.si(pr.ohms, "Ω");
    if (pr.farads != null) return L.si(pr.farads, "F");
    if (pr.color && typeof pr.color === "string" && pr.color.charAt(0) !== "#") return pr.color;
    if (pr.volts != null) return pr.volts + " V";
    if (pr.chip) return String(pr.chip);
    return "";
  };
  L.partTitle = function (part) { var d = L.def(part); return part.name || (d ? d.name.replace(/ \(.+\)$/, "") : part.type); };

  /* The parts list: like parts with like values on one row. */
  L.bom = function (doc) {
    var ref = L.refdes(doc), rows = {}, order = [];
    (doc.parts || []).forEach(function (p) {
      var d = L.def(p);
      if (!d || /^(multimeter|scope)$/.test(p.type)) return;
      var v = L.partValue(p), key = p.type + "|" + v;
      if (!rows[key]) { rows[key] = { refs: [], name: d.name, value: v, type: p.type, qty: 0 }; order.push(key); }
      rows[key].refs.push(ref[p.id]); rows[key].qty++;
    });
    return order.map(function (k) { return rows[k]; });
  };
  L.bomCsv = function (doc) {
    var q = function (s) { return '"' + String(s).replace(/"/g, '""') + '"'; };
    return "Qty,References,Part,Value\r\n" + L.bom(doc).map(function (r) { return [r.qty, q(r.refs.join(" ")), q(r.name), q(r.value)].join(","); }).join("\r\n") + "\r\n";
  };

  /* ------------------------------------------------------------ the panel */

  function Layers(app) {
    this.app = app;
    this.q = "";
    this.open = { parts: true, boards: true, wires: false };
    this.box = null;
  }
  L.Layers = Layers;

  var EYE = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M1.5 10S4.6 4.5 10 4.5 18.5 10 18.5 10 15.4 15.5 10 15.5 1.5 10 1.5 10z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="10" r="2.6" fill="currentColor"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M1.5 10S4.6 4.5 10 4.5 18.5 10 18.5 10 15.4 15.5 10 15.5 1.5 10 1.5 10z" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".5"/><path d="M3 17L17 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  var LOCK = '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><rect x="4" y="9" width="12" height="8.5" rx="2" fill="currentColor"/><path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  var UNLOCK = '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><rect x="4" y="9" width="12" height="8.5" rx="2" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".6"/><path d="M6.5 9V6.5a3.5 3.5 0 0 1 6.6-1.6" fill="none" stroke="currentColor" stroke-width="1.8" opacity=".6"/></svg>';
  var PEN = '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M3 17l1-4L14 3l3 3L7 16z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  Layers.prototype.endName = function (end, ref) {
    if (!end || !end.ref) return "loose end";
    var id = end.ref.split(":")[0], pin = end.ref.split(":").slice(1).join(":"), p = this.app.partById(id);
    if (!p) return "loose end";
    if (/^(breadboard|perfboard|stripboard)/.test(p.type)) return ref[id] + " hole " + pin;
    return ref[id] + "·" + pin;
  };

  Layers.prototype.rows = function () {
    var app = this.app, doc = app.doc, ref = L.refdes(doc), q = this.q.toLowerCase(), self = this;
    var parts = [], boards = [], wires = [];
    doc.parts.forEach(function (p) {
      var d = L.def(p);
      if (!d) return;
      var row = { kind: "part", id: p.id, ref: ref[p.id], title: L.partTitle(p), value: L.partValue(p), type: p.type, hide: !!p.hide, lock: !!p.lock };
      if (q && (row.ref + " " + row.title + " " + row.value + " " + d.name + " " + d.cat).toLowerCase().indexOf(q) < 0) return;
      (d.layer === "board" && !d.mcu ? boards : parts).push(row);
    });
    doc.wires.forEach(function (w, i) {
      var row = { kind: "wire", id: w.id, ref: "W" + (i + 1), title: self.endName(w.a, ref) + " → " + self.endName(w.b, ref), color: w.color || "#e8c22a" };
      if (q && (row.ref + " " + row.title + " wire").toLowerCase().indexOf(q) < 0) return;
      wires.push(row);
    });
    return { parts: parts, boards: boards, wires: wires };
  };

  Layers.prototype.render = function (box) {
    var self = this, app = this.app;
    this.box = box = box || this.box;
    if (!box) return;
    var sel = app.bench && app.bench.sel;
    if (sel && sel.kind === "wire") this.open.wires = true;
    var r = this.rows(), total = app.doc.parts.length + app.doc.wires.length;
    var h = '<label class="drawer-search"><span class="sr">Find on the bench</span><input type="search" id="layers-q" placeholder="Find — R1, LED, motor…" value="' + esc(this.q) + '"></label>';
    if (!total) h += '<div class="empty"><p class="big">Nothing on the bench yet.</p><p>Everything you add is listed here, so you can pick it by name instead of hunting for it with the pointer.</p></div>';
    var group = function (key, label, rows) {
      if (!rows.length) return "";
      var open = self.open[key] || !!self.q;
      var s = '<button type="button" class="ly-head" data-group="' + key + '" aria-expanded="' + open + '"><i aria-hidden="true">' + (open ? "▾" : "▸") + '</i>' + label + ' <span>' + rows.length + '</span></button>';
      if (!open) return s;
      s += '<ul class="ly-list" role="listbox" aria-label="' + label + '">';
      rows.forEach(function (row) {
        var on = sel && sel.kind === row.kind && sel.id === row.id;
        s += '<li class="ly-row' + (on ? " on" : "") + (row.hide ? " hidden-part" : "") + '" role="option" aria-selected="' + !!on + '" tabindex="' + (on ? 0 : -1) + '" data-kind="' + row.kind + '" data-id="' + row.id + '">';
        s += row.kind === "wire" ? '<span class="ly-ico"><i class="ly-wire" style="background:' + esc(row.color) + '"></i></span>' : '<span class="ly-ico">' + (L.thumb ? L.thumb(row.type) : "") + '</span>';
        s += '<span class="ly-text"><b>' + esc(row.ref) + '</b> ' + esc(row.title) + (row.value ? '<small>' + esc(row.value) + '</small>' : '') + '</span>';
        if (row.kind === "part") {
          s += '<span class="ly-acts">' +
            '<button type="button" data-ly="name" title="Rename" aria-label="Rename ' + esc(row.ref) + '">' + PEN + '</button>' +
            '<button type="button" data-ly="hide" title="' + (row.hide ? "Show it again" : "Hide it, to see what's underneath") + '" aria-pressed="' + row.hide + '" aria-label="Hide ' + esc(row.ref) + '">' + (row.hide ? EYE_OFF : EYE) + '</button>' +
            '<button type="button" data-ly="lock" title="' + (row.lock ? "Unlock it" : "Lock it in place") + '" aria-pressed="' + row.lock + '" aria-label="Lock ' + esc(row.ref) + '">' + (row.lock ? LOCK : UNLOCK) + '</button></span>';
        }
        s += '</li>';
      });
      return s + '</ul>';
    };
    h += group("parts", "Components", r.parts) + group("boards", "Boards", r.boards) + group("wires", "Wires", r.wires);
    if (total && !(r.parts.length + r.boards.length + r.wires.length)) h += '<p class="hint">Nothing matches “' + esc(this.q) + '”.</p>';
    if (total) h += '<div class="ly-foot"><button type="button" id="layers-showall">Show everything</button><button type="button" id="layers-bom" title="Download the parts list as a spreadsheet">Parts list (CSV)</button></div>' +
      '<p class="hint">Click to select · double-click to fly there · ↑ ↓ to walk the list</p>';
    box.innerHTML = h;

    var input = box.querySelector("#layers-q");
    input.addEventListener("input", function () {
      self.q = input.value; self.render();
      var i2 = self.box.querySelector("#layers-q"); i2.focus(); i2.setSelectionRange(i2.value.length, i2.value.length);
    });
    box.querySelectorAll(".ly-head").forEach(function (b) {
      b.addEventListener("click", function () { var k = b.getAttribute("data-group"); self.open[k] = !self.open[k]; self.render(); });
    });
    box.querySelectorAll(".ly-row").forEach(function (li) {
      var kind = li.getAttribute("data-kind"), id = li.getAttribute("data-id");
      li.addEventListener("click", function (e) {
        var act = e.target.closest("[data-ly]");
        if (act) { self.act(id, act.getAttribute("data-ly")); return; }
        self.pick(kind, id, false);
      });
      li.addEventListener("dblclick", function (e) { if (!e.target.closest("[data-ly]")) self.pick(kind, id, true); });
      li.addEventListener("pointerenter", function () { self.hover(kind, id); });
      li.addEventListener("pointerleave", function () { self.hover(null); });
      li.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault(); e.stopPropagation();
          var all = Array.prototype.slice.call(self.box.querySelectorAll(".ly-row")), i = all.indexOf(li) + (e.key === "ArrowDown" ? 1 : -1);
          if (all[i]) { self.pick(all[i].getAttribute("data-kind"), all[i].getAttribute("data-id"), false); var n = self.box.querySelector(".ly-row.on"); if (n) n.focus(); }
        } else if (e.key === "Enter") { e.preventDefault(); self.pick(kind, id, true); }
      });
    });
    var all = box.querySelector("#layers-showall");
    if (all) all.addEventListener("click", function () {
      app.edit(function () { app.doc.parts.forEach(function (p) { delete p.hide; }); });
      self.render();
    });
    var bom = box.querySelector("#layers-bom");
    if (bom) bom.addEventListener("click", function () { L.Solid.download((app.title || "circuit") + " — parts list.csv", L.bomCsv(app.doc), "text/csv"); });
  };

  Layers.prototype.pick = function (kind, id, fly) {
    var app = this.app;
    if (app.studio && app.studio.pick(kind, id, fly)) return;
    if (kind === "part" && fly) { app.focusPart(id); return; }
    app.bench.select({ kind: kind, id: id });
    if (kind === "part") {
      var p = app.partById(id), pins = p ? L.pinsOf(p) : [];
      if (pins.length) app.bench.ripple(pins[0].key, null, "#ff8a5a");
      app.bench.reveal(id);
    } else if (fly) app.bench.revealWire(id);
  };

  Layers.prototype.hover = function (kind, id) {
    this.app.bench.hoverMark(kind, id);
    if (this.app.studio) this.app.studio.hover(kind, id);
  };

  Layers.prototype.act = function (id, what) {
    var app = this.app, p = app.partById(id), self = this;
    if (!p) return;
    if (what === "name") {
      L.promptBox("A name for this " + L.def(p).name.toLowerCase() + " — leave it empty to go back to the usual one.", p.name || "", "Rename").then(function (v) {
        if (v == null) return;
        app.edit(function () { v = v.trim().slice(0, 40); if (v) p.name = v; else delete p.name; });
        self.render();
      });
      return;
    }
    app.edit(function () {
      if (what === "hide") { if (p.hide) delete p.hide; else p.hide = true; }
      if (what === "lock") { if (p.lock) delete p.lock; else p.lock = true; }
    });
    if (what === "hide" && p.hide && app.bench.sel && app.bench.sel.id === id) app.bench.select(null);
    this.render();
  };

  /* Called whenever the bench changes or its selection moves. */
  Layers.prototype.sync = function () {
    if (!this.box || !this.box.isConnected) return;
    var a = document.activeElement;
    if (a && a.id === "layers-q") return;      /* don't pull the list from under someone typing */
    var keep = a && a.classList && a.classList.contains("ly-row"), top = this.box.parentNode ? this.box.parentNode.scrollTop : 0;
    this.render();
    if (this.box.parentNode) this.box.parentNode.scrollTop = top;
    var on = this.box.querySelector(".ly-row.on");
    if (on) { if (keep) on.focus(); if (on.scrollIntoView) on.scrollIntoView({ block: "nearest" }); }
  };
})(typeof window !== "undefined" ? window : globalThis);
