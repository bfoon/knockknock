/* Chalk Circuit Lab — kid mode: missions and Sparky.
 *
 * A mission is only done when the circuit really does the thing. "Be the
 * boss of the light" is not finished by putting a switch on the table: the
 * bulb has to be seen lit with the switch closed and dark with it open. That
 * is the lesson, so that is the check.
 *
 * Sparky is a friendly electron who lives in the corner of the bench. He
 * reacts to what the simulator sees — a short, a pop, a first light — and
 * says something useful about it, in words an eight-year-old can use.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;

  function of(app, type) { return app.doc.parts.filter(function (p) { return p.type === type; }); }
  function st(app, p) { return (app.sim.state && app.sim.state[p.id]) || {}; }
  function lit(app, p) { return st(app, p).b > 0.35; }

  var MISSIONS = [
    { id: "light", title: "Light it up!", goal: "Make a bulb glow.",
      hints: ["Drag a battery and a light bulb onto the table.", "Join the battery's red + post to one post of the bulb.", "Join the bulb's other post back to the battery's black − post. Electricity needs a full loop!", "Press the power button at the top."],
      check: function (app) { return of(app, "k_bulb").concat(of(app, "bulb")).some(function (b) { return lit(app, b); }); },
      win: "You made a circuit! Electricity flows out of the battery, through the bulb's thin wire — which gets so hot it glows — and back again." },
    { id: "switch", title: "Be the boss of the light", goal: "Use a knife switch to turn the bulb on AND off.",
      hints: ["Put a knife switch into your loop, between the battery and the bulb.", "Click the switch to close it: the bulb should glow.", "Click it again to open it: the gap stops the electricity."],
      watch: function (app, m) {
        var sw = of(app, "k_switch")[0], bulbs = of(app, "k_bulb");
        if (!sw || !bulbs.length || !app.running) return;
        var on = !!(sw.props && sw.props.on), anyLit = bulbs.some(function (b) { return lit(app, b); });
        if (on && anyLit) m.seenOn = true;
        if (!on && !anyLit && m.seenOn) m.seenOff = true;
      },
      check: function (app, m) { return m.seenOn && m.seenOff; },
      win: "A switch is a gate in the loop. Closed: the path is complete. Open: there's a gap, and electricity can't jump it." },
    { id: "spin", title: "Make it spin", goal: "Get the fan motor turning.",
      hints: ["Make a loop with a battery and the fan motor.", "Try swapping its two wires — what happens to the fan?"],
      check: function (app) { return of(app, "k_motor").some(function (m) { return Math.abs(st(app, m).w || 0) > 200; }); },
      win: "Inside the motor, electricity makes a magnet that pushes and pulls the spinning part round. Swap the wires and it spins the other way!" },
    { id: "bell", title: "Ding dong!", goal: "Make a doorbell: the buzzer only beeps while the button is held.",
      hints: ["You need a battery, a press button and a buzzer in one loop.", "The buzzer's red post goes towards the battery's +.", "Hold the button down — then let go."],
      watch: function (app, m) {
        var btn = of(app, "k_button")[0], bz = of(app, "k_buzzer")[0];
        if (!btn || !bz || !app.running) return;
        var down = !!app.sim.pressed[btn.id], beep = !!st(app, bz).sound;
        if (down && beep) m.rang = true;
        if (!down && !beep && m.rang) m.quiet = true;
      },
      check: function (app, m) { return m.rang && m.quiet; },
      win: "A push button only closes the loop while you press it. That's how real doorbells work." },
    { id: "two", title: "Two lights, one battery", goal: "Light two bulbs at the same time. Can you make them both bright?",
      hints: ["Two bulbs in one big loop (one after the other) is called series.", "Now try giving each bulb its own loop to the battery — that's parallel. Which is brighter?"],
      check: function (app) { return of(app, "k_bulb").filter(function (b) { return lit(app, b); }).length >= 2; },
      win: "In series the bulbs share the battery's push, so they're dimmer. In parallel each gets the full push — bright, but the battery works twice as hard." },
    { id: "blink", title: "Robo Brain says blink", goal: "Program the Robo Brain to blink a light on and off three times.",
      hints: ["Put the Robo Brain and an LED light on the table.", "Wire OUT 1 to the light's red + post, and the light's − post to a − post on the brain.", "Use blocks: turn OUT 1 ON, wait, turn OUT 1 OFF, wait.", "Press Go!"],
      watch: function (app, m) {
        if (!app.rt || !app.rt.running) return;
        of(app, "k_led").forEach(function (l) {
          var on = lit(app, l);
          if (m.last != null && on !== m.last) m.flips = (m.flips || 0) + 1;
          m.last = on;
        });
      },
      check: function (app, m) { return (m.flips || 0) >= 6; },
      win: "You wrote a program! The Robo Brain follows your blocks one at a time, very fast — the waits are what let you see the blinking." },
    { id: "traffic", title: "Traffic light", goal: "Make red, yellow and green lights take turns.",
      hints: ["Three LED lights, each wired to its own OUT post and back to −.", "Set their colours in the Inspect tab.", "Blocks: red ON, wait, red OFF, then the same for yellow and green."],
      watch: function (app, m) {
        if (!app.rt || !app.rt.running) return;
        m.seen = m.seen || {};
        of(app, "k_led").forEach(function (l) { if (lit(app, l)) m.seen[L.propsOf(l).color] = 1; });
      },
      check: function (app, m) { return m.seen && m.seen.red && m.seen.yellow && m.seen.green; },
      win: "Real traffic lights run a program just like yours — with much longer waits!" },
    { id: "night", title: "Night light", goal: "Make a light that turns itself on when it gets dark.",
      hints: ["The light sensor is the Robo Brain's eye: wire it from + to EYE.", "Use an 'if EYE sees dark' block: turn the light ON, otherwise OFF.", "Use the Lights menu at the top to make the room dark."],
      watch: function (app, m) {
        var eye = of(app, "k_ldr")[0], led = of(app, "k_led")[0];
        if (!eye || !led || !app.rt || !app.rt.running) return;
        var dark = L.propsOf(eye).light < 30, on = lit(app, led);
        if (dark && on) m.darkOn = true;
        if (!dark && !on) m.brightOff = true;
      },
      check: function (app, m) { return m.darkOn && m.brightOff; },
      win: "Your Robo Brain is making a decision! Street lights and phone screens use light sensors in just the same way." }
  ];
  L.MISSIONS = MISSIONS;

  function Kid(app) {
    this.app = app;
    this.pane = document.getElementById("pane-mission");
    this.done = {};
    this.memo = {};
    try { this.done = JSON.parse(root.localStorage.getItem("chalklab.missions") || "{}"); } catch (e) {}
    this.current = null;
    this.buildSparky();
    this.render();
    this.lastSay = 0;
    this.said = {};
  }
  L.Kid = Kid;

  Kid.prototype.save = function () { try { root.localStorage.setItem("chalklab.missions", JSON.stringify(this.done)); } catch (e) {} };

  Kid.prototype.render = function () {
    var self = this, n = Object.keys(this.done).length;
    var h = '<div class="missions"><p class="stars" aria-label="' + n + ' of ' + MISSIONS.length + ' missions done">' +
      MISSIONS.map(function (m) { return self.done[m.id] ? "★" : "☆"; }).join("") + '</p>';
    if (this.current) {
      var m = this.current, step = this.hintStep || 0;
      h += '<article class="mission now"><h3>' + L.esc(m.title) + '</h3><p class="goal">' + L.esc(m.goal) + '</p>' +
        '<ol class="hints">' + m.hints.slice(0, step + 1).map(function (t) { return '<li>' + L.esc(t) + '</li>'; }).join("") + '</ol>' +
        (step < m.hints.length - 1 ? '<button type="button" data-more="1">Give me a clue</button>' : '') +
        '<button type="button" data-back="1">All missions</button></article>';
    } else {
      h += MISSIONS.map(function (m, i) {
        return '<button type="button" class="mission' + (self.done[m.id] ? " done" : "") + '" data-m="' + i + '"><b>' + (self.done[m.id] ? "★ " : "") + L.esc(m.title) + '</b><span>' + L.esc(m.goal) + '</span></button>';
      }).join("");
    }
    h += '</div>';
    this.pane.innerHTML = h;
    this.pane.querySelectorAll("[data-m]").forEach(function (b) {
      b.addEventListener("click", function () { self.start(MISSIONS[+b.getAttribute("data-m")]); });
    });
    var more = this.pane.querySelector("[data-more]");
    if (more) more.addEventListener("click", function () { self.hintStep = (self.hintStep || 0) + 1; self.render(); });
    var back = this.pane.querySelector("[data-back]");
    if (back) back.addEventListener("click", function () { self.current = null; self.render(); });
  };

  Kid.prototype.start = function (m) {
    this.current = m; this.hintStep = 0; this.memo = {};
    this.render();
    this.say(m.goal + " " + m.hints[0], "think", true);
  };

  /* Called a few times a second. */
  Kid.prototype.tick = function () {
    var app = this.app, m = this.current;
    if (m) {
      if (m.watch) m.watch(app, this.memo);
      if (app.running && m.check(app, this.memo)) this.win(m);
    }
    this.react();
  };

  Kid.prototype.win = function (m) {
    var first = !this.done[m.id];
    this.done[m.id] = true; this.save();
    this.current = null;
    this.render();
    this.say((first ? "Mission complete! " : "You did it again! ") + m.win, "happy", true);
    this.confetti();
    this.app.sound("win");
  };

  /* Sparky watches the simulator and pipes up — once per kind of thing. */
  Kid.prototype.react = function () {
    var app = this.app, now = Date.now();
    if (!app.running) return;
    var w = app.sim.warnings || [];
    var short = w.filter(function (x) { return x.code === "short"; })[0];
    if (short && this.once("short", 20000)) return this.say("Whoa, hot hot hot! That's a short circuit: the electricity found a shortcut straight back to the battery without going through anything. Take that wire out!", "ouch", true);
    var rev = w.filter(function (x) { return x.code === "reverse"; })[0];
    if (rev && this.once("reverse", 30000)) return this.say("Something is the wrong way round. LEDs and buzzers are one-way streets: red post towards the battery's +.", "think", true);
    var burnt = w.filter(function (x) { return x.code === "burnt"; })[0];
    if (burnt && this.once("burnt", 30000)) return this.say("Pop! That had too much electricity. Pick it and press 'Replace it' — then add a slow-down block.", "ouch", true);
    var anyLight = of(app, "k_bulb").concat(of(app, "k_led")).some(function (b) { return lit(app, b); });
    if (anyLight && this.once("firstlight", 1e9)) return this.say("It's glowing! Look at the little electrons zooming round the wires.", "happy");
    if (now - this.lastSay > 40000 && this.once("idle" + Math.floor(now / 60000), 60000)) {
      var tips = ["Hover over a wire while the power is on to see how much electricity is flowing.",
                  "Try the Lights menu at the top — make it dark and watch the lights glow.",
                  "Click the Missions tab for a challenge!",
                  "Switch Show charges to electrons: real electrons actually flow from − to +!"];
      this.say(tips[Math.floor(Math.random() * tips.length)], "think");
    }
  };
  Kid.prototype.once = function (key, ms) {
    var t = this.said[key];
    if (t && Date.now() - t < ms) return false;
    this.said[key] = Date.now();
    return true;
  };

  /* ------------------------------------------------------------- Sparky */

  var FACES = {
    happy: '<path d="M-9 4q9 9 18 0" stroke="#5a3a00" stroke-width="3" fill="none" stroke-linecap="round"/>',
    think: '<path d="M-7 6h12" stroke="#5a3a00" stroke-width="3" stroke-linecap="round"/>',
    ouch: '<ellipse cx="0" cy="6" rx="5" ry="6" fill="#5a3a00"/>'
  };
  Kid.prototype.buildSparky = function () {
    var host = document.getElementById("bench");
    var box = document.createElement("div");
    box.className = "sparky kid-only";
    box.innerHTML =
      '<p class="sparky-say" id="sparky-say" role="status" aria-live="polite" hidden></p>' +
      '<button type="button" class="sparky-me" aria-label="Sparky — click for a tip">' +
        '<svg viewBox="-40 -46 80 86" width="78" height="84" aria-hidden="true">' +
          '<path d="M-6 -30l10 -14l-2 10l9 -4l-8 12" fill="#ffcf3a" stroke="#c48a00" stroke-width="2" stroke-linejoin="round"/>' +
          '<circle r="27" fill="#ffd84a" stroke="#c48a00" stroke-width="3"/>' +
          '<circle cx="-9" cy="-10" r="8" fill="#fff"/><circle cx="9" cy="-10" r="8" fill="#fff"/>' +
          '<circle class="pupil" cx="-8" cy="-9" r="4" fill="#2a1a00"/><circle class="pupil" cx="10" cy="-9" r="4" fill="#2a1a00"/>' +
          '<g class="mouth">' + FACES.happy + '</g>' +
          '<circle cx="-17" cy="2" r="4" fill="#ff9a6a" opacity=".6"/><circle cx="17" cy="2" r="4" fill="#ff9a6a" opacity=".6"/>' +
          '<path d="M-12 26l-6 10M12 26l6 10" stroke="#c48a00" stroke-width="4" stroke-linecap="round"/>' +
        '</svg></button>';
    host.appendChild(box);
    this.box = box;
    var self = this;
    box.querySelector(".sparky-me").addEventListener("click", function () {
      if (self.current) { self.hintStep = Math.min(self.current.hints.length - 1, (self.hintStep || 0) + 1); self.render(); self.say(self.current.hints[self.hintStep], "think", true); }
      else self.say(L.describe(self.app.doc, self.app.sim).split("\n")[0] + " Want a challenge? Open the Missions tab!", "happy", true);
    });
  };
  Kid.prototype.say = function (text, mood, force) {
    if (this.app.doc.mode !== "kid") return;
    var b = document.getElementById("sparky-say");
    if (!b) return;
    b.textContent = text;
    b.hidden = false;
    this.box.querySelector(".mouth").innerHTML = FACES[mood || "happy"];
    this.box.classList.remove("bounce"); void this.box.offsetWidth; this.box.classList.add("bounce");
    this.lastSay = Date.now();
    clearTimeout(this.hideT);
    this.hideT = setTimeout(function () { b.hidden = true; }, Math.max(6000, text.length * 75));
  };
  Kid.prototype.confetti = function () {
    var host = document.getElementById("bench"), cols = ["#ffd84a", "#ff6a5a", "#5ad1ff", "#7dff8a", "#c58bff"];
    for (var i = 0; i < 60; i++) {
      var s = document.createElement("i");
      s.className = "confetti";
      s.style.left = (10 + Math.random() * 80) + "%";
      s.style.background = cols[i % cols.length];
      s.style.animationDelay = (Math.random() * 0.4) + "s";
      s.style.setProperty("--drift", (Math.random() * 160 - 80) + "px");
      host.appendChild(s);
      setTimeout(function (n) { return function () { n.remove(); }; }(s), 2600);
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
