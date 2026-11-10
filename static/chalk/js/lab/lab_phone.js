/* Chalk Circuit Lab — the phone.
 *
 * A Bluetooth controller app, the kind every Arduino Bluetooth tutorial
 * uses: pair with the HC-05, then send characters with buttons, a slider
 * or by typing, and read what the Arduino sends back. It appears in the
 * side panel whenever a Bluetooth module is on the bench.
 *
 * What each control sends (the conventions those apps use):
 *   arrows  F B L R, and S for stop      ON / OFF  1 and 0
 *   A / B   A and B                      slider    v and the value, e.g. v128
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var esc = L.esc;

  function Phone(app) {
    this.app = app;
    this.side = document.getElementById("lab-side");
    var tabs = this.side.querySelector(".tabs");
    this.tab = document.createElement("button");
    this.tab.setAttribute("role", "tab");
    this.tab.setAttribute("data-side", "phone");
    this.tab.setAttribute("aria-selected", "false");
    this.tab.hidden = true;
    this.tab.textContent = "Phone";
    tabs.insertBefore(this.tab, tabs.querySelector(".side-fold"));
    var self = this;
    this.tab.addEventListener("click", function () { app.panels.showSide("phone"); self.render(); });
    this.pane = document.createElement("section");
    this.pane.className = "pane";
    this.pane.setAttribute("data-pane", "phone");
    this.pane.hidden = true;
    this.side.appendChild(this.pane);
    this.log = [];
    app.sim.onPhone = function (id, text) { self.receive(id, text); };
    this.render();
  }
  L.Phone = Phone;

  Phone.prototype.modules = function () { return this.app.doc.parts.filter(function (p) { return p.type === "hc05"; }); };

  /* Show the tab only when there is something to pair with. */
  Phone.prototype.refresh = function () {
    var has = this.modules().length > 0;
    if (this.tab.hidden === has) {
      this.tab.hidden = !has;
      if (has && !this.introduced) { this.introduced = true; this.app.toast("A Bluetooth module is on the bench — the Phone tab can pair with it."); }
      if (!has && this.app.panels.sideTab === "phone") this.app.panels.showSide("inspect");
    }
    if (this.app.panels.sideTab === "phone") this.render();
  };

  Phone.prototype.target = function () {
    var list = this.modules();
    if (!list.some(function (p) { return p.id === this.sel; }, this)) this.sel = list[0] ? list[0].id : null;
    return this.sel;
  };
  Phone.prototype.paired = function () { var id = this.target(); return !!(id && this.app.sim.bt && this.app.sim.bt[id]); };

  Phone.prototype.render = function () {
    var self = this, app = this.app, list = this.modules(), id = this.target(), paired = this.paired();
    var st = id ? (app.sim.state[id] || {}) : {};
    var status = !app.running ? "Switch the power on to pair." : !st.on ? "The module has no power — check VCC and GND." : paired ? "Connected" : "Not connected";
    var h = '<div class="phone"><div class="phone-frame' + (paired ? " on" : "") + '">' +
      '<div class="phone-notch" aria-hidden="true"></div>' +
      '<header class="phone-head"><b>BT Controller</b><span class="phone-state">' + esc(status) + '</span></header>' +
      '<div class="phone-dev">' +
        (list.length > 1 ? '<select data-ph="dev" aria-label="Module">' + list.map(function (p, i) { return '<option value="' + p.id + '"' + (p.id === id ? " selected" : "") + '>HC-05 ' + (i + 1) + '</option>'; }).join("") + '</select>' : '<span class="phone-name">HC-05</span>') +
        '<button type="button" data-ph="pair" class="' + (paired ? "" : "primary") + '"' + (app.running && st.on ? "" : " disabled") + '>' + (paired ? "Disconnect" : "Connect") + '</button>' +
      '</div>' +
      '<div class="phone-pad" role="group" aria-label="Direction pad">' +
        '<button type="button" data-send="F" class="up" aria-label="Forward (F)">▲</button>' +
        '<button type="button" data-send="L" class="left" aria-label="Left (L)">◀</button>' +
        '<button type="button" data-send="S" class="stop" aria-label="Stop (S)">■</button>' +
        '<button type="button" data-send="R" class="right" aria-label="Right (R)">▶</button>' +
        '<button type="button" data-send="B" class="down" aria-label="Back (B)">▼</button>' +
      '</div>' +
      '<div class="phone-keys"><button type="button" data-send="1" class="onb">ON · 1</button><button type="button" data-send="0">OFF · 0</button>' +
        '<button type="button" data-send="A">A</button><button type="button" data-send="B">B</button></div>' +
      '<label class="phone-slider"><span>Slider <output>' + (this.slider || 0) + '</output></span><input type="range" min="0" max="255" value="' + (this.slider || 0) + '" data-ph="slider"></label>' +
      '<div class="phone-log" aria-live="polite">' + this.log.map(function (m) { return '<p class="' + m.who + '">' + esc(m.text) + '</p>'; }).join("") + '</div>' +
      '<form class="phone-send" data-ph="form"><input placeholder="Type a message" aria-label="Message to send" autocomplete="off"><button type="submit">Send</button></form>' +
      '</div><p class="hint">' + (paired ? "Every button sends one character to the Arduino. Your program decides what it means." : "This is a phone app talking to the module by Bluetooth. The module passes what it gets to the Arduino through its TXD pin.") + '</p></div>';
    this.pane.innerHTML = h;
    var q = function (sel) { return self.pane.querySelector(sel); };
    var dev = q('[data-ph="dev"]');
    if (dev) dev.addEventListener("change", function () { self.sel = dev.value; self.render(); });
    q('[data-ph="pair"]').addEventListener("click", function () { self.pair(!self.paired()); });
    this.pane.querySelectorAll("[data-send]").forEach(function (b) {
      b.addEventListener("click", function () { self.send(b.getAttribute("data-send")); });
    });
    var slider = q('[data-ph="slider"]');
    slider.addEventListener("input", function () {
      self.slider = +slider.value;
      slider.parentNode.querySelector("output").textContent = slider.value;
      clearTimeout(self.slT);
      self.slT = setTimeout(function () { self.send("v" + slider.value + "\n"); }, 120);
    });
    q('[data-ph="form"]').addEventListener("submit", function (e) {
      e.preventDefault();
      var inp = this.querySelector("input");
      if (!inp.value) return;
      self.send(inp.value + "\n");
      inp.value = "";
    });
    var logEl = q(".phone-log");
    logEl.scrollTop = logEl.scrollHeight;
  };

  Phone.prototype.pair = function (on) {
    var app = this.app, id = this.target();
    if (!id) return;
    app.sim.bt = app.sim.bt || {};
    if (on) { app.sim.bt[id] = true; this.note("Connected to HC-05"); app.sound("on"); }
    else { delete app.sim.bt[id]; this.note("Disconnected"); }
    this.render();
  };
  Phone.prototype.send = function (text) {
    var app = this.app, id = this.target();
    if (!this.paired()) { this.note("Not connected — tap Connect first."); this.render(); return; }
    if (!app.sim.phoneSend(id, text)) { this.note("Couldn't send — is the module powered?"); this.render(); return; }
    this.log.push({ who: "me", text: text.replace(/\n$/, "") });
    this.trim();
    this.render();
  };
  /* Text from the Arduino, arriving through the module. */
  Phone.prototype.receive = function (id, text) {
    if (id !== this.target()) return;
    this.buf = (this.buf || "") + text;
    var parts = this.buf.split("\n");
    this.buf = parts.pop();
    var self = this;
    parts.forEach(function (ln) { self.log.push({ who: "them", text: ln.replace(/\r$/, "") }); });
    if (this.buf.length > 60) { this.log.push({ who: "them", text: this.buf }); this.buf = ""; }
    this.trim();
    if (this.app.panels.sideTab === "phone") this.render();
    else if (parts.length) { this.tab.classList.add("ping"); var t = this.tab; setTimeout(function () { t.classList.remove("ping"); }, 900); }
  };
  Phone.prototype.note = function (text) { this.log.push({ who: "sys", text: text }); this.trim(); };
  Phone.prototype.trim = function () { if (this.log.length > 80) this.log.splice(0, this.log.length - 80); };
  /* Power off: the link drops, as it would. */
  Phone.prototype.drop = function () {
    var had = this.app.sim.bt && Object.keys(this.app.sim.bt).length;
    this.app.sim.bt = {};
    if (had) this.note("Disconnected — the module lost power");
    this.buf = "";
    if (this.app.panels.sideTab === "phone") this.render();
  };
})(typeof window !== "undefined" ? window : globalThis);
