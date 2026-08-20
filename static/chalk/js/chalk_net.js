/* Chalk — socket with reconnect, heartbeat and an outbound queue.
 * window.ChalkNet(code, { onOpen, onMessage, onState })
 * state is one of: "connecting" | "live" | "offline" | "denied"
 */
(function (global) {
  "use strict";

  function ChalkNet(code, opts) {
    this.code = code;
    this.opts = opts || {};
    this.queue = [];
    this.tries = 0;
    this.state = "connecting";
    this.denied = false;
    this.connect();
    var self = this;
    this.hb = setInterval(function () { self.send({ t: "ping" }); }, 25000);
    global.addEventListener("online", function () { self.connect(); });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) self.connect();
    });
  }

  ChalkNet.prototype._setState = function (s) {
    if (this.state === s) return;
    this.state = s;
    if (this.opts.onState) this.opts.onState(s);
  };

  ChalkNet.prototype.connect = function () {
    if (this.denied) return;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    var proto = location.protocol === "https:" ? "wss://" : "ws://";
    var self = this;
    this._setState(this.tries ? "connecting" : "connecting");

    var ws = new WebSocket(proto + location.host + "/ws/chalk/" + this.code + "/");
    this.ws = ws;

    ws.onopen = function () {
      self.tries = 0;
      self._setState("live");
      if (self.opts.onOpen) self.opts.onOpen();
      var q = self.queue;
      self.queue = [];
      q.forEach(function (m) { self.send(m); });
    };

    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.t === "pong") return;
      if (msg.t === "denied") {
        self.denied = true;
        self._setState("denied");
      }
      if (self.opts.onMessage) self.opts.onMessage(msg);
    };

    ws.onclose = function () {
      if (self.denied) return;
      self._setState("offline");
      self.tries = Math.min(self.tries + 1, 8);
      setTimeout(function () { self.connect(); }, 400 * self.tries);
    };

    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  };

  /* `drop` marks a frame as safe to throw away when offline — mid-stroke
   * points and laser moves are worthless by the time we reconnect. */
  ChalkNet.prototype.send = function (msg, drop) {
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(msg)); return true; } catch (e) {}
    }
    if (!drop && this.queue.length < 500) this.queue.push(msg);
    return false;
  };

  global.ChalkNet = function (code, opts) { return new ChalkNet(code, opts); };
})(window);
