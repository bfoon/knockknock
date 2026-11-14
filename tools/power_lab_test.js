/* Chalk Power Lab — engine tests. Run from the repository root:
 *
 *     node tools/power_lab_test.js
 *
 * No browser and no packages: the solver, the sun, the sizing, the design
 * checks and the 3-D print tools are plain functions.
 */
"use strict";
const path = require("path"), assert = require("assert");
const js = path.join(__dirname, "..", "static", "chalk", "js");
["lab/lab_core.js", "lab/lab_solid.js", "lab/lab_print.js", "power/power_core.js", "power/power_parts.js", "power/power_sun.js", "power/power_sim.js",
 "power/power_size.js", "power/power_check.js", "power/power_print.js"].forEach(f => require(path.join(js, f)));
const W = globalThis.ChalkPower, S = globalThis.ChalkLab.Solid;
let passed = 0;
const test = (name, fn) => { try { fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("FAIL  " + name + "\n      " + e.message); process.exitCode = 1; } };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, (what || "value") + " " + a + " is not within " + tol + " of " + b);
const plan = () => new W.Design.Plan();

test("a tracked array sits on the best point of its own curve", () => {
  const P = plan(), a = P.add("pv", 0, 0), b = P.add("pv", 100, 0), cc = P.add("mppt", 0, 200, { amps: 40, maxpv: 150 }), bat = P.add("battery", 0, 400, { volts: 24, ah: 200, soc: 50 });
  P.wire(a + ":-", b + ":+", 4, 1); P.wire(a + ":+", cc + ":PV+", 4, 5); P.wire(b + ":-", cc + ":PV-", 4, 5); P.wire(cc + ":B+", bat + ":+", 16, 1); P.wire(cc + ":B-", bat + ":-", 16, 1);
  const s = new W.Sim(P.doc); s.env = { G: 1000, tamb: 25 }; s.settle(120);
  const curve = s.trace(a + ":+", b + ":-", 60), best = Math.max(...curve.map(q => q.v * q.i));
  near(s.state[cc].pin, best, best * 0.03, "tracked power");
  assert.ok(s.state[bat].i < -15, "the battery is charging");
  near(curve[0].i, 9.3, 0.4, "Isc"); near(curve[curve.length - 1].v, 84, 4, "Voc");
});

test("one shaded panel in a string is bypassed, not allowed to choke it", () => {
  const P = plan(), ids = [0, 1, 2].map(i => P.add("pv", i * 100, 0, i === 1 ? { shade: 80 } : {})), cc = P.add("mppt", 0, 200, { amps: 60, maxpv: 150 }), bat = P.add("battery", 0, 400, { volts: 24, ah: 200, soc: 40 });
  P.wire(ids[0] + ":-", ids[1] + ":+", 4, 1); P.wire(ids[1] + ":-", ids[2] + ":+", 4, 1); P.wire(ids[0] + ":+", cc + ":PV+", 4, 5); P.wire(ids[2] + ":-", cc + ":PV-", 4, 5);
  P.wire(cc + ":B+", bat + ":+", 16, 1); P.wire(cc + ":B-", bat + ":-", 16, 1);
  const s = new W.Sim(P.doc); s.env = { G: 1000, tamb: 25 }; s.settle(200);
  const curve = s.trace(ids[0] + ":+", ids[2] + ":-", 80), best = Math.max(...curve.map(q => q.v * q.i));
  assert.ok(best > 480 && best < 640, "two good panels' worth survives: " + best.toFixed(0));
});

test("too many panels in series destroys the controller", () => {
  const P = plan(), ids = [0, 1, 2, 3].map(i => P.add("pv", i * 100, 0, { model: "p450" })), cc = P.add("mppt", 0, 200, { amps: 40, maxpv: 100 }), bat = P.add("battery", 0, 400, { volts: 12, ah: 100 });
  for (let i = 0; i < 3; i++) P.wire(ids[i] + ":-", ids[i + 1] + ":+", 4, 1);
  P.wire(ids[0] + ":+", cc + ":PV+", 4, 5); P.wire(ids[3] + ":-", cc + ":PV-", 4, 5); P.wire(cc + ":B+", bat + ":+", 16, 1); P.wire(cc + ":B-", bat + ":-", 16, 1);
  const s = new W.Sim(P.doc); s.env = { G: 900, tamb: 30 }; s.settle(30);
  assert.strictEqual(s.state[cc].mode, "dead");
  assert.ok(W.Check.run(P.doc, s, true).some(f => /cold bright morning/.test(f.msg)));
});

function house() {
  const P = plan(), g = P.add("grid1", 0, 0), r = P.add("rcd", 100, 0), q = P.add("mcb", 200, 0, { amps: 16, curve: "B" }), k = P.add("socket", 300, 0, { app: "kettle" }), e = P.add("earth", 400, 0, { ohms: 8 });
  P.wire(g + ":L", r + ":Lin", 6, 5); P.wire(g + ":N", r + ":Nin", 6, 5); P.wire(r + ":Lout", q + ":in", 2.5, 1); P.wire(q + ":out", k + ":L", 2.5, 15); P.wire(r + ":Nout", k + ":N", 2.5, 15); P.wire(k + ":PE", e + ":PE", 2.5, 10);
  return { P, g, r, q, k, e, part: id => W.partById(P.doc, id) };
}
test("a kettle draws what Ohm says, and the cable drops a few volts", () => {
  const h = house(), s = new W.Sim(h.P.doc); s.settle(20);
  near(s.state[h.k].p, 1900, 120, "kettle watts"); near(s.state[h.q].imax, 8.5, 0.4, "breaker amps");
  assert.ok(s.state[h.k].v < 229 && s.state[h.k].v > 218);
});
test("a live wire on a metal case trips the RCD", () => {
  const h = house(); h.part(h.k).props.fault = "leak"; const s = new W.Sim(h.P.doc); s.settle(10);
  assert.strictEqual(s.state[h.r].trip, "leak");
});
test("with no earth wire the case sits at mains voltage and nothing trips", () => {
  const h = house(); h.part(h.k).props.fault = "leak"; h.P.doc.wires.pop(); const s = new W.Sim(h.P.doc); s.settle(10);
  assert.ok(!s.state[h.r].trip); assert.ok(s.state[h.k].touch > 200, "touch voltage " + s.state[h.k].touch);
});
test("a short circuit trips the breaker at once; without one the cable burns", () => {
  let h = house(); h.part(h.k).props.fault = "short"; let s = new W.Sim(h.P.doc); s.settle(5);
  assert.strictEqual(s.state[h.q].trip, "short");
  h = house(); h.part(h.k).props.fault = "short"; h.part(h.q).props.amps = 125; h.part(h.q).props.curve = "D"; s = new W.Sim(h.P.doc);
  for (let i = 0; i < 400; i++) s.step(0.1);
  assert.ok(Object.values(s.wstate).some(w => w.burnt), "a 2.5 mm² cable carrying a short burns");
});
test("dead-circuit tests: continuity, and megohms to earth", () => {
  const h = house(), s = new W.Sim(h.P.doc); s.index();
  assert.ok(s.deadR(h.q + ":in", h.k + ":L") < 1, "continuity through the breaker");
  assert.ok(s.deadR(h.k + ":L", h.k + ":PE") < 100, "with the kettle still plugged in, live reaches earth through it and the neutral");
  h.part(h.k).props.on = false;
  assert.ok(s.deadR(h.k + ":L", h.k + ":PE") > 1e6, "healthy insulation");
  h.part(h.k).props.fault = "leak";
  assert.ok(s.deadR(h.k + ":L", h.k + ":PE") < 1e4, "broken insulation shows");
  near(s.deadR(h.e + ":PE", "earth"), 8, 0.1, "rod");
});
test("three balanced phases put nothing in the neutral; unbalanced ones do", () => {
  const P = plan(), g = P.add("grid3", 0, 0), L = ["L1", "L2", "L3"].map((ph, i) => { const l = P.add("load", i * 100, 200, { app: "heater" }); P.wire(g + ":" + ph, l + ":L", 4, 5); P.wire(g + ":N", l + ":N", 4, 5); return l; });
  const s = new W.Sim(P.doc); s.settle(10);
  assert.ok(s.state[g].inn < 0.05, "balanced neutral " + s.state[g].inn);
  W.partById(P.doc, L[2]).props.on = false; s.settle(10);
  assert.ok(s.state[g].inn > 5, "unbalanced neutral " + s.state[g].inn);
});
test("grid and inverter joined together is caught as back-feed", () => {
  const P = plan(), g = P.add("grid1", 0, 0), b = P.add("battery", 0, 200, { volts: 12, ah: 200 }), inv = P.add("inverter", 200, 200, { va: 1000, vdc: 12 });
  P.wire(b + ":+", inv + ":DC+", 35, 1); P.wire(b + ":-", inv + ":DC-", 35, 1); P.wire(g + ":L", inv + ":L", 2.5, 5); P.wire(g + ":N", inv + ":N", 2.5, 5);
  const s = new W.Sim(P.doc); s.settle(10);
  assert.strictEqual(s.state[inv].err, "backfeed");
});
test("the sun: noon beats morning, a clear March beats a wet August, night is dark", () => {
  const site = { name: "Banjul", lat: 13.45, tilt: 15, az: 180, month: 3, cloud: -1 };
  assert.ok(W.Sun.at(site, 12).G > 850 && W.Sun.at(site, 8).G < W.Sun.at(site, 12).G && W.Sun.at(site, 23).G === 0);
  assert.ok(W.Sun.psh(site, 3) > 6 && W.Sun.psh(site, 8) < 4.5);
  assert.strictEqual(W.Sun.worstMonth(site).month, 8);
  assert.ok(W.Sun.psh({ name: "x", lat: 13.45, tilt: 15, az: 0, month: 12, cloud: 0 }) < W.Sun.psh({ name: "x", lat: 13.45, tilt: 15, az: 180, month: 12, cloud: 0 }), "facing north loses in December");
});

for (const key of Object.keys(W.Design.PRESETS)) test("designed, built and run for a day: " + W.Design.PRESETS[key].name, () => {
  const spec = W.Design.fromPreset(key); spec.site = { name: "Banjul", lat: 13.45 };
  const d = W.Design.size(spec), doc = W.Design.build(d), s = new W.Sim(doc), e = W.Sun.at(doc.site, 12);
  s.env = { G: e.G, tamb: e.tamb }; s.settle(80);
  const bad = W.Check.run(doc, s, true).filter(f => f.level !== "info");
  assert.deepStrictEqual(bad.map(f => f.msg), [], "the checker finds nothing wrong with its own design");
  const loads = doc.parts.filter(p => /^(lamp|socket|load|dcload)$/.test(p.type));
  assert.strictEqual(loads.filter(p => s.state[p.id].run).length, loads.length, "every load runs at noon");
  s.reset(); s.fast = true; s.routine = true;
  for (let h = 0; h < 24; h += 0.1) { const hr = (h + 6) % 24, q = W.Sun.at(doc.site, hr); s.env = { G: q.G, tamb: q.tamb }; s.hour = hr; s.stride(360); }
  assert.ok(s.tot.unmet < 0.6, "nothing goes without power: " + s.tot.unmet.toFixed(1) + " appliance-hours");
  near(s.tot.load, d.eDay, d.eDay * 0.2, "energy used against energy designed for");
  assert.strictEqual(s.events.filter(ev => ev.level === "danger").length, 0);
});

test("words become a spec", () => {
  const s = W.Design.parse("a clinic in Basse with a vaccine fridge, 8 lights, 2 fans and a laptop, lithium, 2 days");
  assert.deepStrictEqual(s.loads.map(l => l.app + "x" + l.qty), ["lampx8", "vaccinex1", "fanx2", "laptopx1"]);
  assert.strictEqual(s.site.name, "Basse"); assert.strictEqual(s.chem, "lfp"); assert.strictEqual(s.autonomy, 2);
  assert.strictEqual(W.Design.parse("solar for my shop, NAWEC cuts out every evening").type, "hybrid");
});
test("the bill of materials counts what is on the plan", () => {
  const doc = W.Design.build(W.Design.size(W.Design.fromPreset("home"))), bom = W.Check.bom(doc);
  assert.strictEqual(bom.rows.find(r => /Solar panel/.test(r.item)).qty, doc.parts.filter(p => p.type === "pv").length);
  assert.ok(bom.total > 50000 && bom.rows.some(r => /cable 2.5/.test(r.item)));
});
test("every printable part is watertight and fits a hobby printer", () => {
  for (const k of Object.keys(W.PrintShop.PARTS)) {
    const P = W.PrintShop.PARTS[k], v = {}; P.fields.forEach(f => v[f[0]] = f[3]);
    for (const p of W.PrintShop.make(P.build(v), "ender", "petg")) { assert.strictEqual(S.leaks(p.tris), 0, p.name + " leaks"); assert.ok(p.a.fits && p.a.grams > 0.5, p.name); }
  }
});
test("3MF is a well-formed package; a shape printed the wrong way up is noticed", () => {
  const table = S.sealed(S.lay(S.fromSolids([{ shape: "box", x: 0, y: 0, z: 40, sx: 80, sy: 80, sz: 6 }, { shape: "cyl", x: 0, y: 0, z: 20, sx: 12, sy: 12, sz: 40 }])));
  assert.ok(S.analyse(table).needsSupport, "a table standing on its leg needs support");
  assert.ok(!S.analyse(S.orient(table).tris).needsSupport, "upside down it does not");
  const z = S.threeMF([{ name: "T", tris: table, color: "#336699" }], "t"), text = Buffer.from(z).toString("latin1");
  assert.ok(text.includes("3D/3dmodel.model") && text.includes("<triangle v1=") && text.includes("#336699"));
});
console.log("\n" + passed + " passed" + (process.exitCode ? ", some FAILED" : ""));
