# Chalk update: bc and calc on the Pi, friendlier apt

Unzip over the repository root; every file sits at its real path.
Then run `python manage.py collectstatic` (no migrations, no new dependencies).

## What changes on the Pi
- `sudo apt install bc` and `sudo apt install calc` now work (calc installs the
  `apcalc` package, as on real Debian; `apt install apcalc` works too).
- `sudo apt install update` (and upgrade, autoremove, …) still fails like real apt,
  then says: type `sudo apt update` without install.
- `bc`: GNU bc 1.07.1. Integer division until `scale=N`; `bc -l` gives 20 places
  plus s() c() a() l() e(); ibase/obase, last, if/while/for, define/auto/return,
  print, quit. Errors read like GNU bc's ("Runtime error … Divide by zero").
- `calc`: apcalc 2.14. Exact fractions (`1/3*3` is 1), answers that don't end
  within 20 decimals print rounded with `~`, results are tab-indented.
  sqrt, sin/cos/tan, asin/acos/atan, exp/ln/log/log2, root, pi(), fact, gcd, lcm,
  isprime, round, floor/ceil, max/min, `define f(x) = …;`. `help` lists them.
- Both work three ways: piped (`echo 22/7 | bc -l`), as a one-off (`calc 'sqrt(2)'`)
  or at their own prompt until quit/exit or Ctrl+D. Ctrl+C stops a runaway loop
  and keeps the calculator open, as the real ones do.
- Installed calculators are saved on the SD card with the circuit, like cowsay.

## New file
- static/chalk/js/lab/lab_pi_calc.js    the bc/calc engine: BigInt decimals and fractions,
                                        lexer, parser, interpreter (no eval)

## Changed files
- static/chalk/js/lab/lab_pi_cmds.js    bc and apcalc on the mirror, the bc and calc commands,
                                        apt aliases (calc → apcalc) and the "apt install update" hint
- templates/chalk/lab.html              loads lab_pi_calc.js before lab_pi_cmds.js
- tools/chalk_lab/h.js                  test harness loads lab_pi_calc.js
- tools/chalk_lab/pi_test.js            20 new checks (node tools/chalk_lab/run_all.js)
