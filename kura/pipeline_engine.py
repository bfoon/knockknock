"""Non-destructive, ordered data-cleaning pipeline executor for Kura."""

from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any

import numpy as np
import pandas as pd
from django.db import transaction
from django.utils import timezone

from .models import (
    CleanedRecord,
    CleaningChange,
    CleaningRun,
    PipelineStep,
    Submission,
)


META_COLUMNS = [
    "_submission_id",
    "_uuid",
    "_status",
    "_source",
    "_received_at",
    "_gps_lat",
    "_gps_lng",
]


def _json_value(value):
    if value is None:
        return None
    if isinstance(value, (np.integer,)):
        return int(value)
    if isinstance(value, (np.floating,)):
        if np.isnan(value):
            return None
        return float(value)
    if isinstance(value, (np.bool_,)):
        return bool(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (list, dict, str, int, float, bool)):
        return value
    return str(value)


def survey_dataframe(survey):
    rows = []
    submissions = list(
        survey.submissions.select_related("form_version")
        .order_by("received_at", "id")
    )
    for sub in submissions:
        row = {
            "_submission_id": sub.id,
            "_uuid": str(sub.client_uuid),
            "_status": sub.status,
            "_source": sub.source,
            "_received_at": sub.received_at.isoformat() if sub.received_at else None,
            "_gps_lat": sub.gps_lat,
            "_gps_lng": sub.gps_lng,
        }
        row.update(sub.answers or {})
        row.update({f"calc__{k}": v for k, v in (sub.calculations or {}).items()})
        if sub.score is not None:
            row["_score"] = sub.score
        rows.append(row)
    return pd.DataFrame(rows), submissions


def dataset_dataframe(dataset):
    """Build the working frame from an UploadedDataset (CSV/Excel upload).

    No submission metadata exists here — cleaned records simply have no
    source_submission, which every consumer already tolerates.
    """
    df = pd.DataFrame(dataset.rows or [])
    ordered = [c for c in (dataset.columns or []) if c in df.columns]
    extras = [c for c in df.columns if c not in ordered]
    if ordered:
        df = df[ordered + extras]
    return df


class PipelineExecutionError(Exception):
    pass


class PipelineExecutor:
    def __init__(self, run: CleaningRun):
        self.run = run
        self.pipeline = run.pipeline
        self.survey = self.pipeline.survey
        self.changes = []
        self.excluded = []
        self.step_stats = []

    def record_change(
        self, step, row, field, old, new, change_type="other", detail=""
    ):
        submission_id = None
        row_number = None
        if row is not None:
            try:
                submission_id = int(row.get("_submission_id")) if row.get("_submission_id") else None
            except (TypeError, ValueError):
                submission_id = None
            try:
                row_number = int(row.name) + 1
            except Exception:
                row_number = None
        self.changes.append(
            CleaningChange(
                run=self.run,
                step=step,
                source_submission_id=submission_id,
                row_number=row_number,
                field=field or "",
                change_type=change_type,
                old_value=_json_value(old),
                new_value=_json_value(new),
                detail=detail,
            )
        )

    @staticmethod
    def _series_missing(series):
        return series.isna() | series.astype(str).str.strip().isin(["", "None", "nan", "NaN"])

    @staticmethod
    def _condition_mask(df, cfg):
        field = cfg.get("field")
        op = cfg.get("operator", "eq")
        value = cfg.get("value")
        if field not in df.columns:
            raise PipelineExecutionError(f"Column '{field}' does not exist.")
        s = df[field]

        if op == "answered":
            return ~(s.isna() | s.astype(str).str.strip().eq(""))
        if op == "not_answered":
            return s.isna() | s.astype(str).str.strip().eq("")
        if op in {"contains", "not_contains", "starts_with", "ends_with", "regex"}:
            ss = s.fillna("").astype(str)
            if op == "contains":
                return ss.str.contains(str(value), case=False, regex=False)
            if op == "not_contains":
                return ~ss.str.contains(str(value), case=False, regex=False)
            if op == "starts_with":
                return ss.str.startswith(str(value))
            if op == "ends_with":
                return ss.str.endswith(str(value))
            try:
                return ss.str.contains(str(value), regex=True, na=False)
            except re.error as exc:
                raise PipelineExecutionError(f"Invalid regular expression: {exc}") from exc
        if op in {"in", "not_in"}:
            values = value if isinstance(value, list) else [value]
            mask = s.astype(str).isin([str(v) for v in values])
            return ~mask if op == "not_in" else mask

        numeric = pd.to_numeric(s, errors="coerce")
        try:
            wanted = float(value)
            if op == "gt":
                return numeric > wanted
            if op == "gte":
                return numeric >= wanted
            if op == "lt":
                return numeric < wanted
            if op == "lte":
                return numeric <= wanted
            if op == "between":
                lo = float(cfg.get("min"))
                hi = float(cfg.get("max"))
                return numeric.between(lo, hi, inclusive="both")
            # eq/ne on a numeric column must compare numerically: as strings
            # "40.0" != "40" would wrongly report a mismatch.
            if numeric.notna().any():
                if op == "eq":
                    return numeric == wanted
                if op == "ne":
                    return numeric != wanted
        except (TypeError, ValueError):
            pass

        if op == "ne":
            return s.astype(str) != str(value)
        return s.astype(str) == str(value)

    @classmethod
    def _combined_mask(cls, df, cfg):
        """One condition, or several joined by AND/OR.

        Accepts the original single-condition shape ({"field","operator",
        "value"}) unchanged, plus an optional {"conditions":[…], "match":
        "all"|"any"} form used by the multi-condition editor.
        """
        conditions = cfg.get("conditions")
        if not conditions:
            return cls._condition_mask(df, cfg)

        masks = [cls._condition_mask(df, c) for c in conditions
                 if c and c.get("field")]
        if not masks:
            raise PipelineExecutionError("Add at least one condition.")

        combined = masks[0]
        if str(cfg.get("match", "all")).lower() == "any":
            for m in masks[1:]:
                combined = combined | m
        else:
            for m in masks[1:]:
                combined = combined & m
        return combined

    def _fill_missing(self, df, step, cfg):
        field = cfg.get("field")
        if field not in df.columns:
            raise PipelineExecutionError(f"Column '{field}' does not exist.")
        method = cfg.get("method", "median")
        group_by = cfg.get("group_by")
        mask = self._series_missing(df[field])
        if not mask.any():
            return df

        original = df[field].copy()

        if method == "constant":
            df.loc[mask, field] = cfg.get("value")
        elif method in {"mean", "median"}:
            numeric = pd.to_numeric(df[field], errors="coerce")
            if group_by and group_by in df.columns:
                transform = (
                    numeric.groupby(df[group_by]).transform("mean" if method == "mean" else "median")
                )
                df.loc[mask, field] = transform.loc[mask]
            else:
                value = numeric.mean() if method == "mean" else numeric.median()
                df.loc[mask, field] = value
        elif method == "mode":
            if group_by and group_by in df.columns:
                def mode_one(s):
                    m = s.dropna().mode()
                    return m.iloc[0] if not m.empty else None
                fills = df.groupby(group_by)[field].transform(mode_one)
                df.loc[mask, field] = fills.loc[mask]
            else:
                mode = df.loc[~mask, field].mode()
                value = mode.iloc[0] if not mode.empty else cfg.get("fallback")
                df.loc[mask, field] = value
        elif method == "forward":
            df[field] = df[field].ffill()
        elif method == "backward":
            df[field] = df[field].bfill()
        else:
            raise PipelineExecutionError(f"Unsupported missing-data method '{method}'.")

        changed = mask & (original.astype(str) != df[field].astype(str))
        for idx in df.index[changed]:
            self.record_change(
                step, df.loc[idx], field, original.loc[idx], df.at[idx, field],
                "impute", f"Missing value filled using {method}.",
            )
        return df

    def _regression_impute(self, df, step, cfg):
        target = cfg.get("target") or cfg.get("field")
        predictors = cfg.get("predictors") or []
        if target not in df.columns:
            raise PipelineExecutionError(f"Target column '{target}' does not exist.")
        predictors = [p for p in predictors if p in df.columns and p != target]
        if not predictors:
            raise PipelineExecutionError("Regression imputation needs at least one predictor.")

        try:
            from sklearn.compose import ColumnTransformer
            from sklearn.impute import SimpleImputer
            from sklearn.linear_model import LinearRegression, LogisticRegression
            from sklearn.pipeline import Pipeline
            from sklearn.preprocessing import OneHotEncoder
        except ImportError as exc:
            raise PipelineExecutionError(
                "Regression imputation requires scikit-learn."
            ) from exc

        missing = self._series_missing(df[target])
        train = df.loc[~missing, predictors + [target]].copy()
        predict = df.loc[missing, predictors].copy()
        if train.empty or predict.empty:
            return df

        numeric_cols = [c for c in predictors if pd.api.types.is_numeric_dtype(train[c])]
        categorical_cols = [c for c in predictors if c not in numeric_cols]

        prep = ColumnTransformer([
            ("num", SimpleImputer(strategy="median"), numeric_cols),
            ("cat", Pipeline([
                ("imputer", SimpleImputer(strategy="most_frequent")),
                ("onehot", OneHotEncoder(handle_unknown="ignore")),
            ]), categorical_cols),
        ])

        numeric_target = pd.to_numeric(train[target], errors="coerce")
        is_numeric_target = numeric_target.notna().sum() >= max(3, len(train) * 0.8)
        if is_numeric_target:
            valid = numeric_target.notna()
            model = Pipeline([("prep", prep), ("model", LinearRegression())])
            model.fit(train.loc[valid, predictors], numeric_target.loc[valid])
        else:
            valid = ~self._series_missing(train[target])
            if train.loc[valid, target].nunique() < 2:
                raise PipelineExecutionError("Regression target has fewer than two classes.")
            model = Pipeline([
                ("prep", prep),
                ("model", LogisticRegression(max_iter=1000)),
            ])
            model.fit(train.loc[valid, predictors], train.loc[valid, target].astype(str))

        predicted = model.predict(predict)
        for idx, new_value in zip(predict.index, predicted):
            old = df.at[idx, target]
            df.at[idx, target] = _json_value(new_value)
            self.record_change(
                step, df.loc[idx], target, old, df.at[idx, target],
                "impute", "Regression imputation.",
            )
        return df

    def _apply_step(self, df, step):
        cfg = step.config or {}
        op = step.operation

        if op == "fill_missing":
            return self._fill_missing(df, step, cfg)
        if op == "regression_impute":
            return self._regression_impute(df, step, cfg)

        if op == "filter_rows":
            mask = self._combined_mask(df, cfg)
            keep = bool(cfg.get("keep_matching", True))
            dropped = df.loc[~mask if keep else mask]
            for idx, row in dropped.iterrows():
                self.record_change(step, row, "", None, None, "drop_row", "Filtered from result.")
            return df.loc[mask if keep else ~mask].copy()

        if op == "drop_rows":
            # Five ways to choose which rows go. Default stays "ids" so any
            # pipeline saved before this block gained options behaves the same.
            mode = cfg.get("mode") or "ids"
            n = len(df)
            if n == 0:
                return df

            if mode == "range":
                # 1-based, inclusive, as shown in the results table.
                try:
                    start = int(cfg.get("from") or 1)
                    end = int(cfg.get("to") or n)
                except (TypeError, ValueError):
                    raise PipelineExecutionError(
                        "Row range needs whole numbers.")
                if start > end:
                    start, end = end, start
                start = max(1, start)
                end = min(n, end)
                positions = pd.Series(range(1, n + 1), index=df.index)
                mask = (positions >= start) & (positions <= end)
                reason = f"Row {start}–{end} of {n}."

            elif mode == "condition":
                mask = self._condition_mask(df, cfg)
                reason = "Matched the drop condition."

            elif mode == "position":
                where = cfg.get("where", "first")
                count = max(0, int(cfg.get("count") or 0))
                positions = pd.Series(range(1, n + 1), index=df.index)
                if where == "last":
                    mask = positions > (n - count)
                    reason = f"Last {count} row(s)."
                elif where == "every_nth":
                    step_n = max(2, int(cfg.get("nth") or 2))
                    mask = (positions % step_n) == 0
                    reason = f"Every {step_n}th row."
                else:
                    mask = positions <= count
                    reason = f"First {count} row(s)."

            elif mode == "blank":
                fields = [c for c in (cfg.get("fields") or []) if c in df.columns]
                if not fields:
                    raise PipelineExecutionError(
                        "Choose at least one column to check for blanks.")
                blanks = pd.DataFrame(
                    {c: self._series_missing(df[c]) for c in fields})
                require_all = cfg.get("match", "any") == "all"
                mask = blanks.all(axis=1) if require_all else blanks.any(axis=1)
                reason = ("Blank in every chosen column."
                          if require_all else "Blank in a chosen column.")

            elif mode == "duplicates":
                fields = [c for c in (cfg.get("fields") or []) if c in df.columns]
                subset = fields or [c for c in df.columns
                                    if c not in META_COLUMNS]
                keep = cfg.get("keep", "first")
                mask = df[subset].astype(str).duplicated(
                    keep=False if keep == "none" else keep)
                reason = "Duplicate row."

            else:  # "ids" — the original behaviour
                ids = {str(v) for v in (cfg.get("submission_ids") or [])}
                if "_submission_id" in df.columns:
                    mask = df["_submission_id"].astype(str).isin(ids)
                else:
                    mask = pd.Series(False, index=df.index)
                reason = "Explicitly removed."

            if bool(cfg.get("invert")):
                mask = ~mask
                reason = "Kept only the chosen rows; this one fell outside."

            for idx, row in df.loc[mask].iterrows():
                self.record_change(step, row, "", None, None, "drop_row", reason)
            return df.loc[~mask].copy()

        if op == "drop_columns":
            columns = [c for c in cfg.get("columns", []) if c in df.columns and c not in META_COLUMNS]
            for col in columns:
                self.record_change(step, None, col, "column", None, "drop_column", "Column removed.")
            return df.drop(columns=columns)

        if op == "keep_columns":
            wanted = [c for c in cfg.get("columns", []) if c in df.columns]
            return df[[c for c in META_COLUMNS if c in df.columns] + wanted].copy()

        if op == "rename_column":
            old = cfg.get("field")
            new = str(cfg.get("new_name") or "").strip()
            if old not in df.columns or not new:
                raise PipelineExecutionError("Rename requires an existing field and a new name.")
            self.record_change(step, None, old, old, new, "rename", "Column renamed.")
            return df.rename(columns={old: new})

        if op in {"recode", "replace"}:
            field = cfg.get("field")
            if field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            mapping = cfg.get("map") or {}
            old_series = df[field].copy()
            if cfg.get("trim"):
                df[field] = df[field].apply(lambda v: v.strip() if isinstance(v, str) else v)
            if cfg.get("lower"):
                df[field] = df[field].apply(lambda v: v.lower() if isinstance(v, str) else v)
            if cfg.get("titlecase"):
                df[field] = df[field].apply(lambda v: v.title() if isinstance(v, str) else v)
            df[field] = df[field].apply(lambda v: mapping.get(str(v), mapping.get(v, v)))
            changed = old_series.astype(str) != df[field].astype(str)
            for idx in df.index[changed]:
                self.record_change(
                    step, df.loc[idx], field, old_series.loc[idx], df.at[idx, field],
                    "recode" if op == "recode" else "replace",
                    "Value mapped by pipeline.",
                )
            return df

        if op == "deduplicate":
            fields = [c for c in cfg.get("fields", []) if c in df.columns]
            subset = fields or [c for c in df.columns if c not in META_COLUMNS]
            # Stringify first: repeat-group cells hold lists, which the plain
            # duplicated() cannot hash.
            keep = cfg.get("keep", "first")
            duplicate_mask = df[subset].astype(str).duplicated(
                keep=False if keep == "none" else keep)
            for idx, row in df.loc[duplicate_mask].iterrows():
                self.record_change(step, row, ",".join(fields), None, None, "drop_row", "Duplicate removed.")
            return df.loc[~duplicate_mask].copy()

        if op == "cast_type":
            field = cfg.get("field")
            target = cfg.get("type", "text")
            if field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            old = df[field].copy()
            if target == "integer":
                df[field] = pd.to_numeric(df[field], errors="coerce").round().astype("Int64")
            elif target == "decimal":
                df[field] = pd.to_numeric(df[field], errors="coerce")
            elif target == "date":
                df[field] = pd.to_datetime(df[field], errors="coerce")
            elif target == "boolean":
                truthy = {"1", "true", "yes", "y", "on"}
                df[field] = df[field].apply(lambda v: str(v).lower() in truthy if pd.notna(v) else None)
            else:
                df[field] = df[field].apply(lambda v: None if pd.isna(v) else str(v))
            changed = old.astype(str) != df[field].astype(str)
            for idx in df.index[changed]:
                self.record_change(step, df.loc[idx], field, old.loc[idx], df.at[idx, field], "cast", f"Converted to {target}.")
            return df

        if op == "trim_text":
            field = cfg.get("field")
            if field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            old = df[field].copy()
            df[field] = df[field].apply(lambda v: re.sub(r"\s+", " ", v.strip()) if isinstance(v, str) else v)
            changed = old.astype(str) != df[field].astype(str)
            for idx in df.index[changed]:
                self.record_change(step, df.loc[idx], field, old.loc[idx], df.at[idx, field], "replace", "Whitespace normalized.")
            return df

        if op == "case_text":
            field = cfg.get("field")
            mode = cfg.get("mode", "title")
            if field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            funcs = {"lower": str.lower, "upper": str.upper, "title": str.title}
            func = funcs.get(mode, str.title)
            old = df[field].copy()
            df[field] = df[field].apply(lambda v: func(v) if isinstance(v, str) else v)
            changed = old.astype(str) != df[field].astype(str)
            for idx in df.index[changed]:
                self.record_change(step, df.loc[idx], field, old.loc[idx], df.at[idx, field], "replace", f"Text changed to {mode} case.")
            return df

        if op == "calculate":
            name = str(cfg.get("new_field") or "").strip()
            expression = str(cfg.get("expression") or "").strip()
            if not name or not expression:
                raise PipelineExecutionError("Calculated column requires a name and expression.")
            safe_names = {c: pd.to_numeric(df[c], errors="coerce") for c in df.columns}
            try:
                result = pd.eval(expression, local_dict=safe_names, engine="python")
            except Exception as exc:
                raise PipelineExecutionError(f"Invalid calculation: {exc}") from exc
            df[name] = result
            for idx in df.index:
                self.record_change(step, df.loc[idx], name, None, df.at[idx, name], "calculate", expression)
            return df

        if op in {"outlier", "winsorize"}:
            field = cfg.get("field")
            if field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            values = pd.to_numeric(df[field], errors="coerce")
            method = cfg.get("method", "iqr")
            if method == "zscore":
                sd = values.std(ddof=0)
                z = (values - values.mean()) / (sd if sd else 1)
                mask = z.abs() > float(cfg.get("k", 3))
                lo, hi = values[~mask].min(), values[~mask].max()
            else:
                q1, q3 = values.quantile(.25), values.quantile(.75)
                iqr = q3 - q1
                k = float(cfg.get("k", 1.5))
                lo, hi = q1 - k * iqr, q3 + k * iqr
                mask = (values < lo) | (values > hi)
            action = cfg.get("action", "flag")
            if op == "winsorize" or action == "cap":
                old = df[field].copy()
                df[field] = values.clip(lo, hi)
                for idx in df.index[mask]:
                    self.record_change(step, df.loc[idx], field, old.loc[idx], df.at[idx, field], "outlier", f"Capped to [{lo:g}, {hi:g}].")
            elif action in {"median", "mean"}:
                replacement = values.median() if action == "median" else values.mean()
                old = df[field].copy()
                df.loc[mask, field] = replacement
                for idx in df.index[mask]:
                    self.record_change(step, df.loc[idx], field, old.loc[idx], replacement, "outlier", f"Replaced with {action}.")
            elif action == "drop":
                for idx, row in df.loc[mask].iterrows():
                    self.record_change(step, row, field, row[field], None, "drop_row", "Outlier row removed.")
                df = df.loc[~mask].copy()
            return df

        if op == "sort_rows":
            fields = [c for c in (cfg.get("fields") or []) if c in df.columns]
            if not fields:
                raise PipelineExecutionError("Choose at least one column to sort by.")
            ascending = bool(cfg.get("ascending", True))
            if cfg.get("numeric", True):
                keys = {}
                for c in fields:
                    num = pd.to_numeric(df[c], errors="coerce")
                    keys[c] = num if num.notna().any() else df[c].astype(str)
                order = pd.DataFrame(keys).sort_values(
                    by=fields, ascending=ascending, kind="mergesort").index
            else:
                order = df.sort_values(by=fields, ascending=ascending,
                                       kind="mergesort").index
            return df.loc[order].copy()

        if op == "split_column":
            field = cfg.get("field")
            if field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            sep = cfg.get("separator") or " "
            limit = int(cfg.get("max_parts") or 0)
            prefix = str(cfg.get("prefix") or field)
            text = df[field].fillna("").astype(str)
            parts = text.str.split(re.escape(sep), n=(limit - 1) if limit else -1,
                                   regex=True, expand=True)
            if limit:
                parts = parts.iloc[:, :limit]
            for i in range(parts.shape[1]):
                name = f"{prefix}_{i + 1}"
                col = parts[i]
                if cfg.get("trim", True):
                    col = col.apply(lambda v: v.strip() if isinstance(v, str) else v)
                df[name] = col
                for idx in df.index:
                    self.record_change(step, df.loc[idx], name, None,
                                       df.at[idx, name], "calculate",
                                       f"Split from {field}.")
            return df

        if op == "replace_text":
            field = cfg.get("field")
            if field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            find = str(cfg.get("find") or "")
            if not find:
                raise PipelineExecutionError("Type the text to find.")
            repl = str(cfg.get("replace") or "")
            use_regex = bool(cfg.get("regex"))
            old = df[field].copy()
            try:
                df[field] = df[field].apply(
                    lambda v: (re.sub(find, repl, v, flags=0 if cfg.get("case_sensitive")
                                      else re.IGNORECASE) if use_regex
                               else (v.replace(find, repl) if cfg.get("case_sensitive")
                                     else re.sub(re.escape(find), repl, v,
                                                 flags=re.IGNORECASE)))
                    if isinstance(v, str) else v)
            except re.error as exc:
                raise PipelineExecutionError(f"Invalid pattern: {exc}") from exc
            changed = old.astype(str) != df[field].astype(str)
            for idx in df.index[changed]:
                self.record_change(step, df.loc[idx], field, old.loc[idx],
                                   df.at[idx, field], "replace",
                                   f"Replaced '{find}'.")
            return df

        if op == "bin_column":
            field = cfg.get("field")
            if field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            values = pd.to_numeric(df[field], errors="coerce")
            new_name = str(cfg.get("new_field") or f"{field}_band").strip()
            method = cfg.get("method", "equal")
            try:
                if method == "custom":
                    edges = [float(x) for x in (cfg.get("edges") or [])]
                    if len(edges) < 2:
                        raise PipelineExecutionError(
                            "Custom bands need at least two edge numbers.")
                    labels = cfg.get("labels") or None
                    if labels and len(labels) != len(edges) - 1:
                        labels = None
                    df[new_name] = pd.cut(values, bins=edges, labels=labels,
                                          include_lowest=True).astype(str)
                elif method == "quantile":
                    q = max(2, int(cfg.get("bins") or 4))
                    df[new_name] = pd.qcut(values, q=q, duplicates="drop").astype(str)
                else:
                    q = max(2, int(cfg.get("bins") or 4))
                    df[new_name] = pd.cut(values, bins=q).astype(str)
            except ValueError as exc:
                raise PipelineExecutionError(f"Could not build bands: {exc}") from exc
            df[new_name] = df[new_name].replace({"nan": None, "NaN": None})
            for idx in df.index:
                self.record_change(step, df.loc[idx], new_name, None,
                                   df.at[idx, new_name], "calculate",
                                   f"Banded from {field}.")
            return df

        if op == "clip_range":
            field = cfg.get("field")
            if field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            values = pd.to_numeric(df[field], errors="coerce")
            lo = cfg.get("min")
            hi = cfg.get("max")
            lo = float(lo) if lo not in (None, "") else None
            hi = float(hi) if hi not in (None, "") else None
            if lo is None and hi is None:
                raise PipelineExecutionError("Set a minimum, a maximum, or both.")
            action = cfg.get("action", "cap")
            outside = pd.Series(False, index=df.index)
            if lo is not None:
                outside |= values < lo
            if hi is not None:
                outside |= values > hi
            old = df[field].copy()
            if action == "blank":
                df.loc[outside, field] = None
                verb = "Cleared (outside range)."
            elif action == "drop":
                for idx, row in df.loc[outside].iterrows():
                    self.record_change(step, row, field, row[field], None,
                                       "drop_row", "Outside allowed range.")
                return df.loc[~outside].copy()
            else:
                df[field] = values.clip(lower=lo, upper=hi)
                verb = "Capped to the allowed range."
            for idx in df.index[outside]:
                self.record_change(step, df.loc[idx], field, old.loc[idx],
                                   df.at[idx, field], "other", verb)
            return df

        if op == "round_numbers":
            fields = [c for c in (cfg.get("fields") or []) if c in df.columns]
            if not fields:
                raise PipelineExecutionError("Choose at least one column.")
            places = int(cfg.get("places") or 0)
            for c in fields:
                old = df[c].copy()
                values = pd.to_numeric(df[c], errors="coerce")
                rounded = values.round(places)
                df[c] = rounded.astype("Int64") if places <= 0 else rounded
                changed = old.astype(str) != df[c].astype(str)
                for idx in df.index[changed]:
                    self.record_change(step, df.loc[idx], c, old.loc[idx],
                                       df.at[idx, c], "other",
                                       f"Rounded to {places} dp.")
            return df

        if op == "group_aggregate":
            groups = [c for c in (cfg.get("group_by") or []) if c in df.columns]
            field = cfg.get("field")
            agg = cfg.get("agg", "mean")
            if not groups:
                raise PipelineExecutionError("Choose at least one grouping column.")
            if agg != "count" and field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            new_name = str(cfg.get("new_field")
                           or f"{field or 'row'}_{agg}_by_{'_'.join(groups)}").strip()
            if agg == "count":
                result = df.groupby(groups, dropna=False)[groups[0]].transform("size")
            else:
                values = pd.to_numeric(df[field], errors="coerce")
                if agg in {"first", "last", "nunique"}:
                    result = df.groupby(groups, dropna=False)[field].transform(agg)
                else:
                    result = values.groupby(
                        [df[c] for c in groups], dropna=False).transform(agg)
            df[new_name] = result
            for idx in df.index:
                self.record_change(step, df.loc[idx], new_name, None,
                                   df.at[idx, new_name], "calculate",
                                   f"{agg} within {', '.join(groups)}.")
            return df

        if op == "rank_rows":
            field = cfg.get("field")
            if field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            new_name = str(cfg.get("new_field") or f"{field}_rank").strip()
            values = pd.to_numeric(df[field], errors="coerce")
            ascending = bool(cfg.get("ascending", True))
            groups = [c for c in (cfg.get("group_by") or []) if c in df.columns]
            method = cfg.get("method", "min")
            if groups:
                df[new_name] = values.groupby(
                    [df[c] for c in groups], dropna=False).rank(
                        ascending=ascending, method=method).astype("Int64")
            else:
                df[new_name] = values.rank(
                    ascending=ascending, method=method).astype("Int64")
            for idx in df.index:
                self.record_change(step, df.loc[idx], new_name, None,
                                   df.at[idx, new_name], "calculate",
                                   f"Rank of {field}.")
            return df

        if op == "running_total":
            field = cfg.get("field")
            if field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            new_name = str(cfg.get("new_field") or f"{field}_running").strip()
            values = pd.to_numeric(df[field], errors="coerce").fillna(0)
            groups = [c for c in (cfg.get("group_by") or []) if c in df.columns]
            mode = cfg.get("mode", "sum")
            if groups:
                grouped = values.groupby([df[c] for c in groups], dropna=False)
                df[new_name] = (grouped.cumsum() if mode == "sum"
                                else grouped.cummax() if mode == "max"
                                else grouped.cummin())
            else:
                df[new_name] = (values.cumsum() if mode == "sum"
                                else values.cummax() if mode == "max"
                                else values.cummin())
            for idx in df.index:
                self.record_change(step, df.loc[idx], new_name, None,
                                   df.at[idx, new_name], "calculate",
                                   f"Running {mode} of {field}.")
            return df

        if op == "flag_rows":
            # Mark rows instead of removing them — keeps the row, adds a column.
            new_name = str(cfg.get("new_field") or "flag").strip()
            mask = self._combined_mask(df, cfg)
            true_label = cfg.get("true_label", "yes")
            false_label = cfg.get("false_label", "")
            df[new_name] = [true_label if m else false_label for m in mask]
            for idx in df.index[mask]:
                self.record_change(step, df.loc[idx], new_name, None,
                                   df.at[idx, new_name], "other",
                                   cfg.get("reason") or "Matched flag condition.")
            return df

        if op == "strip_accents":
            import unicodedata
            fields = [c for c in (cfg.get("fields") or []) if c in df.columns]
            if not fields:
                raise PipelineExecutionError("Choose at least one column.")

            def _plain(v):
                if not isinstance(v, str):
                    return v
                norm = unicodedata.normalize("NFKD", v)
                return "".join(ch for ch in norm if not unicodedata.combining(ch))

            for c in fields:
                old = df[c].copy()
                df[c] = df[c].apply(_plain)
                changed = old.astype(str) != df[c].astype(str)
                for idx in df.index[changed]:
                    self.record_change(step, df.loc[idx], c, old.loc[idx],
                                       df.at[idx, c], "replace",
                                       "Accents removed.")
            return df

        # ── machine-learning blocks ──────────────────────────────────
        # Each one degrades to a clear message if scikit-learn is absent,
        # matching how regression_impute already behaves.

        if op == "cluster":
            fields = [c for c in (cfg.get("fields") or []) if c in df.columns]
            if len(fields) < 1:
                raise PipelineExecutionError("Choose at least one column to cluster on.")
            try:
                from sklearn.cluster import KMeans
                from sklearn.impute import SimpleImputer
                from sklearn.preprocessing import StandardScaler
            except ImportError as exc:
                raise PipelineExecutionError(
                    "Clustering requires scikit-learn.") from exc

            new_name = str(cfg.get("new_field") or "cluster").strip()
            k = max(2, int(cfg.get("clusters") or 3))
            matrix = pd.DataFrame(
                {c: pd.to_numeric(df[c], errors="coerce") for c in fields})
            usable = matrix.notna().any(axis=1)
            if usable.sum() < k:
                raise PipelineExecutionError(
                    f"Need at least {k} rows with numbers in those columns.")
            filled = SimpleImputer(strategy="median").fit_transform(matrix[usable])
            scaled = StandardScaler().fit_transform(filled)
            model = KMeans(n_clusters=k, n_init=10,
                           random_state=int(cfg.get("seed", 42)))
            labels = model.fit_predict(scaled)
            prefix = cfg.get("label_prefix", "Group ")
            df[new_name] = None
            df.loc[usable, new_name] = [f"{prefix}{int(v) + 1}" for v in labels]
            for idx in df.index[usable]:
                self.record_change(step, df.loc[idx], new_name, None,
                                   df.at[idx, new_name], "calculate",
                                   f"K-means on {', '.join(fields)}.")
            return df

        if op == "detect_anomalies":
            fields = [c for c in (cfg.get("fields") or []) if c in df.columns]
            if not fields:
                raise PipelineExecutionError("Choose at least one column.")
            try:
                from sklearn.ensemble import IsolationForest
                from sklearn.impute import SimpleImputer
                from sklearn.preprocessing import StandardScaler
            except ImportError as exc:
                raise PipelineExecutionError(
                    "Anomaly detection requires scikit-learn.") from exc

            new_name = str(cfg.get("new_field") or "anomaly").strip()
            matrix = pd.DataFrame(
                {c: pd.to_numeric(df[c], errors="coerce") for c in fields})
            usable = matrix.notna().any(axis=1)
            if usable.sum() < 8:
                raise PipelineExecutionError(
                    "Need at least 8 rows with numbers to find anomalies.")
            filled = SimpleImputer(strategy="median").fit_transform(matrix[usable])
            scaled = StandardScaler().fit_transform(filled)
            rate = float(cfg.get("rate", 0.05))
            rate = min(0.5, max(0.001, rate))
            model = IsolationForest(contamination=rate,
                                    random_state=int(cfg.get("seed", 42)))
            pred = model.fit_predict(scaled)          # -1 = outlier
            scores = model.score_samples(scaled)
            flags = pd.Series(False, index=df.index)
            flags.loc[df.index[usable]] = pred == -1

            if cfg.get("action") == "drop":
                for idx, row in df.loc[flags].iterrows():
                    self.record_change(step, row, "", None, None, "drop_row",
                                       "Flagged as unusual by the model.")
                return df.loc[~flags].copy()

            df[new_name] = ["yes" if f else "" for f in flags]
            if cfg.get("include_score", True):
                score_col = f"{new_name}_score"
                df[score_col] = None
                df.loc[usable, score_col] = [round(float(v), 4) for v in scores]
            for idx in df.index[flags]:
                self.record_change(step, df.loc[idx], new_name, None,
                                   df.at[idx, new_name], "other",
                                   "Unusual combination of values.")
            return df

        if op == "predict_column":
            target = cfg.get("target") or cfg.get("field")
            predictors = [c for c in (cfg.get("predictors") or [])
                          if c in df.columns and c != target]
            if target not in df.columns:
                raise PipelineExecutionError(
                    f"Target column '{target}' does not exist.")
            if not predictors:
                raise PipelineExecutionError("Choose at least one input column.")
            try:
                from sklearn.compose import ColumnTransformer
                from sklearn.ensemble import (RandomForestClassifier,
                                              RandomForestRegressor)
                from sklearn.impute import SimpleImputer
                from sklearn.pipeline import Pipeline as SkPipeline
                from sklearn.preprocessing import OneHotEncoder
            except ImportError as exc:
                raise PipelineExecutionError(
                    "Prediction requires scikit-learn.") from exc

            new_name = str(cfg.get("new_field") or f"{target}_predicted").strip()
            known = ~self._series_missing(df[target])
            if known.sum() < 10:
                raise PipelineExecutionError(
                    "Need at least 10 rows with a known answer to learn from.")

            train_x = df.loc[known, predictors]
            numeric_cols = [c for c in predictors
                            if pd.api.types.is_numeric_dtype(train_x[c])]
            categorical_cols = [c for c in predictors if c not in numeric_cols]
            prep = ColumnTransformer([
                ("num", SimpleImputer(strategy="median"), numeric_cols),
                ("cat", SkPipeline([
                    ("imputer", SimpleImputer(strategy="most_frequent")),
                    ("onehot", OneHotEncoder(handle_unknown="ignore")),
                ]), categorical_cols),
            ])

            numeric_target = pd.to_numeric(df.loc[known, target], errors="coerce")
            treat_numeric = (cfg.get("task") == "number") or (
                cfg.get("task") in (None, "", "auto")
                and numeric_target.notna().sum() >= known.sum() * 0.8)
            seed = int(cfg.get("seed", 42))
            trees = max(10, int(cfg.get("trees") or 100))

            if treat_numeric:
                model = SkPipeline([("prep", prep),
                                    ("model", RandomForestRegressor(
                                        n_estimators=trees, random_state=seed))])
                valid = numeric_target.notna()
                model.fit(train_x.loc[valid], numeric_target.loc[valid])
            else:
                labels = df.loc[known, target].astype(str)
                if labels.nunique() < 2:
                    raise PipelineExecutionError(
                        "The target column needs at least two different answers.")
                model = SkPipeline([("prep", prep),
                                    ("model", RandomForestClassifier(
                                        n_estimators=trees, random_state=seed))])
                model.fit(train_x, labels)

            scope = cfg.get("scope", "missing")   # missing | all
            rows = df.index if scope == "all" else df.index[~known]
            if len(rows):
                predicted = model.predict(df.loc[rows, predictors])
                df[new_name] = df.get(new_name)
                for idx, value in zip(rows, predicted):
                    df.at[idx, new_name] = _json_value(value)
                    self.record_change(step, df.loc[idx], new_name, None,
                                       df.at[idx, new_name], "calculate",
                                       f"Predicted from {', '.join(predictors)}.")
            if bool(cfg.get("fill_target")):
                for idx in df.index[~known]:
                    value = df.at[idx, new_name]
                    if value is not None:
                        old = df.at[idx, target]
                        df.at[idx, target] = value
                        self.record_change(step, df.loc[idx], target, old, value,
                                           "impute", "Filled with the prediction.")
            return df

        if op == "similar_duplicates":
            fields = [c for c in (cfg.get("fields") or []) if c in df.columns]
            if not fields:
                raise PipelineExecutionError("Choose at least one text column.")
            try:
                from sklearn.feature_extraction.text import TfidfVectorizer
                from sklearn.metrics.pairwise import cosine_similarity
            except ImportError as exc:
                raise PipelineExecutionError(
                    "Fuzzy duplicate detection requires scikit-learn.") from exc

            threshold = float(cfg.get("threshold", 0.85))
            threshold = min(0.99, max(0.5, threshold))
            text = df[fields].fillna("").astype(str).agg(" ".join, axis=1)
            text = text.str.lower().str.replace(r"\s+", " ", regex=True).str.strip()
            usable = text.str.len() > 0
            if usable.sum() < 2:
                return df

            vect = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 3),
                                   min_df=1)
            matrix = vect.fit_transform(text[usable])
            sim = cosine_similarity(matrix)
            np.fill_diagonal(sim, 0.0)

            idx_list = list(df.index[usable])
            group_of, groups = {}, []
            for i in range(len(idx_list)):
                for j in range(i + 1, len(idx_list)):
                    if sim[i, j] >= threshold:
                        gi, gj = group_of.get(i), group_of.get(j)
                        if gi is None and gj is None:
                            groups.append({i, j})
                            group_of[i] = group_of[j] = len(groups) - 1
                        elif gi is None:
                            groups[gj].add(i); group_of[i] = gj
                        elif gj is None:
                            groups[gi].add(j); group_of[j] = gi
                        elif gi != gj:
                            groups[gi] |= groups[gj]
                            for m in groups[gj]:
                                group_of[m] = gi
                            groups[gj] = set()

            new_name = str(cfg.get("new_field") or "similar_group").strip()
            action = cfg.get("action", "flag")
            df[new_name] = None
            drop_idx = []
            label = 0
            for members in groups:
                if len(members) < 2:
                    continue
                label += 1
                ordered = sorted(members)
                for pos, m in enumerate(ordered):
                    row_idx = idx_list[m]
                    df.at[row_idx, new_name] = f"Group {label}"
                    if action == "drop" and pos > 0:
                        drop_idx.append(row_idx)
                    else:
                        self.record_change(
                            step, df.loc[row_idx], new_name, None,
                            df.at[row_idx, new_name], "other",
                            f"Looks like {len(members) - 1} other row(s).")
            if action == "drop" and drop_idx:
                for idx in drop_idx:
                    self.record_change(step, df.loc[idx], "", None, None,
                                       "drop_row", "Near-duplicate of an earlier row.")
                return df.drop(index=drop_idx).copy()
            return df

        if op == "reduce_dimensions":
            fields = [c for c in (cfg.get("fields") or []) if c in df.columns]
            if len(fields) < 2:
                raise PipelineExecutionError("Choose at least two columns.")
            try:
                from sklearn.decomposition import PCA
                from sklearn.impute import SimpleImputer
                from sklearn.preprocessing import StandardScaler
            except ImportError as exc:
                raise PipelineExecutionError(
                    "Dimension reduction requires scikit-learn.") from exc

            n_parts = max(1, min(int(cfg.get("components") or 2), len(fields)))
            prefix = str(cfg.get("prefix") or "component")
            matrix = pd.DataFrame(
                {c: pd.to_numeric(df[c], errors="coerce") for c in fields})
            usable = matrix.notna().any(axis=1)
            if usable.sum() <= n_parts:
                raise PipelineExecutionError("Not enough rows with numbers.")
            filled = SimpleImputer(strategy="median").fit_transform(matrix[usable])
            scaled = StandardScaler().fit_transform(filled)
            coords = PCA(n_components=n_parts,
                         random_state=int(cfg.get("seed", 42))).fit_transform(scaled)
            for i in range(n_parts):
                name = f"{prefix}_{i + 1}"
                df[name] = None
                df.loc[usable, name] = [round(float(v), 4) for v in coords[:, i]]
            return df

        if op == "scale":
            field = cfg.get("field")
            if field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            values = pd.to_numeric(df[field], errors="coerce")
            mode = cfg.get("method", "standard")
            old = df[field].copy()
            if mode == "minmax":
                span = values.max() - values.min()
                df[field] = (values - values.min()) / (span if span else 1)
            elif mode == "log":
                df[field] = np.log1p(values.clip(lower=0))
            else:
                sd = values.std(ddof=0)
                df[field] = (values - values.mean()) / (sd if sd else 1)
            for idx in df.index[values.notna()]:
                self.record_change(step, df.loc[idx], field, old.loc[idx], df.at[idx, field], "other", f"{mode} scaling.")
            return df

        if op == "encode":
            field = cfg.get("field")
            if field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            mode = cfg.get("method", "onehot")
            if mode == "label":
                categories = {v: i for i, v in enumerate(sorted(df[field].dropna().astype(str).unique()))}
                new_name = cfg.get("new_field") or f"{field}_code"
                df[new_name] = df[field].astype(str).map(categories)
                return df
            dummies = pd.get_dummies(df[field], prefix=field, dummy_na=bool(cfg.get("include_missing")))
            return pd.concat([df, dummies.astype(int)], axis=1)

        if op in {"make_id", "concat_columns"}:
            # Build a new column by combining other columns / cells.
            #   make_id       → a stable ID (uuid5 or short hash) per row
            #   concat_columns→ a plain joined string
            import hashlib
            import uuid as _uuid

            new_name = str(cfg.get("new_field") or ("row_id" if op == "make_id" else "combined")).strip()
            fields = [c for c in (cfg.get("fields") or []) if c in df.columns]
            if not fields:
                raise PipelineExecutionError("Choose at least one column to combine.")
            sep = str(cfg.get("separator", "-"))
            include_missing = bool(cfg.get("include_missing", False))

            def _combine(row):
                parts = []
                for c in fields:
                    v = row[c]
                    if v is None or (isinstance(v, float) and pd.isna(v)) or str(v).strip() == "":
                        if not include_missing:
                            continue
                        v = ""
                    parts.append(str(v).strip())
                return sep.join(parts)

            combined = df.apply(_combine, axis=1)

            if op == "concat_columns":
                df[new_name] = combined
            else:
                mode = cfg.get("id_mode", "uuid5")   # uuid5 | hash | sequence
                if mode == "sequence":
                    prefix = str(cfg.get("prefix", ""))
                    pad = int(cfg.get("pad", 4))
                    df[new_name] = [f"{prefix}{str(i + 1).zfill(pad)}" for i in range(len(df))]
                elif mode == "hash":
                    length = int(cfg.get("length", 12))
                    df[new_name] = combined.apply(
                        lambda s: hashlib.sha256(s.encode("utf-8")).hexdigest()[:length]
                    )
                else:  # uuid5 — deterministic: same inputs → same UUID
                    namespace = _uuid.NAMESPACE_URL
                    df[new_name] = combined.apply(
                        lambda s: str(_uuid.uuid5(namespace, s))
                    )
                # Optional: warn (in the change log) about duplicate IDs.
                if bool(cfg.get("check_unique", True)):
                    dup = df[new_name].duplicated(keep=False)
                    for idx in df.index[dup]:
                        self.record_change(step, df.loc[idx], new_name, None, df.at[idx, new_name],
                                           "other", "Duplicate ID from these columns.")

            for idx in df.index:
                self.record_change(step, df.loc[idx], new_name, None, df.at[idx, new_name],
                                   "calculate", f"Combined from: {', '.join(fields)}")
            return df

        if op == "extract_datetime":
            # Turn a date/time column into parts for time-series analysis.
            field = cfg.get("field")
            if field not in df.columns:
                raise PipelineExecutionError(f"Column '{field}' does not exist.")
            parsed = pd.to_datetime(df[field], errors="coerce",
                                    dayfirst=bool(cfg.get("dayfirst", False)))
            parts = cfg.get("parts") or ["year", "month", "day"]
            prefix = str(cfg.get("prefix") or field)
            extractors = {
                "year": lambda s: s.dt.year,
                "quarter": lambda s: s.dt.quarter,
                "month": lambda s: s.dt.month,
                "month_name": lambda s: s.dt.month_name(),
                "week": lambda s: s.dt.isocalendar().week.astype("Int64"),
                "day": lambda s: s.dt.day,
                "weekday": lambda s: s.dt.day_name(),
                "hour": lambda s: s.dt.hour,
                "date": lambda s: s.dt.date.astype(str),
                "yearmonth": lambda s: s.dt.to_period("M").astype(str),
            }
            for part in parts:
                fn = extractors.get(part)
                if fn is None:
                    continue
                new_name = f"{prefix}_{part}"
                df[new_name] = fn(parsed)
            return df

        if op == "sample":
            method = cfg.get("method", "random")
            n = int(cfg.get("n") or 0)
            fraction = float(cfg.get("fraction") or 0)
            if method == "first":
                return df.head(n).copy()
            if method == "last":
                return df.tail(n).copy()
            if fraction:
                return df.sample(frac=max(0, min(1, fraction)), random_state=int(cfg.get("seed", 42))).copy()
            return df.sample(n=min(n, len(df)), random_state=int(cfg.get("seed", 42))).copy()

        raise PipelineExecutionError(f"Unsupported operation '{op}'.")

    @transaction.atomic
    def execute(self):
        self.run.status = "running"
        self.run.save(update_fields=["status"])
        if self.pipeline.source == "dataset" and self.pipeline.source_dataset_id:
            df = dataset_dataframe(self.pipeline.source_dataset)
        else:
            df, _submissions = survey_dataframe(self.survey)
        self.run.source_count = len(df)

        try:
            for step in self.pipeline.steps.filter(enabled=True).order_by("order", "id"):
                before_rows, before_cols = df.shape
                try:
                    df = self._apply_step(df.copy(), step)
                    self.step_stats.append({
                        "step_id": step.id,
                        "name": step.name,
                        "operation": step.operation,
                        "before_rows": before_rows,
                        "after_rows": len(df),
                        "before_columns": before_cols,
                        "after_columns": len(df.columns),
                        "status": "ok",
                    })
                except Exception as exc:
                    self.step_stats.append({
                        "step_id": step.id,
                        "name": step.name,
                        "operation": step.operation,
                        "status": "failed",
                        "error": str(exc),
                    })
                    if step.stop_on_error:
                        raise

            self.run.records.all().delete()
            self.run.changes.all().delete()

            records = []
            for number, (_, row) in enumerate(df.reset_index(drop=True).iterrows(), start=1):
                data = {
                    key: _json_value(value)
                    for key, value in row.to_dict().items()
                    if key not in META_COLUMNS
                }
                source_id = row.get("_submission_id")
                records.append(CleanedRecord(
                    run=self.run,
                    source_submission_id=int(source_id) if pd.notna(source_id) else None,
                    row_number=number,
                    data=data,
                ))
            CleanedRecord.objects.bulk_create(records, batch_size=500)
            if self.changes:
                CleaningChange.objects.bulk_create(self.changes, batch_size=1000)

            self.run.status = "complete"
            self.run.result_count = len(records)
            self.run.excluded_count = max(0, self.run.source_count - self.run.result_count)
            self.run.column_count = len([c for c in df.columns if c not in META_COLUMNS])
            self.run.schema = [
                {"name": c, "dtype": str(df[c].dtype)}
                for c in df.columns if c not in META_COLUMNS
            ]
            self.run.summary = {
                "steps": self.step_stats,
                "changes": len(self.changes),
                "missing_cells": int(df.isna().sum().sum()),
            }
            self.run.completed_at = timezone.now()
            self.run.save()
            return self.run

        except Exception as exc:
            self.run.status = "failed"
            self.run.error = str(exc)
            self.run.completed_at = timezone.now()
            self.run.summary = {"steps": self.step_stats}
            self.run.save()
            raise