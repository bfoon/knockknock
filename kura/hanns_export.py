"""
kura/hanns_export.py — turn survey results into a Hanns deck.

build_results_deck(survey, owner) creates a real hanns.Deck with one slide
per interesting question, using the SAME slide-JSON and element schema the
Hanns editor and live player actually consume, so the deck opens in the
editor and presents live with reactions, phone controller, HTML/PPTX
export — the whole pipeline — for free.

Element schema (must match hanns/onboarding.py and hanns_core.js)
─────────────────────────────────────────────────────────────────
Slide:  {bg, bgSize, bgFx, transition, notes, els:[…]}

text el:  {id,type:"text", x,y,w,h, rot, anim, animDelay,
           text, font, size, weight, italic, color, align, lh, ls, fill}

chart el: {id,type:"chart", x,y,w,h, rot, anim, animDelay,
           chartType:"bar"|"donut"|"line"|"pie",   # editor uses "donut"
           title, accent, showValues, showLabels, showLegend,
           labelSize, gridLines, axisValues, palette,
           chartData:[{label,value}, …], max, decimals, chartThemeMode}

The previous version wrote a *different* schema (fontFamily/fontSize on
text; a nested {"chart":{kind,labels,values}} on charts). The editor reads
`font`/`size` and `chartData`, so every exported chart rendered blank and
text lost its styling. This file now emits the editor's real schema.

The design coordinate space is 960×540 (same as onboarding.py), NOT the
larger canvas the old file assumed — using the wrong space pushed elements
partly or fully off-slide.
"""

from __future__ import annotations

import uuid
from collections import Counter

# ── palette ──────────────────────────────────────────────────────────
BG_TITLE = "linear-gradient(135deg,#050616,#090b23 52%,#160a2c)"
BG_BODY = "#f6f1e7"
INK = "#16140f"
MUTED = "#6b6353"
ACCENTS = ["#e8482b", "#38bdf8", "#22c55e", "#a855f7", "#f59e0b", "#ff3f98"]
CHART_PALETTE = ["#e8482b", "#22c55e", "#38bdf8", "#f59e0b", "#a855f7", "#ff3f98",
                 "#14b8a6", "#eab308", "#6366f1", "#ec4899"]


def _eid():
    return "kura_" + uuid.uuid4().hex[:8]


# ── element builders (editor schema) ─────────────────────────────────

def _text(text, x, y, w, h, *, size=32, weight=700, color=INK, align="left",
          font='"Inter",sans-serif', anim="fade", delay=0.0, lh=1.15, italic=False):
    return {
        "id": _eid(), "type": "text",
        "x": x, "y": y, "w": w, "h": h, "rot": 0,
        "anim": anim, "animDelay": delay,
        "text": str(text),
        "font": font, "size": size, "weight": weight, "italic": italic,
        "color": color, "align": align, "lh": lh, "ls": 0, "fill": "none",
    }


def _chart(chart_type, pairs, x, y, w, h, *, accent="#e8482b", title="",
           anim="rise", delay=0.12, max_value=None, show_legend=False):
    """pairs: list of (label, value). Emits the flat chartData schema."""
    data = [{"label": str(l), "value": float(v)} for l, v in pairs]
    values = [d["value"] for d in data] or [0]
    return {
        "id": _eid(), "type": "chart",
        "x": x, "y": y, "w": w, "h": h, "rot": 0,
        "anim": anim, "animDelay": delay,
        "chartType": chart_type,          # "bar" | "donut" | "line"
        "title": title, "accent": accent,
        "showValues": True, "showLabels": True, "showLegend": show_legend,
        "labelSize": 18, "gridLines": True, "axisValues": True,
        "seriesNames": ["Responses"],
        "palette": CHART_PALETTE,
        "valuePrefix": "", "valueSuffix": "", "decimals": 0, "unit": "",
        "max": int(max_value) if max_value else max(1, int(max(values) * 1.15)),
        "titleColor": "", "chartThemeMode": "light",
        "chartData": data,
    }


def _slide(els, *, bg=BG_BODY, bg_size=None, bg_fx="none", transition="fade", notes=""):
    return {
        "bg": bg, "bgSize": bg_size, "bgFx": bg_fx,
        "transition": transition, "notes": notes, "els": els,
    }


# ── stats over submissions ───────────────────────────────────────────

def _clean_subs(survey):
    return list(
        survey.submissions.filter(status__in=["complete", "flagged"])
        .only("answers", "duration_ms", "score")
    )


def _choice_counts(question, subs):
    counts = Counter()
    labels = {str(c.get("value")): c.get("label") or str(c.get("value"))
              for c in (question.get("choices") or [])}
    name = question["name"]
    for s in subs:
        v = (s.answers or {}).get(name)
        if v in (None, "", []):
            continue
        vals = v if isinstance(v, list) else [v]
        for x in vals:
            counts[labels.get(str(x), str(x))] += 1
    return counts


def _numeric_stats(question, subs):
    vals = []
    name = question["name"]
    for s in subs:
        try:
            vals.append(float((s.answers or {}).get(name)))
        except (TypeError, ValueError):
            continue
    if not vals:
        return None
    vals.sort()
    n = len(vals)
    return {
        "n": n,
        "mean": sum(vals) / n,
        "median": vals[n // 2],
        "min": vals[0],
        "max": vals[-1],
        "values": vals,
    }


def _histogram(vals, bins=8):
    lo, hi = min(vals), max(vals)
    if lo == hi:
        return [(f"{lo:g}", len(vals))]
    width = (hi - lo) / bins
    edges = [lo + i * width for i in range(bins + 1)]
    counts = [0] * bins
    for v in vals:
        i = min(int((v - lo) / width), bins - 1)
        counts[i] += 1
    return [(f"{edges[i]:g}–{edges[i+1]:g}", counts[i]) for i in range(bins)]


# ── deck assembly ────────────────────────────────────────────────────

def build_results_deck(survey, owner):
    """Create and return a hanns.Deck presenting this survey's results."""
    from hanns.models import Deck, Slide  # local import: optional dependency

    subs = _clean_subs(survey)
    schema = (survey.current_version.schema if survey.current_version
              else survey.draft_schema) or {}
    questions = [q for q in (schema.get("questions") or [])
                 if q.get("name") and q.get("type") not in (
                     "section", "photo", "audio", "signature", "repeat")]

    slides = []

    # 1 · Title (960×540 space)
    slides.append(_slide([
        _text("SURVEY RESULTS", 70, 96, 500, 34, size=15, weight=700,
              color="#22d3ee", font='"Spline Sans Mono",monospace'),
        _text(survey.title, 70, 140, 820, 190, size=52, weight=800,
              color="#f8fbff", font='"Fraunces",serif', lh=1.05),
        _text(f"{len(subs)} responses · code {survey.code}",
              70, 340, 760, 40, size=20, weight=600, color="#b9c2e7",
              font='"Spline Sans Mono",monospace'),
    ], bg=BG_TITLE, transition="zoom", notes="Auto-generated by Kura."))

    # 2 · Overview numbers
    durations = [s.duration_ms / 60000 for s in subs if s.duration_ms]
    avg_min = (sum(durations) / len(durations)) if durations else 0
    scores = [s.score for s in subs if s.score is not None]
    stats_bits = [
        ("Responses", f"{len(subs)}"),
        ("Avg time", f"{avg_min:.1f} min" if durations else "—"),
        ("Avg score", f"{(sum(scores)/len(scores)):.1f}" if scores else "—"),
    ]
    els = [_text("At a glance", 70, 54, 600, 60, size=40, weight=800,
                 font='"Fraunces",serif')]
    for i, (label, value) in enumerate(stats_bits):
        x = 70 + i * 285
        els.append(_text(value, x, 170, 250, 92, size=54, weight=800,
                         color=ACCENTS[i % len(ACCENTS)], font='"Fraunces",serif'))
        els.append(_text(label.upper(), x, 268, 250, 30, size=13, weight=700,
                         color=MUTED, font='"Spline Sans Mono",monospace'))
    slides.append(_slide(els, transition="slide"))

    # 3+ · One slide per question
    for qi, q in enumerate(questions):
        name, qtype = q["name"], q.get("type")
        label = q.get("label") or name
        accent = ACCENTS[qi % len(ACCENTS)]
        header = [
            _text(f"Q{qi+1}", 70, 44, 120, 28, size=13, weight=700,
                  color=accent, font='"Spline Sans Mono",monospace'),
            _text(label, 70, 74, 820, 88, size=30, weight=800,
                  font='"Fraunces",serif', lh=1.08),
        ]

        if qtype in ("select_one", "select_multiple", "likert", "rating", "rank"):
            counts = _choice_counts(q, subs)
            if not counts:
                continue
            top = counts.most_common(10)
            chart_type = "donut" if (qtype == "select_one" and len(top) <= 5) else "bar"
            slides.append(_slide(header + [
                _chart(chart_type, top, 70, 178, 820, 320, accent=accent,
                       show_legend=(chart_type == "donut")),
            ], transition="fade",
                notes=f"n = {sum(counts.values())} answers."))

        elif qtype in ("integer", "decimal", "calculate"):
            st = _numeric_stats(q, subs)
            if not st:
                continue
            hist = _histogram(st["values"])
            slides.append(_slide(header + [
                _text(f"mean {st['mean']:.1f} · median {st['median']:g} · "
                      f"range {st['min']:g}–{st['max']:g} · n {st['n']}",
                      70, 150, 820, 26, size=15, weight=600, color=MUTED,
                      font='"Spline Sans Mono",monospace'),
                _chart("bar", hist, 70, 188, 820, 310, accent=accent),
            ], transition="fade"))

        elif qtype in ("text", "long_text"):
            quotes = [str((s.answers or {}).get(name)) for s in subs
                      if (s.answers or {}).get(name)][:3]
            if not quotes:
                continue
            els = list(header)
            for i, quote in enumerate(quotes):
                short = quote if len(quote) <= 140 else quote[:140] + "…"
                els.append(_text(f"“{short}”", 90, 180 + i * 108, 780, 98,
                                 size=20, weight=500, color="#2c281f",
                                 font='"Fraunces",serif', italic=True, lh=1.25))
            slides.append(_slide(els, transition="fade",
                                 notes="Sample of open-text answers."))

    # Closing slide
    slides.append(_slide([
        _text("Thank you", 70, 190, 820, 120, size=62, weight=800,
              color="#f8fbff", font='"Fraunces",serif', align="center"),
        _text("Collected with Kura · presented with Hanns",
              70, 320, 820, 30, size=15, weight=600, color="#b9c2e7",
              align="center", font='"Spline Sans Mono",monospace'),
    ], bg=BG_TITLE, transition="zoom"))

    deck = Deck.objects.create(owner=owner, title=f"{survey.title} — Results")
    Slide.objects.bulk_create([
        Slide(deck=deck, position=pos, data=sdata)
        for pos, sdata in enumerate(slides)
    ])
    return deck
