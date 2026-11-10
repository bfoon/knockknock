/* Chalk Circuit Lab — ready-made circuits.
 *
 * Each one is built the way you would build it on a bench: "put the LED's
 * long leg in hole f12", "run a wire from pin 13 to j8". The helper turns
 * that into coordinates, so every leg lands exactly in a hole and every
 * example is a real, working circuit — the test suite runs them all.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var P = L.P;

  var C = { red: "#d63a2f", black: "#2a2a2c", yellow: "#e8c22a", green: "#2fa35a", blue: "#2f6fd1", orange: "#ef8a1f", white: "#e9e9e9", purple: "#8b4fc9" };
  L.WIRE_COLORS = C;

  function Builder(mode) { this.doc = L.blankDoc(mode); }
  Builder.prototype.add = function (type, x, y, props, rot) {
    var p = { id: L.uid("p"), type: type, x: L.snap(x), y: L.snap(y), rot: rot || 0, props: props || {} };
    this.doc.parts.push(p);
    return p;
  };
  /* Place a part so its first pin lands in a breadboard hole. */
  Builder.prototype.on = function (bb, type, hole, props, rot, pinName) {
    var h = this.hole(bb, hole);
    var probe = { id: "probe", type: type, x: 0, y: 0, rot: rot || 0, props: props || {} };
    var pins = L.pinsOf(probe);
    var first = pinName ? pins.filter(function (q) { return q.name === pinName; })[0] : pins[0];
    var p = this.add(type, 0, 0, props, rot);
    p.x = h.x - first.x; p.y = h.y - first.y;
    return p;
  };
  Builder.prototype.hole = function (bb, name) {
    var pin = L.pinsOf(bb).filter(function (q) { return q.name === name; })[0];
    if (!pin) throw new Error("no hole " + name);
    return pin;
  };
  /* end: "partId:pin", or [part, pinName] */
  Builder.prototype.wire = function (a, b, color) {
    var ref = function (e) { return { ref: Array.isArray(e) ? e[0].id + ":" + e[1] : e }; };
    var w = { id: L.uid("w"), a: ref(a), b: ref(b), color: color || C.yellow, pts: [] };
    this.doc.wires.push(w);
    return w;
  };
  L.Builder = Builder;

  /* LED + resistor on the lower half of a breadboard: resistor from h[c] to
   * h[c+4], LED anode at f[c+4], cathode at f[c+5], cathode to the GND rail. */
  function ledSet(B, bb, c, color, ohms) {
    var r = B.on(bb, "resistor", "h" + c, { ohms: ohms || 220 });
    var led = B.on(bb, "led", "f" + (c + 4), { color: color });
    B.wire([bb, "j" + (c + 5)], [bb, "bn" + (c + 5)], C.black);
    return { r: r, led: led, input: "j" + c };
  }

  var EX = L.EXAMPLES = [];
  function ex(def) { EX.push(def); }

  /* ================================================================= PRO */

  ex({
    id: "blink", mode: "pro", name: "Blink", level: "Start here",
    blurb: "The first program everyone writes: pin 13 switches an LED on and off every half second.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0), bb = B.add("breadboard_half", 32 * P, 2 * P);
      var s = ledSet(B, bb, 8, "red");
      B.wire([uno, "D13"], [bb, s.input], C.orange);
      B.wire([uno, "GND1"], [bb, "bn2"], C.black);
      return B.doc;
    },
    code: [
      "// Blink: the LED on pin 13 flashes once a second.",
      "",
      "const int LED = 13;",
      "",
      "void setup() {",
      "  pinMode(LED, OUTPUT);       // pin 13 will push power out",
      "}",
      "",
      "void loop() {",
      "  digitalWrite(LED, HIGH);    // 5 V on: current flows, the LED lights",
      "  delay(500);                 // wait half a second",
      "  digitalWrite(LED, LOW);     // 0 V: no current, the LED goes dark",
      "  delay(500);",
      "}"
    ]
  });

  ex({
    id: "button", mode: "pro", name: "Button and LED", level: "Start here",
    blurb: "Hold the button and the LED lights. Uses the Arduino's built-in pull-up, so no extra resistor is needed.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0), bb = B.add("breadboard_half", 32 * P, 2 * P);
      var s = ledSet(B, bb, 8, "green");
      B.on(bb, "button", "e20", { cap: "#2f64d4" });
      B.wire([uno, "D13"], [bb, s.input], C.orange);
      B.wire([uno, "D2"], [bb, "a20"], C.blue);
      B.wire([bb, "j22"], [bb, "bn22"], C.black);
      B.wire([uno, "GND1"], [bb, "bn2"], C.black);
      return B.doc;
    },
    code: [
      "// Press the button: the LED comes on.",
      "",
      "const int BUTTON = 2;",
      "const int LED = 13;",
      "",
      "void setup() {",
      "  pinMode(BUTTON, INPUT_PULLUP);  // reads HIGH until the button joins it to GND",
      "  pinMode(LED, OUTPUT);",
      "}",
      "",
      "void loop() {",
      "  if (digitalRead(BUTTON) == LOW) {   // pressed",
      "    digitalWrite(LED, HIGH);",
      "  } else {",
      "    digitalWrite(LED, LOW);",
      "  }",
      "}"
    ]
  });

  ex({
    id: "traffic", mode: "pro", name: "Traffic light", level: "Start here",
    blurb: "Three LEDs on three pins, stepping through red, red-amber, green and amber.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0), bb = B.add("breadboard_half", 32 * P, 2 * P);
      var r = ledSet(B, bb, 2, "red"), y = ledSet(B, bb, 9, "yellow"), g = ledSet(B, bb, 16, "green");
      B.wire([uno, "D12"], [bb, r.input], C.red);
      B.wire([uno, "D11"], [bb, y.input], C.yellow);
      B.wire([uno, "D10"], [bb, g.input], C.green);
      B.wire([uno, "GND1"], [bb, "bn1"], C.black);
      return B.doc;
    },
    code: [
      "// A UK-style traffic light.",
      "",
      "const int RED = 12, AMBER = 11, GREEN = 10;",
      "",
      "void lights(int r, int a, int g, int ms) {",
      "  digitalWrite(RED, r);",
      "  digitalWrite(AMBER, a);",
      "  digitalWrite(GREEN, g);",
      "  delay(ms);",
      "}",
      "",
      "void setup() {",
      "  pinMode(RED, OUTPUT);",
      "  pinMode(AMBER, OUTPUT);",
      "  pinMode(GREEN, OUTPUT);",
      "}",
      "",
      "void loop() {",
      "  lights(HIGH, LOW, LOW, 3000);   // stop",
      "  lights(HIGH, HIGH, LOW, 1000);  // get ready",
      "  lights(LOW, LOW, HIGH, 3000);   // go",
      "  lights(LOW, HIGH, LOW, 1000);   // prepare to stop",
      "}"
    ]
  });

  ex({
    id: "fade", mode: "pro", name: "Fade (PWM)", level: "Next steps",
    blurb: "analogWrite() switches pin 9 on and off 490 times a second; changing how long it stays on dims the LED.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0), bb = B.add("breadboard_half", 32 * P, 2 * P);
      var s = ledSet(B, bb, 8, "blue");
      var sc = B.add("scope", 46 * P, 32 * P);
      B.wire([uno, "D9"], [bb, s.input], C.orange);
      B.wire([uno, "GND1"], [bb, "bn2"], C.black);
      B.wire([sc, "CH1"], [bb, "i8"], C.yellow);
      B.wire([sc, "GND"], [bb, "bn20"], C.black);
      return B.doc;
    },
    code: [
      "// Fade an LED up and down with PWM. Watch the scope:",
      "// the pin is always fully on or fully off — only the timing changes.",
      "",
      "const int LED = 9;   // must be a ~ pin",
      "",
      "void setup() {",
      "  pinMode(LED, OUTPUT);",
      "}",
      "",
      "void loop() {",
      "  for (int b = 0; b <= 255; b += 5) {",
      "    analogWrite(LED, b);",
      "    delay(20);",
      "  }",
      "  for (int b = 255; b >= 0; b -= 5) {",
      "    analogWrite(LED, b);",
      "    delay(20);",
      "  }",
      "}"
    ]
  });

  ex({
    id: "nightlight", mode: "pro", name: "Night light", level: "Next steps",
    blurb: "A light sensor and a 10 kΩ resistor make a voltage that falls as the room gets darker. Below a threshold, the LED comes on.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0), bb = B.add("breadboard_half", 32 * P, 2 * P);
      B.on(bb, "ldr", "a4", { light: 70 });
      B.on(bb, "resistor", "c5", { ohms: 10000 });
      var s = ledSet(B, bb, 12, "white");
      B.wire([uno, "5V"], [bb, "e4"], C.red);
      B.wire([uno, "A0"], [bb, "d5"], C.green);
      B.wire([uno, "GND2"], [bb, "e9"], C.black);
      B.wire([uno, "D9"], [bb, s.input], C.orange);
      B.wire([uno, "GND1"], [bb, "bn2"], C.black);
      return B.doc;
    },
    code: [
      "// Night light: turn the light down on the sensor and watch.",
      "",
      "const int SENSOR = A0;",
      "const int LED = 9;",
      "const int DARK = 400;   // try changing this",
      "",
      "void setup() {",
      "  Serial.begin(9600);",
      "  pinMode(LED, OUTPUT);",
      "}",
      "",
      "void loop() {",
      "  int light = analogRead(SENSOR);   // 0 (dark) to 1023 (bright)",
      "  Serial.print(\"light = \");",
      "  Serial.println(light);",
      "  if (light < DARK) {",
      "    digitalWrite(LED, HIGH);",
      "  } else {",
      "    digitalWrite(LED, LOW);",
      "  }",
      "  delay(200);",
      "}"
    ]
  });

  ex({
    id: "servo", mode: "pro", name: "Servo dial", level: "Next steps",
    blurb: "Turn the knob and the servo follows. map() turns 0–1023 from the knob into 0–180 degrees.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0), bb = B.add("breadboard_half", 32 * P, 2 * P);
      B.on(bb, "potentiometer", "e6", { pos: 0.3 });
      var sv = B.add("servo", 50 * P, 34 * P);
      B.wire([uno, "5V"], [bb, "bp1"], C.red);
      B.wire([uno, "GND1"], [bb, "bn1"], C.black);
      B.wire([bb, "a6"], [bb, "tn5"], C.black);
      B.wire([bb, "a8"], [bb, "tp8"], C.red);
      B.wire([bb, "tp29"], [bb, "bp29"], C.red);
      B.wire([bb, "tn29"], [bb, "bn29"], C.black);
      B.wire([uno, "A0"], [bb, "a7"], C.green);
      B.wire([sv, "GND"], [bb, "bn20"], C.black);
      B.wire([sv, "V+"], [bb, "bp21"], C.red);
      B.wire([sv, "SIG"], [uno, "D9"], C.orange);
      return B.doc;
    },
    code: [
      "#include <Servo.h>",
      "",
      "Servo arm;",
      "",
      "void setup() {",
      "  arm.attach(9);",
      "}",
      "",
      "void loop() {",
      "  int knob = analogRead(A0);            // 0 to 1023",
      "  int angle = map(knob, 0, 1023, 0, 180);",
      "  arm.write(angle);",
      "  delay(15);",
      "}"
    ]
  });

  ex({
    id: "thermo", mode: "pro", name: "Temperature alarm", level: "Projects",
    blurb: "A TMP36 reports the temperature. Above 30 °C the buzzer sounds and the Serial monitor shouts about it.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0), bb = B.add("breadboard_half", 32 * P, 2 * P);
      B.on(bb, "tmp36", "e10", { temp: 24 });
      B.on(bb, "piezo", "g20");
      B.wire([uno, "5V"], [bb, "a10"], C.red);
      B.wire([uno, "A0"], [bb, "a11"], C.green);
      B.wire([uno, "GND2"], [bb, "a12"], C.black);
      B.wire([uno, "D8"], [bb, "j20"], C.orange);
      B.wire([bb, "j22"], [bb, "bn22"], C.black);
      B.wire([uno, "GND1"], [bb, "bn2"], C.black);
      return B.doc;
    },
    code: [
      "// Select the TMP36 and drag its temperature above 30 °C.",
      "",
      "const float ALARM_AT = 30.0;",
      "",
      "void setup() {",
      "  Serial.begin(9600);",
      "  pinMode(8, OUTPUT);",
      "}",
      "",
      "void loop() {",
      "  int raw = analogRead(A0);",
      "  float volts = raw * 5.0 / 1023.0;",
      "  float celsius = (volts - 0.5) * 100.0;   // TMP36: 10 mV per degree, 0.5 V at 0 °C",
      "  Serial.print(celsius);",
      "  Serial.println(\" C\");",
      "  if (celsius > ALARM_AT) {",
      "    tone(8, 880, 200);",
      "  }",
      "  delay(500);",
      "}"
    ]
  });

  ex({
    id: "distance", mode: "pro", name: "Distance meter", level: "Projects",
    blurb: "An HC-SR04 times a sound echo and the I²C screen shows the distance. Slide the object nearer and further.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0);
      var us = B.add("hcsr04", 38 * P, 10 * P), lcd = B.add("lcd_i2c", 33 * P, 24 * P);
      B.wire([us, "VCC"], [uno, "5V"], C.red);
      B.wire([us, "TRIG"], [uno, "D9"], C.yellow);
      B.wire([us, "ECHO"], [uno, "D10"], C.green);
      B.wire([us, "GND"], [uno, "GND2"], C.black);
      B.wire([lcd, "GND"], [uno, "GND1"], C.black);
      B.wire([lcd, "VCC"], [uno, "5V"], C.red);
      B.wire([lcd, "SDA"], [uno, "A4"], C.blue);
      B.wire([lcd, "SCL"], [uno, "A5"], C.purple);
      return B.doc;
    },
    code: [
      "#include <LiquidCrystal_I2C.h>",
      "",
      "LiquidCrystal_I2C lcd(0x27, 16, 2);",
      "const int TRIG = 9, ECHO = 10;",
      "",
      "void setup() {",
      "  pinMode(TRIG, OUTPUT);",
      "  pinMode(ECHO, INPUT);",
      "  lcd.init();",
      "  lcd.backlight();",
      "  lcd.print(\"Distance meter\");",
      "}",
      "",
      "void loop() {",
      "  digitalWrite(TRIG, HIGH);         // a 10 microsecond ping",
      "  delayMicroseconds(10);",
      "  digitalWrite(TRIG, LOW);",
      "  long echo = pulseIn(ECHO, HIGH);  // how long the echo took",
      "  int cm = echo / 58;               // sound: about 58 µs per cm, there and back",
      "  lcd.setCursor(0, 1);",
      "  lcd.print(cm);",
      "  lcd.print(\" cm         \");",
      "  delay(250);",
      "}"
    ]
  });

  ex({
    id: "motor", mode: "pro", name: "Motor speed (MOSFET)", level: "Projects",
    blurb: "A motor needs far more current than a pin can give. The pin drives a MOSFET's gate; the MOSFET switches the battery's current. The diode catches the motor's kick.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0);
      var bat = B.add("battery_aa", 46 * P, 4 * P, { cells: 4 });
      var mot = B.add("motor", 52 * P, 24 * P), q = B.add("nmos", 40 * P, 30 * P), rg = B.add("resistor", 33 * P, 28 * P, { ohms: 220 });
      var d = B.add("diode", 51 * P, 14 * P, {}, 0);
      B.wire([bat, "+"], [mot, "1"], C.red);
      B.wire([mot, "2"], [q, "D"], C.blue);
      B.wire([q, "S"], [bat, "-"], C.black);
      B.wire([uno, "D9"], [rg, "1"], C.orange);
      B.wire([rg, "2"], [q, "G"], C.orange);
      B.wire([uno, "GND1"], [q, "S"], C.black);
      B.wire([d, "K"], [mot, "1"], C.white);
      B.wire([d, "A"], [mot, "2"], C.white);
      return B.doc;
    },
    code: [
      "// Speed the motor up, then slow it down.",
      "",
      "const int GATE = 9;",
      "",
      "void setup() {",
      "  pinMode(GATE, OUTPUT);",
      "  Serial.begin(9600);",
      "}",
      "",
      "void loop() {",
      "  for (int speed = 0; speed <= 255; speed += 15) {",
      "    analogWrite(GATE, speed);",
      "    Serial.println(speed);",
      "    delay(150);",
      "  }",
      "  delay(1000);",
      "  analogWrite(GATE, 0);",
      "  delay(1500);",
      "}"
    ]
  });

  ex({
    id: "relay", mode: "pro", name: "Relay switches a lamp", level: "Projects",
    blurb: "The Arduino's 5 V circuit clicks a relay that switches a completely separate lamp circuit — the way it would switch a mains lamp.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0);
      var rm = B.add("relay_module", 34 * P, 6 * P), bat = B.add("battery_aa", 54 * P, 18 * P, { cells: 4 }), lamp = B.add("bulb", 50 * P, 28 * P);
      B.wire([rm, "VCC"], [uno, "5V"], C.red);
      B.wire([rm, "GND"], [uno, "GND1"], C.black);
      B.wire([rm, "IN"], [uno, "D7"], C.yellow);
      B.wire([bat, "+"], [rm, "COM"], C.red);
      B.wire([rm, "NO"], [lamp, "1"], C.orange);
      B.wire([lamp, "2"], [bat, "-"], C.black);
      return B.doc;
    },
    code: [
      "// Click the relay every two seconds.",
      "",
      "const int RELAY = 7;",
      "",
      "void setup() {",
      "  pinMode(RELAY, OUTPUT);",
      "}",
      "",
      "void loop() {",
      "  digitalWrite(RELAY, HIGH);   // click: COM joins NO, the lamp lights",
      "  delay(2000);",
      "  digitalWrite(RELAY, LOW);    // clack: COM goes back to NC",
      "  delay(2000);",
      "}"
    ]
  });

  ex({
    id: "timer555", mode: "pro", name: "555 blinker (no code)", level: "Electronics",
    blurb: "No microcontroller at all. The capacitor charges through both resistors and empties through one, and the 555 flips its output each time.",
    build: function () {
      var B = new Builder("pro"), bb = B.add("breadboard_half", 0, 0);
      var bat = B.add("battery_9v", 0, 0);
      var h = B.hole(bb, "tp1"); bat.x = h.x; bat.y = h.y;
      B.on(bb, "ic555", "f10");   /* pin 1 bottom-left, notch to the left */
      B.on(bb, "resistor", "b7", { ohms: 1000 });
      B.on(bb, "resistor", "c8", { ohms: 10000 });
      B.on(bb, "capacitor_e", "i5", { farads: 1e-4 });
      B.on(bb, "resistor", "i12", { ohms: 470 });
      B.on(bb, "led", "g16", { color: "red" });
      B.wire([bb, "a10"], [bb, "tp10"], C.red);
      B.wire([bb, "j13"], [bb, "bp13"], C.red);
      B.wire([bb, "j10"], [bb, "bn10"], C.black);
      B.wire([bb, "a7"], [bb, "tp7"], C.red);
      B.wire([bb, "d8"], [bb, "d11"], C.yellow);
      B.wire([bb, "a12"], [bb, "h11"], C.green);
      B.wire([bb, "h5"], [bb, "g11"], C.green);
      B.wire([bb, "j6"], [bb, "bn7"], C.black);
      B.wire([bb, "j17"], [bb, "bn17"], C.black);
      B.wire([bb, "tp29"], [bb, "bp29"], C.red);
      B.wire([bb, "tn29"], [bb, "bn29"], C.black);
      return B.doc;
    },
    code: null
  });

  ex({
    id: "gates", mode: "pro", name: "AND gate", level: "Electronics",
    blurb: "Two switches feed a 74HC08. The LED only lights when both are on. Swap the chip to OR, NAND or XOR in the inspector.",
    build: function () {
      var B = new Builder("pro");
      var psu = B.add("psu", 4 * P, 20 * P, { volts: 5 });
      var ic = B.add("logic_ic", 20 * P, 8 * P, { chip: "7408" });
      var s1 = B.add("slide_switch", 8 * P, 4 * P), s2 = B.add("slide_switch", 8 * P, 12 * P);
      var r = B.add("resistor", 30 * P, 16 * P, { ohms: 330 }), led = B.add("led", 36 * P, 16 * P, { color: "green" });
      var p = function (n) { return [ic, String(n)]; };
      B.wire([psu, "+"], p(14), C.red);
      B.wire([psu, "-"], p(7), C.black);
      B.wire([psu, "+"], [s1, "R"], C.red);
      B.wire([psu, "-"], [s1, "L"], C.black);
      B.wire([psu, "+"], [s2, "R"], C.red);
      B.wire([psu, "-"], [s2, "L"], C.black);
      B.wire([s1, "C"], p(1), C.yellow);
      B.wire([s2, "C"], p(2), C.blue);
      B.wire(p(3), [r, "1"], C.green);
      B.wire([r, "2"], [led, "A"], C.green);
      B.wire([led, "K"], [psu, "-"], C.black);
      return B.doc;
    },
    code: null
  });

  /* ================================================================= KID */

  ex({
    id: "k_light", mode: "kid", name: "Light it up!", level: "Toy box",
    blurb: "A battery, a switch and a bulb in one big loop. Click the switch to close the gate.",
    build: function () {
      var B = new Builder("kid");
      var bat = B.add("k_battery", 6 * P, 22 * P, { volts: 3 }), sw = B.add("k_switch", 6 * P, 10 * P), bulb = B.add("k_bulb", 22 * P, 14 * P);
      B.wire([bat, "+"], [sw, "a"], C.red);
      B.wire([sw, "b"], [bulb, "a"], C.yellow);
      B.wire([bulb, "b"], [bat, "-"], C.black);
      return B.doc;
    },
    code: null
  });

  ex({
    id: "k_fan", mode: "kid", name: "Fan on a button", level: "Toy box",
    blurb: "Hold the red button to send electricity round to the motor.",
    build: function () {
      var B = new Builder("kid");
      var bat = B.add("k_battery", 6 * P, 22 * P, { volts: 4.5 }), btn = B.add("k_button", 6 * P, 10 * P), m = B.add("k_motor", 22 * P, 16 * P);
      B.wire([bat, "+"], [btn, "a"], C.red);
      B.wire([btn, "b"], [m, "a"], C.yellow);
      B.wire([m, "b"], [bat, "-"], C.black);
      return B.doc;
    },
    code: null
  });

  ex({
    id: "k_blink", mode: "kid", name: "Robo Brain blinks", level: "Robo Brain",
    blurb: "Tell the Robo Brain to turn OUT 1 on and off. Change the waiting time and see what happens.",
    build: function () {
      var B = new Builder("kid");
      var br = B.add("k_brain", 6 * P, 16 * P), led = B.add("k_led", 8 * P, 6 * P, { color: "green" });
      B.wire([br, "OUT1"], [led, "+"], C.yellow);
      B.wire([led, "-"], [br, "GND1"], C.black);
      return B.doc;
    },
    blocks: function () {
      var M = L.Blocks.make;
      return { setup: [], loop: [M("write", { pin: "3", hl: "1" }), M("wait", { ms: "1" }), M("write", { pin: "3", hl: "0" }), M("wait", { ms: "1" })], vars: [] };
    }
  });

  ex({
    id: "k_traffic", mode: "kid", name: "Robo traffic light", level: "Robo Brain",
    blurb: "Three lights on three OUT posts, switched in turn.",
    build: function () {
      var B = new Builder("kid");
      var br = B.add("k_brain", 6 * P, 16 * P);
      var cols = ["red", "yellow", "green"], outs = ["OUT1", "OUT2", "OUT3"];
      cols.forEach(function (c, i) {
        var led = B.add("k_led", (4 + i * 9) * P, 5 * P, { color: c });
        B.wire([br, outs[i]], [led, "+"], C[c === "yellow" ? "yellow" : c]);
        B.wire([led, "-"], [br, "GND1"], C.black);
      });
      return B.doc;
    },
    blocks: function () {
      var M = L.Blocks.make;
      return { setup: [], loop: [
        M("write", { pin: "3", hl: "1" }), M("wait", { ms: "2" }), M("write", { pin: "3", hl: "0" }),
        M("write", { pin: "5", hl: "1" }), M("wait", { ms: "1" }), M("write", { pin: "5", hl: "0" }),
        M("write", { pin: "6", hl: "1" }), M("wait", { ms: "2" }), M("write", { pin: "6", hl: "0" })
      ], vars: [] };
    }
  });

  ex({
    id: "k_night", mode: "kid", name: "Robo night light", level: "Robo Brain",
    blurb: "The light sensor is the Robo Brain's eye. When it gets dark, the light comes on.",
    build: function () {
      var B = new Builder("kid");
      var br = B.add("k_brain", 6 * P, 16 * P), led = B.add("k_led", 8 * P, 6 * P, { color: "white" }), eye = B.add("k_ldr", 22 * P, 33 * P, { light: 80 });
      B.wire([br, "OUT1"], [led, "+"], C.yellow);
      B.wire([led, "-"], [br, "GND1"], C.black);
      B.wire([br, "5V"], [eye, "b"], C.red);
      B.wire([eye, "a"], [br, "EYE"], C.green);
      return B.doc;
    },
    blocks: function () {
      var M = L.Blocks.make;
      var check = M("if", { c: { src: "dark" } });
      check.c = [M("write", { pin: "3", hl: "1" })];
      check.e = [M("write", { pin: "3", hl: "0" })];
      return { setup: [], loop: [check], vars: [] };
    }
  });

  ex({
    id: "k_bell", mode: "kid", name: "Robo doorbell", level: "Robo Brain",
    blurb: "Press the button on IN 1 and the Robo Brain beeps the buzzer on OUT 2.",
    build: function () {
      var B = new Builder("kid");
      var br = B.add("k_brain", 6 * P, 16 * P), bz = B.add("k_buzzer", 13 * P, 6 * P), btn = B.add("k_button", 2 * P, 33 * P);
      B.wire([br, "OUT2"], [bz, "+"], C.yellow);
      B.wire([bz, "-"], [br, "GND1"], C.black);
      B.wire([br, "5V"], [btn, "b"], C.red);
      B.wire([btn, "a"], [br, "IN1"], C.blue);
      return B.doc;
    },
    blocks: function () {
      var M = L.Blocks.make;
      var check = M("if", { c: { src: "in1" } });
      check.c = [M("write", { pin: "5", hl: "1" }), M("wait", { ms: "0.3" }), M("write", { pin: "5", hl: "0" })];
      return { setup: [], loop: [check], vars: [] };
    }
  });

  /* Turn an example into a fresh document, code and all. */
  L.loadExample = function (id) {
    var e = EX.filter(function (x) { return x.id === id; })[0];
    if (!e) return null;
    var doc = e.build();
    doc.name = e.name;
    if (e.blocks) { doc.blocks = e.blocks(); doc.prog = "blocks"; doc.code = L.Blocks.generate(doc.blocks, doc.mode).code; }
    else { doc.code = e.code ? e.code.join("\n") + "\n" : ""; doc.prog = "code"; }
    var bb = boundsOf(doc);
    doc.view = { x: -(bb.x + bb.w / 2), y: -(bb.y + bb.h / 2), z: 0 };   /* z 0: fit on open */
    return doc;
  };
  function boundsOf(doc) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    doc.parts.forEach(function (p) { var b = L.boxOf(p); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
    if (x0 > x1) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  L.boundsOf = boundsOf;
})(typeof window !== "undefined" ? window : globalThis);
