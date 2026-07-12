"""
kura/cleaning.py — the data-cleaning engine.

run_rules(survey) walks every enabled CleaningRule over the survey's
non-excluded submissions, writes SubmissionFlag rows (idempotently: old
unresolved flags from the same rule are replaced each run so a fixed row
un-flags itself), applies exclude/recode actions, and records every value
change in AnswerEdit so nothing is ever silently rewritten.

Rule configs (CleaningRule.config):

  duplicate      {"fields": ["phone","name"] | [] }      [] = whole answer set
  outlier        {"field": "income", "method": "iqr"|"zscore", "k": 1.5|3}
  speeder        {"min_seconds": 60}                     or {"percentile": 5}
  straightliner  {"fields": ["q1","q2",...], "min_distinct": 2}
  geofence       {"lat": 13.45, "lng": -16.57, "radius_km": 50}
  missing        {"fields": ["consent","age"]}
  logic          {"condition": {…kura.logic condition…}, "detail": "why"}
  recode         {"field": "region", "map": {"bnjl": "Banjul"},
                  "trim": true, "lower": false, "titlecase": false}
"""

from __future__ import annotations

import math
import statistics

from django.db import transaction

from .logic import evaluate_condition
from .models import AnswerEdit, CleaningRule, Submission, SubmissionFlag


def _numeric_series(subs, field):
    out = []
    for s in subs:
        v = s.answers.get(field)
        try:
            out.append((s, float(v)))
        except (TypeError, ValueError):
            continue
    return out


def _haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


# ── individual detectors: each returns [(submission, field, detail)] ──

def _detect_duplicate(subs, cfg):
    fields = cfg.get("fields") or []
    seen, hits = {}, []
    for s in subs:
        if fields:
            key = tuple(str(s.answers.get(f, "")).strip().lower() for f in fields)
            if all(k == "" for k in key):
                continue
        else:
            key = s.answers_hash()
        if key in seen:
            hits.append((s, ",".join(fields) if fields else "",
                         f"Duplicate of submission #{seen[key]}"))
        else:
            seen[key] = s.id
    return hits


def _detect_outlier(subs, cfg):
    field = cfg.get("field")
    if not field:
        return []
    series = _numeric_series(subs, field)
    if len(series) < 8:
        return []
    values = [v for _, v in series]
    hits = []
    if cfg.get("method", "iqr") == "zscore":
        mean = statistics.fmean(values)
        sd = statistics.pstdev(values) or 1e-9
        k = float(cfg.get("k", 3))
        for s, v in series:
            z = (v - mean) / sd
            if abs(z) > k:
                hits.append((s, field, f"z-score {z:.2f} (threshold {k})"))
    else:
        values_sorted = sorted(values)
        n = len(values_sorted)
        q1 = values_sorted[n // 4]
        q3 = values_sorted[(3 * n) // 4]
        iqr = (q3 - q1) or 1e-9
        k = float(cfg.get("k", 1.5))
        lo, hi = q1 - k * iqr, q3 + k * iqr
        for s, v in series:
            if v < lo or v > hi:
                hits.append((s, field, f"value {v:g} outside IQR fence [{lo:g}, {hi:g}]"))
    return hits


def _detect_speeder(subs, cfg):
    durations = [(s, s.duration_ms / 1000.0) for s in subs if s.duration_ms]
    if not durations:
        return []
    if cfg.get("min_seconds") is not None:
        floor = float(cfg["min_seconds"])
    else:
        pct = float(cfg.get("percentile", 5)) / 100.0
        ordered = sorted(d for _, d in durations)
        floor = ordered[max(0, int(len(ordered) * pct) - 1)]
    return [(s, "", f"completed in {d:.0f}s (floor {floor:.0f}s)")
            for s, d in durations if d < floor]


def _detect_straightliner(subs, cfg):
    fields = cfg.get("fields") or []
    if len(fields) < 3:
        return []
    min_distinct = int(cfg.get("min_distinct", 2))
    hits = []
    for s in subs:
        vals = [str(s.answers.get(f)) for f in fields if s.answers.get(f) not in (None, "", [])]
        if len(vals) >= 3 and len(set(vals)) < min_distinct:
            hits.append((s, ",".join(fields),
                         f"identical answer on {len(vals)} scale items"))
    return hits


def _detect_geofence(subs, cfg):
    try:
        lat, lng = float(cfg["lat"]), float(cfg["lng"])
        radius = float(cfg.get("radius_km", 50))
    except (KeyError, TypeError, ValueError):
        return []
    hits = []
    for s in subs:
        if s.gps_lat is None or s.gps_lng is None:
            continue
        d = _haversine_km(lat, lng, s.gps_lat, s.gps_lng)
        if d > radius:
            hits.append((s, "gps", f"{d:.1f} km from survey area (limit {radius:g} km)"))
    return hits


def _detect_missing(subs, cfg):
    fields = cfg.get("fields") or []
    hits = []
    for s in subs:
        gaps = [f for f in fields if s.answers.get(f) in (None, "", [], {})]
        if gaps:
            hits.append((s, ",".join(gaps), f"missing: {', '.join(gaps)}"))
    return hits


def _detect_logic(subs, cfg):
    cond = cfg.get("condition")
    if not cond:
        return []
    detail = cfg.get("detail") or "custom logic check matched"
    return [(s, "", detail) for s in subs if evaluate_condition(cond, s.answers)]


DETECTORS = {
    "duplicate": _detect_duplicate,
    "outlier": _detect_outlier,
    "speeder": _detect_speeder,
    "straightliner": _detect_straightliner,
    "geofence": _detect_geofence,
    "missing": _detect_missing,
    "logic": _detect_logic,
}


def _apply_recode(subs, rule, user=None):
    cfg = rule.config or {}
    field = cfg.get("field")
    if not field:
        return 0
    mapping = {str(k).strip().lower(): v for k, v in (cfg.get("map") or {}).items()}
    changed = 0
    for s in subs:
        old = s.answers.get(field)
        if old in (None, "", [], {}):
            continue
        new = old
        if isinstance(new, str):
            if cfg.get("trim"):
                new = new.strip()
            if cfg.get("lower"):
                new = new.lower()
            if cfg.get("titlecase"):
                new = new.title()
        key = str(new).strip().lower()
        if key in mapping:
            new = mapping[key]
        if new != old:
            s.answers[field] = new
            s.save(update_fields=["answers"])
            AnswerEdit.objects.create(
                submission=s, field=field, old_value=old, new_value=new,
                reason="auto recode", rule_name=rule.name, edited_by=user,
            )
            changed += 1
    return changed


@transaction.atomic
def run_rules(survey, user=None):
    """Run every enabled rule. Returns a per-rule summary dict."""
    subs = list(
        survey.submissions.exclude(status="excluded").order_by("received_at")
    )
    summary = []

    for rule in survey.cleaning_rules.filter(enabled=True):
        if rule.kind == "recode":
            n = _apply_recode(subs, rule, user=user)
            summary.append({"rule": rule.name, "kind": rule.kind, "changed": n})
            continue

        detector = DETECTORS.get(rule.kind)
        if not detector:
            continue

        # Re-baseline: clear this rule's unresolved flags so fixed rows heal.
        SubmissionFlag.objects.filter(rule=rule, resolved=False).delete()

        hits = detector(subs, rule.config or {})
        for s, field, detail in hits:
            SubmissionFlag.objects.create(
                submission=s, rule=rule, field=field, detail=detail[:240],
            )
            if rule.action == "exclude" and s.status != "excluded":
                s.status = "excluded"
                s.save(update_fields=["status"])
            elif s.status == "complete":
                s.status = "flagged"
                s.save(update_fields=["status"])

        summary.append({"rule": rule.name, "kind": rule.kind, "hits": len(hits)})

    # Heal: any flagged submission with no unresolved flags returns to complete.
    for s in survey.submissions.filter(status="flagged"):
        if not s.flags.filter(resolved=False).exists():
            s.status = "complete"
            s.save(update_fields=["status"])

    return summary


def default_rules(survey):
    """Seed a sensible starter rule set when a survey is first published."""
    if survey.cleaning_rules.exists():
        return
    CleaningRule.objects.bulk_create([
        CleaningRule(survey=survey, name="Exact duplicates", kind="duplicate",
                     action="flag", config={"fields": []}),
        CleaningRule(survey=survey, name="Speeders under 30s", kind="speeder",
                     action="flag", config={"min_seconds": 30}),
    ])
