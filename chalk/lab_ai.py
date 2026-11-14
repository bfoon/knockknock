"""Circuit Lab — asking the AI.

Uses the same Gemini engine as Hanns and Kura (hanns/ai.py): one key in
.env, the same model fallback chain, the same free-tier behaviour. The lab
sends a netlist — which legs share a node — plus what the simulator
measured, so the AI is talking about this circuit, not circuits in general.

Everything that comes back is cleaned against CATALOG before it reaches the
browser, and the browser checks it again before building anything.

CATALOG mirrors static/chalk/js/lab/lab_parts*.js, lab_wireless.js and lab_av.js: type -> (name, kid part,
pin names, default props). chalk/test_lab.py fails if the two drift apart.
Breadboards are left out: the AI wires parts directly, which is easier to
check and still builds a working circuit.
"""

import json
import re

CATALOG = {
    'arduino_uno': ('Arduino Uno', False, ('SCL', 'SDA', 'AREF', 'GND3', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'D0', 'IOREF', 'RESET', '3V3', '5V', 'GND1', 'GND2', 'VIN', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'), {}),
    'arduino_nano': ('Arduino Nano', False, ('D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'GND1', 'RST1', 'D0', 'D1', 'D13', '3V3', 'AREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', '5V', 'RST2', 'GND2', 'VIN'), {}),
    'battery_9v': ('9V battery', False, ('+', '-'), {'volts': 9}),
    'battery_aa': ('AA battery pack', False, ('+', '-'), {'cells': 2}),
    'coin_cell': ('Coin cell (CR2032)', False, ('+', '-'), {'volts': 3}),
    'psu': ('Bench power supply', False, ('+', '-'), {'volts': 5, 'limit': 1}),
    'resistor': ('Resistor', False, ('1', '2'), {'ohms': 220, 'style': 'carbon', 'watts': 0.25}),
    'potentiometer': ('Potentiometer', False, ('1', 'W', '2'), {'ohms': 10000, 'pos': 0.5}),
    'capacitor': ('Capacitor (ceramic)', False, ('1', '2'), {'farads': 1e-07}),
    'capacitor_e': ('Capacitor (electrolytic)', False, ('+', '-'), {'farads': 0.0001, 'vmax': 16}),
    'ldr': ('Light sensor (LDR)', False, ('1', '2'), {'light': 60}),
    'thermistor': ('Thermistor (NTC 10k)', False, ('1', '2'), {'temp': 25}),
    'diode': ('Diode (1N4007)', False, ('A', 'K'), {}),
    'led': ('LED', False, ('A', 'K'), {'color': 'red'}),
    'rgb_led': ('RGB LED', False, ('R', 'K', 'G', 'B'), {}),
    'npn': ('NPN transistor (2N2222)', False, ('E', 'B', 'C'), {'beta': 150}),
    'pnp': ('PNP transistor (2N3906)', False, ('E', 'B', 'C'), {'beta': 150}),
    'nmos': ('N-MOSFET (IRLZ44N)', False, ('G', 'D', 'S'), {}),
    'ic555': ('555 timer', False, ('1', '2', '3', '4', '5', '6', '7', '8'), {}),
    'logic_ic': ('Logic gate chip', False, ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'), {'chip': '7408'}),
    'ic7404': ('NOT gate chip (74HC04)', False, ('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14'), {}),
    'lm358': ('Op-amp (LM358)', False, ('1', '2', '3', '4', '5', '6', '7', '8'), {}),
    'button': ('Push button', False, ('1a', '2a', '1b', '2b'), {'cap': '#d43a2f'}),
    'slide_switch': ('Slide switch', False, ('L', 'C', 'R'), {'on': False}),
    'tilt_switch': ('Tilt switch', False, ('1', '2'), {'tilted': False}),
    'bulb': ('Light bulb (6 V)', False, ('1', '2'), {'volts': 6, 'watts': 1.8}),
    'buzzer': ('Buzzer (active)', False, ('+', '-'), {}),
    'piezo': ('Piezo speaker (passive)', False, ('+', '-'), {}),
    'motor': ('DC motor', False, ('1', '2'), {'load': 'fan'}),
    'servo': ('Servo motor (SG90)', False, ('GND', 'V+', 'SIG'), {}),
    'relay_module': ('Relay module (5 V)', False, ('VCC', 'GND', 'IN', 'NO', 'COM', 'NC'), {}),
    'relay': ('Relay (5 V coil)', False, ('C1', 'NC', 'NO', 'C2', 'COM'), {}),
    'seg7': ('7-segment display', False, ('G', 'F', 'COM1', 'A', 'B', 'E', 'D', 'COM2', 'C', 'DP'), {'color': 'red', 'common': 'cathode'}),
    'lcd_i2c': ('LCD 16×2 (I²C)', False, ('GND', 'VCC', 'SDA', 'SCL'), {}),
    'tmp36': ('Temperature sensor (TMP36)', False, ('+V', 'OUT', 'GND'), {'temp': 22}),
    'hcsr04': ('Ultrasonic distance (HC-SR04)', False, ('VCC', 'TRIG', 'ECHO', 'GND'), {'cm': 40}),
    'pir': ('Motion sensor (PIR)', False, ('VCC', 'OUT', 'GND'), {'motion': False}),
    'mod_soil': ('Soil moisture sensor', False, ('VCC', 'GND', 'DO', 'AO'), {'level': 30, 'threshold': 60}),
    'mod_gas': ('Gas sensor (MQ-2)', False, ('VCC', 'GND', 'DO', 'AO'), {'level': 30, 'threshold': 60}),
    'mod_sound': ('Sound sensor', False, ('VCC', 'GND', 'DO', 'AO'), {'level': 30, 'threshold': 60}),
    'mod_flame': ('Flame sensor', False, ('VCC', 'GND', 'DO', 'AO'), {'level': 30, 'threshold': 60}),
    'mod_ir': ('IR obstacle sensor', False, ('VCC', 'GND', 'DO', 'AO'), {'level': 30, 'threshold': 60}),
    'multimeter': ('Multimeter', False, ('COM', 'V'), {'mode': 'V'}),
    'scope': ('Oscilloscope', False, ('CH1', 'CH2', 'GND'), {}),
    'k_battery': ('Battery', True, ('+', '-'), {'volts': 3}),
    'k_bulb': ('Light bulb', True, ('a', 'b'), {'volts': 3, 'watts': 0.9}),
    'k_switch': ('Knife switch', True, ('a', 'b'), {'on': False}),
    'k_button': ('Press button', True, ('a', 'b'), {}),
    'k_buzzer': ('Buzzer', True, ('+', '-'), {}),
    'k_motor': ('Fan motor', True, ('a', 'b'), {}),
    'k_led': ('LED light', True, ('+', '-'), {'color': 'green'}),
    'k_resistor': ('Slow-down block', True, ('a', 'b'), {'ohms': 47}),
    'k_ldr': ('Light sensor', True, ('a', 'b'), {'light': 70}),
    'hc05': ('Bluetooth module (HC-05)', False, ('STATE', 'RXD', 'TXD', 'GND', 'VCC', 'EN'), {}),
    'hc12': ('Radio module (HC-12, 433 MHz)', False, ('VCC', 'GND', 'RXD', 'TXD', 'SET'), {'channel': 1, 'loss': 0}),
    'rf_rx': ('433 MHz remote receiver', False, ('GND', 'VCC', 'D0', 'D1', 'D2', 'D3', 'VT'), {'latch': False}),
    'rf_remote': ('433 MHz key fob', False, (), {}),
    'mic': ('Microphone module', False, ('VCC', 'GND', 'OUT'), {'level': 8, 'live': False}),
    'speaker': ('Speaker with voice', False, ('VCC', 'GND', 'IN'), {}),
    'smart_cam': ('Smart camera', False, ('VCC', 'GND', 'SDA', 'SCL'), {'scene': 'room', 'pos': 0, 'near': 35, 'live': False}),
    'k_brain': ('Robo Brain', True, ('OUT1', 'OUT2', 'OUT3', 'OUT4', 'GND1', 'IN1', 'IN2', 'EYE', '5V', 'GND2'), {}),
}


KINDS = {"ask", "explain", "fix", "code", "build", "lesson",
         "write", "edit", "fixcode", "continue", "explaincode", "blocks",
         "project", "body", "wire",
         "object", "bodyedit", "printcoach"}

# The 3-D body. Mirrors static/chalk/js/lab/lab_solid.js (shapes) and
# lab_body.js (ready-made bodies); chalk/test_lab.py fails if they drift.
BODY_KINDS = ("car", "robot", "submarine", "rocket", "boat", "box", "tank", "house", "tower", "pet", "custom")
SHAPES = ("box", "cyl", "cone", "sphere", "dome", "nose", "capsule", "tube", "wedge", "fin",
          "carbody", "boat", "wheel", "prop")
SOLID_IS = ("hull", "attach", "part", "cut")
SOLID_ROLES = ("wheelL", "wheelR", "prop", "led")
DRIVES = ("none", "wheels", "prop", "boat", "rocket")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
CODE_KINDS = {"code", "write", "edit", "fixcode", "continue"}
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
COLORS = {"red", "black", "yellow", "green", "blue", "orange", "white", "purple"}


class AIUnavailable(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


ARDUINO_RULES = (
    "The lab runs Arduino sketches in its own interpreter, which supports: int/long/unsigned/byte/bool/"
    "float/char/String variables and arrays (incl. 2-D), const, static locals, #define constants, functions, "
    "if/else, for, while, do-while, switch, break/continue/return; pinMode, digitalWrite, digitalRead, analogRead, "
    "analogWrite (pins 3,5,6,9,10,11), delay, delayMicroseconds, millis, micros, tone, noTone, pulseIn, map, "
    "constrain, min, max, abs, random, sqrt, pow, sin, cos; Serial.begin/print/println/available/read/parseInt; "
    "#include <Servo.h> with Servo.attach/write/read; #include <LiquidCrystal_I2C.h> with "
    "LiquidCrystal_I2C lcd(0x27,16,2), lcd.init(), lcd.backlight(), lcd.clear(), lcd.setCursor(c,r), lcd.print(x). "
    "NOT supported: interrupts, pointers, structs/classes, other libraries. It is an Uno: int is 16-bit. "
    "On the Uno, A4/A5 are SDA/SCL. Arduino pin names on the board part are D0-D13, A0-A5, 5V, 3V3, GND1, GND2, GND3."
)

WIRELESS_RULES = (
    "Wireless. BLUETOOTH: an hc05 with VCC to 5V, GND to ground, its TXD to D10 and its RXD to D11; in the sketch "
    "#include <SoftwareSerial.h> and SoftwareSerial bt(10, 11); bt.begin(9600); then bt.available(), bt.read(), bt.parseInt(), "
    "bt.readStringUntil('\\n'), bt.print(), bt.println(). The lab has a phone controller that pairs with it: its arrow pad sends the single "
    "characters F, B, L, R and S (stop); its keys send 1, 0, A and B; its slider sends the letter v followed by a number 0-255 and a "
    "newline; and typed messages arrive as a line of text. Design the sketch around exactly those. "
    "RADIO between two boards: one hc12 on EACH arduino_uno, wired the same way (TXD to D10, RXD to D11) and used through "
    "SoftwareSerial radio(10, 11); what one prints the other reads. But this reply carries only ONE sketch, so only design a "
    "two-board radio project if asked for one, and then say in \"reply\" that the second board still needs its program. "
    "KEY FOB: an rf_remote (no pins, no wires) and an rf_rx with VCC to 5V and GND to ground; while fob button A, B, C or D is held, the "
    "receiver's D0, D1, D2 or D3 goes HIGH — read them with digitalRead on pins set to INPUT. "
    "Only use wireless parts when the request asks for remote, phone, Bluetooth or radio control."
)

AV_RULES = (
    "Sound and vision. MICROPHONE (mic): VCC to 5V, GND, OUT to an analog pin; analogRead gives loudness, near 0 when quiet and "
    "near 1000 for a clap. SPEAKER (speaker): VCC to 5V, GND, IN to any digital pin — it has its own amplifier, so no transistor; "
    "tone(pin, hz) plays notes through it, and with #include <Speaker.h> and Speaker voice(pin); it can TALK: voice.say(\"Hello\") "
    "takes one to four things to say, text or numbers, e.g. voice.say(\"It is\", t, \"degrees\"); voice.speaking() is true while it "
    "is still talking; voice.play(hz, ms) plays a note; voice.stop(). SMART CAMERA (smart_cam): an I2C part — VCC to 5V, GND, SDA to "
    "A4, SCL to A5 (it shares them with an lcd_i2c). #include <SmartCamera.h>, SmartCamera cam; and cam.begin() in setup(). It answers "
    "questions rather than giving pictures: cam.brightness() 0-255; cam.motion() 0-100; cam.colour() is CAM_NONE, CAM_RED, CAM_GREEN "
    "or CAM_BLUE for the coloured object it sees; cam.x() is that object's position from -100 (far left) to 100 (far right); "
    "cam.size() 0-100 is how much of the picture it fills (bigger is nearer); cam.faces() is 1 when a person is in view; "
    "cam.snapshot() flashes its light. Use these for anything that should see, hear or speak."
)

KID_BRAIN = (
    "Kid mode uses the 'k_brain' (Robo Brain): its posts OUT1..OUT4 are Arduino pins 3,5,6,9; IN1, IN2 are pins 2 and 4 "
    "with a built-in pull-down (wire a button from the 5V post to IN1: pressed reads HIGH); EYE is A0 with a built-in "
    "pull-down (wire the k_ldr light sensor from 5V to EYE: brighter reads higher). GND1/GND2 are its minus posts."
)


def _catalog_text(kid):
    rows = []
    for t, (name, is_kid, pins, props) in CATALOG.items():
        if kid and not is_kid and t not in ("arduino_uno",):
            continue
        prop = (" props " + json.dumps(props)) if props else ""
        rows.append(f"- {t}: {name}; pins {', '.join(pins)}{prop}")
    return "\n".join(rows)


MAKER_VOICE = (
    "You are the 3-D design and printing tutor inside Chalk, used by teachers, students and small workshops. You design "
    "things from simple solid shapes that are added together and cut away, and you know FDM printing well: overhangs, "
    "supports, orientation, wall thickness, tolerances (holes print about 0.2 mm tight), and which plastic suits which job. "
    "Be concrete: give sizes in millimetres and say why. Keep it under about 220 words."
)


def _system(mode, kind):
    kid = mode == "kid"
    voice = MAKER_VOICE if kind in ("object", "bodyedit", "printcoach") else (
        "You are Sparky, a cheerful electron who helps children aged 7-11 in a classroom circuit simulator. "
        "Use short sentences and everyday words; if you must use a technical word, explain it in brackets. "
        "Be encouraging. Never more than about 120 words."
        if kid else
        "You are the electronics tutor inside Chalk Circuit Lab, a circuit and Arduino simulator used by teachers "
        "and students. Be precise and practical, like a good electronics teacher: say what is happening, why, and "
        "what to change. Use real values (volts, mA, ohms). Keep it under about 250 words unless writing code."
    )
    safety = (
        " Safety: never give instructions for working on mains electricity; if asked, say a relay or smart plug "
        "rated for mains must be fitted by a qualified adult or electrician."
    )
    schema = (
        " Reply with ONE JSON object and nothing else: "
        '{"reply": "markdown text (paragraphs, - lists, **bold**, `code`)", '
        '"highlights": ["ids of parts from the circuit your reply is about"], '
        '"code": "optional: a complete Arduino sketch", '
        '"circuit": optional {"parts": [{"id": "short id", "type": "catalog type", "props": {}, "x": 0, "y": 0}], '
        '"wires": [{"a": "partId.pin", "b": "partId.pin", "color": "red|black|yellow|green|blue|orange|white|purple"}]}}. '
        '"blocks": optional block program. '
        '"body": optional 3-D body (see BODY FORMAT). '
        '"wiring": optional {"parts": [...new helper parts only...], "wires": [...]} (see the task). '
        '"bodyops": optional list of changes to the 3-D body (see the task). '
        "Only include code, circuit, blocks or body when the task asks for them. Part positions are in units of 20 = 0.1 inch; space parts "
        "about 200-300 apart. Use only part types and pin names from the catalog."
    )
    return voice + safety + schema


BODY_FORMAT = (
    'A body is {"kind": "car|robot|submarine|rocket|boat|box|tank|house|tower|pet|custom", "color": "#rrggbb", "wall": 2, "drive": "none|wheels|prop|boat|rocket", '
    '"solids": [{"name": "Spoiler", "shape": "box", "is": "hull|attach|part|cut", "role": "", '
    '"x": 0, "y": 0, "z": 0, "sx": 30, "sy": 30, "sz": 30, "rx": 0, "ry": 0, "rz": 0, "color": "#rrggbb"}]}. '
    "Lengths are millimetres. X is forward, Y is left, Z is up, the ground is z = 0; x, y, z are the CENTRE of a shape and "
    "sx, sy, sz its size along X, Y, Z before turning; rx, ry, rz turn it in degrees about X, then Y, then Z. "
    "PREFER a ready-made kind (car, robot = rover on wheels, submarine, rocket, boat, tank, house = model house for smart-home projects, tower = lighthouse or weather station, pet = round desk creature with sensor eyes, box = plain case): the lab then builds a complete, hollow, printable body of that "
    "kind sized to fit the electronics, with wheels, axle holes and light holes already in place — and your \"solids\" are only the "
    "EXTRAS that make it this design (a spoiler, a roof scoop, a flag, a hatch, a bumper, extra portholes), placed relative to that body, "
    "which is centred on x = 0, y = 0 and roughly 130-240 long, 75-110 wide and 50-110 tall. Give \"color\" for the main shell. "
    "Use kind \"custom\" only when none fits (a spider, a lighthouse, a tank, a windmill): then \"solids\" is the WHOLE body, and at least one "
    "solid must have is = \"hull\" and be big enough to hold the ELECTRONICS size given, with 8 mm to spare all round. "
    "is: hull = part of the hollow shell the electronics go in; attach = solid, stuck onto the shell; part = printed on its own "
    "(wheels, propellers); cut = a hole through the shell (a window, an LED hole 5.2 across, an axle hole 3.4 across). "
    "role: wheelL / wheelR for wheels on the left (y > 0) and right (y < 0), which turn with motor 1 and motor 2; prop for a propeller; "
    "led for a light hole; otherwise leave it empty. "
    "Shapes — each fills its sx by sy by sz box: box; cyl (upright cylinder, axis Z); cone (point up); sphere; dome (half ball, flat side down); "
    "nose (rocket nose cone, point up); capsule (hull with rounded ends, long along X); tube (hollow cylinder, axis Z); wedge (ramp: tall at "
    "the back, x negative, sloping to nothing at the front); fin (thin swept fin in the XZ plane, root on its -X edge); carbody (a car seen "
    "from the side, pushed across its width); boat (pointed bow at +X, flat stern); wheel (rolls along X, axle along Y, so sx = sz = diameter "
    "and sy = width); prop (three-bladed propeller on the X axis, sx = thickness). To lay a cylinder along X use ry = 90; along Y use rx = 90. "
    "At most 40 solids. Everything must be printable plastic: no shape thinner than 2 mm."
)


TASKS = {
    "explain": "Explain what this circuit does and how current flows through it, part by part.",
    "fix": "Find what is wrong or risky in this circuit or program, most important first, and say exactly how to fix each.",
    "code": "Write a complete Arduino sketch for this circuit that does something sensible with everything wired to the board. Put it in \"code\". In \"reply\", explain briefly what it does.",
    "build": "Design a complete working circuit for the request. Put it in \"circuit\" (with every wire needed, "
             "including grounds and current-limiting resistors) and, if it uses a microcontroller, a sketch in \"code\". "
             "Explain it briefly in \"reply\".",
    "lesson": "Write a short classroom lesson plan around this circuit: objectives, a predict-observe-explain sequence, "
              "two questions to ask the class, and one extension.",
    "ask": "Answer the question about this circuit or program.",
    "write": "Write a complete Arduino sketch that does what the request describes, for the parts actually wired in "
             "this circuit (use the nets to find which pins things are on). Put the whole sketch in \"code\". "
             "In \"reply\", say in two or three sentences what it does and how to try it.",
    "edit": "Change the PROGRAM as the request asks. Return the COMPLETE updated program in \"code\" — the whole file, "
            "not a fragment. Keep the user's names, style and comments; change only what the request needs. If a "
            "SELECTION is given, change only those lines unless the request can't be done without touching others. "
            "In \"reply\", list what you changed and why, briefly.",
    "fixcode": "Find and fix what is wrong with the PROGRAM: the COMPILE ERRORS and RUNTIME ERROR if given, then mistakes "
               "that would make it misbehave on this circuit (wrong pin, missing pinMode, a pin that isn't wired, "
               "integer overflow on a 16-bit int). Return the COMPLETE fixed program in \"code\". Keep everything else "
               "as the user wrote it. In \"reply\", list each fix in one line.",
    "continue": "Continue the PROGRAM from the line given as CURSOR: write the next few lines the user is most likely "
                "about to write, following the request if there is one. Return the COMPLETE program with the new lines "
                "inserted in \"code\". Don't change existing lines. In \"reply\", say what you added in one sentence.",
    "explaincode": "Explain the PROGRAM (or only the SELECTION, if given) line by line in plain words: what each part does "
                   "on this circuit. Do not return code.",
    "blocks": "Build a block program that does what the request describes, for the parts wired in this circuit. "
              "Put it in \"blocks\" using exactly the BLOCK FORMAT below. In \"reply\", one short sentence about it.",
    "project": "Design a complete project a class could really build, for the request: (1) the electronics in \"circuit\", with every "
               "wire needed — grounds joined, a current-limiting resistor on every LED, and every motor switched by an nmos "
               "(gate through a 220 ohm resistor from a PWM pin, source to ground, motor between the battery + and the drain, a diode "
               "across the motor with its K to battery +) because a pin cannot drive a motor; power motors from a battery_aa with "
               "cells 4, its - joined to the Arduino ground; (2) a complete Arduino sketch in \"code\" that makes it behave as asked; "
               "(3) the 3-D printed body it lives in, in \"body\", using the BODY FORMAT. Use an arduino_uno. Keep it to what the "
               "request needs: usually 8 to 20 parts. In \"reply\", say in three or four sentences what it is, how it works, and "
               "what to try first. The body is test-driven in the lab with the simulated circuit: for a body that drives on wheels, "
               "motor 1 (the first motor in \"parts\") is the left side and motor 2 the right; a propeller follows motor 1; a rocket "
               "lifts while its first motor (its engine) is running.",
    "wire": "Wire the SELECTED part into the CIRCUIT that is already there, correctly and safely, without disturbing what is "
            "already wired. Put the result in \"wiring\": {\"parts\": [helper parts you are ADDING — a resistor, a transistor, "
            "a diode, a battery — each {\"id\": \"a new short id\", \"type\": \"catalog type\", \"props\": {}}], \"wires\": [{\"a\": "
            "\"partId.pin\", \"b\": \"partId.pin\", \"color\": \"red|black|yellow|green|blue|orange|white|purple\"}]}. In a wire, partId "
            "is either an id that is ALREADY in the CIRCUIT (use it exactly as given) or the id of one of your new helper parts. "
            "Use only pins that the nets show are free: a board pin that appears in a net with another part is taken. Rules that "
            "must hold: every LED gets its own 220 ohm resistor in series; a motor or bulb is never on a pin — battery + to one leg, "
            "the other leg to an nmos drain, source to ground, gate from a PWM pin through 220 ohm with 10k from gate to ground, and a "
            "diode across the motor with its K to battery +, the battery - joined to the board's ground; modules get VCC from 5V "
            "and GND from a GND pin; analog signals (potentiometer W, tmp36 OUT, a module's AO, an ldr divider) go to A0-A5; "
            "lcd_i2c SDA to A4 and SCL to A5; hc05 and hc12 TXD to D10 and RXD to D11; never use D0 or D1; buttons go from a pin "
            "to ground (the sketch uses INPUT_PULLUP). Do not return a \"circuit\". In \"reply\", list each connection in one "
            "short line and say WHY, so a student learns from it. If the program needs lines for this part, put only those few "
            "lines in \"code\" (not a whole sketch).",
    "object": "Design a free-standing object to 3-D print, for the request: a bracket, a stand, a case, a toy, a tool, a model. It has "
              "NO electronics inside. Put it in \"body\" using the BODY FORMAT with kind \"custom\": \"solids\" is the WHOLE object, every "
              "solid has is = \"attach\" (plastic that is added; overlapping solids are fused into one piece), is = \"cut\" (a hole or pocket "
              "taken out of it) or is = \"part\" (a separate piece printed on its own). Do not use hull. Sit it on the ground: nothing below "
              "z = 0. Make it printable without supports where you can: flat base, no overhang steeper than 45 degrees, walls at least "
              "2 mm, screw holes 0.3 mm over size. If SIZE is given, fit it. Do NOT return a circuit or code. In \"reply\", say what you "
              "made, its overall size, and how to print it (which way up, supports or not, which plastic).",
    "bodyedit": "Change the 3-D BODY given below as the request asks, and nothing else. Put the changes in \"bodyops\", a list of: "
                "{\"op\": \"set\", \"id\": \"an id from BODY\", then any of x, y, z, sx, sy, sz, rx, ry, rz, color, name to change}; "
                "{\"op\": \"remove\", \"id\": \"an id from BODY\"}; {\"op\": \"add\", \"solid\": {a solid in the BODY FORMAT}}. Use ids exactly as given. "
                "To make the whole thing bigger or smaller, set the sizes AND positions of every solid. To move something, set x, y, z. "
                "Do NOT return \"body\", a circuit or code. In \"reply\", list what you changed in short lines, and warn if a change makes "
                "it harder to print (a new overhang, a wall under 2 mm, the electronics no longer fitting).",
    "printcoach": "Advise how to print the pieces in REPORT, which was measured from the real geometry (sizes in mm, overhangCm2 is the area "
                  "steeper than 45 degrees, baseCm2 is what touches the bed, way is the orientation already chosen). Give: the plastic to use "
                  "and why for this USE; layer height, walls and infill; supports or not and what kind; bed adhesion (brim or not); any piece "
                  "that needs care and what to do; and one design change that would make it print better, if there is one. Do not return "
                  "body, circuit or code.",
    "body": "Design the 3-D printed body for this circuit, for the request. Put it in \"body\" using the BODY FORMAT. Do NOT return "
            "a circuit or code. In \"reply\", describe the body in two or three sentences and say what each extra shape is for.",
}

BLOCK_FORMAT = (
    'A program is {"setup": [block], "loop": [block], "vars": [{"name": "count", "init": "0"}]}. A block is '
    '{"t": type, "f": {fields}, "c": [child blocks] (repeat, if, while), "e": [else blocks] (if only)}. '
    "Types and fields: write {pin, hl: \"1\" or \"0\"}; pwm {pin, v}; tone {pin, hz, ms}; notone {pin}; servo {pin, a}; "
    "print {v}; lcd {v, row}; wait {ms}; repeat {n}; if {c}; until {c}; while {c}; set {var, v}; change {var, v}. "
    "All field values are strings."
)
BLOCK_KID = (
    "KID MODE: pins are \"3\", \"5\", \"6\", \"9\" for OUT 1-4. wait.ms is in SECONDS (\"1\", \"0.5\"). pwm.v is a percent 0-100. "
    "tone.hz is one of 262, 294, 330, 349, 392, 440, 494, 523. print.v and lcd.v are plain words. A condition c is "
    '{"src": "in1"} (IN 1 pressed), {"src": "in2"}, {"src": "dark"} or {"src": "bright"}. Don\'t use while.'
)
BLOCK_PRO = (
    "PRO MODE: pin is the Arduino pin number as a string. wait.ms is milliseconds. Values may be C expressions. "
    'A condition c is {"src": "dread", "pin": "2", "op": "==", "val": "LOW"}, {"src": "aread", "pin": "A0", "op": ">", "val": "500"}, '
    '{"src": "var", "name": "count", "op": ">=", "val": "3"}, {"src": "millis", "op": ">", "val": "5000"} or {"src": "expr", "expr": "x > 3"}.'
)


def _prompt(body):
    mode = "kid" if body.get("mode") == "kid" else "pro"
    kind = body.get("kind") if body.get("kind") in KINDS else "ask"
    circuit = body.get("circuit") if isinstance(body.get("circuit"), dict) else {}
    code = str(body.get("code") or "")[:8000]
    serial = str(body.get("serial") or "")[-1500:]
    question = str(body.get("question") or "")[:1200]
    parts = [
        "TASK: " + TASKS[kind],
        "QUESTION: " + question,
        "MODE: " + mode,
        "CIRCUIT (parts, then nets: each net is a list of partId.pin that are electrically joined; "
        "readings are what the simulator measured: i amps, v volts, b brightness 0-1, w motor rad/s):",
        json.dumps(circuit, separators=(",", ":"))[:24000],
    ]
    if code.strip():
        numbered = "\n".join(f"{i + 1:>3}| {line}" for i, line in enumerate(code.split("\n")))
        parts += ["PROGRAM (line numbers added for reference; never include them in returned code):", numbered]
    sel = body.get("selection") if isinstance(body.get("selection"), dict) else None
    if sel and isinstance(sel.get("from"), int) and isinstance(sel.get("to"), int):
        parts.append(f"SELECTION: lines {sel['from']}-{sel['to']}")
    if kind == "continue" and isinstance(body.get("cursor"), int):
        parts.append(f"CURSOR: after line {body['cursor']}")
    errors = [e for e in (body.get("errors") or []) if isinstance(e, dict)][:6]
    if errors:
        parts.append("COMPILE ERRORS:\n" + "\n".join(f"line {e.get('line')}: {str(e.get('msg'))[:200]}" for e in errors))
    rt = body.get("runtime") if isinstance(body.get("runtime"), dict) else None
    if rt:
        parts.append(f"RUNTIME ERROR: line {rt.get('line')}: {str(rt.get('msg'))[:200]}")
    if serial.strip():
        parts += ["SERIAL MONITOR (latest):", serial]
    if kind == "build":
        parts += ["PART CATALOG:", _catalog_text(mode == "kid"), WIRELESS_RULES, AV_RULES]
    if kind in CODE_KINDS or kind == "build":
        parts.append(ARDUINO_RULES)  # (a project adds its own copy below, with the catalog)
        if kind in CODE_KINDS and any(isinstance(p, dict) and p.get("type") in ("mic", "speaker", "smart_cam")
                                      for p in (circuit.get("parts") or [])):
            parts.append(AV_RULES)   # the code helper must know the camera and speaker libraries
        if mode == "kid":
            parts.append(KID_BRAIN)
    if kind == "blocks":
        parts += ["BLOCK FORMAT:", BLOCK_FORMAT, BLOCK_KID if mode == "kid" else BLOCK_PRO]
    if kind == "project":
        parts += ["PART CATALOG:", _catalog_text(mode == "kid"), ARDUINO_RULES, WIRELESS_RULES, AV_RULES]
    if kind == "wire":
        chosen = str(body.get("selected") or "")
        parts += ["SELECTED: " + (chosen if ID_RE.match(chosen) else "(none)"), "PART CATALOG:", _catalog_text(mode == "kid")]
    if kind in ("object", "bodyedit"):
        parts += ["BODY FORMAT:", BODY_FORMAT]
        if isinstance(body.get("size"), str):
            parts.append("SIZE: " + body["size"][:120])
    if kind == "bodyedit":
        parts += ["BODY (id, name, shape, is, role, centre x y z, size sx sy sz, turn rx ry rz, color):",
                  json.dumps(body.get("body") if isinstance(body.get("body"), (dict, list)) else {}, separators=(",", ":"))[:16000]]
    if kind == "printcoach":
        parts += ["REPORT:", json.dumps(body.get("report") if isinstance(body.get("report"), dict) else {}, separators=(",", ":"))[:6000]]
    if kind in ("project", "body"):
        parts += ["BODY FORMAT:", BODY_FORMAT]
        size = circuit.get("electronics") or (circuit.get("body") or {}).get("electronics") if isinstance(circuit, dict) else None
        if isinstance(size, dict):
            parts.append("ELECTRONICS: the board and its parts take up about %s x %s x %s mm (long, wide, tall)." % (
                _n(size.get("w"), 70), _n(size.get("d"), 55), _n(size.get("h"), 18)))
    return mode, kind, "\n\n".join(parts)


def _n(v, default):
    return round(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 < v < 2000 else default


def _num(v, lo, hi, default):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or v in (float("inf"), float("-inf")):
        return default
    return max(lo, min(hi, round(float(v), 1)))


def clean_wiring(raw, circuit):
    """Wires and helper parts to add to a circuit that already exists.

    A wire may name a part the browser told us is on the bench, or one of the
    new helper parts; either way the pin must exist on that kind of part.
    The browser applies the same test again, and then tries the wiring on a
    copy of the circuit before offering it.
    """
    if not isinstance(raw, dict):
        return None
    types = {}
    for p in (circuit.get("parts") or []) if isinstance(circuit, dict) else []:
        if isinstance(p, dict) and isinstance(p.get("id"), str) and ID_RE.match(p["id"]) and p.get("type") in CATALOG:
            types[p["id"]] = p["type"]
    parts = []
    for p in (raw.get("parts") or [])[:12] if isinstance(raw.get("parts"), list) else []:
        if not isinstance(p, dict):
            continue
        pid, ptype = str(p.get("id") or ""), p.get("type")
        if not ID_RE.match(pid) or pid in types or ptype not in CATALOG or CATALOG[ptype][0].startswith("Arduino"):
            continue
        types[pid] = ptype
        defaults = CATALOG[ptype][3]
        props = {k: v for k, v in (p.get("props") or {}).items()
                 if k in defaults and isinstance(v, (int, float, str, bool)) and not (isinstance(v, str) and len(v) > 40)
                 } if isinstance(p.get("props"), dict) else {}
        parts.append({"id": pid, "type": ptype, "props": props})
    wires = []
    for w in (raw.get("wires") or [])[:60] if isinstance(raw.get("wires"), list) else []:
        if not isinstance(w, dict):
            continue
        ends = []
        for side in ("a", "b"):
            ref = str(w.get(side) or "")
            pid, _, pin = ref.partition(".")
            if pid in types and pin in CATALOG[types[pid]][2]:
                ends.append(ref)
        if len(ends) == 2 and ends[0] != ends[1]:
            wire = {"a": ends[0], "b": ends[1]}
            if w.get("color") in COLORS:
                wire["color"] = w["color"]
            wires.append(wire)
    return {"parts": parts, "wires": wires} if wires else None


def _clean_solid(s):
    if not isinstance(s, dict) or s.get("shape") not in SHAPES:
        return None
    item = {
        "name": re.sub(r"[<>\x00-\x1f]", "", str(s.get("name") or ""))[:40] or s["shape"],
        "shape": s["shape"],
        "is": s.get("is") if s.get("is") in SOLID_IS else "attach",
        "x": _num(s.get("x"), -800, 800, 0), "y": _num(s.get("y"), -800, 800, 0), "z": _num(s.get("z"), -200, 1200, 20),
        "sx": _num(s.get("sx"), 0.5, 600, 30), "sy": _num(s.get("sy"), 0.5, 600, 30), "sz": _num(s.get("sz"), 0.5, 600, 30),
        "rx": _num(s.get("rx"), -360, 360, 0), "ry": _num(s.get("ry"), -360, 360, 0), "rz": _num(s.get("rz"), -360, 360, 0),
    }
    if isinstance(s.get("color"), str) and HEX_RE.match(s["color"]):
        item["color"] = s["color"]
    if s.get("role") in SOLID_ROLES:
        item["role"] = s["role"]
    return item


def clean_bodyops(raw, body):
    """Changes to a body that already exists. Ids must be ones the browser
    sent; every number is bounded; the browser checks them again."""
    known = set()
    for s in (body.get("solids") or []) if isinstance(body, dict) else []:
        if isinstance(s, dict) and isinstance(s.get("id"), str) and ID_RE.match(s["id"]):
            known.add(s["id"])
    out = []
    for op in (raw or [])[:80] if isinstance(raw, list) else []:
        if not isinstance(op, dict):
            continue
        kind = op.get("op")
        if kind == "add":
            solid = _clean_solid(op.get("solid"))
            if solid:
                out.append({"op": "add", "solid": solid})
        elif kind in ("set", "remove") and op.get("id") in known:
            item = {"op": kind, "id": op["id"]}
            if kind == "set":
                for key, lo, hi in (("x", -800, 800), ("y", -800, 800), ("z", -200, 1200), ("sx", 0.5, 600), ("sy", 0.5, 600),
                                    ("sz", 0.5, 600), ("rx", -360, 360), ("ry", -360, 360), ("rz", -360, 360)):
                    if isinstance(op.get(key), (int, float)) and not isinstance(op.get(key), bool):
                        item[key] = _num(op[key], lo, hi, 0)
                if isinstance(op.get("color"), str) and HEX_RE.match(op["color"]):
                    item["color"] = op["color"]
                if isinstance(op.get("name"), str):
                    item["name"] = re.sub(r"[<>\x00-\x1f]", "", op["name"])[:40]
                if len(item) == 2:
                    continue
            out.append(item)
    return out


def clean_body(raw, free=False):
    """Whitelist a body the AI described. Unknown shapes are dropped and every
    number is bounded; the browser checks it all again before building.

    `free` is a stand-alone object with no electronics: there is no shell,
    so nothing is a hull and there is no falling back to a plain case."""
    if not isinstance(raw, dict):
        return None
    if free:
        solids = [s for s in (_clean_solid(q) for q in (raw.get("solids") or [])[:60]) if s] if isinstance(raw.get("solids"), list) else []
        for s in solids:
            if s["is"] == "hull":
                s["is"] = "attach"
        if not any(s["is"] != "cut" for s in solids):
            return None
        out = {"kind": "custom", "free": True, "wall": 2, "drive": "none", "solids": solids}
        if isinstance(raw.get("color"), str) and HEX_RE.match(raw["color"]):
            out["color"] = raw["color"]
        return out
    kind = raw.get("kind") if raw.get("kind") in BODY_KINDS else "custom"
    solids = []
    for s in (raw.get("solids") or [])[:40] if isinstance(raw.get("solids"), list) else []:
        if not isinstance(s, dict) or s.get("shape") not in SHAPES:
            continue
        item = {
            "name": re.sub(r"[<>\x00-\x1f]", "", str(s.get("name") or ""))[:40] or s["shape"],
            "shape": s["shape"],
            "is": s.get("is") if s.get("is") in SOLID_IS else "attach",
            "x": _num(s.get("x"), -800, 800, 0), "y": _num(s.get("y"), -800, 800, 0), "z": _num(s.get("z"), -200, 1200, 20),
            "sx": _num(s.get("sx"), 0.5, 600, 30), "sy": _num(s.get("sy"), 0.5, 600, 30), "sz": _num(s.get("sz"), 0.5, 600, 30),
            "rx": _num(s.get("rx"), -360, 360, 0), "ry": _num(s.get("ry"), -360, 360, 0), "rz": _num(s.get("rz"), -360, 360, 0),
        }
        if isinstance(s.get("color"), str) and HEX_RE.match(s["color"]):
            item["color"] = s["color"]
        if s.get("role") in SOLID_ROLES:
            item["role"] = s["role"]
        solids.append(item)
    if kind == "custom" and not any(s["is"] == "hull" for s in solids):
        # nothing to put the electronics in: fall back to a plain case
        kind = "box"
    out = {"kind": kind, "wall": _num(raw.get("wall"), 1.2, 4, 2), "solids": solids}
    if isinstance(raw.get("color"), str) and HEX_RE.match(raw["color"]):
        out["color"] = raw["color"]
    if raw.get("drive") in DRIVES:
        out["drive"] = raw["drive"]
    return out


def _clean(raw, body):
    if not isinstance(raw, dict):
        raw = {"reply": str(raw)}
    known = set()
    circ = body.get("circuit") if isinstance(body.get("circuit"), dict) else {}
    for p in circ.get("parts") or []:
        if isinstance(p, dict) and isinstance(p.get("id"), str):
            known.add(p["id"])
    out = {"reply": str(raw.get("reply") or "").strip()[:6000] or "I couldn't think of an answer to that."}
    out["highlights"] = [h for h in (raw.get("highlights") or []) if isinstance(h, str) and h in known][:8]
    code = raw.get("code")
    if isinstance(code, str) and code.strip():
        out["code"] = code.strip()[:20000] + "\n"
    c = raw.get("circuit")
    if isinstance(c, dict) and isinstance(c.get("parts"), list):
        parts, ids = [], {}
        for p in c["parts"][:60]:
            if not isinstance(p, dict):
                continue
            pid, ptype = str(p.get("id") or ""), p.get("type")
            if not ID_RE.match(pid) or ptype not in CATALOG or pid in ids:
                continue
            ids[pid] = ptype
            props = {}
            defaults = CATALOG[ptype][3]
            for k, v in (p.get("props") or {}).items() if isinstance(p.get("props"), dict) else []:
                if k in defaults and isinstance(v, (int, float, str, bool)) and not (isinstance(v, str) and len(v) > 40):
                    props[k] = v
            item = {"id": pid, "type": ptype, "props": props}
            for axis in ("x", "y"):
                v = p.get(axis)
                if isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) < 20000:
                    item[axis] = v
            parts.append(item)
        wires = []
        for w in (c.get("wires") or [])[:160]:
            if not isinstance(w, dict):
                continue
            ends = []
            for side in ("a", "b"):
                ref = str(w.get(side) or "")
                pid, _, pin = ref.partition(".")
                if pid in ids and pin in CATALOG[ids[pid]][2]:
                    ends.append(ref)
            if len(ends) == 2:
                wire = {"a": ends[0], "b": ends[1]}
                if w.get("color") in COLORS:
                    wire["color"] = w["color"]
                wires.append(wire)
        if parts:
            out["circuit"] = {"parts": parts, "wires": wires}
    b = raw.get("blocks")
    if isinstance(b, dict):
        out["blocks"] = _bounded(b)
    if body.get("kind") == "wire":
        wiring = clean_wiring(raw.get("wiring"), circ)
        if wiring:
            out["wiring"] = wiring
        out.pop("circuit", None)       # this task adds to a circuit; it never replaces one
        if "code" in out:
            out["code"] = "\n".join(out["code"].split("\n")[:20])
    if body.get("kind") in ("project", "body"):
        shell = clean_body(raw.get("body"))
        if shell:
            out["body"] = shell
    if body.get("kind") == "object":
        thing = clean_body(raw.get("body"), free=True)
        if thing:
            out["body"] = thing
    if body.get("kind") == "bodyedit":
        ops = clean_bodyops(raw.get("bodyops"), body.get("body"))
        if ops:
            out["bodyops"] = ops
    if body.get("kind") in ("object", "bodyedit", "printcoach"):
        for key in ("circuit", "code", "blocks"):
            out.pop(key, None)
    return out


def _bounded(value, depth=0, budget=None):
    """A size-limited copy of the block tree. The browser checks every block
    against its own catalogue; this only stops something enormous."""
    budget = budget if budget is not None else [3000]
    budget[0] -= 1
    if budget[0] < 0 or depth > 12:
        return None
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:200]
    if isinstance(value, list):
        return [_bounded(v, depth + 1, budget) for v in value[:100]]
    if isinstance(value, dict):
        return {str(k)[:40]: _bounded(v, depth + 1, budget) for k, v in list(value.items())[:30]}
    return None


def ask(body):
    from hanns import ai as hai

    if not isinstance(body, dict):
        raise AIUnavailable("Nothing was asked.", 400)
    mode, kind, prompt = _prompt(body)
    try:
        raw, _model = hai.ai_json(_system(mode, kind), prompt,
                                  temperature=0.5 if kind in ("project", "body", "object", "bodyedit") else
                                  0.4 if kind in CODE_KINDS or kind in ("build", "blocks") else 0.7,
                                  max_tokens=12000 if kind == "project" else 8000)
    except hai.AIError as e:
        raise AIUnavailable(str(e), getattr(e, "status", 502))
    return _clean(raw, body)
