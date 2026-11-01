"""
kura/agent_export.py — turn anything Foon made into a file.

Every export RE-RUNS the tool on the server from its normalised spec, with
the caller's permissions, instead of trusting numbers sent by the browser.
That is what lets a chat preview show 60 rows while the download carries
all 12,000, and it means a tampered request can't smuggle in data the user
isn't allowed to see.

Formats
  csv      UTF-8 with BOM so Excel opens accents and Wolof/Mandinka text correctly
  xlsx     styled workbook (one sheet per table; privacy report sheet included)
  html     standalone page: Chart.js + Leaflet from CDNs, data embedded
  geojson  map points
  json     questionnaire fragment
  kuraform the builder's own Excel format — re-imports with ⇪ Import
"""

from __future__ import annotations

import io
import json
import re

import pandas as pd
from django.template.loader import render_to_string
from django.utils import timezone

from . import agent_engine as eng

CONTENT_TYPES = {
    "csv": "text/csv; charset=utf-8",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "kuraform": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "html": "text/html; charset=utf-8",
    "geojson": "application/geo+json",
    "json": "application/json",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pdf": "application/pdf",
}
ROW_LEVEL = {"clean", "privacy"}


class ExportError(Exception):
    pass


def _slug(text, fallback="foon"):
    s = re.sub(r"[^A-Za-z0-9]+", "-", str(text or "")).strip("-").lower()[:50]
    return s or fallback


def _sheet_name(text, used):
    base = re.sub(r"[\[\]\:\*\?\/\\]", " ", str(text or "Sheet")).strip()[:28] or "Sheet"
    name, n = base, 2
    while name.lower() in used:
        name = f"{base[:25]} {n}"
        n += 1
    used.add(name.lower())
    return name


# ─────────────────────────── tables out of blocks ───────────────────────────

def _chart_frame(block):
    labels = block.get("labels") or []
    series = block.get("series") or []
    if block.get("chart") == "scatter":
        rows = []
        for s in series:
            for p in s.get("data") or []:
                rows.append({"Series": s.get("name"), block.get("x_label") or "X": p.get("x"),
                             block.get("y_label") or "Y": p.get("y")})
        return pd.DataFrame(rows)
    data = {block.get("x_label") or "Category": labels}
    for s in series:
        data[str(s.get("name") or "Value")] = list(s.get("data") or [])[: len(labels)]
    if block.get("percent") and len(series) == 1:
        data["Percent"] = block["percent"][: len(labels)]
    return pd.DataFrame(data)


def block_frames(block) -> list[tuple[str, pd.DataFrame]]:
    t = block.get("type")
    title = block.get("title") or t
    if t == "chart":
        return [(title, _chart_frame(block))]
    if t == "table":
        return [(title, pd.DataFrame(block.get("rows") or [], columns=block.get("columns") or None))]
    if t == "cards":
        return [(title or "Key numbers", pd.DataFrame([{"Measure": c.get("label"), "Value": c.get("value"),
                                                        "Note": c.get("hint")} for c in block.get("cards") or []]))]
    if t == "shape":
        return [(title, pd.DataFrame([{"Label": i.get("label"), "Value": i.get("value"), "Percent": i.get("pct")}
                                      for i in block.get("items") or []]))]
    if t == "map":
        return [(title, pd.DataFrame([{"Latitude": p.get("lat"), "Longitude": p.get("lng"),
                                       "Group": p.get("group", "")} for p in block.get("points") or []]))]
    if t == "profile":
        return [("Columns", pd.DataFrame([{"Column": r["name"], "Question": r["label"], "Type": r["type"],
                                           "Answered": r["answered"], "Missing %": r["missing_pct"],
                                           "Summary": r["summary"], "Personal data": r["pii"]}
                                          for r in block.get("rows") or []])),
                ("Issues", pd.DataFrame([{"Level": i["level"], "Issue": i["text"]} for i in block.get("issues") or []]))]
    if t == "overview":
        return [("Overview", pd.DataFrame([{"Measure": s["label"], "Value": s["value"]} for s in block.get("stats") or []])),
                ("Last 14 days", pd.DataFrame([{"Day": d["day"], "Responses": d["n"]} for d in block.get("trend") or []]))]
    if t == "dashboard":
        out = []
        for it in block.get("items") or []:
            out.extend(block_frames(it["block"]))
        return out
    if t == "lint":
        return [("Questionnaire check", pd.DataFrame([{"Level": i["level"], "Question": i.get("field", ""),
                                                        "Issue": i["text"]} for i in block.get("issues") or []]))]
    return []


def full_frames(ctx, spec) -> tuple[list[tuple[str, pd.DataFrame]], dict]:
    """Row-level frames with every row (not the chat preview)."""
    tool = spec.get("tool")
    if tool == "clean":
        steps = eng.clean_steps(ctx, spec)
        df, report = eng.run_clean(ctx, steps)
        df = df[[c for c in eng.public_columns(df) if c != "_uuid"]]
        steps_df = pd.DataFrame([{"Step": r["name"], "Operation": r["operation"], "Status": r["status"],
                                  "Rows before": r.get("rows_before"), "Rows after": r.get("rows_after"),
                                  "Values changed": r.get("changes"), "Error": r.get("error", "")} for r in report])
        return [("Cleaned data", _flatten(df)), ("Cleaning steps", steps_df)], {"title": spec.get("title") or "cleaned-data"}
    if tool == "privacy":
        df, plan, kinfo = eng.run_privacy(ctx, spec)
        rep = pd.DataFrame([{"Column": p["column"], "Question": p["label"], "Detected": p["level"],
                             "Why": p["reason"], "What Foon did": eng.ACTION_TEXT.get(p["action"], p["action"])}
                            for p in plan if p["column"] != "_submission_id"])
        k = pd.DataFrame([{"Check": "k-anonymity target (k)", "Value": kinfo["k"]},
                          {"Check": "Quasi-identifiers kept", "Value": ", ".join(kinfo["quasi"]) or "none"},
                          {"Check": "Smallest group", "Value": kinfo["min_group"]},
                          {"Check": "Rows in groups smaller than k", "Value": kinfo["at_risk"]},
                          {"Check": "Rows removed for safety", "Value": kinfo["suppressed"]}])
        return [("Safe data", _flatten(df)), ("Privacy report", rep), ("Re-identification check", k)], \
            {"title": spec.get("title") or "privacy-safe-data"}
    if tool == "table":
        df, meta = eng.table_frame(ctx, spec, preview=False)
        return [(spec.get("title") or "Table", _flatten(df))], {"title": spec.get("title") or "table"}
    return [], {}


def _flatten(df):
    out = df.copy()
    for c in out.columns:
        if out[c].apply(lambda v: isinstance(v, (list, dict))).any():
            out[c] = out[c].apply(lambda v: ("|".join(map(str, v)) if isinstance(v, list)
                                             else json.dumps(v, ensure_ascii=False)) if isinstance(v, (list, dict)) else v)
    return out


# ─────────────────────────── writers ───────────────────────────

def write_csv(frames) -> bytes:
    if not frames:
        raise ExportError("Nothing to export.")
    df = frames[0][1]
    return df.to_csv(index=False).encode("utf-8-sig")


def write_xlsx(frames, title="Foon export") -> bytes:
    if not frames:
        raise ExportError("Nothing to export.")
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    buf = io.BytesIO()
    used = set()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        for name, df in frames:
            sheet = _sheet_name(name, used)
            safe_df = df.copy()
            for c in safe_df.columns:
                if safe_df[c].dtype == object:
                    safe_df[c] = safe_df[c].apply(
                        lambda v: v if not isinstance(v, str) or not v[:1] in ("=", "+", "-", "@") or _looks_number(v)
                        else "'" + v)
            safe_df.to_excel(xw, sheet_name=sheet, index=False)
            ws = xw.sheets[sheet]
            head_fill = PatternFill("solid", fgColor="2B2F77")
            for cell in ws[1]:
                cell.font = Font(bold=True, color="FFFFFF")
                cell.fill = head_fill
                cell.alignment = Alignment(vertical="center", wrap_text=True)
            ws.freeze_panes = "A2"
            for i, col in enumerate(safe_df.columns, start=1):
                sample = [str(col)] + [str(v) for v in safe_df[col].head(200).tolist()]
                width = min(60, max(8, max(len(s) for s in sample) + 2))
                ws.column_dimensions[get_column_letter(i)].width = width
            ws.row_dimensions[1].height = 30
        xw.book.properties.title = title[:250]
        xw.book.properties.creator = "Foon · Kura"
    return buf.getvalue()


def _looks_number(v):
    try:
        float(v)
        return True
    except ValueError:
        return False


def write_geojson(block) -> bytes:
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [p["lng"], p["lat"]]},
              "properties": {"group": p.get("group", ""), "row": p.get("row")}} for p in block.get("points") or []]
    return json.dumps({"type": "FeatureCollection", "features": feats}, ensure_ascii=False).encode("utf-8")


def write_html(blocks_or_board, title, survey_title="", dark=True) -> bytes:
    if isinstance(blocks_or_board, dict) and blocks_or_board.get("type") == "dashboard":
        board = blocks_or_board
        items = board.get("items") or []
        palette = board.get("palette")
        tokens = board.get("theme_tokens") or {}
        dark = board.get("dark", True)
    else:
        items = [{"x": 0, "y": i * 4, "w": 12, "h": 4, "block": b} for i, b in enumerate(blocks_or_board)]
        palette, tokens = None, {}
    payload = {"title": title, "survey": survey_title, "items": items,
               "palette": palette or ["#22d3ee", "#ff3f98", "#ff8a1f", "#8b5cf6", "#22c55e", "#e8482b", "#38bdf8", "#f472b6"],
               "tokens": tokens, "dark": bool(dark),
               "generated": timezone.localtime().strftime("%d %b %Y, %H:%M")}
    needs_map = any(it["block"].get("type") == "map" for it in items)
    html = render_to_string("kura/agent_export.html", {
        "title": title, "payload": payload, "needs_map": needs_map,
    })
    return html.encode("utf-8")


# ─────────────────────────── Kura Form workbook ───────────────────────────
# The builder's own Excel layout lives in kura/kura_form.py (writer, reader,
# checker) so Foon's downloads and Foon's checks can never drift apart.

def write_kura_form(title, description, questions, indicators=None) -> bytes:
    from .kura_form import build_workbook
    return build_workbook(title, description, questions, indicators or [])


# ─────────────────────────── entry point ───────────────────────────

def export(ctx, spec: dict, fmt: str):
    """Returns (bytes, filename, content_type). Raises ExportError / eng.ToolError."""
    tool = (spec or {}).get("tool")
    if tool not in eng.TOOLS and tool not in ("formcheck",):
        raise ExportError("Unknown block.")
    if fmt not in CONTENT_TYPES:
        raise ExportError("Unknown file type.")
    stamp = timezone.localtime().strftime("%Y%m%d-%H%M")
    code = ctx.survey.code if ctx.survey else "kura"
    survey_title = ctx.survey.title if ctx.survey else ""

    if tool == "form_template":
        from . import kura_form as kf
        if spec.get("kind") == "blank":
            data = kf.build_workbook("", "", [], [], blank_rows=40)
            return data, "kura_form_blank_template.xlsx", CONTENT_TYPES["xlsx"]
        data = kf.build_workbook("My survey", "", kf.STARTER, kf.STARTER_INDICATORS)
        return data, "kura_form_template.xlsx", CONTENT_TYPES["xlsx"]

    if tool == "report":
        from . import agent_report as rp
        if fmt not in ("docx", "pdf", "html"):
            raise ExportError("Reports download as Word, PDF or HTML.")
        if ctx.survey is None or not ctx.can.get("view"):
            raise ExportError("Open the survey to download its report.")
        rep = rp.build_report(ctx, spec)
        base = f"{ctx.survey.code}-{_slug(rep['title'])}-{stamp}"
        data = {"docx": rp.to_docx, "pdf": rp.to_pdf, "html": rp.to_html}[fmt](rep)
        return data, f"{base}.{fmt}", CONTENT_TYPES[fmt]

    if tool == "formcheck":
        from .agent_formcheck import export_checked
        return export_checked(ctx.user, spec, fmt)

    if tool == "questionnaire":
        qs = eng.sanitize_questions(spec.get("questions"))
        title = spec.get("title") or "Draft questionnaire"
        base = f"{_slug(title)}-{stamp}"
        if fmt == "json":
            data = json.dumps({"title": title, "description": spec.get("description") or "",
                               "schema": {"settings": {"anonymous": True, "languages": ["en"]}, "questions": qs}},
                              ensure_ascii=False, indent=2).encode("utf-8")
            return data, base + ".json", CONTENT_TYPES["json"]
        if fmt in ("kuraform", "xlsx"):
            return write_kura_form(title, spec.get("description") or "", qs), base + "_kura_form.xlsx", CONTENT_TYPES["xlsx"]
        raise ExportError("Questionnaires download as Kura Form (Excel) or JSON.")

    if tool in ROW_LEVEL or (tool == "table" and spec.get("mode") == "rows"):
        if not ctx.can.get("export"):
            raise ExportError("You don't have permission to download row-level data for this survey.")

    if tool in ROW_LEVEL or tool == "table":
        frames, meta = full_frames(ctx, spec)
        title = meta.get("title") or tool
        base = f"{code}-{_slug(title)}-{stamp}"
        if fmt == "csv":
            return write_csv(frames), base + ".csv", CONTENT_TYPES["csv"]
        if fmt == "xlsx":
            return write_xlsx(frames, title), base + ".xlsx", CONTENT_TYPES["xlsx"]
        if fmt == "html" and tool == "table":
            block = eng.run_tool(ctx, spec)
            df = frames[0][1]
            cols, rows = eng.frame_records(df, 5000)
            block = {**block, "columns": cols, "rows": rows}
            return write_html([block], block.get("title") or title, survey_title), base + ".html", CONTENT_TYPES["html"]
        raise ExportError("This one downloads as CSV or Excel.")

    block = eng.run_tool(ctx, spec)
    if block.get("type") == "error":
        raise ExportError(block.get("text") or "Could not rebuild this block.")
    title = block.get("title") or tool
    base = f"{code}-{_slug(title)}-{stamp}"
    if fmt == "html":
        payload = block if block.get("type") == "dashboard" else [block]
        return write_html(payload, title, survey_title), base + ".html", CONTENT_TYPES["html"]
    if fmt == "geojson":
        if block.get("type") != "map":
            raise ExportError("Only maps download as GeoJSON.")
        return write_geojson(block), base + ".geojson", CONTENT_TYPES["geojson"]
    frames = block_frames(block)
    if fmt == "csv":
        return write_csv(frames), base + ".csv", CONTENT_TYPES["csv"]
    if fmt == "xlsx":
        return write_xlsx(frames, title), base + ".xlsx", CONTENT_TYPES["xlsx"]
    raise ExportError("Unsupported file type for this block.")
