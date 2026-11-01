"""
kura/agent_story.py — Foon tells the story of a survey as a Hanns deck.

The model writes the STORY — a hook, the insights in a deliberate order, a
human moment, the takeaways, a call to action, and speaker notes — as a list
of scenes. This module does the DATA and the DESIGN:

  * every number and chart is computed here from the real rows (the same
    engines as Foon's charts and cards), so a slide never shows an invented
    figure;
  * charts are NATIVE Hanns chart elements (chartKind + chartData), so they
    stay editable in Hanns and present live;
  * photos come from the survey's gallery — starred first — and are copied
    into the deck's own media folder, as any image dropped into Hanns is;
  * nine scene layouts on Hanns' 960×540 canvas, six themes, staggered
    animations and varied transitions — designed, not templated-looking.

story_spec(ctx, spec)  → normalised scenes + a storyboard preview for the chat
create_deck(ctx, spec) → a real hanns.Deck the user opens in the editor
builtin_story(ctx)     → a good story without the AI
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone

from . import agent_engine as eng

W, H = 960, 540
SCENE_TYPES = ("title", "bignumber", "chart", "photo", "gallery", "compare", "timeline", "takeaways", "closing")
MAX_SCENES = 16

THEMES = {
    "night": {"label": "Night", "bg": "linear-gradient(135deg,#070818 0%,#13163f 58%,#2a0f3d 100%)",
              "ink": "#f6f7ff", "muted": "#b8bfe6", "accent": "#ff8a1f", "accent2": "#22d3ee",
              "soft": "rgba(255,138,31,0.16)", "soft2": "rgba(34,211,238,0.13)", "panel": "rgba(255,255,255,0.07)",
              "dark": True, "palette": ["#ff8a1f", "#22d3ee", "#ff3f98", "#8b5cf6", "#34d399", "#fbbf24"],
              "head": '"Fraunces",serif', "body": '"Archivo",sans-serif', "fx": "stars"},
    "savanna": {"label": "Savanna", "bg": "linear-gradient(140deg,#1f0d05 0%,#5a260c 58%,#a5481b 100%)",
                "ink": "#fff6e8", "muted": "#f1cfa8", "accent": "#ffb703", "accent2": "#8ecae6",
                "soft": "rgba(255,183,3,0.15)", "soft2": "rgba(142,202,230,0.13)", "panel": "rgba(255,255,255,0.08)",
                "dark": True, "palette": ["#ffb703", "#8ecae6", "#fb8500", "#e76f51", "#2a9d8f", "#f4a261"],
                "head": '"Playfair Display",serif', "body": '"Archivo",sans-serif', "fx": "drift"},
    "atlantic": {"label": "Atlantic", "bg": "linear-gradient(135deg,#021526 0%,#063b63 55%,#0a6c8f 100%)",
                 "ink": "#f0fbff", "muted": "#a9d6e5", "accent": "#48cae4", "accent2": "#ffd166",
                 "soft": "rgba(72,202,228,0.16)", "soft2": "rgba(255,209,102,0.13)", "panel": "rgba(255,255,255,0.08)",
                 "dark": True, "palette": ["#48cae4", "#ffd166", "#ef476f", "#06d6a0", "#90e0ef", "#f78c6b"],
                 "head": '"DM Serif Display",serif', "body": '"Archivo",sans-serif', "fx": "waves"},
    "forest": {"label": "Forest", "bg": "linear-gradient(135deg,#06140e 0%,#0e3a27 58%,#1d6142 100%)",
               "ink": "#f0fff6", "muted": "#b9e4c9", "accent": "#a7e163", "accent2": "#f4d35e",
               "soft": "rgba(167,225,99,0.15)", "soft2": "rgba(244,211,94,0.12)", "panel": "rgba(255,255,255,0.08)",
               "dark": True, "palette": ["#a7e163", "#f4d35e", "#56cfe1", "#ff8c61", "#c3a6ff", "#ffffff"],
               "head": '"Fraunces",serif', "body": '"Archivo",sans-serif', "fx": "bokeh"},
    "paper": {"label": "Paper", "bg": "#f6f1e7", "ink": "#16140f", "muted": "#6b6353", "accent": "#e8482b",
              "accent2": "#2a9d8f", "soft": "rgba(232,72,43,0.10)", "soft2": "rgba(42,157,143,0.10)",
              "panel": "rgba(22,20,15,0.05)", "dark": False,
              "palette": ["#e8482b", "#2a9d8f", "#e9c46a", "#264653", "#f4a261", "#8a5cf6"],
              "head": '"Fraunces",serif', "body": '"Archivo",sans-serif', "fx": "none"},
    "sunrise": {"label": "Sunrise", "bg": "linear-gradient(135deg,#fff4e6 0%,#ffe3ec 100%)", "ink": "#2b1b30",
                "muted": "#7a5d73", "accent": "#ff3f98", "accent2": "#ff8a1f", "soft": "rgba(255,63,152,0.12)",
                "soft2": "rgba(255,138,31,0.12)", "panel": "rgba(43,27,48,0.05)", "dark": False,
                "palette": ["#ff3f98", "#ff8a1f", "#7c3aed", "#06b6d4", "#22c55e", "#f59e0b"],
                "head": '"Playfair Display",serif', "body": '"Archivo",sans-serif', "fx": "none"},
}
TRANSITIONS = {"title": "fade", "bignumber": "reveal", "chart": "push", "photo": "zoom", "gallery": "slide",
               "compare": "swipe", "timeline": "wind", "takeaways": "fold", "closing": "dissolve"}
CHART_KIND = {"bar": "bar", "hbar": "bar", "stacked": "bar", "pie": "pie", "donut": "donut", "line": "line",
              "area": "area", "timeseries": "area", "histogram": "bar", "radar": "radar", "polar": "pie"}


def _clip(s, n):
    s = str(s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


# ─────────────────────────────────────────────────────────────────────
#  Hanns element builders (editor schema: hanns_core.js renderChart etc.)
# ─────────────────────────────────────────────────────────────────────

def _id():
    return "foon_" + uuid.uuid4().hex[:10]


def text(t, x, y, w, h, *, size=24, weight=500, color="#fff", font='"Archivo",sans-serif', align="left",
         lh=1.2, anim="fade", delay=0.0, italic=False, ls=0):
    return {"id": _id(), "type": "text", "x": x, "y": y, "w": w, "h": h, "rot": 0, "anim": anim, "animDelay": delay,
            "text": str(t), "font": font, "size": size, "weight": weight, "italic": italic, "color": color,
            "align": align, "lh": lh, "ls": ls, "fill": "none"}


def rect(x, y, w, h, fill, *, radius=0, anim="fade", delay=0.0, stroke="none", stroke_w=0):
    return {"id": _id(), "type": "rect", "x": x, "y": y, "w": w, "h": h, "rot": 0, "anim": anim, "animDelay": delay,
            "fill": fill, "stroke": stroke, "strokeW": stroke_w, "radius": radius}


def ellipse(x, y, w, h, fill, *, anim="fade", delay=0.0, stroke="none", stroke_w=0):
    return {"id": _id(), "type": "ellipse", "x": x, "y": y, "w": w, "h": h, "rot": 0, "anim": anim, "animDelay": delay,
            "fill": fill, "stroke": stroke, "strokeW": stroke_w}


def image(src, x, y, w, h, *, radius=0, anim="zoom", delay=0.0, alt="Survey photo"):
    return {"id": _id(), "type": "image", "x": x, "y": y, "w": w, "h": h, "rot": 0, "anim": anim, "animDelay": delay,
            "src": src, "fit": "cover", "radius": radius, "alt": alt}


def chart(kind, data, x, y, w, h, T, *, suffix="", anim="rise", delay=0.3, series_names=None):
    el = {"id": _id(), "type": "chart", "x": x, "y": y, "w": w, "h": h, "rot": 0, "anim": anim, "animDelay": delay,
          "chartKind": kind, "chartType": kind, "title": "", "showTitle": False, "accent": T["accent"],
          "palette": T["palette"], "chartThemeMode": "dark" if T["dark"] else "light", "chartFrame": "none",
          "showValues": True, "showLabels": True, "legend": bool(series_names), "showLegend": bool(series_names),
          "labelSize": 15 if kind in ("line", "area") else 20, "gridLines": kind in ("bar", "line", "area"), "axisValues": kind in ("bar", "line", "area"),
          "valuePrefix": "", "valueSuffix": suffix, "decimals": 0, "chartData": data}
    if series_names:
        el["seriesNames"] = series_names
    return el


def slide(els, T, kind, notes=""):
    return {"bg": T["bg"], "bgSize": None, "bgFx": T["fx"] if kind in ("title", "closing", "bignumber") else "none",
            "transition": TRANSITIONS.get(kind, "fade"), "notes": _clip(notes, 1200), "els": els}


# ─────────────────────────────────────────────────────────────────────
#  Data for each scene (always computed, never taken from the model)
# ─────────────────────────────────────────────────────────────────────

def _submission_ids(ctx, filters):
    if not filters:
        return None
    df = eng.apply_filters(ctx, ctx.frame, eng.clean_filters(ctx, filters))
    return set(int(x) for x in df["_submission_id"].tolist()) if "_submission_id" in df.columns else None


def chart_data(ctx, spec):
    """Foon chart spec → (hanns kind, chartData, suffix, series_names, caption)."""
    spec = dict(spec or {})
    kind = spec.get("kind") or "bar"
    if kind == "scatter":
        spec["kind"] = kind = "histogram"
        spec["x"] = spec.get("x") or spec.get("y")
    block = eng.tool_chart(ctx, spec)
    hk = CHART_KIND.get(block.get("chart") if kind != "timeseries" else "area", "bar")
    if kind in ("timeseries",) or block.get("chart") in ("line", "area"):
        # "line", not "area": older Hanns CSS faded the whole Area chart box.
        hk = "line"
    labels, series = block.get("labels") or [], block.get("series") or []
    if not labels or not series:
        raise eng.ToolError("That chart has no data.")
    if len(series) > 1 and hk == "bar":
        labels = labels[:6]
        names = [s["name"] for s in series[:4]]
        data = [{"label": l, "value": sum((s["data"][i] or 0) for s in series[:4]),
                 "series": [(s["data"][i] or 0) for s in series[:4]]} for i, l in enumerate(labels)]
        return "bar", data, "", names, block.get("caption", "")
    vals = series[0]["data"]
    suffix = ""
    if block.get("percent") and hk in ("bar", "pie", "donut"):
        vals, suffix = block["percent"], "%"
    if hk in ("line", "area") and len(labels) > 24:           # keep the trend readable
        step = len(labels) // 24 + 1
        labels, vals = labels[::step], vals[::step]
    if hk in ("line", "area"):
        labels = [_short_date(l) for l in labels]
    limit = 6 if hk in ("pie", "donut") else 8
    data = [{"label": _clip(l, 22), "value": round(float(v or 0), 1)} for l, v in zip(labels[:limit], vals[:limit])]
    return hk, data, suffix, None, block.get("caption", "")


def _short_date(label):
    """'2026-09-24' → '24 Sep' on slides; anything else unchanged."""
    from datetime import datetime
    try:
        return datetime.strptime(str(label)[:10], "%Y-%m-%d").strftime("%d %b").lstrip("0")
    except ValueError:
        return str(label)


def number_value(ctx, spec):
    """{"agg","column","format":"percent","filters","of"} → ("66%", hint)."""
    card = {"label": "", "agg": (spec or {}).get("agg") or "count", "column": (spec or {}).get("column"),
            "filters": (spec or {}).get("filters"), "of": (spec or {}).get("of"),
            "format": (spec or {}).get("format") or "number"}
    value, hint, fmt = eng._card_value(ctx, ctx.frame, card)
    if value is None:
        raise eng.ToolError("That number has no data.")
    shown = f"{eng.fmt_num(value)}%" if fmt == "percent" else eng.fmt_num(value)
    if (spec or {}).get("suffix"):
        shown += str(spec["suffix"])[:8]
    return shown, hint


def photo_rows(ctx, spec, n):
    from . import media
    spec = spec or {}
    ids = _submission_ids(ctx, spec.get("filters"))
    return media.pick_photos(ctx.survey, n=n, question=spec.get("question") or None, submission_ids=ids)


# ─────────────────────────────────────────────────────────────────────
#  Normalising the story and the storyboard preview
# ─────────────────────────────────────────────────────────────────────

def story_spec(ctx, spec):
    """Compute every scene's data; drop scenes that can't be filled.
    Returns (scenes, problems). Each scene carries `data` for layout."""
    from . import media
    scenes, problems, used_photos = [], [], set()
    labels = media._question_labels(ctx.survey)
    raw = [s for s in (spec.get("scenes") or []) if isinstance(s, dict)][:MAX_SCENES]
    if not raw or raw[0].get("type") != "title":
        raw.insert(0, {"type": "title", "headline": spec.get("title") or ctx.survey.title, "text": spec.get("subtitle") or ""})
    for sc in raw:
        t = sc.get("type") if sc.get("type") in SCENE_TYPES else "chart"
        out = {"type": t, "headline": _clip(sc.get("headline"), 90), "text": _clip(sc.get("text"), 240),
               "notes": _clip(sc.get("notes"), 900), "data": {}}
        try:
            if t == "title":
                pics = photo_rows(ctx, {"question": (sc.get("photo") or {}).get("question")}, 1)
                if pics:
                    out["data"]["photo"] = pics[0]
                    used_photos.add(pics[0].id)
            elif t == "bignumber":
                out["data"]["value"], out["data"]["hint"] = number_value(ctx, sc.get("number"))
            elif t == "chart":
                k, d, suf, names, cap = chart_data(ctx, sc.get("chart"))
                out["data"].update(kind=k, chart=d, suffix=suf, series=names, caption=cap)
            elif t == "timeline":
                freq = "W" if len(ctx.frame) and _span_days(ctx) > 45 else "D"
                k, d, suf, names, cap = chart_data(ctx, {"kind": "timeseries", "freq": freq,
                                                         "group_by": (sc.get("chart") or {}).get("group_by")})
                out["data"].update(kind=k, chart=d, suffix=suf, series=names, caption=cap)
            elif t == "compare":
                items = []
                for it in (sc.get("items") or [])[:3]:
                    if isinstance(it, dict):
                        v, hint = number_value(ctx, {"format": it.get("format") or "percent", "filters": it.get("filters"),
                                                     "of": it.get("of"), "agg": it.get("agg"), "column": it.get("column")})
                        items.append({"label": _clip(it.get("label"), 40), "value": v, "hint": hint})
                if len(items) < 2:
                    raise eng.ToolError("A comparison needs two things to compare.")
                out["data"]["items"] = items
            elif t in ("photo", "gallery"):
                want = 1 if t == "photo" else max(2, min(3, int((sc.get("photo") or {}).get("count") or 3)))
                pics = [p for p in photo_rows(ctx, sc.get("photo"), want + len(used_photos)) if p.id not in used_photos][:want]
                if not pics:
                    raise eng.ToolError("There are no photos for this scene yet.")
                used_photos.update(p.id for p in pics)
                out["data"]["photos"] = pics
                out["data"]["credits"] = [media.photo_credit(p, labels) for p in pics]
            elif t == "takeaways":
                pts = [_clip(p, 140) for p in (sc.get("points") or []) if str(p).strip()][:3]
                if not pts:
                    raise eng.ToolError("Takeaways need points.")
                out["data"]["points"] = pts
        except eng.ToolError as exc:
            problems.append(f"Skipped a {t} scene: {exc}")
            continue
        scenes.append(out)
    if scenes and scenes[-1]["type"] != "closing":
        scenes.append({"type": "closing", "headline": "What happens next is up to us", "text": "Thank you.",
                       "notes": "", "data": {}})
    return scenes, problems


def _span_days(ctx):
    import pandas as pd
    d = pd.to_datetime(ctx.frame.get("_received_at"), errors="coerce", utc=True).dropna()
    return (d.max() - d.min()).days if len(d) else 0


def storyboard(ctx, scenes, theme):
    from . import media
    out = []
    for sc in scenes:
        d = sc["data"]
        card = {"type": sc["type"], "headline": sc["headline"], "text": sc["text"], "notes": sc["notes"]}
        if "value" in d:
            card["value"] = d["value"]
        if "chart" in d:
            card["chart"] = {"kind": d["kind"], "data": d["chart"][:6], "suffix": d["suffix"]}
        if d.get("photo"):
            card["photos"] = [media.media_url(ctx.survey, d["photo"], "thumb")]
        if d.get("photos"):
            card["photos"] = [media.media_url(ctx.survey, p, "thumb") for p in d["photos"]]
        if d.get("items"):
            card["items"] = d["items"]
        if d.get("points"):
            card["points"] = d["points"]
        out.append(card)
    return out


def tool_story_deck(ctx, spec):
    if ctx.survey is None:
        raise eng.ToolError("Open a survey and I'll turn its data into a story.")
    if ctx.frame.empty:
        raise eng.ToolError("A story needs some responses first.")
    theme = spec.get("theme") if spec.get("theme") in THEMES else "night"
    scenes, problems = story_spec(ctx, spec)
    title = _clip(spec.get("title") or ctx.survey.title, 120)
    norm = {k: spec.get(k) for k in ("title", "subtitle", "scenes")}
    norm.update(tool="story_deck", theme=theme)
    return {"type": "story", "title": title, "subtitle": _clip(spec.get("subtitle"), 160), "theme": theme,
            "theme_tokens": {k: THEMES[theme][k] for k in ("bg", "ink", "muted", "accent", "accent2", "dark", "palette")},
            "themes": {k: {"label": v["label"], "bg": v["bg"], "accent": v["accent"]} for k, v in THEMES.items()},
            "scenes": storyboard(ctx, scenes, theme), "problems": problems,
            "photo_count": sum(len(s["data"].get("photos") or ([s["data"]["photo"]] if s["data"].get("photo") else []))
                               for s in scenes),
            "spec": norm}


# ─────────────────────────────────────────────────────────────────────
#  Layouts — 960 × 540
# ─────────────────────────────────────────────────────────────────────

def _meta_line(ctx):
    import pandas as pd
    n = len(ctx.frame)
    d = pd.to_datetime(ctx.frame.get("_received_at"), errors="coerce", utc=True).dropna()
    when = d.max().strftime("%B %Y") if len(d) else timezone.localdate().strftime("%B %Y")
    return f"{n:,} responses · {when}"


def lay_title(T, sc, ctx, src):
    photo = src(sc["data"].get("photo"))
    tw = 470 if photo else 800
    head = sc["headline"] or ctx.survey.title
    size = 64 if len(head) <= 34 else 54 if len(head) <= 60 else 44
    els = [ellipse(600, -170, 560, 560, T["soft"], anim="fade"), ellipse(-150, 330, 380, 380, T["soft2"], anim="fade", delay=.1)]
    if photo:
        els += [rect(572, 62, 352, 420, T["accent"], radius=30, anim="fade", delay=.05),
                image(photo, 556, 48, 352, 420, radius=28, anim="zoom", delay=.15)]
    els += [text(_clip(ctx.survey.title, 60), 64, 108, tw, 30, size=16, weight=700, color=T["accent"], font=T["body"],
                 anim="fade", delay=.1, ls=1),
            text(head, 64, 146, tw, 210, size=size, weight=700, color=T["ink"], font=T["head"], lh=1.04, anim="rise", delay=.2)]
    if sc["text"]:
        els.append(text(sc["text"], 64, 368, tw, 70, size=21, weight=400, color=T["muted"], font=T["body"], lh=1.35,
                        anim="fade", delay=.4))
    els += [rect(64, 452, 46, 4, T["accent2"], anim="left", delay=.5),
            text(_meta_line(ctx), 122, 440, tw - 60, 28, size=15, weight=600, color=T["accent2"], font=T["body"],
                 anim="fade", delay=.55)]
    return els


def lay_bignumber(T, sc, ctx, src):
    v = sc["data"]["value"]
    size = 190 if len(v) <= 4 else 150 if len(v) <= 6 else 110
    return [
        ellipse(610, 90, 380, 380, "none", stroke=T["accent2"], stroke_w=2, anim="zoom"),
        ellipse(700, 180, 200, 200, T["soft"], anim="zoom", delay=.1),
        text(sc["headline"], 64, 70, 820, 70, size=30, weight=600, color=T["ink"], font=T["body"], lh=1.2, anim="fade", delay=.1),
        text(v, 56, 130, 760, 230, size=size, weight=800, color=T["accent"], font=T["head"], lh=1, anim="pop", delay=.25),
        rect(64, 372, 120, 6, T["accent2"], anim="left", delay=.45),
        text(sc["text"] or sc["data"].get("hint", ""), 64, 396, 700, 100, size=23, weight=400, color=T["muted"],
             font=T["body"], lh=1.35, anim="fade", delay=.55),
    ]


def _lines(txt, width, size):
    """Lines a headline wraps to: greedy word wrap at ≈0.58 em per character
    (display serifs like Playfair run wide), so a rule placed under it never
    cuts through the last line."""
    per_line = max(6, int(width / (size * 0.58)))
    lines, cur = 1, 0
    for word in str(txt or "").split():
        need = len(word) + (1 if cur else 0)
        if cur and cur + need > per_line:
            lines, cur = lines + 1, len(word)
        else:
            cur += need
    return lines


def lay_chart(T, sc, ctx, src):
    d = sc["data"]
    size = 36 if len(sc["headline"]) < 48 else 30
    head_h = int(_lines(sc["headline"], 360, size) * size * 1.12) + 8
    rule_y = 58 + head_h + 14
    els = [rect(440, 46, 480, 448, T["panel"], radius=26, anim="fade", delay=.05),
           text(sc["headline"], 56, 58, 360, head_h, size=size, weight=700, color=T["ink"],
                font=T["head"], lh=1.08, anim="rise", delay=.1),
           rect(56, rule_y, 60, 5, T["accent"], anim="left", delay=.25),
           text(sc["text"] or d.get("caption", ""), 56, rule_y + 22, 360, 440 - rule_y, size=19, weight=400,
                color=T["muted"], font=T["body"], lh=1.42, anim="fade", delay=.3),
           text(f"Source: {ctx.survey.title} · n = {len(ctx.frame):,}", 56, 470, 370, 26, size=12, weight=500,
                color=T["muted"], font=T["body"], anim="fade", delay=.5),
           chart(d["kind"], d["chart"], 460, 66, 440, 408, T, suffix=d["suffix"], series_names=d.get("series"), delay=.35)]
    return els


def lay_timeline(T, sc, ctx, src):
    d = sc["data"]
    return [text(sc["headline"], 56, 40, 848, 64, size=36, weight=700, color=T["ink"], font=T["head"], lh=1.1, anim="rise"),
            rect(40, 118, 880, 330, T["panel"], radius=24, anim="fade", delay=.1),
            chart(d["kind"], d["chart"], 56, 126, 848, 312, T, suffix=d["suffix"], series_names=d.get("series"),
                  anim="rise", delay=.25),
            text(sc["text"] or d.get("caption", ""), 56, 462, 848, 50, size=18, weight=400, color=T["muted"], font=T["body"],
                 lh=1.35, anim="fade", delay=.5)]


def lay_photo(T, sc, ctx, src):
    pics = sc["data"]["photos"]
    url = src(pics[0])
    credit = sc["data"]["credits"][0]
    return [image(url, 0, 0, W, H, anim="zoom"),
            rect(0, 250, W, 290, "rgba(4,5,16,0.34)", anim="fade", delay=.1),
            rect(0, 340, W, 200, "rgba(4,5,16,0.42)", anim="fade", delay=.15),
            rect(56, 362, 6, 76, T["accent"], anim="drop", delay=.3),
            text(sc["headline"] or credit, 76, 356, 780, 92, size=38 if len(sc["headline"]) < 50 else 30, weight=700,
                 color="#ffffff", font=T["head"], lh=1.1, anim="rise", delay=.35),
            text(sc["text"], 76, 446, 780, 52, size=19, weight=400, color="rgba(255,255,255,0.86)", font=T["body"], lh=1.35,
                 anim="fade", delay=.5),
            text("📷 " + credit, 76, 500, 820, 24, size=13, weight=500, color="rgba(255,255,255,0.7)", font=T["body"],
                 anim="fade", delay=.6)]


def lay_gallery(T, sc, ctx, src):
    pics = sc["data"]["photos"]
    n = len(pics)
    gap = 18
    w = (848 - gap * (n - 1)) // n
    els = [text(sc["headline"] or "Voices from the field", 56, 40, 848, 60, size=34, weight=700, color=T["ink"],
                font=T["head"], lh=1.1, anim="rise")]
    for i, p in enumerate(pics):
        x = 56 + i * (w + gap)
        els += [image(src(p), x, 120, w, 300, radius=20, anim="rise", delay=.15 + i * .15),
                text(sc["data"]["credits"][i], x, 432, w, 64, size=14, weight=500, color=T["muted"], font=T["body"], lh=1.3,
                     anim="fade", delay=.35 + i * .15)]
    if sc["text"]:
        els.append(text(sc["text"], 56, 494, 848, 30, size=15, weight=400, color=T["muted"], font=T["body"], anim="fade",
                        delay=.7))
    return els


def lay_compare(T, sc, ctx, src):
    items = sc["data"]["items"]
    n = len(items)
    gap = 24
    w = (848 - gap * (n - 1)) // n
    els = [text(sc["headline"], 56, 44, 848, 70, size=36, weight=700, color=T["ink"], font=T["head"], lh=1.1, anim="rise")]
    colors = [T["accent"], T["accent2"], T["palette"][2]]
    nums = []
    for it in items:
        try:
            nums.append(float(str(it["value"]).replace("%", "").replace(",", "")))
        except ValueError:
            nums.append(0.0)
    top = max(nums) or 1
    for i, it in enumerate(items):
        x = 56 + i * (w + gap)
        els += [rect(x, 140, w, 320, T["panel"], radius=24, anim="rise", delay=.1 + i * .15),
                text(it["value"], x + 28, 168, w - 56, 120, size=86 if len(it["value"]) <= 5 else 64, weight=800,
                     color=colors[i % 3], font=T["head"], lh=1, anim="pop", delay=.3 + i * .15),
                text(it["label"], x + 28, 300, w - 56, 60, size=22, weight=600, color=T["ink"], font=T["body"], lh=1.2,
                     anim="fade", delay=.4 + i * .15),
                text(it.get("hint") or "", x + 28, 362, w - 56, 30, size=14, weight=400, color=T["muted"], font=T["body"],
                     anim="fade", delay=.45 + i * .15),
                rect(x + 28, 410, w - 56, 10, T["panel"], radius=5, anim="fade", delay=.5),
                rect(x + 28, 410, max(12, int((w - 56) * nums[i] / top)), 10, colors[i % 3], radius=5, anim="left",
                     delay=.6 + i * .15)]
    if sc["text"]:
        els.append(text(sc["text"], 56, 478, 848, 40, size=17, weight=400, color=T["muted"], font=T["body"], anim="fade",
                        delay=.8))
    return els


def lay_takeaways(T, sc, ctx, src):
    pts = sc["data"]["points"]
    n = len(pts)
    gap = 20
    w = (848 - gap * (n - 1)) // n
    els = [text(sc["headline"] or "What this tells us", 56, 44, 848, 70, size=38, weight=700, color=T["ink"],
                font=T["head"], lh=1.1, anim="rise")]
    for i, p in enumerate(pts):
        x = 56 + i * (w + gap)
        els += [rect(x, 140, w, 330, T["panel"], radius=22, anim="rise", delay=.1 + i * .15),
                ellipse(x + 26, 166, 54, 54, T["palette"][i % len(T["palette"])], anim="pop", delay=.25 + i * .15),
                text(str(i + 1), x + 26, 176, 54, 36, size=24, weight=800, color="#ffffff" if T["dark"] else "#ffffff",
                     font=T["body"], align="center", anim="pop", delay=.3 + i * .15),
                text(p, x + 26, 240, w - 52, 210, size=21 if len(p) < 90 else 18, weight=500, color=T["ink"],
                     font=T["body"], lh=1.38, anim="fade", delay=.35 + i * .15)]
    return els


def lay_closing(T, sc, ctx, src):
    return [ellipse(-120, -120, 420, 420, T["soft"], anim="fade"), ellipse(700, 300, 420, 420, T["soft2"], anim="fade", delay=.1),
            text(sc["headline"] or "Thank you", 80, 150, 800, 160, size=58 if len(sc["headline"]) < 40 else 46, weight=700,
                 color=T["ink"], font=T["head"], align="center", lh=1.05, anim="rise", delay=.15),
            text(sc["text"], 140, 318, 680, 80, size=21, weight=400, color=T["muted"], font=T["body"], align="center",
                 lh=1.35, anim="fade", delay=.35),
            rect(390, 420, 180, 44, T["accent"], radius=22, anim="pop", delay=.5),
            text("Made with Kura", 390, 431, 180, 24, size=13, weight=700, color="#ffffff", font=T["body"],
                 align="center", anim="pop", delay=.55)]


LAYOUTS = {"title": lay_title, "bignumber": lay_bignumber, "chart": lay_chart, "timeline": lay_timeline,
           "photo": lay_photo, "gallery": lay_gallery, "compare": lay_compare, "takeaways": lay_takeaways,
           "closing": lay_closing}


def _auto_notes(sc, ctx):
    d = sc["data"]
    if sc["notes"]:
        return sc["notes"]
    if sc["type"] == "bignumber":
        return f"Pause on the number: {d.get('value')}. {sc['text']}"
    if sc["type"] in ("chart", "timeline"):
        return f"{sc['headline']}. {d.get('caption', '')}"
    if sc["type"] in ("photo", "gallery"):
        return "Let the photo speak for a moment before you explain it. " + " ".join(d.get("credits") or [])
    return sc["text"] or sc["headline"]


def build_slides(ctx, scenes, theme, photo_src):
    T = THEMES[theme]
    return [slide(LAYOUTS[sc["type"]](T, sc, ctx, photo_src), T, sc["type"], _auto_notes(sc, ctx)) for sc in scenes]


# ─────────────────────────────────────────────────────────────────────
#  Creating the Hanns deck
# ─────────────────────────────────────────────────────────────────────

def create_deck(ctx, spec, user):
    from hanns.models import Deck, Slide
    from . import media
    theme = spec.get("theme") if spec.get("theme") in THEMES else "night"
    scenes, problems = story_spec(ctx, spec)
    deck = Deck.objects.create(owner=user, title=_clip(spec.get("title") or ctx.survey.title, 140), state="draft")
    copied = {}

    def photo_src(m):
        if m is None:
            return None
        if m.id not in copied:
            data = media.photo_bytes(m, "web")
            path = default_storage.save(f"hanns/decks/{deck.code}/images/{uuid.uuid4().hex}.jpg", ContentFile(data))
            url = default_storage.url(path)
            copied[m.id] = url if url.startswith(("http://", "https://", "/")) else "/" + url
        return copied[m.id]

    slides = build_slides(ctx, scenes, theme, photo_src)
    Slide.objects.bulk_create([Slide(deck=deck, position=i, data=s) for i, s in enumerate(slides)])
    return deck, len(slides), problems


# ─────────────────────────────────────────────────────────────────────
#  A story without the AI
# ─────────────────────────────────────────────────────────────────────

def builtin_story(ctx):
    from . import media
    df = ctx.frame
    choices = [f for f in ctx.catalog if f["kind"] == "choice" and not f.get("meta") and not f.get("multi")
               and eng._informative_choice(ctx, f)]
    nums = [f for f in ctx.catalog if f["kind"] == "number" and not f.get("meta") and f["name"] in df.columns]
    scenes = [{"type": "title", "headline": f"What {len(df):,} voices told us", "text": ctx.survey.title,
               "notes": "Open with the scale: how many people answered, and why their answers matter."}]
    if choices:
        f = choices[0]
        st = eng.column_stats(df, f)
        top = (st.get("top") or [{}])[0]
        value = next((c["value"] for c in f["choices"] if c["label"] == top.get("label")), top.get("label"))
        scenes.append({"type": "bignumber", "headline": f"{top.get('label', '')}: the most common answer",
                       "text": f"to “{f['label']}” — {st.get('answered', 0):,} people answered.",
                       "number": {"format": "percent", "filters": [{"field": f["name"], "operator": "eq", "value": value}],
                                  "of": [{"field": f["name"], "operator": "answered"}]}})
    for f in choices[:3]:
        st = eng.column_stats(df, f)
        top = st.get("top") or []
        lead = (f"{top[0]['label']} leads at {top[0]['pct']:g}%" if len(top) < 2 or top[0]["pct"] - top[1]["pct"] >= 3
                else f"{top[0]['label']} and {top[1]['label']} are neck and neck")
        scenes.append({"type": "chart", "headline": lead,
                       "text": f"Answers to “{f['label']}” from {st.get('answered', 0):,} people.",
                       "chart": {"kind": "donut" if len(f.get("choices") or []) <= 4 else "bar", "x": f["name"]}})
    if nums:
        scenes.append({"type": "bignumber", "headline": f"Average {eng.short_label(nums[0]).lower()}",
                       "text": f"Across everyone who answered “{nums[0]['label']}”.",
                       "number": {"agg": "mean", "column": nums[0]["name"]}})
    stats = media.photo_stats(ctx.survey)
    if stats["total"]:
        scenes.append({"type": "photo", "headline": "Behind every answer, a place and a person", "text": "",
                       "photo": {}})
        if stats["total"] >= 3:
            scenes.append({"type": "gallery", "headline": "Voices from the field", "photo": {"count": 3}})
    if len(df) and _span_days(ctx) >= 3:
        import pandas as pd
        days = pd.to_datetime(df["_received_at"], errors="coerce", utc=True).dropna().dt.date
        busiest = days.value_counts().idxmax() if len(days) else None
        scenes.append({"type": "timeline", "headline": "How the answers came in",
                       "text": (f"{len(df):,} responses over {_span_days(ctx) + 1} days"
                                + (f" — the busiest day was {busiest.strftime('%d %B').lstrip('0')}." if busiest else "."))})
    points = []
    for f in choices[:3]:
        top = (eng.column_stats(df, f).get("top") or [{}])[0]
        if top:
            points.append(f"{top.get('pct', 0):g}% chose “{top.get('label')}” for {eng.short_label(f).lower()}.")
    if points:
        scenes.append({"type": "takeaways", "headline": "Three things to remember", "points": points})
    scenes.append({"type": "closing", "headline": "Turning answers into action", "text": "Thank you."})
    return {"tool": "story_deck", "title": f"{ctx.survey.title} — the story", "theme": "night", "scenes": scenes}
