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

  /* Start `prog` on the microcontroller part `mcuId`, alongside any other
   * boards already running. `on(kind, data)` receives everything that
   * runtime reports: lines, effects, serial output, hints and errors. */
  L.Sim.prototype.attach = function (mcuId, prog, on) {
    var sim = this;
    var part = (sim.doc.parts || []).filter(function (p) { return p.id === mcuId; })[0];
    var kid = part && part.type === "k_brain";
    if (this.runtimes[mcuId]) this.runtimes[mcuId].stop();
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
      uart: function (pin, text) { if (sim.uartOut) sim.uartOut(mcuId, pin, text); },
      wall: function () { return sim.wall; },
      on: on
    });
    this.runtimes[mcuId] = rt;
    rt.mcuId = mcuId;
    rt.start(this.t);
    var runtimes = this.runtimes;
    this.onTick = function (t) {
      var now = sim.wallClock ? sim.wallClock() : undefined;
      for (var id in runtimes) runtimes[id].advance(t, now);
    };
    return rt;
  };

  L.Sim.prototype.detach = function () {
    for (var k in this.runtimes) this.runtimes[k].stop();
    this.runtimes = {};
    this.onTick = null;
    this.uq = [];
  };

  /* Every microcontroller on the bench, in document order. */
  L.mcus = function (doc) {
    return (doc.parts || []).filter(function (p) { var d = L.def(p); return d && d.mcu; });
  };

  /* The first microcontroller on the bench — the one the program runs on. */
  L.firstMcu = function (doc) {
    var list = (doc.parts || []).filter(function (p) { var d = L.def(p); return d && d.mcu; });
    return list[0] || null;
  };
})(typeof window !== "undefined" ? window : globalThis);
