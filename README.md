# 🚪 Knock-Knock

A real-time interactive presentation & quiz platform — think **Mentimeter** meets **Kahoot**, built with Django, Channels, Bootstrap 5, and Docker.

## ✨ Features

### 🎤 Knock-Knock Menti (Polls / Questionnaires)
- Create questionnaires with multiple question types (Multiple Choice, Word Cloud, Scale, Open Text, Ranking)
- 20+ visual templates with logo upload
- Per-question chart selection (Bar, Donut, Pie, Word Cloud, Map, Line, Radar...)
- Live chart preview with sample data before going live
- **Orchestra Mode**: presenter controls slide progression, participants follow in lockstep
- **Open Mode**: participants self-pace
- Live drawing tools on charts (free hand, highlighter, shapes, eraser)
- Fullscreen presentation, group display (all charts on one screen)
- QR code + 6-digit code join

### 🎮 Knock-Knock Game (Kahoot-style)
- Fast-paced quiz competitions
- Avatar selection (dragon, sword, butterfly, spacecraft, dinosaurs, joker mask...)
- Speed-based scoring or accuracy-based scoring
- **Rooms** (limited members, average-score based) or **Open**
- Live leaderboard with full-screen projection mode
- QR code join

### 🎲 Live Tables (board-game nights) — `/tabletop/`
- **Chess, Dam, Ludo and Scramble** played from phones, with the featured table in **3D on the big screen** next to a live leaderboard
- Host deals everyone into tables (random or **by leaderboard rank**); points carry across rounds — win 3 · draw 1, or 3/2/1 in 3–4 player games — plus a ⚔️ count of pieces cut down
- Server-authoritative rules in `tabletop/engines/` (full chess incl. castling/en passant/promotion; international 10×10 Dam with flying kings and the majority-capture rule; Ludo with server dice; Scramble checked against the public-domain ENABLE word list)
- Captures are a little duel: the attacker leaps in, a glowing sword swings and the victim is **sliced in two** along the blade (real clipping planes); every piece breathes, blinks and watches the action
- Phones: tap-to-move boards that face the player, dice / tile rack controls, spectate any table, emoji reactions on the projector
- Big-screen views: split · board · ranks podium · all tables (keys 1–4, ← → to change table, auto-camera cuts to the action)

### ⚡ Chalk Circuit Lab — `/chalk/b/<board>/lab/`
- A real electronics bench for every Chalk board: drag parts onto a silicone mat, plug them into a breadboard, wire them up and switch the power on
- **Real physics**, not animation: a nodal circuit solver (Newton-Raphson for LEDs, diodes, transistors and MOSFETs; time-stepped capacitors, coils and motors). LEDs glow by the current through them, charge visibly flows down each wire at a speed set by that current, and parts burn out, smoke and pop when you get it wrong — with the reason, in plain words
- **56 parts**: breadboards, Arduino Uno and Nano, batteries, a bench supply, resistors (editable colour bands), pots, capacitors, LEDs and RGB LEDs, diodes, NPN/PNP transistors, a logic-level MOSFET, 555 timer, logic gates, LM358, buttons, switches, bulbs, buzzers, piezo, DC motor, servo, relays, 7-segment display, I²C LCD, light/temperature/distance/motion sensors and sensor modules, multimeter and oscilloscope
- **Arduino interpreter** for real sketches (Serial, Servo, LiquidCrystal_I2C, arrays, functions, `switch`…), true to the Uno (`int` is 16-bit). Step, step over, next loop, breakpoints and a slow pace; each line lights up as it runs and ripples out from the pin it touched, with a caption saying what just happened
- **Blocks**: drag-and-drop flow blocks that generate real Arduino code; the running block lights up with its line
- **Kid mode**: a toy box of parts on wooden blocks with crocodile clips, the programmable Robo Brain, Sparky the electron, and eight missions that only count when the circuit really works
- **Ask AI** (Gemini, via the same `GEMINI_API_KEY` as Hanns and Kura): explain the circuit, find what's wrong, write the program, or design a circuit and build it on the bench. Without a key, a built-in checker still answers from the circuit's netlist and the simulator's warnings. `CHALK_LAB_AI_HOURLY_LIMIT` (default 40) caps questions per person per hour
- **Pin to board** drops a picture of the bench onto the board's current page, live on the projector
- **Layout**: Design / Split / Code views (Run in Code view brings the bench back), the program panel docked bottom, left or right or detached as a floating window, resizable panels, and full screen for a projector with a caption of the running line
- **Coding with AI**: write a sketch from a description, change or fix your code (or just the selected lines), continue from the cursor, explain — every change comes back as a review where you keep or drop each change. Without an AI, compile errors get one-click fixes. In Blocks (and in kid mode, by telling Sparky) a description becomes blocks
- **Wireless**: HC-05 Bluetooth with a phone controller app in the side panel, HC-12 433 MHz radio between boards (channels, interference), and a 433 MHz key fob with its receiver; `SoftwareSerial` in the interpreter; several boards each running their own program; radio waves and packets drawn on the bench
- **Workshop**: perfboard and stripboard where nothing connects until it is soldered — soldering iron (cold joints flicker, too much heat cooks parts, drag to bridge pads), solder sucker, hot air to free a part, cutters for wires and legs, and a track cutter for stripboard
- 24 ready-made circuits (17 Pro, 7 Kid); open the lab from the projector's corner bar, with <kbd>L</kbd>, or from the board list
- Saved circuits live in `chalk.BoardCircuit` — after pulling, run `python manage.py makemigrations chalk && python manage.py migrate`
- **Layers** — the left drawer has a second tab listing every component and wire on the bench with a schematic reference (R1, D2, U1). Click a row to select it and see its details, double-click to fly to it, hover to see where it is; rename, hide or lock any part; download the parts list as CSV
- **Full screen** takes the whole screen, as the board does, with the component list and details one button away
- **Board** — the same circuit as a two-layer printed circuit board: footprints from the parts' own legs, auto-placement, a maze autorouter that re-routes as you drag, and Gerber + drill files in a zip for a board house
- **Body** — the shell the electronics live in, in 3-D: ten ready-made bodies (toy car, tank, rover robot, desk pet, submarine, boat, rocket, model house, tower, project box) built round the electronics you have, or your own from fourteen shapes. **Test drive** runs the real simulation: the motors your program switches turn the wheels, spin the propeller or lift the rocket. **Export for 3-D printing** gives one STL per piece, hollowed, split, laid flat, with board posts and a print sheet
- **Design a project** — describe it ("a toy car that turns away from walls") and get the circuit, the program, the routed board and the body in one go — or browse the shelf of **80 worked projects** in nine groups (cars & tanks, robots & pets, boats & submarines, rockets, smart home, garden & weather, games & gadgets, **Bluetooth**, **radio**). Bluetooth projects are driven from the phone panel; radio projects use two boards with a program each, or the 433 MHz key fob. With no AI key, a request is matched to the nearest shelf project. The shelf is `static/chalk/js/lab/lab_projects.js`: a project is a parts list plus its `loop()`, and the wiring and `setup()` are generated from the parts
- **Wiring coach** (`lab_coach.js`) — start a wire from a leg and a card says what that leg is for and rings the legs it usually joins; hover another leg and it says, before you let go, whether that join is right, risky or a short. After each wire it reads the circuit for the classic mistakes (LED with no resistor or in backwards, motor on a pin, sensor with no power, analog signal on a digital pin, I²C on the wrong pins, a dead short) and offers a one-click fix; the same findings appear under **Check**. Select a part and press **Wire it for me** and it finds free pins, adds the resistor or transistor the part needs and joins everything up, showing each step and the lines the program needs. With an AI key, **Ask the AI** does the same job: its wiring is checked leg by leg on the server, then tried on a copy of the circuit and only offered if the coach's own review finds nothing wrong. **Change it for** in the inspector swaps a part for another and carries its wires across. Tips can be switched off under View
- Code: `chalk/lab.py`, `chalk/lab_ai.py`, `static/chalk/js/lab/`. Tests: `python manage.py test chalk.test_lab`, and `node tools/chalk_lab/run_all.js` for the solver, the Arduino interpreter, every example, the board router and the 3-D bodies

### 🦸 Hero Forge (3D avatars)
- Full-body game-style characters: 4 bodies × 14 skins × 10 hair × 12 hair colours × 6 eyes × 10 outfits (incl. kaftan) × 12 colours × 12 headwear (incl. kufi & headwrap) × 10 items (incl. kora) × 6 auras
- Modelled in Blender from code: `tools/blender/build_tabletop_assets.py` → `static/tabletop/models/*.glb`
  (`blender -b -P tools/blender/build_tabletop_assets.py`, then commit the .glb files)
- Works in the quiz game too (new **🦸 3D Hero** tab on the join screen); ids look like `kh-0350241520` and fit the existing avatar columns

## 🧱 Stack

| Layer | Tech |
|---|---|
| Backend | Django 5, Django Channels 4 |
| Real-time | WebSockets via Redis channel layer |
| Frontend | Bootstrap 5, Chart.js, Vanilla JS |
| Async runtime | Daphne (ASGI) |
| Database | PostgreSQL |
| Cache / Pub-Sub | Redis |
| Containerization | Docker + docker-compose |
| QR | `qrcode` library |

## 🚀 Quick Start

```bash
# Clone, then:
cp .env.example .env
docker compose up --build
# Open http://localhost:8000
```

Create an admin: `docker compose exec web python manage.py createsuperuser`

## 🗂️ App Structure

```
config/         # Django settings, ASGI, routing
accounts/       # User auth, profile, logo upload
core/           # Templates registry, dashboard, marketing pages
polls/          # Knock-Knock Menti (questionnaires)
games/          # Knock-Knock Game (Kahoot-style)
presentations/  # Live sessions, WebSocket consumers (shared by both)
templates/      # Server-rendered HTML
static/         # CSS, JS, images
```

## 🔌 WebSocket Routes

- `ws/present/<session_code>/` — presenter control channel
- `ws/play/<session_code>/` — participant channel
- `ws/draw/<session_code>/` — drawing overlay broadcast
- `ws/tabletop/<code>/` — Live Tables (stage, phones, spectators)

## 📐 Modes

| Mode | Polls | Games |
|---|---|---|
| **Orchestra** | Presenter advances; participants locked to current question | Same |
| **Open** | Participants self-pace | Participants race; first-correct gets points |
| **Rooms** | — | Limited members, average score wins |

## 📅 Roadmap

- [ ] More question types (image-choice, hotspot)
- [ ] Export results to CSV/PDF
- [ ] Team mode (rooms with shared scores)
- [ ] AI question generation
