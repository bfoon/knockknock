"""
Attendance report downloads: Excel, Word and PDF.

The dashboard's Analytics panel, as a file of its own. It is built from
the same merged people as the attendance list (attendance_exports), so
"52 people" in the report is the same 52 rows in the list.

Each figure appears once:

  * Headline tiles carry the ratios (show-up rate, walk-ins, busiest
    hour, seats filled or typical sign-up lead time).
  * "What stands out" only says things no table or chart already shows
    (pending approvals to act on, the busiest sign-up day, people who
    came every day).
  * The status table carries the raw counts.
  * Charts and tables after that cover sign-ups over time, arrivals by
    hour, attendance by day (multi-day events), check-in methods and
    the choice questions on the registration form.

Charts use matplotlib (already a project dependency). Without it the
report still builds, with tables only.
"""

import io
import statistics
from collections import Counter
from datetime import timedelta

from django.utils import timezone

from .attendance_exports import (
    CYAN, CYAN_DEEP, INK, LINE, MUTED, ROSE, STATUS_LABELS, STATUS_LOOK,
    STATUS_ORDER, VIOLET, VIOLET_DEEP, VIOLET_SOFT,
    PdfShell, answer_text, build_list_context, docx_cell_border,
    docx_cell_margins, docx_fixed_layout, docx_hero, docx_new, docx_row_flags,
    docx_shade, docx_table_borders, docx_text, event_date_range, event_place,
    fmt_day, group_title, hexc, local_time, plural, pdf_styles, timezone_label,
)
from .models import CheckIn, EventField, Registration

MAX_TIMELINE_DAYS = 366
CHOICE_TYPES = (EventField.TYPE_SELECT, EventField.TYPE_MULTI, EventField.TYPE_CHECKBOX)
METHOD_LABELS = dict(CheckIn.METHOD_CHOICES)


# ─────────────────────────── Numbers ───────────────────────────

def _pct(part, whole):
    return round(100 * part / whole) if whole else 0


def build_report_context(event):
    lc = build_list_context(event)
    people = lc["people"]
    counts = lc["counts"]
    total = len(people)
    checked_in = counts.get(Registration.STATUS_CHECKED_IN, 0)
    accepted = checked_in + counts.get(Registration.STATUS_ACCEPTED, 0)
    pending = counts.get(Registration.STATUS_PENDING, 0)
    walk_ins = sum(1 for p in people
                   if p.is_walk_in and p.status == Registration.STATUS_CHECKED_IN)

    # ── Status rows, in list order ─────────────────────────────
    statuses = [{
        "status": s,
        "label": group_title(s, lc["is_over"]),
        "short": STATUS_LABELS[s],
        "count": counts.get(s, 0),
        "share": _pct(counts.get(s, 0), total),
    } for s in STATUS_ORDER]

    # ── Sign-ups over time ─────────────────────────────────────
    today = local_time(timezone.now()).date()
    start = local_time(event.starts_at).date()
    end = local_time(event.ends_at).date() if event.ends_at else start
    reg_dates = [p.registered_at.date() for p in people]
    visit_dates = [d for p in people for d in p.visits]
    first_day = min(reg_dates + [start])
    horizon = min(max([end] + reg_dates + visit_dates), today)
    horizon = max(horizon, first_day)
    if (horizon - first_day).days > MAX_TIMELINE_DAYS:
        first_day = horizon - timedelta(days=MAX_TIMELINE_DAYS)
    regs_per_day = Counter(d for d in reg_dates if first_day <= d <= horizon)
    visits_per_day = Counter(d for d in visit_dates if first_day <= d <= horizon)
    daily, running = [], 0
    cursor = first_day
    while cursor <= horizon:
        running += regs_per_day.get(cursor, 0)
        daily.append({"date": cursor, "registrations": regs_per_day.get(cursor, 0),
                      "arrivals": visits_per_day.get(cursor, 0), "running": running})
        cursor += timedelta(days=1)

    # ── Arrivals ───────────────────────────────────────────────
    visits = [(d, t, m) for p in people for d, (t, m) in p.visits.items()]
    hourly = Counter(t.hour for _, t, _ in visits)
    peak_hour = max(hourly.items(), key=lambda kv: (kv[1], -kv[0])) if hourly else None
    days = lc["days"]
    by_day = []
    if len(days) > 1:
        for d, label in days:
            n = sum(1 for p in people if d in p.visits)
            walk = sum(1 for p in people if d in p.visits and p.is_walk_in)
            by_day.append({"date": d, "label": label or f"{d:%a} {d.day} {d:%b}",
                           "arrived": n, "walk_ins": walk, "share": _pct(n, accepted)})
    methods = Counter(METHOD_LABELS.get(m, "Not recorded") if m else "Not recorded"
                      for _, _, m in visits)
    method_rows = [{"label": k, "count": v, "share": _pct(v, len(visits))}
                   for k, v in methods.most_common()]

    # ── Form answers (choice questions) ────────────────────────
    breakdowns = []
    for f in lc["fields"]:
        if f.field_type not in CHOICE_TYPES:
            continue
        tally, answered = Counter(), 0
        for p in people:
            raw = p.answers.get(f.pk)
            if f.field_type == EventField.TYPE_MULTI:
                parts = [x.strip() for x in (raw or "").split(",") if x.strip()]
                tally.update(parts)
                answered += bool(parts)
            else:
                v = answer_text(f, raw)
                if v:
                    tally[v] += 1
                    answered += 1
        if not tally:
            continue
        items = tally.most_common()
        top, rest = items[:8], items[8:]
        if rest:
            top.append(("Other", sum(c for _, c in rest)))
        breakdowns.append({
            "label": f.label, "multi": f.field_type == EventField.TYPE_MULTI,
            "answered": answered,
            "rows": [{"label": k, "count": v, "share": _pct(v, answered)} for k, v in top],
        })

    # ── Lead time ──────────────────────────────────────────────
    starts = local_time(event.starts_at)
    leads = [(starts - p.registered_at).days for p in people
             if not p.is_walk_in and p.registered_at < starts]
    median_lead = int(statistics.median(leads)) if leads else None

    every_day = None
    past_days = [d for d, _ in days if d <= today]
    if len(past_days) > 1:
        every_day = sum(1 for p in people if all(d in p.visits for d in past_days))

    ctx = {
        "event": event,
        "list": lc,
        "total": total,
        "checked_in": checked_in,
        "accepted": accepted,
        "pending": pending,
        "walk_ins": walk_ins,
        "show_rate": _pct(checked_in, accepted) if accepted else None,
        "capacity": event.capacity or None,
        "statuses": statuses,
        "daily": daily,
        "event_span": (start, end),
        "hourly": hourly,
        "peak_hour": peak_hour,
        "by_day": by_day,
        "methods": method_rows,
        "visit_count": len(visits),
        "breakdowns": breakdowns,
        "median_lead": median_lead,
        "every_day": every_day,
        "past_days": past_days,
        "is_over": lc["is_over"],
        "generated_at": lc["generated_at"],
    }
    ctx["tiles"] = _tiles(ctx)
    ctx["highlights"] = _highlights(ctx)
    return ctx


def _lead_text(days):
    if days is None:
        return "—"
    if days == 0:
        return "Same day"
    return plural(days, "day") + " ahead"


def _tiles(ctx):
    """[(value, label, detail, fg, bg)] — ratios and moments, not raw counts."""
    tiles = [(str(ctx["total"]), "People registered",
              plural(ctx["accepted"], "accepted guest"), VIOLET, VIOLET_SOFT)]
    if ctx["show_rate"] is not None:
        tiles.append((f"{ctx['show_rate']}%", "Show-up rate",
                      f"{ctx['checked_in']} of {ctx['accepted']} checked in",
                      *STATUS_LOOK[Registration.STATUS_CHECKED_IN]))
    else:
        tiles.append(("—", "Show-up rate", "No accepted guests yet",
                      *STATUS_LOOK[Registration.STATUS_CHECKED_IN]))
    tiles.append((str(ctx["walk_ins"]), "Walk-ins",
                  f"{_pct(ctx['walk_ins'], ctx['checked_in'])}% of arrivals" if ctx["checked_in"]
                  else "Nobody has arrived yet", CYAN_DEEP, "CFFAFE"))
    if ctx["peak_hour"]:
        hour, n = ctx["peak_hour"]
        tiles.append((f"{hour:02d}:00", "Busiest hour",
                      plural(n, "check-in"), "BE123C", "FFE4E6"))
    if ctx["capacity"]:
        tiles.append((f"{_pct(ctx['accepted'], ctx['capacity'])}%", "Seats filled",
                      f"{ctx['accepted']} of {ctx['capacity']} seats", "B45309", "FEF3C7"))
    elif ctx["median_lead"] is not None:
        tiles.append((_lead_text(ctx["median_lead"]), "Typical sign-up",
                      "median before the event", "B45309", "FEF3C7"))
    return tiles


def _highlights(ctx):
    """Sentences that add something the tiles, tables and charts don't."""
    out = []
    if ctx["pending"]:
        out.append(f"{plural(ctx['pending'], 'registration')} "
                   f"{'is' if ctx['pending'] == 1 else 'are'} still waiting for your approval.")
    busiest = max(ctx["daily"], key=lambda d: (d["registrations"], d["date"]), default=None)
    if busiest and busiest["registrations"]:
        start = ctx["event_span"][0]
        gap = (start - busiest["date"]).days
        when = ("on the first day of the event" if gap == 0
                else f"{plural(gap, 'day')} before the event" if gap > 0
                else f"{plural(-gap, 'day')} after it started")
        out.append(f"Sign-ups peaked on {fmt_day(busiest['date'])} with "
                   f"{plural(busiest['registrations'], 'registration')}, {when}.")
    if ctx["capacity"] and ctx["median_lead"] is not None:
        out.append(f"Half of the pre-registered guests signed up at least "
                   f"{plural(ctx['median_lead'], 'day')} before the event.")
    if ctx["by_day"]:
        best = max(ctx["by_day"], key=lambda d: d["arrived"])
        if best["arrived"]:
            out.append(f"{best['label']} drew the biggest crowd ({best['arrived']}).")
    if ctx["every_day"] is not None:
        span = (f"all {len(ctx['past_days'])} days" if ctx["is_over"]
                else f"every day so far ({len(ctx['past_days'])} days)")
        out.append(f"{plural(ctx['every_day'], 'person', 'people')} came on {span}.")
    if ctx["is_over"] and ctx["accepted"]:
        no_shows = ctx["accepted"] - ctx["checked_in"]
        if no_shows:
            out.append(f"{plural(no_shows, 'accepted guest')} did not check in. "
                       "Their names are in the attendance list.")
    if not out:
        out.append("Not much to report yet. Numbers fill in as people register and check in.")
    return out


def report_notes(ctx):
    lc = ctx["list"]
    lines = []
    if lc["merged"]:
        lines.append(
            f"Counts are people, not registrations: {plural(lc['merged'], 'duplicate registration')} "
            f"(same email or phone number) {'was' if lc['merged'] == 1 else 'were'} merged, "
            "so totals can be lower than the dashboard's."
        )
    lines.append("Show-up rate is checked-in guests divided by accepted guests (including those who checked in).")
    lines.append(f"Times are in {timezone_label()}.")
    return lines


# ─────────────────────────── Charts (matplotlib) ───────────────────────────

def _mpl_ready():
    try:
        import matplotlib  # noqa: F401
        from matplotlib.figure import Figure  # noqa: F401
        return True
    except Exception:
        return False


def _style_axes(ax):
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(f"#{LINE}")
    ax.tick_params(colors=f"#{MUTED}", labelsize=7, length=0, pad=4)
    ax.yaxis.grid(True, color=f"#{LINE}", linewidth=0.6)
    ax.set_axisbelow(True)


def _png(fig):
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=200, bbox_inches="tight", facecolor="white")
    return buf.getvalue()


def chart_signups(ctx):
    """Daily new registrations (bars) + running total (line)."""
    if not _mpl_ready() or not ctx["total"]:
        return None
    import matplotlib
    from matplotlib.dates import AutoDateLocator, DateFormatter
    from matplotlib.figure import Figure
    from matplotlib.ticker import MaxNLocator

    with matplotlib.rc_context({"font.family": "DejaVu Sans", "font.size": 7.5}):
        fig = Figure(figsize=(7.2, 2.5))
        ax = fig.add_subplot(111)
        dates = [d["date"] for d in ctx["daily"]]
        ax.bar(dates, [d["registrations"] for d in ctx["daily"]], width=0.75,
               color=f"#{VIOLET}", label="New registrations", zorder=2)
        start, end = ctx["event_span"]
        if dates and start <= dates[-1]:
            ax.axvspan(start - timedelta(hours=12), min(end, dates[-1]) + timedelta(hours=12),
                       color=f"#{ROSE}", alpha=0.13, lw=0, zorder=1)
            ax.text(start, 1.02, " Event", transform=ax.get_xaxis_transform(),
                    color="#BE123C", fontsize=7, va="bottom", ha="left")
        _style_axes(ax)
        ax.yaxis.set_major_locator(MaxNLocator(integer=True, nbins=4))
        ax.xaxis.set_major_locator(AutoDateLocator(minticks=3, maxticks=8))
        ax.xaxis.set_major_formatter(DateFormatter("%d %b"))
        ax2 = ax.twinx()
        ax2.plot(dates, [d["running"] for d in ctx["daily"]], color=f"#{CYAN_DEEP}",
                 lw=1.8, label="Running total", zorder=3)
        ax2.set_ylim(bottom=0)
        ax2.yaxis.set_major_locator(MaxNLocator(integer=True, nbins=4))
        for side in ("top", "left", "bottom"):
            ax2.spines[side].set_visible(False)
        ax2.spines["right"].set_color(f"#{LINE}")
        ax2.tick_params(colors=f"#{CYAN_DEEP}", labelsize=7, length=0)
        handles = ax.get_legend_handles_labels()
        extra = ax2.get_legend_handles_labels()
        ax.legend(handles[0] + extra[0], handles[1] + extra[1], loc="upper left",
                  frameon=False, fontsize=7, ncol=2)
        ax.set_ylim(top=max([d["registrations"] for d in ctx["daily"]] + [1]) * 1.35)
        return _png(fig)


def chart_hours(ctx):
    """Check-ins per hour of day; the busiest hour in rose."""
    if not _mpl_ready() or not ctx["hourly"]:
        return None
    import matplotlib
    from matplotlib.figure import Figure
    from matplotlib.ticker import MaxNLocator

    hours = sorted(ctx["hourly"])
    lo, hi = max(hours[0] - 1, 0), min(hours[-1] + 1, 23)
    while hi - lo < 6:
        lo, hi = max(lo - 1, 0), min(hi + 1, 23)
    span = list(range(lo, hi + 1))
    peak = ctx["peak_hour"][0]
    with matplotlib.rc_context({"font.family": "DejaVu Sans", "font.size": 7.5}):
        fig = Figure(figsize=(7.2, 2.3))
        ax = fig.add_subplot(111)
        values = [ctx["hourly"].get(h, 0) for h in span]
        bars = ax.bar([f"{h:02d}:00" for h in span], values, width=0.72,
                      color=[f"#{ROSE}" if h == peak else f"#{VIOLET}" for h in span], zorder=2)
        for bar, v in zip(bars, values):
            if v:
                ax.text(bar.get_x() + bar.get_width() / 2, v, str(v), ha="center",
                        va="bottom", fontsize=6.5, color=f"#{INK}")
        _style_axes(ax)
        ax.yaxis.set_major_locator(MaxNLocator(integer=True, nbins=4))
        ax.set_ylim(top=max(values) * 1.25)
        if len(span) > 12:
            for i, label in enumerate(ax.get_xticklabels()):
                label.set_visible(i % 2 == 0)
        return _png(fig)


# ─────────────────────────── Excel ───────────────────────────

def build_report_xlsx(event):
    from openpyxl import Workbook
    from openpyxl.chart import BarChart, LineChart, Reference
    from openpyxl.formatting.rule import DataBarRule
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

    ctx = build_report_context(event)
    FONT = "Arial"
    wb = Workbook()
    wb.properties.title = f"Attendance report – {event.title}"
    wb.properties.creator = "Knock-Knock"
    wb.calculation.fullCalcOnLoad = True

    band = PatternFill("solid", fgColor=VIOLET)
    accent = PatternFill("solid", fgColor=CYAN)
    head_fill = PatternFill("solid", fgColor=INK)
    thin = Side(style="thin", color=LINE)
    bold = Font(name=FONT, bold=True, color=INK)
    body = Font(name=FONT, color=INK)
    muted = Font(name=FONT, size=9, italic=True, color=MUTED)
    h2 = Font(name=FONT, size=12, bold=True, color=VIOLET_DEEP)

    def title_band(ws, width_cols, subtitle):
        for c in range(1, width_cols + 1):
            ws.cell(1, c).fill = band
            ws.cell(2, c).fill = band
            ws.cell(3, c).fill = accent
        ws.row_dimensions[1].height = 32
        ws.row_dimensions[2].height = 20
        ws.row_dimensions[3].height = 4
        t = ws.cell(1, 1, event.title)
        t.font = Font(name=FONT, size=17, bold=True, color="FFFFFF")
        t.alignment = Alignment(vertical="center", indent=1)
        s = ws.cell(2, 1, subtitle)
        s.font = Font(name=FONT, size=10, color="EDE9FE")
        s.alignment = Alignment(vertical="top", indent=1)
        ws.sheet_view.showGridLines = False

    def header(ws, row, labels, start_col=1, left=("How it is worked out",)):
        for i, label in enumerate(labels, start=start_col):
            c = ws.cell(row, i, label)
            c.font = Font(name=FONT, bold=True, color="FFFFFF")
            c.fill = head_fill
            c.alignment = Alignment(
                horizontal="left" if i == start_col or label in left else "center",
                vertical="center")
        ws.row_dimensions[row].height = 20

    def line(ws, row, ncols):
        for i in range(1, ncols + 1):
            ws.cell(row, i).border = Border(bottom=thin)

    def bars(ws, ref, colour=VIOLET):
        ws.conditional_formatting.add(ref, DataBarRule(
            start_type="num", start_value=0, end_type="max", color=colour,
            showValue=True))

    meta = f"Attendance report   |   {event_date_range(event)}   |   {event_place(event)}"

    # ── Overview ───────────────────────────────────────────────
    ws = wb.active
    ws.title = "Overview"
    title_band(ws, 4, meta)
    for col, w in zip("ABCD", (40, 16, 14, 46)):
        ws.column_dimensions[col].width = w

    row = 5
    ws.cell(row, 1, "Status breakdown").font = h2
    row += 1
    header(ws, row, ["Status", "People", "Share"])
    first_status = row + 1
    status_row = {}
    for s in ctx["statuses"]:
        row += 1
        status_row[s["status"]] = row
        fg, bg = STATUS_LOOK[s["status"]]
        ws.cell(row, 1, s["label"]).font = Font(name=FONT, bold=True, color=fg)
        ws.cell(row, 2, s["count"]).font = body
        ws.cell(row, 2).alignment = Alignment(horizontal="center")
        share = ws.cell(row, 3, f"=IFERROR(B{row}/B${first_status + len(ctx['statuses'])},0)")
        share.number_format = "0%"
        share.font = body
        share.alignment = Alignment(horizontal="center")
        line(ws, row, 3)
    last_status = row
    row += 1
    ws.cell(row, 1, "All people").font = bold
    ws.cell(row, 2, f"=SUM(B{first_status}:B{last_status})").font = bold
    ws.cell(row, 2).alignment = Alignment(horizontal="center")
    ws.cell(row, 3, f"=IFERROR(B{row}/B{row},0)").number_format = "0%"
    ws.cell(row, 3).alignment = Alignment(horizontal="center")
    for i in range(1, 4):
        ws.cell(row, i).border = Border(top=Side(style="thin", color=INK))
    bars(ws, f"B{first_status}:B{last_status}")

    ci = f"B{status_row[Registration.STATUS_CHECKED_IN]}"
    acc = f"B{status_row[Registration.STATUS_ACCEPTED]}"

    row += 2
    ws.cell(row, 1, "Headline").font = h2
    row += 1
    header(ws, row, ["Measure", "Value", "", "How it is worked out"])
    headline = [
        ("Accepted guests", f"=SUM({ci},{acc})", "0", "Checked in + accepted but not checked in"),
        ("Show-up rate", f"=IFERROR({ci}/SUM({ci},{acc}),0)", "0%", "Checked in ÷ accepted guests"),
        ("Walk-ins", ctx["walk_ins"], "0", "Checked in without registering first"),
        ("Walk-in share of arrivals", None, "0%", "Walk-ins ÷ checked in"),
    ]
    if ctx["capacity"]:
        headline += [("Capacity", ctx["capacity"], "0", "Seats set on the event"),
                     ("Seats filled", None, "0%", "Accepted guests ÷ capacity")]
    if ctx["peak_hour"]:
        hour, n = ctx["peak_hour"]
        headline.append(("Busiest arrival hour", f"{hour:02d}:00",
                         "@", f"{plural(n, 'check-in')} in that hour"))
    if ctx["median_lead"] is not None and not ctx["capacity"]:
        headline.append(("Typical sign-up lead time (days)", ctx["median_lead"], "0",
                         "Median days between registering and the event start"))
    rows_by_label = {}
    for label, value, fmt, how in headline:
        row += 1
        rows_by_label[label] = row
        if label == "Walk-in share of arrivals":
            value = f"=IFERROR(B{rows_by_label['Walk-ins']}/{ci},0)"
        if label == "Seats filled":
            value = f"=IFERROR(B{rows_by_label['Accepted guests']}/B{rows_by_label['Capacity']},0)"
        ws.cell(row, 1, label).font = body
        v = ws.cell(row, 2, value)
        v.font = bold
        v.number_format = fmt
        v.alignment = Alignment(horizontal="center")
        ws.cell(row, 4, how).font = muted
        line(ws, row, 4)

    row += 2
    ws.cell(row, 1, "What stands out").font = h2
    for text in ctx["highlights"]:
        row += 1
        ws.cell(row, 1, text).font = body
    row += 2
    for text in report_notes(ctx):
        ws.cell(row, 1, text).font = muted
        row += 1

    # ── Sign-ups ───────────────────────────────────────────────
    ws2 = wb.create_sheet("Sign-ups")
    title_band(ws2, 4, "Registrations per day, with arrivals on each day")
    for col, w in zip("ABCD", (16, 18, 14, 16)):
        ws2.column_dimensions[col].width = w
    header(ws2, 5, ["Date", "New registrations", "Arrivals", "Running total"])
    r = 5
    for d in ctx["daily"]:
        r += 1
        ws2.cell(r, 1, d["date"]).number_format = "ddd d mmm yyyy"
        ws2.cell(r, 2, d["registrations"])
        ws2.cell(r, 3, d["arrivals"])
        ws2.cell(r, 4, f"=B{r}" if r == 6 else f"=D{r - 1}+B{r}")
        for i in range(1, 5):
            ws2.cell(r, i).font = body
            if i > 1:
                ws2.cell(r, i).alignment = Alignment(horizontal="center")
        line(ws2, r, 4)
    ws2.freeze_panes = "A6"
    if r > 5:
        chart = BarChart()
        chart.title = "Sign-ups over time"
        chart.style = 2
        chart.height, chart.width = 7.5, 18
        chart.add_data(Reference(ws2, min_col=2, min_row=5, max_row=r), titles_from_data=True)
        chart.set_categories(Reference(ws2, min_col=1, min_row=6, max_row=r))
        chart.series[0].graphicalProperties.solidFill = VIOLET
        chart.series[0].graphicalProperties.line.solidFill = VIOLET
        chart.x_axis.number_format = "d mmm"
        chart.x_axis.delete = False
        chart.y_axis.delete = False
        chart.y_axis.majorGridlines = None
        total_line = LineChart()
        total_line.add_data(Reference(ws2, min_col=4, min_row=5, max_row=r), titles_from_data=True)
        total_line.series[0].graphicalProperties.line.solidFill = CYAN_DEEP
        total_line.series[0].graphicalProperties.line.width = 28000
        total_line.series[0].smooth = False
        total_line.y_axis.axId = 200
        total_line.y_axis.crosses = "max"
        total_line.y_axis.delete = False
        chart += total_line
        chart.legend.position = "b"
        ws2.add_chart(chart, "F5")

    # ── Arrivals ───────────────────────────────────────────────
    ws3 = wb.create_sheet("Arrivals")
    title_band(ws3, 4, "When people checked in, and how")
    for col, w in zip("ABCD", (30, 14, 14, 16)):
        ws3.column_dimensions[col].width = w
    r = 5
    ws3.cell(r, 1, "Arrivals by hour").font = h2
    r += 1
    header(ws3, r, ["Hour", "Check-ins"])
    hour_first = r + 1
    if ctx["hourly"]:
        lo, hi = min(ctx["hourly"]), max(ctx["hourly"])
        for h in range(lo, hi + 1):
            r += 1
            ws3.cell(r, 1, f"{h:02d}:00–{h:02d}:59").font = body
            ws3.cell(r, 2, ctx["hourly"].get(h, 0)).font = body
            ws3.cell(r, 2).alignment = Alignment(horizontal="center")
            line(ws3, r, 2)
        bars(ws3, f"B{hour_first}:B{r}", ROSE)
        chart = BarChart()
        chart.title = "Arrivals by hour"
        chart.style = 2
        chart.height, chart.width = 7, 16
        chart.legend = None
        chart.add_data(Reference(ws3, min_col=2, min_row=hour_first - 1, max_row=r),
                       titles_from_data=True)
        chart.set_categories(Reference(ws3, min_col=1, min_row=hour_first, max_row=r))
        chart.series[0].graphicalProperties.solidFill = VIOLET
        chart.series[0].graphicalProperties.line.solidFill = VIOLET
        chart.x_axis.delete = False
        chart.y_axis.delete = False
        chart.y_axis.majorGridlines = None
        ws3.add_chart(chart, "F5")
    else:
        r += 1
        ws3.cell(r, 1, "Nobody has checked in yet.").font = muted

    if ctx["by_day"]:
        r += 2
        ws3.cell(r, 1, "Attendance by day").font = h2
        r += 1
        header(ws3, r, ["Day", "Date", "Arrived", "Share of accepted"])
        day_first = r + 1
        for d in ctx["by_day"]:
            r += 1
            ws3.cell(r, 1, d["label"]).font = body
            ws3.cell(r, 2, d["date"]).number_format = "d mmm yyyy"
            ws3.cell(r, 3, d["arrived"])
            ws3.cell(r, 4, f"=IFERROR(C{r}/Overview!$B${rows_by_label['Accepted guests']},0)"
                     ).number_format = "0%"
            for i in range(2, 5):
                ws3.cell(r, i).font = body
                ws3.cell(r, i).alignment = Alignment(horizontal="center")
            line(ws3, r, 4)
        bars(ws3, f"C{day_first}:C{r}")

    if ctx["methods"]:
        r += 2
        ws3.cell(r, 1, "How people checked in").font = h2
        r += 1
        header(ws3, r, ["Method", "Check-ins", "Share"])
        m_first = r + 1
        m_last = m_first + len(ctx["methods"]) - 1
        for m in ctx["methods"]:
            r += 1
            ws3.cell(r, 1, m["label"]).font = body
            ws3.cell(r, 2, m["count"]).font = body
            ws3.cell(r, 3, f"=IFERROR(B{r}/SUM(B${m_first}:B${m_last}),0)").number_format = "0%"
            for i in (2, 3):
                ws3.cell(r, i).alignment = Alignment(horizontal="center")
                ws3.cell(r, i).font = body
            line(ws3, r, 3)
        bars(ws3, f"B{m_first}:B{m_last}", CYAN_DEEP)

    # ── Form answers ───────────────────────────────────────────
    if ctx["breakdowns"]:
        ws4 = wb.create_sheet("Form answers")
        title_band(ws4, 3, "Choice questions on the registration form")
        for col, w in zip("ABC", (44, 12, 12)):
            ws4.column_dimensions[col].width = w
        r = 4
        for b in ctx["breakdowns"]:
            r += 1
            ws4.cell(r, 1, b["label"]).font = h2
            r += 1
            ws4.cell(r, 1, f"{plural(b['answered'], 'person', 'people')} answered"
                     + ("; people could pick more than one" if b["multi"] else "")).font = muted
            r += 1
            header(ws4, r, ["Answer", "People", "Share"])
            a_first = r + 1
            for item in b["rows"]:
                r += 1
                ws4.cell(r, 1, item["label"]).font = body
                ws4.cell(r, 2, item["count"]).font = body
                ws4.cell(r, 2).alignment = Alignment(horizontal="center")
                # Share of people who answered (multi-choice can exceed 100% in total).
                ws4.cell(r, 3, f"=IFERROR(B{r}/{b['answered']},0)").number_format = "0%"
                ws4.cell(r, 3).alignment = Alignment(horizontal="center")
                ws4.cell(r, 3).font = body
                line(ws4, r, 3)
            bars(ws4, f"B{a_first}:B{r}")
            r += 1

    for sheet in wb.worksheets:
        sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
        sheet.page_setup.fitToWidth = 1
        sheet.page_setup.fitToHeight = 0
        sheet.sheet_properties.pageSetUpPr.fitToPage = True
        sheet.oddFooter.right.text = "Page &P of &N"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ─────────────────────────── Word ───────────────────────────

def _docx_bar(cell, fraction, width_cm, colour):
    """A slim proportional bar: a nested two-cell table, filled and empty."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt

    fraction = max(0.0, min(1.0, fraction))
    filled = round(width_cm * fraction, 2)
    parts = [(filled, colour), (round(width_cm - filled, 2), "EEEBF8")]
    parts = [(w, c) for w, c in parts if w >= 0.05] or [(width_cm, "EEEBF8")]
    first = cell.paragraphs[0]
    bar = cell.add_table(rows=1, cols=len(parts))
    docx_fixed_layout(bar, [w for w, _ in parts])
    docx_cell_margins(bar, top=0, bottom=0, left=0, right=0)
    tr_pr = bar.rows[0]._tr.get_or_add_trPr()
    height = OxmlElement("w:trHeight")
    height.set(qn("w:val"), str(int(Cm(0.2).twips)))
    height.set(qn("w:hRule"), "exact")
    tr_pr.append(height)
    for c, (_, colour_hex) in zip(bar.rows[0].cells, parts):
        docx_shade(c, colour_hex)
        p = c.paragraphs[0]
        p.paragraph_format.space_after = Pt(0)
        p.add_run().font.size = Pt(1)
    first._element.getparent().remove(first._element)
    tail = cell.paragraphs[-1]
    tail.paragraph_format.space_after = Pt(0)
    tail.add_run().font.size = Pt(1)


def _docx_bar_table(doc, width_cm, columns, rows, colour=VIOLET):
    """
    columns: [(label, width_cm, align)]; the last column is the bar.
    rows: [([cell texts...], fraction)]
    """
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt
    widths = [w for _, w, _ in columns]
    table = doc.add_table(rows=1 + len(rows), cols=len(columns))
    docx_fixed_layout(table, widths)
    docx_cell_margins(table, top=55, bottom=55, left=90, right=90)
    docx_table_borders(table, inside_h=LINE, outer=LINE)
    for cell, (label, _, align) in zip(table.rows[0].cells, columns):
        docx_shade(cell, INK)
        docx_text(cell, label, size=8.5, bold=True, colour="FFFFFF",
                  align=WD_ALIGN_PARAGRAPH.CENTER if align == "c" else None)
    docx_row_flags(table.rows[0], header=True)
    for r_i, (texts, fraction, *style) in enumerate(rows, start=1):
        row = table.rows[r_i]
        docx_row_flags(row)
        for c_i, (cell, (_, w, align)) in enumerate(zip(row.cells, columns)):
            if c_i == len(columns) - 1:
                _docx_bar(cell, fraction, w - 0.35, colour)
                continue
            text_colour = style[0] if style and c_i == 0 else INK
            docx_text(cell, texts[c_i], size=9, bold=bool(style and c_i == 0),
                      colour=text_colour,
                      align=WD_ALIGN_PARAGRAPH.CENTER if align == "c" else None)
    doc.add_paragraph().paragraph_format.space_after = Pt(0)
    return table


def _docx_h2(doc, text):
    from docx.shared import Pt, RGBColor
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.keep_with_next = True
    r = p.add_run(text)
    r.bold = True
    r.font.size = Pt(12.5)
    r.font.color.rgb = RGBColor.from_string(VIOLET_DEEP)


def _docx_note(doc, text):
    from docx.shared import Pt, RGBColor
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(1)
    r = p.add_run(text)
    r.font.size = Pt(8.5)
    r.font.color.rgb = RGBColor.from_string(MUTED)


def build_report_docx(event):
    from docx.shared import Cm, Pt, RGBColor

    ctx = build_report_context(event)
    doc, width = docx_new(event, landscape_page=False, kind_label="Attendance report")
    docx_hero(doc, event, "Attendance report", width)

    # Tiles
    tiles = ctx["tiles"]
    table = doc.add_table(rows=1, cols=len(tiles))
    docx_fixed_layout(table, [width / len(tiles)] * len(tiles))
    docx_cell_margins(table, top=110, bottom=110, left=130, right=110)
    for cell, (value, label, detail, fg, bg) in zip(table.rows[0].cells, tiles):
        docx_shade(cell, bg)
        for edge in ("left", "right", "top", "bottom"):
            docx_cell_border(cell, edge, "FFFFFF", size=40)
        docx_text(cell, value, size=17 if len(value) < 8 else 12, bold=True, colour=fg)
        docx_text(cell, label, size=8.5, bold=True, colour=INK, new_paragraph=True)
        docx_text(cell, detail, size=7.5, colour=MUTED, new_paragraph=True)

    _docx_h2(doc, "What stands out")
    for text in ctx["highlights"]:
        p = doc.add_paragraph()
        p.paragraph_format.left_indent = Cm(0.45)
        p.paragraph_format.first_line_indent = Cm(-0.45)
        p.paragraph_format.space_after = Pt(3)
        dot = p.add_run("●  ")
        dot.font.color.rgb = RGBColor.from_string(VIOLET)
        dot.font.size = Pt(8)
        p.add_run(text).font.size = Pt(10)

    _docx_h2(doc, "Status breakdown")
    rows = []
    for s in ctx["statuses"]:
        fg, _ = STATUS_LOOK[s["status"]]
        rows.append(([s["label"], str(s["count"]), f"{s['share']}%"],
                     s["share"] / 100, fg))
    _docx_bar_table(doc, width, [("Status", 6.6, "l"), ("People", 2.2, "c"),
                                 ("Share", 2.2, "c"), ("", width - 11.0, "l")], rows)

    png = chart_signups(ctx)
    if png:
        _docx_h2(doc, "Sign-ups over time")
        doc.add_picture(io.BytesIO(png), width=Cm(width))
        _docx_note(doc, "Bars: new registrations per day. Line: running total. "
                        "Shaded: the event itself.")
    png = chart_hours(ctx)
    if png:
        _docx_h2(doc, "Arrivals by hour")
        doc.add_picture(io.BytesIO(png), width=Cm(width))
        _docx_note(doc, "Every check-in on every event day, by the hour it happened. "
                        "The busiest hour is highlighted.")

    if ctx["by_day"]:
        _docx_h2(doc, "Attendance by day")
        rows = [([d["label"], fmt_day(d["date"]), str(d["arrived"]), f"{d['share']}%"],
                 d["share"] / 100) for d in ctx["by_day"]]
        _docx_bar_table(doc, width, [("Day", 4.2, "l"), ("Date", 3.6, "l"),
                                     ("Arrived", 2.0, "c"), ("Of accepted", 2.4, "c"),
                                     ("", width - 12.2, "l")], rows)

    if ctx["methods"]:
        _docx_h2(doc, "How people checked in")
        rows = [([m["label"], str(m["count"]), f"{m['share']}%"], m["share"] / 100)
                for m in ctx["methods"]]
        _docx_bar_table(doc, width, [("Method", 6.6, "l"), ("Check-ins", 2.2, "c"),
                                     ("Share", 2.2, "c"), ("", width - 11.0, "l")],
                        rows, colour=CYAN_DEEP)

    if ctx["breakdowns"]:
        _docx_h2(doc, "Form answers")
        for b in ctx["breakdowns"]:
            p = doc.add_paragraph()
            p.paragraph_format.keep_with_next = True
            p.paragraph_format.space_before = Pt(4)
            p.paragraph_format.space_after = Pt(2)
            r = p.add_run(b["label"])
            r.bold = True
            r.font.size = Pt(10)
            r2 = p.add_run(f"   {plural(b['answered'], 'person', 'people')} answered"
                           + (", more than one choice allowed" if b["multi"] else ""))
            r2.font.size = Pt(8.5)
            r2.font.color.rgb = RGBColor.from_string(MUTED)
            rows = [([i["label"], str(i["count"]), f"{i['share']}%"], i["share"] / 100)
                    for i in b["rows"]]
            _docx_bar_table(doc, width, [("Answer", 6.6, "l"), ("People", 2.2, "c"),
                                         ("Share", 2.2, "c"), ("", width - 11.0, "l")], rows)

    _docx_h2(doc, "Notes")
    for text in report_notes(ctx):
        _docx_note(doc, text)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ─────────────────────────── PDF ───────────────────────────

def _pdf_bar(fraction, width, colour, height=6.5):
    from reportlab.graphics.shapes import Drawing, Rect
    d = Drawing(width, height)
    d.add(Rect(0, 0, width, height, rx=height / 2, ry=height / 2,
               fillColor=hexc("EEEBF8"), strokeColor=None))
    if fraction > 0:
        w = max(width * min(fraction, 1.0), height)
        d.add(Rect(0, 0, w, height, rx=height / 2, ry=height / 2,
                   fillColor=hexc(colour), strokeColor=None))
    return d


def _pdf_bar_table(columns, rows, frame_width, colour=VIOLET):
    """columns: [(label, width_pt or None for the bar, align)]."""
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import Paragraph, Table, TableStyle
    st = pdf_styles()
    fixed = sum(w for _, w, _ in columns if w)
    widths = [w if w else frame_width - fixed for _, w, _ in columns]
    data = [[Paragraph(label, st["head_centre"] if a == "c" else st["head"])
             for label, _, a in columns]]
    for texts, fraction, *style in rows:
        row = []
        for i, (_, w, a) in enumerate(columns):
            if w is None:
                row.append(_pdf_bar(fraction, widths[i] - 10, colour))
                continue
            ps = st["cell_centre"] if a == "c" else st["cell"]
            if style and i == 0:
                ps = ParagraphStyle("lead", parent=st["cell"], textColor=hexc(style[0]),
                                    fontName=pdf_styles()["head"].fontName)
            row.append(Paragraph(texts[i], ps))
        data.append(row)
    t = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), hexc(INK)),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, hexc(LINE)),
        ("TOPPADDING", (0, 0), (-1, -1), 4.2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.2),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def build_report_pdf(event):
    from xml.sax.saxutils import escape
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (CondPageBreak, Image, KeepTogether, Paragraph,
                                    Spacer, Table, TableStyle)

    ctx = build_report_context(event)
    shell = PdfShell(event, "Attendance report", landscape_page=False)
    st = pdf_styles()
    fonts = shell.fonts
    fw = shell.frame_width
    story = []

    # Tiles
    tiles = ctx["tiles"]
    gap = 3 * mm
    tile_w = (fw - gap * (len(tiles) - 1)) / len(tiles)
    cells, widths = [], []
    for i, (value, label, detail, fg, bg) in enumerate(tiles):
        big = ParagraphStyle("tv", fontName=fonts["bold"], textColor=hexc(fg),
                             fontSize=19 if len(value) < 7 else 12.5,
                             leading=22 if len(value) < 7 else 15)
        tile = Table([[Paragraph(escape(value), big)],
                      [Paragraph(escape(label), ParagraphStyle(
                          "tl", fontName=fonts["bold"], fontSize=8, leading=10,
                          textColor=hexc(INK)))],
                      [Paragraph(escape(detail), ParagraphStyle(
                          "td", fontName=fonts["regular"], fontSize=7, leading=9,
                          textColor=hexc(MUTED)))]],
                     colWidths=[tile_w], rowHeights=[24, 11, 13])
        tile.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), hexc(bg)),
            ("ROUNDEDCORNERS", [7, 7, 7, 7]),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, 0), 7),
            ("TOPPADDING", (0, 1), (-1, -1), 1),
            ("BOTTOMPADDING", (0, 0), (-1, -2), 0),
            ("BOTTOMPADDING", (0, -1), (-1, -1), 9),
            ("VALIGN", (0, 0), (-1, 0), "BOTTOM"),
            ("VALIGN", (0, 1), (-1, -1), "TOP"),
        ]))
        if i:
            cells.append("")
            widths.append(gap)
        cells.append(tile)
        widths.append(tile_w)
    row = Table([cells], colWidths=widths, hAlign="LEFT")
    row.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0),
                             ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                             ("TOPPADDING", (0, 0), (-1, -1), 0),
                             ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
                             ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story += [row, Spacer(1, 2 * mm)]

    story.append(Paragraph("What stands out", st["h2"]))
    bullet = ParagraphStyle("hl", parent=st["body"], leftIndent=12, bulletIndent=0,
                            spaceAfter=3, bulletFontName=fonts["regular"],
                            bulletFontSize=7, bulletColor=hexc(VIOLET))
    for text in ctx["highlights"]:
        story.append(Paragraph(escape(text), bullet, bulletText=fonts["dot"]))

    story.append(Paragraph("Status breakdown", st["h2"]))
    rows = [([escape(s["label"]), str(s["count"]), f"{s['share']}%"],
             s["share"] / 100, STATUS_LOOK[s["status"]][0]) for s in ctx["statuses"]]
    story.append(_pdf_bar_table([("Status", 62 * mm, "l"), ("People", 20 * mm, "c"),
                                 ("Share", 20 * mm, "c"), ("", None, "l")], rows, fw))

    png = chart_signups(ctx)
    if png:
        img = Image(io.BytesIO(png))
        img.drawHeight = fw * img.imageHeight / img.imageWidth
        img.drawWidth = fw
        story.append(KeepTogether([
            Paragraph("Sign-ups over time", st["h2"]), img,
            Paragraph("Bars: new registrations per day. Line: running total. "
                      "Shaded: the event itself.", st["note"]),
        ]))
    png = chart_hours(ctx)
    if png:
        img = Image(io.BytesIO(png))
        img.drawHeight = fw * img.imageHeight / img.imageWidth
        img.drawWidth = fw
        story.append(KeepTogether([
            Paragraph("Arrivals by hour", st["h2"]), img,
            Paragraph("Every check-in on every event day, by the hour it happened. "
                      "The busiest hour is highlighted.", st["note"]),
        ]))

    if ctx["by_day"]:
        rows = [([escape(d["label"]), fmt_day(d["date"]), str(d["arrived"]), f"{d['share']}%"],
                 d["share"] / 100) for d in ctx["by_day"]]
        story.append(KeepTogether([
            Paragraph("Attendance by day", st["h2"]),
            _pdf_bar_table([("Day", 40 * mm, "l"), ("Date", 34 * mm, "l"),
                            ("Arrived", 18 * mm, "c"), ("Of accepted", 22 * mm, "c"),
                            ("", None, "l")], rows, fw),
        ]))

    if ctx["methods"]:
        rows = [([escape(m["label"]), str(m["count"]), f"{m['share']}%"], m["share"] / 100)
                for m in ctx["methods"]]
        story.append(KeepTogether([
            Paragraph("How people checked in", st["h2"]),
            _pdf_bar_table([("Method", 62 * mm, "l"), ("Check-ins", 20 * mm, "c"),
                            ("Share", 20 * mm, "c"), ("", None, "l")], rows, fw, CYAN_DEEP),
        ]))

    if ctx["breakdowns"]:
        story.append(CondPageBreak(60 * mm))
        story.append(Paragraph("Form answers", st["h2"]))
        sub = ParagraphStyle("q", parent=st["body"], fontName=fonts["bold"], fontSize=9.5,
                             spaceBefore=6, spaceAfter=3)
        for b in ctx["breakdowns"]:
            meta = (f'&nbsp;&nbsp;&nbsp;<font name="{fonts["regular"]}" size="7.8" '
                    f'color="#{MUTED}">{plural(b["answered"], "person", "people")} answered'
                    f'{", more than one choice allowed" if b["multi"] else ""}</font>')
            rows = [([escape(i["label"]), str(i["count"]), f"{i['share']}%"], i["share"] / 100)
                    for i in b["rows"]]
            story.append(KeepTogether([
                Paragraph(escape(b["label"]) + meta, sub),
                _pdf_bar_table([("Answer", 62 * mm, "l"), ("People", 20 * mm, "c"),
                                ("Share", 20 * mm, "c"), ("", None, "l")], rows, fw),
            ]))

    story.append(Paragraph("Notes", st["h2"]))
    for text in report_notes(ctx):
        story.append(Paragraph(escape(text), st["note"]))
    return shell.build(story)
