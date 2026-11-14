/* Chalk Circuit Lab — the maker: AI in the 3-D workshop.
 *
 * The Body space could already design a shell round a circuit. This adds
 * a helper that stays beside the model while you work on it:
 *
 *   Make     describe a thing and get it in 3-D — a body for the
 *            electronics on the bench, or a free-standing object with no
 *            electronics at all (a bracket, a stand, a toy, a tool)
 *   Change   say what to alter — "make it 20 mm longer", "add a carrying
 *            handle", "cut a slot for a USB cable" — and the model is edited
 *            in place, one undo step
 *   Print    the pieces measured for printing: plastic, time, overhangs,
 *            whether they fit the bed and need supports, the best way up —
 *            and advice on settings, from the AI or the built-in adviser
 *
 * and more ways out of the door: 3MF (every piece, in colour, one file)
 * and OBJ beside the STL zip.
 *
 * It hangs itself onto the Body view rather than editing it, so
 * lab_body_view.js is untouched. With no AI key on the server everything
 * here still works from the lab's own rules and patterns.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  if (!L || !L.BodyView || !L.Body || !L.Solid || !L.Solid.analyse) return;
  var S = L.Solid, Body = L.Body, BV = L.BodyView, esc = L.esc;

  var CSS = ".mk{position:absolute;right:12px;bottom:12px;width:min(380px,calc(100% - 24px));max-height:min(560px,calc(100% - 70px));display:flex;flex-direction:column;background:#18222b;border:1px solid #3a4651;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.55);z-index:6;color:#e8eef4;font-size:13.5px}" +
    ".mk header{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid rgba(232,238,244,.1)}.mk header b{flex:1;font-size:14px}.mk header button,.mk-tabs button{background:transparent;border:1px solid transparent;border-radius:7px;color:#8b9aa8;padding:.2rem .55rem;min-height:28px}" +
    ".mk-tabs{display:flex;gap:3px;padding:4px 8px 0}.mk-tabs button[aria-selected=true]{background:#1f2b36;color:#e8eef4;border-color:rgba(232,238,244,.12)}.mk-log{flex:1;overflow:auto;padding:8px 10px;display:grid;gap:7px;align-content:start;min-height:90px}" +
    ".mk-msg{border-radius:9px;padding:7px 10px}.mk-msg.me{background:#1f2b36;justify-self:end;max-width:90%}.mk-msg.bot{background:#16242c;border:1px solid rgba(232,238,244,.1)}.mk-msg p{margin:0 0 5px}.mk-msg ul,.mk-msg ol{margin:0 0 5px;padding-left:18px}.mk-msg table{width:100%;border-collapse:collapse;font-size:12px;margin:4px 0}.mk-msg td{padding:2px 4px;border-bottom:1px solid rgba(232,238,244,.08)}" +
    ".mk-msg .ok{color:#5bd88a}.mk-msg .warn{color:#f2b13a}.mk-msg .bad{color:#ff6a5a}.mk-foot{padding:8px 10px;border-top:1px solid rgba(232,238,244,.1);display:grid;gap:6px}.mk-foot textarea{width:100%;resize:vertical;background:#1f2b36;border:1px solid rgba(232,238,244,.12);border-radius:8px;padding:.4rem .6rem;color:inherit;font:inherit}" +
    ".mk-row{display:flex;gap:6px;flex-wrap:wrap}.mk-row button,.mk-row select{background:#1f2b36;border:1px solid rgba(232,238,244,.12);border-radius:8px;padding:.3rem .65rem;min-height:30px;color:inherit;font:inherit}.mk-row button.primary{background:#d4893a;border-color:#d4893a;color:#1a1208;font-weight:600}.mk-row button:disabled{opacity:.5}" +
    ".mk-chips{display:flex;flex-wrap:wrap;gap:4px}.mk-chips button{font-size:12px;background:#1f2b36;border:1px solid rgba(232,238,244,.12);border-radius:13px;padding:.15rem .6rem;color:#c9d4dd}.mk-fine{color:#8b9aa8;font-size:11.5px;margin:0}" +
    ".lab-link{display:inline-flex;align-items:center;min-height:32px;padding:.35rem .7rem;border:1px solid rgba(232,238,244,.1);border-radius:8px;background:#1f2b36;color:inherit;text-decoration:none;white-space:nowrap}.lab-link:hover{border-color:rgba(232,238,244,.28)}";
  if (typeof document !== "undefined") { var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st); }

  /* -------------------------------------- free-standing objects can print */

  /* The body builder only knew shells: with no hull, shapes that were
   * "stuck on" had nothing to stick to and were left out. A model with no
   * hull is a free-standing object: fuse its shapes, take the cuts out. */
  var build0 = Body.build;
  Body.build = function (doc, body) {
    var out = build0(doc, body);
    var hull = body.solids.some(function (s) { return s.op !== "cut" && s.group === "hull"; });
    var adds = body.solids.filter(function (s) { return s.op !== "cut" && s.group === "attach"; });
    if (hull || !adds.length) return out;
    var spec = adds.concat(body.solids.filter(function (s) { return s.op === "cut"; })).map(function (s) { var q = {}; for (var k in s) q[k] = s[k]; q.is = s.op === "cut" ? "cut" : "attach"; return q; });
    var best = S.orient(S.sealed(S.lay(S.fromSolids(spec)))), mesh = { length: 1 };
    var piece = { name: "Model", file: "model", mesh: mesh, qty: 1, color: adds[0].color, tris: best.tris, note: "Printed " + best.label + ": the way up that needs the least support.", solid: true };
    var b = { lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9] };
    best.tris.forEach(function (t) { for (var k = 0; k < 3; k++) for (var a = 0; a < 3; a++) { b.lo[a] = Math.min(b.lo[a], t[k][a]); b.hi[a] = Math.max(b.hi[a], t[k][a]); } });
    piece.size = [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]];
    piece.grams = S.analyse(best.tris).grams;
    out.unshift(piece);
    return out;
  };

  /* Things the maker can build with no AI at all. */
  var SHELF = {
    stand: { name: "Phone stand", words: /phone|tablet|stand/, solids: [["box", 0, 0, 3, 90, 70, 6], ["wedge", -18, 0, 36, 50, 70, 60, 0, 0, 0, "attach"], ["box", 38, 0, 11, 6, 70, 10], ["box", 10, 0, 30, 30, 40, 70, 0, 0, 0, "cut"]] },
    pot: { name: "Pen pot", words: /pen|pencil|pot|cup|holder/, solids: [["cyl", 0, 0, 45, 70, 70, 90], ["cyl", 0, 0, 48, 64, 64, 90, 0, 0, 0, "cut"]] },
    bracket: { name: "Shelf bracket", words: /bracket|shelf|support|corner/, solids: [["box", 0, 0, 3, 80, 30, 6], ["box", -37, 0, 40, 6, 30, 80], ["wedge", -14, 0, 27, 40, 6, 42], ["cyl", 20, 0, 0, 4.5, 4.5, 30, 0, 0, 0, "cut"], ["cyl", -37, 0, 60, 4.5, 4.5, 30, 0, 90, 0, "cut"]] },
    hook: { name: "Wall hook", words: /hook|hang|coat|key/, solids: [["box", 0, 0, 30, 6, 30, 60], ["box", 14, 0, 6, 30, 30, 6], ["box", 27, 0, 14, 6, 30, 22], ["cyl", 0, 0, 46, 4.5, 4.5, 30, 0, 90, 0, "cut"]] },
    box: { name: "Small box", words: /box|case|tray|bin|container/, solids: [["box", 0, 0, 20, 80, 60, 40], ["box", 0, 0, 23, 75, 55, 40, 0, 0, 0, "cut"]] },
    tidy: { name: "Cable tidy", words: /cable|wire|tidy|clip/, solids: [["box", 0, 0, 6, 80, 22, 12], ["cyl", -24, 0, 12, 8, 8, 40, 90, 0, 0, "cut"], ["cyl", 0, 0, 12, 8, 8, 40, 90, 0, 0, "cut"], ["cyl", 24, 0, 12, 8, 8, 40, 90, 0, 0, "cut"]] }
  };
  function shelfSpec(key) {
    return { kind: "custom", free: true, color: "#d4893a", solids: SHELF[key].solids.map(function (q, i) { return { name: SHELF[key].name + " " + (i + 1), shape: q[0], x: q[1], y: q[2], z: q[3], sx: q[4], sy: q[5], sz: q[6], rx: q[7] || 0, ry: q[8] || 0, rz: q[9] || 0, is: q[10] || "attach" }; }) };
  }

  /* ------------------------------------------------------------ the panel */

  function Maker(view) {
    this.view = view; this.app = view.app; this.tab = "make"; this.busy = false;
    var el = this.el = document.createElement("div"), self = this;
    el.className = "mk"; el.hidden = true;
    el.innerHTML = '<header><b>✨ Maker</b><button type="button" data-mk="close" aria-label="Close">×</button></header>' +
      '<div class="mk-tabs" role="tablist"><button type="button" data-tab="make">Make</button><button type="button" data-tab="change">Change</button><button type="button" data-tab="print">Print</button></div>' +
      '<div class="mk-log" aria-live="polite"></div><div class="mk-foot"></div>';
    view.host.appendChild(el);
    this.log = el.querySelector(".mk-log"); this.foot = el.querySelector(".mk-foot");
    el.querySelector('[data-mk="close"]').addEventListener("click", function () { el.hidden = true; });
    el.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { self.show(b.getAttribute("data-tab")); }); });
    ["pointerdown", "wheel", "keydown"].forEach(function (ev) { el.addEventListener(ev, function (e) { e.stopPropagation(); }); });
  }

  Maker.prototype.say = function (who, html, extra) {
    var d = document.createElement("div"); d.className = "mk-msg " + who; d.innerHTML = html;
    if (extra) d.appendChild(extra);
    this.log.appendChild(d); this.log.scrollTop = this.log.scrollHeight;
    return d;
  };

  Maker.prototype.show = function (tab) {
    var self = this, app = this.app, ai = app.cfg.aiEnabled, f = this.foot;
    this.tab = tab; this.el.hidden = false;
    this.el.querySelectorAll("[data-tab]").forEach(function (b) { b.setAttribute("aria-selected", b.getAttribute("data-tab") === tab ? "true" : "false"); });
    if (tab === "make") {
      f.innerHTML = '<textarea rows="2" placeholder="e.g. a wall bracket for a 7 Ah battery, 151 × 65 mm, with two screw holes — or a fire engine for my buzzer circuit"></textarea>' +
        '<div class="mk-row"><button type="button" class="primary" data-go="object">Make it as an object</button><button type="button" data-go="body" title="A hollow shell sized to hold the circuit on the bench">A body for my electronics</button></div>' +
        '<div class="mk-chips">' + Object.keys(SHELF).map(function (k) { return '<button type="button" data-shelf="' + k + '">' + esc(SHELF[k].name) + '</button>'; }).join("") + '</div>' +
        '<p class="mk-fine">' + (ai ? "Designed by the AI on this server from simple shapes. Measure before you rely on a fit." : "The AI isn't switched on for this server: the buttons above make ready-drawn objects, and a described body comes from the lab's own patterns.") + '</p>';
      f.querySelectorAll("[data-shelf]").forEach(function (b) { b.addEventListener("click", function () { var k = b.getAttribute("data-shelf"); self.say("me", esc(SHELF[k].name)); self.built({ body: shelfSpec(k), reply: "A " + SHELF[k].name.toLowerCase() + " from the lab's shelf. Use **Change** to resize it, or drag its shapes." }); }); });
      f.querySelectorAll("[data-go]").forEach(function (b) { b.addEventListener("click", function () { var t = f.querySelector("textarea").value.trim(); if (!t) { f.querySelector("textarea").focus(); return; } f.querySelector("textarea").value = ""; self.make(b.getAttribute("data-go"), t); }); });
    } else if (tab === "change") {
      f.innerHTML = '<textarea rows="2" placeholder="e.g. make it 20 mm longer · add a carrying handle on top · cut a slot for a USB cable at the back · paint it blue"></textarea>' +
        '<div class="mk-row"><button type="button" class="primary" data-go="edit">Change it</button></div><div class="mk-chips">' + ["Make it 20% bigger", "Make it 15% smaller", "Make it taller", "Make it wider", "Paint it blue"].map(function (t) { return '<button type="button" data-say="' + esc(t) + '">' + esc(t) + '</button>'; }).join("") + '</div>' +
        '<p class="mk-fine">' + (ai ? "The AI edits the shapes that are there. One Undo (Ctrl+Z) takes the whole change back." : "Without the AI, the lab understands: bigger / smaller (with a %), taller, wider, longer, a colour, and “remove” with a shape's name.") + '</p>';
      f.querySelector('[data-go="edit"]').addEventListener("click", function () { var t = f.querySelector("textarea").value.trim(); if (!t) { f.querySelector("textarea").focus(); return; } f.querySelector("textarea").value = ""; self.change(t); });
      f.querySelectorAll("[data-say]").forEach(function (b) { b.addEventListener("click", function () { self.change(b.getAttribute("data-say")); }); });
    } else {
      f.innerHTML = '<div class="mk-row"><select data-p="printer" aria-label="Printer">' + Object.keys(S.PRINTERS).map(function (k) { return '<option value="' + k + '">' + esc(S.PRINTERS[k].name) + '</option>'; }).join("") + '</select>' +
        '<select data-p="mat" aria-label="Plastic">' + Object.keys(S.MATERIALS).map(function (k) { return '<option value="' + k + '">' + esc(S.MATERIALS[k].name) + '</option>'; }).join("") + '</select></div>' +
        '<div class="mk-row"><button type="button" class="primary" data-go="check">Check it for printing</button><button type="button" data-go="3mf">3MF</button><button type="button" data-go="obj">OBJ</button><button type="button" data-go="stl">STL zip</button></div>' +
        '<p class="mk-fine">Measured from the real shapes: nothing here is a guess. Slicers disagree a little on time and plastic.</p>';
      f.querySelector('[data-go="check"]').addEventListener("click", function () { self.check(); });
      ["3mf", "obj", "stl"].forEach(function (k) { f.querySelector('[data-go="' + k + '"]').addEventListener("click", function () { self.exportAs(k); }); });
    }
    if (!this.log.firstChild) this.say("bot", "<p>Describe something and I will model it, change what is here, or check it for the printer.</p>");
  };

  Maker.prototype.ask = function (payload) {
    var app = this.app;
    if (L.aiTransport) return L.aiTransport(payload);
    return fetch(app.cfg.aiUrl, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": app.cfg.csrf }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { if (r.status !== 200 || !j.ok) throw { friendly: j && j.error }; return j; }); });
  };
  Maker.prototype.wait = function () { return this.say("bot", '<span class="dots" aria-label="Thinking"><i></i><i></i><i></i></span> working…'); };

  /* What a design call hands back gets built, and reported on. */
  Maker.prototype.built = function (res) {
    var app = this.app, n = res.body ? app.studio.applyBody(res.body) : 0;
    if (!n) { this.say("bot", '<p class="bad">That did not come back as shapes I could build. Try again with sizes in millimetres.</p>'); return; }
    var free = !app.doc.body.solids.some(function (s) { return s.group === "hull" && s.op !== "cut"; });
    this.say("bot", L.md(res.reply || "Built.") + '<p class="mk-fine">' + n + " shapes" + (free ? ", one solid object" : ", a hollow shell with the electronics inside") + ". Open <b>Print</b> to check it.</p>");
  };

  Maker.prototype.make = function (kind, text) {
    var self = this, app = this.app;
    this.say("me", esc(text));
    if (!app.cfg.aiEnabled) {
      if (kind === "body") { this.built(L.localBody(text)); return; }
      var hit = Object.keys(SHELF).filter(function (k) { return SHELF[k].words.test(text.toLowerCase()); })[0];
      if (hit) this.built({ body: shelfSpec(hit), reply: "The AI is off on this server, so this is the nearest thing on the lab's shelf: a " + SHELF[hit].name.toLowerCase() + "." });
      else this.say("bot", "<p>The AI isn't switched on for this server, so I can only make the ready-drawn objects below, or a body from the lab's patterns.</p>");
      return;
    }
    var w = this.wait(), need = Body.need ? Body.need(app.doc) : null, payload = { kind: kind === "body" ? "body" : "object", question: text, mode: "pro", circuit: kind === "body" ? app.digest() : { parts: [], nets: [] }, code: "" };
    if (kind === "body" && need) payload.circuit.electronics = { w: need.w, d: need.d, h: need.h };
    this.ask(payload).then(function (j) { w.remove(); self.built(j); }, function (e) {
      w.remove();
      if (kind === "body") { var r = L.localBody(text); r.reply = "_" + ((e && e.friendly) || "The AI didn't answer.") + " Here is the nearest of the lab's own bodies._\n\n" + (r.reply || ""); self.built(r); }
      else self.say("bot", '<p class="bad">' + esc((e && e.friendly) || "The AI didn't answer.") + "</p>");
    });
  };

  /* ----------------------------------------------------------- changing it */

  function digestBody(body) {
    return { kind: body.kind, wall: body.wall, solids: body.solids.slice(0, 80).map(function (s) {
      var o = { id: s.id, name: s.name, shape: s.shape, is: s.op === "cut" ? "cut" : s.group, x: s.x, y: s.y, z: s.z, sx: s.sx, sy: s.sy, sz: s.sz, rx: s.rx || 0, ry: s.ry || 0, rz: s.rz || 0, color: s.color };
      if (s.role) o.role = s.role;
      return o;
    }) };
  }
  var NUMS = { x: [-800, 800], y: [-800, 800], z: [-200, 1200], sx: [0.5, 600], sy: [0.5, 600], sz: [0.5, 600], rx: [-360, 360], ry: [-360, 360], rz: [-360, 360] };

  /* Apply checked operations in one undoable step. Returns how many took. */
  Maker.prototype.applyOps = function (ops) {
    var view = this.view, done = 0;
    if (!Array.isArray(ops) || !ops.length || !view.body()) return 0;
    view.edit(function (body) {
      ops.slice(0, 80).forEach(function (op) {
        if (!op || typeof op !== "object") return;
        if (op.op === "add" && op.solid && S.SHAPES[op.solid.shape]) {
          var q = op.solid, is = /^(hull|attach|part|cut)$/.test(q.is) ? q.is : "attach", num = function (k, d) { var v = +q[k]; return isFinite(v) ? L.clamp(Math.round(v * 10) / 10, NUMS[k][0], NUMS[k][1]) : d; };
          if (body.solids.length >= 200) return;
          body.solids.push(Body.solid(String(q.name || S.SHAPES[q.shape]).slice(0, 40), q.shape, [num("x", 0), num("y", 0), num("z", 20)], [num("sx", 30), num("sy", 30), num("sz", 30)],
            { rot: [num("rx", 0), num("ry", 0), num("rz", 0)], color: /^#[0-9a-fA-F]{6}$/.test(q.color || "") ? q.color : "#d4893a", op: is === "cut" ? "cut" : "add", group: is === "cut" ? "attach" : is, role: /^(wheelL|wheelR|prop|led)$/.test(q.role) ? q.role : "" }));
          done++; return;
        }
        var i = -1; body.solids.forEach(function (s, k) { if (s.id === op.id) i = k; });
        if (i < 0) return;
        if (op.op === "remove") { body.solids.splice(i, 1); done++; return; }
        if (op.op !== "set") return;
        var s = body.solids[i], hit = false;
        Object.keys(NUMS).forEach(function (k) { var v = +op[k]; if (op[k] != null && isFinite(v)) { s[k] = L.clamp(Math.round(v * 10) / 10, NUMS[k][0], NUMS[k][1]); hit = true; } });
        if (/^#[0-9a-fA-F]{6}$/.test(op.color || "")) { s.color = op.color; hit = true; }
        if (typeof op.name === "string" && op.name.trim()) { s.name = op.name.replace(/[<>]/g, "").slice(0, 40); hit = true; }
        if (hit) done++;
      });
      if (body.bay && Body.automount) body.mounts = Body.automount(view.app.doc, body);
    });
    view.sel = null; view.inspect(); view.frameAll();
    return done;
  };

  var COLORS = { red: "#d43a2f", blue: "#2f6fd4", green: "#3aa655", yellow: "#e8c22a", orange: "#e8862a", black: "#22272c", white: "#eef1f3", grey: "#8d99a3", gray: "#8d99a3", purple: "#8a4fd4", pink: "#e86aa6", brown: "#8a5a2e" };
  /* The built-in editor: a handful of plain instructions, no AI needed. */
  Maker.localOps = function (body, text) {
    var t = text.toLowerCase(), ops = [], pct = /(\d+(?:\.\d+)?)\s*%/.exec(t), mm = /(\d+(?:\.\d+)?)\s*mm/.exec(t), f = pct ? +pct[1] / 100 : 0.2, say = [];
    var each = function (fn) { body.solids.forEach(function (s) { var o = fn(s); if (o) { o.op = "set"; o.id = s.id; ops.push(o); } }); };
    if (/\b(bigger|larger|scale up|enlarge)\b/.test(t)) { each(function (s) { var k = 1 + f; return { x: s.x * k, y: s.y * k, z: s.z * k, sx: s.sx * k, sy: s.sy * k, sz: s.sz * k }; }); say.push("everything " + Math.round(f * 100) + "% bigger"); }
    else if (/\b(smaller|scale down|shrink)\b/.test(t)) { each(function (s) { var k = 1 - Math.min(f, 0.8); return { x: s.x * k, y: s.y * k, z: s.z * k, sx: s.sx * k, sy: s.sy * k, sz: s.sz * k }; }); say.push("everything " + Math.round(Math.min(f, 0.8) * 100) + "% smaller"); }
    else if (/\b(taller|higher)\b/.test(t)) { var kz = mm ? null : 1 + f; each(function (s) { var k = kz || 1 + (+mm[1]) / Math.max(10, tall(body)); return { z: s.z * k, sz: s.sz * k }; }); say.push("stretched upwards"); }
    else if (/\b(wider|broader)\b/.test(t)) { each(function (s) { return { y: s.y * (1 + f), sy: s.sy * (1 + f) }; }); say.push("stretched across"); }
    else if (/\b(longer)\b/.test(t)) { each(function (s) { return { x: s.x * (1 + f), sx: s.sx * (1 + f) }; }); say.push("stretched along its length"); }
    else if (/\b(shorter|lower)\b/.test(t)) { each(function (s) { return { z: s.z * (1 - f), sz: s.sz * (1 - f) }; }); say.push("made lower"); }
    var col = Object.keys(COLORS).filter(function (c) { return new RegExp("\\b" + c + "\\b").test(t); })[0];
    if (col) { each(function (s) { return s.op === "cut" ? null : { color: COLORS[col] }; }); say.push("painted " + col); }
    if (/\b(remove|delete)\b/.test(t)) body.solids.forEach(function (s) { if (s.name && t.indexOf(s.name.toLowerCase()) >= 0) { ops.push({ op: "remove", id: s.id }); say.push("removed " + s.name); } });
    return { ops: ops, reply: say.length ? "Done: " + say.join("; ") + "." : "" };
  };
  function tall(body) { var hi = 0; body.solids.forEach(function (s) { hi = Math.max(hi, s.z + s.sz / 2); }); return hi; }

  Maker.prototype.change = function (text) {
    var self = this, app = this.app, body = this.view.body();
    this.say("me", esc(text));
    if (!body || !body.solids.length) { this.say("bot", "<p>There is nothing to change yet. Make something first.</p>"); return; }
    var local = function (why) {
      var r = Maker.localOps(body, text), n = r.ops.length ? self.applyOps(r.ops) : 0;
      self.say("bot", (why ? "<p><em>" + esc(why) + "</em></p>" : "") + (n ? "<p>" + esc(r.reply) + "</p>" : "<p>I did not understand that without the AI. Try: bigger, smaller, taller, wider, longer, a colour, or “remove” and a shape's name.</p>"));
    };
    if (!app.cfg.aiEnabled) { local(""); return; }
    var w = this.wait(), need = Body.need ? Body.need(app.doc) : null;
    this.ask({ kind: "bodyedit", question: text, mode: "pro", circuit: { parts: [], nets: [] }, code: "", body: digestBody(body), size: need && body.bay ? "the electronics inside need " + Math.round(need.w) + " x " + Math.round(need.d) + " x " + Math.round(need.h) + " mm" : undefined })
      .then(function (j) {
        w.remove();
        var n = self.applyOps(j.bodyops);
        self.say("bot", L.md(j.reply || "") + '<p class="mk-fine">' + (n ? n + " change" + (n > 1 ? "s" : "") + " made. Ctrl+Z undoes them all." : "Nothing was changed.") + "</p>");
        if (n && body.bay) { var bad = Body.fit(app.doc, self.view.body()); if (bad.length) self.say("bot", '<p class="warn">The electronics no longer fit: ' + esc(bad.map(function (m) { return m.name; }).join(", ")) + ". Undo, or ask for it bigger.</p>"); }
      }, function (e) { w.remove(); local((e && e.friendly) || "The AI didn't answer."); });
  };

  /* ---------------------------------------------------------- printing it */

  Maker.prototype.pieces = function () {
    var app = this.app, body = this.view.body(), out;
    if (!body) return null;
    try { out = Body.build(app.doc, body); } catch (e) { if (root.console) console.error(e); return null; }
    return out;
  };

  Maker.prototype.check = function () {
    var self = this, app = this.app, pcs = this.pieces(), printer = this.foot.querySelector('[data-p="printer"]').value, mat = this.foot.querySelector('[data-p="mat"]').value;
    if (!pcs || !pcs.length) { this.say("bot", '<p class="bad">' + (pcs ? "There is nothing to print yet." : "Those shapes could not be worked out. Nudge the overlapping ones apart a little.") + "</p>"); return; }
    var rows = pcs.map(function (p) {
      var a = S.analyse(p.tris, printer, mat), alt = a.needsSupport ? S.orient(p.tris) : null, better = alt && alt.overhang < a.overhang * 0.6 ? alt.label : null;
      return { name: p.name, qty: p.qty || 1, a: a, better: better, way: "as laid out" };
    });
    var html = "<table>" + rows.map(function (r) {
      return "<tr><td><b>" + esc(r.name) + (r.qty > 1 ? " × " + r.qty : "") + "</b></td><td>" + r.a.size.map(function (v) { return v.toFixed(0); }).join("×") + " mm</td><td>" + Math.max(1, Math.round(r.a.grams * r.qty)) + " g</td><td>" + (r.a.hours * r.qty < 1 ? Math.round(r.a.hours * r.qty * 60) + " min" : (r.a.hours * r.qty).toFixed(1) + " h") + "</td></tr>" +
        '<tr><td colspan="4">' + r.a.notes.map(function (n) { return '<span class="' + n[0] + '">' + (n[0] === "ok" ? "✓ " : n[0] === "bad" ? "✕ " : "• ") + esc(n[1]) + "</span>"; }).join("<br>") + (r.better ? '<br><span class="warn">• It would need far less support printed ' + esc(r.better) + ": turn it in the slicer.</span>" : "") + "</td></tr>";
    }).join("") + "</table>";
    this.say("bot", html);
    var misfit = this.view.body().bay ? Body.fit(app.doc, this.view.body()) : [];
    if (misfit.length) this.say("bot", '<p class="warn">Before printing: ' + esc(misfit.map(function (m) { return m.name; }).join(", ")) + " will not fit inside. Press Resize to fit.</p>");
    var report = { material: mat, printer: S.PRINTERS[printer].name, use: "a classroom electronics project", pieces: rows.map(function (r) { return { name: r.name, qty: r.qty, size: r.a.size.map(Math.round), grams: Math.round(r.a.grams), hours: Math.round(r.a.hours * 10) / 10, overhangCm2: Math.round(r.a.overhang / 100), baseCm2: Math.round(r.a.base / 100), needsSupport: r.a.needsSupport, fitsBed: r.a.fits, betterWayUp: r.better || "" }; }) };
    var local = function (why) { self.say("bot", (why ? "<p><em>" + esc(why) + "</em></p>" : "") + L.md(S.advice(rows, mat, "indoor"))); };
    if (!app.cfg.aiEnabled) { local(""); return; }
    var w = this.wait();
    this.ask({ kind: "printcoach", question: "How should I print this?", mode: "pro", circuit: { parts: [], nets: [] }, code: "", report: report })
      .then(function (j) { w.remove(); self.say("bot", L.md(j.reply || "")); }, function (e) { w.remove(); local((e && e.friendly) || "The AI didn't answer."); });
  };

  Maker.prototype.exportAs = function (kind) {
    var app = this.app, pcs = this.pieces(), base = String(app.title || "model").replace(/[^A-Za-z0-9 _-]+/g, "_");
    if (!pcs || !pcs.length) { app.toast("There is nothing to export yet."); return; }
    if (kind === "stl") { this.view.exportDialog(); return; }
    var objs = pcs.map(function (p) { return { name: p.name, tris: p.tris, color: p.color, qty: p.qty }; });
    if (kind === "3mf") S.download(base + ".3mf", S.threeMF(objs, app.title), "model/3mf");
    else S.download(base + ".obj", S.obj(objs), "text/plain");
    app.toast("Downloaded " + base + "." + kind + " — " + pcs.length + " piece" + (pcs.length > 1 ? "s" : "") + ".");
  };
  L.Maker = Maker;

  /* ------------------------------------------- hanging it on the Body view */

  var buildView = BV.prototype.build;
  BV.prototype.build = function () {
    buildView.apply(this, arguments);
    var self = this, bar = this.host.querySelector(".st-bar");
    this.maker = new Maker(this);
    if (!bar) return;
    var sep = document.createElement("span"); sep.className = "st-sep"; sep.setAttribute("aria-hidden", "true");
    var mk = document.createElement("button"); mk.type = "button"; mk.className = "primary"; mk.textContent = "✨ Maker"; mk.title = "Describe a thing and get it in 3-D; change it in words; check it for printing";
    mk.addEventListener("click", function () { if (self.maker.el.hidden) self.maker.show(self.maker.tab); else self.maker.el.hidden = true; });
    var ck = document.createElement("button"); ck.type = "button"; ck.textContent = "Print check"; ck.title = "Plastic, time, overhangs, supports: measured from the real shapes";
    ck.addEventListener("click", function () { self.maker.show("print"); self.maker.check(); });
    bar.appendChild(sep); bar.appendChild(mk); bar.appendChild(ck);
  };

  /* An empty Body space offers the maker as well as the patterns. */
  var action = BV.prototype.action;
  BV.prototype.action = function (k) {
    if (k === "export" && !this.body() && this.maker) { this.maker.show("make"); return; }
    return action.apply(this, arguments);
  };

  /* More ways out of the export dialog. */
  var exportDialog = BV.prototype.exportDialog;
  BV.prototype.exportDialog = function () {
    exportDialog.apply(this, arguments);
    var all = document.querySelectorAll("dialog.st-export"), d = all[all.length - 1], self = this;
    if (!d || !d.open) return;
    var list = d.querySelector(".st-export-list"); if (!list) return;
    [["3mf", "All pieces as one 3MF", "One file, pieces set out on the bed in their colours. Bambu Studio, PrusaSlicer and Cura open it directly."], ["obj", "Wavefront OBJ", "For Blender, Tinkercad and other 3-D programs."]].forEach(function (q) {
      var b = document.createElement("button"); b.type = "button"; b.innerHTML = "<b>" + q[1] + "</b><span>" + q[2] + "</span>";
      b.addEventListener("click", function () { self.maker.exportAs(q[0]); });
      list.appendChild(b);
    });
    var c = document.createElement("button"); c.type = "button"; c.innerHTML = "<b>Check it for printing first</b><span>Supports, bed fit, plastic and time for each piece, with advice on settings.</span>";
    c.addEventListener("click", function () { d.close(); self.maker.show("print"); self.maker.check(); });
    list.appendChild(c);
  };
})(typeof window !== "undefined" ? window : globalThis);
