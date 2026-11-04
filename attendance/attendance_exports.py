"""
Attendance list downloads: Excel, Word, PDF and CSV.

The event dashboard shows the roster as a scrolling list of cards. These
builders turn the same people into a proper table that can be filed,
printed, emailed or opened in a spreadsheet.

Two rules shape every format.

  * One row per person. Registrations that are clearly the same person
    (same email or same phone number, with a matching or missing name)
    are merged, e.g. someone who cancelled and registered again. People
    who merely share a phone (a family, a team) keep separate rows
    because their names differ. Every merge is stated in the file.

  * One column per fact. The form's Name / Email / Phone questions are
    already the Name, Email and Phone columns, so they are not repeated.
    A question everyone answered identically is stated once in the
    notes instead of filling a column; a question nobody answered is
    left out. In the Word and PDF versions the table is grouped by
    status, so the status is the group heading rather than a column.
    Multi-day events get one column per day (arrival time) instead of a
    log of check-ins.

`build_list_context()` does that work once; the builders only lay it
out. The analytics report (attendance_report_exports.py) reuses the
same merged people, so the two files always agree.

Every builder returns raw bytes. The view wraps them in a response.
"""

import csv
import io
import os
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from itertools import combinations
from xml.sax.saxutils import escape

from django.conf import settings
from django.utils import timezone
from django.utils.text import slugify

from .models import AttendanceEvent, EventField, Registration


# ─────────────────────────── Look & feel ───────────────────────────
# Knock-Knock's violet / cyan, pulled onto a light page so it prints.

INK = "1E1B4B"          # body text: deep indigo, not flat black
MUTED = "6B6886"
LINE = "E4E1F2"
ZEBRA = "F8F7FD"
VIOLET = "7C3AED"
VIOLET_DEEP = "4C1D95"
VIOLET_SOFT = "EDE9FE"
CYAN = "22D3EE"
CYAN_DEEP = "0E7490"
ROSE = "FB7185"

STATUS_ORDER = (
    Registration.STATUS_CHECKED_IN,
    Registration.STATUS_ACCEPTED,
    Registration.STATUS_PENDING,
    Registration.STATUS_DECLINED,
    Registration.STATUS_CANCELLED,
)
STATUS_LABELS = dict(Registration.STATUS_CHOICES)

# (text colour, tint) per status.
STATUS_LOOK = {
    Registration.STATUS_CHECKED_IN: ("047857", "D1FAE5"),
    Registration.STATUS_ACCEPTED:   ("6D28D9", "EDE9FE"),
    Registration.STATUS_PENDING:    ("B45309", "FEF3C7"),
    Registration.STATUS_DECLINED:   ("BE123C", "FFE4E6"),
    Registration.STATUS_CANCELLED:  ("4B5563", "ECEDF1"),
}

IDENTITY_PRESETS = ("full_name", "email", "phone")
LONG_TYPES = (EventField.TYPE_TEXTAREA,)

# More event days than this and per-day columns stop being readable;
# the list falls back to "First arrival" + "Days attended".
MAX_DAY_COLUMNS = 10


def status_rank(status):
    try:
        return STATUS_ORDER.index(status)
    except ValueError:
        return len(STATUS_ORDER)


# ─────────────────────────── Small helpers ───────────────────────────

def local_time(dt):
    """Aware datetime → project-local datetime (same as the dashboard)."""
    if dt is None:
        return None
    if timezone.is_naive(dt):
        return dt
    return timezone.localtime(dt)


def naive(dt):
    """Excel cells can't hold timezone-aware datetimes."""
    return dt.replace(tzinfo=None) if dt is not None else None


def fmt_day(d, *, year=True, weekday=True):
    """'Tue 4 Nov 2026' without platform-specific strftime flags."""
    parts = []
    if weekday:
        parts.append(f"{d:%a}")
    parts.append(f"{d.day} {d:%b}")
    if year:
        parts.append(f"{d.year}")
    return " ".join(parts)


def fmt_stamp(dt, ref_year=None):
    """'3 Nov, 14:05' — the year only appears when it isn't the event's."""
    text = f"{dt.day} {dt:%b}"
    if ref_year is not None and dt.year != ref_year:
        text += f" {dt.year}"
    return f"{text}, {dt:%H:%M}"


def event_date_range(event):
    s, e = local_time(event.starts_at), local_time(event.ends_at)
    if e is None or s.date() == e.date():
        end = f"–{e:%H:%M}" if e else ""
        return f"{fmt_day(s)}, {s:%H:%M}{end}"
    if s.year == e.year:
        return f"{fmt_day(s, year=False)} – {fmt_day(e)}"
    return f"{fmt_day(s)} – {fmt_day(e)}"


def event_place(event):
    if event.is_online:
        return "Online"
    if event.location:
        return event.location
    venue = getattr(event, "venue", None)
    return getattr(venue, "name", "") or "Location to be announced"


def event_is_over(event):
    return (event.status == AttendanceEvent.STATUS_ENDED
            or (event.ends_at and timezone.now() > event.ends_at))


def timezone_label():
    return getattr(settings, "TIME_ZONE", "UTC") or "UTC"


def plural(n, one, many=None):
    return f"{n} {one if n == 1 else (many or one + 's')}"


def join_quoted(labels):
    quoted = [f"“{label}”" for label in labels]
    if len(quoted) <= 1:
        return "".join(quoted)
    return ", ".join(quoted[:-1]) + " and " + quoted[-1]


def export_filename(event, kind, ext):
    """`attendance-list-gambia-youth-summit.pdf`."""
    slug = slugify(event.title or "")[:60].strip("-") or f"event-{event.pk}"
    return f"{kind}-{slug}.{ext}"


def _fold(text):
    """Case-, accent- and whitespace-insensitive form for comparisons."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return " ".join(text.casefold().split())


def _name_key(text):
    """'Jallow  Awa' and 'awa jallow' compare equal."""
    return " ".join(sorted(_fold(text).split()))


def _digits(phone):
    d = re.sub(r"\D", "", phone or "")
    return d[2:] if d.startswith("00") else d


def _phones_match(a, b):
    """+220 700 1234 and 7001234 are the same line; 7 digits minimum."""
    if len(a) < 7 or len(b) < 7:
        return False
    return a.endswith(b) or b.endswith(a)


def answer_text(field, value):
    """A stored answer as a person would read it."""
    v = (value or "").strip()
    if not v:
        return ""
    if field.field_type == EventField.TYPE_CHECKBOX:
        return "Yes" if v.lower() in ("true", "on", "1", "yes") else "No"
    if field.field_type == EventField.TYPE_DATE:
        try:
            d = date.fromisoformat(v[:10])
            return f"{d.day} {d:%b %Y}"
        except ValueError:
            return v
    return v


# ─────────────────────────── People (merged) ───────────────────────────

class Person:
    """
    One human on the list, built from one or more Registration rows.

    The "primary" registration is the most advanced one (checked in >
    accepted > pending > declined > cancelled, then the earliest). It
    supplies the status, walk-in flag and registration time; blanks are
    filled from the others. Check-ins from every merged registration
    count, keeping the earliest arrival per day.
    """

    def __init__(self, registrations):
        regs = sorted(
            registrations,
            key=lambda r: (status_rank(r.status), r.registered_at, r.pk),
        )
        self.registrations = regs
        self.primary = p = regs[0]
        self.merged = len(regs) - 1
        self.no = 0

        def first(attr):
            for r in regs:
                v = (getattr(r, attr) or "").strip()
                if v:
                    return v
            return ""

        def best_name():
            # "Lamin Ceesay" beats "lamin  CEESAY" typed in a hurry.
            names = [" ".join((r.full_name or "").split()) for r in regs]
            names = [n for n in names if n]
            if not names:
                return ""
            def tidy(n):
                return sum(1 for w in n.split() if w[:1].isupper() and w[1:] == w[1:].lower())
            return max(names, key=lambda n: (tidy(n), len(n)))

        def best_phone():
            # Keep the most complete form, e.g. with the +220 prefix.
            phones = [(r.phone or "").strip() for r in regs if (r.phone or "").strip()]
            return max(phones, key=lambda ph: len(_digits(ph))) if phones else ""

        self.name = best_name()
        self.email = first("email")
        self.phone = best_phone()
        self.status = p.status
        self.status_label = STATUS_LABELS.get(p.status, p.status)
        self.is_walk_in = p.is_walk_in
        self.registered_at = local_time(p.registered_at)

        self.answers = {}
        for r in regs:
            for a in r.answers.all():
                if not (self.answers.get(a.field_id) or "").strip():
                    self.answers[a.field_id] = a.value

        # date → (local arrival time, check-in method)
        self.visits = {}
        for r in regs:
            rows = list(r.check_ins.all())
            for c in rows:
                t = local_time(c.checked_in_at)
                current = self.visits.get(c.day)
                if current is None or t < current[0]:
                    self.visits[c.day] = (t, c.method)
            # Rows checked in before per-day check-ins existed only
            # carry Registration.checked_in_at.
            if r.checked_in_at and not rows:
                t = local_time(r.checked_in_at)
                self.visits.setdefault(t.date(), (t, ""))

    @property
    def display_name(self):
        return self.name or self.email or self.phone or f"Guest #{self.primary.pk}"

    @property
    def first_arrival(self):
        times = [t for t, _ in self.visits.values()]
        return min(times) if times else None

    def arrival_on(self, day):
        visit = self.visits.get(day)
        return visit[0] if visit else None


def merge_registrations(registrations):
    """
    Group registrations that belong to the same person.

    Same email, or the same phone line (see _phones_match), joins two
    registrations unless both carry names and the names differ: one
    family phone used by three children must stay three rows. Name
    compatibility is checked per group, so a nameless row can't chain
    two differently-named people together.
    """
    regs = list(registrations)
    parent = list(range(len(regs)))
    group_name = [_name_key(r.full_name) for r in regs]

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra == rb:
            return
        na, nb = group_name[ra], group_name[rb]
        if na and nb and na != nb:
            return
        parent[rb] = ra
        group_name[ra] = na or nb

    by_email = defaultdict(list)
    by_phone_tail = defaultdict(list)
    digits = [_digits(r.phone) for r in regs]
    for i, r in enumerate(regs):
        email = (r.email or "").strip().lower()
        if email:
            by_email[email].append(i)
        if len(digits[i]) >= 7:
            by_phone_tail[digits[i][-7:]].append(i)

    for group in by_email.values():
        for a, b in combinations(group, 2):
            union(a, b)
    for group in by_phone_tail.values():
        for a, b in combinations(group, 2):
            if _phones_match(digits[a], digits[b]):
                union(a, b)

    clusters = defaultdict(list)
    for i, r in enumerate(regs):
        clusters[find(i)].append(r)
    return [Person(group) for group in clusters.values()]


# ─────────────────────────── Columns ───────────────────────────

class Column:
    """
    One column of the list.

    kind:  no | text | email | phone | status | datetime | clock | count
           | answer | long
    width: preferred width in centimetres (Word/PDF scale it to the page)
    value: person → raw value (str, datetime, int or None)
    """

    def __init__(self, key, label, kind, width, value, *, in_grouped=True, doc_label=None):
        self.key = key
        self.label = label
        # Word/PDF header text; may contain a line break ("Day 1\nWed 28 Oct").
        self.doc_label = doc_label or label
        self.kind = kind
        self.width = width
        self.value = value
        self.in_grouped = in_grouped


def event_days(event, people):
    """
    The calendar days attendance is tracked on: agenda days, the
    event's own days (multi-day events without an agenda) and any day
    someone actually checked in. Returns [(date, label)].
    """
    labels = {}
    for d in event.agenda_days.all():
        if not labels.get(d.date):
            labels[d.date] = d.label
    dates = set(labels)
    start = local_time(event.starts_at).date()
    end = local_time(event.ends_at).date() if event.ends_at else start
    if not dates and start < end and (end - start).days < MAX_DAY_COLUMNS:
        dates.update(start + timedelta(days=n) for n in range((end - start).days + 1))
    for p in people:
        dates.update(p.visits)
    return [(d, labels.get(d, "")) for d in sorted(dates)]


def day_heading(day, label):
    short = f"{day:%a} {day.day} {day:%b}"
    return f"{label} ({day.day} {day:%b})" if label else short


def _repeats_identity(person, text):
    t = _fold(text)
    if not t:
        return True
    if person.email and t == person.email.strip().lower():
        return True
    if person.name and _name_key(text) == _name_key(person.name):
        return True
    d = _digits(text)
    if person.phone and len(d) >= 7 and _phones_match(d, _digits(person.phone)):
        return True
    return False


def plan_columns(event, people, fields, days):
    """
    Decide which columns carry information. Returns (columns, notes)
    where notes records what was folded away and why.
    """
    notes = {"same_for_all": [], "repeats": [], "unanswered": []}
    cols = [
        Column("no", "#", "no", 0.8, lambda p: p.no),
        Column("name", "Name", "text", 4.0, lambda p: p.display_name),
    ]
    if any(p.email for p in people):
        cols.append(Column("email", "Email", "email", 4.8, lambda p: p.email))
    if any(p.phone for p in people):
        cols.append(Column("phone", "Phone", "phone", 2.8, lambda p: p.phone))
    cols.append(Column("status", "Status", "status", 2.4,
                       lambda p: p.status_label, in_grouped=False))
    if any(p.is_walk_in for p in people):
        cols.append(Column(
            "source", "How they joined", "text", 2.6,
            lambda p: "Walk-in" if p.is_walk_in else "Pre-registered",
        ))
    cols.append(Column("registered", "Registered", "datetime", 2.8,
                       lambda p: p.registered_at))

    day_dates = [d for d, _ in days]
    if 1 < len(days) <= MAX_DAY_COLUMNS:
        for d, label in days:
            cols.append(Column(
                f"day:{d.isoformat()}", day_heading(d, label), "clock", 2.0,
                lambda p, d=d: p.arrival_on(d),
                doc_label=(f"{label}\n{d:%a} {d.day} {d:%b}" if label
                           else f"{d:%a}\n{d.day} {d:%b}"),
            ))
        cols.append(Column(
            "days", "Days attended", "count", 2.0,
            lambda p: sum(1 for d in day_dates if d in p.visits),
        ))
    elif len(days) > MAX_DAY_COLUMNS:
        cols.append(Column("arrived", "First arrival", "datetime", 2.8,
                           lambda p: p.first_arrival))
        cols.append(Column("days", "Days attended", "count", 2.0,
                           lambda p: len(p.visits)))
    else:
        cols.append(Column("arrived", "Arrived", "clock", 1.9,
                           lambda p: p.first_arrival))

    for f in fields:
        if f.preset_key in IDENTITY_PRESETS:
            continue
        values = [answer_text(f, p.answers.get(f.pk)) for p in people]
        filled = [v for v in values if v]
        if not filled:
            notes["unanswered"].append(f.label)
            continue
        if all(_repeats_identity(p, v) for p, v in zip(people, values) if v):
            notes["repeats"].append(f.label)
            continue
        if len(people) >= 2 and len(filled) == len(people) and len(set(filled)) == 1:
            notes["same_for_all"].append((f.label, filled[0]))
            continue
        long = f.field_type in LONG_TYPES
        cols.append(Column(
            f"field:{f.pk}", f.label, "long" if long else "answer",
            4.2 if long else 3.0,
            lambda p, f=f: answer_text(f, p.answers.get(f.pk)),
        ))
    fit_widths(cols, people)
    return cols, notes


def fit_widths(cols, people):
    """
    Preferred widths (cm) from content: roughly the 90th-percentile
    value length, kept between a floor that fits the header's longest
    word and a ceiling for the column's kind. Word/PDF scale the result
    to the page, so these are proportions as much as sizes.
    """
    ceilings = {"text": 4.4, "email": 5.0, "phone": 2.9, "answer": 3.8, "long": 5.2}
    for c in cols:
        if c.kind not in ceilings:
            continue
        lengths = sorted(len(str(c.value(p) or "")) for p in people) or [0]
        typical = lengths[int(0.9 * (len(lengths) - 1))]
        longest_word = max((len(w) for w in c.label.split()), default=4)
        want = 0.17 * typical + 0.45
        floor = max(1.6, 0.2 * longest_word + 0.4)
        c.width = round(max(floor, min(want, ceilings[c.kind])), 2)


# ─────────────────────────── Context ───────────────────────────

def group_title(status, is_over):
    return {
        Registration.STATUS_CHECKED_IN: "Checked in",
        Registration.STATUS_ACCEPTED: ("Accepted, did not check in" if is_over
                                       else "Accepted, not checked in yet"),
        Registration.STATUS_PENDING: "Waiting for approval",
        Registration.STATUS_DECLINED: "Declined",
        Registration.STATUS_CANCELLED: "Cancelled",
    }.get(status, STATUS_LABELS.get(status, status))


def chip_label(status, is_over):
    return {
        Registration.STATUS_CHECKED_IN: "checked in",
        Registration.STATUS_ACCEPTED: "no-shows" if is_over else "not arrived",
        Registration.STATUS_PENDING: "pending",
        Registration.STATUS_DECLINED: "declined",
        Registration.STATUS_CANCELLED: "cancelled",
    }.get(status, status)


def build_list_context(event):
    regs = (
        event.registrations
        .prefetch_related("answers", "check_ins")
        .order_by("registered_at", "pk")
    )
    reg_count = regs.count()
    people = merge_registrations(regs)
    people.sort(key=lambda p: (status_rank(p.status), _fold(p.display_name),
                               p.registered_at))
    for i, p in enumerate(people, start=1):
        p.no = i

    fields = list(event.fields.all().order_by("order", "id"))
    days = event_days(event, people)
    columns, notes = plan_columns(event, people, fields, days)
    is_over = event_is_over(event)

    counts = Counter(p.status for p in people)
    groups = []
    for status in STATUS_ORDER:
        members = [p for p in people if p.status == status]
        if members:
            groups.append((status, group_title(status, is_over), members))

    return {
        "event": event,
        "people": people,
        "groups": groups,
        "columns": columns,
        "fields": fields,
        "days": days,
        "notes": notes,
        "counts": counts,
        "registration_count": reg_count,
        "merged": reg_count - len(people),
        "is_over": is_over,
        "ref_year": local_time(event.starts_at).year,
        "generated_at": local_time(timezone.now()),
    }


def note_lines(ctx):
    """Plain-language notes on what was merged or folded away."""
    lines = []
    if ctx["merged"]:
        lines.append(
            f"{plural(ctx['merged'], 'duplicate registration')} "
            f"{'was' if ctx['merged'] == 1 else 'were'} merged into the person "
            f"{'it belongs' if ctx['merged'] == 1 else 'they belong'} to "
            "(same email or phone number)."
        )
    for label, value in ctx["notes"]["same_for_all"]:
        lines.append(
            f"Everyone answered “{value}” to “{label}”, so it is stated here "
            "instead of on every row."
        )
    if ctx["notes"]["repeats"]:
        labels = ctx["notes"]["repeats"]
        lines.append(
            f"{join_quoted(labels)} {'repeats' if len(labels) == 1 else 'repeat'} "
            "the name, email or phone already shown, so "
            f"{'it is' if len(labels) == 1 else 'they are'} not listed again."
        )
    if ctx["notes"]["unanswered"]:
        lines.append(f"Nobody answered {join_quoted(ctx['notes']['unanswered'])}.")
    lines.append(f"Times are in {timezone_label()}.")
    return lines


def cell_text(col, person, ctx):
    """A cell as display text for Word / PDF."""
    v = col.value(person)
    if v is None or v == "":
        return ""
    if col.kind == "datetime":
        return fmt_stamp(v, ctx["ref_year"])
    if col.kind == "clock":
        return f"{v:%H:%M}"
    if col.kind == "count":
        if col.key == "days" and 1 < len(ctx["days"]) <= MAX_DAY_COLUMNS:
            return f"{v} of {len(ctx['days'])}"
        return str(v)
    return str(v)


def grouped_columns(ctx):
    return [c for c in ctx["columns"] if c.in_grouped]


def chunk_columns(columns, capacity_cm):
    """
    Split columns across several tables when they can't share one page
    width. # and Name lead every chunk so each row stays identifiable.
    """
    keys = [c for c in columns if c.key in ("no", "name")]
    rest = [c for c in columns if c.key not in ("no", "name")]
    key_w = sum(c.width for c in keys)
    chunks, current, width = [], [], key_w
    for c in rest:
        if current and width + c.width > capacity_cm:
            chunks.append(keys + current)
            current, width = [], key_w
        current.append(c)
        width += c.width
    chunks.append(keys + current)
    return chunks


def scaled_widths(columns, total_cm):
    raw = sum(c.width for c in columns) or 1
    return [c.width * total_cm / raw for c in columns]


# ─────────────────────────── CSV ───────────────────────────

def build_attendance_csv(event):
    """Flat, machine-friendly version: one row per person, ISO times."""
    ctx = build_list_context(event)
    out = io.StringIO()
    out.write("\ufeff")  # BOM so Excel reads accented names correctly
    writer = csv.writer(out)
    writer.writerow([c.label for c in ctx["columns"]])
    for p in ctx["people"]:
        row = []
        for c in ctx["columns"]:
            v = c.value(p)
            if isinstance(v, datetime):
                v = v.strftime("%Y-%m-%d %H:%M")
            row.append("" if v is None else v)
        writer.writerow(row)
    return out.getvalue().encode("utf-8")


# ─────────────────────────── Excel ───────────────────────────

def _unique_headers(columns):
    seen, out = Counter(), []
    for c in columns:
        label = (c.label or "Column").strip() or "Column"
        seen[label.lower()] += 1
        out.append(label if seen[label.lower()] == 1 else f"{label} ({seen[label.lower()]})")
    return out


def build_attendance_xlsx(event):
    """
    One sheet, one Excel table: sortable, filterable, frozen header.
    The counts above the table are formulas over the Status column, so
    they stay right if someone edits a status by hand.
    """
    from openpyxl import Workbook
    from openpyxl.comments import Comment
    from openpyxl.formatting.rule import CellIsRule
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.table import Table, TableStyleInfo

    ctx = build_list_context(event)
    cols, people = ctx["columns"], ctx["people"]
    n = len(cols)
    last_col = get_column_letter(n)
    FONT = "Arial"

    wb = Workbook()
    wb.properties.title = f"Attendance list – {event.title}"
    wb.properties.creator = "Knock-Knock"
    wb.calculation.fullCalcOnLoad = True
    ws = wb.active
    ws.title = "Attendance"
    ws.sheet_view.showGridLines = False

    band = PatternFill("solid", fgColor=VIOLET)
    accent = PatternFill("solid", fgColor=CYAN)
    head_fill = PatternFill("solid", fgColor=INK)
    thin = Side(style="thin", color=LINE)

    # ── Title band ─────────────────────────────────────────────
    for c in range(1, n + 1):
        ws.cell(1, c).fill = band
        ws.cell(2, c).fill = band
        ws.cell(3, c).fill = accent
    ws.row_dimensions[1].height = 32
    ws.row_dimensions[2].height = 20
    ws.row_dimensions[3].height = 4
    t = ws.cell(1, 1, event.title)
    t.font = Font(name=FONT, size=17, bold=True, color="FFFFFF")
    t.alignment = Alignment(vertical="center", indent=1)
    m = ws.cell(2, 1, f"Attendance list   |   {event_date_range(event)}   |   {event_place(event)}")
    m.font = Font(name=FONT, size=10, color="EDE9FE")
    m.alignment = Alignment(vertical="top", indent=1)

    header_row = 7
    first = header_row + 1
    last = header_row + len(people)

    # ── Count chips (formulas over the Status column) ──────────
    status_idx = next(i for i, c in enumerate(cols, start=1) if c.key == "status")
    status_col = get_column_letter(status_idx)
    name_col = get_column_letter(2)
    if people:
        chips = [(f'=COUNTA({name_col}{first}:{name_col}{last})&" people"', VIOLET, VIOLET_SOFT)]
        for s in STATUS_ORDER:
            if ctx["counts"].get(s):
                fg, bg = STATUS_LOOK[s]
                chips.append((
                    f'=COUNTIF({status_col}{first}:{status_col}{last},"{STATUS_LABELS[s]}")'
                    f'&" {chip_label(s, ctx["is_over"])}"', fg, bg,
                ))
        for i, (formula, fg, bg) in enumerate(chips[: max(n - 1, 1)], start=2):
            cell = ws.cell(5, i, formula)
            cell.font = Font(name=FONT, size=10, bold=True, color=fg)
            cell.fill = PatternFill("solid", fgColor=bg)
            cell.alignment = Alignment(horizontal="center", vertical="center")
        ws.row_dimensions[5].height = 22

    # ── Header ─────────────────────────────────────────────────
    headers = _unique_headers(cols)
    for i, label in enumerate(headers, start=1):
        cell = ws.cell(header_row, i, label)
        cell.font = Font(name=FONT, size=10, bold=True, color="FFFFFF")
        cell.fill = head_fill
        cell.alignment = Alignment(vertical="center", wrap_text=True,
                                   horizontal="center" if cols[i - 1].kind in ("no", "clock", "count") else "left")
    ws.row_dimensions[header_row].height = 30

    # ── Rows ───────────────────────────────────────────────────
    body = Font(name=FONT, size=10, color=INK)
    day_cols = [i for i, c in enumerate(cols, start=1) if c.key.startswith("day:")]
    for r, p in enumerate(people, start=first):
        for i, c in enumerate(cols, start=1):
            v = c.value(p)
            if c.key == "days" and day_cols:
                v = (f"=COUNT({get_column_letter(day_cols[0])}{r}:"
                     f"{get_column_letter(day_cols[-1])}{r})")
            elif isinstance(v, datetime):
                v = naive(v)
            elif v == "":
                v = None
            cell = ws.cell(r, i, v)
            cell.font = body
            cell.border = Border(bottom=thin)
            if c.kind == "datetime":
                cell.number_format = "d mmm yyyy hh:mm"
            elif c.kind == "clock":
                cell.number_format = "hh:mm"
                cell.alignment = Alignment(horizontal="center")
            elif c.kind in ("no", "count"):
                cell.alignment = Alignment(horizontal="center")
            elif c.kind == "long":
                cell.alignment = Alignment(wrap_text=True, vertical="top")
        if p.merged:
            ws.cell(r, 2).comment = Comment(
                f"Merged from {p.merged + 1} registrations (same email or phone).",
                "Knock-Knock", width=220, height=60,
            )

    if people:
        table = Table(displayName="Attendance", ref=f"A{header_row}:{last_col}{last}")
        table.tableStyleInfo = TableStyleInfo(
            name="TableStyleLight1", showRowStripes=True,
            showFirstColumn=False, showLastColumn=False, showColumnStripes=False,
        )
        ws.add_table(table)
        rng = f"{status_col}{first}:{status_col}{last}"
        for s, (fg, bg) in STATUS_LOOK.items():
            ws.conditional_formatting.add(rng, CellIsRule(
                operator="equal", formula=[f'"{STATUS_LABELS[s]}"'],
                fill=PatternFill("solid", fgColor=bg, bgColor=bg),
                font=Font(name=FONT, bold=True, color=fg),
            ))
    else:
        ws.cell(first, 2, "No registrations yet.").font = Font(name=FONT, italic=True, color=MUTED)
        last = first

    # ── Notes ──────────────────────────────────────────────────
    row = last + 2
    for line in note_lines(ctx):
        ws.cell(row, 2, line).font = Font(name=FONT, size=9, italic=True, color=MUTED)
        row += 1
    ws.cell(row, 2, f"Exported from Knock-Knock on {fmt_stamp(ctx['generated_at'])} "
                    f"{ctx['generated_at'].year}.").font = Font(name=FONT, size=9, color=MUTED)

    # ── Widths, freeze, print ──────────────────────────────────
    for i, c in enumerate(cols, start=1):
        if c.kind == "no":
            width = 5
        elif c.kind == "clock":
            width = max(9, min(len(c.label) + 2, 16))
        elif c.kind == "datetime":
            width = 18
        else:
            longest = max([len(str(c.value(p) or "")) for p in people] + [len(c.label)])
            width = max(10, min(longest + 3, 48 if c.kind == "long" else 36))
        ws.column_dimensions[get_column_letter(i)].width = width

    ws.freeze_panes = ws.cell(first, 3)
    ws.print_title_rows = f"{header_row}:{header_row}"
    ws.page_setup.orientation = "landscape"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.oddFooter.left.text = "Knock-Knock attendance list"
    ws.oddFooter.right.text = "Page &P of &N"

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ─────────────────────────── Word helpers ───────────────────────────

def docx_shade(cell, hex_fill):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    tc_pr = cell._tc.get_or_add_tcPr()
    for old in tc_pr.findall(qn("w:shd")):
        tc_pr.remove(old)
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tc_pr.append(shd)


def docx_table_borders(table, *, inside_h=LINE, outer=LINE, size=4, vertical=False):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    tbl_pr = table._tbl.tblPr
    borders = OxmlElement("w:tblBorders")
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        el = OxmlElement(f"w:{edge}")
        colour = inside_h if edge == "insideH" else outer
        if edge in ("left", "right", "insideV") and not vertical:
            el.set(qn("w:val"), "nil")
        else:
            el.set(qn("w:val"), "single")
            el.set(qn("w:sz"), str(size))
            el.set(qn("w:color"), colour)
        borders.append(el)
    tbl_pr.append(borders)


def docx_cell_border(cell, edge, colour, size=12):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    tc_pr = cell._tc.get_or_add_tcPr()
    borders = tc_pr.find(qn("w:tcBorders"))
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    el = OxmlElement(f"w:{edge}")
    el.set(qn("w:val"), "single")
    el.set(qn("w:sz"), str(size))
    el.set(qn("w:color"), colour)
    borders.append(el)


def docx_cell_margins(table, top=50, bottom=50, left=80, right=80):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    tbl_pr = table._tbl.tblPr
    mar = OxmlElement("w:tblCellMar")
    for edge, v in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        el = OxmlElement(f"w:{edge}")
        el.set(qn("w:w"), str(v))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tbl_pr.append(mar)


def docx_fixed_layout(table, widths_cm):
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Cm
    table.autofit = False
    tbl_pr = table._tbl.tblPr
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tbl_pr.append(layout)
    grid = table._tbl.tblGrid
    for gc, w in zip(grid.findall(qn("w:gridCol")), widths_cm):
        gc.set(qn("w:w"), str(int(Cm(w).twips)))
    for row in table.rows:
        for cell, w in zip(row.cells, widths_cm):
            cell.width = Cm(w)


def docx_row_flags(row, *, header=False, cant_split=True):
    from docx.oxml import OxmlElement
    tr_pr = row._tr.get_or_add_trPr()
    if cant_split:
        tr_pr.append(OxmlElement("w:cantSplit"))
    if header:
        tr_pr.append(OxmlElement("w:tblHeader"))


def docx_text(cell, text, *, size=8.5, bold=False, colour=INK, italic=False,
              align=None, new_paragraph=False, space_after=0):
    from docx.shared import Pt, RGBColor
    para = cell.add_paragraph() if new_paragraph else cell.paragraphs[0]
    para.paragraph_format.space_after = Pt(space_after)
    para.paragraph_format.space_before = Pt(0)
    if align is not None:
        para.alignment = align
    run = para.add_run(text)
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    run.font.color.rgb = RGBColor.from_string(colour)
    return run


def docx_field(paragraph, instr, size=8, colour=MUTED):
    """Insert a Word field (PAGE, NUMPAGES) into a paragraph."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Pt, RGBColor

    def run_with(child):
        run = paragraph.add_run()
        run.font.size = Pt(size)
        run.font.color.rgb = RGBColor.from_string(colour)
        run._r.append(child)
        return run

    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    code = OxmlElement("w:instrText")
    code.set(qn("xml:space"), "preserve")
    code.text = instr
    sep = OxmlElement("w:fldChar")
    sep.set(qn("w:fldCharType"), "separate")
    placeholder = OxmlElement("w:t")
    placeholder.text = "1"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    for el in (begin, code, sep, placeholder, end):
        run_with(el)


def docx_new(event, *, landscape_page, kind_label):
    """A Document with Knock-Knock page setup, base styles and footer."""
    from docx import Document
    from docx.enum.section import WD_ORIENT
    from docx.enum.text import WD_TAB_ALIGNMENT
    from docx.oxml.ns import qn
    from docx.shared import Cm, Pt, RGBColor

    doc = Document()
    doc.core_properties.title = f"{kind_label} – {event.title}"
    doc.core_properties.author = "Knock-Knock"

    sec = doc.sections[0]
    if landscape_page:
        sec.orientation = WD_ORIENT.LANDSCAPE
        sec.page_width, sec.page_height = Cm(29.7), Cm(21.0)
    else:
        sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.left_margin = sec.right_margin = Cm(1.5)
    sec.top_margin = Cm(1.3)
    sec.bottom_margin = Cm(1.4)
    sec.footer_distance = Cm(0.7)

    normal = doc.styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(9.5)
    normal.font.color.rgb = RGBColor.from_string(INK)
    rpr = normal.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is not None:
        rfonts.set(qn("w:eastAsia"), "Arial")
    normal.paragraph_format.space_after = Pt(4)

    usable = Cm((sec.page_width - sec.left_margin - sec.right_margin) / 360000)
    footer = sec.footer.paragraphs[0]
    stops = footer.paragraph_format.tab_stops
    # The built-in Footer style has centre/right stops for US Letter
    # portrait; clear them or "Page n of N" lands mid-line.
    from docx.shared import Inches
    stops.add_tab_stop(Inches(3.25), WD_TAB_ALIGNMENT.CLEAR)
    stops.add_tab_stop(Inches(6.5), WD_TAB_ALIGNMENT.CLEAR)
    stops.add_tab_stop(usable, WD_TAB_ALIGNMENT.RIGHT)
    run = footer.add_run(f"Knock-Knock  |  {kind_label}  |  {event.title}")
    run.font.size = Pt(8)
    run.font.color.rgb = RGBColor.from_string(MUTED)
    tail = footer.add_run("\tPage ")
    tail.font.size = Pt(8)
    tail.font.color.rgb = RGBColor.from_string(MUTED)
    docx_field(footer, "PAGE")
    of = footer.add_run(" of ")
    of.font.size = Pt(8)
    of.font.color.rgb = RGBColor.from_string(MUTED)
    docx_field(footer, "NUMPAGES")
    return doc, usable.cm


def docx_hero(doc, event, kind_label, width_cm):
    """Violet title block with a cyan rule, like the PDF header band."""
    from docx.shared import Pt
    table = doc.add_table(rows=1, cols=1)
    docx_fixed_layout(table, [width_cm])
    docx_cell_margins(table, top=200, bottom=180, left=260, right=260)
    cell = table.rows[0].cells[0]
    docx_shade(cell, VIOLET)
    docx_cell_border(cell, "bottom", CYAN, size=24)
    docx_text(cell, kind_label, size=9.5, colour="DDD6FE", space_after=2)
    docx_text(cell, event.title, size=20, bold=True, colour="FFFFFF",
              new_paragraph=True, space_after=3)
    docx_text(cell, f"{event_date_range(event)}     {event_place(event)}",
              size=10, colour="FFFFFF", new_paragraph=True)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def docx_chips(doc, chips, width_cm):
    """A row of tinted count tiles: [(number, label, fg, bg)]."""
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt
    if not chips:
        return
    tile = min(4.2, width_cm / len(chips))
    table = doc.add_table(rows=1, cols=len(chips))
    docx_fixed_layout(table, [tile] * len(chips))
    docx_cell_margins(table, top=90, bottom=90, left=120, right=120)
    for cell, (number, label, fg, bg) in zip(table.rows[0].cells, chips):
        docx_shade(cell, bg)
        for edge in ("left", "right", "top", "bottom"):
            docx_cell_border(cell, edge, "FFFFFF", size=36)
        docx_text(cell, str(number), size=15, bold=True, colour=fg,
                  align=WD_ALIGN_PARAGRAPH.LEFT)
        docx_text(cell, label, size=8, colour=INK, new_paragraph=True)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def list_chips(ctx):
    chips = [(len(ctx["people"]), "people", VIOLET, VIOLET_SOFT)]
    for s in STATUS_ORDER:
        n = ctx["counts"].get(s)
        if n:
            fg, bg = STATUS_LOOK[s]
            chips.append((n, chip_label(s, ctx["is_over"]), fg, bg))
    return chips


# ─────────────────────────── Word ───────────────────────────

def build_attendance_docx(event):
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt, RGBColor

    ctx = build_list_context(event)
    doc, width = docx_new(event, landscape_page=True, kind_label="Attendance list")
    docx_hero(doc, event, "Attendance list", width)
    docx_chips(doc, list_chips(ctx), width)

    if not ctx["people"]:
        doc.add_paragraph("No registrations yet.")
    chunks = chunk_columns(grouped_columns(ctx), width) if ctx["people"] else []
    centred = ("no", "clock", "count")

    for index, cols in enumerate(chunks):
        if index:
            h = doc.add_paragraph()
            h.paragraph_format.space_before = Pt(10)
            h.paragraph_format.keep_with_next = True
            r = h.add_run("Registration answers" + (" (continued)" if index > 1 else ""))
            r.bold = True
            r.font.size = Pt(11)
            r.font.color.rgb = RGBColor.from_string(VIOLET_DEEP)
        widths = scaled_widths(cols, width)
        rows = 1 + sum(1 + len(m) for _, _, m in ctx["groups"])
        table = doc.add_table(rows=rows, cols=len(cols))
        docx_fixed_layout(table, widths)
        docx_cell_margins(table, top=40, bottom=40, left=70, right=70)
        docx_table_borders(table, inside_h=LINE, outer=LINE)

        head = table.rows[0]
        docx_row_flags(head, header=True)
        for cell, c in zip(head.cells, cols):
            docx_shade(cell, INK)
            docx_text(cell, c.doc_label, size=8.5, bold=True, colour="FFFFFF",
                      align=WD_ALIGN_PARAGRAPH.CENTER if c.kind in centred else None)

        r_i = 1
        for status, title, members in ctx["groups"]:
            fg, bg = STATUS_LOOK[status]
            row = table.rows[r_i]
            docx_row_flags(row)
            merged = row.cells[0].merge(row.cells[-1])
            docx_shade(merged, bg)
            docx_text(merged, f"{title}   ", size=9, bold=True, colour=fg)
            count = merged.paragraphs[0].add_run(str(len(members)))
            count.font.size = Pt(9)
            count.font.color.rgb = RGBColor.from_string(INK)
            r_i += 1
            for k, p in enumerate(members):
                row = table.rows[r_i]
                docx_row_flags(row)
                for cell, c in zip(row.cells, cols):
                    if k % 2:
                        docx_shade(cell, ZEBRA)
                    text = cell_text(c, p, ctx)
                    align = WD_ALIGN_PARAGRAPH.CENTER if c.kind in centred else None
                    if not text and c.kind == "clock":
                        docx_text(cell, "—", colour="B8B5CC", align=align)
                    else:
                        docx_text(cell, text, colour=MUTED if c.kind == "no" else INK,
                                  align=align)
                    if c.key == "name" and p.merged:
                        docx_text(cell, f"{p.merged + 1} registrations merged",
                                  size=6.5, italic=True, colour=MUTED, new_paragraph=True)
                r_i += 1

    notes = note_lines(ctx)
    head = doc.add_paragraph()
    head.paragraph_format.space_before = Pt(12)
    hr = head.add_run("Notes")
    hr.bold = True
    hr.font.size = Pt(10)
    hr.font.color.rgb = RGBColor.from_string(VIOLET_DEEP)
    for line in notes:
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(1)
        r = p.add_run(line)
        r.font.size = Pt(8.5)
        r.font.color.rgb = RGBColor.from_string(MUTED)
    p = doc.add_paragraph()
    r = p.add_run(f"Exported from Knock-Knock on {fmt_day(ctx['generated_at'])}, "
                  f"{ctx['generated_at']:%H:%M}.")
    r.font.size = Pt(8.5)
    r.font.color.rgb = RGBColor.from_string(MUTED)

    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# ─────────────────────────── PDF helpers ───────────────────────────

_PDF_FONTS = None


def pdf_fonts():
    """
    DejaVu Sans (system copy, or the one bundled with matplotlib) so
    names in any Latin script and the ● / — glyphs render. Falls back to
    Helvetica when no TTF can be found.
    """
    global _PDF_FONTS
    if _PDF_FONTS:
        return _PDF_FONTS
    from reportlab.lib.fonts import addMapping
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    dirs = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu",
            "/usr/share/fonts/TTF", "/Library/Fonts"]
    try:
        import matplotlib
        dirs.append(os.path.join(matplotlib.get_data_path(), "fonts", "ttf"))
    except Exception:  # pragma: no cover - matplotlib is optional here
        pass

    def find(name):
        for d in dirs:
            path = os.path.join(d, name)
            if os.path.isfile(path):
                return path
        return None

    def family(alias, regular, bold):
        if not (regular and bold):
            return False
        try:
            pdfmetrics.registerFont(TTFont(alias, regular))
            pdfmetrics.registerFont(TTFont(f"{alias}-Bold", bold))
            addMapping(alias, 0, 0, alias)
            addMapping(alias, 1, 0, f"{alias}-Bold")
            addMapping(alias, 0, 1, alias)
            addMapping(alias, 1, 1, f"{alias}-Bold")
            return True
        except Exception:
            return False

    if family("KK", find("DejaVuSans.ttf"), find("DejaVuSans-Bold.ttf")):
        condensed = family("KKC", find("DejaVuSansCondensed.ttf"),
                           find("DejaVuSansCondensed-Bold.ttf"))
        table = "KKC" if condensed else "KK"
        _PDF_FONTS = {"regular": "KK", "bold": "KK-Bold",
                      "table": table, "table_bold": f"{table}-Bold", "dot": "●"}
    else:
        _PDF_FONTS = {"regular": "Helvetica", "bold": "Helvetica-Bold",
                      "table": "Helvetica", "table_bold": "Helvetica-Bold", "dot": "•"}
    return _PDF_FONTS


def hexc(value):
    from reportlab.lib.colors import HexColor
    return HexColor(f"#{value}")


def draw_door(c, x, y, h, *, alpha=0.95):
    """The Knock-Knock door: arched doorway, knob, and three knock waves."""
    from reportlab.lib.colors import Color
    w = h * 0.58
    c.saveState()
    white = Color(1, 1, 1, alpha=alpha)
    c.setStrokeColor(white)
    c.setFillColor(Color(1, 1, 1, alpha=0.14))
    c.setLineWidth(1.8)
    path = c.beginPath()
    path.moveTo(x, y)
    path.lineTo(x, y + h - w / 2)
    path.arcTo(x, y + h - w, x + w, y + h, startAng=180, extent=-180)
    path.lineTo(x + w, y)
    path.close()
    c.drawPath(path, stroke=1, fill=1)
    c.setFillColor(white)
    c.circle(x + w * 0.74, y + h * 0.42, h * 0.045, stroke=0, fill=1)
    c.setLineWidth(1.4)
    cx, cy = x - h * 0.08, y + h * 0.5
    for i, r in enumerate((h * 0.14, h * 0.25, h * 0.36)):
        c.setStrokeColor(Color(1, 1, 1, alpha=0.85 - i * 0.22))
        c.arc(cx - r, cy - r, cx + r, cy + r, startAng=140, extent=80)
    c.restoreState()


class PdfShell:
    """
    Page furniture shared by the list and the report: a gradient title
    band on page one, a slim running head after that, and a footer with
    "Page n of N" (needs the two-pass canvas below).
    """

    def __init__(self, event, kind_label, *, landscape_page):
        from reportlab.lib.pagesizes import A4, landscape
        from reportlab.lib.units import mm
        self.event = event
        self.kind = kind_label
        self.pagesize = landscape(A4) if landscape_page else A4
        self.W, self.H = self.pagesize
        self.margin = 14 * mm
        self.bottom = 17 * mm
        self.fonts = pdf_fonts()
        self.generated = local_time(timezone.now())
        self._layout_band()

    def _layout_band(self):
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.platypus import Paragraph
        self.door_h = 21 * mm
        self.text_w = self.W - 2 * self.margin - self.door_h * 0.58 - 16 * mm
        title = self.event.title or "Untitled event"
        if len(title) > 110:
            title = title[:107] + "…"
        self.title_para = Paragraph(escape(title), ParagraphStyle(
            "band-title", fontName=self.fonts["bold"], fontSize=19, leading=22,
            textColor=hexc("FFFFFF")))
        _, self.title_h = self.title_para.wrap(self.text_w, 300)
        self.band_h = 10 * mm + 4 + self.title_h + 6 + 2 * 12 + 7 * mm

    def _fit(self, text, font, size, width):
        from reportlab.pdfbase.pdfmetrics import stringWidth
        if stringWidth(text, font, size) <= width:
            return text
        while text and stringWidth(text + "…", font, size) > width:
            text = text[:-1]
        return text.rstrip() + "…"

    @property
    def frame_width(self):
        return self.W - 2 * self.margin

    def _band(self, c, _doc):
        from reportlab.lib.units import mm
        W, H, m = self.W, self.H, self.margin
        y0 = H - self.band_h
        c.saveState()
        clip = c.beginPath()
        clip.rect(0, y0, W, self.band_h)
        c.clipPath(clip, stroke=0, fill=0)
        c.linearGradient(0, y0, W, H, (hexc("5B21B6"), hexc(VIOLET), hexc(CYAN_DEEP)),
                         positions=(0, 0.6, 1), extend=False)
        c.restoreState()
        c.setFillColor(hexc(CYAN))
        c.rect(0, y0, W, 2, stroke=0, fill=1)

        door_h = self.door_h
        draw_door(c, W - m - door_h * 0.58, y0 + (self.band_h - door_h) / 2, door_h)

        y = H - 10 * mm
        c.setFillColor(hexc("DDD6FE"))
        c.setFont(self.fonts["regular"], 9.5)
        c.drawString(m, y, self.kind)
        self.title_para.drawOn(c, m, y - 4 - self.title_h)
        y = y - 4 - self.title_h - 14
        font = self.fonts["regular"]
        c.setFillColor(hexc("FFFFFF"))
        c.setFont(font, 9.5)
        c.drawString(m, y, self._fit(event_date_range(self.event), font, 9.5, self.text_w))
        c.setFillColor(hexc("EDE9FE"))
        c.drawString(m, y - 12, self._fit(event_place(self.event), font, 9.5, self.text_w))

    def _running_head(self, c, _doc):
        from reportlab.lib.units import mm
        W, H, m = self.W, self.H, self.margin
        y = H - 10 * mm
        c.setFillColor(hexc(VIOLET))
        c.rect(m, y - 1, 3, 9, stroke=0, fill=1)
        c.setFont(self.fonts["bold"], 8.5)
        c.setFillColor(hexc(INK))
        c.drawString(m + 7, y, self.kind)
        c.setFont(self.fonts["regular"], 8.5)
        c.setFillColor(hexc(MUTED))
        c.drawString(m + 7 + c.stringWidth(self.kind, self.fonts["bold"], 8.5) + 8, y,
                     self.event.title[:90])
        c.drawRightString(W - m, y, event_date_range(self.event))
        c.setStrokeColor(hexc(LINE))
        c.setLineWidth(0.6)
        c.line(m, y - 5, W - m, y - 5)

    def canvas_class(self):
        from reportlab.pdfgen.canvas import Canvas
        shell = self

        class NumberedCanvas(Canvas):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                self._pages = []

            def showPage(self):
                self._pages.append(dict(self.__dict__))
                self._startPage()

            def save(self):
                total = len(self._pages)
                for state in self._pages:
                    self.__dict__.update(state)
                    shell._footer(self, total)
                    super().showPage()
                super().save()

        return NumberedCanvas

    def _footer(self, c, total):
        from reportlab.lib.units import mm
        W, m = self.W, self.margin
        y = 9 * mm
        c.setStrokeColor(hexc(LINE))
        c.setLineWidth(0.6)
        c.line(m, y + 9, W - m, y + 9)
        c.setFont(self.fonts["regular"], 7.5)
        c.setFillColor(hexc(MUTED))
        c.drawString(m, y, f"Knock-Knock  |  Exported {fmt_day(self.generated)}, "
                           f"{self.generated:%H:%M} {timezone_label()}")
        c.drawRightString(W - m, y, f"Page {c.getPageNumber()} of {total}")

    def build(self, story):
        from reportlab.lib.units import mm
        from reportlab.platypus import BaseDocTemplate, Frame, NextPageTemplate, PageTemplate
        buf = io.BytesIO()
        doc = BaseDocTemplate(
            buf, pagesize=self.pagesize,
            leftMargin=self.margin, rightMargin=self.margin,
            topMargin=self.margin, bottomMargin=self.bottom,
            title=f"{self.kind} – {self.event.title}", author="Knock-Knock",
            creator="Knock-Knock", subject=self.kind,
        )
        fw = self.frame_width
        first = Frame(self.margin, self.bottom, fw,
                      self.H - self.band_h - 6 * mm - self.bottom,
                      id="first", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        later = Frame(self.margin, self.bottom, fw,
                      self.H - 16 * mm - self.bottom,
                      id="later", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        doc.addPageTemplates([
            PageTemplate("first", [first], onPage=self._band),
            PageTemplate("later", [later], onPage=self._running_head),
        ])
        doc.build([NextPageTemplate("later")] + story, canvasmaker=self.canvas_class())
        return buf.getvalue()


def pdf_styles():
    from reportlab.lib.styles import ParagraphStyle
    f = pdf_fonts()
    base = dict(fontName=f["table"], fontSize=7.8, leading=9.6, textColor=hexc(INK))
    return {
        "cell": ParagraphStyle("cell", **base),
        "cell_wrap": ParagraphStyle("cell_wrap", wordWrap="CJK", **base),
        "cell_centre": ParagraphStyle("cell_centre", alignment=1, **base),
        "cell_muted": ParagraphStyle("cell_muted", **{**base, "textColor": hexc(MUTED)}),
        "head": ParagraphStyle("head", fontName=f["table_bold"], fontSize=7.8, leading=9.4,
                               textColor=hexc("FFFFFF")),
        "head_centre": ParagraphStyle("head_centre", fontName=f["table_bold"], fontSize=7.8,
                                      leading=9.4, textColor=hexc("FFFFFF"), alignment=1),
        "group": ParagraphStyle("group", fontName=f["bold"], fontSize=8.6, leading=11,
                                textColor=hexc(INK)),
        "h2": ParagraphStyle("h2", fontName=f["bold"], fontSize=12.5, leading=16,
                             textColor=hexc(VIOLET_DEEP), spaceBefore=12, spaceAfter=6),
        "body": ParagraphStyle("body", fontName=f["regular"], fontSize=9.2, leading=13,
                               textColor=hexc(INK)),
        "note": ParagraphStyle("note", fontName=f["regular"], fontSize=8.4, leading=11.5,
                               textColor=hexc(MUTED)),
        "chip_num": ParagraphStyle("chip_num", fontName=f["bold"], fontSize=15, leading=17),
        "chip_label": ParagraphStyle("chip_label", fontName=f["regular"], fontSize=7.6,
                                     leading=9.5, textColor=hexc(INK)),
    }


def pdf_chips(chips, frame_width, *, tile_w=None):
    """Rounded count tiles laid out in one row."""
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, Table, TableStyle
    st = pdf_styles()
    tile_w = tile_w or min(38 * mm, (frame_width - 3 * mm * (len(chips) - 1)) / max(len(chips), 1))
    cells, widths = [], []
    for i, (number, label, fg, bg) in enumerate(chips):
        num = Paragraph(f"{number}", ParagraphStyle("n", parent=st["chip_num"], textColor=hexc(fg)))
        tile = Table([[num], [Paragraph(escape(label), st["chip_label"])]], colWidths=[tile_w])
        tile.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), hexc(bg)),
            ("ROUNDEDCORNERS", [6, 6, 6, 6]),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, 0), 6),
            ("BOTTOMPADDING", (0, -1), (-1, -1), 6),
            ("TOPPADDING", (0, 1), (-1, 1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 1),
        ]))
        if i:
            cells.append("")
            widths.append(3 * mm)
        cells.append(tile)
        widths.append(tile_w)
    row = Table([cells], colWidths=widths, hAlign="LEFT")
    row.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 0),
                             ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                             ("TOPPADDING", (0, 0), (-1, -1), 0),
                             ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return row


# ─────────────────────────── PDF ───────────────────────────

def build_attendance_pdf(event):
    from reportlab.lib.units import cm, mm
    from reportlab.platypus import CondPageBreak, LongTable, Paragraph, Spacer, TableStyle

    ctx = build_list_context(event)
    shell = PdfShell(event, "Attendance list", landscape_page=True)
    st = pdf_styles()
    dot = shell.fonts["dot"]
    width_cm = shell.frame_width / cm
    story = [pdf_chips(list_chips(ctx), shell.frame_width), Spacer(1, 6 * mm)]

    if not ctx["people"]:
        story.append(Paragraph("No registrations yet.", st["body"]))

    centred = ("no", "clock", "count")
    chunks = chunk_columns(grouped_columns(ctx), width_cm) if ctx["people"] else []
    for index, cols in enumerate(chunks):
        if index:
            story.append(CondPageBreak(5 * cm))
            story.append(Paragraph("Registration answers" + (" (continued)" if index > 1 else ""),
                                   st["h2"]))
        widths = [w * cm for w in scaled_widths(cols, width_cm)]
        data = [[Paragraph(escape(c.doc_label).replace("\n", "<br/>"),
                           st["head_centre"] if c.kind in centred else st["head"])
                 for c in cols]]
        style = [
            ("BACKGROUND", (0, 0), (-1, 0), hexc(INK)),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 3.2),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3.2),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("LINEBELOW", (0, 1), (-1, -1), 0.4, hexc(LINE)),
        ]
        r = 1
        for status, title, members in ctx["groups"]:
            fg, bg = STATUS_LOOK[status]
            data.append([Paragraph(
                f'<font color="#{fg}">{dot}</font>&nbsp;&nbsp;{escape(title)}'
                f'&nbsp;&nbsp;&nbsp;<font color="#{MUTED}">{len(members)}</font>',
                st["group"])] + [""] * (len(cols) - 1))
            style += [("SPAN", (0, r), (-1, r)), ("BACKGROUND", (0, r), (-1, r), hexc(bg)),
                      ("TOPPADDING", (0, r), (-1, r), 4.5),
                      ("BOTTOMPADDING", (0, r), (-1, r), 4.5)]
            r += 1
            for k, p in enumerate(members):
                row = []
                for c in cols:
                    text = escape(cell_text(c, p, ctx))
                    if c.kind == "no":
                        row.append(Paragraph(text, st["cell_muted"]))
                    elif c.kind == "clock" and not text:
                        row.append(Paragraph('<font color="#B8B5CC">—</font>', st["cell_centre"]))
                    elif c.kind in centred:
                        row.append(Paragraph(text, st["cell_centre"]))
                    elif c.key == "name" and p.merged:
                        row.append(Paragraph(
                            f'{text}<br/><font size="6.2" color="#{MUTED}">'
                            f'{p.merged + 1} registrations merged</font>', st["cell"]))
                    elif c.kind in ("email", "long", "answer"):
                        row.append(Paragraph(text, st["cell_wrap"]))
                    else:
                        row.append(Paragraph(text, st["cell"]))
                data.append(row)
                if k % 2:
                    style.append(("BACKGROUND", (0, r), (-1, r), hexc(ZEBRA)))
                r += 1
        table = LongTable(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
        table.setStyle(TableStyle(style))
        story.append(table)

    story.append(Spacer(1, 5 * mm))
    story.append(Paragraph("Notes", st["h2"]))
    for line in note_lines(ctx):
        story.append(Paragraph(escape(line), st["note"]))
    return shell.build(story)
