"""
kura/dashboard_engine.py — turns a LiveDashboard into numbers, right now.

The one idea that makes this work
---------------------------------
Everything downstream of ``resolve_frame()`` is source-agnostic. A tile does
not know whether its rows came from the submissions table thirty
milliseconds ago, from a pipeline applied in memory, from an uploaded
spreadsheet, or from a frozen run. So the *same* tile definition keeps
working when you plug a pipeline into a live board — which is the feature
you actually want on election night: raw counts while the data is thin,
then flip the source to a cleaning pipeline once the rules matter, without
rebuilding a single card.

Pipelines run **in memory**. ``PipelineExecutor`` normally writes
``CleanedRecord`` and ``CleaningChange`` rows; a dashboard refreshing every
few seconds must not. ``LiveTransformer`` subclasses it, drops the audit
recording, and applies the same step handlers to a DataFrame. Same
transformations, same edge cases, no writes.

Cost control: one HTTP request computes *every* tile from *one* resolved
frame, and the frame itself is cached against a cheap data stamp
(row count + newest timestamp), so twenty tiles and six open browsers on a
stable dataset cost one pass over the data, not a hundred and twenty.
"""

from __future__ import annotations

import hashlib
import math
from datetime import timedelta

import numpy as np
import pandas as pd
from django.core.cache import cache
from django.db.models import Count, Max
from django.utils import timezone

from .analytics import (
    _coerce_numeric,
    _find_datetime_column,
    _is_numeric_col,
    _norm_freq,
    _safe,
    map_points,
    run_dataframe,
)
from .pipeline_engine import (
    META_COLUMNS,
    PipelineExecutionError,
    PipelineExecutor,
    dataset_dataframe,
    survey_dataframe,
)

FRAME_CACHE_SECONDS = 4
MAX_TABLE_ROWS = 300
MAX_MAP_POINTS = 4000


# ─────────────────────────────────────────────────────────────────────
#  In-memory pipeline application
# ─────────────────────────────────────────────────────────────────────

class LiveTransformer(PipelineExecutor):
    """Applies a saved pipeline's steps to a frame without persisting anything.

    ``PipelineExecutor`` only touches ``self.run`` inside ``record_change``
    and ``execute``; overriding both is enough to reuse every step handler
    verbatim. If a step fails and it is not marked ``stop_on_error`` the
    frame carries on unchanged from that step — the dashboard would rather
    show slightly rawer data than nothing at all.
    """

    def __init__(self, pipeline):
        self.run = None
        self.pipeline = pipeline
        self.survey = pipeline.survey
        self.changes = []
        self.excluded = []
        self.step_stats = []

    def record_change(self, *args, **kwargs):
        return None

    def transform(self, df):
        for step in self.pipeline.steps.filter(enabled=True).order_by("order", "id"):
            try:
                df = self._apply_step(df.copy(), step)
                self.step_stats.append({"name": step.name, "status": "ok",
                                        "rows": len(df)})
            except (PipelineExecutionError, Exception) as exc:  # noqa: B014
                self.step_stats.append({"name": step.name, "status": "failed",
                                        "error": str(exc)})
                if step.stop_on_error:
                    raise
        return df


# ─────────────────────────────────────────────────────────────────────
#  Source resolution
# ─────────────────────────────────────────────────────────────────────

def data_stamp(dashboard) -> str:
    """A cheap fingerprint of the underlying data.

    Two DB aggregates for a live source; a constant for a static one. This
    is what lets the frame cache be correct rather than merely fast: the
    moment a submission lands the stamp changes and every open board sees
    the new number on its next tick.
    """
    if dashboard.source in ("submissions", "pipeline"):
        qs = dashboard.survey.submissions
        if not dashboard.include_excluded:
            qs = qs.exclude(status="excluded")
        agg = qs.aggregate(n=Count("id"), last=Max("received_at"))
        parts = [str(agg.get("n") or 0), str(agg.get("last") or "")]
        if dashboard.source == "pipeline" and dashboard.pipeline_id:
            parts += [str(dashboard.pipeline_id),
                      str(dashboard.pipeline.updated_at)]
    elif dashboard.source == "dataset" and dashboard.dataset_id:
        parts = ["ds", str(dashboard.dataset_id), str(dashboard.dataset.created_at)]
    elif dashboard.source == "run" and dashboard.run_id:
        parts = ["run", str(dashboard.run_id), str(dashboard.run.completed_at)]
    else:
        parts = ["empty"]
    parts.append(str(dashboard.include_excluded))
    return hashlib.md5("|".join(parts).encode()).hexdigest()[:16]


def _raw_frame(dashboard) -> pd.DataFrame:
    if dashboard.source == "dataset" and dashboard.dataset_id:
        return dataset_dataframe(dashboard.dataset)

    if dashboard.source == "run" and dashboard.run_id:
        return run_dataframe(dashboard.run)

    df, _subs = survey_dataframe(dashboard.survey)
    if df.empty:
        return df
    if not dashboard.include_excluded and "_status" in df.columns:
        df = df[df["_status"] != "excluded"].copy()

    if dashboard.source == "pipeline" and dashboard.pipeline_id:
        df = LiveTransformer(dashboard.pipeline).transform(df)
    return df


def resolve_frame(dashboard, use_cache=True):
    """Return ``(df, meta)`` for the dashboard's current data."""
    stamp = data_stamp(dashboard)
    key = f"kura:dashframe:{dashboard.id}:{stamp}"

    if use_cache:
        hit = cache.get(key)
        if hit is not None:
            df = pd.DataFrame(hit["rows"])
            return df, {**hit["meta"], "cached": True}

    error = ""
    try:
        df = _raw_frame(dashboard)
    except Exception as exc:
        # A broken pipeline step must not blank the whole ops screen.
        df = pd.DataFrame()
        error = str(exc)

    meta = {
        "stamp": stamp,
        "rows": int(len(df)),
        "columns": [c for c in df.columns],
        "source": dashboard.source,
        "source_label": dashboard.source_label,
        "error": error,
        "cached": False,
    }

    if use_cache and len(df) <= 20000:
        cache.set(key, {"rows": df.to_dict(orient="records"), "meta": meta},
                  FRAME_CACHE_SECONDS)
    return df, meta


# ─────────────────────────────────────────────────────────────────────
#  Filtering
# ─────────────────────────────────────────────────────────────────────

def apply_conditions(df, conditions, match="all"):
    """Filter a frame with the same condition shape the pipeline editor uses.

    Reusing ``PipelineExecutor._combined_mask`` means a filter you already
    know how to write in a cleaning step behaves identically on a
    dashboard — including the numeric-vs-string equality handling that
    trips people up.
    """
    conditions = [c for c in (conditions or []) if c and c.get("field")]
    if df.empty or not conditions:
        return df
    try:
        mask = PipelineExecutor._combined_mask(
            df, {"conditions": conditions, "match": match or "all"},
        )
        return df.loc[mask].copy()
    except Exception:
        return df


def _tile_frame(df, tile):
    return apply_conditions(df, tile.get("filters"), tile.get("filter_match"))


# ─────────────────────────────────────────────────────────────────────
#  Aggregation primitives
# ─────────────────────────────────────────────────────────────────────

def _aggregate(df, column, agg):
    """One scalar out of a frame. ``agg='count'`` ignores the column."""
    if df.empty:
        return 0 if agg in ("count", "distinct") else None
    if agg == "count" or not column:
        return int(len(df))
    if column not in df.columns:
        return None
    series = df[column]
    if agg == "distinct":
        return int(series.dropna().astype(str).nunique())
    if agg == "filled":
        return int((~(series.isna() | series.astype(str).str.strip().eq(""))).sum())
    if agg == "missing":
        return int((series.isna() | series.astype(str).str.strip().eq("")).sum())
    nums = _coerce_numeric(series).dropna()
    if nums.empty:
        return None
    return _safe(getattr(nums, agg)()) if hasattr(nums, agg) else None


def _time_column(df, preferred=None):
    col, parsed = _find_datetime_column(df, preferred)
    return col, parsed


def _window_frames(df, spec):
    """Split a frame into (current window, previous window of equal length)."""
    minutes = float(spec.get("window_minutes") or 60)
    col, parsed = _time_column(df, spec.get("date"))
    if parsed is None:
        return df, None, None
    work = df.copy()
    work["_ts"] = parsed
    work = work.dropna(subset=["_ts"])
    if work.empty:
        return work, None, col

    now = work["_ts"].max()
    span = timedelta(minutes=minutes)
    current = work[work["_ts"] > now - span]
    previous = work[(work["_ts"] <= now - span) & (work["_ts"] > now - 2 * span)]
    return current, previous, col


# ─────────────────────────────────────────────────────────────────────
#  Chart building (frame-based twin of analytics.custom_chart)
# ─────────────────────────────────────────────────────────────────────

def frame_chart(df, spec, kind="bar"):
    """Build Chart.js-ready data from a frame.

    Handles every dashboard chart kind in one place so a tile can be
    switched from bar to donut to line without touching its spec.
    """
    if df.empty:
        return {"ok": False, "error": "No rows yet."}

    x = spec.get("x")
    y = spec.get("y") or None
    agg = spec.get("agg", "count")
    group_by = spec.get("group_by") or None
    limit = int(spec.get("limit") or 25)

    if kind == "histogram":
        col = x or y
        if not col or col not in df.columns:
            return {"ok": False, "error": "Pick a numeric column."}
        nums = _coerce_numeric(df[col]).dropna()
        if nums.empty:
            return {"ok": False, "error": f"'{col}' has no numbers."}
        bins = int(spec.get("bins") or min(20, max(5, int(math.sqrt(len(nums))))))
        counts, edges = np.histogram(nums, bins=bins)
        return {
            "ok": True, "chart": "bar",
            "labels": [f"{edges[i]:g}–{edges[i + 1]:g}" for i in range(len(counts))],
            "series": [{"name": col, "data": counts.astype(int).tolist()}],
        }

    if kind == "scatter":
        if not (x and y and x in df.columns and y in df.columns):
            return {"ok": False, "error": "Scatter needs an X and a Y column."}
        xs, ys = _coerce_numeric(df[x]), _coerce_numeric(df[y])
        valid = xs.notna() & ys.notna()
        points = [{"x": _safe(a), "y": _safe(b)}
                  for a, b in zip(xs[valid], ys[valid])][:2000]
        return {"ok": True, "chart": "scatter",
                "series": [{"name": f"{y} vs {x}", "data": points}]}

    if not x or x not in df.columns:
        return {"ok": False, "error": "Pick a column to break the data down by."}

    work = df.copy()
    if y and y in work.columns:
        work[y] = _coerce_numeric(work[y])

    measure = "responses" if (agg == "count" or not y) else f"{agg} of {y}"

    if group_by and group_by in work.columns:
        keys = [work[x].astype(str), work[group_by].astype(str)]
        grouped = (work.groupby(keys).size() if (agg == "count" or not y)
                   else getattr(work.groupby(keys)[y], agg)())
        table = grouped.unstack(fill_value=0)
        table = table.loc[table.index[:limit]]
        return {
            "ok": True, "chart": kind, "grouped": True, "measure": measure,
            "labels": [str(v) for v in table.index.tolist()],
            "series": [{"name": str(c), "data": [_safe(v) for v in table[c].tolist()]}
                       for c in table.columns],
        }

    series = (work.groupby(work[x].astype(str)).size() if (agg == "count" or not y)
              else getattr(work.groupby(work[x].astype(str))[y], agg)())

    sort = spec.get("sort", "value")
    if sort == "value":
        series = series.sort_values(ascending=False)
    elif sort == "label":
        series = series.sort_index()
    total = float(series.sum()) or 1.0
    series = series.head(limit)

    return {
        "ok": True, "chart": kind, "measure": measure,
        "labels": [str(i) for i in series.index.tolist()],
        "series": [{"name": measure, "data": [_safe(v) for v in series.tolist()]}],
        "percent": [round(float(v) * 100 / total, 1) for v in series.tolist()],
        "total": _safe(total),
    }


def frame_timeseries(df, spec):
    if df.empty:
        return {"ok": False, "error": "No rows yet."}

    col, parsed = _time_column(df, spec.get("date"))
    if parsed is None:
        return {"ok": False, "error": "No date/time column to plot against."}

    work = df.copy()
    work["_ts"] = parsed
    work = work.dropna(subset=["_ts"])
    if work.empty:
        return {"ok": False, "error": "That column holds no readable dates."}

    y = spec.get("y") or None
    agg = spec.get("agg", "count")
    group_by = spec.get("group_by") or None
    if y and y in work.columns:
        work[y] = _coerce_numeric(work[y])

    grouper = pd.Grouper(key="_ts", freq=_norm_freq(spec.get("freq", "D")))

    if group_by and group_by in work.columns:
        g = work.groupby([grouper, work[group_by].astype(str)])
        s = (g.size() if (agg == "count" or not y) else getattr(g[y], agg)())
        table = s.unstack(fill_value=0)
        out = []
        for c in table.columns:
            data = table[c].cumsum() if spec.get("cumulative") else table[c]
            out.append({"name": str(c), "data": [_safe(v) for v in data.tolist()]})
        return {"ok": True, "chart": "line", "date_col": col,
                "labels": [d.isoformat() for d in table.index], "series": out}

    g = work.groupby(grouper)
    s = (g.size() if (agg == "count" or not y) else getattr(g[y], agg)())
    if spec.get("cumulative"):
        s = s.cumsum()
    series = [{"name": f"{agg} of {y}" if y else "responses",
               "data": [_safe(v) for v in s.tolist()]}]

    rolling = spec.get("rolling")
    if rolling and int(rolling) > 1:
        roll = s.rolling(int(rolling), min_periods=1).mean()
        series.append({"name": f"{rolling}-point average", "dashed": True,
                       "data": [_safe(v) for v in roll.tolist()]})

    return {"ok": True, "chart": "line", "date_col": col,
            "labels": [d.isoformat() for d in s.index], "series": series}


# ─────────────────────────────────────────────────────────────────────
#  Tile computation
# ─────────────────────────────────────────────────────────────────────

def _evaluate_alert(value, alert):
    """Return 'ok' | 'warn' | 'alarm' for a tile's headline value."""
    if not alert or value is None:
        return "ok"
    try:
        threshold = float(alert.get("value"))
        current = float(value)
    except (TypeError, ValueError):
        return "ok"
    op = alert.get("op", "lt")
    hit = ((op == "lt" and current < threshold)
           or (op == "gt" and current > threshold)
           or (op == "eq" and current == threshold))
    if not hit:
        return "ok"
    return alert.get("level", "alarm")


def compute_tile(df, tile, ctx):
    """Compute one tile. Never raises — a bad tile shows an error, the board lives."""
    kind = tile.get("kind", "kpi")
    spec = tile.get("spec") or {}
    out = {"id": tile.get("id"), "kind": kind, "ok": True}

    try:
        data = _tile_frame(df, tile)

        if kind == "text":
            out.update({"body": spec.get("body", "")})
            return out

        if kind in ("kpi", "gauge"):
            value = _aggregate(data, spec.get("column"), spec.get("agg", "count"))
            out.update({
                "value": value,
                "rows": int(len(data)),
                "target": spec.get("target"),
                "status": _evaluate_alert(value, tile.get("alert")),
            })
            return out

        if kind == "delta":
            current, previous, date_col = _window_frames(data, spec)
            now_value = _aggregate(current, spec.get("column"), spec.get("agg", "count"))
            was_value = _aggregate(previous, spec.get("column"), spec.get("agg", "count")) \
                if previous is not None else None
            change = None
            if isinstance(now_value, (int, float)) and isinstance(was_value, (int, float)):
                change = now_value - was_value
            out.update({
                "value": now_value,
                "previous": was_value,
                "change": change,
                "percent_change": (round(change * 100 / was_value, 1)
                                   if change is not None and was_value else None),
                "window_minutes": spec.get("window_minutes") or 60,
                "date_col": date_col,
                "status": _evaluate_alert(now_value, tile.get("alert")),
            })
            return out

        if kind == "progress":
            value = _aggregate(data, spec.get("column"), spec.get("agg", "count"))
            target = spec.get("target")
            try:
                target = float(target)
            except (TypeError, ValueError):
                target = None
            percent = (round(float(value) * 100 / target, 1)
                       if target and isinstance(value, (int, float)) else None)
            out.update({
                "value": value, "target": target, "percent": percent,
                "remaining": (round(target - float(value), 2)
                              if target and isinstance(value, (int, float)) else None),
                "status": _evaluate_alert(percent if percent is not None else value,
                                          tile.get("alert")),
            })
            return out

        if kind == "leaderboard":
            group_by = spec.get("group_by")
            if not group_by or group_by not in data.columns:
                return {**out, "ok": False, "error": "Pick a column to rank by."}
            column = spec.get("column")
            agg = spec.get("agg", "count")
            rows = []
            for key, grp in data.groupby(data[group_by].astype(str)):
                rows.append({"label": key, "value": _aggregate(grp, column, agg)})
            rows = [r for r in rows if r["value"] is not None]
            rows.sort(key=lambda r: r["value"],
                      reverse=not spec.get("ascending", False))
            rows = rows[:int(spec.get("limit") or 12)]
            top = rows[0]["value"] if rows else 0
            for r in rows:
                r["share"] = (round(float(r["value"]) * 100 / top, 1)
                              if top else 0)
            out.update({"rows": rows, "group_by": group_by,
                        "target": spec.get("target")})
            return out

        if kind == "table":
            columns = [c for c in (spec.get("columns") or []) if c in data.columns]
            if not columns:
                columns = [c for c in data.columns if c not in META_COLUMNS][:8]
            sort_by = spec.get("sort_by")
            work = data
            if sort_by and sort_by in work.columns:
                work = work.sort_values(sort_by,
                                        ascending=bool(spec.get("ascending", False)))
            elif "_received_at" in work.columns:
                work = work.sort_values("_received_at", ascending=False)
            limit = min(MAX_TABLE_ROWS, int(spec.get("limit") or 25))
            records = work[columns].head(limit).to_dict(orient="records")
            out.update({
                "columns": columns,
                "rows": [{k: _safe(v) for k, v in r.items()} for r in records],
                "total": int(len(data)),
            })
            return out

        if kind == "map":
            points, source = map_points(None, data, ctx.get("schema"),
                                        limit=MAX_MAP_POINTS)
            colour_by = spec.get("color_by")
            if colour_by and colour_by in data.columns and points:
                values = data[colour_by].astype(str).tolist()
                for p in points:
                    index = p.get("row", 0) - 1
                    if 0 <= index < len(values):
                        p["group"] = values[index]
            out.update({"points": points, "source": source,
                        "color_by": colour_by if points else None})
            return out

        if kind == "timeseries":
            out.update(frame_timeseries(data, spec))
            return out

        if kind in ("bar", "hbar", "pie", "donut", "line", "area",
                    "histogram", "scatter"):
            out.update(frame_chart(data, spec, kind))
            return out

        return {**out, "ok": False, "error": f"Unknown tile type '{kind}'."}

    except Exception as exc:
        return {**out, "ok": False, "error": str(exc)}


def pulse(df, dashboard):
    """The header ticker: is data still arriving, and how fast?

    On a static source this is quiet by design. On a live one it is the
    single most-watched number in the room — if the arrival rate falls off
    a cliff you have a field problem, not a data problem.
    """
    info = {"rows": int(len(df)), "streaming": dashboard.is_streaming,
            "last_at": None, "last_hour": 0, "last_15": 0, "per_hour": None}
    if df.empty or not dashboard.is_streaming:
        return info

    col, parsed = _time_column(df, "_received_at")
    if parsed is None:
        return info

    stamps = parsed.dropna()
    if stamps.empty:
        return info

    last = stamps.max()
    info["last_at"] = last.isoformat()
    now = pd.Timestamp(timezone.now())
    if last.tzinfo is None:
        now = now.tz_localize(None)
    info["seconds_since"] = max(0, int((now - last).total_seconds()))
    info["last_hour"] = int((stamps > now - pd.Timedelta(hours=1)).sum())
    info["last_15"] = int((stamps > now - pd.Timedelta(minutes=15)).sum())
    if info["last_hour"]:
        info["per_hour"] = info["last_hour"]
    return info


def dashboard_payload(dashboard, schema=None, tile_ids=None, use_cache=True):
    """Compute the whole board in one pass over one resolved frame."""
    df, meta = resolve_frame(dashboard, use_cache=use_cache)
    df = apply_conditions(df, dashboard.filters, dashboard.filter_match)

    tiles = dashboard.tiles.all()
    if tile_ids:
        tiles = [t for t in tiles if t.id in set(tile_ids)]

    ctx = {"schema": schema or {}}
    return {
        "ok": True,
        "stamp": meta["stamp"],
        "meta": {**meta, "filtered_rows": int(len(df))},
        "pulse": pulse(df, dashboard),
        "tiles": [compute_tile(df, t.as_dict(), ctx) for t in tiles],
        "generated_at": timezone.now().isoformat(),
    }


def field_catalogue(dashboard, schema=None):
    """Columns available to the tile editor, typed and labelled.

    Typing matters here: the editor uses it to stop someone averaging a
    village name, and to pre-select sensible defaults when a tile is
    dropped on the board.
    """
    df, meta = resolve_frame(dashboard)
    labels = {}
    for q in (schema or {}).get("questions", []):
        if q.get("name"):
            labels[q["name"]] = q.get("label") or q["name"]

    fields = []
    for column in df.columns:
        series = df[column]
        if _is_numeric_col(series):
            kind = "numeric"
        else:
            _c, parsed = _find_datetime_column(df[[column]], column)
            kind = "datetime" if parsed is not None else "categorical"
        entry = {
            "name": column,
            "label": labels.get(column, column),
            "kind": kind,
            "meta": column in META_COLUMNS,
        }
        if kind == "categorical":
            top = series.dropna().astype(str).value_counts().head(12)
            entry["values"] = [{"value": k, "count": int(v)} for k, v in top.items()]
            entry["unique"] = int(series.dropna().astype(str).nunique())
        fields.append(entry)

    fields.sort(key=lambda f: (f["meta"], f["name"]))
    return {"fields": fields, "rows": meta["rows"], "error": meta.get("error", "")}
