# Chalk update: water, more sensors and driver chips

Unzip over the repository root; every file sits at its real path.
Then run `python manage.py collectstatic` (no migrations, no new dependencies).

## New parts (28) — `static/chalk/js/lab/lab_parts3.js`
Each one is drawn and simulated in that file, from the simulator's own primitives,
so it behaves electrically: wrong wiring, missing diodes and overloads show up as
the same warnings the rest of the lab gives.

**Water** (new drawer tab)
- Water level sensor — S rises with depth (0 dry, ~700 at 4 cm on an Arduino)
- Rain sensor — plate + comparator module; DO goes LOW when wet
- Float switch — closes when the water lifts the float
- Water flow meter (YF-S201) — 7.5 pulses/s per L/min; count with `attachInterrupt()`
- Water pump (3–6 V) — ~200 mA, pumps visibly; warns if over-volted or reversed
- Solenoid valve (12 V) — an inductive coil: kicks back (kV) if there is no diode

**Sensors**
- Temperature & humidity (DHT11 / DHT22) · Joystick · Rotary encoder (KY-040, real Gray code)
- Touch pad (TTP223) · Heartbeat sensor (a real pulse waveform at the set BPM)
- Accelerometer (ADXL335, tilt and shake) · Current sensor (ACS712, measures the real current)
- Voltage sensor (0–25 V divider) · Force sensor (FSR) · Flex sensor · UV sensor
- Hall magnet, vibration (SW-420) and line-tracker (TCRT5000) modules

**Advanced** (new drawer tab), plus two in Power and one in Lights & sound
- Motor driver (L298N) — two H-bridges, PWM speed on ENA/ENB, its ~2 V drop and onboard 5 V regulator
- Stepper (28BYJ-48 + ULN2003) — turns only when the coil pattern really steps; 2048 steps a turn; warns when stepped too fast
- Shift register (74HC595) — sees every clock edge, even ones a program makes in microseconds
- ADC chip (MCP3008) — gives a Raspberry Pi eight analog inputs over SPI
- Optocoupler (PC817) — light carries the signal between two separate circuits
- Voltage regulators (7805 / LD1117 / 7812) — dropout, heat, thermal shutdown
- NeoPixel ring (8/12/16/24 LEDs) — colours, glow and real current draw
- Solar panel — a light-driven current source with the cells' diode across it (Voc ~6.9 V, Isc ~190 mA)

## Arduino (`lab_mcu.js`, `lab_runner.js`)
- `attachInterrupt(digitalPinToInterrupt(2|3), fn, RISING|FALLING|CHANGE|LOW)`, `detachInterrupt()`,
  `noInterrupts()` / `interrupts()` — interrupt functions run between lines, even inside `delay()`
- `shiftOut()` / `shiftIn()`, `isnan()` / `isinf()`
- `#include <DHT.h>`: `DHT dht(pin, DHT11)`, `begin`, `readTemperature([F])`, `readHumidity`, `computeHeatIndex`
- `#include <Adafruit_NeoPixel.h>`: `begin`, `show`, `clear`, `setPixelColor`, `fill`, `setBrightness`, `Color`, `ColorHSV`, `gamma32`, `numPixels`
- `#include <Stepper.h>`: `Stepper(steps, p1, p2, p3, p4)`, `setSpeed`, `step` (blocks for as long as the real one)

## Raspberry Pi (`lab_pi.js`, `lab_pi_py.js`)
- gpiozero: `MCP3008` (value, voltage, raw_value), `Motor` (forward/backward/stop/reverse, enable pin), `Robot`
- `import board` (board.D4, board.D18, SCK/MOSI/MISO/CE0…), `adafruit_dht` (DHT11/DHT22), `neopixel` (indexing, fill, brightness, auto_write)
- Pins switched from Python are seen by clocked chips too, so bit-banging a 74HC595 works

## Ready-made projects (`lab_examples.js`)
Water & sensors: Flood alarm · Self-watering plant · Weather station · Heartbeat monitor · Water meter (interrupts)
Advanced: Joystick robot car (L298N) · Stepper follows a knob · Rainbow ring (NeoPixels)
Raspberry Pi: Water alarm (MCP3008) · Temperature ring (DHT11 + NeoPixels)

## Other changed files
- `static/chalk/js/lab/lab_sim.js` — exports its primitives as `L.SimKit`; a solar panel counts as a power source
- `static/chalk/js/lab/lab_parts2.js` — exposes the DIP-chip drawing (`L.dipChip`)
- `static/chalk/js/lab/lab_app.js` — "Water" and "Advanced" drawer tabs
- `static/chalk/js/lab/lab_coach.js` — wiring tips for the new parts; `lab_body.js` — their heights for 3-D bodies
- `templates/chalk/lab.html` — loads `lab_parts3.js`
- `chalk/lab_ai.py` — the AI's part catalogue and rules know every new part and library
- `chalk/test_lab.py` — the catalogue check finds kit modules by pattern rather than a fixed list
- `tools/chalk_lab/parts3_test.js` (new), `h.js`, `run_all.js` — `node tools/chalk_lab/run_all.js`
