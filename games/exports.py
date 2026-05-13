"""
Excel + Word export builders for a single LiveSession.

Each builder takes a LiveSession and returns a BytesIO containing the
finished file. The view layer wraps that in an HttpResponse with the
right Content-Disposition header.

Dependencies:
  - openpyxl       (Excel + native charts)
  - python-docx    (Word docs)
  - matplotlib     (chart images embedded in Word; openpyxl handles
                    its own charts natively so we don't need it for xlsx)

If matplotlib isn't installed the Word export still works — charts
are just omitted with a small "(chart unavailable)" placeholder line.
"""
from __future__ import annotations

from io import BytesIO

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.chart.label import DataLabelList
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from docx import Document
from docx.shared import Cm, Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_ALIGN_VERTICAL

try:
    import matplotlib
    matplotlib.use("Agg")  # no GUI; safe in a Django worker
    import matplotlib.pyplot as plt
    _HAS_MPL = True
except ImportError:
    _HAS_MPL = False

from .leaderboards import full_leaderboard, per_question_stats, top_three_for_session


# ─────────────────────────────────────────────────────────────────
# Shared helpers
# ─────────────────────────────────────────────────────────────────

def _safe_sheet_title(title: str) -> str:
    """Excel sheet names can't contain []/\\?* and are capped at 31 chars."""
    bad = '[]:/\\?*'
    cleaned = "".join("_" if ch in bad else ch for ch in title).strip()
    return (cleaned or "Sheet")[:31]


def _format_session_label(session) -> str:
    """Human-readable label used in headers and filenames."""
    when = session.created_at.strftime("%Y-%m-%d %H:%M") if session.created_at else "unknown"
    quiz_title = session.quiz.title if session.quiz else "Untitled"
    return f"{quiz_title} — session {session.code} ({when})"


# ─────────────────────────────────────────────────────────────────
# Excel export
# ─────────────────────────────────────────────────────────────────

# Reusable styles
_HEADER_FILL = PatternFill("solid", start_color="FF7C3AED")  # purple
_HEADER_FONT = Font(name="Arial", bold=True, color="FFFFFFFF", size=12)
_TITLE_FONT  = Font(name="Arial", bold=True, size=16, color="FF1E293B")
_BODY_FONT   = Font(name="Arial", size=11)
_CORRECT_FILL = PatternFill("solid", start_color="FFD1FAE5")  # mint
_CENTER = Alignment(horizontal="center", vertical="center")
_LEFT   = Alignment(horizontal="left", vertical="center", wrap_text=True)


def _style_header_row(sheet, row, columns):
    for col_idx, _ in enumerate(columns, start=1):
        cell = sheet.cell(row=row, column=col_idx)
        cell.fill = _HEADER_FILL
        cell.font = _HEADER_FONT
        cell.alignment = _CENTER


def _autosize(sheet, max_width=48):
    """Best-effort column auto-width based on cell value lengths."""
    for col in sheet.columns:
        # `col` may be a tuple in newer openpyxl; normalize.
        col_cells = list(col)
        if not col_cells:
            continue
        letter = get_column_letter(col_cells[0].column)
        longest = 0
        for cell in col_cells:
            if cell.value is None:
                continue
            length = len(str(cell.value))
            if length > longest:
                longest = length
        sheet.column_dimensions[letter].width = min(max_width, max(10, longest + 2))


def build_excel(session) -> BytesIO:
    """Build a multi-sheet .xlsx workbook for one session and return BytesIO."""
    wb = Workbook()

    # ── Overview sheet ──
    ws = wb.active
    ws.title = "Overview"

    ws["A1"] = "Knock-Knock Game Results"
    ws["A1"].font = _TITLE_FONT
    ws.merge_cells("A1:D1")

    ws["A3"] = "Quiz"
    ws["B3"] = session.quiz.title if session.quiz else "—"
    ws["A4"] = "Session code"
    ws["B4"] = session.code
    ws["A5"] = "Started"
    ws["B5"] = session.created_at.strftime("%Y-%m-%d %H:%M:%S") if session.created_at else "—"
    ws["A6"] = "Ended"
    ws["B6"] = session.ended_at.strftime("%Y-%m-%d %H:%M:%S") if session.ended_at else "—"
    ws["A7"] = "State"
    ws["B7"] = session.get_state_display()

    leaderboard = full_leaderboard(session)
    ws["A9"]  = "Participants"
    ws["B9"]  = len(leaderboard)
    ws["A10"] = "Top scorer"
    podium = top_three_for_session(session)
    ws["B10"] = f"{podium[0]['emoji']} {podium[0]['nickname']} — {podium[0]['score']} pts" if podium else "—"

    for r in range(3, 11):
        ws.cell(row=r, column=1).font = Font(name="Arial", bold=True)
        ws.cell(row=r, column=2).font = _BODY_FONT

    _autosize(ws)

    # ── Leaderboard sheet ──
    lb = wb.create_sheet("Leaderboard")
    headers = ["Rank", "Avatar", "Nickname", "Room", "Score"]
    lb.append(headers)
    _style_header_row(lb, 1, headers)
    for row in leaderboard:
        lb.append([row["rank"], row["emoji"], row["nickname"], row["room_id"], row["score"]])
    # Crown the top three with mint fill.
    for i in range(2, min(5, len(leaderboard) + 2)):
        for col in range(1, 6):
            lb.cell(row=i, column=col).fill = _CORRECT_FILL
    _autosize(lb)
    lb.freeze_panes = "A2"

    # ── Per-question stats sheet ──
    qstats = per_question_stats(session)
    stats_ws = wb.create_sheet("Question Stats")
    stats_headers = ["#", "Question", "Type", "Answers", "Correct", "Correct %", "Avg time (s)"]
    stats_ws.append(stats_headers)
    _style_header_row(stats_ws, 1, stats_headers)
    for idx, s in enumerate(qstats, start=1):
        q = s["question"]
        stats_ws.append([
            idx,
            q.text,
            q.get_question_type_display(),
            s["answer_count"],
            s["correct_count"],
            round(s["correct_pct"], 1),
            round(s["avg_time_ms"] / 1000.0, 2),
        ])
    # Format % column.
    for r in range(2, len(qstats) + 2):
        stats_ws.cell(row=r, column=6).number_format = "0.0\"%\""
    _autosize(stats_ws)
    stats_ws.freeze_panes = "A2"

    # ── One sheet per question with answer distribution + bar chart ──
    used_titles = {"Overview", "Leaderboard", "Question Stats"}
    for idx, s in enumerate(qstats, start=1):
        q = s["question"]
        title = _safe_sheet_title(f"Q{idx} {q.text}")
        # Ensure uniqueness if two questions have the same first 31 chars.
        base = title
        counter = 2
        while title in used_titles:
            suffix = f" ({counter})"
            title = (base[:31 - len(suffix)] + suffix)
            counter += 1
        used_titles.add(title)

        qs = wb.create_sheet(title)
        qs["A1"] = f"Question {idx}: {q.text}"
        qs["A1"].font = _TITLE_FONT
        qs.merge_cells("A1:D1")

        qs["A3"] = "Answers"
        qs["B3"] = s["answer_count"]
        qs["A4"] = "Correct"
        qs["B4"] = s["correct_count"]
        qs["A5"] = "Correct %"
        qs["B5"] = round(s["correct_pct"], 1)
        qs["B5"].number_format = "0.0\"%\""
        qs["A6"] = "Avg time"
        qs["B6"] = f"{round(s['avg_time_ms']/1000.0, 2)} s"

        # Distribution table starts at row 8.
        dist_headers = ["Answer", "Count", "Correct?"]
        for col, header in enumerate(dist_headers, start=1):
            qs.cell(row=8, column=col, value=header)
        _style_header_row(qs, 8, dist_headers)

        for i, (label, count, is_correct) in enumerate(s["distribution"], start=9):
            qs.cell(row=i, column=1, value=label)
            qs.cell(row=i, column=2, value=count)
            qs.cell(row=i, column=3, value="✓" if is_correct else "")
            if is_correct:
                for c in range(1, 4):
                    qs.cell(row=i, column=c).fill = _CORRECT_FILL

        # Native bar chart embedded into the sheet.
        n = len(s["distribution"])
        if n > 0:
            chart = BarChart()
            chart.type = "bar"
            chart.style = 11
            chart.title = "Answer distribution"
            chart.y_axis.title = "Count"
            chart.x_axis.title = "Answer"
            data_ref = Reference(qs, min_col=2, min_row=8, max_row=8 + n, max_col=2)
            cats_ref = Reference(qs, min_col=1, min_row=9, max_row=8 + n)
            chart.add_data(data_ref, titles_from_data=True)
            chart.set_categories(cats_ref)
            chart.dataLabels = DataLabelList(showVal=True)
            chart.height = 9   # cm
            chart.width  = 16  # cm
            qs.add_chart(chart, "E3")

        _autosize(qs, max_width=60)

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf


# ─────────────────────────────────────────────────────────────────
# Word export
# ─────────────────────────────────────────────────────────────────

def _chart_png(labels, values, correct_flags) -> BytesIO | None:
    """Render a horizontal bar chart with matplotlib and return a PNG BytesIO.

    Correct answers are coloured green, incorrect grey. Returns None if
    matplotlib is unavailable so callers can substitute a placeholder.
    """
    if not _HAS_MPL or not labels:
        return None
    colors = ["#10b981" if ok else "#94a3b8" for ok in correct_flags]
    fig, ax = plt.subplots(figsize=(6.2, max(2.2, 0.55 * len(labels) + 1)))
    bars = ax.barh(labels, values, color=colors, edgecolor="white")
    ax.invert_yaxis()
    ax.set_xlabel("Responses")
    for bar, v in zip(bars, values):
        ax.text(bar.get_width() + max(values) * 0.01, bar.get_y() + bar.get_height() / 2,
                str(v), va="center", fontsize=10)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    fig.tight_layout()
    out = BytesIO()
    fig.savefig(out, format="png", dpi=150, bbox_inches="tight")
    plt.close(fig)
    out.seek(0)
    return out


def _add_table_header(table, headers):
    hdr = table.rows[0].cells
    for i, txt in enumerate(headers):
        hdr[i].text = ""
        para = hdr[i].paragraphs[0]
        run = para.add_run(txt)
        run.bold = True
        run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        run.font.size = Pt(11)
        # Purple cell shading via XML — python-docx has no first-class API.
        from docx.oxml.ns import nsdecls
        from docx.oxml import parse_xml
        shading = parse_xml(r'<w:shd {} w:fill="7C3AED"/>'.format(nsdecls("w")))
        hdr[i]._tc.get_or_add_tcPr().append(shading)
        hdr[i].vertical_alignment = WD_ALIGN_VERTICAL.CENTER


def build_word(session) -> BytesIO:
    """Build a .docx report for one session and return BytesIO."""
    doc = Document()

    # Margins
    for section in doc.sections:
        section.top_margin = Cm(1.8)
        section.bottom_margin = Cm(1.8)
        section.left_margin = Cm(1.8)
        section.right_margin = Cm(1.8)

    # ── Cover ──
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title.add_run("Knock-Knock Game Results")
    run.font.size = Pt(26)
    run.font.bold = True
    run.font.color.rgb = RGBColor(0x7C, 0x3A, 0xED)

    subtitle = doc.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub_run = subtitle.add_run(_format_session_label(session))
    sub_run.font.size = Pt(13)
    sub_run.font.color.rgb = RGBColor(0x47, 0x55, 0x69)

    doc.add_paragraph()

    # ── Session metadata table ──
    meta = doc.add_table(rows=4, cols=2)
    meta.style = "Light Grid Accent 4"
    meta.cell(0, 0).text = "Session code";   meta.cell(0, 1).text = session.code
    meta.cell(1, 0).text = "Started";        meta.cell(1, 1).text = session.created_at.strftime("%Y-%m-%d %H:%M:%S") if session.created_at else "—"
    meta.cell(2, 0).text = "Ended";          meta.cell(2, 1).text = session.ended_at.strftime("%Y-%m-%d %H:%M:%S") if session.ended_at else "—"
    meta.cell(3, 0).text = "State";          meta.cell(3, 1).text = session.get_state_display()
    for row in meta.rows:
        row.cells[0].paragraphs[0].runs[0].bold = True

    doc.add_paragraph()

    # ── Top 3 podium ──
    podium = top_three_for_session(session)
    if podium:
        doc.add_heading("🏆 Top scorers", level=1)
        medals = ["👑", "🥈", "🥉"]
        for i, p in enumerate(podium):
            para = doc.add_paragraph()
            r = para.add_run(f"{medals[i]}  {p['emoji']}  {p['nickname']}  —  {p['score']} pts")
            r.font.size = Pt(14)
            if i == 0:
                r.font.bold = True

    # ── Full leaderboard ──
    leaderboard = full_leaderboard(session)
    if leaderboard:
        doc.add_heading("Full leaderboard", level=1)
        table = doc.add_table(rows=1, cols=5)
        table.style = "Light Grid Accent 4"
        _add_table_header(table, ["Rank", "Avatar", "Nickname", "Room", "Score"])
        for p in leaderboard:
            row = table.add_row().cells
            row[0].text = str(p["rank"])
            row[1].text = p["emoji"]
            row[2].text = p["nickname"]
            row[3].text = p["room_id"]
            row[4].text = str(p["score"])
    else:
        doc.add_paragraph("No participants joined this session.").italic = True

    # ── Per-question sections ──
    qstats = per_question_stats(session)
    if qstats:
        doc.add_page_break()
        doc.add_heading("Question breakdown", level=1)

        for idx, s in enumerate(qstats, start=1):
            q = s["question"]
            doc.add_heading(f"Q{idx}. {q.text}", level=2)

            facts = doc.add_paragraph()
            facts.add_run(
                f"Type: {q.get_question_type_display()}   ·   "
                f"Answers: {s['answer_count']}   ·   "
                f"Correct: {s['correct_count']} "
                f"({s['correct_pct']:.1f}%)   ·   "
                f"Avg time: {s['avg_time_ms']/1000.0:.2f}s"
            ).italic = True

            # Distribution table
            dist = s["distribution"]
            if dist:
                table = doc.add_table(rows=1, cols=3)
                table.style = "Light Grid Accent 4"
                _add_table_header(table, ["Answer", "Count", "Correct?"])
                for label, count, is_correct in dist:
                    row = table.add_row().cells
                    row[0].text = label
                    row[1].text = str(count)
                    row[2].text = "✓" if is_correct else ""

                # Bar chart
                labels  = [d[0] for d in dist]
                values  = [d[1] for d in dist]
                flags   = [d[2] for d in dist]
                png = _chart_png(labels, values, flags)
                if png is not None:
                    doc.add_paragraph()  # spacer
                    doc.add_picture(png, width=Inches(6.0))
                else:
                    note = doc.add_paragraph("(chart unavailable — matplotlib not installed on the server)")
                    note.runs[0].italic = True
                    note.runs[0].font.color.rgb = RGBColor(0x94, 0xA3, 0xB8)

            doc.add_paragraph()

    buf = BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf
