// Headless checks for the Circuit Lab engine: the circuit solver, the
// Arduino interpreter, every ready-made example run end to end, and the
// studio: solid geometry, the circuit-board router and the 3-D bodies.
// No browser and no npm install — plain Node 18+:
//
//     node tools/chalk_lab/run_all.js
//
const { execFileSync } = require("child_process");
const path = require("path");
let failed = 0;
for (const t of ["sim_test", "mcu_test", "ex_test", "copilot_test", "wireless_test", "workshop_test", "solid_test", "pcb_test", "body_test", "projects_test", "coach_test"]) {
  console.log("\n=== " + t + " ===");
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, t + ".js")], { encoding: "utf8" });
    process.stdout.write(out);
    if (/FAILED/.test(out)) failed++;
  } catch (e) { process.stdout.write(e.stdout || ""); failed++; }
}
console.log(failed ? `\n${failed} suite(s) failed` : "\nAll Circuit Lab engine checks passed.");
process.exit(failed ? 1 : 0);
