"""
kura/agent_report.py — Foon drafts a report about the data.

The model writes the WORDS from aggregate statistics (it never sees answers
or photos): a title, an executive summary, findings sections, recommendations
and limitations. This module adds what the words point at — computed charts,
tables and the survey's photos (starred first, with their captions) — and
writes the report three ways:

    Word (.docx)   python-docx — editable, for sharing and tracked changes
    PDF            reportlab — no system libraries needed on the server
    HTML           one self-contained page (charts and photos embedded)

build_report(ctx, spec) → the report model (also the chat preview)
tool_report(ctx, spec)  → the chat block
builtin_report(ctx)     → a solid report without the AI
"""

from __future__ import annotations

import base64
import html
import io
import re

from django.utils import timezone

from . import agent_engine as eng

MAX_SECTIONS = 9
INK, MUTED, ACCENT = "#1b1d3a", "#5b6288", "#e8482b"
PALETTE = ["#e8482b", "#2a9d8f", "#3b82f6", "#e9c46a", "#8b5cf6", "#f472b6", "#14b8a6", "#f59e0b"]


def _clip(s, n):
    s = str(s or "").strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _paras(text):
    return [p.strip() for p in re.split(r"\n\s*\n", str(text or "")) if p.strip()]


# ─────────────────────────────────────────────────────────────────────
#  The report model
# ─────────────────────────────────────────────────────────────────────

def _method(ctx):
    import pandas as pd
    df = ctx.frame
    s = ctx.survey
    d = pd.to_datetime(df.get("_received_at"), errors="coerce", utc=True).dropna()
    period = f"between {d.min().strftime('%d %B %Y')} and {d.max().strftime('%d %B %Y')}" if len(d) else ""
    total = s.submissions.count()
    excluded = s.submissions.filter(status="excluded").count()
    src = df["_source"].value_counts().to_dict() if "_source" in df.columns else {}
    via = ", ".join(f"{n:,} via {'the web link' if k == 'web' else 'the Kura Collect app'}" for k, n in src.items())
    text = (f"This report covers {len(df):,} responses to “{s.title}” collected {period}"
            f"{' (' + via + ')' if via else ''}. ")
    if excluded:
        text += f"{excluded:,} of {total:,} received responses were excluded during data cleaning. "
    text += ("Percentages are of the people who answered each question. Figures were computed directly from the "
             "survey data in Kura; the narrative was drafted with Foon, Kura's AI assistant, from summary statistics "
             "only — no individual answers or photos were shared with the AI.")
    return text


def build_report(ctx, spec):
    from . import media
    spec = spec or {}
    sections, problems, used = [], [], set()
    labels = media._question_labels(ctx.survey)
    fig = 0
    for sec in [s for s in (spec.get("sections") or []) if isinstance(s, dict)][:MAX_SECTIONS]:
        out = {"heading": _clip(sec.get("heading"), 120) or "Findings", "paras": _paras(sec.get("text"))[:6],
               "chart": None, "table": None, "photos": []}
        if isinstance(sec.get("chart"), dict):
            block = eng.run_tool(ctx, {**sec["chart"], "tool": "chart"})
            if block.get("type") == "chart":
                fig += 1
                block["figure"] = fig
                out["chart"] = block
            else:
                problems.append(f"Chart in “{out['heading']}”: {block.get('text')}")
        if isinstance(sec.get("table"), dict):
            block = eng.run_tool(ctx, {**sec["table"], "tool": "table", "mode": sec["table"].get("mode") or "frequency"})
            if block.get("type") == "table" and not block.get("row_level"):
                block["rows"] = block["rows"][:25]
                out["table"] = block
            elif block.get("type") == "error":
                problems.append(f"Table in “{out['heading']}”: {block.get('text')}")
        ph = sec.get("photos")
        if isinstance(ph, dict) and int(ph.get("count") or 0) > 0:
            from .agent_story import _submission_ids
            ids = _submission_ids(ctx, ph.get("filters"))
            picks = [p for p in media.pick_photos(ctx.survey, n=min(4, int(ph["count"])) + len(used),
                                                  question=ph.get("question") or None, submission_ids=ids)
                     if p.id not in used][:min(4, int(ph["count"]))]
            used.update(p.id for p in picks)
            out["photos"] = [{"media": p, "caption": media.photo_credit(p, labels),
                              "thumb": media.media_url(ctx.survey, p, "thumb")} for p in picks]
        if out["paras"] or out["chart"] or out["table"] or out["photos"]:
            sections.append(out)
    kpis = eng.tool_cards(ctx, {"cards": None})["cards"][:4] if not ctx.frame.empty else []
    return {
        "title": _clip(spec.get("title") or f"{ctx.survey.title}: findings", 140),
        "subtitle": _clip(spec.get("subtitle") or "Survey findings report", 200),
        "date": timezone.localdate().strftime("%d %B %Y"),
        "survey": ctx.survey.title,
        "summary": _paras(spec.get("summary"))[:4],
        "kpis": kpis,
        "sections": sections,
        "recommendations": [_clip(r, 400) for r in (spec.get("recommendations") or []) if str(r).strip()][:10],
        "limitations": _paras(spec.get("limitations"))[:3],
        "method": _method(ctx),
        "problems": problems,
    }


def tool_report(ctx, spec):
    if ctx.survey is None:
        raise eng.ToolError("Open a survey and I'll write a report about its data.")
    if ctx.frame.empty:
        raise eng.ToolError("A report needs some responses first.")
    rep = build_report(ctx, spec)
    norm = {k: spec.get(k) for k in ("title", "subtitle", "summary", "sections", "recommendations", "limitations")}
    norm["tool"] = "report"
    preview = []
    for s in rep["sections"]:
        item = {"heading": s["heading"], "lead": _clip(s["paras"][0], 220) if s["paras"] else ""}
        if s["chart"]:
            item["chart"] = {"kind": s["chart"]["chart"], "labels": s["chart"]["labels"][:6],
                             "values": (s["chart"].get("percent") or s["chart"]["series"][0]["data"])[:6],
                             "title": s["chart"]["title"]}
        if s["table"]:
            item["table"] = s["table"]["title"]
        if s["photos"]:
            item["photos"] = [p["thumb"] for p in s["photos"]]
        preview.append(item)
    words = sum(len(" ".join(s["paras"]).split()) for s in rep["sections"]) + len(" ".join(rep["summary"]).split())
    return {"type": "report", "title": rep["title"], "subtitle": rep["subtitle"], "date": rep["date"],
            "summary": rep["summary"][:2], "kpis": rep["kpis"], "sections": preview,
            "recommendations": rep["recommendations"][:5], "problems": rep["problems"],
            "stats": {"sections": len(rep["sections"]), "charts": sum(1 for s in rep["sections"] if s["chart"]),
                      "photos": sum(len(s["photos"]) for s in rep["sections"]), "words": words,
                      "pages": max(1, round((words / 350) + sum(1 for s in rep["sections"] if s["chart"]) * .4 +
                                            sum(len(s["photos"]) for s in rep["sections"]) * .25 + 1))},
            "spec": norm}


# ─────────────────────────────────────────────────────────────────────
#  Charts as images (matplotlib, document style)
# ─────────────────────────────────────────────────────────────────────

def chart_png(block, width=6.6, height=3.5, dpi=180):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    labels = [str(l) for l in block.get("labels") or []]
    series = block.get("series") or []
    kind = block.get("chart") or "bar"
    fig, ax = plt.subplots(figsize=(width, height), dpi=dpi)
    fig.patch.set_facecolor("white")
    plt.rcParams["font.family"] = "DejaVu Sans"
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    ax.spines["left"].set_color("#c9cde0")
    ax.spines["bottom"].set_color("#c9cde0")
    ax.tick_params(colors="#3b4166", labelsize=9)
    short = [l if len(l) <= 26 else l[:25] + "…" for l in labels]
    try:
        if kind in ("pie", "donut", "polarArea") and series:
            vals = [v or 0 for v in series[0]["data"]]
            wedges, _t = ax.pie(vals, labels=None, colors=PALETTE[:len(vals)], startangle=90, counterclock=False,
                                wedgeprops={"width": 0.42 if kind == "donut" else 1, "edgecolor": "white", "linewidth": 2})
            pct = block.get("percent") or [round(v * 100 / (sum(vals) or 1), 1) for v in vals]
            ax.legend(wedges, [f"{l}  {p:g}%" for l, p in zip(short, pct)], loc="center left", bbox_to_anchor=(1, .5),
                      frameon=False, fontsize=9)
            ax.axis("equal")
        elif kind == "scatter" and series:
            pts = series[0]["data"]
            ax.scatter([p["x"] for p in pts], [p["y"] for p in pts], s=14, color=PALETTE[0], alpha=.7)
            ax.set_xlabel(block.get("x_label", ""), color=MUTED, fontsize=9)
            ax.set_ylabel(block.get("y_label", ""), color=MUTED, fontsize=9)
        elif kind in ("line", "area") and series:
            x = list(range(len(labels)))
            for i, s in enumerate(series[:6]):
                ys = [v or 0 for v in s["data"]]
                ax.plot(x, ys, color=PALETTE[i % len(PALETTE)], linewidth=2, label=s["name"])
                if kind == "area" or len(series) == 1:
                    ax.fill_between(x, ys, alpha=.12, color=PALETTE[i % len(PALETTE)])
            step = max(1, len(labels) // 8)
            ax.set_xticks(x[::step])
            ax.set_xticklabels([l[:10] for l in labels[::step]], rotation=0)
            if len(series) > 1:
                ax.legend(frameon=False, fontsize=8)
            ax.grid(axis="y", color="#eceef6")
        else:
            horizontal = not block.get("histogram") and (
                kind == "hbar" or (len(labels) > 6 and max((len(l) for l in labels), default=0) > 12))
            n = len(series) or 1
            idx = list(range(len(labels)))
            wbar = 0.8 / n
            stacked = block.get("stacked")
            base = [0] * len(labels)
            for i, s in enumerate(series[:6]):
                vals = [v or 0 for v in s["data"]]
                pos = idx if stacked or n == 1 else [p - 0.4 + wbar * (i + .5) for p in idx]
                color = PALETTE[i % len(PALETTE)] if n > 1 else PALETTE[0]
                if horizontal:
                    ax.barh(pos, vals, height=wbar if not stacked else .7, left=base if stacked else None, color=color,
                            label=s["name"])
                else:
                    ax.bar(pos, vals, width=wbar if not stacked else .7, bottom=base if stacked else None, color=color,
                           label=s["name"])
                if stacked:
                    base = [b + v for b, v in zip(base, vals)]
            if horizontal:
                ax.set_yticks(idx)
                ax.set_yticklabels(short)
                ax.invert_yaxis()
                ax.grid(axis="x", color="#eceef6")
            else:
                ax.set_xticks(idx)
                ax.set_xticklabels(short, rotation=30 if len(labels) > 5 else 0, ha="right" if len(labels) > 5 else "center")
                ax.grid(axis="y", color="#eceef6")
            ax.set_axisbelow(True)
            if n == 1 and block.get("percent") and not horizontal:
                for p, v, pc in zip(idx, series[0]["data"], block["percent"]):
                    ax.text(p, (v or 0), f"{pc:g}%", ha="center", va="bottom", fontsize=8, color=INK)
            elif n == 1 and block.get("percent") and horizontal:
                for p, v, pc in zip(idx, series[0]["data"], block["percent"]):
                    ax.text((v or 0), p, f"  {pc:g}%", ha="left", va="center", fontsize=8, color=INK)
            if n > 1:
                ax.legend(frameon=False, fontsize=8)
        fig.tight_layout()
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=dpi, facecolor="white")
        return buf.getvalue()
    finally:
        plt.close(fig)


def _photo_jpeg(p, variant="web"):
    from . import media
    return media.photo_bytes(p["media"], variant)


# ─────────────────────────────────────────────────────────────────────
#  Word
# ─────────────────────────────────────────────────────────────────────

def to_docx(rep) -> bytes:
    from docx import Document
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Inches, Pt, RGBColor

    def rgb(h):
        h = h.lstrip("#")
        return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

    def shade(cell, hexcolor):
        tcPr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), hexcolor.lstrip("#"))
        tcPr.append(shd)

    doc = Document()
    sec = doc.sections[0]
    sec.left_margin = sec.right_margin = Inches(0.9)
    st = doc.styles["Normal"]
    st.font.name = "Calibri"
    st.font.size = Pt(11)
    st.font.color.rgb = rgb(INK)
    for name, size, color in (("Heading 1", 17, INK), ("Heading 2", 13, ACCENT), ("Title", 30, INK)):
        s = doc.styles[name]
        s.font.name = "Calibri"
        s.font.size = Pt(size)
        s.font.color.rgb = rgb(color)
        s.font.bold = True

    # cover
    p = doc.add_paragraph()
    r = p.add_run(rep["survey"].upper())
    r.font.size, r.font.bold, r.font.color.rgb = Pt(10), True, rgb(ACCENT)
    doc.add_paragraph(rep["title"], style="Title")
    p = doc.add_paragraph()
    r = p.add_run(rep["subtitle"])
    r.font.size, r.font.color.rgb = Pt(14), rgb(MUTED)
    p = doc.add_paragraph()
    r = p.add_run(rep["date"])
    r.font.size, r.font.color.rgb = Pt(10), rgb(MUTED)

    if rep["kpis"]:
        t = doc.add_table(rows=2, cols=len(rep["kpis"]))
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for i, k in enumerate(rep["kpis"]):
            v = f"{eng.fmt_num(k['value'])}%" if k.get("format") == "percent" else eng.fmt_num(k["value"])
            c1, c2 = t.cell(0, i), t.cell(1, i)
            for c in (c1, c2):
                shade(c, "F3F1FF")
            c1.text = ""
            run = c1.paragraphs[0].add_run(v)
            run.font.size, run.font.bold, run.font.color.rgb = Pt(22), True, rgb(ACCENT)
            c2.text = ""
            run = c2.paragraphs[0].add_run(k["label"])
            run.font.size, run.font.color.rgb = Pt(9), rgb(MUTED)
        doc.add_paragraph()

    if rep["summary"]:
        doc.add_heading("Executive summary", level=1)
        for para in rep["summary"]:
            doc.add_paragraph(para)

    for s in rep["sections"]:
        doc.add_heading(s["heading"], level=1)
        for para in s["paras"]:
            doc.add_paragraph(para)
        if s["chart"]:
            doc.add_picture(io.BytesIO(chart_png(s["chart"])), width=Inches(6.4))
            doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cap = doc.add_paragraph()
            r = cap.add_run(f"Figure {s['chart']['figure']}. {s['chart']['title']}"
                            + (f" — {s['chart']['caption']}" if s["chart"].get("caption") else ""))
            r.font.size, r.italic, r.font.color.rgb = Pt(9), True, rgb(MUTED)
        if s["table"]:
            tb = s["table"]
            cols = tb["columns"][:6]
            t = doc.add_table(rows=1, cols=len(cols))
            t.style = "Light Grid Accent 1"
            for i, c in enumerate(cols):
                t.rows[0].cells[i].text = str(c)
            for row in tb["rows"]:
                cells = t.add_row().cells
                for i, c in enumerate(cols):
                    v = row.get(c)
                    cells[i].text = eng.fmt_num(v) if isinstance(v, (int, float)) else str(v if v is not None else "")
            doc.add_paragraph()
        if s["photos"]:
            ncol = 2 if len(s["photos"]) > 1 else 1
            t = doc.add_table(rows=0, cols=ncol)
            for i in range(0, len(s["photos"]), ncol):
                row = t.add_row().cells
                for j, ph in enumerate(s["photos"][i:i + ncol]):
                    par = row[j].paragraphs[0]
                    par.add_run().add_picture(io.BytesIO(_photo_jpeg(ph)), width=Inches(3.0 if ncol == 2 else 5.0))
                    cp = row[j].add_paragraph()
                    r = cp.add_run(ph["caption"])
                    r.font.size, r.italic, r.font.color.rgb = Pt(8.5), True, rgb(MUTED)
            doc.add_paragraph()

    if rep["recommendations"]:
        doc.add_heading("Recommendations", level=1)
        for r_ in rep["recommendations"]:
            doc.add_paragraph(r_, style="List Number")
    doc.add_heading("About the data", level=1)
    doc.add_paragraph(rep["method"])
    for para in rep["limitations"]:
        doc.add_paragraph(para)
    footer = sec.footer.paragraphs[0]
    footer.text = f"{rep['survey']} — {rep['date']} — made with Kura"
    footer.runs[0].font.size = Pt(8)
    footer.runs[0].font.color.rgb = rgb(MUTED)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ─────────────────────────────────────────────────────────────────────
#  PDF
# ─────────────────────────────────────────────────────────────────────

def to_pdf(rep) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (Image, KeepTogether, ListFlowable, ListItem, PageBreak, Paragraph,
                                    SimpleDocTemplate, Spacer, Table, TableStyle)

    esc = lambda t: html.escape(str(t or ""))  # noqa: E731
    base = getSampleStyleSheet()
    S = {
        "kick": ParagraphStyle("kick", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=9, textColor=colors.HexColor(ACCENT)),
        "title": ParagraphStyle("t", parent=base["Title"], fontName="Helvetica-Bold", fontSize=28, leading=33,
                                textColor=colors.HexColor(INK), alignment=0, spaceAfter=8),
        "sub": ParagraphStyle("s", parent=base["Normal"], fontSize=13, leading=17, textColor=colors.HexColor(MUTED)),
        "h1": ParagraphStyle("h1", parent=base["Heading1"], fontName="Helvetica-Bold", fontSize=15, leading=19,
                             textColor=colors.HexColor(INK), spaceBefore=14, spaceAfter=6),
        "p": ParagraphStyle("p", parent=base["BodyText"], fontSize=10.5, leading=15, textColor=colors.HexColor(INK), spaceAfter=6),
        "cap": ParagraphStyle("c", parent=base["Normal"], fontName="Helvetica-Oblique", fontSize=8.5, leading=11,
                              textColor=colors.HexColor(MUTED), spaceAfter=10),
        "kv": ParagraphStyle("kv", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=20, leading=24,
                             textColor=colors.HexColor(ACCENT), alignment=TA_CENTER),
        "kl": ParagraphStyle("kl", parent=base["Normal"], fontSize=8.5, leading=11, textColor=colors.HexColor(MUTED),
                             alignment=TA_CENTER),
    }
    buf = io.BytesIO()
    width = A4[0] - 36 * mm

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(colors.HexColor(MUTED))
        canvas.drawString(18 * mm, 10 * mm, f"{rep['survey']} — {rep['date']} — made with Kura")
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, str(doc_.page))
        canvas.restoreState()

    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm,
                            bottomMargin=18 * mm, title=rep["title"], author="Kura · Foon")
    story = [Paragraph(esc(rep["survey"]).upper(), S["kick"]), Spacer(1, 4), Paragraph(esc(rep["title"]), S["title"]),
             Paragraph(esc(rep["subtitle"]), S["sub"]), Spacer(1, 2), Paragraph(esc(rep["date"]), S["cap"])]
    if rep["kpis"]:
        cells = [[Paragraph(esc(f"{eng.fmt_num(k['value'])}%" if k.get('format') == 'percent' else eng.fmt_num(k['value'])), S["kv"])
                  for k in rep["kpis"]], [Paragraph(esc(k["label"]), S["kl"]) for k in rep["kpis"]]]
        t = Table(cells, colWidths=[width / len(rep["kpis"])] * len(rep["kpis"]))
        t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F3F1FF")),
                               ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                               ("LINEAFTER", (0, 0), (-2, -1), .6, colors.white)]))
        story += [Spacer(1, 10), t]
    if rep["summary"]:
        story.append(Paragraph("Executive summary", S["h1"]))
        story += [Paragraph(esc(p), S["p"]) for p in rep["summary"]]
    for s in rep["sections"]:
        lead = [Paragraph(esc(s["heading"]), S["h1"])] + [Paragraph(esc(p), S["p"]) for p in s["paras"]]
        if s["chart"]:
            img = Image(io.BytesIO(chart_png(s["chart"])), width=width, height=width * 3.5 / 6.6)
            fig_ = [img, Paragraph(esc(f"Figure {s['chart']['figure']}. {s['chart']['title']}"
                                       + (f' — {s["chart"]["caption"]}' if s['chart'].get('caption') else '')), S["cap"])]
            story.append(KeepTogether(lead + fig_))      # a heading never strands at a page foot
        elif not s["photos"]:
            story.append(KeepTogether(lead))
        if s["table"]:
            tb = s["table"]
            cols = tb["columns"][:6]
            data = [[Paragraph(f"<b>{esc(c)}</b>", S["cap"]) for c in cols]]
            for row in tb["rows"]:
                data.append([Paragraph(esc(eng.fmt_num(row.get(c)) if isinstance(row.get(c), (int, float)) else row.get(c)), S["p"])
                             for c in cols])
            t = Table(data, repeatRows=1, colWidths=[width / len(cols)] * len(cols))
            t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, 0), .8, colors.HexColor(INK)),
                                   ("LINEBELOW", (0, 1), (-1, -1), .3, colors.HexColor("#D9DCEB")),
                                   ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            story += [t, Spacer(1, 8)]
        if s["photos"]:
            ncol = 2 if len(s["photos"]) > 1 else 1
            cw = width / ncol - 4
            cells, row = [], []
            for ph in s["photos"]:
                m = ph["media"]
                ratio = (m.height / m.width) if m.width else .75
                h_ = min(cw * ratio, 95 * mm)
                row.append([Image(io.BytesIO(_photo_jpeg(ph)), width=h_ / ratio, height=h_), Paragraph(esc(ph["caption"]), S["cap"])])
                if len(row) == ncol:
                    cells.append(row)
                    row = []
            if row:
                cells.append(row + [""] * (ncol - len(row)))
            t = Table(cells, colWidths=[width / ncol] * ncol)
            t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
            if s["chart"]:
                story += [t, Spacer(1, 6)]
            else:                                         # keep "From the field" with its photos
                story.append(KeepTogether(lead + [t]))
                story.append(Spacer(1, 6))
    if rep["recommendations"]:
        story.append(Paragraph("Recommendations", S["h1"]))
        story.append(ListFlowable([ListItem(Paragraph(esc(r), S["p"])) for r in rep["recommendations"]],
                                  bulletType="1", leftIndent=14))
    story.append(Paragraph("About the data", S["h1"]))
    story.append(Paragraph(esc(rep["method"]), S["p"]))
    story += [Paragraph(esc(p), S["p"]) for p in rep["limitations"]]
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()


# ─────────────────────────────────────────────────────────────────────
#  HTML (one self-contained page)
# ─────────────────────────────────────────────────────────────────────

def to_html(rep) -> bytes:
    e = lambda t: html.escape(str(t or ""))  # noqa: E731
    b64 = lambda data, kind: f"data:{kind};base64,{base64.b64encode(data).decode()}"  # noqa: E731
    parts = [f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(rep['title'])}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Archivo:wght@400;600;700&display=swap" rel="stylesheet">
<style>
body{{margin:0;background:#f4f2ee;color:{INK};font:16px/1.65 Archivo,system-ui,sans-serif}}
.page{{max-width:860px;margin:40px auto;background:#fff;padding:64px 72px;border-radius:6px;box-shadow:0 20px 60px rgba(20,20,40,.08)}}
.kick{{color:{ACCENT};font-weight:700;font-size:12px;letter-spacing:.08em;text-transform:uppercase}}
h1{{font:600 42px/1.1 Fraunces,Georgia,serif;margin:10px 0 8px;letter-spacing:-.01em}}
.sub{{color:{MUTED};font-size:19px;margin:0}} .date{{color:{MUTED};font-size:13px;margin-top:6px}}
.kpis{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:34px 0}}
.kpi{{background:#f3f1ff;border-radius:14px;padding:16px 18px}} .kpi b{{display:block;font:700 30px/1.1 Archivo;color:{ACCENT}}}
.kpi span{{color:{MUTED};font-size:13px}}
h2{{font:600 26px/1.2 Fraunces,Georgia,serif;margin:44px 0 10px;padding-top:18px;border-top:1px solid #ecebf3}}
figure{{margin:22px 0}} figure img{{width:100%;border-radius:8px}} figcaption{{color:{MUTED};font-size:13px;font-style:italic;margin-top:6px}}
table{{border-collapse:collapse;width:100%;font-size:14px;margin:16px 0}} th,td{{text-align:left;padding:7px 10px;border-bottom:1px solid #e6e5ef}}
th{{border-bottom:2px solid {INK}}} td.n{{text-align:right;font-variant-numeric:tabular-nums}}
.photos{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin:18px 0}}
.photos figure{{margin:0}} .photos img{{aspect-ratio:4/3;object-fit:cover}}
ol li{{margin:6px 0}} .about{{background:#faf9f6;border-radius:12px;padding:16px 20px;color:#3b4166;font-size:14px}}
footer{{max-width:860px;margin:0 auto 40px;color:{MUTED};font-size:12px;text-align:center}}
@media print{{body{{background:#fff}} .page{{box-shadow:none;margin:0;padding:0}} h2{{break-after:avoid}} figure{{break-inside:avoid}}}}
@media (max-width:700px){{.page{{padding:34px 22px;margin:0;border-radius:0}} h1{{font-size:32px}}}}
</style></head><body><article class="page">
<div class="kick">{e(rep['survey'])}</div><h1>{e(rep['title'])}</h1><p class="sub">{e(rep['subtitle'])}</p><div class="date">{e(rep['date'])}</div>"""]
    if rep["kpis"]:
        parts.append('<div class="kpis">' + "".join(
            f'<div class="kpi"><b>{e(eng.fmt_num(k["value"]) + ("%" if k.get("format") == "percent" else ""))}</b><span>{e(k["label"])}</span></div>'
            for k in rep["kpis"]) + "</div>")
    if rep["summary"]:
        parts.append("<h2>Executive summary</h2>" + "".join(f"<p>{e(p)}</p>" for p in rep["summary"]))
    for s in rep["sections"]:
        parts.append(f"<h2>{e(s['heading'])}</h2>" + "".join(f"<p>{e(p)}</p>" for p in s["paras"]))
        if s["chart"]:
            c = s["chart"]
            parts.append(f'<figure><img alt="{e(c["title"])}" src="{b64(chart_png(c), "image/png")}"><figcaption>Figure {c["figure"]}. '
                         f'{e(c["title"])}{" — " + e(c["caption"]) if c.get("caption") else ""}</figcaption></figure>')
        if s["table"]:
            tb = s["table"]
            cols = tb["columns"][:6]
            parts.append("<table><thead><tr>" + "".join(f"<th>{e(c)}</th>" for c in cols) + "</tr></thead><tbody>" + "".join(
                "<tr>" + "".join((f'<td class="n">{e(eng.fmt_num(r.get(c)))}</td>' if isinstance(r.get(c), (int, float))
                                  else f"<td>{e(r.get(c))}</td>") for c in cols) + "</tr>" for r in tb["rows"]) + "</tbody></table>")
        if s["photos"]:
            parts.append('<div class="photos">' + "".join(
                f'<figure><img alt="{e(p["caption"])}" src="{b64(_photo_jpeg(p), "image/jpeg")}"><figcaption>{e(p["caption"])}</figcaption></figure>'
                for p in s["photos"]) + "</div>")
    if rep["recommendations"]:
        parts.append("<h2>Recommendations</h2><ol>" + "".join(f"<li>{e(r)}</li>" for r in rep["recommendations"]) + "</ol>")
    parts.append(f'<h2>About the data</h2><div class="about"><p>{e(rep["method"])}</p>' +
                 "".join(f"<p>{e(p)}</p>" for p in rep["limitations"]) + "</div>")
    parts.append(f"</article><footer>{e(rep['survey'])} — {e(rep['date'])} — made with Kura</footer></body></html>")
    return "".join(parts).encode("utf-8")


# ─────────────────────────────────────────────────────────────────────
#  A report without the AI
# ─────────────────────────────────────────────────────────────────────

def builtin_report(ctx):
    from . import media
    df = ctx.frame
    choices = [f for f in ctx.catalog if f["kind"] == "choice" and not f.get("meta") and eng._informative_choice(ctx, f)]
    nums = [f for f in ctx.catalog if f["kind"] == "number" and not f.get("meta") and f["name"] in df.columns]
    sections, summary_bits = [], []
    for f in choices[:5]:
        st = eng.column_stats(df, f)
        top = st.get("top") or []
        if not top:
            continue
        lead = f"For “{f['label']}”, the most common answer was {top[0]['label']} ({top[0]['pct']:g}%)"
        if len(top) > 1:
            lead += f", followed by {top[1]['label']} ({top[1]['pct']:g}%)"
        lead += f". {st['answered']:,} people answered this question."
        summary_bits.append(f"{top[0]['pct']:g}% chose {top[0]['label']} for {eng.short_label(f).lower()}")
        sections.append({"heading": eng.short_label(f), "text": lead,
                         "chart": {"kind": "hbar" if len(f.get("choices") or []) > 4 else "bar", "x": f["name"]}})
    for f in nums[:2]:
        st = eng.column_stats(df, f)
        if st.get("mean") is None:
            continue
        sections.append({"heading": eng.short_label(f),
                         "text": (f"Answers to “{f['label']}” averaged {eng.fmt_num(st['mean'])} (median {eng.fmt_num(st['median'])}), "
                                  f"ranging from {eng.fmt_num(st['min'])} to {eng.fmt_num(st['max'])}."),
                         "chart": {"kind": "histogram", "x": f["name"]}})
    stats = media.photo_stats(ctx.survey)
    if stats["total"]:
        sections.append({"heading": "From the field", "text": f"{stats['total']:,} photos were collected with the survey. "
                         "A selection is shown below" + (" — starred photos first." if stats["starred"] else "."),
                         "photos": {"count": 4}})
    summary = (f"This report summarises {len(df):,} responses to “{ctx.survey.title}”. " +
               ("Key results: " + "; ".join(summary_bits[:3]) + "." if summary_bits else ""))
    profile = eng.tool_profile(ctx, {}) if not df.empty else {"issues": []}
    recs = [i["text"] for i in profile["issues"] if i["level"] in ("warn", "privacy")][:4]
    return {"tool": "report", "title": f"{ctx.survey.title}: findings", "subtitle": "Survey findings report",
            "summary": summary, "sections": sections,
            "recommendations": recs or ["Share these findings with the communities and teams who took part."],
            "limitations": "Built automatically by Foon's built-in report writer. Review the wording before sharing."}
