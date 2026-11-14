/* Chalk — getting a shape ready for a 3-D printer.
 *
 * lab_solid.js makes the shapes and writes STL. This adds what a person
 * standing at the printer wants to know before pressing Print, and the
 * other file formats slicers like:
 *
 *   Solid.analyse(tris, printer)   size, plastic, time, overhangs, whether
 *                                  it needs supports, whether it fits the bed
 *   Solid.orient(tris)             the way up that needs the least support
 *   Solid.turn(tris, [rx,ry,rz])   the same triangles, turned and laid on z = 0
 *   Solid.threeMF(objects, title)  one .3mf holding every piece, in colour
 *   Solid.obj(objects)             a Wavefront .obj
 *   Solid.all(list) / Solid.fromSolids(solids)   many shapes -> one piece
 *
 * No DOM (except nothing): used by the Circuit Lab's Body space and by the
 * Power Lab's print shop, and tested under Node.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab = root.ChalkLab || {};
  var S = L.Solid;
  if (!S) return;

  S.PRINTERS = {
    ender:  { name: "Ender 3 / most hobby printers", bed: [220, 220, 250] },
    prusa:  { name: "Prusa MK3 / MK4", bed: [250, 210, 210] },
    bambu:  { name: "Bambu Lab A1 / P1 / X1", bed: [256, 256, 256] },
    mini:   { name: "A small printer (180 mm)", bed: [180, 180, 180] },
    big:    { name: "A large printer (300 mm)", bed: [300, 300, 340] }
  };
  S.MATERIALS = {
    pla:  { name: "PLA", density: 1.24, note: "Easy and stiff. Softens above 55 °C: it will sag on a roof or in a parked car." },
    petg: { name: "PETG", density: 1.27, note: "Tougher, good to 75 °C and happy outdoors. The right choice for anything near a solar panel." },
    asa:  { name: "ASA", density: 1.07, note: "Made for sun and heat (95 °C). Needs an enclosed printer and fresh air." },
    tpu:  { name: "TPU (flexible)", density: 1.21, note: "Rubbery: for grommets, feet and seals. Print it slowly." }
  };

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function areaN(t) { var n = cross(sub(t[1], t[0]), sub(t[2], t[0])), l = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]); return [l / 2, l ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 1]]; }

  S.all = function (list) { var m = []; list.forEach(function (x) { m = m.length ? S.union(m, x) : x; }); return m; };

  /* A pile of {shape, x, y, z, sx, sy, sz, rx, ry, rz, is|op} -> one printable
   * piece: everything added together, then every "cut" taken out. */
  S.fromSolids = function (solids) {
    var adds = [], cuts = [];
    (solids || []).forEach(function (s) { if (!s || !S.SHAPES[s.shape]) return; (s.is === "cut" || s.op === "cut" ? cuts : adds).push(S.fromSpec(s)); });
    if (!adds.length) return [];
    var m = S.all(adds);
    if (cuts.length) m = S.subtract(m, S.all(cuts));
    return m;
  };
  /* Centre it on the bed and sit it on z = 0. */
  S.lay = function (m) { var b = S.bbox(m); return S.xf(m, { t: [-(b.lo[0] + b.hi[0]) / 2, -(b.lo[1] + b.hi[1]) / 2, -b.lo[2]] }); };

  S.turn = function (tris, r) {
    var M = S.rot(r), lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    var out = tris.map(function (t) {
      return [0, 1, 2].map(function (k) {
        var q = t[k], v = [M[0] * q[0] + M[1] * q[1] + M[2] * q[2], M[3] * q[0] + M[4] * q[1] + M[5] * q[2], M[6] * q[0] + M[7] * q[1] + M[8] * q[2]];
        for (var a = 0; a < 3; a++) { if (v[a] < lo[a]) lo[a] = v[a]; if (v[a] > hi[a]) hi[a] = v[a]; }
        return v;
      });
    });
    var dx = -(lo[0] + hi[0]) / 2, dy = -(lo[1] + hi[1]) / 2, dz = -lo[2];
    out.forEach(function (t) { for (var k = 0; k < 3; k++) { t[k][0] += dx; t[k][1] += dy; t[k][2] += dz; } t[3] = areaN(t)[1]; });
    return out;
  };

  /* What printing these triangles, this way up, will involve. */
  S.analyse = function (tris, printer, material) {
    var bed = (S.PRINTERS[printer] || S.PRINTERS.ender).bed, mat = S.MATERIALS[material] || S.MATERIALS.pla;
    var lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], area = 0, over = 0, base = 0, column = 0, steep = 0;
    tris.forEach(function (t) {
      for (var k = 0; k < 3; k++) for (var a = 0; a < 3; a++) { if (t[k][a] < lo[a]) lo[a] = t[k][a]; if (t[k][a] > hi[a]) hi[a] = t[k][a]; }
    });
    tris.forEach(function (t) {
      var an = areaN(t), z = (t[0][2] + t[1][2] + t[2][2]) / 3 - lo[2];
      area += an[0];
      if (an[1][2] < -0.99 && z < 0.3) base += an[0];
      else if (an[1][2] < -0.72) { over += an[0]; column += an[0] * -an[1][2] * z; if (an[1][2] < -0.95) steep += an[0]; }
    });
    var size = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], vol = Math.abs(S.volume(tris));
    /* three walls of plastic round the outside, a fifth full inside */
    var skin = Math.min(vol, area * 1.2), plastic = skin + (vol - skin) * 0.2, support = column * 0.12;
    var grams = (plastic + support) / 1000 * mat.density, hours = (plastic + support) / 8 / 3600 * 1.7 + size[2] / 0.2 * 2.5 / 3600;
    var fits = size[0] <= bed[0] && size[1] <= bed[1] && size[2] <= bed[2], turned = !fits && size[1] <= bed[0] && size[0] <= bed[1] && size[2] <= bed[2];
    var out = { size: size, volume: vol, area: area, grams: grams, hours: hours, overhang: over, overhangPct: area ? 100 * over / area : 0, base: base, supportGrams: support / 1000 * mat.density,
                needsSupport: over > 60 && over > 0.015 * area, fits: fits || turned, turnOnBed: turned, tall: size[2] > 4 * Math.max(8, Math.min(size[0], size[1])), notes: [] };
    if (!out.fits) out.notes.push(["bad", "Too big for the bed: " + size.map(function (v) { return v.toFixed(0); }).join(" × ") + " mm against " + bed.join(" × ") + ". Split it, scale it, or use a bigger printer."]);
    else if (turned) out.notes.push(["info", "Turn it a quarter-turn on the bed to fit."]);
    if (out.needsSupport) out.notes.push(["warn", "About " + (over / 100).toFixed(0) + " cm² hangs out over nothing (steeper than 45°). Switch supports on" + (steep > 0.6 * over ? "; much of it is a flat ceiling, so use a support roof." : " — tree supports come away cleanest.")]);
    else out.notes.push(["ok", "No supports needed this way up."]);
    if (base < 0.04 * area && base < 150) out.notes.push(["warn", "Very little of it touches the bed (" + (base / 100).toFixed(1) + " cm²). Add a brim so it does not peel off."]);
    if (out.tall) out.notes.push(["warn", "Tall and thin: slow the print down and add a brim, or it will wobble near the top."]);
    if (Math.min(size[0], size[1], size[2]) < 1.2) out.notes.push(["warn", "Under 1.2 mm in one direction: fewer than three nozzle-widths. It will be fragile."]);
    if (S.leaks && tris.length < 60000 && S.leaks(tris) > 0) out.notes.push(["info", "The skin has a few hairline seams from the cutting. Every slicer's repair step closes them."]);
    return out;
  };

  /* Try it on each of its six faces; keep the way up with the least to
   * hold up, breaking ties by the lowest (most stable, fastest) print. */
  S.orient = function (tris) {
    var ways = [[[0, 0, 0], "as it stands"], [[180, 0, 0], "upside down"], [[90, 0, 0], "on its side"], [[-90, 0, 0], "on its other side"], [[0, 90, 0], "on its back end"], [[0, -90, 0], "on its front end"]];
    var best = null;
    ways.forEach(function (w) {
      var t = S.turn(tris, w[0]), a = S.analyse(t, "big"), score = a.overhang + 0.35 * a.size[2] * Math.sqrt(a.area) * 0.05 - 0.5 * a.base;
      if (!best || score < best.score - 1e-6) best = { rot: w[0], label: w[1], tris: t, score: score, overhang: a.overhang };
    });
    return best;
  };

  /* ------------------------------------------------------------- formats */

  function weld(tris) {
    var map = {}, verts = [], faces = [];
    tris.forEach(function (t) {
      var f = [];
      for (var k = 0; k < 3; k++) {
        var key = Math.round(t[k][0] * 2000) + "," + Math.round(t[k][1] * 2000) + "," + Math.round(t[k][2] * 2000);
        if (map[key] == null) { map[key] = verts.length; verts.push(t[k]); }
        f.push(map[key]);
      }
      if (f[0] !== f[1] && f[1] !== f[2] && f[0] !== f[2]) faces.push(f);
    });
    return { verts: verts, faces: faces };
  }
  S.weld = weld;
  function xml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function n3(v) { return (Math.round(v * 1000) / 1000).toString(); }

  /* objects: [{name, tris, color: "#rrggbb", qty}]. Pieces are set out in a
   * row on the bed, so the file opens ready to slice. */
  S.threeMF = function (objects, title) {
    var res = '<basematerials id="1">' + objects.map(function (o) { return '<base name="' + xml(o.name || "part") + '" displaycolor="' + xml((/^#[0-9a-fA-F]{6}$/.test(o.color || "") ? o.color : "#D4893A").toUpperCase()) + '"/>'; }).join("") + '</basematerials>', build = "", x = 0;
    objects.forEach(function (o, i) {
      var w = weld(o.tris), id = i + 2, lo = 1e9, hi = -1e9;
      w.verts.forEach(function (v) { if (v[0] < lo) lo = v[0]; if (v[0] > hi) hi = v[0]; });
      res += '<object id="' + id + '" name="' + xml(o.name || "part") + '" type="model" pid="1" pindex="' + i + '"><mesh><vertices>' +
        w.verts.map(function (v) { return '<vertex x="' + n3(v[0]) + '" y="' + n3(v[1]) + '" z="' + n3(v[2]) + '"/>'; }).join("") + '</vertices><triangles>' +
        w.faces.map(function (f) { return '<triangle v1="' + f[0] + '" v2="' + f[1] + '" v3="' + f[2] + '"/>'; }).join("") + '</triangles></mesh></object>';
      for (var q = 0; q < Math.max(1, o.qty || 1); q++) { build += '<item objectid="' + id + '" transform="1 0 0 0 1 0 0 0 1 ' + n3(x - lo) + ' 0 0"/>'; x += hi - lo + 8; }
    });
    var model = '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
      '<metadata name="Title">' + xml(title || "Chalk model") + '</metadata><metadata name="Application">Chalk</metadata><resources>' + res + '</resources><build>' + build + '</build></model>';
    return S.zip([
      { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>' },
      { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
      { name: "3D/3dmodel.model", data: model }
    ]);
  };

  S.obj = function (objects) {
    var out = "# Made in Chalk. Units are millimetres.\n", base = 1;
    objects.forEach(function (o) {
      var w = weld(o.tris);
      out += "o " + String(o.name || "part").replace(/\s+/g, "_") + "\n" + w.verts.map(function (v) { return "v " + n3(v[0]) + " " + n3(v[1]) + " " + n3(v[2]); }).join("\n") + "\n" +
        w.faces.map(function (f) { return "f " + (f[0] + base) + " " + (f[1] + base) + " " + (f[2] + base); }).join("\n") + "\n";
      base += w.verts.length;
    });
    return out;
  };

  /* Slicer settings in plain words, from the analysis alone: what the
   * built-in adviser says when there is no AI to ask. */
  S.advice = function (pieces, material, use) {
    var mat = S.MATERIALS[material] || S.MATERIALS.pla, need = pieces.some(function (p) { return p.a.needsSupport; }), grams = 0, hours = 0, out = [];
    pieces.forEach(function (p) { grams += p.a.grams * (p.qty || 1); hours += p.a.hours * (p.qty || 1); });
    out.push("**" + pieces.length + " piece" + (pieces.length > 1 ? "s" : "") + ", about " + Math.round(grams) + " g of " + mat.name + " and " + (hours < 1 ? Math.round(hours * 60) + " minutes" : hours.toFixed(1) + " hours") + " of printing.**");
    out.push("- **Material.** " + mat.note + (use === "outdoor" && material === "pla" ? " This part is for outdoors: print it in PETG or ASA instead." : ""));
    out.push("- **Layers.** 0.2 mm is right for almost everything; 0.28 mm if you are in a hurry, 0.12 mm for small detail.");
    out.push("- **Strength.** 3 walls and 20% infill for cases and covers; 4 walls and 40% for anything that takes a screw or carries weight, such as a bracket.");
    out.push("- **Supports.** " + (need ? "Needed for: " + pieces.filter(function (p) { return p.a.needsSupport; }).map(function (p) { return p.name; }).join(", ") + ". Use tree supports, touching the bed only if the slicer allows." : "None needed: every piece is already the best way up."));
    pieces.forEach(function (p) { p.a.notes.forEach(function (n) { if (n[0] === "bad" || (n[0] === "warn" && !/hangs out/.test(n[1]))) out.push("- **" + p.name + ".** " + n[1]); }); });
    out.push("- **First layer.** Clean the bed, print the first layer slowly (20 mm/s), and watch it: if the first layer sticks, the rest usually follows.");
    return out.join("\n");
  };
})(typeof window !== "undefined" ? window : globalThis);
