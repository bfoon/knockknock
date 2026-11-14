/* Chalk Power Lab — the print shop.
 *
 * The small plastic parts an installation always turns out to need, sized
 * from this plan — a clip for the cable you chose, a wedge cut to this
 * site's tilt — drawn in 3-D, checked for printing, and exported as STL
 * or 3MF. Or describe a part in words and let the AI model it.
 *
 * Geometry comes from the Circuit Lab's solid modeller (lab_solid.js);
 * print advice from lab_print.js.
 */
(function (root) {
  "use strict";

  var W = root.ChalkPower, esc = W.esc;
  var Shop = W.PrintShop = {};
  function S() { return root.ChalkLab && root.ChalkLab.Solid; }
  function $(id) { return document.getElementById(id); }
  function od(mm2) { return Math.round((2 * Math.sqrt(mm2 / Math.PI) + 2.4) * 10) / 10; }     /* a cable's outside diameter */
  function sp(shape, x, y, z, sx, sy, sz, o) { var s = { shape: shape, x: x, y: y, z: z, sx: sx, sy: sy, sz: sz }; if (o) for (var k in o) s[k] = o[k]; return s; }

  /* Each part: fields the person can set, and build(values) -> [{name, solids, qty, color}] */
  Shop.PARTS = {
    clip: {
      name: "Cable clip", blurb: "A saddle that screws a cable to a wall or a rail.",
      fields: [["mm2", "For cable", "mm2", 6], ["qty", "How many", "num", 10, 1, 60]],
      build: function (v) {
        var d = od(v.mm2) + 0.4, w = d + 18, h = d / 2 + 3.5;
        return [{ name: "Cable clip " + v.mm2 + " mm²", qty: v.qty, color: "#2b2f36", solids: [sp("box", 0, 0, h / 2, w, 11, h), sp("cyl", 0, 0, 0, d, d, 30, { rx: 90, is: "cut" }),
          sp("cyl", -(d / 2 + 5), 0, h / 2, 4.2, 4.2, 30, { is: "cut" }), sp("cyl", d / 2 + 5, 0, h / 2, 4.2, 4.2, 30, { is: "cut" })] }];
      }
    },
    comb: {
      name: "Cable comb", blurb: "Holds a row of cables side by side, tidy and apart.",
      fields: [["mm2", "For cable", "mm2", 4], ["n", "Cables", "num", 4, 2, 12], ["qty", "How many", "num", 4, 1, 40]],
      build: function (v) {
        var d = od(v.mm2) + 0.3, pitch = d + 3.5, w = v.n * pitch + 4, h = d * 0.75 + 4, sol = [sp("box", 0, 0, h / 2, w, 8, h)];
        for (var i = 0; i < v.n; i++) sol.push(sp("cyl", (i - (v.n - 1) / 2) * pitch, 0, h - d * 0.25, d, d, 30, { rx: 90, is: "cut" }));
        return [{ name: "Cable comb " + v.n + " × " + v.mm2 + " mm²", qty: v.qty, color: "#2b2f36", solids: sol }];
      }
    },
    jbox: {
      name: "Junction box and lid", blurb: "A small enclosure with cable entries, for a joint that must stay dry and out of reach.",
      fields: [["w", "Inside width (mm)", "num", 70, 30, 180], ["d", "Inside depth (mm)", "num", 50, 30, 180], ["h", "Inside height (mm)", "num", 35, 15, 100], ["mm2", "Cable entries for", "mm2", 2.5]],
      build: function (v) {
        var t = 2.4, W2 = v.w + 2 * t, D = v.d + 2 * t, H = v.h + t, e = od(v.mm2) + 1;
        return [{ name: "Junction box", qty: 1, color: "#dfe5e9", solids: [sp("box", 0, 0, H / 2, W2, D, H), sp("box", 0, 0, t + v.h / 2 + 1, v.w, v.d, v.h + 2, { is: "cut" }),
          sp("cyl", -W2 / 2, 0, t + v.h * 0.45, e, e, 3 * t + 4, { ry: 90, is: "cut" }), sp("cyl", W2 / 2, 0, t + v.h * 0.45, e, e, 3 * t + 4, { ry: 90, is: "cut" }),
          sp("box", -W2 / 2 - 6, 0, t / 2, 14, 16, t), sp("box", W2 / 2 + 6, 0, t / 2, 14, 16, t), sp("cyl", -W2 / 2 - 8, 0, 0, 4.2, 4.2, 20, { is: "cut" }), sp("cyl", W2 / 2 + 8, 0, 0, 4.2, 4.2, 20, { is: "cut" })] },
          { name: "Junction box lid", qty: 1, color: "#dfe5e9", solids: [sp("box", 0, 0, t / 2, W2, D, t), sp("box", 0, 0, t + 1.5, v.w - 0.5, v.d - 0.5, 3), sp("box", 0, 0, t + 2, v.w - 4.5, v.d - 4.5, 3, { is: "cut" })] }];
      }
    },
    boot: {
      name: "Battery terminal cover", blurb: "Stops a dropped spanner bridging the posts. Red for plus, black for minus.",
      fields: [["mm2", "Battery cable", "mm2", 35], ["pole", "Which post", "select", "plus", [["plus", "Positive (red)"], ["minus", "Negative (black)"]]]],
      build: function (v) {
        var c = od(v.mm2) + 1.5, w = Math.max(30, c + 14), t = 2;
        return [{ name: "Terminal cover " + (v.pole === "plus" ? "+" : "−"), qty: 1, color: v.pole === "plus" ? "#c0392b" : "#2b2f36",
          solids: [sp("box", 0, 0, 13, w, w, 26), sp("box", 0, 0, 12 - t / 2, w - 2 * t, w - 2 * t, 24, { is: "cut" }), sp("box", w / 2, 0, c / 2, 3 * t + 2, c, c + 0.01, { is: "cut" })] }];
      }
    },
    foot: {
      name: "Panel mounting foot", blurb: "A Z-bracket that clamps a small panel's frame to a board or a roof batten.",
      fields: [["frame", "Panel frame height (mm)", "num", 25, 15, 45], ["qty", "How many", "num", 4, 1, 16]],
      build: function (v) {
        var f = v.frame, t = 4, w = 28;
        return [{ name: "Panel foot " + f + " mm", qty: v.qty, color: "#8d99a3", solids: [sp("box", -14, 0, t / 2, 28 + t, w, t), sp("box", 0, 0, (f + t) / 2, t, w, f + t), sp("box", 11, 0, f + t / 2, 22 + t, w, t),
          sp("cyl", -18, 0, 0, 5.2, 5.2, 30, { is: "cut" }), sp("cyl", 14, 0, f, 5.2, 5.2, 30, { is: "cut" })] }];
      }
    },
    gauge: {
      name: "Tilt gauge", blurb: "A wedge cut to this site's best tilt. Rest it on the frame with a spirit level on top: when the level reads flat, the panel is right.",
      fields: [["tilt", "Tilt (°)", "num", 15, 5, 60], ["len", "Length (mm)", "num", 120, 60, 200]],
      build: function (v) {
        var h = v.len * Math.tan(v.tilt * Math.PI / 180);
        return [{ name: "Tilt gauge " + v.tilt + "°", qty: 1, color: "#d4893a", solids: [sp("wedge", 0, 0, h / 2, v.len, 18, h), sp("cyl", -v.len / 2 + Math.min(14, h * 0.6 + 6), 0, Math.min(8, h * 0.3), 5, 5, 40, { rx: 90, is: "cut" })] }];
      }
    },
    stand: {
      name: "Desk stand for a small panel", blurb: "Props a 5–20 W panel at the right tilt on a windowsill or a classroom bench.",
      fields: [["tilt", "Tilt (°)", "num", 15, 5, 60], ["len", "Panel length (mm)", "num", 160, 80, 220], ["wide", "Stand width (mm)", "num", 60, 30, 150]],
      build: function (v) {
        var run = v.len * Math.cos(v.tilt * Math.PI / 180) * 0.7, h = run * Math.tan(v.tilt * Math.PI / 180);
        return [{ name: "Panel stand " + v.tilt + "°", qty: 2, color: "#d4893a", solids: [sp("wedge", 0, 0, h / 2, run, v.wide, h), sp("box", run / 2 - 1.5, 0, 5, 3, v.wide, 10),
          sp("box", 0, 0, h * 0.3, run * 0.55, v.wide - 8, h, { is: "cut" })] }];
      }
    }
  };

  /* Turn a part's shapes into pieces lying on the bed, analysed. */
  Shop.make = function (parts, printer, material) {
    var Sd = S();
    return parts.map(function (p) {
      var mesh = Sd.fromSolids(p.solids);
      if (!mesh.length) return null;
      var best = Sd.orient(Sd.sealed(Sd.lay(mesh)));
      return { name: p.name, qty: p.qty || 1, color: p.color || "#d4893a", tris: best.tris, way: best.label, a: Sd.analyse(best.tris, printer, material) };
    }).filter(Boolean);
  };

  /* --------------------------------------------- a small 3-D viewer (2-D canvas) */

  function Viewer(cv) {
    var self = this; this.cv = cv; this.c = cv.getContext("2d"); this.yaw = -0.7; this.pitch = 0.5; this.pieces = [];
    var drag = null;
    cv.addEventListener("pointerdown", function (e) { drag = [e.clientX, e.clientY]; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener("pointermove", function (e) { if (!drag) return; self.yaw += (e.clientX - drag[0]) * 0.01; self.pitch = W.clamp(self.pitch + (e.clientY - drag[1]) * 0.01, -0.2, 1.5); drag = [e.clientX, e.clientY]; self.draw(); });
    cv.addEventListener("pointerup", function () { drag = null; });
  }
  Viewer.prototype.set = function (pieces) { this.pieces = pieces; this.draw(); };
  Viewer.prototype.draw = function () {
    var c = this.c, Wd = this.cv.width, H = this.cv.height, cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), spn = Math.sin(this.pitch), list = [], x0 = 0, total = 0, r = 10;
    c.fillStyle = "#0f1820"; c.fillRect(0, 0, Wd, H);
    this.pieces.forEach(function (p) { total += p.a.size[0] + 12; });
    x0 = -total / 2;
    this.pieces.forEach(function (p) {
      var ox = x0 + p.a.size[0] / 2, m = /^#?([0-9a-f]{6})$/i.exec(p.color), n = m ? parseInt(m[1], 16) : 0xd4893a, col = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      x0 += p.a.size[0] + 12; r = Math.max(r, p.a.size[1], p.a.size[2] * 1.4);
      p.tris.forEach(function (t) {
        var pts = [], depth = 0;
        for (var k = 0; k < 3; k++) { var X = t[k][0] + ox, Y = t[k][1], Z = t[k][2], x1 = X * cy - Y * sy, y1 = X * sy + Y * cy; pts.push([x1, Z * cp - y1 * spn]); depth += y1 * cp + Z * spn; }
        var nrm = t[3] || [0, 0, 1], nx = nrm[0] * cy - nrm[1] * sy, ny = nrm[0] * sy + nrm[1] * cy, facing = -(ny * cp + nrm[2] * spn) * -1;
        var lit = 0.35 + 0.65 * Math.max(0, nrm[2] * 0.75 + nx * 0.35 - ny * 0.45);
        list.push([depth, pts, col, lit, nrm[2] < -0.72 && (t[0][2] + t[1][2] + t[2][2]) / 3 > 0.3, facing]);
      });
    });
    r = Math.max(r, total);
    var sc = Math.min(Wd, H * 1.5) / (r * 1.25), ox2 = Wd / 2, oy = H * 0.62;
    list.sort(function (a, b) { return b[0] - a[0]; });
    list.forEach(function (q) {
      c.beginPath(); q[1].forEach(function (p2, i) { var x = ox2 + p2[0] * sc, y = oy - p2[1] * sc; if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.closePath();
      var k = q[3], col = q[4] ? [255, 120, 70] : q[2];
      c.fillStyle = "rgb(" + Math.round(col[0] * k) + "," + Math.round(col[1] * k) + "," + Math.round(col[2] * k) + ")"; c.fill(); c.strokeStyle = c.fillStyle; c.lineWidth = 0.6; c.stroke();
    });
    c.fillStyle = "rgba(232,238,244,.55)"; c.font = "11px system-ui"; c.fillText("Drag to turn. Orange faces hang over nothing and would need support.", 10, H - 10);
  };
  Shop.Viewer = Viewer;

  /* ------------------------------------------------------------ the dialog */

  Shop.open = function (app) {
    var Sd = S();
    if (!Sd || !Sd.fromSolids) { app.toast("The 3-D tools did not load on this page."); return; }
    var site = app.doc.site, used = {}; app.doc.wires.forEach(function (w) { used[w.mm2] = (used[w.mm2] || 0) + 1; });
    var common = +Object.keys(used).sort(function (a, b) { return used[b] - used[a]; })[0] || 4;
    var d = W.dialog("wide shop", "Print shop",
      '<div class="ps-cols"><aside><h3>Ready-made, sized for this plan</h3><div class="ps-list" id="ps-list"></div><h3>Or describe a part</h3>' +
      '<textarea id="ps-say" rows="3" placeholder="e.g. a wall bracket to hold a 12 V 7 Ah battery, 151 × 65 × 94 mm, with two screw holes"></textarea><button type="button" id="ps-ai">' + (app.cfg.aiEnabled ? "Model it with AI" : "AI is off on this server") + '</button></aside>' +
      '<section><canvas id="ps-view" width="640" height="340"></canvas><div class="ps-fields" id="ps-fields"></div>' +
      '<div class="wz-opts"><label>Printer<select id="ps-printer">' + Object.keys(Sd.PRINTERS).map(function (k) { return '<option value="' + k + '">' + esc(Sd.PRINTERS[k].name) + '</option>'; }).join("") + '</select></label>' +
      '<label>Plastic<select id="ps-mat">' + Object.keys(Sd.MATERIALS).map(function (k) { return '<option value="' + k + '"' + (k === "petg" ? " selected" : "") + '>' + esc(Sd.MATERIALS[k].name) + '</option>'; }).join("") + '</select></label></div>' +
      '<div class="ps-advice" id="ps-advice"></div></section></div>',
      '<button type="button" id="ps-coach">Ask the AI about printing it</button><button type="button" id="ps-obj">OBJ</button><button type="button" id="ps-3mf">3MF (all pieces, one file)</button><button type="button" class="primary" id="ps-stl">STL files (.zip)</button>');
    var viewer = new Viewer($("ps-view")), cur = "clip", vals = {}, custom = null, pieces = [], note = "";
    $("ps-ai").disabled = !app.cfg.aiEnabled; $("ps-coach").hidden = !app.cfg.aiEnabled;
    $("ps-list").innerHTML = Object.keys(Shop.PARTS).map(function (k) { return '<button type="button" data-part="' + k + '"><b>' + esc(Shop.PARTS[k].name) + '</b><span>' + esc(Shop.PARTS[k].blurb) + '</span></button>'; }).join("");
    var defaults = function (k) { var v = {}; Shop.PARTS[k].fields.forEach(function (f) { v[f[0]] = f[0] === "tilt" ? W.clamp(Math.round(site.tilt) || 15, 5, 60) : f[2] === "mm2" && used[f[3]] == null && f[0] === "mm2" && k !== "boot" ? common : f[3]; }); return v; };
    var rebuild = function () {
      var parts = custom || Shop.PARTS[cur].build(vals);
      try { pieces = Shop.make(parts, $("ps-printer").value, $("ps-mat").value); } catch (e) { if (root.console) console.error(e); pieces = []; }
      viewer.set(pieces);
      $("ps-advice").innerHTML = pieces.length ? '<table class="pw-bom"><tbody>' + pieces.map(function (p) { return '<tr><td><i class="pw-dot" style="background:' + esc(p.color) + '"></i>' + esc(p.name) + (p.qty > 1 ? " × " + p.qty : "") + '</td><td>' + p.a.size.map(function (x) { return x.toFixed(0); }).join(" × ") + ' mm</td><td>≈ ' + Math.max(1, Math.round(p.a.grams * p.qty)) + ' g</td><td>printed ' + esc(p.way) + '</td></tr>'; }).join("") + '</tbody></table>' +
        W.md(note || Sd.advice(pieces, $("ps-mat").value, "outdoor")) : '<p class="pw-bad">That shape could not be built. Try other sizes.</p>';
    };
    var pick = function (k) {
      cur = k; custom = null; note = ""; vals = defaults(k);
      d.querySelectorAll("[data-part]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-part") === k ? "true" : "false"); });
      $("ps-fields").innerHTML = Shop.PARTS[k].fields.map(function (f) {
        var id = "psf-" + f[0];
        if (f[2] === "mm2") return '<label>' + esc(f[1]) + '<select id="' + id + '" data-v="' + f[0] + '">' + W.SIZES.map(function (s) { return '<option value="' + s + '"' + (s === vals[f[0]] ? " selected" : "") + '>' + s + ' mm² (' + od(s) + ' mm across)</option>'; }).join("") + '</select></label>';
        if (f[2] === "select") return '<label>' + esc(f[1]) + '<select id="' + id + '" data-v="' + f[0] + '" data-s="1">' + f[4].map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + '</option>'; }).join("") + '</select></label>';
        return '<label>' + esc(f[1]) + '<input type="number" id="' + id + '" data-v="' + f[0] + '" min="' + f[4] + '" max="' + f[5] + '" value="' + vals[f[0]] + '"></label>';
      }).join("");
      $("ps-fields").querySelectorAll("[data-v]").forEach(function (el) { el.addEventListener("change", function () { var f = Shop.PARTS[cur].fields.filter(function (q) { return q[0] === el.getAttribute("data-v"); })[0]; vals[f[0]] = el.getAttribute("data-s") ? el.value : f[2] === "num" ? W.clamp(+el.value || f[3], f[4], f[5]) : +el.value; rebuild(); }); });
      rebuild();
    };
    d.querySelectorAll("[data-part]").forEach(function (b) { b.addEventListener("click", function () { pick(b.getAttribute("data-part")); }); });
    $("ps-printer").addEventListener("change", rebuild); $("ps-mat").addEventListener("change", function () { note = ""; rebuild(); });
    var base = function () { return (custom ? "custom part" : Shop.PARTS[cur].name).replace(/[^\w -]+/g, "_"); };
    $("ps-stl").addEventListener("click", function () {
      if (!pieces.length) return;
      var sheet = "Print sheet — made in Chalk Power Lab. Units are millimetres.\r\n\r\n" + pieces.map(function (p, i) { return (i + 1) + ". " + p.name + (p.qty > 1 ? " — print " + p.qty : "") + "\r\n   " + p.a.size.map(function (x) { return x.toFixed(0); }).join(" x ") + " mm, about " + Math.round(p.a.grams) + " g each, printed " + p.way + ".\r\n   " + p.a.notes.map(function (n) { return n[1]; }).join("\r\n   "); }).join("\r\n\r\n") + "\r\n";
      Sd.download(base() + " — 3D print.zip", Sd.zip(pieces.map(function (p, i) { return { name: (i + 1) + "-" + p.name.replace(/[^\w-]+/g, "_") + (p.qty > 1 ? "-x" + p.qty : "") + ".stl", data: Sd.stl(p.tris, p.name) }; }).concat([{ name: "PRINT-SHEET.txt", data: sheet }])), "application/zip");
    });
    $("ps-3mf").addEventListener("click", function () { if (pieces.length) Sd.download(base() + ".3mf", Sd.threeMF(pieces, base()), "model/3mf"); });
    $("ps-obj").addEventListener("click", function () { if (pieces.length) Sd.download(base() + ".obj", Sd.obj(pieces), "text/plain"); });
    $("ps-ai").addEventListener("click", function () {
      var text = $("ps-say").value.trim(), b = $("ps-ai"); if (!text) { $("ps-say").focus(); return; }
      b.disabled = true; b.textContent = "Modelling…";
      W.AI.post(app, { kind: "part3d", question: text }).then(function (j) {
        var sol = j.body && j.body.solids || [];
        if (!sol.length) { app.toast("The AI didn't describe a shape that could be built. Try saying the sizes in millimetres.", "warn"); return; }
        custom = [{ name: text.slice(0, 40), qty: 1, color: (j.body && j.body.color) || "#d4893a", solids: sol }]; note = j.reply || "";
        d.querySelectorAll("[data-part]").forEach(function (x) { x.setAttribute("aria-pressed", "false"); }); $("ps-fields").innerHTML = '<p class="hint">Modelled by the AI from your words. Measure it in the slicer before trusting a fit.</p>';
        rebuild();
      }, function (e) { app.toast((e && e.friendly) || "The AI didn't answer.", "warn"); }).then(function () { b.disabled = false; b.textContent = "Model it with AI"; });
    });
    $("ps-coach").addEventListener("click", function () {
      if (!pieces.length) return;
      var b = $("ps-coach"); b.disabled = true; b.textContent = "Asking…";
      W.AI.post(app, { kind: "printcoach", question: "How should I print this?", report: { material: $("ps-mat").value, printer: Sd.PRINTERS[$("ps-printer").value].name, use: "outdoors near a solar installation in " + site.name,
        pieces: pieces.map(function (p) { return { name: p.name, qty: p.qty, size: p.a.size.map(Math.round), grams: Math.round(p.a.grams), hours: Math.round(p.a.hours * 10) / 10, overhangCm2: Math.round(p.a.overhang / 100), needsSupport: p.a.needsSupport, baseCm2: Math.round(p.a.base / 100), way: p.way }; }) } })
        .then(function (j) { note = j.reply || ""; rebuild(); }, function (e) { app.toast((e && e.friendly) || "The AI didn't answer.", "warn"); }).then(function () { b.disabled = false; b.textContent = "Ask the AI about printing it"; });
    });
    pick("clip");
  };
})(typeof window !== "undefined" ? window : globalThis);
