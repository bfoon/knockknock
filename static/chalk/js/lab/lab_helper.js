/* Chalk Circuit Lab — the built-in helper.
 *
 * What the lab can say without any AI at all. It reads the real netlist —
 * which legs share a node — and the simulator's own warnings, so its
 * answers are about this circuit, not circuits in general. When the server
 * has an AI key, the AI gets the same netlist and does better; when it does
 * not, or it is down, the class still gets a useful answer.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;

  /* Which parts sit on each node, by pin. Breadboard holes are left out:
   * they are how things connect, not what is connected. */
  L.nets = function (doc, sim) {
    if (!sim.topo || sim.topoDirty) sim.build();
    var T = sim.topo, groups = {};
    Object.keys(T.pins).forEach(function (k) {
      var p = T.pins[k];
      if (p.hole) return;
      var r = T.find(k);
      (groups[r] = groups[r] || []).push(k);
    });
    return Object.keys(groups).map(function (r) { return groups[r]; });
  };

  function partName(doc, id) {
    var p = doc.parts.filter(function (x) { return x.id === id; })[0];
    if (!p) return id;
    var d = L.def(p), pr = L.propsOf(p);
    if (p.type === "resistor" || p.type === "k_resistor") return L.si(pr.ohms, "Ω").replace(" ", " ") + " resistor";
    if (p.type === "led" || p.type === "k_led") return (L.LED_COLORS[pr.color] || {}).name.toLowerCase() + " LED";
    return d.name.replace(/ \(.+\)$/, "");
  }

  /* For one MCU pin: what is on the other end? */
  function whatOn(doc, sim, key) {
    return sim.neighbours(key).map(function (k) {
      var id = k.split(":")[0], pin = k.split(":").slice(1).join(":");
      var p = doc.parts.filter(function (x) { return x.id === id; })[0];
      return { id: id, pin: pin, type: p ? p.type : "", name: partName(doc, id) };
    }).filter(function (x) { return x.type && !/^arduino|k_brain/.test(x.type); });
  }

  var OUTPUT_ON = { led: "A", rgb_led: "*", bulb: "*", buzzer: "+", piezo: "+", relay_module: "IN", nmos: "G", npn: "B", resistor: "*", k_led: "+", k_bulb: "*", k_buzzer: "+", k_motor: "*", motor: "*", seg7: "*" };
  var INPUT_ON = { button: "*", slide_switch: "C", tilt_switch: "*", pir: "OUT", k_button: "*", mod_soil: "DO", mod_gas: "DO", mod_sound: "DO", mod_flame: "DO", mod_ir: "DO" };
  var ANALOG_ON = { potentiometer: "W", ldr: "*", thermistor: "*", tmp36: "OUT", mod_soil: "AO", mod_gas: "AO", mod_sound: "AO", mod_flame: "AO", mod_ir: "AO", k_ldr: "*" };

  /* Look at what each pin drives and write a sketch that exercises it. */
  L.starterCode = function (doc, sim) {
    var mcu = L.firstMcu(doc);
    if (!mcu) return null;
    var kid = mcu.type === "k_brain";
    var names = kid ? Object.keys(L.BRAIN_MAP) : Object.keys(L.PINNUM);
    var outs = [], ins = [], analogs = [], servos = [], echo = null, trig = null, lcd = false;
    names.forEach(function (nm) {
      var key = mcu.id + ":" + nm, num = L.PINNUM[kid ? L.BRAIN_MAP[nm] : nm];
      if (!sim.topo || !sim.topo.pins[key]) return;
      var on = whatOn(doc, sim, key);
      if (!on.length) return;
      var label = on[0].name, any = function (map) { return on.some(function (o) { return map[o.type] && (map[o.type] === "*" || map[o.type] === o.pin); }); };
      if (on.some(function (o) { return o.type === "servo" && o.pin === "SIG"; })) servos.push({ num: num, label: "servo" });
      else if (on.some(function (o) { return o.type === "hcsr04" && o.pin === "ECHO"; })) echo = num;
      else if (on.some(function (o) { return o.type === "hcsr04" && o.pin === "TRIG"; })) trig = num;
      else if (on.some(function (o) { return o.type === "lcd_i2c"; })) lcd = true;
      else if (num >= 14 && any(ANALOG_ON)) analogs.push({ num: num, label: label, name: nm });
      else if (any(INPUT_ON)) ins.push({ num: num, label: label });
      else if (any(OUTPUT_ON)) outs.push({ num: num, label: label, pwm: !!L.PWM_PINS["D" + num] });
    });
    var c = [];
    var pinName = function (n) { return n >= 14 ? "A" + (n - 14) : String(n); };
    c.push("// A starting point, written by looking at what is wired to each pin.");
    c.push("// Change it, break it, make it yours.");
    if (servos.length) c.push("#include <Servo.h>");
    if (lcd) c.push("#include <LiquidCrystal_I2C.h>");
    c.push("");
    servos.forEach(function (s, i) { c.push("Servo servo" + i + ";"); });
    if (lcd) c.push("LiquidCrystal_I2C lcd(0x27, 16, 2);");
    outs.forEach(function (o, i) { c.push("const int OUT" + i + " = " + o.num + ";   // " + o.label); });
    ins.forEach(function (o, i) { c.push("const int IN" + i + " = " + o.num + ";    // " + o.label); });
    analogs.forEach(function (o, i) { c.push("const int SENSOR" + i + " = " + pinName(o.num) + ";  // " + o.label); });
    c.push("");
    c.push("void setup() {");
    c.push("  Serial.begin(9600);");
    outs.forEach(function (o, i) { c.push("  pinMode(OUT" + i + ", OUTPUT);"); });
    ins.forEach(function (o, i) { c.push("  pinMode(IN" + i + ", " + (kid ? "INPUT" : "INPUT_PULLUP") + ");"); });
    servos.forEach(function (s, i) { c.push("  servo" + i + ".attach(" + s.num + ");"); });
    if (trig != null) c.push("  pinMode(" + trig + ", OUTPUT);");
    if (lcd) { c.push("  lcd.init();"); c.push("  lcd.backlight();"); }
    c.push("}");
    c.push("");
    c.push("void loop() {");
    analogs.forEach(function (o, i) {
      c.push("  int reading" + i + " = analogRead(SENSOR" + i + ");");
      c.push("  Serial.println(reading" + i + ");");
    });
    if (trig != null && echo != null) {
      c.push("  digitalWrite(" + trig + ", HIGH);"); c.push("  delayMicroseconds(10);"); c.push("  digitalWrite(" + trig + ", LOW);");
      c.push("  int cm = pulseIn(" + echo + ", HIGH) / 58;"); c.push("  Serial.println(cm);");
      if (lcd) { c.push("  lcd.setCursor(0, 0);"); c.push("  lcd.print(cm);"); c.push("  lcd.print(\" cm   \");"); }
    } else if (lcd) { c.push("  lcd.setCursor(0, 0);"); c.push("  lcd.print(millis() / 1000);"); }
    servos.forEach(function (s, i) {
      c.push(analogs.length ? "  servo" + i + ".write(map(reading0, 0, 1023, 0, 180));" : "  servo" + i + ".write((millis() / 20) % 180);");
    });
    if (ins.length && outs.length) {
      c.push("  if (digitalRead(IN0) == " + (kid ? "HIGH" : "LOW") + ") {   // pressed");
      outs.forEach(function (o, i) { c.push("    digitalWrite(OUT" + i + ", HIGH);"); });
      c.push("  } else {");
      outs.forEach(function (o, i) { c.push("    digitalWrite(OUT" + i + ", LOW);"); });
      c.push("  }");
    } else if (analogs.length && outs.length) {
      var o0 = outs[0];
      if (o0.pwm) c.push("  analogWrite(OUT0, map(reading0, 0, 1023, 0, 255));   // brighter with more signal");
      else { c.push("  digitalWrite(OUT0, reading0 > 512 ? HIGH : LOW);"); }
    } else if (outs.length) {
      outs.forEach(function (o, i) {
        c.push("  digitalWrite(OUT" + i + ", HIGH);");
        c.push("  delay(400);");
        c.push("  digitalWrite(OUT" + i + ", LOW);");
      });
    } else if (ins.length) {
      c.push("  Serial.println(digitalRead(IN0));");
    }
    c.push("  delay(" + (outs.length && !ins.length && !analogs.length ? 200 : 100) + ");");
    c.push("}");
    return { code: c.join("\n") + "\n", outs: outs, ins: ins, analogs: analogs, servos: servos };
  };

  /* A plain-words tour of the circuit. */
  L.describe = function (doc, sim) {
    var lines = [], kid = doc.mode === "kid";
    var count = {};
    doc.parts.forEach(function (p) { var n = partName(doc, p.id); count[n] = (count[n] || 0) + 1; });
    var inv = Object.keys(count).map(function (n) { return (count[n] > 1 ? count[n] + " × " : "") + n; });
    if (!inv.length) return kid ? "The table is empty! Drag a battery and a bulb from the toy box to start." : "The bench is empty. Drag in an Arduino or a battery to get started, or open an example.";
    lines.push((kid ? "On your table: " : "On the bench: ") + inv.join(", ") + ".");
    var sources = doc.parts.filter(function (p) { return /battery|coin_cell|psu|arduino|k_brain/.test(p.type); });
    if (!sources.length) lines.push(kid ? "There's no battery yet — nothing can push electricity round." : "There is no power source yet: add a battery, the bench supply, or an Arduino (which gives 5 V).");
    var mcu = L.firstMcu(doc);
    if (mcu) {
      var kidMcu = mcu.type === "k_brain", names = kidMcu ? Object.keys(L.BRAIN_MAP) : Object.keys(L.PINNUM).concat(["5V", "3V3"]), any = false;
      names.forEach(function (nm) {
        var key = mcu.id + ":" + nm;
        if (!sim.topo || !sim.topo.pins[key]) return;
        var on = whatOn(doc, sim, key);
        if (!on.length) return;
        if (!any) { lines.push(kidMcu ? "What the Robo Brain is connected to:" : "What each Arduino pin is wired to:"); any = true; }
        lines.push("- **" + (kidMcu ? nm.replace(/(\d)$/, " $1") : nm) + "** → " + on.map(function (o) { return o.name + " (" + o.pin + ")"; }).join(", "));
      });
      if (!any) lines.push(kidMcu ? "Nothing is plugged into the Robo Brain's posts yet." : "Nothing is wired to the Arduino's pins yet.");
    }
    var loose = doc.parts.filter(function (p) {
      var d = L.def(p);
      if (d.layer === "board" && !d.mcu) return false;
      return L.pinsOf(p).every(function (q) { return sim.topo && (sim.topo.terminals[sim.topo.find(q.key)] || 0) < 2; });
    });
    if (loose.length) lines.push((kid ? "Not joined to anything yet: " : "Not connected to anything yet: ") + loose.map(function (p) { return partName(doc, p.id); }).join(", ") + ".");
    return lines.join("\n");
  };

  var EXAMPLE_WORDS = [
    [/traffic/i, "traffic"], [/blink|flash/i, "blink"], [/button|press|push/i, "button"], [/fade|dim|pwm|bright/i, "fade"],
    [/night|dark|ldr|light sensor/i, "nightlight"], [/servo|knob|dial|angle/i, "servo"], [/temp|thermo|hot|cold/i, "thermo"],
    [/distance|ultrasonic|sonar|hc-?sr04/i, "distance"], [/motor|fan|mosfet/i, "motor"], [/relay|lamp|mains/i, "relay"],
    [/555|timer|astable/i, "timer555"], [/gate|and|logic|or\b|xor/i, "gates"]
  ];
  var KB = [
    [/ohm|resist/i, "**Resistors** limit current. Ohm's law says current = voltage ÷ resistance, so 5 V across 220 Ω lets about 23 mA through. The stripes spell the value: two digits, then how many zeros."],
    [/led/i, "**LEDs** only conduct one way (long leg, the anode, towards +) and drop about 2 V (red) to 3 V (blue/white). They have almost no resistance of their own, so they always need a resistor in series: (supply − LED voltage) ÷ 0.02 A gives a good value."],
    [/pull.?up|pull.?down|float/i, "An input pin with nothing connected **floats** and reads random values. A **pull-up** resistor (or INPUT_PULLUP) holds it HIGH until a button joins it to ground, which then reads LOW."],
    [/pwm|analogwrite|dim/i, "**PWM** (analogWrite) doesn't make a lower voltage: it flicks the pin fully on and off very fast. The fraction of time it's on (0–255) sets the average, so an LED looks dimmer and a motor runs slower. Add an oscilloscope to see the square wave."],
    [/breadboard|hole|rail|strip/i, "On a **breadboard**, each column of five holes (a–e, and f–j) is joined underneath, and each long + and − rail is joined along its length. The middle channel separates the two halves — chips straddle it. Hover any hole to see what it's joined to."],
    [/transistor|npn|mosfet|base|gate/i, "A **transistor** is a switch an Arduino can work. A small current into an NPN's base (through a ~1 kΩ resistor) lets a big current flow collector → emitter. A logic-level MOSFET needs no base current at all — 5 V on its gate turns it fully on."],
    [/diode|flyback|kick/i, "Coils (relays, motors) fight changes in current. When the switch opens they **kick back** with a big voltage spike. A diode across the coil, stripe towards +, gives that energy somewhere harmless to go."],
    [/short/i, "A **short circuit** is a path with almost no resistance straight from + to −. Huge current flows, the battery heats up and wires can melt. Every path from + to − should go through something that does work: a resistor, an LED with its resistor, a motor."],
    [/series|parallel/i, "In **series**, parts share the voltage and the same current flows through each — two bulbs in series are dimmer. In **parallel**, each part gets the full voltage and the currents add up — two bulbs in parallel are each as bright as one alone, but the battery works twice as hard."],
    [/volt/i, "**Voltage** is the push; **current** is the flow; **resistance** is how hard it is to flow. With the power on, hover any leg to read its voltage and the current through it."],
    [/delay|millis/i, "**delay(ms)** stops the program for that long — nothing else happens meanwhile. To do two things at once, check **millis()** instead: `if (millis() - last >= 500) { last = millis(); … }`."],
    [/int|overflow|negative/i, "On an Uno an **int** is only 16 bits: −32768 to 32767. 300 * 200 overflows and comes out negative. Use **long** (or 300L) for bigger numbers."]
  ];

  L.localHelper = function (kind, question, app) {
    var doc = app.doc, sim = app.sim, kid = doc.mode === "kid";
    if (sim.topoDirty || !sim.topo) sim.build();
    var probs = app.problems();
    var res = { reply: "", highlights: [] };
    var probText = function () {
      if (!probs.length) return app.running ? (kid ? "I can't see anything wrong — everything is working!" : "The simulator isn't worried about anything right now.")
                                            : (kid ? "Press the power button and I'll watch for problems." : "Nothing obvious with the power off. Switch it on: overloads, burnt parts and shorts only show up while current flows.");
      res.highlights = probs.map(function (p) { return p.part; }).filter(Boolean).slice(0, 4);
      return probs.slice(0, 6).map(function (p) { return "- " + p.msg; }).join("\n");
    };
    switch (kind) {
      case "explain":
        res.reply = L.describe(doc, sim) + (app.running ? "\n\n" + (probs.length ? "Things to look at:\n" + probText() : "") : "");
        break;
      case "fix":
        res.reply = (probs.length ? (kid ? "Here's what I spotted:\n" : "Here is what the simulator flagged:\n") : "") + probText();
        break;
      case "code": {
        var s = L.starterCode(doc, sim);
        if (!s) { res.reply = kid ? "Add the Robo Brain first — it's the part that follows instructions." : "There's no microcontroller to program. Add an Arduino Uno or Nano from Boards."; break; }
        if (!s.outs.length && !s.ins.length && !s.analogs.length && !s.servos.length) { res.reply = "Nothing is wired to the board's pins yet, so there's nothing to control. Wire an LED (with its resistor) to a pin first."; break; }
        res.code = s.code;
        res.reply = "I wrote this by looking at what is plugged into each pin: " +
          [s.outs.length ? s.outs.length + " output" + (s.outs.length > 1 ? "s" : "") : "", s.ins.length ? s.ins.length + " input" + (s.ins.length > 1 ? "s" : "") : "", s.analogs.length ? s.analogs.length + " sensor" + (s.analogs.length > 1 ? "s" : "") : "", s.servos.length ? "a servo" : ""].filter(Boolean).join(", ") + ".";
        break;
      }
      case "build": {
        var hit = EXAMPLE_WORDS.filter(function (w) { return w[0].test(question); })[0];
        if (kid && /light|bulb/i.test(question)) hit = [null, /button/i.test(question) ? "k_fan" : "k_light"];
        res.reply = hit ? "Designing new circuits needs the AI, but there's a ready-made one that does that. Open it and change it to suit."
                        : "Designing new circuits needs the AI, which isn't available right now. The Examples menu has a dozen working circuits to start from.";
        if (hit) res.example = hit[1];
        break;
      }
      case "lesson": {
        var parts = doc.parts.map(function (p) { return partName(doc, p.id); }).filter(function (v, i, a) { return a.indexOf(v) === i; });
        res.reply = "## A lesson around this circuit\n" +
          "**You'll need:** " + (parts.join(", ") || "an empty bench") + ".\n" +
          "1. **Predict.** Before switching on, ask the class what will happen and why. Write the predictions on the board.\n" +
          "2. **Switch on and observe.** Turn on the power. Use *Lights → Dark* to make the result easy to see from the back.\n" +
          "3. **Measure.** Hover the legs to read voltages, or wire in the multimeter. Compare with Ohm's law: V = I × R.\n" +
          "4. **Break it on purpose.** Remove the resistor, or turn the LED round. What does the Check tab say? Why?\n" +
          "5. **Change one thing.** Swap a value or a line of code and predict again before trying it.\n" +
          "6. **Pin it.** Use *Pin to board* to put a picture of the final circuit on the lesson page.";
        break;
      }
      default: {
        var facts = KB.filter(function (k) { return k[0].test(question); }).map(function (k) { return k[1]; });
        res.reply = facts.length ? facts.slice(0, 2).join("\n\n") : (kid ? "I'm not sure about that one! Try the buttons above, or check the Missions." : "I can only answer a few kinds of question without the AI. Try the buttons above, or ask about LEDs, resistors, PWM, pull-ups, transistors or breadboards.");
        if (/wrong|work|broken|why/i.test(question)) res.reply += "\n\n" + probText();
      }
    }
    return res;
  };
})(typeof window !== "undefined" ? window : globalThis);
