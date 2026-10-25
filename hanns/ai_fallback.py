"""
hanns/ai_fallback.py — Hanns' built-in designer (no AI needed).

The last line of defence for Hanns AI Studio. When every AI provider is
unavailable — Gemini's free quota used up, an outage, a bad key, a network
problem, or an unexpected error — the Studio still delivers a useful
result instead of an error:

    deck / slide   template layouts that vary (title, agenda, split, big
                   number, timeline, comparison, quote, chart, closing), filled
                   with the user's own words where possible
    background     procedural SVG art in every Studio style (aurora, waves,
                   geometric, topographic, bokeh, kente-inspired, cosmic,
                   paper-cut, minimal grain, neon tech), coloured by mood words
    polish         grid snapping, consistent margins, type hierarchy, on-canvas
    decorate       framing accents per decoration style
    animate        story-ordered entrances + varied transitions
    ideas / notes  structure-based suggestions and spoken notes
    rewrite        shorter / simpler / punchier / formal / story variants

Output uses exactly the same shapes as the AI actions in hanns/ai.py, so the
browser validates and applies it the same way.
"""

from __future__ import annotations

import hashlib
import math
import random
import re
import time

W, H = 960, 540

# ─────────────────────────── palettes & mood ───────────────────────────

PALETTES = {
    "bold":      ["#0f0c29", "#302b63", "#ff5e62", "#ff9966", "#ffffff"],
    "elegant":   ["#f7f3ec", "#1c1b22", "#b08d57", "#6b5b4b", "#1c1b22"],
    "playful":   ["#fff7e6", "#ff6b6b", "#feca57", "#48dbfb", "#1e272e"],
    "corporate": ["#f4f7fb", "#0b3d91", "#1f6feb", "#7aa7ff", "#0d1b2a"],
    "minimal":   ["#ffffff", "#111111", "#e5e5e5", "#3b82f6", "#111111"],
    "dark":      ["#05060f", "#1b1f3b", "#7c3aed", "#22d3ee", "#f8fafc"],
}
MOODS = [
    (("sunrise", "sunset", "gold", "warm", "harvest", "desert", "sahel", "fire"), ["#1a0b2e", "#7b2d26", "#f59e0b", "#fde68a", "#fff7ed"]),
    (("river", "ocean", "sea", "water", "blue", "coast", "gambia", "rain"), ["#03111f", "#0c4a6e", "#0ea5e9", "#2dd4bf", "#f0f9ff"]),
    (("forest", "farm", "green", "nature", "leaf", "agri", "crop", "garden"), ["#06140c", "#14532d", "#22c55e", "#a3e635", "#f0fdf4"]),
    (("night", "space", "cosmic", "star", "galaxy", "dark"), ["#02010a", "#1e1b4b", "#7c3aed", "#f472b6", "#f8fafc"]),
    (("health", "medical", "clean", "hospital", "care"), ["#f0f9ff", "#075985", "#06b6d4", "#34d399", "#0c1a2b"]),
    (("tech", "neon", "digital", "data", "cyber", "ai", "code"), ["#030712", "#111827", "#22d3ee", "#a855f7", "#e0f2fe"]),
    (("kente", "africa", "culture", "festival", "celebrat", "party"), ["#1a1205", "#b45309", "#facc15", "#16a34a", "#fff7ed"]),
]


def _rng(*parts):
    """Seeded RNG: varies per request (time) but stays deterministic within it."""
    seed = hashlib.sha1(("|".join(str(p) for p in parts) + str(time.time_ns())).encode()).hexdigest()
    return random.Random(int(seed[:12], 16))


def mood_palette(text, tone="bold"):
    t = (text or "").lower()
    for words, pal in MOODS:
        if any(w in t for w in words):
            return pal
    return PALETTES.get(tone, PALETTES["bold"])


def _lum(hexc):
    h = str(hexc or "").strip().lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    try:
        r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return 0.5
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def _rgba(hexc, a):
    h = str(hexc or "").strip().lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    try:
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        r, g, b = 232, 72, 43
    return f"rgba({r},{g},{b},{a})"


# ─────────────────────────── text helpers ───────────────────────────

STOP = set("a an the and or of to in on for with by at from is are be this that it as our your we you their its into about".split())


def _title(text, limit=60):
    t = re.sub(r"\s+", " ", (text or "").strip()).strip(" .:")
    if not t:
        return "Your Presentation"
    t = t[0].upper() + t[1:]
    return t if len(t) <= limit else t[:limit].rsplit(" ", 1)[0] + "…"


def _keywords(text, n=6):
    words = [w.strip(".,:;!?()\"'").lower() for w in (text or "").split()]
    seen, out = set(), []
    for w in words:
        if len(w) > 3 and w not in STOP and w not in seen:
            seen.add(w)
            out.append(w)
    return out[:n]


def _sentences(text):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", text or "") if len(s.strip()) > 3]


# ─────────────────────────── element builders ───────────────────────────

def _text(x, y, w, h, text, size, color, font="Inter", weight=600, align="left", anim="fade", delay=0.0, **extra):
    el = {"type": "text", "x": x, "y": y, "w": w, "h": h, "text": text, "font": font, "size": size,
          "weight": weight, "color": color, "align": align, "lh": 1.12 if size >= 40 else 1.35,
          "anim": anim, "animDelay": round(delay, 2)}
    el.update(extra)
    return el


def _shape(kind, x, y, w, h, fill, anim="fade", delay=0.0, **extra):
    el = {"type": kind, "x": x, "y": y, "w": w, "h": h, "fill": fill, "anim": anim, "animDelay": round(delay, 2)}
    el.update(extra)
    return el


def _bg_css(pal, angle=135):
    return f"linear-gradient({angle}deg,{pal[0]},{pal[1]})"


def _colors(pal):
    dark_bg = _lum(pal[0]) < 0.45
    return {"bg": pal[0], "bg2": pal[1], "a": pal[2], "b": pal[3],
            "fg": "#f8fafc" if dark_bg else "#14121a",
            "muted": "rgba(248,250,252,.72)" if dark_bg else "rgba(20,18,26,.66)"}


# Slide layouts. Each takes (content dict, colors, rng) → slide dict.

def lay_title(c, k, r):
    return {"bg": f"radial-gradient(90% 90% at 85% 15%,{k['bg2']} 0%,transparent 60%),{_bg_css([k['bg'], k['bg2']])}",
            "bgFx": "drift", "transition": "fade",
            "els": [
                _shape("ellipse", 600, -140, 520, 520, _rgba(k["a"], .22), "zoom"),
                _shape("ellipse", 760, 330, 260, 260, _rgba(k["b"], .18), "zoom", .1),
                _text(64, 92, 520, 28, (c.get("kicker") or "PRESENTATION").upper(), 15, k["a"], weight=800, ls=4, delay=.1),
                _text(60, 140, 760, 220, c["title"], 76, k["fg"], "Fraunces Editorial", 800, anim="rise", delay=.25),
                _shape("line", 64, 380, 120, 5, k["a"], "reveal", .45),
                _text(64, 402, 700, 70, c.get("subtitle", ""), 24, k["muted"], weight=500, delay=.6),
            ]}


def lay_agenda(c, k, r):
    items = c.get("items") or ["Context", "Challenge", "Approach", "Next steps"]
    els = [_text(64, 56, 600, 70, c.get("title", "What we'll cover"), 48, k["fg"], "Fraunces Editorial", 800, anim="rise")]
    for i, it in enumerate(items[:5]):
        y = 150 + i * 72
        els += [
            _shape("ellipse", 64, y, 46, 46, k["a"], "pop", .2 + i * .12),
            _text(64, y + 8, 46, 32, str(i + 1), 20, k["bg"], weight=900, align="center", anim="pop", delay=.2 + i * .12),
            _text(130, y + 6, 700, 40, it, 26, k["fg"], weight=600, anim="left", delay=.25 + i * .12),
        ]
    return {"bg": k["bg"], "transition": "slide", "els": els}


def lay_split(c, k, r):
    pts = c.get("points") or ["Add your first key point", "Add your second key point", "Add your third key point"]
    els = [_shape("rect", 0, 0, 360, H, k["a"], "left", radius=0),
           _text(40, 70, 290, 260, c["title"], 46, k["bg"] if _lum(k["a"]) > .5 else "#ffffff", "Fraunces Editorial", 800, anim="rise", delay=.15)]
    for i, p in enumerate(pts[:4]):
        y = 90 + i * 100
        els += [_shape("line", 410, y + 12, 34, 4, k["a"], "reveal", .3 + i * .15),
                _text(460, y, 440, 80, p, 22, k["fg"], weight=500, anim="fade", delay=.32 + i * .15)]
    return {"bg": k["bg"], "transition": "push", "els": els}


def lay_bignumber(c, k, r):
    return {"bg": _bg_css([k["bg"], k["bg2"]], 160), "bgFx": "stars" if _lum(k["bg"]) < .3 else "none", "transition": "zoom",
            "els": [_text(80, 110, 800, 200, c.get("number", "3×"), 168, k["a"], "Archivo Expanded", 900, "center", "pop"),
                    _text(80, 330, 800, 60, c["title"], 32, k["fg"], weight=600, align="center", anim="rise", delay=.3),
                    _text(160, 392, 640, 60, c.get("subtitle", "Replace with your own figure and what it means."), 18, k["muted"], weight=500, align="center", delay=.5)]}


def lay_timeline(c, k, r):
    steps = c.get("items") or ["Plan", "Pilot", "Scale", "Sustain"]
    els = [_text(64, 50, 830, 70, c["title"], 44, k["fg"], "Fraunces Editorial", 800, anim="rise"),
           _shape("line", 90, 300, 780, 4, _rgba(k["a"], .6), "reveal", .2)]
    n = min(5, len(steps))
    for i, s in enumerate(steps[:n]):
        x = 90 + i * (780 / max(1, n - 1)) if n > 1 else 480
        els += [_shape("ellipse", x - 18, 284, 36, 36, k["a"], "pop", .35 + i * .18),
                _text(x - 90, 336, 180, 70, s, 20, k["fg"], weight=700, align="center", anim="rise", delay=.4 + i * .18),
                _text(x - 90, 240, 180, 30, f"Step {i + 1}", 14, k["muted"], weight=700, align="center", delay=.4 + i * .18)]
    return {"bg": k["bg"], "transition": "slide", "els": els}


def lay_compare(c, k, r):
    a, b = (c.get("items") or ["Before", "After"])[:2] if len(c.get("items") or []) >= 2 else ("Before", "After")
    els = [_text(64, 44, 830, 70, c["title"], 42, k["fg"], "Fraunces Editorial", 800, anim="rise")]
    for i, (lab, col) in enumerate(((a, _rgba(k["fg"], .08)), (b, _rgba(k["a"], .18)))):
        x = 64 + i * 424
        els += [_shape("rect", x, 140, 400, 340, col, "rise", .2 + i * .2, radius=24),
                _text(x + 28, 168, 340, 50, lab, 30, k["a"] if i else k["fg"], weight=800, anim="fade", delay=.3 + i * .2),
                _text(x + 28, 230, 340, 200, "• Add a point\n• Add a point\n• Add a point", 20, k["fg"], weight=500, delay=.4 + i * .2)]
    return {"bg": k["bg"], "transition": "push", "els": els}


def lay_quote(c, k, r):
    return {"bg": _bg_css([k["bg2"], k["bg"]], 200), "transition": "fade",
            "els": [_text(80, 40, 200, 160, "“", 200, _rgba(k["a"], .5), "Playfair Display", 900, anim="zoom"),
                    _text(120, 150, 720, 220, c.get("quote") or c["title"], 40, k["fg"], "Playfair Display", 600, italic=True, anim="typewriter", delay=.2),
                    _text(120, 400, 720, 40, "— " + (c.get("author") or "Add the source"), 20, k["a"], weight=700, delay=.9)]}


def lay_chart(c, k, r):
    labels = c.get("items") or ["2023", "2024", "2025", "2026"]
    vals = sorted(r.randint(20, 95) for _ in labels[:5])
    return {"bg": k["bg"], "transition": "zoom",
            "els": [_text(64, 44, 830, 60, c["title"], 40, k["fg"], "Fraunces Editorial", 800, anim="rise"),
                    {"type": "chart", "x": 80, "y": 130, "w": 800, "h": 340, "chartKind": "bar", "title": "Example data — replace with yours",
                     "chartData": [{"label": str(l)[:20], "value": v} for l, v in zip(labels[:5], vals)],
                     "accent": k["a"], "palette": [k["a"], k["b"]], "chartThemeMode": "dark" if _lum(k["bg"]) < .45 else "light",
                     "anim": "rise", "animDelay": .3}]}


def lay_closing(c, k, r):
    return {"bg": f"radial-gradient(70% 80% at 50% 110%,{k['a']} 0%,transparent 60%),{_bg_css([k['bg'], k['bg2']])}",
            "bgFx": "confetti", "transition": "curtain",
            "els": [_text(80, 150, 800, 120, c.get("title") or "Thank you", 84, k["fg"], "Fraunces Editorial", 800, "center", "pop"),
                    _text(80, 290, 800, 50, c.get("subtitle") or "Questions & discussion", 28, k["a"], weight=700, align="center", anim="rise", delay=.35)]}


LAYOUTS = {"title": lay_title, "agenda": lay_agenda, "split": lay_split, "bignumber": lay_bignumber,
           "timeline": lay_timeline, "compare": lay_compare, "quote": lay_quote, "chart": lay_chart, "closing": lay_closing}

NOTE = "Made by Hanns' built-in designer while the AI was unavailable — replace the placeholder text with your own."


def _with_note(slide, extra=""):
    slide["notes"] = (extra + " " if extra else "") + NOTE
    return slide


# ─────────────────────────── actions ───────────────────────────

def fb_deck(p):
    topic = str(p.get("prompt") or "").strip()
    n = max(3, min(12, int(p.get("count") or 6)))
    tone = str(p.get("tone") or "bold")
    pal = mood_palette(topic, tone)
    k = _colors(pal)
    r = _rng("deck", topic)
    title = _title(_sentences(topic)[0] if _sentences(topic) else topic)
    kw = [w.title() for w in _keywords(topic, 8)] or ["Context", "Challenge", "Approach", "Impact"]
    sections = ["Why this matters", "The challenge", "Our approach", "Key results", "What's next", "How you can help",
                "Lessons learned", "The plan", "Risks & mitigations", "Timeline"]
    plan = ["title", "agenda"]
    middle = ["split", "bignumber", "timeline", "chart", "compare", "quote", "split"]
    i = 0
    while len(plan) < n - 1:
        plan.append(middle[i % len(middle)])
        i += 1
    plan = plan[:n - 1] + ["closing"]
    plan = plan[:n]
    agenda = sections[:4]
    slides = []
    for j, lay in enumerate(plan):
        sec = sections[(j - 2) % len(sections)] if j >= 2 else ""
        c = {"title": title if lay == "title" else (sec or title), "kicker": " · ".join(kw[:2]),
             "subtitle": str(p.get("audience") or "").strip() and f"For {p.get('audience')}" or "Add a one-line summary",
             "items": agenda if lay in ("agenda",) else (["Plan", "Pilot", "Scale", "Sustain"] if lay == "timeline" else kw[:4]),
             "points": [f"Add a key point about {w.lower()}" for w in (kw[j % len(kw):] + kw)[:3]]}
        if lay == "agenda":
            c["title"] = "What we'll cover"
        slides.append(_with_note(LAYOUTS[lay](c, k, r), f"Slide {j + 1}: {c['title']}."))
    return {"theme": {"name": "Built-in · " + tone.title(), "palette": pal, "headFont": "Fraunces Editorial", "bodyFont": "Inter"},
            "slides": slides}


def fb_slide(p):
    want = str(p.get("prompt") or "")
    w = want.lower()
    lay = ("bignumber" if re.search(r"number|stat|figure|percent|%|\d", w) else
           "timeline" if re.search(r"timeline|step|phase|roadmap|process|journey", w) else
           "compare" if re.search(r"compar|versus|\bvs\b|before|after|pros|cons", w) else
           "quote" if re.search(r"quote|testimon|said", w) else
           "closing" if re.search(r"thank|closing|call to action|cta|question", w) else
           "chart" if re.search(r"chart|graph|data|trend", w) else
           "title" if re.search(r"title|cover|opening|intro", w) else "split")
    pal = mood_palette(want, str(p.get("tone") or "bold"))
    k = _colors(pal)
    quoted = re.findall(r"[\"“']([^\"”']{3,80})[\"”']", want)
    title = _title(quoted[0] if quoted else (_sentences(want)[0] if _sentences(want) else want), 70)
    num = re.findall(r"\d[\d,.]*\s*%?|\d+×", want)
    c = {"title": title, "kicker": "", "subtitle": "Add a one-line summary",
         "items": [x.title() for x in _keywords(want, 4)] or None,
         "number": num[0] if num else "3×", "quote": quoted[0] if quoted else None,
         "points": None}
    return {"slide": _with_note(LAYOUTS[lay](c, k, _rng("slide", want)))}


# ── procedural SVG backgrounds ──

def _svg(inner, defs=""):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">'
            f"<defs>{defs}</defs>{inner}</svg>")


def _grad(id_, c1, c2, x2=1, y2=1):
    return f'<linearGradient id="{id_}" x1="0" y1="0" x2="{x2}" y2="{y2}"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient>'


def art(style, pal, r, calm=False):
    s = (style or "").lower()
    c0, c1, c2, c3, c4 = pal
    base = f'<rect width="1600" height="900" fill="url(#bg)"/>'
    defs = _grad("bg", c0, c1) + '<filter id="blur"><feGaussianBlur stdDeviation="70"/></filter>' + \
        '<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .06 0"/></filter>'
    o = .45 if calm else 1.0
    inner = base
    if "wave" in s or "liquid" in s:
        for i in range(5):
            y = 520 + i * 70 + r.randint(-20, 20)
            a = r.randint(60, 140)
            col = [c2, c3, c1, c2, c0][i % 5]
            inner += (f'<path d="M0 {y} C400 {y - a} 600 {y + a} 1000 {y} S1400 {y - a} 1600 {y} V900 H0Z" '
                      f'fill="{col}" opacity="{round((.25 + i * .12) * o, 2)}"/>')
    elif "geometric" in s or "bauhaus" in s:
        for _ in range(16 if not calm else 8):
            x, y, sz = r.randint(0, 1600), r.randint(0, 900), r.randint(80, 320)
            col = r.choice([c2, c3, c4])
            shape = r.choice(["tri", "circ", "rect"])
            op = round(r.uniform(.08, .35) * o, 2)
            if shape == "tri":
                inner += f'<polygon points="{x},{y} {x + sz},{y} {x + sz / 2},{y - sz * .87}" fill="{col}" opacity="{op}"/>'
            elif shape == "circ":
                inner += f'<circle cx="{x}" cy="{y}" r="{sz / 2}" fill="{col}" opacity="{op}"/>'
            else:
                inner += f'<rect x="{x}" y="{y}" width="{sz}" height="{sz * .6}" fill="{col}" opacity="{op}" transform="rotate({r.randint(-30, 30)} {x} {y})"/>'
    elif "topo" in s or "contour" in s:
        cx, cy = r.randint(900, 1400), r.randint(200, 600)
        for i in range(14):
            rad = 60 + i * 55
            pts = []
            for a in range(0, 361, 15):
                rr = rad * (1 + .12 * math.sin(math.radians(a * 3 + i * 20)))
                pts.append(f"{cx + rr * math.cos(math.radians(a)):.0f},{cy + rr * math.sin(math.radians(a)):.0f}")
            inner += f'<polygon points="{" ".join(pts)}" fill="none" stroke="{c3}" stroke-opacity="{round(.35 * o, 2)}" stroke-width="2"/>'
    elif "bokeh" in s or "night" in s:
        for _ in range(26 if not calm else 12):
            inner += (f'<circle cx="{r.randint(0, 1600)}" cy="{r.randint(0, 900)}" r="{r.randint(20, 110)}" '
                      f'fill="{r.choice([c2, c3, c4])}" opacity="{round(r.uniform(.06, .3) * o, 2)}" filter="url(#blur)"/>')
    elif "kente" in s or "mud" in s or "pattern" in s:
        cols = [c2, c3, "#16a34a", "#111111", c4]
        for i in range(0, 1600, 80):
            col = cols[(i // 80) % len(cols)]
            inner += f'<rect x="{i}" y="0" width="40" height="900" fill="{col}" opacity="{round(.5 * o, 2)}"/>'
            for j in range(0, 900, 60):
                if (i // 80 + j // 60) % 3 == 0:
                    inner += f'<rect x="{i}" y="{j}" width="80" height="24" fill="{cols[(j // 60) % len(cols)]}" opacity="{round(.55 * o, 2)}"/>'
        inner += f'<rect width="1600" height="900" fill="{c0}" opacity="{.55 if calm else .3}"/>'
    elif "cosmic" in s or "nebula" in s or "space" in s:
        defs += f'<radialGradient id="neb" cx=".7" cy=".3" r=".6"><stop offset="0" stop-color="{c2}" stop-opacity=".8"/><stop offset="1" stop-color="{c2}" stop-opacity="0"/></radialGradient>'
        inner += f'<rect width="1600" height="900" fill="url(#neb)" opacity="{o}"/>'
        for _ in range(120):
            inner += f'<circle cx="{r.randint(0, 1600)}" cy="{r.randint(0, 900)}" r="{r.choice([1, 1, 1.5, 2, 3])}" fill="#fff" opacity="{round(r.uniform(.3, .9), 2)}"/>'
        inner += f'<circle cx="{r.randint(150, 450)}" cy="{r.randint(550, 800)}" r="{r.randint(60, 120)}" fill="{c3}" opacity="{round(.5 * o, 2)}"/>'
    elif "paper" in s or "nature" in s or "leaf" in s:
        for i in range(5):
            y = 380 + i * 95
            col = [c1, c2, c3, c2, c0][i]
            inner += (f'<path d="M0 {y} Q400 {y - 120 + r.randint(-30, 30)} 800 {y} T1600 {y} V900 H0Z" fill="{col}" '
                      f'opacity="{round(.55 + i * .08, 2)}" style="filter:drop-shadow(0 -6px 10px rgba(0,0,0,.25))"/>')
    elif "neon" in s or "tech" in s or "circuit" in s or "grid" in s:
        for x in range(0, 1601, 80):
            inner += f'<line x1="{x}" y1="0" x2="{x}" y2="900" stroke="{c2}" stroke-opacity="{round(.12 * o, 2)}"/>'
        for y in range(0, 901, 80):
            inner += f'<line x1="0" y1="{y}" x2="1600" y2="{y}" stroke="{c2}" stroke-opacity="{round(.12 * o, 2)}"/>'
        for _ in range(9):
            x, y = r.randrange(0, 1600, 80), r.randrange(0, 900, 80)
            inner += (f'<path d="M{x} {y} h{r.choice([160, 240, 320])} v{r.choice([-160, 80, 160])}" fill="none" stroke="{c3}" '
                      f'stroke-width="3" stroke-opacity="{round(.7 * o, 2)}"/><circle cx="{x}" cy="{y}" r="7" fill="{c3}"/>')
        inner += f'<circle cx="1250" cy="200" r="260" fill="{c2}" opacity="{round(.3 * o, 2)}" filter="url(#blur)"/>'
    elif "minimal" in s or "grain" in s:
        inner += f'<circle cx="1300" cy="150" r="420" fill="{c2}" opacity="{round(.25 * o, 2)}" filter="url(#blur)"/>'
        inner += '<rect width="1600" height="900" filter="url(#grain)"/>'
    else:  # aurora / auto
        for _ in range(6 if not calm else 4):
            inner += (f'<ellipse cx="{r.randint(0, 1600)}" cy="{r.randint(0, 900)}" rx="{r.randint(250, 520)}" ry="{r.randint(160, 360)}" '
                      f'fill="{r.choice([c2, c3, c1])}" opacity="{round(r.uniform(.35, .7) * o, 2)}" filter="url(#blur)"/>')
        inner += '<rect width="1600" height="900" filter="url(#grain)"/>'
    return _svg(inner, defs)


STYLE_NAMES = {"wave": "Flow", "geometric": "Bauhaus", "topo": "Contours", "bokeh": "Night lights", "kente": "Kente",
               "cosmic": "Nebula", "paper": "Paper hills", "neon": "Circuit", "minimal": "Quiet grain"}


def fb_background(p, deck_code, sanitize, save):
    mood = str(p.get("prompt") or "")
    style = str(p.get("style") or "auto")
    if style == "auto":
        style = random.choice(["aurora", "waves", "geometric", "topographic", "bokeh night", "cosmic", "paper nature", "neon tech"])
    pal = mood_palette(mood + " " + style + " " + str(p.get("outline") or "")[:300])
    r = _rng("bg", mood, style)
    name = next((v for k2, v in STYLE_NAMES.items() if k2 in style.lower()), "Aurora")
    out = []
    for i, (role, calm) in enumerate((("Title", False), ("Content", True), ("Closing", False))):
        variant_pal = pal if i != 2 else [pal[1], pal[0], pal[3], pal[2], pal[4]]
        svg = sanitize(art(style, variant_pal, r, calm=calm))
        url = save(deck_code, svg)
        grad = f"linear-gradient(135deg,{variant_pal[0]},{variant_pal[1]})"
        text = "#f8fafc" if _lum(variant_pal[0]) < .45 else "#14121a"
        out.append({"name": f"{name} · {role}", "url": url, "bg": f'url("{url}") center / cover no-repeat, {grad}',
                    "palette": variant_pal[:4], "bgFx": "none", "text": text})
    return {"variants": out, "textTone": "light" if _lum(pal[0]) < .45 else "dark"}


# ── slide-level actions ──

def _slides_in(p):
    for s in (p.get("slides") or []):           # every slide sent — no silent cut-off
        yield int(s.get("index", 0)), (s.get("slide") or s)


def fb_polish(p):
    out = []
    for idx, slide in _slides_in(p):
        els = [e for e in (slide.get("els") or []) if isinstance(e, dict) and e.get("id")]
        texts = sorted([e for e in els if e.get("type") == "text"], key=lambda e: -(e.get("size") or 0))
        patches = []
        for e in els:
            pch = {"id": e["id"]}
            x, y = float(e.get("x") or 0), float(e.get("y") or 0)
            w, h = float(e.get("w") or 100), float(e.get("h") or 40)
            # keep everything on canvas
            x = min(max(x, -w * .25), W - min(w, W) * .75)
            y = min(max(y, -h * .25), H - min(h, H) * .75)
            if e.get("type") == "text":
                if x < 140:
                    x = 64                       # one clean left margin
                x = round(x / 8) * 8
                y = round(y / 8) * 8
            pch.update(x=x, y=y)
            patches.append(pch)
        # type hierarchy: biggest text is the headline, the rest readable body
        for i, e in enumerate(texts):
            pch = next(q for q in patches if q["id"] == e["id"])
            size = float(e.get("size") or 24)
            if i == 0:
                pch.update(size=max(size, 44), weight=max(int(e.get("weight") or 700), 700), font="Fraunces Editorial")
            else:
                pch.update(size=min(max(size, 18), 34), font="Inter", lh=1.35)
        out.append({"index": idx, "els": patches})
    return {"slides": out, "fixText": False}


DECOR = {
    "minimal": lambda a: [_shape("line", 64, 486, 140, 4, a, "reveal"), _shape("line", 756, 52, 140, 4, a, "reveal", .1)],
    "geometric": lambda a: [_shape("rect", 820, -60, 220, 220, _rgba(a, .18), "zoom", rot=20, radius=12),
                            _shape("ellipse", -70, 400, 200, 200, _rgba(a, .15), "zoom", .1)],
    "organic": lambda a: [{"type": "freeform", "shapeKind": "blob", "x": 760, "y": -80, "w": 320, "h": 300, "fill": _rgba(a, .18), "smooth": True, "anim": "float"},
                          {"type": "freeform", "shapeKind": "blob", "x": -90, "y": 380, "w": 260, "h": 240, "fill": _rgba(a, .12), "smooth": True, "anim": "float", "animDelay": .2}],
    "tech": lambda a: [_shape("rect", 40, 40, 880, 460, "none", "fade", stroke=_rgba(a, .5), strokeW=1, radius=4),
                       _shape("line", 40, 40, 80, 3, a, "reveal"), _shape("line", 840, 497, 80, 3, a, "reveal", .1)],
    "festive": lambda a: [{"type": "freeform", "shapeKind": "star", "x": 860, "y": 30, "w": 70, "h": 70, "fill": a, "anim": "spin"},
                          {"type": "freeform", "shapeKind": "burst", "x": 30, "y": 440, "w": 80, "h": 80, "fill": _rgba(a, .6), "anim": "pop", "animDelay": .2}],
    "kente": lambda a: [_shape("rect", 0, 0, W, 14, a, "left", radius=0), _shape("rect", 0, 14, W, 6, "#16a34a", "left", .05, radius=0),
                        _shape("rect", 0, H - 20, W, 6, "#111111", "right", radius=0), _shape("rect", 0, H - 14, W, 14, a, "right", .05, radius=0)],
}


def fb_decorate(p):
    style = str(p.get("style") or p.get("prompt") or "minimal").lower()
    key = next((k for k in DECOR if k in style), "minimal")
    if "blob" in style:
        key = "organic"
    if "hud" in style:
        key = "tech"
    out = []
    for idx, slide in _slides_in(p):
        # Accent = the most colourful text colour on the slide (not black/white).
        accent = next((e.get("color") for e in slide.get("els") or [] if e.get("type") == "text"
                       and re.match(r"^#[0-9a-fA-F]{6}$", str(e.get("color", "")))
                       and 0.08 < _lum(e["color"]) < 0.85), None) or "#e8482b"
        out.append({"index": idx, "add": DECOR[key](accent)})
    return {"slides": out}


TRANS_CYCLE = ["fade", "slide", "push", "zoom", "reveal", "wind", "fold", "swipe"]


def fb_animate(p):
    energy = str(p.get("style") or "cinematic")
    step = {"subtle": .1, "energetic": .12}.get(energy, .18)
    out = []
    for n, (idx, slide) in enumerate(_slides_in(p)):
        els = [e for e in (slide.get("els") or []) if isinstance(e, dict) and e.get("id")]
        shapes = [e for e in els if e.get("type") not in ("text", "chart", "image")]
        texts = sorted([e for e in els if e.get("type") == "text"], key=lambda e: (float(e.get("y") or 0), -(e.get("size") or 0)))
        rest = [e for e in els if e.get("type") in ("chart", "image")]
        patches, t = [], 0.0
        for e in shapes:
            patches.append({"id": e["id"], "anim": "fade" if energy == "subtle" else "zoom", "animDelay": round(t, 2)})
        t = .15 if shapes else 0
        for i, e in enumerate(texts):
            big = (e.get("size") or 0) >= 40
            anim = ("fade" if energy == "subtle" else
                    ("rise" if big else "fade") if energy == "cinematic" else ("pop" if big else "left"))
            if re.search(r"\d{2,}|%", str(e.get("text") or "")) and (e.get("size") or 0) >= 60:
                anim = "pop"
            patches.append({"id": e["id"], "anim": anim, "animDelay": round(t, 2)})
            t += step
        for e in rest:
            patches.append({"id": e["id"], "anim": "zoom" if energy != "subtle" else "fade", "animDelay": round(t, 2)})
            t += step
        trans = TRANS_CYCLE[n % len(TRANS_CYCLE)] if energy != "subtle" else "fade"
        out.append({"index": idx, "transition": trans, "els": patches})
    return {"slides": out}


def fb_ideas(p):
    outline = str(p.get("outline") or "")
    lines = [l for l in outline.splitlines() if l.strip()]
    first = re.sub(r"^\d+\.\s*", "", lines[0]).split("|")[0].strip() if lines else "Your presentation"
    has_num = bool(re.search(r"\d{2,}|%", outline))
    ideas = [
        {"title": "Open with a question", "why": "A question in the first minute makes the audience lean in.",
         "prompt": f"A bold opening slide asking the audience a question about {first}", "position": "after slide 1"},
        {"title": "One big number", "why": "A single striking figure is remembered long after bullet points are forgotten.",
         "prompt": f"A big number slide with the most important statistic about {first}", "position": "after slide 2"},
        {"title": "Show the journey", "why": "A timeline turns a list of activities into a story with momentum.",
         "prompt": f"A 4-step timeline slide showing how {first} moves from plan to impact", "position": "end"},
        {"title": "Before vs after", "why": "Contrast makes the change you're proposing obvious at a glance.",
         "prompt": f"A before vs after comparison slide for {first}", "position": "end"},
        {"title": "A clear call to action", "why": "End by telling people exactly what you want them to do next.",
         "prompt": f"A powerful closing slide with a call to action for {first}", "position": "end"},
    ]
    tips = ["Keep one idea per slide — split any slide with more than ~40 words.",
            "Put your strongest visual on the first content slide.",
            "Use the same two fonts and one accent colour across the whole deck."]
    if not has_num:
        tips.insert(0, "Add at least one concrete number — evidence makes the story credible.")
    return {"verdict": f"Built-in review (AI unavailable): {len(lines) or 0} slides — here's how to make “{first[:50]}” land harder.",
            "ideas": ideas, "headlines": [_title(first, 70), _title(first, 40) + ": What Comes Next", "Why " + _title(first, 50) + " Matters"],
            "tips": tips[:4]}


def fb_notes(p):
    out = []
    for idx, slide in _slides_in(p):
        texts = sorted([e for e in (slide.get("els") or []) if e.get("type") == "text" and e.get("text")],
                       key=lambda e: -(e.get("size") or 0))
        head = re.sub(r"\s+", " ", str(texts[0]["text"])).strip() if texts else f"slide {idx + 1}"
        body = " ".join(re.sub(r"\s+", " ", str(t["text"])) for t in texts[1:3])
        note = f"This slide is about {head.rstrip('.')}. "
        if body:
            note += f"The key point here: {body[:220].rstrip('.')}. "
        note += "[pause] Give one real example from your own work, then link it to the next slide."
        out.append({"index": idx, "notes": note})
    return {"slides": out}


FILLER = r"\b(very|really|just|actually|basically|quite|that|in order|kind of|sort of|simply)\b\s*"
SIMPLE = {"utilize": "use", "approximately": "about", "commence": "start", "facilitate": "help", "implement": "do",
          "demonstrate": "show", "sufficient": "enough", "assistance": "help", "objective": "goal", "subsequently": "then"}
FORMAL = {"can't": "cannot", "won't": "will not", "don't": "do not", "it's": "it is", "we're": "we are", "let's": "let us",
          "kids": "children", "get": "obtain", "a lot of": "many", "big": "significant"}


def _sub_words(text, table):
    for a, b in table.items():
        text = re.sub(rf"\b{re.escape(a)}\b", b, text, flags=re.I)
    return text


def fb_rewrite(p):
    text = str(p.get("text") or "").strip()
    how = str(p.get("style") or "").lower()
    if not text:
        return {"options": []}
    sents = _sentences(text) or [text]
    shorter = sents[0] if len(sents) > 1 else " ".join(text.split()[: max(4, len(text.split()) * 2 // 3)])
    punchy = re.sub(FILLER, "", text, flags=re.I).strip()
    punchy = re.sub(r"\s+", " ", punchy)
    simpler = _sub_words(text, SIMPLE)
    formal = _sub_words(text, FORMAL)
    story = "Imagine this: " + text[0].lower() + text[1:] if len(text) > 1 else text
    if "translat" in how:
        return {"options": [text], "notice": "Translation needs the AI — it will work again once Gemini is available."}
    if "short" in how:
        opts = [shorter, punchy, " ".join(shorter.split()[:8])]
    elif "simple" in how:
        opts = [simpler, shorter, punchy]
    elif "formal" in how:
        opts = [formal, _sub_words(simpler, FORMAL), shorter]
    elif "stor" in how:
        opts = [story, "Here's what happened: " + text, "Picture this — " + shorter]
    else:
        opts = [punchy, shorter, punchy.rstrip(".") + "."]
    seen, uniq = set(), []
    for o in opts:
        o = o.strip()
        if o and o not in seen:
            seen.add(o)
            uniq.append(o)
    return {"options": uniq[:3]}


# ── custom instruction / highlighted area ──

def fb_edit(p):
    from .ai import AIError
    raise AIError("Custom instructions need the AI, which isn't available right now — "
                  "try again in a little while, or use Polish / Decorate / Animate.", status=503)


def _slide_style(slide):
    """Borrow the slide's own font and colours so the addition fits in."""
    texts = [e for e in (slide or {}).get("els") or [] if isinstance(e, dict) and e.get("type") == "text"]
    body = min(texts, key=lambda e: e.get("size") or 99, default={}) if texts else {}
    head = max(texts, key=lambda e: e.get("size") or 0, default={}) if texts else {}
    return {"font": body.get("font") or "Archivo", "color": body.get("color") or "#16140f",
            "head": head.get("font") or body.get("font") or "Archivo", "accent": head.get("color") or "#e8482b"}


def fb_region(p, deck_code, sanitize, save):
    want = str(p.get("prompt") or "").strip()
    r = p.get("region") or {}
    x, y, w, h = (int(float(r.get(k, d))) for k, d in (("x", 100), ("y", 100), ("w", 300), ("h", 200)))
    st = _slide_style(p.get("slide"))
    low = want.lower()
    mode = p.get("mode")
    words = re.findall(r"[A-Za-z][A-Za-z'-]+", want)
    if mode == "illustration" or (mode != "design" and re.search(r"\b(picture|illustrat|drawing|draw|image|icon|scene|art)\w*", low)):
        style = random.choice(["aurora", "waves", "geometric", "bokeh night", "paper nature"])
        pal = mood_palette(want + " " + style)
        svg = art(style, pal, _rng("region", want), calm=False)
        # stretch the 1600x900 art to the area's proportions
        svg = re.sub(r'\s+preserveAspectRatio="[^"]*"', "", svg, count=1)
        svg = re.sub(r'viewBox="[^"]*"', 'viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"', svg, count=1)
        url = save(deck_code, sanitize(svg))
        return {"els": [], "image": {"url": url, "alt": want[:160], "x": x, "y": y, "w": w, "h": h},
                "caption": "abstract artwork", "region": {"x": x, "y": y, "w": w, "h": h},
                "notice": "Drawn by the built-in designer (abstract art)."}
    els = []
    big_number = re.search(r"big number|kpi|metric|headline number|one number", low) or \
        (len(re.findall(r"\d[\d.,%+]*", want)) == 1 and not re.search(r"chart|graph|trend|by (month|year|quarter)", low))
    if big_number:
        num = (re.findall(r"\d[\d.,%+]*", want) or ["100%"])[0]
        label = re.sub(r"big number:?|kpi:?|\d[\d.,%+]*", "", want, flags=re.I).strip(" :-") [:60] or "and growing"
        els += [{"type": "text", "text": num, "x": x, "y": y, "w": w, "h": int(h * 0.62), "align": "center",
                 "font": st["head"], "size": max(28, min(150, int(h * 0.48))), "weight": 900, "color": st["accent"], "anim": "pop"},
                {"type": "text", "text": label, "x": x, "y": y + int(h * 0.64), "w": w, "h": int(h * 0.34), "align": "center",
                 "font": st["font"], "size": max(14, min(30, int(h * 0.12))), "color": st["color"], "anim": "fade", "animDelay": 0.2}]
    elif re.search(r"chart|graph|trend|growth|percent|%|data|numbers|sales|stat", low):
        labels = [w_.capitalize() for w_ in words if len(w_) > 3][:4] or ["Q1", "Q2", "Q3", "Q4"]
        while len(labels) < 4:
            labels.append(f"Item {len(labels) + 1}")
        vals = [round(30 + 60 * abs(math.sin(i * 1.7 + len(want)))) for i in range(len(labels))]
        els.append({"type": "chart", "chartKind": "bar", "x": x, "y": y, "w": w, "h": h, "title": want[:60],
                    "chartData": [{"label": l, "value": v} for l, v in zip(labels, vals)], "accent": st["accent"],
                    "anim": "rise"})
    elif re.search(r"bullet|list|points|steps|tips|reasons", low):
        lines = [s_.strip(" -•") for s_ in re.split(r"[,;\n]| and ", want) if len(s_.strip()) > 2][:5] or [want]
        size = max(14, min(30, int(h / (len(lines) * 1.9 + 1))))
        els.append({"type": "text", "text": "\n".join("• " + l_[:70] for l_ in lines), "x": x + 8, "y": y + 8,
                    "w": w - 16, "h": h - 16, "font": st["font"], "size": size, "color": st["color"], "lh": 1.5,
                    "anim": "rise"})
    else:
        els += [{"type": "rect", "x": x, "y": y, "w": w, "h": h, "fill": "rgba(255,255,255,0.10)",
                 "stroke": st["accent"], "strokeW": 2, "radius": 18, "anim": "fade"},
                {"type": "text", "text": want[:140], "x": x + 18, "y": y + 16, "w": w - 36, "h": h - 32,
                 "font": st["font"], "size": max(16, min(34, int(h / 4.5))), "color": st["color"], "lh": 1.3,
                 "anim": "rise", "animDelay": 0.15}]
    return {"els": els, "caption": "built-in layout", "region": {"x": x, "y": y, "w": w, "h": h}}


FALLBACKS = {"deck": fb_deck, "slide": fb_slide, "polish": fb_polish, "decorate": fb_decorate,
             "animate": fb_animate, "ideas": fb_ideas, "notes": fb_notes, "rewrite": fb_rewrite,
             "edit": fb_edit}
