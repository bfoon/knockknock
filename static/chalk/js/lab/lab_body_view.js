/* Chalk Circuit Lab — the body, in 3-D.
 *
 * Draws the shell and the electronics inside it, lets shapes be picked,
 * dragged and edited, and test-drives the whole thing: with the power on,
 * the same simulator that lights an LED on the bench turns the wheels
 * here. A car is steered by its two motors, a submarine pushed by its
 * propeller, a rocket lifted while its engine output is on.
 *
 * The drawing is a few hundred lines of plain WebGL — flat-shaded
 * triangles and a grid — rather than a 3-D library, so the lab still
 * loads from one server on a school network with nothing fetched from
 * outside.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  var S = L.Solid, Body = L.Body, esc = L.esc;

  /* ------------------------------------------------------------ matrices */

  function ident() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
  function mul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++)
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  }
  function translate(x, y, z) { var m = ident(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function rotZ(a) { var m = ident(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
  /* turn by `a` about a unit axis */
  function rotAxis(ax, a) {
    var x = ax[0], y = ax[1], z = ax[2], c = Math.cos(a), s = Math.sin(a), t = 1 - c, m = ident();
    m[0] = t * x * x + c; m[1] = t * x * y + s * z; m[2] = t * x * z - s * y;
    m[4] = t * x * y - s * z; m[5] = t * y * y + c; m[6] = t * y * z + s * x;
    m[8] = t * x * z + s * y; m[9] = t * y * z - s * x; m[10] = t * z * z + c;
    return m;
  }
  function perspective(fovy, aspect, near, far) {
    var f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = 2 * far * near / (near - far);
    return m;
  }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function lookAt(e, c, up) {
    var V = S.vec, f = norm(V.sub(c, e)), s = norm(V.cross(f, up)), u = V.cross(s, f), m = ident();
    m[0] = s[0]; m[4] = s[1]; m[8] = s[2]; m[1] = u[0]; m[5] = u[1]; m[9] = u[2]; m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2];
    m[12] = -V.dot(s, e); m[13] = -V.dot(u, e); m[14] = V.dot(f, e);
    return m;
  }
  function rgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    var n = m ? parseInt(m[1], 16) : 0x8b9aa8;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

  /* -------------------------------------------------------------- WebGL */

  var VS = "attribute vec3 aPos;attribute vec3 aNor;attribute vec3 aCol;uniform mat4 uMVP;uniform mat4 uModel;varying vec3 vN;varying vec3 vC;" +
    "void main(){vN=mat3(uModel)*aNor;vC=aCol;gl_Position=uMVP*vec4(aPos,1.0);}";
  var FS = "precision mediump float;varying vec3 vN;varying vec3 vC;uniform float uAlpha;uniform float uGlow;uniform float uFlat;uniform vec3 uTint;uniform float uMix;" +
    "void main(){vec3 n=normalize(vN);if(!gl_FrontFacing)n=-n;" +
    "float l=0.38+0.52*max(dot(n,normalize(vec3(0.45,-0.35,0.82))),0.0)+0.16*max(dot(n,normalize(vec3(-0.6,0.5,0.2))),0.0);" +
    "vec3 c=mix(vC,uTint,uMix);c=mix(c*l,c,uFlat)+c*uGlow;gl_FragColor=vec4(c,uAlpha);}";

  function Gfx(canvas) {
    var gl = this.gl = canvas.getContext("webgl", { antialias: true, alpha: false, preserveDrawingBuffer: true }) || canvas.getContext("experimental-webgl");
    this.ok = !!gl;
    if (!gl) return;
    var sh = function (type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    var p = this.prog = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { this.ok = false; return; }
    gl.useProgram(p);
    this.a = { pos: gl.getAttribLocation(p, "aPos"), nor: gl.getAttribLocation(p, "aNor"), col: gl.getAttribLocation(p, "aCol") };
    this.u = {};
    ["uMVP", "uModel", "uAlpha", "uGlow", "uFlat", "uTint", "uMix"].forEach(function (n) { this.u[n] = gl.getUniformLocation(p, n); }, this);
    gl.enable(gl.DEPTH_TEST);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  /* tris: [[a, b, c, normal], …]; one colour for the lot */
  Gfx.prototype.mesh = function (tris, color) {
    var gl = this.gl, c = rgb(color), d = new Float32Array(tris.length * 27), o = 0;
    for (var i = 0; i < tris.length; i++) {
      var t = tris[i], n = t[3];
      for (var k = 0; k < 3; k++) { d[o++] = t[k][0]; d[o++] = t[k][1]; d[o++] = t[k][2]; d[o++] = n[0]; d[o++] = n[1]; d[o++] = n[2]; d[o++] = c[0]; d[o++] = c[1]; d[o++] = c[2]; }
    }
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
    return { buf: buf, n: tris.length * 3, mode: gl.TRIANGLES };
  };
  Gfx.prototype.lines = function (segs, color) {
    var gl = this.gl, c = rgb(color), d = new Float32Array(segs.length * 18), o = 0;
    segs.forEach(function (s) { for (var k = 0; k < 2; k++) { d[o++] = s[k][0]; d[o++] = s[k][1]; d[o++] = s[k][2]; d[o++] = 0; d[o++] = 0; d[o++] = 1; d[o++] = c[0]; d[o++] = c[1]; d[o++] = c[2]; } });
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
    return { buf: buf, n: segs.length * 2, mode: gl.LINES };
  };
  Gfx.prototype.free = function (m) { if (m && m.buf) this.gl.deleteBuffer(m.buf); };
  Gfx.prototype.begin = function (w, h, bg) {
    var gl = this.gl;
    gl.viewport(0, 0, w, h);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  };
  Gfx.prototype.draw = function (m, vp, model, o) {
    var gl = this.gl, u = this.u, a = this.a;
    o = o || {};
    model = model || ident();
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
    gl.enableVertexAttribArray(a.pos); gl.vertexAttribPointer(a.pos, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(a.nor); gl.vertexAttribPointer(a.nor, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(a.col); gl.vertexAttribPointer(a.col, 3, gl.FLOAT, false, 36, 24);
    gl.uniformMatrix4fv(u.uMVP, false, mul(vp, model)); gl.uniformMatrix4fv(u.uModel, false, model);
    var alpha = o.alpha == null ? 1 : o.alpha;
    gl.uniform1f(u.uAlpha, alpha); gl.uniform1f(u.uGlow, o.glow || 0); gl.uniform1f(u.uFlat, m.mode === gl.LINES || o.flat ? 1 : 0);
    gl.uniform3fv(u.uTint, o.tint || [1, 0.68, 0.38]); gl.uniform1f(u.uMix, o.mix || 0);
    if (alpha < 1) { gl.enable(gl.BLEND); gl.depthMask(false); } else { gl.disable(gl.BLEND); gl.depthMask(true); }
    gl.drawArrays(m.mode, 0, m.n);
    gl.depthMask(true);
  };

  /* ------------------------------------------------------------ the view */

  var ENV = {
    wheels: { bg: [0.105, 0.145, 0.175], grid: "#2f4f5a", grid2: "#3d6875" },
    prop: { bg: [0.03, 0.12, 0.2], grid: "#17506e", grid2: "#1f6c93" },
    boat: { bg: [0.09, 0.17, 0.23], grid: "#1f6c93", grid2: "#2b8fbf" },
    rocket: { bg: [0.05, 0.06, 0.12], grid: "#3a3f5c", grid2: "#565d8a" },
    none: { bg: [0.105, 0.145, 0.175], grid: "#2f4f5a", grid2: "#3d6875" }
  };

  function BodyView(app, host) {
    this.app = app;
    this.host = host;
    this.cam = { yaw: -0.95, pitch: 0.42, dist: 460, t: [0, 0, 45] };
    this.xray = true;
    this.showParts = true;
    this.mode = "design";
    this.sel = null;                 /* {kind: "solid" | "item", id} */
    this.driving = false;
    this.veh = { x: 0, y: 0, z: 0, yaw: 0, vz: 0, spinL: 0, spinR: 0, spinP: 0, dist: 0, top: 0 };
    this.cache = {};
    this.dirty = true;
    this.build();
  }
  L.BodyView = BodyView;

  BodyView.prototype.build = function () {
    var self = this, h = this.host;
    h.innerHTML =
      '<canvas class="b3-canvas" aria-label="The body in 3-D. Drag to turn it; scroll to zoom; click a shape to select it."></canvas>' +
      '<div class="st-bar" role="toolbar" aria-label="Body">' +
        '<div class="mode" role="group" aria-label="How to draw the shell"><button type="button" data-look="xray" aria-pressed="true" title="See the electronics through the shell">X-ray</button><button type="button" data-look="solid" aria-pressed="false">Solid</button></div>' +
        '<label class="st-chk"><input type="checkbox" data-b3="parts" checked> Electronics</label>' +
        '<span class="st-sep" aria-hidden="true"></span>' +
        '<button type="button" data-b3="drive" class="primary" aria-pressed="false" title="Switch the power on and watch it go">▶ Test drive</button>' +
        '<button type="button" data-b3="home" title="Put it back where it started">Reset</button>' +
        '<span class="st-sep" aria-hidden="true"></span>' +
        '<button type="button" data-b3="mount" title="Put the board, motors and battery back in their places">Re-seat electronics</button>' +
        '<button type="button" data-b3="resize" title="Rebuild this body to fit the electronics as they are now">Resize to fit</button>' +
        '<span class="st-sep" aria-hidden="true"></span>' +
        '<button type="button" data-b3="preview" aria-pressed="false" title="The pieces as they will come off the printer">Print preview</button>' +
        '<button type="button" data-b3="export" class="primary" title="STL files for a 3-D printer">Export for 3-D printing</button>' +
      '</div>' +
      '<div class="b3-hud" hidden></div>' +
      '<p class="st-status" role="status" aria-live="polite"></p>';
    this.canvas = h.querySelector("canvas");
    this.status = h.querySelector(".st-status");
    this.hud = h.querySelector(".b3-hud");
    this.gfx = new Gfx(this.canvas);
    h.querySelectorAll("[data-look]").forEach(function (b) {
      b.addEventListener("click", function () {
        self.xray = b.getAttribute("data-look") === "xray";
        h.querySelectorAll("[data-look]").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
        self.dirty = true;
      });
    });
    h.querySelectorAll("[data-b3]").forEach(function (b) {
      var k = b.getAttribute("data-b3");
      b.addEventListener(b.type === "checkbox" ? "change" : "click", function () {
        if (k === "parts") { self.showParts = b.checked; self.dirty = true; return; }
        self.action(k);
      });
    });
    this.bind();
    if (root.ResizeObserver) new ResizeObserver(function () { self.dirty = true; }).observe(h);
  };

  BodyView.prototype.body = function () { return this.app.doc.body || null; };

  /* An edit to the body: undoable and saved. */
  BodyView.prototype.edit = function (fn, quiet) {
    var app = this.app;
    if (!quiet || this.lastEdit !== quiet || Date.now() - (this.lastEditT || 0) > 1200) app.history.push(app.doc);
    this.lastEdit = quiet || null; this.lastEditT = Date.now();
    fn(app.doc.body);
    this.preview = null;
    app.changed();
    this.dirty = true;
    this.report();
    if (app.layers) app.layers.sync();
    if (app.studio) app.studio.drawerSync();
  };

  BodyView.prototype.action = function (k) {
    var self = this, app = this.app, doc = app.doc, body = doc.body;
    if (k !== "drive" && k !== "home" && !body) { app.toast("Pick a body from the Shapes list on the left to start."); return; }
    switch (k) {
      case "drive": this.setDrive(!this.driving); break;
      case "home": this.veh = { x: 0, y: 0, z: 0, yaw: 0, vz: 0, spinL: 0, spinR: 0, spinP: 0, dist: 0, top: 0 }; this.frameAll(); break;
      case "mount": this.edit(function (b) { b.mounts = Body.automount(doc, b); }); app.toast("Electronics back in their places."); break;
      case "resize":
        if (!Body.TEMPLATES[body.kind]) { app.toast("This body was built by hand, so there is no pattern to resize. Stretch its shapes in the Inspect panel."); break; }
        this.edit(function () { doc.body = Body.make(body.kind, doc, body.wall); });
        this.sel = null; this.inspect(); this.frameAll();
        app.toast("Rebuilt to fit the electronics.");
        break;
      case "preview": this.setPreview(this.mode !== "print"); break;
      case "export": this.exportDialog(); break;
    }
  };

  BodyView.prototype.setPreview = function (on) {
    var b = this.host.querySelector('[data-b3="preview"]');
    if (on) {
      if (this.driving) this.setDrive(false);
      try { this.preview = this.preview || Body.build(this.app.doc, this.body()); }
      catch (e) { if (root.console) console.error(e); this.app.toast("Couldn't work that shape out. Try nudging the overlapping shapes apart a little."); return; }
      this.mode = "print";
    } else this.mode = "design";
    b.setAttribute("aria-pressed", on ? "true" : "false");
    this.dirty = true;
    this.frameAll();
    this.report();
  };

  BodyView.prototype.exportDialog = function () {
    var self = this, app = this.app, out;
    try { out = Body.printFiles(app.doc, this.body(), app.title); }
    catch (e) { if (root.console) console.error(e); app.toast("Couldn't work that shape out. Try nudging the overlapping shapes apart a little."); return; }
    var misfit = Body.fit(app.doc, this.body());
    var d = document.createElement("dialog");
    d.className = "dlg ask st-export";
    var rows = out.pieces.map(function (p) {
      return '<tr><td><i style="background:' + esc(p.color) + '"></i>' + esc(p.name) + (p.qty > 1 ? ' <b>× ' + p.qty + '</b>' : '') + '</td><td>' + p.size.map(function (v) { return v.toFixed(0); }).join(" × ") + ' mm</td><td>≈ ' + Math.max(1, Math.round(p.grams)) + ' g</td></tr>';
    }).join("");
    d.innerHTML = '<form method="dialog"><h2>Print the body</h2>' +
      '<p>' + out.pieces.length + ' different piece' + (out.pieces.length > 1 ? "s" : "") + ', about <b>' + Math.round(out.grams) + ' g</b> of plastic, walls ' + (this.body().wall || 2) + ' mm thick.' +
      (misfit.length ? ' <b class="bad">' + esc(misfit.map(function (m) { return m.name; }).join(", ")) + (misfit.length > 1 ? " don't" : " doesn't") + ' fit inside yet</b> — use Resize to fit first, or it will not close.' : ' Everything fits inside.') + '</p>' +
      '<table class="st-pieces"><tbody>' + rows + '</tbody></table>' +
      '<div class="st-export-list">' +
      '<button type="button" data-x="zip" class="primary"><b>All pieces as STL (.zip)</b><span>One file per piece, lying flat ready to slice, with a print sheet.</span></button>' +
      '</div><p class="hint">Open the files in a slicer (Cura, PrusaSlicer, Bambu Studio) and look them over before you print. A printed body is a model: it is not waterproof or flight-rated on its own.</p>' +
      '<div class="ask-actions"><button value="no" type="submit">Close</button></div></form>';
    document.body.appendChild(d);
    d.addEventListener("close", function () { d.remove(); });
    d.querySelector('[data-x="zip"]').addEventListener("click", function () {
      S.download((app.title || "body") + " — 3D print.zip", S.zip(out.files), "application/zip");
      app.toast("Downloaded " + (out.files.length - 1) + " STL files and a print sheet.");
    });
    d.showModal();
  };

  /* ------------------------------------------------------------- driving */

  BodyView.prototype.setDrive = function (on) {
    var app = this.app, b = this.host.querySelector('[data-b3="drive"]');
    if (on && !this.body()) { app.toast("Pick a body first, then test-drive it."); return; }
    if (on && this.mode === "print") this.setPreview(false);
    this.driving = on;
    b.setAttribute("aria-pressed", on ? "true" : "false");
    b.textContent = on ? "■ Stop" : "▶ Test drive";
    this.hud.hidden = !on;
    if (on) {
      this.sel = null; this.inspect();
      app.sound.wake();
      if (!app.running) app.power(true);
      if (!L.Body.items(app.doc).length) app.toast("There are no electronics in it yet, so nothing will move. Build the circuit on the Bench.");
    } else {
      if (app.running) app.power(false);
      /* back to the workshop: shapes are edited where they were built */
      this.veh = { x: 0, y: 0, z: 0, yaw: 0, vz: 0, spinL: 0, spinR: 0, spinP: 0, dist: 0, top: 0 };
      this.frameAll();
    }
    this.dirty = true;
  };

  /* How hard each motor is turning, -1…1, read from the simulator. */
  BodyView.prototype.throttle = function () {
    var app = this.app, sim = app.sim, out = { motors: [], lamp: 0, servo: null, names: [] }, ref = L.refdes(app.doc);
    if (!app.running) return out;
    app.doc.parts.forEach(function (p) {
      var st = sim.state[p.id] || {};
      if (p.type === "motor" || p.type === "k_motor") { out.motors.push(L.clamp((st.w || 0) / 900, -1.4, 1.4)); out.names.push(ref[p.id]); }
      else if (/^(bulb|k_bulb)$/.test(p.type)) out.lamp = Math.max(out.lamp, Math.min(1, st.b || 0));
      else if (p.type === "relay_module" || p.type === "relay") { if (st.on) out.lamp = 1; }
      else if (p.type === "servo" && st.ang != null) out.servo = st.ang;
    });
    return out;
  };

  BodyView.prototype.stepDrive = function (dt) {
    var body = this.body(), v = this.veh, th = this.throttle(), m = th.motors, kind = body.drive || "none";
    var left = m.length ? m[0] : 0, right = m.length > 1 ? m[1] : left, speed = 0, extra = "";
    if (kind === "wheels") {
      var vl = left * 420, vr = right * 420, track = body.track || 100, R = (body.wheel || 50) / 2;
      speed = (vl + vr) / 2;
      var yawRate = (vr - vl) / track;
      /* one motor and a servo: steer like a real car */
      if (th.servo != null && m.length < 2) yawRate = speed * Math.tan((th.servo - 90) * Math.PI / 180 * 0.4) / 80;
      v.yaw += yawRate * dt; v.x += speed * Math.cos(v.yaw) * dt; v.y += speed * Math.sin(v.yaw) * dt;
      v.spinL += vl / R * dt; v.spinR += vr / R * dt;
    } else if (kind === "prop" || kind === "boat") {
      speed = left * 260;
      v.x += speed * Math.cos(v.yaw) * dt; v.y += speed * Math.sin(v.yaw) * dt;
      v.spinP += left * 40 * dt;
      if (kind === "prop" && m.length > 1) { v.z = L.clamp(v.z - right * 120 * dt, -600, 0); extra = "depth " + Math.round(-v.z) + " mm"; }
      if (th.servo != null) v.yaw += (th.servo - 90) / 90 * 0.9 * Math.abs(left) * dt;
    } else if (kind === "rocket") {
      var thrust = Math.max(Math.abs(left), th.lamp);
      v.vz += (thrust * 1900 - 980) * dt;
      v.z += v.vz * dt;
      if (v.z <= 0) { v.z = 0; if (v.vz < 0) v.vz = 0; }
      v.top = Math.max(v.top, v.z);
      v.flame = thrust;
      speed = v.vz;
      extra = "height " + (v.z / 1000).toFixed(2) + " m · best " + (v.top / 1000).toFixed(2) + " m";
    }
    v.dist += Math.abs(speed) * dt;
    var bars = m.map(function (x, i) { return '<span class="b3-bar"><b>' + esc(th.names[i]) + '</b><i><em style="width:' + Math.round(Math.min(1, Math.abs(x)) * 100) + '%" class="' + (x < 0 ? "rev" : "") + '"></em></i>' + Math.round(L.clamp(x, -1, 1) * 100) + '%</span>'; }).join("");
    var why = !this.app.running ? "The power is off." : !m.length && kind !== "none" && !(kind === "rocket" && th.lamp) ? (kind === "rocket" ? "No motor, bulb or relay in the circuit to act as the engine." : "There is no motor in the circuit, so it stays put.") : "";
    this.hud.innerHTML = '<strong>' + (kind === "rocket" ? "Launch pad" : kind === "prop" ? "Under water" : kind === "boat" ? "On the water" : "Test track") + '</strong>' +
      (bars || "") + '<span>' + (kind === "rocket" ? extra : (Math.abs(speed) / 10).toFixed(0) + " cm/s · " + (v.dist / 1000).toFixed(2) + " m travelled" + (extra ? " · " + extra : "")) + '</span>' +
      (why ? '<span class="warn">' + why + '</span>' : '');
    /* the camera rides along */
    var c = this.cam.t, home = this.home || [0, 0, 45], k = Math.min(1, dt * 5);
    c[0] += (home[0] + v.x - c[0]) * k; c[1] += (home[1] + v.y - c[1]) * k;
    c[2] = kind === "rocket" ? home[2] + v.z : c[2] + (home[2] + v.z - c[2]) * k;      /* a rocket outruns a lazy camera */
  };

  /* ------------------------------------------------------------- meshes */

  BodyView.prototype.solidMesh = function (s) {
    var key = "s|" + [s.shape, s.x, s.y, s.z, s.sx, s.sy, s.sz, s.rx, s.ry, s.rz, s.color, s.op, JSON.stringify(s.p || {})].join("|");
    var c = this.cache[key];
    if (!c) {
      var tris = S.tris(S.fromSpec(s));
      c = this.cache[key] = { tris: tris, gl: this.gfx.mesh(tris, s.op === "cut" ? "#ff5a4a" : s.color) };
    }
    c.used = this.gen;
    return c;
  };
  BodyView.prototype.boxMesh = function (w, d, h, x, y, z, m, color) {
    var key = "b|" + [w, d, h, x, y, z, m.x, m.y, m.z, m.rx, m.ry, m.rz, color].join("|");
    var c = this.cache[key];
    if (!c) {
      var mesh = S.fromSpec({ shape: "box", sx: Math.max(0.3, w), sy: Math.max(0.3, d), sz: Math.max(0.3, h), x: x, y: y, z: z + h / 2 });
      mesh = S.xf(mesh, { r: [m.rx || 0, m.ry || 0, m.rz || 0], t: [m.x, m.y, m.z] });
      var tris = S.tris(mesh);
      c = this.cache[key] = { tris: tris, gl: this.gfx.mesh(tris, color) };
    }
    c.used = this.gen;
    return c;
  };
  BodyView.prototype.sweep = function () {
    var self = this;
    Object.keys(this.cache).forEach(function (k) { var c = self.cache[k]; if (c.used < self.gen - 40) { self.gfx.free(c.gl); delete self.cache[k]; } });
  };

  /* Everything drawn this frame, as {id, kind, tris, gl, model, opts}. */
  BodyView.prototype.scene = function () {
    var self = this, app = this.app, doc = app.doc, body = doc.body, out = [], v = this.veh;
    this.gen = (this.gen || 0) + 1;
    if (!body) return out;
    var V = mul(translate(v.x, v.y, v.z), rotZ(v.yaw));
    var sel = this.sel;
    if (this.mode === "print" && this.preview) {
      var x = 0, widths = this.preview.map(function (p) { return p.size[0] + 14; }), total = widths.reduce(function (a, b) { return a + b; }, 0);
      x = -total / 2;
      this.preview.forEach(function (p, i) {
        var key = "p|" + i + "|" + p.tris.length, c = self.cache[key];
        if (!c) c = self.cache[key] = { tris: p.tris, gl: self.gfx.mesh(p.tris, p.color) };
        c.used = self.gen;
        out.push({ kind: "piece", id: String(i), gl: c.gl, tris: c.tris, model: translate(x + widths[i] / 2, 0, 0), opts: {} });
        x += widths[i];
      });
      return out;
    }
    if (this.showParts) Body.items(doc).forEach(function (it) {
      var m = body.mounts[it.id]; if (!m) return;
      var on = sel && sel.kind === "item" && sel.id === it.id;
      var slab = self.boxMesh(it.w, it.d, it.h, 0, 0, 0, m, it.color);
      out.push({ kind: "item", id: it.id, gl: slab.gl, tris: slab.tris, model: V, opts: { mix: on ? 0.45 : 0 } });
      it.kids.forEach(function (k) {
        var st = (app.running && app.sim.state[k.id]) || {}, lit = /led|bulb/.test(k.type) ? Math.min(1.6, st.b || 0) : 0;
        var km = self.boxMesh(k.w, k.d, k.h, k.x, k.y, k.base ? 0 : it.h, m, k.color);
        out.push({ kind: "item", id: it.id, gl: km.gl, tris: km.tris, model: V, opts: { glow: lit * 1.4, mix: on ? 0.45 : 0 } });
      });
    });
    var later = [];
    body.solids.forEach(function (s) {
      if (s.hide) return;
      var c = self.solidMesh(s), on = sel && sel.kind === "solid" && sel.id === s.id, model = V;
      if (s.role === "wheelL" || s.role === "wheelR" || s.role === "prop") {
        var R = S.rot([s.rx || 0, s.ry || 0, s.rz || 0]), ax = s.role === "prop" ? [R[0], R[3], R[6]] : [R[1], R[4], R[7]];
        var ang = s.role === "prop" ? v.spinP : s.role === "wheelL" ? v.spinL : v.spinR;
        if (ang) model = mul(V, mul(translate(s.x, s.y, s.z), mul(rotAxis(ax, s.role === "prop" ? ang : -ang), translate(-s.x, -s.y, -s.z))));
      }
      var cut = s.op === "cut", hull = s.group === "hull" && !cut;
      var o = { kind: "solid", id: s.id, gl: c.gl, tris: c.tris, model: model, hull: hull,
                opts: { alpha: cut ? 0.34 : hull && self.xray ? 0.3 : 1, mix: on ? 0.5 : 0 } };
      if (o.opts.alpha < 1) later.push(o); else out.push(o);
    });
    if (this.driving && body.drive === "rocket" && v.flame > 0.05) {
      var f = this.boxMesh(1, 1, 1, 0, 0, 0, { x: 0, y: 0, z: 0 }, "#ffb347"), k2 = 14 + 26 * v.flame * (0.8 + 0.2 * Math.sin(Date.now() / 30));
      var fm = mul(V, mul(translate(0, 0, 12 - k2 * 2.2), new Float32Array([k2, 0, 0, 0, 0, k2, 0, 0, 0, 0, k2 * 2.2, 0, 0, 0, 0, 1])));
      later.push({ kind: "fx", id: "flame", gl: f.gl, tris: [], model: fm, opts: { alpha: 0.75, glow: 1.5, flat: true } });
    }
    /* cuts before the shell, so holes show red through it */
    later.sort(function (a, b) { return (a.hull ? 1 : 0) - (b.hull ? 1 : 0); });
    return out.concat(later);
  };

  BodyView.prototype.grid = function () {
    var body = this.body(), env = ENV[(body && body.drive) || "none"] || ENV.none, key = "grid|" + ((body && body.drive) || "none");
    if (!this.cache[key]) {
      var a = [], b = [], n = 30, step = 20;
      for (var i = -n; i <= n; i++) { (i % 5 ? a : b).push([[i * step, -n * step, 0], [i * step, n * step, 0]]); (i % 5 ? a : b).push([[-n * step, i * step, 0], [n * step, i * step, 0]]); }
      /* beside a rocket, a gantry: a rung every 10 cm, so height shows */
      var tower = [];
      if (body && body.drive === "rocket") {
        [[-170, -60], [-170, 60]].forEach(function (q) { tower.push([[q[0], q[1], 0], [q[0], q[1], 12000]]); });
        for (var zz = 0; zz <= 12000; zz += 100) tower.push([[-170, -60, zz], [-170, 60, zz]]);
      }
      this.cache[key] = { fine: this.gfx.lines(a, env.grid), bold: this.gfx.lines(b.concat(tower), env.grid2), env: env };
    }
    this.cache[key].used = this.gen + 1e6;
    return this.cache[key];
  };

  /* --------------------------------------------------------------- frame */

  BodyView.prototype.viewProj = function () {
    var c = this.cam, w = this.canvas.width || 1, h = this.canvas.height || 1;
    var eye = [c.t[0] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw), c.t[1] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), c.t[2] + c.dist * Math.sin(c.pitch)];
    this.eye = eye;
    return mul(perspective(0.7, w / h, Math.max(2, c.dist / 60), c.dist * 12 + 3000), lookAt(eye, c.t, [0, 0, 1]));
  };

  BodyView.prototype.frame = function (dt) {
    if (!this.gfx.ok) return;
    var body = this.body();
    if (this.driving && body) { this.stepDrive(dt); this.dirty = true; }
    else if (this.app.running && this.showParts) this.dirty = true;      /* LEDs may be blinking */
    if (!this.dirty) return;
    this.dirty = false;
    var r = this.host.getBoundingClientRect(), dpr = Math.min(2, root.devicePixelRatio || 1);
    var w = Math.max(2, Math.round(r.width * dpr)), h = Math.max(2, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    var g = this.grid(), vp = this.viewProj(), self = this, v = this.veh;
    this.gfx.begin(w, h, g.env.bg);
    /* the floor follows the vehicle in whole squares, so it never runs out */
    var gx = Math.round(this.cam.t[0] / 100) * 100, gy = Math.round(this.cam.t[1] / 100) * 100;
    var gz = body && body.drive === "prop" ? -640 : body && body.drive === "boat" && this.mode !== "print" ? 0 : 0;
    this.gfx.draw(g.fine, vp, translate(gx, gy, gz), { alpha: 0.999 });
    this.gfx.draw(g.bold, vp, translate(gx, gy, gz), { alpha: 0.999 });
    this.last = this.scene();
    this.last.forEach(function (o) { self.gfx.draw(o.gl, vp, o.model, o.opts); });
    if (!(this.gen % 60)) this.sweep();
    void v;
  };

  /* Pull the camera back until the whole thing is in view. */
  BodyView.prototype.frameAll = function () {
    var body = this.body(), lo = [-60, -40, 0], hi = [60, 40, 60];
    if (this.mode === "print" && this.preview) {
      var tw = this.preview.reduce(function (a, p) { return a + p.size[0] + 14; }, 0), th = Math.max.apply(null, this.preview.map(function (p) { return p.size[2]; }));
      lo = [-tw / 2, -60, 0]; hi = [tw / 2, 60, th];
    } else if (body && body.solids.length) {
      lo = [1e9, 1e9, 1e9]; hi = [-1e9, -1e9, -1e9];
      body.solids.forEach(function (s) {
        var r = Math.max(s.sx, s.sy, s.sz) / 2;
        [s.x, s.y, s.z].forEach(function (c, k) { lo[k] = Math.min(lo[k], c - r); hi[k] = Math.max(hi[k], c + r); });
      });
    }
    var v = this.veh, size = Math.max(hi[0] - lo[0], hi[1] - lo[1], (hi[2] - lo[2]) * 1.3);
    this.home = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    this.cam.t = [this.home[0] + v.x, this.home[1] + v.y, this.home[2] + v.z];
    this.cam.dist = L.clamp(size * 1.75, 120, 3000);
    this.dirty = true;
  };
  BodyView.prototype.fit = function () { this.frameAll(); };
  BodyView.prototype.zoomBy = function (f) { this.cam.dist = L.clamp(this.cam.dist / f, 60, 4000); this.dirty = true; };

  /* --------------------------------------------------------------- input */

  BodyView.prototype.ray = function (cx, cy) {
    var r = this.canvas.getBoundingClientRect(), V = S.vec;
    this.viewProj();
    var f = norm(V.sub(this.cam.t, this.eye)), right = norm(V.cross(f, [0, 0, 1])), up = V.cross(right, f);
    var t = Math.tan(0.35), nx = ((cx - r.left) / r.width * 2 - 1) * t * (r.width / r.height), ny = (1 - (cy - r.top) / r.height * 2) * t;
    return { o: this.eye, d: norm([f[0] + right[0] * nx + up[0] * ny, f[1] + right[1] * nx + up[1] * ny, f[2] + right[2] * nx + up[2] * ny]), f: f };
  };

  /* What is under the pointer? With the shell see-through, things inside
   * it win: that is why it is see-through. */
  BodyView.prototype.pickAt = function (cx, cy) {
    if (!this.last || this.driving || this.mode === "print") return null;
    var ray = this.ray(cx, cy), best = null, bestHull = null;
    this.last.forEach(function (o) {
      if (o.kind !== "solid" && o.kind !== "item") return;
      for (var i = 0; i < o.tris.length; i++) {
        var t = Body.hit(ray.o, ray.d, o.tris[i]);
        if (t == null || t <= 0) continue;
        if (o.hull && o.opts.alpha < 1) { if (!bestHull || t < bestHull.t) bestHull = { t: t, kind: o.kind, id: o.id }; }
        else if (!best || t < best.t) best = { t: t, kind: o.kind, id: o.id };
      }
    });
    return best || bestHull;
  };

  BodyView.prototype.target = function (sel) {
    var body = this.body();
    if (!sel || !body) return null;
    if (sel.kind === "solid") return body.solids.filter(function (s) { return s.id === sel.id; })[0] || null;
    return body.mounts[sel.id] || null;
  };

  BodyView.prototype.bind = function () {
    var self = this, cv = this.canvas, g = null;
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    cv.addEventListener("wheel", function (e) {
      e.preventDefault();
      self.cam.dist = L.clamp(self.cam.dist * Math.exp(e.deltaY * 0.0012), 60, 4000);
      self.dirty = true;
    }, { passive: false });
    cv.addEventListener("pointerdown", function (e) {
      cv.setPointerCapture(e.pointerId);
      var hit = self.pickAt(e.clientX, e.clientY), sel = self.sel;
      var same = hit && sel && hit.kind === sel.kind && hit.id === sel.id;
      g = { x: e.clientX, y: e.clientY, moved: false, hit: hit, pan: e.button === 2 || e.button === 1 || e.ctrlKey || e.metaKey,
            yaw: self.cam.yaw, pitch: self.cam.pitch, t: self.cam.t.slice() };
      if (same && !g.pan) {
        var obj = self.target(sel), ray = self.ray(e.clientX, e.clientY);
        g.drag = { obj: obj, ox: obj.x, oy: obj.y, oz: obj.z, lift: e.shiftKey, start: null };
        g.drag.start = e.shiftKey ? planeHit(ray, [obj.x, obj.y, obj.z], [ray.f[0], ray.f[1], 0]) : planeHit(ray, [0, 0, obj.z], [0, 0, 1]);
      }
    });
    cv.addEventListener("pointermove", function (e) {
      if (!g) { cv.style.cursor = self.pickAt(e.clientX, e.clientY) ? "pointer" : ""; return; }
      var dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.moved && Math.hypot(dx, dy) < 4) return;
      g.moved = true;
      if (g.drag && g.drag.start) {
        var ray = self.ray(e.clientX, e.clientY), d = g.drag, o = d.obj;
        var p = d.lift ? planeHit(ray, [d.ox, d.oy, d.oz], [ray.f[0], ray.f[1], 0]) : planeHit(ray, [0, 0, d.oz], [0, 0, 1]);
        if (!p) return;
        self.edit(function () {
          if (d.lift) o.z = Math.round(d.oz + p[2] - d.start[2]);
          else { o.x = Math.round(d.ox + p[0] - d.start[0]); o.y = Math.round(d.oy + p[1] - d.start[1]); }
        }, "drag:" + self.sel.id);
        self.inspectValues();
        return;
      }
      if (g.pan) {
        var k = self.cam.dist / 700, cy = Math.cos(g.yaw), sy = Math.sin(g.yaw);
        self.cam.t = [g.t[0] + (sy * dx + cy * dy * Math.sin(g.pitch)) * k, g.t[1] + (-cy * dx + sy * dy * Math.sin(g.pitch)) * k, g.t[2] + dy * Math.cos(g.pitch) * k];
      } else {
        self.cam.yaw = g.yaw - dx * 0.008;
        self.cam.pitch = L.clamp(g.pitch + dy * 0.006, -0.2, 1.5);
      }
      self.dirty = true;
    });
    var up = function () {
      var was = g; g = null;
      if (!was || was.moved) return;
      self.select(was.hit ? { kind: was.hit.kind, id: was.hit.id } : null);
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", function () { g = null; });
  };
  function planeHit(ray, point, normal) {
    var V = S.vec, n = norm(normal), den = V.dot(ray.d, n);
    if (Math.abs(den) < 1e-6) return null;
    var t = V.dot(V.sub(point, ray.o), n) / den;
    return t > 0 ? [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t] : null;
  }

  BodyView.prototype.select = function (sel) {
    this.sel = sel && this.target(sel) ? sel : null;
    this.dirty = true;
    this.inspect();
    if (this.app.studio) this.app.studio.drawerSync();
  };

  BodyView.prototype.key = function (e) {
    var sel = this.sel, self = this;
    if (!sel) return false;
    if ((e.key === "Delete" || e.key === "Backspace") && sel.kind === "solid") { this.remove(sel.id); return true; }
    if (e.key === "Escape") { this.select(null); return true; }
    var step = e.shiftKey ? 5 : 1, d = { ArrowLeft: [0, step, 0], ArrowRight: [0, -step, 0], ArrowUp: [step, 0, 0], ArrowDown: [-step, 0, 0], PageUp: [0, 0, step], PageDown: [0, 0, -step] }[e.key];
    if (d) { var o = this.target(sel); this.edit(function () { o.x += d[0]; o.y += d[1]; o.z += d[2]; }, "nudge:" + sel.id); this.inspectValues(); return true; }
    if ((e.key === "d" || e.key === "D") && (e.ctrlKey || e.metaKey) && sel.kind === "solid") { self.duplicate(sel.id, false); return true; }
    return false;
  };

  /* ------------------------------------------------------------ editing */

  BodyView.prototype.addShape = function (shape) {
    var app = this.app, doc = app.doc, self = this, s;
    var dflt = { box: [40, 30, 20], cyl: [24, 24, 30], cone: [24, 24, 30], sphere: [30, 30, 30], dome: [36, 36, 18], nose: [30, 30, 45], capsule: [90, 34, 34], tube: [30, 30, 30],
                 wedge: [40, 30, 20], fin: [30, 3, 50], carbody: [130, 70, 48], boat: [150, 70, 36], wheel: [44, 18, 44], prop: [9, 36, 36] }[shape] || [30, 30, 30];
    this.edit(function () {
      if (!doc.body) doc.body = Body.blank();
      var top = 0;
      doc.body.solids.forEach(function (q) { if (q.op !== "cut") top = Math.max(top, q.z + q.sz / 2); });
      s = Body.solid(S.SHAPES[shape] || "Shape", shape, [0, 0, doc.body.solids.length ? top + dflt[2] / 2 + 6 : dflt[2] / 2], dflt,
        { group: /wheel|prop/.test(shape) ? "part" : doc.body.solids.some(function (q) { return q.group === "hull" && q.op !== "cut"; }) ? "attach" : "hull",
          role: shape === "prop" ? "prop" : "", color: /wheel/.test(shape) ? "#2a2f35" : "#d4893a" });
      doc.body.solids.push(s);
      Body.ensure(doc);
    });
    this.select({ kind: "solid", id: s.id });
    if (doc.body.solids.length === 1) this.frameAll();
  };

  BodyView.prototype.useTemplate = function (kind) {
    var self = this, app = this.app, doc = app.doc;
    var go = function () {
      self.edit(function () { doc.body = Body.make(kind, doc, doc.body && doc.body.wall); });
      self.veh = { x: 0, y: 0, z: 0, yaw: 0, vz: 0, spinL: 0, spinR: 0, spinP: 0, dist: 0, top: 0 };
      self.sel = null; self.inspect(); self.frameAll();
      var need = Body.need(doc);
      app.toast(Body.TEMPLATES[kind].name + " built round your electronics (" + Math.round(need.w) + " × " + Math.round(need.d) + " mm). Drag to look around; click a shape to change it.");
    };
    if (doc.body && doc.body.solids.length) L.confirmBox("Replace the body you have with a new " + Body.TEMPLATES[kind].name.toLowerCase() + "? Undo brings the old one back.", "Replace it", "Cancel").then(function (ok) { if (ok) go(); });
    else go();
  };

  BodyView.prototype.duplicate = function (id, mirror) {
    var body = this.body(), s = this.target({ kind: "solid", id: id }), c;
    if (!s) return;
    this.edit(function () {
      c = JSON.parse(JSON.stringify(s)); c.id = L.uid("s");
      if (mirror) { c.y = -s.y; c.rz = -(s.rz || 0); c.rx = -(s.rx || 0); c.name = s.name.replace(/left/i, "§").replace(/right/i, "Left").replace("§", "Right"); if (c.role === "wheelL") c.role = "wheelR"; else if (c.role === "wheelR") c.role = "wheelL"; }
      else { c.x += 12; c.y += 12; c.name = s.name + " copy"; }
      body.solids.push(c);
    });
    this.select({ kind: "solid", id: c.id });
  };
  BodyView.prototype.remove = function (id) {
    var body = this.body();
    this.sel = null;
    this.edit(function () { body.solids = body.solids.filter(function (s) { return s.id !== id; }); });
    this.inspect();
  };

  /* ----------------------------------------------------------- inspector */

  var KINDS = [["hull", "Part of the hollow shell"], ["attach", "Stuck onto the shell (solid)"], ["part", "Printed on its own"], ["cut", "A hole cut out of the shell"]];
  var ROLES = [["", "Nothing — it just sits there"], ["wheelL", "A left wheel (turns with motor 1)"], ["wheelR", "A right wheel (turns with motor 2)"], ["prop", "A propeller (spins with motor 1)"], ["led", "A hole for a light or sensor"]];

  BodyView.prototype.inspect = function () {
    var app = this.app, pane = document.getElementById("pane-inspect"), body = this.body(), self = this;
    if (!pane) return;
    app.panels.sel = null;
    var num = function (k, label, v, step, min) { return '<label class="b3-num"><span>' + label + '</span><input type="number" data-k="' + k + '" value="' + v + '" step="' + (step || 1) + '"' + (min != null ? ' min="' + min + '"' : '') + '></label>'; };
    if (!body) {
      pane.innerHTML = '<div class="empty"><p class="big">Give your circuit a body.</p><p>Pick a ready-made one from <b>Shapes</b> on the left — a car, a submarine, a rocket — and it is built round the electronics you have. Or ask the AI to design one.</p></div>';
      return;
    }
    var sel = this.sel, o = this.target(sel), h;
    if (sel && sel.kind === "solid" && o) {
      var kind = o.op === "cut" ? "cut" : o.group;
      h = '<header class="insp-head"><h3>' + esc(S.SHAPES[o.shape] || "Shape") + '</h3><p>Drag it in the picture to slide it along the ground; hold <kbd>Shift</kbd> while dragging to lift it. Arrow keys nudge.</p></header>' +
        '<div class="insp-props">' +
        '<label class="row"><span>Name</span><input data-k="name" value="' + esc(o.name) + '" maxlength="40"></label>' +
        '<label class="row"><span>Shape</span><select data-k="shape">' + Object.keys(S.SHAPES).map(function (k) { return '<option value="' + k + '"' + (k === o.shape ? " selected" : "") + '>' + S.SHAPES[k] + '</option>'; }).join("") + '</select></label>' +
        '<label class="row"><span>It is</span><select data-k="kind">' + KINDS.map(function (k) { return '<option value="' + k[0] + '"' + (k[0] === kind ? " selected" : "") + '>' + k[1] + '</option>'; }).join("") + '</select></label>' +
        '<label class="row"><span>It does</span><select data-k="role">' + ROLES.map(function (k) { return '<option value="' + k[0] + '"' + (k[0] === (o.role || "") ? " selected" : "") + '>' + k[1] + '</option>'; }).join("") + '</select></label>' +
        '<fieldset class="b3-grid"><legend>Size (mm)</legend>' + num("sx", "Long", o.sx, 1, 0.5) + num("sy", "Wide", o.sy, 1, 0.5) + num("sz", "Tall", o.sz, 1, 0.5) + '</fieldset>' +
        '<fieldset class="b3-grid"><legend>Position (mm)</legend>' + num("x", "Forward", o.x) + num("y", "Left", o.y) + num("z", "Up", o.z) + '</fieldset>' +
        '<fieldset class="b3-grid"><legend>Turned (°)</legend>' + num("rx", "Roll", o.rx || 0, 5) + num("ry", "Pitch", o.ry || 0, 5) + num("rz", "Yaw", o.rz || 0, 5) + '</fieldset>' +
        (o.op === "cut" ? '' : '<label class="row"><span>Colour</span><input type="color" data-k="color" value="' + esc(/^#[0-9a-f]{6}$/i.test(o.color) ? o.color : "#d4893a") + '"></label>') +
        '</div><div class="insp-actions"><button type="button" data-act="dupe">Duplicate</button><button type="button" data-act="mirror" title="A copy on the other side">Mirror copy</button>' +
        '<button type="button" data-act="delete" class="danger">Delete</button></div>';
    } else if (sel && sel.kind === "item" && o) {
      var it = Body.items(app.doc).filter(function (x) { return x.id === sel.id; })[0] || { name: "Electronics", w: 0, d: 0, h: 0 };
      h = '<header class="insp-head"><h3>' + esc(it.name) + '</h3><p>' + Math.round(it.w) + ' × ' + Math.round(it.d) + ' × ' + Math.round(it.top || it.h) + ' mm. Drag it to where it should sit inside the body.' +
        (it.id === "@board" ? ' The shell grows four posts under it to screw it down.' : '') + '</p></header><div class="insp-props">' +
        '<fieldset class="b3-grid"><legend>Position (mm)</legend>' + num("x", "Forward", o.x) + num("y", "Left", o.y) + num("z", "Up", o.z) + '</fieldset>' +
        '<fieldset class="b3-grid"><legend>Turned (°)</legend>' + num("rx", "Roll", o.rx || 0, 90) + num("ry", "Pitch", o.ry || 0, 90) + num("rz", "Yaw", o.rz || 0, 90) + '</fieldset></div>' +
        (app.partById(sel.id) ? '<div class="insp-actions"><button type="button" data-act="bench">Show it on the bench</button></div>' : '');
    } else {
      var misfit = Body.fit(app.doc, body), nHull = body.solids.filter(function (s) { return s.group === "hull" && s.op !== "cut"; }).length;
      h = '<header class="insp-head"><h3>' + esc((Body.TEMPLATES[body.kind] || { name: "Your own body" }).name) + '</h3><p>' + body.solids.length + ' shapes. Click one in the picture — or in <b>Layers</b> on the left — to change it.</p></header>' +
        '<div class="insp-props">' +
        '<label class="row range"><span>Wall thickness <output>' + (body.wall || 2) + ' mm</output></span><input type="range" data-b="wall" min="1.2" max="4" step="0.2" value="' + (body.wall || 2) + '"></label>' +
        '<label class="row"><span>Printed as</span><select data-b="split"><option value="z"' + (body.split === "z" ? " selected" : "") + '>Two halves, top and bottom</option><option value="none"' + (body.split !== "z" ? " selected" : "") + '>One piece</option></select></label>' +
        (body.split === "z" ? '<label class="row"><span>Split height (mm)</span><input type="number" data-b="splitZ" value="' + (body.splitZ || 0) + '" step="1"></label>' : '') +
        '<label class="row"><span>When test-driven it</span><select data-b="drive">' + [["none", "stays still"], ["wheels", "drives on its wheels"], ["prop", "swims (submarine)"], ["boat", "sails (boat)"], ["rocket", "lifts off (rocket)"]].map(function (k) { return '<option value="' + k[0] + '"' + (k[0] === (body.drive || "none") ? " selected" : "") + '>' + k[1] + '</option>'; }).join("") + '</select></label>' +
        '</div>' +
        (misfit.length ? '<ul class="probs"><li class="warn"><strong>Doesn’t fit yet</strong><p>' + esc(misfit.map(function (m) { return m.name; }).join(", ")) + (misfit.length > 1 ? " stick" : " sticks") + ' out through the shell. Press <b>Resize to fit</b>, or drag ' + (misfit.length > 1 ? "them" : "it") + ' back inside.</p></li></ul>'
                        : nHull ? '<p class="hint good">✓ All the electronics fit inside the shell.</p>' : '<p class="hint">No shape is marked as the hollow shell yet, so nothing will be hollowed out.</p>') +
        '<p class="hint"><b>Drag</b> turns the view · <b>right-drag</b> slides it · <b>scroll</b> zooms. Red shapes are holes.</p>';
    }
    pane.innerHTML = h;
    pane.querySelectorAll("[data-k]").forEach(function (inp) {
      inp.addEventListener(inp.type === "color" ? "input" : "change", function () {
        var k = inp.getAttribute("data-k"), v = inp.type === "number" ? parseFloat(inp.value) : inp.value;
        if (inp.type === "number" && !isFinite(v)) return;
        self.edit(function () {
          if (k === "kind") { if (v === "cut") o.op = "cut"; else { o.op = "add"; o.group = v; } }
          else if (k === "role") { if (v) o.role = v; else delete o.role; }
          else if (k === "name") o.name = String(v).slice(0, 40) || "Shape";
          else if (/^s[xyz]$/.test(k)) o[k] = L.clamp(v, 0.5, 600);
          else if (/^[xyz]$/.test(k)) o[k] = L.clamp(v, -1000, 1000);
          else if (/^r[xyz]$/.test(k)) o[k] = ((v % 360) + 360) % 360;
          else o[k] = v;
        }, inp.type === "color" ? "color:" + o.id : null);
        if (k === "kind" || k === "shape") self.inspect();
      });
    });
    pane.querySelectorAll("[data-b]").forEach(function (inp) {
      inp.addEventListener(inp.type === "range" ? "input" : "change", function () {
        var k = inp.getAttribute("data-b"), v = inp.type === "range" || inp.type === "number" ? parseFloat(inp.value) : inp.value;
        self.edit(function (b) { b[k] = v; }, inp.type === "range" ? "wall" : null);
        if (inp.type === "range") inp.parentNode.querySelector("output").textContent = v + " mm"; else self.inspect();
      });
    });
    pane.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-act");
        if (a === "dupe") self.duplicate(sel.id, false);
        else if (a === "mirror") self.duplicate(sel.id, true);
        else if (a === "delete") self.remove(sel.id);
        else if (a === "bench") { app.studio.setSpace("bench"); app.focusPart(sel.id); }
      });
    });
  };
  /* While dragging, only the numbers change: rebuilding the panel would
   * steal the pointer. */
  BodyView.prototype.inspectValues = function () {
    var o = this.target(this.sel), pane = document.getElementById("pane-inspect");
    if (!o || !pane) return;
    ["x", "y", "z"].forEach(function (k) { var i = pane.querySelector('[data-k="' + k + '"]'); if (i && document.activeElement !== i) i.value = o[k]; });
  };

  BodyView.prototype.report = function () {
    var body = this.body(), app = this.app;
    this.emptyNote();
    if (!body) { this.status.innerHTML = ""; return; }
    if (this.mode === "print" && this.preview) {
      var g = this.preview.reduce(function (a, p) { return a + p.grams; }, 0);
      this.status.innerHTML = '<b>On the print bed</b> · ' + this.preview.map(function (p) { return esc(p.name) + (p.qty > 1 ? " × " + p.qty : ""); }).join(" · ") + ' · about ' + Math.round(g) + ' g of plastic';
      return;
    }
    var misfit = Body.fit(app.doc, body), items = Body.items(app.doc);
    this.status.innerHTML = '<b>' + esc((Body.TEMPLATES[body.kind] || { name: "Your own body" }).name) + '</b> · ' + body.solids.length + ' shapes · ' +
      (items.length ? (misfit.length ? '<span class="bad">' + misfit.length + ' thing' + (misfit.length > 1 ? "s don't" : " doesn't") + ' fit inside</span>' : '<span class="good">the electronics fit inside</span>') : 'no electronics yet');
  };

  /* Bring the body up to date with the bench and redraw. */
  BodyView.prototype.sync = function () {
    var doc = this.app.doc;
    if (doc.body && Body.ensure(doc)) this.app.changed();
    if (this.sel && !this.target(this.sel)) this.sel = null;
    this.preview = null;
    if (this.mode === "print") { this.mode = "design"; this.host.querySelector('[data-b3="preview"]').setAttribute("aria-pressed", "false"); }
    this.dirty = true;
    this.report();
  };
  BodyView.prototype.emptyNote = function () {
    var h = this.host, em = h.querySelector(".st-empty");
    if (this.body() && this.gfx.ok) { if (em) em.remove(); return; }
    if (!em) { em = document.createElement("div"); em.className = "st-empty"; h.appendChild(em); }
    em.innerHTML = !this.gfx.ok ? '<p class="big">This browser can\'t draw 3-D here.</p><p>The body is still saved, and you can still export it for printing.</p>'
      : '<p class="big">Give your circuit a body.</p><p>Choose a ready-made one on the left — toy car, rover, submarine, rocket, boat or a plain case — and it is built round your electronics. Or press <b>Ask AI</b> and describe what you want to make.</p>';
  };

  /* ---------------------------------------------------- the left drawer */

  BodyView.prototype.shapesDrawer = function (box) {
    var self = this, h = '<h3>Start from a ready-made body</h3><div class="b3-templates">';
    Object.keys(Body.TEMPLATES).forEach(function (k) { var t = Body.TEMPLATES[k]; h += '<button type="button" data-tpl="' + k + '"><b>' + esc(t.name) + '</b><span>' + esc(t.blurb) + '</span></button>'; });
    h += '</div><h3>Add a shape</h3><div class="b3-shapes">';
    Object.keys(S.SHAPES).forEach(function (k) { h += '<button type="button" data-shape="' + k + '">' + shapeIcon(k) + '<span>' + S.SHAPES[k] + '</span></button>'; });
    h += '</div><p class="hint">A new shape lands on top of the body. Say what it is in the Inspect panel: part of the shell, stuck on, printed on its own, or a hole.</p>';
    box.innerHTML = h;
    box.querySelectorAll("[data-tpl]").forEach(function (b) { b.addEventListener("click", function () { self.useTemplate(b.getAttribute("data-tpl")); }); });
    box.querySelectorAll("[data-shape]").forEach(function (b) { b.addEventListener("click", function () { self.addShape(b.getAttribute("data-shape")); }); });
  };
  function shapeIcon(k) {
    var p = {
      box: '<path d="M6 12l10-5 10 5v11l-10 5-10-5z M6 12l10 5 10-5 M16 17v11"/>', cyl: '<ellipse cx="16" cy="9" rx="9" ry="4"/><path d="M7 9v14c0 2.2 4 4 9 4s9-1.8 9-4V9"/>',
      cone: '<path d="M16 5L7 24c0 2 4 3.5 9 3.5s9-1.500 9-3.500z"/>', sphere: '<circle cx="16" cy="16" r="10"/><ellipse cx="16" cy="16" rx="10" ry="4"/>',
      dome: '<path d="M6 22a10 12 0 0 1 20 0z"/><ellipse cx="16" cy="22" rx="10" ry="3"/>', nose: '<path d="M16 4c5 6 7 13 7 20H9c0-7 2-14 7-20z"/>',
      capsule: '<rect x="4" y="10" width="24" height="12" rx="6"/>', tube: '<ellipse cx="16" cy="9" rx="9" ry="4"/><ellipse cx="16" cy="9" rx="5" ry="2"/><path d="M7 9v14c0 2.2 4 4 9 4s9-1.8 9-4V9"/>',
      wedge: '<path d="M5 24h22L5 9z"/>', fin: '<path d="M8 27V5l16 16v6z"/>', carbody: '<path d="M3 23v-6l3-1 4-7h10l5 7 4 1v6z"/>', boat: '<path d="M4 12h17l7 6-7 6H4z"/>',
      wheel: '<circle cx="16" cy="16" r="11"/><circle cx="16" cy="16" r="4"/>', prop: '<circle cx="16" cy="16" r="2.5"/><path d="M16 13c-4-8 4-9 2-1 M18.500 17.500c9 0 5 7 0 1 M13.500 17.500c-5 7-9 0-1-1.500"/>'
    }[k] || '<rect x="8" y="8" width="16" height="16"/>';
    return '<svg viewBox="0 0 32 32" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }

  /* The body's own list: every shape, and everything mounted in it. */
  BodyView.prototype.layersDrawer = function (box) {
    var self = this, app = this.app, body = this.body(), sel = this.sel;
    if (!body) { box.innerHTML = '<div class="empty"><p class="big">No body yet.</p><p>Pick one under <b>Shapes</b>.</p></div>'; return; }
    var groups = [["hull", "Shell"], ["attach", "Stuck on"], ["part", "Printed on their own"], ["cut", "Holes"]], h = "";
    groups.forEach(function (g) {
      var rows = body.solids.filter(function (s) { return (s.op === "cut" ? "cut" : s.group) === g[0]; });
      if (!rows.length) return;
      h += '<div class="ly-head static">' + g[1] + ' <span>' + rows.length + '</span></div><ul class="ly-list">';
      rows.forEach(function (s) {
        var on = sel && sel.kind === "solid" && sel.id === s.id;
        h += '<li class="ly-row' + (on ? " on" : "") + (s.hide ? " hidden-part" : "") + '" tabindex="' + (on ? 0 : -1) + '" data-kind="solid" data-id="' + s.id + '"><span class="ly-ico"><i class="ly-dot" style="background:' + esc(s.op === "cut" ? "#ff5a4a" : s.color) + '"></i></span>' +
          '<span class="ly-text">' + esc(s.name) + '<small>' + esc(S.SHAPES[s.shape] || "") + ' · ' + Math.round(s.sx) + '×' + Math.round(s.sy) + '×' + Math.round(s.sz) + '</small></span>' +
          '<span class="ly-acts"><button type="button" data-ly="hide" aria-pressed="' + !!s.hide + '" title="' + (s.hide ? "Show it again" : "Hide it, to see inside") + '" aria-label="Hide ' + esc(s.name) + '">' + (s.hide ? "◌" : "●") + '</button></span></li>';
      });
      h += '</ul>';
    });
    var items = Body.items(app.doc);
    if (items.length) {
      h += '<div class="ly-head static">Electronics inside <span>' + items.length + '</span></div><ul class="ly-list">';
      items.forEach(function (it) {
        var on = sel && sel.kind === "item" && sel.id === it.id;
        h += '<li class="ly-row' + (on ? " on" : "") + '" tabindex="' + (on ? 0 : -1) + '" data-kind="item" data-id="' + esc(it.id) + '"><span class="ly-ico"><i class="ly-dot sq" style="background:' + esc(it.color) + '"></i></span>' +
          '<span class="ly-text">' + esc(it.name) + '<small>' + Math.round(it.w) + '×' + Math.round(it.d) + '×' + Math.round(it.top || it.h) + ' mm' + (it.kids.length ? ' · ' + it.kids.length + ' parts on it' : '') + '</small></span></li>';
      });
      h += '</ul>';
    }
    h += '<p class="hint">Click to select · ↑ ↓ to walk the list</p>';
    box.innerHTML = h;
    box.querySelectorAll(".ly-row").forEach(function (li) {
      var kind = li.getAttribute("data-kind"), id = li.getAttribute("data-id");
      li.addEventListener("click", function (e) {
        if (e.target.closest("[data-ly]")) { var s = self.target({ kind: "solid", id: id }); self.edit(function () { if (s.hide) delete s.hide; else s.hide = true; }); return; }
        self.select({ kind: kind, id: id });
      });
      li.addEventListener("keydown", function (e) {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault(); e.stopPropagation();
        var all = Array.prototype.slice.call(box.querySelectorAll(".ly-row")), n = all[all.indexOf(li) + (e.key === "ArrowDown" ? 1 : -1)];
        if (n) { self.select({ kind: n.getAttribute("data-kind"), id: n.getAttribute("data-id") }); var f = box.querySelector(".ly-row.on"); if (f) f.focus(); }
      });
    });
  };
})(typeof window !== "undefined" ? window : globalThis);
