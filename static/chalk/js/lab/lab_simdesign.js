/* Chalk Circuit Lab — the simulation designer.
 *
 * Make any experiment you like out of the circuit on the bench: press
 * buttons at set times, turn a sensor's dial over a minute, change a
 * resistor halfway through, and watch what every pin does — then check it
 * did what it should. Scenarios are written in a few plain lines
 * (lab_behave.js), by hand, from a template, or by the AI.
 *
 *   Run         instantly, on a copy of the circuit, as fast as the
 *               computer goes — traces and ticks in a moment
 *   Play        live on the bench, in real time, so you can watch it
 *               (and hear it); the circuit is put back as it was after
 *
 * Results come back as scope traces (one lane per probe), pass/fail ticks
 * at the moments they were checked, and a CSV of every sample. Scenarios
 * are saved with the circuit.
 */
(function (root) {
  "use strict";

  var L = root.ChalkLab;
  if (!L || !L.Scenario) return;
  var S = L.Scenario, esc = L.esc;
  function r3(v) { return Math.round(v * 1000) / 1000; }
  var SD = L.SimDesigner = {};
  var COLS = ["#ffd36b", "#5ce1a6", "#7ac8ff", "#ff8a7a", "#c18cff", "#f5a3ff", "#9be15c", "#ffb35a"];

  /* Ready-made experiments, written for whatever is on the bench. */
  function templates(doc) {
    var ref = L.refdes ? L.refdes(doc) : {}, out = [{ id: "starter", name: "A starting point for this circuit", src: S.starter(doc) }];
    var parts = (doc.parts || []).filter(function (p) { return ref[p.id] && !/^(breadboard|perfboard|stripboard)/.test(p.type); });
    var btn = parts.filter(function (p) { var d = L.def(p); return d && d.press; })[0];
    var led = parts.filter(function (p) { return /^(led|k_led|rgb_led|bulb|k_bulb)$/.test(p.type); })[0];
    var sensor = parts.filter(function (p) { var d = L.def(p); return d && (d.spec || []).some(function (s) { return s.type === "range" && s.live && !/volts|ohms|farads|limit/.test(s.k); }); })[0];
    var supply = parts.filter(function (p) { return /^(psu|battery|battery_9v|battery_aa|coin_cell)$/.test(p.type); })[0];
    if (btn && led) out.push({ id: "button", name: "Press " + ref[btn.id] + " and watch " + ref[led.id], src: "title \"" + ref[btn.id] + " lights " + ref[led.id] + "\"\nrun 2s\nprobe S(" + ref[led.id] + ", b) \"" + ref[led.id] + " brightness\"\nat 0.3s expect S(" + ref[led.id] + ", b) < 0.1 \"dark before\"\nat 0.5s press " + ref[btn.id] + "\nat 1s expect S(" + ref[led.id] + ", b) > 0.2 \"lit while pressed\"\nat 1.2s release " + ref[btn.id] + "\nat 1.8s mark \"let go\"" });
    if (sensor) {
      var sp = L.def(sensor).spec.filter(function (s) { return s.type === "range" && s.live && !/volts|ohms|farads|limit/.test(s.k); })[0], r = ref[sensor.id];
      out.push({ id: "sweep", name: "Sweep " + r + "'s " + sp.label.toLowerCase(), src: "title \"Sweep " + r + "\"\nrun 4s\n# from the bottom of its range to the top, a step every 0.2 s\nevery 0.2s set " + r + "." + sp.k + " = " + sp.min + " + (" + sp.max + " - " + sp.min + ") * t / 4\nprobe S(" + r + ", " + sp.k + ") \"" + r + " " + sp.label.toLowerCase() + "\"" + (led ? "\nprobe S(" + ref[led.id] + ", b) \"" + ref[led.id] + "\"" : "") });
    }
    if (supply && led) out.push({ id: "brownout", name: "What if the battery runs down?", src: "title \"Brown-out\"\nrun 3s\nprobe S(" + ref[led.id] + ", b) \"" + ref[led.id] + "\"\n" + (supply.type === "psu" ? "every 0.1s set " + ref[supply.id] + ".volts = 9 - t * 3\nprobe V(" + ref[supply.id] + ".+, " + ref[supply.id] + ".-) \"supply\"" : "# a battery's voltage is fixed: swap it for a bench power supply to sweep it\nprobe V(" + ref[supply.id] + ".+, " + ref[supply.id] + ".-) \"supply\"") });
    out.push({ id: "blank", name: "An empty scenario", src: "title \"My experiment\"\nrun 2s\n# probe V(U1.OUT) \"output\"\n# at 0.5s press SW1\n# every 0.25s set RT1.temp = 20 + t * 10\n# at 1.5s expect V(D1.A) > 1.8 \"LED on\"\n# always V(U1.VCC) < 5.5 \"never over-volted\"" });
    return out;
  }

  SD.open = function (app) {
    var doc = app.doc, d = document.createElement("dialog");
    doc.sims = Array.isArray(doc.sims) ? doc.sims : [];
    d.className = "dlg sd";
    document.body.appendChild(d);
    var tpl = templates(doc), st = { cur: doc.sims.length ? 0 : -1, src: doc.sims.length ? doc.sims[0].src : tpl[0].src, res: null, live: null };
    d.innerHTML = '<form method="dialog" class="pm-wrap"><header class="pm-head"><h2>Simulations</h2>' +
      '<div class="pm-ask"><input type="text" class="sd-desc" maxlength="300" placeholder="Describe an experiment — “press the button three times and check the LED follows”…" aria-label="Describe the experiment"><button type="button" data-a="ai" class="accent">✦ Write it</button></div>' +
      '<button type="button" class="pm-x" data-a="close" aria-label="Close">×</button></header>' +
      '<div class="sd-body">' +
        '<section class="sd-left"><h3>Saved with this circuit</h3><ul class="sd-list"></ul><button type="button" data-a="new">＋ New</button><h3>Start from</h3><ul class="sd-tpl">' + tpl.map(function (t, i) { return '<li><button type="button" data-tpl="' + i + '">' + esc(t.name) + '</button></li>'; }).join("") + '</ul>' +
        '<details class="pm-help"><summary>The language</summary><pre>' + esc(HELP) + '</pre></details></section>' +
        '<section class="sd-mid"><label class="px-f wide"><span>Name</span><input type="text" class="sd-name" maxlength="60"></label><textarea class="pm-code sd-code" spellcheck="false" rows="16"></textarea><div class="sd-err"></div>' +
          '<div class="pm-btns"><button type="button" data-a="run" class="primary" title="On a copy of the circuit, as fast as it goes">▶ Run</button><button type="button" data-a="play" title="Live on the bench, in real time">◉ Play on the bench</button><button type="button" data-a="save">Save</button><button type="button" data-a="del" class="danger">Delete</button></div></section>' +
        '<section class="sd-right"><div class="sd-res"><p class="hint">Run it to see the traces and the checks here.</p></div></section>' +
      '</div></form>';
    d.addEventListener("close", function () { stopLive(st, app); d.remove(); });
    var $ = function (s) { return d.querySelector(s); };
    var code = $(".sd-code"), name = $(".sd-name");
    var load = function () { code.value = st.src; name.value = st.cur >= 0 ? doc.sims[st.cur].name : (/^title\s+"([^"]*)"/m.exec(st.src) || [0, "New experiment"])[1]; list(); lint(); };
    var list = function () {
      $(".sd-list").innerHTML = doc.sims.length ? doc.sims.map(function (s, i) { return '<li><button type="button" data-sim="' + i + '"' + (i === st.cur ? ' aria-current="true"' : "") + '>' + esc(s.name) + '</button></li>'; }).join("") : '<li class="hint">None yet.</li>';
      d.querySelectorAll("[data-sim]").forEach(function (b) { b.addEventListener("click", function () { st.cur = +b.getAttribute("data-sim"); st.src = doc.sims[st.cur].src; load(); }); });
    };
    var lint = function () {
      var p = S.parse(code.value), R = S.resolver(doc), errs = p.errors.slice();
      if (!errs.length) { var r = S.prepare(JSON.parse(JSON.stringify(doc)), p, { sim: new L.Sim(), press: function () {}, set: function () {}, toggle: function () {} }); if (!r.ok) errs = r.errors; }
      $(".sd-err").innerHTML = errs.length ? '<ul class="bad">' + errs.slice(0, 8).map(function (e) { return '<li>' + (e.line ? "Line " + e.line + ": " : "") + esc(e.msg) + '</li>'; }).join("") + '</ul>' : '<p class="good">✓ Ready: ' + p.probes.length + ' probe' + (p.probes.length === 1 ? "" : "s") + ', ' + p.steps.length + ' step' + (p.steps.length === 1 ? "" : "s") + ', ' + p.checks.length + ' standing check' + (p.checks.length === 1 ? "" : "s") + ', ' + p.duration + ' s.</p>';
      return !errs.length;
    };
    var t0;
    code.addEventListener("input", function () { st.src = code.value; clearTimeout(t0); t0 = setTimeout(lint, 350); });
    d.querySelectorAll("[data-tpl]").forEach(function (b) { b.addEventListener("click", function () { st.src = tpl[+b.getAttribute("data-tpl")].src; st.cur = -1; load(); }); });
    $('[data-a="close"]').addEventListener("click", function () { d.close(); });
    $('[data-a="new"]').addEventListener("click", function () { st.cur = -1; st.src = tpl[tpl.length - 1].src; load(); });
    $('[data-a="save"]').addEventListener("click", function () {
      var nm = (name.value || "Experiment").slice(0, 60), entry = { name: nm, src: code.value.slice(0, 8000) };
      app.history.push(doc);
      if (st.cur >= 0) doc.sims[st.cur] = entry; else { doc.sims.push(entry); st.cur = doc.sims.length - 1; }
      doc.sims = doc.sims.slice(-30);
      app.changed(); list(); app.toast("Saved with the circuit.");
    });
    $('[data-a="del"]').addEventListener("click", function () { if (st.cur < 0) return; doc.sims.splice(st.cur, 1); st.cur = -1; app.changed(); load(); });
    $('[data-a="run"]').addEventListener("click", function () {
      if (!lint()) return;
      var t = Date.now(), r = S.run(doc, code.value);
      if (!r.ok) { lint(); return; }
      r.ms = Date.now() - t;
      st.res = r; show($(".sd-res"), r, app);
    });
    $('[data-a="play"]').addEventListener("click", function () { if (!lint()) return; play(st, app, code.value, $(".sd-res"), d); });
    $('[data-a="ai"]').addEventListener("click", function () { var q = $(".sd-desc").value.trim(); if (q) write(app, q, function (src, note) { st.src = src; st.cur = -1; load(); $(".sd-err").insertAdjacentHTML("afterbegin", note ? '<p class="hint">' + esc(note) + '</p>' : ""); }); });
    load();
    d.showModal();
  };

  var HELP = "title \"name\"            run 3s\nprobe EXPR [\"label\"]       a trace to record\nat 0.5s press SW1 · release SW1 · click SW1 · toggle SW2\nat 1s set R2.ohms = 4.7k     (any setting the inspector shows)\nevery 0.2s set RT1.temp = 20 + t * 10\nat 2s expect EXPR [\"what it means\"]\nalways EXPR [\"…\"]             checked the whole time\nat 1s mark \"a note on the trace\"\n\nV(U1.OUT)  V(D1.A, D1.K)   volts at a pin, or across two\nI(R1.1)                    amps into a pin\nS(D1, b)  S(M1, w)  S(U1, show)   what a part is doing\nRefs are the item list's (R1, U2, SW1) or the names you gave parts.";

  /* ---------------------------------------------------------- results */

  function show(box, r, app) {
    var pass = r.results.filter(function (x) { return x.pass; }).length, fail = r.results.length - pass;
    var h = '<h3>' + esc(r.scenario.title || "Results") + '</h3><p class="px-sub">' + r3(r.cut || r.scenario.duration) + ' s simulated' + (r.ms != null ? ' in ' + r.ms + ' ms' : " live") + (r.cut ? ' — <b class="warn">stopped early (it was taking too long)</b>' : "") + (r.mcu ? ' · <span class="warn">programs don\'t run in an instant run — use Play for circuits with a board</span>' : "") + '</p>';
    if (r.results.length) h += '<p class="sd-score ' + (fail ? "bad" : "good") + '">' + (fail ? "✗ " + fail + " of " + r.results.length + " checks failed" : "✓ All " + r.results.length + " checks passed") + '</p><ul class="sd-checks">' + r.results.map(function (x) { return '<li class="' + (x.pass ? "good" : "bad") + '">' + (x.pass ? "✓" : "✗") + ' ' + esc(x.msg) + ' <i>' + (x.always ? (x.pass ? "the whole time" : "failed " + x.fails + " of " + x.of + " samples, first at " + r3(x.t || 0) + " s") : "at " + r3(x.t) + " s") + '</i></li>'; }).join("") + '</ul>';
    if (r.probes.length) h += chart(r) + '<table class="px-pins sd-stats"><tr><th>Probe</th><th>Min</th><th>Max</th><th>At the end</th></tr>' + r.probes.map(function (p, i) { return '<tr><td><span class="sd-key" style="background:' + COLS[i % COLS.length] + '"></span>' + esc(p.label) + '</td><td>' + fmt(p.min) + '</td><td>' + fmt(p.max) + '</td><td>' + fmt(p.end) + '</td></tr>'; }).join("") + '</table>';
    if (r.warnings && r.warnings.length) h += '<h4>The simulator noticed</h4><ul class="px-issues">' + r.warnings.slice(0, 8).map(function (w) { return '<li class="lv-' + w.level + '">' + esc(w.msg) + '</li>'; }).join("") + '</ul>';
    h += '<div class="pm-btns"><button type="button" data-a="csv">Download the samples (.csv)</button></div>';
    box.innerHTML = h;
    var b = box.querySelector('[data-a="csv"]');
    b.addEventListener("click", function () {
      var rows = [["t"].concat(r.probes.map(function (p) { return p.label; }))], n = r.probes.length ? r.probes[0].pts.length : 0;
      for (var i = 0; i < n; i++) rows.push([r3(r.probes[0].pts[i][0])].concat(r.probes.map(function (p) { return p.pts[i] ? r3(p.pts[i][1]) : ""; })));
      L.Solid.download((r.scenario.title || "simulation") + ".csv", rows.map(function (x) { return x.join(","); }).join("\r\n") + "\r\n", "text/csv");
    });
  }
  function fmt(v) { if (!isFinite(v)) return "—"; var a = Math.abs(v); return a !== 0 && (a < 0.01 || a >= 10000) ? L.si(v, "") : String(r3(v)); }
  /* One lane per probe, like a logic analyser; checks as dots, marks as lines. */
  function chart(r) {
    var W = 640, lane = 64, gap = 12, left = 8, right = 8, top = 14, T = r.scenario.duration, n = r.probes.length, H = top + n * (lane + gap) + 22;
    var X = function (t) { return left + (W - left - right) * t / T; }, s = '<svg class="sd-chart" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Traces">';
    for (var k = 0; k <= 10; k++) { var tx = X(T * k / 10); s += '<line x1="' + r3(tx) + '" y1="' + top + '" x2="' + r3(tx) + '" y2="' + (H - 18) + '" stroke="rgba(255,255,255,.07)"/><text x="' + r3(tx) + '" y="' + (H - 5) + '" font-size="9" fill="#8fa0b0" text-anchor="middle">' + r3(T * k / 10) + 's</text>'; }
    r.probes.forEach(function (p, i) {
      var y0 = top + i * (lane + gap), lo = p.min, hi = p.max, span = hi - lo || Math.max(1, Math.abs(hi)) * 0.1, col = COLS[i % COLS.length];
      var Y = function (v) { return y0 + lane - 4 - (lane - 8) * (v - lo) / span; };
      s += '<rect x="' + left + '" y="' + y0 + '" width="' + (W - left - right) + '" height="' + lane + '" fill="rgba(255,255,255,.03)" rx="4"/>';
      s += '<path d="' + p.pts.map(function (q, j) { return (j ? "L" : "M") + r3(X(q[0])) + " " + r3(Y(q[1])); }).join("") + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linejoin="round"/>';
      s += '<text x="' + (left + 6) + '" y="' + (y0 + 12) + '" font-size="10" fill="' + col + '" font-weight="700">' + esc(p.label) + '</text><text x="' + (W - right - 6) + '" y="' + (y0 + 12) + '" font-size="9" fill="#8fa0b0" text-anchor="end">' + fmt(hi) + '</text><text x="' + (W - right - 6) + '" y="' + (y0 + lane - 4) + '" font-size="9" fill="#8fa0b0" text-anchor="end">' + fmt(lo) + '</text>';
    });
    (r.marks || []).forEach(function (m) { s += '<line x1="' + r3(X(m.t)) + '" y1="' + top + '" x2="' + r3(X(m.t)) + '" y2="' + (H - 18) + '" stroke="#c18cff" stroke-dasharray="3 3"/><text x="' + r3(X(m.t) + 3) + '" y="' + (top + 8) + '" font-size="9" fill="#c18cff">' + esc(m.msg) + '</text>'; });
    r.results.forEach(function (x) { if (x.always || x.t == null) return; s += '<circle cx="' + r3(X(x.t)) + '" cy="' + (H - 18) + '" r="4" fill="' + (x.pass ? "#5ce1a6" : "#ff5d5d") + '"><title>' + esc(x.msg) + '</title></circle>'; });
    return s + '</svg>';
  }

  /* ------------------------------------------------------------ live */

  function play(st, app, src, box, dlg) {
    stopLive(st, app);
    var doc = app.doc, sim = app.sim, keep = JSON.stringify(doc.parts.map(function (p) { return p.props || {}; }));
    var host = {
      doc: doc, sim: sim,
      press: function (p, down) { if (down) app.press(p); else app.release(p); },
      set: function (p, k, v) { p.props = p.props || {}; p.props[k] = v; app.bench.renderPart(p); var sp = (L.def(p).spec || []).filter(function (x) { return x.k === k; })[0]; if (sp && sp.rebuild) { sim.invalidate(); app.bench.indexPins(); } },
      toggle: function (p) { var d = L.def(p); p.props = p.props || {}; p.props[d.toggle] = !L.propsOf(p)[d.toggle]; app.bench.renderPart(p); }
    };
    var r = S.prepare(doc, src, host);
    if (!r.ok) return;
    if (app.studio && app.studio.space !== "bench") app.studio.setSpace("bench");
    if (!app.running) app.power(true);
    dlg.classList.add("sd-live");
    var start = sim.t, last = 0;
    st.live = { r: r, keep: keep, raf: 0 };
    box.innerHTML = '<h3>Playing…</h3><div class="sd-bar"><i></i></div><p class="hint">The dialog steps aside so you can watch the bench. It comes back when the run ends.</p>';
    var bar = box.querySelector(".sd-bar i");
    var tick = function () {
      if (!st.live) return;
      var t = sim.t - start;
      r.tick(sim.t);
      if (bar) bar.style.width = Math.min(100, t / r.scenario.duration * 100) + "%";
      if (r.done) { finishLive(st, app, box, dlg); return; }
      st.live.raf = requestAnimationFrame(tick);
    };
    r.tick(sim.t);
    st.live.raf = requestAnimationFrame(tick);
  }
  function finishLive(st, app, box, dlg) {
    var r = st.live.r;
    restore(st, app);
    st.live = null;
    dlg.classList.remove("sd-live");
    r.warnings = (app.sim.warnings || []).slice(0, 12);
    show(box, r, app);
  }
  function stopLive(st, app) {
    if (!st.live) return;
    cancelAnimationFrame(st.live.raf);
    if (!st.live.r.done) st.live.r.finish();
    restore(st, app);
    st.live = null;
  }
  /* the circuit goes back to how it was before the experiment */
  function restore(st, app) {
    var props = JSON.parse(st.live.keep);
    app.doc.parts.forEach(function (p, i) { if (props[i]) { p.props = props[i]; app.bench.renderPart(p); } });
    Object.keys(app.sim.pressed).forEach(function (k) { delete app.sim.pressed[k]; });
    app.sim.invalidate();
  }

  /* ------------------------------------------------------------- AI */

  function write(app, q, cb) {
    var cfg = app.cfg || {}, doc = app.doc;
    var local = function (note) {
      /* the built-in writer: a starter plus whatever the words name */
      var src = S.starter(doc), ref = L.refdes(doc), lines = [];
      var t = q.toLowerCase(), times = /(\d+)\s*(?:times|x)\b/.exec(t), n = times ? Math.min(10, +times[1]) : 1;
      (doc.parts || []).forEach(function (p) {
        var r = ref[p.id], d = L.def(p);
        if (!r || !d) return;
        if (d.press && (t.indexOf(r.toLowerCase()) >= 0 || /press|button|push/.test(t))) for (var i = 0; i < n; i++) lines.push("at " + r3(0.4 + i * 0.6) + "s press " + r, "at " + r3(0.7 + i * 0.6) + "s release " + r);
      });
      if (lines.length) src = src.replace(/\nat [\s\S]*$/, "") + "\n" + lines.join("\n");
      cb(src, (note || "") + "Written by the built-in helper — change the times and checks to fit.");
    };
    if (!cfg.aiEnabled || !cfg.aiUrl) { local(""); return; }
    fetch(cfg.aiUrl, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-CSRFToken": cfg.csrf },
      body: JSON.stringify({ kind: "scenario", question: q, mode: doc.mode, circuit: app.digest(), code: (doc.code || "").slice(0, 4000), refs: L.refdes(doc) }) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (!j || j.ok === false || !j.scenario) throw j; cb(String(j.scenario).slice(0, 8000), j.reply ? String(j.reply).slice(0, 400) : ""); })
      .catch(function () { local("The AI didn't answer. "); });
  }
})(typeof window !== "undefined" ? window : globalThis);
