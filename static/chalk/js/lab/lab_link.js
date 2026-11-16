/* Chalk Circuit Lab — Chalk Link, the lab's end of the board's web API.
 *
 * A board can open a Link: a web address with a table of named values
 * ("tags") behind it (chalk/link.py). While the lab is open this file
 * keeps the bench and that table in step, a couple of times a second:
 *
 *   out   what simulated parts are doing is published
 *           d1.on  d1.brightness  servo1.angle  ls1.hz  m1.rpm  k1.on …
 *   in    what the world writes is applied to the bench's inputs
 *           sw1.pressed  pir1.motion  sonar1.cm  rt1.light  rv1.pos …
 *   free  any other tag belongs to the programs: a simulated Pi reads and
 *         writes them with `from chalklink import Link` or the `link`
 *         command, exactly as a real Pi does with chalklink.py
 *
 * So three things become interchangeable. Your own software reads the
 * tags as its inputs and writes them as commands, and cannot tell — and
 * need not care — whether the project on the other side is this
 * simulation or a real board on a desk. A real board and the simulation
 * can also face each other: press the real button, the simulated one goes
 * down; the simulated LED lights, the real one follows.
 *
 * A part's tags are named after it: the name you gave it in Layers, or its
 * reference (D1, SW1) in lower case. The Link panel lists them all.
 *
 *   app.link.store()   {get, set, all, online, url} — what a Pi is handed
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab, esc = L.esc;
  if (typeof document === "undefined") return;
  var RATE = 420;      /* ms between rounds */

  function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24); }
  function same(a, b) { return a === b && typeof a === typeof b; }
  function show(v) { return v === true ? "true" : v === false ? "false" : v == null ? "null" : typeof v === "number" ? String(Math.round(v * 1000) / 1000) : '"' + v + '"'; }
  function parse(t) { var s = t.trim(), low = s.toLowerCase(); return /^(true|on|yes)$/.test(low) ? true : /^(false|off|no)$/.test(low) ? false : /^(null|none|)$/.test(low) ? null : /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : s.replace(/^"(.*)"$/, "$1"); }

  function Link(app) {
    var self = this;
    this.app = app;
    this.manageUrl = app.cfg.linkUrl || null;
    this.url = null; this.key = null;
    this.tags = {};           /* name -> {value, seq, by, at}: the server's table as last seen */
    this.local = {};          /* tags written here while there is no link: programs still work */
    this.outbox = {};         /* written here, not yet sent */
    this.sent = {};           /* last value published for each of the bench's own tags */
    this.seq = 0; this.primed = false; this.busy = false;
    this.status = this.manageUrl ? "closed" : "none"; this.note = "";
    this.live = true;
    try { this.live = root.localStorage.getItem("chalklab.link.live") !== "0"; } catch (e) {}
    this.button();
    if (this.manageUrl) this.manage(null);
    setInterval(function () { self.round(); }, RATE);
  }
  L.Link = Link;

  /* What a simulated Pi sees. Always usable: with no link the values simply stay here. */
  Link.prototype.store = function () {
    var self = this;
    return {
      get: function (n) { return n in self.outbox ? self.outbox[n] : self.tags[n] ? self.tags[n].value : self.local[n]; },
      set: function (n, v) { self.local[n] = v; if (self.url) self.outbox[n] = v; },
      all: function () { var o = {}, k; for (k in self.local) o[k] = self.local[k]; for (k in self.tags) o[k] = self.tags[k].value; for (k in self.outbox) o[k] = self.outbox[k]; return o; },
      online: function () { return self.status === "online" && self.live; },
      url: function () { return self.url; }
    };
  };

  /* ------------------------------------------------------- the bench's tags */

  var ROUND = function (v, d) { var m = Math.pow(10, d || 0); return Math.round(v * m) / m; };
  Link.prototype.bindings = function () {
    var app = this.app, sim = app.sim, doc = app.doc, ref = L.refdes ? L.refdes(doc) : {}, out = [], used = {};
    doc.parts.forEach(function (p) {
      var d = L.def(p);
      if (!d || /^(breadboard|perfboard|stripboard)/.test(p.type)) return;
      var base = slug(p.name) || slug(ref[p.id]) || slug(p.type);
      if (used[base]) { var n = 2; while (used[base + "_" + n]) n++; base = base + "_" + n; }
      used[base] = 1;
      var st = function () { return sim.state[p.id] || {}; }, t = p.type;
      var O = function (k, read, what) { out.push({ tag: base + "." + k, part: p, dir: "out", read: read, what: what }); };
      var I = function (k, read, apply, what) { out.push({ tag: base + "." + k, part: p, dir: "in", read: read, apply: apply, what: what }); };
      if (/^(led|k_led|bulb|k_bulb|rgb_led)$/.test(t)) { O("on", function () { return (st().b || 0) > 0.12; }, "is it lit"); if (t !== "rgb_led") O("brightness", function () { return ROUND(Math.min(1, st().b || 0), 2); }, "0 to 1"); }
      else if (/^(buzzer|k_buzzer|piezo|speaker)$/.test(t)) { O("on", function () { return !!st().sound; }, "is it sounding"); if (t !== "buzzer" && t !== "k_buzzer") O("hz", function () { return Math.round(st().sound || 0); }, "the note, in hertz"); }
      else if (t === "servo") O("angle", function () { return Math.round(st().ang == null ? 90 : st().ang); }, "degrees");
      else if (/^(motor|k_motor)$/.test(t)) O("rpm", function () { return Math.round(Math.abs(st().w || 0) * 60 / (2 * Math.PI) / 10) * 10; }, "turns a minute");
      else if (/^relay/.test(t)) O("on", function () { return !!st().on; }, "has it clicked over");
      else if (t === "multimeter") O("reading", function () { var v = parseFloat(st().text); return isFinite(v) ? v : null; }, "what the meter shows");
      if (d.press) I("pressed", function () { return !!sim.pressed[p.id]; }, function (v) { if (v) sim.pressed[p.id] = true; else delete sim.pressed[p.id]; }, "true while held");
      if (d.toggle) I(d.toggle, function () { return !!L.propsOf(p)[d.toggle]; }, function (v) { p.props = p.props || {}; p.props[d.toggle] = !!v; app.bench.renderPart(p); }, "true or false");
      if (!d.computer) (d.spec || []).forEach(function (sp) {
        if (sp.type !== "range" && sp.type !== "bool") return;
        I(sp.k, function () { var v = L.propsOf(p)[sp.k]; return sp.type === "bool" ? !!v : v; }, function (v) {
          if (sp.type === "bool") v = !!v;
          else { v = typeof v === "number" ? v : parseFloat(v); if (!isFinite(v)) return; v = L.clamp(v, sp.min, sp.max); }
          p.props = p.props || {}; p.props[sp.k] = v;
          app.bench.renderPart(p);
          if (sp.rebuild) { sim.invalidate(); app.bench.indexPins(); }
        }, sp.type === "bool" ? "true or false" : sp.min + " to " + sp.max + (sp.unit ? " " + sp.unit : ""));
      });
    });
    return out;
  };

  /* ------------------------------------------------------------- the round */

  Link.prototype.fail = function (msg) { this.status = "error"; this.note = msg; this.paint(); };
  Link.prototype.call = function (path, body) {
    return fetch(this.url + path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" } : { cache: "no-store" })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); });
  };
  Link.prototype.round = function () {
    var self = this, app = this.app;
    if (!this.url || !this.live || this.busy || document.hidden) { if (this.dlg) this.table(); return; }
    this.busy = true;
    var binds = this.bindings(), byTag = {};
    binds.forEach(function (b) { byTag[b.tag] = b; });
    this.call("tags/?since=" + this.seq).then(function (r) {
      if (r.status === 404) { self.url = null; self.manage(null); throw { quiet: true }; }
      if (r.status !== 200) throw { msg: (r.j && r.j.error) || "The server answered " + r.status };
      var got = r.j.tags || {};
      Object.keys(got).forEach(function (name) {
        var e = got[name], b = byTag[name];
        self.tags[name] = e;
        delete self.local[name];
        /* somebody else wrote one of the bench's inputs: do as it says */
        if (self.primed && b && b.dir === "in" && e.by !== "sim" && !same(b.read(), e.value)) { b.apply(e.value); self.sent[name] = b.read(); self.flash(b); }
      });
      self.seq = r.j.seq || self.seq;
      self.primed = true;
      /* then say what has changed here */
      var send = {}, any = false;
      binds.forEach(function (b) {
        if (b.dir === "out" && !app.running) return;
        var v = b.read();
        if (v === undefined || same(self.sent[b.tag], v)) return;
        self.sent[b.tag] = v;
        if (self.tags[b.tag] && same(self.tags[b.tag].value, v)) return;
        send[b.tag] = v; any = true;
      });
      var box = self.outbox; self.outbox = {};
      Object.keys(box).forEach(function (k) { if (!self.tags[k] || !same(self.tags[k].value, box[k])) { send[k] = box[k]; any = true; } });
      if (!any) return null;
      return self.call("tags/", { values: send, by: "sim" }).then(function (w) {
        if (w.status !== 200) throw { msg: (w.j && w.j.error) || "The server would not take the values" };
        Object.keys(send).forEach(function (k) { self.tags[k] = { name: k, value: send[k], by: "sim", seq: w.j.seq, at: new Date().toISOString() }; });
      });
    }).then(function () { if (self.status !== "online") { self.status = "online"; self.note = ""; self.paint(); } })
      .catch(function (e) { if (e && e.quiet) return; self.status = "error"; self.note = (e && e.msg) || "Can't reach the server — will keep trying."; self.paint(); })
      .then(function () { self.busy = false; if (self.dlg) self.table(); });
  };
  /* a ring on the part an outside write just moved, so the class sees where it landed */
  Link.prototype.flash = function (b) {
    var pins = L.pinsOf(b.part);
    if (pins.length && this.app.bench.ripple) this.app.bench.ripple(pins[0].key, "⇄ " + b.tag.split(".").pop(), "#7fd4ff");
  };

  /* ------------------------------------------------------ open, rotate, close */

  Link.prototype.manage = function (action) {
    var self = this, app = this.app;
    if (!this.manageUrl) return Promise.resolve();
    return fetch(this.manageUrl, action ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": app.cfg.csrf }, body: JSON.stringify({ action: action }) } : { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || "That didn't work.");
        var was = self.key;
        self.key = j.open ? j.key : null; self.url = j.open ? j.url : null;
        if (self.key !== was || action === "clear") { self.tags = {}; self.sent = {}; self.seq = 0; self.primed = false; }
        self.status = j.open ? (self.status === "online" && self.key === was ? "online" : "connecting") : "closed";
        self.note = "";
        self.paint();
        if (self.dlg) self.draw();
      })
      .catch(function (e) { self.fail(e.message || "Can't reach the server."); });
  };

  /* ---------------------------------------------------------------- the UI */

  Link.prototype.button = function () {
    var self = this, host = document.querySelector(".lab-top .top-right"), ai = document.getElementById("lab-ai");
    if (!host) return;
    var b = this.btn = document.createElement("button");
    b.type = "button"; b.id = "lab-link"; b.className = "lk-btn";
    b.title = "Chalk Link: a web API for this board — connect your own software, or a real Raspberry Pi or ESP32";
    b.innerHTML = '<i class="lk-dot" aria-hidden="true"></i><span>Link</span>';
    host.insertBefore(b, ai || null);
    b.addEventListener("click", function () { self.open(); });
    this.paint();
  };
  Link.prototype.paint = function () {
    if (this.btn) this.btn.setAttribute("data-s", !this.live && this.url ? "paused" : this.status);
    if (this.dlg) { var s = this.dlg.querySelector("#lk-status"); if (s) s.innerHTML = this.statusHtml(); }
  };
  Link.prototype.statusHtml = function () {
    var word = { none: "not available here", closed: "no link yet", connecting: "connecting…", online: this.live ? "live" : "paused", error: "trouble" }[this.status];
    return '<i class="lk-dot" data-s="' + (!this.live && this.url ? "paused" : this.status) + '"></i> ' + esc(word) + (this.note ? ' <span class="bad">' + esc(this.note) + '</span>' : "");
  };

  var staticBase = (function () { var s = document.querySelector('script[src*="lab_link.js"]'); return s ? s.getAttribute("src").split("?")[0].replace(/js\/lab\/lab_link\.js$/, "link/") : "/static/chalk/link/"; })();

  Link.prototype.samples = function () {
    var u = this.url, pick = this.bindings(), outTag = (pick.filter(function (b) { return b.dir === "out"; })[0] || { tag: "d1.on" }).tag, inTag = (pick.filter(function (b) { return b.dir === "in"; })[0] || { tag: "sw1.pressed" }).tag;
    return {
      curl: "# every tag, as plain name: value\ncurl '" + u + "tags/?flat=1'\n\n# write one (this presses the simulated button, if the lab is open)\ncurl -X POST '" + u + "tags/' \\\n     -H 'Content-Type: application/json' \\\n     -d '{\"values\": {\"" + inTag + "\": true}, \"by\": \"my-app\"}'\n\n# one tag, as a bare value — and the write-by-URL form for tiny devices\ncurl '" + u + "tags/" + outTag + "/?raw=1'\ncurl '" + u + "set/?lamp=on&by=my-app'\n\n# what changed, in order\ncurl '" + u + "events/'",
      python: "# On a real Raspberry Pi. Download chalklink.py (button below) next to this file.\n# The same program runs on the lab's simulated Pi, where Link() needs no address.\nfrom chalklink import Link\nfrom gpiozero import LED, Button\nfrom signal import pause\n\nlink = Link(\"" + u + "\")\nled = LED(17)\nbutton = Button(2)\n\n# the world -> this Pi: whoever sets \"lamp\" switches the real LED\nlink.when_changed(\"lamp\", lambda on: led.on() if on else led.off())\n\n# this Pi -> the world: publish the real button\nbutton.when_pressed = lambda: link.send(\"doorbell\", True)\nbutton.when_released = lambda: link.send(\"doorbell\", False)\n\n# a twin: the real LED follows the simulated one, the simulated button follows the real one\n# link.when_changed(\"" + outTag + "\", lambda on: led.on() if on else led.off())\n# button.when_pressed = lambda: link.send(\"" + inTag + "\", True)\n\npause()",
      esp32: "// The full sketch is in chalklink_esp32.ino (button below). The heart of it:\nconst String LINK = \"" + u + "\";\n\nvoid loop() {\n  // obey: the tag \"lamp\" decides the real LED       (…/tags/lamp/?raw=1 answers 1 or 0)\n  digitalWrite(LED, fetch(\"tags/lamp/?raw=1\") == \"1\" ? HIGH : LOW);\n\n  // report: publish the real button                 (…/set/?name=value writes with a GET)\n  bool pressed = digitalRead(BUTTON) == LOW;\n  if (pressed != wasPressed) {\n    wasPressed = pressed;\n    fetch(String(\"set/?doorbell=\") + (pressed ? \"1\" : \"0\") + \"&by=esp32\");\n  }\n  delay(400);\n}",
      js: "// From your own web page or Node server: no key header, no cookie — the address is the key.\nconst LINK = \"" + u + "\";\n\n// inputs from the project: poll for what changed since last time\nlet seq = 0;\nsetInterval(async () => {\n  const r = await (await fetch(LINK + \"tags/?since=\" + seq)).json();\n  seq = r.seq;\n  for (const [name, tag] of Object.entries(r.tags)) console.log(name, \"=\", tag.value, \"from\", tag.by);\n}, 500);\n\n// commands to the project\nfunction send(values) {\n  return fetch(LINK + \"tags/\", {\n    method: \"POST\",\n    headers: { \"Content-Type\": \"application/json\" },\n    body: JSON.stringify({ values, by: \"my-platform\" }),\n  });\n}\nsend({ \"" + inTag + "\": true, lamp: true });"
    };
  };

  Link.prototype.open = function () {
    var self = this;
    if (this.dlg) return;
    var d = this.dlg = document.createElement("dialog");
    d.className = "dlg lk";
    document.body.appendChild(d);
    d.addEventListener("close", function () { d.remove(); self.dlg = null; });
    this.tab = this.tab || "curl";
    this.draw();
    d.showModal();
  };

  Link.prototype.draw = function () {
    var self = this, d = this.dlg, app = this.app;
    if (!d) return;
    var top = '<form method="dialog" class="dlg-top"><h2>Chalk Link <small>a web API for this board</small></h2><button value="close" aria-label="Close">×</button></form>';
    if (!this.manageUrl) { d.innerHTML = top + '<div class="lk-body"><p class="lk-lede">Chalk Link needs the lab to be opened from a saved board. In this stand-alone copy, a Raspberry Pi\'s <code>chalklink</code> values simply stay in the page.</p></div>'; return; }
    if (!this.url) {
      d.innerHTML = top + '<div class="lk-body"><div class="lk-hero">' +
        '<div class="lk-diagram" aria-hidden="true"><span class="n sim">This simulation</span><span class="w"></span><span class="n hub">Chalk Link<small>named values</small></span><span class="w"></span><span class="n app">Your software</span><span class="w down"></span><span class="n dev">A real Pi or ESP32</span></div>' +
        '<p class="lk-lede">Open a link and this board gets a web address with a table of named values behind it. The bench publishes what its parts are doing and obeys what is written for its inputs — so your own software, or a real board on the desk, can read this project and drive it. Swap the simulation for the real thing later and nothing on the other side has to change.</p>' +
        '<button type="button" class="primary" id="lk-open">Open a link for this board</button><p class="hint" id="lk-status">' + this.statusHtml() + '</p></div></div>';
      d.querySelector("#lk-open").addEventListener("click", function () { this.disabled = true; self.manage("open"); });
      return;
    }
    var s = this.samples(), tabs = [["curl", "curl"], ["python", "Python · real Pi"], ["esp32", "ESP32 · Arduino"], ["js", "JavaScript"]];
    d.innerHTML = top + '<div class="lk-body">' +
      '<div class="lk-addr"><label for="lk-url">This board\'s address — whoever has it can read and write the tags, so treat it like a password</label>' +
        '<div class="lk-row"><input id="lk-url" readonly value="' + esc(this.url) + '"><button type="button" id="lk-copy">Copy</button>' +
        '<label class="lk-live" title="Pause to stop the bench talking to the link"><input type="checkbox" id="lk-live"' + (this.live ? " checked" : "") + '> Live</label></div>' +
        '<p class="hint" id="lk-status">' + this.statusHtml() + '</p></div>' +
      '<h3>Tags <small>what is on the table right now</small></h3>' +
      '<div class="lk-table-wrap"><table class="lk-table"><thead><tr><th>Tag</th><th>Value</th><th>What it is</th><th>Last written by</th><th></th></tr></thead><tbody id="lk-rows"></tbody></table></div>' +
      '<form class="lk-add" id="lk-add"><input id="lk-name" placeholder="a tag of your own, e.g. lamp" maxlength="48" autocomplete="off" aria-label="Tag name"><input id="lk-val" placeholder="value: 1, 21.5, on, hello" autocomplete="off" aria-label="Value"><button type="submit">Write it</button></form>' +
      '<p class="hint">The simulation runs in this page: the bench’s own tags are live only while the lab is open' + (app.running ? "" : " and <b>switched on</b>") + '. Tags of your own stay on the server either way.</p>' +
      '<h3>Use it from <small>copy, paste, run</small></h3>' +
      '<div class="lk-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (self.tab === t[0]) + '">' + t[1] + '</button>'; }).join("") + '</div>' +
      '<pre class="lk-code" id="lk-code" tabindex="0"></pre>' +
      '<div class="lk-row lk-files"><button type="button" id="lk-copy-code">Copy the code</button><a class="lk-dl" href="' + esc(staticBase) + 'chalklink.py" download>chalklink.py <small>for a real Pi</small></a><a class="lk-dl" href="' + esc(staticBase) + 'chalklink_esp32.ino" download>chalklink_esp32.ino <small>for an ESP32</small></a></div>' +
      '<details class="lk-danger"><summary>Reset</summary><div class="lk-row"><button type="button" data-act="clear">Forget every tag</button><button type="button" data-act="rotate" class="danger">New address (cuts off every device)</button><button type="button" data-act="close" class="danger">Close the link</button></div></details>' +
      '</div>';
    var code = d.querySelector("#lk-code"), setTab = function (t) { self.tab = t; code.textContent = s[t]; d.querySelectorAll("[data-tab]").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === t)); }); };
    setTab(this.tab);
    d.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); }); });
    var copy = function (text, btn) { var done = function () { var was = btn.textContent; btn.textContent = "Copied"; setTimeout(function () { btn.textContent = was; }, 1200); }; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {}); else { var u = d.querySelector("#lk-url"); u.select(); try { document.execCommand("copy"); done(); } catch (e) {} } };
    d.querySelector("#lk-copy").addEventListener("click", function () { copy(self.url, this); });
    d.querySelector("#lk-copy-code").addEventListener("click", function () { copy(s[self.tab], this); });
    d.querySelector("#lk-live").addEventListener("change", function () { self.live = this.checked; try { root.localStorage.setItem("chalklab.link.live", self.live ? "1" : "0"); } catch (e) {} self.paint(); });
    d.querySelector("#lk-add").addEventListener("submit", function (e) {
      e.preventDefault();
      var n = d.querySelector("#lk-name"), v = d.querySelector("#lk-val"), name = n.value.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_.\-]{0,47}$/.test(name)) { n.setCustomValidity("Use a-z, 0-9, dot, dash and underscore"); n.reportValidity(); return; }
      n.setCustomValidity("");
      self.write(name, parse(v.value));
      n.value = ""; v.value = "";
    });
    d.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var act = b.getAttribute("data-act"), ask = { clear: ["Forget every tag on this link? The bench will publish its own again.", "Forget them"], rotate: ["Give this board a new address? Every device and program using the old one stops working until you give it the new one.", "New address"], close: ["Close this board's link? Its address stops working and its tags are deleted.", "Close it"] }[act];
        L.confirmBox(ask[0], ask[1], "Cancel").then(function (ok) { if (ok) self.manage(act); });
      });
    });
    d.querySelector("#lk-rows").addEventListener("click", function (e) {
      var b = e.target.closest("[data-set]"); if (!b) return;
      var name = b.getAttribute("data-set"), cur = self.tags[name] ? self.tags[name].value : null;
      if (typeof cur === "boolean" || b.getAttribute("data-bool")) { self.write(name, !cur); return; }
      L.promptBox("New value for " + name, cur == null ? "" : String(cur), "Write it").then(function (v) { if (v != null) self.write(name, parse(v)); });
    });
    this.table();
  };
  /* A value typed into the panel: written as "lab", so the bench treats it like any outside hand. */
  Link.prototype.write = function (name, value) {
    var self = this, body = { values: {}, by: "lab" };
    body.values[name] = value;
    this.call("tags/", body).then(function (r) { if (r.status !== 200) self.app.toast((r.j && r.j.error) || "The link would not take that."); }).catch(function () { self.app.toast("Can't reach the server."); });
  };
  Link.prototype.table = function () {
    var body = this.dlg && this.dlg.querySelector("#lk-rows");
    if (!body) return;
    var self = this, binds = this.bindings(), byTag = {}, names = {};
    binds.forEach(function (b) { byTag[b.tag] = b; names[b.tag] = 1; });
    Object.keys(this.tags).forEach(function (k) { names[k] = 1; });
    var list = Object.keys(names).sort(function (a, b) { var fa = byTag[a] ? 0 : 1, fb = byTag[b] ? 0 : 1; return fa - fb || (a < b ? -1 : 1); });
    var html = list.map(function (name) {
      var b = byTag[name], e = self.tags[name], v = e ? e.value : b ? b.read() : null, part = b ? L.def(b.part).name.replace(/ \(.+\)$/, "") : "";
      var kind = b ? (b.dir === "out" ? '<span class="lk-kind out" title="The bench publishes this">out</span> ' : '<span class="lk-kind in" title="Write this and the bench obeys">in</span> ') + esc(part) + ' <em>' + esc(b.what) + '</em>' : '<span class="lk-kind free" title="Not a part: a value for programs to share">yours</span>';
      var can = !b || b.dir === "in", isBool = typeof v === "boolean" || (b && /true/.test(b.what));
      return '<tr' + (e ? "" : ' class="quiet"') + '><th><code>' + esc(name) + '</code></th><td class="v ' + (v === true ? "on" : v === false ? "off" : "") + '">' + esc(show(v)) + '</td><td>' + kind + '</td><td>' + (e ? esc(e.by || "") : '<em>not sent yet</em>') + '</td><td>' + (can ? '<button type="button" data-set="' + esc(name) + '"' + (isBool ? ' data-bool="1"' : "") + '>' + (isBool ? "Flip" : "Set") + '</button>' : "") + '</td></tr>';
    }).join("");
    if (!list.length) html = '<tr class="quiet"><td colspan="5">Nothing yet. Put a part on the bench — an LED, a button, a sensor — and its tags appear here.</td></tr>';
    if (body._h !== html) { body.innerHTML = html; body._h = html; }
  };

  document.addEventListener("DOMContentLoaded", function () {
    var app = root.chalkLab;
    if (app && app.panels) app.link = new Link(app);
  });
})(typeof window !== "undefined" ? window : globalThis);
