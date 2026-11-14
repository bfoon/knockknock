"""Power Lab — asking the AI.

The same Gemini engine as the Circuit Lab, Hanns and Kura (hanns/ai.py):
one key in .env, the same fallback chain.

The AI never wires anything. Asked to design a system it returns a *spec* —
what has to be powered, where, and what kind of system — and the browser's
own sizing engine (static/chalk/js/power/power_size.js) does the
arithmetic and draws the wiring. Wiring a consumer unit terminal by
terminal is exactly what a language model gets subtly wrong, and a
subtly wrong consumer unit is not a thing to hand a class.

APPS mirrors W.APPLIANCES and DC_APPS mirrors W.DC_LOADS in
static/chalk/js/power/power_core.js; chalk/test_power.py fails if they drift.
"""

import json
import re

from . import lab_ai
from .lab_ai import AIUnavailable

APPS = {
    "phone": 10, "router": 12, "led_tv": 80, "decoder": 20, "laptop": 65, "desktop": 200, "printer": 450, "fan": 60,
    "ceiling_fan": 75, "fridge": 150, "freezer": 200, "vaccine": 90, "kettle": 2000, "iron": 1200, "microwave": 1100,
    "blender": 400, "washer": 500, "aircon": 900, "pump": 370, "borehole": 750, "heater": 1500, "sewing": 100,
    "welder": 3000, "cctv": 40, "speaker": 250,
}
DC_APPS = {"lamp": 5, "usb": 10, "fan": 15, "tv": 30, "fridge": 50, "router": 12, "radio": 6}
SITES = ("Banjul", "Brikama", "Farafenni", "Basse", "Dakar", "Freetown", "Lagos", "Nairobi", "Cape Town", "London")
TYPES = ("offgrid", "hybrid", "gridtie", "shs", "grid")
KINDS = {"ask", "explain", "fix", "size", "plan", "lesson", "design", "part3d", "printcoach"}

VOICE = (
    "You are the tutor inside Chalk Power Lab, a simulator for building wiring and solar power systems used by teachers, "
    "students and installers in West Africa (230 V, 50 Hz; prices in Gambian dalasi). You are shown the user's plan: its "
    "parts, cables (from, to, mm2, metres, amps), what the simulator measured, and the findings of the lab's own design "
    "checker. Talk about THIS plan, by the short names given (PV1, Q2, BAT1). Be precise and practical like a good "
    "electrical trainer: say what is happening, why, and exactly what to change, with real values (volts, amps, mm2, Ah). "
    "Show the arithmetic in one line when you size something. Keep it under about 260 words. "
    "Safety: design and explanation are welcome, but always treat live work as work for a qualified electrician; never "
    "suggest bypassing a fuse, breaker, RCD or earth, and say plainly when something in the plan is dangerous."
)
SCHEMA = (
    ' Reply with ONE JSON object and nothing else: {"reply": "markdown text (paragraphs, - lists, **bold**)", '
    '"highlights": ["short names of the parts your reply is about, e.g. Q2"], "spec": optional (see the task)}.'
)
TASKS = {
    "ask": "Answer the question about this plan.",
    "explain": "Explain what this system is and how energy flows through it, from source to load, part by part.",
    "fix": "Say what is wrong or risky in this plan, most dangerous first, and exactly how to fix each. Start from FINDINGS, "
           "add anything they missed, and do not repeat a finding without saying what to do about it.",
    "size": "Judge whether this system is big enough for its loads: daily energy against what the panels make in the poorest "
            "month, battery against the night, inverter against the peak and the starting surge. Show each sum in one line.",
    "plan": "Write a method statement for installing this system: the order of work, what to check at each stage before going "
            "on, and the commissioning tests with the readings to expect from THIS plan.",
    "lesson": "Write a short lesson plan around this system: objectives, a predict-observe-explain sequence using the Run a day "
              "button and the testers, two questions for the class, and one extension.",
    "design": "Turn the request into a design SPEC for the lab's sizing engine; do not size or wire anything yourself. Put it in "
              "\"spec\": {\"type\": \"offgrid|hybrid|gridtie|shs|grid\", \"loads\": [{\"app\": \"an appliance key\", \"qty\": 1, \"hours\": 5, "
              "\"watts\": only with app custom, \"name\": only with app custom}], \"site\": \"a place from SITES\", \"autonomy\": days "
              "without sun 0.5-3, \"chem\": \"agm|tubular|lfp\"}. type: offgrid = no grid at all; hybrid = solar with the grid as "
              "back-up (choose this when the request mentions NAWEC, power cuts or back-up); gridtie = solar with no battery; "
              "shs = a small 12 V DC kit for lights and phones only; grid = wiring of a building with no solar. Use \"lamp\" for "
              "lights (qty = how many). Use an APPLIANCE key when one fits, otherwise app \"custom\" with a name and honest watts. "
              "Include everything such a place would really have, even if the request only names a few things; use realistic "
              "hours a day. Leave out \"hours\" to use the usual hours. In \"reply\", say in three or four sentences what you assumed.",
}


def _prompt(body):
    kind = body.get("kind") if body.get("kind") in KINDS else "ask"
    question = str(body.get("question") or "")[:1500]
    plan = body.get("plan") if isinstance(body.get("plan"), dict) else {}
    parts = ["TASK: " + TASKS[kind], "QUESTION: " + question]
    if kind == "design":
        parts += [
            "APPLIANCES (key: watts): " + ", ".join(f"{k}: {v}" for k, v in APPS.items()),
            "FOR type shs ONLY, use these DC keys instead: " + ", ".join(f"{k}: {v}" for k, v in DC_APPS.items()),
            "SITES: " + ", ".join(SITES),
        ]
        site = plan.get("site") if isinstance(plan.get("site"), dict) else {}
        if site.get("name"):
            parts.append("The plan is currently set at: " + str(site.get("name"))[:40])
    else:
        parts += [
            "PLAN (site; parts with their settings and, if the power is on, live readings under \"now\"; cables as "
            "[from, to, mm2, metres, amps]; findings from the design checker; a day's totals if one has been run):",
            json.dumps(plan, separators=(",", ":"))[:26000],
        ]
    return kind, "\n\n".join(parts)


def clean_spec(raw):
    """Whitelist a design spec. The browser normalises it again."""
    if not isinstance(raw, dict):
        return None
    kind = raw.get("type") if raw.get("type") in TYPES else "offgrid"
    apps = DC_APPS if kind == "shs" else APPS
    loads = []
    for item in (raw.get("loads") or [])[:30] if isinstance(raw.get("loads"), list) else []:
        if not isinstance(item, dict):
            continue
        app = item.get("app")
        qty = item.get("qty")
        qty = max(1, min(40, int(qty))) if isinstance(qty, (int, float)) and not isinstance(qty, bool) else 1
        row = {"qty": qty}
        if app == "lamp" or app in apps:
            row["app"] = app
        else:
            watts = item.get("watts")
            if not isinstance(watts, (int, float)) or isinstance(watts, bool) or not 0 < watts <= 20000:
                continue
            row.update({"app": "custom", "watts": round(float(watts), 1),
                        "name": re.sub(r"[<>\x00-\x1f]", "", str(item.get("name") or "Appliance"))[:40]})
        hours = item.get("hours")
        if isinstance(hours, (int, float)) and not isinstance(hours, bool) and 0 <= hours <= 24:
            row["hours"] = round(float(hours), 2)
        loads.append(row)
    if not loads:
        return None
    out = {"type": kind, "loads": loads}
    site = raw.get("site")
    site = site.get("name") if isinstance(site, dict) else site
    if site in SITES:
        out["site"] = {"name": site}
    days = raw.get("autonomy")
    if isinstance(days, (int, float)) and not isinstance(days, bool):
        out["autonomy"] = max(0.5, min(3, round(float(days) * 2) / 2))
    if raw.get("chem") in ("agm", "tubular", "lfp"):
        out["chem"] = raw["chem"]
    return out


def ask(body):
    from hanns import ai as hai

    if not isinstance(body, dict):
        raise AIUnavailable("Nothing was asked.", 400)
    # Printable parts are the Circuit Lab's business: one 3-D tutor, not two.
    if body.get("kind") == "part3d":
        answer = lab_ai.ask({"kind": "object", "mode": "pro", "question": str(body.get("question") or "")[:1200],
                             "size": body.get("size")})
        return {"reply": answer.get("reply", ""), "body": answer.get("body")}
    if body.get("kind") == "printcoach":
        answer = lab_ai.ask({"kind": "printcoach", "mode": "pro", "question": str(body.get("question") or "")[:600],
                             "report": body.get("report")})
        return {"reply": answer.get("reply", "")}
    kind, prompt = _prompt(body)
    try:
        raw, _model = hai.ai_json(VOICE + SCHEMA, prompt, temperature=0.4 if kind == "design" else 0.6, max_tokens=6000)
    except hai.AIError as e:
        raise AIUnavailable(str(e), getattr(e, "status", 502))
    if not isinstance(raw, dict):
        raw = {"reply": str(raw)}
    out = {"reply": str(raw.get("reply") or "").strip()[:6000] or "I couldn't think of an answer to that."}
    out["highlights"] = [h for h in (raw.get("highlights") or []) if isinstance(h, str) and re.match(r"^[A-Z]{1,4}\d{1,3}$", h)][:10] \
        if isinstance(raw.get("highlights"), list) else []
    if kind == "design":
        spec = clean_spec(raw.get("spec"))
        if spec:
            # the site rides back with its latitude from the browser's own table
            out["spec"] = spec
    return out
