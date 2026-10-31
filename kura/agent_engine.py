"""
kura/agent_engine.py — the deterministic half of Kora, Kura's AI assistant.

The split that keeps Kora honest
────────────────────────────────
The language model (kura/agent_ai.py) only ever *plans*: it reads column
metadata and aggregate statistics and answers with a list of tool calls
("bar chart of sex", "privacy-safe copy dropping phone numbers"). Every
number the user sees is then computed HERE, by pandas, on the real rows,
reusing Kura's own engines:

    charts / tiles  → dashboard_engine.frame_timeseries / compute_tile
    maps            → analytics.map_points (same GPS priority rule)
    filters         → PipelineExecutor._combined_mask (same condition shape)
    cleaning        → PipelineExecutor._apply_step (all studio operations)

So a chart can never show a hallucinated percentage, and a cleaning step
Kora proposes behaves byte-for-byte like the same step in the Data Studio.

Privacy
───────
The model never receives answer values for free-text, identifying or media
questions — only counts. Choice and numeric questions contribute aggregates
(top options with %, mean/median). `detect_pii` classifies every column so
the privacy tool, the prompt digest and the auto dashboard all agree on what
is personal.
"""

from __future__ import annotations

import hashlib
import hmac
import math
import re
from collections import Counter
from dataclasses import dataclass, field as dc_field
from datetime import timedelta

import numpy as np
import pandas as pd
from django.conf import settings
from django.utils import timezone

from .models import Survey

# ─────────────────────────────────────────────────────────────────────
#  Constants
# ─────────────────────────────────────────────────────────────────────

NUMERIC_TYPES = {"integer", "decimal", "rating", "calculate", "number", "range"}
CHOICE_TYPES = {"select_one", "select_multiple", "likert", "rank"}
DATE_TYPES = {"date", "datetime", "time"}
GEO_TYPES = {"gps", "mapper", "geopoint"}
MEDIA_TYPES = {"photo", "audio", "signature"}
TEXT_TYPES = {"text", "long_text", "barcode", "string"}
DISPLAY_TYPES = {"section", "note"}

META_LABELS = {
    "_received_at": "Received at",
    "_status": "Row status",
    "_source": "Collected via",
    "_score": "Score",
    "_duration_s": "Time to complete (seconds)",
    "_gps_lat": "Device latitude",
    "_gps_lng": "Device longitude",
    "_uuid": "Submission ID",
    "_submission_id": "Internal row ID",
}
HIDDEN_META = {"_submission_id", "_enumerator_id"}

MAX_FILTERS = 10
MAX_PREVIEW_ROWS = 60
MAX_TABLE_ROWS = 400
MAX_MAP_POINTS = 4000
MAX_STEPS = 30
MAX_TILES = 24
MAX_QUESTIONS = 300
MISSING_LABEL = "(no answer)"

QUESTION_TYPE_IDS = {
    "section", "note", "text", "long_text", "integer", "decimal", "select_one",
    "select_multiple", "rank", "likert", "rating", "date", "time", "datetime",
    "gps", "mapper", "photo", "barcode", "calculate", "repeat",
}
RULE_CMPS = {"eq", "ne", "gt", "gte", "lt", "lte", "contains", "not_contains",
             "selected", "not_selected", "answered", "not_answered", "between", "matches"}
FILTER_OPS = {"eq", "ne", "gt", "gte", "lt", "lte", "between", "in", "not_in",
              "contains", "not_contains", "starts_with", "ends_with",
              "answered", "not_answered"}
AGGS = {"count", "sum", "mean", "median", "min", "max", "distinct", "filled", "missing"}


class ToolError(Exception):
    """A user-presentable tool failure (shown in the chat as-is)."""


# ─────────────────────────────────────────────────────────────────────
#  Small helpers
# ─────────────────────────────────────────────────────────────────────

def safe(value):
    """JSON-safe scalar."""
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating, float)):
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return None
        return round(f, 4)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, (list, dict, str, int, bool)):
        return value
    return str(value)


def is_blank(value) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    if isinstance(value, (list, dict)):
        return len(value) == 0
    try:
        if pd.isna(value):
            return True
    except (TypeError, ValueError):
        pass
    return str(value).strip() in ("", "None", "nan", "NaN")


def blank_mask(series: pd.Series) -> pd.Series:
    return series.apply(is_blank)


def numeric(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def fmt_num(value, places=1) -> str:
    if value is None:
        return "—"
    try:
        f = float(value)
    except (TypeError, ValueError):
        return str(value)
    if f.is_integer():
        return f"{int(f):,}"
    return f"{f:,.{places}f}"


def pct(part, whole, places=1):
    if not whole:
        return 0.0
    return round(float(part) * 100.0 / float(whole), places)


def _clip_text(text, n):
    text = str(text or "")
    return text if len(text) <= n else text[: n - 1] + "…"


def slugify_name(text, fallback="q"):
    base = re.sub(r"[^a-z0-9]+", "_", str(text or "").lower()).strip("_")[:32] or fallback
    if base[0].isdigit():
        base = "q_" + base
    return base


# ─────────────────────────────────────────────────────────────────────
#  Field catalogue
# ─────────────────────────────────────────────────────────────────────

def survey_schema(survey) -> dict:
    if survey is None:
        return {}
    v = survey.current_version
    return (v.schema if v else survey.draft_schema) or {}


def _kind_for(qtype):
    if qtype in NUMERIC_TYPES:
        return "number"
    if qtype in CHOICE_TYPES:
        return "choice"
    if qtype in DATE_TYPES:
        return "date"
    if qtype in GEO_TYPES:
        return "geo"
    if qtype in MEDIA_TYPES:
        return "media"
    if qtype == "repeat":
        return "repeat"
    return "text"


def build_catalog(schema: dict) -> list[dict]:
    """Every analysable column, named exactly as it appears in the frame.

    Calculated questions live in Submission.calculations, which the frame
    exposes as ``calc__<name>`` — the catalogue uses that column name so a
    tile Kora saves keeps working in the live dashboard engine.
    """
    out = []
    for q in (schema or {}).get("questions") or []:
        if not isinstance(q, dict):
            continue
        name, qtype = q.get("name"), q.get("type")
        if not name or qtype in DISPLAY_TYPES:
            continue
        choices = []
        for ch in q.get("choices") or []:
            if isinstance(ch, dict):
                choices.append({"value": str(ch.get("value")), "label": str(ch.get("label") or ch.get("value"))})
            else:
                choices.append({"value": str(ch), "label": str(ch)})
        out.append({
            "name": f"calc__{name}" if qtype == "calculate" else name,
            "question": name,
            "label": _clip_text(q.get("label") or name, 140),
            "type": qtype,
            "kind": _kind_for(qtype),
            "multi": qtype in ("select_multiple", "rank"),
            "ordered": qtype in ("likert", "rating"),
            "choices": choices,
            "required": bool(q.get("required")),
            "children": [c.get("name") for c in (q.get("children") or []) if isinstance(c, dict)],
        })
    out.append({"name": "_received_at", "question": None, "label": "Received at", "type": "datetime",
                "kind": "date", "multi": False, "ordered": False, "choices": [], "meta": True})
    out.append({"name": "_source", "question": None, "label": "Collected via", "type": "select_one",
                "kind": "choice", "multi": False, "ordered": False, "meta": True,
                "choices": [{"value": "web", "label": "Web link"}, {"value": "app", "label": "Phone app"}]})
    out.append({"name": "_status", "question": None, "label": "Row status", "type": "select_one",
                "kind": "choice", "multi": False, "ordered": False, "meta": True, "choices": []})
    out.append({"name": "_duration_s", "question": None, "label": "Time to complete (seconds)",
                "type": "decimal", "kind": "number", "multi": False, "ordered": False,
                "choices": [], "meta": True})
    return out


def label_map(field) -> dict:
    return {c["value"]: c["label"] for c in (field or {}).get("choices") or []}


# ─────────────────────────────────────────────────────────────────────
#  Context
# ─────────────────────────────────────────────────────────────────────

@dataclass
class AgentContext:
    user: object
    survey: Survey | None = None
    access: object = None
    page: str = "list"
    schema: dict = dc_field(default_factory=dict)
    draft_schema: dict | None = None      # the builder's live (maybe unsaved) form
    catalog: list = dc_field(default_factory=list)
    can: dict = dc_field(default_factory=dict)
    _frame: pd.DataFrame | None = None
    scope_user_ids: list | None = None    # supervisor without whole-survey view

    @property
    def fields(self) -> dict:
        if not hasattr(self, "_fields_cache"):
            self._fields_cache = {f["name"]: f for f in self.catalog}
        return self._fields_cache

    @property
    def frame(self) -> pd.DataFrame:
        if self._frame is None:
            if self.survey is None:
                self._frame = pd.DataFrame()
            else:
                self._frame = load_frame(self.survey, self.scope_user_ids)
        return self._frame

    def field(self, name):
        return self.fields.get(name)

    def label(self, name):
        f = self.fields.get(name)
        if f:
            return f["label"]
        return META_LABELS.get(name, name)


def load_frame(survey, scope_user_ids=None, include_excluded=False) -> pd.DataFrame:
    """One row per submission — the same shape the studio pipeline sees
    (pipeline_engine.survey_dataframe), plus `_duration_s`."""
    qs = survey.submissions.select_related("form_version").order_by("received_at", "id")
    if not include_excluded:
        qs = qs.exclude(status="excluded")
    if scope_user_ids is not None:
        qs = qs.filter(enumerator_id__in=scope_user_ids)
    rows = []
    for sub in qs.iterator(chunk_size=2000):
        row = {
            "_submission_id": sub.id,
            "_uuid": str(sub.client_uuid),
            "_status": sub.status,
            "_source": sub.source,
            "_received_at": sub.received_at.isoformat() if sub.received_at else None,
            "_gps_lat": sub.gps_lat,
            "_gps_lng": sub.gps_lng,
            "_duration_s": round((sub.duration_ms or 0) / 1000.0, 1) if sub.duration_ms else None,
        }
        row.update(sub.answers or {})
        row.update({f"calc__{k}": v for k, v in (sub.calculations or {}).items()})
        if sub.score is not None:
            row["_score"] = sub.score
        rows.append(row)
    return pd.DataFrame(rows)


def public_columns(df: pd.DataFrame) -> list:
    return [c for c in df.columns if c not in HIDDEN_META]


# ─────────────────────────────────────────────────────────────────────
#  Privacy: classify every column
# ─────────────────────────────────────────────────────────────────────

_PLACE_WORDS = re.compile(
    r"\b(village|town|city|school|facility|clinic|hospital|health ?cent(er|re)|organi[sz]ation|"
    r"company|business|shop|market|community|district|region|ward|lga|province|county|project|"
    r"product|brand|programme|program|site|station|crop|animal|livestock|item|event|venue)\b", re.I)
_DIRECT_PATTERNS = [
    (re.compile(r"\b(e-?mail|email address)\b", re.I), "email address"),
    (re.compile(r"\b(phone|mobile|cell|tel(ephone)?|whatsapp|msisdn|contact number|contact no)\b", re.I), "phone number"),
    (re.compile(r"\b(national ?id|nin\b|id ?(number|no|card)|passport|voter|ssn|social security|"
                r"birth certificate|driver'?s? ?licen[cs]e|licen[cs]e ?(number|no))", re.I), "ID number"),
    (re.compile(r"\b(home address|address|street|house (number|no)|plot (number|no)|p\.?o\.? box)\b", re.I), "address"),
    (re.compile(r"\b(full ?name|first ?name|last ?name|surname|given ?name|family ?name|"
                r"respondent'?s? name|name of (the )?(respondent|person|child|head|mother|father|caregiver|"
                r"patient|participant|student|pupil|farmer|member|interviewee|beneficiary)|"
                r"^name$|your name|child'?s name|hh ?head name|head of household name)\b", re.I), "personal name"),
]
_QUASI_PATTERNS = [
    (re.compile(r"\b(date of birth|dob|birth ?date|birthday|born)\b", re.I), "date of birth", "year"),
    (re.compile(r"\b(age|how old|years old)\b", re.I), "age", "band10"),
    (re.compile(r"\b(sex|gender)\b", re.I), "sex / gender", "keep"),
    (re.compile(r"\b(village|town|community|settlement|locality|compound|neighbou?rhood|ward|"
                r"kabilo|quarter)\b", re.I), "small-area location", "keep"),
    (re.compile(r"\b(district|region|lga|province|county|division|state)\b", re.I), "area", "keep"),
    (re.compile(r"\b(occupation|job|profession|employer|workplace)\b", re.I), "occupation", "keep"),
    (re.compile(r"\b(marital|married|spouse)\b", re.I), "marital status", "keep"),
]
_SENSITIVE_PATTERNS = re.compile(
    r"\b(hiv|aids|disab|religio|ethnic|tribe|sexual|pregnan|income|salary|wage|earn|debt|loan|"
    r"diagnos|disease|illness|medical|medication|mental|violence|abuse|assault|crime|arrest|"
    r"vote|party|politic|immigra|refugee|asylum)\w*", re.I)
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"(?:\+?\d[\d\s().-]{6,}\d)")

ACTIONS = {"keep", "drop", "hash", "mask", "band5", "band10", "year", "month", "day",
           "round1", "round2", "round3", "topcode"}
ACTION_TEXT = {
    "keep": "kept as is",
    "drop": "removed",
    "hash": "replaced with a one-way code",
    "mask": "partly hidden",
    "band5": "grouped into 5-year bands",
    "band10": "grouped into 10-year bands",
    "year": "reduced to the year",
    "month": "reduced to the month",
    "day": "reduced to the day (time removed)",
    "round1": "rounded to ~11 km",
    "round2": "rounded to ~1 km",
    "round3": "rounded to ~110 m",
    "topcode": "very high values capped",
}


def detect_pii(fld: dict, series: pd.Series | None = None) -> dict:
    """Classify one column.

    level:  direct     — identifies a person on its own (name, phone, ID, photo, exact GPS)
            quasi      — identifies in combination (age, sex, village, birth date)
            sensitive  — special-category content (health, income, religion…)
            meta       — submission bookkeeping
            none       — ordinary answer
    action: the safe default the privacy tool applies.
    """
    name = fld.get("name") or ""
    qtype = fld.get("type") or ""
    text = f"{name.replace('_', ' ')} {fld.get('label') or ''}"
    place = bool(_PLACE_WORDS.search(text))

    if name in ("_uuid",):
        return {"level": "meta", "reason": "links back to the original submission", "action": "drop"}
    if name in ("_submission_id", "_enumerator_id"):
        return {"level": "meta", "reason": "internal row number", "action": "drop"}
    if name in ("_gps_lat", "_gps_lng"):
        return {"level": "direct", "reason": "exact device location", "action": "drop"}
    if name == "_received_at":
        return {"level": "quasi", "reason": "exact time of the visit", "action": "day"}
    if name in ("_status", "_source", "_score", "_duration_s"):
        return {"level": "meta", "reason": "collection detail", "action": "keep"}

    if qtype in MEDIA_TYPES:
        return {"level": "direct", "reason": f"{qtype} file can show the person", "action": "drop"}
    if qtype in GEO_TYPES:
        return {"level": "direct", "reason": "exact location (can point to a home)", "action": "drop"}
    if qtype == "barcode":
        return {"level": "direct", "reason": "scanned code is usually an ID", "action": "hash"}

    for rx, why in _DIRECT_PATTERNS:
        if rx.search(text) and not (why == "personal name" and place):
            act = "drop" if why in ("personal name", "address", "email address") else "hash"
            return {"level": "direct", "reason": why, "action": act}

    if qtype == "long_text":
        return {"level": "sensitive", "reason": "free text can contain names and stories", "action": "drop"}

    # Content scan of short text answers: emails / phone numbers typed into
    # an innocently named question.
    if series is not None and qtype in ("text", "string") and len(series):
        sample = [str(v) for v in series.dropna().head(200).tolist() if not isinstance(v, (list, dict))]
        if sample:
            emails = sum(1 for s in sample if _EMAIL_RE.search(s))
            phones = sum(1 for s in sample if _PHONE_RE.fullmatch(s.strip()))
            if emails >= max(2, len(sample) * 0.2):
                return {"level": "direct", "reason": "answers look like email addresses", "action": "drop"}
            if phones >= max(2, len(sample) * 0.3):
                return {"level": "direct", "reason": "answers look like phone numbers", "action": "hash"}

    for rx, why, act in _QUASI_PATTERNS:
        if rx.search(text):
            if why == "age" and fld.get("kind") != "number":
                act = "keep"
            if why == "date of birth" and fld.get("kind") != "date":
                act = "drop"
            return {"level": "quasi", "reason": why, "action": act}

    if fld.get("kind") == "date":
        return {"level": "quasi", "reason": "exact date", "action": "month"}

    if _SENSITIVE_PATTERNS.search(text):
        return {"level": "sensitive", "reason": "special-category topic", "action": "keep"}

    if qtype == "text" and not place:
        return {"level": "sensitive", "reason": "open text may name people", "action": "keep"}

    return {"level": "none", "reason": "", "action": "keep"}


# ─────────────────────────────────────────────────────────────────────
#  Digest: what the language model is allowed to see
# ─────────────────────────────────────────────────────────────────────

def _choice_counts(series: pd.Series, fld: dict):
    """Counter of choice values (exploding multi-selects) and answered rows."""
    lm = label_map(fld)
    counts = Counter()
    answered = 0
    for v in series.tolist():
        if is_blank(v):
            continue
        answered += 1
        if isinstance(v, list):
            for x in v:
                counts[lm.get(str(x), str(x))] += 1
        elif isinstance(v, str) and fld.get("multi") and " " in v.strip():
            for x in v.split():
                counts[lm.get(x, x)] += 1
        else:
            counts[lm.get(str(v), str(v))] += 1
    return counts, answered


def column_stats(df: pd.DataFrame, fld: dict) -> dict:
    """Aggregate-only statistics for one column."""
    name = fld["name"]
    n = len(df)
    if name not in df.columns:
        return {"rows": n, "answered": 0, "missing_pct": 100.0 if n else 0.0, "absent": True}
    s = df[name]
    miss = blank_mask(s)
    answered = int((~miss).sum())
    out = {"rows": n, "answered": answered, "missing_pct": pct(n - answered, n)}
    kind = fld.get("kind")
    if kind == "choice":
        counts, ans = _choice_counts(s, fld)
        total = ans if fld.get("multi") else sum(counts.values())
        out["top"] = [{"label": k, "n": int(v), "pct": pct(v, total)} for k, v in counts.most_common(8)]
        out["distinct"] = len(counts)
    elif kind == "number":
        nums = numeric(s).dropna()
        if len(nums):
            q1, q3 = nums.quantile(.25), nums.quantile(.75)
            iqr = q3 - q1
            outl = int(((nums < q1 - 3 * iqr) | (nums > q3 + 3 * iqr)).sum()) if iqr else 0
            out.update({"mean": safe(nums.mean()), "median": safe(nums.median()), "min": safe(nums.min()),
                        "max": safe(nums.max()), "sd": safe(nums.std(ddof=0)), "outliers": outl,
                        "non_numeric": int(answered - len(nums))})
    elif kind == "date":
        d = pd.to_datetime(s, errors="coerce", utc=True).dropna()
        if len(d):
            out.update({"first": d.min().date().isoformat(), "last": d.max().date().isoformat()})
    elif kind == "repeat":
        lens = [len(v) for v in s.tolist() if isinstance(v, list)]
        if lens:
            out.update({"items_mean": safe(np.mean(lens)), "items_max": int(max(lens))})
    elif kind in ("text",):
        vals = s[~miss].astype(str)
        out["distinct"] = int(vals.nunique())
    return out


def data_digest(ctx: AgentContext, max_fields=110) -> dict:
    """Survey + per-field aggregate summary. Never contains row values."""
    survey = ctx.survey
    if survey is None:
        return {}
    df = ctx.frame
    fields_out = []
    for fld in ctx.catalog[:max_fields]:
        series = df[fld["name"]] if fld["name"] in df.columns else None
        pii = detect_pii(fld, series)
        st = column_stats(df, fld) if not df.empty else {"rows": 0, "answered": 0, "missing_pct": 0}
        withhold = pii["level"] in ("direct",) or fld["kind"] in ("text", "media", "geo")
        if withhold:
            st = {k: v for k, v in st.items() if k in ("rows", "answered", "missing_pct", "distinct", "absent")}
        fields_out.append({"field": fld, "stats": st, "pii": pii})
    return {"fields": fields_out, "rows": int(len(df))}


# ─────────────────────────────────────────────────────────────────────
#  Filters
# ─────────────────────────────────────────────────────────────────────

def clean_filters(ctx: AgentContext, filters) -> list:
    out = []
    for f in (filters or [])[:MAX_FILTERS]:
        if not isinstance(f, dict):
            continue
        fld = f.get("field")
        op = f.get("operator") or f.get("op") or "eq"
        if op not in FILTER_OPS:
            op = "eq"
        if fld not in ctx.frame.columns:
            raise ToolError(f"There is no column called “{fld}”.")
        value = f.get("value")
        fld_meta = ctx.field(fld)
        # Let the model filter by a choice *label*; the data holds values.
        if fld_meta and fld_meta.get("choices") and value is not None:
            rev = {c["label"].lower(): c["value"] for c in fld_meta["choices"]}
            if isinstance(value, list):
                value = [rev.get(str(v).lower(), v) for v in value]
            else:
                value = rev.get(str(value).lower(), value)
        item = {"field": fld, "operator": op, "value": value}
        if op == "between":
            item["min"], item["max"] = f.get("min"), f.get("max")
        out.append(item)
    return out


def apply_filters(ctx: AgentContext, df: pd.DataFrame, filters, match="all") -> pd.DataFrame:
    filters = [f for f in filters or [] if f.get("field")]
    if not filters or df.empty:
        return df
    from .pipeline_engine import PipelineExecutor, PipelineExecutionError
    work = df
    # Multi-select membership ("has selected X") needs list awareness that the
    # pipeline mask does not have — handle eq/in on list cells here.
    simple = []
    masks = []
    for f in filters:
        col = f["field"]
        fld = ctx.field(col) or {}
        if fld.get("multi") and f["operator"] in ("eq", "in", "contains", "ne", "not_in"):
            wanted = f["value"] if isinstance(f["value"], list) else [f["value"]]
            wanted = {str(w) for w in wanted}

            def has(v, wanted=wanted):
                vals = v if isinstance(v, list) else (str(v).split() if not is_blank(v) else [])
                return bool(wanted & {str(x) for x in vals})
            m = work[col].apply(has)
            masks.append(~m if f["operator"] in ("ne", "not_in") else m)
        else:
            simple.append(f)
    try:
        if simple:
            masks.append(PipelineExecutor._combined_mask(work, {"conditions": simple, "match": match}))
    except PipelineExecutionError as exc:
        raise ToolError(str(exc))
    if not masks:
        return work
    combined = masks[0]
    for m in masks[1:]:
        combined = (combined | m) if match == "any" else (combined & m)
    return work.loc[combined.fillna(False).astype(bool)].copy()


def describe_filters(ctx, filters) -> str:
    if not filters:
        return ""
    words = {"eq": "=", "ne": "≠", "gt": ">", "gte": "≥", "lt": "<", "lte": "≤", "in": "is one of",
             "not_in": "is not one of", "contains": "contains", "not_contains": "doesn't contain",
             "answered": "is answered", "not_answered": "is blank", "between": "between",
             "starts_with": "starts with", "ends_with": "ends with"}
    parts = []
    for f in filters:
        fld = ctx.field(f["field"]) or {}
        lm = label_map(fld)
        v = f.get("value")
        if isinstance(v, list):
            v = ", ".join(lm.get(str(x), str(x)) for x in v)
        else:
            v = lm.get(str(v), v)
        if f["operator"] in ("answered", "not_answered"):
            parts.append(f"{ctx.label(f['field'])} {words[f['operator']]}")
        elif f["operator"] == "between":
            parts.append(f"{ctx.label(f['field'])} between {f.get('min')} and {f.get('max')}")
        else:
            parts.append(f"{ctx.label(f['field'])} {words.get(f['operator'], '=')} {v}")
    return "; ".join(parts)


# ─────────────────────────────────────────────────────────────────────
#  Dimension helpers
# ─────────────────────────────────────────────────────────────────────

def dim_series(ctx: AgentContext, df: pd.DataFrame, col: str, include_missing=False) -> pd.DataFrame:
    """A two-column frame (_row, _dim) with labels applied and multi-selects
    exploded, so one respondent picking three options counts once per option."""
    fld = ctx.field(col) or {}
    lm = label_map(fld)
    rows = []
    for idx, v in zip(df.index, df[col].tolist()):
        if is_blank(v):
            if include_missing:
                rows.append((idx, MISSING_LABEL))
            continue
        if isinstance(v, list):
            if v and isinstance(v[0], dict):
                rows.append((idx, f"{len(v)} item(s)"))
                continue
            for x in v:
                rows.append((idx, lm.get(str(x), str(x))))
        elif fld.get("multi") and isinstance(v, str) and " " in v.strip():
            for x in v.split():
                rows.append((idx, lm.get(x, x)))
        else:
            if isinstance(v, float) and v.is_integer():
                v = int(v)
            rows.append((idx, lm.get(str(v), str(v))))
    return pd.DataFrame(rows, columns=["_row", "_dim"])


def order_labels(ctx, col, labels):
    """Choice order from the form for ordinal questions; otherwise as given."""
    fld = ctx.field(col) or {}
    if not fld.get("choices"):
        return labels
    if not fld.get("ordered") and fld.get("type") not in ("likert", "rating"):
        return labels
    order = [c["label"] for c in fld["choices"]]
    pos = {l: i for i, l in enumerate(order)}
    return sorted(labels, key=lambda l: pos.get(l, len(order) + 1))


def _agg_numbers(values: pd.Series, agg):
    nums = numeric(values).dropna()
    if agg in ("count",):
        return int(len(values))
    if nums.empty:
        return None
    if agg == "sum":
        return safe(nums.sum())
    if agg == "mean":
        return safe(nums.mean())
    if agg == "median":
        return safe(nums.median())
    if agg == "min":
        return safe(nums.min())
    if agg == "max":
        return safe(nums.max())
    return safe(nums.mean())


def aggregate(ctx, df, column, agg):
    """One scalar: count/distinct/filled/missing work on any column."""
    agg = agg if agg in AGGS else "count"
    if agg == "count" or not column:
        return int(len(df))
    if column not in df.columns:
        raise ToolError(f"There is no column called “{column}”.")
    s = df[column]
    if agg == "distinct":
        return int(s[~blank_mask(s)].astype(str).nunique())
    if agg == "filled":
        return int((~blank_mask(s)).sum())
    if agg == "missing":
        return int(blank_mask(s).sum())
    return _agg_numbers(s, agg)


def _need_col(ctx, col, what="column"):
    if not col:
        raise ToolError(f"Pick a {what} first.")
    if col not in ctx.frame.columns:
        known = ctx.field(col)
        if known:
            raise ToolError(f"“{known['label']}” has no answers yet.")
        raise ToolError(f"There is no column called “{col}”.")
    return col


# ─────────────────────────────────────────────────────────────────────
#  Tool: overview  (how is an active survey doing?)
# ─────────────────────────────────────────────────────────────────────

def tool_overview(ctx: AgentContext, spec: dict) -> dict:
    s = ctx.survey
    if s is None:
        return tool_surveys(ctx, spec)
    subs = s.submissions.all()
    if ctx.scope_user_ids is not None:
        subs = subs.filter(enumerator_id__in=ctx.scope_user_ids)
    now = timezone.now()
    today_start = timezone.localtime(now).replace(hour=0, minute=0, second=0, microsecond=0)
    total = subs.count()
    by_status = Counter(subs.values_list("status", flat=True))
    by_source = Counter(subs.values_list("source", flat=True))
    today = subs.filter(received_at__gte=today_start).count()
    last = subs.order_by("-received_at").values_list("received_at", flat=True).first()
    week = []
    for i in range(13, -1, -1):
        d0 = today_start - timedelta(days=i)
        week.append({"day": d0.date().isoformat(),
                     "n": subs.filter(received_at__gte=d0, received_at__lt=d0 + timedelta(days=1)).count()})
    open_flags = s.submissions.filter(flags__resolved=False).distinct().count() if ctx.scope_user_ids is None else None
    durations = [d for d in subs.values_list("duration_ms", flat=True)[:5000] if d]
    median_min = round(float(np.median(durations)) / 60000.0, 1) if durations else None
    v = s.current_version
    pending = 0
    try:
        from .views import pending_device_count
        pending = pending_device_count(s)
    except Exception:
        pass

    usable = total - by_status.get("excluded", 0)
    stats = [
        {"label": "Responses", "value": usable, "hint": f"{total} received in total"},
        {"label": "Today", "value": today},
        {"label": "Median time", "value": f"{median_min} min" if median_min is not None else "—"},
        {"label": "Flagged rows", "value": open_flags if open_flags is not None else "—"},
    ]
    if s.quota:
        stats.append({"label": "Quota", "value": f"{pct(usable, s.quota, 0):g}%",
                      "hint": f"{usable} of {s.quota}"})
    notes = []
    state_words = {"draft": "a draft — nothing is published yet", "collecting": "collecting answers",
                   "paused": "paused", "closed": "closed"}
    notes.append(f"The survey is {state_words.get(s.state, s.state)}"
                 + (f" on version {v.version}." if v else "."))
    if last:
        ago = now - last
        mins = int(ago.total_seconds() // 60)
        when = (f"{mins} min ago" if mins < 90 else
                f"{mins // 60} h ago" if mins < 60 * 36 else f"{ago.days} days ago")
        notes.append(f"Last response arrived {when}.")
    elif v:
        notes.append("No responses yet — share the link or QR code to start collecting.")
    if by_source:
        notes.append("Collected via " + ", ".join(
            f"{'web link' if k == 'web' else 'phone app' if k == 'app' else k} {pct(n, total, 0):g}%"
            for k, n in by_source.most_common()) + ".")
    if pending:
        notes.append(f"{pending} phone(s) are waiting for your approval on the Live page.")
    if s.state == "collecting" and week[-1]["n"] == 0 and sum(w["n"] for w in week[-4:-1]) > 0:
        notes.append("Nothing has arrived today although data came in this week — check on the field team.")
    return {
        "type": "overview",
        "title": s.title,
        "state": s.state,
        "stats": stats,
        "trend": week,
        "notes": notes,
        "status_breakdown": [{"label": k, "n": n} for k, n in by_status.most_common()],
    }


def tool_surveys(ctx: AgentContext, spec: dict) -> dict:
    from django.db.models import Count, Max, Q
    qs = (Survey.objects.filter(owner=ctx.user)
          .annotate(n=Count("submissions", filter=~Q(submissions__status="excluded")),
                    last=Max("submissions__received_at"))
          .order_by("-updated_at")[:40])
    rows = []
    for s in qs:
        rows.append({"Survey": s.title, "Code": s.code, "State": s.state.title(),
                     "Responses": s.n, "Last response": s.last.date().isoformat() if s.last else "—"})
    return {"type": "table", "title": "Your surveys", "columns": ["Survey", "Code", "State", "Responses", "Last response"],
            "rows": rows, "total": len(rows), "links": {r["Code"]: f"/kura/{r['Code']}/build/" for r in rows},
            "spec": {"tool": "surveys"}}


# ─────────────────────────────────────────────────────────────────────
#  Tool: profile  (what is in my data / data health)
# ─────────────────────────────────────────────────────────────────────

def tool_profile(ctx: AgentContext, spec: dict) -> dict:
    df = ctx.frame
    if df.empty:
        raise ToolError("There are no responses to look at yet.")
    wanted = [c for c in (spec.get("columns") or []) if c in ctx.fields]
    fields = [ctx.fields[c] for c in wanted] if wanted else [f for f in ctx.catalog if not f.get("meta")]
    rows, issues = [], []
    answer_cols = [f["name"] for f in ctx.catalog if not f.get("meta") and f["name"] in df.columns]
    dup = 0
    if answer_cols:
        dup = int(df[answer_cols].astype(str).duplicated().sum())
    if dup:
        issues.append({"level": "warn", "text": f"{dup} row(s) repeat another row answer-for-answer (possible double submissions)."})
    for f in fields[:80]:
        st = column_stats(df, f)
        pii = detect_pii(f, df[f["name"]] if f["name"] in df.columns else None)
        health = 100 - st.get("missing_pct", 0)
        summary = ""
        if f["kind"] == "choice" and st.get("top"):
            t = st["top"][0]
            summary = f"most chose {t['label']} ({t['pct']:g}%)"
        elif f["kind"] == "number" and st.get("mean") is not None:
            summary = f"mean {fmt_num(st['mean'])}, range {fmt_num(st['min'])}–{fmt_num(st['max'])}"
        elif f["kind"] == "date" and st.get("first"):
            summary = f"{st['first']} → {st['last']}"
        elif f["kind"] == "text":
            summary = f"{st.get('distinct', 0)} different answers"
        elif f["kind"] == "repeat" and st.get("items_mean") is not None:
            summary = f"{fmt_num(st['items_mean'])} items on average"
        rows.append({"name": f["name"], "label": f["label"], "type": f["type"], "kind": f["kind"],
                     "answered": st.get("answered", 0), "missing_pct": st.get("missing_pct", 0),
                     "health": round(health, 1), "summary": summary, "pii": pii["level"]})
        if st.get("absent"):
            continue
        if f.get("required") and st.get("missing_pct", 0) > 0:
            issues.append({"level": "warn", "field": f["name"],
                           "text": f"“{f['label']}” is required but {st['missing_pct']:g}% are blank (older versions or skip logic)."})
        elif st.get("missing_pct", 0) >= 40:
            issues.append({"level": "info", "field": f["name"],
                           "text": f"“{f['label']}” is blank for {st['missing_pct']:g}% of rows."})
        if st.get("outliers"):
            issues.append({"level": "warn", "field": f["name"],
                           "text": f"“{f['label']}” has {st['outliers']} extreme value(s) (beyond 3× the IQR)."})
        if st.get("non_numeric"):
            issues.append({"level": "warn", "field": f["name"],
                           "text": f"“{f['label']}” has {st['non_numeric']} answer(s) that are not numbers."})
        if f["kind"] == "text" and f["name"] in df.columns:
            vals = df[f["name"]].dropna().astype(str)
            spaced = int((vals != vals.str.strip()).sum() + vals.str.contains(r"\s{2,}").sum())
            if spaced:
                issues.append({"level": "info", "field": f["name"],
                               "text": f"“{f['label']}” has {spaced} answer(s) with stray spaces."})
            if len(vals) > 10:
                low = vals.str.strip().str.lower()
                variants = int(vals.str.strip().nunique() - low.nunique())
                if variants > 0:
                    issues.append({"level": "info", "field": f["name"],
                                   "text": f"“{f['label']}” spells {variants} answer(s) in more than one case (e.g. “banjul” vs “Banjul”)."})
        if pii["level"] == "direct":
            issues.append({"level": "privacy", "field": f["name"],
                           "text": f"“{f['label']}” holds personal data ({pii['reason']}) — remove it before sharing."})
    if "_duration_s" in df.columns:
        d = numeric(df["_duration_s"]).dropna()
        if len(d) >= 10:
            fast = int((d < max(30, d.median() * 0.25)).sum())
            if fast:
                issues.append({"level": "warn", "text": f"{fast} interview(s) took under a quarter of the usual time — check them for rushed answers."})
    order = {"warn": 0, "privacy": 1, "info": 2}
    issues.sort(key=lambda i: order.get(i["level"], 3))
    return {"type": "profile", "title": "Data health check", "rows": rows, "issues": issues[:40],
            "total_rows": int(len(df)), "duplicates": dup, "spec": {"tool": "profile", "columns": wanted}}


# ─────────────────────────────────────────────────────────────────────
#  Tool: chart
# ─────────────────────────────────────────────────────────────────────

CHART_KINDS = {"bar", "hbar", "pie", "donut", "line", "area", "histogram", "scatter",
               "timeseries", "stacked", "radar", "polar"}


def _breakdown(ctx, df, x, y=None, agg="count", group_by=None, limit=25, include_missing=False, sort="value"):
    """labels + series for a categorical breakdown (labels applied, multi exploded)."""
    dx = dim_series(ctx, df, x, include_missing)
    if dx.empty:
        raise ToolError(f"“{ctx.label(x)}” has no answers to chart.")
    base_n = int(df.loc[df.index.isin(dx["_row"])].shape[0])
    if group_by:
        dg = dim_series(ctx, df, group_by, include_missing).rename(columns={"_dim": "_grp"})
        merged = dx.merge(dg, on="_row")
        if y and agg != "count":
            merged["_y"] = numeric(df.loc[merged["_row"], y]).values
            table = merged.groupby(["_dim", "_grp"])["_y"].agg(agg if agg != "median" else "median").unstack()
        else:
            table = merged.groupby(["_dim", "_grp"]).size().unstack(fill_value=0)
        labels = list(table.index)
        if sort == "value":
            labels = list(table.sum(axis=1).sort_values(ascending=False).index)
        labels = order_labels(ctx, x, labels)[:limit]
        groups = order_labels(ctx, group_by, list(table.columns))[:12]
        series = [{"name": str(g), "data": [safe(table.at[l, g]) if l in table.index else 0 for l in labels]}
                  for g in groups]
        return [str(l) for l in labels], series, base_n, None
    if y and agg != "count":
        dx["_y"] = numeric(df.loc[dx["_row"], y]).values
        grouped = dx.groupby("_dim")["_y"].agg(agg)
    else:
        grouped = dx.groupby("_dim").size()
    if sort == "value":
        grouped = grouped.sort_values(ascending=False)
    labels = order_labels(ctx, x, list(grouped.index))
    grouped = grouped.reindex(labels)
    other = None
    if len(grouped) > limit:
        other = grouped.iloc[limit:]
        grouped = grouped.iloc[:limit]
    measure = "Responses" if (agg == "count" or not y) else f"{agg} of {ctx.label(y)}"
    series = [{"name": measure, "data": [safe(v) for v in grouped.tolist()]}]
    return [str(l) for l in grouped.index], series, base_n, other


def tool_chart(ctx: AgentContext, spec: dict) -> dict:
    df0 = ctx.frame
    if df0.empty:
        raise ToolError("There are no responses to chart yet.")
    kind = spec.get("kind") if spec.get("kind") in CHART_KINDS else "bar"
    x, y, group_by = spec.get("x"), spec.get("y"), spec.get("group_by")
    agg = spec.get("agg") if spec.get("agg") in AGGS else "count"
    filters = clean_filters(ctx, spec.get("filters"))
    df = apply_filters(ctx, df0, filters, spec.get("match", "all"))
    limit = max(2, min(40, int(spec.get("limit") or 20)))
    title = _clip_text(spec.get("title") or "", 120)
    fdesc = describe_filters(ctx, filters)
    norm = {"tool": "chart", "kind": kind, "x": x, "y": y, "group_by": group_by, "agg": agg,
            "filters": filters, "limit": limit, "title": title, "freq": spec.get("freq"),
            "cumulative": bool(spec.get("cumulative"))}

    if kind == "timeseries" or (kind in ("line", "area") and (not x or (ctx.field(x) or {}).get("kind") == "date")):
        from .dashboard_engine import frame_timeseries
        date_col = x if x and x in df.columns else "_received_at"
        res = frame_timeseries(df, {"date": date_col, "y": y if y in df.columns else None, "agg": agg,
                                    "group_by": group_by if group_by in df.columns else None,
                                    "freq": spec.get("freq") or "D", "cumulative": bool(spec.get("cumulative"))})
        if not res.get("ok"):
            raise ToolError(res.get("error") or "Could not build a time series.")
        if group_by:
            lm = label_map(ctx.field(group_by))
            for s in res["series"]:
                s["name"] = lm.get(s["name"], s["name"])
        labels = [l[:10] for l in res["labels"]]
        total = sum(sum(v or 0 for v in s["data"]) for s in res["series"]) if agg == "count" else None
        caption = ""
        if res["series"] and labels:
            peak_i = int(np.argmax([sum((s["data"][i] or 0) for s in res["series"]) for i in range(len(labels))]))
            caption = f"Busiest period: {labels[peak_i]}."
            if total is not None and not spec.get("cumulative"):
                caption = f"{fmt_num(total)} responses over {len(labels)} period(s). " + caption
        norm["kind"] = "line" if kind == "timeseries" else kind
        return {"type": "chart", "chart": "area" if kind == "area" else "line",
                "title": title or f"Responses over time{' by ' + ctx.label(group_by) if group_by else ''}",
                "labels": labels, "series": res["series"], "caption": caption, "filters": fdesc,
                "x_label": ctx.label(date_col), "y_label": "Responses" if agg == "count" else f"{agg} of {ctx.label(y)}",
                "spec": norm}

    if kind == "histogram":
        col = _need_col(ctx, x or y, "number column")
        nums = numeric(df[col]).dropna()
        if nums.empty:
            raise ToolError(f"“{ctx.label(col)}” has no numbers.")
        bins = int(spec.get("bins") or min(20, max(5, int(math.sqrt(len(nums))))))
        whole = bool((nums % 1 == 0).all())
        if whole and nums.max() - nums.min() >= bins:
            # whole numbers (ages, counts): whole-number bands like 18–23
            width = math.ceil((nums.max() - nums.min() + 1) / bins)
            edges = np.arange(nums.min(), nums.max() + width + 1, width)
            counts, edges = np.histogram(nums, bins=edges)
            labels = [f"{int(edges[i]):,}–{int(edges[i + 1]) - 1:,}" for i in range(len(counts))]
        else:
            counts, edges = np.histogram(nums, bins=bins)
            labels = [f"{fmt_num(edges[i])}–{fmt_num(edges[i + 1])}" for i in range(len(counts))]
        caption = (f"n = {len(nums):,}. Mean {fmt_num(nums.mean())}, median {fmt_num(nums.median())}, "
                   f"range {fmt_num(nums.min())}–{fmt_num(nums.max())}.")
        return {"type": "chart", "chart": "bar", "title": title or f"Distribution of {ctx.label(col)}",
                "labels": labels, "series": [{"name": "Responses", "data": counts.astype(int).tolist()}],
                "caption": caption, "filters": fdesc, "x_label": ctx.label(col), "y_label": "Responses",
                "spec": norm}

    if kind == "scatter":
        _need_col(ctx, x, "X column")
        _need_col(ctx, y, "Y column")
        xs, ys = numeric(df[x]), numeric(df[y])
        ok = xs.notna() & ys.notna()
        if ok.sum() < 3:
            raise ToolError("A scatter plot needs at least three rows with both numbers.")
        pts = [{"x": safe(a), "y": safe(b)} for a, b in zip(xs[ok], ys[ok])][:2000]
        r = float(np.corrcoef(xs[ok], ys[ok])[0, 1]) if ok.sum() > 2 else 0.0
        strength = "strong" if abs(r) >= .6 else "moderate" if abs(r) >= .3 else "weak"
        caption = f"Correlation r = {r:.2f} ({strength}, {'positive' if r >= 0 else 'negative'}) across {int(ok.sum()):,} rows."
        return {"type": "chart", "chart": "scatter", "title": title or f"{ctx.label(y)} vs {ctx.label(x)}",
                "series": [{"name": f"{ctx.label(y)} vs {ctx.label(x)}", "data": pts}], "labels": [],
                "caption": caption, "filters": fdesc, "x_label": ctx.label(x), "y_label": ctx.label(y),
                "spec": norm}

    # categorical breakdowns
    _need_col(ctx, x, "column to break down by")
    if group_by:
        _need_col(ctx, group_by, "grouping column")
    if y:
        _need_col(ctx, y, "number column")
    labels, series, base_n, other = _breakdown(ctx, df, x, y, agg, group_by, limit,
                                               bool(spec.get("include_missing")),
                                               "label" if (ctx.field(x) or {}).get("ordered") else "value")
    chart = {"stacked": "bar", "radar": "radar", "polar": "polarArea"}.get(kind, kind)
    caption = ""
    percents = None
    if not group_by and (agg == "count" or not y):
        fld = ctx.field(x) or {}
        denom = base_n if fld.get("multi") else (sum(series[0]["data"]) + (int(other.sum()) if other is not None else 0))
        percents = [pct(v or 0, denom) for v in series[0]["data"]]
        if labels:
            top = int(np.argmax(series[0]["data"]))
            caption = (f"Most common: {labels[top]} — {percents[top]:g}% "
                       f"({fmt_num(series[0]['data'][top])} of {fmt_num(denom)}).")
            if fld.get("multi"):
                caption += " People could pick more than one answer, so shares add up to more than 100%."
            if other is not None:
                caption += f" {len(other)} smaller group(s) not shown."
    elif not group_by:
        if labels:
            hi = int(np.nanargmax([v if v is not None else -1e18 for v in series[0]["data"]]))
            caption = f"Highest {agg} of {ctx.label(y)}: {labels[hi]} ({fmt_num(series[0]['data'][hi])})."
    else:
        caption = f"{ctx.label(x)} split by {ctx.label(group_by)} (n = {base_n:,})."
    return {"type": "chart", "chart": chart, "stacked": kind == "stacked",
            "title": title or (f"{ctx.label(x)}" + (f" by {ctx.label(group_by)}" if group_by else "")),
            "labels": labels, "series": series, "percent": percents, "caption": caption, "filters": fdesc,
            "x_label": ctx.label(x), "y_label": series[0]["name"] if series else "", "spec": norm}


# ─────────────────────────────────────────────────────────────────────
#  Tool: table
# ─────────────────────────────────────────────────────────────────────

def table_frame(ctx: AgentContext, spec: dict, preview=True) -> tuple[pd.DataFrame, dict]:
    """The table as a DataFrame (used by the chat preview AND the exports)."""
    df0 = ctx.frame
    if df0.empty:
        raise ToolError("There are no responses yet.")
    mode = spec.get("mode") if spec.get("mode") in ("frequency", "crosstab", "group", "rows", "summary") else "frequency"
    filters = clean_filters(ctx, spec.get("filters"))
    df = apply_filters(ctx, df0, filters, spec.get("match", "all"))
    x, y, group_by = spec.get("x"), spec.get("y"), spec.get("group_by")
    agg = spec.get("agg") if spec.get("agg") in AGGS else "count"
    meta = {"filters": describe_filters(ctx, filters), "mode": mode, "total": int(len(df)),
            "norm": {"tool": "table", "mode": mode, "x": x, "y": y, "group_by": group_by, "agg": agg,
                     "filters": filters, "columns": spec.get("columns"), "limit": spec.get("limit"),
                     "sort_by": spec.get("sort_by"), "ascending": bool(spec.get("ascending")),
                     "percent": spec.get("percent"), "title": spec.get("title")}}

    if mode == "frequency":
        _need_col(ctx, x)
        dx = dim_series(ctx, df, x, include_missing=True)
        counts = dx.groupby("_dim").size()
        labels = order_labels(ctx, x, list(counts.sort_values(ascending=False).index))
        counts = counts.reindex(labels)
        fld = ctx.field(x) or {}
        denom = len(df) if fld.get("multi") else int(counts.sum())
        out = pd.DataFrame({ctx.label(x): counts.index, "Responses": counts.values.astype(int),
                            "Percent": [pct(v, denom) for v in counts.values]})
        return out, meta

    if mode == "crosstab":
        _need_col(ctx, x)
        _need_col(ctx, group_by, "column for the table columns")
        dx = dim_series(ctx, df, x)
        dg = dim_series(ctx, df, group_by).rename(columns={"_dim": "_grp"})
        merged = dx.merge(dg, on="_row")
        tab = pd.crosstab(merged["_dim"], merged["_grp"])
        tab = tab.reindex(order_labels(ctx, x, list(tab.sum(axis=1).sort_values(ascending=False).index)))
        tab = tab[order_labels(ctx, group_by, list(tab.columns))]
        how = spec.get("percent")
        if how == "row":
            tab = (tab.div(tab.sum(axis=1).replace(0, np.nan), axis=0) * 100).round(1)
        elif how == "col":
            tab = (tab.div(tab.sum(axis=0).replace(0, np.nan), axis=1) * 100).round(1)
        elif how == "total":
            tab = (tab / max(1, tab.values.sum()) * 100).round(1)
        else:
            tab["Total"] = tab.sum(axis=1)
        tab = tab.reset_index().rename(columns={"_dim": ctx.label(x)})
        tab.columns = [str(c) for c in tab.columns]
        meta["percent"] = how
        return tab, meta

    if mode == "group":
        _need_col(ctx, group_by or x, "grouping column")
        gcol = group_by or x
        dg = dim_series(ctx, df, gcol)
        if y:
            _need_col(ctx, y, "number column")
            dg["_y"] = numeric(df.loc[dg["_row"], y]).values
            g = dg.groupby("_dim")["_y"]
            out = pd.DataFrame({
                "Responses": g.size(),
                "Mean": g.mean().round(2), "Median": g.median().round(2),
                "Min": g.min(), "Max": g.max(), "Sum": g.sum().round(2),
            })
        else:
            out = pd.DataFrame({"Responses": dg.groupby("_dim").size()})
        out = out.reindex(order_labels(ctx, gcol, list(out["Responses"].sort_values(ascending=False).index)))
        out = out.reset_index().rename(columns={"_dim": ctx.label(gcol)})
        return out, meta

    if mode == "summary":
        cols = [c for c in (spec.get("columns") or []) if c in df.columns] or \
               [f["name"] for f in ctx.catalog if f["kind"] == "number" and f["name"] in df.columns]
        recs = []
        for c in cols[:40]:
            nums = numeric(df[c]).dropna()
            if nums.empty:
                continue
            recs.append({"Question": ctx.label(c), "Answered": int(len(nums)), "Mean": round(float(nums.mean()), 2),
                         "Median": round(float(nums.median()), 2), "Min": safe(nums.min()), "Max": safe(nums.max()),
                         "Std dev": round(float(nums.std(ddof=0)), 2)})
        if not recs:
            raise ToolError("No number questions to summarise.")
        return pd.DataFrame(recs), meta

    # rows
    cols = [c for c in (spec.get("columns") or []) if c in df.columns]
    if not cols:
        cols = [f["name"] for f in ctx.catalog if not f.get("meta") and f["name"] in df.columns
                and f["kind"] not in ("media", "repeat")][:10]
    work = df
    sort_by = spec.get("sort_by")
    if sort_by in work.columns:
        key = numeric(work[sort_by])
        work = work.assign(_k=key if key.notna().any() else work[sort_by].astype(str)) \
                   .sort_values("_k", ascending=bool(spec.get("ascending")))
    elif "_received_at" in work.columns:
        work = work.sort_values("_received_at", ascending=False)
    lim = int(spec.get("limit") or 0)
    if preview:
        lim = min(lim or MAX_PREVIEW_ROWS, MAX_TABLE_ROWS)
    if lim:
        work = work.head(lim)
    out = pd.DataFrame({ctx.label(c): [_display(ctx, c, v) for v in work[c].tolist()] for c in cols})
    meta["row_level"] = True
    return out, meta


def _display(ctx, col, v):
    if is_blank(v):
        return ""
    fld = ctx.field(col) or {}
    lm = label_map(fld)
    if isinstance(v, list):
        if v and isinstance(v[0], dict):
            return f"{len(v)} item(s)"
        return ", ".join(lm.get(str(x), str(x)) for x in v)
    if isinstance(v, dict):
        if "lat" in v or "latitude" in v:
            return f"{v.get('lat', v.get('latitude'))}, {v.get('lng', v.get('lon', v.get('longitude')))}"
        return str(v)[:80]
    if lm:
        return lm.get(str(v), v)
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


def frame_records(df: pd.DataFrame, limit=None):
    work = df.head(limit) if limit else df
    cols = [str(c) for c in work.columns]
    rows = []
    for rec in work.itertuples(index=False):
        rows.append({c: safe(v) if not isinstance(v, (list, dict)) else str(v) for c, v in zip(cols, rec)})
    return cols, rows


def tool_table(ctx: AgentContext, spec: dict) -> dict:
    df, meta = table_frame(ctx, spec, preview=True)
    cols, rows = frame_records(df, MAX_TABLE_ROWS)
    title = spec.get("title") or {
        "frequency": f"{ctx.label(spec.get('x'))} — counts",
        "crosstab": f"{ctx.label(spec.get('x'))} by {ctx.label(spec.get('group_by'))}",
        "group": f"Summary by {ctx.label(spec.get('group_by') or spec.get('x'))}",
        "summary": "Number questions at a glance",
        "rows": "Responses",
    }[meta["mode"]]
    return {"type": "table", "title": _clip_text(title, 120), "columns": cols, "rows": rows,
            "total": meta["total"], "filters": meta["filters"], "row_level": bool(meta.get("row_level")),
            "percent": meta.get("percent"), "spec": meta["norm"]}


# ─────────────────────────────────────────────────────────────────────
#  Tool: cards (KPIs)
# ─────────────────────────────────────────────────────────────────────

def _card_value(ctx, df_all, card):
    filters = clean_filters(ctx, card.get("filters"))
    df = apply_filters(ctx, df_all, filters)
    fmt = card.get("format") or "number"
    if fmt == "percent":
        base_f = clean_filters(ctx, card.get("of"))
        base = apply_filters(ctx, df_all, base_f) if base_f else df_all
        value = pct(len(df), len(base))
        return value, f"{len(df):,} of {len(base):,}", "percent"
    value = aggregate(ctx, df, card.get("column"), card.get("agg") or "count")
    return value, describe_filters(ctx, filters), fmt


def auto_cards(ctx):
    df = ctx.frame
    cards = [{"label": "Responses", "agg": "count"}]
    if "_received_at" in df.columns and len(df):
        today = timezone.localtime().date().isoformat()
        cards.append({"label": "Today", "agg": "count",
                      "filters": [{"field": "_received_at", "operator": "starts_with", "value": today}]})
    if "_duration_s" in df.columns and numeric(df["_duration_s"]).notna().any():
        cards.append({"label": "Median minutes", "agg": "median", "column": "_duration_s", "scale": 1 / 60})
    for f in ctx.catalog:
        if f["kind"] == "number" and not f.get("meta") and f["name"] in df.columns and len(cards) < 6:
            cards.append({"label": f"Average {short_label(f).lower()}"[:60], "agg": "mean", "column": f["name"]})
    return cards


def tool_cards(ctx: AgentContext, spec: dict) -> dict:
    df = ctx.frame
    if df.empty:
        raise ToolError("There are no responses yet.")
    raw = spec.get("cards") or auto_cards(ctx)
    out = []
    for c in raw[:12]:
        if not isinstance(c, dict):
            continue
        value, hint, fmt = _card_value(ctx, df, c)
        if c.get("scale") and isinstance(value, (int, float)):
            value = round(value * float(c["scale"]), 1)
        out.append({"label": _clip_text(c.get("label") or ctx.label(c.get("column")) or "Responses", 60),
                    "value": value, "format": fmt, "hint": _clip_text(c.get("hint") or hint, 80),
                    "color": c.get("color")})
    return {"type": "cards", "title": _clip_text(spec.get("title") or "Key numbers", 100), "cards": out,
            "spec": {"tool": "cards", "cards": raw[:12], "title": spec.get("title")}}


# ─────────────────────────────────────────────────────────────────────
#  Tool: map
# ─────────────────────────────────────────────────────────────────────

def tool_map(ctx: AgentContext, spec: dict) -> dict:
    from .analytics import map_points
    df0 = ctx.frame
    if df0.empty:
        raise ToolError("There are no responses to map yet.")
    filters = clean_filters(ctx, spec.get("filters"))
    df = apply_filters(ctx, df0, filters).reset_index(drop=True)
    points, source = map_points(None, df, ctx.schema, limit=MAX_MAP_POINTS)
    if not points:
        raise ToolError("No locations to show — the form has no GPS answers and phones did not record a position.")
    color_by = spec.get("color_by")
    legend = []
    if color_by and color_by in df.columns:
        lm = label_map(ctx.field(color_by))
        vals = df[color_by].tolist()
        for p in points:
            i = p.get("row", 0) - 1
            if 0 <= i < len(vals):
                v = vals[i]
                if isinstance(v, list):
                    v = v[0] if v else None
                p["group"] = MISSING_LABEL if is_blank(v) else str(lm.get(str(v), v))
        legend = [k for k, _ in Counter(p.get("group") for p in points).most_common(10)]
    lats = [p["lat"] for p in points]
    lngs = [p["lng"] for p in points]
    return {"type": "map", "title": _clip_text(spec.get("title") or "Where responses came from", 100),
            "points": points, "legend": legend, "color_by": ctx.label(color_by) if color_by else None,
            "source": (source or {}).get("label"), "filters": describe_filters(ctx, filters),
            "bounds": [[min(lats), min(lngs)], [max(lats), max(lngs)]],
            "caption": f"{len(points):,} point(s) from {(source or {}).get('label', 'the data')}.",
            "spec": {"tool": "map", "color_by": color_by, "filters": filters, "title": spec.get("title")}}


# ─────────────────────────────────────────────────────────────────────
#  Tool: shape (infographics — rings, pictograms, funnels, pills)
# ─────────────────────────────────────────────────────────────────────

SHAPE_KINDS = {"ring", "pictogram", "funnel", "pill", "bars", "gauge"}


def tool_shape(ctx: AgentContext, spec: dict) -> dict:
    df_all = ctx.frame
    if df_all.empty:
        raise ToolError("There are no responses yet.")
    kind = spec.get("kind") if spec.get("kind") in SHAPE_KINDS else "ring"
    items = spec.get("items") or []
    if not items and spec.get("x"):
        # "show sex as rings" → one item per option
        x = _need_col(ctx, spec["x"])
        dx = dim_series(ctx, df_all, x)
        counts = dx.groupby("_dim").size().sort_values(ascending=False)
        denom = len(df_all) if (ctx.field(x) or {}).get("multi") else int(counts.sum())
        out = [{"label": str(k), "value": int(v), "pct": pct(v, denom)}
               for k, v in counts.head(6 if kind != "pictogram" else 3).items()]
    else:
        out = []
        prev = None
        for it in items[:8]:
            if not isinstance(it, dict):
                continue
            fl = clean_filters(ctx, it.get("filters"))
            df = apply_filters(ctx, df_all, fl)
            if it.get("column") and it.get("agg") and it.get("agg") != "count":
                val = aggregate(ctx, df, it["column"], it["agg"])
                p = None
                if it.get("max"):
                    try:
                        p = pct(float(val or 0), float(it["max"]))
                    except (TypeError, ValueError):
                        p = None
            else:
                base_f = clean_filters(ctx, it.get("of"))
                base = apply_filters(ctx, df_all, base_f) if base_f else (prev if kind == "funnel" and prev is not None else df_all)
                val = int(len(df))
                p = pct(val, len(base))
            out.append({"label": _clip_text(it.get("label") or describe_filters(ctx, fl) or "All responses", 50),
                        "value": safe(val), "pct": p})
            prev = df
    if not out:
        raise ToolError("Tell me what to count — for example “share of women who said yes”.")
    default_title = ctx.label(spec["x"]) if spec.get("x") and not items else "At a glance"
    return {"type": "shape", "kind": kind, "title": _clip_text(spec.get("title") or default_title, 100),
            "items": out, "icon": spec.get("icon") if spec.get("icon") in ("person", "home", "drop", "leaf", "star", "heart") else "person",
            "spec": {"tool": "shape", "kind": kind, "items": items[:8], "x": spec.get("x"),
                     "title": spec.get("title"), "icon": spec.get("icon")}}


# ─────────────────────────────────────────────────────────────────────
#  Tool: clean (studio operations, applied in memory)
# ─────────────────────────────────────────────────────────────────────

class _Step:
    """Duck-typed PipelineStep for in-memory execution."""

    def __init__(self, i, operation, name, config):
        self.id = -(i + 1)
        self.pk = None
        self.operation = operation
        self.name = name
        self.config = config
        self.enabled = True
        self.stop_on_error = False


def _executor():
    from .pipeline_engine import PipelineExecutor

    class AgentTransformer(PipelineExecutor):
        def __init__(self):
            self.run = None
            self.pipeline = None
            self.survey = None
            self.changes = []
            self.excluded = []
            self.step_stats = []
            self.counts = Counter()

        def record_change(self, step, row, field, old, new, change_type="other", detail=""):
            self.counts[(step.id, change_type)] += 1

    return AgentTransformer()


def valid_operations():
    try:
        from .studio_views import _all_operations
        return dict(_all_operations())
    except Exception:
        from .models import PipelineStep
        return dict(PipelineStep.OPERATION_CHOICES)


def auto_clean_steps(ctx: AgentContext) -> list:
    """Sensible, reversible first-pass cleaning built from the data itself."""
    df = ctx.frame
    steps = []
    for f in ctx.catalog:
        c = f["name"]
        if c not in df.columns or f.get("meta"):
            continue
        s = df[c]
        if f["kind"] == "text":
            vals = s.dropna()
            vals = vals[vals.apply(lambda v: isinstance(v, str))]
            if len(vals) and ((vals != vals.str.strip()).any() or vals.str.contains(r"\s{2,}").any()):
                steps.append({"operation": "trim_text", "name": f"Tidy spaces in {f['label'][:40]}",
                              "config": {"field": c}})
        if f["kind"] == "number":
            nums = numeric(s)
            non = int((~blank_mask(s) & nums.isna()).sum())
            if non or s.dtype == object:
                steps.append({"operation": "cast_type", "name": f"Make {f['label'][:40]} a number",
                              "config": {"field": c, "type": "decimal"}})
            nn = nums.dropna()
            if len(nn) >= 10:
                q1, q3 = nn.quantile(.25), nn.quantile(.75)
                iqr = q3 - q1
                if iqr and ((nn < q1 - 3 * iqr) | (nn > q3 + 3 * iqr)).any():
                    steps.append({"operation": "flag_rows", "name": f"Mark extreme {f['label'][:40]}",
                                  "config": {"new_field": f"check_{c}"[:40], "true_label": "extreme value",
                                             "conditions": [
                                                 {"field": c, "operator": "gt", "value": float(q3 + 3 * iqr)},
                                                 {"field": c, "operator": "lt", "value": float(q1 - 3 * iqr)}],
                                             "match": "any", "reason": "Beyond 3× the IQR."}})
    answer_cols = [f["name"] for f in ctx.catalog if not f.get("meta") and f["name"] in df.columns]
    if answer_cols and int(df[answer_cols].astype(str).duplicated().sum()):
        steps.append({"operation": "deduplicate", "name": "Remove repeated submissions",
                      "config": {"fields": answer_cols, "keep": "first"}})
    empty = [c for c in answer_cols if blank_mask(df[c]).all()]
    if empty:
        steps.append({"operation": "drop_columns", "name": "Drop empty columns", "config": {"columns": empty}})
    if not steps:
        steps.append({"operation": "deduplicate", "name": "Remove repeated submissions",
                      "config": {"fields": answer_cols, "keep": "first"}})
    return steps[:MAX_STEPS]


def clean_steps(ctx: AgentContext, spec: dict) -> list:
    ops = valid_operations()
    raw = spec.get("steps")
    if spec.get("auto") or not raw:
        raw = auto_clean_steps(ctx)
    out = []
    for item in (raw or [])[:MAX_STEPS]:
        if not isinstance(item, dict):
            continue
        op = item.get("operation")
        if op not in ops:
            continue
        cfg = item.get("config") if isinstance(item.get("config"), dict) else {}
        out.append({"operation": op, "name": _clip_text(item.get("name") or ops[op], 140), "config": cfg})
    if not out:
        raise ToolError("I couldn't turn that into cleaning steps Kura understands.")
    return out


def run_clean(ctx: AgentContext, steps: list):
    """Apply steps to a copy of the frame. Returns (clean_df, step_report)."""
    df = ctx.frame.copy()
    ex = _executor()
    report = []
    for i, st in enumerate(steps):
        step = _Step(i, st["operation"], st["name"], st["config"])
        before_r, before_c = df.shape
        try:
            df = ex._apply_step(df.copy(), step)
            changed = sum(n for (sid, _t), n in ex.counts.items() if sid == step.id)
            report.append({"name": st["name"], "operation": st["operation"], "status": "ok",
                           "rows_before": int(before_r), "rows_after": int(len(df)),
                           "cols_before": int(before_c), "cols_after": int(len(df.columns)),
                           "changes": int(changed)})
        except Exception as exc:  # a bad step is reported, the rest still run
            report.append({"name": st["name"], "operation": st["operation"], "status": "failed",
                           "error": _clip_text(str(exc), 200), "rows_before": int(before_r),
                           "rows_after": int(before_r), "changes": 0})
    return df, report


def _missing_share(df, only=None):
    cols = [c for c in public_columns(df) if not str(c).startswith("_") and (only is None or c in only)]
    if not cols or df.empty:
        return 0.0
    cells = df[cols].map(is_blank) if hasattr(df, "map") else df[cols].applymap(is_blank)
    return pct(int(cells.values.sum()), cells.size)


def tool_clean(ctx: AgentContext, spec: dict) -> dict:
    if ctx.frame.empty:
        raise ToolError("There is nothing to clean yet — no responses.")
    steps = clean_steps(ctx, spec)
    clean, report = run_clean(ctx, steps)
    before = {"rows": int(len(ctx.frame)), "cols": len(public_columns(ctx.frame)),
              "missing_pct": _missing_share(ctx.frame)}
    # Blank share over the ORIGINAL columns only: a marker column added by a
    # "flag rows" step is mostly empty by design and must not look like damage.
    after = {"rows": int(len(clean)), "cols": len(public_columns(clean)),
             "missing_pct": _missing_share(clean, set(ctx.frame.columns))}
    show = [c for c in public_columns(clean) if c not in ("_uuid",)]
    preview = clean[show].head(MAX_PREVIEW_ROWS)
    cols, rows = frame_records(preview)
    return {"type": "clean", "title": _clip_text(spec.get("title") or "Cleaned copy of your data", 100),
            "steps": report, "before": before, "after": after,
            "columns": cols, "rows": rows,
            "note": "Your original responses are untouched — this is a cleaned copy.",
            "spec": {"tool": "clean", "steps": steps, "title": spec.get("title")}}


# ─────────────────────────────────────────────────────────────────────
#  Tool: privacy (a shareable subset with personal data removed)
# ─────────────────────────────────────────────────────────────────────

def _pseudo(code, col, value):
    key = (getattr(settings, "SECRET_KEY", "") or "kura").encode("utf-8")
    msg = f"{code}:{col}:{value}".encode("utf-8")
    return "id_" + hmac.new(key, msg, hashlib.sha256).hexdigest()[:10]


def _mask(value):
    s = str(value)
    digits = re.sub(r"\D", "", s)
    if len(digits) >= 6 and len(digits) >= len(s) * 0.6:
        return "•" * (len(digits) - 2) + digits[-2:]
    if len(s) <= 2:
        return "•" * len(s)
    return s[0] + "•" * (len(s) - 1)


def _band(value, width):
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(v):
        return None
    lo = int(v // width * width)
    return f"{lo}–{lo + width - 1}"


def _round_geo(value, places):
    from .analytics import _parse_latlng
    p = _parse_latlng(value)
    if not p:
        try:
            return round(float(value), places)
        except (TypeError, ValueError):
            return None
    return f"{round(p[0], places)} {round(p[1], places)}"


def _apply_action(series: pd.Series, action: str, code: str, col: str) -> pd.Series:
    if action == "keep":
        return series
    if action == "hash":
        return series.apply(lambda v: None if is_blank(v) else _pseudo(code, col, v))
    if action == "mask":
        return series.apply(lambda v: None if is_blank(v) else _mask(v))
    if action in ("band5", "band10"):
        w = 5 if action == "band5" else 10
        return series.apply(lambda v: None if is_blank(v) else _band(v, w))
    if action in ("year", "month", "day"):
        d = pd.to_datetime(series, errors="coerce", utc=True)
        f = {"year": "%Y", "month": "%Y-%m", "day": "%Y-%m-%d"}[action]
        return d.dt.strftime(f).where(d.notna(), None)
    if action in ("round1", "round2", "round3"):
        places = int(action[-1])
        return series.apply(lambda v: None if is_blank(v) else _round_geo(v, places))
    if action == "topcode":
        nums = numeric(series)
        cap = nums.quantile(.98)
        return nums.where(nums <= cap, cap)
    return series


def privacy_plan(ctx: AgentContext, spec: dict) -> list:
    """Per-column decisions: detected level + default action, then the
    model's/user's overrides on top."""
    df = ctx.frame
    rules = spec.get("rules") if isinstance(spec.get("rules"), dict) else {}
    keep_only = set(spec.get("keep_only") or [])
    plan = []
    cols = [c for c in df.columns if c not in ("_enumerator_id",)]
    for col in cols:
        fld = ctx.field(col) or {"name": col, "label": META_LABELS.get(col, col), "type": "text",
                                 "kind": "number" if col in ("_gps_lat", "_gps_lng") else "text"}
        det = detect_pii(fld, df[col])
        action = det["action"]
        why = "auto"
        if keep_only and col not in keep_only and not col.startswith("_"):
            action, why = "drop", "not in the columns you asked to keep"
        if col in rules and rules[col] in ACTIONS:
            action, why = rules[col], "requested"
        if fld.get("kind") == "repeat" and action == "keep":
            action, why = "drop", "repeat-group details are removed from the flat copy"
        plan.append({"column": col, "label": ctx.label(col), "level": det["level"], "reason": det["reason"],
                     "action": action, "why": why})
    return plan


def run_privacy(ctx: AgentContext, spec: dict):
    df = ctx.frame
    plan = privacy_plan(ctx, spec)
    code = ctx.survey.code if ctx.survey else "upload"
    out = pd.DataFrame(index=df.index)
    out["row_id"] = range(1, len(df) + 1)
    for p in plan:
        if p["action"] == "drop":
            continue
        out[p["column"]] = _apply_action(df[p["column"]], p["action"], code, p["column"])
    # Flatten list answers so the file opens cleanly in Excel.
    for c in out.columns:
        if out[c].apply(lambda v: isinstance(v, list)).any():
            out[c] = out[c].apply(lambda v: "|".join(str(x) for x in v) if isinstance(v, list) else v)
    # k-anonymity over the quasi-identifiers that survived.
    quasi = [p["column"] for p in plan if p["level"] == "quasi" and p["action"] != "drop" and p["column"] in out.columns]
    k = max(2, min(50, int(spec.get("k") or 5)))
    kinfo = {"k": k, "quasi": [ctx.label(q) for q in quasi], "min_group": None, "at_risk": 0, "suppressed": 0}
    if quasi and len(out):
        sizes = out.groupby([out[q].astype(str) for q in quasi])["row_id"].transform("size")
        kinfo["min_group"] = int(sizes.min())
        risky = sizes < k
        kinfo["at_risk"] = int(risky.sum())
        if spec.get("suppress") and kinfo["at_risk"]:
            out = out.loc[~risky].copy()
            out["row_id"] = range(1, len(out) + 1)
            kinfo["suppressed"] = int(risky.sum())
    out = out.reset_index(drop=True)
    return out, plan, kinfo


def tool_privacy(ctx: AgentContext, spec: dict) -> dict:
    if ctx.frame.empty:
        raise ToolError("There are no responses to make a safe copy of yet.")
    out, plan, kinfo = run_privacy(ctx, spec)
    cols, rows = frame_records(out.head(30))
    removed = sum(1 for p in plan if p["action"] == "drop")
    changed = sum(1 for p in plan if p["action"] not in ("drop", "keep"))
    warnings = []
    for p in plan:
        if p["level"] == "direct" and p["action"] == "keep":
            warnings.append(f"“{p['label']}” still identifies people ({p['reason']}) — you asked to keep it.")
    if kinfo["at_risk"] and not kinfo["suppressed"]:
        warnings.append(f"{kinfo['at_risk']} row(s) are unique or nearly unique on "
                        f"{', '.join(kinfo['quasi'][:4])} (groups smaller than {kinfo['k']}). "
                        f"Ask me to “hide small groups” to drop them, or generalise those columns.")
    for p in plan:
        if p["level"] == "sensitive" and p["action"] == "keep":
            warnings.append(f"“{p['label']}” is sensitive ({p['reason']}); it is kept — share with care.")
            if len(warnings) > 8:
                break
    norm = {"tool": "privacy", "rules": {p["column"]: p["action"] for p in plan if p["why"] == "requested"},
            "k": kinfo["k"], "suppress": bool(spec.get("suppress")), "keep_only": spec.get("keep_only") or [],
            "title": spec.get("title")}
    return {"type": "privacy", "title": _clip_text(spec.get("title") or "Privacy-safe copy", 100),
            "plan": [{**p, "action_text": ACTION_TEXT.get(p["action"], p["action"])} for p in plan
                     if not (p["column"] in ("_submission_id",))],
            "kanon": kinfo, "rows_out": int(len(out)), "cols_out": int(len(out.columns)),
            "removed": removed, "changed": changed, "warnings": warnings[:10],
            "columns": cols, "rows": rows, "spec": norm}


# ─────────────────────────────────────────────────────────────────────
#  Tool: dashboard
# ─────────────────────────────────────────────────────────────────────

TILE_KINDS = {"kpi", "delta", "progress", "gauge", "bar", "hbar", "pie", "donut", "leaderboard",
              "line", "area", "timeseries", "histogram", "scatter", "table", "feed", "map", "text"}
_TILE_SIZE = {"kpi": (3, 2), "delta": (3, 2), "progress": (3, 2), "gauge": (3, 3), "text": (12, 1),
              "bar": (6, 4), "hbar": (6, 4), "pie": (4, 4), "donut": (4, 4), "leaderboard": (4, 4),
              "line": (8, 4), "area": (8, 4), "timeseries": (8, 4), "histogram": (6, 4), "scatter": (6, 4),
              "table": (12, 5), "feed": (4, 5), "map": (6, 5)}


def short_label(f) -> str:
    """'How old are you?' → 'Age' for card titles; plain labels stay."""
    label = f.get("label") or f["name"]
    if label.rstrip().endswith("?") or len(label) > 36:
        name = re.sub(r"^(calc__|q_)", "", f.get("question") or f["name"]).replace("_", " ").strip()
        if name and not re.fullmatch(r"q?\d+", name):
            return name[:1].upper() + name[1:]
    return label


def _informative_choice(ctx, f) -> bool:
    if f["name"] not in ctx.frame.columns or re.search(r"consent|agree to", f"{f['name']} {f['label']}", re.I):
        return False
    st = column_stats(ctx.frame, f)
    top = st.get("top") or []
    return len(top) >= 2 and top[0]["pct"] < 95


def auto_tiles(ctx: AgentContext) -> list:
    df = ctx.frame
    tiles = [
        {"kind": "kpi", "title": "Responses", "spec": {"agg": "count"}},
        {"kind": "delta", "title": "Last 24 hours", "spec": {"agg": "count", "window_minutes": 1440}},
    ]
    if ctx.survey and ctx.survey.quota:
        tiles.append({"kind": "progress", "title": "Progress to quota", "spec": {"agg": "count", "target": ctx.survey.quota}})
    nums = [f for f in ctx.catalog if f["kind"] == "number" and not f.get("meta") and f["name"] in df.columns]
    if nums:
        tiles.append({"kind": "kpi", "title": f"Average {short_label(nums[0]).lower()}"[:60], "spec": {"agg": "mean", "column": nums[0]["name"]}})
    tiles.append({"kind": "timeseries", "title": "Responses per day", "spec": {"date": "_received_at", "freq": "D"}})
    choices = [f for f in ctx.catalog if f["kind"] == "choice" and not f.get("meta") and not f.get("multi")
               and detect_pii(f)["level"] != "direct" and _informative_choice(ctx, f)]
    for i, f in enumerate(choices[:4]):
        tiles.append({"kind": "donut" if i % 2 else "hbar", "title": f["label"][:80],
                      "spec": {"x": f["name"], "agg": "count", "limit": 10}})
    if nums:
        tiles.append({"kind": "histogram", "title": f"{short_label(nums[0])} — spread"[:80], "spec": {"x": nums[0]["name"]}})
    from .analytics import map_points
    pts, _src = map_points(None, df.reset_index(drop=True), ctx.schema, limit=5) if len(df) else ([], None)
    if pts:
        tiles.append({"kind": "map", "title": "Where answers came from",
                      "spec": {"color_by": choices[0]["name"]} if choices else {}})
    return tiles


def layout_tiles(tiles):
    """Pack tiles onto the 12-column grid row by row, then widen each row's
    cards so the row spans all 12 columns — no holes on the board."""
    rows, cur, used = [], [], 0
    for t in tiles:
        w, h = _TILE_SIZE.get(t["kind"], (4, 3))
        try:
            w = max(1, min(12, int(t.get("w") or w)))
            h = max(1, min(16, int(t.get("h") or h)))
        except (TypeError, ValueError):
            pass
        if used + w > 12 and cur:
            rows.append(cur)
            cur, used = [], 0
        cur.append({**t, "w": w, "h": h})
        used += w
    if cur:
        rows.append(cur)
    out, y = [], 0
    for row in rows:
        spare = 12 - sum(t["w"] for t in row)
        i = 0
        while spare > 0:                       # hand out spare columns round-robin
            row[i % len(row)]["w"] += 1
            spare -= 1
            i += 1
        x, row_h = 0, max(t["h"] for t in row)
        for t in row:
            out.append({**t, "x": x, "y": y, "h": row_h})
            x += t["w"]
        y += row_h
    return out


def clean_tiles(ctx, raw):
    out = []
    for t in (raw or [])[:MAX_TILES]:
        if not isinstance(t, dict) or t.get("kind") not in TILE_KINDS:
            continue
        spec = t.get("spec") if isinstance(t.get("spec"), dict) else {}
        for key in ("x", "y", "column", "group_by", "color_by", "date"):
            if spec.get(key) and spec[key] not in ctx.frame.columns and spec[key] not in ctx.fields:
                spec.pop(key)
        if spec.get("agg") and spec["agg"] not in AGGS:
            spec["agg"] = "count"
        out.append({"kind": t["kind"], "title": _clip_text(t.get("title") or "", 140),
                    "subtitle": _clip_text(t.get("subtitle") or "", 200), "spec": spec,
                    "filters": clean_filters(ctx, t.get("filters")), "w": t.get("w"), "h": t.get("h")})
    return out


def compute_tiles(ctx, tiles):
    from .dashboard_engine import compute_tile
    df = ctx.frame
    results = []
    for i, t in enumerate(tiles):
        kind = t["kind"]
        spec = t["spec"]
        try:
            if kind == "histogram" and spec.get("x"):
                h = tool_chart(ctx, {"kind": "histogram", "x": spec["x"], "filters": t.get("filters")})
                results.append({"ok": True, "kind": kind, "labels": h["labels"], "series": h["series"]})
                continue
            if kind in ("bar", "hbar", "pie", "donut") and spec.get("x"):
                chart = tool_chart(ctx, {"kind": kind, "x": spec.get("x"), "y": spec.get("y"),
                                         "agg": spec.get("agg", "count"), "group_by": spec.get("group_by"),
                                         "filters": t.get("filters"), "limit": spec.get("limit") or 10,
                                         "title": t["title"]})
                results.append({"ok": True, "kind": kind, "labels": chart["labels"], "series": chart["series"],
                                "percent": chart.get("percent")})
                continue
            if kind == "map":
                m = tool_map(ctx, {"color_by": spec.get("color_by"), "filters": t.get("filters")})
                results.append({"ok": True, "kind": "map", "points": m["points"][:1500], "legend": m["legend"],
                                "bounds": m["bounds"]})
                continue
            res = compute_tile(df, {"id": i, "kind": kind, "spec": spec, "filters": t.get("filters") or [],
                                    "filter_match": "all"}, {"schema": ctx.schema})
            if kind in ("line", "area", "timeseries") and res.get("labels"):
                res["labels"] = [str(l)[:10] for l in res["labels"]]
            if kind == "leaderboard" and res.get("rows"):
                lm = label_map(ctx.field(spec.get("group_by")))
                for r in res["rows"]:
                    r["label"] = lm.get(r["label"], r["label"])
            if kind == "table" and res.get("columns"):
                res["columns_label"] = [ctx.label(c) for c in res["columns"]]
                res["rows"] = [{k: _display(ctx, k, v) for k, v in r.items()} for r in res["rows"][:25]]
            results.append(res)
        except ToolError as exc:
            results.append({"ok": False, "kind": kind, "error": str(exc)})
        except Exception as exc:
            results.append({"ok": False, "kind": kind, "error": _clip_text(str(exc), 160)})
    return results


def tile_block(ctx, tile, res) -> dict:
    """One computed tile → the block shape the chat (and HTML export) draws."""
    kind, title = tile["kind"], tile.get("title") or ""
    if not res.get("ok", True):
        return {"type": "error", "title": title, "text": res.get("error") or "This card could not be computed."}
    if kind in ("kpi", "gauge", "delta", "progress"):
        card = {"label": title or "Responses", "value": res.get("value"), "format": "number", "hint": ""}
        if kind == "delta":
            ch = res.get("change")
            card["hint"] = ("no earlier data" if ch is None else
                            f"{'+' if ch >= 0 else ''}{fmt_num(ch)} vs the window before")
        if kind in ("progress", "gauge"):
            target = res.get("target") or (tile["spec"] or {}).get("target")
            try:
                card["progress"] = pct(float(res.get("value") or 0), float(target)) if target else None
                card["hint"] = f"of {fmt_num(target)}" if target else ""
            except (TypeError, ValueError):
                pass
        return {"type": "cards", "title": "", "cards": [card], "compact": True}
    if kind in ("bar", "hbar", "pie", "donut"):
        return {"type": "chart", "chart": kind, "title": title, "labels": res.get("labels") or [],
                "series": res.get("series") or [], "percent": res.get("percent")}
    if kind in ("line", "area", "timeseries"):
        return {"type": "chart", "chart": "area" if kind == "area" else "line", "title": title,
                "labels": res.get("labels") or [], "series": res.get("series") or []}
    if kind == "histogram":
        return {"type": "chart", "chart": "bar", "title": title, "labels": res.get("labels") or [],
                "series": res.get("series") or []}
    if kind == "scatter":
        return {"type": "chart", "chart": "scatter", "title": title, "labels": [], "series": res.get("series") or []}
    if kind == "map":
        return {"type": "map", "title": title, "points": res.get("points") or [], "legend": res.get("legend") or [],
                "bounds": res.get("bounds")}
    if kind == "leaderboard":
        rows = [{"Rank": i + 1, "Name": r["label"], "Value": r["value"]} for i, r in enumerate(res.get("rows") or [])]
        return {"type": "table", "title": title, "columns": ["Rank", "Name", "Value"], "rows": rows, "total": len(rows)}
    if kind == "feed":
        rows = []
        for it in (res.get("items") or [])[:25]:
            detail = " · ".join(f"{ctx.label(f['name'])}: {_display(ctx, f['name'], f['value'])}"
                                for f in it.get("fields") or [])
            rows.append({"Time": str(it.get("at") or "")[:16].replace("T", " "),
                         "Answer": _display(ctx, (tile["spec"] or {}).get("headline"), it.get("headline")) if it.get("headline") is not None else detail,
                         "Via": it.get("source") or ""})
        return {"type": "table", "title": title, "columns": ["Time", "Answer", "Via"], "rows": rows,
                "total": res.get("total", len(rows))}
    if kind == "table":
        cols = res.get("columns") or []
        labels = res.get("columns_label") or cols
        rows = [{labels[i]: r.get(c) for i, c in enumerate(cols)} for r in (res.get("rows") or [])]
        return {"type": "table", "title": title, "columns": labels, "rows": rows, "total": res.get("total", len(rows))}
    if kind == "text":
        return {"type": "text", "title": title, "text": res.get("body") or (tile["spec"] or {}).get("body") or ""}
    return {"type": "error", "title": title, "text": f"Unsupported card “{kind}”."}


def tool_dashboard(ctx: AgentContext, spec: dict) -> dict:
    if ctx.frame.empty:
        raise ToolError("A dashboard needs some responses first.")
    raw = spec.get("tiles")
    tiles = clean_tiles(ctx, raw) if raw and not spec.get("auto") else clean_tiles(ctx, auto_tiles(ctx))
    if not tiles:
        tiles = clean_tiles(ctx, auto_tiles(ctx))
    tiles = layout_tiles(tiles)
    data = compute_tiles(ctx, tiles)
    from .models_dashboard import THEME_PRESETS
    theme = spec.get("theme") if spec.get("theme") in THEME_PRESETS else "studio"
    items = [{"x": t["x"], "y": t["y"], "w": t["w"], "h": t["h"], "kind": t["kind"], "block": tile_block(ctx, t, r)}
             for t, r in zip(tiles, data)]
    preset = THEME_PRESETS[theme]
    return {"type": "dashboard", "title": _clip_text(spec.get("title") or f"{ctx.survey.title} — overview", 120),
            "theme": theme, "palette": preset["palette"], "dark": preset.get("dark", True),
            "theme_tokens": {k: preset[k] for k in ("bg", "panel", "text", "muted", "line") if k in preset},
            "items": items,
            "spec": {"tool": "dashboard", "tiles": [{k: v for k, v in t.items() if k not in ("x", "y")} for t in tiles],
                     "title": spec.get("title"), "theme": theme}}


# ─────────────────────────────────────────────────────────────────────
#  Questionnaires: sanitize what the model drafts into Kura's schema
# ─────────────────────────────────────────────────────────────────────

_LIKERT = [("1", "Strongly disagree"), ("2", "Disagree"), ("3", "Neutral"), ("4", "Agree"), ("5", "Strongly agree")]
_TYPE_ALIASES = {"number": "integer", "int": "integer", "float": "decimal", "select": "select_one",
                 "radio": "select_one", "dropdown": "select_one", "single_choice": "select_one",
                 "multiple_choice": "select_multiple", "checkbox": "select_multiple", "checkboxes": "select_multiple",
                 "multi_select": "select_multiple", "textarea": "long_text", "paragraph": "long_text",
                 "string": "text", "short_text": "text", "location": "gps", "geopoint": "gps", "image": "photo",
                 "qr": "barcode", "calculation": "calculate", "begin_repeat": "repeat", "group": "repeat",
                 "header": "section", "heading": "section", "stars": "rating", "scale": "likert"}


def _clean_choices(raw, used_values=None):
    out, used = [], set()
    for i, ch in enumerate(raw or []):
        if isinstance(ch, dict):
            label = str(ch.get("label") or ch.get("value") or "").strip()
            value = str(ch.get("value") or "").strip() or slugify_name(label, f"option_{i + 1}")
        else:
            label = str(ch).strip()
            value = slugify_name(label, f"option_{i + 1}")
        if not label:
            continue
        value = re.sub(r"\s+", "_", value)[:60]
        v, n = value, 2
        while v in used:
            v = f"{value}_{n}"
            n += 1
        used.add(v)
        out.append({"value": v, "label": label[:200]})
    return out[:200]


def _clean_rules(rel, known):
    if not isinstance(rel, dict):
        return None
    rules = []
    for r in (rel.get("rules") or [])[:12]:
        if not isinstance(r, dict):
            continue
        if isinstance(r.get("rules"), list):
            nested = _clean_rules(r, known)
            if nested:
                rules.append(nested)
            continue
        q = str(r.get("q") or "").strip()
        cmp_ = r.get("cmp") or "eq"
        if q not in known or cmp_ not in RULE_CMPS:
            continue
        val = r.get("value")
        rules.append({"q": q, "cmp": cmp_, "value": "" if val is None else val})
    if not rules:
        return None
    return {"op": "or" if rel.get("op") == "or" else "and", "rules": rules}


def sanitize_questions(raw_list, existing_names=()):
    """Coerce a drafted question list into a valid Kura schema fragment.

    Unknown types fall back to text, names become unique snake_case, skip
    logic may only point to *earlier* questions (as the runner requires),
    and repeat groups keep their children.
    """
    used = set(existing_names)
    rename = {}
    out = []

    def one(q, known, inside_repeat=False):
        if not isinstance(q, dict):
            return None
        qtype = str(q.get("type") or "text").strip().lower().replace(" ", "_")
        qtype = _TYPE_ALIASES.get(qtype, qtype)
        if qtype not in QUESTION_TYPE_IDS or (inside_repeat and qtype == "repeat"):
            qtype = "text"
        label = str(q.get("label") or q.get("question") or q.get("text") or "").strip()
        if not label and qtype not in ("calculate",):
            label = "Untitled question"
        old = str(q.get("name") or "").strip()
        base = slugify_name(old or label, qtype)
        already_taken = old in used   # a duplicate: references keep meaning the first one
        name, n = base, 2
        while name in used:
            name = f"{base}_{n}"
            n += 1
        used.add(name)
        if old and old != name and not already_taken:
            rename[old] = name
        item = {"name": name, "type": qtype, "label": label[:500], "hint": str(q.get("hint") or "")[:600],
                "required": bool(q.get("required")) and qtype not in ("section", "note", "calculate"),
                "relevant": None, "validate": {}, "appearance": "default"}
        if qtype in ("select_one", "select_multiple", "rank", "likert"):
            ch = _clean_choices(q.get("choices"))
            if qtype == "likert" and len(ch) < 2:
                ch = [{"value": v, "label": l} for v, l in _LIKERT]
            if len(ch) < 2:
                ch = [{"value": "yes", "label": "Yes"}, {"value": "no", "label": "No"}]
            item["choices"] = ch
            item["shuffle_choices"] = False
        v = q.get("validate") if isinstance(q.get("validate"), dict) else {}
        clean_v = {}
        for key in ("min", "max"):
            if v.get(key) not in (None, ""):
                try:
                    clean_v[key] = float(v[key]) if "." in str(v[key]) else int(v[key])
                except (TypeError, ValueError):
                    pass
        for key in ("regex", "message", "expr", "warn_expr", "warn_message"):
            if v.get(key):
                clean_v[key] = str(v[key])[:300]
        if qtype == "rating" and "max" not in clean_v:
            clean_v["max"] = 5
        item["validate"] = clean_v
        if qtype == "calculate":
            item["calc"] = str(q.get("calc") or q.get("calculation") or "")[:400]
        if qtype == "repeat":
            rep = q.get("repeat") if isinstance(q.get("repeat"), dict) else {}
            item["repeat"] = {"min": rep.get("min"), "max": rep.get("max"),
                              "item_label": str(rep.get("item_label") or "Item ${index}")[:80]}
            if rep.get("count_expr"):
                item["repeat"]["count_expr"] = str(rep["count_expr"])[:120]
            kids, kid_known = [], set(known)
            for c in (q.get("children") or [])[:80]:
                k = one(c, kid_known, inside_repeat=True)
                if k:
                    kids.append(k)
                    kid_known.add(k["name"])
            item["children"] = kids
        item["_raw_relevant"] = q.get("relevant")
        return item

    known = set(existing_names)
    for q in (raw_list or [])[:MAX_QUESTIONS]:
        item = one(q, known)
        if item:
            out.append(item)
            known.add(item["name"])

    # Rewire skip logic after renames; only earlier questions are allowed.
    def remap(rel):
        if not isinstance(rel, dict):
            return rel
        rules = []
        for r in rel.get("rules") or []:
            if isinstance(r, dict) and isinstance(r.get("rules"), list):
                rules.append(remap(r))
            elif isinstance(r, dict):
                rules.append({**r, "q": rename.get(r.get("q"), r.get("q"))})
        return {**rel, "rules": rules}

    seen = set(existing_names)
    for item in out:
        rel = remap(item.pop("_raw_relevant", None))
        item["relevant"] = _clean_rules(rel, seen)
        seen.add(item["name"])
        kid_seen = set(seen)
        for kid in item.get("children") or []:
            krel = remap(kid.pop("_raw_relevant", None))
            kid["relevant"] = _clean_rules(krel, kid_seen)
            kid_seen.add(kid["name"])
    return out


def tool_questionnaire(ctx: AgentContext, spec: dict) -> dict:
    existing = []
    if spec.get("mode") == "append":
        sch = ctx.draft_schema or (ctx.survey.draft_schema if ctx.survey else {}) or {}
        for q in sch.get("questions") or []:
            existing.append(q.get("name"))
            existing.extend(c.get("name") for c in q.get("children") or [])
    qs = sanitize_questions(spec.get("questions"), [n for n in existing if n])
    if not qs:
        raise ToolError("I couldn't draft any questions from that — tell me the topic and who will answer.")
    counted = sum(1 + len(q.get("children") or []) for q in qs)
    logic = sum(1 for q in qs if q.get("relevant")) + sum(
        1 for q in qs for c in q.get("children") or [] if c.get("relevant"))
    return {"type": "questionnaire", "title": _clip_text(spec.get("title") or "Draft questionnaire", 140),
            "description": _clip_text(spec.get("description") or "", 500), "questions": qs,
            "count": counted, "logic_count": logic, "mode": spec.get("mode") or "new",
            "spec": {"tool": "questionnaire", "title": spec.get("title"), "description": spec.get("description"),
                     "questions": qs}}


# ─────────────────────────────────────────────────────────────────────
#  Tool: review_form (deterministic lint of the questionnaire)
# ─────────────────────────────────────────────────────────────────────

def tool_review_form(ctx: AgentContext, spec: dict) -> dict:
    sch = ctx.draft_schema or (ctx.survey.draft_schema if ctx.survey else {}) or {}
    qs = sch.get("questions") or []
    if not qs:
        raise ToolError("The form is empty — ask me to draft some questions first.")
    issues = []
    names_before = set()
    labels = Counter()
    answerable = 0
    required = 0
    has_consent = False
    no_other, no_range = [], []
    for i, q in enumerate(qs):
        items = [(q, None)] + [(c, q) for c in (q.get("children") or [])]
        for item, parent in items:
            if not isinstance(item, dict):
                continue
            t, lab, nm = item.get("type"), str(item.get("label") or ""), item.get("name")
            where = f"“{_clip_text(lab or nm, 60)}”"
            if t not in DISPLAY_TYPES and t != "repeat":
                answerable += 1
                labels[lab.strip().lower()] += 1
                if item.get("required"):
                    required += 1
            if re.search(r"\b(consent|agree to (take )?part|participate)\b", lab, re.I):
                has_consent = True
            if t in ("select_one", "select_multiple", "rank"):
                ch = item.get("choices") or []
                if len(ch) < 2:
                    issues.append({"level": "warn", "field": nm, "text": f"{where} has fewer than two answer options."})
                if any(re.fullmatch(r"option ?\d+", str(c.get("label") or ""), re.I) for c in ch if isinstance(c, dict)):
                    issues.append({"level": "warn", "field": nm, "text": f"{where} still has placeholder options (“Option 1”)."})
                if t == "select_one" and len(ch) > 12 and not item.get("appearance") in ("search", "minimal"):
                    issues.append({"level": "info", "field": nm, "text": f"{where} has {len(ch)} options — consider a searchable list or a cascade."})
                if t == "select_one" and len(ch) >= 4 and not any(
                        re.search(r"\b(other|none|don'?t know|refuse|not sure)", str(c.get("label")), re.I)
                        for c in ch if isinstance(c, dict)):
                    no_other.append(_clip_text(lab or nm, 40))
            if t in ("integer", "decimal") and not (item.get("validate") or {}).get("max") and not (item.get("validate") or {}).get("min"):
                no_range.append(_clip_text(lab or nm, 40))
            if len(lab) > 180:
                issues.append({"level": "info", "field": nm, "text": f"{where} is long ({len(lab)} characters); shorter questions get better answers."})
            if t not in DISPLAY_TYPES and re.search(r"\?.*\band\b.*\?|\b(and|or)\b[^?]{3,}\?$", lab) and lab.count("?") <= 1 and " and " in lab.lower() and len(lab) > 40:
                issues.append({"level": "info", "field": nm, "text": f"{where} may ask two things at once."})
            rel = item.get("relevant") or {}
            for r in rel.get("rules") or []:
                if isinstance(r, dict) and r.get("q") and r["q"] not in names_before:
                    issues.append({"level": "warn", "field": nm, "text": f"{where} shows depending on “{r['q']}”, which doesn't come earlier in the form."})
            if nm:
                names_before.add(nm)
    def listed(items):
        return ", ".join(f"“{x}”" for x in items[:4]) + (f" and {len(items) - 4} more" if len(items) > 4 else "")
    if no_range:
        issues.append({"level": "info", "text": (f"{listed(no_range)} {'has' if len(no_range) == 1 else 'have'} no minimum "
                                                 "or maximum — typos like 999 will slip through.")})
    if no_other:
        issues.append({"level": "info", "text": f"{listed(no_other)} {'has' if len(no_other) == 1 else 'have'} no "
                                                "“Other” or “Don't know” option."})
    for lab, n in labels.items():
        if lab and n > 1:
            issues.append({"level": "warn", "text": f"The question “{_clip_text(lab, 60)}” appears {n} times."})
    if answerable and not has_consent and any(detect_pii({"name": q.get("name", ""), "label": q.get("label", ""),
                                                          "type": q.get("type"), "kind": _kind_for(q.get("type"))})["level"] == "direct"
                                              for q in qs if isinstance(q, dict)):
        issues.insert(0, {"level": "warn", "text": "The form collects personal data but has no consent question at the start."})
    if answerable and not required:
        issues.append({"level": "info", "text": "No question is required — key questions can be skipped."})
    order = {"warn": 0, "info": 1}
    issues.sort(key=lambda i: order.get(i["level"], 2))
    return {"type": "lint", "title": "Questionnaire check", "issues": issues[:40],
            "summary": {"questions": answerable, "required": required, "warnings": sum(1 for i in issues if i["level"] == "warn")},
            "spec": {"tool": "review_form"}}


# ─────────────────────────────────────────────────────────────────────
#  Dispatcher
# ─────────────────────────────────────────────────────────────────────

TOOLS = {
    "overview": (tool_overview, "view"),
    "surveys": (tool_surveys, None),
    "profile": (tool_profile, "view"),
    "chart": (tool_chart, "view"),
    "table": (tool_table, "view"),
    "cards": (tool_cards, "view"),
    "map": (tool_map, "view"),
    "shape": (tool_shape, "view"),
    "clean": (tool_clean, "view"),
    "privacy": (tool_privacy, "view"),
    "dashboard": (tool_dashboard, "view"),
    "questionnaire": (tool_questionnaire, None),
    "review_form": (tool_review_form, None),
}
DATA_TOOLS = {k for k, (_fn, need) in TOOLS.items() if need == "view"}


def run_tool(ctx: AgentContext, action: dict) -> dict:
    """Run one planned action. Never raises: failures become an error block."""
    name = (action or {}).get("tool")
    if name not in TOOLS:
        return {"type": "error", "text": f"I don't have a “{name}” skill yet."}
    fn, need = TOOLS[name]
    if need == "view":
        if ctx.survey is None:
            return {"type": "error", "text": "Open a survey first (or pick one in the menu above) and I'll work on its data."}
        if not ctx.can.get("view"):
            return {"type": "error", "text": "You can't see this survey's data, so I can't analyse it for you."}
    try:
        return fn(ctx, action)
    except ToolError as exc:
        return {"type": "error", "text": str(exc)}
    except Exception as exc:  # pragma: no cover - defensive
        import logging
        logging.getLogger(__name__).exception("Kora tool %s failed", name)
        return {"type": "error", "text": "That didn't work on this data — try rephrasing, or pick a different column."}
