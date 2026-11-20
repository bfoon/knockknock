/* Chalk Circuit Lab — the drone drawer.
 *
 * Flight sensors: the IMU (MPU-6050 gyroscope + accelerometer), a
 * barometer (BMP280), a compass (QMC5883L), a GPS (NEO-6M, real NMEA on
 * its TX pin), an airspeed / pitot sensor (MS4525DO) and a laser
 * rangefinder (VL53L0X). The ultrasonic HC-SR04 in the Sensors drawer is
 * the sonar rangefinder.
 *
 * Drone: a LiPo battery that sags and empties, a power module that
 * measures it, an ESC with its brushless motor (it arms like a real one),
 * an RC receiver (six PWM channels for pulseIn()) and a whole X-frame
 * quadcopter — four ESCs and motors on a frame that really flies.
 *
 * Ground station: a primary flight display / FPV on-screen display that
 * shows the live telemetry, and an ADS-B receiver that hears the manned
 * aircraft around you.
 *
 * The quadcopter is a rigid body: four thrusts, their torques, gravity,
 * drag, wind and gusts, integrated every simulated millisecond. Nothing
 * holds it level but the program. Each flight sensor rides on it when one
 * is on the bench (its "On the drone" box ticked) and reads what the body
 * is really doing, through the sensor's own faults: gyro bias, vibration,
 * barometer noise, magnetic interference from the motor current, GPS
 * wander. Without a quadcopter each sensor follows its own sliders.
 *
 * How the programs reach them (lab_drone.js has the Arduino libraries):
 *   sim.flight                     the quadcopter's state this millisecond
 *   sim.i2cFor(mcuId, type)        a powered I²C sensor on that board's A4/A5
 *   sim.pulseWidthOn(mcuId, pin)   an RC receiver channel on that pin, in µs
 *   sim.servoUsOn(node)            the servo pulse a board puts on that node
 *
 * Axes, as on the chip: X forward, Y left, Z up. Attitude in the flight
 * state is roll (right side down +), pitch (nose up +) and yaw (the
 * compass heading, clockwise from north). Positions are metres north,
 * east and up from where it took off.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var P = L.P, add = L.addPart, S = L.svg, text = S.text, lead = S.lead, shadow = S.shadow;
  var MODELS = L.MODELS, Sim = L.Sim, K = L.SimKit;
  var Rr = K.R, Vs = K.Vs, setV = K.setV, setR = K.setR, vAcross = K.vAcross, iThrough = K.iThrough, smooth = K.smooth, warn = K.warn;
  var clamp = L.clamp;
  var D2R = Math.PI / 180, R2D = 180 / Math.PI, G = 9.81;
  var D = L.Drone = {};

  /* ============================================================ HELPERS */

  function dtOf(ctx) { return ctx.dt > 0 && isFinite(ctx.dt) ? ctx.dt : 0.016; }
  function off(dev) { setR(dev, 1e8); }
  function fx(v, d) { return (+v).toFixed(d == null ? 1 : d); }
  function rect(x, y, w, h, rx, fill, extra) { return '<rect x="' + fx(x) + '" y="' + fx(y) + '" width="' + fx(w) + '" height="' + fx(h) + '" rx="' + (rx || 0) + '" fill="' + fill + '"' + (extra || "") + '/>'; }
  function board(x, y, w, h, fill, edge) { return shadow(x, y, w, h, 4) + rect(x, y, w, h, 4, fill, ' stroke="' + edge + '" stroke-width="1.5"'); }
  function header(names, col) {
    var s = "";
    names.forEach(function (nm, i) { var x = i * P; s += lead(x, 0, x, -0.5 * P) + text(x, -0.95 * P, nm, 6, col || "#dfe9ff", { rot: -90 }); });
    return s;
  }
  function ledG(name, x, y, r, offFill) { return '<g data-live="' + name + '"><circle cx="' + fx(x) + '" cy="' + fx(y) + '" r="' + (r || 3.5) + '" fill="' + (offFill || "#5a1a1a") + '"/></g>'; }
  function setText(g, t) { if (g && g.firstChild && g.firstChild.textContent !== t) g.firstChild.textContent = t; }
  function chip(x, y, w, h, label) { return rect(x, y, w, h, 1.5, "#1b1b1d", ' stroke="#000"') + (label ? text(x + w / 2, y + h / 2, label, 5.5, "#9aa1a6", { weight: 700 }) : ""); }
  /* a little noise source that wanders instead of jumping: gusts, GPS drift */
  function wander(m, key, sigma, tau, dt) {
    var v = m[key] || 0, k = Math.min(1, dt / tau);
    v += -v * k + sigma * Math.sqrt(2 * k) * gauss();
    m[key] = v;
    return v;
  }
  function gauss() { var u = 1 - Math.random(), v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function wrap360(a) { a %= 360; return a < 0 ? a + 360 : a; }
  function wrap180(a) { a = wrap360(a); return a > 180 ? a - 360 : a; }
  D.wrap360 = wrap360; D.wrap180 = wrap180;

  /* NED world vector -> FRD body vector, for roll, pitch, yaw in degrees */
  function toBody(rollD, pitchD, yawD, v) {
    var f = rollD * D2R, t = pitchD * D2R, p = yawD * D2R;
    var cf = Math.cos(f), sf = Math.sin(f), ct = Math.cos(t), st = Math.sin(t), cp = Math.cos(p), sp = Math.sin(p);
    var r11 = ct * cp, r12 = sf * st * cp - cf * sp, r13 = cf * st * cp + sf * sp;
    var r21 = ct * sp, r22 = sf * st * sp + cf * cp, r23 = cf * st * sp - sf * cp;
    var r31 = -st, r32 = sf * ct, r33 = cf * ct;
    return [r11 * v[0] + r21 * v[1] + r31 * v[2], r12 * v[0] + r22 * v[1] + r32 * v[2], r13 * v[0] + r23 * v[1] + r33 * v[2]];
  }
  D.toBody = toBody;

  /* Where a board's pin sits, and the I²C sensors on its A4 (SDA) / A5 (SCL). */
  function partsOfType(sim, type) { return sim.topo ? sim.topo.inst.filter(function (it) { return it.part.type === type; }) : []; }
  function nodeOfMcuPin(sim, mcuId, num) {
    var node = 0;
    if (sim.topo) sim.topo.inst.forEach(function (it) { if (it.part.id === mcuId && it.m.pins && it.m.pins[num]) node = it.m.pins[num].n[0]; });
    return node;
  }
  Sim.prototype.i2cFor = function (mcuId, type) {
    var sda = nodeOfMcuPin(this, mcuId, 18), scl = nodeOfMcuPin(this, mcuId, 19), self = this, hit = null;
    if (!sda || !scl) return null;
    partsOfType(this, type).forEach(function (it) {
      var st = self.state[it.part.id] || {};
      if (!hit && st.on && it.m.sda.n[0] === sda && it.m.scl.n[0] === scl) hit = { id: it.part.id, st: st, props: L.propsOf(it.part) };
    });
    return hit;
  };
  /* The servo pulse a running board puts on this node, in microseconds. */
  Sim.prototype.servoUsOn = function (node) {
    var list = this.mcuPinsOnNode(node);
    for (var i = 0; i < list.length; i++) {
      var rt = this.runtimes[list[i].id];
      if (rt && rt.running && rt.servoUs && rt.servoUs[list[i].num] != null) return rt.servoUs[list[i].num];
    }
    return null;
  };

  /* The drone the sensors ride on: the quadcopter's state, if one is flying
   * on this bench and the sensor is mounted on it. */
  function flightFor(ctx) {
    var f = ctx.sim.flight;
    if (ctx.props.ride === false || !f || !f.live) return null;
    return f;
  }

  /* A breakout board: header along the bottom, a chip in the middle. */
  function breakout(names, o) {
    var w = Math.max(names.length - 1, 2) * P + 1.4 * P, x = -0.7 * P, h = o.h || 4.4 * P, y = -h - 0.4 * P, s = header(names, o.ink);
    s += board(x, y, w, h, o.fill, o.edge);
    s += '<circle cx="' + fx(x + 0.55 * P) + '" cy="' + fx(y + 0.55 * P) + '" r="4" fill="#0006" stroke="#d9b45a"/><circle cx="' + fx(x + w - 0.55 * P) + '" cy="' + fx(y + 0.55 * P) + '" r="4" fill="#0006" stroke="#d9b45a"/>';
    var cx = x + w / 2, cy = y + h * 0.48;
    s += chip(cx - (o.chipW || 1.3 * P) / 2, cy - (o.chipH || 1.3 * P) / 2, o.chipW || 1.3 * P, o.chipH || 1.3 * P, o.chip);
    s += text(cx, y + h - 0.55 * P, o.title, 6.5, o.ink || "#dfe9ff", { weight: 800 });
    if (o.axes) {
      var ax = x + 0.9 * P, ay = y + h - 1.4 * P;
      s += '<path d="M' + fx(ax) + ' ' + fx(ay) + 'h' + fx(0.9 * P) + 'M' + fx(ax) + ' ' + fx(ay) + 'v-' + fx(0.9 * P) + '" stroke="' + (o.ink || "#fff") + '" stroke-width="1.4" marker-end=""/>' +
        text(ax + 1.15 * P, ay, "X", 5.5, o.ink || "#fff", { weight: 700 }) + text(ax, ay - 1.15 * P, "Y", 5.5, o.ink || "#fff", { weight: 700 });
    }
    s += ledG("led", x + w - 0.6 * P, y + h - 0.6 * P, 2.6, "#3a1010");
    return { svg: s, box: { x: x - 0.2 * P, y: y - 0.2 * P, w: w + 0.4 * P, h: h + 0.6 * P + 0.4 * P } };
  }
  function ledLive(g, st) { L.setFill(g.led, st.on ? "#ff3b30" : "#3a1010"); }
  function i2cModel(extra) {
    return {
      dynamic: true,
      build: function (b) {
        var m = { pwr: Rr(b, "VCC", "GND", 1200), sda: Rr(b, "SDA", "GND", 1e6), scl: Rr(b, "SCL", "GND", 1e6) };
        if (extra) extra(b, m);
        return m;
      },
      pre: function () {},
      post: null,
      reset: function (m) { Object.keys(m).forEach(function (k) { if (/^_/.test(k)) delete m[k]; }); }
    };
  }
  function powerCheck(ctx, m, name, need) {
    var v = vAcross(ctx, m.pwr);
    ctx.st.on = v > (need || 2.7);
    if (v > 0.5 && v <= (need || 2.7)) warn(ctx, "warn", "lowpower", "The " + name + " needs 3.3–5 V on VCC.");
    if (v < -1) warn(ctx, "danger", "reverse", "The " + name + "'s power is the wrong way round.");
    if (ctx.st.on && ctx.sim.mcuRunning && !ctx.pinWired("SDA")) warn(ctx, "info", "nobus", "The " + name + " has power but its SDA/SCL aren't wired. On an Uno they go to A4 (SDA) and A5 (SCL).");
    return ctx.st.on;
  }
  var RIDE = { k: "ride", label: "On the drone (follow the quadcopter if one is on the bench)", type: "bool" };

  /* ====================================================== FLIGHT SENSORS */

  /* --- MPU-6050: three gyroscopes and three accelerometers on one chip.
   * The gyro has a bias of its own (calcOffsets() learns it while the drone
   * sits still) and the accelerometer feels the motors' vibration. */
  var imuArt = breakout(["VCC", "GND", "SCL", "SDA", "INT"], { fill: "#1b4fa0", edge: "#123673", chip: "MPU", title: "GY-521", axes: true });
  add("imu_mpu6050", {
    name: "IMU gyro + accelerometer (MPU-6050)", cat: "Flight sensors",
    blurb: "Measures how fast it is turning (gyroscope, °/s) and which way is down (accelerometer, g) on three axes — X forward, Y left, Z up. Blend the two and you know the drone's tilt: pitch, roll and yaw. I²C: SDA to A4, SCL to A5. #include <MPU6050_light.h>.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: P, y: 0 }, { n: "SCL", x: 2 * P, y: 0 }, { n: "SDA", x: 3 * P, y: 0 }, { n: "INT", x: 4 * P, y: 0, label: "interrupt (unused)" }],
    box: imuArt.box,
    props: { ride: true, roll: 0, pitch: 0, yawRate: 0, vibration: 20, bias: 1.5 },
    spec: [RIDE,
      { k: "roll", label: "Tilt: roll (right side down +)", type: "range", min: -90, max: 90, step: 1, unit: "°", live: true },
      { k: "pitch", label: "Tilt: pitch (nose up +)", type: "range", min: -90, max: 90, step: 1, unit: "°", live: true },
      { k: "yawRate", label: "Turning (clockwise +)", type: "range", min: -180, max: 180, step: 5, unit: "°/s", live: true },
      { k: "vibration", label: "Frame vibration", type: "range", min: 0, max: 100, step: 5, unit: "%", live: true },
      { k: "bias", label: "Gyro bias (calcOffsets() removes it)", type: "range", min: 0, max: 5, step: 0.1, unit: "°/s" }],
    art: function () { return imuArt.svg; },
    live: ledLive
  });
  MODELS.imu_mpu6050 = i2cModel();
  MODELS.imu_mpu6050.post = function (m, ctx) {
    var st = ctx.st, pr = ctx.props, dt = dtOf(ctx);
    if (!powerCheck(ctx, m, "IMU")) { st.val = null; return; }
    var f = flightFor(ctx), roll, pitch, rr, pr2, yr, spec, vib;
    if (f) {
      roll = f.roll; pitch = f.pitch; rr = f.p; pr2 = f.q; yr = f.r;
      spec = toBody(roll, pitch, f.yaw, [f.an, f.ae, -(f.au + G)]);
      vib = (pr.vibration / 100) * f.thrAvg;
    } else {
      roll = +pr.roll || 0; pitch = +pr.pitch || 0; rr = 0; pr2 = 0; yr = +pr.yawRate || 0;
      spec = toBody(roll, pitch, 0, [0, 0, -G]);
      vib = (pr.vibration / 100) * 0.15;
      m._yaw = wrap360((m._yaw || 0) + yr * dt);
    }
    /* each chip has its own bias, fixed at power-up */
    if (!m._b) m._b = [0, 1, 2].map(function () { return (Math.random() < 0.5 ? -1 : 1) * (0.5 + 0.5 * Math.random()) * (+pr.bias || 0); });
    var acc = [spec[0] / G, -spec[1] / G, -spec[2] / G].map(function (a) { return a + vib * 0.9 * gauss() + 0.004 * gauss(); });
    var gyr = [rr, -pr2, -yr].map(function (w, i) { return w + m._b[i] + vib * 2.5 * gauss() + 0.05 * gauss(); });
    st.val = { acc: acc, gyro: gyr, temp: 27 + 0.3 * gauss(), t: ctx.sim.t };
    /* what 500 readings average to: what calcOffsets() learns */
    st.mean = { acc: [spec[0] / G, -spec[1] / G, -spec[2] / G], gyro: [rr + m._b[0], -pr2 + m._b[1], -yr + m._b[2]] };
    st.roll = roll; st.pitch = pitch;
  };

  /* --- BMP280: air pressure, about 12 Pa less for every metre up. */
  var baroArt = breakout(["VCC", "GND", "SCL", "SDA"], { fill: "#6b3fa8", edge: "#47267a", chip: "280", title: "BMP280", chipW: 0.9 * P, chipH: 0.9 * P });
  add("baro_bmp280", {
    name: "Barometer (BMP280)", cat: "Flight sensors",
    blurb: "Air pressure falls about 12 Pa for every metre you climb, so this tiny sensor is an altimeter: readAltitude() in metres, and its change over time is the climb rate. It wobbles by about half a metre, and a breeze over it fools it. I²C: SDA to A4, SCL to A5. #include <Adafruit_BMP280.h>.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: P, y: 0 }, { n: "SCL", x: 2 * P, y: 0 }, { n: "SDA", x: 3 * P, y: 0 }],
    box: baroArt.box,
    props: { ride: true, alt: 0, ground: 5, qnh: 1013.25, temp: 30, noise: 30 },
    spec: [RIDE,
      { k: "alt", label: "Height above the ground", type: "range", min: 0, max: 500, step: 1, unit: "m", live: true },
      { k: "ground", label: "Ground height above sea level", type: "range", min: 0, max: 3000, step: 5, unit: "m" },
      { k: "qnh", label: "Today's sea-level pressure", type: "range", min: 980, max: 1040, step: 0.25, unit: "hPa", live: true },
      { k: "temp", label: "Air temperature", type: "range", min: -20, max: 50, step: 1, unit: "°C", live: true },
      { k: "noise", label: "Noise (prop wash, breeze)", type: "range", min: 0, max: 100, step: 5, unit: "%", live: true }],
    art: function () { return baroArt.svg; },
    live: ledLive
  });
  MODELS.baro_bmp280 = i2cModel();
  MODELS.baro_bmp280.post = function (m, ctx) {
    var st = ctx.st, pr = ctx.props, dt = dtOf(ctx);
    if (!powerCheck(ctx, m, "barometer")) { st.val = null; return; }
    var f = flightFor(ctx), h = (+pr.ground || 0) + (f ? f.z : +pr.alt || 0);
    var gust = f ? f.thrAvg : 0.2;
    var err = wander(m, "_n", 0.35 * (pr.noise / 100) * (0.5 + gust), 0.4, dt);
    var p = pr.qnh * 100 * Math.pow(1 - (h + err) / 44330, 5.255);
    st.val = { pa: p, temp: (+pr.temp || 0) - 0.0065 * (f ? f.z : 0) + 0.05 * gauss(), t: ctx.sim.t };
    st.alt = h;
  };
  D.altitudeOf = function (pa, qnh) { return 44330 * (1 - Math.pow(pa / 100 / (qnh || 1013.25), 0.1903)); };

  /* --- QMC5883L: a compass chip. It feels the Earth's field — and the
   * field of every amp in the power wires near it. */
  var magArt = breakout(["VCC", "GND", "SCL", "SDA", "DRDY"], { fill: "#1b4fa0", edge: "#123673", chip: "5883", title: "GY-271", axes: true });
  add("mag_qmc5883l", {
    name: "Compass / magnetometer (QMC5883L)", cat: "Flight sensors",
    blurb: "Feels the Earth's magnetic field to tell which way the nose points (0° north, 90° east). Tilt it and it is wrong unless you correct for tilt; mount it near the battery wires and the motor current drags it off. That is why drones put the compass on a mast with the GPS. I²C: SDA to A4, SCL to A5. #include <QMC5883LCompass.h>.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: P, y: 0 }, { n: "SCL", x: 2 * P, y: 0 }, { n: "SDA", x: 3 * P, y: 0 }, { n: "DRDY", x: 4 * P, y: 0, label: "data ready (unused)" }],
    box: magArt.box,
    props: { ride: true, heading: 0, declination: -4, interference: 30 },
    spec: [RIDE,
      { k: "heading", label: "Nose points to (true heading)", type: "range", min: 0, max: 359, step: 1, unit: "°", live: true },
      { k: "declination", label: "Magnetic declination here", type: "range", min: -20, max: 20, step: 0.5, unit: "°" },
      { k: "interference", label: "How close to the power wires", type: "range", min: 0, max: 100, step: 5, unit: "%", live: true }],
    art: function () { return magArt.svg; },
    live: ledLive
  });
  MODELS.mag_qmc5883l = i2cModel();
  MODELS.mag_qmc5883l.post = function (m, ctx) {
    var st = ctx.st, pr = ctx.props;
    if (!powerCheck(ctx, m, "compass")) { st.val = null; return; }
    var f = flightFor(ctx), roll = f ? f.roll : 0, pitch = f ? f.pitch : 0, yaw = f ? f.yaw : +pr.heading || 0;
    var dec = (+pr.declination || 0) * D2R, H = 0.32, Z = 0.06;      /* gauss: about what West Africa feels */
    var b = toBody(roll, pitch, yaw, [H * Math.cos(dec), H * Math.sin(dec), Z]);
    var amps = f ? f.amps : 0, k = 0.0035 * amps * (pr.interference / 100);
    var flu = [b[0] + k * 0.8, -b[1] + k * 0.5, -b[2] + k * 0.3];
    st.val = { raw: flu.map(function (g) { return Math.round(g * 12000 + 25 * gauss()); }), t: ctx.sim.t };
    st.heading = yaw;
  };

  /* --- NEO-6M GPS: sends NMEA sentences, once a second, at 9600 baud. */
  add("gps_neo6m", {
    name: "GPS / GNSS module (NEO-6M)", cat: "Flight sensors",
    blurb: "Listens to satellites and works out where it is: latitude, longitude, height, ground speed and course, for position hold, waypoints and return-to-home. It sends plain text sentences ($GPGGA, $GPRMC) once a second out of TX at 9600 baud: TX to the board's receive pin (SoftwareSerial), and read them with TinyGPS++.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "RXD", x: P, y: 0, label: "RX" }, { n: "TXD", x: 2 * P, y: 0, label: "TX" }, { n: "GND", x: 3 * P, y: 0 }],
    box: { x: -2.6 * P, y: -9.6 * P, w: 8.2 * P, h: 10.4 * P },
    props: { ride: true, sky: true, sats: 9, ttff: 3, lat: 13.4549, lng: -16.5790, elev: 5, speed: 0, course: 0 },
    spec: [RIDE,
      { k: "sky", label: "It can see the sky (indoors: no fix)", type: "bool", live: true },
      { k: "sats", label: "Satellites in view", type: "range", min: 0, max: 16, step: 1, live: true },
      { k: "ttff", label: "Time to first fix", type: "range", min: 1, max: 40, step: 1, unit: "s" },
      { k: "lat", label: "Latitude (start / home)", type: "number", step: 0.0001 },
      { k: "lng", label: "Longitude (start / home)", type: "number", step: 0.0001 },
      { k: "elev", label: "Ground height above sea level", type: "range", min: 0, max: 3000, step: 5, unit: "m" },
      { k: "speed", label: "Ground speed (without a drone)", type: "range", min: 0, max: 120, step: 1, unit: "km/h", live: true },
      { k: "course", label: "Course (without a drone)", type: "range", min: 0, max: 359, step: 1, unit: "°", live: true }],
    art: function () {
      var s = "", x = -2.4 * P, y = -9.2 * P, w = 7.8 * P, h = 8.6 * P;
      s += header(["VCC", "RX", "TX", "GND"]);
      s += board(x, y, w, h, "#2a3340", "#141a22");
      s += rect(x + 1.2 * P, y + 0.6 * P, 5.4 * P, 5.4 * P, 3, "#c9a24a", ' stroke="#7d5f1c" stroke-width="1.5"') + rect(x + 1.6 * P, y + 1 * P, 4.6 * P, 4.6 * P, 2, "#e2bf6a");
      s += '<circle cx="' + fx(x + 3.9 * P) + '" cy="' + fx(y + 3.3 * P) + '" r="' + fx(0.6 * P) + '" fill="#b08a35"/>';
      s += text(x + 3.9 * P, y + 5.2 * P, "ANTENNA", 5, "#7d5f1c", { weight: 800 });
      s += chip(x + 1.6 * P, y + 6.4 * P, 2.6 * P, 1.5 * P, "NEO-6M");
      s += '<g data-live="fix"><circle cx="' + fx(x + 6.2 * P) + '" cy="' + fx(y + 7.1 * P) + '" r="4" fill="#123"/></g>';
      s += '<g data-live="sat">' + text(x + w / 2, y - 0.6 * P, "", 7, "#2a8a4a", { weight: 800 }) + '</g>';
      return s;
    },
    live: function (g, st) {
      L.setFill(g.fix, st.fix ? (st.blink ? "#3dff7a" : "#123") : "#123");
      setText(g.sat, st.on ? (st.fix ? st.sats + " sats · 3D fix" : "searching…") : "");
    }
  });
  function nmeaSum(body) { var c = 0; for (var i = 0; i < body.length; i++) c ^= body.charCodeAt(i); return (c < 16 ? "0" : "") + c.toString(16).toUpperCase(); }
  function nmeaLat(v) { var a = Math.abs(v), d = Math.floor(a), mm = (a - d) * 60; return [(d < 10 ? "0" : "") + d + (mm < 10 ? "0" : "") + mm.toFixed(5), v >= 0 ? "N" : "S"]; }
  function nmeaLng(v) { var a = Math.abs(v), d = Math.floor(a), mm = (a - d) * 60; return [("00" + d).slice(-3) + (mm < 10 ? "0" : "") + mm.toFixed(5), v >= 0 ? "E" : "W"]; }
  D.nmea = function (fix) {
    var t = fix.time, hh = Math.floor(t / 3600) % 24, mi = Math.floor(t / 60) % 60, ss = t % 60;
    var ts = ("0" + hh).slice(-2) + ("0" + mi).slice(-2) + (ss < 10 ? "0" : "") + ss.toFixed(2);
    var gga, rmc;
    if (fix.ok) {
      var la = nmeaLat(fix.lat), lo = nmeaLng(fix.lng);
      gga = "GPGGA," + ts + "," + la[0] + "," + la[1] + "," + lo[0] + "," + lo[1] + ",1," + ("0" + fix.sats).slice(-2) + "," + fix.hdop.toFixed(2) + "," + fix.alt.toFixed(1) + ",M,25.3,M,,";
      rmc = "GPRMC," + ts + ",A," + la[0] + "," + la[1] + "," + lo[0] + "," + lo[1] + "," + (fix.kmh / 1.852).toFixed(3) + "," + (fix.kmh > 0.5 ? fix.course.toFixed(2) : "") + "," + (fix.date || "201126") + ",,,A";
    } else {
      gga = "GPGGA," + ts + ",,,,,0," + ("0" + fix.sats).slice(-2) + ",99.99,,,,,,";
      rmc = "GPRMC," + ts + ",V,,,,,,,," + (fix.date || "201126") + ",,,N";
    }
    return "$" + gga + "*" + nmeaSum(gga) + "\r\n$" + rmc + "*" + nmeaSum(rmc) + "\r\n";
  };
  MODELS.gps_neo6m = {
    dynamic: true,
    build: function (b) { return { pwr: Rr(b, "VCC", "GND", 110), txd: Vs(b, "TXD", "GND", 3.3, 1000), rxd: Rr(b, "RXD", "GND", 1e5), next: 0, upT: 0 }; },
    pre: function () {},
    post: function (m, ctx) {
      var st = ctx.st, pr = ctx.props, dt = dtOf(ctx), v = vAcross(ctx, m.pwr), sim = ctx.sim;
      st.on = v > 2.7;
      if (!st.on) { off(m.txd); st.fix = false; m.upT = 0; m.next = 0; if (v > 0.5) warn(ctx, "warn", "lowpower", "The GPS needs 3.3–5 V."); return; }
      setV(m.txd, 3.3, 1000);
      m.upT += dt;
      var f = flightFor(ctx), sats = Math.round(clamp(+pr.sats || 0, 0, 16));
      st.fix = pr.sky !== false && sats >= 4 && m.upT >= (+pr.ttff || 1);
      st.sats = pr.sky === false ? 0 : sats;
      var hdop = st.fix ? clamp(5.5 / Math.sqrt(sats), 0.6, 4) : 99.99;
      /* the position wanders a metre or two with the satellites' geometry (HDOP) */
      var sg = st.fix ? hdop : 0;
      if (!st.fix) m._e = m._nn = m._u = 0;
      var nE = wander(m, "_e", sg * 0.9, 6, dt), nN = wander(m, "_nn", sg * 0.9, 6, dt), nU = wander(m, "_u", sg * 1.6, 6, dt);
      var lat0 = +pr.lat || 0, lng0 = +pr.lng || 0, north = f ? f.x : 0, east = f ? f.y : 0;
      var kmh = f ? Math.hypot(f.vn, f.ve) * 3.6 : +pr.speed || 0, course = f ? wrap360(Math.atan2(f.ve, f.vn) * R2D) : +pr.course || 0;
      if (!f && kmh > 0) { m._dn = (m._dn || 0) + Math.cos(course * D2R) * kmh / 3.6 * dt; m._de = (m._de || 0) + Math.sin(course * D2R) * kmh / 3.6 * dt; north = m._dn; east = m._de; }
      st.pos = { lat: lat0 + (north + nN) / 111320, lng: lng0 + (east + nE) / (111320 * Math.cos(lat0 * D2R)), alt: (+pr.elev || 0) + (f ? f.z : 0) + nU, kmh: kmh, course: course, hdop: hdop };
      st.blink = st.fix && (sim.t % 1) < 0.15;
      /* once a second, two sentences out of TX: as long as 9600 baud takes */
      if (sim.t >= m.next) {
        m.next = (m.next || sim.t) + 1;
        if (m.next < sim.t) m.next = sim.t + 1;
        var txt = D.nmea({ ok: st.fix, time: 43200 + sim.t, lat: st.pos.lat, lng: st.pos.lng, alt: st.pos.alt, sats: st.sats, hdop: hdop, kmh: kmh, course: course });
        if (sim.uartQueue) sim.uartQueue(m.txd.n[0], txt, txt.length * 10 / 9600, null, "gps" + ctx.part.id);
        st.sent = (st.sent || 0) + 1;
        if (sim.mcuRunning && !ctx.pinWired("TXD")) warn(ctx, "info", "notx", "The GPS is talking but its TX isn't wired to anything. TX goes to the board's receive pin — with SoftwareSerial, the first pin you name.");
      }
      if (pr.sky === false) warn(ctx, "info", "indoors", "Indoors a GPS hears no satellites: no fix, no position. Take the drone outside — tick 'It can see the sky'.");
    },
    reset: function (m) { m.next = 0; m.upT = 0; m._dn = m._de = 0; m._e = m._nn = m._u = 0; }
  };

  /* --- MS4525DO airspeed sensor on a pitot tube: the air rammed into the
   * tube's tip pushes harder than the still air at its side holes. */
  add("pitot_ms4525", {
    name: "Airspeed sensor + pitot tube (MS4525DO)", cat: "Flight sensors",
    blurb: "For fixed-wing drones: the air rammed into the tube's tip pushes harder than the air at its side holes, and that difference is ½ ρ v². Airspeed is what keeps a wing flying — not ground speed, which the wind adds to or takes away. A bug in the tube and it reads zero. I²C: SDA to A4, SCL to A5.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: P, y: 0 }, { n: "SCL", x: 2 * P, y: 0 }, { n: "SDA", x: 3 * P, y: 0 }],
    box: { x: -1 * P, y: -6.8 * P, w: 12.4 * P, h: 7.4 * P },
    props: { ride: true, airspeed: 15, blocked: false, temp: 30 },
    toggle: "blocked",
    spec: [RIDE,
      { k: "airspeed", label: "Airspeed (without a drone)", type: "range", min: 0, max: 60, step: 0.5, unit: "m/s", live: true },
      { k: "blocked", label: "Pitot tube blocked (insect, water, ice)", type: "bool", live: true },
      { k: "temp", label: "Air temperature", type: "range", min: -20, max: 50, step: 1, unit: "°C" }],
    art: function () {
      var s = header(["VCC", "GND", "SCL", "SDA"]);
      s += board(-0.8 * P, -4.6 * P, 4.6 * P, 4.2 * P, "#2a3340", "#141a22") + chip(0.2 * P, -3.9 * P, 2.6 * P, 1.6 * P, "4525");
      s += text(1.5 * P, -1.3 * P, "AIRSPEED", 6, "#cfd5da", { weight: 800 });
      s += '<path d="M' + fx(3.8 * P) + ' ' + fx(-3.4 * P) + 'C' + fx(5.5 * P) + ' ' + fx(-3.4 * P) + ' ' + fx(5.5 * P) + ' ' + fx(-5.6 * P) + ' ' + fx(7 * P) + ' ' + fx(-5.6 * P) + '" stroke="#e85d3a" stroke-width="3" fill="none"/>';
      s += '<path d="M' + fx(3.8 * P) + ' ' + fx(-2.6 * P) + 'C' + fx(5.9 * P) + ' ' + fx(-2.6 * P) + ' ' + fx(5.9 * P) + ' ' + fx(-5.1 * P) + ' ' + fx(7 * P) + ' ' + fx(-5.1 * P) + '" stroke="#3a8ad8" stroke-width="3" fill="none"/>';
      s += rect(7 * P, -5.9 * P, 4.2 * P, 1.1 * P, 5, "#c9ced3", ' stroke="#7d858b"') + '<circle cx="' + fx(11.2 * P) + '" cy="' + fx(-5.35 * P) + '" r="2.5" fill="#333"/>';
      s += '<g data-live="flow">' + text(9.1 * P, -6.5 * P, "", 6.5, "#3a8ad8", { weight: 800 }) + '</g>';
      s += '<g data-live="bug" opacity="0"><circle cx="' + fx(11.35 * P) + '" cy="' + fx(-5.35 * P) + '" r="4" fill="#3a2a10"/></g>';
      return s;
    },
    live: function (g, st, pr) {
      setText(g.flow, st.on ? (pr.blocked ? "BLOCKED" : fx(st.as || 0) + " m/s") : "");
      if (g.bug) g.bug.setAttribute("opacity", pr.blocked ? 1 : 0);
    }
  });
  MODELS.pitot_ms4525 = i2cModel();
  MODELS.pitot_ms4525.post = function (m, ctx) {
    var st = ctx.st, pr = ctx.props, dt = dtOf(ctx);
    if (!powerCheck(ctx, m, "airspeed sensor")) { st.val = null; return; }
    var f = flightFor(ctx), as;
    if (f) {
      var vax = f.vn - f.wn, vay = f.ve - f.we;
      as = Math.max(0, vax * Math.cos(f.yaw * D2R) + vay * Math.sin(f.yaw * D2R));
    } else as = +pr.airspeed || 0;
    var rho = 101325 / (287.05 * ((+pr.temp || 15) + 273.15));
    var q = pr.blocked ? 0 : 0.5 * rho * as * as;
    q += wander(m, "_q", 1.0, 0.3, dt);
    st.as = as;
    st.val = { pa: q, temp: +pr.temp || 15, rho: rho, t: ctx.sim.t };
    if (pr.blocked && as > 5) warn(ctx, "warn", "blocked", "The pitot tube is blocked, so the airspeed reads zero while the drone is really flying at " + fx(as) + " m/s. A fixed-wing that believes that dives to speed up — always cover the tube on the ground and uncover it before flight.");
  };

  /* --- VL53L0X: a laser rangefinder. It times light to a target and back,
   * up to about 2 m. Under a drone it measures the true height above the
   * ground; looking forward it sees the wall coming. */
  var tofArt = breakout(["VCC", "GND", "SCL", "SDA"], { fill: "#2a2a2c", edge: "#111", chip: "", title: "VL53L0X", chipW: 1.4 * P, chipH: 0.8 * P });
  add("tof_vl53l0x", {
    name: "Laser rangefinder / LiDAR (VL53L0X)", cat: "Flight sensors",
    blurb: "Times a pulse of invisible laser light to a surface and back: distance in millimetres, up to about 2 m. Facing down it is the drone's height above the ground for gentle landings (the barometer can't do that near the ground); facing forward it is an obstacle sensor. Out of range it reads 8190. I²C: SDA to A4, SCL to A5. #include <VL53L0X.h>.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: P, y: 0 }, { n: "SCL", x: 2 * P, y: 0 }, { n: "SDA", x: 3 * P, y: 0 }],
    box: tofArt.box,
    props: { ride: true, facing: "down", mm: 600, surface: 90 },
    spec: [RIDE,
      { k: "facing", label: "Mounted facing", type: "select", options: [["down", "down (height above ground)"], ["forward", "forward (obstacles)"]] },
      { k: "mm", label: "Distance to the surface", type: "range", min: 30, max: 3000, step: 10, unit: "mm", live: true },
      { k: "surface", label: "How well it reflects", type: "range", min: 5, max: 100, step: 5, unit: "%", live: true }],
    art: function () {
      var s = tofArt.svg;
      s += '<g data-live="beam" opacity="0"><path d="M' + fx(1.2 * P) + ' ' + fx(-3.2 * P) + 'l-' + fx(0.6 * P) + ' -' + fx(3 * P) + 'h' + fx(1.6 * P) + 'z" fill="#ff3b30" opacity=".25"/></g>';
      s += '<g data-live="mm">' + text(1.5 * P, -7 * P, "", 7, "#c03030", { weight: 800 }) + '</g>';
      return s;
    },
    live: function (g, st) {
      ledLive(g, st);
      if (g.beam) g.beam.setAttribute("opacity", st.on ? 1 : 0);
      setText(g.mm, st.on && st.val ? (st.val.mm >= 8190 ? "out of range" : Math.round(st.val.mm) + " mm") : "");
    }
  });
  MODELS.tof_vl53l0x = i2cModel();
  MODELS.tof_vl53l0x.post = function (m, ctx) {
    var st = ctx.st, pr = ctx.props;
    if (!powerCheck(ctx, m, "rangefinder")) { st.val = null; return; }
    var f = flightFor(ctx), mm = +pr.mm || 0;
    if (f && pr.facing !== "forward") {
      var tilt = Math.acos(clamp(Math.cos(f.roll * D2R) * Math.cos(f.pitch * D2R), -1, 1));
      mm = tilt < 1.2 ? (f.z * 1000 + 40) / Math.cos(tilt) : 1e5;
    }
    var reach = 2000 * Math.sqrt(clamp(pr.surface, 5, 100) / 100);
    st.val = { mm: mm > reach ? 8190 : Math.max(20, mm * (1 + 0.015 * gauss()) + 3 * gauss()), t: ctx.sim.t };
  };

  /* =============================================================== DRONE */

  /* --- LiPo battery: lithium-polymer cells, 3.7 V each nominal. It sags
   * under load and its voltage falls as it empties; below 3.5 V a cell
   * under load it is time to land, and below 3.0 V resting it is damaged. */
  var OCV = [[0, 3.0], [0.05, 3.3], [0.12, 3.6], [0.3, 3.73], [0.5, 3.8], [0.75, 3.95], [0.9, 4.08], [1, 4.2]];
  function ocv(soc) {
    soc = clamp(soc, 0, 1);
    for (var i = 1; i < OCV.length; i++) if (soc <= OCV[i][0]) { var a = OCV[i - 1], b = OCV[i]; return a[1] + (b[1] - a[1]) * (soc - a[0]) / (b[0] - a[0]); }
    return 4.2;
  }
  D.ocv = ocv;
  add("battery_lipo", {
    name: "LiPo battery (3S 11.1 V)", cat: "Drone",
    blurb: "The drone's fuel tank: lithium-polymer cells, 3.7 V each, 4.2 V full. It can give 50 A, so it can also start a fire — never short it. Its voltage sags under load and falls as it empties: land when a cell reads 3.5 V in flight. Watch 'used' climb as you fly.",
    pins: [{ n: "+", x: 0, y: 0, label: "+ (red, XT60)" }, { n: "-", x: P, y: 0, label: "− (black, XT60)" }],
    box: { x: -3.4 * P, y: -9.8 * P, w: 13.2 * P, h: 10.4 * P },
    props: { cells: 3, mah: 2200, charge: 100, crating: 30 },
    spec: [
      { k: "cells", label: "Cells in series", type: "select", options: [[2, "2S — 7.4 V"], [3, "3S — 11.1 V"], [4, "4S — 14.8 V"], [6, "6S — 22.2 V"]], rebuild: true },
      { k: "mah", label: "Capacity", type: "range", min: 300, max: 10000, step: 100, unit: "mAh" },
      { k: "charge", label: "Charge when the power comes on", type: "range", min: 0, max: 100, step: 1, unit: "%" },
      { k: "crating", label: "Discharge rating", type: "range", min: 10, max: 100, step: 5, unit: "C" }],
    art: function (part, pr) {
      var s = "", x = -3.2 * P, y = -8.4 * P, w = 12.6 * P, h = 5.6 * P, n = +pr.cells || 3;
      s += '<path d="M0 0V' + fx(-1.2 * P) + 'C0 ' + fx(-2.2 * P) + ' ' + fx(-0.6 * P) + ' ' + fx(-2.2 * P) + ' ' + fx(-0.6 * P) + ' ' + fx(-2.8 * P) + '" stroke="#d43a2f" stroke-width="5" fill="none" stroke-linecap="round"/>';
      s += '<path d="M' + P + ' 0V' + fx(-1.2 * P) + 'C' + P + ' ' + fx(-2.2 * P) + ' ' + fx(1.6 * P) + ' ' + fx(-2.2 * P) + ' ' + fx(1.6 * P) + ' ' + fx(-2.8 * P) + '" stroke="#2a2a2c" stroke-width="5" fill="none" stroke-linecap="round"/>';
      s += shadow(x, y, w, h, 6) + rect(x, y, w, h, 6, "#2b2f36", ' stroke="#111" stroke-width="1.5"');
      s += rect(x + 0.3 * P, y + 0.3 * P, w - 0.6 * P, 1.6 * P, 3, "#e8c22a");
      s += text(x + w / 2, y + 1.1 * P, "LiPo " + n + "S " + (3.7 * n).toFixed(1) + "V", 9, "#2b2f36", { weight: 900 });
      s += text(x + w / 2, y + 2.8 * P, (pr.mah || 2200) + " mAh · " + (pr.crating || 30) + "C", 7.5, "#cfd5da", { weight: 700 });
      s += rect(-1.2 * P, y + h, 3.4 * P, 1.3 * P, 2, "#e8c22a", ' stroke="#8a6a1c"') + text(0.5 * P, y + h + 0.65 * P, "XT60", 6, "#5a4210", { weight: 900 });
      s += '<g data-live="gauge">' + rect(x + 0.6 * P, y + 3.8 * P, w - 1.2 * P, 1.1 * P, 2, "#14171b") + '<rect x="' + fx(x + 0.7 * P) + '" y="' + fx(y + 3.9 * P) + '" width="0" height="' + fx(0.9 * P) + '" rx="1.5" fill="#3dd36b"/></g>';
      s += '<g data-live="vtxt">' + text(x + w / 2, y - 0.7 * P, "", 7.5, "#2a6a2a", { weight: 800 }) + '</g>';
      /* the balance lead */
      s += '<path d="M' + fx(x + w) + ' ' + fx(y + 2 * P) + 'q' + fx(0.6 * P) + ' 0 ' + fx(0.6 * P) + ' ' + fx(1.4 * P) + '" stroke="#e9e9e9" stroke-width="4" fill="none"/>' + rect(x + w + 0.25 * P, y + 3.3 * P, 0.7 * P, 1.2 * P, 1, "#f4f4f0", ' stroke="#999"');
      return s;
    },
    live: function (g, st) {
      if (g.gauge) {
        var bar = g.gauge.lastChild, soc = clamp(st.soc == null ? 1 : st.soc, 0, 1), full = 12.6 * P - 1.4 * P;
        bar.setAttribute("width", fx(full * soc));
        bar.setAttribute("fill", soc > 0.4 ? "#3dd36b" : soc > 0.2 ? "#f2b13a" : "#ff3b30");
      }
      setText(g.vtxt, st.v != null ? fx(st.v, 2) + " V · " + fx(st.i || 0) + " A · " + Math.round(st.used || 0) + " mAh used" : "");
    }
  });
  MODELS.battery_lipo = {
    dynamic: true,
    build: function (b, pr) {
      var n = +pr.cells || 3;
      return { src: Vs(b, "+", "-", 4.2 * n, 0.012 * n), used: null };
    },
    pre: function (m, ctx) {
      var pr = ctx.props, n = +pr.cells || 3;
      if (m.used == null) m.used = (1 - clamp(+pr.charge, 0, 100) / 100) * (+pr.mah || 2200);
      var soc = 1 - m.used / (+pr.mah || 2200);
      setV(m.src, ocv(soc) * n, 0.012 * n * (soc < 0.15 ? 1.8 : 1));
    },
    post: function (m, ctx) {
      var st = ctx.st, pr = ctx.props, n = +pr.cells || 3, cap = +pr.mah || 2200, dt = dtOf(ctx);
      var i = -iThrough(m.src), v = vAcross(ctx, m.src);
      m.used = Math.min(cap * 1.02, m.used + Math.max(0, i) * dt / 3.6);
      st.i = smooth(st, "i_", i, ctx); st.v = smooth(st, "v_", v, ctx); st.used = m.used; st.soc = 1 - m.used / cap; st.cells = n;
      var cell = st.v / n, maxA = cap / 1000 * (+pr.crating || 30);
      if (st.i > maxA * 1.4) warn(ctx, "danger", "short", "Short circuit! " + fx(st.i, 0) + " A is pouring out of the LiPo — far past its " + fx(maxA, 0) + " A rating. A real one swells and catches fire. Unplug it.");
      else if (st.i > maxA) warn(ctx, "warn", "overload", "The LiPo is giving " + fx(st.i, 0) + " A, more than its " + (+pr.crating || 30) + "C rating (" + fx(maxA, 0) + " A). It gets hot and loses capacity.");
      if (st.i > 1 && cell < 3.5 && cell > 3.2) warn(ctx, "warn", "land", "Battery low: " + fx(cell, 2) + " V a cell under load. Land now — the voltage falls fast from here.");
      if (cell <= 3.2 && st.v > 1) warn(ctx, "danger", "flat", "The LiPo is down to " + fx(cell, 2) + " V a cell. Below 3.0 V it is damaged for good. Stop and recharge it.");
      if (i < -0.05) warn(ctx, "warn", "backfed", "Current is being pushed backwards into the LiPo. Only a balance charger may do that.");
    },
    reset: function (m) { m.used = null; }
  };

  /* --- Power module: in line between the battery and the drone. It
   * measures the volts (through a divider) and the amps (through a shunt)
   * for the flight controller, and gives it a clean 5 V. */
  add("power_module", {
    name: "Power module (volts, amps + 5 V)", cat: "Drone",
    blurb: "Goes between the LiPo and everything else: battery + into IN+, the drone's power from OUT+. V gives the battery voltage ÷ 11 and I gives 55 mV per amp — read both with analogRead() to know how much flight is left (mAh used). Its 5V pin powers the flight controller from the battery.",
    pins: [{ n: "IN+", x: 0, y: 0, label: "battery +" }, { n: "GND", x: P, y: 0, label: "battery − / ground" }, { n: "OUT+", x: 2 * P, y: 0, label: "to the drone +" }, { n: "5V", x: 3 * P, y: 0, label: "5.3 V for the controller" }, { n: "V", x: 4 * P, y: 0, label: "volts ÷ 11" }, { n: "I", x: 5 * P, y: 0, label: "55 mV per amp" }],
    box: { x: -0.8 * P, y: -5.4 * P, w: 6.6 * P, h: 6 * P },
    props: {},
    art: function () {
      var s = header(["IN+", "GND", "OUT+", "5V", "V", "I"]);
      s += board(-0.6 * P, -5 * P, 6.2 * P, 4.6 * P, "#1d1d1f", "#000");
      s += rect(-0.2 * P, -4.6 * P, 2 * P, 1.4 * P, 2, "#e8c22a") + rect(3.2 * P, -4.6 * P, 2 * P, 1.4 * P, 2, "#e8c22a");
      s += text(0.8 * P, -3.9 * P, "IN", 6, "#5a4210", { weight: 900 }) + text(4.2 * P, -3.9 * P, "OUT", 6, "#5a4210", { weight: 900 });
      s += rect(2 * P, -4.3 * P, 1 * P, 0.8 * P, 1, "#b6bcc2") + chip(0.6 * P, -2.7 * P, 1.6 * P, 1 * P, "BEC") + chip(3 * P, -2.7 * P, 1.6 * P, 1 * P, "ADC");
      s += '<g data-live="read">' + text(2.5 * P, -5.6 * P, "", 7, "#2a6a2a", { weight: 800 }) + '</g>';
      return s;
    },
    live: function (g, st) { setText(g.read, st.on ? fx(st.v, 1) + " V · " + fx(st.i, 1) + " A" : ""); }
  });
  MODELS.power_module = {
    dynamic: true,
    build: function (b) {
      return { shunt: Rr(b, "IN+", "OUT+", 0.0008), sense: Rr(b, "IN+", "GND", 2e4), bec: Vs(b, "5V", "GND", 5.3, 0.05), vo: Vs(b, "V", "GND", 0, 1000), io: Vs(b, "I", "GND", 0, 1000) };
    },
    pre: function (m, ctx) {
      var v = vAcross(ctx, m.sense), on = v > 6;
      ctx.st.on = v > 1;
      if (on) setV(m.bec, 5.3, 0.05); else off(m.bec);
      if (v > 1) { setV(m.vo, v / 11, 1000); setV(m.io, clamp(Math.max(0, iThrough(m.shunt)) * 0.055, 0, 5), 1000); } else { off(m.vo); off(m.io); }
    },
    post: function (m, ctx) {
      var st = ctx.st;
      st.v = smooth(st, "v_", vAcross(ctx, m.sense), ctx); st.i = smooth(st, "i_", Math.max(0, iThrough(m.shunt)), ctx);
      if (st.v > 30) warn(ctx, "danger", "over", "The power module is rated to 28 V (6S) and has " + fx(st.v) + " V on it.");
      if (st.i > 90) warn(ctx, "danger", "amps", "More than 90 A through the power module: its shunt and traces burn.");
    }
  };

  /* --- ESC: reads a servo pulse, drives a brushless motor. It only arms
   * once it has seen the throttle at the bottom (1000 µs) for a moment —
   * a safety rule, so a drone can't leap into life when it is plugged in. */
  function escNew() { return { armT: 0, armed: false, refused: false, w: 0, lost: 0, beep: 0 }; }
  function escStep(e, us, vbat, dt) {
    if (vbat < 6) { e.armed = false; e.armT = 0; e.refused = false; e.w += (0 - e.w) * Math.min(1, dt / 0.08); return 0; }
    if (us == null) {
      e.lost += dt;
      if (e.lost > 0.25) { e.cmd = 0; e.w += (0 - e.w) * Math.min(1, dt / 0.08); }
    } else {
      e.lost = 0;
      if (!e.armed) {
        if (us <= 1060) { e.armT += dt; if (e.armT >= 0.4) { e.armed = true; e.refused = false; e.justArmed = true; } }
        else { e.armT = 0; e.refused = true; }
        e.cmd = 0;
      } else e.cmd = clamp((us - 1060) / (1940 - 1060), 0, 1);
    }
    if (e.armed && us != null) e.w += ((e.cmd || 0) - e.w) * Math.min(1, dt / 0.035);
    return e.w;
  }
  D.escStep = escStep;
  function propArt(cx, cy, r, cw, name) {
    var s = '<circle cx="' + fx(cx) + '" cy="' + fx(cy) + '" r="' + fx(r) + '" fill="none" stroke="' + (cw ? "#3a8ad8" : "#e85d3a") + '" stroke-width="1.2" stroke-dasharray="3 4" opacity=".7"/>';
    s += '<g data-live="' + name + '"><path d="M' + fx(cx - r * 0.92) + ' ' + fx(cy) + 'q' + fx(r * 0.46) + ' -' + fx(r * 0.16) + ' ' + fx(r * 0.92) + ' 0q' + fx(r * 0.46) + ' ' + fx(r * 0.16) + ' ' + fx(r * 0.92) + ' 0q-' + fx(r * 0.46) + ' ' + fx(r * 0.12) + ' -' + fx(r * 0.92) + ' 0q-' + fx(r * 0.46) + ' -' + fx(r * 0.12) + ' -' + fx(r * 0.92) + ' 0z" fill="' + (cw ? "#2f5ab8" : "#c8452a") + '" opacity=".92"/></g>';
    s += '<circle cx="' + fx(cx) + '" cy="' + fx(cy) + '" r="' + fx(r * 0.2) + '" fill="#3a3f45" stroke="#111"/><circle cx="' + fx(cx) + '" cy="' + fx(cy) + '" r="' + fx(r * 0.07) + '" fill="#c9ced3"/>';
    return s;
  }
  function spinProp(g, ang, cx, cy, w) {
    if (!g) return;
    g.setAttribute("transform", "rotate(" + fx(ang % 360) + " " + fx(cx) + " " + fx(cy) + ")");
    g.setAttribute("opacity", w > 0.3 ? fx(1 - Math.min(0.75, w)) : "1");
  }
  add("esc_motor", {
    name: "ESC + brushless motor (30 A, 920 KV)", cat: "Drone",
    blurb: "An electronic speed controller and the motor it spins. Its signal is a servo pulse: 1000 µs stop, 2000 µs full power — use Servo.writeMicroseconds(). It arms only after it sees 1000 µs for a moment (two rising beeps), so send that first. Power from the LiPo, never from the board. Bench test with the propeller OFF.",
    pins: [{ n: "SIG", x: 0, y: 0, label: "signal (white)" }, { n: "GND", x: P, y: 0, label: "signal ground (black)" }, { n: "BAT+", x: 3 * P, y: 0, label: "battery + (red, thick)" }, { n: "BAT-", x: 4 * P, y: 0, label: "battery − (black, thick)" }],
    box: { x: -1.6 * P, y: -14.6 * P, w: 10.4 * P, h: 15.2 * P },
    props: { prop: false, spin: "cw" },
    toggle: "prop",
    spec: [{ k: "prop", label: "Propeller fitted", type: "bool", live: true },
      { k: "spin", label: "Turns", type: "select", options: [["cw", "clockwise"], ["ccw", "anticlockwise"]] }],
    art: function (part, pr) {
      var s = "", cx = 3.6 * P, cy = -10.4 * P;
      s += '<path d="M0 0V' + fx(-1.6 * P) + '" stroke="#e9e9e9" stroke-width="3"/><path d="M' + P + ' 0V' + fx(-1.6 * P) + '" stroke="#2a2a2c" stroke-width="3"/>';
      s += '<path d="M' + 3 * P + ' 0V' + fx(-1.6 * P) + '" stroke="#d43a2f" stroke-width="5"/><path d="M' + 4 * P + ' 0V' + fx(-1.6 * P) + '" stroke="#2a2a2c" stroke-width="5"/>';
      s += shadow(-0.6 * P, -4.8 * P, 5.8 * P, 3.2 * P, 3) + rect(-0.6 * P, -4.8 * P, 5.8 * P, 3.2 * P, 3, "#3058c8", ' stroke="#1d3a8c" stroke-width="1.5"');
      s += text(2.3 * P, -3.6 * P, "ESC 30A", 8, "#e8eef4", { weight: 900 }) + text(2.3 * P, -2.5 * P, "BLHeli", 6, "#c8d4ff", { weight: 700 });
      s += ledG("led", 4.6 * P, -4.2 * P, 3, "#1a3a1a");
      [-0.6, 0, 0.6].forEach(function (k, i) { s += '<path d="M' + fx(2.3 * P + k * P) + ' ' + fx(-4.8 * P) + 'V' + fx(cy + 2 * P) + '" stroke="' + ["#d4ad4a", "#2a2a2c", "#c03030"][i] + '" stroke-width="2.4"/>'; });
      s += '<circle cx="' + fx(cx) + '" cy="' + fx(cy) + '" r="' + fx(1.9 * P) + '" fill="#1d1d1f" stroke="#555" stroke-width="2"/>';
      s += '<circle cx="' + fx(cx) + '" cy="' + fx(cy) + '" r="' + fx(1.3 * P) + '" fill="#c9a03c" stroke="#7a5a12"/>';
      s += '<g data-live="bell">';
      for (var i = 0; i < 6; i++) s += '<path d="M' + fx(cx) + ' ' + fx(cy) + 'l' + fx(1.2 * P) + ' 0" stroke="#7a5a12" stroke-width="2" transform="rotate(' + i * 60 + ' ' + fx(cx) + ' ' + fx(cy) + ')"/>';
      s += '</g>';
      s += '<g data-live="prop" opacity="0">' + propArt(cx, cy, 3.6 * P, pr.spin !== "ccw", "blade") + '</g>';
      s += '<g data-live="rpm">' + text(cx, cy - 4.4 * P, "", 7.5, "#2a6a2a", { weight: 800 }) + '</g>';
      return s;
    },
    live: function (g, st, pr) {
      var cx = 3.6 * P, cy = -10.4 * P;
      L.setFill(g.led, st.armed ? (st.w > 0.02 ? "#3dff7a" : "#2a9a4a") : (st.beep ? "#ff3b30" : "#1a3a1a"));
      if (g.bell) g.bell.setAttribute("transform", "rotate(" + fx((st.ang || 0) % 360) + " " + fx(cx) + " " + fx(cy) + ")");
      if (g.prop) g.prop.setAttribute("opacity", pr.prop ? 1 : 0);
      if (g.blade) spinProp(g.blade, st.ang || 0, cx, cy, st.w || 0);
      setText(g.rpm, st.on ? (st.armed ? Math.round(st.rpm || 0) + " rpm" + (pr.prop ? " · " + Math.round(st.grams || 0) + " g thrust" : "") : st.refused ? "won't arm" : "beep… not armed") : "");
    }
  });
  MODELS.esc_motor = {
    dynamic: true,
    build: function (b) { return { sig: Rr(b, "SIG", "GND", 1e5), load: Rr(b, "BAT+", "BAT-", 500), e: escNew(), ang: 0 }; },
    pre: function (m, ctx) {
      var v = vAcross(ctx, m.load), w = m.e.w;
      var amps = v > 6 ? 0.12 + (ctx.props.prop ? 16 : 0.9) * Math.pow(w, 1.5) * (v / 11.1) : 0;
      setR(m.load, amps > 0 ? Math.max(0.05, v / amps) : 1e5);
    },
    post: function (m, ctx) {
      var st = ctx.st, pr = ctx.props, dt = dtOf(ctx), v = vAcross(ctx, m.load), sim = ctx.sim;
      var us = sim.servoUsOn(m.sig.n[0]);
      var w = escStep(m.e, us, v, dt);
      st.on = v > 6; st.armed = m.e.armed; st.refused = m.e.refused; st.w = w; st.us = us;
      st.rpm = w * 920 * v * 0.85; st.grams = pr.prop ? 850 * w * w * Math.pow(v / 11.1, 2) : 0;
      m.ang += (pr.spin === "ccw" ? -1 : 1) * st.rpm / 60 * 360 * dt * 0.02;
      st.ang = m.ang; st.i = iThrough(m.load);
      st.beep = !m.e.armed && st.on && (sim.t % 1.2) < 0.15;
      if (m.e.justArmed) { m.e.justArmed = false; sim.event(ctx.part.id, "armed"); }
      if (v > 0.5 && v <= 6) warn(ctx, "warn", "lowv", "An ESC needs the LiPo (7–26 V) on BAT+ and BAT−, not " + fx(v) + " V.");
      if (v < -1) warn(ctx, "danger", "reverse", "The ESC's battery leads are swapped. A real ESC is destroyed instantly — and there is no fuse.");
      if (st.on && us == null && sim.mcuRunning) warn(ctx, "info", "nosig", "The ESC has power but no signal, so it just beeps. SIG to a pin, Servo esc; esc.attach(pin); esc.writeMicroseconds(1000);");
      if (st.on && m.e.refused && us != null) warn(ctx, "warn", "noarm", "The ESC won't arm: the first pulses it saw were " + Math.round(us) + " µs, not the 1000 µs 'throttle down'. Send esc.writeMicroseconds(1000) for a second before anything else.");
      if (pr.prop && w > 0.05) warn(ctx, "warn", "propbench", "A spinning propeller on the bench cuts fingers to the bone. Clamp the motor down, or take the prop off for tests.");
      if (st.on && !ctx.pinWired("GND") && us != null) warn(ctx, "info", "nogndsig", "Join the ESC's signal ground to the board's ground, or the pulses have nothing to be measured against.");
    },
    reset: function (m) { m.e = escNew(); m.ang = 0; }
  };

  /* --- RC receiver: the pilot's sticks, six channels of 1000-2000 µs
   * pulses, fifty a second. pulseIn(pin, HIGH) measures one. */
  var CH_NAMES = ["CH1", "CH2", "CH3", "CH4", "CH5", "CH6"];
  add("rc_receiver", {
    name: "RC receiver (6-channel PWM)", cat: "Drone",
    blurb: "What the pilot's transmitter sticks become: six pulses of 1000–2000 µs, fifty times a second. CH1 roll, CH2 pitch, CH3 throttle, CH4 yaw, CH5 the arm switch, CH6 the flight-mode switch. Read one with pulseIn(pin, HIGH, 25000). If the radio link drops, the pulses stop — and pulseIn() returns 0: that is your failsafe.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: P, y: 0 }].concat(CH_NAMES.map(function (n, i) { return { n: n, x: (i + 2) * P, y: 0, label: ["roll", "pitch", "throttle", "yaw", "arm switch", "mode switch"][i] }; })),
    box: { x: -0.8 * P, y: -6.6 * P, w: 9.6 * P, h: 7.2 * P },
    props: { thr: 0, roll: 0, pitch: 0, yaw: 0, arm: false, mode: 0, lost: false },
    toggle: "arm",
    spec: [{ k: "thr", label: "Throttle stick", type: "range", min: 0, max: 100, step: 1, unit: "%", live: true },
      { k: "roll", label: "Roll stick (right +)", type: "range", min: -100, max: 100, step: 1, unit: "%", live: true },
      { k: "pitch", label: "Pitch stick (forward +)", type: "range", min: -100, max: 100, step: 1, unit: "%", live: true },
      { k: "yaw", label: "Yaw stick (right +)", type: "range", min: -100, max: 100, step: 1, unit: "%", live: true },
      { k: "arm", label: "Arm switch (CH5)", type: "bool", live: true },
      { k: "mode", label: "Mode switch (CH6)", type: "select", options: [[0, "position 1 — 1000 µs"], [1, "position 2 — 1500 µs"], [2, "position 3 — 2000 µs"]], live: true },
      { k: "lost", label: "Radio link lost (out of range)", type: "bool", live: true }],
    art: function () {
      var s = header(["VCC", "GND"].concat(CH_NAMES), "#e8eef4");
      s += board(-0.6 * P, -4.6 * P, 9.2 * P, 4.2 * P, "#1d1d1f", "#000");
      s += text(4 * P, -3.6 * P, "RX · 2.4 GHz", 7, "#cfd5da", { weight: 800 });
      s += '<path d="M' + fx(7.8 * P) + ' ' + fx(-4.6 * P) + 'l' + fx(0.6 * P) + ' -' + fx(1.8 * P) + 'M' + fx(7 * P) + ' ' + fx(-4.6 * P) + 'l-' + fx(0.2 * P) + ' -' + fx(1.9 * P) + '" stroke="#c9ced3" stroke-width="1.6"/>';
      s += ledG("led", 0.4 * P, -3.6 * P, 3, "#3a1010");
      s += '<g data-live="sticks">' + text(4 * P, -2.1 * P, "", 6.5, "#8fd14f", { weight: 700 }) + '</g>';
      return s;
    },
    live: function (g, st, pr) {
      L.setFill(g.led, st.on ? (pr.lost ? ((Date.now() / 250 | 0) % 2 ? "#ff3b30" : "#3a1010") : "#3dff7a") : "#3a1010");
      setText(g.sticks, st.on ? (pr.lost ? "NO SIGNAL — failsafe" : "T" + Math.round(pr.thr) + " R" + Math.round(pr.roll) + " P" + Math.round(pr.pitch) + " Y" + Math.round(pr.yaw) + (pr.arm ? " ARMED" : "")) : "");
    }
  });
  D.channelUs = function (pr) {
    return [1500 + 5 * clamp(+pr.roll || 0, -100, 100), 1500 + 5 * clamp(+pr.pitch || 0, -100, 100), 1000 + 10 * clamp(+pr.thr || 0, 0, 100),
            1500 + 5 * clamp(+pr.yaw || 0, -100, 100), pr.arm ? 2000 : 1000, 1000 + 500 * clamp(+pr.mode || 0, 0, 2)];
  };
  MODELS.rc_receiver = {
    dynamic: true,
    build: function (b) {
      var m = { pwr: Rr(b, "VCC", "GND", 120), ch: [] };
      CH_NAMES.forEach(function (n) { m.ch.push(Vs(b, n, "GND", 0, 1000)); });
      return m;
    },
    pre: function (m, ctx) {
      var on = vAcross(ctx, m.pwr) > 3.5, us = D.channelUs(ctx.props);
      /* between pulses the line is low; a pulse is 1-2 ms of 3.3 V in every 20 */
      m.ch.forEach(function (c, i) { if (!on || ctx.props.lost) off(c); else setV(c, (ctx.sim.t * 1e6 % 20000) < us[i] ? 3.3 : 0, 1000); });
    },
    post: function (m, ctx) {
      var v = vAcross(ctx, m.pwr);
      ctx.st.on = v > 3.5; ctx.st.us = D.channelUs(ctx.props);
      if (v > 0.5 && v <= 3.5) warn(ctx, "warn", "lowpower", "The receiver needs 5 V.");
      if (ctx.st.on && ctx.props.lost) warn(ctx, "info", "lost", "The radio link is lost: no pulses on any channel. A safe drone notices (pulseIn() gives 0) and lands or comes home — it never keeps the last throttle.");
    }
  };
  Sim.prototype.pulseWidthOn = function (mcuId, num) {
    var node = nodeOfMcuPin(this, mcuId, num), self = this, hit = null;
    if (!node) return null;
    partsOfType(this, "rc_receiver").forEach(function (it) {
      var st = self.state[it.part.id] || {}, pr = L.propsOf(it.part);
      if (hit != null || !st.on || pr.lost) return;
      it.m.ch.forEach(function (c, i) { if (c.n[0] === node) hit = D.channelUs(pr)[i]; });
    });
    return hit;
  };

  /* --- The quadcopter: an X frame, 450 mm across, four 920 KV motors on
   * 30 A ESCs and a power board with a 5 V output for the controller.
   *
   *        front
   *   M4 (cw)   M2 (ccw)
   *        \   /
   *         [ ]
   *        /   \
   *   M3 (ccw)  M1 (cw)       (Betaflight / ArduPilot "Quad X" numbering)
   *
   * Thrust goes as the square of motor speed; a motor answers in about
   * 35 ms. Left motors faster rolls it right; front faster pitches the
   * nose up; the anticlockwise pair faster yaws it clockwise. */
  var ARM = 0.225 / Math.SQRT2;
  var MOTORS = [{ n: "M1", x: -1, y: 1, cw: true }, { n: "M2", x: 1, y: 1, cw: false }, { n: "M3", x: -1, y: -1, cw: false }, { n: "M4", x: 1, y: -1, cw: true }];
  D.MOTORS = MOTORS;
  var QF = { cx: 6 * P, cy: -10 * P, a: 5.2 * P };
  function quadPos(i) { var mo = MOTORS[i]; return { x: QF.cx + mo.y * QF.a, y: QF.cy - mo.x * QF.a }; }
  add("quad_frame", {
    name: "Quadcopter (X frame, 4 motors + ESCs)", cat: "Drone",
    blurb: "A whole quadcopter: four motors on ESCs and a power board. M1–M4 are the ESC signals (servo pulses, 1000–2000 µs). LiPo to BAT+ / BAT−; 5V and GND power the flight controller. It really flies — and nothing keeps it level except your program reading the IMU. Unstabilised, it flips over in a second.",
    pins: MOTORS.map(function (mo, i) { return { n: mo.n, x: i * P, y: 0, label: mo.n + " signal (" + ["rear right", "front right", "rear left", "front left"][i] + ", " + (mo.cw ? "clockwise" : "anticlockwise") + ")" }; })
      .concat([{ n: "GND", x: 4 * P, y: 0, label: "ground (= BAT−)" }, { n: "5V", x: 5 * P, y: 0, label: "5 V out, for the controller" }, { n: "BAT+", x: 7 * P, y: 0, label: "LiPo +" }, { n: "BAT-", x: 8 * P, y: 0, label: "LiPo −" }]),
    box: { x: -1.2 * P, y: -19 * P, w: 14.4 * P, h: 19.6 * P },
    props: { mass: 1200, twr: 2.8, wind: 0, windDir: 270, gusts: 30, props: true },
    spec: [{ k: "props", label: "Propellers fitted (off: a safe bench test)", type: "bool", live: true },
      { k: "mass", label: "Take-off weight", type: "range", min: 500, max: 3000, step: 50, unit: "g" },
      { k: "twr", label: "Thrust : weight at full power", type: "range", min: 1.2, max: 5, step: 0.1, unit: "×" },
      { k: "wind", label: "Wind", type: "range", min: 0, max: 15, step: 0.5, unit: "m/s", live: true },
      { k: "windDir", label: "Wind from", type: "range", min: 0, max: 359, step: 5, unit: "°", live: true },
      { k: "gusts", label: "Gusts and turbulence", type: "range", min: 0, max: 100, step: 5, unit: "%", live: true }],
    art: function () {
      var s = "", cx = QF.cx, cy = QF.cy;
      MOTORS.forEach(function (mo, i) { var x = i * P; s += '<path d="M' + x + ' 0V' + fx(-1.6 * P) + '" stroke="' + ["#e9e9e9", "#e9e9e9", "#e9e9e9", "#e9e9e9"][i] + '" stroke-width="2.4"/>'; });
      s += '<path d="M' + 4 * P + ' 0V' + fx(-1.6 * P) + '" stroke="#2a2a2c" stroke-width="2.4"/><path d="M' + 5 * P + ' 0V' + fx(-1.6 * P) + '" stroke="#d43a2f" stroke-width="2.4"/>';
      s += '<path d="M' + 7 * P + ' 0V' + fx(-1.6 * P) + '" stroke="#d43a2f" stroke-width="5"/><path d="M' + 8 * P + ' 0V' + fx(-1.6 * P) + '" stroke="#2a2a2c" stroke-width="5"/>';
      s += '<g data-live="frame">';
      MOTORS.forEach(function (mo, i) {
        var q = quadPos(i);
        s += '<path d="M' + fx(cx) + ' ' + fx(cy) + 'L' + fx(q.x) + ' ' + fx(q.y) + '" stroke="' + (mo.x > 0 ? "#e2574c" : "#2b2f36") + '" stroke-width="9" stroke-linecap="round"/>';
      });
      s += shadow(cx - 2.2 * P, cy - 2.2 * P, 4.4 * P, 4.4 * P, 8) + rect(cx - 2.2 * P, cy - 2.2 * P, 4.4 * P, 4.4 * P, 8, "#2b2f36", ' stroke="#111" stroke-width="1.5"');
      s += rect(cx - 1.3 * P, cy - 1.3 * P, 2.6 * P, 2.6 * P, 3, "#17603f") + '<path d="M' + fx(cx) + ' ' + fx(cy - 1.1 * P) + 'l5 8h-10z" fill="#e8eef4"/>';
      MOTORS.forEach(function (mo, i) {
        var q = quadPos(i);
        s += propArt(q.x, q.y, 2.3 * P, mo.cw, "p" + i);
        s += text(q.x, q.y + (mo.x > 0 ? -2.9 * P : 2.9 * P), mo.n + (mo.cw ? " ↻" : " ↺"), 7, "#30363d", { weight: 800 });
      });
      s += '</g>';
      s += text(cx, cy - 8.6 * P, "FRONT", 7, "#e2574c", { weight: 900 });
      s += '<g data-live="hud">' + text(cx, -2.2 * P, "", 7.5, "#2a6a2a", { weight: 800 }) + '</g>';
      return s;
    },
    live: function (g, st) {
      for (var i = 0; i < 4; i++) { var q = quadPos(i); spinProp(g["p" + i], (st.ang ? st.ang[i] : 0), q.x, q.y, st.w ? st.w[i] : 0); }
      if (g.frame) {
        /* seen from above: tilt shows as a squash along the tilted axis */
        var sx = Math.cos((st.roll || 0) * D2R), sy = Math.cos((st.pitch || 0) * D2R);
        g.frame.setAttribute("transform", "translate(" + fx(QF.cx) + " " + fx(QF.cy) + ") rotate(" + fx(st.yaw || 0) + ") scale(" + fx(Math.max(0.15, Math.abs(sx)), 3) + " " + fx(Math.max(0.15, Math.abs(sy)), 3) + ") translate(" + fx(-QF.cx) + " " + fx(-QF.cy) + ")");
      }
      setText(g.hud, !st.on ? "no battery" : st.crashed ? "CRASHED — " + st.crashed : st.air ? "flying · " + fx(st.z) + " m · " + fx(st.gs) + " m/s" : st.armedN ? st.armedN + "/4 ESCs armed" + (st.w && Math.max.apply(null, st.w) > 0.02 ? " · spinning" : "") : "ESCs waiting for 1000 µs");
    }
  });
  /* no two motors and props are quite alike: a couple of per cent either way */
  function motorSpread() { return [0, 1, 2, 3].map(function (i) { return 1 + (i % 2 ? 1 : -1) * (0.015 + 0.02 * Math.random()); }); }
  function flightBlank() {
    return { x: 0, y: 0, z: 0, vn: 0, ve: 0, vu: 0, an: 0, ae: 0, au: 0, roll: 0, pitch: 0, yaw: 0, p: 0, q: 0, r: 0, air: false, crashed: "", topZ: 0 };
  }
  MODELS.quad_frame = {
    dynamic: true,
    build: function (b) {
      var m = { sig: MOTORS.map(function (mo) { return Rr(b, mo.n, "GND", 1e5); }), load: Rr(b, "BAT+", "BAT-", 500), gnd: Rr(b, "GND", "BAT-", 0.002),
                bec: Vs(b, "5V", "GND", 5, 0.08), esc: [escNew(), escNew(), escNew(), escNew()], ang: [0, 0, 0, 0], f: flightBlank(), k: motorSpread() };
      return m;
    },
    pre: function (m, ctx) {
      var v = vAcross(ctx, m.load), amps = 0.4;
      if (v > 6) setV(m.bec, 5, 0.08); else off(m.bec);
      var load = ctx.props.props !== false ? 15.5 : 0.8;
      m.esc.forEach(function (e) { amps += 0.12 + load * Math.pow(e.w, 1.5) * (v / 11.1); });
      setR(m.load, v > 6 ? Math.max(0.03, v / amps) : 1e5);
      m.amps = v > 6 ? amps : 0;
    },
    post: function (m, ctx) {
      var st = ctx.st, pr = ctx.props, sim = ctx.sim, dt = dtOf(ctx), f = m.f, v = vAcross(ctx, m.load);
      var mass = (+pr.mass || 1200) / 1000, fitted = pr.props !== false;
      var Tmax = (+pr.twr || 2.8) * mass * G / 4, vk = clamp(v / 11.1, 0, 1.6);
      var us = m.sig.map(function (s) { return sim.servoUsOn(s.n[0]); });
      var T = [0, 0, 0, 0], armedN = 0, w = [];
      for (var i = 0; i < 4; i++) {
        var wi = f.crashed ? 0 : escStep(m.esc[i], us[i], v, dt);
        if (f.crashed) m.esc[i].w = 0;
        w.push(wi);
        if (m.esc[i].armed) armedN++;
        T[i] = fitted ? Tmax * m.k[i] * wi * wi * vk * vk : 0;
        m.ang[i] += (MOTORS[i].cw ? 1 : -1) * wi * 50 * 360 * dt * 0.02;
      }
      /* -------- the rigid body: torques, then forces, every millisecond */
      var Ixx = 0.0105 * mass / 1.2, Iyy = Ixx, Izz = 0.02 * mass / 1.2, kq = 0.016;
      var tRoll = ARM * (T[2] + T[3] - T[0] - T[1]);          /* left side up: rolls right */
      var tPitch = ARM * (T[1] + T[3] - T[0] - T[2]);         /* front up: nose up */
      var tYaw = kq * (T[1] + T[2] - T[0] - T[3]);            /* anticlockwise props turn the body clockwise */
      var Tsum = T[0] + T[1] + T[2] + T[3];
      var gust = clamp(+pr.gusts || 0, 0, 100) / 100, wind = +pr.wind || 0;
      var turb = 0.05 + gust * (0.3 + wind / 15);
      if (f.air) {
        tRoll += wander(m, "_gr", 0.06 * turb, 0.25, dt);
        tPitch += wander(m, "_gp", 0.06 * turb, 0.25, dt);
        tYaw += wander(m, "_gy", 0.02 * turb, 0.4, dt);
        f.p += (tRoll / Ixx - 1.6 * f.p * D2R) * dt * R2D;
        f.q += (tPitch / Iyy - 1.6 * f.q * D2R) * dt * R2D;
        f.r += (tYaw / Izz - 2.5 * f.r * D2R) * dt * R2D;
        f.roll += f.p * dt; f.pitch += f.q * dt; f.yaw = wrap360(f.yaw + f.r * dt);
        if (f.roll > 180) f.roll -= 360; if (f.roll < -180) f.roll += 360;
        f.pitch = clamp(f.pitch, -179, 179);
      }
      /* world forces: thrust along the body's up, gravity, drag against the air */
      var cf = Math.cos(f.roll * D2R), sf = Math.sin(f.roll * D2R), ct = Math.cos(f.pitch * D2R), stt = Math.sin(f.pitch * D2R), cp = Math.cos(f.yaw * D2R), sp = Math.sin(f.yaw * D2R);
      var from = (+pr.windDir || 0) * D2R, gw = wind * (1 + 0.5 * gust * wander(m, "_gw", 1, 1.5, dt));
      f.wn = -Math.cos(from) * gw; f.we = -Math.sin(from) * gw;
      var Fn = -Tsum * (cf * stt * cp + sf * sp), Fe = -Tsum * (cf * stt * sp - sf * cp), Fu = Tsum * cf * ct;
      Fn -= 0.35 * (f.vn - f.wn); Fe -= 0.35 * (f.ve - f.we); Fu -= 0.5 * f.vu;
      f.an = Fn / mass; f.ae = Fe / mass; f.au = Fu / mass - G;
      if (!f.air) {
        /* sitting on its legs: the ground pushes back until thrust lifts it */
        if (f.au > 0.05 && !f.crashed) { f.air = true; sim.event(ctx.part.id, "takeoff"); }
        else { f.an = f.ae = f.au = 0; f.vn = f.ve = f.vu = 0; f.p = f.q = f.r = 0; if (!f.crashed) { f.roll *= 0.9; f.pitch *= 0.9; } }
      }
      if (f.air) {
        f.vn += f.an * dt; f.ve += f.ae * dt; f.vu += f.au * dt;
        f.x += f.vn * dt; f.y += f.ve * dt; f.z += f.vu * dt;
        f.topZ = Math.max(f.topZ, f.z);
        if (f.z <= 0) {
          var hit = -f.vu, tilt = Math.max(Math.abs(f.roll), Math.abs(f.pitch));
          f.z = 0; f.air = false;
          if (tilt > 60) f.crashed = "landed on its back";
          else if (hit > 3) f.crashed = "hit the ground at " + fx(hit) + " m/s";
          else if (Math.hypot(f.vn, f.ve) > 4) f.crashed = "touched down sideways at " + fx(Math.hypot(f.vn, f.ve)) + " m/s";
          f.vn = f.ve = f.vu = 0; f.p = f.q = f.r = 0; f.an = f.ae = f.au = 0;
          if (f.crashed) { sim.event(ctx.part.id, "crash", { why: f.crashed }); f.roll = clamp(f.roll, -90, 90); }
          else { f.roll = 0; f.pitch = 0; sim.event(ctx.part.id, "landed"); }
        }
      }
      /* what the sensors feel, and what the bench shows */
      f.live = v > 6 || f.air; f.t = sim.t; f.id = ctx.part.id;
      f.thrAvg = (w[0] + w[1] + w[2] + w[3]) / 4; f.amps = m.amps || 0; f.vbat = v; f.armed = armedN;
      f.gs = Math.hypot(f.vn, f.ve); f.mass = mass;
      sim.flight = f;
      st.on = v > 6; st.w = w; st.ang = m.ang; st.armedN = armedN; st.crashed = f.crashed; st.air = f.air;
      st.roll = f.roll; st.pitch = f.pitch; st.yaw = f.yaw; st.z = f.z; st.gs = f.gs; st.x = f.x; st.y = f.y; st.thrust = Tsum; st.us = us;
      if (v > 0.5 && v <= 6) warn(ctx, "warn", "lowv", "The quadcopter needs a LiPo (3S, 11.1 V) on BAT+ and BAT−.");
      if (v < -1) warn(ctx, "danger", "reverse", "The LiPo is plugged in backwards. Every ESC on a real drone would be destroyed.");
      if (f.crashed) warn(ctx, "danger", "crash", "Crashed: it " + f.crashed + ". Press ■ then ▶ to put it back on the pad. Most crashes are a stabiliser that pushes the wrong way (check the signs), or too much gain.");
      if (f.air && f.z > 120) warn(ctx, "warn", "ceiling", "Above 120 m (400 ft): higher than drones may fly in most countries, and up where manned aircraft are. Come down.");
      if (st.on && !f.air && sim.mcuRunning && us.every(function (u) { return u == null; })) warn(ctx, "info", "nosig", "The ESCs have power but no signal. M1–M4 go to four pins with Servo.attach(), and send 1000 µs first so they arm.");
      if (f.air && fitted && Tmax * 4 < mass * G * 1.05) warn(ctx, "warn", "weak", "At full power these motors only just lift this weight. Aim for at least 2 : 1 thrust to weight.");
      var refused = m.esc.filter(function (e) { return e.refused; }).length;
      if (st.on && refused && !armedN) warn(ctx, "warn", "noarm", "The ESCs won't arm: they must see 1000 µs (throttle down) for a moment first. In setup(), writeMicroseconds(1000) to all four and wait a second.");
    },
    reset: function (m) { m.esc = [escNew(), escNew(), escNew(), escNew()]; m.ang = [0, 0, 0, 0]; m.f = flightBlank(); m.k = motorSpread(); }
  };
  /* A new run starts with the drone back on the pad. */
  var oldLoad = Sim.prototype.load, oldReset = Sim.prototype.reset;
  Sim.prototype.load = function () { this.flight = null; return oldLoad.apply(this, arguments); };
  Sim.prototype.reset = function () { this.flight = null; return oldReset.apply(this, arguments); };

  /* ====================================================== GROUND STATION */

  /* --- ADS-B receiver: manned aircraft broadcast where they are on
   * 1090 MHz. This hears them and says so on TX, once a second:
   *   TRF id=3C6514 cs=DLH4AB brg=45 dist=2840 alt=610 trk=230 spd=118
   * (bearing and distance from the receiver, height in metres above it). */
  var TRAFFIC = [
    { id: "3C6514", cs: "SN205", cpa: 1400, alt: 450, spd: 62, trk: 200, lead: 50 },
    { id: "06A1E2", cs: "AFR719", cpa: 3200, alt: 900, spd: 110, trk: 70, lead: 35 },
    { id: "4CA7F3", cs: "MEDEVAC1", cpa: 350, alt: 180, spd: 45, trk: 320, lead: 80 }
  ];
  add("adsb_rx", {
    name: "ADS-B traffic receiver (1090 MHz)", cat: "Ground station",
    blurb: "Manned aircraft broadcast their position, height and speed (ADS-B). This receiver hears them and reports each one once a second on TX as a line of text: TRF id=… cs=… brg=… dist=… alt=…. Wire TX to a ground station display's RX, or to a board to make your own alerts. Drones give way to every manned aircraft.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: P, y: 0 }, { n: "TXD", x: 2 * P, y: 0, label: "TX" }],
    box: { x: -1 * P, y: -11.4 * P, w: 6 * P, h: 12 * P },
    props: { traffic: 2 },
    spec: [{ k: "traffic", label: "Aircraft about", type: "range", min: 0, max: 3, step: 1, live: true }],
    art: function () {
      var s = header(["VCC", "GND", "TX"]);
      s += board(-0.8 * P, -5.4 * P, 5.6 * P, 5 * P, "#e8eef4", "#9aa1a6");
      s += text(2 * P, -4.3 * P, "ADS-B IN", 8, "#2b2f36", { weight: 900 }) + text(2 * P, -3.2 * P, "1090 MHz", 6.5, "#59636b", { weight: 700 });
      s += ledG("led", 4 * P, -1.2 * P, 3, "#1a3a1a");
      s += rect(1.6 * P, -11 * P, 0.8 * P, 5.6 * P, 3, "#2b2f36");
      s += '<g data-live="count">' + text(2 * P, -2 * P, "", 6.5, "#2a6a2a", { weight: 800 }) + '</g>';
      return s;
    },
    live: function (g, st) { L.setFill(g.led, st.on && st.blink ? "#3dff7a" : "#1a3a1a"); setText(g.count, st.on ? (st.traffic ? st.traffic.length : 0) + " aircraft" : ""); }
  });
  D.trafficAt = function (t, n, from) {
    var out = [];
    for (var i = 0; i < Math.min(n, TRAFFIC.length); i++) {
      var a = TRAFFIC[i], span = 16000, s = ((a.spd * t + span / 2 - a.spd * a.lead) % span + span) % span - span / 2;
      var tr = a.trk * D2R, n0 = -Math.sin(tr) * a.cpa, e0 = Math.cos(tr) * a.cpa;
      var pn = n0 + Math.cos(tr) * s, pe = e0 + Math.sin(tr) * s;
      var dn = pn - (from ? from.x : 0), de = pe - (from ? from.y : 0);
      out.push({ id: a.id, cs: a.cs, n: pn, e: pe, brg: wrap360(Math.atan2(de, dn) * R2D), dist: Math.hypot(dn, de), alt: a.alt, trk: a.trk, spd: a.spd });
    }
    return out;
  };
  MODELS.adsb_rx = {
    dynamic: true,
    build: function (b) { return { pwr: Rr(b, "VCC", "GND", 200), txd: Vs(b, "TXD", "GND", 3.3, 1000), next: 0 }; },
    pre: function () {},
    post: function (m, ctx) {
      var st = ctx.st, sim = ctx.sim, v = vAcross(ctx, m.pwr);
      st.on = v > 2.7;
      if (!st.on) { off(m.txd); st.traffic = []; return; }
      setV(m.txd, 3.3, 1000);
      st.traffic = D.trafficAt(sim.t, Math.round(clamp(+ctx.props.traffic || 0, 0, 3)));
      st.blink = (sim.t % 1) < 0.1 && st.traffic.length > 0;
      if (sim.t >= m.next) {
        m.next = Math.max(sim.t, m.next) + 1;
        var txt = st.traffic.map(function (a) { return "TRF id=" + a.id + " cs=" + a.cs + " brg=" + Math.round(a.brg) + " dist=" + Math.round(a.dist) + " alt=" + Math.round(a.alt) + " trk=" + a.trk + " spd=" + a.spd + "\n"; }).join("");
        if (txt && sim.uartQueue) sim.uartQueue(m.txd.n[0], txt, txt.length * 10 / 9600, null, "adsb" + ctx.part.id);
      }
    },
    reset: function (m) { m.next = 0; }
  };

  /* --- The ground station display: a primary flight display (an aviation
   * PFD — attitude, speed and altitude tapes, heading) or an FPV on-screen
   * display. It can listen on RX for telemetry lines a drone sends over a
   * radio (an HC-12 pair), or take the drone's state over its own link.
   *   TLM roll=-2.1 pitch=3.0 hdg=271 alt=12.4 vs=0.3 spd=4.2 aspd=5.0
   *       vbat=11.4 amp=8.2 rssi=92 sat=9 arm=1 mode=ANGLE
   * Any of the fields may be left out. TRF lines (from an ADS-B receiver)
   * on the same RX add traffic. */
  add("gcs_pfd", {
    name: "Ground station display (PFD / OSD)", cat: "Ground station",
    blurb: "The pilot's screen: artificial horizon, pitch ladder and roll scale, speed and altitude tapes, heading, climb rate, battery, signal and satellites, plus warnings — low battery, link lost, nearby manned traffic. Choose 'straight from the drone', or send it telemetry lines (TLM roll=… alt=…) on RX at 9600 baud through a radio, the way a real ground station gets them.",
    pins: [{ n: "VCC", x: 0, y: 0 }, { n: "GND", x: P, y: 0 }, { n: "RXD", x: 2 * P, y: 0, label: "RX (telemetry in)" }],
    box: { x: -1.4 * P, y: -19.6 * P, w: 29.8 * P, h: 20.2 * P },
    props: { source: "direct", style: "pfd" },
    spec: [{ k: "source", label: "Telemetry from", type: "select", options: [["direct", "straight from the drone (built-in link)"], ["serial", "TLM lines on RX (9600 baud)"]], live: true },
      { k: "style", label: "Screen", type: "select", options: [["pfd", "Primary flight display"], ["osd", "FPV on-screen display"]], live: true }],
    art: function () {
      var s = header(["VCC", "GND", "RX"]);
      s += shadow(-1.2 * P, -19.4 * P, 29.4 * P, 18.4 * P, 10) + rect(-1.2 * P, -19.4 * P, 29.4 * P, 18.4 * P, 10, "#1d1f24", ' stroke="#000" stroke-width="2"');
      s += rect(-0.4 * P, -18.6 * P, 27.8 * P, 16.8 * P, 4, "#050607");
      s += '<svg data-live="screen" x="' + fx(-0.2 * P) + '" y="' + fx(-18.4 * P) + '" width="' + fx(27.4 * P) + '" height="' + fx(16.4 * P) + '" viewBox="0 0 400 240" preserveAspectRatio="none"><rect width="400" height="240" fill="#050607"/><text x="200" y="124" fill="#3a4048" font-size="14" text-anchor="middle" font-family="ui-monospace,monospace">NO POWER</text></svg>';
      s += text(13.5 * P, -1.25 * P, "GROUND STATION", 6.5, "#59636b", { weight: 900 });
      return s;
    },
    live: function (g, st, pr) {
      if (!g.screen) return;
      var key = st.on ? JSON.stringify([st.d, st.alerts, st.tr, pr.style, st.age > 3]) : "off";
      if (g._key === key) return;
      g._key = key;
      g.screen.innerHTML = st.on ? D.pfdSvg(st, pr.style) : '<rect width="400" height="240" fill="#050607"/><text x="200" y="124" fill="#3a4048" font-size="14" text-anchor="middle" font-family="ui-monospace,monospace">NO POWER</text>';
    }
  });
  /* A telemetry line, as the display reads it. */
  D.parseLine = function (line) {
    var m = /^\s*(TLM|TRF)\b(.*)$/.exec(line);
    if (!m) return null;
    var out = { kind: m[1] };
    m[2].replace(/([a-z]+)=(\S+)/gi, function (_, k, v) { out[k.toLowerCase()] = isNaN(+v) ? v : +v; return ""; });
    return out;
  };
  Sim.prototype.pfdRx = function (it, text) {
    var st = this.state[it.part.id] || (this.state[it.part.id] = {});
    if (!st.on || L.propsOf(it.part).source !== "serial") return;
    st.buf = ((st.buf || "") + text).slice(-2000);
    var lines = st.buf.split("\n");
    st.buf = lines.pop();
    var self = this;
    lines.forEach(function (ln) {
      var r = D.parseLine(ln.replace(/\r$/, ""));
      if (!r) return;
      if (r.kind === "TLM") { st.tlm = Object.assign(st.tlm || {}, r); st.tlmT = self.t; st.lines = (st.lines || 0) + 1; }
      else { (st.trf = st.trf || {})[r.id || r.cs || "?"] = Object.assign(r, { t: self.t }); }
    });
  };
  /* Bytes on a wire reach the display's RX like they reach a board's. */
  var oldTick = Sim.prototype.uartTick;
  Sim.prototype.uartTick = function () {
    var self = this, now = this.t;
    if (this.uq && this.uq.length) {
      var shows = partsOfType(this, "gcs_pfd");
      if (shows.length) this.uq.forEach(function (q) {
        if (q.due > now || q.pfdSeen) return;
        q.pfdSeen = true;
        shows.forEach(function (it) { if (it.m.rx.n[0] === q.node) self.pfdRx(it, q.text); });
      });
    }
    return oldTick.apply(this, arguments);
  };
  MODELS.gcs_pfd = {
    dynamic: true,
    build: function (b) { return { pwr: Rr(b, "VCC", "GND", 60), rx: Rr(b, "RXD", "GND", 1e5) }; },
    pre: function () {},
    post: function (m, ctx) {
      var st = ctx.st, pr = ctx.props, sim = ctx.sim, v = vAcross(ctx, m.pwr);
      st.on = v > 4;
      if (v > 0.5 && v <= 4) warn(ctx, "warn", "lowpower", "The display needs 5 V.");
      if (!st.on) return;
      var d = {}, tr = [], alerts = [], f = sim.flight && sim.flight.live ? sim.flight : null;
      if (pr.source === "serial") {
        var t = st.tlm || {};
        st.age = st.tlmT != null ? sim.t - st.tlmT : 99;
        d = { roll: t.roll, pitch: t.pitch, hdg: t.hdg, alt: t.alt, vs: t.vs, spd: t.spd, aspd: t.aspd, vbat: t.vbat, amp: t.amp, rssi: t.rssi, sat: t.sat, arm: t.arm, mode: t.mode, cells: t.cells };
        Object.keys(st.trf || {}).forEach(function (k) { var a = st.trf[k]; if (sim.t - a.t < 3) tr.push({ cs: a.cs || a.id, brg: a.brg, dist: a.dist, alt: a.alt }); });
        if (st.age > 3) alerts.push(["red", st.tlmT == null ? "NO TELEMETRY" : "LINK LOST"]);
        if (st.age > 3 && st.tlmT == null && sim.mcuRunning && !ctx.pinWired("RXD")) warn(ctx, "info", "norx", "The display is waiting for telemetry on RX. Wire a radio's TX (or a board's TX) to it, and send lines like: TLM roll=1.2 pitch=-3 alt=10");
      } else {
        st.age = 0;
        var lipo = partsOfType(sim, "battery_lipo")[0], gps = partsOfType(sim, "gps_neo6m")[0], rx = partsOfType(sim, "rc_receiver")[0];
        var lst = lipo ? sim.state[lipo.part.id] || {} : {}, gst = gps ? sim.state[gps.part.id] || {} : {};
        if (f) d = { roll: f.roll, pitch: f.pitch, hdg: f.yaw, alt: f.z, vs: f.vu, spd: f.gs, vbat: f.vbat, amp: f.amps, arm: f.armed === 4 ? 1 : 0, mode: f.crashed ? "CRASH" : f.air ? "FLYING" : "LANDED" };
        if (lipo) { d.vbat = lst.v; d.cells = lst.cells; d.used = lst.used; }
        if (gps) d.sat = gst.on ? (gst.fix ? gst.sats : 0) : undefined;
        if (rx) d.rssi = (sim.state[rx.part.id] || {}).on && !L.propsOf(rx.part).lost ? 96 : 0;
        partsOfType(sim, "adsb_rx").forEach(function (a) {
          var ast = sim.state[a.part.id] || {};
          if (ast.on) D.trafficAt(sim.t, Math.round(clamp(+L.propsOf(a.part).traffic || 0, 0, 3)), f).forEach(function (q) { tr.push({ cs: q.cs, brg: q.brg, dist: q.dist, alt: q.alt }); });
        });
        if (!f) alerts.push(["amber", "NO DRONE"]);
      }
      var alt = d.alt || 0;
      tr.forEach(function (a) {
        var ralt = (a.alt || 0) - alt;
        a.ralt = ralt;
        if (a.dist < 1000 && Math.abs(ralt) < 300) { a.level = "red"; alerts.push(["red", "TRAFFIC " + a.cs + " " + fx(a.dist / 1000, 1) + "km " + (ralt >= 0 ? "▲" : "▼") + Math.abs(Math.round(ralt)) + "m — DESCEND, LAND"]); }
        else if (a.dist < 2500 && Math.abs(ralt) < 600) { a.level = "amber"; alerts.push(["amber", "TRAFFIC " + a.cs + " " + fx(a.dist / 1000, 1) + "km"]); }
      });
      var cells = d.cells || (d.vbat ? Math.max(1, Math.round(d.vbat / 3.9)) : 0);
      if (d.vbat && cells && d.vbat / cells < 3.5) alerts.push(["red", "LOW BATTERY " + fx(d.vbat / cells, 2) + "V/cell"]);
      if (d.sat != null && d.sat < 6 && d.sat >= 0) alerts.push(["amber", d.sat ? "GPS WEAK" : "NO GPS FIX"]);
      if (d.rssi != null && d.rssi < 30) alerts.push(["red", "RC LINK LOST"]);
      if (alt > 120) alerts.push(["amber", "ABOVE 120 m"]);
      if (d.mode === "CRASH") alerts.push(["red", "CRASHED"]);
      tr.forEach(function (a) { if (a.level === "red") warn(ctx, "warn", "traffic", "Manned aircraft " + a.cs + " is " + fx(a.dist / 1000, 1) + " km away and " + Math.abs(Math.round(a.ralt)) + " m " + (a.ralt >= 0 ? "above" : "below") + " the drone. Drones must give way: descend and land."); });
      st.d = d; st.tr = tr; st.alerts = alerts.slice(0, 3);
    }
  };

  /* ---------------------------------------------- drawing the display
   * A 400 x 240 picture of the screen, as SVG. Kept here, apart from the
   * bench, so it can be checked without a browser. */
  function esc(s) { return L.esc(String(s)); }
  function num(v, d) { return v == null || isNaN(v) ? "---" : (+v).toFixed(d == null ? 0 : d); }
  D.pfdSvg = function (st, style) {
    var d = st.d || {}, osd = style === "osd", s = "", W = 400, H = 240, cx = 200, cy = 112;
    var roll = +d.roll || 0, pitch = +d.pitch || 0, ppd = 3.2, mono = ' font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"';
    var stale = st.age > 3;
    /* the world: sky and ground, rolled and pitched */
    var att = 'transform="rotate(' + fx(-roll) + ' ' + cx + ' ' + cy + ') translate(0 ' + fx(pitch * ppd) + ')"';
    s += '<rect width="' + W + '" height="' + H + '" fill="' + (osd ? "#26313b" : "#000") + '"/>';
    s += '<g ' + att + '>';
    if (osd) {
      s += '<rect x="-400" y="-600" width="1200" height="' + (600 + cy) + '" fill="#6f8fae"/><rect x="-400" y="' + cy + '" width="1200" height="700" fill="#5b6a3e"/>';
      s += '<path d="M-400 ' + cy + 'H800" stroke="#fff" stroke-width="1.5" opacity=".55"/>';
    } else {
      s += '<rect x="-400" y="-600" width="1200" height="' + (600 + cy) + '" fill="#2a7fd6"/><rect x="-400" y="' + cy + '" width="1200" height="700" fill="#8a5a2b"/>';
      s += '<path d="M-400 ' + cy + 'H800" stroke="#fff" stroke-width="2"/>';
    }
    s += '</g>';
    /* the pitch ladder, kept inside the window between the tapes (a nested svg clips) */
    if (!osd) {
      s += '<svg x="58" y="30" width="284" height="164" viewBox="58 30 284 164" overflow="hidden"><g ' + att + '>';
      for (var pd = -60; pd <= 60; pd += 5) {
        if (!pd) continue;
        var y = cy - pd * ppd, wide = pd % 10 === 0 ? 34 : 16;
        s += '<path d="M' + (cx - wide) + ' ' + fx(y) + 'H' + (cx + wide) + '" stroke="#fff" stroke-width="1.4"/>';
        if (pd % 10 === 0) s += '<text x="' + (cx - wide - 4) + '" y="' + fx(y + 4) + '" fill="#fff" font-size="9" text-anchor="end"' + mono + '>' + Math.abs(pd) + '</text><text x="' + (cx + wide + 4) + '" y="' + fx(y + 4) + '" fill="#fff" font-size="9"' + mono + '>' + Math.abs(pd) + '</text>';
      }
      s += '</g></svg>';
    }
    /* roll scale */
    if (!osd) {
      [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60].forEach(function (a) {
        var r1 = 84, r2 = a % 30 === 0 ? 94 : 90, t = (a - 90) * D2R;
        s += '<path d="M' + fx(cx + r1 * Math.cos(t)) + ' ' + fx(cy + r1 * Math.sin(t)) + 'L' + fx(cx + r2 * Math.cos(t)) + ' ' + fx(cy + r2 * Math.sin(t)) + '" stroke="#fff" stroke-width="1.5"/>';
      });
      s += '<path d="M' + cx + ' ' + (cy - 84) + 'l-5 8h10z" fill="#ffd23a" transform="rotate(' + fx(-roll) + ' ' + cx + ' ' + cy + ')"/>';
    }
    /* the aeroplane symbol */
    var sym = osd ? "#fff" : "#ffd23a";
    s += '<path d="M' + (cx - 46) + ' ' + cy + 'h28l8 8M' + (cx + 46) + ' ' + cy + 'h-28l-8 8" stroke="#000" stroke-width="5" fill="none"/>';
    s += '<path d="M' + (cx - 46) + ' ' + cy + 'h28l8 8M' + (cx + 46) + ' ' + cy + 'h-28l-8 8" stroke="' + sym + '" stroke-width="3" fill="none"/><circle cx="' + cx + '" cy="' + cy + '" r="2.5" fill="' + sym + '"/>';
    /* tapes */
    function tape(x, val, unit, step, left) {
      var t = '<rect x="' + x + '" y="32" width="50" height="160" fill="#000" opacity="' + (osd ? 0.25 : 0.45) + '"/>';
      if (val != null && !isNaN(val)) {
        for (var k = Math.floor(val / step) - 4; k <= Math.floor(val / step) + 5; k++) {
          var yy = cy - (k * step - val) * (16 / step);
          if (yy < 36 || yy > 188) continue;
          t += '<path d="M' + (left ? x + 50 : x) + ' ' + fx(yy) + 'h' + (left ? -6 : 6) + '" stroke="#fff" stroke-width="1.2"/>';
          if (k % 2 === 0) t += '<text x="' + (left ? x + 40 : x + 10) + '" y="' + fx(yy + 3) + '" fill="#fff" font-size="9" text-anchor="' + (left ? "end" : "start") + '"' + mono + '>' + Math.round(k * step) + '</text>';
        }
      }
      t += '<rect x="' + (x + 2) + '" y="' + (cy - 10) + '" width="46" height="20" fill="#000" stroke="#fff" stroke-width="1.2"/>';
      t += '<text x="' + (x + 25) + '" y="' + (cy + 5) + '" fill="#3dff7a" font-size="12" font-weight="700" text-anchor="middle"' + mono + '>' + num(val, Math.abs(val) < 100 ? 1 : 0) + '</text>';
      t += '<text x="' + (x + 25) + '" y="27" fill="#cfd5da" font-size="8" text-anchor="middle"' + mono + '>' + unit + '</text>';
      return t;
    }
    s += tape(4, d.aspd != null ? d.aspd : d.spd, d.aspd != null ? "AIRSPD m/s" : "GND SPD m/s", 1, true);
    s += tape(346, d.alt, "ALT m", 2, false);
    /* climb rate */
    s += '<text x="372" y="204" fill="#cfd5da" font-size="9" text-anchor="middle"' + mono + '>VS ' + (d.vs > 0 ? "+" : "") + num(d.vs, 1) + '</text>';
    /* heading */
    var hdg = d.hdg;
    s += '<rect x="120" y="198" width="160" height="22" fill="#000" opacity="' + (osd ? 0.25 : 0.5) + '"/>';
    if (hdg != null && !isNaN(hdg)) {
      for (var hh = Math.floor(hdg / 10) * 10 - 40; hh <= hdg + 40; hh += 10) {
        var hx = cx + (hh - hdg) * 2;
        if (hx < 122 || hx > 278) continue;
        var lbl = { 0: "N", 90: "E", 180: "S", 270: "W" }[wrap360(hh)] || String(wrap360(hh) / 10);
        s += '<path d="M' + fx(hx) + ' 198v5" stroke="#fff"/><text x="' + fx(hx) + '" y="214" fill="#fff" font-size="9" text-anchor="middle"' + mono + '>' + lbl + '</text>';
      }
    }
    s += '<path d="M' + cx + ' 198l-5 -6h10z" fill="#ffd23a"/><text x="' + cx + '" y="232" fill="#ffd23a" font-size="10" font-weight="700" text-anchor="middle"' + mono + '>' + (hdg == null || isNaN(hdg) ? "---" : ("00" + Math.round(wrap360(hdg))).slice(-3)) + '°</text>';
    /* status bar */
    var cells = d.cells || (d.vbat ? Math.max(1, Math.round(d.vbat / 3.9)) : 0), cellV = d.vbat && cells ? d.vbat / cells : null;
    var bc = cellV == null ? "#cfd5da" : cellV < 3.5 ? "#ff3b30" : cellV < 3.7 ? "#ffd23a" : "#3dff7a";
    s += '<rect x="0" y="0" width="400" height="18" fill="#000" opacity="' + (osd ? 0.35 : 0.75) + '"/>';
    s += '<text x="6" y="13" fill="' + (d.arm ? "#ff3b30" : "#3dff7a") + '" font-size="10" font-weight="700"' + mono + '>' + (d.arm ? "ARMED" : "DISARMED") + (d.mode ? " " + esc(d.mode) : "") + '</text>';
    s += '<text x="190" y="13" fill="' + bc + '" font-size="10" font-weight="700"' + mono + '>' + num(d.vbat, 1) + 'V' + (d.amp != null ? " " + num(d.amp, 1) + "A" : "") + (d.used != null ? " " + Math.round(d.used) + "mAh" : "") + '</text>';
    s += '<text x="394" y="13" fill="#cfd5da" font-size="10" text-anchor="end"' + mono + '>RSSI ' + num(d.rssi) + ' SAT ' + num(d.sat) + '</text>';
    /* traffic inset: a little radar, 5 km to its edge, drone in the middle */
    var tr = st.tr || [];
    if (tr.length) {
      var rx0 = 336, ry0 = 52 + 160, rr = 0;
      rx0 = 70; ry0 = 64; rr = 26;
      s += '<circle cx="' + rx0 + '" cy="' + ry0 + '" r="' + rr + '" fill="#000" opacity=".55" stroke="#3dff7a" stroke-width=".8"/><circle cx="' + rx0 + '" cy="' + ry0 + '" r="' + (rr / 2) + '" fill="none" stroke="#3dff7a" stroke-width=".5" opacity=".6"/>';
      tr.forEach(function (a) {
        var rel = (a.brg - (hdg || 0)) * D2R, k = Math.min(1, a.dist / 5000) * rr;
        var px = rx0 + Math.sin(rel) * k, py = ry0 - Math.cos(rel) * k, c = a.level === "red" ? "#ff3b30" : a.level === "amber" ? "#ffd23a" : "#cfd5da";
        s += '<path d="M' + fx(px) + ' ' + fx(py - 4) + 'l4 4l-4 4l-4 -4z" fill="' + c + '"/>';
      });
      s += '<text x="' + rx0 + '" y="' + (ry0 + rr + 9) + '" fill="#3dff7a" font-size="7" text-anchor="middle"' + mono + '>ADS-B 5km</text>';
    }
    /* warnings */
    (st.alerts || []).forEach(function (a, i) {
      var y = 140 + i * 17, w = Math.min(260, 12 + a[1].length * 6.2);
      s += '<rect x="' + fx(cx - w / 2) + '" y="' + y + '" width="' + fx(w) + '" height="15" rx="2" fill="' + (a[0] === "red" ? "#b3140c" : "#a06a00") + '" opacity=".92"/>';
      s += '<text x="' + cx + '" y="' + (y + 11) + '" fill="#fff" font-size="9.5" font-weight="700" text-anchor="middle"' + mono + '>' + esc(a[1]) + '</text>';
    });
    if (stale) s += '<path d="M60 30L340 210M340 30L60 210" stroke="#ff3b30" stroke-width="3" opacity=".6"/>';
    return s;
  };
})(typeof window !== "undefined" ? window : globalThis);
