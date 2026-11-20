/* Chalk Circuit Lab — flying: the Arduino libraries for the drone drawer,
 * the wiring coach's notes on it, and ready-made drone projects.
 *
 * Libraries (the same names and calls as the real ones, so a sketch that
 * runs here runs on a real Uno with the library installed):
 *
 *   #include <MPU6050_light.h>    MPU6050 mpu(Wire); mpu.begin(); mpu.calcOffsets();
 *                                 mpu.update(); getAngleX/Y/Z(), getGyroX/Y/Z(), getAccX/Y/Z()
 *   #include <Adafruit_BMP280.h>  Adafruit_BMP280 bmp; bmp.begin(0x76);
 *                                 readPressure() Pa, readTemperature() °C, readAltitude(1013.25) m
 *   #include <QMC5883LCompass.h>  QMC5883LCompass compass; compass.init(); compass.read();
 *                                 getAzimuth(), getX/Y/Z(), getBearing(), setMagneticDeclination(d, m)
 *   #include <TinyGPS++.h>        TinyGPSPlus gps; gps.encode(c); gps.location.lat() / lng(),
 *                                 gps.altitude.meters(), gps.speed.kmph(), gps.course.deg(),
 *                                 gps.satellites.value(), gps.hdop.hdop(), gps.time.hour() …
 *                                 gps.distanceBetween(…), gps.courseTo(…), gps.cardinal(deg)
 *   #include <VL53L0X.h>          VL53L0X tof; tof.init(); readRangeSingleMillimeters()
 *   #include <MS4525DO.h>         (the lab's own, simple airspeed library)
 *                                 MS4525DO pitot; pitot.begin(); pitot.read(); pitot.airspeed()
 *
 * Every one of them talks to its chip on A4/A5 through sim.i2cFor(), so an
 * unwired or unpowered sensor behaves like a real one: begin() fails and
 * the readings stop changing — and the lab says why.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var P = L.P, D = L.Drone;
  var CL = L.MCU_CLASSES, ME = L.MCU_METHODS, LIB = L.MCU_LIBS, CO = L.MCU_CONSTS;
  var D2R = Math.PI / 180, R2D = 180 / Math.PI;

  CL.MPU6050 = "IMU"; CL.Adafruit_BMP280 = "Baro"; CL.QMC5883LCompass = "Compass"; CL.TinyGPSPlus = "GPS"; CL.VL53L0X = "ToF"; CL.MS4525DO = "Pitot";

  function sensor(rt, type, obj, n, what) {
    var s = rt.host.i2c ? rt.host.i2c(type) : null;
    if (!s && (rt.millis() > 150 || /^(begin|init)$/.test(n.name))) rt.hint("i2c" + type, "No " + what + " answered on A4 (SDA) and A5 (SCL), so its readings aren't changing. Is a powered " + what + " wired to those two pins?", n.line);
    return s && s.st.val ? s : null;
  }
  function clockOf(rt) { return rt.clock - rt.t0; }
  /* An I²C read takes real time: Wire runs at 100 kHz unless setClock(400000). */
  function busy(rt, bytes) { rt.clock += (bytes * 9 + 20) / (rt.i2cHz || 100000) + 0.00005; }

  /* A library's begin()/init() asks the chip "who are you?" a few times
   * before giving up — so a sketch that starts the instant the power comes
   * on still finds a sensor that is powering up alongside it. */
  function* awaitChip(rt, type) {
    for (var i = 0; i < 25; i++) {
      var s = rt.host.i2c ? rt.host.i2c(type) : null;
      if (s && s.st.val) return;
      yield { k: "delay", s: 0.004 };
    }
  }
  function slowBegin(type, cls) { return function* (n, o, a) { yield* awaitChip(this, type); return LIB[cls].call.call(this, n, o, a); }; }

  /* ------------------------------------------------ MPU6050_light (IMU) */
  ME.IMU = {
    begin: [0, 2, "u8"], calcOffsets: [0, 2, "v"], calcGyroOffsets: [0, 0, "v"], calcAccOffsets: [0, 0, "v"], update: [0, 0, "v"], fetchData: [0, 0, "v"],
    getAngleX: [0, 0, "f"], getAngleY: [0, 0, "f"], getAngleZ: [0, 0, "f"], getAccAngleX: [0, 0, "f"], getAccAngleY: [0, 0, "f"],
    getAccX: [0, 0, "f"], getAccY: [0, 0, "f"], getAccZ: [0, 0, "f"], getGyroX: [0, 0, "f"], getGyroY: [0, 0, "f"], getGyroZ: [0, 0, "f"],
    getTemp: [0, 0, "f"], setFilterGyroCoef: [1, 1, "v"], getFilterGyroCoef: [0, 0, "f"], setGyroOffsets: [3, 3, "v"], setAccOffsets: [3, 3, "v"],
    getGyroXoffset: [0, 0, "f"], getGyroYoffset: [0, 0, "f"], getGyroZoffset: [0, 0, "f"]
  };
  function wrapA(a) { while (a > 180) a -= 360; while (a < -180) a += 360; return a; }
  LIB.IMU = {
    make: function () { return { acc: [0, 0, 1], gyro: [0, 0, 0], go: [0, 0, 0], ao: [0, 0, 0], ang: [0, 0, 0], accAng: [0, 0], coef: 0.98, last: null, ok: false, temp: 25 }; },
    call: function (n, o, a) {
      var rt = this, s;
      var fetch = function () {
        s = sensor(rt, "imu_mpu6050", o, n, "MPU-6050");
        busy(rt, 14);
        if (!s || !rt.wireOn) return false;
        var v = s.st.val;
        o.acc = [v.acc[0] - o.ao[0], v.acc[1] - o.ao[1], v.acc[2] - o.ao[2]];
        o.gyro = [v.gyro[0] - o.go[0], v.gyro[1] - o.go[1], v.gyro[2] - o.go[2]];
        o.temp = v.temp;
        return true;
      };
      switch (n.name) {
        case "begin":
          if (!rt.wireOn) { rt.hint("wire", "Call Wire.begin(); before mpu.begin(): the MPU6050_light library uses the I²C bus but doesn't start it.", n.line); return 1; }
          o.ok = fetch(); o.last = clockOf(rt); o.fresh = true;
          if (o.ok) { var g = o.acc; o.ang = [Math.atan2(g[1], g[2]) * R2D, -Math.atan2(g[0], Math.hypot(g[1], g[2])) * R2D, 0]; }
          return o.ok ? 0 : 2;
        case "calcOffsets": case "calcGyroOffsets": case "calcAccOffsets": {
          var raw = rt.host.i2c ? rt.host.i2c("imu_mpu6050") : null;
          if (!raw || !raw.st.val) { rt.hint("i2cimu_mpu6050", "calcOffsets() found no MPU-6050 on A4/A5 to measure.", n.line); return 0; }
          var v = raw.st.mean || raw.st.val, doGyro = n.name !== "calcAccOffsets" && (n.args.length < 1 || a[0]), doAcc = n.name !== "calcGyroOffsets" && (n.args.length < 2 || a[1]);
          o.last = clockOf(rt); o.fresh = true;
          if (doGyro) o.go = v.gyro.slice();
          if (doAcc) o.ao = [v.acc[0], v.acc[1], v.acc[2] - 1];
          if (doAcc && (Math.abs(v.acc[0]) > 0.08 || Math.abs(v.acc[1]) > 0.08)) rt.hint("calclevel", "calcOffsets() learns 'level' from where the board is now — and it is tilted, so every angle will be off by that much. Calibrate with the drone flat and still.", n.line);
          var f = raw.st && raw.st.val;
          if (doGyro && f && Math.max(Math.abs(v.gyro[0]), Math.abs(v.gyro[1]), Math.abs(v.gyro[2])) > 6) rt.hint("calcstill", "calcOffsets() ran while the IMU was turning, so it learned the turning as 'bias'. Keep the drone still while it calibrates.", n.line);
          return 0;
        }
        case "fetchData": fetch(); return 0;
        case "update": {
          var now = clockOf(rt), dt = o.last == null ? 0 : now - o.last;
          o.last = now;
          if (!fetch()) { if (!rt.wireOn) rt.hint("wire", "Call Wire.begin(); in setup(): without it nothing comes back from the IMU.", n.line); return 0; }
          var A = o.acc, sgZ = A[2] < 0 ? -1 : 1;
          o.accAng = [Math.atan2(A[1], sgZ * Math.hypot(A[2], A[0])) * R2D, -Math.atan2(A[0], Math.hypot(A[2], A[1])) * R2D];
          var k = o.coef;
          o.ang[0] = wrapA(k * (o.accAng[0] + wrapA(o.ang[0] + o.gyro[0] * dt - o.accAng[0])) + (1 - k) * o.accAng[0]);
          o.ang[1] = wrapA(k * (o.accAng[1] + wrapA(o.ang[1] + sgZ * o.gyro[1] * dt - o.accAng[1])) + (1 - k) * o.accAng[1]);
          o.ang[2] += o.gyro[2] * dt;
          if (o.fresh) { o.fresh = false; dt = Math.min(dt, 0.01); }
          else if (dt > 0.05) rt.hint("imuslow", "mpu.update() ran only every " + Math.round(dt * 1000) + " ms. The gyro is added up between calls, so the angles get worse the slower you call it — call it every loop, and keep loop() free of long delays.", n.line);
          return 0;
        }
        case "getAngleX": return o.ang[0];
        case "getAngleY": return o.ang[1];
        case "getAngleZ": return o.ang[2];
        case "getAccAngleX": return o.accAng[0];
        case "getAccAngleY": return o.accAng[1];
        case "getAccX": return o.acc[0];
        case "getAccY": return o.acc[1];
        case "getAccZ": return o.acc[2];
        case "getGyroX": return o.gyro[0];
        case "getGyroY": return o.gyro[1];
        case "getGyroZ": return o.gyro[2];
        case "getTemp": return o.temp;
        case "setFilterGyroCoef": o.coef = L.clamp(+a[0], 0, 1); return 0;
        case "getFilterGyroCoef": return o.coef;
        case "setGyroOffsets": o.go = [a[0], a[1], a[2]]; return 0;
        case "setAccOffsets": o.ao = [a[0], a[1], a[2]]; return 0;
        case "getGyroXoffset": return o.go[0];
        case "getGyroYoffset": return o.go[1];
        case "getGyroZoffset": return o.go[2];
      }
      return 0;
    }
  };

  LIB.IMU.slow = {
    begin: slowBegin("imu_mpu6050", "IMU"),
    /* the real one averages 500 readings, a millisecond apart: the drone must stay still for that half second */
    calcOffsets: function* (n, o, a) { yield { k: "delay", s: 0.5 }; return LIB.IMU.call.call(this, n, o, a); }
  };
  LIB.IMU.slow.calcGyroOffsets = LIB.IMU.slow.calcOffsets; LIB.IMU.slow.calcAccOffsets = LIB.IMU.slow.calcOffsets;

  /* ----------------------------------------------- Adafruit_BMP280 (baro) */
  ME.Baro = { begin: [0, 2, "b"], readPressure: [0, 0, "f"], readTemperature: [0, 0, "f"], readAltitude: [0, 1, "f"], seaLevelForAltitude: [2, 2, "f"], setSampling: [0, 5, "v"], sensorID: [0, 0, "u8"] };
  LIB.Baro = {
    make: function () { return { ok: false }; },
    call: function (n, o, a) {
      var s = sensor(this, "baro_bmp280", o, n, "BMP280");
      if (/^read/.test(n.name)) { busy(this, 6); if (n.name !== "readTemperature") this.clock += 0.0003; }   /* AVR float maths is slow too */
      switch (n.name) {
        case "begin": this.wireOn = true; o.ok = !!s; return o.ok ? 1 : 0;
        case "sensorID": return s ? 0x58 : 0;
        case "setSampling": return 0;
        case "seaLevelForAltitude": return a[1] / Math.pow(1 - a[0] / 44330, 5.255);
      }
      if (!o.ok && !s) return NaN;
      if (!o.ok) this.hint("bmpbegin", "Call bmp.begin(0x76) in setup() before reading the BMP280.", n.line);
      if (!s) return o.lastV != null ? o.lastV[n.name] || NaN : NaN;
      var v = s.st.val, out;
      if (n.name === "readPressure") out = v.pa;
      else if (n.name === "readTemperature") out = v.temp;
      else out = D.altitudeOf(v.pa, a.length ? a[0] : 1013.25);
      (o.lastV = o.lastV || {})[n.name] = out;
      return out;
    }
  };

  LIB.Baro.slow = { begin: slowBegin("baro_bmp280", "Baro") };

  /* -------------------------------------------- QMC5883LCompass (compass) */
  ME.Compass = { init: [0, 0, "v"], read: [0, 0, "v"], getX: [0, 0, "i16"], getY: [0, 0, "i16"], getZ: [0, 0, "i16"], getAzimuth: [0, 0, "i16"], getBearing: [1, 1, "u8"],
    setMagneticDeclination: [2, 2, "v"], setCalibration: [6, 6, "v"], setCalibrationOffsets: [3, 3, "v"], setCalibrationScales: [3, 3, "v"], setSmoothing: [2, 2, "v"], setADDR: [1, 1, "v"], clearCalibration: [0, 0, "v"] };
  LIB.Compass = {
    make: function () { return { raw: [0, 0, 0], dec: 0, off: [0, 0, 0], scale: [1, 1, 1], on: false }; },
    call: function (n, o, a) {
      switch (n.name) {
        case "init": o.on = true; this.wireOn = true; return 0;
        case "setMagneticDeclination": o.dec = a[0] + (a[1] || 0) / 60 * (a[0] < 0 ? -1 : 1); return 0;
        case "setCalibrationOffsets": o.off = [a[0], a[1], a[2]]; return 0;
        case "setCalibrationScales": o.scale = [a[0], a[1], a[2]]; return 0;
        case "setCalibration": o.off = [(a[0] + a[1]) / 2, (a[2] + a[3]) / 2, (a[4] + a[5]) / 2]; return 0;
        case "clearCalibration": o.off = [0, 0, 0]; o.scale = [1, 1, 1]; return 0;
        case "setSmoothing": case "setADDR": return 0;
        case "read": {
          if (!o.on) this.hint("compinit", "Call compass.init(); in setup() before compass.read().", n.line);
          var s = sensor(this, "mag_qmc5883l", o, n, "QMC5883L compass");
          busy(this, 7);
          if (s) o.raw = s.st.val.raw.map(function (r, i) { return Math.round((r - o.off[i]) * o.scale[i]); });
          return 0;
        }
        case "getX": return o.raw[0];
        case "getY": return o.raw[1];
        case "getZ": return o.raw[2];
        case "getAzimuth": { var h = Math.atan2(o.raw[1], o.raw[0]) * R2D + o.dec; return Math.trunc(h) % 360; }
        case "getBearing": return Math.round(D.wrap360(a[0]) / 22.5) % 16;
      }
      return 0;
    }
  };

  /* ---------------------------------------------------- TinyGPS++ (GPS) */
  var G_METHODS = { encode: [1, 1, "b"], charsProcessed: [0, 0, "u32"], sentencesWithFix: [0, 0, "u32"], failedChecksum: [0, 0, "u32"], passedChecksum: [0, 0, "u32"],
    distanceBetween: [4, 4, "f"], courseTo: [4, 4, "f"], cardinal: [1, 1, "s"] };
  [["location", ["isValid:b", "isUpdated:b", "age:u32", "lat:f", "lng:f"]], ["altitude", ["isValid:b", "isUpdated:b", "age:u32", "meters:f", "feet:f", "kilometers:f"]],
   ["speed", ["isValid:b", "isUpdated:b", "age:u32", "kmph:f", "mps:f", "knots:f", "mph:f"]], ["course", ["isValid:b", "isUpdated:b", "age:u32", "deg:f"]],
   ["satellites", ["isValid:b", "isUpdated:b", "age:u32", "value:u32"]], ["hdop", ["isValid:b", "isUpdated:b", "age:u32", "hdop:f", "value:u32"]],
   ["time", ["isValid:b", "isUpdated:b", "age:u32", "hour:u8", "minute:u8", "second:u8", "centisecond:u8", "value:u32"]],
   ["date", ["isValid:b", "isUpdated:b", "age:u32", "day:u8", "month:u8", "year:u16", "value:u32"]]].forEach(function (g) {
    g[1].forEach(function (mt) { var q = mt.split(":"); G_METHODS[g[0] + "." + q[0]] = [0, 0, q[1]]; });
  });
  ME.GPS = G_METHODS;
  function gpsField(o, k) { return o.f[k] || (o.f[k] = { valid: false, upd: false, at: 0, v: {} }); }
  function gpsCommit(rt, o) {
    var p = o.parts, type = p[0].slice(2), now = rt.millis(), ok;
    var lat = function (s, h) { if (!s) return null; var d = Math.floor(+s / 100), v = d + (+s - d * 100) / 60; return h === "S" || h === "W" ? -v : v; };
    var set = function (k, v) { var f = gpsField(o, k); f.valid = true; f.upd = true; f.at = now; f.v = v; };
    if (p[1]) { var t = p[1]; set("time", { hour: +t.slice(0, 2), minute: +t.slice(2, 4), second: Math.floor(+t.slice(4)), centisecond: Math.round((+t.slice(4) % 1) * 100), value: Math.round(+t * 100) }); }
    if (type === "GGA") {
      ok = +p[6] > 0;
      set("satellites", { value: +p[7] || 0 });
      if (p[8]) set("hdop", { hdop: +p[8], value: Math.round(+p[8] * 100) });
      if (ok) { set("location", { lat: lat(p[2], p[3]), lng: lat(p[4], p[5]) }); set("altitude", { meters: +p[9], feet: +p[9] * 3.28084, kilometers: +p[9] / 1000 }); o.withFix++; }
    } else if (type === "RMC") {
      ok = p[2] === "A";
      if (p[9]) { var dd = p[9]; set("date", { day: +dd.slice(0, 2), month: +dd.slice(2, 4), year: 2000 + +dd.slice(4, 6), value: +dd }); }
      if (ok) {
        set("location", { lat: lat(p[3], p[4]), lng: lat(p[5], p[6]) });
        var kn = +p[7] || 0;
        set("speed", { knots: kn, kmph: kn * 1.852, mps: kn * 0.514444, mph: kn * 1.15078 });
        if (p[8] !== "") set("course", { deg: +p[8] });
        o.withFix++;
      }
    }
    return true;
  }
  function gpsEncode(rt, o, c) {
    o.chars++;
    if (c === "$") { o.s = ""; o.on = true; o.sum = 0; o.star = null; return false; }
    if (!o.on) return false;
    if (c === "*") { o.star = ""; return false; }
    if (c === "\r" || c === "\n") {
      o.on = false;
      if (o.star == null || o.star.length !== 2) return false;
      if (parseInt(o.star, 16) !== o.sum) { o.failed++; return false; }
      o.passed++;
      o.parts = o.s.split(",");
      if (!/^G[PNL](GGA|RMC)$/.test(o.parts[0])) return false;
      return gpsCommit(rt, o);
    }
    if (o.star != null) { o.star += c; return false; }
    o.s += c; o.sum ^= c.charCodeAt(0);
    if (o.s.length > 120) o.on = false;
    return false;
  }
  function haversine(a1, o1, a2, o2) {
    var p1 = a1 * D2R, p2 = a2 * D2R, dp = (a2 - a1) * D2R, dl = (o2 - o1) * D2R;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 6372795 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  function courseTo(a1, o1, a2, o2) {
    var p1 = a1 * D2R, p2 = a2 * D2R, dl = (o2 - o1) * D2R;
    return D.wrap360(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) * R2D);
  }
  D.distanceBetween = haversine; D.courseTo = courseTo;
  LIB.GPS = {
    make: function () { return { f: {}, chars: 0, passed: 0, failed: 0, withFix: 0, s: "", on: false, sum: 0, star: null, parts: [] }; },
    call: function (n, o, a) {
      var nm = n.name;
      switch (nm) {
        case "encode": return gpsEncode(this, o, String.fromCharCode(a[0] & 255)) ? 1 : 0;
        case "charsProcessed": return o.chars;
        case "sentencesWithFix": return o.withFix;
        case "failedChecksum": return o.failed;
        case "passedChecksum": return o.passed;
        case "distanceBetween": return haversine(a[0], a[1], a[2], a[3]);
        case "courseTo": return courseTo(a[0], a[1], a[2], a[3]);
        case "cardinal": return ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"][Math.round(D.wrap360(a[0]) / 22.5) % 16];
      }
      var dot = nm.indexOf("."), grp = nm.slice(0, dot), what = nm.slice(dot + 1), f = gpsField(o, grp);
      if (what === "isValid") return f.valid ? 1 : 0;
      if (what === "isUpdated") return f.upd ? 1 : 0;
      if (what === "age") return f.valid ? this.millis() - f.at : 0xFFFFFFFF;
      f.upd = false;
      if (!f.valid && o.chars > 600 && this.millis() > 4000) this.hint("gpsfix", "The GPS is sending sentences but has no fix yet, so " + nm + "() is 0. Outdoors with a clear sky a fix takes seconds to a minute; check gps." + grp + ".isValid() first.", n.line);
      return f.v[what] != null ? f.v[what] : 0;
    }
  };

  /* --------------------------------------------- Pololu VL53L0X (laser) */
  ME.ToF = { init: [0, 1, "b"], setTimeout: [1, 1, "v"], getTimeout: [0, 0, "u16"], startContinuous: [0, 1, "v"], stopContinuous: [0, 0, "v"],
    readRangeSingleMillimeters: [0, 0, "u16"], readRangeContinuousMillimeters: [0, 0, "u16"], timeoutOccurred: [0, 0, "b"],
    setMeasurementTimingBudget: [1, 1, "b"], setSignalRateLimit: [1, 1, "b"], setAddress: [1, 1, "v"] };
  LIB.ToF = {
    make: function () { return { ok: false, to: 0, timedOut: false, cont: false }; },
    call: function (n, o, a) {
      switch (n.name) {
        case "init":
          if (!this.wireOn) { this.hint("wire", "Call Wire.begin(); before tof.init(): the VL53L0X library uses the I²C bus but doesn't start it.", n.line); return 0; }
          o.ok = !!sensor(this, "tof_vl53l0x", o, n, "VL53L0X"); return o.ok ? 1 : 0;
        case "setTimeout": o.to = a[0]; return 0;
        case "getTimeout": return o.to;
        case "startContinuous": o.cont = true; return 0;
        case "stopContinuous": o.cont = false; return 0;
        case "timeoutOccurred": { var t = o.timedOut; o.timedOut = false; return t ? 1 : 0; }
        case "setMeasurementTimingBudget": case "setSignalRateLimit": return 1;
        case "setAddress": return 0;
      }
      var s = this.wireOn ? sensor(this, "tof_vl53l0x", o, n, "VL53L0X") : null;
      busy(this, 2);
      if (!s) { o.timedOut = true; return 65535; }
      if (n.name === "readRangeContinuousMillimeters" && !o.cont) this.hint("tofcont", "Call tof.startContinuous() before readRangeContinuousMillimeters().", n.line);
      return Math.round(s.st.val.mm);
    }
  };

  LIB.ToF.slow = {
    init: slowBegin("tof_vl53l0x", "ToF"),
    /* a single ranging waits for the whole measurement: about 33 ms */
    readRangeSingleMillimeters: function* (n, o, a) { yield { k: "delay", s: 0.033 }; return LIB.ToF.call.call(this, n, o, a); }
  };

  /* ---------------------------------------- MS4525DO airspeed (the lab's) */
  ME.Pitot = { begin: [0, 1, "b"], read: [0, 0, "b"], airspeed: [0, 0, "f"], pressure: [0, 0, "f"], temperature: [0, 0, "f"], zero: [0, 0, "v"] };
  LIB.Pitot = {
    make: function () { return { pa: 0, t: 0, rho: 1.2, zero: 0, ok: false }; },
    call: function (n, o, a) {
      switch (n.name) {
        case "begin": this.wireOn = true; o.ok = !!sensor(this, "pitot_ms4525", o, n, "MS4525DO airspeed sensor"); return o.ok ? 1 : 0;
        case "zero": { var z = sensor(this, "pitot_ms4525", o, n, "MS4525DO airspeed sensor"); if (z) o.zero = z.st.val.pa; return 0; }
        case "read": { var s = sensor(this, "pitot_ms4525", o, n, "MS4525DO airspeed sensor"); busy(this, 4); if (!s) return 0; o.pa = s.st.val.pa - o.zero; o.t = s.st.val.temp; o.rho = s.st.val.rho; return 1; }
        case "pressure": return o.pa;
        case "temperature": return o.t;
        case "airspeed": return o.pa > 0 ? Math.sqrt(2 * o.pa / o.rho) : 0;
      }
      return 0;
    }
  };

  LIB.Pitot.slow = { begin: slowBegin("pitot_ms4525", "Pitot") };

  /* =============================================================== COACH */
  if (L.Coach && L.Coach.PART_TIPS) Object.assign(L.Coach.PART_TIPS, {
    imu_mpu6050: "SDA to A4, SCL to A5, VCC to 5 V. Mount it flat, in the middle of the frame, on soft foam — vibration is its enemy. Arrow X points forward.",
    baro_bmp280: "SDA to A4, SCL to A5. Cover it with a scrap of foam: wind from the props over the hole reads as altitude.",
    mag_qmc5883l: "SDA to A4, SCL to A5, as far as you can from the battery leads and motors — up on the GPS mast. Arrow X points forward.",
    gps_neo6m: "TX to the board's receive pin (SoftwareSerial gps(4, 3): pin 4), RX to its transmit. Antenna facing the sky, on top of the drone.",
    pitot_ms4525: "SDA to A4, SCL to A5. The tube points straight into the airflow, out in front of the propeller wash.",
    tof_vl53l0x: "SDA to A4, SCL to A5. Under the drone it measures the last two metres for a soft landing; it can't see over bright sunlit or dark grass well.",
    battery_lipo: "Thick red to BAT+, thick black to BAT−, and never let them touch. Plug the battery in last, props off, the drone pointing away from you.",
    power_module: "Battery into IN+ and GND, the drone's power from OUT+. Its 5V and GND power the flight controller; V and I go to two analog pins.",
    esc_motor: "Signal and its ground to the board, the thick leads to the LiPo. Join the grounds. Send 1000 µs first or it won't arm.",
    rc_receiver: "VCC to 5 V, GND to ground, each channel to its own pin. Read with pulseIn(pin, HIGH, 25000) — 0 means the link is lost.",
    quad_frame: "M1–M4 to four pins (Servo.attach), LiPo to BAT+/BAT−, and power the board from its 5V and GND. Front motors are M2 and M4.",
    gcs_pfd: "5 V and ground. For radio telemetry, its RX goes to the TXD of the HC-12 that receives what the drone sends.",
    adsb_rx: "5 V and ground; TX to a ground station display's RX, or to a board's receive pin to read the TRF lines yourself."
  });

  /* ============================================================ PROJECTS */
  if (!L.Builder || !L.EXAMPLES) return;
  var C = L.WIRE_COLORS, B0 = L.Builder;
  function ex(def) { L.EXAMPLES.push(def); }
  function i2c(B, uno, part, vcc) {
    B.wire([part, "VCC"], [uno, vcc || "5V"], C.red);
    B.wire([part, "GND"], [uno, "GND" + (1 + (B._g = ((B._g || 0) + 1) % 3))], C.black);
    B.wire([part, "SDA"], [uno, "A4"], C.blue);
    B.wire([part, "SCL"], [uno, "A5"], C.yellow);
  }
  var LV = "Drones";

  ex({
    id: "drone_tilt", mode: "pro", name: "Tilt meter (IMU)", level: LV,
    blurb: "The MPU-6050 is the drone's inner ear. Tilt it with its sliders and watch roll and pitch on the screen. Then turn up Frame vibration: the accelerometer alone goes wild, but the gyro-blended angle stays calm — that is why every flight controller fuses the two.",
    build: function () {
      var B = new B0("pro"), uno = B.add("arduino_uno", 0, 0), imu = B.add("imu_mpu6050", 40 * P, 16 * P), lcd = B.add("lcd_i2c", 36 * P, 2 * P);
      i2c(B, uno, imu); i2c(B, uno, lcd);
      return B.doc;
    },
    code: [
      "#include <Wire.h>",
      "#include <MPU6050_light.h>",
      "#include <LiquidCrystal_I2C.h>",
      "",
      "MPU6050 mpu(Wire);                 // the IMU, on A4 (SDA) and A5 (SCL)",
      "LiquidCrystal_I2C lcd(0x27, 16, 2); // the screen shares the same two wires",
      "unsigned long lastShow = 0;",
      "",
      "void setup() {",
      "  Serial.begin(9600);",
      "  Wire.begin();",
      "  lcd.init();",
      "  lcd.backlight();",
      "  byte status = mpu.begin();",
      "  if (status != 0) {",
      "    lcd.print(\"No IMU!\");",
      "    while (true) { }              // stop here: nothing to fly with",
      "  }",
      "  lcd.print(\"Hold still...\");",
      "  delay(500);",
      "  mpu.calcOffsets();              // learn the gyro's bias while it is still",
      "  lcd.clear();",
      "}",
      "",
      "void loop() {",
      "  mpu.update();                   // call it every loop: the gyro is added up",
      "  if (millis() - lastShow > 200) {",
      "    lastShow = millis();",
      "    float roll = mpu.getAngleX();        // right side down is +",
      "    float pitch = -mpu.getAngleY();      // the chip's Y points left, so nose up is -Y",
      "    lcd.setCursor(0, 0);",
      "    lcd.print(\"Roll  \");",
      "    lcd.print(roll, 1);",
      "    lcd.print(\"   \");",
      "    lcd.setCursor(0, 1);",
      "    lcd.print(\"Pitch \");",
      "    lcd.print(pitch, 1);",
      "    lcd.print(\"   \");",
      "    Serial.print(\"blended \");",
      "    Serial.print(roll, 1);",
      "    Serial.print(\"  accel only \");",
      "    Serial.println(mpu.getAccAngleX(), 1);",
      "  }",
      "}"
    ]
  });

  ex({
    id: "drone_altimeter", mode: "pro", name: "Barometric altimeter", level: LV,
    blurb: "Air pressure falls about 12 Pa per metre, so the BMP280 knows how high it is. The sketch zeroes it on the ground, smooths the readings, and works out the climb rate. Drag 'Height above the ground' and watch it follow — with the half-metre wobble every drone's altitude hold has to live with.",
    build: function () {
      var B = new B0("pro"), uno = B.add("arduino_uno", 0, 0), baro = B.add("baro_bmp280", 40 * P, 16 * P), lcd = B.add("lcd_i2c", 36 * P, 2 * P);
      i2c(B, uno, baro); i2c(B, uno, lcd);
      return B.doc;
    },
    code: [
      "#include <Wire.h>",
      "#include <Adafruit_BMP280.h>",
      "#include <LiquidCrystal_I2C.h>",
      "",
      "Adafruit_BMP280 bmp;",
      "LiquidCrystal_I2C lcd(0x27, 16, 2);",
      "float ground = 0;     // the altitude where we switched on: our zero",
      "float alt = 0;        // smoothed height above that, in metres",
      "float lastAlt = 0;",
      "float climb = 0;      // metres a second, up is +",
      "unsigned long last = 0;",
      "",
      "void setup() {",
      "  Serial.begin(9600);",
      "  lcd.init();",
      "  lcd.backlight();",
      "  if (!bmp.begin(0x76)) {",
      "    lcd.print(\"No barometer\");",
      "    while (true) { }",
      "  }",
      "  for (int i = 0; i < 20; i++) {         // average the ground reading",
      "    ground += bmp.readAltitude(1013.25);",
      "    delay(20);",
      "  }",
      "  ground = ground / 20;",
      "  last = millis();",
      "}",
      "",
      "void loop() {",
      "  float h = bmp.readAltitude(1013.25) - ground;",
      "  alt = alt + 0.15 * (h - alt);           // a low-pass filter: calm the wobble",
      "  unsigned long now = millis();",
      "  if (now - last >= 250) {",
      "    climb = (alt - lastAlt) * 1000.0 / (now - last);",
      "    lastAlt = alt;",
      "    last = now;",
      "    lcd.setCursor(0, 0);",
      "    lcd.print(\"Alt \");",
      "    lcd.print(alt, 1);",
      "    lcd.print(\" m    \");",
      "    lcd.setCursor(0, 1);",
      "    lcd.print(\"Climb \");",
      "    lcd.print(climb, 1);",
      "    lcd.print(\" m/s  \");",
      "    Serial.println(alt, 2);",
      "  }",
      "  delay(20);",
      "}"
    ]
  });

  ex({
    id: "drone_compass", mode: "pro", name: "Drone compass heading", level: LV,
    blurb: "The QMC5883L feels the Earth's magnetic field. The sketch turns it into a heading and a compass point. Turn 'Nose points to', then set the magnetic declination for where you are, then push the sensor 'close to the power wires' and see why drones mount the compass up on the GPS mast.",
    build: function () {
      var B = new B0("pro"), uno = B.add("arduino_uno", 0, 0), mag = B.add("mag_qmc5883l", 40 * P, 16 * P, { heading: 60 }), lcd = B.add("lcd_i2c", 36 * P, 2 * P);
      i2c(B, uno, mag); i2c(B, uno, lcd);
      return B.doc;
    },
    code: [
      "#include <Wire.h>",
      "#include <QMC5883LCompass.h>",
      "#include <LiquidCrystal_I2C.h>",
      "",
      "QMC5883LCompass compass;",
      "LiquidCrystal_I2C lcd(0x27, 16, 2);",
      "",
      "String cardinal(int deg) {",
      "  const int n = (deg + 22) / 45 % 8;",
      "  if (n == 0) return \"N\";",
      "  if (n == 1) return \"NE\";",
      "  if (n == 2) return \"E\";",
      "  if (n == 3) return \"SE\";",
      "  if (n == 4) return \"S\";",
      "  if (n == 5) return \"SW\";",
      "  if (n == 6) return \"W\";",
      "  return \"NW\";",
      "}",
      "",
      "void setup() {",
      "  Serial.begin(9600);",
      "  lcd.init();",
      "  lcd.backlight();",
      "  compass.init();",
      "  compass.setMagneticDeclination(-4, 0);   // The Gambia: about 4 degrees west",
      "}",
      "",
      "void loop() {",
      "  compass.read();",
      "  int heading = compass.getAzimuth();",
      "  if (heading < 0) heading += 360;",
      "  lcd.setCursor(0, 0);",
      "  lcd.print(\"Heading \");",
      "  lcd.print(heading);",
      "  lcd.print(\" deg   \");",
      "  lcd.setCursor(0, 1);",
      "  lcd.print(\"Facing \");",
      "  lcd.print(cardinal(heading));",
      "  lcd.print(\"     \");",
      "  Serial.println(heading);",
      "  delay(250);",
      "}"
    ]
  });

  ex({
    id: "drone_gps", mode: "pro", name: "GPS position (NMEA + TinyGPS++)", level: LV,
    blurb: "The NEO-6M sends text sentences once a second; TinyGPS++ turns them into latitude, longitude, height, speed and satellites, and works out how far you are from home and which way it is. Untick 'It can see the sky' and watch the fix go.",
    build: function () {
      var B = new B0("pro"), uno = B.add("arduino_uno", 0, 0), gps = B.add("gps_neo6m", 42 * P, 18 * P, { speed: 18, course: 45 });
      B.wire([gps, "VCC"], [uno, "5V"], C.red);
      B.wire([gps, "GND"], [uno, "GND2"], C.black);
      B.wire([gps, "TXD"], [uno, "D4"], C.green);
      B.wire([gps, "RXD"], [uno, "D3"], C.orange);
      return B.doc;
    },
    code: [
      "#include <SoftwareSerial.h>",
      "#include <TinyGPS++.h>",
      "",
      "SoftwareSerial gpsPort(4, 3);   // the GPS's TX into pin 4",
      "TinyGPSPlus gps;",
      "float homeLat = 0, homeLng = 0;",
      "bool haveHome = false;",
      "unsigned long lastPrint = 0;",
      "",
      "void setup() {",
      "  Serial.begin(9600);",
      "  gpsPort.begin(9600);",
      "  Serial.println(\"Waiting for a fix...\");",
      "}",
      "",
      "void loop() {",
      "  while (gpsPort.available() > 0) gps.encode(gpsPort.read());",
      "  if (millis() - lastPrint < 1000) return;",
      "  lastPrint = millis();",
      "  if (!gps.location.isValid()) {",
      "    Serial.print(\"no fix, satellites: \");",
      "    Serial.println(gps.satellites.value());",
      "    return;",
      "  }",
      "  float lat = gps.location.lat(), lng = gps.location.lng();",
      "  if (!haveHome) { homeLat = lat; homeLng = lng; haveHome = true; Serial.println(\"Home set.\"); }",
      "  Serial.print(lat, 6);",
      "  Serial.print(\", \");",
      "  Serial.print(lng, 6);",
      "  Serial.print(\"  \");",
      "  Serial.print(gps.altitude.meters(), 1);",
      "  Serial.print(\" m  \");",
      "  Serial.print(gps.speed.kmph(), 1);",
      "  Serial.print(\" km/h  sats \");",
      "  Serial.print(gps.satellites.value());",
      "  float d = gps.distanceBetween(lat, lng, homeLat, homeLng);",
      "  float back = gps.courseTo(lat, lng, homeLat, homeLng);",
      "  Serial.print(\"  home \");",
      "  Serial.print(d, 0);",
      "  Serial.print(\" m to the \");",
      "  Serial.println(gps.cardinal(back));",
      "}"
    ]
  });

  ex({
    id: "drone_obstacle", mode: "pro", name: "Laser obstacle & landing sensor", level: LV,
    blurb: "A VL53L0X times laser light to the nearest surface. Facing down it is the height for a soft landing; facing forward it is a wall warning. The buzzer beeps faster as something gets closer — slide 'Distance to the surface' in and out.",
    build: function () {
      var B = new B0("pro"), uno = B.add("arduino_uno", 0, 0), tof = B.add("tof_vl53l0x", 40 * P, 16 * P, { mm: 900, facing: "forward" }), pz = B.add("piezo", 52 * P, 12 * P);
      i2c(B, uno, tof);
      B.wire([pz, "+"], [uno, "D8"], C.orange);
      B.wire([pz, "-"], [uno, "GND3"], C.black);
      return B.doc;
    },
    code: [
      "#include <Wire.h>",
      "#include <VL53L0X.h>",
      "",
      "VL53L0X tof;",
      "const int BUZZER = 8;",
      "",
      "void setup() {",
      "  Serial.begin(9600);",
      "  Wire.begin();",
      "  tof.setTimeout(500);",
      "  if (!tof.init()) {",
      "    Serial.println(\"No VL53L0X found\");",
      "    while (true) { }",
      "  }",
      "}",
      "",
      "void loop() {",
      "  int mm = tof.readRangeSingleMillimeters();",
      "  if (tof.timeoutOccurred() || mm >= 8190) {",
      "    Serial.println(\"clear\");",
      "    delay(200);",
      "    return;",
      "  }",
      "  Serial.print(mm);",
      "  Serial.println(\" mm\");",
      "  if (mm < 1000) {",
      "    tone(BUZZER, 2000, 40);",
      "    delay(map(mm, 0, 1000, 60, 600));   // closer: faster beeps",
      "  } else {",
      "    delay(200);",
      "  }",
      "}"
    ]
  });

  ex({
    id: "drone_airspeed", mode: "pro", name: "Airspeed & stall warning (fixed-wing)", level: LV,
    blurb: "A fixed-wing drone flies on airspeed, not ground speed. The pitot tube's pressure difference gives ½ρv²; the sketch turns it into m/s and sounds a stall warning below 10 m/s. Then tick 'Pitot tube blocked' — the airspeed drops to zero while the plane is really still flying, the failure that has brought down real aircraft.",
    build: function () {
      var B = new B0("pro"), uno = B.add("arduino_uno", 0, 0), pit = B.add("pitot_ms4525", 40 * P, 16 * P, { airspeed: 18 }), pz = B.add("piezo", 56 * P, 12 * P);
      i2c(B, uno, pit);
      B.wire([pz, "+"], [uno, "D8"], C.orange);
      B.wire([pz, "-"], [uno, "GND3"], C.black);
      return B.doc;
    },
    code: [
      "#include <Wire.h>",
      "#include <MS4525DO.h>      // the lab's airspeed library",
      "",
      "MS4525DO pitot;",
      "const float STALL = 10.0;  // m/s: below this the wing stops lifting",
      "const int BUZZER = 8;",
      "",
      "void setup() {",
      "  Serial.begin(9600);",
      "  if (!pitot.begin()) {",
      "    Serial.println(\"No airspeed sensor\");",
      "    while (true) { }",
      "  }",
      "}",
      "",
      "void loop() {",
      "  pitot.read();",
      "  float v = pitot.airspeed();             // m/s, from sqrt(2 q / rho)",
      "  Serial.print(\"q = \");",
      "  Serial.print(pitot.pressure(), 1);",
      "  Serial.print(\" Pa   airspeed \");",
      "  Serial.print(v, 1);",
      "  Serial.print(\" m/s  \");",
      "  Serial.print(v * 3.6, 0);",
      "  Serial.println(\" km/h\");",
      "  if (v < STALL) tone(BUZZER, 900, 150);   // stall warning",
      "  delay(300);",
      "}"
    ]
  });

  ex({
    id: "drone_esc", mode: "pro", name: "ESC arming & motor test", level: LV,
    blurb: "A brushless motor on its ESC, run from a 3S LiPo, with a knob for throttle. The ESC refuses to arm until it has seen 1000 µs — turn the knob up before pressing ▶ and see. The propeller is off: that is how every bench test is done. Watch the current and the battery voltage sag.",
    build: function () {
      var B = new B0("pro"), uno = B.add("arduino_uno", 0, 0);
      var esc = B.add("esc_motor", 44 * P, 22 * P), bat = B.add("battery_lipo", 60 * P, 26 * P), pot = B.add("potentiometer", 36 * P, 30 * P, { pos: 0 });
      B.wire([esc, "SIG"], [uno, "D9"], C.white);
      B.wire([esc, "GND"], [uno, "GND1"], C.black);
      B.wire([esc, "BAT+"], [bat, "+"], C.red);
      B.wire([esc, "BAT-"], [bat, "-"], C.black);
      B.wire([bat, "-"], [uno, "GND2"], C.black);
      B.wire([pot, "1"], [uno, "GND3"], C.black);
      B.wire([pot, "2"], [uno, "5V"], C.red);
      B.wire([pot, "W"], [uno, "A0"], C.yellow);
      return B.doc;
    },
    code: [
      "#include <Servo.h>",
      "",
      "Servo esc;                // an ESC listens to servo pulses",
      "",
      "void setup() {",
      "  Serial.begin(9600);",
      "  esc.attach(9);",
      "  esc.writeMicroseconds(1000);   // throttle down: the ESC arms on this",
      "  Serial.println(\"Arming...\");",
      "  delay(2000);                   // wait for the two rising beeps",
      "  Serial.println(\"Armed. Turn the knob.\");",
      "}",
      "",
      "void loop() {",
      "  int knob = analogRead(A0);",
      "  int us = map(knob, 0, 1023, 1000, 2000);",
      "  esc.writeMicroseconds(us);",
      "  Serial.print(\"throttle \");",
      "  Serial.print((us - 1000) / 10);",
      "  Serial.println(\" %\");",
      "  delay(100);",
      "}"
    ]
  });

  ex({
    id: "drone_battery", mode: "pro", name: "Battery monitor (power module)", level: LV,
    blurb: "The power module tells the flight controller the battery's volts and amps; the sketch adds up the mAh used and warns when it is time to land. A motor on an ESC is the load — a voltage knob is the throttle. Drag the knob up and watch the volts sag under load and the mAh climb.",
    build: function () {
      var B = new B0("pro"), uno = B.add("arduino_uno", 0, 0);
      var bat = B.add("battery_lipo", 66 * P, 30 * P, { charge: 45 }), pm = B.add("power_module", 50 * P, 22 * P), esc = B.add("esc_motor", 66 * P, 4 * P, { prop: true });
      var pot = B.add("potentiometer", 36 * P, 30 * P, { pos: 0 }), pz = B.add("piezo", 40 * P, 10 * P);
      B.wire([bat, "+"], [pm, "IN+"], C.red);
      B.wire([bat, "-"], [pm, "GND"], C.black);
      B.wire([pm, "OUT+"], [esc, "BAT+"], C.red);
      B.wire([esc, "BAT-"], [bat, "-"], C.black);
      B.wire([pm, "V"], [uno, "A1"], C.green);
      B.wire([pm, "I"], [uno, "A2"], C.blue);
      B.wire([pm, "GND"], [uno, "GND1"], C.black);
      B.wire([esc, "SIG"], [uno, "D9"], C.white);
      B.wire([esc, "GND"], [uno, "GND2"], C.black);
      B.wire([pot, "1"], [uno, "GND3"], C.black);
      B.wire([pot, "2"], [uno, "5V"], C.red);
      B.wire([pot, "W"], [uno, "A0"], C.yellow);
      B.wire([pz, "+"], [uno, "D8"], C.orange);
      B.wire([pz, "-"], [uno, "GND3"], C.black);
      return B.doc;
    },
    code: [
      "#include <Servo.h>",
      "",
      "Servo esc;",
      "const float V_SCALE = 11.0;    // the module divides the battery by 11",
      "const float A_PER_V = 18.18;   // and gives 55 mV per amp",
      "const int CELLS = 3;",
      "float mAh = 0;",
      "unsigned long last = 0;",
      "",
      "void setup() {",
      "  Serial.begin(9600);",
      "  esc.attach(9);",
      "  esc.writeMicroseconds(1000);",
      "  delay(1500);",
      "  last = millis();",
      "}",
      "",
      "void loop() {",
      "  esc.writeMicroseconds(map(analogRead(A0), 0, 1023, 1000, 2000));",
      "  float volts = analogRead(A1) * 5.0 / 1023.0 * V_SCALE;",
      "  float amps = analogRead(A2) * 5.0 / 1023.0 * A_PER_V;",
      "  unsigned long now = millis();",
      "  mAh += amps * (now - last) / 3600.0;   // amps x hours x 1000",
      "  last = now;",
      "  float cell = volts / CELLS;",
      "  Serial.print(volts, 2);",
      "  Serial.print(\" V  \");",
      "  Serial.print(amps, 1);",
      "  Serial.print(\" A  \");",
      "  Serial.print(mAh, 0);",
      "  Serial.print(\" mAh  \");",
      "  Serial.print(cell, 2);",
      "  Serial.println(\" V/cell\");",
      "  if (cell < 3.5) tone(8, 2500, 100);    // land now",
      "  delay(200);",
      "}"
    ]
  });

  ex({
    id: "drone_receiver", mode: "pro", name: "RC receiver & failsafe", level: LV,
    blurb: "Read the pilot's sticks from an RC receiver with pulseIn(): 1000–2000 µs per channel. Move the throttle and roll sliders. Then tick 'Radio link lost': pulseIn() gives 0, and the sketch goes into failsafe instead of holding the last throttle — the rule every drone must follow.",
    build: function () {
      var B = new B0("pro"), uno = B.add("arduino_uno", 0, 0), rx = B.add("rc_receiver", 40 * P, 18 * P, { thr: 35, roll: 20 });
      B.wire([rx, "VCC"], [uno, "5V"], C.red);
      B.wire([rx, "GND"], [uno, "GND2"], C.black);
      B.wire([rx, "CH1"], [uno, "D2"], C.yellow);
      B.wire([rx, "CH3"], [uno, "D4"], C.orange);
      B.wire([rx, "CH5"], [uno, "D7"], C.white);
      return B.doc;
    },
    code: [
      "const int CH_ROLL = 2, CH_THROTTLE = 4, CH_ARM = 7;",
      "",
      "void setup() {",
      "  Serial.begin(9600);",
      "  pinMode(CH_ROLL, INPUT);",
      "  pinMode(CH_THROTTLE, INPUT);",
      "  pinMode(CH_ARM, INPUT);",
      "}",
      "",
      "void loop() {",
      "  unsigned long thr = pulseIn(CH_THROTTLE, HIGH, 25000);   // 0 if nothing came",
      "  unsigned long roll = pulseIn(CH_ROLL, HIGH, 25000);",
      "  unsigned long arm = pulseIn(CH_ARM, HIGH, 25000);",
      "  if (thr == 0) {",
      "    Serial.println(\"FAILSAFE: no signal - land / come home\");",
      "  } else {",
      "    Serial.print(\"throttle \");",
      "    Serial.print((thr - 1000) / 10);",
      "    Serial.print(\"%  roll \");",
      "    Serial.print((int)roll - 1500);",
      "    Serial.println(arm > 1500 ? \"  ARMED\" : \"  safe\");",
      "  }",
      "  delay(200);",
      "}"
    ]
  });

  /* The flagship: a real stabiliser. Angle-mode PD on roll and pitch, a
   * yaw-rate damper, barometric altitude hold, and an automatic mission:
   * arm, climb to 3 m, hover, land, disarm. */
  ex({
    id: "drone_hover", mode: "pro", name: "Quadcopter flight controller (auto hover)", level: LV,
    blurb: "A complete flight controller on an Arduino: it reads the IMU 200 times a second, holds the quadcopter level with a PD stabiliser (PID) and a mixer for four motors, holds its height on the barometer, and flies a mission — arm, climb to 3 m, hover, land. The ground station shows it all. Then add wind and gusts in the quadcopter's Inspect panel, or change the gains and find out why tuning matters.",
    build: function () {
      var B = new B0("pro"), uno = B.add("arduino_uno", 0, 0);
      var quad = B.add("quad_frame", 34 * P, -2 * P), bat = B.add("battery_lipo", 50 * P, -2 * P);
      var imu = B.add("imu_mpu6050", 16 * P, 30 * P), baro = B.add("baro_bmp280", 24 * P, 30 * P);
      var pfd = B.add("gcs_pfd", 36 * P, 26 * P);
      B.wire([quad, "M1"], [uno, "D3"], C.white);
      B.wire([quad, "M2"], [uno, "D5"], C.white);
      B.wire([quad, "M3"], [uno, "D6"], C.white);
      B.wire([quad, "M4"], [uno, "D9"], C.white);
      B.wire([quad, "5V"], [uno, "5V"], C.red);
      B.wire([quad, "GND"], [uno, "GND3"], C.black);
      B.wire([quad, "BAT+"], [bat, "+"], C.red);
      B.wire([quad, "BAT-"], [bat, "-"], C.black);
      i2c(B, uno, imu); i2c(B, uno, baro);
      B.wire([pfd, "VCC"], [uno, "5V"], C.red);
      B.wire([pfd, "GND"], [uno, "GND2"], C.black);
      return B.doc;
    },
    code: [
      "// A quadcopter flight controller: stabilise, hold height, fly a mission.",
      "#include <Wire.h>",
      "#include <Servo.h>",
      "#include <MPU6050_light.h>",
      "#include <Adafruit_BMP280.h>",
      "",
      "MPU6050 mpu(Wire);",
      "Adafruit_BMP280 bmp;",
      "Servo m1, m2, m3, m4;          // M1 rear right, M2 front right, M3 rear left, M4 front left",
      "",
      "// ---- tuning: the gains. Too low and it wobbles over; too high and it shakes.",
      "const float KP_ANGLE = 1.6;    // microseconds of motor difference per degree of tilt",
      "const float KD_ANGLE = 0.30;   // ... per degree/second of turning (the damper)",
      "const float KI_ANGLE = 1.5;    // ... and slowly trims out a steady lean (no two motors are alike)",
      "const float KP_YAW = 2.0;      // stop it spinning",
      "const float KP_ALT = 60.0;     // microseconds per metre of height error",
      "const float KD_ALT = 70.0;     // ... per metre/second of climb",
      "const float KI_ALT = 15.0;     // slowly learns the true hover throttle",
      "const int HOVER = 1590;        // a first guess at the hover throttle",
      "",
      "float ground = 0, alt = 0, lastAlt = 0, climb = 0, altI = 0, target = 0;",
      "float rollI = 0, pitchI = 0;   // the integral terms",
      "unsigned long tStart = 0, lastBaro = 0, lastUs = 0;",
      "int phase = 0;                 // 0 arming, 1 climb, 2 hover, 3 land, 4 done",
      "",
      "void motors(int a, int b, int c, int d) {",
      "  m1.writeMicroseconds(constrain(a, 1000, 2000));",
      "  m2.writeMicroseconds(constrain(b, 1000, 2000));",
      "  m3.writeMicroseconds(constrain(c, 1000, 2000));",
      "  m4.writeMicroseconds(constrain(d, 1000, 2000));",
      "}",
      "",
      "void setup() {",
      "  Serial.begin(9600);",
      "  m1.attach(3); m2.attach(5); m3.attach(6); m4.attach(9);",
      "  motors(1000, 1000, 1000, 1000);       // the ESCs arm on throttle-down",
      "  Wire.begin();",
      "  if (mpu.begin() != 0 || !bmp.begin(0x76)) {",
      "    Serial.println(\"Sensor missing - not flying.\");",
      "    while (true) { }",
      "  }",
      "  delay(1500);                          // ESCs armed; drone still on the pad",
      "  mpu.calcOffsets();                    // level and still: learn the zero",
      "  mpu.setFilterGyroCoef(0.998);         // in flight trust the gyro: the accelerometer is fooled whenever the drone speeds up",
      "  for (int i = 0; i < 10; i++) { ground += bmp.readAltitude(1013.25); delay(10); }",
      "  ground = ground / 10;",
      "  tStart = millis();",
      "  lastUs = micros();",
      "  phase = 1;",
      "  Serial.println(\"Taking off\");",
      "}",
      "",
      "void loop() {",
      "  mpu.update();",
      "  float roll = mpu.getAngleX();          // right side down +",
      "  float pitch = -mpu.getAngleY();        // nose up +",
      "  float rollRate = mpu.getGyroX();",
      "  float pitchRate = -mpu.getGyroY();",
      "  float yawRate = -mpu.getGyroZ();       // clockwise +",
      "  unsigned long nowUs = micros();",
      "  float dt = (nowUs - lastUs) / 1000000.0;",
      "  lastUs = nowUs;",
      "",
      "  // the height, 20 times a second, smoothed",
      "  if (millis() - lastBaro >= 50) {",
      "    float h = bmp.readAltitude(1013.25) - ground;",
      "    alt = alt + 0.3 * (h - alt);",
      "    climb = climb + 0.3 * ((alt - lastAlt) / 0.05 - climb);",
      "    lastAlt = alt;",
      "    lastBaro = millis();",
      "  }",
      "",
      "  // the mission",
      "  float secs = (millis() - tStart) / 1000.0;",
      "  if (phase == 1) { target = min(3.0, secs * 1.0); if (secs > 4) phase = 2; }",
      "  if (phase == 2 && secs > 14) phase = 3;",
      "  if (phase == 3) { target = target - 0.004; if (alt < 0.15) phase = 4; }    // about 0.7 m/s down",
      "  if (phase == 4 || abs(roll) > 60 || abs(pitch) > 60) {",
      "    motors(1000, 1000, 1000, 1000);     // landed, or tipped over: motors off",
      "    phase = 4;",
      "    delay(5);",
      "    return;",
      "  }",
      "",
      "  // height hold: throttle",
      "  float err = target - alt;",
      "  if (abs(err) < 0.5) altI = constrain(altI + err * 0.005, -6, 6);   // near the target only: no wind-up on the climb",
      "  float thr = HOVER + KP_ALT * err - KD_ALT * climb + KI_ALT * altI;",
      "  if (secs < 0.6) thr = 1000 + (HOVER - 1000) * secs / 0.6;   // spool up gently",
      "",
      "  // stabilise: hold level (0 degrees), damp the turning, trim the lean",
      "  if (alt > 0.3) {                       // only once off the ground, or it winds up on the pad",
      "    rollI = constrain(rollI + (0 - roll) * dt, -20, 20);",
      "    pitchI = constrain(pitchI + (0 - pitch) * dt, -20, 20);",
      "  }",
      "  float uRoll = KP_ANGLE * (0 - roll) - KD_ANGLE * rollRate + KI_ANGLE * rollI;",
      "  float uPitch = KP_ANGLE * (0 - pitch) - KD_ANGLE * pitchRate + KI_ANGLE * pitchI;",
      "  float uYaw = KP_YAW * (0 - yawRate);",
      "",
      "  // the mixer: which motors speed up for each correction",
      "  motors(thr - uRoll - uPitch - uYaw,    // M1 rear right, clockwise",
      "         thr - uRoll + uPitch + uYaw,    // M2 front right, anticlockwise",
      "         thr + uRoll - uPitch + uYaw,    // M3 rear left, anticlockwise",
      "         thr + uRoll + uPitch - uYaw);   // M4 front left, clockwise",
      "  delay(4);                              // about 200 times a second",
      "}"
    ]
  });

  ex({
    id: "drone_telemetry", mode: "pro", name: "Telemetry downlink to a ground station", level: LV,
    blurb: "How a real ground station gets its picture: the drone's controller reads its IMU, barometer and GPS and sends a line of telemetry over a 433 MHz radio (HC-12) twice a second; a second HC-12 on the ground feeds the display. An ADS-B receiver beside it puts nearby manned aircraft on the same screen — wait for the medevac helicopter to come close.",
    build: function () {
      var B = new B0("pro"), uno = B.add("arduino_uno", 0, 0);
      var imu = B.add("imu_mpu6050", 16 * P, 30 * P), baro = B.add("baro_bmp280", 24 * P, 30 * P, { alt: 25 });
      var gps = B.add("gps_neo6m", 31 * P, 9 * P), radio = B.add("hc12", 39 * P, 9 * P);
      var ground = B.add("hc12", 58 * P, 9 * P, {}), pfd = B.add("gcs_pfd", 56 * P, 36 * P, { source: "serial" }), adsb = B.add("adsb_rx", 90 * P, 22 * P, { traffic: 3 });
      var psu = B.add("psu", 92 * P, 36 * P, { volts: 5, limit: 1 });
      i2c(B, uno, imu); i2c(B, uno, baro);
      B.wire([gps, "VCC"], [uno, "5V"], C.red);
      B.wire([gps, "GND"], [uno, "GND3"], C.black);
      B.wire([gps, "TXD"], [uno, "D4"], C.green);
      B.wire([radio, "VCC"], [uno, "5V"], C.red);
      B.wire([radio, "GND"], [uno, "GND1"], C.black);
      B.wire([radio, "TXD"], [uno, "D10"], C.green);
      B.wire([radio, "RXD"], [uno, "D11"], C.orange);
      B.wire([ground, "VCC"], [psu, "+"], C.red);
      B.wire([ground, "GND"], [psu, "-"], C.black);
      B.wire([pfd, "VCC"], [psu, "+"], C.red);
      B.wire([pfd, "GND"], [psu, "-"], C.black);
      B.wire([ground, "TXD"], [pfd, "RXD"], C.green);
      B.wire([adsb, "VCC"], [psu, "+"], C.red);
      B.wire([adsb, "GND"], [psu, "-"], C.black);
      B.wire([adsb, "TXD"], [pfd, "RXD"], C.purple);
      return B.doc;
    },
    code: [
      "#include <Wire.h>",
      "#include <SoftwareSerial.h>",
      "#include <MPU6050_light.h>",
      "#include <Adafruit_BMP280.h>",
      "#include <TinyGPS++.h>",
      "",
      "MPU6050 mpu(Wire);",
      "Adafruit_BMP280 bmp;",
      "TinyGPSPlus gps;",
      "SoftwareSerial gpsPort(4, 3);     // GPS TX into pin 4",
      "SoftwareSerial radio(10, 11);     // HC-12: its TXD into 10, its RXD from 11",
      "float ground = 0, lastAlt = 0;",
      "unsigned long lastSend = 0;",
      "",
      "void setup() {",
      "  Wire.begin();",
      "  mpu.begin();",
      "  mpu.calcOffsets();",
      "  bmp.begin(0x76);",
      "  ground = bmp.readAltitude(1013.25) - 25;   // pretend we took off 25 m below",
      "  radio.begin(9600);",
      "  gpsPort.begin(9600);                       // the last begin() is the one listening",
      "}",
      "",
      "void loop() {",
      "  mpu.update();",
      "  while (gpsPort.available() > 0) gps.encode(gpsPort.read());",
      "  if (millis() - lastSend < 500) return;",
      "  lastSend = millis();",
      "  float alt = bmp.readAltitude(1013.25) - ground;",
      "  float hdg = -mpu.getAngleZ();",
      "  if (hdg < 0) hdg += 360;",
      "  radio.print(\"TLM roll=\");",
      "  radio.print(mpu.getAngleX(), 1);",
      "  radio.print(\" pitch=\");",
      "  radio.print(-mpu.getAngleY(), 1);",
      "  radio.print(\" hdg=\");",
      "  radio.print(hdg, 0);",
      "  radio.print(\" alt=\");",
      "  radio.print(alt, 1);",
      "  radio.print(\" vs=\");",
      "  radio.print((alt - lastAlt) * 2, 1);",
      "  radio.print(\" spd=\");",
      "  radio.print(gps.speed.mps(), 1);",
      "  radio.print(\" sat=\");",
      "  radio.print(gps.satellites.value());",
      "  radio.print(\" vbat=11.6 rssi=88 arm=1 mode=ANGLE\");",
      "  radio.println();",
      "  lastAlt = alt;",
      "}"
    ]
  });

  ex({
    id: "drone_rth", mode: "pro", name: "Return-to-home navigator (GPS + compass)", level: LV,
    blurb: "The brain of return-to-home: where is home, how far, and which way should the nose turn? The GPS gives distance and the bearing home, the compass gives the heading, and the difference is the turn. Drive the GPS away with its speed and course sliders, then turn the compass until the screen says 'ahead'.",
    build: function () {
      var B = new B0("pro"), uno = B.add("arduino_uno", 0, 0), gps = B.add("gps_neo6m", 42 * P, 18 * P, { speed: 36, course: 90 });
      var mag = B.add("mag_qmc5883l", 30 * P, 34 * P, { heading: 90, interference: 0 }), lcd = B.add("lcd_i2c", 36 * P, 2 * P);
      B.wire([gps, "VCC"], [uno, "5V"], C.red);
      B.wire([gps, "GND"], [uno, "GND2"], C.black);
      B.wire([gps, "TXD"], [uno, "D4"], C.green);
      i2c(B, uno, mag); i2c(B, uno, lcd);
      return B.doc;
    },
    code: [
      "#include <Wire.h>",
      "#include <SoftwareSerial.h>",
      "#include <TinyGPS++.h>",
      "#include <QMC5883LCompass.h>",
      "#include <LiquidCrystal_I2C.h>",
      "",
      "SoftwareSerial gpsPort(4, 3);",
      "TinyGPSPlus gps;",
      "QMC5883LCompass compass;",
      "LiquidCrystal_I2C lcd(0x27, 16, 2);",
      "float homeLat = 0, homeLng = 0;",
      "bool haveHome = false;",
      "unsigned long last = 0;",
      "",
      "void setup() {",
      "  gpsPort.begin(9600);",
      "  compass.init();",
      "  compass.setMagneticDeclination(-4, 0);",
      "  lcd.init();",
      "  lcd.backlight();",
      "  lcd.print(\"GPS: waiting\");",
      "}",
      "",
      "void loop() {",
      "  while (gpsPort.available() > 0) gps.encode(gpsPort.read());",
      "  if (millis() - last < 500) return;",
      "  last = millis();",
      "  if (!gps.location.isValid()) return;",
      "  float lat = gps.location.lat(), lng = gps.location.lng();",
      "  if (!haveHome) { homeLat = lat; homeLng = lng; haveHome = true; }",
      "  float dist = gps.distanceBetween(lat, lng, homeLat, homeLng);",
      "  float bearing = gps.courseTo(lat, lng, homeLat, homeLng);",
      "  compass.read();",
      "  int heading = compass.getAzimuth();",
      "  if (heading < 0) heading += 360;",
      "  int turn = (int)(bearing - heading + 540) % 360 - 180;   // -180 ... +180",
      "  lcd.setCursor(0, 0);",
      "  lcd.print(\"Home \");",
      "  lcd.print(dist, 0);",
      "  lcd.print(\" m \");",
      "  lcd.print(gps.cardinal(bearing));",
      "  lcd.print(\"     \");",
      "  lcd.setCursor(0, 1);",
      "  if (dist < 3) lcd.print(\"HOME - land    \");",
      "  else if (abs(turn) < 15) lcd.print(\"ahead          \");",
      "  else if (turn > 0) { lcd.print(\"turn right \"); lcd.print(turn); lcd.print(\"  \"); }",
      "  else { lcd.print(\"turn left \"); lcd.print(-turn); lcd.print(\"  \"); }",
      "}"
    ]
  });
})(typeof window !== "undefined" ? window : globalThis);
