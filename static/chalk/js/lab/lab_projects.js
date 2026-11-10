/* Chalk Circuit Lab — the project shelf.
 *
 * Worked projects the designer can build without any AI: each one is a
 * circuit, the program that runs it, and the body it lives in. They are
 * also the fallback when the AI is off or does not answer, and they are
 * what a class browses when it doesn't yet know what it wants to make.
 *
 * A project is written as a parts list in the way you would say it out
 * loud — "an Uno, two motors, a distance sensor, Bluetooth" — and the Kit
 * below turns each of those into the parts, every wire they need, and the
 * lines of setup() that go with them. Only loop() is written by hand, so
 * the wiring and the program can never disagree about which pin is which.
 *
 *   ChalkLab.PROJECTS            [{id, name, cat, body, blurb, words, make}]
 *   ChalkLab.shelfProject(id)    a project ready for Studio.construct()
 *   ChalkLab.localProject(text)  the nearest project to a request
 *
 * Wireless: Bluetooth projects use an HC-05 and the phone controller in
 * the side panel (it sends F B L R S, 1 0, A B, and "v<0-255>" from its
 * slider). Radio projects use a pair of HC-12 modules and TWO boards, each
 * with its own program — or the 433 MHz key fob and its receiver.
 *
 * The sketches are template strings (the one place this lab uses them):
 * a program is easier to read, and to keep right, as a block of text.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;

  /* ================================================================ KIT */

  function Kit(shared, tag) {
    this.tag = tag || "";
    this.u = "u" + this.tag;
    this.parts = shared ? shared.parts : [];
    this.wires = shared ? shared.wires : [];
    this.parts.push([this.u, "arduino_uno"]);
    this.inc = []; this.def = []; this.obj = []; this.set = []; this.fn = []; this.body = "";
    this.g = 0; this.batt = false; this.others = shared ? shared.others : [];
    this.others.push(this);
  }
  var K = Kit.prototype;
  K.id = function (n) { return n + this.tag; };
  K.w = function (a, b, color) { this.wires.push(a + ">" + b + (color ? "|" + color : "")); return this; };
  K.pin = function (p) { return this.u + "." + (typeof p === "number" ? "D" + p : p); };
  /* the Uno has three ground pins: spread the wires across them */
  K.gnd = function () { return this.u + ".GND" + (1 + (this.g++ % 3)); };
  K.c = function (name, pin) { this.def.push("const int " + name + " = " + (typeof pin === "number" ? pin : pin) + ";"); return this; };
  K.out = function (name, pin) { this.c(name, pin); this.set.push("pinMode(" + name + ", OUTPUT);"); return this; };
  K.use = function (lib) { var l = "#include <" + lib + ">"; if (this.inc.indexOf(l) < 0) this.inc.push(l); return this; };
  K.serial = function () { this.set.push("Serial.begin(9600);"); return this; };
  K.second = function (tag) { return new Kit(this, tag || "2"); };

  K.led = function (name, pin, color) {
    var l = this.id("led_" + name.toLowerCase()), r = this.id("r_" + name.toLowerCase());
    this.parts.push([l, "led", { color: color || "red" }], [r, "resistor", { ohms: 220 }]);
    this.w(this.pin(pin), r + ".1", "white").w(r + ".2", l + ".A", "white").w(l + ".K", this.gnd(), "black");
    return this.out(name, pin);
  };
  K.rgb = function (pr, pg, pb) {
    var x = this.id("rgb"), self = this;
    this.parts.push([x, "rgb_led"]);
    [["R", pr, "RED", "red"], ["G", pg, "GREEN", "green"], ["B", pb, "BLUE", "blue"]].forEach(function (q) {
      var r = self.id("r_" + q[2].toLowerCase());
      self.parts.push([r, "resistor", { ohms: 220 }]);
      self.w(self.pin(q[1]), r + ".1", q[3]).w(r + ".2", x + "." + q[0], q[3]);
      self.out(q[2], q[1]);
    });
    return this.w(x + ".K", this.gnd(), "black");
  };
  K.sounder = function (type, name, pin) {
    var z = this.id("z_" + name.toLowerCase());
    this.parts.push([z, type]);
    this.w(this.pin(pin), z + ".+", "purple").w(z + ".-", this.gnd(), "black");
    return this.out(name, pin);
  };
  K.buzzer = function (name, pin) { return this.sounder("buzzer", name, pin); };
  K.piezo = function (name, pin) { return this.sounder("piezo", name, pin); };
  K.battery = function () {
    if (this.batt) return this;
    this.batt = true;
    this.parts.push([this.id("b"), "battery_aa", { cells: 4 }]);
    return this.w(this.id("b") + ".-", this.u + ".GND3", "black");
  };
  /* a motor can't run from a pin: a logic-level MOSFET switches it, with
   * a diode across the motor to swallow the kick when it stops, and a
   * resistor holding the gate down so the motor stays off until the
   * program has started and taken charge of the pin */
  K.motor = function (name, pin, load) {
    this.battery();
    var n = name.toLowerCase(), m = this.id("m_" + n), q = this.id("q_" + n), d = this.id("d_" + n), g = this.id("g_" + n), pd = this.id("pd_" + n), b = this.id("b");
    this.parts.push([m, "motor", { load: load || "wheel" }], [q, "nmos"], [d, "diode"], [g, "resistor", { ohms: 220 }], [pd, "resistor", { ohms: 10000 }]);
    this.w(this.pin(pin), g + ".1", "yellow").w(g + ".2", q + ".G", "yellow").w(q + ".S", this.u + ".GND2", "black")
        .w(q + ".G", pd + ".1", "yellow").w(pd + ".2", this.u + ".GND2", "black")
        .w(q + ".D", m + ".2", "blue").w(m + ".1", b + ".+", "red").w(d + ".A", q + ".D", "blue").w(d + ".K", b + ".+", "red");
    return this.out(name, pin);
  };
  /* two motors and one line that sets them both */
  K.wheels = function () {
    this.motor("LEFT", 5).motor("RIGHT", 3);
    this.fn.push("void drive(int left, int right) {\n  analogWrite(LEFT, left);\n  analogWrite(RIGHT, right);\n}");
    return this;
  };
  K.button = function (name, pin) {
    var s = this.id("sw_" + name.toLowerCase());
    this.parts.push([s, "button"]);
    this.w(s + ".1a", this.pin(pin), "yellow").w(s + ".2b", this.gnd(), "black");
    this.c(name, pin); this.set.push("pinMode(" + name + ", INPUT_PULLUP);");
    return this;
  };
  K.tilt = function (name, pin) {
    var s = this.id("tilt");
    this.parts.push([s, "tilt_switch"]);
    this.w(s + ".1", this.pin(pin), "yellow").w(s + ".2", this.gnd(), "black");
    this.c(name, pin); this.set.push("pinMode(" + name + ", INPUT_PULLUP);");
    return this;
  };
  K.pot = function (name, apin) {
    var p = this.id("pot_" + name.toLowerCase());
    this.parts.push([p, "potentiometer", { pos: 0.5 }]);
    this.w(p + ".1", this.gnd(), "black").w(p + ".2", this.u + ".5V", "red").w(p + ".W", this.pin(apin), "purple");
    return this.c(name, apin);
  };
  K.ldr = function (name, apin, light) {
    var l = this.id("ldr_" + name.toLowerCase()), r = this.id("rl_" + name.toLowerCase());
    this.parts.push([l, "ldr", { light: light == null ? 60 : light }], [r, "resistor", { ohms: 10000 }]);
    this.w(this.u + ".5V", l + ".1", "red").w(l + ".2", this.pin(apin), "green").w(this.pin(apin), r + ".1", "green").w(r + ".2", this.gnd(), "black");
    return this.c(name, apin);
  };
  K.temp = function (name, apin, deg) {
    var t = this.id("tmp");
    this.parts.push([t, "tmp36", { temp: deg == null ? 22 : deg }]);
    this.w(this.u + ".5V", t + ".+V", "red").w(t + ".OUT", this.pin(apin), "orange").w(t + ".GND", this.gnd(), "black");
    this.c(name, apin);
    this.fn.push("float celsius() {\n  float volts = analogRead(" + name + ") * 5.0 / 1023.0;\n  return (volts - 0.5) * 100.0;\n}");
    return this;
  };
  K.sonar = function (cm) {
    var s = this.id("sonar");
    this.parts.push([s, "hcsr04", { cm: cm || 60 }]);
    this.w(this.u + ".5V", s + ".VCC", "red").w(s + ".GND", this.gnd(), "black").w(this.pin(7), s + ".TRIG", "green").w(this.pin(6), s + ".ECHO", "orange");
    this.c("TRIG", 7).c("ECHO", 6);
    this.set.push("pinMode(TRIG, OUTPUT);", "pinMode(ECHO, INPUT);");
    this.fn.push("long distanceCm() {\n  digitalWrite(TRIG, LOW);\n  delayMicroseconds(2);\n  digitalWrite(TRIG, HIGH);\n  delayMicroseconds(10);\n  digitalWrite(TRIG, LOW);\n  return pulseIn(ECHO, HIGH) / 58;\n}");
    this.warm = true;
    return this;
  };
  K.pir = function (name, pin) {
    var p = this.id("pir");
    this.parts.push([p, "pir"]);
    this.w(this.u + ".5V", p + ".VCC", "red").w(p + ".GND", this.gnd(), "black").w(p + ".OUT", this.pin(pin), "yellow");
    this.c(name, pin); this.set.push("pinMode(" + name + ", INPUT);");
    return this;
  };
  /* the four-pin sensor modules: soil, gas, sound, flame, ir */
  K.sensor = function (kind, name, apin, level) {
    var s = this.id("mod_" + kind);
    this.parts.push([s, "mod_" + kind, { level: level == null ? 30 : level }]);
    this.w(this.u + ".5V", s + ".VCC", "red").w(s + ".GND", this.gnd(), "black").w(s + ".AO", this.pin(apin), "green");
    return this.c(name, apin);
  };
  K.servo = function (name, pin) {
    var s = this.id("servo_" + name);
    this.parts.push([s, "servo"]);
    this.w(this.u + ".5V", s + ".V+", "red").w(s + ".GND", this.gnd(), "black").w(this.pin(pin), s + ".SIG", "orange");
    this.use("Servo.h"); this.obj.push("Servo " + name + ";"); this.set.push(name + ".attach(" + pin + ");");
    return this;
  };
  K.lcd = function () {
    var l = this.id("lcd");
    this.parts.push([l, "lcd_i2c"]);
    this.w(this.u + ".5V", l + ".VCC", "red").w(l + ".GND", this.gnd(), "black").w(this.u + ".A4", l + ".SDA", "blue").w(this.u + ".A5", l + ".SCL", "yellow");
    this.use("LiquidCrystal_I2C.h"); this.obj.push("LiquidCrystal_I2C lcd(0x27, 16, 2);"); this.set.push("lcd.init();", "lcd.backlight();");
    return this;
  };
  /* a relay switching a lamp on its own battery: the Arduino only ever
   * touches the coil side */
  K.relay = function (name, pin) {
    this.battery();
    var r = this.id("relay"), l = this.id("lamp"), b = this.id("b");
    this.parts.push([r, "relay_module"], [l, "bulb"]);
    this.w(this.u + ".5V", r + ".VCC", "red").w(r + ".GND", this.gnd(), "black").w(this.pin(pin), r + ".IN", "yellow")
        .w(b + ".+", r + ".COM", "red").w(r + ".NO", l + ".1", "orange").w(l + ".2", b + ".-", "black");
    return this.out(name, pin);
  };
  K.bt = function () {
    var m = this.id("bt");
    this.parts.push([m, "hc05"]);
    this.w(m + ".VCC", this.u + ".5V", "red").w(m + ".GND", this.gnd(), "black").w(m + ".TXD", this.pin(10), "green").w(m + ".RXD", this.pin(11), "blue");
    this.use("SoftwareSerial.h"); this.obj.push("SoftwareSerial bt(10, 11);     // RX, TX: the module's TXD goes to 10"); this.set.push("bt.begin(9600);");
    return this;
  };
  K.radio = function () {
    var m = this.id("radio");
    this.parts.push([m, "hc12", { channel: 1 }]);
    this.w(m + ".VCC", this.u + ".5V", "red").w(m + ".GND", this.gnd(), "black").w(m + ".TXD", this.pin(10), "green").w(m + ".RXD", this.pin(11), "blue");
    this.use("SoftwareSerial.h"); this.obj.push("SoftwareSerial radio(10, 11);  // RX, TX: the module's TXD goes to 10"); this.set.push("radio.begin(9600);");
    return this;
  };
  /* the key fob's receiver: one pin goes high for each button held */
  K.fob = function () {
    var r = this.id("rx"), self = this;
    this.parts.push([r, "rf_rx"], [this.id("fob"), "rf_remote"]);
    this.w(this.u + ".5V", r + ".VCC", "red").w(r + ".GND", this.gnd(), "black");
    [["A", 2, "D0"], ["B", 4, "D1"], ["C", 12, "D2"], ["D", 13, "D3"]].forEach(function (q) {
      self.w(r + "." + q[2], self.pin(q[1]), "green");
      self.c("KEY_" + q[0], q[1]); self.set.push("pinMode(KEY_" + q[0] + ", INPUT);");
    });
    return this;
  };
  K.global = function (line) { this.obj.push(line); return this; };
  K.func = function (text) { this.fn.push(tidy(text)); return this; };
  K.loop = function (text) { this.body = tidy(text); return this; };

  function tidy(text) {
    var lines = String(text).replace(/^\n+|\s+$/g, "").split("\n"), cut = 99;
    lines.forEach(function (l) { if (l.trim()) cut = Math.min(cut, l.match(/^ */)[0].length); });
    return lines.map(function (l) { return l.slice(cut); }).join("\n");
  }
  K.sketch = function (title, role) {
    var s = "// " + title + (role ? " — " + role : "") + "\n";
    if (this.inc.length) s += this.inc.join("\n") + "\n";
    if (this.def.length || this.obj.length) s += "\n" + this.def.concat(this.obj).join("\n") + "\n";
    var setup = this.set.slice();
    if (this.warm) setup.push("delay(200);                 // let the sensor wake up");
    s += "\nvoid setup() {\n" + setup.map(function (l) { return "  " + l; }).join("\n") + "\n}\n";
    this.fn.forEach(function (f) { s += "\n" + f + "\n"; });
    s += "\nvoid loop() {\n" + this.body.split("\n").map(function (l) { return l ? "  " + l : l; }).join("\n") + "\n}\n";
    return s;
  };

  /* ============================================================ REGISTRY */

  var LIST = L.PROJECTS = [];
  var CATS = L.PROJECT_CATS = ["Cars & tanks", "Robots & pets", "Boats & submarines", "Rockets", "Smart home", "Garden & weather", "Games & gadgets", "Bluetooth", "Radio"];

  function add(id, name, cat, body, words, blurb, make) {
    LIST.push({ id: id, name: name, cat: cat, body: body, words: words, blurb: blurb, make: make });
  }

  L.shelfProject = function (id) {
    var p = LIST.filter(function (x) { return x.id === id; })[0];
    if (!p) return null;
    var k = new Kit(null, ""), roles = p.make(k) || {};
    var programs = {};
    k.others.forEach(function (b) { if (b.body) programs[b.u] = b.sketch(p.name, roles[b.u] || (k.others.length > 1 ? "board " + (k.others.indexOf(b) + 1) : "")); });
    return {
      title: p.name, shelf: true, id: p.id,
      reply: "**" + p.name + ".** " + p.blurb,
      circuit: {
        parts: k.parts.map(function (q) { return { id: q[0], type: q[1], props: q[2] || {} }; }),
        wires: k.wires.map(function (w) { var q = w.split(/[>|]/); return q[2] ? { a: q[0], b: q[1], color: q[2] } : { a: q[0], b: q[1] }; })
      },
      code: programs.u || "", programs: programs, body: { kind: p.body }
    };
  };

  /* The nearest project to a request: every word of the request that a
   * project knows scores for it, its name most of all. */
  L.matchProjects = function (text) {
    var words = String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
    return LIST.map(function (p) {
      var hay = " " + (p.name + " " + p.words + " " + p.cat + " " + p.body).toLowerCase() + " ", nm = " " + p.name.toLowerCase() + " ", s = 0;
      words.forEach(function (w) {
        if (w.length < 3) return;
        var stem = w.replace(/(ing|s)$/, "");
        if (nm.indexOf(" " + stem) >= 0) s += 3; else if (hay.indexOf(" " + stem) >= 0) s += 2; else if (hay.indexOf(stem) >= 0) s += 1;
      });
      return { p: p, s: s };
    }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; }).map(function (x) { return x.p; });
  };
  L.localProject = function (text) {
    var hit = L.matchProjects(text)[0] || LIST[0];
    return L.shelfProject(hit.id);
  };
  L.localBody = function (text) {
    var hit = L.matchProjects(text)[0], kind = hit ? hit.body : "box", t = L.Body.TEMPLATES[kind];
    return { reply: "**" + t.name + ".** " + t.blurb + " It will be sized to fit the electronics on your bench. Every shape can be changed afterwards.", body: { kind: kind } };
  };

  /* ======================================================= CARS & TANKS */

  add("car_dodge", "Wall-dodging car", "Cars & tanks", "car", "toy avoid obstacle distance ultrasonic autonomous self-driving headlights",
    "Two motors, a distance sensor for eyes and headlights. It drives until something is in the way, then turns on the spot.", function (k) {
      k.wheels().sonar(60).led("LAMPS", 9, "white").serial().set.push("digitalWrite(LAMPS, HIGH);");
      k.loop(`
        long cm = distanceCm();
        Serial.println(cm);
        if (cm > 0 && cm < 20) drive(200, 0);     // something ahead: turn on the spot
        else drive(220, 220);                     // clear: straight on
        delay(60);`);
    });

  add("car_light", "Light-chasing car", "Cars & tanks", "car", "follow torch light seeking photovore ldr moth",
    "Two light sensors, one each side. It steers towards whichever is brighter, so it chases a torch across the floor.", function (k) {
      k.wheels().ldr("EYE_L", "A0", 70).ldr("EYE_R", "A1", 45).serial();
      k.loop(`
        int left = analogRead(EYE_L), right = analogRead(EYE_R);
        Serial.print(left);
        Serial.print(" ");
        Serial.println(right);
        if (left + right < 300) drive(0, 0);                 // too dark to see anything: wait
        else if (left > right + 60) drive(90, 230);          // brighter on the left: turn left
        else if (right > left + 60) drive(230, 90);
        else drive(230, 230);
        delay(50);`);
    });

  add("car_police", "Police car", "Cars & tanks", "car", "siren emergency flashing blue red lights patrol",
    "Red and blue lights flash in turn and a two-tone siren wails while it drives.", function (k) {
      k.wheels().led("RED", 8, "red").led("BLUE", 9, "blue").piezo("SIREN", 12);
      k.loop(`
        drive(210, 210);
        digitalWrite(RED, HIGH);
        digitalWrite(BLUE, LOW);
        tone(SIREN, 660);
        delay(350);
        digitalWrite(RED, LOW);
        digitalWrite(BLUE, HIGH);
        tone(SIREN, 880);
        delay(350);`);
    });

  add("car_parking", "Self-parking car", "Cars & tanks", "car", "park reverse sensor beep distance brake stop garage",
    "It creeps towards a wall, beeping faster as it gets closer, and stops with its brake light on a hand's width away.", function (k) {
      k.wheels().sonar(45).led("BRAKE", 9, "red").piezo("BEEP", 12);
      k.loop(`
        long cm = distanceCm();
        if (cm > 0 && cm <= 10) {
          drive(0, 0);                            // close enough: stop
          digitalWrite(BRAKE, HIGH);
          noTone(BEEP);
          delay(200);
        } else {
          digitalWrite(BRAKE, LOW);
          drive(150, 150);
          tone(BEEP, 1200);
          delay(40);
          noTone(BEEP);
          delay(constrain(cm * 8, 40, 600));      // nearer = shorter gap between beeps
        }`);
    });

  add("car_clap", "Clap-start car", "Cars & tanks", "car", "sound clap noise microphone start stop voice",
    "Clap once and it sets off. Clap again and it stops. A sound sensor listens for the bang.", function (k) {
      k.wheels().sensor("sound", "MIC", "A0", 20).led("GO", 9, "green").global("bool going = false;");
      k.loop(`
        if (analogRead(MIC) > 600) {              // a loud noise
          going = !going;
          digitalWrite(GO, going);
          delay(400);                             // ignore the echo of the same clap
        }
        if (going) drive(220, 220);
        else drive(0, 0);
        delay(10);`);
    });

  add("car_night", "Night-driving car", "Cars & tanks", "car", "automatic headlights dark tunnel ldr dusk",
    "It drives a figure of eight and switches its own headlights on when it gets dark, like a real car in a tunnel.", function (k) {
      k.wheels().ldr("DAYLIGHT", "A0", 60).led("LAMPS", 9, "white");
      k.loop(`
        digitalWrite(LAMPS, analogRead(DAYLIGHT) < 400);    // dark: lights on
        unsigned long t = (millis() / 1000) % 8;
        if (t < 4) drive(230, 140);               // four seconds curving right…
        else drive(140, 230);                     // …then four curving left
        delay(50);`);
    });

  add("car_dragster", "Dragster with start lights", "Cars & tanks", "car", "race drag strip christmas tree countdown fast sprint",
    "Red, amber, green — then flat out for three seconds. The start lights of a drag strip, and the sprint after them.", function (k) {
      k.wheels().led("RED", 8, "red").led("AMBER", 9, "yellow").led("GREEN", 12, "green").piezo("BEEP", 13);
      k.loop(`
        digitalWrite(RED, HIGH);
        tone(BEEP, 440);
        delay(300);
        noTone(BEEP);
        delay(700);
        digitalWrite(AMBER, HIGH);
        tone(BEEP, 440);
        delay(300);
        noTone(BEEP);
        delay(700);
        digitalWrite(RED, LOW);
        digitalWrite(AMBER, LOW);
        digitalWrite(GREEN, HIGH);
        tone(BEEP, 880);
        drive(255, 255);                          // go!
        delay(3000);
        noTone(BEEP);
        drive(0, 0);
        digitalWrite(GREEN, LOW);
        delay(4000);`);
    });

  add("car_bumper", "Obstacle-sensing buggy", "Cars & tanks", "car", "infrared ir bumper proximity near turn table",
    "An infrared sensor on the nose sees things a few centimetres ahead. When it does, the buggy swings away.", function (k) {
      k.wheels().sensor("ir", "NOSE", "A0", 15).led("WARN", 9, "orange");
      k.loop(`
        bool blocked = analogRead(NOSE) < 400;    // the sensor reads LOW when light bounces back
        digitalWrite(WARN, blocked);
        if (blocked) {
          drive(0, 210);                          // swing left, away from it
          delay(500);
        } else drive(210, 210);
        delay(30);`);
    });

  add("tank_patrol", "Patrol tank", "Cars & tanks", "tank", "square route sentry military armoured tracks turret",
    "It patrols a square — forward, pivot, forward, pivot — with a searchlight that flashes on every turn.", function (k) {
      k.wheels().led("SEARCHLIGHT", 9, "white");
      k.loop(`
        digitalWrite(SEARCHLIGHT, LOW);
        drive(220, 220);                          // one side of the square
        delay(2500);
        digitalWrite(SEARCHLIGHT, HIGH);
        drive(220, 0);                            // pivot on the right track
        delay(900);`);
    });

  /* ====================================================== ROBOTS & PETS */

  add("rover_explore", "Explorer rover", "Robots & pets", "robot", "robot avoid explore mars autonomous sensor eyes",
    "Sensor eyes in the head, two drive wheels and a caster. It explores, and turns away from whatever it finds.", function (k) {
      k.wheels().sonar(60).led("EYE", 9, "green").serial();
      k.loop(`
        long cm = distanceCm();
        Serial.println(cm);
        analogWrite(EYE, constrain(map(cm, 5, 100, 255, 20), 20, 255));   // the closer, the brighter
        if (cm > 0 && cm < 25) drive(0, 200);
        else drive(210, 210);
        delay(60);`);
    });

  add("rover_follow", "Follow-me rover", "Robots & pets", "robot", "follow hand keep distance leader chase puppy",
    "Hold a hand in front of it and it follows: it drives when you are far, waits when you are near.", function (k) {
      k.wheels().sonar(40).led("HAPPY", 9, "green");
      k.loop(`
        long cm = distanceCm();
        if (cm > 30 && cm < 150) {                // someone ahead, but too far: catch up
          drive(200, 200);
          digitalWrite(HAPPY, HIGH);
        } else {                                  // close enough — or nobody there
          drive(0, 0);
          digitalWrite(HAPPY, LOW);
        }
        delay(80);`);
    });

  add("rover_guard", "Guard robot", "Robots & pets", "robot", "sentry security motion intruder alarm patrol pir",
    "It patrols slowly. When its motion sensor sees someone it stops, spins and sounds the alarm.", function (k) {
      k.wheels().pir("MOTION", 2).led("ALERT", 9, "red").piezo("ALARM", 12);
      k.loop(`
        if (digitalRead(MOTION) == HIGH) {
          drive(220, 0);                          // spin on the spot
          for (int i = 0; i < 6; i++) {
            digitalWrite(ALERT, HIGH);
            tone(ALARM, 1500);
            delay(120);
            digitalWrite(ALERT, LOW);
            tone(ALARM, 1000);
            delay(120);
          }
          noTone(ALARM);
        } else drive(120, 120);                   // all quiet: plod on
        delay(50);`);
    });

  add("rover_dance", "Dancing robot", "Robots & pets", "robot", "dance music tune song wiggle party disco melody",
    "It plays a tune and wiggles in time: left on one note, right on the next, with a light on the beat.", function (k) {
      k.wheels().piezo("SPEAKER", 12).led("BEAT", 9, "purple").global("const int TUNE[8] = {262, 330, 392, 523, 392, 330, 262, 196};");
      k.loop(`
        for (int i = 0; i < 8; i++) {
          tone(SPEAKER, TUNE[i]);
          digitalWrite(BEAT, HIGH);
          if (i % 2 == 0) drive(220, 0);          // step left…
          else drive(0, 220);                     // …step right
          delay(260);
          digitalWrite(BEAT, LOW);
          noTone(SPEAKER);
          delay(60);
        }
        drive(0, 0);
        delay(900);`);
    });

  add("pet_wave", "Waving desk pet", "Robots & pets", "pet", "creature companion greet hello motion wave arm cute",
    "It sits quietly until its motion sensor notices you. Then its eyes light up, it chirps and it waves.", function (k) {
      k.pir("MOTION", 2).servo("arm", 9).led("EYES", 6, "blue").piezo("VOICE", 12).set.push("arm.write(20);");
      k.loop(`
        if (digitalRead(MOTION) == HIGH) {
          digitalWrite(EYES, HIGH);
          tone(VOICE, 1300);
          delay(90);
          tone(VOICE, 1700);
          delay(90);
          noTone(VOICE);
          for (int i = 0; i < 3; i++) {           // wave three times
            arm.write(120);
            delay(300);
            arm.write(40);
            delay(300);
          }
          arm.write(20);
          digitalWrite(EYES, LOW);
          delay(1500);
        }
        delay(50);`);
    });

  add("pet_sleepy", "Sleepy desk pet", "Robots & pets", "pet", "mood light dark sleep breathe night creature tamagotchi",
    "In the light it is awake, eyes bright, chirping now and then. Turn the lights down and it falls asleep, its eyes breathing slowly.", function (k) {
      k.ldr("ROOM", "A0", 60).led("EYES", 9, "green").piezo("VOICE", 12);
      k.loop(`
        if (analogRead(ROOM) > 400) {             // daytime: awake
          digitalWrite(EYES, HIGH);
          if (random(0, 40) == 0) {               // a happy chirp, now and then
            tone(VOICE, random(900, 1800));
            delay(80);
            noTone(VOICE);
          }
          delay(50);
        } else {                                  // dark: asleep, breathing
          for (int b = 0; b <= 80; b += 4) { analogWrite(EYES, b); delay(40); }
          for (int b = 80; b >= 0; b -= 4) { analogWrite(EYES, b); delay(40); }
        }`);
    });

  add("pet_nod", "Curious desk pet", "Robots & pets", "pet", "nod head look distance peek shy creature",
    "Lean towards it and it leans back to look at you: a distance sensor in its eyes moves a servo in its neck.", function (k) {
      k.sonar(50).servo("neck", 9).led("EYES", 5, "white");
      k.loop(`
        long cm = constrain(distanceCm(), 5, 80);
        neck.write(map(cm, 5, 80, 150, 60));      // the closer you are, the further it tips back
        analogWrite(EYES, map(cm, 5, 80, 255, 10));
        delay(80);`);
    });

  add("scarecrow", "Garden scarecrow", "Robots & pets", "pet", "bird scare flap arms motion garden crow field",
    "When something moves in the garden it flaps its arms, flashes its eyes and squawks until the birds have gone.", function (k) {
      k.pir("MOTION", 2).servo("arms", 9).led("EYES", 6, "red").piezo("SQUAWK", 12);
      k.loop(`
        if (digitalRead(MOTION) == HIGH) {
          for (int i = 0; i < 5; i++) {
            arms.write(150);
            digitalWrite(EYES, HIGH);
            tone(SQUAWK, random(300, 900));
            delay(220);
            arms.write(30);
            digitalWrite(EYES, LOW);
            delay(220);
          }
          noTone(SQUAWK);
        }
        arms.write(90);
        delay(100);`);
    });

  /* ================================================ BOATS & SUBMARINES */

  add("sub_cruise", "Submarine", "Boats & submarines", "submarine", "dive surface underwater ballast pump porthole propeller",
    "A propeller motor, a second motor as the ballast pump, and porthole lights. It cruises, dives and surfaces.", function (k) {
      k.motor("PROP", 5, "fan").motor("PUMP", 3, "none").led("LIGHT", 9, "yellow").led("BEACON", 8, "blue").set.push("digitalWrite(LIGHT, HIGH);");
      k.func(`
        void blink(int times) {
          for (int i = 0; i < times; i++) {
            digitalWrite(BEACON, HIGH);
            delay(150);
            digitalWrite(BEACON, LOW);
            delay(150);
          }
        }`);
      k.loop(`
        analogWrite(PROP, 200);                   // ahead on the surface
        delay(3000);
        blink(3);
        analogWrite(PUMP, 255);                   // flood the tanks: dive
        delay(2500);
        analogWrite(PUMP, 0);
        delay(3000);                              // run deep
        analogWrite(PROP, 0);                     // stop and drift
        blink(5);
        delay(1500);`);
    });

  add("sub_deep", "Deep-sea explorer", "Boats & submarines", "submarine", "searchlight dark depth ocean abyss ldr automatic lights",
    "The deeper it goes, the darker it gets — and the brighter its searchlights shine. A light sensor decides.", function (k) {
      k.motor("PROP", 5, "fan").ldr("SUNLIGHT", "A0", 50).led("SEARCHLIGHT", 9, "white").led("BEACON", 8, "red");
      k.loop(`
        int light = analogRead(SUNLIGHT);
        analogWrite(SEARCHLIGHT, constrain(map(light, 100, 700, 255, 0), 0, 255));
        analogWrite(PROP, 190);
        digitalWrite(BEACON, (millis() / 500) % 2);          // a slow red flash
        delay(40);`);
    });

  add("sub_sonar", "Sonar submarine", "Boats & submarines", "submarine", "ping echo distance sound detect slow obstacle",
    "It pings like a real submarine: the nearer the thing ahead, the higher and faster the ping, and the slower it goes.", function (k) {
      k.motor("PROP", 5, "fan").sonar(90).piezo("PING", 12).led("CONTACT", 9, "green");
      k.loop(`
        long cm = constrain(distanceCm(), 5, 200);
        tone(PING, map(cm, 5, 200, 1800, 500));
        digitalWrite(CONTACT, HIGH);
        delay(70);
        noTone(PING);
        digitalWrite(CONTACT, LOW);
        analogWrite(PROP, constrain(map(cm, 15, 100, 0, 220), 0, 220));   // slow down as it closes in
        delay(constrain(cm * 6, 80, 900));`);
    });

  add("boat_weave", "Weaving boat", "Boats & submarines", "boat", "rudder servo steer zigzag sail propeller",
    "A propeller motor and a servo rudder. It sets off and weaves gently from side to side.", function (k) {
      k.motor("PROP", 5, "fan").servo("rudder", 9).led("LAMP", 8, "green").set.push("digitalWrite(LAMP, HIGH);", "analogWrite(PROP, 210);");
      k.loop(`
        for (int a = 60; a <= 120; a += 2) { rudder.write(a); delay(40); }
        for (int a = 120; a >= 60; a -= 2) { rudder.write(a); delay(40); }`);
    });

  add("boat_patrol", "Harbour patrol boat", "Boats & submarines", "boat", "navigation lights port starboard beacon police coastguard",
    "Red to port, green to starboard and a flashing masthead beacon — the lights a real boat must show — as it patrols.", function (k) {
      k.motor("PROP", 5, "fan").led("PORT", 8, "red").led("STARBOARD", 9, "green").led("MAST", 12, "white")
        .set.push("digitalWrite(PORT, HIGH);", "digitalWrite(STARBOARD, HIGH);");
      k.loop(`
        analogWrite(PROP, 180);
        digitalWrite(MAST, HIGH);
        delay(120);
        digitalWrite(MAST, LOW);
        delay(880);`);
    });

  add("boat_rescue", "Rescue boat", "Boats & submarines", "boat", "sos morse lifeboat emergency distress siren button",
    "Press the button and it races off flashing SOS in Morse with its siren going. Press again to stand down.", function (k) {
      k.motor("PROP", 5, "fan").button("CALL", 2).led("LAMP", 9, "orange").piezo("SIREN", 12).global("bool rescue = false;");
      k.func(`
        void flash(int ms) {
          digitalWrite(LAMP, HIGH);
          tone(SIREN, 1000);
          delay(ms);
          digitalWrite(LAMP, LOW);
          noTone(SIREN);
          delay(150);
        }`);
      k.loop(`
        if (digitalRead(CALL) == LOW) {           // pressed (the pin has a pull-up)
          rescue = !rescue;
          delay(300);
        }
        analogWrite(PROP, rescue ? 255 : 0);
        if (rescue) {
          for (int i = 0; i < 3; i++) flash(150);   // S
          for (int i = 0; i < 3; i++) flash(450);   // O
          for (int i = 0; i < 3; i++) flash(150);   // S
          delay(600);
        }
        delay(30);`);
    });

  /* ============================================================ ROCKETS */

  add("rocket_count", "Countdown rocket", "Rockets", "rocket", "space launch lift-off three two one shuttle engine",
    "Three countdown lights, a beeper and an engine output. Three, two, one — lift-off.", function (k) {
      k.motor("ENGINE", 5, "fan").led("L3", 2, "red").led("L2", 3, "yellow").led("L1", 4, "green").buzzer("BEEP", 8).serial();
      k.loop(`
        int lights[3] = {L3, L2, L1};
        for (int i = 0; i < 3; i++) {             // three… two… one…
          Serial.println(3 - i);
          digitalWrite(lights[i], HIGH);
          digitalWrite(BEEP, HIGH);
          delay(200);
          digitalWrite(BEEP, LOW);
          delay(800);
        }
        Serial.println("Lift-off!");
        analogWrite(ENGINE, 255);                 // engine on
        delay(2500);
        analogWrite(ENGINE, 0);                   // burn-out: coast and fall back
        for (int i = 0; i < 3; i++) digitalWrite(lights[i], LOW);
        delay(6000);`);
    });

  add("rocket_button", "Launch-button rocket", "Rockets", "rocket", "press fire ignition safety arm pad big red",
    "Nothing happens until someone presses the big red button. Then: warning light, countdown beeps, ignition.", function (k) {
      k.motor("ENGINE", 5, "fan").button("LAUNCH", 2).led("ARMED", 9, "red").piezo("BEEP", 12);
      k.loop(`
        if (digitalRead(LAUNCH) == LOW) {
          digitalWrite(ARMED, HIGH);
          for (int n = 5; n > 0; n--) {           // five beeps, rising
            tone(BEEP, 400 + (5 - n) * 150);
            delay(250);
            noTone(BEEP);
            delay(750);
          }
          tone(BEEP, 1600);
          analogWrite(ENGINE, 255);
          delay(3000);
          analogWrite(ENGINE, 0);
          noTone(BEEP);
          digitalWrite(ARMED, LOW);
        }
        delay(30);`);
    });

  add("rocket_mission", "Mission-control rocket", "Rockets", "rocket", "lcd display screen t-minus nasa telemetry clock",
    "A screen counts down from T-10, shows LIFT-OFF, then times the burn — mission control in one sketch.", function (k) {
      k.motor("ENGINE", 5, "fan").lcd().led("STATUS", 9, "green");
      k.loop(`
        for (int t = 10; t >= 1; t--) {
          lcd.clear();
          lcd.setCursor(0, 0);
          lcd.print("T minus ");
          lcd.print(t);
          lcd.setCursor(0, 1);
          lcd.print(t > 3 ? "All systems go" : "Ignition...");
          digitalWrite(STATUS, t % 2);
          delay(1000);
        }
        lcd.clear();
        lcd.setCursor(0, 0);
        lcd.print("   LIFT-OFF!");
        digitalWrite(STATUS, HIGH);
        analogWrite(ENGINE, 255);
        for (int s = 1; s <= 3; s++) {
          lcd.setCursor(0, 1);
          lcd.print("Burn ");
          lcd.print(s);
          lcd.print(" s");
          delay(1000);
        }
        analogWrite(ENGINE, 0);
        lcd.setCursor(0, 1);
        lcd.print("Engine cut-off ");
        delay(6000);`);
    });

  add("rocket_safe", "Safe-launch rocket", "Rockets", "rocket", "temperature abort hold overheat check sensor scrub",
    "Before every launch it checks the engine temperature. Too hot and the launch is scrubbed with a red light.", function (k) {
      k.motor("ENGINE", 5, "fan").temp("HEAT", "A0", 24).led("GO", 8, "green").led("ABORT", 9, "red").serial();
      k.loop(`
        float t = celsius();
        Serial.print("Engine ");
        Serial.print(t);
        Serial.println(" C");
        if (t > 40) {                             // too hot: hold the launch
          digitalWrite(GO, LOW);
          digitalWrite(ABORT, (millis() / 250) % 2);
          analogWrite(ENGINE, 0);
          delay(100);
        } else {
          digitalWrite(ABORT, LOW);
          digitalWrite(GO, HIGH);
          delay(2000);
          analogWrite(ENGINE, 255);
          delay(2500);
          analogWrite(ENGINE, 0);
          digitalWrite(GO, LOW);
          delay(5000);
        }`);
    });

  add("rocket_stage", "Two-stage rocket", "Rockets", "rocket", "booster separation parachute servo release staging recovery",
    "The engine burns, then a servo lets the booster go and, at the top, pops the parachute hatch.", function (k) {
      k.motor("ENGINE", 5, "fan").servo("latch", 9).led("STAGE", 8, "orange").piezo("BEEP", 12).set.push("latch.write(0);");
      k.loop(`
        latch.write(0);                           // everything locked
        delay(2000);
        tone(BEEP, 900);
        analogWrite(ENGINE, 255);                 // first stage
        delay(2500);
        analogWrite(ENGINE, 0);
        noTone(BEEP);
        digitalWrite(STAGE, HIGH);
        latch.write(90);                          // booster away
        delay(1500);
        latch.write(180);                         // parachute hatch open
        tone(BEEP, 1500);
        delay(300);
        noTone(BEEP);
        delay(6000);
        digitalWrite(STAGE, LOW);`);
    });

  /* ========================================================= SMART HOME */

  add("home_night", "Night light", "Smart home", "box", "lamp dark bedside ldr dim glow sleep",
    "A light sensor and an LED in a small case: the darker the room, the brighter the light.", function (k) {
      k.ldr("SENSOR", "A0", 60).led("LIGHT", 9, "white").serial();
      k.loop(`
        int level = analogRead(SENSOR);           // 0 dark … 1023 bright
        Serial.println(level);
        analogWrite(LIGHT, constrain(map(level, 200, 700, 255, 0), 0, 255));
        delay(100);`);
    });

  add("home_porch", "Automatic porch light", "Smart home", "house", "motion pir security outdoor welcome dark timer",
    "After dark, the porch light comes on when someone walks up and stays on for five seconds. In daylight it does nothing.", function (k) {
      k.pir("MOTION", 2).ldr("DAYLIGHT", "A0", 20).led("PORCH", 9, "white");
      k.loop(`
        bool dark = analogRead(DAYLIGHT) < 400;
        if (dark && digitalRead(MOTION) == HIGH) {
          digitalWrite(PORCH, HIGH);
          delay(5000);
        }
        digitalWrite(PORCH, LOW);
        delay(50);`);
    });

  add("home_alarm", "Burglar alarm", "Smart home", "house", "security intruder arm disarm motion siren pir thief",
    "Press the button to arm it — you get three seconds to leave. After that, any movement sets the siren off.", function (k) {
      k.pir("MOTION", 2).button("KEY", 4).led("ARMED", 8, "red").led("SAFE", 9, "green").piezo("SIREN", 12).global("bool armed = false;");
      k.loop(`
        if (digitalRead(KEY) == LOW) {
          armed = !armed;
          noTone(SIREN);
          if (armed) delay(3000);                 // time to get out
          else delay(300);
        }
        digitalWrite(ARMED, armed);
        digitalWrite(SAFE, !armed);
        if (armed && digitalRead(MOTION) == HIGH) {
          tone(SIREN, 1400);
          delay(150);
          tone(SIREN, 900);
          delay(150);
        } else {
          noTone(SIREN);
          delay(50);
        }`);
    });

  add("home_fire", "Fire alarm", "Smart home", "house", "flame smoke heat temperature safety detector warning",
    "A flame sensor and a temperature sensor watch the room. Either one can raise the alarm.", function (k) {
      k.sensor("flame", "FLAME", "A0", 5).temp("HEAT", "A1", 22).led("WARNING", 9, "red").piezo("SIREN", 12).serial();
      k.loop(`
        bool fire = analogRead(FLAME) < 400 || celsius() > 55;   // the flame sensor reads LOW when it sees fire
        Serial.println(fire ? "FIRE!" : "ok");
        if (fire) {
          digitalWrite(WARNING, HIGH);
          tone(SIREN, 2000);
          delay(200);
          digitalWrite(WARNING, LOW);
          tone(SIREN, 1200);
          delay(200);
        } else {
          noTone(SIREN);
          delay(300);
        }`);
    });

  add("home_gas", "Gas-leak alarm with fan", "Smart home", "house", "mq2 smoke kitchen extractor ventilation safety cooker",
    "If the gas sensor smells a leak it sounds the alarm and runs the extractor fan until the air is clear.", function (k) {
      k.sensor("gas", "GAS", "A0", 10).motor("FAN", 5, "fan").led("WARNING", 9, "red").buzzer("ALARM", 8).serial();
      k.loop(`
        int gas = analogRead(GAS);
        Serial.println(gas);
        if (gas > 450) {
          analogWrite(FAN, 255);
          digitalWrite(WARNING, HIGH);
          digitalWrite(ALARM, (millis() / 300) % 2);
        } else {
          analogWrite(FAN, 0);
          digitalWrite(WARNING, LOW);
          digitalWrite(ALARM, LOW);
        }
        delay(100);`);
    });

  add("home_thermostat", "Thermostat fan", "Smart home", "house", "temperature cool air conditioning lcd display climate",
    "The screen shows the temperature. Above 25 °C the fan starts, and the hotter it gets, the faster it spins.", function (k) {
      k.temp("SENSOR", "A0", 28).motor("FAN", 5, "fan").lcd();
      k.loop(`
        float t = celsius();
        int speed = t < 25 ? 0 : constrain(map(t * 10, 250, 350, 110, 255), 110, 255);
        analogWrite(FAN, speed);
        lcd.setCursor(0, 0);
        lcd.print("Room ");
        lcd.print(t);
        lcd.print(" C  ");
        lcd.setCursor(0, 1);
        lcd.print(speed == 0 ? "Fan off        " : "Fan on         ");
        delay(500);`);
    });

  add("home_blinds", "Sun-following blinds", "Smart home", "house", "curtain window shade servo light automatic sunny",
    "A servo tilts the blinds: wide open on a dull day, closing as the sun gets brighter.", function (k) {
      k.ldr("SUN", "A0", 65).servo("blinds", 9).serial();
      k.loop(`
        int sun = analogRead(SUN);
        int angle = constrain(map(sun, 200, 800, 0, 90), 0, 90);   // 0 = open, 90 = shut
        blinds.write(angle);
        Serial.println(angle);
        delay(300);`);
    });

  add("home_doorbell", "Doorbell", "Smart home", "house", "chime ding dong visitor ring bell button",
    "Ding-dong. Press the button and it plays a two-note chime and flashes the hall light.", function (k) {
      k.button("PUSH", 2).piezo("CHIME", 12).led("HALL", 9, "yellow");
      k.loop(`
        if (digitalRead(PUSH) == LOW) {
          digitalWrite(HALL, HIGH);
          tone(CHIME, 659);                       // ding
          delay(400);
          tone(CHIME, 523);                       // dong
          delay(600);
          noTone(CHIME);
          digitalWrite(HALL, LOW);
        }
        delay(30);`);
    });

  add("home_clap", "Clap-switch lamp", "Smart home", "house", "sound relay mains light clapper noise toggle",
    "Clap to switch the lamp on, clap to switch it off. A relay does the switching, so the lamp has its own supply.", function (k) {
      k.sensor("sound", "MIC", "A0", 20).relay("LAMP", 7).led("ON_LED", 9, "green").global("bool on = false;");
      k.loop(`
        if (analogRead(MIC) > 600) {
          on = !on;
          digitalWrite(LAMP, on);
          digitalWrite(ON_LED, on);
          delay(500);                             // let the clap die away
        }
        delay(10);`);
    });

  /* =================================================== GARDEN & WEATHER */

  add("garden_water", "Plant waterer", "Garden & weather", "box", "soil moisture pump irrigation dry automatic houseplant",
    "It feels the soil. When the pot is dry it runs the pump for two seconds, then waits to let the water soak in.", function (k) {
      k.sensor("soil", "SOIL", "A0", 20).motor("PUMP", 5, "none").led("DRY", 8, "red").led("WET", 9, "green").serial();
      k.loop(`
        int reading = analogRead(SOIL);           // this sensor reads HIGH when the soil is dry
        Serial.println(reading);
        bool dry = reading > 600;
        digitalWrite(DRY, dry);
        digitalWrite(WET, !dry);
        if (dry) {
          analogWrite(PUMP, 255);
          delay(2000);
          analogWrite(PUMP, 0);
          delay(4000);                            // let it soak in before looking again
        }
        delay(500);`);
    });

  add("garden_greenhouse", "Greenhouse", "Garden & weather", "house", "vent window temperature tomato plants hot fan servo climate",
    "Too warm? A servo opens the roof vent and a fan starts. It all shuts again as the greenhouse cools.", function (k) {
      k.temp("SENSOR", "A0", 31).servo("vent", 9).motor("FAN", 5, "fan").lcd();
      k.loop(`
        float t = celsius();
        bool hot = t > 28;
        vent.write(hot ? 90 : 0);
        analogWrite(FAN, hot ? 220 : 0);
        lcd.setCursor(0, 0);
        lcd.print("Greenhouse ");
        lcd.print(int(t));
        lcd.print("C ");
        lcd.setCursor(0, 1);
        lcd.print(hot ? "Vent OPEN  fan " : "Vent shut      ");
        delay(500);`);
    });

  add("weather_station", "Weather station", "Garden & weather", "tower", "temperature light lcd display forecast sunny outdoor",
    "Temperature on the top line, and on the bottom a word for the sky — night, cloudy, bright or sunny.", function (k) {
      k.temp("THERMO", "A0", 19).ldr("SKY", "A1", 70).lcd();
      k.loop(`
        int light = analogRead(SKY);
        lcd.setCursor(0, 0);
        lcd.print("Temp ");
        lcd.print(celsius());
        lcd.print(" C  ");
        lcd.setCursor(0, 1);
        if (light < 150) lcd.print("Night          ");
        else if (light < 450) lcd.print("Cloudy         ");
        else if (light < 750) lcd.print("Bright         ");
        else lcd.print("Sunny          ");
        delay(1000);`);
    });

  add("lighthouse", "Lighthouse", "Garden & weather", "tower", "beacon sea coast rotating lamp night ship warning",
    "Its lamp swells and fades like a turning beam — but only after dark. By day it saves its bulb.", function (k) {
      k.ldr("DAYLIGHT", "A0", 15).led("LAMP", 9, "yellow");
      k.loop(`
        if (analogRead(DAYLIGHT) > 500) {         // daytime
          analogWrite(LAMP, 0);
          delay(500);
        } else {
          for (int b = 0; b <= 255; b += 5) { analogWrite(LAMP, b); delay(8); }
          for (int b = 255; b >= 0; b -= 5) { analogWrite(LAMP, b); delay(8); }
          delay(1200);                            // the beam is pointing the other way
        }`);
    });

  add("frost_alarm", "Frost alarm", "Garden & weather", "box", "cold freeze ice temperature winter warning plants pipes",
    "A blue light and a beep when the temperature falls near freezing — time to bring the plants in.", function (k) {
      k.temp("THERMO", "A0", 2).led("FROST", 9, "blue").led("FINE", 8, "green").buzzer("BEEP", 12).serial();
      k.loop(`
        float t = celsius();
        Serial.println(t);
        bool frost = t < 3;
        digitalWrite(FROST, frost);
        digitalWrite(FINE, !frost);
        if (frost) {
          digitalWrite(BEEP, HIGH);
          delay(100);
          digitalWrite(BEEP, LOW);
        }
        delay(2000);`);
    });

  add("sun_tracker", "Sun tracker", "Garden & weather", "tower", "solar panel follow light servo heliostat sunflower",
    "Two light sensors and a servo: it turns to face the brightest part of the sky, the way a solar panel should.", function (k) {
      k.ldr("EAST", "A0", 70).ldr("WEST", "A1", 40).servo("panel", 9).global("int angle = 90;").serial();
      k.loop(`
        int east = analogRead(EAST), west = analogRead(WEST);
        if (east > west + 40 && angle > 10) angle -= 2;      // brighter to the east: turn that way
        if (west > east + 40 && angle < 170) angle += 2;
        panel.write(angle);
        Serial.println(angle);
        delay(60);`);
    });

  /* ==================================================== GAMES & GADGETS */

  add("game_reaction", "Reaction timer", "Games & gadgets", "box", "reflex speed test fast game quick milliseconds",
    "Wait for the light, then hit the button. The screen shows how many milliseconds you took.", function (k) {
      k.button("HIT", 2).led("GO", 9, "green").lcd();
      k.loop(`
        lcd.clear();
        lcd.print("Wait for it...");
        delay(random(1500, 5000));
        digitalWrite(GO, HIGH);
        unsigned long start = millis();
        while (digitalRead(HIT) == HIGH) { }      // wait for the press
        unsigned long took = millis() - start;
        digitalWrite(GO, LOW);
        lcd.clear();
        lcd.print("You took");
        lcd.setCursor(0, 1);
        lcd.print(took);
        lcd.print(" ms");
        delay(3000);`);
    });

  add("game_dice", "Electronic dice", "Games & gadgets", "box", "roll random number board game six",
    "Press to roll. The numbers tumble, slow down and stop on one to six.", function (k) {
      k.button("ROLL", 2).piezo("CLICK", 12).lcd().set.push("lcd.print(\"Press to roll\");");
      k.loop(`
        if (digitalRead(ROLL) == LOW) {
          int n = 1;
          for (int i = 0; i < 12; i++) {          // tumble, slowing down
            n = random(1, 7);
            lcd.clear();
            lcd.print("Rolling... ");
            lcd.print(n);
            tone(CLICK, 2000);
            delay(15);
            noTone(CLICK);
            delay(40 + i * 25);
          }
          lcd.clear();
          lcd.print("You rolled a ");
          lcd.print(n);
        }
        delay(30);`);
    });

  add("game_piano", "Four-key piano", "Games & gadgets", "box", "music keyboard notes instrument play tune keys",
    "Four buttons, four notes: C, E, G and top C. Enough for a fanfare.", function (k) {
      k.button("KEY_C", 2).button("KEY_E", 3).button("KEY_G", 4).button("KEY_TOP", 5).piezo("SPEAKER", 12);
      k.loop(`
        if (digitalRead(KEY_C) == LOW) tone(SPEAKER, 262);
        else if (digitalRead(KEY_E) == LOW) tone(SPEAKER, 330);
        else if (digitalRead(KEY_G) == LOW) tone(SPEAKER, 392);
        else if (digitalRead(KEY_TOP) == LOW) tone(SPEAKER, 523);
        else noTone(SPEAKER);
        delay(10);`);
    });

  add("game_quiz", "Quiz buzzers", "Games & gadgets", "box", "first press team contest game show buzzer fastest",
    "Two teams, two buttons. Whoever presses first lights their lamp and locks the other out for three seconds.", function (k) {
      k.button("TEAM_A", 2).button("TEAM_B", 3).led("LAMP_A", 8, "red").led("LAMP_B", 9, "blue").piezo("BUZZ", 12);
      k.loop(`
        int winner = 0;
        if (digitalRead(TEAM_A) == LOW) winner = LAMP_A;
        else if (digitalRead(TEAM_B) == LOW) winner = LAMP_B;
        if (winner != 0) {
          digitalWrite(winner, HIGH);
          tone(BUZZ, winner == LAMP_A ? 700 : 1000);
          delay(500);
          noTone(BUZZ);
          delay(2500);                            // the other team is locked out
          digitalWrite(winner, LOW);
        }`);
    });

  add("metronome", "Metronome", "Games & gadgets", "box", "music tempo beat tick practice bpm rhythm",
    "Turn the knob to set the tempo, from a slow 40 to a brisk 200 beats a minute. Every fourth tick is higher.", function (k) {
      k.pot("TEMPO", "A0").piezo("TICK", 12).led("BEAT", 9, "red").global("int count = 0;");
      k.loop(`
        int bpm = map(analogRead(TEMPO), 0, 1023, 40, 200);
        tone(TICK, count % 4 == 0 ? 1600 : 1000);
        digitalWrite(BEAT, HIGH);
        delay(40);
        noTone(TICK);
        digitalWrite(BEAT, LOW);
        delay(60000 / bpm - 40);
        count++;`);
    });

  add("kitchen_timer", "Kitchen timer", "Games & gadgets", "box", "countdown egg cooking alarm minutes clock",
    "Set the seconds with the knob, press start, and it counts down on the screen and rings when it is done.", function (k) {
      k.pot("DIAL", "A0").button("START", 2).piezo("RING", 12).lcd();
      k.loop(`
        int seconds = map(analogRead(DIAL), 0, 1023, 5, 120);
        lcd.setCursor(0, 0);
        lcd.print("Set: ");
        lcd.print(seconds);
        lcd.print(" s    ");
        if (digitalRead(START) == LOW) {
          for (int s = seconds; s > 0; s--) {
            lcd.setCursor(0, 1);
            lcd.print("Left: ");
            lcd.print(s);
            lcd.print(" s    ");
            delay(1000);
          }
          lcd.setCursor(0, 1);
          lcd.print("Time's up!      ");
          for (int i = 0; i < 4; i++) { tone(RING, 1500); delay(200); noTone(RING); delay(150); }
        }
        delay(100);`);
    });

  add("parking_sensor", "Parking sensor", "Games & gadgets", "box", "garage distance car wall green amber red beep",
    "Green, amber, red as the car creeps up to the garage wall, with beeps that turn into one long tone at STOP.", function (k) {
      k.sonar(120).led("GREEN", 8, "green").led("AMBER", 9, "yellow").led("RED", 12, "red").piezo("BEEP", 13);
      k.loop(`
        long cm = distanceCm();
        digitalWrite(GREEN, cm > 60);
        digitalWrite(AMBER, cm > 20 && cm <= 60);
        digitalWrite(RED, cm <= 20);
        if (cm <= 20) tone(BEEP, 1200);           // stop!
        else if (cm <= 60) { tone(BEEP, 1200); delay(60); noTone(BEEP); }
        else noTone(BEEP);
        delay(constrain(cm * 5, 60, 500));`);
    });

  add("tape_measure", "Digital tape measure", "Games & gadgets", "box", "distance ultrasonic ruler length cm lcd range",
    "Point it at a wall and read the distance off the screen, in centimetres and in metres.", function (k) {
      k.sonar(137).lcd();
      k.loop(`
        long cm = distanceCm();
        lcd.setCursor(0, 0);
        lcd.print("Distance:       ");
        lcd.setCursor(0, 1);
        lcd.print(cm);
        lcd.print(" cm  ");
        lcd.print(cm / 100.0);
        lcd.print(" m  ");
        delay(300);`);
    });

  add("light_meter", "Light meter", "Games & gadgets", "box", "brightness bar graph lux photography level leds",
    "Four lights in a row show how bright it is: one for dim, all four for dazzling.", function (k) {
      k.ldr("EYE", "A0", 55).led("BAR1", 8, "green").led("BAR2", 9, "green").led("BAR3", 12, "yellow").led("BAR4", 13, "red").serial();
      k.loop(`
        int level = analogRead(EYE);
        Serial.println(level);
        digitalWrite(BAR1, level > 200);
        digitalWrite(BAR2, level > 400);
        digitalWrite(BAR3, level > 600);
        digitalWrite(BAR4, level > 800);
        delay(100);`);
    });

  add("mood_lamp", "Colour-mixing mood lamp", "Games & gadgets", "box", "rgb rainbow fade colour relax ambient glow",
    "One RGB LED, three dimmers: it drifts slowly through red, green and blue and every colour in between.", function (k) {
      k.rgb(9, 6, 5);
      k.func(`
        void fade(int from, int to) {
          for (int i = 0; i <= 255; i += 3) {     // one colour down as the next comes up
            analogWrite(from, 255 - i);
            analogWrite(to, i);
            delay(20);
          }
        }`);
      k.loop(`
        fade(RED, GREEN);
        fade(GREEN, BLUE);
        fade(BLUE, RED);`);
    });

  add("morse_beacon", "Morse beacon", "Games & gadgets", "box", "code sos signal dots dashes flash message telegraph",
    "It spells out SOS in light and sound — three short, three long, three short — over and over.", function (k) {
      k.led("LAMP", 9, "white").piezo("TONE_OUT", 12);
      k.func(`
        void mark(int ms) {
          digitalWrite(LAMP, HIGH);
          tone(TONE_OUT, 700);
          delay(ms);
          digitalWrite(LAMP, LOW);
          noTone(TONE_OUT);
          delay(150);
        }`);
      k.loop(`
        for (int i = 0; i < 3; i++) mark(150);    // S: dot dot dot
        delay(300);
        for (int i = 0; i < 3; i++) mark(450);    // O: dash dash dash
        delay(300);
        for (int i = 0; i < 3; i++) mark(150);    // S
        delay(1500);`);
    });

  add("tilt_alarm", "Hands-off alarm", "Games & gadgets", "box", "tilt move pick up theft tamper diary treasure",
    "Put it on your treasure. If anyone picks it up or tips it, it screams until it is put back level.", function (k) {
      k.tilt("LEVEL", 2).led("WARNING", 9, "red").piezo("SIREN", 12);
      k.loop(`
        if (digitalRead(LEVEL) == HIGH) {         // the switch has opened: it's been tipped
          digitalWrite(WARNING, HIGH);
          tone(SIREN, 1800);
          delay(100);
          tone(SIREN, 1200);
          delay(100);
        } else {
          digitalWrite(WARNING, LOW);
          noTone(SIREN);
          delay(50);
        }`);
    });

  add("combo_lock", "Combination lock", "Games & gadgets", "box", "safe secret code password latch servo open treasure",
    "The latch only opens for the right three presses: A, B, A. Get it wrong and it buzzes and starts again.", function (k) {
      k.button("KEY_A", 2).button("KEY_B", 3).servo("latch", 9).led("OPEN", 8, "green").piezo("BUZZ", 12)
        .global("const int SECRET[3] = {1, 2, 1};      // 1 = A, 2 = B").global("int step = 0;").set.push("latch.write(0);");
      k.loop(`
        int pressed = 0;
        if (digitalRead(KEY_A) == LOW) pressed = 1;
        if (digitalRead(KEY_B) == LOW) pressed = 2;
        if (pressed != 0) {
          if (pressed == SECRET[step]) step++;
          else { step = 0; tone(BUZZ, 200); delay(400); noTone(BUZZ); }
          delay(350);                             // one press at a time
        }
        if (step == 3) {
          latch.write(90);                        // open
          digitalWrite(OPEN, HIGH);
          delay(4000);
          latch.write(0);                         // and lock again
          digitalWrite(OPEN, LOW);
          step = 0;
        }
        delay(20);`);
    });

  add("crossing", "Pedestrian crossing", "Games & gadgets", "box", "traffic lights road safety green man zebra wait",
    "Traffic lights for the cars and a button for people on foot. Press, wait for red, and cross while it beeps.", function (k) {
      k.led("RED", 8, "red").led("AMBER", 9, "yellow").led("GREEN", 12, "green").led("WALK", 13, "white").button("REQUEST", 2).piezo("BEEP", 6);
      k.loop(`
        digitalWrite(GREEN, HIGH);                // cars go
        if (digitalRead(REQUEST) == LOW) {
          delay(1500);
          digitalWrite(GREEN, LOW);
          digitalWrite(AMBER, HIGH);
          delay(1500);
          digitalWrite(AMBER, LOW);
          digitalWrite(RED, HIGH);
          digitalWrite(WALK, HIGH);
          for (int i = 0; i < 8; i++) { tone(BEEP, 1000); delay(150); noTone(BEEP); delay(350); }
          digitalWrite(WALK, LOW);
          digitalWrite(AMBER, HIGH);              // red and amber: get ready
          delay(1200);
          digitalWrite(RED, LOW);
          digitalWrite(AMBER, LOW);
        }
        delay(30);`);
    });

  add("theremin", "Light theremin", "Games & gadgets", "box", "music instrument wave hand sound pitch spooky",
    "Wave a hand over it and the note bends: a light sensor sets the pitch, like the eerie instrument in old films.", function (k) {
      k.ldr("EYE", "A0", 50).piezo("SPEAKER", 12);
      k.loop(`
        int light = analogRead(EYE);
        tone(SPEAKER, map(light, 100, 900, 150, 1800));
        delay(20);`);
    });

  /* ========================================================== BLUETOOTH */

  var PHONE_DRIVE = `
        if (bt.available()) {
          char c = bt.read();
          if (c == 'F') drive(230, 230);          // forward
          if (c == 'L') drive(0, 220);            // left
          if (c == 'R') drive(220, 0);            // right
          if (c == 'S' || c == 'B') drive(0, 0);  // stop`;

  add("bt_car", "Bluetooth car", "Bluetooth", "car", "phone remote control app wireless drive steer rc",
    "Drive it from the phone: the arrows steer, the square stops, and 1 and 0 work the headlights.", function (k) {
      k.wheels().bt().led("LAMPS", 9, "white").set.push("bt.println(\"Car ready: arrows to drive\");");
      k.loop(PHONE_DRIVE + `
          if (c == '1') digitalWrite(LAMPS, HIGH);
          if (c == '0') digitalWrite(LAMPS, LOW);
        }`);
    });

  add("bt_tank", "Bluetooth tank", "Bluetooth", "tank", "phone remote control battle armoured turret fire",
    "A tank on the phone's arrow pad. Button A fires the gun — a flash and a bang.", function (k) {
      k.wheels().bt().led("MUZZLE", 9, "orange").piezo("BANG", 12);
      k.loop(PHONE_DRIVE + `
          if (c == 'A') {                         // fire!
            digitalWrite(MUZZLE, HIGH);
            tone(BANG, 120);
            delay(150);
            noTone(BANG);
            digitalWrite(MUZZLE, LOW);
            bt.println("Boom");
          }
        }`);
    });

  add("bt_rover", "Bluetooth rover with horn", "Bluetooth", "robot", "phone remote robot control horn lights explore",
    "A rover you drive from the phone, with a horn on A, lights on 1 and 0, and a distance report on B.", function (k) {
      k.wheels().bt().sonar(80).led("LAMPS", 9, "white").piezo("HORN", 12);
      k.loop(PHONE_DRIVE + `
          if (c == '1') digitalWrite(LAMPS, HIGH);
          if (c == '0') digitalWrite(LAMPS, LOW);
          if (c == 'A') { tone(HORN, 440); delay(300); noTone(HORN); }
          if (c == 'B') {                         // "how far to the wall?"
            bt.print("Wall at ");
            bt.print(distanceCm());
            bt.println(" cm");
          }
        }`);
    });

  add("bt_sub", "Bluetooth submarine", "Bluetooth", "submarine", "phone remote dive surface underwater control captain",
    "You are the captain: forward and stop on the arrows, A to dive, B to surface, 1 and 0 for the lights.", function (k) {
      k.motor("PROP", 5, "fan").motor("PUMP", 3, "none").bt().led("LIGHTS", 9, "yellow");
      k.loop(`
        if (bt.available()) {
          char c = bt.read();
          if (c == 'F') { analogWrite(PROP, 220); bt.println("Ahead"); }
          if (c == 'S') { analogWrite(PROP, 0); analogWrite(PUMP, 0); bt.println("All stop"); }
          if (c == 'A') { analogWrite(PUMP, 255); bt.println("Dive! Dive!"); }
          if (c == 'B') { analogWrite(PUMP, 0); bt.println("Holding depth"); }
          if (c == '1') digitalWrite(LIGHTS, HIGH);
          if (c == '0') digitalWrite(LIGHTS, LOW);
        }`);
    });

  add("bt_boat", "Bluetooth boat", "Bluetooth", "boat", "phone remote rudder steer sail speedboat control",
    "Throttle on the up arrow, stop on the square, and the left and right arrows put the rudder over.", function (k) {
      k.motor("PROP", 5, "fan").servo("rudder", 9).bt().set.push("rudder.write(90);");
      k.loop(`
        if (bt.available()) {
          char c = bt.read();
          if (c == 'F') { analogWrite(PROP, 230); rudder.write(90); }
          if (c == 'S') analogWrite(PROP, 0);
          if (c == 'L') rudder.write(55);
          if (c == 'R') rudder.write(125);
          if (c == 'v') analogWrite(PROP, bt.parseInt());   // the slider is the throttle
        }`);
    });

  add("bt_rocket", "Bluetooth launch pad", "Bluetooth", "rocket", "phone remote ignition countdown mission control app",
    "Send 1 from the phone to launch. The countdown comes back to your screen, number by number.", function (k) {
      k.motor("ENGINE", 5, "fan").bt().led("ARMED", 9, "red").buzzer("BEEP", 8).set.push("bt.println(\"Pad ready. Send 1 to launch.\");");
      k.loop(`
        if (bt.available() && bt.read() == '1') {
          digitalWrite(ARMED, HIGH);
          for (int n = 5; n > 0; n--) {
            bt.println(n);
            digitalWrite(BEEP, HIGH);
            delay(150);
            digitalWrite(BEEP, LOW);
            delay(850);
          }
          bt.println("LIFT-OFF!");
          analogWrite(ENGINE, 255);
          delay(3000);
          analogWrite(ENGINE, 0);
          digitalWrite(ARMED, LOW);
          bt.println("Engine cut-off. Send 1 to go again.");
        }`);
    });

  add("bt_lights", "Bluetooth room lights", "Bluetooth", "house", "phone smart home lamp switch dimmer app control",
    "Three rooms on your phone: A and B switch the kitchen and the hall, the slider dims the lounge, 0 is everything off.", function (k) {
      k.bt().led("KITCHEN", 8, "white").led("HALL", 12, "yellow").led("LOUNGE", 9, "orange");
      k.loop(`
        if (bt.available()) {
          char c = bt.read();
          if (c == 'A') digitalWrite(KITCHEN, !digitalRead(KITCHEN));
          if (c == 'B') digitalWrite(HALL, !digitalRead(HALL));
          if (c == 'v') analogWrite(LOUNGE, bt.parseInt());
          if (c == '1') { digitalWrite(KITCHEN, HIGH); digitalWrite(HALL, HIGH); analogWrite(LOUNGE, 255); }
          if (c == '0') { digitalWrite(KITCHEN, LOW); digitalWrite(HALL, LOW); analogWrite(LOUNGE, 0); }
        }`);
    });

  add("bt_rgb", "Bluetooth colour lamp", "Bluetooth", "box", "phone rgb mood colour picker slider smart bulb",
    "Pick the colour with A (step through red, green, blue, white) and its brightness with the slider.", function (k) {
      k.bt().rgb(9, 6, 5).global("int colour = 0, level = 200;");
      k.func(`
        void show() {
          analogWrite(RED, colour == 0 || colour == 3 ? level : 0);
          analogWrite(GREEN, colour == 1 || colour == 3 ? level : 0);
          analogWrite(BLUE, colour == 2 || colour == 3 ? level : 0);
        }`);
      k.loop(`
        if (bt.available()) {
          char c = bt.read();
          if (c == 'A') colour = (colour + 1) % 4;
          if (c == 'v') level = bt.parseInt();
          if (c == '0') level = 0;
          if (c == '1') level = 200;
        }
        show();
        delay(20);`);
    });

  add("bt_lock", "Bluetooth door lock", "Bluetooth", "house", "phone smart lock key entry open servo secure",
    "No key: send 1 to unlock the door and 0 to lock it. The phone is told which, and a light shows it too.", function (k) {
      k.bt().servo("bolt", 9).led("LOCKED", 8, "red").led("OPEN", 12, "green").set.push("bolt.write(0);", "digitalWrite(LOCKED, HIGH);");
      k.loop(`
        if (bt.available()) {
          char c = bt.read();
          if (c == '1') {
            bolt.write(90);
            digitalWrite(LOCKED, LOW);
            digitalWrite(OPEN, HIGH);
            bt.println("Unlocked");
          }
          if (c == '0') {
            bolt.write(0);
            digitalWrite(LOCKED, HIGH);
            digitalWrite(OPEN, LOW);
            bt.println("Locked");
          }
        }`);
    });

  add("bt_notice", "Bluetooth notice board", "Bluetooth", "box", "phone message text lcd display sign type note",
    "Type a message on the phone and it appears on the screen. A door sign you can change from the sofa.", function (k) {
      k.bt().lcd().set.push("lcd.print(\"Send a message\");");
      k.loop(`
        if (bt.available()) {
          String msg = bt.readStringUntil('\\n');
          lcd.clear();
          lcd.setCursor(0, 0);
          lcd.print(msg.substring(0, 16));
          lcd.setCursor(0, 1);
          lcd.print(msg.substring(16, 32));
          bt.println("Shown.");
        }`);
    });

  add("bt_fan", "Bluetooth fan", "Bluetooth", "box", "phone speed control cooling desk temperature slider",
    "The slider is the speed. Send A and it tells you how warm the room is.", function (k) {
      k.bt().motor("FAN", 5, "fan").temp("THERMO", "A0", 26);
      k.loop(`
        if (bt.available()) {
          char c = bt.read();
          if (c == 'v') analogWrite(FAN, bt.parseInt());
          if (c == '0') analogWrite(FAN, 0);
          if (c == '1') analogWrite(FAN, 255);
          if (c == 'A') {
            bt.print("Room is ");
            bt.print(celsius());
            bt.println(" C");
          }
        }`);
    });

  add("bt_garden", "Bluetooth plant minder", "Bluetooth", "box", "phone soil moisture water pump report garden app",
    "Ask your plant how it is: A reports the soil moisture to the phone, and 1 gives it a two-second drink.", function (k) {
      k.bt().sensor("soil", "SOIL", "A0", 35).motor("PUMP", 5, "none").led("WATERING", 9, "blue");
      k.loop(`
        if (bt.available()) {
          char c = bt.read();
          if (c == 'A') {
            int soil = analogRead(SOIL);
            bt.print("Soil ");
            bt.print(constrain(map(soil, 1023, 290, 0, 100), 0, 100));   // the sensor reads high when dry
            bt.println(soil > 600 ? "% wet - thirsty!" : "% wet - fine");
          }
          if (c == '1') {
            digitalWrite(WATERING, HIGH);
            analogWrite(PUMP, 255);
            delay(2000);
            analogWrite(PUMP, 0);
            digitalWrite(WATERING, LOW);
            bt.println("Watered.");
          }
        }`);
    });

  /* ============================================================== RADIO */

  add("radio_car", "Radio-controlled car", "Radio", "car", "rc remote handset transmitter receiver 433 wireless drive two boards",
    "A proper RC car: a handset with three buttons sends F, L and R by radio, and the car's own board does the driving.", function (k) {
      var h = k.second("h");
      h.radio().button("FORWARD", 2).button("LEFT_KEY", 3).button("RIGHT_KEY", 4).led("SENDING", 9, "green");
      h.loop(`
        char cmd = 'S';
        if (digitalRead(FORWARD) == LOW) cmd = 'F';
        if (digitalRead(LEFT_KEY) == LOW) cmd = 'L';
        if (digitalRead(RIGHT_KEY) == LOW) cmd = 'R';
        radio.print(cmd);                         // one letter, ten times a second
        digitalWrite(SENDING, cmd != 'S');
        delay(100);`);
      k.wheels().radio().led("LINK", 9, "blue");
      k.loop(`
        if (radio.available()) {
          char c = radio.read();
          digitalWrite(LINK, HIGH);
          if (c == 'F') drive(230, 230);
          if (c == 'L') drive(0, 220);
          if (c == 'R') drive(220, 0);
          if (c == 'S') drive(0, 0);
        }`);
      return { u: "the car", uh: "the handset" };
    });

  add("radio_boat", "Radio-controlled boat", "Radio", "boat", "rc remote handset throttle rudder knob 433 two boards",
    "The handset's knob is the rudder and its button the throttle. Both go across the water as one line of text.", function (k) {
      var h = k.second("h");
      h.radio().pot("WHEEL", "A0").button("THROTTLE", 2);
      h.loop(`
        radio.print(digitalRead(THROTTLE) == LOW ? 1 : 0);   // e.g. 1,512
        radio.print(',');
        radio.println(analogRead(WHEEL));
        delay(120);`);
      k.motor("PROP", 5, "fan").servo("rudder", 9).radio().set.push("rudder.write(90);");
      k.loop(`
        if (radio.available()) {
          String msg = radio.readStringUntil('\\n');
          int comma = msg.indexOf(',');
          if (comma > 0) {
            int go = msg.substring(0, comma).toInt();
            int wheel = msg.substring(comma + 1).toInt();
            analogWrite(PROP, go ? 230 : 0);
            rudder.write(map(wheel, 0, 1023, 50, 130));
          }
        }`);
      return { u: "the boat", uh: "the handset" };
    });

  add("radio_rocket", "Radio launch control", "Radio", "rocket", "remote ignition bunker safe distance countdown 433 two boards",
    "Stand well back: the launch desk and the rocket are two boards, and the launch order goes between them by radio.", function (k) {
      var h = k.second("h");
      h.radio().button("FIRE", 2).led("SENT", 9, "red").lcd().set.push("lcd.print(\"Launch desk\");");
      h.loop(`
        if (digitalRead(FIRE) == LOW) {
          radio.print('L');
          digitalWrite(SENT, HIGH);
          lcd.setCursor(0, 1);
          lcd.print("Launch sent     ");
          delay(1000);
          digitalWrite(SENT, LOW);
        }
        if (radio.available()) {                  // the rocket answers back
          char c = radio.read();
          lcd.setCursor(0, 1);
          if (c == 'G') lcd.print("LIFT-OFF!       ");
          if (c == 'D') lcd.print("Flight complete ");
        }
        delay(30);`);
      k.motor("ENGINE", 5, "fan").radio().buzzer("BEEP", 8).led("ARMED", 9, "orange");
      k.loop(`
        if (radio.available() && radio.read() == 'L') {
          digitalWrite(ARMED, HIGH);
          for (int n = 3; n > 0; n--) {
            digitalWrite(BEEP, HIGH);
            delay(200);
            digitalWrite(BEEP, LOW);
            delay(800);
          }
          radio.print('G');                       // "go" back to the desk
          analogWrite(ENGINE, 255);
          delay(3000);
          analogWrite(ENGINE, 0);
          digitalWrite(ARMED, LOW);
          radio.print('D');                       // "done"
        }`);
      return { u: "the rocket", uh: "the launch desk" };
    });

  add("radio_bell", "Wireless doorbell", "Radio", "house", "chime remote push button no wires 433 two boards",
    "The push at the gate and the chime in the kitchen, with no wire between them: one sends a letter, the other rings.", function (k) {
      var h = k.second("h");
      h.radio().button("PUSH", 2).led("PRESSED", 9, "green");
      h.loop(`
        if (digitalRead(PUSH) == LOW) {
          radio.print('B');
          digitalWrite(PRESSED, HIGH);
          delay(600);                             // one ring per press
          digitalWrite(PRESSED, LOW);
        }
        delay(30);`);
      k.radio().piezo("CHIME", 12).led("HALL", 9, "yellow");
      k.loop(`
        if (radio.available() && radio.read() == 'B') {
          digitalWrite(HALL, HIGH);
          tone(CHIME, 659);
          delay(400);
          tone(CHIME, 523);
          delay(600);
          noTone(CHIME);
          digitalWrite(HALL, LOW);
        }`);
      return { u: "the chime indoors", uh: "the push at the gate" };
    });

  add("radio_weather", "Radio weather link", "Radio", "tower", "remote outdoor sensor indoor display temperature 433 telemetry two boards",
    "The sensor sits outside in the weather and the screen sits indoors in the warm. Every two seconds a reading crosses by radio.", function (k) {
      var h = k.second("h");
      h.radio().temp("THERMO", "A0", 9).ldr("SKY", "A1", 60).led("SENT", 9, "green");
      h.loop(`
        radio.print(int(celsius()));              // e.g. 9,640
        radio.print(',');
        radio.println(analogRead(SKY));
        digitalWrite(SENT, HIGH);
        delay(80);
        digitalWrite(SENT, LOW);
        delay(1920);`);
      k.radio().lcd().set.push("lcd.print(\"Waiting...\");");
      k.loop(`
        if (radio.available()) {
          String msg = radio.readStringUntil('\\n');
          int comma = msg.indexOf(',');
          if (comma > 0) {
            lcd.clear();
            lcd.print("Outside ");
            lcd.print(msg.substring(0, comma));
            lcd.print(" C");
            lcd.setCursor(0, 1);
            lcd.print(msg.substring(comma + 1).toInt() > 450 ? "Bright" : "Dull");
          }
        }`);
      return { u: "the indoor display", uh: "the outdoor sensor" };
    });

  add("radio_shed", "Radio shed alarm", "Radio", "house", "remote motion intruder garage security 433 alert two boards",
    "A motion sensor in the shed, a siren in the house. If anything moves out there, you hear about it in here.", function (k) {
      var h = k.second("h");
      h.radio().pir("MOTION", 2).led("SEEN", 9, "red");
      h.loop(`
        if (digitalRead(MOTION) == HIGH) {
          radio.print('M');
          digitalWrite(SEEN, HIGH);
          delay(1000);
        } else digitalWrite(SEEN, LOW);
        delay(50);`);
      k.radio().piezo("SIREN", 12).led("ALERT", 9, "red").led("QUIET", 8, "green");
      k.loop(`
        if (radio.available() && radio.read() == 'M') {
          digitalWrite(QUIET, LOW);
          for (int i = 0; i < 5; i++) {
            digitalWrite(ALERT, HIGH);
            tone(SIREN, 1500);
            delay(150);
            digitalWrite(ALERT, LOW);
            tone(SIREN, 1000);
            delay(150);
          }
          noTone(SIREN);
        }
        digitalWrite(QUIET, HIGH);`);
      return { u: "the siren indoors", uh: "the sensor in the shed" };
    });

  add("radio_dimmer", "Radio dimmer", "Radio", "box", "remote knob lamp brightness wireless control 433 two boards",
    "Turn a knob on one board and a lamp on the other brightens and dims to match, with nothing but air between them.", function (k) {
      var h = k.second("h");
      h.radio().pot("KNOB", "A0");
      h.loop(`
        radio.println(analogRead(KNOB) / 4);      // 0 to 255
        delay(100);`);
      k.radio().led("LAMP", 9, "white");
      k.loop(`
        if (radio.available()) {
          int level = radio.parseInt();
          analogWrite(LAMP, constrain(level, 0, 255));
        }`);
      return { u: "the lamp", uh: "the knob" };
    });

  add("fob_lights", "Key-fob house lights", "Radio", "house", "remote control 433 keyfob buttons channels lamp fan switch",
    "Four buttons on a key fob: A is the porch light, B the lounge, C the fan, and D switches the whole house off.", function (k) {
      k.fob().led("PORCH", 8, "white").led("LOUNGE", 9, "yellow").motor("FAN", 5, "fan").global("bool porch = false, lounge = false, fan = false;");
      k.loop(`
        if (digitalRead(KEY_A) == HIGH) { porch = !porch; delay(300); }
        if (digitalRead(KEY_B) == HIGH) { lounge = !lounge; delay(300); }
        if (digitalRead(KEY_C) == HIGH) { fan = !fan; delay(300); }
        if (digitalRead(KEY_D) == HIGH) { porch = false; lounge = false; fan = false; }
        digitalWrite(PORCH, porch);
        digitalWrite(LOUNGE, lounge);
        analogWrite(FAN, fan ? 200 : 0);
        delay(20);`);
    });

  add("fob_car", "Key-fob car", "Radio", "car", "remote control 433 keyfob buttons drive hold rc simple",
    "Hold A to go, B to turn left, C to turn right, and let go to stop. D sounds the horn.", function (k) {
      k.wheels().fob().piezo("HORN", 8);
      k.loop(`
        if (digitalRead(KEY_A) == HIGH) drive(230, 230);
        else if (digitalRead(KEY_B) == HIGH) drive(0, 220);
        else if (digitalRead(KEY_C) == HIGH) drive(220, 0);
        else drive(0, 0);
        if (digitalRead(KEY_D) == HIGH) tone(HORN, 440);
        else noTone(HORN);
        delay(20);`);
    });

  add("fob_garage", "Key-fob garage door", "Radio", "house", "remote control 433 keyfob opener servo gate barrier",
    "A opens the door, B closes it, and an amber light flashes while it moves so nobody walks underneath.", function (k) {
      k.fob().servo("door", 9).led("WARNING", 8, "orange").global("int angle = 0;").set.push("door.write(0);");
      k.func(`
        void moveTo(int target) {
          while (angle != target) {
            angle += angle < target ? 1 : -1;
            door.write(angle);
            digitalWrite(WARNING, (angle / 8) % 2);
            delay(25);
          }
          digitalWrite(WARNING, LOW);
        }`);
      k.loop(`
        if (digitalRead(KEY_A) == HIGH) moveTo(90);          // up
        if (digitalRead(KEY_B) == HIGH) moveTo(0);           // down
        delay(20);`);
    });
})(typeof window !== "undefined" ? window : globalThis);
