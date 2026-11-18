# Chalk Circuit Lab — Board studio, part designer and simulation designer

Built against `bfoon/knockknock` at commit `0cf024b` (17 Nov 2026). Every file in this zip sits at its real path in the repo: unzip it over the repository root. Nothing in the repo was changed or pushed.

## Install

1. Unzip over the repository root, so the files land at the paths below.
2. Make and run the migration for the new `ChalkPart` model. Chalk's migrations live on the server, so none is shipped:

   ```
   python manage.py makemigrations chalk
   python manage.py migrate
   ```

3. Collect static files as usual (`python manage.py collectstatic`). The new scripts and the stylesheet are versioned `?v=1` in `templates/chalk/lab.html`.
4. Optional: with `GEMINI_API_KEY` set (as for the lab's existing AI), the assistant, the part designer and the simulation designer use the AI. Without it, each one falls back to a built-in helper, so no button is left doing nothing.

## What's new

### Board studio (the **Board** space)
- **Tools:** Select, Track (45° drawing, `L` drops a via and switches sides), Connect (pad-to-pad connections), Via, Hole, Hole pattern (perfboard, stripboard, bolt circle), Text (silkscreen or copper), Copper pour, Keep-out, Board shape, Cut-out, Measure.
- **Canvas:** zoom with the wheel, a pinch or + and −; pan by dragging the empty board, with the middle button or by holding Space. Snap grid from 0.1 mm to 2.54 mm, live air wires and net highlighting.
- **Board shapes:** a rectangle, circle, hexagon, heart or shield badge, plus Credit card, Arduino Uno shield, Raspberry Pi HAT (with the 40-pin header and its pin names), Pi Zero pHAT, Feather wing and Eurocard. You can also drag the outline's corners into any shape, and add cut-outs.
- **Real packages:** any bench part can wear a real package (a 555 as DIP-8 or SOIC-8, a resistor as 0805, and so on). The pins map to the right pads, and the routing redoes itself.
- **Footprint library** in the left drawer: about 160 footprints, including DIP, SOIC, TSSOP, SSOP, MSOP, QFN, QFP, SOT, TO-92, TO-220 and DPAK; 0402–2512 resistors and capacitors; electrolytics, tantalums, inductors and crystals; LEDs and WS2812B; headers, sockets, JST XH/PH/SH, screw terminals and IDC headers; USB-C, micro, mini, A and B, HDMI, RJ45, barrel jack, 3.5 mm audio, SMA and microSD; switches, relays, buzzers, potentiometers, coin-cell holders and 7-segment displays; mounting holes, test points and fiducials; ESP32, Pico and Nano. There are also about 70 real components with their datasheet pinouts (NE555, LM358/393, 74HC595/00/04, MCP3008, MCP23017, PCF8574, ULN2003, L293D, ATmega328P, CH340G, AMS1117, LM7805/317, DS18B20…). Parts that the lab simulates go on the bench too. Search is forgiving ("usb c" finds USB-C), and typing something like "qfn 32 5x5" makes a footprint that isn't in the library.
- **Nets:** pads stay joined the way the circuit joins them, plus board-only links and net labels (label a pad `GND` and it joins the board's GND).
- **Router:** a polygon-aware two-layer router that respects the outline, cut-outs, holes and keep-outs, and never moves tracks you drew yourself. Power tracks are routed wide when they fit.
- **Checks (design-rule check):** shorts, clearances, the board edge, drills, annular rings, overlapping parts, unrouted connections and pins with no pad. Click an issue to fly to it.
- **Assistant:** ask about the board or ask for a change. Changes come back as a list you tick and apply, and one Undo takes them back.
- **3-D view:** the finished board in its mask colour, with parts standing on it, to turn round. There are seven mask colours and gold or silver pad finishes.
- **Export:** a Gerber X2 + Excellon zip (copper, mask, paste, both silkscreens, outline and cut-outs, plated and bare holes with slots, parts list, positions, netlist), a KiCad 7/8 board (`.kicad_pcb`) with every footprint as `.kicad_mod`, the item list (CSV), pick-and-place (CSV), an SVG picture, a 3-D PNG, a zip of footprints and the parts you made, and the whole design as JSON.

### Part designer ("＋ Design a part", in both drawers)
- Start from a package family and a few numbers, from words, from the library, from a KiCad `.kicad_mod`, or from a chip it knows by part number. You can also describe the part and let the AI design it.
- Drag pads around; add pads and holes; set each pad's shape, size and drill; name and type every pin.
- **Behaviour:** a few lines in a small language (resistors, capacitors, diodes, LEDs, transistors, switches and sources that follow voltages, time and the part's own settings, plus events, glow, display, sound and warnings). It is solved together with the rest of the circuit. Use templates, write it by hand, or have the AI write it.
- **Try it:** a little test bench where you power the part, drive its pins with sliders and read every pin.
- Save it to any drawer category (Chips, Sensors, Power… or your own). It appears on the bench, simulates, and keeps its real footprint on the board. Parts are saved per person on the server. Each circuit also carries a copy of the parts it uses, so a shared circuit still opens.

### Simulation designer ("Simulations", top bar)
- Write experiments: probe pins, press buttons, turn dials over time, change parts, and `expect` or `always` check results. You can also start from a template made for the circuit, or describe the experiment and let the AI write it.
- **Run** works instantly on a copy of the circuit and shows scope-style traces, pass/fail ticks and a CSV download.
- **Play** runs live on the bench, then puts the circuit back as it was.
- Experiments are saved with the circuit.

## Files

New:
- `static/chalk/js/lab/lab_fp.js`: the footprint generators and library, real components, KiCad import and export, and registering your own parts.
- `static/chalk/js/lab/lab_behave.js`: the behaviour language (compiled into simulator models) and the scenario language with its runner.
- `static/chalk/js/lab/lab_pcbx.js`: the board engine v2 (shapes, nets, router, checks, Gerber/Excellon/KiCad/SVG/BOM/positions).
- `static/chalk/js/lab/lab_pcbx_view.js`: the board studio (tools, inspector, checks, assistant, library drawer, 3-D, export).
- `static/chalk/js/lab/lab_partmaker.js`: the part designer.
- `static/chalk/js/lab/lab_simdesign.js`: the simulation designer.
- `static/chalk/css/chalk_pcbx.css`
- `chalk/parts.py`: the `ChalkPart` library endpoint (`/chalk/lab/parts/`) and the cleaners for parts, v2 boards and experiments.
- `chalk/test_parts.py`
- `tools/chalk_lab/pcbx_test.js`, `tools/chalk_lab/behave_test.js`

Changed:
- `chalk/models.py`: the new `ChalkPart` model (owner, type, name, category, data).
- `chalk/lab.py`: `clean_pcb` accepts v2 boards, and `clean_circuit` keeps the parts a circuit uses and its experiments. The lab page config adds `partsUrl` and your `parts`. `MAX_DOC_BYTES` goes from 400k to 900k, to make room for a studio design and the parts it carries.
- `chalk/lab_ai.py`: four new kinds (`pcb`, `part`, `behave`, `scenario`) with their own prompts, and the answers are strictly cleaned (board actions are whitelisted).
- `chalk/urls.py`: adds `lab/parts/`.
- `static/chalk/js/lab/lab_studio.js`: uses the board studio when it is loaded. It also handles keys, the drawer, picking from the component list, the dock moving aside, and the project designer using the new engine.
- `static/chalk/js/lab/lab_app.js`: the library drawer in Board, your own drawer categories, a "Design a part" button, saving `lib` and `sims`, and Ask AI going to the board assistant in Board.
- `templates/chalk/lab.html`: the new stylesheet, the new scripts (after `lab_pcb.js`), and a "Simulations" button.
- `tools/chalk_lab/run_all.js`: runs the two new suites.

Old boards open as they were: v2 keeps every v1 field, and `lab_pcb.js` is untouched. It is still used if the new scripts aren't loaded.

## Tests

- `node tools/chalk_lab/run_all.js`: all 15 suites pass. Every example routes completely with gaps of at least 0.27 mm, checked independently from the copper. The suites also cover SMD packages, shapes, cut-outs, labels, links, pours, Gerber/KiCad output, behaviours solved in real circuits, and experiments.
- `python manage.py test chalk`: all 97 tests pass, including 19 new ones for parts, v2 boards, the parts endpoint and the AI cleaning.
- Driven end to end in headless Chrome. That covered every tool, undo/redo, all eight exports, save and reload through the server's cleaner, the part designer (with Try it) and the simulation designer. The AI paths were tried with a stubbed AI behind the real endpoint.
