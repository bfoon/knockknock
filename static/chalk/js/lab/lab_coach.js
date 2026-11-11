/* Chalk Circuit Lab — the wiring coach.
 *
 * The person at your elbow who has wired a thousand of these. It does four
 * things, all from the same knowledge of what each leg of each part is for:
 *
 *   tips      Start a wire from a leg and it says what that leg wants, and
 *             rings the legs that would be a good other end. Bring the wire
 *             near a leg and it says, before you let go, whether that join
 *             is right, risky or a short circuit.
 *   review    After every change it reads the whole circuit for the
 *             mistakes everyone makes — an LED with no resistor, a motor
 *             on a pin, a sensor with no power, a dead short — and offers
 *             to fix the ones it can fix.
 *   wire it   Select a part, press "Wire it for me": it finds free pins on
 *             the board, adds the resistor or transistor the part needs,
 *             and joins everything up. With an AI key the AI can do the
 *             same job for the awkward cases, checked against these rules.
 *   swap      Change a part for another — an LED for a buzzer, an Uno for
 *             a Nano — and its wires follow to the legs of the same name.
 *
 * The engine (ChalkLab.Coach) reads the document and the simulator's
 * netlist and runs under Node; the Coach class below is the card on the
 * bench and the buttons in the inspector.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var C = L.Coach = {};
  var esc = L.esc;

  /* ============================================================ ROLES */

  /* What a leg is for. Everything else follows from this. */
  C.role = function (part, pin) {
    var t = part.type, d = L.def(part);
    if (!d) return "other";
    if (d.mcu) {
      if (/^GND/.test(pin)) return "gnd";
      if (/^(5V|3V3)$/.test(pin)) return "vcc";
      if (pin === "VIN") return "vinraw";
      if (/^(D\d+|OUT\d|IN\d)$/.test(pin)) return "dio";
      if (/^A\d$/.test(pin) || pin === "EYE") return "aio";
      return "other";
    }
    if (/^(battery|k_battery|coin_cell|psu)/.test(t)) return pin === "+" ? "vbat" : "gnd";
    if (/^(led|k_led)$/.test(t)) return pin === "A" || pin === "+" ? "anode" : "cathode";
    if (t === "rgb_led") return pin === "K" ? "cathode" : "anode";
    if (t === "potentiometer") return pin === "W" ? "aout" : "passive";
    if (/^(resistor|k_resistor|capacitor|capacitor_e|ldr|k_ldr|thermistor|diode)$/.test(t)) return "passive";
    if (/^(motor|k_motor)$/.test(t)) return "motor";
    if (/^(bulb|k_bulb)$/.test(t)) return "lamp";
    if (t === "nmos") return { G: "gate", D: "drain", S: "source" }[pin] || "other";
    if (t === "npn" || t === "pnp") return { B: "gate", C: "drain", E: "source" }[pin] || "other";
    if (/^(button|k_button|slide_switch|k_switch|tilt_switch)$/.test(t)) return "sw";
    if (/^(buzzer|piezo|k_buzzer)$/.test(t)) return pin === "+" ? "loadp" : "loadn";
    if (/^(VCC|V\+|\+V)$/.test(pin)) return "vin";
    if (/^GND$/.test(pin)) return "gndin";
    if (pin === "SDA") return "sda";
    if (pin === "SCL") return "scl";
    if (pin === "AO" || (pin === "OUT" && t === "tmp36")) return "aout";
    if (/^(OUT|DO|ECHO|TXD|D[0-3]|VT|STATE)$/.test(pin)) return "dout";
    if (/^(TRIG|SIG|IN|RXD)$/.test(pin)) return "din";
    if (/^(NO|NC|COM)$/.test(pin)) return "sw";
    return "other";
  };

  var ROLE_SAYS = {
    gnd: "Ground — the way home for every current in the circuit. Almost everything needs one wire here.",
    vcc: "A steady supply from the board. Feed sensors and small modules from it; never join it straight to ground.",
    vinraw: "The board's raw power input. Batteries of 7–12 V go in here; it is not a 5 V output.",
    vbat: "The battery's positive side. Give motors and lamps their power from here, not from a board pin.",
    dio: "A digital pin: your program can switch it HIGH or LOW, or read a switch on it. It can only give about 20 mA — enough for an LED through a resistor, not for a motor.",
    aio: "An analog input: it measures a voltage from 0 to 5 V as a number from 0 to 1023. Knobs, light and temperature sensors belong here.",
    anode: "The LED's long leg (+). Current comes in here — always through a resistor, or the LED burns out in a blink.",
    cathode: "The LED's short leg (−). It goes towards ground.",
    passive: "This part has no right way round on this leg. It sits between two other things.",
    motor: "A motor leg. A motor takes far more current than a pin can give: it goes between the battery and a transistor, never straight to a pin.",
    lamp: "A lamp leg. Like a motor, a bulb needs its own supply, switched by a relay or a transistor.",
    gate: "The transistor's control leg. A board pin goes here, through a small resistor: a little current in here switches a big one through the other two legs.",
    drain: "The transistor's switched leg. The low side of the motor or lamp goes here.",
    source: "The transistor's ground-side leg. It goes to ground — the same ground as the board.",
    sw: "A switch contact. One side to a pin, the other to ground, and tell the pin INPUT_PULLUP: then it reads LOW when pressed.",
    loadp: "The sounder's + leg. A pin can drive this directly.",
    loadn: "The sounder's − leg. It goes to ground.",
    vin: "This module's power leg. It wants 5 V from the board.",
    gndin: "This module's ground leg. Join it to the board's ground or nothing it says will make sense.",
    sda: "I²C data. On an Uno this must go to A4.",
    scl: "I²C clock. On an Uno this must go to A5.",
    aout: "An analog signal: a voltage that varies. It needs an analog input (A0–A5), not a digital pin.",
    dout: "A digital signal coming out of the module. Any free digital pin can read it.",
    din: "A signal the module listens to. Drive it from a digital pin.",
    other: ""
  };

  /* ------------------------------------------------------------ netlist */

  C.ctx = function (doc, sim) {
    if (!sim.topo || sim.topoDirty) sim.build();
    var T = sim.topo, byId = {}, nets = {}, x = { doc: doc, sim: sim, T: T, byId: byId, nets: nets };
    doc.parts.forEach(function (p) { byId[p.id] = p; });
    Object.keys(T.pins).forEach(function (k) {
      if (T.pins[k].hole) return;
      var r = T.find(k);
      (nets[r] = nets[r] || []).push(k);
    });
    x.members = function (key) { return T.pins[key] ? (nets[T.find(key)] || []) : []; };
    x.split = function (key) { var i = key.indexOf(":"); return { id: key.slice(0, i), pin: key.slice(i + 1), part: byId[key.slice(0, i)] }; };
    x.roleOf = function (key) { var q = x.split(key); return q.part ? C.role(q.part, q.pin) : "other"; };
    /* every role present on the node this leg sits on, by leg */
    x.rolesOn = function (key) {
      return x.members(key).map(function (k) { return { key: k, role: x.roleOf(k), part: x.split(k).part, pin: x.split(k).pin }; });
    };
    x.has = function (key, re) { return x.rolesOn(key).filter(function (m) { return re.test(m.role); }); };
    /* free = joined to nothing but its own part (a button's legs are joined
     * to each other inside the button; that doesn't make them wired) */
    x.free = function (key) { var id = key.slice(0, key.indexOf(":")); return x.members(key).every(function (k) { return k.slice(0, k.indexOf(":")) === id; }); };
    /* a leg in a breadboard hole speaks for the hole: what is this hole? */
    x.resolve = function (pin) {
      if (!pin.hole) return [pin.key];
      var r = T.pins[pin.key] ? T.find(pin.key) : null;
      return r != null && nets[r] ? nets[r].slice() : [];
    };
    return x;
  };

  /* ============================================================ JUDGE */

  var GOOD = "good", WARN = "warn", BAD = "bad";

  /* Is joining these two legs a good idea? Looked at from both ends. */
  function verdict(a, b, pa, pb) {
    var is = function (x, y) { return (a === x && b === y) || (a === y && b === x); };
    var one = function (x) { return a === x || b === x; };
    var pos = /^(vcc|vbat|vinraw)$/, isPos = function (r) { return pos.test(r); };
    if ((isPos(a) && b === "gnd") || (isPos(b) && a === "gnd")) return [BAD, "That joins power straight to ground: a dead short. Wires get hot, batteries die, and the board resets."];
    if (is("gnd", "gnd") || is("gndin", "gnd")) return [GOOD, "Grounds joined. Every part of a circuit must share one ground — this is the wire people forget."];
    if (is("vin", "vcc")) return [GOOD, "Power to the module, from the board's 5 V. Red wire, by tradition."];
    if (is("vin", "vbat")) return [WARN, "That feeds the module from the battery. Check the voltage first: most of these modules want 5 V and a 6 V pack is already too much for some."];
    if (is("vin", "gnd") || is("gndin", "vcc") || is("gndin", "vbat")) return [BAD, "That is the module's power the wrong way round. Reverse power kills modules instantly."];
    if (is("anode", "dio")) return [WARN, "That works only with a resistor in between. A pin gives 5 V, an LED wants about 2 V: put 220 Ω between them to take up the difference."];
    if (is("anode", "vcc") || is("anode", "vbat")) return [WARN, "Straight to the supply, the LED will burn out. Go through a resistor first."];
    if (is("anode", "gnd")) return [BAD, "That is the LED's long leg to ground: it is in backwards and will never light. The long leg faces +."];
    if (is("cathode", "gnd")) return [GOOD, "Short leg to ground: right."];
    if (is("cathode", "vcc") || is("cathode", "vbat")) return [BAD, "The LED's short leg to +: it is in backwards. Turn it round."];
    if (is("anode", "passive") || is("cathode", "passive")) return [GOOD, "Through a resistor: exactly right. It does not matter which side of the LED the resistor is on."];
    if (is("motor", "dio") || is("motor", "aio") || is("lamp", "dio")) return [BAD, "A pin cannot run that. It would try to supply ten times the current it is built for. Use a transistor or a relay as the switch."];
    if (is("motor", "vcc")) return [WARN, "The board's 5 V can only spare about half an amp, and a motor's start-up surge will make the board reset. Give the motor its own battery."];
    if (is("motor", "drain") || is("lamp", "drain")) return [GOOD, "Low side of the load to the transistor: right. The transistor is the switch between the load and ground."];
    if (is("motor", "vbat") || is("lamp", "vbat")) return [GOOD, "Power for the load straight from the battery: right."];
    if (is("motor", "passive")) return [GOOD, "If that is the diode across the motor, its stripe goes to the battery's + side."];
    if (is("gate", "dio")) return [WARN, "It will switch — but put about 220 Ω in this wire to protect the pin, and 10 kΩ from the gate to ground so it stays off while the board starts up."];
    if (is("gate", "passive")) return [GOOD, "A resistor on the control leg: right."];
    if (is("source", "gnd")) return [GOOD, "Transistor to ground: right. Make sure it is the same ground as the board's."];
    if (is("drain", "gnd") || is("source", "vbat") || is("source", "vcc")) return [BAD, "That puts the transistor in backwards: its ground-side leg goes to ground, and the load goes on the other one."];
    if (is("aout", "aio")) return [GOOD, "An analog signal into an analog input: right. Read it with analogRead()."];
    if (is("aout", "dio")) return [BAD, "A digital pin can only say HIGH or LOW, so it would throw the measurement away. Use A0 to A5."];
    if (is("dout", "dio") || is("dout", "aio")) return [GOOD, "A signal out of the module into a pin: right. Set the pin as INPUT."];
    if (is("din", "dio")) return [GOOD, "A pin driving the module: right. Set the pin as OUTPUT."];
    if (is("din", "aio")) return [WARN, "It works — the analog pins can be digital outputs too — but keep them free for sensors if you can."];
    if (one("sda")) { var o = a === "sda" ? pb : pa, r2 = a === "sda" ? b : a; if (r2 === "aio" || r2 === "other" || r2 === "dio") return o === "A4" || o === "SDA" ? [GOOD, "SDA to A4: right. That is where the Uno keeps its I²C data line."] : [BAD, "SDA has to go to A4 (or the pin marked SDA). I²C only works on its own two pins."]; }
    if (one("scl")) { var o2 = a === "scl" ? pb : pa, r3 = a === "scl" ? b : a; if (r3 === "aio" || r3 === "other" || r3 === "dio") return o2 === "A5" || o2 === "SCL" ? [GOOD, "SCL to A5: right."] : [BAD, "SCL has to go to A5 (or the pin marked SCL)."]; }
    if (is("sw", "dio")) return [GOOD, "A switch on a pin: right. Its other side goes to ground, and the pin is set INPUT_PULLUP."];
    if (is("sw", "gnd")) return [GOOD, "Switch to ground: right, as long as the pin uses INPUT_PULLUP."];
    if (is("sw", "vcc")) return [WARN, "A switch to 5 V needs a 10 kΩ resistor from the pin to ground as well, or the pin floats when the switch is open. Switch-to-ground with INPUT_PULLUP needs no resistor."];
    if (is("loadp", "dio")) return [GOOD, "A pin can drive a small sounder directly: right."];
    if (is("loadn", "gnd")) return [GOOD, "Sounder to ground: right."];
    if (is("loadp", "gnd") || is("loadn", "vcc")) return [WARN, "That is the sounder the wrong way round. An active buzzer only works one way."];
    if (is("dio", "dio")) return [WARN, "Two pins joined together. If the program ever sets one HIGH and the other LOW, they fight and both can be damaged."];
    if (is("dio", "gnd") || is("dio", "vcc") || is("dio", "vbat")) return [BAD, "A pin tied straight to a supply rail. The moment the program drives it the other way, it is a short through the chip."];
    if (is("aio", "vcc") || is("aio", "gnd")) return [WARN, "It will read 1023 or 0 for ever. Is that what you meant? A sensor normally sits between."];
    if (is("passive", "dio") || is("passive", "aio") || is("passive", "gnd") || is("passive", "vcc") || is("passive", "vbat") || is("passive", "passive")) return [GOOD, ""];
    return null;
  }

  /* Would joining these two legs be right? Legs in breadboard holes are
   * judged as whatever shares the hole. */
  C.judge = function (x, pinA, pinB) {
    var as = x.resolve(pinA), bs = x.resolve(pinB), worst = null, rank = { bad: 3, warn: 2, good: 1 };
    if (!as.length || !bs.length) return null;
    as.forEach(function (ka) {
      bs.forEach(function (kb) {
        if (ka === kb) return;
        var qa = x.split(ka), qb = x.split(kb);
        if (!qa.part || !qb.part || qa.part === qb.part) return;
        var v = verdict(C.role(qa.part, qa.pin), C.role(qb.part, qb.pin), qa.pin, qb.pin);
        if (v && (!worst || rank[v[0]] > rank[worst.v])) worst = { v: v[0], why: v[1] };
      });
    });
    return worst;
  };

  /* What does this leg want? For the moment a wire is started from it. */
  C.pinTip = function (x, pin) {
    var keys = x.resolve(pin), first = keys.filter(function (k) { return x.roleOf(k) !== "passive"; })[0] || keys[0];
    if (!first) return { title: pin.hole ? "An empty hole" : "", text: pin.hole ? "Nothing is plugged into this row yet. Whatever you put here joins the other four holes of the row." : "", targets: [] };
    var q = x.split(first), role = C.role(q.part, q.pin), d = L.def(q.part), targets = [];
    x.doc.parts.forEach(function (p) {
      if (p.id === q.id || !L.def(p) || /^(breadboard|perfboard|stripboard)/.test(p.type) || p.hide) return;
      L.pinsOf(p).forEach(function (t) {
        if (t.hole) return;
        var v = verdict(role, C.role(p, t.name), q.pin, t.name);
        if (v && v[0] === GOOD && v[1]) targets.push(t);
      });
    });
    /* a board has three grounds and twenty pins: don't light up the lot */
    var leg = (L.pinList(q.part).filter(function (p) { return p.n === q.pin; })[0] || {}).label || q.pin;
    return { title: d.name.replace(/ \(.+\)$/, "") + " · " + leg, text: ROLE_SAYS[role] || "", role: role, targets: targets.slice(0, 60) };
  };

  /* =========================================================== REVIEW */

  /* The mistakes everyone makes, found by reading the netlist. Each is
   * {part, level, code, msg, fix}; fix, when there is one, is a plan the
   * coach can carry out. */
  C.review = function (doc, sim) {
    var x = C.ctx(doc, sim), out = [], ref = L.refdes(doc);
    var POS = /^(vcc|vbat|vinraw)$/, DRIVE = /^(vcc|vbat|vinraw|dio|aio)$/;
    var push = function (part, level, code, msg, fix) { out.push({ part: part.id, level: level, code: "coach-" + code, msg: msg, fix: fix || null }); };
    /* a dead short: one node holding both a supply and ground */
    var shorted = {};
    Object.keys(x.nets).forEach(function (r) {
      var m = x.nets[r].map(function (k) { return { k: k, role: x.roleOf(k), q: x.split(k) }; });
      var pos = m.filter(function (e) { return POS.test(e.role); }), gnd = m.filter(function (e) { return e.role === "gnd"; });
      if (pos.length && gnd.length) {
        shorted[r] = 1;
        push(pos[0].q.part, "danger", "short", "Power is joined straight to ground (" + ref[pos[0].q.id] + " " + pos[0].q.pin + " and " + ref[gnd[0].q.id] + " " + gnd[0].q.pin + " are on the same wire). That is a dead short: take one of those wires out before switching on.");
      }
      var raw = m.filter(function (e) { return e.role === "vbat"; }), five = m.filter(function (e) { return e.role === "vcc"; });
      if (raw.length && five.length && !gnd.length) {
        var volts = L.propsOf(raw[0].q.part), v = volts.volts || (volts.cells ? volts.cells * 1.5 : 0);
        if (v > 5.5) push(raw[0].q.part, "warn", "overvolt", "A " + v + " V battery is joined to the board's " + five[0].q.pin + " pin. That pin is a 5 V output; feeding it more can destroy the board. Battery + goes to VIN, or only to the motors.");
      }
    });
    doc.parts.forEach(function (p) {
      var d = L.def(p);
      if (!d || /^(breadboard|perfboard|stripboard|multimeter|scope)/.test(p.type)) return;
      var key = function (pin) { return p.id + ":" + pin; }, name = ref[p.id] + " (" + L.partTitle(p).toLowerCase() + ")";
      var pins = L.pinList(p).filter(function (q) { return !q.hole; }).map(function (q) { return q.n; });
      if (/^(led|k_led|rgb_led)$/.test(p.type)) {
        var kPin = p.type === "led" ? "K" : p.type === "k_led" ? "-" : "K";
        var aPins = p.type === "led" ? ["A"] : p.type === "k_led" ? ["+"] : ["R", "G", "B"];
        var kGnd = x.has(key(kPin), /^gnd$/).length, kPos = x.has(key(kPin), POS).length;
        aPins.forEach(function (a) {
          var drive = x.has(key(a), DRIVE), aGnd = x.has(key(a), /^gnd$/).length;
          if (shorted[x.T.find(key(a))] || shorted[x.T.find(key(kPin))]) return;
          if (drive.length && kGnd && p.type !== "k_led") {
            push(p, "warn", "nores", name + " has no resistor: " + (p.type === "rgb_led" ? "its " + a + " leg" : "it") + " is joined straight to " + (L.def(drive[0].part).mcu ? "pin " + drive[0].pin : ref[drive[0].part.id] + " " + drive[0].pin) + " and straight to ground. It will take far too much current and burn out. Put 220 Ω in series.", C.fixResistor(x, p, a));
          } else if (aGnd && !kGnd && (kPos || !x.free(key(kPin)))) {
            push(p, "warn", "backwards", name + " is in backwards: its long leg is on ground. Turn it round — long leg towards +, short leg towards ground.", { label: "Turn it round", swapPins: [p.id, a, kPin] });
          }
        });
      }
      if (/^(motor|k_motor|bulb)$/.test(p.type)) {
        pins.forEach(function (pin) {
          var io = x.has(key(pin), /^(dio|aio)$/);
          if (io.length && p.type !== "k_motor") push(p, "warn", "direct", name + " is wired straight to pin " + io[0].pin + ". A pin can give about 20 mA; this wants ten times that or more, and it will damage the board. It needs a transistor to do the switching and a battery to do the lifting.",
            p.type === "motor" ? { label: "Rewire it through a transistor", rewire: p.id, pin: io[0].key } : null);
        });
      }
      /* a module with signals wired but no power is the commonest "it does nothing" */
      var vin = pins.filter(function (n) { return C.role(p, n) === "vin"; }), gin = pins.filter(function (n) { return C.role(p, n) === "gndin"; });
      if (vin.length && gin.length) {
        var sig = pins.filter(function (n) { return /^(aout|dout|din|sda|scl)$/.test(C.role(p, n)) && !x.free(key(n)); });
        var noV = x.free(key(vin[0])), noG = x.free(key(gin[0]));
        if (sig.length && (noV || noG)) push(p, "warn", "nopower", name + " has its signal wired but no " + (noV && noG ? "power or ground" : noV ? "power" : "ground") + ". It can't do anything until both " + vin[0] + " and GND are connected.", { label: "Connect its power", plan: p.id });
        else if (!noV && !noG && x.has(key(vin[0]), /^gnd$/).length && !shorted[x.T.find(key(vin[0]))]) push(p, "danger", "revpower", name + " has its power leg on ground. Reverse power destroys modules: swap the two wires.");
      }
      pins.forEach(function (pin) {
        var role = C.role(p, pin);
        if (role === "aout") {
          var dig = x.has(key(pin), /^dio$/), ana = x.has(key(pin), /^aio$/);
          if (dig.length && !ana.length) push(p, "warn", "analog", name + " gives an analog signal on " + pin + ", but it is wired to digital pin " + dig[0].pin + ", which can only tell HIGH from LOW. Move that wire to one of A0–A5.", { label: "Move it to an analog pin", move: [key(pin), dig[0].key, "analog"] });
        }
        if (role === "sda" || role === "scl") {
          var want = role === "sda" ? "A4" : "A5", on = x.has(key(pin), /^(dio|aio|other)$/).filter(function (m) { return L.def(m.part).mcu; });
          if (on.length && !on.some(function (m) { return m.pin === want || m.pin === pin; })) push(p, "warn", "i2c", name + " has " + pin + " on pin " + on[0].pin + ". I²C only works on its own pins: " + pin + " must go to " + want + ".", { label: "Move it to " + want, move: [key(pin), on[0].key, want] });
        }
      });
      if (d.mcu) {
        pins.filter(function (n) { return C.role(p, n) === "dio"; }).forEach(function (pin) {
          var rails = x.has(key(pin), /^(vcc|vbat|gnd)$/).filter(function (m) { return !(m.part === p && m.pin === pin); });
          if (rails.length && !shorted[x.T.find(key(pin))]) push(p, "warn", "railpin", "Pin " + pin + " of " + ref[p.id] + " is tied straight to " + (rails[0].role === "gnd" ? "ground" : "a supply") + ". If the program ever drives it the other way, that is a short through the chip. Put the part it is meant to control in between.");
        });
      }
    });
    return out;
  };

  /* Put a resistor into the wire that reaches an LED's leg. Only possible
   * when a wire ends on the leg itself; an LED pushed into a breadboard
   * has to be moved by hand, and the advice says so. */
  C.fixResistor = function (x, led, pin) {
    var key = led.id + ":" + pin, w = x.doc.wires.filter(function (q) { return q.a.ref === key || q.b.ref === key; })[0];
    return w ? { label: "Add a 220 Ω resistor", resistor: [w.id, key] } : null;
  };

  /* ============================================================= PLAN */

  var PWM = [9, 6, 5, 3, 10, 11], DIG = [2, 4, 7, 8, 12, 13, 9, 6, 5, 3, 10, 11], ANA = ["A0", "A1", "A2", "A3", "A4", "A5"];

  /* Work out how to wire a part into the circuit: which free pins to use,
   * which helpers it needs, every wire. Returns
   * {ok, parts: [{id: "+r", type, props}], wires: [{a, b, color}], steps, code, notes}
   * with existing parts named by their real id and new ones by a "+" id. */
  C.plan = function (doc, sim, partId, opts) {
    opts = opts || {};
    var x = C.ctx(doc, sim), p = x.byId[partId], out = { ok: false, parts: [], wires: [], steps: [], code: [], notes: [] };
    if (!p || !L.def(p)) return out;
    var boards = L.mcus(doc), mcu = (opts.mcu && x.byId[opts.mcu]) || boards[0], d = L.def(p), t = p.type, taken = {}, gi = 0, seq = 0;
    var ref = L.refdes(doc), me = ref[p.id], key = function (pin) { return p.id + ":" + pin; }, free = function (pin) { return x.free(key(pin)); };
    if (d.mcu) { out.notes.push("This is the board everything else is wired to. Select another part and I will wire it to this."); return out; }
    if (/^(breadboard|perfboard|stripboard|multimeter|scope|rf_remote)/.test(t)) { out.notes.push(t === "rf_remote" ? "The key fob has no wires: it talks to its receiver by radio." : "Nothing to wire here."); return out; }
    var kid = mcu && mcu.type === "k_brain";
    var mpins = mcu ? L.pinList(mcu).map(function (q) { return q.n; }) : [];
    var mk = function (pin) { return mcu.id + ":" + pin; };
    var pick = function (list, why) {
      for (var i = 0; i < list.length; i++) {
        var nm = typeof list[i] === "number" ? "D" + list[i] : list[i];
        if (mpins.indexOf(nm) >= 0 && !taken[nm] && x.free(mk(nm))) { taken[nm] = 1; return nm; }
      }
      out.notes.push("The board has no free " + why + " left for this.");
      return null;
    };
    var grounds = mpins.filter(function (n) { return /^GND/.test(n); });
    var gnd = function () {
      if (mcu) return mk(grounds[gi++ % grounds.length]);
      var b = doc.parts.filter(function (q) { return /^(battery|k_battery|coin_cell|psu)/.test(q.type); })[0];
      return b ? b.id + ":-" : null;
    };
    var vcc = function () {
      if (mcu) return mk("5V");
      var b = doc.parts.filter(function (q) { return /^(battery|k_battery|coin_cell|psu)/.test(q.type); })[0];
      return b ? b.id + ":+" : null;
    };
    var add = function (type, props) { var id = "+" + (++seq); out.parts.push({ id: id, type: type, props: props || {} }); return id; };
    var wire = function (a, b, color, say) { if (!a || !b) return; out.wires.push({ a: a, b: b, color: color }); if (say) out.steps.push(say); };
    var need = function (what) { out.notes.push(what); };
    var pinNum = function (nm) { return /^D\d+$/.test(nm) ? nm.slice(1) : nm; };
    var NAME = (me || "PART").replace(/[^A-Za-z0-9]/g, "");
    if (!mcu && !/^(led|k_led|bulb|k_bulb|buzzer|k_buzzer|motor|k_motor)$/.test(t)) { need("There is no Arduino on the bench to wire this to. Add one from Boards first."); return out; }

    var power = function (v, g) {
      if (free(v)) wire(key(v), vcc(), "red", me + " " + v + " → 5 V: its power.");
      if (free(g)) wire(key(g), gnd(), "black", me + " " + g + " → ground.");
    };

    if (t === "led" || t === "k_led") {
      var a = t === "led" ? "A" : "+", k = t === "led" ? "K" : "-";
      if (free(a)) {
        /* plain pins first: the six that can fade are worth keeping for motors and servos */
        var src = mcu ? pick(kid ? ["OUT1", "OUT2", "OUT3", "OUT4"] : DIG, "output pin") : null;
        if (mcu && !src) return out;
        if (!mcu && !vcc()) { need("There is nothing to power it from yet. Add an Arduino or a battery first."); return out; }
        if (t === "led") {
          var r = add("resistor", { ohms: 220 });
          wire(mcu ? mk(src) : vcc(), r + ":1", "white", (mcu ? "Pin " + src : "Battery +") + " → a new 220 Ω resistor. It limits the current to about 14 mA.");
          wire(r + ":2", key(a), "white", "Resistor → the LED's long leg.");
        } else wire(mcu ? mk(src) : vcc(), key(a), "white", (mcu ? src : "Battery +") + " → the LED's + post.");
        if (mcu && !kid) out.code = ["const int " + NAME + " = " + pinNum(src) + ";", "pinMode(" + NAME + ", OUTPUT);        // in setup()", "digitalWrite(" + NAME + ", HIGH);       // on" + (PWM.indexOf(+pinNum(src)) >= 0 ? "  — or analogWrite(" + NAME + ", 0-255) to dim it" : "")];
      } else if (t === "led" && x.has(key(a), /^(dio|vcc|vbat)$/).length) need("Its long leg is joined straight to a pin or the supply. It needs a resistor in that wire — see Check.");
      if (free(k)) wire(key(k), gnd(), "black", "The LED's short leg → ground.");
    } else if (t === "rgb_led") {
      ["R", "G", "B"].forEach(function (c2) {
        if (!free(c2)) return;
        var s2 = pick(PWM, "PWM pin"); if (!s2) return;
        var r2 = add("resistor", { ohms: 220 });
        wire(mk(s2), r2 + ":1", { R: "red", G: "green", B: "blue" }[c2], "Pin " + s2 + " → 220 Ω → the " + { R: "red", G: "green", B: "blue" }[c2] + " leg. Each colour needs its own resistor.");
        wire(r2 + ":2", key(c2), { R: "red", G: "green", B: "blue" }[c2]);
        out.code.push("const int " + { R: "RED", G: "GREEN", B: "BLUE" }[c2] + " = " + pinNum(s2) + ";   // analogWrite(pin, 0-255) mixes the colour");
      });
      if (free("K")) wire(key("K"), gnd(), "black", "The common leg → ground.");
    } else if (/^(button|k_button|tilt_switch)$/.test(t)) {
      var b1 = t === "button" ? "1a" : t === "tilt_switch" ? "1" : "a", b2 = t === "button" ? "2b" : t === "tilt_switch" ? "2" : "b";
      if (kid) {
        if (free(b1)) wire(key(b1), mk("5V"), "red", me + " → the 5V post.");
        if (free(b2)) { var inp = pick(["IN1", "IN2"], "input post"); if (inp) wire(key(b2), mk(inp), "yellow", me + " → " + inp + ". Pressed reads ON."); }
      } else {
        if (free(b1)) { var bp = pick(DIG, "digital pin"); if (bp) { wire(key(b1), mk(bp), "yellow", me + " → pin " + bp + "."); out.code = ["const int " + NAME + " = " + pinNum(bp) + ";", "pinMode(" + NAME + ", INPUT_PULLUP);   // in setup(): no resistor needed", "if (digitalRead(" + NAME + ") == LOW) { … }   // LOW means pressed"]; } }
        if (free(b2)) wire(key(b2), gnd(), "black", "Its other side → ground. With INPUT_PULLUP the pin reads LOW when it is pressed.");
      }
    } else if (t === "slide_switch") {
      if (free("C")) { var sp = pick(DIG, "digital pin"); if (sp) { wire(key("C"), mk(sp), "yellow", "The middle leg → pin " + sp + "."); out.code = ["const int " + NAME + " = " + pinNum(sp) + ";", "pinMode(" + NAME + ", INPUT_PULLUP);   // LOW when slid towards the grounded end"]; } }
      if (free("L")) wire(key("L"), gnd(), "black", "One end → ground.");
    } else if (/^(buzzer|piezo|k_buzzer)$/.test(t)) {
      if (free("+")) { var zp = mcu ? pick(kid ? ["OUT1", "OUT2", "OUT3", "OUT4"] : DIG, "output pin") : null; wire(key("+"), mcu ? (zp ? mk(zp) : null) : vcc(), "purple", me + " + → " + (mcu ? "pin " + zp : "battery +") + "."); if (zp && !kid) out.code = ["const int " + NAME + " = " + pinNum(zp) + ";", t === "piezo" ? "tone(" + NAME + ", 440);  …  noTone(" + NAME + ");   // a passive piezo needs tone()" : "pinMode(" + NAME + ", OUTPUT);  digitalWrite(" + NAME + ", HIGH);   // an active buzzer just needs HIGH"]; }
      if (free("-")) wire(key("-"), gnd(), "black", me + " − → ground.");
    } else if (t === "potentiometer") {
      if (free("1")) wire(key("1"), gnd(), "black", "One end → ground.");
      if (free("2")) wire(key("2"), vcc(), "red", "The other end → 5 V.");
      if (free("W")) { var ap = pick(ANA, "analog pin"); if (ap) { wire(key("W"), mk(ap), "purple", "The middle leg (the wiper) → " + ap + ": it sweeps from 0 to 5 V as you turn."); out.code = ["int " + NAME.toLowerCase() + " = analogRead(" + ap + ");   // 0 to 1023"]; } }
    } else if (/^(ldr|thermistor)$/.test(t)) {
      if (free("1") && free("2")) {
        var lp = pick(ANA, "analog pin"); if (!lp) return out;
        var lr = add("resistor", { ohms: 10000 });
        wire(vcc(), key("1"), "red", "5 V → one leg of " + me + ".");
        wire(key("2"), mk(lp), "green", "Its other leg → " + lp + " …");
        wire(mk(lp), lr + ":1", "green", "… and from " + lp + " a new 10 kΩ resistor → ground. The two make a divider: the voltage at " + lp + " rises as the sensor's resistance falls.");
        wire(lr + ":2", gnd(), "black");
        out.code = ["int " + NAME.toLowerCase() + " = analogRead(" + lp + ");   // " + (t === "ldr" ? "brighter = higher" : "warmer = higher")];
      } else need("One leg is already wired, so I can't tell which divider you have in mind. A light or heat sensor goes from 5 V to an analog pin, with 10 kΩ from that pin to ground.");
    } else if (t === "tmp36") {
      power("+V", "GND");
      if (free("OUT")) { var tp = pick(ANA, "analog pin"); if (tp) { wire(key("OUT"), mk(tp), "orange", "OUT → " + tp + ": 10 mV per degree, offset by half a volt."); out.code = ["float volts = analogRead(" + tp + ") * 5.0 / 1023.0;", "float celsius = (volts - 0.5) * 100.0;"]; } }
    } else if (/^mod_/.test(t)) {
      power("VCC", "GND");
      if (free("AO")) { var mp = pick(ANA, "analog pin"); if (mp) { wire(key("AO"), mk(mp), "green", "AO → " + mp + ": the measurement itself."); out.code = ["int " + NAME.toLowerCase() + " = analogRead(" + mp + ");   // 0 to 1023"]; } }
      out.notes.push("DO is left free: it only says above or below the module's own threshold, and AO tells you more.");
    } else if (t === "hcsr04") {
      power("VCC", "GND");
      var tr = free("TRIG") ? pick(DIG, "digital pin") : null, ec = free("ECHO") ? pick(DIG, "digital pin") : null;
      if (tr) wire(mk(tr), key("TRIG"), "green", "Pin " + tr + " → TRIG: the pin that says “ping”.");
      if (ec) wire(mk(ec), key("ECHO"), "orange", "ECHO → pin " + ec + ": stays HIGH for as long as the echo took.");
      if (tr && ec) out.code = ["const int TRIG = " + pinNum(tr) + ", ECHO = " + pinNum(ec) + ";", "digitalWrite(TRIG, HIGH); delayMicroseconds(10); digitalWrite(TRIG, LOW);", "long cm = pulseIn(ECHO, HIGH) / 58;"];
    } else if (t === "pir") {
      power("VCC", "GND");
      if (free("OUT")) { var pp = pick(DIG, "digital pin"); if (pp) { wire(key("OUT"), mk(pp), "yellow", "OUT → pin " + pp + ": HIGH while it sees movement."); out.code = ["const int " + NAME + " = " + pinNum(pp) + ";", "pinMode(" + NAME + ", INPUT);", "if (digitalRead(" + NAME + ") == HIGH) { … }"]; } }
    } else if (t === "servo") {
      power("V+", "GND");
      if (free("SIG")) { var sv = pick(DIG, "digital pin"); if (sv) { wire(mk(sv), key("SIG"), "orange", "Pin " + sv + " → SIG: the angle, sent as a pulse 50 times a second."); out.code = ["#include <Servo.h>", "Servo " + NAME.toLowerCase() + ";", NAME.toLowerCase() + ".attach(" + pinNum(sv) + ");   // in setup()", NAME.toLowerCase() + ".write(90);      // 0 to 180 degrees"]; } }
      out.notes.push("One small servo can run from the board's 5 V. Two or more, or a big one, need their own supply.");
    } else if (t === "lcd_i2c") {
      power("VCC", "GND");
      if (free("SDA")) { if (x.free(mk("A4"))) wire(key("SDA"), mk("A4"), "blue", "SDA → A4. I²C data only lives here."); else need("A4 is already in use, and SDA can go nowhere else. Free A4 first."); }
      if (free("SCL")) { if (x.free(mk("A5"))) wire(key("SCL"), mk("A5"), "yellow", "SCL → A5. I²C clock."); else need("A5 is already in use, and SCL can go nowhere else. Free A5 first."); }
      out.code = ["#include <LiquidCrystal_I2C.h>", "LiquidCrystal_I2C lcd(0x27, 16, 2);", "lcd.init(); lcd.backlight();   // in setup()", "lcd.print(\"Hello\");"];
    } else if (t === "relay_module") {
      power("VCC", "GND");
      if (free("IN")) { var rp = pick(DIG, "digital pin"); if (rp) { wire(mk(rp), key("IN"), "yellow", "Pin " + rp + " → IN: HIGH closes the relay."); out.code = ["const int " + NAME + " = " + pinNum(rp) + ";", "pinMode(" + NAME + ", OUTPUT);", "digitalWrite(" + NAME + ", HIGH);   // click: COM joins NO"]; } }
      out.notes.push("COM, NO and NC are the switch itself. Wire the lamp's own supply through COM and NO — they are deliberately not joined to the board.");
    } else if (t === "hc05" || t === "hc12") {
      power("VCC", "GND");
      var rx = free("TXD") ? pick(["D10", "D8", "D7", "D4", "D2"], "digital pin") : null, tx = free("RXD") ? pick(["D11", "D12", "D9", "D6", "D5"], "digital pin") : null;
      if (rx) wire(key("TXD"), mk(rx), "green", "The module's TXD → pin " + rx + ". Its transmit is the board's receive: these two always cross over.");
      if (tx) wire(key("RXD"), mk(tx), "blue", "The module's RXD ← pin " + tx + ".");
      if (rx && tx) out.code = ["#include <SoftwareSerial.h>", "SoftwareSerial " + (t === "hc05" ? "bt" : "radio") + "(" + pinNum(rx) + ", " + pinNum(tx) + ");   // RX, TX", (t === "hc05" ? "bt" : "radio") + ".begin(9600);   // in setup()"];
      out.notes.push("Pins 0 and 1 are left alone on purpose: they are the USB lead, and a module there stops you uploading.");
    } else if (t === "rf_rx") {
      power("VCC", "GND");
      ["D0", "D1", "D2", "D3"].forEach(function (o, i) {
        if (!free(o)) return;
        var fp = pick(DIG, "digital pin"); if (!fp) return;
        wire(key(o), mk(fp), "green", o + " → pin " + fp + ": HIGH while button " + "ABCD".charAt(i) + " is held.");
        out.code.push("const int KEY_" + "ABCD".charAt(i) + " = " + pinNum(fp) + ";   // pinMode(…, INPUT)");
      });
    } else if (t === "motor" || t === "k_motor") {
      if (kid || t === "k_motor") {
        if (free("a") && mcu) { var ko = pick(["OUT1", "OUT2", "OUT3", "OUT4"], "output post"); if (ko) wire(mk(ko), key("a"), "yellow", ko + " → the motor."); }
        if (free("b")) wire(key("b"), gnd(), "black", "Motor → the minus post.");
      } else if (free("1") && free("2")) {
        var batt = doc.parts.filter(function (q) { return /^battery_/.test(q.type); })[0], bid = batt ? batt.id : add("battery_aa", { cells: 4 });
        var bk = function (pin) { return bid + ":" + pin; };
        if (!batt) { out.steps.push("A new 4 × AA battery pack: motors need their own supply."); if (mcu) wire(bk("-"), mk(grounds[grounds.length - 1]), "black", "Battery − → the board's ground. Two supplies must share a ground or the transistor has nothing to switch against."); }
        var q2 = add("nmos"), dd = add("diode");
        wire(key("1"), bk("+"), "red", "One motor leg → battery +.");
        wire(key("2"), q2 + ":D", "blue", "The other motor leg → the transistor's drain. The transistor is the switch.");
        wire(q2 + ":S", gnd(), "black", "Transistor source → ground.");
        wire(dd + ":A", q2 + ":D", "blue", "A diode across the motor, stripe to +: when the motor is switched off its coil kicks back, and the diode swallows the spike that would otherwise kill the transistor.");
        wire(dd + ":K", bk("+"), "red");
        if (mcu) {
          var mp2 = pick(PWM, "PWM pin"); if (!mp2) return out;
          var gr = add("resistor", { ohms: 220 }), pd = add("resistor", { ohms: 10000 });
          wire(mk(mp2), gr + ":1", "yellow", "Pin " + mp2 + " → 220 Ω → the transistor's gate.");
          wire(gr + ":2", q2 + ":G", "yellow");
          wire(q2 + ":G", pd + ":1", "yellow", "10 kΩ from the gate to ground: it holds the motor off while the board is starting up.");
          wire(pd + ":2", gnd(), "black");
          out.code = ["const int " + NAME + " = " + pinNum(mp2) + ";", "pinMode(" + NAME + ", OUTPUT);", "analogWrite(" + NAME + ", 200);   // 0 stops, 255 is flat out"];
        }
      } else need("The motor is partly wired already. A motor goes between battery + and a transistor's drain, with the transistor's gate on a pin: see Check for what is wrong with it as it stands.");
    } else if (/^(battery_9v|battery_aa|coin_cell|k_battery)$/.test(t)) {
      if (free("-") && mcu) wire(key("-"), gnd(), "black", "Battery − → the board's ground: every supply in a circuit shares one ground.");
      need("Battery + is left for you: it goes to whatever this battery is for — the motors, or VIN to run the board from it.");
    } else {
      need("I don't have a standard way to wire a " + d.name.toLowerCase() + ": it depends what you want it to do. Ask the AI and say what it is for.");
    }
    out.ok = out.wires.length > 0;
    if (!out.ok && !out.notes.length) out.notes.push(me + " is already wired. Check finds anything wrong with it.");
    return out;
  };

  /* Carry a plan out on the document. Everything is checked again: a wire
   * to a leg that doesn't exist is dropped, and so is one that would only
   * join two legs that are already joined. Returns what was added. */
  C.applyTo = function (doc, sim, plan, anchorId) {
    var x = C.ctx(doc, sim), map = {}, added = { parts: [], wires: [] }, P = L.P;
    var anchor = x.byId[anchorId], ab = anchor ? L.boxOf(anchor) : L.boundsOf(doc), cx = ab.x, cy = ab.y + ab.h + 3 * P;
    (plan.parts || []).slice(0, 12).forEach(function (q) {
      var d = L.PARTS[q.type];
      if (!d || !q.id || map[q.id] || x.byId[q.id]) return;
      var np = { id: L.uid("p"), type: q.type, x: 0, y: 0, rot: 0, props: {} };
      Object.keys(q.props || {}).forEach(function (k) { if (d.props && k in d.props) np.props[k] = q.props[k]; });
      var b = L.boxOf(np);
      np.x = L.snap(cx - b.x); np.y = L.snap(cy - b.y);
      cx += b.w + 2 * P;
      map[q.id] = np; added.parts.push(np);
    });
    var find = function (ref) {
      var s = String(ref || ""), i = s.indexOf(":") >= 0 ? s.indexOf(":") : s.lastIndexOf("."), id = s.slice(0, i), pin = s.slice(i + 1), part = map[id] || x.byId[id];
      if (!part || i < 0 || !L.pinList(part).some(function (q) { return q.n === pin; })) return null;
      return { part: part, pin: pin, key: part.id + ":" + pin, isNew: !!map[id] };
    };
    (plan.wires || []).slice(0, 60).forEach(function (w) {
      var a = find(w.a), b = find(w.b);
      if (!a || !b || a.key === b.key) return;
      if (!a.isNew && !b.isNew && x.T.pins[a.key] && x.T.pins[b.key] && x.T.find(a.key) === x.T.find(b.key)) return;
      var col = /^#[0-9a-fA-F]{6}$/.test(w.color || "") ? w.color : (L.WIRE_COLORS[w.color] || L.WIRE_COLORS.yellow);
      added.wires.push({ id: L.uid("w"), a: { ref: a.key }, b: { ref: b.key }, color: col, pts: [] });
    });
    added.parts.forEach(function (p) { doc.parts.push(p); });
    added.wires.forEach(function (w) { doc.wires.push(w); });
    return added;
  };

  /* Carry out one of review()'s fixes. Returns a sentence, or "". */
  C.fix = function (doc, sim, fix) {
    var x = C.ctx(doc, sim);
    if (fix.resistor) {
      var w = doc.wires.filter(function (q) { return q.id === fix.resistor[0]; })[0], key = fix.resistor[1], led = x.split(key).part;
      if (!w || !led) return "";
      var b = L.boxOf(led), r = { id: L.uid("p"), type: "resistor", x: 0, y: 0, rot: 0, props: { ohms: 220 } }, rb = L.boxOf(r);
      r.x = L.snap(b.x - rb.x - rb.w - 2 * L.P); r.y = L.snap(b.y - rb.y - 3 * L.P);
      doc.parts.push(r);
      if (w.a.ref === key) w.a = { ref: r.id + ":1" }; else w.b = { ref: r.id + ":1" };
      w.pts = [];
      doc.wires.push({ id: L.uid("w"), a: { ref: r.id + ":2" }, b: { ref: key }, color: w.color, pts: [] });
      return "Put a 220 Ω resistor into the wire to the LED. At 5 V that is about 14 mA: bright, and safe for the pin.";
    }
    if (fix.swapPins) {
      var id = fix.swapPins[0], pa = id + ":" + fix.swapPins[1], pb = id + ":" + fix.swapPins[2];
      doc.wires.forEach(function (q) { ["a", "b"].forEach(function (e) { if (q[e].ref === pa) q[e] = { ref: pb }; else if (q[e].ref === pb) q[e] = { ref: pa }; }); });
      return "Swapped the wires on its two legs, which is the same as turning it round.";
    }
    if (fix.move) {
      var from = fix.move[0], old = fix.move[1], want = fix.move[2], mcu = x.split(old).part, target = null;
      if (want === "analog") { ANA.forEach(function (a) { if (!target && x.free(mcu.id + ":" + a)) target = a; }); } else if (x.free(mcu.id + ":" + want)) target = want;
      if (!target) return "";
      var moved = false;
      doc.wires.forEach(function (q) { ["a", "b"].forEach(function (e) { var o = e === "a" ? "b" : "a"; if (!moved && q[e].ref === old && q[o].ref === from) { q[e] = { ref: mcu.id + ":" + target }; q.pts = []; moved = true; } }); });
      if (!moved) doc.wires.forEach(function (q) { ["a", "b"].forEach(function (e) { if (!moved && q[e].ref === old) { q[e] = { ref: mcu.id + ":" + target }; q.pts = []; moved = true; } }); });
      return moved ? "Moved that wire to " + target + "." + (want === "analog" ? " In the program, read it with analogRead(" + target + ")." : "") : "";
    }
    if (fix.rewire) {
      var m = x.byId[fix.rewire];
      doc.wires = doc.wires.filter(function (q) { return (q.a.ref || "").split(":")[0] !== m.id && (q.b.ref || "").split(":")[0] !== m.id; });
      sim.load(doc);
      var plan = C.plan(doc, sim, m.id);
      if (!plan.ok) return "";
      C.applyTo(doc, sim, plan, m.id);
      return "Took the motor off the pin and rebuilt it properly: its own battery, a transistor to switch it, a diode to protect the transistor, and the pin now only controls the gate.";
    }
    if (fix.plan) {
      var pl = C.plan(doc, sim, fix.plan);
      if (!pl.ok) return "";
      C.applyTo(doc, sim, pl, fix.plan);
      return "Connected its power and ground.";
    }
    return "";
  };

  /* ============================================================= SWAP */

  /* What could this part be changed for? Same number of legs first, then
   * anything whose legs carry the same names as the ones in use. */
  C.swaps = function (doc, part) {
    var d = L.def(part);
    if (!d) return [];
    var kid = !!d.kid, mine = L.pinList(part).filter(function (q) { return !q.hole; }).map(function (q) { return q.n; });
    var used = {};
    doc.wires.forEach(function (w) { ["a", "b"].forEach(function (e) { var r = w[e].ref || ""; if (r.split(":")[0] === part.id) used[r.slice(r.indexOf(":") + 1)] = 1; }); });
    var out = [];
    L.PART_ORDER.forEach(function (t) {
      var o = L.PARTS[t];
      if (t === part.type || !!o.kid !== kid || (o.layer === "board" && !o.mcu) !== (d.layer === "board" && !d.mcu) || !!o.mcu !== !!d.mcu) return;
      var probe = { id: "t", type: t, x: 0, y: 0, rot: 0, props: {} }, theirs = L.pinList(probe).filter(function (q) { return !q.hole; }).map(function (q) { return q.n; });
      if (!theirs.length && mine.length) return;
      var byName = Object.keys(used).every(function (n) { return theirs.indexOf(n) >= 0; });
      var same = theirs.length === mine.length;
      if (!same && !byName) return;
      out.push({ type: t, name: o.name, cat: o.cat, close: o.cat === d.cat, byName: byName });
    });
    out.sort(function (a, b) { return (b.close ? 2 : 0) + (b.byName ? 1 : 0) - (a.close ? 2 : 0) - (a.byName ? 1 : 0); });
    return out;
  };

  /* Change a part's type in place. Wires follow to the leg of the same
   * name, or failing that the leg in the same position. */
  C.swap = function (doc, part, type) {
    var o = L.PARTS[type];
    if (!o) return null;
    var before = L.pinList(part).filter(function (q) { return !q.hole; }).map(function (q) { return q.n; });
    var oldName = L.def(part).name, keep = {};
    Object.keys(part.props || {}).forEach(function (k) { if (o.props && k in o.props && typeof o.props[k] === typeof part.props[k]) keep[k] = part.props[k]; });
    part.type = type; part.props = keep; delete part.cutPins;
    var after = L.pinList(part).filter(function (q) { return !q.hole; }).map(function (q) { return q.n; }), kept = 0, lost = 0;
    doc.wires = doc.wires.filter(function (w) {
      var ok = true;
      ["a", "b"].forEach(function (e) {
        var r = w[e].ref || "";
        if (r.split(":")[0] !== part.id) return;
        var pin = r.slice(r.indexOf(":") + 1), to = after.indexOf(pin) >= 0 ? pin : after[before.indexOf(pin)];
        if (to) { w[e] = { ref: part.id + ":" + to }; kept++; } else { ok = false; lost++; }
      });
      return ok;
    });
    ["joints", "cuts"].forEach(function (k) { if (doc[k]) Object.keys(doc[k]).forEach(function (key) { if (key.split(":")[0] === part.id) delete doc[k][key]; }); });
    return { from: oldName, to: o.name, kept: kept, lost: lost };
  };

  /* ============================================================== TIPS */

  C.TIPS = [
    "Wire the grounds first. A circuit with every ground joined and nothing else is half built; one with everything else and a ground missing does nothing at all.",
    "Red for +, black for ground, and any other colour for signals. You will thank yourself the first time something doesn't work and you can see the power wiring at a glance.",
    "One LED, one resistor. Two LEDs sharing a resistor share its current unevenly, and one is always dimmer.",
    "To choose an LED's resistor: (supply − LED voltage) ÷ current. For 5 V, a 2 V red LED and 15 mA that is 3 ÷ 0.015 = 200 Ω — so 220 Ω, the next size up.",
    "A pin is a signal, not a power supply. If something moves, heats or shines brightly, a transistor or relay does the switching and a battery does the work.",
    "Every coil kicks. Motors, relays and solenoids each need a diode across them, stripe towards +, or the spike when they switch off kills whatever switched them.",
    "Two power supplies, one ground. A battery for the motors and USB for the board is a good idea — as long as their minus sides are joined.",
    "Buttons need a home when nobody is pressing them. INPUT_PULLUP gives the pin one for free: wire the button to ground and read LOW as pressed.",
    "TX goes to RX. Whenever two things talk by serial, one's transmit is the other's receive: the wires always cross.",
    "Keep pins 0 and 1 free. They are the USB lead in disguise, and anything wired there fights the upload.",
    "Analog sensors on A0–A5, everything else on the numbered pins. And remember PWM — fading and speed control — only works on 3, 5, 6, 9, 10 and 11.",
    "Build it in stages and test each one. Wire the LED, run it. Add the sensor, print its readings. A fault in the last thing you added is easy to find; a fault somewhere in forty wires is not.",
    "Change wires with the power off. It takes a second, and most parts that die on a breadboard die from a wire brushing the wrong leg while live.",
    "Short wires, flat to the board. Long loops catch on things and pick up noise from motors.",
    "When nothing works, check power before logic: is there 5 V where there should be, and 0 V on every ground? Hover a leg with the power on to see.",
    "A servo draws most when it starts to move. If the board resets every time the arm swings, the servo wants its own supply.",
    "On a breadboard, a part's two legs must be in different rows. Both legs in the same row of five are joined underneath, and the part is shorted out.",
    "An electrolytic capacitor has a stripe down its minus side, and it matters: backwards, they fail with a bang.",
    "Read the part's blurb before you wire it. Thirty seconds knowing which leg is which saves the part.",
    "Give every wire a reason. If you can't say what a wire is for, it is probably the one causing the fault."
  ];

  C.PART_TIPS = {
    led: "Long leg to +, always through a resistor. 220 Ω is right for 5 V.",
    rgb_led: "Three LEDs in one case sharing a ground leg. Each colour needs its own resistor and its own PWM pin.",
    resistor: "No right way round. Read the stripes from the end furthest from the gold one.",
    capacitor_e: "The stripe marks the minus leg. Across a motor or a supply, it soaks up the dips.",
    potentiometer: "Ends to 5 V and ground, middle leg to an analog pin: the middle sweeps between the two as you turn.",
    button: "The legs are joined in pairs along the long sides. Use two legs on opposite corners and you cannot get it wrong.",
    motor: "Never on a pin. Battery + to one leg, the other leg to a transistor, a diode across it.",
    servo: "Three wires: brown to ground, red to 5 V, orange to any pin. No transistor needed — the driver is inside.",
    nmos: "Gate, drain, source, left to right with the writing facing you. Pin to gate through 220 Ω; load to drain; source to ground.",
    npn: "A small current into the base switches a big one from collector to emitter. Always a resistor on the base — about 1 kΩ.",
    diode: "Current flows towards the stripe. Across a motor it goes stripe-to-plus: backwards on purpose.",
    hcsr04: "Four legs: 5 V, TRIG, ECHO, ground. It needs 5 V — on 3.3 V it reads rubbish.",
    pir: "Give it half a minute after power-on to settle before you trust it.",
    tmp36: "Flat face towards you: +5 V, signal, ground. Get the outer two swapped and it gets very hot very quickly.",
    ldr: "It needs a partner: a 10 kΩ resistor to ground from the leg that goes to the analog pin.",
    lcd_i2c: "Only four wires thanks to I²C — but SDA must be A4 and SCL must be A5.",
    relay_module: "Two worlds: the pins side talks to the board, the screw terminals switch something else entirely. They are not connected, and that is the point.",
    hc05: "Its TXD goes to the board's receive pin and its RXD to the board's transmit: they cross. Use pins 10 and 11 with SoftwareSerial, not 0 and 1.",
    hc12: "Same wiring as Bluetooth. Both ends must be on the same channel, and each board needs its own program.",
    rf_rx: "No code needed to try it: each output goes HIGH while its fob button is held.",
    battery_aa: "Its minus must join the board's ground, or the transistor has nothing to switch against.",
    battery_9v: "9 V into VIN runs the board. 9 V into the 5 V pin ends the board.",
    arduino_uno: "Pins 3, 5, 6, 9, 10 and 11 can fade (PWM). A0–A5 can measure. 0 and 1 are the USB lead: leave them free.",
    buzzer: "An active buzzer just needs HIGH. A passive piezo needs tone() to make it sing.",
    piezo: "It plays whatever frequency tone() gives it — a tune, a siren, a click."
  };

  /* ============================================================ THE UI */

  function Coach(app) {
    var self = this;
    this.app = app;
    this.on = true;
    try { this.on = root.localStorage.getItem("chalklab.tips") !== "0"; } catch (e) {}
    this.tipN = Math.floor(Math.random() * C.TIPS.length);
    var wrap = document.querySelector(".bench-wrap");
    this.card = document.createElement("aside");
    this.card.className = "coach-card"; this.card.hidden = true;
    this.card.setAttribute("aria-live", "polite"); this.card.setAttribute("aria-label", "Wiring coach");
    wrap.appendChild(this.card);
    this.card.addEventListener("click", function (e) {
      var b = e.target.closest("[data-coach]");
      if (b) self.act(b.getAttribute("data-coach"));
    });
    var menu = document.querySelector(".view-menu");
    if (menu) {
      var lab = document.createElement("label");
      lab.className = "check";
      lab.innerHTML = '<input type="checkbox" id="lab-tips"' + (this.on ? " checked" : "") + '> Wiring tips as I work';
      menu.insertBefore(lab, menu.querySelector("#lab-mute"));
      lab.querySelector("input").addEventListener("change", function () {
        self.on = this.checked;
        try { root.localStorage.setItem("chalklab.tips", self.on ? "1" : "0"); } catch (e) {}
        if (!self.on) self.hide(); else self.say("tip", "Tip", C.TIPS[self.tipN], [["next", "Another tip"]]);
      });
    }
  }
  L.Coach.Card = Coach;

  Coach.prototype.x = function () { return C.ctx(this.app.doc, this.app.sim); };

  /* kind: tip | good | warn | bad | plan */
  Coach.prototype.say = function (kind, title, html, buttons, sticky) {
    if (!this.on && kind !== "plan") return;
    var b = (buttons || []).map(function (q) { return '<button type="button" data-coach="' + q[0] + '"' + (q[2] ? ' class="primary"' : '') + '>' + esc(q[1]) + '</button>'; }).join("");
    this.card.className = "coach-card " + kind;
    this.card.innerHTML = '<header><i aria-hidden="true">' + ({ good: "✓", warn: "!", bad: "✕", plan: "⚡", tip: "💡" }[kind] || "💡") + '</i><b>' + esc(title) + '</b><button type="button" data-coach="close" aria-label="Close">×</button></header>' +
      '<div class="coach-body">' + html + '</div>' + (b ? '<footer>' + b + '</footer>' : '');
    this.card.hidden = false;
    clearTimeout(this.t);
    var self = this;
    if (!sticky) this.t = setTimeout(function () { self.hide(); }, kind === "tip" ? 14000 : 11000);
  };
  Coach.prototype.hide = function () { this.card.hidden = true; clearTimeout(this.t); };

  Coach.prototype.act = function (what) {
    var app = this.app, self = this;
    if (what === "close") return this.hide();
    if (what === "next") { this.tipN = (this.tipN + 1) % C.TIPS.length; return this.say("tip", "Tip", esc(C.TIPS[this.tipN]), [["next", "Another tip"]]); }
    if (what === "do" && this.pending) return this.apply(this.pending.plan, this.pending.id, this.pending.reply);
    if (what === "ai" && this.pending) return this.askAI(this.pending.id);
    if (what === "wire" && this.offerId) return this.offer(this.offerId);
    if (what === "undo") { app.undo(); return this.hide(); }
    if (what.indexOf("fix:") === 0) {
      var issue = (this.issues || [])[+what.slice(4)];
      if (issue) this.fix(issue);
    }
    void self;
  };

  /* --------------------------------------------------- tips while wiring */

  Coach.prototype.wireStart = function (pin) {
    if (!this.on) return;
    var x = this.x(), tip = C.pinTip(x, pin);
    this.from = pin; this.targets = tip.targets; this.lastOver = null;
    /* what was already wrong before this wire, so only new mistakes are news */
    this.before = {};
    C.review(this.app.doc, this.app.sim).forEach(function (i) { this.before[i.code + i.part] = 1; }, this);
    if (tip.text) this.say("tip", tip.title, esc(tip.text) + (tip.targets.length ? '<p class="coach-sub">Green rings mark legs this one is usually joined to.</p>' : ''), null, true);
  };
  Coach.prototype.wireOver = function (pin) {
    if (!this.on || !this.from) return;
    var k = pin ? pin.key : null;
    if (k === this.lastOver) return;
    this.lastOver = k;
    if (!pin) return;
    var v = C.judge(this.x(), this.from, pin);
    if (v && v.why) this.say(v.v, v.v === "good" ? "Good" : v.v === "warn" ? "Careful" : "Don't", esc(v.why), null, true);
  };
  /* green rings on the legs worth aiming for, drawn with the wire itself */
  Coach.prototype.drawTargets = function (g) {
    if (!this.on || !this.from || !this.targets) return;
    var NS = "http://www.w3.org/2000/svg", from = this.from;
    this.targets.forEach(function (t) {
      if (t.key === from.key) return;
      var c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", t.x); c.setAttribute("cy", t.y); c.setAttribute("r", 8); c.setAttribute("class", "coach-target");
      g.appendChild(c);
    });
  };
  Coach.prototype.wireEnd = function () { if (this.from) { this.from = null; this.targets = null; this.hide(); } };

  /* A wire was just made: say whether it was right, and why. */
  Coach.prototype.wired = function (from, to) {
    var was = this.from || from;
    this.from = null; this.targets = null;
    if (!this.on) return;
    var x = this.x(), self = this;
    /* judge against the circuit as it was a moment ago: after the wire is
     * in, the two legs are one node and there is nothing left to compare */
    var v = this.lastVerdict(was, to);
    var before = this.before || {};
    var fresh = C.review(this.app.doc, this.app.sim).filter(function (i) { return !before[i.code + i.part]; });
    this.issues = fresh;
    if (fresh.length) {
      var i0 = fresh[0];
      this.say(i0.level === "danger" ? "bad" : "warn", i0.level === "danger" ? "Stop — check this" : "One thing to fix", esc(i0.msg), i0.fix ? [["fix:0", i0.fix.label, true]] : null, true);
      this.app.bench.flag([{ part: i0.part, level: i0.level === "danger" ? "danger" : "warn" }]);
    } else if (v && v.why) this.say(v.v, v.v === "good" ? "Good" : v.v === "warn" ? "Careful" : "Check this", esc(v.why));
    else this.hide();
    void x;
  };
  Coach.prototype.lastVerdict = function (a, b) {
    var x = this.x(), ra = x.split(a.key), rb = x.split(b.key);
    if (a.hole || b.hole || !ra.part || !rb.part) return null;
    var v = verdict(C.role(ra.part, ra.pin), C.role(rb.part, rb.pin), ra.pin, rb.pin);
    return v ? { v: v[0], why: v[1] } : null;
  };

  /* A part was dropped on the bench: what is it, and shall I wire it? */
  Coach.prototype.added = function (part) {
    if (!this.on || this.app.doc.mode === "kid") return;
    var d = L.def(part), tip = C.PART_TIPS[part.type] || (/^mod_/.test(part.type) ? "Four legs: 5 V, ground, a yes/no output (DO) and the measurement itself (AO). Use AO." : "");
    if (!d || (d.layer === "board" && !d.mcu)) return;
    var can = !d.mcu && C.plan(this.app.doc, this.app.sim, part.id).ok;
    this.offerId = part.id;
    if (tip || can) this.say("tip", d.name.replace(/ \(.+\)$/, ""), esc(tip || d.blurb || ""), can ? [["wire", "Wire it for me", true]] : null);
  };

  /* ----------------------------------------------------------- wire it */

  Coach.prototype.offer = function (partId) {
    var app = this.app, part = app.partById(partId);
    if (!part) return;
    var plan = C.plan(app.doc, app.sim, partId, { mcu: app.mcuId }), ref = L.refdes(app.doc), name = ref[partId] + " " + L.partTitle(part);
    var notes = plan.notes.map(function (n) { return '<p class="coach-sub">' + esc(n) + '</p>'; }).join("");
    this.pending = { id: partId, plan: plan };
    if (!plan.ok) {
      this.say("plan", "Wiring " + name, notes || "<p>Nothing to do.</p>", app.cfg.aiEnabled ? [["ai", "Ask the AI to wire it"]] : null, true);
      return;
    }
    var extra = plan.parts.length ? '<p class="coach-sub">Adds ' + plan.parts.map(function (q) { return L.PARTS[q.type].name.toLowerCase().replace(/ \(.+\)$/, "") + (q.props.ohms ? " " + L.si(q.props.ohms, "Ω") : ""); }).join(", ") + '.</p>' : '';
    this.say("plan", "Wiring " + name, '<ol>' + plan.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join("") + '</ol>' + extra + notes,
      [["do", "Wire it like this", true]].concat(app.cfg.aiEnabled ? [["ai", "Ask the AI instead"]] : []), true);
  };

  Coach.prototype.apply = function (plan, partId, reply) {
    var app = this.app, added = null, self = this;
    app.edit(function () { added = C.applyTo(app.doc, app.sim, plan, partId); });
    if (!added.wires.length && !added.parts.length) { this.say("warn", "Nothing changed", "<p>Every one of those connections was already made, or pointed at a leg that isn't there.</p>"); return; }
    app.bench.select({ kind: "part", id: partId });
    added.wires.forEach(function (w, i) { setTimeout(function () { app.bench.ripple(w.b.ref, null, "#7dffa8"); }, 60 * i); });
    app.sound("snap");
    var code = (plan.code || []).length ? '<p class="coach-sub">In your program:</p><pre>' + esc(plan.code.join("\n")) + '</pre>' : '';
    this.say("good", "Wired", '<p>' + added.wires.length + ' wire' + (added.wires.length === 1 ? "" : "s") + (added.parts.length ? ' and ' + added.parts.length + ' new part' + (added.parts.length === 1 ? "" : "s") : '') + ' added.' +
      (app.doc.pcb ? ' The circuit board is re-routed to match.' : '') + '</p>' + (reply ? '<div class="coach-ai">' + L.md(reply) + '</div>' : '') + code, [["undo", "Undo"]], true);
    this.pending = null;
  };

  /* Ask the AI for the wiring. Whatever it sends is checked leg by leg,
   * and if it sends nothing usable the built-in plan is offered instead. */
  Coach.prototype.askAI = function (partId, question) {
    var app = this.app, self = this, part = app.partById(partId);
    if (!part) return;
    var ref = L.refdes(app.doc), name = ref[partId] + " " + L.partTitle(part);
    this.say("plan", "Wiring " + name, '<p><span class="dots" aria-label="Thinking"><i></i><i></i><i></i></span> Asking the AI how to wire it into this circuit…</p>', null, true);
    var payload = { kind: "wire", mode: app.doc.mode, selected: partId, question: question || ("Wire " + name + " into this circuit correctly."), circuit: app.digest(), code: (app.doc.code || "").slice(0, 8000) };
    var local = function (why) { self.offer(partId); if (why) app.toast(why + " Here is the lab's own way of wiring it."); };
    var ask = L.aiTransport ? L.aiTransport(payload) : fetch(app.cfg.aiUrl, {
      method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": app.cfg.csrf }, body: JSON.stringify(payload)
    }).then(function (r) { return r.json().then(function (j) { if (r.status !== 200 || !j.ok) throw { friendly: j && j.error }; return j; }); });
    ask.then(function (j) {
      var w = j && j.wiring;
      if (!w || !Array.isArray(w.wires) || !w.wires.length) return local("The AI didn't send any wiring.");
      /* try it on a copy first: only wiring that passes the coach's own review is offered */
      var copy = JSON.parse(JSON.stringify({ parts: app.doc.parts, wires: app.doc.wires, mode: app.doc.mode })), sim = new L.Sim();
      copy = Object.assign(L.blankDoc(copy.mode), copy);
      sim.load(copy);
      var before = C.review(copy, sim).length, added = C.applyTo(copy, sim, w, partId);
      sim.load(copy);
      var after = C.review(copy, sim);
      if (!added.wires.length) return local("The AI's wiring pointed at legs that don't exist.");
      if (after.length > before) return local("The AI's wiring had a mistake in it (" + after[after.length - 1].msg.split(".")[0].toLowerCase() + ").");
      self.pending = { id: partId, plan: { parts: w.parts || [], wires: w.wires, code: j.code ? String(j.code).split("\n").slice(0, 14) : [] }, reply: j.reply };
      self.say("plan", "The AI's wiring for " + name, L.md(j.reply || "") + '<p class="coach-sub">' + added.wires.length + ' wire' + (added.wires.length === 1 ? "" : "s") + (added.parts.length ? ', ' + added.parts.length + ' new part' + (added.parts.length === 1 ? "" : "s") : '') + '. Checked against the lab\'s wiring rules: no problems found.</p>', [["do", "Wire it like this", true]], true);
    }, function (e) { local((e && e.friendly) || "The AI didn't answer."); });
  };

  Coach.prototype.fix = function (issue) {
    var app = this.app, said = "";
    app.edit(function () { said = C.fix(app.doc, app.sim, issue.fix); });
    if (!said) { app.undo(); this.say("warn", "Couldn't fix that automatically", "<p>" + esc(issue.msg) + "</p>"); return; }
    app.bench.flag([]);
    if (app.partById(issue.part)) app.bench.select({ kind: "part", id: issue.part });
    this.say("good", "Fixed", "<p>" + esc(said) + "</p>", [["undo", "Undo"]]);
    app.sound("win");
  };

  /* ------------------------------------------------------------- swap */

  Coach.prototype.swap = function (partId, type) {
    var app = this.app, part = app.partById(partId), res = null;
    if (!part || !L.PARTS[type]) return;
    var wasMcu = L.def(part).mcu;
    app.edit(function () { res = C.swap(app.doc, part, type); });
    if (!res) return;
    if (wasMcu) app.stopProgram();
    app.bench.select({ kind: "part", id: partId });
    var tip = C.PART_TIPS[type] || "";
    this.say(res.lost ? "warn" : "good", "Changed to " + res.to.replace(/ \(.+\)$/, ""),
      "<p>" + (res.kept ? res.kept + " wire end" + (res.kept === 1 ? "" : "s") + " followed it to the new legs." : "It had no wires to carry over.") +
      (res.lost ? " " + res.lost + " wire" + (res.lost === 1 ? " was" : "s were") + " removed because the new part has no leg to match." : "") + "</p>" +
      (tip ? '<p class="coach-sub">' + esc(tip) + '</p>' : ''), [["undo", "Undo"]].concat(C.plan(app.doc, app.sim, partId).ok ? [["wire", "Finish its wiring"]] : []));
    this.offerId = partId;
  };
})(typeof window !== "undefined" ? window : globalThis);
