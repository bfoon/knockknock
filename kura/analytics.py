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
