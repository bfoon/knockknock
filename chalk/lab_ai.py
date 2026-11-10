"""Circuit Lab — asking the AI.

Uses the same Gemini engine as Hanns and Kura (hanns/ai.py): one key in
.env, the same model fallback chain, the same free-tier behaviour. The lab
sends a netlist — which legs share a node — plus what the simulator
measured, so the AI is talking about this circuit, not circuits in general.

Everything that comes back is cleaned against CATALOG before it reaches the
browser, and the browser checks it again before building anything.

CATALOG mirrors static/chalk/js/lab/lab_parts*.js: type -> (name, kid part,
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
    'k_brain': ('Robo Brain', True, ('OUT1', 'OUT2', 'OUT3', 'OUT4', 'GND1', 'IN1', 'IN2', 'EYE', '5V', 'GND2'), {}),
}


KINDS = {"ask", "explain", "fix", "code", "build", "lesson",
         "write", "edit", "fixcode", "continue", "explaincode", "blocks"}
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


def _system(mode, kind):
    kid = mode == "kid"
    voice = (
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
        "Only include code, circuit or blocks when the task asks for them. Part positions are in units of 20 = 0.1 inch; space parts "
        "about 200-300 apart. Use only part types and pin names from the catalog."
    )
    return voice + safety + schema


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
        parts += ["PART CATALOG:", _catalog_text(mode == "kid")]
    if kind in CODE_KINDS or kind == "build":
        parts.append(ARDUINO_RULES)
        if mode == "kid":
            parts.append(KID_BRAIN)
    if kind == "blocks":
        parts += ["BLOCK FORMAT:", BLOCK_FORMAT, BLOCK_KID if mode == "kid" else BLOCK_PRO]
    return mode, kind, "\n\n".join(parts)


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
                                  temperature=0.4 if kind in CODE_KINDS or kind in ("build", "blocks") else 0.7,
                                  max_tokens=8000)
    except hai.AIError as e:
        raise AIUnavailable(str(e), getattr(e, "status", 502))
    return _clean(raw, body)
