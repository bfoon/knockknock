/* Chalk Circuit Lab — the studio.
 *
 * One project, three places to work on it:
 *
 *   Bench     build the circuit and try it (everything the lab already did)
 *   Board     the same circuit as a printed circuit board (lab_pcb.js)
 *   Body      the shell it lives in, in 3-D, test-driven and 3-D printed
 *             (lab_body.js, lab_body_view.js)
 *
 * They are views of one document, so a part deleted on the bench leaves
 * the board and the body too, and Undo works across all three.
 *
 * And the project designer: say what you want to make — "a toy car that
 * turns away from walls" — and it designs the circuit, writes the program,
 * lays out the board and builds a body round it. With an AI key on the
 * server the design comes from the AI; without one, from a shelf of
 * worked projects, so a class is never left with a button that does
 * nothing.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var esc = L.esc;

  function $(id) { return document.getElementById(id); }

  function Studio(app) {
    var self = this;
    this.app = app;
    this.space = "bench";
    var wrap = document.querySelector(".bench-wrap");
    this.pcbHost = document.createElement("div");
    this.pcbHost.className = "st-host pcb-host"; this.pcbHost.hidden = true;
    this.bodyHost = document.createElement("div");
    this.bodyHost.className = "st-host body-host"; this.bodyHost.hidden = true;
    wrap.insertBefore(this.bodyHost, wrap.firstChild.nextSibling);
    wrap.insertBefore(this.pcbHost, this.bodyHost);
    this.pcb = new L.PcbView(app, this.pcbHost);
    this.body = new L.BodyView(app, this.bodyHost);
    var sw = $("lab-space");
    if (sw) sw.querySelectorAll("button").forEach(function (b) { b.addEventListener("click", function () { self.setSpace(b.getAttribute("data-space")); }); });
    var pj = $("lab-project");
    if (pj) pj.addEventListener("click", function () { self.wizard(); });
  }
  L.Studio = Studio;

  Studio.prototype.active = function () { return this.space === "pcb" ? this.pcb : this.space === "body" ? this.body : null; };

  Studio.prototype.setSpace = function (space) {
    var app = this.app, b = document.body;
    if (space !== "pcb" && space !== "body") space = "bench";
    if (this.space === "body" && space !== "body" && this.body.driving) this.body.setDrive(false);
    this.space = space;
    ["space-bench", "space-pcb", "space-body"].forEach(function (c) { b.classList.remove(c); });
    b.classList.add("space-" + space);
    this.pcbHost.hidden = space !== "pcb";
    this.bodyHost.hidden = space !== "body";
    var sw = $("lab-space");
    if (sw) sw.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x.getAttribute("data-space") === space ? "true" : "false"); });
    app.bench.hoverMark(null);
    if (space === "pcb") { this.pcb.sync(); this.pcb.fit(); app.panels.inspect(app.bench.sel); }
    else if (space === "body") { this.body.sync(); if (!this.body.framed) { this.body.framed = true; this.body.frameAll(); } this.body.inspect(); app.panels.showSide("inspect"); }
    else { app.panels.inspect(app.bench.sel); app.bench.resize(); }
    app.drawer();
    if (app.layout && app.layout.st.view === "code") app.layout.setView("split");
  };

  /* The document changed (an edit, an undo, a new circuit). */
  Studio.prototype.refresh = function () {
    if (this.space === "pcb") this.pcb.sync();
    else if (this.space === "body") { this.body.sync(); this.body.inspect(); }
  };
  Studio.prototype.onSelect = function () { if (this.space === "pcb") this.pcb.render(); };
  Studio.prototype.frame = function (dt) { if (this.space === "body") this.body.frame(dt); };

  /* A row of the component list was clicked. True means "handled here". */
  Studio.prototype.pick = function (kind, id, fly) {
    var app = this.app;
    if (this.space === "pcb") {
      if (kind !== "part") return true;
      app.bench.select({ kind: "part", id: id });
      if (!app.doc.pcb || !app.doc.pcb.place[id]) app.toast("That one isn't on the board — it's part of the bench, not the circuit.");
      return true;
    }
    return false;
  };
  Studio.prototype.hover = function (kind, id) { if (this.space === "pcb") this.pcb.hoverMark(kind === "part" ? id : null); };

  /* Keys that would otherwise move things on a bench nobody can see. */
  Studio.prototype.key = function (e) {
    var app = this.app, sel = app.bench.sel, mod = e.ctrlKey || e.metaKey;
    if (this.space === "bench") return false;
    if (document.querySelector("dialog[open]")) return false;      /* Esc belongs to the dialog */
    if (mod && /^[zys]$/i.test(e.key)) return false;
    if (e.key === " ") return false;
    if (this.space === "pcb") {
      var id = sel && sel.kind === "part" ? sel.id : null, pl = id && app.doc.pcb && app.doc.pcb.place[id];
      if ((e.key === "r" || e.key === "R") && pl) { this.pcb.rotate(id); return true; }
      if (/^Arrow/.test(e.key) && pl) {
        var G = L.PCB.G, dx = e.key === "ArrowLeft" ? -G : e.key === "ArrowRight" ? G : 0, dy = e.key === "ArrowUp" ? -G : e.key === "ArrowDown" ? G : 0, pcbv = this.pcb;
        pcbv.edit(function () { pl.x = Math.round((pl.x + dx) * 1000) / 1000; pl.y = Math.round((pl.y + dy) * 1000) / 1000; L.PCB.grow(app.doc, pcbv.model); }, true);
        return true;
      }
      if (e.key === "f" || e.key === "F") { if (e.shiftKey) return false; this.pcb.fit(); return true; }
      if (e.key === "Escape") { app.bench.select(null); return true; }
      return /^(Delete|Backspace|r|R|d|D)$/.test(e.key) || /^Arrow/.test(e.key);
    }
    if (this.body.key(e)) return true;
    if (e.key === "f" || e.key === "F") { if (e.shiftKey) return false; this.body.frameAll(); return true; }
    return /^(Delete|Backspace|r|R|d|D|Escape)$/.test(e.key) || /^Arrow/.test(e.key);
  };

  /* The left drawer in the Body space. */
  Studio.prototype.drawer = function (box, tab) {
    if (this.space !== "body") return false;
    if (tab === "layers") this.body.layersDrawer(box); else this.body.shapesDrawer(box);
    return true;
  };
  Studio.prototype.drawerSync = function () {
    var self = this;
    if (this.space !== "body" || this.dsT) return;
    this.dsT = requestAnimationFrame(function () { self.dsT = 0; if (self.app.drawerTab === "layers") self.app.drawer(); });
  };

  /* ------------------------------------------------------- a body from AI */

  /* Build what the AI (or the shelf) described. Everything is checked:
   * unknown shapes are dropped and every number is clamped. */
  Studio.prototype.applyBody = function (spec) {
    var app = this.app, doc = app.doc, Body = L.Body, S = L.Solid;
    if (!spec || typeof spec !== "object") return 0;
    var kind = Body.TEMPLATES[spec.kind] ? spec.kind : "custom", wall = L.clamp(+spec.wall || 2, 1.2, 4);
    var num = function (v, lo, hi, d) { v = +v; return isFinite(v) ? L.clamp(Math.round(v * 10) / 10, lo, hi) : d; };
    var extra = [];
    (Array.isArray(spec.solids) ? spec.solids : []).slice(0, 80).forEach(function (q) {
      if (!q || !S.SHAPES[q.shape]) return;
      var is = /^(hull|attach|part|cut)$/.test(q.is) ? q.is : "attach";
      if (kind !== "custom" && is === "hull") is = "attach";       /* the pattern owns the shell */
      var s = Body.solid(String(q.name || S.SHAPES[q.shape]).slice(0, 40), q.shape, [num(q.x, -800, 800, 0), num(q.y, -800, 800, 0), num(q.z, -200, 1200, 20)],
        [num(q.sx, 0.5, 600, 30), num(q.sy, 0.5, 600, 30), num(q.sz, 0.5, 600, 30)],
        { rot: [num(q.rx, -360, 360, 0), num(q.ry, -360, 360, 0), num(q.rz, -360, 360, 0)], color: /^#[0-9a-fA-F]{6}$/.test(q.color || "") ? q.color : "#d4893a",
          op: is === "cut" ? "cut" : "add", group: is === "cut" ? "attach" : is, role: /^(wheelL|wheelR|prop|led)$/.test(q.role) ? q.role : "" });
      extra.push(s);
    });
    if (kind === "custom" && !extra.length) return 0;
    var self = this;
    this.body.edit(function () {
      var b = kind === "custom" ? Body.blank() : Body.make(kind, doc, wall);
      b.wall = wall;
      if (kind === "custom") {
        var drive = /^(wheels|prop|boat|rocket|none)$/.test(spec.drive) ? spec.drive : extra.some(function (s) { return /^wheel/.test(s.role || ""); }) ? "wheels" : extra.some(function (s) { return s.role === "prop"; }) ? "prop" : "none";
        b.drive = drive;
        var hull = extra.filter(function (s) { return s.group === "hull" && s.op !== "cut"; });
        if (hull.length) {
          var lo = 1e9, hi = -1e9, big = hull[0];
          hull.forEach(function (s) { lo = Math.min(lo, s.z - s.sz / 2); hi = Math.max(hi, s.z + s.sz / 2); if (s.sx * s.sy * s.sz > big.sx * big.sy * big.sz) big = s; });
          b.split = "z"; b.splitZ = Math.round((lo + hi) / 2);
          b.bay = { x: big.x, y: big.y, z: big.z - big.sz / 2 + wall, w: big.sx * 0.7, d: big.sy * 0.7, h: big.sz * 0.6 };
        }
        var wheels = extra.filter(function (s) { return /^wheel/.test(s.role || ""); });
        if (wheels.length) { b.wheel = wheels[0].sx; b.track = Math.max(40, 2 * Math.max.apply(null, wheels.map(function (s) { return Math.abs(s.y); }))); }
      }
      extra.forEach(function (s) { b.solids.push(s); });
      if (/^#[0-9a-fA-F]{6}$/.test(spec.color || "")) b.solids.forEach(function (s) { if (s.group === "hull" && s.op !== "cut") s.color = spec.color; });
      b.mounts = Body.automount(doc, b);
      doc.body = b;
      self.body.sel = null;
    });
    this.body.veh = { x: 0, y: 0, z: 0, yaw: 0, vz: 0, spinL: 0, spinR: 0, spinP: 0, dist: 0, top: 0 };
    this.body.frameAll();
    return doc.body.solids.length;
  };

  /* ------------------------------------------------------ worked projects */

  /* "a.pin>b.pin|colour" → the wire format buildFrom() takes. */
  function wires(list) { return list.map(function (w) { var q = w.split(/[>|]/); return q[2] ? { a: q[0], b: q[1], color: q[2] } : { a: q[0], b: q[1] }; }); }
  function parts(list) { return list.map(function (p) { return { id: p[0], type: p[1], props: p[2] || {} }; }); }

  /* One motor switched by a logic-level MOSFET, with its flyback diode. */
  function driver(n, pin) {
    return {
      parts: [["m" + n, "motor", { load: "wheel" }], ["q" + n, "nmos"], ["d" + n, "diode"], ["g" + n, "resistor", { ohms: 220 }]],
      wires: ["u." + pin + ">g" + n + ".1|yellow", "g" + n + ".2>q" + n + ".G|yellow", "q" + n + ".S>u.GND2|black", "q" + n + ".D>m" + n + ".2|blue", "m" + n + ".1>b.+|red", "d" + n + ".A>q" + n + ".D|blue", "d" + n + ".K>b.+|red"]
    };
  }
  function join() {
    var out = { parts: [], wires: [] };
    Array.prototype.forEach.call(arguments, function (c) { out.parts = out.parts.concat(c.parts); out.wires = out.wires.concat(c.wires); });
    return { parts: parts(out.parts), wires: wires(out.wires) };
  }
  var CORE = { parts: [["u", "arduino_uno"], ["b", "battery_aa", { cells: 4 }]], wires: ["b.->u.GND3|black"] };
  var EYES = { parts: [["s", "hcsr04", { cm: 60 }]], wires: ["u.5V>s.VCC|red", "u.GND1>s.GND|black", "u.D7>s.TRIG|green", "u.D6>s.ECHO|orange"] };
  function lamp(n, pin, color) { return { parts: [["l" + n, "led", { color: color }], ["r" + n, "resistor", { ohms: 220 }]], wires: ["u." + pin + ">r" + n + ".1|white", "r" + n + ".2>l" + n + ".A|white", "l" + n + ".K>u.GND1|black"] }; }

  var DRIVE_CODE =
    "// Drives forward and turns away from anything closer than 20 cm.\n" +
    "const int LEFT = 5, RIGHT = 3, TRIG = 7, ECHO = 6, LAMPS = 9;\n\n" +
    "void setup() {\n  pinMode(LEFT, OUTPUT);\n  pinMode(RIGHT, OUTPUT);\n  pinMode(TRIG, OUTPUT);\n  pinMode(ECHO, INPUT);\n  pinMode(LAMPS, OUTPUT);\n  digitalWrite(LAMPS, HIGH);\n  Serial.begin(9600);\n  delay(200);                 // let the sensor wake up\n}\n\n" +
    "long distanceCm() {\n  digitalWrite(TRIG, LOW);\n  delayMicroseconds(2);\n  digitalWrite(TRIG, HIGH);\n  delayMicroseconds(10);\n  digitalWrite(TRIG, LOW);\n  return pulseIn(ECHO, HIGH) / 58;\n}\n\n" +
    "void loop() {\n  long cm = distanceCm();\n  Serial.println(cm);\n  if (cm > 0 && cm < 20) {\n    analogWrite(LEFT, 200);   // something ahead: turn on the spot\n    analogWrite(RIGHT, 0);\n  } else {\n    analogWrite(LEFT, 220);   // clear: straight on\n    analogWrite(RIGHT, 220);\n  }\n  delay(60);\n}\n";

  L.PROJECTS = [
    { id: "car", name: "Wall-dodging car", body: "car", match: /car|buggy|truck|vehicle|racer/i,
      blurb: "Two motors, a distance sensor for eyes and headlights. It drives until something is in the way, then turns.",
      circuit: function () { return join(CORE, EYES, driver("l", "D5"), driver("r", "D3"), lamp("1", "D9", "white"), lamp("2", "D9", "white")); }, code: DRIVE_CODE },
    { id: "robot", name: "Rover robot", body: "robot", match: /robot|rover|bot\b/i,
      blurb: "The same brain as the car in a rover body: sensor eyes in the head, two drive wheels and a caster.",
      circuit: function () { return join(CORE, EYES, driver("l", "D5"), driver("r", "D3"), lamp("1", "D9", "green")); }, code: DRIVE_CODE },
    { id: "submarine", name: "Submarine", body: "submarine", match: /sub(marine)?|under ?water|diver?/i,
      blurb: "A propeller motor, a second motor as the ballast pump, and porthole lights. It cruises, dives and surfaces.",
      circuit: function () { return join(CORE, driver("p", "D5"), driver("d", "D3"), lamp("1", "D9", "yellow"), lamp("2", "D10", "blue")); },
      code: "// Cruise, dive, cruise deep, surface — and blink the porthole lights.\nconst int PROP = 5, PUMP = 3, LIGHT = 9, BEACON = 10;\n\nvoid setup() {\n  pinMode(PROP, OUTPUT);\n  pinMode(PUMP, OUTPUT);\n  pinMode(LIGHT, OUTPUT);\n  pinMode(BEACON, OUTPUT);\n  digitalWrite(LIGHT, HIGH);\n}\n\nvoid blink(int times) {\n  for (int i = 0; i < times; i++) {\n    digitalWrite(BEACON, HIGH);\n    delay(150);\n    digitalWrite(BEACON, LOW);\n    delay(150);\n  }\n}\n\nvoid loop() {\n  analogWrite(PROP, 200);      // ahead on the surface\n  delay(3000);\n  blink(3);\n  analogWrite(PUMP, 255);      // flood the tanks: dive\n  delay(2500);\n  analogWrite(PUMP, 0);\n  delay(3000);                 // run deep\n  analogWrite(PROP, 0);        // stop and drift\n  blink(5);\n  delay(1500);\n}\n" },
    { id: "rocket", name: "Countdown rocket", body: "rocket", match: /rocket|space|launch|shuttle|missile/i,
      blurb: "Three countdown lights, a beeper and an engine output. Three, two, one — lift-off.",
      circuit: function () {
        return join(CORE, driver("e", "D5"), lamp("1", "D2", "red"), lamp("2", "D3", "yellow"), lamp("3", "D4", "green"),
          { parts: [["z", "buzzer"]], wires: ["u.D8>z.+|purple", "z.->u.GND1|black"] });
      },
      code: "// Counts down on three lights with a beep each, then fires the engine.\nconst int LIGHTS[3] = {2, 3, 4};\nconst int BEEP = 8, ENGINE = 5;\n\nvoid setup() {\n  for (int i = 0; i < 3; i++) pinMode(LIGHTS[i], OUTPUT);\n  pinMode(BEEP, OUTPUT);\n  pinMode(ENGINE, OUTPUT);\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  for (int i = 0; i < 3; i++) {          // three… two… one…\n    Serial.println(3 - i);\n    digitalWrite(LIGHTS[i], HIGH);\n    digitalWrite(BEEP, HIGH);\n    delay(200);\n    digitalWrite(BEEP, LOW);\n    delay(800);\n  }\n  Serial.println(\"Lift-off!\");\n  digitalWrite(BEEP, HIGH);\n  analogWrite(ENGINE, 255);              // engine on\n  delay(2500);\n  analogWrite(ENGINE, 0);                // burn-out: coast and fall back\n  digitalWrite(BEEP, LOW);\n  for (int i = 0; i < 3; i++) digitalWrite(LIGHTS[i], LOW);\n  delay(6000);\n}\n" },
    { id: "boat", name: "Weaving boat", body: "boat", match: /boat|ship|ferry|sail|yacht/i,
      blurb: "A propeller motor and a servo rudder. It sets off and weaves from side to side.",
      circuit: function () { return join(CORE, driver("p", "D5"), lamp("1", "D8", "green"), { parts: [["v", "servo"]], wires: ["u.5V>v.V+|red", "u.GND1>v.GND|black", "u.D9>v.SIG|orange"] }); },
      code: "// Full ahead, with the rudder swinging gently from side to side.\n#include <Servo.h>\nServo rudder;\nconst int PROP = 5, LAMP = 8;\n\nvoid setup() {\n  rudder.attach(9);\n  pinMode(PROP, OUTPUT);\n  pinMode(LAMP, OUTPUT);\n  digitalWrite(LAMP, HIGH);\n  analogWrite(PROP, 210);\n}\n\nvoid loop() {\n  for (int a = 60; a <= 120; a += 2) { rudder.write(a); delay(40); }\n  for (int a = 120; a >= 60; a -= 2) { rudder.write(a); delay(40); }\n}\n" },
    { id: "lamp", name: "Night light in a box", body: "box", match: /night|lamp|light|box|case|enclosure/i,
      blurb: "A light sensor and an LED in a small case: the light comes on when the room goes dark.",
      circuit: function () {
        return join({ parts: [["u", "arduino_uno"], ["k", "ldr"], ["rk", "resistor", { ohms: 10000 }]], wires: ["u.5V>k.1|red", "k.2>u.A0|green", "u.A0>rk.1|green", "rk.2>u.GND2|black"] }, lamp("1", "D9", "white"));
      },
      code: "// The darker the room, the brighter the light.\nconst int SENSOR = A0, LIGHT = 9;\n\nvoid setup() {\n  pinMode(LIGHT, OUTPUT);\n  Serial.begin(9600);\n}\n\nvoid loop() {\n  int level = analogRead(SENSOR);          // 0 dark … 1023 bright\n  Serial.println(level);\n  int glow = map(level, 200, 700, 255, 0);\n  analogWrite(LIGHT, constrain(glow, 0, 255));\n  delay(100);\n}\n" }
  ];

  /* The nearest worked project to what was asked for. */
  L.localProject = function (question) {
    var q = String(question || ""), hit = L.PROJECTS.filter(function (p) { return p.match.test(q); })[0] || L.PROJECTS[0];
    return { reply: "**" + hit.name + ".** " + hit.blurb, circuit: hit.circuit(), code: hit.code, body: { kind: hit.body }, title: hit.name, shelf: true };
  };

  /* A body picked by the words in the request, for when no AI is there. */
  L.localBody = function (question) {
    var q = String(question || ""), hit = L.PROJECTS.filter(function (p) { return p.match.test(q); })[0];
    var kind = hit ? hit.body : "box", t = L.Body.TEMPLATES[kind];
    return { reply: "**" + t.name + ".** " + t.blurb + " It will be sized to fit the electronics on your bench. Every shape can be changed afterwards.", body: { kind: kind } };
  };

  /* ------------------------------------------------------------ the wizard */

  var IDEAS = ["A toy car that turns away from walls", "A submarine with porthole lights that dives and surfaces", "A rocket with a three-two-one countdown", "A rover robot with sensor eyes", "A boat with a rudder that weaves", "A night light in a small case"];

  Studio.prototype.wizard = function (preset) {
    var self = this, app = this.app, d = document.createElement("dialog");
    d.className = "dlg st-wizard";
    d.innerHTML = '<form method="dialog" class="dlg-top"><h2>Design a project</h2><button value="close" aria-label="Close">×</button></form>' +
      '<div class="wz-body">' +
      '<p class="wz-lede">Say what you want to make. You get the circuit, the program, the circuit board and a body to 3-D print — all in one go, all yours to change.</p>' +
      '<label class="sr" for="wz-q">What do you want to make?</label>' +
      '<textarea id="wz-q" rows="3" placeholder="e.g. a toy car with headlights that stops before it hits a wall">' + esc(preset || "") + '</textarea>' +
      '<div class="wz-ideas">' + IDEAS.map(function (t) { return '<button type="button" data-idea="' + esc(t) + '">' + esc(t) + '</button>'; }).join("") + '</div>' +
      '<ol class="wz-steps" hidden><li data-step="design">Designing the circuit and the program</li><li data-step="bench">Building it on the bench</li><li data-step="pcb">Laying out and routing the circuit board</li><li data-step="body">Building the body round it</li></ol>' +
      '<p class="wz-note" hidden></p>' +
      '<div class="ask-actions"><span class="fine">' + (app.cfg.aiEnabled ? "Designed by the AI on this server. Check its work before you build it for real." : "The AI isn't switched on for this server, so designs come from the lab's shelf of worked projects.") + '</span>' +
      '<button type="button" class="primary" id="wz-go">Design it</button></div></div>';
    document.body.appendChild(d);
    d.addEventListener("close", function () { d.remove(); });
    var q = d.querySelector("#wz-q"), go = d.querySelector("#wz-go"), steps = d.querySelector(".wz-steps"), note = d.querySelector(".wz-note");
    d.querySelectorAll("[data-idea]").forEach(function (b) { b.addEventListener("click", function () { q.value = b.getAttribute("data-idea"); q.focus(); }); });
    var mark = function (name, state) { var li = steps.querySelector('[data-step="' + name + '"]'); if (li) li.setAttribute("data-state", state); };
    var run = function () {
      var text = q.value.trim();
      if (!text) { q.focus(); return; }
      go.disabled = true; q.disabled = true; steps.hidden = false; note.hidden = true;
      d.querySelector(".wz-ideas").hidden = true;
      mark("design", "doing");
      self.design(text).then(function (res) {
        mark("design", "done");
        return self.construct(res, text, mark).then(function (sum) {
          note.hidden = false;
          note.innerHTML = L.md(res.reply || "") + '<p class="wz-sum">' + esc(sum) + '</p>';
          go.hidden = true;
          var act = d.querySelector(".ask-actions");
          act.innerHTML = '<button type="button" data-open="bench">Open the bench</button><button type="button" data-open="pcb">Open the board</button><button type="button" class="primary" data-open="body">See it in 3-D</button>';
          act.querySelectorAll("[data-open]").forEach(function (b) { b.addEventListener("click", function () { d.close(); self.setSpace(b.getAttribute("data-open")); }); });
          app.sound("win");
        });
      }).catch(function (e) {
        if (root.console) console.error(e);
        note.hidden = false; note.innerHTML = '<span class="bad">' + esc((e && e.message) || "That didn't work. Try describing it another way.") + '</span>';
        go.disabled = false; q.disabled = false;
      });
    };
    go.addEventListener("click", run);
    q.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) run(); });
    d.showModal();
    q.focus();
  };

  /* Ask for a design. Always resolves with something buildable. */
  Studio.prototype.design = function (text) {
    var app = this.app, local = function (why) { var r = L.localProject(text); if (why) r.reply = "_" + why + " Here is the nearest project from the lab's own shelf._\n\n" + r.reply; return r; };
    var usable = function (j) { return j && j.circuit && j.circuit.parts && j.circuit.parts.length >= 2; };
    var payload = { kind: "project", question: text, mode: "pro", circuit: { parts: [], nets: [] }, code: "" };
    if (!app.cfg.aiEnabled) return new Promise(function (res) { setTimeout(function () { res(local("")); }, 400); });
    var ask = L.aiTransport ? L.aiTransport(payload) : fetch(app.cfg.aiUrl, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": app.cfg.csrf }, body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { if (r.status !== 200 || !j.ok) throw { friendly: j && j.error }; return j; }); });
    return ask.then(function (j) { return usable(j) ? j : local("The AI answered, but not with a circuit that could be built."); },
                    function (e) { return local((e && e.friendly) || "The AI didn't answer."); });
  };

  /* Lay a designed circuit out on the bench when it came without places:
   * the board on the left, everything else flowing in rows beside it,
   * each part given the room its own picture needs. */
  L.layoutCircuit = function (c) {
    var P = L.P, list = (c.parts || []).filter(function (p) { return p && L.PARTS[p.type]; });
    if (!list.length || list.every(function (p) { return isFinite(p.x) && isFinite(p.y); })) return c;
    var box = function (p) { return L.boxOf({ type: p.type, x: 0, y: 0, rot: 0, props: p.props || {} }); };
    var boards = list.filter(function (p) { return L.PARTS[p.type].mcu; }), rest = list.filter(function (p) { return !L.PARTS[p.type].mcu; });
    var y = 0, left = 0;
    boards.forEach(function (p) { var b = box(p); p.x = L.snap(-b.x); p.y = L.snap(y - b.y); y += b.h + 4 * P; left = Math.max(left, b.w); });
    var x0 = left ? left + 6 * P : 0, cx = x0, cy = 0, rowH = 0, wide = Math.max(44 * P, Math.sqrt(rest.length) * 13 * P);
    rest.forEach(function (p) {
      var b = box(p);
      if (cx > x0 && cx + b.w > x0 + wide) { cx = x0; cy += rowH + 4 * P; rowH = 0; }
      p.x = L.snap(cx - b.x); p.y = L.snap(cy - b.y);
      cx += b.w + 4 * P; rowH = Math.max(rowH, b.h);
    });
    return c;
  };

  /* Turn a design into a project: bench, board, body. */
  Studio.prototype.construct = function (res, text, mark) {
    var self = this, app = this.app, PCB = L.PCB;
    mark = mark || function () {};
    var pause = function () { return new Promise(function (r) { setTimeout(r, 260); }); };
    var title = (res.title || text).replace(/\s+/g, " ").trim().slice(0, 60);
    title = title.charAt(0).toUpperCase() + title.slice(1);
    mark("bench", "doing");
    return pause().then(function () {
      if (app.doc.parts.length) { if (app.dirty) app.save(); app.replaceDoc(L.blankDoc("pro"), title, true); }
      else { app.title = title; $("lab-title").value = title; }
      if (self.space !== "bench") self.setSpace("bench");
      var n = app.buildFrom(L.layoutCircuit(res.circuit));
      if (!n) throw new Error("The design used parts this lab doesn't have. Try describing it another way.");
      if (res.code && String(res.code).trim()) app.useCode(String(res.code));
      mark("bench", "done"); mark("pcb", "doing");
      return pause().then(function () {
        var model = PCB.model(app.doc, app.sim);
        PCB.ensure(app.doc, model);
        var routed = PCB.route(app.doc, model);
        mark("pcb", routed.open.length ? "warn" : "done"); mark("body", "doing");
        return pause().then(function () {
          var shapes = self.applyBody(res.body && typeof res.body === "object" ? res.body : { kind: "box" });
          if (!shapes) shapes = self.applyBody({ kind: "box" });
          mark("body", "done");
          app.changed();
          self.setSpace("body");
          self.body.frameAll();
          var rep = PCB.report(app.doc, model), misfit = L.Body.fit(app.doc, app.doc.body);
          return n + " parts on the bench · a " + rep.w.toFixed(0) + " × " + rep.h.toFixed(0) + " mm board, " + (rep.open ? rep.open + " connection" + (rep.open > 1 ? "s" : "") + " still to route by hand" : "fully routed") +
            " · a body of " + shapes + " shapes" + (misfit.length ? " (some electronics stick out — press Resize to fit)" : " that everything fits inside") + ". Press ▶ Test drive to try it.";
        });
      });
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
