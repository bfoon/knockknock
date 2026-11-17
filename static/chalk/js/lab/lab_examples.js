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

  /* ============================================================ WIRELESS */

  ex({
    id: "bt_switch", mode: "pro", name: "Bluetooth light switch", level: "Wireless",
    blurb: "Pair the phone in the side panel, then send 1 or 0. The Arduino switches the LED and answers back over Bluetooth.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0), bb = B.add("breadboard_half", 32 * P, 2 * P);
      var bt = B.add("hc05", 12 * P, 34 * P);
      var s = ledSet(B, bb, 8, "green");
      B.wire([uno, "D13"], [bb, s.input], C.orange);
      B.wire([uno, "GND1"], [bb, "bn2"], C.black);
      B.wire([bt, "VCC"], [uno, "5V"], C.red);
      B.wire([bt, "GND"], [uno, "GND2"], C.black);
      B.wire([bt, "TXD"], [uno, "D10"], C.green);
      B.wire([bt, "RXD"], [uno, "D11"], C.blue);
      return B.doc;
    },
    code: [
      "// Bluetooth light switch. Pair the phone (side panel), then send 1 or 0.",
      "#include <SoftwareSerial.h>",
      "",
      "SoftwareSerial bt(10, 11);   // RX, TX: module TXD -> 10, module RXD <- 11",
      "const int LED = 13;",
      "",
      "void setup() {",
      "  pinMode(LED, OUTPUT);",
      "  Serial.begin(9600);",
      "  bt.begin(9600);",
      "  bt.println(\"Ready! Send 1 or 0.\");",
      "}",
      "",
      "void loop() {",
      "  if (bt.available()) {",
      "    char c = bt.read();",
      "    if (c == '1') {",
      "      digitalWrite(LED, HIGH);",
      "      bt.println(\"LED is on\");",
      "    } else if (c == '0') {",
      "      digitalWrite(LED, LOW);",
      "      bt.println(\"LED is off\");",
      "    }",
      "    Serial.print(\"Phone sent: \");",
      "    Serial.println(c);",
      "  }",
      "}"
    ]
  });

  ex({
    id: "bt_dimmer", mode: "pro", name: "Bluetooth dimmer", level: "Wireless",
    blurb: "Drag the slider on the phone. It sends v and a number; the Arduino reads the number and sets the LED's brightness with PWM.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0), bb = B.add("breadboard_half", 32 * P, 2 * P);
      var bt = B.add("hc05", 12 * P, 34 * P);
      var s = ledSet(B, bb, 8, "white");
      B.wire([uno, "D9"], [bb, s.input], C.orange);
      B.wire([uno, "GND1"], [bb, "bn2"], C.black);
      B.wire([bt, "VCC"], [uno, "5V"], C.red);
      B.wire([bt, "GND"], [uno, "GND2"], C.black);
      B.wire([bt, "TXD"], [uno, "D10"], C.green);
      B.wire([bt, "RXD"], [uno, "D11"], C.blue);
      return B.doc;
    },
    code: [
      "// The phone's slider sends v0 ... v255.",
      "#include <SoftwareSerial.h>",
      "",
      "SoftwareSerial bt(10, 11);",
      "",
      "void setup() {",
      "  pinMode(9, OUTPUT);",
      "  bt.begin(9600);",
      "}",
      "",
      "void loop() {",
      "  if (bt.available()) {",
      "    char c = bt.read();",
      "    if (c == 'v') {",
      "      int level = bt.parseInt();",
      "      analogWrite(9, constrain(level, 0, 255));",
      "      bt.print(\"Brightness \");",
      "      bt.println(level);",
      "    }",
      "  }",
      "}"
    ]
  });

  ex({
    id: "radio_link", mode: "pro", name: "Radio link: two Arduinos", level: "Wireless",
    blurb: "Two boards, two programs. The left one reads a button and a knob and sends them by radio; the right one lights an LED and turns a servo to match. Click a board to see its program.",
    build: function () {
      var B = new Builder("pro");
      var a = B.add("arduino_uno", 0, 0), b = B.add("arduino_uno", 46 * P, 0);
      var ra = B.add("hc12", 32 * P, 6 * P), rb = B.add("hc12", 78 * P, 6 * P);
      var btn = B.add("button", 10 * P, 28 * P, { cap: "#d43a2f" }), pot = B.add("potentiometer", 20 * P, 31 * P, { pos: 0.5 });
      var r = B.add("resistor", 56 * P, 29 * P, { ohms: 220 }), led = B.add("led", 62 * P, 29 * P, { color: "yellow" }), sv = B.add("servo", 70 * P, 34 * P);
      [[a, ra], [b, rb]].forEach(function (pair) {
        B.wire([pair[1], "VCC"], [pair[0], "5V"], C.red);
        B.wire([pair[1], "GND"], [pair[0], "GND2"], C.black);
        B.wire([pair[1], "TXD"], [pair[0], "D10"], C.green);
        B.wire([pair[1], "RXD"], [pair[0], "D11"], C.blue);
      });
      B.wire([btn, "1a"], [a, "D2"], C.yellow);
      B.wire([btn, "2b"], [a, "GND1"], C.black);
      B.wire([pot, "1"], [a, "GND3"], C.black);
      B.wire([pot, "2"], [a, "3V3"], C.red);
      B.wire([pot, "W"], [a, "A0"], C.purple);
      B.wire([b, "D13"], [r, "1"], C.orange);
      B.wire([r, "2"], [led, "A"], C.orange);
      B.wire([led, "K"], [b, "GND1"], C.black);
      B.wire([sv, "GND"], [b, "GND3"], C.black);
      B.wire([sv, "V+"], [b, "VIN"], C.red);
      B.wire([sv, "SIG"], [b, "D9"], C.white);
      B.wire([b, "5V"], [b, "VIN"], C.red);
      return B.doc;
    },
    programs: [
      [
        "// SENDER: reads the button and the knob, sends them by radio.",
        "#include <SoftwareSerial.h>",
        "",
        "SoftwareSerial radio(10, 11);",
        "",
        "void setup() {",
        "  pinMode(2, INPUT_PULLUP);",
        "  radio.begin(9600);",
        "}",
        "",
        "void loop() {",
        "  int pressed = digitalRead(2) == LOW ? 1 : 0;",
        "  int knob = analogRead(A0);",
        "  radio.print(pressed);     // e.g. 1,512",
        "  radio.print(',');",
        "  radio.println(knob);",
        "  delay(150);",
        "}"
      ],
      [
        "// RECEIVER: lights the LED and moves the servo to match the sender.",
        "#include <SoftwareSerial.h>",
        "#include <Servo.h>",
        "",
        "SoftwareSerial radio(10, 11);",
        "Servo arm;",
        "",
        "void setup() {",
        "  pinMode(13, OUTPUT);",
        "  arm.attach(9);",
        "  radio.begin(9600);",
        "  Serial.begin(9600);",
        "}",
        "",
        "void loop() {",
        "  if (radio.available()) {",
        "    String msg = radio.readStringUntil('\\n');   // one whole message, e.g. 1,512",
        "    int comma = msg.indexOf(',');",
        "    if (comma > 0) {",
        "      int pressed = msg.substring(0, comma).toInt();",
        "      int knob = msg.substring(comma + 1).toInt();",
        "      digitalWrite(13, pressed);",
        "      arm.write(map(knob, 0, 675, 0, 180));",
        "      Serial.print(\"got \");",
        "      Serial.println(msg);",
        "    }",
        "  }",
        "}"
      ]
    ]
  });

  ex({
    id: "rf_bell", mode: "pro", name: "Wireless doorbell (no code)", level: "Wireless",
    blurb: "Hold A on the key fob: the receiver's D0 lights the LED. Hold B: D1 switches a transistor that sounds the buzzer.",
    build: function () {
      var B = new Builder("pro");
      var bat = B.add("battery_aa", 8 * P, 4 * P, { cells: 3 }), rx = B.add("rf_rx", 14 * P, 12 * P), fob = B.add("rf_remote", 36 * P, 0);
      var r = B.add("resistor", 18 * P, 18 * P, { ohms: 220 }), led = B.add("led", 24 * P, 18 * P, { color: "blue" });
      var rb = B.add("resistor", 18 * P, 24 * P, { ohms: 1000 }), q = B.add("npn", 26 * P, 28 * P), bz = B.add("buzzer", 30 * P, 20 * P);
      B.wire([bat, "+"], [rx, "VCC"], C.red);
      B.wire([bat, "-"], [rx, "GND"], C.black);
      B.wire([rx, "D0"], [r, "1"], C.yellow);
      B.wire([r, "2"], [led, "A"], C.yellow);
      B.wire([led, "K"], [bat, "-"], C.black);
      B.wire([rx, "D1"], [rb, "1"], C.green);
      B.wire([rb, "2"], [q, "B"], C.green);
      B.wire([bat, "+"], [bz, "+"], C.red);
      B.wire([bz, "-"], [q, "C"], C.white);
      B.wire([q, "E"], [bat, "-"], C.black);
      return B.doc;
    },
    code: null
  });

  ex({
    id: "k_remote", mode: "kid", name: "Magic remote", level: "Wireless",
    blurb: "Press A or B on the remote and a light comes on — no wires between them! The remote sends invisible radio waves.",
    build: function () {
      var B = new Builder("kid");
      var bat = B.add("k_battery", 4 * P, 24 * P, { volts: 4.5 }), rx = B.add("rf_rx", 10 * P, 12 * P), fob = B.add("rf_remote", 34 * P, 4 * P);
      var l1 = B.add("k_led", 24 * P, 16 * P, { color: "red" }), l2 = B.add("k_led", 24 * P, 26 * P, { color: "blue" });
      B.wire([bat, "+"], [rx, "VCC"], C.red);
      B.wire([bat, "-"], [rx, "GND"], C.black);
      B.wire([rx, "D0"], [l1, "+"], C.yellow);
      B.wire([rx, "D1"], [l2, "+"], C.green);
      B.wire([l1, "-"], [bat, "-"], C.black);
      B.wire([l2, "-"], [bat, "-"], C.black);
      return B.doc;
    },
    code: null
  });

  /* ======================================================== RASPBERRY PI
   * A Pi has no sketch: each of these comes with an SD card instead, and
   * the lesson happens in its terminal. `sd` lists the files in the home
   * folder, one card per Pi on the bench. */

  var PI_AT = [38 * P, 2 * P];
  function piBench() {
    var B = new Builder("pro"), pi = B.add("raspberry_pi", 0, 0), bb = B.add("breadboard_half", PI_AT[0], PI_AT[1]);
    B.wire([pi, "GND3"], [bb, "bn2"], C.black);
    return { B: B, pi: pi, bb: bb };
  }

  ex({
    id: "pi_blink", mode: "pro", name: "Raspberry Pi: first light", level: "Raspberry Pi",
    blurb: "Boot a Pi, log in, and light an LED three ways: one command, a shell loop, and a Python program.",
    build: function () {
      var x = piBench(), s = ledSet(x.B, x.bb, 8, "red", 220);
      x.B.wire([x.pi, "GPIO17"], [x.bb, s.input], C.orange);
      return x.B.doc;
    },
    sd: function () {
      return [{
        "README.txt": "FIRST LIGHT\n===========\nAn LED is on GPIO17 (pin 11), through a 220 ohm resistor, to ground.\nSwitch the bench power on, wait for the prompt, then try each of these.\n\n1. One command\n     pinctrl set 17 op dh        op = output, dh = drive high\n     pinctrl set 17 dl           dl = drive low\n   (On Ubuntu or Debian there is no pinctrl. Use:  gpioset gpiochip0 17=1 )\n\n2. A loop, straight from the shell\n     bash blink.sh               Ctrl+C stops it\n     cat blink.sh                ...and this shows you how it works\n\n3. A Python program\n     python3 blink.py            Ctrl+C stops it\n     nano blink.py               change the 0.5s, Ctrl+O to save, Ctrl+X to leave\n\n4. See it from the other side\n     python3 blink.py &          the & runs it in the background\n     gpio readall                watch pin 11 in the table\n     kill %1                     stop the background program\n\nThen try: pinout, neofetch, help\n",
        "blink.py": "from gpiozero import LED\nfrom time import sleep\n\nled = LED(17)          # GPIO17 is pin 11 on the header\n\nwhile True:\n    led.on()\n    sleep(0.5)\n    led.off()\n    sleep(0.5)\n",
        "blink.sh": "#!/bin/bash\n# Blink the LED on GPIO17 without any Python: just files and commands.\n# /sys/class/gpio is the oldest way to reach a pin, and works on every Linux.\n\necho 17 > /sys/class/gpio/export\necho out > /sys/class/gpio/gpio17/direction\n\nfor i in 1 2 3 4 5 6 7 8 9 10; do\n    echo 1 > /sys/class/gpio/gpio17/value\n    sleep 0.3\n    echo 0 > /sys/class/gpio/gpio17/value\n    sleep 0.3\n    echo \"blink $i\"\ndone\n\necho 17 > /sys/class/gpio/unexport\n",
        "fade.py": "# Brightness, not just on and off: PWM switches the pin very fast.\nfrom gpiozero import PWMLED\nfrom signal import pause\n\nled = PWMLED(17)\nled.pulse(fade_in_time=1, fade_out_time=1)   # carries on in the background\nprint(\"Pulsing. Ctrl+C to stop.\")\npause()\n"
      }];
    }
  });

  ex({
    id: "pi_button", mode: "pro", name: "Raspberry Pi: button and reaction game", level: "Raspberry Pi",
    blurb: "A button on GPIO2 and an LED on GPIO17. Read the button from the shell, then play a reaction-time game written in Python.",
    build: function () {
      var x = piBench(), s = ledSet(x.B, x.bb, 8, "green", 220);
      x.B.on(x.bb, "button", "e20", { cap: "#2f64d4" });
      x.B.wire([x.pi, "GPIO17"], [x.bb, s.input], C.orange);
      x.B.wire([x.pi, "GPIO2"], [x.bb, "a20"], C.blue);
      x.B.wire([x.bb, "j22"], [x.bb, "bn22"], C.black);
      return x.B.doc;
    },
    sd: function () {
      return [{
        "README.txt": "BUTTON AND LED\n==============\nLED on GPIO17 (pin 11). Button between GPIO2 (pin 3) and ground.\nGPIO2 has a pull-up resistor inside the Pi, so it reads 1 until you\npress the button, and 0 while you hold it.\n\n  pinctrl get 2               read it once (hold the button and try again)\n  watch -n 0.2 pinctrl get 2  keep reading; press q to stop\n  python3 button.py           the LED follows the button\n  python3 reaction.py         how fast are you?\n  cat scores.txt              the game keeps its scores in a file\n",
        "button.py": "from gpiozero import LED, Button\nfrom signal import pause\n\nled = LED(17)\nbutton = Button(2)             # pull-up on by default: pressed = connected to ground\n\nbutton.when_pressed = led.on   # no brackets: we hand over the function itself\nbutton.when_released = led.off\n\nprint(\"Hold the button to light the LED. Ctrl+C to stop.\")\npause()\n",
        "reaction.py": "# Reaction timer: wait for the light, then press as fast as you can.\nfrom gpiozero import LED, Button\nfrom time import sleep, time\nfrom random import uniform\n\nled = LED(17)\nbutton = Button(2)\n\nname = input(\"Your name: \")\nbest = None\n\nfor turn in range(1, 4):\n    print(f\"Round {turn}: wait for the light...\")\n    sleep(uniform(1.5, 4))\n    if button.is_pressed:\n        print(\"  Too early! Let go of the button.\")\n        button.wait_for_release()\n        continue\n    led.on()\n    start = time()\n    button.wait_for_press()\n    took = time() - start\n    led.off()\n    print(f\"  {took * 1000:.0f} ms\")\n    if best is None or took < best:\n        best = took\n    button.wait_for_release()\n\nif best is None:\n    print(\"No score this time.\")\nelse:\n    print(f\"Best: {best * 1000:.0f} ms. Well played, {name}!\")\n    with open(\"scores.txt\", \"a\") as f:\n        f.write(f\"{name},{best * 1000:.0f}\\n\")\n"
      }];
    }
  });

  ex({
    id: "pi_traffic", mode: "pro", name: "Raspberry Pi: pedestrian crossing", level: "Raspberry Pi",
    blurb: "Three lights, a button and a beeper. Press to cross: the Pi stops the traffic, beeps while it is safe, and logs every crossing.",
    build: function () {
      var x = piBench(), B = x.B, r = ledSet(B, x.bb, 2, "red", 220), a = ledSet(B, x.bb, 8, "yellow", 220), g = ledSet(B, x.bb, 14, "green", 220);
      B.on(x.bb, "button", "e24", { cap: "#d6453d" });
      var pz = B.add("piezo", 72 * P, 12 * P);
      B.wire([x.pi, "GPIO17"], [x.bb, r.input], C.orange);
      B.wire([x.pi, "GPIO27"], [x.bb, a.input], C.yellow);
      B.wire([x.pi, "GPIO22"], [x.bb, g.input], C.green);
      B.wire([x.pi, "GPIO2"], [x.bb, "a24"], C.blue);
      B.wire([x.bb, "j26"], [x.bb, "bn26"], C.black);
      B.wire([x.pi, "GPIO18"], [pz, "+"], C.purple);
      B.wire([pz, "-"], [x.pi, "GND4"], C.black);
      return B.doc;
    },
    sd: function () {
      return [{
        "README.txt": "PEDESTRIAN CROSSING\n===================\nred GPIO17 · amber GPIO27 · green GPIO22 · button GPIO2 · beeper GPIO18\n\n  python3 crossing.py     run the crossing; press the button on the bench\n  ./lights.sh             the same three lights from a shell script\n  cat crossings.log       every crossing, with the time it happened\n  wc -l crossings.log     how many so far?\n\nIdeas: make the green man last longer. Make the beeps speed up near the\nend. Count the crossings and print the total.\n",
        "crossing.py": "from gpiozero import TrafficLights, Button, TonalBuzzer\nfrom datetime import datetime\nfrom time import sleep\n\nlights = TrafficLights(17, 27, 22)      # red, amber, green\nbutton = Button(2)\nbeeper = TonalBuzzer(18)\n\nlights.green.on()\nprint(\"Cars have green. Press the button to cross.\")\n\nwhile True:\n    button.wait_for_press()\n    print(\"Button pressed: stopping the traffic\")\n    sleep(1)\n    lights.green.off()\n    lights.amber.on()\n    sleep(2)\n    lights.amber.off()\n    lights.red.on()\n    print(\"Cross now\")\n    for i in range(8):                  # beep while it is safe to walk\n        beeper.play(880)\n        sleep(0.15)\n        beeper.stop()\n        sleep(0.35)\n    lights.amber.on()                   # red and amber together: get ready\n    sleep(1.5)\n    lights.red.off()\n    lights.amber.off()\n    lights.green.on()\n    with open(\"crossings.log\", \"a\") as log:\n        log.write(datetime.now().strftime(\"%H:%M:%S\") + \" crossing\\n\")\n    print(\"Cars have green again.\")\n",
        "lights.sh": { x: true, text: "#!/bin/bash\n# The lights in sequence, using Raspberry Pi OS's pinctrl.\n# (On Ubuntu or Debian, swap each line for:  gpioset gpiochip0 17=1 )\n\nRED=17\nAMBER=27\nGREEN=22\n\nfor pin in $RED $AMBER $GREEN; do\n    pinctrl set $pin op dl\ndone\n\nfor round in 1 2 3; do\n    pinctrl set $RED dh;   sleep 1\n    pinctrl set $AMBER dh; sleep 0.6\n    pinctrl set $RED dl;   pinctrl set $AMBER dl\n    pinctrl set $GREEN dh; sleep 1\n    pinctrl set $GREEN dl\n    pinctrl set $AMBER dh; sleep 0.6\n    pinctrl set $AMBER dl\n    echo \"round $round done\"\ndone\n" }
      }];
    }
  });

  ex({
    id: "pi_hunt", mode: "pro", name: "Raspberry Pi: the Linux treasure hunt", level: "Raspberry Pi",
    blurb: "No Python at all: find a password hidden in the Pi's files using ls, cd, cat and grep, then use it to switch on the light.",
    build: function () {
      var x = piBench(), s = ledSet(x.B, x.bb, 8, "blue", 100);
      x.B.wire([x.pi, "GPIO17"], [x.bb, s.input], C.orange);
      return x.B.doc;
    },
    sd: function () {
      return [{
        "MISSION.txt": "THE LINUX TREASURE HUNT\n=======================\nSomewhere on this Pi is a password. Find it, and the blue light is yours.\n\nYour tools:\n  ls            what is in this folder?      ls -a shows hidden files too\n  cd NAME       go into a folder             cd .. comes back out\n  cat FILE      read a file\n  grep WORD FILE   show only the lines with WORD in them\n  pwd           where am I?\n\nClue 1 is in the folder called cave. Good luck.\n\nWhen you have the password:   ./unlock.sh THE-PASSWORD\n(If the Pi says \"Permission denied\", clue 3 explains why.)\n",
        "cave/clue1.txt": "CLUE 1\nWell done: you used cd and cat.\nNot everything in a folder shows up with plain ls.\nFiles whose names start with a dot are hidden. Look again, here, with:  ls -a\n",
        "cave/.clue2.txt": "CLUE 2\nYou found a hidden file.\nThe password is one line in a very long, very boring file: ~/library/ledger.txt\nReading all of it would take all lesson. The line you want has the word KEY in it.\n   grep KEY ~/library/ledger.txt\n",
        "library/ledger.txt": "0001 candles      12\n0002 rope          3\n0003 lantern oil   7\n0004 biscuits     40\n0005 chalk        99\n0006 maps          2\n0007 compass       1\n0008 string       15\n0009 KEY raspberry-jam\n0010 boots         2\n0011 blankets      4\n0012 matches      60\n0013 kettle        1\n0014 tea         200\n0015 spare wire   30\n0016 resistors   500\n",
        "library/clue3.txt": "CLUE 3\nA file is only a program if it has permission to run.\n   ls -l ~/unlock.sh       look at the letters on the left: there is no x\n   chmod +x ~/unlock.sh    x means \"may be executed\"\nThen run it with ./ in front, which means \"the one in this folder\".\n",
        "unlock.sh": "#!/bin/bash\n# Usage: ./unlock.sh PASSWORD\n\nif [ \"$1\" = \"\" ]; then\n    echo \"Usage: ./unlock.sh PASSWORD\"\n    exit 1\nfi\n\nif [ \"$1\" != \"raspberry-jam\" ]; then\n    echo \"That is not the password. The light stays dark.\"\n    exit 1\nfi\n\necho \"Correct! Switching on the light...\"\necho 17 > /sys/class/gpio/export\necho out > /sys/class/gpio/gpio17/direction\nfor i in 1 2 3; do\n    echo 1 > /sys/class/gpio/gpio17/value; sleep 0.2\n    echo 0 > /sys/class/gpio/gpio17/value; sleep 0.2\ndone\necho 1 > /sys/class/gpio/gpio17/value\necho \"The treasure is yours. (To switch it off: echo 0 > /sys/class/gpio/gpio17/value)\"\n"
      }];
    }
  });

  ex({
    id: "pi_link", mode: "pro", name: "Raspberry Pi: talk to the internet", level: "Raspberry Pi",
    blurb: "Chalk Link: the Pi publishes its button as “doorbell” and obeys a “lamp” that any program, phone or real board can switch through the board's web API.",
    build: function () {
      var x = piBench(), s = ledSet(x.B, x.bb, 8, "yellow", 220);
      x.B.on(x.bb, "button", "e20", { cap: "#d6453d" });
      x.B.wire([x.pi, "GPIO17"], [x.bb, s.input], C.orange);
      x.B.wire([x.pi, "GPIO2"], [x.bb, "a20"], C.blue);
      x.B.wire([x.bb, "j22"], [x.bb, "bn22"], C.black);
      return x.B.doc;
    },
    sd: function () {
      return [{
        "README.txt": "TALK TO THE INTERNET\n====================\nA Chalk Link is a web address with named values (\"tags\") behind it.\nOpen one with the Link button at the top of the lab, then:\n\n  link status              is this Pi online?\n  python3 doorbell.py      publish the button, obey the lamp\n\nWhile it runs, from ANY computer (the Link panel shows your real address):\n\n  curl '<address>set/?lamp=on'          the LED on the bench lights\n  curl '<address>tags/doorbell/?raw=1'  1 while the button is held\n\nOr without leaving this terminal (stop the program first, or add & to it):\n\n  link send lamp on        write a tag\n  link get doorbell        read one\n  link list                all of them\n\nThe program uses only \"lamp\" and \"doorbell\", never a pin number of the\nother side. Copy doorbell.py to a real Pi with chalklink.py beside it,\ngive Link() the address, and the real one takes the simulated one's place.\n",
        "doorbell.py": "from chalklink import Link\nfrom gpiozero import LED, Button\nfrom signal import pause\n\nlink = Link()            # on a real Pi: Link(\"https://.../chalk/api/link/ck_.../\")\nled = LED(17)\nbutton = Button(2)\n\ndef lamp_changed(on):\n    led.value = on\n    print(\"lamp is\", \"on\" if on else \"off\")\n\n# the world -> this Pi\nlink.when_changed(\"lamp\", lamp_changed)\n\n# this Pi -> the world\nbutton.when_pressed = lambda: link.send(\"doorbell\", True)\nbutton.when_released = lambda: link.send(\"doorbell\", False)\n\nif link.online:\n    print(\"Online. Anyone with the address can set 'lamp' and read 'doorbell'.\")\nelse:\n    print(\"Offline: open a link with the Link button. Until then, try: link send lamp on\")\npause()\n",
        "logger.py": "# Publish a reading every two seconds: the start of every dashboard.\nfrom chalklink import Link\nfrom gpiozero import CPUTemperature\nfrom time import sleep\n\nlink = Link()\ncpu = CPUTemperature()\ncount = 0\n\nwhile True:\n    count += 1\n    link.send(\"pi.temperature\", round(cpu.temperature, 1))\n    link.send(\"pi.readings\", count)\n    print(count, cpu.temperature)\n    sleep(link.get(\"pi.interval\", 2))     # your software can change how often\n"
      }];
    }
  });

  /* ====================================================== WATER & SENSORS
   * The advanced drawer (lab_parts3.js): water, weather, a heartbeat, a
   * car, a stepper and a ring of colour. */

  ex({
    id: "flood_alarm", mode: "pro", name: "Flood alarm", level: "Water & sensors",
    blurb: "A water level sensor on the floor. When water reaches it, the alarm sounds and the L light comes on. The sensor is powered from pin 7 only while it is being read — bare traces in water corrode.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0);
      var wl = B.add("water_level", 38 * P, 16 * P), pz = B.add("piezo", 48 * P, 12 * P);
      B.wire([wl, "+"], [uno, "D7"], C.red);
      B.wire([wl, "-"], [uno, "GND2"], C.black);
      B.wire([wl, "S"], [uno, "A0"], C.yellow);
      B.wire([pz, "+"], [uno, "D8"], C.orange);
      B.wire([pz, "-"], [uno, "GND3"], C.black);
      return B.doc;
    },
    code: [
      "const int SENSOR_POWER = 7;   // the sensor is only powered while we read it",
      "const int ALARM = 8;",
      "const int WET = 300;          // above this, water is touching the sensor",
      "",
      "void setup() {",
      "  Serial.begin(9600);",
      "  pinMode(SENSOR_POWER, OUTPUT);",
      "  pinMode(LED_BUILTIN, OUTPUT);",
      "}",
      "",
      "int readWater() {",
      "  digitalWrite(SENSOR_POWER, HIGH);",
      "  delay(10);                   // let it settle",
      "  int level = analogRead(A0);",
      "  digitalWrite(SENSOR_POWER, LOW);",
      "  return level;",
      "}",
      "",
      "void loop() {",
      "  int level = readWater();",
      "  Serial.print(\"Water: \");",
      "  Serial.println(level);",
      "  if (level > WET) {",
      "    digitalWrite(LED_BUILTIN, HIGH);",
      "    tone(ALARM, 1800, 250);     // beep... beep... beep",
      "  } else {",
      "    digitalWrite(LED_BUILTIN, LOW);",
      "  }",
      "  delay(500);",
      "}"
    ]
  });

  ex({
    id: "plant_waterer", mode: "pro", name: "Self-watering plant", level: "Water & sensors",
    blurb: "A soil sensor decides, a MOSFET switches the pump, and a float switch in the tank stops it running dry. Drag the soil sensor's Wetness slider and watch it water, then stop.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0);
      var soil = B.add("mod_soil", 36 * P, 14 * P, { level: 20, threshold: 60 });
      var bat = B.add("battery_aa", 56 * P, 2 * P, { cells: 4 });
      var pump = B.add("water_pump", 66 * P, 24 * P), q = B.add("nmos", 50 * P, 32 * P), rg = B.add("resistor", 41 * P, 30 * P, { ohms: 220 });
      var d = B.add("diode", 58 * P, 16 * P), fl = B.add("float_switch", 30 * P, 32 * P, { water: true });
      B.wire([soil, "VCC"], [uno, "5V"], C.red);
      B.wire([soil, "GND"], [uno, "GND2"], C.black);
      B.wire([soil, "AO"], [uno, "A0"], C.yellow);
      B.wire([bat, "+"], [pump, "+"], C.red);
      B.wire([pump, "-"], [q, "D"], C.blue);
      B.wire([q, "S"], [bat, "-"], C.black);
      B.wire([d, "K"], [pump, "+"], C.red);
      B.wire([d, "A"], [pump, "-"], C.blue);
      B.wire([uno, "D9"], [rg, "1"], C.orange);
      B.wire([rg, "2"], [q, "G"], C.orange);
      B.wire([uno, "GND1"], [q, "S"], C.black);
      B.wire([fl, "1"], [uno, "D4"], C.green);
      B.wire([fl, "2"], [uno, "GND3"], C.black);
      return B.doc;
    },
    code: [
      "const int PUMP = 9;      // through a MOSFET: the pump wants 200 mA",
      "const int TANK = 4;      // float switch: closes when the tank has water",
      "const int DRY = 700;     // the soil sensor reads HIGHER when the soil is drier",
      "",
      "void setup() {",
      "  Serial.begin(9600);",
      "  pinMode(PUMP, OUTPUT);",
      "  pinMode(TANK, INPUT_PULLUP);",
      "}",
      "",
      "void loop() {",
      "  int soil = analogRead(A0);",
      "  bool tankHasWater = digitalRead(TANK) == LOW;",
      "  Serial.print(\"Soil: \");",
      "  Serial.println(soil);",
      "  if (!tankHasWater) {",
      "    digitalWrite(PUMP, LOW);",
      "    Serial.println(\"Fill the tank!\");",
      "  } else if (soil > DRY) {",
      "    Serial.println(\"Dry - watering\");",
      "    digitalWrite(PUMP, HIGH);",
      "    delay(2000);            // a short drink, then check again",
      "    digitalWrite(PUMP, LOW);",
      "  }",
      "  delay(1000);",
      "}"
    ]
  });

  ex({
    id: "weather_station", mode: "pro", name: "Weather station", level: "Water & sensors",
    blurb: "Temperature and humidity from a DHT11, rain from the rain plate, all on the LCD. Change the readings in Inspect.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0);
      var dht = B.add("dht", 38 * P, 10 * P), rain = B.add("mod_rain", 46 * P, 16 * P, { level: 0, threshold: 40 }), lcd = B.add("lcd_i2c", 33 * P, 26 * P);
      B.wire([dht, "VCC"], [uno, "5V"], C.red);
      B.wire([dht, "GND"], [uno, "GND2"], C.black);
      B.wire([dht, "DATA"], [uno, "D2"], C.green);
      B.wire([rain, "VCC"], [uno, "5V"], C.red);
      B.wire([rain, "GND"], [uno, "GND2"], C.black);
      B.wire([rain, "DO"], [uno, "D3"], C.blue);
      B.wire([lcd, "GND"], [uno, "GND1"], C.black);
      B.wire([lcd, "VCC"], [uno, "5V"], C.red);
      B.wire([lcd, "SDA"], [uno, "A4"], C.blue);
      B.wire([lcd, "SCL"], [uno, "A5"], C.purple);
      return B.doc;
    },
    code: [
      "#include <DHT.h>",
      "#include <LiquidCrystal_I2C.h>",
      "",
      "DHT dht(2, DHT11);",
      "LiquidCrystal_I2C lcd(0x27, 16, 2);",
      "const int RAIN = 3;    // the rain module's DO goes LOW when it is wet",
      "",
      "void setup() {",
      "  dht.begin();",
      "  lcd.init();",
      "  lcd.backlight();",
      "  pinMode(RAIN, INPUT);",
      "}",
      "",
      "void loop() {",
      "  float t = dht.readTemperature();",
      "  float h = dht.readHumidity();",
      "  lcd.setCursor(0, 0);",
      "  if (isnan(t)) {",
      "    lcd.print(\"No sensor?      \");",
      "  } else {",
      "    lcd.print(t, 0);",
      "    lcd.print(\" C   \");",
      "    lcd.print(h, 0);",
      "    lcd.print(\" %     \");",
      "  }",
      "  lcd.setCursor(0, 1);",
      "  if (digitalRead(RAIN) == LOW) lcd.print(\"Raining!        \");",
      "  else lcd.print(\"Dry outside     \");",
      "  delay(2000);           // a DHT11 can only be read every second or two",
      "}"
    ]
  });

  ex({
    id: "heart_monitor", mode: "pro", name: "Heartbeat monitor", level: "Water & sensors",
    blurb: "Each heartbeat pushes the sensor's reading up. The sketch times the gap between peaks and turns it into beats per minute — the L light flashes with every beat.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0);
      var hs = B.add("pulse_sensor", 39 * P, 12 * P), lcd = B.add("lcd_i2c", 33 * P, 26 * P);
      B.wire([hs, "+"], [uno, "5V"], C.red);
      B.wire([hs, "-"], [uno, "GND2"], C.black);
      B.wire([hs, "S"], [uno, "A0"], C.purple);
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
      "const int THRESHOLD = 600;   // a beat pushes the reading above this",
      "unsigned long lastBeat = 0;",
      "bool inBeat = false;",
      "",
      "void setup() {",
      "  pinMode(LED_BUILTIN, OUTPUT);",
      "  lcd.init();",
      "  lcd.backlight();",
      "  lcd.print(\"Finger on it...\");",
      "}",
      "",
      "void loop() {",
      "  int v = analogRead(A0);",
      "  if (v > THRESHOLD && !inBeat) {          // the start of a beat",
      "    inBeat = true;",
      "    digitalWrite(LED_BUILTIN, HIGH);",
      "    unsigned long now = millis();",
      "    if (lastBeat > 0) {",
      "      int bpm = 60000 / (now - lastBeat);  // milliseconds between beats -> beats a minute",
      "      lcd.setCursor(0, 1);",
      "      lcd.print(bpm);",
      "      lcd.print(\" bpm      \");",
      "    }",
      "    lastBeat = now;",
      "  }",
      "  if (v < THRESHOLD - 60 && inBeat) {     // well below again: the beat is over",
      "    inBeat = false;",
      "    digitalWrite(LED_BUILTIN, LOW);",
      "  }",
      "  delay(5);",
      "}"
    ]
  });

  ex({
    id: "flow_meter", mode: "pro", name: "Water meter (interrupts)", level: "Water & sensors",
    blurb: "The flow meter pulses 7.5 times a second for every litre a minute. An interrupt counts every pulse — even while loop() is busy — and the LCD shows the flow and the total.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0);
      var fm = B.add("flow_sensor", 42 * P, 14 * P, { flow: 6 }), lcd = B.add("lcd_i2c", 33 * P, 26 * P);
      B.wire([fm, "VCC"], [uno, "5V"], C.red);
      B.wire([fm, "GND"], [uno, "GND2"], C.black);
      B.wire([fm, "SIG"], [uno, "D2"], C.yellow);
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
      "volatile unsigned long pulses = 0;   // volatile: changed by the interrupt",
      "float litres = 0;",
      "",
      "void countPulse() {                  // runs on every pulse, by itself",
      "  pulses++;",
      "}",
      "",
      "void setup() {",
      "  lcd.init();",
      "  lcd.backlight();",
      "  pinMode(2, INPUT);",
      "  attachInterrupt(digitalPinToInterrupt(2), countPulse, FALLING);",
      "}",
      "",
      "void loop() {",
      "  delay(1000);",
      "  noInterrupts();                    // take the count without it changing under us",
      "  unsigned long n = pulses;",
      "  pulses = 0;",
      "  interrupts();",
      "  float perMinute = n / 7.5;",
      "  litres += perMinute / 60.0;",
      "  lcd.setCursor(0, 0);",
      "  lcd.print(perMinute, 1);",
      "  lcd.print(\" L/min     \");",
      "  lcd.setCursor(0, 1);",
      "  lcd.print(litres, 2);",
      "  lcd.print(\" L total   \");",
      "}"
    ]
  });

  ex({
    id: "robot_car", mode: "pro", name: "Joystick robot car (L298N)", level: "Advanced",
    blurb: "Two motors on an L298N driver, steered by a joystick. Push up to drive, sideways to spin. analogWrite() on ENA and ENB sets each wheel's speed — the ENA/ENB jumpers are off for that.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0);
      var drv = B.add("l298n", 46 * P, 34 * P, { jumperA: false, jumperB: false });
      var ml = B.add("motor", 34 * P, 18 * P), mr = B.add("motor", 60 * P, 18 * P), bat = B.add("battery_aa", 40 * P, 40 * P, { cells: 6 });
      var js = B.add("joystick", 10 * P, 30 * P, { x: 0, y: 70 });
      B.wire([bat, "+"], [drv, "12V"], C.red);
      B.wire([bat, "-"], [drv, "GND"], C.black);
      B.wire([drv, "GND"], [uno, "GND1"], C.black);
      B.wire([drv, "OUT1"], [ml, "1"], C.yellow);
      B.wire([drv, "OUT2"], [ml, "2"], C.green);
      B.wire([drv, "OUT4"], [mr, "2"], C.green);
      B.wire([drv, "OUT3"], [mr, "1"], C.yellow);
      [["ENA", "D5"], ["IN1", "D7"], ["IN2", "D8"], ["IN3", "D9"], ["IN4", "D10"], ["ENB", "D6"]].forEach(function (w, i) { B.wire([drv, w[0]], [uno, w[1]], [C.orange, C.blue, C.purple, C.blue, C.purple, C.orange][i]); });
      B.wire([js, "GND"], [uno, "GND2"], C.black);
      B.wire([js, "+5V"], [uno, "5V"], C.red);
      B.wire([js, "VRx"], [uno, "A0"], C.yellow);
      B.wire([js, "VRy"], [uno, "A1"], C.green);
      return B.doc;
    },
    code: [
      "const int ENA = 5, IN1 = 7, IN2 = 8;    // left motor",
      "const int ENB = 6, IN3 = 9, IN4 = 10;   // right motor",
      "",
      "// one motor: + forwards, - backwards, 0 stop",
      "void drive(int en, int a, int b, int speed) {",
      "  digitalWrite(a, speed > 0 ? HIGH : LOW);",
      "  digitalWrite(b, speed < 0 ? HIGH : LOW);",
      "  analogWrite(en, min(abs(speed), 255));",
      "}",
      "",
      "void setup() {",
      "  for (int p = 5; p <= 10; p++) pinMode(p, OUTPUT);",
      "}",
      "",
      "void loop() {",
      "  int y = analogRead(A1) - 512;   // up/down: drive",
      "  int x = analogRead(A0) - 512;   // left/right: steer",
      "  if (abs(y) < 40) y = 0;          // a little dead zone in the middle",
      "  if (abs(x) < 40) x = 0;",
      "  drive(ENA, IN1, IN2, (y + x) / 2);",
      "  drive(ENB, IN3, IN4, (y - x) / 2);",
      "  delay(20);",
      "}"
    ]
  });

  ex({
    id: "stepper_dial", mode: "pro", name: "Stepper follows a knob", level: "Advanced",
    blurb: "Turn the knob and the stepper turns to match — all the way round, not just 180° like a servo. 2048 steps is one turn.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0), bb = B.add("breadboard_half", 32 * P, 2 * P);
      B.on(bb, "potentiometer", "e6", { pos: 0.5 });
      var sm = B.add("stepper", 46 * P, 36 * P);
      B.wire([uno, "5V"], [bb, "bp1"], C.red);
      B.wire([uno, "GND2"], [bb, "bn1"], C.black);
      B.wire([bb, "a6"], [bb, "tn5"], C.black);
      B.wire([bb, "a8"], [bb, "tp8"], C.red);
      B.wire([bb, "tp29"], [bb, "bp29"], C.red);
      B.wire([bb, "tn29"], [bb, "bn29"], C.black);
      B.wire([uno, "A0"], [bb, "a7"], C.yellow);
      ["IN1", "IN2", "IN3", "IN4"].forEach(function (n, i) { B.wire([sm, n], [uno, "D" + (8 + i)], [C.blue, C.purple, C.yellow, C.orange][i]); });
      B.wire([sm, "+"], [uno, "5V"], C.red);
      B.wire([sm, "-"], [uno, "GND1"], C.black);
      return B.doc;
    },
    code: [
      "#include <Stepper.h>",
      "",
      "Stepper motor(2048, 8, 10, 9, 11);   // 2048 steps a turn; note the 8, 10, 9, 11 order",
      "int pos = 0;                         // where the shaft is now, in steps",
      "",
      "void setup() {",
      "  motor.setSpeed(12);                // RPM: a 28BYJ-48 tops out near 15",
      "}",
      "",
      "void loop() {",
      "  int target = map(analogRead(A0), 0, 1023, 0, 2048);",
      "  int diff = target - pos;",
      "  if (abs(diff) > 4) {",
      "    int move = constrain(diff, -32, 32);   // small moves, so it keeps checking the knob",
      "    motor.step(move);",
      "    pos += move;",
      "  }",
      "}"
    ]
  });

  ex({
    id: "rainbow_ring", mode: "pro", name: "Rainbow ring (NeoPixels)", level: "Advanced",
    blurb: "Twelve colour LEDs on one data pin. ColorHSV() walks round the colour wheel; the knob sets how fast the rainbow spins.",
    build: function () {
      var B = new Builder("pro"), uno = B.add("arduino_uno", 0, 0), bb = B.add("breadboard_half", 32 * P, 2 * P);
      B.on(bb, "potentiometer", "e6", { pos: 0.3 });
      var ring = B.add("neopixel", 48 * P, 34 * P, { count: 12 });
      B.wire([uno, "5V"], [bb, "bp1"], C.red);
      B.wire([uno, "GND2"], [bb, "bn1"], C.black);
      B.wire([bb, "a6"], [bb, "tn5"], C.black);
      B.wire([bb, "a8"], [bb, "tp8"], C.red);
      B.wire([bb, "tp29"], [bb, "bp29"], C.red);
      B.wire([bb, "tn29"], [bb, "bn29"], C.black);
      B.wire([uno, "A0"], [bb, "a7"], C.yellow);
      B.wire([ring, "DIN"], [uno, "D6"], C.green);
      B.wire([ring, "5V"], [uno, "5V"], C.red);
      B.wire([ring, "GND"], [uno, "GND1"], C.black);
      return B.doc;
    },
    code: [
      "#include <Adafruit_NeoPixel.h>",
      "",
      "Adafruit_NeoPixel ring(12, 6, NEO_GRB + NEO_KHZ800);",
      "long hue = 0;     // 0-65535 is once round the colour wheel",
      "",
      "void setup() {",
      "  ring.begin();",
      "  ring.setBrightness(60);   // full white on all 12 would be 720 mA",
      "}",
      "",
      "void loop() {",
      "  int speed = map(analogRead(A0), 0, 1023, 64, 2048);",
      "  for (int i = 0; i < 12; i++) {",
      "    long h = hue + i * 65536L / 12;          // spread the wheel round the ring",
      "    ring.setPixelColor(i, ring.gamma32(ring.ColorHSV(h)));",
      "  }",
      "  ring.show();",
      "  hue += speed;",
      "  delay(20);",
      "}"
    ]
  });

  ex({
    id: "pi_flood", mode: "pro", name: "Raspberry Pi: water alarm (MCP3008)", level: "Raspberry Pi",
    blurb: "A Pi has no analog pins, so an MCP3008 chip reads the water level sensor for it over SPI. Python sounds the alarm when the water rises.",
    build: function () {
      var x = piBench(), s = ledSet(x.B, x.bb, 8, "red", 220);
      var adc = x.B.add("mcp3008", 44 * P, 30 * P), wl = x.B.add("water_level", 76 * P, 24 * P, { depth: 0 });
      x.B.wire([x.pi, "GPIO17"], [x.bb, s.input], C.orange);
      x.B.wire([adc, "16"], [x.pi, "3V3"], C.red);
      x.B.wire([adc, "15"], [x.pi, "3V3"], C.red);
      x.B.wire([adc, "14"], [x.pi, "GND1"], C.black);
      x.B.wire([adc, "9"], [x.pi, "GND1"], C.black);
      x.B.wire([adc, "13"], [x.pi, "GPIO11"], C.yellow);
      x.B.wire([adc, "12"], [x.pi, "GPIO9"], C.green);
      x.B.wire([adc, "11"], [x.pi, "GPIO10"], C.blue);
      x.B.wire([adc, "10"], [x.pi, "GPIO8"], C.purple);
      x.B.wire([wl, "+"], [x.pi, "3V3"], C.red);
      x.B.wire([wl, "-"], [x.pi, "GND1"], C.black);
      x.B.wire([wl, "S"], [adc, "1"], C.yellow);
      return x.B.doc;
    },
    sd: function () {
      return [{
        "README.txt": "WATER ALARM\n===========\nThe water level sensor's S goes to CH0 (pin 1) of an MCP3008 chip, which\ntalks to the Pi over SPI: CLK GPIO11, DOUT GPIO9, DIN GPIO10, CS GPIO8.\nAn LED on GPIO17 is the alarm.\n\n  python3 water.py     then drag the sensor's Water depth slider up\n",
        "water.py": "from gpiozero import MCP3008, LED\nfrom time import sleep\n\nwater = MCP3008(channel=0)   # the sensor's S pin is on CH0\nalarm = LED(17)\n\nwhile True:\n    level = water.value          # 0.0 dry ... about 0.68 when it is all under water\n    print(f\"water level {level:.2f}\")\n    if level > 0.3:\n        alarm.blink(0.1, 0.1)\n    else:\n        alarm.off()\n    sleep(1)\n"
      }];
    }
  });

  ex({
    id: "pi_temp_ring", mode: "pro", name: "Raspberry Pi: temperature ring", level: "Raspberry Pi",
    blurb: "A DHT11 reads the room and a NeoPixel ring shows it: more LEDs when it is warmer, blue when cold, green when comfortable, red when hot. Uses the Adafruit libraries most Pi tutorials use.",
    build: function () {
      var x = piBench();
      var dht = x.B.add("dht", 44 * P, 30 * P, { temp: 22 }), ring = x.B.add("neopixel", 58 * P, 34 * P, { count: 12 });
      x.B.wire([dht, "VCC"], [x.pi, "3V3"], C.red);
      x.B.wire([dht, "GND"], [x.pi, "GND1"], C.black);
      x.B.wire([dht, "DATA"], [x.pi, "GPIO4"], C.green);
      x.B.wire([ring, "5V"], [x.pi, "5V"], C.red);
      x.B.wire([ring, "GND"], [x.pi, "GND1"], C.black);
      x.B.wire([ring, "DIN"], [x.pi, "GPIO18"], C.yellow);
      return x.B.doc;
    },
    sd: function () {
      return [{
        "README.txt": "TEMPERATURE RING\n================\nDHT11 data on GPIO4, NeoPixel ring data on GPIO18.\n\n  python3 ring.py      then change the DHT's temperature in Inspect\n",
        "ring.py": "import board\nimport neopixel\nimport adafruit_dht\nfrom time import sleep\n\nsensor = adafruit_dht.DHT11(board.D4)\nring = neopixel.NeoPixel(board.D18, 12, brightness=0.3)\n\nwhile True:\n    t = sensor.temperature\n    if t < 18:\n        colour = (0, 80, 255)      # cold: blue\n    elif t < 26:\n        colour = (0, 255, 60)      # comfortable: green\n    else:\n        colour = (255, 40, 0)      # hot: red\n    lit = max(1, min(12, round((t - 10) / 2)))   # 10 C lights one LED, 34 C lights all 12\n    for i in range(12):\n        ring[i] = colour if i < lit else (0, 0, 0)\n    print(t, \"C\", lit, \"LEDs\")\n    sleep(2)\n"
      }];
    }
  });

  /* Turn an example into a fresh document, code and all. */
  L.loadExample = function (id) {
    var e = EX.filter(function (x) { return x.id === id; })[0];
    if (!e) return null;
    var doc = e.build();
    doc.name = e.name;
    if (e.blocks) { doc.blocks = e.blocks(); doc.prog = "blocks"; doc.code = L.Blocks.generate(doc.blocks, doc.mode).code; }
    else if (e.programs) {
      /* one program per board, in the order the boards were added */
      var boards = L.mcus ? L.mcus(doc) : doc.parts.filter(function (p) { return L.def(p).mcu; });
      doc.programs = {};
      e.programs.forEach(function (lines, i) { if (boards[i]) doc.programs[boards[i].id] = { code: lines.join("\n") + "\n", prog: "code", blocks: null }; });
      doc.code = boards[0] ? doc.programs[boards[0].id].code : ""; doc.prog = "code";
    }
    else { doc.code = e.code ? e.code.join("\n") + "\n" : ""; doc.prog = "code"; }
    if (e.sd && L.PiOS) {
      /* one SD card per Raspberry Pi, in the order the Pis were added */
      var cards = e.sd();
      doc.parts.filter(function (p) { return p.type === "raspberry_pi"; }).forEach(function (p, i) { if (cards[i]) { doc.programs = doc.programs || {}; doc.programs[p.id] = { code: L.PiOS.makeSD(cards[i]), prog: "code", blocks: null }; } });
    }
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
