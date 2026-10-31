"""
kura/agent_ai.py — Kora's planner: turns a chat message into tool calls.

Three layers, each tried only if the one before it fails — the same
arrangement as Hanns AI Studio, and it reuses that engine (hanns/ai.py) so
one .env serves both:

  1. Google Gemini, free tier, walking the model chain in HANNS_AI_MODELS
     (overloaded → retry, quota → cool that model down and try the next).
  2. The optional OpenAI-compatible provider (HANNS_AI_FALLBACK_URL/_KEY/
     _MODEL — Groq, OpenRouter, Mistral, a local Ollama…).
  3. Kora's built-in skills below — keyword intent + fuzzy column matching
     + questionnaire templates. Always answers, never needs a network.

.env
────
    GEMINI_API_KEY=…                     # shared with Hanns
    KURA_AGENT_HOURLY_LIMIT=60           # AI turns per user per hour (default 60)
    KURA_AGENT_ENABLED=true              # set false to hide Kora everywhere

Privacy: only the digest built by agent_engine.data_digest reaches the
model — question wording, column types and aggregates. Answers to text,
identifying, media and location questions are never sent. On Google's free
tier prompts may be used to improve Google's products; Kora's panel says so.
"""

from __future__ import annotations

import difflib
import json
import logging
import os
import re
import time

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from . import agent_engine as eng

logger = logging.getLogger(__name__)


class AgentError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


# ─────────────────────────── configuration ───────────────────────────

def _setting(name, default=""):
    val = getattr(settings, name, None)
    if val in (None, ""):
        val = os.environ.get(name, default)
    return val


def agent_enabled() -> bool:
    return str(_setting("KURA_AGENT_ENABLED", "true")).strip().lower() not in ("0", "false", "no", "off")


def _engine():
    """The shared Gemini engine from Hanns (lazy: keeps imports light)."""
    from hanns import ai as hai
    return hai


def ai_enabled() -> bool:
    try:
        return _engine().is_enabled()
    except Exception:
        return False


def hourly_limit() -> int:
    try:
        return max(1, int(_setting("KURA_AGENT_HOURLY_LIMIT", "60")))
    except (TypeError, ValueError):
        return 60


def _bucket(user_id):
    return f"kura-agent:{user_id}:{int(time.time() // 3600)}"


def quota_left(user_id) -> int:
    used = cache.get(_bucket(user_id), 0) or 0
    return max(0, hourly_limit() - int(used))


def take_quota(user_id) -> int:
    key = _bucket(user_id)
    if cache.add(key, 1, 3700):
        used = 1
    else:
        try:
            used = cache.incr(key)
        except ValueError:
            cache.set(key, 1, 3700)
            used = 1
    if used > hourly_limit():
        raise AgentError("hourly limit reached", status=429)
    return hourly_limit() - used


# ─────────────────────────── the prompt ───────────────────────────

PAGE_NAMES = {
    "list": "the survey list",
    "builder": "the form builder",
    "data": "the classic data workbench",
    "studio": "the Data Studio (cleaning pipelines)",
    "dashboards": "the live dashboards list",
    "dashboard": "a live dashboard",
    "monitor": "the live monitor",
    "live_map": "the live map",
    "teams": "team management",
    "team_board": "a supervisor's team board",
}

SYSTEM = """You are Kora, the AI assistant inside Kura — the survey and data-collection studio of the Knock-Knock platform (nokknock.app, The Gambia). You are a cheerful, music-loving robot with headphones and a sharp senior data engineer and M&E specialist. You help people design questionnaires, understand their survey data, make charts, tables, KPI cards, maps, infographic shapes and dashboards, clean data, and make privacy-safe subsets.

HOW YOU WORK
You never see raw answers — only the questionnaire, column metadata and aggregate statistics in CONTEXT. To show numbers you call TOOLS; the server computes every figure exactly and renders it with download buttons (PNG, CSV, Excel, HTML). Rules:
- Never invent a number that is not in CONTEXT. If the user wants figures, call a tool.
- Use column names exactly as listed under FIELDS (the word before the brackets).
- Prefer doing over asking: pick the most sensible columns and chart type yourself. Ask a question only when the request is truly ambiguous.
- If a request needs data and there is no survey or no responses, say so kindly and offer what you can do (e.g. draft the questionnaire).
- Respect permissions listed under USER CAN.

ANSWER FORMAT — one JSON object, nothing else:
{"say": "...", "mood": "happy|proud|curious|thinking|oops", "actions": [ ... ], "suggestions": ["...", "..."]}
- say: your chat reply in the user's language (English, French, Wolof, Mandinka… as they write). Warm, plain and short — at most ~90 words unless they asked for an explanation. You may use **bold** and "- " bullet lines. Don't list what the blocks already show; add the one insight that matters, using CONTEXT statistics.
- actions: 0–4 tool calls. None for small talk or advice.
- suggestions: up to 3 short next requests (max 7 words each) relevant to what you just did.

FILTERS (optional on most tools): [{"field":"sex","operator":"eq","value":"Female"}]
operators: eq ne gt gte lt lte between(min,max) in not_in contains not_contains starts_with ends_with answered not_answered. Choice values may be given as their labels.

TOOLS
{"tool":"overview"} — how an active survey is doing: responses, today, trend, last arrival, quota, flags.
{"tool":"profile","columns":[optional]} — data health check: missing values, outliers, duplicates, stray spaces, personal data.
{"tool":"chart","kind":"bar|hbar|pie|donut|stacked|line|area|timeseries|histogram|scatter|radar|polar","x":"col","y":"numeric col (optional)","agg":"count|sum|mean|median|min|max","group_by":"col (optional)","filters":[],"limit":20,"freq":"D|W|M (time series)","cumulative":false,"title":"..."}
   choice question → bar/hbar/donut; number → histogram; two numbers → scatter; over time → timeseries (x defaults to _received_at); compare groups → group_by.
{"tool":"table","mode":"frequency|crosstab|group|summary|rows","x":"col","group_by":"col","y":"numeric col","agg":"mean","percent":"row|col|total","columns":[for rows/summary],"sort_by":"col","ascending":false,"limit":50,"filters":[],"title":"..."}
{"tool":"cards","title":"...","cards":[{"label":"Women","agg":"count","filters":[...]},{"label":"Share vaccinated","format":"percent","filters":[...],"of":[base filters]},{"label":"Average age","agg":"mean","column":"age"}]}  (omit cards for an automatic set)
{"tool":"map","color_by":"choice col (optional)","filters":[],"title":"..."}
{"tool":"shape","kind":"ring|pictogram|funnel|pill|bars|gauge","icon":"person|home|drop|leaf|star|heart","x":"choice col (one shape per option)","items":[{"label":"Have clean water","filters":[...],"of":[...]}],"title":"..."}  — infographic shapes; use items for custom shares, x for a quick breakdown, funnel for step-by-step drop-off.
{"tool":"dashboard","title":"...","theme":"studio|ops|midnight|ocean|forest|sunset|graphite|light|paper|unblue","tiles":[{"kind":"kpi|delta|progress|gauge|bar|hbar|pie|donut|leaderboard|timeseries|histogram|scatter|table|map|text","title":"...","spec":{...},"filters":[]}]}
   tile specs: kpi/gauge {"agg","column","target"} · delta {"agg","window_minutes"} · progress {"agg","target"} · bar/hbar/pie/donut {"x","y","agg","group_by","limit"} · leaderboard {"group_by","column","agg","limit"} · timeseries {"date":"_received_at","freq":"D","cumulative"} · histogram {"x"} · scatter {"x","y"} · table {"columns":[...],"limit":25} · map {"color_by"} · text {"body"}
   Use {"tool":"dashboard","auto":true} for a quick automatic board. 6–10 tiles is a good board.
{"tool":"clean","steps":[{"operation":"...","name":"plain-English step name","config":{...}}]} or {"tool":"clean","auto":true} — a cleaned COPY (originals untouched), downloadable and savable as a Data Studio pipeline. Operations and configs:
   trim_text {field} · case_text {field,mode:lower|upper|title} · recode {field,map:{"old":"new"},trim,lower} · replace_text {field,find,replace,regex}
   cast_type {field,type:integer|decimal|date|boolean|text} · fill_missing {field,method:median|mean|mode|constant|forward|backward,value,group_by}
   deduplicate {fields:[...],keep:first|last} · drop_rows {mode:blank|duplicates|condition,fields,match:any|all,field,operator,value}
   filter_rows {conditions:[filters],match:all|any,keep_matching:true} · drop_columns {columns} · keep_columns {columns} · rename_column {field,new_name}
   outlier {field,method:iqr|zscore,k:1.5,action:cap|median|mean|drop} · clip_range {field,min,max,action:cap|blank|drop}
   bin_column {field,new_field,method:equal|quantile|custom,bins,edges,labels} · round_numbers {fields,places} · calculate {new_field,expression}
   flag_rows {new_field,conditions:[filters],match,true_label} · sort_rows {fields,ascending}
{"tool":"privacy","rules":{"col":"keep|drop|hash|mask|band5|band10|year|month|day|round1|round2|round3|topcode"},"keep_only":[optional columns],"k":5,"suppress":false,"title":"..."} — privacy-safe subset. Every column is auto-classified (see ⚠ in FIELDS) and given a safe default; only add rules to change a default or follow the user's wishes. suppress:true drops rows that stay unique on quasi-identifiers (k-anonymity).
{"tool":"questionnaire","title":"...","description":"...","mode":"new|append","questions":[...]} — draft a form (the user can add it to the builder or create a new survey).
   question: {"name":"snake_case","type":"section|note|text|long_text|integer|decimal|select_one|select_multiple|rank|likert|rating|date|time|datetime|gps|mapper|photo|barcode|calculate|repeat","label":"...","hint":"...","required":true,
     "choices":[{"value":"yes","label":"Yes"}],
     "relevant":{"op":"and","rules":[{"q":"earlier_question","cmp":"eq|ne|gt|gte|lt|lte|selected|not_selected|answered|not_answered|contains","value":"yes"}]},
     "validate":{"min":0,"max":120,"message":"..."}, "calc":"weight / ((height/100)^2)",
     "repeat":{"count_expr":"hh_size","item_label":"Member ${index}"}, "children":[questions] }
   Design like a senior M&E specialist: open with a note explaining the purpose and a consent select_one when interviewing people (later questions shown only if consent = yes); group with sections; required on key questions; min/max on numbers; include "Other" / "Don't know" where natural; skip logic for follow-ups (only to earlier questions); plain words; one idea per question; 12–35 questions unless asked otherwise. For The Gambia, region choices are Banjul, Kanifing, West Coast, North Bank, Lower River, Central River, Upper River.
{"tool":"review_form"} — check the current questionnaire for problems (placeholders, missing options, broken logic, no min/max…). Add your own expert suggestions in "say".
{"tool":"surveys"} — the user's surveys with response counts (useful on the survey list).
"""


def _field_line(item):
    f, st, pii = item["field"], item["stats"], item["pii"]
    head = f"- {f['name']} [{f['type']}] \"{eng._clip_text(f['label'], 90)}\""
    bits = []
    if st.get("absent"):
        bits.append("no answers yet")
    else:
        if st.get("rows"):
            bits.append(f"answered {100 - st.get('missing_pct', 0):g}%")
        if st.get("top"):
            bits.append(", ".join(f"{t['label']} {t['pct']:g}%" for t in st["top"][:6]))
        if st.get("mean") is not None:
            bits.append(f"mean {eng.fmt_num(st['mean'])}, median {eng.fmt_num(st['median'])}, "
                        f"range {eng.fmt_num(st['min'])}–{eng.fmt_num(st['max'])}"
                        + (f", {st['outliers']} extreme" if st.get("outliers") else ""))
        if st.get("first"):
            bits.append(f"{st['first']} → {st['last']}")
        if f["kind"] in ("text",) and "distinct" in st:
            bits.append(f"{st['distinct']} distinct, values hidden")
        if st.get("items_mean") is not None:
            bits.append(f"avg {eng.fmt_num(st['items_mean'])} items")
    if f.get("choices") and f["kind"] == "choice" and not f.get("meta"):
        opts = ", ".join(f"{c['value']}={eng._clip_text(c['label'], 24)}" for c in f["choices"][:12])
        if len(f["choices"]) > 12:
            opts += f", …(+{len(f['choices']) - 12})"
        bits.append(f"options: {opts}")
    if pii["level"] in ("direct", "quasi", "sensitive"):
        bits.append(f"⚠ {pii['level']} ({pii['reason']}) → default {pii['action']}")
    return head + (" — " + "; ".join(bits) if bits else "")


def _outline(schema, limit=90):
    lines = []
    for i, q in enumerate((schema or {}).get("questions") or []):
        if i >= limit:
            lines.append(f"… and {len(schema['questions']) - limit} more")
            break
        if not isinstance(q, dict):
            continue
        extra = ""
        if q.get("choices"):
            extra = " {" + ", ".join(str(c.get("label")) for c in q["choices"][:8] if isinstance(c, dict)) + "}"
        if q.get("relevant"):
            extra += " [has skip logic]"
        lines.append(f"{i + 1}. {q.get('name')} [{q.get('type')}]{' *' if q.get('required') else ''} "
                     f"{eng._clip_text(q.get('label'), 100)}{extra}")
        for c in q.get("children") or []:
            if isinstance(c, dict):
                lines.append(f"    · {c.get('name')} [{c.get('type')}] {eng._clip_text(c.get('label'), 80)}")
    return "\n".join(lines) or "(empty)"


def build_user_prompt(ctx: eng.AgentContext, message: str, history: list) -> str:
    parts = [f"PAGE: {PAGE_NAMES.get(ctx.page, ctx.page)}",
             f"TODAY: {timezone.localdate().isoformat()}"]
    can = [k for k, v in (ctx.can or {}).items() if v]
    parts.append("USER CAN: " + (", ".join(can) if can else "chat and draft questionnaires only"))
    if ctx.survey is not None:
        s = ctx.survey
        v = s.current_version
        parts.append(f"SURVEY: \"{s.title}\" (code {s.code}) — state {s.state}, "
                     f"{'version ' + str(v.version) if v else 'not published yet'}"
                     + (f", quota {s.quota}" if s.quota else ""))
        if ctx.can.get("view"):
            dig = eng.data_digest(ctx)
            parts.append(f"RESPONSES: {dig.get('rows', 0)} usable rows (excluded rows left out)")
            if dig.get("fields"):
                parts.append("FIELDS:\n" + "\n".join(_field_line(it) for it in dig["fields"]))
        if ctx.page == "builder" or not ctx.can.get("view"):
            parts.append("CURRENT FORM (draft):\n" + _outline(ctx.draft_schema or s.draft_schema))
    else:
        from .models import Survey
        mine = list(Survey.objects.filter(owner=ctx.user).values_list("title", "code", "state")[:20])
        if mine:
            parts.append("THE USER'S SURVEYS: " + "; ".join(f"{t} ({c}, {st})" for t, c, st in mine))
        parts.append("No survey is open. Data tools need a survey — offer to draft a questionnaire, "
                     "or tell them to pick a survey in Kora's menu.")
    if history:
        convo = []
        for h in history[-8:]:
            role = "User" if h.get("role") == "user" else "Kora"
            line = f"{role}: {eng._clip_text(h.get('text') or '', 500)}"
            if h.get("made"):
                line += f"  [made: {eng._clip_text(', '.join(h['made']), 160)}]"
            convo.append(line)
        parts.append("CONVERSATION SO FAR:\n" + "\n".join(convo))
    parts.append(f"USER: {message}")
    return "\n\n".join(parts)


# ─────────────────────────── plan validation ───────────────────────────

MOODS = {"happy", "proud", "curious", "thinking", "oops"}


def normalise_plan(raw) -> dict:
    if not isinstance(raw, dict):
        raw = {"say": str(raw or "")}
    say = raw.get("say") or raw.get("reply") or raw.get("message") or ""
    if not isinstance(say, str):
        say = json.dumps(say)[:800]
    actions = []
    for a in raw.get("actions") or []:
        if isinstance(a, dict) and a.get("tool") in eng.TOOLS:
            actions.append(a)
        if len(actions) >= 4:
            break
    sugg = [eng._clip_text(s, 60) for s in (raw.get("suggestions") or []) if isinstance(s, str) and s.strip()][:3]
    mood = raw.get("mood") if raw.get("mood") in MOODS else ("proud" if actions else "happy")
    return {"say": say.strip()[:3000], "actions": actions, "suggestions": sugg, "mood": mood}


def call_ai(prompt):
    """The slow part: one HTTP round-trip through the Gemini chain (and the
    optional fallback provider). Pure network — no database — so the async
    view can run it on a worker thread. Returns (plan, model)."""
    hai = _engine()
    try:
        data, model = hai.ai_json(SYSTEM, prompt, temperature=0.45, max_tokens=8192)
    except hai.AIError as e:
        msg = str(e)
        if "slide data" in msg:
            msg = "The AI sent back a garbled answer"
        raise AgentError(msg, status=e.status)
    return normalise_plan(data), model


# ─────────────────────────── built-in skills (layer 3) ───────────────────────────

_WORD = re.compile(r"[a-zA-ZÀ-ÿ0-9_]+")
STOP = {"the", "a", "an", "of", "for", "by", "and", "or", "to", "in", "on", "me", "my", "show", "make",
        "create", "chart", "graph", "plot", "table", "please", "can", "you", "with", "what", "how", "is",
        "are", "per", "data", "survey", "map", "give", "draw", "build", "bar", "pie", "donut", "line",
        "over", "time", "each", "all", "answers", "responses", "question", "column", "split", "compare"}


def _tokens(text):
    return [t.lower() for t in _WORD.findall(text or "")]


def match_fields(ctx, message, kinds=None, limit=3):
    """Rank catalogue fields against the message by name/label word overlap."""
    toks = [t for t in _tokens(message) if t not in STOP and len(t) > 1]
    if not toks:
        return []
    scored = []
    for f in ctx.catalog:
        if kinds and f["kind"] not in kinds:
            continue
        if f.get("meta") and not re.search(r"\b(received|submitted|date|day|daily|collected via|channel|web or app|"
                                            r"row status|duration|minutes|how long)\b", message, re.I):
            continue
        words = set(_tokens(f["name"].replace("_", " ")) + _tokens(f["label"]))
        words -= STOP
        if not words:
            continue
        best, first = 0.0, None
        for pos, t in enumerate(toks):
            if t in words:
                best += 1.0
                first = pos if first is None else first
                continue
            close = max((difflib.SequenceMatcher(None, t, w).ratio() for w in words), default=0)
            if close >= 0.82:
                best += close * 0.8
                first = pos if first is None else first
        if best > 0:
            scored.append((best / (1 + 0.05 * len(words)), first, f))
    scored.sort(key=lambda x: -x[0])
    top = scored[:limit]
    # "region by sex": the first column named is the one to break down by.
    top.sort(key=lambda x: (x[1], -x[0]))
    return [f for _s, _p, f in top]


def _first_choice_field(ctx):
    for f in ctx.catalog:
        if f["kind"] == "choice" and not f.get("meta") and f["name"] in ctx.frame.columns:
            return f
    return None


R = lambda p: re.compile(p, re.I)  # noqa: E731
RX_QUESTIONNAIRE = R(r"\b(questionnaire|draft|design|create|make|build|write|generate)\b.*\b(survey|form|questionnaire|questions)\b|\bquestions? (for|about|on)\b|\bnew (survey|form)\b")
RX_REVIEW = R(r"\b(review|check|improve|audit|lint|feedback on)\b.*\b(form|questionnaire|questions|survey)\b")
RX_PRIVACY = R(r"\b(privacy|private|anonymi[sz]|pii|personal (data|info)|de-?identif|pseudonym|gdpr|safe (copy|subset|version|file|to share)|remove (the )?(names|phones?|identif)|share(able)? (copy|data|subset))")
RX_CLEAN = R(r"\b(clean|tidy|fix (the|my)? ?data|standardi[sz]e|deduplicate|remove duplicates?)\b")
RX_HEALTH = R(r"\b(problems?|issues?|errors?|quality|health|missing|outliers?|duplicates?|mistakes?|wrong)\b")
RX_DASH = R(r"\bdash ?boards?\b|\bboard\b")
RX_MAP = R(r"\b(maps?|where|locations?|gps|geograph|spatial)\b")
RX_STATUS = R(r"\b(status|how is|how's|progress|today|so far|going|active|live|collection|arrived|latest|last response)\b")
RX_CARDS = R(r"\b(kpis?|cards?|key (numbers|figures|metrics)|headline|stats? cards?)\b")
RX_SHAPE = R(r"\b(infographic|rings?|pictograms?|shapes?|icons?|funnel|gauge|pills?)\b")
RX_TABLE = R(r"\b(table|cross ?tab|pivot|breakdown|frequenc|counts?)\b")
RX_CHART = R(r"\b(charts?|graphs?|plots?|bars?|pie|donut|histogram|trend|over time|visuali[sz]e|scatter|distribution)\b")
RX_ABOUT = R(r"\b(about (my|the|this) data|summar|insights?|tell me|describe|overview|what('s| is) in|explain (my|the) data|analy[sz]e)\b")
RX_SURVEYS = R(r"\b(my surveys|all (my )?surveys|which survey|list (of )?surveys)\b")
RX_HELLO = R(r"^\s*(hi|hello|hey|salaam|salam|bonjour|good (morning|afternoon|evening)|help|what can you do)\b")


def builtin_plan(ctx: eng.AgentContext, message: str) -> dict:
    m = message or ""
    has_data = ctx.survey is not None and ctx.can.get("view") and not ctx.frame.empty
    fields = match_fields(ctx, m) if ctx.survey is not None and ctx.can.get("view") else []

    if RX_HELLO.search(m) and len(m) < 40:
        return {"say": ("Hi! I'm **Kora**. I can draft questionnaires, tell you how a survey is going, "
                        "make charts, tables, maps, KPI cards and dashboards you can download, clean your data, "
                        "and make a privacy-safe copy to share. What shall we play?"),
                "mood": "happy", "actions": [],
                "suggestions": ["How is collection going?", "Make a dashboard", "Draft a household survey"]}

    if RX_REVIEW.search(m) and ctx.survey is not None:
        return {"say": "Here's a check of your questionnaire.", "mood": "thinking",
                "actions": [{"tool": "review_form"}], "suggestions": ["Fix the placeholder options", "Add a consent question"]}

    if RX_QUESTIONNAIRE.search(m) and not RX_CHART.search(m):
        q = template_questionnaire(m)
        if ctx.page == "builder" and ctx.survey is not None:
            q["questions"] = _skip_existing(q["questions"], ctx.draft_schema or ctx.survey.draft_schema)
        return {"say": f"Here's a starter questionnaire: **{q['title']}**. Add it to your form or create a new survey from it, then tweak the wording in the builder.",
                "mood": "proud", "actions": [{"tool": "questionnaire", **q,
                                              "mode": "append" if ctx.page == "builder" else "new"}],
                "suggestions": ["Add skip logic ideas", "Review my form"]}

    if ctx.survey is None:
        if RX_SURVEYS.search(m) or RX_STATUS.search(m) or RX_ABOUT.search(m):
            return {"say": "Here are your surveys. Pick one in my menu to dig into its data.", "mood": "happy",
                    "actions": [{"tool": "surveys"}], "suggestions": ["Draft a new questionnaire"]}
        return {"say": ("Open a survey (or pick one in my menu) and I'll chart, clean and summarise its data. "
                        "I can also draft a brand-new questionnaire right now."),
                "mood": "curious", "actions": [], "suggestions": ["Draft a health survey", "Show my surveys"]}

    if not ctx.can.get("view"):
        return {"say": "You can't see this survey's data, but I can review or extend the questionnaire.",
                "mood": "curious", "actions": [], "suggestions": ["Review my form"]}

    if RX_STATUS.search(m) and not RX_CHART.search(m):
        return {"say": "Here's how the survey is doing right now.", "mood": "happy",
                "actions": [{"tool": "overview"}, {"tool": "chart", "kind": "timeseries"}] if has_data else [{"tool": "overview"}],
                "suggestions": ["Where are responses coming from?", "Any data problems?"]}

    if not has_data:
        return {"say": "There are no responses yet, so there's nothing to analyse. Once data arrives I can chart and clean it — meanwhile I can review the questionnaire.",
                "mood": "curious", "actions": [{"tool": "overview"}], "suggestions": ["Review my form"]}

    if RX_PRIVACY.search(m):
        return {"say": "I've made a privacy-safe copy: personal identifiers removed or coded, exact dates and places generalised. Check the decisions, then download or save it.",
                "mood": "proud", "actions": [{"tool": "privacy", "suppress": bool(re.search(r"small group|k-?anon|unique", m, re.I))}],
                "suggestions": ["Hide small groups too", "Keep the region column"]}

    if RX_CLEAN.search(m):
        return {"say": "Here's a cleaned copy using safe first steps — your original responses stay untouched. Save it as a Data Studio pipeline to reuse it.",
                "mood": "proud", "actions": [{"tool": "clean", "auto": True}],
                "suggestions": ["Any other data problems?", "Make a privacy-safe copy"]}

    if RX_HEALTH.search(m) and not RX_CHART.search(m):
        return {"say": "I ran a health check on every column.", "mood": "thinking",
                "actions": [{"tool": "profile"}], "suggestions": ["Clean my data", "Make a privacy-safe copy"]}

    if RX_DASH.search(m):
        return {"say": "Here's a dashboard built from your questions. Open it as a live dashboard or download it as an HTML file.",
                "mood": "proud", "actions": [{"tool": "dashboard", "auto": True}],
                "suggestions": ["Use the ocean theme", "Add a map"]}

    if RX_MAP.search(m) and not RX_TABLE.search(m):
        color = next((f for f in fields if f["kind"] == "choice"), None)
        return {"say": "Here's where responses came from.", "mood": "happy",
                "actions": [{"tool": "map", **({"color_by": color["name"]} if color else {})}],
                "suggestions": ["Colour the map by region", "How is collection going?"]}

    if RX_CARDS.search(m):
        return {"say": "Your key numbers:", "mood": "happy", "actions": [{"tool": "cards"}],
                "suggestions": ["Make a dashboard", "Chart responses over time"]}

    if RX_SHAPE.search(m):
        f = next((f for f in fields if f["kind"] == "choice"), None) or _first_choice_field(ctx)
        kind = "funnel" if "funnel" in m.lower() else "pictogram" if re.search(r"pictogram|icons?|people", m, re.I) else \
            "gauge" if "gauge" in m.lower() else "ring"
        if f:
            return {"say": f"Here's “{f['label']}” as {kind}s.", "mood": "proud",
                    "actions": [{"tool": "shape", "kind": kind, "x": f["name"]}],
                    "suggestions": ["Make it a pictogram", "Make a dashboard"]}

    if RX_TABLE.search(m) and fields:
        if len(fields) >= 2 and re.search(r"\bby\b|\bacross\b|\bversus\b|\bvs\b|cross", m, re.I):
            return {"say": f"Cross-tab of {fields[0]['label']} by {fields[1]['label']}.", "mood": "happy",
                    "actions": [{"tool": "table", "mode": "crosstab", "x": fields[0]["name"], "group_by": fields[1]["name"],
                                 "percent": "row" if re.search(r"percent|%|share", m, re.I) else None}],
                    "suggestions": ["Show it as a stacked chart", "Chart responses over time"]}
        f = fields[0]
        mode = "group" if f["kind"] == "choice" and any(x["kind"] == "number" for x in fields[1:]) else \
            "summary" if f["kind"] == "number" else "frequency"
        act = {"tool": "table", "mode": mode, "x": f["name"]}
        if mode == "group":
            act.update({"group_by": f["name"], "y": next(x["name"] for x in fields[1:] if x["kind"] == "number")})
        if mode == "summary":
            act["columns"] = [x["name"] for x in fields if x["kind"] == "number"]
        return {"say": f"Here's the table for {f['label']}.", "mood": "happy", "actions": [act],
                "suggestions": ["Chart this", "Any data problems?"]}

    if RX_CHART.search(m) or fields:
        if re.search(r"over time|trend|per day|daily|weekly|monthly|timeline", m, re.I):
            freq = "W" if re.search(r"week", m, re.I) else "M" if re.search(r"month", m, re.I) else "D"
            grp = next((f["name"] for f in fields if f["kind"] == "choice"), None)
            return {"say": "Responses over time.", "mood": "happy",
                    "actions": [{"tool": "chart", "kind": "timeseries", "freq": freq, "group_by": grp}],
                    "suggestions": ["Make it cumulative", "How is collection going?"]}
        if not fields:
            f = _first_choice_field(ctx)
            if not f:
                return {"say": "Tell me which question to chart — for example “chart of sex by region”.",
                        "mood": "curious", "actions": [], "suggestions": []}
            fields = [f]
        f = fields[0]
        kind = "pie" if re.search(r"\bpie\b", m, re.I) else "donut" if "donut" in m.lower() else \
            "histogram" if f["kind"] == "number" and not re.search(r"\bbar\b", m, re.I) else \
            "hbar" if f["kind"] == "choice" and len(f.get("choices") or []) > 5 else "bar"
        act = {"tool": "chart", "kind": kind, "x": f["name"]}
        explicit_round = kind in ("pie", "donut")
        wants_split = bool(re.search(r"\b(by|per|across|split|versus|vs|against|compared?|for each)\b", m, re.I))
        if len(fields) >= 2 and (wants_split or fields[1]["kind"] == "number") and not explicit_round:
            second = fields[1]
            if f["kind"] == "number" and second["kind"] == "number":
                act = {"tool": "chart", "kind": "scatter", "x": f["name"], "y": second["name"]}
            elif f["kind"] == "choice" and second["kind"] == "number":
                act.update({"y": second["name"], "agg": "mean", "kind": "bar"})
            elif f["kind"] == "number" and second["kind"] == "choice":
                act = {"tool": "chart", "kind": "bar", "x": second["name"], "y": f["name"], "agg": "mean"}
            elif second["kind"] == "choice":
                act.update({"group_by": second["name"], "kind": "stacked" if "stack" in m.lower() else "bar"})
        say = (f"{f['label']} split by {ctx.label(act['group_by'])}." if act.get("group_by") else
               f"Average {ctx.label(act['y'])} by {ctx.label(act['x'])}." if act.get("y") and act.get("agg") == "mean" else
               f"{ctx.label(act['y'])} against {ctx.label(act['x'])}." if act.get("kind") == "scatter" else
               f"Here's {f['label']}.")
        return {"say": say, "mood": "proud", "actions": [act],
                "suggestions": ["Split it by another question", "Show it as a table"]}

    if RX_ABOUT.search(m) or True:
        acts = [{"tool": "overview"}, {"tool": "cards"}]
        f = _first_choice_field(ctx)
        if f:
            acts.append({"tool": "chart", "kind": "hbar", "x": f["name"]})
        return {"say": "Here's a quick tour of your data. Ask me about any question by name — “chart of age”, “water source by region”, “clean my data”.",
                "mood": "happy", "actions": acts[:3],
                "suggestions": ["Any data problems?", "Make a dashboard", "Make a privacy-safe copy"]}


# ─────────────────────────── questionnaire templates ───────────────────────────

def _q(type_, label, name=None, choices=None, required=True, relevant=None, hint="", validate=None, **kw):
    q = {"type": type_, "label": label, "name": name or eng.slugify_name(label)[:30], "required": required, "hint": hint}
    if choices:
        q["choices"] = [{"value": eng.slugify_name(c, "opt") if not isinstance(c, tuple) else c[0],
                         "label": c if not isinstance(c, tuple) else c[1]} for c in choices]
    if relevant:
        q["relevant"] = {"op": "and", "rules": [{"q": relevant[0], "cmp": relevant[1], "value": relevant[2]}]}
    if validate:
        q["validate"] = validate
    q.update(kw)
    return q


YESNO = [("yes", "Yes"), ("no", "No")]
GAMBIA_REGIONS = ["Banjul", "Kanifing", "West Coast", "North Bank", "Lower River", "Central River", "Upper River"]
SATISFY = [("1", "Very dissatisfied"), ("2", "Dissatisfied"), ("3", "Neutral"), ("4", "Satisfied"), ("5", "Very satisfied")]


def _intro(topic):
    return [
        _q("note", f"About this survey", name="intro", required=False,
           hint=f"Thank you for taking part. We are collecting views on {topic}. It takes about 10 minutes, answers are confidential, and you may stop at any time."),
        _q("select_one", "Do you agree to take part in this survey?", name="consent", choices=YESNO),
        _q("section", "About you", name="sec_about", required=False, relevant=("consent", "eq", "yes")),
        _q("integer", "How old are you?", name="age", relevant=("consent", "eq", "yes"),
           validate={"min": 10, "max": 110, "message": "Enter an age between 10 and 110."}),
        _q("select_one", "Sex", name="sex", choices=[("female", "Female"), ("male", "Male"), ("prefer_not", "Prefer not to say")],
           relevant=("consent", "eq", "yes")),
        _q("select_one", "Which region do you live in?", name="region", choices=GAMBIA_REGIONS, relevant=("consent", "eq", "yes")),
    ]


def _gated(items):
    for q in items:
        if not q.get("relevant") and q["name"] not in ("intro", "consent"):
            q["relevant"] = {"op": "and", "rules": [{"q": "consent", "cmp": "eq", "value": "yes"}]}
    return items


TEMPLATES = [
    (R(r"household|family|home|poverty|livelihood"), "Household survey", "household living conditions", lambda: [
        _q("section", "Household", name="sec_hh", required=False),
        _q("integer", "How many people live in this household?", name="hh_size", validate={"min": 1, "max": 60}),
        _q("repeat", "Household members", name="members", required=False,
           repeat={"count_expr": "hh_size", "item_label": "Member ${index}"},
           children=[_q("integer", "Age of this member", name="m_age", validate={"min": 0, "max": 110}),
                     _q("select_one", "Sex of this member", name="m_sex", choices=[("female", "Female"), ("male", "Male")]),
                     _q("select_one", "Attends school?", name="m_school", choices=YESNO, required=False)]),
        _q("select_one", "What is the household's main source of income?", name="income_source",
           choices=["Farming", "Fishing", "Trading", "Salaried job", "Casual labour", "Remittances", "Other"]),
        _q("text", "Please specify the other income source", name="income_other", relevant=("income_source", "eq", "other")),
        _q("select_one", "What is the main source of drinking water?", name="water_source",
           choices=["Piped into home", "Public tap", "Borehole", "Protected well", "Unprotected well", "Surface water", "Other"]),
        _q("select_one", "In the past 30 days, did the household go a whole day without eating?", name="food_gap",
           choices=YESNO + [("dk", "Don't know")]),
        _q("select_multiple", "Which of these does the household own?", name="assets", required=False,
           choices=["Radio", "TV", "Mobile phone", "Bicycle", "Motorbike", "Fridge", "Solar panel"]),
        _q("gps", "Record the household location", name="hh_gps", required=False),
    ]),
    (R(r"health|clinic|hospital|patient|medical|nutrition|vaccin"), "Health facility exit survey", "the health services you received", lambda: [
        _q("section", "Your visit", name="sec_visit", required=False),
        _q("select_one", "What was the main reason for today's visit?", name="visit_reason",
           choices=["Illness", "Antenatal care", "Child health / vaccination", "Family planning", "Follow-up", "Other"]),
        _q("integer", "How long did you wait before being seen (minutes)?", name="wait_minutes", validate={"min": 0, "max": 720}),
        _q("likert", "Staff treated me with respect.", name="respect"),
        _q("likert", "The health worker explained my condition clearly.", name="explained"),
        _q("select_one", "Did you get all the medicines you were prescribed?", name="got_meds",
           choices=YESNO + [("none_prescribed", "None prescribed")]),
        _q("select_multiple", "Why not?", name="meds_why", relevant=("got_meds", "eq", "no"),
           choices=["Out of stock", "Too expensive", "Pharmacy closed", "Other"]),
        _q("select_one", "Overall, how satisfied are you with today's visit?", name="satisfaction", choices=SATISFY),
        _q("rating", "How likely are you to recommend this facility (1–10)?", name="recommend", validate={"max": 10}),
        _q("long_text", "What one thing should the facility improve?", name="improve", required=False),
    ]),
    (R(r"school|education|student|pupil|teacher|learning|class"), "School and learning survey", "schooling and learning", lambda: [
        _q("section", "School", name="sec_school", required=False),
        _q("select_one", "Which grade are you (or your child) in?", name="grade",
           choices=["Grade 1–3", "Grade 4–6", "Grade 7–9", "Grade 10–12", "Not in school"]),
        _q("select_one", "Why not in school?", name="why_not_school", relevant=("grade", "eq", "not_in_school"),
           choices=["Cost", "Distance", "Work at home", "Marriage", "Illness", "Other"]),
        _q("integer", "How many minutes does it take to reach school?", name="travel_minutes", validate={"min": 0, "max": 300},
           relevant=("grade", "ne", "not_in_school")),
        _q("integer", "Days absent in the last month", name="days_absent", validate={"min": 0, "max": 31}),
        _q("select_one", "Do you have the textbooks you need?", name="textbooks", choices=YESNO + [("some", "Some")]),
        _q("likert", "My teachers are present and teach every day.", name="teacher_present"),
        _q("select_one", "Is there a working toilet at the school?", name="toilet", choices=YESNO + [("dk", "Don't know")]),
        _q("long_text", "What would most improve learning at your school?", name="improve", required=False),
    ]),
    (R(r"water|wash|sanitation|hygiene|toilet|latrine"), "WASH survey", "water, sanitation and hygiene", lambda: [
        _q("section", "Water", name="sec_water", required=False),
        _q("select_one", "Main source of drinking water", name="water_source",
           choices=["Piped into home", "Public tap", "Borehole", "Protected well", "Unprotected well", "Surface water", "Other"]),
        _q("integer", "Minutes for a round trip to collect water", name="fetch_minutes", validate={"min": 0, "max": 600}),
        _q("select_one", "Do you treat your water before drinking?", name="treat", choices=YESNO),
        _q("select_multiple", "How do you treat it?", name="treat_how", relevant=("treat", "eq", "yes"),
           choices=["Boil", "Chlorine", "Filter", "Let it stand", "Other"]),
        _q("section", "Sanitation and hygiene", name="sec_san", required=False),
        _q("select_one", "What toilet does the household use?", name="toilet",
           choices=["Flush to sewer/septic", "Pit latrine with slab", "Pit latrine without slab", "Shared toilet", "None (open defecation)"]),
        _q("select_one", "Is there soap and water at the handwashing place?", name="soap", choices=YESNO + [("no_place", "No handwashing place")]),
        _q("photo", "Photo of the handwashing place", name="hw_photo", required=False),
    ]),
    (R(r"farm|agri|crop|harvest|livestock|seed|fertili"), "Farm and harvest survey", "farming and harvests", lambda: [
        _q("section", "Your farm", name="sec_farm", required=False),
        _q("select_multiple", "Which crops did you grow this season?", name="crops",
           choices=["Groundnut", "Rice", "Millet", "Maize", "Sorghum", "Vegetables", "Cashew", "Other"]),
        _q("decimal", "Farm size (hectares)", name="farm_ha", validate={"min": 0, "max": 500}),
        _q("decimal", "Harvest of your main crop (kg)", name="harvest_kg", validate={"min": 0, "max": 100000}),
        _q("select_one", "Did you use fertiliser?", name="fertiliser", choices=YESNO),
        _q("select_one", "Where do you mostly sell your produce?", name="market",
           choices=["Local market", "Lumo (weekly market)", "Trader at farm gate", "Cooperative", "Do not sell"]),
        _q("select_multiple", "Biggest challenges this season", name="challenges",
           choices=["Late rains", "Pests", "No seed", "No fertiliser", "Labour", "Low prices", "Transport", "Other"]),
        _q("mapper", "Walk the farm boundary", name="farm_area", required=False),
    ]),
    (R(r"event|training|workshop|conference|webinar|session|meeting"), "Event feedback survey", "this event", lambda: [
        _q("section", "The event", name="sec_event", required=False),
        _q("select_one", "Overall, how satisfied are you with the event?", name="satisfaction", choices=SATISFY),
        _q("likert", "The content was relevant to my work.", name="relevant_content"),
        _q("likert", "The facilitators were clear and engaging.", name="facilitators"),
        _q("likert", "The venue and logistics worked well.", name="logistics"),
        _q("rating", "How likely are you to recommend this event (0–10)?", name="nps", validate={"max": 10}),
        _q("long_text", "What was the most useful thing you learned?", name="learned", required=False),
        _q("long_text", "What should we do differently next time?", name="improve", required=False),
    ]),
    (R(r"customer|client|service|satisfaction|feedback|product|shop|market"), "Customer satisfaction survey", "our service", lambda: [
        _q("section", "Your experience", name="sec_exp", required=False),
        _q("select_one", "How often do you use our service?", name="frequency",
           choices=["First time", "Monthly", "Weekly", "Daily"]),
        _q("select_one", "Overall, how satisfied are you?", name="satisfaction", choices=SATISFY),
        _q("rating", "How likely are you to recommend us to a friend (0–10)?", name="nps", validate={"max": 10}),
        _q("select_multiple", "What do you like most?", name="likes", required=False,
           choices=["Price", "Quality", "Speed", "Staff", "Location", "Other"]),
        _q("long_text", "What should we improve?", name="improve", required=False),
    ]),
    (R(r"staff|employee|hr|workplace|team|job"), "Staff wellbeing survey", "your work and wellbeing", lambda: [
        _q("section", "Your work", name="sec_work", required=False),
        _q("select_one", "How long have you worked here?", name="tenure",
           choices=["Under 1 year", "1–3 years", "3–5 years", "Over 5 years"]),
        _q("likert", "I have the tools I need to do my job.", name="tools"),
        _q("likert", "My workload is manageable.", name="workload"),
        _q("likert", "I see a future for myself here.", name="future"),
        _q("select_one", "Overall job satisfaction", name="satisfaction", choices=SATISFY),
        _q("long_text", "One change that would make work better", name="change", required=False),
    ]),
]


def _skip_existing(questions, schema):
    """Appending a template to a form that already asks consent/age/sex…:
    leave those out, so the template's skip logic points at the form's own
    question instead of a renamed duplicate. Only same-named, same-typed
    questions are skipped, and consent only if it really has a "yes"."""
    have = {}
    for q in (schema or {}).get("questions") or []:
        if isinstance(q, dict) and q.get("name"):
            have[q["name"]] = q
    out = []
    for q in questions:
        old = have.get(q.get("name"))
        same = old is not None and old.get("type") == q.get("type")
        if same and q.get("name") == "consent":
            same = any(str(c.get("value")) == "yes" for c in old.get("choices") or [] if isinstance(c, dict))
        if same or (old is not None and q.get("type") in ("note", "section") and q.get("name") in ("intro", "sec_about")):
            continue
        out.append(q)
    return out


def template_questionnaire(message: str) -> dict:
    topic_match = re.search(r"(?:about|on|for)\s+([^.?!,]{3,60})", message, re.I)
    topic = topic_match.group(1).strip() if topic_match else "this topic"
    for rx, title, intro_topic, build in TEMPLATES:
        if rx.search(message):
            qs = _intro(intro_topic) + build()
            return {"title": title, "description": f"Starter questionnaire on {intro_topic}.",
                    "questions": _gated(qs)}
    qs = _intro(topic) + [
        _q("section", "Your experience", name="sec_main", required=False),
        _q("select_one", f"Have you heard of {topic}?", name="aware", choices=YESNO),
        _q("select_one", "How did you hear about it?", name="heard_how", relevant=("aware", "eq", "yes"),
           choices=["Radio", "TV", "Social media", "Friends or family", "Community meeting", "Other"]),
        _q("select_one", "Overall, how satisfied are you?", name="satisfaction", choices=SATISFY, relevant=("aware", "eq", "yes")),
        _q("select_multiple", "What are the main challenges?", name="challenges", required=False,
           choices=["Cost", "Distance", "Information", "Quality", "Time", "Other"]),
        _q("long_text", "Any suggestions?", name="suggestions", required=False),
    ]
    return {"title": f"Survey on {topic}"[:120], "description": f"Starter questionnaire on {topic}.",
            "questions": _gated(qs)}


# ─────────────────────────── entry point ───────────────────────────
#
# A turn is split in three so the async view can keep database work on
# Django's thread and send only the network call to a worker thread:
#
#   prepare()  DB thread   → prompt (or None) + why the AI is skipped
#   call_ai()  worker      → (plan, model)          [only when prompt]
#   finish()   DB thread   → final plan, model, notice (built-in fallback)

def prepare(ctx: eng.AgentContext, message: str, history: list, use_ai: bool):
    if use_ai and ai_enabled():
        return build_user_prompt(ctx, message, history), None
    if not ai_enabled():
        return None, "AI isn't switched on for this server yet (GEMINI_API_KEY)"
    return None, "You've used this hour's AI turns"


def finish(ctx: eng.AgentContext, message: str, ai_result=None, reason=None):
    if ai_result is not None:
        p, model = ai_result
        if p["say"] or p["actions"]:
            return p, model, None
        reason = "The AI sent back an empty answer"
    p = normalise_plan(builtin_plan(ctx, message))
    notice = f"{(reason or 'The AI was unavailable').rstrip('.')} — so I used my built-in skills. They know the basics; try again later for the full AI."
    return p, "kora-builtin", notice


def run_ai_safely(prompt):
    """call_ai() that never raises: returns (result_or_None, reason_or_None)."""
    try:
        return call_ai(prompt), None
    except AgentError as e:
        return None, str(e).rstrip(".")
    except Exception:
        logger.exception("Kora: AI planning failed — using built-in skills")
        return None, "The AI hit an unexpected problem"


def plan(ctx: eng.AgentContext, message: str, history: list, use_ai: bool):
    """Synchronous convenience (management commands, shell, tests)."""
    prompt, reason = prepare(ctx, message, history, use_ai)
    result = None
    if prompt:
        result, reason = run_ai_safely(prompt)
    return finish(ctx, message, result, reason)
