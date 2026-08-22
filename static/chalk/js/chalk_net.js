/* Chalk — socket with reconnect, heartbeat and an outbound queue.
 * window.ChalkNet(code, { onOpen, onMessage, onState, onDenied })
 * state is one of: "connecting" | "live" | "offline" | "denied"
 */
(function (global) {
  "use strict";

  var HEARTBEAT_MS = 25000;
  var MAX_TRIES = 8;
  var BASE_BACKOFF_MS = 400;
  var QUEUE_LIMIT = 500;

  /* Denial reasons the client can recover from by retrying. "expired",
   * "not_owner" and "bad_role" are permanent and latch; "timeout" is a
   * handshake that got lost and is worth one more go. */
  var RETRYABLE = { timeout: 1 };

  function ChalkNet(code, opts) {
    this.code = code;
    this.opts = opts || {};
    this.queue = [];
    this.tries = 0;
    this.state = "connecting";
    this.denied = false;
    this.deniedCode = "";
    this.retriedDenial = false;
    this.stopped = false;
    this.timer = null;

    var self = this;
    this.connect();
    this.hb = setInterval(function () {
      /* `true` = droppable. Heartbeats used to queue while offline, so a
       * phone in a tunnel banked one ping every 25s and then fired the whole
       * backlog the moment it reconnected. */
      self.send({ t: "ping" }, true);
    }, HEARTBEAT_MS);

    global.addEventListener("online", function () {
      self.tries = 0;
      self.connect();
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) self.connect();
    });
    global.addEventListener("pagehide", function () { self.stop(); });
  }

  ChalkNet.prototype._setState = function (s) {
    if (this.state === s) return;
    this.state = s;
    if (this.opts.onState) this.opts.onState(s, this.deniedCode);
  };

  ChalkNet.prototype.stop = function () {
    this.stopped = true;
    clearInterval(this.hb);
    clearTimeout(this.timer);
    try { if (this.ws) this.ws.close(); } catch (e) {}
  };

  ChalkNet.prototype.connect = function () {
    if (this.denied || this.stopped) return;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    clearTimeout(this.timer);

    var proto = location.protocol === "https:" ? "wss://" : "ws://";
    var self = this;
    /* Was `this.tries ? "connecting" : "connecting"` — both arms identical,
     * so the phone never showed "Reconnecting…" during backoff. */
    this._setState(this.tries ? "offline" : "connecting");

    var ws;
    try {
      ws = new WebSocket(proto + location.host + "/ws/chalk/" + this.code + "/");
    } catch (e) {
      this._retry();
      return;
    }
    this.ws = ws;

    ws.onopen = function () {
      if (self.ws !== ws) return;
      self.tries = 0;
      self._setState("live");
      /* hello goes first, then anything that piled up while we were away. */
      if (self.opts.onOpen) self.opts.onOpen();
      var q = self.queue;
      self.queue = [];
      q.forEach(function (m) { self.send(m); });
    };

    ws.onmessage = function (ev) {
      if (self.ws !== ws) return;
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.t === "pong") return;
      /* Moved handwriting is applied here, not only in the page's own
       * handler, so the projector follows it whether or not chalk_stage.js
       * knows these frames exist. Applying twice is a no-op — see
       * ChalkInk.applyInkFrame. */
      if (global.ChalkInk && global.ChalkInk.applyInkFrame) {
        try { global.ChalkInk.applyInkFrame(msg); } catch (err) {}
      }
      if (global.ChalkEls && global.ChalkEls.applyElFrame) {
        try { global.ChalkEls.applyElFrame(msg); } catch (err) {}
      }
      if (msg.t === "denied") {
        var reason = msg.code || "denied";
        if (RETRYABLE[reason] && !self.retriedDenial) {
          /* One transient handshake failure should not brick the phone for
           * the rest of the lesson. */
          self.retriedDenial = true;
          self.queue = [];
          setTimeout(function () { self.connect(); }, 600);
          return;
        }
        self.denied = true;
        self.deniedCode = reason;
        self.queue = [];
        clearInterval(self.hb);
        self._setState("denied");
        if (self.opts.onDenied) self.opts.onDenied(msg);
      }
      if (self.opts.onMessage) self.opts.onMessage(msg);
    };

    ws.onclose = function () {
      if (self.ws !== ws) return;
      if (self.denied || self.stopped) return;
      self._setState("offline");
      self._retry();
    };

    ws.onerror = function () { try { ws.close(); } catch (e) {} };
  };

  ChalkNet.prototype._retry = function () {
    var self = this;
    this.tries = Math.min(this.tries + 1, MAX_TRIES);
    /* Jitter, so a server restart does not bring every board back in
     * lockstep and knock it over again. */
    var wait = BASE_BACKOFF_MS * this.tries * (0.7 + Math.random() * 0.6);
    clearTimeout(this.timer);
    this.timer = setTimeout(function () { self.connect(); }, wait);
  };

  /* `drop` marks a frame as safe to throw away when offline — mid-stroke
   * points, laser moves and heartbeats are worthless by the time we
   * reconnect. */
  ChalkNet.prototype.send = function (msg, drop) {
    if (this.denied || this.stopped) return false;
    if (this.ws && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(msg)); return true; } catch (e) {}
    }
    if (!drop && this.queue.length < QUEUE_LIMIT) this.queue.push(msg);
    return false;
  };

  global.ChalkNet = function (code, opts) { return new ChalkNet(code, opts); };
})(window);
