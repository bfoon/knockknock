/* Chalk Circuit Lab — wiring a program to a board.
 *
 * The runtime asks the circuit what voltage is on a pin; the circuit asks
 * the runtime what each pin is doing. This file is the only place the two
 * meet, so the interpreter stays testable without any physics and the
 * physics without any program.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;

  /* Start `prog` on the microcontroller part `mcuId`. `on(kind, data)`
   * receives everything the runtime reports: lines, effects, serial
   * output, hints and errors. */
  L.Sim.prototype.attach = function (mcuId, prog, on) {
    var sim = this;
    var part = (sim.doc.parts || []).filter(function (p) { return p.id === mcuId; })[0];
    var kid = part && part.type === "k_brain";
    var rt = new L.MCU.Runtime(prog, {
      volts: function (num) { return sim.mcuVolts(mcuId, num); },
      echo: function (num) { return sim.echoDistance(mcuId, num); },
      floating: function (num) {
        /* nothing else on this pin's node, and nothing pulling it */
        if (kid) return false;
        var T = sim.topo;
        if (!T) return false;
        var key = mcuId + ":" + L.pinName(num);
        return (T.terminals[T.find(key)] || 0) < 2;
      },
      wall: function () { return sim.wall; },
      on: on
    });
    this.runtimes = {};
    this.runtimes[mcuId] = rt;
    rt.mcuId = mcuId;
    rt.start(this.t);
    var prev = this.onTick;
    this.onTick = function (t) { rt.advance(t, sim.wallClock ? sim.wallClock() : undefined); };
    return rt;
  };

  L.Sim.prototype.detach = function () {
    for (var k in this.runtimes) this.runtimes[k].stop();
    this.runtimes = {};
    this.onTick = null;
  };

  /* The first microcontroller on the bench — the one the program runs on. */
  L.firstMcu = function (doc) {
    var list = (doc.parts || []).filter(function (p) { var d = L.def(p); return d && d.mcu; });
    return list[0] || null;
  };
})(typeof window !== "undefined" ? window : globalThis);
