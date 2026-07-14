"""Statistical summaries and dashboard payloads for cleaned Kura datasets."""

from __future__ import annotations

import math
from collections import Counter

import numpy as np
import pandas as pd


def run_dataframe(run):
    rows = [r.data for r in run.records.filter(excluded=False).order_by("row_number")]
    return pd.DataFrame(rows)


def _safe(value):
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        return None if np.isnan(value) else float(value)
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def dashboard_payload(run, dependent=None, independent=None):
    df = run_dataframe(run)
    independent = independent or []
    payload = {
        "run": {
            "id": run.id,
            "label": run.label,
            "rows": len(df),
            "columns": len(df.columns),
            "changes": run.changes.count(),
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        },
        "overview": {},
        "numeric": {},
        "categorical": {},
        "correlation": {"columns": [], "matrix": []},
        "maps": [],
        "regression": None,
    }
    if df.empty:
        return payload

    missing_by_column = {
        c: int(df[c].isna().sum() + df[c].astype(str).str.strip().eq("").sum())
        for c in df.columns
    }
    total_cells = max(1, len(df) * len(df.columns))
    payload["overview"] = {
        "rows": len(df),
        "columns": len(df.columns),
        "missing_cells": sum(missing_by_column.values()),
        "missing_percent": round(sum(missing_by_column.values()) * 100 / total_cells, 2),
        "duplicates": int(df.duplicated().sum()),
        "missing_by_column": missing_by_column,
    }

    numeric = df.apply(pd.to_numeric, errors="coerce")
    numeric_cols = [c for c in df.columns if numeric[c].notna().sum() >= max(3, len(df) * .5)]
    for c in numeric_cols:
        s = numeric[c].dropna()
        payload["numeric"][c] = {
            "count": int(s.count()),
            "mean": _safe(s.mean()),
            "median": _safe(s.median()),
            "mode": _safe(s.mode().iloc[0]) if not s.mode().empty else None,
            "std": _safe(s.std()),
            "min": _safe(s.min()),
            "max": _safe(s.max()),
            "q1": _safe(s.quantile(.25)),
            "q3": _safe(s.quantile(.75)),
            "histogram": {
                "counts": np.histogram(s, bins=min(12, max(4, int(math.sqrt(len(s))))))[0].astype(int).tolist(),
                "edges": [round(float(v), 6) for v in np.histogram(s, bins=min(12, max(4, int(math.sqrt(len(s))))))[1]],
            },
        }

    categorical_cols = [c for c in df.columns if c not in numeric_cols]
    for c in categorical_cols[:50]:
        counts = df[c].fillna("(missing)").astype(str).value_counts().head(20)
        payload["categorical"][c] = {
            "labels": counts.index.tolist(),
            "values": counts.astype(int).tolist(),
            "unique": int(df[c].nunique(dropna=True)),
        }

    if numeric_cols:
        corr = numeric[numeric_cols].corr(method="pearson")
        payload["correlation"] = {
            "columns": numeric_cols,
            "matrix": [
                [_safe(corr.loc[r, c]) for c in numeric_cols]
                for r in numeric_cols
            ],
        }

    lat_name = next((c for c in ["gps_lat", "_gps_lat", "latitude", "lat"] if c in df.columns), None)
    lng_name = next((c for c in ["gps_lng", "_gps_lng", "longitude", "lng", "lon"] if c in df.columns), None)
    if lat_name and lng_name:
        lats = pd.to_numeric(df[lat_name], errors="coerce")
        lngs = pd.to_numeric(df[lng_name], errors="coerce")
        valid = lats.notna() & lngs.notna()
        payload["maps"] = [
            {"lat": float(lats[i]), "lng": float(lngs[i]), "row": int(pos + 1)}
            for pos, i in enumerate(df.index[valid][:5000])
        ]

    if dependent and dependent in df.columns and independent:
        payload["regression"] = regression_payload(df, dependent, independent)

    return payload


def regression_payload(df, dependent, independent):
    independent = [c for c in independent if c in df.columns and c != dependent]
    if not independent:
        return {"ok": False, "error": "Choose at least one independent variable."}
    try:
        from sklearn.compose import ColumnTransformer
        from sklearn.impute import SimpleImputer
        from sklearn.linear_model import LinearRegression, LogisticRegression
        from sklearn.metrics import accuracy_score, r2_score
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import OneHotEncoder
    except ImportError:
        return {"ok": False, "error": "scikit-learn is not installed."}

    work = df[independent + [dependent]].copy()
    y_numeric = pd.to_numeric(work[dependent], errors="coerce")
    numeric_target = y_numeric.notna().sum() >= max(5, len(work) * .8)
    valid = y_numeric.notna() if numeric_target else work[dependent].notna()
    work = work.loc[valid]
    if len(work) < 5:
        return {"ok": False, "error": "Not enough complete rows for regression."}

    numeric_cols = [
        c for c in independent
        if pd.to_numeric(work[c], errors="coerce").notna().sum() >= len(work) * .8
    ]
    for c in numeric_cols:
        work[c] = pd.to_numeric(work[c], errors="coerce")
    categorical_cols = [c for c in independent if c not in numeric_cols]

    prep = ColumnTransformer([
        ("num", SimpleImputer(strategy="median"), numeric_cols),
        ("cat", Pipeline([
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", OneHotEncoder(handle_unknown="ignore")),
        ]), categorical_cols),
    ])

    if numeric_target:
        y = pd.to_numeric(work[dependent], errors="coerce")
        model = Pipeline([("prep", prep), ("model", LinearRegression())])
        kind = "linear"
    else:
        y = work[dependent].astype(str)
        if y.nunique() < 2:
            return {"ok": False, "error": "Dependent variable has fewer than two classes."}
        model = Pipeline([("prep", prep), ("model", LogisticRegression(max_iter=1000))])
        kind = "logistic"

    model.fit(work[independent], y)
    predicted = model.predict(work[independent])
    metric = (
        {"r2": float(r2_score(y, predicted))}
        if kind == "linear"
        else {"accuracy": float(accuracy_score(y, predicted))}
    )
    return {
        "ok": True,
        "kind": kind,
        "dependent": dependent,
        "independent": independent,
        "n": len(work),
        "metric": metric,
        "actual": [_safe(v) for v in list(y)[:500]],
        "predicted": [_safe(v) for v in list(predicted)[:500]],
    }


# ══════════════════════════════════════════════════════════════════════
#  Extended studio analytics: dataset summary, custom charts, time series,
#  and historical timeline playback. All operate on a completed run's rows.
# ══════════════════════════════════════════════════════════════════════

def _coerce_numeric(series):
    return pd.to_numeric(series, errors="coerce")


def _is_numeric_col(series, threshold=0.6):
    if series.empty:
        return False
    return _coerce_numeric(series).notna().mean() >= threshold


def column_profile(run):
    """A friendly per-column profile for the dataset summary panel."""
    df = run_dataframe(run)
    out = {"rows": len(df), "columns": len(df.columns), "fields": []}
    if df.empty:
        return out
    for c in df.columns:
        s = df[c]
        non_null = s[~(s.isna() | s.astype(str).str.strip().isin(["", "None", "nan"]))]
        missing = len(df) - len(non_null)
        info = {
            "name": c,
            "missing": int(missing),
            "missing_percent": round(missing * 100 / max(1, len(df)), 1),
            "unique": int(non_null.nunique()),
        }
        if _is_numeric_col(s):
            nums = _coerce_numeric(s).dropna()
            info["kind"] = "numeric"
            info.update({
                "min": _safe(nums.min()), "max": _safe(nums.max()),
                "mean": _safe(round(nums.mean(), 3)) if len(nums) else None,
                "median": _safe(nums.median()) if len(nums) else None,
                "std": _safe(round(nums.std(), 3)) if len(nums) > 1 else None,
            })
        else:
            top = non_null.astype(str).value_counts().head(5)
            info["kind"] = "categorical"
            info["top_values"] = [{"value": k, "count": int(v)} for k, v in top.items()]
        out["fields"].append(info)
    return out


def numeric_columns(run):
    df = run_dataframe(run)
    return [c for c in df.columns if _is_numeric_col(df[c])]


def custom_chart(run, spec):
    """Build data for a user-configured chart.

    spec = {
        chart: "bar"|"line"|"pie"|"scatter"|"histogram"|"box"|"grouped_bar",
        x: <column>,                # dimension / category / x-axis
        y: <column or null>,        # measure (numeric); null → count rows
        agg: "count"|"sum"|"mean"|"median"|"min"|"max",
        group_by: <column or null>, # optional series split
        bins: <int>,                # histogram
        sort: "value"|"label"|null,
        limit: <int>,               # keep top N categories
    }
    Returns {ok, chart, labels, series:[{name, data}], ...} ready for Chart.js.
    """
    df = run_dataframe(run)
    if df.empty:
        return {"ok": False, "error": "No rows in this run."}

    chart = spec.get("chart", "bar")
    x = spec.get("x")
    y = spec.get("y") or None
    agg = spec.get("agg", "count")
    group_by = spec.get("group_by") or None
    limit = int(spec.get("limit") or 30)

    if x not in df.columns and chart != "histogram":
        return {"ok": False, "error": "Choose a valid X column."}

    # ── histogram: distribution of one numeric column ──
    if chart == "histogram":
        col = x or y
        if col not in df.columns:
            return {"ok": False, "error": "Choose a numeric column."}
        nums = _coerce_numeric(df[col]).dropna()
        if nums.empty:
            return {"ok": False, "error": f"'{col}' has no numeric values."}
        bins = int(spec.get("bins") or min(20, max(5, int(math.sqrt(len(nums))))))
        counts, edges = np.histogram(nums, bins=bins)
        labels = [f"{edges[i]:g}–{edges[i+1]:g}" for i in range(len(counts))]
        return {"ok": True, "chart": "bar", "title": f"Distribution of {col}",
                "labels": labels, "series": [{"name": col, "data": counts.astype(int).tolist()}]}

    # ── scatter: two numeric columns ──
    if chart == "scatter":
        if not y:
            return {"ok": False, "error": "Scatter needs both X and Y numeric columns."}
        xs = _coerce_numeric(df[x]); ys = _coerce_numeric(df[y])
        valid = xs.notna() & ys.notna()
        points = [{"x": _safe(a), "y": _safe(b)} for a, b in zip(xs[valid], ys[valid])][:2000]
        return {"ok": True, "chart": "scatter", "title": f"{y} vs {x}",
                "series": [{"name": f"{y} vs {x}", "data": points}]}

    # ── box plot summary per category ──
    if chart == "box":
        if not y:
            return {"ok": False, "error": "Box plot needs a numeric Y column."}
        work = df[[x, y]].copy()
        work[y] = _coerce_numeric(work[y])
        work = work.dropna(subset=[y])
        boxes = []
        for cat, grp in work.groupby(work[x].astype(str)):
            vals = grp[y]
            boxes.append({
                "label": cat,
                "min": _safe(vals.min()), "q1": _safe(vals.quantile(.25)),
                "median": _safe(vals.median()), "q3": _safe(vals.quantile(.75)),
                "max": _safe(vals.max()),
            })
        boxes = boxes[:limit]
        return {"ok": True, "chart": "box", "title": f"{y} by {x}", "boxes": boxes}

    # ── aggregated bar/line/pie/grouped ──
    work = df.copy()
    if y and y in work.columns:
        work[y] = _coerce_numeric(work[y])

    if group_by and group_by in work.columns:
        # grouped/multi-series
        pivot_vals = "size" if (agg == "count" or not y) else agg
        if agg == "count" or not y:
            grouped = work.groupby([work[x].astype(str), work[group_by].astype(str)]).size()
        else:
            grouped = getattr(work.groupby([work[x].astype(str), work[group_by].astype(str)])[y], agg)()
        table = grouped.unstack(fill_value=0)
        labels = [str(v) for v in table.index.tolist()][:limit]
        table = table.loc[table.index[:limit]]
        series = [{"name": str(col), "data": [_safe(v) for v in table[col].tolist()]}
                  for col in table.columns]
        out_chart = "bar" if chart in ("grouped_bar", "bar") else chart
        return {"ok": True, "chart": out_chart, "grouped": True,
                "title": f"{agg} of {y or 'rows'} by {x} / {group_by}",
                "labels": labels, "series": series}

    # single series
    if agg == "count" or not y:
        agg_series = work.groupby(work[x].astype(str)).size()
        measure_name = "count"
    else:
        agg_series = getattr(work.groupby(work[x].astype(str))[y], agg)()
        measure_name = f"{agg} of {y}"

    sort = spec.get("sort")
    if sort == "value":
        agg_series = agg_series.sort_values(ascending=False)
    elif sort == "label":
        agg_series = agg_series.sort_index()
    agg_series = agg_series.head(limit)

    return {
        "ok": True,
        "chart": chart if chart in ("bar", "line", "pie") else "bar",
        "title": f"{measure_name} by {x}",
        "labels": [str(i) for i in agg_series.index.tolist()],
        "series": [{"name": measure_name, "data": [_safe(v) for v in agg_series.tolist()]}],
    }


def _norm_freq(freq):
    """Map friendly codes to pandas offset aliases that work across versions.

    pandas 2.2 renamed period-end aliases (M→ME, Q→QE, Y→YE). Accept the old
    friendly letters from the UI and emit whatever this pandas understands.
    """
    freq = str(freq or "D").upper()
    mapping = {"D": "D", "W": "W", "M": "ME", "Q": "QE", "Y": "YE", "A": "YE",
               "H": "h", "MIN": "min"}
    alias = mapping.get(freq, freq)
    try:
        pd.tseries.frequencies.to_offset(alias)
        return alias
    except (ValueError, AttributeError):
        # Older pandas: fall back to the legacy single letters.
        legacy = {"ME": "M", "QE": "Q", "YE": "Y"}
        return legacy.get(alias, alias)


def _find_datetime_column(df, preferred=None):
    candidates = ([preferred] if preferred else []) + [
        c for c in df.columns
        if any(t in c.lower() for t in ("date", "time", "_at", "received", "created", "day", "month"))
    ]
    for c in candidates:
        if c and c in df.columns:
            parsed = pd.to_datetime(df[c], errors="coerce")
            if parsed.notna().mean() >= 0.5:
                return c, parsed
    return None, None


def time_series(run, spec):
    """Aggregate a measure over time.

    spec = {date: <col>, freq: "D"|"W"|"M"|"Q"|"Y", y: <col>|null,
            agg: "count"|"sum"|"mean", rolling: <int>|null,
            group_by: <col>|null, cumulative: bool}
    """
    df = run_dataframe(run)
    if df.empty:
        return {"ok": False, "error": "No rows in this run."}

    date_col, parsed = _find_datetime_column(df, spec.get("date"))
    if parsed is None:
        return {"ok": False, "error": "No usable date/time column found. Add one with 'Extract date/time parts' or pick a column."}

    work = df.copy()
    work["_ts"] = parsed
    work = work.dropna(subset=["_ts"])
    if work.empty:
        return {"ok": False, "error": "That column has no parseable dates."}

    freq = spec.get("freq", "D")
    y = spec.get("y") or None
    agg = spec.get("agg", "count")
    group_by = spec.get("group_by") or None
    if y and y in work.columns:
        work[y] = _coerce_numeric(work[y])

    grouper = pd.Grouper(key="_ts", freq=_norm_freq(freq))

    def _agg(frame):
        if agg == "count" or not y:
            return frame.size()
        return getattr(frame[y], agg)()

    if group_by and group_by in work.columns:
        g = work.groupby([grouper, work[group_by].astype(str)])
        s = (g.size() if (agg == "count" or not y) else getattr(g[y], agg)())
        table = s.unstack(fill_value=0)
        labels = [d.isoformat() for d in table.index]
        series = []
        for col in table.columns:
            data = table[col]
            if spec.get("cumulative"):
                data = data.cumsum()
            series.append({"name": str(col), "data": [_safe(v) for v in data.tolist()]})
        return {"ok": True, "title": f"{agg} of {y or 'rows'} over time by {group_by}",
                "date_col": date_col, "freq": freq, "labels": labels, "series": series}

    g = work.groupby(grouper)
    s = (g.size() if (agg == "count" or not y) else getattr(g[y], agg)())
    if spec.get("cumulative"):
        s = s.cumsum()
    labels = [d.isoformat() for d in s.index]
    series = [{"name": f"{agg} of {y}" if y else "count", "data": [_safe(v) for v in s.tolist()]}]

    rolling = spec.get("rolling")
    if rolling and int(rolling) > 1:
        roll = s.rolling(int(rolling), min_periods=1).mean()
        series.append({"name": f"{rolling}-pt moving average",
                       "data": [_safe(v) for v in roll.tolist()], "dashed": True})

    return {"ok": True, "title": f"{agg} of {y or 'rows'} over time",
            "date_col": date_col, "freq": freq, "labels": labels, "series": series}


def timeline_frames(run, spec=None):
    """Cumulative snapshots for the historical playback scrubber.

    Returns a list of frames, one per time bucket, each with the running
    totals and a category breakdown, so the player can animate how the
    dataset built up over time.
    """
    spec = spec or {}
    df = run_dataframe(run)
    if df.empty:
        return {"ok": False, "error": "No rows in this run."}

    date_col, parsed = _find_datetime_column(df, spec.get("date"))
    if parsed is None:
        return {"ok": False, "error": "No usable date/time column for playback."}

    work = df.copy()
    work["_ts"] = parsed
    work = work.dropna(subset=["_ts"]).sort_values("_ts")
    if work.empty:
        return {"ok": False, "error": "That column has no parseable dates."}

    freq = spec.get("freq", "D")
    breakdown = spec.get("breakdown") or None
    y = spec.get("y") or None
    agg = spec.get("agg", "count")
    if y and y in work.columns:
        work[y] = _coerce_numeric(work[y])

    buckets = work.groupby(pd.Grouper(key="_ts", freq=_norm_freq(freq)))
    frames = []
    running_total = 0
    running_cats = {}
    gps_cols = (
        next((c for c in ["gps_lat", "_gps_lat", "latitude", "lat"] if c in work.columns), None),
        next((c for c in ["gps_lng", "_gps_lng", "longitude", "lng", "lon"] if c in work.columns), None),
    )
    all_points = []

    for ts, grp in buckets:
        if grp.empty:
            continue
        if agg == "count" or not y:
            value = len(grp)
        else:
            value = _safe(getattr(_coerce_numeric(grp[y]), agg)())
            value = value or 0
        running_total += value if isinstance(value, (int, float)) else len(grp)

        if breakdown and breakdown in grp.columns:
            for cat, sub in grp.groupby(grp[breakdown].astype(str)):
                running_cats[cat] = running_cats.get(cat, 0) + len(sub)

        lat_c, lng_c = gps_cols
        if lat_c and lng_c:
            lats = _coerce_numeric(grp[lat_c]); lngs = _coerce_numeric(grp[lng_c])
            for a, b in zip(lats, lngs):
                if pd.notna(a) and pd.notna(b):
                    all_points.append({"lat": _safe(a), "lng": _safe(b)})

        frames.append({
            "t": ts.isoformat(),
            "bucket_value": value if isinstance(value, (int, float)) else len(grp),
            "cumulative": _safe(running_total),
            "rows_so_far": int(sum(f["bucket_rows"] for f in frames) + len(grp)) if frames else len(grp),
            "bucket_rows": len(grp),
            "breakdown": dict(sorted(running_cats.items(), key=lambda kv: -kv[1])[:12]),
            "points_so_far": len(all_points),
        })

    return {
        "ok": True,
        "date_col": date_col,
        "freq": freq,
        "frames": frames,
        "total_rows": len(work),
        "points": all_points[:5000],
        "has_gps": bool(gps_cols[0] and gps_cols[1]),
    }
